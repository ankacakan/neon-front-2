/* ============================================================
   NEON FRONT 2.0 — birim sınıfı (tank / topçu / piyade / helikopter /
   karargah / bombardıman uçağı)
   ============================================================ */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { state, addUnit, removeUnit } from '../core/state.js';
import { rand, TAU, clamp, damp, angLerp, angDiff, dist2D, dist3D } from '../core/utils.js';
import { groundHeight, walkableAt } from '../world/mapgen.js';
import { findPath } from '../systems/pathfinding.js';
import { thinkAI } from '../systems/ai.js';
import { scanTarget, canEngage } from '../systems/combat.js';
import { buildUnitMesh } from './models.js';
import { spawnBullet, spawnBomb } from '../fx/projectiles.js';
import { explode, muzzleFlash } from '../fx/explosions.js';
import { spawnRing, spawnScorch } from '../fx/decals.js';
import { pools } from '../fx/particles.js';

const _origin = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);
const FOG_HEX = CFG.fog.color;

export class Unit {
  constructor(cfg) {
    const def = CFG.units[cfg.kind];
    this.team = cfg.team;
    this.kind = cfg.kind;
    this.def = def;
    this.alive = true;

    this.radius = cfg.radius || def.radius;
    this.maxHp = cfg.hp || def.hp;
    this.hp = this.maxHp;
    this.speed = cfg.speed !== undefined ? cfg.speed : rand(def.speed[0], def.speed[1]);
    this.turnSpeed = def.turnSpeed;
    this.range = cfg.range || def.range;
    this.minRange = def.minRange || 0;
    this.detect = def.detect;
    this.damage = cfg.damage !== undefined ? cfg.damage : def.damage;
    this.fireInterval = cfg.fireInterval || def.fireInterval;
    this.turretSpeed = def.turretSpeed;
    this.projectile = cfg.projectile || def.projectile;
    this.rail = def.rail;
    this.splash = def.splash || 0;
    this.altitude = def.altitude || 0;
    this.hitHeight = cfg.hitHeight || (this.kind === 'infantry' ? 0.9 : (this.kind === 'hq' ? 2.0 : 1.0));

    this.cool = rand(0, 0.8);
    this.target = null;
    this.scanCd = rand(0, 0.3);
    this.yaw = cfg.team === 'blue' ? Math.PI * 0.5 : -Math.PI * 0.5;
    this.turretYaw = this.yaw;
    this.pos = new THREE.Vector3(cfg.x, 0, cfg.z);
    this.path = null; this.pathIdx = 0; this.moveGoal = null;
    this.repathCd = 0;
    this.bob = rand(0, TAU);
    this.hitFlash = 0;
    this.hpBarTimer = 0;

    if (this.rail === 'air') this.pos.y = this.altitude;

    /* --- Mesh --- */
    const m = buildUnitMesh(this.kind, this.team, state.engine.scene);
    this.mesh = m.group;
    this.turretGroup = m.turretGroup;
    this.muzzle = m.muzzle;
    this.props = m.props || [];
    this.flag = m.flag;
    this.selRing = m.selRing;
    this.hpBar = m.hpBar;
    this.hpBarHeight = m.hpBarHeight;

    if (this.rail === 'air') this.pos.y = this.altitude;
    this.mesh.position.copy(this.pos);
    addUnit(this);

    /* Hava birimleri yerden yüksek durur: gölge için */
    if (this.rail === 'air') {
      for (const c of this.mesh.children) c.castShadow = false;
    }
  }

  setSelected(on) {
    if (!this.selRing) return;
    this.selRing.visible = !!on;
    if (on) this.selRing.material.color.set(this.team === 'blue' ? 0x7fe3ff : 0xff9a9a);
  }

