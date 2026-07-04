export interface UnicodeStyleOptions {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  underline?: boolean;
}

type UnicodeVariant = 'bold' | 'italic' | 'boldItalic' | 'monospace';

// Bare URL matcher, shared with the X character-weighting logic (each URL
// counts as a fixed 23 characters there). Kept in sync with the URL arm of
// LINKEDIN_TOKEN_PATTERN below.
export const URL_PATTERN = /https?:\/\/[^\s]+/gu;

const LINKEDIN_TOKEN_PATTERN = /(https?:\/\/[^\s]+|[#@][A-Za-z0-9_][A-Za-z0-9_.-]*)/gu;
const EMOJI_PATTERN = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
const COMBINING_MARK_PATTERN = /\p{Mark}/u;

const VARIANT_RANGES = {
  bold: {
    upper: 0x1d5d4,
    lower: 0x1d5ee,
    digit: 0x1d7ec,
  },
  italic: {
    upper: 0x1d608,
    lower: 0x1d622,
  },
  boldItalic: {
    upper: 0x1d63c,
    lower: 0x1d656,
    digit: 0x1d7ec,
  },
  monospace: {
    upper: 0x1d670,
    lower: 0x1d68a,
    digit: 0x1d7f6,
  },
} as const;

export function styleText(text: string, options: UnicodeStyleOptions = {}): string {
  if (!text) {
    return '';
  }

  let result = '';
  let lastIndex = 0;

  for (const match of text.matchAll(LINKEDIN_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    result += styleSegment(text.slice(lastIndex, index), options);
    result += match[0];
    lastIndex = index + match[0].length;
  }

  result += styleSegment(text.slice(lastIndex), options);
  return result;
}

export function applyStrikethrough(text: string): string {
  return applyCombiningMark(text, '\u0336');
}

export function applyUnderline(text: string): string {
  return applyCombiningMark(text, '\u0332');
}

function styleSegment(text: string, options: UnicodeStyleOptions): string {
  const variant = getVariant(options);
  let mapped = variant ? Array.from(text).map((character) => mapAsciiCharacter(character, variant)).join('') : text;

  if (options.underline) {
    mapped = applyUnderline(mapped);
  }

  return options.strike ? applyStrikethrough(mapped) : mapped;
}

// Matches ZWJ (U+200D), VS-16 emoji selector (U+FE0F), and combining
// enclosing keycap (U+20E3) — their presence makes a multi-code-point grapheme
// an emoji sequence that must not be split by a combining mark.
const EMOJI_SEQUENCE_MARK_PATTERN = /[‍️⃣]/u;

function applyCombiningMark(text: string, mark: string): string {
  // Segment by grapheme so ZWJ families, keycaps, and flags stay intact —
  // appending a combining mark inside those clusters splits them apart.
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let result = '';

  for (const { segment } of segmenter.segment(text)) {
    const codePoints = Array.from(segment);
    const firstCodePoint = codePoints[0] ?? '';
    // Skip whitespace, graphemes whose first code point is emoji (flags, ZWJ
    // sequences, single pictographs), pure combining marks, and multi-code-point
    // emoji sequences (keycaps, etc.) identified by ZWJ/VS-16/enclosing-keycap.
    const skip =
      !segment.trim() ||
      EMOJI_PATTERN.test(firstCodePoint) ||
      COMBINING_MARK_PATTERN.test(firstCodePoint) ||
      (codePoints.length > 1 && EMOJI_SEQUENCE_MARK_PATTERN.test(segment));
    if (skip) {
      result += segment;
    } else {
      // Insert the new combining mark right after the base character so that
      // successive calls (e.g. underline then strike) stack marks in a stable
      // order: base + newest mark + any earlier combining marks.
      const rest = codePoints.slice(1).join('');
      result += `${firstCodePoint}${mark}${rest}`;
    }
  }

  return result;
}

function getVariant(options: UnicodeStyleOptions): UnicodeVariant | null {
  if (options.code) {
    return 'monospace';
  }

  if (options.bold && options.italic) {
    return 'boldItalic';
  }

  if (options.bold) {
    return 'bold';
  }

  if (options.italic) {
    return 'italic';
  }

  return null;
}

function mapAsciiCharacter(character: string, variant: UnicodeVariant): string {
  const codePoint = character.codePointAt(0);

  if (codePoint === undefined) {
    return character;
  }

  const ranges = VARIANT_RANGES[variant];

  if (codePoint >= 65 && codePoint <= 90) {
    return String.fromCodePoint(ranges.upper + codePoint - 65);
  }

  if (codePoint >= 97 && codePoint <= 122) {
    return String.fromCodePoint(ranges.lower + codePoint - 97);
  }

  if (codePoint >= 48 && codePoint <= 57 && 'digit' in ranges) {
    return String.fromCodePoint(ranges.digit + codePoint - 48);
  }

  return character;
}