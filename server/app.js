import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { activeValue, bodyObject, categoryName, dishInput, entityId, orderInput, orderStatus, problem } from './validation.js';

const sessionLifetime = 7 * 24 * 60 * 60;
const loginWindow = 15 * 60 * 1000;
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const root = new URL('../', import.meta.url);

async function webRoutes(app) {
  const files = Object.fromEntries(await Promise.all([
    ['index.html', 'text/html; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['online.js', 'text/javascript; charset=utf-8'],
    ['styles.css', 'text/css; charset=utf-8'],
    ['assets/favicon.svg', 'image/svg+xml'],
    ...['hero', ...Array.from({ length: 8 }, (_, index) => `dish-${index + 1}`)].map(name => [`assets/${name}.webp`, 'image/webp']),
  ].map(async ([name, mime]) => {
    const file = new URL(name, root);
    return [name, { mime, content: await readFile(file) }];
  })));
  const index = files['index.html'].content.toString('utf8');
  if (!index.includes('src="data.js"')) throw new Error('无法找到线上页面的数据入口。');
  files['index.html'].content = index.replace('src="data.js"', 'src="online.js"');

  function serve(name, cacheControl) {
    return async (_request, reply) => {
      const { mime, content } = files[name];
      return reply.type(mime).header('Cache-Control', cacheControl).send(content);
    };
  }

  const homepage = serve('index.html', 'no-cache');
  app.get('/', homepage);
  app.get('/app', homepage);
  app.get('/app/', async (_req, reply) => reply.redirect('/app', 308));
  app.get('/index.html', homepage);
  app.get('/robots.txt', async (_req, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /\n'));
  for (const name of Object.keys(files).filter(name => name !== 'index.html')) {
    app.get(`/${name}`, serve(name, name.startsWith('assets/') ? 'public, max-age=3600' : 'no-cache'));
  }
}

function authRoutes(app, config, store) {
  const cookieName = config.secureCookie ? '__Host-kitchen-session' : 'kitchen-session';
  const accountByName = new Map(config.accounts.map(account => [account.username, account]));
  const loginAttempts = new Map();
  const mac = value => createHmac('sha256', config.secret).update(value).digest();

  function cookieHash(request) {
    const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
    const token = cookie?.slice(cookieName.length + 1);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? mac(`session:${token}`) : null;
  }

  function sendCookie(reply, value, maxAge) {
    const secure = config.secureCookie ? '; Secure' : '';
    reply.header('Set-Cookie', `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
  }

  function publicUser(account) {
    return { username: account.username, role: account.role };
  }

  async function userFor(request) {
    const hash = cookieHash(request);
    const username = hash && await store.session(hash);
    const account = accountByName.get(username);
    return account ? publicUser(account) : null;
  }

  function rateLimitLogin(request, reply) {
    const now = Date.now();
    const ip = request.ip || 'unknown';
    for (const [key, record] of loginAttempts) {
      if (record.expires <= now) loginAttempts.delete(key);
    }
    if (!loginAttempts.has(ip) && loginAttempts.size >= 2500) {
      throw problem(429, '登录请求较多，请稍后重试。');
    }
    const attempt = loginAttempts.get(ip) || { expires: now + loginWindow, count: 0 };
    if (attempt.count >= 12) {
      reply.header('Retry-After', Math.ceil((attempt.expires - now) / 1000));
      throw problem(429, '登录尝试次数过多，请稍后再试。');
    }
    attempt.count += 1;
    loginAttempts.set(ip, attempt);
    return ip;
  }

  app.get('/api/session', async request => ({ user: await userFor(request) }));
  app.post('/api/login', { bodyLimit: 4096 }, async (request, reply) => {
    const ip = rateLimitLogin(request, reply);
    const { username, password } = bodyObject(request.body);
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 48 || password.length > 128) {
      throw problem(401, '账号或密码不正确。');
    }
    const account = accountByName.get(username.trim());
    const expected = account?.password ?? config.secret;
    if (!timingSafeEqual(mac(`password:${password}`), mac(`password:${expected}`)) || !account) {
      throw problem(401, '账号或密码不正确。');
    }
    const token = randomBytes(32).toString('base64url');
    await store.startSession(mac(`session:${token}`), account.username, new Date(Date.now() + sessionLifetime * 1000), cookieHash(request));
    loginAttempts.delete(ip);
    sendCookie(reply, token, sessionLifetime);
    return { user: publicUser(account) };
  });
  app.post('/api/logout', { bodyLimit: 4096 }, async (request, reply) => {
    const hash = cookieHash(request);
    if (hash) await store.endSession(hash);
    sendCookie(reply, '', 0);
    return { ok: true };
  });

  return function protect(roles, handler) {
    return async (request, reply) => {
      const user = await userFor(request);
      if (!user) throw problem(401, '请先登录。');
      if (roles && user.role !== roles) throw problem(403, '当前账号无权执行此操作。');
      return handler(request, reply, user);
    };
  };
}

export async function createApp(config, store, { staticFiles = true, logger = false } = {}) {
  const app = Fastify({ logger, bodyLimit: 1024 * 1024, trustProxy: config.render ? (_address, hop) => hop === 0 : false });
  app.addHook('onRequest', async (request, reply) => {
    reply.headers({
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'private, no-store');
    if (safeMethods.has(request.method)) return;

    const origin = request.headers.origin;
    const expected = config.origin || `http://${request.headers.host}`;
    const fetchSite = request.headers['sec-fetch-site'];
    if ((origin && origin !== expected) || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
      throw problem(403, '该请求来自其他站点。');
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
      throw problem(415, '请使用 JSON 请求格式。');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ message: error.message });
    }
    request.log.error({ code: error.code || error.name }, 'Kitchen request failed');
    return reply.code(500).send({ message: '小厨房暂时无法处理这个请求，请稍后重试。' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ message: '找不到这个页面。' }));

  const protect = authRoutes(app, config, store);
  const health = async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      await store.ping();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  };
  app.get('/healthz', health);
  app.get('/api/health', protect(null, health));
  app.get('/api/state', protect(null, async (request, reply, user) => {
    const payload = JSON.stringify(await store.state(user));
    const etag = `"${createHash('sha256').update(payload).digest('base64url')}"`;
    reply.header('ETag', etag);
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(payload);
  }));

  app.post('/api/dishes', protect('chef', async (request, reply) => {
    const dish = await store.createDish(dishInput(request.body));
    return reply.code(201).send(dish);
  }));
  app.post('/api/categories', protect('chef', async request => {
    const { previous, name } = bodyObject(request.body);
    await store.saveCategory(previous === undefined ? null : categoryName(previous), categoryName(name));
    return { ok: true };
  }));
  app.delete('/api/categories', protect('chef', async request => {
    await store.deleteCategory(categoryName(bodyObject(request.body).name));
    return { ok: true };
  }));
  app.put('/api/dishes/:id', protect('chef', async request => store.updateDish(entityId(request.params.id), dishInput(request.body))));
  app.patch('/api/dishes/:id', protect('chef', async request => store.setDishActive(entityId(request.params.id), activeValue(bodyObject(request.body).active))));
  app.delete('/api/dishes/:id', protect('chef', async request => {
    await store.deleteDish(entityId(request.params.id));
    return { ok: true };
  }));
  app.post('/api/orders', protect('customer', async (request, reply, user) => {
    const order = await store.createOrder(orderInput(request.body), user.username);
    return reply.code(201).send(order);
  }));
  app.patch('/api/orders/:id', protect('chef', async request => store.setOrderStatus(entityId(request.params.id), orderStatus(bodyObject(request.body).status))));
  if (staticFiles) await webRoutes(app);
  return app;
}
