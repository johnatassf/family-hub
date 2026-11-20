import { type AuditEntry, type HouseholdSummary, type Invite, type Member, type Role, isManager } from '@familia/shared';
import { audit } from './audit';
import { sendEmail } from './email';
import { type CoreEnv, flag } from './env';
import { runMemberRemovedHooks } from './modules';
import { fail, newId, normalizeEmail, nowIso, parseCsvList } from './util';

/** Contexto já autenticado e autorizado de uma requisição. Serviços só confiam nisto. */
export interface RequestCtx {
  userId: string;
  householdId: string;
  role: Role;
  ip?: string | null;
  userAgent?: string | null;
}

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

const requireManager = (ctx: RequestCtx) => {
  if (!isManager(ctx.role)) fail(403, 'FORBIDDEN', 'Apenas dono(a) ou administrador(a) da família pode fazer isso.');
};

const auditCtx = (ctx: RequestCtx) => ({
  householdId: ctx.householdId,
  userId: ctx.userId,
  ip: ctx.ip,
  userAgent: ctx.userAgent,
});

/** Cadastro fechado: só entra quem tem convite válido, está na lista de bootstrap ou se o cadastro estiver aberto. */
export async function signupAllowed(env: CoreEnv, rawEmail: string): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (flag(env.ALLOW_OPEN_SIGNUP)) return true;
  if (parseCsvList(env.BOOTSTRAP_OWNER_EMAILS).includes(email)) return true;
  const invite = await env.DB.prepare(
    `SELECT 1 FROM invites
      WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? LIMIT 1`,
  )
    .bind(email, nowIso())
    .first();
  return invite !== null;
}

export async function listMemberships(db: D1Database, userId: string): Promise<HouseholdSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.name, m.role FROM household_members m
         JOIN households h ON h.id = m.household_id
        WHERE m.user_id = ? ORDER BY m.created_at`,
    )
    .bind(userId)
    .all<HouseholdSummary>();
  return results;
}

/**
 * Chamado em GET /api/me. Com o e-mail já comprovado: aceita convites pendentes e,
 * para quem pode criar família (bootstrap ou cadastro aberto), cria a primeira família.
 */
export async function ensureMemberships(
  env: CoreEnv,
  user: { id: string; email: string; name: string; emailVerified: boolean },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<HouseholdSummary[]> {
  if (!user.emailVerified) return listMemberships(env.DB, user.id);
  const email = normalizeEmail(user.email);
  const now = nowIso();

  const { results: invites } = await env.DB.prepare(
    `SELECT id, household_id, role FROM invites
      WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
  )
    .bind(email, now)
    .all<{ id: string; household_id: string; role: Role }>();

  for (const invite of invites) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO household_members (household_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
      ).bind(invite.household_id, user.id, invite.role, now),
      env.DB.prepare(`UPDATE invites SET accepted_at = ? WHERE id = ?`).bind(now, invite.id),
    ]);
    await audit(env.DB, {
      householdId: invite.household_id,
      userId: user.id,
      action: 'household.invite_accepted',
      target: invite.id,
      ...meta,
    });
  }

  let memberships = await listMemberships(env.DB, user.id);
  const canCreate = flag(env.ALLOW_OPEN_SIGNUP) || parseCsvList(env.BOOTSTRAP_OWNER_EMAILS).includes(email);
  if (memberships.length === 0 && canCreate) {
    // id determinístico: duas chamadas simultâneas não criam duas famílias.
    const householdId = `hh_${user.id}`;
    const firstName = user.name.trim().split(/\s+/)[0] || 'Família';
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO households (id, name, created_at) VALUES (?, ?, ?)`).bind(
        householdId,
        `Família de ${firstName}`,
        now,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO household_members (household_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
      ).bind(householdId, user.id, now),
    ]);
    await audit(env.DB, { householdId, userId: user.id, action: 'household.created', ...meta });
    memberships = await listMemberships(env.DB, user.id);
  }
  return memberships;
}

export async function listMembers(db: D1Database, householdId: string): Promise<Member[]> {
  const { results } = await db
    .prepare(
      `SELECT m.user_id AS userId, u.name, u.email, u.image, m.role,
              COALESCE(u.twoFactorEnabled, 0) AS twoFactorEnabled, m.created_at AS joinedAt
         FROM household_members m JOIN "user" u ON u.id = m.user_id
        WHERE m.household_id = ? ORDER BY m.created_at`,
    )
    .bind(householdId)
    .all<Omit<Member, 'twoFactorEnabled'> & { twoFactorEnabled: number }>();
  return results.map((m) => ({ ...m, twoFactorEnabled: Boolean(m.twoFactorEnabled) }));
}

export async function isMember(db: D1Database, householdId: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?`)
    .bind(householdId, userId)
    .first();
  return row !== null;
}

