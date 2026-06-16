import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderForPlatform } from '../lib/platforms';
import { blueskySpec } from '../lib/platforms/bluesky';
import { instagramSpec } from '../lib/platforms/instagram';
import { linkedinSpec } from '../lib/platforms/linkedin';
import { mastodonSpec } from '../lib/platforms/mastodon';
import { threadsSpec } from '../lib/platforms/threads';
import { xSpec } from '../lib/platforms/x';
import type { EditorNode } from '../lib/exportText';
import type { Attachment, LinkPreview } from '../lib/media';
import type { PlatformSpec } from '../lib/platforms/types';
import { PlatformCard } from './PlatformCard';

vi.mock('../lib/clipboard', () => ({ copyPlainText: vi.fn().mockResolvedValue(undefined) }));
import { copyPlainText } from '../lib/clipboard';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const text: EditorNode = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Launch day' }] }] };
const empty: EditorNode = { type: 'doc', content: [] };

function renderCard(spec: PlatformSpec, doc: EditorNode, attachments: Attachment[] = []) {
  return render(
    <PlatformCard
      spec={spec}
      render={renderForPlatform(doc, spec)}
      document={doc}
      isForked={false}
      isAiAdapted={false}
      attachments={attachments}
      isGenerating={false}
      aiReady={false}
      isEditing={false}
      masterVersion={0}
      onStartEditing={() => {}}
      onStopEditing={() => {}}
      onPaneChange={() => {}}
      onResync={() => {}}
      onFit={() => {}}
    />,
  );
}

describe('PlatformCard copy actions', () => {
  it('disables copy when there is no text', () => {
    renderCard(xSpec, empty);
    expect(screen.getByRole('button', { name: /^Copy$/ })).toBeDisabled();
  });

  it('copies the platform text when Copy is clicked', () => {
    renderCard(xSpec, text);
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    expect(copyPlainText).toHaveBeenCalledWith('Launch day');
  });

  it('shows a Copy & open button only when the platform has a composer', () => {
    renderCard(xSpec, text);
    expect(screen.getByRole('button', { name: /Copy & open/ })).toBeInTheDocument();

    cleanup();
    // Instagram is copy-only.
    renderCard(instagramSpec, text);
    expect(screen.queryByRole('button', { name: /Copy & open/ })).toBeNull();
  });
});

describe('PlatformCard link preview', () => {
  const linkWith = (preview: LinkPreview): Attachment[] => [
    { id: 'l1', kind: 'link', name: 'Example', url: 'https://example.test/post', preview },
  ];

  it('renders the unfurl preview with the fetched title in the large layout', () => {
    const { container } = renderCard(xSpec, text, linkWith({ status: 'ready', title: 'Headline', imageUrl: 'https://cdn.test/og.jpg' }));

    const card = container.querySelector('.card-link-preview');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('is-large')).toBe(true);
    expect(screen.getByText('Headline')).toBeInTheDocument();
    expect(screen.getByText('example.test')).toBeInTheDocument();
  });

  it('uses the compact thumbnail layout for Mastodon, with the description', () => {
    const { container } = renderCard(mastodonSpec, text, linkWith({ status: 'ready', title: 'Headline', description: 'A summary' }));

    expect(container.querySelector('.card-link-preview.is-thumbnail')).not.toBeNull();
    expect(screen.getByText('A summary')).toBeInTheDocument();
  });

  it('uses LinkedIn\'s compact thumbnail layout without the description', () => {
    const { container } = renderCard(linkedinSpec, text, linkWith({ status: 'ready', title: 'Headline', description: 'A summary', imageUrl: 'https://cdn.test/og.jpg' }));

    expect(container.querySelector('.card-link-preview.is-thumbnail.is-linkedin')).not.toBeNull();
    expect(screen.getByText('Headline')).toBeInTheDocument();
    expect(screen.queryByText('A summary')).toBeNull();
  });

  it('uses Threads\' large preview card without the description', () => {
    const { container } = renderCard(threadsSpec, text, linkWith({ status: 'ready', title: 'Headline', description: 'A summary', imageUrl: 'https://cdn.test/og.jpg' }));

    expect(container.querySelector('.card-link-preview.is-large.is-threads')).not.toBeNull();
    expect(screen.getByText('Headline')).toBeInTheDocument();
    expect(screen.queryByText('A summary')).toBeNull();
  });

  it('hides the description on platforms that do not show one', () => {
    renderCard(xSpec, text, linkWith({ status: 'ready', title: 'Headline', description: 'A summary' }));
    expect(screen.queryByText('A summary')).toBeNull();
  });

  it('shows a no-preview note for Instagram instead of a card', () => {
    const { container } = renderCard(instagramSpec, text, linkWith({ status: 'ready', title: 'Headline' }));

    expect(container.querySelector('.card-link-preview.is-note')).not.toBeNull();
    expect(screen.getByText(/won't show a preview/)).toBeInTheDocument();
  });

  it('falls back to the description when the platform shows it', () => {
    renderCard(blueskySpec, text, linkWith({ status: 'ready', title: 'Headline', description: 'A summary' }));
    expect(screen.getByText('A summary')).toBeInTheDocument();
  });
});
