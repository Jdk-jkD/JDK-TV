import Dexie, { type EntityTable } from 'dexie';
import type { SourceConfig } from './types';
// 仅类型引入：store.ts 运行时会引用本模块，反向只取类型不会形成运行时循环
import type { LiveProbeEntry } from './store';
import { PERSIST_KEY, flushPendingPersist } from './persist-storage';
import { parseConfigBackup } from './config-backup';

/**
 * IndexedDB 持久化（替代旧版 localStorage 数据库）：
 * - 观看历史不再冗余存储全集 URL 列表（旧版长剧 × 50 条极易撑爆 5MB 配额），
 *   只存定位信息（sourceKey+vodId+index），进入播放页时按需重新拉详情，
 *   顺带免费获得「剧集更新同步」能力。
 * - v2：直播测活缓存从 localStorage（随 zustand persist 整体重写）迁入独立表，
 *   高频写入不再拖累设置快照的序列化。
 */

export interface HistoryEntry {
  /** 主键：`${sourceKey}_${vodId}` */
  id: string;
  sourceKey: string;
  sourceUrl?: string;
  vodId: string;
  title: string;
  pic?: string;
  episodeIndex: number;
  totalEpisodes: number;
  playbackPosition: number;
  duration: number;
  timestamp: number;
}

export interface ProgressEntry {
  key: string; // `${sourceKey}_${vodId}_${episodeIndex}`
  position: number;
  duration: number;
  updatedAt: number;
}

export interface SearchHistoryEntry {
  text: string;
  timestamp: number;
}

export interface SegmentMetaEntry {
  /** Cache Storage 中的 key（归一化的分片绝对地址，或同源代理地址） */
  key: string;
  /** 所属剧集：`${source}:${vodId}:${episodeIndex}`，用于按集淘汰 */
  episodeKey: string;
  /** 片段序号（1 基，便于排查） */
  index: number;
  bytes: number;
  /** 预取时记录的真实耗时（毫秒），loader 命中缓存时合成进 hls.js stats 防 ABR 误判 */
  costMs: number;
  lastAccess: number;
}

export type DownloadStatus = 'waiting' | 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadTaskEntry {
  id: string;
  /** 播放页 m3u8 地址（直连或代理形式，入队时的原样） */
  url: string;
  title: string;
  /** 输出格式 */
  format: 'TS' | 'MP4';
  status: DownloadStatus;
  finished: number;
  total: number;
  errorNum: number;
  createdAt: number;
  updatedAt: number;
}

export interface WatchlistEntry {
  id: string;
  title: string;
  kind: 'movie' | 'series';
  year?: string;
  cover?: string;
  sourceKey?: string;
  sourceUrl?: string;
  detail?: string;
  vodId?: string;
  knownEpisodes?: number;
  newEpisodes?: number;
  addedAt: number;
}

export const watchlistId = (title: string, kind: WatchlistEntry['kind'], year?: string) =>
  JSON.stringify([kind, title.normalize('NFKC').trim().toLowerCase(), year?.trim() ?? '']);

// 历史数据库名作为兼容标识保留，避免升级后出现空白媒体库。
export const db = new Dexie('libretv') as Dexie & {
  history: EntityTable<HistoryEntry, 'id'>;
  progress: EntityTable<ProgressEntry, 'key'>;
  searchHistory: EntityTable<SearchHistoryEntry, 'text'>;
  liveProbe: EntityTable<LiveProbeEntry & { url: string }, 'url'>;
  segmentMeta: EntityTable<SegmentMetaEntry, 'key'>;
  downloads: EntityTable<DownloadTaskEntry, 'id'>;
  watchlist: EntityTable<WatchlistEntry, 'id'>;
};

db.version(1).stores({
  history: 'id, timestamp',
  progress: 'key, updatedAt',
  searchHistory: 'text, timestamp',
});

// v2 仅新增表；Dexie 会自动继承低版本的表结构
db.version(2).stores({
  liveProbe: 'url',
});

// v3：视频片段缓存元数据（Cache Storage 存字节、这里存 LRU 索引）与离线下载任务
db.version(3).stores({
  segmentMeta: 'key, episodeKey, lastAccess',
  downloads: 'id, createdAt',
});

db.version(4).stores({ watchlist: 'id, addedAt' });

export async function findWatchlistEntry(title: string, kind: WatchlistEntry['kind'], year?: string) {
  const id = watchlistId(title, kind, year);
  const exact = await db.watchlist.get(id);
  if (exact) return exact;
  const yearAgnosticId = watchlistId(title, kind);
  const candidates = await db.watchlist.filter((item) =>
    (!year || !item.year) && watchlistId(item.title, item.kind) === yearAgnosticId).limit(2).toArray();
  return candidates.length === 1 ? candidates[0] : undefined;
}

export const MAX_HISTORY = 100;
export const MAX_SEARCH_HISTORY = 10;

export async function upsertHistory(entry: Omit<HistoryEntry, 'id'>): Promise<void> {
  const id = `${entry.sourceKey}_${entry.vodId}`;
  const existing = await db.history.get(id);
  const merged: HistoryEntry = {
    ...existing,
    ...entry,
    id,
    playbackPosition: entry.playbackPosition > 10 ? entry.playbackPosition : existing?.playbackPosition ?? 0,
    duration: entry.duration || existing?.duration || 0,
    timestamp: Date.now(),
  };
  await db.history.put(merged);
  // 淘汰最旧记录
  const count = await db.history.count();
  if (count > MAX_HISTORY) {
    const oldest = await db.history.orderBy('timestamp').limit(count - MAX_HISTORY).toArray();
    await db.history.bulkDelete(oldest.map((o) => o.id));
  }
}

