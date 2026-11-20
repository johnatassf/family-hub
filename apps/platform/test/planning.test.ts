import { describe, expect, it } from 'vitest';
import {
  type InstallmentTx,
  type PlanEntryLike,
  addMonths,
  buildPurchases,
  descriptionStem,
  detectRecurring,
  evaluateSimulation,
  installmentsByMonth,
  monthDiff,
  monthRange,
  monthlyNeed,
  occursIn,
  project,
} from '../../../packages/finance/src/planning';

const C = '2026-11';
const tx = (n: number, total: number, month: string, extra: Partial<InstallmentTx> = {}): InstallmentTx => ({
  id: `${extra.description ?? 'loja'}-${n}`,
  accountId: 'card',
  accountLabel: 'Cartão',
  cardLast4: '1234',
  ownerUserId: 'u1',
  ownerName: 'Ana',
  spenderName: 'Ana',
  description: `LOJA X ${n}/${total}`,
  amountCents: -10000,
  referenceMonth: month,
  installment: `Parcela ${n}/${total}`,
  purchaseDate: null,
  ...extra,
});

describe('meses', () => {
  it('soma e diferença atravessando o ano', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2027-01', -2)).toBe('2026-11');
    expect(monthDiff('2026-11', '2027-03')).toBe(4);
    expect(monthRange('2026-12', 3)).toEqual(['2026-12', '2027-01', '2027-02']);
  });
});

describe('parcelas', () => {
  it('completa as parcelas que o banco ainda não lançou', () => {
    const [p] = buildPurchases([tx(1, 6, '2026-10'), tx(2, 6, '2026-11')], C);
    expect(p!.installments.map((i) => [i.n, i.month, i.real])).toEqual([
      [1, '2026-10', true],
      [2, '2026-11', true],
      [3, '2026-12', false],
      [4, '2027-01', false],
      [5, '2027-02', false],
      [6, '2027-03', false],
    ]);
    expect(p).toMatchObject({ description: 'LOJA X', endMonth: '2027-03', remainingCount: 5, remainingCents: 50000, projectedCount: 4 });
  });

  it('não duplica quando o banco já lançou as futuras', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => tx(n, 6, addMonths('2026-09', n)));
    const [p] = buildPurchases(rows, C);
    expect(p!.projectedCount).toBe(0);
    expect(p!.installments).toHaveLength(6);
  });

  it('não projeta compra antiga sem lançamentos recentes', () => {
    const [p] = buildPurchases([tx(3, 10, '2026-03')], C);
    expect(p!.projectedCount).toBe(0);
    expect(p!.remainingCount).toBe(0);
  });

  it('separa compras iguais pela data da compra e soma por mês', () => {
    const a = tx(1, 2, '2026-11', { purchaseDate: '2026-11-02', id: 'a' });
    const b = tx(1, 2, '2026-11', { purchaseDate: '2026-11-20', id: 'b' });
    const purchases = buildPurchases([a, b], C);
    expect(purchases).toHaveLength(2);
    expect(installmentsByMonth(purchases, ['2026-11', '2026-12'])).toEqual([
      { month: '2026-11', realCents: 20000, projectedCents: 0 },
      { month: '2026-12', realCents: 0, projectedCents: 20000 },
    ]);
  });

  it('1ª parcela com centavos de arredondamento continua sendo a mesma compra (caso real)', () => {
    // Banco real: 1/6 = 643,35 e as demais 643,33, todas já lançadas. Não pode virar 2 compras nem prever nada.
    const rows = [1, 2, 3, 4, 5, 6].map((n) =>
      tx(n, 6, addMonths('2026-09', n), { description: `Hopevet Internacoes ${n}/6`, amountCents: n === 1 ? -64335 : -64333, purchaseDate: '2026-09-28' }),
    );
    const purchases = buildPurchases(rows, C);
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ projectedCount: 0, installmentCents: 64333 });
    // nov a mar = parcelas 2..6 (a 1ª foi em out)
    expect(purchases[0]!.remainingCents).toBe(5 * 64333);
  });

  it('sem a data da compra, ainda junta valores que diferem só nos centavos', () => {
    const purchases = buildPurchases([tx(1, 3, '2026-10', { amountCents: -10002 }), tx(2, 3, '2026-11', { amountCents: -10000 })], C);
    expect(purchases).toHaveLength(1);
    expect(purchases[0]!.installments.map((i) => [i.n, i.amountCents, i.real])).toEqual([
      [1, 10002, true],
      [2, 10000, true],
      [3, 10000, false],
    ]);
  });

  it('identifica a compra pela descrição sem o "n/N"', () => {
    expect(descriptionStem('Hopevet Internacoes 6/6')).toBe('Hopevet Internacoes');
    expect(descriptionStem('LOJA PARCELA 3 DE 10')).toBe('LOJA');
  });
});

