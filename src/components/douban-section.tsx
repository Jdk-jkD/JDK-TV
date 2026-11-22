'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { WatchlistButton } from './watchlist-button';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { DoubanItem } from '@/lib/types';
import { DoubanCard } from './video-card';
import { db } from '@/lib/db';

const MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动画'];
const TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 首页推荐区：数据源由设置决定（豆瓣热门 / Bangumi 新番放送 / 影视热榜），二选一展示 */
export function RecommendSection({ onPick }: { onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);

  if (!doubanEnabled) return null;
  if (recommendSource === 'bangumi') return <BangumiView onPick={onPick} />;
  return <DoubanView key={recommendSource} onPick={onPick} initialRanked={recommendSource === 'hot-list'} />;
}

/**
 * 豆瓣推荐：影视切换 + 标签筛选。
 * 一次性渲染全部条目：数据本就一次拉全（50 条），卡片图片又是 lazy 加载，
 * 视口外的图不会请求，因此不需要「加载更多」这类本地切片分页来打断浏览。
 */
function DoubanView({ onPick, initialRanked }: { onPick: (title: string) => void; initialRanked: boolean }) {
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [tag, setTag] = useState('热门');
  const [ranked, setRanked] = useState(initialRanked);
  const [listId, setListId] = useState('douban_tv_chinese');
  const [genre, setGenre] = useState('');
  const [region, setRegion] = useState('');
  const [decade, setDecade] = useState('');
  const [sort, setSort] = useState('default');
  const [rating, setRating] = useState('');
  const [maxRating, setMaxRating] = useState('');
  const [platform, setPlatform] = useState('');
  const [playedOnly, setPlayedOnly] = useState(false);
  const [played, setPlayed] = useState<Set<string>>(new Set());
  const [playedStatus, setPlayedStatus] = useState<'ready' | 'error'>('ready');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const activeFilters = [genre, region, decade, platform, rating || maxRating, playedOnly, sort !== 'default'].filter(Boolean).length;
  const activeList = type === 'movie' ? 'douban_movie_weekly' : listId;

  const query = useQuery({
    queryKey: ranked ? ['hot-list', activeList] : ['douban', type, tag],
    queryFn: ({ signal }) => ranked ? api.hotList(activeList, signal) : api.douban(type, tag, 0, 50, signal),
    staleTime: 5 * 60 * 1000,
  });

  const tags = type === 'movie' ? MOVIE_TAGS : TV_TAGS;
  const entries = query.data?.items;
  const filterOptions = useMemo(() => ({
    genres: [...new Set(entries?.flatMap((item) => item.genres ?? []))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    regions: [...new Set(entries?.flatMap((item) => item.regions ?? []))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    platforms: [...new Set(entries?.flatMap((item) => item.platforms ?? []))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    decades: [...new Set(entries?.flatMap((item) => item.year ? [Math.floor(item.year / 10) * 10] : []))].sort((a, b) => b - a),
  }), [entries]);
  const items = (entries ?? []).filter((item) =>
    (!genre || item.genres?.includes(genre)) &&
    (!region || item.regions?.includes(region)) &&
    (!decade || (item.year && Math.floor(item.year / 10) * 10 === Number(decade))) &&
    (!rating || (item.rating && Number(item.rating) >= Number(rating))) &&
    (!maxRating || (item.rating && Number(item.rating) <= Number(maxRating))) &&
    (!platform || item.platforms?.includes(platform)) &&
    (!playedOnly || played.has(`${type}:${item.title.trim()}`))
  );
  if (sort === 'rating') items.sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0));
  if (sort === 'recent') items.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  useEffect(() => {
    if (!playedOnly) return;
    let active = true;
    void db.history.toArray().then((rows) => {
      if (!active) return;
      setPlayed(new Set(rows.filter((row) => row.duration > 0 && row.playbackPosition > 0)
        .map((row) => `${row.totalEpisodes > 1 ? 'tv' : 'movie'}:${row.title.trim()}`)));
      setPlayedStatus('ready');
    }).catch(() => { if (active) setPlayedStatus('error'); });
    return () => { active = false; };
  }, [playedOnly]);

  function resetMetadata() {
    setGenre('');
    setRegion('');
    setDecade('');
    setSort('default');
    setRating('');
    setMaxRating('');
    setPlatform('');
    setPlayedOnly(false);
  }

  const switchType = (t: 'movie' | 'tv') => {
    if (t === type) return;
    setType(t);
    setTag('热门');
    resetMetadata();
  };

  return (
    <section aria-label="影视推荐">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex bg-chip rounded-lg p-0.5">
            <TypeButton active={type === 'movie'} onClick={() => switchType('movie')}>
              电影
            </TypeButton>
            <TypeButton active={type === 'tv'} onClick={() => switchType('tv')}>
              剧集
            </TypeButton>
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-start justify-between gap-2 sm:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <ChipButton key={t} active={!ranked && t === tag} onClick={() => {
              if (ranked || t !== tag) { setRanked(false); setTag(t); resetMetadata(); }
            }}>{t}</ChipButton>
          ))}
          <ChipButton active={ranked} onClick={() => { if (!ranked) { setRanked(true); resetMetadata(); } }}>榜单</ChipButton>
        </div>
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls={filtersId}
          onClick={() => setFiltersOpen((open) => !open)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs leading-none transition-colors sm:px-3',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            filtersOpen || activeFilters
              ? 'border-accent/50 bg-accent/10 text-accent'
              : 'border-line bg-surface-raised text-content hover:border-accent/40 hover:bg-hover',
          )}
        >
          <span aria-hidden="true" className="text-accent">⚡︎</span>
          高级筛选
          {activeFilters > 0 && <span className="rounded-full bg-accent/15 px-1.5 py-0.5" aria-label={`${activeFilters} 项已启用`}>{activeFilters}</span>}
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
            className={cn('size-3.5 transition-transform motion-reduce:transition-none', filtersOpen && 'rotate-180')}>
            <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {ranked && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {HOT_LISTS.filter((list) => type === 'movie' ? list.id === activeList : list.id !== 'douban_movie_weekly').map((list) => (
            <ChipButton key={list.id} active={activeList === list.id} onClick={() => {
              if (activeList !== list.id) { setListId(list.id); resetMetadata(); }
            }}>{list.label}</ChipButton>
          ))}
          <a href={type === 'movie' ? 'https://movie.douban.com/chart' : 'https://movie.douban.com/tv/'} target="_blank" rel="noreferrer" className="text-xs text-accent">豆瓣榜单</a>
        </div>
      )}
      <div id={filtersId} inert={!filtersOpen} className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
        filtersOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}>
        <div className="min-h-0 overflow-hidden">
          <div className="mb-4 rounded-xl border border-line bg-surface-raised p-3">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <FilterSelect label="类型" value={genre} onChange={setGenre} options={filterOptions.genres.map((name) => [name, name])} />
              <FilterSelect label="地区" value={region} onChange={setRegion} options={filterOptions.regions.map((name) => [name, name])} />
              <FilterSelect label="年代" value={decade} onChange={setDecade} options={filterOptions.decades.map((year) => [String(year), `${year} 年代`])} />
              <FilterSelect label="平台" value={platform} onChange={setPlatform} options={filterOptions.platforms.map((name) => [name, name])} />
              <FilterSelect label="排序" value={sort} onChange={setSort} options={[
                ['default', ranked ? '原榜名次' : '推荐顺序'], ['rating', '评分从高到低'],
                ...(filterOptions.decades.length ? [['recent', '年代从新到旧'] as [string, string]] : []),
              ]} />
              <FilterSelect label="最低评分" value={rating} onChange={(value) => {
                setRating(value);
                if (maxRating && Number(value) > Number(maxRating)) setMaxRating('');
              }} options={[
                ['6', '6 分'], ['7', '7 分'], ['8', '8 分'], ['9', '9 分'],
              ]} />
              <FilterSelect label="最高评分" value={maxRating} onChange={setMaxRating} options={([
                ['7', '7 分'], ['8', '8 分'], ['9', '9 分'], ['10', '10 分'],
              ] as Array<[string, string]>).filter(([score]) => Number(score) >= Number(rating))} />
              <label className="flex items-center gap-2 text-sm text-muted self-center" title="按同名作品的本机播放历史筛选，线路可能已变化">
                <input type="checkbox" checked={playedOnly} onChange={(event) => setPlayedOnly(event.target.checked)} />
                本机播过
              </label>
              <button type="button" className="btn-ghost btn-sm self-end" onClick={resetMetadata}>重置</button>
            </div>
            {!ranked && (
              <p className="mt-2 text-xs text-muted">
                当前推荐没有类型、地区、年代或平台数据。
                <button type="button" className="ml-1 text-accent underline"
                  onClick={() => { setRanked(true); resetMetadata(); }}>切到榜单筛选</button>
              </p>
            )}
            {ranked && filterOptions.platforms.length === 0 && (
              <p className="mt-2 text-xs text-muted">该榜单未提供播放平台信息。</p>
            )}
            {playedOnly && playedStatus === 'error' && <p className="mt-2 text-xs text-warning">无法读取本机播放记录</p>}
          </div>
        </div>
      </div>
      {query.isError && !entries ? (
        <p className="text-center text-sm text-faint py-8">内容加载失败 <button type="button" className="text-accent" onClick={() => void query.refetch()}>重试</button></p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-faint py-8">暂无符合筛选条件的内容</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
          {items.map((item) => (
            <div key={item.id} className="space-y-1">
              <DoubanCard item={item} onClick={() => onPick(item.title)} />
              <div className="flex flex-wrap items-center justify-between gap-1 px-1">
                <span className="text-xs text-muted">线路待查询</span>
                <WatchlistButton item={{ title: item.title, cover: item.cover, kind: item.isTv ? 'series' : 'movie',
                  year: item.year ? String(item.year) : undefined }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <select value={value} disabled={options.length === 0} onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-line bg-chip px-2 py-1.5 text-sm text-content disabled:text-faint">
        {options.length === 0 ? <option value="">暂无数据</option>
          : !options.some(([key]) => key === 'default') && <option value="">不限</option>}
        {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select>
    </label>
  );
}

/** Bangumi 每日放送：星期筛选，一次拉全量无分页 */
function BangumiView({ onPick }: { onPick: (title: string) => void }) {
  const [weekday, setWeekday] = useState<number | 'all'>('all');

  const query = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
  });

  let items: DoubanItem[] = [];
  if (query.data) {
    items = weekday === 'all'
      ? query.data.days.flatMap((d) => d.items)
      : (query.data.days.find((d) => d.weekday === weekday)?.items ?? []);
  }

  return (
    <section aria-label="新番放送推荐">
      <div className="flex flex-wrap gap-1.5 mb-4">
        <ChipButton active={weekday === 'all'} onClick={() => setWeekday('all')}>
          全部
        </ChipButton>
        {WEEKDAYS.map((name, i) => (
          <ChipButton key={name} active={weekday === i + 1} onClick={() => setWeekday(i + 1)}>
            {name}
          </ChipButton>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
          {items.map((item) => (
            <div key={item.id} className="space-y-1">
              <DoubanCard item={item} onClick={() => onPick(item.title)} />
              <div className="flex flex-wrap items-center justify-between gap-1 px-1">
                <span className="text-xs text-muted">线路待查询</span>
                <WatchlistButton item={{ title: item.title, cover: item.cover, kind: item.isTv ? 'series' : 'movie',
                  year: item.year ? String(item.year) : undefined }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const HOT_LISTS = [
  { id: 'douban_movie_weekly', label: '电影周榜' },
  { id: 'douban_tv_chinese', label: '国产剧周榜' },
  { id: 'douban_tv_global', label: '海外剧周榜' },
  { id: 'douban_show_chinese', label: '国内综艺' },
  { id: 'douban_show_global', label: '海外综艺' },
  { id: 'baidu_teleplay', label: '百度热播剧' },
];

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
          <div className="h-3 mt-2 rounded bg-chip animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'px-2.5 py-1 rounded-full text-xs transition-colors',
        active ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn('px-3.5 py-1.5 rounded-md text-sm transition-colors', active ? 'bg-accent text-on-accent' : 'text-muted hover:text-content')}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
