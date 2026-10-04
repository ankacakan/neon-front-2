/* ============================================================
   NEON FRONT 2.0 — A* yol bulma (string-pulling ile)
   Bellek: tipli diziler, arama başına sıfır tahsis.
   ============================================================ */
import { W, GRID_N, CELL, walkableAt } from '../world/mapgen.js';
import { clampInt } from '../core/utils.js';
import { CFG } from '../config.js';

const GN = GRID_N, CS = CELL;
const walkable = new Uint8Array(GN * GN);
const gScore = new Float32Array(GN * GN);
const fScore = new Float32Array(GN * GN);
const cameFrom = new Int32Array(GN * GN);
const closedStamp = new Int32Array(GN * GN);
const seenStamp = new Int32Array(GN * GN);
const heapArr = new Int32Array(GN * GN + 1);
let heapLen = 0;
let searchStamp = 0;
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function buildGrid() {
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) {
      const x = -W.half + (i + 0.5) * CS;
      const z = -W.half + (j + 0.5) * CS;
      walkable[j * GN + i] = walkableAt(x, z) ? 1 : 0;
    }
  }
}

export function cellOf(x, z) {
  return {
    i: clampInt(Math.floor((x + W.half) / CS), 0, GN - 1),
    j: clampInt(Math.floor((z + W.half) / CS), 0, GN - 1)
  };
}
export function cellCenter(i, j) {
  return { x: -W.half + (i + 0.5) * CS, z: -W.half + (j + 0.5) * CS };
}
export function isWalkCell(i, j) {
  if (i < 0 || j < 0 || i >= GN || j >= GN) return false;
  return walkable[j * GN + i] === 1;
}
export function nearestWalkable(i, j) {
  if (isWalkCell(i, j)) return { i, j };
  for (let r = 1; r <= 16; r++) {
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
        const ni = i + di, nj = j + dj;
        if (isWalkCell(ni, nj)) return { i: ni, j: nj };
      }
    }
  }
  return null;
}

export function losClear(x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.max(1, Math.ceil(len / 1.1));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (!walkableAt(x0 + dx * t, z0 + dz * t)) return false;
  }
  return true;
}

function h(i, j, ti, tj) {
  const di = Math.abs(i - ti), dj = Math.abs(j - tj);
  return (di + dj) + (1.41421356 - 2) * Math.min(di, dj);
}
function heapPush(idx) {
  heapArr[++heapLen] = idx;
  let c = heapLen;
  while (c > 1) {
    const p = c >> 1;
    if (fScore[heapArr[p]] <= fScore[heapArr[c]]) break;
    const t = heapArr[p]; heapArr[p] = heapArr[c]; heapArr[c] = t;
    c = p;
  }
}
function heapPop() {
  const top = heapArr[1];
  heapArr[1] = heapArr[heapLen--];
  let p = 1;
  for (;;) {
    const l = p << 1, r = l | 1;
    let m = p;
    if (l <= heapLen && fScore[heapArr[l]] < fScore[heapArr[m]]) m = l;
    if (r <= heapLen && fScore[heapArr[r]] < fScore[heapArr[m]]) m = r;
    if (m === p) break;
    const t = heapArr[p]; heapArr[p] = heapArr[m]; heapArr[m] = t;
    p = m;
  }
  return top;
}

/** Rota döndürür: [{x,z}, ...] veya null. */
export function findPath(sx, sz, tx, tz) {
  const s = cellOf(sx, sz), t = cellOf(tx, tz);
  const st = nearestWalkable(s.i, s.j), go = nearestWalkable(t.i, t.j);
  if (!st || !go) return null;
  const startIdx = st.j * GN + st.i, goalIdx = go.j * GN + go.i;
  if (startIdx === goalIdx) return [{ x: tx, z: tz }];

  searchStamp++;
  heapLen = 0;
  seenStamp[startIdx] = searchStamp;
  gScore[startIdx] = 0;
  fScore[startIdx] = h(st.i, st.j, go.i, go.j);
  cameFrom[startIdx] = -1;
  closedStamp[startIdx] = 0;
  heapPush(startIdx);

  const cap = CFG.ai.pathExpansionCap;
  let expanded = 0, found = false;
  while (heapLen > 0 && expanded < cap) {
    const cur = heapPop();
    if (seenStamp[cur] !== searchStamp || closedStamp[cur] === searchStamp) continue;
    if (cur === goalIdx) { found = true; break; }
    closedStamp[cur] = searchStamp;
    expanded++;
    const ci = cur % GN, cj = (cur - ci) / GN;
    for (let n = 0; n < 8; n++) {
      const ni = ci + NB[n][0], nj = cj + NB[n][1];
      if (ni < 0 || nj < 0 || ni >= GN || nj >= GN) continue;
      const nIdx = nj * GN + ni;
      if (!walkable[nIdx]) continue;
      if (n > 3 && (!walkable[cj * GN + ni] || !walkable[nj * GN + ci])) continue;
      const step = n > 3 ? 1.41421356 : 1.0;
      const tent = gScore[cur] + step;
      if (seenStamp[nIdx] !== searchStamp) {
        seenStamp[nIdx] = searchStamp;
        closedStamp[nIdx] = 0;
        gScore[nIdx] = Infinity;
      }
      if (tent < gScore[nIdx]) {
        gScore[nIdx] = tent;
        cameFrom[nIdx] = cur;
        fScore[nIdx] = tent + h(ni, nj, go.i, go.j);
        heapPush(nIdx);
      }
    }
  }
  if (!found) return null;

  const cells = [];
  let k = goalIdx, guard = 0;
  while (k !== -1 && guard++ < 20000) {
    const ki = k % GN, kj = (k - ki) / GN;
    cells.push(cellCenter(ki, kj));
    if (k === startIdx) break;
    k = cameFrom[k];
  }
  cells.reverse();
  if (!cells.length) return null;

  const out = [cells[0]];
  let idx = 0;
  while (idx < cells.length - 1) {
    let jj = cells.length - 1;
    for (; jj > idx + 1; jj--) {
      if (losClear(cells[idx].x, cells[idx].z, cells[jj].x, cells[jj].z)) break;
    }
    out.push(cells[jj]);
    idx = jj;
  }
  if (losClear(out[out.length - 1].x, out[out.length - 1].z, tx, tz) && walkableAt(tx, tz)) {
    out.push({ x: tx, z: tz });
  }
  if (out.length > 1) out.shift();
  return out;
}
