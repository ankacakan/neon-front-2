/* ============================================================
   NEON FRONT 2.0 — ilerleme / rütbe sistemi
   ============================================================ */
import { Save } from '../campaign/save.js';

export const RANKS = [
  { name: 'ER', min: 0 },
  { name: 'ONBAŞI', min: 40 },
  { name: 'ÇAVUŞ', min: 120 },
  { name: 'ÜSTEĞMEN', min: 260 },
  { name: 'YÜZBAŞI', min: 480 },
  { name: 'BİNBAŞI', min: 800 },
  { name: 'GENERAL', min: 1400 }
];

export function xp() {
  const t = Save.data.totals;
  return t.kills * 6 + t.missions * 60 + (t.lost ? Math.max(0, 20 - t.lost) : 20);
}

export function rank() {
  const x = xp();
  let r = RANKS[0];
  for (const cand of RANKS) if (x >= cand.min) r = cand;
  return r;
}

export function nextRank() {
  const x = xp();
  for (const cand of RANKS) if (x < cand.min) return cand;
  return null;
}

export function rankProgress() {
  const x = xp();
  const cur = rank();
  const nxt = nextRank();
  if (!nxt) return 1;
  return Math.max(0, Math.min(1, (x - cur.min) / (nxt.min - cur.min)));
}