describe('rendas e fixos', () => {
  const salary: PlanEntryLike = { kind: 'income', amountCents: 1_000_000, frequency: 'monthly', monthOfYear: null, startMonth: '2026-01', endMonth: '2027-01' };
  const thirteenth: PlanEntryLike = { kind: 'income', amountCents: 1_000_000, frequency: 'yearly', monthOfYear: 12, startMonth: '2026-01', endMonth: null };
  const bonus: PlanEntryLike = { kind: 'income', amountCents: 500_000, frequency: 'once', monthOfYear: null, startMonth: '2027-03', endMonth: null };

  it('mensal respeita início e fim; anual cai no mês certo; única só uma vez', () => {
    expect(occursIn(salary, '2026-12')).toBe(true);
    expect(occursIn(salary, '2027-02')).toBe(false);
    expect(occursIn(thirteenth, '2026-12')).toBe(true);
    expect(occursIn(thirteenth, '2027-01')).toBe(false);
    expect(occursIn(bonus, '2027-03')).toBe(true);
    expect(occursIn(bonus, '2027-04')).toBe(false);
  });
});

describe('projeção', () => {
  const base = {
    months: monthRange(C, 6),
    current: C,
    entries: [
      { kind: 'income', amountCents: 1_000_000, frequency: 'monthly', monthOfYear: null, startMonth: '2026-01', endMonth: null },
      { kind: 'expense', amountCents: 300_000, frequency: 'monthly', monthOfYear: null, startMonth: '2026-01', endMonth: null },
    ] as PlanEntryLike[],
    purchases: buildPurchases([tx(1, 3, '2026-11', { amountCents: -100_000 })], C), // R$ 1.000 em nov, dez, jan
    variableCents: 200_000,
    goals: [{ targetCents: 1_200_000, savedCents: 0, targetMonth: '2027-04' }], // R$ 12 mil em 6 meses = R$ 2 mil/mês
    startBalanceCents: 500_000,
    commitLimitPct: 30,
  };

  it('distribui a renda entre fixos, parcelas, variável e metas', () => {
    const [nov, , , feb] = project(base);
    expect(nov).toMatchObject({ incomeCents: 1_000_000, fixedCents: 300_000, installmentsCents: 100_000, variableCents: 200_000, goalsCents: 200_000, freeCents: 200_000, commitPct: 40, status: 'high', balanceCents: 700_000 });
    expect(feb).toMatchObject({ installmentsCents: 0, freeCents: 300_000, commitPct: 30, status: 'ok' });
  });

  it('meta: quanto guardar por mês até a data', () => {
    expect(monthlyNeed({ targetCents: 1_200_000, savedCents: 200_000, targetMonth: '2027-04' }, C)).toBe(166_667);
    expect(monthlyNeed({ targetCents: 100, savedCents: 200, targetMonth: '2027-04' }, C)).toBe(0);
  });

  it('simulador: diz se cabe e sugere quando ou em quantas vezes cabe', () => {
    const generous = { ...base, commitLimitPct: 60 };
    expect(evaluateSimulation({ ...generous, simulation: { amountCents: 300_000, installments: 3, startMonth: C } }).fits).toBe(true);

    // R$ 6 mil em 2x estoura (sobra só R$ 2 mil/mês); começar depois das parcelas atuais ou parcelar mais resolve.
    const v = evaluateSimulation({ ...generous, simulation: { amountCents: 600_000, installments: 2, startMonth: C } });
    expect(v.fits).toBe(false);
    expect(v.worstFreeCents).toBeLessThan(0);
    expect(v.suggestedInstallments).toBeGreaterThan(2);
    const after = evaluateSimulation({ ...generous, simulation: { amountCents: 600_000, installments: v.suggestedInstallments!, startMonth: C } });
    expect(after.fits).toBe(true);
    expect(v.alreadyTightMonths).toBe(0);
  });

  it('simulador avisa quando o orçamento já está no vermelho sem a compra', () => {
    const tight = { ...base, variableCents: 600_000 }; // sobra negativa em todos os meses
    const v = evaluateSimulation({ ...tight, simulation: { amountCents: 10_000, installments: 2, startMonth: C } });
    expect(v.fits).toBe(false);
    expect(v.alreadyTightMonths).toBe(2);
  });
});

describe('sugestões de recorrência', () => {
  const months = ['2026-07', '2026-08', '2026-09', '2026-10'];
  it('acha salário e aluguel; ignora gasto irregular', () => {
    const txs = [
      ...months.map((m, i) => ({ description: `SALARIO EMPRESA ${i}`, amountCents: 800_000 + i * 1000, referenceMonth: m, date: `${m}-05` })),
      ...months.map((m) => ({ description: 'PIX ENVIADO|IMOBILIARIA SOL', amountCents: -250_000, referenceMonth: m, date: `${m}-10` })),
      ...months.map((m, i) => ({ description: 'MERCADO DIA', amountCents: -(10_000 + i * 40_000), referenceMonth: m, date: `${m}-12` })),
    ];
    const s = detectRecurring(txs, months);
    expect(s.map((x) => [x.kind, x.name, x.dayOfMonth])).toEqual([
      ['income', 'Salario empresa', 5],
      ['expense', 'Pix enviado imobiliaria sol', 10],
    ]);
  });
});
