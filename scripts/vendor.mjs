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

console.log('fonts:');
for (const f of FONTS) await grab(FONT_BASE + f, `overlay/fonts/${f}`);

console.log('logo layers:');
for (const [dest, src] of Object.entries(LOGO)) await grab(LOGO_BASE + src, `overlay/logo/${dest}`);
