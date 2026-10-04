/* ============================================================
   NEON FRONT 2.0 — decal'ler ve zemin efektleri:
   şok dalgası halkaları, is/yanık izleri, patlama ışıkları,
   yanan enkaz ocakları.
   ============================================================ */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { groundHeight, terrainNormal, UP } from '../world/mapgen.js';
import { rand, TAU, lerp, clamp, dist2D } from '../core/utils.js';

const D = { rings: [], scorches: [], flashes: [], fires: [], cursors: { ring: 0, scorch: 0, flash: 0 } };

export function initDecals(scene) {
  const B = CFG.budget;

  /* --- Şok dalgası halkaları --- */
  const ringGeo = new THREE.RingGeometry(0.72, 1, 40).rotateX(-Math.PI / 2);
  for (let i = 0; i < B.rings; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffa03c, transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    });
    const m = new THREE.Mesh(ringGeo, mat);
    m.visible = false;
    m.renderOrder = 4;
    scene.add(m);
    D.rings.push({ mesh: m, mat, active: false, t: 0, dur: 0.7, from: 1, to: 20 });
  }

  /* --- Yanık izleri --- */
  const scorchGeo = new THREE.CircleGeometry(1, 22).rotateX(-Math.PI / 2);
  for (let i = 0; i < B.scorches; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x120d08, transparent: true, opacity: 0, depthWrite: false });
    const m = new THREE.Mesh(scorchGeo, mat);
    m.visible = false;
    m.renderOrder = 3;
    scene.add(m);
    D.scorches.push({ mesh: m, mat, active: false, life: 0, max: 1, darkness: 0.42 });
  }

  /* --- Anlık ışıklar --- */
  for (let i = 0; i < B.flashLights; i++) {
    const l = new THREE.PointLight(0xffa040, 0, 38, 1.7);
    l.position.set(0, 3, 0);
    scene.add(l);
    D.flashes.push({ light: l, intensity: 0, decay: 0 });
  }

  /* --- Zemin yangınları --- */
  for (let i = 0; i < B.groundFires; i++) {
    D.fires.push({ active: false, x: 0, y: 0, z: 0, scale: 1, life: 0, max: 1, acc: 0 });
  }

  return D;
}

/* ---------- Halkalar ---------- */
export function spawnRing(x, y, z, from, to, dur, color) {
  for (let i = 0; i < D.rings.length; i++) {
    const k = (D.cursors.ring + i) % D.rings.length;
    if (!D.rings[k].active) {
      D.cursors.ring = (k + 1) % D.rings.length;
      const r = D.rings[k];
      r.active = true; r.t = 0; r.dur = dur; r.from = from; r.to = to;
      r.mesh.position.set(x, y, z);
      r.mesh.visible = true;
      r.mat.color.set(color);
      return;
    }
  }
}

export function updateRings(dt) {
  for (const r of D.rings) {
    if (!r.active) continue;
    r.t += dt;
    const t = r.t / r.dur;
    if (t >= 1) { r.active = false; r.mesh.visible = false; r.mat.opacity = 0; continue; }
    const s = lerp(r.from, r.to, 1 - Math.pow(1 - t, 2.4));
    r.mesh.scale.set(s, 1, s);
    r.mat.opacity = (1 - t) * 0.85;
  }
}

/* ---------- Yanık izleri ---------- */
export function spawnScorch(x, y, z, r, dark) {
  for (let i = 0; i < D.scorches.length; i++) {
    const k = (D.cursors.scorch + i) % D.scorches.length;
    if (!D.scorches[k].active) {
      D.cursors.scorch = (k + 1) % D.scorches.length;
      const s = D.scorches[k];
      s.active = true; s.life = 20; s.max = 20; s.darkness = dark || 0.42;
      s.mesh.position.set(x, groundHeight(x, z) + 0.10, z);
      s.mesh.quaternion.setFromUnitVectors(UP, terrainNormal(x, z));
      s.mesh.scale.set(r, 1, r);
      s.mesh.visible = true;
      s.mat.opacity = s.darkness;
      return;
    }
  }
}

