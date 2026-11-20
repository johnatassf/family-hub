import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { type AuditEntry, type Invite, type Member, ROLE_LABEL, type Role, isManager } from '@familia/shared';
import { Button, Card, Field, Input, Loading, Notice, PageHeader, Pill, Select, apiFetch, cx, errorMessage, formatDateTime, tableClass, tdClass, thClass, useSession } from '@familia/ui';

interface HouseholdDetails {
  id: string;
  name: string;
  role: Role;
  members: Member[];
  invites: Invite[];
}

const ACTION_LABEL: Record<string, string> = {
  'auth.signed_in': 'Entrou',
  'household.created': 'Criou a família',
  'household.renamed': 'Renomeou a família',
  'household.invite_created': 'Convidou',
  'household.invite_revoked': 'Cancelou convite',
  'household.invite_accepted': 'Aceitou convite',
  'household.role_changed': 'Mudou papel',
  'household.member_removed': 'Removeu membro',
  'household.left': 'Saiu da família',
  'finance.item_added': 'Cadastrou conexão bancária',
  'finance.item_removed': 'Desconectou conexão bancária',
  'finance.synced': 'Sincronizou',
  'finance.account_shared': 'Compartilhou conta com a família',
  'finance.account_unshared': 'Deixou de compartilhar conta',
  'finance.exported': 'Exportou CSV',
};

export function Family() {
  const { me, household } = useSession();
  const qc = useQueryClient();
  const manager = isManager(household.role);
  const owner = household.role === 'owner';
  const details = useQuery({ queryKey: ['household'], queryFn: () => apiFetch<HouseholdDetails>('/api/household') });
  const audit = useQuery({ queryKey: ['household', 'audit'], queryFn: () => apiFetch<AuditEntry[]>('/api/household/audit'), enabled: manager });
  const refresh = () => qc.invalidateQueries({ queryKey: ['household'] });

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [name, setName] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => apiFetch('/api/household/invites', { method: 'POST', body: { email, role: inviteRole } }),
    onSuccess: () => (setEmail(''), refresh()),
  });
  const revoke = useMutation({ mutationFn: (id: string) => apiFetch(`/api/household/invites/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => apiFetch(`/api/household/members/${userId}`, { method: 'PATCH', body: { role } }),
    onSuccess: () => (refresh(), qc.invalidateQueries({ queryKey: ['me'] })),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => apiFetch(`/api/household/members/${userId}`, { method: 'DELETE' }),
    onSuccess: (_d, userId) => (userId === me.user.id ? qc.invalidateQueries({ queryKey: ['me'] }) : refresh()),
  });
  const rename = useMutation({
    mutationFn: (n: string) => apiFetch('/api/household', { method: 'PATCH', body: { name: n } }),
    onSuccess: () => (setName(null), refresh(), qc.invalidateQueries({ queryKey: ['me'] })),
  });
  const error = invite.error ?? revoke.error ?? setRole.error ?? remove.error ?? rename.error ?? details.error;

  return (
    <>
      <PageHeader eyebrow="Família" title={details.data?.name ?? household.name} description="Quem participa, com qual papel, e os convites pendentes." />
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      {invite.isSuccess && <Notice tone="success">Convite enviado. Ele vale por 72 horas.</Notice>}
      {details.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-5">
          <Card
            title="Membros"
            actions={
              manager &&
              name === null && (
                <Button size="sm" variant="outline" onClick={() => setName(details.data?.name ?? '')}>
                  Renomear família
                </Button>
              )
            }
          >
            {name !== null && (
              <form
                className="mb-4 flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename.mutate(name);
                }}
              >
                <Field label="Nome da família">
                  <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} required autoFocus />
                </Field>
                <Button type="submit" loading={rename.isPending}>
                  Salvar
                </Button>
                <Button variant="outline" onClick={() => setName(null)}>
                  Cancelar
                </Button>
              </form>
            )}
            <div className="-mx-2 overflow-x-auto px-2">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Pessoa</th>
                    <th className={thClass}>Papel</th>
                    <th className={thClass}>2FA</th>
                    <th className={thClass}>Desde</th>
                    <th className={thClass} />
                  </tr>
                </thead>
                <tbody>
                  {details.data?.members.map((m) => {
                    const self = m.userId === me.user.id;
                    const canRemove = self || (owner && !self) || (household.role === 'admin' && m.role === 'member');
                    return (
                      <tr key={m.userId}>
                        <td className={tdClass}>
                          <div className="text-ink">
                            {m.name} {self && <span className="text-muted">(você)</span>}
                          </div>
                          <div className="text-xs text-muted">{m.email}</div>
                        </td>
                        <td className={tdClass}>
                          {owner && !self ? (
                            <Select aria-label={`Papel de ${m.name}`} value={m.role} onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value as Role })} className="py-1 text-xs">
                              {(['owner', 'admin', 'member'] as Role[]).map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABEL[r]}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <span className="text-ink-2">{ROLE_LABEL[m.role]}</span>
                          )}
                        </td>
                        <td className={tdClass}>{m.twoFactorEnabled ? <Pill tone="accent">Ativo</Pill> : <Pill tone={isManager(m.role) ? 'warn' : 'neutral'}>Não</Pill>}</td>
                        <td className={cx(tdClass, 'text-ink-2')}>{formatDateTime(m.joinedAt)}</td>
                        <td className={cx(tdClass, 'text-right')}>
                          {canRemove && (
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                const msg = self
                                  ? 'Sair da família? Suas conexões e contas desta família serão apagadas.'
                                  : `Remover ${m.name}? As conexões e contas dessa pessoa nesta família serão apagadas.`;
                                if (window.confirm(msg)) remove.mutate(m.userId);
                              }}
                            >
                              {self ? 'Sair' : 'Remover'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {manager && (
            <Card title="Convidar alguém">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  invite.mutate();
                }}
              >
                <div className="min-w-64 flex-1">
                  <Field label="E-mail">
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </Field>
                </div>
                <Field label="Papel">
                  <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}>
                    <option value="member">Membro</option>
                    {owner && <option value="admin">Administrador(a)</option>}
                  </Select>
                </Field>
                <Button type="submit" loading={invite.isPending}>
                  Enviar convite
                </Button>
              </form>
              {!!details.data?.invites.length && (
                <ul className="mt-5 grid gap-2">
                  {details.data.invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                      <span className="text-ink">
                        {i.email} <Pill>{ROLE_LABEL[i.role]}</Pill>
                      </span>
                      <span className="flex items-center gap-3 text-xs text-muted">
                        expira {formatDateTime(i.expiresAt)}
                        <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
                          Cancelar
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {manager && (
            <Card title="Atividade recente">
              {audit.isLoading ? (
                <Loading />
              ) : (
                <ul className="grid gap-1.5 text-sm">
                  {audit.data?.map((a) => (
                    <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b border-line/60 py-1.5">
                      <span className="text-ink-2">
                        <b className="font-medium text-ink">{a.userName ?? 'Sistema'}</b> · {ACTION_LABEL[a.action] ?? a.action}
                      </span>
                      <span className="text-xs text-muted">
                        {formatDateTime(a.createdAt)}
                        {a.ip ? ` · ${a.ip}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
