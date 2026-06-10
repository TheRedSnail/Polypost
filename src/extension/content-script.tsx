import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import { LinkedInComposerOverlay } from './LinkedInComposerOverlay';
import {
  clickLinkedInControl,
  closeNativeLinkedInComposer,
  dismissNativeComposerDiscardConfirmation,
  findLinkedInComposer,
  findLinkedInPostButton,
  findNativeComposerDialog,
  findNativeComposerDialogs,
  hideDialogSurface,
  isStartPostControl,
  NATIVE_HIDDEN_CLASS_NAME,
  openNativeLinkedInComposer,
  queryAllDeep,
  setLinkedInComposerText,
} from './linkedinComposer';
import './extension.css';

const ROOT_ID = 'linkedin-post-formatter-extension-root';
const DIAGNOSTIC_ATTRIBUTE = 'data-linkedin-formatter-diagnostic';
const LINKEDIN_SHARE_ACTIVE_URL = 'https://www.linkedin.com/feed/?shareActive=true';
const SUPPRESS_STYLE_ID = 'lipf-native-composer-suppress';
const SUPPRESS_SELECTOR = '.share-box-v2__modal, .share-creation-state__modal, .artdeco-modal-overlay';
// Default suppression: visibility:hidden renders the composer invisible the
// instant it is created (no flash) AND removes it from the focus order, so
// LinkedIn's modal focus trap cannot steal focus from the formatter editor.
const SUPPRESS_CSS_HIDDEN = `${SUPPRESS_SELECTOR} { visibility: hidden !important; pointer-events: none !important; }`;
// Bridge-only suppression: opacity:0 keeps the composer focusable (so we can
// programmatically focus + insert text) while still invisible. Used briefly
// while posting, when the user is not interacting with the formatter.
const SUPPRESS_CSS_FOCUSABLE = `${SUPPRESS_SELECTOR} { opacity: 0 !important; pointer-events: none !important; }`;
const HIDE_LOOP_INTERVAL_MS = 150;
const DISMISS_LOOP_INTERVAL_MS = 100;
const DISMISS_TIMEOUT_MS = 3000;
const POSTED_DIALOG_CLOSE_TIMEOUT_MS = 8000;
const LOG_PREFIX = '[LIPF]';

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

