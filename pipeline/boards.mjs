// Boards along the run, like metatft's "level 4 / level 5 …" rows: for each number of seats, the best
// subset of the comp's heroes (with their kit), measured on the banc, and the last floor whose boss it
// still beats more often than not. Run directly to add the boards to the existing data/meta.json.
import fs from 'node:fs';

const combos = (arr, k) => (k === 0 ? [[]] : arr.flatMap((x, i) => combos(arr.slice(i + 1), k - 1).map((c) => [x, ...c])));

// full(comp, opts) → Promise<{ res, etages }> (banc result of a comp)
export async function boardsOf(comp, full, floors) {
  const out = [];
  for (let k = 1; k <= comp.heroes.length; k++) {
    const cands = combos(comp.heroes.map((h, i) => i), k);
    const res = await Promise.all(cands.map(async (idx) => {
      const heroes = idx.map((i) => comp.heroes[i]);
      const r = await full({ heroes }, { moment: 'milieu' });
      // last floor (within the run) whose boss falls at least half the time
      const beats = r.etages.filter((e) => e.etage <= floors && e.tueBoss >= 0.5).reduce((m, e) => Math.max(m, e.etage), 0);
      return { heroes: heroes.map((h) => h.id), median: r.res.p50, beats, kill: Object.fromEntries(r.etages.filter((e) => e.etage <= floors).map((e) => [e.etage, e.tueBoss])) };
    }));
    res.sort((a, b) => b.median - a.median);
    out.push({ seats: k, ...res[0] });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { BancPool } = await import('./pool.mjs');
  const { makeBanc, loadWorkerSource } = await import('./banc.mjs');
  const { makeSetup } = await import('./setup.mjs');
  const meta = JSON.parse(fs.readFileSync('data/meta.json', 'utf8'));
  const dir = process.env.BANC_DIR ?? `cache/${meta.version}`;
  const workerPath = `${dir}/${fs.readdirSync(dir).find((f) => f.startsWith('sim.worker'))}`;
  const setup = makeSetup(makeBanc(loadWorkerSource(workerPath)).data);
  const pool = new BancPool(workerPath);
  const tables = Math.round(1200 * (meta.scale ?? 0.5));
  const lean = (c) => ({ heroes: c.heroes.map((h) => ({ id: h.id, star: h.star, items: h.items })) });
  const full = (c, opts) => pool.run(setup(lean(c), opts), tables);
  await Promise.all(meta.comps.map(async (c) => { c.boards = await boardsOf(c, full, meta.settings.floors); }));
  pool.close();
  fs.writeFileSync('data/meta.json', JSON.stringify(meta));
  if (fs.existsSync('app/data.json')) {
    const app = JSON.parse(fs.readFileSync('app/data.json', 'utf8'));
    fs.writeFileSync('app/data.json', JSON.stringify({ ...app, meta }));
  }
  for (const c of meta.comps.slice(0, 3)) console.log(c.name, c.boards.map((b) => `${b.seats}: ${b.heroes.join('+')} → boss ${b.beats}`).join(' | '));
}
