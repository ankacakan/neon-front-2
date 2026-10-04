/* ============================================================
   NEON ARENA // SURVIVAL  —  game.js
   Saf JavaScript (ES2020) • Sıfır bağımlılık • HTML5 Canvas API
   Tüm görseller Canvas ile çizilir, tüm sesler Web Audio ile üretilir.
   ============================================================ */
'use strict';

/* ============================================================
   1) YARDIMCILAR
   ============================================================ */
const rand    = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp   = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp    = (a, b, t) => a + (b - a) * t;
const dist2   = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const pick    = (arr) => arr[(Math.random() * arr.length) | 0];
const fmtTime = (s) => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
};

/* ============================================================
   2) CANVAS & EKRAN
   ============================================================ */
const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');

let viewW = 0, viewH = 0, DPR = 1;

function resize() {
  DPR   = Math.min(window.devicePixelRatio || 1, 2);
  viewW = canvas.clientWidth  || window.innerWidth;
  viewH = canvas.clientHeight || window.innerHeight;
  canvas.width  = Math.max(1, Math.floor(viewW * DPR));
  canvas.height = Math.max(1, Math.floor(viewH * DPR));
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);

/* ============================================================
   3) SES (Web Audio ile üretilen retro blip'ler — dosya yok)
   ============================================================ */
const sfx = (() => {
  let ac = null;
  let master = null;
  let enabled = true;

  function init() {
    if (ac) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { enabled = false; return; }
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.22;
      master.connect(ac.destination);
    } catch (e) { enabled = false; }
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (!enabled) return;
    init();
    if (!ac || ac.state === 'suspended') { if (ac) ac.resume(); }
    if (!ac) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol || 0.3), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function noise(dur, vol) {
    if (!enabled) return;
    init();
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    const g   = ac.createGain();
    g.gain.value = vol || 0.25;
    src.buffer = buf; src.connect(g); g.connect(master); src.start();
  }

  return {
    init,
    shoot:    () => tone(rand(620, 760), 0.05, 'square', 0.12, 300),
    hit:      () => tone(rand(220, 280), 0.04, 'square', 0.10, 140),
    kill:     () => { noise(0.10, 0.16); tone(160, 0.10, 'sawtooth', 0.14, 60); },
    pickup:   () => tone(880, 0.06, 'triangle', 0.14, 1320),
    levelUp:  () => { tone(523, 0.10, 'square', 0.22); setTimeout(() => tone(659, 0.10, 'square', 0.22), 90); setTimeout(() => tone(880, 0.20, 'square', 0.24), 180); },
    hurt:     () => { noise(0.16, 0.3); tone(140, 0.18, 'sawtooth', 0.25, 60); },
    gameOver: () => { tone(320, 0.25, 'sawtooth', 0.28, 180); setTimeout(() => tone(200, 0.35, 'sawtooth', 0.28, 80), 200); setTimeout(() => tone(110, 0.6, 'sawtooth', 0.3, 50), 480); },
    boss:     () => { tone(80, 0.7, 'sawtooth', 0.3, 40); noise(0.5, 0.2); },
  };
})();

/* ============================================================
   4) GİRDİ (Klavye + Fare)
   ============================================================ */
const keys  = Object.create(null);
const mouse = { x: 0, y: 0, active: false };

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function updateMouseFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
  mouse.active = true;
}
canvas.addEventListener('mousemove', updateMouseFromEvent);
canvas.addEventListener('touchmove', (e) => {
  if (e.touches[0]) updateMouseFromEvent(e.touches[0]);
}, { passive: true });
canvas.addEventListener('touchstart', (e) => {
  if (e.touches[0]) updateMouseFromEvent(e.touches[0]);
}, { passive: true });

/* ============================================================
   5) OYUN DURUMU
   ============================================================ */
const STATE = { MENU: 'menu', PLAY: 'play', LEVELUP: 'levelup', PAUSE: 'pause', OVER: 'over' };
let state = STATE.MENU;

let player, enemies, bullets, orbs, particles, floaters, rings;
let camX = 0, camY = 0;
let shakeAmount = 0, shakeX = 0, shakeY = 0;
let nextId = 1;

let time, score, kills, spawnTimer, bossTimer, pendingLevels, elapsedSinceLevel;

const BEST_KEY = 'neonArenaSurvival_best';

