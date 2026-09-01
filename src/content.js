let config = {
  sensitivity: 0.7,
  imageMode: 'blur',
  textEnabled: true,
  textBackend: 'regex',
  textModel: 'Xenova/toxic-bert',
  textBlockedCategories: ['toxic', 'severe_toxic', 'threat', 'identity_hate'],
  blockedCategories: ['NSFW', 'NSFL']
};
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
  if (config.imageMode === 'disabled') return true;
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
  // Strategy 1: try canvas extraction directly (works for same-origin and data: URLs)
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = el.naturalWidth || el.videoWidth || el.width || 224;
    canvas.height = el.naturalHeight || el.videoHeight || el.height || 224;

    // Check if image is broken/incomplete before drawing
    if (el.tagName === 'IMG' && !el.complete) {
      await new Promise((resolve) => {
        if (el.complete) resolve();
        else {
          el.addEventListener('load', resolve, { once: true });
          el.addEventListener('error', resolve, { once: true });
        }
      });
    }
    if (el.tagName === 'IMG' && el.naturalWidth === 0) throw new Error('broken image');

    ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (canvasErr) {
    // Canvas extraction failed (tainted canvas, broken image, CORS).
    // Strategy 2: ask the background service worker to fetch the image URL.
    // The service worker has <all_urls> host permission and bypasses CORS.
    if (el.src && el.src.startsWith('http')) {
      const resp = await chrome.runtime.sendMessage({ type: 'fetch-image-url', url: el.src });
      if (resp && resp.dataUrl) return resp.dataUrl;
      throw new Error('background fetch also failed: ' + (resp && resp.error ? resp.error : canvasErr.message));
    }
    throw canvasErr;
  }
}

async function classifyImage(dataUrl) {
  return chrome.runtime.sendMessage({ type: 'classify-image', dataUrl });
}

async function classifyText(text) {
  return chrome.runtime.sendMessage({ type: 'classify-text', text });
}

function isUnsafePrediction(predictions, blocked) {
  if (!predictions || !predictions.length) return false;
  const risky = blocked || config.blockedCategories || ['Porn', 'Hentai', 'Sexy'];
  const maxBlocked = predictions
    .filter((p) => risky.includes(p.className))
    .reduce((m, p) => Math.max(m, p.probability), 0);
  return maxBlocked >= config.sensitivity;
}

async function scanImage(img) {
  if (seen.has(img)) return;
  seen.add(img);
  if (window.__childsafe) window.__childsafe.status[img.id || 'img'] = 'scanning';
  if (shouldSkip()) return;
  if (isBlockedHost()) {
    hide(img);
    log('image_blocked_host', currentHost());
    return;
  }
  // Don't pre-mask. Classify first, then only mask if unsafe.
  // This is "fail open" — if classification fails, the image stays visible.
  try {
    const dataUrl = await dataUrlFromElement(img);
    if (window.__childsafe) window.__childsafe.status[img.id || 'img'] = 'classifying';
    // Timeout: if classification takes more than 10s, show the image (fail open)
    const result = await Promise.race([
      classifyImage(dataUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
    ]);
    const { predictions, error } = result;
    if (error) throw new Error(error);
    const unsafe = isUnsafePrediction(predictions);
    applyVerdict(img, unsafe);
    if (window.__childsafe) window.__childsafe.status[img.id || 'img'] = unsafe ? 'blocked' : 'safe';
    if (unsafe) log('image_blocked', predictions[0].className);
  } catch (e) {
    // Fail open: unmask the image so it's visible
    unmask(img);
    console.error('[ChildSafe] image scan failed', e);
    if (window.__childsafe) window.__childsafe.status[img.id || 'img'] = 'error: ' + e.message;
    log('image_scan_error', e.message);
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
  // Don't pre-mask. Sample and classify, only mask if unsafe.

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const sample = async () => {
    if (video.paused || video.ended || video.readyState < 2) return;
    canvas.width = 224;
    canvas.height = 224;
    ctx.drawImage(video, 0, 0, 224, 224);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    try {
      const result = await Promise.race([
        classifyImage(dataUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]);
      const { predictions, error } = result;
      if (error) return;
      const unsafe = isUnsafePrediction(predictions);
      applyVerdict(video, unsafe);
      if (unsafe) log('video_blocked', predictions[0].className);
    } catch (e) {
      // Fail open: leave video visible
    }
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

function scanTextRegex(value) {
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
  label.textContent = `ChildSafe warning: ${warnings.join(', ')}`;
}

function textLooksUnsafe(predictions) {
  const risky = config.textBlockedCategories || ['toxic', 'severe_toxic', 'threat', 'identity_hate'];
  return isUnsafePrediction(predictions, risky);
}

async function scanText(value) {
  const warnings = scanTextRegex(value);
  if (config.textBackend === 'transformers' && value.length > 2) {
    try {
      const { predictions, error } = await classifyText(value);
      if (error) throw new Error(error);
      if (textLooksUnsafe(predictions)) {
        const top = predictions[0];
        warnings.push(`ml:${top.className}(${(top.probability * 100).toFixed(0)}%)`);
      }
    } catch (e) {
      console.warn('[ChildSafe] text ML classification failed', e);
    }
  }
  return [...new Set(warnings)];
}

function attachTextGuard(el) {
  el.addEventListener('input', () => {
    if (!config.textEnabled || shouldSkip()) return;
    scanText(el.value).then((warnings) => {
      if (warnings.length) {
        warnInput(el, warnings);
        log('text_warning', warnings.join(','));
      } else {
        el.classList.remove('childsafe-warning');
        const label = el.nextElementSibling;
        if (label && label.classList.contains('childsafe-warning-label')) label.remove();
      }
    });
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      scanText(el.value).then((warnings) => {
        if (warnings.length && !confirm('This message may contain personal info. Are you sure you want to send it?')) {
          e.preventDefault();
        }
      });
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
  if (el.tagName === 'IMG') {
    scanImage(el);
  } else if (el.tagName === 'VIDEO') {
    scanVideo(el);
  } else if (el.matches?.('textarea, input[type="text"], input:not([type])')) {
    attachTextGuard(el);
  }
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

window.__childsafe = {
  scanImage,
  dataUrlFromElement,
  classifyImage,
  isUnsafePrediction,
  applyVerdict,
  mask,
  unmask,
  hide,
  getConfig: () => config,
  status: {}
};
