'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SearchResultItem, SourceConfig } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { qualityKey } from '@/lib/quality';
import { compactRemarks, formatRemarks, inferGroupRemarks } from '@/lib/remarks';
import { cn } from '@/lib/utils';
import { SmartImage } from './smart-image';
import { QualityBadge } from './quality-badge';
import { useQualityProbe } from './use-quality-probe';

// —— 跨源同名聚合 ——

export interface AggregatedGroup {
  key: string;
  name: string;
  year?: string;
  typeName?: string;
  pic?: string;
  remarks?: string;
  items: SearchResultItem[];
}

function buildGroup(name: string, year: string | undefined, items: SearchResultItem[]): AggregatedGroup {
  return {
    key: JSON.stringify([name, year]),
    name,
    year,
    typeName: items.find((i) => i.typeName)?.typeName,
    pic: items.find((i) => i.pic)?.pic,
    // 同一部剧各源文案详略不同（「全34集」/「完结」/「更新至34集」），推到统一结论，
    // 否则同一部剧的来源列表会看起来状态各异
    remarks: inferGroupRemarks(items.map((i) => i.remarks)),
    items,
  };
}

/**
 * 把扁平的跨源搜索结果按「同名影片」聚合：
 * - 以名称分桶；桶内年份不一致时（同名翻拍）按年份拆分，无年份的条目并入年份桶；
 * - 保持传入顺序（搜索结果已按名称排序）。
 */
export function aggregateResults(list: SearchResultItem[]): AggregatedGroup[] {
  const byName = new Map<string, SearchResultItem[]>();
  for (const item of list) {
    const k = (item.name || '').trim();
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(item);
  }
  const groups: AggregatedGroup[] = [];
  for (const [name, items] of byName) {
    const years = [...new Set(items.map((i) => i.year).filter(Boolean))] as string[];
    if (years.length > 1) {
      for (const y of years) {
        groups.push(buildGroup(name, y, items.filter((i) => i.year === y)));
      }
      const noYear = items.filter((i) => !i.year);
      if (noYear.length) groups.push(buildGroup(name, undefined, noYear));
    } else {
      groups.push(buildGroup(name, years[0], items));
    }
  }
  return groups;
}

export function selectGroupSources(items: SearchResultItem[]): SearchResultItem[] {
  const firstBySource = new Map<string, SearchResultItem>();
  for (const item of items) {
    if (!firstBySource.has(item.sourceKey)) firstBySource.set(item.sourceKey, item);
  }
  return [...firstBySource.values()];
}

