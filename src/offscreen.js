import * as nsfwjs from 'nsfwjs';
import * as tf from '@tensorflow/tfjs';

let model = null;

async function initBackend() {
  for (const backend of ['webgl', 'cpu']) {
    try {
      await tf.setBackend(backend);
      await tf.ready();
      return backend;
    } catch (e) {
      console.warn(`[ChildSafe offscreen] ${backend} backend failed, trying next`, e);
    }
  }
  throw new Error('No usable TensorFlow.js backend');
}

async function init() {
  try {
    await initBackend();
    model = await nsfwjs.load('MobileNetV2');
    window.__nsfwModel = model;
    window.__nsfwClassify = classify;
    console.log('[ChildSafe offscreen] nsfwjs MobileNetV2 loaded');
  } catch (e) {
    console.error('[ChildSafe offscreen] model init failed', e);
  }
}

init();

async function loadImage(dataUrl) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

async function classify(dataUrl) {
  const img = await loadImage(dataUrl);
  return model.classify(img);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'classify-image-internal') return false;

  if (!model) {
    sendResponse({ error: 'Model not ready' });
    return true;
  }

  classify(msg.dataUrl)
    .then((predictions) => sendResponse({ predictions }))
    .catch((err) => sendResponse({ error: err.message }));

  return true;
});
