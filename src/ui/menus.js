/* ============================================================
   NEON FRONT 2.0 — menüler: görev seçimi, brifing, sonuç, ayarlar
   ============================================================ */
import { CFG } from '../config.js';
import { state } from '../core/state.js';
import { MISSIONS, missionById } from '../campaign/missions.js';
import { Save } from '../campaign/save.js';
import { rank, rankProgress, nextRank, xp } from '../systems/progression.js';
import { setPostFXEnabled, togglePostFXPass } from '../core/postfx.js';
import { fmtTime } from '../core/utils.js';

const M = { handlers: {} };

function $(id) { return document.getElementById(id); }
function show(node) { if (node) node.classList.remove('hidden'); }
function hide(node) { if (node) node.classList.add('hidden'); }

export function initMenus(handlers) {
  M.handlers = handlers || {};

  const btnStart = $('startBtn');
  if (btnStart) btnStart.addEventListener('click', () => { hide($('overlay-start')); showMissionSelect(); });

  const btnResume = $('resumeBtn');
  if (btnResume) btnResume.addEventListener('click', () => { hide($('overlay-pause')); state.paused = false; });

  const btnQuit = $('quitBtn');
  if (btnQuit) btnQuit.addEventListener('click', () => {
    hide($('overlay-pause')); state.paused = false;
    if (M.handlers.onMenu) M.handlers.onMenu();
  });

  const btnRestart = $('restartBtn');
  if (btnRestart) btnRestart.addEventListener('click', () => {
    hide($('overlay-end'));
    if (M.handlers.onRestart) M.handlers.onRestart();
  });

  const btnNextMission = $('nextMissionBtn');
  if (btnNextMission) btnNextMission.addEventListener('click', () => {
    hide($('overlay-end'));
    if (M.handlers.onNext) M.handlers.onNext();
  });

  const btnMenuEnd = $('menuFromEndBtn');
  if (btnMenuEnd) btnMenuEnd.addEventListener('click', () => {
    hide($('overlay-end'));
    if (M.handlers.onMenu) M.handlers.onMenu();
  });

  const btnSelect = $('menuFromPauseBtn');
  if (btnSelect) btnSelect.addEventListener('click', () => { hide($('overlay-pause')); if (M.handlers.onMenu) M.handlers.onMenu(); });

  const btnSettings = $('settingsBtn');
  if (btnSettings) btnSettings.addEventListener('click', () => showSettings());

  const btnSettingsClose = $('settingsCloseBtn');
  if (btnSettingsClose) btnSettingsClose.addEventListener('click', () => hide($('overlay-settings')));

  const btnReinforce = $('btnReinforce');
  if (btnReinforce) btnReinforce.addEventListener('click', () => { if (M.handlers.onAbility) M.handlers.onAbility('reinforce'); });
  const btnAirstrike = $('btnAirstrike');
  if (btnAirstrike) btnAirstrike.addEventListener('click', () => { if (M.handlers.onAbility) M.handlers.onAbility('airstrike'); });

  // ESC ile duraklat
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    const pause = $('overlay-pause');
    if (state.phase === 'playing') {
      state.paused = !state.paused;
      if (state.paused) show(pause); else hide(pause);
    } else if (pause && !pause.classList.contains('hidden')) {
      hide(pause); state.paused = false;
    }
  });

  buildSettingsToggles();
  return M;
}

/* ---------------------------------------------------------------
   Görev seçim ekranı
   --------------------------------------------------------------- */
export function showMissionSelect() {
  state.phase = 'menu';
  const r = rank();
  const list = $('missionList');
  if (list) {
    list.innerHTML = '';
    for (const mission of MISSIONS) {
      const unlocked = Save.isUnlocked(mission.id);
      const completed = Save.isCompleted(mission.id);
      const best = Save.data.best[mission.id];

      const card = document.createElement('button');
      card.className = 'mission-card' + (unlocked ? '' : ' locked') + (completed ? ' completed' : '');
      card.disabled = !unlocked;
      card.innerHTML = `
        <span class="mc-order">${String(mission.order).padStart(2, '0')}</span>
        <span class="mc-body">
          <span class="mc-name">${mission.name}</span>
          <span class="mc-sub">${mission.subtitle}</span>
          <span class="mc-meta">${unlocked
            ? (best ? `EN İYİ: ${fmtTime(best.time)} · ${best.kills} İMHA` : 'YENİ GÖREV')
            : '🔒 KİLİTLİ'}</span>
        </span>
        <span class="mc-badge">${completed ? '✔' : ''}</span>`;
      if (unlocked) card.addEventListener('click', () => showBriefing(mission.id));
      list.appendChild(card);
    }
  }

  const badge = $('rankBadge');
  if (badge) {
    const nr = nextRank();
    badge.innerHTML = `<b>${r.name}</b><span class="rank-bar"><i style="width:${(rankProgress() * 100).toFixed(0)}%"></i></span><small>${xp()} XP${nr ? ' · ' + nr.name + '\'e ' + (nr.min - xp()) : ''}</small>`;
  }

  const resetBtn = $('resetProgressBtn');
  if (resetBtn && !resetBtn._wired) {
    resetBtn._wired = true;
    resetBtn.addEventListener('click', () => {
      if (confirm('Tüm kampanya ilerlemesi silinsin mi?')) { Save.reset(); showMissionSelect(); }
    });
  }

  hide($('overlay-briefing'));
  hide($('overlay-end'));
  show($('overlay-missions'));
}

