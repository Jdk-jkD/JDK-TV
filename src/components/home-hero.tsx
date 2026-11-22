'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useAppStore, resolveSource } from '@/lib/store';
import { buildWatchUrl } from '@/lib/utils';
import { SmartImage } from './smart-image';

export function HomeHero({ onSearch }: { onSearch: () => void }) {
  const recent = useLiveQuery(() => db.history.orderBy('timestamp').reverse().limit(1).toArray(), []);
  const item = recent?.[0];
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const source = item && resolveSource({ customAPIs, envSources }, item.sourceKey, { url: item.sourceUrl });
  const href = item && source ? buildWatchUrl({
    sourceKey: item.sourceKey,
    vodId: item.vodId,
    index: item.episodeIndex,
    title: item.title,
    sourceUrl: source.url,
    detail: source.detail,
  }) : null;
  const progress = item && item.duration > 0
    ? Math.min(100, Math.round(item.playbackPosition / item.duration * 100))
    : 0;

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.75fr)] mb-6" aria-label="首页导览">
      <div className="relative min-h-64 sm:min-h-72 overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-sky-950 via-slate-900 to-surface-raised p-6 sm:p-9 flex flex-col justify-end">
        <div aria-hidden className="absolute -right-12 -top-12 size-72 rounded-full border border-white/10 shadow-[0_0_0_45px_rgba(255,255,255,0.025),0_0_0_90px_rgba(255,255,255,0.018)]" />
        <p className="relative text-xs font-semibold tracking-widest text-sky-300 mb-3">影片与剧集</p>
        <h1 className="relative text-3xl sm:text-4xl font-bold text-white mb-3">把想看的，留在这里。</h1>
        <p className="relative text-sm text-slate-300 max-w-xl leading-relaxed mb-5">搜索已添加的点播源，选择影片后直接进入播放页。</p>
        <div className="relative flex flex-wrap gap-2">
          <button type="button" className="btn-primary px-4 py-2" onClick={onSearch}>搜索影片</button>
          <a href="#discover" className="btn-ghost px-4 py-2">浏览影片</a>
        </div>
      </div>
      <aside className="rounded-2xl border border-line bg-surface-raised p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-content mb-2">继续观看</h2>
        {item ? (
          <>
            <p className="text-xs text-faint mb-4">从这台设备上次观看的位置继续</p>
            <div className="flex items-center gap-3">
              {item.pic ? (
                <SmartImage url={item.pic} mode={imageProxyMode} customProxy={customImageProxy} alt="" className="w-16 h-20 rounded-lg object-cover bg-chip shrink-0" />
              ) : <div className="w-16 h-20 rounded-lg bg-chip shrink-0" />}
              <div className="min-w-0">
                <p className="font-medium text-content truncate">{item.title}</p>
                {item.totalEpisodes > 1 && <p className="text-xs text-faint mt-1">第 {item.episodeIndex + 1} / {item.totalEpisodes} 集</p>}
                {progress > 0 && <p className="text-xs text-faint mt-1">已观看 {progress}%</p>}
              </div>
            </div>
            <div className="h-1 rounded-full bg-chip mt-4 mb-4 overflow-hidden" aria-hidden>
              <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
            </div>
            {href ? <Link href={href} className="btn-ghost px-3 py-2">继续播放</Link> : <p className="text-xs text-faint">原点播源已移除，可从搜索重新选择。</p>}
          </>
        ) : (
          <p className="text-sm text-muted leading-relaxed">还没有观看记录。选一部影片开始播放后，进度会显示在这里。</p>
        )}
      </aside>
    </section>
  );
}
