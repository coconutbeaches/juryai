import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { canonicalSerialize } from '../v2/case-envelope.js';
import {
  GATE_ZERO_CORPUS,
  buildGateZeroCorpusManifest,
  validateGateZeroCorpus,
} from '../gate-zero/corpus.js';

const writeMode = process.argv.includes('--write');
const root = process.cwd();
const manifest = buildGateZeroCorpusManifest();
const expected = new Map<string, string>([
  ['src/fixtures/gate-zero/manifest.json', canonicalSerialize(manifest)],
  ...GATE_ZERO_CORPUS.map(
    (fixture) =>
      [
        `src/fixtures/gate-zero/cases/${fixture.case_id}.json`,
        canonicalSerialize(fixture),
      ] as const,
  ),
]);

const issues = validateGateZeroCorpus();
if (issues.length > 0) {
  throw new TypeError(`Gate Zero corpus contract invalid: ${issues.join(', ')}`);
}

for (const [relativePath, bytes] of expected) {
  const absolutePath = resolve(root, relativePath);
  if (writeMode) {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes, 'utf8');
  } else {
    let actual = '';
    try {
      actual = await readFile(absolutePath, 'utf8');
    } catch {
      throw new TypeError(`Gate Zero frozen artifact missing: ${relativePath}`);
    }
    if (actual !== bytes) {
      throw new TypeError(`Gate Zero frozen artifact drift: ${relativePath}`);
    }
  }
}

console.log(
  `${writeMode ? 'Wrote' : 'Validated'} ${manifest.case_count} Gate Zero cases / ${manifest.turn_count} turns; corpus fingerprint ${manifest.corpus_fingerprint}`,
);
