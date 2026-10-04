/* ============================================================
   NEON FRONT 2.0 — giriş noktası
   Motor + dünya + varlıklar + sistemler + arayüz bağlanır.
   ============================================================ */
import { CFG } from './config.js';
import { state } from './core/state.js';
import { initEngine, engine, updateCamera, focusShadow, onResize } from './core/engine.js';
import { loadAssets } from './core/assets.js';
import { initPostFX, renderFrame, resizePostFX } from './core/postfx.js';
import { initInput, updateCameraControls, selectUnits, focusSelection, pickGround } from './core/input.js';
import { buildTerrain, buildWalkGrid } from './world/terrain.js';
import { buildWater, updateWater } from './world/water.js';
import { buildScenery, buildBridge, buildDecor } from './world/scenery.js';
import { buildGrid } from './systems/pathfinding.js';
import { W, groundHeight } from './world/mapgen.js';
import { initParticles, updateParticles, pools } from './fx/particles.js';
import { initBillboards, updateBillboards } from './fx/billboards.js';
import { initDecals, updateRings, updateScorches, updateFlashes, updateGroundFires } from './fx/decals.js';
import { initProjectiles, updateBullets, updateBombs } from './fx/projectiles.js';
import { updateBoomQueue } from './fx/explosions.js';
import { callAirstrike, spawnTank } from './units/unit.js';
import { campaign, startMission, initCapturePoints, updateCampaign, forceSuccess } from './campaign/campaign.js';
import { Save } from './campaign/save.js';
import { initHUD, updateHUD, updateObjectives, updateSelectionUI, toast, requestBuild } from './ui/hud.js';
import { initMinimap, drawMinimap, enableMinimapClick } from './ui/minimap.js';
import { initMenus, showMissionSelect, showResult, showBriefing, hideAll } from './ui/menus.js';
import { rand, TAU } from './core/utils.js';

/* ---------- Akış ---------- */
let last = performance.now();
let fpsSmooth = 60;
let fpsAcc = 0, fpsFrames = 0;
let diagAcc = 0;

/* ===============================================================
   Boot
   =============================================================== */
async function boot() {
  const canvas = document.getElementById('scene');
  const loading = document.getElementById('loading');
  const loadBar = document.getElementById('loadBar');
  const loadText = document.getElementById('loadText');

  initEngine(canvas);
  initHUD();
  initMinimap();
  enableMinimapClick();

  const setProgress = (frac, text) => {
    if (loadBar) loadBar.style.width = (frac * 100).toFixed(1) + '%';
    if (loadText && text) loadText.textContent = text;
  };

  setProgress(0.05, 'Arazi dokuları hazırlanıyor…');

  /* ---- Dünya geometrisi ---- */
  buildTerrain(engine.scene);
  buildWalkGrid();
  buildGrid();
  buildWater(engine.scene);

  setProgress(0.2, 'CC0 PBR dokular ve modeller indiriliyor…');
  let assetInfo = { hasTextures: false, hasModels: false };
  try {
    assetInfo = await loadAssets((done, total, label) => {
      const frac = 0.2 + 0.62 * (done / Math.max(1, total));
      setProgress(frac, label);
    });
  } catch (e) {
    console.warn('Varlık yükleme hatası, prosedürel mod:', e);
  }

  setProgress(0.85, 'Orman, kaya ve dekor yerleştiriliyor…');
  buildScenery(engine.scene);
  buildBridge(engine.scene);
  buildDecor(engine.scene, [
    { x: W.half * 0.55, z: -W.half * 0.42 },
    { x: -W.half * 0.55, z: W.half * 0.42 }
  ]);

  /* ---- Efekt havuzları ---- */
  initParticles(engine.scene);
  initBillboards(engine.scene);
  initDecals(engine.scene);
  initProjectiles(engine.scene);
  state.pools = pools;

  /* ---- Ele geçirme noktaları ---- */
  initCapturePoints(engine.scene);

  setProgress(0.94, 'Sinematik post-processing derleniyor…');
  initPostFX();

  /* ---- Kayıt ---- */
  Save.load();

  /* ---- Girdi & menüler ---- */
  initInput(canvas, {
    canAct: () => state.phase === 'playing' && !state.paused,
    onSelect: (list, additive) => { selectUnits(list, additive); updateSelectionUI(); },
    onMove: (x, z) => {
      for (const u of state.selected) {
        if (u.kind === 'hq' || u.kind === 'bomber') continue;
        const ang = rand(0, TAU);
        const rr = state.selected.length > 1 ? 6 + Math.random() * 9 : 0;
        u.orderMove(x + Math.cos(ang) * rr, z + Math.sin(ang) * rr);
      }
    },
    onAttack: (tgt) => {
      for (const u of state.selected) {
        if (u.kind === 'hq' || u.kind === 'bomber') continue;
        u.orderAttack(tgt);
      }
    },
    onFocus: () => focusSelection(),
    onSelectAll: () => {
      const list = state.units.filter((u) => u.alive && u.team === 'blue' && u.kind !== 'hq' && u.kind !== 'bomber');
      selectUnits(list, false); updateSelectionUI();
    },
    onBuildKey: (n) => {
      const order = ['tank', 'artillery', 'infantry', 'helicopter'];
      if (order[n - 1]) requestBuild(order[n - 1]);
    },
    onAbility: (which) => useAbility(which)
  });

  initMenus({
    onStart: (id) => { hideAll(); startMission(id); },
    onRestart: () => { if (campaign.current) startMission(campaign.current.id); },
    onNext: () => {
      const next = campaign.current && campaign.current.unlockReward;
      if (next) startMission(next); else showMissionSelect();
    },
    onMenu: () => { showMissionSelect(); },
    onAbility: (which) => useAbility(which)
  });

  /* ---- Kampanya → arayüz köprüsü ---- */
  state.ui.toast = toast;
  state.ui.showResult = (result) => { setTimeout(() => showResult(result), 250); };
  state.ui.onMissionStart = (mission) => {
    updateObjectives(campaign.runtime);
    toast(`${mission.name} BAŞLADI`, 2200);
  };

  /* ---- Pencere olayları ---- */
  window.addEventListener('resize', () => {
    onResize();
    resizePostFX(window.innerWidth, window.innerHeight);
  });

  setProgress(1, 'Hazır.');
  if (loading) loading.classList.add('fade');

  /* ---- Menü ekranı ---- */
  state.phase = 'menu';
  showMissionSelect();

  /* ---- Teşhis köprüsü tamamlayıcı ---- */
  if (state.diag) {
    state.diag.assets = assetInfo;
    state.diag.campaign = () => ({
      mission: campaign.current ? campaign.current.id : null,
      status: campaign.runtime ? campaign.runtime.status : null
    });
    state.diag.forceSuccess = forceSuccess;
  }

  requestAnimationFrame(frame);
}

