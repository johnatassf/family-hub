import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiErrorBody, ErrorCode } from '@familia/shared';

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Erro de domínio com status HTTP e código estável para o frontend. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (status: ContentfulStatusCode, code: ErrorCode, message: string): never => {
  throw new AppError(status, code, message);
};

export const errorJson = (c: Context, status: ContentfulStatusCode, code: ErrorCode, message: string) =>
  c.json<ApiErrorBody>({ error: message, code }, status);

export const clientIp = (req: Request) =>
  req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? 'unknown';

export const parseCsvList = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((x) => normalizeEmail(x))
    .filter(Boolean);
