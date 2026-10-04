/* ============================================================
   NEON FRONT 2.0 — paylaşılan çalışma-zamanı durumu
   Modüller arası döngüsel bağımlılığı önlemek için tek merkez.
   ============================================================ */
import { CFG } from '../config.js';

export const state = {
  /* Oyun akışı */
  phase: 'menu',                   // menu | briefing | playing | briefing-done | over | victory
  paused: false,

  /* Varlıklar */
  units: [],
  selected: [],
  hq: { blue: null, red: null },
  capturePoints: [],

  /* İstatistik */
  stats: { kills: 0, lost: 0, wave: 0, time: 0, spawned: 0 },

  /* Ekonomi */
  resources: { supply: 0, fuel: 0, ammo: 0 },
  prodQueue: [],

  /* Kamera kontrolü */
  cam: { yaw: CFG.camera.yawStart, focus: null, viewSize: CFG.camera.viewSize, shake: 0 },

  /* Girdi */
  keys: Object.create(null),
  mouse: { x: 0, y: 0 },

  /* Motor & efekt referansları (init sırasında doldurulur) */
  engine: {},
  assets: {},
  pools: {},
  fx: {},
  ui: {},
  diag: null,

  /* Yapay zekâ / senaryo sayaçları */
  ai: {
    reinforceCd: 0,
    airstrikeCd: 0,
    waveTimer: CFG.waves.firstDelay,
    waveInterval: CFG.waves.interval,
    enemyBomberTimer: CFG.waves.enemyBomberFirst
  },

  /* Aktif görev */
  mission: null,

  /* Ayarlar (kaydedilir) */
  settings: {
    postfx: CFG.postfx.enabled,
    ssao: CFG.postfx.ssao.enabled,
    dof: CFG.postfx.dof.enabled,
    bloom: CFG.postfx.bloom.enabled,
    grain: true
  }
};

/* ---------- Yardımcılar ---------- */
export function addUnit(u) { state.units.push(u); return u; }

export function removeUnit(u) {
  const i = state.units.indexOf(u);
  if (i >= 0) state.units.splice(i, 1);
  const s = state.selected.indexOf(u);
  if (s >= 0) state.selected.splice(s, 1);
}

export function unitsOf(team, kind) {
  const out = [];
  for (const u of state.units) {
    if (!u.alive) continue;
    if (team && u.team !== team) continue;
    if (kind && u.kind !== kind) continue;
    out.push(u);
  }
  return out;
}

export function ownUnits() {
  return unitsOf('blue').filter((u) => u.kind !== 'bomber' && u.kind !== 'hq');
}

export function resetResources() {
  const e = CFG.economy;
  state.resources.supply = e.start.supply;
  state.resources.fuel = e.start.fuel;
  state.resources.ammo = e.start.ammo;
}
