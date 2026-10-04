/* ============================================================
   NEON FRONT 2.0 — patlama ve efekt reçeteleri
   Sinematik ateş topu + duman sütunu + parçacıklar + şok dalgası.
   ============================================================ */
import { CFG } from '../config.js';
import { pools } from './particles.js';
import { billboards } from './billboards.js';
import { spawnRing, spawnScorch, flashAt, addGroundFire } from './decals.js';
import { state } from '../core/state.js';
import { rand, TAU, clamp } from '../core/utils.js';

const FOG_HEX = CFG.fog.color;
const boomQueue = [];

export function impactDust(x, y, z, scale, color) {
  const n = Math.round(6 * scale);
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), sp = rand(1.5, 5) * scale;
    pools.smoke.spawn({
      x, y: y + 0.2, z,
      vx: Math.cos(a) * sp, vy: rand(0.8, 3.4) * scale, vz: Math.sin(a) * sp,
      life: rand(0.45, 0.9), s0: 0.32 * scale, s1: rand(0.9, 1.5) * scale,
      grav: 1.2, drag: 0.06,
      c0: color === undefined ? 0xb9a888 : color, c1: FOG_HEX
    });
  }
}

export function queueBoom(x, y, z, power, delay) {
  if (boomQueue.length > 24) return;
  boomQueue.push({ x, y, z, p: power, t: delay });
}

export function updateBoomQueue(dt) {
  for (let i = boomQueue.length - 1; i >= 0; i--) {
    const b = boomQueue[i];
    b.t -= dt;
    if (b.t <= 0) {
      boomQueue.splice(i, 1);
      explode(b.x, b.y, b.z, b.p, 'none');
    }
  }
}

