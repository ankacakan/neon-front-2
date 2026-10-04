/* ============================================================
   NEON FRONT 2.0 — sahne: instancing'li glTF bitki örtüsü/kayalar,
   prosedürel köprü (ahşap PBR), sanayi dekoru ve ele geçirme işaretleri.
   ============================================================ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { W, riverCX, groundHeight, bridgeHeight, walkableAt } from './mapgen.js';
import { Assets, modelHeight } from '../core/assets.js';
import { rand, randInt, TAU, clamp } from '../core/utils.js';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();

/* ---------------------------------------------------------------
   Modeli "part"lara ayır (geometri + materyal), kök uzayına pişir
   --------------------------------------------------------------- */
function extractParts(key) {
  const proto = Assets.models[key];
  if (!proto) return null;
  proto.updateMatrixWorld(true);
  const parts = [];
  proto.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.uv && g.attributes.position) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    }
    parts.push({ geo: g, mat: Array.isArray(o.material) ? o.material[0] : o.material });
  });
  return parts.length ? parts : null;
}

/* ---------------------------------------------------------------
   Parça önbelleği: aynı model/tür için geometri+materyali bir kez
   hazırla (her yerleşimde yeniden klonlamayı önler → daha az GC).
   --------------------------------------------------------------- */
const _partsCache = new Map();
function partsFor(key, kind) {
  const id = (key || 'proc') + '|' + kind;
  let rec = _partsCache.get(id);
  if (rec) return rec;
  let parts = key ? extractParts(key) : null;
  const model = !!parts;
  if (!parts) parts = proceduralParts(kind);
  const proto = key ? Assets.models[key] : null;
  rec = { parts, h: proto ? modelHeight(proto) : 1, model, source: key || ('proc:' + kind) };
  _partsCache.set(id, rec);
  return rec;
}

/* ---------------------------------------------------------------
   Toplayıcı: aynı prototipi (+gölge bayrağını) paylaşan tüm
   yerleşimleri tek InstancedMesh partisi altında birleştirir.
   Böylece ~1300 ayrı mesh yerine kaynak model başına 1 parti kalır.
   --------------------------------------------------------------- */
function makeBatcher() {
  const batches = new Map();
  return {
    add(parts, source, h, castShadow, p) {
      const key = source + '|' + (castShadow ? 1 : 0);
      let b = batches.get(key);
      if (!b) { b = { parts, h, castShadow, placements: [] }; batches.set(key, b); }
      b.placements.push(p);
    },
    flush(parent) {
      for (const b of batches.values()) buildInstancedBatch(parent, b);
    }
  };
}

/* Tek parti → parça başına bir InstancedMesh (materyal klonlu).
   Instance matrisleri StaticDrawUsage; sınır küresi hesaplanır ve
   frustum culling açılır. */
