/**
 * Stat candidates. Each declares how to compute itself, the minimum sample
 * below which it must never air, and a salience score — roughly, how far it
 * deviates from its own baseline.
 *
 * Tier membership means ELIGIBLE TO AIR, not always on screen. That is what
 * makes ~35 stats tractable. See spec section 7.1.
 */

const self = state =>
  (state?.teams ?? []).flatMap(t => t?.players ?? []).find(p => p?.isSelf) ?? null;

const int = v => {
  const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/** Season win rate as a fraction, from a '147-117' string. */
function winRate(seasonText) {
  const [w, l] = String(seasonText ?? '').split('-').map(int);
  const total = w + l;
  return total ? w / total : null;
}

export const STATS = [
  {
    key: 'seasonWinRate', label: 'Season win rate', minSample: 20,
    compute(state) {
      const me = self(state);
      if (!me) return null;
      const rate = winRate(me.season);
      if (rate === null) return null;
      return { value: `${Math.round(rate * 100)}%`, sample: int(me.matches), baseline: 0.5 };
    },
    // distance from a coin flip, normalised so 50% -> 0 and 100% -> 1
    salience: c => Math.min(1, Math.abs(parseInt(c.value, 10) / 100 - c.baseline) * 2)
  },
  {
    key: 'streak', label: 'Win streak', minSample: 3,
    compute(state) {
      const me = self(state);
      if (!me?.streak) return null;
      const n = int(me.streak);
      return { value: me.streak, sample: n, baseline: 2 };
    },
    // a 3-streak is unremarkable; by 8 it is the story
    salience: c => Math.min(1, Math.max(0, (c.sample - c.baseline) / 6))
  },
  {
    key: 'abandons', label: 'Abandons', minSample: 1,
    compute(state) {
      const me = self(state);
      if (!me) return null;
      const n = int(me.abandons);
      if (n === 0) return null;           // zero is not news
      return { value: String(n), sample: n, baseline: 0 };
    },
    salience: c => Math.min(1, c.sample / 10)
  },
  {
    key: 'kd', label: 'K/D', minSample: 20,
    compute(state) {
      const me = self(state);
      if (!me) return null;
      const kd = parseFloat(me.kd);
      if (!Number.isFinite(kd)) return null;
      return { value: me.kd, sample: int(me.matches), baseline: 1.0 };
    },
    salience: c => Math.min(1, Math.abs(parseFloat(c.value) - c.baseline) / 2)
  }
];

/** Eligible candidates, most salient first. Never throws. */
export function rankStats(state) {
  const out = [];
  for (const stat of STATS) {
    let c = null;
    try { c = stat.compute(state); } catch { c = null; }
    if (!c) continue;
    if (c.sample < stat.minSample) continue;     // the floor
    let s = 0;
    try { s = stat.salience(c); } catch { s = 0; }
    if (!Number.isFinite(s)) s = 0;
    out.push({ key: stat.key, label: stat.label, value: c.value, sample: c.sample, salience: s });
  }
  return out.sort((a, b) => b.salience - a.salience);
}
