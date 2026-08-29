/**
 * Server-owned identity, time and salt material.
 *
 * Everything in this module is a value the RUNTIME owns. None of it may ever
 * be supplied by an external caller: a relay that could choose a case id, a
 * turn id, a proposition id, a receipt timestamp or a payload commitment salt
 * could forge log ordering, collide ids deliberately, or grind a commitment.
 *
 * They are injected rather than called inline so that tests, fixtures and
 * replay tooling can be deterministic without the production paths reaching
 * for a global clock or a global RNG.
 */

import { randomBytes, randomUUID } from 'node:crypto';

export interface RuntimeClock {
  /** Epoch milliseconds. ISO strings are derived from this, never separately. */
  now(): number;
}

export interface RuntimeIdFactory {
  caseId(): string;
  turnId(): string;
  compileRunId(): string;
  propositionId(): string;
  clarificationId(): string;
}

export interface PayloadSaltFactory {
  /** Fresh, unguessable, per-turn. Never derived from the payload. */
  next(): string;
}

export function isoFrom(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export const systemClock: RuntimeClock = {
  now: () => Date.now(),
};

export function randomIdFactory(): RuntimeIdFactory {
  return {
    caseId: () => 'case_' + randomUUID(),
    turnId: () => 'turn_' + randomUUID(),
    compileRunId: () => 'run_' + randomUUID(),
    propositionId: () => 'prop_' + randomUUID(),
    clarificationId: () => 'clar_' + randomUUID(),
  };
}

export function randomSaltFactory(): PayloadSaltFactory {
  return { next: () => randomBytes(32).toString('hex') };
}

/* ------------------------------------------------------------------------ */
/* Deterministic implementations for tests, fixtures and replay tooling.     */
/* ------------------------------------------------------------------------ */

/** Advances by a fixed step on every read, so ordering is observable. */
export function steppingClock(startMs: number, stepMs = 1000): RuntimeClock {
  let current = startMs;
  return {
    now: () => {
      const value = current;
      current += stepMs;
      return value;
    },
  };
}

export function frozenClock(atMs: number): RuntimeClock {
  return { now: () => atMs };
}

export function sequentialIdFactory(prefix = ''): RuntimeIdFactory {
  const counters = new Map<string, number>();
  const next = (kind: string): string => {
    const value = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, value);
    return prefix + kind + '_' + String(value);
  };
  return {
    caseId: () => next('case'),
    turnId: () => next('turn'),
    compileRunId: () => next('run'),
    propositionId: () => next('prop'),
    clarificationId: () => next('clar'),
  };
}

export function sequentialSaltFactory(prefix = 'salt'): PayloadSaltFactory {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      return prefix + '_' + String(counter);
    },
  };
}
