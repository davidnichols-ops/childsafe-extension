const OFFSCREEN_PATH = chrome.runtime.getURL('offscreen.html');

async function setupOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['WORKERS'],
    justification: 'Run TensorFlow.js image classification outside the service worker.'
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'classify-image') return false;

  (async () => {
    await setupOffscreen();
    const result = await chrome.runtime.sendMessage({ ...msg, type: 'classify-image-internal' });
    sendResponse(result);
  })();

  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const defaultPolicy = await fetch(chrome.runtime.getURL('config/policy.json')).then(r => r.json());
  await chrome.storage.local.set({ policy: defaultPolicy, config: defaultPolicy });
  console.log('[ChildSafe] installed, default policy loaded');
});
