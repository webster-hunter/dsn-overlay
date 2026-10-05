import { mountLogo } from './logo.js';
import { mountBoard, renderBoard, showMode } from './board.js';
import { mountChiron, renderTurn } from './chiron.js';

const el = id => document.getElementById(id);
const state = await fetch('/fixture').then(r => r.json());

await mountLogo(el('logo-bay'));
mountBoard(el('board'), el('stat-name'));
renderBoard(state, el('board'));
mountChiron({ spine: el('spine'), groups: el('groups'), persistent: el('persistent') });

let mode = 0, turn = 0;
showMode(mode);
renderTurn(state, turn);
setInterval(() => showMode(++mode), 9000);
setInterval(() => renderTurn(state, ++turn), 9000);
