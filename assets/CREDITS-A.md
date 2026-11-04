# Third-party assets and code (agent A: aircraft, materials, lighting)

| Asset | File(s) | Source | Author | License |
|---|---|---|---|---|
| HDRI "Kloofendal 48d Partly Cloudy (Pure Sky)", 1k .hdr | `assets/env/kloofendal_48d_partly_cloudy_puresky_1k.hdr` | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky (downloaded from https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr) | Greg Zaal (Poly Haven) | CC0 1.0 |
| three.js r128 RGBELoader | `js/vendor/RGBELoader.js` | https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/RGBELoader.js | three.js authors | MIT |
| three.js r128 GLTFLoader | `js/vendor/GLTFLoader.js` | https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js | three.js authors | MIT |

## Aircraft models

No third-party aircraft meshes are shipped. All aircraft are procedural (js/aircraft.js).

Checked: NASA 3D Resources (https://github.com/nasa/NASA-3D-Resources, public domain) contains no model of any
aircraft in the game's roster (its only airplane is the X-57 Maxwell). No other source with a clear CC0 / public-domain /
CC-BY license and a reachable download was found for the F-22, F-35, F-16, F/A-18 or B-2. `js/models.js` can swap in a
.glb (place it in `assets/aircraft/`, add a row above, and call `RJ.models.register(id, { url })`).


## Aircraft models (CC BY 4.0, from Sketchfab; textures downscaled to <= 2048 px, F-35 gear-down/rail variants hidden)
- F-22 Raptor — "Lockheed Martin F-22 "Raptor"" by andertan — https://sketchfab.com/3d-models/lockheed-martin-f-22-raptor-7e7b3c372e374dda98e70208d09cfdcf — CC BY 4.0
- Su-57 Felon — "Sukhoi Su-57 "Felon"" by andertan — https://sketchfab.com/3d-models/sukhoi-su-57-felon-09d546b4355c4fa6882ca46e05069bee — CC BY 4.0
- SR-71 — "Sr71" by manilov.ap — https://sketchfab.com/3d-models/sr71-908985d8ec544638bcd661bc315597ad — CC BY 4.0
- B-2 Spirit — "Lowpoly B2 Spirit bomber" by SIpriv — https://sketchfab.com/3d-models/lowpoly-b2-spirit-bomber-2ab3be1422064393a70485ee26e84cbe — CC BY 4.0
- F-35 — "F-35 Lightning II" by CloudHub — https://sketchfab.com/3d-models/f-35-lightning-ii-938c9a60d6894f9090a69e8ea5de2c3d — CC BY 4.0
- F-117 Nighthawk — "F-117 Nighthawk with GBU-12" by Jeyhun1985 — https://sketchfab.com/3d-models/f-117-nighthawk-with-gbu-12-c9a2211f357d48bbb3d1cd0bc790e4c0 — CC BY 4.0
