// Real-game statistics from the game's API (play.runejack.com/api/stats/*). Needs an API key created at
// play.runejack.com/admin#cles. The key is read from RUNEJACK_API_KEY, or injected by the environment's
// network secrets (then no header is needed here). Without a key, the app simply has no real-game data.
import fs from 'node:fs';
import { ORIGIN } from './fetch.mjs';

const ROUTES = ['heros', 'objets', 'runes', 'benedictions', 'decks', 'salles'];

export async function fetchStats(out = 'data/stats.json') {
  const key = process.env.RUNEJACK_API_KEY;
  const headers = key ? { authorization: `Bearer ${key}` } : {};
  const stats = { fetchedAt: new Date().toISOString(), ok: false, routes: {} };
  for (const r of ROUTES) {
    try {
      const res = await fetch(`${ORIGIN}/api/stats/${r}`, { headers });
      const body = await res.json().catch(() => null);
      if (!res.ok) { stats.routes[r] = { error: body?.erreur ?? `HTTP ${res.status}` }; continue; }
      stats.routes[r] = body;
      stats.ok = true;
    } catch (e) { stats.routes[r] = { error: String(e.message ?? e) }; }
  }
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(out, JSON.stringify(stats));
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await fetchStats();
  for (const [k, v] of Object.entries(s.routes)) console.log(k, v.error ? `erreur : ${v.error}` : 'ok');
}
