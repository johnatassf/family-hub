import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';

export interface NavItem {
  /** Caminho relativo ao basePath do módulo ('' = página inicial do módulo). */
  to: string;
  label: string;
  icon: ReactNode;
}

/** Contrato de um módulo no frontend: menu + rotas montadas em /<basePath>. */
export interface WebModule {
  id: string;
  title: string;
  basePath: string;
  nav: NavItem[];
  routes: RouteObject[];
}
