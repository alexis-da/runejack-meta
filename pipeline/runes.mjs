// Runes and blessings of a comp: each rune alone, a greedy build of 6 (no secret rune), and each
// blessing alone, as gains on the median damage per room. Run directly to fill the comps of the existing
// data/meta.json that have none yet.
import fs from 'node:fs';

// med(comp) → Promise<median damage per room>; D = banc data
export async function runesOf(c, med, D) {
  const base = await med({ heroes: c.heroes });
  const gain = (m) => (base > 0 ? m / base - 1 : 0);
  const single = await Promise.all(D.runes.map(async (r) => ({ id: r.id, gain: gain(await med({ heroes: c.heroes, runes: [r.id] })) })));
  single.sort((a, b) => b.gain - a.gain);
  const chosen = [];
  let cur = base;
  for (let s = 0; s < 6; s++) {
    const cand = D.runes.filter((r) => r.rarity !== 'secrete' && !chosen.includes(r.id));
    const ms = await Promise.all(cand.map((r) => med({ heroes: c.heroes, runes: [...chosen, r.id] })));
    const bi = ms.indexOf(Math.max(...ms));
    chosen.push(cand[bi].id); cur = ms[bi];
  }
  return { single: single.slice(0, 15), worst: single.slice(-5), build: chosen, buildGain: gain(cur) };
}

export async function blessingsOf(c, med, D) {
  const base = await med({ heroes: c.heroes });
  const b = await Promise.all(D.blessings.map(async (x) => ({ id: x.id, gain: base > 0 ? (await med({ heroes: c.heroes, blessings: [x.id] })) / base - 1 : 0 })));
  return b.sort((a, b2) => b2.gain - a.gain);
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
  const tables = Math.round(400 * (meta.scale ?? 0.5));
  const lean = (c) => ({ heroes: c.heroes.map((h) => ({ id: h.id, star: h.star, items: h.items })), runes: c.runes ?? [], blessings: c.blessings ?? [] });
  const med = async (c) => (await pool.run(setup(lean(c)), tables)).res.p50;
  await Promise.all(meta.comps.map(async (c) => {
    if (!c.runes) c.runes = await runesOf(c, med, D);
    if (!c.blessings) c.blessings = await blessingsOf(c, med, D);
  }));
  pool.close();
  fs.writeFileSync('data/meta.json', JSON.stringify(meta));
  if (fs.existsSync('app/data.json')) {
    const app = JSON.parse(fs.readFileSync('app/data.json', 'utf8'));
    fs.writeFileSync('app/data.json', JSON.stringify({ ...app, meta }));
  }
  for (const c of meta.comps) console.log(c.name, '→', c.runes.build.join(', '), `×${(1 + c.runes.buildGain).toFixed(1)}`);
}