function buildInstancedBatch(parent, b) {
  const { parts, placements, castShadow } = b;
  const h = b.h || 1;
  const n = placements.length;
  for (const part of parts) {
    const mat = part.mat.clone();
    mat.side = THREE.FrontSide;
    if ('envMapIntensity' in mat) mat.envMapIntensity = 0.65;
    const im = new THREE.InstancedMesh(part.geo, mat, n);
    im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    im.castShadow = castShadow;
    im.receiveShadow = true;
    im.frustumCulled = true;
    im.name = 'scenery-batch';
    for (let i = 0; i < n; i++) {
      const p = placements[i];
      const sc = (p.height / h) * (p.scale || 1);
      _e.set(p.tilt || 0, p.yaw || 0, p.tilt2 || 0);
      _q.setFromEuler(_e);
      _v.set(p.x, p.y, p.z);
      _s.set(sc * (p.sx || 1), sc * (p.sy || 1), sc * (p.sz || 1));
      _m4.compose(_v, _q, _s);
      im.setMatrixAt(i, _m4);
      if (p.tint) im.setColorAt(i, _col.set(p.tint));
      else im.setColorAt(i, _col.setRGB(1, 1, 1));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    parent.add(im);
  }
}

/* ---------------------------------------------------------------
   Yerleştirme yardımcıları
   --------------------------------------------------------------- */
function makePlacer() {
  const placed = [];
  return {
    placed,
    tooClose(x, z, r) {
      for (const p of placed) {
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz < r * r) return true;
      }
      return false;
    },
    spot(minFromRiver, avoidBridge, tries, minDist) {
      for (let t = 0; t < (tries || 30); t++) {
        const x = rand(-W.half + 8, W.half - 8);
        const z = rand(-W.half + 8, W.half - 8);
        const cx = riverCX(z);
        if (Math.abs(x - cx) < W.riverHalf + minFromRiver) continue;
        if (avoidBridge && Math.abs(z - W.bridgeZ) < W.bridgeHalfWidth + 8 && Math.abs(x - cx) < 36) continue;
        if (!walkableAt(x, z)) continue;
        if (this.tooClose(x, z, minDist === undefined ? 4.6 : minDist)) continue;
        placed.push({ x, z });
        return { x, z, side: x < cx ? -1 : 1 };
      }
      return null;
    }
  };
}

/* ---------------------------------------------------------------
   Prosedürel yedek bitki örtüsü (model yoksa)
   --------------------------------------------------------------- */
function proceduralParts(kind) {
  if (kind === 'tree') {
    return [
      { geo: new THREE.CylinderGeometry(0.24, 0.34, 1, 6).translate(0, 0.5, 0), mat: new THREE.MeshStandardMaterial({ color: 0x574127, roughness: 0.92 }) },
      { geo: new THREE.ConeGeometry(0.62, 1.0, 7).translate(0, 1.35, 0), mat: new THREE.MeshStandardMaterial({ color: 0x2f6b2c, roughness: 0.95 }) }
    ];
  }
  if (kind === 'bush') {
    return [{ geo: new THREE.IcosahedronGeometry(0.5, 0).translate(0, 0.4, 0), mat: new THREE.MeshStandardMaterial({ color: 0x2c5c26, roughness: 0.95 }) }];
  }
  if (kind === 'rock') {
    return [{ geo: new THREE.DodecahedronGeometry(0.5, 0).translate(0, 0.35, 0), mat: new THREE.MeshStandardMaterial({ color: 0x8f8674, roughness: 0.9 }) }];
  }
  if (kind === 'cactus') {
    return [{ geo: new THREE.CylinderGeometry(0.18, 0.2, 1, 7).translate(0, 0.5, 0), mat: new THREE.MeshStandardMaterial({ color: 0x477235, roughness: 0.9 }) }];
  }
  return [{ geo: new THREE.ConeGeometry(0.14, 0.5, 4).translate(0, 0.25, 0), mat: new THREE.MeshStandardMaterial({ color: 0x5a9b42, roughness: 0.95 }) }];
}

/* ---------------------------------------------------------------
   Ana sahne kurulumu
   --------------------------------------------------------------- */
