import { makeFlapRow, setFlapRow } from './flap.js';
import { fitSize, canvasMeasurer } from './fit.js';

export const MODES = [
  { key: 'form',     label: 'FORM',     tint: () => ({ kind: 'form' }) },
  { key: 'season',   label: 'SEASON',   tint: () => null },
  { key: 'abandons', label: 'ABANDONS', tint: () => null },
  { key: 'rank',     label: 'RANK',     tint: p => ({ kind: 'tier', color: p.rankColor }) }
];

const CELLS = 11;
const HEAD = 8;
const NAME_COL = 169;   // 403 - 18 padding - 24 avatar - 16 gaps - 176 cells

let measure = null;
let headRow = null;
const rows = [];        // { player, nameEl, flapRow }

export function mountBoard(boardEl, headEl) {
  measure ??= canvasMeasurer();
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

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (player.avatar) avatar.style.backgroundImage = `url(${JSON.stringify(player.avatar)})`;

  const names = document.createElement('div');
  names.className = 'names';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = player.name;
  name.style.fontSize = `${fitSize(player.name, NAME_COL, measure)}px`;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `Hero ${player.heroId ?? '-'}`;
  names.append(name, sub);

  const flapRow = makeFlapRow(CELLS);
  row.append(avatar, names);
  if (player.isSelf) {
    const tag = document.createElement('span');
    tag.className = 'youtag';
    tag.textContent = 'YOU';
    row.appendChild(tag);
  }
  row.appendChild(flapRow);
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
