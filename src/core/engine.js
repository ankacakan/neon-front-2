/* ============================================================
   NEON FRONT 2.0 — motor: renderer, sahne, kamera rig, ışık, gökyüzü
   ============================================================ */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { state } from './state.js';
import { rand, clamp } from './utils.js';

export const engine = {
  renderer: null,
  scene: null,
  cam: null,
  sun: null,
  sky: null,
  diag: null,
  _shake: new THREE.Vector3(),
  _dir: new THREE.Vector3()
};

export function initEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', stencil: false
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  if ('useLegacyLights' in renderer) renderer.useLegacyLights = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  engine.renderer = renderer;

  /* ---- Teşhis köprüsü: shader hataları + render istatistikleri ---- */
  const diag = {
    shaderErrors: [], programs: 0, calls: 0, tris: 0, fps: 60, frameMs: 0,
    _frameError: null,
    stats() {
      return {
        programs: diag.programs, calls: diag.calls, tris: diag.tris,
        fps: Math.round(diag.fps * 10) / 10, frameMs: Math.round(diag.frameMs * 100) / 100,
        shaderErrors: diag.shaderErrors.slice()
      };
    },
    /* Sahne-only ölçüm: post-processing çıktı pass'i yerine gerçek
       sahne draw call/üçgen sayısını döndürür, sonra durumu geri alır.
       Küçük bir RT'ye render ederek ekranda titreme yapmaz. */
    sceneStats() {
      const r = engine.renderer;
      if (!r) return { calls: 0, tris: 0 };
      const rt = engine._diagRT || (engine._diagRT = new THREE.WebGLRenderTarget(16, 16));
      const prevTarget = r.getRenderTarget();
      const prevAutoReset = r.info.autoReset;
      r.info.autoReset = false;
      r.info.reset();
      r.setRenderTarget(rt);
      r.render(engine.scene, engine.cam);
      const calls = r.info.render.calls;
      const tris = r.info.render.triangles;
      r.info.reset();
      r.info.autoReset = prevAutoReset;
      r.setRenderTarget(prevTarget);
      return { calls, tris };
    },
    /* Sahne dekoru özeti: çalışma anında parti/instance sayımı. */
    sceneryReport() {
      const out = { batches: 0, instances: 0, byGroup: {}, meshCount: 0 };
      const scan = (root) => {
        root.traverse((o) => {
          if (o.isInstancedMesh) {
            out.batches++;
            out.instances += o.count;
            out.byGroup[root.name] = (out.byGroup[root.name] || 0) + o.count;
          } else if (o.isMesh) {
            out.meshCount++;
          }
        });
      };
      engine.scene.traverse((o) => {
        if (o.name === 'scenery' || o.name === 'decor' || o.name === 'capture') scan(o);
      });
      return out;
    }
  };
  engine.diag = diag;
  state.diag = diag;
  window.__NEON_DIAG = diag;

  const _consoleError = console.error;
  console.error = function () {
    try {
      const msg = Array.prototype.join.call(arguments, ' ');
      if (msg.indexOf('Shader Error') >= 0 && diag.shaderErrors.length < 8) {
        diag.shaderErrors.push(msg.slice(0, 600));
      }
    } catch (e) { /* yoksay */ }
    _consoleError.apply(console, arguments);
  };

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(CFG.fog.color, CFG.fog.near, CFG.fog.far);
  engine.scene = scene;

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, CFG.camera.distMin, CFG.camera.distMax);
  cam.position.set(0, 100, 0);
  engine.cam = cam;

  state.cam.focus = new THREE.Vector3(60, 0, -40);

  /* ---------- Işıklar ---------- */
  const sun = new THREE.DirectionalLight(CFG.sun.color, CFG.sun.intensity);
  sun.position.set(CFG.sun.pos[0], CFG.sun.pos[1], CFG.sun.pos[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.width = CFG.shadowMap || 2048;
  sun.shadow.mapSize.height = CFG.shadowMap || 2048;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 460;
  sun.shadow.camera.left = -110;
  sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -110;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);
  engine.sun = sun;

  scene.add(new THREE.HemisphereLight(CFG.hemi.sky, CFG.hemi.ground, CFG.hemi.intensity));
  scene.add(new THREE.AmbientLight(CFG.ambient.color, CFG.ambient.intensity));

  /* ---------- Gökyüzü ---------- */
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(CFG.sky.top) },
      midColor: { value: new THREE.Color(CFG.sky.mid) },
      botColor: { value: new THREE.Color(CFG.sky.bot) },
      sunDir: { value: new THREE.Vector3(...CFG.sky.sunDir).normalize() }
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor; uniform vec3 sunDir;
      varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y*0.5+0.5, 0.0, 1.0);
        vec3 col = mix(botColor, midColor, smoothstep(0.42,0.52,h));
        col = mix(col, topColor, smoothstep(0.52,0.95,h));
        float sun = pow(max(dot(normalize(vDir), normalize(sunDir)),0.0), 28.0);
        col += vec3(1.0,0.92,0.72)*sun*0.85;
        gl_FragColor = vec4(col,1.0);
      }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
  engine.sky = sky;
  engine.skyMat = skyMat;

  /* ---------- Prosedürel IBL (HDR dosyası olmadan) ---------- */
  try {
    if (THREE.PMREMGenerator) {
      const envScene = new THREE.Scene();
      const envSky = new THREE.Mesh(new THREE.SphereGeometry(140, 24, 16), skyMat);
      envScene.add(envSky);
      const envGround = new THREE.Mesh(
        new THREE.CircleGeometry(400, 24),
        new THREE.MeshBasicMaterial({ color: 0x7a6f50 })
      );
      envGround.rotation.x = -Math.PI / 2;
      envGround.position.y = -2;
      envScene.add(envGround);

      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromScene(envScene, 0.03);
      scene.environment = rt.texture;
      if ('environmentIntensity' in scene) scene.environmentIntensity = CFG.environmentIntensity;
      pmrem.dispose();
      envSky.geometry.dispose();
      envGround.geometry.dispose();
    }
  } catch (e) { /* IBL opsiyonel */ }

  window.addEventListener('resize', onResize);
  updateCamera(0);

  state.engine = engine;
  return engine;
}

