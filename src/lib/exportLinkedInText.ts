// Compatibility shim. The generalized renderer now lives in exportText.ts and
// the counting/status helpers in counting.ts + constants.ts; this module keeps
// the LinkedIn-named API that the web app, the browser extension, and the
// existing test suite import.
import { LINKEDIN_POST_CHARACTER_LIMIT, getCharacterCountStatus } from './constants';
import { countCharacters } from './counting';
import { exportText, type EditorNode } from './exportText';

export type { EditorMark, EditorNode } from './exportText';

export function exportLinkedInText(document: EditorNode | null | undefined): string {
  return exportText(document, { unicodeStyling: true });
}

export function countLinkedInCharacters(text: string): number {
  // LinkedIn's composer counts UTF-16 code units, not code points.  Every
  // styled glyph this app emits (mathematical alphanumerics, U+1D400+) is an
  // astral character that occupies 2 UTF-16 units — 'nfc-codepoints' would
  // undercount them by half, causing apparent-safe posts to be rejected.
  return countCharacters(text, 'nfc-utf16');
}

export function getLinkedInCharacterStatus(text: string) {
  return getCharacterCountStatus(countLinkedInCharacters(text));
}

export function getLinkedInCharacterSummary(text: string) {
  const count = countLinkedInCharacters(text);

  return {
    count,
    limit: LINKEDIN_POST_CHARACTER_LIMIT,
    remaining: LINKEDIN_POST_CHARACTER_LIMIT - count,
    status: getCharacterCountStatus(count),
  };
}
