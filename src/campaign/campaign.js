/* ============================================================
   NEON FRONT 2.0 — kampanya durum makinesi
   Dünya kurulumu, dalga akışı, ele geçirme noktaları, görev sonucu.
   ============================================================ */
import { CFG } from '../config.js';
import { state, resetResources } from '../core/state.js';
import { rand, randInt, TAU, dist2D, clamp, fmtTime } from '../core/utils.js';
import { W, generateCapturePoints, groundHeight, walkableAt, riverCX } from '../world/mapgen.js';
import { spawnUnit, spawnTank, spawnHQ, callAirstrike } from '../units/unit.js';
import { resetParticles } from '../fx/particles.js';
import { resetBillboards } from '../fx/billboards.js';
import { resetDecals, spawnRing } from '../fx/decals.js';
import { resetProjectiles } from '../fx/projectiles.js';
import { resetExplosions } from '../fx/explosions.js';
import { MissionRuntime } from '../systems/missions.js';
import { missionById } from './missions.js';
import { Save } from './save.js';
import { enqueueProduction, updateProduction, updateEconomy } from '../systems/economy.js';
import { buildCaptureMarkers, updateCaptureMarkers } from '../world/scenery.js';
import { nearestWalkable, cellOf, cellCenter } from '../systems/pathfinding.js';

export const campaign = {
  current: null,
  runtime: null,
  waveTimer: 0,
  waveCfg: null,
  markers: null,
  result: null,
  endDelay: 0
};

/* ---------------------------------------------------------------
   Dünyayı temizle
   --------------------------------------------------------------- */
export function resetWorld() {
  for (const u of state.units.slice()) {
    u.alive = false;
    if (u.mesh) state.engine.scene.remove(u.mesh);
    if (u.hpBar) state.engine.scene.remove(u.hpBar.group);
  }
  state.units.length = 0;
  state.selected.length = 0;

  resetProjectiles();
  resetDecals();
  resetParticles();
  resetBillboards();
  resetExplosions();

  state.stats = { kills: 0, lost: 0, wave: 0, time: 0, spawned: 0 };
  state.prodQueue.length = 0;
  state.hq.blue = null;
  state.hq.red = null;
  campaign.result = null;
  campaign.endDelay = 0;
}

/* ---------------------------------------------------------------
   Harita kontrol noktalarını hazırla (bir kez)
   --------------------------------------------------------------- */
export function initCapturePoints(scene) {
  state.capturePoints = generateCapturePoints();
  campaign.markers = buildCaptureMarkers(scene, state.capturePoints);
  return state.capturePoints;
}

/* ---------------------------------------------------------------
   Görev başlat
   --------------------------------------------------------------- */
export function startMission(id) {
  const mission = missionById(id);
  if (!mission) return false;

  resetWorld();
  resetResources();
  campaign.current = mission;
  campaign.waveCfg = mission.waves;
  campaign.waveTimer = mission.waves.firstDelay;
  campaign.runtime = new MissionRuntime(mission);

  // kontrol noktalarını sıfırla
  for (const p of state.capturePoints) {
    p.owner = 'neutral'; p.progress = 0; p.contested = false;
  }

  const hx = W.half * 0.55, hz = W.half * 0.42;
  state.hq.blue = spawnHQ('blue', hx, -hz);
  state.hq.red = spawnHQ('red', -hx, hz);

  // başlangıç birlikleri
  for (let i = 0; i < 5; i++) {
    spawnTank('blue', hx - 14 + rand(-9, 9), -hz + 12 + rand(-9, 9), {});
  }
  for (let i = 0; i < 3; i++) {
    spawnTank('red', -hx + 12 + rand(-9, 9), hz - 12 + rand(-9, 9), {});
  }

  state.cam.focus.set(state.hq.blue.pos.x - 16, 0, state.hq.blue.pos.z + 10);
  state.cam.yaw = CFG.camera.yawStart;
  state.cam.viewSize = CFG.camera.viewSize;

  state.mission = mission;
  state.phase = 'playing';

  if (state.ui.onMissionStart) state.ui.onMissionStart(mission);
  return true;
}

