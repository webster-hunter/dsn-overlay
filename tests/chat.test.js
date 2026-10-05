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
