/* Jet City — the Hidden Leaf Village, a giant landmark island.
 * Model: "Naruto hiddenly village" by kyrox (Sketchfab, CC BY 4.0; fan art of the Naruto setting). It stands on
 * its own in open ocean, scaled up to about 6 km across, so no procedural terrain cuts through it. It loads when
 * you come within ~45 km (or pick it as a Free Flight region) and is solid: a coarse height grid built from the
 * mesh at load time stops aircraft flying through the cliffs and buildings. */
(function (RJ) {
  "use strict";
  const V = (RJ.village = { ready: false });
  const URL = "assets/landmarks/leaf.glb", SIZE = 6000, GRID = 128, LOAD_R = 45000;
  let site = null, loading = null, grid = null;

  /** An open-ocean spot: deep water for 5 km all round, clear of the cities and the NYC / SF zones. */
  function findSite() {
    if (site) return site;
    const W = RJ.world, gen = W.gen, avoid = [];
    if (gen.nyc) avoid.push([gen.nyc.cx, gen.nyc.cz, 40000]);
    if (gen.sfZone) avoid.push([gen.sfZone.x, gen.sfZone.z, 35000]);
    if (RJ.cities) for (const k in RJ.cities.sites) { const s = RJ.cities.sites[k]; avoid.push([s.x, s.z, 30000]); }
    // search outward from the game's own open-ocean region (the island archipelago sea)
    const o = W.findRegion ? W.findRegion("ocean") : null, ox = o ? o.x : 0, oz = o ? o.z : 0;
    for (let r = 0; r <= 120000 && !site; r += 3000) for (let k = 0; k < (r ? 48 : 1) && !site; k++) {
      const a = (k / 48) * Math.PI * 2 + r * 1e-5, x = ox + Math.cos(a) * r, z = oz + Math.sin(a) * r;
      if (avoid.some(([ax, az, ar]) => Math.hypot(ax - x, az - z) < ar)) continue;
      let ok = true;
      for (let j = 0; j < 16 && ok; j++) { const b = (j / 16) * Math.PI * 2; for (const d of [0, 2000, 4200]) if (gen.height(x + Math.cos(b) * d, z + Math.sin(b) * d) > -8) { ok = false; break; } }
      if (ok) site = { x, z };
    }
    return site;
  }

  function load() {
    if (loading || !findSite() || !RJ.models || !RJ.models.load) return loading;
    loading = RJ.models.load(URL).then((scene) => {
      const m = scene.clone(true);
      m.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
      const s = SIZE / Math.max(size.x, size.z), c = box.getCenter(new THREE.Vector3());
      const g = new THREE.Group(); g.name = "leafVillage";
      m.position.set(-c.x, -box.min.y, -c.z); g.add(m);
      g.scale.setScalar(s); g.position.set(site.x, -6, site.z); // its base just under the waves
      g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = true; } });
      RJ.world.scene.add(g);
      g.updateMatrixWorld(true);
      // coarse height grid (world metres) for collisions
      const half = SIZE * 0.55, cs = (half * 2) / GRID, H = new Float32Array(GRID * GRID).fill(-1e9), v = new THREE.Vector3();
      g.traverse((o) => {
        if (!o.isMesh) return;
        const P = o.geometry.attributes.position;
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
          const gx = Math.floor((v.x - site.x + half) / cs), gz = Math.floor((v.z - site.z + half) / cs);
          if (gx >= 0 && gz >= 0 && gx < GRID && gz < GRID) { const k = gz * GRID + gx; if (v.y > H[k]) H[k] = v.y; }
        }
      });
      grid = { H, half, cs };
      V.group = g; V.ready = true; V.top = box.max.y * s - 6;
      perchDragon();
    }).catch((e) => console.warn("Hidden Leaf Village unavailable", e && e.message ? e.message : e));
    return loading;
  }

  /* The black dragon ("Black Dragon with Idle Animation" by 3DHaupt, CC BY-NC 4.0): perched huge on the highest
     point of the village's cliff, playing its own idle animation. */
  let mixer = null, last = 0;
  function perchDragon() {
    let k = 0; for (let i = 1; i < grid.H.length; i++) if (grid.H[i] > grid.H[k]) k = i;
    const x = site.x - grid.half + ((k % GRID) + 0.5) * grid.cs, z = site.z - grid.half + (Math.floor(k / GRID) + 0.5) * grid.cs, y = grid.H[k];
    RJ.models.load("assets/landmarks/dragon.glb").then((scene) => {
      const d = scene; // used once: the skinned mesh keeps its own skeleton
      d.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(d), sz = b.getSize(new THREE.Vector3()), s = 220 / Math.max(sz.x, sz.z);
      const g = new THREE.Group(); g.add(d); d.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      g.scale.setScalar(s); g.position.set(x, y - 4, z); g.rotation.y = Math.atan2(x - site.x, z - site.z) + Math.PI; // facing out to sea
      d.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
      RJ.world.scene.add(g); V.dragon = g;
      if (scene.animations && scene.animations.length) { mixer = new THREE.AnimationMixer(d); mixer.clipAction(scene.animations[0]).play(); }
    }).catch((e) => console.warn("Dragon unavailable", e && e.message ? e.message : e));
  }
  /** Per frame (world.js): load when the camera gets near; animate the dragon. */
  V.update = function (cam) {
    const now = performance.now(); if (mixer) mixer.update(Math.min(0.1, (now - (last || now)) / 1000)); last = now;
    if (V.ready || loading || !cam || !RJ.world.gen) return;
    const s = findSite();
    if (s && Math.hypot(cam.position.x - s.x, cam.position.z - s.z) < LOAD_R) load();
  };
  /** Solid ground for aircraft (flight.js). */
  V.solidAt = function (p) {
    if (!grid) return false;
    const gx = Math.floor((p.x - site.x + grid.half) / grid.cs), gz = Math.floor((p.z - site.z + grid.half) / grid.cs);
    if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) return false;
    return p.y < grid.H[gz * GRID + gx] + 3;
  };
  /** Free Flight region "leaf": 9 km out over the sea, heading for the village. */
  V.spawn = function () {
    const s = findSite(); if (!s) return null;
    load();
    const a = Math.atan2(s.z, s.x), x = s.x + Math.cos(a) * 9000, z = s.z + Math.sin(a) * 9000;
    return { x, z, yaw: Math.atan2(-(s.x - x), -(s.z - z)), alt: 1400 };
  };
})(window.RJ);
