// Carry of a comp: the hero who deals the damage. Measured on the banc deal by deal: each seat's own
// damage, and a Banco's damage split between its seats by their share of force and fureur.
// Also measured: what the comp loses when a hero's items are taken away. A hero with a big loss but a
// small damage share is a key piece (its items feed the families or the other seats), not a carry.
// Run directly to add carries to the existing data/meta.json without a full analysis.
import fs from 'node:fs';

// heroes within this share of the top damage share count as carries too; 3 or more = damage spread out
const NEAR = 0.8;

/** Damage share of each seat over `tables` rooms. */
export function damageShares(banc, setup, tables) {
  const dmg = setup.seats.map(() => 0);
  banc.deals(setup, tables, (deal) => {
    deal.seats.forEach((s, i) => { dmg[i] += s.damage; });
    const b = deal.banco;
    if (!b) return;
    const live = (i) => (deal.seats[i].outcome === 'bust' ? 0 : deal.seats[i].mult);
    const base = b.seats.reduce((x, i) => x + deal.seats[i].base, 0);
    const mult = b.seats.reduce((x, i) => x + live(i), 0);
    for (const i of b.seats) dmg[i] += (b.damage * ((base ? deal.seats[i].base / base : 0) + (mult ? live(i) / mult : 0))) / 2;
  });
  const total = dmg.reduce((x, y) => x + y, 0);
  return dmg.map((d) => (total > 0 ? d / total : 0));
}

// median(heroes) → Promise<number>; shares = damage share per seat
export async function carryOf(comp, median, shares) {
  const base = await median(comp.heroes);
  const loss = await Promise.all(comp.heroes.map(async (_, i) => {
    const m = await median(comp.heroes.map((h, j) => (j === i ? { ...h, items: [] } : h)));
    return base > 0 ? Math.max(0, 1 - m / base) : 0;
  }));
  const top = Math.max(...shares);
  const order = comp.heroes.map((h, i) => i).sort((a, b) => shares[b] - shares[a]);
  const carries = order.filter((i) => shares[i] >= NEAR * top).map((i) => comp.heroes[i].id);
  // key pieces: heroes whose items matter a lot although they deal little damage themselves
  const keyPieces = comp.heroes.map((h, i) => i).filter((i) => !carries.includes(comp.heroes[i].id) && shares[i] < 0.15 && loss[i] >= 0.3)
    .sort((a, b) => loss[b] - loss[a]).map((i) => comp.heroes[i].id);
  return {
    heroes: comp.heroes.map((h, i) => ({ ...h, itemLoss: loss[i], damageShare: shares[i] })),
    carry: { heroes: carries, spread: carries.length >= 3, keyPieces },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { BancPool } = await import('./pool.mjs');
  const { makeBanc, loadWorkerSource } = await import('./banc.mjs');
  const { makeSetup } = await import('./setup.mjs');
  const meta = JSON.parse(fs.readFileSync('data/meta.json', 'utf8'));
  const dir = `cache/${meta.version}`;
  const workerPath = `${dir}/${fs.readdirSync(dir).find((f) => f.startsWith('sim.worker'))}`;
  const banc = makeBanc(loadWorkerSource(workerPath));
  const setup = makeSetup(banc.data);
  const pool = new BancPool(workerPath);
  const tables = Math.round(3000 * (meta.scale ?? 0.5));
  const lean = (heroes) => ({ heroes: heroes.map((h) => ({ id: h.id, star: h.star, items: h.items })) });
  const median = async (heroes) => (await pool.run(setup(lean(heroes)), tables)).res.p50;
  await Promise.all(meta.comps.map(async (c) => Object.assign(c, await carryOf(c, median, damageShares(banc, setup(lean(c.heroes)), tables)))));
  pool.close();
  fs.writeFileSync('data/meta.json', JSON.stringify(meta));
  if (fs.existsSync('app/data.json')) {
    const app = JSON.parse(fs.readFileSync('app/data.json', 'utf8'));
    fs.writeFileSync('app/data.json', JSON.stringify({ ...app, meta }));
  }
  for (const c of meta.comps) console.log(c.name, '→', c.carry.spread ? 'réparti' : c.carry.heroes.join(' + '), c.carry.keyPieces.length ? `(pièces clés : ${c.carry.keyPieces.join(', ')})` : '', '|', c.heroes.map((h) => `${h.id} ${(100 * h.damageShare).toFixed(0)}% dégâts, −${(100 * h.itemLoss).toFixed(0)}% sans objets`).join(' | '));
}
