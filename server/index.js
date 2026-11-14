import mysql from 'mysql2/promise';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createMySqlStore, initializeTables } from './mysql-store.js';

async function main() {
  const config = readConfig(process.env);
  const pool = mysql.createPool(config.database);
  try {
    const app = await createApp(config, createMySqlStore(pool), { logger: true });
    app.addHook('onClose', () => pool.end());
    await initializeTables(pool);
    await app.listen({ host: config.host, port: config.port });

    async function stop() {
      await app.close();
    }
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch (error) {
    await pool.end();
    if (error.code && error.code !== 'ENOENT') throw new Error(`无法启动小厨房（${error.code}）。`);
    throw error;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
