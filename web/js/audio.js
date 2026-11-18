/* audio.js — SUNSET HEAT: every sound, synthesized with the WebAudio API (no files).
   GT.audio = { init, resume, setMaster, update, engine, setRadio, nextStation, siren, scanner, ambience, sfx, ... }
   China-edition "alive" layer (added, see the block before the public API): footstep(e), scooter(p), city(state), interior(v), setCategory(name, v), stats(), resetStats(), selftest(opts);
   sfx() gained footstep/cloth/gear/box_rattle/land/body_fall/kerb/kickstand/brake_squeal/scrape/scooter_crash/whoosh/bike_bell/scooter_beep/bus_door/boat_horn/bird/flap/mahjong/pickup/
   ui_phone/ui_card/sting_start/sting_complete/sting_fail/sting_ach, horn{weedy:true}, and any one-shot becomes positional with {x, y, z} (24 pooled PannerNodes, quietest stolen).
   Categories sfx / veh / amb / music / ui each have a gain before the master compressor + soft ceiling.
   All voices are written against a "rig" (context + buses + master chain) so the exact same graph code runs live
   (AudioContext) and in the verification page (OfflineAudioContext -> waveforms / spectrograms / peak / RMS).
   Signal flow:  engineBus ─┐
                 radioBus  ─┤
     worldIn → interiorLP → worldGain ─┼→ sum → master → compressor → trim → soft-knee ceiling (0.855) → out
                 cabinBus  ─┘            (reverb convolver returns into worldIn)                                    */