export async function updateHistoryProgress(
  sourceKey: string,
  vodId: string,
  position: number,
  duration: number
): Promise<void> {
  const id = `${sourceKey}_${vodId}`;
  const existing = await db.history.get(id);
  if (!existing) return;
  if (Math.abs(existing.playbackPosition - position) < 2 && Math.abs(existing.duration - duration) < 2) return;
  await db.history.update(id, {
    playbackPosition: position,
    duration,
    timestamp: Date.now(),
  });
}

export async function removeHistory(sourceKey: string, vodId: string): Promise<void> {
  await db.history.delete(`${sourceKey}_${vodId}`);
}

export async function clearAllHistory(): Promise<void> {
  // 一并清进度表：否则从历史重新打开时可能取到已清空的旧进度
  await Promise.all([db.history.clear(), db.progress.clear()]);
}

export function progressKeyOf(sourceKey: string, vodId: string, episodeIndex: number): string {
  return `${sourceKey}_${vodId}_${episodeIndex}`;
}

export async function saveProgress(sourceKey: string, vodId: string, episodeIndex: number, position: number, duration: number): Promise<void> {
  if (!duration || position < 1) return;
  await db.progress.put({
    key: progressKeyOf(sourceKey, vodId, episodeIndex),
    position,
    duration,
    updatedAt: Date.now(),
  });
}

export async function clearProgress(sourceKey: string, vodId: string, episodeIndex: number): Promise<void> {
  await db.progress.delete(progressKeyOf(sourceKey, vodId, episodeIndex));
}

export async function addSearchHistory(text: string): Promise<void> {
  const t = text.trim().slice(0, 50);
  if (!t) return;
  await db.searchHistory.put({ text: t, timestamp: Date.now() });
  const count = await db.searchHistory.count();
  if (count > MAX_SEARCH_HISTORY) {
    const oldest = await db.searchHistory.orderBy('timestamp').limit(count - MAX_SEARCH_HISTORY).toArray();
    await db.searchHistory.bulkDelete(oldest.map((o) => o.text));
  }
}

export async function removeSearchHistory(text: string): Promise<void> {
  await db.searchHistory.delete(text);
}

export async function clearSearchHistory(): Promise<void> {
  await db.searchHistory.clear();
}

/** 撤销「清空搜索记录」：按原时间戳回填，保持原有顺序 */
export async function restoreSearchHistory(entries: SearchHistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.searchHistory.bulkPut(entries);
}

// —— 直播测活缓存（TTL 过滤由调用方负责，本层只管存取） ——

export async function loadLiveProbeResults(): Promise<Record<string, LiveProbeEntry>> {
  const rows = await db.liveProbe.toArray();
  const out: Record<string, LiveProbeEntry> = {};
  for (const r of rows) out[r.url] = r;
  return out;
}

export async function saveLiveProbeResults(entries: Record<string, LiveProbeEntry>): Promise<void> {
  const rows = Object.entries(entries).map(([url, e]) => ({ ...e, url }));
  if (rows.length > 0) await db.liveProbe.bulkPut(rows);
}

export async function clearLiveProbeResultsDb(): Promise<void> {
  await db.liveProbe.clear();
}

// —— 配置导入导出（兼容旧版 LibreTV-Settings JSON 结构的导出格式） ——

export async function exportConfig(): Promise<string> {
  // 导出前 flush：把节流缓冲中的最新设置落盘，避免导出的是 800ms 前的旧快照
  flushPendingPersist();
  const data = await db.transaction('r', [db.history, db.progress, db.watchlist, db.searchHistory], async () => ({
    viewingHistory: JSON.stringify(await db.history.toArray()),
    playbackProgress: JSON.stringify(await db.progress.toArray()),
    watchlist: JSON.stringify(await db.watchlist.toArray()),
    searchHistory: JSON.stringify(await db.searchHistory.toArray()),
  })) as Record<string, string>;
  for (const key of [PERSIST_KEY, 'libretv-theme', 'libretv-video-cache-settings']) {
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  }
  const content = JSON.stringify({
    name: 'JDK-TV-Settings',
    time: Date.now().toString(),
    cfgVer: '3.0.0',
    data,
  });
  parseConfigBackup(content);
  return content;
}

export async function importConfig(content: string): Promise<void> {
  const backup = parseConfigBackup(content);
  flushPendingPersist();
  const previous = new Map(Object.keys(backup.storage).map((key) => [key, localStorage.getItem(key)]));
  const written: string[] = [];
  try {
    await db.transaction('rw', [db.history, db.progress, db.watchlist, db.searchHistory], async () => {
      if (backup.history !== undefined) {
        await db.history.clear();
        await db.history.bulkPut(backup.history);
      }
      if (backup.progress !== undefined) {
        if (backup.hasExplicitProgress) await db.progress.clear();
        await db.progress.bulkPut(backup.progress);
      }
      if (backup.watchlist !== undefined) {
        await db.watchlist.clear();
        await db.watchlist.bulkPut(backup.watchlist);
      }
      if (backup.searchHistory !== undefined) {
        await db.searchHistory.clear();
        await db.searchHistory.bulkPut(backup.searchHistory);
      }
      // 同步写入偏好；写入失败会中止数据库事务，随后回退已写的 localStorage。
      for (const [key, value] of Object.entries(backup.storage)) {
        localStorage.setItem(key, value);
        written.push(key);
      }
    });
  } catch (error) {
    for (const key of written) {
      // 不回退其他标签页在此期间写入的新值。
      if (localStorage.getItem(key) !== backup.storage[key]) continue;
      const value = previous.get(key);
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    throw error;
  }
}

export type { SourceConfig };