/* ---------------------------------------------------------------
   Brifing
   --------------------------------------------------------------- */
export function showBriefing(missionId) {
  const mission = missionById(missionId);
  if (!mission) return;
  state.phase = 'briefing';

  const title = $('briefingTitle');
  const sub = $('briefingSub');
  const text = $('briefingText');
  const objList = $('briefingObjectives');
  if (title) title.textContent = `${String(mission.order).padStart(2, '0')} · ${mission.name}`;
  if (sub) sub.textContent = mission.subtitle;
  if (text) text.textContent = mission.briefing;
  if (objList) {
    objList.innerHTML = mission.objectives.map((o) => `<li>${o.label}</li>`).join('');
  }

  const startBtn = $('briefingStartBtn');
  if (startBtn) {
    startBtn.onclick = () => {
      hide($('overlay-briefing'));
      hide($('overlay-missions'));
      if (M.handlers.onStart) M.handlers.onStart(mission.id);
    };
  }
  const backBtn = $('briefingBackBtn');
  if (backBtn) backBtn.onclick = () => { hide($('overlay-briefing')); showMissionSelect(); };

  hide($('overlay-missions'));
  show($('overlay-briefing'));
}

/* ---------------------------------------------------------------
   Sonuç ekranı
   --------------------------------------------------------------- */
export function showResult(result) {
  const { victory, stats, mission } = result;
  const title = $('endTitle');
  const tag = $('endTag');
  const sub = $('endSub');
  if (title) {
    title.textContent = victory ? 'ZAFER' : 'YENİLGİ';
    title.style.color = victory ? '#55e08a' : '#ff4d5e';
  }
  if (tag) tag.textContent = victory ? 'GÖREV TAMAMLANDI' : 'GÖREV BAŞARISIZ';
  if (sub) sub.textContent = victory ? `${mission.name} — bölge güvence altında.` : `${mission.name} — hat kaybedildi.`;

  setText('endKills', stats.kills);
  setText('endLost', stats.lost);
  setText('endWave', stats.wave);
  setText('endTime', fmtTime(stats.time));
  setText('endXp', `+${stats.kills * 6 + (victory ? 60 : 0)} XP`);

  const next = victory && mission.unlockReward ? missionById(mission.unlockReward) : null;
  const nextBtn = $('nextMissionBtn');
  if (nextBtn) nextBtn.style.display = next ? 'inline-flex' : 'none';

  show($('overlay-end'));
}

function setText(id, v) { const el = $(id); if (el) el.textContent = v; }

/* ---------------------------------------------------------------
   Ayarlar
   --------------------------------------------------------------- */
function buildSettingsToggles() {
  const items = [
    { key: 'postfx', label: 'Post-processing (genel)', get: () => state.settings.postfx, set: (v) => setPostFXEnabled(v) },
    { key: 'ssao', label: 'SSAO (ortam gölgesi)', get: () => state.settings.ssao, set: (v) => togglePostFXPass('ssao', v) },
    { key: 'bloom', label: 'Bloom', get: () => state.settings.bloom, set: (v) => togglePostFXPass('bloom', v) },
    { key: 'dof', label: 'Tilt-shift alan derinliği', get: () => state.settings.dof, set: (v) => togglePostFXPass('dof', v) },
    { key: 'grain', label: 'Film greni', get: () => state.settings.grain, set: (v) => togglePostFXPass('grain', v) }
  ];
  const wrap = $('settingsList');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = it.get();
    cb.addEventListener('change', () => it.set(cb.checked));
    const span = document.createElement('span');
    span.textContent = it.label;
    row.appendChild(cb); row.appendChild(span);
    wrap.appendChild(row);
  }
}

export function showSettings() {
  buildSettingsToggles();
  show($('overlay-settings'));
}

export function hideAll() {
  ['overlay-missions', 'overlay-briefing', 'overlay-end', 'overlay-pause', 'overlay-settings'].forEach((id) => hide($(id)));
}