export function buildScenery(scene) {
  const group = new THREE.Group();
  group.name = 'scenery';
  scene.add(group);

  const placer = makePlacer();
  const useModels = Assets.hasModels;
  const batcher = makeBatcher();

  const addVariant = (key, kind, count, targetH, opts) => {
    const placements = [];
    for (let i = 0; i < count; i++) {
      const p = placer.spot(opts.minRiver || 3, true, 30, opts.minDist || 4.6);
      if (!p) continue;
      if (opts.side === 'east' && p.side < 0) { placer.placed.pop(); continue; }
      if (opts.side === 'west' && p.side > 0) { placer.placed.pop(); continue; }
      p.y = groundHeight(p.x, p.z) - 0.05;
      p.yaw = rand(0, TAU);
      p.scale = rand(opts.sMin || 0.82, opts.sMax || 1.28);
      if (opts.tint) p.tint = opts.tint;
      p.height = targetH;
      placements.push(p);
    }
    if (!placements.length) return;
    const rec = partsFor(useModels ? key : null, kind);
    const castShadow = opts.castShadow !== false;
    for (const p of placements) batcher.add(rec.parts, rec.source, rec.h, castShadow, p);
  };

  /* ---- Orman (doğu) ---- */
  const treeKeys = useModels ? Assets.groups.trees : [];
  if (treeKeys.length) {
    for (let i = 0; i < 130; i++) {
      const key = treeKeys[i % treeKeys.length];
      addVariant(key, 'tree', 1, rand(5.5, 9.5), { side: 'east', minRiver: 3.5, minDist: 4.4, sMin: 0.8, sMax: 1.3 });
    }
    for (let i = 0; i < 110; i++) {
      const key = treeKeys[(i * 3 + 1) % treeKeys.length];
      addVariant(key, 'tree', 1, rand(4.5, 8.0), { side: 'east', minRiver: 6, minDist: 2.6, sMin: 0.7, sMax: 1.1 });
    }
  } else {
    addVariant('tree', 'tree', 200, 7.5, { side: 'east', minRiver: 3.5, minDist: 4.0 });
  }

  /* ---- Palmiye / çöl ağacı (batı) ---- */
  if (useModels && Assets.groups.trees.length) {
    for (let i = 0; i < 26; i++) addVariant('tree_palmTall', 'tree', 1, rand(5, 8), { side: 'west', minRiver: 4, minDist: 6 });
  }

  /* ---- Çalılar ---- */
  if (useModels && Assets.groups.bushes.length) {
    const b = Assets.groups.bushes;
    for (let i = 0; i < 90; i++) addVariant(b[i % b.length], 'bush', 1, rand(1.2, 2.4), { side: 'east', minRiver: 2, minDist: 3 });
  } else {
    addVariant('bush', 'bush', 90, 1.8, { side: 'east', minRiver: 2, minDist: 3 });
  }

  /* ---- Çim kartları / tutamlar ---- */
  if (useModels && Assets.groups.grass.length) {
    const g = Assets.groups.grass;
    for (let i = 0; i < 260; i++) addVariant(g[i % g.length], 'grass', 1, rand(0.5, 1.1), { side: 'east', minRiver: 3, minDist: 1.6, castShadow: false });
  }

  /* ---- Küçük kayalar ---- */
  if (useModels && Assets.groups.rocks.length) {
    const r = Assets.groups.rocks;
    for (let i = 0; i < 150; i++) addVariant(r[i % r.length], 'rock', 1, rand(0.5, 2.2), { minRiver: 2.5, minDist: 2.4 });
  } else {
    addVariant('rock', 'rock', 150, 1.2, { minRiver: 2.5, minDist: 2.4 });
  }

  /* ---- Büyük kaya blokları (çöl) ---- */
  if (useModels && Assets.groups.rocks.length) {
    for (let i = 0; i < 34; i++) addVariant('rock_largeE', 'rock', 1, rand(2.4, 4.6), { side: 'west', minRiver: 5, minDist: 8 });
  }

  /* ---- Kaktüsler (çöl) ---- */
  if (useModels && Assets.groups.cactus.length) {
    const c = Assets.groups.cactus;
    for (let i = 0; i < 90; i++) addVariant(c[i % c.length], 'cactus', 1, rand(1.6, 3.4), { side: 'west', minRiver: 3, minDist: 4 });
  } else {
    addVariant('cactus', 'cactus', 90, 2.6, { side: 'west', minRiver: 3, minDist: 4 });
  }

  /* ---- Kıyı çakılları ---- */
  for (let pz = -W.half + 6; pz < W.half - 6; pz += 1.6) {
    for (let side = -1; side <= 1; side += 2) {
      if (Math.random() > 0.7) continue;
      const cx = riverCX(pz);
      const px = cx + side * W.riverHalf * rand(0.62, 1.06) + rand(-0.6, 0.6);
      if (Math.abs(px) > W.half - 4) continue;
      if (Math.abs(pz - W.bridgeZ) < W.bridgeHalfWidth + 4 && Math.abs(px) < W.bridgeHalfLen + 4) continue;
      const y = groundHeight(px, pz);
      const key = useModels && Assets.groups.rocks.length ? Assets.groups.rocks[(Math.random() * Assets.groups.rocks.length) | 0] : null;
      const rec = partsFor(key, 'rock');
      batcher.add(rec.parts, rec.source, rec.h, false,
        { x: px, y: y - 0.05, z: pz, yaw: rand(0, TAU), scale: rand(0.5, 1.4), height: rand(0.4, 1.1) });
    }
  }

  batcher.flush(group);
  return group;
}

