/* ============================================================
   NEON FRONT 2.0 — birim modelleri ve askeri PBR boya malzemeleri
   Prosedürel geometri (gerçekçi askeri siluet) + CC0 PBR doku detayı
   + mevcut olduğunda glTF parçalar (tekerlek, bina, kasa).
   ============================================================ */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { Assets, instanceModel } from '../core/assets.js';
import { GLSL_NOISE, rand, TAU, clamp } from '../core/utils.js';

const COL = CFG.teams;

/* ---------------------------------------------------------------
   Askeri boya: clearcoat + prosedürel kir/toz/güneş solması
   --------------------------------------------------------------- */
export function makePaintMaterial(hex, opts = {}) {
  const metalTex = Assets.textures.metal;
  const mat = new THREE.MeshPhysicalMaterial({
    color: hex,
    roughness: opts.roughness === undefined ? 0.56 : opts.roughness,
    metalness: opts.metalness === undefined ? 0.24 : opts.metalness,
    clearcoat: opts.clearcoat === undefined ? 0.34 : opts.clearcoat,
    clearcoatRoughness: 0.62,
    envMapIntensity: opts.env === undefined ? 0.85 : opts.env,
    roughnessMap: opts.noDetail ? null : (metalTex ? metalTex.roughnessMap : null),
    normalMap: opts.noDetail ? null : (metalTex ? metalTex.normalMap : null)
  });
  if (mat.normalMap) mat.normalScale = new THREE.Vector2(0.35, 0.35);
  if (opts.wear === false) return mat;

  const dirt = new THREE.Color(opts.dirt === undefined ? 0x6a5c44 : opts.dirt);
  const amt = opts.wearAmt === undefined ? 1 : opts.wearAmt;

  mat.onBeforeCompile = (shader) => {
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

/* ---------------------------------------------------------------
   Ortak malzemeler
   --------------------------------------------------------------- */
export const MAT = {
  track: makePaintMaterial(0x22252b, { roughness: 0.70, metalness: 0.64, clearcoat: 0.08, env: 1.05, dirt: 0x2b2721 }),
  metalDark: makePaintMaterial(0x161a1f, { roughness: 0.50, metalness: 0.82, clearcoat: 0.16, env: 1.15, dirt: 0x211e1a }),
  tyre: makePaintMaterial(0x0e1013, { roughness: 0.94, metalness: 0.08, clearcoat: 0.0, env: 0.35, wear: false }),
  white: makePaintMaterial(0xe6ebf4, { roughness: 0.45, metalness: 0.30, clearcoat: 0.38, env: 0.95, dirt: 0x8a8577, wearAmt: 0.7 }),
  khaki: makePaintMaterial(0x6b6748, { roughness: 0.72, metalness: 0.10, clearcoat: 0.12, dirt: 0x4a4633 }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x7fd0ff, roughness: 0.07, metalness: 0.20, clearcoat: 1.0,
    clearcoatRoughness: 0.05, emissive: 0x0e2a3d, emissiveIntensity: 1.15, envMapIntensity: 1.5
  }),
  blue: makePaintMaterial(COL.blue.main, { dirt: 0x6b6250 }),
  blueDark: makePaintMaterial(COL.blue.dark, { roughness: 0.64, metalness: 0.28, dirt: 0x5c5443 }),
  red: makePaintMaterial(COL.red.main, { dirt: 0x6b5a4a }),
  redDark: makePaintMaterial(COL.red.dark, { roughness: 0.64, metalness: 0.28, dirt: 0x5c4a3e })
};

/* ---------------------------------------------------------------
   Geometri kütüphanesi
   --------------------------------------------------------------- */
export const G = {
  hull: new THREE.BoxGeometry(2.25, 0.78, 3.5),
  hullTop: new THREE.BoxGeometry(1.85, 0.34, 2.3),
  track: new THREE.BoxGeometry(0.62, 0.62, 3.7),
  wheel: new THREE.CylinderGeometry(0.36, 0.36, 0.5, 10).rotateZ(Math.PI / 2),
  turret: new THREE.BoxGeometry(1.6, 0.62, 1.9),
  barrel: new THREE.CylinderGeometry(0.14, 0.16, 2.5, 8).rotateX(Math.PI / 2),
  cupola: new THREE.CylinderGeometry(0.34, 0.36, 0.26, 8),
  // topçu
  artBase: new THREE.BoxGeometry(2.6, 0.7, 4.2),
  artTurret: new THREE.BoxGeometry(1.5, 0.55, 1.7),
  artBarrel: new THREE.CylinderGeometry(0.18, 0.22, 4.4, 8).rotateX(Math.PI / 2),
  artSupport: new THREE.BoxGeometry(0.22, 0.22, 2.2),
  // karargah
  hqBase: new THREE.BoxGeometry(9, 2.6, 9),
  hqWall: new THREE.BoxGeometry(9.6, 0.5, 9.6),
  hqTurret: new THREE.BoxGeometry(3.4, 1.2, 3.6),
  hqBarrel: new THREE.CylinderGeometry(0.22, 0.26, 3.6, 8).rotateX(Math.PI / 2),
  mast: new THREE.CylinderGeometry(0.1, 0.12, 5, 6),
  flag: new THREE.BoxGeometry(1.8, 1.0, 0.08),
  sandbag: new THREE.BoxGeometry(1.6, 0.5, 0.9),
  // uçak
  fuselage: new THREE.CapsuleGeometry(0.52, 3.6, 4, 10).rotateX(Math.PI / 2),
  wing: new THREE.BoxGeometry(10.5, 0.2, 1.7),
  tailFin: new THREE.BoxGeometry(0.2, 1.0, 1.3),
  tailPlane: new THREE.BoxGeometry(3.6, 0.16, 0.9),
  engine: new THREE.CylinderGeometry(0.34, 0.4, 1.5, 10).rotateX(Math.PI / 2),
  prop: new THREE.BoxGeometry(0.09, 1.5, 0.16),
  cockpit: new THREE.SphereGeometry(0.5, 10, 8),
  // piyade
  body: new THREE.CapsuleGeometry(0.26, 0.5, 4, 7),
  head: new THREE.SphereGeometry(0.2, 8, 6),
  legs: new THREE.BoxGeometry(0.34, 0.6, 0.26),
  rifle: new THREE.BoxGeometry(0.08, 0.08, 0.9),
  // helikopter
  heliBody: new THREE.CapsuleGeometry(0.7, 2.4, 6, 12).rotateX(Math.PI / 2),
  heliTail: new THREE.BoxGeometry(0.28, 0.28, 3.2),
  heliRotor: new THREE.BoxGeometry(7.4, 0.07, 0.32),
  heliTailRotor: new THREE.BoxGeometry(1.6, 0.06, 0.16),
  heliRack: new THREE.BoxGeometry(0.5, 0.3, 2.0),
  skid: new THREE.BoxGeometry(0.16, 0.16, 2.6)
};

/* ---------------------------------------------------------------
   Seçim halkası + can barı
   --------------------------------------------------------------- */
export const selRingGeo = new THREE.RingGeometry(2.1, 2.6, 28).rotateX(-Math.PI / 2);

export function makeHealthBar(scene) {
  const grp = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.36),
    new THREE.MeshBasicMaterial({ color: 0x0a0e14, transparent: true, opacity: 0.8, depthTest: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.36),
    new THREE.MeshBasicMaterial({ color: 0x55e08a, depthTest: false }));
  fill.position.z = 0.01;
  bg.renderOrder = 20; fill.renderOrder = 21;
  grp.add(bg); grp.add(fill);
  grp.visible = false;
  scene.add(grp);
  return { group: grp, fill, bg };
}

