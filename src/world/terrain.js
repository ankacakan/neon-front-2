/* ============================================================
   NEON FRONT 2.0 — splat tabanlı PBR arazi (CC0 doku, prosedürel yedek)
   Biyom ağırlıkları vertex attribute olarak taşınır; fragment shader
   çim/kum/kaya/çakıl/toprak dokularını harmanlar ve dünya-uzayı
   normal perturbasyonu uygular.
   ============================================================ */
import * as THREE from 'three';
import { W, GRID_N, riverCX, terrainRelief, biomeWeights, walkableAt } from './mapgen.js';
import { Assets } from '../core/assets.js';
import { GLSL_NOISE } from '../core/utils.js';

/* Doku yoksa shader'ın derlenmesi için 1x1 beyaz yedek */
function whiteTex() {
  const d = new Uint8Array([255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}
function flatNormalTex() {
  const d = new Uint8Array([128, 128, 255, 255]);
  const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}
function greyTex(v) {
  const d = new Uint8Array([v, v, v, 255]);
  const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

export const terrain = { mesh: null, material: null };

export function buildTerrain(scene) {
  const SEG = 200;
  const geo = new THREE.PlaneGeometry(W.size, W.size, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const count = pos.count;
  const blend = new Float32Array(count * 4);
  const wetArr = new Float32Array(count);
  const w = {};

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const cx = riverCX(z);
    const d = Math.abs(x - cx);

    let y;
    if (d < W.riverHalf) {
      const t = d / W.riverHalf;
      y = -1.75 * (1 - t * t);
    } else {
      y = terrainRelief(x, z);
    }
    pos.setY(i, y);

    biomeWeights(x, z, w);
    blend[i * 4 + 0] = w.sand / (1 + w.wet);
    blend[i * 4 + 1] = w.grass / (1 + w.wet * 0.4);
    blend[i * 4 + 2] = w.rock;
    blend[i * 4 + 3] = w.gravel;
    wetArr[i] = w.wet;
  }
  geo.setAttribute('aBlend', new THREE.BufferAttribute(blend, 4));
  geo.setAttribute('aWet', new THREE.BufferAttribute(wetArr, 1));
  geo.computeVertexNormals();

  const T = Assets.textures;
  const U = {
    tGrass: { value: (T.grass && T.grass.map) || whiteTex() },
    tSand: { value: (T.sand && T.sand.map) || whiteTex() },
    tRock: { value: (T.rock && T.rock.map) || whiteTex() },
    tGravel: { value: (T.gravel && T.gravel.map) || whiteTex() },
    tDirt: { value: (T.dirt && T.dirt.map) || whiteTex() },
    tGrassN: { value: (T.grass && T.grass.normalMap) || flatNormalTex() },
    tSandN: { value: (T.sand && T.sand.normalMap) || flatNormalTex() },
    tRockN: { value: (T.rock && T.rock.normalMap) || flatNormalTex() },
    tGravelN: { value: (T.gravel && T.gravel.normalMap) || flatNormalTex() },
    tDirtN: { value: (T.dirt && T.dirt.normalMap) || flatNormalTex() },
    tDirtR: { value: (T.dirt && T.dirt.roughnessMap) || greyTex(210) },
    uNear: { value: 0.55 },     // detay tiling (dünya birimi^-1)
    uMacro: { value: 0.06 },    // makro tiling
    uNormalStrength: { value: 0.85 }
  };

  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.95, metalness: 0.0, envMapIntensity: 0.34, dithering: true
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);

    shader.vertexShader =
      'attribute vec4 aBlend;\nattribute float aWet;\n' +
      'varying vec3 vWPos;\nvarying vec4 vBlend;\nvarying float vWet;\nvarying vec3 vWorldNrm;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        '\tvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
        '\tvBlend = aBlend;\n\tvWet = aWet;\n' +
        '\tvWorldNrm = normalize(mat3(modelMatrix) * objectNormal);'
      );

    shader.fragmentShader =
      'uniform sampler2D tGrass; uniform sampler2D tSand; uniform sampler2D tRock;\n' +
      'uniform sampler2D tGravel; uniform sampler2D tDirt;\n' +
      'uniform sampler2D tGrassN; uniform sampler2D tSandN; uniform sampler2D tRockN;\n' +
      'uniform sampler2D tGravelN; uniform sampler2D tDirtN; uniform sampler2D tDirtR;\n' +
      'uniform float uNear; uniform float uMacro; uniform float uNormalStrength;\n' +
      'varying vec3 vWPos; varying vec4 vBlend; varying float vWet; varying vec3 vWorldNrm;\n' +
      GLSL_NOISE + '\n' +
      shader.fragmentShader
        // ---- Albedo splat ----
        .replace('#include <map_fragment>', `
          vec2 uvN = vWPos.xz * uNear;
          vec2 uvM = vWPos.xz * uMacro;
          vec3 cGrass  = texture2D(tGrass,  uvN * 1.00).rgb;
          vec3 cSand   = texture2D(tSand,   uvN * 0.85).rgb;
          vec3 cRock   = texture2D(tRock,   uvN * 1.30).rgb;
          vec3 cGravel = texture2D(tGravel, uvN * 1.15).rgb;
          vec3 cDirt   = texture2D(tDirt,   uvN * 0.90).rgb;
          float dirtW = max(0.0, 1.0 - (vBlend.x + vBlend.y + vBlend.z + vBlend.w));
          vec3 albedo = cSand * vBlend.x + cGrass * vBlend.y + cRock * vBlend.z
                      + cGravel * vBlend.w + cDirt * dirtW;
          // makro renk varyasyonu (referanstaki leke/ton farkı)
          float macro = vfx_fbm(vec3(vWPos.xz * uMacro * 2.4, 3.7));
          float micro = vfx_vn(vec3(vWPos.xz * 3.1, 9.1));
          albedo *= 0.80 + 0.42 * macro;
          albedo *= 0.94 + 0.12 * micro;
          // ıslak nehir yatağı koyulaşır
          albedo = mix(albedo, albedo * 0.46, vWet * 0.75);
          vec3 tint = vec3(0.98, 1.02, 0.96);
          diffuseColor.rgb *= albedo * tint;
        `)
        // ---- Normal perturbasyonu (dünya uzayı, türevsiz) ----
        .replace('#include <normal_fragment_maps>', `
          vec3 nG = texture2D(tGrassN,  vWPos.xz * uNear * 1.00).xyz * 2.0 - 1.0;
          vec3 nS = texture2D(tSandN,   vWPos.xz * uNear * 0.85).xyz * 2.0 - 1.0;
          vec3 nR = texture2D(tRockN,   vWPos.xz * uNear * 1.30).xyz * 2.0 - 1.0;
          vec3 nV = texture2D(tGravelN, vWPos.xz * uNear * 1.15).xyz * 2.0 - 1.0;
          vec3 nD = texture2D(tDirtN,   vWPos.xz * uNear * 0.90).xyz * 2.0 - 1.0;
          float dirtW2 = max(0.0, 1.0 - (vBlend.x + vBlend.y + vBlend.z + vBlend.w));
          vec3 nTex = normalize(nS * vBlend.x + nG * vBlend.y + nR * vBlend.z
                     + nV * vBlend.w + nD * dirtW2 + vec3(0.0, 0.0, 0.001));
          vec3 nWorld = normalize(vWorldNrm);
          vec3 t1 = normalize(cross(vec3(0.0, 1.0, 0.0), nWorld) + vec3(0.0007, 0.0, 0.0007));
          vec3 t2 = normalize(cross(nWorld, t1));
          float nStr = uNormalStrength * (1.0 - vWet * 0.5);
          vec3 perturbed = normalize(nWorld + (t1 * nTex.x + t2 * nTex.y) * nStr);
          normal = normalize((viewMatrix * vec4(perturbed, 0.0)).xyz);
        `)
        // ---- Pürüzlülük ----
        .replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = roughness;
          float rDirt = texture2D(tDirtR, vWPos.xz * uNear * 0.9).g;
          roughnessFactor = clamp(0.68 + rDirt * 0.34 + (vfx_vn(vec3(vWPos.xz * 3.3, 1.1)) - 0.5) * 0.18, 0.5, 1.0);
          roughnessFactor *= (1.0 - vWet * 0.55);
        `);
  };
  mat.needsUpdate = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  terrain.mesh = mesh;
  terrain.material = mat;
  return mesh;
}

/* Grid için yürünebilirlik (pathfinding'e köprü) */
export function buildWalkGrid() {
  const walkable = new Uint8Array(GRID_N * GRID_N);
  for (let j = 0; j < GRID_N; j++) {
    for (let i = 0; i < GRID_N; i++) {
      const x = -W.half + (i + 0.5) * W.cell;
      const z = -W.half + (j + 0.5) * W.cell;
      walkable[j * GRID_N + i] = walkableAt(x, z) ? 1 : 0;
    }
  }
  return walkable;
}
