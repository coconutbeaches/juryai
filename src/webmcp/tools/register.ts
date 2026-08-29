import {
  createJuryAiToolDefinitions,
  type ToolDefinitionOptions,
  type WebMcpToolDefinition,
} from './definitions.js';
import type { CaseServicePort } from './ports.js';

export interface ModelContextLike {
  registerTool(
    tool: WebMcpToolDefinition,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void> | void;
}

export interface RegistrationOptions extends ToolDefinitionOptions {
  signal?: AbortSignal;
}

export interface JuryAiToolRegistration {
  tool_names: readonly ['start_case', 'get_case_state', 'submit_turn'];
  unregister: () => void;
}

/**
 * Register the three JuryAI P2 V0.2 tools with document.modelContext.
 *
 * The caller supplies document.modelContext rather than this module reading the
 * global document directly. That keeps this transport layer testable in the
 * existing Node-based JuryAI lab and avoids requiring a web framework here.
 */
export async function registerJuryAiWebMcpTools(
  modelContext: ModelContextLike,
  service: CaseServicePort,
  options: RegistrationOptions = {},
): Promise<JuryAiToolRegistration> {
  const controller = new AbortController();
  const externalSignal = options.signal;

  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason);
    throw externalSignal.reason ?? new Error('WebMCP registration aborted');
  }

  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  const definitions = createJuryAiToolDefinitions(service, options);

  try {
    for (const tool of definitions) {
      await modelContext.registerTool(tool, { signal: controller.signal });
    }
  } catch (error) {
    controller.abort(error);
    externalSignal?.removeEventListener('abort', onExternalAbort);
    throw error;
  }

  return {
    tool_names: ['start_case', 'get_case_state', 'submit_turn'],
    unregister: () => {
      externalSignal?.removeEventListener('abort', onExternalAbort);
      controller.abort();
    },
  };
}
