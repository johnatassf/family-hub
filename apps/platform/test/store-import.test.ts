import { describe, expect, it } from 'vitest';
import { mapSpreadsheet } from '../../../packages/store/src/import';
import { buildableKits, inferBrand, kitCost, marginPct, splitQty, suggestedPrice } from '../../../packages/store/src/shared';

// Planilha sintética com a MESMA estrutura da planilha da loja (nenhum dado real).
const wb = {
  sheets: {
    'Contas a Pagar': [
      ['Marca', 'Data de vencimento', 'Valor', 'Status'],
      ['Natura', '2026-09-02', 100.5, 'Pago'],
      ['O Boticário', '2026-09-14', 200, null],
      ['Natura', '2026-10-02', 300, null],
      ['Natura', '2026-10-02', 300, null], // boleto idêntico (outro pedido): não pode sumir
      [null, null, null, null],
    ],
    'Boles compartilhados': [
      ['Marca', 'Data de vencimento', 'Valor', 'Valor pago', 'Observações'],
      ['O Boticário', '2026-09-14', 200, 200, 'Sócia pagou'], // mesmo boleto da outra aba
      ['A confirmar', '2026-11-20', 50, null, '-'], // só nesta aba
      ['A confirmar', '2026-10-02', 300, null, null], // marca desconhecida: é um dos boletos Natura de 02/10
      ['Natura', '2026-09-20', 400, 390, 'Desconto'],
    ],
    'Compras Clientes': [
      ['2026-08-10', 'Maria Souza', 'Kaiak e Egeo', 300, null], // é a venda fiado da Maria
      ['2026-08-12', 'João', 'Perfume Humor', 114.9, 'Pago'],
      ['2026-08-15', 'Ana', null, null, null], // sem valor: ignorada
    ],
    Cliente: [
      ['Cliente', 'Produtos retirados', 'Data da compra', 'Valor da compra', 'Data do pagamento combinado', 'Valor pago', 'Data que pagou', 'Saldo devedor', 'Status'],
      ['Maria', '1 Kaiak Pulso', null, 120, '2026-10-10', 50, '2026-09-01', 250, null],
      [null, '2 Egeo Blue', null, 180, null, null, null, null, null],
      ['Carla', '1 Desodorante Luna', null, 28.9, null, 28.9, '2026-09-09', 0, 'Quitado'],
    ],
  },
};

describe('importação da planilha da loja', () => {
  const plan = mapSpreadsheet(wb, '2026-11-20');

  it('junta boletos repetidos das duas abas e marca os compartilhados', () => {
    expect(plan.payables).toEqual([
      { supplier: 'Natura', dueDate: '2026-09-02', amountCents: 10050, status: 'paid', paidCents: 10050, shared: false, notes: null },
      { supplier: 'O Boticário', dueDate: '2026-09-14', amountCents: 20000, status: 'paid', paidCents: 20000, shared: true, notes: 'Sócia pagou' },
      { supplier: 'Natura', dueDate: '2026-09-20', amountCents: 40000, status: 'paid', paidCents: 39000, shared: true, notes: 'Desconto' },
      { supplier: 'Natura', dueDate: '2026-10-02', amountCents: 30000, status: 'open', paidCents: null, shared: true, notes: null },
      { supplier: 'Natura', dueDate: '2026-10-02', amountCents: 30000, status: 'open', paidCents: null, shared: false, notes: null },
      { supplier: 'A confirmar', dueDate: '2026-11-20', amountCents: 5000, status: 'open', paidCents: null, shared: true, notes: null },
    ]);
  });

  it('fiado vira venda em aberto com itens e o que já foi pago; usa a data do registro de vendas', () => {
    const maria = plan.sales.find((s) => s.customerKey === 'maria')!;
    expect(maria).toMatchObject({
      date: '2026-08-10',
      totalCents: 30000,
      paymentMethod: 'fiado',
      dueDate: '2026-10-10',
      payments: [{ date: '2026-09-01', amountCents: 5000 }],
    });
    expect(maria.items).toEqual([
      { productKey: 'kaiak pulso', description: 'Kaiak Pulso', qty: 1, unitPriceCents: 12000 },
      { productKey: 'egeo blue', description: 'Egeo Blue', qty: 2, unitPriceCents: 9000 },
    ]);
    // Quitado = pago por inteiro.
    expect(plan.sales.find((s) => s.customerKey === 'carla')!.payments[0]!.amountCents).toBe(2890);
  });

  it('não duplica a venda que está nas duas abas; ignora venda sem valor', () => {
    expect(plan.sales.map((s) => s.customerKey).sort()).toEqual(['carla', 'joao', 'maria']);
    expect(plan.customers.map((c) => c.name).sort()).toEqual(['Carla', 'João', 'Maria']);
    expect(plan.warnings).toContain('1 venda(s) do registro sem valor foram ignoradas.');
  });

  it('monta o catálogo inicial a partir dos itens, com a marca reconhecida', () => {
    expect(plan.products.map((p) => [p.name, p.brand, p.priceCents])).toEqual([
      ['Kaiak Pulso', 'Natura', 12000],
      ['Egeo Blue', 'O Boticário', 9000],
      ['Desodorante Luna', 'Natura', 2890],
    ]);
  });
});

describe('regras da loja', () => {
  it('custo e quantidade possível de kits', () => {
    expect(kitCost([{ qty: 1, costCents: 5000 }, { qty: 2, costCents: 300 }])).toBe(5600);
    expect(kitCost([{ qty: 1, costCents: 5000 }, { qty: 1, costCents: null }])).toBeNull();
    expect(buildableKits([{ qty: 1, stockQty: 4 }, { qty: 2, stockQty: 5 }, { qty: 1, stockQty: null }])).toBe(2);
    expect(buildableKits([{ qty: 1, stockQty: null }])).toBeNull();
  });

  it('margem e preço sugerido', () => {
    expect(marginPct(6000, 10000)).toBe(40);
    expect(suggestedPrice(6000, 40)).toBe(10000);
    expect(marginPct(null, 10000)).toBeNull();
  });

  it('marca e quantidade pela descrição', () => {
    expect(inferBrand('Perfume Botika 214')).toBe('O Boticário');
    expect(inferBrand('Óleo Ekos Andiroba')).toBe('Natura');
    expect(inferBrand('Caixa de presente')).toBeNull();
    expect(splitQty('2 Sabonetes sortidos')).toEqual({ qty: 2, name: 'Sabonetes sortidos' });
    expect(splitQty('Refil de máscara,')).toEqual({ qty: 1, name: 'Refil de máscara' });
  });
});
