// Full-run bot on the game's own run engine (the run class inside the banc worker). The tables are
// played by the game's bot (policy "normal"); this file only makes the between-table decisions toward a
// target comp: which invocation (pack) to open and when, which card to keep, XP, stall items, seats,
// runes and blessings. Strategy knobs are in `params` so several game plans can be compared.
//
// target = { heroes: [{ id, items }], runes: [ids by priority], blessings: [ids by priority] }
// ctx = { Run, playDeal, heroes: Map(id -> def), strength: Map(id -> number), traits }

export const PLANS = {
  // keep 30 gold for interest (essence), spend essence on the most useful invocations
  eco: { reserve: 30, reserveFrom: 0, minValue: 0.03, threeStarMaxCost: 1, reroll: false },
  // keep 20 gold
  equilibre: { reserve: 20, reserveFrom: 0, minValue: 0.03, threeStarMaxCost: 1, reroll: false },
  // level as fast as gold allows
  tempo: { reserve: 0, reserveFrom: 0, minValue: 0.03, threeStarMaxCost: 1, reroll: false },
  // floor 1 all-in (XP and invocations), then keep 20 gold
  depart: { reserve: 20, reserveFrom: 3, minValue: 0.03, threeStarMaxCost: 1, reroll: false },
  // keep 20 gold, reroll the shop for better invocations
  relance: { reserve: 20, reserveFrom: 0, minValue: 0.03, threeStarMaxCost: 1, reroll: true },
};

const fams = (def) => [def.trait, ...(def.extraTraits ?? [])];

