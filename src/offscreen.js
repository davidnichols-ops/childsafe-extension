import * as nsfwjs from 'nsfwjs';
import * as tf from '@tensorflow/tfjs';

let model = null;

async function init() {
  try {
    await tf.setBackend('webgl');
    await tf.ready();
    model = await nsfwjs.load('MobileNetV2');
  } catch (e) {
    console.error('[ChildSafe offscreen] model init failed', e);
  }
}

init();

async function classify(dataUrl) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = dataUrl;
  await img.decode();
  const predictions = await model.classify(img);
  return predictions;
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
