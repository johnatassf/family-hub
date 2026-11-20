import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Session, api, invite, json, ownerWith2fa, signUp } from './helpers';

/**
 * Família com Ana (dona), Bia (membro) e uma família vizinha com Zé.
 * - A1: conta privada da Ana        - A2: cartão da Ana compartilhado com a família
 * - B1: conta privada da Bia        - Z1: conta privada do Zé (outra família)
 */
let ana: Session;
let bia: Session;

async function seedAccount(id: string, household: string, owner: string, visibility: 'private' | 'family') {
  const now = '2026-11-01T00:00:00Z';
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO fin_items (id, household_id, owner_user_id, pluggy_item_id, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(`item-${id}`, household, owner, `pluggy-${id}`, now),
    env.DB.prepare(
      `INSERT INTO fin_accounts (id, item_id, household_id, owner_user_id, type, name, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'CREDIT', ?, ?, ?, ?)`,
    ).bind(id, `item-${id}`, household, owner, `Cartão ${id}`, visibility, now, now),
    env.DB.prepare(
      `INSERT INTO fin_transactions (id, account_id, household_id, description, amount_cents, date, reference_month, category, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '2026-10-15', '2026-10', 'Outros', 'Baixa', ?, ?)`,
    ).bind(`tx-${id}`, id, household, `Compra em ${id}`, -10000, now, now),
  ]);
}

const descriptions = async (s: Session, query = '') =>
  (await json<{ description: string }[]>(await api(`/api/finance/transactions${query}`, { session: s }))).map((t) => t.description).sort();

