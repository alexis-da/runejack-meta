// Full analysis of one game version with the official banc simulator. Writes data/meta.json.
// Budget is controlled by SCALE (default 0.5 ≈ 40 min on 4 cores; 1 = finer; 0.15 = quick test ≈ 14 min).
import fs from 'node:fs';
import { BancPool } from './pool.mjs';
import { makeBanc, loadWorkerSource } from './banc.mjs';
import { carryOf } from './carry.mjs';
import { MOMENTS, heroCounter, makeSetup } from './setup.mjs';

const SCALE = +(process.env.SCALE ?? 0.5);
const n = (x) => Math.max(40, Math.round(x * SCALE));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const RARITY = { 1: 'Commun', 2: 'Rare', 3: 'Épique', 4: 'Légendaire', 5: 'Secrète' };
export async function analyze({ version, workerPath, previous = null, out = 'data/meta.json' }) {
  const t0 = Date.now();
  const banc0 = makeBanc(loadWorkerSource(workerPath));
  const D = banc0.data;
  const HERO = new Map(D.heroes.map((h) => [h.id, h]));
  const fams = (id) => [HERO.get(id).trait, ...(HERO.get(id).extraTraits ?? [])];
  const star = (id) => (HERO.get(id).cost >= 4 ? 1 : 2);
  const REG = D.items.filter((i) => !i.contraband).map((i) => i.id);
  const CONTRA = D.items.filter((i) => i.contraband).map((i) => i.id);
  const FAMILIES = Object.keys(D.traits);
  const CURSE = 1; // pacte du Joueur (banc par défaut)

  const setup = makeSetup(D, CURSE);
  const pool = new BancPool(workerPath);
  const cache = new Map();
  // only what the simulator reads (evaluated comps also carry their results)
  const lean = (c) => ({ heroes: c.heroes.map((h) => (h ? { id: h.id, star: h.star, items: h.items } : null)), runes: Array.isArray(c.runes) ? c.runes : [], blessings: Array.isArray(c.blessings) ? c.blessings : [] });
  const med = (comp0, N, opts = {}) => {
    const comp = lean(comp0);
    const k = JSON.stringify([comp, N, opts]);
    if (!cache.has(k)) cache.set(k, pool.run(setup(comp, opts), N).then((r) => r.res.p50));
    return cache.get(k);
  };
  const full = (comp, N, opts = {}) => pool.run(setup(lean(comp), opts), N);

  // ---------- HP per pact ----------
  const probe = { heroes: [{ id: D.heroes[0].id, items: [] }, null, null, null, null] };
  const hp = {};
  for (const p of D.pacts) hp[p.level] = (await pool.run(setup(probe, { curse: p.level }), 20)).etages.map((e) => ({ etage: e.etage, vice: e.vice, petite: e.petite, grande: e.grande, boss: e.boss }));
  const FLOORS = D.hp?.anteHp?.length ?? 7;
  log('PV', FLOORS, 'étages');

  // ---------- A. hero kits (hero alone at seat 3) ----------
  const NK = n(150);
  const heroes = [];
  const itemFirst = new Map(REG.map((i) => [i, []]));
  await Promise.all(D.heroes.map(async (h) => {
    const solo = (items) => ({ heroes: [null, null, { id: h.id, items }, null, null] });
    const naked = await med(solo([]), NK);
    let kit = [], cur = naked;
    for (let s = 0; s < 3; s++) {
      const ms = await Promise.all(REG.map((it) => med(solo([...kit, it]), NK)));
      if (s === 0) REG.forEach((it, k) => itemFirst.get(it).push({ hero: h.id, gain: naked > 0 ? ms[k] / naked - 1 : 0 }));
      const bi = ms.indexOf(Math.max(...ms));
      kit.push(REG[bi]); cur = ms[bi];
    }
    const contra = await Promise.all(CONTRA.map(async (c) => {
      let best = 0;
      for (let s = 0; s < 3; s++) { const k2 = [...kit]; k2[s] = c; best = Math.max(best, await med(solo(k2), NK)); }
      return { id: c, gain: cur > 0 ? best / cur - 1 : 0 };
    }));
    contra.sort((a, b) => b.gain - a.gain);
    heroes.push({
      id: h.id, name: h.name, cost: h.cost, rarity: RARITY[h.cost] ?? '', families: fams(h.id), unique: h.unique ?? null,
      effects: { 1: h.describe(1, 0), 2: h.describe(2, 0), 3: h.describe(3, 0) },
      grows: heroCounter(h.id, MOMENTS.fin) !== undefined,
      solo: { star: star(h.id), naked, kit, kitMedian: cur, contraband: contra.slice(0, 3) },
    });
  }));
  heroes.sort((a, b) => b.solo.kitMedian - a.solo.kitMedian);
  log('A. kits par héros', `${((Date.now() - t0) / 60000).toFixed(1)} min`);

  // ---------- B. comp search (GA + local search) ----------
  const kitOf = Object.fromEntries(heroes.map((h) => [h.id, h.solo.kit]));
  const templates = [];
  for (const f of FAMILIES) {
    const fam = heroes.filter((h) => h.families.includes(f));
    if (fam.length >= 5) templates.push({ name: `Banco ${D.traits[f].name}`, family: f, heroes: fam.slice(0, 5).map((h) => ({ id: h.id, items: kitOf[h.id] })) });
  }
  const prevComps = (previous?.comps ?? []).filter((c) => c.heroes.every((h) => HERO.has(h.id) && h.items.every((i) => REG.includes(i))))
    .map((c) => ({ name: c.name, heroes: c.heroes.map((h) => ({ id: h.id, items: h.items })) }));
  const HEROES = D.heroes.map((h) => h.id);
  let rs = 20261020 >>> 0;
  const rnd = () => ((rs = (Math.imul(rs ^ (rs >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const toG = (c) => ({ heroes: c.heroes.map((h) => h.id), items: c.heroes.map((h) => [...h.items, ...REG].slice(0, 3)) });
  const toC = (g) => ({ heroes: g.heroes.map((id, i) => ({ id, items: g.items[i] })) });
  const key = (g) => g.heroes.map((h, i) => `${h}[${g.items[i].join('+')}]`).join(' ');
  const clone = (g) => ({ heroes: [...g.heroes], items: g.items.map((x) => [...x]) });
  const NF = n(300);
  const fitCache = new Map();
  const fit = (g) => { const k = key(g); if (!fitCache.has(k)) fitCache.set(k, med(toC(g), NF)); return fitCache.get(k); };

  async function search({ exclude = [], pop = 40, gens = Math.max(4, Math.round(15 * SCALE)), tops = 3, rounds = 2, label }) {
    const H = HEROES.filter((h) => !exclude.includes(h));
    const randomG = () => {
      let hs = [];
      if (rnd() < 0.6) { const f = pick(FAMILIES); hs = H.filter((h) => fams(h).includes(f)).sort(() => rnd() - 0.5).slice(0, 3 + Math.floor(rnd() * 3)); }
      while (hs.length < 5) { const h = pick(H); if (!hs.includes(h)) hs.push(h); }
      hs.sort(() => rnd() - 0.5);
      return { heroes: hs, items: hs.map((h) => (rnd() < 0.5 ? [...kitOf[h]] : [pick(REG), pick(REG), pick(REG)])) };
    };
    const mutate = (g) => {
      const c = clone(g), r = rnd();
      if (r < 0.4) c.items[Math.floor(rnd() * 5)][Math.floor(rnd() * 3)] = pick(REG);
      else if (r < 0.65) { const i = Math.floor(rnd() * 5); let h; do h = pick(H); while (c.heroes.includes(h)); c.heroes[i] = h; c.items[i] = [...kitOf[h]]; }
      else { const i = Math.floor(rnd() * 5), j = Math.floor(rnd() * 5); [c.heroes[i], c.heroes[j]] = [c.heroes[j], c.heroes[i]]; [c.items[i], c.items[j]] = [c.items[j], c.items[i]]; }
      return c;
    };
    const cross = (a, b) => {
      const c = { heroes: [], items: [] };
      for (let i = 0; i < 5; i++) {
        let s = rnd() < 0.5 ? a : b, h = s.heroes[i], it = s.items[i];
        if (c.heroes.includes(h)) { s = s === a ? b : a; h = s.heroes[i]; it = s.items[i]; }
        if (c.heroes.includes(h)) { do h = pick(H); while (c.heroes.includes(h)); it = kitOf[h]; }
        c.heroes.push(h); c.items.push([...it]);
      }
      return c;
    };
    let P = [...prevComps, ...templates].filter((c) => !c.heroes.some((h) => exclude.includes(h.id))).map(toG);
    while (P.length < pop) P.push(randomG());
    for (let g = 0; g < gens; g++) {
      const f = await Promise.all(P.map((x) => fit(x)));
      const R = P.map((x, i) => ({ x, f: f[i] })).sort((a, b) => b.f - a.f);
      const parents = R.slice(0, pop / 2).map((r) => r.x);
      P = R.slice(0, 6).map((r) => r.x);
      while (P.length < pop) { const r = rnd(); P.push(r < 0.1 ? randomG() : r < 0.45 ? mutate(cross(pick(parents), pick(parents))) : mutate(pick(parents))); }
      if (g % 5 === 4 || g === gens - 1) log(`  ${label} gén. ${g + 1}: ${Math.round(R[0].f)} ${key(R[0].x)}`);
    }
    const R = (await Promise.all(P.map(async (x) => ({ x, f: await fit(x) })))).sort((a, b) => b.f - a.f);
    const distinct = [];
    for (const r of R) if (!distinct.some((d) => d.x.heroes.filter((h) => r.x.heroes.includes(h)).length >= 4)) distinct.push(r);
    const finals = [];
    for (const t of distinct.slice(0, tops)) {
      let g = t.x, f = t.f;
      for (let round = 0; round < rounds; round++) {
        const cands = [];
        for (let i = 0; i < 5; i++) for (let s = 0; s < 3; s++) for (const it of REG) if (it !== g.items[i][s]) { const c = clone(g); c.items[i][s] = it; cands.push(c); }
        for (let i = 0; i < 5; i++) for (const h of H) if (!g.heroes.includes(h)) { const c = clone(g); c.heroes[i] = h; c.items[i] = [...kitOf[h]]; cands.push(c); }
        for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) { const c = clone(g); [c.heroes[i], c.heroes[j]] = [c.heroes[j], c.heroes[i]]; [c.items[i], c.items[j]] = [c.items[j], c.items[i]]; cands.push(c); }
        const fs2 = await Promise.all(cands.map(fit));
        let bi = -1; fs2.forEach((x, i) => { if (x > f * 1.01) { f = x; bi = i; } });
        if (bi < 0) break;
        g = cands[bi];
      }
      log(`  ${label} affinée: ${Math.round(f)} ${key(g)}`);
      finals.push(g);
    }
    return finals;
  }
  const best = await search({ label: 'recherche' });
  const keyHero = (() => { // the hero the best comp depends on most (largest drop when removed)
    const g = best[0]; return Promise.all(g.heroes.map(async (h, i) => { const c = clone(g); c.heroes[i] = null; return { h, f: await med({ heroes: c.heroes.map((id, k) => (id ? { id, items: c.items[k] } : null)) }, NF) }; })).then((r) => r.sort((a, b) => a.f - b.f)[0].h);
  })();
  const pivot = await keyHero;
  const alt = await search({ exclude: [pivot], label: `sans ${HERO.get(pivot).name}`, tops: 2 });
  log('B. recherche', `${((Date.now() - t0) / 60000).toFixed(1)} min`);

  // ---------- C. final evaluation ----------
  const NE = n(1500), NB = n(400);
  // readable names: dominant family + the heroes in seat order
  const nameOf = (g) => {
    const cnt = {};
    for (const h of g.heroes) for (const f of fams(h)) cnt[f] = (cnt[f] ?? 0) + 1;
    const [f] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    return `${D.traits[f].name} : ${g.heroes.slice(0, 3).map((h) => HERO.get(h).name).join(', ')}…`;
  };
  const finalComps = [
    ...best.map((g) => ({ name: nameOf(g), origin: 'recherche', ...toC(g) })),
    ...alt.map((g) => ({ name: nameOf(g), origin: 'recherche', note: `sans ${HERO.get(pivot).name}`, ...toC(g) })),
    ...templates.map((t) => ({ name: t.name, origin: 'banco', family: t.family, heroes: t.heroes })),
  ];
  const evalComp = async (c) => {
    const [fin, mil] = await Promise.all([full(c, NE), full(c, NE, { moment: 'milieu' })]);
    const bosses = await Promise.all(D.bosses.map(async (b) => {
      const r = await full(c, NB, { boss: b.id });
      return { id: b.id, ratio: fin.res.p50 > 0 ? r.res.p50 / fin.res.p50 : 0, killFinal: r.etages.find((e) => e.etage === FLOORS)?.tueBoss ?? 0 };
    }));
    const fams2 = {};
    for (const h of c.heroes) for (const f of fams(h.id)) fams2[f] = (fams2[f] ?? 0) + 1;
    return {
      ...c,
      heroes: c.heroes.map((h) => ({ ...h, star: star(h.id) })),
      families: fams2,
      fin: { mean: fin.res.damage, median: fin.res.p50, p10: fin.res.p10, p90: fin.res.p90, tenu: fin.tenuBoss, banco: fin.res.banco, bust: fin.res.bust, win: fin.res.win,
        kill: Object.fromEntries(fin.etages.map((e) => [e.etage, e.tueBoss])) },
      milieu: { median: mil.res.p50, tenu: mil.tenuBoss, kill: Object.fromEntries(mil.etages.map((e) => [e.etage, e.tueBoss])) },
      bosses,
    };
  };
  let comps = await Promise.all(finalComps.map(evalComp));
  comps.sort((a, b) => b.fin.median - a.fin.median);
  // dedupe identical cores
  comps = comps.filter((c, i) => comps.findIndex((d) => d.heroes.map((h) => h.id).sort().join() === c.heroes.map((h) => h.id).sort().join()) === i);
  const tierOf = (t) => (t >= FLOORS + 2 ? 'S' : t >= FLOORS + 1.3 ? 'A' : t >= FLOORS + 0.7 ? 'B' : t >= FLOORS + 0.2 ? 'C' : 'D');
  for (const c of comps) {
    c.tier = tierOf(c.fin.tenu);
    c.growthDependent = c.milieu.median < 0.7 * c.fin.median;
    c.cheap = c.heroes.every((h) => HERO.get(h.id).cost <= 3);
  }
  // carry: the hero whose items matter most
  await Promise.all(comps.map(async (c) => Object.assign(c, await carryOf(c, (heroes) => med({ heroes }, n(3000))))));
  log('C. évaluation', `${((Date.now() - t0) / 60000).toFixed(1)} min`);

  // ---------- D. contraband upgrades per comp ----------
  const NC = n(300);
  for (const c of comps.slice(0, 6)) {
    const base = await med(c, NC);
    const opts = [];
    await Promise.all(c.heroes.map((h, i) => Promise.all(CONTRA.map(async (it) => {
      let best2 = 0, slot = -1;
      for (let s = 0; s < 3; s++) {
        const c2 = { heroes: c.heroes.map((x, j) => (j === i ? { ...x, items: Object.assign([...x.items, '', '', ''].slice(0, 3), { [s]: it }) } : x)) };
        const m = await med(c2, NC);
        if (m > best2) { best2 = m; slot = s; }
      }
      opts.push({ seat: i, hero: h.id, item: it, replaces: c.heroes[i].items[slot] ?? null, gain: base > 0 ? best2 / base - 1 : 0 });
    }))));
    opts.sort((a, b) => b.gain - a.gain);
    c.contraband = opts.slice(0, 4);
  }
  log('D. contrebande', `${((Date.now() - t0) / 60000).toFixed(1)} min`);

  // ---------- E. runes and blessings ----------
  const NR = n(400);
  for (const c of comps.slice(0, 3)) {
    const base = await med({ heroes: c.heroes }, NR);
    const single = await Promise.all(D.runes.map(async (r) => ({ id: r.id, gain: base > 0 ? (await med({ heroes: c.heroes, runes: [r.id] }, NR)) / base - 1 : 0 })));
    single.sort((a, b) => b.gain - a.gain);
    const chosen = [];
    let cur = base;
    for (let s = 0; s < 6; s++) {
      const cand = D.runes.filter((r) => r.rarity !== 'secrete' && !chosen.includes(r.id));
      const ms = await Promise.all(cand.map((r) => med({ heroes: c.heroes, runes: [...chosen, r.id] }, NR)));
      const bi = ms.indexOf(Math.max(...ms));
      chosen.push(cand[bi].id); cur = ms[bi];
    }
    c.runes = { single: single.slice(0, 15), worst: single.slice(-5), build: chosen, buildGain: base > 0 ? cur / base - 1 : 0 };
  }
  for (const c of comps.slice(0, 6)) {
    const base = await med({ heroes: c.heroes }, NR);
    const b = await Promise.all(D.blessings.map(async (x) => ({ id: x.id, gain: base > 0 ? (await med({ heroes: c.heroes, blessings: [x.id] }, NR)) / base - 1 : 0 })));
    c.blessings = b.sort((a, b2) => b2.gain - a.gain);
  }
  log('E. runes et bénédictions', `${((Date.now() - t0) / 60000).toFixed(1)} min`);

  // ---------- F. openers (early game: cheap heroes, no items, milieu) ----------
  const openers = [];
  for (const f of FAMILIES) {
    const cheap = heroes.filter((h) => h.families.includes(f) && h.cost <= 2).sort((a, b) => b.solo.naked - a.solo.naked);
    if (cheap.length < 3) continue;
    const pickH = cheap.slice(0, 5).map((h) => h.id);
    while (pickH.length < 5) { const o = heroes.find((h) => h.cost <= 2 && !pickH.includes(h.id)); pickH.push(o.id); }
    const c = { heroes: pickH.map((id) => ({ id, items: [] })) };
    for (const seats of [3, 5]) {
      const cc = { heroes: c.heroes.map((h, i) => (i < seats ? h : null)) };
      const r = await full(cc, n(600), { moment: 'milieu', curse: CURSE });
      openers.push({ family: f, seats, heroes: pickH.slice(0, seats), median: r.res.p50, kill: Object.fromEntries(r.etages.slice(0, 5).map((e) => [e.etage, e.tueBoss])) });
    }
  }
  openers.sort((a, b) => b.median - a.median);
  log('F. débuts de partie', `${((Date.now() - t0) / 60000).toFixed(1)} min`);

  // ---------- items summary ----------
  const items = D.items.map((i) => {
    const g = itemFirst.get(i.id) ?? [];
    const sorted = [...g].sort((a, b) => b.gain - a.gain);
    const holders = heroes.filter((h) => h.solo.kit.includes(i.id)).map((h) => h.id);
    const price = i.price ?? (i.emblem || i.royalSeal ? D.economy.itemPriceFamily : D.economy.itemPrice);
    const stats = Object.fromEntries(['base', 'mult', 'maxTotalBonus', 'bustRatio', 'goldPerTable', 'discardBonus', 'freeDiscards', 'interestBonus'].filter((k) => i[k]).map((k) => [k, i[k]]));
    const inComps = comps.filter((c) => c.heroes.some((h) => h.items.includes(i.id))).map((c) => c.name);
    return { id: i.id, name: i.name, desc: i.desc, price, contraband: !!i.contraband, emblem: i.emblem ?? null, stats,
      avgGain: g.length ? g.reduce((s, x) => s + x.gain, 0) / g.length : null, bestFor: sorted.slice(0, 5).map((x) => ({ hero: x.hero, gain: x.gain })), inKits: holders, inComps };
  });
  // contraband: best heroes from hero study
  for (const it of items.filter((x) => x.contraband)) it.bestFor = heroes.map((h) => ({ hero: h.id, gain: h.solo.contraband.find((c) => c.id === it.id)?.gain ?? 0 })).sort((a, b) => b.gain - a.gain).slice(0, 5);

  pool.close();
  const meta = {
    version, generatedAt: new Date().toISOString(), minutes: (Date.now() - t0) / 60000, scale: SCALE, roomsSimulated: pool.count,
    settings: { pact: D.pacts.find((p) => p.level === CURSE)?.title ?? 'Pacte du Joueur', moments: MOMENTS, stars: 'coût 4-5 à 1★, sinon 2★', policy: 'bot du jeu', floors: FLOORS },
    economy: D.economy, progression: { guest: D.progressionGuest, cursed: D.progressionCursed }, hpRules: D.hp, hp,
    pacts: D.pacts.map((p) => ({ level: p.level, name: p.name, title: p.title, desc: p.desc, gift: p.gift ?? '', hpMult: p.hpMult, bossHpMult: p.bossHpMult })),
    traits: Object.values(D.traits).map((t) => ({ id: t.id, name: t.name, tiers: t.tiers })),
    heroes, items,
    runes: D.runes.map((r) => ({ id: r.id, name: r.name, rarity: r.rarity, desc: r.desc })),
    blessings: D.blessings.map((b) => ({ id: b.id, name: b.name, desc: b.desc, fromAnte: b.fromAnte ?? null })),
    bosses: D.bosses.map((b) => ({ id: b.id, name: b.name, vice: b.vice, desc: b.desc, rules: b.rules, strong: b.strong, weak: b.weak, level: b.level })),
    comps, pivot, openers,
  };
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(out, JSON.stringify(meta));
  log(`terminé en ${meta.minutes.toFixed(1)} min, ${meta.roomsSimulated.toLocaleString('fr-FR')} salles`);
  return meta;
}