(function () {
  'use strict';
  const GT = window.GT = window.GT || {};
  GT.showcase = GT.showcase || {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const rngOf = seed => { if (GT.rng) return GT.rng(seed); let h = 1234567; return () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; }; };
  const RPM_IDLE = 720, RPM_MAX = 6200, CEIL = 0.855;

  /* ================================================================== shared sample data (cached per sample-rate) */
  const DATA = {};
  function noiseData(kind, sr) {
    const key = kind + sr; if (DATA[key]) return DATA[key];
    const n = Math.floor(sr * 3), d = new Float32Array(n), r = rngOf('noise-' + kind);
    if (kind === 'white') { for (let i = 0; i < n; i++) d[i] = r() * 2 - 1; }
    else if (kind === 'pink') { let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) { const w = r() * 2 - 1; b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852; b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926; } }
    else { let v = 0; for (let i = 0; i < n; i++) { v = (v + (r() * 2 - 1) * .02) * .998; d[i] = v; } }
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i])); const k = .95 / pk;
    const xf = Math.floor(sr * .05); for (let i = 0; i < n; i++) d[i] *= k;
    for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[n - xf + i] * (1 - a); }           // seamless loop
    return DATA[key] = d.subarray(0, n - xf);
  }
  /** outdoor "street" impulse: a few early slaps off buildings + a dark diffuse tail. Energy-normalised. */
  function impulseData(sr) {
    const key = 'ir' + sr; if (DATA[key]) return DATA[key];
    const n = Math.floor(sr * 1.7), d = new Float32Array(n), r = rngOf('impulse'); let lp = 0;
    for (let i = 0; i < n; i++) { const t = i / sr, a = Math.exp(-t * 3.4) * sstep(t, 0, .012), c = .5 * Math.exp(-t * 2.2) + .04; lp += c * ((r() * 2 - 1) - lp); d[i] = lp * a; }
    for (const [ms, g] of [[23, .5], [41, -.38], [67, .3], [103, -.22], [151, .16]]) { const i = Math.floor(sr * ms / 1000); d[i] += g; d[i + 1] += g * .5; }
    let e = 0; for (let i = 0; i < n; i++) e += d[i] * d[i]; const k = 1 / Math.sqrt(e); for (let i = 0; i < n; i++) d[i] *= k;
    return DATA[key] = d;
  }
  /** per-firing amplitude pattern of a lumpy-cam V8 at idle: 4 s at idle speed (192 firings), smooth steps, zero-mean, ±1. */
  function lopeData(sr) {
    const key = 'lope' + sr; if (DATA[key]) return DATA[key];
    const r = rngOf('lope'), nf = 192, amp = new Float32Array(nf), pat = [1, .8, .96, .66, 1, .76, .9, .7];
    for (let i = 0; i < nf; i++) { amp[i] = pat[i % 8] * (.86 + r() * .28); if (r() < .07) amp[i] *= .42; }              // the occasional soft cylinder
    const n = Math.floor(sr * 4), d = new Float32Array(n); let mean = 0;
    for (let i = 0; i < n; i++) { const p = i / n * nf, k = Math.floor(p), f = p - k, s = f < .25 ? .5 - .5 * Math.cos(f / .25 * Math.PI) : 1;
      d[i] = lerp(amp[(k + nf - 1) % nf], amp[k % nf], s); mean += d[i]; }
    mean /= n; let pk = 0; for (let i = 0; i < n; i++) { d[i] -= mean; pk = Math.max(pk, Math.abs(d[i])); } for (let i = 0; i < n; i++) d[i] /= pk;
    return DATA[key] = d;
  }
  /** small tiled room: dense early reflections, 0.4 s bright tail. Energy-normalised. */
  function roomData(sr) {
    const key = 'room' + sr; if (DATA[key]) return DATA[key];
    const n = Math.floor(sr * .42), d = new Float32Array(n), r = rngOf('room'); let lp = 0;
    for (let i = 0; i < n; i++) { const t = i / sr, a = Math.exp(-t * 13) * sstep(t, 0, .004); lp += .55 * ((r() * 2 - 1) - lp); d[i] = lp * a; }
    for (const [ms, g] of [[5, .55], [9, -.4], [14, .34], [21, -.26], [29, .2], [38, -.14]]) { const i = Math.floor(sr * ms / 1000); d[i] += g; }
    let e = 0; for (let i = 0; i < n; i++) e += d[i] * d[i]; const k = 1 / Math.sqrt(e); for (let i = 0; i < n; i++) d[i] *= k;
    return DATA[key] = d;
  }
  const CAT_DEFAULT = { sfx: 1, veh: .85, amb: .5, music: .7, ui: .8 };
  function bufOf(ac, data) { const b = ac.createBuffer(1, data.length, ac.sampleRate); b.getChannelData(0).set(data); return b; }
  function curveOf(fn, n) { n = n || 2048; const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = fn(i / (n - 1) * 2 - 1); return c; }

  /* ================================================================== node helpers */
  function G(R, v) { const n = R.ac.createGain(); n.gain.value = v; return n; }
  function BQ(R, type, f, q, gain) { const n = R.ac.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q !== undefined) n.Q.value = q; if (gain !== undefined) n.gain.value = gain; return n; }
  function SH(R, fn, os) { const n = R.ac.createWaveShaper(); n.curve = curveOf(fn); if (os) n.oversample = os; return n; }
  function chain() { for (let i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); return arguments[arguments.length - 1]; }
  function OSC(R, type, f, t0, t1) { const o = R.ac.createOscillator(); if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type); o.frequency.value = f; o.start(t0 || 0); if (t1 !== undefined) o.stop(t1); return o; }
  function NOISE(R, kind, t0, t1, rate) { const s = R.ac.createBufferSource(); s.buffer = R[kind || 'white']; s.loop = true; if (rate) s.playbackRate.value = rate; s.start(t0 || 0, R.rnd() * 2); if (t1 !== undefined) s.stop(t1); return s; }
  function tgt(p, v, t, tc) { if (tc > 0) p.setTargetAtTime(v, t, tc); else p.setValueAtTime(v, t); }
  /** attack / hold / exponential decay on a gain param. returns the end time. */
  function env(p, t, a, h, d, peak) {
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a); if (h > 0) p.setValueAtTime(peak, t + a + h);
    p.exponentialRampToValueAtTime(Math.max(peak * .001, 1e-5), t + a + h + d); p.linearRampToValueAtTime(0, t + a + h + d + .004); return t + a + h + d + .006;
  }
  /** one enveloped oscillator note. o: {type|wave, f, f1, ft, det, mod, lp, lp1, lpt, q, a, h, d, g} */
  function tone(R, dest, t, o) {
    const ac = R.ac, os = ac.createOscillator(), g = ac.createGain();
    if (o.wave) os.setPeriodicWave(o.wave); else os.type = o.type || 'sine';
    os.frequency.setValueAtTime(o.f, t); if (o.f1) os.frequency.exponentialRampToValueAtTime(o.f1, t + (o.ft || o.d || .1));
    if (o.det) os.detune.value = o.det; if (o.mod) o.mod.connect(os.detune);
    let last = os;
    if (o.lp) { const f = BQ(R, 'lowpass', o.lp, o.q || .7); if (o.lp1) { f.frequency.setValueAtTime(o.lp, t); f.frequency.exponentialRampToValueAtTime(o.lp1, t + (o.lpt || o.d || .1)); } os.connect(f); last = f; }
    last.connect(g); g.connect(dest);
    const end = env(g.gain, t, o.a === undefined ? .003 : o.a, o.h || 0, o.d || .1, o.g === undefined ? .5 : o.g);
    os.start(t); os.stop(end + .02); return end;
  }
  /** one enveloped filtered-noise burst. o: {kind, type, f, f1, ft, q, a, h, d, g} */
  function nz(R, dest, t, o) {
    const ac = R.ac, s = ac.createBufferSource(), f = BQ(R, o.type || 'bandpass', o.f || 1000, o.q === undefined ? 1 : o.q), g = ac.createGain();
    s.buffer = R[o.kind || 'white']; s.loop = true;
    if (o.f1) { f.frequency.setValueAtTime(o.f, t); f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.ft || o.d || .1)); }
    s.connect(f); f.connect(g); g.connect(dest);
    const end = env(g.gain, t, o.a === undefined ? .002 : o.a, o.h || 0, o.d || .05, o.g === undefined ? .5 : o.g);
    s.start(t, R.rnd() * 2); s.stop(end + .02); return end;
  }
  /** 0..1 control signal: a sine LFO pushed through a smoothstep so it becomes a soft gate (duty set by thresh). */
  function gate(R, hz, thresh, width, phaseType) { const o = OSC(R, phaseType || 'sine', hz, 0), s = SH(R, x => sstep(x, thresh - width, thresh + width)); o.connect(s); return s; }

  /* ================================================================== rig: buses + master chain */
  function makeRig(ac, offline, seed) {
    const R = { ac, offline: !!offline, rnd: rngOf(seed || 'audio-live') }, sr = ac.sampleRate;
    R.white = bufOf(ac, noiseData('white', sr)); R.pink = bufOf(ac, noiseData('pink', sr)); R.brown = bufOf(ac, noiseData('brown', sr));
    R.sum = G(R, 1); R.master = G(R, .8);
    R.comp = ac.createDynamicsCompressor(); R.comp.threshold.value = -15; R.comp.knee.value = 10; R.comp.ratio.value = 5; R.comp.attack.value = .004; R.comp.release.value = .22;
    R.trim = G(R, .8);                                                                       // tames Chrome's automatic make-up gain
    R.clip = SH(R, x => { const a = Math.abs(x), k = CEIL - .6; return Math.sign(x) * (a <= .6 ? a : .6 + k * Math.tanh((a - .6) / k)); });   // linear to 0.6, never above 0.855
    chain(R.sum, R.master, R.comp, R.trim, R.clip);
    if (offline === 'stereo') R.clip.connect(ac.destination);                                  // selftest(): the real stereo output, measured on both channels
    else if (offline) { const m = ac.createChannelMerger(2); R.clip.connect(m, 0, 0); R.sum.connect(m, 0, 1); m.connect(ac.destination); } else R.clip.connect(ac.destination);
    /* categories: every voice reaches the sum through exactly one of these (world voices through the w* twin, which sits before the interior low-pass).
       sfx = player + impacts, veh = engines / tyres / horns / sirens, amb = the city bed, music = radio + dance speaker + stings, ui = prompts / phone / cash */
    R.cat = {}; R.wcat = {}; R.catV = Object.assign({}, CAT_DEFAULT);
    for (const k in CAT_DEFAULT) { R.cat[k] = G(R, CAT_DEFAULT[k]); R.cat[k].connect(R.sum); }
    R.engineBus = G(R, 1); R.radioBus = G(R, 1); R.cabinBus = G(R, 1); R.worldIn = G(R, 1); R.uiBus = G(R, 1); R.musicBus = G(R, 1); R.selfBus = G(R, 1);
    R.inLP = BQ(R, 'lowpass', 18000, .5); R.worldGain = G(R, 1);
    R.engineBus.connect(R.cat.veh); R.radioBus.connect(R.cat.music); R.cabinBus.connect(R.cat.sfx); R.uiBus.connect(R.cat.ui); R.musicBus.connect(R.cat.music); R.selfBus.connect(R.cat.sfx);
    chain(R.worldIn, R.inLP, R.worldGain, R.sum);
    for (const k of ['sfx', 'veh', 'amb', 'music']) { R.wcat[k] = G(R, CAT_DEFAULT[k]); R.wcat[k].connect(R.worldIn); }
    R.verbIn = G(R, 1); R.verb = ac.createConvolver(); R.verb.normalize = false; R.verb.buffer = bufOf(ac, impulseData(sr)); chain(R.verbIn, R.verb, G(R, .9), R.worldIn);
    // the player's own sounds (footsteps, cloth, landing) get the street slap outdoors and a short bright room indoors
    R.room = ac.createConvolver(); R.room.normalize = false; R.room.buffer = bufOf(ac, roomData(sr)); R.roomIn = G(R, 1); chain(R.roomIn, R.room, G(R, .8), R.cat.sfx);
    R.selfStreet = G(R, .1); R.selfRoom = G(R, 0); chain(R.selfBus, R.selfStreet, R.verbIn); chain(R.selfBus, R.selfRoom, R.roomIn);
    R.pool = makePool(R, 24);
    return R;
  }

  /* ================================================================== ENGINE — cross-plane muscle V8 */
  function makeEngine(R) {
    const ac = R.ac, E = { rpm: 0, load: 0, on: false, speed: 0, popAcc: 0, prevRpm: 0 }, idleCrank = RPM_IDLE / 60;
    const crank = ac.createConstantSource(); crank.offset.value = idleCrank; crank.start();        // crankshaft Hz; every pitch hangs off this one param
    const crankW = G(R, 1); crank.connect(crankW);                                                // + idle hunting wobble
    // per-firing lope pattern, time-locked to the crank
    const lope = ac.createBufferSource(); lope.buffer = bufOf(ac, lopeData(ac.sampleRate)); lope.loop = true; lope.playbackRate.value = 0; chain(crank, G(R, 1 / idleCrank), lope.playbackRate); lope.start();
    const wob = G(R, .3); chain(lope, BQ(R, 'lowpass', 2.5, .5), wob, crankW);
    // the cycle wave: fundamental = one 720° engine cycle (crank/2). harmonic 8 = firing frequency; half-orders give the V8 burble
    const NH = 64, re = new Float32Array(NH + 1), im = new Float32Array(NH + 1), pr = rngOf('v8');
    for (let n = 1; n <= NH; n++) { const cls = n % 8 === 0 ? 1 : n % 4 === 0 ? .55 : n % 2 === 0 ? .3 : .17, roll = n < 8 ? (n === 1 ? .5 : 1) : Math.pow(n / 8, -1.05), ph = pr() * 6.283; re[n] = cls * roll * Math.cos(ph); im[n] = cls * roll * Math.sin(ph); }
    const cycWave = ac.createPeriodicWave(re, im);
    const pre = G(R, 1);
    const voice = (type, mult, det, g) => { const o = OSC(R, type, 0, 0); o.detune.value = det; chain(crankW, G(R, mult), o.frequency); chain(o, G(R, g), pre); return o; };
    voice(cycWave, .5, 0, .62);              // full cycle wave
    voice('sawtooth', 4, 7, .2);             // firing order
    voice('sawtooth', 2, -9, .15);           // one bank
    voice('square', 1, 5, .06);              // crank order pulse
    voice('sawtooth', 4, -11, .1);           // detuned twin of the firing saw → slow beating
    const lopeG = G(R, 1), lopeDepth = G(R, .4); chain(lope, lopeDepth, lopeG.gain);
    const driveIn = G(R, 1), shaper = SH(R, x => Math.tanh(2.2 * x) / Math.tanh(2.2), '2x'), post = G(R, 1);
    chain(pre, lopeG, driveIn, shaper);
    chain(shaper, G(R, .32), post);
    for (const [f, q, g] of [[92, 1.4, 1], [205, 2.2, .8], [410, 2.6, .62], [860, 3, .5], [1850, 3, .3], [3100, 2.5, .14]]) chain(shaper, BQ(R, 'bandpass', f, q), G(R, g), post);   // exhaust / body formants
    // exhaust rasp: noise ring-modulated by the firing pulses
    const rasp = G(R, 0), raspDepth = G(R, 0), raspBP = BQ(R, 'bandpass', 900, .7), fsaw = OSC(R, 'sawtooth', 0, 0); chain(crankW, G(R, 4), fsaw.frequency); chain(fsaw, raspDepth, rasp.gain);
    chain(NOISE(R, 'white', 0), raspBP, rasp, post);
    const lp = BQ(R, 'lowpass', 600, .9), lp2 = BQ(R, 'lowpass', 1200, .5), level = G(R, .5), out = G(R, 0);
    chain(post, lp, lp2, level, out, R.engineBus);
    // intake roar
    const intakeBP = BQ(R, 'bandpass', 700, 1.3), intake = G(R, 0); chain(NOISE(R, 'pink', 0), intakeBP, intake, out);
    // overrun pops go round the tone filters
    const popBus = G(R, 1); chain(popBus, BQ(R, 'lowpass', 2600, .7), out);
    // road + wind (not gated by ignition)
    const road = G(R, 0), roadLP = BQ(R, 'lowpass', 300, .6), wind = G(R, 0), windBP = BQ(R, 'bandpass', 700, .6);
    chain(NOISE(R, 'brown', 0), roadLP, road, R.engineBus); chain(NOISE(R, 'pink', 0), windBP, wind, R.engineBus);

    /** p: {on, rpm 0..1, load 0..1, speed m/s}; t = context time; tc = smoothing time-constant (0 = jump). */
    E.set = function (p, t, tc) {
      t = t === undefined ? ac.currentTime : t; tc = tc === undefined ? .06 : tc;
      const rpm = clamp(+p.rpm || 0, 0, 1), load = clamp(+p.load || 0, 0, 1), on = !!p.on, sp = Math.abs(+p.speed || 0), hz = lerp(RPM_IDLE, RPM_MAX, rpm) / 60;
      E.rpm = rpm; E.load = load; E.on = on; E.speed = sp;
      tgt(crank.offset, hz, t, tc);
      const idle = 1 - sstep(rpm, .02, .3);
      tgt(lopeDepth.gain, .06 + .56 * idle * (1 - .5 * load), t, tc); tgt(wob.gain, .5 * idle, t, tc);
      tgt(driveIn.gain, .75 + 1.5 * load + .5 * rpm, t, tc);
      tgt(level.gain, .34 / (1 + .55 * load + .25 * rpm), t, tc);                                     // loudness comes from brightness + out gain, not from the shaper
      tgt(lp.frequency, 560 + 1000 * rpm + 5600 * load * (.3 + .7 * rpm), t, tc); tgt(lp2.frequency, 1100 + 2600 * rpm + 6000 * load, t, tc);
      tgt(raspBP.frequency, 500 + 2200 * rpm, t, tc); tgt(raspDepth.gain, (.3 + .7 * load) * (.3 + .4 * rpm), t, tc);
      tgt(intakeBP.frequency, 420 + 1300 * rpm, t, tc); tgt(intake.gain, load * rpm * rpm * .42, t, tc);
      tgt(out.gain, on ? .66 + .8 * load + .6 * rpm : 0, t, on ? Math.min(tc, .05) : .09);
      const s = clamp(sp / 45, 0, 1);
      tgt(road.gain, .5 * Math.pow(s, 1.3), t, .2); tgt(roadLP.frequency, 180 + 520 * s, t, .2); tgt(wind.gain, .16 * s * s, t, .2); tgt(windBP.frequency, 500 + 1300 * s, t, .2);
    };
    /** one exhaust pop / crackle. */
    E.pop = function (t, strength) {
      const s = strength === undefined ? 1 : strength, f = 160 + R.rnd() * 420;
      nz(R, popBus, t, { kind: 'white', f, q: 1.6, a: .001, d: .028 + R.rnd() * .05, g: (.8 + R.rnd() * 1.1) * s });
      tone(R, popBus, t, { type: 'triangle', f: 150 + R.rnd() * 60, f1: 55, ft: .05, a: .001, d: .06, g: .6 * s });
    };
    /** live: decide when the overrun burble fires (throttle shut while revs are up / falling). */
    E.update = function (dt) {
      if (!E.on) { E.prevRpm = E.rpm; return; }
      const falling = (E.prevRpm - E.rpm) / Math.max(dt, 1e-3); E.prevRpm = E.rpm;
      const over = E.load < .08 && E.rpm > .22 ? (.35 + clamp(falling * 2.5, 0, 1)) * sstep(E.rpm, .22, .6) : 0;
      if (over > 0) { E.popAcc += dt * (5 + 16 * over); while (E.popAcc > 1) { E.popAcc -= 1; if (R.rnd() < .8) E.pop(ac.currentTime + .005 + R.rnd() * .06, .5 + .5 * over); } } else E.popAcc = 0;
    };
    E.set({ on: false, rpm: 0, load: 0, speed: 0 }, 0, 0);
    return E;
  }

  /* ================================================================== RADIO — three original procedural stations through a car stereo */
  const I = {
    kick(R, d, t, g, o) { o = o || {}; tone(R, d, t, { f: o.f || 155, f1: o.f1 || 44, ft: o.ft || .08, a: .001, h: .02, d: o.d || .22, g }); nz(R, d, t, { type: 'highpass', f: 1800, q: .5, a: .0005, d: .008, g: g * .35 }); },
    snare(R, d, t, g, o) { o = o || {}; tone(R, d, t, { type: 'triangle', f: o.f || 215, f1: 150, ft: .05, a: .001, d: .09, g: g * .5 }); nz(R, d, t, { type: 'bandpass', f: o.nf || 2400, q: .6, a: .001, d: o.d || .15, g: g * .8 }); },
    clap(R, d, t, g) { for (const dt of [0, .011, .023]) nz(R, d, t + dt, { f: 1350, q: 1.1, a: .001, d: .012, g: g * .6 }); nz(R, d, t + .03, { f: 1500, q: .9, a: .001, d: .13, g: g * .7 }); },
    hat(R, d, t, g, open) { nz(R, d, t, { type: 'highpass', f: 7200, q: .8, a: .001, d: open ? .2 : .032, g }); },
    rim(R, d, t, g) { tone(R, d, t, { type: 'square', f: 1750, a: .0005, d: .018, g: g * .3 }); nz(R, d, t, { f: 2600, q: 2, a: .0005, d: .02, g: g * .5 }); },
    shaker(R, d, t, g) { nz(R, d, t, { f: 6200, q: 1.4, a: .012, d: .04, g }); },
    funkBass(R, d, t, m, len, g) { const f = mtof(m); tone(R, d, t, { type: 'sawtooth', f, lp: 1900, lp1: 260, lpt: .14, q: 5, a: .003, h: len * .6, d: len * .4 + .04, g: g * .6 }); tone(R, d, t, { type: 'square', f: f * 2, lp: 900, q: 1, a: .003, h: len * .5, d: .06, g: g * .12 }); tone(R, d, t, { f, a: .004, h: len * .7, d: .08, g: g * .55 }); },
    subBass(R, d, t, m, len, g) { const f = mtof(m); tone(R, d, t, { f: f * 1.5, f1: f, ft: .03, a: .004, h: len, d: .14, g }); tone(R, d, t, { type: 'triangle', f: f * 2, a: .004, h: len, d: .1, g: g * .22 }); },
    stab(R, d, t, notes, len, g, mod) { for (const m of notes) for (const det of [-8, 8]) tone(R, d, t, { type: 'sawtooth', f: mtof(m), det, mod, lp: 3400, lp1: 650, lpt: len + .1, q: 2.2, a: .004, h: len, d: .14, g }); },
    rhodes(R, d, t, notes, len, g, mod) { for (const m of notes) { const f = mtof(m); tone(R, d, t, { f, mod, a: .006, h: len * .3, d: len * .9 + .3, g }); tone(R, d, t, { f: f * 2, mod, a: .004, d: .35, g: g * .22 }); tone(R, d, t, { f: f * 5.02, mod, a: .002, d: .07, g: g * .2 }); } },
    pluck(R, d, t, m, g) { const f = mtof(m); tone(R, d, t, { f, a: .002, d: .3, g }); tone(R, d, t, { f: f * 4, a: .001, d: .05, g: g * .3 }); tone(R, d, t, { type: 'triangle', f: f * 2, a: .002, d: .12, g: g * .25 }); },
    leadSq(R, d, t, m, len, g) { const f = mtof(m); for (const det of [-6, 6]) tone(R, d, t, { type: 'square', f: f * 1.03, f1: f, ft: .03, det, lp: 3200, lp1: 1500, lpt: len + .1, q: 1.5, a: .008, h: len, d: .16, g }); },
    leadSine(R, d, t, m, len, g, mod) { const f = mtof(m); tone(R, d, t, { f, mod, a: .02, h: len, d: .4, g }); tone(R, d, t, { type: 'triangle', f: f * 2, mod, a: .02, h: len * .5, d: .2, g: g * .15 }); }
  };
  /** generated lead line: a 2-bar motif walked through a scale, repeated with small variations in the bars where active(bar) is true. */
  function genLead(seed, scale, nBars, dens, active) {
    const r = rngOf(seed), ev = {}, motif = []; let idx = Math.floor(scale.length / 2);
    for (let s = 0; s < 32; s++) { const p = s % 4 === 0 ? dens * 1.3 : s % 2 === 0 ? dens * .8 : dens * .32; if (r() < p) { idx = clamp(idx + Math.round((r() - .5) * 4.4), 0, scale.length - 1); motif.push({ s, idx, len: 1 + Math.floor(r() * 3) }); } }
    for (let b = 0; b < nBars; b += 2) { if (!active(b)) continue; const up = r() < .5 ? -1 : 1, drop = r();
      for (const n of motif) { let id = n.idx; if (b % 4 === 2 && n.s >= 20) id = clamp(id + up * (1 + (n.s > 27 ? 1 : 0)), 0, scale.length - 1); if (b % 8 === 6 && n.s % 4 === 3 && drop < .6) continue; ev[b * 16 + n.s] = { m: scale[id], len: n.len }; } }
    return ev;
  }
  const pat = (s, i) => s.charCodeAt(i) !== 46;      // '.' = rest
  const STATIONS = [
    { name: 'CORAL 98.1', tag: 'sunset synth-funk', bpm: 108, swing: .1, bars: 16, gain: .8,
      ch: [[38, [53, 57, 60, 64]], [38, [53, 57, 60, 64]], [43, [53, 57, 59, 64]], [43, [53, 57, 59, 64]], [36, [52, 55, 59, 62]], [36, [52, 55, 59, 62]], [33, [55, 59, 60, 64]], [40, [56, 59, 62, 67]]],
      lead: genLead('coral', [62, 64, 65, 67, 69, 72, 74, 76, 77, 79, 81], 16, .5, b => (b >= 4 && b < 8) || b >= 12),
      step(R, d, i, t, sd) { const bar = Math.floor(i / 16) % 16, s = i % 16, b8 = bar % 8, c = this.ch[b8], odd = bar & 1, fill = b8 === 7;
        if (pat(fill ? 'x.....x.x.....x.' : odd ? 'x.....x.x.x.....' : 'x.....x.x.......', s)) I.kick(R, d, t, .8);
        if (s === 4 || s === 12) { I.snare(R, d, t, .42); I.clap(R, d, t, .34); } if (fill && s >= 13) I.snare(R, d, t, .2 + (s - 13) * .08, { f: 240 });
        if (bar === 15 && s === 10) I.snare(R, d, t, .25);
        if (pat('x.xxx.xxx.xxx.xx', s)) I.hat(R, d, t, s % 4 === 2 ? .2 : s % 2 ? .07 : .12, s % 4 === 2 && (odd || s === 14));
        const bp = odd ? { 0: 0, 2: 12, 3: 0, 6: 10, 8: 0, 11: 7, 12: 10, 14: 0, 15: 12 } : { 0: 0, 3: 0, 6: 12, 8: 0, 10: 7, 11: 10, 14: 12 };
        if (bp[s] !== undefined) I.funkBass(R, d, t, c[0] + bp[s], sd * (bp[s] === 12 ? .5 : .9), .5);
        if (s === 2 || s === 7 || s === 10 || (odd && s === 13)) I.stab(R, d, t, c[1], sd * (s === 7 ? 1.6 : .7), .045);
        const L = this.lead[bar * 16 + s]; if (L) I.leadSq(R, d, t, L.m, sd * L.len * .8, .075); } },
    { name: 'MAREA 104.5', tag: 'slow dembow', bpm: 92, swing: 0, bars: 16, gain: .8,
      ch: [[43, [55, 58, 62]], [43, [55, 58, 62]], [39, [55, 58, 63]], [39, [55, 58, 63]], [36, [55, 60, 63]], [36, [55, 60, 63]], [38, [54, 57, 62]], [38, [54, 57, 60]]],
      lead: genLead('marea', [67, 69, 70, 72, 74, 75, 77, 79, 81, 82], 16, .42, b => b >= 4 && b !== 8 && b !== 10),
      step(R, d, i, t, sd) { const bar = Math.floor(i / 16) % 16, s = i % 16, b8 = bar % 8, c = this.ch[b8], odd = bar & 1;
        if (s % 4 === 0) I.kick(R, d, t, .85, { f: 130, f1: 40, d: .3 });
        if (s === 3 || s === 6 || s === 11 || s === 14) { I.snare(R, d, t, s === 6 || s === 14 ? .5 : .36, { f: 250, nf: 3000, d: .1 }); if (s === 6 || s === 14) I.rim(R, d, t, .4); }
        if (b8 === 7 && s >= 12) I.snare(R, d, t, .18 + (s - 12) * .07, { f: 300, nf: 3400, d: .06 });
        if (s % 2 === 0) I.shaker(R, d, t, s % 4 === 2 ? .16 : .09); else if (odd) I.shaker(R, d, t, .05);
        if (odd && (s === 7 || s === 15)) I.rim(R, d, t, .3);
        const bp = { 0: 0, 3: 0, 6: 12, 8: 0, 11: 0, 14: b8 === 7 ? 5 : 7 }; if (bp[s] !== undefined) I.subBass(R, d, t, c[0] + bp[s] - 12, sd * (s === 0 || s === 8 ? 2 : 1), .3);
        const ar = { 2: 0, 5: 1, 8: 2, 10: 1, 13: 2 }; if (ar[s] !== undefined && bar >= 2) I.pluck(R, d, t, c[1][ar[s]] + (s === 13 ? 12 : 0), .17);
        if (s === 0 && bar % 2 === 0) I.rhodes(R, d, t, c[1], sd * 10, .045);
        const L = this.lead[bar * 16 + s]; if (L) { I.pluck(R, d, t, L.m, .24); I.leadSine(R, d, t, L.m, sd * L.len * .5, .06); } } },
    { name: 'LOW TIDE 88.3', tag: 'hazy lo-fi', bpm: 74, swing: .22, bars: 16, gain: 1.05, wow: true,
      ch: [[41, [57, 60, 64, 67]], [41, [57, 60, 64, 67]], [40, [55, 59, 62, 66]], [40, [55, 59, 62, 67]], [38, [53, 57, 60, 64]], [38, [53, 57, 60, 64]], [36, [52, 55, 59, 62]], [36, [52, 55, 59, 64]]],
      lead: genLead('lowtide', [67, 69, 72, 74, 76, 79, 81, 84], 16, .26, b => b >= 2 && b !== 8),
      step(R, d, i, t, sd, RD) { const bar = Math.floor(i / 16) % 16, s = i % 16, b8 = bar % 8, c = this.ch[b8], odd = bar & 1, r = R.rnd;
        if (pat(odd ? 'x.........x..x..' : 'x......x..x.....', s)) I.kick(R, d, t, .75, { f: 120, f1: 46, d: .26 });
        if (s === 4 || s === 12) I.snare(R, d, t + .012, .4, { f: 185, nf: 1500, d: .17 });
        if (b8 === 7 && s === 15) I.snare(R, d, t, .2, { f: 185, nf: 1500, d: .1 });
        if (s % 2 === 0) I.hat(R, d, t, s % 4 === 2 ? .13 : .08, false); else if (s === 7 || s === 15) I.hat(R, d, t, .05, false);
        if (s === 0) I.rhodes(R, d, t, c[1], sd * 7, .12, RD.wow); if (s === 10) I.rhodes(R, d, t, c[1].slice(1), sd * 3, .08, RD.wow);
        if (s === 0 || s === 10) I.subBass(R, d, t, c[0] - (c[0] > 39 ? 12 : 0) + 12, sd * (s === 0 ? 5 : 3), .12); if (s === 7) I.subBass(R, d, t, c[0] + 7, sd * 1.5, .09);
        const L = this.lead[bar * 16 + s]; if (L) I.leadSine(R, d, t, L.m, sd * L.len, .12, RD.wow);
        if (s === 0) nz(R, d, t, { kind: 'pink', type: 'highpass', f: 2500, q: .5, a: .05, h: sd * 16 - .1, d: .06, g: .022 });                 // tape hiss, bar-long
        const nc = r() < .6 ? 1 + Math.floor(r() * 2) : 0; for (let k = 0; k < nc; k++) nz(R, d, t + r() * sd, { type: 'highpass', f: 1500 + r() * 3000, q: .7, a: .0003, d: .003 + r() * .004, g: .06 + r() * .12 }); } }   // vinyl crackle
  ];
  function makeRadio(R) {
    const ac = R.ac, RD = { on: false, idx: 0, step: 0, next: 0 };
    RD.in = G(R, 1); RD.music = G(R, 1); RD.pre = G(R, 1); RD.vol = G(R, 0);
    // car stereo: door-speaker band limits, a boxy mid bump, mild amp saturation
    chain(RD.in, RD.music, RD.pre, BQ(R, 'highpass', 62, .8), BQ(R, 'lowpass', 5200, .7), BQ(R, 'peaking', 1500, .9, 3), BQ(R, 'peaking', 160, 1, 2.5),
      SH(R, x => Math.tanh(1.5 * x) / Math.tanh(1.5)), RD.vol, R.radioBus);
    const wowL = OSC(R, 'sine', .45, 0), flut = OSC(R, 'sine', 5.3, 0); RD.wow = G(R, 1); chain(wowL, G(R, 11), RD.wow); chain(flut, G(R, 2.5), RD.wow);   // tape wow & flutter (cents)
    RD.play = function (idx, t, startStep) { RD.idx = ((idx % STATIONS.length) + STATIONS.length) % STATIONS.length; RD.step = startStep | 0; RD.next = t; RD.on = true; RD.in.gain.setValueAtTime(STATIONS[RD.idx].gain, t); };
    RD.stop = function () { RD.on = false; };
    /** schedule every 16th-note whose time is < until. */
    RD.tick = function (until) { if (!RD.on) return; const st = STATIONS[RD.idx], sd = 60 / st.bpm / 4; let guard = 0;
      while (RD.next < until && guard++ < 400) { st.step(R, RD.in, RD.step, RD.next + (RD.step & 1 ? st.swing * sd : 0), sd, RD); RD.step++; RD.next += sd; } };
    /** tuning burst: inter-station static sweeping past carriers, a heterodyne whistle and a couple of crackles (≈0.34 s). */
    RD.tune = function (t) {
      nz(R, RD.pre, t, { f: 900, f1: 3400, ft: .2, q: .9, a: .012, h: .2, d: .1, g: .3 }); nz(R, RD.pre, t + .04, { kind: 'pink', type: 'lowpass', f: 1400, q: .7, a: .02, h: .14, d: .1, g: .22 });
      tone(R, RD.pre, t + .03, { f: 3100, f1: 420, ft: .16, a: .01, h: .08, d: .08, g: .055 }); tone(R, RD.pre, t + .2, { f: 380, f1: 2400, ft: .1, a: .01, h: .04, d: .06, g: .04 });
      for (const dt of [.015, .13, .27]) nz(R, RD.pre, t + dt, { type: 'highpass', f: 900, q: .5, a: .0005, d: .012, g: .35 });
    };
    /** duck the music, play static, restart on another station mid-song. */
    RD.switchTo = function (idx, t, startStep) { const g = RD.music.gain; g.cancelScheduledValues(t); g.setTargetAtTime(0, t, .008); RD.tune(t + .02); g.setTargetAtTime(1, t + .33, .025); RD.play(idx, t + .34, startStep); };
    return RD;
  }

  /* ================================================================== SIREN — wail / yelp, doppler, distance filtering */
  function makeSiren(R) {
    const ac = R.ac, S = {}, lp = BQ(R, 'lowpass', 9000, .6), out = G(R, 0), send = G(R, .2), units = [];
    chain(lp, out, R.wcat.veh); chain(out, send, R.verbIn);
    for (let i = 0; i < 2; i++) {
      const o1 = OSC(R, 'sawtooth', 0, 0), o2 = OSC(R, 'square', 0, 0), base = ac.createConstantSource(); base.offset.value = 1010 * (1 + i * .045); base.start();
      const wail = OSC(R, 'sine', .21 + i * .035, 0), wd = G(R, 430), yelp = OSC(R, 'triangle', 3.4 - i * .5, 0), yd = G(R, 0), ug = G(R, i ? 0 : 1);
      chain(wail, wd); chain(yelp, BQ(R, 'lowpass', 14, .5), yd);
      for (const o of [o1, o2]) { base.connect(o.frequency); wd.connect(o.frequency); yd.connect(o.frequency); }
      const mix = G(R, 1); chain(o1, G(R, .5), mix); chain(o2, G(R, .3), mix);
      chain(mix, BQ(R, 'highpass', 480, .7), BQ(R, 'peaking', 1500, 1.1, 7), SH(R, x => Math.tanh(1.8 * x)), BQ(R, 'highpass', 380, .7), ug, lp);    // 100 W horn driver: honky, slightly overdriven
      units.push({ o1, o2, wd, yd, ug });
    }
    /** p: {level 0..1, distance m, rel m/s closing speed (+ = approaching), mode 'wail'|'yelp'|undefined(auto: yelp when level>=.6)} */
    S.set = function (p, t, tc) {
      t = t === undefined ? ac.currentTime : t; tc = tc === undefined ? .1 : tc;
      const level = clamp(+p.level || 0, 0, 1), dist = Math.max(0, +p.distance || 0), rel = clamp(+p.rel || 0, -60, 60), yelp = p.mode ? p.mode === 'yelp' : level >= .6;
      const cents = 1200 * Math.log2(343 / (343 - rel));
      units.forEach((u, i) => { const y = i ? !yelp : yelp; tgt(u.wd.gain, y ? 0 : 430, t, .08); tgt(u.yd.gain, y ? 620 : 0, t, .08); tgt(u.o1.detune, cents, t, tc); tgt(u.o2.detune, cents, t, tc); });
      tgt(units[1].ug.gain, level > .8 ? .55 : 0, t, .3);
      tgt(out.gain, level > 0 ? .36 * (.35 + .65 * level) * 16 / (16 + dist) : 0, t, tc);
      tgt(lp.frequency, clamp(11000 * Math.exp(-dist / 110), 800, 11000), t, tc); tgt(send.gain, clamp(.12 + dist / 110, .12, 1.3), t, tc);
    };
    return S;
  }

  /* ================================================================== SCANNER — police-radio blips */
  /** returns the duration in seconds. ev: 'call' (alert tones + long garble), 'unit' (short reply), 'clear' (long tone + sign-off). */
  function scanner(R, t, ev, seed) {
    const r = rngOf('scan' + (seed || 0) + ev), bus = G(R, .55);
    chain(bus, BQ(R, 'highpass', 430, .8), BQ(R, 'lowpass', 2900, .8), BQ(R, 'peaking', 1700, 1.2, 5), SH(R, x => Math.tanh(3 * x) * .7), G(R, .5), R.cabinBus);   // 3 kHz handset band, crunchy
    let tt = t;
    nz(R, bus, tt, { f: 1900, q: .5, a: .002, h: .035, d: .03, g: .5 }); tt += .085;                                 // squelch opens
    if (ev === 'call') { for (let k = 0; k < 2; k++) { tone(R, bus, tt, { type: 'square', f: 1000, a: .004, h: .11, d: .012, g: .2 }); tone(R, bus, tt + .14, { type: 'square', f: 1420, a: .004, h: .11, d: .012, g: .2 }); tt += .29; } tt += .06; }
    else if (ev === 'clear') { tone(R, bus, tt, { f: 880, a: .006, h: .3, d: .03, g: .28 }); tt += .4; }
    else { tone(R, bus, tt, { type: 'square', f: 1250, a: .003, h: .055, d: .01, g: .18 }); tt += .11; }
    const nSyl = ev === 'call' ? 10 : ev === 'clear' ? 6 : 5, v0 = tt; let f0 = 108 + r() * 40;
    for (let k = 0; k < nSyl; k++) {                                                                                // unintelligible dispatcher: pitched buzz through two moving formants
      const d = .07 + r() * .1, ac = R.ac, o = ac.createOscillator(), g = ac.createGain(), f1 = BQ(R, 'bandpass', 320 + r() * 520, 5), f2 = BQ(R, 'bandpass', 950 + r() * 1500, 7);
      o.type = 'sawtooth'; f0 = clamp(f0 * (.9 + r() * .2), 95, 170); o.frequency.setValueAtTime(f0 * (1 + (r() - .5) * .12), tt); o.frequency.linearRampToValueAtTime(f0 * (1 + (r() - .6) * .16), tt + d);
      f2.frequency.setValueAtTime(f2.frequency.value, tt); f2.frequency.linearRampToValueAtTime(950 + r() * 1500, tt + d);
      o.connect(f1); o.connect(f2); f1.connect(g); chain(f2, G(R, .8), g); g.connect(bus);
      const end = env(g.gain, tt, .012, d * .6, d * .4, 1.6); o.start(tt); o.stop(end + .02);
      if (r() < .4) nz(R, bus, tt + d, { type: 'highpass', f: 2200, q: .6, a: .003, d: .03, g: .16 });                // consonant hiss
      tt += d + .025 + (r() < .22 ? .09 + r() * .08 : r() * .03);
    }
    nz(R, bus, v0 - .02, { f: 2200, q: .4, a: .01, h: tt - v0, d: .03, g: .035 });                                   // carrier hiss under the voice
    if (ev !== 'clear') { tone(R, bus, tt + .02, { f: 1750, a: .003, h: .05, d: .01, g: .16 }); tt += .1; }            // roger beep
    nz(R, bus, tt + .01, { f: 1500, q: .4, a: .001, h: .02, d: .07, g: .55 }); tt += .12;                              // squelch tail
    return tt - t;
  }

  /* ================================================================== AMBIENCE — insects, surf, traffic, neon hum */
  function makeAmb(R) {
    const ac = R.ac, A = { traffic: 0, acc: 0 }, out = R.wcat.amb;
    // cicadas: two narrow noise bands, each chopped at its own buzz rate and swelling on its own slow cycle
    A.cic = G(R, 0); A.cic.connect(out);
    for (const [f, q, buzz, swell, th, g] of [[5300, 9, 96, .11, -.15, 1], [7000, 12, 118, .083, .1, .6], [4100, 10, 71, .061, .3, .7]]) {
      const am = G(R, .3), sw = G(R, 0); chain(OSC(R, 'sawtooth', buzz, 0), G(R, .7), am.gain); chain(gate(R, swell, th, .7), sw.gain);
      chain(NOISE(R, 'white', 0), BQ(R, 'bandpass', f, q), BQ(R, 'bandpass', f * 1.01, q * .7), am, sw, G(R, g * 14), A.cic);
    }
    // crickets: pure tones gated into chirp trains
    A.crk = G(R, 0); A.crk.connect(out);
    for (const [f, pr, cr, th, g] of [[4250, 29, 1.45, .3, 1], [4620, 33, .97, .45, .7], [3840, 25, .62, .5, .8], [5050, 37, 1.9, .55, .5]]) {
      const a = G(R, 0), b = G(R, 0); chain(gate(R, pr, 0, .7), a.gain); chain(gate(R, cr, th, .12), b.gain); chain(OSC(R, 'sine', f, 0), a, b, G(R, g * .8), A.crk);
    }
    // surf: slow breathing brown noise + a hiss of foam on each crest
    A.surf = G(R, 0); A.surf.connect(out);
    const sg = G(R, .3), fg = G(R, 0), wave = gate(R, .083, .1, .9), wave2 = gate(R, .061, .2, .8);
    chain(wave, G(R, .5), sg.gain); chain(wave2, G(R, .3), sg.gain); chain(wave, G(R, .16), fg.gain);
    chain(NOISE(R, 'brown', 0), BQ(R, 'lowpass', 620, .6), BQ(R, 'highpass', 110, .6), sg, G(R, 1.5), A.surf); chain(NOISE(R, 'white', 0), BQ(R, 'bandpass', 3200, .5), fg, A.surf);
    // distant highway wash
    A.traf = G(R, 0); A.traf.connect(out);
    const tg = G(R, .7); chain(OSC(R, 'sine', .043, 0), G(R, .25), tg.gain); chain(NOISE(R, 'pink', 0), BQ(R, 'lowpass', 520, .6), BQ(R, 'highpass', 90, .6), tg, G(R, 1.4), A.traf);
    // neon / transformer hum (60 Hz mains): 120 Hz buzz + arcing fizz
    A.hum = G(R, 0); A.hum.connect(out);
    chain(OSC(R, 'sawtooth', 120, 0), BQ(R, 'lowpass', 720, .7), G(R, .32), A.hum); chain(OSC(R, 'sine', 60, 0), G(R, .25), A.hum); chain(OSC(R, 'sine', 180, 0), G(R, .12), A.hum);
    const fz = G(R, .2); chain(OSC(R, 'square', 120, 0), G(R, .2), fz.gain); chain(NOISE(R, 'white', 0), BQ(R, 'bandpass', 3400, 4), fz, G(R, .5), A.hum);
    /** p: {night 0..1, traffic 0..1, interior 0..1, hum 0..1 (near the store), surf 0..1 (default .6)} */
    A.set = function (p, t, tc) {
      t = t === undefined ? ac.currentTime : t; tc = tc === undefined ? .4 : tc;
      const night = clamp(+p.night || 0, 0, 1), tr = clamp(+p.traffic || 0, 0, 1), inn = clamp(+p.interior || 0, 0, 1), hum = clamp(+p.hum || 0, 0, 1), surf = p.surf === undefined ? .6 : clamp(+p.surf, 0, 1), cic = p.cicada === undefined ? 1 : clamp(+p.cicada, 0, 1);
      A.traffic = p.whoosh === false ? 0 : tr;
      const ak = S.ambK === undefined ? 1 : S.ambK;   /* recorded beds playing (js/samples.js): the synth wash, insects and surf step back */
      tgt(A.cic.gain, .1 * (1 - .88 * night) * cic * ak, t, tc); tgt(A.crk.gain, .085 * (.12 + .88 * night) * ak, t, tc);
      tgt(A.surf.gain, .2 * surf * ak, t, tc); tgt(A.traf.gain, .16 * tr * ak, t, tc); tgt(A.hum.gain, .1 * hum, t, tc);
      tgt(R.inLP.frequency, 18000 * Math.pow(650 / 18000, inn), t, Math.min(tc, .12)); tgt(R.worldGain.gain, 1 - .5 * inn, t, Math.min(tc, .12));
    };
    /** one car passing on the highway: band-passed noise swelling and dropping in pitch, panned across. */
    A.whoosh = function (t, g, dir) {
      const s = NOISE(R, 'pink', t, t + 4.2), f = BQ(R, 'bandpass', 520, 1), gn = G(R, 0), pan = ac.createStereoPanner ? ac.createStereoPanner() : G(R, 1);
      f.frequency.setValueAtTime(480, t); f.frequency.linearRampToValueAtTime(980, t + 1.7); f.frequency.linearRampToValueAtTime(330, t + 3.4);
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g * .25, t + 1.2); gn.gain.linearRampToValueAtTime(g, t + 1.8); gn.gain.exponentialRampToValueAtTime(g * .02, t + 4); gn.gain.linearRampToValueAtTime(0, t + 4.15);
      if (pan.pan) { pan.pan.setValueAtTime(-.8 * dir, t); pan.pan.linearRampToValueAtTime(.8 * dir, t + 3.6); }
      chain(s, f, gn, pan, out);
      tone(R, out, t + .6, { type: 'sawtooth', f: 105, f1: 78, ft: 2.6, lp: 320, a: 1.1, h: .3, d: 1.8, g: g * .1 });    // a hint of its engine
    };
    A.update = function (dt) { if (A.traffic <= 0) return; A.acc += dt * A.traffic * .32; if (A.acc > 1) { A.acc = R.rnd() * .5; A.whoosh(ac.currentTime + .05, .25 + R.rnd() * .25, R.rnd() < .5 ? -1 : 1); } };
    A.set({ night: 0, traffic: 0, interior: 0, hum: 0 }, 0, 0);
    return A;
  }

  /* ================================================================== SFX */
  const SFX_BUS = { glass: 'world', alarm_bell: 'world' };
  const SFX_GAIN = { crash: .9, door_close: .95, key_turn: 1.6, star: 1.6, cash: 1.4, turn_signal: 1.25, door_open: 1.15, seatbelt: 1.1 };   // final trim per one-shot, set from the offline measurements       // everything else is heard from the driver's seat
  const ONE = {
    door_open(R, d, t) { nz(R, d, t, { f: 2700, q: 3, a: .0005, d: .014, g: .55 }); tone(R, d, t, { type: 'square', f: 730, a: .0005, d: .02, g: .12 });
      tone(R, d, t + .055, { f: 150, f1: 78, ft: .06, a: .002, d: .08, g: .5 }); nz(R, d, t + .055, { type: 'lowpass', f: 800, q: .7, a: .002, d: .06, g: .4 });
      tone(R, d, t + .13, { type: 'sawtooth', f: 296, f1: 352, ft: .28, lp: 1500, q: 6, a: .06, h: .1, d: .16, g: .06 }); nz(R, d, t + .1, { kind: 'pink', type: 'lowpass', f: 600, f1: 1800, ft: .3, q: .5, a: .12, h: .1, d: .2, g: .1 }); return .6; },
    door_close(R, d, t) { nz(R, d, t, { kind: 'pink', type: 'lowpass', f: 500, q: .5, a: .06, d: .03, g: .14 });
      const s = t + .075; tone(R, d, s, { f: 112, f1: 42, ft: .1, a: .002, h: .02, d: .17, g: .85 }); nz(R, d, s, { type: 'lowpass', f: 1100, f1: 300, ft: .08, q: .7, a: .001, d: .08, g: .7 });
      nz(R, d, s + .004, { f: 3100, q: 2.5, a: .0005, d: .012, g: .4 }); nz(R, d, s + .03, { f: 4300, q: 6, a: .002, d: .1, g: .1 }); tone(R, d, s + .02, { f: 1930, a: .001, d: .05, g: .03 }); return .45; },
    ignition(R, d, t) { nz(R, d, t, { f: 2400, q: 2, a: .0005, d: .015, g: .5 }); tone(R, d, t, { f: 160, f1: 80, ft: .04, a: .001, d: .05, g: .4 });                    // solenoid
      const ac = R.ac, o = ac.createOscillator(), o2 = ac.createOscillator(), am = G(R, .6), g = G(R, 0), bp = BQ(R, 'bandpass', 950, 1.3), s = t + .05, dur = .82;
      o.type = 'sawtooth'; o.frequency.setValueAtTime(118, s); o.frequency.linearRampToValueAtTime(168, s + .25); o.frequency.linearRampToValueAtTime(150, s + dur);
      o2.type = 'square'; o2.frequency.setValueAtTime(1180, s); o2.frequency.linearRampToValueAtTime(1560, s + .3); o2.frequency.linearRampToValueAtTime(1420, s + dur);
      const lfo = OSC(R, 'sine', 10.5, s, s + dur + .1); lfo.frequency.linearRampToValueAtTime(13.5, s + dur); chain(lfo, G(R, .4), am.gain);
      chain(o, bp, am, g, d); chain(o2, G(R, .1), bp); chain(o, BQ(R, 'lowpass', 320, .7), G(R, .7), am);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(.42, s + .04); g.gain.setValueAtTime(.42, s + dur - .05); g.gain.linearRampToValueAtTime(0, s + dur + .03);
      o.start(s); o.stop(s + dur + .1); o2.start(s); o2.stop(s + dur + .1);
      let c = s + dur - .14; for (let k = 0; k < 5; k++) { nz(R, d, c, { type: 'lowpass', f: 380 + k * 90, q: .9, a: .003, d: .07, g: .35 + k * .09 }); tone(R, d, c, { type: 'triangle', f: 70 + k * 12, f1: 48, ft: .06, a: .002, d: .08, g: .3 + k * .06 }); c += .095 - k * .012; }   // cylinders catching
      return 1.3; },
    horn(R, d, t, o) { return hornNote(R, d, t, (o && o.dur) || .45, o && o.weedy).dur; },
    key_turn(R, d, t) { for (const [dt, g] of [[0, .3], [.055, .45], [.13, .6]]) { nz(R, d, t + dt, { f: 3900, q: 4, a: .0004, d: .008, g }); tone(R, d, t + dt, { f: 2450, a: .0004, d: .012, g: g * .2 }); }
      for (let k = 0; k < 5; k++) tone(R, d, t + .02 + R.rnd() * .2, { f: 3800 + R.rnd() * 3600, a: .0005, d: .06 + R.rnd() * .1, g: .035 }); return .32; },
    seatbelt(R, d, t) { nz(R, d, t, { f: 1700, f1: 3300, ft: .32, q: 2, a: .1, h: .14, d: .1, g: .13 }); nz(R, d, t, { kind: 'pink', f: 600, q: .8, a: .1, h: .14, d: .1, g: .1 });
      const s = t + .43; nz(R, d, s, { f: 2900, q: 2.5, a: .0005, d: .012, g: .6 }); tone(R, d, s, { type: 'square', f: 1480, a: .0005, d: .02, g: .13 }); tone(R, d, s, { f: 3350, a: .0005, d: .07, g: .09 }); tone(R, d, s, { f: 240, f1: 130, ft: .03, a: .001, d: .04, g: .3 });
      nz(R, d, s + .05, { f: 3600, q: 3, a: .0005, d: .008, g: .25 }); return .58; },
    crash(R, d, t, o) { const v = clamp(o && o.v !== undefined ? +o.v : .7, .05, 1), r = R.rnd;
      tone(R, d, t, { f: 105, f1: 34, ft: .1, a: .001, h: .01, d: .14 + .12 * v, g: .5 * v }); nz(R, d, t, { type: 'lowpass', f: 5200 * v + 900, f1: 260, ft: .3, q: .6, a: .001, h: .03, d: .25 + .3 * v, g: .85 * v });
      nz(R, d, t + .001, { f: 2400, q: .7, a: .0005, h: .01, d: .1, g: .6 * v }); nz(R, d, t + .045 + r() * .02, { type: 'lowpass', f: 2600, f1: 400, ft: .15, q: .7, a: .001, d: .16, g: .5 * v });      // second, crumpling impact
      for (let k = 0; k < 9; k++) tone(R, d, t + r() * .05, { type: 'square', f: 170 + r() * 1900, det: (r() - .5) * 60, lp: 3600, a: .001, d: .06 + r() * .28 * v, g: .13 * v });                // sheet-metal: inharmonic rings
      const nd = Math.floor(3 + 14 * v); for (let k = 0; k < nd; k++) { const dt = .08 + r() * (.35 + .6 * v); nz(R, d, t + dt, { f: 1200 + r() * 4200, q: 3 + r() * 5, a: .0005, d: .01 + r() * .035, g: (.14 + r() * .22) * v * (1 - dt * .6) }); }   // debris
      return .5 + .7 * v; },
    glass(R, d, t, o) { const r = R.rnd, g = (o && o.g) || 1;
      nz(R, d, t, { type: 'highpass', f: 2600, q: .7, a: .0005, h: .01, d: .07, g: .6 * g }); nz(R, d, t, { f: 900, q: 1, a: .001, d: .05, g: .4 * g });
      for (let k = 0; k < 34; k++) { const dt = Math.pow(r(), 1.6) * .75; tone(R, d, t + .005 + dt, { f: 1900 + r() * 7600, a: .0004, d: .015 + r() * .1, g: (.04 + r() * .1) * (1 - dt) * g }); }
      for (let k = 0; k < 10; k++) nz(R, d, t + .02 + r() * .55, { type: 'highpass', f: 5200, q: 1, a: .0005, d: .006 + r() * .012, g: .12 * g }); return 1; },
    cash(R, d, t) { nz(R, d, t, { f: 1900, q: 2, a: .0005, d: .016, g: .45 }); tone(R, d, t, { f: 210, f1: 110, ft: .04, a: .001, d: .06, g: .35 }); nz(R, d, t + .03, { kind: 'pink', f: 700, q: .8, a: .01, d: .1, g: .12 });
      const b = t + .09; for (const [f, g, dd] of [[2093, .16, .5], [3136, .1, .4], [4186, .06, .3], [5587, .03, .2]]) tone(R, d, b, { f, a: .0006, d: dd, g }); tone(R, d, b + .1, { f: 2637, a: .0006, d: .4, g: .09 });
      for (let k = 0; k < 6; k++) tone(R, d, b + .03 + R.rnd() * .2, { f: 3400 + R.rnd() * 3200, a: .0004, d: .04 + R.rnd() * .06, g: .028 }); return .7; },
    ui_tick(R, d, t) { tone(R, d, t, { f: 1900, a: .0005, d: .014, g: .2 }); nz(R, d, t, { type: 'highpass', f: 4000, q: .7, a: .0003, d: .005, g: .12 }); return .03; },
    ui_ok(R, d, t) { tone(R, d, t, { f: 784, a: .004, h: .03, d: .07, g: .2 }); tone(R, d, t + .085, { f: 1175, a: .004, h: .04, d: .16, g: .22 }); tone(R, d, t + .085, { f: 2350, a: .004, d: .08, g: .04 }); return .32; },
    ui_bad(R, d, t) { for (const [dt, f, dd] of [[0, 196, .09], [.12, 147, .2]]) { tone(R, d, t + dt, { type: 'triangle', f, a: .004, h: .04, d: dd, g: .34 }); tone(R, d, t + dt, { type: 'sawtooth', f, lp: 900, a: .004, h: .04, d: dd, g: .1 }); } return .4; },
    star(R, d, t) { tone(R, d, t, { type: 'sawtooth', f: 110, lp: 900, lp1: 250, lpt: .3, a: .003, h: .05, d: .3, g: .34 });
      for (const [dt, m] of [[0, 69], [.07, 72], [.14, 76]]) for (const det of [-9, 9]) tone(R, d, t + dt, { type: 'sawtooth', f: mtof(m), det, lp: 4200, lp1: 1200, lpt: .3, q: 2, a: .004, h: dt === .14 ? .12 : .04, d: dt === .14 ? .3 : .08, g: .085 });
      tone(R, d, t + .14, { f: mtof(88), a: .003, d: .35, g: .06 }); nz(R, d, t + .12, { type: 'highpass', f: 5000, f1: 9000, ft: .2, q: .7, a: .03, d: .25, g: .05 }); return .65; },
    heartbeat(R, d, t) { tone(R, d, t, { type: 'triangle', f: 66, f1: 38, ft: .09, a: .006, h: .02, d: .12, g: .75 }); nz(R, d, t, { type: 'lowpass', f: 180, q: .7, a: .005, d: .08, g: .5 });
      tone(R, d, t + .15, { type: 'triangle', f: 84, f1: 46, ft: .07, a: .005, h: .01, d: .09, g: .5 }); nz(R, d, t + .15, { type: 'lowpass', f: 240, q: .7, a: .004, d: .06, g: .32 }); return .36; },
    turn_signal(R, d, t, o) { const f = o && o.tock ? 1650 : 2250; nz(R, d, t, { f, q: 5, a: .0004, d: .012, g: .55 }); tone(R, d, t, { f, a: .0004, d: .016, g: .1 }); tone(R, d, t, { f: 190, f1: 120, ft: .02, a: .001, d: .025, g: .22 }); return .05; },
    thunk(R, d, t) { tone(R, d, t, { f: 98, f1: 46, ft: .08, a: .002, h: .01, d: .15, g: .7 }); nz(R, d, t, { type: 'lowpass', f: 600, q: .7, a: .001, d: .06, g: .5 }); nz(R, d, t, { f: 1800, q: 1.5, a: .001, d: .015, g: .1 }); return .22; }
  };
  /** dual-tone muscle-car horn. dur = undefined → holds until .stop(). */
  function hornNote(R, dest, t, dur, weedy) {
    const ac = R.ac, g = G(R, 0), nodes = [];
    if (weedy) {   // e-scooter buzzer: one thin, slightly beating note through a tiny piezo horn
      const mix = G(R, 1); for (const [f, type, a] of [[618, 'square', .5], [625, 'square', .35], [1240, 'sawtooth', .12]]) { const o = OSC(R, type, f, t); chain(o, G(R, a), mix); nodes.push(o); }
      chain(mix, BQ(R, 'peaking', 2600, 1.2, 9), BQ(R, 'highpass', 520, .7), BQ(R, 'lowpass', 5200, .7), g, dest);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.085, t + .008);
      const h = { dur: dur ? dur + .08 : 0, stop(te) { te = Math.max(te === undefined ? ac.currentTime : te, t + .03); g.gain.cancelScheduledValues(te); g.gain.setTargetAtTime(0, te, .012); for (const o of nodes) o.stop(te + .15); } };
      if (dur) { g.gain.setValueAtTime(.085, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + .03); for (const o of nodes) o.stop(t + dur + .06); }
      return h;
    }
    const mix = G(R, 1); for (const [f, type, a] of [[349, 'sawtooth', .5], [440, 'sawtooth', .5], [351.5, 'square', .16], [442, 'square', .16]]) { const o = OSC(R, type, f, t); o.frequency.setValueAtTime(f * .96, t); o.frequency.exponentialRampToValueAtTime(f, t + .03); chain(o, G(R, a), mix); nodes.push(o); }
    chain(mix, SH(R, x => Math.tanh(2.5 * x)), BQ(R, 'peaking', 1900, 1, 8), BQ(R, 'highpass', 280, .7), BQ(R, 'lowpass', 4200, .7), g, dest);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.2, t + .012);
    const h = { dur: dur ? dur + .1 : 0, stop(te) { te = Math.max(te === undefined ? ac.currentTime : te, t + .03); g.gain.cancelScheduledValues(te); g.gain.setTargetAtTime(0, te, .018); for (const o of nodes) o.stop(te + .2); } };
    if (dur) { g.gain.setValueAtTime(.2, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + .06); for (const o of nodes) o.stop(t + dur + .1); }
    return h;
  }
  /** continuous voices: return {set(o,t), stop(t)} */
  const CONT = {
    tire_squeal(R, d, t) { const ac = R.ac, g = G(R, 0), jit = G(R, 45), bp = BQ(R, 'bandpass', 1150, 4), os = [];
      const wobble = NOISE(R, 'brown', t);
      chain(wobble, BQ(R, 'lowpass', 9, .5), G(R, 30), jit);
      for (const f of [985, 1322, 1648]) { const o = OSC(R, 'sawtooth', f, t); jit.connect(o.frequency); chain(o, G(R, .4), bp); os.push(o); }
      const n = NOISE(R, 'pink', t); chain(n, BQ(R, 'bandpass', 1500, 2.5), G(R, .8), bp); chain(bp, BQ(R, 'highpass', 500, .7), g, d);
      return { set(o, tt) { const l = clamp(+o.level || 0, 0, 1); tgt(g.gain, .8 * Math.pow(l, .8), tt, .04); tgt(bp.frequency, 950 + 420 * l, tt, .06); os.forEach((x, i) => tgt(x.detune, l * 180 - 60 + i * 9, tt, .08)); },
        stop(tt) { tgt(g.gain, 0, tt, .03); for (const o of os) o.stop(tt + .3); n.stop(tt + .3); wobble.stop(tt + .3); } }; },
    alarm_bell(R, d, t) { const ac = R.ac, g = G(R, 0), lp = BQ(R, 'lowpass', 9000, .6), strike = OSC(R, 'sawtooth', 21, t), envS = SH(R, x => Math.exp(-3.2 * (x + 1) / 2)), bell = G(R, 0), clk = G(R, 0), os = [strike];
      strike.connect(envS); envS.connect(bell.gain); chain(envS, G(R, .5), clk.gain);
      for (const [m, a] of [[1, .5], [2.01, .28], [2.76, .34], [4.07, .18], [5.4, .12], [6.8, .06]]) { const o = OSC(R, 'sine', 1180 * m, t); chain(o, G(R, a), bell); os.push(o); }
      const n = NOISE(R, 'white', t); chain(n, BQ(R, 'bandpass', 3300, 1.2), clk); chain(bell, lp); chain(clk, lp); chain(lp, g, d); chain(g, G(R, .25), R.verbIn);
      return { set(o, tt) { const dist = Math.max(0, +o.distance || 0); tgt(g.gain, .55 * 12 / (12 + dist) * (o.g === undefined ? 1 : o.g), tt, .02); tgt(lp.frequency, clamp(10000 * Math.exp(-dist / 90), 1200, 10000), tt, .05); },
        stop(tt) { tgt(g.gain, 0, tt, .04); for (const o of os) o.stop(tt + .4); n.stop(tt + .4); } }; }
  };
  /** play a one-shot on a rig at time t. returns its duration. */
  function playSfx(R, name, t, opts) { const f = ONE[name]; if (!f) return 0; opts = opts || {}; const bus = SFX_BUS[name], OWN = { footstep: 1, cloth: 1, gear: 1, box_rattle: 1, bird: 1, flap: 1, mahjong: 1, bike_bell: 1, scooter_beep: 1, bus_door: 1, boat_horn: 1, whoosh: 1 };   // these scale by opts.g themselves
    let d, use = null;
    if (opts.x !== undefined && opts.z !== undefined && R.pool) {   // positional: a pooled panner (dropped when the pool is full of louder things)
      use = R.pool.alloc({ cat: SFX_CAT[name] || 'sfx', x: opts.x, y: opts.y, z: opts.z, lvl: opts.lvl === undefined ? .5 : opts.lvl, prio: opts.prio, dur: 1.5, ref: opts.ref }, t); if (!use) return 0; d = use.g;
      const dd = Math.hypot(opts.x - R.pool.lis.x, opts.z - R.pool.lis.z), rf = use.ref, s = G(R, .12 * rf / (rf + dd)); d.connect(s); s.connect(R.verbIn);
    } else d = bus === 'world' ? R.wcat.sfx : bus === 'ui' ? R.uiBus : bus === 'self' ? R.selfBus : bus === 'music' ? R.musicBus : R.cabinBus;
    const k = (SFX_GAIN[name] || 1) * (opts.g !== undefined && name !== 'glass' && !OWN[name] ? opts.g : 1); if (k !== 1) { const g = G(R, k); g.connect(d); d = g; }
    if (opts.distance && bus === 'world' && !use) { const g = G(R, 10 / (10 + opts.distance)); g.connect(d); d = g; }
    const dur = f(R, d, t, opts); if (use) use.until = t + dur + .1; return dur; }

  /* ================================================================== "ALIVE" LAYER (China edition): positional pool, footsteps, e-scooter, city bed, impacts, stings
     Everything below is additive: the round-1 API above keeps working. All positions are world metres (three.js axes). */

  /** 24 pooled PannerNodes. A voice asks for a slot with {cat, x, y, z, lvl (rough loudness 0..1), prio, dur (0 = held until release), ref};
      when all are busy the quietest-at-the-listener voice of equal or lower priority is faded out (12 ms) and its slot reused. */
  function makePool(R, n) {
    const ac = R.ac, P = { v: [], lis: { x: 0, y: 1.6, z: 0 }, stolen: 0, dropped: 0, peak: 0, allocs: 0 };
    for (let i = 0; i < n; i++) {
      const pan = ac.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 4; pan.maxDistance = 600; pan.rolloffFactor = 1.1;
      const lp = BQ(R, 'lowpass', 18000, .5), outs = {}; lp.connect(pan);
      for (const c in R.wcat) { outs[c] = G(R, 0); pan.connect(outs[c]); outs[c].connect(R.wcat[c]); }
      P.v.push({ i, lp, pan, outs, use: null });
    }
    const dist = u => Math.hypot(u.x - P.lis.x, u.y - P.lis.y, u.z - P.lis.z), score = u => (u.prio || 0) * 10 + u.lvl * u.ref / (u.ref + dist(u));
    function place(v, x, y, z, t, tc) { const p = v.pan;
      if (p.positionX) { tgt(p.positionX, x, t, tc); tgt(p.positionY, y, t, tc); tgt(p.positionZ, z, t, tc); } else p.setPosition(x, y, z);
      const d = Math.hypot(x - P.lis.x, y - P.lis.y, z - P.lis.z); tgt(v.lp.frequency, clamp(18000 * Math.exp(-d / 60), 1400, 18000), t, tc || 0); }       // air + clutter absorb the top end with distance
    P.alloc = function (o, t) {
      const me = { cat: o.cat || 'sfx', prio: o.prio || 0, lvl: o.lvl === undefined ? .4 : o.lvl, ref: o.ref || 4, x: o.x, y: o.y === undefined ? 1.2 : o.y, z: o.z, until: o.dur ? t + o.dur + .08 : 0, dead: false };
      let best = null, bs = 1e9, busy = 0;
      for (const v of P.v) { const u = v.use; if (!u || (u.until && u.until < t)) { if (bs >= 0) { best = v; bs = -1; } continue; } busy++; if (bs < 0) continue; const s = score(u); if (s < bs) { bs = s; best = v; } }
      if (bs >= 0) { if (score(me) < bs) { P.dropped++; return null; } P.stolen++; const u = best.use; u.dead = true; u.g.gain.cancelScheduledValues(t); u.g.gain.setTargetAtTime(0, t, .012); }
      const v = best, steal = bs >= 0; me.v = v; me.g = G(R, 1); me.g.connect(v.lp); v.use = me; P.allocs++; if (busy + (steal ? 0 : 1) > P.peak) P.peak = busy + (steal ? 0 : 1);
      v.pan.refDistance = me.ref; for (const c in v.outs) tgt(v.outs[c].gain, c === me.cat ? 1 : 0, t, steal ? .006 : 0);
      place(v, me.x, me.y, me.z, t, 0);
      me.move = (x, y, z, tt, tc) => { if (me.dead) return; me.x = x; me.y = y; me.z = z; place(v, x, y, z, tt, tc === undefined ? .06 : tc); };
      me.release = tt => { if (!me.dead) me.until = tt; };
      return me;
    };
    /** listener = the player's head; forward = where the camera looks */
    P.listen = function (x, y, z, fx, fz, t, tc) { P.lis.x = x; P.lis.y = y; P.lis.z = z; const L = ac.listener, l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
      if (L.positionX) { tgt(L.positionX, x, t, tc); tgt(L.positionY, y, t, tc); tgt(L.positionZ, z, t, tc); tgt(L.forwardX, fx, t, tc); tgt(L.forwardY, 0, t, tc); tgt(L.forwardZ, fz, t, tc); if (!P.up) { P.up = 1; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; } }
      else { L.setPosition(x, y, z); L.setOrientation(fx, 0, fz, 0, 1, 0); } };
    P.active = t => { let k = 0; for (const v of P.v) { const u = v.use; if (u && !(u.until && u.until < t)) k++; } return k; };
    return P;
  }

  /* ---------------------------------------------------------------- one-shots */
  const GAIT = sp => (sp > 5 ? 2 : sp > 2.5 ? 1 : 0);
  /** one footfall. o: {surface: asphalt|paver|concrete|tile|wood|wet|dirt|grass, speed m/s, foot 'L'|'R', crouch, g} — heel then toe, ±9 % pitch, ±15 % level */
  function footstepSnd(R, d, t, o) {
    o = o || {}; const r = R.rnd, sf = o.surface || 'asphalt', gt = GAIT(+o.speed || 1.4), amp = [.75, 1, 1.15][gt] * (o.crouch ? .45 : 1) * (.85 + r() * .3) * (o.g === undefined ? 1 : o.g),
      p = (1 + (r() - .5) * .18) * (o.foot === 'L' ? .97 : 1.03), t2 = t + [.055, .032, .02][gt] * (.8 + r() * .4);
    switch (sf) {
      case 'tile': nz(R, d, t, { f: 2300 * p, q: 2.6, a: .0006, d: .02, g: amp * .8 }); tone(R, d, t, { f: 185 * p, f1: 120, ft: .03, a: .001, d: .035, g: amp * .5 });
        nz(R, d, t2, { f: 3400 * p, q: 2, a: .0006, d: .016, g: amp * .45 }); if (r() < .12) tone(R, d, t2, { f: 2500 * p, f1: 3100 * p, ft: .05, a: .008, d: .05, g: amp * .07 }); break;                 // the odd sole squeak
      case 'wood': tone(R, d, t, { f: 150 * p, f1: 105 * p, ft: .07, a: .001, d: .1, g: amp * .9 }); tone(R, d, t, { type: 'triangle', f: 320 * p, a: .001, d: .05, g: amp * .3 }); nz(R, d, t, { type: 'lowpass', f: 1000, q: .7, a: .001, d: .03, g: amp * .5 });
        nz(R, d, t2, { f: 1600 * p, q: 1.2, a: .001, d: .025, g: amp * .3 }); if (r() < .2) tone(R, d, t + .01, { type: 'sawtooth', f: 410 * p, f1: 370 * p, ft: .09, lp: 1200, a: .01, d: .09, g: amp * .05 }); break;   // board creak
      case 'wet': nz(R, d, t, { f: 850 * p, q: .8, a: .001, d: .035, g: amp * .7 }); tone(R, d, t, { f: 105 * p, f1: 60, ft: .04, a: .001, d: .05, g: amp * .4 });
        nz(R, d, t + .004, { f: 3600 * p, f1: 1500, ft: .09, q: .9, a: .004, d: .1, g: amp * .5 }); nz(R, d, t2, { type: 'highpass', f: 5500, q: .7, a: .003, d: .06, g: amp * .2 }); break;                    // slap + spray
      case 'dirt': case 'grass': nz(R, d, t, { type: 'lowpass', f: 700 * p, q: .7, a: .002, d: .06, g: amp * .9 }); nz(R, d, t + .005, { f: 3000 * p, q: .6, a: .004, d: .05, g: amp * .25 }); nz(R, d, t2, { f: 2200 * p, q: .7, a: .003, d: .04, g: amp * .2 }); break;
      case 'paver': nz(R, d, t, { f: 1450 * p, q: 1.5, a: .0008, d: .028, g: amp * .9 }); tone(R, d, t, { f: 150 * p, f1: 85, ft: .035, a: .001, d: .045, g: amp * .5 }); nz(R, d, t2, { f: 3100 * p, q: 1.2, a: .0008, d: .026, g: amp * .4 }); break;
      case 'concrete': nz(R, d, t, { f: 1050 * p, q: 1, a: .001, d: .04, g: amp * .9 }); tone(R, d, t, { f: 98 * p, f1: 55, ft: .04, a: .001, d: .055, g: amp * .55 }); nz(R, d, t2, { f: 2100 * p, q: .9, a: .001, d: .035, g: amp * .35 }); break;
      default: nz(R, d, t, { f: 900 * p, q: .8, a: .001, d: .034, g: amp * .9 }); tone(R, d, t, { f: 112 * p, f1: 62, ft: .04, a: .001, d: .05, g: amp * .5 });                                              // asphalt: dull heel, gritty toe
        nz(R, d, t2, { f: 2500 * p, q: 1, a: .001, d: .03, g: amp * .4 }); nz(R, d, t2, { type: 'highpass', f: 5200, q: .7, a: .001, d: .018, g: amp * .12 });
    }
    return .2;
  }
  /** one gibberish syllable: a pitched buzz through two moving formants (shared by the chatter walla and the vendors' loudspeakers) */
  function syll(R, bus, t, f0, dur, g, r) { const ac = R.ac, o = ac.createOscillator(), gg = ac.createGain(), f1 = BQ(R, 'bandpass', 300 + r() * 500, 4), f2 = BQ(R, 'bandpass', 900 + r() * 1500, 6);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * (1 + (r() - .5) * .1), t); o.frequency.linearRampToValueAtTime(f0 * (1 + (r() - .55) * .2), t + dur);
    f2.frequency.setValueAtTime(f2.frequency.value, t); f2.frequency.linearRampToValueAtTime(900 + r() * 1500, t + dur);
    o.connect(f1); o.connect(f2); f1.connect(gg); chain(f2, G(R, .7), gg); gg.connect(bus); const end = env(gg.gain, t, .015, dur * .6, dur * .4, g); o.start(t); o.stop(end + .02); return end; }
  function pluck(R, d, t, m, g, len) { const f = mtof(m); len = len || .5; tone(R, d, t, { type: 'triangle', f: f * 1.012, f1: f, ft: .03, a: .002, d: len, g }); tone(R, d, t, { f: f * 2, a: .002, d: len * .45, g: g * .35 }); tone(R, d, t, { f: f * 3.01, a: .001, d: len * .2, g: g * .14 }); nz(R, d, t, { f: 3200, q: 1.5, a: .0005, d: .006, g: g * .35 }); }
  function bell(R, d, t, m, g, len) { const f = mtof(m); len = len || 1.2; for (const [k, a, dd] of [[1, 1, 1], [2.76, .35, .6], [5.4, .15, .3]]) tone(R, d, t, { f: f * k, a: .002, d: len * dd, g: g * a }); }
  function drum(R, d, t, g) { tone(R, d, t, { f: 120, f1: 62, ft: .09, a: .002, h: .01, d: .28, g }); nz(R, d, t, { type: 'lowpass', f: 700, q: .7, a: .002, d: .05, g: g * .5 }); }
  const OG = o => (o && o.g !== undefined ? +o.g : 1), OV = (o, dflt) => clamp(o && o.v !== undefined ? +o.v : dflt, .08, 1);
  Object.assign(ONE, {
    footstep: footstepSnd,
    /** jacket / trouser swish on a running stride */
    cloth(R, d, t, o) { nz(R, d, t, { kind: 'pink', f: 2300 + R.rnd() * 600, f1: 1300, ft: .1, q: .7, a: .025, d: .09, g: .2 * OG(o) }); return .14; },
    /** keys / zip / helmet strap: the small jingle a rider makes when he runs */
    gear(R, d, t, o) { const g = OG(o), r = R.rnd; for (let k = 0; k < 2 + (r() < .5 ? 1 : 0); k++) tone(R, d, t + k * (.018 + r() * .02), { f: 3900 + r() * 2600, a: .0005, d: .03 + r() * .04, g: .035 * g }); nz(R, d, t, { f: 1500, q: 2, a: .001, d: .02, g: .06 * g }); return .15; },
    /** the insulated delivery box: lid and contents knocking */
    box_rattle(R, d, t, o) { const g = OG(o), r = R.rnd; let tt = t; for (let k = 0; k < 3; k++) { tone(R, d, tt, { type: 'triangle', f: 220 + r() * 140, f1: 150, ft: .03, a: .001, d: .035, g: .16 * g * (1 - k * .25) }); nz(R, d, tt, { f: 1100 + r() * 700, q: 2, a: .0008, d: .018, g: .14 * g * (1 - k * .25) }); tt += .035 + r() * .04; } return .25; },
    land(R, d, t, o) { const v = OV(o, .5);
      tone(R, d, t, { f: 88, f1: 40, ft: .09, a: .002, h: .01, d: .13, g: .65 * v }); nz(R, d, t, { type: 'lowpass', f: 520, q: .7, a: .002, d: .08, g: .6 * v }); nz(R, d, t + .004, { f: 1400, q: .8, a: .001, d: .04, g: .3 * v });
      nz(R, d, t + .07, { kind: 'pink', f: 1900, f1: 1100, ft: .1, q: .7, a: .02, d: .1, g: .1 * v }); return .3; },
    body_fall(R, d, t, o) { const v = OV(o, .7);
      tone(R, d, t, { type: 'triangle', f: 74, f1: 36, ft: .1, a: .003, h: .015, d: .16, g: .8 * v }); nz(R, d, t, { type: 'lowpass', f: 420, q: .7, a: .003, d: .1, g: .6 * v }); nz(R, d, t + .01, { f: 1200, q: .7, a: .002, d: .05, g: .2 * v });
      nz(R, d, t + .09, { kind: 'pink', f: 1700, f1: 900, ft: .16, q: .7, a: .03, h: .04, d: .14, g: .12 * v }); tone(R, d, t + .13, { f: 90, f1: 50, ft: .05, a: .003, d: .08, g: .3 * v }); return .45; },
    /** tyre meets kerb: thunk, a fork-spring creak, the box answers */
    kerb(R, d, t, o) { const v = OV(o, .6);
      tone(R, d, t, { f: 125, f1: 52, ft: .07, a: .0015, h: .008, d: .1, g: .55 * v }); nz(R, d, t, { type: 'lowpass', f: 950, f1: 300, ft: .06, q: .7, a: .001, d: .055, g: .45 * v });
      tone(R, d, t + .012, { type: 'sawtooth', f: 345, f1: 300, ft: .08, lp: 900, a: .008, d: .08, g: .035 * v }); ONE.box_rattle(R, d, t + .03 + R.rnd() * .02, { g: .9 * v }); return .32; },
    /** side-stand: {up:true} = kicked up on mount (spring + one clack), otherwise two clacks as it drops and seats */
    kickstand(R, d, t, o) { const r = R.rnd, hit = (tt, g) => { nz(R, d, tt, { f: 3100 + r() * 400, q: 4, a: .0004, d: .012, g: .5 * g }); tone(R, d, tt, { type: 'square', f: 860, a: .0005, d: .018, g: .07 * g }); tone(R, d, tt, { f: 2540, a: .0005, d: .09, g: .035 * g }); tone(R, d, tt, { f: 140, f1: 90, ft: .03, a: .001, d: .035, g: .25 * g }); };
      if (o && o.up) { tone(R, d, t, { type: 'sawtooth', f: 520, f1: 760, ft: .07, lp: 1800, a: .01, d: .07, g: .03 }); hit(t + .08, 1); } else { hit(t, .8); hit(t + .11, .5); } return .25; },
    /** drum-brake squeal at the end of a hard stop */
    brake_squeal(R, d, t, o) { const v = OV(o, .6), r = R.rnd, f = 1900 + r() * 500, dur = .16 + .3 * v, ac = R.ac, os = ac.createOscillator(), g = ac.createGain(), bp = BQ(R, 'bandpass', f, 9), vib = OSC(R, 'sine', 31 + r() * 9, t, t + dur + .2);
      os.type = 'sawtooth'; os.frequency.setValueAtTime(f * 1.03, t); os.frequency.linearRampToValueAtTime(f * .93, t + dur); chain(vib, G(R, 14), os.detune); chain(os, bp, g, d);
      const end = env(g.gain, t, .03, dur * .5, dur * .5, .1 * v); os.start(t); os.stop(end + .02);
      nz(R, d, t, { kind: 'pink', f: 900, f1: 500, ft: dur, q: .8, a: .03, h: dur * .4, d: dur * .6, g: .12 * v }); return dur + .1; },     // tyre scrub underneath
    /** scooter along / into a wall: thud + plastic and paint dragging, scaled by v 0..1 */
    scrape(R, d, t, o) { const v = OV(o, .5), r = R.rnd, dur = .12 + .4 * v;
      tone(R, d, t, { f: 96, f1: 44, ft: .08, a: .001, h: .01, d: .1 + .1 * v, g: .55 * v }); nz(R, d, t, { type: 'lowpass', f: 2600 * v + 700, f1: 300, ft: .2, q: .6, a: .001, h: .02, d: .18, g: .6 * v });
      nz(R, d, t + .02, { f: 2100, f1: 1100, ft: dur, q: 1.6, a: .015, h: dur * .5, d: dur * .5, g: .34 * v }); nz(R, d, t + .02, { type: 'highpass', f: 4200, q: .7, a: .02, h: dur * .4, d: dur * .4, g: .12 * v });
      for (let k = 0; k < 4; k++) tone(R, d, t + .02 + r() * dur * .7, { type: 'square', f: 600 + r() * 2200, lp: 3200, a: .001, d: .04 + r() * .12, g: .05 * v }); return dur + .25; },
    /** the scooter going down: thud, fairing clatter, the bell on the bars rings once (no glass, no sheet metal) */
    scooter_crash(R, d, t, o) { const v = OV(o, .6), r = R.rnd;
      tone(R, d, t, { f: 110, f1: 38, ft: .1, a: .001, h: .01, d: .14 + .1 * v, g: .6 * v }); nz(R, d, t, { type: 'lowpass', f: 3800 * v + 800, f1: 280, ft: .25, q: .6, a: .001, h: .02, d: .2 + .2 * v, g: .7 * v });
      const n = Math.floor(4 + 9 * v); for (let k = 0; k < n; k++) { const dt = .03 + Math.pow(r(), 1.4) * (.3 + .5 * v), a = (1 - dt) * v; nz(R, d, t + dt, { f: 900 + r() * 2400, q: 2 + r() * 3, a: .0006, d: .012 + r() * .03, g: .3 * a }); if (r() < .5) tone(R, d, t + dt, { type: 'triangle', f: 180 + r() * 240, f1: 130, ft: .03, a: .001, d: .04, g: .2 * a }); }
      tone(R, d, t + .04, { f: 2380, a: .0006, d: .35, g: .03 * v }); tone(R, d, t + .04, { f: 3990, a: .0006, d: .2, g: .015 * v }); return .5 + .6 * v; },
    /** something fast passing close (near miss) */
    whoosh(R, d, t, o) { const g = OG(o); nz(R, d, t, { kind: 'pink', f: 500, f1: 1500, ft: .12, q: .9, a: .08, h: .02, d: .22, g: .32 * g }); nz(R, d, t, { kind: 'brown', f: 190, q: .7, a: .07, h: .03, d: .2, g: .5 * g }); return .4; },
    bike_bell(R, d, t, o) { const g = OG(o); for (const dt of [0, .13]) { for (const [m, a, dd] of [[1, .12, .5], [2.71, .07, .32], [5.2, .03, .16]]) tone(R, d, t + dt, { f: 2080 * m, a: .0006, d: dd, g: a * g }); nz(R, d, t + dt, { f: 4200, q: 3, a: .0004, d: .008, g: .12 * g }); } return .7; },
    /** another rider's weedy double beep */
    scooter_beep(R, d, t, o) { const g = OG(o), b = G(R, g); b.connect(d); hornNote(R, b, t, .13, true); hornNote(R, b, t + .21, .19, true); return .6; },
    /** bus doors: air dump, then the leaves thump home */
    bus_door(R, d, t, o) { const g = OG(o); nz(R, d, t, { type: 'highpass', f: 2600, q: .6, a: .015, h: .28, d: .4, g: .22 * g }); nz(R, d, t, { f: 3900, f1: 1700, ft: .7, q: .8, a: .01, h: .2, d: .5, g: .2 * g });
      nz(R, d, t, { kind: 'pink', type: 'lowpass', f: 500, q: .6, a: .02, h: .2, d: .3, g: .16 * g }); tone(R, d, t + .62, { f: 120, f1: 60, ft: .06, a: .002, d: .09, g: .4 * g }); nz(R, d, t + .62, { f: 1500, q: 1.2, a: .001, d: .03, g: .25 * g }); return .95; },
    boat_horn(R, d, t, o) { const g = OG(o), out = G(R, 0), lp = BQ(R, 'lowpass', 420, .8); for (const [f, type, a] of [[87.3, 'sawtooth', .5], [87.9, 'sawtooth', .4], [131, 'sawtooth', .25], [174.6, 'square', .1]]) chain(OSC(R, type, f, t, t + 3.2), G(R, a), lp);
      chain(lp, out, d); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(.5 * g, t + .3); out.gain.setValueAtTime(.5 * g, t + 1.9); out.gain.linearRampToValueAtTime(0, t + 3.0); return 3.1; },
    /** one bird phrase. kind: 'sparrow' (chirp burst) | 'bulbul' (whistled phrase) | 'tit' (two-note) — random if omitted */
    bird(R, d, t, o) { const r = R.rnd, g = OG(o), kind = (o && o.kind) || (r() < .55 ? 'sparrow' : r() < .6 ? 'bulbul' : 'tit'); let tt = t;
      if (kind === 'sparrow') { const n = 2 + Math.floor(r() * 4), f = 3600 + r() * 1200; for (let k = 0; k < n; k++) { tone(R, d, tt, { f: f * (1.25 + r() * .1), f1: f * (.8 + r() * .1), ft: .035, a: .004, d: .045, g: .06 * g }); tt += .09 + r() * .07; } }
      else if (kind === 'bulbul') { const base = 2100 + r() * 500, seq = [[1, 1.3, .09], [1.32, 1.18, .07], [1.5, 1.1, .12], [1.2, 1.45, .1]], n = 3 + Math.floor(r() * 2); for (let k = 0; k < n; k++) { const s = seq[(k + Math.floor(r() * 2)) % 4]; tone(R, d, tt, { f: base * s[0], f1: base * s[1], ft: s[2], a: .012, h: s[2] * .5, d: s[2] * .6, g: .05 * g }); tt += s[2] + .05 + r() * .05; } }
      else { const f = 5200 + r() * 900; for (let k = 0; k < 2 + Math.floor(r() * 3); k++) { tone(R, d, tt, { f, f1: f * .92, ft: .05, a: .005, h: .03, d: .04, g: .04 * g }); tone(R, d, tt + .1, { f: f * .78, a: .005, h: .03, d: .04, g: .04 * g }); tt += .24; } }
      return tt - t + .1; },
    /** a small flock taking off */
    flap(R, d, t, o) { const r = R.rnd, g = OG(o), n = 7 + Math.floor(r() * 5); let tt = t; for (let k = 0; k < n; k++) { nz(R, d, tt, { kind: 'pink', type: 'lowpass', f: 1500 - k * 60, q: .7, a: .008, d: .035, g: .22 * g * (1 - k / n * .6) }); nz(R, d, tt, { f: 2600, q: 1, a: .004, d: .02, g: .06 * g }); tt += .07 + r() * .025 + k * .004; } return tt - t + .1; },
    /** mahjong tiles: {kind:'shuffle'} = washing the tiles (1.5 s of clicks), otherwise one or two tiles slapped down */
    mahjong(R, d, t, o) { const r = R.rnd, g = OG(o), sh = o && o.kind === 'shuffle', n = sh ? 26 + Math.floor(r() * 14) : 1 + Math.floor(r() * 2), span = sh ? 1.5 : .12; let last = 0;
      for (let k = 0; k < n; k++) { const dt = sh ? Math.pow(r(), .8) * span : k * (.06 + r() * .05), f = 2500 + r() * 1900; nz(R, d, t + dt, { f, q: 3.5, a: .0004, d: .007 + r() * .01, g: (sh ? .3 : .6) * g * (.6 + r() * .6) }); tone(R, d, t + dt, { f: f * .52, a: .0004, d: .012, g: (sh ? .07 : .15) * g }); last = Math.max(last, dt); }
      if (sh) nz(R, d, t, { kind: 'pink', f: 1800, q: .6, a: .2, h: span - .5, d: .3, g: .05 * g }); return last + .1; },
    pickup(R, d, t) { tone(R, d, t, { f: 880, a: .003, h: .02, d: .06, g: .16 }); tone(R, d, t + .07, { f: 1320, a: .003, h: .03, d: .14, g: .18 }); tone(R, d, t + .07, { f: 2640, a: .003, d: .07, g: .03 }); return .3; },
    /** phone out / away. {open:false} for the pocket */
    ui_phone(R, d, t, o) { const op = !(o && o.open === false); nz(R, d, t, { kind: 'pink', f: op ? 900 : 1800, f1: op ? 2400 : 700, ft: .12, q: .8, a: .02, d: .1, g: .1 }); tone(R, d, t + .1, { f: op ? 1500 : 1100, a: .001, d: .03, g: .14 }); return .18; },
    /** mission card / objective line sliding in */
    ui_card(R, d, t) { nz(R, d, t, { kind: 'pink', f: 600, f1: 2200, ft: .18, q: .7, a: .05, d: .14, g: .09 }); tone(R, d, t + .16, { f: 1046.5, a: .003, d: .09, g: .12 }); tone(R, d, t + .16, { f: 1568, a: .003, d: .07, g: .05 }); return .3; },
    /* stings: original four/five-note motifs on a plucked string + bell, D pentatonic */
    sting_start(R, d, t) { drum(R, d, t, .4); [[0, 62], [.11, 66], [.22, 69], [.36, 74]].forEach((n, i) => pluck(R, d, t + n[0], n[1], .16, i === 3 ? .8 : .45)); bell(R, d, t + .36, 86, .035, 1); return 1.3; },
    sting_complete(R, d, t) { drum(R, d, t, .4); drum(R, d, t + .46, .3); [[0, 69], [.1, 74], [.2, 78], [.3, 81], [.46, 86]].forEach((n, i) => pluck(R, d, t + n[0], n[1], .15, i === 4 ? 1 : .45));
      for (const m of [74, 78, 81]) bell(R, d, t + .46, m, .028, 1.3); nz(R, d, t + .46, { type: 'highpass', f: 6000, q: .7, a: .1, d: .5, g: .02 }); return 1.9; },
    sting_fail(R, d, t) { [[0, 71], [.16, 69], [.32, 65], [.52, 62]].forEach((n, i) => pluck(R, d, t + n[0], n[1], .15, i === 3 ? .9 : .5));
      tone(R, d, t + .52, { f: 73.4, f1: 69, ft: .9, a: .004, h: .05, d: 1, g: .3 }); tone(R, d, t + .52, { type: 'sawtooth', f: 146.8, lp: 600, lp1: 200, lpt: .7, a: .004, d: .8, g: .08 }); return 1.7; },
    sting_ach(R, d, t) { pluck(R, d, t, 74, .16, .6); [[0, 86], [.06, 90], [.12, 93], [.18, 98]].forEach(n => bell(R, d, t + n[0], n[1], .1, .7)); nz(R, d, t + .1, { type: 'highpass', f: 7000, q: .7, a: .05, d: .35, g: .018 }); return 1.1; }
  });
  Object.assign(SFX_BUS, { footstep: 'self', cloth: 'self', gear: 'self', land: 'self', ui_tick: 'ui', ui_ok: 'ui', ui_bad: 'ui', star: 'ui', cash: 'ui', pickup: 'ui', ui_phone: 'ui', ui_card: 'ui',
    sting_start: 'music', sting_complete: 'music', sting_fail: 'music', sting_ach: 'music', bike_bell: 'world', scooter_beep: 'world', bus_door: 'world', boat_horn: 'world', bird: 'world', flap: 'world', mahjong: 'world' });
  const SFX_CAT = { bird: 'amb', flap: 'amb', mahjong: 'amb', boat_horn: 'amb', bike_bell: 'veh', scooter_beep: 'veh', bus_door: 'veh', horn: 'veh', crash: 'veh' };

  /* ---------------------------------------------------------------- the hero's e-scooter (non-positional: you are sitting on it) */
  function makeScooter(R) {
    const ac = R.ac, Sc = {}, out = G(R, 0); out.connect(R.engineBus);
    const f0 = ac.createConstantSource(); f0.offset.value = 55; f0.start();                         // hub-motor electrical frequency; every motor pitch hangs off it
    const mk = (type, mult) => { const o = OSC(R, type, 0, 0), g = G(R, 0); chain(f0, G(R, mult), o.frequency); o.connect(g); return g; };
    const tri = mk('triangle', 1), saw = mk('sawtooth', .5), h3 = mk('sine', 3.02), reg = mk('sine', 2);
    const mlp = BQ(R, 'lowpass', 1800, .7), mot = G(R, 1); tri.connect(mlp); saw.connect(mlp); chain(mlp, mot, out); h3.connect(mot);
    const trem = G(R, .6); chain(OSC(R, 'sine', 23, 0), G(R, .4), trem.gain); chain(reg, trem, mot);    // regen: the second harmonic with a 23 Hz flutter
    const pwm = G(R, 0); chain(OSC(R, 'sine', 4150, 0), pwm, out);                                       // controller whistle, only under load
    const roll = G(R, 0), rollBP = BQ(R, 'bandpass', 400, .7), rollAM = G(R, 1), jo = OSC(R, 'triangle', 0, 0), jd = G(R, 0);
    chain(jo, jd, rollAM.gain); chain(NOISE(R, 'pink', 0), rollBP, rollAM, roll, out);                    // tyre roll; pavers add a joint buzz
    const wet = G(R, 0); chain(NOISE(R, 'white', 0), BQ(R, 'highpass', 3600, .6), wet, out);              // spray hiss on wet ground
    const wind = G(R, 0), windBP = BQ(R, 'bandpass', 700, .5); chain(NOISE(R, 'pink', 0), windBP, wind, out);
    /** p: {on, speed m/s, thr 0..1, brake 0..1, surface, wet 0..1} */
    Sc.set = function (p, t, tc) {
      t = t === undefined ? ac.currentTime : t; tc = tc === undefined ? .07 : tc;
      const v = Math.abs(+p.speed || 0), thr = clamp(+p.thr || 0, 0, 1), brk = clamp(+p.brake || 0, 0, 1), s = clamp(v / 14, 0, 1), moving = sstep(v, .15, 1.2), m = Math.max(moving, thr * .6), sf = p.surface || 'asphalt', w = clamp(+p.wet || 0, 0, 1);
      tgt(f0.offset, 55 + v * 40 - 12 * thr * (1 - s), t, tc);                                            // pitch rises with speed and sags a little under load
      tgt(tri.gain, m * (.035 + .075 * thr), t, tc); tgt(saw.gain, m * .05 * thr, t, tc); tgt(h3.gain, m * (.006 + .02 * thr) * (.4 + .6 * s), t, tc);
      tgt(reg.gain, moving * brk * .07 * sstep(v, 1, 5), t, tc); tgt(pwm.gain, .006 * thr * m, t, tc); tgt(mlp.frequency, 900 + 2600 * s + 1500 * thr, t, tc);
      const rough = sf === 'paver' ? 1.25 : sf === 'concrete' ? 1.1 : sf === 'dirt' || sf === 'grass' ? 1.5 : 1;
      tgt(roll.gain, .2 * Math.pow(s, 1.2) * rough, t, .12); tgt(rollBP.frequency, (sf === 'dirt' || sf === 'grass' ? 200 : sf === 'paver' ? 380 : 260) + 700 * s, t, .12);
      tgt(jo.frequency, v * 3.3, t, .1); tgt(jd.gain, sf === 'paver' ? .45 : 0, t, .15); tgt(wet.gain, .09 * w * s, t, .2);
      tgt(wind.gain, .2 * s * s, t, .2); tgt(windBP.frequency, 500 + 1100 * s, t, .2); tgt(out.gain, p.on ? 1 : 0, t, .08);
    };
    Sc.set({ on: false }, 0, 0);
    return Sc;
  }

  /* ---------------------------------------------------------------- other traffic: one pooled voice per nearby vehicle, doppler from its closing speed */
  function makePass(R, kind, dest, t) {
    let rb = null; try { rb = GT.samples && GT.samples.passBuffer ? GT.samples.passBuffer(kind) : null; } catch (e) { rb = null; }
    if (rb && rb.buf && rb.buf.sampleRate === R.ac.sampleRate) {   /* recorded engine loop (js/samples.js) for cars, vans, buses and motorbikes: pitch follows speed, the synth tyre noise stays under it */
      const g = G(R, 0), src = R.ac.createBufferSource(), eg = G(R, 0), lpf = BQ(R, 'lowpass', 2400, .7), tn = NOISE(R, 'pink', t), tbp = BQ(R, 'bandpass', 600, .8), tg = G(R, 0);
      src.buffer = rb.buf; src.loop = true; src.start(t, R.rnd() * rb.buf.duration); chain(src, lpf, eg, g); chain(tn, tbp, tg, g); g.connect(dest);
      return { set(v, dop, tt) { const s = clamp(Math.abs(v) / 14, 0, 1.3), big = kind === 'bus';
          tgt(src.playbackRate, clamp((rb.r0 + rb.r1 * s) * dop, .4, 2.4), tt, .12); tgt(eg.gain, rb.g * (.55 + .45 * Math.min(1, s)), tt, .15); tgt(lpf.frequency, 900 + 2600 * Math.min(1, s), tt, .15);
          tgt(tbp.frequency, (big ? 420 : 620) * (1 + .5 * s) * dop, tt, .08); tgt(tg.gain, (big ? .5 : .4) * Math.pow(s, 1.3), tt, .15); tgt(g.gain, 1, tt, .15); },
        stop(tt) { tgt(g.gain, 0, tt, .1); src.stop(tt + .7); tn.stop(tt + .7); } };
    }
    const big = kind === 'bus', two = kind === 'escooter' || kind === 'trike' || kind === 'moto', g = G(R, 0), eng = OSC(R, two ? 'triangle' : 'sawtooth', 60, t), elp = BQ(R, 'lowpass', big ? 240 : two ? 2200 : 320, .8), eg = G(R, 0),
      tn = NOISE(R, 'pink', t), tbp = BQ(R, 'bandpass', 600, .8), tg = G(R, 0); let am = null;
    chain(eng, elp, eg, g); chain(tn, tbp, tg, g); g.connect(dest);
    if (big) { am = OSC(R, 'sine', 13, t); chain(am, G(R, .25), eg.gain); }                              // diesel rattle
    return { set(v, dop, tt) { const s = clamp(Math.abs(v) / 14, 0, 1.3), cents = 1200 * Math.log2(dop);
        tgt(eng.frequency, two ? 60 + v * 38 : big ? 38 + v * 2.2 : 52 + v * 4, tt, .1); tgt(eng.detune, cents, tt, .08);
        tgt(eg.gain, two ? .07 * s : big ? .3 + .12 * s : .22 + .15 * s, tt, .15); tgt(tbp.frequency, (two ? 900 : big ? 420 : 620) * (1 + .5 * s) * dop, tt, .08); tgt(tg.gain, (two ? .14 : big ? .5 : .45) * Math.pow(s, 1.3), tt, .15); tgt(g.gain, 1, tt, .15); },
      stop(tt) { tgt(g.gain, 0, tt, .1); eng.stop(tt + .7); tn.stop(tt + .7); if (am) am.stop(tt + .7); } };
  }

  /* ---------------------------------------------------------------- the city bed: positional emitters that start when you are in range and the hour is right */
  /** smooth 0..1 window over the clock, wrap-aware (a > b spans midnight) */
  function win(h, a, b, f) { f = f || .5; return a <= b ? sstep(h, a - f, a + f) * (1 - sstep(h, b - f, b + f)) : Math.max(sstep(h, a - f, a + f), 1 - sstep(h, b - f, b + f)); }
  function lfoGate(R, hz, th, w, t) { const o = OSC(R, 'sine', hz, t), s = SH(R, x => sstep(x, th - w, th + w)); o.connect(s); return { node: s, o }; }
  /* square-dance tune: original, D pentatonic, 118 bpm, eight bars of 8th notes. digits index SCALE, '-' holds, '.' rests */
  const DANCE = { scale: [62, 64, 66, 69, 71, 74, 76, 78, 81], bars: ['3-432-1-', '0-123--.', '5-434-5-', '6-543--.', '33432-1-', '01235-4-', '3-212-31', '0---0.5.'], bass: [38, 38, 43, 45, 38, 47, 43, 38] };
  function danceStep(R, d, i, t, sd) { const bar = Math.floor(i / 8) % 8, s = i % 8, row = DANCE.bars[bar], root = DANCE.bass[bar];
    if (s % 2 === 0) I.kick(R, d, t, .5, { f: 140, f1: 48, d: .2 }); if (s === 2 || s === 6) I.clap(R, d, t, .2); if (s % 2 === 1) I.hat(R, d, t, .07, s === 7);
    if (s === 0 || s === 4) I.subBass(R, d, t, root + 12, sd * 1.4, .2); else if (s === 2 || s === 6) I.subBass(R, d, t, root + 19, sd * .9, .14);
    const c = row.charCodeAt(s); if (c >= 48 && c <= 57) { let len = 1; while (s + len < 8 && row[s + len] === '-') len++; const m = DANCE.scale[c - 48]; I.leadSq(R, d, t, m + 12, sd * len * .85, .07); I.pluck(R, d, t, m + 24, .1); }
    if (s === 0 && bar % 4 === 0) bell(R, d, t, 86, .03, .8); }
  const EMIT = {
    /** hot oil on a flat-top: bright noise whose level crackles, plus spits */
    sizzle(R, d, t) { const g = G(R, 0), cr = G(R, .3), n1 = NOISE(R, 'white', t), n2 = NOISE(R, 'brown', t, undefined, 1.7), r = R.rnd;
      chain(n2, BQ(R, 'lowpass', 25, .5), G(R, 3), SH(R, x => sstep(x, -.3, .8)), G(R, .8), cr.gain); chain(n1, BQ(R, 'highpass', 3200, .6), BQ(R, 'peaking', 6500, 1, 6), cr, g, d); tgt(g.gain, .4, t, .3);
      return { stop(tt) { tgt(g.gain, 0, tt, .1); n1.stop(tt + .6); n2.stop(tt + .6); }, seqs: [tt => { nz(R, d, tt, { type: 'highpass', f: 2500 + r() * 3000, q: .7, a: .0004, d: .005 + r() * .012, g: .1 + r() * .14 }); return .06 + r() * r() * .7; }] }; },
    /** steamer baskets / a stock pot venting */
    steam(R, d, t) { const g = G(R, 0), am = G(R, .6), n = NOISE(R, 'white', t), l = OSC(R, 'sine', .23, t); chain(l, G(R, .22), am.gain); chain(n, BQ(R, 'bandpass', 5200, .6), BQ(R, 'highpass', 2500, .6), am, g, d); tgt(g.gain, .32, t, .4);
      return { stop(tt) { tgt(g.gain, 0, tt, .1); n.stop(tt + .6); l.stop(tt + .6); } }; },
    /** chatter: three independent gibberish speakers over a murmur */
    walla(R, d, t, o) { const g = G(R, 0), bus = G(R, 1), bed = NOISE(R, 'pink', t); chain(bus, BQ(R, 'lowpass', 2600, .6), BQ(R, 'highpass', 220, .6), g, d); chain(bed, BQ(R, 'bandpass', 520, .9), G(R, .04), bus); tgt(g.gain, 1, t, .5);
      const voice = k => { const r = rngOf('walla' + o.id + k); let left = 0, f0 = 150; return tt => { if (left <= 0) { left = 3 + Math.floor(r() * 6); f0 = r() < .5 ? 105 + r() * 50 : 185 + r() * 70; return .2 + r() * 1.3; } left--; const dur = .07 + r() * .12; syll(R, bus, tt, f0 * (.9 + r() * .25), dur, .4 + r() * .45, r); return dur + .02 + r() * .05; }; };
      return { stop(tt) { tgt(g.gain, 0, tt, .15); bed.stop(tt + 1); }, seqs: [voice(0), voice(1), voice(2)] }; },
    /** a stall's recorded loudspeaker call: the same sing-song gibberish phrase every few seconds, through a small horn speaker */
    vendor(R, d, t, o) { const g = G(R, 0), bus = G(R, 1); chain(bus, BQ(R, 'highpass', 520, .8), BQ(R, 'lowpass', 2700, .8), BQ(R, 'peaking', 1500, 1.2, 6), SH(R, x => Math.tanh(3 * x) * .6), g, d); tgt(g.gain, 2, t, .3);
      return { stop(tt) { tgt(g.gain, 0, tt, .12); }, seqs: [tt => { const r = rngOf('vendor' + o.id), f0 = 150 + r() * 60, n = 5 + Math.floor(r() * 3); let x = tt;
        tone(R, bus, x, { type: 'square', f: 1180, a: .003, h: .05, d: .02, g: .1 }); x += .12;                                               // the recorder's start blip
        for (let k = 0; k < n; k++) { const long = k === n - 1 || k === 2, dur = long ? .32 + r() * .15 : .12 + r() * .06; syll(R, bus, x, f0 * [1, 1.12, 1.26, 1.12, 1, .94, .84][k % 7], dur, 1.1, r); x += dur + (k === 2 ? .22 : .04); }
        return x - tt + 1.5 + (o.gap || 0); }] }; },
    mahjong(R, d) { const r = R.rnd; return { stop() {}, seqs: [tt => { const sh = r() < .1; ONE.mahjong(R, d, tt, { kind: sh ? 'shuffle' : 'clack' }); return sh ? 2.6 + r() * 2 : .3 + r() * 1.7; }] }; },
    /** the aunties' trolley speaker: the tune through a boxy, slightly overdriven PA */
    dance(R, d, t) { const g = G(R, 0), bus = G(R, 1), sd = 60 / 118 / 2; let i = 0; chain(bus, BQ(R, 'highpass', 170, .8), BQ(R, 'lowpass', 3600, .7), BQ(R, 'peaking', 900, 1, 4), SH(R, x => Math.tanh(1.8 * x) / Math.tanh(1.8) * .8), g, d); tgt(g.gain, .8, t, .5);
      return { stop(tt) { tgt(g.gain, 0, tt, .15); }, seqs: [tt => { danceStep(R, bus, i++, tt, sd); return sd; }] }; },
    /** river against the embankment: short irregular laps, a little foam */
    river(R, d, t) { const g = G(R, 0), sg = G(R, .25), fg = G(R, 0), w1 = lfoGate(R, .37, .1, .8, t), w2 = lfoGate(R, .23, .3, .7, t), n = NOISE(R, 'brown', t), n2 = NOISE(R, 'white', t), r = R.rnd;
      chain(w1.node, G(R, .5), sg.gain); chain(w2.node, G(R, .35), sg.gain); chain(w1.node, G(R, .05), fg.gain); chain(n, BQ(R, 'lowpass', 700, .6), BQ(R, 'highpass', 140, .6), sg, G(R, 1.2), g); chain(n2, BQ(R, 'bandpass', 2600, .6), fg, g); g.connect(d); tgt(g.gain, 1, t, .6);
      return { stop(tt) { tgt(g.gain, 0, tt, .2); for (const x of [n, n2, w1.o, w2.o]) x.stop(tt + 1.2); }, seqs: [tt => { tone(R, g, tt, { f: 500 + r() * 700, f1: 900 + r() * 900, ft: .03, a: .003, d: .03 + r() * .03, g: .03 + r() * .04 }); return .5 + r() * 2.5; }] }; },       // plips
    /** neon transformer + tube fizz (50 Hz mains) */
    neon(R, d, t) { const g = G(R, 0), fz = G(R, .2), os = [OSC(R, 'sawtooth', 100, t), OSC(R, 'sine', 50, t), OSC(R, 'square', 100, t)], n = NOISE(R, 'white', t);
      chain(os[0], BQ(R, 'lowpass', 800, .7), G(R, .22), g); chain(os[1], G(R, .16), g); chain(os[2], G(R, .2), fz.gain); chain(n, BQ(R, 'bandpass', 3600, 4), fz, G(R, .5), g); g.connect(d); tgt(g.gain, .6, t, .4);
      return { stop(tt) { tgt(g.gain, 0, tt, .1); for (const x of os) x.stop(tt + .6); n.stop(tt + .6); } }; },
    /** monorail: rubber-tyre rumble, running-gear hiss, traction hum that follows its speed */
    train(R, d, t) { const g = G(R, 0), n = NOISE(R, 'brown', t), n2 = NOISE(R, 'pink', t), hum = OSC(R, 'sawtooth', 180, t), wl = BQ(R, 'bandpass', 900, .7);
      chain(n, BQ(R, 'lowpass', 220, .7), BQ(R, 'highpass', 38, .7), G(R, .8), g); chain(n2, wl, G(R, .3), g); chain(hum, BQ(R, 'lowpass', 900, .8), G(R, .05), g); g.connect(d);
      return { set(v, tt) { const s = clamp(Math.abs(v) / 16, 0, 1); tgt(g.gain, .2 + .8 * s, tt, .3); tgt(hum.frequency, 120 + 260 * s, tt, .2); tgt(wl.frequency, 600 + 700 * s, tt, .2); }, stop(tt) { tgt(g.gain, 0, tt, .2); for (const x of [n, n2, hum]) x.stop(tt + 1.2); } }; }
  };
  /** where things are. Stall positions come from GT.snackstreet when it is built, otherwise from the layout constants (same numbers). */
  function cityEmitters() {
    const st = (GT.snackstreet && GT.snackstreet.stalls) || {}, E = [], at = (id, x, z) => { const s = st[id] && st[id].cook; return s ? [s.x, s.z] : [x, z]; };
    const add = (id, kind, p, range, gain, gate, o) => E.push(Object.assign({ id, kind, x: p[0], z: p[1], y: 1.2, range, gain, gate }, o || {}));
    const day = h => win(h, 6, 22.5, .7), meals = h => clamp(.3 * win(h, 6, 23, .5) + win(h, 6.3, 9.2) + win(h, 11, 13.5) + win(h, 17.3, 21.5), 0, 1);
    add('sz_shaokao', 'sizzle', at('shaokao', 27.6, -20.3), 20, .55, h => Math.max(win(h, 11, 13.5) * .6, win(h, 16.5, 23.8)));
    add('sz_chaofen', 'sizzle', at('chaofen', 36.4, 4), 20, .6, h => Math.max(win(h, 10.8, 13.8), win(h, 17, 22.5)));
    add('sz_shengjian', 'sizzle', at('shengjian', 27.6, -3.6), 18, .5, h => Math.max(win(h, 6, 10.3), win(h, 16, 19.5) * .7));
    add('sz_doupi', 'sizzle', at('doupi', 27.6, .2), 18, .45, h => win(h, 5.8, 10));
    add('st_baozi', 'steam', at('baozi', 36.4, -12.7), 16, .5, h => win(h, 5.5, 11)); add('st_xiaomian', 'steam', at('xiaomian', 27.6, -12.7), 16, .4, day); add('st_noodle', 'steam', [49.2, -8], 16, .4, h => win(h, 6, 21));
    add('walla_s', 'walla', [32, -15], 30, .8, meals, { y: 1.5 }); add('walla_n', 'walla', [32, 3], 30, .7, meals, { y: 1.5 });
    add('walla_mkt', 'walla', [55, -62], 34, .8, h => win(h, 18.5, .5), { y: 1.5 }); add('walla_yard', 'walla', [48, 68], 22, .35, h => win(h, 9, 22.5), { y: 1.5 });
    add('vendor_fruit', 'vendor', at('fruit', 36.3, -16.5), 36, .5, h => win(h, 7, 20.5), { y: 1.8 }); add('vendor_mkt', 'vendor', [38, -60], 36, .5, h => win(h, 18.5, 23.8), { y: 1.8, gap: 1.2 });
    const mj = GT.hotpot && GT.hotpot.mahjong; add('mahjong', 'mahjong', mj && mj[0] && mj[1] ? [(mj[0].x + mj[1].x) / 2, (mj[0].z + mj[1].z) / 2] : [49, 66.2], 26, .8, h => win(h, 9, 23.3), { y: .9 });
    const pz = (GT.riverside && GT.riverside.layout && GT.riverside.layout.plaza) || { x: -34, z: 30 };
    add('dance', 'dance', [pz.x, pz.z], 75, 1, h => Math.max(win(h, 6.3, 8.3, .2), win(h, 18.3, 21.6, .2)), { cat: 'music', ref: 3, prio: 1, y: 1, lvl: .8 });
    add('river', 'river', [-60, 0], 52, .9, () => 1, { follow: true, ref: 8, y: -1.5 });
    [[27, -8], [30, -58], [62, -58], [36, 99.5]].forEach((p, i) => add('neon' + i, 'neon', p, 14, .5, (h, s) => sstep(s.night || 0, .3, .8), { y: 3, lvl: .15 }));
    return E;
  }
  const VERB = { walla: .5, vendor: .6, dance: .5, mahjong: .3 };   // how much of each emitter reaches the street reverb (scaled down with distance)
  function makeCity(R, amb) {
    const C = { act: {}, pass: {}, train: null, st: null, birdT: 1, hornT: 14 + R.rnd() * 30, bellT: 4, n: {} }, P = R.pool, defs = cityEmitters(), cnt = k => { C.n[k] = (C.n[k] || 0) + 1; };
    C.defs = defs;
    function start(def, x, z, t) { const u = P.alloc({ cat: def.cat || 'amb', x, y: def.y, z, lvl: def.lvl || .35, prio: def.prio || 0, dur: 0, ref: def.ref || 4 }, t); if (!u) return null;
      const eg = G(R, 0), sv = G(R, 0); eg.connect(u.g); chain(eg, sv, R.verbIn); const h = EMIT[def.kind](R, eg, t, def); h.u = u; h.eg = eg; h.sv = sv; h.q = (h.seqs || []).map(f => ({ f, next: t + .05 + R.rnd() * .4 })); cnt('emit:' + def.kind); return h; }
    function stop(h, t) { tgt(h.eg.gain, 0, t, .12); h.stop(t + .4); h.u.release(t + 1); }
    /** st: {x, y, z, fx, fz (camera forward), vx, vz, hours, night, indoor, vehicles:[{id,x,z,vx,vz,v,kind}], train:{x,y,z,speed,visible}} */
    C.update = function (st, t, tc) {
      C.st = st; P.listen(st.x, st.y === undefined ? 1.6 : st.y, st.z, st.fx || 0, st.fz === undefined ? 1 : st.fz, t, tc === undefined ? .06 : tc);
      const h = st.hours === undefined ? 12 : st.hours, night = st.night || 0;
      if (amb) amb({ night, traffic: .55 * win(h, 6, 23.5, 1) + .12, cicada: win(h, 12.5, 17.5, 1) * .5, surf: 0, hum: 0, whoosh: false, interior: st.interior || 0 }, t, tc === undefined ? .4 : tc);
      const SM = GT.samples, ek = k => { try { return SM && SM.emitGain ? clamp(+SM.emitGain(k), 0, 1) : 1; } catch (e) { return 1; } };   /* js/samples.js turns down the synth emitters its recordings replace (chatter, vendors, river laps) and the snack-street ones on other maps */
      for (const def of defs) { const x = def.x, z = def.follow ? st.z : def.z, d = Math.hypot(x - st.x, z - st.z), lvl = def.gain * def.gate(h, st) * (1 - sstep(d, def.range * .65, def.range)) * ek(def.kind); let a = C.act[def.id];
        if (a && a.u.dead) { a.stop(t); delete C.act[def.id]; a = null; }
        if (!a && lvl > .02) a = C.act[def.id] = start(def, x, z, t) || undefined;
        if (a) { if (lvl < .004) { stop(a, t); delete C.act[def.id]; } else { tgt(a.eg.gain, lvl, t, .25); tgt(a.sv.gain, (VERB[def.kind] || 0) * 4 / (4 + d), t, .25); if (def.follow) a.u.move(x, def.y, z, t, .2); } } }
      // traffic: the five nearest moving-or-idling vehicles get a voice
      const near = []; for (const v of st.vehicles || []) { const d = Math.hypot(v.x - st.x, v.z - st.z); if (d < 60 && v.kind !== 'sharebike') near.push([d, v]); } near.sort((a, b) => a[0] - b[0]); near.length = Math.min(near.length, 5);
      const keep = {};
      for (const [d, v] of near) { let p = C.pass[v.id]; if (p && p.u.dead) { p.h.stop(t); delete C.pass[v.id]; p = null; }
        if (!p) { const u = P.alloc({ cat: 'veh', x: v.x, y: .8, z: v.z, lvl: v.kind === 'bus' ? .7 : .45, dur: 0, ref: 5 }, t); if (!u) continue; p = C.pass[v.id] = { u, h: makePass(R, v.kind, u.g, t) }; cnt('pass:' + (v.kind === 'bus' ? 'bus' : v.kind === 'escooter' || v.kind === 'trike' || v.kind === 'moto' ? 'two' : 'car')); }
        const dx = (st.x - v.x) / (d || 1), dz = (st.z - v.z) / (d || 1), closing = ((v.vx || 0) - (st.vx || 0)) * dx + ((v.vz || 0) - (st.vz || 0)) * dz;
        p.u.move(v.x, .8, v.z, t, .08); p.h.set(v.v === undefined ? Math.hypot(v.vx || 0, v.vz || 0) : v.v, 343 / (343 - clamp(closing, -50, 50)), t); keep[v.id] = 1; }
      for (const id in C.pass) if (!keep[id]) { const p = C.pass[id]; p.h.stop(t); p.u.release(t + .8); delete C.pass[id]; }
      // monorail
      const tr = st.train, td = tr && tr.visible ? Math.hypot(tr.x - st.x, tr.z - st.z) : 1e9;
      if (C.train && (td > 170 || C.train.u.dead)) { C.train.h.stop(t); C.train.u.release(t + 1.5); C.train = null; }
      if (!C.train && td < 150) { const u = P.alloc({ cat: 'veh', x: tr.x, y: tr.y || 14, z: tr.z, lvl: .8, prio: 1, dur: 0, ref: 14 }, t); if (u) { C.train = { u, h: EMIT.train(R, u.g, t) }; cnt('emit:train'); } }
      if (C.train) { C.train.u.move(tr.x, tr.y || 14, tr.z, t, .1); C.train.h.set(tr.speed || 0, t); }
    };
    /** run the emitters' sequencers and the random one-shots (birds, boat horn, bells) up to `until` */
    C.tick = function (until) { const st = C.st; if (!st) return; const r = R.rnd, h = st.hours === undefined ? 12 : st.hours;
      for (const id in C.act) { const a = C.act[id]; if (!a) continue; for (const q of a.q) { let guard = 0; if (q.next < until - 1) q.next = until - .2; while (q.next < until && guard++ < 60) q.next += Math.max(.01, q.f(q.next)); } }
      const out = st.indoor ? .25 : 1, birds = (win(h, 5, 9.5, .6) + .22 * win(h, 9.5, 18, 1)) * out;
      if (C.birdT < until - 3) C.birdT = until; while (C.birdT < until) { if (birds > .03) { const a = r() * 6.283, d = 7 + r() * 22; playSfx(R, 'bird', C.birdT, { x: st.x + Math.sin(a) * d, y: 4 + r() * 6, z: st.z + Math.cos(a) * d, g: .8 + r() * .5 }); cnt('bird'); } C.birdT += (.5 + r() * 3.2) / Math.max(birds, .12); }
      if (C.hornT < until - 5) C.hornT = until + 10; if (C.hornT < until) { if (st.x < 5 && win(h, 6, 23, .5) > .5) { playSfx(R, 'boat_horn', C.hornT, { x: -150 - r() * 60, y: 2, z: st.z + (r() - .5) * 240, ref: 60, g: 1 }); cnt('boat_horn'); } C.hornT += 35 + r() * 60; }
      if (C.bellT < until - 5) C.bellT = until; if (C.bellT < until) { const two = (st.vehicles || []).filter(v => (v.kind === 'escooter' || v.kind === 'sharebike' || v.kind === 'trike') && Math.hypot(v.x - st.x, v.z - st.z) < 32 && Math.abs(v.v === undefined ? 1 : v.v) > 1.5);
        if (two.length) { const v = two[Math.floor(r() * two.length)], nm = v.kind === 'sharebike' ? 'bike_bell' : 'scooter_beep'; playSfx(R, nm, C.bellT, { x: v.x, y: 1, z: v.z, g: 1 }); cnt(nm); } C.bellT += 6 + r() * 13; } };
    C.stopAll = function (t) { for (const id in C.act) { if (C.act[id]) stop(C.act[id], t); delete C.act[id]; } for (const id in C.pass) { C.pass[id].h.stop(t); C.pass[id].u.release(t + .8); delete C.pass[id]; } if (C.train) { C.train.h.stop(t); C.train.u.release(t + 1); C.train = null; } };
    return C;
  }

  /* ================================================================== live state + public API */
  const S = { R: null, E: null, RD: null, SI: null, A: null, master: .8, cont: {}, loops: {}, timer: null,
    eng: { on: false, rpm: 0, load: 0, speed: 0 }, amb: { night: 0, traffic: .4, interior: 0, hum: 0 }, sir: { level: 0, distance: 100, rel: 0 },
    radioOn: false, station: 0, radioVol: .55, scanN: 0, scanBusy: 0 };
  function tick() { const R = S.R; if (!R || R.ac.state !== 'running') return; const now = R.ac.currentTime;
    S.RD.tick(now + .25);
    for (const k in S.loops) { const L = S.loops[k]; if (L.next < now) L.next = now + .02; while (L.next < now + .25) { L.fire(L.next); L.next += L.period(); } }
    if (S.tick2) S.tick2(); }
  const api = {
    stations: STATIONS.map(s => ({ name: s.name, tag: s.tag, bpm: s.bpm })),
    sfxNames: Object.keys(ONE).concat(Object.keys(CONT)),
    get ready() { return !!S.R; }, get ctx() { return S.R ? S.R.ac : null; }, get station() { return S.station; }, get radioOn() { return S.radioOn; },
    /** create the AudioContext + graph. Call from the first user gesture (click / keydown). Idempotent. */
    init() {
      if (S.R) return api.resume();
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      let ac; try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { return false; }
      const R = S.R = makeRig(ac, false); R.master.gain.value = S.master;
      S.E = makeEngine(R); S.RD = makeRadio(R); S.SI = makeSiren(R); S.A = makeAmb(R);
      S.E.set(S.eng, 0, 0); S.A.set(S.amb, 0, 0); S.SI.set(S.sir, 0, 0);
      if (S.radioOn) { S.radioOn = false; api.setRadio(true, S.station); }
      S.timer = setInterval(tick, 60); api.resume(); return true;
    },
    /** resume a suspended context (tab regained focus / autoplay policy). */
    resume() { if (S.R && S.R.ac.state === 'suspended' && !document.hidden) S.R.ac.resume(); return !!S.R; },
    /** master volume 0..1 (default 0.8). */
    setMaster(v) { S.master = clamp(+v || 0, 0, 1); if (S.R) S.R.master.gain.setTargetAtTime(S.master, S.R.ac.currentTime, .03); },
    /** per-frame. state (all optional): {engine:{on,rpm,load,speed}, night, traffic, interior, hum, pos:{x,z}, siren:{level,distance,rel}}.
        Unspecified night comes from GT.env.night; hum is derived from pos (distance to the store front) when pos is given. */
    update(dt, state) {
      state = state || {};
      if (state.engine) api.engine(state.engine);
      if (state.siren) api.siren(state.siren.level, state.siren.distance, state.siren.rel, state.siren.mode);
      const a = {}; let ch = false;
      for (const k of ['night', 'traffic', 'interior', 'hum', 'surf', 'cicada', 'whoosh']) if (state[k] !== undefined) { a[k] = state[k]; ch = true; }
      if (state.night === undefined && GT.env && Math.abs((GT.env.night || 0) - S.amb.night) > .01) { a.night = GT.env.night || 0; ch = true; }
      if (state.pos && state.hum === undefined && GT.L) { const st = GT.L.station.store, dx = Math.max(0, st.x0 - state.pos.x, state.pos.x - st.x1), dz = Math.max(0, st.z0 - state.pos.z, state.pos.z - st.z1); a.hum = clamp(1 - Math.hypot(dx, dz) / 28, 0, 1); ch = true; }
      if (ch) api.ambience(a);
      if (!S.R) return; S.E.update(dt); S.A.update(dt); tick();
    },
    /** engine({on, rpm 0..1 (0 = 720 rpm idle, 1 = 6200), load 0..1 (throttle), speed m/s (road + wind noise)}) — partial updates allowed. */
    engine(p) { Object.assign(S.eng, p || {}); if (!S.R) return; let rec = false; try { rec = !!(GT.samples && GT.samples.engine && GT.samples.engine(S.eng)); } catch (e) {} S.E.set(rec ? Object.assign({}, S.eng, { on: false }) : S.eng); },   /* js/samples.js drives recorded engine loops when it has them: the V8 synth then stays silent (road + wind noise keep running) */
    /** radio on/off, optional station index (0..2). Switching plays a tuning burst and drops in mid-song. */
    setRadio(on, station) {
      const idx = station === undefined ? S.station : ((station % STATIONS.length) + STATIONS.length) % STATIONS.length, was = S.radioOn, changed = idx !== S.station;
      S.radioOn = !!on; S.station = idx; if (!S.R) return idx; const R = S.R, t = R.ac.currentTime + .01, RD = S.RD;
      if (!on) { if (was) { RD.vol.gain.setTargetAtTime(0, t, .03); RD.stop(); nz(R, R.cabinBus, t, { f: 2200, q: 2, a: .0005, d: .01, g: .2 }); } return idx; }
      if (!was || changed) { RD.vol.gain.setTargetAtTime(S.radioVol, t, .03); RD.switchTo(idx, t, Math.floor(R.rnd() * 8) * 32 + 64); }
      return idx;
    },
    /** tune to the next station (turns the radio on). returns the new station index. */
    nextStation() { return api.setRadio(true, S.station + 1); },
    /** radio volume 0..1 (default .55). */
    setRadioVolume(v) { S.radioVol = clamp(+v || 0, 0, 1); if (S.R && S.radioOn) S.RD.vol.gain.setTargetAtTime(S.radioVol, S.R.ac.currentTime, .05); },
    /** siren(level 0..1 (0 = off; >= .6 switches wail → yelp; > .8 adds a second car), distance m, relSpeed m/s closing (+ approaching → pitch up), mode? 'wail'|'yelp') */
    siren(level, distance, relSpeed, mode) { S.sir = { level: +level || 0, distance: distance === undefined ? 40 : +distance, rel: +relSpeed || 0, mode }; if (!S.R) return; let rec = false; try { rec = !!(GT.samples && GT.samples.siren && GT.samples.siren(S.sir)); } catch (e) {} S.SI.set(rec ? { level: 0, distance: 100, rel: 0 } : S.sir); },   /* recorded wail / yelp in js/samples.js replace the synth horn driver */
    /** police-scanner blip: 'call' | 'unit' | 'clear'. returns its duration in seconds (0 if audio is not initialised). */
    scanner(event) { if (!S.R) return 0; const now = S.R.ac.currentTime, t = Math.max(now + .01, S.scanBusy + .05), d = scanner(S.R, t, event || 'unit', ++S.scanN); S.scanBusy = t + d; return t - now + d; },
    /** ambience({night 0..1, traffic 0..1, interior 0..1, hum 0..1, surf 0..1}) — partial updates allowed. */
    ambience(p) { Object.assign(S.amb, p || {}); if (S.R) S.A.set(S.amb); },
    /** sfx(name, opts). One-shots: door_open, door_close, ignition, horn{dur}, key_turn, seatbelt, crash{v 0..1}, glass{distance}, cash, ui_tick, ui_ok, ui_bad, star, thunk,
        heartbeat (one lub-dub, or {on, bpm} to loop), turn_signal (one tick, {tock:true} for the return click, or {on} to loop).
        Continuous: tire_squeal{level 0..1; 0 stops}, alarm_bell{on, distance}, horn{on:true/false} to hold. opts.g scales volume. Returns duration (s) for one-shots. */
    sfx(name, opts) {
      const R = S.R; if (!R) return 0; opts = opts || {}; const t = R.ac.currentTime + .004;
      if (CONT[name]) {
        const on = name === 'tire_squeal' ? (+opts.level || 0) > .01 : opts.on !== false; let h = S.cont[name];
        if (!on) { if (h) { h.stop(t); delete S.cont[name]; } return 0; }
        if (!h) h = S.cont[name] = CONT[name](R, SFX_BUS[name] === 'world' ? R.worldIn : R.cabinBus, t); h.set(opts, t); return 0;
      }
      if (name === 'horn' && opts.on !== undefined) { if (S.cont.horn) { S.cont.horn.stop(t); delete S.cont.horn; } if (opts.on) S.cont.horn = hornNote(R, R.cabinBus, t); return 0; }
      if ((name === 'heartbeat' || name === 'turn_signal') && opts.on !== undefined) {
        if (!opts.on) { delete S.loops[name]; return 0; }
        if (name === 'heartbeat') { const L = S.loops[name] || (S.loops[name] = { next: t }); L.bpm = opts.bpm || L.bpm || 80; L.g = opts.g; L.period = () => 60 / L.bpm; L.fire = tt => playSfx(R, 'heartbeat', tt, { g: L.g }); }
        else if (!S.loops[name]) { const L = S.loops[name] = { next: t, k: 0, period: () => .36 }; L.fire = tt => playSfx(R, 'turn_signal', tt, { tock: (L.k++ & 1) === 1, g: opts.g }); }
        return 0;
      }
      return playSfx(R, name, t, opts);
    }
  };
  GT.audio = api;

  /* ================================================================== "alive" layer: public API additions (footsteps, scooter, city, categories, stats, selftest) */
  Object.assign(S, { SC: null, CITY: null, n: {}, cityT: -1, sc: { on: false, speed: 0, thr: 0, brake: 0 }, indoor: 0, cat: Object.assign({}, CAT_DEFAULT), hooked: false });
  const count = k => { S.n[k] = (S.n[k] || 0) + 1; };
  function onWood(x, z) { const L = GT.riverside && GT.riverside.layout; if (!L || x === undefined) return false; for (const k of ['deck', 'pier']) { const d = L[k]; if (d && x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) return true; } return false; }
  function isWet(x, z) { if (GT.env && GT.env.wet > .35) return true; const F = GT.fxsmall; if (F && F.wetAt && x !== undefined) { try { return !!F.wetAt(x, z); } catch (e) { return false; } } return false; }
  Object.assign(api, {
    categories: Object.keys(CAT_DEFAULT),
    /** one footfall — the on-foot controller calls this from its 'step' event: {foot, speed, surface, crouch, x, z}.
        surface is GT.cnroad.surfaceAt's name or 'indoor'; resolved here to asphalt | paver | concrete | tile | wood (river decks) | wet (puddles, rain, shallows).
        Running adds a cloth swish and, now and then, the jingle of keys / helmet strap. Returns the surface it played. */
    footstep(e) {
      e = e || {}; let sf = e.surface || 'asphalt';
      if (sf === 'indoor') sf = 'tile'; else if (sf === 'water') sf = 'wet'; else if (onWood(e.x, e.z)) sf = 'wood'; else if (isWet(e.x, e.z)) sf = 'wet'; else if (e.zone && /^snack/.test(e.zone)) sf = 'paver';   // the food lane is tiled paving, whatever the terrain map says
      count('footstep:' + sf); const R = S.R; if (!R) return sf; const t = R.ac.currentTime + .004, sp = +e.speed || 0; let rec = false; try { rec = !!(GT.samples && GT.samples.step && GT.samples.step(e, sf)); } catch (er) {}
      if (!rec) playSfx(R, 'footstep', t, { surface: sf, speed: sp, foot: e.foot, crouch: e.crouch });   /* a recorded footfall (js/samples.js, chosen by surface and gait) replaces the synth heel / toe */
      if (sp > 2.5 && !e.crouch) { count('cloth'); playSfx(R, 'cloth', t + .03, { g: sp > 5 ? 1.3 : .9 }); if (R.rnd() < (sp > 5 ? .7 : .4)) { count('gear'); playSfx(R, 'gear', t + .05, { g: sp > 5 ? 1.2 : .8 }); } }
      return sf;
    },
    /** the hero's e-scooter, every frame while riding: {on, speed m/s, thr 0..1, brake 0..1, surface, wet 0..1}. Partial updates allowed; {on:false} fades it out. */
    scooter(p) { Object.assign(S.sc, p || {}); if (S.R && S.SC) S.SC.set(S.sc); },
    /** the city bed, every frame: {x, y, z (listener = the player's head), fx, fz (camera forward), vx, vz, hours, night, interior 0..1, indoor,
        vehicles: [{id, x, z, vx, vz, v, kind}], train: {x, y, z, speed, visible}}. Starts / stops the positional emitters (stalls, chatter, vendors, mahjong, dance speaker,
        river, neon, monorail), gives the five nearest vehicles a doppler'd voice, and drives the non-positional bed (birds, distant traffic, crickets). */
    city(st) { const R = S.R; if (!R || !st) return; if (!S.CITY) S.CITY = makeCity(R, (p, t, tc) => { Object.assign(S.amb, p); S.A.set(S.amb, t, tc); });
      const now = R.ac.currentTime; if (now - S.cityT < .07 && !st.force) { R.pool.listen(st.x, st.y === undefined ? 1.6 : st.y, st.z, st.fx || 0, st.fz === undefined ? 1 : st.fz, now, .05); return; } S.cityT = now; S.CITY.update(st, now); },
    /** 0 = street (slap-back on your own footsteps), 1 = room (short bright reverb on them). The outside world is low-passed through ambience({interior}) / city({interior}). */
    interior(v) { v = clamp(+v || 0, 0, 1); S.indoor = v; const R = S.R; if (!R) return; const t = R.ac.currentTime; tgt(R.selfRoom.gain, .5 * v, t, .15); tgt(R.selfStreet.gain, .1 * (1 - v), t, .15); },
    /** per-category volume 0..1.5: 'sfx' | 'veh' | 'amb' | 'music' | 'ui' (defaults in CAT_DEFAULT). */
    setCategory(name, v) { if (!(name in CAT_DEFAULT)) return; S.cat[name] = clamp(+v || 0, 0, 1.5); const R = S.R; if (!R) return; const t = R.ac.currentTime; tgt(R.cat[name].gain, S.cat[name], t, .04); if (R.wcat[name]) tgt(R.wcat[name].gain, S.cat[name], t, .04); },
    getCategory(name) { return S.cat[name]; },
    /** the live rig's music bus + the note primitives, for cues written outside this file (js/cntrailer.js): {ac, out, tone(dest, t, o), nz(dest, t, o), gain(v), filter(type, f, q)} or null before init().
        Everything connected to `out` goes through the 'music' category gain, the master, the compressor and the ceiling like the stings do. */
    synth() { const R = S.R; if (!R) return null; return { ac: R.ac, out: R.musicBus, tone: (d, t, o) => tone(R, d, t, o), nz: (d, t, o) => nz(R, d, t, o), gain: v => G(R, v), filter: (type, f, q) => BQ(R, type, f, q) }; },
    /** the live rig for js/samples.js (recordings through the same categories, master, compressor and ceiling): {ac, cat, wcat, engineBus, cabinBus, selfBus, uiBus, musicBus, worldIn, verbIn,
        voice(o, t) → a pooled PannerNode slot {g (connect into it), move(x, y, z, t), release(t), dead} or null, listener {x, y, z}} — null before init() */
    rig() { const R = S.R; if (!R) return null; return { ac: R.ac, cat: R.cat, wcat: R.wcat, engineBus: R.engineBus, cabinBus: R.cabinBus, selfBus: R.selfBus, uiBus: R.uiBus, musicBus: R.musicBus, worldIn: R.worldIn, verbIn: R.verbIn, voice: (o, t) => R.pool.alloc(o, t === undefined ? R.ac.currentTime : t), listener: R.pool.lis }; },
    /** 0..1: how much of the synth city bed (traffic wash, cicadas, crickets) stays under the recorded ambience beds (js/samples.js sets it; 1 = all of it) */
    synthAmb(k) { S.ambK = clamp(+k, 0, 1); if (S.R && S.A) S.A.set(S.amb); },
    /** trigger counts since the last resetStats() + pool usage: {counts:{name:n}, voices:{active, peak, stolen, dropped, allocs}, state} */
    stats() { const R = S.R; return { counts: Object.assign({}, S.n, S.CITY ? S.CITY.n : {}), voices: R ? { active: R.pool.active(R.ac.currentTime), peak: R.pool.peak, stolen: R.pool.stolen, dropped: R.pool.dropped, allocs: R.pool.allocs } : null, state: R ? R.ac.state : 'none' }; },
    resetStats() { S.n = {}; if (S.CITY) S.CITY.n = {}; if (S.R) { const P = S.R.pool; P.peak = P.stolen = P.dropped = P.allocs = 0; } },
    /** offline proof (nobody can listen in a headless run): renders every new sound and three full scenes through an OfflineAudioContext copy of the live graph and
        returns [{name, dur, peakDb, rmsDb, band, hz, dc, first, last, over, flag}]. opts.print = true also writes the table into the page. opts.only = substring filter. */
    selftest(opts) { return selftest(opts || {}); }
  });
  const _sfx = api.sfx; api.sfx = function (name, opts) { if (!(opts && (opts.on === false || name === 'tire_squeal'))) count(name);
    if (S.R) {
      let recorded = 0;
      try { recorded = GT.samples?.sfx?.(name, opts || {}); } catch (e) {}
      if (recorded || name === 'tire_squeal') {
        if ((name === 'tire_squeal' || name === 'horn') && S.cont[name]) {
          S.cont[name].stop(S.R.ac.currentTime);
          delete S.cont[name];
        }
        return typeof recorded === 'number' ? recorded : 0;
      }
    }
    const R = S.R; if (R && name === 'horn' && opts && opts.on !== undefined && opts.weedy) { const t = R.ac.currentTime + .004; if (S.cont.horn) { S.cont.horn.stop(t); delete S.cont.horn; } if (opts.on) { const g = G(R, opts.g === undefined ? 1 : opts.g); g.connect(R.cabinBus); S.cont.horn = hornNote(R, g, t, undefined, true); } return 0; }
    return _sfx.call(api, name, opts); };
  const _init = api.init; api.init = function () { const had = !!S.R, ok = _init.call(api); const R = S.R; if (!R || had) return ok;
    S.SC = makeScooter(R); for (const k in S.cat) { R.cat[k].gain.value = S.cat[k]; if (R.wcat[k]) R.wcat[k].gain.value = S.cat[k]; } api.interior(S.indoor);
    if (!S.hooked) { S.hooked = true;   // browsers only let a context run after a gesture; a hidden tab should not keep synthesising
      const wake = () => api.resume(); addEventListener('pointerdown', wake); addEventListener('keydown', wake);
      document.addEventListener('visibilitychange', () => { if (!S.R) return; if (document.hidden) S.R.ac.suspend(); else S.R.ac.resume(); }); }
    return ok; };
  S.tick2 = function () { const R = S.R; if (!R || R.ac.state !== 'running' || !S.CITY) return; S.CITY.tick(R.ac.currentTime + .25); };

  /* ---------------------------------------------------------------- selftest: offline renders of the new layer */
  const BANDS = [['sub <80', 0, 80], ['low 80-250', 80, 250], ['low-mid 250-800', 250, 800], ['mid 0.8-2.5k', 800, 2500], ['high 2.5-6k', 2500, 6000], ['air >6k', 6000, 3e4]];
  async function offRender(id, dur, build, sr) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, ac = new OAC(2, Math.ceil(dur * sr), sr), R = makeRig(ac, 'stereo', 'st-' + id); build(R, dur);
    let buf = null, err = null; ac.startRendering().then(b => { buf = b; }, e => { err = e || new Error('render failed'); });
    for (let k = 0; !buf && !err && k < 6000; k++) { await new Promise(r => setTimeout(r, 0)); let junk = 0; for (let i = 0; i < 1200000; i++) junk += Math.sqrt(i); if (junk < 0) break; }   // virtual-time headless: burn real CPU until the render thread lands
    if (!buf) throw err || new Error('render timed out'); return [buf.getChannelData(0), buf.getChannelData(1)];
  }
  function analyse(l, r, sr) {
    const n = l.length; let pk = 0, ss = 0, dc = 0, over = 0, i0 = -1, i1 = -1;
    for (let i = 0; i < n; i++) { const a = Math.abs(l[i]), b = Math.abs(r[i]), m = a > b ? a : b; if (m > pk) pk = m; if (m > 1) over++; ss += l[i] * l[i] + r[i] * r[i]; dc += l[i] + r[i]; if (m > .001) { if (i0 < 0) i0 = i; i1 = i; } }
    const N = 4096, mono = new Float32Array(n), mag = new Float32Array(N / 2), avg = new Float64Array(N / 2); for (let i = 0; i < n; i++) mono[i] = (l[i] + r[i]) * .5;
    for (let off = 0; off < Math.max(1, n - N / 2); off += N / 2) { spectrum(mono, off, N, mag); for (let i = 0; i < N / 2; i++) avg[i] += Math.pow(10, mag[i] / 10); }
    const e = BANDS.map(() => 0); let hz = 0, hm = 0; for (let i = 1; i < N / 2; i++) { const f = i * sr / N; for (let b = 0; b < BANDS.length; b++) if (f >= BANDS[b][1] && f < BANDS[b][2]) e[b] += avg[i]; if (avg[i] > hm) { hm = avg[i]; hz = f; } }
    let bi = 0; for (let b = 1; b < e.length; b++) if (e[b] > e[bi]) bi = b;
    const first = Math.max(Math.abs(l[0]), Math.abs(r[0])), last = Math.max(Math.abs(l[n - 1]), Math.abs(r[n - 1])), dcv = dc / (2 * n);
    const o = { dur: i0 < 0 ? 0 : +((i1 - i0 + 1) / sr).toFixed(2), peakDb: +dB(pk).toFixed(1), rmsDb: +dB(Math.sqrt(ss / (2 * n))).toFixed(1), band: BANDS[bi][0], hz: Math.round(hz), dc: +dcv.toFixed(5), first: +first.toFixed(5), last: +last.toFixed(5), over };
    o.flag = over || pk >= 1 ? 'CLIP' : pk < .001 ? 'SILENT' : Math.abs(dcv) > .003 ? 'DC' : first > .01 || last > .01 ? 'CLICK' : 'ok'; return o;
  }
  const one = (name, opts, more) => R => { playSfx(R, name, .02, opts); if (more) more(R); };
  const emitJob = (kind, dist, o) => (R, dur) => { o = o || {}; R.pool.listen(0, 1.6, 0, 0, 1, 0, 0); const def = Object.assign({ id: 't', kind, y: 1.2 }, o), u = R.pool.alloc({ cat: def.cat || 'amb', x: 0, y: 1.2, z: dist, dur: 0, ref: def.ref || 4 }, 0), eg = G(R, 0); eg.connect(u.g); tgt(eg.gain, def.gain || .6, 0, .05);
    const h = EMIT[kind](R, eg, 0, def); for (const f of h.seqs || []) { let x = .05, guard = 0; while (x < dur - .9 && guard++ < 4000) x += Math.max(.01, f(x)); } if (h.set) h.set(o.v || 12, 0); tgt(eg.gain, 0, dur - .45, .05); h.stop(dur - .4); };
  const passJob = (kind, v) => (R, dur) => { R.pool.listen(0, 1.6, 0, 0, 1, 0, 0); const u = R.pool.alloc({ cat: 'veh', x: 5, y: .8, z: -40, dur: 0, ref: 5 }, 0), h = makePass(R, kind, u.g, 0);
    for (let t = 0; t < dur - .3; t += .05) { const z = -v * dur / 2 + v * t, d = Math.hypot(5, z), closing = -v * z / d; u.move(5, .8, z, t, t ? .05 : 0); h.set(v, 343 / (343 - closing), t); } h.stop(dur - .3); };
  const scootJob = f => (R, dur) => { const Sc = makeScooter(R); for (let t = 0; t < dur - .25; t += .04) Sc.set(Object.assign({ on: true, surface: 'asphalt' }, f(t)), t, t ? .05 : 0); Sc.set({ on: false }, dur - .25, .04); };
  /** a scene = the live update path driven by a script: f(t) returns {st (city state), sc (scooter params), ev: [[name, opts]] one-shots, steps} every 0.1 s */
  const sceneJob = f => (R, dur) => { const A = makeAmb(R), C = makeCity(R, (p, t, tc) => A.set(p, t, tc)), Sc = makeScooter(R), m = R.master.gain; m.setValueAtTime(0, 0); m.linearRampToValueAtTime(.8, .03); m.setValueAtTime(.8, dur - .04); m.linearRampToValueAtTime(0, dur - .005);
    for (let t = 0; t < dur; t += .1) { const s = f(t, R) || {}; if (s.st) { C.update(s.st, t, t ? .06 : 0); C.tick(t + .1); } if (s.sc) Sc.set(s.sc, t, t ? .07 : 0); if (s.interior !== undefined) { tgt(R.selfRoom.gain, .5 * s.interior, t, .15); tgt(R.selfStreet.gain, .1 * (1 - s.interior), t, .15); }
      for (const e of s.ev || []) playSfx(R, e[0], t + (e[2] || 0) + .01, e[1]); } R.sceneStats = { peak: R.pool.peak, stolen: R.pool.stolen, dropped: R.pool.dropped, emit: Object.assign({}, C.n) }; };
  function sceneWalk(t) {   // 07:30, walking north up the snack lane at 1.5 m/s, a short jog at 6-8 s
    const run = t >= 6 && t < 8, sp = run ? 3.6 : 1.5, z = -24 + (t < 6 ? 1.5 * t : t < 8 ? 9 + 3.6 * (t - 6) : 16.2 + 1.5 * (t - 8)), ev = [], k = Math.round(t * 10), every = run ? 3 : 5;
    if (k % every === 0) { const sf = z > -12 && z < -9 ? 'wet' : 'paver'; ev.push(['footstep', { surface: sf, speed: sp, foot: (k / every) & 1 ? 'L' : 'R' }]); if (run) ev.push(['cloth', { g: .9 }, .03]); }
    return { st: { x: 32, y: 1.6, z, fx: 0, fz: 1, vx: 0, vz: sp, hours: 7.5, night: 0 }, ev };
  }
  function sceneRide(t) {   // avenue, 12 m/s southbound, a bus passes the other way, horn, kerb, hard brake from 6 s, wall at 7.6 s, rider down
    const v = t < 6 ? 12 : t < 7.6 ? Math.max(4.5, 12 - (t - 6) * 4.7) : 0, z = 52 - (t < 6 ? 12 * t : t < 7.6 ? 72 + 12 * (t - 6) - 2.35 * (t - 6) * (t - 6) : 85.2), ev = [], k = Math.round(t * 10);
    if (k === 15) ev.push(['scooter_beep', { g: 1 }]); if (k === 40) ev.push(['kerb', { v: .6 }]); if (k === 70) ev.push(['brake_squeal', { v: .9 }]);
    if (k === 76) { ev.push(['scrape', { v: .45 }]); ev.push(['scooter_crash', { v: .5 }]); } if (k === 81) ev.push(['body_fall', { v: .8 }]); if (k === 98) ev.push(['ui_bad', {}]);
    const veh = [{ id: 'bus', kind: 'bus', x: -2, z: -60 + 9 * t, vx: 0, vz: 9, v: 9 }, { id: 'taxi', kind: 'taxi', x: 2.5, z: 38 - 10.5 * t, vx: 0, vz: -10.5, v: 10.5 }, { id: 'sc', kind: 'escooter', x: 7.4, z: 20 - 7 * t, vx: 0, vz: -7, v: 7 }];
    return { st: { x: 6.85, y: 1.5, z, fx: 0, fz: -1, vx: 0, vz: -v, hours: 12, night: 0, vehicles: veh }, sc: { on: t < 8.4, speed: v, thr: t < 6 ? .55 : 0, brake: t >= 6 && t < 7.6 ? 1 : 0, surface: 'asphalt', wet: 0 }, ev };
  }
  function scenePromenade(t) {   // 19:00, standing on the promenade 9 m from the dance speaker, river behind, a bell and a boat horn
    const ev = [], k = Math.round(t * 10); if (k === 25) ev.push(['boat_horn', { x: -170, y: 2, z: 90, ref: 60, g: 1 }]); if (k === 60) ev.push(['bike_bell', { x: -24, y: 1, z: 14, g: 1 }]); if (k === 85) ev.push(['ui_card', {}]);
    return { st: { x: -41, y: 1.6, z: 24, fx: .76, fz: .65, vx: 0, vz: 0, hours: 19, night: .55, vehicles: [{ id: 'b1', kind: 'sharebike', x: -22, z: 60 - 4 * t, vx: 0, vz: -4, v: 4 }] }, ev };
  }
  const WORST = (R, dur) => {   // everything at once: scooter flat out on wet pavers, six emitters, three vehicles, crash, stings, cash, horn — the limiter must hold
    const A = makeAmb(R), C = makeCity(R, (p, t, tc) => A.set(p, t, tc)), Sc = makeScooter(R), m = R.master.gain; m.setValueAtTime(0, 0); m.linearRampToValueAtTime(.8, .03); m.setValueAtTime(.8, dur - .04); m.linearRampToValueAtTime(0, dur - .005); Sc.set({ on: true, speed: 14, thr: 1, brake: 1, surface: 'paver', wet: 1 }, 0, 0);
    const veh = [{ id: 'bus', kind: 'bus', x: 30, z: -12, vx: 0, vz: 9, v: 9 }, { id: 't', kind: 'taxi', x: 34, z: -10, vx: 0, vz: -10, v: 10 }, { id: 's', kind: 'escooter', x: 31, z: -9, vx: 0, vz: 7, v: 7 }];
    for (let t = 0; t < dur; t += .1) { C.update({ x: 32, y: 1.6, z: -10, fx: 0, fz: 1, hours: 19, night: .6, vehicles: veh, train: { x: 40, y: 14, z: -10, speed: 16, visible: true } }, t, t ? .06 : 0); C.tick(t + .1); }
    for (const n of ['scooter_crash', 'crash', 'scrape', 'sting_complete', 'cash', 'body_fall', 'star']) playSfx(R, n, 1, { v: 1 }); hornNote(R, R.cabinBus, 1, .8); hornNote(R, R.cabinBus, 1.2, .5, true);
    for (let t = .5; t < dur - .3; t += .22) playSfx(R, 'footstep', t, { surface: 'wet', speed: 6 }); };
  const TESTS = [
    ['step asphalt walk', .5, one('footstep', { surface: 'asphalt', speed: 1.4 })], ['step paver walk', .5, one('footstep', { surface: 'paver', speed: 1.4 })], ['step concrete walk', .5, one('footstep', { surface: 'concrete', speed: 1.4 })],
    ['step tile (indoor)', .5, one('footstep', { surface: 'tile', speed: 1.4 })], ['step wood deck', .5, one('footstep', { surface: 'wood', speed: 1.4 })], ['step wet', .5, one('footstep', { surface: 'wet', speed: 1.4 })],
    ['step dirt', .5, one('footstep', { surface: 'dirt', speed: 1.4 })], ['step paver run', .5, one('footstep', { surface: 'paver', speed: 3.6 })], ['step asphalt sprint', .5, one('footstep', { surface: 'asphalt', speed: 6.2 })],
    ['step tile in room verb', .9, R => { R.selfRoom.gain.value = .5; R.selfStreet.gain.value = 0; playSfx(R, 'footstep', .02, { surface: 'tile', speed: 1.4 }); }],
    ['cloth', .4, one('cloth')], ['gear jingle', .4, one('gear')], ['box_rattle', .5, one('box_rattle')], ['land v=.6', .6, one('land', { v: .6 })], ['body_fall', .8, one('body_fall', { v: .8 })],
    ['kerb thunk', .6, one('kerb', { v: .7 })], ['kickstand down', .5, one('kickstand')], ['kickstand up', .5, one('kickstand', { up: true })], ['brake_squeal v=.8', .8, one('brake_squeal', { v: .8 })],
    ['scrape v=.3', .8, one('scrape', { v: .3 })], ['scrape v=1', 1, one('scrape', { v: 1 })], ['scooter_crash v=.4', 1, one('scooter_crash', { v: .4 })], ['scooter_crash v=1', 1.4, one('scooter_crash', { v: 1 })],
    ['whoosh (near miss)', .6, one('whoosh')], ['horn weedy .4s', .7, R => { hornNote(R, R.cabinBus, .02, .4, true); }], ['scooter_beep', .8, one('scooter_beep')], ['bike_bell', 1, one('bike_bell')],
    ['bus_door hiss', 1.2, one('bus_door')], ['boat_horn', 3.4, one('boat_horn')], ['bird sparrow', .8, one('bird', { kind: 'sparrow' })], ['bird bulbul', .9, one('bird', { kind: 'bulbul' })], ['bird tit', 1.1, one('bird', { kind: 'tit' })],
    ['flap (flock)', 1.2, one('flap')], ['mahjong clack', .4, one('mahjong')], ['mahjong shuffle', 1.9, one('mahjong', { kind: 'shuffle' })],
    ['pickup', .5, one('pickup')], ['cash ka-ching', .9, one('cash')], ['ui_tick', .2, one('ui_tick')], ['ui_ok', .5, one('ui_ok')], ['ui_bad', .6, one('ui_bad')], ['ui_phone', .4, one('ui_phone')], ['ui_card', .5, one('ui_card')],
    ['sting_start', 1.6, one('sting_start')], ['sting_complete', 2.2, one('sting_complete')], ['sting_fail', 2, one('sting_fail')], ['sting_ach', 1.4, one('sting_ach')],
    ['scooter cruise 12 m/s', 2, scootJob(() => ({ speed: 12, thr: .5 }))], ['scooter 0-12 full throttle', 4, scootJob(t => ({ speed: Math.min(12, t * 3.4), thr: 1 }))], ['scooter regen brake 12-0', 3, scootJob(t => ({ speed: Math.max(0, 12 - t * 5), brake: 1 }))],
    ['scooter 10 m/s wet pavers', 2, scootJob(() => ({ speed: 10, thr: .3, surface: 'paver', wet: 1 }))],
    ['emit sizzle @3m', 3, emitJob('sizzle', 3, { gain: .55 })], ['emit steam @3m', 3, emitJob('steam', 3, { gain: .5 })], ['emit walla @6m', 5, emitJob('walla', 6, { gain: .8 })], ['emit vendor @6m', 5, emitJob('vendor', 6, { gain: .5 })],
    ['emit mahjong @4m', 5, emitJob('mahjong', 4, { gain: .8 })], ['emit dance @9m', 8.4, emitJob('dance', 9, { gain: 1, ref: 3, cat: 'music' })], ['emit river @6m', 6, emitJob('river', 6, { gain: .9, ref: 8 })], ['emit neon @2m', 2, emitJob('neon', 2, { gain: .5 })],
    ['emit monorail @25m', 4, emitJob('train', 25, { gain: 1, ref: 14, cat: 'veh', v: 14 })], ['pass car 12 m/s', 6, passJob('taxi', 12)], ['pass bus 9 m/s', 7, passJob('bus', 9)], ['pass e-scooter 8 m/s', 5, passJob('escooter', 8)],
    ['SCENE snack street 07:30 walk', 12, sceneJob(sceneWalk)], ['SCENE avenue ride 12 m/s, brake, wall', 10, sceneJob(sceneRide)], ['SCENE promenade 19:00', 10, sceneJob(scenePromenade)], ['WORST CASE everything at once', 3, WORST]
  ];
  async function selftest(o) {
    const rows = [], sr = 44100, list = TESTS.filter(t => !o.only || t[0].toLowerCase().indexOf(String(o.only).toLowerCase()) >= 0);
    let pre = null; if (o.print) { pre = document.createElement('pre'); pre.id = 'audiotest'; pre.style.cssText = 'position:fixed;inset:0;margin:0;padding:8px 12px;background:#0a0c10;color:#d5dbe3;font:' + (o.font || 11) + 'px/1.25 ui-monospace,Menlo,monospace;z-index:99999;overflow:hidden;white-space:pre;column-count:' + (o.cols || 1) + ';column-gap:26px'; document.body.appendChild(pre); }
    const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n), lp = (s, n) => (' '.repeat(n) + s).slice(-n), t0 = performance.now(), from = o.from | 0, to = o.to || list.length;
    const fmt = r => pad(r.name, 37) + lp(r.dur.toFixed(2), 6) + lp(r.peakDb.toFixed(1), 7) + lp(r.rmsDb.toFixed(1), 7) + '  ' + pad(r.band, 16) + lp(r.hz, 6) + lp(r.dc.toFixed(4), 9) + lp(r.first.toFixed(4), 8) + lp(r.last.toFixed(4), 8) + lp(r.over, 5) + '  ' + r.flag + (r.note ? '  ' + r.note : '');
    const head = pad('sound', 37) + lp('dur s', 6) + lp('peak', 7) + lp('rms', 7) + '  ' + pad('dominant band', 16) + lp('pk Hz', 6) + lp('DC', 9) + lp('first', 8) + lp('last', 8) + lp('>0dB', 5) + '  flag';
    const paint = msg => { if (pre) pre.textContent = 'GT.audio.selftest — offline render of the live graph @ ' + sr + ' Hz, stereo; levels in dBFS (ceiling of the master soft-clip = -1.4)\n' + head + '\n' + rows.slice(from, to).map(fmt).join('\n') + '\n' + msg; };
    for (let i = 0; i < list.length; i++) { const [name, dur, build] = list[i]; if (i < from || i >= to) { rows.push({ name, dur: 0, peakDb: 0, rmsDb: 0, band: '-', hz: 0, dc: 0, first: 0, last: 0, over: 0, flag: 'skipped' }); continue; } paint('rendering ' + (i + 1) + '/' + list.length + ' …'); let keep = null;
      try { const ch = await offRender(i, dur, (R, d) => { keep = R; build(R, d); }, sr), a = analyse(ch[0], ch[1], sr); a.name = name; if (keep && keep.sceneStats) a.note = 'voices peak ' + keep.sceneStats.peak + ' stolen ' + keep.sceneStats.stolen + ' dropped ' + keep.sceneStats.dropped + ' | ' + Object.keys(keep.sceneStats.emit).map(k => k.replace('emit:', '') + '×' + keep.sceneStats.emit[k]).join(' '); rows.push(a); }
      catch (e) { rows.push({ name, dur: 0, peakDb: -200, rmsDb: -200, band: '-', hz: 0, dc: 0, first: 0, last: 0, over: 0, flag: 'FAILED ' + (e && e.message) }); } }
    const done = rows.filter(r => r.flag !== 'skipped'), bad = done.filter(r => r.flag !== 'ok'), mx = done.reduce((m, r) => Math.max(m, r.peakDb), -200);
    paint('DONE ' + done.length + ' renders in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s · max peak ' + mx.toFixed(1) + ' dBFS · samples over 0 dBFS: ' + done.reduce((m, r) => m + r.over, 0) + ' · ' + (bad.length ? bad.length + ' flagged: ' + bad.map(r => r.name + '=' + r.flag).join(', ') : 'ALL OK (no clip, no DC, no start/end click, none silent)'));
    api._selftest = rows; document.title = 'audiotest-done'; return rows;
  }

  /* ================================================================== VERIFICATION: offline renders → waveforms, spectrograms, peak / RMS
     showcase.html?m=audio&only=audio&v=all|engine|radio|world|sfx1|sfx2   or   &z=<job id> for a single close-up with an averaged spectrum */
  const eng = (rpm, load) => R => makeEngine(R).set({ on: true, rpm, load }, 0, 0);
  const radioJob = (idx, bar) => R => { const RD = makeRadio(R); RD.vol.gain.value = S.radioVol; RD.play(idx, .02, bar * 16); RD.tick(4.2); };
  const sfxJob = (name, opts, at) => R => { playSfx(R, name, at || .04, opts); };
  const JOBS = [
    { id: 'eng_idle', grp: 'engine', title: 'ENGINE idle 720 rpm', dur: 3, fmax: 3000, fft: 8192, run: eng(0, .04), note: 'crank 12 Hz · firing 48 Hz · lope = per-firing AM', harm: 48, zoom: [1, 1.5] },
    { id: 'eng_2k', grp: 'engine', title: 'ENGINE 2360 rpm · load .35', dur: 2, fmax: 6000, fft: 8192, run: eng(.3, .35), note: 'firing 157 Hz', harm: 157.5, zoom: [1, 1.1] },
    { id: 'eng_4k', grp: 'engine', title: 'ENGINE 4000 rpm · load .7', dur: 2, fmax: 8000, fft: 8192, run: eng(.6, .7), note: 'firing 267 Hz', harm: 267, zoom: [1, 1.06] },
    { id: 'eng_6k', grp: 'engine', title: 'ENGINE 6200 rpm · WOT', dur: 2, fmax: 10000, fft: 4096, run: eng(1, 1), note: 'firing 413 Hz', harm: 413, zoom: [1, 1.04] },
    { id: 'eng_rev', grp: 'engine', title: 'ENGINE rev → lift-off burble', dur: 5, fmax: 8000, fft: 4096, note: 'WOT sweep 0–2.4 s, throttle shut: overrun pops',
      run: R => { const E = makeEngine(R); for (let t = 0; t < 5; t += .02) { const up = t < 2.4, rpm = up ? .05 + .85 * Math.pow(t / 2.4, .8) : Math.max(.03, .9 * Math.exp(-(t - 2.4) * .75)); E.set({ on: true, rpm, load: up ? 1 : 0 }, t, .03); }
        let t = 2.5; while (t < 4.6) { E.pop(t, 1.1 - (t - 2.5) * .3); t += .04 + R.rnd() * .13; } } },
    { id: 'eng_road', grp: 'engine', title: 'CRUISE 30 m/s · road + wind', dur: 3, fmax: 8000, fft: 4096, run: R => makeEngine(R).set({ on: true, rpm: .32, load: .2, speed: 30 }, 0, 0), note: 'engine + tyre roar + wind' },
    { id: 'rad_coral', grp: 'radio', title: 'RADIO Coral 98.1 · synth-funk 108', dur: 4, run: radioJob(0, 4) },
    { id: 'rad_marea', grp: 'radio', title: 'RADIO Marea 104.5 · dembow 92', dur: 4, run: radioJob(1, 4) },
    { id: 'rad_lowtide', grp: 'radio', title: 'RADIO Low Tide 88.3 · lo-fi 74', dur: 4, run: radioJob(2, 2) },
    { id: 'rad_switch', grp: 'radio', title: 'RADIO retune (static burst)', dur: 4, run: R => { const RD = makeRadio(R); RD.vol.gain.value = S.radioVol; RD.play(0, .02, 96); RD.tick(1.6); RD.switchTo(1, 1.6, 64); RD.tick(4.2); } },
    { id: 'sir_wail', grp: 'world', title: 'SIREN wail · 20 m', dur: 5, fmax: 8000, run: R => makeSiren(R).set({ level: .5, distance: 20 }, 0, 0) },
    { id: 'sir_yelp', grp: 'world', title: 'SIREN yelp ×2 cars · 12 m', dur: 3, fmax: 8000, run: R => makeSiren(R).set({ level: 1, distance: 12 }, 0, 0) },
    { id: 'sir_pass', grp: 'world', title: 'SIREN drive-by (doppler)', dur: 5, fmax: 8000, note: 'closing +30 → −30 m/s, 170 m → 6 m → 170 m',
      run: R => { const SI = makeSiren(R); for (let t = 0; t < 5; t += .04) { const x = (t - 2.5) * 30, dist = Math.hypot(x, 6); SI.set({ level: .7, distance: dist, rel: -30 * x / dist, mode: 'yelp' }, t, t ? .03 : 0); } } },
    { id: 'scan_call', grp: 'world', title: 'SCANNER call', dur: 2.6, fmax: 8000, run: R => { scanner(R, .05, 'call', 1); } },
    { id: 'scan_unit', grp: 'world', title: 'SCANNER unit', dur: 1.5, fmax: 8000, run: R => { scanner(R, .05, 'unit', 2); } },
    { id: 'scan_clear', grp: 'world', title: 'SCANNER clear', dur: 2, fmax: 8000, run: R => { scanner(R, .05, 'clear', 3); } },
    { id: 'amb_dusk', grp: 'world', title: 'AMBIENCE golden hour, outside', dur: 8, run: R => { const A = makeAmb(R); A.set({ night: .1, traffic: .7, hum: .5 }, 0, 0); A.whoosh(1.5, .4, 1); }, note: 'cicadas + surf + traffic + neon hum + one pass-by' },
    { id: 'amb_night', grp: 'world', title: 'AMBIENCE night, outside', dur: 8, run: R => makeAmb(R).set({ night: 1, traffic: .3, hum: 1 }, 0, 0), note: 'cricket chirp trains, hum at the store' },
    { id: 'amb_in', grp: 'world', title: 'AMBIENCE dusk, inside car', dur: 8, run: R => { const A = makeAmb(R); A.set({ night: .1, traffic: .7, hum: .5, interior: 1 }, 0, 0); A.whoosh(1.5, .4, 1); }, note: 'same as golden hour through closed glass' },
    { id: 'door_open', grp: 'sfx1', title: 'door_open', dur: .8, run: sfxJob('door_open') },
    { id: 'door_close', grp: 'sfx1', title: 'door_close', dur: .7, run: sfxJob('door_close') },
    { id: 'ignition', grp: 'sfx1', title: 'ignition (starter + catch)', dur: 1.5, run: sfxJob('ignition') },
    { id: 'horn', grp: 'sfx1', title: 'horn', dur: .8, run: sfxJob('horn') },
    { id: 'key_turn', grp: 'sfx1', title: 'key_turn', dur: .5, run: sfxJob('key_turn') },
    { id: 'seatbelt', grp: 'sfx1', title: 'seatbelt', dur: .8, run: sfxJob('seatbelt') },
    { id: 'tire_squeal', grp: 'sfx1', title: 'tire_squeal level .2→1→0', dur: 2, run: R => { const h = CONT.tire_squeal(R, R.cabinBus, .02); for (let t = .02; t < 1.7; t += .05) h.set({ level: Math.sin(Math.PI * t / 1.7) }, t); h.stop(1.7); } },
    { id: 'crash', grp: 'sfx1', title: 'crash v=1', dur: 1.4, run: sfxJob('crash', { v: 1 }) },
    { id: 'crash_s', grp: 'sfx1', title: 'crash v=.3', dur: 1, run: sfxJob('crash', { v: .3 }) },
    { id: 'glass', grp: 'sfx2', title: 'glass', dur: 1.2, run: sfxJob('glass') },
    { id: 'alarm_bell', grp: 'sfx2', title: 'alarm_bell · 10 m', dur: 1.5, run: R => { const h = CONT.alarm_bell(R, R.worldIn, .02); h.set({ distance: 10 }, .02); h.stop(1.2); }, zoom: [.5, .7] },
    { id: 'cash', grp: 'sfx2', title: 'cash', dur: .9, run: sfxJob('cash') },
    { id: 'ui', grp: 'sfx2', title: 'ui_tick ×3 · ui_ok · ui_bad', dur: 1.5, run: R => { for (const t of [.05, .15, .25]) playSfx(R, 'ui_tick', t); playSfx(R, 'ui_ok', .45); playSfx(R, 'ui_bad', .95); } },
    { id: 'star', grp: 'sfx2', title: 'star (wanted up)', dur: .9, run: sfxJob('star') },
    { id: 'heartbeat', grp: 'sfx2', title: 'heartbeat ×2', dur: 1.5, fmax: 2000, fft: 4096, run: R => { playSfx(R, 'heartbeat', .05); playSfx(R, 'heartbeat', .8); } },
    { id: 'turn_signal', grp: 'sfx2', title: 'turn_signal tick/tock', dur: 1, run: R => { playSfx(R, 'turn_signal', .05); playSfx(R, 'turn_signal', .41, { tock: true }); playSfx(R, 'turn_signal', .77); } },
    { id: 'thunk', grp: 'sfx2', title: 'thunk', dur: .5, fmax: 8000, run: sfxJob('thunk') },
    { id: 'mix', grp: 'sfx2', title: 'WORST-CASE MIX (limiter test)', dur: 3, note: 'engine WOT + radio + yelp + squeal + crash + horn all at once',
      run: R => { makeEngine(R).set({ on: true, rpm: .8, load: 1, speed: 35 }, 0, 0); const RD = makeRadio(R); RD.vol.gain.value = S.radioVol; RD.play(0, .02, 64); RD.tick(3.2); makeSiren(R).set({ level: 1, distance: 8 }, 0, 0);
        makeAmb(R).set({ night: .5, traffic: 1, hum: 1 }, 0, 0); const h = CONT.tire_squeal(R, R.cabinBus, .02); h.set({ level: 1 }, .02); playSfx(R, 'crash', 1, { v: 1 }); hornNote(R, R.cabinBus, 1.6, .8); } }
  ];
  const FFT = {};
  function fftPlan(n) { if (FFT[n]) return FFT[n]; const rev = new Uint32Array(n), cos = new Float32Array(n / 2), sin = new Float32Array(n / 2), win = new Float32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (n - 1)); }
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    return FFT[n] = { rev, cos, sin, win, re: new Float32Array(n), im: new Float32Array(n) }; }
  /** magnitude spectrum (dBFS, sine at full scale = 0 dB) of n samples starting at off. */
  function spectrum(x, off, n, out) { const P = fftPlan(n), re = P.re, im = P.im;
    for (let i = 0; i < n; i++) { const j = off + i; re[P.rev[i]] = j >= 0 && j < x.length ? x[j] * P.win[i] : 0; im[i] = 0; }
    for (let size = 2; size <= n; size <<= 1) { const half = size >> 1, step = n / size; for (let s = 0; s < n; s += size) for (let k = 0; k < half; k++) { const c = P.cos[k * step], sn = -P.sin[k * step], a = s + k, b = a + half, tr = re[b] * c - im[b] * sn, ti = re[b] * sn + im[b] * c; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; } }
    const k = 4 / n; for (let i = 0; i < n / 2; i++) out[i] = 10 * Math.log10(Math.max(1e-12, (re[i] * re[i] + im[i] * im[i]) * k * k)); return out; }
  const CMAP = [[4, 4, 10], [30, 12, 70], [88, 22, 110], [150, 40, 100], [205, 70, 66], [240, 120, 30], [252, 190, 40], [252, 252, 170]];
  function cmap(v, o, i) { v = clamp(v, 0, 1) * (CMAP.length - 1); const k = Math.min(CMAP.length - 2, Math.floor(v)), f = v - k, a = CMAP[k], b = CMAP[k + 1]; o[i] = a[0] + (b[0] - a[0]) * f; o[i + 1] = a[1] + (b[1] - a[1]) * f; o[i + 2] = a[2] + (b[2] - a[2]) * f; o[i + 3] = 255; }
  const dB = v => 20 * Math.log10(Math.max(v, 1e-9));
  async function renderJob(job, sr) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, ac = new OAC(2, Math.ceil(job.dur * sr), sr), R = makeRig(ac, true, 'off-' + job.id);
    job.run(R);
    // headless screenshots run on a virtual clock that would race past the (real-time) render thread: burn real CPU between zero-timeouts until the render lands
    let buf = null, err = null; ac.startRendering().then(b => { buf = b; }, e => { err = e || new Error('render failed'); });
    for (let k = 0; !buf && !err && k < 4000; k++) { await new Promise(r => setTimeout(r, 0)); let junk = 0; for (let i = 0; i < 1500000; i++) junk += Math.sqrt(i); if (junk < 0) break; }
    if (!buf) throw err || new Error('render timed out');
    const x = buf.getChannelData(0), pre = buf.getChannelData(1);
    let pk = 0, ss = 0, ppk = 0, dc = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; ss += x[i] * x[i]; dc += x[i]; const b = Math.abs(pre[i]); if (b > ppk) ppk = b; }
    // loudest 300 ms window RMS (fairer than whole-file RMS for one-shots)
    const w = Math.min(x.length, Math.floor(sr * .3)); let acc = 0, best = 0; for (let i = 0; i < x.length; i++) { acc += x[i] * x[i]; if (i >= w) acc -= x[i - w] * x[i - w]; if (acc > best) best = acc; }
    return { job, x, sr, peak: pk, rms: Math.sqrt(ss / x.length), rmsW: Math.sqrt(best / w), pre: ppk, dc: dc / x.length };
  }
  function drawWave(g, x, x0, y0, w, h, i0, i1, col) {
    g.fillStyle = '#0b0e13'; g.fillRect(x0, y0, w, h);
    g.strokeStyle = 'rgba(255,80,70,.55)'; g.lineWidth = 1; g.setLineDash([4, 4]); for (const s of [-.9, .9]) { const y = Math.round(y0 + h / 2 - s * h / 2) + .5; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y); g.stroke(); } g.setLineDash([]);
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(x0, y0 + h / 2 + .5); g.lineTo(x0 + w, y0 + h / 2 + .5); g.stroke();
    g.fillStyle = col; const n = i1 - i0;
    if (n < w * 2) { g.strokeStyle = col; g.lineWidth = 1.3; g.beginPath(); for (let i = 0; i < n; i++) { const X = x0 + i / (n - 1) * w, Y = y0 + h / 2 - x[i0 + i] * h / 2; i ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.stroke(); return; }
    for (let c = 0; c < w; c++) { const a = i0 + Math.floor(c / w * n), b = i0 + Math.floor((c + 1) / w * n); let lo = 1, hi = -1; for (let i = a; i < b; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      const yA = y0 + h / 2 - hi * h / 2, yB = y0 + h / 2 - lo * h / 2; g.fillRect(x0 + c, yA, 1, Math.max(1, yB - yA)); }
  }
  function drawSpec(g, res, x0, y0, w, h, fmin, fmax, N) {
    w = Math.floor(w); h = Math.floor(h); const x = res.x, sr = res.sr, img = g.createImageData(w, h), mag = new Float32Array(N / 2), binHz = sr / N, lmin = Math.log(fmin), lr = Math.log(fmax / fmin);
    const lo = new Int32Array(h), hi = new Int32Array(h); for (let r = 0; r < h; r++) { const fa = Math.exp(lmin + lr * (h - 1 - r) / h), fb = Math.exp(lmin + lr * (h - r) / h); lo[r] = Math.max(1, Math.floor(fa / binHz)); hi[r] = Math.min(N / 2 - 1, Math.max(lo[r], Math.ceil(fb / binHz) - 1)); }
    for (let c = 0; c < w; c++) { spectrum(x, Math.floor(c / w * x.length) - N / 2, N, mag); for (let r = 0; r < h; r++) { let m = -200; for (let b = lo[r]; b <= hi[r]; b++) if (mag[b] > m) m = mag[b]; cmap((m + 96) / 84, img.data, (r * w + c) * 4); } }
    const tr = g.getTransform(); g.putImageData(img, x0 + tr.e, y0 + tr.f);      // putImageData ignores the canvas transform
    g.font = '10px ui-monospace,Menlo,monospace'; g.textBaseline = 'middle'; g.textAlign = 'left';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { if (f <= fmin || f >= fmax) continue; const y = y0 + h - Math.log(f / fmin) / lr * h; g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x0, Math.round(y), 5, 1); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(f >= 1000 ? f / 1000 + 'k' : '' + f, x0 + 7, y); }
  }
  function status(res) { return res.peak < .02 ? ['SILENT', '#ff5a4f'] : res.peak > .9 ? ['CLIP', '#ff5a4f'] : res.pre > 1.2 ? ['LIMITING', '#ffb347'] : ['OK', '#5fe08a']; }
  function drawPanel(g, res, x0, y0, w, h, compact) {
    const job = res.job, st = status(res), pad = compact ? 5 : 8, hh = compact ? 30 : 40;
    g.fillStyle = '#12161d'; g.fillRect(x0, y0, w, h); g.strokeStyle = '#262d38'; g.lineWidth = 1; g.strokeRect(x0 + .5, y0 + .5, w - 1, h - 1);
    g.fillStyle = st[1]; g.beginPath(); g.arc(x0 + pad + 4, y0 + (compact ? 9 : 12), 3.5, 0, 6.3); g.fill();
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#e9edf2'; g.font = (compact ? '600 10.5px' : '600 13px') + ' ui-monospace,Menlo,monospace'; g.fillText(job.title, x0 + pad + 13, y0 + (compact ? 9.5 : 12.5), w - pad * 2 - 16);
    g.font = (compact ? '10px' : '11.5px') + ' ui-monospace,Menlo,monospace'; g.fillStyle = st[1];
    g.fillText('pk ' + res.peak.toFixed(2) + (compact ? '' : ' (' + dB(res.peak).toFixed(1) + ' dB)'), x0 + pad, y0 + (compact ? 22 : 29));
    g.fillStyle = '#9fb0c3'; g.textAlign = 'right'; g.fillText((compact ? 'rms ' : 'pre ' + res.pre.toFixed(2) + ' · rms ') + dB(res.rms).toFixed(1) + (compact ? '' : ' · loud300 ' + dB(res.rmsW).toFixed(1)) + ' dB', x0 + w - pad, y0 + (compact ? 22 : 29));
    const bw = w - pad * 2, bh = h - hh - pad, wh = Math.round(bh * .34);
    drawWave(g, res.x, x0 + pad, y0 + hh, bw, wh, 0, res.x.length, st[0] === 'OK' ? '#7fd4ff' : st[1]);
    drawSpec(g, res, x0 + pad, y0 + hh + wh + 2, bw, bh - wh - 2, job.fmin || 30, job.fmax || 16000, compact ? 2048 : (job.fft || 2048));
  }
  function drawClose(g, res, W, H) {
    const job = res.job, st = status(res), pad = 18, mono = 'ui-monospace,Menlo,monospace'; g.save(); g.translate(0, 26); H -= 26;
    g.fillStyle = st[1]; g.beginPath(); g.arc(pad + 7, 30, 7, 0, 6.3); g.fill();
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#f2f4f7'; g.font = '700 22px ' + mono; g.fillText(job.title, pad + 24, 31);
    g.font = '14px ' + mono; g.fillStyle = st[1]; g.fillText(st[0] + '   peak ' + res.peak.toFixed(3) + ' (' + dB(res.peak).toFixed(1) + ' dBFS)', pad, 62);
    g.fillStyle = '#9fb0c3'; g.fillText('RMS ' + dB(res.rms).toFixed(1) + ' dB   loudest-300ms RMS ' + dB(res.rmsW).toFixed(1) + ' dB   crest ' + (dB(res.peak) - dB(res.rms)).toFixed(1) + ' dB   pre-master peak ' + res.pre.toFixed(3) + '   DC ' + res.dc.toFixed(4) + '   ' + job.dur + ' s @ ' + res.sr + ' Hz', pad + 330, 62);
    if (job.note) { g.fillStyle = '#6f8196'; g.fillText(job.note, pad, 84); }
    const top = 100, cw = W - pad * 2, lab = (s, y) => { g.fillStyle = '#6f8196'; g.font = '11px ' + mono; g.textAlign = 'left'; g.fillText(s, pad, y); };
    const zh = (H - top - pad) , h1 = Math.round(zh * .16), h2 = Math.round(zh * .16), h3 = Math.round(zh * .36), h4 = zh - h1 - h2 - h3 - 54;
    let y = top; lab('WAVEFORM  full ' + job.dur + ' s   (dashed red = ±0.9)', y); drawWave(g, res.x, pad, y + 9, cw, h1, 0, res.x.length, '#7fd4ff'); y += h1 + 18;
    const z = job.zoom || [job.dur * .1, Math.min(job.dur, job.dur * .1 + .12)]; lab('WAVEFORM  zoom ' + z[0].toFixed(2) + '–' + z[1].toFixed(2) + ' s', y); drawWave(g, res.x, pad, y + 9, cw, h2, Math.floor(z[0] * res.sr), Math.min(res.x.length, Math.floor(z[1] * res.sr)), '#b8f0a0'); y += h2 + 18;
    const fmin = job.fmin || 30, fmax = job.fmax || 16000, N = job.fft || 2048; lab('SPECTROGRAM  log f ' + fmin + ' Hz – ' + fmax + ' Hz · FFT ' + N + ' · 84 dB range', y); drawSpec(g, res, pad, y + 9, cw, h3, fmin, fmax, N); y += h3 + 18;
    // long-term average spectrum
    lab('AVERAGE SPECTRUM  (dBFS, log f)' + (job.harm ? '   ticks = multiples of firing frequency ' + job.harm + ' Hz; half-height ticks = half/quarter orders' : ''), y); y += 9;
    g.fillStyle = '#0b0e13'; g.fillRect(pad, y, cw, h4);
    const M = job.harm ? 16384 : Math.max(N, 8192), mag = new Float32Array(M / 2), avg = new Float32Array(M / 2), frames = Math.max(1, Math.floor((res.x.length - M) / (M / 2)));
    for (let f = 0; f < frames; f++) { spectrum(res.x, f * M / 2, M, mag); for (let i = 0; i < M / 2; i++) avg[i] += Math.pow(10, mag[i] / 10); }
    for (let i = 0; i < M / 2; i++) avg[i] = 10 * Math.log10(avg[i] / frames + 1e-12);
    const lr = Math.log(fmax / fmin), X = f => pad + Math.log(f / fmin) / lr * cw, Y = d => y + h4 * (1 - clamp((d + 100) / 90, 0, 1)), binHz = res.sr / M;
    g.font = '10px ' + mono; g.textAlign = 'left';
    for (const d of [-20, -40, -60, -80]) { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(pad, Math.round(Y(d)), cw, 1); g.fillStyle = 'rgba(255,255,255,.45)'; g.fillText(d + ' dB', pad + 4, Y(d) - 7); }
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) if (f > fmin && f < fmax) { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(Math.round(X(f)), y, 1, h4); g.fillStyle = 'rgba(255,255,255,.45)'; g.fillText(f >= 1000 ? f / 1000 + 'k' : '' + f, X(f) + 3, y + h4 - 8); }
    if (job.harm) for (let k = 1; k <= 64; k++) { const f = job.harm * k / 4; if (f > fmax) break; if (f < fmin) continue; const major = k % 4 === 0; g.fillStyle = major ? 'rgba(255,190,60,.8)' : 'rgba(255,190,60,.3)'; g.fillRect(Math.round(X(f)), y, 1, major ? 14 : 7); }
    g.strokeStyle = '#ffb347'; g.lineWidth = 1.4; g.beginPath(); let started = false, lastX = -1, mx = -200;
    for (let i = 1; i < M / 2; i++) { const f = i * binHz; if (f < fmin || f > fmax) continue; const px = X(f); mx = Math.max(mx, avg[i]); if (px - lastX >= 1) { started ? g.lineTo(px, Y(mx)) : g.moveTo(px, Y(mx)); started = true; lastX = px; mx = -200; } } g.stroke();
    const pk = []; for (let i = 3; i < M / 2 - 3; i++) { const f = i * binHz; if (f < fmin || f > fmax) continue; if (avg[i] > avg[i - 1] && avg[i] >= avg[i + 1] && avg[i] > avg[i - 3] + 3 && avg[i] > avg[i + 3] + 3 && avg[i] > -70) pk.push([avg[i], f]); }
    pk.sort((a, b) => b[0] - a[0]); const used = []; g.fillStyle = '#ffe2a8'; g.textAlign = 'center';
    for (const p of pk) { if (used.length >= 12) break; const px = X(p[1]); if (used.some(u => Math.abs(u - px) < 46)) continue; used.push(px); g.fillText(p[1] < 1000 ? p[1].toFixed(0) : (p[1] / 1000).toFixed(2) + 'k', px, Y(p[0]) - 9); g.fillRect(px - 1.5, Y(p[0]) - 1.5, 3, 3); }
    g.restore();
  }
  GT.showcase.audio = function () {
    const Q = new URLSearchParams(location.search), view = Q.get('v') || 'all', zid = Q.get('z'), W = innerWidth, H = innerHeight, mono = 'ui-monospace,Menlo,monospace';
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:5;background:#0a0c10'; document.body.appendChild(cv);
    const g = cv.getContext('2d'); g.fillStyle = '#0a0c10'; g.fillRect(0, 0, W, H);
    const jobs = zid ? JOBS.filter(j => j.id === zid) : view === 'all' ? JOBS : JOBS.filter(j => j.grp === view), sr = 44100, results = [];
    const head = s => { g.fillStyle = '#0a0c10'; g.fillRect(0, 0, W, 26); g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '600 12px ' + mono; g.fillStyle = '#ffb347'; g.fillText('SUNSET HEAT · GT.audio offline verification', 10, 14); g.fillStyle = '#9fb0c3'; g.textAlign = 'right'; g.fillText(s, W - 10, 14); };
    if (view === 'live') {   // smoke-test the real-time API on a live AudioContext: every call must run without throwing
      const log = [], ok = (name, f) => { try { const r = f(); log.push(['ok', name + (r !== undefined ? '  → ' + JSON.stringify(r) : '')]); } catch (e) { log.push(['FAIL', name + '  ' + e.message]); } };
      ok('init()', () => api.init()); ok('init() again (idempotent)', () => api.init()); ok('resume()', () => api.resume()); ok('setMaster(.8)', () => api.setMaster(.8));
      ok('ctx.state / sampleRate', () => api.ctx.state + ' @ ' + api.ctx.sampleRate);
      ok('engine({on,rpm,load,speed})', () => api.engine({ on: true, rpm: .4, load: .6, speed: 20 })); ok('engine partial {load:0}', () => api.engine({ load: 0 }));
      ok('setRadio(true, 0)', () => api.setRadio(true, 0)); ok('nextStation()', () => api.nextStation()); ok('nextStation()', () => api.nextStation()); ok('nextStation() wraps', () => api.nextStation()); ok('setRadioVolume(.4)', () => api.setRadioVolume(.4));
      ok('siren(.5, 60, 10)', () => api.siren(.5, 60, 10)); ok('siren(1, 15, -5)', () => api.siren(1, 15, -5)); ok('siren(0)', () => api.siren(0));
      for (const e of ['call', 'unit', 'clear']) ok("scanner('" + e + "')", () => +api.scanner(e).toFixed(2));
      ok('ambience({night,traffic,interior})', () => api.ambience({ night: .5, traffic: .8, interior: 1 }));
      for (const n of Object.keys(ONE)) ok("sfx('" + n + "')", () => +api.sfx(n, { v: .8 }).toFixed(2));
      ok("sfx('tire_squeal',{level:.7})", () => api.sfx('tire_squeal', { level: .7 })); ok("sfx('tire_squeal',{level:0})", () => api.sfx('tire_squeal', { level: 0 }));
      ok("sfx('alarm_bell',{on:true,distance:20})", () => api.sfx('alarm_bell', { on: true, distance: 20 })); ok("sfx('alarm_bell',{on:false})", () => api.sfx('alarm_bell', { on: false }));
      ok("sfx('horn',{on:true}) / {on:false}", () => { api.sfx('horn', { on: true }); api.sfx('horn', { on: false }); });
      ok("sfx('heartbeat',{on:true,bpm:110})", () => api.sfx('heartbeat', { on: true, bpm: 110 })); ok("sfx('turn_signal',{on:true})", () => api.sfx('turn_signal', { on: true }));
      ok('update(.016, {full state}) ×120', () => { for (let i = 0; i < 120; i++) api.update(.016, { engine: { rpm: .6 - i * .004, load: 0 }, traffic: 1, pos: { x: 46, z: -4 }, siren: { level: .7, distance: 80 - i * .5, rel: 12 } }); });
      ok('loops off, radio off, engine off', () => { api.sfx('heartbeat', { on: false }); api.sfx('turn_signal', { on: false }); api.setRadio(false); api.engine({ on: false }); });
      ok("sfx('nope') unknown name is a no-op", () => api.sfx('nope'));
      head('live API smoke test · ' + log.filter(l => l[0] === 'ok').length + '/' + log.length + ' calls ok');
      g.font = '12.5px ' + mono; g.textAlign = 'left'; const colH = Math.ceil(log.length / 2);
      log.forEach((l, i) => { const x = 16 + (i >= colH ? W / 2 : 0), y = 48 + (i % colH) * 19; g.fillStyle = l[0] === 'ok' ? '#5fe08a' : '#ff5a4f'; g.fillText(l[0], x, y); g.fillStyle = '#d5dbe3'; g.fillText(l[1], x + 44, y, W / 2 - 70); });
      return {};
    }
    if (!jobs.length) { head('no such job. ids: ' + JOBS.map(j => j.id).join(' ')); return {}; }
    const n = jobs.length, cols = zid ? 1 : n > 20 ? 8 : n > 9 ? 4 : n > 6 ? 3 : n > 4 ? 3 : 2, rows = Math.ceil(n / cols), top = 28, gap = 6, pw = (W - gap * (cols + 1)) / cols, ph = (H - top - gap * rows) / rows;
    (async () => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        head('rendering ' + (i + 1) + '/' + n + ' …');
        let res; try { res = await renderJob(jobs[i], sr); } catch (e) { g.fillStyle = '#ff6'; g.font = '12px ' + mono; g.textAlign = 'left'; g.fillText(jobs[i].id + ' FAILED: ' + e.message, 10, 60 + i * 14); continue; }
        results.push(res);
        if (zid) drawClose(g, res, W, H); else drawPanel(g, res, Math.round(gap + (i % cols) * (pw + gap)), Math.round(top + Math.floor(i / cols) * (ph + gap)), Math.floor(pw), Math.floor(ph), n > 12);
      }
      const bad = results.filter(r => status(r)[0] !== 'OK'), mxp = results.reduce((m, r) => Math.max(m, r.peak), 0);
      head(results.length + '/' + n + ' rendered in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s · max peak ' + mxp.toFixed(3) + ' · ' + (bad.length ? bad.length + ' flagged: ' + bad.map(r => r.job.id + '=' + status(r)[0]).join(', ') : 'all OK (none silent, none > 0.9)'));
      GT.audio._verify = results.map(r => ({ id: r.job.id, peak: +r.peak.toFixed(3), rmsDb: +dB(r.rms).toFixed(1), loudDb: +dB(r.rmsW).toFixed(1), pre: +r.pre.toFixed(3), status: status(r)[0] }));
      document.title = 'audio-ready';
    })();
    return { cam: [0, 2, 6], look: [0, 1, 0] };
  };
})();
