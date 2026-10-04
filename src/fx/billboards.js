/* ============================================================
   NEON FRONT 2.0 — sinematik billboard havuzları
   Kameraya bakan düzlemler üzerinde prosedürel GLSL alev/duman.
   Doku dosyası kullanılmaz.
   ============================================================ */
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { CFG } from '../config.js';
import { GLSL_NOISE, lerp, clamp } from '../core/utils.js';

const BB_VERT = `
varying vec2 vBuv;
void main() {
  vBuv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BB_FIRE_FRAG = `
uniform float uTime; uniform float uAlpha; uniform float uSeed;
uniform vec3 uHot; uniform vec3 uMid; uniform vec3 uCool;
varying vec2 vBuv;
${GLSL_NOISE}
void main() {
  vec2 p = vBuv - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;
  float n  = vfx_fbm(vec3(p * 3.2, uSeed + uTime * 0.45));
  float n2 = vfx_vn(vec3(p * 7.5, uSeed * 1.7 - uTime * 0.8));
  float mask = (1.0 - smoothstep(0.10, 1.0, r)) * (0.42 + 0.88 * n) * (0.68 + 0.42 * n2);
  vec3 col = mix(uCool, uMid, smoothstep(0.05, 0.50, mask));
  col = mix(col, uHot, smoothstep(0.55, 1.05, mask));
  float a = clamp(mask, 0.0, 1.0) * uAlpha * (1.0 - smoothstep(0.70, 1.0, r));
  gl_FragColor = vec4(col, a);
}`;

const BB_SMOKE_FRAG = `
uniform float uTime; uniform float uAlpha; uniform float uSeed; uniform float uGrey;
varying vec2 vBuv;
${GLSL_NOISE}
void main() {
  vec2 p = vBuv - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;
  float n  = vfx_fbm(vec3(p * 2.4, uSeed + uTime * 0.18));
  float n2 = vfx_vn(vec3(p * 5.0, uSeed * 2.3 - uTime * 0.26));
  float mask = clamp((1.0 - smoothstep(0.05, 1.0, r)) * (0.40 + 0.80 * n) * (0.72 + 0.40 * n2), 0.0, 1.0);
  float a = mask * uAlpha * (1.0 - smoothstep(0.65, 1.0, r));
  vec3 col = mix(vec3(0.11, 0.105, 0.10), vec3(0.80, 0.80, 0.82), uGrey);
  col *= 0.55 + 0.75 * mask;
  gl_FragColor = vec4(col, a);
}`;

export class BillboardPool {
  constructor(capacity, kind, scene) {
    this.kind = kind;
    this.capacity = capacity;
    this.items = [];
    this.time = 0;
    this.geo = new THREE.PlaneGeometry(1, 1);
    const isFire = kind === 'fire';
    for (let i = 0; i < capacity; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 40 },
          uGrey: { value: 0.5 },
          uHot: { value: new THREE.Color(0xfff8e0) },
          uMid: { value: new THREE.Color(0xff9c2a) },
          uCool: { value: new THREE.Color(0x7d1a04) }
        },
        vertexShader: BB_VERT,
        fragmentShader: isFire ? BB_FIRE_FRAG : BB_SMOKE_FRAG,
        transparent: true, depthWrite: false, depthTest: true,
        blending: isFire ? THREE.AdditiveBlending : THREE.NormalBlending,
        side: THREE.DoubleSide
      });
      const m = new THREE.Mesh(this.geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = isFire ? 12 : 11;
      scene.add(m);
      this.items.push({ mesh: m, mat, active: false, t: 0, dur: 1, s0: 1, s1: 4, rise: 0, a0: 1, x: 0, y: 0, z: 0 });
    }
    this.cursor = 0;
  }

  spawn(cfg) {
    for (let i = 0; i < this.capacity; i++) {
      const k = (this.cursor + i) % this.capacity;
      const it = this.items[k];
      if (it.active) continue;
      this.cursor = (k + 1) % this.capacity;
      it.active = true; it.t = 0;
      it.dur = cfg.dur || 1;
      it.s0 = cfg.s0 === undefined ? 1 : cfg.s0;
      it.s1 = cfg.s1 === undefined ? 4 : cfg.s1;
      it.rise = cfg.rise || 0;
      it.a0 = cfg.a0 === undefined ? 1 : cfg.a0;
      it.x = cfg.x; it.y = cfg.y; it.z = cfg.z;
      it.mesh.visible = true;
      it.mat.uniforms.uSeed.value = cfg.seed === undefined ? Math.random() * 40 : cfg.seed;
      if (cfg.grey !== undefined) it.mat.uniforms.uGrey.value = cfg.grey;
      if (cfg.hot !== undefined) it.mat.uniforms.uHot.value.set(cfg.hot);
      if (cfg.mid !== undefined) it.mat.uniforms.uMid.value.set(cfg.mid);
      if (cfg.cool !== undefined) it.mat.uniforms.uCool.value.set(cfg.cool);
      return it;
    }
    return null;
  }

  update(dt) {
    this.time += dt;
    const cam = engine.cam;
    for (let i = 0; i < this.capacity; i++) {
      const it = this.items[i];
      if (!it.active) continue;
      it.t += dt;
      const t = it.t / it.dur;
      if (t >= 1) {
        it.active = false;
        it.mesh.visible = false;
        it.mat.uniforms.uAlpha.value = 0;
        continue;
      }
      const grow = 1 - Math.pow(1 - t, 2.6);
      const s = lerp(it.s0, it.s1, grow);
      it.mesh.position.set(it.x, it.y + it.rise * t, it.z);
      it.mesh.scale.set(s, s, 1);
      it.mesh.quaternion.copy(cam.quaternion);
      const fade = t < 0.14 ? (t / 0.14) : (1 - (t - 0.14) / 0.86);
      it.mat.uniforms.uAlpha.value = it.a0 * Math.pow(clamp(fade, 0, 1), 0.75);
      it.mat.uniforms.uTime.value = this.time;
    }
  }

  reset() {
    for (let i = 0; i < this.capacity; i++) {
      this.items[i].active = false;
      this.items[i].mesh.visible = false;
      this.items[i].mat.uniforms.uAlpha.value = 0;
    }
    this.time = 0;
  }
}

export const billboards = { fire: null, smoke: null };

export function initBillboards(scene) {
  const B = CFG.budget;
  billboards.fire = new BillboardPool(B.fireBillboards, 'fire', scene);
  billboards.smoke = new BillboardPool(B.smokeBillboards, 'smoke', scene);
  return billboards;
}

export function updateBillboards(dt) {
  if (billboards.fire) billboards.fire.update(dt);
  if (billboards.smoke) billboards.smoke.update(dt);
}

export function resetBillboards() {
  if (billboards.fire) billboards.fire.reset();
  if (billboards.smoke) billboards.smoke.reset();
}
