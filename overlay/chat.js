/**
 * Twitch chat in the right rail, rendered by us.
 *
 * The rail was built for a live stat board that cannot be filled: the API has
 * no way to report the operator's current match (/v1/matches/active is the
 * in-game watch tab, "limited to the top 200 matches", and returned [] for this
 * account mid-match), and the roster is absent from Deadlock's console log.
 * Reaching it would mean parsing a Source 2 broadcast — a second runtime and a
 * permanent maintenance burden for a panel that only fills during a match.
 *
 * Twitch's own embed was tried first and is wrong for a broadcast: it ships a
 * cookie-consent banner covering a third of the rail, an animated-emotes
 * notice, and a "Send a message" box nobody will type into on stream. The
 * popout URL cannot be framed at all. Both were observed, not assumed.
 *
 * So: connect to Twitch's IRC gateway anonymously and render the messages in
 * the overlay's own type. No auth, no dependency, no third-party chrome.
 *
 * SECURITY: every message here is written by a stranger — chat is the most
 * attacker-controlled input in the whole project, more so than persona names.
 * Everything reaches the DOM through createElement + textContent. The injection
 * gate greps this file for the usual sinks.
 */

const IRC = 'wss://irc-ws.chat.twitch.tv:443';

/** Anonymous read-only login. Twitch accepts any justinfan<digits> nick. */
const anonNick = () => 'justinfan' + Math.floor(Math.random() * 80000 + 1000);

/** Keep the DOM bounded: a long stream would otherwise grow it without limit. */
const MAX_LINES = 60;

/**
 * Parses one IRC line into { tags, command, channel, text, nick }.
 * Twitch's format: `@k=v;k=v :nick!user@host PRIVMSG #chan :message`
 */
export function parseIrc(line) {
  let rest = line;
  const tags = {};

  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    for (const pair of rest.slice(1, sp).split(';')) {
      const eq = pair.indexOf('=');
      if (eq > 0) tags[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    rest = rest.slice(sp + 1);
  }

  let nick = null;
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    const prefix = rest.slice(1, sp);
    nick = prefix.split('!')[0] || null;
    rest = rest.slice(sp + 1);
  }

  const sp = rest.indexOf(' ');
  const command = (sp === -1 ? rest : rest.slice(0, sp)).trim();
  let params = sp === -1 ? '' : rest.slice(sp + 1);

  let channel = null;
  let text = null;
  if (params.startsWith('#')) {
    const cut = params.indexOf(' ');
    channel = cut === -1 ? params : params.slice(0, cut);
    params = cut === -1 ? '' : params.slice(cut + 1);
  }
  if (params.startsWith(':')) text = params.slice(1);

  return { tags, nick, command, channel, text };
}

/** Twitch sends colours as #RRGGBB, or empty for users who never picked one. */
function nameColour(tags, nick) {
  if (/^#[0-9a-f]{6}$/i.test(tags.color ?? '')) return tags.color;
  // Deterministic fallback so a given chatter keeps one colour across the
  // stream, drawn warm to sit inside the overlay's palette rather than fight it.
  let h = 0;
  for (const ch of nick ?? '') h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${30 + (h % 60)} 55% 68%)`;
}

export function mountChat(host, channel) {
  if (!host) return;

  if (!channel) {
    const note = document.createElement('div');
    note.className = 'chat-empty';
    const title = document.createElement('div');
    title.className = 'chat-empty-title';
    title.textContent = 'Chat';
    const body = document.createElement('div');
    body.className = 'chat-empty-body';
    body.textContent = 'Set DSN_TWITCH_CHANNEL in .env';
    note.append(title, body);
    host.replaceChildren(note);
    return;
  }

  const list = document.createElement('div');
  list.id = 'chat-lines';
  host.replaceChildren(list);

  const add = (nick, text, colour) => {
    const line = document.createElement('div');
    line.className = 'chat-line';
    const who = document.createElement('span');
    who.className = 'chat-nick';
    who.style.color = colour;
    who.textContent = nick;
    const what = document.createElement('span');
    what.className = 'chat-text';
    // textContent: a viewer typing markup gets a literal string, not an element.
    what.textContent = text;
    line.append(who, what);
    list.appendChild(line);
    while (list.children.length > MAX_LINES) list.firstChild.remove();
    // Newest at the bottom, as every chat client does.
    list.scrollTop = list.scrollHeight;
  };

  let socket = null;
  let retry = 1000;

  const connect = () => {
    socket = new WebSocket(IRC);

    socket.addEventListener('open', () => {
      retry = 1000;
      // Tags carry display-name and colour; without the capability the
      // messages still arrive but render as flat lowercase logins.
      socket.send('CAP REQ :twitch.tv/tags');
      socket.send('PASS SCHMOOPIIE');            // anonymous: any value
      socket.send('NICK ' + anonNick());
      socket.send('JOIN #' + channel.toLowerCase());
    });

    socket.addEventListener('message', ev => {
      for (const raw of String(ev.data).split('\r\n')) {
        if (!raw) continue;
        const msg = parseIrc(raw);
        // Twitch drops connections that do not answer its keepalive.
        if (msg.command === 'PING') { socket.send('PONG :tmi.twitch.tv'); continue; }
        if (msg.command !== 'PRIVMSG' || msg.text == null) continue;
        const nick = msg.tags['display-name'] || msg.nick || '?';
        add(nick, msg.text, nameColour(msg.tags, nick));
      }
    });

    // A dropped socket mid-stream must not leave the rail frozen. Back off so a
    // sustained outage does not hammer Twitch.
    const reconnect = () => {
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    };
    socket.addEventListener('close', reconnect);
    socket.addEventListener('error', () => socket.close());
  };

  connect();
}
