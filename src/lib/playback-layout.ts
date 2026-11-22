export type PlaybackLayout = 'single' | 'series';

export interface EpisodeGroup {
  start: number;
  end: number;
}

export function playbackLayout(episodeCount: number): PlaybackLayout {
  return episodeCount > 1 ? 'series' : 'single';
}

export function episodeGroups(count: number, pageSize = 50): EpisodeGroup[] {
  if (!Number.isFinite(count) || count <= 0 || pageSize <= 0) return [];
  const groups: EpisodeGroup[] = [];
  for (let start = 0; start < count; start += pageSize) {
    groups.push({ start, end: Math.min(start + pageSize, count) - 1 });
  }
  return groups;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.max(1, Math.min(2, Math.round(zoom * 10) / 10));
}

export function clampPan(zoom: number, x: number, y: number, width: number, height: number): { x: number; y: number } {
  const scale = clampZoom(zoom);
  const maxX = Math.max(0, (scale - 1) * width / 2);
  const maxY = Math.max(0, (scale - 1) * height / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, Number.isFinite(x) ? x : 0)),
    y: Math.max(-maxY, Math.min(maxY, Number.isFinite(y) ? y : 0)),
  };
}
