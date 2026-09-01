document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

async function updateStatus() {
  const { config } = await chrome.storage.local.get(['config']);

  if (!config || !config.onboarded) {
    document.getElementById('status').textContent = 'Setup needed — click Open Settings';
    document.getElementById('incognito-status').style.display = 'none';
    return;
  }

  const imagesOn = config.imageMode !== 'disabled';
  const textOn = config.textEnabled ?? true;
  const adsOn = config.networkBlockEnabled ?? true;
  const active = imagesOn || textOn || adsOn;

  const parts = [];
  if (imagesOn) parts.push('Images');
  if (textOn) parts.push('Text');
  if (adsOn) parts.push('Ads');
  document.getElementById('status').textContent = active
    ? `Protected — filtering ${parts.join(', ')}`
    : 'All filters off';

  // Incognito check
  chrome.extension.isAllowedIncognitoAccess((allowed) => {
    const el = document.getElementById('incognito-status');
    if (allowed) {
      el.className = 'popup-incognito ok';
      el.textContent = 'Private browsing: protected';
    } else {
      el.className = 'popup-incognito bad';
      el.textContent = 'Private browsing: NOT protected — open settings to fix';
    }
  });
}

updateStatus();