export async function renameHousehold(db: D1Database, ctx: RequestCtx, name: string) {
  requireManager(ctx);
  await db.prepare(`UPDATE households SET name = ? WHERE id = ?`).bind(name, ctx.householdId).run();
  await audit(db, { ...auditCtx(ctx), action: 'household.renamed', details: { name } });
}

export async function listInvites(db: D1Database, householdId: string): Promise<Invite[]> {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.email, i.role, u.name AS invitedBy, i.created_at AS createdAt, i.expires_at AS expiresAt
         FROM invites i LEFT JOIN "user" u ON u.id = i.invited_by
        WHERE i.household_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
        ORDER BY i.created_at DESC`,
    )
    .bind(householdId, nowIso())
    .all<Invite>();
  return results;
}

export async function createInvite(env: CoreEnv, ctx: RequestCtx, rawEmail: string, role: 'admin' | 'member') {
  requireManager(ctx);
  if (role === 'admin' && ctx.role !== 'owner') fail(403, 'FORBIDDEN', 'Só o dono(a) pode convidar administradores.');
  const email = normalizeEmail(rawEmail);

  const already = await env.DB.prepare(
    `SELECT 1 FROM household_members m JOIN "user" u ON u.id = m.user_id
      WHERE m.household_id = ? AND lower(u.email) = ?`,
  )
    .bind(ctx.householdId, email)
    .first();
  if (already) fail(409, 'CONFLICT', 'Essa pessoa já faz parte da família.');

  const now = nowIso();
  const invite: Invite = {
    id: newId(),
    email,
    role,
    invitedBy: null,
    createdAt: now,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  };
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE invites SET revoked_at = ? WHERE household_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    ).bind(now, ctx.householdId, email),
    env.DB.prepare(
      `INSERT INTO invites (id, household_id, email, role, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(invite.id, ctx.householdId, email, role, ctx.userId, now, invite.expiresAt),
  ]);

  const household = await env.DB.prepare(`SELECT name FROM households WHERE id = ?`)
    .bind(ctx.householdId)
    .first<{ name: string }>();
  const appName = env.APP_NAME ?? 'Família';
  await sendEmail(env, {
    to: email,
    subject: `Convite para ${household?.name ?? 'uma família'} no ${appName}`,
    text: [
      `Você foi convidado(a) para participar de "${household?.name ?? 'uma família'}" no ${appName}.`,
      '',
      `Acesse ${new URL('/login', env.APP_URL).toString()} e entre com este e-mail (${email}),`,
      'pelo Google, com código por e-mail ou criando uma senha.',
      '',
      'O convite vale por 72 horas. Se você não esperava este convite, ignore esta mensagem.',
    ].join('\n'),
  });
  await audit(env.DB, { ...auditCtx(ctx), action: 'household.invite_created', target: invite.id, details: { email, role } });
  return invite;
}

