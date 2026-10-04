/* ============================================================
   NEON FRONT 2.0 — görev hedef bileşenleri ve çalışma zamanı
   Hedef türleri: destroy · capture · hold · kills · reach · survive
   ============================================================ */
import { state } from '../core/state.js';
import { dist2D, fmtTime } from '../core/utils.js';

/** Tek bir hedefi değerlendirir ve durumunu döndürür. */
function evaluate(obj, dt) {
  switch (obj.type) {
    case 'destroy': {
      const targets = state.units.filter((u) => u.alive && u.team === obj.team && (obj.kind ? u.kind === obj.kind : true));
      obj.current = obj.count - targets.length;
      return obj.current >= obj.count;
    }
    case 'capture': {
      // obj.point verilirse sadece o kontrol noktası sayılır (etiketle uyum için)
      const owned = state.capturePoints.filter((p) => p.owner === 'blue' && (!obj.point || p.name === obj.point)).length;
      obj.current = owned;
      return owned >= obj.count;
    }
    case 'hold': {
      obj.timer = (obj.timer || 0) + dt;
      obj.current = obj.timer;
      return obj.timer >= obj.seconds;
    }
    case 'kills': {
      obj.current = state.stats.kills;
      return state.stats.kills >= obj.count;
    }
    case 'reach': {
      const z = obj.zone;
      const inside = state.units.filter((u) =>
        u.alive && u.team === 'blue' && u.kind !== 'bomber' && dist2D(u.pos.x, u.pos.z, z.x, z.z) < z.r);
      obj.current = inside.length;
      return inside.length >= (obj.need || 1);
    }
    case 'survive': {
      obj.timer = (obj.timer || 0) + dt;
      obj.current = obj.timer;
      return obj.timer >= obj.seconds;
    }
    default:
      return false;
  }
}

export class MissionRuntime {
  constructor(mission) {
    this.mission = mission;
    this.objectives = mission.objectives.map((o) => ({ ...o, current: 0, timer: 0 }));
    this.status = 'active';   // active | success | failed
    this.time = 0;
    this.timerLimit = mission.timeLimit || 0;
    this.onEvent = null;
    this._announced = new Set();
  }

  update(dt) {
    if (this.status !== 'active') return;
    this.time += dt;

    for (const o of this.objectives) {
      if (o.done) continue;
      const ok = evaluate(o, dt);
      if (ok) {
        o.done = true;
        if (this.onEvent) this.onEvent({ type: 'objective', label: o.label });
      }
    }

    if (this.objectives.every((o) => o.done)) {
      this.status = 'success';
      if (this.onEvent) this.onEvent({ type: 'success' });
      return;
    }

    if (this.mission.failOnHQLoss && state.hq.blue && !state.hq.blue.alive) {
      this.status = 'failed';
      if (this.onEvent) this.onEvent({ type: 'failed', reason: 'Karargah düştü' });
      return;
    }
    if (this.timerLimit && this.time >= this.timerLimit) {
      this.status = 'failed';
      if (this.onEvent) this.onEvent({ type: 'failed', reason: 'Süre doldu' });
    }
  }

  /** HUD için özet satırlar. */
  summary() {
    return this.objectives.map((o) => {
      let text = o.label;
      if (o.type === 'capture') text += ` (${Math.min(o.current, o.count)}/${o.count})`;
      else if (o.type === 'destroy') text += ` (${Math.min(o.current, o.count)}/${o.count})`;
      else if (o.type === 'kills') text += ` (${Math.min(o.current, o.count)}/${o.count})`;
      else if (o.type === 'hold' || o.type === 'survive') text += ` (${fmtTime(Math.min(o.current, o.seconds))}/${fmtTime(o.seconds)})`;
      else if (o.type === 'reach') text += ` (${o.current}/${o.need || 1})`;
      return { text, done: !!o.done };
    });
  }

  timeLeft() {
    if (!this.timerLimit) return null;
    return Math.max(0, this.timerLimit - this.time);
  }
}
