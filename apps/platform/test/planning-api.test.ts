import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { addMonths, currentMonth } from '../../../packages/finance/src/planning';
import { type Session, api, invite, json, ownerWith2fa, signUp } from './helpers';

/** Ana (dona) e Bia (membro). Ana tem um cartão privado e um compartilhado, cada um com uma compra parcelada. */
let ana: Session;
let bia: Session;
const C = currentMonth();
const NOW = '2026-11-01T00:00:00Z';

async function seedCard(id: string, owner: string, visibility: 'private' | 'family', total = 6) {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO fin_items (id, household_id, owner_user_id, pluggy_item_id, created_at) VALUES (?, ?, ?, ?, ?)`).bind(`item-${id}`, ana.household!, owner, `p-${id}`, NOW),
    env.DB.prepare(
      `INSERT INTO fin_accounts (id, item_id, household_id, owner_user_id, type, name, visibility, balance_cents, credit_limit_cents, available_limit_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'CREDIT', ?, ?, 50000, 1000000, 400000, ?, ?)`,
    ).bind(id, `item-${id}`, ana.household!, owner, `Cartão ${id}`, visibility, NOW, NOW),
    // Só a parcela 2 de N lançada no mês atual: o app deve prever as próximas.
    env.DB.prepare(
      `INSERT INTO fin_transactions (id, account_id, household_id, description, amount_cents, date, reference_month, category, installment, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, -20000, ?, ?, 'Casa', ?, 'Alta', ?, ?)`,
    ).bind(`tx-${id}`, id, ana.household!, `Compra ${id} 2/${total}`, `${C}-05`, C, `Parcela 2/${total}`, NOW, NOW),
    env.DB.prepare(`INSERT INTO fin_bills (id, account_id, household_id, due_date, total_cents, updated_at) VALUES (?, ?, ?, ?, 50000, ?)`).bind(`bill-${id}`, id, ana.household!, `${C}-15`, NOW),
  ]);
}

beforeEach(async () => {
  ana = await ownerWith2fa();
  await invite(ana, 'bia@teste.local');
  bia = await signUp('bia@teste.local', 'Bia Membro');
  await seedCard('PRIV', ana.userId, 'private');
  await seedCard('FAM', ana.userId, 'family', 4);
});

const entry = (over: Record<string, unknown> = {}) => ({ kind: 'income', name: 'Salário', amountCents: 1_000_000, frequency: 'monthly', startMonth: C, visibility: 'private', ...over });

describe('parcelas e faturas', () => {
  it('prevê as parcelas não lançadas e respeita a privacidade do cartão', async () => {
    const anaView = await json(await api('/api/finance/installments', { session: ana }));
    expect(anaView.totals).toMatchObject({ activePurchases: 2, remainingCount: 5 + 3, remainingCents: (5 + 3) * 20000, projectedCents: (4 + 2) * 20000 });
    expect(anaView.timeline[1]).toEqual({ month: addMonths(C, 1), realCents: 0, projectedCents: 40000 });

    const biaView = await json(await api('/api/finance/installments', { session: bia }));
    expect(biaView.purchases.map((p: { accountId: string }) => p.accountId)).toEqual(['FAM']);
  });

  it('faturas só de conta visível', async () => {
    expect((await json(await api('/api/finance/accounts/FAM/bills', { session: bia })))[0]).toMatchObject({ dueDate: `${C}-15`, totalCents: 50000 });
    expect((await api('/api/finance/accounts/PRIV/bills', { session: bia })).status).toBe(404);
  });

  it('contas trazem limite e valor em aberto', async () => {
    const accounts = await json(await api('/api/finance/accounts', { session: ana }));
    expect(accounts.find((a: { id: string }) => a.id === 'FAM')).toMatchObject({ creditLimitCents: 1000000, availableLimitCents: 400000, balanceCents: 50000 });
  });
});

describe('rendas e gastos fixos', () => {
  it('privado só para o dono; da família, todos veem mas só o dono edita', async () => {
    await api('/api/finance/plan/entries', { method: 'POST', session: ana, body: entry({ name: 'Salário Ana' }) });
    const fam = await json(await api('/api/finance/plan/entries', { method: 'POST', session: ana, body: entry({ kind: 'expense', name: 'Aluguel', amountCents: 300_000, visibility: 'family' }) }));

    const biaList = await json(await api('/api/finance/plan/entries', { session: bia }));
    expect(biaList.map((e: { name: string; editable: boolean }) => [e.name, e.editable])).toEqual([['Aluguel', false]]);
    expect((await api(`/api/finance/plan/entries/${fam.id}`, { method: 'PATCH', session: bia, body: { amountCents: 1 } })).status).toBe(404);
    expect((await api(`/api/finance/plan/entries/${fam.id}`, { method: 'DELETE', session: bia })).status).toBe(404);
  });

  it('valida as datas e campos', async () => {
    const bad = await api('/api/finance/plan/entries', { method: 'POST', session: ana, body: entry({ startMonth: addMonths(C, 2), endMonth: C }) });
    expect(bad.status).toBe(400);
    const extra = await api('/api/finance/plan/entries', { method: 'POST', session: ana, body: { ...entry(), household_id: 'x' } });
    expect(extra.status).toBe(400);
  });
});

describe('projeção', () => {
  it('família usa só o compartilhado; "minha" usa o que é meu', async () => {
    await api('/api/finance/plan/entries', { method: 'POST', session: ana, body: entry({ name: 'Salário Ana', visibility: 'private' }) });
    await api('/api/finance/plan/entries', { method: 'POST', session: bia, body: entry({ name: 'Salário Bia', amountCents: 500_000, visibility: 'family' }) });

    const family = await json(await api('/api/finance/plan/projection?scope=family&months=6', { session: ana }));
    expect(family.months[0].incomeCents).toBe(500_000); // só o salário compartilhado
    expect(family.months[1].installmentsCents).toBe(20000); // só o cartão compartilhado

    const mine = await json(await api('/api/finance/plan/projection?scope=mine&months=6', { session: ana }));
    expect(mine.months[0].incomeCents).toBe(1_000_000);
    expect(mine.months[1].installmentsCents).toBe(40000); // os dois cartões da Ana

    // A visão da família é a mesma para a Bia (nada privado da Ana aparece).
    const biaFamily = await json(await api('/api/finance/plan/projection?scope=family&months=6', { session: bia }));
    expect(biaFamily.months[0].incomeCents).toBe(500_000);
  });

  it('simulação devolve veredito', async () => {
    await api('/api/finance/plan/entries', { method: 'POST', session: ana, body: entry({ visibility: 'family' }) });
    const res = await json(await api(`/api/finance/plan/projection?scope=family&simAmount=100000&simInstallments=2&simStart=${C}`, { session: ana }));
    expect(res.simulation.verdict.fits).toBe(true);
    expect(res.months[0].simulatedCents).toBe(50000);
    const huge = await json(await api(`/api/finance/plan/projection?scope=family&simAmount=90000000&simInstallments=2&simStart=${C}`, { session: ana }));
    expect(huge.simulation.verdict.fits).toBe(false);
  });

  it('parâmetros da família: só dono/admin altera', async () => {
    expect((await api('/api/finance/plan/settings', { method: 'PATCH', session: bia, body: { commitLimitPct: 50 } })).status).toBe(403);
    expect((await api('/api/finance/plan/settings', { method: 'PATCH', session: ana, body: { commitLimitPct: 40, variableOverrideCents: 123400 } })).status).toBe(200);
    const p = await json(await api('/api/finance/plan/projection?scope=family', { session: bia }));
    expect(p).toMatchObject({ commitLimitPct: 40, variableCents: 123400, variableSource: 'manual' });
  });
});

describe('metas', () => {
  it('meta da família: todos aportam, só o dono edita; privada é invisível', async () => {
    const trip = await json(await api('/api/finance/goals', { method: 'POST', session: ana, body: { kind: 'trip', name: 'Viagem', targetCents: 1_200_000, targetMonth: addMonths(C, 5), visibility: 'family' } }));
    const secret = await json(await api('/api/finance/goals', { method: 'POST', session: ana, body: { kind: 'purchase', name: 'Presente', targetCents: 50_000, targetMonth: addMonths(C, 1), visibility: 'private' } }));

    expect((await api(`/api/finance/goals/${trip.id}/contributions`, { method: 'POST', session: bia, body: { amountCents: 200_000 } })).status).toBe(201);
    expect((await api(`/api/finance/goals/${trip.id}`, { method: 'PATCH', session: bia, body: { targetCents: 1 } })).status).toBe(404);
    expect((await api(`/api/finance/goals/${trip.id}/items`, { method: 'POST', session: bia, body: { name: 'Hotel', amountCents: 1 } })).status).toBe(404);
    expect((await api(`/api/finance/goals/${secret.id}/contributions`, { method: 'POST', session: bia, body: { amountCents: 100 } })).status).toBe(404);

    await api(`/api/finance/goals/${trip.id}/items`, { method: 'POST', session: ana, body: { name: 'Passagens', amountCents: 600_000 } });
    const list = await json(await api('/api/finance/goals', { session: bia }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Viagem', savedCents: 200_000, monthlyNeedCents: 166_667, editable: false });
    expect(list[0].items).toEqual([expect.objectContaining({ name: 'Passagens', amountCents: 600_000 })]);

    // A meta entra na projeção da família como valor a guardar por mês.
    const p = await json(await api('/api/finance/plan/projection?scope=family', { session: ana }));
    expect(p.months[0].goalsCents).toBe(166_667);
    expect(p.months[6].goalsCents).toBe(0);
  });

  it('quem sai da família leva rendas e metas junto', async () => {
    await api('/api/finance/plan/entries', { method: 'POST', session: bia, body: entry({ visibility: 'family' }) });
    await api('/api/finance/goals', { method: 'POST', session: bia, body: { kind: 'reserve', name: 'Reserva', targetCents: 100_000, targetMonth: addMonths(C, 3) } });
    await api(`/api/household/members/${bia.userId}`, { method: 'DELETE', session: ana });
    const left = await env.DB.prepare(`SELECT (SELECT count(*) FROM plan_entries) AS e, (SELECT count(*) FROM goals) AS g`).first();
    expect(left).toEqual({ e: 0, g: 0 });
  });
});
