// The tier table is GENERATED from /v1/assets/ranks by scripts/tokens.mjs.
// Do not inline the values here: an earlier draft did, and 11 of the 12 colours
// were wrong. Archon / Alchemist / Arcanist are former tier names and must not
// reappear — see spec section 3.4.
import { TIERS } from './rank-tiers.js';
export { TIERS };

const FALLBACK_LABEL = 'UNRANKED';

function tier(rank) {
  return Number.isInteger(rank) && rank >= 0 && rank < TIERS.length ? TIERS[rank] : null;
}

/** 'ASCENDANT 6'. Always <= 11 characters, never leaks undefined/NaN. */
export function rankLabel(rank, subrank) {
  const t = tier(rank);
  if (!t) return FALLBACK_LABEL;
  const s = Number.isInteger(subrank) && subrank >= 1 && subrank <= 6 ? ` ${subrank}` : '';
  return (t.name + s).toUpperCase();
}
