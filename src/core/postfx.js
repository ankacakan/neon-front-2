/* ============================================================
   NEON FRONT 2.0 — sinematik post-processing
   Render → SSAO → Bloom → tilt-shift DOF + grade → SMAA
   Referanstaki "minyatür diorama" hissinin ana kaynağı.
   ============================================================ */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { CFG } from '../config.js';
import { engine } from './engine.js';
import { state } from './state.js';

export const postfx = {
  composer: null,
  renderPass: null,
  ssao: null,
  bloom: null,
  grade: null,
  smaa: null,
  enabled: CFG.postfx.enabled,
  time: 0
};

/* -*-*-*-*- Tilt-shift DOF + renk derecelendirme shader'ı -*-*-*-*- */
const GradeTiltShift = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFocusCenter: { value: 0.52 },   // ekranın hangi yüksekliği net
    uFocusRange: { value: 0.10 },    // net bant kalınlığı
    uBlurMax: { value: 3.2 },        // piksel cinsinden maksimum bulanıklık
    uVignette: { value: 0.30 },
    uSaturation: { value: 1.10 },
    uContrast: { value: 1.06 },
    uLift: { value: new THREE.Vector3(0.004, 0.006, 0.010) },
    uGain: { value: new THREE.Vector3(1.03, 1.000, 0.965) },
    uGrain: { value: 0.035 },
    uChromatic: { value: 0.0009 },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uFocusCenter, uFocusRange, uBlurMax, uVignette;
    uniform float uSaturation, uContrast, uGrain, uChromatic;
    uniform vec3 uLift, uGain;
    uniform vec2 uTexel;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float r2 = dot(center, center);

      // --- Tilt-shift bulanıklık: net banttan uzaklık ---
      float distBand = abs(uv.y - uFocusCenter);
      float blurAmt = smoothstep(uFocusRange, uFocusRange + 0.42, distBand);
      blurAmt *= blurAmt;
      vec2 blurStep = uTexel * uBlurMax * blurAmt;

      // --- Renk sapması (kromatik aberasyon) ---
      vec2 ca = center * uChromatic * (1.0 + r2 * 3.0);

      vec3 col = vec3(0.0);
      if (blurAmt < 0.01) {
        col.r = texture2D(tDiffuse, uv - ca).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv + ca).b;
      } else {
        // 9 örnekli ayrık bulanıklık
        vec3 sum = vec3(0.0);
        float wsum = 0.0;
        for (int i = -2; i <= 2; i++) {
          for (int j = -2; j <= 2; j++) {
            vec2 o = vec2(float(i), float(j)) * blurStep;
            float w = 1.0 / (1.0 + float(i*i + j*j));
            sum.r += texture2D(tDiffuse, uv + o - ca).r * w;
            sum.g += texture2D(tDiffuse, uv + o).g * w;
            sum.b += texture2D(tDiffuse, uv + o + ca).b * w;
            wsum += w;
          }
        }
        col = sum / wsum;
      }

      // --- Lift / Gain ---
      col = col * uGain + uLift;

      // --- Doygunluk ---
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // --- Kontrast ---
      col = (col - 0.5) * uContrast + 0.5;

      // --- Vinyet ---
      float vig = smoothstep(0.95, 0.22, r2 * 2.1);
      col *= mix(1.0 - uVignette, 1.0, vig);

      // --- Film greni ---
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`
};

export function initPostFX() {
  const renderer = engine.renderer;
  const scene = engine.scene;
  const cam = engine.cam;
  const w = window.innerWidth, h = window.innerHeight;

  try {
    const composer = new EffectComposer(renderer);
    composer.setSize(w, h);
    engine.composer = composer;
    postfx.composer = composer;

    const renderPass = new RenderPass(scene, cam);
    composer.addPass(renderPass);
    postfx.renderPass = renderPass;

    // SSAO — ayarlanabilir ölçek (varsayılan yarım çözünürlük).
    // Not: three@0.186 SSAOPass 'scale' alanı sunmaz; bu yüzden iç
    // hedefleri (normal/AO/blur) küçük boyutta kuruyoruz, kompozit
    // yine tam çözünürlükte yapılır. resizePostFX de ölçeği korur.
    try {
      const ssaoScale = CFG.postfx.ssao.scale || 1;
      const sw = Math.max(1, Math.round(w * ssaoScale));
      const sh = Math.max(1, Math.round(h * ssaoScale));
      const ssao = new SSAOPass(scene, cam, sw, sh);
      ssao.kernelRadius = CFG.postfx.ssao.radius;
      ssao.minDistance = CFG.postfx.ssao.minDistance;
      ssao.maxDistance = CFG.postfx.ssao.maxDistance;
      ssao.output = SSAOPass.OUTPUT.Default;
      ssao.enabled = CFG.postfx.ssao.enabled;
      composer.addPass(ssao);
      postfx.ssao = ssao;
    } catch (e) { console.warn('SSAO devre dışı:', e); }

    // Bloom
    try {
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        CFG.postfx.bloom.strength, CFG.postfx.bloom.radius, CFG.postfx.bloom.threshold
      );
      bloom.enabled = CFG.postfx.bloom.enabled;
      composer.addPass(bloom);
      postfx.bloom = bloom;
    } catch (e) { console.warn('Bloom devre dışı:', e); }

    // Tilt-shift + grade
    const grade = new ShaderPass(GradeTiltShift);
    grade.enabled = CFG.postfx.grade.enabled;
    grade.uniforms.uTexel.value.set(1 / w, 1 / h);
    grade.uniforms.uSaturation.value = CFG.postfx.grade.saturation;
    grade.uniforms.uContrast.value = CFG.postfx.grade.contrast;
    grade.uniforms.uGrain.value = CFG.postfx.grade.grain;
    grade.uniforms.uChromatic.value = CFG.postfx.grade.chromatic;
    grade.uniforms.uVignette.value = CFG.postfx.dof.vignette;
    grade.uniforms.uLift.value.set(...CFG.postfx.grade.lift);
    grade.uniforms.uGain.value.set(...CFG.postfx.grade.gain);
    composer.addPass(grade);
    postfx.grade = grade;

    // SMAA
    try {
      const smaa = new SMAAPass(w, h);
      smaa.enabled = CFG.postfx.smaa.enabled;
      composer.addPass(smaa);
      postfx.smaa = smaa;
    } catch (e) { console.warn('SMAA devre dışı:', e); }

    return postfx;
  } catch (e) {
    console.warn('PostFX kullanılamıyor, düz render:', e);
    postfx.composer = null;
    return postfx;
  }
}

export function resizePostFX(w, h) {
  if (!postfx.composer) return;
  postfx.composer.setSize(w, h);
  if (postfx.grade) postfx.grade.uniforms.uTexel.value.set(1 / w, 1 / h);
  if (postfx.bloom) postfx.bloom.resolution.set(w, h);
  // composer.setSize tüm pass'leri tam boyuta çeker; SSAO ölçeğini geri uygula.
  if (postfx.ssao) {
    const s = CFG.postfx.ssao.scale || 1;
    postfx.ssao.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  }
}

export function renderFrame(dt) {
  postfx.time += dt;
  if (postfx.grade) {
    postfx.grade.uniforms.uTime.value = postfx.time;
    postfx.grade.uniforms.uGrain.value = state.settings.grain ? CFG.postfx.grade.grain : 0.0;
  }
  if (postfx.enabled && postfx.composer) {
    postfx.composer.render(dt);
  } else {
    engine.renderer.render(engine.scene, engine.cam);
  }
}

export function setPostFXEnabled(on) {
  postfx.enabled = !!on;
  state.settings.postfx = !!on;
}

export function togglePostFXPass(name, on) {
  if (name === 'ssao' && postfx.ssao) { postfx.ssao.enabled = !!on; state.settings.ssao = !!on; }
  if (name === 'bloom' && postfx.bloom) { postfx.bloom.enabled = !!on; state.settings.bloom = !!on; }
  if (name === 'dof' && postfx.grade) {
    postfx.grade.uniforms.uBlurMax.value = on ? 3.2 : 0.0;
    state.settings.dof = !!on;
  }
  if (name === 'grain') state.settings.grain = !!on;
}
