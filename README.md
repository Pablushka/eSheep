<p align="center">
  <img src="assets/banner-small.png" alt="eSheep — a tiny sheep that roams your browser" width="100%" />
</p>

# eSheep 🐑

A tiny pixel-art sheep that lives in your browser. It wanders around the page, hops onto headings and cards, naps in the corner, munches on things, and generally brightens up whatever you're browsing — as a Chromium extension.

Bring a little company to the web. 🌱

## What it does

- 🐑 **Roams freely** — the sheep walks across any page you open.
- 🧱 **Knows your layout** — it lands on and walks along cards, headers, sections and borders.
- 🖱️ **Can be dragged** — grab it with the mouse and drop it anywhere.
- 🎬 **Has lots of animations** — walk, run, jump, sleep, eat, fall… try them all from the popup.
- 🎚️ **Easy on / off** — pause or resume the sheep from the extension popup.

## Try the demo

The repo includes a small Vite demo page so you can meet the sheep without installing the extension:

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite. A sheep starts roaming right away — use the buttons to add more sheep or clear the page.

## Install the extension

```sh
pnpm run build
```

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open or refresh any web page — the sheep will wander in.

The animation data and the sprite are bundled inside `animation.xml`, so the extension works offline with no external requests.

## Publish to the Chrome Web Store

A packaging script produces a store-ready ZIP with `manifest.json` at its root:

```sh
pnpm zip
```

This builds the extension and writes `esheep-v<version>.zip`, ready to upload at the [Chrome Web Store developer console](https://chrome.google.com/webstore/devconsole).

## Privacy

The extension does not collect, store, share, or sell any user data.

- [Privacy Policy (English)](PRIVACY_POLICY.md)
- [Política de Privacidad (Español)](PRIVACY_POLICY_ES.md)

## For developers

This is a modern TypeScript port of the web version of `DesktopPet.js`. The public API is unchanged — `new ESheep()` followed by `pet.Start(url)` — while the internals have been modernized:

- Typed XML model parsed once into a `Map` (no per-frame DOM queries).
- Expressions compiled once and cached instead of `eval()` on every frame.
- `transform: translate3d(...)` positioning (GPU-composited, no layout thrash).
- Pointer events with drag support, plus a small drag threshold.
- Collision detection that follows the real page layout (borders and backgrounds).
- `Destroy()` cleans up the DOM, listeners and observers.

## Credits

- **eSheep** — the original desktop pet by [Adriano Petrucci](https://esheep.petrucci.ch).
- This repository is a TypeScript port and extension wrapper of the web version.