/* ---------- Kamera güncelleme ---------- */
export function updateCamera(dt) {
  const cam = engine.cam;
  if (!cam) return;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const halfH = state.cam.viewSize * 0.5, halfW = halfH * aspect;
  cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;

  const cosP = Math.cos(CFG.camera.pitch);
  engine._dir
    .set(Math.sin(state.cam.yaw) * cosP, Math.sin(CFG.camera.pitch), Math.cos(state.cam.yaw) * cosP)
    .normalize();

  state.cam.shake *= Math.pow(0.0009, dt || 0.016);
  if (state.cam.shake < 0.02) state.cam.shake = 0;
  const s = state.cam.shake;
  engine._shake.set(rand(-s, s), rand(-s, s) * 0.4, rand(-s, s));

  cam.position.copy(state.cam.focus).addScaledVector(engine._dir, CFG.camera.dist).add(engine._shake);
  cam.lookAt(state.cam.focus);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

export function addShake(amount) {
  state.cam.shake = Math.min(3.4, state.cam.shake + amount);
}

export function onResize() {
  const r = engine.renderer;
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.setSize(window.innerWidth, window.innerHeight, false);
  if (engine.composer) engine.composer.setSize(window.innerWidth, window.innerHeight);
  updateCamera(0);
}

/* ---------- Gölge kamerasını odak çevresinde daralt (Faz 2e) ---------- */
export function focusShadow(focus) {
  const sun = engine.sun;
  if (!sun) return;
  sun.position.set(focus.x + 90, 150, focus.z + 70);
  sun.target.position.set(focus.x, 0, focus.z);
  sun.target.updateMatrixWorld();
  // Odak çevresinde dar bir kaskad → daha keskin temas gölgesi
  const R = clamp(state.cam.viewSize * 0.62, 60, 140);
  const c = sun.shadow.camera;
  c.left = -R; c.right = R; c.top = R; c.bottom = -R;
  c.near = 40; c.far = 420;
  c.updateProjectionMatrix();
}

/* ---------- Kalite ayarı ---------- */
export function setShadowQuality(size) {
  const sun = engine.sun;
  if (!sun) return;
  sun.shadow.mapSize.width = size;
  sun.shadow.mapSize.height = size;
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
}
