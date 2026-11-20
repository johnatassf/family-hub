import { useQuery } from '@tanstack/react-query';
import type { PublicConfig } from '@familia/shared';
import { apiFetch } from '@familia/ui';

export const usePublicConfig = () =>
  useQuery({ queryKey: ['public-config'], queryFn: () => apiFetch<PublicConfig>('/api/public-config'), staleTime: Infinity });
