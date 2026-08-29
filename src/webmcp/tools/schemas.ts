import type { GetCaseStateQuery, RelayedContextMessage } from './ports.js';

export interface StartCaseToolInput {}

export interface GetCaseStateToolInput {
  case_id?: string;
}

export interface SubmitTurnToolInput {
  case_id: string;
  expected_case_version: number;
  in_reply_to: string[];
  response_slot_id: string;
  context: RelayedContextMessage[];
  answer: {
    text: string;
    source_language?: string;
  };
}

export const startCaseInputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

export const getCaseStateInputSchema = {
  type: 'object',
  properties: {
    case_id: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description: 'Optional JuryAI case identifier. Omit to recover the authenticated user\'s current open draft.',
    },
  },
  additionalProperties: false,
} as const;

export const submitTurnInputSchema = {
  type: 'object',
  properties: {
    case_id: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
    },
    expected_case_version: {
      type: 'integer',
      minimum: 1,
      description: 'The case version observed when this interview turn was prepared.',
    },
    in_reply_to: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
      },
      description: 'The JuryAI requirement IDs this answer addresses. Requirement IDs are server-issued and never reused.',
    },
    response_slot_id: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description: 'The server-issued logical response slot for this interview answer.',
    },
    context: {
      type: 'array',
      maxItems: 6,
      description: 'Optional immediately preceding conversation needed to interpret short answers. This is relayed data, not trusted provenance.',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['assistant', 'user'] },
          text: { type: 'string', minLength: 1, maxLength: 4000 },
        },
        required: ['role', 'text'],
        additionalProperties: false,
      },
    },
    answer: {
      type: 'object',
      description: 'The user answer being relayed. Preserve the user\'s own wording rather than replacing it with an agent-authored canonical summary.',
      properties: {
        text: {
          type: 'string',
          minLength: 1,
          maxLength: 12000,
        },
        source_language: {
          type: 'string',
          minLength: 2,
          maxLength: 64,
          description: 'Optional self-reported language of the relayed answer, such as en or th.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  required: ['case_id', 'expected_case_version', 'in_reply_to', 'response_slot_id', 'context', 'answer'],
  additionalProperties: false,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

export function parseStartCaseToolInput(input: unknown): StartCaseToolInput {
  if (!isRecord(input) || Object.keys(input).length !== 0) {
    throw new TypeError('start_case does not accept arguments');
  }
  return {};
}

export function parseGetCaseStateToolInput(input: unknown): GetCaseStateQuery {
  if (!isRecord(input)) {
    throw new TypeError('get_case_state input must be an object');
  }

  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'case_id')) {
    throw new TypeError('get_case_state received an unknown field');
  }

  if (input.case_id === undefined) return {};
  return { case_id: readNonEmptyString(input.case_id, 'case_id') };
}

export function parseSubmitTurnToolInput(input: unknown): SubmitTurnToolInput {
  if (!isRecord(input)) {
    throw new TypeError('submit_turn input must be an object');
  }

  const allowed = new Set([
    'case_id',
    'expected_case_version',
    'in_reply_to',
    'response_slot_id',
    'context',
    'answer',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new TypeError('submit_turn received an unknown field');
  }

  const caseId = readNonEmptyString(input.case_id, 'case_id');
  const responseSlotId = readNonEmptyString(input.response_slot_id, 'response_slot_id');

  if (!Number.isInteger(input.expected_case_version) || (input.expected_case_version as number) < 1) {
    throw new TypeError('expected_case_version must be a positive integer');
  }

  if (!Array.isArray(input.in_reply_to) || input.in_reply_to.length < 1 || input.in_reply_to.length > 10) {
    throw new TypeError('in_reply_to must contain between 1 and 10 requirement IDs');
  }
  const inReplyTo = input.in_reply_to.map((value, index) => readNonEmptyString(value, `in_reply_to[${index}]`));
  if (new Set(inReplyTo).size !== inReplyTo.length) {
    throw new TypeError('in_reply_to must not contain duplicate requirement IDs');
  }

  if (!Array.isArray(input.context) || input.context.length > 6) {
    throw new TypeError('context must be an array with at most 6 messages');
  }
  const context = input.context.map((message, index): RelayedContextMessage => {
    if (!isRecord(message) || (message.role !== 'assistant' && message.role !== 'user')) {
      throw new TypeError(`context[${index}] must have role assistant or user`);
    }
    if (Object.keys(message).some((key) => key !== 'role' && key !== 'text')) {
      throw new TypeError(`context[${index}] contains an unknown field`);
    }
    return {
      role: message.role,
      text: readNonEmptyString(message.text, `context[${index}].text`),
    };
  });

  if (!isRecord(input.answer)) {
    throw new TypeError('answer must be an object');
  }
  if (Object.keys(input.answer).some((key) => key !== 'text' && key !== 'source_language')) {
    throw new TypeError('answer contains an unknown field');
  }

  const answerText = readNonEmptyString(input.answer.text, 'answer.text');
  const sourceLanguage =
    input.answer.source_language === undefined
      ? undefined
      : readNonEmptyString(input.answer.source_language, 'answer.source_language');

  return {
    case_id: caseId,
    expected_case_version: input.expected_case_version as number,
    in_reply_to: inReplyTo,
    response_slot_id: responseSlotId,
    context,
    answer: {
      text: answerText,
      ...(sourceLanguage === undefined ? {} : { source_language: sourceLanguage }),
    },
  };
}
