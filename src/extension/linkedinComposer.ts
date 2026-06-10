const COMPOSER_SELECTORS = [
  'div[role="dialog"] .ql-editor[contenteditable="true"]',
  'div[role="dialog"] [contenteditable="true"][aria-label]',
  '.share-box [contenteditable="true"]',
  '.share-box-v2__modal [contenteditable="true"]',
  '.share-creation-state__content [contenteditable="true"]',
  '[contenteditable="true"]',
];
const EXTENSION_ROOT_SELECTOR = '#linkedin-post-formatter-extension-root';

export const NATIVE_HIDDEN_CLASS_NAME = 'lipf-native-composer-hidden';

// LinkedIn renders the share composer inside a shadow root (for example the
// div#interop-outlet host), so every lookup has to pierce shadow boundaries.
function getSearchRoots(root: ParentNode): ParentNode[] {
  const roots: ParentNode[] = [root];

  for (let index = 0; index < roots.length; index += 1) {
    for (const host of Array.from(roots[index].querySelectorAll<HTMLElement>('*'))) {
      if (host.shadowRoot) {
        roots.push(host.shadowRoot);
      }
    }
  }

  return roots;
}

export function queryAllDeep<T extends HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return getSearchRoots(root).flatMap((searchRoot) => Array.from(searchRoot.querySelectorAll<T>(selector)));
}

export function findLinkedInComposer(root: ParentNode = document): HTMLElement | null {
  const searchRoots = getSearchRoots(root);

  for (const selector of COMPOSER_SELECTORS) {
    for (const searchRoot of searchRoots) {
      const composer = Array.from(searchRoot.querySelectorAll<HTMLElement>(selector)).find(isUsableComposer);

      if (composer) {
        return composer;
      }
    }
  }

  return null;
}

export function getLinkedInComposerAnchor(composer: HTMLElement): HTMLElement {
  return composer.closest<HTMLElement>('.ql-container') ?? composer.parentElement ?? composer;
}

export function findNativeComposerDialog(root: ParentNode = document): HTMLElement | null {
  return findNativeComposerDialogs(root)[0] ?? null;
}

export function findNativeComposerDialogs(root: ParentNode = document): HTMLElement[] {
  const composer = findLinkedInComposer(root);
  const composerDialog = composer?.closest<HTMLElement>('[role="dialog"]') ?? null;
  const dialogs = getDialogs(root).filter(isNativeComposerDialog);

  return [composerDialog, ...dialogs].filter((dialog, index, allDialogs): dialog is HTMLElement => {
    return Boolean(dialog) && allDialogs.indexOf(dialog) === index;
  });
}

export function findLinkedInPostButton(root: ParentNode = document): HTMLElement | null {
  const dialog = findNativeComposerDialog(root);
  const controls = dialog ? getButtonLikeControls(dialog) : getButtonLikeControls(root);

  return controls.find((control) => {
    return !control.closest(EXTENSION_ROOT_SELECTOR) && !isControlDisabled(control) && isPostActionControl(control);
  }) ?? null;
}

function isPostActionControl(control: HTMLElement): boolean {
  if (control.classList.contains('share-actions__primary-action')) {
    return true;
  }

  return [control.getAttribute('aria-label'), control.textContent].some((label) => (label ?? '').trim().toLowerCase() === 'post');
}

function isControlDisabled(control: HTMLElement): boolean {
  if (control instanceof HTMLButtonElement && control.disabled) {
    return true;
  }

  return control.getAttribute('aria-disabled') === 'true' || control.classList.contains('artdeco-button--disabled');
}

export function isStartPostControl(element: HTMLElement): boolean {
  const label = `${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`.toLowerCase();
  return label.includes('start a post');
}

export function openNativeLinkedInComposer(): boolean {
  const control = getButtonLikeControls(document).find(isStartPostControl);
  control?.click();
  return Boolean(control);
}

export function clickLinkedInControl(control: HTMLElement) {
  clickControl(control);
}

