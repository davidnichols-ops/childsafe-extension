# ChildSafe Extension

A privacy-first, Manifest V3 browser extension for child safety. It combines client-side ML with tamper-evident policy enforcement:

- **Image classification** runs in an [Offscreen Document](https://developer.chrome.com/docs/extensions/reference/api/offscreen) using [`nsfwjs`](https://github.com/infinitered/nsfwjs) and TensorFlow.js.
- **Text input guarding** scans `<textarea>`/`<input>` fields for PII and grooming keywords before a child submits them.
- **Video frame sampling** draws video frames to a canvas and sends them to the same offscreen classifier.
- **Network blocking** uses `chrome.declarativeNetRequest` to stop known ad/malware networks before assets load.
- **Tamper resistance** is layered: WebCrypto PIN hashing, a signed policy manifest pipeline (placeholder), and guidance for managed Chrome Enterprise policies.

This project does **not** train new models. It ties together existing open-source components.

## Open-source components used

| Component | License | Role in this project |
|---|---|---|
| [nsfwjs](https://github.com/infinitered/nsfwjs) | MIT | On-device image NSFW classification (MobileNetV2) |
| [TensorFlow.js](https://github.com/tensorflow/tfjs) | Apache-2.0 | WebGL/WASM inference backend |
| [SafeInnocence](https://github.com/davidmonterocrespo24/SafeInnocence) | MIT | Reference MV3 patterns for child-safety UI and Gemini Nano fallback ideas |
| [nsfw-filter](https://github.com/nsfw-filter/nsfw-filter) | GPL-3.0 | Reference architecture for hiding media until classified |
| [pg-patrol](https://github.com/nareshnavinash/pg-patrol) | MIT | Reference for TypeScript MV3 child-safety layout |

Optional upgrades to research:

- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) for quantized INT8 safety models.
- [Transformers.js](https://github.com/xenova/transformers.js) for on-device toxic-text / grooming classifiers.
- [trustcard](https://github.com/davidnichols-ops/trustcard) signing primitives for extension-update and policy manifests.

## Architecture

```
Web Page (DOM)
  │ MutationObserver / IntersectionObserver
  ▼
Content Script (content.js)
  │ early CSS hiding; canvas extraction; text guards
  ▼
Service Worker (background.js)
  │ keeps offscreen doc alive; forwards messages
  ▼
Offscreen Document (offscreen.js)
  │ TensorFlow.js + nsfwjs inference
  ▼
Action Pipeline
  blur / hide / remove element
  declarativeNetRequest block list
  local tamper-evident logs
```

## Build

```bash
npm install
npm run build
```

This outputs a `dist/` directory. Load it in Chrome as an unpacked extension.

> **Note:** The default build produces a ~40 MB `offscreen.js` because `nsfwjs` bundles its MobileNetV2 model as base64 and pulls the full TensorFlow.js stack. To get under the 15–20 MB consumer-extension target, replace `nsfwjs` with an ONNX Runtime Web build using a quantized MobileViT/YOLO or INT8 NSFW model; the `offscreen.js` loader and message contract stay the same.

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

MIT. See individual dependency licenses for model and runtime terms.
