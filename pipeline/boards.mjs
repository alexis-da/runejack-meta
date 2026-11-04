// Boards along the run, like metatft's "level 4 / level 5 …" rows. For each number of seats: the level
// that opens it (Pacte du Joueur), the heroes one can actually have then (rarities the shop offers at
// least 10 % of the time at that level), 1★ and few items early on. The board grows from the previous
// one toward the final comp, filling gaps with transition heroes of the comp's families; each board is
// measured on the banc, with the last floor whose boss it still beats more often than not.
// Run directly to add the boards to the existing data/meta.json.
import fs from 'node:fs';

const SEATS_FULL = 5;

/**
 * comp: { heroes: [{ id, star, items }] }
 * full(comp, opts) → Promise<{ res, etages }>
 * ctx: { heroes: Map(id → { cost, trait, extraTraits }), odds: {level: [%cost1..5]}, prog: { seats, odds }, kit: Map(id → items), strength: Map(id → number) }
 */
export async function boardsOf(comp, full, floors, ctx) {
  const fams = (id) => { const h = ctx.heroes.get(id); return [h.trait, ...(h.extraTraits ?? [])]; };
  const compIds = comp.heroes.map((h) => h.id);
  const compFams = new Set(compIds.flatMap(fams));
  const levelFor = (k) => ctx.prog.seats.findIndex((s) => s >= k) + 1;
  const out = [];
  let prev = [];
  for (let k = 1; k <= SEATS_FULL; k++) {
    const level = levelFor(k);
    const row = ctx.odds[ctx.prog.odds[level - 1]] ?? [100, 0, 0, 0, 0];
    const allowed = (id) => (row[(ctx.heroes.get(id)?.cost ?? 5) - 1] ?? 0) >= 10;
    const nItems = k <= 3 ? 1 : k === 4 ? 2 : 3;
    const seat = (id) => {
      const inComp = comp.heroes.find((h) => h.id === id);
      const cost = ctx.heroes.get(id).cost;
      const star = k === SEATS_FULL && inComp ? inComp.star : k >= 4 && cost <= 2 ? 2 : 1;
      return { id, star, items: (inComp?.items ?? ctx.kit.get(id) ?? []).slice(0, nItems) };
    };
    const measure = async (ids) => {
      const r = await full({ heroes: ids.map(seat) }, { moment: 'milieu' });
      const beats = r.etages.filter((e) => e.etage <= floors && e.tueBoss >= 0.5).reduce((m, e) => Math.max(m, e.etage), 0);
      // a board that already holds comp heroes is worth a little more: it builds toward the final comp
      return { ids, median: r.res.p50, beats, score: r.res.p50 * (1 + 0.15 * ids.filter((id) => compIds.includes(id)).length) };
    };
    let best;
    if (k === SEATS_FULL && compIds.length === SEATS_FULL) best = await measure(compIds);
    else {
      const transition = [...ctx.heroes.keys()]
        .filter((id) => !compIds.includes(id) && allowed(id) && fams(id).some((f) => compFams.has(f)))
        .sort((a, b) => (ctx.strength.get(b) ?? 0) - (ctx.strength.get(a) ?? 0)).slice(0, 4);
      const pool = [...compIds.filter(allowed), ...transition];
      const keep = prev.filter((id) => allowed(id));
      // grow the previous board by one, then try swapping one hero for another of the pool
      const adds = pool.filter((id) => !keep.includes(id));
      let cands = adds.length ? adds.map((id) => [...keep, id].slice(-k)) : [keep];
      if (keep.length > k - 1) cands = [keep.slice(0, k)];
      const scored = await Promise.all(cands.filter((c) => c.length === k).map(measure));
      best = scored.sort((a, b) => b.score - a.score)[0];
      if (best) {
        const swaps = [];
        for (const out of best.ids) for (const inn of pool) if (!best.ids.includes(inn)) swaps.push(best.ids.map((x) => (x === out ? inn : x)));
        const s2 = await Promise.all(swaps.map(measure));
        const top = s2.sort((a, b) => b.score - a.score)[0];
        if (top && top.score > best.score) best = top;
      }
    }
    if (!best) break;
    prev = best.ids;
    out.push({ seats: k, level, heroes: best.ids.map(seat), median: best.median, beats: best.beats });
  }
  return out;
}

/** context for boardsOf from the banc data and the analysed heroes */
export function boardsContext(D, heroes) {
  return {
    heroes: new Map(D.heroes.map((h) => [h.id, h])), odds: D.shopOdds, prog: D.progressionCursed,
    kit: new Map(heroes.map((h) => [h.id, h.solo.kit])), strength: new Map(heroes.map((h) => [h.id, h.solo.kitMedian])),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { BancPool } = await import('./pool.mjs');
  const { makeBanc, loadWorkerSource } = await import('./banc.mjs');
  const { makeSetup } = await import('./setup.mjs');
  const meta = JSON.parse(fs.readFileSync('data/meta.json', 'utf8'));
  const dir = process.env.BANC_DIR ?? `cache/${meta.version}`;
  const workerPath = `${dir}/${fs.readdirSync(dir).find((f) => f.startsWith('sim.worker'))}`;
  const D = makeBanc(loadWorkerSource(workerPath)).data;
  const setup = makeSetup(D);
  const pool = new BancPool(workerPath);
  const tables = Math.round(1200 * (meta.scale ?? 0.5));
  const lean = (c) => ({ heroes: c.heroes.map((h) => ({ id: h.id, star: h.star, items: h.items })) });
  const full = (c, opts) => pool.run(setup(lean(c), opts), tables);
  const ctx = boardsContext(D, meta.heroes);
  await Promise.all(meta.comps.map(async (c) => { c.boards = await boardsOf(c, full, meta.settings.floors, ctx); }));
  pool.close();
  fs.writeFileSync('data/meta.json', JSON.stringify(meta));
  if (fs.existsSync('app/data.json')) {
    const app = JSON.parse(fs.readFileSync('app/data.json', 'utf8'));
    fs.writeFileSync('app/data.json', JSON.stringify({ ...app, meta }));
  }
  for (const c of meta.comps.slice(0, 4)) console.log(c.name, '\n ', c.boards.map((b) => `${b.seats} (niv ${b.level}): ${b.heroes.map((h) => `${h.id}${'★'.repeat(h.star)}`).join('+')} → boss ${b.beats}`).join('\n  '));
}
