import { extractResponseText } from '../extraction/openai-responses.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';

type JsonObject = Record<string, any>;

export type PersonASourceSpanDiagnostic = {
  path: string;
  quote: string;
  raw_start_char: number | null;
  raw_end_char: number | null;
  raw_exact: boolean;
  quote_occurrences: number;
  assembled_start_char: number | null;
  assembled_end_char: number | null;
  assembled_exact: boolean | null;
  offsets_repaired: boolean;
  status:
    | 'raw_exact'
    | 'repaired_to_unique_quote'
    | 'ambiguous_quote_not_repaired'
    | 'quote_not_found'
    | 'invalid_raw_offsets'
    | 'assembled_span_missing'
    | 'assembled_span_still_invalid';
};

export type PersonASourceSpanDiagnostics = {
  version: 'person-a-source-span-diagnostics-v1';
  raw_model: {
    total_spans: number;
    exact_spans: number;
    failing_spans: number;
    exact_accuracy: number;
  };
  assembler: {
    repaired_spans: number;
    ambiguous_quote_spans: number;
    missing_quote_spans: number;
  };
  assembled: {
    available: boolean;
    total_spans: number;
    exact_spans: number;
    failing_spans: number;
    exact_accuracy: number | null;
  };
  final_invariants: {
    evaluated: boolean;
    schema_valid: boolean | null;
    invariants_valid: boolean | null;
    exact_source_slice_valid: boolean | null;
  };
  spans: PersonASourceSpanDiagnostic[];
};

type CollectedSpan = {
  path: string;
  quote: unknown;
  start_char: unknown;
  end_char: unknown;
};

function collectSourceSpans(value: unknown): CollectedSpan[] {
  const spans: CollectedSpan[] = [];
  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!current || typeof current !== 'object') return;
    const object = current as JsonObject;
    if (Array.isArray(object.source_spans)) {
      object.source_spans.forEach((span: JsonObject, index: number) => {
        spans.push({
          path: `${path}.source_spans[${index}]`,
          quote: span?.quote,
          start_char: span?.start_char,
          end_char: span?.end_char,
        });
      });
    }
    for (const [key, child] of Object.entries(object)) {
      if (key !== 'source_spans') visit(child, `${path}.${key}`);
    }
  };
  visit(value, '$');
  return spans.sort((left, right) => left.path.localeCompare(right.path));
}

function exactSlice(span: CollectedSpan, narrative: string): boolean {
  return (
    typeof span.quote === 'string' &&
    Number.isInteger(span.start_char) &&
    Number.isInteger(span.end_char) &&
    (span.start_char as number) >= 0 &&
    (span.end_char as number) >= (span.start_char as number) &&
    (span.end_char as number) <= narrative.length &&
    (span.end_char as number) - (span.start_char as number) === span.quote.length &&
    narrative.slice(span.start_char as number, span.end_char as number) === span.quote
  );
}

function quoteOccurrences(narrative: string, quote: unknown): number[] {
  if (typeof quote !== 'string' || quote.length === 0) return [];
  const starts: number[] = [];
  let cursor = 0;
  while (cursor <= narrative.length - quote.length) {
    const found = narrative.indexOf(quote, cursor);
    if (found < 0) break;
    starts.push(found);
    cursor = found + 1;
  }
  return starts;
}

export function parsePersonAModelOutputFromRawResponse(rawResponse: unknown): JsonObject {
  const text = extractResponseText(rawResponse);
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Saved raw response structured output was not a JSON object.');
  }
  return parsed as JsonObject;
}

