import { LINKEDIN_POST_CHARACTER_LIMIT, LINKEDIN_POST_WARNING_THRESHOLD } from '../constants';
import { FEED_CUTOFF_CONFIG } from '../feedPreview';
import type { PlatformSpec } from './types';

export const LINKEDIN_COMPOSER_URL = 'https://www.linkedin.com/feed/?shareActive=true';

export const linkedinSpec: PlatformSpec = {
  id: 'linkedin',
  label: 'LinkedIn',
  brandColor: '#0a66c2',
  charLimit: LINKEDIN_POST_CHARACTER_LIMIT,
  warningThreshold: LINKEDIN_POST_WARNING_THRESHOLD,
  // LinkedIn's composer enforces its 3,000-character limit in UTF-16 code units.
  // Every mathematical alphanumeric / styled glyph this app produces (U+1D400+)
  // is an astral character that requires a surrogate pair — 2 UTF-16 units — so
  // 'nfc-codepoints' would silently undercount styled posts by up to 2×.
  counting: 'nfc-utf16',
  allowUnicodeStyling: true,
  // The extension resolves @[Name] into a real LinkedIn mention, so keep the full
  // spaced "@Display Name".
  keepMentionSpaces: true,
  truncation: {
    desktop: FEED_CUTOFF_CONFIG.desktop,
    mobile: FEED_CUTOFF_CONFIG.mobile,
  },
  truncationLabel: '...more',
  capabilities: {
    copy: true,
    imageAttachments: true,
    // The composer doesn't accept prefilled text via URL; we just open it.
    openComposer: { url: () => LINKEDIN_COMPOSER_URL, prefillsText: false },
  },
  warnings: [],
  // LinkedIn shows a compact thumbnail card with the title and domain (no description).
  linkPreview: { layout: 'thumbnail', showDescription: false },
};
