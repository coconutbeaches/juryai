/**
 * Browser-safe parser for the canonical read-back wire format.
 *
 * This module deliberately imports nothing: the browser uses it to present the
 * exact server-rendered document, while the server uses the same parser for
 * the fail-closed completeness check. Hashing and canonical case types remain
 * server-only.
 */

export const READBACK_FORMAT_VERSION = 'juryai-readback-v0.3.0';

export type ReadbackBlockType =
  'REQUIREMENT' | 'PROPOSITION' | 'CLARIFICATION' | 'EVIDENCE' | 'NON_ANSWER_RECAP';

export interface ReadbackBlock {
  type: ReadbackBlockType;
  id: string | null;
  fields: Readonly<Record<string, string>>;
}

export interface ParsedReadbackDocument {
  format: string;
  template: string;
  case_id: string;
  case_version: number;
  blocks: ReadbackBlock[];
}

export class ReadbackParseError extends TypeError {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReadbackParseError';
    this.code = code;
  }
}

export function dotStuff(text: string): string[] {
  const normalized = text.replace(/\r\n?/gu, '\n');
  return normalized.split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line));
}

export function dotUnstuff(lines: readonly string[]): string {
  return lines.map((line) => (line.startsWith('..') ? line.slice(1) : line)).join('\n');
}

function parseHeaderLine(line: string | undefined, label: string): string {
  const prefix = `${label}: `;
  if (line === undefined || !line.startsWith(prefix) || line.length === prefix.length) {
    throw new ReadbackParseError('readback_header_invalid', `Invalid ${label} header.`);
  }
  return line.slice(prefix.length);
}

function blockType(value: string): ReadbackBlockType {
  switch (value) {
    case 'REQUIREMENT':
    case 'PROPOSITION':
    case 'CLARIFICATION':
    case 'EVIDENCE':
    case 'NON_ANSWER_RECAP':
      return value;
    default:
      throw new ReadbackParseError('readback_unknown_block', `Unknown read-back block ${value}.`);
  }
}

/** Parse strictly. CR bytes, unknown blocks, duplicate fields and bad closures fail. */
export function parseReadbackDocument(document: string): ParsedReadbackDocument {
  if (document.includes('\r')) {
    throw new ReadbackParseError('readback_newline_invalid', 'Read-back must use LF newlines.');
  }
  if (!document.endsWith('\n')) {
    throw new ReadbackParseError('readback_final_newline_missing', 'Read-back must end with LF.');
  }
  const lines = document.slice(0, -1).split('\n');
  if (lines[0] !== 'JURYAI CANONICAL READ-BACK') {
    throw new ReadbackParseError('readback_header_invalid', 'Read-back title is invalid.');
  }
  const format = parseHeaderLine(lines[1], 'format');
  const template = parseHeaderLine(lines[2], 'template');
  const caseId = parseHeaderLine(lines[3], 'case');
  const versionText = parseHeaderLine(lines[4], 'version');
  if (!/^\d+$/u.test(versionText)) {
    throw new ReadbackParseError('readback_version_invalid', 'Read-back case version is invalid.');
  }
  if (lines[5] !== '') {
    throw new ReadbackParseError(
      'readback_header_invalid',
      'Read-back header must end in a blank line.',
    );
  }

  const blocks: ReadbackBlock[] = [];
  let cursor = 6;
  while (cursor < lines.length) {
    if (lines[cursor] === '') {
      cursor += 1;
      continue;
    }
    const opening = /^\[([A-Z_]+)(?: ([^\]\n]+))?\]$/u.exec(lines[cursor]!);
    if (!opening) {
      throw new ReadbackParseError(
        'readback_block_invalid',
        `Invalid block opening at line ${cursor + 1}.`,
      );
    }
    const type = blockType(opening[1]!);
    const id = opening[2] ?? null;
    if ((type === 'NON_ANSWER_RECAP') !== (id === null)) {
      throw new ReadbackParseError(
        'readback_block_id_invalid',
        `${type} block identity is invalid.`,
      );
    }
    cursor += 1;
    const fields: Record<string, string> = {};
    const closing = `[/${type}]`;
    while (cursor < lines.length && lines[cursor] !== closing) {
      const line = lines[cursor]!;
      const scalar = /^([a-z][a-z0-9_]*):(?: (.*))?$/u.exec(line);
      if (!scalar) {
        throw new ReadbackParseError(
          'readback_field_invalid',
          `Invalid field at line ${cursor + 1}.`,
        );
      }
      const name = scalar[1]!;
      if (Object.prototype.hasOwnProperty.call(fields, name)) {
        throw new ReadbackParseError('readback_duplicate_field', `Duplicate field ${name}.`);
      }
      if (scalar[2] !== undefined) {
        fields[name] = scalar[2];
        cursor += 1;
        continue;
      }
      cursor += 1;
      const content: string[] = [];
      while (cursor < lines.length && lines[cursor] !== '.') {
        const contentLine = lines[cursor]!;
        if (contentLine.startsWith('.') && !contentLine.startsWith('..')) {
          throw new ReadbackParseError(
            'readback_escape_invalid',
            `Invalid dot-stuffed content at line ${cursor + 1}.`,
          );
        }
        content.push(contentLine);
        cursor += 1;
      }
      if (lines[cursor] !== '.') {
        throw new ReadbackParseError('readback_text_unterminated', `Unterminated field ${name}.`);
      }
      fields[name] = dotUnstuff(content);
      cursor += 1;
    }
    if (lines[cursor] !== closing) {
      throw new ReadbackParseError('readback_block_unterminated', `Unterminated ${type} block.`);
    }
    cursor += 1;
    blocks.push({ type, id, fields });
  }

  return {
    format,
    template,
    case_id: caseId,
    case_version: Number(versionText),
    blocks,
  };
}
