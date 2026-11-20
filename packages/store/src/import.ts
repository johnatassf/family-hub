// Importação da planilha da loja ("Contas a Pagar", "Boletos compartilhados", "Compras Clientes", "Cliente").
// Função pura: recebe as linhas cruas de cada aba (1ª linha = cabeçalho) e devolve o que gravar.
import { type PaymentMethod, inferBrand, splitQty } from './shared';

export type Cell = string | number | null;
export interface RawWorkbook {
  sheets: Record<string, Cell[][]>;
}

export interface ImportPlan {
  customers: { key: string; name: string }[];
  products: { key: string; name: string; brand: string | null; priceCents: number }[];
  sales: {
    date: string;
    customerKey: string | null;
    items: { productKey: string | null; description: string; qty: number; unitPriceCents: number }[];
    totalCents: number;
    paymentMethod: PaymentMethod;
    dueDate: string | null;
    payments: { date: string; amountCents: number }[];
    notes: string | null;
  }[];
  payables: {
    supplier: string;
    dueDate: string;
    amountCents: number;
    status: 'open' | 'paid';
    paidCents: number | null;
    shared: boolean;
    notes: string | null;
  }[];
  warnings: string[];
}

const fold = (s: string) => s.normalize('NFKD').replace(/\p{Mn}/gu, '').toLowerCase().trim();
const cents = (v: Cell) => (typeof v === 'number' ? Math.round(v * 100) : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v.replace(',', '.'))) ? Math.round(Number(v.replace(',', '.')) * 100) : null);
const date = (v: Cell) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const text = (v: Cell) => (v === null || v === undefined ? '' : String(v).trim());

function findSheet(wb: RawWorkbook, test: (name: string) => boolean) {
  const name = Object.keys(wb.sheets).find((n) => test(fold(n)));
  return name ? wb.sheets[name]! : null;
}

/** Linhas como objetos, pelas colunas do cabeçalho (sem acento, minúsculas). */
function records(rows: Cell[][] | null) {
  if (!rows?.length) return [];
  const header = rows[0]!.map((h) => fold(text(h)));
  return rows.slice(1).map((r) => {
    const o: Record<string, Cell> = {};
    header.forEach((h, i) => (o[h || `col${i}`] = r[i] ?? null));
    return o;
  });
}

const col = (o: Record<string, Cell>, ...names: string[]) => {
  for (const n of names) if (n in o) return o[n] ?? null;
  return null;
};

