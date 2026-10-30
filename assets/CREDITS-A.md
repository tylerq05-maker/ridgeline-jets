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
