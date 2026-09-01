let config = { sensitivity: 0.7, imageMode: 'blur', textEnabled: true };
const seen = new WeakSet();

chrome.storage.local.get(['config'], (res) => {
  if (res.config) config = { ...config, ...res.config };
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.config) config = { ...config, ...changes.config.newValue };
});

function currentHost() {
  return window.location.hostname.replace(/^www\./, '');
}

function hostInList(list) {
  const host = currentHost();
  return (list || []).some((h) => host === h || host.endsWith('.' + h));
}

function shouldSkip() {
  return hostInList(config.allowedSites);
}

function isBlockedHost() {
  return hostInList(config.blockedSites);
}

function log(eventType, detail) {
  chrome.runtime.sendMessage({ type: 'log-event', eventType, detail, url: window.location.href }).catch(() => {});
}

function mask(el) {
  if (!el) return;
  el.classList.add('childsafe-masked');
  el.classList.remove('childsafe-hidden');
}

function hide(el) {
  if (!el) return;
  el.classList.add('childsafe-hidden');
  el.classList.remove('childsafe-masked');
}

function unmask(el) {
  if (!el) return;
  el.classList.remove('childsafe-masked', 'childsafe-hidden');
}

function applyVerdict(el, isUnsafe) {
  if (isUnsafe) {
    if (config.imageMode === 'remove') {
      el.remove();
    } else if (config.imageMode === 'hide') {
      hide(el);
    } else {
      mask(el);
    }
  } else {
    unmask(el);
  }
}

async function dataUrlFromElement(el) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = el.naturalWidth || el.videoWidth || el.width || 224;
  canvas.height = el.naturalHeight || el.videoHeight || el.height || 224;
  ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function classifyImage(dataUrl) {
  return chrome.runtime.sendMessage({ type: 'classify-image', dataUrl });
}

function isUnsafePrediction(predictions) {
  if (!predictions || !predictions[0]) return false;
  const top = predictions[0];
  const risky = ['Porn', 'Hentai', 'Sexy'];
  return risky.includes(top.className) && top.probability >= config.sensitivity;
}

async function scanImage(img) {
  if (seen.has(img)) return;
  seen.add(img);
  if (shouldSkip()) return;
  if (isBlockedHost()) {
    hide(img);
    log('image_blocked_host', currentHost());
    return;
  }
  mask(img);
  try {
    const dataUrl = await dataUrlFromElement(img);
    const { predictions, error } = await classifyImage(dataUrl);
    if (error) throw new Error(error);
    const unsafe = isUnsafePrediction(predictions);
    applyVerdict(img, unsafe);
    if (unsafe) log('image_blocked', predictions[0].className);
  } catch (e) {
    console.error('[ChildSafe] image scan failed', e);
    // Fail closed: keep masked.
  }
}

async function scanVideo(video) {
  if (seen.has(video)) return;
  seen.add(video);
  if (shouldSkip()) return;
  if (isBlockedHost()) {
    hide(video);
    log('video_blocked_host', currentHost());
    return;
  }
  mask(video);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const sample = async () => {
    if (video.paused || video.ended || video.readyState < 2) return;
    canvas.width = 224;
    canvas.height = 224;
    ctx.drawImage(video, 0, 0, 224, 224);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const { predictions, error } = await classifyImage(dataUrl);
    if (error) return;
    const unsafe = isUnsafePrediction(predictions);
    applyVerdict(video, unsafe);
    if (unsafe) log('video_blocked', predictions[0].className);
  };

  video.addEventListener('play', () => {
    const id = setInterval(() => {
      if (video.paused || video.ended) { clearInterval(id); return; }
      sample();
    }, 1000);
  });

  if (!video.paused) await sample();
}

const piiPatterns = [
  { name: 'phone', regex: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
  { name: 'email', regex: /\S+@\S+\.\S+/ },
  { name: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'address', regex: /\b\d+\s+[a-zA-Z0-9\s,]+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd)\b/i }
];
const schoolKeywords = ['school', 'high school', 'middle school', 'elementary'];
const groomingKeywords = ["don't tell", 'secret', 'meet up', 'send pic', 'alone', "parents won't know"];

function scanText(value) {
  const warnings = [];
  for (const p of piiPatterns) {
    if (p.regex.test(value)) warnings.push(p.name);
  }
  const lower = value.toLowerCase();
  for (const kw of schoolKeywords) if (lower.includes(kw)) warnings.push('school');
  for (const kw of groomingKeywords) if (lower.includes(kw)) warnings.push('grooming');
  return [...new Set(warnings)];
}

function warnInput(el, warnings) {
  el.classList.add('childsafe-warning');
  let label = el.nextElementSibling;
  if (!label || !label.classList.contains('childsafe-warning-label')) {
    label = document.createElement('div');
    label.className = 'childsafe-warning-label';
    el.parentNode.insertBefore(label, el.nextSibling);
  }
  label.textContent = `⚠ ChildSafe warning: ${warnings.join(', ')}`;
}

function attachTextGuard(el) {
  el.addEventListener('input', () => {
    if (!config.textEnabled || shouldSkip()) return;
    const warnings = scanText(el.value);
    if (warnings.length) {
      warnInput(el, warnings);
      log('text_warning', warnings.join(','));
    } else {
      el.classList.remove('childsafe-warning');
      const label = el.nextElementSibling;
      if (label && label.classList.contains('childsafe-warning-label')) label.remove();
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const warnings = scanText(el.value);
      if (warnings.length && !confirm('This message may contain personal info. Are you sure you want to send it?')) {
        e.preventDefault();
      }
    }
  });
}

const io = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      if (entry.target.tagName === 'IMG') scanImage(entry.target);
      else if (entry.target.tagName === 'VIDEO') scanVideo(entry.target);
      io.unobserve(entry.target);
    }
  }
}, { threshold: 0.05, rootMargin: '100px' });

function observeElement(el) {
  if (!el || el.dataset.childsafeObserved) return;
  el.dataset.childsafeObserved = '1';
  if (el.tagName === 'IMG' || el.tagName === 'VIDEO') io.observe(el);
  if (el.matches?.('textarea, input[type="text"], input:not([type])')) attachTextGuard(el);
}

function scanNode(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  observeElement(node);
  for (const el of node.querySelectorAll('img, video, textarea, input[type="text"], input:not([type])')) {
    observeElement(el);
  }
}

const mo = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) scanNode(node);
  }
});

mo.observe(document.documentElement, { childList: true, subtree: true });
for (const el of document.querySelectorAll('img, video, textarea, input[type="text"], input:not([type])')) {
  observeElement(el);
}