/* ---------- HUD elemanları ---------- */
const el = {
  hpBar:       document.getElementById('hpBar'),
  hpText:      document.getElementById('hpText'),
  xpBar:       document.getElementById('xpBar'),
  levelText:   document.getElementById('levelText'),
  scoreText:   document.getElementById('scoreText'),
  timeText:    document.getElementById('timeText'),
  perkStrip:   document.getElementById('perkStrip'),
  dangerValue: document.getElementById('dangerValue'),
  hud:         document.getElementById('hud'),

  menu:        document.getElementById('menu'),
  levelup:     document.getElementById('levelup'),
  levelupSub:  document.getElementById('levelupSub'),
  upgradeCards: document.getElementById('upgradeCards'),
  pause:       document.getElementById('pause'),
  gameover:    document.getElementById('gameover'),

  finalScore:  document.getElementById('finalScore'),
  finalTime:   document.getElementById('finalTime'),
  finalLevel:  document.getElementById('finalLevel'),
  finalKills:  document.getElementById('finalKills'),
  bestScore:   document.getElementById('bestScore'),

  startBtn:    document.getElementById('startBtn'),
  retryBtn:    document.getElementById('retryBtn'),
  menuBtn:     document.getElementById('menuBtn'),
  resumeBtn:   document.getElementById('resumeBtn'),
  pauseQuitBtn: document.getElementById('pauseQuitBtn'),
};

/* ============================================================
   6) DÜŞMAN TÜRLERİ
   ============================================================ */
const ENEMY_TYPES = {
  grunt:  { r: 13, hp: 12,  speed: 58,  color: '#39ff8f', dmg: 8,  score: 10,  xp: 1, shape: 'square' },
  runner: { r: 10, hp: 8,   speed: 118, color: '#ff3df0', dmg: 6,  score: 14,  xp: 1, shape: 'diamond' },
  tank:   { r: 20, hp: 55,  speed: 42,  color: '#ffb020', dmg: 14, score: 26,  xp: 3, shape: 'square' },
  brute:  { r: 27, hp: 120, speed: 50,  color: '#ff4d5e', dmg: 20, score: 45,  xp: 5, shape: 'square' },
  wraith: { r: 15, hp: 30,  speed: 78,  color: '#b06bff', dmg: 11, score: 30,  xp: 3, shape: 'diamond' },
  boss:   { r: 44, hp: 900, speed: 40,  color: '#ffd23d', dmg: 26, score: 600, xp: 40, shape: 'boss' },
};

/* ============================================================
   7) YÜKSELTME HAVUZU
   ============================================================ */
