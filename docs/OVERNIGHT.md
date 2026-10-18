# Jet City — overnight development log

Checkpoint before this work: branch `checkpoint-pre-overnight` on GitHub, plus a local tarball (`checkpoint-pre-overnight.tgz`).

## Completed (each stage tested in headless Chromium: 0 console errors)

| Stage | What shipped | Files |
|---|---|---|
| ON1 Aircraft materials | Irregular panel lines, access hatches, rivets, bump relief, wear and gloss per aircraft type, exhaust soot, chipped paint showing metal, canopy Fresnel with dust and scratches | `aircraft.js` |
| ON2 Weather | 10 menu presets (clear, scattered, overcast, light rain, heavy rain, thunderstorm, extreme supercell, squall line, windstorm, fog) plus "Dynamic" weather that changes over time with smooth 70–120 s transitions. Branching lightning (cloud-to-ground and in-cloud), lightning lighting the clouds from inside, thunder delayed by distance/343 m/s and sounding different near and far, rain shafts under storm cells, a squall line that marches across the map, local rain intensity, rain audio, canopy droplets in cockpit view, gusts, storm turbulence and downdrafts | `weather.js` (new), `clouds.js`, `world.js`, `flight.js`, `audio.js`, `ui.js` |
| ON3 Ocean | Ships: container ships, tankers, cruise liners, destroyers, trawlers and yachts. They stay in deep water, steer around shallows and pitch and roll in the swell. Each has a Kelvin wake and a bow wave. Sea state follows the wind, wind streaks appear in storms, and rain makes ripple rings | `ships.js` (new), `world.js` |
| ON4 Destinations | Tokyo (Skytree 634 m, Tokyo Tower 333 m, Mount Fuji 3,776 m on the horizon), Dubai (Burj Khalifa 828 m, Burj Al Arab, Palm Jumeirah, the Sheikh Zayed Road towers, a desert-tinted surround), Rio (Sugarloaf, Morro da Urca and cable car, Corcovado with Christ the Redeemer floodlit at night, favelas, beachfront). Each has instanced buildings with windows that light up at night, building collisions, a Free Flight start, an atlas entry and ghost air traffic hubs | `cities.js` (new), `atlas.js`, `terrain-gen.js`, `modes.js`, `airspace.js` |
| ON5 World life | Geese in V formation, gulls, eagles circling in thermals, crows. Bird strikes cause damage and a feather burst. Whale pods spout, roll, dive and breach. Airshow teams: Blue Angels, Thunderbirds and Red Arrows (Red Arrows use red/white/blue smoke). Random events: a hot-air balloon festival, and a meteor fireball at night | `life.js` (new), `airspace.js`, `missilefx.js`, `aircraft.js` |
| ON6 Game modes (Free Flight ▸ Activity) | Drone Race (FPV quad, 20 gates), Bombing Range, Area 51 Escape (wanted level 3 on lift-off), Cargo Career (C-17 air-drops between cities, saved cash and rank), Wingsuit: Everest Line, Paper Plane (launched off the Burj Khalifa deck, or the Empire State Building if Dubai can't be placed) | `activities.js` (new), `modes.js`, `vehicles.js` (racing drone, wingsuit, paper plane), `flight.js` (`glider` flag: no engine) |
| ON7 Performance | Automatic quality tiers on top of the existing dynamic resolution. Once resolution is at its 60% floor and frames are still slow, the game sheds load: first fewer ships and birds, then lighter volumetric clouds, then no ships or wildlife. It steps back up after 20 s of headroom | `main.js` |

## Engine upgrade evaluation (Three.js r128 → current, WebGPU)

**Recommendation: stay on r128 for now.** An upgrade is a dedicated project, not an overnight change.

- **Script loading.** The game loads three.js as a global script from cdnjs. The global build was removed in r160, so newer versions need an ES-module or import-map rewrite of every file's `THREE` usage.
- **Shader patches.** The renderer depends heavily on patched ShaderChunks: Earth curvature in `project_vertex`, height fog, cloud shadows, aircraft panel/bump code and the city window shader. Chunk names and contents changed across r150–r165 (for example `encodings_fragment` became `colorspace_fragment`). Every patch would need re-porting and re-testing.
- **Lighting and colour.** Physically correct lights became the default in r155, and colour management changed (`outputEncoding` became `outputColorSpace`). Every hand-tuned light and colour value would shift, so the whole look would need re-grading.
- **WebGPU.** It needs the node/TSL material system. All the custom GLSL `ShaderMaterial`s would need rewriting in TSL: the volumetric cloud raymarcher, sky, terrain, water, ribbons and wakes. Browser support is also still uneven, so a WebGL fallback would have to be maintained anyway.
- **Suggested path.**
  1. Move to ES modules on r128.
  2. Upgrade in steps (r128 → r150 → r16x), fixing patches at each step with before/after screenshots.
  3. Treat WebGPU as an optional renderer only after that.

## Known limitations (honest list)

- **City locations.** The cities sit on procedurally generated coast that suits each one. They are not real geography, and street layouts are generic grids. Landmarks are true height but stylised low-poly.
- **Dubai placement.** The world has very little dry, flat coast, so Dubai sits on low green coast with a sand-tinted 9 km surround. On some seeds, a city may not find a valid site and is skipped (logged as a warning).
- **Red Arrows aircraft.** There is no BAE Hawk model, so the Red Arrows tribute flies the F-16 airframe.
- **Visual testing.** Headless testing runs at ~3 fps with software rendering, so weather, birds and lightning were verified by state checks plus a few screenshots, not long real-time play sessions. Birds are small (true size), so they are hard to see except up close.
- **Glider HUD.** For gliders the HUD still shows throttle and "MAX POWER" text; the engine itself is off.
- **Weather transitions.** The old billboard clouds (used only when volumetric clouds are off) switch at the halfway point instead of morphing.

## Next recommended steps

1. A real playtest on a GPU machine: storm look and lightning density, bird visibility, ship scale from altitude, and how the six new modes feel.
2. Glider-specific HUD (glide ratio, sink rate) and a Hawk model for the Red Arrows.
3. City detail passes: road networks, Rainbow Bridge, the Palm's villa density, Copacabana promenade.
4. Engine upgrade project, per the evaluation above.
