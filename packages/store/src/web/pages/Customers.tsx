import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Button, Card, Empty, Field, Input, Loading, Notice, PageHeader, cx, errorMessage, formatDate, tableClass, tdClass, thClass, whatsappLink } from '@familia/ui';
import { type Customer, formatBRL } from '../../shared';
import { useBiz } from '../context';

/** "25/12" ou "12-25" → "12-25" (MM-DD). */
const toBirthday = (s: string) => {
  const m = /^(\d{1,2})[/-](\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const [day, month] = s.includes('/') ? [a, b] : [b, a];
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
};
const showBirthday = (b: string | null) => (b ? `${b.slice(3)}/${b.slice(0, 2)}` : '');

function CustomerForm({ customer, onDone }: { customer?: Customer; onDone: () => void }) {
  const { api, key } = useBiz();
  const qc = useQueryClient();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [birthday, setBirthday] = useState(showBirthday(customer?.birthday ?? null));
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), phone: phone.trim() || null, birthday: birthday.trim() ? toBirthday(birthday) : null, notes: notes.trim() || null };
      return customer ? api.updateCustomer(customer.id, body) : api.createCustomer(body);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: key }), onDone()),
  });
  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-card-2/40 p-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (birthday.trim() && !toBirthday(birthday)) return setError('Aniversário no formato dia/mês, ex.: 25/12.');
        setError(null);
        save.mutate();
      }}
    >
      <Field label="Nome">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />
      </Field>
      <Field label="WhatsApp">
        <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98888-7777" />
      </Field>
      <Field label="Aniversário (dia/mês)">
        <Input value={birthday} onChange={(e) => setBirthday(e.target.value)} placeholder="25/12" />
      </Field>
      <Field label="Observações">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ex.: gosta de Egeo" maxLength={500} />
      </Field>
      {(error || save.isError) && <p className="text-sm text-danger sm:col-span-2 lg:col-span-4">{error ?? errorMessage(save.error)}</p>}
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

function History({ customer }: { customer: Customer }) {
  const { api, key } = useBiz();
  const sales = useQuery({ queryKey: [...key, 'sales', 'customer', customer.id], queryFn: () => api.sales({ customerId: customer.id }) });
  if (sales.isLoading) return <Loading />;
  if (!sales.data?.length) return <p className="py-2 text-xs text-muted">Nenhuma compra registrada.</p>;
  return (
    <ul className="grid gap-1 py-2 text-xs">
      {sales.data.map((s) => (
        <li key={s.id} className={cx('flex justify-between gap-3', s.status === 'canceled' && 'line-through opacity-50')}>
          <span className="truncate text-ink-2">
            {formatDate(s.date)} · {s.items.map((i) => `${i.qty}× ${i.description}`).join(', ')}
          </span>
          <span className="whitespace-nowrap tabular-nums">
            {formatBRL(s.totalCents)}
            {s.balanceCents > 0 && <span className="ml-2 text-warn">deve {formatBRL(s.balanceCents)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Customers() {
  const { api, key, canWrite, business } = useBiz();
  const customers = useQuery({ queryKey: [...key, 'customers'], queryFn: api.customers });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; mode: 'edit' | 'history' } | null>(null);
  const [search, setSearch] = useState('');
  const list = (customers.data ?? []).filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <PageHeader
        eyebrow={business.name}
        title="Clientes"
        description="Quem compra, quanto já comprou, quanto deve e quando faz aniversário."
        actions={
          canWrite &&
          !creating && (
            <Button onClick={() => setCreating(true)}>
              + Cliente
            </Button>
          )
        }
      />
      {customers.isError && <Notice tone="error">{errorMessage(customers.error)}</Notice>}
      {creating && (
        <div className="mb-5">
          <CustomerForm onDone={() => setCreating(false)} />
        </div>
      )}
      <Card actions={<Input className="w-64" placeholder="Buscar cliente…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar cliente" />} title={`${list.length} cliente(s)`}>
        {customers.isLoading ? (
          <Loading />
        ) : list.length ? (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>Cliente</th>
                  <th className={thClass}>WhatsApp</th>
                  <th className={thClass}>Aniversário</th>
                  <th className={cx(thClass, 'text-right')}>Já comprou</th>
                  <th className={cx(thClass, 'text-right')}>Deve</th>
                  <th className={thClass}>Última compra</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const wa = whatsappLink(c.phone, `Oi, ${c.name.split(' ')[0]}! `);
                  return (
                    <Fragment key={c.id}>
                      <tr>
                        <td className={cx(tdClass, 'text-ink')}>{c.name}</td>
                        <td className={tdClass}>
                          {wa ? (
                            <a href={wa} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                              {c.phone}
                            </a>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className={cx(tdClass, 'text-ink-2')}>{showBirthday(c.birthday) || '—'}</td>
                        <td className={cx(tdClass, 'text-right tabular-nums')}>{formatBRL(c.totalSpentCents)}</td>
                        <td className={cx(tdClass, 'text-right tabular-nums', c.balanceCents > 0 ? 'font-semibold text-warn' : 'text-muted')}>{c.balanceCents > 0 ? formatBRL(c.balanceCents) : '—'}</td>
                        <td className={cx(tdClass, 'text-ink-2')}>{c.lastPurchase ? formatDate(c.lastPurchase) : '—'}</td>
                        <td className={cx(tdClass, 'text-right')}>
                          <Button size="sm" variant="ghost" onClick={() => setOpen(open?.id === c.id && open.mode === 'history' ? null : { id: c.id, mode: 'history' })}>
                            Compras
                          </Button>
                          {canWrite && (
                            <Button size="sm" variant="ghost" onClick={() => setOpen(open?.id === c.id && open.mode === 'edit' ? null : { id: c.id, mode: 'edit' })}>
                              Editar
                            </Button>
                          )}
                        </td>
                      </tr>
                      {open?.id === c.id && (
                        <tr>
                          <td colSpan={7} className="px-3 pb-3">
                            {open.mode === 'edit' ? <CustomerForm customer={c} onDone={() => setOpen(null)} /> : <History customer={c} />}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nenhum cliente.</Empty>
        )}
      </Card>
    </>
  );
}
