/* ============================================================
   NEON FRONT 2.0 — HUD: kaynaklar, istatistik, seçim, üretim paneli,
   görev hedefleri, yetenek bekleme süreleri.
   ============================================================ */
import { CFG } from '../config.js';
import { state } from '../core/state.js';
import { clamp, fmtTime } from '../core/utils.js';
import { productionProgress, canAfford, enqueueProduction } from '../systems/economy.js';

export const hud = { el: {}, buildButtons: [] };

function $(id) { return document.getElementById(id); }

export function initHUD() {
  const el = hud.el;
  el.toast = $('toast');
  el.statWave = $('statWave');
  el.statKills = $('statKills');
  el.statLost = $('statLost');
  el.statUnits = $('statUnits');
  el.statFps = $('statFps');
  el.statTime = $('statTime');
  el.selCount = $('selCount');
  el.selHpFill = $('selHpFill');
  el.selHint = $('selHint');
  el.cdReinforce = $('cdReinforce');
  el.cdAirstrike = $('cdAirstrike');
  el.btnReinforce = $('btnReinforce');
  el.btnAirstrike = $('btnAirstrike');
  el.hqBlueFill = $('hqBlueFill');
  el.hqBluePct = $('hqBluePct');
  el.hqRedFill = $('hqRedFill');
  el.hqRedPct = $('hqRedPct');
  el.resSupply = $('resSupply');
  el.resFuel = $('resFuel');
  el.resAmmo = $('resAmmo');
  el.income = $('resIncome');
  el.objectives = $('objectiveList');
  el.missionName = $('missionName');
  el.buildList = $('buildList');
  el.prodBar = $('prodBar');
  el.prodLabel = $('prodLabel');
  el.timeLeft = $('missionClock');

  buildProductionPanel();
  return hud;
}

/* ---------- Üretim paneli ---------- */
const BUILDABLE = ['tank', 'artillery', 'infantry', 'helicopter'];

function buildProductionPanel() {
  const list = hud.el.buildList;
  if (!list) return;
  list.innerHTML = '';
  hud.buildButtons = [];
  BUILDABLE.forEach((kind, i) => {
    const def = CFG.units[kind];
    const btn = document.createElement('button');
    btn.className = 'build-card';
    btn.innerHTML = `
      <span class="bc-key">${i + 1}</span>
      <span class="bc-icon bc-${kind}"></span>
      <span class="bc-name">${def.label}</span>
      <span class="bc-cost">
        <i class="r-sup"></i>${def.cost.supply}
        <i class="r-fuel"></i>${def.cost.fuel}
        <i class="r-ammo"></i>${def.cost.ammo}
      </span>`;
    btn.addEventListener('click', () => requestBuild(kind));
    list.appendChild(btn);
    hud.buildButtons.push({ kind, node: btn });
  });
}

export function requestBuild(kind) {
  if (state.phase !== 'playing') return;
  const res = enqueueProduction(kind);
  if (res.ok) {
    if (state.ui.toast) state.ui.toast(`${CFG.units[kind].label} ÜRETİM KUYRUĞUNDA`, 1500);
  } else if (state.ui.toast) {
    state.ui.toast(res.reason, 1500);
  }
}

/* ---------- Toast ---------- */
let toastTimer = null;
export function toast(msg, dur) {
  const el = hud.el.toast;
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur || 2000);
}

/* ---------- Seçim ---------- */
export function updateSelectionUI() {
  const el = hud.el;
  if (!el.selCount) return;
  el.selCount.textContent = state.selected.length;
  if (!state.selected.length) {
    el.selHpFill.style.width = '0%';
    el.selHint.textContent = 'Bir birime tıkla veya sol tuşla alan seç';
    return;
  }
  let hp = 0, max = 0;
  for (const s of state.selected) { hp += s.hp; max += s.maxHp; }
  el.selHpFill.style.width = (clamp(hp / Math.max(1, max), 0, 1) * 100).toFixed(1) + '%';
  el.selHint.textContent = state.selected.length === 1
    ? 'Sağ tık: hareket · düşmana sağ tık: saldırı'
    : `${state.selected.length} birlik seçili`;
}

