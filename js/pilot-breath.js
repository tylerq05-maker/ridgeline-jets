/* Jet City — the pilot's breathing in the cockpit view.
 * Quiet oxygen-mask breaths through the regulator in normal flight, quickening under load; above ~5.5 G the anti-G
 * straining manoeuvre: a sharp "hick" inhale then a strained exhale every second or so, harder as the G builds.
 * Filtered noise only (no samples), on the effects bus; silent outside the cockpit and for non-jets. */
(function (RJ) {
  "use strict";
  const AU = RJ.audio;
  if (!AU || !AU.update) return;
  let next = 0;
  function burst(f, q, dur, gain, type, delay) {
    const c = AU.ctx, t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = AU.white; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type || "bandpass"; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.3); g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(fl); fl.connect(g); g.connect(AU.sfxBus);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    s.onended = () => { try { s.disconnect(); fl.disconnect(); g.disconnect(); } catch (e) { /* gone */ } };
  }
  function tick(pl, inPit) {
    if (!AU.ctx || !AU.white || !AU.sfxBus || RJ.settings.muted || AU.ctx.state !== "running") return;
    const now = AU.ctx.currentTime;
    if (!pl || !pl.alive || !inPit || pl.state !== "flying" || !pl.spec || pl.spec.flight.model) { next = now + 1; return; }
    if (now < next) return;
    const g = Math.abs(pl.g || 1);
    if (g > 5.5 && pl.spec.flight.gmax > 5) {
      const k = Math.min(1, (g - 5.5) / 3);
      burst(1300, 1.2, 0.22, 0.05 + 0.05 * k);              // sharp inhale
      burst(420, 0.9, 0.55, 0.06 + 0.06 * k, "lowpass", 0.26); // strained exhale against a closed glottis
      next = now + RJ.lerp(1.6, 1.0, k);
    } else {
      const f = g > 3 ? 0.65 : 1;
      burst(1800, 0.8, 1.1 * f, 0.012);                      // in, through the regulator
      burst(900, 0.7, 1.3 * f, 0.01, "bandpass", 1.4 * f);   // out
      next = now + RJ.lerp(4.2, 2.4, RJ.clamp((g - 1) / 3, 0, 1));
    }
  }
  const orig = AU.update;
  AU.update = function (pl, cam, inCockpit) {
    const r = orig.apply(this, arguments);
    try { tick(pl, inCockpit); } catch (e) { /* never break the frame for a breath */ }
    return r;
  };
})(window.RJ);
