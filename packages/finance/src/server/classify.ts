// Classificação de lançamentos. Portado de app.py: norm(), classify(), installment_of(), RULES.
import type { Confidence } from '../shared';
import type { PluggyTransaction } from './pluggy';

/** Regras iniciais de cada família (editáveis depois). A ordem é a prioridade: vence a primeira. */
export const DEFAULT_RULES: ReadonlyArray<readonly [pattern: string, category: string]> = [
  ['AGNALDO', 'Casa'], ['FACUL', 'Educação'], ['FIAP', 'Educação'], ['EXTRA', 'Mercado'],
  ['SUPERMERCADO', 'Mercado'], ['MERCADO', 'Mercado'], ['UBER', 'Transporte'], ['99*', 'Transporte'],
  ['NETFLIX', 'Assinaturas'], ['SPOTIFY', 'Assinaturas'], ['CHATGPT', 'Assinaturas'],
  ['OPENAI', 'Assinaturas'], ['CANVA', 'Assinaturas'], ['GAMMA.APP', 'Assinaturas'],
  ['WELLHUB', 'Saúde/Farmácia'], ['GYMPASS', 'Saúde/Farmácia'], ['FARMA', 'Saúde/Farmácia'],
  ['HOPE VET', 'Saúde/Farmácia'], ['BERZERM', 'Compras pessoais'], ['SHEIN', 'Compras pessoais'],
  ['TROCAFY', 'Compras pessoais'], ['EMMASLEEP', 'Casa'], ['IFOOD', 'Alimentação'],
  ['IFD*', 'Alimentação'], ['MCDONALD', 'Alimentação'], ['PIZZARIA', 'Alimentação'],
];

/** Pagamento de fatura e afins: transferência excluída do total (evita contar o gasto duas vezes). */
const TRANSFER_EXCLUDED = ['PAGAMENTO DE FATURA', 'PAGAMENTO ON LINE', 'EST DEB AUTOM', 'RESGATE PONTOS'];
/**
 * Pagamento da fatura visto do lado do CARTÃO ("Pagamento recebido"). O Python não excluía e contava
 * a fatura duas vezes. Usa o operationType da Pluggy, e não o texto: "pagamento recebido" na conta
 * corrente pode ser uma receita de verdade.
 */
const BILL_PAYMENT_OPERATIONS = new Set(['PAGAMENTO_FATURA']);
const TRANSFER_REVIEW = ['PIX ENVIADO', 'TRANSFERENCIA ENTRE CONTAS'];

/** Igual ao Python: NFKD, remove marcas combinantes (acentos), maiúsculas, sem espaços nas pontas. */
export const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFKD').replace(/\p{Mn}/gu, '').toUpperCase().trim();

export interface Classification {
  category: string;
  excluded: 0 | 1;
  confidence: Confidence;
}

export function classify(
  description: string,
  rules: ReadonlyArray<{ pattern: string; category: string }>,
  operationType?: string | null,
): Classification {
  const d = norm(description);
  if ((operationType && BILL_PAYMENT_OPERATIONS.has(operationType)) || TRANSFER_EXCLUDED.some((x) => d.includes(x))) {
    return { category: 'Transferências', excluded: 1, confidence: 'Alta' };
  }
  if (TRANSFER_REVIEW.some((x) => d.includes(x))) return { category: 'Transferências', excluded: 0, confidence: 'Baixa' };
  for (const rule of rules) if (d.includes(rule.pattern)) return { category: rule.category, excluded: 0, confidence: 'Alta' };
  return { category: 'Outros', excluded: 0, confidence: 'Baixa' };
}

export function installmentOf(tx: PluggyTransaction): string {
  const cc = tx.creditCardMetadata ?? {};
  if (cc.installmentNumber && cc.totalInstallments) return `Parcela ${cc.installmentNumber}/${cc.totalInstallments}`;
  const raw = tx.installments ?? tx.installment;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const n = r.number ?? r.current;
    const total = r.total ?? r.totalInstallments;
    if (n && total) return `Parcela ${n}/${total}`;
  }
  const m = /(?:parcela\s*)?(\d{1,2})\s*(?:de|\/)\s*(\d{1,2})/i.exec(tx.description ?? '');
  return m ? `Parcela ${m[1]}/${m[2]}` : '';
}

/** Linha pronta para gravar, no formato lido pelo upsert com json_each. */
export interface TxRow {
  id: string;
  description: string;
  amountCents: number;
  date: string;
  referenceMonth: string;
  category: string;
  installment: string;
  excluded: 0 | 1;
  confidence: Confidence;
  status: string | null;
  billId: string | null;
  billForecastDate: string | null;
  cardLast4: string | null;
  purchaseDate: string | null;
}

/**
 * Valor em centavos com sinal único em toda a plataforma: negativo = saída (despesa), positivo = entrada.
 * O sinal de `amount` da Pluggy depende do tipo de conta (no cartão, compra vem POSITIVA), então
 * a direção vem do campo `type` (DEBIT/CREDIT), que é consistente nos dois tipos de conta.
 */
export function signedCents(tx: Pick<PluggyTransaction, 'amount' | 'type'>): number {
  const cents = Math.round(Number(tx.amount || 0) * 100);
  if (tx.type === 'DEBIT') return -Math.abs(cents);
  if (tx.type === 'CREDIT') return Math.abs(cents);
  return cents;
}

export function toRow(tx: PluggyTransaction, rules: ReadonlyArray<{ pattern: string; category: string }>): TxRow | null {
  const id = String(tx.id ?? '');
  if (!id) return null;
  const date = (tx.date || tx.createdAt || '').slice(0, 10);
  if (!date) return null;
  const description = tx.description || tx.merchant?.name || '(Sem descrição)';
  const cc = tx.creditCardMetadata ?? {};
  const digits = (cc.cardNumber ?? '').replace(/\D/g, '');
  return {
    id,
    description,
    amountCents: signedCents(tx),
    date,
    // A API nem sempre informa a competência da fatura: o mês da compra é o fallback (editável).
    referenceMonth: date.slice(0, 7),
    ...classify(description, rules, tx.operationType),
    installment: installmentOf(tx),
    status: tx.status ?? null,
    billId: cc.billId ?? null,
    billForecastDate: cc.billForecastDate ? cc.billForecastDate.slice(0, 10) : null,
    cardLast4: digits ? digits.slice(-4) : null,
    purchaseDate: cc.purchaseDate ? cc.purchaseDate.slice(0, 10) : null,
  };
}
