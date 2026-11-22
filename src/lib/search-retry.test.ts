import { describe, expect, it } from 'vitest';
import { mergeRetriedSearch } from './search-retry';
import type { SearchResponse, SearchResultItem } from './types';

const item = (sourceKey: string, vodId: string) => ({ sourceKey, vodId }) as SearchResultItem;
const failure = (sourceKey: string) => ({ sourceKey, error: '超时', timedOut: true });

describe('mergeRetriedSearch', () => {
  it('保留未重试的来源，更新成功和仍失败的来源', () => {
    const current: SearchResponse = {
      list: [item('working', '1'), item('recovered', 'old')],
      failures: [failure('recovered'), failure('still-failing'), failure('not-retried')],
    };
    const retry: SearchResponse = {
      list: [item('recovered', 'new')],
      failures: [{ sourceKey: 'still-failing', error: '拒绝访问' }],
    };

    expect(mergeRetriedSearch(current, ['recovered', 'still-failing'], retry)).toEqual({
      list: [item('working', '1'), item('recovered', 'new')],
      failures: [failure('not-retried'), retry.failures[0]],
    });
  });
});