export async function revokeInvite(db: D1Database, ctx: RequestCtx, inviteId: string) {
  requireManager(ctx);
  const res = await db
    .prepare(
      `UPDATE invites SET revoked_at = ? WHERE id = ? AND household_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    )
    .bind(nowIso(), inviteId, ctx.householdId)
    .run();
  if (!res.meta.changes) fail(404, 'NOT_FOUND', 'Convite não encontrado.');
  await audit(db, { ...auditCtx(ctx), action: 'household.invite_revoked', target: inviteId });
}

async function getRole(db: D1Database, householdId: string, userId: string): Promise<Role | null> {
  const row = await db
    .prepare(`SELECT role FROM household_members WHERE household_id = ? AND user_id = ?`)
    .bind(householdId, userId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

async function ownerCount(db: D1Database, householdId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT count(*) AS n FROM household_members WHERE household_id = ? AND role = 'owner'`)
    .bind(householdId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function changeRole(db: D1Database, ctx: RequestCtx, targetUserId: string, role: Role) {
  if (ctx.role !== 'owner') fail(403, 'FORBIDDEN', 'Só o dono(a) pode mudar papéis.');
  const current = await getRole(db, ctx.householdId, targetUserId);
  if (!current) fail(404, 'NOT_FOUND', 'Membro não encontrado.');
  if (current === 'owner' && role !== 'owner' && (await ownerCount(db, ctx.householdId)) <= 1) {
    fail(409, 'CONFLICT', 'A família precisa de pelo menos um dono(a).');
  }
  await db
    .prepare(`UPDATE household_members SET role = ? WHERE household_id = ? AND user_id = ?`)
    .bind(role, ctx.householdId, targetUserId)
    .run();
  await audit(db, { ...auditCtx(ctx), action: 'household.role_changed', target: targetUserId, details: { from: current, to: role } });
}

/** Remove alguém da família (ou a própria pessoa saindo). Os módulos apagam os dados dela. */
export async function removeMember(env: CoreEnv, ctx: RequestCtx, targetUserId: string) {
  const target = await getRole(env.DB, ctx.householdId, targetUserId);
  if (!target) fail(404, 'NOT_FOUND', 'Membro não encontrado.');
  const self = targetUserId === ctx.userId;
  if (!self) {
    requireManager(ctx);
    if (ctx.role === 'admin' && target !== 'member') fail(403, 'FORBIDDEN', 'Administradores só removem membros.');
  }
  if (target === 'owner' && (await ownerCount(env.DB, ctx.householdId)) <= 1) {
    fail(409, 'CONFLICT', 'Transfira o papel de dono(a) para outra pessoa antes de sair.');
  }
  await runMemberRemovedHooks(env, ctx.householdId, targetUserId);
  await env.DB.prepare(`DELETE FROM household_members WHERE household_id = ? AND user_id = ?`)
    .bind(ctx.householdId, targetUserId)
    .run();
  await audit(env.DB, { ...auditCtx(ctx), action: self ? 'household.left' : 'household.member_removed', target: targetUserId });
}

/** Antes de excluir a conta (LGPD): impede deixar uma família sem dono. */
export async function assertUserCanBeDeleted(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(
      `SELECT m.household_id,
              (SELECT count(*) FROM household_members o WHERE o.household_id = m.household_id AND o.role = 'owner') AS owners,
              (SELECT count(*) FROM household_members o WHERE o.household_id = m.household_id) AS members
         FROM household_members m WHERE m.user_id = ? AND m.role = 'owner'`,
    )
    .bind(userId)
    .all<{ household_id: string; owners: number; members: number }>();
  if (results.some((r) => r.owners <= 1 && r.members > 1)) {
    fail(409, 'CONFLICT', 'Você é o único dono(a) de uma família com outros membros. Transfira o papel antes de excluir a conta.');
  }
}

/** Depois da exclusão: famílias que ficaram sem ninguém são apagadas (com os dados, em cascata). */
export async function deleteEmptyHouseholds(db: D1Database) {
  await db
    .prepare(`DELETE FROM households WHERE id NOT IN (SELECT DISTINCT household_id FROM household_members)`)
    .run();
}

export async function listAudit(db: D1Database, ctx: RequestCtx, limit = 100): Promise<AuditEntry[]> {
  requireManager(ctx);
  const { results } = await db
    .prepare(
      `SELECT a.id, a.user_id AS userId, u.name AS userName, a.action, a.target, a.details, a.ip, a.created_at AS createdAt
         FROM audit_log a LEFT JOIN "user" u ON u.id = a.user_id
        WHERE a.household_id = ? ORDER BY a.id DESC LIMIT ?`,
    )
    .bind(ctx.householdId, limit)
    .all<Omit<AuditEntry, 'details'> & { details: string | null }>();
  return results.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
}
