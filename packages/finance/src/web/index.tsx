import type { WebModule } from '@familia/ui';

/** Páginas carregadas sob demanda: o login não baixa a biblioteca de gráficos. */
export const financeWebModule: WebModule = {
  id: 'finance',
  title: 'Finanças da família',
  basePath: 'financeiro',
  nav: [
    { to: '', label: 'Visão geral', icon: '▦' },
    { to: 'planejamento', label: 'Planejamento', icon: '◔' },
    { to: 'parcelas', label: 'Parcelas', icon: '▤' },
    { to: 'metas', label: 'Metas', icon: '◎' },
    { to: 'transacoes', label: 'Transações', icon: '≡' },
    { to: 'revisar', label: 'Revisar', icon: '◇' },
    { to: 'contas', label: 'Contas e cartões', icon: '▭' },
    { to: 'conexoes', label: 'Conexões', icon: '⚭' },
  ],
  routes: [
    { index: true, lazy: async () => ({ Component: (await import('./pages/Overview')).Overview }) },
    { path: 'planejamento', lazy: async () => ({ Component: (await import('./pages/Planning')).Planning }) },
    { path: 'parcelas', lazy: async () => ({ Component: (await import('./pages/Installments')).Installments }) },
    { path: 'metas', lazy: async () => ({ Component: (await import('./pages/Goals')).Goals }) },
    { path: 'transacoes', lazy: async () => ({ Component: (await import('./pages/Transactions')).Transactions }) },
    { path: 'revisar', lazy: async () => ({ Component: (await import('./pages/Transactions')).Review }) },
    { path: 'contas', lazy: async () => ({ Component: (await import('./pages/Accounts')).Accounts }) },
    { path: 'conexoes', lazy: async () => ({ Component: (await import('./pages/Connections')).Connections }) },
  ],
};
