import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, Empty, Field, Input, Notice, PageHeader, Pill, Select, centsToInput, cx, errorMessage, formatDate, parseBRL, whatsappLink } from '@familia/ui';
import { KIND_LABEL, PAYMENT_LABEL, PAYMENT_METHODS, type PaymentMethod, type Product, formatBRL } from '../../shared';
import { addDays, todayBR } from '../api';
import { useBiz } from '../context';

interface CartLine {
  key: string;
  productId: string | null;
  description: string;
  qty: number;
  unitPriceCents: number;
  /** Estoque disponível (produto) ou quantos kits dá para montar; null = não controla. */
  available: number | null;
}

const fold = (s: string) => s.normalize('NFKD').replace(/\p{Mn}/gu, '').toLowerCase();

export function Pos() {
  const { api, key, canWrite, business } = useBiz();
  const qc = useQueryClient();
  const products = useQuery({ queryKey: [...key, 'products'], queryFn: api.products });
  const customers = useQuery({ queryKey: [...key, 'customers'], queryFn: api.customers });

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [date, setDate] = useState(todayBR());
  const [dueDate, setDueDate] = useState(addDays(todayBR(), 30));
  const [newCustomer, setNewCustomer] = useState<{ name: string; phone: string } | null>(null);
  const [loose, setLoose] = useState<{ description: string; price: string } | null>(null);
  const [done, setDone] = useState<{ id: string; totalCents: number; receipt: string; phone: string | null } | null>(null);

  const sellable = (products.data ?? []).filter((p) => p.active && p.kind !== 'supply');
  const results = useMemo(() => {
    const q = fold(search.trim());
    const list = q ? sellable.filter((p) => fold(`${p.name} ${p.brand ?? ''} ${p.sku ?? ''}`).includes(q)) : sellable;
    return list.slice(0, 30);
  }, [search, sellable]);

  const add = (p: Product) =>
    setCart((c) => {
      const existing = c.find((l) => l.productId === p.id);
      if (existing) return c.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { key: p.id, productId: p.id, description: p.name, qty: 1, unitPriceCents: p.priceCents ?? 0, available: p.kind === 'kit' ? (p.buildable ?? null) : p.stockQty }];
    });
  const update = (k: string, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const subtotal = cart.reduce((a, l) => a + l.qty * l.unitPriceCents, 0);
  const discountCents = Math.min(parseBRL(discount) ?? 0, subtotal);
  const total = subtotal - discountCents;
  const customer = customers.data?.find((c) => c.id === customerId) ?? null;

  const createCustomer = useMutation({
    mutationFn: () => api.createCustomer({ name: newCustomer!.name.trim(), phone: newCustomer!.phone.trim() || null }),
    onSuccess: ({ id }) => {
      setCustomerId(id);
      setNewCustomer(null);
      qc.invalidateQueries({ queryKey: [...key, 'customers'] });
    },
  });

  const finish = useMutation({
    mutationFn: () =>
      api.createSale({
        date,
        customerId: customerId || null,
        items: cart.map((l) => ({ productId: l.productId, description: l.productId ? null : l.description, qty: l.qty, unitPriceCents: l.unitPriceCents })),
        discountCents,
        paymentMethod: method,
        dueDate: method === 'fiado' ? dueDate : null,
      }),
    onSuccess: (r) => {
      const lines = cart.map((l) => `${l.qty}x ${l.description} — ${formatBRL(l.qty * l.unitPriceCents)}`);
      const receipt = [
        `*${business.name}*`,
        `Data: ${formatDate(date)}`,
        ...lines,
        discountCents ? `Desconto: −${formatBRL(discountCents)}` : null,
        `*Total: ${formatBRL(r.totalCents)}*`,
        `Pagamento: ${PAYMENT_LABEL[method]}${method === 'fiado' ? ` — combinado para ${formatDate(dueDate)}` : ''}`,
        'Obrigada pela preferência! 🎁',
      ]
        .filter(Boolean)
        .join('\n');
      setDone({ id: r.id, totalCents: r.totalCents, receipt, phone: customer?.phone ?? null });
      setCart([]);
      setDiscount('');
      setCustomerId('');
      setMethod('pix');
      qc.invalidateQueries({ queryKey: key });
    },
  });

  if (!canWrite) return <Notice tone="info">Você só tem acesso de visualização nesta loja.</Notice>;

  return (
    <>
      <PageHeader eyebrow={business.name} title="Vender" description="Escolha produtos ou kits, ajuste quantidade e preço, e finalize. Fiado fica em “A receber”." />
      {done && (
        <Notice tone="success" onClose={() => setDone(null)}>
          Venda de <b>{formatBRL(done.totalCents)}</b> registrada.{' '}
          <button className="underline" onClick={() => navigator.clipboard?.writeText(done.receipt)}>
            Copiar recibo
          </button>
          {whatsappLink(done.phone, done.receipt) && (
            <>
              {' · '}
              <a className="underline" href={whatsappLink(done.phone, done.receipt)!} target="_blank" rel="noreferrer">
                Enviar no WhatsApp
              </a>
            </>
          )}
        </Notice>
      )}
      {finish.isError && <Notice tone="error">{errorMessage(finish.error)}</Notice>}

      <div className="grid gap-5 xl:grid-cols-[1fr_28rem]">
        <Card title="Produtos e kits" actions={<Button size="sm" variant="outline" onClick={() => setLoose({ description: '', price: '' })}>+ Item avulso</Button>}>
          <Input placeholder="Buscar por nome, marca ou código…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produto" autoFocus />
          {loose && (
            <form
              className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                const price = parseBRL(loose.price);
                if (!loose.description.trim() || price === null) return;
                setCart((c) => [...c, { key: crypto.randomUUID(), productId: null, description: loose.description.trim(), qty: 1, unitPriceCents: price, available: null }]);
                setLoose(null);
              }}
            >
              <div className="min-w-48 flex-1">
                <Field label="Descrição">
                  <Input value={loose.description} onChange={(e) => setLoose({ ...loose, description: e.target.value })} placeholder="ex.: Cesta personalizada" autoFocus />
                </Field>
              </div>
              <Field label="Preço">
                <Input className="w-32" inputMode="decimal" value={loose.price} onChange={(e) => setLoose({ ...loose, price: e.target.value })} placeholder="0,00" />
              </Field>
              <Button type="submit" size="sm">
                Adicionar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLoose(null)}>
                Cancelar
              </Button>
            </form>
          )}
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {results.map((p) => {
              const avail = p.kind === 'kit' ? (p.buildable ?? null) : p.stockQty;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => add(p)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-card-2/40 px-3 py-2.5 text-left text-sm transition hover:border-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{p.name}</span>
                      <span className="text-xs text-muted">
                        {p.kind === 'kit' ? KIND_LABEL.kit : (p.brand ?? 'Sem marca')}
                        {avail !== null && <> · {p.kind === 'kit' ? `dá p/ montar ${avail}` : `estoque ${avail}`}</>}
                      </span>
                    </span>
                    <span className="font-semibold whitespace-nowrap text-ink tabular-nums">{p.priceCents !== null ? formatBRL(p.priceCents) : '—'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!results.length && <Empty>{sellable.length ? 'Nada encontrado.' : 'Cadastre produtos em “Produtos e kits”, ou use “Item avulso”.'}</Empty>}
        </Card>

        <Card title="Venda">
          {cart.length ? (
            <ul className="mb-4 grid gap-2">
              {cart.map((l) => {
                const short = l.available !== null && l.qty > l.available;
                return (
                  <li key={l.key} className="rounded-lg border border-line px-3 py-2">
                    <div className="flex items-start justify-between gap-2 text-sm">
                      <span className="text-ink">{l.description}</span>
                      <button className="text-muted hover:text-danger" aria-label={`Remover ${l.description}`} onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>
                        ×
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <Input className="w-16 py-1 text-center" type="number" min={1} value={l.qty} onChange={(e) => update(l.key, { qty: Math.max(1, Number(e.target.value) || 1) })} aria-label="Quantidade" />
                      <span className="text-muted">×</span>
                      <Input
                        className="w-28 py-1"
                        inputMode="decimal"
                        defaultValue={centsToInput(l.unitPriceCents)}
                        onBlur={(e) => update(l.key, { unitPriceCents: parseBRL(e.target.value) ?? l.unitPriceCents })}
                        aria-label="Preço unitário"
                      />
                      <span className="ml-auto font-semibold text-ink tabular-nums">{formatBRL(l.qty * l.unitPriceCents)}</span>
                    </div>
                    {short && <p className="mt-1 text-xs text-warn">! Estoque registrado: {l.available}. A venda baixa mesmo assim — confira o estoque.</p>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>Toque nos produtos para adicionar.</Empty>
          )}

          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desconto">
                <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" />
              </Field>
              <Field label="Data">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value || todayBR())} />
              </Field>
            </div>

            <Field label="Cliente">
              {newCustomer ? (
                <div className="grid gap-2 rounded-lg border border-line p-2">
                  <Input placeholder="Nome" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} autoFocus />
                  <Input placeholder="WhatsApp (opcional)" inputMode="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
                  {createCustomer.isError && <p className="text-xs text-danger">{errorMessage(createCustomer.error)}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => newCustomer.name.trim() && createCustomer.mutate()} loading={createCustomer.isPending}>
                      Salvar cliente
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setNewCustomer(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Select className="w-full" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Sem cliente (balcão)</option>
                    {customers.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.balanceCents > 0 ? ` (deve ${formatBRL(c.balanceCents)})` : ''}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => setNewCustomer({ name: '', phone: '' })}>
                    Novo
                  </Button>
                </div>
              )}
            </Field>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink-2">Pagamento</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Forma de pagamento">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={method === m}
                    onClick={() => setMethod(m)}
                    className={cx('rounded-md border px-2.5 py-1.5 text-xs font-medium', method === m ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong text-ink-2 hover:text-ink')}
                  >
                    {PAYMENT_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            {method === 'fiado' && (
              <Field label="Pagamento combinado para" hint={!customerId ? 'Escolha o cliente: fiado precisa de cliente.' : undefined}>
                <Input type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            )}

            <div className="mt-2 grid gap-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between text-ink-2">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatBRL(subtotal)}</span>
              </div>
              {discountCents > 0 && (
                <div className="flex justify-between text-ink-2">
                  <span>Desconto</span>
                  <span className="tabular-nums">−{formatBRL(discountCents)}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-ink">Total</span>
                <span className="text-2xl font-bold text-ink tabular-nums">{formatBRL(total)}</span>
              </div>
            </div>
            <Button onClick={() => finish.mutate()} loading={finish.isPending} disabled={!cart.length || (method === 'fiado' && !customerId)}>
              Finalizar venda{method === 'fiado' ? ' (fiado)' : ''}
            </Button>
            {method === 'fiado' && customer && <Pill tone="warn">{customer.name} ficará devendo {formatBRL(total + customer.balanceCents)} no total</Pill>}
          </div>
        </Card>
      </div>
    </>
  );
}
