import { describe, expect, it } from 'vitest';
import { canResumeAcrossSources, compareMediaSamples, matchEpisode, watchlistUpdate, watchlistKind } from './playback-choice';

describe('片单电影和剧集分类', () => {
  it.each(['剧情片', '喜剧片', '爱情片', '动画电影', '剧场版'])('单集%s加入想看电影', (type) => {
    expect(watchlistKind(1, type)).toBe('movie');
  });
  it('电影有正片和预告等多个条目时仍归电影', () => {
    expect(watchlistKind(2, '剧情片')).toBe('movie');
  });
  it.each(['国产剧', '欧美剧', '日本剧', '日韩动漫', '综艺'])('只更新一集的%s仍可追更', (type) => {
    expect(watchlistKind(1, type)).toBe('series');
  });
  it('缺少类型时按集数区分', () => {
    expect(watchlistKind(1)).toBe('movie');
    expect(watchlistKind(12)).toBe('series');
  });
});

describe('选择可续播的线路', () => {
  it('不能把不同总集数的线路的同一索引直接当作同一集', () => {
    expect(matchEpisode(2, 12, 13)).toBeUndefined();
    expect(matchEpisode(2, 12, 12)).toBe(2);
    expect(matchEpisode(12, 12, 12)).toBeUndefined();
  });

  it('只在目标时长一致且可以跳转时保留进度', () => {
    expect(canResumeAcrossSources(90, 1400, 1408)).toBe(true);
    expect(canResumeAcrossSources(90, 1400, 1550)).toBe(false);
    expect(canResumeAcrossSources(90, 1400, 80)).toBe(false);
  });

  it('排序优先考虑能否跟上播放速度，缺样本排在最后', () => {
    const fast = { seconds: 6, ms: 1500, bytes: 600000 };
    const slow = { seconds: 6, ms: 8000, bytes: 1000000 };
    expect(compareMediaSamples(fast, slow)).toBeLessThan(0);
    expect(compareMediaSamples(fast, undefined)).toBeLessThan(0);
  });

  it('只把高于已确认集数的变化当作更新', () => {
    expect(watchlistUpdate(12, 11)).toEqual({ known: 12, added: 0 });
    expect(watchlistUpdate(12, 14)).toEqual({ known: 14, added: 2 });
    expect(watchlistUpdate(0, 14)).toEqual({ known: 14, added: 0 });
  });
});
