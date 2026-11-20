import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Empty, Select, Segmented, cellInputClass, cx, errorMessage, formatDate, formatMonth, tableClass, tdClass, thClass } from '@familia/ui';
import { type FinTransaction, type Scope, formatBRL } from '../shared';
import { type TxPatch, financeApi } from './api';

/** Cor única das marcas dos gráficos (validada contra a superfície #141f2b: banda de luminosidade, croma e contraste). */
export const CHART_COLOR = '#36a877';
const GRID = '#263747';
const AXIS = '#344253';
const MUTED = '#8d9aab';

const compactBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });

// ---------- Filtro de escopo (na URL, para sobreviver à navegação) ----------

export function useScope() {
  const [params, setParams] = useSearchParams();
  const scope = (params.get('escopo') as Scope | null) ?? 'all';
  const member = params.get('pessoa') ?? '';
  const set = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value && value !== 'all') next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const query = new URLSearchParams();
  if (scope !== 'all') query.set('scope', scope);
  if (member) query.set('member', member);
  return { scope, member, query, setScope: (v: Scope) => set('escopo', v), setMember: (v: string) => set('pessoa', v), params, set };
}

export function useMembers() {
  return useQuery({ queryKey: ['finance', 'members'], queryFn: financeApi.members, staleTime: 60_000 });
}

