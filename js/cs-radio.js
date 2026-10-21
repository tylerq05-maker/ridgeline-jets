/* Jet Combat Simulator — pilot radio chatter (spectator mode).
 * RJ.csRadio.create(M) → { onEvent(e), update(realDt), volume, muted, lastLine, dispose() }
 * Event-driven only: every line answers an event from M.emit (see docs/CS-INTERFACES.md).
 * The selected jet's pilot is PRIMARY (full volume); the other pilot is BACKGROUND (rare, quiet, only big calls).
 * Speech is browser speechSynthesis (cannot be routed through WebAudio), so the radio feel (key-up click,
 * static bed, squelch tail) is built around it on RJ.audio.ctx through a dedicated gain → AU.master. */
(function () {
  "use strict";
  const RJ = window.RJ = window.RJ || {};

  const CALLS = ["Viper", "Raven", "Ghost", "Hammer", "Cobra", "Reaper", "Falcon", "Sabre", "Talon", "Jester", "Havoc", "Diesel", "Shadow", "Blaze"];
  const NUMW = ["One", "Two"];
  const DIG = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const CLOCK = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

  // priority: 3 high, 2 normal, 1 low (droppable chatter)
  const PRI = { incoming: 3, hit: 3, heavydamage: 3, kill: 3, down: 3, downreact: 3,
    launch: 2, spiked: 2, lock: 2, defeated: 2, missed: 2, flares: 2, "break": 2, onsix: 2, tally6: 2, scored: 2,
    reacquired: 2, disengage: 2, merge: 2, contact: 1, visual: 1, lost: 1 };
  // per-pilot, per-type cool-downs (real seconds)
  const COOL = { contact: 60, visual: 60, lock: 6, spiked: 6, launch: 2.5, incoming: 3, defeated: 5, missed: 6, flares: 6,
    "break": 5, onsix: 8, tally6: 8, hit: 4, heavydamage: 15, scored: 5, lost: 10, reacquired: 8, disengage: 12, merge: 15,
    kill: 0, down: 0, downreact: 0 };
  const STALE = { 1: 3, 2: 5, 3: 8 };
  const BG_TYPES = { launch: 1, incoming: 1, kill: 1, down: 1, heavydamage: 1, downreact: 1 };
  const BG_GAP = 8;

  // c = calm wording, h = excited wording. Tokens: {me} {bandit} {brg} {rng} {ang} {clock} {dir} {fox}
  const L = {
    contact: { c: ["{me}, contact, bearing {brg}, {rng} miles, angels {ang}.", "{me}, single group, bullseye {brg}, {rng} miles.", "Radar contact, {brg}, {rng} miles, hot.", "{me}, bogey bearing {brg} for {rng}, angels {ang}."],
      h: ["Contact! Bearing {brg}, {rng} miles!", "{me}, got him! {brg}, {rng} miles out!", "Bandit on the scope, {brg}, {rng} miles, angels {ang}!", "Contact, contact, {brg} for {rng}!"] },
    visual: { c: ["{me}, tally one, {clock} o'clock.", "Visual, bandit {clock} o'clock.", "{me}, tally bandit, {clock} o'clock, {rng} miles.", "Eyes on, {clock} o'clock."],
      h: ["Tally! {clock} o'clock!", "I see him, {clock} o'clock!", "{me}, tally ho, {clock} o'clock!", "Got eyes on him, {clock} o'clock, coming in!"] },
    lock: { c: ["{me}, locked.", "Good lock, {rng} miles.", "{me}, target locked.", "Lock, bandit {rng} miles.", "Tone's good, I'm locked."],
      h: ["Locked him up!", "Lock! Lock! I've got him!", "{me}, solid lock!", "Got a lock, got a lock!", "He's mine, locked!"] },
    spiked: { c: ["{me}, spiked, {clock} o'clock.", "Mud spike, {clock} o'clock.", "{me}, he's locked me up.", "Spiked, {clock} o'clock, defending soon.", "RWR's lit, {clock} o'clock."],
      h: ["Spiked! He's got me locked!", "I'm spiked, {clock} o'clock!", "Lock warning, {clock} o'clock!", "He's painting me!", "{me}, spiked, spiked!"] },
    launch: { c: ["{me}, {fox}.", "{fox}, {rng} miles.", "{me}, {fox}, one away.", "{fox} on the bandit.", "Missile away, {fox}."],
      h: ["{fox}! {fox}!", "{me}, {fox}! Missile away!", "{fox}, get some!", "Rifle— no, {fox}! Away!", "{fox}, it's tracking!"] },
    incoming: { c: ["{me}, missile inbound, breaking {dir}.", "Defending, missile, breaking {dir}.", "{me}, missile in the air, going {dir}.", "Missile launch, defending {dir}.", "Inbound missile, breaking {dir} now."],
      h: ["Missile warning! Breaking {dir}!", "Missile! Missile! Break {dir}!", "{me}, missile inbound! Breaking {dir}!", "He's shooting! Going {dir}!", "Incoming! Break {dir}, break {dir}!"] },
    defeated: { c: ["{me}, missile defeated, reacquiring.", "Missile's trashed, coming back around.", "Defeated, reacquiring the bandit.", "{me}, missile defeated.", "That one's spoofed, back on him."],
      h: ["Missile defeated! Reacquiring!", "Ha! Missed me! Coming around!", "It went stupid, I'm clear!", "Defeated! Back in the fight!", "Shook it! Reacquiring!"] },
    missed: { c: ["{me}, miss.", "Missile's trashed, he defeated it.", "No joy, missile missed.", "{me}, that one's wide.", "Miss, re-attacking."],
      h: ["Damn, missed!", "He dodged it!", "Missile went wide!", "No hit! He beat it!", "Missed! Coming back for him!"] },
    flares: { c: ["{me}, flares.", "Countermeasures out.", "Flares away.", "{me}, dispensing.", "Flaring."],
      h: ["Flares, flares!", "Flares! Flares! Flares!", "Popping flares!", "Dumping flares!", "Flares, flares, flares!"] },
    "break": { c: ["{me}, breaking {dir}.", "Defensive, {dir} turn.", "Breaking {dir}.", "{me}, hard {dir}.", "Going defensive, {dir}."],
      h: ["Break {dir}! Break {dir}!", "Hard {dir}! Hard {dir}!", "Breaking {dir}, now!", "{me}, max G, {dir}!", "Pulling {dir}!"] },
    onsix: { c: ["{me}, bandit on my six.", "He's at my six, {rng} miles, defending.", "{me}, bandit in trail.", "He's behind me, working it.", "Defensive, bandit six o'clock."],
      h: ["He's on my six!", "Bandit on my tail! Can't shake him!", "Get him off me!", "He's right behind me!", "{me}, he's on my six!"] },
    tally6: { c: ["{me}, I'm on his six, closing for guns.", "In his six, pressing.", "Saddled up, closing.", "{me}, good position, his six.", "Rear quarter, closing for the shot."],
      h: ["I'm on his six! Closing for guns!", "Got him! Right on his tail!", "He's mine, I'm on his six!", "Closing! Guns, guns!", "Sitting on his six!"] },
    hit: { c: ["{me}, I'm hit.", "Taking damage.", "{me}, took a hit, still flying.", "Damage, systems holding.", "Hit, still in it."],
      h: ["Taking damage!", "I'm hit! I'm hit!", "Argh, he got me!", "Taking hits!", "{me}, I'm hit!"] },
    heavydamage: { c: ["{me}, I'm hit bad, need to break away.", "Heavy damage, losing hydraulics.", "{me}, badly damaged.", "Controls are sluggish, I'm hurt.", "Warning lights everywhere, I'm hit bad."],
      h: ["I'm hit bad! Need to break away!", "I'm losing it! Heavy damage!", "Fire light! I'm hurting!", "She's coming apart!", "{me}, I'm hit bad!"] },
    scored: { c: ["{me}, good hits.", "Hits on target.", "Good effect.", "Rounds on, he's smoking.", "{me}, scored."],
      h: ["Good hits!", "Got a piece of him!", "Hits! He's smoking!", "Yeah! Good hits!", "Nailed him!"] },
    lost: { c: ["{me}, lost tally.", "Target lost, searching.", "No joy, lost him.", "{me}, blind.", "Lost contact."],
      h: ["Lost tally!", "Where'd he go?", "I lost him!", "Target lost!", "He's gone, lost him!"] },
    reacquired: { c: ["{me}, tally again, {rng} miles.", "Reacquired.", "Got him back.", "{me}, contact again.", "Back on him, {rng} miles."],
      h: ["Got him again!", "There he is!", "Reacquired! Going after him!", "Tally again!", "Found him!"] },
    disengage: { c: ["{me}, disengaging.", "Bugging out, extending.", "{me}, target lost, disengaging.", "Extending, opening range.", "I'm out, disengaging."],
      h: ["Bugging out!", "I've gotta get out of here!", "Disengaging! Disengaging!", "Running for it!", "Extending, he's too hot!"] },
    merge: { c: ["{me}, merged.", "Merge, pulling into him.", "Through the merge, turning.", "{me}, merged, fight's on.", "Merging, lift vector on."],
      h: ["Merged! Merged!", "Here we go, merge!", "Through the merge, turning in!", "Fight's on!", "Merging! Pull, pull!"] },
    kill: { c: ["{me}, splash one.", "Target destroyed.", "{me}, splash one bandit.", "Good kill.", "Bandit destroyed, chute observed."],
      h: ["Splash one!", "Splash one! Splash one!", "Got him! Target destroyed!", "Scratch one bandit!", "Good kill, good kill!"] },
    killgun: { c: ["{me}, guns kill, splash one.", "Splash one, guns.", "Gun kill, target destroyed."], h: ["Guns kill! Splash one!", "Hosed him! Splash one!", "Shredded him with guns!"] },
    down: { c: ["{me}, ejecting.", "{me}, I'm going down. Ejecting.", "Mayday, {me}, punching out.", "That's it for me. Ejecting.", "{me} is down, eject, eject."],
      h: ["Ejecting!", "Eject! Eject! Eject!", "Mayday, mayday! I'm going down!", "I'm out! Punching out!", "{me} going down!"] },
    downground: { c: ["{me}, too low, pull up—", "{me}, ground—", "Terrain—"], h: ["Pull up! Pull up—", "No, no, no—", "Too low—"] },
    downcollide: { c: ["{me}, collision—", "Midair—"], h: ["Collision!", "He hit me—"] },
    downreact: { c: ["Bandit's down. He hit the ground.", "{me}, bandit impacted, no chute.", "He augered in. Fight's over."], h: ["He hit the deck! It's over!", "He's gone! Went right into the ground!", "Bandit's down!"] },
  };

  const digits = (n) => String(Math.round(((n % 360) + 360) % 360)).padStart(3, "0").split("").map((d) => DIG[+d]).join("-");

  RJ.csRadio = {
    create(M) {
      const S = () => RJ.settings || {};
      const save = () => { if (RJ.saveSettings) try { RJ.saveSettings(); } catch (e) { /* none */ } };
      const canSpeak = () => !!window.speechSynthesis && typeof SpeechSynthesisUtterance === "function";
      const realNow = () => (window.performance ? performance.now() : Date.now()) / 1000;

      /* ---------- personas ---------- */
      const pool = CALLS.slice();
      const pick = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const calmFirst = Math.random() < 0.5;
      const P = new Map();
      [M.A, M.B].forEach((ac, i) => {
        if (!ac) return;
        if (!ac.csCall) ac.csCall = pick() + " " + NUMW[i];
        const calm = i === 0 ? calmFirst : !calmFirst;
        P.set(ac, { ac, idx: i, call: ac.csCall, word: String(ac.callsign || "").split(" (")[0], calm,
          pitch: i === 0 ? 0.82 : 1.12, rate: calm ? 1.02 : 1.14, voice: null,
          last: {}, lastText: "", cool: {} });
      });
      let voicesPicked = false;
      function pickVoices() {
        if (voicesPicked || !canSpeak()) return;
        const vs = speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
        if (!vs.length) return;
        voicesPicked = true;
        const male = vs.filter((v) => /male|guy|david|mark|george|daniel|ryan|christopher|eric|fred|alex|james|tom|aaron|arthur|oliver/i.test(v.name) && !/female/i.test(v.name));
        const order = male.concat(vs.filter((v) => male.indexOf(v) < 0));
        const list = [...P.values()];
        if (list[0]) list[0].voice = order[0] || null;
        if (list[1]) list[1].voice = order.find((v) => v !== list[0].voice && v.lang !== (list[0].voice || {}).lang) || order[1] || order[0] || null;
      }

      /* ---------- radio sound (WebAudio) ---------- */
      const AU = RJ.audio || {};
      const ctx = AU.ctx || null;
      let out = null, noise = null;
      if (ctx && AU.master) {
        try {
          out = ctx.createGain(); out.gain.value = 0; out.connect(AU.master);
          noise = AU.white;
          if (!noise) {
            noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          }
        } catch (e) { out = null; }
      }
      const vol0 = S().csRadioVol;
      let vol = typeof vol0 === "number" && isFinite(vol0) ? Math.max(0, Math.min(1, vol0)) : 0.85;
      let mute = !!S().csRadioMute;
      const audible = () => !mute && !S().muted && vol > 0;
      function applyGain() { if (out) out.gain.setTargetAtTime(mute ? 0 : vol, ctx.currentTime, 0.03); }
      applyGain();

      function burst(t, dur, f0, f1, q, level) {
        const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = q;
        bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(level, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(bp).connect(g).connect(out);
        src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
      }
      function keyUp(bg) {
        if (!out) return;
        try {
          const t = ctx.currentTime + 0.005, k = bg ? 0.45 : 1;
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = "square"; o.frequency.value = 1750;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18 * k, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
          o.connect(g).connect(out); o.start(t); o.stop(t + 0.05);
          burst(t + 0.01, 0.09, 2600, 1500, 0.9, 0.22 * k);
        } catch (e) { /* none */ }
      }
      let bed = null;
      function bedStart(bg) {
        if (!out) return;
        bedStop(0.01);
        try {
          const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
          const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = bg ? 1500 : 1900; bp.Q.value = bg ? 2.6 : 0.8;
          const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = bg ? 700 : 350;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(bg ? 0.03 : 0.022, t + 0.06);
          // slow wobble for a live-carrier feel
          const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5 + Math.random() * 4; lg.gain.value = bg ? 0.012 : 0.006;
          lfo.connect(lg).connect(g.gain);
          src.connect(bp).connect(hp).connect(g).connect(out);
          src.start(t, Math.random() * 0.5); lfo.start(t);
          bed = { src, lfo, g };
        } catch (e) { bed = null; }
      }
      function bedStop(tc) {
        if (!bed) return;
        const b = bed; bed = null;
        try { const t = ctx.currentTime; b.g.gain.cancelScheduledValues(t); b.g.gain.setTargetAtTime(0.0001, t, tc || 0.03); b.src.stop(t + 0.3); b.lfo.stop(t + 0.3); } catch (e) { /* none */ }
      }
      function tail(bg) {
        if (!out) return;
        try { const t = ctx.currentTime + 0.01; burst(t, 0.2, 3200, 1100, bg ? 1.6 : 0.7, (bg ? 0.45 : 1) * 0.3); } catch (e) { /* none */ }
      }

      /* ---------- line building ---------- */
      function fill(tpl, p, e) {
        const d = e.data || {}, other = e.other || (M.other ? M.other(p.ac) : null);
        const rngM = d.range != null ? d.range : (other && other.pos && p.ac.pos ? p.ac.pos.distanceTo(other.pos) : 3000);
        const alt = d.alt != null ? d.alt : (other && other.pos ? other.pos.y : 3000);
        let clock = d.clock != null ? Math.round(d.clock) : 12; if (clock < 1 || clock > 12) clock = 12;
        return tpl
          .replace(/\{me\}/g, p.call)
          .replace(/\{bandit\}/g, "bandit")
          .replace(/\{brg\}/g, digits(d.bearing || 0))
          .replace(/\{rng\}/g, String(Math.max(1, Math.round(rngM / 1609.34))))
          .replace(/\{ang\}/g, String(Math.max(1, Math.round(alt * 3.28084 / 1000))))
          .replace(/\{clock\}/g, CLOCK[clock])
          .replace(/\{dir\}/g, e._dir || d.dir || "left")
          .replace(/\{fox\}/g, d.fox === "fox3" ? "Fox Three" : "Fox Two");
      }
      function choose(p, key) {
        const set = L[key]; if (!set) return null;
        const own = p.calm ? set.c : set.h, alt = p.calm ? set.h : set.c;
        let list = Math.random() < 0.75 ? own : alt;
        let opts = list.filter((s) => s !== p.last[key]);
        if (!opts.length) opts = own.concat(alt).filter((s) => s !== p.last[key]);
        const s = opts[Math.floor(Math.random() * opts.length)];
        p.last[key] = s; return s;
      }

      /* ---------- queue ---------- */
      let queue = [], cur = null, gapUntil = 0, ended = false, lastBg = -1e9, killSaid = new Set();
      const api = { lastLine: null };

      function incomingDir(ac, d) {
        const m = d && d.msl;
        if (m && m.pos && ac.pos && ac.right) {
          const dx = m.pos.x - ac.pos.x, dy = m.pos.y - ac.pos.y, dz = m.pos.z - ac.pos.z;
          return dx * ac.right.x + dy * ac.right.y + dz * ac.right.z >= 0 ? "right" : "left";
        }
        return Math.random() < 0.5 ? "left" : "right";
      }

      function enqueue(type, ac, e, key, delay) {
        const p = P.get(ac); if (!p) return;
        const now = realNow();
        if ((p.cool[type] || 0) > now) return;
        const tpl = choose(p, key || type); if (!tpl) return;
        let text = fill(tpl, p, e);
        if (text === p.lastText) { const t2 = choose(p, key || type); if (t2) text = fill(t2, p, e); if (text === p.lastText) return; }
        p.cool[type] = now + (COOL[type] || 4);
        const pri = PRI[type] || 1;
        // replace an older queued line of the same type from the same pilot
        queue = queue.filter((q) => !(q.p === p && q.type === type));
        queue.push({ p, type, text, pri, at: now + (delay || 0), born: now });
      }

      function valid(q, now) {
        const ac = q.p.ac;
        if (now - q.born > STALE[q.pri] + (q.at - q.born)) return false;
        if (ended && !/^(kill|down|downreact)$/.test(q.type)) return false;
        if (!ac.alive && q.type !== "down") return false;
        if (q.type === "downreact" && killSaid.has(ac)) return false;
        const primary = ac === M.sel;
        if (!primary && !BG_TYPES[q.type]) return false;
        return true;
      }

      function transmit(q, now) {
        const p = q.p, primary = p.ac === M.sel, bg = !primary;
        if (bg) lastBg = now;
        p.lastText = q.text;
        api.lastLine = { who: p.call, text: q.text, t: now, simT: M.t || 0, primary, ac: p.ac, type: q.type, color: p.ac.csColor };
        const est = 0.6 + q.text.length * 0.065 / p.rate;
        cur = { q, bg, start: now, speakAt: now + 0.13, spoke: false, done: false, deadline: now + est + 3, minEnd: now + est * 0.5 };
        if (audible()) { keyUp(bg); bedStart(bg); }
        if (!canSpeak() || !audible()) { cur.speakAt = Infinity; cur.deadline = now + est + 0.15; cur.silent = true; }
      }

      function speakNow(c) {
        pickVoices();
        const p = c.q.p;
        try {
          const u = new SpeechSynthesisUtterance(c.q.text);
          if (p.voice) { u.voice = p.voice; u.lang = p.voice.lang; }
          u.pitch = p.pitch * (c.bg ? 0.97 : 1);
          u.rate = p.rate * (c.q.pri >= 3 ? 1.05 : 1);
          u.volume = Math.max(0, Math.min(1, vol * (c.bg ? 0.45 : 1)));
          u.onend = u.onerror = () => { if (cur === c) c.done = true; };
          c.u = u;
          speechSynthesis.speak(u);
        } catch (e) { c.done = true; }
      }

      function endCur(now) {
        if (!cur) return;
        if (audible() && !cur.silent) tail(cur.bg);
        bedStop(0.05);
        cur = null; gapUntil = now + 0.35;
      }

      function cancelSpeech() {
        if (cur && cur.u && canSpeak()) { try { cur.u.onend = cur.u.onerror = null; speechSynthesis.cancel(); } catch (e) { /* none */ } }
      }

      api.onEvent = function (e) {
        if (!e || !e.type) return;
        const t = e.type, ac = e.ac, d = e.data || {};
        if (t === "select") {
          queue = [];
          if (cur) { cancelSpeech(); endCur(realNow()); gapUntil = 0; }
          return;
        }
        if (t === "nearmiss") return;
        if (t === "kill") {
          if (ac) killSaid.add(ac);
          ended = true;
          enqueue("kill", ac, e, d.cause === "gun" ? "killgun" : "kill", 0.5);
          return;
        }
        if (t === "down") {
          ended = true;
          queue = queue.filter((q) => /^(kill|down|downreact)$/.test(q.type) && q.p.ac !== ac);
          if (cur && cur.q.p.ac === ac && cur.q.type !== "down") { cancelSpeech(); endCur(realNow()); gapUntil = 0; }
          const c = d.cause;
          enqueue("down", ac, e, c === "terrain" || c === "water" ? "downground" : c === "collision" ? "downcollide" : "down");
          const w = M.other ? M.other(ac) : null;
          if (w && w.alive && !(d.by && d.by === w && (c === "missile" || c === "gun"))) enqueue("downreact", w, e, "downreact", 0.8);
          return;
        }
        if (ended || M.ended) return;
        if (t === "merge") { const s = M.sel || ac; if (s && s.alive) enqueue("merge", s, e); return; }
        if (!ac || !ac.alive || !PRI[t]) return;
        if (t === "defeated" || t === "incoming") {
          // a newer defensive call supersedes the opposite one
          queue = queue.filter((q) => !(q.p.ac === ac && (q.type === "incoming" || q.type === "defeated")));
        }
        if (t === "incoming") e._dir = incomingDir(ac, d);
        if (t === "heavydamage") queue = queue.filter((q) => !(q.p.ac === ac && q.type === "hit"));
        enqueue(t, ac, e);
      };

      api.update = function () {
        const now = realNow();
        if (cur) {
          if (!cur.spoke && now >= cur.speakAt) {
            cur.spoke = true;
            if (audible() && canSpeak()) speakNow(cur); else { cur.silent = true; cur.deadline = Math.min(cur.deadline, now + 0.5 + cur.q.text.length * 0.06); }
          }
          const finished = (cur.done && now >= cur.minEnd - 1) || now >= cur.deadline || (cur.silent && now >= cur.deadline);
          if (cur && !cur.silent && cur.spoke && cur.u && canSpeak() && !speechSynthesis.speaking && !speechSynthesis.pending && now > cur.speakAt + 0.6) cur.done = true;
          if (finished || (cur && cur.done)) endCur(now);
          if (cur) return;
        }
        if (now < gapUntil) return;
        queue = queue.filter((q) => valid(q, now));
        if (!queue.length) return;
        let best = null;
        for (const q of queue) {
          if (q.at > now) continue;
          const bg = q.p.ac !== M.sel;
          if (bg && !/^(kill|down|downreact)$/.test(q.type) && now - lastBg < BG_GAP) continue;
          if (!best || q.pri > best.pri || (q.pri === best.pri && q.at < best.at)) best = q;
        }
        if (!best) return;
        queue.splice(queue.indexOf(best), 1);
        // a background line that lost its slot never waits around
        if (best.p.ac !== M.sel) queue = queue.filter((q) => q.p.ac === M.sel || /^(kill|down|downreact)$/.test(q.type));
        transmit(best, now);
      };

      Object.defineProperty(api, "volume", {
        get: () => vol,
        set: (v) => { vol = Math.max(0, Math.min(1, +v || 0)); S().csRadioVol = vol; save(); applyGain(); if (cur && cur.u) try { cur.u.volume = vol * (cur.bg ? 0.45 : 1); } catch (e) { /* none */ } },
        enumerable: true,
      });
      Object.defineProperty(api, "muted", {
        get: () => mute,
        set: (m) => { mute = !!m; S().csRadioMute = mute; save(); applyGain(); if (mute && cur) { cancelSpeech(); cur.silent = true; bedStop(0.02); } },
        enumerable: true,
      });

      api.dispose = function () {
        queue = [];
        cancelSpeech();
        try { if (canSpeak()) speechSynthesis.cancel(); } catch (e) { /* none */ }
        bedStop(0.02); cur = null;
        if (out) { const o = out; out = null; try { o.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => { try { o.disconnect(); } catch (e) { /* none */ } }, 400); } catch (e) { /* none */ } }
      };

      if (canSpeak()) { pickVoices(); try { speechSynthesis.addEventListener && speechSynthesis.addEventListener("voiceschanged", pickVoices, { once: true }); } catch (e) { /* none */ } }
      return api;
    },
  };
})();
