import { isIP } from 'node:net';

const weakPasswords = new Set(['123456', '654321', 'password', 'password1234', 'changeme', 'change-me']);

function required(env, name) {
  const value = env[name];
  if (!value || !value.trim()) throw new Error(`缺少环境变量 ${name}。`);
  return value;
}

function account(env, role) {
  const prefix = `KITCHEN_${role.toUpperCase()}`;
  const username = (env[`${prefix}_USERNAME`] || role).trim();
  const password = required(env, `${prefix}_PASSWORD`);
  if (!/^[A-Za-z0-9_.-]{1,48}$/.test(username)) throw new Error(`${prefix}_USERNAME 格式有误。`);
  if (password.length < 12 || password.length > 128 || weakPasswords.has(password.toLowerCase()) || password.toLowerCase().includes(username.toLowerCase()) || new Set(password).size < 6) {
    throw new Error(`${prefix}_PASSWORD 请设为 12 至 128 位、各不相同的强密码。`);
  }
  return { role, username, password };
}

function databaseConfig(env) {
  let connection;
  if (env.DATABASE_URL) {
    let url;
    try {
      url = new URL(env.DATABASE_URL);
      if (url.protocol !== 'mysql:') throw new Error();
      connection = {
        host: url.hostname.replace(/^\[|\]$/g, ''),
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)),
      };
    } catch {
      throw new Error('DATABASE_URL 必须为 MySQL 连接地址。');
    }
  } else {
    connection = {
      host: required(env, 'DB_HOST'),
      port: Number(env.DB_PORT || 3306),
      user: required(env, 'DB_USER'),
      password: required(env, 'DB_PASSWORD'),
      database: required(env, 'DB_NAME'),
    };
  }

  if (!connection.host || !connection.user || !connection.password || !connection.database || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) {
    throw new Error('MySQL 连接配置不完整。');
  }

  const localHost = connection.host.toLowerCase() === 'localhost' || connection.host === '::1' ||
    (isIP(connection.host) === 4 && connection.host.startsWith('127.'));
  const tls = env.DB_TLS ?? (localHost ? 'false' : 'true');
  if (!['true', 'false', '1', '0'].includes(tls)) throw new Error('DB_TLS 应设为 true 或 false。');
  const isAiven = /\.aivencloud\.com$/i.test(connection.host);
  if (isAiven && (!env.DB_CA || tls === 'false' || tls === '0')) throw new Error('Aiven MySQL 需要启用 TLS 并配置 DB_CA。');
  if (tls === 'true' || tls === '1') {
    connection.ssl = { rejectUnauthorized: true, verifyIdentity: true };
    if (env.DB_CA) connection.ssl.ca = env.DB_CA.replaceAll('\\n', '\n');
  }

  return { ...connection, timezone: 'Z', charset: 'utf8mb4', connectionLimit: 4, queueLimit: 20, connectTimeout: 10000 };
}

export function readConfig(env) {
  const accounts = [account(env, 'customer'), account(env, 'chef')];
  if (accounts[0].username.toLowerCase() === accounts[1].username.toLowerCase() || accounts[0].password === accounts[1].password) {
    throw new Error('点菜人和厨师需要使用不同的账号和密码。');
  }
  const secret = required(env, 'KITCHEN_SESSION_SECRET');
  if (Buffer.byteLength(secret) < 32 || new Set(secret).size < 12) throw new Error('KITCHEN_SESSION_SECRET 需使用至少 32 字节的随机密钥。');
  const publicUrl = env.KITCHEN_PUBLIC_URL || env.RENDER_EXTERNAL_URL;
  const origin = publicUrl ? new URL(publicUrl).origin : null;
  if (env.RENDER && !origin?.startsWith('https://')) throw new Error('Render 服务需要配置 HTTPS 公开地址。');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 配置有误。');
  const host = env.KITCHEN_HOST || (env.RENDER ? '0.0.0.0' : '127.0.0.1');
  if (!isIP(host)) throw new Error('KITCHEN_HOST 应为监听 IP 地址。');
  return { accounts, database: databaseConfig(env), host, origin, port, secret, render: Boolean(env.RENDER), secureCookie: origin?.startsWith('https://') ?? false };
}
