import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { isManager } from '@familia/shared';
import { Button, Card, Empty, Field, Input, Loading, Notice, PageHeader, Pill, Select, errorMessage, formatDateTime, useSession } from '@familia/ui';
import type { FinItem } from '../../shared';
import { financeApi } from '../api';
import { useMembers } from '../components';

function ItemRow({ item }: { item: FinItem }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [revoke, setRevoke] = useState(true);
  const sync = useMutation({
    mutationFn: (full: boolean) => financeApi.syncItem(item.id, full),
    onSettled: () => qc.invalidateQueries({ queryKey: ['finance'] }),
  });
  const remove = useMutation({ mutationFn: () => financeApi.removeItem(item.id, revoke), onSuccess: () => qc.invalidateQueries({ queryKey: ['finance'] }) });
  const statusTone = item.lastError ? 'danger' : item.status === 'UPDATED' ? 'accent' : 'warn';

  return (
    <li className="rounded-xl border border-line bg-card-2/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{item.connectorName ?? 'Conexão Pluggy'}</span>
            <Pill tone={statusTone}>{item.lastError ? 'Erro' : (item.status ?? 'Nova')}</Pill>
            {!item.isMine && <Pill>de {item.ownerName}</Pill>}
          </div>
          <div className="mt-1 text-xs text-muted">
            {item.accounts} conta(s) · última sincronização {formatDateTime(item.lastSyncAt)}
            {item.pluggyItemId && <span className="ml-1 font-mono">· {item.pluggyItemId.slice(0, 8)}…</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => sync.mutate(false)} loading={sync.isPending && !sync.variables} disabled={sync.isPending}>
            ↻ Sincronizar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Busca de novo o histórico inteiro na Pluggy. Use se algum lançamento antigo parecer desatualizado."
            onClick={() => sync.mutate(true)}
            loading={sync.isPending && sync.variables === true}
            disabled={sync.isPending}
          >
            Buscar tudo
          </Button>
          <Button size="sm" variant="danger" onClick={() => setConfirming((v) => !v)}>
            Desconectar
          </Button>
        </div>
      </div>
      {item.lastError && <p className="mt-3 text-xs break-words text-danger">{item.lastError}</p>}
      {sync.isSuccess && (
        <p className="mt-3 text-xs text-positive">
          {sync.data.full
            ? `Histórico completo: ${sync.data.processed} lançamentos em ${sync.data.accounts} conta(s).`
            : `${sync.data.processed} lançamentos novos ou atualizados em ${sync.data.accounts} conta(s).`}
        </p>
      )}
      {sync.isError && <p className="mt-3 text-xs text-danger">{errorMessage(sync.error)}</p>}
      {confirming && (
        <div className="mt-4 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm">
          <p className="text-ink">Apagar esta conexão e todas as contas e transações dela?</p>
          <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} />
            Também revogar o acesso na Pluggy (recomendado)
          </label>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
              Sim, desconectar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
          {remove.isError && <p className="mt-2 text-xs text-danger">{errorMessage(remove.error)}</p>}
        </div>
      )}
    </li>
  );
}

