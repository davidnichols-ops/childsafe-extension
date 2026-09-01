# ChildSafe Extension — Privacy Policy

**Last updated: September 1, 2026**

ChildSafe is a privacy-first browser extension that helps protect children from inappropriate content. This privacy policy explains what data the extension processes and how.

## The short version

**ChildSafe does not collect, transmit, or sell any personal data.** All content analysis happens locally on your device. No browsing history, images, text, or usage data ever leaves your browser.

## What the extension does

ChildSafe scans web pages in real time to filter inappropriate images, video, and text:

- **Image and video classification** runs inside an offscreen document using a machine-learning model (ONNX Runtime Web). Images are drawn to a canvas, converted to pixel data, and classified locally. The pixel data is never uploaded.
- **Text input guarding** scans text that a child types into `<textarea>` and `<input>` fields for personally identifiable information (phone numbers, email addresses, SSNs), school names, and grooming keywords. This scan uses local regex matching and, optionally, a local text-classification model.
- **Network blocking** uses Chrome's `declarativeNetRequest` API to block requests to known ad and malware domains before they load. No network requests are observed or logged beyond the static blocklist.
- **Audit logs** of filtering actions (e.g., "image blocked", "text warning shown") are stored locally in `chrome.storage.local` and never transmitted anywhere.

## Data storage

All data is stored locally in the browser's extension storage (`chrome.storage.local`):

| Data | What it is | Where it lives |
|---|---|---|
| Configuration | Sensitivity threshold, blocked categories, allow/block lists, PIN hash | `chrome.storage.local` |
| Audit logs | Timestamp, event type, and truncated URL of filtering actions (max 500 entries) | `chrome.storage.local` |
| PIN hash | PBKDF2-derived hash of the parent PIN (100,000 iterations, SHA-256) | `chrome.storage.local` |

No data is stored on any external server. The parent can export and import configuration/logs as a JSON file, and can clear logs at any time.

## Remote resources

The extension fetches **model files** (not user data) from Hugging Face (`huggingface.co`) at runtime:

- **Image model**: A quantized ONNX safety-classification model downloaded from `huggingface.co` on first use and cached by the browser. No user data is sent in this request — it is a standard file download.
- **Text model** (optional): If the parent enables the Transformers.js backend, a quantized text-classification model is downloaded from `huggingface.co` and cached locally. No user text is ever sent to Hugging Face; the model runs entirely in the browser.

The extension's Content Security Policy restricts outbound connections to `huggingface.co` and its CDN only. No other domains are reachable.

## What we do NOT do

- We do **not** collect or transmit browsing history.
- We do **not** upload images, video frames, or text to any server.
- We do **not** use analytics, tracking pixels, or telemetry.
- We do **not** sell or share data with third parties.
- We do **not** store the parent PIN in plaintext — only a PBKDF2 hash.
- We do **not** inject advertising.

## Permissions and why each is needed

| Permission | Why it's needed |
|---|---|
| `storage` | Store configuration, audit logs, and PIN hash locally |
| `activeTab` | Access the current tab to scan images and text on the page |
| `offscreen` | Run ML inference in an offscreen document (outside the service worker) |
| `declarativeNetRequest` | Block requests to known ad/malware domains |
| `declarativeNetRequestWithHostAccess` | Apply dynamic blocklist rules that require host access |
| `<all_urls>` (host permission) | Scan content on any page a child visits — the extension cannot protect specific sites only without missing harmful content |

## Children's privacy

This extension is designed for children's safety. It does not collect any personal information from children or anyone else. The text guard feature is specifically designed to **prevent** children from sharing personal information (PII) by warning them before they submit it.

## Data deletion

To delete all extension data:

1. Right-click the ChildSafe icon and select **Remove from Chrome**.
2. Confirm removal. All stored configuration, logs, and cached models are deleted.

Alternatively, from the options page, use **Clear** in the Audit log section and **Export** then delete the file if you want to keep a backup.

## Open source

ChildSafe is open source under the MIT license. The full source code is available at [github.com/davidnichols-ops/childsafe-extension](https://github.com/davidnichols-ops/childsafe-extension). You can audit every line of code yourself.

## Changes to this policy

If this privacy policy changes, the updated version will be posted in this repository and the "Last updated" date will be revised.

## Contact

For privacy questions or concerns, open an issue at [github.com/davidnichols-ops/childsafe-extension/issues](https://github.com/davidnichols-ops/childsafe-extension/issues).
