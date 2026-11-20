import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router';
import { isManager } from '@familia/shared';
import {
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  Notice,
  PageHeader,
  Pill,
  Segmented,
  Select,
  StatTile,
  centsToInput,
  cx,
  errorMessage,
  formatMonth,
  parseBRL,
  tableClass,
  tdClass,
  thClass,
  useSession,
} from '@familia/ui';
import { type PlanEntry, type PlanScope, type ProjectionMonth, formatBRL } from '../../shared';
import { type EntryInput, financeApi } from '../api';
import { LINE_INK, SERIES, StackedMonthsChart } from '../charts';

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const STATUS: Record<ProjectionMonth['status'], { label: string; icon: string; tone: 'accent' | 'warn' | 'danger' }> = {
  ok: { label: 'Dentro do limite', icon: '✓', tone: 'accent' },
  high: { label: 'Comprometido acima do limite', icon: '!', tone: 'warn' },
  deficit: { label: 'Falta dinheiro', icon: '✕', tone: 'danger' },
};

const describeFrequency = (e: PlanEntry) =>
  e.frequency === 'monthly'
    ? `todo mês${e.endMonth ? ` até ${formatMonth(e.endMonth)}` : ''}`
    : e.frequency === 'yearly'
      ? `todo ano em ${MONTH_NAMES[(e.monthOfYear ?? 1) - 1]}`
      : `uma vez em ${formatMonth(e.startMonth)}`;

// ---------- Projeção + simulador ----------

