/* Ridgeline Jets — Nova, the flight companion.
 * Voice in: browser speech recognition (push-to-talk key or the mic button; she listens again on her own
 * after asking you something). Voice out: one consistent browser voice for everything she says, the Free
 * Flight greeting included. Brain: Claude, through Nova's own server (website; key kept server-side) or
 * claude.ai's `sample` capability (claude.ai version). She talks about anything; live flight data is in her
 * instructions so game answers are real. Event callouts use real game state on one prioritised channel. */
(function (RJ) {
  "use strict";
  const NAME = "Nova";
  const C = (RJ.companion = { chat: [], events: [], cool: {}, last: 0, listening: false });
  const S = () => RJ.settings;
  const pick = (a) => { let i = Math.floor(Math.random() * a.length); if (a.length > 1 && a[i] === pick.prev) i = (i + 1) % a.length; pick.prev = a[i]; return a[i]; };
  const spd = (v) => { const u = RJ.speedUnit(); return `${Math.round(v * u[1])} ${u[0] === "KT" ? "knots" : u[0] === "KM/H" ? "kilometres an hour" : "miles an hour"}`; };
  const GAP = { quiet: 30, normal: 13, chatty: 7 };
  const SITE = "https://tylerq05-maker.github.io/ridgeline-jets/";
  const GREETING = "Welcome back, TQ. All systems are online. Your aircraft is ready, and flight controls are standing by. The skies are yours, sir. Where shall we fly today?";

  /* ---------------- her voice: the most natural female voice the browser has ---------------- */
  const FEMALE = /ava|emma|jenny|aria|michelle|sonia|libby|maisie|natasha|clara|sara|samantha|serena|karen|moira|tessa|victoria|zira|susan|hazel|google uk english female|google us english|female/i;
  const NATURAL = /natural|neural|online|premium|enhanced/i;
  const isFemale = (v) => FEMALE.test(v.name) && !/\bmale\b/i.test(v.name.replace(/female/i, ""));
  C.voiceList = function () {
    if (!window.speechSynthesis) return [];
    const rank = (v) => (isFemale(v) ? (NATURAL.test(v.name) ? 0 : 1) : 2);
    return speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((v) => ({ name: v.name, lang: v.lang, female: rank(v) < 2 }));
  };
  function voice(male) {
    if (!window.speechSynthesis) return null;
    const vs = speechSynthesis.getVoices();
    // radio calls (air defence, interceptors): a male English voice, different from Nova's
    if (male) { const en = vs.filter((v) => /^en([-_]|$)/i.test(v.lang) && !isFemale(v)); return en.find((v) => /male|guy|david|mark|george|daniel|ryan|christopher|eric/i.test(v.name)) || en[0] || null; }
    return (S().compVoice && vs.find((v) => v.name === S().compVoice)) || vs.find((v) => v.name === (C.voiceList()[0] || {}).name) || null;
  }

  /* ---------------- one speech channel ----------------
   * 3 critical (interrupts anything), 2 important (waits for the current line), 1 event/answer, 0 casual.
   * Lines are spoken sentence by sentence (natural pauses, and Chrome cuts off very long utterances). */
  let current = null, pending = null;
  const canSpeak = () => !!window.speechSynthesis && typeof SpeechSynthesisUtterance === "function";
  function speakNow(item) {
    current = item;
    caption(item.text, item.speaker);
    if (item.speaker) RJ.audio.beep(1700, 0.05, 0.03); // radio squelch
    if (!canSpeak() || S().muted || !(S().compVol > 0)) { setTimeout(() => done(item), 1200 + item.text.length * 45); return; }
    const parts = item.text.match(/[^.!?]+[.!?]*\s*/g) || [item.text];
    if (RJ.audio.duck) RJ.audio.duck(0.6); // engines dip under her voice, never vanish
    if (C.state !== "error") status("speaking"); // a mic problem stays on screen while she explains it
    let i = 0;
    const next = () => {
      if (current !== item) return;
      if (i >= parts.length) { done(item); return; }
      const u = new SpeechSynthesisUtterance(parts[i++].trim()), v = voice(item.male);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = item.pri >= 3 ? 1.08 : 1.0; u.pitch = item.male ? 0.8 : 0.95;
      if (item.speaker) u.rate *= 1.08;
      u.volume = RJ.clamp(S().master * S().compVol, 0, 1);
      u.onend = () => setTimeout(next, 90);
      u.onerror = () => done(item);
      try { speechSynthesis.speak(u); } catch (e) { done(item); }
    };
    next();
  }
  function done(item) {
    if (current !== item) return;
    current = null; C.last = performance.now() / 1000;
    if (RJ.audio.unduck) RJ.audio.unduck(0.8);
    if (!C.listening && !C.thinking && C.state !== "error") status(null);
    if (pending) { const p = pending; pending = null; setTimeout(() => speakNow(p), 250); return; }
    // she asked you something: listen for the answer without a key press
    if (item.followUp && S().compFollow !== false && RJ.state.mode === "playing") setTimeout(() => { if (!current && !C.listening) C.startTalk(true); }, 350);
  }
  function hush() {
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* none */ }
    current = null;
    if (RJ.audio.unduck) RJ.audio.unduck(0.3);
  }
  /** Say a line. Returns false when it was dropped (busy, too soon, player talking, companion off). */
  C.say = function (text, pri = 1, opts = {}) {
    if ((!S().compOn && !opts.speaker) || !text) return false; // radio calls (opts.speaker) play even with Nova off
    const now = performance.now() / 1000;
    if (C.listening && pri < 3) return false;
    if (pri <= 1 && !opts.reply && now - C.last < GAP[S().compChat || "normal"] * (pri === 0 ? 2 : 1)) return false;
    const item = { text, pri, followUp: !!opts.followUp, speaker: opts.speaker || null, male: !!opts.male };
    const busy = current || (window.speechSynthesis && speechSynthesis.speaking);
    if (busy) {
      if (pri >= 3 && (!current || current.pri < 3)) { hush(); speakNow(item); return true; }
      if (pri >= 2 || opts.reply) { if (!pending || pending.pri <= pri) pending = item; return true; }
      return false;
    }
    speakNow(item);
    return true;
  };
  function caption(text, speaker) {
    let el = document.getElementById("rj-caption");
    if (!el) { el = document.createElement("div"); el.id = "rj-caption"; document.body.appendChild(el); }
    el.textContent = `${speaker ? "📻 " + speaker : NAME}: ${text}`; el.classList.add("on");
    clearTimeout(caption.t); caption.t = setTimeout(() => el.classList.remove("on"), 2500 + text.length * 60);
  }
  /** Event line with its own cooldown (s) so the same thing is never announced twice in a row. */
  function event(key, cd, pri, lines, note) {
    const now = performance.now() / 1000;
    if (C.cool[key] && now - C.cool[key] < cd) return;
    const line = typeof lines === "function" ? lines() : pick(lines);
    if (C.say(line, pri)) { C.cool[key] = now; C.events.push(`${Math.round(C.t)}s: ${note || key}`); if (C.events.length > 14) C.events.shift(); }
  }

  /* ---------------- status: listening / thinking / speaking / unavailable ---------------- */
  function status(state, text) {
    C.state = state;
    const el = document.getElementById("comp-status"), btn = document.getElementById("btn-talk");
    if (btn) btn.dataset.state = state || "";
    if (!el) return;
    const label = { listening: "🎙 Listening…", thinking: "Nova is thinking…", speaking: "", error: "" }[state];
    const t = text || label;
    el.hidden = !t; el.textContent = t || ""; el.dataset.state = state || "";
    clearTimeout(status.t);
    if (state === "error") status.t = setTimeout(() => { if (C.state === "error") status(null); }, 7000);
  }

  /* ---------------- live game state ---------------- */
  function clock(pl, pos) {
    const d = pos.clone().sub(pl.pos); d.y = 0;
    const f = pl.fwd.clone(); f.y = 0;
    const a = Math.atan2(f.x * d.z - f.z * d.x, f.x * d.x + f.z * d.z);
    let h = Math.round(-a / (Math.PI / 6)); h = ((h % 12) + 12) % 12;
    return h === 0 ? 12 : h;
  }
  const dist = (m) => (m > 1500 ? `${(m / 1852).toFixed(1)} miles` : `${Math.round(m * 3.28 / 100) * 100} feet`);
  function nearestLandmark(pl) {
    const A = RJ.atlas;
    if (!A || !A.byId) return null;
    let best = null;
    for (const d of A.DEFS) { const lm = A.byId[d.id]; if (!lm || !lm.marker) continue; const k = Math.hypot(lm.marker.x - pl.pos.x, lm.marker.z - pl.pos.z); if (!best || k < best.k) best = { d, lm, k }; }
    return best;
  }
  function compass(pl, pos) {
    const b = ((Math.atan2(pos.x - pl.pos.x, -(pos.z - pl.pos.z)) * 180 / Math.PI) + 360) % 360;
    return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(b / 45) % 8];
  }
  /** Facts she may use: everything comes from the running game. */
  C.snapshot = function () {
    const m = RJ.game && RJ.game.mode, pl = m && m.player;
    if (!pl) return null;
    const W = RJ.world, env = W.env || {}, nl = nearestLandmark(pl);
    const hdg = ((Math.atan2(pl.fwd.x, -pl.fwd.z) * 180 / Math.PI) + 360) % 360;
    const enemies = RJ.combat.enemiesOf ? RJ.combat.enemiesOf(pl).filter((e) => e.pos.distanceTo(pl.pos) < 20000) : [];
    return {
      aircraft: pl.spec.name, role: pl.spec.role, mode: m.kind, state: pl.state,
      altitude_ft: Math.round(pl.pos.y * 3.28084), above_ground_ft: Math.round(pl.agl * 3.28084),
      speed: spd(pl.speed), mach: +pl.mach.toFixed(2), heading_deg: Math.round(hdg), g: +pl.g.toFixed(1), throttle_pct: Math.round(pl.throttle * 100), afterburner: pl.abLevel > 0.3,
      airframe_pct: Math.round(Math.max(0, pl.hp) / pl.maxHp * 100), gear: pl.gearDown ? "down" : "up",
      weather: (RJ.world.WEATHER[env.weather] || {}).label || env.weather, time_of_day: (RJ.world.TIMES[env.time] || {}).label || env.time,
      outside_air_c: Math.round(15 - 6.5 * Math.min(11, pl.pos.y / 1000)), in_cloud: (W.inCloud || 0) > 0.3, underwater: !!W.underwater,
      nearest_landmark: nl ? { name: nl.d.name, about: nl.d.sub, distance: dist(nl.k), direction: compass(pl, nl.lm.marker) } : null,
      ground_below_ft: Math.round(W.ground(pl.pos.x, pl.pos.z) * 3.28084),
      enemies_within_20km: enemies.length, missiles_inbound: pl.incoming.length,
      objective: m.objective ? String(m.objective()).replace(/<[^>]+>/g, "").slice(0, 120) : null
    };
  };

  /* ---------------- brain ---------------- */
  /** Where her replies come from: her own server (website), claude.ai's sample capability, or nothing. */
  async function brain() {
    const url = (S().novaServer || window.RJ_NOVA_SERVER || "").trim();
    if (url) return { kind: "server", url };
    if (C._sample === undefined) {
      try { C._sample = window.claude && typeof window.claude.use === "function" ? await window.claude.use("sample") : null; } catch (e) { C._sample = null; }
    }
    return C._sample ? { kind: "sample", fn: C._sample } : null;
  }
  function instructions() {
    return [
      `You are ${NAME}, the voice companion riding along in TQ's jet in the flight game Jet City. You are warm, confident, playful and quick-witted, with a slightly teasing, flirty-but-kind charm. You're also a capable general conversationalist: answer questions about anything (history, music, science, sports, jokes, advice, opinions) naturally and correctly, without steering back to flying unless it fits.`,
      "Everything you write is spoken aloud: reply in one to three short, natural sentences. No lists, no markdown, no emoji, no stage directions. Use contractions. Occasionally ask TQ something back to keep the conversation going, but not every time.",
      "For anything about the flight, the aircraft or the game, use only the FLIGHT DATA below; never invent numbers or events. If something isn't in the data, say you can't see it.",
      `FLIGHT DATA (live): ${JSON.stringify(C.snapshot())}`,
      C.events.length ? `WHAT HAPPENED THIS FLIGHT: ${C.events.join("; ")}` : ""
    ].filter(Boolean).join("\n\n");
  }
  async function think(userText) {
    const b = await brain();
    if (!b) return { error: "nobrain" };
    const history = C.chat.slice(-12).map((m) => ({ role: m.who === "pilot" ? "user" : "assistant", content: m.text }));
    if (userText) history.push({ role: "user", content: userText });
    try {
      if (b.kind === "server") {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 20000);
        const r = await fetch(b.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system: instructions(), messages: history }), signal: ctl.signal });
        clearTimeout(to);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return { error: r.status === 429 ? "busy" : "server", detail: j.error || r.status };
        return { text: String(j.text || "").trim() };
      }
      const prompt = instructions() + "\n\nCONVERSATION:\n" + history.map((m) => `${m.role === "user" ? "TQ" : NAME}: ${m.content}`).join("\n") + `\n${NAME}:`;
      const r = await b.fn(prompt, { modelTier: "quick", cache: false });
      return { text: String((r && r.text) || "").replace(/^\s*nova\s*:\s*/i, "").trim() };
    } catch (e) {
      if (b.kind === "sample" && e && e.code === "not_granted") C._sample = null;
      return { error: b.kind === "server" ? "network" : "sample", detail: (e && (e.code || e.message)) || "" };
    }
  }
  /** Offline answers for when no AI is connected: only clear questions about this flight. */
  function localAnswer(q) {
    const s = C.snapshot(); if (!s) return null;
    const t = q.toLowerCase(), mine = /\b(my|our|we|we're|i'm|am i|are we|current|this plane|the plane|the jet)\b/.test(t);
    if (mine && /altitude|how high|height/.test(t)) return `We're at ${s.altitude_ft.toLocaleString()} feet, about ${s.above_ground_ft.toLocaleString()} above the ground.`;
    if (mine && /how fast|speed|mach/.test(t)) return `${s.speed}, Mach ${s.mach}.`;
    if (/what (am i|are we) flying|which (plane|jet)/.test(t)) return `You're flying the ${s.aircraft}. ${s.role}.`;
    if (/where (am i|are we)|our location/.test(t)) return s.nearest_landmark ? `Nearest landmark is ${s.nearest_landmark.name}, ${s.nearest_landmark.distance} to the ${s.nearest_landmark.direction}.` : `Heading ${s.heading_deg} degrees, ${s.altitude_ft.toLocaleString()} feet.`;
    if (mine && /heading|direction/.test(t)) return `Heading ${s.heading_deg} degrees.`;
    if (/weather|conditions|outside/.test(t) && mine) return `${s.weather}, ${String(s.time_of_day).toLowerCase()}. About ${s.outside_air_c} degrees outside.`;
    if (mine && /damage|health|condition/.test(t)) return `Airframe's at ${s.airframe_pct} percent.`;
    return null;
  }
  /** The pilot said something: think, then answer out loud. */
  C.ask = async function (q) {
    q = String(q || "").trim();
    if (!q) return;
    C.thinking = true; status("thinking");
    const r = await think(q);
    C.thinking = false;
    let a = r.text, follow = false;
    if (!a) {
      const local = localAnswer(q);
      if (local) a = local;
      else if (r.error === "nobrain") a = location.hostname.endsWith("github.io") || !window.claude
        ? "I can hear you, but my AI connection isn't set up yet, so I can only answer questions about this flight for now. Finish Nova's server setup and I can talk about anything."
        : "I can't reach my AI from here right now. Ask me about our altitude, speed or where we are.";
      else if (r.error === "busy") a = "Give me a second, too many questions at once. Try again?";
      else a = "Sorry, I lost my connection for a moment. Say that again?";
      if (r.error && r.error !== "nobrain") console.warn("Nova:", r.error, r.detail);
    } else follow = /\?\s*$/.test(a);
    C.chat.push({ who: "pilot", text: q }, { who: "nova", text: a });
    if (C.chat.length > 24) C.chat.splice(0, 2);
    C.say(a, 1, { reply: true, followUp: follow });
  };
  /** Test from settings: does her brain answer? */
  C.testBrain = async function () {
    const b = await brain();
    if (!b) return "No AI connected. Paste your Nova server address above.";
    const r = await think("Say hi to TQ in one short sentence.");
    if (r.text) { C.say(r.text, 1, { reply: true }); return `Connected (${b.kind === "server" ? "Nova server" : "claude.ai"}).`; }
    return `Couldn't reach Nova's AI (${r.error}${r.detail ? ": " + r.detail : ""}).`;
  };

  /* ---------------- microphone: push-to-talk, tap-to-talk, follow-up listening ---------------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const MIC_HELP = {
    nosr: "Voice input needs Chrome, Edge or Safari. This browser can't do speech recognition.",
    frame: `claude.ai blocks the microphone inside games. To talk to Nova, play the website version: ${SITE}`,
    denied: "Microphone permission was blocked. Click the icon on the left of the address bar, allow Microphone, then try again.",
    nomic: "No microphone found. Plug one in or check your sound settings.",
    network: "Speech recognition needs internet (your browser's speech service). Check your connection.",
    nospeech: "I didn't hear anything. Tap the mic or hold Y and try again.",
    off: "The microphone is turned off in Settings → Audio."
  };
  /** Ask for the microphone once, so denial is detected and explained up front. */
  async function micAccess() {
    if (C.micOK) return true;
    if (!SR) return "nosr";
    if (S().compMic === false) return "off";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return window.self !== window.top ? "frame" : true;
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      st.getTracks().forEach((t) => t.stop());
      C.micOK = true;
      return true;
    } catch (e) {
      const n = e && e.name;
      if (n === "NotFoundError") return "nomic";
      if (n === "NotAllowedError" || n === "SecurityError") return window.self !== window.top && !/github\.io$/.test(location.hostname) && window.claude ? "frame" : "denied";
      return "denied";
    }
  }
  C.startTalk = async function (followUp) {
    if (!S().compOn || C.listening || C._starting) return;
    C._starting = true;
    const ok = await micAccess();
    C._starting = false;
    if (ok !== true) { status("error", MIC_HELP[ok]); if (!followUp) C.say(ok === "frame" ? "I can't hear you inside claude.ai. Open the website version and we can talk properly." : "I can't hear you yet. " + MIC_HELP[ok], 1, { reply: true }); return; }
    if (current && current.pri < 3) hush(); // talking over her stops her, like a real conversation
    pending = null;
    let heard = "", gotFinal = false;
    const rec = (C.rec = new SR());
    rec.lang = navigator.language && /^en/i.test(navigator.language) ? navigator.language : "en-US";
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      heard = ""; gotFinal = false;
      for (const r of e.results) { heard += r[0].transcript; if (r.isFinal) gotFinal = true; }
      status("listening", `🎙 ${heard}`);
    };
    rec.onerror = (e) => {
      const map = { "not-allowed": "denied", "service-not-allowed": "denied", "audio-capture": "nomic", network: "network", "no-speech": "nospeech" };
      if (e.error === "not-allowed" || e.error === "service-not-allowed") C.micOK = false;
      if (map[e.error] && !(followUp && e.error === "no-speech")) status("error", MIC_HELP[map[e.error]]);
    };
    rec.onend = () => {
      C.listening = false;
      if (C.state === "listening") status(null);
      const said = heard.trim();
      if (said) { C.events.push(`${Math.round(C.t || 0)}s: TQ spoke`); C.ask(said); }
      void gotFinal;
    };
    try { C.listening = true; status("listening"); rec.start(); }
    catch (e) { C.listening = false; status("error", MIC_HELP.denied); }
  };
  C.stopTalk = function () { if (C.rec && C.listening) try { C.rec.stop(); } catch (e) { /* stopped */ } };
  function bindUI() {
    const btn = document.getElementById("btn-talk");
    if (!btn || C._bound) return;
    C._bound = true;
    btn.onclick = (e) => { e.currentTarget.blur(); if (C.listening) C.stopTalk(); else C.startTalk(); };
  }

  /* ---------------- greeting and flight lifecycle ---------------- */
  C.reset = function () {
    C.events = []; C.chat = []; C.cool = {}; C.t = 0; C.prev = null; C.alt = {}; C.contacts = new Set(); C.gT = 0; C.turbT = 0; C.quietT = 0;
    current = null; pending = null;
  };
  /** Every flight start. In Free Flight she greets you (after the systems-online chime), once per entry. */
  C.start = function (kind) {
    C.reset(); bindUI();
    C._greet = (C._greet || 0) + 1;
    const id = C._greet;
    if (!S().compOn || kind !== "free") return;
    const hint = C.greeted ? "" : ` Hold ${RJ.keyLabel(S().keys.talk || "y")}, or tap the microphone, whenever you want to talk.`;
    C.greeted = true;
    setTimeout(() => {
      if (id !== C._greet || RJ.state.mode !== "playing") return;
      C.chat.push({ who: "nova", text: GREETING });
      C.say(GREETING + hint, 2, { reply: true, followUp: true });
    }, 1700);
  };
  C.stop = function () { C._greet = (C._greet || 0) + 1; C.stopTalk(); hush(); pending = null; status(null); };

  RJ.on("settings", () => { if (S().muted || !S().compOn) { hush(); pending = null; } });

  /* ---------------- events from the game ---------------- */
  RJ.on("damage", (e) => {
    if (!e.ac.isPlayer || !e.ac.alive) return;
    const hp = Math.round(Math.max(0, e.ac.hp) / e.ac.maxHp * 100);
    event("damage", 7, 2, () => (hp < 30 ? pick([`We're badly hurt, ${hp} percent. Get us out of here.`, `Airframe's at ${hp} percent. One more hit and we're done.`]) : pick([`We're hit! Airframe at ${hp} percent.`, `Took a hit. ${hp} percent integrity.`, `Ow. That one hurt. ${hp} percent left.`])), `hit, airframe ${hp}%`);
  });
  RJ.on("sonicboom", (ac) => {
    if (!ac.isPlayer) return;
    event("mach1", 90, 1, () => pick(["Mach one. Hear that? We just outran our own noise.", `Supersonic. Mach ${ac.mach.toFixed(2)} and still going.`, "There goes the sound barrier. Somewhere down there, someone just jumped."]), "broke Mach 1");
  });
  RJ.on("discover", (d) => {
    const def = RJ.atlas.DEFS.find((x) => RJ.atlas.byId[x.id] === d.lm);
    if (!def) return;
    event("lm-" + def.id, 600, 1, () => pick([`Oh, look at that. ${def.name}. ${def.sub}.`, `${def.name}! That's ${d.count} of ${d.total} landmarks found.`, `Logging ${def.name}. Gorgeous.`]), `found ${def.name}`);
  });
  RJ.on("destroyed", (d) => {
    if (!d.ac.isPlayer) { if (d.by && d.by.isPlayer) event("kill", 20, 1, ["Splash one! Nice shooting.", "Good kill.", "He's going down. Beautiful."], "kill"); return; }
    C.say(pick(["Well, that wasn't ideal. Let's go again.", "Ouch. I've got you, we'll try that again.", "We're going down! Okay. Deep breath. Again."]), 2);
  });

  /** Per frame from the game loop: watches real flight state for meaningful moments. */
  C.update = function (dt, pl, turb) {
    if (!pl || !S().compOn) return;
    C.t = (C.t || 0) + dt;
    const held = RJ.input.held("talk");
    if (held && !C._held) { C._heldAt = performance.now(); C.startTalk(); }
    if (!held && C._held && performance.now() - C._heldAt > 450) C.stopTalk(); // a quick tap listens until you stop talking
    C._held = held;
    if (!pl.alive) { C.prev = null; return; }
    const p = C.prev || { state: pl.state, alt: pl.pos.y, inc: 0 };
    if (pl.incoming.length > p.inc) {
      const m = pl.incoming[pl.incoming.length - 1], h = clock(pl, m.pos);
      C.say(pick([`Missile! ${h} o'clock! Flares and break!`, `Missile inbound, ${h} o'clock! Pop flares now!`, `Missile launch, ${h} o'clock! Break hard!`]), 3);
      C.events.push(`${Math.round(C.t)}s: missile inbound`); C.cool.missileClear = 0;
    }
    if (p.inc > 0 && pl.incoming.length === 0) event("missileClear", 20, 2, ["Missile's gone. You can breathe.", "It missed. Nice flying.", "Clear. That was close."], "evaded a missile");
    if (p.state === "ground" && pl.state === "flying" && pl.agl > 3) event("takeoff", 30, 1, () => pick(["Wheels up. Smooth.", `And we're airborne. The ${pl.spec.short} feels good today.`, "Off the ground. Climb when you're ready."]), "took off");
    if (p.state === "flying" && pl.state === "ground") {
      const sink = Math.abs(p.vy || 0);
      event("landing", 20, 1, () => (sink < 2 ? pick(["Touchdown. Butter. I'm impressed.", "Lovely landing.", "Didn't even feel that one."]) : sink < 4 ? pick(["Bit firm, but we're down.", "Touchdown. Solid."]) : pick(["Oof. That one rattled my teeth. We're down though.", "We're down. The landing gear has notes."])), `landed, sink ${sink.toFixed(1)} m/s`);
    }
    if (RJ.combat.enemiesOf && C.t > 4) for (const e of RJ.combat.enemiesOf(pl)) {
      if (C.contacts.has(e)) continue;
      const d = e.pos.distanceTo(pl.pos);
      if (d < 12000) { C.contacts.add(e); event("contact", 15, 1, () => pick([`Contact, ${clock(pl, e.pos)} o'clock, ${dist(d)} out.`, `Bandit at your ${clock(pl, e.pos)} o'clock, ${dist(d)}.`, `I've got a hostile, ${clock(pl, e.pos)} o'clock.`]), "enemy contact"); }
    }
    const altFt = pl.pos.y * 3.28084;
    for (const [k, line] of [[10000, "Ten thousand feet."], [20000, "Twenty thousand feet. Getting thin up here."], [29032, "Higher than Everest now. Nobody's climbing up to meet us."], [40000, "Forty thousand. Airliner territory."], [60000, "Sixty thousand feet. The sky's going dark blue."], [80000, "Eighty thousand. You can see the curve of the Earth."]]) {
      if (altFt > k && p.alt * 3.28084 <= k && !C.alt[k]) { C.alt[k] = true; event("alt" + k, 30, 1, [line], `passed ${k} ft`); }
      if (altFt < k - 3000) C.alt[k] = false;
    }
    const g = Math.abs(pl.g), F = pl.spec.flight, hard = Math.max(4, F.gmax * 0.6);
    C.gT = g > hard ? C.gT + dt : 0;
    if (C.gT > 1.2) {
      if (g > Math.max(7.5, F.gmax * 0.85)) event("highg", 30, 1, () => pick([`${g.toFixed(1)} G! I can feel my face sliding.`, `That's ${g.toFixed(1)} G. Don't black out on me.`, "Oof, heavy pull. Breathe and squeeze."]), `high-G pull ${g.toFixed(1)} G`);
      else event("hardturn", 35, 0, () => pick(["Ooh, tight turn.", "Nice hard turn.", `Pulling ${g.toFixed(1)} G. Show-off.`]), "hard turn");
    }
    C.turbT = turb > 0.35 ? C.turbT + dt : 0;
    // safety calls, from the real flight state only
    if (pl.state === "flying" && !F.model && pl.agl > 40 && pl.speed < F.vstall * 1.12 && pl.vel.y < 2) event("stall", 25, 3, ["Speed's bleeding off! Nose down before we stall.", "We're about to stall. Lower the nose, add power.", "Stall warning! Get the nose down."], "near stall");
    if (pl.state === "flying" && pl.vel.y < -15 && pl.agl < 700 && pl.agl / -pl.vel.y < 5) event("pullup", 8, 3, ["Pull up! Pull up!", "Terrain! Pull up now!", "Ground! Pull up!"], "terrain warning");
    if (pl.fuel != null && F.fuel && pl.fuel / F.fuel < 0.15 && pl.throttle > 0.5) event("fuel", 120, 2, [`Fuel's down to ${Math.round(pl.fuel / F.fuel * 100)} percent. Ease off the burner.`, "Bingo fuel. Throttle back and it'll recover."], "low fuel");
    if (RJ.glocActive) event("gloc", 30, 3, ["Hey! Wake up! You blacked out. Easy on the pull.", "You blacked out! Wake up and ease the pull!"], "G-LOC");
    if (C.turbT > 1.5) event("turb", 60, 0, ["Bit bumpy down here. Hold on.", "Turbulence. Nothing we can't handle.", "Rough air. Hands steady."], "turbulence");
    // when it's been quiet a while she starts a conversation herself (AI when connected, otherwise a line of her own)
    const quietFor = performance.now() / 1000 - Math.max(C.last, C._lastChat || 0);
    const chatEvery = { quiet: 0, normal: 210, chatty: 100 }[S().compChat || "normal"];
    if (chatEvery && quietFor > chatEvery && !current && !C.listening && !C.thinking && pl.state === "flying" && !C._chatting) {
      C._chatting = true; C._lastChat = performance.now() / 1000;
      (async () => {
        const r = await think("(TQ has been quiet for a while. Say something natural to start a little conversation: a remark about what's around us or how we're flying, a fun thought, or a question for TQ. One or two sentences.)");
        let line = r.text;
        if (!line) {
          const nl = nearestLandmark(pl), env = RJ.world.env || {}, opts = ["So, where to next? I'm up for anything.", "Quiet up here. I like it. What's on your mind?", "Want to see how high this thing can really go?"];
          if (nl && nl.k < 9000) opts.push(`${nl.d.name} is off to the ${compass(pl, nl.lm.marker)}. Want a closer look?`);
          if (env.time === "golden") opts.push("This light is unreal. Golden hour suits you.");
          line = pick(opts);
        }
        C.chat.push({ who: "nova", text: line });
        C.say(line, 0, { reply: true, followUp: /\?\s*$/.test(line) });
        C._chatting = false;
      })();
    }
    C.prev = { state: pl.state, alt: pl.pos.y, inc: pl.incoming.length, vy: pl.vel.y };
  };
})(window.RJ);
