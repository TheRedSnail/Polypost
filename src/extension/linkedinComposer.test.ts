import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  attachFilesToLinkedInComposer,
  closeNativeLinkedInComposer,
  dismissNativeComposerDiscardConfirmation,
  findLinkedInComposer,
  findLinkedInMediaAttachedIndicator,
  findLinkedInMediaFileInput,
  findLinkedInMediaNextButton,
  findLinkedInPostButton,
  findNativeComposerDialog,
  getLinkedInComposerAnchor,
  setLinkedInComposerText,
} from './linkedinComposer';

function mockVisible(element: HTMLElement) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    bottom: 160,
    height: 120,
    left: 0,
    right: 480,
    top: 40,
    width: 480,
    x: 0,
    y: 40,
    toJSON: () => ({}),
  });
}

// jsdom does not implement DataTransfer, so media tests stub a minimal version.
function stubDataTransfer() {
  class FakeDataTransfer {
    private fileList: File[] = [];

    items = {
      add: (file: File) => {
        this.fileList.push(file);
      },
    };

    get files() {
      return this.fileList as unknown as FileList;
    }
  }

  vi.stubGlobal('DataTransfer', FakeDataTransfer);
}

describe('linkedinComposer helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('finds a visible LinkedIn modal composer', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <div class="ql-container">
          <div class="ql-editor" contenteditable="true" data-placeholder="What do you want to talk about?"></div>
        </div>
      </div>
    `;
    const editor = document.querySelector<HTMLElement>('.ql-editor');
    expect(editor).not.toBeNull();
    mockVisible(editor!);

    expect(findLinkedInComposer()).toBe(editor);
    expect(getLinkedInComposerAnchor(editor!)).toBe(document.querySelector('.ql-container'));
  });

  it('ignores hidden composer candidates', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <div class="ql-editor" contenteditable="true" data-placeholder="What do you want to talk about?"></div>
      </div>
    `;

    expect(findLinkedInComposer()).toBeNull();
  });

  it('finds a visible composer by placeholder text outside a dialog', () => {
    document.body.innerHTML = `
      <div class="share-box">
        <div contenteditable="true">What do you want to talk about?</div>
      </div>
    `;
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]');
    expect(editor).not.toBeNull();
    mockVisible(editor!);

    expect(findLinkedInComposer()).toBe(editor);
  });

  it('finds a native composer dialog even when the editor candidate is hidden', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <button type="button" aria-label="Dismiss"></button>
        <div class="ql-editor" contenteditable="true" data-placeholder="What do you want to talk about?"></div>
        <button type="button">Post</button>
      </div>
    `;

    expect(findLinkedInComposer()).toBeNull();
    expect(findNativeComposerDialog()).toBe(document.querySelector('[role="dialog"]'));
  });

  it('clicks the native composer dismiss control without closing the formatter dialog', () => {
    document.body.innerHTML = `
      <div id="linkedin-post-formatter-extension-root">
        <section role="dialog" aria-label="LinkedIn Post Formatter">
          <button type="button" aria-label="Close formatter"></button>
        </section>
      </div>
      <div role="dialog">
        <button type="button" aria-label="Dismiss"></button>
        <div class="ql-editor" contenteditable="true" data-placeholder="What do you want to talk about?"></div>
        <button type="button">Post</button>
      </div>
    `;
    const formatterClose = document.querySelector<HTMLButtonElement>('#linkedin-post-formatter-extension-root button');
    const nativeClose = document.querySelector<HTMLButtonElement>('body > [role="dialog"] button[aria-label="Dismiss"]');
    const formatterHandler = vi.fn();
    const nativeHandler = vi.fn();
    formatterClose?.addEventListener('click', formatterHandler);
    nativeClose?.addEventListener('click', nativeHandler);

    expect(closeNativeLinkedInComposer()).toBe(true);

    expect(nativeHandler).toHaveBeenCalledTimes(1);
    expect(formatterHandler).not.toHaveBeenCalled();
  });

  it('clicks LinkedIn discard confirmations after closing a draft composer', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <p>Discard post?</p>
        <button type="button">Cancel</button>
        <button type="button">Discard</button>
      </div>
    `;
    const discardButton = document.querySelectorAll<HTMLButtonElement>('button')[1];
    const discardHandler = vi.fn();
    discardButton.addEventListener('click', discardHandler);

    expect(dismissNativeComposerDiscardConfirmation()).toBe(true);

    expect(discardHandler).toHaveBeenCalledTimes(1);
  });

  it('finds the composer inside a shadow root', () => {
    document.body.innerHTML = '<div id="interop-outlet"></div>';
    const host = document.querySelector<HTMLElement>('#interop-outlet');
    const shadow = host!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div role="dialog" class="share-box-v2__modal">
        <div class="ql-container">
          <div class="ql-editor" contenteditable="true" data-placeholder="What do you want to talk about?"></div>
        </div>
        <button type="button" class="share-actions__primary-action">Post</button>
      </div>
    `;
    const editor = shadow.querySelector<HTMLElement>('.ql-editor');
    expect(editor).not.toBeNull();
    mockVisible(editor!);

    expect(findLinkedInComposer()).toBe(editor);
    expect(findNativeComposerDialog()).toBe(shadow.querySelector('[role="dialog"]'));
  });

  it('finds the enabled native Post button inside a shadow root and skips the extension button', () => {
    document.body.innerHTML = `
      <div id="linkedin-post-formatter-extension-root">
        <button type="button">Post</button>
      </div>
      <div id="interop-outlet"></div>
    `;
    const host = document.querySelector<HTMLElement>('#interop-outlet');
    const shadow = host!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div role="dialog">
        <div class="ql-editor" contenteditable="true" data-placeholder="What do you want to talk about?"></div>
        <button type="button" class="share-actions__primary-action" disabled>Post</button>
      </div>
    `;
    const editor = shadow.querySelector<HTMLElement>('.ql-editor');
    mockVisible(editor!);
    const nativePost = shadow.querySelector<HTMLButtonElement>('.share-actions__primary-action');

    expect(findLinkedInPostButton()).toBeNull();

    nativePost!.disabled = false;

    expect(findLinkedInPostButton()).toBe(nativePost);
  });

  it('prefers the media file input inside the composer dialog and skips the extension root', () => {
    document.body.innerHTML = `
      <div id="linkedin-post-formatter-extension-root">
        <input type="file" accept="image/*,video/*" />
      </div>
      <input type="file" accept="image/*" id="stray-input" />
      <div role="dialog">
        <div class="ql-editor" contenteditable="true" data-placeholder="What do you want to talk about?"></div>
        <input type="file" accept="image/*,video/*" id="dialog-input" />
        <button type="button">Post</button>
      </div>
    `;
    const editor = document.querySelector<HTMLElement>('.ql-editor');
    mockVisible(editor!);

    expect(findLinkedInMediaFileInput()).toBe(document.querySelector('#dialog-input'));
  });

  it('ignores file inputs that only accept non-media types', () => {
    document.body.innerHTML = '<input type="file" accept=".pdf,.doc" />';

    expect(findLinkedInMediaFileInput()).toBeNull();
  });

  it('attaches files through the media input and dispatches a change event', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <div class="ql-editor" contenteditable="true" data-placeholder="What do you want to talk about?"></div>
        <input type="file" accept="image/*,video/*" />
        <button type="button">Post</button>
      </div>
    `;
    const editor = document.querySelector<HTMLElement>('.ql-editor');
    mockVisible(editor!);
    stubDataTransfer();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const changeHandler = vi.fn();
    input!.addEventListener('change', changeHandler);

    const file = new File(['pixels'], 'photo.png', { type: 'image/png' });

    expect(attachFilesToLinkedInComposer([file])).toBe(true);

    expect(changeHandler).toHaveBeenCalledTimes(1);
    expect(input!.files).toHaveLength(1);
    expect(input!.files![0].name).toBe('photo.png');
  });

  it('falls back to a simulated drop on the composer when no file input exists', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <div class="ql-editor" contenteditable="true" data-placeholder="What do you want to talk about?"></div>
      </div>
    `;
    const editor = document.querySelector<HTMLElement>('.ql-editor');
    mockVisible(editor!);
    stubDataTransfer();
    const droppedFiles: File[] = [];
    editor!.addEventListener('drop', (event) => {
      const transfer = (event as DragEvent).dataTransfer;
      droppedFiles.push(...Array.from(transfer?.files ?? []));
    });

    const file = new File(['frames'], 'clip.mp4', { type: 'video/mp4' });

    expect(attachFilesToLinkedInComposer([file])).toBe(true);

    expect(droppedFiles).toHaveLength(1);
    expect(droppedFiles[0].name).toBe('clip.mp4');
  });

  it('finds the enabled media editor Next button and skips disabled or extension buttons', () => {
    document.body.innerHTML = `
      <div id="linkedin-post-formatter-extension-root">
        <div role="dialog"><button type="button">Next</button></div>
      </div>
      <div role="dialog" id="media-editor">
        <button type="button" disabled>Next</button>
      </div>
    `;
    mockVisible(document.querySelector<HTMLElement>('#media-editor')!);

    expect(findLinkedInMediaNextButton()).toBeNull();

    const nativeNext = document.querySelector<HTMLButtonElement>('#media-editor button');
    nativeNext!.disabled = false;

    expect(findLinkedInMediaNextButton()).toBe(nativeNext);
  });

  it('ignores Done buttons inside hidden or video.js dialogs', () => {
    document.body.innerHTML = `
      <div role="dialog" class="vjs-modal-dialog vjs-text-track-settings" id="vjs-dialog">
        <button type="button">Done</button>
      </div>
      <div role="dialog" id="hidden-dialog">
        <button type="button">Next</button>
      </div>
    `;
    // The vjs dialog is "visible" but carries video.js classes; the other
    // dialog has no layout box (jsdom default zero rect).
    mockVisible(document.querySelector<HTMLElement>('#vjs-dialog')!);

    expect(findLinkedInMediaNextButton()).toBeNull();
  });

  it('detects the inline media-attached indicator in the composer dialog', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <div class="ql-editor" contenteditable="true" data-placeholder="What do you want to talk about?"></div>
        <button type="button">Post</button>
      </div>
    `;
    const editor = document.querySelector<HTMLElement>('.ql-editor');
    mockVisible(editor!);

    expect(findLinkedInMediaAttachedIndicator()).toBeNull();

    const removeMedia = document.createElement('button');
    removeMedia.type = 'button';
    removeMedia.textContent = 'Remove media';
    document.querySelector('[role="dialog"]')!.append(removeMedia);

    expect(findLinkedInMediaAttachedIndicator()).toBe(removeMedia);
  });

  it('writes text and dispatches input and change events', () => {
    document.body.innerHTML = '<div contenteditable="true"></div>';
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]');
    expect(editor).not.toBeNull();
    const inputHandler = vi.fn();
    const changeHandler = vi.fn();
    editor!.addEventListener('input', inputHandler);
    editor!.addEventListener('change', changeHandler);

    expect(setLinkedInComposerText(editor!, 'Hello\nLinkedIn')).toBe(true);

    expect(editor!.textContent).toBe('Hello\nLinkedIn');
    expect(inputHandler).toHaveBeenCalledTimes(1);
    expect(changeHandler).toHaveBeenCalledTimes(1);
  });
});