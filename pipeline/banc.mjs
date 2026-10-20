// Runs the game's own "banc d'essai" simulator (sim.worker-*.js from play.runejack.com/banc) in Node.
// The worker is evaluated unmodified in a VM context; the only addition is one statement appended at
// the end of its IIFE that exposes its data tables read-only. Variable names change with every build,
// so they are found by content patterns (lookup getters and constants), never hard-coded.
import fs from 'node:fs';
import vm from 'node:vm';

const GETTERS = {
  heroes: 'Champion inconnu', items: 'Objet inconnu', runes: 'Rune inconnue', bosses: 'Boss inconnu',
  blessings: 'Bénédiction inconnue', bets: 'Pari inconnu', monsters: 'Monstre inconnu',
};
const CONSTANTS = {
  economy: /([A-Za-z_$][\w$]*)=\{startGold:\d/,
  hp: /([A-Za-z_$][\w$]*)=\{tableHp:\[/,
  progressionGuest: /([A-Za-z_$][\w$]*)=\{seats:\[3,/,
  progressionCursed: /([A-Za-z_$][\w$]*)=\{seats:\[1,/,
  traits: /([A-Za-z_$][\w$]*)=\{noblesse:\{id:`noblesse`/,
  pacts: /([A-Za-z_$][\w$]*)=\[\{level:0,name:`/,
};

/** Finds the data variable names in the worker source. Throws with a clear message if a pattern broke. */
export function locate(src) {
  const names = {};
  for (const [k, msg] of Object.entries(GETTERS)) {
    const g = src.match(new RegExp(`function [\\w$]+\\(e\\)\\{let t=([\\w$]+)\\.get\\(e\\);if\\(!t\\)throw Error\\(\`${msg}`));
    if (!g) { if (k === 'heroes' || k === 'items' || k === 'runes' || k === 'bosses') throw new Error(`banc: getter « ${msg} » introuvable`); continue; }
    const m = src.match(new RegExp(`(?:^|[,;\\s])${g[1].replace(/\$/g, '\\$')}=new Map\\(([\\w$]+)\\.map\\(`));
    if (!m) throw new Error(`banc: table de « ${msg} » introuvable`);
    names[k] = m[1];
  }
  for (const [k, re] of Object.entries(CONSTANTS)) { const m = src.match(re); if (m) names[k] = m[1]; }
  return names;
}

export function loadWorkerSource(file) {
  return fs.readFileSync(file, 'utf8');
}

export function makeBanc(src, filename = 'sim.worker.js') {
  const names = locate(src);
  let last = null;
  const self = { postMessage: (m) => { last = m; } };
  const expose = `;self.__data={${Object.entries(names).map(([k, v]) => `${k}:${v}`).join(',')}};`;
  const patched = src.replace(/\}\)\(\);?\s*$/, `${expose}})();`);
  if (patched === src) throw new Error('banc: fin du worker inattendue');
  const ctx = vm.createContext({ self, performance, console, Math, Date, Intl, Map, Set, Array, Object, JSON, Number, String, Error, Promise, Symbol });
  vm.runInContext(patched, ctx, { filename });
  return {
    names,
    data: self.__data,
    /** setup = { seats:[{id,star,items,counter?,holo?,shiny?,awaken?}|null], runes:[{id,counter}], gold, deck, curse, policy, blessings, rules? } */
    run(setup, tables = 300) {
      last = null;
      self.onmessage({ data: { id: 1, setup, tables } });
      if (!last) throw new Error('banc: pas de réponse');
      if (last.erreur) throw new Error(last.erreur);
      return last;
    },
  };
}
