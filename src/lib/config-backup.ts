import type { HistoryEntry, ProgressEntry, SearchHistoryEntry, WatchlistEntry } from './db';
import { PERSIST_KEY } from './persist-storage';

/** 缺少的表保留本机数据，显式空数组则清空该表。 */
export interface ConfigBackup {
  storage: Record<string, string>;
  history?: HistoryEntry[];
  progress?: ProgressEntry[];
  hasExplicitProgress: boolean;
  watchlist?: WatchlistEntry[];
  searchHistory?: SearchHistoryEntry[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份中的对象格式不正确');
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('备份中缺少有效的名称或记录标识');
  return value;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('备份中的文本字段格式不正确');
  return value;
}

function nonnegative(value: unknown, fallback: number, integer = false): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error('备份中的时间、进度或集数无效');
  }
  return value;
}

function historyRow(row: Record<string, unknown>): HistoryEntry {
  const sourceKey = text(row.sourceKey ?? row.sourceCode ?? row.sourceName);
  const rawId = row.vodId ?? row.vod_id;
  const vodId = text(typeof rawId === 'number' && Number.isFinite(rawId) ? String(rawId) : rawId);
  return {
    id: `${sourceKey}_${vodId}`, sourceKey, vodId,
    title: text(row.title ?? '未知视频'),
    sourceUrl: optionalText(row.sourceUrl), pic: optionalText(row.pic),
    episodeIndex: nonnegative(row.episodeIndex, 0, true),
    totalEpisodes: nonnegative(row.totalEpisodes, Array.isArray(row.episodes) ? row.episodes.length : 0, true),
    playbackPosition: nonnegative(row.playbackPosition, 0),
    duration: nonnegative(row.duration, 0), timestamp: nonnegative(row.timestamp, Date.now()),
  };
}

function progressRow(row: Record<string, unknown>): ProgressEntry {
  return { key: text(row.key), position: nonnegative(row.position, 0),
    duration: nonnegative(row.duration, 0), updatedAt: nonnegative(row.updatedAt, Date.now()) };
}

function watchlistRow(row: Record<string, unknown>): WatchlistEntry {
  const kind = row.kind;
  if (kind !== 'movie' && kind !== 'series') throw new Error('片单中的影片类型无效');
  return {
    id: text(row.id), title: text(row.title), kind,
    year: optionalText(row.year), cover: optionalText(row.cover),
    sourceKey: optionalText(row.sourceKey), sourceUrl: optionalText(row.sourceUrl),
    detail: optionalText(row.detail), vodId: optionalText(row.vodId),
    knownEpisodes: row.knownEpisodes === undefined ? undefined : nonnegative(row.knownEpisodes, 0, true),
    newEpisodes: row.newEpisodes === undefined ? undefined : nonnegative(row.newEpisodes, 0, true),
    addedAt: nonnegative(row.addedAt, Date.now()),
  };
}

function parseRows<T>(data: Record<string, unknown>, key: string,
  parse: (row: Record<string, unknown>) => T, identity: keyof T): T[] | undefined {
  if (data[key] === undefined) return undefined;
  if (typeof data[key] !== 'string') throw new Error(`备份的 ${key} 格式不正确`);
  const raw: unknown = JSON.parse(data[key]);
  if (!Array.isArray(raw)) throw new Error(`备份的 ${key} 应为列表`);
  const rows = raw.map((value) => parse(record(value)));
  if (new Set(rows.map((row) => row[identity])).size !== rows.length) {
    throw new Error(`备份的 ${key} 存在重复标识`);
  }
  return rows;
}

/** 整份校验成功后才允许调用方写入数据库。兼容旧版标记及两种历史字段。 */
export function parseConfigBackup(content: string): ConfigBackup {
  const config = record(JSON.parse(content));
  if (config.name !== 'JDK-TV-Settings' && config.name !== 'LibreTV-Settings') {
    throw new Error('文件不是兼容的 JDK TV 备份');
  }
  if (config.cfgVer !== undefined && (typeof config.cfgVer !== 'string' ||
      !/^\d+(?:\.\d+){0,2}$/.test(config.cfgVer) || Number(config.cfgVer.split('.')[0]) > 3)) {
    throw new Error('备份版本不支持，请先升级程序');
  }
  const data = record(config.data);
  const storage: Record<string, string> = {};
  for (const key of [PERSIST_KEY, 'libretv-theme', 'libretv-video-cache-settings']) {
    const value = data[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Error('备份中的偏好设置格式不正确');
    if (key === PERSIST_KEY) {
      const state = record(record(JSON.parse(value)).state);
      for (const field of ['customAPIs', 'selectedKeys', 'liveSubscriptions', 'liveSelectedUrls', 'subscriptions']) {
        if (state[field] !== undefined && !Array.isArray(state[field])) throw new Error(`备份的 ${field} 应为列表`);
      }
      for (const source of (state.customAPIs ?? []) as unknown[]) {
        const entry = record(source);
        text(entry.key);
        text(entry.name);
        text(entry.url);
      }
      for (const selected of (state.selectedKeys ?? []) as unknown[]) text(selected);
      for (const field of ['liveSubscriptions', 'subscriptions']) {
        for (const source of (state[field] ?? []) as unknown[]) text(record(source).url);
      }
      for (const selected of (state.liveSelectedUrls ?? []) as unknown[]) text(selected);
    }
    if (key === 'libretv-video-cache-settings') record(JSON.parse(value));
    storage[key] = value;
  }
  const history = parseRows(data, 'viewingHistory', historyRow, 'id');
  const explicitProgress = parseRows(data, 'playbackProgress', progressRow, 'key');
  const progress = explicitProgress ?? history?.filter((row) => row.playbackPosition > 0 && row.duration > 0).map((row) => ({
    key: `${row.sourceKey}_${row.vodId}_${row.episodeIndex}`,
    position: row.playbackPosition, duration: row.duration, updatedAt: row.timestamp,
  }));
  const watchlist = parseRows(data, 'watchlist', watchlistRow, 'id');
  const searchHistory = parseRows<SearchHistoryEntry>(data, 'searchHistory', (row) => ({
    text: text(row.text), timestamp: nonnegative(row.timestamp, Date.now()),
  }), 'text');
  if (!Object.keys(storage).length && history === undefined && explicitProgress === undefined &&
      watchlist === undefined && searchHistory === undefined) throw new Error('备份没有可导入的数据');
  return { storage, history, progress, hasExplicitProgress: explicitProgress !== undefined, watchlist, searchHistory };
}
