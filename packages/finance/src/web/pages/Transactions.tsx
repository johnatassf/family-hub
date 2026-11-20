import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, Input, Loading, Notice, PageHeader, Select, errorMessage } from '@familia/ui';
import { financeApi } from '../api';
import { ScopeBar, TxTable, useScope } from '../components';

const PAGE = 500;

export function Transactions({ review = false }: { review?: boolean }) {
  const { query, params, set } = useScope();
  const [limit, setLimit] = useState(PAGE);
  const month = params.get('mes') ?? '';
  const category = params.get('categoria') ?? '';
  const accountId = params.get('conta') ?? '';

  const q = new URLSearchParams(query);
  if (review) {
    q.set('review', '1');
    q.set('scope', 'mine'); // revisão é só do que a pessoa pode editar
  }
  if (month) q.set('month', month);
  if (category) q.set('category', category);
  if (accountId) q.set('accountId', accountId);
  q.set('limit', String(limit));

  const tx = useQuery({ queryKey: ['finance', 'tx', q.toString()], queryFn: () => financeApi.transactions(q.toString()) });
  const cats = useQuery({ queryKey: ['finance', 'categories'], queryFn: financeApi.categories });
  const accounts = useQuery({ queryKey: ['finance', 'accounts'], queryFn: financeApi.accounts });
  const csv = useMutation({
    mutationFn: () => {
      const exportQuery = new URLSearchParams(q);
      exportQuery.delete('limit');
      return financeApi.downloadCsv(exportQuery.toString());
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title={review ? 'Revisar lançamentos' : 'Transações'}
        description={
          review
            ? 'Lançamentos das suas contas com categoria incerta. Ajuste a categoria e o mês de referência; a mudança fica salva.'
            : 'Você edita as transações das contas que conectou. Nas contas compartilhadas por outras pessoas, só visualiza.'
        }
        actions={
          <>
            {!review && <ScopeBar />}
            <Button variant="outline" onClick={() => csv.mutate()} loading={csv.isPending}>
              Exportar CSV
            </Button>
          </>
        }
      />
      {(tx.isError || csv.isError) && <Notice tone="error">{errorMessage(tx.error ?? csv.error)}</Notice>}
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input type="month" aria-label="Mês de referência" className="w-auto" value={month} onChange={(e) => set('mes', e.target.value)} />
          <Select aria-label="Categoria" value={category} onChange={(e) => set('categoria', e.target.value)}>
            <option value="">Todas as categorias</option>
            {cats.data?.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select aria-label="Conta" value={accountId} onChange={(e) => set('conta', e.target.value)}>
            <option value="">Todas as contas</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nickname || a.name} {a.isMine ? '' : `(${a.ownerName})`}
              </option>
            ))}
          </Select>
          {(month || category || accountId) && (
            <Button variant="ghost" size="sm" onClick={() => ['mes', 'categoria', 'conta'].forEach((k) => set(k, ''))}>
              Limpar filtros
            </Button>
          )}
        </div>
        {tx.isLoading ? <Loading /> : <TxTable rows={tx.data ?? []} categories={cats.data?.categories} />}
        {tx.data && tx.data.length >= limit && (
          <div className="mt-4 text-center">
            <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
              Carregar mais
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

export const Review = () => <Transactions review />;
