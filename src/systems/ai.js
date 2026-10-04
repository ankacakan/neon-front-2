/* ============================================================
   NEON FRONT 2.0 — birim yapay zekâsı
   Kırmızı taraf taarruz, mavi taraf savunma; hedef yoksa stratejik ilerleme.
   ============================================================ */
import { CFG } from '../config.js';
import { state } from '../core/state.js';
import { dist2D, dist3D, rand } from '../core/utils.js';

export function thinkAI(unit, dt) {
  if (unit.kind === 'hq' || unit.kind === 'bomber') return;
  const tgt = unit.target;

  if (unit.team === 'red') {
    if (CFG.ai.redPursue) {
      if (tgt && tgt.alive) {
        const dd = dist3D(unit.pos.x, unit.pos.y, unit.pos.z, tgt.pos.x, tgt.pos.y, tgt.pos.z);
        const ideal = unit.range * 0.72;
        if (dd > ideal) {
          unit.repathCd -= dt;
          if (unit.repathCd <= 0 || !unit.path) {
            unit.repathCd = CFG.ai.repathLocal + rand(0, 0.6);
            unit.orderMove(tgt.pos.x, tgt.pos.z);
          }
        } else if (!unit.path && unit.moveGoal) {
          unit.path = null; unit.moveGoal = null;
        }
      } else {
        unit.repathCd -= dt;
        if (unit.repathCd <= 0 || !unit.moveGoal) {
          unit.repathCd = CFG.ai.repathStrategic + rand(0, 1.4);
          let obj = null;
          if (state.hq.blue && state.hq.blue.alive) obj = state.hq.blue;
          else {
            let bd = Infinity;
            for (const bu of state.units) {
              if (bu.team !== 'blue' || !bu.alive || bu.kind === 'bomber') continue;
              const bdist = dist2D(unit.pos.x, unit.pos.z, bu.pos.x, bu.pos.z);
              if (bdist < bd) { bd = bdist; obj = bu; }
            }
          }
          if (obj) unit.orderMove(obj.pos.x + rand(-16, 16), obj.pos.z + rand(-16, 16));
        }
      }
    }
  } else if (unit.team === 'blue') {
    if (CFG.ai.blueAutoDefend && !unit.path && tgt && tgt.alive && tgt.kind !== 'bomber' && tgt.rail !== 'air') {
      const dd = dist3D(unit.pos.x, unit.pos.y, unit.pos.z, tgt.pos.x, tgt.pos.y, tgt.pos.z);
      if (dd > unit.range * 1.15) {
        unit.repathCd -= dt;
        if (unit.repathCd <= 0) {
          unit.repathCd = CFG.ai.repathLocal + rand(0, 0.8);
          unit.orderMove(tgt.pos.x, tgt.pos.z);
        }
      }
    }
  }
}