function SimulatorCard({ current, onSimulate, sim }: { current: string; onSimulate: (s: { amount: number; n: number; start: string } | null) => void; sim: { amount: number; n: number; start: string } | null }) {
  const [amount, setAmount] = useState(sim ? centsToInput(sim.amount) : '');
  const [n, setN] = useState(String(sim?.n ?? 10));
  const [start, setStart] = useState(sim?.start ?? current);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (!cents || cents <= 0) return setError('Informe o valor total da compra.');
    setError(null);
    onSimulate({ amount: cents, n: Math.max(1, Math.min(48, Number(n) || 1)), start });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_7rem_10rem_auto] sm:items-end">
      <Field label="Valor total">
        <Input inputMode="decimal" placeholder="ex.: 4.500,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Parcelas">
        <Input type="number" min={1} max={48} value={n} onChange={(e) => setN(e.target.value)} />
      </Field>
      <Field label="Primeira parcela">
        <Input type="month" min={current} value={start} onChange={(e) => setStart(e.target.value || current)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit">Simular</Button>
        {sim && (
          <Button variant="outline" onClick={() => (onSimulate(null), setAmount(''))}>
            Limpar
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-danger sm:col-span-4">{error}</p>}
    </form>
  );
}

// ---------- Rendas e gastos fixos ----------

function EntryForm({ current, initial, onDone }: { current: string; initial?: Partial<EntryInput>; onDone: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<EntryInput['kind']>(initial?.kind ?? 'income');
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(initial?.amountCents ? centsToInput(initial.amountCents) : '');
  const [frequency, setFrequency] = useState<EntryInput['frequency']>(initial?.frequency ?? 'monthly');
  const [monthOfYear, setMonthOfYear] = useState(initial?.monthOfYear ?? 12);
  const [startMonth, setStart] = useState(initial?.startMonth ?? current);
  const [endMonth, setEnd] = useState(initial?.endMonth ?? '');
  const [visibility, setVisibility] = useState<EntryInput['visibility']>(initial?.visibility ?? 'family');
  const save = useMutation({
    mutationFn: (e: EntryInput) => financeApi.createEntry(e),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance', 'plan'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (!cents || cents <= 0) return;
    save.mutate({ kind, name: name.trim(), amountCents: cents, frequency, monthOfYear: frequency === 'yearly' ? monthOfYear : null, startMonth, endMonth: frequency === 'monthly' && endMonth ? endMonth : null, visibility });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line bg-card-2/40 p-4 sm:grid-cols-2">
      <Field label="Tipo">
        <Select className="w-full" value={kind} onChange={(e) => setKind(e.target.value as EntryInput['kind'])}>
          <option value="income">Renda (entra)</option>
          <option value="expense">Gasto fixo (sai)</option>
        </Select>
      </Field>
      <Field label="Nome">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'income' ? 'ex.: Salário Ana' : 'ex.: Aluguel'} required maxLength={80} />
      </Field>
      <Field label="Valor">
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="ex.: 8.500,00" required />
      </Field>
      <Field label="Frequência">
        <Select className="w-full" value={frequency} onChange={(e) => setFrequency(e.target.value as EntryInput['frequency'])}>
          <option value="monthly">Todo mês</option>
          <option value="yearly">Uma vez por ano (ex.: 13º, IPVA)</option>
          <option value="once">Uma vez só (ex.: PLR, bônus)</option>
        </Select>
      </Field>
      {frequency === 'yearly' && (
        <Field label="Mês do ano">
          <Select className="w-full" value={monthOfYear} onChange={(e) => setMonthOfYear(Number(e.target.value))}>
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={frequency === 'once' ? 'Mês' : 'A partir de'}>
        <Input type="month" value={startMonth} onChange={(e) => setStart(e.target.value)} required />
      </Field>
      {frequency === 'monthly' && (
        <Field label="Até (opcional)" hint="Deixe vazio se não tem fim.">
          <Input type="month" value={endMonth} min={startMonth} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      )}
      <Field label="Quem vê" hint="Só o que é da família entra na projeção da família.">
        <Select className="w-full" value={visibility} onChange={(e) => setVisibility(e.target.value as EntryInput['visibility'])}>
          <option value="family">Família</option>
          <option value="private">Só eu</option>
        </Select>
      </Field>
      {save.isError && <p className="text-sm text-danger sm:col-span-2">{errorMessage(save.error)}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={save.isPending}>
          Salvar
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function EntriesCard({ current }: { current: string }) {
  const qc = useQueryClient();
  const entries = useQuery({ queryKey: ['finance', 'plan', 'entries'], queryFn: financeApi.planEntries });
  const suggestions = useQuery({ queryKey: ['finance', 'plan', 'suggestions'], queryFn: financeApi.suggestions, staleTime: 5 * 60_000 });
  const [form, setForm] = useState<Partial<EntryInput> | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const del = useMutation({ mutationFn: financeApi.deleteEntry, onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'plan'] }) });
  const toggle = useMutation({
    mutationFn: (e: PlanEntry) => financeApi.updateEntry(e.id, { visibility: e.visibility === 'family' ? 'private' : 'family' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'plan'] }),
  });
  const known = new Set((entries.data ?? []).map((e) => e.name.toLowerCase()));
  const pending = (suggestions.data ?? []).filter((s) => !known.has(s.name.toLowerCase()) && !dismissed.has(s.name));

  const list = (kind: 'income' | 'expense') => {
    const rows = entries.data?.filter((e) => e.kind === kind) ?? [];
    if (!rows.length) return <Empty>{kind === 'income' ? 'Nenhuma renda cadastrada.' : 'Nenhum gasto fixo cadastrado.'}</Empty>;
    return (
      <ul className="grid gap-2">
        {rows.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="truncate text-ink">{e.name}</div>
              <div className="text-xs text-muted">
                {describeFrequency(e)} · {e.editable ? (e.visibility === 'family' ? 'família vê' : 'só você vê') : `de ${e.ownerName}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={cx('font-semibold tabular-nums', kind === 'income' ? 'text-positive' : 'text-ink')}>{formatBRL(e.amountCents)}</span>
              {e.editable && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(e)} title="Alternar entre só você e família">
                    {e.visibility === 'family' ? 'Tornar privado' : 'Compartilhar'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => window.confirm(`Apagar "${e.name}"?`) && del.mutate(e.id)} aria-label={`Apagar ${e.name}`}>
                    ×
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <Card
      title="Rendas e gastos fixos"
      actions={
        !form && (
          <Button size="sm" onClick={() => setForm({})}>
            + Adicionar
          </Button>
        )
      }
    >
      {(entries.isError || del.isError) && <Notice tone="error">{errorMessage(entries.error ?? del.error)}</Notice>}
      {form && (
        <div className="mb-5">
          <EntryForm current={current} initial={form} onDone={() => setForm(null)} />
        </div>
      )}
      {entries.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-2">Rendas</h3>
            {list('income')}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-2">Gastos fixos</h3>
            {list('expense')}
          </div>
        </div>
      )}
      {pending.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="text-sm font-semibold text-ink-2">Encontrados nas suas contas</h3>
          <p className="mb-3 text-xs text-muted">Lançamentos que se repetem nos últimos meses com valor parecido. Confira antes de adicionar.</p>
          <ul className="grid gap-2 lg:grid-cols-2">
            {pending.map((s) => (
              <li key={`${s.kind}-${s.name}`} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate text-ink">{s.name}</div>
                  <div className="text-xs text-muted">
                    {s.kind === 'income' ? 'entrada' : 'saída'} · em {s.monthsSeen} dos últimos 4 meses · por volta do dia {s.dayOfMonth}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="mr-1 font-medium tabular-nums">{formatBRL(s.amountCents)}</span>
                  <Button size="sm" variant="outline" onClick={() => setForm({ kind: s.kind, name: s.name, amountCents: s.amountCents, frequency: 'monthly', startMonth: current })}>
                    Usar
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Ignorar ${s.name}`} onClick={() => setDismissed((d) => new Set(d).add(s.name))}>
                    ×
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function SettingsCard({ variableCents, variableSource }: { variableCents: number; variableSource: 'auto' | 'manual' }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['finance', 'plan', 'settings'], queryFn: financeApi.settings });
  const [limit, setLimit] = useState<string | null>(null);
  const [variable, setVariable] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: financeApi.updateSettings,
    onSuccess: () => (setLimit(null), setVariable(null), qc.invalidateQueries({ queryKey: ['finance', 'plan'] })),
  });
  if (!settings.data) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = variable === null ? undefined : variable.trim() === '' ? null : parseBRL(variable);
    save.mutate({ commitLimitPct: limit === null ? undefined : Number(limit), variableOverrideCents: v });
  };
  return (
    <Card title="Parâmetros da família">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <Field label="Limite saudável (%)" hint="Fixos + parcelas sobre a renda.">
          <Input type="number" min={5} max={100} value={limit ?? settings.data.commitLimitPct} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Field
          label="Gasto variável por mês"
          hint={variableSource === 'auto' ? `Automático: ${formatBRL(variableCents)} (média de 3 meses sem parcelas, menos os fixos). Digite para fixar um valor.` : 'Valor fixado manualmente. Apague para voltar ao automático.'}
        >
          <Input inputMode="decimal" placeholder={centsToInput(variableCents)} value={variable ?? (settings.data.variableOverrideCents !== null ? centsToInput(settings.data.variableOverrideCents) : '')} onChange={(e) => setVariable(e.target.value)} />
        </Field>
        <Button type="submit" variant="outline" loading={save.isPending} disabled={limit === null && variable === null}>
          Salvar
        </Button>
      </form>
      {save.isError && <p className="mt-2 text-sm text-danger">{errorMessage(save.error)}</p>}
    </Card>
  );
}

// ---------- Página ----------

export function Planning() {
  const { household } = useSession();
  const [params, setParams] = useSearchParams();
  const scope = (params.get('visao') as PlanScope | null) ?? 'family';
  const [sim, setSim] = useState<{ amount: number; n: number; start: string } | null>(null);

  const q = new URLSearchParams({ scope, months: '12' });
  if (sim) {
    q.set('simAmount', String(sim.amount));
    q.set('simInstallments', String(sim.n));
    q.set('simStart', sim.start);
  }
  const projection = useQuery({
    queryKey: ['finance', 'plan', 'projection', q.toString()],
    queryFn: () => financeApi.projection(q.toString()),
    placeholderData: keepPreviousData,
  });
  const p = projection.data;
  const first = p?.months[0];
  const avgFree = p ? Math.round(p.months.reduce((a, m) => a + m.freeCents, 0) / p.months.length) : 0;
  const verdict = p?.simulation?.verdict;

  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title="Planejamento"
        description="Para onde vai a renda nos próximos 12 meses: gastos fixos, parcelas, gasto do dia a dia e o que guardar para as metas."
        actions={
          <Segmented<PlanScope>
            label="Visão"
            value={scope}
            onChange={(v) =>
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('visao', v);
                  return next;
                },
                { replace: true },
              )
            }
            options={[
              { value: 'family', label: 'Família' },
              { value: 'mine', label: 'Só eu' },
            ]}
          />
        }
      />
      {projection.isError && <Notice tone="error">{errorMessage(projection.error)}</Notice>}
      {!p || !first ? (
        <Loading />
      ) : (
        <>
          {!p.hasIncome && (
            <Notice tone="info">
              Cadastre as rendas {scope === 'family' ? 'compartilhadas com a família' : 'suas'} em “Rendas e gastos fixos” para ver quanto sobra e o quanto está comprometido.
            </Notice>
          )}
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label={`Renda em ${formatMonth(first.month)}`} value={formatBRL(first.incomeCents)} sub="Rendas cadastradas" />
            <StatTile
              label="Comprometido este mês"
              value={first.commitPct === null ? '—' : `${first.commitPct.toLocaleString('pt-BR')}%`}
              sub={
                <span className={first.status === 'ok' ? 'text-positive' : first.status === 'high' ? 'text-warn' : 'text-danger'}>
                  {STATUS[first.status].icon} {STATUS[first.status].label} (limite {p.commitLimitPct}%)
                </span>
              }
            />
            <StatTile label="Livre por mês (média)" value={formatBRL(avgFree)} sub="Depois de fixos, parcelas, dia a dia e metas" />
            <StatTile label="Saldo em conta hoje" value={formatBRL(p.startBalanceCents)} sub={scope === 'family' ? 'Contas compartilhadas' : 'Suas contas'} />
          </div>

          <Card title="Cabe no orçamento?" className="mb-5">
            <p className="mb-4 text-sm text-muted">Simule uma compra ou viagem parcelada e veja o efeito em cada mês antes de decidir.</p>
            <SimulatorCard current={p.current} sim={sim} onSimulate={setSim} />
            {verdict && p.simulation && (
              <div className="mt-4">
                {verdict.fits ? (
                  <Notice tone="success">
                    Cabe. {formatBRL(p.simulation.input.amountCents)} em {p.simulation.input.installments}x a partir de {formatMonth(p.simulation.input.startMonth)}: no mês mais
                    apertado ({verdict.worstMonth && formatMonth(verdict.worstMonth)}) ainda sobram {formatBRL(verdict.worstFreeCents ?? 0)}, e o comprometimento chega a{' '}
                    {verdict.maxCommitPct ?? 0}%.
                  </Notice>
                ) : (
                  <Notice tone="warn">
                    {verdict.alreadyTightMonths > 0 && (
                      <>
                        <b>Mesmo sem essa compra</b>, {verdict.alreadyTightMonths === 1 ? '1 mês do período já fica' : `${verdict.alreadyTightMonths} meses do período já ficam`} no vermelho ou acima do limite —
                        revise rendas, fixos ou o gasto do dia a dia antes.{' '}
                      </>
                    )}
                    Não cabe do jeito simulado: em {verdict.worstMonth && formatMonth(verdict.worstMonth)} {(verdict.worstFreeCents ?? 0) < 0 ? `faltariam ${formatBRL(-(verdict.worstFreeCents ?? 0))}` : `o comprometimento iria a ${verdict.maxCommitPct}% (limite ${p.commitLimitPct}%)`}.
                    {verdict.suggestedStartMonth && <> Começando em <b>{formatMonth(verdict.suggestedStartMonth)}</b>, cabe.</>}
                    {verdict.suggestedInstallments && <> Em <b>{verdict.suggestedInstallments}x</b>, cabe.</>}
                    {!verdict.suggestedStartMonth && !verdict.suggestedInstallments && <> Nem adiando 12 meses nem parcelando em até 24x cabe — vale juntar antes (crie uma meta).</>}
                  </Notice>
                )}
              </div>
            )}
          </Card>

          <Card title="Para onde vai a renda" className="mb-5">
            <StackedMonthsChart
              label="Projeção mensal: renda e destino do dinheiro"
              rows={p.months.map((m) => ({
                month: m.month,
                fixedCents: m.fixedCents,
                installmentsCents: m.installmentsCents + m.simulatedCents,
                variableCents: m.variableCents,
                goalsCents: m.goalsCents,
                freeCents: Math.max(0, m.freeCents),
                incomeCents: m.incomeCents,
              }))}
              series={[
                { key: 'fixedCents', label: 'Fixos', color: SERIES[0] },
                { key: 'installmentsCents', label: sim ? 'Parcelas (com a simulação)' : 'Parcelas', color: SERIES[1] },
                { key: 'variableCents', label: 'Dia a dia (estimado)', color: SERIES[2] },
                { key: 'goalsCents', label: 'Metas', color: SERIES[3] },
                { key: 'freeCents', label: 'Livre', color: SERIES[4] },
              ]}
              line={{ key: 'incomeCents', label: 'Renda', color: LINE_INK }}
            />
            <div className="-mx-2 mt-5 overflow-x-auto px-2">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Mês</th>
                    <th className={cx(thClass, 'text-right')}>Renda</th>
                    <th className={cx(thClass, 'text-right')}>Comprometido</th>
                    <th className={cx(thClass, 'text-right')}>Livre</th>
                    <th className={cx(thClass, 'text-right')}>Saldo previsto</th>
                    <th className={thClass}>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {p.months.map((m) => (
                    <tr key={m.month}>
                      <td className={tdClass}>{formatMonth(m.month)}</td>
                      <td className={cx(tdClass, 'text-right tabular-nums')}>{formatBRL(m.incomeCents)}</td>
                      <td className={cx(tdClass, 'text-right tabular-nums')}>{m.commitPct === null ? '—' : `${m.commitPct.toLocaleString('pt-BR')}%`}</td>
                      <td className={cx(tdClass, 'text-right font-medium tabular-nums', m.freeCents < 0 ? 'text-danger' : 'text-ink')}>{formatBRL(m.freeCents)}</td>
                      <td className={cx(tdClass, 'text-right tabular-nums', m.balanceCents < 0 ? 'text-danger' : 'text-ink-2')}>{formatBRL(m.balanceCents)}</td>
                      <td className={tdClass}>
                        <Pill tone={STATUS[m.status].tone}>
                          <span aria-hidden>{STATUS[m.status].icon}</span> {STATUS[m.status].label}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted">
              Parcelas incluem as previstas pelo app. Dia a dia: {formatBRL(p.variableCents)}/mês ({p.variableSource === 'auto' ? 'estimado das suas contas' : 'definido pela família'}). Metas: quanto guardar por mês para chegar no valor até a data.
            </p>
          </Card>

          <div className="grid gap-5">
            <EntriesCard current={p.current} />
            {scope === 'family' && isManager(household.role) && <SettingsCard variableCents={p.variableCents} variableSource={p.variableSource} />}
          </div>
        </>
      )}
    </>
  );
}
