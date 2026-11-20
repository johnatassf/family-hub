// Cliente da API Pluggy (somente servidor). Portado de app.py: token(), pluggy_get(), all_pages(), all_transactions().

export interface PluggyConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  /** Injetável para testes. */
  fetch?: typeof fetch;
  /** Cache da API key (vale 2 h na Pluggy; guardamos por ~100 min). */
  kv?: KVNamespace;
}

export class PluggyError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: unknown,
  ) {
    const detail = typeof body === 'object' && body && 'message' in body ? String((body as { message: unknown }).message) : String(body).slice(0, 300);
    super(`Pluggy HTTP ${status} | Endpoint: ${path.split('?')[0]} | Resposta: ${detail}`);
  }
}

export interface PluggyItem {
  id: string;
  status?: string;
  clientUserId?: string | null;
  connector?: { name?: string } | null;
  connectorId?: number;
}

export interface PluggyAccount {
  id: string;
  type?: string;
  subtype?: string;
  name?: string;
  number?: string;
  /** Conta: saldo. Cartão: valor em aberto. */
  balance?: number | null;
  creditData?: {
    creditLimit?: number | null;
    availableCreditLimit?: number | null;
    balanceDueDate?: string | null;
    minimumPayment?: number | null;
  } | null;
}

export interface PluggyBill {
  id: string;
  dueDate: string;
  billClosingDate?: string | null;
  totalAmount: number;
  minimumPaymentAmount?: number | null;
}

export interface PluggyTransaction {
  id?: string;
  description?: string | null;
  merchant?: { name?: string | null } | null;
  amount?: number | string | null;
  date?: string | null;
  createdAt?: string | null;
  /** DEBIT = saída de dinheiro, CREDIT = entrada. É o sinal confiável (o de `amount` muda por tipo de conta). */
  type?: string | null;
  operationType?: string | null;
  status?: string | null;
  installments?: unknown;
  installment?: unknown;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    billId?: string | null;
    billForecastDate?: string | null;
    cardNumber?: string | null;
    purchaseDate?: string | null;
  } | null;
}

/** Filtros do GET /v2/transactions. A Pluggy não aceita `createdAtFrom` junto com `dateFrom`. */
export interface TransactionFilter {
  /** Só o que a Pluggy recebeu a partir deste momento — pega lançamentos novos mesmo com data antiga. */
  createdAtFrom?: Date;
  /** Busca estas transações pelo id (a Pluggy aceita até 500; mandamos menos para a URL não ficar enorme). */
  ids?: string[];
}

const API_KEY_TTL_SECONDS = 100 * 60;
/** Teto de páginas por conta (mesmo papel do limite de 100 páginas do Python). */
const MAX_PAGES = 500;

export function createPluggyClient(cfg: PluggyConfig) {
  const baseUrl = (cfg.baseUrl ?? 'https://api.pluggy.ai').replace(/\/$/, '');
  const doFetch = cfg.fetch ?? fetch;
  const cacheKey = `pluggy:apiKey:${cfg.clientId}`;
  let apiKey: string | null = null;

  async function getApiKey(force = false): Promise<string> {
    if (apiKey && !force) return apiKey;
    if (cfg.kv && !force) {
      const cached = await cfg.kv.get(cacheKey);
      if (cached) return (apiKey = cached);
    }
    const res = await doFetch(`${baseUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: cfg.clientId, clientSecret: cfg.clientSecret }),
    });
    if (!res.ok) throw new PluggyError(res.status, '/auth', await safeBody(res));
    const { apiKey: key } = (await res.json()) as { apiKey: string };
    apiKey = key;
    await cfg.kv?.put(cacheKey, key, { expirationTtl: API_KEY_TTL_SECONDS });
    return key;
  }

  async function request<T>(method: 'GET' | 'DELETE', pathWithQuery: string, retried = false): Promise<T> {
    const key = await getApiKey(retried);
    const res = await doFetch(`${baseUrl}${pathWithQuery}`, { method, headers: { 'X-API-KEY': key } });
    if (res.status === 401 && !retried) return request<T>(method, pathWithQuery, true); // chave expirada no cache
    if (!res.ok) throw new PluggyError(res.status, pathWithQuery, await safeBody(res));
    return (res.status === 204 ? null : await res.json()) as T;
  }

  const qs = (params: Record<string, string | number>) =>
    '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

  return {
    getItem: (itemId: string) => request<PluggyItem>('GET', `/items/${encodeURIComponent(itemId)}`),

    deleteItem: (itemId: string) => request<null>('DELETE', `/items/${encodeURIComponent(itemId)}`),

    /** /accounts ainda usa paginação por page/pageSize. */
    async listAccounts(itemId: string): Promise<PluggyAccount[]> {
      const results: PluggyAccount[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const payload = await request<{ results?: PluggyAccount[]; totalPages?: number }>(
          'GET',
          `/accounts${qs({ itemId, page, pageSize: 100 })}`,
        );
        results.push(...(payload.results ?? []));
        if (page >= (payload.totalPages ?? 1)) break;
      }
      return results;
    },

    /** Faturas do cartão (total, vencimento, fechamento, mínimo). */
    async listBills(accountId: string): Promise<PluggyBill[]> {
      const results: PluggyBill[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const payload = await request<{ results?: PluggyBill[]; totalPages?: number }>('GET', `/bills${qs({ accountId, page, pageSize: 100 })}`);
        results.push(...(payload.results ?? []));
        if (page >= (payload.totalPages ?? 1)) break;
      }
      return results;
    },

    /**
     * GET /transactions (v1) foi desativado (HTTP 410). O v2 pagina por cursor: a resposta traz
     * `next` como query string pronta ("?accountId=...&after=..."), que é anexada ao path.
     * Não aceita page/pageSize (as páginas têm 500). Entrega página a página para não acumular tudo em memória.
     */
    async forEachTransactionPage(accountId: string, onPage: (txs: PluggyTransaction[]) => Promise<void>, filter: TransactionFilter = {}) {
      const params: Record<string, string> = { accountId };
      // Formato exigido: yyyy-mm-ddThh:mm:ss.000Z
      if (filter.createdAtFrom) params.createdAtFrom = `${filter.createdAtFrom.toISOString().slice(0, 19)}.000Z`;
      if (filter.ids) params.ids = filter.ids.join(',');
      let path = `/v2/transactions${qs(params)}`;
      for (let i = 0; i < MAX_PAGES; i++) {
        const payload = await request<{ results?: PluggyTransaction[]; next?: string | null }>('GET', path);
        await onPage(payload.results ?? []);
        if (!payload.next) return;
        path = `/v2/transactions${payload.next.startsWith('?') ? payload.next : `?${payload.next}`}`;
      }
    },
  };
}

export type PluggyClient = ReturnType<typeof createPluggyClient>;

async function safeBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}