beforeEach(async () => {
  ana = await ownerWith2fa();
  await invite(ana, 'bia@teste.local');
  bia = await signUp('bia@teste.local', 'Bia Membro');

  // Família vizinha, criada direto no banco.
  const now = '2026-11-01T00:00:00Z';
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('ze', 'Zé', 'ze@teste.local', 1, ?, ?)`).bind(now, now),
    env.DB.prepare(`INSERT INTO households (id, name, created_at) VALUES ('hh_vizinha', 'Vizinha', ?)`).bind(now),
    env.DB.prepare(`INSERT INTO household_members (household_id, user_id, role, created_at) VALUES ('hh_vizinha', 'ze', 'owner', ?)`).bind(now),
  ]);

  await seedAccount('A1', ana.household!, ana.userId, 'private');
  await seedAccount('A2', ana.household!, ana.userId, 'family');
  await seedAccount('B1', ana.household!, bia.userId, 'private');
  await seedAccount('Z1', 'hh_vizinha', 'ze', 'family');
});

describe('visibilidade das contas', () => {
  it('cada pessoa vê as próprias contas + as compartilhadas da família', async () => {
    expect(await descriptions(bia)).toEqual(['Compra em A2', 'Compra em B1']);
    // Nem a dona da família vê a conta privada da Bia.
    expect(await descriptions(ana)).toEqual(['Compra em A1', 'Compra em A2']);
  });

  it('compartilhar e descompartilhar muda o que a família vê, com auditoria', async () => {
    const share = await api('/api/finance/accounts/A1', { method: 'PATCH', session: ana, body: { visibility: 'family' } });
    expect(share.status).toBe(200);
    expect(await descriptions(bia)).toContain('Compra em A1');

    await api('/api/finance/accounts/A1', { method: 'PATCH', session: ana, body: { visibility: 'private' } });
    expect(await descriptions(bia)).not.toContain('Compra em A1');

    const { results } = await env.DB.prepare(`SELECT action FROM audit_log WHERE target = 'A1' ORDER BY id`).all<{ action: string }>();
    expect(results.map((r) => r.action)).toEqual(['finance.account_shared', 'finance.account_unshared']);
  });

  it('só o dono muda a visibilidade da conta', async () => {
    const res = await api('/api/finance/accounts/A2', { method: 'PATCH', session: bia, body: { visibility: 'private' } });
    expect(res.status).toBe(404);
  });

  it('resumo, contas e CSV respeitam a mesma regra', async () => {
    const accounts = await json<{ id: string }[]>(await api('/api/finance/accounts', { session: bia }));
    expect(accounts.map((a) => a.id).sort()).toEqual(['A2', 'B1']);

    const summary = await json(await api('/api/finance/summary', { session: bia }));
    expect(summary.total).toBe(2);
    expect(summary.months).toEqual([{ month: '2026-10', expensesCents: 20000, incomeCents: 0, netCents: -20000 }]);

    const csv = await (await api('/api/finance/export.csv', { session: bia })).text();
    expect(csv).toContain('Compra em A2');
    expect(csv).not.toContain('Compra em A1');
    expect(csv).not.toContain('Compra em Z1');
  });

  it('filtros de escopo: minhas, família e por pessoa', async () => {
    expect(await descriptions(bia, '?scope=mine')).toEqual(['Compra em B1']);
    expect(await descriptions(bia, '?scope=family')).toEqual(['Compra em A2']);
    // Filtro por pessoa não fura a visibilidade: a conta privada da Ana continua escondida.
    expect(await descriptions(bia, `?member=${ana.userId}`)).toEqual(['Compra em A2']);
  });
});

describe('edição (IDOR)', () => {
  it('ninguém edita transação de conta alheia, nem compartilhada', async () => {
    for (const tx of ['tx-A1', 'tx-A2', 'tx-Z1']) {
      const res = await api(`/api/finance/transactions/${tx}`, { method: 'PATCH', session: bia, body: { category: 'Mercado' } });
      expect(res.status, tx).toBe(404);
    }
    const own = await api('/api/finance/transactions/tx-B1', { method: 'PATCH', session: bia, body: { category: 'Mercado' } });
    expect(own.status).toBe(200);
    const row = await env.DB.prepare(`SELECT category, confidence FROM fin_transactions WHERE id = 'tx-B1'`).first();
    expect(row).toEqual({ category: 'Mercado', confidence: 'Manual' });
  });

  it('valida categoria e mês', async () => {
    const bad = await api('/api/finance/transactions/tx-B1', { method: 'PATCH', session: bia, body: { category: 'Inventada' } });
    expect(bad.status).toBe(400);
    const badMonth = await api('/api/finance/transactions/tx-B1', { method: 'PATCH', session: bia, body: { referenceMonth: '2026-13' } });
    expect(badMonth.status).toBe(400);
    const extra = await api('/api/finance/transactions/tx-B1', { method: 'PATCH', session: bia, body: { household_id: 'hh_vizinha' } });
    expect(extra.status).toBe(400);
  });

  it('cartão compartilhado: dona atribui o gasto a quem usou e o resumo mostra por pessoa', async () => {
    const res = await api('/api/finance/transactions/tx-A2', { method: 'PATCH', session: ana, body: { assignedUserId: bia.userId } });
    expect(res.status).toBe(200);
    const summary = await json(await api('/api/finance/summary', { session: ana }));
    expect(summary.byPerson).toEqual(
      expect.arrayContaining([
        { userId: ana.userId, name: 'Ana Dona', expensesCents: 10000 },
        { userId: bia.userId, name: 'Bia Membro', expensesCents: 10000 },
      ]),
    );
    const outsider = await api('/api/finance/transactions/tx-A2', { method: 'PATCH', session: ana, body: { assignedUserId: 'ze' } });
    expect(outsider.status).toBe(400);
  });
});

describe('membros e conexões', () => {
  it('membro comum não cadastra conexão na fase interna', async () => {
    const res = await api('/api/finance/items', { method: 'POST', session: bia, body: { pluggyItemId: 'abcdef12-3456' } });
    expect(res.status).toBe(403);
  });

  it('dona não vê o itemId nem o erro detalhado da conexão de outra pessoa', async () => {
    await env.DB.prepare(`UPDATE fin_items SET last_error = 'Pluggy HTTP 401 detalhe' WHERE id = 'item-B1'`).run();
    const items = await json<{ id: string; pluggyItemId: string | null; lastError: string | null }[]>(
      await api('/api/finance/items', { session: ana }),
    );
    const b1 = items.find((i) => i.id === 'item-B1')!;
    expect(b1.pluggyItemId).toBeNull();
    expect(b1.lastError).toBe('Erro na última sincronização');
    const own = await json<{ id: string }[]>(await api('/api/finance/items', { session: bia }));
    expect(own.map((i) => i.id)).toEqual(['item-B1']);
  });

  it('quem sai da família leva os dados junto', async () => {
    await api('/api/finance/transactions/tx-A2', { method: 'PATCH', session: ana, body: { assignedUserId: bia.userId } });
    const res = await api(`/api/household/members/${bia.userId}`, { method: 'DELETE', session: ana });
    expect(res.status).toBe(200);
    const left = await env.DB.prepare(`SELECT count(*) AS n FROM fin_accounts WHERE owner_user_id = ?`).bind(bia.userId).first<{ n: number }>();
    expect(left?.n).toBe(0);
    const tx = await env.DB.prepare(`SELECT assigned_user_id FROM fin_transactions WHERE id = 'tx-A2'`).first();
    expect(tx).toEqual({ assigned_user_id: null });
    expect((await api('/api/finance/summary', { session: bia })).status).toBe(403);
  });

  it('família não fica sem dono', async () => {
    const res = await api(`/api/household/members/${ana.userId}`, { method: 'DELETE', session: ana });
    expect(res.status).toBe(409);
  });

  it('membro não convida nem vê auditoria', async () => {
    expect((await api('/api/household/invites', { method: 'POST', session: bia, body: { email: 'x@teste.local' } })).status).toBe(403);
    expect((await api('/api/household/audit', { session: bia })).status).toBe(403);
    expect((await api('/api/household/audit', { session: ana })).status).toBe(200);
  });
});
