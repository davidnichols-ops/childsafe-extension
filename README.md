# ChildSafe Extension

A privacy-first, Manifest V3 browser extension for child safety. It combines client-side ML with tamper-evident policy enforcement:

- **Image classification** runs in an [Offscreen Document](https://developer.chrome.com/docs/extensions/reference/api/offscreen) using either [`nsfwjs`](https://github.com/infinitered/nsfwjs) (TensorFlow.js / MobileNetV2) or [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) with a user-supplied ONNX safety model.
- **Text input guarding** scans `<textarea>`/`<input>` fields for PII, grooming keywords, and toxic language before a child submits them. The regex guard is always on; an optional [Transformers.js](https://github.com/xenova/transformers.js) / Hugging Face text-classification pipeline runs in a separate offscreen document.
- **Video frame sampling** draws video frames to a canvas and sends them to the active image classifier.
- **Network blocking** uses `chrome.declarativeNetRequest` to stop known ad/malware networks before assets load.
- **Tamper resistance** is layered: WebCrypto PBKDF2 PIN hashing, a signed policy manifest pipeline (placeholder), and guidance for managed Chrome Enterprise policies.

This project does **not** train new models. It ties together existing open-source components.

## Open-source coverage

The extension is built by tying together the following projects and models. Projects marked **integrated** are wired into the extension; **reference only** means the architecture or training provenance was reviewed but not copied.

| # | Project / Model | License | Status in ChildSafe |
|---|-----------------|---------|---------------------|
| 1 | [`nsfw-filter/nsfw-filter`](https://github.com/nsfw-filter/nsfw-filter) | GPL-3.0 | **Architecture reference only.** Its MV3 offscreen/content-script pattern was studied, but no substantial code was copied (to avoid GPL obligations). |
| 2 | [`infinitered/nsfwjs`](https://github.com/infinitered/nsfwjs) | MIT | **Integrated** as the default image backend. Loads MobileNetV2 once, classifies `ImageData`/elements, and returns `{className, probability}` predictions for `Drawing`, `Hentai`, `Neutral`, `Porn`, `Sexy`. |
| 3 | [`microsoft/onnxruntime-web`](https://github.com/microsoft/onnxruntime) | MIT | **Integrated** as the second image backend. Runs ONNX models in an offscreen document with a `wasm` execution provider behind the same `{className, probability}` interface. |
| 4 | [`huggingface/transformers.js`](https://github.com/huggingface/transformers.js) via [`@xenova/transformers`](https://github.com/xenova/transformers.js) | MIT | **Integrated** as the optional text backend. Loads a remote Hugging Face text-classification model (default `Xenova/toxic-bert`) in a dedicated offscreen document. |
| 5 | [`tensorflow/tfjs`](https://github.com/tensorflow/tfjs) | Apache-2.0 | **Used transitively** by `nsfwjs` for WebGL/CPU inference. |
| 6 | **NSFWJS MobileNet** | MIT | **Default `nsfwjs` model.** Loaded by `nsfwjs.load('MobileNetV2')`; the model is bundled/loaded by the library. |
| 7 | [`OwenElliott/image-safety-classifier-s`](https://huggingface.co/OwenElliott/image-safety-classifier-s) | MIT | **Default ONNX model.** Returns `NSFL`, `NSFW`, `SFW` logits; the offscreen backend applies softmax and maps them to the common prediction format. |
| 8 | [`Falconsai/nsfw_image_detection_26`](https://huggingface.co/Falconsai/nsfw_image_detection_26) | Apache-2.0 | **Preset in the options panel.** The model is gated on Hugging Face, so the URL is pre-filled but access requires a token/authentication. |
| 9 | [`bhky/opennsfw2`](https://github.com/bhky/opennsfw2) | MIT | **Reference only.** A Python reference for NSFW preprocessing; not shipped in the browser extension. |
| 10 | [`notAI-tech/NudeNet`](https://github.com/notAI-tech/NudeNet) | AGPL-3.0 | **Reference only.** Documented as a detector baseline, but not integrated due to license and provenance concerns. |

## Architecture

```
Web Page (DOM)
  │ MutationObserver / IntersectionObserver
  ▼
Content Script (content.js)
  │ document_start CSS hiding; canvas extraction; text guards
  ▼
Background Service Worker (background.js)
  │ keeps the correct offscreen doc alive; routes messages
  ▼
Offscreen Documents
  ├── offscreen.js        → nsfwjs + TensorFlow.js
  ├── offscreen-onnx.js   → ONNX Runtime Web image model
  └── offscreen-text.js   → Transformers.js text classification
  ▼
Action Pipeline
  blur / hide / remove element
  declarativeNetRequest block list
  local tamper-evident logs
```

The service worker swaps between the active image offscreen (`nsfwjs` or `onnx`) and the text offscreen as needed, then restores the image offscreen so the next media element can be classified quickly.

## Build

```bash
npm install
npm run build
```

This outputs a `dist/` directory. Load `dist/` in Chrome as an unpacked extension.

> **Note:** The default build produces a ~40 MB `offscreen.js` because `nsfwjs` bundles its MobileNetV2 model as base64 and pulls the full TensorFlow.js stack. To get under the 15–20 MB consumer-extension target, switch to the ONNX backend with a quantized model; the `offscreen-onnx.js` backend loads the model from a remote URL at runtime.

## Sign a custom policy (placeholder)

```bash
npm run sign -- config/policy.json dist/policy.json .keys/policy.key.json
```

The signing step is a placeholder; replace with a production key-management flow before shipping.

## Enterprise / anti-bypass notes

- Use Chrome Enterprise `ExtensionInstallForcelist` and `ExtensionInstallBlocklist` to force-install and prevent removal.
- Combine with OS-level parental controls (macOS Screen Time, Windows Family Safety) because no extension alone can survive a factory-reset or a different browser profile.
- For hardware-bound enforcement, consider a companion native messaging host or MDM-managed device policy.

## License

MIT. See individual dependency and model licenses for runtime and model terms.
