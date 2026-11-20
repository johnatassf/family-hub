import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError, type RequestCtx } from '@familia/core';
import { createPluggyClient, financeService, syncItem } from '@familia/finance/server';
import parity from './fixtures/python-parity.json';
import { DEFAULT_RULES, classify, installmentOf, signedCents } from '@familia/finance/server';

// Formato real da Pluggy: no CARTÃO a compra vem POSITIVA com type=DEBIT; na conta, despesa vem negativa.
const tx = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  description: `Compra ${id}`,
  amount: 12.34,
  type: 'DEBIT',
  date: '2026-10-05T03:00:00.000Z',
  status: 'POSTED',
  ...extra,
});

/**
 * Pluggy falsa: 1 conta corrente (1 página) + 1 cartão com 3 páginas ligadas por cursor (histórico inteiro).
 * `created`: o que volta no filtro createdAtFrom, por conta. `byId`: o que volta no filtro ids.
 */
function fakePluggy(
  opts: {
    failAuthOnce?: boolean;
    missingItems?: string[];
    created?: Record<string, unknown[]>;
    byId?: Record<string, unknown>;
    failTransactionsFor?: string;
  } = {},
) {
  const calls: string[] = [];
  let authCount = 0;
  const pages: Record<string, { results: unknown[]; next: string | null }> = {
    'acc-cc|': {
      results: [tx('c1', { description: 'SUPERMERCADO DIA', amount: -12.34 }), tx('c2', { description: 'Pagamento recebido cliente', amount: 50, type: 'CREDIT' })],
      next: null,
    },
    'acc-card|': {
      results: [tx('k1', { description: 'NETFLIX.COM', creditCardMetadata: { installmentNumber: 2, totalInstallments: 6, cardNumber: '**** 9876', billId: 'b1', purchaseDate: '2026-09-03T12:00:00.000Z' } })],
      next: '?accountId=acc-card&after=cur1',
    },
    'acc-card|cur1': {
      results: [tx('k2'), tx('k3', { description: 'Pagamento recebido', amount: -500, type: 'CREDIT', operationType: 'PAGAMENTO_FATURA' })],
      next: '?accountId=acc-card&after=cur2',
    },
    'acc-card|cur2': { results: [tx('k4', { description: 'Loja PARCELA 3 DE 10' })], next: null },
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${decodeURIComponent(url.search)}`);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.pathname === '/auth') {
      authCount++;
      return ok({ apiKey: `key-${authCount}` });
    }
    const key = new Headers(init?.headers).get('X-API-KEY');
    if (opts.failAuthOnce && key === 'key-1') return new Response('{"message":"expired"}', { status: 401 });
    if (url.pathname.startsWith('/items/')) {
      const id = url.pathname.split('/')[2]!;
      if (opts.missingItems?.includes(id)) return new Response('{"message":"item not found","code":404}', { status: 404 });
      return ok({ id, status: 'UPDATED', connector: { name: 'MeuPluggy' } });
    }
    if (url.pathname === '/accounts') {
      return ok({
        results: [
          { id: 'acc-cc', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta', balance: 1520.5 },
          {
            id: 'acc-card', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Cartão', balance: 870.1,
            creditData: { creditLimit: 5000, availableCreditLimit: 4129.9, balanceDueDate: '2026-11-12T03:00:00.000Z', minimumPayment: 130.52 },
          },
        ],
        totalPages: 1,
      });
    }
    if (url.pathname === '/bills') {
      if (url.searchParams.get('accountId') !== 'acc-card') return new Response('{"message":"conta sem fatura"}', { status: 400 });
      return ok({ results: [{ id: 'bill-1', dueDate: '2026-11-12T03:00:00.000Z', billClosingDate: '2026-11-05T03:00:00.000Z', totalAmount: 870.1, minimumPaymentAmount: 130.52 }], totalPages: 1 });
    }
    if (url.pathname === '/v2/transactions') {
      if (url.searchParams.has('pageSize')) return new Response('{"message":"property pageSize should not exist"}', { status: 400 });
      const accountId = url.searchParams.get('accountId') ?? '';
      if (accountId === opts.failTransactionsFor) return new Response('{"message":"instabilidade"}', { status: 503 });
      if (url.searchParams.has('createdAtFrom')) return ok({ results: opts.created?.[accountId] ?? [], next: null });
      const ids = url.searchParams.get('ids');
      if (ids) return ok({ results: ids.split(',').flatMap((id) => (opts.byId?.[id] ? [opts.byId[id]] : [])), next: null });
      const page = pages[`${accountId}|${url.searchParams.get('after') ?? ''}`];
      return page ? ok(page) : new Response('{}', { status: 404 });
    }
    return new Response('{"message":"not mocked"}', { status: 500 });
  }) as typeof fetch;
  return { client: createPluggyClient({ clientId: 'id', clientSecret: 'secret', fetch: fetchImpl }), calls };
}

const NOW = '2026-11-01T00:00:00Z';
const item = { id: 'item-1', household_id: 'hh_1', owner_user_id: 'u1', pluggy_item_id: 'pluggy-1' };

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u1', 'Ana', 'ana@teste.local', 1, ?, ?)`).bind(NOW, NOW),
    env.DB.prepare(`INSERT INTO households (id, name, created_at) VALUES ('hh_1', 'Família', ?)`).bind(NOW),
    env.DB.prepare(`INSERT INTO household_members (household_id, user_id, role, created_at) VALUES ('hh_1', 'u1', 'owner', ?)`).bind(NOW),
    env.DB.prepare(`INSERT INTO fin_items (id, household_id, owner_user_id, pluggy_item_id, created_at) VALUES ('item-1', 'hh_1', 'u1', 'pluggy-1', ?)`).bind(NOW),
  ]);
});

