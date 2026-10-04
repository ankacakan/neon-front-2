/* ============================================================
   NEON FRONT 2.0 — muharebe yardımcıları: hedef tarama, menzil,
   hasar, hedef seçimi.
   ============================================================ */
import { state } from '../core/state.js';
import { dist3D, dist2D } from '../core/utils.js';

/** Düşman birimleri arasından bu birimin menziline en uygun hedefi seç. */
export function scanTarget(unit) {
  let best = null, bestD = Infinity;
  for (const u of state.units) {
    if (!u.alive || u.team === unit.team) continue;
    const d = dist3D(unit.pos.x, unit.pos.y, unit.pos.z, u.pos.x, u.pos.y, u.pos.z);
    const lim = u.kind === 'bomber' ? unit.range * 0.95 : unit.detect;
    // hava hedefleri için yer birimleri sınırlı erişebilir
    if (u.rail === 'air' && unit.rail !== 'air' && unit.kind !== 'hq') continue;
    if (d < lim && d < bestD) { bestD = d; best = u; }
  }
  unit.target = best;
  return best;
}

/** Menzil ve yükseklik farkı uygun mu? */
export function canEngage(unit, tgt) {
  if (!tgt || !tgt.alive) return false;
  const d3 = dist3D(unit.pos.x, unit.pos.y, unit.pos.z, tgt.pos.x, tgt.pos.y, tgt.pos.z);
  if (tgt.kind === 'bomber' || tgt.rail === 'air') {
    return d3 < unit.range && Math.abs(unit.pos.y - tgt.pos.y) < 18;
  }
  if (d3 > unit.range) return false;
  if (unit.minRange && d3 < unit.minRange) return false;
  return true;
}

/** Alan hasarı (topçu ve bombalar için). */
export function splashDamage(x, z, radius, damage, team, owner) {
  for (const u of state.units) {
    if (!u.alive || u.team === team) continue;
    const d = dist2D(u.pos.x, u.pos.z, x, z);
    if (d < radius + u.radius) {
      const falloff = 1 - d / (radius + u.radius);
      u.takeDamage(damage * (0.4 + 0.6 * falloff), u.pos.x, u.pos.y + 1, u.pos.z, owner);
    }
  }
}

/** Birim çevresindeki en yakın düşmanı bul (AI için). */
export function nearestEnemy(unit, maxDist) {
  let best = null, bestD = maxDist || Infinity;
  for (const u of state.units) {
    if (!u.alive || u.team === unit.team) continue;
    const d = dist2D(unit.pos.x, unit.pos.z, u.pos.x, u.pos.z);
    if (d < bestD) { bestD = d; best = u; }
  }
  return best;
}
