import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState } from 'react';
import { Outlet } from 'react-router';
import { Button, Card, Field, Input, Loading, Notice, PageHeader, errorMessage, useSession } from '@familia/ui';
import type { Business } from '../shared';
import { type StoreApi, createBusiness, listBusinesses, storeApi } from './api';

interface BizValue {
  business: Business;
  api: StoreApi;
  canWrite: boolean;
  /** Chave base das queries desta empresa. */
  key: (string | undefined)[];
}

const BizContext = createContext<BizValue | null>(null);

export function useBiz(): BizValue {
  const v = useContext(BizContext);
  if (!v) throw new Error('useBiz fora da loja');
  return v;
}

function Setup() {
  const { me } = useSession();
  const qc = useQueryClient();
  const [name, setName] = useState(`${me.user.name.split(' ')[0]} — Loja de presentes`);
  const create = useMutation({ mutationFn: () => createBusiness(name.trim()), onSuccess: () => qc.invalidateQueries({ queryKey: ['store', 'businesses'] }) });
  return (
    <>
      <PageHeader eyebrow="Empresa" title="Loja de presentes" description="Controle da loja: vendas (inclusive fiado), clientes, produtos, kits e cestas, estoque e boletos." />
      <Card title="Ativar o controle da loja" className="max-w-xl">
        <p className="mb-4 text-sm text-muted">
          Os dados da loja são só seus: ninguém da família vê, a não ser quem você adicionar depois (como ajudante ou só para visualizar).
        </p>
        {create.isError && <Notice tone="error">{errorMessage(create.error)}</Notice>}
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Nome da loja">
            <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} required />
          </Field>
          <div>
            <Button type="submit" loading={create.isPending}>
              Ativar loja
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}

/** Carrega a empresa da pessoa; sem empresa, mostra a ativação. */
export function StoreGate() {
  const businesses = useQuery({ queryKey: ['store', 'businesses'], queryFn: listBusinesses });
  const business = businesses.data?.[0];
  const value = useMemo<BizValue | null>(
    () => (business ? { business, api: storeApi(business.id), canWrite: business.role !== 'viewer', key: ['store', business.id] } : null),
    [business],
  );
  if (businesses.isLoading) return <Loading />;
  if (businesses.isError) return <Notice tone="error">{errorMessage(businesses.error)}</Notice>;
  if (!value) return <Setup />;
  return (
    <BizContext.Provider value={value}>
      <Outlet />
    </BizContext.Provider>
  );
}
