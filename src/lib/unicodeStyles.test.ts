import { describe, expect, it } from 'vitest';

import { applyStrikethrough, applyUnderline, styleText } from './unicodeStyles';

describe('styleText', () => {
  it('maps ASCII letters and digits to sans-serif bold Unicode characters', () => {
    expect(styleText('Abc 123', { bold: true })).toBe('𝗔𝗯𝗰 𝟭𝟮𝟯');
  });

  it('maps italic text to sans-serif italic Unicode characters', () => {
    expect(styleText('Ahz', { italic: true })).toBe('𝘈𝘩𝘻');
  });

  it('maps bold italic text to sans-serif characters while leaving punctuation alone', () => {
    expect(styleText('Hi!', { bold: true, italic: true })).toBe('𝙃𝙞!');
  });

  it('maps code text to monospace Unicode characters', () => {
    expect(styleText('Code 9', { code: true })).toBe('𝙲𝚘𝚍𝚎 𝟿');
  });

  it('keeps hashtags, mentions, and URLs parseable when styling surrounding text', () => {
    expect(styleText('Post #LinkedIn @Ada https://example.com', { bold: true })).toBe(
      '𝗣𝗼𝘀𝘁 #LinkedIn @Ada https://example.com',
    );
  });

  it('can apply experimental strikethrough to non-whitespace characters', () => {
    expect(applyStrikethrough('a b')).toBe('a̶ b̶');
  });

  it('can apply experimental underline to non-whitespace characters', () => {
    expect(applyUnderline('a b')).toBe('a̲ b̲');
    expect(styleText('Underlined #LinkedIn', { underline: true })).toBe('U̲n̲d̲e̲r̲l̲i̲n̲e̲d̲ #LinkedIn');
  });

  it('preserves emoji when applying combining styles', () => {
    expect(styleText('Ship 🚀 now', { underline: true, strike: true })).toBe('S̶̲h̶̲i̶̲p̶̲ 🚀 n̶̲o̶̲w̶̲');
  });

  it('does not break ZWJ emoji sequences when striking through', () => {
    expect(applyStrikethrough('a👨‍👩‍👧b')).toBe('a̶👨‍👩‍👧b̶');
  });

  it('does not break keycap sequences when underlining', () => {
    expect(applyUnderline('x1️⃣y')).toBe('x̲1️⃣y̲');
  });

  it('does not break flag emoji when striking through', () => {
    expect(applyStrikethrough('🇳🇱ok')).toBe('🇳🇱o̶k̶');
  });

  it('still marks plain ascii and digits', () => {
    expect(applyUnderline('a1')).toBe('a̲1̲');
  });
});