import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { canonicalSerialize } from '../v2/case-envelope.js';
import {
  buildGateZeroCapabilityBaseline,
  validateGateZeroCapabilityBaseline,
} from '../gate-zero/capability-baseline.js';

const writeMode = process.argv.includes('--write');
const jsonMode = process.argv.includes('--json');
const relativePath = 'src/fixtures/gate-zero/current-capability-baseline.json';
const absolutePath = resolve(process.cwd(), relativePath);
const baseline = buildGateZeroCapabilityBaseline();
const bytes = canonicalSerialize(baseline);
const issues = validateGateZeroCapabilityBaseline();

if (issues.length > 0) {
  throw new TypeError(`Gate Zero capability baseline invalid: ${issues.join(', ')}`);
}

if (writeMode) {
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes, 'utf8');
} else {
  let actual = '';
  try {
    actual = await readFile(absolutePath, 'utf8');
  } catch {
    throw new TypeError(`Gate Zero capability baseline missing: ${relativePath}`);
  }
  if (actual !== bytes) {
    throw new TypeError(`Gate Zero capability baseline drift: ${relativePath}`);
  }
}

if (jsonMode) {
  console.log(bytes.trimEnd());
} else {
  console.log(
    `${writeMode ? 'Wrote' : 'Validated'} Gate Zero capability baseline ${baseline.baseline_fingerprint}`,
  );
  console.log(
    `Turns: PASS ${baseline.status_counts.PASS}, FAIL ${baseline.status_counts.FAIL}, NOT_EXECUTABLE ${baseline.status_counts.NOT_EXECUTABLE}, NOT_APPLICABLE ${baseline.status_counts.NOT_APPLICABLE}`,
  );
  console.log(
    `Executable evidence: oracle ${baseline.executable_contract_counts.oracle_validation.PASS}/390, command ${baseline.executable_contract_counts.command_boundary_replay.PASS}/390, disclosure ${baseline.executable_contract_counts.person_b_disclosure_projection.PASS}/75, projection ${baseline.executable_contract_counts.adjudication_input_projection.PASS}/7`,
  );
}
