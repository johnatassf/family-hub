import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, Empty, Field, Input, Loading, Notice, PageHeader, Pill, Segmented, Select, StatTile, cx, errorMessage, formatDate, parseBRL, tableClass, tdClass, thClass } from '@familia/ui';
import { BRANDS, formatBRL } from '../../shared';
import { addDays, todayBR } from '../api';
import { useBiz } from '../context';

function NewPayable({ onDone }: { onDone: () => void }) {
  const { api, key } = useBiz();
  const qc = useQueryClient();
  const [supplier, setSupplier] = useState('Natura');
  const [other, setOther] = useState('');
  const [dueDate, setDueDate] = useState(todayBR());
  const [amount, setAmount] = useState('');
  const [installments, setInstallments] = useState('1');
  const [shared, setShared] = useState(false);
  const [notes, setNotes] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const total = parseBRL(amount) ?? 0;
      const n = Math.max(1, Math.min(12, Number(installments) || 1));
      // Pedido parcelado em boletos: um boleto por mês, mesmo dia.
      const each = Math.floor(total / n);
      for (let i = 0; i < n; i++) {
        const due = new Date(`${dueDate}T12:00:00Z`);
        due.setUTCMonth(due.getUTCMonth() + i);
        await api.createPayable({
          supplier: supplier === 'Outra' ? other.trim() || 'Outro fornecedor' : supplier,
          dueDate: due.toISOString().slice(0, 10),
          amountCents: i === 0 ? total - each * (n - 1) : each,
          shared,
          notes: [notes.trim(), n > 1 ? `parcela ${i + 1}/${n}` : ''].filter(Boolean).join(' · ') || null,
        });
      }
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: key }), onDone()),
  });
  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-card-2/40 p-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (parseBRL(amount)) save.mutate();
      }}
    >
      <Field label="Fornecedor">
        <Select className="w-full" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          {BRANDS.filter((b) => b !== 'Própria').map((b) => (
            <option key={b}>{b}</option>
          ))}
        </Select>
      </Field>
      {supplier === 'Outra' && (
        <Field label="Qual">
          <Input value={other} onChange={(e) => setOther(e.target.value)} maxLength={80} />
        </Field>
      )}
      <Field label="Valor total">
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required autoFocus />
      </Field>
      <Field label="1º vencimento">
        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
      </Field>
      <Field label="Em quantos boletos" hint="Um por mês.">
        <Input type="number" min={1} max={12} value={installments} onChange={(e) => setInstallments(e.target.value)} />
      </Field>
      <Field label="Observações">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ex.: pedido ciclo 15" maxLength={200} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-2">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Boleto compartilhado
      </label>
      {save.isError && <p className="text-sm text-danger sm:col-span-2 lg:col-span-4">{errorMessage(save.error)}</p>}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
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

