const OFFSCREEN_PATH = chrome.runtime.getURL('offscreen.html');
const DEFAULT_POLICY = chrome.runtime.getURL('config/policy.json');
const LOG_LIMIT = 500;

async function setupOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['WORKERS'],
    justification: 'Run TensorFlow.js image classification outside the service worker.'
  });
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
  if (msg.type === 'classify-image') {
    (async () => {
      await setupOffscreen();
      const result = await chrome.runtime.sendMessage({ ...msg, type: 'classify-image-internal' });
      sendResponse(result);
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
      sendResponse({ ok: true });
    })();
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(async () => {
  const defaultPolicy = await fetch(DEFAULT_POLICY).then((r) => r.json());
  await chrome.storage.local.set({ policy: defaultPolicy, config: defaultPolicy, logs: [] });
  await applyNetworkBlocking(defaultPolicy.networkBlockEnabled);
  await updateDynamicBlocklist(defaultPolicy.blockedSites);
  console.log('[ChildSafe] installed, default policy loaded');
});
