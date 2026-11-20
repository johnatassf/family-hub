import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, Empty, Field, Input, Loading, Notice, PageHeader, Pill, Select, errorMessage, formatDate, formatMonth, parseBRL } from '@familia/ui';
import { currentMonth } from '../../planning';
import { type Goal, type GoalKind, formatBRL } from '../../shared';
import { type GoalInput, financeApi } from '../api';
import { Progress } from '../charts';

const KIND: Record<GoalKind, { label: string; icon: string }> = {
  purchase: { label: 'Compra', icon: '🛒' },
  trip: { label: 'Viagem', icon: '✈' },
  reserve: { label: 'Reserva', icon: '🛟' },
  other: { label: 'Outro', icon: '◎' },
};

function NewGoalForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<GoalKind>('trip');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [visibility, setVisibility] = useState<GoalInput['visibility']>('family');
  const create = useMutation({
    mutationFn: financeApi.createGoal,
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['finance'] }), onDone()),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (cents && cents > 0) create.mutate({ kind, name: name.trim(), targetCents: cents, targetMonth: month, visibility });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[9rem_1fr_10rem_10rem_9rem_auto] lg:items-end">
      <Field label="Tipo">
        <Select className="w-full" value={kind} onChange={(e) => setKind(e.target.value as GoalKind)}>
          {(Object.keys(KIND) as GoalKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND[k].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Nome">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'trip' ? 'ex.: Férias no Nordeste' : 'ex.: Notebook novo'} required maxLength={80} />
      </Field>
      <Field label="Quanto custa">
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="ex.: 12.000,00" required />
      </Field>
      <Field label="Até quando">
        <Input type="month" min={currentMonth()} value={month} onChange={(e) => setMonth(e.target.value)} required />
      </Field>
      <Field label="Quem vê">
        <Select className="w-full" value={visibility} onChange={(e) => setVisibility(e.target.value as GoalInput['visibility'])}>
          <option value="family">Família</option>
          <option value="private">Só eu</option>
        </Select>
      </Field>
      <div className="flex gap-2">
        <Button type="submit" loading={create.isPending}>
          Criar
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
      </div>
      {create.isError && <p className="text-sm text-danger sm:col-span-2 lg:col-span-6">{errorMessage(create.error)}</p>}
    </form>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance'] });
  const [contribution, setContribution] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemAmount, setItemAmount] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const contribute = useMutation({ mutationFn: (cents: number) => financeApi.addContribution(goal.id, cents), onSuccess: () => (setContribution(''), refresh()) });
  const removeContribution = useMutation({ mutationFn: (cid: string) => financeApi.deleteContribution(goal.id, cid), onSuccess: refresh });
  const addItem = useMutation({ mutationFn: () => financeApi.addGoalItem(goal.id, itemName.trim(), parseBRL(itemAmount) ?? 0), onSuccess: () => (setItemName(''), setItemAmount(''), refresh()) });
  const removeItem = useMutation({ mutationFn: (iid: string) => financeApi.deleteGoalItem(goal.id, iid), onSuccess: refresh });
  const update = useMutation({ mutationFn: (patch: Parameters<typeof financeApi.updateGoal>[1]) => financeApi.updateGoal(goal.id, patch), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => financeApi.deleteGoal(goal.id), onSuccess: refresh });
  const error = contribute.error ?? removeContribution.error ?? addItem.error ?? removeItem.error ?? update.error ?? remove.error;

  const pct = Math.min(100, Math.round((goal.savedCents / goal.targetCents) * 100));
  const itemsTotal = goal.items.reduce((a, i) => a + i.amountCents, 0);
  const done = goal.status === 'done';
  const reached = goal.savedCents >= goal.targetCents;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="text-lg">{KIND[goal.kind].icon}</span>
            <h2 className="text-base font-semibold text-ink">{goal.name}</h2>
            <Pill>{KIND[goal.kind].label}</Pill>
            {goal.visibility === 'family' ? <Pill tone="accent">Família</Pill> : <Pill>Só {goal.editable ? 'você' : goal.ownerName}</Pill>}
            {done && <Pill tone="accent">✓ Concluída</Pill>}
          </div>
          <p className="mt-1 text-xs text-muted">
            até {formatMonth(goal.targetMonth)} {!goal.editable && `· criada por ${goal.ownerName}`}
          </p>
        </div>
        {goal.editable && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ status: done ? 'active' : 'done' })}>
              {done ? 'Reabrir' : 'Concluir'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.confirm(`Apagar a meta "${goal.name}" e os aportes?`) && remove.mutate()} aria-label="Apagar meta">
              ×
            </Button>
          </div>
        )}
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{errorMessage(error)}</Notice>
        </div>
      )}

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold text-ink tabular-nums">{formatBRL(goal.savedCents)}</div>
          <div className="text-xs text-muted">de {formatBRL(goal.targetCents)} · {pct}%</div>
        </div>
        {!done && (
          <div className="text-right text-sm">
            {reached ? (
              <span className="text-positive">✓ Valor atingido</span>
            ) : (
              <>
                <div className="font-semibold text-ink tabular-nums">{formatBRL(goal.monthlyNeedCents)}/mês</div>
                <div className="text-xs text-muted">para chegar até {formatMonth(goal.targetMonth)}</div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="mt-3">
        <Progress value={goal.savedCents} max={goal.targetCents} label={`${pct}% guardado`} />
      </div>

      {!done && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = parseBRL(contribution);
            if (cents) contribute.mutate(cents);
          }}
        >
          <div className="min-w-40 flex-1">
            <Field label="Guardei (use − para retirar)">
              <Input inputMode="decimal" value={contribution} onChange={(e) => setContribution(e.target.value)} placeholder="ex.: 500,00" />
            </Field>
          </div>
          <Button type="submit" variant="outline" loading={contribute.isPending}>
            Registrar
          </Button>
        </form>
      )}

      {goal.contributions.length > 0 && (
        <div className="mt-3 text-xs">
          <button className="text-muted hover:text-ink-2" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? '▾' : '▸'} {goal.contributions.length} aporte(s)
          </button>
          {showHistory && (
            <ul className="mt-2 grid gap-1">
              {goal.contributions.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 border-b border-line/60 py-1">
                  <span className="text-ink-2">
                    {formatDate(c.date)} · {c.userName ?? '—'}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={c.amountCents < 0 ? 'text-danger tabular-nums' : 'text-positive tabular-nums'}>{formatBRL(c.amountCents)}</span>
                    {(c.mine || goal.editable) && (
                      <button className="text-muted hover:text-danger" aria-label="Apagar aporte" onClick={() => removeContribution.mutate(c.id)}>
                        ×
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(goal.kind === 'trip' || goal.items.length > 0) && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-2">Orçamento</h3>
            {goal.items.length > 0 && (
              <span className="text-xs text-muted">
                soma {formatBRL(itemsTotal)}
                {goal.editable && itemsTotal !== goal.targetCents && (
                  <button className="ml-2 text-accent hover:underline" onClick={() => update.mutate({ targetCents: itemsTotal })}>
                    usar como valor da meta
                  </button>
                )}
              </span>
            )}
          </div>
          {goal.items.length ? (
            <ul className="mb-3 grid gap-1 text-sm">
              {goal.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2">
                  <span className="text-ink-2">{i.name}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {formatBRL(i.amountCents)}
                    {goal.editable && (
                      <button className="text-muted hover:text-danger" aria-label={`Remover ${i.name}`} onClick={() => removeItem.mutate(i.id)}>
                        ×
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-xs text-muted">Separe o custo: passagens, hospedagem, alimentação, passeios…</p>
          )}
          {goal.editable && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (itemName.trim() && parseBRL(itemAmount)) addItem.mutate();
              }}
            >
              <Input className="w-auto min-w-32 flex-1" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Item" maxLength={80} aria-label="Item do orçamento" />
              <Input className="w-32" inputMode="decimal" value={itemAmount} onChange={(e) => setItemAmount(e.target.value)} placeholder="Valor" aria-label="Valor do item" />
              <Button type="submit" size="sm" variant="outline" loading={addItem.isPending}>
                + Item
              </Button>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

export function Goals() {
  const goals = useQuery({ queryKey: ['finance', 'goals'], queryFn: financeApi.goals });
  const [creating, setCreating] = useState(false);
  const active = goals.data?.filter((g) => g.status === 'active') ?? [];
  const done = goals.data?.filter((g) => g.status === 'done') ?? [];
  const monthly = active.reduce((a, g) => a + g.monthlyNeedCents, 0);
  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title="Metas"
        description="Compras, viagens e reserva. O valor a guardar por mês entra na projeção do Planejamento."
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              + Nova meta
            </Button>
          )
        }
      />
      {goals.isError && <Notice tone="error">{errorMessage(goals.error)}</Notice>}
      {creating && (
        <Card title="Nova meta" className="mb-5">
          <NewGoalForm onDone={() => setCreating(false)} />
        </Card>
      )}
      {goals.isLoading ? (
        <Loading />
      ) : !goals.data?.length ? (
        <Card>
          <Empty>Nenhuma meta ainda. Crie uma para a próxima viagem ou compra grande.</Empty>
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <p className="mb-4 text-sm text-ink-2">
              Para cumprir as metas em andamento, guardem <b className="text-ink">{formatBRL(monthly)}/mês</b>.{' '}
              <Link to="../planejamento" className="text-accent hover:underline">
                Ver se cabe na renda →
              </Link>
            </p>
          )}
          <div className="grid gap-5 xl:grid-cols-2">
            {active.map((g) => (
              <GoalCard key={g.id} goal={g} />
            ))}
          </div>
          {done.length > 0 && (
            <>
              <h2 className="mt-8 mb-3 text-sm font-semibold text-muted uppercase">Concluídas</h2>
              <div className="grid gap-5 opacity-80 xl:grid-cols-2">
                {done.map((g) => (
                  <GoalCard key={g.id} goal={g} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
