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
  Mo.has = (id, livery) => !!(REG[id + ":" + livery] || REG[id]);
  Mo.load = (url) => fetchModel(url); // shared .glb loading (weapons.js), with the base64 text fallback

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
    // hosts that can't serve .glb (the claude.ai artifact) get the same bytes as base64 text: url + ".b64.txt"
    // big models come in numbered parts (url + ".b64.0.txt", ".b64.1.txt", …) to stay under the host's per-file limit
    const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
    const parts = (i, acc) => get(url + ".b64." + i + ".txt").then((t) => parts(i + 1, acc + t.trim()), (e) => { if (!i) throw e; return acc; });
    const viaText = (ld) => get(url + ".b64.txt").catch(() => parts(0, "")).then((t) => {
      const bin = atob(t.trim()), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Promise((res, rej) => ld.parse(u8.buffer, url.replace(/[^/]*$/, ""), (gl) => { gl.scene.animations = gl.animations || []; res(gl.scene); }, rej));
    });
    if (!cache[url]) cache[url] = loader().then((ld) => new Promise((res, rej) => ld.load(url, (gl) => { gl.scene.animations = gl.animations || []; res(gl.scene); }, undefined, rej)).catch(() => viaText(ld)));
    return cache[url];
  }

  /** Called by RJ.buildAircraft after the procedural build. Never throws; the procedural model stays on failure. */
  Mo.apply = function (g, id, livery) {
    const o = REG[id + ":" + livery] || REG[id]; // a paint-specific model (e.g. "fa18e:blueangels") wins
    if (!o) return;
    fetchModel(o.url).then((src) => {
      if (g.userData.disposed) return;
      const M = g.userData.materials || {}, d = g.userData.dims;
      const skin = src.clone(true);
      // parts the file carries in alternative states (gear down, spare weapon rails) are left out
      if (o.hide) { const re = o.hide, drop = []; skin.traverse((q) => { if (q !== skin && re.test(q.name || "")) drop.push(q); }); for (const q of drop) if (q.parent) q.parent.remove(q); }
      // the files' own exhaust plumes would double the game's afterburner flames
      if (o.hideMat) { const drop = []; skin.traverse((q) => { if (q.isMesh) { const ms = Array.isArray(q.material) ? q.material : [q.material]; if (ms.some((mt) => o.hideMat.test(mt.name || ""))) drop.push(q); } }); for (const q of drop) q.parent.remove(q); } // removed, so they don't stretch the fitted length
      if (o.quat) skin.quaternion.fromArray(o.quat); else skin.rotation.y = o.rotY || 0; // quat: files posed off-axis
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

  /* Airframes from Sketchfab, all CC BY 4.0 (credits in assets/CREDITS-A.md and on the main menu). Textures were
     downscaled to <= 2048 px. rotY turns each file's nose onto -Z (measured from the meshes). */
  const SF = "assets/aircraft/";
  Mo.register("f22", { url: SF + "f22.glb", rotY: -Math.PI / 2, hideMat: /plume/i, credit: "Lockheed Martin F-22 Raptor by andertan (CC BY 4.0)" });
  Mo.register("su57", { url: SF + "su57.glb", rotY: -Math.PI / 2, credit: "Sukhoi Su-57 Felon by andertan (CC BY 4.0)" });
  Mo.register("sr71", { url: SF + "sr71.glb", rotY: -0.9146, credit: "SR-71 by manilov.ap (CC BY 4.0)" });
  Mo.register("b2", { url: SF + "b2.glb", rotY: 0, credit: "Lowpoly B-2 Spirit bomber by SIpriv (CC BY 4.0)" });
  Mo.register("f117", { url: SF + "f117.glb", rotY: Math.PI, credit: "F-117 Nighthawk with GBU-12 by Jeyhun1985 (CC BY 4.0)" });
  Mo.register("fa18e:blueangels", { url: SF + "fa18e_ba.glb", rotY: -Math.PI / 2, credit: "Blue Angels FA/18 by Aidan McTaggart (CC BY 4.0)" });
  Mo.register("yf23", { url: SF + "yf23.glb", quat: [-0.4967, 0.1579, -0.0924, 0.8484], credit: "YF-23 Black Jet Fighter by Mymeria (CC BY 4.0)" });
  Mo.register("xb70", { url: SF + "xb70.glb", rotY: 0, credit: "North American XB-70 Valkyrie by Muhamad Mirza Arrafi (CC BY 4.0)" });
  Mo.register("b52", { url: SF + "b52.glb", rotY: Math.PI, credit: "Boeing B-52 Stratofortress by hruschak30 (CC BY 4.0)" });
  Mo.register("x15", { url: SF + "x15.glb", rotY: -Math.PI / 2, credit: "North American X-15 Plane by cmoreau (CC BY 4.0)" });
  // the intro opens on the Blue Angels: start fetching their model with the page, not when the jets are built
  setTimeout(() => fetchModel(REG["fa18e:blueangels"].url).catch(() => {}), 0);
  Mo.register("f16", { url: SF + "f16.glb", rotY: 0, credit: "F16-C Falcon by Carlos.Maciel (CC BY 4.0)" });
  Mo.register("a10", { url: SF + "a10.glb", rotY: Math.PI, credit: "A10 Thunderbolt II by blarg (CC BY 4.0)" });
  Mo.register("f35a", { url: SF + "f35a.glb", rotY: Math.PI / 2, hide: /landingOn|spw\d|refuel/i, credit: "F-35 Lightning II by CloudHub (CC BY 4.0)" });
})(window.RJ);