export function closeNativeLinkedInComposer(root: ParentNode = document): boolean {
  const dialogs = findNativeComposerDialogs(root);
  const closeControls = findNativeComposerCloseControls(root, dialogs);
  let clicked = false;

  for (const closeControl of closeControls) {
    clickControl(closeControl);
    clicked = true;
  }

  return clicked;
}

export function dismissNativeComposerDiscardConfirmation(root: ParentNode = document): boolean {
  const controls = getDialogs(root)
    .filter((dialog) => !dialog.closest(EXTENSION_ROOT_SELECTOR))
    .flatMap((dialog) => getButtonLikeControls(dialog));
  const discardControl = controls.find((control) => {
    const label = getControlLabel(control);
    return /^(discard|leave|delete|yes|ok)$/.test(label) || label.includes('discard post') || label.includes('discard draft');
  });

  if (!discardControl) {
    return false;
  }

  hideDialogSurface(discardControl.closest<HTMLElement>('[role="dialog"]'));
  clickControl(discardControl);
  return true;
}

// Hides a dialog plus its overlay/backdrop parent so the user never sees a
// flash of LinkedIn chrome while the extension drives it.
export function hideDialogSurface(dialog: HTMLElement | null) {
  if (!dialog) {
    return;
  }

  dialog.classList.add(NATIVE_HIDDEN_CLASS_NAME);
  const parent = dialog.parentElement;

  if (parent && /overlay|backdrop/i.test(parent.className)) {
    parent.classList.add(NATIVE_HIDDEN_CLASS_NAME);
  }
}

// LinkedIn keeps a hidden file input for the composer's media button. Prefer
// one inside the composer dialog, then any media-typed input on the page.
export function findLinkedInMediaFileInput(root: ParentNode = document): HTMLInputElement | null {
  const inputs = queryAllDeep<HTMLInputElement>('input[type="file"]', root).filter((input) => {
    return !input.closest(EXTENSION_ROOT_SELECTOR) && acceptsMediaFiles(input);
  });

  if (inputs.length === 0) {
    return null;
  }

  const dialog = findNativeComposerDialog(root);

  if (dialog) {
    const dialogInputs = queryAllDeep<HTMLInputElement>('input[type="file"]', dialog);
    const inDialog = inputs.find((input) => dialogInputs.includes(input));

    if (inDialog) {
      return inDialog;
    }
  }

  return inputs.find((input) => Boolean(input.getAttribute('accept'))) ?? inputs[0];
}

function acceptsMediaFiles(input: HTMLInputElement): boolean {
  const accept = (input.getAttribute('accept') ?? '').toLowerCase();
  return !accept || accept.includes('image') || accept.includes('video');
}

// Hands the user's files to LinkedIn's composer: first by setting the hidden
// media file input (what the Add-media button uses), falling back to a
// simulated drag-and-drop onto the composer surface.
export function attachFilesToLinkedInComposer(files: File[], root: ParentNode = document): boolean {
  if (files.length === 0) {
    return false;
  }

  const input = findLinkedInMediaFileInput(root);

  if (input && setFileInputFiles(input, files)) {
    return true;
  }

  return dropFilesOnLinkedInComposer(files, root);
}

export function dropFilesOnLinkedInComposer(files: File[], root: ParentNode = document): boolean {
  const transfer = createFileTransfer(files);
  const target = findLinkedInComposer(root) ?? findNativeComposerDialog(root);

  if (!transfer || !target) {
    return false;
  }

  for (const type of ['dragenter', 'dragover', 'drop']) {
    target.dispatchEvent(createDragEvent(type, transfer));
  }

  return true;
}

