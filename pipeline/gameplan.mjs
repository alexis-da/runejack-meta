// Game plan of each comp: whole runs (Pacte du Joueur) played on the game's own run engine by the run
// bot, with several strategies; the best one is kept and summarised floor by floor (level, invocations,
// XP, gold kept, heroes owned, survival). Run directly to add the plans to the existing data/meta.json.
import fs from 'node:fs';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { makeBanc, loadWorkerSource } from './banc.mjs';
import { makeRunBot, PLANS } from './runbot.mjs';

export const PLAN_LABELS = {
  eco: 'Économe : garder 30 or pour les intérêts',
  equilibre: 'Équilibré : garder 20 or',
  tempo: 'Tempo : monter de niveau dès que possible',
  depart: 'Départ à fond : tout dépenser à l’étage 1, puis garder 20 or',
  relance: 'Équilibré avec relances de la boutique',
};
const CURSE = 1;

if (!isMainThread && workerData?.gameplan) {
  const b = makeBanc(loadWorkerSource(workerData.workerPath));
  const ctx = { Run: b.data.Run, playDeal: b.data.playDeal, heroes: new Map(b.data.heroes.map((h) => [h.id, h])), strength: new Map(workerData.strength), early: new Map(workerData.early) };
  parentPort.on('message', ({ jid, target, plan, seeds }) => {
    try {
      const out = [];
      for (let s = seeds[0]; s < seeds[1]; s++) {
        const run = new ctx.Run(s, 0, CURSE, 'classique');
        out.push(makeRunBot(ctx, target, PLANS[plan]).play(run));
      }
      parentPort.postMessage({ jid, out });
    } catch (e) { parentPort.postMessage({ jid, error: String(e?.stack ?? e) }); }
  });
}

// early strength: each hero alone at 1★, no item, start of a run
export function earlyStrength(banc) {
  return banc.data.heroes.map((h) => {
    const r = banc.run({ seats: [{ id: h.id, star: 1, items: [] }], runes: [], gold: 4, deck: 'classique', curse: CURSE, policy: 'normal', blessings: [] }, 300);
    return { id: h.id, cost: h.cost, median: r.result.p50, killSmall: r.etages[0].tuePetite, killBoss: r.etages[0].tueBoss };
  }).sort((a, b) => b.median - a.median);
}

const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function summarise(results, target, floors) {
  const T = target.heroes.map((h) => h.id);
  const out = [];
  for (let f = 1; f <= floors; f++) {
    const reached = results.filter((r) => r.won || r.floor >= f);
    if (!reached.length) break;
    const survived = reached.filter((r) => r.won || r.floor > f);
    const logs = reached.map((r) => r.log.find((l) => l.floor === f)).filter((l) => l && l.board);
    const packs = {};
    for (const l of logs) for (const [k, v] of Object.entries(l.packs)) packs[k] = (packs[k] ?? 0) + v / logs.length;
    const traits = {};
    for (const l of logs) for (const [k, v] of Object.entries(l.traits ?? {})) traits[k] = (traits[k] ?? 0) + v / logs.length;
    const seated = {};
    for (const l of logs) for (const c of l.board) if (c) seated[c.id] = (seated[c.id] ?? 0) + 1 / logs.length;
    const targetOwned = T.map((id) => {
      const stars = logs.map((l) => l.board.find((c) => c?.id === id)?.star ?? 0);
      return { id, seated: stars.filter(Boolean).length / Math.max(1, logs.length), star: mean(stars.filter(Boolean)) };
    });
    out.push({
      floor: f, reached: reached.length / results.length, survival: survived.length / reached.length,
      level: med(logs.map((l) => l.level)), seats: med(logs.map((l) => l.board.length)),
      gold: med(logs.map((l) => l.gold)), essence: med(logs.map((l) => l.essence)),
      xp: mean(logs.map((l) => l.xp)), items: mean(logs.map((l) => l.items)), rerolls: mean(logs.map((l) => l.rerolls)), packs, traits,
      targetOwned,
      // heroes seated that are not in the target: the transition heroes of this floor
      transition: Object.entries(seated).filter(([id]) => !T.includes(id)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, share]) => ({ id, share })),
    });
  }
  return out;
}