const UPGRADES = [
  { id: 'dmg',    icon: '💥', name: 'GÜÇLÜ MERMİ',   desc: 'Mermi hasarı +30%',                 max: 8,
    apply: (p) => { p.damage *= 1.30; } },
  { id: 'rof',    icon: '⚡', name: 'HIZLI TETİK',    desc: 'Ateş hızı +18%',                    max: 8,
    apply: (p) => { p.fireInterval = Math.max(0.055, p.fireInterval * 0.82); } },
  { id: 'multi',  icon: '🔱', name: 'ÇOK NAMLU',      desc: '+1 mermi (yayılım)',                max: 6,
    apply: (p) => { p.bulletCount += 1; } },
  { id: 'bspd',   icon: '🚀', name: 'İVME',           desc: 'Mermi hızı +25%',                   max: 5,
    apply: (p) => { p.bulletSpeed *= 1.25; } },
  { id: 'bsize',  icon: '🔵', name: 'BÜYÜK MERMİ',    desc: 'Mermi boyutu +25%',                 max: 5,
    apply: (p) => { p.bulletSize *= 1.25; } },
  { id: 'pierce', icon: '🎯', name: 'DELİCİ',         desc: 'Mermiler +1 düşmanı deler',         max: 5,
    apply: (p) => { p.pierce += 1; } },
  { id: 'speed',  icon: '👟', name: 'ÇEVİK',          desc: 'Hareket hızı +12%',                 max: 6,
    apply: (p) => { p.speed *= 1.12; } },
  { id: 'hp',     icon: '❤️', name: 'DAYANIKLILIK',   desc: 'Maks. can +25 ve iyileş',           max: 8,
    apply: (p) => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
  { id: 'regen',  icon: '✚',  name: 'YENİLENME',      desc: 'Saniyede +0.8 can yenilenmesi',     max: 5,
    apply: (p) => { p.regen += 0.8; } },
  { id: 'magnet', icon: '🧲', name: 'MIKNATIS',       desc: 'XP toplama alanı +40%',             max: 5,
    apply: (p) => { p.magnet *= 1.4; } },
  { id: 'xp',     icon: '⭐', name: 'BİLGELİK',       desc: 'Kazanılan XP +25%',                 max: 5,
    apply: (p) => { p.xpMult *= 1.25; } },
  { id: 'lifestl',icon: '🩸', name: 'VAMPİR',         desc: 'Her öldürmede +0.4 can',            max: 5,
    apply: (p) => { p.lifesteal += 0.4; } },
];
const upgradeStacks = Object.create(null);

function rollUpgrades(n) {
  const pool = UPGRADES.filter((u) => (upgradeStacks[u.id] || 0) < u.max);
  const out = [];
  const copy = pool.slice();
  while (out.length < n && copy.length) {
    const i = (Math.random() * copy.length) | 0;
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

/* ============================================================
   8) KURULUM / SIFIRLAMA
   ============================================================ */
function createPlayer() {
  return {
    x: 0, y: 0, r: 15, vx: 0, vy: 0,
    speed: 235,
    hp: 100, maxHp: 100,
    level: 1, xp: 0, xpNext: xpNeededFor(1),
    fireInterval: 0.42, fireCd: 0,
    damage: 10,
    bulletSpeed: 640,
    bulletSize: 5,
    bulletCount: 1,
    pierce: 0,
    magnet: 110,
    xpMult: 1,
    regen: 0,
    lifesteal: 0,
    invuln: 0,
    hurtFlash: 0,
    aimAngle: 0,
    shotsFired: 0,
  };
}

function resetGame() {
  player  = createPlayer();
  enemies = [];
  bullets = [];
  orbs    = [];
  particles = [];
  floaters = [];
  rings   = [];

  camX = -viewW / 2; camY = -viewH / 2;
  shakeAmount = 0; shakeX = 0; shakeY = 0;
  nextId = 1;

  time = 0; score = 0; kills = 0;
  spawnTimer = 0; bossTimer = 45;
  pendingLevels = 0; elapsedSinceLevel = 0;

  for (const k in upgradeStacks) delete upgradeStacks[k];

  mouse.x = viewW / 2;
  mouse.y = viewH / 2;

  resize();
  renderPerks();
  updateHUD(true);
}

/* ============================================================
   9) ZORLUK EĞRİSİ
   ============================================================ */
function difficulty() { return 1 + time / 42; }

function spawnInterval() {
  return clamp(1.05 - time * 0.011, 0.10, 1.05) / (1 + time / 260);
}

function enemyStatScale() {
  return 1 + time / 58;
}

/* ============================================================
   10) SPAWN FONKSİYONLARI
   ============================================================ */
function spawnPositionAwayFromPlayer(extra) {
  const pad = Math.max(viewW, viewH) * 0.62 + 90 + (extra || 0);
  const a = rand(0, Math.PI * 2);
  return { x: player.x + Math.cos(a) * pad, y: player.y + Math.sin(a) * pad };
}

function spawnEnemy(typeKey, overrideX, overrideY) {
  if (enemies.length > 420) return;
  const base = ENEMY_TYPES[typeKey];
  const scale = enemyStatScale();
  const p = (overrideX === undefined)
    ? spawnPositionAwayFromPlayer(0)
    : { x: overrideX, y: overrideY };

  const hp = Math.round(base.hp * (typeKey === 'boss' ? 1 + time / 40 : scale));
  const speed = base.speed * clamp(1 + time / 320, 1, 1.75);

  enemies.push({
    id: nextId++,
    type: typeKey,
    x: p.x, y: p.y,
    r: base.r,
    hp, maxHp: hp,
    speed: speed * rand(0.9, 1.1),
    color: base.color,
    dmg: base.dmg,
    scoreValue: base.score,
    xpValue: base.xp,
    shape: base.shape,
    flash: 0,
    touchCd: 0,
    wobble: rand(0, Math.PI * 2),
    knockX: 0, knockY: 0,
  });
}

function spawnRandomWave() {
  const d = difficulty();
  const roll = Math.random();
  let count = 1;
  if (d > 2.2) count = randInt(1, 2);
  if (d > 4.5) count = randInt(1, 3);
  if (d > 8)   count = randInt(2, 4);

  for (let i = 0; i < count; i++) {
    let type = 'grunt';
    if (time > 20 && roll < 0.28) type = 'runner';
    if (time > 45 && roll > 0.86) type = 'tank';
    if (time > 70 && roll > 0.94) type = 'wraith';
    if (time > 100 && roll > 0.975) type = 'brute';
    spawnEnemy(type);
  }
}

function spawnBoss() {
  const p = spawnPositionAwayFromPlayer(60);
  spawnEnemy('boss', p.x, p.y);
  sfx.boss();
  pushFloater(player.x, player.y - 60, '⚠ BOSS GELDİ!', '#ffd23d', 22);
  addRing(p.x, p.y, '#ffd23d', 220);
}

/* ============================================================
   11) EFEKTLER
   ============================================================ */
function addParticles(x, y, color, count, power) {
  if (particles.length > 900) return;
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(30, 60) * (power || 1);
    particles.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.25, 0.7), maxLife: 0.7,
      size: rand(2, 5), color,
    });
  }
}

function pushFloater(x, y, text, color, size) {
  if (floaters.length > 160) return;
  floaters.push({ x, y, text, color, size: size || 13, life: 0.85, vy: -46, vx: rand(-14, 14) });
}

function addRing(x, y, color, maxR) {
  rings.push({ x, y, r: 8, maxR: maxR || 90, color, life: 0.5 });
}

function shake(amount) { shakeAmount = Math.min(26, shakeAmount + amount); }

/* ============================================================
   12) XP & SEVİYE
   ============================================================ */
