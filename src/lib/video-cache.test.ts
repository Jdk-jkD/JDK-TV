import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: new Map<string, { key: string; episodeKey: string; bytes: number; index: number; costMs: number; lastAccess: number }>(),
  bodies: new Map<string, Response>(),
  storage: new Map<string, string>(),
}));
vi.mock('./db', () => ({ db: { segmentMeta: {
  toArray: async () => [...state.rows.values()],
  get: async (key: string) => state.rows.get(key),
  put: async (row: typeof state.rows extends Map<string, infer R> ? R : never) => { state.rows.set(row.key, row); },
  delete: async (key: string) => { state.rows.delete(key); },
  clear: async () => { state.rows.clear(); },
} } }));

let cache: typeof import('./video-cache');
let put: ReturnType<typeof vi.fn>;
let deleteBucket: ReturnType<typeof vi.fn>;
const MB = 1024 ** 2;
function seed(key: string, bytes: number, ageDays = 0) {
  state.rows.set(key, { key, episodeKey: key, bytes, index: 0, costMs: 1, lastAccess: Date.now() - ageDays * 86400000 });
  state.bodies.set(key, new Response('segment'));
}
beforeEach(async () => {
  vi.resetModules(); state.rows.clear(); state.bodies.clear(); state.storage.clear();
  put = vi.fn(async (key: string, value: Response) => { state.bodies.set(key, value); });
  deleteBucket = vi.fn(async () => { state.bodies.clear(); return true; });
  vi.stubGlobal('caches', {
    open: async () => ({ put, delete: async (key: string) => state.bodies.delete(key) }),
    delete: deleteBucket,
  });
  vi.stubGlobal('localStorage', { getItem: (key: string) => state.storage.get(key) ?? null,
    setItem: (key: string, value: string) => { state.storage.set(key, value); } });
  cache = await import('./video-cache');
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('缓存容量与生命周期', () => {
  it('非法数值回退默认值，旧设置获得安全默认策略', () => {
    const result = cache.normalizeCacheSettings({ maxTotalBytes: 'large', horizonSeconds: NaN });
    expect(result.maxTotalBytes).toBe(cache.DEFAULT_CACHE_SETTINGS.maxTotalBytes);
    expect(result.horizonSeconds).toBe(300);
    expect(result.clearOnStartup).toBe(false);
    expect(result.maxAgeDays).toBe(7);
  });
  it('写入完成时执行容量淘汰，优先移除最久未使用的缓存', async () => {
    await cache.prepareVideoCache();
    seed('https://media.example/old', 60 * MB, 1);
    seed('https://media.example/recent', 50 * MB);
    const result = await cache.putCachedSegmentResilient('https://media.example/new', new ArrayBuffer(4), {
      episodeKey: 'new', index: 0, costMs: 1,
      settings: { ...cache.DEFAULT_CACHE_SETTINGS, maxTotalBytes: 100 * MB },
    });
    expect(result).toBe('ok');
    expect(state.rows.has('https://media.example/old')).toBe(false);
    expect(state.rows.has('https://media.example/recent')).toBe(true);
    expect((await cache.getCacheSummary()).bytes).toBeLessThanOrEqual(100 * MB);
  });
  it('浏览器配额不足时即使低于应用上限也释放空间并重试', async () => {
    await cache.prepareVideoCache(); seed('https://media.example/old', 4 * MB);
    put.mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    expect(await cache.putCachedSegmentResilient('https://media.example/new', new ArrayBuffer(4), {
      episodeKey: 'new', index: 0, costMs: 1, settings: cache.DEFAULT_CACHE_SETTINGS,
    })).toBe('ok');
    expect(put).toHaveBeenCalledTimes(2);
    expect(state.rows.has('https://media.example/old')).toBe(false);
  });
  it('启动清理只运行一次且只删除片段缓存桶', async () => {
    cache.saveCacheSettings({ clearOnStartup: true }); seed('https://media.example/old', 4);
    await Promise.all([cache.prepareVideoCache(), cache.prepareVideoCache()]);
    expect(deleteBucket).toHaveBeenCalledExactlyOnceWith(cache.VIDEO_CACHE_NAME);
    expect(state.rows.size).toBe(0);
  });
  it('清理失败向调用方报错并保留统计，不能显示假成功', async () => {
    seed('https://media.example/old', 4);
    deleteBucket.mockRejectedValueOnce(new Error('storage denied'));
    await expect(cache.clearVideoCache()).rejects.toThrow('storage denied');
    expect(state.rows.size).toBe(1);
  });
  it('定期维护可淘汰过期片段，即使未达到容量上限', async () => {
    seed('https://media.example/expired', 4, 8); seed('https://media.example/recent', 4, 1);
    await cache.enforceQuota();
    expect(state.rows.has('https://media.example/expired')).toBe(false);
    expect(state.rows.has('https://media.example/recent')).toBe(true);
  });
});
