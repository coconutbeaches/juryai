/**
 * PR 8C1a structural and inventory guards.
 *
 * 8C1 is the first slice that changes semantics on purpose, so the parity
 * oracle that carried 8C0 covers only one of two columns. Across 8C0b, three
 * of the four genuine defects were caught by guards or review rather than by
 * ordinary tests — a hardcoded `V2.1.4` message, a `Symbol` description
 * derived from `generation_id`, and a public boundary narrowed to
 * `CaseEnvelope`. These guards were therefore written BEFORE the semantic
 * change, and each one failed against `d7e9d2a` for the intended reason before
 * the implementation landed.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot } from './test-helpers.js';
import { COMPILER_V0_3_FROZEN_MANIFEST } from './compiler-v0-3-frozen-manifest.js';

const read = (file: string): string => readFileSync(resolve(projectRoot, file), 'utf8');

function sourceFiles(relativeDirectory: string): string[] {
  const root = resolve(projectRoot, relativeDirectory);
  const found: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const next = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(resolve(directory, entry.name), next);
      else if (entry.isFile() && entry.name.endsWith('.ts')) found.push(next);
    }
  };
  walk(root, relativeDirectory);
  return found.sort();
}

/** Strips comments so a guard reads what the code DOES, not what it explains. */
function executableSource(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

const PRODUCTION_TREES = [
  'api',
  'src/webmcp/server',
  'src/webmcp/browser',
  'src/v2-1-1',
  'src/v2-1-2',
  'src/v2-1-3',
  'src/v2-1-4',
];

describe('PR 8C1a guard 1: the V0.3 compiler trees are byte-frozen', () => {
  it('every manifest entry still hashes identically', () => {
    const drifted = Object.entries(COMPILER_V0_3_FROZEN_MANIFEST)
      .filter(([file, hash]) => createHash('sha256').update(read(file)).digest('hex') !== hash)
      .map(([file]) => file);
    expect(drifted).toEqual([]);
  });

  it('the manifest still covers every file in those trees', () => {
    // Catches a file ADDED to V0.3, which a per-file hash check alone misses.
    const onDisk = [
      ...sourceFiles('src/webmcp/core-v0-3'),
      ...sourceFiles('src/webmcp/compiler-v0-3'),
    ];
    expect(onDisk.sort()).toEqual(Object.keys(COMPILER_V0_3_FROZEN_MANIFEST).sort());
  });

  it('V0.3 never became configurable', () => {
    const contract = executableSource('src/webmcp/core-v0-3/compiler-contract.ts');
    // The literal `true` is the whole point: V0.3 has no policy seam.
    expect(contract).toMatch(/const enforceAssertionSlotCardinality = true;/u);
  });
});

describe('PR 8C1a guard 2: frozen generations remain untouched', () => {
  it.each(['src/v2-1-1', 'src/v2-1-2', 'src/v2-1-3', 'src/v2-1-4'])(
    '%s contains no reference to the future policies or contract',
    (tree) => {
      const offenders = sourceFiles(tree).filter((file) => {
        const source = executableSource(file);
        return (
          source.includes('multi_live') ||
          source.includes('all_own_requirements') ||
          source.includes('contract-v0.4.0')
        );
      });
      expect(offenders).toEqual([]);
    },
  );
});

describe('PR 8C1a guard 9/10: the future policy stays out of production', () => {
  it.each(PRODUCTION_TREES)('no file under %s imports compiler V0.4', (tree) => {
    const offenders = sourceFiles(tree).filter((file) =>
      /from\s+['"][^'"]*(core-v0-4|compiler-v0-4)[^'"]*['"]/u.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it.each(PRODUCTION_TREES)('no file under %s imports the future test spec', (tree) => {
    const offenders = sourceFiles(tree).filter((file) =>
      read(file).includes('formation-future-policy-spec'),
    );
    expect(offenders).toEqual([]);
  });

  it('the future test spec is imported only from src/tests/', () => {
    const offenders = [...PRODUCTION_TREES, 'src/formation', 'src/compatibility', 'src/webmcp']
      .flatMap((tree) => sourceFiles(tree))
      .filter((file) => read(file).includes('formation-future-policy-spec'));
    expect(offenders).toEqual([]);
  });

  it('no production routing references compiler V0.4', () => {
    const routing = [
      ...sourceFiles('src/v2-1-4'),
      ...sourceFiles('src/webmcp/server'),
      ...sourceFiles('api'),
    ];
    const offenders = routing.filter((file) => read(file).includes('contract-v0.4.0'));
    expect(offenders).toEqual([]);
  });
});

describe('PR 8C1a guard 11: no fuzzy semantic dedup in the domain', () => {
  // A similarity threshold in an evidence system is a component that decides
  // which testimony is "the same". It must not exist. Distinct facts that look
  // alike are the exact case the multi-live model was built to represent.
  const FORBIDDEN = [
    /\blevenshtein\b/iu,
    /\bedit_?distance\b/iu,
    /\bjaro\b/iu,
    /\bembedding/iu,
    /\bcosine\b/iu,
    /\bsimilarity\b/iu,
    /\bfuzzy\b/iu,
    /\bdedup/iu,
  ];

  it.each(FORBIDDEN.map((pattern) => [String(pattern), pattern] as const))(
    'src/formation contains no %s',
    (_label, pattern) => {
      const offenders = sourceFiles('src/formation').filter((file) =>
        pattern.test(executableSource(file)),
      );
      expect(offenders).toEqual([]);
    },
  );
});

describe('PR 8C1a guard 12/13: ownership and grounding stay unconditional', () => {
  it('requirement party ownership is never inside a policy branch', () => {
    // The whole widened-scope design rests on this: a broader parsing scope must
    // never become a broader authority. Ownership is checked in the same
    // expression as requirement existence, with no policy term.
    const relay = executableSource('src/formation/relay-submission.ts');
    expect(relay).toMatch(/requirement\.party_id !== partyId/u);
    const ownershipLines = relay
      .split('\n')
      .filter((line) => line.includes('party_id !== partyId'));
    expect(ownershipLines.length).toBeGreaterThan(0);
    for (const line of ownershipLines) {
      expect(line).not.toMatch(/proposition_cardinality|assertion_requirement_scope/u);
    }
  });

  it('span grounding is never inside a policy branch', () => {
    const relay = executableSource('src/formation/relay-submission.ts');
    const spanLines = relay
      .split('\n')
      .filter((line) => line.includes('spanCommitments(') || line.includes('verifyTurnSpan('));
    expect(spanLines.length).toBeGreaterThan(0);
    for (const line of spanLines) {
      expect(line).not.toMatch(/proposition_cardinality|assertion_requirement_scope/u);
    }
  });
});

describe('PR 8C1a guard 4: frozen collision diagnostics stay present AND reachable', () => {
  it('the code literals still exist in their frozen sources', () => {
    // Presence alone is not enough — a code can survive in source while its
    // branch becomes unreachable — so the reachability half is proved by the
    // policy matrix and the V2.1.4 parity suites. This half catches deletion.
    expect(read('src/webmcp/core-v0-3/compiler-contract.ts')).toContain(
      'compiler_assertion_slot_duplicate',
    );
    for (const suffix of ['assertion_slot_duplicate', 'live_position_slot_collision']) {
      expect(read('src/formation/relay-submission.ts')).toContain(`codes.${suffix}`);
    }
    expect(read('src/formation/validator.ts')).toContain('codes.live_position_slot_duplicate');
  });

  it('each collision branch is guarded by the cardinality policy, not deleted', () => {
    const relay = executableSource('src/formation/relay-submission.ts');
    // `singleLivePerSlot` must appear, or the branches were removed outright
    // rather than made conditional.
    expect(relay).toMatch(/const singleLivePerSlot =/u);
    expect(relay).toMatch(/if \(singleLivePerSlot\) \{/u);
  });
});

describe('PR 8C1a guard 14: in_reply_to relaxation is scoped to one branch', () => {
  it('exactly one in_reply_to use in the shared relay is policy-conditional', () => {
    // The inventory that matters: every other use — reply-target validation,
    // clarification, challenge, challenge-response, fingerprint — stays strict.
    // A second conditional use would mean the relaxation had leaked from
    // parsing scope into authority.
    const relay = executableSource('src/formation/relay-submission.ts');
    const uses = relay.split('\n').filter((line) => line.includes('in_reply_to'));
    expect(uses.length).toBeGreaterThan(4);
    const conditional = uses.filter(
      // The flag's own declaration line mentions both, and is not a use.
      (line) => line.includes('requireReplyTarget') && !line.includes('spec.policy'),
    );
    expect(conditional).toHaveLength(1);
    expect(conditional[0]).toContain('effect.requirement_id');
  });

  it('the strict in_reply_to uses are all still present', () => {
    const relay = executableSource('src/formation/relay-submission.ts');
    // Clarification, challenge and challenge-response targeting, plus the
    // fingerprint and the normalised intent targets.
    expect(relay).toContain('!submission.source_turn.in_reply_to.includes(effect.requirement_id)');
    expect(relay).toContain(
      '!submission.source_turn.in_reply_to.includes(effect.target_position_id)',
    );
    expect(relay).toContain('!submission.source_turn.in_reply_to.includes(effect.challenge_id)');
    expect(relay).toMatch(/in_reply_to: normalizedTargets/u);
  });

  it('replyTargetVisibleToParty keeps its disclosure clause', () => {
    // Pre-disclosure enumeration of opponent identifiers is blocked here, and
    // that has nothing to do with parsing scope.
    const relay = executableSource('src/formation/relay-submission.ts');
    expect(relay).toMatch(/envelope\.control\.disclosure_state === 'disclosed'/u);
  });
});

describe('PR 8C1a guard 8: no semantic value is derived from generation_id', () => {
  it('no engine file outside generation-spec.ts reads generation_id', () => {
    const offenders = sourceFiles('src/formation').filter(
      (file) =>
        file !== 'src/formation/generation-spec.ts' &&
        executableSource(file).includes('generation_id'),
    );
    expect(offenders).toEqual([]);
  });

  it('no engine file hardcodes a generation label', () => {
    const offenders = sourceFiles('src/formation').filter((file) =>
      /v2[._]?1[._]?4/iu.test(executableSource(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('compiler contract versions appear only in the closed compatibility tables', () => {
    // `generation-spec.ts` names contract versions on purpose: the tables are a
    // closed registry of what each contract actually implements, which is what
    // makes the policy claims verifiable. Nowhere else in the engine may a
    // contract version appear, or behaviour would start depending on it.
    const offenders = sourceFiles('src/formation').filter(
      (file) =>
        file !== 'src/formation/generation-spec.ts' &&
        /contract-v0\.[0-9]+\.[0-9]+/u.test(executableSource(file)),
    );
    expect(offenders).toEqual([]);

    const spec = executableSource('src/formation/generation-spec.ts');
    const mentions = spec.split('\n').filter((line) => /contract-v0\.[0-9]+\.[0-9]+/u.test(line));
    // Two contracts x two tables.
    expect(mentions).toHaveLength(4);
  });
});