// Some composer variants open a media editor dialog after an upload, which
// must be confirmed (Next/Done) before the share composer returns with the
// attachment. Hidden dialogs (e.g. video.js caption settings, which also has a
// "Done" button) must be skipped.
export function findLinkedInMediaNextButton(root: ParentNode = document): HTMLElement | null {
  const dialogs = queryAllDeep<HTMLElement>('[role="dialog"]', root).filter((dialog) => {
    if (dialog.closest(EXTENSION_ROOT_SELECTOR) || dialog.className.includes('vjs-')) {
      return false;
    }

    const rect = dialog.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  for (const dialog of dialogs) {
    const control = getButtonLikeControls(dialog).find((candidate) => {
      if (candidate.closest(EXTENSION_ROOT_SELECTOR) || isControlDisabled(candidate)) {
        return false;
      }

      return [candidate.getAttribute('aria-label'), candidate.textContent].some((label) => {
        const normalized = (label ?? '').trim().toLowerCase();
        return normalized === 'next' || normalized === 'done';
      });
    });

    if (control) {
      return control;
    }
  }

  return null;
}

// The redesigned (phoenix) composer attaches dropped files inline: a "Remove
// media" / "Edit media preview" control appears in the share dialog once the
// upload has registered. Its presence confirms the attachment took.
export function findLinkedInMediaAttachedIndicator(root: ParentNode = document): HTMLElement | null {
  const dialog = findNativeComposerDialog(root);

  if (!dialog) {
    return null;
  }

  return getButtonLikeControls(dialog).find((control) => {
    if (control.closest(EXTENSION_ROOT_SELECTOR)) {
      return false;
    }

    const label = getControlLabel(control);
    return label.includes('remove media') || label.includes('edit media preview');
  }) ?? null;
}

function setFileInputFiles(input: HTMLInputElement, files: File[]): boolean {
  const transfer = createFileTransfer(files);

  if (!transfer) {
    return false;
  }

  try {
    input.files = transfer.files;
  } catch {
    try {
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    } catch {
      return false;
    }
  }

  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  return true;
}

function createFileTransfer(files: File[]): DataTransfer | null {
  if (typeof DataTransfer !== 'function') {
    return null;
  }

  try {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    return transfer;
  } catch {
    return null;
  }
}

function createDragEvent(type: string, transfer: DataTransfer): Event {
  if (typeof DragEvent === 'function') {
    try {
      return new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer });
    } catch {
      // Fall through to the generic event below.
    }
  }

  const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  return event;
}

export function setLinkedInComposerText(composer: HTMLElement, text: string): boolean {
  if (!composer.isConnected || composer.getAttribute('contenteditable') !== 'true') {
    return false;
  }

  composer.focus();
  selectComposerContents(composer);
  composer.dispatchEvent(createInputEvent(text, 'beforeinput'));

  if (typeof document.execCommand !== 'function' || !document.execCommand('insertText', false, text)) {
    composer.textContent = text;
  }

  composer.dispatchEvent(createInputEvent(text, 'input'));
  composer.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true }));
  composer.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  return true;
}

