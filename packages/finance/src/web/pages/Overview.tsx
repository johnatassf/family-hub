import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, Loading, Notice, PageHeader, Select, StatTile, errorMessage, formatMonth } from '@familia/ui';
import { formatBRL } from '../../shared';
import { financeApi } from '../api';
import { BarList, MonthlyChart, ScopeBar, TxTable, useScope } from '../components';

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function Overview() {
  const { query, params, set } = useScope();
  const all = useQuery({ queryKey: ['finance', 'summary', query.toString()], queryFn: () => financeApi.summary(query.toString()) });

  const months = all.data?.months ?? [];
  const today = currentMonth();
  const fallback = [...months].reverse().find((m) => m.month <= today)?.month ?? months.at(-1)?.month ?? today;
  const selected = params.get('mes') ?? fallback;

  const monthQuery = new URLSearchParams(query);
  monthQuery.set('month', selected);
  const month = useQuery({
    queryKey: ['finance', 'summary', monthQuery.toString()],
    queryFn: () => financeApi.summary(monthQuery.toString()),
    enabled: all.isSuccess,
  });
  const recentQuery = new URLSearchParams(query);
  recentQuery.set('limit', '8');
  const recent = useQuery({ queryKey: ['finance', 'tx', recentQuery.toString()], queryFn: () => financeApi.transactions(recentQuery.toString()) });

  const m = months.find((x) => x.month === selected);
  const chartMonths = months.filter((x) => x.month <= selected).slice(-12);

  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Visão geral" description="Gastos das suas contas e dos cartões que a família compartilhou." actions={<ScopeBar />} />
      {all.isError && <Notice tone="error">{errorMessage(all.error)}</Notice>}
      {all.isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <Select aria-label="Mês" value={selected} onChange={(e) => set('mes', e.target.value)}>
              {[...months].reverse().map((x) => (
                <option key={x.month} value={x.month}>
                  {formatMonth(x.month)}
                </option>
              ))}
              {!months.length && <option value={selected}>{formatMonth(selected)}</option>}
            </Select>
            <span className="text-xs text-muted">Mês de referência (fatura/competência)</span>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Despesas no mês" value={formatBRL(m?.expensesCents ?? 0)} sub="Sem pagamentos de fatura" />
            <StatTile label="Entradas no mês" value={formatBRL(m?.incomeCents ?? 0)} sub="Créditos identificados" />
            <StatTile label="Saldo do mês" value={formatBRL(m?.netCents ?? 0)} sub="Entradas − despesas" />
            <StatTile
              label="Para revisar"
              value={month.data?.review ?? '—'}
              sub={
                <Link to="revisar" className="text-accent hover:underline">
                  Categoria incerta →
                </Link>
              }
            />
          </div>
          <div className="mb-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <Card title="Despesas por mês">
              <MonthlyChart months={chartMonths} selected={selected} />
            </Card>
            <Card title={`Quem gastou em ${formatMonth(selected)}`}>
              <BarList
                rows={(month.data?.byPerson ?? []).map((p) => ({ key: p.userId, label: p.name, cents: p.expensesCents }))}
                empty="Sem despesas neste mês."
              />
              <p className="mt-4 text-xs text-muted">
                Em cartões compartilhados, o dono da conta pode indicar quem fez cada gasto na tela de transações.
              </p>
            </Card>
          </div>
          <div className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
            <Card title={`Categorias em ${formatMonth(selected)}`}>
              <BarList
                rows={(month.data?.categories ?? []).slice(0, 8).map((c) => ({ key: c.category, label: c.category, cents: c.totalCents }))}
                empty="Sem despesas neste mês."
              />
            </Card>
            <Card
              title="Últimas transações"
              actions={
                <Link to="transacoes" className="text-sm text-accent hover:underline">
                  Ver todas →
                </Link>
              }
            >
              <TxTable rows={recent.data ?? []} compact />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