export function ScopeBar() {
  const { scope, member, setScope, setMember } = useScope();
  const members = useMembers();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<Scope>
        label="Quais contas"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'all', label: 'Tudo que vejo' },
          { value: 'mine', label: 'Minhas contas' },
          { value: 'family', label: 'Compartilhadas' },
        ]}
      />
      <Select aria-label="Gastos de quem" value={member} onChange={(e) => setMember(e.target.value)}>
        <option value="">Todas as pessoas</option>
        {members.data?.map((m) => (
          <option key={m.userId} value={m.userId}>
            Gastos de {m.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

// ---------- Gráfico mensal (série única: sem legenda; tooltip + tabela acessível) ----------

export function MonthlyChart({ months, selected }: { months: { month: string; expensesCents: number }[]; selected?: string }) {
  if (!months.length) return <Empty>Sincronize uma conexão para ver os gastos por mês.</Empty>;
  const data = months.map((m) => ({ month: m.month, label: formatMonth(m.month), value: m.expensesCents / 100 }));
  return (
    <div>
      <div className="h-64" role="img" aria-label="Despesas por mês, em reais">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: AXIS }} tick={{ fill: MUTED, fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={(v: number) => compactBRL.format(v)} tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 11 }} width={64} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={({ active, payload }) => {
                const p = active ? payload?.[0]?.payload : null;
                if (!p) return null;
                return (
                  <div className="rounded-lg border border-line-strong bg-page px-3 py-2 text-xs shadow-lg">
                    <div className="text-muted">{p.label}</div>
                    <div className="mt-0.5 font-semibold text-ink tabular-nums">{formatBRL(Math.round(p.value * 100))}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="value" fill={CHART_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer select-none hover:text-ink-2">Ver como tabela</summary>
        <table className={cx(tableClass, 'mt-2')}>
          <thead>
            <tr>
              <th className={thClass}>Mês</th>
              <th className={cx(thClass, 'text-right')}>Despesas</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className={m.month === selected ? 'text-ink' : undefined}>
                <td className={tdClass}>{formatMonth(m.month)}</td>
                <td className={cx(tdClass, 'text-right tabular-nums')}>{formatBRL(m.expensesCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Lista de barras horizontais (série única): rótulo, barra e valor na ponta. */
export function BarList({ rows, empty }: { rows: { key: string; label: string; cents: number }[]; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <ul className="grid gap-3.5">
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${formatBRL(r.cents)}`}>
          <div className="mb-1.5 flex justify-between gap-3 text-xs">
            <span className="truncate text-ink-2">{r.label}</span>
            <span className="font-medium text-ink tabular-nums">{formatBRL(r.cents)}</span>
          </div>
          <div className="h-2 rounded-r bg-line/60">
            <div className="h-full rounded-r" style={{ width: `${Math.max(1, (r.cents / max) * 100)}%`, background: CHART_COLOR }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------- Tabela de transações (edição só nas contas da própria pessoa) ----------

export function TxTable({ rows, categories, compact }: { rows: FinTransaction[]; categories?: string[]; compact?: boolean }) {
  const qc = useQueryClient();
  const members = useMembers();
  const edit = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TxPatch }) => financeApi.editTransaction(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance'] }),
  });

  if (!rows.length) return <Empty>Nenhuma transação encontrada.</Empty>;
  return (
    <div>
      {edit.isError && <p className="mb-3 text-sm text-danger">{errorMessage(edit.error)}</p>}
      <div className="-mx-2 overflow-x-auto px-2">
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={thClass}>Data</th>
              <th className={thClass}>Descrição</th>
              {!compact && <th className={thClass}>Conta</th>}
              <th className={thClass}>Quem gastou</th>
              {!compact && <th className={thClass}>Categoria</th>}
              {!compact && <th className={thClass}>Mês ref.</th>}
              {!compact && <th className={thClass}>Parcela</th>}
              <th className={cx(thClass, 'text-right')}>Valor</th>
              {!compact && <th className={thClass}>Ignorar</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const can = r.editable && !compact;
              const patch = (p: TxPatch) => edit.mutate({ id: r.id, patch: p });
              return (
                <tr key={r.id} className={cx('hover:bg-card-2/60', r.excluded && 'opacity-50')}>
                  <td className={cx(tdClass, 'text-ink-2 tabular-nums')}>{formatDate(r.date)}</td>
                  <td className={cx(tdClass, 'max-w-[260px] truncate text-ink')} title={r.description}>
                    {r.description}
                  </td>
                  {!compact && (
                    <td className={cx(tdClass, 'max-w-[200px] truncate text-ink-2')} title={r.accountLabel}>
                      {r.accountLabel}
                      {r.cardLast4 && <span className="ml-1 text-muted">•{r.cardLast4}</span>}
                    </td>
                  )}
                  <td className={tdClass}>
                    {can ? (
                      <select
                        aria-label="Quem gastou"
                        className={cellInputClass}
                        value={r.assignedUserId ?? ''}
                        onChange={(e) => patch({ assignedUserId: e.target.value || null })}
                      >
                        <option value="">{r.ownerName} (dono)</option>
                        {members.data
                          ?.filter((m) => m.userId !== r.ownerUserId)
                          .map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <span className="text-ink-2">{r.spenderName}</span>
                    )}
                  </td>
                  {!compact && (
                    <td className={tdClass}>
                      <div className="flex items-center gap-1.5">
                        {can && categories ? (
                          <select aria-label="Categoria" className={cellInputClass} value={r.category} onChange={(e) => patch({ category: e.target.value })}>
                            {[...new Set([...categories, r.category])].map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-ink-2">{r.category}</span>
                        )}
                        {r.confidence === 'Baixa' && (
                          <span className="text-warn" title="Classificação automática incerta: confira a categoria" aria-label="Revisar categoria">
                            ●
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                  {!compact && (
                    <td className={tdClass}>
                      {can ? (
                        <input
                          type="month"
                          aria-label="Mês de referência"
                          className={cellInputClass}
                          defaultValue={r.referenceMonth}
                          onBlur={(e) => e.target.value && e.target.value !== r.referenceMonth && patch({ referenceMonth: e.target.value })}
                        />
                      ) : (
                        <span className="text-ink-2">{formatMonth(r.referenceMonth)}</span>
                      )}
                    </td>
                  )}
                  {!compact && <td className={cx(tdClass, 'text-muted')}>{r.installment || '—'}</td>}
                  <td className={cx(tdClass, 'text-right font-medium tabular-nums', r.amountCents < 0 ? 'text-danger' : 'text-positive')}>
                    {formatBRL(r.amountCents)}
                  </td>
                  {!compact && (
                    <td className={tdClass}>
                      {can ? (
                        <input type="checkbox" aria-label="Ignorar nos totais" checked={r.excluded} onChange={(e) => patch({ excluded: e.target.checked })} />
                      ) : (
                        <span className="text-muted" title="Só quem conectou a conta edita">
                          {r.excluded ? 'Sim' : '—'}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
