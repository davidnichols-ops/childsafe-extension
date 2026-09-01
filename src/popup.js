document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

async function updateStatus() {
  const { config } = await chrome.storage.local.get(['config']);
  const enabled = config?.sensitivity !== undefined;
  document.getElementById('status').textContent = enabled
    ? `Active (mode: ${config.imageMode || 'blur'})`
    : 'Not configured';
}

updateStatus();
