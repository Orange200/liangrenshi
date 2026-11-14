import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createMySqlStore } from './mysql-store.js';

const origin = 'https://kitchen.example';
const config = {
  accounts: [
    { username: 'customer', role: 'customer', password: 'test-diner-4Nq!' },
    { username: 'chef', role: 'chef', password: 'test-cook-8Tv!' },
  ],
  origin,
  secureCookie: true,
  secret: 'local test only: unique fixture value',
};

test('online mode protects data and enforces session roles', async context => {
  const sessions = new Map();
  const app = await createApp(config, {
    session: async hash => sessions.get(hash.toString('hex')),
    startSession: async (hash, username) => sessions.set(hash.toString('hex'), username),
    endSession: async hash => sessions.delete(hash.toString('hex')),
    state: async user => ({ user, dishes: [], orders: [] }),
    setOrderStatus: async (id, status) => ({ id, status }),
  });
  context.after(() => app.close());

  const homepage = await app.inject('/app');
  assert.equal(homepage.statusCode, 200);
  assert.match(homepage.body, /src="online\.js"/);
  assert.doesNotMatch(homepage.body, /src="data\.js"/);
  assert.match(homepage.body, /rel="icon"[^>]+href="assets\/favicon\.svg"/);
  const favicon = await app.inject('/assets/favicon.svg');
  assert.equal(favicon.statusCode, 200);
  assert.match(favicon.headers['content-type'], /^image\/svg\+xml/);
  for (const path of ['/data.js', '/.env', '/server/config.js']) {
    assert.equal((await app.inject(path)).statusCode, 404);
  }
  assert.equal((await app.inject('/api/state')).statusCode, 401);

  const login = (account, from = origin) => app.inject({
    method: 'POST', url: '/api/login', headers: { origin: from },
    payload: { username: account.username, password: account.password },
  });
  assert.equal((await login(config.accounts[0], 'https://other.example')).statusCode, 403);
  assert.equal((await login({ ...config.accounts[0], password: 'wrong' })).statusCode, 401);
  const dinerLogin = await login(config.accounts[0]);
  assert.equal(dinerLogin.statusCode, 200);
  assert.match(dinerLogin.headers['set-cookie'], /^__Host-kitchen-session=[^;]+; Path=\/; HttpOnly; SameSite=Strict; .*; Secure$/);
  const dinerCookie = dinerLogin.headers['set-cookie'].split(';')[0];

  const dinerState = await app.inject({ url: '/api/state', headers: { cookie: dinerCookie } });
  assert.equal(dinerState.json().user.role, 'customer');
  assert.equal((await app.inject({ url: '/api/state', headers: { cookie: dinerCookie, 'if-none-match': dinerState.headers.etag } })).statusCode, 304);

  const updateStatus = cookie => app.inject({
    method: 'PATCH', url: '/api/orders/order-1', headers: { cookie, origin }, payload: { status: '制作中' },
  });
  assert.equal((await updateStatus(dinerCookie)).statusCode, 403);
  const chefLogin = await login(config.accounts[1]);
  const chefCookie = chefLogin.headers['set-cookie'].split(';')[0];
  assert.deepEqual((await updateStatus(chefCookie)).json(), { id: 'order-1', status: '制作中' });

  assert.equal((await app.inject({
    method: 'POST', url: '/api/logout', headers: { cookie: chefCookie, origin }, payload: {},
  })).statusCode, 200);
  assert.equal((await updateStatus(chefCookie)).statusCode, 401);
});

test('the renamed diner can sign in with the same password and read legacy orders', async context => {
  const env = {
    KITCHEN_CUSTOMER_PASSWORD: config.accounts[0].password,
    KITCHEN_CHEF_PASSWORD: config.accounts[1].password,
    KITCHEN_SESSION_SECRET: config.secret,
    DB_HOST: '127.0.0.1', DB_USER: 'test', DB_PASSWORD: 'test', DB_NAME: 'test',
  };
  const renamed = readConfig(env);
  const app = await createApp(renamed, { startSession: async () => {} }, { staticFiles: false });
  context.after(() => app.close());
  const login = username => app.inject({
    method: 'POST', url: '/api/login', payload: { username, password: env.KITCHEN_CUSTOMER_PASSWORD },
  });
  assert.equal((await login('customer')).statusCode, 401);
  assert.deepEqual((await login('ryj')).json().user, { username: 'ryj', role: 'customer' });

  const store = createMySqlStore({
    async execute(sql, values) {
      if (sql.includes('kitchen_dishes')) return [[]];
      assert.match(sql, /WHERE customer IN \(\?, \?\)/);
      assert.deepEqual(values, ['ryj', 'customer']);
      return [[{ id: 'legacy', customer: 'customer', total: '16.00', status: '已完成', items: [], note: '',
        created_at: new Date(0), updated_at: new Date(0) }]];
    },
  });
  const state = await store.state({ username: 'ryj', role: 'customer' });
  assert.equal(state.orders[0].id, 'legacy');
});
