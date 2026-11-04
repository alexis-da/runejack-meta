// Smuggler (Contrebandier) upgrades of a comp: for each smuggler item, the hero and slot where it adds the
// most, kept once per item (an item that suits several heroes lists the others in `alsoOn`).
// Run directly to recompute them for the comps of the existing data/meta.json.
import fs from 'node:fs';

// med(comp) → Promise<median damage per room>; items = smuggler item ids
export async function contrabandOf(c, med, items, keep = 5) {
  const base = await med({ heroes: c.heroes });
  const opts = [];
  await Promise.all(c.heroes.map((h, i) => Promise.all(items.map(async (it) => {
    let best = 0, slot = -1;
    for (let s = 0; s < 3; s++) {
      const c2 = { heroes: c.heroes.map((x, j) => (j === i ? { ...x, items: Object.assign([...x.items, '', '', ''].slice(0, 3), { [s]: it }) } : x)) };
      const m = await med(c2);
      if (m > best) { best = m; slot = s; }
    }
    opts.push({ seat: i, hero: h.id, item: it, replaces: c.heroes[i].items[slot] ?? null, gain: base > 0 ? best / base - 1 : 0 });
  }))));
  opts.sort((a, b) => b.gain - a.gain);
  const out = [];
  for (const o of opts) {
    if (out.some((x) => x.item === o.item)) continue;
    const alsoOn = opts.filter((x) => x.item === o.item && x.hero !== o.hero && x.gain > 0 && x.gain >= 0.8 * o.gain).map((x) => x.hero);
    out.push({ ...o, alsoOn });
  }
  return out.filter((o, k) => o.gain > 0 || k < 3).slice(0, keep);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { BancPool } = await import('./pool.mjs');
  const { makeBanc, loadWorkerSource } = await import('./banc.mjs');
  const { makeSetup } = await import('./setup.mjs');
  const meta = JSON.parse(fs.readFileSync('data/meta.json', 'utf8'));
  const dir = `cache/${meta.version}`;
  const workerPath = `${dir}/${fs.readdirSync(dir).find((f) => f.startsWith('sim.worker'))}`;
  const D = makeBanc(loadWorkerSource(workerPath)).data;
  const setup = makeSetup(D);
  const pool = new BancPool(workerPath);
  const tables = Math.round(300 * (meta.scale ?? 0.5));
  const lean = (c) => ({ heroes: c.heroes.map((h) => ({ id: h.id, star: h.star, items: h.items.filter(Boolean) })) });
  const med = async (c) => (await pool.run(setup(lean(c)), tables)).res.p50;
  const CONTRA = D.items.filter((i) => i.contraband).map((i) => i.id);
  await Promise.all(meta.comps.map(async (c) => { c.contraband = await contrabandOf(c, med, CONTRA); }));
  pool.close();
  fs.writeFileSync('data/meta.json', JSON.stringify(meta));
  if (fs.existsSync('app/data.json')) {
    const app = JSON.parse(fs.readFileSync('app/data.json', 'utf8'));
    fs.writeFileSync('app/data.json', JSON.stringify({ ...app, meta }));
  }
  for (const c of meta.comps) console.log(c.name, '→', c.contraband.map((x) => `${x.item}@${x.hero} ${(100 * x.gain).toFixed(0)}%`).join(' | '));
}
