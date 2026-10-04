/* ============================================================
   NEON FRONT 2.0 — GPU parçacık havuzları (InstancedMesh küreler)
   Alev, duman ve enkaz için ön-tahsisli havuzlar; çalışma anında
   yeni nesne üretilmez.
   ============================================================ */
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { CFG } from '../config.js';
import { lerp, clamp } from '../core/utils.js';

/* Alev için instance başına alfa attribute'u ekler */
export function makeParticleMaterial(mat) {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aAlpha;\nvarying float vPartAlpha;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'void main() {\n\tvPartAlpha = aAlpha;');
    shader.fragmentShader = 'varying float vPartAlpha;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n\tdiffuseColor.a *= vPartAlpha;'
    );
  };
  mat.needsUpdate = true;
  return mat;
}

export class ParticlePool {
  constructor(capacity, material, scene, opts = {}) {
    const geo = new THREE.SphereGeometry(1, 7, 5);
    this.capacity = capacity;
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAlpha', this.aAlpha);

    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder === undefined ? 6 : opts.renderOrder;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);

    this.parts = [];
    this.free = [];
    for (let i = 0; i < capacity; i++) {
      this.parts.push({
        active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, s0: 1, s1: 1, grav: 0, drag: 1,
        c0: new THREE.Color(1, 1, 1), c1: new THREE.Color(0, 0, 0), bounce: false
      });
      this.free.push(capacity - 1 - i);
    }
    this.zero = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this._c.setRGB(1, 1, 1));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.activeCount = 0;
  }

  spawn(cfg) {
    const idx = this.free.pop();
    if (idx === undefined) return null;
    const p = this.parts[idx];
    p.active = true;
    p.x = cfg.x; p.y = cfg.y; p.z = cfg.z;
    p.vx = cfg.vx || 0; p.vy = cfg.vy || 0; p.vz = cfg.vz || 0;
    p.maxLife = cfg.life || 1;
    p.life = p.maxLife;
    p.s0 = cfg.s0 === undefined ? 1 : cfg.s0;
    p.s1 = cfg.s1 === undefined ? 0.1 : cfg.s1;
    p.grav = cfg.grav || 0;
    p.drag = cfg.drag === undefined ? 0.25 : cfg.drag;
    p.bounce = !!cfg.bounce;
    p.c0.set(cfg.c0 === undefined ? 0xffffff : cfg.c0);
    p.c1.set(cfg.c1 === undefined ? 0x000000 : cfg.c1);
    this.activeCount++;
    return p;
  }

  reset() {
    this.free.length = 0;
    for (let i = 0; i < this.capacity; i++) {
      this.parts[i].active = false;
      this.mesh.setMatrixAt(i, this.zero);
      this.free.push(this.capacity - 1 - i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.activeCount = 0;
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.parts[i];
      if (!p.active) continue;
      dirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.mesh.setMatrixAt(i, this.zero);
        this.free.push(i);
        this.activeCount--;
        continue;
      }
      p.vy += p.grav * dt;
      const d = Math.pow(p.drag, dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.bounce && p.y < 0.35) { p.y = 0.35; p.vy = Math.abs(p.vy) * 0.32; p.vx *= 0.6; p.vz *= 0.6; }

      const t = 1 - p.life / p.maxLife;
      let size = lerp(p.s0, p.s1, t);
      if (size < 0.012) size = 0.012;
      this._m.makeScale(size, size, size);
      this._m.setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, this._m);
      this._c.copy(p.c0).lerp(p.c1, t);
      this.mesh.setColorAt(i, this._c);

      const a = t < 0.10 ? (t / 0.10) : (1 - (t - 0.10) / 0.90);
      this.aAlpha.array[i] = Math.pow(clamp(a, 0, 1), 0.85);
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.aAlpha.needsUpdate = true;
    }
  }
}

export const pools = { fire: null, smoke: null, debris: null };

export function initParticles(scene) {
  const B = CFG.budget;
  pools.fire = new ParticlePool(
    B.fireParticles,
    makeParticleMaterial(new THREE.MeshBasicMaterial({ fog: false })),
    scene, { renderOrder: 8 }
  );
  pools.smoke = new ParticlePool(
    B.smokeParticles,
    makeParticleMaterial(new THREE.MeshLambertMaterial({ fog: true, opacity: 0.85 })),
    scene, { renderOrder: 7 }
  );
  pools.debris = new ParticlePool(
    B.debrisParticles,
    makeParticleMaterial(new THREE.MeshLambertMaterial({ fog: true, opacity: 1 })),
    scene, { renderOrder: 5 }
  );
  return pools;
}

export function resetParticles() {
  if (pools.fire) pools.fire.reset();
  if (pools.smoke) pools.smoke.reset();
  if (pools.debris) pools.debris.reset();
}

export function updateParticles(dt) {
  if (pools.fire) pools.fire.update(dt);
  if (pools.smoke) pools.smoke.update(dt);
  if (pools.debris) pools.debris.update(dt);
}