/* ---------------------------------------------------------------
   Tekerlek seti (glTF varsa onu, yoksa prosedürel)
   --------------------------------------------------------------- */
function addWheels(parent, positions, radius, mat) {
  for (const [px, py, pz] of positions) {
    const w = new THREE.Mesh(G.wheel, mat);
    w.position.set(px, py, pz);
    w.scale.setScalar(radius / 0.36);
    w.castShadow = true;
    parent.add(w);
  }
}

/* ---------------------------------------------------------------
   Birim mesh üreticisi
   --------------------------------------------------------------- */
export function buildUnitMesh(kind, team, scene) {
  const isBlue = team === 'blue';
  const mainMat = isBlue ? MAT.blue : MAT.red;
  const darkMat = isBlue ? MAT.blueDark : MAT.redDark;
  const group = new THREE.Group();
  const out = { group, turretGroup: null, muzzle: null, props: [], flag: null, selRing: null };

  if (kind === 'tank') {
    const tl = new THREE.Mesh(G.track, MAT.track); tl.position.set(1.28, 0.42, 0); tl.castShadow = true;
    const tr = new THREE.Mesh(G.track, MAT.track); tr.position.set(-1.28, 0.42, 0); tr.castShadow = true;
    group.add(tl, tr);
    addWheels(group, [
      [1.32, 0.4, -1.2], [1.32, 0.4, 0], [1.32, 0.4, 1.2],
      [-1.32, 0.4, -1.2], [-1.32, 0.4, 0], [-1.32, 0.4, 1.2]
    ], 0.36, MAT.tyre);
    const hull = new THREE.Mesh(G.hull, mainMat); hull.position.y = 0.9; hull.castShadow = true; hull.receiveShadow = true;
    const top = new THREE.Mesh(G.hullTop, darkMat); top.position.set(0, 1.34, -0.1); top.castShadow = true;
    group.add(hull, top);

    const tg = new THREE.Group();
    tg.position.y = 1.6;
    const tur = new THREE.Mesh(G.turret, mainMat); tur.castShadow = true;
    const cup = new THREE.Mesh(G.cupola, darkMat); cup.position.set(-0.4, 0.42, -0.3);
    const bar = new THREE.Mesh(G.barrel, MAT.metalDark); bar.position.set(0, 0.06, 1.9); bar.castShadow = true;
    tg.add(tur, cup, bar);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.06, 3.15);
    tg.add(muzzle);
    group.add(tg);
    out.turretGroup = tg; out.muzzle = muzzle; out.hpBarHeight = 3.1;
    out.radius = 2.3;

  } else if (kind === 'artillery') {
    const base = new THREE.Mesh(G.artBase, darkMat); base.position.y = 0.55; base.castShadow = true;
    group.add(base);
    addWheels(group, [
      [1.55, 0.42, -1.4], [1.55, 0.42, 1.2], [-1.55, 0.42, -1.4], [-1.55, 0.42, 1.2]
    ], 0.42, MAT.tyre);
    const tg = new THREE.Group();
    tg.position.y = 1.05;
    const tur = new THREE.Mesh(G.artTurret, mainMat); tur.castShadow = true;
    const bar = new THREE.Mesh(G.artBarrel, MAT.metalDark); bar.position.set(0, 0.2, 2.4); bar.rotation.x = -0.22; bar.castShadow = true;
    const sup = new THREE.Mesh(G.artSupport, MAT.metalDark); sup.position.set(0, 0.2, -1.4); sup.rotation.x = 0.5;
    tg.add(tur, bar, sup);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.32, 4.6);
    tg.add(muzzle);
    group.add(tg);
    out.turretGroup = tg; out.muzzle = muzzle; out.hpBarHeight = 3.4;
    out.radius = 2.7;

  } else if (kind === 'infantry') {
    const body = new THREE.Mesh(G.body, mainMat); body.position.y = 0.95; body.castShadow = true;
    const legs = new THREE.Mesh(G.legs, darkMat); legs.position.y = 0.42; legs.castShadow = true;
    const head = new THREE.Mesh(G.head, MAT.khaki); head.position.y = 1.5; head.castShadow = true;
    const rifle = new THREE.Mesh(G.rifle, MAT.metalDark); rifle.position.set(0.22, 1.0, 0.35);
    group.add(body, legs, head, rifle);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0.22, 1.0, 1.2);
    group.add(muzzle);
    out.turretGroup = null; out.muzzle = muzzle; out.hpBarHeight = 2.4;
    out.radius = 1.15;

  } else if (kind === 'helicopter') {
    const body = new THREE.Mesh(G.heliBody, mainMat); body.castShadow = true;
    const cockpit = new THREE.Mesh(G.cockpit, MAT.glass); cockpit.position.set(0, 0.15, 1.5); cockpit.scale.set(0.85, 0.7, 1.1);
    const tail = new THREE.Mesh(G.heliTail, darkMat); tail.position.set(0, 0.35, -2.5);
    const tailFin = new THREE.Mesh(G.tailFin, darkMat); tailFin.position.set(0, 0.8, -3.6); tailFin.scale.set(1.4, 0.9, 1.0);
    const tailRotor = new THREE.Mesh(G.heliTailRotor, MAT.metalDark); tailRotor.position.set(0.25, 0.8, -3.9);
    const rackL = new THREE.Mesh(G.heliRack, MAT.metalDark); rackL.position.set(1.0, -0.35, 0.2);
    const rackR = new THREE.Mesh(G.heliRack, MAT.metalDark); rackR.position.set(-1.0, -0.35, 0.2);
    const skidL = new THREE.Mesh(G.skid, MAT.metalDark); skidL.position.set(0.7, -0.75, 0);
    const skidR = new THREE.Mesh(G.skid, MAT.metalDark); skidR.position.set(-0.7, -0.75, 0);
    group.add(body, cockpit, tail, tailFin, tailRotor, rackL, rackR, skidL, skidR);
    const rotor = new THREE.Mesh(G.heliRotor, MAT.metalDark);
    rotor.position.y = 0.85;
    const rotor2 = new THREE.Mesh(G.heliRotor, MAT.metalDark);
    rotor2.position.y = 0.85; rotor2.rotation.y = Math.PI / 2;
    group.add(rotor, rotor2);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.3, 1.6);
    group.add(muzzle);
    out.turretGroup = null; out.muzzle = muzzle; out.props = [rotor, rotor2, tailRotor];
    out.hpBarHeight = 4.4; out.radius = 3.1;

  } else if (kind === 'hq') {
    const bMat = darkMat, acMat = mainMat;
    const base = new THREE.Mesh(G.hqBase, bMat); base.position.y = 1.3; base.castShadow = true; base.receiveShadow = true;
    const wall = new THREE.Mesh(G.hqWall, bMat); wall.position.y = 2.8; wall.castShadow = true;
    const wall2 = new THREE.Mesh(G.hqWall, acMat); wall2.position.y = 3.3; wall2.scale.set(0.85, 0.7, 0.85); wall2.castShadow = true;
    group.add(base, wall, wall2);

    // Sandık/kum torbası tahkimatı
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const sb = new THREE.Mesh(G.sandbag, MAT.khaki);
      sb.position.set(Math.cos(a) * 6.4, 0.35, Math.sin(a) * 6.4);
      sb.rotation.y = a;
      sb.castShadow = true;
      group.add(sb);
    }

    const mast = new THREE.Mesh(G.mast, MAT.metalDark); mast.position.set(-3.4, 5.8, -3.4); mast.castShadow = true;
    const flag = new THREE.Mesh(G.flag, acMat); flag.position.set(-2.5, 7.6, -3.4); flag.castShadow = true;
    group.add(mast, flag);
    out.flag = flag;

    // glTF bina parçaları (varsa) — kargargha çevresi
    if (Assets.hasModels && Assets.groups.buildings.length) {
      for (let i = 0; i < 3; i++) {
        const key = Assets.groups.buildings[(i * 5) % Assets.groups.buildings.length];
        const o = instanceModel(key, { height: rand(6, 10), x: Math.cos(i * 2.1) * 9, y: 0, z: Math.sin(i * 2.1) * 9, yaw: rand(0, TAU) });
        if (o) group.add(o);
      }
    }

    const tg = new THREE.Group();
    tg.position.y = 3.7;
    const ht = new THREE.Mesh(G.hqTurret, acMat); ht.castShadow = true;
    const hb = new THREE.Mesh(G.hqBarrel, MAT.metalDark); hb.position.set(0, 0.1, 2.7); hb.castShadow = true;
    tg.add(ht, hb);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.1, 4.5);
    tg.add(muzzle);
    group.add(tg);
    out.turretGroup = tg; out.muzzle = muzzle; out.hpBarHeight = 6.4;
    out.radius = 5.9;

  } else { // bomber
    const fus = new THREE.Mesh(G.fuselage, MAT.white); fus.castShadow = true;
    const wing = new THREE.Mesh(G.wing, MAT.white); wing.position.set(0, -0.1, 0.1); wing.castShadow = true;
    const fin = new THREE.Mesh(G.tailFin, MAT.white); fin.position.set(0, 0.7, -2.0); fin.castShadow = true;
    const tplane = new THREE.Mesh(G.tailPlane, MAT.white); tplane.position.set(0, 0.15, -2.1); tplane.castShadow = true;
    const cock = new THREE.Mesh(G.cockpit, MAT.glass); cock.position.set(0, 0.35, 1.7); cock.scale.set(0.9, 0.7, 1.2);
    group.add(fus, wing, fin, tplane, cock);
    for (let e = -1; e <= 1; e += 2) {
      const eng = new THREE.Mesh(G.engine, MAT.metalDark); eng.position.set(e * 2.5, -0.28, 0.5); eng.castShadow = true;
      group.add(eng);
      const pr = new THREE.Mesh(G.prop, MAT.metalDark); pr.position.set(e * 2.5, -0.28, 1.35);
      group.add(pr);
      out.props.push(pr);
    }
    out.hpBarHeight = 2.2;
    out.radius = 4.6;
  }

  // Seçim halkası
  const selRing = new THREE.Mesh(selRingGeo,
    new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.9, depthWrite: false }));
  selRing.visible = false;
  selRing.renderOrder = 2;
  group.add(selRing);
  out.selRing = selRing;

  scene.add(group);
  out.hpBar = makeHealthBar(scene);
  return out;
}

/* Selam: hava birimleri için kaçış noktası yüksekliği */
export function unitAltitude(kind) {
  const d = CFG.units[kind];
  return d && d.altitude ? d.altitude : 0;
}
