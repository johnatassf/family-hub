import { type ApiErrorBody, type ErrorCode, HOUSEHOLD_HEADER } from '@familia/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const HOUSEHOLD_KEY = 'familia.household';
let activeHousehold: string | null = null;
try {
  activeHousehold = localStorage.getItem(HOUSEHOLD_KEY);
} catch {
  activeHousehold = null;
}

export const getActiveHousehold = () => activeHousehold;
export function setActiveHousehold(id: string | null) {
  activeHousehold = id;
  try {
    if (id) localStorage.setItem(HOUSEHOLD_KEY, id);
    else localStorage.removeItem(HOUSEHOLD_KEY);
  } catch {
    /* armazenamento indisponível: segue só em memória */
  }
}

type Listener = (error: ApiError) => void;
const listeners = new Set<Listener>();
/** O app registra aqui o tratamento global (401 → login, 2FA obrigatório → segurança). */
export const onApiError = (fn: Listener) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export async function apiFetch<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (activeHousehold) headers[HOUSEHOLD_HEADER] = activeHousehold;
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'same-origin',
    signal: opts.signal,
  });
  if (!res.ok) {
    let data: Partial<ApiErrorBody> & { message?: string } = {};
    try {
      data = await res.json();
    } catch {
      /* corpo não-JSON */
    }
    const error = new ApiError(res.status, data.code ?? 'INTERNAL', data.error ?? data.message ?? `Erro ${res.status}`);
    for (const fn of listeners) fn(error);
    throw error;
  }
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? await res.json() : await res.text()) as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');
