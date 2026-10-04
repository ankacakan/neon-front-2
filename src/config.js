/* ============================================================
   NEON FRONT 2.0 — tüm ayarlanabilir sabitler
   ============================================================ */
import { TAU } from './core/utils.js';

const PITCH = Math.atan(1 / Math.SQRT2);   // 35.264° → gerçek izometrik

export const CFG = {
  version: '2.0.0',
  saveKey: 'neonfront2_save_v1',

  /* ---------- Dünya ---------- */
  world: {
    size: 320, half: 160,
    cell: 3.2,                 // A* grid hücre boyutu
    riverHalf: 13,             // kazılmış nehir yatağı yarı genişliği
    waterHalf: 10.5,           // su yüzeyi yarı genişliği
    bridgeZ: 0,
    bridgeHalfLen: 22,
    bridgeHalfWidth: 9,
    deckY: 0.9,
    capturePointCount: 3
  },

  /* ---------- Kamera ---------- */
  camera: {
    pitch: PITCH,
    dist: 330,
    viewSize: 150,
    minView: 48,
    maxView: 290,
    yawStart: Math.PI * 0.25,
    distMin: 1,
    distMax: 1300
  },

  /* ---------- Atmosfer ---------- */
  fog: { color: 0x8fb2cf, near: 190, far: 480 },
  sky: {
    top: 0x1e4f86, mid: 0x6ea6d6, bot: 0xd8c9a8,
    sunDir: [0.5, 0.62, 0.38]
  },
  sun: { color: 0xfff2dc, intensity: 2.4, pos: [80, 130, 60] },
  hemi: { sky: 0xa8caea, ground: 0x6b5a3e, intensity: 0.85 },
  ambient: { color: 0x445266, intensity: 0.5 },
  environmentIntensity: 0.62,

  /* ---------- Post-processing ---------- */
  postfx: {
    enabled: true,
    ssao: { enabled: true, radius: 5.2, minDistance: 0.002, maxDistance: 0.16, scale: 0.5, intensity: 1.15 },
    bloom: { enabled: true, strength: 0.48, radius: 0.55, threshold: 0.82 },
    dof: { enabled: true, focusNear: 0.002, focusFar: 0.0075, blurNear: 0.0016, blurFar: 0.010, vignette: 0.28 },
    grade: { enabled: true, saturation: 1.10, contrast: 1.06, lift: [0.004, 0.006, 0.010], gain: [1.03, 1.0, 0.965], grain: 0.035, chromatic: 0.0009 },
    smaa: { enabled: true }
  },

  /* ---------- Bütçeler ---------- */
  budget: {
    fireParticles: 2200,
    smokeParticles: 1500,
    debrisParticles: 520,
    fireBillboards: 34,
    smokeBillboards: 64,
    bullets: 320,
    bombs: 72,
    rings: 32,
    scorches: 44,
    flashLights: 6,
    groundFires: 22
  },

  /* ---------- Ekonomi ---------- */
  economy: {
    start: { supply: 900, fuel: 450, ammo: 700 },
    income: { supply: 12, fuel: 6, ammo: 9 },        // saniye başına (üs canlıyken)
    hqBonus: { supply: 8, fuel: 4, ammo: 5 },
    captureBonus: { supply: 6, fuel: 3, ammo: 4 },   // saniye başına / ele geçirilen nokta
    max: { supply: 9999, fuel: 9999, ammo: 9999 }
  },

  /* ---------- Birim verileri ---------- */
  units: {
    tank: {
      label: 'TANK', radius: 2.3, hp: 135,
      speed: [10.5, 12.5], turnSpeed: 3.4,
      range: 33, detect: 44, damage: 24, fireInterval: 1.35, turretSpeed: 2.8,
      projectile: 'shell', rail: 'ground',
      cost: { supply: 140, fuel: 70, ammo: 50 }, buildTime: 7,
      hpBarHeight: 3.1, accent: 0x7fe3ff
    },
    artillery: {
      label: 'TOPCU', radius: 2.7, hp: 95,
      speed: [6.5, 8.0], turnSpeed: 2.0,
      range: 82, minRange: 26, detect: 64, damage: 62, fireInterval: 4.6, turretSpeed: 1.1,
      projectile: 'arc', rail: 'ground', splash: 12,
      cost: { supply: 220, fuel: 120, ammo: 160 }, buildTime: 12,
      hpBarHeight: 3.4, accent: 0xffb257
    },
    infantry: {
      label: 'PİYADE', radius: 1.15, hp: 58,
      speed: [14, 16.5], turnSpeed: 5.2,
      range: 25, detect: 42, damage: 7, fireInterval: 0.34, turretSpeed: 6.0,
      projectile: 'bullet', rail: 'ground', squad: 4,
      cost: { supply: 70, fuel: 10, ammo: 30 }, buildTime: 4,
      hpBarHeight: 2.4, accent: 0x9ff0a0
    },
    helicopter: {
      label: 'HELİKOPTER', radius: 3.1, hp: 105,
      speed: [26, 31], turnSpeed: 2.6,
      range: 30, detect: 58, damage: 15, fireInterval: 0.42, turretSpeed: 7.0,
      projectile: 'bullet', rail: 'air', altitude: 15,
      cost: { supply: 260, fuel: 170, ammo: 90 }, buildTime: 10,
      hpBarHeight: 4.4, accent: 0xc9a4ff
    },
    hq: {
      label: 'KARARGAH', radius: 5.9, hp: 2600,
      speed: [0, 0], turnSpeed: 0,
      range: 46, detect: 52, damage: 36, fireInterval: 1.15, turretSpeed: 1.5,
      projectile: 'shell', rail: 'ground',
      cost: null, buildTime: 0,
      hpBarHeight: 6.4, accent: 0xffffff
    },
    bomber: {
      label: 'BOMBARDIMAN', radius: 4.6, hp: 70,
      speed: [36, 36], turnSpeed: 0,
      range: 0, detect: 0, damage: 0, fireInterval: 99, turretSpeed: 0,
      projectile: 'bomb', rail: 'air', altitude: 26,
      cost: null, buildTime: 0,
      hpBarHeight: 2.2, accent: 0xffffff
    }
  },

  /* ---------- Takım renkleri ---------- */
  teams: {
    blue: { main: 0x2f7fd6, dark: 0x1b4f8c, accent: 0x7fe3ff, ui: '#4aa8ff', name: 'MAVİ BİRLİK' },
    red: { main: 0xd93a48, dark: 0x8c1f2a, accent: 0xff9a9a, ui: '#ff5468', name: 'KIZIL BİRLİK' }
  },

  /* ---------- Yapay zekâ ---------- */
  ai: {
    redPursue: true,
    blueAutoDefend: true,
    separation: 0.92,
    repathLocal: 1.2,
    repathStrategic: 2.6,
    pathExpansionCap: 9000
  },

  /* ---------- Dalga / senaryo ---------- */
  waves: {
    firstDelay: 15,
    interval: 25,
    minInterval: 15,
    rampPerWave: 0.6,
    maxEnemies: 8,
    airstrikeEvery: 3,
    enemyBomberFirst: 42
  },

  /* ---------- Yetenekler ---------- */
  abilities: {
    reinforce: { cd: 15, label: 'TAKVİYE' },
    airstrike: { cd: 26, label: 'HAVA SALDIRISI' }
  },

  /* ---------- Varlık yolları ---------- */
  assets: {
    textures: 'assets/textures/',
    models: 'assets/models/',
    modelPacks: {
      nature: 'nature-kit/',
      tower: 'tower-defense-kit/',
      city: 'city-kit-industrial/',
      car: 'car-kit/'
    }
  }
};

/* İzometrik yön sabitleri (ışık/gökyüzü uyumu için) */
export const SUN_DIR = [0.5, 0.62, 0.38];
export { PITCH };
export const TAU_ = TAU;
