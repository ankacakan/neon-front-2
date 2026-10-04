/* ============================================================
   NEON FRONT 2.0 — harita üretimi: nehir eğrisi, kabartma, biyomlar,
   yürünebilirlik ve ele geçirme noktaları.
   ============================================================ */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, vnoise, dist2D } from '../core/utils.js';

export const W = CFG.world;
export const GRID_N = Math.round(W.size / W.cell);
export const CELL = W.cell;

/* ---------- Nehir ---------- */
export function riverCX(z) {
  return 5.0 * Math.sin(z * 0.05) + 2.5 * Math.sin(z * 0.12);
}
export function isWater(x, z) { return Math.abs(x - riverCX(z)) < W.waterHalf; }
export function isBridgeZone(x, z) {
  return Math.abs(z - W.bridgeZ) <= W.bridgeHalfWidth && Math.abs(x) <= W.bridgeHalfLen;
}

export function bridgeHeight(x, z) {
  if (Math.abs(z - W.bridgeZ) > W.bridgeHalfWidth) return 0;
  const ax = Math.abs(x);
  if (ax > W.bridgeHalfLen) return 0;
  const t = clamp((ax - (W.bridgeHalfLen - 9)) / 9, 0, 1);
  return W.deckY * (1 - t) * (1 - t * 0.25);
}

/* Yumuşak kumul/kabartma — nehir yatağında düzleşir */
export function terrainRelief(x, z) {
  if (Math.abs(x) > W.half || Math.abs(z) > W.half) return 0;
  const cx = riverCX(z);
  const d = Math.abs(x - cx);
  const bankFade = clamp((d - W.riverHalf - 1.5) / 9, 0, 1);
  if (bankFade <= 0) return 0;
  const n = vnoise((x + 40) * 0.045 + 3.1, (z + 17) * 0.045 + 8.7);
  const m = vnoise((x - 12) * 0.11 + 21.4, (z + 5) * 0.11 + 4.2);
  return ((n - 0.5) * 2.2 + (m - 0.5) * 0.7) * bankFade;
}

export function groundHeight(x, z) {
  const b = bridgeHeight(x, z);
  if (b > 0.001) return b;
  return terrainRelief(x, z);
}

/* ---------- Normaller ---------- */
const _UP = new THREE.Vector3(0, 1, 0);
const _nrm = new THREE.Vector3();
export const UP = _UP;
export function terrainNormal(x, z) {
  const e = 1.2;
  const hL = groundHeight(x - e, z), hR = groundHeight(x + e, z);
  const hD = groundHeight(x, z - e), hU = groundHeight(x, z + e);
  _nrm.set(hL - hR, 2 * e, hD - hU).normalize();
  return _nrm;
}

/* ---------- Yürünebilirlik ---------- */
export function walkableAt(x, z) {
  if (Math.abs(x) > W.half - 2 || Math.abs(z) > W.half - 2) return false;
  if (isWater(x, z)) return isBridgeZone(x, z);
  return true;
}
export function isWalkableCell(i, j) {
  if (i < 0 || j < 0 || i >= GRID_N || j >= GRID_N) return false;
  const x = -W.half + (i + 0.5) * CELL;
  const z = -W.half + (j + 0.5) * CELL;
  return walkableAt(x, z);
}

/* ---------- Biyom ağırlıkları (splat arazi için) ----------
   Doğu tarafı orman/çim, batı tarafı çöl/kum, kıyı şeridi çakıl/kaya. */
export function biomeWeights(x, z, out) {
  out = out || {};
  const cx = riverCX(z);
  const d = Math.abs(x - cx);

  const n1 = vnoise((x + cx) * 0.07 + 11, z * 0.07 + 7);
  const n2 = vnoise((x + cx) * 0.31 + 53, z * 0.31 + 29);
  const n3 = vnoise((x + cx) * 1.15 + 91, z * 1.15 + 67);
  const macro = n1 * 0.58 + n2 * 0.30 + n3 * 0.12;

  const bank = clamp(1 - (d - W.riverHalf) / 6.5, 0, 1);
  const wet = d < W.riverHalf ? clamp(1 - d / W.riverHalf, 0, 1) : 0;

  const east = x >= cx;
  let sand = east ? 0.06 + (1 - macro) * 0.10 : 0.72 + macro * 0.22;
  let grass = east ? 0.80 + macro * 0.20 : 0.10 * macro;

  // kaya benekleri (yüksek frekans)
  const rockN = vnoise((x + 90) * 0.09 + macro * 3.0, (z - 40) * 0.09);
  let rock = clamp((rockN - 0.62) * 3.2, 0, 1) * 0.85;
  let gravel = bank * (0.45 + n3 * 0.35) + wet * 0.35;
  let dirt = clamp((macro - 0.55) * 1.6, 0, 1) * 0.5;

  const sum = sand + grass + rock + gravel + dirt + 1e-5;
  out.sand = sand / sum;
  out.grass = grass / sum;
  out.rock = rock / sum;
  out.gravel = gravel / sum;
  out.dirt = dirt / sum;
  out.wet = wet;
  out.bank = bank;
  out.macro = macro;
  return out;
}

/* ---------- Ele geçirme noktaları ---------- */
export function generateCapturePoints() {
  const cand = [
    { name: 'KÖPRÜ KONTROLÜ', x: 0, z: W.bridgeZ, r: 15 },
    { name: 'BATI KARAKOLU', x: -78, z: 58, r: 16 },
    { name: 'DOĞU SIRT', x: 84, z: -66, r: 16 },
    { name: 'KUZEY DÜZLÜĞÜ', x: -30, z: -104, r: 15 }
  ];
  const pts = [];
  for (let i = 0; i < Math.min(CFG.world.capturePointCount, cand.length); i++) {
    const c = cand[i];
    // yürünebilir bir merkeze kaydır
    let { x, z } = c;
    for (let t = 0; t < 40; t++) {
      if (walkableAt(x, z)) break;
      x = c.x + (Math.random() - 0.5) * 24;
      z = c.z + (Math.random() - 0.5) * 24;
    }
    pts.push({
      name: c.name, x, z, radius: c.r,
      owner: 'neutral', progress: 0, contested: false, regen: 0
    });
  }
  return pts;
}

/** Bir noktaya en yakın nokta bilgisi (menzil içindeyse). */
export function pointNear(pts, x, z) {
  for (const p of pts) {
    if (dist2D(p.x, p.z, x, z) < p.radius) return p;
  }
  return null;
}
