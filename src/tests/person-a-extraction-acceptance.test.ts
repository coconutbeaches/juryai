import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRY_RUN_001_COMPATIBILITY_ALIASES,
  alignPersonA,
  alignPersonAForCase,
  semanticSimilarity,
} from '../alignment/person-a-alignment-corrected.js';
import {
  parseEvaluatePersonAExtractionAcceptanceArgs,
  runEvaluatePersonAExtractionAcceptanceCommand,
} from '../commands/evaluate-person-a-extraction-acceptance.js';
import {
  evaluatePersonAExtractionAcceptanceCase,
  evaluatePersonAExtractionAcceptanceSuite,
  loadPersonAExtractionAcceptanceManifest,
  renderPersonAExtractionAcceptanceReport,
  serializePersonAExtractionAcceptance,
  sha256Bytes,
  type PersonAExtractionAcceptanceCase,
} from '../evaluation/person-a-extraction-acceptance.js';
import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';
import { clone } from './person-a-test-helpers.js';

const manifestPath = resolve(
  process.cwd(),
  'src/fixtures/person-a-extraction-acceptance.manifest.json',
);

async function corpus(): Promise<PersonAExtractionAcceptanceCase[]> {
  return loadPersonAExtractionAcceptanceManifest(manifestPath);
}

function candidateResult(
  acceptanceCase: PersonAExtractionAcceptanceCase,
  mutate: (candidate: Record<string, any>) => void,
  expectedStatus: 'accepted' | 'rejected' = 'rejected',
) {
  const extraction = clone(acceptanceCase.golden) as Record<string, any>;
  mutate(extraction);
  return evaluatePersonAExtractionAcceptanceCase({
    ...acceptanceCase,
    candidates: [
      {
        candidateId: 'mutation',
        origin: 'hand_authored_control',
        extraction,
        candidateHash: sha256Bytes(JSON.stringify(extraction)),
        expectedStatus,
      },
    ],
  })[0]!;
}

