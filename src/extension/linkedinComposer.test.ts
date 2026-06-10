import { describe, expect, it, vi } from 'vitest';

import {
  closeNativeLinkedInComposer,
  dismissNativeComposerDiscardConfirmation,
  findLinkedInComposer,
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

describe('linkedinComposer helpers', () => {
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