export function diagnosePersonASourceSpans(options: {
  modelOutput: JsonObject;
  narrative: string;
  assembledExtraction?: JsonObject;
}): PersonASourceSpanDiagnostics {
  const rawSpans = collectSourceSpans(options.modelOutput);
  const assembledSpans = options.assembledExtraction
    ? collectSourceSpans(options.assembledExtraction)
    : [];
  const assembledByPath = new Map(assembledSpans.map((span) => [span.path, span]));
  const diagnostics = rawSpans.map((raw): PersonASourceSpanDiagnostic => {
    const assembled = assembledByPath.get(raw.path);
    const rawExact = exactSlice(raw, options.narrative);
    const occurrences = quoteOccurrences(options.narrative, raw.quote);
    const assembledExact = assembled ? exactSlice(assembled, options.narrative) : null;
    const offsetsRepaired =
      !rawExact &&
      assembledExact === true &&
      (raw.start_char !== assembled?.start_char || raw.end_char !== assembled?.end_char);
    let status: PersonASourceSpanDiagnostic['status'];
    if (rawExact) status = 'raw_exact';
    else if (offsetsRepaired && occurrences.length === 1) status = 'repaired_to_unique_quote';
    else if (occurrences.length > 1) status = 'ambiguous_quote_not_repaired';
    else if (occurrences.length === 0) status = 'quote_not_found';
    else if (!assembled) status = 'assembled_span_missing';
    else if (assembledExact === false) status = 'assembled_span_still_invalid';
    else status = 'invalid_raw_offsets';
    return {
      path: raw.path,
      quote: typeof raw.quote === 'string' ? raw.quote : '',
      raw_start_char:
        typeof raw.start_char === 'number' && Number.isInteger(raw.start_char)
          ? raw.start_char
          : null,
      raw_end_char:
        typeof raw.end_char === 'number' && Number.isInteger(raw.end_char) ? raw.end_char : null,
      raw_exact: rawExact,
      quote_occurrences: occurrences.length,
      assembled_start_char:
        assembled &&
        typeof assembled.start_char === 'number' &&
        Number.isInteger(assembled.start_char)
          ? assembled.start_char
          : null,
      assembled_end_char:
        assembled && typeof assembled.end_char === 'number' && Number.isInteger(assembled.end_char)
          ? assembled.end_char
          : null,
      assembled_exact: assembledExact,
      offsets_repaired: offsetsRepaired,
      status,
    };
  });

  const rawExact = diagnostics.filter((span) => span.raw_exact).length;
  const assembledExact = diagnostics.filter((span) => span.assembled_exact === true).length;
  const validation = options.assembledExtraction
    ? validatePersonAExtraction(options.assembledExtraction, options.narrative)
    : null;
  const sourceSliceValid =
    validation === null
      ? null
      : !validation.invariantErrors.some((issue) => /source span/iu.test(issue.message));
  return {
    version: 'person-a-source-span-diagnostics-v1',
    raw_model: {
      total_spans: diagnostics.length,
      exact_spans: rawExact,
      failing_spans: diagnostics.length - rawExact,
      exact_accuracy: diagnostics.length === 0 ? 1 : rawExact / diagnostics.length,
    },
    assembler: {
      repaired_spans: diagnostics.filter((span) => span.offsets_repaired).length,
      ambiguous_quote_spans: diagnostics.filter((span) => span.quote_occurrences > 1).length,
      missing_quote_spans: diagnostics.filter((span) => span.quote_occurrences === 0).length,
    },
    assembled: {
      available: options.assembledExtraction !== undefined,
      total_spans: options.assembledExtraction ? diagnostics.length : 0,
      exact_spans: options.assembledExtraction ? assembledExact : 0,
      failing_spans: options.assembledExtraction ? diagnostics.length - assembledExact : 0,
      exact_accuracy:
        options.assembledExtraction === undefined
          ? null
          : diagnostics.length === 0
            ? 1
            : assembledExact / diagnostics.length,
    },
    final_invariants: {
      evaluated: validation !== null,
      schema_valid: validation === null ? null : validation.schemaErrors.length === 0,
      invariants_valid:
        validation === null
          ? null
          : validation.schemaErrors.length === 0 && validation.invariantErrors.length === 0,
      exact_source_slice_valid: sourceSliceValid,
    },
    spans: diagnostics,
  };
}