  orderMove(tx, tz) {
    if (this.kind === 'hq' || this.kind === 'bomber') return;
    const p = findPath(this.pos.x, this.pos.z, tx, tz);
    if (p && p.length) { this.path = p; this.pathIdx = 0; this.moveGoal = { x: tx, z: tz }; }
    else { this.path = [{ x: tx, z: tz }]; this.pathIdx = 0; this.moveGoal = { x: tx, z: tz }; }
  }

  orderAttack(targetUnit) {
    this.target = targetUnit;
    if (targetUnit && this.kind !== 'hq' && this.rail !== 'air') {
      const ang = rand(0, TAU);
      const ox = targetUnit.pos.x + Math.cos(ang) * (targetUnit.radius + this.range * 0.6);
      const oz = targetUnit.pos.z + Math.sin(ang) * (targetUnit.radius + this.range * 0.6);
      this.orderMove(ox, oz);
    }
  }

  scan() { return scanTarget(this); }

  takeDamage(amount, hx, hy, hz, attacker) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 0.14;
    this.hpBarTimer = 4.5;
    if (attacker) this.lastAttacker = attacker;
    if (hx !== undefined) {
      pools.fire.spawn({
        x: hx, y: hy, z: hz, vx: rand(-3, 3), vy: rand(1, 4), vz: rand(-3, 3),
        life: rand(0.12, 0.3), s0: 0.55, s1: 0.1, grav: 2, drag: 0.05,
        c0: Math.random() < 0.5 ? 0xffe08a : 0xff9a3c, c1: 0x000000
      });
    }
    if (this.hp <= 0) this.die();
  }

  despawn() {
    if (!this.alive) return;
    this.alive = false;
    this.setSelected(false);
    state.engine.scene.remove(this.mesh);
    state.engine.scene.remove(this.hpBar.group);
    removeUnit(this);
  }

  die() {
    if (!this.alive) return;
    this.alive = false;

    state.engine.scene.remove(this.mesh);
    state.engine.scene.remove(this.hpBar.group);

    const P = this.kind === 'hq' ? 3.6 : (this.rail === 'air' ? 1.7 : 1.15);
    explode(this.pos.x, this.pos.y + (this.rail === 'air' ? 0 : 0.9), this.pos.z, P, this.team);
    if (this.rail === 'ground' && this.kind !== 'hq') {
      spawnRing(this.pos.x, this.pos.y + 0.1, this.pos.z, 1, 16, 0.5, 0xff8c3c);
      spawnScorch(this.pos.x, 0, this.pos.z, 4.4, 0.5);
    }
    if (this.rail === 'air') {
      pools.smoke.spawn({
        x: this.pos.x, y: this.pos.y, z: this.pos.z, vx: 0, vy: -2, vz: 0,
        life: 2.4, s0: 1.4, s1: 4.5, grav: 0.4, drag: 0.3, c0: 0x707070, c1: FOG_HEX
      });
    }

    if (this.team === 'blue') state.stats.lost++;
    else state.stats.kills++;

    removeUnit(this);

    if (this.kind === 'hq') {
      if (state.onHQDown) state.onHQDown(this.team);
    }
  }

  /* ---------- Ateş ---------- */
  fireAt(tgt) {
    if (!this.muzzle) return;
    this.muzzle.getWorldPosition(_origin);
    _aim.set(tgt.pos.x, tgt.pos.y + tgt.hitHeight, tgt.pos.z);
    _dir.copy(_aim).sub(_origin).normalize();

    if (this.projectile === 'arc') {
      // Balkabağı yörüngesi: hedefe düşecek ilk hızı hesapla
      const dx = tgt.pos.x - _origin.x, dz = tgt.pos.z - _origin.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const T = clamp(d / 26, 0.7, 2.2);
      const g = 26;
      const vy = (_aim.y - _origin.y + 0.5 * g * T * T) / T;
      spawnBomb(_origin.clone(), dx / T, vy, dz / T, this.team);
      muzzleFlash(_origin.x, _origin.y, _origin.z, _dir, this.team);
      return;
    }

    spawnBullet(_origin, _dir, {
      team: this.team, damage: this.damage, owner: this,
      speed: this.kind === 'hq' ? 110 : 95,
      life: 1.9, splash: this.splash
    });
    muzzleFlash(_origin.x, _origin.y, _origin.z, _dir, this.team);
  }

  /* ---------- Ana güncelleme ---------- */
  update(dt) {
    if (!this.alive) return;

    if (this.kind === 'bomber') { this.updateBomber(dt); return; }

    /* Hedef tarama */
    this.scanCd -= dt;
    if (this.scanCd <= 0 || !this.target || !this.target.alive) {
      this.scanCd = rand(0.22, 0.42);
      this.scan();
    }
    const tgt = this.target;

    /* Nişan + ateş */
    if (tgt && tgt.alive && this.rail !== 'air') {
      const dx = tgt.pos.x - this.pos.x;
      const dz = tgt.pos.z - this.pos.z;
      const desired = Math.atan2(dx, dz);
      if (this.turretGroup) this.turretYaw = angLerp(this.turretYaw, desired, dt * this.turretSpeed);
      if (canEngage(this, tgt) && Math.abs(angDiff(this.turretYaw, desired)) < 0.16) {
        this.cool -= dt;
        if (this.cool <= 0) {
          this.cool = this.fireInterval;
          this.fireAt(tgt);
        }
      } else if (this.cool > 0) {
        this.cool -= dt;
      }
    } else if (this.cool > 0) {
      this.cool -= dt;
    }

    /* Yapay zekâ kararları */
    thinkAI(this, dt);

    /* Hareket */
    if (this.kind === 'hq') {
      this.pos.y = 0;
      this.mesh.position.set(this.pos.x, 0, this.pos.z);
    } else if (this.rail === 'air') {
      this.updateFlying(dt);
    } else {
      let moving = false;

      if (this.path && this.pathIdx < this.path.length) {
        const node = this.path[this.pathIdx];
        const nx = node.x - this.pos.x, nz = node.z - this.pos.z;
        const nd = Math.sqrt(nx * nx + nz * nz);
        if (nd < 1.4) {
          this.pathIdx++;
          if (this.pathIdx >= this.path.length) { this.path = null; this.moveGoal = null; }
        } else {
          const wantYaw = Math.atan2(nx, nz);
          this.yaw = angLerp(this.yaw, wantYaw, dt * this.turnSpeed);
          const facing = Math.cos(angDiff(this.yaw, wantYaw));
          if (facing > 0.55) {
            const adv = this.speed * dt * (0.35 + 0.65 * facing);
            const sx = this.pos.x + Math.sin(this.yaw) * adv;
            const sz = this.pos.z + Math.cos(this.yaw) * adv;
            if (walkableAt(sx, sz)) { this.pos.x = sx; this.pos.z = sz; }
            else { this.path = null; this.moveGoal = null; }
            moving = true;
          }
        }
      }

      /* Birlik ayrımı */
      const sep = CFG.ai.separation;
      for (const o of state.units) {
        if (o === this || !o.alive || o.rail === 'air') continue;
        if (o.kind === 'bomber') continue;
        const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
        const d2 = ox * ox + oz * oz;
        const minD = (this.radius + o.radius) * sep * 0.9;
        if (d2 > 0.0001 && d2 < minD * minD) {
          const dl = Math.sqrt(d2);
          const push = (minD - dl) * 0.5;
          this.pos.x += (ox / dl) * push;
          this.pos.z += (oz / dl) * push;
        }
      }

      const gh = groundHeight(this.pos.x, this.pos.z);
      this.pos.y = damp(this.pos.y, gh, 9, dt);
      this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.mesh.rotation.y = this.yaw;
      this.mesh.rotation.z = moving ? Math.sin(performance.now() * 0.02) * 0.012 : 0;
      if (moving && this.kind === 'tank' && Math.random() < 0.25) {
        pools.smoke.spawn({
          x: this.pos.x - Math.sin(this.yaw) * 1.6, y: this.pos.y + 0.3, z: this.pos.z - Math.cos(this.yaw) * 1.6,
          vx: rand(-0.5, 0.5), vy: rand(0.4, 1.2), vz: rand(-0.5, 0.5),
          life: rand(0.6, 1.2), s0: 0.25, s1: 1.1, grav: -0.2, drag: 0.2, c0: 0x9a8f76, c1: FOG_HEX
        });
      }
    }

    if (this.turretGroup) {
      this.turretGroup.rotation.y = this.kind === 'hq' ? this.turretYaw : (this.turretYaw - this.yaw);
    }

    if (this.hitFlash > 0) { this.hitFlash -= dt; this.mesh.visible = Math.floor(this.hitFlash * 40) % 2 === 0; }
    else if (!this.mesh.visible) this.mesh.visible = true;

    this.updateHpBar(dt);
  }

  /* ---------- Uçan birimler (helikopter) ---------- */
  updateFlying(dt) {
    // hedefe doğru süzül
    let tx = this.pos.x, tz = this.pos.z;
    const tgt = this.target;
    const dest = this.moveGoal || (tgt && tgt.alive ? tgt : null);
    if (dest) {
      const ddx = dest.pos ? dest.pos.x - this.pos.x : dest.x - this.pos.x;
      const ddz = dest.pos ? dest.pos.z - this.pos.z : dest.z - this.pos.z;
      const dl = Math.sqrt(ddx * ddx + ddz * ddz);
      if (dl > this.range * 0.62) { tx = this.pos.x + (ddx / dl) * this.speed * dt; tz = this.pos.z + (ddz / dl) * this.speed * dt; }
    }
    if (walkableAt(tx, tz)) { this.pos.x = tx; this.pos.z = tz; }

    const wantYaw = tgt && tgt.alive ? Math.atan2(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z) : this.yaw;
    this.yaw = angLerp(this.yaw, wantYaw, dt * this.turnSpeed);
    this.bob += dt * 3.0;
    this.pos.y = this.altitude + Math.sin(this.bob) * 0.6;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    this.mesh.rotation.z = Math.sin(this.bob * 0.8) * 0.05;
    this.mesh.rotation.x = Math.sin(this.bob * 0.6) * 0.03;

    const spin = dt * 30;
    for (const p of this.props) p.rotation.y += spin;

    /* Havadan ateş */
    if (tgt && tgt.alive && this.muzzle) {
      const d3 = dist3D(this.pos.x, this.pos.y, this.pos.z, tgt.pos.x, tgt.pos.y, tgt.pos.z);
      if (d3 < this.range) {
        this.cool -= dt;
        if (this.cool <= 0) { this.cool = this.fireInterval; this.fireAt(tgt); }
      }
    }
    this.updateHpBar(dt);
  }

  /* ---------- Can barı ---------- */
  updateHpBar(dt) {
    this.hpBarTimer -= dt;
    const frac = clamp(this.hp / this.maxHp, 0, 1);
    const show = this.hpBarTimer > 0 && frac < 0.999 && this.kind !== 'bomber';
    this.hpBar.group.visible = show;
    if (!show) return;
    const cam = state.engine.cam;
    this.hpBar.group.position.set(this.pos.x, this.pos.y + this.hpBarHeight, this.pos.z);
    this.hpBar.group.quaternion.copy(cam.quaternion);
    this.hpBar.fill.scale.x = Math.max(0.001, frac);
    this.hpBar.fill.position.x = -(1 - frac) * 1.5;
    this.hpBar.fill.material.color.setHex(frac > 0.55 ? 0x55e08a : (frac > 0.28 ? 0xffcf4d : 0xff4d5e));
  }

  /* ---------- Bombardıman uçağı ---------- */
  setupBomber(from, to, drops, team) {
    this.flightFrom = from;
    this.flightTo = to;
    this.drops = drops || [];
    this.team = team || this.team;
    this.flightDir = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
    this.pos.set(from.x, this.altitude, from.z);
    this.yaw = Math.atan2(this.flightDir.x, this.flightDir.z);
    this.bombsLeft = this.drops.length;
  }

  updateBomber(dt) {
    this.pos.x += this.flightDir.x * this.speed * dt;
    this.pos.z += this.flightDir.z * this.speed * dt;
    this.bob += dt * 2.2;
    this.pos.y = this.altitude + Math.sin(this.bob) * 0.5;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    this.mesh.rotation.z = Math.sin(this.bob * 0.7) * 0.06;
    this.mesh.rotation.x = Math.sin(this.bob * 0.5) * 0.025;

    const spin = dt * 26;
    for (const p of this.props) p.rotation.z += spin;

    if (this.drops.length) {
      const d = this.drops[0];
      const dist = dist2D(this.pos.x, this.pos.z, d.x, d.z);
      const approaching = (this.flightDir.x * (d.x - this.pos.x) + this.flightDir.z * (d.z - this.pos.z)) > 0;
      if (dist < 7.5 && approaching) {
        this.drops.shift();
        spawnBomb(this.pos.clone().setY(this.pos.y - 1.2),
          this.flightDir.x * this.speed, -2, this.flightDir.z * this.speed, this.team);
      }
    }

    if (Math.abs(this.pos.x) > CFG.world.half + 60 || Math.abs(this.pos.z) > CFG.world.half + 60) {
      this.despawn();
    }
    this.updateHpBar(dt);
  }
}

