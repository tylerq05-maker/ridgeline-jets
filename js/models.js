/* Jet City — optional glTF airframes (agent A).
 *
 * RJ.models.register(id, { url, rotY, credit }) swaps an aircraft's procedural airframe skin for a .glb once it has
 * loaded. The procedural build stays the source of truth: its dims, cockpit/tip/flame/nozzle hooks, gear,
 * lights and pilot are kept, and the glTF is fitted to the procedural bounding box (nose -Z, up +Y). Loading is
 * asynchronous; until it finishes, or if it fails, the procedural model is shown. GLTFLoader (vendored r128,
 * js/vendor/GLTFLoader.js) is only fetched when a model is actually registered.
 *
 * No airframe is registered by default: no CC0 / public-domain / CC-BY model of the game's jets was found in
 * reachable sources (see assets/CREDITS-A.md). To add one: put the .glb in assets/aircraft/, credit it in
 * assets/CREDITS-A.md, and call RJ.models.register("f22", { url: "assets/aircraft/f22.glb", rotY: 0 }). */
(function (RJ) {
  "use strict";
  const REG = {}, cache = {};
  let loaderP = null;
  const Mo = { REG };
  RJ.models = Mo;

  Mo.register = function (id, o) { REG[id] = Object.assign({ rotY: 0 }, o); };
  Mo.has = (id) => !!REG[id];

  function loader() {
    if (THREE.GLTFLoader) return Promise.resolve(new THREE.GLTFLoader());
    if (!loaderP) loaderP = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "js/vendor/GLTFLoader.js";
      s.onload = () => (THREE.GLTFLoader ? res() : rej(new Error("GLTFLoader missing")));
      s.onerror = () => rej(new Error("GLTFLoader script failed to load"));
      document.head.appendChild(s);
    });
    return loaderP.then(() => new THREE.GLTFLoader());
  }
  function fetchModel(url) {
    if (!cache[url]) cache[url] = loader().then((ld) => new Promise((res, rej) => ld.load(url, (gl) => res(gl.scene), undefined, rej)));
    return cache[url];
  }

  /** Called by RJ.buildAircraft after the procedural build. Never throws; the procedural model stays on failure. */
  Mo.apply = function (g, id) {
    const o = REG[id];
    if (!o) return;
    fetchModel(o.url).then((src) => {
      if (g.userData.disposed) return;
      const M = g.userData.materials || {}, d = g.userData.dims;
      const skin = src.clone(true);
      skin.rotation.y = o.rotY || 0;
      skin.updateMatrixWorld(true);
      // fit to the procedural airframe: same length, centred on its bounding box
      const bb = new THREE.Box3().setFromObject(skin), sz = bb.getSize(new THREE.Vector3());
      const s = d.len / Math.max(1e-3, sz.z);
      const holder = new THREE.Group();
      holder.add(skin);
      holder.scale.setScalar(s);
      const c = bb.getCenter(new THREE.Vector3()).multiplyScalar(s);
      holder.position.set(-c.x, d.minY + d.height * 0.5 - c.y, (d.minZ + d.maxZ) * 0.5 - c.z);
      skin.traverse((m) => {
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mt of mats) { if (mt.isMeshStandardMaterial && mt.envMapIntensity === 1) mt.envMapIntensity = 0.9; }
        if (RJ.lighting && RJ.lighting.track) RJ.lighting.track(mats);
      });
      // hide the procedural skin, keeping gear, flames, nozzles, lights, pilot and anything animated
      const skinMats = new Set([M.body, M.trim, M.facet, M.glass, M.accent].filter(Boolean));
      const keep = new Set();
      g.traverse((q) => { if (q.userData && q.userData.rjGear) q.traverse((r) => keep.add(r)); });
      g.traverse((m) => { if (m.isMesh && skinMats.has(m.material) && !keep.has(m)) m.visible = false; });
      g.add(holder);
      g.userData.gltf = holder;
    }).catch((e) => console.warn("Aircraft model " + id + " unavailable; using the procedural airframe", e && e.message ? e.message : e));
  };
})(window.RJ);