/* ---------- Bekleme süreleri ---------- */
function updateCD(node, btn, cd, total) {
  if (!node || !btn) return;
  node.style.width = (clamp(1 - cd / total, 0, 1) * 100).toFixed(1) + '%';
  if (cd > 0) btn.classList.add('cooling'); else btn.classList.remove('cooling');
  btn.disabled = cd > 0 || state.phase !== 'playing';
}

export function updateHUD(fps) {
  const el = hud.el;
  const s = state.stats;
  if (el.statWave) el.statWave.textContent = s.wave;
  if (el.statKills) el.statKills.textContent = s.kills;
  if (el.statLost) el.statLost.textContent = s.lost;
  if (el.statUnits) {
    el.statUnits.textContent = state.units.filter((u) => u.alive && u.team === 'blue' && u.kind !== 'hq' && u.kind !== 'bomber').length;
  }
  if (el.statTime) el.statTime.textContent = fmtTime(s.time);
  if (el.statFps) el.statFps.textContent = Math.round(fps);

  const r = state.resources;
  if (el.resSupply) el.resSupply.textContent = Math.floor(r.supply);
  if (el.resFuel) el.resFuel.textContent = Math.floor(r.fuel);
  if (el.resAmmo) el.resAmmo.textContent = Math.floor(r.ammo);
  if (el.income && state._income) {
    el.income.textContent = `+${state._income.supply.toFixed(0)} / ${state._income.fuel.toFixed(0)} / ${state._income.ammo.toFixed(0)} sn`;
  }

  const bf = state.hq.blue && state.hq.blue.alive ? clamp(state.hq.blue.hp / state.hq.blue.maxHp, 0, 1) : 0;
  const rf = state.hq.red && state.hq.red.alive ? clamp(state.hq.red.hp / state.hq.red.maxHp, 0, 1) : 0;
  if (el.hqBlueFill) el.hqBlueFill.style.width = (bf * 100).toFixed(1) + '%';
  if (el.hqRedFill) el.hqRedFill.style.width = (rf * 100).toFixed(1) + '%';
  if (el.hqBluePct) el.hqBluePct.textContent = Math.round(bf * 100) + '%';
  if (el.hqRedPct) el.hqRedPct.textContent = Math.round(rf * 100) + '%';

  updateCD(el.cdReinforce, el.btnReinforce, state.ai.reinforceCd, CFG.abilities.reinforce.cd);
  updateCD(el.cdAirstrike, el.btnAirstrike, state.ai.airstrikeCd, CFG.abilities.airstrike.cd);

  for (const b of hud.buildButtons) {
    const def = CFG.units[b.kind];
    const ok = canAfford(def.cost) && state.phase === 'playing';
    b.node.classList.toggle('disabled', !ok);
  }

  const p = productionProgress();
  if (el.prodBar) {
    if (p) {
      el.prodBar.style.display = 'block';
      el.prodBar.style.width = (p.frac * 100).toFixed(1) + '%';
      if (el.prodLabel) el.prodLabel.textContent = `ÜRETİM: ${CFG.units[p.kind].label}`;
    } else {
      el.prodBar.style.display = 'none';
    }
  }
}

/* ---------- Görev hedefleri ---------- */
export function updateObjectives(runtime) {
  const list = hud.el.objectives;
  if (!list) return;
  if (!runtime) { list.innerHTML = ''; return; }
  const summary = runtime.summary();
  list.innerHTML = summary.map((o) =>
    `<li class="${o.done ? 'done' : ''}"><span class="obj-box">${o.done ? '✔' : ''}</span>${o.text}</li>`
  ).join('');
  if (hud.el.missionName) hud.el.missionName.textContent = runtime.mission.name;
  if (hud.el.timeLeft) {
    const tl = runtime.timeLeft();
    hud.el.timeLeft.textContent = tl === null ? fmtTime(runtime.time) : fmtTime(tl);
  }
}
