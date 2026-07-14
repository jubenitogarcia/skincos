import { join, resolve } from 'path';

export const ROOT_DIR = process.cwd();
export const INSTANCE_DIR = process.env.EVOLUTION_API_INSTANCES_DIR
  ? resolve(process.env.EVOLUTION_API_INSTANCES_DIR)
  : join(ROOT_DIR, 'instances');
export const SRC_DIR = join(ROOT_DIR, 'src');
export const STORE_DIR = process.env.EVOLUTION_API_STORE_DIR
  ? resolve(process.env.EVOLUTION_API_STORE_DIR)
  : join(ROOT_DIR, 'store');
export const AUTH_DIR = join(STORE_DIR, 'auth');