/* ---------------------------------------------------------------
   Prosedürel köprü (ahşap PBR dokulu)
   --------------------------------------------------------------- */
export function buildBridge(scene) {
  const woodTex = Assets.textures.wood;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xa08a68, roughness: 0.86, metalness: 0.04,
    vertexColors: true, envMapIntensity: 0.5,
    map: woodTex ? woodTex.map : null,
    normalMap: woodTex ? woodTex.normalMap : null,
    roughnessMap: woodTex ? woodTex.roughnessMap : null
  });
  mat.normalScale = new THREE.Vector2(0.6, 0.6);

  const parts = [];
  const push = (geo, m, hex, jitter) => {
    const g = geo.clone();
    g.applyMatrix4(m);
    const c = new THREE.Color(hex);
    if (jitter) c.multiplyScalar(1 + rand(-jitter, jitter));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    parts.push(g);
  };
  const trs = (x, y, z, rx, ry, rz, sx, sy, sz) => {
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), _q,
      new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz)
    );
  };

  const gPlank = new THREE.BoxGeometry(1, 1, 1);
  const gPost = new THREE.CylinderGeometry(0.34, 0.4, 1, 7);
  const B = { x0: -W.bridgeHalfLen, x1: W.bridgeHalfLen, hw: W.bridgeHalfWidth, z: W.bridgeZ };
  const planks = 30, span = B.x1 - B.x0, pw = span / planks;

  for (let i = 0; i < planks; i++) {
    const px = B.x0 + pw * (i + 0.5);
    const hgt = bridgeHeight(px, B.z);
    const slope = (bridgeHeight(px + pw, B.z) - bridgeHeight(px - pw, B.z)) / (2 * pw);
    push(gPlank, trs(px, hgt - 0.18, B.z, 0, 0, -Math.atan(slope), pw * 0.96, 0.36, B.hw * 2), 0x8a7a60, 0.16);
  }
  for (let i = 0; i < planks; i++) {
    const qx = B.x0 + pw * (i + 0.5);
    const qh = bridgeHeight(qx, B.z);
    const qs = (bridgeHeight(qx + pw, B.z) - bridgeHeight(qx - pw, B.z)) / (2 * pw);
    for (let side = -1; side <= 1; side += 2) {
      push(gPlank, trs(qx, qh + 0.62, B.z + side * (B.hw - 0.3), 0, 0, -Math.atan(qs), pw * 0.96, 0.16, 0.24), 0x9c8a6c, 0.14);
      push(gPlank, trs(qx, qh + 0.95, B.z + side * (B.hw - 0.3), 0, 0, 0, pw * 0.9, 0.14, 0.18), 0x7d6d52, 0.14);
    }
    if (i % 2 === 0 && Math.abs(qx) < B.x1 - 4) {
      for (let s2 = -1; s2 <= 1; s2 += 2) push(gPlank, trs(qx, qh + 0.5, B.z + s2 * (B.hw - 0.3), 0, 0, 0, 0.26, 1.1, 0.26), 0x6a5c44, 0.1);
    }
  }
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    const fx = i * 8;
    const gy = groundHeight(fx, B.z);
    push(gPost, trs(fx, gy - 1.6, B.z - B.hw * 0.65, 0, 0, 0, 1.1, 4.4, 1.1), 0x66594a, 0.1);
    push(gPost, trs(fx, gy - 1.6, B.z + B.hw * 0.65, 0, 0, 0, 1.1, 4.4, 1.1), 0x66594a, 0.1);
  }
  for (let sb = -1; sb <= 1; sb += 2) {
    const bx = sb * B.x1;
    push(gPlank, trs(bx + sb * 2.2, 0.2, B.z, 0, 0, 0, 4.6, 1.5, B.hw * 2 + 2.6), 0x968d80, 0.12);
    push(gPlank, trs(bx + sb * 1.2, -0.5, B.z, 0, 0, 0, 3.0, 1.2, B.hw * 2 + 3.6), 0xa39a87, 0.12);
  }

  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'bridge';
  scene.add(mesh);
  return mesh;
}

