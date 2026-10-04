/* ============================================================
   NEON FRONT // İzometrik RTS  —  game.js
   ------------------------------------------------------------
   Saf WebGL / Three.js. Harici model, doku veya resim YOK.
   Tüm tank, uçak, arazi, köprü ve efektler temel geometrilerden
   (BoxGeometry, CylinderGeometry, SphereGeometry, ...) üretilir.

   Three.js CDN'den yüklenir (index.html içindeki THREE_CDN).
   Önce en güncel ES modülü denenir, olmazsa UMD build'e düşülür.
   ============================================================ */
(function () {
'use strict';

/* ============================================================
   0) THREE.JS YÜKLEYİCİ
   ============================================================ */
var CFG = window.THREE_CDN || {};
var ESM_URL = CFG.esm || 'https://unpkg.com/three@0.186.1/build/three.module.js';
var UMD_URL = CFG.umdFallback || 'https://unpkg.com/three@0.149.0/build/three.min.js';

var UI = {
  loading:  document.getElementById('overlay-loading'),
  loadTitle: document.getElementById('loadTitle'),
  loadMsg:  document.getElementById('loadMsg')
};

function fatal(msg) {
  UI.loadTitle.textContent = 'KÜTÜPHANE YÜKLENEMEDİ';
  UI.loadMsg.innerHTML = msg;
  var sp = UI.loading.querySelector('.spinner');
  if (sp) sp.style.display = 'none';
}

function loadUMDFallback(done, fail) {
  if (window.THREE && window.THREE.WebGLRenderer) { done(window.THREE); return; }
  var s = document.createElement('script');
  s.src = UMD_URL;
  s.onload = function () {
    if (window.THREE && window.THREE.WebGLRenderer) done(window.THREE);
    else fail();
  };
  s.onerror = function () { fail(); };
  document.head.appendChild(s);
}

function bootError() {
  fatal(
    'Three.js CDN üzerinden çekilemedi. İnternet bağlantını kontrol et.<br><br>' +
    'Yerel çalıştırmak için proje klasöründe:<br>' +
    '<code>python -m http.server 8123</code><br>' +
    'ardından <code>http://localhost:8123</code> adresini aç.'
  );
}

try {
  if (new URLSearchParams(location.search).get('three') === 'legacy') throw new Error('forced-legacy');
  import(ESM_URL).then(function (mod) { start(mod); }, function () {
    UI.loadMsg.textContent = 'ES modülü engellendi, UMD sürümüne geçiliyor...';
    loadUMDFallback(start, bootError);
  });
} catch (e) {
  loadUMDFallback(start, bootError);
}

/* ============================================================
   1) OYUN
   ============================================================ */
function start(THREE) {

  /* ---------- 1.1 Yardımcılar ---------- */
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function damp(a, b, l, dt) { return lerp(a, b, 1 - Math.exp(-l * dt)); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
  function clampInt(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function angDiff(a, b) { var d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
  function angLerp(a, b, t) { return a + angDiff(a, b) * clamp(t, 0, 1); }
  function dist2D(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
  function dist3D(ax, ay, az, bx, by, bz) { var dx = ax - bx, dy = ay - by, dz = az - bz; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  function fmtTime(s) {
    var m = Math.floor(s / 60), q = Math.floor(s % 60);
    return (m < 10 ? '0' : '') + m + ':' + (q < 10 ? '0' : '') + q;
  }
  function hash2(x, y) { var h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  /* Prosedürel GLSL gürültüsü — hem zemin detayı hem askeri boya aşınması
     hem de ateş/duman billboard'ları bunu kullanır (harici doku yok). */
  var GLSL_NOISE = [
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

  /* ---------- 1.2 Renderer / Sahne / Kamera ---------- */
  var canvas = document.getElementById('scene');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else if ('outputEncoding' in renderer && THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
  if ('useLegacyLights' in renderer) renderer.useLegacyLights = false;
  else if ('physicallyCorrectLights' in renderer) renderer.physicallyCorrectLights = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  /* ---- Teşhis köprüsü: shader derleme hataları ve render istatistikleri ---- */
  var diag = { shaderErrors: [], programs: 0, calls: 0, tris: 0 };
  window.__NEON_DIAG = diag;
  var _consoleError = console.error;
  console.error = function () {
    try {
      var msg = Array.prototype.join.call(arguments, ' ');
      if (msg.indexOf('Shader Error') >= 0 && diag.shaderErrors.length < 6) {
        diag.shaderErrors.push(msg.slice(0, 500));
      }
    } catch (e) { /* yoksay */ }
    _consoleError.apply(console, arguments);
  };

  var scene = new THREE.Scene();
  var FOG_COLOR = new THREE.Color(0x8fb2cf);
  scene.fog = new THREE.Fog(FOG_COLOR.getHex(), 170, 420);

  var PITCH = Math.atan(1 / Math.SQRT2);            // 35.264° → gerçek izometrik
  var CAM_DIST = 320;
  var viewSize = 140;
  var camYaw = Math.PI * 0.25;
  var camFocus = new THREE.Vector3(60, 0, -40);
  var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1200);
  cam.position.set(0, 100, 0);

  var camShake = 0, shakeVec = new THREE.Vector3();
  var _camDir = new THREE.Vector3();

  function updateCamera(dt) {
    var aspect = window.innerWidth / Math.max(1, window.innerHeight);
    var halfH = viewSize * 0.5, halfW = halfH * aspect;
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
    var cosP = Math.cos(PITCH);
    _camDir.set(Math.sin(camYaw) * cosP, Math.sin(PITCH), Math.cos(camYaw) * cosP).normalize();
    camShake *= Math.pow(0.0009, dt || 0.016);
    if (camShake < 0.02) camShake = 0;
    shakeVec.set(rand(-camShake, camShake), rand(-camShake, camShake) * 0.4, rand(-camShake, camShake));
    cam.position.copy(camFocus).addScaledVector(_camDir, CAM_DIST).add(shakeVec);
    cam.lookAt(camFocus);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  function onResize() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    updateCamera(0);
  }
  window.addEventListener('resize', onResize);

  /* ---------- 1.3 Işıklar + Gökyüzü ---------- */
  var sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
  sun.position.set(80, 130, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
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

  var hemi = new THREE.HemisphereLight(0xa8caea, 0x6b5a3e, 0.85);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0x445266, 0.5));

  // Gökyüzü: gradient shader'lı büyük küre (doku yok)
  var skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x1e4f86) },
      midColor: { value: new THREE.Color(0x6ea6d6) },
      botColor: { value: new THREE.Color(0xd8c9a8) },
      sunDir:   { value: new THREE.Vector3(0.5, 0.62, 0.38).normalize() }
    },
    vertexShader: [
      'varying vec3 vDir;',
      'void main(){',
      '  vDir = normalize(position);',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor; uniform vec3 sunDir;',
      'varying vec3 vDir;',
      'void main(){',
      '  float h = clamp(vDir.y*0.5+0.5, 0.0, 1.0);',
      '  vec3 col = mix(botColor, midColor, smoothstep(0.42,0.52,h));',
      '  col = mix(col, topColor, smoothstep(0.52,0.95,h));',
      '  float sun = pow(max(dot(normalize(vDir), normalize(sunDir)),0.0), 28.0);',
      '  col += vec3(1.0,0.92,0.72)*sun*0.85;',
      '  gl_FragColor = vec4(col,1.0);',
      '}'
    ].join('\n')
  });
  var sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  /* ---------- 1.3b Çevresel yansıma haritası (tamamen prosedürel) ----------
     Gökyüzü shader'ı ve basit bir zemin diski, PMREM ile bir IBL küp
     haritasına pişirilir. Böylece metaller ve askeri boya gerçek
     yansımalar alır — hiçbir HDR/doku dosyası kullanılmadan. */
  (function buildEnvironment() {
    try {
      if (!THREE.PMREMGenerator) return;
      var envScene = new THREE.Scene();
      var envSky = new THREE.Mesh(new THREE.SphereGeometry(140, 24, 16), skyMat);
      envScene.add(envSky);
      var envGround = new THREE.Mesh(
        new THREE.CircleGeometry(400, 24),
        new THREE.MeshBasicMaterial({ color: 0x7a6f50 })
      );
      envGround.rotation.x = -Math.PI / 2;
      envGround.position.y = -2;
      envScene.add(envGround);

      var pmrem = new THREE.PMREMGenerator(renderer);
      var rt = pmrem.fromScene(envScene, 0.03);
      scene.environment = rt.texture;
      if ('environmentIntensity' in scene) scene.environmentIntensity = 0.62;
      pmrem.dispose();
      envSky.geometry.dispose();
      envGround.geometry.dispose();
    } catch (e) {
      // IBL opsiyonel: başarısız olursa sahne yine çalışır
    }
  })();

  /* ---------- 1.4 Dünya sabitleri ---------- */
  var W = {
    size: 240, half: 120,
    cell: 3,
    riverHalf: 13,      // kazılmış nehir yatağı yarı genişliği
    waterHalf: 10.5,    // su yüzeyi yarı genişliği
    bridgeZ: 0,
    bridgeHalfLen: 22,
    bridgeHalfWidth: 9,
    deckY: 0.9
  };
  W.gridN = Math.round(W.size / W.cell);   // 80

  function riverCX(z) { return 5.0 * Math.sin(z * 0.05) + 2.5 * Math.sin(z * 0.12); }
  function isWater(x, z) { return Math.abs(x - riverCX(z)) < W.waterHalf; }
  function isBridgeZone(x, z) { return Math.abs(z - W.bridgeZ) <= W.bridgeHalfWidth && Math.abs(x) <= W.bridgeHalfLen; }
  function bridgeHeight(x, z) {
    if (Math.abs(z - W.bridgeZ) > W.bridgeHalfWidth) return 0;
    var ax = Math.abs(x);
    if (ax > W.bridgeHalfLen) return 0;
    var t = clamp((ax - (W.bridgeHalfLen - 9)) / 9, 0, 1);
    return W.deckY * (1 - t) * (1 - t * 0.25);
  }
  function groundHeight(x, z) {
    var b = bridgeHeight(x, z);
    if (b > 0.001) return b;
    return terrainRelief(x, z);
  }
  /* Yumuşak kumul/kabartma — nehir yatağında düzleşir, kıyıdan itibaren açılır */
  function terrainRelief(x, z) {
    if (Math.abs(x) > W.half || Math.abs(z) > W.half) return 0;
    var cx = riverCX(z);
    var d = Math.abs(x - cx);
    var bankFade = clamp((d - W.riverHalf - 1.5) / 9, 0, 1);
    if (bankFade <= 0) return 0;
    var n = vnoise((x + 40) * 0.045 + 3.1, (z + 17) * 0.045 + 8.7);
    var m = vnoise((x - 12) * 0.11 + 21.4, (z + 5) * 0.11 + 4.2);
    return ((n - 0.5) * 2.2 + (m - 0.5) * 0.7) * bankFade;
  }
  /* Arazi normali — iz/kir decal'lerinin yüzeye yatması için */
  var _UP = new THREE.Vector3(0, 1, 0);
  var _terNrm = new THREE.Vector3();
  function terrainNormal(x, z) {
    var e = 1.2;
    var hL = groundHeight(x - e, z), hR = groundHeight(x + e, z);
    var hD = groundHeight(x, z - e), hU = groundHeight(x, z + e);
    _terNrm.set(hL - hR, 2 * e, hD - hU).normalize();
    return _terNrm;
  }
  function walkableAt(x, z) {
    if (Math.abs(x) > W.half - 2 || Math.abs(z) > W.half - 2) return false;
    if (isWater(x, z)) return isBridgeZone(x, z);
    return true;
  }

  /* ---------- 1.5 Arazi ---------- */
  (function buildTerrain() {
    var SEG = 150;
    var geo = new THREE.PlaneGeometry(W.size, W.size, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);

    var sandDeep = new THREE.Color(0x8d6f42), sandDark = new THREE.Color(0xa2814a);
    var sandLight = new THREE.Color(0xe3cc93);
    var forest = new THREE.Color(0x27512a), grassDark = new THREE.Color(0x356a2e);
    var grassLight = new THREE.Color(0x8cc05e);
    var wet = new THREE.Color(0x403a2d), shore = new THREE.Color(0xa08a5e);
    var pebble = new THREE.Color(0x8d8778);
    var tmp = new THREE.Color();

    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var cx = riverCX(z);
      var d = Math.abs(x - cx);
      var y = 0;

      if (d < W.riverHalf) {
        var t = d / W.riverHalf;
        y = -1.75 * (1 - t * t);
        tmp.copy(wet).lerp(shore, Math.pow(t, 1.5));
      } else {
        /* geniş ölçekli biyom + orta ve ince ölçekli doku */
        var n1 = vnoise((x + cx) * 0.07 + 11, z * 0.07 + 7);
        var n2 = vnoise((x + cx) * 0.31 + 53, z * 0.31 + 29);
        var n3 = vnoise((x + cx) * 1.15 + 91, z * 1.15 + 67);
        var n = n1 * 0.58 + n2 * 0.30 + n3 * 0.12;

        if (x < cx) {
          tmp.copy(sandDeep).lerp(sandDark, n1);
          tmp.lerp(sandLight, clamp(n * 1.2, 0, 1));
        } else {
          tmp.copy(forest).lerp(grassDark, clamp(n1 * 1.5, 0, 1));
          tmp.lerp(grassLight, clamp(n * 1.25, 0, 1));
        }
        /* nehir kıyısı: kayalık / çakıllı şerit */
        var bank = clamp(1 - (d - W.riverHalf) / 6.5, 0, 1);
        if (bank > 0) {
          tmp.lerp(shore, bank * 0.62);
          tmp.lerp(pebble, bank * n3 * 0.55);
        }
      }
      /* kum/çakıl benekleri */
      if (d > W.riverHalf) tmp.multiplyScalar(0.93 + 0.14 * vnoise(x * 3.7, z * 3.7));

      pos.setY(i, y + (d > W.riverHalf ? terrainRelief(x, z) : 0));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    /* Zemin materyali: prosedürel albedo + pürüzlülük detayı (harici doku yok) */
    var mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.32
    });
    mat.onBeforeCompile = function (shader) {
      shader.vertexShader = 'varying vec3 vfxTPos;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvfxTPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
      shader.fragmentShader = 'varying vec3 vfxTPos;\n' + GLSL_NOISE + '\n' + shader.fragmentShader
        .replace('#include <color_fragment>',
          '#include <color_fragment>\n' +
          'float vfxT1 = vfx_fbm(vfxTPos * 1.1);\n' +
          'float vfxT2 = vfx_vn(vfxTPos * 6.5);\n' +
          'float vfxT3 = vfx_vn(vfxTPos * 26.0);\n' +
          'diffuseColor.rgb *= 0.88 + 0.26 * vfxT1;\n' +
          'diffuseColor.rgb *= 0.95 + 0.10 * vfxT2;\n' +
          'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.22, smoothstep(0.78, 1.0, vfxT3) * 0.42);\n' +
          'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.80, (1.0 - smoothstep(0.0, 0.70, vfxT3)) * 0.28);')
        .replace('#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n' +
          'roughnessFactor = clamp(roughnessFactor + (vfx_vn(vfxTPos * 3.3) - 0.5) * 0.30, 0.62, 1.0);');
    };
    mat.needsUpdate = true;
    var mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    scene.add(mesh);
  })();

  /* ---------- 1.6 Su (animasyonlu shader) ---------- */
  var waterMat = null;
  (function buildWater() {
    var steps = 170, positions = [], uvs = [], indices = [];
    for (var i = 0; i <= steps; i++) {
      var z = -W.half + W.size * (i / steps);
      var cx = riverCX(z);
      var hw = W.waterHalf + 0.7 * Math.sin(z * 0.09 + 1.3);
      positions.push(cx - hw, 0, z);
      positions.push(cx + hw, 0, z);
      uvs.push(0, z * 0.04, 1, z * 0.04);
    }
    for (var k = 0; k < steps; k++) {
      var a = k * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    waterMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: true, fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0.5, 0.62, 0.38).normalize() } }
      ]),
      vertexShader: [
        'uniform float uTime;',
        'varying vec3 vWorld; varying float vU; varying float vV; varying vec3 vN;',
        '#include <fog_pars_vertex>',
        'void main(){',
        '  vU = uv.x; vV = uv.y;',
        '  vec3 p = position;',
        '  float w1 = sin(p.x*0.34 + uTime*1.7)*0.11;',
        '  float w2 = sin(p.z*0.29 - uTime*1.25)*0.10;',
        '  float w3 = sin((p.x+p.z)*0.19 + uTime*0.9)*0.07;',
        '  p.y += w1 + w2 + w3;',
        '  float dx = 0.34*cos(p.x*0.34+uTime*1.7)*0.11 + 0.19*cos((p.x+p.z)*0.19+uTime*0.9)*0.07;',
        '  float dz = 0.29*cos(p.z*0.29-uTime*1.25)*0.10 + 0.19*cos((p.x+p.z)*0.19+uTime*0.9)*0.07;',
        '  vN = normalize(vec3(-dx, 1.0, -dz));',
        '  vec4 wp = modelMatrix * vec4(p,1.0);',
        '  vWorld = wp.xyz;',
        '  vec4 mvPosition = viewMatrix * wp;',
        '  gl_Position = projectionMatrix * mvPosition;',
        '  #include <fog_vertex>',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uSun; uniform float uTime;',
        'varying vec3 vWorld; varying float vU; varying float vV; varying vec3 vN;',
        '#include <fog_pars_fragment>',
        'void main(){',
        '  vec3 N = normalize(vN);',
        '  vec3 V = normalize(cameraPosition - vWorld);',
        '  vec3 L = normalize(uSun);',
        '  float diff = max(dot(N,L),0.0);',
        '  vec3 H = normalize(L+V);',
        '  float spec = pow(max(dot(N,H),0.0), 90.0);',
        '  float edge = smoothstep(0.0, 0.42, min(vU, 1.0-vU));',
        '  vec3 deep = vec3(0.020,0.108,0.235);',
        '  vec3 shal = vec3(0.075,0.365,0.520);',
        '  vec3 col = mix(shal, deep, edge) * (0.42 + 0.85*diff);',
        '  col += vec3(1.0,0.97,0.88) * spec * 1.5;',
        '  float nearshore = 1.0 - smoothstep(0.0, 0.12, min(vU,1.0-vU));',
        '  float foam = nearshore * (0.35 + 0.35*sin(vV*46.0 - uTime*3.1)) * 0.5;',
        '  col += vec3(0.85,0.95,1.0) * max(foam,0.0);',
        '  float ripples = sin(vWorld.x*2.1 + uTime*2.2)*sin(vWorld.z*2.4 - uTime*1.7);',
        '  col += vec3(0.05,0.10,0.12) * ripples * 0.35;',
        '  gl_FragColor = vec4(col, 0.93);',
        '  #include <fog_fragment>',
        '}'
      ].join('\n')
    });

    var mesh = new THREE.Mesh(geo, waterMat);
    mesh.position.y = -0.42;
    mesh.name = 'water';
    scene.add(mesh);
  })();

  /* ---------- 1.7 Statik sahne derleyici (tek mesh'e birleştirme) ---------- */
  var _tmpM = new THREE.Matrix4(), _tmpQ = new THREE.Quaternion(),
      _tmpE = new THREE.Euler(), _tmpV = new THREE.Vector3(), _tmpN = new THREE.Matrix3(),
      _tmpC = new THREE.Color();

  /* Sahne parçalarını arazi kabartmasına oturtan bayrak.
     Köprü tabliyesi/ayakları profili kendi takip ettiği için kapatılır. */
  var BAKER_LIFT = true;

  function trs(x, y, z, rx, ry, rz, sx, sy, sz) {
    _tmpE.set(rx || 0, ry || 0, rz || 0);
    _tmpQ.setFromEuler(_tmpE);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, BAKER_LIFT ? y + terrainRelief(x, z) : y, z), _tmpQ,
      new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz)
    );
  }

  function MeshBaker() {
    var P = [], N = [], C = [];
    return {
      add: function (geo, matrix, color, alphaTint) {
        var g = geo.index ? geo.toNonIndexed() : geo.clone();
        g.applyMatrix4(matrix);
        var p = g.attributes.position, n = g.attributes.normal;
        _tmpN.getNormalMatrix(matrix);
        for (var i = 0; i < p.count; i++) {
          _tmpV.set(p.getX(i), p.getY(i), p.getZ(i));
          P.push(_tmpV.x, _tmpV.y, _tmpV.z);
          _tmpV.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(_tmpN).normalize();
          N.push(_tmpV.x, _tmpV.y, _tmpV.z);
          var cf = alphaTint === undefined ? 1 : alphaTint;
          C.push(_tmpC.r * cf, _tmpC.g * cf, _tmpC.b * cf);
        }
        if (g !== geo) g.dispose();
        return this;
      },
      tint: function (hex, jitter) {
        _tmpC.set(hex);
        if (jitter) {
          var f = 1 + rand(-jitter, jitter);
          _tmpC.multiplyScalar(f);
        }
        return this;
      },
      build: function (name, opts) {
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
        var mat = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.85, metalness: 0.06, flatShading: true
        });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = !opts || opts.castShadow !== false;
        mesh.receiveShadow = true;
        mesh.name = name;
        return mesh;
      }
    };
  }

  /* ---------- 1.8 Ağaçlar, kaktüsler, kayalar, köprü ---------- */
  (function buildScenery() {
    var b = new MeshBaker();

    // Paylaşılan geometriler
    var gTrunk   = new THREE.CylinderGeometry(0.34, 0.46, 3.1, 6);
    var gLeafA   = new THREE.ConeGeometry(1.85, 3.0, 7);
    var gLeafB   = new THREE.ConeGeometry(1.4, 2.3, 7);
    var gBush    = new THREE.IcosahedronGeometry(0.9, 0);
    var gCactus  = new THREE.CylinderGeometry(0.5, 0.56, 3.2, 7);
    var gCactusA = new THREE.CylinderGeometry(0.28, 0.3, 1.3, 5);
    var gRock    = new THREE.DodecahedronGeometry(1, 0);
    var gTuft    = new THREE.ConeGeometry(0.3, 1.1, 4);
    var gPlank   = new THREE.BoxGeometry(1, 1, 1);
    var gPost    = new THREE.CylinderGeometry(0.34, 0.4, 1, 7);

    var placed = [];
    function tooClose(x, z, r) {
      for (var i = 0; i < placed.length; i++) {
        var p = placed[i];
        var dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz < r * r) return true;
      }
      return false;
    }
    function freeSpot(minDistFromRiver, avoidBridge, tries, minDist) {
      for (var t = 0; t < (tries || 30); t++) {
        var x = rand(-W.half + 8, W.half - 8);
        var z = rand(-W.half + 8, W.half - 8);
        var cx = riverCX(z);
        if (Math.abs(x - cx) < W.riverHalf + minDistFromRiver) continue;
        if (avoidBridge && Math.abs(z - W.bridgeZ) < W.bridgeHalfWidth + 7 && Math.abs(x - cx) < 34) continue;
        if (tooClose(x, z, minDist === undefined ? 4.6 : minDist)) continue;
        placed.push({ x: x, z: z });
        return { x: x, z: z, side: x < cx ? -1 : 1 };
      }
      return null;
    }

    // --- Ağaçlar (yeşil taraf) — sık orman öbekleri ---
    var i, s, p, h;
    for (i = 0; i < 155; i++) {
      p = freeSpot(3.5, true, 30, 4.6);
      if (!p || p.side < 0) { if (p) placed.pop(); continue; }
      s = rand(0.72, 1.5);
      h = 3.1 * s;
      b.tint(0x574127, 0.16).add(gTrunk, trs(p.x, h * 0.5, p.z, 0, rand(0, TAU), 0, s, s, s));
      b.tint(0x2f6b2c, 0.22).add(gLeafA, trs(p.x, h + 1.3 * s, p.z, 0, rand(0, TAU), 0, s, s * rand(0.9, 1.25), s));
      b.tint(0x3f8a37, 0.22).add(gLeafB, trs(p.x, h + 2.9 * s, p.z, 0, rand(0, TAU), 0, s * 0.85, s, s * 0.85));
    }
    // yoğun orman kuşağı (kümeler halinde, birbirine yakın)
    for (i = 0; i < 130; i++) {
      p = freeSpot(6.0, true, 26, 2.5);
      if (!p || p.side < 0) { if (p) placed.pop(); continue; }
      s = rand(0.6, 1.25);
      h = 3.1 * s;
      b.tint(0x4e3a22, 0.14).add(gTrunk, trs(p.x, h * 0.5, p.z, 0, rand(0, TAU), 0, s * 0.85, s, s * 0.85));
      b.tint(0x275c26, 0.18).add(gLeafA, trs(p.x, h + 1.15 * s, p.z, 0, rand(0, TAU), 0, s * 0.92, s * rand(1.0, 1.35), s * 0.92));
      b.tint(0x367a30, 0.18).add(gLeafB, trs(p.x, h + 2.7 * s, p.z, 0, rand(0, TAU), 0, s * 0.8, s, s * 0.8));
    }
    // --- Çalılar ---
    for (i = 0; i < 95; i++) {
      p = freeSpot(2.0, true, 30, 3.0);
      if (!p || p.side < 0) { if (p) placed.pop(); continue; }
      s = rand(0.55, 1.25);
      b.tint(0x2c5c26, 0.24).add(gBush, trs(p.x, 0.5 * s, p.z, 0, rand(0, TAU), 0, s, s * 0.75, s));
    }
    // --- Çim tutamları (ince zemin detayı) ---
    for (i = 0; i < 520; i++) {
      p = freeSpot(3.0, true, 24, 1.9);
      if (!p || p.side < 0) { if (p) placed.pop(); continue; }
      s = rand(0.5, 1.15);
      b.tint(Math.random() < 0.5 ? 0x4f8f3a : 0x6aa84a, 0.26)
        .add(gTuft, trs(p.x, 0.34 * s, p.z, rand(-0.18, 0.18), rand(0, TAU), rand(-0.18, 0.18), s, s * rand(0.8, 1.4), s));
      if (Math.random() < 0.45) {
        b.tint(0x5a9b42, 0.26)
          .add(gTuft, trs(p.x + rand(-0.8, 0.8), 0.24 * s, p.z + rand(-0.8, 0.8), 0, rand(0, TAU), 0, s * 0.7, s, s * 0.7));
      }
    }
    // --- Kaktüsler (çöl tarafı) ---
    for (i = 0; i < 105; i++) {
      p = freeSpot(3.0, true, 30, 4.0);
      if (!p || p.side > 0) { if (p) placed.pop(); continue; }
      s = rand(0.6, 1.35);
      b.tint(0x477235, 0.18).add(gCactus, trs(p.x, 1.6 * s, p.z, 0, rand(0, TAU), 0, s * 0.9, s, s * 0.9));
      b.tint(0x477235, 0.18).add(gCactusA, trs(p.x + 0.75 * s, 1.9 * s, p.z, 0, 0, Math.PI / 2, s, s, s));
      b.tint(0x50803c, 0.18).add(gCactusA, trs(p.x + 1.15 * s, 2.3 * s, p.z, 0, 0, 0, s, s, s));
      if (Math.random() < 0.5) {
        b.tint(0x477235, 0.18).add(gCactusA, trs(p.x - 0.75 * s, 1.6 * s, p.z, 0, 0, -Math.PI / 2, s, s, s));
        b.tint(0x50803c, 0.18).add(gCactusA, trs(p.x - 1.15 * s, 2.0 * s, p.z, 0, 0, 0, s, s, s));
      }
    }
    // --- Küçük kayalar / çakıl (iki taraf) ---
    for (i = 0; i < 150; i++) {
      p = freeSpot(2.5, true, 26, 2.6);
      if (!p) continue;
      s = rand(0.4, 1.4);
      b.tint(p.side < 0 ? 0xa2957a : 0x7f8479, 0.22)
        .add(gRock, trs(p.x, 0.32 * s, p.z, rand(0, TAU), rand(0, TAU), rand(0, TAU), s, s * 0.7, s));
    }
    // --- Büyük kayalık kümeleri (çöl tarafı, referanstaki kaya blokları) ---
    for (i = 0; i < 46; i++) {
      var base = freeSpot(5.0, true, 30, 7.0);
      if (!base || base.side > 0) { if (base) placed.pop(); continue; }
      var chunks = randInt(3, 6);
      for (var c2 = 0; c2 < chunks; c2++) {
        var cs = rand(1.1, 3.4);
        b.tint(0xa89a7e, 0.18).add(gRock, trs(
          base.x + rand(-3.4, 3.4), cs * 0.42, base.z + rand(-3.4, 3.4),
          rand(0, TAU), rand(0, TAU), rand(0, TAU),
          cs, cs * rand(0.6, 1.35), cs
        ));
      }
    }
    // --- Nehir kıyısı çakıl şeridi (referanstaki taşlı kıyı) ---
    for (var pz = -W.half + 6; pz < W.half - 6; pz += 1.5) {
      for (var side = -1; side <= 1; side += 2) {
        if (Math.random() > 0.75) continue;
        var cx2 = riverCX(pz);
        var off = W.riverHalf * rand(0.62, 1.06);
        var px2 = cx2 + side * off + rand(-0.6, 0.6);
        if (Math.abs(px2) > W.half - 4) continue;
        if (Math.abs(pz - W.bridgeZ) < W.bridgeHalfWidth + 4 && Math.abs(px2) < W.bridgeHalfLen + 4) continue;
        var ps = rand(0.28, 1.05);
        b.tint(Math.random() < 0.35 ? 0x9c8f72 : 0x7c7a70, 0.22).add(gRock, trs(
          px2, 0.22 * ps, pz, rand(0, TAU), rand(0, TAU), rand(0, TAU), ps, ps * 0.6, ps
        ));
      }
    }

    /* ---------------- KÖPRÜ ---------------- */
    var B = { x0: -W.bridgeHalfLen, x1: W.bridgeHalfLen, hw: W.bridgeHalfWidth, z: W.bridgeZ };
    var planks = 30, span = B.x1 - B.x0, pw = span / planks;
    BAKER_LIFT = false;   // köprü kendi profilini takip eder
    // tabliye (profili takip eden kalaslar)
    for (i = 0; i < planks; i++) {
      var px = B.x0 + pw * (i + 0.5);
      var hgt = bridgeHeight(px, B.z);
      var slope = (bridgeHeight(px + pw, B.z) - bridgeHeight(px - pw, B.z)) / (2 * pw);
      b.tint(0x7a6c58, 0.16).add(gPlank,
        trs(px, hgt - 0.18, B.z, 0, 0, -Math.atan(slope), pw * 0.96, 0.36, B.hw * 2));
    }
    // korkuluklar
    for (i = 0; i < planks; i++) {
      var qx = B.x0 + pw * (i + 0.5);
      var qh = bridgeHeight(qx, B.z);
      var qs = (bridgeHeight(qx + pw, B.z) - bridgeHeight(qx - pw, B.z)) / (2 * pw);
      for (var side = -1; side <= 1; side += 2) {
        b.tint(0x8d7a5e, 0.14).add(gPlank,
          trs(qx, qh + 0.62, B.z + side * (B.hw - 0.3), 0, 0, -Math.atan(qs), pw * 0.96, 0.16, 0.24));
        b.tint(0x6f6047, 0.14).add(gPlank,
          trs(qx, qh + 0.95, B.z + side * (B.hw - 0.3), 0, 0, 0, pw * 0.9, 0.14, 0.18));
      }
      if (i % 2 === 0 && Math.abs(qx) < B.x1 - 4) {
        for (var s2 = -1; s2 <= 1; s2 += 2) {
          b.tint(0x5d5039, 0.1).add(gPlank,
            trs(qx, qh + 0.5, B.z + s2 * (B.hw - 0.3), 0, 0, 0, 0.26, 1.1, 0.26));
        }
      }
    }
    // ayaklar
    for (i = -2; i <= 2; i++) {
      if (i === 0) continue;
      var fx = i * 8;
      b.tint(0x5a5145, 0.1).add(gPost, trs(fx, -1.1, B.z - B.hw * 0.65, 0, 0, 0, 1.1, 4.0, 1.1));
      b.tint(0x5a5145, 0.1).add(gPost, trs(fx, -1.1, B.z + B.hw * 0.65, 0, 0, 0, 1.1, 4.0, 1.1));
    }
    // kıyı istinat duvarları (zemine oturur → kabartma açık)
    BAKER_LIFT = true;
    for (var sb = -1; sb <= 1; sb += 2) {
      var bx = sb * B.x1;
      b.tint(0x8a8378, 0.12).add(gPlank, trs(bx + sb * 2.2, 0.2, B.z, 0, 0, 0, 4.6, 1.5, B.hw * 2 + 2.6));
      b.tint(0x9a927f, 0.12).add(gPlank, trs(bx + sb * 1.2, -0.5, B.z, 0, 0, 0, 3.0, 1.2, B.hw * 2 + 3.6));
    }

    var mesh = b.build('scenery');
    scene.add(mesh);
  })();

  /* ============================================================
     2) PARTİKÜL SİSTEMLERİ (InstancedMesh küreler)
     ============================================================ */
  function makeParticleMaterial(mat) {
    mat.transparent = true;
    mat.depthWrite = false;
    mat.onBeforeCompile = function (shader) {
      shader.vertexShader = 'attribute float aAlpha;\nvarying float vPartAlpha;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        'void main() {\n\tvPartAlpha = aAlpha;'
      );
      shader.fragmentShader = 'varying float vPartAlpha;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n\tdiffuseColor.a *= vPartAlpha;'
      );
    };
    mat.needsUpdate = true;
    return mat;
  }

  function ParticlePool(capacity, material, opts) {
    opts = opts || {};
    var geo = new THREE.SphereGeometry(1, 7, 5);
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
    for (var i = 0; i < capacity; i++) {
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
    for (i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this._c.setRGB(1, 1, 1));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.activeCount = 0;
  }

  ParticlePool.prototype.spawn = function (cfg) {
    var idx = this.free.pop();
    if (idx === undefined) return null;             // bütçe doldu → atla
    var p = this.parts[idx];
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
  };

  ParticlePool.prototype.reset = function () {
    this.free.length = 0;
    for (var i = 0; i < this.capacity; i++) {
      this.parts[i].active = false;
      this.mesh.setMatrixAt(i, this.zero);
      this.free.push(this.capacity - 1 - i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.activeCount = 0;
  };

  ParticlePool.prototype.update = function (dt) {
    var dirty = false;
    for (var i = 0; i < this.capacity; i++) {
      var p = this.parts[i];
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
      var d = Math.pow(p.drag, dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.bounce && p.y < 0.35) { p.y = 0.35; p.vy = Math.abs(p.vy) * 0.32; p.vx *= 0.6; p.vz *= 0.6; }

      var t = 1 - p.life / p.maxLife;
      var size = lerp(p.s0, p.s1, t);
      if (size < 0.012) size = 0.012;
      this._m.makeScale(size, size, size);
      this._m.setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, this._m);
      this._c.copy(p.c0).lerp(p.c1, t);
      this.mesh.setColorAt(i, this._c);

      var a = t < 0.10 ? (t / 0.10) : (1 - (t - 0.10) / 0.90);
      this.aAlpha.array[i] = Math.pow(clamp(a, 0, 1), 0.85);
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.aAlpha.needsUpdate = true;
    }
  };

  var firePool = new ParticlePool(
    1500,
    makeParticleMaterial(new THREE.MeshBasicMaterial({ fog: false })),
    { renderOrder: 8 }
  );
  var smokePool = new ParticlePool(
    1100,
    makeParticleMaterial(new THREE.MeshLambertMaterial({ fog: true, opacity: 0.85 })),
    { renderOrder: 7 }
  );
  var debrisPool = new ParticlePool(
    420,
    makeParticleMaterial(new THREE.MeshLambertMaterial({ fog: true, opacity: 1 })),
    { renderOrder: 5 }
  );

  /* ============================================================
     2b) BILLBOARD HAVUZLARI — sinematik ateş topu + duman sütunu
     Kameranın quaternion'ı kopyalanarak bakan düzlemler. Prosedürel
     GLSL alev/duman gürültüsü kullanır; doku dosyası yoktur.
     InstancedMesh kürelerle birlikte, onları tamamlayarak çalışır.
     ============================================================ */
  var BB_VERT = [
    'varying vec2 vBuv;',
    'void main() {',
    '  vBuv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var BB_FIRE_FRAG = [
    'uniform float uTime; uniform float uAlpha; uniform float uSeed;',
    'uniform vec3 uHot; uniform vec3 uMid; uniform vec3 uCool;',
    'varying vec2 vBuv;',
    GLSL_NOISE,
    'void main() {',
    '  vec2 p = vBuv - 0.5;',
    '  float r = length(p) * 2.0;',
    '  if (r > 1.0) discard;',
    '  float n  = vfx_fbm(vec3(p * 3.2, uSeed + uTime * 0.45));',
    '  float n2 = vfx_vn(vec3(p * 7.5, uSeed * 1.7 - uTime * 0.8));',
    '  float mask = (1.0 - smoothstep(0.10, 1.0, r)) * (0.42 + 0.88 * n) * (0.68 + 0.42 * n2);',
    '  vec3 col = mix(uCool, uMid, smoothstep(0.05, 0.50, mask));',
    '  col = mix(col, uHot, smoothstep(0.55, 1.05, mask));',
    '  float a = clamp(mask, 0.0, 1.0) * uAlpha * (1.0 - smoothstep(0.70, 1.0, r));',
    '  gl_FragColor = vec4(col, a);',
    '}'
  ].join('\n');

  var BB_SMOKE_FRAG = [
    'uniform float uTime; uniform float uAlpha; uniform float uSeed; uniform float uGrey;',
    'varying vec2 vBuv;',
    GLSL_NOISE,
    'void main() {',
    '  vec2 p = vBuv - 0.5;',
    '  float r = length(p) * 2.0;',
    '  if (r > 1.0) discard;',
    '  float n  = vfx_fbm(vec3(p * 2.4, uSeed + uTime * 0.18));',
    '  float n2 = vfx_vn(vec3(p * 5.0, uSeed * 2.3 - uTime * 0.26));',
    '  float mask = clamp((1.0 - smoothstep(0.05, 1.0, r)) * (0.40 + 0.80 * n) * (0.72 + 0.40 * n2), 0.0, 1.0);',
    '  float a = mask * uAlpha * (1.0 - smoothstep(0.65, 1.0, r));',
    '  vec3 col = mix(vec3(0.11, 0.105, 0.10), vec3(0.80, 0.80, 0.82), uGrey);',
    '  col *= 0.55 + 0.75 * mask;',
    '  gl_FragColor = vec4(col, a);',
    '}'
  ].join('\n');

  function BillboardPool(capacity, kind) {
    this.kind = kind;
    this.capacity = capacity;
    this.items = [];
    this.time = 0;
    this.geo = new THREE.PlaneGeometry(1, 1);
    var isFire = kind === 'fire';
    for (var i = 0; i < capacity; i++) {
      var mat = new THREE.ShaderMaterial({
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
      var m = new THREE.Mesh(this.geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = isFire ? 12 : 11;
      scene.add(m);
      this.items.push({
        mesh: m, mat: mat, active: false, t: 0, dur: 1,
        s0: 1, s1: 4, rise: 0, a0: 1, x: 0, y: 0, z: 0
      });
    }
    this.cursor = 0;
  }

  BillboardPool.prototype.spawn = function (cfg) {
    for (var i = 0; i < this.capacity; i++) {
      var k = (this.cursor + i) % this.capacity;
      var it = this.items[k];
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
  };

  BillboardPool.prototype.update = function (dt) {
    this.time += dt;
    for (var i = 0; i < this.capacity; i++) {
      var it = this.items[i];
      if (!it.active) continue;
      it.t += dt;
      var t = it.t / it.dur;
      if (t >= 1) {
        it.active = false;
        it.mesh.visible = false;
        it.mat.uniforms.uAlpha.value = 0;
        continue;
      }
      var grow = 1 - Math.pow(1 - t, 2.6);
      var s = lerp(it.s0, it.s1, grow);
      it.mesh.position.set(it.x, it.y + it.rise * t, it.z);
      it.mesh.scale.set(s, s, 1);
      it.mesh.quaternion.copy(cam.quaternion);
      var fade = t < 0.14 ? (t / 0.14) : (1 - (t - 0.14) / 0.86);
      it.mat.uniforms.uAlpha.value = it.a0 * Math.pow(clamp(fade, 0, 1), 0.75);
      it.mat.uniforms.uTime.value = this.time;
    }
  };

  BillboardPool.prototype.reset = function () {
    for (var i = 0; i < this.capacity; i++) {
      this.items[i].active = false;
      this.items[i].mesh.visible = false;
      this.items[i].mat.uniforms.uAlpha.value = 0;
    }
    this.time = 0;
  };

  var fireBillboards = new BillboardPool(30, 'fire');
  var smokeBillboards = new BillboardPool(54, 'smoke');

  /* ============================================================
     3) HAVUZLAR: mermi, bomba, şok dalgası, iz, ışık
     ============================================================ */
  var bulletGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.6, 6);
  bulletGeo.rotateX(Math.PI / 2);
  var bulletMatBlue = new THREE.MeshBasicMaterial({ color: 0x9fe4ff });
  var bulletMatRed  = new THREE.MeshBasicMaterial({ color: 0xffb0a0 });

  var bullets = [];
  (function () {
    for (var i = 0; i < 260; i++) {
      var m = new THREE.Mesh(bulletGeo, bulletMatBlue);
      m.visible = false;
      scene.add(m);
      bullets.push({ mesh: m, active: false, dir: new THREE.Vector3(), speed: 0, life: 0, damage: 0, team: 'blue', owner: null });
    }
  })();
  var bulletCursor = 0;
  function getBullet() {
    for (var i = 0; i < bullets.length; i++) {
      var k = (bulletCursor + i) % bullets.length;
      if (!bullets[k].active) { bulletCursor = (k + 1) % bullets.length; return bullets[k]; }
    }
    bulletCursor = (bulletCursor + 1) % bullets.length;
    return bullets[bulletCursor];
  }

  var bombGeo = new THREE.CylinderGeometry(0.24, 0.3, 1.1, 7);
  bombGeo.rotateX(Math.PI / 2);
  var bombMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.65 });
  var bombs = [];
  (function () {
    for (var i = 0; i < 60; i++) {
      var g = new THREE.Group();
      var body = new THREE.Mesh(bombGeo, bombMat);
      body.castShadow = true;
      g.add(body);
      var fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.5), bombMat);
      fin.position.z = -0.5; g.add(fin);
      var fin2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.5), bombMat);
      fin2.position.z = -0.5; g.add(fin2);
      g.visible = false;
      scene.add(g);
      bombs.push({ obj: g, active: false, vx: 0, vy: 0, vz: 0, team: 'red' });
    }
  })();
  var bombCursor = 0;

  var ringGeo = new THREE.RingGeometry(0.72, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  var rings = [];
  (function () {
    for (var i = 0; i < 26; i++) {
      var mat = new THREE.MeshBasicMaterial({
        color: 0xffa03c, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false
      });
      var m = new THREE.Mesh(ringGeo, mat);
      m.visible = false;
      m.renderOrder = 4;
      scene.add(m);
      rings.push({ mesh: m, mat: mat, active: false, t: 0, dur: 0.7, from: 1, to: 20 });
    }
  })();
  var ringCursor = 0;
  function spawnRing(x, y, z, from, to, dur, color) {
    for (var i = 0; i < rings.length; i++) {
      var k = (ringCursor + i) % rings.length;
      if (!rings[k].active) {
        ringCursor = (k + 1) % rings.length;
        var r = rings[k];
        r.active = true; r.t = 0; r.dur = dur; r.from = from; r.to = to;
        r.mesh.position.set(x, y, z);
        r.mesh.visible = true;
        r.mat.color.set(color);
        return;
      }
    }
  }
  function updateRings(dt) {
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      if (!r.active) continue;
      r.t += dt;
      var t = r.t / r.dur;
      if (t >= 1) { r.active = false; r.mesh.visible = false; r.mat.opacity = 0; continue; }
      var s = lerp(r.from, r.to, 1 - Math.pow(1 - t, 2.4));
      r.mesh.scale.set(s, 1, s);
      r.mat.opacity = (1 - t) * 0.85;
    }
  }

  var scorchGeo = new THREE.CircleGeometry(1, 22);
  scorchGeo.rotateX(-Math.PI / 2);
  var scorches = [];
  (function () {
    for (var i = 0; i < 34; i++) {
      var mat = new THREE.MeshBasicMaterial({ color: 0x120d08, transparent: true, opacity: 0, depthWrite: false });
      var m = new THREE.Mesh(scorchGeo, mat);
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      scorches.push({ mesh: m, mat: mat, active: false, life: 0, max: 1 });
    }
  })();
  var scorchCursor = 0;
  function spawnScorch(x, y, z, r, dark) {
    for (var i = 0; i < scorches.length; i++) {
      var k = (scorchCursor + i) % scorches.length;
      if (!scorches[k].active) {
        scorchCursor = (k + 1) % scorches.length;
        var s = scorches[k];
        s.active = true; s.life = 20; s.max = 20; s.darkness = dark || 0.42;
        s.mesh.position.set(x, groundHeight(x, z) + 0.10, z);
        s.mesh.quaternion.setFromUnitVectors(_UP, terrainNormal(x, z));
        s.mesh.scale.set(r, 1, r);
        s.mesh.visible = true;
        s.mat.opacity = s.darkness;
        return;
      }
    }
  }
  function updateScorches(dt) {
    for (var i = 0; i < scorches.length; i++) {
      var s = scorches[i];
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) { s.active = false; s.mesh.visible = false; continue; }
      s.mat.opacity = s.darkness * clamp(s.life / s.max * 1.6, 0, 1);
    }
  }

  var flashLights = [];
  (function () {
    for (var i = 0; i < 5; i++) {
      var l = new THREE.PointLight(0xffa040, 0, 34, 1.7);
      l.position.set(0, 3, 0);
      scene.add(l);
      flashLights.push({ light: l, intensity: 0, decay: 0 });
    }
  })();
  var flashCursor = 0;
  function flashAt(x, y, z, intensity, color) {
    var f = flashLights[flashCursor];
    flashCursor = (flashCursor + 1) % flashLights.length;
    f.light.position.set(x, y + 1.6, z);
    f.light.color.set(color === undefined ? 0xffa040 : color);
    f.intensity = intensity;
    f.light.intensity = intensity;
  }
  function updateFlashes(dt) {
    for (var i = 0; i < flashLights.length; i++) {
      var f = flashLights[i];
      if (f.intensity <= 0.01) { f.light.intensity = 0; continue; }
      f.intensity *= Math.pow(0.0009, dt);
      f.light.intensity = f.intensity;
    }
  }

  /* ============================================================
     4) PATLAMA / EFEKT REÇETELERİ
     ============================================================ */
  var FOG_HEX = FOG_COLOR.getHex();

  function impactDust(x, y, z, scale, color) {
    var n = Math.round(6 * scale);
    for (var i = 0; i < n; i++) {
      var a = rand(0, TAU), sp = rand(1.5, 5) * scale;
      smokePool.spawn({
        x: x, y: y + 0.2, z: z,
        vx: Math.cos(a) * sp, vy: rand(0.8, 3.4) * scale, vz: Math.sin(a) * sp,
        life: rand(0.45, 0.9), s0: 0.32 * scale, s1: rand(0.9, 1.5) * scale,
        grav: 1.2, drag: 0.06,
        c0: color === undefined ? 0xb9a888 : color, c1: FOG_HEX
      });
    }
  }

  /* ---------- Zemin yangını ocakları (yanan enkaz) ---------- */
  var groundFires = [];
  (function () {
    for (var i = 0; i < 16; i++) {
      groundFires.push({ active: false, x: 0, y: 0, z: 0, scale: 1, life: 0, max: 1, acc: 0 });
    }
  })();

  function addGroundFire(x, z, scale, life) {
    for (var i = 0; i < groundFires.length; i++) {
      var g = groundFires[i];
      if (g.active) {
        if (dist2D(g.x, g.z, x, z) < 6) {   // yakındaki ocağı güçlendir
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

  function updateGroundFires(dt) {
    for (var i = 0; i < groundFires.length; i++) {
      var g = groundFires[i];
      if (!g.active) continue;
      g.life -= dt;
      if (g.life <= 0) { g.active = false; continue; }
      var inten = g.life / g.max;
      g.acc += dt * (1.4 + 2.6 * inten);
      var guard = 0;
      while (g.acc >= 1 && guard++ < 8) {
        g.acc -= 1;
        var a = rand(0, TAU), rr = rand(0.2, 1.15) * g.scale;
        var px = g.x + Math.cos(a) * rr, pz = g.z + Math.sin(a) * rr;
        if (Math.random() < 0.45) {
          firePool.spawn({
            x: px, y: g.y + 0.25, z: pz,
            vx: rand(-1.2, 1.2), vy: rand(2.2, 6.0) * inten + 1.0, vz: rand(-1.2, 1.2),
            life: rand(0.30, 0.72), s0: rand(0.45, 1.0) * g.scale, s1: rand(0.8, 1.9) * g.scale * 0.75,
            grav: 2.5, drag: 0.06,
            c0: Math.random() < 0.5 ? 0xffe066 : 0xff9a24, c1: 0xd83c06
          });
        } else {
          smokePool.spawn({
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

  /* ---------- Gecikmeli ikincil patlamalar ---------- */
  var boomQueue = [];
  function queueBoom(x, y, z, power, delay) {
    if (boomQueue.length > 24) return;
    boomQueue.push({ x: x, y: y, z: z, p: power, t: delay });
  }
  function updateBoomQueue(dt) {
    for (var i = boomQueue.length - 1; i >= 0; i--) {
      var b = boomQueue[i];
      b.t -= dt;
      if (b.t <= 0) {
        boomQueue.splice(i, 1);
        explode(b.x, b.y, b.z, b.p, 'none');
      }
    }
  }

  function explode(x, y, z, power, team) {
    var P = clamp(power || 1, 0.35, 4);
    var i, a, el, sp;

    /* --- 0) Sinematik ateş topu billboard'ları --- */
    var balls = P > 1.4 ? 2 : 1;
    for (i = 0; i < balls; i++) {
      fireBillboards.spawn({
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

    /* --- 0b) Yükselen duman sütunu billboard'ları --- */
    var puffs = 3 + Math.round(P * 1.8);
    for (i = 0; i < puffs; i++) {
      smokeBillboards.spawn({
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

    /* --- 1) Ateş topu çekirdeği (büyüyerek söner) --- */
    for (i = 0; i < Math.round(11 * P); i++) {
      a = rand(0, TAU); sp = rand(1.5, 6) * P;
      firePool.spawn({
        x: x + rand(-0.35, 0.35), y: y + rand(0.4, 1.5), z: z + rand(-0.35, 0.35),
        vx: Math.cos(a) * sp, vy: rand(3, 9) * P, vz: Math.sin(a) * sp,
        life: rand(0.28, 0.52), s0: rand(1.2, 2.0) * P, s1: rand(2.6, 4.2) * P,
        grav: 1.6, drag: 0.02,
        c0: 0xfff8d8, c1: 0xffa020
      });
    }
    /* --- 2) Alevler (turuncu / sarı) --- */
    for (i = 0; i < Math.round(26 * P); i++) {
      a = rand(0, TAU); sp = rand(4, 15) * P;
      firePool.spawn({
        x: x, y: y + rand(0.3, 1.6), z: z,
        vx: Math.cos(a) * sp, vy: rand(3, 13) * P, vz: Math.sin(a) * sp,
        life: rand(0.45, 1.05), s0: rand(0.7, 1.5) * P, s1: rand(1.8, 3.4) * P,
        grav: 3.0, drag: 0.05,
        c0: Math.random() < 0.5 ? 0xffe36a : 0xffa22a, c1: 0xe04508
      });
    }
    /* --- 3) Kıvılcımlar (küçük, hızlı, yerçekimli) --- */
    for (i = 0; i < Math.round(34 * P); i++) {
      a = rand(0, TAU); el = rand(0.25, 1.4); sp = rand(11, 28) * P;
      firePool.spawn({
        x: x, y: y + 0.8, z: z,
        vx: Math.cos(a) * sp, vy: el * sp * 0.8, vz: Math.sin(a) * sp,
        life: rand(0.40, 1.0), s0: rand(0.16, 0.34), s1: rand(0.07, 0.15),
        grav: 22, drag: 0.06,
        c0: 0xfff4c0, c1: 0xff7a12
      });
    }
    /* --- 4) Duman (büyüyen, gökyüzü rengine karışarak kaybolur) --- */
    for (i = 0; i < Math.round(16 * P); i++) {
      a = rand(0, TAU); sp = rand(1.4, 5.5) * P;
      smokePool.spawn({
        x: x + rand(-1, 1) * P, y: y + rand(0.6, 2.4) * P, z: z + rand(-1, 1) * P,
        vx: Math.cos(a) * sp, vy: rand(2.0, 6.0) * P, vz: Math.sin(a) * sp,
        life: rand(1.3, 2.9), s0: rand(0.9, 1.8) * P, s1: rand(3.4, 6.4) * P,
        grav: 1.0, drag: 0.22,
        c0: Math.random() < 0.5 ? 0x8c8c8c : 0x5f5f5f, c1: 0xc6ced8
      });
    }
    /* --- 5) Enkaz parçaları (yerden sekerek söner) --- */
    for (i = 0; i < Math.round(12 * P); i++) {
      a = rand(0, TAU); el = rand(0.35, 1.5); sp = rand(6, 17) * P;
      debrisPool.spawn({
        x: x, y: y + 0.8, z: z,
        vx: Math.cos(a) * sp, vy: el * sp * 0.9, vz: Math.sin(a) * sp,
        life: rand(0.9, 1.9), s0: rand(0.15, 0.4), s1: rand(0.1, 0.28),
        grav: 20, drag: 0.05, bounce: true,
        c0: 0x2b2620, c1: 0x141210
      });
    }
    /* --- 6) Şok dalgası, iz, ışık --- */
    spawnRing(x, y + 0.12, z, 1.2 * P, (13 + 11 * P) * P * 0.75, 0.62, 0xffb257);
    spawnRing(x, y + 0.20, z, 0.8 * P, (7 + 6 * P) * P * 0.6, 0.34, 0xfff0c0);
    spawnScorch(x, y, z, 3.2 * P, clamp(0.30 + 0.1 * P, 0, 0.6));
    flashAt(x, y, z, 42 * P, 0xff9a3c);

    /* --- 7) Zemin yangını + zincirleme patlamalar --- */
    addGroundFire(x, z, 0.85 + 0.55 * P, 4 + 3.2 * P);
    if (P > 1.3) {
      queueBoom(x + rand(-3.5, 3.5) * P, y + 0.6, z + rand(-3.5, 3.5) * P, P * 0.42, rand(0.18, 0.46));
    }
    camShake = Math.min(2.6, camShake + 0.75 * P);
  }

  function muzzleFlash(x, y, z, dir, team) {
    var col = team === 'blue' ? 0x9fe4ff : 0xffc0a0;
    for (var i = 0; i < 5; i++) {
      firePool.spawn({
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

  /* ============================================================
     5) YOL BULMA (A*)
     ============================================================ */
  var GN = W.gridN, CS = W.cell;
  var walkable = new Uint8Array(GN * GN);
  var gScore = new Float32Array(GN * GN);
  var fScore = new Float32Array(GN * GN);
  var cameFrom = new Int32Array(GN * GN);
  var closedStamp = new Int32Array(GN * GN);
  var seenStamp = new Int32Array(GN * GN);
  var heapArr = new Int32Array(GN * GN + 1);
  var heapLen = 0;
  var searchStamp = 0;

  (function buildWalkGrid() {
    for (var j = 0; j < GN; j++) {
      for (var i = 0; i < GN; i++) {
        var x = -W.half + (i + 0.5) * CS;
        var z = -W.half + (j + 0.5) * CS;
        walkable[j * GN + i] = walkableAt(x, z) ? 1 : 0;
      }
    }
  })();

  function cellOf(x, z) {
    return {
      i: clampInt(Math.floor((x + W.half) / CS), 0, GN - 1),
      j: clampInt(Math.floor((z + W.half) / CS), 0, GN - 1)
    };
  }
  function cellCenter(i, j) {
    return { x: -W.half + (i + 0.5) * CS, z: -W.half + (j + 0.5) * CS };
  }
  function h(i, j, ti, tj) {
    var di = Math.abs(i - ti), dj = Math.abs(j - tj);
    return (di + dj) + (1.41421356 - 2) * Math.min(di, dj);
  }
  function heapPush(idx) {
    heapArr[++heapLen] = idx;
    var c = heapLen;
    while (c > 1) {
      var p = c >> 1;
      if (fScore[heapArr[p]] <= fScore[heapArr[c]]) break;
      var t = heapArr[p]; heapArr[p] = heapArr[c]; heapArr[c] = t;
      c = p;
    }
  }
  function heapPop() {
    var top = heapArr[1];
    heapArr[1] = heapArr[heapLen--];
    var p = 1;
    for (;;) {
      var l = p << 1, r = l | 1, m = p;
      if (l <= heapLen && fScore[heapArr[l]] < fScore[heapArr[m]]) m = l;
      if (r <= heapLen && fScore[heapArr[r]] < fScore[heapArr[m]]) m = r;
      if (m === p) break;
      var t = heapArr[p]; heapArr[p] = heapArr[m]; heapArr[m] = t;
      p = m;
    }
    return top;
  }
  function nearestWalkable(i, j) {
    if (walkable[j * GN + i]) return { i: i, j: j };
    for (var r = 1; r <= 16; r++) {
      for (var di = -r; di <= r; di++) {
        for (var dj = -r; dj <= r; dj++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          var ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= GN || nj >= GN) continue;
          if (walkable[nj * GN + ni]) return { i: ni, j: nj };
        }
      }
    }
    return null;
  }
  function losClear(x0, z0, x1, z1) {
    var dx = x1 - x0, dz = z1 - z0;
    var len = Math.sqrt(dx * dx + dz * dz);
    var steps = Math.max(1, Math.ceil(len / 1.1));
    for (var s = 1; s < steps; s++) {
      var t = s / steps;
      if (!walkableAt(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }
  var NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  function findPath(sx, sz, tx, tz) {
    var s = cellOf(sx, sz), t = cellOf(tx, tz);
    var st = nearestWalkable(s.i, s.j), go = nearestWalkable(t.i, t.j);
    if (!st || !go) return null;
    var startIdx = st.j * GN + st.i, goalIdx = go.j * GN + go.i;
    if (startIdx === goalIdx) return [{ x: tx, z: tz }];

    searchStamp++;
    heapLen = 0;
    seenStamp[startIdx] = searchStamp;
    gScore[startIdx] = 0;
    fScore[startIdx] = h(st.i, st.j, go.i, go.j);
    cameFrom[startIdx] = -1;
    closedStamp[startIdx] = 0;
    heapPush(startIdx);

    var expanded = 0, found = false;
    while (heapLen > 0 && expanded < 9000) {
      var cur = heapPop();
      if (seenStamp[cur] !== searchStamp || closedStamp[cur] === searchStamp) continue;
      if (cur === goalIdx) { found = true; break; }
      closedStamp[cur] = searchStamp;
      expanded++;
      var ci = cur % GN, cj = (cur - ci) / GN;
      for (var n = 0; n < 8; n++) {
        var ni = ci + NB[n][0], nj = cj + NB[n][1];
        if (ni < 0 || nj < 0 || ni >= GN || nj >= GN) continue;
        var nIdx = nj * GN + ni;
        if (!walkable[nIdx]) continue;
        if (n > 3) {
          if (!walkable[cj * GN + ni] || !walkable[nj * GN + ci]) continue;
        }
        var step = n > 3 ? 1.41421356 : 1.0;
        var tent = gScore[cur] + step;
        if (seenStamp[nIdx] !== searchStamp) {
          seenStamp[nIdx] = searchStamp;
          closedStamp[nIdx] = 0;
          gScore[nIdx] = Infinity;
        }
        if (tent < gScore[nIdx]) {
          gScore[nIdx] = tent;
          cameFrom[nIdx] = cur;
          fScore[nIdx] = tent + h(ni, nj, go.i, go.j);
          heapPush(nIdx);
        }
      }
    }
    if (!found) return null;

    // geri izleme
    var cells = [], k = goalIdx, guard = 0;
    while (k !== -1 && guard++ < 20000) {
      var ki = k % GN, kj = (k - ki) / GN;
      var c = cellCenter(ki, kj);
      cells.push(c);
      if (k === startIdx) break;
      k = cameFrom[k];
    }
    cells.reverse();
    if (cells.length === 0) return null;

    // string-pulling (gereksiz noktaları at)
    var out = [cells[0]];
    var idx = 0;
    while (idx < cells.length - 1) {
      var jj = cells.length - 1;
      for (; jj > idx + 1; jj--) {
        if (losClear(cells[idx].x, cells[idx].z, cells[jj].x, cells[jj].z)) break;
      }
      out.push(cells[jj]);
      idx = jj;
    }
    if (losClear(out[out.length - 1].x, out[out.length - 1].z, tx, tz) && walkableAt(tx, tz)) {
      out.push({ x: tx, z: tz });
    }
    if (out.length > 1) out.shift();
    return out;
  }

  /* ============================================================
     6) BİRİMLER
     ============================================================ */
  var COL_BLUE = 0x2f7fd6, COL_BLUE_DARK = 0x1b4f8c;
  var COL_RED = 0xd93a48, COL_RED_DARK = 0x8c1f2a;

  /* ------------------------------------------------------------
     Askeri boya materyali (PBR, tamamen prosedürel, doku yok)
     - MeshPhysicalMaterial: clearcoat'lu boya katmanı
     - onBeforeCompile ile prosedürel kir / toz / güneş solması:
       alt yüzeyler tozlanır, üst yüzeyler solar, pürüzlülük değişir.
     ------------------------------------------------------------ */
  function makePaintMaterial(hex, opts) {
    opts = opts || {};
    var mat = new THREE.MeshPhysicalMaterial({
      color: hex,
      roughness: opts.roughness === undefined ? 0.56 : opts.roughness,
      metalness: opts.metalness === undefined ? 0.24 : opts.metalness,
      clearcoat: opts.clearcoat === undefined ? 0.34 : opts.clearcoat,
      clearcoatRoughness: 0.62,
      envMapIntensity: opts.env === undefined ? 0.85 : opts.env
    });
    if (opts.wear === false) return mat;

    var dirt = new THREE.Color(opts.dirt === undefined ? 0x6a5c44 : opts.dirt);
    var amt = opts.wearAmt === undefined ? 1 : opts.wearAmt;

    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uDirt = { value: dirt };
      shader.uniforms.uWearAmt = { value: amt };

      shader.vertexShader = 'varying vec3 vfxWPos;\nvarying vec3 vfxWNrm;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        '\tvfxWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
        '\tvfxWNrm = normalize(mat3(modelMatrix) * objectNormal);'
      );

      shader.fragmentShader = 'uniform vec3 uDirt;\nuniform float uWearAmt;\n' +
        'varying vec3 vfxWPos;\nvarying vec3 vfxWNrm;\n' + GLSL_NOISE + '\n' + shader.fragmentShader
        .replace('#include <color_fragment>',
          '#include <color_fragment>\n' +
          'float vfxUp = clamp(vfxWNrm.y, 0.0, 1.0);\n' +
          'float vfxGrim = vfx_fbm(vfxWPos * 1.9) * 0.6 + vfx_vn(vfxWPos * 7.0) * 0.4;\n' +
          'float vfxDust = clamp((1.0 - vfxUp) * 0.78 + vfxGrim * 0.55, 0.0, 1.0) * uWearAmt;\n' +
          'diffuseColor.rgb = mix(diffuseColor.rgb, uDirt, vfxDust * 0.36);\n' +
          'diffuseColor.rgb *= 0.80 + 0.32 * (1.0 - vfxGrim);\n' +
          'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.20, smoothstep(0.68, 1.0, vfxUp) * 0.38);')
        .replace('#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n' +
          '\troughnessFactor = clamp(roughnessFactor + (vfxGrim - 0.5) * 0.34 + vfxDust * 0.20, 0.18, 1.0);');
    };
    mat.needsUpdate = true;
    return mat;
  }

  var MAT = {
    track: makePaintMaterial(0x22252b, { roughness: 0.70, metalness: 0.64, clearcoat: 0.08, env: 1.05, dirt: 0x2b2721 }),
    metalDark: makePaintMaterial(0x161a1f, { roughness: 0.50, metalness: 0.82, clearcoat: 0.16, env: 1.15, dirt: 0x211e1a }),
    tyre: makePaintMaterial(0x0e1013, { roughness: 0.94, metalness: 0.08, clearcoat: 0.0, env: 0.35, wear: false }),
    white: makePaintMaterial(0xe6ebf4, { roughness: 0.45, metalness: 0.30, clearcoat: 0.38, env: 0.95, dirt: 0x8a8577, wearAmt: 0.7 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x7fd0ff, roughness: 0.07, metalness: 0.20, clearcoat: 1.0,
      clearcoatRoughness: 0.05, emissive: 0x0e2a3d, emissiveIntensity: 1.15, envMapIntensity: 1.5
    }),
    blue: makePaintMaterial(COL_BLUE, { dirt: 0x6b6250 }),
    blueDark: makePaintMaterial(COL_BLUE_DARK, { roughness: 0.64, metalness: 0.28, dirt: 0x5c5443 }),
    red: makePaintMaterial(COL_RED, { dirt: 0x6b5a4a }),
    redDark: makePaintMaterial(COL_RED_DARK, { roughness: 0.64, metalness: 0.28, dirt: 0x5c4a3e })
  };
  var G = {
    hull: new THREE.BoxGeometry(2.25, 0.78, 3.5),
    hullTop: new THREE.BoxGeometry(1.85, 0.34, 2.3),
    track: new THREE.BoxGeometry(0.62, 0.62, 3.7),
    wheel: new THREE.CylinderGeometry(0.36, 0.36, 0.5, 10),
    turret: new THREE.BoxGeometry(1.6, 0.62, 1.9),
    barrel: new THREE.CylinderGeometry(0.14, 0.16, 2.5, 8),
    cupola: new THREE.CylinderGeometry(0.34, 0.36, 0.26, 8),
    hqBase: new THREE.BoxGeometry(9, 2.6, 9),
    hqWall: new THREE.BoxGeometry(9.6, 0.5, 9.6),
    hqTurret: new THREE.BoxGeometry(3.4, 1.2, 3.6),
    hqBarrel: new THREE.CylinderGeometry(0.22, 0.26, 3.6, 8),
    mast: new THREE.CylinderGeometry(0.1, 0.12, 5, 6),
    flag: new THREE.BoxGeometry(1.8, 1.0, 0.08),
    fuselage: new THREE.CapsuleGeometry(0.52, 3.6, 4, 10),
    wing: new THREE.BoxGeometry(10.5, 0.2, 1.7),
    tailFin: new THREE.BoxGeometry(0.2, 1.0, 1.3),
    tailPlane: new THREE.BoxGeometry(3.6, 0.16, 0.9),
    engine: new THREE.CylinderGeometry(0.34, 0.4, 1.5, 10),
    prop: new THREE.BoxGeometry(0.09, 1.5, 0.16),
    cockpit: new THREE.SphereGeometry(0.5, 10, 8)
  };
  G.barrel.rotateX(Math.PI / 2);
  G.hqBarrel.rotateX(Math.PI / 2);
  G.wheel.rotateZ(Math.PI / 2);
  G.fuselage.rotateX(Math.PI / 2);
  G.engine.rotateX(Math.PI / 2);

  var ringSelGeo = new THREE.RingGeometry(2.1, 2.6, 28);
  ringSelGeo.rotateX(-Math.PI / 2);

  var units = [];
  var selected = [];
  var bulletinCount = 0;

  function makeHealthBar() {
    var grp = new THREE.Group();
    var bg = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.36),
      new THREE.MeshBasicMaterial({ color: 0x0a0e14, transparent: true, opacity: 0.8, depthTest: false }));
    var fill = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.36),
      new THREE.MeshBasicMaterial({ color: 0x55e08a, depthTest: false }));
    fill.position.z = 0.01;
    bg.renderOrder = 20; fill.renderOrder = 21;
    grp.add(bg); grp.add(fill);
    grp.visible = false;
    scene.add(grp);
    return { group: grp, fill: fill, bg: bg };
  }

  function Unit(cfg) {
    this.team = cfg.team;
    this.kind = cfg.kind;             // 'tank' | 'hq' | 'bomber'
    this.alive = true;
    this.radius = cfg.kind === 'hq' ? 5.6 : (cfg.kind === 'bomber' ? 4.6 : 2.3);
    this.maxHp = cfg.hp;
    this.hp = cfg.hp;
    this.speed = cfg.speed || 0;
    this.turnSpeed = cfg.turnSpeed || 3.2;
    this.range = cfg.range || 34;
    this.detect = cfg.detect || 42;
    this.damage = cfg.damage || 22;
    this.fireInterval = cfg.fireInterval || 1.25;
    this.cool = rand(0, 0.8);
    this.turretSpeed = cfg.turretSpeed || 2.7;
    this.target = null;
    this.scanCd = rand(0, 0.3);
    this.yaw = cfg.team === 'blue' ? Math.PI * 0.5 : -Math.PI * 0.5;
    this.turretYaw = this.yaw;
    this.pos = new THREE.Vector3(cfg.x, 0, cfg.z);
    this.path = null; this.pathIdx = 0; this.moveGoal = null;
    this.repathCd = 0;
    this.bob = rand(0, TAU);
    this.hitFlash = 0;
    this.hpBar = makeHealthBar();
    this.hpBarTimer = 0;

    /* --- Mesh --- */
    var isBlue = cfg.team === 'blue';
    this.mesh = new THREE.Group();
    this.mesh.position.copy(this.pos);

    if (cfg.kind === 'tank') {
      var mainMat = isBlue ? MAT.blue : MAT.red;
      var darkMat = isBlue ? MAT.blueDark : MAT.redDark;
      var tl = new THREE.Mesh(G.track, MAT.track); tl.position.set(1.28, 0.42, 0); tl.castShadow = true;
      var tr = new THREE.Mesh(G.track, MAT.track); tr.position.set(-1.28, 0.42, 0); tr.castShadow = true;
      this.mesh.add(tl); this.mesh.add(tr);
      for (var w = 0; w < 3; w++) {
        var wh1 = new THREE.Mesh(G.wheel, MAT.tyre); wh1.position.set(1.32, 0.4, -1.2 + w * 1.2);
        var wh2 = new THREE.Mesh(G.wheel, MAT.tyre); wh2.position.set(-1.32, 0.4, -1.2 + w * 1.2);
        this.mesh.add(wh1); this.mesh.add(wh2);
      }
      var hull = new THREE.Mesh(G.hull, mainMat); hull.position.y = 0.9; hull.castShadow = true; hull.receiveShadow = true;
      var top = new THREE.Mesh(G.hullTop, darkMat); top.position.set(0, 1.34, -0.1); top.castShadow = true;
      this.mesh.add(hull); this.mesh.add(top);

      this.turretGroup = new THREE.Group();
      this.turretGroup.position.y = 1.6;
      var tur = new THREE.Mesh(G.turret, mainMat); tur.castShadow = true;
      var cup = new THREE.Mesh(G.cupola, darkMat); cup.position.set(-0.4, 0.42, -0.3);
      var bar = new THREE.Mesh(G.barrel, MAT.metalDark); bar.position.set(0, 0.06, 1.9); bar.castShadow = true;
      this.turretGroup.add(tur); this.turretGroup.add(cup); this.turretGroup.add(bar);
      this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.06, 3.15);
      this.turretGroup.add(this.muzzle);
      this.mesh.add(this.turretGroup);
      this.hpBarHeight = 3.1;

    } else if (cfg.kind === 'hq') {
      var bMat = isBlue ? MAT.blueDark : MAT.redDark;
      var acMat = isBlue ? MAT.blue : MAT.red;
      var base = new THREE.Mesh(G.hqBase, bMat); base.position.y = 1.3; base.castShadow = true; base.receiveShadow = true;
      var wall = new THREE.Mesh(G.hqWall, bMat); wall.position.y = 2.8; wall.castShadow = true;
      var wall2 = new THREE.Mesh(G.hqWall, acMat); wall2.position.y = 3.3; wall2.scale.set(0.85, 0.7, 0.85); wall2.castShadow = true;
      this.mesh.add(base); this.mesh.add(wall); this.mesh.add(wall2);

      var mast = new THREE.Mesh(G.mast, MAT.metalDark); mast.position.set(-3.4, 5.8, -3.4); mast.castShadow = true;
      var flag = new THREE.Mesh(G.flag, acMat); flag.position.set(-2.5, 7.6, -3.4); flag.castShadow = true;
      this.mesh.add(mast); this.mesh.add(flag);
      this.flag = flag;

      this.turretGroup = new THREE.Group();
      this.turretGroup.position.y = 3.7;
      var ht = new THREE.Mesh(G.hqTurret, acMat); ht.castShadow = true;
      var hb = new THREE.Mesh(G.hqBarrel, MAT.metalDark); hb.position.set(0, 0.1, 2.7); hb.castShadow = true;
      this.turretGroup.add(ht); this.turretGroup.add(hb);
      this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.1, 4.5);
      this.turretGroup.add(this.muzzle);
      this.mesh.add(this.turretGroup);
      this.hpBarHeight = 6.4;

    } else { // bomber
      var fus = new THREE.Mesh(G.fuselage, MAT.white); fus.castShadow = true;
      var wing = new THREE.Mesh(G.wing, MAT.white); wing.position.set(0, -0.1, 0.1); wing.castShadow = true;
      var fin = new THREE.Mesh(G.tailFin, MAT.white); fin.position.set(0, 0.7, -2.0); fin.castShadow = true;
      var tplane = new THREE.Mesh(G.tailPlane, MAT.white); tplane.position.set(0, 0.15, -2.1); tplane.castShadow = true;
      var cock = new THREE.Mesh(G.cockpit, MAT.glass); cock.position.set(0, 0.35, 1.7); cock.scale.set(0.9, 0.7, 1.2);
      this.mesh.add(fus); this.mesh.add(wing); this.mesh.add(fin); this.mesh.add(tplane); this.mesh.add(cock);
      this.props = [];
      for (var e = -1; e <= 1; e += 2) {
        var eng = new THREE.Mesh(G.engine, MAT.metalDark); eng.position.set(e * 2.5, -0.28, 0.5); eng.castShadow = true;
        this.mesh.add(eng);
        var pr = new THREE.Mesh(G.prop, MAT.metalDark); pr.position.set(e * 2.5, -0.28, 1.35);
        this.mesh.add(pr);
        this.props.push(pr);
      }
      this.hpBarHeight = 2.2;
    }

    // Seçim halkası
    this.selRing = new THREE.Mesh(ringSelGeo,
      new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.selRing.visible = false;
    this.selRing.renderOrder = 2;
    this.mesh.add(this.selRing);

    scene.add(this.mesh);
    units.push(this);
  }

  Unit.prototype.setSelected = function (on) {
    this.selRing.visible = !!on;
    if (on) this.selRing.material.color.set(this.team === 'blue' ? 0x7fe3ff : 0xff9a9a);
  };

  Unit.prototype.orderMove = function (tx, tz) {
    if (this.kind !== 'tank') return;
    var p = findPath(this.pos.x, this.pos.z, tx, tz);
    if (p && p.length) { this.path = p; this.pathIdx = 0; this.moveGoal = { x: tx, z: tz }; }
    else { this.path = [{ x: tx, z: tz }]; this.pathIdx = 0; this.moveGoal = { x: tx, z: tz }; }
  };

  Unit.prototype.orderAttack = function (targetUnit) {
    this.target = targetUnit;
    if (this.kind === 'tank' && targetUnit) {
      var ang = rand(0, TAU);
      var ox = targetUnit.pos.x + Math.cos(ang) * (targetUnit.radius + 10);
      var oz = targetUnit.pos.z + Math.sin(ang) * (targetUnit.radius + 10);
      this.orderMove(ox, oz);
    }
  };

  Unit.prototype.scan = function () {
    var best = null, bestD = Infinity;
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.alive || u.team === this.team) continue;
      var d = dist3D(this.pos.x, this.pos.y, this.pos.z, u.pos.x, u.pos.y, u.pos.z);
      var lim = u.kind === 'bomber' ? this.range * 0.95 : this.detect;
      if (d < lim && d < bestD) { bestD = d; best = u; }
    }
    this.target = best;
    return best;
  };

  Unit.prototype.takeDamage = function (amount, hx, hy, hz) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 0.14;
    this.hpBarTimer = 4.5;
    if (hx !== undefined) {
      firePool.spawn({
        x: hx, y: hy, z: hz, vx: rand(-3, 3), vy: rand(1, 4), vz: rand(-3, 3),
        life: rand(0.12, 0.3), s0: 0.55, s1: 0.1, grav: 2, drag: 0.05,
        c0: Math.random() < 0.5 ? 0xffe08a : 0xff9a3c, c1: 0x000000
      });
    }
    if (this.hp <= 0) this.die();
  };

  Unit.prototype.despawn = function () {
    if (!this.alive) return;
    this.alive = false;
    var idx = selected.indexOf(this);
    if (idx >= 0) selected.splice(idx, 1);
    scene.remove(this.mesh);
    scene.remove(this.hpBar.group);
    var ui = units.indexOf(this);
    if (ui >= 0) units.splice(ui, 1);
  };

  Unit.prototype.die = function () {
    if (!this.alive) return;
    this.alive = false;
    var idx = selected.indexOf(this);
    if (idx >= 0) selected.splice(idx, 1);

    scene.remove(this.mesh);
    scene.remove(this.hpBar.group);

    var P = this.kind === 'hq' ? 3.6 : (this.kind === 'bomber' ? 1.7 : 1.15);
    explode(this.pos.x, this.pos.y + (this.kind === 'bomber' ? 0 : 0.9), this.pos.z, P, this.team);
    if (this.kind === 'tank') {
      spawnRing(this.pos.x, this.pos.y + 0.1, this.pos.z, 1, 16, 0.5, 0xff8c3c);
      spawnScorch(this.pos.x, 0, this.pos.z, 4.4, 0.5);
    }
    if (this.kind === 'bomber') {
      smokePool.spawn({
        x: this.pos.x, y: this.pos.y, z: this.pos.z, vx: 0, vy: -2, vz: 0,
        life: 2.4, s0: 1.4, s1: 4.5, grav: 0.4, drag: 0.3, c0: 0x707070, c1: FOG_HEX
      });
    }

    if (this.team === 'blue') { stats.lost++; onBlueLost(this); }
    else stats.kills++;

    var ui = units.indexOf(this);
    if (ui >= 0) units.splice(ui, 1);

    if (this.kind === 'hq') {
      if (this.team === 'red') endGame(true);
      else endGame(false);
    }
  };

  Unit.prototype.fireAt = function (tgt) {
    var origin = new THREE.Vector3();
    this.muzzle.getWorldPosition(origin);
    var aim = new THREE.Vector3(tgt.pos.x, tgt.pos.y + (tgt.kind === 'bomber' ? 0 : 1.0), tgt.pos.z);
    var dir = aim.clone().sub(origin).normalize();

    var b = getBullet();
    b.active = true;
    b.mesh.visible = true;
    b.mesh.material = this.team === 'blue' ? bulletMatBlue : bulletMatRed;
    b.mesh.position.copy(origin);
    b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    b.dir.copy(dir);
    b.speed = 95;
    b.life = 1.9;
    b.damage = this.damage;
    b.team = this.team;
    b.owner = this;
    muzzleFlash(origin.x, origin.y, origin.z, dir, this.team);
  };

  Unit.prototype.update = function (dt) {
    if (!this.alive) return;
    var i;

    if (this.kind === 'bomber') { this.updateBomber(dt); return; }

    /* --- Hedef tarama --- */
    this.scanCd -= dt;
    var needScan = this.scanCd <= 0 || !this.target || !this.target.alive;
    if (needScan) { this.scanCd = rand(0.22, 0.42); this.scan(); }

    var tgt = this.target;

    /* --- Nişan alma + ateş --- */
    if (tgt && tgt.alive) {
      var dx = tgt.pos.x - this.pos.x;
      var dz = tgt.pos.z - this.pos.z;
      var desired = Math.atan2(dx, dz);
      this.turretYaw = angLerp(this.turretYaw, desired, dt * this.turretSpeed);
      var d3 = dist3D(this.pos.x, this.pos.y, this.pos.z, tgt.pos.x, tgt.pos.y, tgt.pos.z);
      var within = tgt.kind === 'bomber'
        ? (d3 < this.range && Math.abs(this.pos.y - tgt.pos.y) < 14)
        : (d3 < this.range);
      if (within && Math.abs(angDiff(this.turretYaw, desired)) < 0.13) {
        this.cool -= dt;
        if (this.cool <= 0) {
          this.cool = this.fireInterval;
          this.fireAt(tgt);
        }
      }
      if (this.cool > 0) this.cool -= dt;
    }

    /* --- Hareket --- */
    if (this.kind === 'hq') {
      this.pos.y = 0;
      this.mesh.position.set(this.pos.x, 0, this.pos.z);
    } else {
      var moving = false;

      /* --- Kırmızı taraf taktiği: hedef yoksa cepheye ilerle --- */
      if (this.team === 'red') {
        if (tgt && tgt.alive) {
          var dd = dist3D(this.pos.x, this.pos.y, this.pos.z, tgt.pos.x, tgt.pos.y, tgt.pos.z);
          var ideal = this.range * 0.72;
          if (dd > ideal) {
            this.repathCd -= dt;
            if (this.repathCd <= 0 || !this.path) {
              this.repathCd = 1.2 + rand(0, 0.6);
              this.orderMove(tgt.pos.x, tgt.pos.z);
            }
          } else if (!this.path && this.moveGoal) {
            this.path = null; this.moveGoal = null;
          }
        } else {
          /* Görüş alanında düşman yok → stratejik hedefe (mavi üs) yürü */
          this.repathCd -= dt;
          if (this.repathCd <= 0 || !this.moveGoal) {
            this.repathCd = 2.6 + rand(0, 1.4);
            var obj = null;
            if (blueHQ && blueHQ.alive) obj = blueHQ;
            else {
              var bd = Infinity;
              for (var bi = 0; bi < units.length; bi++) {
                var bu = units[bi];
                if (bu.team !== 'blue' || !bu.alive || bu.kind !== 'tank') continue;
                var bdist = dist2D(this.pos.x, this.pos.z, bu.pos.x, bu.pos.z);
                if (bdist < bd) { bd = bdist; obj = bu; }
              }
            }
            if (obj) this.orderMove(obj.pos.x + rand(-16, 16), obj.pos.z + rand(-16, 16));
          }
        }
      }

      /* --- Mavi taraf: kısa tasmalı otomatik savunma --- */
      if (this.team === 'blue' && !this.path && tgt && tgt.alive && tgt.kind !== 'bomber') {
        var dd2 = dist3D(this.pos.x, this.pos.y, this.pos.z, tgt.pos.x, tgt.pos.y, tgt.pos.z);
        if (dd2 > this.range * 1.15) {
          this.repathCd -= dt;
          if (this.repathCd <= 0) { this.repathCd = 1.6 + rand(0, 0.8); this.orderMove(tgt.pos.x, tgt.pos.z); }
        }
      }

      if (this.path && this.pathIdx < this.path.length) {
        var node = this.path[this.pathIdx];
        var nx = node.x - this.pos.x, nz = node.z - this.pos.z;
        var nd = Math.sqrt(nx * nx + nz * nz);
        if (nd < 1.4) {
          this.pathIdx++;
          if (this.pathIdx >= this.path.length) { this.path = null; this.moveGoal = null; }
        } else {
          var wantYaw = Math.atan2(nx, nz);
          this.yaw = angLerp(this.yaw, wantYaw, dt * this.turnSpeed);
          var facing = Math.cos(angDiff(this.yaw, wantYaw));
          if (facing > 0.55) {
            var adv = this.speed * dt * (0.35 + 0.65 * facing);
            var sx = this.pos.x + Math.sin(this.yaw) * adv;
            var sz = this.pos.z + Math.cos(this.yaw) * adv;
            if (walkableAt(sx, sz)) { this.pos.x = sx; this.pos.z = sz; }
            else { this.path = null; this.moveGoal = null; }
            moving = true;
          }
        }
      }

      /* Birlik ayrımı (üst üste binmesin) */
      for (i = 0; i < units.length; i++) {
        var o = units[i];
        if (o === this || !o.alive || o.kind !== 'tank') continue;
        var ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
        var d2 = ox * ox + oz * oz;
        var minD = (this.radius + o.radius) * 0.92;
        if (d2 > 0.0001 && d2 < minD * minD) {
          var dl = Math.sqrt(d2);
          var push = (minD - dl) * 0.5;
          this.pos.x += (ox / dl) * push;
          this.pos.z += (oz / dl) * push;
        }
      }

      /* Yükseklik (köprü) */
      var gh = groundHeight(this.pos.x, this.pos.z);
      this.pos.y = damp(this.pos.y, gh, 9, dt);
      this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.mesh.rotation.y = this.yaw;
      this.mesh.rotation.z = moving ? Math.sin(performance.now() * 0.02) * 0.012 : 0;
    }

    if (this.turretGroup) this.turretGroup.rotation.y = this.turretYaw - this.yaw + (this.kind === 'hq' ? 0 : 0);
    if (this.kind === 'hq') this.turretGroup.rotation.y = this.turretYaw;

    /* --- Vurulma flaşı --- */
    if (this.hitFlash > 0) { this.hitFlash -= dt; this.mesh.visible = Math.floor(this.hitFlash * 40) % 2 === 0; }
    else if (!this.mesh.visible) this.mesh.visible = true;

    this.updateHpBar(dt);
  };

  Unit.prototype.updateHpBar = function (dt) {
    this.hpBarTimer -= dt;
    var frac = clamp(this.hp / this.maxHp, 0, 1);
    var show = this.hpBarTimer > 0 && frac < 0.999 && this.kind !== 'bomber';
    this.hpBar.group.visible = show;
    if (!show) return;
    this.hpBar.group.position.set(this.pos.x, this.pos.y + this.hpBarHeight, this.pos.z);
    this.hpBar.group.quaternion.copy(cam.quaternion);
    this.hpBar.fill.scale.x = Math.max(0.001, frac);
    this.hpBar.fill.position.x = -(1 - frac) * 1.5;
    this.hpBar.fill.material.color.setHex(frac > 0.55 ? 0x55e08a : (frac > 0.28 ? 0xffcf4d : 0xff4d5e));
  };

  /* ---------- Bombardıman uçağı davranışı ---------- */
  Unit.prototype.setupBomber = function (from, to, drops, team) {
    this.flightFrom = from;
    this.flightTo = to;
    this.sortie = 0;
    this.drops = drops || [];
    this.team = team || this.team;
    this.flightDir = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
    this.pos.set(from.x, cfgBomberAlt, from.z);
    this.yaw = Math.atan2(this.flightDir.x, this.flightDir.z);
    this.dropTimer = 0;
    this.bombsLeft = this.drops.length;
  };

  Unit.prototype.updateBomber = function (dt) {
    /* uçuş */
    this.pos.x += this.flightDir.x * this.speed * dt;
    this.pos.z += this.flightDir.z * this.speed * dt;
    this.bob += dt * 2.2;
    this.pos.y = cfgBomberAlt + Math.sin(this.bob) * 0.5;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    this.mesh.rotation.z = Math.sin(this.bob * 0.7) * 0.06;
    this.mesh.rotation.x = Math.sin(this.bob * 0.5) * 0.025;

    var spin = dt * 26;
    for (var i = 0; i < this.props.length; i++) this.props[i].rotation.z += spin;

    /* bomba bırakma penceresi */
    if (this.drops.length) {
      var d = this.drops[0];
      var dist = dist2D(this.pos.x, this.pos.z, d.x, d.z);
      var approaching = (this.flightDir.x * (d.x - this.pos.x) + this.flightDir.z * (d.z - this.pos.z)) > 0;
      if (dist < 7.5 && approaching) {
        this.drops.shift();
        this.dropBomb(d.x, d.z);
        if (this.drops.length) this.dropTimer = 0.28;
      }
    }

    /* haritadan çıktıysa görevi bitir (imha/kayıp sayılmaz) */
    if (Math.abs(this.pos.x) > W.half + 60 || Math.abs(this.pos.z) > W.half + 60) {
      this.despawn();
    }
    this.updateHpBar(dt);
  };

  Unit.prototype.dropBomb = function (tx, tz) {
    for (var i = 0; i < bombs.length; i++) {
      var k = (bombCursor + i) % bombs.length;
      if (!bombs[k].active) {
        bombCursor = (k + 1) % bombs.length;
        var b = bombs[k];
        b.active = true;
        b.obj.visible = true;
        b.obj.position.copy(this.pos);
        b.obj.position.y -= 1.2;
        b.vx = this.flightDir.x * this.speed;
        b.vz = this.flightDir.z * this.speed;
        b.vy = -2;
        b.team = this.team;
        return;
      }
    }
  };

  /* ============================================================
     7) OYUN DURUMU
     ============================================================ */
  var cfgBomberAlt = 26;
  var stats = { kills: 0, lost: 0, wave: 0, time: 0, spawned: 0 };
  var waveTimer = 15, waveInterval = 25;
  var reinforceCd = 0, airstrikeCd = 0;
  var REINFORCE_CD = 15, AIRSTRIKE_CD = 26;
  var blueHQ = null, redHQ = null;
  var enemyBomberTimer = 45;
  var gameState = 'menu';
  var lastTs = 0, fpsAcc = 0, fpsFrames = 0, fpsValue = 60;

  var toastTimer = null;
  function toast(msg, dur) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, dur || 2000);
  }

  function onBlueLost(u) {
    if (u.kind === 'hq') return;
    if (selected.length === 0) toast('BİRİM KAYBEDİLDİ', 1200);
  }

  function spawnTank(team, x, z, opts) {
    opts = opts || {};
    var u = new Unit({
      team: team, kind: 'tank', x: x, z: z,
      hp: opts.hp || 135,
      speed: opts.speed || rand(10.5, 12.5),
      turnSpeed: 3.4,
      range: 33,
      detect: 44,
      damage: 24,
      fireInterval: opts.fireInterval || 1.35,
      turretSpeed: 2.8
    });
    var ang = rand(0, TAU);
    u.yaw = ang; u.turretYaw = ang;
    unitSpawnFx(x, z, team);
    return u;
  }

  function spawnHQ(team, x, z) {
    return new Unit({
      team: team, kind: 'hq', x: x, z: z,
      hp: 2600, speed: 0, range: 46, detect: 50,
      damage: 36, fireInterval: 1.15, turretSpeed: 1.5
    });
  }

  function callAirstrike(team, tx, tz, count) {
    count = count || 3;
    var baseAng = rand(0, TAU);
    for (var i = 0; i < count; i++) {
      var lateral = (i - (count - 1) / 2) * 13;
      var dirX = Math.cos(baseAng), dirZ = Math.sin(baseAng);
      var perpX = -dirZ, perpZ = dirX;
      var fromX = tx + dirX * 165 + perpX * lateral;
      var fromZ = tz + dirZ * 165 + perpZ * lateral;
      var toX = tx - dirX * 165 + perpX * lateral;
      var toZ = tz - dirZ * 165 + perpZ * lateral;
      var drops = [];
      for (var k = -2; k <= 2; k++) {
        drops.push({
          x: tx + dirX * k * 7.5 + perpX * lateral * 0.35,
          z: tz + dirZ * k * 7.5 + perpZ * lateral * 0.35
        });
      }
      // yaklaşma yönüne göre sırala
      drops.sort(function (a, b) {
        return dist2D(fromX, fromZ, a.x, a.z) - dist2D(fromX, fromZ, b.x, b.z);
      });
      var u = new Unit({
        team: team, kind: 'bomber', x: fromX, z: fromZ,
        hp: 70, speed: 36, damage: 0, fireInterval: 99
      });
      u.setupBomber({ x: fromX, z: fromZ }, { x: toX, z: toZ }, drops, team);
    }
    spawnRing(tx, 0.15, tz, 4, 34, 1.2, team === 'blue' ? 0x7fe3ff : 0xff8c6a);
    spawnRing(tx, 0.15, tz, 2, 22, 0.9, 0xffffff);
  }

  function unitSpawnFx(x, z, team) {
    spawnRing(x, groundHeight(x, z) + 0.12, z, 1, 13, 0.55, team === 'blue' ? 0x7fe3ff : 0xff8c6a);
    for (var i = 0; i < 14; i++) {
      var a = rand(0, TAU), sp = rand(3, 9);
      smokePool.spawn({
        x: x, y: 0.4, z: z,
        vx: Math.cos(a) * sp, vy: rand(1, 4), vz: Math.sin(a) * sp,
        life: rand(0.5, 1.1), s0: 0.35, s1: rand(1.2, 2.2),
        grav: 1.5, drag: 0.08, c0: 0xb0a58c, c1: FOG_HEX
      });
    }
  }

  function spawnWave() {
    stats.wave++;
    var n = 2 + Math.floor(stats.wave * 1.15);
    n = Math.min(n, 8);
    var edgeZ = [-70, -30, 0, 30, 70];
    for (var i = 0; i < n; i++) {
      var z = edgeZ[i % edgeZ.length] + rand(-14, 14);
      var x = -W.half + 16 - rand(0, 10);
      var cell = nearestWalkable(cellOf(x, z).i, cellOf(x, z).j);
      if (cell) { var c = cellCenter(cell.i, cell.j); x = c.x; z = c.z; }
      spawnTank('red', x, z, {});
    }
    toast('DALGA ' + stats.wave + ' — ' + n + ' DÜŞMAN TANKI', 2400);
    if (stats.wave % 3 === 0) {
      callAirstrike('red', blueHQ ? blueHQ.pos.x + rand(-20, 20) : 60, blueHQ ? blueHQ.pos.z + rand(-20, 20) : -40, 2);
    }
  }

  /* ============================================================
     8) KURULUM / SIFIRLAMA
     ============================================================ */
  function clearWorld() {
    for (var i = units.length - 1; i >= 0; i--) {
      var u = units[i];
      u.alive = false;
      scene.remove(u.mesh);
      scene.remove(u.hpBar.group);
    }
    units.length = 0;
    selected.length = 0;
    for (i = 0; i < bullets.length; i++) { bullets[i].active = false; bullets[i].mesh.visible = false; }
    for (i = 0; i < bombs.length; i++) { bombs[i].active = false; bombs[i].obj.visible = false; }
    for (i = 0; i < rings.length; i++) { rings[i].active = false; rings[i].mesh.visible = false; }
    for (i = 0; i < scorches.length; i++) { scorches[i].active = false; scorches[i].mesh.visible = false; }
    firePool.reset();
    smokePool.reset();
    debrisPool.reset();
    fireBillboards.reset();
    smokeBillboards.reset();
    boomQueue.length = 0;
    for (i = 0; i < groundFires.length; i++) { groundFires[i].active = false; groundFires[i].acc = 0; }
  }

  function resetGame() {
    clearWorld();
    stats = { kills: 0, lost: 0, wave: 0, time: 0, spawned: 0 };
    waveTimer = 15; waveInterval = 25;
    reinforceCd = 0; airstrikeCd = 0;
    enemyBomberTimer = 42;
    camYaw = Math.PI * 0.25;
    viewSize = 140;

    redHQ = spawnHQ('red', -68, 44);
    blueHQ = spawnHQ('blue', 68, -44);

    for (var i = 0; i < 4; i++) {
      spawnTank('blue', 58 + rand(-8, 8), -34 + rand(-8, 8), {});
    }
    for (i = 0; i < 3; i++) {
      spawnTank('red', -56 + rand(-8, 8), 32 + rand(-8, 8), {});
    }

    camFocus.set(blueHQ.pos.x - 14, 0, blueHQ.pos.z + 8);
    gameState = 'playing';
    updateCamera(0);
  }

  function endGame(victory) {
    if (gameState === 'over') return;
    gameState = 'over';
    endTag.textContent = victory ? 'CEPHANE HATTI GÜVENDE' : 'CEPHANE HATTI ÇÖKTÜ';
    endTitle.textContent = victory ? 'ZAFER' : 'YENİLGİ';
    endTitle.style.color = victory ? '#55e08a' : '#ff4d5e';
    endSub.textContent = victory
      ? 'Düşman üssü yerle bir edildi. Nehir hattı güvende.'
      : 'Mavi üs düştü. Nehir hattı kaybedildi.';
    endKills.textContent = stats.kills;
    endLost.textContent = stats.lost;
    endWave.textContent = stats.wave;
    endTime.textContent = fmtTime(stats.time);
    setTimeout(function () { if (gameState === 'over') endOverlay.classList.remove('hidden'); }, 900);
  }

  /* ============================================================
     9) GİRDİ
     ============================================================ */
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var hitPoint = new THREE.Vector3();
  var keys = Object.create(null);

  var dragActive = false, dragStart = { x: 0, y: 0 }, dragNow = { x: 0, y: 0 }, dragMoved = false;
  var panActive = false, panLast = { x: 0, y: 0 };

  function pickGround(clientX, clientY) {
    ndc.x = (clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, cam);
    var p = raycaster.ray.intersectPlane(groundPlane, hitPoint);
    return p ? hitPoint : null;
  }

  function pickUnit(clientX, clientY) {
    ndc.x = (clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, cam);
    var best = null, bestD = Infinity;
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.alive || u.kind === 'bomber') continue;
      var p = u.pos.clone();
      p.y += u.kind === 'hq' ? 2.4 : 1.2;
      var d = raycaster.ray.distanceToPoint(p);
      var pickR = u.radius * (u.kind === 'hq' ? 1.5 : 1.35);
      if (d < pickR && d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  function screenOf(v3) {
    var p = v3.clone().project(cam);
    return {
      x: (p.x + 1) * 0.5 * window.innerWidth,
      y: (-p.y + 1) * 0.5 * window.innerHeight
    };
  }

  function selectUnits(list, additive) {
    if (!additive) {
      for (var i = 0; i < selected.length; i++) selected[i].setSelected(false);
      selected.length = 0;
    }
    for (i = 0; i < list.length; i++) {
      if (selected.indexOf(list[i]) === -1) { selected.push(list[i]); list[i].setSelected(true); }
    }
    updateSelectionUI();
  }

  function ownUnits() {
    var out = [];
    for (var i = 0; i < units.length; i++) if (units[i].team === 'blue' && units[i].kind === 'tank') out.push(units[i]);
    return out;
  }

  function issueMove(tx, tz) {
    if (!selected.length) return;
    // formasyon: hedef noktaları daire içinde dağıt
    var n = selected.length;
    var radius = Math.max(3, Math.sqrt(n) * 3.1);
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU + rand(0, 0.4);
      var ox = tx + Math.cos(a) * radius;
      var oz = tz + Math.sin(a) * radius;
      if (!walkableAt(ox, oz)) { ox = tx; oz = tz; }
      selected[i].orderMove(ox, oz);
    }
    spawnRing(tx, groundHeight(tx, tz) + 0.15, tz, 1.5, 12, 0.5, 0x7fe3ff);
    for (i = 0; i < 10; i++) {
      var aa = rand(0, TAU), sp = rand(2, 6);
      smokePool.spawn({
        x: tx, y: 0.3, z: tz,
        vx: Math.cos(aa) * sp, vy: rand(1, 3), vz: Math.sin(aa) * sp,
        life: rand(0.35, 0.75), s0: 0.3, s1: 1.1, grav: 1.4, drag: 0.07,
        c0: 0x9a8f78, c1: FOG_HEX
      });
    }
  }

  function issueAttack(targetUnit) {
    if (!selected.length) return;
    for (var i = 0; i < selected.length; i++) selected[i].orderAttack(targetUnit);
    spawnRing(targetUnit.pos.x, groundHeight(targetUnit.pos.x, targetUnit.pos.z) + 0.15, targetUnit.pos.z, 2, 15, 0.5, 0xff6a6a);
  }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  canvas.addEventListener('pointerdown', function (e) {
    if (gameState !== 'playing') return;
    if (e.button === 2) {
      var t = pickUnit(e.clientX, e.clientY);
      if (t && t.team !== 'blue') issueAttack(t);
      else { var g = pickGround(e.clientX, e.clientY); if (g) issueMove(g.x, g.z); }
      return;
    }
    if (e.button === 1) { panActive = true; panLast.x = e.clientX; panLast.y = e.clientY; e.preventDefault(); return; }
    if (e.button !== 0) return;
    dragActive = true; dragMoved = false;
    dragStart.x = e.clientX; dragStart.y = e.clientY;
    dragNow.x = e.clientX; dragNow.y = e.clientY;
  });

  window.addEventListener('pointermove', function (e) {
    if (panActive) {
      var dx = e.clientX - panLast.x, dy = e.clientY - panLast.y;
      panLast.x = e.clientX; panLast.y = e.clientY;
      var right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
      var fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
      var k = viewSize / 700;
      camFocus.addScaledVector(right, -dx * k);
      camFocus.addScaledVector(fwd, dy * k);
      clampFocus();
      return;
    }
    if (!dragActive) return;
    dragNow.x = e.clientX; dragNow.y = e.clientY;
    if (Math.abs(dragNow.x - dragStart.x) > 5 || Math.abs(dragNow.y - dragStart.y) > 5) dragMoved = true;
    if (dragMoved) {
      var x0 = Math.min(dragStart.x, dragNow.x), y0 = Math.min(dragStart.y, dragNow.y);
      var w = Math.abs(dragNow.x - dragStart.x), h = Math.abs(dragNow.y - dragStart.y);
      selectBox.style.display = 'block';
      selectBox.style.left = x0 + 'px';
      selectBox.style.top = y0 + 'px';
      selectBox.style.width = w + 'px';
      selectBox.style.height = h + 'px';
    }
  });

  window.addEventListener('pointerup', function (e) {
    if (panActive && e.button === 1) { panActive = false; return; }
    if (e.button !== 0 || !dragActive) return;
    dragActive = false;
    selectBox.style.display = 'none';

    if (dragMoved) {
      var x0 = Math.min(dragStart.x, dragNow.x), x1 = Math.max(dragStart.x, dragNow.x);
      var y0 = Math.min(dragStart.y, dragNow.y), y1 = Math.max(dragStart.y, dragNow.y);
      var picked = [];
      for (var i = 0; i < units.length; i++) {
        var u = units[i];
        if (!u.alive || u.team !== 'blue' || u.kind !== 'tank') continue;
        var s = screenOf(new THREE.Vector3(u.pos.x, u.pos.y + 1, u.pos.z));
        if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) picked.push(u);
      }
      selectUnits(picked, e.shiftKey);
      return;
    }

    var hitUnit = pickUnit(e.clientX, e.clientY);
    if (hitUnit && hitUnit.team === 'blue' && hitUnit.kind === 'tank') {
      selectUnits([hitUnit], e.shiftKey);
    } else if (hitUnit && hitUnit.team !== 'blue') {
      issueAttack(hitUnit);
    } else {
      var g = pickGround(e.clientX, e.clientY);
      if (g) {
        if (selected.length) issueMove(g.x, g.z);
        else selectUnits([], false);
      }
    }
  });

  window.addEventListener('wheel', function (e) {
    if (gameState !== 'playing') return;
    e.preventDefault();
    var f = Math.exp(e.deltaY * 0.0011);
    viewSize = clamp(viewSize * f, 46, 260);
    updateCamera(0);
  }, { passive: false });

  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();

    if (e.code === 'KeyR') doReinforce();
    if (e.code === 'KeyB') doAirstrike();
    if (e.code === 'Space') focusSelection();
    if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); selectUnits(ownUnits(), false); toast('TÜM BİRLİKLER SEÇİLDİ', 1200); }
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { for (var k in keys) keys[k] = false; panActive = false; dragActive = false; });

  function clampFocus() {
    camFocus.x = clamp(camFocus.x, -W.half + 8, W.half - 8);
    camFocus.z = clamp(camFocus.z, -W.half + 8, W.half - 8);
  }

  function focusSelection() {
    if (!selected.length) { if (blueHQ) camFocus.set(blueHQ.pos.x, 0, blueHQ.pos.z); return; }
    var cx = 0, cz = 0;
    for (var i = 0; i < selected.length; i++) { cx += selected[i].pos.x; cz += selected[i].pos.z; }
    camFocus.set(cx / selected.length, 0, cz / selected.length);
    clampFocus();
  }

  function doReinforce() {
    if (gameState !== 'playing' || reinforceCd > 0 || !blueHQ) return;
    reinforceCd = REINFORCE_CD;
    var x = blueHQ.pos.x + rand(-14, 14), z = blueHQ.pos.z + rand(-14, 10);
    var c = cellOf(x, z);
    var cell = nearestWalkable(c.i, c.j);
    if (cell) { var cc = cellCenter(cell.i, cell.j); x = cc.x; z = cc.z; }
    var u = spawnTank('blue', x, z, {});
    stats.spawned++;
    toast('TAKVİYE TANKI CEPHEYE İNDİ', 1600);
    return u;
  }

  function doAirstrike() {
    if (gameState !== 'playing' || airstrikeCd > 0) return;
    var g = pickGround(lastMouse.x, lastMouse.y) || camFocus;
    airstrikeCd = AIRSTRIKE_CD;
    callAirstrike('blue', g.x, g.z, 3);
    toast('HAVA SALDIRISI YOLDA — ' + Math.round(g.x) + ' / ' + Math.round(g.z), 2000);
  }

  var lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  window.addEventListener('pointermove', function (e) { lastMouse.x = e.clientX; lastMouse.y = e.clientY; });

  /* ---------- Butonlar ---------- */
  document.getElementById('btnReinforce').addEventListener('click', doReinforce);
  document.getElementById('btnAirstrike').addEventListener('click', doAirstrike);

  /* ============================================================
     10) HUD & MİNİHARİTA
     ============================================================ */
  var toastEl = document.getElementById('toast');
  var selectBox = document.getElementById('selectBox');
  var endOverlay = document.getElementById('overlay-end');
  var startOverlay = document.getElementById('overlay-start');
  var endTag = document.getElementById('endTag');
  var endTitle = document.getElementById('endTitle');
  var endSub = document.getElementById('endSub');
  var endKills = document.getElementById('endKills');
  var endLost = document.getElementById('endLost');
  var endWave = document.getElementById('endWave');
  var endTime = document.getElementById('endTime');
  var el = {
    wave: document.getElementById('statWave'),
    kills: document.getElementById('statKills'),
    lost: document.getElementById('statLost'),
    unitsC: document.getElementById('statUnits'),
    fps: document.getElementById('statFps'),
    time: document.getElementById('statTime'),
    selCount: document.getElementById('selCount'),
    selHp: document.getElementById('selHpFill'),
    selHint: document.getElementById('selHint'),
    cdReinforce: document.getElementById('cdReinforce'),
    cdAirstrike: document.getElementById('cdAirstrike'),
    btnReinforce: document.getElementById('btnReinforce'),
    btnAirstrike: document.getElementById('btnAirstrike'),
    hqBlue: document.getElementById('hqBlueFill'),
    hqBluePct: document.getElementById('hqBluePct'),
    hqRed: document.getElementById('hqRedFill'),
    hqRedPct: document.getElementById('hqRedPct')
  };

  function updateSelectionUI() {
    el.selCount.textContent = selected.length;
    if (!selected.length) {
      el.selHp.style.width = '0%';
      el.selHint.textContent = 'Bir tanka tıkla veya sol tuşla alan seç';
      return;
    }
    var hp = 0, max = 0;
    for (var i = 0; i < selected.length; i++) { hp += selected[i].hp; max += selected[i].maxHp; }
    el.selHp.style.width = (clamp(hp / Math.max(1, max), 0, 1) * 100).toFixed(1) + '%';
    el.selHint.textContent = selected.length === 1
      ? 'Sağ tık: hareket emri · düşmana sağ tık: saldırı'
      : 'Sağ tık: ' + selected.length + ' tank birlikte hareket eder';
  }

  function updateCD(node, btn, cd, total) {
    var frac = clamp(1 - cd / total, 0, 1);
    node.style.width = (frac * 100).toFixed(1) + '%';
    if (cd > 0) btn.classList.add('cooling'); else btn.classList.remove('cooling');
    btn.disabled = cd > 0;
  }

  /* ---------- Minimap ---------- */
  var mm = document.getElementById('minimap');
  var mmCtx = mm.getContext('2d');
  var mmSize = mm.width;
  var mmScale = mmSize / W.size;
  var mmBg = document.createElement('canvas');
  mmBg.width = mmBg.height = mmSize;
  (function drawMmBg() {
    var c = mmBg.getContext('2d');
    function wx(x) { return (x + W.half) * mmScale; }
    function wz(z) { return (z + W.half) * mmScale; }
    c.fillStyle = '#4c7a3f'; c.fillRect(0, 0, mmSize, mmSize);
    // çöl (nehir merkezinin batısı)
    c.fillStyle = '#b3945c';
    for (var pz = 0; pz < W.size; pz += 2) {
      var z = -W.half + pz;
      c.fillRect(0, wz(z) - 1, Math.max(0, wx(riverCX(z))), 3);
    }
    // nehir
    c.strokeStyle = '#2a6fa8'; c.lineWidth = Math.max(2, W.waterHalf * 2 * mmScale);
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath();
    for (var z2 = -W.half; z2 <= W.half; z2 += 6) {
      var px = wx(riverCX(z2)), py = wz(z2);
      if (z2 === -W.half) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.stroke();
    // köprü
    c.fillStyle = '#d8c9a0';
    c.fillRect(wx(-W.bridgeHalfLen), wz(-W.bridgeHalfWidth), W.bridgeHalfLen * 2 * mmScale, W.bridgeHalfWidth * 2 * mmScale);
    // kenar
    c.strokeStyle = 'rgba(150,190,230,0.35)'; c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, mmSize - 1, mmSize - 1);
  })();

  function drawMinimap() {
    mmCtx.clearRect(0, 0, mmSize, mmSize);
    mmCtx.drawImage(mmBg, 0, 0);
    function px(x) { return (x + W.half) * mmScale; }
    function pz(z) { return (z + W.half) * mmScale; }

    // kamera görüş alanı
    mmCtx.strokeStyle = 'rgba(240,250,255,0.55)';
    mmCtx.lineWidth = 1;
    var half = viewSize * 0.62;
    mmCtx.strokeRect(px(camFocus.x - half), pz(camFocus.z - half), half * 2 * mmScale, half * 2 * mmScale);

    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.alive) continue;
      var isBlue = u.team === 'blue';
      var size = u.kind === 'hq' ? 9 : (u.kind === 'bomber' ? 4 : 5);
      mmCtx.fillStyle = isBlue ? '#4aa8ff' : '#ff5468';
      mmCtx.fillRect(px(u.pos.x) - size / 2, pz(u.pos.z) - size / 2, size, size);
      if (u.kind === 'hq') {
        mmCtx.strokeStyle = isBlue ? '#bfe4ff' : '#ffc4c4';
        mmCtx.lineWidth = 1.5;
        mmCtx.strokeRect(px(u.pos.x) - size / 2 - 2, pz(u.pos.z) - size / 2 - 2, size + 4, size + 4);
      }
    }
    // seçili
    for (i = 0; i < selected.length; i++) {
      var s = selected[i];
      mmCtx.strokeStyle = '#9ff0ff'; mmCtx.lineWidth = 1.5;
      mmCtx.strokeRect(px(s.pos.x) - 4, pz(s.pos.z) - 4, 8, 8);
    }
  }

  function updateHUD() {
    el.wave.textContent = stats.wave;
    el.kills.textContent = stats.kills;
    el.lost.textContent = stats.lost;
    var alive = 0;
    for (var i = 0; i < units.length; i++) if (units[i].team === 'blue' && units[i].kind === 'tank') alive++;
    el.unitsC.textContent = alive;
    el.time.textContent = fmtTime(stats.time);
    el.fps.textContent = Math.round(fpsValue);

    var bf = blueHQ && blueHQ.alive ? clamp(blueHQ.hp / blueHQ.maxHp, 0, 1) : 0;
    var rf = redHQ && redHQ.alive ? clamp(redHQ.hp / redHQ.maxHp, 0, 1) : 0;
    el.hqBlue.style.width = (bf * 100).toFixed(1) + '%';
    el.hqRed.style.width = (rf * 100).toFixed(1) + '%';
    el.hqBluePct.textContent = Math.round(bf * 100) + '%';
    el.hqRedPct.textContent = Math.round(rf * 100) + '%';

    updateCD(el.cdReinforce, el.btnReinforce, reinforceCd, REINFORCE_CD);
    updateCD(el.cdAirstrike, el.btnAirstrike, airstrikeCd, AIRSTRIKE_CD);
  }

  /* ============================================================
     11) ÇARPIŞMA / MERMİ / BOMBA GÜNCELLEME
     ============================================================ */
  function updateBullets(dt) {
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.mesh.visible = false; continue; }

      var nx = b.mesh.position.x + b.dir.x * b.speed * dt;
      var ny = b.mesh.position.y + b.dir.y * b.speed * dt;
      var nz = b.mesh.position.z + b.dir.z * b.speed * dt;

      // zemin teması
      if (ny <= groundHeight(nx, nz) * 0.6) {
        b.active = false; b.mesh.visible = false;
        impactDust(nx, ny, nz, 0.5);
        continue;
      }
      // harita dışı
      if (Math.abs(nx) > W.half + 10 || Math.abs(nz) > W.half + 10) {
        b.active = false; b.mesh.visible = false; continue;
      }

      b.mesh.position.set(nx, ny, nz);

      // birim çarpışması
      var hit = null;
      for (var j = 0; j < units.length; j++) {
        var u = units[j];
        if (!u.alive || u.team === b.team) continue;
        var rr = u.radius;
        var dx = nx - u.pos.x, dy = ny - (u.pos.y + (u.kind === 'hq' ? 2.0 : (u.kind === 'bomber' ? 0 : 1.0))), dz = nz - u.pos.z;
        if (dx * dx + dy * dy + dz * dz <= rr * rr) { hit = u; break; }
      }
      if (hit) {
        hit.takeDamage(b.damage, nx, ny, nz);
        b.active = false; b.mesh.visible = false;
      }
    }
  }

  function updateBombs(dt) {
    for (var i = 0; i < bombs.length; i++) {
      var b = bombs[i];
      if (!b.active) continue;
      b.vy -= 26 * dt;
      b.obj.position.x += b.vx * dt;
      b.obj.position.y += b.vy * dt;
      b.obj.position.z += b.vz * dt;
      b.obj.rotation.x += dt * 3.2;
      var gh = groundHeight(b.obj.position.x, b.obj.position.z);
      if (b.obj.position.y <= gh + 0.25) {
        b.active = false;
        b.obj.visible = false;
        var x = b.obj.position.x, z = b.obj.position.z;
        explode(x, gh + 0.4, z, 1.5, b.team);
        // alan hasarı
        var R = 11.5;
        for (var j = 0; j < units.length; j++) {
          var u = units[j];
          if (!u.alive || u.team === b.team) continue;
          var d = dist2D(u.pos.x, u.pos.z, x, z);
          if (d < R + u.radius) {
            var falloff = clamp(1 - d / (R + u.radius), 0, 1);
            u.takeDamage(34 + 52 * falloff, u.pos.x, u.pos.y + 1, u.pos.z);
          }
        }
        camShake = Math.min(3.4, camShake + 1.5);
      }
    }
  }

  /* ============================================================
     12) ANA DÖNGÜ
     ============================================================ */
  function updateCameraControls(dt) {
    var speed = viewSize * 1.35 * dt;
    var right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    var fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    var mx = 0, mz = 0;
    if (keys['KeyW'] || keys['ArrowUp']) mz += 1;
    if (keys['KeyS'] || keys['ArrowDown']) mz -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
    if (keys['KeyA'] && !(keys['ControlLeft'] || keys['ControlRight'] || keys['MetaLeft'] || keys['MetaRight'])) mx -= 1;
    if (keys['ArrowLeft']) mx -= 1;
    if (mx || mz) {
      camFocus.addScaledVector(right, mx * speed);
      camFocus.addScaledVector(fwd, mz * speed);
      clampFocus();
    }
    if (keys['KeyQ']) camYaw += dt * 1.7;
    if (keys['KeyE']) camYaw -= dt * 1.7;
  }

  function tick(ts) {
    requestAnimationFrame(tick);
    var dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (!isFinite(dt) || dt <= 0) dt = 0.016;
    dt = Math.min(dt, 0.05);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc > 0.4) { fpsValue = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }

    if (waterMat) waterMat.uniforms.uTime.value = (waterMat.uniforms.uTime.value + dt) % 1000;

    if (gameState === 'playing') {
      stats.time += dt;

      updateCameraControls(dt);

      // dalga / takviye düşman bombardımanı
      waveTimer -= dt;
      if (waveTimer <= 0) {
        spawnWave();
        waveInterval = Math.max(15, 25 - stats.wave * 0.6);
        waveTimer = waveInterval;
      }
      enemyBomberTimer -= dt;
      if (enemyBomberTimer <= 0) {
        enemyBomberTimer = rand(38, 58);
        var tx = 0, tz = 0, cnt = 0;
        for (var i = 0; i < units.length; i++) {
          var u = units[i];
          if (u.team === 'blue' && u.alive && u.kind === 'tank') { tx += u.pos.x; tz += u.pos.z; cnt++; }
        }
        if (cnt) callAirstrike('red', tx / cnt, tz / cnt, 2);
        else if (blueHQ) callAirstrike('red', blueHQ.pos.x, blueHQ.pos.z, 2);
        toast('⚠ DÜŞMAN BOMBARDIMAN UÇAKLARI GELİYOR', 2200);
      }

      reinforceCd = Math.max(0, reinforceCd - dt);
      airstrikeCd = Math.max(0, airstrikeCd - dt);

      for (i = 0; i < units.length; i++) if (units[i].alive) units[i].update(dt);
      updateBullets(dt);
      updateBombs(dt);
      updateHUD();
      drawMinimap();
      if (Math.floor(stats.time * 2) !== Math.floor((stats.time - dt) * 2)) updateSelectionUI();
    }

    // efektler her durumda güncellenir (menüde de canlı dursun)
    firePool.update(dt);
    smokePool.update(dt);
    debrisPool.update(dt);
    fireBillboards.update(dt);
    smokeBillboards.update(dt);
    updateRings(dt);
    updateScorches(dt);
    updateFlashes(dt);
    updateGroundFires(dt);
    updateBoomQueue(dt);

    // güneş gölge kamerasını odakla
    sun.position.set(camFocus.x + 90, 150, camFocus.z + 70);
    sun.target.position.set(camFocus.x, 0, camFocus.z);
    sun.target.updateMatrixWorld();

    if (blueHQ) for (var q = 0; q < units.length; q++) {
      var uu = units[q];
      if (uu.kind === 'hq' && uu.flag) uu.flag.rotation.z = Math.sin(ts * 0.002 + uu.pos.x) * 0.08;
    }

    if (camFollow) camFollow(dt);
    updateCamera(dt);
    renderer.render(scene, cam);

    diag.programs = renderer.info.programs ? renderer.info.programs.length : 0;
    diag.calls = renderer.info.render.calls;
    diag.tris = renderer.info.render.triangles;
  }

  /* Kamera yumuşatması (seçimi takip etmez; sadece yumuşak hareket) */
  var camFollow = null;

  /* ============================================================
     13) BAŞLAT
     ============================================================ */
  document.getElementById('startBtn').addEventListener('click', function () {
    startOverlay.classList.add('hidden');
    resetGame();
  });
  document.getElementById('restartBtn').addEventListener('click', function () {
    endOverlay.classList.add('hidden');
    resetGame();
  });

  resetGame();
  gameState = 'menu';
  updateSelectionUI();
  updateHUD();
  drawMinimap();
  updateCamera(0);
  requestAnimationFrame(tick);

  // yükleme ekranı → başlangıç ekranı
  UI.loading.classList.add('hidden');
  startOverlay.classList.remove('hidden');
  window.__NEON_FRONT_READY = true;
}

})();