function dumpDomState(label: string) {
  const dialogs = queryAllDeep<HTMLElement>('[role="dialog"]').map((dialog) => {
    const rect = dialog.getBoundingClientRect();
    return {
      inExtension: Boolean(dialog.closest(`#${ROOT_ID}`)),
      hidden: dialog.classList.contains(NATIVE_HIDDEN_CLASS_NAME),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      aria: dialog.getAttribute('aria-label'),
      cls: dialog.className.slice(0, 80),
      text: (dialog.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60),
    };
  });

  const editables = queryAllDeep<HTMLElement>('[contenteditable="true"]').map((editor) => {
    const rect = editor.getBoundingClientRect();
    return {
      inExtension: Boolean(editor.closest(`#${ROOT_ID}`)),
      ql: editor.classList.contains('ql-editor'),
      aria: editor.getAttribute('aria-label'),
      placeholder: editor.getAttribute('data-placeholder'),
      inDialog: Boolean(editor.closest('[role="dialog"]')),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
  });

  log(`DOM[${label}] dialogs=${dialogs.length} editables=${editables.length}`, JSON.stringify({ dialogs, editables }));
}

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;
let isFormatterOpen = false;
let isBridgingToNativeComposer = false;
let hideLoopId: number | null = null;
let suppressMode: 'hidden' | 'focusable' = 'hidden';

function mountFormatter() {
  if (mountedContainer?.isConnected) {
    return;
  }

  const container = document.createElement('div');
  container.id = ROOT_ID;
  container.className = 'lipf-extension-root';
  container.textContent = 'LinkedIn Post Formatter loaded';
  container.setAttribute(DIAGNOSTIC_ATTRIBUTE, 'mounted');
  document.body.append(container);

  mountedContainer = container;

  try {
    mountedRoot = createRoot(container);
    renderFormatter();
  } catch (error) {
    renderMountError(container, error);
  }
}

function renderFormatter(sync = false) {
  const overlay = (
    <StrictMode>
      <LinkedInComposerOverlay open={isFormatterOpen} onClose={closeFormatter} onPost={postThroughLinkedIn} />
    </StrictMode>
  );

  if (sync) {
    flushSync(() => mountedRoot?.render(overlay));
    return;
  }

  mountedRoot?.render(overlay);
}

function openFormatter() {
  log('openFormatter');
  isFormatterOpen = true;
  suppressNativeComposer();
  hideNativeComposer();
  startNativeComposerHideLoop();
  renderFormatter(true);
}

// LinkedIn's composer can take seconds to render (inside a shadow root the
// MutationObserver below cannot see), so poll-hide while the formatter is open.
function startNativeComposerHideLoop() {
  if (hideLoopId !== null) {
    return;
  }

  hideLoopId = window.setInterval(() => {
    if (!isFormatterOpen) {
      window.clearInterval(hideLoopId!);
      hideLoopId = null;
      return;
    }

    // Re-assert suppression so composer surfaces (and any newly created shadow
    // root) stay invisible while the formatter owns the screen.
    suppressNativeComposer();
    hideNativeComposer();
  }, HIDE_LOOP_INTERVAL_MS);
}

function closeFormatter() {
  log('closeFormatter');
  isFormatterOpen = false;
  renderFormatter(true);
  closeNativeComposer();
}

async function postThroughLinkedIn(text: string): Promise<boolean> {
  log('postThroughLinkedIn start, textLength:', text.length);
  isBridgingToNativeComposer = true;

  // The formatter stays open ("Posting...") and the native composer stays
  // hidden for the whole bridge, so the user never sees LinkedIn's editor.
  try {
    // The Start-a-post click already opened the native composer (we don't block
    // it), so wait for it before re-clicking — a second click would toggle a
    // still-rendering composer closed.
    let composer = findLinkedInComposer() ?? (await waitForLinkedInComposer());
    log('initial composer (after wait):', Boolean(composer));

    if (!composer) {
      openNativeComposerForPost();
      composer = await waitForLinkedInComposer();
      log('after openNativeComposerForPost, composer:', Boolean(composer));
    }

    if (!composer) {
      log('falling back to shareActive URL navigation');
      window.history.pushState({}, '', LINKEDIN_SHARE_ACTIVE_URL);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await wait(500);
      composer = await waitForLinkedInComposer();
      log('after shareActive navigation, composer:', Boolean(composer));
    }

    if (!composer) {
      log('FAILED: no composer found');
      dumpDomState('post-no-composer');
      return false;
    }

    // Switch suppression to focusable mode so we can focus + insert text. The
    // composer is still invisible (opacity:0); the formatter shows "Posting...".
    suppressNativeComposer('focusable');

    const wrote = setLinkedInComposerText(composer, text);
    log('setLinkedInComposerText result:', wrote);

    if (!wrote) {
      log('FAILED: could not write text');
      return false;
    }

    const postButton = await waitForLinkedInPostButton();
    log('native Post button enabled:', Boolean(postButton));

    if (!postButton) {
      log('FAILED: native Post button never enabled');
      return false;
    }

    clickLinkedInControl(postButton);

    const composerClosed = await waitForElementGone(findNativeComposerDialog, POSTED_DIALOG_CLOSE_TIMEOUT_MS);
    log('native composer closed after post:', composerClosed);

    isFormatterOpen = false;
    renderFormatter(true);
    showNativeComposer();

    if (!composerClosed) {
      // Post outcome unknown; hand LinkedIn's composer back to the user
      // instead of leaving an invisible dialog blocking the page.
      log('WARNING: composer still open after Post click, revealing it');
    } else {
      log('SUCCESS: posted through LinkedIn');
    }

    return true;
  } finally {
    isBridgingToNativeComposer = false;
  }
}

function handleDocumentStartPostEvent(event: MouseEvent | PointerEvent) {
  if (isBridgingToNativeComposer) {
    log('handleDocumentStartPostEvent ignored (bridging)');
    return;
  }

  const target = event.target instanceof Element ? event.target : null;

  if (!target || target.closest(`#${ROOT_ID}`)) {
    return;
  }

  const control = target.closest<HTMLElement>('button, [role="button"]');

  if (!control || !isStartPostControl(control)) {
    return;
  }

  log('Start-post control clicked, opening formatter');
  openFormatter();
}

function openNativeComposerForPost() {
  const opened = openNativeLinkedInComposer();
  log('openNativeComposerForPost, found Start-post control:', opened);
}

async function waitForLinkedInComposer() {
  return waitForElement(findLinkedInComposer, 3500);
}

async function waitForLinkedInPostButton() {
  return waitForElement(findLinkedInPostButton, 3500);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function waitForElement<T extends Element>(finder: () => T | null, timeoutMs: number): Promise<T | null> {
  const found = finder();

  if (found) {
    return Promise.resolve(found);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const current = finder();

      if (current) {
        window.clearInterval(interval);
        resolve(current);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
}

function waitForElementGone(finder: () => Element | null, timeoutMs: number): Promise<boolean> {
  if (!finder()) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      if (!finder()) {
        window.clearInterval(interval);
        resolve(true);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(interval);
        resolve(false);
      }
    }, 150);
  });
}

function hideNativeComposer() {
  // In focusable mode the injected opacity:0 CSS keeps the composer invisible;
  // applying the visibility:hidden class would make it unfocusable and break
  // the post bridge, so strip the class instead.
  if (suppressMode === 'focusable') {
    queryAllDeep<HTMLElement>(`.${NATIVE_HIDDEN_CLASS_NAME}`).forEach((element) => {
      element.classList.remove(NATIVE_HIDDEN_CLASS_NAME);
    });
    return;
  }

  findNativeComposerDialogs().forEach(hideDialogSurface);
}

