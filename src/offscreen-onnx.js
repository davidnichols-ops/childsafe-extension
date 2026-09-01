/* global ort */
// ONNX Runtime Web backend for image classification.
// Loads a user-supplied ONNX model (default: OwenElliott/image-safety-classifier-s)
// and returns prediction objects matching the nsfwjs message contract.

const DEFAULT_MODEL_URL = 'https://huggingface.co/OwenElliott/image-safety-classifier-s/resolve/main/onnx/image-safety-classifier-s.onnx';

let model = null;
let modelUrl = null;
let labels = ['NSFL', 'NSFW', 'SFW'];
let loadPromise = null;

async function getConfig() {
  // Offscreen documents do not expose chrome.storage; request config from the service worker.
  const resp = await chrome.runtime.sendMessage({ type: 'get-config' });
  return (resp && resp.config) || {};
}

async function init() {
  const config = await getConfig();
  modelUrl = config.onnxModelUrl || DEFAULT_MODEL_URL;
  if (!modelUrl) {
    throw new Error('No onnxModelUrl configured');
  }

  if (!window.ort) {
    throw new Error('ONNX Runtime Web not loaded');
  }

  // Disable multi-threading in the extension offscreen context.
  // With numThreads=1 the runtime does not spawn workers and can run without
  // cross-origin isolation, but we still set COOP/COEP to satisfy the
  // threaded Emscripten module's SharedArrayBuffer allocation.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('ort/');

  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`Failed to fetch ONNX model: ${response.status}`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  model = await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });
  window.__onnxModel = model;
  window.__onnxClassify = classify;
}

function ensureLoaded() {
  if (model) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = init().catch((e) => {
    loadPromise = null;
    throw e;
  });
  return loadPromise;
}

function softmax(values) {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

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
  await ensureLoaded();

  const img = await loadImage(dataUrl);

  const size = 224;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  const imageData = ctx.getImageData(0, 0, size, size).data;

  // Model expects NCHW float32, RGB, pixel values in [0, 255].
  const inputData = new Float32Array(1 * 3 * size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * size + x;
      inputData[dst] = imageData[src];         // R
      inputData[size * size + dst] = imageData[src + 1]; // G
      inputData[2 * size * size + dst] = imageData[src + 2]; // B
    }
  }

  const tensor = new ort.Tensor('float32', inputData, [1, 3, size, size]);
  const feeds = {};
  // The default OwenElliott model uses input name "image".
  feeds[model.inputNames[0] || 'image'] = tensor;

  const results = await model.run(feeds);
  const output = results[model.outputNames[0]];
  const values = Array.from(output.data);
  const probs = values.length === labels.length ? softmax(values) : values;

  const predictions = labels.map((className, i) => ({
    className,
    probability: probs[i] ?? 0
  }));
  return predictions.sort((a, b) => b.probability - a.probability);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'classify-image-internal') return false;

  classify(msg.dataUrl)
    .then((predictions) => sendResponse({ predictions }))
    .catch((err) => sendResponse({ error: err.message }));

  return true;
});

// Pre-load the model as soon as the offscreen document starts.
ensureLoaded().catch((e) => {
  window.__onnxError = e && e.message ? e.message : String(e);
  console.error('[ChildSafe offscreen-onnx] init failed', e);
});
