// Cálculos de planejamento: funções puras (sem banco), usadas pelo Worker e testadas isoladamente.

// ---------- Meses (AAAA-MM) ----------

/** Mês atual no fuso de Brasília. */
export function currentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}

export function addMonths(ym: string, k: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + k;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Quantos meses de `a` até `b` (b − a). */
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return yb * 12 + mb - (ya * 12 + ma);
}

export const monthRange = (start: string, count: number) => Array.from({ length: count }, (_, i) => addMonths(start, i));

// ---------- Parcelas ----------

export interface InstallmentTx {
  id: string;
  accountId: string;
  accountLabel: string;
  cardLast4: string | null;
  ownerUserId: string;
  ownerName: string;
  spenderName: string;
  description: string;
  amountCents: number; // negativo (despesa)
  referenceMonth: string;
  installment: string; // "Parcela n/N"
  purchaseDate: string | null;
}

export interface PlannedInstallment {
  n: number;
  month: string;
  amountCents: number; // positivo
  /** false = prevista pelo app (o banco ainda não lançou). */
  real: boolean;
}

export interface Purchase {
  key: string;
  description: string;
  accountId: string;
  accountLabel: string;
  cardLast4: string | null;
  ownerUserId: string;
  ownerName: string;
  spenderName: string;
  installmentCents: number; // positivo
  totalInstallments: number;
  installments: PlannedInstallment[];
  firstMonth: string;
  endMonth: string;
  /** Parcelas a partir do mês atual (inclusive). */
  remainingCount: number;
  remainingCents: number;
  projectedCount: number;
}

export const parseInstallment = (s: string): { n: number; total: number } | null => {
  const m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const total = Number(m[2]);
  return n >= 1 && total >= 2 && n <= total ? { n, total } : null;
};

/** Descrição sem o "3/6" / "PARCELA 3 DE 6" do fim: identifica a compra. */
export const descriptionStem = (d: string) =>
  d
    .replace(/\s*(?:parcela\s*)?\d{1,2}\s*(?:de|\/)\s*\d{1,2}\s*$/i, '')
    .trim();

/** Só projeta parcelas de compras com lançamento recente (evita "ressuscitar" compra antiga/cancelada). */
const STALE_AFTER_MONTHS = 2;

/**
 * Agrupa as parcelas por compra e completa as que o banco ainda não lançou.
 * Muitos bancos só lançam a parcela do mês; o resto da compra vira "prevista" (n+1 … N, um mês por vez).
 */
export function buildPurchases(rows: InstallmentTx[], current: string): Purchase[] {
  const groups = new Map<string, { rows: (InstallmentTx & { n: number; total: number })[] }>();
  for (const r of rows) {
    const p = parseInstallment(r.installment);
    if (!p || r.amountCents >= 0) continue;
    const stem = descriptionStem(r.description).toUpperCase();
    // Com a data da compra, o valor não entra na chave: a 1ª parcela costuma levar os centavos do
    // arredondamento (ex.: 643,35 e depois 643,33). Sem a data, usa o valor em reais inteiros.
    const key = r.purchaseDate
      ? [r.accountId, r.purchaseDate, stem, p.total].join('|')
      : [r.accountId, '', stem, p.total, Math.round(Math.abs(r.amountCents) / 100)].join('|');
    const g = groups.get(key) ?? { rows: [] };
    g.rows.push({ ...r, ...p });
    groups.set(key, g);
  }

  const purchases: Purchase[] = [];
  for (const [key, g] of groups) {
    const byN = new Map<number, { month: string; amountCents: number }>();
    for (const r of g.rows) if (!byN.has(r.n)) byN.set(r.n, { month: r.referenceMonth, amountCents: Math.abs(r.amountCents) });
    const last = g.rows.reduce((a, b) => (b.n > a.n ? b : a));
    const total = last.total;
    const cents = Math.abs(last.amountCents);
    const installments: PlannedInstallment[] = [...byN.entries()].map(([n, v]) => ({ n, month: v.month, amountCents: v.amountCents, real: true }));
    const lastMonth = byN.get(last.n)!.month;
    if (last.n < total && monthDiff(lastMonth, current) <= STALE_AFTER_MONTHS) {
      for (let n = last.n + 1; n <= total; n++) {
        if (!byN.has(n)) installments.push({ n, month: addMonths(lastMonth, n - last.n), amountCents: cents, real: false });
      }
    }
    installments.sort((a, b) => a.n - b.n);
    const upcoming = installments.filter((i) => i.month >= current);
    purchases.push({
      key,
      description: descriptionStem(last.description) || last.description,
      accountId: last.accountId,
      accountLabel: last.accountLabel,
      cardLast4: last.cardLast4,
      ownerUserId: last.ownerUserId,
      ownerName: last.ownerName,
      spenderName: last.spenderName,
      installmentCents: cents,
      totalInstallments: total,
      installments,
      firstMonth: installments[0]!.month,
      endMonth: installments.at(-1)!.month,
      remainingCount: upcoming.length,
      remainingCents: upcoming.reduce((a, i) => a + i.amountCents, 0),
      projectedCount: installments.filter((i) => !i.real).length,
    });
  }
  return purchases.sort((a, b) => b.endMonth.localeCompare(a.endMonth) || b.remainingCents - a.remainingCents);
}

