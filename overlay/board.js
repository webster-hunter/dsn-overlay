import { makeFlapRow, setFlapRow } from './flap.js';

export const MODES = [
  { key: 'form',     label: 'FORM',     tint: () => ({ kind: 'form' }) },
  { key: 'season',   label: 'SEASON',   tint: () => null },
  { key: 'abandons', label: 'ABANDONS', tint: () => null },
  { key: 'rank',     label: 'RANK',     tint: p => ({ kind: 'tier', color: p.rankColor }) }
];

const CELLS = 11;
const HEAD = 8;

let headRow = null;
const rows = [];        // { player, flapRow }

export function mountBoard(boardEl, headEl) {
  headRow = makeFlapRow(HEAD);
  headEl.replaceChildren(headRow);
  boardEl.replaceChildren();
  rows.length = 0;
}

function bandEl(team) {
  const band = document.createElement('div');
  band.className = 'band';
  band.style.setProperty('--band', `var(${team.colorVar})`);
  const label = document.createElement('span');
  label.textContent = team.faction;
  band.appendChild(label);
  return band;
}

function rowEl(player) {
  const row = document.createElement('div');
  row.className = 'prow' + (player.isSelf ? ' me' : '');

  // A hero icon, not a Steam name: it is how you actually identify someone in
  // the match, it never truncates, and dropping the name column let the flap
  // cells grow from 15px to 23px. Heroes without a vendored icon fall through
  // to the plate styled in overlay.css rather than leaving a hole.
  const hero = document.createElement('div');
  hero.className = 'hero';
  if (player.heroId != null) {
    hero.style.backgroundImage = `url(${JSON.stringify(`heroes/${player.heroId}.webp`)})`;
  }

  const flapRow = makeFlapRow(CELLS);
  row.append(hero, flapRow);
  rows.push({ player, flapRow });
  return row;
}

/** Build the structure once per match, then only flap values. */
export function renderBoard(state, boardEl) {
  boardEl.replaceChildren();
  rows.length = 0;
  for (const team of state.teams) {
    boardEl.appendChild(bandEl(team));
    for (const p of team.players) boardEl.appendChild(rowEl(p));
  }
}

export function showMode(modeIndex) {
  const mode = MODES[modeIndex % MODES.length];
  setFlapRow(headRow, mode.label, null, 0);
  rows.forEach(({ player, flapRow }, i) => {
    setFlapRow(flapRow, player[mode.key], mode.tint(player), 130 + i * 46);
  });
}
