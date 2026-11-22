'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
// 播放器（artplayer + hls.js）按需加载：拆出独立 chunk，不占首屏 First Load JS
const PlayerShell = dynamic(() => import('@/components/player-shell').then((m) => m.PlayerShell), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  ),
});
import { EmptyState, LoadingState, Spinner } from '@/components/states';
import { SwitchSourceModal } from '@/components/switch-source';
import { WatchlistButton } from '@/components/watchlist-button';
import { SkipMarkPanel } from '@/components/skip-mark-panel';
import { skipMarkKey, validateSegment, type SkipSegment } from '@/lib/skip-marks';
import type { PlayerSkipApi } from '@/components/player-shell';
import { useToast } from '@/components/toast';
import { enqueueDownload } from '@/components/download-manager';
import { Icon } from '@/components/icon';
import { useAuth } from '@/components/auth';
import { resolveSource, useAppStore } from '@/lib/store';
import { qualityKey } from '@/lib/quality';
import {
  clearProgress,
  progressKeyOf,
  saveProgress,
  updateHistoryProgress,
  upsertHistory,
  findWatchlistEntry,
  watchlistId,
  db,
} from '@/lib/db';
import { cn } from '@/lib/utils';
import { canResumeAcrossSources, watchlistKind, type MediaSample } from '@/lib/playback-choice';
import { SmartImage } from '@/components/smart-image';
import { clampPan, clampZoom, episodeGroups, playbackLayout } from '@/lib/playback-layout';

/**
 * 播放页（唯一入口，替代旧版 watch.html → player.html 跳转链）。
 * 状态全部由 URL 驱动：/watch?source=xx&id=..&index=..&title=..
 * 集数列表由服务端详情接口获取；进度与历史走 IndexedDB。
 */
export default function WatchPage() {
  return (
    <Suspense>
      <WatchContent />
    </Suspense>
  );
}

function WatchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const store = useAppStore();
  const { verified } = useAuth();
  const { toast } = useToast();

  const sourceKey = searchParams.get('source') || '';
  const vodId = searchParams.get('id') || '';
  const directUrl = searchParams.get('url') || '';
  const titleParam = searchParams.get('title') || '';
  const coverParam = searchParams.get('cover') || '';
  const initialSourceCount = Number(searchParams.get('sources')) || 0;
  const indexParam = parseInt(searchParams.get('index') || '0', 10) || 0;

  const [reversed, setReversed] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(0);
  const [viewport, setViewport] = useState<{ fit: 'contain' | 'cover'; zoom: number; x: number; y: number }>({
    fit: 'contain', zoom: 1, x: 0, y: 0,
  });
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchReason, setSwitchReason] = useState('');
  const [stallCount, setStallCount] = useState(0);
  const sampleRef = useRef<MediaSample | undefined>(undefined);
  const [sideTab, setSideTab] = useState<'episodes' | 'sources'>('episodes');
  const [sourceCount, setSourceCount] = useState<number>();
  const closeInlineSwitch = useCallback(() => setSideTab('episodes'), []);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ReturnType<PlayerSkipApi['getDiagnostics']>>();
  const [skipPanelOpen, setSkipPanelOpen] = useState(false);
  // 播放器对外暴露的精确时间读取接口（「记录当前」用），随播放器卸载置空
  const playerApiRef = useRef<PlayerSkipApi | null>(null);
  // 播放框：小屏「跳过标记」抽屉要按它的底边算剩余高度，避免压住画面
  const playerFrameRef = useRef<HTMLDivElement | null>(null);
  const [sheetMaxHeight, setSheetMaxHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!skipPanelOpen) return;
    const measure = () => {
      // 桌面端抽屉贴右侧、整屏高，不受播放器位置影响
      if (window.matchMedia('(min-width: 1024px)').matches) {
        setSheetMaxHeight(undefined);
        return;
      }
      const box = playerFrameRef.current?.getBoundingClientRect();
      if (!box) {
        setSheetMaxHeight(undefined);
        return;
      }
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const room = viewport - box.bottom - 12;
      // 不超过视口 60%；矮窗下最多压到 160px，再小就没法用了
      setSheetMaxHeight(Math.round(Math.max(160, Math.min(viewport * 0.6, room))));
    };
    measure();
    // 只在打开与尺寸变化时测：跟着滚动实时改高度会让抽屉边滚边长，很晃
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [skipPanelOpen]);

  const source = resolveSource(store, sourceKey, {
    url: searchParams.get('sourceUrl') || undefined,
    detail: searchParams.get('detail') || undefined,
  });

  // 详情查询：无 id（纯直连链接分享）时跳过
  const detailQuery = useQuery({
    queryKey: ['detail', sourceKey, vodId, source?.url],
    queryFn: ({ signal }) => api.detail(vodId, source!, signal),
    enabled: Boolean(source && vodId && verified),
    staleTime: 5 * 60_000,
  });

  const episodes = useMemo(() => detailQuery.data?.episodes ?? [], [detailQuery.data]);
  const isSeries = playbackLayout(episodes.length) === 'series';
  const groups = useMemo(() => episodeGroups(episodes.length), [episodes.length]);
  const videoTitle = titleParam || detailQuery.data?.videoInfo?.title || '未知视频';
  const videoInfo = detailQuery.data?.videoInfo;
  const [failedCovers, setFailedCovers] = useState<string[]>([]);
  const cover = [videoInfo?.cover, coverParam].find((url) => url && !failedCovers.includes(url));
  useEffect(() => setFailedCovers([]), [sourceKey, vodId]);
  useEffect(() => {
    setSideTab('episodes');
    setSourceCount(undefined);
  }, [sourceKey, vodId]);
  const speedQuery = useQuery({
    queryKey: ['watch-detail-speed', sourceKey, vodId, source?.url],
    queryFn: ({ signal }) => api.detailSpeed(vodId, source!, signal),
    enabled: false,
    retry: false,
    staleTime: 60_000,
  });

  const savedKind = watchlistKind(episodes.length, videoInfo?.typeName);
  const watchlistTitle = videoInfo?.title?.trim() || videoTitle;
  const savedYear = videoInfo?.year;
  const savedSourceUrl = source?.url;
  const savedSourceDetail = source?.detail;
  useEffect(() => {
    if (!verified || !sourceKey || !vodId || !episodes.length || !savedSourceUrl) return;
    void db.transaction('rw', db.watchlist, async () => {
      let item = await findWatchlistEntry(watchlistTitle, savedKind, savedYear);
      if (!item && savedKind === 'movie' && videoInfo?.typeName) {
        const previous = await findWatchlistEntry(watchlistTitle, 'series', savedYear);
        // 仅校正同一影片同一线路的旧单集记录，避免把同名剧集并入电影。
        if (previous?.knownEpisodes === 1 && previous.sourceKey === sourceKey && previous.vodId === vodId) {
          item = { ...previous, kind: 'movie', id: watchlistId(previous.title, 'movie', previous.year) };
          await db.watchlist.delete(previous.id);
          await db.watchlist.put(item);
        }
      }
      if (item && !item.sourceKey) {
        await db.watchlist.update(item.id, { sourceKey, vodId, sourceUrl: savedSourceUrl,
          detail: savedSourceDetail, knownEpisodes: episodes.length });
      }
    }).catch(() => {});
  }, [verified, sourceKey, vodId, episodes.length, savedSourceUrl, savedSourceDetail, savedKind, savedYear, watchlistTitle, videoInfo?.typeName]);

  // 当前播放地址：优先取剧集列表中的当前集，其次直连 URL 参数
  const currentUrl = useMemo(() => {
    if (episodes.length > 0) {
      const idx = Math.min(Math.max(indexParam, 0), episodes.length - 1);
      return episodes[idx] || directUrl;
    }
    return directUrl;
  }, [episodes, indexParam, directUrl]);

  useEffect(() => {
    if (!diagnosticsOpen || !currentUrl) return;
    const read = () => setDiagnostics(playerApiRef.current?.getDiagnostics());
    read();
    const interval = window.setInterval(read, 1000);
    return () => window.clearInterval(interval);
  }, [diagnosticsOpen, currentUrl]);

  const currentIndex = useMemo(() => {
    if (episodes.length > 0) return Math.min(Math.max(indexParam, 0), episodes.length - 1);
    return indexParam;
  }, [episodes, indexParam]);

  useEffect(() => {
    setSwitchReason('');
    setStallCount(0);
    sampleRef.current = undefined;
    setSelectedGroup(Math.floor(currentIndex / 50));
    setViewport({ fit: 'contain', zoom: 1, x: 0, y: 0 });
  }, [sourceKey, vodId, currentIndex]);

  const getSwitchPlayback = () => ({
    position: playerApiRef.current?.getCurrentTime() ?? 0,
    duration: playerApiRef.current?.getDuration() ?? 0,
  });

  const changeZoom = (value: number) => {
    const zoom = clampZoom(value);
    setViewport((old) => {
      const pan = clampPan(zoom, old.x, old.y, playerFrameRef.current?.clientWidth ?? 0, playerFrameRef.current?.clientHeight ?? 0);
      return { ...old, zoom, ...pan };
    });
  };

  const resetViewport = () => setViewport({ fit: 'contain', zoom: 1, x: 0, y: 0 });

  // 跳过片段按剧名记忆：换集不变，换源到同名资源也能命中。
  // 标题缺失（直连链接）时退回 source:vodId，至少保证本源本片可用。
  const skipMarkFallback = `${sourceKey}:${vodId || currentUrl}`;
  const markKey = useMemo(
    () => skipMarkKey(videoTitle, skipMarkFallback),
    [videoTitle, skipMarkFallback]
  );
  const skipMark = store.skipMarks[markKey];
  const markedCount = skipMark?.segments.length ?? 0;

  // 中段两步态的起点：页面层持有，面板按钮与 Shift+S/E 共用同一份状态
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  // 换集清空中段两步态：起点属于上一集，不能和新集的位置拼成区间
  useEffect(() => setPendingStart(null), [sourceKey, vodId, currentIndex]);

  const goEpisode = useCallback(
    (index: number) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set('index', String(index));
      sp.set('url', episodes[index] || directUrl);
      sp.delete('position');
    sp.delete('resumeDuration');
      router.replace(`/watch?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams, episodes, directUrl]
  );

  // 进度恢复优先级：URL position 参数 > IndexedDB 记录
  const getRestorePosition = useCallback(async (targetDuration: number) => {
    const urlPos = parseInt(searchParams.get('position') || '0', 10) || 0;
    const handoffDuration = Number(searchParams.get('resumeDuration'));
    if (urlPos > 0 && !handoffDuration) return urlPos;
    if (urlPos > 0 && canResumeAcrossSources(urlPos, handoffDuration, targetDuration)) return urlPos;
    if (urlPos > 0 && handoffDuration) toast('线路时长有差异，已使用此线路自己的播放进度', 'info');
    if (!vodId) return 0;
    const entry = await db.progress.get(progressKeyOf(sourceKey, vodId, currentIndex));
    return entry?.position ?? 0;
  }, [searchParams, sourceKey, vodId, currentIndex, toast]);

  // 写入观看历史（进入页面即记录，进度后续增量更新）
  useEffect(() => {
    if (!verified || !sourceKey || !currentUrl) return;
    const timer = setTimeout(() => {
      upsertHistory({
        sourceKey,
        sourceUrl: source?.url,
        vodId: vodId || currentUrl,
        title: videoTitle,
        pic: detailQuery.data?.videoInfo?.cover,
        episodeIndex: currentIndex,
        totalEpisodes: episodes.length,
        playbackPosition: 0,
        duration: 0,
        timestamp: Date.now(),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, sourceKey, vodId, currentIndex, videoTitle, currentUrl]);

  // 播放中与暂停时的进度落盘逻辑一致，共用同一回调
  const handleProgress = useCallback(
    (position: number, duration: number) => {
      if (vodId) {
        saveProgress(sourceKey, vodId, currentIndex, position, duration).catch(() => {});
        updateHistoryProgress(sourceKey, vodId || currentUrl, position, duration).catch(() => {});
      }
    },
    [sourceKey, vodId, currentIndex, currentUrl]
  );

  // 自动连播的 800ms 延迟切集要在卸载时取消，避免离开页面后跳转
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
  }, []);

  const handleEnded = useCallback(() => {
    if (vodId) clearProgress(sourceKey, vodId, currentIndex).catch(() => {});
    if (store.autoplayNext && currentIndex < episodes.length - 1) {
      autoNextTimer.current = setTimeout(() => goEpisode(currentIndex + 1), 800);
    }
  }, [store.autoplayNext, currentIndex, episodes.length, goEpisode, sourceKey, vodId]);

  // 快捷键（Shift+I/O/S/E）记录片段：校验后写入
  const handleRecordSegment = useCallback(
    (segment: SkipSegment) => {
      const duration = playerApiRef.current?.getDuration() ?? 0;
      const existing = useAppStore.getState().skipMarks[markKey]?.segments ?? [];
      const error = validateSegment(segment, duration, existing);
      if (error) {
        toast(error, 'error');
        return;
      }
      useAppStore.getState().setSkipMark(markKey, [...existing, segment]);
      const label =
        segment.type === 'opening' ? '片头结束' : segment.type === 'ending' ? '片尾开始' : '中段片段';
      // 中段命中时的表现取决于全局「自动跳过片段」，记完就说清楚，避免"标了却没反应"
      const hint =
        segment.type === 'middle'
          ? useAppStore.getState().autoSkipSegments
            ? '，命中时将自动跳过'
            : '，命中时显示跳过按钮'
          : '';
      toast(`已记录${label}${hint}`, 'success');
    },
    [markKey, toast]
  );

  // Alt+←/→ 集数切换快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        goEpisode(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < episodes.length - 1) {
        e.preventDefault();
        goEpisode(currentIndex + 1);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [currentIndex, episodes.length, goEpisode]);

  const activeGroup = groups[Math.min(selectedGroup, groups.length - 1)];
  const orderedEpisodes = activeGroup
    ? Array.from({ length: activeGroup.end - activeGroup.start + 1 }, (_, i) => reversed ? activeGroup.end - i : activeGroup.start + i)
    : [];

  if (!verified) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-faint text-sm">等待访问验证...</p>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-content font-medium mb-2">点播源不存在</h1>
          <p className="text-sm text-muted mb-4">
            该视频来自点播源「{sourceKey}」，但它可能已被删除。请在设置中重新添加后重试。
          </p>
          <Link href="/" className="btn-primary">返回首页</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur border-b border-line">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-1.5 sm:gap-3">
          <BackButton />
          <HomeButton />
          <div className="min-w-0">
            <h1 className="text-sm font-medium text-content truncate">{videoTitle}</h1>
            <p className="text-xs text-faint">
              {source.name}
              {isSeries && ` · 第 ${currentIndex + 1}/${episodes.length} 集`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                if (!currentUrl) return;
                enqueueDownload({
                  url: currentUrl,
                  // 多集才带集数后缀；单集影片（含电影）文件名就是纯标题
                  title: `${videoTitle}${episodes.length > 1 ? ` 第${currentIndex + 1}集` : ''}`,
                  format: 'MP4',
                });
                // 「已加入下载队列」由 DownloadManager 在真正入队后提示：
                // 这里先提示的话，用户随后取消保存位置会出现「已加入→已取消」的矛盾
              }}
            >
              {/* 手机上顶栏放不下完整按钮：只留图标，aria-label 保证可访问性 */}
              <Icon name="download" className="w-4 h-4 sm:hidden" />
              <span className="hidden sm:inline">{isSeries ? '下载本集' : '下载影片'}</span>
              <span className="sr-only sm:hidden">{isSeries ? '下载本集' : '下载影片'}</span>
            </button>
            <button className="btn-ghost btn-sm" onClick={() => isSeries ? setSideTab((tab) => tab === 'sources' ? 'episodes' : 'sources') : setSwitchOpen(true)}>
              切换资源
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4">
        <div className={cn('grid grid-cols-1 gap-4', isSeries && 'lg:grid-cols-[minmax(0,1fr)_320px]')}>
          <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface-raised shadow-lg">
            <div
              ref={playerFrameRef}
              className={cn('aspect-video bg-black overflow-hidden', !isSeries && 'single-player-frame')}
              onPointerDown={(event) => {
                if (viewport.zoom <= 1 || !(event.target instanceof HTMLVideoElement)) return;
                dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: viewport.x, y: viewport.y };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                const pan = clampPan(viewport.zoom, drag.x + event.clientX - drag.clientX, drag.y + event.clientY - drag.clientY, event.currentTarget.clientWidth, event.currentTarget.clientHeight);
                setViewport((old) => ({ ...old, ...pan }));
              }}
              onLostPointerCapture={() => { dragRef.current = null; }}
              onPointerUp={(event) => {
                if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
            >
              {currentUrl ? (
                <PlayerShell
                  url={currentUrl}
                  title={videoTitle}
                  viewport={viewport}
                  adFilter={store.adFilter}
                  autoplayNext={store.autoplayNext}
                  skipMark={skipMark}
                  autoSkipSegments={store.autoSkipSegments}
                  volumeBoost={store.volumeBoost}
                  miniProgressBar={store.miniProgressBar}
                  pendingStart={pendingStart}
                  onPendingStart={setPendingStart}
                  onPlayerApi={(api) => { playerApiRef.current = api; }}
                  onRecordSegment={handleRecordSegment}
                  onMediaSample={(sample) => { sampleRef.current = sample; }}
                  onRequestSwitchSource={(reason) => {
                    setSwitchReason(reason);
                    setStallCount((count) => count + 1);
                  }}
                  episodeKey={`${sourceKey}:${vodId}:${currentIndex}`}
                  nextUrl={currentIndex + 1 < episodes.length ? episodes[currentIndex + 1] : undefined}
                  nextEpisodeKey={currentIndex + 1 < episodes.length ? `${sourceKey}:${vodId}:${currentIndex + 1}` : undefined}
                  getRestorePosition={getRestorePosition}
                  onTimeUpdate={handleProgress}
                  onPause={handleProgress}
                  onEnded={handleEnded}
                  hasPrevEpisode={currentIndex > 0}
                  hasNextEpisode={episodes.length > 0 && currentIndex < episodes.length - 1}
                  onPrevEpisode={() => goEpisode(currentIndex - 1)}
                  onNextEpisode={() => goEpisode(currentIndex + 1)}
                  onQuality={(height, width) => {
                    // 播放实测是最权威的画质来源，回写后搜索列表里该「源 + 影片」直接显示
                    if (!sourceKey || !vodId) return;
                    useAppStore.getState().setQuality({
                      [qualityKey(sourceKey, vodId)]: { height, width, from: 'play', timestamp: Date.now() },
                    });
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {detailQuery.isLoading ? (
                    <Spinner size="lg" />
                  ) : (
                    <p className="text-faint text-sm">
                      {detailQuery.isError ? '视频加载失败，请尝试其他资源' : '无可用播放地址'}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line bg-surface-raised px-2.5 py-2.5 backdrop-blur-xl dark:bg-slate-950/75 sm:px-3" aria-label="播放控制">
              <div className="flex flex-wrap items-center gap-1" aria-label="画面大小">
              <button className={cn('btn-ghost btn-sm', viewport.fit === 'contain' && 'border-accent text-accent')} onClick={() => setViewport((old) => ({ ...old, fit: 'contain' }))}>等比适应</button>
              <button className={cn('btn-ghost btn-sm', viewport.fit === 'cover' && 'border-accent text-accent')} onClick={() => setViewport((old) => ({ ...old, fit: 'cover' }))}>铺满裁切</button>
              <button className="btn-ghost btn-sm" disabled={viewport.zoom <= 1} aria-label="缩小画面" onClick={() => changeZoom(viewport.zoom - 0.1)}>－</button>
              <span className="text-xs text-muted min-w-16 text-center">{Math.round(viewport.zoom * 100)}%</span>
              <button className="btn-ghost btn-sm" disabled={viewport.zoom >= 2} aria-label="放大画面" onClick={() => changeZoom(viewport.zoom + 0.1)}>＋</button>
              <button className="btn-ghost btn-sm" onClick={resetViewport}>复位</button>
              </div>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-1 sm:gap-2">
              {episodes.length > 0 && vodId && savedSourceUrl && <WatchlistButton item={{
                title: watchlistTitle, kind: savedKind, year: savedYear, cover,
                sourceKey, sourceUrl: savedSourceUrl, detail: savedSourceDetail, vodId, knownEpisodes: episodes.length,
              }} />}
              {currentUrl && <button type="button" className="btn-ghost btn-sm" aria-expanded={diagnosticsOpen}
                onClick={() => setDiagnosticsOpen((open) => !open)}>播放统计</button>}
              <button
                className={cn('btn-ghost btn-sm', skipPanelOpen && 'bg-chip text-content')}
                aria-expanded={skipPanelOpen}
                aria-haspopup="dialog"
                onClick={() => setSkipPanelOpen((v) => !v)}
                title={
                  markedCount > 0
                    ? `本剧已标记 ${markedCount} 段${skipMark?.enabled === false ? '（本剧跳过已关闭）' : ''}`
                    : '标记片头 / 中段 / 片尾，供本剧各集自动跳过'
                }
              >
                跳过标记{markedCount > 0 ? ` (${markedCount})` : ''}
                {markedCount > 0 && skipMark?.enabled === false && (
                  <span className="ml-1 inline-block size-1.5 rounded-full bg-faint" aria-label="本剧跳过已关闭" />
                )}
              </button>
              {isSeries && <label className="flex items-center gap-1.5 text-xs text-muted ml-auto cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[#2563eb]"
                  checked={store.autoplayNext}
                  onChange={(e) => store.updateSettings({ autoplayNext: e.target.checked })}
                />
                自动连播
              </label>}
              </div>
            </div>
            {switchReason && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-chip px-3 py-2 text-xs">
                <span role="status">{switchReason}</span>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setSwitchOpen(true)}>比较备用线路</button>
              </div>
            )}
            {diagnosticsOpen && currentUrl && (
              <div className="border-t border-line bg-surface-raised px-3 py-3 text-xs text-muted" aria-label="播放统计">
                {diagnostics ? <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    ['当前流分辨率', diagnostics.resolution], ['码率', diagnostics.bitrate],
                    ['掉帧 / 总帧', diagnostics.frames], ['前向缓冲', diagnostics.buffer], ['状态', diagnostics.state],
                  ].map(([label, value]) => <div key={label}><dt className="text-faint mb-1">{label}</dt><dd>{value}</dd></div>)}
                </dl> : <p>等待播放器加载</p>}
              </div>
            )}
          </div>

          {/* 多集节目选集：桌面右栏，窄屏移到播放器下方 */}
          {isSeries && <div className="relative min-w-0">
          <aside className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface-raised lg:absolute lg:inset-0" aria-label="剧集与片源">
            <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-line p-2" aria-label="侧栏视图">
              <button type="button" className={cn('btn btn-sm', sideTab === 'episodes' ? 'episode-active' : 'btn-ghost')}
                aria-pressed={sideTab === 'episodes'} onClick={() => setSideTab('episodes')}>选集 ({episodes.length})</button>
              <button type="button" className={cn('btn btn-sm', sideTab === 'sources' ? 'episode-active' : 'btn-ghost')}
                aria-pressed={sideTab === 'sources'} onClick={() => setSideTab('sources')}>换源{sourceCount !== undefined ? ` (${sourceCount})` : initialSourceCount > 0 ? ` (${initialSourceCount})` : ''}</button>
            </div>
            <div data-episode-scroll className="max-h-80 min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 scrollbar-thin lg:max-h-none">
            {sideTab === 'sources' ? (
              <SwitchSourceModal currentTitle={videoTitle} currentSourceKey={sourceKey} currentVodId={vodId}
                currentIndex={currentIndex} currentEpisodeCount={episodes.length} currentYear={videoInfo?.year}
                getPlayback={getSwitchPlayback} currentSample={sampleRef.current} recentStalls={stallCount}
                onClose={closeInlineSwitch} onCount={setSourceCount} embedded />
            ) : <>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <h2 className="text-sm font-semibold text-content">
                选集 · 第 {currentIndex + 1} / {episodes.length} 集
              </h2>
              {/* 排列开关紧贴它所作用的列表：放在这里才看得出它管的是这一栏的顺序 */}
              {episodes.length > 1 && (
                <button
                  className="btn-ghost btn-sm shrink-0"
                  onClick={() => setReversed((v) => !v)}
                  aria-label={reversed ? '切换为正序排列' : '切换为倒序排列'}
                  title="调整剧集列表的排列顺序"
                >
                  <Icon
                    name="arrowDown"
                    className={cn('w-3.5 h-3.5 transition-transform', reversed && 'rotate-180')}
                  />
                  {reversed ? '正序排列' : '倒序排列'}
                </button>
              )}
            </div>
            {groups.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mb-3" aria-label="集数区间">
                {groups.map((group, index) => (
                  <button
                    key={group.start}
                    className={cn('btn-ghost btn-sm', selectedGroup === index && 'border-accent text-accent')}
                    aria-pressed={selectedGroup === index}
                    onClick={() => setSelectedGroup(index)}
                  >
                    {group.start + 1}–{group.end + 1}
                  </button>
                ))}
              </div>
            )}
            {episodes.length === 0 ? (
              detailQuery.isLoading ? (
                <LoadingState />
              ) : (
                <EmptyState variant="plain" title={detailQuery.isError ? '获取剧集失败' : '暂无剧集信息'} />
              )
            ) : (
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-4 lg:gap-2">
                {orderedEpisodes.map((realIndex) => (
                  <EpisodeButton
                    key={realIndex}
                    index={realIndex}
                    active={realIndex === currentIndex}
                    onClick={() => goEpisode(realIndex)}
                  />
                ))}
              </div>
            )}
            </>}
            </div>
            <div className="shrink-0 border-t border-line bg-chip/45 p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-content" title={source.name}>当前源 · {source.name}</p>
                  <p className="mt-1 text-[11px] text-muted" aria-live="polite">
                    {speedQuery.isFetching ? '正在测速…' : speedQuery.data?.ok
                      ? `详情响应 ${speedQuery.data.ms} ms`
                      : speedQuery.data || speedQuery.isError ? '测速未通过' : '详情响应未测速'}
                  </p>
                </div>
                <button type="button" className="btn-ghost btn-sm shrink-0" disabled={!vodId || speedQuery.isFetching}
                  onClick={() => void speedQuery.refetch()}>测速</button>
              </div>
              <p className="mt-2 hidden border-t border-line pt-2 text-[11px] leading-relaxed text-muted md:block">
                空格 播放 / 暂停 · ←/→ 跳 5 秒 · F 全屏<br />↑/↓ 音量 · Alt + ←/→ 换集
              </p>
            </div>
          </aside>
          </div>}
        </div>
            <SkipMarkPanel
              open={skipPanelOpen}
              onClose={() => setSkipPanelOpen(false)}
              markKey={markKey}
              pendingStart={pendingStart}
              onPendingStart={setPendingStart}
              mobileMaxHeight={sheetMaxHeight}
              getPlayerClock={() => {
                const api = playerApiRef.current;
                if (!api) return null;
                return {
                  currentTime: api.getCurrentTime(),
                  duration: api.getDuration(),
                  seek: (s) => api.seek(s),
                  pause: () => api.pause(),
                  isPaused: () => api.isPaused(),
                };
              }}
            />

            <section className="mt-6 pt-6 border-t border-line flex gap-4 sm:gap-6" aria-label="影片资料">
              <div className="grid w-20 shrink-0 self-start overflow-hidden rounded-lg bg-chip sm:w-32 aspect-[2/3] place-items-center">
              {cover ? (
                <SmartImage
                  url={cover}
                  mode={store.imageProxyMode}
                  customProxy={store.customImageProxy}
                  alt=""
                  className="h-full w-full object-cover"
                  onExhausted={() => setFailedCovers((failed) => failed.includes(cover) ? failed : [...failed, cover])}
                />
              ) : <span className="text-xs text-faint">暂无海报</span>}
              </div>
              <div className="min-w-0">
                <h2 className="text-xl sm:text-2xl font-semibold text-content mb-2">{videoTitle}</h2>
                <p className="text-sm text-faint mb-3">
                  {[videoInfo?.year, videoInfo?.typeName, videoInfo?.area, isSeries && `共 ${episodes.length} 集`].filter(Boolean).join(' · ') || source.name}
                </p>
                {videoInfo?.desc && <p className="text-sm text-muted leading-relaxed whitespace-pre-line mb-3">{videoInfo.desc}</p>}
                {videoInfo?.director && <p className="text-xs text-faint mb-1">导演：{videoInfo.director}</p>}
                {videoInfo?.actor && <p className="text-xs text-faint mb-1">主演：{videoInfo.actor}</p>}
                <p className="text-xs text-faint mt-3">播放来源：{source.name}</p>
              </div>
            </section>
      </main>

      {switchOpen && (
        <SwitchSourceModal
          key={sourceKey + ':' + vodId + ':' + currentIndex}
          currentTitle={videoTitle}
          currentSourceKey={sourceKey}
          currentVodId={vodId}
          currentIndex={currentIndex}
          currentEpisodeCount={episodes.length}
          currentYear={videoInfo?.year}
          getPlayback={getSwitchPlayback}
          currentSample={sampleRef.current}
          recentStalls={stallCount}
          onClose={() => setSwitchOpen(false)}
        />
      )}
    </div>
  );
}

/** 集数按钮：激活时自动滚动进可视区（长剧列表） */
function EpisodeButton({ index, active, onClick }: { index: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const list = ref.current.closest('[data-episode-scroll]');
    if (!list) return;
    const button = ref.current.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    if (button.top < bounds.top) list.scrollTop += button.top - bounds.top;
    else if (button.bottom > bounds.bottom) list.scrollTop += button.bottom - bounds.bottom;
  }, [active]);

  return (
    <button
      ref={ref}
      className={cn('btn btn-sm min-h-9 !px-1 lg:min-h-10', active ? 'episode-active' : 'btn-ghost')}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
    >
      {index + 1}
    </button>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <button
      className="p-2 -ml-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push('/');
      }}
      aria-label="返回"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

/** 首页按钮：直达首页，避免从外链进入时逐级 back */
function HomeButton() {
  return (
    <Link
      href="/"
      className="p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      aria-label="回首页"
      title="回首页"
    >
      <Icon name="home" className="w-5 h-5" />
    </Link>
  );
}
