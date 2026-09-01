const OFFSCREEN_PATHS = {
  onnx: chrome.runtime.getURL('offscreen-onnx.html'),
  text: chrome.runtime.getURL('offscreen-text.html')
};
const DEFAULT_POLICY = chrome.runtime.getURL('config/policy.json');
const LOG_LIMIT = 500;

async function getImageBackend() {
  const { config = {} } = await chrome.storage.local.get(['config']);
  return config.imageBackend || 'onnx';
}

async function setupOffscreen(kind) {
  const url = OFFSCREEN_PATHS[kind] || OFFSCREEN_PATHS.onnx;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0 && contexts[0].documentUrl === url) return;
  if (contexts.length > 0) await chrome.offscreen.closeDocument();
  await chrome.offscreen.createDocument({
    url,
    reasons: ['WORKERS'],
    justification: 'Run ML inference (image or text) outside the service worker.'
  });
}

async function restoreImageOffscreen() {
  const backend = await getImageBackend();
  await setupOffscreen(backend);
}

async function applyNetworkBlocking(enabled) {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enabled ? ['childsafe_default'] : [],
      disableRulesetIds: enabled ? [] : ['childsafe_default']
    });
  } catch (e) {
    console.error('[ChildSafe] DNR toggle failed', e);
  }
}

async function logEvent(type, detail, url) {
  const { logs = [] } = await chrome.storage.local.get(['logs']);
  logs.push({ at: Date.now(), type, detail: String(detail).slice(0, 240), url: String(url || '').slice(0, 240) });
  while (logs.length > LOG_LIMIT) logs.shift();
  await chrome.storage.local.set({ logs });
}

async function updateDynamicBlocklist(blockedSites) {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map((r) => r.id).filter((id) => id >= 1000);
    const addRules = (blockedSites || []).slice(0, 100).map((host, idx) => ({
      id: 1000 + idx,
      priority: 2,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${host}`,
        resourceTypes: ['main_frame', 'sub_frame', 'image', 'media', 'script', 'xmlhttprequest']
      }
    }));
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (e) {
    console.error('[ChildSafe] dynamic blocklist update failed', e);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetch-image-url') {
    // Background fetch bypasses CORS — the service worker has <all_urls> host permission.
    // This is the fallback when canvas extraction in the content script fails (tainted canvas).
    (async () => {
      try {
        const resp = await fetch(msg.url, { mode: 'cors', credentials: 'omit' });
        if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
        const blob = await resp.blob();
        // Limit to 5MB to avoid memory issues
        if (blob.size > 5 * 1024 * 1024) throw new Error('image too large');
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('FileReader failed'));
          reader.readAsDataURL(blob);
        });
        sendResponse({ dataUrl });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'classify-image') {
    (async () => {
      const backend = await getImageBackend();
      await setupOffscreen(backend);
      const result = await chrome.runtime.sendMessage({ ...msg, type: 'classify-image-internal' });
      sendResponse(result);
    })();
    return true;
  }

  if (msg.type === 'classify-text') {
    (async () => {
      try {
        await setupOffscreen('text');
        const result = await chrome.runtime.sendMessage({ type: 'classify-text-internal', text: msg.text });
        // Swap back to the image offscreen so the next image classification is ready.
        restoreImageOffscreen().catch(() => {});
        sendResponse(result);
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'log-event') {
    (async () => {
      await logEvent(msg.eventType, msg.detail, msg.url);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'get-logs') {
    (async () => {
      const { logs = [] } = await chrome.storage.local.get(['logs']);
      sendResponse({ logs });
    })();
    return true;
  }

  if (msg.type === 'get-config') {
    (async () => {
      const { config = {} } = await chrome.storage.local.get(['config']);
      sendResponse({ config });
    })();
    return true;
  }

  if (msg.type === 'clear-logs') {
    (async () => {
      await chrome.storage.local.set({ logs: [] });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'config-updated') {
    (async () => {
      await applyNetworkBlocking(msg.config.networkBlockEnabled);
      await updateDynamicBlocklist(msg.config.blockedSites);
      await restoreImageOffscreen();
      sendResponse({ ok: true });
    })();
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(async () => {
  const defaultPolicy = await fetch(DEFAULT_POLICY).then((r) => r.json());
  const { config: existing } = await chrome.storage.local.get(['config']);
  const config = { ...defaultPolicy, ...(existing || {}) };
  await chrome.storage.local.set({ policy: defaultPolicy, config, logs: [] });
  await applyNetworkBlocking(config.networkBlockEnabled);
  await updateDynamicBlocklist(config.blockedSites);
  console.log('[ChildSafe] installed, default policy loaded');
});

// ===== Incognito monitoring =====
// If the parent enabled incognito during onboarding but it gets disabled later,
// show a warning badge on the extension icon.
async function checkIncognitoBadge() {
  const { config = {} } = await chrome.storage.local.get(['config']);
  if (!config.onboarded || !config.incognitoRequired) return;
  chrome.extension.isAllowedIncognitoAccess((allowed) => {
    if (allowed) {
      chrome.action.setBadgeText({ text: '' });
    } else {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    }
  });
}

// Check on startup and periodically
checkIncognitoBadge();
chrome.alarms?.create('incognito-check', { periodInMinutes: 5 });
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'incognito-check') checkIncognitoBadge();
});