describe('Person A extraction acceptance corpus', () => {
  it('accepts hand-authored controls without counting them as model acceptance', async () => {
    const suite = evaluatePersonAExtractionAcceptanceSuite(await corpus());
    expect(suite.by_origin.hand_authored_control).toEqual({
      total: 3,
      accepted: 3,
      rejected: 0,
    });
    expect(
      suite.results
        .filter((result) => result.candidate_origin === 'hand_authored_control')
        .every((result) => result.status === 'accepted'),
    ).toBe(true);
    expect(suite.historical_model_acceptance).toEqual({ accepted: 0, total: 3 });
  });

  it('replays all three historical saved outputs as rejected with stable broad failures', async () => {
    const suite = evaluatePersonAExtractionAcceptanceSuite(await corpus());
    const historical = suite.results.filter(
      (result) => result.candidate_origin === 'historical_saved_output',
    );
    expect(historical.map((result) => result.candidate_id)).toEqual([
      'historical_saved_v1',
      'historical_saved_v2',
      'historical_saved_v3',
    ]);
    expect(historical.every((result) => result.status === 'rejected')).toBe(true);
    for (const result of historical) {
      expect(result.major_count).toBeGreaterThan(0);
      expect(result.failure_code_histogram).toHaveProperty('missing_golden_object');
      expect(result.failure_code_histogram).toHaveProperty('party_interpretation');
      expect(result.failure_code_histogram).toHaveProperty('source_grounded_extra_object');
    }
    expect(suite.historical_model_acceptance).toEqual({ accepted: 0, total: 3 });
    expect(suite.gate_passed).toBe(true);
  });

  it('fails schema validation before semantic evaluation', async () => {
    const acceptanceCase = (await corpus())[0]!;
    const result = candidateResult(acceptanceCase, (candidate) => {
      delete candidate.schema_version;
    });
    expect(result).toMatchObject({
      schema_valid: false,
      invariants_valid: false,
      semantic_evaluation_performed: false,
      status: 'rejected',
      rejection_reasons: ['schema_invalid'],
    });
    expect(result.failure_code_histogram).toEqual({});
  });

  it('fails invariant validation before semantic evaluation', async () => {
    const acceptanceCase = (await corpus())[0]!;
    const result = candidateResult(acceptanceCase, (candidate) => {
      candidate.submission.content_hash = '0'.repeat(64);
    });
    expect(result).toMatchObject({
      schema_valid: true,
      invariants_valid: false,
      semantic_evaluation_performed: false,
      status: 'rejected',
      rejection_reasons: ['invariants_invalid'],
    });
  });

  it('rejects a critical-only actor reversal', async () => {
    const acceptanceCase = (await corpus())[1]!;
    const result = candidateResult(acceptanceCase, (candidate) => {
      candidate.timeline[1].actor_party_id = 'party_a';
    });
    expect(result.critical_count).toBeGreaterThan(0);
    expect(result.failure_code_histogram).toHaveProperty('actor_reversed');
    expect(result.status).toBe('rejected');
  });

  it('rejects a major-only semantic difference', async () => {
    const acceptanceCase = (await corpus())[1]!;
    const result = candidateResult(acceptanceCase, (candidate) => {
      candidate.claims[0].against_asserting_party_interest =
        !candidate.claims[0].against_asserting_party_interest;
    });
    expect(result.critical_count).toBe(0);
    expect(result.major_count).toBe(1);
    expect(result.failure_code_histogram).toEqual({ against_interest_flag: 1 });
    expect(result.status).toBe('rejected');
  });

  it('accepts a minor-only result while retaining the diagnostic', async () => {
    const acceptanceCase = (await corpus())[1]!;
    const result = candidateResult(
      acceptanceCase,
      (candidate) => {
        candidate.claims[0].materiality =
          candidate.claims[0].materiality === 'high' ? 'medium' : 'high';
      },
      'accepted',
    );
    expect(result).toMatchObject({
      critical_count: 0,
      major_count: 0,
      minor_count: 1,
      status: 'accepted',
      rejection_reasons: [],
    });
    expect(result.failure_code_histogram).toEqual({ materiality: 1 });
  });

  it('classifies missing objects and fabrication deterministically', async () => {
    const acceptanceCase = (await corpus())[1]!;
    const missing = candidateResult(acceptanceCase, (candidate) => {
      candidate.timeline.splice(1, 1);
    });
    expect(missing.failure_code_histogram).toHaveProperty('missing_golden_object');
    expect(missing.status).toBe('rejected');

    const fabricated = candidateResult(acceptanceCase, (candidate) => {
      const claim = clone(candidate.claims[0]);
      claim.claim_id = 'cl_fabricated';
      claim.claim_text = 'Priya admitted destroying an unrelated warehouse.';
      candidate.claims.push(claim);
    });
    expect(fabricated.failure_code_histogram).toHaveProperty('unsupported_extra_object');
    expect(fabricated.critical_count).toBeGreaterThan(0);
  });

  it('classifies date flattening, evidence promotion, and reversed remedies', async () => {
    const acceptanceCase = (await corpus())[1]!;
    const flattened = candidateResult(acceptanceCase, (candidate) => {
      candidate.timeline[0].date.approximate = false;
    });
    expect(flattened.failure_code_histogram).toHaveProperty('approximate_date_flattened');

    const promoted = candidateResult(acceptanceCase, (candidate) => {
      candidate.evidence[0].availability_status = 'uploaded_uninspected';
    });
    expect(promoted).toMatchObject({
      invariants_valid: false,
      semantic_evaluation_performed: false,
      status: 'rejected',
      rejection_reasons: ['invariants_invalid'],
    });

    const reversed = candidateResult(acceptanceCase, (candidate) => {
      const transfer = candidate.desired_outcomes.outcomes[0].transfers[0];
      [transfer.from_party_id, transfer.to_party_id] = [
        transfer.to_party_id,
        transfer.from_party_id,
      ];
    });
    expect(reversed.failure_code_histogram).toHaveProperty('transfer_direction');
    expect(reversed.critical_count).toBeGreaterThan(0);
  });

  it('scopes aliases to a case and preserves the explicit Dry Run 001 wrapper', async () => {
    const cases = await corpus();
    const dryRun1 = cases.find((entry) => entry.caseId === 'dry_run_001')!;
    const dryRun2 = cases.find((entry) => entry.caseId === 'dry_run_002')!;
    expect(semanticSimilarity('client', 'maya', dryRun1.aliases)).toBe(1);
    expect(semanticSimilarity('client', 'maya', dryRun2.aliases)).toBeLessThan(0.5);
    expect(semanticSimilarity('client', 'priya', dryRun2.aliases)).toBe(1);
    expect(semanticSimilarity('freelancer', 'alex', {})).toBeLessThan(0.5);
    expect(semanticSimilarity('freelancer', 'alex', DRY_RUN_001_COMPATIBILITY_ALIASES)).toBe(1);

    const golden = buildPersonAGoldenProjection();
    expect(alignPersonA(golden, golden)).toEqual(
      alignPersonAForCase(golden, golden, { aliases: DRY_RUN_001_COMPATIBILITY_ALIASES }),
    );
  });

  it('is byte-identical across case order, candidate order, and repeated runs', async () => {
    const cases = await corpus();
    const first = serializePersonAExtractionAcceptance(
      evaluatePersonAExtractionAcceptanceSuite(cases),
    );
    const reversed = serializePersonAExtractionAcceptance(
      evaluatePersonAExtractionAcceptanceSuite(
        [...cases].reverse().map((acceptanceCase) => ({
          ...acceptanceCase,
          candidates: [...acceptanceCase.candidates].reverse(),
        })),
      ),
    );
    const repeated = serializePersonAExtractionAcceptance(
      evaluatePersonAExtractionAcceptanceSuite(await corpus()),
    );
    expect(reversed).toBe(first);
    expect(repeated).toBe(first);
    const parsed = JSON.parse(first);
    for (const result of parsed.results) {
      expect(Object.keys(result.failure_code_histogram)).toEqual(
        [...Object.keys(result.failure_code_histogram)].sort(),
      );
      expect(result.rejection_reasons).toEqual([...result.rejection_reasons].sort());
    }
  });
});