export function mapSpreadsheet(wb: RawWorkbook, today: string): ImportPlan {
  const warnings: string[] = [];
  const plan: ImportPlan = { customers: [], products: [], sales: [], payables: [], warnings };

  // ---- Contas a pagar + boletos compartilhados ----
  // Boletos idênticos na mesma aba são boletos diferentes (ex.: dois pedidos): ficam separados.
  // Cada linha da aba de compartilhados casa com UM boleto ainda não casado de mesma marca, data e valor.
  const payables: ImportPlan['payables'][number][] = [];
  const unmatched = new Map<string, number[]>();
  const keyOf = (supplier: string, dueDate: string, amount: number) => `${fold(supplier)}|${dueDate}|${amount}`;
  for (const o of records(findSheet(wb, (n) => n.includes('contas a pagar')))) {
    const supplier = text(col(o, 'marca', 'fornecedor'));
    const dueDate = date(col(o, 'data de vencimento', 'vencimento'));
    const amount = cents(col(o, 'valor'));
    if (!supplier && !dueDate && amount === null) continue;
    if (!dueDate || !amount) {
      warnings.push(`Conta a pagar ignorada (sem data ou valor): ${supplier || '?'}`);
      continue;
    }
    const paid = fold(text(col(o, 'status'))) === 'pago';
    const key = keyOf(supplier, dueDate, amount);
    unmatched.set(key, [...(unmatched.get(key) ?? []), payables.length]);
    payables.push({
      supplier: supplier || 'A confirmar',
      dueDate,
      amountCents: amount,
      status: paid ? 'paid' : 'open',
      paidCents: paid ? amount : null,
      shared: false,
      notes: null,
    });
  }
  for (const o of records(findSheet(wb, (n) => n.includes('compartilh')))) {
    const supplier = text(col(o, 'marca', 'fornecedor')) || 'A confirmar';
    const dueDate = date(col(o, 'data de vencimento', 'vencimento'));
    const amount = cents(col(o, 'valor'));
    if (!dueDate || !amount) continue;
    const paidCents = cents(col(o, 'valor pago'));
    const note = text(col(o, 'observacoes', 'observacao'));
    // Marca "A confirmar" na aba de compartilhados: casa só por data e valor, e adota a marca conhecida.
    const unknown = fold(supplier) === 'a confirmar';
    let idx = unknown ? undefined : unmatched.get(keyOf(supplier, dueDate, amount))?.shift();
    if (unknown) {
      for (const [k, list] of unmatched) {
        if (k.endsWith(`|${dueDate}|${amount}`) && list.length) {
          idx = list.shift();
          break;
        }
      }
    }
    const existing = idx === undefined ? undefined : payables[idx];
    const merged = {
      ...(existing ?? { supplier, dueDate, amountCents: amount, status: 'open' as const, paidCents: null, notes: null }),
      shared: true,
      notes: note && note !== '-' ? note : (existing?.notes ?? null),
    };
    if (paidCents) {
      merged.status = 'paid';
      merged.paidCents = paidCents;
    }
    if (idx === undefined) payables.push(merged);
    else payables[idx] = merged;
  }
  plan.payables = payables.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // ---- Clientes e vendas ----
  const customers = new Map<string, string>(); // chave → nome
  const addCustomer = (name: string) => {
    const key = fold(name);
    if (key && !customers.has(key)) customers.set(key, name.trim());
    return key || null;
  };
  const products = new Map<string, ImportPlan['products'][number]>();
  const addProduct = (name: string, unitPriceCents: number) => {
    const key = fold(name);
    if (!key || key.startsWith('?')) return null;
    if (!products.has(key)) products.set(key, { key, name, brand: inferBrand(name), priceCents: unitPriceCents });
    return key;
  };

  // Registro de vendas (data, cliente, produtos em texto, valor, status)
  const salesLog = (findSheet(wb, (n) => n.includes('compras clientes')) ?? []).filter((r) => r.some((v) => v !== null && v !== ''));
  const logRows = salesLog
    .filter((r) => date(r[0] ?? null))
    .map((r) => ({ date: date(r[0] ?? null)!, customer: text(r[1] ?? null), products: text(r[2] ?? null), amount: cents(r[3] ?? null), paid: fold(text(r[4] ?? null)) === 'pago', used: false }));

  // Fiado: cada cliente na 1ª linha, itens nas linhas seguintes (cliente em branco)
  const groups: { customer: string; items: { description: string; amount: number }[]; paidCents: number; paidDate: string | null; dueDate: string | null; quitado: boolean }[] = [];
  for (const o of records(findSheet(wb, (n) => n === 'cliente' || n === 'clientes' || n.includes('fiado')))) {
    const name = text(col(o, 'cliente'));
    const desc = text(col(o, 'produtos retirados', 'produtos', 'produto'));
    const amount = cents(col(o, 'valor da compra', 'valor'));
    if (name) {
      groups.push({ customer: name, items: [], paidCents: 0, paidDate: null, dueDate: null, quitado: false });
    }
    const g = groups.at(-1);
    if (!g) continue;
    if (desc || amount) g.items.push({ description: desc || '(sem descrição)', amount: amount ?? 0 });
    g.paidCents += cents(col(o, 'valor pago')) ?? 0;
    g.paidDate ??= date(col(o, 'data que pagou', 'data do pagamento'));
    g.dueDate ??= date(col(o, 'data do pagamento combinado'));
    if (fold(text(col(o, 'status'))) === 'quitado') g.quitado = true;
  }

  for (const g of groups) {
    const customerKey = addCustomer(g.customer);
    const first = fold(g.customer).split(/\s+/)[0];
    // A mesma venda costuma estar no registro de vendas: usa a data de lá e não duplica.
    const match = logRows.find((l) => !l.used && fold(l.customer).split(/\s+/)[0] === first);
    if (match) match.used = true;
    const items = g.items.map((i) => {
      const { qty, name } = splitQty(i.description);
      const unit = Math.round(i.amount / qty);
      return { productKey: addProduct(name, unit), description: name, qty, unitPriceCents: unit };
    });
    const total = items.reduce((a, i) => a + i.qty * i.unitPriceCents, 0);
    if (!total) {
      warnings.push(`Fiado de ${g.customer} sem valor: ignorado.`);
      continue;
    }
    const saleDate = match?.date ?? today;
    const paid = g.quitado ? Math.max(g.paidCents, total) : g.paidCents;
    plan.sales.push({
      date: saleDate,
      customerKey,
      items,
      totalCents: total,
      paymentMethod: 'fiado',
      dueDate: g.dueDate,
      payments: paid > 0 ? [{ date: g.paidDate ?? saleDate, amountCents: Math.min(paid, total) }] : [],
      notes: match ? 'Importado da planilha (fiado)' : 'Importado da planilha (fiado) — data da compra não informada',
    });
  }

  let skipped = 0;
  for (const l of logRows) {
    if (l.used) continue;
    if (!l.amount) {
      skipped++;
      continue;
    }
    const customerKey = l.customer ? addCustomer(l.customer) : null;
    plan.sales.push({
      date: l.date,
      customerKey,
      items: [{ productKey: null, description: l.products || '(sem descrição)', qty: 1, unitPriceCents: l.amount }],
      totalCents: l.amount,
      paymentMethod: 'outro',
      dueDate: null,
      payments: [{ date: l.date, amountCents: l.amount }],
      notes: l.paid ? 'Importado da planilha' : 'Importado da planilha — status de pagamento não informado (considerada paga)',
    });
  }
  if (skipped) warnings.push(`${skipped} venda(s) do registro sem valor foram ignoradas.`);

  plan.customers = [...customers.entries()].map(([key, name]) => ({ key, name }));
  plan.products = [...products.values()];
  plan.sales.sort((a, b) => a.date.localeCompare(b.date));
  return plan;
}
