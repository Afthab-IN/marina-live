# Marina, Live: performance pass (phase 6)

Measured 11 Nov 2026 in Chrome (Playwright) on an Apple Silicon Mac. A real phone GPU and an
integrated laptop GPU were not available, so the phone numbers below are a phone-sized viewport
on this Mac's GPU, not a real phone.

## Frame time

| View | Setting | Median frame | p95 | Draw calls | Triangles drawn |
|---|---|---:|---:|---:|---:|
| Whole corridor, 1440x900 | high | 16.6 ms (60 fps) | 17.6 ms | 91 | about 1.3M |
| Whole corridor, 1440x900, CPU throttled 4x | high | 16.6 ms | 17.9 ms | 91 | about 1.3M |
| Street level near Chepauk, CPU throttled 4x | high | 16.8 ms | 17.7 ms | | |
| Whole corridor, 390x844 | lite | 16.6 ms | | 140 | about 1.2M |

Triangle counts include the shadow pass. "lite" is chosen automatically on touch devices and small
screens (or with `?q=lite`): half the illustrated trees, half the traffic, a 2048 shadow map, no tree
shadows, no MSAA in the lens, pixel ratio up to 1.5.

## What changed in this pass

- Trees: open-ended trunks and fronds, trunks and tree shadows only when zoomed in. Whole-corridor
  triangles fell from about 2.5M to 1.3M.
- Sea plane cropped to the actual sea, coarser grid; terrain cells far out at sea skipped.
- Building normals packed to 8 bits: building vertex attributes from about 23 MB to 17.8 MB.
- Static landmark meshes merged per material after loading (only the lighthouse beam stays
  separate): draw calls from 143 to 91 at the whole-corridor view.
- Adaptive resolution: two slow readings (under 28 fps) in a row drop the pixel ratio by half a step.
- Landmark models load after the map is on screen, each as its own 1.5 to 3 KB chunk, with retries.

## Download size

| File | Size |
|---|---:|
| JS bundle (three.js and app) | 217 KB gzip |
| Geometry worker | 14 KB |
| Landmark models | 1.5 to 3 KB each, loaded after first paint |
| public/data/world.pack | 1.09 MB (pre-gzipped) |
| public/data/scene.json | 12 KB gzip |

## Load time (production build, throttled network, cache off)

| Network | Map ready |
|---|---:|
| 12 Mbps, 60 ms latency | 2.9 s |
| 4 Mbps, 150 ms latency | 6.5 s |

These used a plain static server that does not compress JS (829 KB instead of 217 KB), so a
host that gzips JS (GitHub Pages, Vercel) should be roughly 0.4 to 1.2 s faster.
