const $ = (id) => document.getElementById(id);

let config = {};
let logs = [];
let wizardStep = 0;
const WIZARD_STEPS = ['step-welcome', 'step-incognito', 'step-pin', 'step-level'];

// ===== Browser detection =====
function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return { name: 'Edge', extPage: 'edge://extensions', privateName: 'InPrivate' };
  if (ua.includes('OPR/') || ua.includes('Opera')) return { name: 'Opera', extPage: 'opera://extensions', privateName: 'incognito' };
  if (ua.includes('Vivaldi/')) return { name: 'Vivaldi', extPage: 'vivaldi://extensions', privateName: 'incognito' };
  // Brave has no unique UA but exposes navigator.brave
  if (navigator.brave) return { name: 'Brave', extPage: 'brave://extensions', privateName: 'incognito' };
  return { name: 'Chrome', extPage: 'chrome://extensions', privateName: 'incognito' };
}

// ===== Incognito access check =====
function checkIncognito() {
  return new Promise((resolve) => {
    chrome.extension.isAllowedIncognitoAccess((allowed) => resolve(allowed));
  });
}

async function renderIncognitoInstructions() {
  const browser = detectBrowser();
  const allowed = await checkIncognito();
  const box = $('incognito-warn');
  const nameEl = $('incognito-browser-name');
  const instrEl = $('incognito-instructions');

  if (allowed) {
    box.classList.add('ok');
    nameEl.textContent = `${browser.name}: Private browsing protection is ON`;
    instrEl.textContent = 'Your child cannot bypass ChildSafe by opening a private window.';
    $('btn-incognito-check').textContent = 'Continue';
  } else {
    box.classList.remove('ok');
    nameEl.textContent = `${browser.name}: Private browsing protection is OFF`;
    instrEl.innerHTML = `To enable it:<br><br>
      1. Open <b>${browser.extPage}</b><br>
      2. Find <b>ChildSafe</b> in the list<br>
      3. Click <b>Details</b> (or the extension name)<br>
      4. Turn on <b>"Allow in ${browser.privateName}"</b><br><br>
      Then come back and click "I've enabled it".`;
    $('btn-incognito-check').textContent = "I've enabled it";
  }
  return allowed;
}

async function renderIncognitoDashboard() {
  const browser = detectBrowser();
  const allowed = await checkIncognito();
  const el = $('incognito-dashboard-content');
  const barEl = $('incognito-status-bar');

  if (allowed) {
    el.innerHTML = `<div class="badge ok">Private browsing protected</div>
      <p class="muted" style="margin-top:8px">ChildSafe runs in ${browser.privateName} windows. Your child can't bypass it.</p>`;
    barEl.innerHTML = '<span class="badge ok">Incognito: ON</span>';
  } else {
    el.innerHTML = `<div class="warn-box">
      <h3>Private browsing is NOT protected</h3>
      <p>Your child can open a private (${browser.privateName}) window to bypass all filtering.</p>
      <p>To fix: open <b>${browser.extPage}</b> → ChildSafe → Details → enable <b>"Allow in ${browser.privateName}"</b></p>
    </div>`;
    barEl.innerHTML = '<span class="badge bad">Incognito: OFF</span>';
  }
}

// ===== PIN hashing (kept from original) =====
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

// ===== Config helpers =====
async function loadConfig() {
  const res = await chrome.storage.local.get(['config', 'logs']);
  config = res.config || {};
  logs = res.logs || [];
}

async function saveConfig(cfg) {
  await chrome.storage.local.set({ config: cfg });
  await chrome.runtime.sendMessage({ type: 'config-updated', config: cfg });
}

async function saveLogs(l) {
  await chrome.storage.local.set({ logs: l });
}

// ===== Protection level presets =====
const LEVELS = {
  basic: { sensitivity: 0.65, imageMode: 'blur', textEnabled: true, networkBlockEnabled: true, blockedCategories: ['NSFW', 'NSFL'] },
  strict: { sensitivity: 0.5, imageMode: 'hide', textEnabled: true, networkBlockEnabled: true, blockedCategories: ['NSFW', 'NSFL'] }
};

// Strength slider maps to sensitivity values
const STRENGTH = [
  { label: 'Relaxed', sensitivity: 0.8 },
  { label: 'Balanced', sensitivity: 0.65 },
  { label: 'Strict', sensitivity: 0.5 }
];

// ===== Wizard navigation =====
function showStep(idx) {
  wizardStep = idx;
  for (let i = 0; i < WIZARD_STEPS.length; i++) {
    const el = $(WIZARD_STEPS[i]);
    el.classList.toggle('active', i === idx);
  }
  const dots = $('progress').children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].className = 'dot' + (i < idx ? ' done' : i === idx ? ' current' : '');
  }
}

// ===== Wizard: welcome =====
$('btn-welcome-next').addEventListener('click', async () => {
  showStep(1);
  await renderIncognitoInstructions();
});

// ===== Wizard: incognito =====
$('btn-incognito-back').addEventListener('click', () => showStep(0));

