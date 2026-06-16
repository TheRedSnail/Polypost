import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { faviconUrl, hostnameOf, type Attachment } from '../lib/media';
import type { PlatformSpec } from '../lib/platforms/types';
import { PLATFORM_ICONS } from './platformIcons';

interface CardLinkPreviewProps {
  link: Attachment;
  spec: PlatformSpec;
}

// Renders the shared link as the unfurl card this platform would show — mirroring
// each platform's real layout (large hero vs compact thumbnail, with/without the
// description). Instagram gets a "no preview" note. Purely illustrative: it does
// not affect the copied text or character count.
export function CardLinkPreview({ link, spec }: CardLinkPreviewProps) {
  const style = spec.linkPreview;

  if (!style || !link.url) {
    return null;
  }

  if (!style.show) {
    return (
      <div className="card-link-preview is-note" aria-label={`${spec.label} link preview`}>
        <AlertTriangle aria-hidden="true" size={14} />
        <span>{style.note}</span>
      </div>
    );
  }

  return <LinkCard link={link} spec={spec} showDescription={style.showDescription} layout={style.layout} />;
}

interface LinkCardProps {
  link: Attachment;
  spec: PlatformSpec;
  showDescription: boolean;
  layout: 'large' | 'thumbnail';
}

function LinkCard({ link, spec, showDescription, layout }: LinkCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const Icon = PLATFORM_ICONS[spec.id];
  const url = link.url ?? '';
  const domain = hostnameOf(url);
  const preview = link.preview;
  const loading = !preview || preview.status === 'loading';

  // A user-supplied label (not the bare URL) is a better title than the domain.
  const label = link.name && link.name !== url ? link.name : undefined;
  const title = preview?.title || label || domain;
  const description = showDescription ? preview?.description : undefined;
  const imageUrl = !imageFailed ? preview?.imageUrl : undefined;
  const logo = preview?.logoUrl || faviconUrl(url);

  return (
    <a
      className={`card-link-preview is-${layout} is-${spec.id}${loading ? ' is-loading' : ''}`}
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`${spec.label} link preview: ${title}`}
    >
      <div className="card-link-preview-media">
        {loading ? (
          <span className="card-link-preview-skeleton" aria-hidden="true" />
        ) : imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" onError={() => setImageFailed(true)} />
        ) : (
          <span className="card-link-preview-placeholder" style={{ color: spec.brandColor }}>
            <Icon size={layout === 'large' ? 26 : 20} />
          </span>
        )}
      </div>
      <div className="card-link-preview-body">
        <span className="card-link-preview-title">{title}</span>
        {description ? <span className="card-link-preview-desc">{description}</span> : null}
        <span className="card-link-preview-domain">
          {logoFailed ? null : (
            <img
              className="card-link-preview-favicon"
              src={logo}
              alt=""
              width={14}
              height={14}
              onError={() => setLogoFailed(true)}
            />
          )}
          {domain}
        </span>
      </div>
    </a>
  );
}