/* ---------------------------------------------------------------
   Sanayi dekoru (üs çevresi): binalar, konteynerler, varil
   --------------------------------------------------------------- */
export function buildDecor(scene, bases) {
  const group = new THREE.Group();
  group.name = 'decor';
  scene.add(group);

  const keys = Assets.hasModels ? Assets.groups.buildings : [];
  if (!keys.length) return group;

  const batcher = makeBatcher();
  for (const base of bases) {
    if (!base) continue;
    const n = 4;
    for (let i = 0; i < n; i++) {
      const key = keys[randInt(0, keys.length - 1)];
      const ang = (i / n) * TAU + rand(-0.4, 0.4);
      const rad = rand(24, 40);
      let x = base.x + Math.cos(ang) * rad;
      let z = base.z + Math.sin(ang) * rad;
      if (!walkableAt(x, z)) { x = base.x + Math.cos(ang) * 20; z = base.z + Math.sin(ang) * 20; }
      const rec = partsFor(key, 'building');
      if (!rec.model) continue;
      const y = groundHeight(x, z) - 0.05;
      batcher.add(rec.parts, rec.source, rec.h, true,
        { x, y, z, yaw: rand(0, TAU), scale: rand(0.9, 1.4), height: rand(9, 16) });
    }
  }
  batcher.flush(group);
  return group;
}

/* ---------------------------------------------------------------
   Ele geçirme noktası işaretleri
   --------------------------------------------------------------- */
export function buildCaptureMarkers(scene, points) {
  const group = new THREE.Group();
  group.name = 'capture';
  scene.add(group);

  const ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
  const list = [];
  for (const p of points) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcfd8e0, transparent: true, opacity: 0.5,
      side: THREE.DoubleSide, depthWrite: false, fog: false
    });
    const ring = new THREE.Mesh(ringGeo, mat);
    ring.position.set(p.x, groundHeight(p.x, p.z) + 0.12, p.z);
    ring.scale.set(p.radius, 1, p.radius);
    ring.renderOrder = 2;
    group.add(ring);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x394049, roughness: 0.5, metalness: 0.7 });
    const flagMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.7, side: THREE.DoubleSide });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 7, 6), poleMat);
    const y0 = groundHeight(p.x, p.z);
    pole.position.set(p.x, y0 + 3.5, p.z);
    pole.castShadow = true;
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), flagMat);
    flag.position.set(p.x + 1.2, y0 + 6.1, p.z);
    group.add(flag);

    list.push({ point: p, ring, mat, flag, flagMat, y0 });
  }
  return { group, list };
}

/* Marker renklerini sahipliğe göre güncelle */
export function updateCaptureMarkers(markers, teamColors) {
  if (!markers) return;
  for (const m of markers.list) {
    const owner = m.point.owner;
    const col = owner === 'blue' ? teamColors.blue : owner === 'red' ? teamColors.red : 0xcfd8e0;
    m.mat.color.setHex(col);
    m.mat.opacity = 0.42 + 0.25 * clamp(m.point.progress, 0, 1);
    m.flagMat.color.setHex(col);
  }
}
