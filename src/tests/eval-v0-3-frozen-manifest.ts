/**
 * SHA-256 of the historical V0.3-era evaluator, captured at
 * `e701f9834ce9f913ebf0c26dea3081079350ab49`.
 *
 * PR 8C1b-0 builds a PARALLEL V0.4 oracle rather than rewriting this one. The
 * historical evaluator remains useful regression evidence for the V0.2/V0.3
 * pipeline, and rewriting its semantics in place would destroy that evidence
 * while making the diff impossible to review. The manifest turns "we did not
 * touch it" from a claim into a test.
 */
export const HISTORICAL_EVAL_FROZEN_MANIFEST: Readonly<Record<string, string>> = Object.freeze({
  'src/webmcp/eval/corpus.ts': '8b278aac76a92dfcdda582ac866213f67efef85513116a065db90d63556785f7',
  'src/webmcp/eval/graders.ts': 'fa643c84420b80a2e4a0af076dd466202528842cb891e2768ed6dc53111e14c3',
  'src/webmcp/eval/index.ts': '73b7fd1d97866e2e24e87e1f10e38ab2b8a15f75f243643fc9fa9a0f042cb0b9',
  'src/webmcp/eval/offline.ts': '67752aedb70eac5eb26113c7ca6236f4b15c302b3dfdad82a0d42b6b988337a8',
  'src/webmcp/eval/report.ts': '127a02b1e5419539314b3226199384edeb72c29195c333d6485c11a416b5fa60',
  'src/webmcp/eval/runner.ts': '08cf3b844fd187f04e9ef83994d7443b9d72119e47a9d8e70645d2ac56ef682a',
  'src/webmcp/eval/scenario.ts': '1ca54c5785fb53460c9f54ddf8768c7fe02af103870ee0ab05a8314461b92d0a',
  'src/webmcp/eval/types.ts': 'e4e68b6a55b478c0131a6bec5f758511ae30b2fa81b945fa9766196b06bd4b67',
});