$('btn-incognito-check').addEventListener('click', async () => {
  const allowed = await checkIncognito();
  if (allowed) {
    config.incognitoRequired = true;
    showStep(2);
  } else {
    // Re-check — maybe they just enabled it
    await renderIncognitoInstructions();
    const stillOff = await checkIncognito();
    if (!stillOff) {
      // Show skip option after 2 failed attempts
      $('btn-incognito-skip').style.display = 'inline-block';
    }
  }
});

$('btn-incognito-skip').addEventListener('click', () => {
  config.incognitoRequired = false;
  showStep(2);
});

// ===== Wizard: PIN =====
$('btn-pin-back').addEventListener('click', () => showStep(1));

$('btn-pin-next').addEventListener('click', async () => {
  const pin = $('wizard-pin').value;
  const confirm = $('wizard-pin-confirm').value;
  if (pin.length < 4) {
    $('wizard-pin-status').textContent = 'PIN must be at least 4 characters.';
    return;
  }
  if (pin !== confirm) {
    $('wizard-pin-status').textContent = 'PINs do not match.';
    return;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  config.pinHash = await hashPin(pin, salt);
  $('wizard-pin-status').textContent = '';
  showStep(3);
});

// ===== Wizard: protection level =====
let selectedLevel = 'basic';
document.querySelectorAll('.level-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.level-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedLevel = card.dataset.level;
  });
});

$('btn-level-back').addEventListener('click', () => showStep(2));

$('btn-level-finish').addEventListener('click', async () => {
  const preset = LEVELS[selectedLevel] || LEVELS.basic;
  config = {
    ...config,
    ...preset,
    imageBackend: 'onnx',
    onnxModelUrl: 'https://huggingface.co/OwenElliott/image-safety-classifier-s/resolve/main/onnx/image-safety-classifier-s.onnx',
    textBackend: 'regex',
    textModel: 'Xenova/toxic-bert',
    textBlockedCategories: ['toxic', 'severe_toxic', 'threat', 'identity_hate'],
    allowedSites: [],
    blockedSites: [],
    onboarded: true,
    protectionLevel: selectedLevel
  };
  await saveConfig(config);
  await chrome.storage.local.set({ logs: [] });
  logs = [];
  showDashboard();
});

// ===== PIN lock (returning) =====
$('unlock-btn').addEventListener('click', async () => {
  const pin = $('unlock-pin').value;
  if (!pin) return;
  const ok = await verifyPin(pin, config.pinHash);
  if (ok) {
    $('lock-screen').style.display = 'none';
    showDashboard();
  } else {
    $('lock-status').textContent = 'Incorrect PIN.';
  }
});

// ===== Dashboard =====
function showDashboard() {
  $('wizard').style.display = 'none';
  $('lock-screen').style.display = 'none';
  $('dashboard').style.display = 'block';
  renderDashboard();
}

function renderDashboard() {
  // Toggles
  $('toggle-images').checked = config.imageMode !== 'disabled';
  $('toggle-text').checked = config.textEnabled ?? true;
  $('toggle-ads').checked = config.networkBlockEnabled ?? true;

  // Strength slider — map sensitivity to 0/1/2
  const sens = config.sensitivity ?? 0.65;
  let strengthIdx = 1;
  if (sens >= 0.75) strengthIdx = 0;
  else if (sens <= 0.55) strengthIdx = 2;
  $('strength-slider').value = strengthIdx;
  $('strength-label').textContent = STRENGTH[strengthIdx].label;

  // Image mode buttons
  const mode = config.imageMode || 'blur';
  for (const btn of document.querySelectorAll('[data-mode]')) {
    btn.classList.toggle('btn-primary', btn.dataset.mode === mode);
    btn.classList.toggle('btn-secondary', btn.dataset.mode !== mode);
  }

  // Advanced
  $('adv-filter-model').value = config.imageBackend || 'onnx';
  $('adv-model-url').value = config.onnxModelUrl || '';
  $('adv-categories').value = (config.blockedCategories || []).join(', ');
  $('adv-text-model').value = config.textModel || '';
  $('adv-text-categories').value = (config.textBlockedCategories || []).join(', ');

  renderLists();
  renderLogs();
  renderIncognitoDashboard();
}

// ===== Toggle handlers =====
$('toggle-images').addEventListener('change', async (e) => {
  if (!e.target.checked) {
    config.imageMode = 'disabled';
  } else {
    config.imageMode = config.imageMode === 'disabled' ? 'blur' : config.imageMode;
  }
  await saveConfig(config);
});

$('toggle-text').addEventListener('change', async (e) => {
  config.textEnabled = e.target.checked;
  await saveConfig(config);
});

$('toggle-ads').addEventListener('change', async (e) => {
  config.networkBlockEnabled = e.target.checked;
  await saveConfig(config);
});

// ===== Strength slider =====
$('strength-slider').addEventListener('input', (e) => {
  const idx = parseInt(e.target.value);
  $('strength-label').textContent = STRENGTH[idx].label;
});

