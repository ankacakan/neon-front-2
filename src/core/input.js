/* ============================================================
   NEON FRONT 2.0 — girdi: seçim (tık + kutu), emirler, kamera kontrolü
   ============================================================ */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { engine, updateCamera } from './engine.js';
import { state } from './state.js';
import { clamp } from './utils.js';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();

let dragActive = false, dragMoved = false;
const dragStart = { x: 0, y: 0 }, dragNow = { x: 0, y: 0 };
let panActive = false;
const panLast = { x: 0, y: 0 };
let handlers = {};
let selectBox = null;

export function initInput(canvas, h) {
  handlers = h || {};
  selectBox = document.getElementById('selectBox');

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (!canAct()) return;
    if (e.button === 2) {
      const t = pickUnit(e.clientX, e.clientY);
      if (t && t.team !== 'blue' && handlers.onAttack) handlers.onAttack(t);
      else {
        const g = pickGround(e.clientX, e.clientY);
        if (g && handlers.onMove) handlers.onMove(g.x, g.z);
      }
      return;
    }
    if (e.button === 1) { panActive = true; panLast.x = e.clientX; panLast.y = e.clientY; e.preventDefault(); return; }
    if (e.button !== 0) return;
    dragActive = true; dragMoved = false;
    dragStart.x = e.clientX; dragStart.y = e.clientY;
    dragNow.x = e.clientX; dragNow.y = e.clientY;
  });

  window.addEventListener('pointermove', (e) => {
    state.mouse.x = e.clientX; state.mouse.y = e.clientY;

    if (panActive) {
      const dx = e.clientX - panLast.x, dy = e.clientY - panLast.y;
      panLast.x = e.clientX; panLast.y = e.clientY;
      const right = new THREE.Vector3(Math.cos(state.cam.yaw), 0, -Math.sin(state.cam.yaw));
      const fwd = new THREE.Vector3(-Math.sin(state.cam.yaw), 0, -Math.cos(state.cam.yaw));
      const k = state.cam.viewSize / 700;
      state.cam.focus.addScaledVector(right, -dx * k);
      state.cam.focus.addScaledVector(fwd, dy * k);
      clampFocus();
      return;
    }
    if (!dragActive) return;
    dragNow.x = e.clientX; dragNow.y = e.clientY;
    if (Math.abs(dragNow.x - dragStart.x) > 5 || Math.abs(dragNow.y - dragStart.y) > 5) dragMoved = true;
    if (dragMoved && selectBox) {
      const x0 = Math.min(dragStart.x, dragNow.x), y0 = Math.min(dragStart.y, dragNow.y);
      selectBox.style.display = 'block';
      selectBox.style.left = x0 + 'px';
      selectBox.style.top = y0 + 'px';
      selectBox.style.width = Math.abs(dragNow.x - dragStart.x) + 'px';
      selectBox.style.height = Math.abs(dragNow.y - dragStart.y) + 'px';
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (panActive && e.button === 1) { panActive = false; return; }
    if (e.button !== 0 || !dragActive) return;
    dragActive = false;
    if (selectBox) selectBox.style.display = 'none';
    if (!canAct()) return;

    if (dragMoved) {
      const x0 = Math.min(dragStart.x, dragNow.x), x1 = Math.max(dragStart.x, dragNow.x);
      const y0 = Math.min(dragStart.y, dragNow.y), y1 = Math.max(dragStart.y, dragNow.y);
      const picked = [];
      for (const u of state.units) {
        if (!u.alive || u.team !== 'blue' || u.kind === 'hq' || u.kind === 'bomber') continue;
        const s = screenOf(new THREE.Vector3(u.pos.x, u.pos.y + 1, u.pos.z));
        if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) picked.push(u);
      }
      if (handlers.onSelect) handlers.onSelect(picked, e.shiftKey);
      return;
    }

    const hitUnit = pickUnit(e.clientX, e.clientY);
    if (hitUnit && hitUnit.team === 'blue' && hitUnit.kind !== 'bomber') {
      if (handlers.onSelect) handlers.onSelect([hitUnit], e.shiftKey);
    } else if (hitUnit && hitUnit.team !== 'blue') {
      if (handlers.onAttack) handlers.onAttack(hitUnit);
    } else {
      const g = pickGround(e.clientX, e.clientY);
      if (g) {
        if (state.selected.length && handlers.onMove) handlers.onMove(g.x, g.z);
        else if (handlers.onSelect) handlers.onSelect([], false);
      }
    }
  });

  window.addEventListener('wheel', (e) => {
    if (!canAct()) return;
    e.preventDefault();
    const f = Math.exp(e.deltaY * 0.0011);
    state.cam.viewSize = clamp(state.cam.viewSize * f, CFG.camera.minView, CFG.camera.maxView);
    updateCamera(0);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    state.keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
    if (!canAct()) return;
    if (e.code === 'KeyR' && handlers.onAbility) handlers.onAbility('reinforce');
    if (e.code === 'KeyB' && handlers.onAbility) handlers.onAbility('airstrike');
    if (e.code === 'Space' && handlers.onFocus) handlers.onFocus();
    if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (handlers.onSelectAll) handlers.onSelectAll();
    }
    if (handlers.onBuildKey && /^Digit[1-9]$/.test(e.code)) {
      handlers.onBuildKey(parseInt(e.code.slice(5), 10));
    }
  });
  window.addEventListener('keyup', (e) => { state.keys[e.code] = false; });
  window.addEventListener('blur', () => {
    for (const k in state.keys) state.keys[k] = false;
    panActive = false; dragActive = false;
  });
}

