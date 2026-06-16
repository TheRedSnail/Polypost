import { useRef, useState } from 'react';
import { Check, Copy, Download, ImagePlus, Link2, Pencil, Plus, RotateCcw, X } from 'lucide-react';

import { copyImageToClipboard, makeFileAttachment, makeLinkAttachment, type Attachment, type LinkPreview } from '../lib/media';

function handleMediaDragStart(event: React.DragEvent, attachment: Attachment) {
  if (attachment.objectUrl && attachment.mime) {
    // Enables drag-out to the OS / file inputs in Chromium browsers.
    event.dataTransfer.setData('DownloadURL', `${attachment.mime}:${attachment.name}:${attachment.objectUrl}`);
  }
}

interface MediaTrayProps {
  attachments: Attachment[];
  onAddAttachment: (attachment: Attachment) => void;
  onRemoveAttachment: (id: string) => void;
  onUpdateAttachment: (id: string, patch: Partial<Attachment>) => void;
}

export function MediaTray({ attachments, onAddAttachment, onRemoveAttachment, onUpdateAttachment }: MediaTrayProps) {
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const hasAttachment = attachments.length > 0;

  function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    // Snapshot the files BEFORE clearing the input: event.target.files is a live
    // FileList, so resetting value would empty it before we read it.
    const file = event.target.files?.[0];
    event.target.value = '';

    if (file) {
      onAddAttachment(makeFileAttachment(file));
    }
  }

  function handleAddLink() {
    const trimmed = linkUrl.trim();

    if (!trimmed) {
      return;
    }

    onAddAttachment(makeLinkAttachment(trimmed, linkTitle));
    setLinkUrl('');
    setLinkTitle('');
    setShowLink(false);
  }

  return (
    <details className="media-tray">
      <summary>
        Images &amp; links{attachments.length ? ` (${attachments.length})` : ''}
      </summary>
      <p className="media-hint">Attach one image or one link, matching LinkedIn's composer limit. Adding another replaces the current attachment. Links fold into each platform's copied text automatically.</p>

      <div className="media-actions">
        <label className="secondary-action media-add media-file" title={hasAttachment ? 'Replace with an image' : 'Add an image'}>
          <ImagePlus aria-hidden="true" size={13} /> {hasAttachment ? 'Replace image' : 'Image'}
          <input type="file" accept="image/*" onChange={handleFiles} />
        </label>
        <button type="button" className="secondary-action media-add" onClick={() => setShowLink((value) => !value)}>
          <Link2 aria-hidden="true" size={13} /> {hasAttachment ? 'Replace link' : 'Link'}
        </button>
      </div>

      {showLink ? (
        <div className="media-link-row">
          <input
            type="text"
            value={linkTitle}
            placeholder="Label (optional)"
            aria-label="Link label"
            onChange={(event) => setLinkTitle(event.target.value)}
          />
          <input
            type="url"
            value={linkUrl}
            placeholder="https://example.com"
            aria-label="Link URL"
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddLink();
              }
            }}
          />
          <button type="button" className="primary-action media-add-confirm" disabled={!linkUrl.trim()} onClick={handleAddLink}>
            <Plus aria-hidden="true" size={13} /> {hasAttachment ? 'Replace' : 'Add'}
          </button>
        </div>
      ) : null}

      {attachments.length ? (
        <ul className="media-list">
          {attachments.map((attachment) => {
            if (attachment.kind === 'link') {
              return (
                <MediaLinkItem
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={onRemoveAttachment}
                  onUpdate={onUpdateAttachment}
                />
              );
            }

            // Only image/video files reach here — links render via MediaLinkItem above.
            return (
              <li
                key={attachment.id}
                className={`media-item is-${attachment.kind}`}
                draggable={Boolean(attachment.objectUrl)}
                onDragStart={(event) => handleMediaDragStart(event, attachment)}
                title={`${attachment.name} — drag into a composer or download`}
              >
                {attachment.kind === 'image' && attachment.objectUrl ? (
                  <img src={attachment.objectUrl} alt={attachment.name} className="media-thumb" />
                ) : attachment.kind === 'video' && attachment.objectUrl ? (
                  <video src={attachment.objectUrl} className="media-thumb" muted />
                ) : (
                  <span className="media-link-icon"><Link2 aria-hidden="true" size={16} /></span>
                )}
                <span className="media-item-name" title={attachment.url ?? attachment.name}>{attachment.name}</span>
                {attachment.kind === 'image' ? <CopyImageButton attachment={attachment} /> : null}
                {attachment.objectUrl ? (
                  <a className="media-download" href={attachment.objectUrl} download={attachment.name} aria-label={`Download ${attachment.name}`} title="Download">
                    <Download aria-hidden="true" size={14} />
                  </a>
                ) : null}
                <button type="button" className="media-remove" aria-label={`Remove ${attachment.name}`} onClick={() => onRemoveAttachment(attachment.id)}>
                  <X aria-hidden="true" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </details>
  );
}

const PREVIEW_STATUS_LABEL: Record<LinkPreview['status'], string> = {
  loading: 'Loading preview…',
  ready: 'Preview ready',
  failed: "Couldn't fetch preview",
  manual: 'Custom preview',
};

// A link row with its unfurl-preview status and an inline editor to override or
// re-fetch the title/description/image each platform card shows.
function MediaLinkItem({
  attachment,
  onRemove,
  onUpdate,
}: {
  attachment: Attachment;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Attachment>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const status = attachment.preview?.status ?? 'loading';

  return (
    <li className="media-item is-link">
      <div className="media-link-row-main">
        <span className="media-link-icon"><Link2 aria-hidden="true" size={16} /></span>
        <span className="media-item-name" title={attachment.url ?? attachment.name}>{attachment.name}</span>
        <span className={`media-preview-status is-${status}`}>{PREVIEW_STATUS_LABEL[status]}</span>
        <button
          type="button"
          className={`media-edit-preview${editing ? ' is-active' : ''}`}
          aria-label={`Edit ${attachment.name} preview`}
          aria-expanded={editing}
          title="Edit preview"
          onClick={() => setEditing((value) => !value)}
        >
          <Pencil aria-hidden="true" size={14} />
        </button>
        <button type="button" className="media-remove" aria-label={`Remove ${attachment.name}`} onClick={() => onRemove(attachment.id)}>
          <X aria-hidden="true" size={14} />
        </button>
      </div>
      {editing ? (
        <LinkPreviewForm attachment={attachment} onUpdate={onUpdate} onClose={() => setEditing(false)} />
      ) : null}
    </li>
  );
}

function LinkPreviewForm({
  attachment,
  onUpdate,
  onClose,
}: {
  attachment: Attachment;
  onUpdate: (id: string, patch: Partial<Attachment>) => void;
  onClose: () => void;
}) {
  const preview = attachment.preview;
  const [title, setTitle] = useState(preview?.title ?? '');
  const [description, setDescription] = useState(preview?.description ?? '');
  const [imageUrl, setImageUrl] = useState(preview?.imageUrl ?? '');

  function handleSave() {
    onUpdate(attachment.id, {
      preview: {
        ...attachment.preview,
        status: 'manual',
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
      },
    });
    onClose();
  }

  function handleRefetch() {
    // Clearing the preview signals the app to re-fetch it from the unfurl service.
    onUpdate(attachment.id, { preview: undefined });
    onClose();
  }

  return (
    <div className="media-preview-form">
      <input type="text" value={title} placeholder="Preview title" aria-label="Preview title" onChange={(event) => setTitle(event.target.value)} />
      <input type="text" value={description} placeholder="Description" aria-label="Preview description" onChange={(event) => setDescription(event.target.value)} />
      <input type="url" value={imageUrl} placeholder="Image URL" aria-label="Preview image URL" onChange={(event) => setImageUrl(event.target.value)} />
      <div className="media-preview-form-actions">
        <button type="button" className="primary-action media-add-confirm" onClick={handleSave}>
          <Check aria-hidden="true" size={13} /> Save
        </button>
        <button type="button" className="secondary-action media-add" onClick={handleRefetch}>
          <RotateCcw aria-hidden="true" size={13} /> Re-fetch
        </button>
      </div>
    </div>
  );
}

type CopyState = 'idle' | 'copied' | 'error';

// Copies the image bitmap to the clipboard so it can be pasted into a composer.
function CopyImageButton({ attachment }: { attachment: Attachment }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | null>(null);

  function flash(next: CopyState) {
    setState(next);
    if (timer.current) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => setState('idle'), 1500);
  }

  async function handleCopy() {
    try {
      await copyImageToClipboard(attachment);
      flash('copied');
    } catch {
      flash('error');
    }
  }

  const label = state === 'copied' ? 'Copied!' : state === 'error' ? 'Copy failed' : 'Copy image';

  return (
    <button type="button" className={`media-copy is-${state}`} aria-label={`Copy ${attachment.name} as an image`} title={label} onClick={handleCopy}>
      {state === 'copied' ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
    </button>
  );
}