function xpNeededFor(level) {
  return Math.floor(7 + level * 5 + Math.pow(level, 1.55));
}

function gainXp(amount) {
  player.xp += amount * player.xpMult;
  let leveled = false;
  while (player.xp >= player.xpNext) {
    player.xp -= player.xpNext;
    player.level++;
    player.xpNext = xpNeededFor(player.level);
    pendingLevels++;
    leveled = true;
    addRing(player.x, player.y, '#4df2ff', 130);
    addParticles(player.x, player.y, '#4df2ff', 22, 1.4);
  }
  if (leveled) {
    sfx.levelUp();
    player.hp = Math.min(player.maxHp, player.hp + 6);
    openLevelUp();
  }
}

/* ============================================================
   13) GÜNCELLEME DÖNGÜSÜ
   ============================================================ */
function update(dt) {
  time += dt;
  elapsedSinceLevel += dt;

  /* ---- Oyuncu hareketi ---- */
  let ix = 0, iy = 0;
  if (keys['KeyA'] || keys['ArrowLeft'])  ix -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (keys['KeyW'] || keys['ArrowUp'])    iy -= 1;
  if (keys['KeyS'] || keys['ArrowDown'])  iy += 1;

  const len = Math.hypot(ix, iy);
  if (len > 0) { ix /= len; iy /= len; }

  const targetVx = ix * player.speed;
  const targetVy = iy * player.speed;
  player.vx = lerp(player.vx, targetVx, 1 - Math.pow(0.0009, dt));
  player.vy = lerp(player.vy, targetVy, 1 - Math.pow(0.0009, dt));

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  if (player.hurtFlash > 0) player.hurtFlash -= dt;
  if (player.invuln > 0)    player.invuln -= dt;

  /* ---- Yenilenme ---- */
  if (player.regen > 0 && player.hp < player.maxHp) {
    player.hp = Math.min(player.maxHp, player.hp + player.regen * dt);
  }

  /* ---- Skor: hayatta kaldıkça artar ---- */
  score += dt * (2 + difficulty() * 0.6);

  /* ---- Nişan (fare) ---- */
  const wx = mouse.x + camX;
  const wy = mouse.y + camY;
  player.aimAngle = Math.atan2(wy - player.y, wx - player.x);

  /* ---- Otomatik ateş ---- */
  player.fireCd -= dt;
  if (player.fireCd <= 0) {
    player.fireCd += player.fireInterval;
    if (player.fireCd < 0) player.fireCd = player.fireInterval;
    fire();
  }

  /* ---- Düşman üretimi ---- */
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = spawnInterval();
    spawnRandomWave();
  }
  bossTimer -= dt;
  if (bossTimer <= 0) {
    bossTimer = 50 + rand(0, 10);
    spawnBoss();
  }

  updateBullets(dt);
  updateEnemies(dt);
  updateOrbs(dt);
  updateParticles(dt);
  updateFloaters(dt);
  updateRings(dt);

  /* ---- Kamera ---- */
  const targetCamX = player.x - viewW / 2;
  const targetCamY = player.y - viewH / 2;
  camX = lerp(camX, targetCamX, 1 - Math.pow(0.001, dt));
  camY = lerp(camY, targetCamY, 1 - Math.pow(0.001, dt));

  /* ---- Ekran sarsıntısı ---- */
  shakeAmount *= Math.pow(0.0015, dt);
  if (shakeAmount < 0.15) shakeAmount = 0;
  shakeX = rand(-shakeAmount, shakeAmount);
  shakeY = rand(-shakeAmount, shakeAmount);

  updateHUD(false);
}

/* ---------- Ateş etme ---------- */
function fire() {
  const n = player.bulletCount;
  const spread = n > 1 ? 0.13 : 0;
  const base = player.aimAngle;

  for (let i = 0; i < n; i++) {
    const offset = (i - (n - 1) / 2) * spread;
    const a = base + offset;
    bullets.push({
      x: player.x + Math.cos(a) * (player.r + 6),
      y: player.y + Math.sin(a) * (player.r + 6),
      vx: Math.cos(a) * player.bulletSpeed,
      vy: Math.sin(a) * player.bulletSpeed,
      r: player.bulletSize,
      damage: player.damage,
      pierce: player.pierce,
      life: 1.5,
      angle: a,
      hitIds: null,
    });
  }
  player.shotsFired++;
  sfx.shoot();
}

/* ---------- Mermiler ---------- */
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;

    if (b.life <= 0) { bullets.splice(i, 1); continue; }

    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      const rr = (b.r + e.r);
      if (dist2(b.x, b.y, e.x, e.y) <= rr * rr) {
        if (b.hitIds && b.hitIds.has(e.id)) continue;
        damageEnemy(e, b.damage, b.x, b.y);

        if (b.pierce > 0) {
          b.pierce--;
          if (!b.hitIds) b.hitIds = new Set();
          b.hitIds.add(e.id);
        } else {
          bullets.splice(i, 1);
        }
        break;
      }
    }
  }
}

