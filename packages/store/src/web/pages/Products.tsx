import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, Fragment, useState } from 'react';
import { Button, Card, Empty, Field, Input, Loading, Notice, PageHeader, Pill, Segmented, Select, centsToInput, cx, errorMessage, parseBRL, tableClass, tdClass, thClass } from '@familia/ui';
import { BRANDS, CATEGORIES, KIND_LABEL, type Product, type ProductKind, formatBRL, marginPct, suggestedPrice } from '../../shared';
import { useBiz } from '../context';

const money = (s: string) => (s.trim() === '' ? null : parseBRL(s));
const intOrNull = (s: string) => (s.trim() === '' ? null : Number.parseInt(s, 10));

function ProductForm({ kind, product, onDone }: { kind: ProductKind; product?: Product; onDone: () => void }) {
  const { api, key } = useBiz();
  const qc = useQueryClient();
  const [name, setName] = useState(product?.name ?? '');
  const [brand, setBrand] = useState(product?.brand ?? (kind === 'product' ? 'Natura' : ''));
  const [category, setCategory] = useState(product?.category ?? (kind === 'kit' ? 'Kits e cestas' : kind === 'supply' ? 'Embalagens e insumos' : ''));
  const [cost, setCost] = useState(product?.costCents != null && kind !== 'kit' ? centsToInput(product.costCents) : '');
  const [price, setPrice] = useState(product?.priceCents != null ? centsToInput(product.priceCents) : '');
  const [stock, setStock] = useState(product?.stockQty != null ? String(product.stockQty) : '');
  const [min, setMin] = useState(product?.minStock != null ? String(product.minStock) : '');
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        brand: brand || null,
        category: category || null,
        priceCents: money(price),
        ...(kind !== 'kit' ? { costCents: money(cost), minStock: intOrNull(min) } : {}),
      };
      return product ? api.updateProduct(product.id, body) : api.createProduct({ kind, ...body, ...(kind !== 'kit' ? { stockQty: intOrNull(stock) } : {}) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...key, 'products'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) save.mutate();
  };
  const m = marginPct(money(cost), money(price));
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line bg-card-2/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2">
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus placeholder={kind === 'kit' ? 'ex.: Cesta Dia das Mães' : kind === 'supply' ? 'ex.: Caixa presente M' : 'ex.: Kaiak Pulso 100ml'} />
        </Field>
      </div>
      {kind === 'product' && (
        <Field label="Marca">
          <Select className="w-full" value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">—</option>
            {BRANDS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Categoria">
        <Select className="w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">—</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      {kind !== 'kit' && (
        <Field label="Custo unitário" hint={kind === 'product' ? 'Quanto você paga à marca.' : undefined}>
          <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" />
        </Field>
      )}
      {kind !== 'supply' && (
        <Field label="Preço de venda" hint={m !== null ? `Margem ${m.toLocaleString('pt-BR')}%` : undefined}>
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
        </Field>
      )}
      {kind !== 'kit' && !product && (
        <Field label="Estoque atual" hint="Vazio = não controlar estoque.">
          <Input type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
        </Field>
      )}
      {kind !== 'kit' && (
        <Field label="Avisar quando chegar a">
          <Input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} placeholder="estoque mínimo" />
        </Field>
      )}
      {save.isError && <p className="text-sm text-danger sm:col-span-2 lg:col-span-4">{errorMessage(save.error)}</p>}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" loading={save.isPending}>
          {product ? 'Salvar' : 'Cadastrar'}
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function StockForm({ product, onDone }: { product: Product; onDone: () => void }) {
  const { api, key } = useBiz();
  const qc = useQueryClient();
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState<'purchase' | 'adjust'>('purchase');
  const move = useMutation({
    mutationFn: () => api.moveStock(product.id, { delta: Number.parseInt(qty, 10), reason, unitCostCents: reason === 'purchase' ? money(cost) : null }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: [...key, 'products'] }), onDone()),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (Number.parseInt(qty, 10)) move.mutate();
      }}
    >
      <Select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} aria-label="Tipo">
        <option value="purchase">Entrada (compra)</option>
        <option value="adjust">Ajuste (+/−)</option>
      </Select>
      <Input className="w-24" type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="qtd" aria-label="Quantidade" autoFocus />
      {reason === 'purchase' && <Input className="w-28" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="custo un." aria-label="Custo unitário" />}
      <Button type="submit" size="sm" loading={move.isPending}>
        Lançar
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancelar
      </Button>
      {move.isError && <span className="basis-full text-xs text-danger">{errorMessage(move.error)}</span>}
    </form>
  );
}

