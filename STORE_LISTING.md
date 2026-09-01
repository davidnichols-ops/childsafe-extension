# Chrome Web Store Listing — ChildSafe

This file contains all the metadata you need to fill in the Chrome Web
 Store Developer Dashboard. Do **not** upload this file — copy its contents
 into the corresponding dashboard fields.

---

## Item name

```
ChildSafe
```

## Summary (132 chars max)

```
Privacy-first child safety: blocks NSFW images/video, warns on PII and grooming in text, blocks ad networks. All ML runs locally.
```

## Category

```
Productivity
```

## Single purpose (required field)

```
ChildSafe filters inappropriate images, video, and text on web pages to protect children from harmful content. It uses on-device machine learning to classify media and text, blocks known ad/malware networks, and warns children before they submit personal information in text fields.
```

## Permission justification

Fill these in the dashboard's permission justification section:

### storage
```
Stores the parent's configuration (sensitivity, blocked categories, allow/block lists), audit logs of filtering actions, and the PBKDF2 hash of the parent PIN. No data leaves the device.
```

### activeTab
```
Accesses the current tab to extract images and video frames for local ML classification, and to attach text-input guards to form fields. Without this, the extension cannot scan page content.
```

### offscreen
```
Runs the ONNX Runtime Web and Transformers.js ML models in an offscreen document, which is required because service workers cannot use WebGL/WASM inference or the DOM canvas API needed for image classification.
```

### declarativeNetRequest
```
Blocks network requests to known advertising and malware domains (doubleclick.net, googleadservices.com) using Chrome's declarativeNetRequest API. The static rule list is bundled with the extension.
```

### declarativeNetRequestWithHostAccess
```
Applies the parent-configured dynamic blocklist (custom blocked sites) which requires host access to match and block requests on those domains.
```

### host permission: <all_urls>
```
The extension must scan content on any website a child visits. Restricting to specific domains would leave children unprotected on the vast majority of sites. Content scripts run at document_start to pre-hide media before it is visible, and the ML classification happens locally — no page content is transmitted to any server.
```

## Privacy practices

### Are you selling or transmitting user data to third parties?
```
No
```

### Are you using analytics or tracking?
```
No
```

### Privacy policy URL
```
https://davidnichols-ops.github.io/childsafe-extension/privacy
```
(Enable GitHub Pages on this repo — see instructions below.)

## Screenshots

You need 1–5 screenshots (1280x800 or 640x400 PNG). Suggested captures:

1. **Options panel** — the parental control settings page showing image backend, sensitivity slider, and blocked categories. (Shows the PIN lock and configuration UI.)
2. **Image filtering in action** — a page where an inappropriate image is blurred with the `.childsafe-masked` CSS class applied.
3. **Text guard warning** — a textarea showing the "ChildSafe warning: phone, email, school" label below the input.
4. **Site allow/block lists** — the site management section with entries in both lists.
5. **Audit log** — the log view showing timestamped filtering events.

Take screenshots by loading the unpacked extension in Chrome, navigating to test pages, and using `Cmd+Shift+4` or Chrome's screenshot tool.

## Promotional images (optional but recommended)

- **Small tile**: 440x280 PNG
- **Marquee**: 1400x560 PNG

Use the shield icon on a blue gradient background with the tagline "Privacy-first child safety."

## Distribution

- **Visibility**: Public
- **Who is it for?**: Parents and guardians
- **Pricing**: Free

---

## GitHub Pages setup (for privacy policy URL)

After pushing these changes to GitHub:

1. Go to https://github.com/davidnichols-ops/childsafe-extension/settings/pages
2. Under **Source**, select **Deploy from a branch**
3. Select branch **main** and folder **/ (root)**
4. Click **Save**
5. Wait 1–2 minutes, then verify: https://davidnichols-ops.github.io/childsafe-extension/privacy

Or enable via API (the push script does this automatically):
```bash
gh api -X POST repos/davidnichols-ops/childsafe-extension/pages \
  -f source[branch]=main -f source[path]=/
```
