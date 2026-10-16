/* Ridgeline Jets — landmark placement ("the atlas").
 * Pure and deterministic: given the terrain generator and the home runway, it finds natural spots for
 * every landmark (a narrow river canyon for the dam, a deep one for the bridge, a sea cliff for the
 * lighthouse, open water for the carrier, a high basin for the alpine lake, the tallest summit…).
 * No THREE.js here, so it can be unit-tested outside the browser. */
(function (root) {
  "use strict";
  const TAU = Math.PI * 2;

  function plan(gen, home, castle) {
    const H = (x, z) => gen.height(x, z);
    const F = (x, z) => gen.fields(x, z);
    const taken = [];
    const free = (x, z, d) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > (d || 3500) + (t.r || 0));
    const take = (s, r) => { if (s) taken.push({ x: s.x, z: s.z, r: r || 0 }); return s; };
    take(home, 1800);
    if (castle) take(castle, 900);
    const ring = (minR, maxR, step, fn) => {
      for (let r = minR; r <= maxR; r += step) {
        const n = Math.max(8, Math.round((TAU * r) / step));
        for (let i = 0; i < n; i++) { const a = (i / n) * TAU + r * 0.0007; if (fn(home.x + Math.cos(a) * r, home.z + Math.sin(a) * r, r) === false) return; }
      }
    };
    const slopeAt = (x, z, d) => { const h = H(x, z); return Math.max(Math.abs(H(x + d, z) - h), Math.abs(H(x - d, z) - h), Math.abs(H(x, z + d) - h), Math.abs(H(x, z - d) - h)) / d; };

    /* river canyon cross-sections: narrow, deep spots where a structure can span wall to wall */
    function canyonSpots(minR, maxR, minDepth, maxSpan) {
      const out = [];
      ring(minR, maxR, 350, (x, z, r) => {
        const f = F(x, z);
        if (!(f.wl > -1e8 && f.wl > f.h + 0.5) || f.wl < 30 || f.lakeSite) return;
        let bestT = null;
        for (let k = 0; k < 12; k++) {
          const th = (k / 12) * Math.PI, dx = Math.cos(th), dz = Math.sin(th);
          const side = (s) => { for (let d = 30; d <= maxSpan * 0.7; d += 20) if (H(x + dx * d * s, z + dz * d * s) > f.wl + minDepth) return d; return null; };
          const d1 = side(1), d2 = side(-1);
          if (d1 == null || d2 == null || d1 + d2 > maxSpan) continue;
          if (!bestT || d1 + d2 < bestT.span) bestT = { th, d1, d2, span: d1 + d2 };
        }
        if (!bestT) return;
        const dx = Math.cos(bestT.th), dz = Math.sin(bestT.th);
        // centre the structure between the two walls
        const cx = x + dx * (bestT.d1 - bestT.d2) / 2, cz = z + dz * (bestT.d1 - bestT.d2) / 2;
        const half = bestT.span / 2;
        const rimA = H(cx + dx * (half + 40), cz + dz * (half + 40)), rimB = H(cx - dx * (half + 40), cz - dz * (half + 40));
        out.push({ x: cx, z: cz, wl: f.wl, th: bestT.th, span: bestT.span, rim: Math.min(rimA, rimB), mtn: f.mtn, r });
      });
      return out;
    }

    const S = {};
    S.castle = castle || null;

    // Great Dam: narrow river gorge with walls at least 110 m high
    const gorge = canyonSpots(5000, 24000, 110, 760).filter((c) => free(c.x, c.z, 3000) && c.span >= 170);
    const gScore = (c) => Math.abs(c.span - 340) * 0.8 - Math.min(c.rim - c.wl, 220) * 0.7 + c.r * 0.006;
    gorge.sort((a, b) => gScore(a) - gScore(b));
    if (gorge[0]) {
      const g = gorge[0];
      S.dam = take({ x: g.x, z: g.z, wl: g.wl, th: g.th, span: g.span, crest: Math.min(g.rim - 12, g.wl + 150) }, 1800);
    }

    // Canyon Bridge: a deep, wider canyon elsewhere — space below the deck to fly under
    const deep = canyonSpots(5000, 26000, 160, 980).filter((c) => free(c.x, c.z, 3500));
    deep.sort((a, b) => (Math.abs(a.span - 620) - (a.rim - a.wl) * 0.8 + a.r * 0.01) - (Math.abs(b.span - 620) - (b.rim - b.wl) * 0.8 + b.r * 0.01));
    if (deep[0]) {
      const g = deep[0];
      S.bridge = take({ x: g.x, z: g.z, wl: g.wl, th: g.th, span: g.span + 60, deck: g.rim - 6 }, 1500);
    }

    // Sea Cliff Lighthouse: a headland 40–260 m above the sea, as close to home as possible
    let light = null;
    ring(4000, 60000, 300, (x, z) => {
      const f = F(x, z);
      if (f.h < 40 || f.h > 260 || f.wl > -1e8 || !free(x, z, 2500)) return;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU, dx = Math.cos(a), dz = Math.sin(a);
        if (H(x + dx * 220, z + dz * 220) < -8 && H(x + dx * 600, z + dz * 600) < -20 && slopeAt(x, z, 25) < 0.35) {
          light = { x, z, h: f.h, seaDir: a };
          return false;
        }
      }
    });
    if (light) {
      S.lighthouse = take({ x: light.x, z: light.z, elev: light.h + 1, seaDir: light.seaDir }, 600);
      // Coastal Carrier: open water 5–7 km out from the headland
      for (let d = 5000; d <= 12000 && !S.carrier; d += 500) {
        for (const off of [0, 0.35, -0.35, 0.7, -0.7]) {
          const a = light.seaDir + off;
          const x = light.x + Math.cos(a) * d, z = light.z + Math.sin(a) * d;
          let ok = true;
          for (let k = 0; k < 8 && ok; k++) { const b = (k / 8) * TAU; if (H(x + Math.cos(b) * 900, z + Math.sin(b) * 900) > -25) ok = false; }
          if (ok && H(x, z) < -40) {
            // turn the ship so the 7 km approach behind its angled deck is open water (no islands on the glide path)
            const sA = Math.sin(9 * Math.PI / 180), cA = Math.cos(9 * Math.PI / 180);
            let best = null;
            for (let k = 0; k < 24; k++) {
              const hd = light.seaDir + Math.PI / 2 + (k / 24) * TAU, c = Math.cos(hd), n = Math.sin(hd);
              const sx = sA * c + cA * n, sz = -sA * n + cA * c;
              let clear = 0;
              for (let dd = 250; dd <= 7000; dd += 250) { if (H(x + sx * dd, z + sz * dd) > -3) break; clear = dd; }
              if (!best || clear > best.clear) best = { hd, clear };
              if (clear >= 7000) break;
            }
            S.carrier = take({ x, z, heading: best.hd }, 800); break;
          }
        }
      }
    }

    // Alpine Lake: a high basin ringed by higher ground (so water never spills)
    let lake = null;
    ring(3000, 30000, 450, (x, z) => {
      const f = F(x, z);
      if (f.mtn < 0.25 || f.h < 500 || f.h > 2300 || f.wl > -1e8 || !free(x, z, 2500)) return;
      const R = 480;
      let rimMin = Infinity, rimMean = 0;
      for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; const h = H(x + Math.cos(a) * R * 1.35, z + Math.sin(a) * R * 1.35); rimMin = Math.min(rimMin, h); rimMean += h / 16; }
      const basin = rimMin - f.h;
      if (basin < -50) return;
      const score = basin + (rimMean - f.h) * 0.3 - Math.hypot(x - home.x, z - home.z) * 0.002;
      if (!lake || score > lake.score) lake = { x, z, level: rimMin - 6, r: R, score };
    });
    if (lake) S.lake = take({ x: lake.x, z: lake.z, level: lake.level, r: lake.r }, 900);

    // Stone Arch: a broad, level valley floor
    let arch = null;
    ring(4500, 15000, 400, (x, z, r) => {
      const f = F(x, z);
      if (f.h < 40 || f.wl > -1e8 || f.land < 0.95 || !free(x, z, 2200)) return;
      const sl = slopeAt(x, z, 160);
      if (sl > 0.08) return;
      let around = 0; for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; around += H(x + Math.cos(a) * 1500, z + Math.sin(a) * 1500) / 8; }
      const score = (around - f.h) * 0.5 - sl * 2000 - r * 0.02 + f.dry * 120;
      if (!arch || score > arch.score) arch = { x, z, h: f.h, score, face: Math.atan2(home.z - z, home.x - x) };
    });
    if (arch) S.arch = take({ x: arch.x, z: arch.z, elev: arch.h, face: arch.face }, 600);

    // Crashed Bomber: remote mountain valley floor
    let wreck = null;
    ring(10000, 24000, 500, (x, z, r) => {
      const f = F(x, z);
      if (f.mtn < 0.4 || f.h < 250 || f.h > 1900 || f.wl > -1e8 || !free(x, z, 3000)) return;
      const sl = slopeAt(x, z, 90);
      if (sl > 0.14) return;
      let around = 0; for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; around += H(x + Math.cos(a) * 1200, z + Math.sin(a) * 1200) / 8; }
      const score = (around - f.h) - sl * 1500 + r * 0.01;
      if (!wreck || score > wreck.score) wreck = { x, z, h: f.h, score };
    });
    if (wreck) S.wreck = take({ x: wreck.x, z: wreck.z, elev: wreck.h, rot: (wreck.x * 0.001) % TAU }, 700);

    // Hidden Airbase: a 2.6 km strip along a mountain valley, hemmed in by high ground
    let hab = null;
    ring(12000, 32000, 700, (x, z) => {
      const f = F(x, z);
      if (f.mtn < 0.3 || f.canyon < 0.55 || f.wl > -1e8 || f.h < 80 || !free(x, z, 4500)) return;
      const e = 70, cvAt = (a, b) => F(a, b).cv;
      const gx = cvAt(x + e, z) - cvAt(x - e, z), gz = cvAt(x, z + e) - cvAt(x, z - e);
      const L = Math.hypot(gx, gz); if (L < 1e-6) return;
      const dx = -gz / L, dz = gx / L;
      const hs = [];
      for (let i = -5; i <= 5; i++) hs.push(H(x + dx * i * 270, z + dz * i * 270));
      const lo = Math.min(...hs), hi = Math.max(...hs);
      if (hi - lo > 140) return;
      let walls = 0; for (const s of [-1, 1]) walls += H(x - dz * 1300 * s, z + dx * 1300 * s) - f.h;
      const score = walls * 0.5 - (hi - lo) * 2;
      if (!hab || score > hab.score) hab = { x, z, dx, dz, elev: hs.slice().sort((a, b) => a - b)[4], score };
    });
    if (hab) S.airbase = take({ x: hab.x, z: hab.z, dx: hab.dx, dz: hab.dz, yaw: Math.atan2(-hab.dx, -hab.dz), len: 2600, halfW: 260, side: 110, elev: Math.max(8, hab.elev) }, 2000);

    // Mountain Summit: the highest point within reach (hill-climbed from the best sample)
    let top = null;
    ring(2500, 24000, 600, (x, z) => { const h = H(x, z); if ((!top || h > top.h) && free(x, z, 1200)) top = { x, z, h }; });
    if (top) {
      for (let s = 300; s >= 20; s *= 0.6) for (let k = 0; k < 12; k++) {
        let moved = false;
        for (let a = 0; a < 8; a++) { const x = top.x + Math.cos(a * TAU / 8) * s, z = top.z + Math.sin(a * TAU / 8) * s, h = H(x, z); if (h > top.h) { top = { x, z, h }; moved = true; } }
        if (!moved) break;
      }
      S.summit = take({ x: top.x, z: top.z, elev: top.h }, 600);
    }
    return S;
  }
  root.atlasPlan = plan;
})(typeof window !== "undefined" ? (window.RJ = window.RJ || {}) : module.exports);
