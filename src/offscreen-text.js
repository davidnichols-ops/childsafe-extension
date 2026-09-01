// Transformers.js (Hugging Face / Xenova) text-classification backend.
// Loads a lightweight quantized model from the Hugging Face Hub at runtime and
// returns predictions matching the same {className, probability} contract used
// by the image classifiers.

import { env, pipeline } from '@xenova/transformers';

// Use remote HF models; do not bundle them in the extension package.
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useFSCache = false;

let classifier = null;
let loadPromise = null;
let modelName = null;

async function getConfig() {
  const resp = await chrome.runtime.sendMessage({ type: 'get-config' });
  return (resp && resp.config) || {};
}

async function load() {
  if (classifier && loadPromise) return classifier;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const config = await getConfig();
    modelName = config.textModel || 'Xenova/toxic-bert';
    classifier = await pipeline('text-classification', modelName, { quantized: true });
    window.__textClassifier = classifier;
    window.__textModelName = modelName;
    console.log('[ChildSafe offscreen-text] loaded', modelName);
    return classifier;
  })();

  loadPromise.catch((e) => {
    window.__textError = e && e.message ? e.message : String(e);
    console.error('[ChildSafe offscreen-text] load failed', e);
  });

  return loadPromise;
}

async function classify(text) {
  const pipe = await load();
  const result = await pipe(text);
  // result is either an object {label, score} or an array of them.
  const raw = Array.isArray(result) ? result : [result];
  const total = raw.reduce((sum, r) => sum + r.score, 0);
  const predictions = raw.map((r) => ({
    className: String(r.label),
    probability: r.score / (total || 1)
  }));
  return predictions.sort((a, b) => b.probability - a.probability);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'classify-text-internal') return false;
  classify(msg.text)
    .then((predictions) => sendResponse({ predictions }))
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

// Expose for debugging.
window.__textClassify = classify;

// Pre-load the model as soon as the offscreen document starts.
load().catch(() => {});
