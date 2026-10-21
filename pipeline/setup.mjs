// Banc simulator setups: moments of the run and the setup of a comp.
// banc presets (moment de la run)
export const MOMENTS = {
  milieu: { gold: 25, tablesWon: 10, busts: 8, rerolls: 12, wins: 30, highHands: 30 },
  fin: { gold: 40, tablesWon: 22, busts: 18, rerolls: 30, wins: 70, highHands: 40 },
};
export const heroCounter = (id, m) => (id === 'dauphin' || id === 'apprenti' ? m.tablesWon : id === 'goule' ? m.busts : id === 'joaillier' ? m.rerolls : undefined);
export const runeCounter = (id, m) => (id === 'gloutonne' ? m.wins : id === 'marche' ? m.rerolls : id === 'conquete' || id === 'infini' ? m.tablesWon : id === 'soif' ? m.highHands : 0);

// banc setup of a comp ({heroes, runes?, blessings?}) at a moment of the run, optionally against a boss
export function makeSetup(D, CURSE = 1) {
  const HERO = new Map(D.heroes.map((h) => [h.id, h]));
  const star = (id) => (HERO.get(id).cost >= 4 ? 1 : 2);
  return (comp, { moment = 'fin', boss = null, curse = CURSE } = {}) => {
    const m = MOMENTS[moment];
    const runeIds = Array.isArray(comp.runes) ? comp.runes : [];
    const blessIds = Array.isArray(comp.blessings) ? comp.blessings : [];
    return {
      seats: comp.heroes.map((h) => (h ? { id: h.id, star: h.star ?? star(h.id), items: (h.items ?? []).filter(Boolean), ...(heroCounter(h.id, m) !== undefined ? { counter: heroCounter(h.id, m) } : {}) } : null)),
      runes: runeIds.map((id) => ({ id, counter: runeCounter(id, m) })),
      gold: m.gold, deck: 'classique', curse, policy: 'normal', blessings: blessIds,
      ...(boss ? { rules: D.bosses.find((b) => b.id === boss).rules } : {}),
    };
  };
}
