# Jet City — overhaul audit and plan

## Phase 0 audit (what exists)

**Engine**: Three.js r128 (WebGL2 with WebGL1 fallback), plain scripts on `window.RJ`, ~15,600 lines in 30 files.
Terrain, clouds, water and aircraft are all procedural (no external textures/models).

**Already in place**
- Rendering: HDR half-float scene target, PBR (MeshStandard) terrain/aircraft, PMREM image-based lighting from the sky,
  dynamic shadow frustum, cloud shadows, bloom, heat haze, shockwave refraction, radial motion blur, DOF (cinematic/photo),
  FXAA, ACES filmic tone curve, color grading, far-terrain backdrop pass (160 km), streamed terrain chunks with 3 LODs in Web Workers,
  instanced trees/rocks, raymarched volumetric clouds with temporal reprojection, 5 weather types incl. storm with rain + lightning,
  water with reflections (High/Ultra), foam, depth colour; stars and moon.
- Effects: layered afterburner with shock diamonds and ignition kick, vapor cones, wingtip vortices, contrails, sonic boom
  shells, explosions, debris, smoke.
- Aircraft: ~60 types incl. airliners, helicopters, Star Wars craft, flying cars, rocket bike; animated stabilators,
  ailerons, flaps, rudders, swing wings, gear, nozzle petals; procedural panel lines; LOD via static-part merging.
- Flight: energy-based model with lift-limited G, induced/parasite/wave drag, density and thrust lapse with altitude,
  per-aircraft roll/pitch/yaw/G/stall, TVC post-stall, stall departures, prop torque, ground handling, carrier ops;
  separate heli/space/car/bike models; fixed 120 Hz timestep with render interpolation.
- Game: free flight, 4 dogfight formats, 5 missions, 11 medal challenges (ring races, landings), multiplayer (claude.ai room / PeerJS),
  landmarks atlas, XP/ranks/unlocks, hangar, replay + photo mode, Nova voice companion, map/waypoints/autopilot, throttle lever.

**Smoke test (Phase 1)**: all 27 entry points (4 dogfights, 5 missions, 11 challenges, 6 free-flight regions, storm runway start)
started and ran with 0 errors. One latent bug fixed earlier (AI pilots without a difficulty).

**Main visual limits found**
1. Sky was a hand-tuned gradient, not physically based → sunsets/dawn lacked real scattering colour. *(fixed in Phase 2)*
2. No sun shafts / lens flare. *(added in Phase 2)*
3. No SSAO, SSR or TAA. These need a depth+normal prepass; on r128 they are possible but cost 2–4 ms per frame each.
4. All art is procedural: no 4K texture sets, no sculpted models. This is the single biggest gap to MSFS-level visuals.

## Engine decision

| Option | Gain | Cost / risk |
|---|---|---|
| Stay on r128 (chosen) | Everything keeps working; improvements land every phase | No WebGPU, older post-processing APIs |
| Upgrade to Three r16x (WebGL2) | Newer color management, better PMREM, `MeshPhysicalMaterial` clearcoat/iridescence | ~30 breaking API changes (color spaces, lights units, geometry); multi-day port with regressions |
| Three r16x WebGPU / Babylon / Unity WebGL | Compute shaders, real GTAO/SSR/TAA, much higher ceiling | A rewrite of renderer + all shaders; WebGPU not on every browser yet |

The renderer is not what caps the look today; the missing art assets and the remaining post effects are. So this pass stays on r128.

## Plan
- P1 Fix & stabilize: smoke test every mode, remove dead code.
- P2 Visuals: physically based sky (Rayleigh + Mie + ozone single scattering) driving fog/ambient/sunlight; sun shafts + lens flare;
  before/after screenshots at dawn, noon, golden hour, sunset, night (chase + cockpit).
- P3 Jet detail: pilot and ejection seat in the canopy, exhaust heat discolouration, speed brakes, canopy that opens on the ground.
- P4 Flight accuracy: ground effect, G-LOC blackout/redout onset, spec audit against published figures.
- P5–P8: more missions with Nova briefings and star ratings, paint jobs in the hangar, Nova flight warnings, menu music.

## Blockers (need you)
- 4K PBR texture sets and high-poly models: this session cannot download from Poly Haven / Sketchfab. Minimum fix: download CC0 sets
  (e.g. Poly Haven "aerial_rocks", "snow_field", "forrest_ground") and CC-BY jet models into the repo; I wire them in.
- Real engine recordings for audio: same.
- fps per preset: needs a real GPU (the test browser is software-rendered at ~1 fps).
