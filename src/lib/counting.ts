import { URL_PATTERN } from './unicodeStyles';

// How a platform measures post length against its limit.
// - 'nfc-codepoints': Unicode code points after NFC normalization.
// - 'nfc-utf16': UTF-16 code units after NFC normalization (JS String.length).
//   Astral characters (code points > U+FFFF, e.g. mathematical alphanumerics,
//   emoji) count as 2. This matches LinkedIn's composer limit enforcement.
// - 'graphemes': user-perceived characters / grapheme clusters (Bluesky).
// - 'x-weighted': X/Twitter's weighted scheme — most characters count as 1,
//   wide ranges (CJK, emoji) as 2, and each URL as a fixed 23.
// - 'mastodon': like nfc-codepoints, but every URL counts as a flat 23 (Mastodon
//   counts links as 23 chars; unlike X it does NOT weight CJK/emoji as 2).
export type CountingMethod = 'nfc-codepoints' | 'nfc-utf16' | 'graphemes' | 'x-weighted' | 'mastodon';

const URL_WEIGHT = 23;

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function countCharacters(text: string, method: CountingMethod): number {
  const normalized = text.normalize('NFC');

  switch (method) {
    case 'nfc-utf16':
      return normalized.length;
    case 'graphemes':
      return countGraphemes(normalized);
    case 'x-weighted':
      return countXWeighted(normalized);
    case 'mastodon':
      return countMastodon(normalized);
    case 'nfc-codepoints':
    default:
      return Array.from(normalized).length;
  }
}

// Code points, but each URL counts as a flat 23 (Mastodon's rule). No CJK/emoji
// doubling. Approximation: a mention's instance domain isn't excluded (OmniPost's
// @[Name] tokens have no domain to strip).
function countMastodon(normalized: string): number {
  const urlPattern = new RegExp(URL_PATTERN.source, 'gu');
  let count = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(normalized)) !== null) {
    count += Array.from(normalized.slice(lastIndex, match.index)).length;
    count += URL_WEIGHT;
    lastIndex = match.index + match[0].length;
  }

  count += Array.from(normalized.slice(lastIndex)).length;
  return count;
}

function countGraphemes(normalized: string): number {
  if (!graphemeSegmenter) {
    return Array.from(normalized).length;
  }

  let count = 0;
  for (const _segment of graphemeSegmenter.segment(normalized)) {
    count += 1;
  }

  return count;
}

// Port of twitter-text's default weighted counting (scale 100 collapsed to 1):
// URLs are a flat 23, "light" Unicode ranges weigh 1, everything else weighs 2.
// Approximation: emoji ZWJ sequences are counted per code point rather than as
// a single weight-2 glyph, so they over-count. Surfaced via the X disclaimer.
function countXWeighted(normalized: string): number {
  const urlPattern = new RegExp(URL_PATTERN.source, 'gu');
  let weighted = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(normalized)) !== null) {
    weighted += weightOfRange(normalized.slice(lastIndex, match.index));
    weighted += URL_WEIGHT;
    lastIndex = match.index + match[0].length;
  }

  weighted += weightOfRange(normalized.slice(lastIndex));
  return weighted;
}

function weightOfRange(text: string): number {
  let total = 0;

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    total += isLightCodePoint(codePoint) ? 1 : 2;
  }

  return total;
}

function isLightCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0 && codePoint <= 4351) ||
    (codePoint >= 8192 && codePoint <= 8205) ||
    (codePoint >= 8208 && codePoint <= 8223) ||
    (codePoint >= 8242 && codePoint <= 8247)
  );
}
