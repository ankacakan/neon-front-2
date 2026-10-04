/* ============================================================
   NEON FRONT 2.0 — kaynak ekonomisi ve üretim kuyruğu
   Tedarik / yakıt / mühimmat. Üs ve ele geçirilen noktalar gelir üretir.
   ============================================================ */
import { CFG } from '../config.js';
import { state } from '../core/state.js';
import { clamp } from '../core/utils.js';

export function canAfford(cost) {
  if (!cost) return false;
  return state.resources.supply >= cost.supply &&
    state.resources.fuel >= cost.fuel &&
    state.resources.ammo >= cost.ammo;
}

export function spend(cost) {
  if (!canAfford(cost)) return false;
  state.resources.supply -= cost.supply;
  state.resources.fuel -= cost.fuel;
  state.resources.ammo -= cost.ammo;
  return true;
}

export function refund(cost) {
  state.resources.supply += cost.supply;
  state.resources.fuel += cost.fuel;
  state.resources.ammo += cost.ammo;
}

/** Saniyelik gelir: üs + ele geçirilen noktalar. */
export function updateEconomy(dt) {
  const e = CFG.economy;
  let mult = 0;
  if (state.hq.blue && state.hq.blue.alive) mult += 1;
  let captured = 0;
  for (const p of state.capturePoints) if (p.owner === 'blue') captured++;
  const rate = {
    supply: (state.hq.blue && state.hq.blue.alive ? e.income.supply + e.hqBonus.supply : 0) + captured * e.captureBonus.supply,
    fuel: (state.hq.blue && state.hq.blue.alive ? e.income.fuel + e.hqBonus.fuel : 0) + captured * e.captureBonus.fuel,
    ammo: (state.hq.blue && state.hq.blue.alive ? e.income.ammo + e.hqBonus.ammo : 0) + captured * e.captureBonus.ammo
  };
  state.resources.supply = clamp(state.resources.supply + rate.supply * dt, 0, e.max.supply);
  state.resources.fuel = clamp(state.resources.fuel + rate.fuel * dt, 0, e.max.fuel);
  state.resources.ammo = clamp(state.resources.ammo + rate.ammo * dt, 0, e.max.ammo);
  state._income = rate;
  return rate;
}

/* ---------- Üretim kuyruğu ---------- */
export function enqueueProduction(kind) {
  const def = CFG.units[kind];
  if (!def || !def.cost) return { ok: false, reason: 'Geçersiz birim' };
  if (!canAfford(def.cost)) return { ok: false, reason: 'Yetersiz kaynak' };
  spend(def.cost);
  const job = { kind, remaining: def.buildTime, total: def.buildTime, def };
  state.prodQueue.push(job);
  return { ok: true, job };
}

export function updateProduction(dt) {
  if (!state.prodQueue.length) return null;
  const job = state.prodQueue[0];
  job.remaining -= dt;
  if (job.remaining <= 0) {
    state.prodQueue.shift();
    return job;
  }
  return null;
}

export function cancelProduction(index) {
  if (index < 0 || index >= state.prodQueue.length) return false;
  const [job] = state.prodQueue.splice(index, 1);
  refund(job.def.cost);
  return true;
}

export function productionProgress() {
  if (!state.prodQueue.length) return null;
  const j = state.prodQueue[0];
  return { kind: j.kind, frac: 1 - j.remaining / j.total };
}
