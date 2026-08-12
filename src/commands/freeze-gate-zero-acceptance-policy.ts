import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { canonicalSerialize } from '../v2/case-envelope.js';
import {
  buildGateZeroAcceptancePolicy,
  validateGateZeroAcceptancePolicy,
} from '../gate-zero/acceptance-policy.js';

const writeMode = process.argv.includes('--write');
const relativePath = 'src/fixtures/gate-zero/acceptance-policy.json';
const absolutePath = resolve(process.cwd(), relativePath);
const policy = buildGateZeroAcceptancePolicy();
const bytes = canonicalSerialize(policy);
const issues = validateGateZeroAcceptancePolicy();

if (issues.length > 0) {
  throw new TypeError(`Gate Zero acceptance policy invalid: ${issues.join(', ')}`);
}

if (writeMode) {
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes, 'utf8');
} else {
  let actual = '';
  try {
    actual = await readFile(absolutePath, 'utf8');
  } catch {
    throw new TypeError(`Gate Zero acceptance policy missing: ${relativePath}`);
  }
  if (actual !== bytes) {
    throw new TypeError(`Gate Zero acceptance policy drift: ${relativePath}`);
  }
}

console.log(
  `${writeMode ? 'Wrote' : 'Validated'} Gate Zero acceptance policy ${policy.policy_fingerprint}`,
);
console.log(
  `Frozen gates: ${policy.hard_gates.length} hard, ${policy.zero_tolerance_gates.length} zero-tolerance, ${policy.model_quality_gates.length} model-quality`,
);
console.log(
  `Decision: architecture runtime-ready=${policy.current_decision.architecture_ready_for_runtime_implementation}; current product=${policy.current_decision.current_product_gate_zero_status}; GZ6 started=${policy.current_decision.gz6_started}`,
);