export function AggregatedCard({ group, expanded, controls, onToggle }: {
  group: AggregatedGroup;
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const count = selectGroupSources(group.items).length;

  return (
    <button
      type="button"
      className={cn('card group flex h-full min-w-0 flex-col text-left transition-colors hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', expanded && 'ring-2 ring-accent/70')}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      onClick={onToggle}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-chip">
        <div className="absolute inset-0 grid place-items-center text-faint" aria-hidden>
          <svg className="size-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="m10 9 5 3-5 3z" />
          </svg>
        </div>
        {group.pic && (
          <SmartImage url={group.pic} mode={imageProxyMode} customProxy={customImageProxy}
            alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
      </div>
      <div className="flex h-24 w-full flex-col justify-between px-2.5 py-2 sm:px-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-content sm:text-base" title={group.name}>{group.name}</h3>
        <div className="flex items-center gap-2 text-xs">
          {group.year && <span className="text-muted">{group.year}</span>}
          <span className={cn('tag ml-auto whitespace-nowrap', expanded ? 'bg-accent/20 text-accent' : 'bg-chip text-muted')}>
            {count} 个源可用
          </span>
        </div>
      </div>
    </button>
  );
}

export function SourceMatrix({ group, sources, onOpen, onClose, id }: {
  group: AggregatedGroup;
  sources: SourceConfig[];
  onOpen: (item: SearchResultItem) => void;
  onClose: () => void;
  id: string;
}) {
  const items = useMemo(() => selectGroupSources(group.items), [group.items]);
  const { qualities, probing, progress, probe, retry } = useQualityProbe(sources);
  useEffect(() => { probe(items); }, [items, probe]);
  const sorted = [...items].sort((a, b) =>
    (qualities[qualityKey(b.sourceKey, b.vodId)]?.height ?? 0) -
    (qualities[qualityKey(a.sourceKey, a.vodId)]?.height ?? 0));
  return (
    <section id={id} aria-label="片源矩阵" className="col-span-full min-w-0 rounded-xl border border-accent/30 bg-surface-raised p-3 sm:p-4 source-matrix-enter">
      <div className="mb-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-content">{group.name} · 片源矩阵</h2>
          <p className="mt-1 text-xs text-muted" aria-live="polite">
            {items.length} 个来源
            {progress.total > progress.done ? ` · 画质探测 ${progress.done}/${progress.total}` : ''}
          </p>
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={onClose}>收起</button>
      </div>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {sorted.map((item) => {
          const key = qualityKey(item.sourceKey, item.vodId);
          const remarks = compactRemarks(item.remarks);
          return (
            <div key={key} className="flex min-w-0 items-center gap-1.5 rounded-lg border border-line bg-chip px-2.5 py-1.5 hover:border-accent/60">
              <button type="button" className="group min-w-0 flex-1 py-1 text-left text-xs" onClick={() => onOpen(item)}
                aria-label={`使用 ${item.sourceName} 播放`}>
                <span className="block truncate font-medium text-content group-hover:text-accent" title={item.sourceName}>{item.sourceName}</span>
                {remarks && <span className="mt-1 block truncate text-faint">{remarks}</span>}
              </button>
              <QualityBadge entry={qualities[key]} loading={probing[key]} onRetry={() => retry([item])} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 影片卡片：封面加载失败时逐级降级到占位图（未聚合的单一结果使用） */
export function VideoCard({ item, onClick }: { item: SearchResultItem; onClick: () => void }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = !!item.pic && !imgFailed;

  return (
    <div
      className="card cursor-pointer hover:scale-[1.02] hover:shadow-md h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // 阻止空格触发页面滚动（AggregatedCard 已是此写法，此处对齐）
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex h-full">
        {showImg ? (
          <div className="relative flex-shrink-0 w-[105px] sm:w-[120px] aspect-[2/3] bg-chip">
            <SmartImage
              url={item.pic}
              mode={imageProxyMode}
              customProxy={customImageProxy}
              alt={item.name}
              className="h-full w-full object-cover"
              onExhausted={() => setImgFailed(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />
          </div>
        ) : (
          <div className="flex-shrink-0 w-[105px] sm:w-[120px] aspect-[2/3] bg-chip flex items-center justify-center">
            <svg className="w-8 h-8 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16m10-16v16M3 6a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm8 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6z" />
            </svg>
          </div>
        )}

        <div className="p-2.5 flex flex-col flex-grow min-w-0">
          <div className="flex-grow">
            <h3 className="font-semibold text-sm text-content mb-1.5 line-clamp-2" title={item.name}>
              {item.name}
            </h3>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {item.typeName && <span className="tag bg-accent/15 text-accent">{item.typeName}</span>}
              {item.year && <span className="tag bg-purple-500/15 text-purple-600 dark:text-purple-300">{item.year}</span>}
            </div>
            <p className="text-xs text-muted line-clamp-2 mb-2">{formatRemarks(item.remarks) || '暂无介绍'}</p>
          </div>
          <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-line">
            <span className="tag bg-chip text-muted truncate max-w-[80%]">{item.sourceName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 豆瓣推荐卡片（无来源徽章，点击直接搜索） */
export function DoubanCard({ item, onClick }: { item: { title: string; cover: string; rating?: string; rank?: number; year?: number; regions?: string[] }; onClick: () => void }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [item.cover]);

  return (
    <div
      className="card cursor-pointer hover:scale-[1.03] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // 阻止空格触发页面滚动（AggregatedCard 已是此写法，此处对齐）
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="relative aspect-[2/3] bg-chip">
        {item.cover && !imgFailed ? (
          <SmartImage
            url={item.cover}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt={item.title}
            className="w-full h-full object-cover"
            onExhausted={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-chip">
            <svg className="w-8 h-8 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16m10-16v16M3 6a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm8 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6z" />
            </svg>
          </div>
        )}
        {item.rating && (
          <span className={cn('absolute top-1.5 right-1.5 tag bg-black/70 text-rating font-medium')}>
            ★ {item.rating}
          </span>
        )}
        {item.rank && (
          <span className="absolute top-1.5 left-1.5 tag bg-black/70 text-white font-medium">第 {item.rank} 名</span>
        )}
      </div>
      <div className="p-3">
        <div className="text-sm font-semibold text-content truncate" title={item.title}>
          {item.title}
        </div>
        {(item.year || item.regions?.length) && (
          <p className="mt-1 text-xs text-muted truncate">{[item.year, item.regions?.join(' / ')].filter(Boolean).join(' · ')}</p>
        )}
      </div>
    </div>
  );
}
