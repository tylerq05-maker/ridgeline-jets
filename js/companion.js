/* Ridgeline Jets — Nova, the flight companion.
 * Speaks on real game events (takeoff, landing, Mach 1, missiles, contacts, altitude, G, turbulence, damage,
 * landmarks), answers questions from live flight data, and chats. One speech channel with priorities:
 * critical warnings interrupt, casual lines are dropped rather than queued, nothing talks over the player.
 * Speech: browser text-to-speech. Listening: browser speech recognition (push-to-talk), or a typed box where
 * the microphone isn't available. Open conversation: Claude through claude.ai's `sample` capability when the
 * game runs on claude.ai (no keys in the page); elsewhere she answers flight questions locally. */
(function (RJ) {
  "use strict";
  const NAME = "Nova";
  const C = (RJ.companion = { chat: [], events: [], cool: {}, last: 0, listening: false, ai: undefined });
  const S = () => RJ.settings;
  const pick = (a) => { const i = Math.floor(Math.random() * a.length); return a[i === pick.last && a.length > 1 ? (i + 1) % a.length : i]; };
  const ft = (m) => Math.round(m * 3.28084).toLocaleString();
  const spd = (v) => { const u = RJ.speedUnit(); return `${Math.round(v * u[1])} ${u[0] === "KT" ? "knots" : u[0] === "KM/H" ? "kilometres an hour" : "miles an hour"}`; };
  const GAP = { quiet: 30, normal: 13, chatty: 7 };

  /* ---------------- voice ---------------- */
  const FEMALE_PREF = /aria|jenny|ava|emma|sonia|libby|michelle|sara|natasha|samantha|serena|karen|moira|tessa|google uk english female|google us english|female/i;
  const MALE = /ryan|thomas|guy|davis|christopher|eric|andrew|brian|roger|daniel|george|arthur|alex|fred|male(?!.*female)/i;
  C.voiceList = function () {
    if (!window.speechSynthesis) return [];
    const all = speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
    const rank = (v) => (FEMALE_PREF.test(v.name) && !/^(?!.*female).*\bmale\b/i.test(v.name) ? (/natural|neural|online|premium|enhanced/i.test(v.name) ? 0 : 1) : MALE.test(v.name) ? 3 : 2);
    return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((v) => ({ name: v.name, lang: v.lang, female: rank(v) < 2 }));
  };
  function voice() {
    if (!window.speechSynthesis) return null;
    const vs = speechSynthesis.getVoices();
    return (S().compVoice && vs.find((v) => v.name === S().compVoice)) || vs.find((v) => v.name === (C.voiceList()[0] || {}).name) || null;
  }

  /* ---------------- one speech channel with priorities ---------------- */
  // 3 critical (interrupts anything), 2 important (waits for the current line), 1 event/answer, 0 casual
  let current = null, pending = null;
  function speakNow(item) {
    current = item;
    caption(item.text);
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance !== "function" || S().muted || !(S().compVol > 0)) { setTimeout(() => done(item), 1200 + item.text.length * 45); return; }
    const u = new SpeechSynthesisUtterance(item.text), v = voice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = item.pri >= 3 ? 1.12 : 1.0; u.pitch = 0.94; // warm and a touch low; urgent when it matters
    u.volume = RJ.clamp(S().master * S().compVol, 0, 1);
    u.onend = u.onerror = () => done(item);
    if (RJ.audio.duck) RJ.audio.duck(0.72); // keep her above the engines without silencing them
    try { speechSynthesis.speak(u); } catch (e) { done(item); }
  }
  function done(item) {
    if (current !== item) return;
    current = null; C.last = performance.now() / 1000;
    if (RJ.audio.unduck) RJ.audio.unduck(0.8);
    if (pending) { const p = pending; pending = null; setTimeout(() => speakNow(p), 250); }
  }
  /** Say a line. Returns false when it was dropped (busy, too soon, player talking, companion off). */
  C.say = function (text, pri = 1, opts = {}) {
    if (!S().compOn || !text) return false;
    const now = performance.now() / 1000;
    if (C.listening && pri < 3) return false;
    if (pri <= 1 && !opts.reply && now - C.last < GAP[S().compChat || "normal"] * (pri === 0 ? 2 : 1)) return false;
    const item = { text, pri };
    const busy = current || (window.speechSynthesis && speechSynthesis.speaking);
    if (busy) {
      if (pri >= 3 && (!current || current.pri < 3)) { try { speechSynthesis.cancel(); } catch (e) { /* none */ } if (current) { const c = current; current = null; if (RJ.audio.unduck) RJ.audio.unduck(0.3); void c; } speakNow(item); return true; }
      if (pri >= 2 || opts.reply) { if (!pending || pending.pri <= pri) pending = item; return true; }
      return false;
    }
    speakNow(item);
    return true;
  };
  function caption(text) {
    let el = document.getElementById("rj-caption");
    if (!el) { el = document.createElement("div"); el.id = "rj-caption"; document.body.appendChild(el); }
    el.textContent = `${NAME}: ${text}`; el.classList.add("on");
    clearTimeout(caption.t); caption.t = setTimeout(() => el.classList.remove("on"), 2500 + text.length * 60);
  }
  /** Event line with its own cooldown (s) so the same thing is never announced twice in a row. */
  function event(key, cd, pri, lines, note) {
    const now = performance.now() / 1000;
    if (C.cool[key] && now - C.cool[key] < cd) return;
    const line = typeof lines === "function" ? lines() : pick(lines);
    if (C.say(line, pri)) { C.cool[key] = now; C.events.push(`${Math.round(C.t)}s: ${note || key}`); if (C.events.length > 14) C.events.shift(); }
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

  /* ---------------- answering ---------------- */
  /** Flight questions answered straight from the game (instant, free, never invented). */
  function localAnswer(q) {
    const s = C.snapshot(); if (!s) return null;
    const t = q.toLowerCase();
    const has = (...w) => w.some((x) => t.includes(x));
    if (has("altitude", "how high", "height")) return pick([`We're at ${s.altitude_ft.toLocaleString()} feet, about ${s.above_ground_ft.toLocaleString()} above the ground.`, `${s.altitude_ft.toLocaleString()} feet. Ground's ${s.above_ground_ft.toLocaleString()} feet below us.`]);
    if (has("how fast", "speed", "mach")) return `${s.speed}, Mach ${s.mach}.${s.afterburner ? " Afterburner's lit." : ""}`;
    if (has("what am i flying", "what plane", "which plane", "what jet", "aircraft", "what are we flying")) return `You're flying the ${s.aircraft}. ${s.role}.`;
    if (has("where are we", "where am i", "location", "nearest", "what's that", "what is that", "landmark")) {
      if (s.underwater) return "We're under the sea at Bikini Bottom. Mind the jellyfish.";
      return s.nearest_landmark ? `Nearest landmark is ${s.nearest_landmark.name}, ${s.nearest_landmark.distance} to the ${s.nearest_landmark.direction}. ${s.nearest_landmark.about}.` : `Heading ${s.heading_deg} degrees, ${s.altitude_ft.toLocaleString()} feet.`;
    }
    if (has("heading", "direction", "which way")) return `Heading ${s.heading_deg} degrees.`;
    if (has("weather", "conditions", "temperature", "cold", "wind", "time of day", "what time")) return `${s.weather}, ${s.time_of_day.toLowerCase()}. Outside air's about ${s.outside_air_c} degrees Celsius${s.in_cloud ? ", and we're in cloud" : ""}.`;
    if (has("damage", "health", "how's the plane", "how is the plane", "condition")) return s.airframe_pct >= 95 ? "Airframe's perfect. Not a scratch." : `Airframe's at ${s.airframe_pct} percent.`;
    if (has("g force", "how many g", " g's", "g load")) return `Pulling ${s.g} G right now.`;
    if (has("enemy", "enemies", "bandit", "threat", "contacts")) return s.missiles_inbound ? "Missile inbound! Flares, now!" : s.enemies_within_20km ? `${s.enemies_within_20km} hostile${s.enemies_within_20km > 1 ? "s" : ""} within 20 kilometres.` : "Scope's clear. No hostiles nearby.";
    if (has("gear")) return `Gear's ${s.gear}.`;
    if (has("objective", "mission", "what do i do", "what should i do")) return s.objective || "No mission today. Just you, me and the sky. Go explore.";
    if (has("ground", "terrain", "below us")) return `Terrain below is about ${s.ground_below_ft.toLocaleString()} feet.`;
    if (has("who are you", "your name", "what's your name")) return `I'm ${NAME}, your flight companion. Ask me anything about the flight, or just talk.`;
    if (/^(hi|hey|hello|yo)\b/.test(t)) return pick(["Hey yourself. Nice day for it.", "Hi! Eyes on the sky, I'm right here.", "Hey. Where are we off to?"]);
    if (has("thank")) return pick(["Anytime.", "Always.", "That's what I'm here for."]);
    if (has("joke", "funny")) return pick(["Why do pilots never get lost? They always have a good sense of altitude.", "I'd tell you a joke about a runway, but you'd need a long time to take off with it.", "What's a pilot's favourite food? Plane cheese pizza. I'm sorry."]);
    return null;
  }
  async function aiAvailable() {
    if (C.ai !== undefined) return C.ai;
    try { C.ai = window.claude && typeof window.claude.use === "function" ? await window.claude.use("sample") : null; } catch (e) { C.ai = null; }
    return C.ai;
  }
  async function aiAnswer(q) {
    const sample = await aiAvailable();
    if (!sample) return null;
    const prompt = [
      `You are ${NAME}, the flight companion inside a jet flight game. Personality: warm, confident, playful, a little dry wit; you love flying and scenery. You speak out loud, so reply in 1 or 2 short conversational sentences, no lists, no emoji, no stage directions.`,
      "Only state flight facts that appear in FLIGHT DATA below; never invent numbers. If something isn't in the data, say you can't see it.",
      `FLIGHT DATA (live): ${JSON.stringify(C.snapshot())}`,
      C.events.length ? `RECENT EVENTS THIS FLIGHT: ${C.events.join("; ")}` : "",
      C.chat.length ? `CONVERSATION SO FAR:\n${C.chat.slice(-8).map((m) => `${m.who}: ${m.text}`).join("\n")}` : "",
      `PILOT: ${q}`, `${NAME.toUpperCase()}:`
    ].filter(Boolean).join("\n\n");
    try {
      const r = await sample(prompt, { modelTier: "quick", cache: false });
      return (r && r.text ? r.text : "").replace(/^\s*nova\s*:\s*/i, "").trim().slice(0, 320) || null;
    } catch (e) {
      if (e && e.code === "not_granted") C.ai = null;
      return null;
    }
  }
  /** The pilot said or typed something. */
  C.ask = async function (q) {
    q = String(q || "").trim();
    if (!q) return;
    C.chat.push({ who: "PILOT", text: q });
    let a = localAnswer(q);
    if (!a) {
      C.thinking = true; status("Thinking…");
      a = await aiAnswer(q);
      C.thinking = false; status(null);
    }
    if (!a) a = pick(["Ask me about our altitude, speed, heading, weather or where we are, and I'm all yours.", "I'm better with flight data than philosophy. Try asking where we are, or how fast we're going.", "Hmm, that one's beyond my instruments. Altitude, speed, location, weather, I've got all of those."]);
    C.chat.push({ who: NAME.toUpperCase(), text: a });
    if (C.chat.length > 20) C.chat.splice(0, 2);
    C.say(a, 1, { reply: true });
  };

  /* ---------------- push-to-talk ---------------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  C.micAvailable = () => !!SR && S().compMic !== false && !C.micBlocked;
  function status(text) {
    const el = document.getElementById("comp-status");
    if (!el) return;
    el.hidden = !text; el.textContent = text || "";
  }
  C.startTalk = function () {
    if (!S().compOn || C.listening) return;
    if (!C.micAvailable()) { openBox(); return; }
    try {
      const rec = (C.rec = new SR());
      rec.lang = "en-US"; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
      let finalText = "";
      rec.onresult = (e) => { let s = ""; for (const r of e.results) s += r[0].transcript; finalText = s; status(`🎙 ${s}`); };
      rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") { C.micBlocked = true; RJ.ui.toast("Microphone isn't available here. Type to Nova instead.", 3000); openBox(); } };
      rec.onend = () => { C.listening = false; status(null); C.lastHeard = performance.now() / 1000; if (finalText) C.ask(finalText); };
      C.listening = true; status("🎙 Listening…");
      if (window.speechSynthesis && current && current.pri < 3) { try { speechSynthesis.cancel(); } catch (e) { /* none */ } current = null; pending = null; }
      rec.start();
    } catch (e) { C.listening = false; C.micBlocked = true; openBox(); }
  };
  C.stopTalk = function () { if (C.rec && C.listening) try { C.rec.stop(); } catch (e) { /* stopped */ } };
  function openBox() {
    const box = document.getElementById("comp-box"), inp = document.getElementById("comp-input");
    if (!box) return;
    box.hidden = false; inp.value = ""; inp.focus();
  }
  function bindUI() {
    const box = document.getElementById("comp-box"), inp = document.getElementById("comp-input"), btn = document.getElementById("btn-talk");
    if (!box || C._bound) return;
    C._bound = true;
    // keys typed to Nova must not fly the jet
    ["keydown", "keyup"].forEach((ev) => inp.addEventListener(ev, (e) => {
      e.stopPropagation();
      if (ev === "keydown" && e.key === "Enter") { const q = inp.value; box.hidden = true; inp.blur(); C.ask(q); }
      if (ev === "keydown" && e.key === "Escape") { box.hidden = true; inp.blur(); }
    }));
    btn.onclick = (e) => { e.currentTarget.blur(); if (C.listening) C.stopTalk(); else C.startTalk(); };
  }

  /* ---------------- events from the game ---------------- */
  C.reset = function () {
    C.events = []; C.chat = []; C.cool = {}; C.t = 0; C.prev = null; C.alt = {}; C.contacts = new Set(); C.gT = 0; C.turbT = 0; C.quietT = 0;
    current = null; pending = null;
  };
  C.start = function (kind) {
    C.reset(); bindUI();
    const first = !C.introduced;
    C.introduced = true;
    if (!S().compOn) return;
    // let the Free Flight greeting finish first
    setTimeout(() => {
      const k = RJ.keyLabel(S().keys.talk || "y");
      if (first) C.say(`Hi, I'm ${NAME}. I'll be flying with you. Hold ${k} to talk to me, any time.`, 1, { reply: true });
      else C.say(pick(["Good to be back up here with you.", "Ready when you are.", "All yours. Let's have some fun."]), 0, { reply: true });
    }, kind === "free" ? 14000 : 2500);
  };
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
    C.say(pick(["Well, that wasn't ideal. Let's go again.", "Ouch. I've got you, we'll try that again.", "We're going down! ...Okay. Deep breath. Again."]), 2);
  });

  /** Per frame from the game loop: watches real flight state for meaningful moments. */
  C.update = function (dt, pl, turb) {
    if (!pl || !S().compOn) return;
    C.t = (C.t || 0) + dt;
    // push-to-talk (held key), only while flying
    const held = RJ.input.held("talk");
    if (held && !C._held) C.startTalk();
    if (!held && C._held) C.stopTalk();
    C._held = held;
    if (!pl.alive) { C.prev = null; return; }
    const p = C.prev || { state: pl.state, alt: pl.pos.y, inc: 0 };
    // missiles: critical, interrupts anything
    if (pl.incoming.length > p.inc) {
      const m = pl.incoming[pl.incoming.length - 1], h = clock(pl, m.pos);
      C.say(pick([`Missile! ${h} o'clock! Flares and break!`, `Missile inbound, ${h} o'clock! Pop flares now!`, `Missile launch, ${h} o'clock! Break hard!`]), 3);
      C.events.push(`${Math.round(C.t)}s: missile inbound`); C.cool.missileClear = 0;
    }
    if (p.inc > 0 && pl.incoming.length === 0) event("missileClear", 20, 2, ["Missile's gone. You can breathe.", "It missed. Nice flying.", "Clear. That was close."], "evaded a missile");
    // takeoff and landing
    if (p.state === "ground" && pl.state === "flying" && pl.agl > 3) event("takeoff", 30, 1, () => pick(["Wheels up. Smooth.", `And we're airborne. The ${pl.spec.short} feels good today.`, "Off the ground. Climb when you're ready."]), "took off");
    if (p.state === "flying" && pl.state === "ground") {
      const sink = Math.abs(p.vy || 0);
      event("landing", 20, 1, () => (sink < 2 ? pick(["Touchdown. Butter. I'm impressed.", "Lovely landing.", "Didn't even feel that one."]) : sink < 4 ? pick(["Bit firm, but we're down.", "Touchdown. Solid."]) : pick(["Oof. That one rattled my teeth. We're down though.", "We're down. The landing gear has notes."])), `landed, sink ${sink.toFixed(1)} m/s`);
    }
    // contacts: each new hostile inside 12 km, once
    if (RJ.combat.enemiesOf && C.t > 4) for (const e of RJ.combat.enemiesOf(pl)) {
      if (C.contacts.has(e)) continue;
      const d = e.pos.distanceTo(pl.pos);
      if (d < 12000) { C.contacts.add(e); event("contact", 15, 1, () => pick([`Contact, ${clock(pl, e.pos)} o'clock, ${dist(d)} out.`, `Bandit at your ${clock(pl, e.pos)} o'clock, ${dist(d)}.`, `I've got a hostile, ${clock(pl, e.pos)} o'clock.`]), "enemy contact"); }
    }
    // altitude milestones (re-armed after descending well below)
    const altFt = pl.pos.y * 3.28084;
    for (const [k, line] of [[10000, "Ten thousand feet."], [20000, "Twenty thousand feet. Getting thin up here."], [29032, "Higher than Everest now. Nobody's climbing up to meet us."], [40000, "Forty thousand. Airliner territory."], [60000, "Sixty thousand feet. The sky's going dark blue."], [80000, "Eighty thousand. You can see the curve of the Earth."]]) {
      if (altFt > k && p.alt * 3.28084 <= k && !C.alt[k]) { C.alt[k] = true; event("alt" + k, 30, 1, [line], `passed ${k} ft`); }
      if (altFt < k - 3000) C.alt[k] = false;
    }
    // hard turns and high G (held, not a spike)
    const g = Math.abs(pl.g), F = pl.spec.flight, hard = Math.max(4, F.gmax * 0.6);
    C.gT = g > hard ? C.gT + dt : 0;
    if (C.gT > 1.2) {
      if (g > Math.max(7.5, F.gmax * 0.85)) event("highg", 30, 1, () => pick([`${g.toFixed(1)} G! I can feel my face sliding.`, `That's ${g.toFixed(1)} G. Don't black out on me.`, "Oof, heavy pull. Breathe and squeeze."]), `high-G pull ${g.toFixed(1)} G`);
      else event("hardturn", 35, 0, () => pick(["Ooh, tight turn.", "Nice hard turn.", `Pulling ${g.toFixed(1)} G. Show-off.`]), "hard turn");
    }
    // turbulence that lasts
    C.turbT = turb > 0.35 ? C.turbT + dt : 0;
    if (C.turbT > 1.5) event("turb", 60, 0, ["Bit bumpy down here. Hold on.", "Turbulence. Nothing we can't handle.", "Rough air. Hands steady."], "turbulence");
    // occasional scenery remark when it's been quiet a long time (chatty and normal only)
    C.quietT = performance.now() / 1000 - C.last > 120 ? C.quietT + dt : 0;
    if (C.quietT > 5 && S().compChat !== "quiet" && pl.state === "flying") {
      C.quietT = 0;
      const nl = nearestLandmark(pl), env = RJ.world.env || {};
      const lines = [];
      if (nl && nl.k < 9000) lines.push(`${nl.d.name} off to the ${compass(pl, nl.lm.marker)}. Worth a closer look.`);
      if (env.time === "golden" || env.time === "dusk" || env.time === "sunset") lines.push("This light is unreal. Golden hour suits you.");
      if (RJ.world.night) lines.push("I love flying at night. It's so quiet up here.");
      if (env.weather === "storm") lines.push("Storm's getting angry. Maybe not too close to those towers.");
      if (!lines.length) lines.push("Just cruising. I like this part too.", "Nice view today.");
      event("scenery", 150, 0, lines, "scenery remark");
    }
    C.prev = { state: pl.state, alt: pl.pos.y, inc: pl.incoming.length, vy: pl.vel.y };
  };
  C.stop = function () { C.stopTalk(); current = null; pending = null; status(null); const b = document.getElementById("comp-box"); if (b) b.hidden = true; };
})(window.RJ);