type MutableManifest = {
  version: string;
  cases: Array<Record<string, any>>;
  candidates: Array<Record<string, any>>;
};

async function temporaryManifest(
  mutate: (manifest: MutableManifest) => void,
  options: { narrative?: string; golden?: string; candidate?: string } = {},
): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'juryai-person-a-acceptance-'));
  const narrative = options.narrative ?? 'synthetic narrative\n';
  const golden = options.golden ?? '{}\n';
  const candidate = options.candidate ?? '{}\n';
  await Promise.all([
    writeFile(resolve(directory, 'narrative.txt'), narrative),
    writeFile(resolve(directory, 'golden.json'), golden),
    writeFile(resolve(directory, 'candidate.json'), candidate),
  ]);
  const manifest: MutableManifest = {
    version: 'person-a-extraction-acceptance-manifest-v1',
    cases: [
      {
        case_id: 'case_001',
        narrative: { path: 'narrative.txt', sha256: sha256Bytes(narrative) },
        golden: { path: 'golden.json', sha256: sha256Bytes(golden) },
        semantic_calibration: { identities: ['alice', 'bob'], aliases: [] },
      },
    ],
    candidates: [
      {
        case_id: 'case_001',
        candidate_id: 'candidate_001',
        origin: 'hand_authored_control',
        extraction: { path: 'candidate.json', sha256: sha256Bytes(candidate) },
        expected_status: 'rejected',
      },
    ],
  };
  mutate(manifest);
  const path = resolve(directory, 'manifest.json');
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}

