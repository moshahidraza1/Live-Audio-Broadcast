import pino from 'pino';
import { env } from './env.js';

export const loggerOptions = {
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
};

export const logger = pino(loggerOptions);
