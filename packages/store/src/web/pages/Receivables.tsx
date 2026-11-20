import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, Empty, Input, Loading, Notice, PageHeader, Pill, Select, StatTile, centsToInput, errorMessage, formatDate, parseBRL, whatsappLink } from '@familia/ui';
import { PAYMENT_LABEL, type PaymentMethod, type Sale, formatBRL } from '../../shared';
import { todayBR } from '../api';
import { useBiz } from '../context';

function ReceiveForm({ sale, onDone }: { sale: Sale; onDone: () => void }) {
  const { api, key } = useBiz();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(centsToInput(sale.balanceCents));
  const [method, setMethod] = useState<Exclude<PaymentMethod, 'fiado'>>('pix');
  const pay = useMutation({
    mutationFn: () => api.addPayment(sale.id, { amountCents: parseBRL(amount) ?? 0, method }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      onDone();
    },
  });
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        pay.mutate();
      }}
    >
      <Input className="w-32" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Valor recebido" />
      <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} aria-label="Forma">
        {(['pix', 'dinheiro', 'debito', 'credito', 'outro'] as const).map((m) => (
          <option key={m} value={m}>
            {PAYMENT_LABEL[m]}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" loading={pay.isPending}>
        Confirmar
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancelar
      </Button>
      {pay.isError && <p className="basis-full text-xs text-danger">{errorMessage(pay.error)}</p>}
    </form>
  );
}

export function Receivables() {
  const { api, key, canWrite, business } = useBiz();
  const sales = useQuery({ queryKey: [...key, 'sales', 'open'], queryFn: () => api.sales({ status: 'open' }) });
  const [receiving, setReceiving] = useState<string | null>(null);
  const today = todayBR();
  const open = sales.data ?? [];
  const total = open.reduce((a, s) => a + s.balanceCents, 0);
  // Só vence quem tem data combinada; sem data, mostra há quanto tempo está em aberto.
  const overdue = open.filter((s) => s.dueDate !== null && s.dueDate < today);
  const daysOpen = (d: string) => Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86400_000));

  return (
    <>
      <PageHeader eyebrow={business.name} title="A receber (fiado)" description="Vendas a prazo em aberto, da data combinada mais antiga para a mais nova." />
      {sales.isError && <Notice tone="error">{errorMessage(sales.error)}</Notice>}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label="Total a receber" value={formatBRL(total)} sub={`${new Set(open.map((s) => s.customerId)).size} cliente(s)`} />
        <StatTile label="Vencido" value={formatBRL(overdue.reduce((a, s) => a + s.balanceCents, 0))} sub={`${overdue.length} venda(s) depois da data combinada`} />
        <StatTile label="Sem data combinada" value={open.filter((s) => !s.dueDate).length} sub="Combine uma data ao vender fiado" />
      </div>
      <Card>
        {sales.isLoading ? (
          <Loading />
        ) : !open.length ? (
          <Empty>Ninguém devendo. 🎉</Empty>
        ) : (
          <ul className="grid gap-3">
            {open.map((s) => {
              const late = s.dueDate !== null && s.dueDate < today;
              const first = s.customerName?.split(' ')[0] ?? '';
              const msg = `Oi, ${first}! Tudo bem? Passando para lembrar do valor de ${formatBRL(s.balanceCents)} das suas compras na ${business.name}${s.dueDate ? `, combinado para ${formatDate(s.dueDate)}` : ''}. Pode ser por Pix 😊`;
              const wa = whatsappLink(s.customerPhone, msg);
              return (
                <li key={s.id} className="rounded-xl border border-line bg-card-2/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{s.customerName ?? 'Sem cliente'}</span>
                        {late ? (
                          <Pill tone="danger">✕ Vencido em {formatDate(s.dueDate!)}</Pill>
                        ) : s.dueDate ? (
                          <Pill>até {formatDate(s.dueDate)}</Pill>
                        ) : (
                          <Pill tone="warn">sem data · em aberto há {daysOpen(s.date)} dias</Pill>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted" title={s.items.map((i) => `${i.qty}× ${i.description}`).join(', ')}>
                        {formatDate(s.date)} · {s.items.map((i) => `${i.qty}× ${i.description}`).join(', ')}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold text-ink tabular-nums">{formatBRL(s.balanceCents)}</div>
                      <div className="text-xs text-muted">
                        de {formatBRL(s.totalCents)}
                        {s.paidCents > 0 && ` · já pagou ${formatBRL(s.paidCents)}`}
                      </div>
                    </div>
                  </div>
                  {canWrite && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setReceiving(receiving === s.id ? null : s.id)}>
                        Receber
                      </Button>
                      {wa ? (
                        <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink hover:border-muted">
                          Cobrar no WhatsApp
                        </a>
                      ) : (
                        <span className="self-center text-xs text-muted">Cadastre o WhatsApp do cliente para cobrar com um toque.</span>
                      )}
                    </div>
                  )}
                  {receiving === s.id && <ReceiveForm sale={s} onDone={() => setReceiving(null)} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