function KitCard({ kit, catalog }: { kit: Product; catalog: Product[] }) {
  const { api, key, canWrite } = useBiz();
  const qc = useQueryClient();
  const [componentId, setComponentId] = useState('');
  const [qty, setQty] = useState('1');
  const [editing, setEditing] = useState(false);
  const comps = kit.components ?? [];
  const save = useMutation({
    mutationFn: (next: { componentId: string; qty: number }[]) => api.setComponents(kit.id, next),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...key, 'products'] }),
  });
  const options = catalog.filter((p) => p.kind !== 'kit' && p.active && !comps.some((c) => c.componentId === p.id));
  const m = marginPct(kit.costCents, kit.priceCents);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">{kit.name}</h3>
          <p className="mt-1 text-xs text-muted">
            Custo {kit.costCents !== null ? formatBRL(kit.costCents) : comps.length ? 'incompleto (falta custo de algum item)' : '—'} · Preço{' '}
            {kit.priceCents !== null ? formatBRL(kit.priceCents) : '—'}
            {m !== null && ` · margem ${m.toLocaleString('pt-BR')}%`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {kit.buildable != null && <Pill tone={kit.buildable > 0 ? 'accent' : 'danger'}>dá p/ montar {kit.buildable}</Pill>}
          {canWrite && (
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Fechar' : 'Editar'}
            </Button>
          )}
        </div>
      </div>
      {kit.costCents !== null && (kit.priceCents === null || (m !== null && m < 30)) && (
        <p className="mt-2 text-xs text-warn">! Sugestão: para 40% de margem, venda por {formatBRL(suggestedPrice(kit.costCents, 40))}.</p>
      )}
      {editing && (
        <div className="mt-3">
          <ProductForm kind="kit" product={kit} onDone={() => setEditing(false)} />
        </div>
      )}
      <ul className="mt-3 grid gap-1.5 text-sm">
        {comps.map((c) => (
          <li key={c.componentId} className="flex items-center justify-between gap-2 border-b border-line/50 py-1">
            <span className="text-ink-2">
              {c.qty}× {c.name}
              {c.stockQty !== null && <span className="ml-1 text-xs text-muted">(estoque {c.stockQty})</span>}
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              {c.costCents !== null ? formatBRL(c.costCents * c.qty) : <span className="text-xs text-warn">sem custo</span>}
              {canWrite && (
                <button className="text-muted hover:text-danger" aria-label={`Tirar ${c.name}`} onClick={() => save.mutate(comps.filter((x) => x.componentId !== c.componentId).map((x) => ({ componentId: x.componentId, qty: x.qty })))}>
                  ×
                </button>
              )}
            </span>
          </li>
        ))}
        {!comps.length && <li className="text-xs text-muted">Monte o kit com produtos e embalagens: o custo e o estoque saem dos componentes.</li>}
      </ul>
      {canWrite && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!componentId) return;
            save.mutate([...comps.map((x) => ({ componentId: x.componentId, qty: x.qty })), { componentId, qty: Math.max(1, Number(qty) || 1) }]);
            setComponentId('');
            setQty('1');
          }}
        >
          <Select className="min-w-48 flex-1" value={componentId} onChange={(e) => setComponentId(e.target.value)} aria-label="Componente">
            <option value="">Adicionar item ao kit…</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.kind === 'supply' ? '(insumo)' : ''}
              </option>
            ))}
          </Select>
          <Input className="w-16" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantidade" />
          <Button type="submit" size="sm" variant="outline" loading={save.isPending}>
            Adicionar
          </Button>
        </form>
      )}
      {save.isError && <p className="mt-2 text-xs text-danger">{errorMessage(save.error)}</p>}
    </Card>
  );
}

