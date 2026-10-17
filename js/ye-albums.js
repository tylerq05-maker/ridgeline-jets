/* Ridgeline Jets — the album monuments around the Ye Monument.
 * Fifteen mega-structures in a 6.8 km ring around the statue, one per album, in release order: covers 620–900 m
 * square, raised 220–650 m on twin pylons, a central column or an A-frame, with gilded/accent-lit frames, title
 * plaques, night uplights and aviation beacons, linked to the statue's plaza by lit avenues.
 * Artwork: the official covers are copyrighted, so the game does not ship them. Each monument shows a labelled title
 * card until the player adds their own copy of the cover (Settings ▸ Album art); those images are kept in this
 * browser only (IndexedDB) and are never uploaded or published. */
(function (RJ) {
  "use strict";
  const YA = (RJ.yeAlbums = {});
  const V3 = RJ.V3, TAU = Math.PI * 2;
  const G = (x, z) => RJ.world.gen.height(x, z);
  const U = () => RJ.castle.util;
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = V3(), _s = V3();

  YA.ALBUMS = [
    { id: "dropout", title: "The College Dropout", year: "2004", accent: 0xc8913a },
    { id: "latereg", title: "Late Registration", year: "2005", accent: 0x8a2433 },
    { id: "graduation", title: "Graduation", year: "2007", accent: 0xd65fb4 },
    { id: "808s", title: "808s & Heartbreak", year: "2008", accent: 0xc23b3b },
    { id: "mbdtf", title: "My Beautiful Dark Twisted Fantasy", year: "2010", accent: 0xd11f1f },
    { id: "wtt", title: "Watch the Throne", year: "2011", accent: 0xd4af37, with: "with Jay-Z" },
    { id: "yeezus", title: "Yeezus", year: "2013", accent: 0xe02b20 },
    { id: "tlop", title: "The Life of Pablo", year: "2016", accent: 0xf08a24 },
    { id: "ksg", title: "Kids See Ghosts", year: "2018", accent: 0x8fb7e8, with: "with Kid Cudi" },
    { id: "ye", title: "ye", year: "2018", accent: 0x6fbf5a },
    { id: "jik", title: "Jesus Is King", year: "2019", accent: 0x2f5dd6 },
    { id: "donda", title: "Donda", year: "2021", accent: 0x9aa0a6 },
    { id: "vultures1", title: "Vultures 1", year: "2024", accent: 0xe8e8e8, with: "with Ty Dolla $ign" },
    { id: "vultures2", title: "Vultures 2", year: "2024", accent: 0xbcbcbc, with: "with Ty Dolla $ign" },
    { id: "bully", title: "Bully", year: "", accent: 0x7d58c8 }
  ];
  const RING = 6800;

  /* ======================= textures ======================= */
  function titleCard(a) {
    const c = document.createElement("canvas"); c.width = c.height = 1024; const g = c.getContext("2d");
    const col = new THREE.Color(a.accent), hex = (k) => "#" + col.clone().multiplyScalar(k).getHexString();
    const gr = g.createLinearGradient(0, 0, 1024, 1024); gr.addColorStop(0, hex(0.55)); gr.addColorStop(0.6, hex(0.16)); gr.addColorStop(1, "#060606");
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 1024);
    g.strokeStyle = hex(1); g.lineWidth = 10; g.strokeRect(40, 40, 944, 944);
    g.fillStyle = "#f4f1ea"; g.textAlign = "center"; g.textBaseline = "middle";
    // the title, wrapped to fit
    const words = a.title.toUpperCase().split(" "), lines = []; let cur = "";
    let fs = 120; g.font = `bold ${fs}px Georgia, serif`;
    for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width > 820 && cur) { lines.push(cur); cur = w; } else cur = t; }
    lines.push(cur);
    if (lines.length > 3) { fs = 90; g.font = `bold ${fs}px Georgia, serif`; }
    lines.forEach((l, i) => g.fillText(l, 512, 470 + (i - (lines.length - 1) / 2) * fs * 1.1));
    g.font = "bold 56px Arial"; g.fillStyle = hex(1.4);
    g.fillText(["KANYE WEST", a.with ? a.with.toUpperCase() : "", a.year].filter(Boolean).join(" · "), 512, 160);
    g.font = "32px Arial"; g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillText("TITLE CARD · ADD YOUR COVER IN SETTINGS ▸ ALBUM ART", 512, 900);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }
  function plaqueTex(a) {
    const c = document.createElement("canvas"); c.width = 2048; c.height = 256; const g = c.getContext("2d");
    g.fillStyle = "#151311"; g.fillRect(0, 0, 2048, 256); g.strokeStyle = "#c9a24a"; g.lineWidth = 8; g.strokeRect(12, 12, 2024, 232);
    g.fillStyle = "#e6c46a"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = "bold 92px Georgia, serif";
    g.fillText(a.title.toUpperCase() + (a.year ? "  ·  " + a.year : ""), 1024, 132);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }

  /* ======================= player-supplied artwork (IndexedDB, local only) ======================= */
  let dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise((res, rej) => {
      try { const r = indexedDB.open("rj-ye-art", 1); r.onupgradeneeded = () => r.result.createObjectStore("art"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }
      catch (e) { rej(e); }
    });
    return dbP;
  }
  const tx = (mode, fn) => db().then((d) => new Promise((res, rej) => { const t = d.transaction("art", mode), st = t.objectStore("art"), r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }));
  YA.hasArt = {};
  function applyImage(id, blob) {
    const m = YA.byId && YA.byId[id]; if (!m) return Promise.resolve(false);
    return new Promise((res) => {
      const url = URL.createObjectURL(blob), img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img); tex.anisotropy = (RJ.renderer && RJ.renderer.capabilities.getMaxAnisotropy()) || 8; tex.needsUpdate = true;
        for (const mt of m.artMats) { if (mt.map && mt.map !== m.card) mt.map.dispose(); mt.map = tex; if (mt.emissiveMap !== undefined) mt.emissiveMap = tex; mt.needsUpdate = true; }
        YA.hasArt[id] = true; URL.revokeObjectURL(url); res(true);
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(false); };
      img.src = url;
    });
  }
  function resetCard(id) {
    const m = YA.byId && YA.byId[id]; if (!m) return;
    for (const mt of m.artMats) { if (mt.map && mt.map !== m.card) mt.map.dispose(); mt.map = m.card; if (mt.emissiveMap !== undefined) mt.emissiveMap = m.card; mt.needsUpdate = true; }
    YA.hasArt[id] = false;
  }
  /** Downscale to ≤ 2048 px (sharp at monument scale, kind to GPU memory) and keep it in this browser. */
  YA.setArt = function (id, file) {
    return new Promise((res) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const s = Math.min(1, 2048 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((blob) => { if (!blob) return res(false); tx("readwrite", (st) => st.put(blob, id)).catch(() => {}).then(() => applyImage(id, blob)).then(res); }, "image/jpeg", 0.93);
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(false); };
      img.src = url;
    });
  };
  YA.clearArt = function (id) { resetCard(id); return tx("readwrite", (st) => st.delete(id)).catch(() => {}); };
  function loadSaved() { for (const a of YA.ALBUMS) tx("readonly", (st) => st.get(a.id)).then((b) => { if (b) applyImage(a.id, b); }).catch(() => {}); }

  /** Settings ▸ Album art: one row per album (rendered by ui.js; wired here). */
  YA.settingsHTML = function (row, esc) {
    let h = row("Album art", "The official covers are copyrighted, so the game shows title cards. Add your own copy of each cover here: images stay in this browser only (never uploaded or published) and appear on the monuments around the Ye Monument.", "");
    for (const a of YA.ALBUMS) {
      const has = YA.hasArt[a.id];
      h += row(a.title + (a.year ? " (" + a.year + ")" : ""), has ? "Your image is on the monument" : "Showing the title card",
        `<label class="ghost small" style="cursor:pointer">Choose image<input type="file" accept="image/*" data-ye-art="${a.id}" hidden></label>${has ? ` <button class="ghost small" data-ye-clear="${a.id}">Remove</button>` : ""}`);
    }
    return h;
  };
  YA.bindUI = function (el, rerender) {
    el.querySelectorAll("[data-ye-art]").forEach((inp) => inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; if (f) YA.setArt(inp.dataset.yeArt, f).then(rerender); }));
    el.querySelectorAll("[data-ye-clear]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); YA.clearArt(b.dataset.yeClear).then(rerender); }));
  };

  /* ======================= build ======================= */
  YA.build = function (lm) {
    const S = lm.s, W = RJ.world, cx = S.x, cz = S.z;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1d1c1b, roughness: 0.35, metalness: 0.85 });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb0a99d, roughness: 0.85 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 1 });
    YA.byId = {}; YA.mons = [];
    const roads = [], roadLamps = [];
    YA.ALBUMS.forEach((a, i) => {
      const ang = S.yaw + ((i + 0.5) / YA.ALBUMS.length) * TAU, r = RING + ((i * 37) % 5 - 2) * 220;
      const x = cx + Math.sin(ang) * r, z = cz + Math.cos(ang) * r;
      const Sz = 620 + ((i * 53) % 7) * 46, lift = 220 + ((i * 71) % 6) * 85, style = i % 3;
      const face = ang + ((i % 2) ? 0.22 : -0.22);              // faces outward, angled for a varied skyline
      const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = face;
      const c = Math.cos(face), sn = Math.sin(face);
      let gmin = Infinity, gmax = -Infinity;
      for (const [u, v] of [[0, 0], [0.75, 0.3], [-0.75, 0.3], [0.75, -0.3], [-0.75, -0.3]]) { const gx = x + (u * c + v * sn) * Sz, gz = z + (-u * sn + v * c) * Sz, h = G(gx, gz); gmin = Math.min(gmin, h); gmax = Math.max(gmax, h); }
      const base = gmax + 30, bot = base + lift, top = bot + Sz;
      const ST = [], FR = [], GD = [], box = (list, w, h, d, px, py, pz, rx = 0, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateX(rx); g.rotateZ(rz); g.translate(px, py, pz); list.push(g); };
      // stepped platform, sunk into the slope
      box(ST, Sz * 1.6, base - gmin + 40, Sz * 0.7, 0, (base + gmin - 40) / 2, 0);
      box(ST, Sz * 1.35, 24, Sz * 0.55, 0, base + 12, 0); box(GD, Sz * 1.37, 3, Sz * 0.57, 0, base + 25, 0);
      const pw = Sz * 0.1, solids = [];
      if (style === 0) {        // twin pylons and a crown beam
        for (const sx of [-1, 1]) { box(FR, pw, top - base + Sz * 0.12, Sz * 0.16, sx * (Sz / 2 + pw * 0.75), (top + base + Sz * 0.12) / 2, 0); solids.push([sx * (Sz / 2 + pw * 0.75), (top + base) / 2, pw / 2, (top - base) / 2 + Sz * 0.06, Sz * 0.08]); }
        box(FR, Sz + pw * 3, Sz * 0.07, Sz * 0.17, 0, top + Sz * 0.1, 0); box(GD, Sz + pw * 3.1, 4, Sz * 0.18, 0, top + Sz * 0.135, 0);
      } else if (style === 1) { // a single tapering column with buttress fins
        box(FR, Sz * 0.24, lift + 10, Sz * 0.24, 0, base + (lift + 10) / 2, 0); box(GD, Sz * 0.5, 8, Sz * 0.3, 0, bot - 4, 0);
        for (const sx of [-1, 1]) box(FR, Sz * 0.03, lift * 0.8, Sz * 0.36, sx * Sz * 0.13, base + lift * 0.4, 0);
        solids.push([0, base + lift / 2, Sz * 0.13, lift / 2, Sz * 0.13]);
      } else {                  // an A-frame of two raking legs
        for (const sx of [-1, 1]) {
          const x0 = sx * Sz * 0.78, x1 = sx * (Sz / 2 + pw * 0.3), L = Math.hypot(x1 - x0, top - base), ang2 = Math.atan2(x0 - x1, top - base);
          box(FR, pw, L, Sz * 0.15, (x0 + x1) / 2, (base + top) / 2, 0, 0, ang2);
          solids.push([(x0 + x1) / 2, (base + top) / 2, pw * 1.5, L / 2, Sz * 0.08]);
        }
        box(FR, Sz * 1.4, Sz * 0.05, Sz * 0.12, 0, bot - Sz * 0.04, 0);
      }
      // the frame around the cover, with a gilded inner edge
      const fw = Sz * 0.045;
      box(FR, Sz + fw * 2, fw, Sz * 0.07, 0, top + fw / 2, 0); box(FR, Sz + fw * 2, fw, Sz * 0.07, 0, bot - fw / 2, 0);
      for (const sx of [-1, 1]) box(FR, fw, Sz, Sz * 0.07, sx * (Sz / 2 + fw / 2), bot + Sz / 2, 0);
      box(FR, Sz, Sz, Sz * 0.03, 0, bot + Sz / 2, 0);
      for (const sz of [-1, 1]) { box(GD, Sz + 8, 5, 3, 0, top - 2, sz * Sz * 0.036); box(GD, Sz + 8, 5, 3, 0, bot + 2, sz * Sz * 0.036); for (const sx of [-1, 1]) box(GD, 5, Sz, 3, sx * (Sz / 2 + 2), bot + Sz / 2, sz * Sz * 0.036); }
      solids.push([0, bot + Sz / 2, Sz / 2 + fw, Sz / 2 + fw, Sz * 0.04], [0, (base + gmin) / 2, Sz * 0.8, (base - gmin) / 2 + 30, Sz * 0.35]);
      const mk = (list, mat) => { const m = new THREE.Mesh(U().merge(list), mat); m.castShadow = true; m.receiveShadow = true; grp.add(m); };
      mk(ST, stoneMat); mk(FR, frameMat); mk(GD, goldMat);
      // the artwork on both faces (back plane turned so it reads correctly from behind)
      const card = titleCard(a), artMats = [];
      for (const side of [1, -1]) {
        const mt = new THREE.MeshStandardMaterial({ map: card, emissive: 0xffffff, emissiveMap: card, emissiveIntensity: 0.45, roughness: 0.55, metalness: 0 });
        const p = new THREE.Mesh(new THREE.PlaneGeometry(Sz, Sz), mt); p.position.set(0, bot + Sz / 2, side * Sz * 0.0165); p.rotation.y = side > 0 ? 0 : Math.PI; p.receiveShadow = true; grp.add(p); artMats.push(mt);
      }
      // title plaque on the platform front, accent light bars up the structure, beacons on top
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(Sz * 1.1, Sz * 0.1375), new THREE.MeshBasicMaterial({ map: plaqueTex(a), fog: true }));
      pl.position.set(0, base + 12, Sz * 0.276); grp.add(pl);
      const accMat = new THREE.MeshBasicMaterial({ color: a.accent, fog: true });
      const AC = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(AC, 6, Sz * 0.98, 4, sx * (Sz / 2 + fw * 0.5), bot + Sz / 2, sz * Sz * 0.037);
      box(AC, Sz * 1.3, 4, 4, 0, base + 26, Sz * 0.28);
      const acc = new THREE.Mesh(U().merge(AC), accMat); grp.add(acc);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(7, 8, 6), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false })); beacon.position.y = top + Sz * 0.15; grp.add(beacon);
      // uplight beams washing the cover at night
      const beams = [];
      for (const side of [1, -1]) {
        const bm = new THREE.Mesh(new THREE.CylinderGeometry(Sz * 0.28, 8, Sz * 1.05, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        bm.geometry.translate(0, Sz * 0.55, 0); bm.position.set(0, base + 26, side * Sz * 0.24); bm.rotation.x = -side * 0.22; bm.layers.set(RJ.LATE); grp.add(bm); beams.push(bm);
      }
      W.scene.add(grp); grp.updateMatrixWorld(true);
      // far-horizon copy: the art on the backdrop layer so the skyline reads from 100 km
      const far = new THREE.Group(); far.position.copy(grp.position); far.rotation.copy(grp.rotation);
      const fFrame = new THREE.Mesh(new THREE.BoxGeometry(Sz * 1.12, top - gmin + Sz * 0.1, Sz * 0.06), new THREE.MeshBasicMaterial({ color: 0x1a1918, fog: false })); fFrame.position.y = (top + gmin) / 2 + Sz * 0.05; far.add(fFrame);
      for (const side of [1, -1]) { const mt = new THREE.MeshBasicMaterial({ map: card, fog: false }); const p = new THREE.Mesh(new THREE.PlaneGeometry(Sz, Sz), mt); p.position.set(0, bot + Sz / 2, side * Sz * 0.032); p.rotation.y = side > 0 ? 0 : Math.PI; far.add(p); artMats.push(mt); }
      far.traverse((o) => { o.layers.set(W.BACK); o.frustumCulled = false; }); W.scene.add(far);
      const mon = { a, grp, far, artMats, card, accMat, beacon, beams, x, z, face, top, base, solids, Sz };
      YA.byId[a.id] = mon; YA.mons.push(mon);
      // avenue from the plaza toward the monument, following the ground, lamps every 250 m
      for (let d = 1000; d < r - Sz * 0.6; d += 160) {
        const px = cx + Math.sin(ang) * d, pz = cz + Math.cos(ang) * d, g = G(px, pz);
        _m4.compose(_p.set(px, g + 0.6, pz), _q.setFromAxisAngle(V3(0, 1, 0), ang), _s.set(46, 1.6, 170)); roads.push(_m4.clone());
        if ((d - 1000) % 320 === 0) for (const sd of [-1, 1]) roadLamps.push(V3(px + Math.cos(ang) * sd * 30, g + 14, pz - Math.sin(ang) * sd * 30));
      }
    });
    const roadIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x2b2c2e, roughness: 0.9 }), roads.length);
    roads.forEach((m, i) => roadIM.setMatrixAt(i, m)); roadIM.receiveShadow = true; W.scene.add(roadIM);
    YA.lampMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const lampIM = new THREE.InstancedMesh(new THREE.SphereGeometry(3, 6, 4), YA.lampMat, roadLamps.length);
    roadLamps.forEach((p, i) => { _m4.makeTranslation(p.x, p.y, p.z); lampIM.setMatrixAt(i, _m4); }); W.scene.add(lampIM);
    YA.roads = [roadIM, lampIM];
    loadSaved();
  };

  YA.update = function (dt, cam, t, nk) {
    if (!YA.mons) return;
    const W = RJ.world, fogC = W.scene.fog.color;
    for (const m of YA.mons) {
      const d = Math.hypot(cam.position.x - m.x, cam.position.z - m.z);
      m.grp.visible = d < 20500; m.far.visible = d > 18500;
      if (m.far.visible) { const k = RJ.clamp((d - 15000) / 150000, 0, 0.65); for (const mt of m.artMats) if (mt.isMeshBasicMaterial) mt.color.setRGB(1, 1, 1).lerp(fogC, k); }
      if (!m.grp.visible) continue;
      for (const mt of m.artMats) if (mt.isMeshStandardMaterial) mt.emissiveIntensity = 0.38 + nk * 0.6;
      m.accMat.color.setHex(m.a.accent).multiplyScalar(0.6 + nk * 1.8);
      m.beacon.material.color.setRGB((t + m.Sz * 0.001) % 1.5 < 0.25 ? 4 : 0.15, 0.05, 0.03);
      for (const b of m.beams) b.material.opacity = nk * 0.03;
    }
    YA.lampMat.color.setRGB(1.5, 1.15, 0.75).multiplyScalar(0.1 + nk * 1.6);
    const near = Math.hypot(cam.position.x - RJ.ye.site.x, cam.position.z - RJ.ye.site.z) < 30000;
    for (const r of YA.roads) r.visible = near;
  };
  YA.solidAt = function (p) {
    if (!YA.mons) return false;
    for (const m of YA.mons) {
      const dx = p.x - m.x, dz = p.z - m.z; if (dx * dx + dz * dz > m.Sz * m.Sz * 1.2) continue;
      const c = Math.cos(m.face), s = Math.sin(m.face), lx = dx * c - dz * s, lz = dx * s + dz * c;
      for (const [bx, by, hx, hy, hz] of m.solids) if (Math.abs(lx - bx) < hx && Math.abs(p.y - by) < hy && Math.abs(lz) < hz) return true;
    }
    return false;
  };
  YA.heightAt = function (x, z) {
    if (!YA.mons) return -Infinity;
    for (const m of YA.mons) {
      const dx = x - m.x, dz = z - m.z; if (dx * dx + dz * dz > m.Sz * m.Sz) continue;
      const c = Math.cos(m.face), s = Math.sin(m.face), lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < m.Sz * 0.67 && Math.abs(lz) < m.Sz * 0.27) return m.base + 25;   // the platform deck
    }
    return -Infinity;
  };
})(window.RJ);
