import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIrc } from '../overlay/chat.js';

// Lines in Twitch's real wire format.
test('parses a tagged PRIVMSG into nick, channel and text', () => {
  const line = '@badge-info=;badges=;color=#FF69B4;display-name=SomeViewer;mod=0 ' +
               ':someviewer!someviewer@someviewer.tmi.twitch.tv PRIVMSG #yourchannel :hello there';
  const m = parseIrc(line);
  assert.equal(m.command, 'PRIVMSG');
  assert.equal(m.channel, '#yourchannel');
  assert.equal(m.text, 'hello there');
  assert.equal(m.tags['display-name'], 'SomeViewer');
  assert.equal(m.tags.color, '#FF69B4');
});

test('a message containing a colon keeps all of it', () => {
  // The text is everything after the FIRST ':' of the trailing param — naive
  // splitting on every colon truncates links, which chat is full of.
  const line = ':a!a@a.tmi.twitch.tv PRIVMSG #c :look: https://example.com/x?y=1';
  assert.equal(parseIrc(line).text, 'look: https://example.com/x?y=1');
});

test('an untagged message still yields a nick', () => {
  const m = parseIrc(':nobody!nobody@nobody.tmi.twitch.tv PRIVMSG #c :hi');
  assert.equal(m.nick, 'nobody');
  assert.equal(m.text, 'hi');
});

test('PING is recognised, because an unanswered keepalive drops the socket', () => {
  assert.equal(parseIrc('PING :tmi.twitch.tv').command, 'PING');
});

test('server notices are not mistaken for chat', () => {
  // Anything that is not a PRIVMSG must not reach the rail as a message.
  for (const line of [
    ':tmi.twitch.tv 001 justinfan123 :Welcome, GLHF!',
    ':tmi.twitch.tv CAP * ACK :twitch.tv/tags',
    '@msg-id=slow_off :tmi.twitch.tv NOTICE #c :This room is no longer in slow mode.'
  ]) {
    assert.notEqual(parseIrc(line).command, 'PRIVMSG', line);
  }
});

test('markup typed by a viewer stays text, never a node', () => {
  // Chat is the most attacker-controlled input in the project: anyone can type
  // anything. The parser must hand back a plain string for the renderer to set
  // via textContent — it must never pre-interpret it.
  const evil = '<img src=x onerror=alert(1)>';
  const m = parseIrc(':a!a@a.tmi.twitch.tv PRIVMSG #c :' + evil);
  assert.equal(m.text, evil);
  assert.equal(typeof m.text, 'string');
});

// --- emotes and badges ------------------------------------------------------
import { parseEmoteTag, tokenise, parseBadges, badgeLabel, twitchEmoteUrl, bttvEmoteUrl } from '../overlay/emotes.js';

test('emote ranges are indexed in code points, not UTF-16 units', () => {
  // An emoji is two UTF-16 units but one code point. Indexing with charAt
  // shifts every later range and slices the emote name in half.
  const text = '👍 Kappa';           // Kappa occupies code points 2-6
  const parts = tokenise(text, '25:2-6');
  const emote = parts.find(p => p.kind === 'emote');
  assert.ok(emote, 'the emote must be found despite the astral character');
  assert.equal(emote.alt, 'Kappa');
});

test('a crafted emote id cannot inject a URL', () => {
  // The id arrives in a tag; it must never be pasted into a URL unchecked.
  for (const bad of ['../../evil', 'javascript:alert(1)', 'a/b', 'x".onerror="']) {
    assert.equal(twitchEmoteUrl(bad), null, bad);
    assert.equal(bttvEmoteUrl(bad), null, bad);
  }
  assert.equal(twitchEmoteUrl('25'), 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0');
});

test('BTTV emotes match whole words only', () => {
  const bttv = new Map([['catJAM', 'abc123']]);
  const whole = tokenise('wow catJAM nice', '', bttv);
  assert.equal(whole.filter(p => p.kind === 'emote').length, 1);

  // A substring inside a longer word is not that emote.
  const partial = tokenise('wowcatJAMnice', '', bttv);
  assert.equal(partial.filter(p => p.kind === 'emote').length, 0);
});

test('message text around emotes survives intact', () => {
  const parts = tokenise('hi Kappa there', '25:3-7');
  const text = parts.filter(p => p.kind === 'text').map(p => p.value).join('');
  assert.ok(text.includes('hi'), 'leading text kept');
  assert.ok(text.includes('there'), 'trailing text kept');
});

test('badges parse to names and get short labels', () => {
  assert.deepEqual(parseBadges('broadcaster/1,subscriber/12,moderator/1'),
                   ['broadcaster', 'subscriber', 'moderator']);
  assert.equal(badgeLabel('broadcaster'), 'HOST');
  assert.equal(badgeLabel('moderator'), 'MOD');
  // An unknown badge still renders something rather than nothing.
  assert.equal(badgeLabel('some_new_badge'), 'SOMEN');
});

test('a crafted badge name cannot become a class or label injection', () => {
  // The name becomes a CSS class, so it must be constrained.
  assert.deepEqual(parseBadges('evil badge/1'), []);
  assert.deepEqual(parseBadges('"><script>/1'), []);
  assert.deepEqual(parseBadges(''), []);
  assert.deepEqual(parseBadges(undefined), []);
});
