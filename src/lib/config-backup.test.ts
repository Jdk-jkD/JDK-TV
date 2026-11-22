import { describe, expect, it } from 'vitest';
import { parseConfigBackup } from './config-backup';

const history = {
  id: 's_42', sourceKey: 's', sourceUrl: 'https://example.com/api', vodId: '42', title: '测试影片',
  episodeIndex: 2, totalEpisodes: 12, playbackPosition: 8, duration: 1500, timestamp: 123,
};
const progress = { key: 's_42_2', position: 8, duration: 1500, updatedAt: 123 };
const watchlist = { id: '["movie","测试影片","2026"]', title: '测试影片', kind: 'movie', year: '2026', addedAt: 100 };
const settings = JSON.stringify({ version: 8, state: { customAPIs: [], selectedKeys: [] } });
const backup = (data: Record<string, string | undefined>, cfgVer = '3.0.0') => JSON.stringify({ name: 'JDK-TV-Settings', cfgVer, data });

describe('个人数据备份解析', () => {
  it('恢复当前历史、独立进度和片单，保留原时间及十秒以内的位置', () => {
    const result = parseConfigBackup(backup({
      'libretv-settings': settings, viewingHistory: JSON.stringify([history]),
      playbackProgress: JSON.stringify([progress]), watchlist: JSON.stringify([watchlist]),
      searchHistory: JSON.stringify([{ text: '测试影片', timestamp: 99 }]),
    }));
    expect(result.history).toEqual([history]);
    expect(result.progress).toEqual([progress]);
    expect(result.watchlist).toEqual([watchlist]);
    expect(result.hasExplicitProgress).toBe(true);
    expect(result.searchHistory).toEqual([{ text: '测试影片', timestamp: 99 }]);
    expect(result.storage['libretv-settings']).toBe(settings);
  });

  it('local.7 导出的 sourceKey/vodId 格式能够恢复，并从历史补出进度', () => {
    const result = parseConfigBackup(JSON.stringify({ name: 'LibreTV-Settings', cfgVer: '2.0.0', data: {
      'libretv-settings': settings, viewingHistory: JSON.stringify([history]),
    } }));
    expect(result.history).toEqual([history]);
    expect(result.progress).toEqual([progress]);
    expect(result.hasExplicitProgress).toBe(false);
    expect(result.watchlist).toBeUndefined();
    expect(result.searchHistory).toBeUndefined();
  });

  it('兼容 sourceCode、vod_id、全集数组的旧历史', () => {
    const result = parseConfigBackup(JSON.stringify({ name: 'LibreTV-Settings', data: {
      viewingHistory: JSON.stringify([{ sourceCode: 's', vod_id: 42, title: '旧影片', episodes: ['a', 'b'],
        episodeIndex: 1, playbackPosition: 90, duration: 200, timestamp: 456 }]),
    } }));
    expect(result.history?.[0]).toEqual({ id: 's_42', sourceKey: 's', vodId: '42', title: '旧影片',
      episodeIndex: 1, totalEpisodes: 2, playbackPosition: 90, duration: 200, timestamp: 456 });
    expect(result.progress).toEqual([{ key: 's_42_1', position: 90, duration: 200, updatedAt: 456 }]);
  });

  it('明确的空列表表示替换为空，缺少字段表示不替换', () => {
    const result = parseConfigBackup(backup({ viewingHistory: '[]', watchlist: '[]' }));
    expect(result.history).toEqual([]);
    expect(result.progress).toEqual([]);
    expect(result.watchlist).toEqual([]);
    expect(result.searchHistory).toBeUndefined();
  });

  it.each([
    { viewingHistory: '[{' },
    { viewingHistory: '{}' },
    { viewingHistory: JSON.stringify([{ ...history, vodId: '' }]) },
    { playbackProgress: JSON.stringify([{ ...progress, position: -1 }]) },
    { watchlist: JSON.stringify([{ ...watchlist, kind: 'other' }]) },
    { 'libretv-settings': '{"state":[]}' },
    { 'libretv-settings': '{"state":{"customAPIs":"broken"}}' },
  ])('导入前拒绝损坏数据 %j，不能静默跳过', (data) => {
    expect(() => parseConfigBackup(backup(data))).toThrow();
  });

  it('拒绝未来版本，避免误解新格式后丢失数据', () => {
    expect(() => parseConfigBackup(backup({ viewingHistory: '[]' }, '4.0.0'))).toThrow();
  });
});
