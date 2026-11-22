import type { SearchResponse } from './types';

export function mergeRetriedSearch(
  current: SearchResponse,
  sourceKeys: string[],
  retry: SearchResponse,
): SearchResponse {
  const retried = new Set(sourceKeys);
  return {
    list: [...current.list.filter((item) => !retried.has(item.sourceKey)), ...retry.list],
    failures: [...current.failures.filter((item) => !retried.has(item.sourceKey)), ...retry.failures],
  };
}
