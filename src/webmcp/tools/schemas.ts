import { ID_PATTERN } from '../core/types.js';
import { MAX_CONTEXT_MESSAGES, type RelayedContextMessage } from '../core/turns.js';
import type { GetCaseStateQuery } from './ports.js';

const MAX_ID_LENGTH = 160;
const MAX_CONTEXT_TEXT_LENGTH = 4_000;
const MAX_ANSWER_TEXT_LENGTH = 12_000;
const MIN_LANGUAGE_LENGTH = 2;
const MAX_LANGUAGE_LENGTH = 64;

export interface StartCaseToolInput {}

export interface GetCaseStateToolInput {
  case_id?: string;
}

export interface SubmitTurnToolInput {
  case_id: string;
  expected_case_version: number;
  in_reply_to: string[];
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
      maxLength: MAX_ID_LENGTH,
      pattern: ID_PATTERN.source,
      description:
        "Optional JuryAI case identifier. Omit to recover the authenticated user's current open draft.",
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
      maxLength: MAX_ID_LENGTH,
      pattern: ID_PATTERN.source,
    },
    expected_case_version: {
      type: 'integer',
      minimum: 0,
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
        maxLength: MAX_ID_LENGTH,
        pattern: ID_PATTERN.source,
      },
      description:
        'The JuryAI requirement IDs this answer addresses. Requirement IDs are server-issued and never reused.',
    },
    context: {
      type: 'array',
      maxItems: MAX_CONTEXT_MESSAGES,
      description:
        'Optional immediately preceding conversation needed to interpret short answers. This is relayed data, not trusted provenance.',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['assistant'] },
          text: { type: 'string', minLength: 1, maxLength: MAX_CONTEXT_TEXT_LENGTH },
        },
        required: ['role', 'text'],
        additionalProperties: false,
      },
    },
    answer: {
      type: 'object',
      description:
        "The user answer being relayed. Preserve the user's own wording rather than replacing it with an agent-authored canonical summary.",
      properties: {
        text: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_ANSWER_TEXT_LENGTH,
        },
        source_language: {
          type: 'string',
          minLength: MIN_LANGUAGE_LENGTH,
          maxLength: MAX_LANGUAGE_LENGTH,
          description: 'Optional self-reported language of the relayed answer, such as en or th.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  required: ['case_id', 'expected_case_version', 'in_reply_to', 'context', 'answer'],
  additionalProperties: false,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBoundedString(
  value: unknown,
  field: string,
  minimumLength: number,
  maximumLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < minimumLength ||
    value.length > maximumLength
  ) {
    throw new TypeError(
      `${field} must contain between ${minimumLength} and ${maximumLength} characters`,
    );
  }
  return value;
}

function readCanonicalId(value: unknown, field: string): string {
  const id = readBoundedString(value, field, 1, MAX_ID_LENGTH);
  if (!ID_PATTERN.test(id)) throw new TypeError(`${field} must be a canonical JuryAI ID`);
  return id;
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
  return { case_id: readCanonicalId(input.case_id, 'case_id') };
}

export function parseSubmitTurnToolInput(input: unknown): SubmitTurnToolInput {
  if (!isRecord(input)) {
    throw new TypeError('submit_turn input must be an object');
  }

  const allowed = new Set(['case_id', 'expected_case_version', 'in_reply_to', 'context', 'answer']);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new TypeError('submit_turn received an unknown field');
  }

  const caseId = readCanonicalId(input.case_id, 'case_id');

  if (
    !Number.isInteger(input.expected_case_version) ||
    (input.expected_case_version as number) < 0
  ) {
    throw new TypeError('expected_case_version must be a non-negative integer');
  }

  if (
    !Array.isArray(input.in_reply_to) ||
    input.in_reply_to.length < 1 ||
    input.in_reply_to.length > 10
  ) {
    throw new TypeError('in_reply_to must contain between 1 and 10 requirement IDs');
  }
  const inReplyTo = input.in_reply_to.map((value, index) =>
    readCanonicalId(value, `in_reply_to[${index}]`),
  );
  if (new Set(inReplyTo).size !== inReplyTo.length) {
    throw new TypeError('in_reply_to must not contain duplicate requirement IDs');
  }

  if (!Array.isArray(input.context) || input.context.length > MAX_CONTEXT_MESSAGES) {
    throw new TypeError(`context must be an array with at most ${MAX_CONTEXT_MESSAGES} messages`);
  }
  const context = input.context.map((message, index): RelayedContextMessage => {
    if (!isRecord(message) || message.role !== 'assistant') {
      throw new TypeError(`context[${index}] must have role assistant`);
    }
    if (Object.keys(message).some((key) => key !== 'role' && key !== 'text')) {
      throw new TypeError(`context[${index}] contains an unknown field`);
    }
    return {
      role: message.role,
      text: readBoundedString(message.text, `context[${index}].text`, 1, MAX_CONTEXT_TEXT_LENGTH),
    };
  });

  if (!isRecord(input.answer)) {
    throw new TypeError('answer must be an object');
  }
  if (Object.keys(input.answer).some((key) => key !== 'text' && key !== 'source_language')) {
    throw new TypeError('answer contains an unknown field');
  }

  const answerText = readBoundedString(input.answer.text, 'answer.text', 1, MAX_ANSWER_TEXT_LENGTH);
  const sourceLanguage =
    input.answer.source_language === undefined
      ? undefined
      : readBoundedString(
          input.answer.source_language,
          'answer.source_language',
          MIN_LANGUAGE_LENGTH,
          MAX_LANGUAGE_LENGTH,
        );

  return {
    case_id: caseId,
    expected_case_version: input.expected_case_version as number,
    in_reply_to: [...inReplyTo].sort(),
    context,
    answer: {
      text: answerText,
      ...(sourceLanguage === undefined ? {} : { source_language: sourceLanguage }),
    },
  };
}