function showNativeComposer() {
  unsuppressNativeComposer();
  queryAllDeep<HTMLElement>(`.${NATIVE_HIDDEN_CLASS_NAME}`).forEach((element) => {
    element.classList.remove(NATIVE_HIDDEN_CLASS_NAME);
  });
}

// Injects the suppression stylesheet into the document and every shadow root so
// the composer is styled invisible at render time (zero-flash takeover). Mode
// controls focusability: 'hidden' (default) blocks LinkedIn's focus trap;
// 'focusable' keeps the composer focusable for the post bridge.
function suppressNativeComposer(mode: 'hidden' | 'focusable' = suppressMode) {
  suppressMode = mode;
  const css = mode === 'focusable' ? SUPPRESS_CSS_FOCUSABLE : SUPPRESS_CSS_HIDDEN;

  ensureSuppressStyle(document.head ?? document.documentElement, css);

  for (const host of queryAllDeep<HTMLElement>('*')) {
    if (host.shadowRoot) {
      ensureSuppressStyle(host.shadowRoot, css);
    }
  }

  if (mode === 'focusable') {
    // Drop any visibility:hidden class so the composer can receive focus.
    queryAllDeep<HTMLElement>(`.${NATIVE_HIDDEN_CLASS_NAME}`).forEach((element) => {
      element.classList.remove(NATIVE_HIDDEN_CLASS_NAME);
    });
  }
}

function ensureSuppressStyle(container: ParentNode & Node, css: string) {
  let style = (container as ParentNode).querySelector<HTMLStyleElement>(`#${SUPPRESS_STYLE_ID}`);

  if (!style) {
    style = document.createElement('style');
    style.id = SUPPRESS_STYLE_ID;
    container.appendChild(style);
  }

  if (style.textContent !== css) {
    style.textContent = css;
  }
}

function unsuppressNativeComposer() {
  suppressMode = 'hidden';
  queryAllDeep<HTMLStyleElement>(`#${SUPPRESS_STYLE_ID}`).forEach((style) => style.remove());
}

// Dismisses LinkedIn's composer (and its discard confirmation) while keeping
// every surface hidden, so closing the formatter never flashes LinkedIn UI.
function closeNativeComposer() {
  const startedAt = Date.now();

  const runDismissPass = (): 'continue' | 'stop' | 'giveup' => {
    if (isFormatterOpen) {
      return 'stop';
    }

    hideNativeComposer();
    const closedSomething = closeNativeLinkedInComposer();
    const discardedSomething = dismissNativeComposerDiscardConfirmation();
    const elapsed = Date.now() - startedAt;

    if (elapsed >= DISMISS_TIMEOUT_MS) {
      return findNativeComposerDialog() ? 'giveup' : 'stop';
    }

    if (!findNativeComposerDialog() && !closedSomething && !discardedSomething && elapsed >= 700) {
      return 'stop';
    }

    return 'continue';
  };

  const finish = (result: 'stop' | 'giveup') => {
    if (result === 'giveup') {
      log('closeNativeComposer gave up, revealing native composer');
    }

    // Reveal anything still hidden: either nothing is left (no-op) or the
    // dismissal failed and the user needs to see LinkedIn's dialog.
    showNativeComposer();
  };

  const first = runDismissPass();

  if (first !== 'continue') {
    finish(first === 'giveup' ? 'giveup' : 'stop');
    return;
  }

  const interval = window.setInterval(() => {
    const result = runDismissPass();

    if (result === 'continue') {
      return;
    }

    window.clearInterval(interval);
    finish(result);
  }, DISMISS_LOOP_INTERVAL_MS);
}

function unmountFormatter() {
  mountedRoot?.unmount();
  mountedRoot = null;

  if (mountedContainer?.isConnected) {
    mountedContainer.remove();
  }

  mountedContainer = null;
}

function scheduleMount() {
  window.setTimeout(() => {
    mountFormatter();
  }, 100);
}

function renderMountError(container: HTMLElement, error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown mount error';
  container.textContent = `LinkedIn Post Formatter failed to mount: ${message}`;
  container.setAttribute(DIAGNOSTIC_ATTRIBUTE, 'mount-error');
}

scheduleMount();

const observer = new MutationObserver(() => {
  scheduleMount();

  if (isFormatterOpen) {
    window.setTimeout(hideNativeComposer, 0);
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('click', handleDocumentStartPostEvent, true);
document.addEventListener('linkedin-post-formatter:open', openFormatter);

window.addEventListener('beforeunload', () => {
  observer.disconnect();
  document.removeEventListener('click', handleDocumentStartPostEvent, true);
  document.removeEventListener('linkedin-post-formatter:open', openFormatter);
  unmountFormatter();
});