/* ---------------------------------------------------------------
   Dalga üretimi
   --------------------------------------------------------------- */
export function spawnWave() {
  const cfg = campaign.waveCfg || CFG.waves;
  state.stats.wave++;
  const wave = state.stats.wave;
  let n = Math.round(cfg.enemies + (wave - 1) * cfg.ramp);
  n = Math.min(n, cfg.max || CFG.waves.maxEnemies);

  const lanes = [-0.35, -0.12, 0.12, 0.35];
  for (let i = 0; i < n; i++) {
    let z = lanes[i % lanes.length] * W.size * 0.9 + rand(-18, 18);
    let x = -W.half + 18 - rand(0, 12);
    const cell = nearestWalkable(cellOf(x, z).i, cellOf(x, z).j);
    if (cell) { const c = cellCenter(cell.i, cell.j); x = c.x; z = c.z; }
    if (!walkableAt(x, z)) continue;
    // her 3. dalgada bir topçu
    const kind = (wave >= 3 && i === n - 1 && Math.random() < 0.5) ? 'artillery'
      : (Math.random() < 0.18 ? 'infantry' : 'tank');
    spawnUnit(kind, 'red', x, z, {});
  }

  if (state.ui.toast) state.ui.toast(`DALGA ${wave} — ${n} DÜŞMAN BİRLİĞİ`, 2400);

  const every = cfg.airstrikeEvery || 0;
  if (every > 0 && wave % every === 0) {
    const tgt = state.hq.blue ? state.hq.blue : { pos: state.cam.focus };
    callAirstrike('red', tgt.pos.x + rand(-20, 20), tgt.pos.z + rand(-20, 20), 2);
  }
}

/* ---------------------------------------------------------------
   Üretim kuyruğu tamamlandığında birimi çıkar
   --------------------------------------------------------------- */
function deployFromQueue(job) {
  const hq = state.hq.blue;
  if (!hq) return;
  const ang = rand(0, TAU);
  let x = hq.pos.x + Math.cos(ang) * rand(13, 20);
  let z = hq.pos.z + Math.sin(ang) * rand(13, 20);
  const cell = nearestWalkable(cellOf(x, z).i, cellOf(x, z).j);
  if (cell) { const c = cellCenter(cell.i, cell.j); x = c.x; z = c.z; }

  if (job.kind === 'infantry') {
    for (let i = 0; i < (CFG.units.infantry.squad || 3); i++) {
      spawnUnit('infantry', 'blue', x + rand(-3, 3), z + rand(-3, 3), {});
    }
  } else {
    spawnUnit(job.kind, 'blue', x, z, {});
  }
  state.stats.spawned++;
  spawnRing(x, groundHeight(x, z) + 0.15, z, 1, 13, 0.55, 0x7fe3ff);
  if (state.ui.toast) state.ui.toast(`${CFG.units[job.kind].label} CEPHEYE İNDİ`, 1500);
}

/* ---------------------------------------------------------------
   Kontrol noktaları
   --------------------------------------------------------------- */
