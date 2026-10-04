/* ============================================================
   NEON FRONT 2.0 — varlık yükleyici (CC0 PBR doku + glTF model)
   Harici dosyalar yüklenemezse prosedürel yedek devreye girer.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { CFG } from '../config.js';

const TEX = CFG.assets.textures;
const MOD = CFG.assets.models;

/* Yüklenecek PBR doku setleri: isim -> ambientCG haritaları */
const TEXTURE_SETS = {
  grass:      { repeat: 42 },
  grass_alt:  { repeat: 42 },
  dirt:       { repeat: 34 },
  sand:       { repeat: 30 },
  sand_alt:   { repeat: 30 },
  rock:       { repeat: 26 },
  rock_alt:   { repeat: 26 },
  wood:       { repeat: 8 },
  metal:      { repeat: 6 },
  gravel:     { repeat: 34 },
  concrete:   { repeat: 16 }
};

/* Yüklenecek glTF modeller (Kenney CC0) */
const MODEL_MANIFEST = {
  nature: {
    trees: ['tree_default', 'tree_detailed', 'tree_pineRoundA', 'tree_pineTallA', 'tree_oak', 'tree_fat', 'tree_small', 'tree_thin', 'tree_palmTall'],
    bushes: ['plant_bush', 'plant_bushDetailed', 'plant_bushLarge'],
    grass: ['grass', 'grass_large', 'grass_leafs'],
    rocks: ['rock_largeA', 'rock_largeC', 'rock_largeE', 'rock_tallA', 'rock_smallA', 'rock_smallC', 'stone_largeA', 'stone_smallA'],
    cactus: ['cactus_short', 'cactus_tall'],
    details: ['stump_round', 'log', 'mushroom_redGroup', 'path_stone', 'crops_wheatStageC']
  },
  tower: {
    details: ['detail-crystal', 'detail-rocks', 'detail-tree']
  },
  city: {
    buildings: ['building-a', 'building-c', 'building-f', 'building-h', 'building-j', 'building-l', 'building-n', 'building-p', 'building-r', 'water-tower', 'chimney-large', 'shipping-container-a']
  },
  car: {
    vehicles: ['truck', 'truck-flat', 'van', 'suv', 'tractor', 'sedan', 'garbage-truck']
  }
};

export const Assets = {
  textures: {},        // 'grass' -> { map, normalMap, roughnessMap, metalnessMap, displacementMap }
  models: {},          // 'tree_default' -> THREE.Object3D (prototip)
  groups: {            // kategori -> model anahtarı dizisi
    trees: [], bushes: [], grass: [], rocks: [], cactus: [], details: [],
    buildings: [], vehicles: []
  },
  hasTextures: false,
  hasModels: false,
  loaded: 0,
  total: 0
};

/* ---------------------------------------------------------------
   Doku yükleme
   --------------------------------------------------------------- */
function loadTex(loader, url, srgb) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      () => resolve(null)      // 404 → null (prosedürel yedeğe düşer)
    );
  });
}

async function loadTextures(onStep) {
  const loader = new THREE.TextureLoader();
  let ok = 0;
  for (const [name, opt] of Object.entries(TEXTURE_SETS)) {
    const r = opt.repeat || 32;
    const [map, normalMap, roughnessMap, metalnessMap, aoMap, displacementMap] = await Promise.all([
      loadTex(loader, `${TEX}${name}_color.jpg`, true),
      loadTex(loader, `${TEX}${name}_normal.jpg`, false),
      loadTex(loader, `${TEX}${name}_roughness.jpg`, false),
      loadTex(loader, `${TEX}${name}_metalness.jpg`, false),
      loadTex(loader, `${TEX}${name}_ao.jpg`, false),
      loadTex(loader, `${TEX}${name}_displacement.jpg`, false)
    ]);
    if (map) {
      for (const t of [map, normalMap, roughnessMap, metalnessMap, aoMap, displacementMap]) {
        if (t) t.repeat.set(r, r);
      }
      Assets.textures[name] = { map, normalMap, roughnessMap, metalnessMap, aoMap, displacementMap, repeat: r };
      ok++;
    }
    Assets.loaded++;
    if (onStep) onStep(Assets.loaded, Assets.total, `Doku: ${name}`);
  }
  Assets.hasTextures = ok > 0;
  return ok;
}

/* ---------------------------------------------------------------
   Model yükleme
   --------------------------------------------------------------- */