export function Payables() {
  const { api, key, canWrite, business } = useBiz();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'paid' | 'shared'>('open');
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<{ id: string; value: string } | null>(null);
  const all = useQuery({ queryKey: [...key, 'payables'], queryFn: () => api.payables() });
  const update = useMutation({
    mutationFn: ({ id, ...p }: { id: string; status: 'open' | 'paid'; paidCents?: number | null }) => api.updatePayable(id, p),
    onSuccess: () => (setPaying(null), qc.invalidateQueries({ queryKey: key })),
  });
  const del = useMutation({ mutationFn: api.deletePayable, onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const today = todayBR();
  const in30 = addDays(today, 30);
  const rows = all.data ?? [];
  const open = rows.filter((p) => p.status === 'open');
  const list = filter === 'shared' ? rows.filter((p) => p.shared) : rows.filter((p) => p.status === filter);

  return (
    <>
      <PageHeader
        eyebrow={business.name}
        title="Boletos e contas"
        description="Boletos dos pedidos às marcas e outras contas da loja. Marque os que são compartilhados."
        actions={
          canWrite &&
          !creating && (
            <Button onClick={() => setCreating(true)}>
              + Boleto
            </Button>
          )
        }
      />
      {(all.isError || update.isError || del.isError) && <Notice tone="error">{errorMessage(all.error ?? update.error ?? del.error)}</Notice>}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Em aberto" value={formatBRL(open.reduce((a, p) => a + p.amountCents, 0))} sub={`${open.length} boleto(s)`} />
        <StatTile label="Próximos 30 dias" value={formatBRL(open.filter((p) => p.dueDate >= today && p.dueDate <= in30).reduce((a, p) => a + p.amountCents, 0))} />
        <StatTile
          label="Vencidos"
          value={formatBRL(open.filter((p) => p.dueDate < today).reduce((a, p) => a + p.amountCents, 0))}
          sub={<span className={open.some((p) => p.dueDate < today) ? 'text-danger' : ''}>{open.filter((p) => p.dueDate < today).length} boleto(s)</span>}
        />
        <StatTile label="Compartilhados em aberto" value={formatBRL(open.filter((p) => p.shared).reduce((a, p) => a + p.amountCents, 0))} />
      </div>
      {creating && (
        <div className="mb-5">
          <NewPayable onDone={() => setCreating(false)} />
        </div>
      )}
      <Card
        actions={
          <Segmented
            label="Filtro"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: 'Em aberto' },
              { value: 'paid', label: 'Pagos' },
              { value: 'shared', label: 'Compartilhados' },
            ]}
          />
        }
      >
        {all.isLoading ? (
          <Loading />
        ) : list.length ? (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>Vencimento</th>
                  <th className={thClass}>Fornecedor</th>
                  <th className={cx(thClass, 'text-right')}>Valor</th>
                  <th className={thClass}>Situação</th>
                  <th className={thClass}>Observações</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const late = p.status === 'open' && p.dueDate < today;
                  return (
                    <tr key={p.id}>
                      <td className={cx(tdClass, 'tabular-nums', late ? 'text-danger' : 'text-ink-2')}>{formatDate(p.dueDate)}</td>
                      <td className={cx(tdClass, 'text-ink')}>
                        {p.supplier} {p.shared && <Pill tone="accent">compartilhado</Pill>}
                      </td>
                      <td className={cx(tdClass, 'text-right font-medium tabular-nums')}>{formatBRL(p.amountCents)}</td>
                      <td className={tdClass}>
                        {p.status === 'paid' ? (
                          <Pill tone="accent">✓ Pago{p.paidCents !== null && p.paidCents !== p.amountCents ? ` ${formatBRL(p.paidCents)}` : ''}</Pill>
                        ) : late ? (
                          <Pill tone="danger">✕ Vencido</Pill>
                        ) : (
                          <Pill>Em aberto</Pill>
                        )}
                      </td>
                      <td className={cx(tdClass, 'max-w-[220px] truncate text-ink-2')} title={p.notes ?? ''}>
                        {p.notes ?? ''}
                      </td>
                      <td className={cx(tdClass, 'text-right')}>
                        {canWrite &&
                          (paying?.id === p.id ? (
                            <span className="flex items-center justify-end gap-1">
                              <Input className="w-24 py-1 text-xs" inputMode="decimal" value={paying.value} onChange={(e) => setPaying({ id: p.id, value: e.target.value })} aria-label="Valor pago" />
                              <Button size="sm" onClick={() => update.mutate({ id: p.id, status: 'paid', paidCents: parseBRL(paying.value) ?? p.amountCents })}>
                                OK
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setPaying(null)}>
                                ×
                              </Button>
                            </span>
                          ) : p.status === 'open' ? (
                            <span className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setPaying({ id: p.id, value: (p.amountCents / 100).toFixed(2).replace('.', ',') })}>
                                Pagar
                              </Button>
                              <Button size="sm" variant="ghost" aria-label="Apagar" onClick={() => window.confirm('Apagar este boleto?') && del.mutate(p.id)}>
                                ×
                              </Button>
                            </span>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: p.id, status: 'open' })}>
                              Reabrir
                            </Button>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nada aqui.</Empty>
        )}
      </Card>
    </>
  );
}
