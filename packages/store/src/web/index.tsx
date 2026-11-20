import type { WebModule } from '@familia/ui';
import { StoreGate } from './context';

/** Empresa · Loja de presentes. Páginas sob demanda; o portão carrega a empresa ativa. */
export const storeWebModule: WebModule = {
  id: 'store',
  title: 'Empresa · Loja de presentes',
  basePath: 'loja',
  nav: [
    { to: '', label: 'Painel da loja', icon: '▦' },
    { to: 'vender', label: 'Vender', icon: '＋' },
    { to: 'vendas', label: 'Vendas', icon: '≡' },
    { to: 'receber', label: 'A receber (fiado)', icon: '⇣' },
    { to: 'clientes', label: 'Clientes', icon: '☺' },
    { to: 'produtos', label: 'Produtos e kits', icon: '⬚' },
    { to: 'boletos', label: 'Boletos', icon: '⇡' },
    { to: 'acesso', label: 'Acesso', icon: '⚿' },
  ],
  routes: [
    {
      element: <StoreGate />,
      children: [
        { index: true, lazy: async () => ({ Component: (await import('./pages/Dashboard')).Dashboard }) },
        { path: 'vender', lazy: async () => ({ Component: (await import('./pages/Pos')).Pos }) },
        { path: 'vendas', lazy: async () => ({ Component: (await import('./pages/Sales')).Sales }) },
        { path: 'receber', lazy: async () => ({ Component: (await import('./pages/Receivables')).Receivables }) },
        { path: 'clientes', lazy: async () => ({ Component: (await import('./pages/Customers')).Customers }) },
        { path: 'produtos', lazy: async () => ({ Component: (await import('./pages/Products')).Products }) },
        { path: 'boletos', lazy: async () => ({ Component: (await import('./pages/Payables')).Payables }) },
        { path: 'acesso', lazy: async () => ({ Component: (await import('./pages/Access')).Access }) },
      ],
    },
  ],
};
