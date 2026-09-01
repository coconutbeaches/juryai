/**
 * Frozen canonical JSON implementation for historical `case_...` records.
 *
 * This is intentionally owned by the legacy P2 core. V2 envelope work must
 * not change this serializer or the SHA-256 commitments already attested by
 * humans. Any future canonical format needs a separately named artifact.
 */

import { createHash } from 'node:crypto';

export const LEGACY_CANONICAL_JSON_VERSION = 'juryai-legacy-canonical-json-v1';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface CanonicalContext {
  active: WeakSet<object>;
  nodes: number;
}

function canonicalize(value: unknown, context: CanonicalContext, depth: number): JsonValue {
  if (depth > 64) throw new TypeError('JSON depth exceeds 64.');
  context.nodes += 1;
  if (context.nodes > 100_000) throw new TypeError('JSON value exceeds 100000 nodes.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw new TypeError('Value is not plain JSON.');
  if (context.active.has(value)) throw new TypeError('JSON value contains a cycle.');
  context.active.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) throw new TypeError('Arrays must use Array.prototype.');
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key === 'symbol'))
        throw new TypeError('Symbols are forbidden.');
      const stringKeys = keys.filter((key): key is string => typeof key === 'string');
      const numericKeys = stringKeys.filter((key) => /^(0|[1-9][0-9]*)$/u.test(key));
      if (
        stringKeys.some((key) => key !== 'length' && !numericKeys.includes(key)) ||
        numericKeys.length !== value.length
      ) {
        throw new TypeError('Arrays must be dense and have no custom properties.');
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor))
          throw new TypeError('Array accessors are forbidden.');
        result.push(canonicalize(descriptor.value, context, depth + 1));
      }
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Objects must be plain JSON objects.');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === 'symbol')) throw new TypeError('Symbols are forbidden.');
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const key of (keys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError('Object accessors and non-enumerable fields are forbidden.');
      }
      result[key] = canonicalize(descriptor.value, context, depth + 1);
    }
    return result;
  } finally {
    context.active.delete(value);
  }
}

export function canonicalSerializeV1(value: unknown): string {
  return `${JSON.stringify(canonicalize(value, { active: new WeakSet(), nodes: 0 }, 0), null, 2)}\n`;
}

export function sha256V1(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
