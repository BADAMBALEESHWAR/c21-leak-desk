import pino from 'pino';
import { config } from './config.js';
import { ENGINE_VERSION } from './engine/types.js';

export const logger = pino({ level: config.logLevel, base: { service: 'leakdesk-api', engine_version: ENGINE_VERSION } });
