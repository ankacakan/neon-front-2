/* ============================================================
   NEON FRONT 2.0 — minimap (canvas 2D)
   ============================================================ */
import { CFG } from '../config.js';
import { state } from '../core/state.js';
import { W, riverCX } from '../world/mapgen.js';

const mm = { canvas: null, ctx: null, bg: null, size: 0, scale: 1 };

export function initMinimap() {
  mm.canvas = document.getElementById('minimap');
  if (!mm.canvas) return mm;
  mm.ctx = mm.canvas.getContext('2d');
  mm.size = mm.canvas.width;
  mm.scale = mm.size / W.size;
  mm.bg = document.createElement('canvas');
  mm.bg.width = mm.bg.height = mm.size;
  drawBackground();
  return mm;
}

const px = (x) => (x + W.half) * mm.scale;
const pz = (z) => (z + W.half) * mm.scale;

function drawBackground() {
  const c = mm.bg.getContext('2d');
  const S = mm.size;
  c.fillStyle = '#3f6b38'; c.fillRect(0, 0, S, S);
  c.fillStyle = '#b3945c';
  for (let z2 = 0; z2 < W.size; z2 += 2) {
    const z = -W.half + z2;
    c.fillRect(0, pz(z) - 1, Math.max(0, px(riverCX(z))), 3);
  }
  c.strokeStyle = '#2a6fa8';
  c.lineWidth = Math.max(2, W.waterHalf * 2 * mm.scale);
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath();
  for (let z3 = -W.half; z3 <= W.half; z3 += 6) {
    const X = px(riverCX(z3)), Y = pz(z3);
    if (z3 === -W.half) c.moveTo(X, Y); else c.lineTo(X, Y);
  }
  c.stroke();
  c.fillStyle = '#d8c9a0';
  c.fillRect(px(-W.bridgeHalfLen), pz(-W.bridgeHalfWidth), W.bridgeHalfLen * 2 * mm.scale, W.bridgeHalfWidth * 2 * mm.scale);
  c.strokeStyle = 'rgba(150,190,230,0.35)'; c.lineWidth = 1;
  c.strokeRect(0.5, 0.5, S - 1, S - 1);
}

export function drawMinimap() {
  if (!mm.ctx) return;
  const c = mm.ctx;
  c.clearRect(0, 0, mm.size, mm.size);
  c.drawImage(mm.bg, 0, 0);

  for (const p of state.capturePoints) {
    c.fillStyle = p.owner === 'blue' ? 'rgba(74,168,255,0.35)'
      : p.owner === 'red' ? 'rgba(255,84,104,0.35)' : 'rgba(200,210,220,0.22)';
    c.beginPath();
    c.arc(px(p.x), pz(p.z), p.radius * mm.scale, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = p.owner === 'blue' ? '#4aa8ff' : p.owner === 'red' ? '#ff5468' : '#aab4bf';
    c.lineWidth = 1.4;
    c.stroke();
  }

  c.strokeStyle = 'rgba(240,250,255,0.55)';
  c.lineWidth = 1;
  const half = state.cam.viewSize * 0.62;
  c.strokeRect(px(state.cam.focus.x - half), pz(state.cam.focus.z - half),
    half * 2 * mm.scale, half * 2 * mm.scale);

  for (const u of state.units) {
    if (!u.alive) continue;
    const isBlue = u.team === 'blue';
    const size = u.kind === 'hq' ? 9 : (u.kind === 'bomber' ? 4 : (u.kind === 'artillery' ? 6 : 5));
    c.fillStyle = isBlue ? '#4aa8ff' : '#ff5468';
    c.fillRect(px(u.pos.x) - size / 2, pz(u.pos.z) - size / 2, size, size);
    if (u.kind === 'hq') {
      c.strokeStyle = isBlue ? '#bfe4ff' : '#ffc4c4';
      c.lineWidth = 1.5;
      c.strokeRect(px(u.pos.x) - size / 2 - 2, pz(u.pos.z) - size / 2 - 2, size + 4, size + 4);
    }
  }

  for (const s of state.selected) {
    c.strokeStyle = '#9ff0ff'; c.lineWidth = 1.5;
    c.strokeRect(px(s.pos.x) - 4, pz(s.pos.z) - 4, 8, 8);
  }
}

export function enableMinimapClick() {
  if (!mm.canvas) return;
  mm.canvas.addEventListener('pointerdown', (e) => {
    if (state.phase !== 'playing') return;
    const r = mm.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    state.cam.focus.x = (x / r.width) * W.size - W.half;
    state.cam.focus.z = (y / r.height) * W.size - W.half;
  });
}
