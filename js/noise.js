/* Ridgeline Jets — seeded 2D simplex noise and fractal helpers. */
(function (RJ) {
  "use strict";
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeSimplex(seed) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    const perm = new Uint8Array(512), pm8 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm8[i] = perm[i] & 7; }
    return function (xin, yin) {
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s), j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t), y0 = yin - (j - t);
      const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      let n = 0, tt, g;
      tt = 0.5 - x0 * x0 - y0 * y0;
      if (tt > 0) { g = GRAD[pm8[ii + perm[jj]]]; tt *= tt; n += tt * tt * (g[0] * x0 + g[1] * y0); }
      tt = 0.5 - x1 * x1 - y1 * y1;
      if (tt > 0) { g = GRAD[pm8[ii + i1 + perm[jj + j1]]]; tt *= tt; n += tt * tt * (g[0] * x1 + g[1] * y1); }
      tt = 0.5 - x2 * x2 - y2 * y2;
      if (tt > 0) { g = GRAD[pm8[ii + 1 + perm[jj + 1]]]; tt *= tt; n += tt * tt * (g[0] * x2 + g[1] * y2); }
      return 70 * n; // roughly [-1, 1]
    };
  }

  const N1 = makeSimplex(1337), N2 = makeSimplex(4242), N3 = makeSimplex(9001);
  RJ.noise = {
    n1: N1, n2: N2, n3: N3,
    fbm(fn, x, y, oct, lac = 2.0, gain = 0.5) {
      let a = 1, f = 1, s = 0, norm = 0;
      for (let o = 0; o < oct; o++) { s += a * fn(x * f, y * f); norm += a; a *= gain; f *= lac; }
      return s / norm;
    },
    /** Ridged multifractal in [0, 1]: sharp crests, broad valleys. */
    ridged(fn, x, y, oct, lac = 2.05, gain = 0.5) {
      let a = 0.5, f = 1, s = 0, w = 1, norm = 0;
      for (let o = 0; o < oct; o++) {
        let n = 1 - Math.abs(fn(x * f, y * f));
        n *= n; n *= w;
        w = RJ.clamp(n * 2, 0, 1);
        s += n * a; norm += a;
        a *= gain; f *= lac;
      }
      return s / norm;
    },
    rng: mulberry32
  };
})(window.RJ);
