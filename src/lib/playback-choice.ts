export interface MediaSample {
  bytes: number;
  ms: number;
  seconds: number;
}

export function mediaHeadroom(sample: MediaSample): number {
  return sample.seconds * 1000 / Math.max(sample.ms, 1);
}

export function compareMediaSamples(a?: MediaSample, b?: MediaSample): number {
  return (b ? mediaHeadroom(b) : -1) - (a ? mediaHeadroom(a) : -1);
}

export function matchEpisode(index: number, fromCount: number, toCount: number): number | undefined {
  return Number.isInteger(index) && index >= 0 && index < fromCount && fromCount === toCount ? index : undefined;
}

export function canResumeAcrossSources(position: number, fromDuration: number, targetDuration: number): boolean {
  return [position, fromDuration, targetDuration].every(Number.isFinite) && position > 10 &&
    position < targetDuration - 2 && fromDuration > position &&
    Math.abs(fromDuration - targetDuration) <= Math.min(15, fromDuration * 0.03);
}

export function watchlistUpdate(known: number, latest: number) {
  return { known: Math.max(known, latest), added: known > 0 ? Math.max(0, latest - known) : 0 };
}

/** 明确的电影类型优先，避免将“剧情片”“喜剧片”中的剧字当成剧集。 */
export function watchlistKind(episodeCount: number, typeName = ''): 'movie' | 'series' {
  if (/电影|剧场版|(?:剧情|喜剧|爱情|动作|科幻|悬疑|恐怖|惊悚|战争|犯罪|冒险|奇幻|动画|纪录|传记|家庭|儿童|灾难|武侠|歌舞|音乐|历史|短|伦理)片/.test(typeName)) {
    return 'movie';
  }
  if (episodeCount > 1 || /(?:连续|电视|国产|港台|香港|台湾|欧美|美国|韩国|日本|海外|泰国|短|日|韩|泰)剧|剧集|番剧|动漫|动画|综艺/.test(typeName)) {
    return 'series';
  }
  return 'movie';
}

export function mediaSampleLabel(sample: MediaSample): string {
  return `${sample.seconds.toFixed(1)} 秒视频 / ${(sample.ms / 1000).toFixed(1)} 秒下载`;
}