/** Total de parcelas por mês, separando lançadas pelo banco e previstas pelo app. */
export function installmentsByMonth(purchases: Purchase[], months: string[]) {
  const map = new Map(months.map((m) => [m, { month: m, realCents: 0, projectedCents: 0 }]));
  for (const p of purchases) {
    for (const i of p.installments) {
      const slot = map.get(i.month);
      if (!slot) continue;
      if (i.real) slot.realCents += i.amountCents;
      else slot.projectedCents += i.amountCents;
    }
  }
  return [...map.values()];
}

// ---------- Rendas e gastos fixos ----------

export type Frequency = 'monthly' | 'yearly' | 'once';

export interface PlanEntryLike {
  kind: 'income' | 'expense';
  amountCents: number;
  frequency: Frequency;
  monthOfYear: number | null;
  startMonth: string;
  endMonth: string | null;
}

export function occursIn(e: PlanEntryLike, month: string): boolean {
  if (month < e.startMonth) return false;
  if (e.frequency === 'once') return month === e.startMonth;
  if (e.endMonth && month > e.endMonth) return false;
  if (e.frequency === 'yearly') return Number(month.slice(5, 7)) === (e.monthOfYear ?? Number(e.startMonth.slice(5, 7)));
  return true;
}

// ---------- Metas ----------

export interface GoalLike {
  targetCents: number;
  savedCents: number;
  targetMonth: string;
}

/** Quanto guardar por mês, do mês atual até o mês da meta (inclusive). */
export function monthlyNeed(g: GoalLike, current: string): number {
  const remaining = g.targetCents - g.savedCents;
  if (remaining <= 0) return 0;
  const months = Math.max(1, monthDiff(current, g.targetMonth) + 1);
  return Math.ceil(remaining / months);
}

// ---------- Projeção ----------

export type MonthStatus = 'ok' | 'high' | 'deficit';

export interface ProjectionMonth {
  month: string;
  incomeCents: number;
  fixedCents: number;
  installmentsCents: number;
  /** Parte das parcelas que é previsão do app (o banco ainda não lançou). */
  projectedInstallmentsCents: number;
  simulatedCents: number;
  variableCents: number;
  goalsCents: number;
  freeCents: number;
  /** (fixos + parcelas + simulação) / renda, em %. null sem renda cadastrada. */
  commitPct: number | null;
  status: MonthStatus;
  balanceCents: number;
}