/* ---------- Düşman hasarı ---------- */
function damageEnemy(e, dmg, hx, hy) {
  e.hp -= dmg;
  e.flash = 0.12;
  addParticles(hx, hy, e.color, 4, 0.7);
  sfx.hit();

  if (Math.random() < 0.55) pushFloater(e.x + rand(-6, 6), e.y - e.r, String(Math.round(dmg)), '#ffd23d', 12);

  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  const idx = enemies.indexOf(e);
  if (idx === -1) return;
  enemies.splice(idx, 1);

  kills++;
  score += e.scoreValue;
  addParticles(e.x, e.y, e.color, e.type === 'boss' ? 60 : 14, e.type === 'boss' ? 2.6 : 1.2);
  sfx.kill();

  if (e.type === 'boss') {
    shake(22);
    addRing(e.x, e.y, '#ffd23d', 260);
    pushFloater(e.x, e.y - 40, 'BOSS YOK EDİLDİ!', '#ffd23d', 20);
  } else {
    shake(2.5);
  }

  if (player.lifesteal > 0) player.hp = Math.min(player.maxHp, player.hp + player.lifesteal);

  /* XP kutuları (altın sarısı) — boss daha çok düşürür */
  const orbCount = e.type === 'boss' ? 14 : (e.type === 'brute' ? 3 : 1);
  for (let i = 0; i < orbCount; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(20, 70);
    orbs.push({
      x: e.x, y: e.y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: e.type === 'boss' ? 7 : 5,
      value: Math.ceil(e.xpValue / orbCount),
      bob: rand(0, Math.PI * 2),
      life: 26,
    });
  }
}

/* ---------- Düşmanlar ---------- */
function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.flash > 0) e.flash -= dt;
    if (e.touchCd > 0) e.touchCd -= dt;

    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d  = Math.hypot(dx, dy) || 1;

    /* Hafif dalgalı takip (retro sürü hissi) */
    e.wobble += dt * (e.type === 'runner' ? 9 : 4);
    const wob = Math.sin(e.wobble) * 0.18;
    const nx = dx / d, ny = dy / d;
    const px = -ny, py = nx;

    /* Geri tepme (knockback) */
    e.knockX *= Math.pow(0.002, dt);
    e.knockY *= Math.pow(0.002, dt);

    e.x += (nx + px * wob) * e.speed * dt + e.knockX * dt;
    e.y += (ny + py * wob) * e.speed * dt + e.knockY * dt;

    /* Oyuncuya temas hasarı */
    const rr = e.r + player.r;
    if (d <= rr && e.touchCd <= 0) {
      e.touchCd = 0.75;
      damagePlayer(e.dmg, nx, ny);
    }
  }
}

/* ---------- Oyuncu hasarı ---------- */
function damagePlayer(amount, nx, ny) {
  if (player.invuln > 0) return;
  player.hp -= amount;
  player.invuln = 0.45;
  player.hurtFlash = 0.35;
  shake(11);
  sfx.hurt();

  /* Geri savrulma */
  player.vx -= nx * 180;
  player.vy -= ny * 180;

  addParticles(player.x, player.y, '#ff4d5e', 12, 1.3);
  pushFloater(player.x, player.y - player.r - 8, '-' + Math.round(amount), '#ff4d5e', 15);

  if (player.hp <= 0) {
    player.hp = 0;
    gameOver();
  }
}

/* ---------- XP kutuları ---------- */
function updateOrbs(dt) {
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    o.life -= dt;
    o.bob += dt * 6;

    const dx = player.x - o.x;
    const dy = player.y - o.y;
    const d  = Math.hypot(dx, dy) || 1;

    /* Mıknatıs alanına girince oyuncuya doğru çekilir */
    if (d < player.magnet) {
      const pull = lerp(120, 900, 1 - d / player.magnet);
      o.vx += (dx / d) * pull * dt;
      o.vy += (dy / d) * pull * dt;
    }

    o.vx *= Math.pow(0.08, dt);
    o.vy *= Math.pow(0.08, dt);
    o.x += o.vx * dt;
    o.y += o.vy * dt;

    const cr = o.r + player.r + 4;
    if (d <= cr) {
      gainXp(o.value);
      addParticles(o.x, o.y, '#ffd23d', 5, 0.6);
      sfx.pickup();
      orbs.splice(i, 1);
      continue;
    }

    if (o.life <= 0) orbs.splice(i, 1);
  }
}

/* ---------- Parçacıklar / yazılar / halkalar ---------- */
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.06, dt);
    p.vy *= Math.pow(0.06, dt);
  }
}

function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt;
    if (f.life <= 0) { floaters.splice(i, 1); continue; }
    f.y += f.vy * dt;
    f.x += f.vx * dt;
    f.vy *= Math.pow(0.25, dt);
  }
}

function updateRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.life -= dt;
    r.r = lerp(r.r, r.maxR, 1 - Math.pow(0.02, dt));
    if (r.life <= 0) rings.splice(i, 1);
  }
}

/* ============================================================
   14) ÇİZİM
   ============================================================ */
function render(dt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  /* Arka plan */
  ctx.fillStyle = '#06060c';
  ctx.fillRect(0, 0, viewW, viewH);

  ctx.save();
  ctx.translate(-Math.round(camX) + shakeX, -Math.round(camY) + shakeY);

  drawGrid();
  drawOrbs(dt);
  drawRings();
  drawParticles();
  drawEnemies();
  drawBullets();
  drawPlayer();
  drawFloaters();

  ctx.restore();

  if (state === STATE.PLAY || state === STATE.PAUSE || state === STATE.LEVELUP) drawCrosshair();
}

/* ---------- Izgara zemin ---------- */
function drawGrid() {
  const g = 80;
  const left = camX - 40, top = camY - 40;
  const right = camX + viewW + 40, bottom = camY + viewH + 40;

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(70, 110, 170, 0.16)';
  ctx.beginPath();
  for (let x = Math.floor(left / g) * g; x <= right; x += g) { ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
  for (let y = Math.floor(top / g) * g; y <= bottom; y += g) { ctx.moveTo(left, y); ctx.lineTo(right, y); }
  ctx.stroke();

  /* Kalın alt-ızgara vurgusu */
  const G = g * 4;
  ctx.strokeStyle = 'rgba(90, 140, 210, 0.10)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = Math.floor(left / G) * G; x <= right; x += G) { ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
  for (let y = Math.floor(top / G) * G; y <= bottom; y += G) { ctx.moveTo(left, y); ctx.lineTo(right, y); }
  ctx.stroke();
}

/* ---------- Oyuncu ---------- */
function drawPlayer() {
  const p = player;
  const blink = p.invuln > 0 && Math.floor(p.invuln * 22) % 2 === 0;

  ctx.save();
  ctx.translate(p.x, p.y);

  /* Zemin gölgesi */
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, p.r * 0.85, p.r * 1.05, p.r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  /* Ateş yönü namlusu */
  ctx.save();
  ctx.rotate(p.aimAngle);
  ctx.fillStyle = '#9dfaff';
  ctx.shadowColor = '#4df2ff';
  ctx.shadowBlur = 12;
  ctx.fillRect(p.r - 2, -3, 12, 6);
  ctx.restore();

  /* Gövde (retro kare) */
  const bodyColor = p.hurtFlash > 0 && Math.floor(p.hurtFlash * 30) % 2 === 0 ? '#ffffff' : '#4df2ff';
  ctx.shadowColor = '#4df2ff';
  ctx.shadowBlur = 20;
  ctx.fillStyle = blink ? 'rgba(157,250,255,0.35)' : bodyColor;
  ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);

  /* İç koyu detay */
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#06131c';
  ctx.fillRect(-p.r + 5, -p.r + 5, p.r * 2 - 10, p.r * 2 - 10);

  /* Göz noktaları */
  ctx.fillStyle = blink ? '#06131c' : '#ffffff';
  const ex = Math.cos(p.aimAngle) * 5;
  const ey = Math.sin(p.aimAngle) * 5;
  ctx.fillRect(-4 + ex, -4 + ey, 3, 3);
  ctx.fillRect( 2 + ex, -4 + ey, 3, 3);

  ctx.restore();
}

/* ---------- Düşmanlar ---------- */
function drawEnemies() {
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const r = e.r;
    const flash = e.flash > 0;

    ctx.save();
    ctx.translate(e.x, e.y);

    ctx.shadowColor = e.color;
    ctx.shadowBlur = e.type === 'boss' ? 34 : 14;

    const col = flash ? '#ffffff' : e.color;
    ctx.fillStyle = col;

    if (e.shape === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
      ctx.closePath(); ctx.fill();
    } else if (e.shape === 'boss') {
      /* Boss: dönen çift kare */
      ctx.rotate(Math.sin(e.wobble * 0.4) * 0.35);
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = flash ? '#ffd23d' : '#2a0a3a';
      ctx.fillRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1);
      /* Gözler */
      ctx.fillStyle = '#ffd23d';
      ctx.fillRect(-r * 0.42, -r * 0.22, r * 0.26, r * 0.26);
      ctx.fillRect( r * 0.16, -r * 0.22, r * 0.26, r * 0.26);
    } else {
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(-r + 4, -r + 4, r * 2 - 8, r * 2 - 8);
    }

    ctx.restore();

    /* Can barı (hasar almışsa) */
    if (e.hp < e.maxHp) {
      const w = r * 2.2;
      const h = e.type === 'boss' ? 7 : 3.5;
      const bx = e.x - w / 2;
      const by = e.y - r - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
      ctx.fillStyle = e.type === 'boss' ? '#ffd23d' : '#ff4d5e';
      ctx.fillRect(bx, by, w * clamp(e.hp / e.maxHp, 0, 1), h);
    }
  }
}