export function Products() {
  const { api, key, canWrite, business } = useBiz();
  const products = useQuery({ queryKey: [...key, 'products'], queryFn: api.products });
  const [tab, setTab] = useState<ProductKind>('product');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [stocking, setStocking] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const all = products.data ?? [];
  const list = all.filter((p) => p.kind === tab && (!search || p.name.toLowerCase().includes(search.toLowerCase())));
  const noCost = all.filter((p) => p.kind === 'product' && p.costCents === null).length;

  return (
    <>
      <PageHeader
        eyebrow={business.name}
        title="Produtos e kits"
        description="Produtos de revenda, kits e cestas montados por você, e insumos (caixas, laços, papel)."
        actions={
          canWrite &&
          !creating && (
            <Button onClick={() => setCreating(true)}>
              + {KIND_LABEL[tab]}
            </Button>
          )
        }
      />
      {products.isError && <Notice tone="error">{errorMessage(products.error)}</Notice>}
      {noCost > 0 && tab === 'product' && <Notice tone="warn">{noCost} produto(s) sem custo: o lucro e o custo dos kits ficam incompletos até você preencher.</Notice>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<ProductKind>
          label="Tipo"
          value={tab}
          onChange={(v) => (setTab(v), setCreating(false))}
          options={[
            { value: 'product', label: `Produtos (${all.filter((p) => p.kind === 'product').length})` },
            { value: 'kit', label: `Kits e cestas (${all.filter((p) => p.kind === 'kit').length})` },
            { value: 'supply', label: `Insumos (${all.filter((p) => p.kind === 'supply').length})` },
          ]}
        />
        <Input className="w-64" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar" />
      </div>
      {creating && (
        <div className="mb-5">
          <ProductForm kind={tab} onDone={() => setCreating(false)} />
        </div>
      )}
      {products.isLoading ? (
        <Loading />
      ) : tab === 'kit' ? (
        list.length ? (
          <div className="grid gap-5 xl:grid-cols-2">
            {list.map((k) => (
              <KitCard key={k.id} kit={k} catalog={all} />
            ))}
          </div>
        ) : (
          <Card>
            <Empty>Nenhum kit ainda. Crie um (ex.: “Cesta Dia das Mães”) e adicione os produtos e a embalagem.</Empty>
          </Card>
        )
      ) : (
        <Card>
          {list.length ? (
            <div className="-mx-2 overflow-x-auto px-2">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Nome</th>
                    {tab === 'product' && <th className={thClass}>Marca</th>}
                    <th className={cx(thClass, 'text-right')}>Custo</th>
                    {tab === 'product' && <th className={cx(thClass, 'text-right')}>Preço</th>}
                    {tab === 'product' && <th className={cx(thClass, 'text-right')}>Margem</th>}
                    <th className={cx(thClass, 'text-right')}>Estoque</th>
                    {tab === 'product' && <th className={cx(thClass, 'text-right')}>Vendidos 30d</th>}
                    <th className={thClass} />
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const m = marginPct(p.costCents, p.priceCents);
                    const low = p.stockQty !== null && p.minStock !== null && p.stockQty <= p.minStock;
                    return (
                      <Fragment key={p.id}>
                        <tr className={cx(!p.active && 'opacity-50')}>
                          <td className={cx(tdClass, 'max-w-[280px] truncate text-ink')} title={p.notes ?? p.name}>
                            {p.name}
                          </td>
                          {tab === 'product' && <td className={cx(tdClass, 'text-ink-2')}>{p.brand ?? '—'}</td>}
                          <td className={cx(tdClass, 'text-right tabular-nums')}>{p.costCents !== null ? formatBRL(p.costCents) : <span className="text-warn">—</span>}</td>
                          {tab === 'product' && <td className={cx(tdClass, 'text-right tabular-nums')}>{p.priceCents !== null ? formatBRL(p.priceCents) : '—'}</td>}
                          {tab === 'product' && <td className={cx(tdClass, 'text-right tabular-nums', m !== null && m < 20 ? 'text-warn' : 'text-ink-2')}>{m !== null ? `${m.toLocaleString('pt-BR')}%` : '—'}</td>}
                          <td className={cx(tdClass, 'text-right tabular-nums', low ? 'text-danger' : 'text-ink-2')}>{p.stockQty ?? <span className="text-muted">não controla</span>}</td>
                          {tab === 'product' && <td className={cx(tdClass, 'text-right tabular-nums text-ink-2')}>{p.soldLast30 ?? 0}</td>}
                          <td className={cx(tdClass, 'text-right')}>
                            {canWrite && (
                              <span className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => (setStocking(stocking === p.id ? null : p.id), setEditing(null))}>
                                  Estoque
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => (setEditing(editing === p.id ? null : p.id), setStocking(null))}>
                                  Editar
                                </Button>
                              </span>
                            )}
                          </td>
                        </tr>
                        {(editing === p.id || stocking === p.id) && (
                          <tr>
                            <td colSpan={8} className="px-3 pb-3">
                              {editing === p.id ? <ProductForm kind={p.kind} product={p} onDone={() => setEditing(null)} /> : <StockForm product={p} onDone={() => setStocking(null)} />}
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
            <Empty>Nada cadastrado aqui ainda.</Empty>
          )}
        </Card>
      )}
    </>
  );
}
