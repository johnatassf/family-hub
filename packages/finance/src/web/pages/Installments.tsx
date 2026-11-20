import { useQuery } from '@tanstack/react-query';
import { Card, Empty, Loading, Notice, PageHeader, Pill, StatTile, cx, errorMessage, formatMonth, tableClass, tdClass, thClass } from '@familia/ui';
import { formatBRL } from '../../shared';
import { financeApi } from '../api';
import { Progress, SERIES, StackedMonthsChart } from '../charts';
import { ScopeBar, useScope } from '../components';

export function Installments() {
  const { query } = useScope();
  const q = new URLSearchParams(query);
  q.set('months', '12');
  const data = useQuery({ queryKey: ['finance', 'installments', q.toString()], queryFn: () => financeApi.installments(q.toString()) });
  const d = data.data;

  // "Quando libera": meses em que o compromisso cai em relação ao mês anterior.
  const releases =
    d?.timeline
      .map((m, i, all) => {
        const total = m.realCents + m.projectedCents;
        const prev = i > 0 ? all[i - 1]!.realCents + all[i - 1]!.projectedCents : null;
        return prev !== null && prev > total ? { month: m.month, freedCents: prev - total } : null;
      })
      .filter((x): x is { month: string; freedCents: number } => x !== null) ?? [];
  const last = d?.purchases.reduce<(typeof d.purchases)[number] | null>((a, p) => (!a || p.endMonth > a.endMonth ? p : a), null);

  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title="Parcelas e compromissos"
        description="Tudo o que já está comprometido nos próximos meses. Quando o banco só lança a parcela do mês, o app prevê as demais."
        actions={<ScopeBar />}
      />
      {data.isError && <Notice tone="error">{errorMessage(data.error)}</Notice>}
      {data.isLoading || !d ? (
        <Loading />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Ainda a pagar" value={formatBRL(d.totals.remainingCents)} sub={`${d.totals.remainingCount} parcelas em ${d.totals.activePurchases} compras`} />
            <StatTile label={`Parcelas em ${formatMonth(d.current)}`} value={formatBRL(d.totals.thisMonthCents)} sub="Já comprometido neste mês" />
            <StatTile label="Previsto pelo app" value={formatBRL(d.totals.projectedCents)} sub="Parcelas que o banco ainda não lançou" />
            <StatTile label="Última parcela" value={last ? formatMonth(last.endMonth) : '—'} sub={last ? last.description : 'Nenhuma compra parcelada em aberto'} />
          </div>

          <div className="mb-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <Card title="Compromisso com parcelas por mês">
              <StackedMonthsChart
                label="Parcelas por mês, lançadas pelo banco e previstas pelo app"
                rows={d.timeline}
                series={[
                  { key: 'realCents', label: 'Lançadas pelo banco', color: SERIES[0] },
                  { key: 'projectedCents', label: 'Previstas pelo app', color: SERIES[1] },
                ]}
              />
            </Card>
            <Card title="Quando o orçamento libera">
              {releases.length ? (
                <ul className="grid gap-3">
                  {releases.map((r) => (
                    <li key={r.month} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-sm">
                      <span className="text-ink-2">A partir de {formatMonth(r.month)}</span>
                      <span className="font-semibold text-positive tabular-nums">+{formatBRL(r.freedCents)}/mês</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Nenhuma parcela termina nos próximos 12 meses.</Empty>
              )}
            </Card>
          </div>

          <Card title="Compras parceladas em aberto">
            {d.purchases.length ? (
              <div className="-mx-2 overflow-x-auto px-2">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Compra</th>
                      <th className={thClass}>Cartão</th>
                      <th className={thClass}>Quem gastou</th>
                      <th className={cx(thClass, 'text-right')}>Parcela</th>
                      <th className={cx(thClass, 'w-48')}>Andamento</th>
                      <th className={thClass}>Termina</th>
                      <th className={cx(thClass, 'text-right')}>Falta pagar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.purchases.map((p) => {
                      const done = p.totalInstallments - p.remainingCount;
                      return (
                        <tr key={p.key}>
                          <td className={cx(tdClass, 'max-w-[260px] truncate text-ink')} title={p.description}>
                            {p.description}
                          </td>
                          <td className={cx(tdClass, 'text-ink-2')}>
                            {p.accountLabel}
                            {p.cardLast4 && <span className="ml-1 text-muted">•{p.cardLast4}</span>}
                          </td>
                          <td className={cx(tdClass, 'text-ink-2')}>{p.spenderName}</td>
                          <td className={cx(tdClass, 'text-right tabular-nums')}>{formatBRL(p.installmentCents)}</td>
                          <td className={tdClass}>
                            <div className="flex items-center gap-2">
                              <Progress value={done} max={p.totalInstallments} label={`${done} de ${p.totalInstallments} parcelas`} />
                              <span className="text-xs whitespace-nowrap text-muted tabular-nums">
                                {done}/{p.totalInstallments}
                              </span>
                            </div>
                          </td>
                          <td className={tdClass}>
                            <span className="text-ink-2">{formatMonth(p.endMonth)}</span>
                            {p.projectedCount > 0 && (
                              <span className="ml-2">
                                <Pill tone="warn">{p.projectedCount} previstas</Pill>
                              </span>
                            )}
                          </td>
                          <td className={cx(tdClass, 'text-right font-medium text-ink tabular-nums')}>{formatBRL(p.remainingCents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Nenhuma compra parcelada em aberto nas contas que você vê.</Empty>
            )}
            <p className="mt-4 text-xs text-muted">
              “Previstas” são parcelas que o banco ainda não lançou; o app as calcula a partir do “parcela n de N” e troca pela real quando ela chega.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