function updateCapture(dt) {
  for (const p of state.capturePoints) {
    let blue = 0, red = 0;
    for (const u of state.units) {
      if (!u.alive || u.kind === 'bomber' || u.rail === 'air') continue;
      if (dist2D(u.pos.x, u.pos.z, p.x, p.z) < p.radius) {
        if (u.team === 'blue') blue++;
        else red++;
      }
    }
    p.contested = blue > 0 && red > 0;
    const prevOwner = p.owner;
    if (blue > red && blue > 0) p.progress = clamp(p.progress + dt * 0.22 * blue, -1, 1);
    else if (red > blue && red > 0) p.progress = clamp(p.progress - dt * 0.22 * red, -1, 1);
    else if (p.owner !== 'neutral') p.progress += (p.owner === 'blue' ? 1 : -1) * dt * 0.05;

    if (p.progress >= 1) { p.owner = 'blue'; p.progress = 1; }
    else if (p.progress <= -1) { p.owner = 'red'; p.progress = -1; }
    else if (Math.abs(p.progress) < 0.995) p.owner = 'neutral';

    if (prevOwner !== p.owner && state.ui.toast) {
      if (p.owner === 'blue') state.ui.toast(`ELE GEÇİRİLDİ: ${p.name}`, 1800);
      else if (p.owner === 'red') state.ui.toast(`KAYBEDİLDİ: ${p.name}`, 1800);
    }
  }
}

/* ---------------------------------------------------------------
   Ana güncelleme
   --------------------------------------------------------------- */
export function updateCampaign(dt) {
  if (!campaign.current || state.phase !== 'playing') return;

  const rt = campaign.runtime;
  if (!rt) return;

  updateCapture(dt);
  updateCaptureMarkers(campaign.markers, { blue: CFG.teams.blue.main, red: CFG.teams.red.main });
  updateEconomy(dt);

  const done = updateProduction(dt);
  if (done) deployFromQueue(done);

  // dalgalar
  campaign.waveTimer -= dt;
  if (campaign.waveTimer <= 0) {
    spawnWave();
    const cfg = campaign.waveCfg;
    const interval = Math.max(CFG.waves.minInterval, cfg.interval - state.stats.wave * CFG.waves.rampPerWave);
    campaign.waveTimer = interval;
  }

  // düşman bombardımanı
  state.ai.enemyBomberTimer -= dt;
  if (state.ai.enemyBomberTimer <= 0) {
    state.ai.enemyBomberTimer = rand(38, 58);
    let tx = 0, tz = 0, cnt = 0;
    for (const u of state.units) {
      if (u.team === 'blue' && u.alive && u.kind !== 'bomber' && u.kind !== 'hq') { tx += u.pos.x; tz += u.pos.z; cnt++; }
    }
    if (cnt) callAirstrike('red', tx / cnt, tz / cnt, 2);
    else if (state.hq.blue) callAirstrike('red', state.hq.blue.pos.x, state.hq.blue.pos.z, 2);
    if (state.ui.toast) state.ui.toast('⚠ DÜŞMAN BOMBARDIMAN UÇAKLARI', 2200);
  }

  rt.update(dt);
  if (rt.status !== 'active' && campaign.endDelay <= 0) {
    campaign.endDelay = 1.6;
  }
  if (campaign.endDelay > 0) {
    campaign.endDelay -= dt;
    if (campaign.endDelay <= 0) finishMission(rt.status === 'success');
  }
}

/* ---------------------------------------------------------------
   Görev sonucu
   --------------------------------------------------------------- */
export function forceSuccess() {
  if (campaign.runtime) campaign.runtime.status = 'success';
}

export function finishMission(victory) {
  if (state.phase === 'over' || state.phase === 'victory') return;
  state.phase = victory ? 'victory' : 'over';
  campaign.result = { victory, stats: { ...state.stats }, mission: campaign.current };

  if (campaign.current) {
    const before = Save.isCompleted(campaign.current.id);
    Save.record(campaign.current, state.stats, victory);
    if (victory && !before && state.ui.toast) state.ui.toast('GÖREV TAMAMLANDI', 2400);
    if (victory && campaign.current.unlockReward && state.ui.toast) {
      const next = missionById(campaign.current.unlockReward);
      if (next) setTimeout(() => state.ui.toast(`KİLİT AÇILDI: ${next.name}`, 2600), 1200);
    }
  }
  if (state.ui.showResult) state.ui.showResult(campaign.result);
}

export { updateProduction, enqueueProduction, fmtTime };
