import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Session, api, invite, json, ownerWith2fa, signUp } from './helpers';

let ana: Session; // dona da família
let lari: Session; // dona da loja (membro da família)
let bid: string;
const base = () => `/api/store/b/${bid}`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

async function post(s: Session, path: string, body: unknown) {
  const res = await api(path, { method: 'POST', session: s, body });
  if (res.status >= 300) throw new Error(`${path} ${res.status} ${await res.text()}`);
  return json(res);
}

beforeEach(async () => {
  ana = await ownerWith2fa();
  await invite(ana, 'lari@teste.local');
  lari = await signUp('lari@teste.local', 'Larissa');
  bid = (await post(lari, '/api/store/businesses', { name: 'Larissa — Loja de presentes' })).id;
});

describe('privacidade da empresa', () => {
  it('só membros da empresa veem; nem a dona da família', async () => {
    expect((await api(`${base()}/products`, { session: ana })).status).toBe(404);
    expect(await json(await api('/api/store/businesses', { session: ana }))).toEqual([]);
    expect(await json(await api('/api/store/businesses', { session: lari }))).toEqual([{ id: bid, name: 'Larissa — Loja de presentes', kind: 'gift_shop', role: 'owner' }]);
  });

  it('quem só visualiza não altera nada', async () => {
    expect((await api(`${base()}/members/${ana.userId}`, { method: 'PUT', session: lari, body: { role: 'viewer' } })).status).toBe(200);
    expect((await api(`${base()}/products`, { session: ana })).status).toBe(200);
    expect((await api(`${base()}/products`, { method: 'POST', session: ana, body: { kind: 'product', name: 'X' } })).status).toBe(403);
    // e não gerencia membros
    expect((await api(`${base()}/members/${ana.userId}`, { method: 'DELETE', session: ana })).status).toBe(403);
  });

  it('não aceita pessoa de fora da família como membro', async () => {
    await env.DB.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('fora', 'Fora', 'fora@x.local', 1, '2026-01-01', '2026-01-01')`).run();
    expect((await api(`${base()}/members/fora`, { method: 'PUT', session: lari, body: { role: 'editor' } })).status).toBe(400);
  });
});

describe('produtos, kits e vendas', () => {
  async function catalog() {
    const perfume = (await post(lari, `${base()}/products`, { kind: 'product', name: 'Kaiak Pulso', brand: 'Natura', costCents: 9000, priceCents: 12490, stockQty: 5, minStock: 2 })).id;
    const sabonete = (await post(lari, `${base()}/products`, { kind: 'product', name: 'Sabonete Ekos', brand: 'Natura', costCents: 1500, priceCents: 2590, stockQty: 10 })).id;
    const caixa = (await post(lari, `${base()}/products`, { kind: 'supply', name: 'Caixa presente M', costCents: 800, stockQty: 3 })).id;
    const kit = (await post(lari, `${base()}/products`, { kind: 'kit', name: 'Kit Dia dos Pais', priceCents: 17990 })).id;
    const put = await api(`${base()}/products/${kit}/components`, {
      method: 'PUT',
      session: lari,
      body: { components: [{ componentId: perfume, qty: 1 }, { componentId: sabonete, qty: 2 }, { componentId: caixa, qty: 1 }] },
    });
    expect(put.status).toBe(200);
    return { perfume, sabonete, caixa, kit };
  }

  it('kit: custo pelos componentes e quantos dá para montar', async () => {
    const { kit } = await catalog();
    const products = await json(await api(`${base()}/products`, { session: lari }));
    expect(products.find((p: { id: string }) => p.id === kit)).toMatchObject({ costCents: 9000 + 2 * 1500 + 800, buildable: 3, stockQty: null });
    // kit dentro de kit não pode
    const other = (await post(lari, `${base()}/products`, { kind: 'kit', name: 'Outro kit' })).id;
    expect((await api(`${base()}/products/${other}/components`, { method: 'PUT', session: lari, body: { components: [{ componentId: kit, qty: 1 }] } })).status).toBe(400);
  });

  it('venda à vista baixa o estoque (o kit baixa os componentes) e entra no painel com lucro', async () => {
    const { perfume, sabonete, caixa, kit } = await catalog();
    const sale = await post(lari, `${base()}/sales`, {
      date: today,
      items: [
        { productId: kit, qty: 1, unitPriceCents: 17990 },
        { productId: perfume, qty: 1, unitPriceCents: 12490 },
        { description: 'Laço avulso', qty: 1, unitPriceCents: 500 },
      ],
      discountCents: 980,
      paymentMethod: 'pix',
    });
    expect(sale.totalCents).toBe(17990 + 12490 + 500 - 980);

    const stock = Object.fromEntries((await env.DB.prepare(`SELECT id, stock_qty FROM biz_products WHERE stock_qty IS NOT NULL`).all<{ id: string; stock_qty: number }>()).results.map((r) => [r.id, r.stock_qty]));
    expect(stock).toEqual({ [perfume]: 3, [sabonete]: 8, [caixa]: 2 });

    const d = await json(await api(`${base()}/dashboard`, { session: lari }));
    expect(d.sales).toMatchObject({ count: 1, revenueCents: sale.totalCents });
    // Margem dos itens com custo: kit 17990−12800 + perfume 12490−9000; menos o desconto proporcional a eles.
    const withCost = 17990 + 12490;
    expect(d.sales.profitCents).toBe(17990 - 12800 + (12490 - 9000) - Math.round(980 * (withCost / (withCost + 500))));
    expect(d.sales.costCoveragePct).toBe(Math.round((withCost / (withCost + 500)) * 100));
    expect(d.byMethod).toEqual([{ method: 'pix', totalCents: sale.totalCents }]);
    expect(d.lowStock.map((p: { name: string }) => p.name)).toEqual([]);
  });

  it('cancelar devolve o estoque', async () => {
    const { perfume, kit } = await catalog();
    const sale = await post(lari, `${base()}/sales`, { date: today, items: [{ productId: kit, qty: 2, unitPriceCents: 17990 }], paymentMethod: 'dinheiro' });
    expect((await env.DB.prepare(`SELECT stock_qty FROM biz_products WHERE id = ?`).bind(perfume).first())!.stock_qty).toBe(3);
    expect((await api(`${base()}/sales/${sale.id}/cancel`, { method: 'POST', session: lari })).status).toBe(200);
    expect((await env.DB.prepare(`SELECT stock_qty FROM biz_products WHERE id = ?`).bind(perfume).first())!.stock_qty).toBe(5);
    expect((await api(`${base()}/sales/${sale.id}/cancel`, { method: 'POST', session: lari })).status).toBe(409);
  });

  it('entrada de mercadoria recalcula o custo médio', async () => {
    const { perfume } = await catalog();
    const r = await json(await api(`${base()}/products/${perfume}/stock`, { method: 'POST', session: lari, body: { delta: 5, reason: 'purchase', unitCostCents: 10000 } }));
    expect(r).toEqual({ stockQty: 10, costCents: 9500 });
  });
});

describe('fiado (a receber)', () => {
  it('venda fiado fica em aberto; pagamentos parciais quitam; não aceita pagar a mais', async () => {
    const cust = (await post(lari, `${base()}/customers`, { name: 'Maria', phone: '11 98888-7777', birthday: today.slice(5) })).id;
    expect((await api(`${base()}/sales`, { method: 'POST', session: lari, body: { date: today, items: [{ description: 'Perfume', qty: 1, unitPriceCents: 30000 }], paymentMethod: 'fiado' } })).status).toBe(400); // fiado sem cliente
    const sale = await post(lari, `${base()}/sales`, { date: today, customerId: cust, items: [{ description: 'Perfume', qty: 1, unitPriceCents: 30000 }], paymentMethod: 'fiado', dueDate: today });

    let customers = await json(await api(`${base()}/customers`, { session: lari }));
    expect(customers[0]).toMatchObject({ name: 'Maria', balanceCents: 30000, openSales: 1 });

    expect((await api(`${base()}/sales/${sale.id}/payments`, { method: 'POST', session: lari, body: { amountCents: 40000 } })).status).toBe(400);
    expect(await post(lari, `${base()}/sales/${sale.id}/payments`, { amountCents: 10000, method: 'pix' })).toEqual({ balanceCents: 20000 });
    const d = await json(await api(`${base()}/dashboard`, { session: lari }));
    expect(d.receivable).toMatchObject({ totalCents: 20000, customers: 1 });
    expect(d.birthdays.map((b: { name: string }) => b.name)).toEqual(['Maria']);

    await post(lari, `${base()}/sales/${sale.id}/payments`, { amountCents: 20000, method: 'dinheiro' });
    customers = await json(await api(`${base()}/customers`, { session: lari }));
    expect(customers[0]).toMatchObject({ balanceCents: 0, openSales: 0, totalSpentCents: 30000 });
    const open = await json(await api(`${base()}/sales?status=open`, { session: lari }));
    expect(open).toEqual([]);
  });
});

describe('boletos', () => {
  it('marcar como pago usa o valor cheio; painel soma o que está em aberto e o compartilhado', async () => {
    const a = (await post(lari, `${base()}/payables`, { supplier: 'Natura', dueDate: today, amountCents: 33123, shared: true, notes: 'Dividido' })).id;
    await post(lari, `${base()}/payables`, { supplier: 'O Boticário', dueDate: '2099-01-01', amountCents: 50000 });
    let d = await json(await api(`${base()}/dashboard`, { session: lari }));
    expect(d.payable).toMatchObject({ openCents: 83123, sharedOpenCents: 33123 });

    expect((await api(`${base()}/payables/${a}`, { method: 'PATCH', session: lari, body: { status: 'paid' } })).status).toBe(200);
    const row = await env.DB.prepare(`SELECT status, paid_cents, paid_date FROM biz_payables WHERE id = ?`).bind(a).first();
    expect(row).toEqual({ status: 'paid', paid_cents: 33123, paid_date: today });
    d = await json(await api(`${base()}/dashboard`, { session: lari }));
    expect(d.payable).toMatchObject({ openCents: 50000, sharedOpenCents: 0 });
  });
});

describe('importação via API', () => {
  const sheets = {
    'Contas a Pagar': [['Marca', 'Data de vencimento', 'Valor', 'Status'], ['Natura', '2026-09-02', 100, 'Pago']],
    'Compras Clientes': [['2026-08-12', 'João', 'Perfume Humor', 114.9, 'Pago']],
    Cliente: [['Cliente', 'Produtos retirados', 'Data da compra', 'Valor da compra', 'Data do pagamento combinado', 'Valor pago', 'Data que pagou', 'Saldo devedor', 'Status'], ['Maria', '1 Kaiak Pulso', null, 120, null, null, null, 120, null]],
  };

  it('importa numa loja vazia e recusa importar de novo', async () => {
    const r = await post(lari, `${base()}/import`, { sheets });
    expect(r).toMatchObject({ customers: 2, products: 1, sales: 2, payables: 1 });
    const open = await json(await api(`${base()}/sales?status=open`, { session: lari }));
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ customerName: 'Maria', balanceCents: 12000 });
    expect((await api(`${base()}/import`, { method: 'POST', session: lari, body: { sheets } })).status).toBe(409);
  });

  it('só a dona importa', async () => {
    await api(`${base()}/members/${ana.userId}`, { method: 'PUT', session: lari, body: { role: 'editor' } });
    expect((await api(`${base()}/import`, { method: 'POST', session: ana, body: { sheets } })).status).toBe(403);
  });
});

describe('saída da família', () => {
  it('quem sai leva a empresa dela', async () => {
    await post(lari, `${base()}/customers`, { name: 'Cliente' });
    await api(`/api/household/members/${lari.userId}`, { method: 'DELETE', session: ana });
    const left = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM biz_businesses) AS b, (SELECT COUNT(*) FROM biz_customers) AS c`).first();
    expect(left).toEqual({ b: 0, c: 0 });
  });
});