/** Adds comp.gameplan to each comp and meta.firstPicks. */
export async function addGameplans(meta, workerPath, { runs = 300, log = console.log } = {}) {
  const banc = makeBanc(loadWorkerSource(workerPath));
  const early = earlyStrength(banc);
  const maxE = Math.max(...early.map((x) => x.median));
  const maxS = Math.max(...meta.heroes.map((h) => h.solo.naked));
  const n = Math.max(1, os.cpus().length);
  const ws = Array.from({ length: n }, () => new Worker(new URL(import.meta.url), {
    workerData: { gameplan: true, workerPath, strength: meta.heroes.map((h) => [h.id, h.solo.naked / maxS]), early: early.map((x) => [x.id, x.median / maxE]) }, execArgv: [] }));
  const idle = [...ws], q = [], cb = new Map();
  let jid = 0;
  const pump = () => { while (idle.length && q.length) idle.pop().postMessage(q.shift()); };
  for (const w of ws) w.on('message', (m) => { idle.push(w); const f = cb.get(m.jid); cb.delete(m.jid); f(m); pump(); });
  const job = (target, plan, seeds) => new Promise((res, rej) => { const id = ++jid; cb.set(id, (m) => (m.error ? rej(new Error(m.error)) : res(m.out))); q.push({ jid: id, target, plan, seeds }); pump(); });
  const play = async (target, plan) => (await Promise.all(Array.from({ length: Math.ceil(runs / 25) }, (_, k) => job(target, plan, [1 + 25 * k, 1 + Math.min(runs, 25 * (k + 1))])))).flat();

  const floors = meta.settings?.floors ?? 7;
  await Promise.all(meta.comps.map(async (c) => {
    const target = { heroes: c.heroes.map((h) => ({ id: h.id, items: h.items })), runes: c.runes?.build ?? meta.comps[0].runes?.build ?? [], blessings: (c.blessings ?? meta.comps[0].blessings ?? []).map((x) => x.id) };
    const byPlan = {};
    for (const plan of Object.keys(PLANS)) {
      const res = await play(target, plan);
      byPlan[plan] = { res, win: mean(res.map((r) => (r.won ? 1 : 0))) };
    }
    const [best] = Object.entries(byPlan).sort((a, b) => b[1].win - a[1].win);
    c.gameplan = {
      plan: best[0], winRate: best[1].win, runs,
      plans: Object.fromEntries(Object.entries(byPlan).map(([k, v]) => [k, v.win])),
      floors: summarise(best[1].res, target, floors),
    };
    log(`  ${c.name} : ${best[0]} ${(100 * best[1].win).toFixed(0)} % de victoires`);
  }));
  for (const w of ws) w.terminate();
  meta.firstPicks = early.slice(0, 12);
  meta.planLabels = PLAN_LABELS;
  return meta;
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) {
  const meta = JSON.parse(fs.readFileSync('data/meta.json', 'utf8'));
  const dir = `cache/${meta.version}`;
  const workerPath = `${dir}/${fs.readdirSync(dir).find((f) => f.startsWith('sim.worker'))}`;
  const t0 = Date.now();
  await addGameplans(meta, workerPath, { runs: +(process.env.RUNS ?? 300) });
  fs.writeFileSync('data/meta.json', JSON.stringify(meta));
  if (fs.existsSync('app/data.json')) {
    const app = JSON.parse(fs.readFileSync('app/data.json', 'utf8'));
    fs.writeFileSync('app/data.json', JSON.stringify({ ...app, meta }));
  }
  console.log(`terminé en ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
