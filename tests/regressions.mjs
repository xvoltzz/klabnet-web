// Run with Node 22+: node tests/regressions.mjs
// Delayed responses reproduce races without writing to any real service.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = name => readFile(new URL('../js/' + name, import.meta.url), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function context(extra = {}) {
  const ctx = {
    document: { body: {}, documentElement: {}, createElement: () => ({ getContext: () => null }),
      addEventListener() {}, querySelectorAll: () => [] },
    MutationObserver: class { observe() {} }, addEventListener() {},
    AbortController, AbortSignal, setTimeout, clearTimeout, URL, Blob,
    SFX: { play() {} }, showToast() {}, KLAB_GOLD_AT: 5, esc: String, ...extra,
  };
  ctx.window = ctx;
  return vm.createContext(ctx);
}

const util = context({ fetch: (_url, { signal }) => new Promise((resolve, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
}) });
vm.runInContext(await source('00-util.js'), util);
const caller = new AbortController();
const cancelled = util.fetchTimeout('/slow', { signal: caller.signal }, 1000);
caller.abort();
await assert.rejects(cancelled, { name: 'AbortError' });
await assert.rejects(util.fetchTimeout('/slow', {}, 5), { name: 'AbortError' });
console.log('PASS caller cancellation and timeout');

let now = 100000, puts = [], gets = [], delayGet = false, failGet = false;
const ctx = context({
  Date: class extends Date { static now() { return now; } },
  fetchTimeout: (url, opts) => {
    if (opts.method === 'PUT') {
      const request = deferred(); puts.push(request); return request.promise;
    }
    if (failGet) return Promise.resolve({ ok: false });
    if (delayGet) { const request = deferred(); gets.push(request); return request.promise; }
    return Promise.resolve({ ok: true, json: async () => ({ stars: {} }) });
  },
});
vm.runInContext(await source('21-stars.js'), ctx);
const stars = ctx.klabStars;
const answer = (mine, count = mine ? 1 : 0) => ({ ok: true, json: async () => ({ mine, count }) });
await stars.ensure('song:rapid');
const first = stars.toggle('song:rapid'), second = stars.toggle('song:rapid');
await turn();
assert.equal(puts.length, 1, 'second flip waits for the first');
puts[0].resolve(answer(true));
await turn();
assert.equal(puts.length, 2);
puts[1].resolve(answer(false));
await Promise.all([first, second]);
assert.equal(stars.get('song:rapid').mine, false);
console.log('PASS rapid star/unstar serializes server flips');

puts = [];
const one = stars.toggle('song:rapid', true), two = stars.toggle('song:rapid', true);
await turn(); puts[0].resolve(answer(true));
await Promise.all([one, two]);
assert.equal(puts.length, 1, 'two explicit Star actions only flip once');
console.log('PASS concurrent explicit Star actions are idempotent');

now += 60001; delayGet = true;
const stale = stars.ensure('song:rapid');
const unstar = stars.toggle('song:rapid', false);
await turn();
// The action refreshes an expired state before deciding whether to flip.
// Resolve that lookup first; the older batch lookup is still on its way.
gets[1].resolve({ ok: true, json: async () => ({ stars: { rapid: { mine: true, count: 1 } } }) });
await turn();
gets[0].resolve({ ok: true, json: async () => ({ stars: { rapid: { mine: true, count: 1 } } }) });
await stale;
assert.equal(stars.get('song:rapid').mine, false, 'GET cannot overwrite an optimistic flip');
puts[1].resolve(answer(false)); await unstar;
console.log('PASS stale GET in the same millisecond cannot undo a flip');

delayGet = false; failGet = true; const before = puts.length;
await stars.toggle('song:unknown', true);
assert.equal(puts.length, before, 'unknown state must not blindly flip');
failGet = false;
const failed = stars.toggle('song:rapid', true); await turn();
puts.at(-1).reject(new Error('offline')); await failed;
assert.equal(stars.get('song:rapid').mine, false);
assert.equal(stars.get('song:rapid').at, 0, 'failed flip can be refreshed');
failGet = true;
const failedCount = puts.length;
await stars.toggle('song:rapid', true);
assert.equal(puts.length, failedCount, 'uncertain previous write must refresh before another flip');
console.log('PASS failed lookups and writes preserve intended star state');