/* ===============================================================
   Yetenekler
   =============================================================== */
function useAbility(which) {
  if (state.phase !== 'playing' || state.paused) return;
  if (which === 'reinforce') {
    if (state.ai.reinforceCd > 0) return;
    state.ai.reinforceCd = CFG.abilities.reinforce.cd;
    const hq = state.hq.blue;
    const cx = hq ? hq.pos.x : state.cam.focus.x;
    const cz = hq ? hq.pos.z : state.cam.focus.z;
    for (let i = 0; i < 3; i++) {
      const ang = rand(0, TAU);
      const x = cx + Math.cos(ang) * rand(14, 22);
      const z = cz + Math.sin(ang) * rand(14, 22);
      spawnTank('blue', x, z, {});
    }
    toast('TAKVİYE İNDİ — 3 TANK', 1800);
    return;
  }
  if (which === 'airstrike') {
    if (state.ai.airstrikeCd > 0) return;
    state.ai.airstrikeCd = CFG.abilities.airstrike.cd;
    const g = pickGround(state.mouse.x, state.mouse.y);
    const x = g ? g.x : state.cam.focus.x;
    const z = g ? g.z : state.cam.focus.z;
    callAirstrike('blue', x, z, 3);
    toast('HAVA SALDIRISI TALEP EDİLDİ', 1800);
  }
}

/* ===============================================================
   Ana döngü
   =============================================================== */
function frame(now) {
  requestAnimationFrame(frame);
  try {
    frameBody(now);
  } catch (err) {
    if (!state.diag._frameError) {
      state.diag._frameError = String((err && err.stack) || err);
      console.error('Kare hatası:', err);
    }
  }
}

function frameBody(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0) || dt > 0.1) dt = 0.016;

  /* FPS ölçümü */
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.4) { fpsSmooth = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }

  const live = state.phase === 'playing' && !state.paused;

  if (live) {
    state.stats.time += dt;

    /* Yetenek bekleme süreleri */
    if (state.ai.reinforceCd > 0) state.ai.reinforceCd = Math.max(0, state.ai.reinforceCd - dt);
    if (state.ai.airstrikeCd > 0) state.ai.airstrikeCd = Math.max(0, state.ai.airstrikeCd - dt);

    updateCampaign(dt);
    updateCameraControls(dt);

    const list = state.units.slice();
    for (const u of list) if (u.alive) u.update(dt);

    updateBullets(dt);
    updateBombs(dt);
    updateParticles(dt);
    updateBillboards(dt);
    updateRings(dt);
    updateScorches(dt);
    updateFlashes(dt);
    updateGroundFires(dt, pools);
    updateBoomQueue(dt);
    updateWater(dt);
  }

  updateCamera(dt);
  focusShadow(state.cam.focus);
  renderFrame(dt);

  drawMinimap();
  updateHUD(fpsSmooth);
  if (campaign.runtime) updateObjectives(campaign.runtime);

  /* Teşhis güncelleme */
  diagAcc += dt;
  if (state.diag && diagAcc > 0.25) {
    diagAcc = 0;
    const info = engine.renderer.info;
    state.diag.programs = info.programs ? info.programs.length : 0;
    state.diag.calls = info.render.calls;
    state.diag.tris = info.render.triangles;
    state.diag.fps = fpsSmooth;
    state.diag.frameMs = dt * 1000;
  }
}

/* ---------- Başlat ---------- */
function start() {
  window.__BOOT_ERR = null;
  boot().catch((err) => {
    console.error('Başlatma hatası:', err);
    window.__BOOT_ERR = String((err && err.stack) || err);
    const t = document.getElementById('loadText');
    if (t) t.textContent = 'BAŞLATMA HATASI: ' + (err && err.message ? err.message : err);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