/* ---------- Mermiler ---------- */
function drawBullets() {
  ctx.shadowColor = '#ffd23d';
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i];
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);

    ctx.shadowBlur = 16;
    ctx.fillStyle = '#fff8b0';
    ctx.fillRect(-b.r * 1.9, -b.r * 0.72, b.r * 3.4, b.r * 1.44);

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffb020';
    ctx.fillRect(-b.r * 0.9, -b.r * 0.4, b.r * 2, b.r * 0.8);

    ctx.restore();
  }
  ctx.shadowBlur = 0;
}

/* ---------- XP kutuları ---------- */
function drawOrbs(dt) {
  ctx.shadowColor = '#ffd23d';
  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i];
    const bob = Math.sin(o.bob) * 2.5;
    ctx.shadowBlur = 14;
    ctx.fillStyle = o.life < 4 && Math.floor(o.life * 8) % 2 === 0 ? '#fff6c0' : '#ffd23d';
    ctx.save();
    ctx.translate(o.x, o.y + bob);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-o.r, -o.r, o.r * 2, o.r * 2);
    ctx.restore();

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(120,70,0,0.55)';
    ctx.fillRect(o.x - o.r * 0.35, o.y + bob - o.r * 0.35, o.r * 0.7, o.r * 0.7);
  }
  ctx.shadowBlur = 0;
}

/* ---------- Parçacıklar ---------- */
function drawParticles() {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

/* ---------- Yüzen yazılar ---------- */
function drawFloaters() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < floaters.length; i++) {
    const f = floaters[i];
    const a = clamp(f.life / 0.85, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = 'bold ' + f.size + 'px "Courier New", monospace';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/* ---------- Halkalar ---------- */
function drawRings() {
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    ctx.globalAlpha = clamp(r.life / 0.5, 0, 1) * 0.85;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* ---------- Nişangah ---------- */
function drawCrosshair() {
  const x = mouse.x, y = mouse.y;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#4df2ff';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#4df2ff';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-18, 0); ctx.lineTo(-5, 0);
  ctx.moveTo(18, 0);  ctx.lineTo(5, 0);
  ctx.moveTo(0, -18); ctx.lineTo(0, -5);
  ctx.moveTo(0, 18);  ctx.lineTo(0, 5);
  ctx.stroke();
  ctx.restore();
}

/* ============================================================
   15) HUD GÜNCELLEME
   ============================================================ */
let lastHud = {};

function updateHUD(force) {
  if (!player) return;

  const hpPct = clamp(player.hp / player.maxHp, 0, 1);
  const xpPct = clamp(player.xp / player.xpNext, 0, 1);

  if (force || lastHud.hp !== hpPct) {
    el.hpBar.style.width = (hpPct * 100).toFixed(2) + '%';
    el.hpBar.parentElement.classList.toggle('low', hpPct <= 0.3);
    lastHud.hp = hpPct;
  }
  const hpTxt = Math.ceil(player.hp) + ' / ' + Math.round(player.maxHp);
  if (force || lastHud.hpTxt !== hpTxt) { el.hpText.textContent = hpTxt; lastHud.hpTxt = hpTxt; }

  if (force || lastHud.xp !== xpPct) {
    el.xpBar.style.width = (xpPct * 100).toFixed(2) + '%';
    lastHud.xp = xpPct;
  }
  if (force || lastHud.level !== player.level) {
    el.levelText.textContent = player.level;
    lastHud.level = player.level;
  }

  const sc = Math.floor(score);
  if (force || lastHud.score !== sc) { el.scoreText.textContent = sc; lastHud.score = sc; }

  const t = fmtTime(time);
  if (force || lastHud.time !== t) { el.timeText.textContent = t; lastHud.time = t; }

  const d = Math.ceil(difficulty());
  if (force || lastHud.danger !== d) { el.dangerValue.textContent = d; lastHud.danger = d; }
}

/* ---------- Aktif yükseltme şeridi ---------- */
function renderPerks() {
  el.perkStrip.innerHTML = '';
  for (const u of UPGRADES) {
    const n = upgradeStacks[u.id] || 0;
    if (n <= 0) continue;
    const chip = document.createElement('div');
    chip.className = 'perk';
    chip.textContent = u.icon + ' ' + u.name + ' Lv' + n;
    el.perkStrip.appendChild(chip);
  }
}

/* ============================================================
   16) EKRAN (OVERLAY) YÖNETİMİ
   ============================================================ */
function show(node) { node.classList.remove('hidden'); }
function hide(node) { node.classList.add('hidden'); }

/* ---------- Oyunu başlat ---------- */
function startGame() {
  sfx.init();
  resetGame();
  state = STATE.PLAY;
  hide(el.menu); hide(el.levelup); hide(el.gameover); hide(el.pause);
  show(el.hud);
  lastHud = {};
  updateHUD(true);
  canvas.style.cursor = 'none';
}

/* ---------- Duraklat ---------- */
function togglePause() {
  if (state === STATE.PLAY) {
    state = STATE.PAUSE;
    show(el.pause);
  } else if (state === STATE.PAUSE) {
    state = STATE.PLAY;
    hide(el.pause);
  }
}

/* ---------- Level atlama ---------- */
function openLevelUp() {
  if (pendingLevels <= 0) return;
  state = STATE.LEVELUP;

  el.levelupSub.textContent = 'SEVİYE ' + player.level + ' • ' + pendingLevels + ' yükseltme hakkı';
  el.upgradeCards.innerHTML = '';

  const opts = rollUpgrades(3);
  opts.forEach((u) => {
    const card = document.createElement('div');
    card.className = 'card';

    const n = upgradeStacks[u.id] || 0;
    card.innerHTML =
      '<span class="card-level">Lv ' + (n + 1) + '/' + u.max + '</span>' +
      '<span class="card-icon">' + u.icon + '</span>' +
      '<div class="card-name">' + u.name + '</div>' +
      '<div class="card-desc">' + u.desc + '</div>';

    card.addEventListener('click', () => chooseUpgrade(u));
    el.upgradeCards.appendChild(card);
  });

  show(el.levelup);
}

function chooseUpgrade(u) {
  u.apply(player);
  upgradeStacks[u.id] = (upgradeStacks[u.id] || 0) + 1;
  renderPerks();
  pendingLevels--;

  addRing(player.x, player.y, '#ffd23d', 110);
  pushFloater(player.x, player.y - 34, u.icon + ' ' + u.name, '#39ff8f', 15);
  sfx.pickup();

  if (pendingLevels > 0) {
    openLevelUp();
  } else {
    hide(el.levelup);
    state = STATE.PLAY;
    lastHud = {};
    updateHUD(true);
  }
}

/* ---------- Oyun bitti ---------- */
function gameOver() {
  state = STATE.OVER;
  sfx.gameOver();

  addParticles(player.x, player.y, '#4df2ff', 60, 2.4);
  addRing(player.x, player.y, '#ff4d5e', 300);
  shake(26);

  const finalScore = Math.floor(score);
  const best = Math.max(finalScore, Number(localStorage.getItem(BEST_KEY) || 0));
  try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}

  el.finalScore.textContent = finalScore;
  el.finalTime.textContent  = fmtTime(time);
  el.finalLevel.textContent = player.level;
  el.finalKills.textContent = kills;
  el.bestScore.textContent  = best;

  setTimeout(() => { if (state === STATE.OVER) show(el.gameover); }, 550);
}

/* ---------- Ana menüye dön ---------- */
function goToMenu() {
  state = STATE.MENU;
  resetGame();
  hide(el.gameover); hide(el.levelup); hide(el.pause); hide(el.hud);
  show(el.menu);
  canvas.style.cursor = 'default';
}

/* ============================================================
   17) BUTON OLAYLARI
   ============================================================ */
el.startBtn.addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
el.menu.addEventListener('click', () => startGame());

el.retryBtn.addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
el.menuBtn.addEventListener('click', (e) => { e.stopPropagation(); goToMenu(); });

el.resumeBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePause(); });
el.pauseQuitBtn.addEventListener('click', (e) => { e.stopPropagation(); hide(el.pause); goToMenu(); });

