import { financeWebModule } from '@familia/finance/web';
import { storeWebModule } from '@familia/store/web';
import type { WebModule } from '@familia/ui';

/** Módulos no frontend. Um módulo novo entra aqui e em src/worker/index.ts. */
export const webModules: WebModule[] = [financeWebModule, storeWebModule];
