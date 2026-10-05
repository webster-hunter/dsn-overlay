/**
 * How long ago the newest match the API could tell us about actually started.
 *
 * Recomputed on every render from a timestamp rather than printed once by the
 * proxy, which is what makes it useful twice over: it exposes ingestion lag
 * (finish a game, and if this still reads "3h ago" the match has not landed
 * upstream yet) and it exposes a frozen document, because a board the proxy has
 * stopped updating keeps aging on screen instead of sitting there looking live.
 *
 * Returns '' when there is nothing to date, so the qualifier slot stays empty
 * rather than reading "NaN ago" on a cold start.
 */
export function ageLabel(at, now = Date.now()) {
  if (typeof at !== 'number' || !(at > 0)) return '';
  const mins = Math.floor((now - at) / 60000);
  if (mins < 0) return '';                       // clock skew: say nothing
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Five themed turns, spec section 6.2. Each picks 4 groups from the state. */
export const TURNS = [
  { spine: 'Session', sub: 'Deadlock', groups: s => [
    ['Today',      s.session.todayRecord ?? '-', s.session.winRateToday ?? ''],
    ['K / D',      s.session.kd ?? '-',          ''],
    ['Matches',    s.session.matches ?? '-',     ageLabel(s.session.lastMatchAt)],
    // sessionToday never writes a rank — it derives from match history, which
    // carries per-match movement but not standing. This read a key that does
    // not exist, so the group showed a dash with a live '+6' underneath it,
    // while #persistent displayed the real rank from the same document.
    ['Rank',       self(s)?.rank ?? '-',          s.session.rankProgress ?? '']
  ] },
  { spine: 'Hero', sub: 'Form', groups: s => {
    const me = self(s);
    return [
      ['Hero',     `Hero ${me?.heroId ?? '-'}`, `${me?.matches ?? 0} matches`],
      ['Season',   me?.season ?? '-',           ''],
      ['K / D',    me?.kd ?? '-',               ''],
      ['Streak',   me?.streak ?? '-',           '']
    ];
  } },
  { spine: 'Standing', sub: 'Rank', groups: s => {
    const me = self(s);
    return [
      ['Rank',     me?.rank ?? '-',       ''],
      ['Net worth',me?.netWorth ?? '-',   'average'],
      ['Last hits',me?.lastHits ?? '-',   'average'],
      ['Denies',   me?.denies ?? '-',     'average']
    ];
  } },
  { spine: 'Matchup', sub: 'Lane', groups: s => {
    const them = s.teams[1]?.players ?? [];
    return them.slice(0, 4).map(p => [p.name.slice(0, 14), p.season, p.rank]);
  } },
  { spine: 'Records', sub: 'Watch', groups: s => {
    const me = self(s);
    return [
      ['Streak',   me?.streak ?? '-',     ''],
      ['Abandons', me?.abandons ?? '0',   'all time'],
      ['Matches',  me?.matches ?? '-',    'tracked'],
      ['Form',     (me?.form ?? '').trim() || '-', 'last 11']
    ];
  } }
];

// No fallback to another row: an absent operator must read as a gap (every
// `me?.x ?? '-'` call site already pads to dashes, and fourGroups() pads a
// short/empty turn to four groups), never as another player's stats
// presented as the streamer's own.
// The proxy puts the operator on the document directly, so these turns work
// between matches as well as during one — searching the roster only found them
// while a game was running, which is exactly when the streamer is not looking.
const self = s => s?.operator ?? null;

/**
 * Element builders. These exist so no API-sourced string is ever parsed as
 * HTML. `textContent` assigns text, full stop — a persona name of
 * `<img src=x onerror=alert(1)>` renders as those literal characters.
 */
function div(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = String(text ?? '');
  return d;
}

function punit(label, value) {
  const u = document.createElement('div');
  u.className = 'punit';
  u.append(div('plabel', label), div('pvalue', value));
  return u;
}

let els = null;
let currentRow = null;

export function mountChiron(refs) { els = refs; }

/**
 * Never render a hole: whatever a turn's groups() returns — short, empty, or
 * thrown — this is the one place that normalizes to exactly four rendered
 * groups, padding the shortfall with the same dash empty state the Session
 * turn already uses for unwired fields.
 */
function fourGroups(turn, state) {
  let groups;
  try {
    groups = turn.groups(state);
  } catch (err) {
    console.warn(`[chiron] ${turn.spine} groups() threw`, err);
    groups = [];
  }
  const four = groups.slice(0, 4);
  while (four.length < 4) four.push(['-', '-', '']);
  return four;
}

export function renderTurn(state, turnIndex) {
  if (!els) return;
  const turn = TURNS[turnIndex % TURNS.length];

  els.spine.replaceChildren(
    // The same number means different things in Normal and Street Brawl, so
    // the mode is named rather than left to be inferred. Unlabelled stats that
    // silently change meaning are worse than not showing brawl at all.
    div('spine-sub', state?.mode === 'brawl' ? 'Brawl' : turn.sub),
    div('spine-title', turn.spine)
  );

  const me = self(state);
  // Optional all the way down. This was the one unguarded `state.session` read,
  // and it sits outside the try/catch that protects turn.groups() — so a
  // document without a session block took the whole chiron render with it,
  // spine and groups included, not just this one unit.
  els.persistent.replaceChildren(
    punit('Today', state?.session?.todayRecord ?? '-'),
    punit('Rank', me?.rank ?? '-')
  );

  if (currentRow) {
    const old = currentRow;
    old.classList.add('out');
    // Removed when the roll-out animation actually ends, not after a literal
    // sized to guess at it: 440ms was hardcoded against `roll-out .42s`, so
    // retuning the animation would either clip the exit or leave the old row in
    // the DOM. The timer survives only as a floor, for the case where the event
    // never arrives — the same failure waitAnim in machine.js guards against.
    const drop = () => old.remove();
    old.addEventListener('animationend', drop, { once: true });
    setTimeout(drop, 2000);
  }

  const row = document.createElement('div');
  row.className = 'grouprow';
  fourGroups(turn, state).forEach(([label, value, sub], i) => {
    const g = document.createElement('div');
    g.className = 'group' + (i === 0 ? ' lead' : '');
    g.style.animationDelay = `${25 + i * 38}ms`;   // early, so the rise is seen
    // textContent, not HTML interpolation: `label` carries Steam persona names
    // on the Matchup turn, and those are attacker-controlled by every player
    // in the match. See the security note in this task.
    g.append(div('glabel', label), div('gvalue', value));
    if (sub) g.appendChild(div('gsub', sub));
    row.appendChild(g);
  });
  els.groups.appendChild(row);
  void row.offsetWidth;
  row.classList.add('in');
  currentRow = row;
}
