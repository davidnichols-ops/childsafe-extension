const $ = (id) => document.getElementById(id);

let currentConfig = {};
let currentLogs = [];

function normalizeHost(raw) {
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL('https://' + raw);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return raw.trim().toLowerCase();
  }
}

async function hashPin(pin, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return { hash: Array.from(new Uint8Array(bits)), salt: Array.from(salt) };
}

async function verifyPin(pin, pinHash) {
  if (!pinHash) return false;
  const derived = await hashPin(pin, new Uint8Array(pinHash.salt));
  return derived.hash.every((b, i) => b === pinHash.hash[i]);
}

function setVisible(id, visible) {
  $(id).hidden = !visible;
}

async function loadData() {
  const { config = {}, logs = [] } = await chrome.storage.local.get(['config', 'logs']);
  currentConfig = config;
  currentLogs = logs;
}

const DEFAULT_ONNX_MODEL = 'https://huggingface.co/OwenElliott/image-safety-classifier-s/resolve/main/onnx/image-safety-classifier-s.onnx';
const FALCONSAI_MODEL_URL = 'https://huggingface.co/Falconsai/nsfw_image_detection_26/resolve/main/quantized_onnx/model.onnx';
const BACKEND_BLOCKED_CATEGORIES = {
  onnx: ['NSFW', 'NSFL']
};
const ONNX_MODEL_PRESETS = {
  owen: DEFAULT_ONNX_MODEL,
  falconsai: FALCONSAI_MODEL_URL
};

function renderSettings() {
  $('imageBackend').value = currentConfig.imageBackend ?? 'onnx';
  $('onnxModelUrl').value = currentConfig.onnxModelUrl ?? DEFAULT_ONNX_MODEL;
  $('blockedCategories').value = (currentConfig.blockedCategories ?? BACKEND_BLOCKED_CATEGORIES.onnx).join(', ');
  $('sensitivity').value = currentConfig.sensitivity ?? 0.7;
  $('sensitivity-val').textContent = $('sensitivity').value;
  $('imageMode').value = currentConfig.imageMode ?? 'blur';
  $('textBackend').value = currentConfig.textBackend ?? 'regex';
  $('textModel').value = currentConfig.textModel ?? 'Xenova/toxic-bert';
  $('textBlockedCategories').value = (currentConfig.textBlockedCategories ?? ['toxic', 'severe_toxic', 'threat', 'identity_hate']).join(', ');
  $('textEnabled').checked = currentConfig.textEnabled ?? true;
  $('networkBlockEnabled').checked = currentConfig.networkBlockEnabled ?? true;
}

function setBackendDefaults() {
  const backend = $('imageBackend').value;
  const cats = $('blockedCategories').value.trim();
  if (!cats) {
    $('blockedCategories').value = BACKEND_BLOCKED_CATEGORIES[backend].join(', ');
  }
  const url = $('onnxModelUrl').value.trim();
  if (backend === 'onnx' && !url) {
    $('onnxModelUrl').value = DEFAULT_ONNX_MODEL;
  }
}

function setOnnxModelPreset() {
  const preset = $('onnxModelPreset')?.value;
  if (preset && ONNX_MODEL_PRESETS[preset]) {
    $('onnxModelUrl').value = ONNX_MODEL_PRESETS[preset];
    if (preset === 'falconsai') {
      $('blockedCategories').value = 'NSFW';
    } else if (preset === 'owen') {
      $('blockedCategories').value = BACKEND_BLOCKED_CATEGORIES.onnx.join(', ');
    }
  }
}

function setTextBackendDefaults() {
  const backend = $('textBackend').value;
  const cats = $('textBlockedCategories').value.trim();
  if (!cats) {
    $('textBlockedCategories').value = ['toxic', 'severe_toxic', 'threat', 'identity_hate'].join(', ');
  }
  if (backend === 'transformers' && !$('textModel').value.trim()) {
    $('textModel').value = 'Xenova/toxic-bert';
  }
}

function renderLists() {
  const allowList = $('allow-list');
  const blockList = $('block-list');
  allowList.innerHTML = '';
  blockList.innerHTML = '';
  for (const site of currentConfig.allowedSites || []) {
    allowList.appendChild(makeListItem(site, 'allowedSites'));
  }
  for (const site of currentConfig.blockedSites || []) {
    blockList.appendChild(makeListItem(site, 'blockedSites'));
  }
}

function makeListItem(site, listKey) {
  const li = document.createElement('li');
  li.textContent = site;
  const btn = document.createElement('button');
  btn.textContent = 'Remove';
  btn.className = 'secondary small';
  btn.addEventListener('click', async () => {
    currentConfig[listKey] = (currentConfig[listKey] || []).filter((s) => s !== site);
    await saveConfig(currentConfig);
    renderLists();
  });
  li.appendChild(btn);
  return li;
}

async function addSite(inputId, listKey) {
  const raw = $(inputId).value.trim();
  if (!raw) return;
  const host = normalizeHost(raw);
  currentConfig[listKey] = [...new Set([...(currentConfig[listKey] || []), host])];
  await saveConfig(currentConfig);
  $(inputId).value = '';
  renderLists();
}

