'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { Header } from '@/components/header';
import { SmartImage } from '@/components/smart-image';
import { api } from '@/lib/client-api';
import { db, type WatchlistEntry } from '@/lib/db';
import { watchlistUpdate } from '@/lib/playback-choice';
import { resolveSource, useAppStore } from '@/lib/store';
import { buildWatchUrl } from '@/lib/utils';

export default function WatchlistPage() {
  const entries = useLiveQuery(() => db.watchlist.orderBy('addedAt').reverse().toArray(), []);
  const history = useLiveQuery(() => db.history.orderBy('timestamp').reverse().toArray(), []);
  const store = useAppStore();
  const checking = useRef<AbortController | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => () => checking.current?.abort(), []);

  async function refresh() {
    if (!entries || checking.current) return;
    const controller = new AbortController();
    checking.current = controller;
    setBusy(true);
    setStatus('');
    let updated = 0;
    let failed = 0;
    let unlinked = 0;
    try {
      for (const item of entries.filter((entry) => entry.kind === 'series')) {
        if (controller.signal.aborted) return;
        const { sourceKey, sourceUrl, vodId, detail } = item;
        const source = sourceKey && resolveSource(useAppStore.getState(), sourceKey, { url: sourceUrl, detail });
        if (!source || !vodId) { unlinked++; continue; }
        try {
          const result = await api.detail(vodId, source, controller.signal);
          if (!result.episodes.length || result.videoInfo.title?.trim() !== item.title.trim() ||
              (item.year && result.videoInfo.year && item.year !== result.videoInfo.year)) { failed++; continue; }
          const changed = await db.watchlist.update(item.id, (row) => {
            if (row.sourceKey !== sourceKey || row.vodId !== vodId) return;
            const next = watchlistUpdate(row.knownEpisodes ?? 0, result.episodes.length);
            row.knownEpisodes = next.known;
            row.newEpisodes = (row.newEpisodes ?? 0) + next.added;
            if (next.added) updated++;
          });
          if (!changed && !controller.signal.aborted) continue;
        } catch {
          if (controller.signal.aborted) return;
          failed++;
        }
      }
      setStatus([`发现 ${updated} 部剧集更新`, failed ? `${failed} 部检查失败` : '',
        unlinked ? `${unlinked} 部需先选线路` : ''].filter(Boolean).join(' · '));
    } finally {
      if (checking.current === controller) {
        checking.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }

  const historyLink = (item: NonNullable<typeof history>[number]) => buildWatchUrl({
    sourceKey: item.sourceKey, sourceUrl: item.sourceUrl, vodId: item.vodId,
    title: item.title, cover: item.pic, index: item.episodeIndex,
  });

  function savedLink(item: WatchlistEntry) {
    const recent = history?.find((row) => row.sourceKey === item.sourceKey && row.vodId === item.vodId);
    if (!item.sourceKey || !item.vodId) return '/?s=' + encodeURIComponent(item.title);
    const firstNew = item.newEpisodes && item.knownEpisodes ? item.knownEpisodes - item.newEpisodes : undefined;
    return buildWatchUrl({ sourceKey: item.sourceKey, sourceUrl: item.sourceUrl,
      vodId: item.vodId, detail: item.detail, title: item.title, cover: item.cover,
      index: firstNew ?? recent?.episodeIndex ?? 0 });
  }

  const recent = history?.filter((row) => row.vodId && row.playbackPosition > 0 &&
    row.duration > 0 && row.playbackPosition < row.duration - 10).slice(0, 10) ?? [];

  return <div className="min-h-screen bg-surface">
    <Header showSearch />
    <main className="mx-auto max-w-7xl px-4 pb-12 pt-7">
      <h1 className="mb-6 text-2xl font-semibold text-content">我的片单</h1>
      <section className="mb-8" aria-label="继续观看">
        <h2 className="mb-3 text-lg font-semibold text-content">继续观看</h2>
        {recent.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {recent.map((row) => <Link className="rounded-lg border border-line bg-surface-raised p-3 hover:border-accent" key={row.id} href={historyLink(row)}>
            <p className="truncate text-sm font-medium text-content">{row.title}</p>
            <p className="mt-1 text-xs text-muted">{row.totalEpisodes > 1 ? `第 ${row.episodeIndex + 1} 集 · ` : ''}
              已看 {Math.round(row.playbackPosition / row.duration * 100)}%</p>
          </Link>)}
        </div> : <p className="text-sm text-muted">暂无续播记录。</p>}
      </section>
      {(['series', 'movie'] as const).map((kind) => {
        const items = entries?.filter((row) => row.kind === kind) ?? [];
        return <section className="mb-8" key={kind} aria-label={kind === 'series' ? '追更' : '想看的电影'}>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-content">{kind === 'series' ? '追更' : '想看的电影'}</h2>
            {kind === 'series' && items.length > 0 && <button type="button" className="btn-ghost btn-sm" disabled={busy}
              onClick={() => void refresh()}>{busy ? '正在检查…' : '检查更新'}</button>}
            {kind === 'series' && status && <p role="status" className="text-xs text-muted">{status}</p>}
          </div>
          {items.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((item) => <article key={item.id} className="overflow-hidden rounded-xl border border-line bg-surface-raised">
              <Link href={savedLink(item)} className="block hover:text-accent">
                <div className="aspect-[2/3] bg-chip">
                  {item.cover && <SmartImage url={item.cover} mode={store.imageProxyMode} customProxy={store.customImageProxy}
                    alt="" className="size-full object-cover" />}
                </div>
                <p className="truncate px-3 pt-2 text-sm font-medium" title={item.title}>{item.title}</p>
              </Link>
              <div className="flex flex-wrap items-center justify-between gap-1 px-3 pb-3 pt-1 text-xs">
                {item.kind === 'series' && Boolean(item.knownEpisodes) && !item.newEpisodes &&
                  <span className="text-muted">已收录 {item.knownEpisodes} 集</span>}
                <Link className="text-accent" href={savedLink(item)}>
                  {item.newEpisodes ? `新增 ${item.newEpisodes} 集 · 播放` : item.sourceKey ? '打开播放' : '查找播放线路'}
                </Link>
                {Boolean(item.newEpisodes) && <button type="button" className="text-muted hover:text-content"
                  onClick={() => void db.watchlist.update(item.id, { newEpisodes: 0 })}>标为已查看</button>}
                <button type="button" className="text-muted hover:text-content" aria-label={`移除 ${item.title}`}
                  onClick={() => void db.watchlist.delete(item.id)}>移除</button>
              </div>
            </article>)}
          </div> : <p className="text-sm text-muted">{entries ? '可从发现页或播放页添加。' : '正在读取本机片单…'}</p>}
        </section>;
      })}
    </main>
  </div>;
}