export interface ProjectionInput {
  months: string[];
  current: string;
  entries: PlanEntryLike[];
  purchases: Purchase[];
  variableCents: number;
  goals: GoalLike[];
  startBalanceCents: number;
  commitLimitPct: number;
  simulation?: Simulation | null;
}

export interface Simulation {
  amountCents: number;
  installments: number;
  startMonth: string;
}

/** Valor de cada parcela simulada (centavos que sobram vão na primeira). */
export function simulatedInstallments(sim: Simulation): Map<string, number> {
  const base = Math.floor(sim.amountCents / sim.installments);
  const rest = sim.amountCents - base * sim.installments;
  return new Map(monthRange(sim.startMonth, sim.installments).map((m, i) => [m, base + (i === 0 ? rest : 0)]));
}

export function project(input: ProjectionInput): ProjectionMonth[] {
  const inst = installmentsByMonth(input.purchases, input.months);
  const sim = input.simulation ? simulatedInstallments(input.simulation) : new Map<string, number>();
  let balance = input.startBalanceCents;
  return input.months.map((month, i) => {
    const incomeCents = input.entries.filter((e) => e.kind === 'income' && occursIn(e, month)).reduce((a, e) => a + e.amountCents, 0);
    const fixedCents = input.entries.filter((e) => e.kind === 'expense' && occursIn(e, month)).reduce((a, e) => a + e.amountCents, 0);
    const installmentsCents = inst[i]!.realCents + inst[i]!.projectedCents;
    const simulatedCents = sim.get(month) ?? 0;
    const goalsCents = input.goals.filter((g) => month <= g.targetMonth).reduce((a, g) => a + monthlyNeed(g, input.current), 0);
    const freeCents = incomeCents - fixedCents - installmentsCents - simulatedCents - input.variableCents - goalsCents;
    const commitPct = incomeCents > 0 ? Math.round(((fixedCents + installmentsCents + simulatedCents) / incomeCents) * 1000) / 10 : null;
    balance += freeCents;
    const status: MonthStatus = freeCents < 0 ? 'deficit' : commitPct !== null && commitPct > input.commitLimitPct ? 'high' : 'ok';
    return {
      month,
      incomeCents,
      fixedCents,
      installmentsCents,
      projectedInstallmentsCents: inst[i]!.projectedCents,
      simulatedCents,
      variableCents: input.variableCents,
      goalsCents,
      freeCents,
      commitPct,
      status,
      balanceCents: balance,
    };
  });
}

export interface SimulationVerdict {
  fits: boolean;
  /** Pior mês dentro do período da compra. */
  worstMonth: string | null;
  worstFreeCents: number | null;
  maxCommitPct: number | null;
  /** Se não couber: primeiro mês (nos próximos 12) em que a mesma compra cabe. */
  suggestedStartMonth: string | null;
  /** Se não couber: menor número de parcelas (até 24) que cabe começando no mês pedido. */
  suggestedInstallments: number | null;
  /** Meses do período da compra que já ficam no vermelho (ou acima do limite) mesmo SEM a compra. */
  alreadyTightMonths: number;
}

const fitsIn = (months: ProjectionMonth[], sim: Simulation, limitPct: number) => {
  const affected = months.filter((m) => m.month >= sim.startMonth && m.month < addMonths(sim.startMonth, sim.installments));
  return affected.every((m) => m.freeCents >= 0 && (m.commitPct === null || m.commitPct <= limitPct));
};

