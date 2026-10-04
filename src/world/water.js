/* ============================================================
   NEON FRONT 2.0 — gelişmiş su: dalga deplasmanı, derinliğe bağlı
   renk gradyanı, kıyı köpüğü ve PBR/IBL yansıması.
   ============================================================ */
import * as THREE from 'three';
import { W, riverCX } from './mapgen.js';
import { GLSL_NOISE } from '../core/utils.js';

export const water = { mesh: null, material: null, time: 0 };

export function buildWater(scene) {
  const STEPS = 220;
  const positions = [], uvs = [], indices = [], edge = [];

  for (let i = 0; i <= STEPS; i++) {
    const z = -W.half + W.size * (i / STEPS);
    const cx = riverCX(z);
    const hw = W.waterHalf + 0.7 * Math.sin(z * 0.09 + 1.3);
    positions.push(cx - hw, 0, z);
    positions.push(cx + hw, 0, z);
    uvs.push(0, z * 0.04);
    uvs.push(1, z * 0.04);
    edge.push(-1, 1);
  }
  for (let k = 0; k < STEPS; k++) {
    const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, c, b, b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x0b3348,
    roughness: 0.065,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.45,
    transparent: true,
    opacity: 0.93,
    side: THREE.DoubleSide,
    depthWrite: true
  });

  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x04121f) },
    uShallow: { value: new THREE.Color(0x0f6b78) },
    uFoam: { value: new THREE.Color(0xdfeef6) }
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader =
      'uniform float uTime;\nattribute float aEdge;\nvarying float vEdge;\nvarying vec3 vWPos;\nvarying vec3 vWaveN;\n' +
      'vec3 waveN(vec3 p){\n' +
      '  float dx = 0.34*cos(p.x*0.34+uTime*1.7)*0.11 + 0.19*cos((p.x+p.z)*0.19+uTime*0.9)*0.07;\n' +
      '  float dz = 0.29*cos(p.z*0.29-uTime*1.25)*0.10 + 0.19*cos((p.x+p.z)*0.19+uTime*0.9)*0.07;\n' +
      '  return normalize(vec3(-dx, 1.0, -dz));\n' +
      '}\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        '\tvEdge = aEdge;\n' +
        '\tfloat w1 = sin(transformed.x*0.34 + uTime*1.7)*0.11;\n' +
        '\tfloat w2 = sin(transformed.z*0.29 - uTime*1.25)*0.10;\n' +
        '\tfloat w3 = sin((transformed.x+transformed.z)*0.19 + uTime*0.9)*0.07;\n' +
        '\ttransformed.y += w1 + w2 + w3;\n' +
        '\tvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
        '\tvWaveN = waveN(transformed);\n'
      );

    shader.fragmentShader =
      'uniform float uTime;\nuniform vec3 uDeep;\nuniform vec3 uShallow;\nuniform vec3 uFoam;\n' +
      'varying float vEdge;\nvarying vec3 vWPos;\nvarying vec3 vWaveN;\n' +
      GLSL_NOISE + '\n' +
      shader.fragmentShader
        // Derinliğe bağlı renk + köpük
        .replace('#include <map_fragment>', `
          float shore = smoothstep(0.0, 0.40, 1.0 - abs(vEdge));   // 1 = kıyı
          float depthMix = smoothstep(0.05, 0.75, 1.0 - abs(vEdge));
          vec3 col = mix(uShallow, uDeep, depthMix);
          // kırışıklık/parıltı
          float ripple = vfx_vn(vec3(vWPos.xz * 1.6, uTime * 0.35));
          col += vec3(0.03, 0.06, 0.07) * (ripple - 0.5);
          // kıyı köpüğü (referanstaki dalga ucu)
          float fnoise = vfx_fbm(vec3(vWPos.xz * 2.4, uTime * 0.6));
          float foam = smoothstep(0.82, 1.0, shore * (0.75 + 0.5 * fnoise));
          foam += smoothstep(0.95, 1.0, shore) * 0.6;
          col = mix(col, uFoam, clamp(foam, 0.0, 0.9));
          diffuseColor.rgb *= col * 2.2;
        `)
        // Dalga normali → yansıma kırılması
        .replace('#include <normal_fragment_maps>', `
          vec3 nWorld = normalize(vWaveN);
          float chop = vfx_vn(vec3(vWPos.xz * 5.0, uTime * 0.9)) - 0.5;
          nWorld = normalize(nWorld + vec3(chop, 0.0, -chop) * 0.09);
          normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
        `)
        // Köpükte pürüzlülük artışı
        .replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = roughness;
          float shore2 = smoothstep(0.0, 0.40, 1.0 - abs(vEdge));
          float f2 = vfx_fbm(vec3(vWPos.xz * 2.4, uTime * 0.6));
          float foamAmt = smoothstep(0.82, 1.0, shore2 * (0.75 + 0.5 * f2));
          roughnessFactor = clamp(mix(roughnessFactor, 0.55, foamAmt), 0.02, 1.0);
        `);
  };
  mat.needsUpdate = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.42;
  mesh.name = 'water';
  mesh.receiveShadow = false;
  scene.add(mesh);

  water.mesh = mesh;
  water.material = mat;
  water.uniforms = uniforms;
  return mesh;
}

export function updateWater(dt) {
  water.time += dt;
  if (water.uniforms) water.uniforms.uTime.value = water.time % 1000;
}