function renderLogs() {
  const view = $('log-view');
  if (!currentLogs.length) {
    view.textContent = 'No events recorded.';
    return;
  }
  view.textContent = currentLogs
    .slice()
    .reverse()
    .map((e) => `[${new Date(e.at).toLocaleString()}] ${e.type}: ${e.detail || ''} (${e.url || ''})`)
    .join('\n');
}

async function saveConfig(config) {
  await chrome.storage.local.set({ config });
  await chrome.runtime.sendMessage({ type: 'config-updated', config });
}

async function saveLogs(logs) {
  await chrome.storage.local.set({ logs });
}

async function unlock() {
  const pin = $('unlock-pin').value;
  if (!pin) return;
  const ok = await verifyPin(pin, currentConfig.pinHash);
  if (ok) {
    setVisible('lock-screen', false);
    setVisible('panel', true);
    $('lock-status').textContent = '';
  } else {
    $('lock-status').textContent = 'Incorrect PIN.';
  }
}

async function setupPin() {
  const pin = $('setup-pin').value;
  const confirm = $('setup-pin-confirm').value;
  if (pin.length < 4) {
    $('setup-status').textContent = 'PIN must be at least 4 characters.';
    return;
  }
  if (pin !== confirm) {
    $('setup-status').textContent = 'PINs do not match.';
    return;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  currentConfig.pinHash = await hashPin(pin, salt);
  await saveConfig(currentConfig);
  setVisible('setup-screen', false);
  setVisible('panel', true);
}

async function submitSettings(e) {
  e.preventDefault();
  const newPin = $('new-pin').value;
  const newPinConfirm = $('new-pin-confirm').value;
  if (newPin) {
    if (newPin.length < 4) {
      $('save-status').textContent = 'New PIN too short.';
      return;
    }
    if (newPin !== newPinConfirm) {
      $('save-status').textContent = 'New PINs do not match.';
      return;
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    currentConfig.pinHash = await hashPin(newPin, salt);
  }
  currentConfig.imageBackend = $('imageBackend').value;
  currentConfig.onnxModelUrl = $('onnxModelUrl').value.trim() || DEFAULT_ONNX_MODEL;
  currentConfig.blockedCategories = $('blockedCategories').value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  currentConfig.sensitivity = parseFloat($('sensitivity').value);
  currentConfig.imageMode = $('imageMode').value;
  currentConfig.textBackend = $('textBackend').value;
  currentConfig.textModel = $('textModel').value.trim() || 'Xenova/toxic-bert';
  currentConfig.textBlockedCategories = $('textBlockedCategories').value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  currentConfig.textEnabled = $('textEnabled').checked;
  currentConfig.networkBlockEnabled = $('networkBlockEnabled').checked;
  await saveConfig(currentConfig);
  $('save-status').textContent = 'Settings saved.';
  setTimeout(() => ($('save-status').textContent = ''), 2000);
}

async function clearLogs() {
  currentLogs = [];
  await saveLogs(currentLogs);
  renderLogs();
}

async function exportData() {
  const blob = new Blob([JSON.stringify({ config: currentConfig, logs: currentLogs }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `childsafe-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importData() {
  const file = $('import-file').files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.config) {
      currentConfig = { ...currentConfig, ...data.config };
      await saveConfig(currentConfig);
    }
    if (Array.isArray(data.logs)) {
      currentLogs = data.logs;
      await saveLogs(currentLogs);
    }
    renderSettings();
    renderLists();
    renderLogs();
    $('import-status').textContent = 'Imported.';
  } catch (e) {
    $('import-status').textContent = 'Import failed: ' + e.message;
  }
}

async function init() {
  await loadData();

  $('sensitivity').addEventListener('input', () => {
    $('sensitivity-val').textContent = $('sensitivity').value;
  });

  $('unlock-btn').addEventListener('click', unlock);
  $('setup-btn').addEventListener('click', setupPin);
  $('settings').addEventListener('submit', submitSettings);
  $('imageBackend').addEventListener('change', setBackendDefaults);
  $('onnxModelPreset')?.addEventListener('change', setOnnxModelPreset);
  $('textBackend').addEventListener('change', setTextBackendDefaults);
  $('allow-add').addEventListener('click', () => addSite('allow-input', 'allowedSites'));
  $('block-add').addEventListener('click', () => addSite('block-input', 'blockedSites'));
  $('clear-logs').addEventListener('click', clearLogs);
  $('export-btn').addEventListener('click', exportData);
  $('import-btn').addEventListener('click', importData);

  if (currentConfig.pinHash) {
    setVisible('lock-screen', true);
    setVisible('setup-screen', false);
    setVisible('panel', false);
  } else {
    setVisible('lock-screen', false);
    setVisible('setup-screen', true);
    setVisible('panel', false);
  }

  renderSettings();
  renderLists();
  renderLogs();
}

init();
