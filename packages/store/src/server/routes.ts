import { Hono } from 'hono';
import { z } from 'zod';
import { parseJson } from '@familia/core';
import { BRANDS, CATEGORIES, PAYMENT_METHODS } from '../shared';
import { type StoreEnv, requireBusiness, todayBR } from './access';
import * as svc from './service';

const id = z.string().min(1).max(100);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use AAAA-MM');
const money = z.number().int().min(0).max(1_000_000_000);
const text = (max: number) => z.string().trim().max(max);

const productSchema = z
  .object({
    kind: z.enum(['product', 'kit', 'supply']),
    name: text(120).min(1),
    brand: z.enum(BRANDS).nullable().optional(),
    category: z.enum(CATEGORIES).nullable().optional(),
    sku: text(40).nullable().optional(),
    costCents: money.nullable().optional(),
    priceCents: money.nullable().optional(),
    stockQty: z.number().int().min(-100000).max(100000).nullable().optional(),
    minStock: z.number().int().min(0).max(100000).nullable().optional(),
    active: z.boolean().optional(),
    notes: text(500).nullable().optional(),
  })
  .strict();

const customerSchema = z
  .object({
    name: text(120).min(1),
    phone: z.string().trim().regex(/^[\d\s()+-]{8,20}$/, 'telefone inválido').nullable().optional(),
    birthday: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'use MM-DD').nullable().optional(),
    notes: text(500).nullable().optional(),
  })
  .strict();