const unlock = () => env.DB.prepare(`UPDATE fin_items SET last_sync_started_at = NULL`).run();

describe('sincronização Pluggy', () => {
  it('pagina o /v2/transactions pelo cursor, sem duplicar e sem pageSize', async () => {
    const { client, calls } = fakePluggy();
    const result = await syncItem(env.DB, client, item, 'manual');
    expect(result).toEqual({ itemId: 'item-1', processed: 6, accounts: 2, full: true });
    expect(calls.filter((c) => c.includes('/v2/transactions'))).toEqual([
      'GET /v2/transactions?accountId=acc-cc',
      'GET /v2/transactions?accountId=acc-card',
      'GET /v2/transactions?accountId=acc-card&after=cur1',
      'GET /v2/transactions?accountId=acc-card&after=cur2',
    ]);
    const n = await env.DB.prepare(`SELECT count(*) AS n FROM fin_transactions`).first<{ n: number }>();
    expect(n?.n).toBe(6);

    const k1 = await env.DB.prepare(`SELECT * FROM fin_transactions WHERE id = 'k1'`).first<Record<string, unknown>>();
    expect(k1).toMatchObject({ amount_cents: -1234, date: '2026-10-05', reference_month: '2026-10', category: 'Assinaturas', installment: 'Parcela 2/6', card_last4: '9876', bill_id: 'b1', account_type: 'CREDIT' });
    // Pagamento da fatura do lado do cartão: entrada (+) e excluído do total, como o débito na conta.
    const k3 = await env.DB.prepare(`SELECT category, excluded, amount_cents FROM fin_transactions WHERE id = 'k3'`).first();
    expect(k3).toEqual({ category: 'Transferências', excluded: 1, amount_cents: 50000 });
    // "Pagamento recebido" na conta corrente é receita de verdade: não pode ser excluído.
    const c2 = await env.DB.prepare(`SELECT excluded, amount_cents FROM fin_transactions WHERE id = 'c2'`).first();
    expect(c2).toEqual({ excluded: 0, amount_cents: 5000 });
    const c1 = await env.DB.prepare(`SELECT amount_cents FROM fin_transactions WHERE id = 'c1'`).first();
    expect(c1).toEqual({ amount_cents: -1234 });
    expect(await env.DB.prepare(`SELECT purchase_date FROM fin_transactions WHERE id = 'k1'`).first()).toEqual({ purchase_date: '2026-09-03' });

    // Cartão: limite, disponível, valor em aberto, vencimento; conta: saldo. Faturas gravadas.
    expect(await env.DB.prepare(`SELECT balance_cents, credit_limit_cents, available_limit_cents, due_date, minimum_payment_cents FROM fin_accounts WHERE id = 'acc-card'`).first()).toEqual({
      balance_cents: 87010, credit_limit_cents: 500000, available_limit_cents: 412990, due_date: '2026-11-12', minimum_payment_cents: 13052,
    });
    expect(await env.DB.prepare(`SELECT balance_cents FROM fin_accounts WHERE id = 'acc-cc'`).first()).toEqual({ balance_cents: 152050 });
    expect(await env.DB.prepare(`SELECT id, due_date, closing_date, total_cents, minimum_cents FROM fin_bills`).all().then((r) => r.results)).toEqual([
      { id: 'bill-1', due_date: '2026-11-12', closing_date: '2026-11-05', total_cents: 87010, minimum_cents: 13052 },
    ]);
    expect(calls.filter((c) => c.startsWith('GET /bills'))).toEqual(['GET /bills?accountId=acc-card&page=1&pageSize=100']);

    const it = await env.DB.prepare(`SELECT connector_name, status, last_sync_at, last_error FROM fin_items WHERE id = 'item-1'`).first<Record<string, unknown>>();
    expect(it).toMatchObject({ connector_name: 'MeuPluggy', status: 'UPDATED', last_error: null });
    expect(it?.last_sync_at).toBeTruthy();
  });

  it('“Buscar tudo” traz o histórico inteiro de novo sem apagar edições manuais nem a visibilidade da conta', async () => {
    const { client, calls } = fakePluggy();
    await syncItem(env.DB, client, item, 'manual');
    await env.DB.batch([
      env.DB.prepare(`UPDATE fin_transactions SET category = 'Lazer', reference_month = '2026-11', excluded = 1, confidence = 'Manual', assigned_user_id = 'u1' WHERE id = 'k2'`),
      env.DB.prepare(`UPDATE fin_accounts SET visibility = 'family', nickname = 'Cartão da casa' WHERE id = 'acc-card'`),
    ]);
    await unlock();
    const again = await syncItem(env.DB, client, item, 'manual', { full: true });
    expect(again).toMatchObject({ processed: 6, full: true });
    expect(calls.filter((c) => c === 'GET /v2/transactions?accountId=acc-card&after=cur2')).toHaveLength(2);
    expect(calls.some((c) => c.includes('createdAtFrom'))).toBe(false);
    expect(await env.DB.prepare(`SELECT category, reference_month, excluded, confidence, assigned_user_id FROM fin_transactions WHERE id = 'k2'`).first()).toEqual({
      category: 'Lazer', reference_month: '2026-11', excluded: 1, confidence: 'Manual', assigned_user_id: 'u1',
    });
    expect(await env.DB.prepare(`SELECT visibility, nickname FROM fin_accounts WHERE id = 'acc-card'`).first()).toEqual({ visibility: 'family', nickname: 'Cartão da casa' });
  });

  it('depois da primeira vez, busca só o que entrou na Pluggy e reconsulta as pendentes pelo id', async () => {
    await syncItem(env.DB, fakePluggy().client, item, 'manual');
    expect(await env.DB.prepare(`SELECT count(*) AS n FROM fin_accounts WHERE tx_synced_at IS NOT NULL`).first()).toEqual({ n: 2 });
    // Ponto de partida fixo (o relógio do Workers só anda depois de I/O).
    const since = '2026-11-10T15:30:45.123Z';
    // k2 e k4 estavam pendentes (fatura aberta); k2 tem edição manual.
    await env.DB.batch([
      env.DB.prepare(`UPDATE fin_accounts SET tx_synced_at = ?`).bind(since),
      env.DB.prepare(`UPDATE fin_transactions SET status = 'PENDING' WHERE id IN ('k2', 'k4')`),
      env.DB.prepare(`UPDATE fin_transactions SET category = 'Lazer', confidence = 'Manual' WHERE id = 'k2'`),
    ]);
    await unlock();

    const { client, calls } = fakePluggy({
      // Lançamento novo com data antiga (só o createdAtFrom pega) + k4, que já vem lançada entre as novas.
      created: { 'acc-card': [tx('k5', { description: 'PADARIA', date: '2026-09-01T03:00:00.000Z' }), tx('k4', { status: 'POSTED' })] },
      byId: { k2: tx('k2', { amount: 20, status: 'POSTED' }) },
    });
    const result = await syncItem(env.DB, client, item, 'manual');
    expect(result).toEqual({ itemId: 'item-1', processed: 3, accounts: 2, full: false });

    // 1 dia de margem, no formato que a Pluggy exige.
    expect(calls.filter((c) => c.includes('/v2/transactions'))).toEqual([
      'GET /v2/transactions?accountId=acc-cc&createdAtFrom=2026-11-09T15:30:45.000Z',
      'GET /v2/transactions?accountId=acc-card&createdAtFrom=2026-11-09T15:30:45.000Z',
      // k4 já veio entre as novas: só k2 é reconsultada.
      'GET /v2/transactions?accountId=acc-card&ids=k2',
    ]);
    expect(await env.DB.prepare(`SELECT count(*) AS n FROM fin_transactions`).first()).toEqual({ n: 7 });
    expect(await env.DB.prepare(`SELECT date FROM fin_transactions WHERE id = 'k5'`).first()).toEqual({ date: '2026-09-01' });
    expect(await env.DB.prepare(`SELECT status, amount_cents, category, confidence FROM fin_transactions WHERE id = 'k2'`).first()).toEqual({
      status: 'POSTED', amount_cents: -2000, category: 'Lazer', confidence: 'Manual',
    });
    expect(await env.DB.prepare(`SELECT status FROM fin_transactions WHERE id = 'k4'`).first()).toEqual({ status: 'POSTED' });
    const after = await env.DB.prepare(`SELECT tx_synced_at FROM fin_accounts WHERE id = 'acc-card'`).first<{ tx_synced_at: string }>();
    expect(after!.tx_synced_at > since).toBe(true);
  });

  it('conta que aparece depois na conexão busca o histórico inteiro só dela', async () => {
    await syncItem(env.DB, fakePluggy().client, item, 'manual');
    await env.DB.prepare(`UPDATE fin_accounts SET tx_synced_at = NULL WHERE id = 'acc-card'`).run();
    await unlock();
    const { client, calls } = fakePluggy();
    expect(await syncItem(env.DB, client, item, 'manual')).toMatchObject({ full: true });
    const txCalls = calls.filter((c) => c.includes('/v2/transactions'));
    expect(txCalls[0]).toMatch(/^GET \/v2\/transactions\?accountId=acc-cc&createdAtFrom=/);
    expect(txCalls.slice(1)).toEqual([
      'GET /v2/transactions?accountId=acc-card',
      'GET /v2/transactions?accountId=acc-card&after=cur1',
      'GET /v2/transactions?accountId=acc-card&after=cur2',
    ]);
  });

  it('falha no meio não avança o ponto de partida da conta que falhou', async () => {
    await syncItem(env.DB, fakePluggy().client, item, 'manual');
    const since = '2026-11-10T15:30:45.123Z';
    await env.DB.prepare(`UPDATE fin_accounts SET tx_synced_at = ?`).bind(since).run();
    await unlock();
    const { client } = fakePluggy({ failTransactionsFor: 'acc-card' });
    await expect(syncItem(env.DB, client, item, 'manual')).rejects.toMatchObject({ status: 502 });
    const at = async (id: string) =>
      (await env.DB.prepare(`SELECT tx_synced_at FROM fin_accounts WHERE id = ?`).bind(id).first<{ tx_synced_at: string }>())!.tx_synced_at;
    expect(await at('acc-card')).toBe(since);
    expect((await at('acc-cc')) > since).toBe(true);
  });

  it('trava de 5 minutos por conexão', async () => {
    const { client } = fakePluggy();
    await syncItem(env.DB, client, item, 'manual');
    await expect(syncItem(env.DB, client, item, 'manual')).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  });

  it('erro da Pluggy fica registrado e libera nova tentativa em 1 minuto', async () => {
    const { client } = fakePluggy({ missingItems: ['pluggy-1'] });
    const err = await syncItem(env.DB, client, item, 'manual').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toContain('Pluggy HTTP 404');
    const row = await env.DB.prepare(`SELECT last_error, last_sync_started_at FROM fin_items WHERE id = 'item-1'`).first<{ last_error: string; last_sync_started_at: string }>();
    expect(row?.last_error).toContain('item not found');
    expect(Date.parse(row!.last_sync_started_at)).toBeLessThan(Date.now() - 3 * 60 * 1000);
    const run = await env.DB.prepare(`SELECT status FROM fin_sync_runs`).first();
    expect(run).toEqual({ status: 'error' });
  });

  it('renova a API key quando a Pluggy responde 401', async () => {
    const { client, calls } = fakePluggy({ failAuthOnce: true });
    await syncItem(env.DB, client, item, 'manual');
    expect(calls.filter((c) => c === 'POST /auth')).toHaveLength(2);
  });
});

