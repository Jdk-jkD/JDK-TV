import { describe, expect, it } from 'vitest';
import { clampPan, clampZoom, episodeGroups, playbackLayout } from './playback-layout';

describe('playback layout', () => {
  it('uses a full-width player for a single playable item', () => {
    expect(playbackLayout(0)).toBe('single');
    expect(playbackLayout(1)).toBe('single');
    expect(playbackLayout(2)).toBe('series');
  });

  it('groups a long series without losing or duplicating episodes', () => {
    expect(episodeGroups(101)).toEqual([
      { start: 0, end: 49 },
      { start: 50, end: 99 },
      { start: 100, end: 100 },
    ]);
    expect(episodeGroups(0)).toEqual([]);
  });

  it('keeps zoom and dragging inside the video frame', () => {
    expect(clampZoom(2.8)).toBe(2);
    expect(clampZoom(0.5)).toBe(1);
    expect(clampPan(1.5, 500, -500, 800, 400)).toEqual({ x: 200, y: -100 });
    expect(clampPan(1, 80, 20, 800, 400)).toEqual({ x: 0, y: 0 });
  });
});
