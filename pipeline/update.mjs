// Checks the game version and, if it changed (or with --force), runs the whole analysis, refreshes the
// real-game stats and rebuilds app/data.json. Exit codes: 0 = new version analysed, 11 = same version but
// real-game stats refreshed (republish), 10 = nothing new (no API stats either).
import fs from 'node:fs';
import { fetchGame } from './fetch.mjs';
import { analyze } from './analyze.mjs';
import { fetchStats } from './api.mjs';

const force = process.argv.includes('--force');
const statsOnly = process.argv.includes('--stats');
const prev = fs.existsSync('data/meta.json') ? JSON.parse(fs.readFileSync('data/meta.json', 'utf8')) : null;
const game = await fetchGame();
console.log(`version en ligne : ${game.version} (${game.versionDate}) · analysée : ${prev?.version ?? 'aucune'}`);

let meta = prev;
if (!statsOnly && (force || !prev || prev.version !== game.version)) {
  meta = await analyze({ version: game.version, workerPath: game.workerPath, previous: prev });
  meta.versionDate = game.versionDate;
  meta.versionTitle = game.versionTitle;
  meta.patchNotes = game.patchNotes;
  meta.previousVersion = prev?.version ?? null;
  // what changed in the data since the previous analysis
  if (prev) {
    const diff = (a, b) => ({ added: b.filter((x) => !a.some((y) => y.id === x.id)).map((x) => x.name), removed: a.filter((x) => !b.some((y) => y.id === x.id)).map((x) => x.name) });
    meta.changes = { heroes: diff(prev.heroes, meta.heroes), items: diff(prev.items, meta.items), runes: diff(prev.runes, meta.runes), blessings: diff(prev.blessings, meta.blessings),
      heroText: meta.heroes.filter((h) => { const o = prev.heroes.find((x) => x.id === h.id); return o && JSON.stringify(o.effects) !== JSON.stringify(h.effects); }).map((h) => h.name) };
  }
  fs.writeFileSync('data/meta.json', JSON.stringify(meta));
} else if (!statsOnly) {
  console.log('déjà à jour');
}
const stats = await fetchStats();
console.log(stats.ok ? 'statistiques des vraies parties : ok' : 'statistiques des vraies parties : indisponibles (clé API absente ou refusée)');
fs.mkdirSync('app', { recursive: true });
fs.writeFileSync('app/data.json', JSON.stringify({ meta, stats }));
const analysed = meta !== prev || force;
process.exit(analysed && !statsOnly ? 0 : stats.ok ? 11 : 10);
