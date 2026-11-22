'use client';

import { useCallback, useEffect, useState } from 'react';
import { Drawer } from './drawer';
import { ConfirmDialog } from './confirm-dialog';
import { ToggleRow } from './settings-shared';
import { useToast } from './toast';
import { getVideoPrefetcher } from '@/lib/video-prefetcher';
import { DEFAULT_CACHE_SETTINGS, clearVideoCache, enforceQuota, getCacheSummary, loadCacheSettings,
  prepareVideoCache, saveCacheSettings, type CacheSummary } from '@/lib/video-cache';

const GB = 1024 ** 3;
export function formatCacheBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** 整页生命周期仅初始化一次；不在切后台或退出时冒险清理。 */
export function CacheMaintenance() {
  useEffect(() => {
    void prepareVideoCache().catch(() => {});
    const timer = setInterval(() => { void enforceQuota().catch(() => {}); }, 60_000);
    return () => clearInterval(timer);
  }, []);
  return null;
}

export function VideoCachePanel() {
  const { toast } = useToast();
  const [settings, setSettings] = useState(DEFAULT_CACHE_SETTINGS);
  const [limit, setLimit] = useState('2');
  const [summary, setSummary] = useState<CacheSummary>({ segments: 0, bytes: 0, episodes: 0 });
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number }>();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const refresh = useCallback(async () => {
    setSummary(await getCacheSummary());
    try { if (navigator.storage?.estimate) setEstimate(await navigator.storage.estimate()); } catch { /* 估算不可用 */ }
  }, []);
  useEffect(() => {
    setSupported(typeof caches !== 'undefined');
    const read = () => { const value = loadCacheSettings(); setSettings(value); setLimit(String(Number((value.maxTotalBytes / GB).toFixed(2)))); };
    read(); void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    window.addEventListener('storage', read);
    window.addEventListener('jdk-tv:cache-settings', read);
    return () => { clearInterval(timer); window.removeEventListener('storage', read); window.removeEventListener('jdk-tv:cache-settings', read); };
  }, [refresh]);

  const apply = async () => {
    const value = Number(limit);
    if (!Number.isFinite(value) || value < 0.1 || value > 20) { toast('缓存上限请输入 0.1～20 GB', 'warning'); return; }
    setBusy(true);
    try {
      const next = saveCacheSettings({ ...settings, maxTotalBytes: Math.round(value * GB) });
      setSettings(next);
      if (!next.enabled) getVideoPrefetcher().stop();
      await enforceQuota(next); await refresh();
      toast('缓存设置已保存，当前缓存已按新上限整理', 'success');
    } catch (error) { toast(error instanceof Error ? error.message : '缓存设置未完成，请重试', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <section className="space-y-4" aria-label="视频缓存设置">
      <div className="rounded-xl border border-line bg-chip/40 p-4 space-y-2">
        <div className="flex justify-between items-baseline gap-2"><strong className="text-xl text-content">{formatCacheBytes(summary.bytes)}</strong><span className="text-xs text-muted">上限 {formatCacheBytes(settings.maxTotalBytes)}</span></div>
        <progress aria-label="视频缓存用量" className="w-full h-2 accent-cyan-400" max={settings.maxTotalBytes} value={Math.min(summary.bytes, settings.maxTotalBytes)} />
        <p className="text-xs text-muted">{summary.episodes} 集 · {summary.segments} 个片段，按本地记录统计</p>
        {estimate?.usage !== undefined && <p className="text-xs text-faint">本站点总占用约 {formatCacheBytes(estimate.usage)}{estimate.quota ? ` / 浏览器配额约 ${formatCacheBytes(estimate.quota)}` : ''}，还包括图片、下载等数据。</p>}
      </div>
      {!supported && <p className="text-sm text-muted">当前环境不支持片段缓存，请使用受支持的浏览器及安全访问地址。</p>}
      <ToggleRow label="开启视频片段缓存" description="优先缓存最近观看的片段，减少重复加载；关闭后停止本页预取。" checked={settings.enabled} onChange={(enabled) => setSettings((s) => ({ ...s, enabled }))} />
      <label className="flex items-center justify-between gap-3 text-sm text-content">缓存总上限（GB）<input aria-label="缓存总上限（GB）" type="number" min="0.1" max="20" step="any" className="input w-24" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
      <p className="text-xs text-muted">达到上限后自动淘汰最久未使用的片段。默认 2 GB；实际容量还受浏览器和磁盘空间限制。</p>
      <label className="flex items-center justify-between gap-3 text-sm text-content">未使用片段保留时间<select aria-label="未使用片段保留时间" className="input w-36" value={settings.maxAgeDays} onChange={(e) => setSettings((s) => ({ ...s, maxAgeDays: Number(e.target.value) }))}><option value={0}>仅按容量清理</option>{[1,7,30].map((days) => <option key={days} value={days}>{days} 天</option>)}{![0,1,7,30].includes(settings.maxAgeDays) && <option value={settings.maxAgeDays}>{settings.maxAgeDays} 天</option>}</select></label>
      <ToggleRow label="每次打开或刷新时清理" description="下次重新打开或刷新页面时清理片段；站内切换页面不触发。默认关闭。" checked={settings.clearOnStartup} onChange={(clearOnStartup) => setSettings((s) => ({ ...s, clearOnStartup }))} />
      <p className="text-xs text-faint">网页退出时可能来不及执行清理，因此使用“下次打开时清理”。保留观看历史、进度、片单和源设置；已下载内容请在下载管理中单独处理。</p>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={busy || !supported} onClick={() => { void apply(); }}>应用设置</button><button type="button" className="btn-secondary" disabled={busy || !supported || !summary.segments} onClick={() => setConfirm(true)}>{busy ? '处理中…' : '清理视频缓存'}</button></div>
      <ConfirmDialog open={confirm} title="清理视频片段缓存？" message="将移除已缓存的视频片段，之后播放可能重新加载。观看历史、进度、片单、源设置和下载内容会保留。" confirmLabel="清理缓存" onCancel={() => setConfirm(false)} onConfirm={() => {
        setConfirm(false); setBusy(true); getVideoPrefetcher().stop();
        void clearVideoCache().then(async () => { await refresh(); toast('视频片段缓存已清理', 'success'); }).catch((error) => { toast(error instanceof Error ? error.message : '缓存清理失败，请重试', 'error'); }).finally(() => setBusy(false));
      }} />
    </section>
  );
}

export function VideoCacheManager() {
  const [open, setOpen] = useState(false);
  const [bytes, setBytes] = useState<number>();
  useEffect(() => {
    const refresh = () => { void getCacheSummary().then((value) => setBytes(value.bytes)); };
    refresh(); const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);
  return <><button type="button" aria-label="缓存管理" title="查看缓存占用与清理策略" className="shrink-0 px-2 py-1.5 rounded-md border border-line text-xs text-muted hover:text-content hover:bg-hover" onClick={() => setOpen(true)}>缓存 <span className="tabular-nums">{bytes === undefined ? '…' : formatCacheBytes(bytes)}</span></button><Drawer open={open} onClose={() => setOpen(false)} title="缓存与存储" mobileFull><VideoCachePanel /></Drawer></>;
}
