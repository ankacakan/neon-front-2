/* ============================================================
   NEON FRONT 2.0 — kampanya görev verisi (5 görev) ve ilerleme kuralları
   ============================================================ */

export const MISSIONS = [
  {
    id: 'm1_bridge',
    order: 1,
    name: 'NEHİR HATTI',
    subtitle: 'Köprüyü tut',
    briefing: 'Kızıl birlikler nehrin batısından baskı yapıyor. Köprüyü ele geçir ve ilk dalgaları püskürt.',
    objectives: [
      { type: 'capture', count: 1, point: 'KÖPRÜ KONTROLÜ', label: 'Köprü kontrol noktasını ele geçir' },
      { type: 'kills', count: 6, label: '6 düşman aracını imha et' }
    ],
    waves: { firstDelay: 14, interval: 30, enemies: 3, ramp: 0.5, max: 6, airstrikeEvery: 0 },
    unlockReward: 'm2_crossing',
    reward: { supply: 300, fuel: 150, ammo: 200 },
    failOnHQLoss: true
  },
  {
    id: 'm2_crossing',
    order: 2,
    name: 'KARŞI YAKA',
    subtitle: 'Köprüden geç',
    briefing: 'Köprü bizde. Şimdi karşı yakaya geçip doğu sırtını güvence altına al.',
    objectives: [
      { type: 'reach', zone: { x: 90, z: -30, r: 16 }, need: 3, label: '3 aracı doğu yakasına geçir' },
      { type: 'destroy', team: 'red', kind: 'tank', count: 8, label: '8 düşman tankını imha et' }
    ],
    waves: { firstDelay: 10, interval: 26, enemies: 4, ramp: 0.7, max: 8, airstrikeEvery: 3 },
    unlockReward: 'm3_air',
    reward: { supply: 400, fuel: 220, ammo: 260 },
    failOnHQLoss: true
  },
  {
    id: 'm3_air',
    order: 3,
    name: 'HAVA ÜSTÜNLÜĞÜ',
    subtitle: 'Bombardımanı kır',
    briefing: 'Düşman bombardıman uçakları cepheyi dövüyor. Hava savunmasını kur ve karargahı koru.',
    objectives: [
      { type: 'survive', seconds: 90, label: '90 saniye karargahı koru' },
      { type: 'kills', count: 14, label: '14 düşmanı imha et' }
    ],
    waves: { firstDelay: 8, interval: 24, enemies: 5, ramp: 0.8, max: 9, airstrikeEvery: 2 },
    unlockReward: 'm4_desert',
    reward: { supply: 500, fuel: 320, ammo: 340 },
    failOnHQLoss: true
  },
  {
    id: 'm4_desert',
    order: 4,
    name: 'ÇÖL TAARRUZU',
    subtitle: 'Batı karakolunu al',
    briefing: 'Çöl kanadındaki düşman karakolunu ele geçir. Kaya bloklarına dikkat — topçu desteği kullan.',
    objectives: [
      { type: 'capture', count: 2, label: '2 noktayı ele geçir' },
      { type: 'destroy', team: 'red', kind: 'hq', count: 1, label: 'Düşman ileri üssünü yık' }
    ],
    waves: { firstDelay: 12, interval: 22, enemies: 5, ramp: 0.9, max: 10, airstrikeEvery: 3 },
    unlockReward: 'm5_final',
    reward: { supply: 600, fuel: 400, ammo: 420 },
    failOnHQLoss: true
  },
  {
    id: 'm5_final',
    order: 5,
    name: 'CEPHANE HATTI',
    subtitle: 'Düşman üssünü yık',
    briefing: 'Son taarruz. Düşman ana karargahını yık ve nehir hattını kalıcı olarak güvence altına al.',
    objectives: [
      { type: 'destroy', team: 'red', kind: 'hq', count: 1, label: 'Düşman karargahını yık' },
      { type: 'capture', count: 2, label: 'En az 2 noktayı elde tut' }
    ],
    waves: { firstDelay: 10, interval: 20, enemies: 6, ramp: 1.0, max: 12, airstrikeEvery: 2 },
    reward: null,
    final: true,
    failOnHQLoss: true
  }
];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}
