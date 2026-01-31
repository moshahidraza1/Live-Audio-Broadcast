import fs from 'node:fs/promises';
import path from 'node:path';
import { pgPool } from './client.js';
import { logger } from '../config/logger.js';

const migrationsDir = path.resolve(process.cwd(), 'drizzle');

async function runMigrations() {
  try {
    let files = [];
    try {
      files = (await fs.readdir(migrationsDir))
        .filter((file) => file.endsWith('.sql'))
        .sort();
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    if (!files.length) {
      logger.info('No migrations found');
      return;
    }

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, 'utf8');
      if (!sql.trim()) continue;

      logger.info({ file }, 'Running migration');
      await pgPool.query(sql);
    }

    logger.info('Migrations complete');
  } catch (error) {
    logger.error({ err: error }, 'Migration failed');
    process.exitCode = 1;
  } finally {
    await pgPool.end();
  }
}

runMigrations();
