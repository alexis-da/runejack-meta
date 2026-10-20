// Downloads what the analysis needs from play.runejack.com: the game version (from the patch notes
// embedded in the main bundle) and the banc simulator worker. Writes cache/<version>/.
import fs from 'node:fs';
import path from 'node:path';

export const ORIGIN = process.env.RUNEJACK_ORIGIN ?? 'https://play.runejack.com';

async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((res) => setTimeout(res, 2000 * 2 ** i));
    }
  }
}

/** Returns { version, versionDate, mainFile, workerFile, workerPath, patchNotes } */
export async function fetchGame(cacheDir = 'cache') {
  const home = await get(`${ORIGIN}/`);
  const mainFile = home.match(/assets\/(main-[\w-]+\.js)/)?.[1];
  if (!mainFile) throw new Error('bundle principal introuvable sur la page d’accueil');
  const main = await get(`${ORIGIN}/assets/${mainFile}`);
  const head = main.match(/## (\d+\.\d+\.\d+) · ([^·\n]+) · ([^\n`]+)/);
  if (!head) throw new Error('version introuvable dans les notes de patch');
  const [, version, versionDate, versionTitle] = head;
  const notesStart = main.indexOf(`## ${version} ·`);
  const patchNotes = main.slice(notesStart, notesStart + 20000).split(/\n## \d/)[0].replace(/\\`/g, '`');

  const banc = await get(`${ORIGIN}/banc`);
  const bancFile = banc.match(/assets\/(banc-[\w-]+\.js)/)?.[1];
  if (!bancFile) throw new Error('page du banc introuvable');
  const bancJs = await get(`${ORIGIN}/assets/${bancFile}`);
  const workerFile = bancJs.match(/(sim\.worker-[\w-]+\.js)/)?.[1];
  if (!workerFile) throw new Error('worker du banc introuvable');
  const dir = path.join(cacheDir, version);
  fs.mkdirSync(dir, { recursive: true });
  const workerPath = path.join(dir, workerFile);
  if (!fs.existsSync(workerPath)) fs.writeFileSync(workerPath, await get(`${ORIGIN}/assets/${workerFile}`));
  fs.writeFileSync(path.join(dir, 'patchnotes.md'), patchNotes);
  return { version, versionDate: versionDate.trim(), versionTitle: versionTitle.trim(), mainFile, workerFile, workerPath, patchNotes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const g = await fetchGame();
  console.log(JSON.stringify({ ...g, patchNotes: g.patchNotes.slice(0, 200) + '…' }, null, 2));
}
