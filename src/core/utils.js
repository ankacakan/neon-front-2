/* ============================================================
   NEON FRONT 2.0 — ortak yardımcılar (matematik, gürültü, GLSL)
   ============================================================ */

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
export function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function damp(a, b, l, dt) { return lerp(a, b, 1 - Math.exp(-l * dt)); }
export function rand(a, b) { return a + Math.random() * (b - a); }
export function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
export function clampInt(v, a, b) { return v < a ? a : (v > b ? b : v); }
export function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
export function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function angLerp(a, b, t) { return a + angDiff(a, b) * clamp(t, 0, 1); }

export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
export function dist3D(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
export function fmtTime(s) {
  const m = Math.floor(s / 60), q = Math.floor(s % 60);
  return (m < 10 ? '0' : '') + m + ':' + (q < 10 ? '0' : '') + q;
}

/* ---------- Prosedürel değer gürültüsü ---------- */
export function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm2(x, y, oct) {
  let s = 0, amp = 0.5, tot = 0;
  for (let i = 0; i < (oct || 4); i++) { s += amp * vnoise(x, y); tot += amp; x *= 2.03; y *= 2.03; amp *= 0.5; }
  return s / tot;
}

/* ---------- GLSL tarafı gürültü (malzeme & VFX shader'ları paylaşır) ---------- */
export const GLSL_NOISE = [
  'float vfx_nz(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453123); }',
  'float vfx_vn(vec3 p){',
  '  vec3 i = floor(p), f = fract(p);',
  '  f = f * f * (3.0 - 2.0 * f);',
  '  float a = mix(mix(vfx_nz(i), vfx_nz(i + vec3(1.0,0.0,0.0)), f.x),',
  '                mix(vfx_nz(i + vec3(0.0,1.0,0.0)), vfx_nz(i + vec3(1.0,1.0,0.0)), f.x), f.y);',
  '  float b = mix(mix(vfx_nz(i + vec3(0.0,0.0,1.0)), vfx_nz(i + vec3(1.0,0.0,1.0)), f.x),',
  '                mix(vfx_nz(i + vec3(0.0,1.0,1.0)), vfx_nz(i + vec3(1.0,1.0,1.0)), f.x), f.y);',
  '  return mix(a, b, f.z);',
  '}',
  'float vfx_fbm(vec3 p){',
  '  float s = 0.0, a = 0.5;',
  '  for (int k = 0; k < 4; k++) { s += a * vfx_vn(p); p *= 2.03; a *= 0.5; }',
  '  return s / 0.9375;',
  '}'
].join('\n');

/* ---------- DOM yardımcıları ---------- */
export function $(id) { return document.getElementById(id); }
export function show(node) { if (node) node.classList.remove('hidden'); }
export function hide(node) { if (node) node.classList.add('hidden'); }
export function setText(node, txt) { if (node) node.textContent = txt; }
export function setWidth(node, frac) { if (node) node.style.width = (clamp01(frac) * 100).toFixed(1) + '%'; }
