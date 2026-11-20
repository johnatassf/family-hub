import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, Empty, Input, Loading, Notice, PageHeader, Pill, StatTile, cx, errorMessage, formatDate, formatMonth, tableClass, tdClass, thClass } from '@familia/ui';
import { PAYMENT_LABEL, formatBRL } from '../../shared';
import { todayBR } from '../api';
import { useBiz } from '../context';

export function Sales() {
  const { api, key, canWrite, business } = useBiz();
  const qc = useQueryClient();
  const [month, setMonth] = useState(todayBR().slice(0, 7));
  const sales = useQuery({ queryKey: [...key, 'sales', month], queryFn: () => api.sales({ month }) });
  const cancel = useMutation({ mutationFn: api.cancelSale, onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const valid = (sales.data ?? []).filter((s) => s.status !== 'canceled');
  const revenue = valid.reduce((a, s) => a + s.totalCents, 0);
  return (
    <>
      <PageHeader
        eyebrow={business.name}
        title="Vendas"
        description="Tudo o que foi vendido no mês. Cancelar devolve os produtos ao estoque."
        actions={<Input type="month" className="w-auto" value={month} onChange={(e) => setMonth(e.target.value || todayBR().slice(0, 7))} aria-label="Mês" />}
      />
      {(sales.isError || cancel.isError) && <Notice tone="error">{errorMessage(sales.error ?? cancel.error)}</Notice>}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label={`Faturamento em ${formatMonth(month)}`} value={formatBRL(revenue)} sub={`${valid.length} vendas`} />
        <StatTile label="Recebido" value={formatBRL(valid.reduce((a, s) => a + s.paidCents, 0))} />
        <StatTile label="Em aberto (fiado)" value={formatBRL(valid.reduce((a, s) => a + s.balanceCents, 0))} />
      </div>
      <Card>
        {sales.isLoading ? (
          <Loading />
        ) : sales.data?.length ? (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>Data</th>
                  <th className={thClass}>Cliente</th>
                  <th className={thClass}>Itens</th>
                  <th className={thClass}>Pagamento</th>
                  <th className={cx(thClass, 'text-right')}>Total</th>
                  <th className={thClass}>Situação</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody>
                {sales.data.map((s) => (
                  <tr key={s.id} className={cx(s.status === 'canceled' && 'opacity-50')}>
                    <td className={cx(tdClass, 'text-ink-2 tabular-nums')}>{formatDate(s.date)}</td>
                    <td className={cx(tdClass, 'text-ink')}>{s.customerName ?? 'Balcão'}</td>
                    <td className={cx(tdClass, 'max-w-[320px] truncate text-ink-2')} title={s.items.map((i) => `${i.qty}× ${i.description}`).join(', ')}>
                      {s.items.map((i) => `${i.qty}× ${i.description}`).join(', ')}
                    </td>
                    <td className={cx(tdClass, 'text-ink-2')}>{PAYMENT_LABEL[s.paymentMethod]}</td>
                    <td className={cx(tdClass, 'text-right font-medium tabular-nums')}>{formatBRL(s.totalCents)}</td>
                    <td className={tdClass}>
                      {s.status === 'canceled' ? <Pill>Cancelada</Pill> : s.status === 'open' ? <Pill tone="warn">Deve {formatBRL(s.balanceCents)}</Pill> : <Pill tone="accent">✓ Paga</Pill>}
                    </td>
                    <td className={cx(tdClass, 'text-right')}>
                      {canWrite && s.status !== 'canceled' && (
                        <Button size="sm" variant="ghost" onClick={() => window.confirm('Cancelar esta venda? Os produtos voltam ao estoque.') && cancel.mutate(s.id)}>
                          Cancelar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nenhuma venda em {formatMonth(month)}.</Empty>
        )}
      </Card>
    </>
  );
}