export function evaluateSimulation(input: ProjectionInput & { simulation: Simulation }): SimulationVerdict {
  const sim = input.simulation;
  // Horizonte suficiente para cobrir a compra inteira.
  const horizon = Math.max(input.months.length, monthDiff(input.months[0]!, sim.startMonth) + 24 + 12);
  const months = monthRange(input.months[0]!, horizon);
  const run = (s: Simulation) => project({ ...input, months, simulation: s });

  const result = run(sim);
  const affected = result.filter((m) => m.month >= sim.startMonth && m.month < addMonths(sim.startMonth, sim.installments));
  const worst = affected.reduce<ProjectionMonth | null>((a, m) => (!a || m.freeCents < a.freeCents ? m : a), null);
  const pcts = affected.map((m) => m.commitPct).filter((x): x is number => x !== null);
  const fits = fitsIn(result, sim, input.commitLimitPct);

  const baseline = project({ ...input, months, simulation: null });
  const inWindow = (m: ProjectionMonth) => m.month >= sim.startMonth && m.month < addMonths(sim.startMonth, sim.installments);
  const alreadyTightMonths = baseline.filter((m) => inWindow(m) && (m.freeCents < 0 || (m.commitPct !== null && m.commitPct > input.commitLimitPct))).length;

  let suggestedStartMonth: string | null = null;
  let suggestedInstallments: number | null = null;
  if (!fits) {
    for (let k = 1; k <= 12 && !suggestedStartMonth; k++) {
      const s = { ...sim, startMonth: addMonths(sim.startMonth, k) };
      if (fitsIn(run(s), s, input.commitLimitPct)) suggestedStartMonth = s.startMonth;
    }
    for (let n = sim.installments + 1; n <= 24 && !suggestedInstallments; n++) {
      const s = { ...sim, installments: n };
      if (fitsIn(run(s), s, input.commitLimitPct)) suggestedInstallments = n;
    }
  }
  return {
    fits,
    worstMonth: worst?.month ?? null,
    worstFreeCents: worst?.freeCents ?? null,
    maxCommitPct: pcts.length ? Math.max(...pcts) : null,
    suggestedStartMonth,
    suggestedInstallments,
    alreadyTightMonths,
  };
}

// ---------- Sugestões de rendas e fixos (recorrências nas contas) ----------

export interface RecurringCandidateTx {
  description: string;
  amountCents: number;
  referenceMonth: string;
  date: string;
}

export interface RecurringSuggestion {
  kind: 'income' | 'expense';
  name: string;
  amountCents: number;
  monthsSeen: number;
  dayOfMonth: number;
}

const recurringKey = (d: string) =>
  d
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .toUpperCase()
    .replace(/[0-9]/g, ' ')
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 4)
    .join(' ');

/** Lançamentos que se repetem em pelo menos 3 dos `months` com valor parecido (variação ≤ 25%). */
export function detectRecurring(txs: RecurringCandidateTx[], months: string[], minMonths = 3): RecurringSuggestion[] {
  const set = new Set(months);
  const groups = new Map<string, { kind: 'income' | 'expense'; perMonth: Map<string, number>; days: number[]; label: string }>();
  for (const t of txs) {
    if (!set.has(t.referenceMonth) || t.amountCents === 0) continue;
    const key = recurringKey(t.description);
    if (!key) continue;
    const kind = t.amountCents > 0 ? 'income' : 'expense';
    const gk = `${kind}|${key}`;
    const g = groups.get(gk) ?? { kind, perMonth: new Map<string, number>(), days: [] as number[], label: key };
    g.perMonth.set(t.referenceMonth, (g.perMonth.get(t.referenceMonth) ?? 0) + Math.abs(t.amountCents));
    g.days.push(Number(t.date.slice(8, 10)));
    groups.set(gk, g);
  }
  const out: RecurringSuggestion[] = [];
  for (const g of groups.values()) {
    const values = [...g.perMonth.values()].sort((a, b) => a - b);
    if (values.length < minMonths) continue;
    const median = values[Math.floor(values.length / 2)]!;
    if ((values.at(-1)! - values[0]!) / median > 0.25) continue;
    const days = [...g.days].sort((a, b) => a - b);
    out.push({
      kind: g.kind,
      name: g.label.charAt(0) + g.label.slice(1).toLowerCase(),
      amountCents: median,
      monthsSeen: values.length,
      dayOfMonth: days[Math.floor(days.length / 2)]!,
    });
  }
  return out.sort((a, b) => b.amountCents - a.amountCents).slice(0, 15);
}
