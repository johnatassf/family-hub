import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_SERIES, Card, Empty, Input, Loading, Notice, PageHeader, StatTile, errorMessage, formatMonth, whatsappLink } from '@familia/ui';
import { PAYMENT_LABEL, formatBRL } from '../../shared';
import { todayBR } from '../api';
import { useBiz } from '../context';

const compactBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });

/** Entradas previstas (fiado a receber) × saídas previstas (boletos) nos próximos 3 meses. */
function CashflowChart({ rows }: { rows: { month: string; inCents: number; outCents: number }[] }) {
  const data = rows.map((r) => ({ label: formatMonth(r.month), in: r.inCents / 100, out: r.outCents / 100 }));
  const series = [
    { key: 'in', label: 'A receber (fiado)', color: CHART_SERIES[0] },
    { key: 'out', label: 'A pagar (boletos)', color: CHART_SERIES[1] },
  ];
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-4 text-xs text-ink-2">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="h-56" role="img" aria-label="Entradas e saídas previstas por mês">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="#263747" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#344253' }} tick={{ fill: '#8d9aab', fontSize: 11 }} />
            <YAxis tickFormatter={(v: number) => compactBRL.format(v)} tickLine={false} axisLine={false} tick={{ fill: '#8d9aab', fontSize: 11 }} width={60} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={({ active, payload }) => {
                const p = active ? payload?.[0]?.payload : null;
                if (!p) return null;
                return (
                  <div className="rounded-lg border border-line-strong bg-page px-3 py-2 text-xs">
                    <div className="mb-1 text-muted">{p.label}</div>
                    {series.map((s) => (
                      <div key={s.key} className="flex justify-between gap-4">
                        <span className="text-ink-2">{s.label}</span>
                        <span className="text-ink tabular-nums">{formatBRL(Math.round(p[s.key] * 100))}</span>
                      </div>
                    ))}
                    <div className="mt-1 flex justify-between gap-4 border-t border-line pt-1">
                      <span className="text-ink-2">Saldo</span>
                      <span className="font-semibold text-ink tabular-nums">{formatBRL(Math.round((p.in - p.out) * 100))}</span>
                    </div>
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted">Atrasados entram no mês atual. Fiado sem data combinada também.</p>
    </div>
  );
}

export function Dashboard() {
  const { api, key, business } = useBiz();
  const [month, setMonth] = useState(todayBR().slice(0, 7));
  const d = useQuery({ queryKey: [...key, 'dashboard', month], queryFn: () => api.dashboard(month) });
  const data = d.data;
  return (
    <>
      <PageHeader
        eyebrow="Empresa"
        title={business.name}
        description="Resumo da loja: vendas, lucro, o que tem para receber e para pagar."
        actions={<Input type="month" className="w-auto" value={month} onChange={(e) => setMonth(e.target.value || todayBR().slice(0, 7))} aria-label="Mês" />}
      />
      {d.isError && <Notice tone="error">{errorMessage(d.error)}</Notice>}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label={`Vendas em ${formatMonth(month)}`} value={formatBRL(data.sales.revenueCents)} sub={`${data.sales.count} vendas · ticket médio ${formatBRL(data.sales.ticketCents)}`} />
            <StatTile
              label="Lucro bruto"
              value={formatBRL(data.sales.profitCents)}
              sub={data.sales.costCoveragePct < 100 ? `Só ${data.sales.costCoveragePct}% das vendas têm custo cadastrado` : 'Preço − custo dos produtos'}
            />
            <StatTile
              label="A receber (fiado)"
              value={formatBRL(data.receivable.totalCents)}
              sub={
                <Link to="receber" className={data.receivable.overdueCents ? 'text-danger hover:underline' : 'text-accent hover:underline'}>
                  {data.receivable.overdueCents ? `${formatBRL(data.receivable.overdueCents)} vencido →` : `${data.receivable.customers} cliente(s) →`}
                </Link>
              }
            />
            <StatTile
              label="Boletos nos próximos 30 dias"
              value={formatBRL(data.payable.next30Cents)}
              sub={
                <Link to="boletos" className={data.payable.overdueCents ? 'text-danger hover:underline' : 'text-accent hover:underline'}>
                  {data.payable.overdueCents ? `${formatBRL(data.payable.overdueCents)} vencido →` : `${formatBRL(data.payable.openCents)} em aberto →`}
                </Link>
              }
            />
          </div>

          <div className="mb-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <Card title="Caixa previsto">
              <CashflowChart rows={data.cashflow} />
            </Card>
            <Card title="Mais vendidos no mês">
              {data.topProducts.length ? (
                <ul className="grid gap-2 text-sm">
                  {data.topProducts.map((p) => (
                    <li key={p.name} className="flex justify-between gap-3 border-b border-line/60 py-1.5">
                      <span className="truncate text-ink-2">
                        {p.qty}× {p.name}
                      </span>
                      <span className="text-ink tabular-nums">{formatBRL(p.revenueCents)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Sem vendas no mês.</Empty>
              )}
              {data.byMethod.length > 0 && (
                <p className="mt-4 text-xs text-muted">
                  {data.byMethod.map((m) => `${PAYMENT_LABEL[m.method]} ${formatBRL(m.totalCents)}`).join(' · ')}
                </p>
              )}
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Estoque baixo">
              {data.lowStock.length ? (
                <ul className="grid gap-2 text-sm">
                  {data.lowStock.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3">
                      <span className="text-ink-2">{p.name}</span>
                      <span className={p.stockQty <= 0 ? 'text-danger' : 'text-warn'}>
                        {p.stockQty} (mín. {p.minStock})
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Nada abaixo do mínimo. Defina o estoque mínimo nos produtos para ser avisada.</Empty>
              )}
            </Card>
            <Card title={`Aniversariantes de ${formatMonth(month)}`}>
              {data.birthdays.length ? (
                <ul className="grid gap-2 text-sm">
                  {data.birthdays.map((c) => {
                    const link = whatsappLink(c.phone, `Oi, ${c.name.split(' ')[0]}! Feliz aniversário! 🎉 Separei umas sugestões de presente especiais pra você esse mês.`);
                    return (
                      <li key={c.id} className="flex justify-between gap-3">
                        <span className="text-ink-2">
                          {c.name} · {c.birthday.slice(3)}/{c.birthday.slice(0, 2)}
                        </span>
                        {link && (
                          <a href={link} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                            Mandar parabéns
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>Cadastre o aniversário dos clientes para lembrar de mandar um presente.</Empty>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