export function makeRunBot(ctx, target, params = PLANS.equilibre) {
  const { heroes: HERO, strength } = ctx;
  const T = target.heroes.map((h) => h.id);
  const kitOf = Object.fromEntries(target.heroes.map((h) => [h.id, h.items ?? []]));
  const famWeight = {};
  for (const id of T) for (const f of fams(HERO.get(id))) famWeight[f] = (famWeight[f] ?? 0) + 1;
  const runeRank = (id) => { const k = (target.runes ?? []).indexOf(id); return k < 0 ? 100 : k; };
  const blessRank = (id) => { const k = (target.blessings ?? []).indexOf(id); return k < 0 ? 100 : k; };

  // value of an owned hero / a pack card for this target. Early on (floors 1-2) raw strength at 1★ wins
  // rooms; from floor 3 the target comp takes over.
  let phase = 0;
  const heroValue = (defId, star) => {
    const def = HERO.get(defId);
    const syn = fams(def).reduce((s, f) => s + (famWeight[f] ?? 0), 0);
    const tgt = T.includes(defId) ? 60 + 10 * (5 - T.indexOf(defId)) : 0;
    const late = (strength.get(defId) ?? 0) * 3 ** (star - 1) * 20;
    const early = (ctx.early?.get(defId) ?? 0) * 3 ** (star - 1) * 60;
    return phase * (tgt + syn * 4 + late) + (1 - phase) * (early + tgt * 0.25 + syn);
  };
  const owned = (run) => [...run.board, ...run.bench].filter(Boolean);
  const cardValue = (run, card) => {
    const same = owned(run).filter((c) => c.defId === card.defId && c.star === 1).length;
    return heroValue(card.defId, 1) + (same >= 2 ? 80 : same === 1 ? 15 : 0) + (card.holo ? 3 : 0) + (card.shiny ? 5 : 0);
  };
  const missing = (run) => T.filter((id) => !owned(run).some((c) => c.defId === id));

  // log of what happened on each floor (for the game-plan summary)
  const log = [];
  const floorLog = (run) => {
    const f = Math.floor(run.tableIndex / 3) + 1;
    return (log[f] ??= { floor: f, packs: {}, traits: {}, xp: 0, items: 0, rerolls: 0, sold: 0 });
  };

  function takePack(run) {
    let guard = 0;
    while (run.pendingPack && run.canPickFromPack() && guard++ < 5) {
      const cards = run.pendingPack.map((c, i) => ({ i, v: cardValue(run, c) })).sort((a, b) => b.v - a.v);
      const best = cards[0];
      if (run.packCardFits(best.i)) { run.pickFromPack(best.i); continue; }
      // full team: replace the weakest hero if the card is clearly better
      const all = [];
      run.board.forEach((c, index) => c && all.push({ slot: { area: 'board', index }, v: heroValue(c.defId, c.star) }));
      run.bench.forEach((c, index) => c && all.push({ slot: { area: 'bench', index }, v: heroValue(c.defId, c.star) }));
      all.sort((a, b) => a.v - b.v);
      if (all.length && all[0].v < best.v - 5) run.pickFromPack(best.i, all[0].slot);
      else run.skipPack();
    }
  }

  // family to ask for with the targeted invocation: the one holding the most missing target heroes
  const bestFamily = (run) => {
    const score = {};
    for (const id of missing(run).length ? missing(run) : T) for (const f of fams(HERO.get(id))) score[f] = (score[f] ?? 0) + 1;
    return Object.entries(score).sort((a, b) => b[1] - a[1])[0]?.[0];
  };

  function runesAndBlessings(run) {
    if (run.runeChoice && run.canPickRune()) {
      const pick = run.runeChoice.map((id, i) => ({ i, r: runeRank(id) })).sort((a, b) => a.r - b.r)[0];
      if (run.runes.length < run.runeSlots()) run.pickRune(pick.i);
      else {
        const worst = run.runes.map((x, k) => ({ k, r: runeRank(x.defId) })).sort((a, b) => b.r - a.r)[0];
        if (worst.r > pick.r) run.pickRune(pick.i, worst.k); else run.skipRune();
      }
    }
    while (run.blessingChoice && run.canPickBlessing()) {
      const pick = run.blessingChoice.map((id, i) => ({ i, r: blessRank(id) })).sort((a, b) => a.r - b.r)[0];
      run.pickBlessing(pick.i);
    }
  }

  // seat the best heroes (distinct first), target heroes in their target order
  function arrange(run) {
    const n = run.board.length;
    const all = owned(run).sort((a, b) => heroValue(b.defId, b.star) - heroValue(a.defId, a.star));
    const chosen = [];
    for (const c of all) if (chosen.length < n && !chosen.some((x) => x.defId === c.defId)) chosen.push(c);
    for (const c of all) if (chosen.length < n && !chosen.includes(c)) chosen.push(c);
    chosen.sort((a, b) => (T.includes(a.defId) ? T.indexOf(a.defId) : 9) - (T.includes(b.defId) ? T.indexOf(b.defId) : 9));
    for (let i = 0; i < n; i++) {
      const want = chosen[i];
      if (!want || run.board[i]?.uid === want.uid) continue;
      const from = run.slotOf ? run.slotOf(want.uid) : slotOf(run, want.uid);
      run.move(from, { area: 'board', index: i });
    }
  }
  const slotOf = (run, uid) => {
    let i = run.board.findIndex((c) => c?.uid === uid);
    if (i >= 0) return { area: 'board', index: i };
    i = run.bench.findIndex((c) => c?.uid === uid);
    return { area: 'bench', index: i };
  };

  // stall items: kit items of seated target heroes first, then of the carry-to-be
  function gear(run, fl) {
    const holderFor = (it) => {
      for (const [i, c] of run.board.entries()) {
        if (!c || (c.items ?? []).length >= 3) continue;
        const kit = [...(kitOf[c.defId] ?? [])];
        for (const x of c.items ?? []) { const k = kit.indexOf(x); if (k >= 0) kit.splice(k, 1); }
        if (kit.includes(it)) return { area: 'board', index: i };
      }
      return null;
    };
    // equip items already in the inventory
    for (let k = run.items.length - 1; k >= 0; k--) {
      const slot = holderFor(run.items[k]);
      if (slot && run.canEquip(k, slot)) run.equip(k, slot);
    }
    for (const [k, o] of run.itemShop.entries()) {
      if (o.sold || run.gold - 8 < params.reserve / 2) continue; // stall items: half the reserve
      const slot = holderFor(o.id);
      if (slot && run.canBuyItemOn(k, slot)) { run.buyItemOn(k, slot); fl.items++; }
    }
  }

  // copies still wanted per target hero: 2★ needs 3 copies, 3★ needs 9
  const needs = (run) => {
    const out = [];
    for (const id of T) {
      const have = owned(run).filter((c) => c.defId === id).reduce((s, c) => s + 3 ** (c.star - 1), 0);
      const want = 3 ** ((HERO.get(id).cost <= params.threeStarMaxCost ? 3 : 2) - 1);
      if (have < want) out.push({ id, copies: want - have, first: have === 0 });
    }
    return out;
  };
  // expected useful cards per essence for an offer (3 cards, cost rolled with the level's odds)
  const ALL = [...HERO.values()];
  const RARE_ODDS = [0, 60, 30, 8, 2];
  const offerValue = (run, o, trait) => {
    const pool = o.pack === 'famille' || o.pack === 'cible' ? ALL.filter((h) => fams(h).includes(trait)) : ALL;
    const odds = o.pack === 'rare' ? RARE_ODDS : run.shopOdds();
    let v = 0;
    for (const n of needs(run)) {
      const h = HERO.get(n.id);
      if (!pool.includes(h)) continue;
      const k = pool.filter((x) => x.cost === h.cost).length;
      v += Math.min(1, (3 * (odds[h.cost - 1] ?? 0)) / 100 / k) * (n.first ? 2 : 1);
    }
    return v / run.offerPrice(o, trait).essence;
  };
  const bestTrait = (run) => {
    const traits = Object.keys(famWeight);
    return traits.map((t) => ({ t, v: offerValue(run, { pack: 'cible' }, t) })).sort((a, b) => b.v - a.v)[0]?.t;
  };

  function shop(run) {
    phase = Math.max(0, Math.min(1, (run.tableIndex - 3) / 6));
    const fl = floorLog(run);
    takePack(run);
    runesAndBlessings(run);
    if (run.trader) run.dismissTrader(); // contraband stays out of the comps
    // floor 1: everything goes into seats and heroes (a lost room ends the run); the reserve starts after
    const reserve = run.tableIndex < params.reserveFrom ? 0 : params.reserve;
    for (let guard = 0; guard < 60; guard++) {
      takePack(run);
      const empty = run.board.includes(null) && run.bench.every((c) => c === null);
      const fam = bestTrait(run);
      // 1. invocations (essence): the most useful cards per essence, or anything to fill an empty seat
      const offers = run.shop.map((o, i) => ({ o, i, t: o.pack === 'cible' ? fam : o.trait }))
        .filter(({ o, i, t }) => !o.sold && !run.buyBlocker(i, o.pack === 'cible' ? t : undefined))
        .map((x) => ({ ...x, v: offerValue(run, x.o, x.t) + (empty ? (x.o.pack === 'marche' ? 1 : 0.5) : 0) }))
        .sort((a, b) => b.v - a.v);
      const best = offers[0];
      if (best && best.v >= params.minValue) {
        run.buy(best.i, best.o.pack === 'cible' ? best.t : undefined);
        fl.packs[best.o.pack] = (fl.packs[best.o.pack] ?? 0) + 1;
        if (best.o.pack === 'cible' || best.o.pack === 'famille') fl.traits[best.t] = (fl.traits[best.t] ?? 0) + 1;
        takePack(run);
        continue;
      }
      // 2. XP (gold), keeping the interest reserve
      if (run.canBuyXp() && run.gold - 5 >= reserve) { run.buyXp(); fl.xp++; continue; }
      // 3. reroll the shop for better offers when rich in both gold and essence
      if (params.reroll && needs(run).length && run.canReroll() && run.gold - run.rerollCost() >= reserve && run.essence >= 5) { run.reroll(); fl.rerolls++; continue; }
      break;
    }
    // sell bench heroes that will never be seated (essence), keep target heroes and merge material
    for (const [i, c] of run.bench.entries()) {
      if (!c || T.includes(c.defId)) continue;
      const copies = owned(run).filter((x) => x.defId === c.defId).length;
      if (copies >= 2) continue;
      const worstSeated = Math.min(...run.board.filter(Boolean).map((x) => heroValue(x.defId, x.star)));
      if (run.board.every(Boolean) && heroValue(c.defId, c.star) < worstSeated) { run.sellChampion({ area: 'bench', index: i }); fl.sold++; }
    }
    arrange(run);
    gear(run, fl);
    fl.level = run.level; fl.gold = run.gold; fl.essence = run.essence;
    fl.board = run.board.map((c) => (c ? { id: c.defId, star: c.star, items: [...(c.items ?? [])] } : null));
  }

  function table(run) {
    phase = Math.max(0, Math.min(1, (run.tableIndex - 3) / 6));
    if (run.betOffer) run.declineBet?.();
    takePack(run);
    if (run.phase === 'table' && run.board.some(Boolean)) arrange0(run);
    let guard = 0;
    while (run.phase === 'table' && run.table.canDeal() && guard++ < 30) ctx.playDeal(run, 'normal');
  }
  // the very first table: seat the free invocation's hero
  const arrange0 = (run) => {
    if (run.board.every((c) => c === null) && run.bench.some(Boolean)) {
      const i = run.bench.findIndex(Boolean);
      run.bench[0] && run.board[0] === null && i >= 0 && ([run.board[0], run.bench[i]] = [run.bench[i], null]);
    }
  };

  function loot(run) {
    runesAndBlessings(run);
    const kits = new Set(T.flatMap((id) => kitOf[id]));
    const offers = run.lootOffers.map((o, i) => ({ i, s: o.kind === 'gold' ? 3 : kits.has(o.id) ? 10 : 2 })).sort((a, b) => b.s - a.s);
    run.pickLoot(offers[0]?.i ?? 0);
  }

  /** Plays one run until victory or loss. Returns { won, floor, tables, log } */
  function play(run) {
    for (let steps = 0; steps < 400; steps++) {
      if (run.phase === 'table') table(run);
      else if (run.phase === 'loot') loot(run);
      else if (run.phase === 'shop') { shop(run); run.nextTable(); }
      else break;
    }
    return { won: run.phase === 'victory', floor: Math.floor(run.tableIndex / 3) + 1, tables: run.tableIndex + (run.phase === 'victory' ? 1 : 0), log: log.filter(Boolean) };
  }
  return { play };
}