describe('Person A extraction acceptance manifest safety', () => {
  it('rejects duplicate case IDs', async () => {
    const path = await temporaryManifest((manifest) => {
      manifest.cases.push(clone(manifest.cases[0]!));
    });
    await expect(loadPersonAExtractionAcceptanceManifest(path)).rejects.toThrow(
      "duplicate case ID 'case_001'",
    );
  });

  it('rejects duplicate candidate IDs', async () => {
    const path = await temporaryManifest((manifest) => {
      manifest.candidates.push(clone(manifest.candidates[0]!));
    });
    await expect(loadPersonAExtractionAcceptanceManifest(path)).rejects.toThrow(
      "duplicate candidate ID 'case_001/candidate_001'",
    );
  });

  it('rejects missing files and stale hashes', async () => {
    const missing = await temporaryManifest((manifest) => {
      manifest.cases[0]!.narrative.path = 'missing.txt';
    });
    await expect(loadPersonAExtractionAcceptanceManifest(missing)).rejects.toThrow(
      'missing or unreadable',
    );

    const stale = await temporaryManifest((manifest) => {
      manifest.candidates[0]!.extraction.sha256 = '0'.repeat(64);
    });
    await expect(loadPersonAExtractionAcceptanceManifest(stale)).rejects.toThrow('hash mismatch');
  });

  it('rejects malformed fixture JSON and unsafe traversal', async () => {
    const malformed = await temporaryManifest(() => undefined, { candidate: '{not-json\n' });
    await expect(loadPersonAExtractionAcceptanceManifest(malformed)).rejects.toThrow(
      'contains invalid JSON',
    );

    const unsafe = await temporaryManifest((manifest) => {
      manifest.cases[0]!.golden.path = '../golden.json';
    });
    await expect(loadPersonAExtractionAcceptanceManifest(unsafe)).rejects.toThrow(
      'malformed or unsafe',
    );
  });

  it('rejects malformed, unknown, and ambiguous aliases', async () => {
    const malformed = await temporaryManifest((manifest) => {
      manifest.cases[0]!.semantic_calibration.aliases = [
        { alias: 'two words', canonical: 'alice' },
      ];
    });
    await expect(loadPersonAExtractionAcceptanceManifest(malformed)).rejects.toThrow(
      'malformed alias',
    );

    const unknown = await temporaryManifest((manifest) => {
      manifest.cases[0]!.semantic_calibration.aliases = [{ alias: 'client', canonical: 'carol' }];
    });
    await expect(loadPersonAExtractionAcceptanceManifest(unknown)).rejects.toThrow(
      'unknown identity',
    );

    const ambiguous = await temporaryManifest((manifest) => {
      manifest.cases[0]!.semantic_calibration.aliases = [{ alias: 'bob', canonical: 'alice' }];
    });
    await expect(loadPersonAExtractionAcceptanceManifest(ambiguous)).rejects.toThrow(
      'ambiguous with an identity',
    );
  });

  it('rejects unknown candidate origins and unknown cases', async () => {
    const origin = await temporaryManifest((manifest) => {
      manifest.candidates[0]!.origin = 'live_model_output';
    });
    await expect(loadPersonAExtractionAcceptanceManifest(origin)).rejects.toThrow(
      'origin is unsupported',
    );

    const unknownCase = await temporaryManifest((manifest) => {
      manifest.candidates[0]!.case_id = 'case_999';
    });
    await expect(loadPersonAExtractionAcceptanceManifest(unknownCase)).rejects.toThrow(
      "references unknown case 'case_999'",
    );
  });

  it('rejects unsupported manifest fields, empty cases, and invalid golden extractions', async () => {
    const unsupported = await temporaryManifest((manifest) => {
      manifest.cases[0]!.unexpected = true;
    });
    await expect(loadPersonAExtractionAcceptanceManifest(unsupported)).rejects.toThrow(
      "unsupported key 'unexpected'",
    );

    const empty = await temporaryManifest((manifest) => {
      manifest.candidates = [];
    });
    await expect(loadPersonAExtractionAcceptanceManifest(empty)).rejects.toThrow(
      "case 'case_001' has no candidates",
    );

    const invalidGolden = await temporaryManifest(() => undefined);
    await expect(loadPersonAExtractionAcceptanceManifest(invalidGolden)).rejects.toThrow(
      'golden extraction is invalid',
    );
  });
});

