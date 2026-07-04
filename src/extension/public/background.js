chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !tab.url.includes('linkedin.com')) {
    return;
  }

  try {
    // If a formatter instance already owns the page, ask it to open instead of
    // injecting a second module instance (which duplicates listeners/observers).
    const [{ result: alreadyLoaded }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const loaded = Boolean(document.getElementById('linkedin-post-formatter-extension-root'));
        if (loaded) {
          document.dispatchEvent(new CustomEvent('linkedin-post-formatter:open'));
        }
        return loaded;
      },
    });

    if (!alreadyLoaded) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-script.js'],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['style.css'],
      });
    }
  } catch (error) {
    console.error('LinkedIn Post Formatter injection failed', error);
  }
});
