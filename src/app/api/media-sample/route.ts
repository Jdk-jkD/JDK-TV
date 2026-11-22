import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { withHostLimit } from '@/lib/host-gate';
import { probeEpisodeSpeed } from '@/lib/quality-probe';
import type { SourceConfig } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  try {
    const body = await req.json() as { source?: SourceConfig; id?: string; index?: number };
    const { source, id, index } = body;
    if (typeof source?.url !== 'string' || (source.detail !== undefined && typeof source.detail !== 'string') ||
        typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) ||
        typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 3000) {
      return NextResponse.json({ error: '无效的测速条目' }, { status: 400 });
    }
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(7500)]);
    const sample = await withHostLimit(new URL(source.url).host, () => probeEpisodeSpeed(source, id, index, signal));
    return NextResponse.json({ sample }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '媒体测速未完成' }, { status: 502 });
  }
}
