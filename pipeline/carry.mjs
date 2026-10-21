// Carry of a comp: the hero whose items matter most, measured by taking that hero's items away.
// (Removing the hero itself breaks families and the Banco, so every hero would look essential.)
// Run directly to add carries to the existing data/meta.json without a full analysis.
import fs from 'node:fs';

// heroes within this share of the biggest loss count as carries too; 3 or more = damage spread out
const NEAR = 0.8;

// median(heroes) → Promise<number>; returns { heroes (with itemLoss), carry: { heroes, spread } }
export async function carryOf(comp, median) {
  const base = await median(comp.heroes);
  const loss = await Promise.all(comp.heroes.map(async (_, i) => {
    const m = await median(comp.heroes.map((h, j) => (j === i ? { ...h, items: [] } : h)));
    return base > 0 ? Math.max(0, 1 - m / base) : 0;
  }));
  const top = Math.max(...loss);
  const carries = comp.heroes.filter((_, i) => loss[i] >= NEAR * top).map((h) => h.id);
  carries.sort((a, b) => loss[comp.heroes.findIndex((h) => h.id === b)] - loss[comp.heroes.findIndex((h) => h.id === a)]);
  return { heroes: comp.heroes.map((h, i) => ({ ...h, itemLoss: loss[i] })), carry: { heroes: carries, spread: carries.length >= 3 } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { BancPool } = await import('./pool.mjs');
  const { makeBanc, loadWorkerSource } = await import('./banc.mjs');
  const { makeSetup } = await import('./setup.mjs');
  const meta = JSON.parse(fs.readFileSync('data/meta.json', 'utf8'));
  const dir = `cache/${meta.version}`;
  const workerPath = `${dir}/${fs.readdirSync(dir).find((f) => f.startsWith('sim.worker'))}`;
  const setup = makeSetup(makeBanc(loadWorkerSource(workerPath)).data);
  const pool = new BancPool(workerPath);
  const tables = Math.round(3000 * (meta.scale ?? 0.5));
  const median = async (heroes) => (await pool.run(setup({ heroes: heroes.map((h) => ({ id: h.id, star: h.star, items: h.items })) }), tables)).res.p50;
  await Promise.all(meta.comps.map(async (c) => Object.assign(c, await carryOf(c, median))));
  pool.close();
  fs.writeFileSync('data/meta.json', JSON.stringify(meta));
  if (fs.existsSync('app/data.json')) {
    const app = JSON.parse(fs.readFileSync('app/data.json', 'utf8'));
    fs.writeFileSync('app/data.json', JSON.stringify({ ...app, meta }));
  }
  for (const c of meta.comps) console.log(c.name, '→', c.carry.spread ? 'réparti' : c.carry.heroes.join(' + '), c.heroes.map((h) => `${h.id} ${(100 * h.itemLoss).toFixed(0)}%`).join(' | '));
}
