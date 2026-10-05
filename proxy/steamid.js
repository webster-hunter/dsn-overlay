/**
 * Steam publishes the same account under four different identifiers, and which
 * one you see depends entirely on which page you happened to be looking at.
 * The Deadlock API wants only one of them — the 32-bit account id — so rather
 * than make the operator work out which they are holding, accept all four and
 * convert.
 *
 *   account id    900000008              what the API wants; Steam calls this
 *                                         your "Friend Code"
 *   SteamID64     76561198083722516       profile URLs, most API docs
 *   SteamID3      [U:1:900000008]        steamid.io, some tools
 *   SteamID       STEAM_0:0:61728394     the legacy form, still shown in-game
 */

/** SteamID64 = this + account id. Fixed by Steam's ID layout. */
export const STEAM64_BASE = 76561197960265728n;

/**
 * Normalise any of the four forms to a 32-bit account id.
 * Returns 0 for anything unrecognised, which the caller treats as "not set" —
 * an unconfigured proxy must never go looking for a match.
 */
export function toAccountId(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return 0;

  // [U:1:900000008]  — also bare U:1:900000008
  const id3 = text.match(/^\[?U:1:(\d+)\]?$/i);
  if (id3) return Number(id3[1]);

  // STEAM_0:0:61728394 — the low bit is carried separately from the rest
  const legacy = text.match(/^STEAM_[0-5]:([01]):(\d+)$/i);
  if (legacy) return Number(BigInt(legacy[2]) * 2n + BigInt(legacy[1]));

  if (!/^\d+$/.test(text)) return 0;

  // A SteamID64 is the base plus the account id, so anything at or above the
  // base is one. Below it, the number is already an account id.
  const n = BigInt(text);
  if (n >= STEAM64_BASE) {
    const id = n - STEAM64_BASE;
    return id > 0n && id <= 0xFFFFFFFFn ? Number(id) : 0;
  }
  return n > 0n && n <= 0xFFFFFFFFn ? Number(n) : 0;
}
