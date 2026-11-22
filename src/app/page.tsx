'use client';

import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { RecommendSection } from '@/components/douban-section';
import { AggregatedCard, SourceMatrix, aggregateResults, selectGroupSources } from '@/components/video-card';
import { HomeHero } from '@/components/home-hero';
import { useAppStore, resolveSource, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { api } from '@/lib/client-api';
import type { SearchResponse, SearchResultItem, SourceSearchOutcome } from '@/lib/types';
import { SearchHistoryDropdown, useSearchHistory } from '@/components/search-history';
import { buildWatchUrl, cn, formatDisableTtl, validateSourceUrl } from '@/lib/utils';
import { mergeRetriedSearch } from '@/lib/search-retry';
import { normalizeUrl } from '@/lib/source-list';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/states';
import { Icon } from '@/components/icon';
import { SiteFooter } from '@/components/site-footer';

/**
 * 首页：搜索（URL ?s= 驱动，可后退/分享）+ 豆瓣推荐。
 * 搜索状态由 React Query 管理，失败源在结果区顶部以非阻塞方式展示。
 */
/** 搜索结果分批渲染的批大小：一次挂载上千张卡片会明显掉帧 */
const RESULT_PAGE_SIZE = 60;

export default function HomePage() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const urlQuery = searchParams.get('s') || '';
  // 精确订阅所需字段（对齐 live 页的做法）：搜索流式期间逐源写健康度、
  // 打开设置抽屉/历史面板等无关 store 变化，都不应触发首页整树重渲染
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);
  const [input, setInput] = useState(urlQuery);
  /** 流式搜索中已结算的源（data 就绪前用于增量渲染） */
  const [streamedOutcomes, setStreamedOutcomes] = useState<SourceSearchOutcome[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // URL 驱动搜索：?s= 变化时回填输入框
  useEffect(() => {
    if (urlQuery) setInput(urlQuery);
  }, [urlQuery]);

  // 源名回显：失败/停用提示里显示友好名称而非裸 key
  const sourceName = (key: string) =>
    customAPIs.find((a) => a.key === key)?.name ??
    envSources.find((a) => a.key === key)?.name ??
    key;

  const selectedSources = useMemo(() => {
    const seen = new Set<string>();
    return selectedKeys
      .map((key) => resolveSource({ customAPIs, envSources }, key))
      .filter((s): s is NonNullable<typeof s> => !!s && validateSourceUrl(s.url))
      // 自动停用期内的源不参与搜索（到期自动恢复）
      .filter((s) => !isSourceDisabled({ sourceHealth }, s.key))
      // 所属订阅被整体停用的源同样跳过（无损：各源勾选状态保留，重新启用即恢复）
      .filter((s) => !isInDisabledSubscription({ subscriptions }, s.key))
      .filter((s) => {
        const normalized = normalizeUrl(s.url, true);
        if (!normalized) return false;
        const endpoint = new URL(normalized);
        endpoint.hash = '';
        const key = endpoint.href;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [customAPIs, envSources, selectedKeys, sourceHealth, subscriptions]);
  const disabledSources = useMemo(
    () => selectedKeys.filter((key) => isSourceDisabled({ sourceHealth }, key)),
    [selectedKeys, sourceHealth]
  );
  // 来自已关闭订阅的源：勾选状态还在，但本次搜索用不到，必须明确告知
  const offSubscriptionSources = useMemo(
    () =>
      selectedKeys.filter(
        (key) => !isSourceDisabled({ sourceHealth }, key) && isInDisabledSubscription({ subscriptions }, key)
      ),
    [selectedKeys, sourceHealth, subscriptions]
  );

  const queryClient = useQueryClient();
  const searchKey = ['search', urlQuery, selectedKeys, yellowFilter] as const;
  const [retrying, setRetrying] = useState(false);
  const [sourceDetailsOpen, setSourceDetailsOpen] = useState(false);
  const searchQuery = useQuery({
    queryKey: searchKey,
    // 与 runSearch 的截断规则保持一致：顶栏搜索 / 手动构造长链接不会绕过上限
    queryFn: ({ signal }) => {
      setStreamedOutcomes([]);
      return api.search(urlQuery.slice(0, 100), selectedSources, yellowFilter, {
        signal,
        // 逐源结算即更新：结果边搜边渲染，同时滚动健康度
        onSource: (outcome) => {
          setStreamedOutcomes((prev) => [...prev, outcome]);
          for (const ev of useAppStore.getState().recordSourceHealth([outcome])) {
            toast(
              ev.permanent
                ? `「${sourceName(ev.key)}」多次失败，已停止参与搜索，可在设置中恢复`
                : `「${sourceName(ev.key)}」连续超时/失败，已停用 ${formatDisableTtl(ev.ttlMs ?? 0)}`,
              'warning'
            );
          }
        },
      });
    },
    enabled: Boolean(urlQuery) && selectedSources.length > 0,
    // 5 分钟内从播放页返回时直接使用缓存，不重新搜索（服务端另有 60s 结果缓存兜底）
    staleTime: 300_000,
  });

  const retryFailedSources = async () => {
    if (retrying || searchQuery.isFetching || !searchQuery.data) return;
    const { subscriptions, sourceHealth } = useAppStore.getState();
    const sources = retryableFailures
      .map(({ sourceKey }) => resolveSource({ customAPIs, envSources }, sourceKey))
      .filter((source): source is NonNullable<typeof source> =>
        Boolean(source && !isSourceDisabled({ sourceHealth }, source.key) &&
          !isInDisabledSubscription({ subscriptions }, source.key)));
    if (sources.length === 0) return;

    setRetrying(true);
    try {
      const result = await api.search(urlQuery.slice(0, 100), sources, yellowFilter, { retry: true });
      const failedByKey = new Map(result.failures.map((failure) => [failure.sourceKey, failure]));
      queryClient.setQueryData<SearchResponse>(searchKey, (current) =>
        current && mergeRetriedSearch(current, sources.map(({ key }) => key), result));
      useAppStore.getState().recordSourceHealth(sources.map(({ key }) => {
        const failure = failedByKey.get(key);
        return {
          sourceKey: key,
          ok: !failure,
          list: result.list.filter((item) => item.sourceKey === key),
          error: failure?.error,
          timedOut: failure?.timedOut,
        };
      }));
      if (result.failures.length === 0) toast('重试完成，来源已恢复', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '重试失败', 'error');
    } finally {
      setRetrying(false);
    }
  };

  // 最近搜索改为搜索框下拉（聚焦展开、按输入过滤），不再常驻首屏
  const searchHistory = useSearchHistory(input);

  const runSearch = (q: string) => {
    const query = q.trim().slice(0, 100);
    if (!query) {
      toast('请输入搜索内容', 'info');
      inputRef.current?.focus();
      return;
    }
    if (selectedSources.length === 0) {
      toast('请先在设置中添加并勾选点播源', 'warning');
      return;
    }
    router.push(`/?s=${encodeURIComponent(query)}`, { scroll: false });
    searchHistory.record(query);
  };

  const pickHistory = (text: string) => {
    setInput(text);
    searchHistory.close();
    runSearch(text);
  };

  const openResult = (item: SearchResultItem, sourceCount: number, cover?: string) => {
    const source = resolveSource({ customAPIs, envSources }, item.sourceKey, {
      url: item.sourceUrl,
      name: item.sourceName,
    });
    router.push(buildWatchUrl({
      sourceKey: item.sourceKey,
      vodId: item.vodId,
      index: 0,
      title: item.name,
      sourceCount,
      cover: item.pic || cover,
      sourceUrl: source?.url ?? item.sourceUrl,
      detail: source?.detail,
    }));
  };

  const isSearching = Boolean(urlQuery) && searchQuery.isFetching && !searchQuery.data;
  // 聚合数据未就绪时，用已结算源的结果增量渲染（健康源不再等坏源超时）
  const streamedList = useMemo(
    () => streamedOutcomes.flatMap((o) => o.list),
    [streamedOutcomes]
  );
  const list = useMemo(
    () => searchQuery.data?.list ?? (isSearching ? streamedList : []),
    [searchQuery.data, isSearching, streamedList]
  );
  const failures =
    searchQuery.data?.failures ??
    streamedOutcomes
      .filter((o) => !o.ok)
      .map((o) => ({ sourceKey: o.sourceKey, error: o.error || '请求失败', timedOut: o.timedOut }));
  const unavailableKeys = new Set([...disabledSources, ...offSubscriptionSources]);
  const retryableFailures = failures.filter((failure) => !unavailableKeys.has(failure.sourceKey));
  const timedOutSources = failures.filter((failure) => failure.timedOut);
  const failedSources = failures.filter((failure) => !failure.timedOut);
  const showSourceStatus = failures.length + unavailableKeys.size > 0;
  // 跨源同名聚合：同名影片合并为一张卡片，展开后可选择具体来源
  const groups = useMemo(() => aggregateResults(list), [list]);

  // 分批渲染：新一次搜索（groups 变化）时重置回首批
  const [visibleCount, setVisibleCount] = useState(RESULT_PAGE_SIZE);
  const visibleGroups = useMemo(() => groups.slice(0, visibleCount), [groups, visibleCount]);
  const [expandedKey, setExpandedKey] = useState<string>();
  const [columns, setColumns] = useState(2);
  useEffect(() => {
    const tablet = window.matchMedia('(min-width: 640px)');
    const desktop = window.matchMedia('(min-width: 1024px)');
    const update = () => setColumns(desktop.matches ? 4 : tablet.matches ? 3 : 2);
    update();
    tablet.addEventListener('change', update);
    desktop.addEventListener('change', update);
    return () => {
      tablet.removeEventListener('change', update);
      desktop.removeEventListener('change', update);
    };
  }, []);
  useEffect(() => {
    setExpandedKey(undefined);
    setSourceDetailsOpen(false);
  }, [urlQuery]);
  const expandedIndex = visibleGroups.findIndex((group) => group.key === expandedKey);
  const expanded = visibleGroups[expandedIndex];
  const rowEnd = Math.min(visibleGroups.length - 1, (Math.floor(expandedIndex / columns) + 1) * columns - 1);

  useEffect(() => setVisibleCount(RESULT_PAGE_SIZE), [groups]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="relative flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        {/* 首屏氛围渐变 */}
        {!urlQuery && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[420px] -z-10"
            style={{
              background:
                'radial-gradient(60% 60% at 50% 0%, rgba(35,173,229,0.10) 0%, rgba(35,173,229,0.03) 45%, transparent 75%)',
            }}
          />
        )}

        {!urlQuery && <HomeHero onSearch={() => inputRef.current?.focus()} />}

        {/* 搜索区 */}
        <section className={cn('flex flex-col items-center', urlQuery ? 'mb-6' : 'mb-8')}>
          {urlQuery && <h1 className="sr-only">JDK TV 视频搜索</h1>}
          {/* 定位容器比胶囊宽一圈：浮层按它的宽度对齐，接缝处不会与胶囊边框错位 1px */}
          <div ref={searchHistory.containerRef} className="relative w-full max-w-2xl">
            <form
              className="w-full"
              onSubmit={(e) => {
                e.preventDefault();
                runSearch(input);
              }}
            >
              {/* 输入框与搜索按钮合并为一个胶囊：内部无边框，焦点态由容器统一表达；
                  下拉展开时改为「上圆下直」并隐去底边，与下方浮层拼成同一个面板 */}
              <div
                className={cn(
                  // 12px 圆角矩形（非胶囊）：收起态与展开态共用同一组上圆角，
                  // 展开时输入框这部分形状完全不发生变化，上下圆角也与下拉保持一致；
                  // 右侧与上下不留内边距，由搜索按钮拉伸填满、与搜索框边缘贴合
                  'flex items-stretch min-h-12 pl-4 border',
                  'transition-[background-color,border-color,border-radius] duration-200',
                  searchHistory.visible
                    ? // 展开时：外框（含上圆角）沿用输入框的聚焦样式不变，只把底边改为内部分隔线，
                      // 使输入区在展开状态下仍是边界清晰的独立输入框，而非与列表糊成一片
                      'rounded-t-xl rounded-b-none border-accent border-b-line bg-surface-raised'
                    : 'rounded-xl border-line bg-chip focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40'
                )}
              >
                <input
                  ref={inputRef}
                  className="flex-1 min-w-0 pr-2 bg-transparent text-sm text-content placeholder:text-faint focus:outline-none"
                  placeholder="输入影片名称..."
                  value={input}
                  maxLength={100}
                  onChange={(e) => {
                    setInput(e.target.value);
                    searchHistory.resetActive();
                  }}
                  onFocus={searchHistory.onFocus}
                  onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
                  role="combobox"
                  aria-label="搜索影片"
                  aria-expanded={searchHistory.visible}
                  aria-controls="home-search-history"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    searchHistory.visible && searchHistory.activeIndex >= 0
                      ? `home-search-history-${searchHistory.activeIndex}`
                      : undefined
                  }
                />
                {input && (
                  <button
                    type="button"
                    className="shrink-0 self-center mr-1 p-1.5 rounded-full text-faint hover:text-content hover:bg-hover transition-colors"
                    onClick={() => {
                      setInput('');
                      searchHistory.resetActive();
                      inputRef.current?.focus();
                    }}
                    aria-label="清空"
                  >
                    <Icon name="close" className="w-4 h-4" />
                  </button>
                )}
                {/* 主操作按钮：贴合搜索框右端——右侧圆角跟随容器、左侧直角，展开时右下角
                    跟着容器一起改直角；按压改用亮度反馈（缩放会让贴合边缘露出缝隙） */}
                <button
                  type="submit"
                  className={cn(
                    'btn-primary shrink-0 px-4 font-medium transition-[background-color,filter] active:brightness-90',
                    '!rounded-l-none',
                    searchHistory.visible ? '!rounded-tr-xl !rounded-br-none' : '!rounded-r-xl'
                  )}
                >
                  <Icon name="search" className="w-4 h-4" />
                  搜索
                </button>
              </div>
            </form>

            {/* 最近搜索：与输入框无缝拼接；浮层不占文档流，出现/消失不会顶动下方内容 */}
            {searchHistory.visible && (
              <SearchHistoryDropdown
                id="home-search-history"
                matches={searchHistory.matches}
                activeIndex={searchHistory.activeIndex}
                onPick={pickHistory}
                onRemove={searchHistory.remove}
                onClearAll={searchHistory.clearAll}
              />
            )}
          </div>
        </section>

        {/* 搜索结果 */}
        {urlQuery && (
          <section aria-label="搜索结果" className="mb-10">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm text-muted">
                “<span className="text-content">{urlQuery}</span>” 的搜索结果
                {isSearching ? (
                  <span className="text-faint">
                    （已就绪 {streamedOutcomes.length}/{selectedSources.length} 个源…）
                  </span>
                ) : searchQuery.data && (
                  <span className="text-faint">（{groups.length} 部影片，{list.length} 条结果）</span>
                )}
              </h2>
              {showSourceStatus && (
                <div className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-xs">
                  {timedOutSources.length > 0 && <span className="text-warning">{timedOutSources.length} 个源超时</span>}
                  {failedSources.length > 0 && <span className="text-muted">{failedSources.length} 个源失败</span>}
                  {failures.length > 0 && searchQuery.data && (
                    <button type="button" className="text-accent disabled:opacity-50"
                      disabled={retrying || searchQuery.isFetching || retryableFailures.length === 0}
                      title={retryableFailures.length === 0 ? '失败源已停用，请在设置中恢复' : '重试本次失败且仍启用的源'}
                      onClick={() => void retryFailedSources()}>
                      {retrying ? '重试中…' : '一键重试'}
                    </button>
                  )}
                  <button type="button"
                    className="rounded border border-line px-1.5 py-0.5 text-muted hover:text-content"
                    aria-expanded={sourceDetailsOpen}
                    aria-controls="search-source-status"
                    onClick={() => setSourceDetailsOpen((open) => !open)}>
                    {failures.length > 0 ? '失败源列表' : unavailableKeys.size + ' 个源已停用'}
                    <span aria-hidden="true">{sourceDetailsOpen ? ' ▴' : ' ▾'}</span>
                  </button>
                </div>
              )}
            </div>

            {showSourceStatus && (
              <div id="search-source-status" hidden={!sourceDetailsOpen}
                className="mb-3 space-y-1 break-words rounded-xl border border-line bg-surface-raised px-3 py-2 text-xs leading-relaxed text-muted">
                {timedOutSources.length > 0 && (
                  <p><span className="text-warning">请求超时（{timedOutSources.length}）</span> · {timedOutSources.map((f) => sourceName(f.sourceKey)).join('、')}</p>
                )}
                {failedSources.length > 0 && (
                  <p>请求失败（{failedSources.length}） · {failedSources.map((f, i) => (
                    <span key={f.sourceKey} title={f.error}>{i > 0 ? '、' : ''}{sourceName(f.sourceKey)}</span>
                  ))}</p>
                )}
                {disabledSources.length > 0 && (
                  <p>连续失败自动停用（{disabledSources.length}） · {disabledSources.map(sourceName).join('、')}（可在设置中恢复）</p>
                )}
                {offSubscriptionSources.length > 0 && (
                  <p>所属订阅已停用（{offSubscriptionSources.length}） · {offSubscriptionSources.map(sourceName).join('、')}</p>
                )}
              </div>
            )}

            {selectedSources.length === 0 ? (
              <NoSourceGuide hasSources={customAPIs.length > 0 || envSources.length > 0} />
            ) : list.length > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
                  {visibleGroups.map((group, index) => (
                    <Fragment key={group.key}>
                      <AggregatedCard
                        group={group}
                        expanded={group.key === expandedKey}
                        controls="search-source-matrix"
                        onToggle={() => setExpandedKey((previous) => previous === group.key ? undefined : group.key)}
                      />
                      {index === rowEnd && expanded && (
                        <SourceMatrix key={expanded.key} id="search-source-matrix" group={expanded} sources={selectedSources}
                          onClose={() => {
                            document.querySelector<HTMLButtonElement>('[aria-controls="search-source-matrix"]')?.focus();
                            setExpandedKey(undefined);
                          }}
                          onOpen={(item) => openResult(item, selectGroupSources(expanded.items).length, expanded.pic)} />
                      )}
                    </Fragment>
                  ))}
                </div>
                {groups.length > visibleCount && (
                  <div className="flex justify-center mt-4">
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => setVisibleCount((v) => v + RESULT_PAGE_SIZE)}
                    >
                      加载更多（还有 {groups.length - visibleCount} 部）
                    </button>
                  </div>
                )}
              </>
            ) : isSearching ? (
              <ResultsSkeleton />
            ) : (
              <EmptyState
                icon="search"
                title="没有找到匹配的结果"
                description="请尝试其他关键词或更换点播源"
                className="!py-16"
              />
            )}
          </section>
        )}

        {/* 首页推荐（有搜索时隐藏） */}
        {!urlQuery && (
          <section id="discover" aria-label="影片发现">
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <h2 className="text-xl sm:text-2xl font-semibold text-content">发现影片</h2>
              <span className="text-xs text-faint">内容来自当前启用的推荐服务</span>
            </div>
            <RecommendSection
              onPick={(title) => {
                setInput(title);
                runSearch(title);
              }}
            />
          </section>
        )}
      </main>

      <SiteFooter />

    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card overflow-hidden">
          <div className="aspect-[2/3] bg-chip animate-pulse" />
          <div className="p-3 space-y-2">
            <div className="h-4 w-3/4 rounded bg-chip animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-chip animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 无点播源 / 未勾选点播源时的引导（替代旧版首屏静默空白） */
function NoSourceGuide({ hasSources = false }: { hasSources?: boolean }) {
  return (
    <div className="border border-dashed border-line rounded-xl p-10 text-center max-w-lg mx-auto">
      <h3 className="text-content font-medium mb-2">{hasSources ? '尚未勾选点播源' : '先添加一个点播源'}</h3>
      <p className="text-sm text-muted leading-relaxed">
        {hasSources ? (
          <>点击右上角「设置」，勾选要参与搜索的点播源后重新搜索。</>
        ) : (
          <>
            JDK TV 不内置任何采集站。点击右上角「设置 → 添加 API」，填入一个
            Apple CMS 采集站地址（如 <code className="text-accent text-xs">https://example.com/api.php/provide/vod</code>），
            勾选后即可开始搜索。
          </>
        )}
      </p>
    </div>
  );
}