const saleSchema = z
  .object({
    date: day,
    customerId: id.nullable().optional(),
    items: z
      .array(
        z
          .object({
            productId: id.nullable().optional(),
            description: text(200).nullable().optional(),
            qty: z.number().int().min(1).max(1000),
            unitPriceCents: money,
          })
          .strict(),
      )
      .min(1)
      .max(60),
    discountCents: money.optional(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    dueDate: day.nullable().optional(),
    notes: text(500).nullable().optional(),
  })
  .strict();

const paymentSchema = z.object({ amountCents: money.min(1), date: day.optional(), method: z.enum(PAYMENT_METHODS).exclude(['fiado']).default('pix') }).strict();

const payableSchema = z
  .object({
    supplier: text(80).min(1),
    description: text(200).nullable().optional(),
    dueDate: day,
    amountCents: money.min(1),
    status: z.enum(['open', 'paid']).optional(),
    paidCents: money.nullable().optional(),
    paidDate: day.nullable().optional(),
    shared: z.boolean().optional(),
    notes: text(500).nullable().optional(),
  })
  .strict();

const cell = z.union([z.string().max(2000), z.number(), z.null()]);
const workbookSchema = z.object({ sheets: z.record(z.string().max(100), z.array(z.array(cell).max(50)).max(5000)) }).strict();

export function storeRoutes() {
  const r = new Hono<StoreEnv>();

  // Empresas da pessoa (onde ela é membro) e criação da loja.
  r.get('/businesses', async (c) => c.json(await svc.listBusinesses(c.env.DB, c.var.ctx)));
  r.post('/businesses', async (c) => {
    const { name } = await parseJson(c.req.raw, z.object({ name: text(80).min(2) }).strict());
    return c.json(await svc.createBusiness(c.env.DB, c.var.ctx, name), 201);
  });

  const b = new Hono<StoreEnv>();
  b.use('*', requireBusiness);

  b.get('/members', async (c) => c.json(await svc.listMembers(c.env.DB, c.var.biz)));
  b.put('/members/:userId', async (c) => {
    const { role } = await parseJson(c.req.raw, z.object({ role: z.enum(['editor', 'viewer']) }).strict());
    await svc.setMember(c.env.DB, c.var.biz, c.var.ctx.householdId, c.req.param('userId'), role);
    return c.json({ ok: true });
  });
  b.delete('/members/:userId', async (c) => {
    await svc.removeMember(c.env.DB, c.var.biz, c.req.param('userId'));
    return c.json({ ok: true });
  });

  b.get('/dashboard', async (c) => {
    const m = month.safeParse(c.req.query('month'));
    return c.json(await svc.dashboard(c.env.DB, c.var.biz, m.success ? m.data : todayBR().slice(0, 7)));
  });

  b.get('/products', async (c) => c.json(await svc.listProducts(c.env.DB, c.var.biz)));
  b.post('/products', async (c) => c.json(await svc.createProduct(c.env.DB, c.var.biz, await parseJson(c.req.raw, productSchema)), 201));
  b.patch('/products/:id', async (c) => {
    await svc.updateProduct(c.env.DB, c.var.biz, c.req.param('id'), await parseJson(c.req.raw, productSchema.omit({ kind: true }).partial()));
    return c.json({ ok: true });
  });
  b.put('/products/:id/components', async (c) => {
    const body = await parseJson(c.req.raw, z.object({ components: z.array(z.object({ componentId: id, qty: z.number().int().min(1).max(100) }).strict()).max(40) }).strict());
    await svc.setKitComponents(c.env.DB, c.var.biz, c.req.param('id'), body.components);
    return c.json({ ok: true });
  });
  b.post('/products/:id/stock', async (c) => {
    const body = await parseJson(
      c.req.raw,
      z.object({ delta: z.number().int().min(-100000).max(100000).refine((v) => v !== 0, 'quantidade não pode ser zero'), reason: z.enum(['purchase', 'adjust']), unitCostCents: money.nullable().optional() }).strict(),
    );
    return c.json(await svc.moveStock(c.env.DB, c.var.biz, c.req.param('id'), body));
  });

  b.get('/customers', async (c) => c.json(await svc.listCustomers(c.env.DB, c.var.biz)));
  b.post('/customers', async (c) => c.json(await svc.createCustomer(c.env.DB, c.var.biz, await parseJson(c.req.raw, customerSchema)), 201));
  b.patch('/customers/:id', async (c) => {
    await svc.updateCustomer(c.env.DB, c.var.biz, c.req.param('id'), await parseJson(c.req.raw, customerSchema.partial()));
    return c.json({ ok: true });
  });

  b.get('/sales', async (c) => {
    const q = c.req.query();
    const m = month.safeParse(q.month);
    const s = z.enum(['paid', 'open', 'canceled']).safeParse(q.status);
    const cid = id.safeParse(q.customerId);
    return c.json(await svc.listSales(c.env.DB, c.var.biz, { month: m.success ? m.data : undefined, status: s.success ? s.data : undefined, customerId: cid.success ? cid.data : undefined }));
  });
  b.post('/sales', async (c) => c.json(await svc.createSale(c.env.DB, c.var.biz, await parseJson(c.req.raw, saleSchema)), 201));
  b.post('/sales/:id/payments', async (c) => {
    const p = await parseJson(c.req.raw, paymentSchema);
    return c.json(await svc.addPayment(c.env.DB, c.var.biz, c.req.param('id'), { amountCents: p.amountCents, date: p.date ?? todayBR(), method: p.method }), 201);
  });
  b.post('/sales/:id/cancel', async (c) => {
    await svc.cancelSale(c.env.DB, c.var.biz, c.req.param('id'));
    return c.json({ ok: true });
  });

  b.get('/payables', async (c) => {
    const s = z.enum(['open', 'paid']).safeParse(c.req.query('status'));
    return c.json(await svc.listPayables(c.env.DB, c.var.biz, s.success ? s.data : undefined));
  });
  b.post('/payables', async (c) => c.json(await svc.createPayable(c.env.DB, c.var.biz, await parseJson(c.req.raw, payableSchema)), 201));
  b.patch('/payables/:id', async (c) => {
    await svc.updatePayable(c.env.DB, c.var.biz, c.req.param('id'), await parseJson(c.req.raw, payableSchema.partial()));
    return c.json({ ok: true });
  });
  b.delete('/payables/:id', async (c) => {
    await svc.deletePayable(c.env.DB, c.var.biz, c.req.param('id'));
    return c.json({ ok: true });
  });

  b.post('/import', async (c) => {
    const wb = await parseJson(c.req.raw, workbookSchema);
    return c.json(await svc.importSpreadsheet(c.env.DB, c.var.biz, wb, c.var.ctx.householdId), 201);
  });

  r.route('/b/:bid', b);
  return r;
}
