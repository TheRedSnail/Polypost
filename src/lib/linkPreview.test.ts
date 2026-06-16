import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchLinkPreview, mapMicrolink, shouldRefreshLinkPreview } from './linkPreview';

describe('mapMicrolink', () => {
  it('maps a successful payload into a ready preview', () => {
    const result = mapMicrolink({
      status: 'success',
      data: {
        title: 'Headline',
        description: 'A summary',
        publisher: 'Example News',
        image: { url: 'https://cdn.test/og.jpg' },
        logo: { url: 'https://cdn.test/logo.png' },
      },
    });

    expect(result).toEqual({
      status: 'ready',
      title: 'Headline',
      description: 'A summary',
      imageUrl: 'https://cdn.test/og.jpg',
      logoUrl: 'https://cdn.test/logo.png',
      siteName: 'Example News',
    });
  });

  it('uses the screenshot when no Open Graph image is available', () => {
    const result = mapMicrolink({
      status: 'success',
      data: {
        title: 'Headline',
        screenshot: { url: 'https://cdn.test/screenshot.png' },
      },
    });

    expect(result.imageUrl).toBe('https://cdn.test/screenshot.png');
  });

  it('returns failed when the response is not a success', () => {
    expect(mapMicrolink({ status: 'fail' }).status).toBe('failed');
    expect(mapMicrolink({}).status).toBe('failed');
  });

  it('drops blank/missing fields rather than keeping empty strings', () => {
    const result = mapMicrolink({ status: 'success', data: { title: '   ', image: null } });

    expect(result.status).toBe('ready');
    expect(result.title).toBeUndefined();
    expect(result.imageUrl).toBeUndefined();
  });
});

describe('fetchLinkPreview', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns failed when the fetch throws (CORS/offline/rate-limit)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('cors'));
    expect((await fetchLinkPreview('https://x.test')).status).toBe('failed');
  });

  it('returns failed on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
    expect((await fetchLinkPreview('https://x.test')).status).toBe('failed');
  });

  it('maps a successful response body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', data: { title: 'Hi' } }),
    } as unknown as Response);

    const result = await fetchLinkPreview('https://x.test');

    expect(result.status).toBe('ready');
    expect(result.title).toBe('Hi');
    expect(fetch).toHaveBeenCalledWith('https://api.microlink.io/?screenshot=true&url=https%3A%2F%2Fx.test', { signal: undefined });
  });
});

describe('shouldRefreshLinkPreview', () => {
  it('refreshes failed and incomplete automatic previews', () => {
    expect(shouldRefreshLinkPreview(undefined, 'https://example.test/post')).toBe(true);
    expect(shouldRefreshLinkPreview({ status: 'failed' }, 'https://example.test/post')).toBe(true);
    expect(shouldRefreshLinkPreview({ status: 'ready', title: 'Headline' }, 'https://example.test/post')).toBe(true);
  });

  it('refreshes low-value titles from older metadata fetches', () => {
    expect(
      shouldRefreshLinkPreview(
        { status: 'ready', title: '4528369', imageUrl: 'https://cdn.test/og.jpg' },
        'https://techcommunity.microsoft.com/blog/microsoft-security-blog/microsoft-leads-a-new-era-of-software-supply-chain-transparency/4528369',
      ),
    ).toBe(true);
  });

  it('does not refresh manual, loading, or complete previews', () => {
    expect(shouldRefreshLinkPreview({ status: 'manual' }, 'https://example.test/post')).toBe(false);
    expect(shouldRefreshLinkPreview({ status: 'loading' }, 'https://example.test/post')).toBe(false);
    expect(shouldRefreshLinkPreview({ status: 'ready', title: 'Headline', imageUrl: 'https://cdn.test/og.jpg' }, 'https://example.test/post')).toBe(false);
  });
});
