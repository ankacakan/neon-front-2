/* ============================================================
   NEON FRONT 2.0 — mermi ve bomba havuzları + güncelleme
   ============================================================ */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { groundHeight } from '../world/mapgen.js';
import { state } from '../core/state.js';
import { clamp, dist2D } from '../core/utils.js';
import { impactDust, explode } from './explosions.js';

const P = {
  bullets: [], bulletCursor: 0,
  bombs: [], bombCursor: 0,
  bulletMatBlue: null, bulletMatRed: null
};

export function initProjectiles(scene) {
  const N = CFG.budget.bullets;

  const bulletGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.6, 6).rotateX(Math.PI / 2);
  P.bulletMatBlue = new THREE.MeshBasicMaterial({ color: 0x9fe4ff });
  P.bulletMatRed = new THREE.MeshBasicMaterial({ color: 0xffb0a0 });
  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(bulletGeo, P.bulletMatBlue);
    m.visible = false;
    scene.add(m);
    P.bullets.push({ mesh: m, active: false, dir: new THREE.Vector3(), speed: 0, life: 0, damage: 0, team: 'blue', owner: null, kind: 'bullet' });
  }

  const bombGeo = new THREE.CylinderGeometry(0.24, 0.3, 1.1, 7).rotateX(Math.PI / 2);
  const bombMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.65 });
  for (let i = 0; i < CFG.budget.bombs; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bombGeo, bombMat);
    body.castShadow = true;
    g.add(body);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.5), bombMat);
    fin.position.z = -0.5; g.add(fin);
    const fin2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.5), bombMat);
    fin2.position.z = -0.5; g.add(fin2);
    g.visible = false;
    scene.add(g);
    P.bombs.push({ obj: g, active: false, vx: 0, vy: 0, vz: 0, team: 'red' });
  }
  return P;
}

/* ---------- Mermi ---------- */
export function getBullet() {
  const n = P.bullets.length;
  for (let i = 0; i < n; i++) {
    const k = (P.bulletCursor + i) % n;
    if (!P.bullets[k].active) { P.bulletCursor = (k + 1) % n; return P.bullets[k]; }
  }
  P.bulletCursor = (P.bulletCursor + 1) % n;
  return P.bullets[P.bulletCursor];
}

export function spawnBullet(origin, dir, opts) {
  const b = getBullet();
  b.active = true;
  b.mesh.visible = true;
  b.mesh.material = opts.team === 'blue' ? P.bulletMatBlue : P.bulletMatRed;
  b.mesh.position.copy(origin);
  if (opts.scale) b.mesh.scale.set(opts.scale, opts.scale, opts.scale);
  b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  b.dir.copy(dir);
  b.speed = opts.speed || 95;
  b.life = opts.life || 1.9;
  b.damage = opts.damage || 20;
  b.team = opts.team;
  b.owner = opts.owner || null;
  b.splash = opts.splash || 0;
  b.kind = opts.kind || 'bullet';
  return b;
}

export function updateBullets(dt) {
  const W = CFG.world;
  for (const b of P.bullets) {
    if (!b.active) continue;
    b.life -= dt;
    if (b.life <= 0) { b.active = false; b.mesh.visible = false; continue; }

    const nx = b.mesh.position.x + b.dir.x * b.speed * dt;
    const ny = b.mesh.position.y + b.dir.y * b.speed * dt;
    const nz = b.mesh.position.z + b.dir.z * b.speed * dt;

    // zemin teması
    if (ny <= groundHeight(nx, nz) * 0.6) {
      b.active = false; b.mesh.visible = false;
      impactDust(nx, ny, nz, 0.5);
      if (b.splash) explode(nx, groundHeight(nx, nz) + 0.3, nz, 1.1, b.team);
      continue;
    }
    // harita dışı
    if (Math.abs(nx) > W.half + 10 || Math.abs(nz) > W.half + 10) {
      b.active = false; b.mesh.visible = false; continue;
    }

    b.mesh.position.set(nx, ny, nz);

    let hit = null;
    for (const u of state.units) {
      if (!u.alive || u.team === b.team) continue;
      const rr = u.radius;
      const dy = ny - (u.pos.y + (u.kind === 'hq' ? 2.0 : (u.kind === 'bomber' ? 0 : u.hitHeight)));
      const dx = nx - u.pos.x, dz = nz - u.pos.z;
      if (dx * dx + dy * dy + dz * dz <= rr * rr) { hit = u; break; }
    }
    if (hit) {
      if (b.splash) {
        explode(nx, ny, nz, 1.4, b.team);
        applySplash(nx, nz, b.splash, b.damage, b.team, b.owner);
      } else {
        hit.takeDamage(b.damage, nx, ny, nz, b.owner);
      }
      b.active = false; b.mesh.visible = false;
    }
  }
}

function applySplash(x, z, radius, damage, team, owner) {
  for (const u of state.units) {
    if (!u.alive || u.team === team) continue;
    const d = dist2D(u.pos.x, u.pos.z, x, z);
    if (d < radius + u.radius) {
      const falloff = clamp(1 - d / (radius + u.radius), 0, 1);
      u.takeDamage(damage * (0.4 + 0.6 * falloff), u.pos.x, u.pos.y + 1, u.pos.z, owner);
    }
  }
}
export { applySplash };

/* ---------- Bomba ---------- */
export function spawnBomb(pos, vx, vy, vz, team) {
  const n = P.bombs.length;
  for (let i = 0; i < n; i++) {
    const k = (P.bombCursor + i) % n;
    if (!P.bombs[k].active) {
      P.bombCursor = (k + 1) % n;
      const b = P.bombs[k];
      b.active = true;
      b.obj.visible = true;
      b.obj.position.copy(pos);
      b.vx = vx; b.vy = vy; b.vz = vz;
      b.team = team;
      return b;
    }
  }
  return null;
}

export function updateBombs(dt) {
  for (const b of P.bombs) {
    if (!b.active) continue;
    b.vy -= 26 * dt;
    b.obj.position.x += b.vx * dt;
    b.obj.position.y += b.vy * dt;
    b.obj.position.z += b.vz * dt;
    b.obj.rotation.x += dt * 3.2;
    const gh = groundHeight(b.obj.position.x, b.obj.position.z);
    if (b.obj.position.y <= gh + 0.25) {
      b.active = false;
      b.obj.visible = false;
      const x = b.obj.position.x, z = b.obj.position.z;
      explode(x, gh + 0.4, z, 1.5, b.team);
      applySplash(x, z, 11.5, 86, b.team, null);
      state.cam.shake = Math.min(3.4, state.cam.shake + 1.5);
    }
  }
}

export function resetProjectiles() {
  for (const b of P.bullets) { b.active = false; b.mesh.visible = false; }
  for (const b of P.bombs) { b.active = false; b.obj.visible = false; }
}

export { P as projectileStore };
