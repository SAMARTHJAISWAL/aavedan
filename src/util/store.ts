import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${file}: ${(e as Error).message}`);
  }
}

/** Writes through a temporary file so a crash never leaves half a file behind. */
export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function appendLine(file: string, line: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + '\n');
}

export function hash(...parts: unknown[]): string {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(typeof p === 'string' ? p : JSON.stringify(p)).update('\0');
  return h.digest('hex').slice(0, 16);
}

/** A small on-disk cache keyed by content hash, for LLM answers that should not be paid for twice. */
export function cached<T>(dir: string, key: string): { get(): T | undefined; set(v: T): void } {
  const file = path.join(dir, `${key}.json`);
  return {
    get: () => readJson<T | undefined>(file, undefined),
    set: v => writeJson(file, v),
  };
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