/* ---------------------------------------------------------------
   Birim fabrikaları
   --------------------------------------------------------------- */
export function spawnTank(team, x, z, opts = {}) {
  const u = new Unit({ team, kind: 'tank', x, z, hp: opts.hp, speed: opts.speed, fireInterval: opts.fireInterval });
  const ang = rand(0, TAU);
  u.yaw = ang; u.turretYaw = ang;
  return u;
}

export function spawnUnit(kind, team, x, z, opts = {}) {
  return new Unit({ team, kind, x, z, ...opts });
}

export function spawnHQ(team, x, z) {
  return new Unit({ team, kind: 'hq', x, z });
}

export function callAirstrike(team, tx, tz, count) {
  count = count || 3;
  const baseAng = rand(0, TAU);
  for (let i = 0; i < count; i++) {
    const lateral = (i - (count - 1) / 2) * 13;
    const dirX = Math.cos(baseAng), dirZ = Math.sin(baseAng);
    const perpX = -dirZ, perpZ = dirX;
    const fromX = tx + dirX * 165 + perpX * lateral;
    const fromZ = tz + dirZ * 165 + perpZ * lateral;
    const toX = tx - dirX * 165 + perpX * lateral;
    const toZ = tz - dirZ * 165 + perpZ * lateral;
    const drops = [];
    for (let k = -2; k <= 2; k++) {
      drops.push({ x: tx + dirX * k * 7.5 + perpX * lateral * 0.35, z: tz + dirZ * k * 7.5 + perpZ * lateral * 0.35 });
    }
    drops.sort((a, b) => dist2D(fromX, fromZ, a.x, a.z) - dist2D(fromX, fromZ, b.x, b.z));
    const u = new Unit({ team, kind: 'bomber', x: fromX, z: fromZ });
    u.setupBomber({ x: fromX, z: fromZ }, { x: toX, z: toZ }, drops, team);
  }
  spawnRing(tx, 0.15, tz, 4, 34, 1.2, team === 'blue' ? 0x7fe3ff : 0xff8c6a);
  spawnRing(tx, 0.15, tz, 2, 22, 0.9, 0xffffff);
}
