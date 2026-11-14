import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('the online client connects and adds to cart without newer browser APIs', async () => {
  const user = { username: 'ryj', role: 'customer' };
  const dish = { id: 'dish-1', name: '江西炒粉', price: 16, active: true };
  const storage = new Map();
  const context = {
    AbortController,
    AbortSignal: {},
    clearTimeout, setTimeout, queueMicrotask,
    crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
    document: { addEventListener() {} },
    window: { addEventListener() {} },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setInterval() {},
    async fetch(path, options) {
      assert.equal(path, '/api/state');
      assert.ok(options.signal);
      return new Response(JSON.stringify({ user, dishes: [dish], orders: [] }));
    },
  };
  runInNewContext(await readFile(new URL('../online.js', import.meta.url), 'utf8'), context);
  const { Kitchen } = context.window;
  await Kitchen.refresh();
  assert.equal(Kitchen.user().username, 'ryj');
  Kitchen.addToCart(dish.id);
  assert.match(Kitchen.cart()[0].id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
