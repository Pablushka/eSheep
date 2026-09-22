# DesktopPet.js

This is a modern TypeScript port of `DesktopPet.js`. It keeps the same public API (`new ESheep()` / `pet.Start(url)`) while replacing the older patterns with typed models, compiled expressions, pointer events, cached DOM lookups, and GPU‑friendly transforms.

## Demo

The repository includes a small Vite demo page in `index.html`.

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite. The page imports `DesktopPet.ts` directly, starts one sheep automatically, and includes controls for adding and clearing instances.

## Chromium extension

Build the project, then load the repository folder as an unpacked extension:

```sh
pnpm run build
```

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this project folder.
4. Open or refresh a web page. The sheep will roam in the viewport.

Use the extension popup to pause or resume the sheep across open pages. The animation XML and embedded sprite are stored locally in `animation.xml`, so the extension does not need the eSheep website at runtime.

# Original Credits

This is a refactor of ...


# Key changes at a glance

| Area | Before | After |
|---|---|---|
| Types | plain JS, `var`, no types | typed interfaces for XML model, `const`/`let` |
| XML parsing | re‑queried DOM every frame | parsed once into a `Map<string, AnimationDef>` |
| Config loading | one XHR per sheep | `fetch` + `Promise` cache, sprite shared across sheep |
| Expressions | `eval()` + regex `replace()` per call | `Function` compiled once, constant sub‑expressions cached |
| Positioning | `style.left` / `style.top` | `transform: translate3d(...)` (composited, no layout) |
| Animation loop | `setTimeout` chain | `setTimeout` → `requestAnimationFrame` for paint‑aligned updates |
| Collisions | `getElementsByTagName` + rects each frame | element list cached, invalidated by `MutationObserver` |
| Resize | broken `document.body` listener | `window` resize + rAF throttling |
| Dragging | mouse events + manual bounds | pointer events + pointer capture + drag threshold |
| Cleanup | none | `Destroy()` detaches listeners, disconnects observers, removes nodes |
| Bug fixes | spawn probability always read `spawns[0]`; `areaW` mapped to `screenH`; `<b>` lost via `appendChild` return; fractional deltas truncated by `parseInt` | fixed (compat note kept for `areaW`) |

The `areaW` → `screenH` mapping was kept intentionally (with a `@compat` comment) so existing animation XMLs behave identically; flip it to `screenW` if you control all the XML files.
