/**
 * JuryAI P2 V0.2 case-formation runtime.
 *
 * Layering:
 *
 *   WebMCP adapter  ->  thin service adapter  ->  THIS RUNTIME  ->  core
 *
 * The runtime knows nothing about tool registration, HTTP, or sessions. A
 * transport resolves an authenticated principal into a `RuntimeRequestContext`
 * and renames outcomes; it adds no rules of its own.
 */

export * from './compiler-port.js';
export * from './ids.js';
export * from './in-memory-repositories.js';
export * from './initial-requirements.js';
export * from './mutation-application.js';
export * from './repositories.js';
export * from './results.js';
export * from './runtime.js';
export * from './scripted-compiler.js';
