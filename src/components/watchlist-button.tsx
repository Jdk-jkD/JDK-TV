'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, watchlistId, findWatchlistEntry, type WatchlistEntry } from '@/lib/db';
import { useToast } from './toast';

export function WatchlistButton({ item }: { item: Omit<WatchlistEntry, 'id' | 'addedAt'> }) {
  const id = watchlistId(item.title, item.kind, item.year);
  const saved = useLiveQuery(() => findWatchlistEntry(item.title, item.kind, item.year), [id]);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function toggle() {
    setBusy(true);
    try {
      if (saved) await db.watchlist.delete(saved.id);
      else await db.watchlist.add({ ...item, id, addedAt: Date.now() });
    } catch {
      toast('无法更新本机片单', 'error');
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" className="btn-ghost btn-sm" aria-pressed={Boolean(saved)}
    disabled={busy} onClick={() => void toggle()}>
    {saved ? (item.kind === 'series' ? '已追更' : '已加入想看') : (item.kind === 'series' ? '＋追更' : '＋想看')}
  </button>;
}