export function updateScorches(dt) {
  for (const s of D.scorches) {
    if (!s.active) continue;
    s.life -= dt;
    if (s.life <= 0) { s.active = false; s.mesh.visible = false; continue; }
    s.mat.opacity = s.darkness * clamp(s.life / s.max * 1.6, 0, 1);
  }
}

/* ---------- Işıklar ---------- */
export function flashAt(x, y, z, intensity, color) {
  const f = D.flashes[D.cursors.flash];
  D.cursors.flash = (D.cursors.flash + 1) % D.flashes.length;
  f.light.position.set(x, y + 1.6, z);
  f.light.color.set(color === undefined ? 0xffa040 : color);
  f.intensity = intensity;
  f.light.intensity = intensity;
}

export function updateFlashes(dt) {
  for (const f of D.flashes) {
    if (f.intensity <= 0.01) { f.light.intensity = 0; continue; }
    f.intensity *= Math.pow(0.0009, dt);
    f.light.intensity = f.intensity;
  }
}

/* ---------- Zemin yangınları ---------- */
export function addGroundFire(x, z, scale, life) {
  for (const g of D.fires) {
    if (g.active) {
      if (dist2D(g.x, g.z, x, z) < 6) {
        g.life = Math.max(g.life, life);
        g.max = Math.max(g.max, life);
        g.scale = Math.max(g.scale, scale);
        return;
      }
      continue;
    }
    g.active = true;
    g.x = x; g.z = z; g.y = groundHeight(x, z);
    g.scale = scale; g.life = life; g.max = life; g.acc = 0;
    return;
  }
}

export function updateGroundFires(dt, pools) {
  const { fire, smoke } = pools;
  for (const g of D.fires) {
    if (!g.active) continue;
    g.life -= dt;
    if (g.life <= 0) { g.active = false; continue; }
    const inten = g.life / g.max;
    g.acc += dt * (1.4 + 2.6 * inten);
    let guard = 0;
    while (g.acc >= 1 && guard++ < 8) {
      g.acc -= 1;
      const a = rand(0, TAU), rr = rand(0.2, 1.15) * g.scale;
      const px = g.x + Math.cos(a) * rr, pz = g.z + Math.sin(a) * rr;
      if (Math.random() < 0.45) {
        fire.spawn({
          x: px, y: g.y + 0.25, z: pz,
          vx: rand(-1.2, 1.2), vy: rand(2.2, 6.0) * inten + 1.0, vz: rand(-1.2, 1.2),
          life: rand(0.30, 0.72), s0: rand(0.45, 1.0) * g.scale, s1: rand(0.8, 1.9) * g.scale * 0.75,
          grav: 2.5, drag: 0.06,
          c0: Math.random() < 0.5 ? 0xffe066 : 0xff9a24, c1: 0xd83c06
        });
      } else {
        smoke.spawn({
          x: px, y: g.y + 0.6, z: pz,
          vx: rand(-0.6, 0.6), vy: rand(1.4, 3.4), vz: rand(-0.6, 0.6),
          life: rand(1.4, 2.8), s0: rand(0.55, 1.15) * g.scale, s1: rand(2.2, 4.2) * g.scale,
          grav: 0.7, drag: 0.20,
          c0: 0x585858, c1: 0xb9bfc6
        });
      }
    }
  }
}

export function resetDecals() {
  for (const r of D.rings) { r.active = false; r.mesh.visible = false; }
  for (const s of D.scorches) { s.active = false; s.mesh.visible = false; }
  for (const f of D.flashes) { f.intensity = 0; f.light.intensity = 0; }
  for (const g of D.fires) { g.active = false; g.acc = 0; }
}

export { D as decals };