export function explode(x, y, z, power, team) {
  const P = clamp(power || 1, 0.35, 4);
  let i, a, el, sp;

  /* 0) Ateş topu billboard'ları */
  const balls = P > 1.4 ? 2 : 1;
  for (i = 0; i < balls; i++) {
    billboards.fire.spawn({
      x: x + rand(-0.5, 0.5) * P,
      y: y + rand(0.7, 1.8) * P,
      z: z + rand(-0.5, 0.5) * P,
      s0: (1.6 + i * 0.8) * P, s1: (7.4 + i * 2.6) * P,
      dur: 0.34 + i * 0.13,
      a0: i === 0 ? 1.0 : 0.72,
      rise: rand(1.5, 4.2) * P,
      hot: 0xfff8e0, mid: 0xff9c2a, cool: 0x7d1a04,
      seed: rand(0, 50)
    });
  }

  /* 0b) Yükselen duman sütunu */
  const puffs = 3 + Math.round(P * 1.8);
  for (i = 0; i < puffs; i++) {
    billboards.smoke.spawn({
      x: x + rand(-1.4, 1.4) * P,
      y: y + rand(0.9, 3.2) * P,
      z: z + rand(-1.4, 1.4) * P,
      s0: (1.5 + Math.random() * 1.7) * P, s1: (7 + Math.random() * 6) * P,
      dur: 2.0 + Math.random() * 1.9,
      a0: 0.52 + Math.random() * 0.30,
      rise: rand(4.5, 10.5) * P,
      grey: 0.16 + Math.random() * 0.44,
      seed: rand(0, 50)
    });
  }

  /* 1) Ateş topu çekirdeği */
  for (i = 0; i < Math.round(11 * P); i++) {
    a = rand(0, TAU); sp = rand(1.5, 6) * P;
    pools.fire.spawn({
      x: x + rand(-0.35, 0.35), y: y + rand(0.4, 1.5), z: z + rand(-0.35, 0.35),
      vx: Math.cos(a) * sp, vy: rand(3, 9) * P, vz: Math.sin(a) * sp,
      life: rand(0.28, 0.52), s0: rand(1.2, 2.0) * P, s1: rand(2.6, 4.2) * P,
      grav: 1.6, drag: 0.02,
      c0: 0xfff8d8, c1: 0xffa020
    });
  }
  /* 2) Alevler */
  for (i = 0; i < Math.round(26 * P); i++) {
    a = rand(0, TAU); sp = rand(4, 15) * P;
    pools.fire.spawn({
      x, y: y + rand(0.3, 1.6), z,
      vx: Math.cos(a) * sp, vy: rand(3, 13) * P, vz: Math.sin(a) * sp,
      life: rand(0.45, 1.05), s0: rand(0.7, 1.5) * P, s1: rand(1.8, 3.4) * P,
      grav: 3.0, drag: 0.05,
      c0: Math.random() < 0.5 ? 0xffe36a : 0xffa22a, c1: 0xe04508
    });
  }
  /* 3) Kıvılcımlar */
  for (i = 0; i < Math.round(34 * P); i++) {
    a = rand(0, TAU); el = rand(0.25, 1.4); sp = rand(11, 28) * P;
    pools.fire.spawn({
      x, y: y + 0.8, z,
      vx: Math.cos(a) * sp, vy: el * sp * 0.8, vz: Math.sin(a) * sp,
      life: rand(0.40, 1.0), s0: rand(0.16, 0.34), s1: rand(0.07, 0.15),
      grav: 22, drag: 0.06,
      c0: 0xfff4c0, c1: 0xff7a12
    });
  }
  /* 4) Duman */
  for (i = 0; i < Math.round(16 * P); i++) {
    a = rand(0, TAU); sp = rand(1.4, 5.5) * P;
    pools.smoke.spawn({
      x: x + rand(-1, 1) * P, y: y + rand(0.6, 2.4) * P, z: z + rand(-1, 1) * P,
      vx: Math.cos(a) * sp, vy: rand(2.0, 6.0) * P, vz: Math.sin(a) * sp,
      life: rand(1.3, 2.9), s0: rand(0.9, 1.8) * P, s1: rand(3.4, 6.4) * P,
      grav: 1.0, drag: 0.22,
      c0: Math.random() < 0.5 ? 0x8c8c8c : 0x5f5f5f, c1: 0xc6ced8
    });
  }
  /* 5) Enkaz */
  for (i = 0; i < Math.round(12 * P); i++) {
    a = rand(0, TAU); el = rand(0.35, 1.5); sp = rand(6, 17) * P;
    pools.debris.spawn({
      x, y: y + 0.8, z,
      vx: Math.cos(a) * sp, vy: el * sp * 0.9, vz: Math.sin(a) * sp,
      life: rand(0.9, 1.9), s0: rand(0.15, 0.4), s1: rand(0.1, 0.28),
      grav: 20, drag: 0.05, bounce: true,
      c0: 0x2b2620, c1: 0x141210
    });
  }
  /* 6) Şok dalgası, iz, ışık */
  spawnRing(x, y + 0.12, z, 1.2 * P, (13 + 11 * P) * P * 0.75, 0.62, 0xffb257);
  spawnRing(x, y + 0.20, z, 0.8 * P, (7 + 6 * P) * P * 0.6, 0.34, 0xfff0c0);
  spawnScorch(x, y, z, 3.2 * P, clamp(0.30 + 0.1 * P, 0, 0.6));
  flashAt(x, y, z, 42 * P, 0xff9a3c);

  /* 7) Zemin yangını + zincirleme */
  addGroundFire(x, z, 0.85 + 0.55 * P, 4 + 3.2 * P);
  if (P > 1.3) {
    queueBoom(x + rand(-3.5, 3.5) * P, y + 0.6, z + rand(-3.5, 3.5) * P, P * 0.42, rand(0.18, 0.46));
  }
  state.cam.shake = Math.min(2.6, state.cam.shake + 0.75 * P);
}

export function muzzleFlash(x, y, z, dir, team) {
  const col = team === 'blue' ? 0x9fe4ff : 0xffc0a0;
  for (let i = 0; i < 5; i++) {
    pools.fire.spawn({
      x: x + dir.x * 0.4, y: y + dir.y * 0.4, z: z + dir.z * 0.4,
      vx: dir.x * rand(3, 9) + rand(-2, 2),
      vy: dir.y * rand(3, 9) + rand(-1, 2),
      vz: dir.z * rand(3, 9) + rand(-2, 2),
      life: rand(0.07, 0.16), s0: rand(0.3, 0.7), s1: 0.05,
      grav: 1, drag: 0.02, c0: col, c1: col
    });
  }
  impactDust(x + dir.x, y, z + dir.z, 0.34, 0x9a917f);
}

export function unitSpawnFx(x, z, team, groundHeight) {
  spawnRing(x, groundHeight + 0.12, z, 1, 13, 0.55, team === 'blue' ? 0x7fe3ff : 0xff8c6a);
  for (let i = 0; i < 14; i++) {
    const a = rand(0, TAU), sp = rand(3, 9);
    pools.smoke.spawn({
      x, y: 0.4, z,
      vx: Math.cos(a) * sp, vy: rand(1, 4), vz: Math.sin(a) * sp,
      life: rand(0.5, 1.1), s0: 0.35, s1: rand(1.2, 2.2),
      grav: 1.5, drag: 0.08, c0: 0xb0a58c, c1: FOG_HEX
    });
  }
}

export function resetExplosions() { boomQueue.length = 0; }
