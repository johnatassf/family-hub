import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Member } from '@familia/shared';
import { Button, Card, Loading, Notice, PageHeader, Pill, Select, apiFetch, errorMessage } from '@familia/ui';
import { BIZ_ROLE_LABEL } from '../../shared';
import { useBiz } from '../context';

export function Access() {
  const { api, key, business } = useBiz();
  const qc = useQueryClient();
  const owner = business.role === 'owner';
  const members = useQuery({ queryKey: [...key, 'members'], queryFn: api.members });
  const family = useQuery({ queryKey: ['household'], queryFn: () => apiFetch<{ members: Member[] }>('/api/household'), enabled: owner });
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer');
  const refresh = () => qc.invalidateQueries({ queryKey: [...key, 'members'] });
  const add = useMutation({ mutationFn: () => api.setMember(userId, role), onSuccess: () => (setUserId(''), refresh()) });
  const remove = useMutation({ mutationFn: api.removeMember, onSuccess: refresh });
  const candidates = (family.data?.members ?? []).filter((m) => !members.data?.some((x) => x.userId === m.userId));

  return (
    <>
      <PageHeader eyebrow={business.name} title="Acesso à loja" description="Os dados da loja são privados. Só as pessoas abaixo veem; a família não vê por padrão." />
      {(members.isError || add.isError || remove.isError) && <Notice tone="error">{errorMessage(members.error ?? add.error ?? remove.error)}</Notice>}
      <Card title="Quem tem acesso" className="mb-5">
        {members.isLoading ? (
          <Loading />
        ) : (
          <ul className="grid gap-2">
            {members.data?.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <span>
                  <span className="text-ink">{m.name}</span> <span className="text-xs text-muted">{m.email}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Pill tone={m.role === 'owner' ? 'accent' : 'neutral'}>{BIZ_ROLE_LABEL[m.role]}</Pill>
                  {owner && m.role !== 'owner' && (
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(m.userId)}>
                      Remover
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {owner && (
        <Card title="Dar acesso a alguém da família">
          {candidates.length ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (userId) add.mutate();
              }}
            >
              <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Pessoa">
                <option value="">Escolha…</option>
                {candidates.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
              <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="Permissão">
                <option value="viewer">Só visualiza</option>
                <option value="editor">Pode editar (vender, cadastrar)</option>
              </Select>
              <Button type="submit" loading={add.isPending}>
                Dar acesso
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted">Todo mundo da família já tem acesso, ou a família só tem você.</p>
          )}
        </Card>
      )}
    </>
  );
}