/* Klavyeden hızlı başlatma */
window.addEventListener('keydown', (e) => {
  if (state === STATE.MENU && (e.code === 'Space' || e.code === 'Enter')) startGame();
  else if (state === STATE.OVER && e.code === 'Enter') startGame();
  else if (state === STATE.LEVELUP) {
    const idx = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (idx >= 0) {
      const card = el.upgradeCards.children[idx];
      if (card) card.click();
    }
  }
});

/* ============================================================
   18) ANA DÖNGÜ
   ============================================================ */
let lastTs = 0;

function loop(ts) {
  requestAnimationFrame(loop);

  if (!lastTs) lastTs = ts;
  let dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (dt > 0.05) dt = 0.05;   // sekme arka plandayken sıçramayı engelle
  if (dt < 0)    dt = 0;

  if (state === STATE.PLAY) {
    update(dt);
  } else if (state === STATE.OVER) {
    /* Ölümden sonra da efektler sönümlensin */
    updateParticles(dt);
    updateFloaters(dt);
    updateRings(dt);
    shakeAmount *= Math.pow(0.0015, dt);
    if (shakeAmount < 0.15) shakeAmount = 0;
    shakeX = rand(-shakeAmount, shakeAmount);
    shakeY = rand(-shakeAmount, shakeAmount);
    updateHUD(false);
  }

  render(dt);
}

/* ============================================================
   19) BAŞLATMA
   ============================================================ */
resize();
resetGame();
goToMenu();
requestAnimationFrame(loop);
