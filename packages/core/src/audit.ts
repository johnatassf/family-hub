import { nowIso } from './util';

export interface AuditEvent {
  householdId?: string | null;
  userId?: string | null;
  action: string;
  target?: string | null;
  details?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export async function audit(db: D1Database, event: AuditEvent): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_log (household_id, user_id, action, target, details, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.householdId ?? null,
      event.userId ?? null,
      event.action,
      event.target ?? null,
      event.details === undefined ? null : JSON.stringify(event.details),
      event.ip ?? null,
      event.userAgent?.slice(0, 300) ?? null,
      nowIso(),
    )
    .run();
}
