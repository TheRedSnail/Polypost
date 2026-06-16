import type { LinkPreview } from './media';

// Fetches a link's unfurl metadata (Open Graph) so the per-platform preview cards
// can show the graphic + title/description each platform would render. A direct
// browser fetch of an arbitrary page is CORS-blocked for nearly all sites (see
// makeUrlSource in ai/sources.ts), so we use microlink — a CORS-enabled service
// that returns normalized metadata as JSON. The free endpoint needs no API key
// but is rate-limited (~50 req/day per IP); results are cached on the attachment
// and a manual override is available, so real usage stays well within that.
const MICROLINK_ENDPOINT = 'https://api.microlink.io/';

// The subset of microlink's response we read. Everything is optional/defensive
// because it's an external payload.
interface MicrolinkResponse {
  status?: string;
  data?: {
    title?: string;
    description?: string;
    publisher?: string;
    image?: { url?: string } | null;
    screenshot?: { url?: string } | null;
    logo?: { url?: string } | null;
  };
}

// Pure mapping from a microlink payload to our LinkPreview — exported so it can be
// unit-tested without a network round-trip.
export function mapMicrolink(json: MicrolinkResponse): LinkPreview {
  if (json.status !== 'success' || !json.data) {
    return { status: 'failed' };
  }

  const { title, description, publisher, image, screenshot, logo } = json.data;

  return {
    status: 'ready',
    title: title?.trim() || undefined,
    description: description?.trim() || undefined,
    imageUrl: image?.url || screenshot?.url || undefined,
    logoUrl: logo?.url || undefined,
    siteName: publisher?.trim() || undefined,
  };
}

export function shouldRefreshLinkPreview(preview: LinkPreview | undefined, url: string): boolean {
  if (!preview) {
    return true;
  }

  if (preview.status === 'manual' || preview.status === 'loading') {
    return false;
  }

  if (preview.status === 'failed') {
    return true;
  }

  return !preview.imageUrl || isLowValueTitle(preview.title, url);
}

function isLowValueTitle(title: string | undefined, url: string): boolean {
  const normalizedTitle = title?.trim().toLowerCase();

  if (!normalizedTitle) {
    return true;
  }

  try {
    const parsed = new URL(url);
    const lastPathSegment = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) ?? '').toLowerCase();

    return normalizedTitle === parsed.hostname.toLowerCase() || normalizedTitle === lastPathSegment;
  } catch {
    return false;
  }
}

export async function fetchLinkPreview(url: string, signal?: AbortSignal): Promise<LinkPreview> {
  try {
    const params = new URLSearchParams({ screenshot: 'true', url });
    const response = await fetch(`${MICROLINK_ENDPOINT}?${params.toString()}`, { signal });

    if (!response.ok) {
      return { status: 'failed' };
    }

    return mapMicrolink((await response.json()) as MicrolinkResponse);
  } catch {
    // Network error, abort, rate-limit, or malformed JSON — degrade to the
    // favicon + domain + manual-entry fallback the card already handles.
    return { status: 'failed' };
  }
}
