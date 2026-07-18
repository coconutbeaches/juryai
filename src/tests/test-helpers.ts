import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export async function loadGolden(): Promise<Record<string, any>> {
  const raw = await readFile(resolve(projectRoot, 'src/fixtures/dry_run_001.golden.json'), 'utf8');
  return JSON.parse(raw) as Record<string, any>;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
