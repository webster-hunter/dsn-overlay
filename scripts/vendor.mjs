import { writeFileSync, mkdirSync } from 'node:fs';

const FONT_BASE = 'https://assets-bucket.deadlock-api.com/assets-api-res/fonts/';
const LOGO_BASE = 'https://assets-bucket.deadlock-api.com/assets-api-res/images/main_menu/';

const FONTS = [
  'radiance-semibold.otf',
  'radiance-bold.otf',
  'radiancem-semibold.otf',
  'reaver-bold.otf'
];

// Composite = outer + inner_noeye + eye. deadlock_logo_inner.svg (10 paths)
// is the inner form WITH the eye baked in; we want the eye separable, so skip it.
const LOGO = {
  'outer.svg': 'deadlock_logo_outer.svg',
  'inner_noeye.svg': 'deadlock_logo_inner_noeye.svg',
  'eye.svg': 'deadlock_logo_eye.svg'
};

async function grab(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`  ${dest}  ${buf.length} bytes`);
}

mkdirSync('overlay/fonts', { recursive: true });
mkdirSync('overlay/logo', { recursive: true });
mkdirSync('overlay/heroes', { recursive: true });

console.log('fonts:');
for (const f of FONTS) await grab(FONT_BASE + f, `overlay/fonts/${f}`);

console.log('logo layers:');
for (const [dest, src] of Object.entries(LOGO)) await grab(LOGO_BASE + src, `overlay/logo/${dest}`);

// Hero icons, named by hero id so the overlay needs no manifest: the board
// renders heroes/<heroId>.webp directly. Only heroes that actually ship a
// small icon are vendored; a hero without one falls back to the empty plate
// styled in overlay.css, which is why the board never renders a hole.
const HEROES_URL = 'https://api.deadlock-api.com/v1/assets/heroes';
const heroes = await (await fetch(HEROES_URL)).json();
const withIcon = heroes.filter(h => !h.disabled && h.images?.icon_image_small_webp);

console.log(`hero icons (${withIcon.length} of ${heroes.length} have one):`);
let bytes = 0;
for (const h of withIcon) {
  const res = await fetch(h.images.icon_image_small_webp);
  if (!res.ok) { console.warn(`  skip ${h.id} ${h.name} -> ${res.status}`); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(`overlay/heroes/${h.id}.webp`, buf);
  bytes += buf.length;
}
console.log(`  ${withIcon.length} icons, ${(bytes / 1024).toFixed(0)} KB total`);