function AddConnection() {
  const { me } = useSession();
  const qc = useQueryClient();
  const members = useMembers();
  const [itemId, setItemId] = useState('');
  const [owner, setOwner] = useState(me.user.id);
  const add = useMutation({
    mutationFn: () => financeApi.addItem(itemId.trim(), owner),
    onSuccess: () => {
      setItemId('');
      qc.invalidateQueries({ queryKey: ['finance'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-sm text-muted">
        Conecte o banco no <a className="text-accent hover:underline" href="https://meu.pluggy.ai" target="_blank" rel="noreferrer">Meu Pluggy</a> e cole o
        <b className="text-ink-2"> itemId</b> da conexão. O app confere o ID na Pluggy antes de salvar.
      </p>
      <Field label="Item ID">
        <Input value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="ex.: adb8682b-4c9f-…" required minLength={8} autoComplete="off" />
      </Field>
      <Field label="De quem é esta conexão" hint="As contas nascem privadas para essa pessoa; ela decide o que compartilhar.">
        <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="w-full">
          {members.data?.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
              {m.userId === me.user.id ? ' (você)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      {add.isError && <Notice tone="error">{errorMessage(add.error)}</Notice>}
      {add.isSuccess && <Notice tone="success">Conexão salva. Agora clique em “Sincronizar”.</Notice>}
      <div>
        <Button type="submit" loading={add.isPending}>
          Salvar conexão
        </Button>
      </div>
    </form>
  );
}

function CategoriesAndRules({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['finance', 'categories'], queryFn: financeApi.categories });
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState('');
  const [newCat, setNewCat] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance', 'categories'] });
  const addRule = useMutation({ mutationFn: () => financeApi.addRule(pattern, category), onSuccess: () => (setPattern(''), refresh()) });
  const delRule = useMutation({ mutationFn: (id: number) => financeApi.deleteRule(id), onSuccess: refresh });
  const addCat = useMutation({ mutationFn: () => financeApi.addCategory(newCat), onSuccess: () => (setNewCat(''), refresh()) });
  const error = addRule.error ?? delRule.error ?? addCat.error;

  if (q.isLoading) return <Loading />;
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted">
        Novas transações recebem a categoria da primeira regra cujo texto aparece na descrição (sem diferenciar acentos). Edições manuais nunca são
        sobrescritas.
      </p>
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addRule.mutate();
          }}
        >
          <Field label="Se a descrição contém">
            <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="ex.: DROGASIL" required minLength={2} />
          </Field>
          <Field label="Categoria">
            <Select value={category} onChange={(e) => setCategory(e.target.value)} required>
              <option value="">Escolha…</option>
              {q.data?.categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" loading={addRule.isPending}>
            Adicionar regra
          </Button>
        </form>
      )}
      <div className="flex flex-wrap gap-2">
        {q.data?.rules.map((r) => (
          <span key={r.id} className="inline-flex items-center gap-1.5 rounded-md bg-line px-2 py-1 text-xs text-ink-2">
            <span className="font-mono">{r.pattern}</span> → {r.category}
            {canEdit && (
              <button aria-label={`Remover regra ${r.pattern}`} className="text-muted hover:text-danger" onClick={() => delRule.mutate(r.id)}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addCat.mutate();
          }}
        >
          <Field label="Nova categoria">
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="ex.: Pets" required minLength={2} maxLength={40} />
          </Field>
          <Button type="submit" variant="outline" loading={addCat.isPending}>
            Criar categoria
          </Button>
        </form>
      )}
    </div>
  );
}

export function Connections() {
  const { household } = useSession();
  const manager = isManager(household.role);
  const items = useQuery({ queryKey: ['finance', 'items'], queryFn: financeApi.items });
  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title="Conexões bancárias"
        description="Cada conexão Pluggy pertence a uma pessoa. As credenciais da API ficam só no servidor."
      />
      {items.isError && <Notice tone="error">{errorMessage(items.error)}</Notice>}
      <div className="mb-5 grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Card title="Conexões">
          {items.isLoading ? (
            <Loading />
          ) : items.data?.length ? (
            <ul className="grid gap-3">{items.data.map((i) => <ItemRow key={i.id} item={i} />)}</ul>
          ) : (
            <Empty>Nenhuma conexão cadastrada.</Empty>
          )}
        </Card>
        <Card title="Nova conexão">
          {manager ? (
            <AddConnection />
          ) : (
            <p className="text-sm text-muted">Nesta fase de testes, quem cadastra conexões é o dono(a) ou um administrador(a) da família.</p>
          )}
        </Card>
      </div>
      <Card title="Categorias e regras">
        <CategoriesAndRules canEdit={manager} />
      </Card>
    </>
  );
}
