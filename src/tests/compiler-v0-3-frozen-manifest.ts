/**
 * SHA-256 of every file in the frozen V0.3 compiler trees, captured at
 * `d7e9d2af679bde3bf4436a231dfc92946af85bfd`.
 *
 * PR 8C1a introduces compiler contract V0.4 as a NEW artefact. V0.3 must not
 * become configurable, must not gain a policy flag, and must not be "tidied"
 * while V0.4 is written next to it — every proposition ever compiled carries
 * the id of the prompt and contract that produced it, so a byte change to V0.3
 * silently rewrites the meaning of historical evidence.
 *
 * A git diff would catch this too, but only in review. A hash manifest fails in
 * the developer's own test run, at the moment the edit is made.
 */
export const COMPILER_V0_3_FROZEN_MANIFEST: Readonly<Record<string, string>> = Object.freeze({
  'src/webmcp/compiler-v0-3/config.ts':
    '125cd7f6745dacd79a51a3319d18d2ccbf192afed09ca7d62502189f087a16c7',
  'src/webmcp/compiler-v0-3/model-compiler.ts':
    '3243b617d52a61c5eb5fffd54c62817eb278377192ea82e38ff4c76c3e0d0226',
  'src/webmcp/compiler-v0-3/parse-draft.ts':
    'f380109c6619dd1bab35972a70e6ecac71fcce0434cdf1effb7a7a8e64780784',
  'src/webmcp/compiler-v0-3/prompt.ts':
    '6c7d3ed060aecdd3ef7d3e1379b42e4e9d5321ec70eaadaefdfb7425922ffe77',
  'src/webmcp/compiler-v0-3/render-input.ts':
    '844cefba6517b5a010ebd8302de9553355007136669b3fd7335efb29f17fdc40',
  'src/webmcp/compiler-v0-3/response-schema.ts':
    '4e54633714d1625e52e768b87f6bfba24bff3ef815e5106135f671b4808c5335',
  'src/webmcp/core-v0-3/compiler-contract.ts':
    '243cc9a65cb024b2711f66bbfd28dfe4ff080816f1b35cdfb6b051a8f78d95a1',
  'src/webmcp/core-v0-3/explicit-absence.ts':
    'fee6dcc66e655c6cefae9208a6e9165a77a02bbbba46004ae175e3f2cabb10b6',
  'src/webmcp/core-v0-3/propositions.ts':
    'cd9afb0d4092d8cc6dd4e7591ffa416a45188152ee34153da4465d448ef038a8',
  'src/webmcp/core-v0-3/requirements.ts':
    '6009e104eef574761eec75be7cbbbddc940dd65d5cc341b29f9ecf8f2dc7dcc3',
  'src/webmcp/core-v0-3/types.ts':
    '56794658bdc69e9a2b4f05e74ad53a645637d77e46f10155bac99b9a7c61f584',
});