$('strength-slider').addEventListener('change', async (e) => {
  const idx = parseInt(e.target.value);
  config.sensitivity = STRENGTH[idx].sensitivity;
  await saveConfig(config);
});

// ===== Image mode buttons =====
for (const btn of document.querySelectorAll('[data-mode]')) {
  btn.addEventListener('click', async () => {
    config.imageMode = btn.dataset.mode;
    await saveConfig(config);
    renderDashboard();
  });
}

// ===== Advanced settings =====
$('adv-save').addEventListener('click', async () => {
  config.imageBackend = $('adv-filter-model').value;
  config.onnxModelUrl = $('adv-model-url').value.trim() || config.onnxModelUrl;
  config.blockedCategories = $('adv-categories').value.split(',').map((s) => s.trim()).filter(Boolean);
  config.textModel = $('adv-text-model').value.trim() || 'Xenova/toxic-bert';
  config.textBlockedCategories = $('adv-text-categories').value.split(',').map((s) => s.trim()).filter(Boolean);
  await saveConfig(config);
  $('adv-save-status').textContent = 'Saved.';
  setTimeout(() => ($('adv-save-status').textContent = ''), 2000);
});

// ===== Site lists =====
function normalizeHost(raw) {
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL('https://' + raw);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return raw.trim().toLowerCase();
  }
}

function renderLists() {
  for (const [listKey, ulId] of [['allowedSites', 'allow-list'], ['blockedSites', 'block-list']]) {
    const ul = $(ulId);
    ul.innerHTML = '';
    for (const site of config[listKey] || []) {
      const li = document.createElement('li');
      li.textContent = site;
      const btn = document.createElement('button');
      btn.textContent = 'Remove';
      btn.addEventListener('click', async () => {
        config[listKey] = (config[listKey] || []).filter((s) => s !== site);
        await saveConfig(config);
        renderLists();
      });
      li.appendChild(btn);
      ul.appendChild(li);
    }
  }
}

$('allow-add').addEventListener('click', async () => {
  const raw = $('allow-input').value.trim();
  if (!raw) return;
  const host = normalizeHost(raw);
  config.allowedSites = [...new Set([...(config.allowedSites || []), host])];
  await saveConfig(config);
  $('allow-input').value = '';
  renderLists();
});

$('block-add').addEventListener('click', async () => {
  const raw = $('block-input').value.trim();
  if (!raw) return;
  const host = normalizeHost(raw);
  config.blockedSites = [...new Set([...(config.blockedSites || []), host])];
  await saveConfig(config);
  $('block-input').value = '';
  renderLists();
});

// ===== Logs =====
function renderLogs() {
  const view = $('log-view');
  if (!logs.length) {
    view.textContent = 'No activity yet.';
    return;
  }
  view.textContent = logs
    .slice()
    .reverse()
    .map((e) => {
      const time = new Date(e.at).toLocaleString();
      const type = e.type.replace(/_/g, ' ');
      return `[${time}] ${type}: ${e.detail || ''}`;
    })
    .join('\n');
}

$('clear-logs').addEventListener('click', async () => {
  logs = [];
  await saveLogs(logs);
  renderLogs();
});

// ===== PIN change =====
$('save-pin').addEventListener('click', async () => {
  const newPin = $('new-pin').value;
  const confirm = $('new-pin-confirm').value;
  if (!newPin) {
    $('pin-save-status').textContent = 'Enter a new PIN.';
    return;
  }
  if (newPin.length < 4) {
    $('pin-save-status').textContent = 'PIN too short (4+ characters).';
    return;
  }
  if (newPin !== confirm) {
    $('pin-save-status').textContent = 'PINs do not match.';
    return;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  config.pinHash = await hashPin(newPin, salt);
  await saveConfig(config);
  $('new-pin').value = '';
  $('new-pin-confirm').value = '';
  $('pin-save-status').textContent = 'PIN updated.';
  setTimeout(() => ($('pin-save-status').textContent = ''), 2000);
});

// ===== Export / Import =====
$('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ config, logs }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `childsafe-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('import-btn').addEventListener('click', async () => {
  const file = $('import-file').files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.config) {
      config = { ...config, ...data.config };
      await saveConfig(config);
    }
    if (Array.isArray(data.logs)) {
      logs = data.logs;
      await saveLogs(logs);
    }
    renderDashboard();
    $('import-status').textContent = 'Imported.';
  } catch (e) {
    $('import-status').textContent = 'Import failed: ' + e.message;
  }
});

// ===== Init =====
async function init() {
  await loadConfig();

  if (!config.onboarded) {
    // First run — show wizard
    $('wizard').style.display = 'block';
    $('lock-screen').style.display = 'none';
    $('dashboard').style.display = 'none';
    showStep(0);
  } else if (config.pinHash) {
    // Returning user with PIN — show lock screen
    $('wizard').style.display = 'none';
    $('lock-screen').style.display = 'block';
    $('dashboard').style.display = 'none';
  } else {
    // Returning user without PIN — go straight to dashboard
    showDashboard();
  }
}

init();
