// Parallel evaluation: one banc simulator per CPU core (worker_threads).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { makeBanc, loadWorkerSource } from './banc.mjs';

if (!isMainThread && workerData?.bancPool) {
  const banc = makeBanc(loadWorkerSource(workerData.workerPath));
  parentPort.on('message', ({ jid, setup, tables }) => {
    try {
      const r = banc.run(setup, tables);
      const { samples, rooms, ...res } = r.result;
      parentPort.postMessage({ jid, res, tenuBoss: r.tenuBoss, tenuGrande: r.tenuGrande, etages: r.etages });
    } catch (e) { parentPort.postMessage({ jid, error: String(e?.message ?? e) }); }
  });
}

export class BancPool {
  constructor(workerPath, n = Math.max(1, os.cpus().length)) {
    this.ws = Array.from({ length: n }, () => new Worker(new URL(import.meta.url), { workerData: { bancPool: true, workerPath }, execArgv: [] }));
    this.idle = [...this.ws]; this.q = []; this.cb = new Map(); this.jid = 0; this.count = 0;
    for (const w of this.ws) w.on('message', (m) => { this.idle.push(w); const f = this.cb.get(m.jid); this.cb.delete(m.jid); f(m); this.pump(); });
  }
  run(setup, tables = 300) {
    this.count += tables;
    return new Promise((res, rej) => { const jid = ++this.jid; this.cb.set(jid, (m) => (m.error ? rej(new Error(m.error)) : res(m))); this.q.push({ jid, setup, tables }); this.pump(); });
  }
  pump() { while (this.idle.length && this.q.length) this.idle.pop().postMessage(this.q.shift()); }
  close() { for (const w of this.ws) w.terminate(); }
}
