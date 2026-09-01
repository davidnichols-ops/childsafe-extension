const form = document.getElementById('settings');
const sensitivity = document.getElementById('sensitivity');
const sensitivityVal = document.getElementById('sensitivity-val');
const status = document.getElementById('status');

sensitivity.addEventListener('input', () => {
  sensitivityVal.textContent = sensitivity.value;
});

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

async function saveConfig(config) {
  await chrome.storage.local.set({ config });
}

async function loadConfig() {
  const res = await chrome.storage.local.get(['config']);
  const c = res.config || {};
  sensitivity.value = c.sensitivity ?? 0.7;
  document.getElementById('imageMode').value = c.imageMode ?? 'blur';
  document.getElementById('textEnabled').checked = c.textEnabled ?? true;
  document.getElementById('networkBlockEnabled').checked = c.networkBlockEnabled ?? true;
  sensitivityVal.textContent = sensitivity.value;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = document.getElementById('pin').value;
  const config = {
    sensitivity: parseFloat(sensitivity.value),
    imageMode: document.getElementById('imageMode').value,
    textEnabled: document.getElementById('textEnabled').checked,
    networkBlockEnabled: document.getElementById('networkBlockEnabled').checked
  };
  if (pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    config.pinHash = await hashPin(pin, salt);
  }
  await saveConfig(config);
  status.textContent = 'Settings saved.';
  setTimeout(() => (status.textContent = ''), 2000);
});

loadConfig();
