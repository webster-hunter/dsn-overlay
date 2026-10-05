/**
 * Emote and badge resolution for chat.
 *
 * Three sources, none of which needs authentication — verified by probing each:
 *
 *   Twitch emotes  the `emotes` IRC tag gives ids and character ranges;
 *                  static-cdn.jtvnw.net serves the images publicly (200).
 *   BTTV emotes    api.betterttv.net global + per-channel, matched by word;
 *                  cdn.betterttv.net serves the images publicly (200).
 *   Badges         the `badges` tag names them. The IMAGES are not available:
 *                  badges.twitch.tv no longer resolves and Helix returns 401
 *                  without a registered app. So badges are drawn here as the
 *                  overlay's own chips instead — no auth, and a better fit than
 *                  Twitch's icons would be against this palette.
 *
 * SECURITY: chat is the most attacker-controlled input in the project. No URL
 * ever comes from a message. Image sources are built from a fixed CDN base plus
 * an id that must match a strict pattern, so a crafted emote id cannot redirect
 * the request or inject a scheme.
 */

const TWITCH_CDN = 'https://static-cdn.jtvnw.net/emoticons/v2/';
const BTTV_CDN = 'https://cdn.betterttv.net/emote/';
const BTTV_API = 'https://api.betterttv.net/3/cached/';

/** Ids are alphanumeric in both services. Anything else is not an id. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const twitchEmoteUrl = id =>
  SAFE_ID.test(id) ? `${TWITCH_CDN}${id}/default/dark/1.0` : null;

export const bttvEmoteUrl = id =>
  SAFE_ID.test(id) ? `${BTTV_CDN}${id}/1x` : null;

/**
 * Parses the `emotes` tag: `25:0-4,12-16/1902:6-10`.
 *
 * Ranges are indexed in CODE POINTS, not UTF-16 units, so a message containing
 * an astral character (an emoji, which chat is full of) shifts every later
 * range if you index with charAt. Returned sorted so the renderer can walk the
 * message once.
 */
export function parseEmoteTag(tag) {
  const out = [];
  if (!tag) return out;
  for (const group of String(tag).split('/')) {
    const colon = group.indexOf(':');
    if (colon < 1) continue;
    const id = group.slice(0, colon);
    if (!SAFE_ID.test(id)) continue;
    for (const range of group.slice(colon + 1).split(',')) {
      const [a, b] = range.split('-').map(Number);
      if (Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a) {
        out.push({ id, start: a, end: b });
      }
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

/**
 * Splits a message into text and emote pieces.
 * Returns [{ kind: 'text', value }, { kind: 'emote', url, alt }].
 */
export function tokenise(text, emoteTag, bttv = new Map()) {
  const chars = [...String(text ?? '')];      // code points, matching the tag
  const ranges = parseEmoteTag(emoteTag);
  const parts = [];
  let cursor = 0;

  const pushText = slice => {
    if (!slice.length) return;
    // BTTV matches whole words only, so split on spaces and check each.
    const words = slice.join('').split(/(\s+)/);
    for (const word of words) {
      if (!word) continue;
      const id = bttv.get(word);
      const url = id ? bttvEmoteUrl(id) : null;
      if (url) parts.push({ kind: 'emote', url, alt: word });
      else if (parts.length && parts.at(-1).kind === 'text') parts.at(-1).value += word;
      else parts.push({ kind: 'text', value: word });
    }
  };

  for (const r of ranges) {
    if (r.start > cursor) pushText(chars.slice(cursor, r.start));
    const url = twitchEmoteUrl(r.id);
    const alt = chars.slice(r.start, r.end + 1).join('');
    if (url) parts.push({ kind: 'emote', url, alt });
    else pushText(chars.slice(r.start, r.end + 1));
    cursor = r.end + 1;
  }
  if (cursor < chars.length) pushText(chars.slice(cursor));

  return parts;
}

/**
 * Parses the `badges` tag: `broadcaster/1,subscriber/12,moderator/1`.
 * Only the name matters here; the version selects an image we do not fetch.
 */
export function parseBadges(tag) {
  if (!tag) return [];
  return String(tag).split(',')
    .map(b => b.split('/')[0].trim().toLowerCase())
    .filter(name => /^[a-z0-9_-]{1,32}$/.test(name));
}

/** Short labels; anything unrecognised falls back to its own name, truncated. */
const BADGE_LABELS = {
  broadcaster: 'HOST', moderator: 'MOD', vip: 'VIP', subscriber: 'SUB',
  founder: 'FNDR', staff: 'STAFF', admin: 'ADMIN', partner: 'PTNR',
  'global_mod': 'GMOD', turbo: 'TURBO', premium: 'PRIME', 'artist-badge': 'ART'
};

export const badgeLabel = name =>
  BADGE_LABELS[name] ?? name.replace(/[^a-z0-9]/g, '').slice(0, 5).toUpperCase();

/**
 * BTTV's global set plus this channel's, as code -> id.
 * The channel set needs the numeric Twitch id, which arrives in ROOMSTATE's
 * `room-id` tag — no extra lookup and no auth.
 *
 * A failure here must never take chat down: emotes are a nicety, messages are
 * the point, so every path resolves to whatever was gathered.
 */
export async function loadBttv(roomId) {
  const map = new Map();
  const add = list => {
    for (const e of Array.isArray(list) ? list : []) {
      if (e?.code && SAFE_ID.test(e?.id ?? '')) map.set(e.code, e.id);
    }
  };

  try {
    add(await (await fetch(BTTV_API + 'emotes/global')).json());
  } catch { /* global set unavailable; channel set may still load */ }

  if (roomId && /^\d{1,20}$/.test(String(roomId))) {
    try {
      const res = await fetch(`${BTTV_API}users/twitch/${roomId}`);
      if (res.ok) {
        const j = await res.json();
        add(j?.channelEmotes);
        add(j?.sharedEmotes);
      }
    } catch { /* channel has no BTTV account, or the API is down */ }
  }
  return map;
}