describe('Person A extraction acceptance CLI', () => {
  it.each([
    [['--manfiest', 'x'], 'Unknown option: --manfiest'],
    [['--manifest'], 'Missing value for --manifest'],
    [['--format', 'xml'], 'Unsupported --format value: xml'],
    [['--gate', 'true'], 'Boolean flag --gate does not accept a value'],
    [['manifest.json'], 'Unexpected positional or short argument: manifest.json'],
  ])('rejects malformed arguments before corpus I/O', async (argv, message) => {
    let loads = 0;
    await expect(
      runEvaluatePersonAExtractionAcceptanceCommand(argv, {
        async loadManifest() {
          loads += 1;
          return [];
        },
        writeStdout() {},
      }),
    ).rejects.toThrow(message);
    expect(loads).toBe(0);
  });

  it('emits deterministic machine output and a provenance-explicit human report', async () => {
    const cases = await corpus();
    const machine: string[] = [];
    const code = await runEvaluatePersonAExtractionAcceptanceCommand([], {
      async loadManifest() {
        return cases;
      },
      writeStdout(value) {
        machine.push(value);
      },
    });
    expect(code).toBe(0);
    expect(machine).toEqual([
      serializePersonAExtractionAcceptance(evaluatePersonAExtractionAcceptanceSuite(cases)),
    ]);

    const human = renderPersonAExtractionAcceptanceReport(
      evaluatePersonAExtractionAcceptanceSuite(cases),
    );
    expect(human).toContain('Historical saved outputs: **0/3 accepted**');
    expect(human).toContain('Hand-authored controls: **3/3 accepted**');
    expect(human).toContain('historical_saved_output');
    expect(human).toContain('hand_authored_control');
  });

  it('separates diagnostic success from an unmet gate exit', async () => {
    const acceptanceCase = (await corpus())[1]!;
    const unexpected = {
      ...acceptanceCase,
      candidates: acceptanceCase.candidates.map((candidate) => ({
        ...candidate,
        expectedStatus: 'rejected' as const,
      })),
    };
    const dependencies = {
      async loadManifest() {
        return [unexpected];
      },
      writeStdout() {},
    };
    expect(await runEvaluatePersonAExtractionAcceptanceCommand([], dependencies)).toBe(0);
    expect(await runEvaluatePersonAExtractionAcceptanceCommand(['--gate'], dependencies)).toBe(2);
  });

  it('keeps parser defaults deterministic', () => {
    expect(parseEvaluatePersonAExtractionAcceptanceArgs([])).toMatchObject({
      format: 'json',
      gate: false,
      help: false,
    });
  });
});

function localImports(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const imports: string[] = [];
  const declaration =
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"];?/g;
  for (const match of source.matchAll(declaration)) imports.push(match[1]!);
  return imports;
}

describe('Person A acceptance dependency isolation', () => {
  it('has no provider, environment, network, persistence, runtime, Supabase, or Person B dependency', () => {
    const roots = [
      resolve(process.cwd(), 'src/evaluation/person-a-extraction-acceptance.ts'),
      resolve(process.cwd(), 'src/commands/evaluate-person-a-extraction-acceptance.ts'),
    ];
    const visited = new Set<string>();
    const external = new Set<string>();
    const visit = (path: string): void => {
      if (visited.has(path)) return;
      visited.add(path);
      for (const specifier of localImports(path)) {
        if (!specifier.startsWith('.')) {
          external.add(specifier);
          continue;
        }
        const resolved = resolve(dirname(path), specifier.replace(/\.js$/, '.ts'));
        visit(resolved);
      }
    };
    roots.forEach(visit);

    expect([...external].sort()).toEqual([
      'ajv',
      'ajv-formats',
      'ajv/dist/2020.js',
      'node:crypto',
      'node:fs/promises',
      'node:path',
      'node:url',
    ]);
    for (const path of visited) {
      expect(path).not.toMatch(
        /person-b|openai-responses|person-a-extractor|\/runtime\/|supabase|persistence/i,
      );
    }
  });
});