describe('cadastro de conexão', () => {
  const ctx: RequestCtx = { userId: 'u1', householdId: 'hh_1', role: 'owner' };

  it('confere o itemId na Pluggy antes de salvar', async () => {
    const { client } = fakePluggy({ missingItems: ['nao-existe-123'] });
    await expect(financeService.addItem(env, ctx, () => client, { pluggyItemId: 'nao-existe-123' })).rejects.toMatchObject({ status: 400 });
    const ok = await financeService.addItem(env, ctx, () => client, { pluggyItemId: 'existe-12345' });
    expect(ok.id).toBeTruthy();
    expect(await env.DB.prepare(`SELECT connector_name FROM fin_items WHERE pluggy_item_id = 'existe-12345'`).first()).toEqual({ connector_name: 'MeuPluggy' });
  });

  it('um itemId só tem um dono na plataforma', async () => {
    const { client } = fakePluggy();
    await expect(financeService.addItem(env, ctx, () => client, { pluggyItemId: 'pluggy-1' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('sinal dos valores (DEBIT = saída, CREDIT = entrada)', () => {
  it.each([
    ['conta: despesa negativa', { amount: -10, type: 'DEBIT' }, -1000],
    ['conta: receita positiva', { amount: 10, type: 'CREDIT' }, 1000],
    ['cartão: compra vem positiva', { amount: 10, type: 'DEBIT' }, -1000],
    ['cartão: estorno/pagamento vem negativo', { amount: -10, type: 'CREDIT' }, 1000],
    ['sem type: mantém o sinal da Pluggy', { amount: -10.005 }, -1001],
  ])('%s', (_name, tx, expected) => {
    expect(signedCents(tx)).toBe(expected);
  });
});

describe('paridade com o classificador Python (app.py)', () => {
  const rules = DEFAULT_RULES.map(([pattern, category]) => ({ pattern, category }));

  it.each(parity.classify as [string, string, number, string][])('classify(%j)', (desc, category, excluded, confidence) => {
    expect(classify(desc, rules)).toEqual({ category, excluded, confidence });
  });

  it.each(parity.installment as [string, string][])('installment(%j)', (desc, expected) => {
    expect(installmentOf({ description: desc })).toBe(expected);
  });
});