function canAct() {
  return !handlers.canAct || handlers.canAct();
}

/* ---------- Kamera kontrolü (klavye) ---------- */
export function updateCameraControls(dt) {
  const keys = state.keys;
  const speed = state.cam.viewSize * 1.35 * dt;
  const right = new THREE.Vector3(Math.cos(state.cam.yaw), 0, -Math.sin(state.cam.yaw));
  const fwd = new THREE.Vector3(-Math.sin(state.cam.yaw), 0, -Math.cos(state.cam.yaw));
  let mx = 0, mz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) mz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) mz -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
  if (keys['KeyA'] && !(keys['ControlLeft'] || keys['ControlRight'] || keys['MetaLeft'] || keys['MetaRight'])) mx -= 1;
  if (keys['ArrowLeft']) mx -= 1;
  if (mx || mz) {
    state.cam.focus.addScaledVector(right, mx * speed);
    state.cam.focus.addScaledVector(fwd, mz * speed);
    clampFocus();
  }
  if (keys['KeyQ']) state.cam.yaw += dt * 1.7;
  if (keys['KeyE']) state.cam.yaw -= dt * 1.7;
}

export function clampFocus() {
  const h = CFG.world.half;
  state.cam.focus.x = clamp(state.cam.focus.x, -h + 8, h - 8);
  state.cam.focus.z = clamp(state.cam.focus.z, -h + 8, h - 8);
}

/* ---------- Seçim yardımcıları ---------- */
export function selectUnits(list, additive) {
  if (!additive) {
    for (const s of state.selected) s.setSelected(false);
    state.selected.length = 0;
  }
  for (const u of list) {
    if (state.selected.indexOf(u) === -1) { state.selected.push(u); u.setSelected(true); }
  }
  if (handlers.onSelectionChanged) handlers.onSelectionChanged();
}

export function focusSelection() {
  if (!state.selected.length) {
    if (state.hq.blue) { state.cam.focus.set(state.hq.blue.pos.x, 0, state.hq.blue.pos.z); }
    return;
  }
  let cx = 0, cz = 0;
  for (const s of state.selected) { cx += s.pos.x; cz += s.pos.z; }
  state.cam.focus.set(cx / state.selected.length, 0, cz / state.selected.length);
  clampFocus();
}

/* ---------- Işın izleme ---------- */
export function pickGround(clientX, clientY) {
  ndc.x = (clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, engine.cam);
  const p = raycaster.ray.intersectPlane(groundPlane, hitPoint);
  return p ? hitPoint : null;
}
export const lastGroundPoint = () => hitPoint;

export function pickUnit(clientX, clientY) {
  ndc.x = (clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, engine.cam);
  let best = null, bestD = Infinity;
  for (const u of state.units) {
    if (!u.alive || u.kind === 'bomber') continue;
    const p = u.pos.clone();
    p.y += u.kind === 'hq' ? 2.4 : 1.2;
    const d = raycaster.ray.distanceToPoint(p);
    const pickR = u.radius * (u.kind === 'hq' ? 1.5 : 1.35);
    if (d < pickR && d < bestD) { bestD = d; best = u; }
  }
  return best;
}

export function screenOf(v3) {
  const p = v3.clone().project(engine.cam);
  return { x: (p.x + 1) * 0.5 * window.innerWidth, y: (-p.y + 1) * 0.5 * window.innerHeight };
}