function prepModel(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if ('envMapIntensity' in m) m.envMapIntensity = 0.7;
      if ('roughness' in m && m.roughness === undefined) m.roughness = 0.85;
      m.side = THREE.FrontSide;
    }
  });
  return root;
}

/** Modelin yüksekliğini ölç (ölçekleme için). */
export function modelHeight(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  return Math.max(0.0001, box.max.y - box.min.y);
}
export function modelSize(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  return box.getSize(new THREE.Vector3());
}

/* Modelin merkezini zemine oturt: alt y = 0 olacak şekilde kaydır */
function groundAlign(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box.min.y;
  return obj;
}

async function loadModels(onStep) {
  const loader = new GLTFLoader();
  try {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://unpkg.com/three@0.186.1/examples/jsm/libs/draco/');
    loader.setDRACOLoader(draco);
  } catch (e) { /* draco opsiyonel */ }

  const jobs = [];
  for (const [pack, cats] of Object.entries(MODEL_MANIFEST)) {
    const dir = MOD + (CFG.assets.modelPacks[pack] || (pack + '/'));
    for (const [cat, names] of Object.entries(cats)) {
      for (const nm of names) {
        jobs.push({ pack, cat, nm, url: `${dir}${nm}.glb` });
      }
    }
  }

  let ok = 0;
  let firstErr = null;
  for (const job of jobs) {
    const gltf = await new Promise((resolve) => {
      loader.load(job.url, (g) => resolve(g), undefined, (err) => {
        if (!firstErr) firstErr = `${job.url} → ${(err && (err.message || err.type || err)) || 'bilinmeyen hata'}`;
        resolve(null);
      });
    });
    if (gltf) {
      const proto = prepModel(gltf.scene || gltf.scenes[0]);
      groundAlign(proto);
      Assets.models[job.nm] = proto;
      const g = Assets.groups[job.cat];
      if (g && !g.includes(job.nm)) g.push(job.nm);
      ok++;
    }
    Assets.loaded++;
    if (onStep) onStep(Assets.loaded, Assets.total, `Model: ${job.nm}`);
  }
  Assets.hasModels = ok > 0;
  Assets.lastModelError = firstErr;
  Assets.modelJobs = jobs.length;
  return ok;
}

/* ---------------------------------------------------------------
   Genel yükleme
   --------------------------------------------------------------- */
export async function loadAssets(onStep) {
  Assets.total = Object.keys(TEXTURE_SETS).length +
    Object.values(MODEL_MANIFEST).reduce((a, c) => a + Object.values(c).reduce((b, l) => b + l.length, 0), 0);
  Assets.loaded = 0;

  const texOk = await loadTextures(onStep);
  const modOk = await loadModels(onStep);

  return { textures: texOk, models: modOk, hasTextures: Assets.hasTextures, hasModels: Assets.hasModels };
}

/* ---------------------------------------------------------------
   Model örneği üret (klon + ölçek + döndürme + ton uygula)
   --------------------------------------------------------------- */
export function instanceModel(key, opts = {}) {
  const proto = Assets.models[key];
  if (!proto) return null;
  const obj = proto.clone(true);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = opts.castShadow !== false;
    o.receiveShadow = true;
    if (opts.tint) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      o.material = mats.map((m) => {
        if (!m) return m;
        const c = m.clone();
        c.color = new THREE.Color(opts.tint).multiply(new THREE.Color(m.color || 0xffffff));
        return c;
      });
      o.material = o.material.length === 1 ? o.material[0] : o.material;
    }
  });

  if (opts.height) {
    const h = modelHeight(obj);
    const s = opts.height / h;
    obj.scale.setScalar(s);
  } else if (opts.scale !== undefined) {
    obj.scale.setScalar(opts.scale);
  }
  if (opts.yaw !== undefined) obj.rotation.y = opts.yaw;
  if (opts.randYaw) obj.rotation.y = Math.random() * Math.PI * 2;
  if (opts.x !== undefined) obj.position.set(opts.x, opts.y || 0, opts.z || 0);
  return obj;
}

/** Bir kategori için rastgele yüklü model anahtarı (yoksa null). */
export function randomOf(group) {
  const g = Assets.groups[group];
  if (!g || !g.length) return null;
  return g[(Math.random() * g.length) | 0];
}

/** PBR doku seti (yoksa null). */
export function tex(name) { return Assets.textures[name] || null; }
