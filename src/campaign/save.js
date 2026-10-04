/* ============================================================
   NEON FRONT 2.0 — localStorage ilerleme kaydı
   ============================================================ */
import { CFG } from '../config.js';

const DEFAULT = {
  version: 1,
  unlocked: ['m1_bridge'],
  completed: [],
  best: {},                 // missionId -> { time, kills, lost }
  totals: { kills: 0, lost: 0, missions: 0, bestRank: 'ER' }
};

export const Save = {
  data: JSON.parse(JSON.stringify(DEFAULT)),

  load() {
    try {
      const raw = localStorage.getItem(CFG.saveKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), parsed);
        this.data.totals = Object.assign({}, DEFAULT.totals, parsed.totals || {});
        if (!Array.isArray(this.data.unlocked) || !this.data.unlocked.length) this.data.unlocked = ['m1_bridge'];
      }
    } catch (e) {
      console.warn('Kayıt okunamadı, sıfırlanıyor:', e);
      this.data = JSON.parse(JSON.stringify(DEFAULT));
    }
    return this.data;
  },

  save() {
    try {
      localStorage.setItem(CFG.saveKey, JSON.stringify(this.data));
    } catch (e) { console.warn('Kayıt yazılamadı:', e); }
  },

  reset() {
    this.data = JSON.parse(JSON.stringify(DEFAULT));
    this.save();
  },

  isUnlocked(id) { return this.data.unlocked.indexOf(id) >= 0; },
  isCompleted(id) { return this.data.completed.indexOf(id) >= 0; },

  unlock(id) {
    if (!id) return;
    if (this.data.unlocked.indexOf(id) === -1) {
      this.data.unlocked.push(id);
      this.save();
    }
  },

  record(mission, stats, victory) {
    this.data.totals.kills += stats.kills;
    this.data.totals.lost += stats.lost;
    if (victory) {
      if (this.data.completed.indexOf(mission.id) === -1) this.data.completed.push(mission.id);
      if (mission.unlockReward) this.unlock(mission.unlockReward);
      const prev = this.data.best[mission.id];
      if (!prev || stats.time < prev.time) {
        this.data.best[mission.id] = { time: stats.time, kills: stats.kills, lost: stats.lost };
      }
      this.data.totals.missions++;
    }
    this.save();
  }
};