function isUsableComposer(composer: HTMLElement): boolean {
  if (!composer.isConnected || composer.closest(EXTENSION_ROOT_SELECTOR)) {
    return false;
  }

  const rect = composer.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const labels = [
    composer.getAttribute('aria-label'),
    composer.getAttribute('data-placeholder'),
    composer.textContent,
    composer.closest('[role="dialog"]')?.textContent,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (labels.includes('what do you want to talk about')) {
    return true;
  }

  return Boolean(composer.closest('[role="dialog"]') || composer.closest('.share-box, .share-box-v2__modal, .share-creation-state__content'));
}

function getDialogs(root: ParentNode): HTMLElement[] {
  const dialogs = queryAllDeep<HTMLElement>('[role="dialog"]', root);

  if (root instanceof HTMLElement && root.matches('[role="dialog"]')) {
    dialogs.unshift(root);
  }

  return dialogs;
}

function isNativeComposerDialog(dialog: HTMLElement): boolean {
  if (dialog.closest(EXTENSION_ROOT_SELECTOR)) {
    return false;
  }

  const text = (dialog.textContent ?? '').toLowerCase();

  return hasNativeComposerCue(text) || hasNativeComposerCandidate(dialog);
}

function hasNativeComposerCue(text: string): boolean {
  return text.includes('post to anyone') || text.includes('what do you want to talk about') || text.includes('strengthen post');
}

function hasNativeComposerCandidate(dialog: HTMLElement): boolean {
  const composerCandidate = queryAllDeep<HTMLElement>('[contenteditable="true"]', dialog).find((element) => {
    const label = [element.getAttribute('aria-label'), element.getAttribute('data-placeholder'), element.textContent]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return element.classList.contains('ql-editor') || hasNativeComposerCue(label);
  });

  if (!composerCandidate) {
    return false;
  }

  return getButtonLikeControls(dialog).some((control) => /^post$/.test(getControlLabel(control)));
}

function findDialogCloseControl(dialog: HTMLElement): HTMLElement | null {
  return getButtonLikeControls(dialog).find((control) => {
    const label = getControlLabel(control);

    if (label.includes('close') || label.includes('dismiss') || label === 'cancel') {
      return true;
    }

    return label === 'x' || label === '×';
  }) ?? null;
}

function findNativeComposerCloseControls(root: ParentNode, dialogs: HTMLElement[]): HTMLElement[] {
  const controls = dialogs
    .flatMap((dialog) => [findDialogCloseControl(dialog), findDialogCloseControl(getDialogSearchParent(dialog))])
    .filter((control, index, allControls): control is HTMLElement => {
      if (!control) {
        return false;
      }

      return !control.closest(EXTENSION_ROOT_SELECTOR) && allControls.indexOf(control) === index;
    });

  if (controls.length > 0) {
    return controls;
  }

  return getButtonLikeControls(root).filter((control) => {
    if (control.closest(EXTENSION_ROOT_SELECTOR) || !isLikelyCloseControl(control)) {
      return false;
    }

    return dialogs.some((dialog) => isControlNearDialog(control, dialog));
  });
}

function getDialogSearchParent(dialog: HTMLElement): HTMLElement {
  const parent = dialog.parentElement;

  if (!parent || parent === document.body || parent === document.documentElement) {
    return dialog;
  }

  return parent;
}

function isLikelyCloseControl(control: HTMLElement): boolean {
  const label = getControlLabel(control);
  return label.includes('close') || label.includes('dismiss') || label === 'x' || label === '×';
}

function isControlNearDialog(control: HTMLElement, dialog: HTMLElement): boolean {
  const controlRect = control.getBoundingClientRect();
  const dialogRect = dialog.getBoundingClientRect();

  if (controlRect.width <= 0 || controlRect.height <= 0 || dialogRect.width <= 0 || dialogRect.height <= 0) {
    return false;
  }

  const controlCenterX = controlRect.left + controlRect.width / 2;
  const controlCenterY = controlRect.top + controlRect.height / 2;
  const margin = 80;

  return (
    controlCenterX >= dialogRect.left - margin &&
    controlCenterX <= dialogRect.right + margin &&
    controlCenterY >= dialogRect.top - margin &&
    controlCenterY <= dialogRect.bottom + margin
  );
}

function getButtonLikeControls(root: ParentNode): HTMLElement[] {
  return queryAllDeep<HTMLElement>('button, [role="button"]', root);
}

function getControlLabel(control: HTMLElement): string {
  return [control.getAttribute('aria-label'), control.getAttribute('title'), control.textContent]
    .filter(Boolean)
    .join(' ')
    .trim()
    .toLowerCase();
}

function clickControl(control: HTMLElement) {
  dispatchPointerEvent(control, 'pointerdown');
  dispatchMouseEvent(control, 'mousedown');
  dispatchMouseEvent(control, 'mouseup');
  dispatchPointerEvent(control, 'pointerup');
  control.click();
}

function dispatchPointerEvent(control: HTMLElement, type: string) {
  if (typeof PointerEvent !== 'function') {
    return;
  }

  control.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse' }));
}

function dispatchMouseEvent(control: HTMLElement, type: string) {
  control.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
}

function createInputEvent(text: string, type: 'beforeinput' | 'input'): Event {
  if (typeof InputEvent === 'function') {
    return new InputEvent(type, { bubbles: true, cancelable: type === 'beforeinput', composed: true, data: text, inputType: 'insertText' });
  }

  return new Event(type, { bubbles: true, cancelable: type === 'beforeinput', composed: true });
}

function selectComposerContents(composer: HTMLElement) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(composer);
  selection?.removeAllRanges();
  selection?.addRange(range);
}