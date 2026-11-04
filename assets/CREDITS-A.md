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
- Blue Angels F/A-18 — "Blue Angels FA/18" by Aidan McTaggart — https://sketchfab.com/3d-models/blue-angels-fa18-af0fde87125844bb947322526a9611fe — CC BY 4.0
- YF-23 — "YF-23 Black Jet Fighter" by Mymeria — https://sketchfab.com/3d-models/yf-23-black-jet-fighter-fc92d4ffd1d7455ebc4f4dcfd9bd7cc9 — CC BY 4.0
- XB-70 — "North American XB-70 Valkyrie" by Muhamad Mirza Arrafi — https://sketchfab.com/3d-models/north-american-xb-70-valkyrie-d33aff9d58f8469cbd1073c60b19f152 — CC BY 4.0
- B-52 — "Boeing B-52 Stratofortress" by hruschak30 — https://sketchfab.com/3d-models/boeing-b-52-stratofortress-44b4fdb01ef640c0ad7c5ba0f9ac30ca — CC BY 4.0
- X-15 — "North American X-15 Plane" by cmoreau — https://sketchfab.com/3d-models/north-american-x-15-plane-bf491206ba844282949734b48b938c53 — CC BY 4.0
- F-16C — "F16-C Falcon" by Carlos.Maciel — https://sketchfab.com/3d-models/f16-c-falcon-4bc2ff75dc584af2afd0aa6bd8b79015 — CC BY 4.0
- A-10 — "A10 Thunderbolt II" by blarg — https://sketchfab.com/3d-models/a10-thunderbolt-ii-77f1687fbdf3413aad9557233bb23ade — CC BY 4.0

## Weapon models (CC BY-NC-SA 4.0 — non-commercial; adaptations under the same licence)
- "Missile & Bomb Collection - Fighter Jets - Free" by bohmerang — https://sketchfab.com/3d-models/missile-bomb-collection-fighter-jets-free-d203b678424a43568703bf85ba680f47 — CC BY-NC-SA 4.0. Adapted: textures downscaled to <= 512 px (assets/weapons/pack.glb, same licence); split into separate weapons at runtime.
- Fat Man — "Fat Man Bomb" by raphi14 — https://sketchfab.com/3d-models/fat-man-bomb-721603c94a5248db988e2396c65296ad — CC BY 4.0 (textures downscaled)

## Landmarks
- Hidden Leaf Village — "Naruto hiddenly village" by kyrox — https://sketchfab.com/3d-models/naruto-hiddenly-village-bd95c17d67c44756b4fa5097bce9a547 — CC BY 4.0 (fan art of the Naruto setting; texture recompressed)
- Black dragon — "Black Dragon with Idle Animation" by 3DHaupt — https://sketchfab.com/3d-models/black-dragon-with-idle-animation-fb0053a2e59b43868e934c239bf4eb36 — CC BY-NC 4.0 (non-commercial; textures downscaled)
