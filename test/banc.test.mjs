// Checks that the banc loader still finds the game's data and that a simulation runs.
// Needs a downloaded worker in cache/ (run `npm run fetch` first).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBanc, loadWorkerSource } from '../pipeline/banc.mjs';

const dirs = fs.existsSync('cache') ? fs.readdirSync('cache') : [];
const worker = dirs.flatMap((d) => fs.readdirSync(path.join('cache', d)).filter((f) => f.startsWith('sim.worker')).map((f) => path.join('cache', d, f))).pop();

test('le banc expose ses tables', { skip: !worker && 'pas de worker en cache' }, () => {
  const b = makeBanc(loadWorkerSource(worker));
  for (const k of ['heroes', 'items', 'runes', 'bosses', 'blessings', 'economy', 'traits', 'pacts']) assert.ok(b.data[k], `table ${k}`);
  assert.ok(b.data.heroes.length >= 30);
  assert.ok(b.data.items.some((i) => i.contraband));
});

test('une salle se simule', { skip: !worker && 'pas de worker en cache' }, () => {
  const b = makeBanc(loadWorkerSource(worker));
  const ids = b.data.heroes.slice(0, 5).map((h) => h.id);
  const r = b.run({ seats: ids.map((id) => ({ id, star: 2, items: [] })), runes: [], gold: 40, deck: 'classique', curse: 1, policy: 'normal', blessings: [] }, 40);
  assert.ok(r.result.p50 > 0);
  assert.ok(r.etages.length >= 7);
});

test('une run complète se joue jusqu’au bout', { skip: !worker && 'pas de worker en cache' }, async () => {
  const { makeRunBot, PLANS } = await import('../pipeline/runbot.mjs');
  const b = makeBanc(loadWorkerSource(worker));
  assert.ok(b.data.Run && b.data.playDeal, 'moteur de run et bot de table exposés');
  const heroes = new Map(b.data.heroes.map((h) => [h.id, h]));
  const ctx = { Run: b.data.Run, playDeal: b.data.playDeal, heroes, strength: new Map(), early: new Map() };
  const target = { heroes: b.data.heroes.slice(0, 5).map((h) => ({ id: h.id, items: [] })) };
  for (let seed = 1; seed <= 3; seed++) {
    const run = new ctx.Run(seed, 0, 1, 'classique');
    const r = makeRunBot(ctx, target, PLANS.depart).play(run);
    assert.ok(['victory', 'lost'].includes(run.phase), `run ${seed} terminée (${run.phase})`);
    assert.ok(r.floor >= 1 && r.log.length >= 1);
  }
});
