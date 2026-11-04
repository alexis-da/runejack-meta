// Pictures of the heroes, items and runes, taken from the game's own assets. The main bundle maps each
// source path ("../../assets/pixellab/objets/couperet.png") to its hashed file ("couperet-C6tdz7uF.png");
// a picture is downloaded to app/img/<kind>/<id>.png only when its hashed file changed.
// Run directly to refresh the pictures for the existing data/meta.json.
import fs from 'node:fs';
import path from 'node:path';
import { ORIGIN } from './fetch.mjs';

// where the game keeps each kind, in order of preference (a file may carry a -1, -2… variant suffix)
const SOURCES = {
  heroes: ['heroes/pixellab/', 'pixellab/heroes-manuel/', 'pixellab/serie-pixellab/', 'pixellab/serie-pixelgeminilab/'],
  items: ['pixellab/objets/'],
  runes: ['pixellab/serie-runes/'],
};

/** source path → hashed file name, from the main bundle's asset globs */
export function assetMap(main) {
  const vars = {};
  for (const m of main.matchAll(/([A-Za-z_$][\w$]*)=new URL\(`([^`]+)`,import\.meta\.url\)\.href/g)) vars[m[1]] = m[2];
  const map = {};
  for (const m of main.matchAll(/"\.\.\/\.\.\/assets\/([^"]+)":([A-Za-z_$][\w$]*)/g)) if (vars[m[2]]) map[m[1]] = vars[m[2]];
  return map;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function resolve(map, kind, id) {
  const keys = Object.keys(map);
  for (const dir of SOURCES[kind]) {
    const re = new RegExp(`^${esc(dir)}${esc(id)}(-\\d+)?\\.png$`);
    const hits = keys.filter((k) => re.test(k)).sort();
    if (hits.length) return map[hits[0]];
  }
  return null;
}

/** Downloads the pictures of meta's heroes, items and runes into `dir`. Returns { got, kept, missing } */
export async function fetchImages(meta, main, dir = 'app/img') {
  const map = assetMap(main);
  const manifestFile = path.join(dir, 'manifest.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  const out = { got: 0, kept: 0, missing: [] };
  for (const [kind, list] of [['heroes', meta.heroes], ['items', meta.items], ['runes', meta.runes]]) {
    fs.mkdirSync(path.join(dir, kind), { recursive: true });
    for (const { id } of list) {
      const file = resolve(map, kind, id);
      if (!file) { out.missing.push(`${kind}/${id}`); continue; }
      const dest = path.join(dir, kind, `${id}.png`);
      const key = `${kind}/${id}`;
      if (manifest[key] === file && fs.existsSync(dest)) { out.kept++; continue; }
      const res = await fetch(`${ORIGIN}/assets/${file}`);
      if (!res.ok) { out.missing.push(key); continue; }
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      manifest[key] = file;
      out.got++;
    }
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const meta = JSON.parse(fs.readFileSync('data/meta.json', 'utf8'));
  const home = await (await fetch(`${ORIGIN}/`)).text();
  const mainFile = home.match(/assets\/(main-[\w-]+\.js)/)?.[1];
  const main = await (await fetch(`${ORIGIN}/assets/${mainFile}`)).text();
  const r = await fetchImages(meta, main);
  console.log(`images : ${r.got} téléchargées, ${r.kept} inchangées${r.missing.length ? `, introuvables : ${r.missing.join(', ')}` : ''}`);
}
