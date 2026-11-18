/* combat.js — BILIBILI THEFT AUTO 1 (China edition) fighting layer: gunfights, weapon switching, melee and ranged, third person (owner: combat agent). Needs js/weapons.js (injected automatically if GT.weapons is missing).
   GT.combat = { init(scene, hooks), update(dt, ctx), player, enemies, wheel, state, spawn(kind, x, z, opts), scenario(name), on(evt, cb), stats,
                 give(id, ammo?), equip(id), holster(), drop(id, x, z, ammo?, opts?), pickups, addCar(vehicle | {x,z,h,L,W,H}), clear(), timeScale, engaged, opts, selftest() }
   Scenarios: scenario('lobby') = mission 3 钟楼洋行 ambush (anchors handoff / clockLobby / clockStairFoot from js/landmarks.js, else a self-built stand-in at the same coordinates);
              scenario('wharf') = mission 5 码头仓库 finale (anchors wharfDoor / wharfCage / wharfSpawnN / wharfHeavy from js/riverside.js, else a stand-in shed).
   Heights: actors stand on groundY() = cnroad / landmarks / riverside ground; collider heights (GT.world.boxes[].h) are absolute, so cover and collision use h relative to the actor's feet.
   hooks (all optional): { addHeat(stars, reason), flag(kind), cops() -> [{x,z}], say(who, text), onPlayerDown(), onEnemyDown(e) }
   ctx = { ctl (GT.onfoot controller), hero (GT.hero figure), camera, input (GT.input), partner? }
   Conventions (core.js / onfoot.js): heading h -> forward (sin h, 0, cos h), right (-cos h, 0, sin h); camera yaw same convention, pitch > 0 looks DOWN, yaw -= look.dx.
   Control model: while combat is ENGAGED (weapon drawn, enemies alert, cover, melee, scenario running) this module drives the player itself (movement, cover, roll,
   animation, over-the-shoulder camera) and keeps ctl.enabled = false, syncing ctl.teleport()/ctl.camera on the way in and out. With no ctl it runs fully alone.
   Self-demo: showcase.html?m=combat&scene=<range|melee|wheel|cover|focus|lobby|wharf|weapons>&at=<seconds>&auto=1[&live=1][&t=21][&standin=1]   ·   &selftest=1 */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!T || !GT) return;
  const PI = Math.PI, TAU = PI * 2, HP = PI / 2, sin = Math.sin, cos = Math.cos, abs = Math.abs, hyp = Math.hypot, min = Math.min, max = Math.max, sqrt = Math.sqrt;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t, sat = v => clamp(v, 0, 1);
  const sst = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const safe2 = fn => { try { fn(); } catch (e) { if (!safe2.n) { safe2.n = 1; if (window.console) console.warn('[combat] SH', e); } } };
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
  const V3 = (x, y, z) => new T.Vector3(x || 0, y || 0, z || 0);
  const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _e = V3(), _f = V3(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _q3 = new T.Quaternion(), _m = new T.Matrix4(), _m2 = new T.Matrix4(), _s = V3(), UP = V3(0, 1, 0);
  const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams('');
  if (!GT.weapons && typeof document !== 'undefined') { const s = document.createElement('script'); s.src = 'js/weapons.js'; document.head.appendChild(s); }   // bootstrap: combat can be loaded on its own
  const WD = id => (GT.weapons && GT.weapons.defs[id]) || FALLBACK_DEFS[id] || FALLBACK_DEFS.fists;
  const FALLBACK_DEFS = { fists: { id: 'fists', name: '拳头', en: 'FISTS', kind: 'melee', slot: 0, reach: 1.25, dmg: 16, heavy: 34, stagger: .5, swing: .34 } };
  let rnd = GT.rng('combat');                                     // deterministic gameplay randomness (re-seeded per scenario so autoplay screenshots are repeatable)

  /* ================================================================== module state */
  const S = { scene: null, hooks: {}, inited: false, time: 0, real: 0, ts: 1, tsTarget: 1, hitstop: 0, shake: 0, punch: V3(), root: null, cars: [], boxes: [], boxT: -1, covers: [], coverKey: '', noise: [], ev: {}, sc: null,
    focusOn: false, focusK: 0, wheelOpen: false, hitcam: null, engaged: false, engT: 0, tokens: { peek: 0, melee: 0 }, lights: [], targets: [], own: null, ctx: null, cam: null, lastHeatT: -99, headless: false, bot: null, autoCam: true };
  const opts = { ownControl: true, hud: true, sound: true, autoReload: true, god: false, difficulty: 1, aimAssist: .35, peekTokens: 2, meleeTokens: 1, barks: true, keys: { wheel: ['KeyQ', 'Tab'], focus: 'KeyC', cover: 'KeyE', reload: 'KeyR', melee: 'KeyF', dodge: 'Space', holster: 'KeyH', shoulder: 'KeyV' } };
  const stats = { shots: 0, hits: 0, headshots: 0, kills: 0, damageTaken: 0, meleeHits: 0, takedowns: 0, reloads: 0, perfectReloads: 0 };
  const emit = (name, d) => { const l = S.ev[name]; if (l) for (const f of l.slice()) { try { f(d); } catch (e) { if (window.console) console.warn('[combat] listener', e); } } };
  const hook = (name, a, b) => { const f = S.hooks && S.hooks[name]; if (typeof f === 'function') { try { return f(a, b); } catch (e) { if (window.console) console.warn('[combat] hook ' + name, e); } } };

  /* ================================================================== input: ctx.input / GT.input, else a private clone of the same contract; plus a virtual pad for autoplay + tests */
  function makeInput(bind) {
    const keys = new Set(), pend = new Set(), cur = new Set(); let pdx = 0, pdy = 0, wheel = 0;
    const I = { look: { dx: 0, dy: 0 }, wheel: 0, sens: .0022, virtual: !bind,
      down: c => keys.has(c), pressed: c => cur.has(c), consume: c => cur.delete(c),
      axis() { const d = c => (keys.has(c) ? 1 : 0); return { x: clamp(d('KeyD') + d('ArrowRight') - d('KeyA') - d('ArrowLeft'), -1, 1), y: clamp(d('KeyW') + d('ArrowUp') - d('KeyS') - d('ArrowDown'), -1, 1) }; },
      frame() { cur.clear(); for (const c of pend) cur.add(c); pend.clear(); I.look.dx = pdx; I.look.dy = pdy; pdx = pdy = 0; I.wheel = wheel; wheel = 0; },
      /* virtual helpers */ hold(c, on) { if (on === false) keys.delete(c); else { if (!keys.has(c)) pend.add(c); keys.add(c); } }, tap(c) { pend.add(c); }, turn(dx, dy) { pdx += dx; pdy += dy; }, releaseAll() { keys.clear(); }, scroll(n) { wheel += n; } };
    if (bind && typeof addEventListener !== 'undefined') {
      const mc = b => b === 0 ? 'Mouse0' : b === 2 ? 'Mouse1' : 'Mouse2';
      addEventListener('keydown', e => { if (!e.repeat) { keys.add(e.code); pend.add(e.code); } if (e.code === 'Tab') e.preventDefault(); }); addEventListener('keyup', e => keys.delete(e.code)); addEventListener('blur', () => keys.clear());
      addEventListener('mousedown', e => { const c = mc(e.button); keys.add(c); pend.add(c); const cv = document.querySelector('canvas'); if (cv && e.target === cv && !document.pointerLockElement && cv.requestPointerLock) { try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (er) {} } });
      addEventListener('mouseup', e => keys.delete(mc(e.button))); addEventListener('contextmenu', e => { if (e.target && e.target.tagName === 'CANVAS') e.preventDefault(); });
      addEventListener('mousemove', e => { if (document.pointerLockElement || keys.has('Mouse0') || keys.has('Mouse1')) { pdx += (e.movementX || 0) * I.sens; pdy += (e.movementY || 0) * I.sens; } });
    }
    return I;
  }
  let ownInput = null, wheelDelta = 0, wheelBound = false;
  function bindWheel() { if (wheelBound || typeof addEventListener === 'undefined') return; wheelBound = true; let distance = 0, last = -Infinity;
    addEventListener('wheel', e => {
      const game = GT.cngame, g = game?.G;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || !e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY) || slotLocked()) return;
      if (g && (g.phase !== 'play' || g.paused || g.inputOff || game.player.mode !== 'foot')) return;
      if (e.timeStamp - last > 200 || distance * e.deltaY < 0) distance = 0;
      last = e.timeStamp;
      distance += e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1);
      if (Math.abs(distance) >= 40) { wheelDelta += Math.sign(distance); distance = 0; }
      if (WH.open && e.cancelable) e.preventDefault();
    }, { passive: false });
    addEventListener('keydown', e => { if (e.code === 'Tab' && S.engaged) e.preventDefault(); if (opts.sound) SND.unlock(); }); addEventListener('mousedown', () => { if (opts.sound) SND.unlock(); }); }
  const VPAD = makeInput(false);                                                                    // scripted input (autoplay / self-test)
  let IN = VPAD;                                                                                    // the input being read this frame

  /* ================================================================== sound: own WebAudio voices on GT.audio's context when it has one */
  const SND = { ac: null, out: null, noise: null, lastT: {},
    unlock() {
      if (!SND.ac && GT.audio && !GT.audio.ctx) GT.audio.init();
      if (SND.boot() && SND.ac.state === 'suspended') SND.ac.resume().catch(() => {});
    },
    boot() { if (SND.ac || S.headless) return !!SND.ac; try { let ac = GT.audio && GT.audio.ctx; if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false; ac = new AC({ latencyHint: 'interactive' }); }
        SND.ac = ac; const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = .002; comp.release.value = .12; const g = ac.createGain(); g.gain.value = .85; comp.connect(g); const rig = GT.audio && GT.audio.rig && GT.audio.rig(); g.connect(rig && rig.ac === ac ? rig.cat.sfx : ac.destination); SND.out = comp; SND.gain = g;
        const n = ac.sampleRate * 1.5, buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0); let s = 12345; for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 2147483648) - 1; } SND.noise = buf; return true; } catch (e) { SND.ac = null; return false; } },
    /* building blocks. All take absolute start time t and a destination node */
    nz(dst, t, o) { const ac = SND.ac, src = ac.createBufferSource(); src.buffer = SND.noise; src.loop = true; src.playbackRate.value = o.rate || 1; const f = ac.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f, t); if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.a || .001) + (o.d || .1)); f.Q.value = o.q || .7;
      const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.g, t + (o.a || .001)); g.gain.exponentialRampToValueAtTime(.0008, t + (o.a || .001) + (o.d || .1)); src.connect(f); f.connect(g); g.connect(dst); src.start(t, (t * 7.13) % 1); src.stop(t + (o.a || .001) + (o.d || .1) + .02); },
    tone(dst, t, o) { const ac = SND.ac, os = ac.createOscillator(); os.type = o.type || 'sine'; os.frequency.setValueAtTime(o.f, t); if (o.f2) os.frequency.exponentialRampToValueAtTime(o.f2, t + (o.d || .1)); const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.g, t + (o.a || .002)); g.gain.exponentialRampToValueAtTime(.0008, t + (o.a || .002) + (o.d || .1));
      os.connect(g); g.connect(dst); os.start(t); os.stop(t + (o.a || .002) + (o.d || .1) + .02); },
    /** positional chain: distance low-pass + attenuation + pan, optional wall slapback. pos = {x, y?, z} or null for "at the listener" */
    place(pos, o) { const ac = SND.ac, t = ac.currentTime + .003, inp = ac.createGain(); let dist = 0, pan = 0; const cam = S.cam;
      if (pos && cam) { const dx = pos.x - cam.position.x, dz = pos.z - cam.position.z; dist = hyp(dx, dz); cam.getWorldDirection(_a); const rx = -_a.z, rz = _a.x, l = dist || 1; pan = clamp(-(dx * rx + dz * rz) / l * -1, -1, 1) * sat(dist / 6); }
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = clamp(16000 / (1 + dist * dist / 900), 700, 16000); const g = ac.createGain(); g.gain.value = (o && o.g || 1) / (1 + dist / (o && o.ref || 14)) * (S.ts < .6 ? .8 : 1);
      inp.connect(lp); lp.connect(g); let tail = g; if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); tail = p; } tail.connect(SND.out);
      if (o && o.slap > 0) { const dl = ac.createDelay(.5); dl.delayTime.value = clamp(o.slap * 2 / 343 + .03, .04, .4); const sg = ac.createGain(); sg.gain.value = .32 / (1 + o.slap / 10); const sf = ac.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2400; tail.connect(dl); dl.connect(sf); sf.connect(sg); sg.connect(SND.out); }
      if (S.ts < .6) { lp.frequency.value *= .55; }                                              // slow motion: everything darker
      return { t: t + dist / 343 * .25, dst: inp, dist }; },
    ok(name, gap) { if (!SND.ac || !opts.sound || SND.ac.state !== 'running') return false; const now = SND.ac.currentTime; if (gap && SND.lastT[name] && now - SND.lastT[name] < gap) return false; SND.lastT[name] = now; return true; },
    /** layered gunshot: crack (HF noise) + body (pitched thump) + tail (band noise decay) */
    shot(def, pos, wallDist, own) { if (!SND.ok((own ? 'player-shot-' : 'scene-shot-') + def.id, own ? 0 : .016)) return; const P = SND.place(pos, { g: def.loud * (def.sup && own ? 1.85 : own ? 1 : .8), ref: 22, slap: wallDist }), t = P.t, d = P.dst, p = def.pitch || 1, sg = def.pellets > 1;
      if (def.snd === 'spray') { SND.nz(d, t, { type: 'highpass', f: 2600, q: .4, g: .55, a: .012, d: .2 }); SND.nz(d, t, { f: 700, f2: 420, q: .5, g: .3, a: .02, d: .18 }); return; }   /* powder extinguisher: a hiss, no bang */
      if (def.snd === 'nail') { SND.nz(d, t, { type: 'highpass', f: 3200, q: .6, g: .8, a: .0006, d: .028 }); SND.tone(d, t, { type: 'square', f: 480, f2: 130, g: .55, a: .001, d: .05 }); SND.nz(d, t + .035, { f: 1100, f2: 380, q: .8, g: .32, a: .004, d: .13 }); return; }   /* nail gun: solenoid snap + air exhaust */
      if (def.sup) { if (GT.samples?.shot?.(def, d, t, P.dist, own)) return; SND.nz(d, t, { type: 'highpass', f: 2200, q: .5, g: .5, a: .0006, d: .04 }); SND.nz(d, t, { f: 700, f2: 220, q: .7, g: .55, a: .002, d: .1 }); SND.tone(d, t, { type: 'triangle', f: 150, f2: 55, g: .32, a: .001, d: .07 }); return; }   /* SH: suppressed — a cough, no crack */
      if (window.GT.samples && GT.samples.shot && GT.samples.shot(def.sample ? (def._smp || (def._smp = Object.assign({}, def, { id: def.sample }))) : def, d, t, P.dist, own)) return;   /* js/samples.js: recorded close / mid / far shot replaces the synth one (SH: def.sample = the nearest recorded gun) */
      SND.nz(d, t, { type: 'highpass', f: 2600 * p, q: .5, g: .9, a: .0006, d: sg ? .07 : .045 }); SND.nz(d, t, { f: 900 * p, f2: 240 * p, q: .6, g: 1.1, a: .001, d: sg ? .2 : .11 });
      SND.tone(d, t, { type: 'triangle', f: (sg ? 150 : 210) * p, f2: 48, g: sg ? 1.2 : .9, a: .001, d: sg ? .16 : .09 }); SND.nz(d, t + .012, { type: 'lowpass', f: 1500 * p, f2: 300, q: .3, g: .34, a: .01, d: sg ? .7 : .42 });
      if (def.id === 'rifle') SND.nz(d, t, { f: 4200, q: 2, g: .5, a: .0005, d: .03 }); if (def.id === 'revolver') SND.tone(d, t, { type: 'sawtooth', f: 320, f2: 90, g: .35, d: .07 }); },
    mech(kind, pos) { if (!SND.ok('m' + kind, .02)) return; const P = SND.place(pos, { g: .5, ref: 5 }), t = P.t, d = P.dst;
      if (window.GT.samples && GT.samples.mech && GT.samples.mech(kind, d, t)) return;   /* js/samples.js: recorded dry fire / mag / slide / pump */
      if (kind === 'dry') { SND.nz(d, t, { f: 3800, q: 3, g: .5, d: .018 }); SND.tone(d, t, { type: 'square', f: 1900, g: .12, d: .012 }); }
      else if (kind === 'magout') { SND.nz(d, t, { f: 2200, q: 2, g: .5, d: .03 }); SND.nz(d, t + .07, { f: 900, q: 1.5, g: .35, d: .06 }); }
      else if (kind === 'magin') { SND.nz(d, t, { f: 1500, q: 2, g: .6, d: .04 }); SND.tone(d, t, { f: 240, f2: 120, g: .3, d: .05 }); }
      else if (kind === 'rack') { SND.nz(d, t, { f: 2900, q: 1.6, g: .6, d: .035 }); SND.nz(d, t + .09, { f: 3600, q: 2, g: .7, d: .03 }); SND.tone(d, t + .09, { f: 300, f2: 150, g: .25, d: .04 }); }
      else if (kind === 'pump') { SND.nz(d, t, { f: 1300, f2: 700, q: 1.2, g: .8, d: .07 }); SND.nz(d, t + .16, { f: 1700, f2: 2600, q: 1.2, g: .8, d: .06 }); }
      else if (kind === 'shellin') { SND.nz(d, t, { f: 1900, q: 2.5, g: .5, d: .03 }); SND.tone(d, t + .02, { f: 520, f2: 300, g: .16, d: .04 }); }
      else if (kind === 'perfect') { SND.tone(d, t, { f: 1320, g: .22, d: .09 }); SND.tone(d, t + .05, { f: 1980, g: .2, d: .12 }); }
      else if (kind === 'draw') { SND.nz(d, t, { f: 2400, f2: 5200, q: .8, g: .3, d: .12 }); }
      else if (kind === 'tick') { SND.tone(d, t, { type: 'square', f: 1250, g: .07, d: .018 }); }
      else if (kind === 'hitmark') { SND.tone(d, t, { type: 'triangle', f: 2100, f2: 1500, g: .16, d: .035 }); }
      else if (kind === 'kill') { SND.tone(d, t, { type: 'triangle', f: 980, f2: 620, g: .2, d: .12 }); SND.tone(d, t + .07, { type: 'triangle', f: 1470, g: .14, d: .16 }); }
      else if (kind === 'focus') { SND.nz(d, t, { type: 'lowpass', f: 3000, f2: 180, q: 2, g: .5, a: .02, d: .5 }); SND.tone(d, t, { f: 110, f2: 55, g: .5, a: .02, d: .6 }); }
      else if (kind === 'focusout') { SND.nz(d, t, { type: 'lowpass', f: 200, f2: 3200, q: 2, g: .35, a: .05, d: .3 }); }
      else if (kind === 'wheel') { SND.nz(d, t, { type: 'lowpass', f: 1200, f2: 300, q: 1, g: .25, a: .02, d: .25 }); } },
    shell(pos, shot) { if (!SND.ok('shell', .04)) return; const P = SND.place(pos, { g: .22, ref: 4 }), t = P.t; if (window.GT.samples && GT.samples.shell && GT.samples.shell(P.dst, t, shot)) return; if (shot) SND.nz(P.dst, t, { f: 700, q: 1.5, g: .5, d: .05 }); else { SND.tone(P.dst, t, { f: 4300 + rnd() * 900, g: .2, d: .05 }); SND.tone(P.dst, t + .004, { f: 6800 + rnd() * 600, g: .12, d: .035 }); } },
    impact(pos, surf) { if (!SND.ok('imp', .035)) return; const P = SND.place(pos, { g: .5, ref: 9 }), t = P.t, d = P.dst;
      if (surf !== 'flesh' && GT.samples?.ready) {
        const material = ['metal', 'glass', 'wood'].includes(surf) ? surf : 'stone';
        if (GT.samples.play('impact_' + material, { dst: d, t, g: .84 })) return;
      }
      if (surf === 'metal') { SND.tone(d, t, { type: 'triangle', f: 2300 + rnd() * 1500, f2: 900, g: .3, d: .12 }); SND.nz(d, t, { f: 5200, q: 3, g: .5, d: .03 }); if (rnd() < .35) SND.tone(d, t + .01, { type: 'sine', f: 3200 + rnd() * 1800, f2: 5200 + rnd() * 2500, g: .16, a: .01, d: .32 }); }   // + ricochet whine
      else if (surf === 'glass') { SND.nz(d, t, { type: 'highpass', f: 5200, q: .6, g: .5, d: .16 }); SND.tone(d, t, { f: 3300, g: .1, d: .08 }); }
      else if (surf === 'flesh') { SND.nz(d, t, { type: 'lowpass', f: 600, q: .8, g: .7, d: .06 }); SND.tone(d, t, { f: 150, f2: 70, g: .4, d: .07 }); }
      else if (surf === 'wood') { SND.nz(d, t, { f: 1200, q: 1.2, g: .6, d: .05 }); SND.tone(d, t, { f: 420, f2: 200, g: .25, d: .05 }); }
      else { SND.nz(d, t, { f: 1900, f2: 700, q: .8, g: .6, d: .07 }); SND.nz(d, t + .02, { type: 'highpass', f: 3800, q: .5, g: .12, a: .02, d: .22 }); } },
    whiz(pos) { if (!SND.ok('whiz', .09)) return; const P = SND.place(pos, { g: .5, ref: 30 }); SND.nz(P.dst, P.t, { f: 2600, f2: 900, q: 6, g: .5, a: .015, d: .13 }); },
    melee(pos, heavy, blocked) { if (!SND.ok('melee', .05)) return; const P = SND.place(pos, { g: .9, ref: 7 }), t = P.t, d = P.dst;
      if (window.GT.samples && GT.samples.melee && GT.samples.melee(d, t, heavy, blocked, pos)) return;   /* js/samples.js: recorded punch / kick / bat / pipe + grunt */
      if (blocked) { SND.nz(d, t, { f: 1500, q: 2, g: .6, d: .05 }); SND.tone(d, t, { type: 'triangle', f: 700, f2: 380, g: .3, d: .09 }); return; }
      SND.tone(d, t, { f: heavy ? 120 : 170, f2: 46, g: heavy ? 1.2 : .8, d: heavy ? .16 : .1 }); SND.nz(d, t, { type: 'lowpass', f: heavy ? 900 : 1300, f2: 200, q: .7, g: .9, d: .07 }); if (heavy) SND.nz(d, t, { f: 2600, q: 1, g: .3, d: .03 }); },
    swish(pos) { if (!SND.ok('swish', .08)) return; const P = SND.place(pos, { g: .3, ref: 5 }); if (window.GT.samples && GT.samples.swish && GT.samples.swish(P.dst, P.t)) return; SND.nz(P.dst, P.t, { f: 700, f2: 2600, q: 1.5, g: .5, a: .05, d: .12 }); },
    body(pos) { if (!SND.ok('body', .1)) return; const P = SND.place(pos, { g: .7, ref: 8 }); if (window.GT.samples && GT.samples.body && GT.samples.body(P.dst, P.t)) return; SND.tone(P.dst, P.t, { f: 90, f2: 40, g: .9, d: .16 }); SND.nz(P.dst, P.t, { type: 'lowpass', f: 500, q: .6, g: .6, d: .12 }); },
    lamp(pos) { if (!SND.ok('lamp', .2)) return; const P = SND.place(pos, { g: .8, ref: 20 }); SND.nz(P.dst, P.t, { type: 'highpass', f: 4200, q: .6, g: .8, d: .3 }); SND.tone(P.dst, P.t, { type: 'sawtooth', f: 120, f2: 30, g: .6, d: .5 }); }
  };

  /* ================================================================== FX: tracers, muzzle flash, impacts, decals, brass, smoke (all pooled; HDR additive values bloom in GT.render) */
  const FX = { ready: false, sprites: [], tracers: [], flashes: [], lights: [], brass: [], bn: 0, dn: 0, tex: {},
    canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t; },
    init(scene) {
      if (FX.ready) return; FX.ready = true; const root = FX.root = new T.Group(); root.name = 'combat_fx'; scene.add(root); const r = GT.rng('combatfx');
      FX.tex.dot = FX.canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
      FX.tex.smoke = FX.canvasTex(128, 128, (g) => { for (let i = 0; i < 26; i++) { const x = 64 + (r() - .5) * 56, y = 64 + (r() - .5) * 56, rr = 14 + r() * 26, gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); } });
      FX.tex.star = FX.canvasTex(128, 128, (g) => { g.translate(64, 64); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(-64, -64, 128, 128);
        for (let i = 0; i < 9; i++) { const a = r() * TAU, l = 28 + r() * 34, w = 3 + r() * 5; g.rotate(a); const lg = g.createLinearGradient(0, 0, l, 0); lg.addColorStop(0, 'rgba(255,255,255,.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.beginPath(); g.moveTo(0, -w); g.lineTo(l, 0); g.lineTo(0, w); g.fill(); g.rotate(-a); } });
      FX.tex.streak = FX.canvasTex(32, 128, (g) => { const lg = g.createLinearGradient(0, 0, 32, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(.5, 'rgba(255,255,255,1)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.fillRect(0, 0, 32, 128);
        g.globalCompositeOperation = 'destination-in'; const vg = g.createLinearGradient(0, 0, 0, 128); vg.addColorStop(0, 'rgba(0,0,0,1)'); vg.addColorStop(.12, 'rgba(0,0,0,.9)'); vg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = vg; g.fillRect(0, 0, 32, 128); });
      FX.tex.hole = FX.canvasTex(64, 64, (g) => { g.translate(32, 32); g.fillStyle = 'rgba(205,198,184,.55)'; g.beginPath(); for (let i = 0; i <= 14; i++) { const a = i / 14 * TAU, rr = 17 + r() * 11; g[i ? 'lineTo' : 'moveTo'](cos(a) * rr, sin(a) * rr); } g.fill();
        g.fillStyle = 'rgba(60,56,50,.75)'; g.beginPath(); for (let i = 0; i <= 12; i++) { const a = i / 12 * TAU, rr = 9 + r() * 5; g[i ? 'lineTo' : 'moveTo'](cos(a) * rr, sin(a) * rr); } g.fill(); g.fillStyle = 'rgba(8,8,8,.96)'; g.beginPath(); g.arc(0, 0, 5.5, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(30,28,26,.5)'; g.lineWidth = 1; for (let i = 0; i < 5; i++) { const a = r() * TAU; g.beginPath(); g.moveTo(cos(a) * 6, sin(a) * 6); g.lineTo(cos(a + .2) * (18 + r() * 12), sin(a + .2) * (18 + r() * 12)); g.stroke(); } });
      for (let i = 0; i < 132; i++) { const m = new T.SpriteMaterial({ map: FX.tex.dot, transparent: true, depthWrite: false, fog: false }), s = new T.Sprite(m); s.visible = false; s.renderOrder = 6; root.add(s); FX.sprites.push({ s, m, life: 0, max: 1, vel: V3(), g: 0, grow: 0, a0: 1, size: 1, drag: 0, hdr: 1 }); }
      const tg = new T.PlaneGeometry(1, 1); tg.translate(0, -.5, 0);                                    // local +Y = head of the streak
      for (let i = 0; i < 28; i++) { const m = new T.MeshBasicMaterial({ map: FX.tex.streak, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false }), me = new T.Mesh(tg, m); me.visible = false; me.frustumCulled = false; me.matrixAutoUpdate = false; me.renderOrder = 7; root.add(me);
        FX.tracers.push({ me, m, on: false, from: V3(), dir: V3(), dist: 0, head: 0, len: 6, speed: 260, w: .03, col: new T.Color(), trail: 0 }); }
      const fg = new T.PlaneGeometry(1, 1), fz = new T.PlaneGeometry(1, 1); fz.translate(0, .5, 0);
      for (let i = 0; i < 5; i++) { const g = new T.Group(), mk = (geo, tex) => new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false }));
        const star = mk(fg, FX.tex.star), c1 = mk(fz, FX.tex.streak), c2 = mk(fz, FX.tex.streak); c1.rotation.x = HP; c2.rotation.x = HP; c2.rotation.y = HP; c1.rotation.order = c2.rotation.order = 'YXZ'; g.add(star, c1, c2); g.visible = false; g.renderOrder = 8; root.add(g); FX.flashes.push({ g, star, c1, c2, life: 0 }); }
      for (let i = 0; i < 2; i++) { const l = new T.PointLight(0xffb060, 0, 14, 2); l.position.set(0, -50, 0); root.add(l); FX.lights.push({ l, life: 0 }); }
      FX.decals = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: FX.tex.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }), 80); FX.decals.count = 0; FX.decals.frustumCulled = false; FX.decals.renderOrder = 3; root.add(FX.decals);
      const bg = new T.CylinderGeometry(.0052, .0056, .021, 8); bg.rotateX(HP); FX.brassMesh = new T.InstancedMesh(bg, new T.MeshStandardMaterial({ color: GT.C(0xc9a04a), roughness: .32, metalness: 1 }), 48); FX.brassMesh.count = 0; FX.brassMesh.frustumCulled = false; FX.brassMesh.castShadow = false; root.add(FX.brassMesh);
      for (let i = 0; i < 48; i++) FX.brass.push({ on: false, p: V3(), v: V3(), rot: new T.Euler(), spin: V3(), gy: 0, rest: false, bounces: 0, scale: 1, shot: false });
      /* debris with weight: plaster chunks (lit, flat-shaded) and glass shards (thin bright triangles), both instanced, thrown off the surface, bouncing once or twice and lying there for a few seconds */
      FX.tex.crack = FX.canvasTex(128, 128, (g) => { g.translate(64, 64); g.lineCap = 'round'; const sp = []; for (let i = 0; i < 11; i++) { const a = i / 11 * TAU + (r() - .5) * .4, l = 34 + r() * 26; sp.push([a, l]); g.strokeStyle = 'rgba(255,255,255,' + (.55 + r() * .4).toFixed(2) + ')'; g.lineWidth = .8 + r() * 1.3; g.beginPath(); g.moveTo(cos(a) * 4, sin(a) * 4); let x = cos(a) * 4, y = sin(a) * 4; for (let k = 1; k <= 4; k++) { const aa = a + (r() - .5) * .35, rr = l * k / 4; x = cos(aa) * rr; y = sin(aa) * rr; g.lineTo(x, y); } g.stroke(); }
        g.lineWidth = .9; for (const rr of [13, 24, 37]) for (let i = 0; i < 11; i++) { if (r() < .28) continue; const a0 = sp[i], a1 = sp[(i + 1) % 11]; if (rr > a0[1] || rr > a1[1]) continue; g.strokeStyle = 'rgba(255,255,255,' + (.3 + r() * .35).toFixed(2) + ')'; g.beginPath(); g.moveTo(cos(a0[0]) * rr, sin(a0[0]) * rr); g.lineTo(cos(a1[0]) * (rr + (r() - .5) * 5), sin(a1[0]) * (rr + (r() - .5) * 5)); g.stroke(); }
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, 13); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(.45, 'rgba(255,255,255,.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 13, 0, TAU); g.fill(); g.fillStyle = 'rgba(0,0,0,.9)'; g.beginPath(); g.arc(0, 0, 3.2, 0, TAU); g.fill(); });
      FX.cracks = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: FX.tex.crack, transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false, color: new T.Color(1.5, 1.7, 1.8) }), 28); FX.cracks.count = 0; FX.cracks.frustumCulled = false; FX.cracks.renderOrder = 4; root.add(FX.cracks); FX.cn = 0;
      { const cg = new T.TetrahedronGeometry(1, 0); cg.scale(1, .55, .8); FX.chunkMesh = new T.InstancedMesh(cg, new T.MeshStandardMaterial({ color: 0xffffff, roughness: .95, metalness: 0, flatShading: true }), 56); const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(new Float32Array([-.5, -.4, 0, .6, -.25, 0, -.1, .62, 0]), 3)); sg.computeVertexNormals();
        FX.shardMesh = new T.InstancedMesh(sg, new T.MeshBasicMaterial({ color: new T.Color(1.5, 1.9, 2.1), transparent: true, opacity: .62, side: T.DoubleSide, depthWrite: false, fog: false }), 72);
        for (const [me, arr, nn] of [[FX.chunkMesh, FX.chunks = [], 56], [FX.shardMesh, FX.shards = [], 72]]) { me.count = nn; me.frustumCulled = false; me.castShadow = false; _m.makeScale(0, 0, 0); for (let i = 0; i < nn; i++) { me.setMatrixAt(i, _m); me.setColorAt(i, _col.setRGB(1, 1, 1)); arr.push({ on: false, p: V3(), v: V3(), rot: new T.Euler(), spin: V3(), gy: 0, s: .03, life: 0, rest: false, n: 0 }); } me.instanceMatrix.needsUpdate = true; root.add(me); } FX.chn = FX.shn = 0; }
    },
    sprite(o) { if (!FX.ready) return null; let best = FX.sprites[0]; for (const p of FX.sprites) { if (p.life <= 0) { best = p; break; } if (p.life / p.max < best.life / best.max) best = p; }
      const p = best; p.life = p.max = o.life || .4; p.vel.copy(o.vel || _s.set(0, 0, 0)); p.g = o.g || 0; p.grow = o.grow || 0; p.a0 = o.a === undefined ? 1 : o.a; p.size = o.size || .1; p.drag = o.drag || 0; p.fadeIn = o.fadeIn || 0;
      p.m.map = FX.tex[o.tex || 'dot']; p.m.blending = o.add ? T.AdditiveBlending : T.NormalBlending; p.m.color.setRGB(o.r === undefined ? 1 : o.r, o.g2 === undefined ? (o.r === undefined ? 1 : o.r) : o.g2, o.b === undefined ? (o.r === undefined ? 1 : o.r) : o.b); p.m.rotation = o.rot === undefined ? rnd() * TAU : o.rot; p.spin = o.spin || 0;
      p.s.position.copy(o.pos); p.s.scale.setScalar(p.size); p.s.visible = true; p.m.opacity = p.fadeIn ? 0 : p.a0; p.m.needsUpdate = true; return p; },
    /** light level for unlit puffs so they sit in the scene (day bright, night dim) */
    amb() { const n = GT.env ? GT.env.night || 0 : 0; return lerp(.95, .16, n); },
    tracer(from, to, def, enemy) { if (!FX.ready) return; let t = null; for (const q of FX.tracers) if (!q.on) { t = q; break; } if (!t) t = FX.tracers[(FX.tn = ((FX.tn || 0) + 1) % FX.tracers.length)];
      t.on = true; t.from.copy(from); t.dir.copy(to).sub(from); t.dist = t.dir.length(); t.dir.multiplyScalar(1 / (t.dist || 1)); t.head = min(t.dist, 2.5); t.len = min(14, max(5, t.dist * .45)); t.speed = 240; t.w = (def && def.pellets > 1) ? .016 : .028; t.fade = 1;
      const k = def && def.tracer !== undefined ? .5 + def.tracer : 1; if (enemy) t.col.setRGB(5 * k, 1.5 * k, .6 * k); else t.col.setRGB(4.6 * k, 2.9 * k, 1.1 * k); t.me.visible = true; },
    flash(pos, dir, scale, light) { if (!FX.ready) return; let f = FX.flashes[0]; for (const q of FX.flashes) if (q.life <= 0) { f = q; break; } f.life = .04; f.g.visible = true; f.g.position.copy(pos); _a.copy(pos).add(dir); f.g.lookAt(_a); const s = scale || 1;
      f.star.scale.setScalar(.36 * s * (.8 + rnd() * .4)); f.star.rotation.z = rnd() * TAU; f.c1.scale.set(.13 * s, .5 * s * (.8 + rnd() * .5), 1); f.c2.scale.copy(f.c1.scale); f.c1.rotation.z = rnd() * PI; f.c2.rotation.z = f.c1.rotation.z;
      for (const m of [f.star, f.c1, f.c2]) m.material.color.setRGB(11, 6.8, 2.6);
      if (light !== false && !FX.lent) { let L = FX.lights[0]; if (L.life > FX.lights[1].life) L = FX.lights[1]; L.life = .07; L.l.position.copy(pos).addScaledVector(dir, .25); L.l.intensity = 5.5 * s; L.max = 5.5 * s; }
      { const tc = GT.weapons && GT.weapons.tint, n = GT.env ? GT.env.night || 0 : 0, am = FX.amb() * .8, k = tc ? n * .9 : 0;   /* the puff at the muzzle is lit by the place: grey by day, the district's colour at night */
        FX.sprite({ pos: _a.copy(pos).addScaledVector(dir, .12), tex: 'smoke', life: 1.1, size: .16, grow: .55, a: .26, r: am * (1 - k) + (tc ? tc.r : 0) * k * .5 + .05 * k, g2: am * (1 - k) + (tc ? tc.g : 0) * k * .5 + .05 * k, b: am * (1 - k) + (tc ? tc.b : 0) * k * .5 + .05 * k, vel: _b.copy(dir).multiplyScalar(.7).setY(.35), drag: 3, spin: .6 }); } },
    glint(pos) { FX.sprite({ pos, tex: 'star', add: true, life: .34, size: .5, r: 5, g2: 2.2, b: 1.2, grow: -.9, fadeIn: .08, spin: 3 }); },
    /** k pieces of debris from `pos` along normal n. glass: thin shards; else plaster / wood chunks tinted (cr, cg, cb) */
    debris(pos, n, k, glass, cr, cg, cb, big) { if (!FX.chunks) return; const arr = glass ? FX.shards : FX.chunks, me = glass ? FX.shardMesh : FX.chunkMesh, gy = groundY(pos.x + n.x * .3, pos.z + n.z * .3, pos.y - 1.2);
      for (let i = 0; i < k; i++) { const j = glass ? (FX.shn = (FX.shn + 1) % arr.length) : (FX.chn = (FX.chn + 1) % arr.length), b = arr[j]; b.on = true; b.rest = false; b.n = 0; b.life = glass ? 3.5 + rnd() * 2 : 5 + rnd() * 3; b.gy = gy + .012; b.s = (glass ? .028 + rnd() * .05 : .014 + rnd() * .03) * (big || 1);
        b.p.copy(pos).addScaledVector(n, .03); b.p.x += (rnd() - .5) * .08; b.p.y += (rnd() - .5) * .08; b.p.z += (rnd() - .5) * .08; b.v.set(rnd() - .5, rnd() * .9 - .15, rnd() - .5).multiplyScalar(glass ? 2.2 : 2.6).addScaledVector(n, 1.2 + rnd() * (glass ? 2.6 : 3.4)); b.rot.set(rnd() * 6, rnd() * 6, rnd() * 6); b.spin.set((rnd() - .5) * 22, (rnd() - .5) * 22, (rnd() - .5) * 22);
        if (!glass) { const q = .8 + rnd() * .35; me.setColorAt(j, _col.setRGB(cr * q, cg * q, cb * q)); } } if (!glass && me.instanceColor) me.instanceColor.needsUpdate = true; },
    crack(pos, n) { const D = FX.cracks; if (!D) return; const i = FX.cn % 28; FX.cn++; D.count = min(28, FX.cn); const s = .34 + rnd() * .3; _q.setFromUnitVectors(_a.set(0, 0, 1), n); _q2.setFromAxisAngle(_a.set(0, 0, 1), rnd() * TAU); _q.multiply(_q2); _m.compose(_b.copy(pos).addScaledVector(n, .012), _q, _s.set(s, s, s)); D.setMatrixAt(i, _m); D.instanceMatrix.needsUpdate = true; },
    /** n = surface normal (Vector3) */
    impact(pos, n, surf, heavy) { if (!FX.ready) return; const A = FX.amb(), big = heavy ? 1.5 : 1;
      if (surf === 'metal') { for (let i = 0; i < 7; i++) FX.sprite({ pos, add: true, life: .16 + rnd() * .3, size: .035 + rnd() * .03, r: 9, g2: 5.5, b: 1.8, vel: _a.set(rnd() - .5, rnd() - .2, rnd() - .5).multiplyScalar(3).addScaledVector(n, 2.5 + rnd() * 3.5), g: -9, grow: -.05 });
        FX.sprite({ pos, add: true, tex: 'star', life: .07, size: .34, r: 8, g2: 5, b: 2 }); FX.sprite({ pos, tex: 'smoke', life: .5, size: .12, grow: .5, a: .25, r: A * .7, vel: _a.copy(n).multiplyScalar(.5) }); }
      else if (surf === 'glass') { for (let i = 0; i < 9; i++) FX.sprite({ pos, life: .3 + rnd() * .4, size: .03 + rnd() * .035, r: 1.8, g2: 2.2, b: 2.4, add: true, vel: _a.set(rnd() - .5, rnd() - .3, rnd() - .5).multiplyScalar(2.6).addScaledVector(n, 1.5 + rnd() * 2.4), g: -9 });
        FX.sprite({ pos, add: true, tex: 'star', life: .1, size: .5, r: 3.2, g2: 3.8, b: 4.2 }); FX.crack(pos, n); _f.copy(n).multiplyScalar(-1); FX.debris(pos, n, 9, true); FX.debris(pos, _f, 12, true);   /* a web of cracks stays on the pane; shards go both ways, more out the far side */
        FX.sprite({ pos, tex: 'smoke', life: .45, size: .2, grow: .7, a: .3, r: A, g2: A * 1.05, b: A * 1.08, vel: _a.copy(n).multiplyScalar(.8) }); }
      else if (surf === 'flesh') { FX.sprite({ pos, tex: 'smoke', life: .38, size: .16, grow: .75, a: .5, r: A * .75, g2: A * .7, b: A * .66, vel: _a.copy(n).multiplyScalar(1.2).setY(.4), drag: 4 });
        for (let i = 0; i < 4; i++) FX.sprite({ pos, life: .22 + rnd() * .2, size: .03, r: A * .25, a: .9, vel: _a.set(rnd() - .5, rnd() * .6, rnd() - .5).multiplyScalar(2).addScaledVector(n, 1.5), g: -9 }); }
      else { const wood = surf === 'wood', Ad = max(A, .5), cr = wood ? A * .5 : Ad * .92, cg = wood ? A * .4 : Ad * .88, cb = wood ? A * .28 : Ad * .8;   /* plaster dust is pale whatever the hour */
        if (!wood) { FX.sprite({ pos: _b.copy(pos).addScaledVector(n, .08), tex: 'smoke', life: 1.5 * big, size: .34 * big, grow: 1.5 * big, a: .8, r: cr, g2: cg, b: cb, vel: _a.copy(n).multiplyScalar(2.2).setY(n.y * 2.2 + .3), drag: 3.6, spin: .7 });
          FX.sprite({ pos: _b.copy(pos).addScaledVector(n, .1), tex: 'smoke', life: 2.6, size: .5, grow: .55, a: .34, r: cr, g2: cg, b: cb, vel: _a.copy(n).multiplyScalar(.45).setY(.22), drag: 1.6, fadeIn: .25, spin: .3 });
          _d.set(-n.z, 0, n.x); if (_d.lengthSq() < .01) _d.set(1, 0, 0); for (const sg of [-1, 1]) FX.sprite({ pos: _b.copy(pos).addScaledVector(n, .05), tex: 'smoke', life: .7, size: .16, grow: .9, a: .6, r: cr, g2: cg, b: cb, vel: _a.copy(_d).multiplyScalar(sg * 1.5).addScaledVector(n, .5), drag: 4 });
          for (let i = 0; i < 3; i++) FX.sprite({ pos: _b.copy(pos).addScaledVector(n, .03), tex: 'smoke', life: .9 + i * .25, size: .07, grow: .12, a: .55, r: cr, g2: cg, b: cb, vel: _a.set((rnd() - .5) * .2, -.5 - rnd() * .5, (rnd() - .5) * .2), g: -2.5, fadeIn: .12 + i * .14 });   /* grit running down from the hole */
          FX.sprite({ pos, add: true, tex: 'star', life: .06, size: .3, r: 2.4, g2: 2.1, b: 1.6 }); }
        FX.debris(pos, n, wood ? 4 : 9, false, wood ? .42 : .86, wood ? .3 : .83, wood ? .18 : .76, big);
        FX.sprite({ pos: _b.copy(pos).addScaledVector(n, .05), tex: 'smoke', life: .95 * big, size: .26 * big, grow: .95 * big, a: .85, r: cr, g2: cg, b: cb, vel: _a.copy(n).multiplyScalar(1.3).setY(n.y * 1.3 + .25), drag: 3.2, spin: .8 });
        FX.sprite({ pos: _b.copy(pos).addScaledVector(n, .05), tex: 'smoke', life: 1.5 * big, size: .2, grow: .6, a: .5, r: cr, g2: cg, b: cb, vel: _a.copy(n).multiplyScalar(.5).setY(.35), drag: 2, fadeIn: .1 });
        for (let i = 0; i < 6; i++) FX.sprite({ pos, life: .3 + rnd() * .35, size: .022 + rnd() * .028, a: .95, r: cr * .8, g2: cg * .8, b: cb * .8, vel: _a.set(rnd() - .5, rnd() - .2, rnd() - .5).multiplyScalar(2.4).addScaledVector(n, 1.6 + rnd() * 2.4), g: -9.8 }); }
      if (surf !== 'flesh' && surf !== 'glass' && surf !== 'none') FX.decal(pos, n, surf); },
    decal(pos, n, surf) { const D = FX.decals; if (!D) return; const i = FX.dn % 80; FX.dn++; D.count = min(80, FX.dn); const s = (surf === 'metal' ? .06 : surf === 'wood' ? .08 : .15) * (.8 + rnd() * .5);
      _q.setFromUnitVectors(_a.set(0, 0, 1), n); _q2.setFromAxisAngle(_a.set(0, 0, 1), rnd() * TAU); _q.multiply(_q2); _m.compose(_b.copy(pos).addScaledVector(n, .006), _q, _s.set(s, s, s)); D.setMatrixAt(i, _m);
      const c = surf === 'metal' ? 1.5 : FX.amb() + .05; D.setColorAt(i, _col.setRGB(c, c, c)); D.instanceMatrix.needsUpdate = true; if (D.instanceColor) D.instanceColor.needsUpdate = true; },
    eject(pos, vel, gy, shot) { if (!FX.ready) return; const b = FX.brass[FX.bn % 48]; FX.bn++; FX.brassMesh.count = min(48, FX.bn); b.on = true; b.rest = false; b.bounces = 0; b.p.copy(pos); b.v.copy(vel); b.gy = gy + .006; b.shot = !!shot; b.scale = shot ? 1.75 : 1;
      b.rot.set(rnd() * 6, rnd() * 6, rnd() * 6); b.spin.set((rnd() - .5) * 30, (rnd() - .5) * 30, (rnd() - .5) * 30); b.idx = (FX.bn - 1) % 48; FX.brassMesh.setColorAt(b.idx, _col.setRGB(shot ? 1.1 : 1, shot ? .25 : 1, shot ? .2 : 1)); if (FX.brassMesh.instanceColor) FX.brassMesh.instanceColor.needsUpdate = true; },
    update(dt, cam) { if (!FX.ready) return;
      for (const p of FX.sprites) { if (p.life <= 0) continue; p.life -= dt; if (p.life <= 0) { p.s.visible = false; continue; } const k = 1 - p.life / p.max; p.vel.y += p.g * dt; if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt)); p.s.position.addScaledVector(p.vel, dt);
        p.size = max(.004, p.size + p.grow * dt); p.s.scale.setScalar(p.size); p.m.rotation += p.spin * dt; p.m.opacity = p.a0 * (p.fadeIn && k * p.max < p.fadeIn ? k * p.max / p.fadeIn : (1 - k) * (1 - k * .4)); }
      const cp = cam ? cam.position : _f.set(0, 2, 0);
      for (const t of FX.tracers) { if (!t.on) continue; t.head += t.speed * dt; const h1 = min(t.dist, t.head), h0 = max(0, t.head - t.len); if (h0 >= t.dist) { t.fade -= dt * 9; if (t.fade <= 0) { t.on = false; t.me.visible = false; continue; } }
        const L = max(.3, (h0 >= t.dist ? t.dist - max(0, t.dist - t.len * .5) : h1 - h0)), hp = _a.copy(t.from).addScaledVector(t.dir, h1); _b.copy(cp).sub(hp); const x = _c.crossVectors(t.dir, _b).normalize(), z = _d.crossVectors(x, t.dir), w = t.w * (1 + hp.distanceTo(cp) * .028);
        t.me.matrix.set(x.x * w, t.dir.x * L, z.x, hp.x, x.y * w, t.dir.y * L, z.y, hp.y, x.z * w, t.dir.z * L, z.z, hp.z, 0, 0, 0, 1); t.m.color.copy(t.col).multiplyScalar(max(0, t.fade)); }
      for (const f of FX.flashes) { if (f.life <= 0) continue; f.life -= dt; if (f.life <= 0) f.g.visible = false; else if (cam) f.star.quaternion.copy(f.g.quaternion).invert().multiply(cam.quaternion); }
      if (!FX.lent) for (const L of FX.lights) { if (L === TH.light) continue; if (L.life <= 0) { if (L.l.intensity) L.l.intensity = 0; continue; } L.life -= dt; L.l.intensity = L.life > 0 ? L.max * (L.life / .07) : 0; }
      let dirty = false; for (const b of FX.brass) { if (!b.on) continue; if (!b.rest) { b.v.y -= 9.8 * dt; b.p.addScaledVector(b.v, dt); b.rot.x += b.spin.x * dt; b.rot.y += b.spin.y * dt; b.rot.z += b.spin.z * dt;
            if (b.p.y < b.gy) { b.p.y = b.gy; b.bounces++; if (b.bounces === 1) SND.shell(b.p, b.shot); if (abs(b.v.y) < .9 || b.bounces > 3) { b.rest = true; b.rot.x = 0; b.rot.z = 0; } else { b.v.y *= -.42; b.v.x *= .55; b.v.z *= .55; b.spin.multiplyScalar(.6); } } }
          else if (b.done) continue; _q.setFromEuler(b.rot); _m.compose(b.p, _q, _s.set(b.scale, b.scale, b.scale)); FX.brassMesh.setMatrixAt(b.idx, _m); dirty = true; if (b.rest) b.done = true; else b.done = false; }
      if (dirty) FX.brassMesh.instanceMatrix.needsUpdate = true;
      if (FX.chunks) for (const [me, arr, glass] of [[FX.chunkMesh, FX.chunks, false], [FX.shardMesh, FX.shards, true]]) { let dq = false; for (let i = 0; i < arr.length; i++) { const b = arr[i]; if (!b.on) continue; dq = true; b.life -= dt;
            if (!b.rest) { b.v.y -= 9.8 * dt; b.p.addScaledVector(b.v, dt); b.rot.x += b.spin.x * dt; b.rot.y += b.spin.y * dt; b.rot.z += b.spin.z * dt; if (b.p.y < b.gy) { b.p.y = b.gy; b.n++; if (b.n === 1 && glass && rnd() < .25) SND.shell(b.p, false); if (abs(b.v.y) < 1.1 || b.n > 2) { b.rest = true; b.rot.x = glass ? HP : 0; b.rot.z = 0; } else { b.v.y *= -.32; b.v.x *= .5; b.v.z *= .5; b.spin.multiplyScalar(.5); } } }
            const sc = b.s * sat(b.life * 1.6); if (b.life <= 0) { b.on = false; _m.makeScale(0, 0, 0); } else { _q.setFromEuler(b.rot); _m.compose(b.p, _q, _s.set(sc, sc, sc)); } me.setMatrixAt(i, _m); } if (dq) me.instanceMatrix.needsUpdate = true; } },
    clear() { if (!FX.ready) return; for (const p of FX.sprites) { p.life = 0; p.s.visible = false; } for (const t of FX.tracers) { t.on = false; t.me.visible = false; } FX.dn = 0; FX.decals.count = 0; FX.bn = 0; FX.brassMesh.count = 0; for (const b of FX.brass) b.on = false; if (FX.cracks) { FX.cn = 0; FX.cracks.count = 0; } if (FX.chunks) for (const [me, arr] of [[FX.chunkMesh, FX.chunks], [FX.shardMesh, FX.shards]]) { _m.makeScale(0, 0, 0); for (let i = 0; i < arr.length; i++) { arr[i].on = false; me.setMatrixAt(i, _m); } me.instanceMatrix.needsUpdate = true; } }
  };
  const _col = new T.Color();

  /* ================================================================== world queries: GT.world.boxes as 3-D AABBs (0..h), flat ground, surfaces by tag */
  const NOBULLET = /fence|edge-|closure|zone|leaf|trigger|wire/, NOCOVER = /fence|edge-|closure|zone|pole|palm|tree|sign|signal|light|hydrant|pylon|billboard|lamp|post|rail|stair|step|floor|cage|door|kerb|curb/, CARTAG = /\bcar\b|combat-car|parked|\bvan\b|pickup|truck|cruiser|taxi|sports|police/;
  const num = v => typeof v === 'number' && v === v;
  /** feet height at (x, z): road ground, then the raised floors of the set pieces once they are built (fromY picks the storey where two overlap), then a scenario's own floor */
  function groundY(x, z, fromY) { let y = 0; const f = (GT.cnroad && GT.cnroad.groundHeight) || (GT.road && GT.road.groundHeight), AN = GT.world.anchors; if (f) { try { const v = f(x, z); if (num(v)) y = v; } catch (e) {} }
    const lm = GT.landmarks; if (lm && lm.groundHeight && AN.clockLobby && !S.standin) { try { const v = lm.groundHeight(x, z); if (num(v) && v > y) y = v; } catch (e) {} }
    const rv = GT.riverside; if (rv && rv.groundHeight && AN.wharfDoor && x < -9.5 && !S.standin) { try { const v = rv.groundHeight(x, z, fromY); if (num(v)) y = v; } catch (e) {} }
    const ff = (S.sc && S.sc.floor) || S.floorFn; if (ff) { const v = ff(x, z, fromY); if (num(v)) y = v; } return y; }
  function surfOf(b, nx, nz, py) { const t = b.tag || ''; if (b.surf) return b.surf;
    if (CARTAG.test(t)) return py > b.h * .6 ? 'glass' : 'metal'; if (/storefront|glass|window|busstop/.test(t)) return 'glass'; if (/crate|pallet|wood|bench|palm|tree|desk|counter|teller|sack|machine|stall|stool|table|rack/.test(t)) return 'wood';
    if (/column|portico|stone|pier|plinth|planter|kerb|curb/.test(t)) return 'stucco';
    if (/pump|dumpster|drum|cabinet|mailbox|newsrack|hydrant|pole|light|signal|sign|pylon|billboard|trash|forklift|metal|container|barricade|cage|wh wall|shed|rail|bollard|scooter|bike|trike|shutter/.test(t)) return 'metal'; return 'stucco'; }
  const HIT = { t: 0, box: null, nx: 0, ny: 0, nz: 0 };
  /** nearest box hit along a ray (unit dir). mode: 0 = bullets, 1 = line of sight (car glass is see-through), 2 = everything solid (camera / movement). skip = box to ignore */
  function rayBoxes(ox, oy, oz, dx, dy, dz, maxT, mode, skip) {
    let best = maxT, hb = null, bnx = 0, bny = 0, bnz = 0; const B = GT.world.boxes, ex = ox + dx * maxT, ez = oz + dz * maxT, x0 = min(ox, ex), x1 = max(ox, ex), z0 = min(oz, ez), z1 = max(oz, ez);
    for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.x1 < x0 || b.x0 > x1 || b.z1 < z0 || b.z0 > z1 || b === skip) continue; if (mode !== 2 && NOBULLET.test(b.tag)) continue; if (b.passable) continue; if (mode === 1 && b.seeThru) continue;   /* a glass pane stops nobody's eyes */
      const top = (b.y0 || 0) + (mode === 1 && CARTAG.test(b.tag) ? b.h * .6 : b.h), bot = b.y0 || -1; let t0 = 0, t1 = best, ax = 0, sgn = 0;
      if (abs(dx) < 1e-9) { if (ox < b.x0 || ox > b.x1) continue; } else { let a = (b.x0 - ox) / dx, c = (b.x1 - ox) / dx, s = -1; if (a > c) { const q = a; a = c; c = q; s = 1; } if (a > t0) { t0 = a; ax = 0; sgn = s; } if (c < t1) t1 = c; if (t0 > t1) continue; }
      if (abs(dz) < 1e-9) { if (oz < b.z0 || oz > b.z1) continue; } else { let a = (b.z0 - oz) / dz, c = (b.z1 - oz) / dz, s = -1; if (a > c) { const q = a; a = c; c = q; s = 1; } if (a > t0) { t0 = a; ax = 2; sgn = s; } if (c < t1) t1 = c; if (t0 > t1) continue; }
      if (abs(dy) < 1e-9) { if (oy < bot || oy > top) continue; } else { let a = (bot - oy) / dy, c = (top - oy) / dy, s = -1; if (a > c) { const q = a; a = c; c = q; s = 1; } if (a > t0) { t0 = a; ax = 1; sgn = s; } if (c < t1) t1 = c; if (t0 > t1) continue; }
      if (t0 <= 0) { if (mode === 2) continue; t0 = 0; }                                             // starting inside a box: bullets stop at once, the camera ignores it
      if (t0 < best) { best = t0; hb = b; bnx = ax === 0 ? sgn : 0; bny = ax === 1 ? sgn : 0; bnz = ax === 2 ? sgn : 0; } }
    if (!hb) return null; HIT.t = best; HIT.box = hb; HIT.nx = bnx; HIT.ny = bny; HIT.nz = bnz; return HIT; }
  /** clear line between two points? */
  function los(ax, ay, az, bx, by, bz) { const dx = bx - ax, dy = by - ay, dz = bz - az, l = hyp(dx, dy, dz); if (l < .01) return true; return !rayBoxes(ax, ay, az, dx / l, dy / l, dz / l, l - .05, 1); }
  /** push a circle out of the solid boxes (h > .35). returns true if it touched something */
  function collide(p, r, ignore) { let hit = false; const B = GT.world.boxes, fy = (p.y || 0) + .35; for (let it = 0; it < 2; it++) for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.h < fy || b === ignore || b.passable) continue; if (p.x < b.x0 - r || p.x > b.x1 + r || p.z < b.z0 - r || p.z > b.z1 + r) continue;
        const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1); let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz; if (d2 > r * r) continue; hit = true;
        if (d2 > 1e-8) { const d = sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; } else { const l = p.x - b.x0, rr = b.x1 - p.x, n = p.z - b.z0, f = b.z1 - p.z, m = min(l, rr, n, f); if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === n) p.z = b.z0 - r; else p.z = b.z1 + r; } }
    return hit; }
  function pointFree(x, z, r, y) { const B = GT.world.boxes, fy = (y || 0) + .35; for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.h < fy || b.passable) continue; if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return false; } return true; }
  /** walkable straight line (2-D, waist height)? */
  function walkClear(ax, az, bx, bz, y) { const dx = bx - ax, dz = bz - az, l = hyp(dx, dz); if (l < .05) return true; return !rayBoxes(ax, (y || 0) + .5, az, dx / l, 0, dz / l, l, 2); }
  function nearestWall(x, y, z) { let best = 30; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU, h = rayBoxes(x, y, z, sin(a), 0, cos(a), best, 0); if (h) best = h.t; } return best; }
  function addProp(x0, z0, x1, z1, h, tag, surf) { GT.world.addBox(x0, z0, x1, z1, h + (S.propY || 0), tag); const b = GT.world.boxes[GT.world.boxes.length - 1]; if (surf) b.surf = surf; b.combat = true; S.coverKey = ''; return b; }

  /* ------------------------------------------------------------------ cover points: sides of nearby boxes, low (< 1.45 m, crouch + shoot over) or high (corners only) */
  function buildCovers(cx, cz, R, y0) {
    y0 = y0 || 0; const key = GT.world.boxes.length + ':' + Math.round(cx / 12) + ':' + Math.round(cz / 12) + ':' + R + ':' + Math.round(y0); if (key === S.coverKey) return S.covers; S.coverKey = key; const out = S.covers = [], B = GT.world.boxes, OFF = .52;
    for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.h < y0 + .8 || b.passable || NOCOVER.test(b.tag)) continue; if (b.x1 < cx - R || b.x0 > cx + R || b.z1 < cz - R || b.z0 > cz + R) continue; const w = b.x1 - b.x0, d = b.z1 - b.z0; if (max(w, d) < .7) continue;
      const car = CARTAG.test(b.tag);
      const side = (ax, az, bx, bz, nx, nz, si) => { const L = hyp(bx - ax, bz - az); if (L < .6) return; const tx = (bx - ax) / L, tz = (bz - az) / L, n = max(1, Math.round(L / 1.15)), ins = min(.38, L / 2);
        for (let k = 0; k <= n; k++) { const s = n === 0 ? L / 2 : lerp(ins, L - ins, k / n), px = ax + tx * s + nx * OFF, pz = az + tz * s + nz * OFF; if (px < cx - R || px > cx + R || pz < cz - R || pz > cz + R) continue; const gy = groundY(px, pz, y0), rh = b.h - gy; if (rh < .8 || abs(gy - y0) > 1.6 || !pointFree(px, pz, .26, gy)) continue;
          const low = car || rh < 1.5, corner = L < 1.3 ? 2 : k === 0 ? -1 : k === n ? 1 : 0; if (!low && corner === 0) continue;
          out.push({ x: px, z: pz, y: gy, nx, nz, tx, tz, low, h: rh, box: b, side: si, s, L, corner, user: null, ax, az }); if (n === 0) break; } };
      side(b.x0, b.z0, b.x1, b.z0, 0, -1, 0); side(b.x1, b.z0, b.x1, b.z1, 1, 0, 1); side(b.x1, b.z1, b.x0, b.z1, 0, 1, 2); side(b.x0, b.z1, b.x0, b.z0, -1, 0, 3); }
    return out; }
  /** does cover point c hide someone crouched there from a threat at (tx, tz)? */
  function coverHides(c, tx, tz, ty) { const dx = tx - c.x, dz = tz - c.z, l = hyp(dx, dz) || 1; if ((dx * c.nx + dz * c.nz) / l > -.3) return false; return !los(c.x, c.y + (c.low ? .8 : 1.4), c.z, tx, (ty === undefined ? c.y : ty) + 1.3, tz); }
  /** where a shooter stands to fire from cover point c (low: same spot standing; high corner: one step past the edge) */
  function peekSpot(c, tx, tz) { if (c.low) return { x: c.x, z: c.z, stand: true }; let dir = c.corner; if (dir === 0 || dir === 2) { const a = hyp(tx - (c.x + c.tx), tz - (c.z + c.tz)), b = hyp(tx - (c.x - c.tx), tz - (c.z - c.tz)); dir = a < b ? 1 : -1; }
    const d = dir > 0 ? (c.L - c.s) + .5 : c.s + .5; return { x: c.x + c.tx * dir * d, z: c.z + c.tz * dir * d, stand: true }; }

  /* ================================================================== rigs: one adapter for GT.hero figures (bones object) and GT.people figures (bones array) + rig-agnostic 2-bone IK */
  const ZERO = V3();
  function rigOf(fig) { const B = fig && fig.bones; if (!B) return null; const arr = Array.isArray(B), get = n => (arr ? B.find(b => b && b.name === n) : B[n]) || null, R = { hero: !arr };
    for (const n of ['hips', 'spine', 'chest', 'neck', 'head', 'handL', 'handR', 'footL', 'footR', 'propR', 'propL']) R[n] = get(n);
    for (const s of ['L', 'R']) { const hand = R['hand' + s], foot = R['foot' + s]; R['fore' + s] = get('fore' + s) || (hand && hand.parent && hand.parent.isBone ? hand.parent : null); const fo = R['fore' + s]; R['arm' + s] = get('arm' + s) || (fo && fo.parent && fo.parent.isBone ? fo.parent : null);
      R['shin' + s] = get('shin' + s) || (foot && foot.parent && foot.parent.isBone ? foot.parent : null); const sh = R['shin' + s]; R['thigh' + s] = get('thigh' + s) || (sh && sh.parent && sh.parent.isBone ? sh.parent : null); }
    if (!R.chest || !R.head || !R.handR || !R.hips) return null; R.states = arr ? (GT.people && GT.people.states) || [] : null; return R; }
  const wpos = (o, v) => v.setFromMatrixPosition(o.matrixWorld);
  function rotWorld(bone, q) { bone.parent.getWorldQuaternion(_q2); bone.getWorldQuaternion(_q3); _q3.premultiply(q); bone.quaternion.copy(_q2.invert().multiply(_q3)); bone.updateMatrixWorld(true); }
  const ik = { a: V3(), b: V3(), c: V3(), t: V3(), d: V3(), p: V3(), e: V3(), q: new T.Quaternion() };
  function ikArm(up, fo, hand, target, pole) { if (!up || !fo || !hand) return; const a = wpos(up, ik.a), b = wpos(fo, ik.b), c = wpos(hand, ik.c), l1 = a.distanceTo(b), l2 = b.distanceTo(c); if (l1 < .01 || l2 < .01) return;
    const dT = ik.d.copy(target).sub(a), dist = dT.length() || 1e-4; dT.multiplyScalar(1 / dist); const d = clamp(dist, abs(l1 - l2) + .01, l1 + l2 - .004), x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), hgt = sqrt(max(0, l1 * l1 - x * x));
    const pl = ik.p.copy(pole).addScaledVector(dT, -pole.dot(dT)); if (pl.lengthSq() < 1e-6) pl.set(0, -1, 0).addScaledVector(dT, dT.y); pl.normalize();
    const e = ik.e.copy(a).addScaledVector(dT, x).addScaledVector(pl, hgt).sub(a).normalize(); ik.q.setFromUnitVectors(ik.t.copy(b).sub(a).normalize(), e); rotWorld(up, ik.q);
    wpos(fo, ik.b); wpos(hand, ik.c); ik.t.copy(a).addScaledVector(dT, d).sub(ik.b).normalize(); ik.q.setFromUnitVectors(ik.e.copy(ik.c).sub(ik.b).normalize(), ik.t); rotWorld(fo, ik.q); }
  function quatDir(out, dir, up, roll) { _m2.lookAt(dir, ZERO, up || UP); out.setFromRotationMatrix(_m2); if (roll) { _q3.setFromAxisAngle(_s.set(0, 0, 1), roll); out.multiply(_q3); } return out; }
  function setWorld(obj, pos, quat) { const p = obj.parent; if (!p) { obj.position.copy(pos); obj.quaternion.copy(quat); return; } _m.compose(pos, quat, _s.set(1, 1, 1)); _m2.copy(p.matrixWorld).invert().multiply(_m); _m2.decompose(obj.position, obj.quaternion, obj.scale); obj.updateMatrixWorld(true); }
  const PSTATE = { sprint: 'run', crouch_walk: 'crouch', fall: 'handsup', carry: 'run', lean: 'idle', use: 'idle' };
  function mapState(a, st) { const R = a.rig; if (!R || R.hero) return st; const L = R.states; if (st === 'cower') return L.includes('cower') ? 'cower' : 'crouch'; if (L.includes(st)) return st; const m = PSTATE[st]; return m && L.includes(m) ? m : 'idle'; }

  /* hand paths for melee, in body space [k, right, up, forward] relative to the chest; hit = contact fraction */
  const SWING = {
    l1: { hit: .5, p: [[0, .42, .1, -.05], [.3, .56, .22, -.24], [.5, .22, .1, .66], [.78, -.36, 0, .36], [1, -.2, -.12, .2]], tw: [-.5, .7] },
    l2: { hit: .5, p: [[0, -.3, .02, .25], [.26, -.44, .16, .02], [.5, .1, .12, .68], [.78, .5, .04, .3], [1, .35, -.08, .16]], tw: [.6, -.6] },
    l3: { hit: .56, p: [[0, .3, .25, 0], [.34, .22, .66, -.26], [.56, .08, .22, .7], [.8, 0, -.22, .5], [1, .1, -.26, .3]], tw: [-.25, .3], lean: .35 },
    heavy: { hit: .7, p: [[0, .4, .14, 0], [.2, .55, .34, -.2], [.52, .6, .5, -.36], [.7, .2, .16, .74], [.86, -.42, -.06, .4], [1, -.25, -.16, .2]], tw: [-.9, .9], lean: .2 },
    jab: { hit: .36, p: [[0, .2, 0, .22], [.36, .1, .1, .74], [1, .2, -.02, .26]], tw: [-.1, .35] },
    cross: { hit: .4, left: true, p: [[0, -.2, 0, .22], [.4, -.04, .12, .78], [1, -.2, -.02, .26]], tw: [.15, -.5] },
    hook: { hit: .56, p: [[0, .3, .06, .1], [.3, .52, .12, -.02], [.56, 0, .14, .62], [1, .2, -.02, .26]], tw: [-.5, .7] },
    shove: { hit: .42, both: true, p: [[0, .17, -.04, .2], [.42, .15, .08, .72], [1, .17, -.04, .3]], tw: [0, 0], lean: .25 },
    whip: { hit: .45, p: [[0, .25, .1, .1], [.25, .32, .36, -.08], [.45, .12, .16, .62], [1, .2, 0, .26]], tw: [-.3, .4] },
    takedown: { hit: .5, both: true, p: [[0, .17, 0, .25], [.3, .2, .2, .5], [.5, .14, .12, .62], [.8, .1, -.3, .45], [1, .17, -.1, .3]], tw: [0, 0], lean: .5 },
    block: { hit: 2, both: true, p: [[0, .16, .2, .36], [1, .16, .2, .36]], tw: [0, 0] },
    guard: { hit: 2, both: true, p: [[0, .1, .4, .29], [1, .1, .4, .29]], tw: [0, 0] }
  };
  function pathAt(S_, k, out) { const p = S_.p; let i = 0; while (i < p.length - 2 && k > p[i + 1][0]) i++; const a = p[i], b = p[i + 1], t = sst(k, a[0], b[0]); return out.set(lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)); }

  /* first person (ctl.view === 'fp', js/onfoot.js; V toggles): the lens sits on the hero's own head bone (the head itself is skipped by that camera in js/hero.js) and his REAL arms are
     IK-ed to targets given in eye space, so the hands and the weapon sit in the lower frame, come up to the eye to aim, kick, dip to reload and swing through the view. */
  const fpView = () => { const c = S.ctx && S.ctx.ctl; return c ? c.view === 'fp' : opts.view === 'fp'; };
  const FPC = { ox: 0, oy: 1.62, oz: 0, init: false, on: false, swx: 0, swy: 0, r: V3(), u: V3(), a: V3(), b: V3() };
  /** eye-space point -> world: E + r*x + u*y + f*z (+ a little sway that lags the mouse and a bob with the stride) */
  function fpPt(out, x, y, z, k) { k = k === undefined ? 1 : k; const sp = sat(P.speed / 5), bx = sin(S.time * (5 + sp * 5)) * .006 * sp * k, by = abs(cos(S.time * (5 + sp * 5))) * .008 * sp * k;
    return out.copy(CAM.pos).addScaledVector(FPC.r, x + FPC.swx * k + bx).addScaledVector(FPC.u, y + FPC.swy * k - by).addScaledVector(CAM.dir, z); }
  /** first person: close a hand round what it holds (the hero's finger / thumb bones hang off the hand bone; the pose layer leaves them half open) and line the fist up with the forearm */
  function fpGrip(R, s, curl, th, keep) { const hand = R['hand' + s]; if (!hand) return; const sg = s === 'L' ? 1 : -1; if (!keep) hand.quaternion.set(0, 0, 0, 1);
    for (const c of hand.children) { if (!c.isBone) continue; const n = c.name.charAt(0), c2 = c.children[0];
      if (n === 'f') { c.rotation.z = -sg * curl * 1.15; if (c2 && c2.isBone) { c2.rotation.z = -sg * curl * 1.3; const c3 = c2.children[0]; if (c3 && c3.isBone) c3.rotation.z = -sg * curl * .85; } }
      else if (n === 't') { c.rotation.set(th * .35, 0, -sg * (.12 + th * .6)); if (c2 && c2.isBone) c2.rotation.z = -sg * th * .7; } } hand.updateMatrixWorld(true); }
  /* ---- first-person arm rig. Everything is given in eye space (fpPt: x right, y up, z forward, metres) and solved on the hero's REAL arms:
     the weapon is placed first (weapon space: grip web at the origin, barrel +Z, +Y up, +X the shooter's left), then each wrist is put where a hand would hold it and the hand bone is
     turned to the weapon's own axes (palm on the grip, fingers wrapped round it, thumb side up), elbows poled down and OUT so the forearms come in from the bottom corners. */
  const FPT = { az: .46, ra: .6, rw: [.093, .012, -.007], la: .45, lw: [.075, .045, .038], lcant: .5, lroll: .3, lcurl: 1.05, lth: .12, lout: .55, guard: [.165, -.17, .3, -.15, -.155, .32],
    box: { wrist: .085, curl: 1.45, th: 1.0, ready: [0, .13, -.1, .31, .3, .12, .35, 1, 0, 1, .9], chin: [0, .088, -.062, .3, 1.5, .2, .7, 0, .8, 1, .45],   /* H5: bare-hand keys, see fpArms */
      jab: [[0], [.16, .145, -.135, .26, .45, .1, .6, .8, 0, 1, .9], [.36, .045, -.085, .46, .04, .12, .15, 1, 0, 1, .55], [.52, .05, -.09, .44, .08, .12, .2, 1, 0, 1, .55], [1]],
      cross: [[0], [.18, .145, -.135, .26, .45, .1, .6, .8, 0, 1, .9], [.4, .04, -.08, .47, .04, .12, .15, 1, 0, 1, .55], [.56, .045, -.085, .45, .08, .12, .2, 1, 0, 1, .55], [1]],
      hook: [[0], [.3, .2, -.13, .27, .2, -.4, .3, 1, 0, .6, .6], [.56, .01, -.085, .37, .1, .7, 0, 1, .2, .5, .7], [.72, .03, -.09, .36, .1, .6, 0, 1, .2, .5, .7], [1]],
      heavy: [[0], [.28, .17, -.12, .24, .6, -.05, .8, .6, 0, 1, .9], [.5, .19, -.125, .22, .65, -.1, .8, .6, 0, 1, .9], [.7, .03, -.065, .47, .02, .1, .1, 1, 0, 1, .5], [.84, .04, -.08, .45, .06, .1, .15, 1, 0, 1, .5], [1]] } };   /* first-person hand-gun hold, metres in weapon axes: rw = firing wrist behind / below / right of the grip web, lw = support wrist behind / below / left of it */
  const FA = { L: V3(), U: V3(), d: V3(), g: V3(), w: V3(), a: V3(), b: V3(), c: V3(), X: V3(), Y: V3(), Z: V3(), q: new T.Quaternion(), q2: new T.Quaternion(), wq: new T.Quaternion(), m: new T.Matrix4(), kb: 0 };
  /** weapon axes from a barrel direction: L (left), U (up), rolled about the barrel; FA.wq = the weapon's world quaternion */
  function fpFrame(dir, up, roll) { FA.L.crossVectors(up, dir).normalize(); FA.U.crossVectors(dir, FA.L).normalize(); if (roll) { const c = cos(roll), sn = sin(roll); FA.a.copy(FA.L); FA.L.multiplyScalar(c).addScaledVector(FA.U, sn); FA.U.multiplyScalar(c).addScaledVector(FA.a, -sn); } FA.m.makeBasis(FA.L, FA.U, dir); FA.wq.setFromRotationMatrix(FA.m); }
  /** wrist to a world point, hand bone to the basis (X = palm normal of a RIGHT hand / back of a LEFT hand, −Y = towards the knuckles, Z = thumb side), fingers closed */
  function fpHand(R, s, wrist, X, Y, Z, curl, th, out) { const hand = R['hand' + s]; if (!hand) return; ikArm(R['arm' + s], R['fore' + s], hand, wrist, pz.pole.set(0, -1, 0).addScaledVector(FPC.r, (s === 'R' ? 1 : -1) * (out === undefined ? 1.15 : out)));
    FA.m.makeBasis(X, Y, Z); FA.q.setFromRotationMatrix(FA.m); hand.parent.getWorldQuaternion(FA.q2); hand.quaternion.copy(FA.q2.invert().multiply(FA.q)); fpGrip(R, s, curl, th, true); }
  /** a closed fist with the knuckles along `fwd`, thumb side up and canted in */
  function fpFist(R, s, wrist, fwd, cant) { const sg = s === 'R' ? -1 : 1; FA.Y.copy(fwd).negate(); FA.Z.copy(FPC.u).addScaledVector(FPC.r, sg * (cant === undefined ? .55 : cant)); FA.X.crossVectors(FA.Y, FA.Z).normalize(); FA.Z.crossVectors(FA.X, FA.Y).normalize(); fpHand(R, s, wrist, FA.X, FA.Y, FA.Z, 1.36, 1.0); }   /* a closed fist: knuckles forward, the fingers folded right in (they used to stick out of the glove like pegs) */
  function fpArms(a, R, sd, sw, armed, chest, bf, br) {
    const f = CAM.dir, r = FPC.r, u = FPC.u, t = S.real, dk = sat((a.drawT || 0) / .28), grip = pz.grip, dir = pz.dir, gun = armed && a.w.def.kind === 'gun';
    const br0 = sin(t * 1.55) * .0035, br1 = sin(t * .93 + 1) * .0025;                                       // breathing: the whole rig drifts a few millimetres when nothing else moves it
    if (R.propR) R.propR.visible = false; if (R.propL) R.propL.visible = false;
    if (gun) {
      const d = a.w.def, twoH = a.w.twoHanded, k = sst(a.aimK || 0, 0, 1), rk = a.recoilK || 0, rl = a.reloadK > 0 && a.reloadK < 1 ? sin(a.reloadK * PI) : 0, rc = min(2.4, (d.recoil || .03) / .03);
      if (twoH) { fpPt(FA.a, .105, -.16, .15); if (a.w.optic === 'dot') fpPt(FA.b, 0, -a.w.opticY, .25, .3); else fpPt(FA.b, .014, -.128, .25, .3); }   /* QA: the carbine's red dot is looked through: its tube on the eye line */
        /* aimed long guns sit a hand's width under the sight line, so the target stays visible over the receiver */ else { fpPt(FA.a, .115, -.14, .37); fpPt(FA.b, 0, -(a.w.sightY || .06), FPT.az, .3); }   /* aimed hand guns: the top of the rear posts and the front blade sit ON the eye line (weapon sightY), so the notch-and-blade picture is the reticle */
      grip.lerpVectors(FA.a, FA.b, k).addScaledVector(u, br0 * (1 - k * .7)).addScaledVector(r, br1 * (1 - k * .7));
      dir.copy(f).addScaledVector(r, -.11 * (1 - k) - FPC.swx * 1.6).addScaledVector(u, .03 * (1 - k) - FPC.swy * 1.6); let roll = -.1 * (1 - k);            // low-ready: angled in and canted; the muzzle trails a fast turn
      if (dk > 0) { grip.addScaledVector(u, -.3 * dk); dir.addScaledVector(u, -.7 * dk); }                                                                      // drawn up from below the frame
      if (rk > 0) { grip.addScaledVector(f, -.045 * rk * rc).addScaledVector(u, .012 * rk * rc); dir.addScaledVector(u, .17 * rk * rc); roll += .05 * rk; }     // the kick: back, up, muzzle climbs; recoilK decays in ~0.12 s
      if (rl > 0) { grip.addScaledVector(u, -.085 * rl).addScaledVector(r, .03 * rl); dir.addScaledVector(u, .5 * rl).addScaledVector(r, -.3 * rl); roll += .6 * rl; }   // reload: tipped up and rolled out, magazine well towards the support hand
      dir.normalize(); fpFrame(dir, u, roll); const wq = pz.q.copy(FA.wq);
      if (twoH) { FA.w.copy(grip).addScaledVector(dir, -.047).addScaledVector(FA.U, -.032).addScaledVector(FA.L, -.017); FA.Y.copy(dir).negate(); fpHand(R, 'R', FA.w, FA.L, FA.Y, FA.U, 1.02, .8, lerp(1.15, .8, k)); }
      else { /* hand guns: the firing hand is turned in about the grip (FPT.ra) so the web and the ball of the thumb sit BEHIND the backstrap and the knuckles end up at the front right — from the eye the back of the grip is hand, not a bare column under the slide */
        const ca = cos(FPT.ra), sa = sin(FPT.ra); FA.w.copy(grip).addScaledVector(dir, -FPT.rw[0]).addScaledVector(FA.U, -FPT.rw[1]).addScaledVector(FA.L, -FPT.rw[2]); FA.X.copy(FA.L).multiplyScalar(ca).addScaledVector(dir, sa); FA.Y.copy(dir).multiplyScalar(-ca).addScaledVector(FA.L, sa); fpHand(R, 'R', FA.w, FA.X, FA.Y, FA.U, 1.02, .8, lerp(1.15, .8, k)); }
      if (twoH) { const sp = a.w.support.position; FA.c.copy(grip).addScaledVector(FA.L, sp.x).addScaledVector(FA.U, sp.y).addScaledVector(dir, min(sp.z, lerp(.29, .23, k)) - (a.w.pumpK || 0) * .085);       // as far up the fore-end as the arm really reaches
        FA.w.copy(FA.c).addScaledVector(FA.U, -.034).addScaledVector(FA.L, .052).addScaledVector(dir, -.012); if (rl > 0) { fpPt(FA.b, -.04, -.3, .22); FA.w.lerp(FA.b, rl * .85); }
        FA.X.copy(FA.U).negate(); fpHand(R, 'L', FA.w, FA.X, FA.L, dir, .78, .45, 1.0); }                                                                 // support hand under the fore-end: palm up, thumb towards the muzzle
      else { /* two-handed hold (reference: thumbs-forward grip): the support wrist sits low and left of the firing hand, the hand is canted forward-down so its four fingers wrap ACROSS the front of the firing hand's fingers under the guard, the back of the hand faces left and a little down, the thumb lies along the frame pointing at the target */
        const T_ = FPT; FA.w.copy(grip).addScaledVector(dir, -T_.lw[0]).addScaledVector(FA.U, -T_.lw[1]).addScaledVector(FA.L, T_.lw[2]); if (rl > 0) { fpPt(FA.b, -.1, -.32, .24); FA.w.lerp(FA.b, rl); }
        const cb = cos(T_.la), sb = sin(T_.la); FA.Y.copy(dir).multiplyScalar(-cb).addScaledVector(FA.L, sb).addScaledVector(FA.U, T_.lcant).normalize(); FA.X.copy(FA.L).multiplyScalar(cb).addScaledVector(dir, sb).addScaledVector(FA.U, -T_.lroll).normalize(); FA.Z.crossVectors(FA.X, FA.Y).normalize(); FA.X.crossVectors(FA.Y, FA.Z).normalize(); fpHand(R, 'L', FA.w, FA.X, FA.Y, FA.Z, T_.lcurl, T_.lth, lerp(1.0, T_.lout, k)); }
      setWorld(a.w.group, grip, wq); return; }                    // the weapon hangs off the hand bone: placed last, once the arm is where it will stay
    // ---- melee: where the swing wants the hands (authored arcs about the chest, lifted into the frame and pitched with the view), blended out of / back into the carry
    const blk = a.blockK > .02 && !sd, S_ = sd || (blk ? SWING.block : null), k = sd ? sat(sw.k) : 1, kb = sd ? sst(k, 0, .16) * (1 - sst(k, .86, 1)) : blk ? a.blockK : 0, left = !!(S_ && S_.left), both = !!(S_ && S_.both);
    let lh = null; if (S_) { lh = pathAt(S_, k, pz.t); FA.c.copy(chest).addScaledVector(br, lh.x * (armed ? .8 : 1)).addScaledVector(UP, lh.y - .02 + (armed ? .2 : .2) + clamp(f.y, -.7, .7) * max(0, lh.z) * .85).addScaledVector(bf, lh.z + (armed ? .14 : 0)); }   /* QA: a club / knife swing is lifted and pushed out in front of the eye, so the strike crosses the frame instead of passing under it */
    if (armed) {
      const hel = a.w.id === 'helmet', bob = br0 * 1.4;
      if (hel) fpPt(FA.a, .26, -.285 - .3 * dk + bob, .4); else fpPt(FA.a, .2, -.185 - .3 * dk + bob, .38); if (S_ && !left) FA.a.lerp(FA.c, kb);
      if (a.w.def.kind === 'throw' && S.time - (P.thrT || -9) < .62) { const u = (S.time - P.thrT) / .62; fpPt(FA.b, .21, -.02, .24); fpPt(FA.w, .02, -.1, .52); if (u < .28) FA.a.lerp(FA.b, sst(u, 0, .28)); else if (u < .55) FA.a.copy(FA.b).lerp(FA.w, sst(u, .28, .5)); else { FA.w.lerp(FA.a, sst(u, .55, 1)); FA.a.copy(FA.w); } }   /* QA: the throw seen from the eye: hand back up by the ear, then out in front */
      // tool axis: carried upright and canted in (the helmet with its crown towards the eye, so the shell and the ears show, never the lining); in a swing the head leads the hand
      if (hel) dir.copy(u).multiplyScalar(.72).addScaledVector(f, -.5).addScaledVector(r, .22); else dir.copy(u).multiplyScalar(.9).addScaledVector(f, .36).addScaledVector(r, -.13 - FPC.swx * 3);
      if (S_ && kb > 0) { if (hel) { const p = S_.p, side = Math.sign(p[0][1] - p[p.length - 1][1]) || 1; FA.b.copy(r).multiplyScalar(-.85 * side).addScaledVector(f, .08).addScaledVector(u, .4 - .5 * sst(k, .3, .8) * (S_.lean ? 1 : 0)); }
        else if (blk) FA.b.copy(r).multiplyScalar(-.85).addScaledVector(u, .5).addScaledVector(f, .2);
        else { FA.b.copy(chest).addScaledVector(br, .12).addScaledVector(UP, -.32).addScaledVector(bf, -.1); FA.b.subVectors(FA.a, FA.b).normalize().addScaledVector(UP, .35 * (1 - sst(k, .1, S_.hit))); }
        dir.normalize().lerp(FA.b.normalize(), kb); }
      dir.normalize();
      ikArm(R.armR, R.foreR, R.handR, FA.a, pz.pole.set(0, -1, 0).addScaledVector(r, 1.0)); wpos(R.handR, pz.hand); wpos(R.foreR, pz.fore); FA.g.subVectors(pz.hand, pz.fore).normalize();
      if (hel) { FA.Y.copy(FA.g).negate(); FA.Z.copy(u).addScaledVector(FA.g, -u.dot(FA.g)).normalize(); FA.X.crossVectors(FA.Y, FA.Z).normalize(); fpHand(R, 'R', FA.a, FA.X, FA.Y, FA.Z, 1.15, .9, 1.0); grip.copy(FA.a).addScaledVector(FA.g, .07); fpFrame(dir, u, 0); }
      else { FA.g.addScaledVector(dir, -FA.g.dot(dir)); if (FA.g.lengthSq() < 1e-4) FA.g.copy(f).addScaledVector(dir, -f.dot(dir)); FA.g.normalize(); FA.Y.copy(FA.g).negate(); FA.X.crossVectors(FA.Y, dir).normalize();
        fpHand(R, 'R', FA.a, FA.X, FA.Y, dir, 1.12, .9, 1.0); grip.copy(FA.a).addScaledVector(FA.g, .078).addScaledVector(FA.X, .02); fpFrame(dir, FA.Y, 0); }                  // hammer grip: the shaft lies across the palm, thumb end towards the head
      setWorld(a.w.group, grip, FA.wq);
      if (both && S_) { FA.b.copy(chest).addScaledVector(br, -lh.x).addScaledVector(UP, lh.y + .08).addScaledVector(bf, lh.z + .1); fpPt(FA.a, -.13, -.3, .3); FA.a.lerp(FA.b, kb); fpFist(R, 'L', FA.a, f); }
      return; }
    // ---- bare hands: a guard when someone hostile is close (or blocking), punches thrown from it
    const act = a.fpGuard || blk || !!sd; a._fk = damp(a._fk || 0, act ? 1 : 0, act ? 16 : 4.5, a._fdt || .016); if (a._fk < .01) return;   /* H5: the fists come up into the frame and sink back out of it (they used to blink in and out with the guard) */
    if (sd && both) {   /* two-handed shove / takedown: the authored chest arcs */
      { const Gd = FPT.guard; fpPt(FA.a, Gd[0], Gd[1] + br0, Gd[2]); fpPt(FA.b, Gd[3], Gd[4] + br0, Gd[5]); }
      FA.a.lerp(FA.c, kb); FA.w.copy(chest).addScaledVector(br, -lh.x).addScaledVector(UP, lh.y - .02 + .2 + clamp(f.y, -.7, .7) * max(0, lh.z) * .85).addScaledVector(bf, lh.z); FA.b.lerp(FA.w, kb);
      fpFist(R, 'R', FA.a, f, .55 - .5 * kb); fpFist(R, 'L', FA.b, f, .55 - .5 * kb); return; }
    /* H5: a boxer's view, every key in eye space (GT.combat._fpt.box, tunable live): fist = the knuckle row (x right, y up, z forward, m; x is mirrored for the left hand), knuckles point along
       forward + up*fu + in*fi (in = towards the other hand), the palm faces in*pi + down*pd + back*pb (back = towards the eye), the elbow is poled down*ed + out*eo. The guard holds the fists in the
       lower corners, a block (RMB) covers the chin with the forearms upright and the palms to the face, and a straight is cocked, driven to just under the centre turning over on the way (four
       knuckles to the target, the back of the hand to the eye) and pulled back to the guard. */
    const Bx = FPT.box, bk = blk ? a.blockK : 0, spun = sd && Bx[sw.kind] ? sw.kind : null, hand = spun ? (left ? 'L' : 'R') : '', lo = 1 - a._fk;
    for (let i = 0; i < 2; i++) { const s = i ? 'L' : 'R', sg = i ? -1 : 1, Q = FA.k || (FA.k = new Array(11).fill(0));
      if (hand === s) boxKey(Bx[spun], k, Q); else boxLerp(Bx.ready, Bx.chin, max(bk, hand ? .3 * kb : 0), Q);
      FA.w.copy(u).multiplyScalar(Q[4]).add(f).addScaledVector(r, -sg * Q[5]).normalize();                                               // knuckle direction
      FA.Z.copy(r).multiplyScalar(-sg * Q[6]).addScaledVector(u, -Q[7]).addScaledVector(f, -Q[8]);                                         // palm direction (unorthogonalised)
      FA.Z.addScaledVector(FA.w, -FA.Z.dot(FA.w)).normalize(); FA.Y.copy(FA.w).negate(); FA.X.copy(FA.Z).multiplyScalar(i ? -1 : 1); FA.Z.crossVectors(FA.X, FA.Y).normalize();   /* X: palm normal (right hand) / back of the hand (left); Z = X × Y, the thumb side */
      fpPt(FA.a, sg * Q[1] + sg * .06 * lo, Q[2] + br0 * (hand === s ? .3 : 1) - .32 * lo * lo - .1 * lo, Q[3] - .04 * lo); FA.a.addScaledVector(FA.w, -Bx.wrist);                        // the wrist sits a hand's length behind the knuckles
      pz.pole.set(0, -Q[9], 0).addScaledVector(r, sg * Q[10]); ikArm(R['arm' + s], R['fore' + s], R['hand' + s], FA.a, pz.pole);
      FA.m.makeBasis(FA.X, FA.Y, FA.Z); FA.q.setFromRotationMatrix(FA.m); const hb = R['hand' + s]; hb.parent.getWorldQuaternion(FA.q2); hb.quaternion.copy(FA.q2.invert().multiply(FA.q)); fpGrip(R, s, Bx.curl, Bx.th, true); }
  }
  /** a key of a fist track at k: [k, x, y, z, fu, fi, pi, pd, pb, ed, eo] (see fpArms; a bare [k] is the guard), smoothstepped between keys */
  function boxKey(tr, k, out) { let i = 0; while (i < tr.length - 2 && k > tr[i + 1][0]) i++; const a = tr[i].length > 1 ? tr[i] : FPT.box.ready, b = tr[i + 1].length > 1 ? tr[i + 1] : FPT.box.ready, t = sst(k, tr[i][0], tr[i + 1][0]); for (let j = 1; j < 11; j++) out[j] = lerp(a[j] === undefined ? 1 : a[j], b[j] === undefined ? 1 : b[j], t); return out; }
  function boxLerp(a, b, t, out) { for (let j = 1; j < 11; j++) out[j] = lerp(a[j] === undefined ? 1 : a[j], b[j] === undefined ? 1 : b[j], t); return out; }
  const pz = { chest: V3(), head: V3(), hand: V3(), fore: V3(), arm: V3(), hips: V3(), f: V3(), r: V3(), u: V3(), bf: V3(), br: V3(), grip: V3(), dir: V3(), t: V3(), t2: V3(), q: new T.Quaternion(), q2: new T.Quaternion(), pole: V3(), low: V3(), sup: V3() };
  /** drive a figure from actor fields: base state, additive layers, weapon in hand (world-space placement), arm IK for aim / low-ready / swings */
  function poseActor(a, dt) {
    const fig = a.fig; if (!fig || S.headless) return; const g = fig.group, R = a.rig; g.rotation.order = 'YXZ'; const nf = !!(a.fall && a.fall.nat);   /* the people rig has its own lying pose (hips laid back and dropped to the floor): tipping the whole group over as well turned the torso under the floor and left two shins in the air */ g.position.set(a.x + (a.offX || 0), a.y + (nf ? 0 : a.yOff || 0), a.z + (a.offZ || 0)); g.rotation.set(nf ? 0 : a.tiltX || 0, a.h, nf ? 0 : a.tiltZ || 0); if (a.frozen || !R) return;
    const fp0 = !!a.isPlayer && FPC.on && !a.dead && (a.mode === 'free' || a.mode === 'cover'), sp0 = fp0 ? hyp(a.vx || 0, a.vz || 0) : 0, mh = sp0 > .4 ? Math.atan2(a.vx, a.vz) : a.h, back = sp0 > .4 && abs(angDiff(a.h, mh)) > 1.85;
    if (a.isPlayer) { a.legYaw = damp(a.legYaw || 0, sp0 > .4 ? clamp(angDiff(a.h, mh + (back ? PI : 0)), -1.25, 1.25) : 0, 9, dt); if (abs(a.legYaw) > 1e-3) g.rotation.y = a.h + a.legYaw; a.legBack = back; }   // first person: hips follow the direction of travel, the chest is turned back square to the view below
    const fp = !!a.isPlayer && FPC.on && !a.dead; if (a.isPlayer) { if (fp && a.mode === 'roll') { g.visible = false; a._fpHid = true; } else if (a._fpHid) { g.visible = true; a._fpHid = false; } }
    const st = mapState(a, a.anim || 'idle'); a.stT = a.lastSt === st ? (a.stT || 0) + dt : 0; a.lastSt = st;
    const aimK = a.aimK || 0, twoH = a.w && a.w.twoHanded, gun = a.w && a.w.def.kind === 'gun';
    if (aimK > .05 && a.aimDir) { a._look = a._look || V3(); a._look.set(a.x, a.y + 1.5, a.z).addScaledVector(a.aimDir, 8); }
    fig.update(dt, { jump: a.jumpPose || null, state: st, speed: a.animSpeed || 0, turn: 0, lookYaw: 0, lookPitch: 0, t: a.stT, blend: nf && st !== 'fall' ? .55 : undefined, aimPitch: a.aimPitch || 0, lookAt: aimK > .05 && a.aimDir ? a._look : (a.lookPt || undefined), back: !!a.legBack });
    if (a.isPlayer && abs(a.legYaw || 0) > 1e-3) { _q.setFromAxisAngle(UP, -a.legYaw * .5); R.spine.quaternion.premultiply(_q); R.chest.quaternion.premultiply(_q); }
    if (R.propR && a.w) { R.propR.visible = false; } if (R.propL && a.w) R.propL.visible = false;
    const sw = a.swing, sd = sw ? SWING[sw.kind] : null; let tw = a.twist || 0, lean = a.lean || 0;
    if (sd) { const k = sw.k, h = sd.hit > 1 ? .5 : sd.hit; tw += k < h ? lerp(0, sd.tw[0], sst(k, 0, h * .7)) + (sd.tw[1] - sd.tw[0]) * sst(k, h * .7, h + .08) : lerp(sd.tw[1], 0, sst(k, h + .1, 1)); lean += (sd.lean || 0) * sin(sat(k) * PI); }
    if (a.stagK > 0) { lean -= .42 * a.stagK; if (R.head) R.head.rotation.x -= .3 * a.stagK; }
    if (a.blindK > 0) lean += .1 * a.blindK;
    if (lean) { R.spine.rotation.x += lean * .5; R.chest.rotation.x += lean * .5; } if (tw) { R.spine.rotation.y += tw * .45; R.chest.rotation.y += tw * .55; }
    if (a.kneeK && R.thighR && R.shinR && !R.hero && !nf) { R.thighR.rotation.x -= .7 * a.kneeK; R.shinR.rotation.x += 1.2 * a.kneeK; R.thighL.rotation.x -= .15 * a.kneeK; R.shinL.rotation.x += .3 * a.kneeK; }
    if (a.fall && !nf && !R.hero && a.fall.dir > 0 && a.tiltX > .2) {   /* face down: not a plank. head turned on one cheek, one arm thrown up past the head, the other folded under the shoulder */
      const k = sat(a.tiltX / (HP - .07)), sgn = a.fall.roll < 0 ? -1 : 1, fx = sin(a.h), fz = cos(a.h), rx = -cos(a.h), rz = sin(a.h); if (R.head) R.head.rotation.y += .95 * k * sgn; if (R.neck) R.neck.rotation.x -= .18 * k; g.updateMatrixWorld(true);
      wpos(R.handL, pz.hand); pz.t.set(a.x + fx * (sgn > 0 ? 1.72 : 1.18) - rx * .34, a.y + .07, a.z + fz * (sgn > 0 ? 1.72 : 1.18) - rz * .34).lerpVectors(pz.hand, pz.t, k); ikArm(R.armL, R.foreL, R.handL, pz.t, pz.pole.set(-rx, .2, -rz));
      wpos(R.handR, pz.hand); pz.t.set(a.x + fx * (sgn > 0 ? 1.18 : 1.72) + rx * .36, a.y + .07, a.z + fz * (sgn > 0 ? 1.18 : 1.72) + rz * .36).lerpVectors(pz.hand, pz.t, k); ikArm(R.armR, R.foreR, R.handR, pz.t, pz.pole.set(rx, .2, rz)); }
    if (!a.w && !sd && !(a.blockK > 0) && !(fp && (a.fpGuard || a._fk > .01))) return;
    g.updateMatrixWorld(true);
    const bf = pz.bf.set(sin(a.h), 0, cos(a.h)), br = pz.br.set(-cos(a.h), 0, sin(a.h)), chest = wpos(R.chest, pz.chest);
    const armed = a.w && a.w.group.parent && a.w.id !== 'fists'; let placed = false; const grip = pz.grip, dir = pz.dir;
    if (fp) { a._fdt = dt; return fpArms(a, R, sd, sw, armed, chest, bf, br); }
    // ---- melee swing / block: hands follow authored arcs
    const blk = a.blockK > .02 && !sd;
    if (sd || blk) { const S_ = sd || (a.ironGuard && !armed ? SWING.guard : SWING.block), k = sd ? sat(sw.k) : 1, w = sd ? 1 : a.blockK, lh = pathAt(S_, k, pz.t), left = S_.left;
      const tgt = pz.t2.copy(chest).addScaledVector(br, (left ? 1 : 1) * lh.x).addScaledVector(UP, lh.y - .02).addScaledVector(bf, lh.z); if (a.tiltX) tgt.y -= sin(a.tiltX) * .1;
      if (left) { wpos(R.handL, pz.hand); tgt.lerpVectors(pz.hand, tgt, w); ikArm(R.armL, R.foreL, R.handL, tgt, pz.pole.set(0, -1, 0).addScaledVector(br, -.5)); }
      else { wpos(R.handR, pz.hand); tgt.lerpVectors(pz.hand, tgt, w); ikArm(R.armR, R.foreR, R.handR, tgt, pz.pole.set(0, -1, 0).addScaledVector(br, .6));
        if (S_.both) { const t2 = pz.low.copy(chest).addScaledVector(br, -lh.x).addScaledVector(UP, lh.y - .02).addScaledVector(bf, lh.z + (armed ? .1 : 0)); wpos(R.handL, pz.hand); t2.lerpVectors(pz.hand, t2, w); ikArm(R.armL, R.foreL, R.handL, t2, pz.pole.set(0, -1, 0).addScaledVector(br, -.6)); }
        if (armed) { wpos(R.handR, pz.hand); const piv = pz.low.copy(chest).addScaledVector(br, .12).addScaledVector(UP, -.32).addScaledVector(bf, -.1); dir.copy(pz.hand).sub(piv).normalize();
          if (blk || S_ === SWING.block) dir.copy(br).multiplyScalar(-.85).addScaledVector(UP, .45).addScaledVector(bf, .2).normalize(); else if (a.w.def.kind === 'gun') dir.lerp(bf, .5).normalize(); else dir.addScaledVector(UP, .35 * (1 - sst(k, .1, S_.hit))).normalize();
          grip.copy(pz.hand).addScaledVector(dir, .05); quatDir(pz.q, dir, UP); setWorld(a.w.group, grip, pz.q); placed = true; } } }
    if (!armed || placed) return;
    // ---- firearms + carried melee tools
    wpos(R.handR, pz.hand); wpos(R.foreR, pz.fore); const fa = pz.t.copy(pz.hand).sub(pz.fore).normalize();
    if (gun && (aimK > .01 || twoH || a.blindK > .01)) {
      const f = pz.f.copy(a.aimDir || bf).normalize(), r = pz.r.crossVectors(f, UP).normalize(), u = pz.u.crossVectors(r, f), head = wpos(R.head, pz.head), rk = a.recoilK || 0;
      // aimed pose
      if (twoH) { wpos(R.armR, pz.arm); grip.copy(pz.arm).addScaledVector(f, clamp(-((a.w.len && a.w.len[0]) || -.22) - .02, .2, .4)).addScaledVector(u, -.1).addScaledVector(r, -.07);   /* QA: the butt sits in the shoulder (2 cm behind the joint), not out through his back: the grip goes as far forward as the stock is long */
        grip.y = lerp(grip.y, head.y - .16, .55); } else grip.copy(head).addScaledVector(f, .5).addScaledVector(u, -.03).addScaledVector(r, .05);
      dir.copy(f);
      // low-ready / relaxed pose to blend from
      const low = pz.low; if (twoH) { wpos(R.hips, pz.hips); const run = sat((a.animSpeed || 0) / 5), bob = sin(S.time * 9) * .02 * run; low.copy(pz.hips).addScaledVector(br, .15).addScaledVector(bf, .2 + .05 * run).addScaledVector(UP, .2 + bob); pz.t2.copy(bf).multiplyScalar(.8).addScaledVector(UP, -.42 + .15 * run).addScaledVector(br, -.42).normalize(); }
      else { low.copy(pz.hand).addScaledVector(fa, .07); pz.t2.copy(fa).multiplyScalar(.75).addScaledVector(bf, .45).normalize(); }
      let k = sst(aimK, 0, 1); if (a.blindK > .01) { const bk = a.blindK; // blind fire: weapon pushed up / out of cover, body stays down
        low.copy(chest).addScaledVector(bf, .34).addScaledVector(UP, a.blindSide ? .12 : .48).addScaledVector(br, a.blindSide ? a.blindSide * .5 : .12); pz.t2.copy(f); pz.t2.y -= .08; pz.t2.normalize(); grip.lerp(low, 1); dir.copy(pz.t2); k = max(k, bk); if (aimK < .5) { grip.copy(low); } }
      grip.lerpVectors(low, grip, k); dir.lerpVectors(pz.t2, dir, k).normalize();
      if (rk) { grip.addScaledVector(dir, -.035 * rk); dir.addScaledVector(u, .09 * rk * (a.w.def.recoil / .03)).normalize(); }
      if (a.reloadK > 0 && a.reloadK < 1) { const d = sin(a.reloadK * PI); grip.addScaledVector(UP, -.07 * d).addScaledVector(dir, -.04 * d); dir.addScaledVector(UP, .22 * d).addScaledVector(r, -.2 * d).normalize(); }
      quatDir(pz.q, dir, UP, twoH ? 0 : -.06 * k); const wr = pz.t.copy(grip).addScaledVector(dir, -.055); wr.y -= .012;
      ikArm(R.armR, R.foreR, R.handR, wr, pz.pole.set(0, -1, 0).addScaledVector(br, .55));
      // support hand: on the fore-end (long guns) / wrapped under the grip (pistols when aimed)
      if (twoH || k > .4) { const sp = a.w.support.position, sup = pz.sup.copy(sp).applyQuaternion(pz.q).add(grip); if (a.reloadK > 0 && a.reloadK < 1) { const d = sin(a.reloadK * PI); wpos(R.hips, pz.hips); sup.lerp(pz.hips.addScaledVector(br, -.16).addScaledVector(bf, .14).addScaledVector(UP, .02), d * .8); }
        if (a.w.pumpK) sup.addScaledVector(dir, -a.w.pumpK * .085); if (!twoH) { wpos(R.handL, pz.hand); sup.lerpVectors(pz.hand, sup, sst(k, .4, 1)); } sup.addScaledVector(dir, -.03); ikArm(R.armL, R.foreL, R.handL, sup, pz.pole.set(0, -1, 0).addScaledVector(br, -.5)); }
      setWorld(a.w.group, grip, pz.q); return; }
    // one-handed carry (pistol at the side, bat / crowbar in the fist)
    if (gun) dir.copy(fa).multiplyScalar(.8).addScaledVector(bf, .42).normalize(); else if (a.w.id === 'helmet') dir.copy(UP).multiplyScalar(-.92).addScaledVector(bf, .3).addScaledVector(br, .08).normalize(); else dir.copy(bf).multiplyScalar(.62).addScaledVector(UP, .5).addScaledVector(fa, .3).addScaledVector(br, .1).normalize();
    if (a === P && a.w.def.kind === 'throw' && S.time - (P.thrT || -9) < .62) { const u = (S.time - P.thrT) / .62; wpos(R.armR, pz.arm); const H1 = pz.t2.copy(pz.arm).addScaledVector(UP, .2).addScaledVector(bf, -.2).addScaledVector(br, .08), H2 = pz.low.copy(pz.arm).addScaledVector(bf, .52).addScaledVector(UP, -.02).addScaledVector(br, -.14);   /* QA: wind-up behind the head, release on the way forward, follow-through across, back to the carry */
      const tgt = pz.sup.copy(pz.hand); if (u < .28) tgt.lerp(H1, sst(u, 0, .28)); else if (u < .55) tgt.copy(H1).lerp(H2, sst(u, .28, .5)); else tgt.copy(H2).lerp(pz.hand, sst(u, .55, 1)); ikArm(R.armR, R.foreR, R.handR, tgt, pz.pole.set(0, -1, 0).addScaledVector(br, .8)); wpos(R.handR, pz.hand); wpos(R.foreR, pz.fore); fa.copy(pz.hand).sub(pz.fore).normalize(); }
    grip.copy(pz.hand).addScaledVector(fa, .07);
    if (!gun && a.dead && !a.isPlayer) { /* a downed man lets go of his bat / pipe: it slides out of the fist and comes to rest flat on the floor beside the hand (it used to stay pointing at the ceiling in a raised fist) */ const k0 = a._dropK = min(1, (a._dropK || 0) + dt * 2.4), k = k0 * k0 * (3 - 2 * k0), ang = a.h + 1.9 + (abs(a.x * 7.3 + a.z * 3.1) % 1) * 1.4; pz.t2.set(sin(ang), 0, cos(ang)); dir.lerp(pz.t2, k).normalize(); pz.low.set(pz.hand.x + sin(ang) * .2, a.y + .035, pz.hand.z + cos(ang) * .2); grip.lerp(pz.low, k); quatDir(pz.q, dir, UP); } else quatDir(pz.q, dir, gun ? UP : br);
    setWorld(a.w.group, grip, pz.q);
  }
  /** attach / swap the weapon model in an actor's hand */
  function armActor(a, id, lod) { if (a.w && a.w.group.parent) a.w.group.parent.remove(a.w.group); a.w = null; a.wid = id; if (!GT.weapons) return; a.inst = a.inst || {}; let w = a.inst[id]; if (!w) { const kt = a.isPlayer && GT.weapons.kit ? GT.weapons.kit[id] : null; w = a.inst[id] = GT.weapons.make(id, { lod: lod ? 1 : 0, att: kt ? kt.att : null, tint: kt ? kt.tint : null }); }   /* SH: the player's own attachments and finish */ a.w = w;
    if (id === 'fists' || S.headless || !a.fig) return; const R = a.rig; if (a.isPlayer && a.fig.attach && R && R.hero) { try { a.fig.attach(w.group, 'handR'); } catch (e) { S.root.add(w.group); } } else if (R && R.handR) R.handR.add(w.group); else S.root.add(w.group); w.group.visible = true; }
  function disarmActor(a) { if (a.w && a.w.group.parent) { if (a.isPlayer && a.fig && a.fig.detach && a.rig && a.rig.hero) { try { a.fig.detach(a.w.group); } catch (e) {} } if (a.w.group.parent) a.w.group.parent.remove(a.w.group); } }
  const muzzleOf = (a, out) => { if (a.w && a.w.group.parent && !S.headless) { a.w.group.updateMatrixWorld(true); return out.setFromMatrixPosition(a.w.muzzle.matrixWorld); } return out.set(a.x, a.y + (a.crouchK > .5 ? .95 : 1.45), a.z).addScaledVector(a.aimDir || _s.set(sin(a.h), 0, cos(a.h)), .6); };

  /* ================================================================== ballistics + damage */
  const HA = { t: 0, zone: '' };
  /** ray vs an actor (parametric capsule that follows crouch / prone). returns HA or null */
  function hitActor(a, ox, oy, oz, dx, dy, dz, maxT) {
    const prone = a.prone, top = a.y + (prone ? .42 : lerp(a.ht, a.ht * .6, a.crouchK || 0)), r = prone ? .55 : .25, cx = a.x - ox, cz = a.z - oz; let best = maxT, zone = '';
    const A = dx * dx + dz * dz, C0 = cx * cx + cz * cz - r * r; if (C0 < 0 && oy >= a.y && oy <= top) { HA.t = .001; HA.zone = !prone && oy > top - .3 ? 'head' : 'torso'; return HA; }   // point blank: the ray starts inside the body
    if (A > 1e-9) { const Bq = cx * dx + cz * dz, C = C0, disc = Bq * Bq - A * C; if (disc >= 0) { const t = (Bq - sqrt(disc)) / A; if (t > 0 && t < best) { const y = oy + dy * t; if (y >= a.y && y <= top - .2) { best = t; zone = prone ? 'torso' : y < a.y + (top - a.y) * .52 ? 'legs' : 'torso'; } } } }
    if (!prone) { const hx = a.x + sin(a.h) * (a.crouchK > .5 ? .12 : .02) - ox, hy = top - .11 - oy, hz = a.z + cos(a.h) * (a.crouchK > .5 ? .12 : .02) - oz, b = hx * dx + hy * dy + hz * dz, c = hx * hx + hy * hy + hz * hz - .135 * .135, disc = b * b - c; if (disc >= 0) { const t = b - sqrt(disc); if (t > 0 && t < best + .15) { best = min(best, t); zone = 'head'; } }
      if (a.aimK > .5 && !a.isPlayer) { const f = .42, ax = a.x + sin(a.h) * f + cos(a.h) * -.1 - ox, ay = top - .32 - oy, az = a.z + cos(a.h) * f - sin(a.h) * -.1 - oz, b2 = ax * dx + ay * dy + az * dz, c2 = ax * ax + ay * ay + az * az - .11 * .11, d2 = b2 * b2 - c2; if (d2 >= 0) { const t = b2 - sqrt(d2); if (t > 0 && t < best) { best = t; zone = 'arm'; } } } }
    if (!zone) return null; HA.t = best; HA.zone = zone; return HA; }
  const tr = { o: V3(), d: V3(), end: V3(), n: V3() };
  /** the hall columns are round shafts inside a square collider. A bullet is tested against the shaft itself (above the square plinth): dust, chips and the hole sit on the marble, a muzzle that is inside the square but outside the shaft
      still fires, and a shot past the shaft is not stopped by air. Returns 1 = the hit was moved onto the shaft, -1 = the ray passes the shaft, 0 = leave it (plinth). */
  const ROUND = /hall-column|portico-column|combat-column/;
  function shaftHit(w, ox, oy, oz, d, maxT) { const b = w.box, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, rr = min(b.x1 - b.x0, b.z1 - b.z0) * .41, fx = ox - cx, fz = oz - cz, a = d.x * d.x + d.z * d.z; if (a < 1e-8) return 0;
    const base = groundY(cx, cz, oy) + .7; if (w.t > 0 && oy + d.y * w.t < base) return 0;
    const bq = fx * d.x + fz * d.z, c = fx * fx + fz * fz - rr * rr, disc = bq * bq - a * c; if (disc < 0) return -1; let t = (-bq - sqrt(disc)) / a; if (t < 0) { if (c < 0) t = 0; else return -1; } if (t > maxT) return -1;
    w.t = t; if (c < 0) { w.nx = -d.x; w.ny = -d.y; w.nz = -d.z; } else { w.nx = (fx + d.x * t) / rr; w.ny = 0; w.nz = (fz + d.z * t) / rr; } return 1; }
  /** breakable glass panes owned by a scenario (sc.panes; each lies in a z–y plane). First round: sparks, shards, and the whole pane crazes milk-white with a web of cracks; a quarter of a second later (or on the next round)
      it lets go: the sheet drops as shards on both sides, the collider goes, jagged teeth stay in the frame. */
  const PANE = { milk: null, web: null, geo: null, teeth: null };
  function paneMake(sc, x, z0, z1, y0, y1) { const b = addProp(x - .03, z0, x + .03, z1, y1 - y0, 'combat-glass-rail', 'glass'); b.y0 = y0; b.seeThru = true; const p = { x, z0, z1, y0, y1, box: b, hits: 0, t: -1, gone: false, mesh: null, teeth: null, web: [] }; b.pane = p;
    if (!S.headless && PROPS.group) { const m = new T.Mesh(new T.BoxGeometry(.012, y1 - y0, z1 - z0), GT.mat('glass_clear')); m.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2); m.renderOrder = 3; PROPS.group.add(m); p.mesh = m;
      const v = []; for (let z = z0; z < z1 - .02; z += .07 + rnd() * .06) { const w = min(z1 - z, .05 + rnd() * .07), h = .03 + rnd() * rnd() * .16; v.push(x, y0, z, x, y0, z + w, x, y0 + h, z + w * rnd()); if (rnd() < .6) { const h2 = .02 + rnd() * rnd() * .12; v.push(x, y1, z, x, y1, z + w, x, y1 - h2, z + w * rnd()); } }
      for (const zz of [z0, z1]) for (let y = y0 + .05; y < y1 - .05; y += .09 + rnd() * .1) { const h = .04 + rnd() * .06, w = (.02 + rnd() * rnd() * .1) * (zz === z0 ? 1 : -1); v.push(x, y, zz, x, y + h, zz, x, y + h * rnd(), zz + w); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(v, 3)); const tm = new T.Mesh(g, PANE.teeth || (PANE.teeth = new T.MeshBasicMaterial({ color: new T.Color(1.25, 1.55, 1.65), transparent: true, opacity: .55, side: T.DoubleSide, depthWrite: false, fog: false }))); tm.visible = false; tm.renderOrder = 3; tm.frustumCulled = false; PROPS.group.add(tm); p.teeth = tm; }
    (sc.panes = sc.panes || []).push(p); return p; }
  function paneHit(p, pos, n) { if (p.gone) return; if (FX.ready) { for (let i = 0; i < 7; i++) FX.sprite({ pos, life: .3 + rnd() * .4, size: .03 + rnd() * .03, r: 1.8, g2: 2.2, b: 2.4, add: true, vel: _a.set(rnd() - .5, rnd() - .3, rnd() - .5).multiplyScalar(2.4).addScaledVector(n, -1.5 - rnd() * 2), g: -9 });
      FX.sprite({ pos, add: true, tex: 'star', life: .1, size: .5, r: 3.2, g2: 3.8, b: 4.2 }); _f.copy(n).multiplyScalar(-1); FX.debris(pos, _f, 6, true); }
    p.hits++; if (p.hits > 1) { paneBurst(p, n); return; } p.t = .26;
    if (p.mesh) { p.mesh.material = PANE.milk || (PANE.milk = new T.MeshBasicMaterial({ color: 0xe6f0f4, transparent: true, opacity: .36, depthWrite: false, side: T.DoubleSide, fog: false })); const wm = PANE.web || (PANE.web = new T.MeshBasicMaterial({ map: FX.tex.crack, transparent: true, depthWrite: false, side: T.DoubleSide, fog: false, color: new T.Color(1.6, 1.8, 1.9) })), gq = PANE.geo || (PANE.geo = new T.PlaneGeometry(1, 1)), H = p.y1 - p.y0, W = p.z1 - p.z0;
      for (let i = 0; i < 5; i++) { const q = new T.Mesh(gq, wm), s = (i ? .4 + rnd() * .35 : .8) * min(1.5, max(H, W)); q.rotation.order = 'YXZ'; q.rotation.set(0, HP, rnd() * TAU); q.scale.set(s, s, 1); q.position.set(p.x + (i % 2 ? .009 : -.009), i ? p.y0 + rnd() * H : clamp(pos.y, p.y0, p.y1), i ? p.z0 + rnd() * W : clamp(pos.z, p.z0, p.z1)); q.renderOrder = 4; p.mesh.parent.add(q); p.web.push(q); } } }
  function paneBurst(p, n) { if (p.gone) return; p.gone = true; p.t = -1; const i = GT.world.boxes.indexOf(p.box); if (i >= 0) GT.world.boxes.splice(i, 1); S.coverKey = ''; if (p.mesh) p.mesh.visible = false; if (p.teeth) p.teeth.visible = true; for (const q of p.web) if (q.parent) q.parent.remove(q); p.web.length = 0; emit('glass', { x: p.x, z: (p.z0 + p.z1) / 2 });
    if (S.headless || !FX.ready) return; const W = p.z1 - p.z0, H = p.y1 - p.y0, sx = n && n.x > 0 ? -1 : 1, A = FX.amb(), k = min(30, 10 + ((W * H * 22) | 0));
    for (let j = 0; j < k; j++) { _b.set(p.x, p.y0 + rnd() * H, p.z0 + rnd() * W); _c.set(sx * (j % 3 ? 1 : -.6), 0, 0); FX.debris(_b, _c, 1, true, 0, 0, 0, 1.7); }
    for (let j = 0; j < 14; j++) { _b.set(p.x, p.y0 + rnd() * H, p.z0 + rnd() * W); FX.sprite({ pos: _b, add: true, life: .5 + rnd() * .5, size: .03 + rnd() * .04, r: 1.8, g2: 2.2, b: 2.5, vel: _a.set(sx * (.5 + rnd() * 2), rnd() * 1.2, (rnd() - .5) * 1.5), g: -9.8 }); }
    _b.set(p.x, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2); FX.sprite({ pos: _b, add: true, tex: 'star', life: .12, size: 1.1, r: 2.6, g2: 3.2, b: 3.6 }); FX.sprite({ pos: _b, tex: 'smoke', life: .9, size: .5, grow: 1.2, a: .3, r: A, g2: A * 1.05, b: A * 1.1, vel: _a.set(sx * .8, .1, 0), drag: 2 });
    SND.impact(_b, 'glass'); SND.lamp(_b); S.shake = min(1, S.shake + .12); if (GT.audio && GT.audio.sfx) { try { GT.audio.sfx('glass', { distance: hyp(P.x - p.x, P.z - (p.z0 + p.z1) / 2) }); } catch (e) {} }   /* the recorded pane */ }
  /** one projectile. returns the end point (tr.end). shooter: actor; def: weapon def */
  function traceBullet(shooter, o, d, def, range) {
    let ox = o.x, oy = o.y, oz = o.z, maxT = range || 220, skip = null, pen = 0, travelled = 0, rounds = 0;
    for (;;) {
      let best = maxT, kind = '', tgt = null, zone = '', nb = null; const w = rayBoxes(ox, oy, oz, d.x, d.y, d.z, maxT, 0, skip); if (w && rounds < 3 && ROUND.test(w.box.tag || '') && shaftHit(w, ox, oy, oz, d, maxT) < 0) { rounds++; skip = w.box; continue; }
      if (w) { best = w.t; kind = 'box'; nb = w.box; tr.n.set(w.nx, w.ny, w.nz); if (!w.nx && !w.ny && !w.nz) tr.n.copy(d).multiplyScalar(-1);   /* fired from inside a collider: the puff comes back at the muzzle, not nowhere */ }
      const gy = shooter.isPlayer ? min(P.y, P.onTarget ? P.onTarget.y : P.y) : min(shooter.y, P.y); if (d.y < -1e-4) { const t = (gy - oy) / d.y; if (t > 0 && t < best) { best = t; kind = 'ground'; tr.n.set(0, 1, 0); } }
      if (shooter.isPlayer) { for (const e of enemies) { if (e.dead && !e.prone) continue; if (e.dead) continue; const h = hitActor(e, ox, oy, oz, d.x, d.y, d.z, best); if (h) { best = h.t; kind = 'actor'; tgt = e; zone = h.zone; } }
        for (const c of civs()) { if (abs(c.x - ox) + abs(c.z - oz) > best + 2) continue; const A = CIV.a; A.x = c.x; A.y = c.y || 0; A.z = c.z; A.h = c.h || 0; A.prone = !!c.lying; const h = hitActor(A, ox, oy, oz, d.x, d.y, d.z, best); if (h) { best = h.t; kind = 'civ'; tgt = c; zone = h.zone; } }
        for (const s of S.targets) { if (s.dead) continue; const hx = s.x - ox, hy = s.y - oy, hz = s.z - oz, b = hx * d.x + hy * d.y + hz * d.z, c = hx * hx + hy * hy + hz * hz - s.r * s.r, disc = b * b - c; if (disc >= 0) { const t = b - sqrt(disc); if (t > 0 && t < best) { best = t; kind = 'target'; tgt = s; } } } }
      else if (!P.dead) { const h = hitActor(P, ox, oy, oz, d.x, d.y, d.z, best); if (h) { best = h.t; kind = 'actor'; tgt = P; zone = h.zone; } }
      tr.end.set(ox + d.x * best, oy + d.y * best, oz + d.z * best); travelled += best;
      if (kind === 'box') { const surf = surfOf(nb, tr.n.x, tr.n.z, tr.end.y - (nb.y0 || 0)); if (nb.pane) paneHit(nb.pane, tr.end, tr.n); else FX.impact(tr.end, tr.n, surf, def.pellets > 1 ? false : def.dmg > 40); SND.impact(tr.end, surf);
        if (surf === 'glass' && pen < 2) { pen++; skip = nb; ox = tr.end.x + d.x * .02; oy = tr.end.y + d.y * .02; oz = tr.end.z + d.z * .02; maxT -= best; if (maxT > 1) continue; } }
      else if (kind === 'ground') { FX.impact(tr.end, tr.n, 'stucco'); SND.impact(tr.end, 'stucco'); }
      else if (kind === 'target') { if (tgt.onHit) tgt.onHit(tgt, tr.end); }
      else if (kind === 'civ') { const fall = travelled <= def.near ? 1 : lerp(1, def.minF, sat((travelled - def.near) / (def.far - def.near))); hook('civHit', tgt, { dmg: zone === 'head' ? 999 : def.dmg * fall * (zone === 'head' ? 2.5 : zone === 'legs' ? .7 : 1), dx: d.x, dz: d.z, gun: !def.tool, heavy: true, zone, weapon: def.id }); tr.n.copy(d).multiplyScalar(-1); FX.impact(tr.end, tr.n, 'flesh'); SND.impact(tr.end, 'flesh'); kind = 'actor'; }
      else if (kind === 'actor') { const fall = travelled <= def.near ? 1 : lerp(1, def.minF, sat((travelled - def.near) / (def.far - def.near)));
        if (tgt === P) damagePlayer(def.dmg * fall * (zone === 'head' ? 1.5 : zone === 'legs' ? .8 : 1) * .45 * opts.difficulty, shooter, 'bullet'); else damageEnemy(tgt, def.dmg * fall, zone, d, def, shooter);
        tr.n.copy(d).multiplyScalar(-1); FX.impact(tr.end, tr.n, 'flesh'); SND.impact(tr.end, 'flesh'); }
      else if (!shooter.isPlayer && !P.dead) { /* a miss that passes the player: whiz */ }
      return kind; } }
  function spreadDir(out, dir, spread) { if (spread <= 0) return out.copy(dir); const a = rnd() * TAU, m = sqrt(rnd()) * spread; _a.crossVectors(dir, UP); if (_a.lengthSq() < 1e-6) _a.set(1, 0, 0); _a.normalize(); _b.crossVectors(_a, dir); return out.copy(dir).addScaledVector(_a, cos(a) * m).addScaledVector(_b, sin(a) * m).normalize(); }
  /** discharge a weapon: pellets, tracers, flash, brass, sound, noise. origin = muzzle, aim = unit direction */
  function discharge(a, origin, aim, def, spread, quiet) {
    const pl = def.pellets || 1; let hitKinds = 0;
    for (let i = 0; i < pl; i++) { spreadDir(tr.d, aim, spread); const k = traceBullet(a, origin, tr.d, def, def.range); if (k === 'actor') hitKinds++; if (!def.spray && (i < 5 || pl === 1)) FX.tracer(origin, tr.end, def, !a.isPlayer);   /* def.range / def.spray / def.snd / def.stag / def.tool: the hardware-store tools registered by js/shops.js (nail gun, extinguisher) */
      if (!a.isPlayer && k !== 'actor') { _a.set(P.x - origin.x, P.y + 1.3 - origin.y, P.z - origin.z); const t = _a.dot(tr.d); if (t > 0 && t < origin.distanceTo(tr.end) + .5 && _a.addScaledVector(tr.d, -t).lengthSq() < 2.2) { SND.whiz(P); P.suppress = min(1, (P.suppress || 0) + .25); } } }
    if (!def.spray) FX.flash(origin, aim, def.pellets > 1 ? 1.5 : def.id === 'rifle' ? 1.25 : def.id === 'smg' ? .85 : def.tool ? .35 : 1, true);
    if (def.shell && a.w && a.w.group.parent && !S.headless) { a.w.ejector.getWorldPosition(_a); _b.crossVectors(aim, UP).normalize(); _c.copy(_b).multiplyScalar(1.6 + rnd() * .8).addScaledVector(UP, 1.6 + rnd() * .8).addScaledVector(aim, -.5 + rnd() * .4); if (def.shell !== 'shot') FX.eject(_a, _c, a.y, false); else a.shellDue = .32; }
    if (a.w) a.w.update(0, { fired: true });
    if (!quiet) { SND.shot(def, origin, nearestWall(a.x, a.y + 1.4, a.z), a.isPlayer); S.noise.push({ x: a.x, z: a.z, r: 70 * def.loud, t: S.time, by: a, kind: 'shot' }); }
    return hitKinds; }

  /* ================================================================== the player */
  const P = { isPlayer: true, x: 0, y: 0, z: 0, h: 0, r: .3, ht: 1.8, hp: 100, maxHp: 100, armor: 0, maxArmor: 100, focus: 1, mode: 'free', cur: 'fists', want: null, last: 'pistol', holstered: true, inv: {}, owned: { fists: true }, melee: null, inst: {}, w: null, fig: null, rig: null,
    aimK: 0, crouchK: 0, aimDir: V3(0, 0, 1), aimPt: V3(), anim: 'idle', animSpeed: 0, speed: 0, vx: 0, vz: 0, cool: 0, bloom: 0, recoilK: 0, recP: 0, recY: 0, reload: null, reloadK: 0, drawT: 0, cover: null, leanK: 0, blindK: 0, blindT: 0, lock: null, swing: null, combo: 0, comboT: 0, charge: 0, blockK: 0,
    modeT: 0, roll: null, iframes: 0, lastHitT: -99, regenT: 0, down: 0, dead: false, stagK: 0, hitDirs: [], suppress: 0, bonus: 1, exposed: 0, shotT: -9, ownFig: false, dryT: 0, tiltX: 0, yOff: 0, sprint: false };
  const CAM = { yaw: 0, pitch: .12, dist: 2.7, side: .42, fov: 55, shoulder: 1, pos: V3(), look: V3(), dir: V3(0, 0, 1), init: false, kick: 0, kickYaw: 0 };
  const enemies = [];
  function give(id, ammo) { const d = WD(id); if (!d || d.id !== id) return false; P.owned[id] = true; if (d.kind === 'gun' || d.kind === 'throw') { const s = P.inv[id] || (P.inv[id] = { mag: d.mag, reserve: 0 }); s.reserve = ammo === undefined ? max(s.reserve, d.reserve) : s.reserve + ammo; } else if (id !== 'fists' && id !== 'helmet') P.melee = id; syncHelmet(); return true; }
  const meleeBest = () => P.melee && P.owned[P.melee] ? P.melee : P.owned.helmet ? 'helmet' : 'fists';
  /** 阿凯 wears the helmet until it is in his hand */
  function syncHelmet() { const f = P.fig; if (!f || !f.setHelmet) return; const inHand = !P.holstered && P.cur === 'helmet'; try { if (inHand && !P.helmetOff) { P.helmetWas = f.helmet !== false; f.setHelmet(false); P.helmetOff = true; } else if (!inHand && P.helmetOff) { f.setHelmet(P.helmetWas !== false); P.helmetOff = false; } } catch (e) {} }
  const ammoOf = id => P.inv[id] || null;
  function equip(id, instant) { if (!P.owned[id]) return false; if (P.cur === id && !P.holstered) return true; if (P.reload) cancelReload(); if (P.cur !== 'fists' && P.cur !== id) P.last = P.cur; P.cur = id; P.holstered = false; P.drawT = instant ? 0 : .28; P.cool = max(P.cool, instant ? 0 : .28); P.swing = null; P.charge = 0;
    disarmActor(P); armActor(P, id, false); if (WD(id).kind === 'melee' && id !== 'fists' && id !== 'helmet') P.melee = id; syncHelmet(); SND.mech('draw', P); emit('switch', { id }); return true; }
  function holster() { if (P.holstered) return; if (P.reload) cancelReload(); P.holstered = true; disarmActor(P); P.w = null; P.aimK = 0; syncHelmet(); emit('switch', { id: null }); }
  const curDef = () => { const id = P.holstered ? 'fists' : P.cur, e = GT.weapons && GT.weapons.effDef ? GT.weapons.effDef(id) : null; return e && e.id === id ? e : WD(id); };   /* SH: with the player's attachments (bigger magazine, scope zoom, suppressor, grip) */
  function cancelReload() { P.reload = null; P.reloadK = 0; }
  function startReload() { const d = curDef(), s = ammoOf(d.id); if (!s || d.kind !== 'gun' || P.reload || s.mag >= d.mag || s.reserve <= 0 || P.holstered) return false; const dur = d.perShell ? d.reload : d.reload;
    P.reload = { t: 0, dur, sweet0: d.perShell ? 2 : .44, sweet1: d.perShell ? 2 : .58, tried: false, perfect: false, shells: d.perShell ? min(d.mag - s.mag, s.reserve) : 0, first: true }; SND.mech(d.perShell ? 'shellin' : 'magout', P); stats.reloads++; emit('reload', { id: d.id, start: true }); return true; }
  function finishReload(perfect) { const d = curDef(), s = ammoOf(d.id), R_ = P.reload; if (!s || !R_) return; if (d.perShell) { s.mag++; s.reserve--; R_.shells--; SND.mech('shellin', P); if (R_.shells > 0 && s.reserve > 0 && s.mag < d.mag) { R_.t = 0; R_.first = false; return; } SND.mech('pump', P); if (P.w) P.w.update(0, { fired: false }); }
    else { const n = min(d.mag - s.mag, s.reserve); s.mag += n; s.reserve -= n; SND.mech(perfect ? 'perfect' : 'rack', P); }
    P.bonus = perfect ? 1.12 : 1; if (perfect) stats.perfectReloads++; P.reload = null; P.reloadK = 0; P.cool = max(P.cool, perfect ? .05 : .16); emit('reload', { id: d.id, perfect: !!perfect }); }
  function bestGun() { let best = null, bs = -1; for (const id in P.inv) { if (!P.owned[id] || WD(id).kind === 'throw') continue; const s = P.inv[id], sc = s.mag + s.reserve > 0 ? (WD(id).tool ? .5 : WD(id).slot) + (s.mag > 0 && !WD(id).tool ? 10 : 0) : -1; if (sc > bs) { bs = sc; best = id; } } return bs >= 0 ? best : null; }
  function outOfAmmo(id) { if (S.time - (P.emptyT === undefined ? -9 : P.emptyT) < 4 && S.time >= (P.emptyT || 0)) return; P.emptyT = S.time; emit('empty', { id }); if (!S.headless) HUD.note('弹匣打空了', '地上的枪靠近就能捡 · 先抡近战顶住'); }
  /** player pulls the trigger */
  function playerFire() {
    const d = curDef(), s = ammoOf(d.id); if (d.kind !== 'gun' || P.cool > 0 || P.drawT > 0 || !s) return false;
    if (P.reload) { if (d.perShell && s.mag > 0) { cancelReload(); } else return false; }
    if (s.mag <= 0) { if (S.time - P.dryT > .25) { P.dryT = S.time; SND.mech('dry', P); emit('dry', { id: d.id }); if (s.reserve > 0) startReload(); else { const b = bestGun(); if (b && b !== d.id) equip(b); else if (!b) { outOfAmmo(d.id); equip(meleeBest()); } } } return false; }
    s.mag--; P.cool = 60 / d.rpm; P.shotT = S.time; stats.shots++;
    const hip = P.aimK < .5, blind = P.cover && hip, spread = (lerp(d.hip, d.aim, sst(P.aimK, 0, 1)) + P.bloom + sat(P.speed / 6) * .02 * (hip ? 1.5 : .6)) * (blind ? 2.6 : 1) * (S.focusK > .5 ? .6 : 1);
    if (blind) { P.blindT = .5; P.blindSide = P.cover.c.low ? 0 : (P.cover.s > P.cover.c.L / 2 ? 1 : -1) * (P.cover.flip || 1); }
    const mz = muzzleOf(P, tr.o); let aim = _e.copy(P.aimPt).sub(mz); const dist = aim.length(); if (dist < (P.onTarget ? .08 : 1.2)) aim.copy(CAM.dir); else aim.multiplyScalar(1 / dist);
    if (blind && !P.cover.c.low) { mz.set(P.x, P.y + 1.35, P.z).addScaledVector(_a.set(P.cover.c.tx, 0, P.cover.c.tz), (P.cover.s > P.cover.c.L / 2 ? 1 : -1) * .75).addScaledVector(_a.set(P.cover.c.nx, 0, P.cover.c.nz), .1); aim.copy(P.aimPt).sub(mz).normalize(); }
    else if (blind) { mz.set(P.x, P.y + P.cover.c.h + .22, P.z).addScaledVector(_a.set(P.cover.c.nx, 0, P.cover.c.nz), -.35); aim.copy(P.aimPt).sub(mz).normalize(); }
    // bullet magnetism: a near miss at the centre of the reticle is nudged onto the target
    if (opts.aimAssist > 0 && !blind) { let bestE = null, bd = .03; for (const e of enemies) { if (e.dead) continue; const top = e.y + lerp(e.ht, e.ht * .6, e.crouchK); for (const hy of [top - .11, e.y + (top - e.y) * .72]) { _a.set(e.x - mz.x, hy - mz.y, e.z - mz.z); const l = _a.length(); _a.multiplyScalar(1 / l); const ang = Math.acos(clamp(_a.dot(aim), -1, 1)); if (ang < bd) { bd = ang; bestE = ang > .003 ? _b.copy(_a) : null; } } } if (bestE) aim.lerp(bestE, opts.aimAssist).normalize(); }
    const before = stats.hits; discharge(P, mz, aim, d, spread); if (!d.spray && !d.tool) S.wflash = 1;
    P.bloom = min(.06, P.bloom + d.bloom); P.recoilK = 1; const kp = d.recoil * (hip ? 1.25 : 1) * (S.focusK > .5 ? .5 : 1), ky = d.recoilYaw * (rnd() * 2 - 1); CAM.pitch -= kp; CAM.yaw += ky; CAM.kick += kp * .65; CAM.kickYaw -= ky * .5; S.punch.x += kp * .7; S.shake = min(1, S.shake + (d.pellets > 1 ? .5 : .16));
    if (stats.hits > before) HUD.hitmark(); emit('fire', { id: d.id, mag: s.mag, sup: !!d.sup }); if (!d.tool && !(d.sup && !copNear(26))) heat(d.sup ? .5 : 1, 'gunfire');   /* SH: a suppressed shot only draws heat when an officer is close */
    if (s.mag === 0 && s.reserve <= 0) { const b = bestGun(); P.autoSwap = b && b !== d.id ? b : (b ? null : meleeBest()); P.autoSwapT = .45; if (!b) outOfAmmo(d.id); }
    return true; }
  /* ================================================================== SH: throwables — the frag grenade bounces and goes off on its fuse, the molotov bursts into a pool of fire where it lands */
  const TH = { list: [], fires: [], light: null };
  function copNear(r) { const cops = hook('cops'); if (Array.isArray(cops)) for (const c of cops) if (c && hyp(c.x - P.x, c.z - P.z) < r) return true; for (const e of enemies) if (!e.dead && e.kind === 'cop' && hyp(e.x - P.x, e.z - P.z) < r) return true; return false; }
  function throwItem(d) { const s = ammoOf(d.id); if (!s) return false; if (s.mag <= 0 && s.reserve > 0) { s.mag = 1; s.reserve--; } if (s.mag <= 0) { outOfAmmo(d.id); equip(meleeBest()); return false; }
    s.mag--; P.cool = .85; P.shotT = S.time; const dir = _a.copy(CAM.dir); dir.y = max(dir.y, -.25); dir.normalize(); const o = V3(P.x + sin(P.h) * .35 - cos(P.h) * .18, P.y + 1.62, P.z + cos(P.h) * .35 + sin(P.h) * .18);
    if (P.w && P.w.group && P.w.group.parent && !S.headless) { P.w.group.getWorldPosition(_b); if (hyp(_b.x - P.x, _b.z - P.z) < 1.2) o.copy(_b); }
    const v = V3().copy(dir).multiplyScalar(d.throwV || 14); v.y += 3.4; let m = null; if (!S.headless && GT.weapons) { m = GT.weapons.make(d.id, { lod: 1 }).group; m.position.copy(o); S.root.add(m); }
    TH.list.push({ d, m, p: o, v, t: 0, bounces: 0 }); if (P.w && P.w.group) { P.w.group.visible = false; TH.hideT = .55; }
    if (s.mag <= 0 && s.reserve > 0) { s.mag = 1; s.reserve--; } if (s.mag <= 0 && s.reserve <= 0) { const b = bestGun(); P.autoSwap = b || meleeBest(); P.autoSwapT = .7; }
    SND.swish(P); emit('throw', { id: d.id }); return true; }
  function boxAt(x, y, z) { const B = GT.world && GT.world.boxes; if (!B) return null; for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.passable || b.h < .4 || y > b.h) continue; if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return b; } return null; }
  function throwStep(dt) { if (TH.hideT > 0) { TH.hideT -= dt; if (TH.hideT <= 0 && P.w && P.w.group) P.w.group.visible = true; }
    for (const q of TH.list) { q.t += dt; const px = q.p.x, pz = q.p.z; q.v.y -= 12 * dt; q.p.addScaledVector(q.v, dt); const gy = groundY(q.p.x, q.p.z);
      const b = boxAt(q.p.x, q.p.y, q.p.z); if (b) { if (q.d.fire) { ignite(px, q.p.y, pz, q.d); q.dead = true; } else { const inX = px > b.x0 && px < b.x1; if (inX) q.v.z *= -.4; else q.v.x *= -.4; q.p.x = px; q.p.z = pz; q.bounces++; } }
      if (!q.dead && q.p.y <= gy + .06) { if (q.d.fire) { ignite(q.p.x, gy, q.p.z, q.d); q.dead = true; } else { q.p.y = gy + .06; q.v.y = abs(q.v.y) > 1.2 ? -q.v.y * .32 : 0; q.v.x *= .62; q.v.z *= .62; if (q.bounces++ < 3 && !S.headless) SND.mech('dry', { x: q.p.x, y: q.p.y, z: q.p.z }); } }
      if (q.m) { q.m.position.copy(q.p); q.m.rotation.x += dt * (q.v.y === 0 ? 0 : 9); q.m.rotation.z += dt * (q.v.y === 0 ? 0 : 4); }
      if (!q.dead && !q.d.fire && q.t >= (q.d.fuse || 2.5)) { explode(q.p.x, q.p.y, q.p.z, q.d); q.dead = true; }
      if (q.dead && q.m && q.m.parent) q.m.parent.remove(q.m); }
    if (TH.list.some(q => q.dead)) TH.list = TH.list.filter(q => !q.dead);
    for (const f of TH.fires) { f.t += dt; const life = 1 - f.t / f.dur, k = min(1, f.t * 4) * sst(life, 0, .25);
      f.acc += dt * 42 * k; while (f.acc > 1) { f.acc--; const a = rnd() * TAU, r = sqrt(rnd()) * f.r * .85, hot = rnd(); FX.sprite({ pos: _b.set(f.x + cos(a) * r, f.y + .05 + rnd() * .15, f.z + sin(a) * r), tex: 'smoke', add: true, life: .5 + rnd() * .5, size: .3 + rnd() * .35, grow: .55, r: 6 + hot * 3, g2: 1.6 + hot * 2.2, b: .3 + hot * .3, vel: _c.set((rnd() - .5) * .5, 1.4 + rnd() * 2.2, (rnd() - .5) * .5), a: .9, spin: (rnd() - .5) * 3 });
        if (rnd() < .3) FX.sprite({ pos: _b.set(f.x + cos(a) * r * .6, f.y + .1, f.z + sin(a) * r * .6), tex: 'dot', add: true, life: .3, size: .9 + rnd() * .6, grow: -.6, r: 5, g2: 1.6, b: .3, a: .5 });
        if (rnd() < .12) FX.sprite({ pos: _b.set(f.x + cos(a) * r, f.y + 1.4, f.z + sin(a) * r), tex: 'smoke', life: 2.8, size: .7, grow: 1.5, fadeIn: .3, a: .45 * k, r: .05, g2: .048, b: .045, vel: _c.set(0, 1.6, 0), drag: .4, spin: .3 }); }
      f.hurtT -= dt; if (f.hurtT <= 0) { f.hurtT = .25; const dmg = f.dps * .25 * k;
        for (const e of enemies) if (!e.dead && hyp(e.x - f.x, e.z - f.z) < f.r) damageEnemy(e, dmg, 'legs', _c.set(0, 0, 1), f.d, P);
        if (!P.dead && hyp(P.x - f.x, P.z - f.z) < f.r * .9 && abs(P.y - f.y) < 1.5) damagePlayer(dmg * .7, { x: f.x, z: f.z }, 'fire');
        for (const c of civs()) if (hyp(c.x - f.x, c.z - f.z) < f.r) hook('civHit', c, { dmg: dmg * 2, dx: c.x - f.x, dz: c.z - f.z, heavy: false, weapon: 'molotov' }); }
      if (TH.light && !FX.lent) { TH.light.l.position.set(f.x, f.y + 1.1, f.z); TH.light.l.intensity = (3.5 + 2 * sin(S.time * 23) * sin(S.time * 7)) * k; TH.light.l.color.setRGB(1, .55, .2); TH.light.l.distance = 14; } }
    if (TH.fires.length && TH.fires[0].t >= TH.fires[0].dur) { TH.fires.shift(); if (TH.light && !TH.fires.length) { TH.light.l.intensity = 0; TH.light.l.color.setHex(0xffb060); TH.light.l.position.set(0, -50, 0); TH.light.life = 0; TH.light = null; } } }
  function blastSound(x, y, z, big) { if (S.headless || !SND.ac) return; const Pp = SND.place(_d.set(x, y, z), { g: big ? 2.4 : 1.2, ref: 30 }); SND.nz(Pp.dst, Pp.t, { type: 'lowpass', f: big ? 1100 : 2400, f2: 50, q: .4, g: big ? 2.4 : 1.1, a: .003, d: big ? 1.8 : .5 }); SND.tone(Pp.dst, Pp.t, { type: 'sine', f: big ? 72 : 140, f2: 26, g: big ? 1.8 : .6, a: .002, d: big ? 1.1 : .3 }); SND.nz(Pp.dst, Pp.t, { type: 'highpass', f: 1800, q: .5, g: big ? .9 : 1.2, a: .001, d: big ? .14 : .35 }); }
  function explode(x, y, z, d) { const r = d.radius || 7; S.shake = min(1.4, S.shake + 1.3 * sat(1 - hyp(P.x - x, P.z - z) / 40)); blastSound(x, y, z, true); emit('explosion', { x, y, z, id: d.id });
    if (!S.headless) { const n = GT.env ? GT.env.night || 0 : 0, am = FX.amb();
      FX.sprite({ pos: _b.set(x, y + .7, z), tex: 'star', add: true, life: .12, size: 3.2, grow: 14, r: 9, g2: 6, b: 3, a: 1 });
      for (let i = 0; i < 14; i++) { const a = rnd() * TAU, u = rnd(); FX.sprite({ pos: _b.set(x + cos(a) * u * 1.1, y + .3 + rnd() * 1.1, z + sin(a) * u * 1.1), tex: 'smoke', add: true, life: .45 + rnd() * .5, size: .9 + rnd() * 1.1, grow: 3.4 + rnd() * 2, r: 7 + rnd() * 3, g2: 2.6 + rnd() * 1.8, b: .5 + rnd() * .4, vel: _c.set(cos(a) * (2 + rnd() * 4), 2.5 + rnd() * 4, sin(a) * (2 + rnd() * 4)), drag: 2.4, a: .95, spin: (rnd() - .5) * 2 }); }
      for (let i = 0; i < 16; i++) { const a = rnd() * TAU, u = rnd(); FX.sprite({ pos: _b.set(x + cos(a) * u * 1.6, y + .4 + rnd() * 1.6, z + sin(a) * u * 1.6), tex: 'smoke', life: 3.5 + rnd() * 3.5, size: 1.2 + rnd() * 1.2, grow: 1.5 + rnd(), fadeIn: .25, a: .75, r: .07 * am + .02, g2: .065 * am + .02, b: .06 * am + .02, vel: _c.set(cos(a) * (1 + rnd() * 2.5), 1.4 + rnd() * 2.6, sin(a) * (1 + rnd() * 2.5)), drag: 1.1, spin: (rnd() - .5) * .8 }); }
      for (let i = 0; i < 18; i++) FX.sprite({ pos: _b.set(x, y + .5, z), tex: 'dot', add: true, life: .5 + rnd() * .6, size: .06, r: 9, g2: 5, b: 1.5, vel: _c.set((rnd() - .5) * 18, 4 + rnd() * 10, (rnd() - .5) * 18), g: -14 });
      if (FX.debris) FX.debris(_b.set(x, y + .15, z), _c.set(0, 1, 0), 14, false, .25, .23, .2, true);
      if (!FX.lent && FX.lights[0]) { const L = FX.lights[0]; L.life = .2; L.max = 1.6 + 2.6 * n; L.l.color.setRGB(1, .58, .28); L.l.position.set(x, y + 1.4, z); L.l.intensity = L.max * 2.8; L.l.distance = 26; setTimeout(() => { if (!FX.lent) { L.l.distance = 14; L.l.color.setHex(0xffb060); } }, 400); } }
    const dir = _c; for (const e of enemies) { if (e.dead) continue; const dd = hyp(e.x - x, e.z - z, (e.y || 0) + .9 - y); if (dd > r) continue; dir.set(e.x - x, .3, e.z - z).normalize(); damageEnemy(e, d.dmg * Math.pow(1 - dd / r, 1.1) + 12, 'body', dir, d, P); }
    for (const c of civs()) { const dd = hyp(c.x - x, c.z - z); if (dd < r) hook('civHit', c, { dmg: d.dmg * (1 - dd / r) + 20, dx: c.x - x, dz: c.z - z, gun: true, heavy: true, zone: 'body', weapon: d.id }); }
    if (!P.dead) { const dd = hyp(P.x - x, P.z - z, P.y + .9 - y); if (dd < r) damagePlayer(d.dmg * Math.pow(1 - dd / r, 1.3) * .8, { x, z }, 'blast'); }
    const G = GT.cngame && GT.cngame.G; if (G && G.ents) for (const e of G.ents) { if (!e.alive) continue; const dd = hyp(e.x - x, e.z - z); if (dd > r + 2) continue; const k = (1 - dd / (r + 2)), nx = (e.x - x) / (dd || 1), nz = (e.z - z) / (dd || 1); if (e.mode !== 'player') { e.px = (e.px || 0) + nx * k * 6; e.pz = (e.pz || 0) + nz * k * 6; } if (e.c) e.c.damage = min(1, (e.c.damage || 0) + .5 * k); }
    heat(2, 'explosion', true); S.noise.push({ x, z, r: 60, t: S.time, by: P, kind: 'gun' }); }
  function ignite(x, y, z, d) { const f = { x, y, z, r: d.radius || 3.2, t: 0, dur: d.burn || 7, dps: d.dps || 26, d, acc: 0, hurtT: 0 }; TH.fires.push(f); if (TH.fires.length > 3) TH.fires.shift(); blastSound(x, y, z, false); S.shake = min(1, S.shake + .3 * sat(1 - hyp(P.x - x, P.z - z) / 25));
    if (window.GT.samples && GT.samples.play && !S.headless) { try { GT.samples.play('crash_glass_1', { x, y: y + .3, z, g: .9 }); } catch (e) {} }
    if (!FX.lent && FX.lights[1] && !S.headless) { TH.light = FX.lights[1]; TH.light.life = 0; } heat(1, 'arson', true); emit('fire', { id: 'molotov' }); for (const e of enemies) if (!e.dead && hyp(e.x - x, e.z - z) < f.r + 1) damageEnemy(e, d.dmg || 20, 'body', _c.set(e.x - x, 0, e.z - z).normalize(), d, P); }
  function heat(n, why, force) { if (!force && S.time - S.lastHeatT < 6) return; S.lastHeatT = S.time; hook('addHeat', n, why); hook('flag', why); emit('heat', { stars: n, reason: why }); }
  function damagePlayer(dmg, from, kind) {
    if (P.dead) return; if (S.sc && S.sc.safe) return;   /* a scripted held moment (the first gun and its title band): nothing lands */ if (P.iframes > 0 && kind !== 'bullet') return; if (P.iframes > 0 && kind === 'bullet' && rnd() < .6) return;
    if (kind === 'melee' && P.blockK > .6) { dmg *= .15; SND.melee(P, false, true); S.shake = min(1, S.shake + .25); } else if (kind === 'melee') { P.stagK = 1; S.shake = min(1, S.shake + .6); }
    if (kind === 'bullet') { const db = S.time - (P.lastBulletT === undefined ? -9 : P.lastBulletT); const buck = !!(from && from.def && from.def.pellets > 1);   /* a shotgun blast is one hit made of pellets: they are not halved as 'the second bullet', and the room's bullet scale does not apply (二筒's 河口 12 did 1 hp) */ if (db >= 0 && db < .28 && !buck) dmg *= .5; P.lastBulletT = S.time; if (S.sc && S.sc.hurtK && !buck) dmg *= S.sc.hurtK;
      /* no kill out of nowhere (play report b3-story1: 18 s of misses, then 70 -> 1 inside a second): a room can cap what bullets take in any 1.2 s (sc.spikeCap), so a full burst that lands is a warning with a hit marker, the next one hurts, the third kills */
      const cap = S.sc && S.sc.spikeCap; if (cap && !buck) { if (abs(S.time - (P.spT === undefined ? -9 : P.spT)) > 1.2) { P.spT = S.time; P.spD = 0; } const room = max(0, cap - P.spD); if (dmg > room) dmg = room; P.spD += dmg; } }
    if (opts.god) dmg = 0; if (P.armor > 0) { const a = min(P.armor, dmg * .7); P.armor -= a; dmg -= a; }
    P.hp -= dmg; stats.damageTaken += dmg; P.lastHitT = S.time; if (from) P.hitDirs.push({ x: from.x, z: from.z, t: 1 }); if (P.hitDirs.length > 6) P.hitDirs.shift(); S.punch.x += .012; S.punch.y += (rnd() - .5) * .03; emit('damage', { dmg, hp: P.hp, from });
    if (P.hp <= 0) { if (P.mode !== 'down' && !P.usedLastStand && !(GT.cngame && GT.cngame.player && GT.cngame.player.mode && GT.cngame.player.mode !== 'foot')) { P.hp = 1; P.mode = 'down'; P.down = 0; P.usedLastStand = true; P.cover = null; cancelReload(); if (WD(P.cur).kind !== 'gun' || P.holstered) { const b = bestGun(); if (b) equip(b, true); } emit('down', { lastStand: true }); }
      else { P.hp = 0; P.dead = true; P.mode = 'dead'; P.fallT = 0; P.aimK = 0; SND.body(P); emit('down', { dead: true }); hook('onPlayerDown'); if (S.sc && !S.sc.done) { S.sc.failed = true; S.sc.done = true; S.sc.beat = 'failed'; S.sc.objective = '任务失败'; emit('scenario', { name: S.sc.name, beat: 'failed' }); } } } }

  function tryCover() { const cs = buildCovers(P.x, P.z, 14, P.y); let best = null, bd = 1.9; for (const c of cs) { const d = hyp(c.x - P.x, c.z - P.z); if (d > bd) continue; const face = sin(CAM.yaw) * -c.nx + cos(CAM.yaw) * -c.nz; const sc = d - face * .5; if (sc < bd) { bd = sc; best = c; } }
    if (!best) return false; const c = best, s = clamp((P.x - c.ax) * c.tx + (P.z - c.az) * c.tz, .3, max(.3, c.L - .3)); P.cover = { c, s }; P.mode = 'cover'; P.modeT = 0; P.swing = null; emit('cover', { enter: true, low: c.low }); return true; }
  function leaveCover() { if (!P.cover) return; P.cover = null; if (P.mode === 'cover') P.mode = 'free'; P.leanK = 0; emit('cover', { enter: false }); }

  /* ---- melee: player side */
  /* bystanders (js/people.js crowd records handed in by hooks.civs()): fists, tools and bullets land on them too; what happens to them is the host's business (hooks.civHit(civ, {dmg, dx, dz, heavy, gun, zone, weapon})) */
  const CIV = { list: [], t: -9, a: { x: 0, y: 0, z: 0, h: 0, ht: 1.7, crouchK: 0, prone: false } };
  function civs() { if (S.real - CIV.t > .2) { CIV.t = S.real; const l = hook('civs'); CIV.list = Array.isArray(l) ? l : []; } return CIV.list; }
  function civNear(range, arc, h) { let best = null, bs = 1e9; for (const c of civs()) { const dx = c.x - P.x, dz = c.z - P.z, d = hyp(dx, dz); if (d > range || abs((c.y || 0) - P.y) > 1.4) continue; const a = abs(angDiff(h, Math.atan2(dx, dz))); if (a > arc) continue; const sc = d + a * 2; if (sc < bs) { bs = sc; best = c; } } return best; }
  /* free roam: a left click always throws a punch (or swings / fires what is in the hand), target or not. Not while a phone, a pause screen, a cutscene or a shop panel has the input. */
  function freeSwingOK() { if (S.headless) return true; const g = GT.cngame, G = g && g.G; if (G && (G.inputOff || G.cine || G.paused)) return false; try { if (document.querySelector('.cn-phone.on, .f-screen.on, .sp-bill.on')) return false; } catch (e) {} return true; }
  function meleeTarget(range, arc) { let best = null, bs = 1e9; for (const e of enemies) { if (e.dead || (e.hold && e.staged)) continue; const dx = e.x - P.x, dz = e.z - P.z, d = hyp(dx, dz); if (d > range) continue; const a = abs(angDiff(CAM.yaw, Math.atan2(dx, dz))); if (a > arc) continue; const sc = d + a * 2 - (e === P.lock ? 1.5 : 0); if (sc < bs) { bs = sc; best = e; } } return best; }
  function startSwing(kind, heavy) { const d = curDef(), sd = SWING[kind]; const dur = (d.kind === 'gun' ? .4 : (d.swing || .36)) * (heavy ? 1.75 : kind === 'shove' ? 1.1 : kind === 'takedown' ? 2.4 : 1);
    P.swing = { kind, k: 0, dur, hit: false, heavy: !!heavy, def: d }; P.mode = 'melee'; P.modeT = 0; const t = P.lock || meleeTarget(4.2, 1.3), cv = t ? null : civNear(3.2, 1.2, CAM.yaw); if (t) { P.lock = t; P.h = Math.atan2(t.x - P.x, t.z - P.z); const dd = hyp(t.x - P.x, t.z - P.z), reach = (d.reach || 1.2) * .78; P.lunge = clamp(dd - reach, 0, heavy ? 2.4 : 1.7) / (dur * sd.hit); } else if (cv) { P.h = Math.atan2(cv.x - P.x, cv.z - P.z); P.lunge = clamp(hyp(cv.x - P.x, cv.z - P.z) - (d.reach || 1.2) * .78, 0, 1.7) / (dur * sd.hit); } else P.lunge = kind === 'shove' ? 0 : P.sprint ? 2.6 : .9;   /* nobody in reach: the swing is thrown anyway; out of a run it carries the body forward */
    if (P.cover) leaveCover(); P.mode = 'melee'; SND.swish(P); }
  function meleeContact() { const sw = P.swing, d = sw.def, gunWhip = d.kind === 'gun', reach = (gunWhip ? 1.3 : d.reach || 1.2) + .25, shove = sw.kind === 'shove'; let n = 0;
    for (const e of enemies) { if (e.dead || (e.hold && e.staged)) continue;   /* staged: a scripted fight keeps him waiting his turn — a swing meant for the man in front does not land on him */
      const dx = e.x - P.x, dz = e.z - P.z, dist = hyp(dx, dz); if (dist > reach + e.r) continue; if (abs(angDiff(P.h, Math.atan2(dx, dz))) > 1.15) continue; n++;
      const behind = sin(e.h) * dx + cos(e.h) * dz > .25, dir = _a.set(dx / (dist || 1), 0, dz / (dist || 1));
      if (sw.kind === 'takedown') { koEnemy(e, dir); stats.takedowns++; S.hitstop = .1; S.shake = min(1, S.shake + .5); SND.melee(e, true); emit('takedown', { e }); continue; }
      if ((e.blockK > .5 || (e.ironGuard && !e.prone && e.state !== 'stagger' && e.state !== 'down' && e.state !== 'getup')) && !behind && !sw.heavy && !shove) { e.blockT = .5;   /* ironGuard (set by a lesson): light swings from the front bounce even while he is swinging himself; a heavy, a shove or his back still work */
        SND.melee(e, false, true); S.hitstop = .05; S.shake = min(1, S.shake + .2); if (!e.ironGuard) { e.pushX = dir.x * 1.2; e.pushZ = dir.z * 1.2; }   /* a braced lesson guard gives no ground: twenty bounced lights used to walk him across the room and out of the door */ P.swing.blocked = true; continue; }
      const dmg = shove ? 4 : gunWhip ? 22 : sw.heavy ? d.heavy : d.dmg * (sw.kind === 'l3' || sw.kind === 'hook' ? 1.3 : 1); stats.meleeHits++;
      damageEnemy(e, dmg, 'torso', dir, null, P, { melee: true, heavy: sw.heavy || shove, stagger: shove ? 1.2 : (d.stagger || .5) * (sw.heavy ? 2 : sw.kind === 'l3' || sw.kind === 'hook' ? 1.3 : .7), push: shove ? 5.5 : sw.heavy ? 4.5 : 1.6 });
      _b.set(e.x - dir.x * .25, e.y + 1.25, e.z - dir.z * .25); FX.impact(_b, _c.copy(dir).multiplyScalar(-1), 'flesh'); FX.sprite({ pos: _b, tex: 'star', add: true, life: .09, size: sw.heavy ? .7 : .42, r: 5, g2: 4.4, b: 3.4 });
      SND.melee(e, sw.heavy); S.hitstop = max(S.hitstop, sw.heavy ? .12 : .06); S.shake = min(1, S.shake + (sw.heavy ? .8 : .35)); S.punch.x += sw.heavy ? .03 : .012; P.focus = min(1, P.focus + .05); }
    const hitEnemy = n > 0;  // Civilian witnesses are handled by the host's civHit hook.
    if (sw.kind !== 'takedown') for (const c of civs()) { const dx = c.x - P.x, dz = c.z - P.z, dist = hyp(dx, dz); if (dist > reach + .3 || abs((c.y || 0) - P.y) > 1.4 || abs(angDiff(P.h, Math.atan2(dx, dz))) > 1.15) continue; const dir = _a.set(dx / (dist || 1), 0, dz / (dist || 1)), dmg = shove ? 4 : gunWhip ? 22 : sw.heavy ? d.heavy : d.dmg * (sw.kind === 'l3' || sw.kind === 'hook' ? 1.3 : 1);
      if (hook('civHit', c, { dmg, dx: dir.x, dz: dir.z, heavy: !!sw.heavy || sw.kind === 'hook' || sw.kind === 'l3', shove, weapon: d.id }) === false) continue; n++; stats.meleeHits++; _b.set(c.x - dir.x * .25, (c.y || 0) + 1.25, c.z - dir.z * .25); FX.impact(_b, _c.copy(dir).multiplyScalar(-1), 'flesh'); FX.sprite({ pos: _b, tex: 'star', add: true, life: .09, size: sw.heavy ? .7 : .42, r: 5, g2: 4.4, b: 3.4 });
      SND.melee(c, sw.heavy); S.hitstop = max(S.hitstop, sw.heavy ? .12 : .06); S.shake = min(1, S.shake + (sw.heavy ? .8 : .35)); }
    if (n) { S.noise.push({ x: P.x, z: P.z, r: 9, t: S.time, by: P, kind: 'melee' }); const cops = hitEnemy && hook('cops'); if (Array.isArray(cops)) for (const c of cops) if (c && hyp(c.x - P.x, c.z - P.z) < 32 && los(c.x, 1.5, c.z, P.x, 1.4, P.z)) { heat(1, 'assault'); break; } HUD.hitmark(); }
    emit('melee', { kind: sw.kind, hits: n }); return n; }

  /* ---- player: per-frame control (own controller; see header for how it shares the hero with GT.onfoot) */
  /** number keys answering a story choice / a shop menu must not also draw a weapon: GT.combat.lockSlots(true) while the menu is up; the lock outlives the release by a fifth of a second (the key that closed the menu) */
  const slotLocked = () => !!S.slotLock || (S.slotFreeAt || 0) > performance.now();
  const SLOTKEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'];   /* 8 = the tool slot (js/shops.js hardware: nail gun / extinguisher) */
  function slotWeapon(i) { const sl = GT.weapons ? GT.weapons.slots[i] : null; if (!sl || sl.empty) return null;
    if (WH.open && WH.sel === i && P.owned[WH.pick] && sl.ids.includes(WH.pick)) return WH.pick;
    if (!P.holstered && P.owned[P.cur] && sl.ids.includes(P.cur)) return P.cur;
    if (i === 2) return P.melee && P.owned[P.melee] ? P.melee : sl.ids.find(id => P.owned[id]) || null; return sl.ids.find(id => P.owned[id]) || null; }
  /** the other owned weapon sharing a wheel slot with the one in hand (melee tools in slot 2, hardware tools in slot 7) */
  function slotOther(i, id) { const sl = GT.weapons ? GT.weapons.slots[i] : null; if (!sl || sl.empty || sl.ids.length < 2) return null; const k = sl.ids.indexOf(id); for (let j = 1; j < sl.ids.length; j++) { const o = sl.ids[(k + j) % sl.ids.length]; if (o !== id && P.owned[o]) return o; } return null; }
  function scrollWeapon(steps) {
    if (!steps) return;
    const slots = GT.weapons?.slots || [];
    const owned = slots.flatMap(sl => sl.empty ? [] : sl.ids.filter(id => P.owned[id]));
    if (!owned.length) return;
    const current = (WH.open && slotWeapon(WH.sel)) || (P.holstered ? 'fists' : P.cur);
    const index = owned.indexOf(current);
    const next = owned[((index + steps) % owned.length + owned.length) % owned.length];
    if (WH.open) pointWheelAt(slots.findIndex(sl => sl.ids?.includes(next)), next);
    else equip(next);
  }
  const REGEN = { delay: 5, rate: 11, cap: 1 };
  function playerUpdate(dt, rdt, scroll) {
    const K = opts.keys, d = curDef(), gun = d.kind === 'gun', ax = IN.axis();
    P.cool = max(0, P.cool - dt); P.drawT = max(0, P.drawT - dt); P.bloom = max(0, P.bloom - dt * .075); P.recoilK = max(0, P.recoilK - dt * 8); P.iframes = max(0, P.iframes - dt); P.stagK = max(0, P.stagK - dt * 2.4); P.blindT = max(0, P.blindT - dt); P.blindK = damp(P.blindK, P.blindT > 0 ? 1 : 0, 16, dt); P.suppress = max(0, P.suppress - dt * .5);
    { const r = CAM.kick * min(1, rdt * 6); CAM.pitch += r; CAM.kick -= r; const ry = CAM.kickYaw * min(1, rdt * 6); CAM.yaw += ry; CAM.kickYaw -= ry; }
    for (const hd of P.hitDirs) hd.t -= rdt * .8; while (P.hitDirs.length && P.hitDirs[0].t <= 0) P.hitDirs.shift();
    { const rg = (S.sc && S.sc.regen) || REGEN; if (!P.dead && P.mode !== 'down' && S.time - P.lastHitT > rg.delay && P.hp < P.maxHp * rg.cap) P.hp = min(P.maxHp * rg.cap, P.hp + dt * rg.rate); }
    if (!S.wheelOpen && !S.hitcam) { CAM.yaw -= IN.look.dx; CAM.pitch = clamp(CAM.pitch + IN.look.dy, -1.0, 1.1); }
    if (P.shellDue > 0) { P.shellDue -= dt; if (P.shellDue <= 0 && P.w && P.w.group.parent && !S.headless) { P.w.ejector.getWorldPosition(_a); _c.set(-cos(P.h), 0, sin(P.h)).multiplyScalar(1.5).setY(1.3); FX.eject(_a, _c, P.y, true); SND.mech('pump', P); } }
    if (P.dead) { P.fallT = (P.fallT || 0) + dt; const k = sst(P.fallT, 0, .8), nat = !!(P.rig && P.rig.hero); P.anim = 'fall'; P.tiltX = nat ? 0 : -(HP - .06) * k; P.yOff = nat ? 0 : .1 * k;   /* QA: the hero's rig lies down by itself ('fall'): tipping the group over as well stood him on his head with the legs in the air */ P.crouchK = 0; P.aimK = 0; P.prone = true; P.animSpeed = 0; return; }
    if (P.autoSwap && (P.autoSwapT -= dt) <= 0) { equip(P.autoSwap); P.autoSwap = null; }
    // ---- weapon selection
    if (!S.wheelOpen && !slotLocked()) { for (let i = 0; i < 8; i++) if (IN.pressed(SLOTKEYS[i])) { const sl = GT.weapons && GT.weapons.slots[i], inSl = !P.holstered && sl && sl.ids && sl.ids.indexOf(P.cur) >= 0; if (inSl) { const o = slotOther(i, P.cur); if (o) equip(o); } else { const id = slotWeapon(i); if (id) equip(id); } }   /* QA: the key cycles on from the weapon in the hand (7: smg, carbine, sniper; it used to go back to the first, so the third was never reached) */
      scrollWeapon(scroll); if (IN.pressed(K.holster)) { if (P.holstered) equip(P.cur === 'fists' ? (bestGun() || meleeBest()) : P.cur); else holster(); } if (IN.pressed(K.shoulder)) { const c = S.ctx && S.ctx.ctl; if (c && c.setView) c.setView(c.view === 'fp' ? 'tp' : 'fp'); else CAM.shoulder = -CAM.shoulder; } if (IN.pressed('KeyB')) CAM.shoulder = -CAM.shoulder; }   // V: first / third person (the session-wide choice kept by GT.onfoot); B: swap shoulder (third person)
    const canAct = P.mode === 'free' || P.mode === 'cover' || P.mode === 'down', rmb = IN.down('Mouse1') && !S.wheelOpen, lmbP = IN.pressed('Mouse0') && !S.wheelOpen, lmb = IN.down('Mouse0') && !S.wheelOpen;
    const aiming = gun && !P.holstered && rmb && canAct && P.drawT <= 0;
    // ---- reload (+ active reload: tap again inside the sweet spot)
    if (P.reload) { const R_ = P.reload; R_.t += dt; P.reloadK = sat(R_.t / R_.dur); if (!d.perShell && !R_.in && P.reloadK > .62) { R_.in = true; SND.mech('magin', P); } if (R_.t >= R_.dur) finishReload(false); }
    if (IN.pressed(K.reload) && gun && !P.holstered) { if (P.reload && !d.perShell) { const R_ = P.reload; if (!R_.tried) { R_.tried = true; if (P.reloadK >= R_.sweet0 && P.reloadK <= R_.sweet1) finishReload(true); else { R_.dur += .5; R_.fumble = true; SND.mech('dry', P); } } } else if (!P.reload) startReload(); }
    if (gun && !P.holstered && !P.reload && opts.autoReload && P.mode !== 'down') { const am = ammoOf(d.id); if (am && am.mag === 0 && am.reserve > 0 && S.time - P.shotT > .6 && !lmb) startReload(); }   // empty magazine: reload by itself after a beat
    // ---- firing
    if (gun && !P.holstered && canAct) { if ((d.auto ? lmb : lmbP) && !(P.mode === 'cover' && P.modeT < .15)) playerFire(); }
    P.aimK = damp(P.aimK, aiming ? 1 : (gun && !P.holstered && S.time - P.shotT < .75 && !P.cover ? .82 : 0), aiming ? 15 : 9, dt);
    // ---- melee inputs
    const thrW = d.kind === 'throw' && !P.holstered, meleeW = (!gun || P.holstered) && !thrW;   /* SH: a grenade / molotov in the hand: the left button throws it */
    if (thrW && canAct && lmbP && P.cool <= 0 && P.drawT <= 0 && !(P.thrWind > 0)) { P.thrWind = .17; P.thrT = S.time; P.cool = .3; }   /* QA: an overhand throw: the arm goes back over the shoulder, the grenade leaves the hand on the way forward */
    if (P.thrWind > 0) { P.thrWind -= dt; if (P.thrWind <= 0) { P.thrWind = 0; if (thrW && !P.dead) throwItem(d); } } P.lock = meleeW || P.mode === 'melee' ? (meleeTarget(6.5, 1.25) || null) : null;
    if (canAct && P.mode !== 'down') {
      const behindT = () => { for (const e of enemies) { if (e.dead) continue; const dx = P.x - e.x, dz = P.z - e.z, dist = hyp(dx, dz); if (dist > 2.0) continue; const back = (sin(e.h) * dx + cos(e.h) * dz) / (dist || 1) < -.25; if ((e.state === 'stagger' || !e.alert) && back && abs(angDiff(CAM.yaw, Math.atan2(-dx, -dz))) < 1.2) return e; } return null; };
      if (IN.pressed(K.melee) && GT.act && GT.act.near && S.ctx && S.ctx.ctl && opts.ownControl && !P.swing) { const sp = GT.act.near({ x: P.x, z: P.z, y: P.y, h: P.h }, 'foot'); if (sp && sp.vehicle && sp.key === 'KeyF') { if (IN.consume) IN.consume(K.melee); P.mode = 'free'; P.aimK = 0; if (P.reload) cancelReload(); S.engT = 0; engage(false); try { sp.onUse(GT.act._ctx({ x: P.x, z: P.z, h: P.h }, 'foot')); } catch (e) { if (window.console) console.warn('[combat] enter', e); } return; } }   /* QA: F beside a car or a scooter gets in (GTA), gun in hand or not; the shove / gun-whip is F anywhere else */
      if (IN.pressed(K.melee)) { const t = behindT(); if (t) { P.lock = t; startSwing('takedown'); } else startSwing(gun && !P.holstered ? 'whip' : 'shove'); }
      else if (meleeW) { if (lmbP) { const t = behindT(); if (t) { P.lock = t; startSwing('takedown'); } else { P.charging = true; P.charge = 0; } }
        if (P.charging) { P.charge += dt; if (!lmb || P.charge > 1.1) { P.charging = false; const heavy = P.charge > .26; const seq = P.cur === 'fists' || P.holstered ? ['jab', 'cross', 'hook'] : ['l1', 'l2', 'l3']; if (S.time - P.comboT > .85) P.combo = 0;
            if (heavy) { startSwing('heavy', true); P.swing.k = .5 * sat(P.charge / .6); P.combo = 0; } else { startSwing(seq[P.combo % 3]); P.combo++; } P.charge = 0; } } }
      P.blockK = damp(P.blockK, meleeW && rmb && !P.swing ? 1 : 0, 18, dt);
    } else if (P.mode === 'melee') { if (lmbP && P.swing && P.swing.k > .3) P.queued = true; P.blockK = damp(P.blockK, 0, 18, dt); }
    // ---- cover / dodge / vault keys
    if (IN.pressed(K.cover) && (P.mode === 'free' || P.mode === 'cover')) { if (P.cover) leaveCover(); else tryCover(); }
    if (IN.pressed(K.dodge)) { if (P.mode === 'cover' && P.cover.c.low && (P.cover.c.box.x1 - P.cover.c.box.x0 < 2.2 || P.cover.c.box.z1 - P.cover.c.box.z0 < 2.2) && ax.y > .2) { const c = P.cover.c, depth = abs(c.nx) > .5 ? c.box.x1 - c.box.x0 : c.box.z1 - c.box.z0; if (depth < 2.2 && pointFree(P.x - c.nx * (depth + 1.1), P.z - c.nz * (depth + 1.1), .28, P.y)) { P.vault = { t: 0, dur: .5, x0: P.x, z0: P.z, x1: P.x - c.nx * (depth + 1.1), z1: P.z - c.nz * (depth + 1.1), h: c.h }; leaveCover(); P.mode = 'vault'; } }
      else if (P.mode === 'free' && !rmb && !P.jump) { P.jump = { v: 5.2, y: 0, vx: P.vx * 1.08, vz: P.vz * 1.08 }; P.charging = false; SND.swish(P); }   /* pt1: Space jumps here too (GTA: aim + Space is the roll); the arc is P.jump.y on top of the ground */
      else if (P.mode === 'free' && (ax.x || ax.y || P.lock)) { let mx = sin(CAM.yaw) * ax.y - cos(CAM.yaw) * ax.x, mz = cos(CAM.yaw) * ax.y + sin(CAM.yaw) * ax.x; if (!ax.x && !ax.y) { mx = -sin(P.h); mz = -cos(P.h); } const l = hyp(mx, mz) || 1; P.roll = { t: 0, dur: .62, dx: mx / l, dz: mz / l }; P.mode = 'roll'; P.iframes = .42; P.charging = false; cancelReload(); SND.swish(P); } }
    // ---- movement by mode
    let sp = 0; P.offX = P.offZ = 0; P.tiltX = 0; P.yOff = 0; P.modeT += dt;
    if (P.jump) { const J = P.jump; J.v -= 18 * dt; J.y += J.v * dt; if (P.mode !== 'free' || (J.y <= 0 && J.v < 0)) { P.jump = null; P.jumpPose = null; if (GT.audio && GT.audio.sfx && !S.headless) { try { GT.audio.sfx('land', { v: .5 }); } catch (e) {} } } else { P.yOff = J.y; P.jumpPose = { ph: 1, u: clamp(J.v / 5.2, -1, 1), run: clamp(hyp(J.vx, J.vz) / 5, 0, 1) }; } }
    const camR = { x: -cos(CAM.yaw), z: sin(CAM.yaw) }, camF = { x: sin(CAM.yaw), z: cos(CAM.yaw) };
    if (P.mode === 'free' || P.mode === 'down') {
      const mx = camF.x * ax.y + camR.x * ax.x, mz = camF.z * ax.y + camR.z * ax.x, ml = hyp(mx, mz), sprint = IN.down('ShiftLeft') && !aiming && ax.y > 0 && P.mode === 'free';
      const vmax = P.mode === 'down' ? .5 : aiming || P.blockK > .5 ? 1.75 : P.charging ? 1.2 : sprint ? 6.1 : 3.7; P.sprint = sprint;
      const tx = ml > .01 ? mx / ml * vmax : 0, tz = ml > .01 ? mz / ml * vmax : 0; P.vx = damp(P.vx, tx, 11, dt); P.vz = damp(P.vz, tz, 11, dt); P.x += P.vx * dt; P.z += P.vz * dt; collide(P, P.r); sp = hyp(P.vx, P.vz);
      const faceCam = FPC.on || aiming || P.aimK > .3 || P.blockK > .3 || P.charging; let th = P.h; if (faceCam) th = CAM.yaw; else if (P.lock && meleeW && hyp(P.lock.x - P.x, P.lock.z - P.z) < 3.5 && sp < 2) th = Math.atan2(P.lock.x - P.x, P.lock.z - P.z); else if (sp > .4) th = Math.atan2(P.vx, P.vz);
      P.h += angDiff(P.h, th) * (FPC.on ? 1 : min(1, dt * (faceCam ? 18 : 10))); P.crouchK = damp(P.crouchK, P.mode === 'down' ? 1 : 0, 10, dt);
      P.anim = P.mode === 'down' ? (P.aimK > .3 ? 'aim' : 'crouch') : P.aimK > .3 ? 'aim' : sp > 4.9 ? 'sprint' : sp > 2.3 ? 'run' : sp > .25 ? 'walk' : 'idle';
      if (P.mode === 'down') { P.down += rdt; if (P.lsKill) { P.lsKill = false; P.mode = 'free'; P.hp = 32; P.lastHitT = S.time - 3; emit('down', { revived: true }); } else if (P.down > 3.4) { P.usedLastStand = true; P.hp = 0; damagePlayer(1, null, 'bleed'); } }
    } else if (P.mode === 'cover') {
      const C = P.cover, c = C.c, along = camR.x * c.tx + camR.z * c.tz, alongF = camF.x * c.tx + camF.z * c.tz, mv = abs(along) > .35 ? ax.x * Math.sign(along) : ax.y * Math.sign(alongF || 1), away = (camF.x * ax.y + camR.x * ax.x) * c.nx + (camF.z * ax.y + camR.z * ax.x) * c.nz;
      C.s = clamp(C.s + mv * 2.1 * dt * (aiming ? .4 : 1), .28, max(.28, c.L - .28)); sp = abs(mv) * 2.1; if (away > .7) { C.awayT = (C.awayT || 0) + dt; if (C.awayT > .28) { leaveCover(); } } else C.awayT = 0;
      if (P.cover) { const nearEnd = C.s < .75 ? -1 : C.s > c.L - .75 ? 1 : 0, wantLean = aiming && nearEnd !== 0 && (!c.low || (camF.x * c.tx + camF.z * c.tz) * nearEnd > .35 || abs(camF.x * c.nx + camF.z * c.nz) < .5) ? nearEnd : 0; if (wantLean) C.leanDir = wantLean; P.leanK = damp(P.leanK, wantLean ? 1 : 0, 12, dt);
        const lx = (C.leanDir || 0) * .66 * P.leanK; P.x = c.ax + c.tx * (C.s + lx) + c.nx * .5; P.z = c.az + c.tz * (C.s + lx) + c.nz * .5; P.vx = P.vz = 0;
        const th = P.aimK > .3 || FPC.on ? CAM.yaw : Math.atan2(-c.nx + c.tx * mv * .6, -c.nz + c.tz * mv * .6); P.h += angDiff(P.h, th) * min(1, dt * 12);
        P.crouchK = damp(P.crouchK, c.low ? (aiming && !(wantLean && false) ? 0 : 1) : 0, 13, dt); P.anim = P.aimK > .35 ? 'aim' : c.low ? 'crouch' : 'lean'; }
    } else if (P.mode === 'roll') { const R_ = P.roll; R_.t += dt; const u = sat(R_.t / R_.dur), v = 7.2 * (1 - u * .75); P.x += R_.dx * v * dt; P.z += R_.dz * v * dt; collide(P, P.r); P.h = Math.atan2(R_.dx, R_.dz); P.vx = R_.dx * v; P.vz = R_.dz * v; sp = 0;
      const th = sst(u, .05, .9) * TAU, cm = .52; P.tiltX = th; P.yOff = cm * (1 - cos(th)) * .9; P.offX = -R_.dx * cm * sin(th); P.offZ = -R_.dz * cm * sin(th); P.anim = 'crouch'; P.crouchK = 1; if (u >= 1) { P.mode = 'free'; P.roll = null; P.vx *= .4; P.vz *= .4; }
    } else if (P.mode === 'vault') { const v = P.vault; v.t += dt; const u = sat(v.t / v.dur), e = u * u * (3 - 2 * u); P.x = lerp(v.x0, v.x1, e); P.z = lerp(v.z0, v.z1, e); P.yOff = sin(PI * u) * (v.h + .12); P.h = Math.atan2(v.x1 - v.x0, v.z1 - v.z0); P.anim = 'crouch'; P.crouchK = .7; sp = 0; if (u >= 1) { P.mode = 'free'; P.vault = null; }
    } else if (P.mode === 'melee') { const sw = P.swing; if (!sw) P.mode = 'free'; else { sw.k += dt / sw.dur; const sd = SWING[sw.kind]; if (P.lock && !P.lock.dead && sw.k < sd.hit) P.h += angDiff(P.h, Math.atan2(P.lock.x - P.x, P.lock.z - P.z)) * min(1, dt * 14); else if (FPC.on && !P.lock) P.h = CAM.yaw;
        if (FPC.on && P.lock && !P.lock.dead && sw.k < sd.hit) CAM.yaw += angDiff(CAM.yaw, P.h) * min(1, dt * 7);       // first person: the view is pulled round onto the man being hit
        if (sw.k < sd.hit && P.lunge) { P.x += sin(P.h) * P.lunge * dt; P.z += cos(P.h) * P.lunge * dt; collide(P, P.r); for (const e of enemies) { if (e.dead) continue; const dx = P.x - e.x, dz = P.z - e.z, dd = hyp(dx, dz); if (dd < .62 && dd > .001) { P.x = e.x + dx / dd * .62; P.z = e.z + dz / dd * .62; } } }
        if (sw.k >= sd.hit && !sw.hit) { sw.hit = true; meleeContact(); }
        if (sw.k >= 1 || (P.queued && sw.k > .78)) { P.comboT = S.time; P.swing = null; P.mode = 'free'; if (P.queued) { P.queued = false; const seq = P.cur === 'fists' || P.holstered ? ['jab', 'cross', 'hook'] : ['l1', 'l2', 'l3']; if (WD(P.cur).kind === 'melee' || P.holstered) { startSwing(seq[P.combo % 3]); P.combo++; } } }
        P.anim = 'idle'; P.vx = P.vz = 0; sp = 0; } }
    if (P.charging) { P.swing = { kind: 'heavy', k: .5 * sat(P.charge / .6), dur: 1, hit: true, def: d, hold: true }; } else if (P.swing && P.swing.hold) P.swing = null;
    if (P.jump && P.mode === 'free') P.anim = 'jump';
    P.speed = sp; P.animSpeed = sp; P.y = groundY(P.x, P.z, P.y); P.exposed = P.cover && P.aimK < .3 && P.blindK < .3 ? 0 : 1;
    // aim direction for the body (from the head toward the camera's aim point)
    _a.set(P.x, P.y + lerp(1.5, 1.0, P.crouchK), P.z); P.aimDir.copy(P.aimPt).sub(_a); if (P.aimDir.lengthSq() < 1) P.aimDir.copy(CAM.dir); P.aimDir.normalize();
    if (P.w) P.w.update(dt, { slideBack: gun && ammoOf(d.id) && ammoOf(d.id).mag === 0 && !P.reload, reloading: !!P.reload, reloadK: P.reloadK, aim: P.aimK > .5 && FPC.on });
    S.wflash = max(0, (S.wflash || 0) - dt / .045); if (GT.weapons && GT.weapons.light) GT.weapons.light(P.x, P.z, GT.env ? GT.env.night || 0 : 0, S.wflash, S.gunLight || '');   /* weapon edge light: the colours of the street the player is on + his own muzzle flash for two frames */
  }
  /** first person: eye on the head bone (offset from the feet sampled from last frame's pose, low-passed), aim ray from the eye */
  function cameraFirst(dt, rdt, cam, d, gun, aiming) {
    const fig = P.fig, R = P.rig, ctl = S.ctx && S.ctx.ctl; let tx = 0, ty = lerp(1.62, 1.12, P.crouchK), tz = 0;
    if (fig && R && R.head && !S.headless && fig.group.visible) { const e = R.head.matrixWorld.elements, g = fig.group.position; tx = e[12] + e[4] * .085 - g.x; ty = max(.3, e[13] + e[5] * .085 - g.y); tz = e[14] + e[6] * .085 - g.z; if (hyp(tx, tz) > .7 || !(ty < 2.2)) { tx = tz = 0; ty = lerp(1.62, 1.12, P.crouchK); } }
    if (P.mode === 'roll' && P.roll) { tx = tz = 0; ty = 1.6 - .7 * sin(PI * sat(P.roll.t / P.roll.dur)); } else if (P.mode === 'vault' && P.vault) { ty += P.yOff || 0; }
    const k = FPC.init ? 1 - Math.exp(-rdt * 13) : 1; FPC.init = true; FPC.ox += (tx - FPC.ox) * k; FPC.oy += (ty - FPC.oy) * k; FPC.oz += (tz - FPC.oz) * k;
    let tFov = (ctl && ctl.fpFov) || 64; if (P.sprint) tFov += 5; if (aiming) tFov = 50 / (d.zoom || 1); if (P.mode === 'down') tFov = 56; if (S.focusK > .01) tFov -= 3 * S.focusK; CAM.fov += (tFov - CAM.fov) * (1 - Math.exp(-rdt * 11));
    CAM.pitch = clamp(CAM.pitch, -1.4, 1.4); const cp = cos(CAM.pitch), dir = CAM.dir.set(sin(CAM.yaw) * cp, -sin(CAM.pitch), cos(CAM.yaw) * cp), fx = sin(CAM.yaw), fz = cos(CAM.yaw), down = sst(CAM.pitch, .2, 1.3), fwd = .1 + .11 * down;
    let ex = P.x + FPC.ox + fx * fwd, ez = P.z + FPC.oz + fz * fwd; const ey = P.y + FPC.oy - .045 * down;
    { const lx = ex - P.x, lz = ez - P.z, L = hyp(lx, lz); if (L > .01) { const h = rayBoxes(P.x, ey, P.z, lx / L, 0, lz / L, L + .17, 2); if (h && h.t - .17 < L) { const q = max(0, h.t - .17) / L; ex = P.x + lx * q; ez = P.z + lz * q; } } }       // the lens stays clear of walls
    CAM.pos.set(ex, ey, ez); FPC.r.crossVectors(dir, UP).normalize(); FPC.u.crossVectors(FPC.r, dir);
    FPC.swx = damp(FPC.swx, clamp(IN.look.dx * 5, -.03, .03), 9, rdt); FPC.swy = damp(FPC.swy, clamp(IN.look.dy * 5, -.03, .03), 9, rdt);
    // aim ray from the eye
    const ox = ex + dir.x * .1, oy = ey + dir.y * .1, oz = ez + dir.z * .1; let best = 160; P.onTarget = null;
    const w = rayBoxes(ox, oy, oz, dir.x, dir.y, dir.z, best, 0); if (w) best = w.t; if (dir.y < -1e-4) { const t = (P.y - oy) / dir.y; if (t > 0 && t < best) best = t; }
    for (const e of enemies) { if (e.dead) continue; const ha = hitActor(e, ox, oy, oz, dir.x, dir.y, dir.z, best); if (ha) { best = ha.t; P.onTarget = e; P.onZone = ha.zone; } }
    P.aimPt.set(ox + dir.x * best, oy + dir.y * best, oz + dir.z * best);
    if (!cam || !S.autoCam) return;
    if (S.hitcam) { const hc = S.hitcam, e = hc.e, u = sat(hc.t / hc.dur), a = hc.a0 + u * .9, r = lerp(3.4, 2.5, u); cam.position.set(e.x + sin(a) * r, e.y + lerp(1.5, 1.0, u), e.z + cos(a) * r); if (rayBoxes(e.x, e.y + 1.3, e.z, sin(a), 0, cos(a), r + .3, 2)) { cam.position.set(e.x - sin(a) * r, e.y + 1.3, e.z - cos(a) * r); }
      cam.lookAt(e.x, e.y + lerp(1.15, .5, sst(u, .2, 1)), e.z); if (cam.fov !== 40) { cam.fov = 40; cam.updateProjectionMatrix(); } return; }
    cam.position.copy(CAM.pos); _a.copy(CAM.pos).add(dir); cam.up.set(0, 1, 0); cam.lookAt(_a);
    const sh = S.shake * S.shake, t = S.real * 37; if (sh > .0005 || abs(S.punch.x) > .0005 || abs(S.punch.y) > .0005) { cam.rotateX(S.punch.x + sh * .014 * sin(t * 1.3)); cam.rotateY(S.punch.y + sh * .012 * sin(t * 1.7 + 1)); cam.rotateZ(sh * .014 * sin(t * 2.1 + 2)); }
    if (abs(cam.fov - CAM.fov) > .01) { cam.fov = CAM.fov; cam.updateProjectionMatrix(); }
  }
  /** own over-the-shoulder camera + the aim ray */
  function cameraUpdate(dt, rdt) {
    const cam = S.cam, d = curDef(), gun = d.kind === 'gun' && !P.holstered, aimK = sst(P.aimK, 0, 1), aiming = IN.down('Mouse1') && gun, fp = fpView(); FPC.on = fp; if (!fp) FPC.init = false;
    S.scoped = aiming && !P.dead && !!P.w && P.w.optic === 'scope' && P.aimK > .6 && !S.wheelOpen && !S.hitcam;   /* QA: a scope aimed, in either view, is the picture through the glass from the eye (GTA-style) */
    if (P.dead) { FPC.on = false; FPC.init = false; S.scoped = false; return deathCam(rdt, cam); }   /* QA: dead = a third-person death camera in either view (first person used to stay in the head and look at the shoes) */
    if (fp || S.scoped) return cameraFirst(dt, rdt, cam, d, gun, aiming);
    let tDist = 2.75, tSide = .46, tFov = 56; if (P.mode === 'cover') { tDist = 3.05; tSide = .6; tFov = 54; } if (P.sprint) { tDist += .3; tFov += 3; } if (P.mode === 'melee' || (P.lock && !gun)) { tDist = 3.1; tSide = .34; }
    if (aiming) { tDist = 1.72; tSide = .6; tFov = 46 / (d.zoom || 1); } if (P.mode === 'down') { tDist = 2.2; tFov = 50; } if (S.focusK > .01) tFov -= 3 * S.focusK;
    const k = CAM.init ? 1 - Math.exp(-rdt * 11) : 1; CAM.init = true; CAM.dist += (tDist - CAM.dist) * k; CAM.side += (tSide * CAM.shoulder - CAM.side) * k; CAM.fov += (tFov - CAM.fov) * k;
    if (P.cover && !P.cover.c.low && P.cover.leanDir && P.leanK > .3) { const want = (-cos(CAM.yaw) * P.cover.c.tx + sin(CAM.yaw) * P.cover.c.tz) * P.cover.leanDir > 0 ? 1 : -1; if (want !== CAM.shoulder) CAM.shoulder = want; }
    const cp = cos(CAM.pitch), dir = CAM.dir.set(sin(CAM.yaw) * cp, -sin(CAM.pitch), cos(CAM.yaw) * cp), rx = -cos(CAM.yaw), rz = sin(CAM.yaw), by = P.y + lerp(1.56, 1.08, P.crouchK) + (P.mode === 'roll' ? -.25 : 0) + (P.dead ? -.8 * sst(P.fallT || 0, 0, .8) : 0);
    const px = P.x + rx * CAM.side * .55, pz_ = P.z + rz * CAM.side * .55, tx = P.x + rx * CAM.side - dir.x * CAM.dist, ty = by + .1 - dir.y * CAM.dist, tz = P.z + rz * CAM.side - dir.z * CAM.dist;
    let dx = tx - px, dy = ty - (by + .1), dz = tz - pz_, L = hyp(dx, dy, dz), f = 1; const h = rayBoxes(px, by + .1, pz_, dx / L, dy / L, dz / L, L + .25, 2); if (h) f = max(.12, (h.t - .22) / L);
    { const cb = S.sc && S.sc.camBox; if (cb && P.x > cb.x0 && P.x < cb.x1 && P.z > cb.z0 && P.z < cb.z1) { if (dx > 1e-4) f = min(f, (cb.x1 - px) / dx); else if (dx < -1e-4) f = min(f, (cb.x0 - px) / dx); if (dz > 1e-4) f = min(f, (cb.z1 - pz_) / dz); else if (dz < -1e-4) f = min(f, (cb.z0 - pz_) / dz); if (cb.y1 !== undefined && dy > 1e-4) f = min(f, (cb.y1 - by - .1) / dy); f = max(.1, f); } }   // rooms whose walls have no colliders (balustrades, grilles): keep the camera inside
    CAM.pos.set(px + dx * f, max(P.y + .3, by + .1 + dy * f), pz_ + dz * f);
    // aim ray: starts at the player's depth so nothing between camera and shoulder is hit
    const depth = max(.3, (P.x - CAM.pos.x) * dir.x + (by - CAM.pos.y) * dir.y + (P.z - CAM.pos.z) * dir.z) + .35, ox = CAM.pos.x + dir.x * depth, oy = CAM.pos.y + dir.y * depth, oz = CAM.pos.z + dir.z * depth; let best = 160; P.onTarget = null;
    const w = rayBoxes(ox, oy, oz, dir.x, dir.y, dir.z, best, 0); if (w) best = w.t; if (dir.y < -1e-4) { const t = (P.y - oy) / dir.y; if (t > 0 && t < best) best = t; }
    for (const e of enemies) { if (e.dead) continue; const ha = hitActor(e, ox, oy, oz, dir.x, dir.y, dir.z, best); if (ha) { best = ha.t; P.onTarget = e; P.onZone = ha.zone; } }
    P.aimPt.set(ox + dir.x * best, oy + dir.y * best, oz + dir.z * best);
    if (P.onTarget && best < .3) { const e = P.onTarget; P.aimPt.set(e.x, e.y + lerp(e.ht, e.ht * .6, e.crouchK || 0) * .72, e.z); }   // point blank: aim at the body, not at the degenerate start of the ray
    if (!cam || !S.autoCam) return;
    if (S.hitcam) { const hc = S.hitcam, e = hc.e, u = sat(hc.t / hc.dur), a = hc.a0 + u * .9, r = lerp(3.4, 2.5, u); cam.position.set(e.x + sin(a) * r, e.y + lerp(1.5, 1.0, u), e.z + cos(a) * r); if (rayBoxes(e.x, e.y + 1.3, e.z, sin(a), 0, cos(a), r + .3, 2)) { cam.position.set(e.x - sin(a) * r, e.y + 1.3, e.z - cos(a) * r); }
      cam.lookAt(e.x, e.y + lerp(1.15, .5, sst(u, .2, 1)), e.z); if (cam.fov !== 40) { cam.fov = 40; cam.updateProjectionMatrix(); } return; }
    cam.position.copy(CAM.pos); _a.copy(CAM.pos).add(dir); cam.up.set(0, 1, 0); cam.lookAt(_a);
    const sh = S.shake * S.shake, t = S.real * 37; if (sh > .0005 || abs(S.punch.x) > .0005 || abs(S.punch.y) > .0005) { cam.rotateX(S.punch.x + sh * .02 * sin(t * 1.3)); cam.rotateY(S.punch.y + sh * .018 * sin(t * 1.7 + 1)); cam.rotateZ(sh * .02 * sin(t * 2.1 + 2)); }
    if (abs(cam.fov - CAM.fov) > .01) { cam.fov = CAM.fov; cam.updateProjectionMatrix(); }
  }

  /* ================================================================== enemies */
  const KINDS = {
    thug:   { fig: [['ped', { type: 'thug', phone: false }], ['ped', { type: 'skater', phone: false }]], weapon: 'pipe', hp: 80, speed: 4.7, melee: true, who: '马仔' },
    gunman: { fig: [['ped', { type: 'thug', phone: false }], ['partner', { mask: false, bag: false, color: 0x3a3f46 }]], weapon: 'pistol', hp: 80, speed: 4.3, who: '枪手', minErr: .016 },
    heavy:  { fig: [['ped', { type: 'ertong', phone: false }], ['partner', { mask: true, bag: false, color: 0x30352c, height: 1.94 }]], weapon: 'shotgun', hp: 240, speed: 3.1, who: '二筒', minErr: .03, heavy: true },
    cop:    { fig: [['ped', { type: 'traffic_police', phone: false }], ['cop', {}]], weapon: 'pistol', hp: 100, speed: 4.4, who: '警察', minErr: .012, cop: true },
    cop2:   { fig: [['ped', { type: 'traffic_police', phone: false }], ['cop', {}]], weapon: 'shotgun', hp: 130, speed: 4.2, who: '警察', minErr: .02, cop: true }   /* the shotgun officer of a high wanted level (hosts spawn kind 'cop2') */
  };
  const BARK = { alert: ['就是他！', '他在那边！', '动手！', '抄家伙！'], cop: ['警察！别动！', '放下！趴下！'], arrest: ['警察！别动！', '站住！别跑！', '趴下！手放在头上！', '你被捕了！', '别反抗！'], copfight: ['他袭警！', '开枪！他动手了！', '放下武器！'], peek: ['掩护我！', '我来压他！', '盯住那个箱子！'], flank: ['绕过去！', '我从侧面上！'], reload: ['换弹！', '换弹匣！'], hurt: ['哎哟——！', '嘶——！'],
    down: ['有人倒了！', '这小子什么来头！', '小心，他枪法准！'], suppress: ['别让他露头！', '压住他！'], retreat: ['撤！往后撤！', '顶不住了！'], lamp: ['灯灭了！看不见！'], heavy: ['都让开，我来。', '小子，你完了。'], give: ['别打了！我不干了！', '大哥，我就是打工的！'], melee: ['来啊！', '把钱留下！', '打断你的腿！'], lost: ['人呢？', '他躲哪去了？'] };
  let barkT = -9;
  function say(who, text, sec) { if (S.headless) return; if (hook('say', who, text) !== undefined || (S.hooks && S.hooks.say)) return; if (GT.front && GT.front.subtitle && !opts.ownSubs) { try { GT.front.subtitle(who, text, sec); return; } catch (e) {} } HUD.sub(who, text, sec); }
  function bark(e, key, force) { if (opts.barks === false) return;   /* a scripted lesson keeps the subtitle for its coach */ if (!force && S.time - barkT < 1.7) return; const L = BARK[key]; if (!L) return; barkT = S.time; e.barkN = (e.barkN || 0) + 1; say(e.who || KINDS[e.kind].who /* e.who: a caller-given name (js/street.js 阿豹) */, L[(e.seed + e.barkN + ((S.time * 3) | 0)) % L.length], 1.6); }
  let eid = 0;
  function spawn(kind, x, z, o) {
    o = o || {}; const KD = KINDS[kind] || KINDS.gunman; kind = KINDS[kind] ? kind : 'gunman'; const seed = o.seed === undefined ? eid * 7 + 3 : o.seed, wid = o.weapon || KD.weapon;
    const e = { id: ++eid, kind, KD, post: !!o.post, x, z, y: o.y !== undefined ? o.y : groundY(x, z), h: o.h || 0, r: .3, ht: 1.8, hp: o.hp || KD.hp, maxHp: o.hp || KD.hp, state: 'idle', t: 0, aware: 0, alert: false, alertAt: -1, lastSeen: null, sees: false, seeT: 0, cover: null, dest: null, next: null, aimErr: .11, mag: 0, burst: 0, shotCool: 0, morale: 1, group: o.group || 'a',
      aimK: 0, crouchK: 0, anim: o.anim || 'idle', animSpeed: 0, stagK: 0, stagAcc: 0, blockK: 0, blockT: 0, prone: false, dead: false, token: null, ai: o.ai || null, patrol: o.patrol || null, pi: 0, home: { x, z }, seed, melee: !!KD.melee, aimDir: V3(sin(o.h || 0), 0, cos(o.h || 0)), speed: KD.speed, vx: 0, vz: 0, pushX: 0, pushZ: 0, stuckT: 0, lastX: x, lastZ: z, tiltX: 0, tiltZ: 0, yOff: 0, intent: '', isEnemy: true, out: false, inst: {}, swing: null, reloadK: 0, recoilK: 0, hidden: !!o.hidden, noHeat: !!o.noHeat, arrest: !!o.arrest, lethal: !o.arrest };   /* pt1: noHeat — the host keeps the stars (free-roam officers); arrest — a street officer who closes in to cuff, and only shoots once lethal */
    if (!S.headless && GT.people) { try { const types = GT.people.pedTypes, f = KD.fig.find(q => !q[1].type || !types || types.includes(q[1].type)) || KD.fig[KD.fig.length - 1], fo = Object.assign({ seed: seed % 9 }, f[1]); if (o.color !== undefined) fo.color = o.color; e.fig = GT.people.make(f[0], fo); e.rig = rigOf(e.fig); e.ht = e.fig.height || 1.8; S.root.add(e.fig.group); e.fig.group.visible = !e.hidden; } catch (er) { e.fig = null; if (window.console) console.warn('[combat] figure', er); } }
    armActor(e, wid, true); e.def = WD(wid); e.mag = e.def.mag || 0; if (e.def.kind !== 'gun') e.melee = true; if (o.alert) setAlert(e, true); enemies.push(e); poseActor(e, 0); return e; }
  function freeTokens(e) { if (e.token) { S.tokens[e.token] = max(0, S.tokens[e.token] - 1); e.token = null; } if (e.cover) { if (e.cover.user === e) e.cover.user = null; } if (S.flanker === e) S.flanker = null; }
  function setAlert(e, quiet) { if (e.alert || e.dead) return; e.alert = true; e.aware = 1; e.state = 'react'; e.t = (.35 + rnd() * .45) * (quiet ? .5 : 1); if (!e.lastSeen) e.lastSeen = { x: P.x, z: P.z, t: S.time }; if (!quiet) bark(e, e.KD.cop ? 'cop' : 'alert'); if (e.KD.cop && !e.noHeat) heat(1, 'police', true);
    for (const o of enemies) if (o !== e && !o.alert && !o.dead && o.group === e.group && hyp(o.x - e.x, o.z - e.z) < 34) o.alertAt = S.time + .35 + rnd() * .9; emit('alert', { e }); }
  function groupMorale(g, d) { for (const o of enemies) if (!o.dead && o.group === g) o.morale = clamp(o.morale + d * (o.KD.heavy ? .4 : 1), 0, 1); }
  function downEnemy(e, dir, ko, head) { if (e.dead) return; e.dead = true; e.ko = !!ko; e.state = 'dead'; e.alert = true; freeTokens(e); const fwd = dir ? sin(e.h) * dir.x + cos(e.h) * dir.z : -1; let fd = fwd > 0 ? 1 : -1;
    /* he falls where there is floor: the body lies along e.h (centre .9 m, head 1.6 m out); the hit's own direction first, then the other way, then turned — not through the stools and under the table (play report b3-story2 issue 8) */
    { const lane = (d, dh) => { const hh = e.h + dh; for (const u of [.75, 1.25, 1.7]) if (!pointFree(e.x + sin(hh) * d * u, e.z + cos(hh) * d * u, .22, e.y)) return false; return true; }; let ok = false; for (const [d, dh] of [[fd, 0], [-fd, 0], [fd, .8], [fd, -.8], [-fd, .8], [-fd, -.8], [fd, 1.57], [fd, -1.57]]) if (lane(d, dh)) { fd = d; e.h += dh; ok = true; break; } }
    e.fall = { t: 0, dir: fd, roll: (rnd() - .5) * .5, knee: .1 + rnd() * .22 }; e.aimK = 0; e.swing = null; e.blockK = 0; e.out = true;
    /* QA: the dead leave what was in their pockets and the weapon in the hand, tossed out beside the body (GTA-style loot: walk over it). An officer always drops his pistol and a spare magazine. */
    { const cash = !e.noDrop && !e.noCash && !ko ? Math.round((e.KD && e.KD.heavy ? 90 : e.KD && e.KD.cop ? 40 : 25) + rnd() * 110) : 0, wid = !e.noDrop && e.wid && e.wid !== 'fists' && WD(e.wid) && WD(e.wid).id === e.wid && (e.w || e.KD.cop) ? e.wid : null, gun = wid && WD(wid).kind === 'gun';
      const dx = dir ? dir.x : 0, dz = dir ? dir.z : 0; if (cash || wid) { try { loot(e.x, e.z, e.y, { cash, weapon: wid, ammo: gun ? max(8, (e.mag || 0) + 6) + (e.KD.heavy ? 6 : 0) + (e.KD.cop ? WD(wid).mag || 12 : 0) : undefined, dx, dz }); } catch (err) { if (window.console) console.warn('[combat] loot', err); } }
      if (gun && e.w) { disarmActor(e); e.w = null; } else if (wid && e.w) { disarmActor(e); e.w = null; } }
    if (!ko) { stats.kills++; if (head) stats.headshots++; } groupMorale(e.group, -.17); if (P.mode === 'down') P.lsKill = true; P.focus = min(1, P.focus + .22); hook('onEnemyDown', e); emit('kill', { e, head: !!head, ko: !!ko }); if (e.KD.cop && !ko) { heat(2, '击毙警察', true); copsLethal(); }
    if (!S.headless) SND.mech('kill', null); const left = enemies.filter(o => !o.out && o.alert); for (const o of left) if (o.group === e.group && rnd() < .5) { bark(o, 'down'); break; }
    if (!left.length && enemies.filter(o => !o.out).length === 0 && enemies.length > 1 && !ko && !S.noHitcam && (!S.sc || S.sc.lastWave !== false)) { S.hitcam = { e, t: 0, dur: 1.7, a0: Math.atan2(CAM.pos.x - e.x, CAM.pos.z - e.z) + .5 }; emit('hitcam', { e }); } }
  const koEnemy = (e, dir) => downEnemy(e, dir, true, false);
  function damageEnemy(e, dmg, zone, dir, def, src, m) {
    if (e.dead) return; const focus = S.focusK > .5 && def && src === P; let lethal = false, head = zone === 'head';
    if (src === P && def) { stats.hits++; dmg *= P.bonus; }
    if (head) { dmg *= def ? (e.KD.heavy ? min(1.7, def.head) : def.head) : 1.5; if ((focus || (def && def.kind === 'gun' && !def.tool && src === P)) && !e.KD.heavy) lethal = true;   /* a bullet in the head ends it (armoured heavies excepted) */ } else if (zone === 'legs') { dmg *= .75; if (focus) { e.stagAcc += 2.2; } else e.stagAcc += def ? def.dmg / 60 : 0; } else if (zone === 'arm') { dmg *= .6; if ((focus || rnd() < .25) && !e.melee && !e.KD.heavy) disarm(e); }
    e.hp -= lethal ? 9999 : dmg; e.stagK = max(e.stagK, m ? .9 : .45); e.aimErr = min(.16, e.aimErr + .05); e.morale = max(0, e.morale - dmg / e.maxHp * .35); if (!e.alert) { e.lastSeen = { x: P.x, z: P.z, t: S.time }; setAlert(e); }
    if (m) { e.stagAcc += m.stagger; e.pushX = dir.x * m.push; e.pushZ = dir.z * m.push; }
    if (def && def.stag && !m) { e.stagAcc += def.stag; e.aimErr = .16; }   /* a face full of extinguisher powder: blinded, staggering */
    if (src === P) P.focus = min(1, P.focus + (def ? .07 : .05)); emit('hit', { e, zone, dmg });
    if (src === P && e.KD.cop && !e.dead && e.hp > 0) { if (!S.copHitT || S.time - S.copHitT > 2.5) { S.copHitT = S.time; heat(1, '袭警', true); } if (!e.lethal) { copsLethal(); bark(e, 'copfight', true); } }   /* pt1: hitting an officer is assault at once — a star, and every officer on foot stops cuffing and fights */
    if (e.hp <= 0) { downEnemy(e, dir, false, head); return; }
    if (e.stagAcc >= 2 && e.state !== 'down') { e.stagAcc = 0; freeTokens(e); e.state = 'down'; e.t = 2.3; e.fall = { t: 0, dir: -1, roll: 0, knee: .5 }; e.prone = true; e.swing = null; }
    else if (e.stagAcc >= 1 && e.state !== 'stagger' && e.state !== 'down') { e.stagAcc = 0; freeTokens(e); e.prev = e.melee ? 'chase' : 'react'; e.state = 'stagger'; e.t = 1.15; e.swing = null; }
    else if (rnd() < .3) bark(e, 'hurt'); }
  function disarm(e) { if (e.melee) return; dropPickup(e.wid, e.x + sin(e.h) * .6, e.z + cos(e.h) * .6, e.y, max(4, e.mag)); disarmActor(e); e.w = null; e.wid = 'fists'; e.def = WD('fists'); e.melee = true; e.aimK = 0; freeTokens(e); emit('disarm', { e }); if (e.morale < .6 || rnd() < .5) { e.state = 'cower'; e.out = true; bark(e, 'give', true); } else { e.state = 'chase'; e.speed = 4.6; } }
  /** steer an enemy toward a point with sliding collision + separation; returns distance left */
  function moveTo(e, tx, tz, speed, dt, faceX, faceZ) { const dx = tx - e.x, dz = tz - e.z, d = hyp(dx, dz); if (d < .05) { e.animSpeed = 0; return d; } const v = min(speed, d / max(dt, 1e-3)); let vx = dx / d * v, vz = dz / d * v;
    for (const o of enemies) { if (o === e || o.dead) continue; const ox = e.x - o.x, oz = e.z - o.z, od = hyp(ox, oz); if (od < .9 && od > .001) { vx += ox / od * (0.9 - od) * 4; vz += oz / od * (0.9 - od) * 4; } }
    e.x += vx * dt; e.z += vz * dt; collide(e, e.r); e.animSpeed = v; const th = faceX !== undefined ? Math.atan2(faceX - e.x, faceZ - e.z) : Math.atan2(vx, vz); e.h += angDiff(e.h, th) * min(1, dt * 10);
    e.stuckT += dt; if (e.stuckT > .8) { const moved = hyp(e.x - e.lastX, e.z - e.lastZ); e.stuck = moved < speed * .8 * .25; e.lastX = e.x; e.lastZ = e.z; e.stuckT = 0; if (e.stuck) { e.sideT = .7; e.sideDir = rnd() < .5 ? 1 : -1; } }
    if (e.sideT > 0) { e.sideT -= dt; e.x += -dz / d * e.sideDir * speed * .9 * dt; e.z += dx / d * e.sideDir * speed * .9 * dt; collide(e, e.r); }
    return d; }
  function chooseCover(e, intent) { const T_ = e.lastSeen || P, cs = buildCovers((e.x + T_.x) / 2, (e.z + T_.z) / 2, 46, e.y), curD = hyp(e.x - T_.x, e.z - T_.z); let best = null, bs = -1e9;
    const pex = (e.x - T_.x) / (curD || 1), pez = (e.z - T_.z) / (curD || 1), bb = S.sc && S.sc.bounds;
    for (const c of cs) { if (bb && (c.x < bb.x0 || c.x > bb.x1 || c.z < bb.z0 || c.z > bb.z1)) continue; if (c.user && c.user !== e && !c.user.dead) continue; if (c.bad && c.bad > S.time) continue; if (enemies.some(o => o !== e && !o.dead && o.cover && abs(o.cover.x - c.x) < .8 && abs(o.cover.z - c.z) < .8)) continue; const dT = hyp(c.x - T_.x, c.z - T_.z), d = hyp(c.x - e.x, c.z - e.z); if (dT < (e.KD.heavy ? 4 : 6) || dT > 48 || d > 34 || abs(c.y - e.y) > .9) continue; if (!coverHides(c, T_.x, T_.z, P.y)) continue;
      let sc = walkClear(e.x, e.z, c.x, c.z, e.y) ? 0 : -9; if (c.low) sc += 1.2; const ideal = e.KD.heavy ? 9 : e.def.id === 'smg' ? 12 : 15;
      if (intent === 'advance') { if (dT > curD - 2.5) continue; sc += -abs(dT - ideal * .6) * .5 - d * .2; } else if (intent === 'retreat') { if (dT < curD + 3) continue; sc += dT * .4 - d * .25; }
      else if (intent === 'flank') { const cx = (c.x - T_.x) / dT, cz = (c.z - T_.z) / dT, lat = abs(pex * cz - pez * cx); if (lat < .35) continue; sc += lat * 9 - d * .15 - abs(dT - 11) * .3; } else sc += -d * .6 - abs(dT - ideal) * .25;
      if (sc > bs) { bs = sc; best = c; } }
    if (best) { if (e.cover && e.cover.user === e) e.cover.user = null; best.user = e; e.cover = best; e.intent = intent || 'cover'; } return best; }
  function enemyFire(e, canSee) { const def = e.def; if (e.mag <= 0) return false; e.mag--; const mz = muzzleOf(e, _f), hidden = !canSee || !P.exposed; let tx = P.x, ty = P.y + lerp(1.3, .75, P.crouchK), tz = P.z; if (!canSee && e.lastSeen) { tx = e.lastSeen.x; tz = e.lastSeen.z; ty = P.y + 1.0; }
    const dark = S.dark || 0, err = (e.aimErr + P.speed * .006 + (P.mode === 'roll' ? .06 : 0)) * (hidden ? 1.6 : 1) * (1 + dark * .8) / max(.6, opts.difficulty) * (S.sc && S.time < (S.sc.graceTo || 0) ? 3.6 : 1); _e.set(tx - mz.x, ty - mz.y, tz - mz.z).normalize(); e.aimDir.copy(_e);
    tr.o.copy(mz); discharge(e, tr.o, _e, def, err + (def.pellets > 1 ? def.aim : 0)); e.recoilK = 1; e.quietT = 0; e.aimErr = min(.16, e.aimErr + .01); if (e.KD.cop && !e.noHeat) heat(1, 'police', false); return true; }
  /* pt1: free-roam officers (cngame spawns them with arrest: true at low heat): they run him down and hold him at arm's length, gun pointed but quiet; copsLethal() turns all of them into
     the ordinary gunman brain (cover, bursts) — assault on an officer, a gun out in front of them, a shot fired, three stars. removeEnemy: a unit that drives off takes its officers back. */
  function copsLethal() { for (const o of enemies) if (o.KD.cop && !o.dead && !o.lethal) { o.lethal = true; if (o.state === 'arrest' || o.state === 'grab') { o.state = 'react'; o.t = .2 + rnd() * .3; } } }
  function removeEnemy(e) { const i = enemies.indexOf(e); if (i < 0) return false; freeTokens(e); if (e.fig && e.fig.group.parent) e.fig.group.parent.remove(e.fig.group); if (e.w && e.w.group && e.w.group.parent) e.w.group.parent.remove(e.w.group); enemies.splice(i, 1); if (P.lock === e) P.lock = null; if (P.onTarget === e) P.onTarget = null; return true; }
  const playerAttacking = () => !!(P.swing || P.charging || P.mode === 'melee' || P.mode === 'roll' || S.time - (P.shotT || -9) < 1.2 || S.time - (S.copHitT || -9) < 1.5);
  function enemyUpdate(e, dt) {
    const KD = e.KD; e.y = groundY(e.x, e.z, e.y); e.recoilK = max(0, e.recoilK - dt * 7); e.stagK = max(0, e.stagK - dt * 1.6); e.shotCool = max(0, e.shotCool - dt);
    if (e.pushX || e.pushZ) { e.x += e.pushX * dt; e.z += e.pushZ * dt; collide(e, e.r); const k = Math.exp(-dt * 7); e.pushX *= k; e.pushZ *= k; if (abs(e.pushX) + abs(e.pushZ) < .05) e.pushX = e.pushZ = 0; }
    if (e.fall) { const F = e.fall; F.t += dt; const getup = e.state === 'getup'; let k = sst(F.t, 0, .62); k = k + sin(sat((F.t - .62) / .3) * PI) * -.04; if (getup) k = 1 - sst(e.gt = (e.gt || 0) + dt, 0, .7);
      e.tiltX = F.dir * (HP - .07) * k; e.tiltZ = F.roll * k; e.yOff = .11 * k; e.kneeK = F.knee * k; e.crouchK = 0; e.prone = k > .5; if (F.nat === undefined) F.nat = !!(e.rig && !e.rig.hero && F.dir < 0 && e.rig.states && e.rig.states.includes('fall')); e.anim = F.dir < 0 && !(F.nat && getup) ? 'fall' : 'idle'; e.animSpeed = 0; if (F.t > .55 && !F.thud) { F.thud = true; SND.body(e); FX.sprite({ pos: _a.set(e.x - sin(e.h) * F.dir * -.9, e.y + .1, e.z - cos(e.h) * F.dir * -.9), tex: 'smoke', life: .9, size: .5, grow: .8, a: .28, r: FX.amb() * .8, vel: _b.set(0, .25, 0) }); }
      if (e.dead) { if (F.t > 1.8 && !e.frozen) { poseActor(e, dt); e.frozen = true; if (e.fig && e.fig.group) e.fig.group.traverse(o => { if (o.isMesh) o.frustumCulled = false;   /* a lying body is far outside its standing bounds: the skinned torso must not be culled while the rigid parts stay */ }); } return; } }
    if (e.dead) return;
    // ---- perception
    const dx = P.x - e.x, dz = P.z - e.z, dist = hyp(dx, dz), dark = S.dark || 0, vis = (e.alert ? 75 : 30) * (1 - dark * .45), eyeY = e.y + lerp(1.55, 1.0, e.crouchK), py = P.y + lerp(1.45, .78, P.crouchK); let canSee = false;
    if (!P.dead && dist < vis && e.state !== 'down' && e.state !== 'cower' && !e.hidden) { const inCone = e.alert || abs(angDiff(e.h, Math.atan2(dx, dz))) < 1.05 || dist < 2.2; if (inCone) canSee = los(e.x, eyeY, e.z, P.x, py, P.z) || (P.exposed && los(e.x, eyeY, e.z, P.x, P.y + lerp(1.7, 1.0, P.crouchK), P.z)); }
    e.sees = canSee; if (canSee) { e.seeT += dt; e.lastSeen = { x: P.x, z: P.z, t: S.time }; if (!e.alert) { e.aware += dt * clamp(2.6 - dist / 14, .35, 3) * (P.crouchK > .5 ? .55 : 1) * (1 - dark * .5); if (e.aware >= 1) setAlert(e); } else e.aimErr = max((KD.minErr || .02) * (1 + dark), e.aimErr - dt * .034 * (P.exposed ? 1 : .3)); }
    else { e.seeT = 0; if (!e.alert) e.aware = max(0, e.aware - dt * .25); else e.aimErr = min(.12, e.aimErr + dt * .02); }
    if (!e.alert) { for (const n of S.noise) if (S.time - n.t < .2 && n.by === P && hyp(n.x - e.x, n.z - e.z) < n.r && e.alertAt < 0) { e.alertAt = S.time + .25 + rnd() * .5; e.lastSeen = { x: n.x, z: n.z, t: S.time }; } if (e.alertAt > 0 && S.time >= e.alertAt) setAlert(e); }
    if (e.ai === 'dummy') { e.anim = e.alert ? (e.KD.melee ? 'idle' : 'aim') : 'idle'; e.aimK = damp(e.aimK, e.alert && !e.melee ? 1 : 0, 8, dt); if (e.alert) { e.h += angDiff(e.h, Math.atan2(dx, dz)) * min(1, dt * 6); e.aimDir.set(dx, py - eyeY, dz).normalize(); } if (e.state === 'stagger') { e.t -= dt; if (e.t <= 0) e.state = 'idle'; } else if (e.state === 'down') { e.t -= dt; if (e.t <= 0) { e.state = 'getup'; e.gt = 0; } } else if (e.state === 'getup' && e.gt > .7) { e.state = 'idle'; e.fall = null; e.tiltX = e.tiltZ = e.yOff = 0; e.kneeK = 0; e.prone = false; } return; }
    if (e.alert && !e.melee && e.state !== 'cower' && e.state !== 'down' && e.state !== 'stagger' && e.state !== 'getup' && e.state !== 'reload' && e.state !== 'hunt' && !P.dead) { e.quietT = (e.quietT || 0) + dt;
      if (e.quietT > (canSee ? 7 : 11)) { e.quietT = 0; freeTokens(e); const lastOne = enemies.filter(o => !o.out).length === 1;
        if (lastOne && !KD.heavy && !KD.cop && e.morale < .5 && !canSee) { e.state = 'cower'; e.out = true; bark(e, 'give', true); }
        else if (e.post) { e.state = 'aimup'; e.t = .4; e.open = false; e.peek = null; e.suppressing = !canSee; }
        else { e.cover = null; e.state = 'hunt'; e.t = 14; bark(e, 'flank'); } } } else if (e.melee || !e.alert) e.quietT = 0;
    if (KD.cop && e.arrest && !e.lethal && e.alert) { const gunOut = !P.holstered && curDef().kind === 'gun'; if ((gunOut && canSee && dist < 30) || (S.noise.some(n => n.by === P && n.kind === 'shot' && hyp(n.x - e.x, n.z - e.z) < n.r))) { copsLethal(); bark(e, 'copfight', true); }   /* a gun drawn in front of him, or a shot he heard */
      else if (!P.dead && e.state !== 'stagger' && e.state !== 'down' && e.state !== 'getup' && e.state !== 'arrest' && e.state !== 'grab') { freeTokens(e); e.cover = null; e.state = 'arrest'; e.t = 0; } }
    if (e.recall && e.state !== 'down' && e.state !== 'getup' && e.state !== 'stagger') { if (e.state !== 'recall') freeTokens(e); e.state = 'recall'; } else if (!e.recall && e.state === 'recall') { e.state = 'react'; e.t = .2; }
    const S_ = e.state; e.t -= dt; let wantAim = 0, wantCrouch = 0, anim = 'idle'; e.animSpeed = 0;
    const face = (x, z, rate) => { e.h += angDiff(e.h, Math.atan2(x - e.x, z - e.z)) * min(1, dt * (rate || 8)); };
    const T_ = e.lastSeen || P;
    if (!e.melee && e.alert && canSee && dist < 4.6 && e.mag > 0 && e.shotCool <= 0 && !e.hold && !P.dead && (S_ === 'cover' || S_ === 'back' || S_ === 'move' || S_ === 'react' || S_ === 'hunt' || S_ === 'strafe')) { face(P.x, P.z, 30); enemyFire(e, true); e.shotCool = .5; e.aimK = max(e.aimK, .8); }   /* nobody with a gun lets a man walk up and swing a helmet at him */
    if (S_ === 'recall') { const d = moveTo(e, e.recall.x, e.recall.z, e.speed, dt); anim = 'run'; if (d < 1.3) e.boarded = true; }   /* pt1: back to the unit (cngame removes him once he is in) */
    else if (S_ === 'arrest' || S_ === 'grab') { const tx = canSee ? P.x : T_.x, tz = canSee ? P.z : T_.z;   /* pt1: close in on him and hold him at arm's length (cngame counts the hold and makes the arrest) */
      if (dist > 1.45 || P.dead) { if (S_ === 'grab') e.state = 'arrest'; const v = dist > 5 ? e.speed * 1.08 : 2.8; moveTo(e, tx, tz, v, dt, dist < 5 ? P.x : undefined, dist < 5 ? P.z : undefined); anim = v > 3 ? 'run' : 'walk'; e.grabT = 0; }
      else { e.state = 'grab'; face(P.x, P.z, 12); e.grabT = (e.grabT || 0) + dt; }
      wantAim = canSee && dist < 12 ? .85 : 0; e.aimDir.set(P.x - e.x, P.y + 1.2 - (e.y + 1.4), P.z - e.z).normalize();
      if (canSee && dist < 16 && S.time - (e.barkAt || -9) > 3.4) { e.barkAt = S.time; bark(e, 'arrest', true); } }
    else if (S_ === 'idle') { if (e.patrol && e.patrol.length) { const w = e.patrol[e.pi % e.patrol.length]; if (moveTo(e, w[0], w[1], 1.4, dt) < .4) { e.pi++; } anim = 'walk'; } else anim = e.anim0 || 'idle'; }
    else if (S_ === 'react') { face(T_.x, T_.z, 9); wantAim = e.melee ? 0 : .6; if (e.t <= 0) { if (e.melee) { e.state = 'chase'; if (rnd() < .5) bark(e, 'melee'); } else if (KD.cop && !e.warned) { e.warned = true; e.state = 'react'; e.t = 1.1; bark(e, 'cop', true); } else if (e.post) { e.state = 'cover'; e.t = .25 + rnd() * .4; } else if (chooseCover(e, 'cover')) { e.state = 'move'; e.next = 'cover'; e.t = 9; } else { e.state = 'aimup'; e.t = .5 + rnd() * .3; e.open = true; } } }
    else if (S_ === 'move') { const c = e.cover; if (!c) { e.state = 'react'; e.t = .1; } else { const d = moveTo(e, c.x, c.z, e.speed * (e.intent === 'retreat' ? 1.05 : 1), dt); anim = 'run'; if (d < .4) { e.state = e.next || 'cover'; e.t = .5 + rnd() * .9; e.x = c.x; e.z = c.z; } else if (e.t <= 0 || (e.stuck && e.t < 7)) { c.bad = S.time + 8; c.user = null; e.cover = null; e.stuck = false; e.state = 'react'; e.t = .15; }
        else if (canSee && dist < 22 && e.shotCool <= 0 && !KD.heavy && rnd() < dt * 1.2 && e.mag > 0) { enemyFire(e, true); e.shotCool = .5; } } }
    else if (S_ === 'cover') { const c = e.cover; wantCrouch = (c && c.low) || e.post ? 1 : 0; anim = wantCrouch ? 'crouch' : 'idle'; if (c) face(c.x - c.nx * 2 + (T_.x - c.x) * .2, c.z - c.nz * 2 + (T_.z - c.z) * .2, 6);
      if (c && !coverHides(c, P.x, P.z, P.y) && canSee && dist < 30) { e.t = min(e.t, .25); e.flanked = true; }
      if (e.t <= 0) { const lost = S.time - (e.lastSeen ? e.lastSeen.t : -99);
        if (e.mag <= 0) { e.state = 'reload'; e.t = e.def.reload * (e.def.perShell ? 3 : 1.15); e.reloadK = .001; bark(e, 'reload'); }
        else if (e.post) { if (S.tokens.peek < opts.peekTokens + 1) { S.tokens.peek++; e.token = 'peek'; e.state = 'aimup'; e.t = .5 + rnd() * .3; e.open = false; e.peek = null; e.suppressing = !canSee; if (!S.headless) { _a.set(e.x, e.y + 1.5, e.z); FX.glint(_a); } } else e.t = .4 + rnd() * .4; }
        else if (!KD.heavy && !KD.cop && e.morale < .4 && lost > 6 && enemies.filter(o => !o.out).length === 1) { e.state = 'cower'; e.out = true; bark(e, 'give', true); freeTokens(e); }   // the last one left, alone and shaken: gives up instead of camping
        else if (e.morale < .13 && !KD.heavy && !KD.cop && rnd() < .6) { e.state = 'cower'; e.out = true; bark(e, 'give', true); freeTokens(e); }
        else if (e.morale < .34 && !e.retreated && !KD.heavy && chooseCover(e, 'retreat')) { e.retreated = true; e.state = 'move'; e.next = 'cover'; e.t = 8; bark(e, 'retreat'); }
        else if (e.flanked && chooseCover(e, 'cover')) { e.flanked = false; e.state = 'move'; e.next = 'cover'; e.t = 8; }
        else if ((lost > 4.5 || (!P.exposed && lost > 2.2 && !S.flanker)) && !S.flanker && e.morale > .4 && chooseCover(e, rnd() < .6 ? 'flank' : 'advance')) { S.flanker = e; e.state = 'move'; e.next = 'cover'; e.t = 9; bark(e, 'flank'); }
        else if (KD.heavy && dist > 13 && chooseCover(e, 'advance')) { e.state = 'move'; e.next = 'cover'; e.t = 9; }
        else if (S.tokens.peek < opts.peekTokens) { S.tokens.peek++; e.token = 'peek'; e.state = 'aimup'; e.t = .42 + rnd() * .3; e.open = false; const ps = c ? peekSpot(c, T_.x, T_.z) : null; e.peek = ps; e.suppressing = !canSee && lost > .8; if (!S.headless) { muzzleOf(e, _a); _a.y = e.y + 1.5; FX.glint(_a); } if (rnd() < .3) bark(e, e.suppressing ? 'suppress' : 'peek'); }
        else e.t = .3 + rnd() * .4; } }
    else if (S_ === 'aimup' || S_ === 'burst') { wantAim = 1; anim = 'aim'; if (e.peek && !e.open) { const d = moveTo(e, e.peek.x, e.peek.z, 2.6, dt, T_.x, T_.z); if (d > .1) anim = 'aim'; } face(canSee ? P.x : T_.x, canSee ? P.z : T_.z, 10); e.aimDir.set((canSee ? P.x : T_.x) - e.x, (canSee ? py : P.y + 1) - eyeY, (canSee ? P.z : T_.z) - e.z).normalize();
      if (S_ === 'aimup') { if (e.t <= 0) { e.state = 'burst'; e.burst = KD.heavy ? 1 + (rnd() < .4 ? 1 : 0) : e.def.id === 'smg' ? 4 + ((rnd() * 4) | 0) : 2 + ((rnd() * 3) | 0); e.shotCool = 0; e.t = 4; } }
      else { if (e.shotCool <= 0 && e.burst > 0) { if (e.mag <= 0) e.burst = 0; else { enemyFire(e, canSee); e.burst--; e.shotCool = max(60 / e.def.rpm, e.def.id === 'smg' ? .09 : KD.heavy ? .95 : .2 + rnd() * .16); } }
        if (e.burst <= 0 && e.shotCool <= 0 || e.t <= 0) { freeTokens(e); if (e.open) { e.state = 'strafe'; e.t = .7 + rnd() * .6; e.sd = rnd() < .5 ? 1 : -1; if (rnd() < .5 && chooseCover(e, 'cover')) { e.state = 'move'; e.next = 'cover'; e.t = 8; } } else { e.state = 'back'; e.t = .6; } } } }
    else if (S_ === 'back') { const c = e.cover; wantAim = .4; if (!c || moveTo(e, c.x, c.z, 2.8, dt, T_.x, T_.z) < .12 || e.t <= 0) { e.state = 'cover'; e.t = (.9 + rnd() * 1.6) * (1 + (1 - e.morale) * .8) * (KD.heavy ? .7 : 1); } anim = 'aim'; }
    else if (S_ === 'strafe') { const px = -dz / (dist || 1) * e.sd, pzz = dx / (dist || 1) * e.sd; moveTo(e, e.x + px * 2, e.z + pzz * 2, 2.6, dt, P.x, P.z); anim = 'walk'; wantAim = .5; if (e.t <= 0) { if (e.mag <= 0) { e.state = 'reload'; e.t = e.def.reload * 1.2; e.reloadK = .001; } else { e.state = 'aimup'; e.t = .4 + rnd() * .3; e.open = true; } } }
    else if (S_ === 'reload') { wantCrouch = e.cover && e.cover.low ? 1 : 0; anim = wantCrouch ? 'crouch' : 'idle'; e.reloadK = sat(1 - e.t / (e.def.reload * 1.15)); if (e.t <= 0) { e.mag = e.def.mag; e.reloadK = 0; e.state = e.cover ? 'cover' : 'aimup'; e.t = .3 + rnd() * .5; e.open = !e.cover; } }
    else if (S_ === 'stagger') { anim = 'idle'; e.stagK = max(e.stagK, sat(e.t / 1.15)); if (e.t <= 0) { e.state = e.prev || 'react'; e.t = .2; } }
    else if (S_ === 'down') { if (e.t <= 0) { e.state = 'getup'; e.gt = 0; } }
    else if (S_ === 'getup') { if (e.gt > .7) { e.fall = null; e.tiltX = e.tiltZ = e.yOff = 0; e.kneeK = 0; e.prone = false; e.state = e.melee ? 'chase' : 'react'; e.t = .2; } }
    else if (S_ === 'hunt') { anim = 'run'; wantAim = .3; if (e.mag <= 0) { e.state = 'reload'; e.t = e.def.reload * 1.2; e.reloadK = .001; }
      else if ((canSee && !e.via && dist < (KD.heavy ? 8.5 : 12)) || e.t <= 0) { e.state = 'aimup'; e.t = .35 + rnd() * .2; e.open = true; e.peek = null; }   /* the shotgun walks in to where it hurts */
      else { moveTo(e, e.via ? e.via.x : canSee ? P.x : T_.x, e.via ? e.via.z : canSee ? P.z : T_.z, e.speed, dt, canSee ? P.x : undefined, canSee ? P.z : undefined);   /* e.via: a point a scenario wants him to pass first (a doorway), sight or no sight */ if (!canSee && hyp(T_.x - e.x, T_.z - e.z) < 1.5) e.lastSeen = { x: P.x, z: P.z, t: S.time };   /* nobody where he last saw him: he knows the room, he keeps coming */
        if (canSee && dist < 26 && e.shotCool <= 0 && rnd() < dt * 1.6) { enemyFire(e, true); e.shotCool = .45; } } }
    else if (S_ === 'cower') { anim = 'cower'; wantCrouch = 1; }
    // ---- melee brain
    else if (S_ === 'chase' || S_ === 'circle') { anim = 'run'; if (e.morale < .2 && !e.fled && rnd() < dt * .8) { e.fled = true; e.state = 'cower'; e.out = true; bark(e, 'give', true); }
      else if (dist > 2.0 || S_ === 'circle') { if (S_ === 'circle') { const rr = e.orbit ? 4.3 : 3.1, a = Math.atan2(e.x - P.x, e.z - P.z) + (e.seed % 2 ? 1 : -1) * (e.orbit ? .3 : .38) * (e.stuck ? -1 : 1); moveTo(e, P.x + sin(a) * rr, P.z + cos(a) * rr, e.orbit ? 1.35 : 2.1, dt, P.x, P.z); anim = 'walk';   /* a step round the ring each frame (the old target was dt * 2.8 m away, under moveTo's 5 cm dead zone: he stood bolt upright and stared). Held back by a scenario (e.orbit) he keeps his distance and paces, eyes on the player */ if (S.tokens.melee < opts.meleeTokens && e.t <= 0 && !e.orbit) e.state = 'chase'; } else moveTo(e, P.x - dx / (dist || 1) * 1.3, P.z - dz / (dist || 1) * 1.3, e.speed, dt); }
      if (e.orbit && e.state === 'chase' && dist < 4.2) { e.state = 'circle'; e.t = .8 + rnd() * .8; }
      if (e.state === 'chase' && dist < 2.15 && !P.dead && !e.noSwing && !e.metT) { const inView = abs(angDiff(CAM.yaw, Math.atan2(e.x - P.x, e.z - P.z))) < .95; e.metT = S.time + (inView ? .3 : 1.4); if (!inView) bark(e, 'melee', true); }   /* the first time he is at arm's length he squares up before he swings — longer, and with a shout, when he came from where the player is not looking (b3-world2: 81 hp gone before the man was seen) */
      if (e.state === 'chase' && dist < 2.15 && !P.dead && !e.noSwing && S.time >= (e.metT || 0)) { if (S.tokens.melee < opts.meleeTokens && S.time >= (S.meleeFreeAt || 0)) { S.tokens.melee++; e.token = 'melee'; e.state = 'windup'; e.t = .46; e.swing = { kind: e.seed % 2 ? 'l3' : 'l1', k: 0 }; if (e.wid === 'fists') e.swing.kind = 'hook'; } else { e.state = 'circle'; e.t = .8 + rnd(); } }
      if (P.swing && !P.swing.hit && !P.swing.hold && dist < 2.7 && !e.blockRoll) { e.blockRoll = true; if (rnd() < .38 && abs(angDiff(e.h, Math.atan2(dx, dz))) < 1) e.blockT = .7; } if (!P.swing) e.blockRoll = false; }
    else if (S_ === 'windup' && e.noSwing) { e.swing = null; freeTokens(e); e.state = 'chase'; }
    else if (S_ === 'windup') { anim = 'idle'; face(P.x, P.z, 7); e.swing.k = lerp(0, SWING[e.swing.kind].hit * .62, sat(1 - e.t / .46)); if (e.t <= 0) { e.state = 'strike'; e.t = .3; SND.swish(e); } }
    else if (S_ === 'strike') { anim = 'idle'; const sd = SWING[e.swing.kind]; e.swing.k = lerp(sd.hit * .62, 1, sat(1 - e.t / .3)); if (e.t > .16) { e.x += sin(e.h) * 2.4 * dt; e.z += cos(e.h) * 2.4 * dt; collide(e, e.r); }
      if (!e.swing.hit && e.swing.k >= sd.hit) { e.swing.hit = true; if (dist < 2.2 && abs(angDiff(e.h, Math.atan2(dx, dz))) < 1 && !P.dead && !e.noSwing) { const blocked = P.blockK > .6; damagePlayer((e.def.dmg || 14) * .62 * opts.difficulty * (S.sc ? S.sc.meleeK || 1 : .85), e, 'melee'); if (!blocked && P.iframes <= 0) { SND.melee(P, false); S.hitstop = max(S.hitstop, .05); } } }
      if (e.t <= 0) { e.swing = null; freeTokens(e); e.state = 'recover'; e.t = .55 + rnd() * .4; S.meleeFreeAt = S.time + (S.sc ? S.sc.meleeGap || .3 : .8); } }   /* a street fight outside any scenario: a breath between two swings, and they land at 85 % */
    else if (S_ === 'recover') { anim = 'idle'; face(P.x, P.z, 4); if (e.t <= 0) e.state = 'chase'; }
    if (!P.dead && !e.prone) { const sx = e.x - P.x, sz = e.z - P.z, sd = hyp(sx, sz), SEP = 1.05; if (sd < SEP && abs(e.y - P.y) < 1) { const k = sd > .001 ? SEP / sd : 0;   /* 1.05 m (was .72): in first person a face at 70 cm fills the frame */ if (e.ironGuard || e.leash) { if (k) { P.x = e.x - sx * k; P.z = e.z - sz * k; collide(P, .3); } }   /* a braced guard is not shouldered along by walking into him: the player is the one who stops */ else { e.x = P.x + (k ? sx * k : sin(e.h) * -.72); e.z = P.z + (k ? sz * k : cos(e.h) * -.72); collide(e, e.r); } } }   /* never stand inside the player */
    if (e.leash) { const L = e.leash; if (L.x0 !== undefined && e.x < L.x0) e.x = L.x0; if (L.x1 !== undefined && e.x > L.x1) e.x = L.x1; if (L.z0 !== undefined && e.z < L.z0) e.z = L.z0; if (L.z1 !== undefined && e.z > L.z1) e.z = L.z1; }   /* a scripted fight keeps its people on the set built for it */
    e.blockT = max(0, e.blockT - dt); e.blockK = damp(e.blockK, e.blockT > 0 && !e.swing ? 1 : 0, 16, dt);
    e.aimK = damp(e.aimK, wantAim, 10, dt); e.crouchK = damp(e.crouchK, wantCrouch, 9, dt); e.anim = anim === 'idle' && e.animSpeed > .3 ? 'walk' : anim; if (e.w) e.w.update(dt, { reloading: e.state === 'reload', reloadK: e.reloadK });
  }

  /* ================================================================== HUD (own minimal DOM; the game HUD can absorb it via GT.combat.state) + weapon wheel */
  const CSS = `
#gtc{position:fixed;inset:0;pointer-events:none;z-index:6;font-family:"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",Arial,sans-serif;color:#efe6d2;-webkit-font-smoothing:antialiased;user-select:none}
#gtc *{box-sizing:border-box}
.gtc-x{position:absolute;left:50%;top:50%;width:0;height:0;transition:opacity .15s}
.gtc-x i{position:absolute;background:#f4ecd9;box-shadow:0 0 0 1px rgba(10,10,12,.55);border-radius:1px}
.gtc-x .d{left:-1.5px;top:-1.5px;width:3px;height:3px;border-radius:50%}
.gtc-x .t{left:-1px;width:2px;height:7px}.gtc-x .b{left:-1px;width:2px;height:7px}.gtc-x .l{top:-1px;height:2px;width:7px}.gtc-x .r{top:-1px;height:2px;width:7px}
.gtc-x.on i{background:#ff8a3c}
.gtc-hm{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0}
.gtc-hm i{position:absolute;left:-1px;top:-13px;width:2px;height:9px;background:#fff;box-shadow:0 0 6px rgba(255,150,60,.9);transform-origin:1px 13px}
.gtc-ammo{position:absolute;right:38px;bottom:104px;text-align:right;text-shadow:0 1px 3px rgba(0,0,0,.75);transition:opacity .25s}
.gtc-ammo .n{font-size:11px;letter-spacing:.22em;opacity:.72;margin-bottom:2px}
.gtc-ammo .m{font-size:40px;font-weight:200;line-height:1;font-variant-numeric:tabular-nums}.gtc-ammo .m b{font-weight:200}.gtc-ammo .m.low b{color:#ff8a3c}
.gtc-ammo .m span{font-size:16px;opacity:.62;margin-left:6px;letter-spacing:.04em}
.gtc-ammo .bar{position:relative;height:3px;width:148px;margin:8px 0 0 auto;background:rgba(239,230,210,.2);opacity:0}
.gtc-ammo .bar .sw{position:absolute;top:-2px;bottom:-2px;background:rgba(255,138,60,.85)}.gtc-ammo .bar .cu{position:absolute;top:-4px;width:2px;height:11px;background:#fff}
.gtc-ammo .hint{font-size:10px;letter-spacing:.18em;opacity:.6;margin-top:5px;height:12px}
.gtc-vital{position:absolute;left:22px;bottom:22px;width:176px;height:176px}
.gtc-vital circle{fill:none;stroke-linecap:butt}
.gtc-dmg{position:absolute;left:50%;top:50%;width:0;height:0}
.gtc-dmg i{position:absolute;left:-44px;top:-118px;width:88px;height:16px;border-top:4px solid #ff5a36;border-radius:50%/100% 100% 0 0;transform-origin:44px 118px;opacity:0;filter:drop-shadow(0 0 6px rgba(255,80,40,.8))}
.gtc-obj{position:absolute;left:50%;top:26px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;font-size:14px;letter-spacing:.08em;padding:7px 16px 7px 12px;background:rgba(12,13,16,.55);border-left:2px solid #ff8a3c;opacity:0;transition:opacity .4s;white-space:nowrap}
.gtc-sub{position:absolute;left:50%;bottom:84px;transform:translateX(-50%);font-size:17px;text-shadow:0 1px 4px #000,0 0 2px #000;opacity:0;transition:opacity .2s;white-space:nowrap}.gtc-sub b{color:#ffb078;font-weight:600;margin-right:10px;font-size:13px;letter-spacing:.1em}
.gtc-lock{position:absolute;width:46px;height:46px;margin:-23px 0 0 -23px;opacity:0}
.gtc-lock:before,.gtc-lock:after{content:"";position:absolute;inset:0;border:1.5px solid #ff8a3c;clip-path:polygon(0 0,28% 0,28% 6%,6% 6%,6% 28%,0 28%,0 72%,6% 72%,6% 94%,28% 94%,28% 100%,0 100%)}
.gtc-lock:after{transform:scaleX(-1)}
.gtc-wp{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border:1.5px solid #ff8a3c;border-radius:50%;opacity:0;box-shadow:0 0 10px rgba(255,138,60,.7),inset 0 0 6px rgba(255,138,60,.5)}
.gtc-wp.lm{width:14px;height:14px;margin:-7px 0 0 -7px;border-color:#efe6d2;box-shadow:0 0 6px rgba(239,230,210,.6)}
.gtc-fx{position:absolute;inset:0;opacity:0;box-shadow:inset 0 0 160px 30px rgba(20,40,60,.55)}
.gtc-hurt{position:absolute;inset:0;opacity:0;box-shadow:inset 0 0 180px 40px rgba(150,20,10,.75)}
.gtc-ls{position:absolute;left:50%;top:62%;transform:translateX(-50%);text-align:center;font-size:15px;letter-spacing:.2em;opacity:0}.gtc-ls u{display:block;height:2px;width:220px;margin:9px auto 0;background:rgba(239,230,210,.25);text-decoration:none}.gtc-ls u i{display:block;height:100%;background:#ff8a3c}
.gtc-last{position:absolute;left:0;top:0;width:0;height:0;opacity:0;transition:opacity .3s}.gtc-last i{position:absolute;left:-9px;top:-30px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:15px solid #ff8a3c;filter:drop-shadow(0 0 6px rgba(255,138,60,.8));transform-origin:9px 30px}
.gtc-last span{position:absolute;left:0;top:8px;transform:translateX(-50%);font-size:11px;letter-spacing:.16em;white-space:nowrap;color:#ffb078;text-shadow:0 1px 3px #000}
.gtc-note{position:absolute;left:50%;top:64%;transform:translateX(-50%);text-align:center;padding:9px 20px 8px;background:rgba(12,13,16,.72);border-left:2px solid #ff8a3c;opacity:0;transition:opacity .25s;white-space:nowrap}.gtc-note b{display:block;font-size:17px;font-weight:600;letter-spacing:.14em;color:#ffb078}.gtc-note span{display:block;font-size:12px;letter-spacing:.1em;opacity:.8;margin-top:3px}
.gtc-wheel{position:absolute;inset:0;opacity:0;background:radial-gradient(circle at 50% 50%,rgba(8,9,12,.25) 0,rgba(8,9,12,.62) 55%,rgba(8,9,12,.8) 100%)}
.gtc-wheel .w{position:absolute;left:50%;top:50%;width:560px;height:560px;margin:-280px 0 0 -280px}
.gtc-wheel svg{position:absolute;inset:0}
.gtc-wheel .s{position:absolute;width:150px;height:96px;margin:-48px 0 0 -75px;text-align:center;opacity:.62;transition:opacity .08s,transform .08s}
.gtc-wheel .s canvas{position:static;inset:auto;width:132px;height:66px;display:block;margin:0 auto}
.gtc-wheel .s em{display:block;font-style:normal;font-size:11px;letter-spacing:.14em;margin-top:1px;white-space:nowrap}.gtc-wheel .s em b{color:#ff8a3c;font-weight:400;margin-left:6px}
.gtc-wheel .s.sel{opacity:1;transform:scale(1.1)}.gtc-wheel .s.no{opacity:.2}
.gtc-wheel .c{position:absolute;left:50%;top:50%;width:200px;margin:-44px 0 0 -100px;text-align:center}
.gtc-wheel .c .a{font-size:24px;font-weight:300;letter-spacing:.1em}.gtc-wheel .c .e{font-size:10px;letter-spacing:.3em;opacity:.6;margin-top:4px}.gtc-wheel .c .q{font-size:15px;margin-top:10px;color:#ff8a3c;letter-spacing:.06em;font-variant-numeric:tabular-nums}
.gtc-wheel .k{position:absolute;left:50%;bottom:-34px;transform:translateX(-50%);font-size:10px;letter-spacing:.24em;opacity:.5;white-space:nowrap}`;
  const HUD = { el: null, c: {}, hmT: 0, subT: 0,
    build() { if (HUD.el || S.headless || !opts.hud || typeof document === 'undefined') return; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); const el = HUD.el = document.createElement('div'); el.id = 'gtc';
      const R1 = 80, R2 = 73, C1 = TAU * R1, C2 = TAU * R2;
      el.innerHTML = '<div class="gtc-fx"></div><div class="gtc-hurt"></div><div class="gtc-x"><i class="d"></i><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i></div><div class="gtc-hm"><i style="transform:rotate(45deg)"></i><i style="transform:rotate(135deg)"></i><i style="transform:rotate(225deg)"></i><i style="transform:rotate(315deg)"></i></div>' +
        '<div class="gtc-dmg">' + '<i></i>'.repeat(6) + '</div><div class="gtc-lock"></div><div class="gtc-last"><i></i><span></span></div><div class="gtc-note"><b></b><span></span></div>' + '<div class="gtc-wp"></div>'.repeat(4) + '<div class="gtc-wp lm"></div>'.repeat(8) +
        '<svg class="gtc-vital" viewBox="0 0 176 176"><g transform="rotate(135 88 88)"><circle cx="88" cy="88" r="' + R1 + '" stroke="rgba(239,230,210,.16)" stroke-width="3" stroke-dasharray="' + C1 * .5 + ' ' + C1 + '"/><circle class="hp" cx="88" cy="88" r="' + R1 + '" stroke="#efe6d2" stroke-width="3"/>' +
        '<circle class="ar" cx="88" cy="88" r="' + R2 + '" stroke="#7fb4d6" stroke-width="2"/></g><g transform="rotate(-38 88 88)"><circle cx="88" cy="88" r="' + R1 + '" stroke="rgba(239,230,210,.16)" stroke-width="3" stroke-dasharray="' + C1 * .2 + ' ' + C1 + '"/><circle class="fo" cx="88" cy="88" r="' + R1 + '" stroke="#ff8a3c" stroke-width="3"/></g></svg>' +
        '<div class="gtc-ammo"><div class="n"></div><div class="m"><b></b><span></span></div><div class="bar"><div class="sw"></div><div class="cu"></div></div><div class="hint"></div></div><div class="gtc-obj"><span></span></div><div class="gtc-sub"></div><div class="gtc-ls">倒地 · 击倒一人即可起身<u><i></i></u></div>' +
        '<div class="gtc-wheel"><div class="w"><svg viewBox="0 0 560 560"><circle cx="280" cy="280" r="262" fill="none" stroke="rgba(239,230,210,.5)" stroke-width="1"/><circle cx="280" cy="280" r="118" fill="none" stroke="rgba(239,230,210,.5)" stroke-width="1"/><circle cx="280" cy="280" r="270" fill="none" stroke="rgba(239,230,210,.14)" stroke-width="1" stroke-dasharray="2 7"/><g class="dv"></g><path class="wg" fill="rgba(255,138,60,.16)" stroke="#ff8a3c" stroke-width="1.5"/><circle class="pt" r="4" fill="#ff8a3c"/></svg><div class="c"><div class="a"></div><div class="e"></div><div class="q"></div></div><div class="k">鼠标选栏 · 滚轮逐把切换 · 松开 Q 装备</div></div></div>';
      document.body.appendChild(el); const q = s => el.querySelector(s), c = HUD.c; c.x = q('.gtc-x'); c.xt = q('.gtc-x .t'); c.xb = q('.gtc-x .b'); c.xl = q('.gtc-x .l'); c.xr = q('.gtc-x .r'); c.hm = q('.gtc-hm'); c.dmg = Array.from(el.querySelectorAll('.gtc-dmg i')); c.lock = q('.gtc-lock'); c.wp = Array.from(el.querySelectorAll('.gtc-wp:not(.lm)')); c.lm = Array.from(el.querySelectorAll('.gtc-wp.lm'));
      c.hp = q('.hp'); c.ar = q('.ar'); c.fo = q('.fo'); c.C1 = C1; c.C2 = C2; c.ammo = q('.gtc-ammo'); c.an = q('.gtc-ammo .n'); c.am = q('.gtc-ammo .m'); c.amb = q('.gtc-ammo .m b'); c.ams = q('.gtc-ammo .m span'); c.bar = q('.gtc-ammo .bar'); c.sw = q('.gtc-ammo .sw'); c.cu = q('.gtc-ammo .cu'); c.hint = q('.gtc-ammo .hint');
      c.last = q('.gtc-last'); c.lasti = q('.gtc-last i'); c.lastt = q('.gtc-last span'); c.note = q('.gtc-note'); c.obj = q('.gtc-obj'); c.objt = q('.gtc-obj span'); c.sub = q('.gtc-sub'); c.ls = q('.gtc-ls'); c.lsb = q('.gtc-ls u i'); c.fx = q('.gtc-fx'); c.hurt = q('.gtc-hurt'); c.wheel = q('.gtc-wheel'); c.w = q('.gtc-wheel .w'); c.wg = q('.wg'); c.pt = q('.pt'); c.wa = q('.c .a'); c.we = q('.c .e'); c.wq = q('.c .q'); c.vital = q('.gtc-vital');
      let dv = ''; for (let i = 0; i < 8; i++) { const a = (i + .5) / 8 * TAU; dv += '<line x1="' + (280 + sin(a) * 118) + '" y1="' + (280 - cos(a) * 118) + '" x2="' + (280 + sin(a) * 262) + '" y2="' + (280 - cos(a) * 262) + '" stroke="rgba(239,230,210,.22)" stroke-width="1"/>'; } q('.dv').innerHTML = dv;
      c.slots = []; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, d = document.createElement('div'); d.className = 's'; d.style.left = (280 + sin(a) * 190) + 'px'; d.style.top = (280 - cos(a) * 190) + 'px'; const cv = document.createElement('canvas'); cv.width = 264; cv.height = 132; const em = document.createElement('em'); d.appendChild(cv); d.appendChild(em); c.w.appendChild(d); c.slots.push({ d, cv, em, id: null }); } },
    set(k, el, v) { if (HUD.c['_' + k] !== v) { HUD.c['_' + k] = v; el.textContent = v; } },
    css(k, el, prop, v) { if (HUD.c['_' + k] !== v) { HUD.c['_' + k] = v; el.style[prop] = v; } },
    hitmark() { HUD.hmT = .16; SND.mech('hitmark', null); },
    note(a, b, sec) { const c = HUD.c; if (!HUD.el || !c.note) return; c.note.firstChild.textContent = a || ''; c.note.lastChild.textContent = b || ''; c.note.style.opacity = 1; HUD.noteT = sec || 3.2; },
    sub(who, text, sec) { if (!HUD.el) return; HUD.c.sub.innerHTML = (who ? '<b>' + who + '</b>' : '') + text; HUD.c.sub.style.opacity = 1; HUD.subT = sec || clamp(1.2 + text.length * .14, 1.6, 5); },
    project(x, y, z, out) { const cam = S.cam; if (!cam) return false; _a.set(x, y, z).project(cam); if (_a.z > 1 || _a.z < -1) return false; out.x = (_a.x * .5 + .5) * innerWidth; out.y = (-_a.y * .5 + .5) * innerHeight; return true; },
    drawSlots() { const c = HUD.c; if (!GT.weapons) return; for (let i = 0; i < 8; i++) { const sl = GT.weapons.slots[i], s = c.slots[i], id = sl.empty ? '' : (slotWeapon(i) || sl.ids[0]), own = !sl.empty && !!slotWeapon(i);
        if (s.id !== id) { s.id = id; const g = s.cv.getContext('2d'); g.clearRect(0, 0, 264, 132); g.drawImage(GT.weapons.icon(sl.empty ? 'none' : id, 264, 132), 0, 0); }
        const d = sl.empty ? null : WD(id), am = d && d.kind === 'gun' ? ammoOf(id) : null, txt = sl.empty ? sl.label + ' · 空' : d.name; const html = txt + (am ? '<b>' + am.mag + ' / ' + am.reserve + '</b>' : ''); if (s.html !== html) { s.html = html; s.em.innerHTML = html; }
        const cls = 's' + (WH.sel === i ? ' sel' : '') + (own ? '' : ' no'); if (s.cls !== cls) { s.cls = cls; s.d.className = cls; } } },
    update(rdt) { if (!HUD.el) return; const c = HUD.c, d = curDef(), gun = d.kind === 'gun' && !P.holstered, show = S.engaged && !P.dead, o = { x: 0, y: 0 }; if (S.cam) { S.cam.updateMatrixWorld(); S.cam.matrixWorldInverse.copy(S.cam.matrixWorld).invert(); }
      // crosshair
      const cam = S.cam, f = cam ? innerHeight / (2 * Math.tan((cam.fov || 55) * PI / 360)) : 600, sp = gun ? (lerp(d.hip, d.aim, sst(P.aimK, 0, 1)) + P.bloom + sat(P.speed / 6) * .02) * (P.cover && P.aimK < .5 ? 2.6 : 1) : .012, gap = Math.round(clamp(sp * f, 4, 90));
      HUD.css('xo', c.x, 'opacity', show && !S.wheelOpen && !S.hitcam && !S.scoped && (gun || P.lock || P.mode === 'melee') ? (gun ? (FPC.on && P.w && P.w.sightY ? +(1 - sst(P.aimK, .86, .98)).toFixed(2) : 1) : .55) : 0);   /* first person, aimed, a gun with real sights: the drawn reticle fades out and the notch and blade do the job */ if (c._gap !== gap) { c._gap = gap; c.xt.style.top = (-gap - 7) + 'px'; c.xb.style.top = gap + 'px'; c.xl.style.left = (-gap - 7) + 'px'; c.xr.style.left = gap + 'px'; }
      const on = !!P.onTarget && gun; if (c._on !== on) { c._on = on; c.x.className = 'gtc-x' + (on ? ' on' : ''); }
      HUD.hmT = max(0, HUD.hmT - rdt); HUD.css('hm', c.hm, 'opacity', HUD.hmT > 0 ? min(1, HUD.hmT / .08) : 0); if (HUD.hmT > 0) c.hm.style.transform = 'scale(' + (1 + (1 - HUD.hmT / .16) * .5) + ')';
      // ammo + reload
      HUD.css('ao', c.ammo, 'opacity', show && !S.wheelOpen ? 1 : 0); HUD.set('an', c.an, P.holstered ? '收枪' : d.name + '  ·  ' + d.en);
      const am = gun ? ammoOf(d.id) : (d.kind === 'throw' && !P.holstered ? { mag: (ammoOf(d.id) || { mag: 0 }).mag + (ammoOf(d.id) || { reserve: 0 }).reserve, reserve: 0, thr: true } : null); HUD.set('amb', c.amb, am ? String(am.mag) : P.holstered ? '—' : (d.id === 'fists' ? '拳' : '近战')); HUD.set('ams', c.ams, am ? (am.thr ? '个' : '/ ' + am.reserve) : ''); const low = !!am && am.mag <= max(1, d.mag * .25); if (c._low !== low) { c._low = low; c.am.className = 'm' + (low ? ' low' : ''); }
      const R_ = P.reload; HUD.css('bo', c.bar, 'opacity', R_ && !d.perShell ? 1 : 0); if (R_ && !d.perShell) { c.sw.style.left = (R_.sweet0 * 100) + '%'; c.sw.style.width = ((R_.sweet1 - R_.sweet0) * 100) + '%'; c.sw.style.opacity = R_.tried ? .25 : 1; c.cu.style.left = (P.reloadK * 100) + '%'; }
      HUD.set('hint', c.hint, P.nearPick && !R_ ? 'E  捡起 · ' + WD(P.nearPick.id).name : R_ ? (d.perShell ? '装填中 · 开火可打断' : R_.fumble ? '卡壳！' : R_.tried ? '' : '再按 R · 快速上膛') : am && am.mag === 0 ? (am.reserve > 0 ? '按 R 换弹' : '没子弹了') : P.cover ? (P.cover.c.low ? '右键探身 · 左键盲射 · 空格翻越 · E / 后退 离开' : '靠近边缘右键探身 · E / 后退 离开') : '');
      // vitals
      const hp = sat(P.hp / P.maxHp), ar = sat(P.armor / P.maxArmor); c.hp.setAttribute('stroke-dasharray', (c.C1 * .5 * hp) + ' ' + c.C1); c.hp.setAttribute('stroke', hp < .3 ? '#ff5a36' : '#efe6d2'); c.ar.setAttribute('stroke-dasharray', (c.C2 * .5 * ar) + ' ' + c.C2); c.fo.setAttribute('stroke-dasharray', (c.C1 * .2 * sat(P.focus)) + ' ' + c.C1);
      HUD.css('vo', c.vital, 'opacity', show ? 1 : 0);
      HUD.css('hurt', c.hurt, 'opacity', (P.dead ? .9 : sat(1 - hp * 1.6) * .8 + sat(1 - (S.time - P.lastHitT) * 2.5) * .35).toFixed(2));
      HUD.css('fx', c.fx, 'opacity', (max(S.focusK, WH.k * .6)).toFixed(2));
      for (let i = 0; i < 6; i++) { const h = P.hitDirs[i], el = c.dmg[i]; if (!h) { if (el._o !== 0) { el._o = 0; el.style.opacity = 0; } continue; } const a = angDiff(CAM.yaw, Math.atan2(h.x - P.x, h.z - P.z)); el.style.transform = 'rotate(' + (-a) + 'rad)'; el._o = 1; el.style.opacity = sat(h.t * 1.6); }
      // lock-on + weak points
      let lo = 0; if (P.lock && !P.lock.dead && (d.kind === 'melee' || P.holstered) && HUD.project(P.lock.x, P.lock.y + P.lock.ht * .7, P.lock.z, o)) { lo = 1; c.lock.style.left = o.x + 'px'; c.lock.style.top = o.y + 'px'; } HUD.css('lock', c.lock, 'opacity', lo);
      let wi = 0, li = 0; if (S.focusK > .3) for (const e of enemies) { if (e.dead || e.out) continue; const top = e.y + (e.prone ? .4 : lerp(e.ht, e.ht * .6, e.crouchK));
          if (wi < 4 && HUD.project(e.x + sin(e.h) * .03, top - .11, e.z + cos(e.h) * .03, o)) { const el = c.wp[wi++]; el.style.left = o.x + 'px'; el.style.top = o.y + 'px'; el.style.opacity = S.focusK; }
          if (li < 8 && !e.prone && HUD.project(e.x, e.y + (top - e.y) * .28, e.z, o)) { const el = c.lm[li++]; el.style.left = o.x + 'px'; el.style.top = o.y + 'px'; el.style.opacity = S.focusK * .8; }
          if (li < 8 && e.aimK > .5 && !e.melee && HUD.project(e.x + sin(e.h) * .42 - cos(e.h) * -.1, top - .32, e.z + cos(e.h) * .42 + sin(e.h) * -.1, o)) { const el = c.lm[li++]; el.style.left = o.x + 'px'; el.style.top = o.y + 'px'; el.style.opacity = S.focusK * .8; } }
      for (; wi < 4; wi++) c.wp[wi].style.opacity = 0; for (; li < 8; li++) c.lm[li].style.opacity = 0;
      /* the last two of a locked scenario are pointed at: on screen a mark over the head, off screen an arrow on a ring round the reticle, with the distance */
      { let le = null, ld = 1e9, na = 0; if (S.sc && S.sc.lock && !S.hitcam && !P.dead) for (const e of enemies) { if (e.out || e.hold || !e.alert) continue; na++; const dd = hyp(e.x - P.x, e.z - P.z); if (dd < ld) { ld = dd; le = e; } }
        if (le && na <= 2 && ld > 3.5) { const a = angDiff(CAM.yaw, Math.atan2(le.x - P.x, le.z - P.z)), on = abs(a) < .55 && HUD.project(le.x, le.y + le.ht + .25, le.z, o), R = min(innerWidth, innerHeight) * .34;
          c.last.style.transform = 'translate(' + (on ? o.x : innerWidth / 2 - sin(a) * R).toFixed(0) + 'px,' + (on ? o.y : innerHeight / 2 - cos(a) * R).toFixed(0) + 'px)'; c.lasti.style.transform = 'rotate(' + (on ? PI : -a).toFixed(2) + 'rad)'; HUD.set('lastt', c.lastt, '剩 ' + na + ' · ' + Math.round(ld) + ' 米'); HUD.css('lasto', c.last, 'opacity', 1); }
        else HUD.css('lasto', c.last, 'opacity', 0); if (HUD.noteT > 0) { HUD.noteT -= rdt; if (HUD.noteT <= 0) c.note.style.opacity = 0; } }
      // objective, subtitle, last stand
      const ob = S.sc && S.sc.objective ? S.sc.objective : ''; HUD.set('obj', c.objt, ob); HUD.css('objo', c.obj, 'opacity', ob ? 1 : 0);
      if (HUD.subT > 0) { HUD.subT -= rdt; if (HUD.subT <= 0) c.sub.style.opacity = 0; }
      HUD.css('ls', c.ls, 'opacity', P.mode === 'down' ? 1 : 0); if (P.mode === 'down') c.lsb.style.width = (sat(1 - P.down / 3.4) * 100) + '%';
      // wheel
      HUD.css('wo', c.wheel, 'opacity', WH.k.toFixed(2)); if (WH.k > .01) { HUD.drawSlots(); c.w.style.transform = 'scale(' + (.92 + .08 * WH.k).toFixed(3) + ')'; const i = WH.sel;
        if (c._wsel !== i) { c._wsel = i; if (i < 0) c.wg.setAttribute('d', ''); else { const a0 = (i - .5) / 8 * TAU, a1 = (i + .5) / 8 * TAU, p = (a, r) => (280 + sin(a) * r).toFixed(1) + ' ' + (280 - cos(a) * r).toFixed(1); c.wg.setAttribute('d', 'M' + p(a0, 118) + ' L' + p(a0, 262) + ' A262 262 0 0 1 ' + p(a1, 262) + ' L' + p(a1, 118) + ' A118 118 0 0 0 ' + p(a0, 118) + 'Z'); } }
        c.pt.setAttribute('cx', 280 + WH.vx * .9); c.pt.setAttribute('cy', 280 + WH.vy * .9); const sl = i >= 0 && GT.weapons ? GT.weapons.slots[i] : null, id = sl && !sl.empty ? slotWeapon(i) : null, wd = id ? WD(id) : null, am2 = wd && wd.kind === 'gun' ? ammoOf(id) : null;
        HUD.set('wa', c.wa, wd ? wd.name : sl && sl.empty ? sl.label : sl ? '未持有' : (P.holstered ? '收枪' : d.name)); HUD.set('we', c.we, wd ? wd.en : sl && sl.empty ? 'EMPTY' : ''); HUD.set('wq', c.wq, am2 ? am2.mag + ' / ' + am2.reserve : wd ? (wd.id === 'fists' ? '左键连击 · 按住重击' : '左键连击 · 右键格挡') : ''); } }
  };
  const WH = { open: false, holdT: 0, k: 0, vx: 0, vy: 0, sel: -1, pick: null };
  function pointWheelAt(slot, id) {
    if (WH.sel !== slot || WH.pick !== id) SND.mech('tick', null);
    WH.sel = slot; WH.pick = id;
    const angle = slot * TAU / 8;
    WH.vx = sin(angle) * 110; WH.vy = -cos(angle) * 110;
  }
  function wheelUpdate(rdt, scroll) { const keys = opts.keys.wheel; let down = null; for (const k of keys) if (IN.down(k)) down = k; if (P.dead || S.hitcam) down = null;
    if (down) { WH.holdT += rdt; if (!WH.open && WH.holdT > .14) { WH.open = true; WH.vx = WH.vy = 0; WH.sel = -1; WH.pick = null; SND.mech('wheel', null); emit('wheel', { open: true }); } }
    else { if (WH.open) { if (!P.dead && !S.hitcam && !slotLocked()) {
        scrollWeapon(scroll);
        const id = slotWeapon(WH.sel); if (id) equip(id);
      }
      WH.open = false; emit('wheel', { open: false, sel: WH.sel }); } else if (WH.holdT > 0 && WH.holdT <= .14) { if (P.holstered) equip(P.cur !== 'fists' ? P.cur : (bestGun() || meleeBest())); else if (P.last && P.owned[P.last] && P.last !== P.cur) equip(P.last); else holster(); } WH.holdT = 0; }
    if (WH.open) { WH.vx += IN.look.dx * 420; WH.vy += IN.look.dy * 420; const l = hyp(WH.vx, WH.vy); if (l > 130) { WH.vx *= 130 / l; WH.vy *= 130 / l; } if (l > 34 && (IN.look.dx || IN.look.dy)) { const i = ((Math.round(Math.atan2(WH.vx, -WH.vy) / (TAU / 8)) % 8) + 8) % 8; if (i !== WH.sel) { WH.sel = i; WH.pick = null; SND.mech('tick', null); } }
      if (!slotLocked()) {
        for (let i = 0; i < SLOTKEYS.length; i++) if (IN.pressed(SLOTKEYS[i])) {
          const id = slotWeapon(i);
          pointWheelAt(i, i === WH.sel && id ? (slotOther(i, id) || id) : id);
        }
        scrollWeapon(scroll);
      } }
    WH.k = damp(WH.k, WH.open ? 1 : 0, 16, rdt); S.wheelOpen = WH.open; }

  /* ================================================================== scenario props (kit-built, each with a collider) */
  const PROPS = { group: null, k: null,
    begin() { PROPS.k = S.headless ? null : GT.kit(); },
    end() { if (!PROPS.k) return; const g = PROPS.k.build(); PROPS.group.add(g); PROPS.k = null; },
    crate(x, z, s, ry, y0, mark) { const k = PROPS.k, y = (y0 || 0) + s / 2; if (!y0) addProp(x - s / 2, z - s / 2, x + s / 2, z + s / 2, s, 'combat-crate', 'wood'); else { const b = GT.world.boxes.filter(q => q.combat && abs((q.x0 + q.x1) / 2 - x) < .3 && abs((q.z0 + q.z1) / 2 - z) < .3)[0]; if (b) b.h = y0 + s + (S.propY || 0); }
      if (!k) return; k.push(x, y, z, { ry: ry || 0 }); const w = GT.mat('wood_plank', { color: 0x9a7a52 }), wd = GT.mat('wood_plank', { color: 0x6f5436 }); k.box(w, s - .04, s - .04, s - .04, 0, 0, 0, { bevel: .008 });
      for (const a of [-1, 1]) for (const b of [-1, 1]) { k.box(wd, .09, s, .09, a * (s / 2 - .045), 0, b * (s / 2 - .045), { bevel: .01 }); k.box(wd, s, .09, .09, 0, a * (s / 2 - .045), b * (s / 2 - .045), { bevel: .01 }); k.box(wd, .09, .09, s, a * (s / 2 - .045), b * (s / 2 - .045), 0, { bevel: .01 }); }
      for (const a of [-1, 1]) { k.box(wd, .08, s * 1.3, .03, 0, 0, a * (s / 2 - .012), { rz: .78, bevel: .006 }); k.box(wd, .03, s * 1.3, .08, a * (s / 2 - .012), 0, 0, { rx: .78, bevel: .006 }); }
      if (GT.signMat && mark !== false) { const m = GT.signMat(mark || '郝记贸易 · HK-12', { style: 'stencil', color: '#1f1a14', w: 512, h: 128, distress: .5 }); k.quad(m, s * .7, s * .18, 0, s * .2, s / 2 - .006); k.quad(m, s * .7, s * .18, 0, s * .2, -s / 2 + .006, { ry: PI }); } k.pop(); },
    barrier(x, z, len, alongX) { const k = PROPS.k, w = alongX ? len : .5, d = alongX ? .5 : len; addProp(x - w / 2, z - d / 2, x + w / 2, z + d / 2, .86, 'combat-barrier', 'stucco'); if (!k) return; k.push(x, 0, z, { ry: alongX ? 0 : HP });
      k.box('concrete_stained', len, .2, .56, 0, .1, 0, { bevel: .02 }).box('concrete_stained', len, .36, .34, 0, .36, 0, { bevel: .04 }).box('concrete', len, .36, .2, 0, .68, 0, { bevel: .03 }); for (const s of [-1, 1]) { k.box('metal_painted_yellow', .5, .2, .205, s * (len / 2 - .4), .68, 0, { bevel: .01 }); k.cyl('metal_rust', .02, .02, .1, s * (len / 2 - .15), .88, 0, { seg: 6 }); }
      k.geo(GT.decalMat('grime_streak'), new T.PlaneGeometry(len * .8, .6), { y: .5, z: .176 }); k.pop(); },
    pallet(x, z, ry) { const k = PROPS.k; addProp(x - .62, z - .52, x + .62, z + .52, 1.18, 'combat-pallet', 'wood'); if (!k) return; k.push(x, 0, z, { ry: ry || 0 }); const w = GT.mat('wood_plank', { color: 0x8a7658 });
      for (let i = 0; i < 5; i++) k.box(w, 1.2, .022, .14, 0, .13, -.43 + i * .215, { bevel: .004 }); for (const s of [-1, 0, 1]) { k.box(w, .1, .09, 1.0, s * .55, .065, 0, { bevel: .006 }); }
      const wrap = GT.mat('plastic_white', { color: 0x9aa2a6, rough: .25 }), cb = GT.mat('wood_painted', { color: 0xa98a5c }); for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) k.box(cb, .56, .32, .94, -.29 + i * .58, .31 + j * .33, 0, { bevel: .012 }); k.box(wrap, 1.19, .98, .99, 0, .64, 0, { bevel: .04 });
      k.box('plastic_black', 1.22, .03, .03, 0, .5, .5).box('plastic_black', 1.22, .03, .03, 0, .9, .5); k.pop(); },
    drums(x, z) { const k = PROPS.k; addProp(x - .62, z - .34, x + .62, z + .34, .92, 'combat-drum', 'metal'); if (!k) return; for (const [dx, m] of [[-.31, 'metal_painted_blue'], [.31, 'metal_rust']]) { k.cyl(m, .29, .29, .88, x + dx, .44, z, { seg: 18 }); for (const y of [.02, .3, .6, .87]) k.cyl(m, .3, .3, .03, x + dx, y, z, { seg: 18 }); k.cyl('metal_dark', .03, .03, .03, x + dx + .15, .895, z, { seg: 8 }); } },
    forklift(x, z, h) { const k = PROPS.k; const alongX = abs(sin(h)) > .5; addProp(x - (alongX ? 1.25 : .62), z - (alongX ? .62 : 1.25), x + (alongX ? 1.25 : .62), z + (alongX ? .62 : 1.25), 2.1, 'combat-forklift', 'metal'); if (!k) return; k.push(x, 0, z, { ry: h });
      const Y = 'metal_painted_yellow', D = 'metal_dark'; k.box(Y, 1.05, .55, 1.5, 0, .55, -.25, { bevel: .05 }).box(D, 1.08, .5, .5, 0, .58, -1.05, { bevel: .08 }).box(Y, .9, .1, .9, 0, .88, -.5, { bevel: .03 }).box('leather_black', .5, .1, .5, 0, .96, -.35, { bevel: .04 }).box('leather_black', .5, .5, .1, 0, 1.2, -.62, { rx: -.15, bevel: .04 });
      for (const sx of [-1, 1]) { k.cyl('rubber', .26, .26, .2, sx * .5, .26, .35, { rz: HP, seg: 16 }).cyl('rubber', .2, .2, .18, sx * .45, .2, -.9, { rz: HP, seg: 14 }).cyl(Y, .12, .12, .21, sx * .5, .26, .35, { rz: HP, seg: 10 });
        k.box(D, .06, 2.05, .06, sx * .46, 1.12, .1, { bevel: .01 }).box(D, .06, 2.05, .06, sx * .46, 1.12, -.86, { rx: .0, bevel: .01 }).box(D, .1, 2.6, .12, sx * .32, 1.36, .62, { bevel: .015 }).box(D, .08, .05, 1.1, sx * .28, 1.02, 1.2, { bevel: .01 }).box(D, .08, .5, .06, sx * .28, 1.25, .69, { bevel: .01 }); }
      k.box(D, 1.0, .06, 1.05, 0, 2.14, -.38, { bevel: .015 }); for (let i = 0; i < 4; i++) k.box(D, .9, .03, .04, 0, 2.18, -.8 + i * .28); k.box(D, .8, .08, .1, 0, 2.6, .62, { bevel: .01 }).box(D, .8, .08, .1, 0, .3, .62, { bevel: .01 }).cyl('chrome', .035, .035, 1.6, 0, 1.2, .62, { seg: 8 });
      k.box(D, .05, .5, .05, .2, 1.3, .08, { rx: .4 }).cyl(D, .16, .16, .04, .2, 1.52, .2, { rx: 1.1, seg: 14 }).box('light_warm', .12, .08, .04, .4, 1.0, .46).box('light_red', .1, .06, .04, -.4, .7, -1.31);
      k.geo(GT.signMat ? GT.signMat('江城港务 03', { style: 'stencil', color: '#1b1b1b', w: 512, h: 128 }) : GT.mat('metal_dark'), new T.PlaneGeometry(.9, .2), { x: .531, y: .62, z: -.3, ry: HP }); k.pop();
      PROPS.crate(x + sin(h) * 1.25, z + cos(h) * 1.25, .8, h, 1.04, false); },
    van(x, z, h) { const k = PROPS.k, alongX = abs(sin(h)) > .5, L = 4.9, W = 1.95; addProp(x - (alongX ? L / 2 : W / 2), z - (alongX ? W / 2 : L / 2), x + (alongX ? L / 2 : W / 2), z + (alongX ? W / 2 : L / 2), 2.05, 'combat-vanbody', 'metal'); if (!k) return; k.push(x, 0, z, { ry: h });
      const body = GT.mat('metal_painted_white', { color: 0xb9b6ab }), D = 'plastic_black'; k.box(body, W, 1.5, 3.25, 0, 1.23, -.78, { bevel: .09 }).box(body, W, .92, 1.5, 0, .94, 1.6, { bevel: .1 }).box(body, W - .08, .7, 1.05, 0, 1.6, 1.25, { rx: -.42, bevel: .1 }).box(D, W + .04, .22, .16, 0, .5, 2.38, { bevel: .05 }).box(D, W + .04, .22, .14, 0, .5, -2.44, { bevel: .05 }).box(D, W - .2, .3, 4.5, 0, .42, 0, { bevel: .03 });
      k.box('glass_tint', W - .22, .55, .04, 0, 1.63, 1.74, { rx: -.42 }).box('glass_tint', .03, .46, .8, W / 2 - .02, 1.56, 1.3).box('glass_tint', .03, .46, .8, -W / 2 + .02, 1.56, 1.3);
      for (const sx of [-1, 1]) { for (const zz of [1.55, -1.45]) { k.cyl('rubber', .35, .35, .24, sx * (W / 2 - .13), .35, zz, { rz: HP, seg: 18 }).cyl('metal_galv', .2, .2, .25, sx * (W / 2 - .13), .35, zz, { rz: HP, seg: 12 }); k.box(D, .06, .5, .95, sx * (W / 2 - .02), .52, zz, { bevel: .02 }); }
        k.box('light_warm', .28, .16, .05, sx * .66, .86, 2.36).box('light_red', .14, .34, .04, sx * .86, 1.1, -2.41).box(D, .04, .16, .26, sx * (W / 2 + .1), 1.42, 1.72, { bevel: .02 }).box('metal_dark', .012, 1.36, .02, sx * (W / 2 + .001), 1.22, .62).box('metal_dark', .012, 1.36, .02, sx * (W / 2 + .001), 1.22, -.9).box('chrome', .02, .05, .14, sx * (W / 2 + .012), 1.1, .48, { bevel: .008 }); }
      k.box('metal_dark', .02, 1.4, .012, 0, 1.25, -2.406).box('chrome', .16, .05, .03, .12, 1.15, -2.42, { bevel: .008 }).box(D, 1.3, .22, .04, 0, .9, 2.37);
      if (GT.signMat) { const m = GT.signMat('郝记冷链 · 江城配送', { style: 'stencil', color: '#2b4a66', w: 1024, h: 128, distress: .5 }); k.quad(m, 2.5, .31, W / 2 + .004, 1.5, -.8, { ry: HP }); k.quad(m, 2.5, .31, -W / 2 - .004, 1.5, -.8, { ry: -HP }); }
      k.geo(GT.decalMat('rust_run'), new T.PlaneGeometry(.7, 1.1), { x: W / 2 + .006, y: 1.0, z: -1.9, ry: HP }); k.geo(GT.decalMat('grime_streak'), new T.PlaneGeometry(1.4, .9), { x: -W / 2 - .006, y: .95, z: -.4, ry: -HP }); k.decal('oil_stain', 1.6, 1.6, 0, .012, .8, .4); k.pop(); },
    /** fake "open storage unit": dark opening over an existing door + rolled door + junk on the threshold. Returns { door: Mesh } so it can roll up later */
    unit(x, zFace, dirZ, open) { if (S.headless) return { door: null, x, z: zFace + dirZ * .9, k: open ? 1 : 0 }; const g = new T.Group(); g.position.set(x, 0, zFace + dirZ * .075); if (dirZ < 0) g.rotation.y = PI; PROPS.group.add(g);
      const k = GT.kit(), dark = new T.MeshBasicMaterial({ color: 0x030303 }); k.box(dark, 2.72, 2.36, .02, 0, 1.2, 0).box('corrugated_metal', 2.86, .3, .34, 0, 2.52, .1, { bevel: .03 }).box('metal_galv', .08, 2.4, .1, -1.4, 1.2, .04).box('metal_galv', .08, 2.4, .1, 1.4, 1.2, .04);
      k.box(GT.mat('wood_plank', { color: 0x5a4630 }), .8, .7, .1, -.75, .36, .03, { bevel: .01 }).box(GT.mat('wood_painted', { color: 0x6a5a40 }), .6, .45, .1, .8, .23, .03, { bevel: .01 }).box('plastic_grey', .5, 1.1, .08, .2, .56, .02, { bevel: .01 }).box('light_warm', .5, .03, .03, 0, 2.3, .02); g.add(k.build({ cast: false }));
      const door = new T.Mesh(new T.BoxGeometry(2.7, 2.36, .05), GT.mat('corrugated_metal', { color: 0xc8702c })); door.position.set(0, 1.2, .05); g.add(door); const u = { door, x, z: zFace + dirZ * .9, k: open ? 1 : 0, g }; PROPS.setUnit(u, u.k); return u; },
    setUnit(u, k) { u.k = k; if (!u.door) return; const s = max(.03, 1 - k); u.door.scale.y = s; u.door.position.y = 2.38 - 1.18 * s; u.door.visible = k < .97; },
    floodlight(x, z, tx, tz) { const F = { x, z, y: 4.35, r: .42, dead: false, on: false, light: null, mats: [], k: 0 }; S.targets.push(F); S.flood = F; addProp(x - .35, z - .35, x + .35, z + .35, 1.0, 'combat-generator', 'metal');
      F.onHit = (t, p) => { if (!F.on) return; F.on = false; F.dead = true; F.popT = .001; FX.impact(p, _c.set(0, -1, 0), 'glass'); FX.impact(p, _c.set(0, 0, 1), 'metal'); SND.lamp(F); for (const e of enemies) if (!e.dead && e.alert && rnd() < .5) { bark(e, 'lamp', true); break; } emit('lamp', { on: false }); };
      if (S.headless) return F; const k = GT.kit(), D = 'metal_dark', Y = 'metal_painted_yellow'; k.push(x, 0, z, { ry: Math.atan2(tx - x, tz - z) });
      k.box(Y, .62, .5, .5, 0, .37, 0, { bevel: .04 }).box(D, .66, .1, .54, 0, .1, 0, { bevel: .02 }).box(D, .3, .2, .02, 0, .42, .255).cyl(D, .04, .04, .2, .2, .72, -.1, { seg: 8 }).box('plastic_red', .12, .14, .12, -.18, .7, .1, { bevel: .02 });
      for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + .4; k.tube(D, [[sin(a) * .95, .03, cos(a) * .95], [sin(a) * .4, .7, cos(a) * .4], [0, 1.25, 0]], .022); k.cyl('rubber', .05, .06, .04, sin(a) * .95, .02, cos(a) * .95, { seg: 8 }); }
      k.cyl('metal_galv', .035, .04, 3.4, 0, 2.6, 0, { seg: 10 }).cyl('metal_galv', .05, .05, .2, 0, 1.3, 0, { seg: 10 }).cyl('metal_galv', .028, .028, 1.5, 0, 4.25, 0, { rz: HP, seg: 8 });
      k.tube('rubber', [[0, 1.2, .05], [.1, .9, .2], [.25, .62, .26]], .012).tube('rubber', [[.3, .3, .26], [.8, .02, .5], [1.6, .02, .3], [2.4, .02, .7]], .014);
      for (const sx of [-1, 1]) { k.push(sx * .5, 4.3, .06, { rx: .42 }); k.box(D, .46, .36, .2, 0, 0, 0, { bevel: .03 }); for (let i = 0; i < 5; i++) k.box(D, .44, .02, .08, 0, -.14 + i * .07, -.14); k.box(D, .5, .04, .1, 0, .2, .12).tube(D, [[-.26, 0, -.02], [-.3, -.2, -.06], [0, -.3, -.08], [.3, -.2, -.06], [.26, 0, -.02]], .012); k.pop(); }
      k.pop(); PROPS.group.add(k.build());
      for (const sx of [-1, 1]) { const m = new T.MeshBasicMaterial({ color: 0x111111 }), lens = new T.Mesh(new T.PlaneGeometry(.4, .3), m), piv = new T.Group(); piv.position.set(x, 0, z); piv.rotation.y = Math.atan2(tx - x, tz - z); const hd = new T.Group(); hd.position.set(sx * .5, 4.3, .06); hd.rotation.x = .42; lens.position.z = .104; hd.add(lens); piv.add(hd); PROPS.group.add(piv); F.mats.push(m); }
      const L = F.light = new T.SpotLight(0xdfe9ff, 0, 60, .58, .65, 1.4); L.position.set(x, 4.3, z); L.target.position.set(tx, 0, tz); L.castShadow = true; L.shadow.mapSize.set(1024, 1024); L.shadow.camera.near = 1; L.shadow.camera.far = 50; L.shadow.bias = -.0006; PROPS.group.add(L, L.target);
      const halo = new T.Sprite(new T.SpriteMaterial({ map: FX.tex.dot, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); halo.position.set(x, 4.3, z).add(_a.set(tx - x, 0, tz - z).normalize().multiplyScalar(.25)); halo.scale.setScalar(1.25); halo.material.opacity = 0; PROPS.group.add(halo); F.halo = halo; return F; },
    lamp(F, on) { F.on = on && !F.dead; emit('lamp', { on: F.on }); }
  };
  function floodUpdate(dt) { const F = S.flood, night = GT.env ? GT.env.night || 0 : 0; for (const L of SET.lights) L.l.intensity = L.i * (L.always ? 1 : .12 + .88 * night); if (!F) { S.dark = 0; return; } F.k = damp(F.k, F.on ? 1 : 0, F.on ? 9 : 30, dt); if (F.popT) { F.popT += dt; if (F.popT < .5 && rnd() < .5) FX.sprite({ pos: _a.set(F.x, F.y, F.z), add: true, life: .3, size: .05, r: 9, g2: 6, b: 2, vel: _b.set(rnd() - .5, -rnd(), rnd() - .5).multiplyScalar(3), g: -9 }); }
    S.dark = night > .5 && !F.on ? 1 : 0; if (F.light) { F.light.intensity = F.k * lerp(.8, 3.4, night); for (const m of F.mats) m.color.setRGB(.02 + F.k * 9, .02 + F.k * 10, .02 + F.k * 12); F.halo.material.opacity = F.k * .34 * lerp(.25, 1, night); F.halo.material.color.setRGB(2, 2.3, 3); } }

  /** QA: the death camera (GTA): out of the body, a slow arc round the man on the ground, framed so the whole of him is seen; walls pull it in */
  const DCAM = { a: 0, p: V3(), l: V3(), init: false };
  function deathCam(rdt, cam) { if (!cam || !S.autoCam) return; const t = P.fallT || 0, R = P.rig; let cx = P.x, cy = P.y + .25, cz = P.z;
    if (R && R.hips && P.fig && P.fig.group) { P.fig.group.updateMatrixWorld(true); wpos(R.hips, _a); if (R.head) { wpos(R.head, _b); _a.lerp(_b, .45); } if (hyp(_a.x - P.x, _a.z - P.z) < 2.5) { cx = _a.x; cz = _a.z; cy = max(P.y + .15, min(P.y + 1.1, _a.y)); } }
    const room = a => { const ddx = sin(a), ddz = cos(a); let L = 5.4; for (const hy of [1.15, 1.9]) { const h = rayBoxes(cx, cy + hy, cz, ddx, 0, ddz, 5.7, 0); if (h) L = min(L, h.t - .3); } for (let q = L; q > 1; q -= .4) if (pointFree(cx + ddx * q, cz + ddz * q, .35, cy + 1)) return q; return 1; };   /* how far the lens can back off that way: rays at three heights, and the spot itself out of every box (a shop front used to swallow it) */
    if (!DCAM.init || t < .05) { DCAM.init = true; const sd = sin(CAM.yaw - P.h) >= 0 ? 1 : -1; let best = P.h + sd * (HP + .35), bs = -1; let tight = 9; for (let i = 0; i < 12; i++) { const a = P.h + sd * (HP + .35) + i * TAU / 12, rm = room(a), r = rm - abs(angDiff(P.h + sd * HP, a)) * .25; tight = min(tight, rm); if (r > bs) { bs = r; best = a; } } DCAM.a = best; DCAM.tight = tight < 3.2; DCAM.p.copy(cam.position); }   /* against a shop front or under an arcade the lens stays low, under the awnings */   /* from the side of the body, a little ahead of it, the side with the most room: the whole man and the street round him */
    DCAM.a += rdt * .16; const k = sst(t, 0, 1.6), dist = lerp(2.6, 5.4, k), hgt = DCAM.tight ? lerp(1.15, 1.35, k) : lerp(1.4, 2.0, k); let dx = sin(DCAM.a), dz = cos(DCAM.a); const dd = min(dist, room(DCAM.a));
    _c.set(cx + dx * dd, cy + hgt, cz + dz * dd); DCAM.p.lerp(_c, 1 - Math.exp(-rdt * (t < .2 ? 30 : 4))); DCAM.l.set(cx, cy + .55 * k, cz);   /* aimed a little over him: he lies in the lower half, under the card */
    cam.position.copy(DCAM.p); cam.up.set(0, 1, 0); cam.lookAt(DCAM.l); CAM.pos.copy(DCAM.p); CAM.dir.copy(DCAM.l).sub(DCAM.p).normalize(); CAM.fov += (48 - CAM.fov) * (1 - Math.exp(-rdt * 4)); if (abs(cam.fov - CAM.fov) > .01) { cam.fov = CAM.fov; cam.updateProjectionMatrix(); } }
  /** revive(x, z, h): back on his feet at the respawn point — full health, not dead, out of the fight, the gun put away (the guns are kept; js/cngame.js strips them on an arrest) */
  function revive(x, z, h) { const owned = P.owned, inv = P.inv, mel = P.melee; resetPlayer(x, z, h === undefined ? P.h : h, null); P.owned = owned; P.inv = inv; P.melee = mel; P.holstered = true; disarmActor(P); P.w = null; syncHelmet(); DCAM.init = false;
    if (P.fig && P.fig.group) { P.fig.group.rotation.x = 0; P.fig.group.rotation.z = 0; P.fig.group.visible = true; } SCOPE.hid = false; scopeView(false, 0); S.scoped = false; S.engT = 0; S.hitcam = null; S.focusOn = false; S.focusK = 0;
    if (S.engaged) engage(false); if (GT.render && GT.render.fx && S.fxSet) { GT.render.fx.focus = 0; S.fxSet = false; } emit('revive', { x, z }); return true; }
  /** QA: the scope picture — black round the glass, a duplex reticle with mil dots, a soft dark rim; the shooter and his gun are not drawn while he looks through it */
  const SCOPE = { el: null, k: 0, hid: false };
  function scopeView(on, rdt) { if (S.headless || typeof document === 'undefined' || !document.body) return; SCOPE.k = on ? min(1, SCOPE.k + (rdt || .016) * 8) : 0;
    if (on && !SCOPE.el) { const e = SCOPE.el = document.createElement('div'); e.className = 'gtc-scope'; e.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5;opacity:0';
      let dots = ''; for (let i = 1; i <= 4; i++) for (const sg of [-1, 1]) { dots += '<circle cx="' + sg * i * 6 + '" cy="0" r=".9"/><circle cx="0" cy="' + sg * i * 6 + '" r=".9"/>'; }
      e.innerHTML = '<svg width="100%" height="100%" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" style="overflow:visible"><defs><radialGradient id="gtcScV"><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset=".93" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity=".95"/></radialGradient></defs>'
        + '<circle r="91" fill="url(#gtcScV)"/><path fill="#000" fill-rule="evenodd" d="M-2000,-2000H2000V2000H-2000Z M0,-91A91,91 0 1,0 0,91A91,91 0 1,0 0,-91Z"/><circle r="91" fill="none" stroke="#0b0b0b" stroke-width="2.5"/>'
        + '<g fill="#050505"><rect x="-91" y="-1.1" width="63" height="2.2"/><rect x="28" y="-1.1" width="63" height="2.2"/><rect x="-1.1" y="28" width="2.2" height="63"/><rect x="-1.1" y="-91" width="2.2" height="63"/>'
        + '<rect x="-28" y="-.22" width="27.2" height=".44"/><rect x=".8" y="-.22" width="27.2" height=".44"/><rect x="-.22" y=".8" width=".44" height="27.2"/><rect x="-.22" y="-28" width=".44" height="27.2"/>' + dots + '</g><circle r=".45" fill="#c41d12"/></svg>';
      document.body.appendChild(e); }
    if (SCOPE.el) { SCOPE.el.style.opacity = SCOPE.k.toFixed(2); SCOPE.el.style.display = SCOPE.k > 0 ? 'block' : 'none'; }
    const f = P.fig; if (f && f.group) { if (on && !SCOPE.hid) { SCOPE.hid = true; f.group.visible = false; } else if (!on && SCOPE.hid) { SCOPE.hid = false; f.group.visible = true; } } }
  /* ================================================================== QA: drive-by (GTA-style). At the wheel (car or two wheels) hold the right button with a pistol, revolver or SMG (the best one carried is drawn
     if the hand holds anything else): a reticle comes up on the view, the left button fires along the camera ray out of the driver's window (aimed right or ahead, across the cabin).
     Third person: the gun is in the seated driver's hand at the window (arm reached out by IK); first person: the pistol rides low in the lower right of the frame. Ammo, reload, heat, tracers, flash and shells are the ones on foot. */
  const DB = { k: 0, id: null, w: null, ws: {}, cool: 0, rel: 0, el: null, on: false, side: 1, aim: V3(), o: V3(), d: V3(), q: new T.Quaternion(), qi: new T.Quaternion(), loc: V3() };
  const DB_GUNS = ['smg', 'pistol', 'revolver'], DBA = { isPlayer: true, x: 0, y: 0, z: 0, w: null };
  function dbGun() { if (!P.holstered && DB_GUNS.indexOf(P.cur) >= 0 && P.owned[P.cur]) return P.cur; for (const id of DB_GUNS) { const s = P.inv[id]; if (P.owned[id] && s && s.mag + s.reserve > 0) return id; } return null; }
  function dbUI(on, txt) { if (S.headless || typeof document === 'undefined' || !document.body) return; let e = DB.el; if (!e && on) { e = DB.el = document.createElement('div'); e.className = 'gtc-dbret'; e.style.cssText = 'position:fixed;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:21';
      e.innerHTML = '<div style="position:absolute;left:-14px;top:-14px;width:28px;height:28px;border:1.5px solid rgba(255,255,255,.85);border-radius:50%;box-shadow:0 0 2px rgba(0,0,0,.8)"></div><div style="position:absolute;left:-2px;top:-2px;width:4px;height:4px;border-radius:50%;background:#fff;box-shadow:0 0 2px #000"></div><div class="t" style="position:absolute;left:-80px;top:26px;width:160px;text-align:center;font:800 13px/1.2 Helvetica,Arial,sans-serif;color:#fff;text-shadow:0 1px 2px #000"></div>'; document.body.appendChild(e); }
    if (e) { e.style.display = on ? 'block' : 'none'; if (on && txt !== undefined) e.querySelector('.t').textContent = txt; } }
  function dbOff() { if (DB.w && DB.w.group.parent) DB.w.group.parent.remove(DB.w.group); DB.on = false; DB.k = 0; GT.combat.dbOn = false; dbUI(false); return false; }
  /** where the camera ray stops: walls, the ground, officers and gang, people in the street */
  function dbAimPt(o, d, out) { let best = 160; const w = rayBoxes(o.x, o.y, o.z, d.x, d.y, d.z, best, 0); if (w) best = w.t; if (d.y < -1e-4) { const t = (P.y - o.y) / d.y; if (t > 0 && t < best) best = t; }
    for (const e of enemies) { if (e.dead) continue; const h = hitActor(e, o.x, o.y, o.z, d.x, d.y, d.z, best); if (h) best = h.t; }
    for (const c of civs()) { if (abs(c.x - o.x) + abs(c.z - o.z) > best + 2) continue; const A = CIV.a; A.x = c.x; A.y = c.y || 0; A.z = c.z; A.h = c.h || 0; A.prone = !!c.lying; const h = hitActor(A, o.x, o.y, o.z, d.x, d.y, d.z, best); if (h) best = h.t; }
    return out.copy(o).addScaledVector(d, best); }
  function driveBy(rdt, ctx) { if (!S.inited || S.headless) return false; ctx = ctx || {}; const I = ctx.input || GT.input, cam = ctx.camera || S.cam, ent = ctx.ent; if (!I || !cam || !ent || !ent.veh || !ent.veh.group || P.dead) return dbOff();
    const dt = clamp(+rdt || 0, 0, .1); DB.cool -= dt; const id = I.down('Mouse1') ? dbGun() : null; if (!id) return dbOff();
    if (P.cur !== id || P.holstered) equip(id, true); const def = curDef(), st = P.inv[id]; if (!st) return dbOff();
    if (DB.id !== id || !DB.w) { if (DB.w && DB.w.group.parent) DB.w.group.parent.remove(DB.w.group); const kt = GT.weapons.kit ? GT.weapons.kit[id] : null; DB.w = DB.ws[id] || (DB.ws[id] = GT.weapons.make(id, { lod: 0, att: kt ? kt.att : null, tint: kt ? kt.tint : null })); DB.id = id; }
    const G = ent.veh.group, fp = !!ctx.fp; if (DB.w.group.parent !== G) G.add(DB.w.group); DB.on = true; GT.combat.dbOn = true; DB.k = min(1, DB.k + dt * 6);
    G.updateMatrixWorld(true); G.getWorldQuaternion(DB.q); DB.qi.copy(DB.q).invert();
    cam.updateMatrixWorld(); const cd = cam.getWorldDirection(DB.d); dbAimPt(cam.position, cd, DB.aim);
    /* the hand: out of the driver's window (left, ahead) or across the cabin (right); first person: low in the frame under the eye */
    const eye = ctx.eye || V3(.37, 1.08, -.3), W = (ent.dims && ent.dims.W) || 1.9, two = !!ent.two, dl = DB.loc.copy(cd).applyQuaternion(DB.qi); DB.side = dl.x > -.3 ? 1 : -1;
    if (fp) { _a.setFromMatrixColumn(cam.matrixWorld, 0); _b.setFromMatrixColumn(cam.matrixWorld, 1); DB.o.copy(cam.position).addScaledVector(cd, .42).addScaledVector(_a, .13).addScaledVector(_b, -.17); }
    else if (two) DB.o.set(.0, eye.y - .25, eye.z + .45).applyMatrix4(G.matrixWorld).addScaledVector(cd, .25);
    else if (DB.side > 0) DB.o.set(W / 2 + .12, eye.y - .1, eye.z + .22).applyMatrix4(G.matrixWorld);
    else DB.o.set(eye.x - .5, eye.y - .05, eye.z + .42).applyMatrix4(G.matrixWorld);
    _c.copy(DB.aim).sub(DB.o); if (_c.lengthSq() < 1) _c.copy(cd); _c.normalize(); quatDir(_q2, _c, UP); setWorld(DB.w.group, DB.o, _q2); DB.w.group.visible = true;
    /* the seated driver reaches the gun (third person) */
    const ks = ctx.seat; if (!fp && ks && ks.group && ks.group.visible) { const R = ks._dbR || (ks._dbR = rigOf(ks)); if (R) { ks.group.updateMatrixWorld(true); const L = DB.side > 0 || two; _d.copy(DB.o).addScaledVector(_c, -.06); ikArm(L ? R.armL : R.armR, L ? R.foreL : R.foreR, L ? R.handL : R.handR, _d, _e.set(0, -1, 0)); } }
    /* reload, fire */
    const em = (GT.weapons.effDef ? GT.weapons.effDef(id) : def).mag || def.mag;
    if (DB.rel > 0) { DB.rel -= dt; if (DB.rel <= 0) { const take = min(em - st.mag, st.reserve); st.mag += take; st.reserve -= take; SND.mech('magin', null); } }
    else if (st.mag <= 0 && st.reserve > 0) { DB.rel = def.reload || 1.5; SND.mech('magout', null); }
    const trig = def.auto ? I.down('Mouse0') : I.pressed('Mouse0');
    if (trig && DB.k > .5 && DB.rel <= 0 && DB.cool <= 0) { if (st.mag <= 0) { if (!(st.reserve > 0)) SND.mech('dry', null); DB.cool = .25; }
      else { st.mag--; DB.cool = 60 / def.rpm; P.shotT = S.time; stats.shots++; DB.w.muzzle.getWorldPosition(tr.o); DBA.x = tr.o.x; DBA.y = tr.o.y - 1.2; DBA.z = tr.o.z; DBA.w = DB.w; const aim = _c.copy(DB.aim).sub(tr.o).normalize();
        const before = stats.hits; discharge(DBA, tr.o, aim, def, (def.hip || .05) * 1.25 + (abs(ent.v || 0) > 8 ? .015 : 0)); if (stats.hits > before && HUD.hitmark) HUD.hitmark();
        emit('fire', { id, mag: st.mag, sup: !!def.sup, driveBy: true }); if (!(def.sup && !copNear(26))) heat(def.sup ? .5 : 1, 'gunfire'); } }
    dbUI(DB.k > .5, def.name + '   ' + (DB.rel > 0 ? '换弹…' : st.mag + ' / ' + st.reserve)); return true; }
  /* ================================================================== loot on the ground (QA 2026-11-17, GTA-style). What a body carried, his notes and the weapon in his hand, is tossed out beside him: it flies, tumbles,
     bounces once or twice and settles flat (the lowest corner of its box rests on the ground, never under it). A faint ring glows under it and a small marker bobs over it, so it is seen from
     down the street. Walking over it pockets it (driving over it too); a gun you already carry gives only its rounds; a melee tool you already have stays where it lies. Every item keeps its own
     clock (a corpse that is cleared does not take its loot along): LOOT_LIFE s, then it fades; past LOOT_MAX on the ground the oldest goes first. Story/test drops (no toss) work as before. */
  const PICK = [], CASH = [], LOOT_LIFE = 60, LOOT_MAX = 24, AMMO_CAP = { pistol: 250, revolver: 120, smg: 480, shotgun: 150, rifle: 600, sniper: 100, nailgun: 300, grenade: 10, molotov: 10 };
  const LT = { tex: null, box: {}, feed: null, ringGeo: null, cash: null, cashGeo: {}, n: 0 };
  function lootTex() { if (LT.tex) return LT.tex; const mk = fn => { const c = document.createElement('canvas'); c.width = c.height = 128; fn(c.getContext('2d')); const t = new T.CanvasTexture(c); if (T.sRGBEncoding) t.encoding = T.sRGBEncoding; return t; };
    const ring = mk(g => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,.30)'); gr.addColorStop(.5, 'rgba(255,255,255,.12)'); gr.addColorStop(.74, 'rgba(255,255,255,.95)'); gr.addColorStop(.84, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
    const mark = sym => mk(g => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(.42, 'rgba(255,255,255,.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 7; g.lineJoin = 'round';
      if (sym === '$') { g.font = '900 84px Arial,Helvetica,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeText('$', 64, 68); g.fillText('$', 64, 68); } else { g.beginPath(); g.moveTo(30, 42); g.lineTo(98, 42); g.lineTo(64, 90); g.closePath(); g.stroke(); g.fill(); } });
    return (LT.tex = { ring, cash: mark('$'), gun: mark('v') }); }
  /** the notes: an original banknote face, a paper-edge side, a printed band; bundles of 2–4 cm stacks, more of them the more he carried */
  function cashKit() { if (LT.cash) return LT.cash; const cv = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); if (T.sRGBEncoding) t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; };
    const face = cv(256, 112, (g, w, h) => { g.fillStyle = '#c6d2b0'; g.fillRect(0, 0, w, h); const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(120,150,110,.35)'); gr.addColorStop(.5, 'rgba(255,255,240,.1)'); gr.addColorStop(1, 'rgba(120,150,110,.35)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#3f5c3c'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12); g.lineWidth = 1; g.strokeStyle = 'rgba(63,92,60,.55)'; for (let i = 0; i < 18; i++) { g.beginPath(); g.ellipse(w / 2, h / 2, 30 + i * 6, 14 + i * 2.6, 0, 0, TAU); g.stroke(); }
      g.fillStyle = '#d7e0c4'; g.beginPath(); g.ellipse(w / 2, h / 2, 26, 34, 0, 0, TAU); g.fill(); g.fillStyle = '#4b6a47'; g.beginPath(); g.ellipse(w / 2, h / 2 - 6, 11, 13, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(w / 2, h / 2 + 22, 19, 13, 0, PI, TAU); g.fill();
      g.fillStyle = '#35502f'; g.font = '900 30px Georgia,serif'; g.textBaseline = 'top'; g.fillText('20', 14, 12); g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText('20', w - 14, h - 10); g.textAlign = 'left'; g.font = '700 11px Georgia,serif'; g.fillText('HARBOR RESERVE', 16, h - 12); g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText('TWENTY', w - 16, 14); });
    const edge = cv(64, 32, (g, w, h) => { g.fillStyle = '#e4e6d6'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 2) { g.fillStyle = y % 4 ? 'rgba(140,160,120,.55)' : 'rgba(255,255,250,.6)'; g.fillRect(0, y, w, 1); } });
    const band = cv(64, 64, (g, w, h) => { g.fillStyle = '#d9c38c'; g.fillRect(0, 0, w, h); g.fillStyle = '#8a1f1f'; g.fillRect(0, h * .2, w, 4); g.fillRect(0, h * .74, w, 4); g.fillStyle = '#5b4a22'; g.font = '700 14px Georgia,serif'; g.textAlign = 'center'; g.fillText('$500', w / 2, h * .56); });
    const M = (map, r) => new T.MeshStandardMaterial({ map, roughness: r, metalness: 0 }); const f = M(face, .78), e = M(edge, .92), b = M(band, .7);
    return (LT.cash = { face: f, edge: e, band: b, list: [e, e, f, f, e, e], bandList: [b, b, b, b, b, b] }); }
  function cashBox(th) { const k = th.toFixed(4); return LT.cashGeo[k] || (LT.cashGeo[k] = new T.BoxGeometry(.235, th, .1)); }   /* a 156 x 66 mm note, drawn 1.5 x so it reads from the street */
  function cashModel(amount) { const K = cashKit(), g = new T.Group(), r = GT.rng('cash' + amount + (LT.n++));
    const bundle = (x, y, z, ry, th, banded) => { const m = new T.Mesh(cashBox(th), K.list); m.position.set(x, y + th / 2, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; g.add(m); if (banded) { const b = new T.Mesh(cashBox(th + .003), K.bandList); b.scale.set(.16, 1, 1.03); b.position.copy(m.position); b.rotation.y = ry; g.add(b); } return y + th; };
    const loose = (y, n) => { for (let i = 0; i < n; i++) { const m = new T.Mesh(cashBox(.0016), K.list); m.position.set((r() - .5) * .08, y + .0008 + i * .0017, (r() - .5) * .05); m.rotation.y = (r() - .5) * 1.1; m.castShadow = true; g.add(m); } };
    if (amount < 40) loose(0, 2 + (amount > 20 ? 1 : 0));
    else if (amount < 120) { const y = bundle(0, 0, 0, (r() - .5) * .2, .014 + amount * .0001, true); loose(y, 1); }
    else if (amount < 300) { bundle(0, 0, -.06, (r() - .5) * .12, .022, true); bundle(.012, 0, .06, (r() - .5) * .12, .022, true); loose(.022, 1); }
    else { bundle(0, 0, -.06, (r() - .5) * .1, .026, true); bundle(0, 0, .06, (r() - .5) * .1, .026, true); bundle(0, .026, 0, HP + (r() - .5) * .2, .026, true); }
    return g; }
  /** model + ring + marker on an item; its box (corners round the pivot) is measured once per kind */
  function lootDress(it, model, key, col, sym) { if (S.headless || !S.root || !model) return; const holder = new T.Group(); holder.add(model); model.updateMatrixWorld(true);
    let B = LT.box[key]; if (!B || key === 'cash') { const bb = new T.Box3().setFromObject(model), c = bb.getCenter(V3()), s = bb.getSize(V3()); B = { c, pts: [] }; for (let i = 0; i < 8; i++) B.pts.push(V3((i & 1 ? .5 : -.5) * s.x, (i & 2 ? .5 : -.5) * s.y, (i & 4 ? .5 : -.5) * s.z)); if (key !== 'cash') LT.box[key] = B; }
    model.position.sub(B.c); it.pts = B.pts; if (it.placed) { it.low = lootLow(it, it.q); it.y = it.gy - it.low; } it.obj = holder; holder.quaternion.copy(it.q); holder.position.set(it.x, it.y, it.z); S.root.add(holder);
    const tx = lootTex(); if (!LT.ringGeo) { LT.ringGeo = new T.PlaneGeometry(1, 1); LT.ringGeo.rotateX(-HP); }
    const ring = new T.Mesh(LT.ringGeo, new T.MeshBasicMaterial({ map: tx.ring, color: col, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); ring.renderOrder = 3; ring.scale.setScalar(it.kind === 'cash' ? .78 : .95); S.root.add(ring); it.ring = ring;
    const mk = new T.Sprite(new T.SpriteMaterial({ map: sym === '$' ? tx.cash : tx.gun, color: col, transparent: true, opacity: 0, depthWrite: false, fog: false })); mk.scale.setScalar(.2); mk.renderOrder = 6; S.root.add(mk); it.mark = mk; }
  const LOOT_DEF_PTS = [-1, 1].flatMap(a => [-1, 1].flatMap(b => [-1, 1].map(c => V3(a * .1, b * .02, c * .1))));
  function lootNew(kind, x, z, y, o) { const it = { kind, x, z, y: 0, gy: 0, vx: 0, vy: 0, vz: 0, q: new T.Quaternion(), wv: V3(), air: false, bn: 0, t: 0, life: o.life || LOOT_LIFE, hold: o.hold || 0, auto: o.auto !== false, tag: o.tag || '', obj: null, ring: null, mark: null, pts: LOOT_DEF_PTS, fade: 0, fmats: null, rest: null, setT: 1, born: S.real };
    it.gy = y === undefined || y === null ? groundY(x, z, P.y) : y; it.yaw = o.h === undefined ? rnd() * TAU : o.h; it.roll = kind === 'cash' ? 0 : (rnd() < .5 ? HP : -HP);
    if (o.toss) { const dx = o.dx || 0, dz = o.dz || 0, l = hyp(dx, dz); let fx = l > .01 ? dx / l : 0, fz = l > .01 ? dz / l : 0; if (l <= .01) { const a = rnd() * TAU; fx = sin(a); fz = cos(a); } const sp = (l > .01 ? clamp(l, .6, 2.4) : 1.1) * (.85 + rnd() * .3);
      it.air = true; it.y = it.gy + (o.up === undefined ? .95 : o.up); it.vx = fx * sp; it.vz = fz * sp; it.vy = 1.9 + rnd() * .9; it.q.setFromEuler(new T.Euler(rnd() * TAU, rnd() * TAU, rnd() * TAU)); it.wv.set(rnd() - .5, rnd() - .5, rnd() - .5).normalize().multiplyScalar((kind === 'cash' ? 7 : 9) + rnd() * 6); }
    else { lootRestQ(it, it.q); it.y = it.gy; it.placed = true; it.nrm = V3(0, 1, 0); }
    return it; }
  function lootRestQ(it, out) { return out.setFromEuler(_eLoot.set(0, it.yaw, it.roll, 'YXZ')); }
  const _eLoot = new T.Euler();
  function lootLow(it, q) { let lo = 1e9; for (const p of it.pts) { const y = _c.copy(p).applyQuaternion(q).y; if (y < lo) lo = y; } return lo; }
  /** flight: gravity, tumble, bounce off the ground (twice at most) and walls, then a short settle onto its side (guns), or flat (notes) */
  function lootPhys(it, dt) { if (it.air) { it.vy -= 9.8 * dt; const nx = it.x + it.vx * dt, nz = it.z + it.vz * dt; if (!pointFree(nx, nz, .1, it.gy)) { it.vx *= -.3; it.vz *= -.3; } else { it.x = nx; it.z = nz; } it.y += it.vy * dt;
      const wl = it.wv.length(); if (wl > 1e-4) { _q3.setFromAxisAngle(_d.copy(it.wv).divideScalar(wl), wl * dt); it.q.premultiply(_q3); }
      const gy = groundY(it.x, it.z, max(it.gy, it.y - .3) + .4); if (abs(gy - it.gy) < 1.2) it.gy = gy; const lo = lootLow(it, it.q);
      if (it.y + lo <= it.gy) { it.y = it.gy - lo; if (it.vy < 0) { if (-it.vy < 1.25 || it.bn >= 2) { it.air = false; it.setT = 0; it.q0 = it.q.clone(); it.y0 = it.y; const fwd = _d.set(0, 0, 1).applyQuaternion(it.q); if (it.kind !== 'cash' && hyp(fwd.x, fwd.z) > .2) it.yaw = Math.atan2(fwd.x, fwd.z); const up = _e.set(1, 0, 0).applyQuaternion(it.q); if (it.kind !== 'cash') it.roll = up.y > 0 ? HP : -HP; it.rest = lootRestQ(it, new T.Quaternion()); it.low = lootLow(it, it.rest); lootSlope(it); it.rest.premultiply(_q3.setFromUnitVectors(UP, it.nrm)); }
        else { it.vy = -it.vy * .36; it.vx *= .55; it.vz *= .55; it.wv.multiplyScalar(.45); it.bn++; if (!S.headless && it.bn === 1 && it.kind !== 'cash') SND.mech('magout', it); } } } }
    else if (it.setT < 1) { it.setT = min(1, it.setT + dt / .2); const k = sst(it.setT, 0, 1); if (it.rest) { it.q.copy(it.q0).slerp(it.rest, k); it.y = lerp(it.y0, it.gy - it.low / max(.8, it.nrm.y), k); } } }
  /** the ground under a settled item: a sand dune or a ramp tilts it (and its ring) with the slope; a kerb edge (a step, not a slope) leaves it level */
  function lootSlope(it) { const n = it.nrm || (it.nrm = V3(0, 1, 0)); n.set(0, 1, 0); const r = .3, g0 = it.gy, f = (x, z) => groundY(x, z, g0 + .4), ax = f(it.x + r, it.z), bx = f(it.x - r, it.z), az = f(it.x, it.z + r), bz = f(it.x, it.z - r);
    if (abs((ax + bx) / 2 - g0) < .02 && abs((az + bz) / 2 - g0) < .02 && abs(ax - bx) < .35 && abs(az - bz) < .35) n.set(-(ax - bx) / (2 * r), 1, -(az - bz) / (2 * r)).normalize(); return n; }
  function lootFadeMats(it) { if (it.fmats || !it.obj) return; it.fmats = []; const seen = new Map(); const conv = m => { let c = seen.get(m); if (!c) { c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; if (m.customProgramCacheKey) c.customProgramCacheKey = m.customProgramCacheKey; c.transparent = true; seen.set(m, c); it.fmats.push(c); } return c; };
    it.obj.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material); }); }
  function lootDrop(it) { if (it.obj && it.obj.parent) it.obj.parent.remove(it.obj); for (const m of (it.fmats || [])) m.dispose(); it.fmats = null; for (const k of ['ring', 'mark']) { const o = it[k]; if (!o) continue; if (o.parent) o.parent.remove(o); o.material.dispose(); it[k] = null; } it.obj = null; }
  function removePickup(p) { const i = PICK.indexOf(p); if (i >= 0) PICK.splice(i, 1); lootDrop(p); }
  function removeCash(c) { const i = CASH.indexOf(c); if (i >= 0) CASH.splice(i, 1); lootDrop(c); }
  /** the oldest item on the ground fades out quickly when a new one would pass LOOT_MAX */
  function lootRoom() { const all = PICK.concat(CASH).filter(q => !q.going); if (all.length < LOOT_MAX) return; all.sort((a, b) => a.born - b.born); for (let i = 0; i <= all.length - LOOT_MAX; i++) { const q = all[i]; q.going = true; q.life = min(q.life, q.t + .6); } }
  function dropPickup(id, x, z, y, ammo, o) { const d = WD(id); if (!d || d.id !== id || id === 'fists') return null; o = o || {}; if (y === undefined && o.y !== undefined) y = o.y; lootRoom();
    const p = lootNew('gun', x, z, y, o); p.id = id; p.ammo = ammo === undefined ? (d.mag || 0) : ammo;
    if (!S.headless && GT.weapons && S.root) { const w = GT.weapons.make(id, { lod: 0 }); w.group.rotation.set(0, 0, 0); w.group.position.set(0, 0, 0); lootDress(p, w.group, 'w:' + id, 0xffd27a, 'v'); }
    PICK.push(p); emit('drop', { id, x, z, pickup: p }); return p; }
  function dropCash(x, z, amount, y, o) { amount = Math.round(+amount || 0); if (!(amount > 0)) return null; o = o || {}; lootRoom(); const c = lootNew('cash', x, z, y, o); c.amount = amount;
    if (!S.headless && S.root) lootDress(c, cashModel(amount), 'cash', 0x7dff9c, '$');
    CASH.push(c); emit('cashdrop', { x, z, amount }); return c; }
  /** loot(x, z, y, {cash, weapon, ammo, dx, dz}) — a body's things tossed out beside it (y = the ground under him; dx, dz = the way he was knocked) */
  function loot(x, z, y, o) { o = o || {}; const out = {}; let fx = o.dx || 0, fz = o.dz || 0; const l = hyp(fx, fz); if (l < .01) { const a = rnd() * TAU; fx = sin(a); fz = cos(a); } else { fx /= l; fz /= l; } const sx = -fz, sz = fx, s = rnd() < .5 ? 1 : -1;
    if (o.weapon) out.weapon = dropPickup(o.weapon, x + fx * .25 + sx * .2 * s, z + fz * .25 + sz * .2 * s, y, o.ammo, { toss: true, dx: (fx * .7 + sx * 1.0 * s) * (1.1 + rnd() * .5), dz: (fz * .7 + sz * 1.0 * s) * (1.1 + rnd() * .5) });
    if (o.cash > 0) out.cash = dropCash(x + fx * .2 - sx * .2 * s, z + fz * .2 - sz * .2 * s, o.cash, y, { toss: true, up: .8, dx: (fx * .5 - sx * 1.0 * s) * (.9 + rnd() * .5), dz: (fz * .5 - sz * 1.0 * s) * (.9 + rnd() * .5) });
    return out; }
  /** the pickup line under the money: green +$n, white for a weapon and its rounds */
  function lootFeed(txt, col) { if (S.headless || typeof document === 'undefined' || !document.body) return; let F = LT.feed; if (!F || !F.parentNode) { F = LT.feed = document.createElement('div'); F.className = 'gtc-lootfeed'; F.style.cssText = 'position:fixed;right:30px;top:62px;z-index:60;display:flex;flex-direction:column;align-items:flex-end;gap:2px;pointer-events:none;font:900 24px/1.12 "Helvetica Neue",Arial,sans-serif;letter-spacing:.01em'; document.body.appendChild(F); }
    try { const cc = document.querySelector('.cn-cash'); if (cc && cc.parentElement) { const cr = cc.getBoundingClientRect(); let bt = cr.bottom; if (cr.height > 0) { for (const e of cc.parentElement.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (r.height > 0 && r.height < 40 && r.right > innerWidth - 320 && r.top < cr.bottom + 60 && r.top >= cr.top) bt = max(bt, r.bottom); } F.style.top = (bt + 4) + 'px'; F.style.right = max(12, innerWidth - cr.right) + 'px'; } } } catch (e) {}
    const d = document.createElement('div'); d.textContent = txt; d.style.cssText = 'color:' + col + ';text-shadow:0 2px 2px rgba(0,0,0,.85),0 0 6px rgba(0,0,0,.5);opacity:0;transform:translateY(-8px);transition:opacity .22s,transform .22s'; F.appendChild(d); while (F.children.length > 4) F.removeChild(F.firstChild);
    requestAnimationFrame(() => { d.style.opacity = '1'; d.style.transform = 'none'; }); setTimeout(() => { d.style.opacity = '0'; }, 2800); setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 3150); }
  /** can this item go into the pocket now? a gun at its ammo cap and a melee tool already carried stay on the ground */
  function lootWants(p) { const d = WD(p.id); if (!d || d.id !== p.id) return false; if (d.kind === 'gun' || d.kind === 'throw') { const st = P.inv[p.id], cap = AMMO_CAP[p.id]; return !(P.owned[p.id] && st && cap && st.reserve + st.mag >= cap); } return !P.owned[p.id]; }
  function takePickup(p, inCar) { const d = WD(p.id), had = !!P.owned[p.id]; let got = p.ammo || 0;
    if (d.kind === 'gun') { P.owned[p.id] = true; const st = P.inv[p.id], cap = AMMO_CAP[p.id] || 1e9; if (!st) P.inv[p.id] = { mag: min(d.mag, p.ammo), reserve: max(0, p.ammo - d.mag) }; else { got = max(0, min(p.ammo, cap - st.reserve - st.mag)); st.reserve += got; } }
    else if (d.kind === 'throw') { got = max(1, p.ammo || 1); give(p.id, had ? got : got - 1); const st = P.inv[p.id]; if (st) st.reserve = min(st.reserve, (AMMO_CAP[p.id] || 10) - st.mag); }
    else give(p.id);
    removePickup(p); SND.mech('magin', P); emit('pickup', { id: p.id, first: !had, tag: p.tag, ammo: got });
    lootFeed(d.kind === 'melee' ? d.name : had ? '+' + got + ' 发  ' + d.name : d.name + '  ·  ' + got + (d.kind === 'throw' ? ' 个' : ' 发'), '#f4f1e8');
    if (!had && !inCar) { if (d.kind === 'gun' && (curDef().kind !== 'gun' || P.holstered)) { P.swing = null; P.charging = false; P.queued = false; P.autoSwap = null; if (P.mode === 'melee') P.mode = 'free'; equip(p.id); }   /* a first gun is in the hand the moment it is picked up, whatever the other hand was doing */
      else if (d.kind !== 'melee' || S.sc) { if (P.swing || P.mode !== 'free') { P.autoSwap = p.id; P.autoSwapT = .35; } else if (curDef().kind !== 'gun' || P.holstered) equip(p.id); } } }   /* a club found in the street goes to the wheel (slot 3), not straight into the hand */
  function takeCash(c) { const w = GT.wallet; if (w && w.add) { try { w.add(c.amount, 'found'); } catch (e) {} } stats.cash = (stats.cash || 0) + c.amount; SND.mech('magin', P); emit('cash', { amount: c.amount }); lootFeed('+$' + c.amount.toLocaleString('en-US'), '#7dea8c'); removeCash(c); }
  /** per frame: flight, glow, marker, fade, and the pickup check at (px, pz) — on foot, or the footprint of the car he drives (car = {h, L, W}) */
  function lootStep(rdt, px, pz, py, car) { P.nearPick = null; if (!PICK.length && !CASH.length) return; const cam = S.cam, cp = cam && cam.position; let best = null, bd = 1.8;
    const all = LT.all || (LT.all = []); all.length = 0; for (const p of PICK) all.push(p); for (const c of CASH) all.push(c);
    for (const it of all) { it.t += rdt; lootPhys(it, rdt); const left = it.life - it.t, fk = sat(left / (it.going ? .6 : 2.5)), on = sat(it.t * 2.5) * fk;
      if (left <= 0 || (cp && hyp(it.x - cp.x, it.z - cp.z) > 260)) { if (it.kind === 'cash') removeCash(it); else removePickup(it); continue; }
      if (it.obj) { it.obj.position.set(it.x, it.y, it.z); it.obj.quaternion.copy(it.q); if (fk < 1) { lootFadeMats(it); for (const m of it.fmats) m.opacity = fk; it.obj.scale.setScalar(.85 + .15 * fk); }
        const bob = sin(it.t * 2.1 + it.born) * .045, gy = it.gy; it.ring.position.set(it.x, gy + .025, it.z); if (it.nrm && !it.air) it.ring.quaternion.setFromUnitVectors(UP, it.nrm); it.ring.material.opacity = on * (.42 + .16 * sin(it.t * 2.6)) * (it.air ? .3 : 1); const dc = cp ? hyp(it.x - cp.x, it.y - cp.y, it.z - cp.z) : 5;
        it.mark.position.set(it.x, gy + .62 + bob + clamp((dc - 8) * .012, 0, .5), it.z); it.mark.scale.setScalar(.17 * clamp(dc / 9, 1, 3.2)); it.mark.material.opacity = on * clamp(.95 - (dc < 2.2 ? (2.2 - dc) * .4 : 0), .2, .95) * (it.air ? 0 : 1); }
      if (it.air || it.t < it.hold || it.going || P.dead) continue;
      let hit = false; if (car) { const dx = it.x - px, dz = it.z - pz, s = sin(car.h), c = cos(car.h), lx = dx * c - dz * s, lz = dx * s + dz * c; hit = abs(lx) < (car.W || 1.9) / 2 + .25 && abs(lz) < (car.L || 4.5) / 2 + .25 && abs(it.y - py) < 1.6; }
      else { const d = hyp(it.x - px, it.z - pz); hit = d < (it.kind === 'cash' ? 1.1 : 1.0) && abs(it.gy - py) < 1.3; if (it.kind !== 'cash' && d < bd && abs(it.gy - py) < 1.2) { bd = d; best = it; } }
      if (!hit) continue; if (it.kind === 'cash') { takeCash(it); continue; } if (it.auto && lootWants(it)) { takePickup(it, !!car); if (best === it) best = null; } }
    if (!best || P.dead || car || best.auto || !lootWants(best)) return; P.nearPick = best; if (IN && IN.pressed && IN.pressed('KeyE') && best.t >= min(best.hold, .5)) { if (IN.consume) IN.consume('KeyE'); takePickup(best); P.nearPick = null; } }

  /* ================================================================== stand-in sets (used when the real location module is not loaded, and for the test yard). Authored from y = 0; the whole group is lifted to the local ground */
  const SET = { lights: [],
    /** start a set on the footprint: lifts PROPS.group + colliders to the ground there and returns the floor function for scenario.floor */
    begin(name, x0, z0, x1, z1) { PROPS.group = new T.Group(); PROPS.group.name = name; S.propY = 0; S.floorFn = null; const fy = groundY((x0 + x1) / 2, (z0 + z1) / 2) + .03; S.propY = fy; PROPS.group.position.y = fy; if (!S.headless) S.root.add(PROPS.group);
      const fn = (x, z) => (x > x0 - .4 && x < x1 + .4 && z > z0 - .4 && z < z1 + .4 ? fy : undefined); S.floorFn = fn; return fn; },
    light(x, y, z, col, i, dist, always) { if (S.headless) return; const l = new T.PointLight(col, i, dist || 16, 2); l.position.set(x, y, z); PROPS.group.add(l); SET.lights.push({ l, i, always: !!always }); },
    /** hanging enamel shade lamp on a cable */
    lamp(k, x, y, z, drop) { k.tube('rubber', [[x, y, z], [x + .01, y - drop * .5, z], [x, y - drop, z]], .008, { seg: 5 }).cyl('metal_dark', .03, .05, .08, x, y - drop - .04, z, { seg: 10 }).cyl(GT.mat('metal_painted_white', { color: 0x3f5a4c }), .05, .24, .13, x, y - drop - .14, z, { seg: 18, open: true }).cyl('metal_dark', .242, .25, .012, x, y - drop - .205, z, { seg: 18, open: true }).sphere('light_warm', .055, x, y - drop - .17, z, { seg: 10 }); },
    /** floor slab + perimeter walls with gaps + colliders. o: { x0, z0, x1, z1, h, floor, wall, dado, band, gaps: [[side, a, b, lintel?]], tag, surf } — side n = +Z wall, s = -Z, e = +X, w = -X; a..b along the wall */
    shell(k, o) { const { x0, z0, x1, z1, h } = o, th = .3, tag = o.tag || 'combat-wall', r = GT.rng('set' + x0 + z0), wall = k ? (typeof o.wall === 'string' ? GT.mat(o.wall) : o.wall) : null, dado = k && o.dado !== undefined ? GT.mat('stucco_white', { color: o.dado, rough: .62 }) : null, band = k ? GT.mat('stucco_white', { color: o.band === undefined ? 0x2e3a36 : o.band, rough: .6 }) : null;
      if (k) { k.box(o.floor || 'concrete_stained', x1 - x0 + .7, .12, z1 - z0 + .7, (x0 + x1) / 2, -.06, (z0 + z1) / 2);
        const nd = Math.round((x1 - x0) * (z1 - z0) / 26); for (let i = 0; i < nd; i++) { const nm = ['oil_stain', 'crack', 'water_stain', 'patch', 'tire_marks', 'gum_spots', 'crack', 'water_stain'][i % 8], sz = 1.2 + r() * 2.2; k.decal(nm, sz, sz * (nm === 'tire_marks' ? 2.4 : 1), x0 + 1.5 + r() * (x1 - x0 - 3), .006 + i * .0004, z0 + 1.5 + r() * (z1 - z0 - 3), r() * TAU); } }
      for (const side of ['n', 's', 'e', 'w']) { const ns = side === 'n' || side === 's', c = side === 'n' ? z1 : side === 's' ? z0 : side === 'e' ? x1 : x0, out = side === 'n' || side === 'e' ? 1 : -1, A = ns ? x0 - th : z0, Bq = ns ? x1 + th : z1, gaps = (o.gaps || []).filter(g => g[0] === side).sort((p, q) => p[1] - q[1]), ry = side === 'n' ? PI : side === 's' ? 0 : side === 'e' ? -HP : HP;
        const piece = (a, b, y0, y1, solid) => { if (b - a < .05) return; const mid = (a + b) / 2, len = b - a, cc = c + out * th / 2, ci = c - out * .012; if (solid) { if (ns) addProp(a, min(c, c + out * th), b, max(c, c + out * th), y1, tag, o.surf); else addProp(min(c, c + out * th), a, max(c, c + out * th), b, y1, tag, o.surf); } if (!k) return;
          if (ns) k.box(wall, len, y1 - y0, th, mid, (y0 + y1) / 2, cc, { bevel: .012 }); else k.box(wall, th, y1 - y0, len, cc, (y0 + y1) / 2, mid, { bevel: .012 });
          if (y0 === 0 && dado) { const dh = o.dadoH || 1.25; if (ns) { k.box(dado, len, dh, .02, mid, dh / 2, ci).box(band, len, .05, .024, mid, dh + .025, ci).box(band, len, .12, .03, mid, .06, ci); } else { k.box(dado, .02, dh, len, ci, dh / 2, mid).box(band, .024, .05, len, ci, dh + .025, mid).box(band, .03, .12, len, ci, .06, mid); } }
          if (y0 === 0) { const ng = Math.max(1, Math.round(len / 4.5)); for (let i = 0; i < ng; i++) { const t = a + (i + .2 + r() * .6) * len / ng, gh = 1.2 + r() * 1.6, nm = r() < .5 ? 'grime_streak' : r() < .6 ? 'water_stain' : 'rust_run', q = c - out * .03; k.quad(GT.decalMat(nm), .7 + r() * 1.3, gh, ns ? t : q, Math.min(y1 - gh / 2 - .1, (o.dadoH || 1.25) + .2 + gh / 2 + r() * .6), ns ? q : t, { ry }); } } };
        let at = A; for (const g of gaps) { piece(at, g[1], 0, h, true); const lt = g[3] === undefined ? 3.1 : g[3]; if (lt < h - .1) piece(g[1], g[2], lt, h, false); if (k) { const fr = 'metal_dark'; for (const e of [g[1], g[2]]) { if (ns) k.box(fr, .14, lt, th + .08, e, lt / 2, c + out * th / 2, { bevel: .01 }); else k.box(fr, th + .08, lt, .14, c + out * th / 2, lt / 2, e, { bevel: .01 }); } if (ns) k.box(fr, g[2] - g[1] + .14, .16, th + .08, (g[1] + g[2]) / 2, lt + .08, c + out * th / 2, { bevel: .01 }); else k.box(fr, th + .08, .16, g[2] - g[1] + .14, c + out * th / 2, lt + .08, (g[1] + g[2]) / 2, { bevel: .01 }); } at = g[2]; }
        piece(at, Bq, 0, h, true); } },
    /** painted slogan / sign on the inside of a wall. side as in shell; t = centre along the wall */
    sign(k, o, side, t, y, text, w, hh, so) { if (!k || !GT.signMat) return; const c = side === 'n' ? o.z1 : side === 's' ? o.z0 : side === 'e' ? o.x1 : o.x0, out = side === 'n' || side === 'e' ? 1 : -1, ns = side === 'n' || side === 's', q = c - out * .036, ry = side === 'n' ? PI : side === 's' ? 0 : side === 'e' ? -HP : HP;
      k.quad(GT.signMat(text, Object.assign({ style: 'painted', w: 1024, h: 128, distress: .55 }, so)), w, hh, ns ? t : q, y, ns ? q : t, { ry }); },
    conduit(k, pts) { k.tube('metal_galv', pts, .018, { seg: 6 }); for (let i = 1; i < pts.length - 1; i++) k.box('metal_galv', .07, .07, .07, pts[i][0], pts[i][1], pts[i][2], { bevel: .008 }); },
    /* ---- 后巷货场: the open test yard (range / melee / cover / wheel / focus showcases and the self-test never need a world module) */
    yard() { const o = { x0: 398, z0: 390.5, x1: 446, z1: 409.5, h: 3.4, floor: 'concrete_stained', wall: GT.mat('brick_painted', { color: 0xb3a995 }), dado: 0x53705f, band: 0x2c3a33, tag: 'combat-wall', surf: 'stucco' }; SET.begin('combat_yard', o.x0, o.z0, o.x1, o.z1); const k = S.headless ? null : GT.kit(); SET.shell(k, o); if (!k) return o;
      SET.sign(k, o, 'n', 409, 2.45, '安全生产  人人有责', 5.2, .62, { color: '#a3261c' }); SET.sign(k, o, 'n', 421, 2.45, '码放整齐  轻拿轻放', 5.2, .62, { color: '#1f3f73' }); SET.sign(k, o, 's', 414, 2.4, '消防通道  严禁堆放', 4.6, .56, { color: '#a3261c' }); SET.sign(k, o, 's', 428, 2.4, '四方街农贸批发市场 · 后场', 6, .56, { color: '#27322c' }); SET.sign(k, o, 'e', 400, 2.5, '限速 5 公里', 2.6, .5, { color: '#1b1b1b' });
      for (const [sd, t, tx] of [['n', 403.2, '通下水道'], ['n', 415.4, '开锁 换锁芯'], ['n', 430.6, '高价回收 旧家电'], ['s', 407.3, '搬家 拉货'], ['s', 421.8, '空调 加氟 移机'], ['s', 436.2, '通下水道']]) SET.sign(k, o, sd, t, 1.62, tx, .62, .15, { style: 'stencil', color: '#16223a', w: 512, h: 128, distress: .35 });
      SET.conduit(k, [[398.4, 3.1, 409.42], [411, 3.1, 409.42], [411, 2.0, 409.42]]); SET.conduit(k, [[446, 2.9, 390.58], [432, 2.9, 390.58], [432, 1.6, 390.58]]); k.box('metal_galv', .5, .7, .16, 411, 1.65, 409.4, { bevel: .015 }).box('metal_painted_red', .3, .4, .18, 432, 1.4, 390.6, { bevel: .02 });
      for (const x of [404, 416, 428, 440]) { for (const z of [390.42, 409.58]) { k.box('metal_dark', .06, .5, .06, x, 3.65, z).tube('metal_dark', [[x, 3.88, z], [x, 3.95, z + (z < 400 ? .5 : -.5)], [x, 3.8, z + (z < 400 ? .9 : -.9)]], .02, { seg: 6 }).cyl('metal_dark', .09, .16, .14, x, 3.74, z + (z < 400 ? .9 : -.9), { seg: 12 }).sphere('light_warm', .06, x, 3.69, z + (z < 400 ? .9 : -.9), { seg: 8 }); } }
      for (let x = 398.2; x < 446; x += .5) { k.box('metal_rust', .02, .28, .02, x, 3.54, 409.64, { rz: .5 }); k.box('metal_rust', .02, .28, .02, x, 3.54, 390.36, { rz: -.5 }); } k.box('metal_galv', 48, .012, .012, 422, 3.62, 409.64).box('metal_galv', 48, .012, .012, 422, 3.62, 390.36);
      for (const [x, z] of [[399.2, 392], [399.3, 393.1], [444.6, 407.6], [444.8, 392.4], [437.5, 408.6]]) { k.cyl('plastic_grey', .28, .24, .9, x, .45, z, { seg: 14 }).cyl('plastic_black', .3, .3, .05, x, .92, z, { seg: 14 }); }
      k.box(GT.mat('plastic_red', { color: 0x9c3028 }), .5, .3, .36, 401.2, .15, 408.8, { bevel: .03 }).box(GT.mat('plastic_white', { color: 0x4f78a8 }), .5, .3, .36, 401.8, .15, 408.75, { bevel: .03 }).box(GT.mat('plastic_red', { color: 0x9c3028 }), .5, .3, .36, 401.5, .45, 408.8, { ry: .2, bevel: .03 });
      k.tube('rubber', [[443, .03, 408.9], [441, .03, 407.6], [442.4, .03, 406.2], [444.8, .03, 406.8]], .02, { seg: 6, steps: 24 }).cyl('metal_painted_blue', .02, .02, 1.25, 445.3, .66, 405.4, { rx: .2, seg: 6 }).box('wood_plank', .3, .04, .12, 445.3, .04, 405.3);
      PROPS.group.add(k.build()); return o; },
    /* ---- 钟楼洋行 stand-in lobby: terrazzo hall, four stone columns, teller counter with brass rail, cheque desk, benches, portico columns + three steps outside */
    lobby() { const o = { x0: 21.5, z0: 139.4, x1: 38.5, z1: 151.8, h: 5.2, floor: 'terrazzo', wall: 'stucco_cream', dado: 0x4a3524, band: 0x2a1d13, dadoH: 1.35, gaps: [['s', 28.4, 31.6, 3.3]], tag: 'combat-wall', surf: 'stucco' }; const fn = SET.begin('combat_lobby', 18, 131, 42, 152.2); const k = S.headless ? null : GT.kit(); SET.shell(k, o);
      for (const [x, z] of [[25.6, 143.2], [34.4, 143.2], [25.6, 148.4], [34.4, 148.4]]) { addProp(x - .5, z - .5, x + .5, z + .5, 5.2, 'combat-column', 'stucco'); if (k) { k.box('stucco_white', 1.04, .34, 1.04, x, .17, z, { bevel: .03 }).cyl('stucco_white', .46, .5, .16, x, .42, z, { seg: 24 }).cyl('stucco_white', .4, .43, 4.1, x, 2.55, z, { seg: 24 }).cyl('stucco_white', .5, .41, .2, x, 4.7, z, { seg: 24 }).box('stucco_white', 1.08, .3, 1.08, x, 4.95, z, { bevel: .03 }); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; k.box(GT.mat('stucco_white', { color: 0xc9c5b8 }), .03, 3.9, .03, x + sin(a) * .415, 2.55, z + cos(a) * .415, { ry: a }); } k.geo(GT.decalMat('grime_streak'), new T.PlaneGeometry(.7, 1.2), { x, y: .9, z: z - .47 }); } }
      addProp(35.6, 141.6, 36.4, 149.4, 1.16, 'combat-teller-counter', 'wood'); addProp(24.4, 145.1, 25.5, 147.4, 1.1, 'combat-desk', 'wood'); for (const x of [25.2, 34.8]) addProp(x - .85, 139.75, x + .85, 140.35, .5, 'combat-bench', 'wood'); for (const x of [24.6, 27.6, 32.4, 35.4]) addProp(x - .45, 137.75, x + .45, 138.65, 5.2, 'combat-column', 'stucco');
      if (!k) return fn; const wd = GT.mat('wood_plank', { color: 0x5a3a22, rough: .42 }), wdD = GT.mat('wood_plank', { color: 0x3c2616, rough: .5 }), brass = GT.mat('chrome', { color: 0xb8924a, rough: .28 }), marble = GT.mat('terrazzo', { color: 0x2f3a36, rough: .2 });
      k.box(wd, .8, 1.05, 7.8, 36, .525, 145.5, { bevel: .02 }).box(marble, .96, .06, 7.9, 36, 1.11, 145.5, { bevel: .015 }).box(wdD, .84, .14, 7.84, 36, .07, 145.5, { bevel: .01 }); for (let i = 0; i < 6; i++) { const z = 142.1 + i * 1.36; k.box(wdD, .03, .7, 1.1, 35.585, .6, z, { bevel: .01 }).box(brass, .05, 1.0, .05, 36.2, 1.64, z - .66, { bevel: .01 }).box('glass_clear', .02, .84, 1.26, 36.2, 1.62, z).box(brass, .06, .04, 1.34, 36.2, 2.14, z).box(brass, .2, .02, .3, 36.0, 1.15, z, { bevel: .005 }); }
      k.cyl(brass, .02, .02, 7.6, 35.5, .22, 145.5, { rx: HP, seg: 8 }); for (let i = 0; i < 5; i++) k.cyl(brass, .012, .012, .16, 35.52, .14, 142.2 + i * 1.65, { seg: 6 });
      k.box(wd, 1.0, .08, 2.2, 24.95, 1.06, 146.25, { bevel: .02 }).box(wdD, .9, 1.0, .08, 24.95, .5, 145.25, { bevel: .01 }).box(wdD, .9, 1.0, .08, 24.95, .5, 147.25, { bevel: .01 }).box(wdD, .06, .7, 1.9, 24.95, .6, 146.25).box(brass, .12, .2, .12, 24.9, 1.2, 145.6, { bevel: .02 }).box('plastic_white', .22, .012, .3, 25.0, 1.106, 146.4, { ry: .3 }).box('plastic_white', .22, .012, .3, 24.8, 1.108, 146.9, { ry: -.2 });
      for (const x of [25.2, 34.8]) { k.box(wdD, 1.6, .16, .5, x, .08, 140.05, { bevel: .02 }).box('leather_tan', 1.68, .3, .58, x, .31, 140.05, { bevel: .05 }); }
      k.box('ceiling_panel', 17.6, .2, 13, 30, 5.3, 145.6); for (const z of [141.6, 145.8, 150]) k.box('stucco_white', 17, .34, .5, 30, 5.03, z, { bevel: .03 }); for (const x of [25.6, 34.4]) k.box('stucco_white', .5, .34, 12.4, x, 5.03, 145.6, { bevel: .03 });
      for (const [x, z] of [[30, 143.2], [30, 148.4]]) { k.cyl(brass, .012, .012, 1.3, x, 4.5, z, { seg: 6 }); k.geo(brass, new T.TorusGeometry(.5, .02, 6, 24), { x, y: 3.85, z, rx: HP }); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; k.sphere('light_warm', .07, x + sin(a) * .5, 3.95, z + cos(a) * .5, { seg: 8 }).cyl(brass, .03, .012, .08, x + sin(a) * .5, 3.86, z + cos(a) * .5, { seg: 6 }); } SET.light(x, 3.6, z, 0xffd9a8, 1.5, 15, true); }
      SET.sign(k, o, 'e', 145.5, 3.2, '营业窗口   储蓄 · 汇兑 · 保管箱', 6.4, .5, { color: '#b8924a', bg: '#2a1d13' }); SET.sign(k, o, 'n', 30, 3.3, '诚信为本   钟楼洋行   一九二六', 7.2, .6, { color: '#b8924a', bg: '#2a1d13' }); SET.sign(k, o, 'w', 146, 2.6, '大堂内请勿吸烟', 2.2, .3, { color: '#3a2a1c' });
      k.box(GT.mat('carpet', { color: 0x5a1c1a }), 3.0, .012, 8.6, 30, .008, 144.4);
      // portico: steps, columns, signboard, stone apron
      k.box('concrete', 24, .1, 8.4, 30, -.05, 135.2); for (let i = 0; i < 3; i++) k.box('stucco_white', 15 - i * .4, .06, .5, 30, -.03 - i * .0001, 139.1 - i * .5, { bevel: .01 });
      for (const x of [24.6, 27.6, 32.4, 35.4]) k.box('stucco_white', .96, .3, .96, x, .15, 138.2, { bevel: .03 }).cyl('stucco_white', .36, .4, 4.5, x, 2.55, 138.2, { seg: 20 }).box('stucco_white', 1.0, .3, 1.0, x, 4.95, 138.2, { bevel: .03 }); k.box('stucco_cream', 13, .9, 1.4, 30, 5.55, 138.4, { bevel: .03 });
      if (GT.signMat) k.quad(GT.signMat('钟 楼 洋 行', { style: 'painted', color: '#b8924a', bg: '#1d1611', w: 1024, h: 192, distress: .4 }), 6.4, .76, 30, 5.55, 137.69, { ry: PI });
      k.box(wdD, .1, 3.2, 1.5, 28.42, 1.6, 138.75, { ry: .5, bevel: .02 }).box(wdD, .1, 3.2, 1.5, 31.58, 1.6, 138.75, { ry: -.5, bevel: .02 }).box(brass, .04, .5, .04, 28.75, 1.2, 138.2).box(brass, .04, .5, .04, 31.25, 1.2, 138.2);
      PROPS.group.add(k.build()); return fn; },
    /* ---- 码头仓库 stand-in: corrugated shed, north door, west back door, trusses + lamps, the cage in the SW corner. Cover comes from PROPS */
    wharf(sc) { const o = { x0: -54, z0: -176, x1: -24, z1: -136, h: 7.5, floor: 'concrete_stained', wall: GT.mat('corrugated_metal', { color: 0x7f8a8c }), dado: 0x3f5868, band: 0x232c33, dadoH: 1.4, gaps: [['n', -43, -35, 4.4], ['w', -151.5, -148.5, 2.6]], tag: 'combat-wh wall', surf: 'metal' }; const fn = SET.begin('combat_wharf', -58, -180, -20, -128); const k = S.headless ? null : GT.kit(); SET.shell(k, o);
      const c = { x0: -53.6, x1: -46.6, z0: -175.6, z1: -168.6 }; addProp(c.x0, c.z1 - .06, c.x1, c.z1 + .06, 3, 'combat-cage', 'metal'); addProp(c.x1 - .06, c.z0, c.x1 + .06, c.z1 - 2.2, 3, 'combat-cage', 'metal'); sc.cageDoorBox = addProp(c.x1 - .06, c.z1 - 2.2, c.x1 + .06, c.z1 - .9, 3, 'combat-cageDoor', 'metal'); addProp(c.x1 - .06, c.z1 - .9, c.x1 + .06, c.z1, 3, 'combat-cage', 'metal');
      PROPS.begin(); PROPS.crate(-47.9, -141.9, 1.2, .04); PROPS.crate(-46.7, -141.8, 1.2, -.05); PROPS.crate(-47.3, -141.85, 1.1, .2, 1.2, '易碎 · 向上'); PROPS.pallet(-33.4, -142.6, .06); PROPS.crate(-39.4, -146.8, 1.2, .1, 0, '江城港务'); PROPS.drums(-48.3, -145.9); PROPS.barrier(-42, -151.2, 2.4, true);
      PROPS.crate(-46.2, -157, 1.2, 0); PROPS.crate(-45, -157.05, 1.2, .08); PROPS.crate(-43.8, -157, 1.2, -.05); PROPS.crate(-44.4, -157, 1.1, .3, 1.2); PROPS.pallet(-34.2, -159.6, .1); PROPS.pallet(-35.6, -159.9, -.08); PROPS.crate(-51, -162.2, 1.2, .05); PROPS.crate(-49.8, -162.3, 1.2, -.1); PROPS.crate(-50.4, -162.2, 1.1, .2, 1.2, '易碎 · 向上');
      PROPS.crate(-40.6, -164.6, 1.9, .03, 0, '重心 ↓ 勿倒置'); PROPS.drums(-36, -169.9); PROPS.pallet(-44.2, -172.4, .05); PROPS.forklift(-37.4, -152.6, .0); PROPS.van(-28.6, -158, 0); PROPS.barrier(-31.5, -147.5, 2.4, false); PROPS.end();
      if (!k) return fn; const D = 'metal_dark', G = 'metal_galv';
      k.box('concrete_stained', 22, .1, 9, -39, -.055, -131.4); k.decal('tire_marks', 2.4, 9, -39, .012, -136, 0); k.decal('oil_stain', 3, 3, -37, .012, -150, .7);
      for (let z = -172; z <= -140; z += 8) { k.box(D, 30, .22, .14, -39, 7.4, z, { bevel: .01 }).box(D, 30, .14, .1, -39, 6.5, z, { bevel: .01 }); for (let x = -53; x <= -25; x += 2) k.box(D, .06, 1.3, .06, x + 1, 6.95, z, { rz: (Math.round(x / 2) % 2 ? .78 : -.78) }); for (const x of [-46, -32]) { SET.lamp(k, x, 6.5, z, 1.5); } }
      for (const x of [-53.84, -24.16]) for (let z = -176; z <= -136; z += 8) k.box(D, .24, 7.5, .24, x, 3.75, z, { bevel: .02 }).box(D, .5, .04, .5, x, .02, z);
      SET.light(-39, 5, -146, 0xffd3a0, 1.9, 22); SET.light(-39, 5, -164, 0xffd3a0, 1.9, 22); SET.light(-49.6, 2.6, -172.4, 0xbfd8ff, .9, 8);
      SET.sign(k, o, 'w', -160, 5.2, '安全第一  预防为主', 6, .9, { color: '#a3221a', bg: '#e9e4d2' }); SET.sign(k, o, 's', -37, 5.2, '码放整齐  轻拿轻放', 6, .9, { color: '#1d3f78', bg: '#e9e4d2' }); SET.sign(k, o, 'e', -150, 2.2, '库区重地  严禁烟火', 3.2, .5, { color: '#a3221a' });
      SET.conduit(k, [[-24.36, 2.2, -140.6], [-24.36, 6.2, -140.6], [-24.36, 6.2, -152]]); k.box(G, .16, .8, .6, -24.3, 1.8, -140.6, { bevel: .015 }); for (const z of [-139.2, -139.6]) k.cyl('metal_painted_red', .07, .07, .46, -24.42, .28, z, { seg: 10 }).cyl(D, .02, .02, .1, -24.42, .56, z, { seg: 6 });
      // the cage: galvanised frame + mesh bars, a camp bed inside
      const bars = (xa, za, xb, zb) => { const L = hyp(xb - xa, zb - za), nb = Math.round(L / .16); for (let i = 0; i <= nb; i++) k.box(G, .014, 2.9, .014, lerp(xa, xb, i / nb), 1.5, lerp(za, zb, i / nb)); for (const y of [.06, 1.5, 2.94]) k.box(G, abs(xb - xa) + .05, .05, abs(zb - za) + .05, (xa + xb) / 2, y, (za + zb) / 2, { bevel: .008 }); };
      bars(c.x0, c.z1, c.x1, c.z1); bars(c.x1, c.z0, c.x1, c.z1 - 2.2); bars(c.x1, c.z1 - .9, c.x1, c.z1); for (const [x, z] of [[c.x1, c.z1], [c.x1, c.z1 - 2.2], [c.x1, c.z1 - .9], [c.x0 + .1, c.z1]]) k.box(G, .08, 3, .08, x, 1.5, z, { bevel: .01 });
      k.box(G, 1.9, .04, .7, -52, .36, -174.6, { bevel: .01 }).box(GT.mat('fabric_dark', { color: 0x4a5a44 }), 1.86, .08, .66, -52, .42, -174.6, { bevel: .03 }); for (const dx of [-.85, .85]) for (const dz of [-.3, .3]) k.cyl(G, .015, .015, .36, -52 + dx, .18, -174.6 + dz, { seg: 6 }); k.cyl('plastic_red', .14, .12, .26, -50.2, .13, -174.9, { seg: 12 });
      PROPS.group.add(k.build());
      if (!S.headless) { const dk = GT.kit(); for (let i = 0; i <= 8; i++) dk.box(G, .014, 2.9, .014, 0, 1.5, -i * .1625); for (const y of [.06, 1.5, 2.94]) dk.box(G, .05, .05, 1.35, 0, y, -.65, { bevel: .008 }); dk.box(D, .06, .14, .1, .03, 1.4, -1.24, { bevel: .01 }); const dg = dk.build(); dg.position.set(c.x1, 0, c.z1 - .9); PROPS.group.add(dg); sc.cageDoorMesh = dg; }
      return fn; }
  };

  /* ================================================================== scenarios */
  function clear() { for (const e of enemies) { if (e.fig && e.fig.group.parent) e.fig.group.parent.remove(e.fig.group); } enemies.length = 0; S.tokens.peek = S.tokens.melee = 0; S.flanker = null; S.targets.length = 0; S.flood = null; S.dark = 0; S.hitcam = null; S.noise.length = 0; S.sc = null; S.meleeFreeAt = 0; while (PICK.length) removePickup(PICK[0]); while (CASH.length) removeCash(CASH[0]); SET.lights.length = 0; S.propY = 0; S.floorFn = null;
    if (PROPS.group) { if (PROPS.group.parent) PROPS.group.parent.remove(PROPS.group); PROPS.group = null; } GT.world.boxes = GT.world.boxes.filter(b => !b.combat); S.coverKey = ''; FX.clear(); }
  function resetPlayer(x, z, h, loadout) { Object.assign(P, { x, z, h, y: groundY(x, z), hp: P.maxHp, armor: 0, focus: 1, mode: 'free', dead: false, prone: false, down: 0, usedLastStand: false, cover: null, swing: null, reload: null, reloadK: 0, vx: 0, vz: 0, tiltX: 0, yOff: 0, aimK: 0, crouchK: 0, fallT: 0, hitDirs: [], lastHitT: -99, charging: false, roll: null, vault: null, lock: null, cool: 0, bloom: 0, stagK: 0, lsKill: false, autoSwap: null, nearPick: null, lastBulletT: -9, emptyT: -9 }); S.meleeFreeAt = 0;
    CAM.yaw = h; CAM.pitch = .1; CAM.init = false; CAM.kick = CAM.kickYaw = 0; for (const k in stats) stats[k] = 0; if (loadout) { P.owned = { fists: true }; P.inv = {}; P.melee = null; for (const id of loadout) give(id); disarmActor(P); P.w = null; P.cur = 'fists'; P.holstered = true; syncHelmet(); }
    const ctl = S.ctx && S.ctx.ctl; if (ctl && ctl.teleport) { try { ctl.teleport(x, z, h); if (ctl.camera) ctl.camera.yaw = h; } catch (e) {} } }
  const ALL = ['helmet', 'bat', 'pipe', 'pistol', 'revolver', 'shotgun', 'smg'];
  const AN = n => GT.world.anchors[n] || null;
  const resultOf = sc => ({ state: 'clear', time: +(S.time - (sc.t0 || 0)).toFixed(1), kills: stats.kills, headshots: stats.headshots, accuracy: stats.shots ? +(stats.hits / stats.shots).toFixed(2) : 0, damageTaken: Math.round(stats.damageTaken), takedowns: stats.takedowns, meleeHits: stats.meleeHits, downed: enemies.filter(e => e.out).length });
  const setBeat = (sc, b, obj) => { sc.beat = b; if (obj !== undefined) sc.objective = obj; emit('scenario', { name: sc.name, beat: b, result: sc.result }); };
  const faceTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
  const SCN = {
    /* mission 3 「加急件」: the hand-off in the 钟楼洋行 lobby is an ambush. Helmet first, then the pistol a 马仔 drops, a gunfight in the hall, one more on the steps, back to the scooter.
       beats: handoff -> brawl -> pistol -> gunfight -> steps -> escape -> done   (5 enemies: 3 马仔 + 2 枪手) */
    lobby() {
      const real = !!(AN('clockLobby') && AN('handoff')) && !S.standin, L = real ? AN('clockLobby') : { x: 30, z: 145.3 }, H0 = real ? AN('handoff') : { x: 30, z: 133.2 }, SF = real && AN('clockStairFoot') ? AN('clockStairFoot') : { x: 34.2, z: 150.4 }, DR = real && AN('clockDoor') ? AN('clockDoor') : { x: 30, z: 139.5 };
      const sc = { name: 'lobby', beat: 'handoff', objective: '跟爷叔进大堂 · 箱子抱牢', t: 0, t0: 0, done: false, failed: false, result: null, lock: true, lastWave: false, hours: 17.6, real, goal: { x: L.x, z: L.z }, exit: { x: H0.x, z: H0.z }, door: { x: DR.x, z: DR.z }, pistol: null, floor: null };
      if (!real) sc.floor = SET.lobby(); else { PROPS.group = new T.Group(); PROPS.group.name = 'combat_lobby'; if (!S.headless) S.root.add(PROPS.group); }
      /* glass the hall did not have: a three-pane screen on brass posts along the cheque desk (in the middle of the crossfire) and a pane in each of the four teller windows. All of it breaks. */
      sc.panes = []; if (real) { const F0 = groundY(35.7, 145.6, 1), yA = F0 + 1.42, yB = F0 + 2.34, zs = [144.42, 145.22, 146.02, 146.78], cy = F0 + 1.1; for (let i = 0; i < 3; i++) paneMake(sc, 35.7, zs[i] + .03, zs[i + 1] - .03, yA, yB); for (const z of [142, 144.4, 146.8, 149.2]) paneMake(sc, 40.2, z - .4, z + .4, cy + .05, cy + .64);
        if (!S.headless && GT.kit) { const kk = GT.kit(), br = GT.mat('chrome', { color: 0xb8924a, rough: .28 }); for (const z of zs) kk.box(br, .04, yB - yA + .08, .04, 35.7, (yA + yB) / 2 + .02, z, { bevel: .006 }); kk.box(br, .05, .035, zs[3] - zs[0] + .06, 35.7, yB + .05, (zs[0] + zs[3]) / 2, { bevel: .006 }); for (const z of zs) kk.sphere(br, .032, 35.7, yB + .1, z, { seg: 8, seg2: 6 }); PROPS.group.add(kk.build()); } }
      resetPlayer(H0.x, H0.z, 0, ['helmet']); if (P.fig && P.fig.setBox) { try { P.fig.setBox(true); } catch (e) {} }
      const mk = (kind, dx, dz, o) => { const x = L.x + dx, z = L.z + dz, e = spawn(kind, x, z, Object.assign({ h: faceTo(x, z, DR.x, DR.z), group: 'lb' }, o)); e.hold = true; return e; };
      if (real && GT.landmarks && GT.landmarks.layout && GT.landmarks.layout.clock) { const c = GT.landmarks.layout.clock; sc.camBox = { x0: c.WB + .4, x1: c.X1 - .9, z0: c.ZS + .6, z1: c.ZN - .7, y1: c.CE - .5 }; } sc.difficulty = .75; sc.bounds = { x0: 14, x1: 46, z0: 130, z1: 152 }; sc.meleeGap = .9; sc.hurtK = 1.4; sc.spikeCap = 30; sc.regen = { delay: 6.5, rate: 7, cap: .7 };   /* a breath between two of their swings; the two gunmen hurt; health comes back slowly and only to 70 */
      sc.w1 = [mk('thug', -3.3, 1.3, { seed: 3, weapon: 'pipe', hp: 110 }), mk('thug', 3.5, 2.1, { seed: 5, weapon: 'bat', hp: 100 }), mk('thug', .5, 3.3, { seed: 2, weapon: 'fists', hp: 90 })];
      const wait = (e, on) => { e.orbit = e.noSwing = !!on; if (on && (e.state === 'chase' || e.state === 'recover')) { e.state = 'circle'; e.t = 1; } }, ammoLeft = () => { let k = 0; for (const id in P.inv) if (P.owned[id]) k += P.inv[id].mag + P.inv[id].reserve; return k; };
      /* dry with a gunman still up (gunfight and steps beats): the guns they dropped are pointed out — a line, and a glint on each every .7 s —, and when there is none on the floor one more magazine has slid out from under the counter, once per beat.
         (It used to exist in the gunfight beat only and never mentioned the dropped guns: the game swapped to the helmet against the man on the steps, play report b3-story1.) */
      const dry = dt => { if (!P.owned.pistol || ammoLeft() > 0 || !enemies.some(e => !e.out && !e.melee)) { sc.dryTold = false; return; } const guns = PICK.filter(p => WD(p.id).kind === 'gun');
        if (guns.length) { if ((sc.dryT = (sc.dryT || 0) - dt) <= 0) { sc.dryT = .7; for (const p of guns) FX.glint(_a.set(p.x, (p.y || 0) + .09, p.z)); } if (!sc.dryTold) { sc.dryTold = true; say('阿凯', '打空了。地上有他们掉的枪 · 走过去按 E。', 2.6); } return; }
        const key = 'resup_' + sc.beat; if (sc[key]) return; sc[key] = true; const a = rnd() * TAU; let rx = P.x + sin(a) * 2.6, rz = P.z + cos(a) * 2.6; if (!pointFree(rx, rz, .25, P.y)) { rx = L.x; rz = L.z; } dropPickup('pistol', rx, rz, undefined, 12, { hold: .4 }); say('阿凯', '地上还有一个弹匣。', 2); };
      sc.update = dt => { sc.t += dt; const alive = () => enemies.filter(e => !e.out).length; for (const q of sc.panes) if (q.t > 0 && (q.t -= dt) <= 0) paneBurst(q, null);
        /* the first gun is protected: nothing lands from the moment it drops until its title band has gone (4.2 s of real time after the pickup), the gunfight starts only then, and the view is kept near level under the band */
        if (P.owned.pistol && !sc.gotR) sc.gotR = S.real; const band = !!sc.gotR && S.real - sc.gotR < 4.2; sc.safe = sc.beat === 'pistol' || band; if (band) CAM.pitch = damp(CAM.pitch, clamp(CAM.pitch, -.22, .45), 7, dt);
        if (sc.beat === 'handoff') { if (hyp(P.x - sc.goal.x, P.z - sc.goal.z) < 3.4 || sc.w1.some(e => e.alert)) { sc.t0 = S.time; for (const e of sc.w1) { e.hold = false; e.lastSeen = { x: P.x, z: P.z, t: S.time }; if (!e.alert) e.alertAt = S.time + .2 + rnd() * .5; } wait(sc.w1[1], true); wait(sc.w1[2], true);   /* the first comes alone; the other two hang back at arm's length until he is down (or six seconds) */ say('二筒 · 电话', '箱子留下。人，就别走了。', 2.6); if (P.holstered || P.cur === 'fists') equip('helmet'); setBeat(sc, 'brawl', '有埋伏！抡起头盔'); } }
        else if (sc.beat === 'brawl') { const outs = sc.w1.filter(e => e.out); sc.objective = '有埋伏！抡起头盔 · 剩 ' + (3 - outs.length); if (!sc.rel2 && (outs.length >= 1 || S.time - sc.t0 > 6)) { sc.rel2 = true; wait(sc.w1[1], false); wait(sc.w1[2], false); if (outs.length) bark(sc.w1[1], 'melee', true); }
          /* the second one down had the pistol in his belt: it lands beside him, not at the player's feet, and lies there a second before it can be walked over — the last 马仔 backs off at the sight of it */
          if (outs.length >= 2 || (outs.length === 1 && S.time - sc.t0 > 40)) { const d = sc.w1.filter(e => e.out).sort((a, b) => hyp(b.x - P.x, b.z - P.z) - hyp(a.x - P.x, a.z - P.z))[0], dx = P.x - d.x, dz = P.z - d.z, l = hyp(dx, dz) || 1; let px = d.x - dz / l * .55, pz = d.z + dx / l * .55; if (hyp(px - P.x, pz - P.z) < 1.25) { px = P.x - dx / l * 1.35 - dz / l * .4; pz = P.z - dz / l * 1.35 + dx / l * .4; } if (!pointFree(px, pz, .2, d.y)) { px = d.x; pz = d.z; }
            sc.pistol = dropPickup('pistol', px, pz, d.y, 48, { tag: 'lobby-pistol', hold: 1.3 }); for (const e of sc.w1) if (!e.out) wait(e, true); say('阿凯', '……他腰上别着枪。', 2); sc.tp = S.time; sc.tpR = S.real; setBeat(sc, 'pistol', '捡起地上的手枪'); } }
        else if (sc.beat === 'pistol') { if (sc.pistol && !P.owned.pistol && (sc.glT = (sc.glT || 0) - dt) <= 0) { sc.glT = .75; FX.glint(_a.set(sc.pistol.x, sc.pistol.y + .09, sc.pistol.z)); }   /* it catches the light where it lies */
          if ((sc.gotR && S.real - sc.gotR > 4.2) || S.real - sc.tpR > 30) {   /* nobody moves until the band is gone; a player who will not pick it up gets half a minute */ for (const e of sc.w1) if (!e.out) wait(e, false); sc.g1 = spawn('gunman', SF.x, SF.z, { h: faceTo(SF.x, SF.z, P.x, P.z), seed: 1, group: 'lb', alert: true }); sc.graceTo = S.time + 2; say('枪手', '二筒哥说了，连人带箱子一起留下！', 2.4); setBeat(sc, 'gunfight', ''); } }
        else if (sc.beat === 'gunfight') { const n = alive(); sc.objective = (P.owned.pistol ? '大堂枪战 · 找掩体（E）· 剩 ' : '捡起地上的手枪 · 剩 ') + n;
          dry(dt);
          if (n === 0) { sc.lastWave = true; const gx = sc.exit.x + 3.4, gz = sc.exit.z + .8; sc.g2 = spawn('gunman', gx, gz, { h: faceTo(gx, gz, sc.door.x, sc.door.z), seed: 4, weapon: 'revolver', group: 'lb2', alert: true }); sc.g2.lastSeen = { x: P.x, z: P.z, t: S.time }; sc.g2.hp = sc.g2.maxHp = 110; sc.stT = S.time; say('枪手', '他要跑！堵住门口！', 2); setBeat(sc, 'steps', '门口台阶上还有一个 · 杀出去'); } }
        else if (sc.beat === 'steps') { const g = sc.g2; dry(dt);   /* he does not wait outside behind a wall: three seconds without a sight of the player and he comes for him — up the steps, through the door (a point either side of it, so he does not walk into the wall), gun first; again every time he loses him */
          if (g && !g.out) { const busy = g.state === 'stagger' || g.state === 'down' || g.state === 'getup' || g.state === 'reload';
            const mid = !!(sc.wp && sc.wp.length);   /* part-way through the door: he finishes coming through even with the player in sight — he used to stop on the threshold behind the open leaf and put every burst into it (0 damage for 18 s, play report b3-story1) */
            if (g.sees && !mid) { sc.stT = S.time; sc.wp = null; }
            else if (!busy && S.time - sc.stT > (mid ? 1.2 : 3) && g.state !== 'hunt') { const gin = g.z > sc.door.z + 1.9, pin = P.z > sc.door.z + .5, wo = { x: sc.door.x, z: sc.door.z - 1.9 }, wi = { x: sc.door.x, z: sc.door.z + 3 };   /* 'inside' is two metres past the threshold, clear of the door leaves (the inner point used to be 1.7 m in with a 1.1 m arrival radius: he was 'there' at 0.6 m) */ sc.stT = S.time; if (g.cover && g.cover.user === g) g.cover.user = null; g.cover = null; freeTokens(g); g.state = 'hunt'; g.t = 12; g.speed = 4.6; sc.wp = gin === pin ? [] : gin ? [wi, wo] : g.z > sc.door.z - 1 ? [wi] : [wo, wi]; if (!sc.wp.length) g.lastSeen = { x: P.x, z: P.z, t: S.time }; }
            if (sc.wp && sc.wp.length && g.state === 'hunt') { const w = sc.wp[0]; if (hyp(w.x - g.x, w.z - g.z) < .8) { sc.wp.shift(); g.via = sc.wp[0] || null; if (!sc.wp.length) { g.lastSeen = { x: P.x, z: P.z, t: S.time }; sc.stT = S.time; } } else { g.via = w; if (!g.sees) g.lastSeen = { x: w.x, z: w.z, t: S.time }; } } else g.via = null; }
          if (alive() === 0 && !S.hitcam) setBeat(sc, 'escape', '清场了 · 回到台阶下的电瓶车'); }
        else if (sc.beat === 'escape') { if (hyp(P.x - sc.exit.x, P.z - sc.exit.z) < 2.6) { sc.done = true; sc.lock = false; sc.result = resultOf(sc); holster(); setBeat(sc, 'done', ''); } } };
      return sc; },
    /* mission 5 「收账」: the 码头仓库 finale. Two waves (5 + 4, 二筒 himself is the heavy with the shotgun), then open the cage for 阿烈 and leave by the back door for the pier.
       beats: enter -> wave1 -> wave2 -> free -> pier -> done */
    wharf() {
      const real = !!(AN('wharfDoor') && AN('wharfCage')) && !S.standin, W = { x0: -54, x1: -24, z0: -176, z1: -136 }, A = (n, d) => (real && AN(n)) || d, SPN = [[-47, -148.5], [-33, -151], [-42.5, -140.5], [-47.5, -167], [-34.5, -166], [-38, -158], [-51, -155], [-28, -143.5]], sp = i => A('wharfSpawn' + i, { x: SPN[i][0], z: SPN[i][1] });
      const D = A('wharfDoor', { x: -39, z: -134.4 }), CG = A('wharfCage', { x: -45.3, z: -170.15 }), CI = A('wharfCageInside', { x: -50.6, z: -172.6 }), HV = A('wharfHeavy', { x: -40, z: -168.5 }), BD = A('wharfBackDoor', { x: -52.6, z: -150 }), PR = A('wharfPierStart', { x: -56.6, z: -150 }), MZ = real ? AN('wharfMezz') : null;
      const sc = { name: 'wharf', beat: 'enter', objective: '进码头仓库 · 找到阿烈', t: 0, t0: 0, done: false, failed: false, result: null, lock: true, lastWave: false, hours: 21, real, bounds: { x0: W.x0, x1: W.x1, z0: W.z0, z1: W.z1 - .6 }, goal: { x: D.x, z: W.z1 - 4.2 }, cage: { x: CG.x, z: CG.z }, back: { x: BD.x + 1.2, z: BD.z }, pier: { x: PR.x, z: PR.z }, freed: false, floor: null, lie: null, hurtK: .8, meleeGap: 1.0, meleeK: .8 };   /* nine guns in two waves: each bullet lands at four fifths of what it does on the street (five eighths made it a shooting gallery: 7 hp lost in 39 s) */
      if (!real) sc.floor = SET.wharf(sc); else { PROPS.group = new T.Group(); PROPS.group.name = 'combat_wharf'; if (!S.headless) S.root.add(PROPS.group); }
      resetPlayer(D.x, D.z, PI, ['helmet', 'pipe', 'pistol', 'revolver', 'smg']); P.armor = 50; equip('pistol', true);
      /* two crate stacks just inside the door, either side of the lane: the cover the entrance did not have (E snaps to them). Skipped where the set already has something standing */
      if (real) { const fy = groundY(D.x, W.z1 - 3, 0), kk = !S.headless && GT.kit ? GT.kit() : null; let any = false; for (const [cx, cz, w, dp, hh, ry] of [[D.x - 2.5, W.z1 - 2.5, 1.5, 1.0, 1.12, .06], [D.x + 2.4, W.z1 - 3.3, 1.2, 1.1, 1.12, -.1]]) { if (!pointFree(cx, cz, .75, fy)) continue; any = true; addProp(cx - w / 2, cz - dp / 2, cx + w / 2, cz + dp / 2, fy + hh, 'combat crate stack', 'wood');
          if (kk) { kk.push(cx, fy, cz, { ry }); kk.box('wood_plank', w, .56, dp, 0, .28, 0, { bevel: .015 }); kk.box('wood_plank', w * .62, .54, dp * .9, -w * .16, .84, .02, { bevel: .015, ry: .12 }); for (const sx of [-w / 2 + .09, w / 2 - .09]) kk.box('metal_dark', .05, .58, dp + .02, sx, .28, 0, { bevel: .004 }); kk.box('metal_dark', w * .62 + .02, .04, .05, -w * .16, .84, dp * .3, { ry: .12 }); kk.box('plastic_grey', .34, .2, .26, w * .3, .66, -.05, { bevel: .02, ry: .5 }); kk.pop(); } }
        if (kk && any) { const g = kk.build(); g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); PROPS.group.add(g); } }
      const mk = (kind, p, o) => spawn(kind, p.x, p.z, Object.assign({ h: faceTo(p.x, p.z, D.x, D.z), group: 'w1', hp: kind === 'thug' ? 100 : 105 }, o));   /* four body shots of the 灰隼 9, or two to the head: not two */
      sc.w1 = [mk('gunman', sp(0), { seed: 1 }), mk('gunman', sp(1), { seed: 2, weapon: 'smg' }), mk('thug', sp(2), { seed: 3, weapon: 'pipe' }), mk('gunman', sp(5), { seed: 4 }), mk('thug', sp(6), { seed: 5, weapon: 'bat' })];
      // 阿烈 in the cage: the game's partner figure when ctx.partner is given, else our own
      const pt = S.ctx && S.ctx.partner; if (pt && pt.group) { pt.group.position.set(CI.x, groundY(CI.x, CI.z), CI.z); sc.partner = pt; } else if (!S.headless && GT.hero && GT.hero.make) { try { const f = GT.hero.make('lie'); f.group.position.set(CI.x, groundY(CI.x, CI.z), CI.z); f.group.rotation.y = faceTo(CI.x, CI.z, CG.x, CG.z); PROPS.group.add(f.group); if (PROPS.group.position.y) f.group.position.y -= PROPS.group.position.y; sc.lie = { fig: f, x: CI.x, z: CI.z, h: f.group.rotation.y, t: 0, sp: 0 }; } catch (e) {} }
      const alive = g => enemies.filter(e => (!g || e.group === g) && !e.out).length;
      sc.update = dt => { sc.t += dt;
        if (sc.lie) { const Lf = sc.lie; Lf.t += dt; let st = 'sit'; if (sc.freed) { const dx = P.x - Lf.x, dz = P.z - Lf.z, d = hyp(dx, dz); if (!Lf.wp) Lf.wp = [{ x: CG.x - 2.4, z: CG.z }, { x: CG.x - .1, z: CG.z }, { x: CG.x + 1.1, z: CG.z + (P.z > CG.z ? .9 : -.9) }];   /* out through the door first (inside the mesh, the doorway, a step clear of it): he used to walk straight at the player into the cage wall and stay there */
          if (Lf.t < 1.6) st = 'cheer'; else if (Lf.wp.length) { const w = Lf.wp[0], wx = w.x - Lf.x, wz = w.z - Lf.z, wd = hyp(wx, wz) || 1e-3, v = 2.6; Lf.x += wx / wd * min(v * dt, wd); Lf.z += wz / wd * min(v * dt, wd); Lf.h += angDiff(Lf.h, Math.atan2(wx, wz)) * min(1, dt * 9); Lf.sp = v; st = 'walk'; if (wd < .18) Lf.wp.shift(); }
          else if (d > 1.9) { const v = min(4.6, (d - 1.5) * 3), px = Lf.x, pz0 = Lf.z; let ux = dx / d, uz = dz / d; if (Lf.side) { const s = Lf.side; ux = ux * .25 - dz / d * s; uz = uz * .25 + dx / d * s; const n = hyp(ux, uz) || 1; ux /= n; uz /= n; Lf.sideT -= dt; if (Lf.sideT <= 0) Lf.side = 0; }
            Lf.x += ux * v * dt; Lf.z += uz * v * dt; collide(Lf, .28); const moved = hyp(Lf.x - px, Lf.z - pz0); Lf.stuck = moved < v * dt * .35 ? (Lf.stuck || 0) + dt : 0; if (Lf.stuck > .35 && !Lf.side) { Lf.side = (Lf.flip = !Lf.flip) ? 1 : -1; Lf.sideT = .9; Lf.stuck = 0; }   /* blocked by a crate or a post: slide round it, one side then the other */
            Lf.h += angDiff(Lf.h, Math.atan2(ux, uz)) * min(1, dt * 8); Lf.sp = v; st = v > 2.6 ? 'run' : 'walk'; } else { Lf.sp = 0; st = 'idle'; } Lf.y = groundY(Lf.x, Lf.z, Lf.y); Lf.fig.group.position.set(Lf.x, Lf.y - PROPS.group.position.y, Lf.z); Lf.fig.group.rotation.y = Lf.h; }
          try { Lf.fig.update(dt, { state: st, speed: Lf.sp, turn: 0, lookYaw: 0, lookPitch: 0, t: Lf.t }); } catch (e) {} }
        if (sc.cageDoorMesh && sc.freed) sc.cageDoorMesh.rotation.y = damp(sc.cageDoorMesh.rotation.y, -1.9, 4, dt);
        if (sc.beat === 'enter') { if (P.z < W.z1 - 1.4 || sc.w1.some(e => e.alert)) { sc.t0 = S.time; for (const e of sc.w1) if (!e.alert && e.alertAt < 0) { e.alertAt = S.time + .5 + rnd() * .9 + (e.melee ? 1.6 : 0); e.lastSeen = { x: P.x, z: P.z, t: S.time }; }   /* the two with pipes start their run a moment after the guns open up */ sc.graceTo = S.time + 3.2;   /* their first shots go wide: time to reach the crates, no more */ say('二筒', '送外卖的，你还真敢来。账本呢？', 3); setBeat(sc, 'wave1', ''); } }
        else if (sc.beat === 'wave1') { const n = alive('w1'); sc.objective = '仓库枪战 · 第一波 · 剩 ' + n; /* 二筒 says 「你把我的人都撂了」: the second wave starts when they are (it used to start with one left, or at 80 s with any number). Whoever sits tight is sent out after 45 s, and after 150 s the last of them give up */
          if (n > 0 && S.time - sc.t0 > 45 && S.time > (sc.pushT || 0)) { sc.pushT = S.time + 9; for (const e of enemies) if (e.group === 'w1' && !e.out && !e.melee && e.state !== 'hunt') e.quietT = 12; }
          if (n > 0 && S.time - sc.t0 > 150) for (const e of enemies) if (e.group === 'w1' && !e.out) { e.state = 'cower'; e.out = true; freeTokens(e); bark(e, 'give', true); }
          if (alive('w1') === 0 && !S.hitcam) { sc.lastWave = true; const o = { group: 'w2', alert: true };
            sc.w2 = [spawn('heavy', HV.x, HV.z, Object.assign({ h: faceTo(HV.x, HV.z, P.x, P.z), seed: 6, hp: 320 }, o)), spawn('gunman', BD.x + .9, BD.z, Object.assign({ h: HP, seed: 7, weapon: 'smg', hp: 105 }, o)), MZ ? spawn('gunman', MZ.x, MZ.z, Object.assign({ h: -HP, seed: 8, weapon: 'revolver', post: true, y: MZ.y || 3.8 }, o)) : spawn('gunman', -27.2, -163, Object.assign({ h: -HP, seed: 8, weapon: 'revolver' }, o)), spawn('thug', sp(3).x, sp(3).z, Object.assign({ h: 0, seed: 9, weapon: 'bat' }, o))];
            for (const e of sc.w2) { e.t += 1.8; e.lastSeen = { x: P.x, z: P.z, t: S.time }; } sc.w2[0].speed = 3.6; sc.w2[0].quietT = 4;   /* 二筒 does not camp: he comes for the crate the player is behind */ sc.graceTo = S.time + 2.6;   /* 二筒 talks first: the second wave takes two seconds to raise its guns and its first shots go wide */
            for (const e of enemies) if (e.group === 'w1' && !e.out && !e.melee) e.quietT = 5;   /* whoever is left of the first wave does not sit the second one out */ bark(sc.w2[0], 'heavy', true); setBeat(sc, 'wave2', ''); } }
        else if (sc.beat === 'wave2') { const n = alive(); sc.objective = '二筒亲自下场 · 第二波 · 剩 ' + n; if (n === 0 && !S.hitcam) setBeat(sc, 'free', '清场了 · 打开铁笼放出阿烈'); }
        else if (sc.beat === 'free') { if (hyp(P.x - sc.cage.x, P.z - sc.cage.z) < 3.3) { sc.freed = true; if (sc.lie) sc.lie.t = 0; if (real && GT.riverside && GT.riverside.openCage) { try { GT.riverside.openCage(); } catch (e) {} } if (sc.cageDoorBox) { const i = GT.world.boxes.indexOf(sc.cageDoorBox); if (i >= 0) GT.world.boxes.splice(i, 1); S.coverKey = ''; }
            const ctl = S.ctx && S.ctx.ctl; if (ctl && ctl.partner && ctl.partner.follow) { try { ctl.partner.follow(true); } catch (e) {} } SND.mech('rack', sc.cage); say('阿烈', '哥！我就晓得你要来！', 2.6); setBeat(sc, 'pier', '带阿烈从后门去栈桥'); } }
        else if (sc.beat === 'pier') { if (hyp(P.x - sc.pier.x, P.z - sc.pier.z) < 3) { sc.done = true; sc.lock = false; sc.result = resultOf(sc); holster(); setBeat(sc, 'done', ''); } } };
      return sc; }
  };
  function scenario(name) { if (!S.inited) return null; clear(); rnd = GT.rng('combat:' + name); if (!SCN[name]) return null; S.time = 0; barkT = -9; S.lastHeatT = -99; const sc = SCN[name](); S.sc = sc; S.engT = 2; opts.difficulty = sc.difficulty || 1; emit('scenario', { name, beat: sc.beat }); return sc; }

  /* ================================================================== init + main update */
  function init(scene, hooks) { S.hooks = hooks || S.hooks || {}; if (S.inited) return GT.combat; S.inited = true; S.scene = scene; S.headless = !scene || !!S.headless; if (!S.headless) { S.root = new T.Group(); S.root.name = 'combat'; scene.add(S.root); FX.init(scene); HUD.build(); bindWheel(); }
    if (!P.owned.helmet && !S.hooks.noHelmet) { give('helmet'); } return GT.combat; }   /* g7: js/cngame.js passes noHelmet — no courier helmet in the hand, the left button throws a punch */
  function ensurePlayer(ctx) { if (P.fig || S.headless) return; let fig = ctx && ctx.hero; if (fig && fig.group) P.ownFig = false; else { fig = null; try { if (GT.hero && GT.hero.make) fig = GT.hero.make('kai'); } catch (e) { fig = null; } if (!fig && GT.people) { try { fig = GT.people.make('partner', { mask: false, bag: false, color: 0x41484a, seed: 2 }); } catch (e) {} } if (fig) { P.ownFig = true; S.root.add(fig.group); if (fig.setHelmet) { try { fig.setHelmet(true); } catch (e) {} } } }
    if (!fig) return; P.fig = fig; P.rig = rigOf(fig); P.ht = fig.height || 1.8; if (!P.holstered) armActor(P, P.cur, false); syncHelmet(); }
  function engage(on) { const ctl = S.ctx && S.ctx.ctl; if (on === S.engaged) return; S.engaged = on; if (!ctl || !opts.ownControl) return;
    if (on) { P.x = ctl.pos.x; P.z = ctl.pos.z; P.h = ctl.h; P.vx = P.vz = 0; if (ctl.camera) { CAM.yaw = ctl.camera.yaw; CAM.pitch = ctl.camera.pitch; CAM.dist = ctl.camera.dist || 2.7; CAM.shoulder = ctl.camera.shoulder === 'L' ? -1 : 1; CAM.init = true; } ctl.enabled = false; }
    else { try { ctl.teleport(P.x, P.z, P.h); if (ctl.camera) { ctl.camera.yaw = CAM.yaw; ctl.camera.pitch = CAM.pitch; } } catch (e) {} ctl.enabled = true; } emit('engage', { on }); }
  function update(rdt, ctx) {
    if (!S.inited) return; rdt = clamp(+rdt || 0, 0, .1); ctx = ctx || S.ctx || {}; S.ctx = ctx; if (ctx.camera) S.cam = ctx.camera; const ctl = ctx.ctl;
    if (S.bot) { IN = VPAD; botStep(rdt); VPAD.frame(); } else { IN = ctx.input || GT.input || ownInput || (ownInput = makeInput(true)); if (IN === ownInput) IN.frame(); else if (!ctl && IN === GT.input && IN.frame) IN.frame(); }
    const scroll = slotLocked() ? 0 : Math.trunc((IN.wheel || 0) + wheelDelta);
    wheelDelta = 0;
    const wasWheelOpen = WH.open;
    ensurePlayer(ctx); S.real += rdt;
    // ---- who is driving the hero this frame?
    const armed = !P.holstered && P.cur !== 'fists', threat = enemies.some(e => e.alert && !e.out) && !hook('calmThreat'), near = enemies.some(e => !e.out && hyp(e.x - P.x, e.z - P.z) < 4);
    let want = !!scroll || armed || P.mode !== 'free' || !!P.swing || P.charging || threat || P.dead || WH.open || WH.holdT > 0 || (S.sc && S.sc.lock) || (near && (IN.pressed('Mouse0') || IN.pressed(opts.keys.melee))) || (IN.pressed('Mouse0') && freeSwingOK()) || IN.pressed(opts.keys.wheel[0]) || (!slotLocked() && SLOTKEYS.some(k => IN.pressed(k)));
    if (ctl && ctl.busy && opts.ownControl && !P.dead && P.mode === 'free' && !P.swing) { want = false; S.engT = 0; }   /* QA: getting into a car (the controller's own enter animation, or seated) is never taken back by a drawn gun */
    if (want) S.engT = 1.4; else S.engT -= rdt; const own = !ctl || !opts.ownControl || S.engT > 0; if (ctl && opts.ownControl) engage(own); else S.engaged = own || armed || threat; S.own = own;
    // ---- time: wheel 20 %, focus 35 %, last stand 45 %, hit-cam 22 %, hit-stop
    wheelUpdate(rdt, scroll);
    const fk = opts.keys.focus, wantFocus = IN.down(fk) && !P.dead && S.engaged && !WH.open && (S.focusOn ? P.focus > 0 : P.focus > .12); if (wantFocus !== S.focusOn) { S.focusOn = wantFocus; SND.mech(wantFocus ? 'focus' : 'focusout', null); emit('focus', { on: wantFocus }); }
    if (S.focusOn) P.focus = max(0, P.focus - rdt * .21); else P.focus = min(1, P.focus + rdt * .035); S.focusK = damp(S.focusK, S.focusOn ? 1 : 0, 9, rdt);
    if (S.hitcam) { S.hitcam.t += rdt; if (S.hitcam.t > S.hitcam.dur || (S.hitcam.t > .3 && (IN.pressed('Mouse0') || IN.pressed('Space') || IN.pressed('KeyE') || IN.pressed('Escape')))) S.hitcam = null; }
    const tsT = WH.open ? .2 : S.hitcam ? .22 : S.focusOn ? .35 : P.mode === 'down' ? .45 : 1; S.ts = damp(S.ts, tsT, 16, rdt); if (abs(S.ts - tsT) < .01) S.ts = tsT;
    let dt = rdt * S.ts; if (S.hitstop > 0) { S.hitstop -= rdt; dt *= .04; } S.time += dt; S.shake = max(0, S.shake - rdt * 3.2); S.punch.multiplyScalar(Math.exp(-rdt * 14));
    if (GT.render && GT.render.fx && !S.headless) { const f = max(S.focusK * .9, WH.k * .45, P.mode === 'down' ? .6 : 0, S.hitcam ? .5 : 0, P.dead ? sst(P.fallT || 0, 0, .9) : 0); if (f > .001 || S.fxSet) { GT.render.fx.focus = f; S.fxSet = f > .001; } }
    // ---- simulate
    lootStep(rdt, P.x, P.z, P.y, null);
    if (own) { playerUpdate(dt, rdt, wasWheelOpen || WH.open ? 0 : scroll); if (ctl && ctl.pos) { ctl.pos.x = P.x; ctl.pos.z = P.z; ctl.pos.y = P.y; ctl.h = P.h; } }
    else { P.x = ctl.pos.x; P.z = ctl.pos.z; P.y = num(ctl.pos.y) ? ctl.pos.y : groundY(P.x, P.z, P.y); P.h = ctl.h; P.speed = ctl.speed || 0; P.crouchK = /crouch/.test(ctl.state || '') ? 1 : 0; P.exposed = 1; if (ctl.camera) { CAM.yaw = ctl.camera.yaw; CAM.pitch = ctl.camera.pitch; } if (S.cam) { CAM.pos.copy(S.cam.position); S.cam.getWorldDirection(CAM.dir); P.aimPt.copy(CAM.pos).addScaledVector(CAM.dir, 30); }
      if (!P.dead && S.time - P.lastHitT > 5 && P.hp < P.maxHp) P.hp = min(P.maxHp, P.hp + dt * 11); }
    for (const e of enemies) { if (e.hold && !e.staged && (e.alert || (e.alertAt > 0 && S.time >= e.alertAt))) e.hold = false; if (!e.hold) enemyUpdate(e, dt); else e.y = groundY(e.x, e.z, e.y); }
    while (S.noise.length && S.time - S.noise[0].t > .5) S.noise.shift();
    if (S.sc && S.sc.update && !S.sc.done) S.sc.update(dt); floodUpdate(dt);
    if (own) { P.fpGuard = !P.dead && enemies.some(e => !e.out && !e.dead && e.alert && hyp(e.x - P.x, e.z - P.z) < 9); cameraUpdate(dt, rdt); if (!S.headless) poseActor(P, dt); } else { FPC.on = false; S.scoped = false; } scopeView(!!S.scoped && own, rdt);
    if (!S.headless) { for (const e of enemies) { if (e.fig && e.hidden && e.alert) { e.hidden = false; e.fig.group.visible = true; } if (!e.frozen) poseActor(e, dt); } S.fxT = performance.now(); FX.update(dt, S.cam); safe2(() => throwStep(dt)); HUD.update(rdt); }
  }
  const stateOf = () => { const d = curDef(), am = (d.kind === 'gun' || d.kind === 'throw') && !P.holstered ? ammoOf(d.id) : null; return { weapon: P.holstered ? null : d.id, weaponName: P.holstered ? '' : d.name, ammo: am ? am.mag : null, reserve: am ? am.reserve : null, health: max(0, P.hp), maxHealth: P.maxHp, armor: P.armor, focus: P.focus, focusOn: S.focusOn, inCover: !!P.cover, coverLow: !!(P.cover && P.cover.c.low), target: P.onTarget || P.lock || null,
    mode: P.mode, aiming: P.aimK > .5, reloading: !!P.reload, reloadK: P.reloadK, wheelOpen: WH.open, engaged: S.engaged, dead: P.dead, timeScale: S.ts, alerted: enemies.filter(e => e.alert && !e.out).length, hostiles: enemies.filter(e => !e.out).length, objective: S.sc ? S.sc.objective : '', scenario: S.sc ? { name: S.sc.name, beat: S.sc.beat, done: S.sc.done, failed: S.sc.failed, result: S.sc.result } : null }; };
  function addCar(v) { if (!v) return null; const g = v.group, d = v.dims || v, x = g ? g.position.x : v.x, z = g ? g.position.z : v.z, h = g ? g.rotation.y : v.h || 0, L = d.L || 4.6, W = d.W || 1.9, H = d.H || 1.45, c = abs(cos(h)), s = abs(sin(h)), hx = (W * c + L * s) / 2, hz = (L * c + W * s) / 2; return addProp(x - hx, z - hz, x + hx, z + hz, H, 'combat-car', null); }
  /** rise(e): a floored enemy gets back on his feet and stands there, out of the fight (the story walks its beaten crew out of the door: they are seen getting up, not swapped upright) */
  function rise(e) { if (!e || !e.fall || (!e.dead && e.state !== 'down')) return false; e.dead = false; e.frozen = false; e.out = true; e.ai = 'dummy'; e.alert = true; e.hold = false; e.staged = false; e.noSwing = true;   /* alert stays on: an un-alerted figure that notices the player is thrown into 'react' with the fall still on him */ e.hp = max(1, e.hp); e.swing = null; e.state = 'getup'; e.gt = 0; freeTokens(e); return true; }
  GT.combat = { _fpt: FPT, gunLight(v) { S.gunLight = v || ''; }, init, update, player: P, enemies, spawn, scenario, clear, rise, give, equip, holster, addCar, stats, opts, camera: CAM, drop: (id, x, z, ammo, o) => dropPickup(id, x, z, undefined, ammo, o), dropCash, loot, driveBy: (dt, ctx) => { try { return driveBy(dt, ctx); } catch (e) { if (window.console) console.warn('[combat] driveBy', e); return dbOff(); } }, dbOn: false, lootTick: (dt, x, z, y, car) => { if (!S.inited) return; dt = clamp(+dt || 0, 0, .1); if (performance.now() - (S.fxT || 0) > 8) { S.time += dt; S.real += dt; if (!S.headless) { S.fxT = performance.now(); FX.update(dt, S.cam); } } lootStep(dt, x, z, y || 0, car || null); },   /* QA: at the wheel combat.update does not run: the loot, the drive-by's tracers / flashes / shells and the combat clocks are ticked from here */ cashList: CASH, pickups: PICK, groundY, scenarios: ['lobby', 'wharf'], selftest,
    wheel: { get open() { return WH.open; }, get selected() { return WH.sel; }, get slots() { return (GT.weapons ? GT.weapons.slots : []).map((sl, i) => { const id = sl.empty ? null : slotWeapon(i), d = id ? WD(id) : null, am = d && d.kind === 'gun' ? ammoOf(id) : null; return { slot: i, id, name: d ? d.name : sl.label || '', owned: !!id, ammo: am ? am.mag : null, reserve: am ? am.reserve : null }; }); }, select(i) { const id = slotWeapon(i); return id ? equip(id) : false; } },
    on(evt, cb) { (S.ev[evt] = S.ev[evt] || []).push(cb); return () => { const l = S.ev[evt], i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); }; },
    get state() { return stateOf(); }, get timeScale() { return S.ts; }, get engaged() { return S.engaged; }, get time() { return S.time; }, damagePlayer: (n, from) => damagePlayer(n, from || null, 'bullet'),
    /** SH: lendLights(true) -> the two muzzle-flash point lights (already in every shader, so no recompile) for a shop scene to place; lendLights(false) gives them back dark */
    /** SH: refit(id) — the player's attachments / finish changed: rebuild that weapon (and re-arm if it is in the hand) */
    refit(id) { const w = P.inst && P.inst[id]; if (w) { if (P.w === w) disarmActor(P); delete P.inst[id]; } if (P.cur === id && !P.holstered) armActor(P, id, false); return true; }, throwables: () => TH,
    lendLights(on) { const L = (FX.lights || []).map(q => q.l); if (!L.length) return null; if (on) { FX.lent = true; return L; } FX.lent = false; for (const q of FX.lights) { q.life = 0; q.l.intensity = 0; q.l.position.set(0, -50, 0); q.l.color.setHex(0xffb060); q.l.distance = 14; q.l.decay = 2; } return null; }, heal(n, armor) { P.hp = min(P.maxHp, P.hp + (n || 0)); if (armor) P.armor = min(P.maxArmor, P.armor + armor); },
    covers: (x, z, r, y) => buildCovers(x, z, r || 30, y), _S: S, _fx: FX, _hud: HUD, _vpad: VPAD,
    /* pt1: free-roam police — remove(e) takes one enemy out of the world (a unit leaving with its officers), copsLethal() makes every officer fight, attacking() = the player is swinging / firing /
       has just hit an officer, grabbedBy() = the officer holding him at arm's length (state 'grab') or null. hooks.calmThreat() -> true keeps alerted enemies from taking the controls (free roam:
       the player runs, jumps and gets into cars with the on-foot controller until he attacks or draws a weapon). */
    strip() { holster(); for (const id in P.owned) if (id !== 'fists') delete P.owned[id]; for (const id in P.inv) delete P.inv[id]; P.melee = null; P.cur = 'fists'; P.last = 'pistol'; emit('switch', { id: null }); return true; },   /* pt1: arrested — every weapon is taken */
    /** pt1: while the player sits in a vehicle the host does not run update(); officers still on foot are moved and posed from here against where he is (px, pz) */
    npcTick(rdt, px, pz, py, speed) { if (!S.inited) return; const dt = clamp(+rdt || 0, 0, .1); S.time += dt; P.x = px; P.z = pz; P.y = py || 0; P.speed = speed || 0; P.exposed = 1; P.crouchK = 0; for (const e of enemies) if (!e.hold) enemyUpdate(e, dt); while (S.noise.length && S.time - S.noise[0].t > .5) S.noise.shift(); if (!S.headless) { for (const e of enemies) if (!e.frozen) poseActor(e, dt); S.fxT = performance.now(); FX.update(dt, S.cam); } },
    remove: e => removeEnemy(e), copsLethal: () => copsLethal(), attacking: () => playerAttacking(), grabbedBy: () => { let b = null, bd = 9; for (const e of enemies) { if (e.dead || e.state !== 'grab' || !e.KD.cop) continue; const d = hyp(e.x - P.x, e.z - P.z); if (d < bd) { bd = d; b = e; } } return bd < 1.8 ? b : null; },
    /** scripted hero for the opening trailer (js/cntrailer.js): bot(makeBot-style object | null) puts the autoplay bot on the virtual pad; resetPlayer(x, z, h, loadout?) as the showcase scenes use it */
    lockSlots(on) { S.slotLock = !!on; if (!on) S.slotFreeAt = performance.now() + 200; }, makeBot: s => makeBot(s), bot(b) { S.bot = b || null; if (!b) for (const c of ['Mouse0', 'Mouse1', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyC', 'ShiftLeft', 'Tab']) VPAD.hold(c, false); return b; }, resetPlayer: (x, z, h, l) => resetPlayer(x, z, h, l), revive: (x, z, h) => revive(x, z, h), setAlert: (e, quiet) => setAlert(e, quiet) };

  /* ================================================================== autoplay bot (deterministic virtual input for screenshots + self-test) */
  function botAim(pt, rdt, rate) { const dx = pt.x - CAM.pos.x, dy = pt.y - CAM.pos.y, dz = pt.z - CAM.pos.z, wy = Math.atan2(dx, dz), wp = -Math.atan2(dy, hyp(dx, dz)), g = min(1, rdt * (rate || 12)); VPAD.turn(-angDiff(CAM.yaw, wy) * g, (wp - CAM.pitch) * g);
    const l = hyp(dx, dy, dz) || 1; return Math.acos(clamp((dx * CAM.dir.x + dy * CAM.dir.y + dz * CAM.dir.z) / l, -1, 1)); }
  function makeBot(script) { const B = { t: 0, goals: [], prio: false, reach: 0, held: new Set(), script: (script || []).slice().sort((a, b) => a[0] - b[0]), si: 0, auto: false, aim: null, goal: null, fireT: 0, melee: false, head: false, err: 9, manual: false, fire: true,
      hold(c) { B.held.add(c); return B; }, release(c) { B.held.delete(c); return B; }, tap(c) { VPAD.tap(c); return B; } }; return B; }
  const bpt = V3();
  function botStep(rdt) { const B = S.bot; if (!B || B.manual) return; B.t += rdt; while (B.si < B.script.length && B.script[B.si][0] <= B.t) { B.script[B.si][1](B); B.si++; }
    let aim = typeof B.aim === 'function' ? B.aim() : B.aim, want = new Set(B.held);
    if (B.auto && !P.dead) { let tg = null, bd = 1e9; for (const e of enemies) { if (e.out || e.hidden) continue; const d = hyp(e.x - P.x, e.z - P.z); if (d > 60 || (!e.alert && d > 30)) continue; const vis = los(P.x, P.y + 1.55, P.z, e.x, e.y + lerp(1.3, .8, e.crouchK), e.z) || los(P.x, P.y + 1.55, P.z, e.x, e.y + lerp(1.68, 1.02, e.crouchK), e.z); const sc = d + (vis ? 0 : 40); if (sc < bd) { bd = sc; tg = e; tg._vis = vis; } }
      if (B.prio && B.goal) tg = null; const gun = curDef().kind === 'gun' && !P.holstered;
      if (tg && gun) { const top = tg.y + lerp(tg.ht, tg.ht * .6, tg.crouchK); aim = bpt.set(tg.x, B.head || tg.crouchK > .5 ? top - .12 : tg.y + (top - tg.y) * .7, tg.z); if (tg._vis) { want.add('Mouse1'); if (B.err < .014 && B.fire && P.onTarget === tg && B.t > B.fireT) { if (curDef().auto) want.add('Mouse0'); else VPAD.tap('Mouse0'); B.fireT = B.t + (curDef().auto ? 0 : max(B.gap || .2, 60 / curDef().rpm + .04)); } } }
      else if (tg && B.melee) { aim = bpt.set(tg.x, tg.y + 1.2, tg.z); const d = hyp(tg.x - P.x, tg.z - P.z); if (d > 2.0) want.add('KeyW'); if (d < 2.6 && B.t > B.fireT && P.mode !== 'melee') { VPAD.tap('Mouse0'); B.fireT = B.t + .1; } else if (d < 2.6 && P.mode === 'melee' && P.swing && P.swing.k > .5 && B.t > B.fireT) { VPAD.tap('Mouse0'); B.fireT = B.t + .3; } }
      if ((!tg || !tg._vis) && B.goal && !(tg && B.melee)) { const d = hyp(B.goal.x - P.x, B.goal.z - P.z); if (d <= (B.reach || 1.4)) { if (B.goals && B.goals.length) B.goal = B.goals.shift(); } else { if (!tg) aim = bpt.set(B.goal.x, P.y + 1.4, B.goal.z); const a = angDiff(CAM.yaw, Math.atan2(B.goal.x - P.x, B.goal.z - P.z)); if (abs(a) < .6) want.add('KeyW'); else if (a > 0) want.add('KeyA'); else want.add('KeyD'); if (P.cover) VPAD.tap(opts.keys.cover); } } }
    if (B.auto && B.hunt && !P.dead && !B.goal) { let tg = null, bd = 1e9; for (const e of enemies) { if (e.out || e.hidden) continue; const d = hyp(e.x - P.x, e.z - P.z); if (d < bd) { bd = d; tg = e; } } if (tg && !tg._vis && bd > 3) { B.huntT = (B.huntT || 0) + rdt; if (B.huntT > 3) { const a = angDiff(CAM.yaw, Math.atan2(tg.x - P.x, tg.z - P.z)); if (abs(a) < .7) want.add('KeyW'); want.add((B.t % 5) < 2.5 ? 'KeyA' : 'KeyD'); } } else B.huntT = 0; }
    if (aim) B.err = botAim(aim, rdt, B.rate); else B.err = 9;
    for (const c of ['Mouse0', 'Mouse1', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyC', 'ShiftLeft', 'Tab']) VPAD.hold(c, want.has(c)); }

  /* ================================================================== logic self-test (headless stepping): showcase.html?m=combat&selftest=1 */
  function selftest() {
    const out = [], line = (ok, msg) => { out.push((ok ? 'PASS  ' : 'FAIL  ') + msg); return ok; }, cam = new T.PerspectiveCamera(55, 16 / 9, .1, 500), calls = { heat: 0, down: 0, edown: 0 };
    const wasHeadless = S.headless, wasInit = S.inited; if (!S.inited) { S.headless = true; init(null, {}); } const oldHooks = S.hooks, oldBot = S.bot, oldBoxes = GT.world.boxes; GT.world.boxes = []; S.hooks = { addHeat() { calls.heat++; }, onPlayerDown() { calls.down++; }, onEnemyDown() { calls.edown++; } }; S.bot = { manual: true }; S.noHitcam = true; const hl = S.headless; S.headless = true;
    const step = (sec, each) => { for (let t = 0; t < sec - 1e-6; t += 1 / 60) { if (each) each(); update(1 / 60, { camera: cam }); } }, aim = (x, y, z, sec) => step(sec || .5, () => botAim(bpt.set(x, y, z), 1 / 60, 20));
    const X = 1000, Z = 1000, pad = VPAD, fresh = () => { clear(); pad.releaseAll(); resetPlayer(X, Z, 0, ALL); S.ts = 1; S.focusOn = false; S.hitstop = 0; step(.05); };
    try {
      // 1 fire
      fresh(); equip('pistol', true); let e = spawn('gunman', X, Z + 12, { ai: 'dummy', h: PI }); pad.hold('Mouse1'); aim(e.x, 1.2, e.z, .7); pad.tap('Mouse0'); step(.1);
      line(P.inv.pistol.mag === 11 && stats.shots === 1 && stats.hits === 1 && e.hp < 80, 'fire: aimed pistol shot uses 1 round and wounds the target (mag ' + P.inv.pistol.mag + ', hp ' + e.hp.toFixed(0) + ', aimK ' + P.aimK.toFixed(2) + ')');
      line(calls.heat >= 1, 'fire: gunshot reports heat through hooks.addHeat (' + calls.heat + ' call)');
      equip('smg', true); step(.1); const s0 = stats.shots; pad.hold('Mouse0'); aim(e.x, 1.2, e.z, .5); pad.hold('Mouse0', false); const n = stats.shots - s0; line(n >= 5 && n <= 8, 'fire: SMG full-auto cadence, ' + n + ' rounds in 0.5 s (780 rpm)');
      // 2 reload + active reload
      equip('pistol', true); step(.1); P.inv.pistol.mag = 2; const r0 = P.inv.pistol.reserve; pad.tap('KeyR'); step(.05); const was = !!P.reload; step(1.6); line(was && P.inv.pistol.mag === 12 && P.inv.pistol.reserve === r0 - 10, 'reload: 2 -> 12 rounds, reserve ' + r0 + ' -> ' + P.inv.pistol.reserve);
      P.inv.pistol.mag = 2; pad.tap('KeyR'); step(.74); pad.tap('KeyR'); step(.04); line(!P.reload && P.inv.pistol.mag === 12 && stats.perfectReloads === 1 && P.bonus > 1, 'active reload: second tap in the sweet spot finishes early with a damage bonus (x' + P.bonus + ')');
      P.inv.pistol.mag = 2; pad.tap('KeyR'); step(.2); pad.tap('KeyR'); step(.05); const fum = P.reload && P.reload.fumble; step(2.2); line(!!fum && P.inv.pistol.mag === 12, 'active reload: an early tap fumbles (slower) but still completes');
      // 3 switching
      pad.tap('Digit6'); step(.1); const a1 = P.cur; pad.scroll(1); step(.1); const a2 = P.cur; pad.tap('Digit1'); step(.1); line(a1 === 'shotgun' && a2 === 'smg' && P.cur === 'fists', 'switch: number key -> ' + a1 + ', mouse wheel -> ' + a2 + ', 1 -> ' + P.cur);
      equip('pistol', true); step(.4); P.inv.pistol.mag = 1; P.inv.pistol.reserve = 0; aim(e.x, 1.2, e.z, .2); pad.tap('Mouse0'); step(.7); line(P.cur !== 'pistol' && WD(P.cur).kind === 'gun', 'switch: last round fired with no reserve -> auto-switch to ' + P.cur);
      pad.tap('KeyH'); step(.08); const hol = P.holstered; pad.tap('KeyH'); step(.08); const drawn = !P.holstered, g1 = P.cur; equip('pistol', true); step(.3); equip('smg', true); step(.3); pad.hold('KeyQ'); step(.05); pad.hold('KeyQ', false); step(.08); line(hol && drawn && P.cur === 'pistol', 'holster: H holsters, H again draws ' + g1 + '; a Q tap swaps back to the last weapon (' + P.cur + ')');
      fresh(); resetPlayer(X, Z, 0, ['helmet']); step(.05); equip('helmet', true); const pk = dropPickup('pistol', X, Z + 3, 0, 24); CAM.yaw = 0; pad.hold('KeyW'); step(1.3); pad.hold('KeyW', false); step(.5); line(!!pk && P.owned.pistol && P.cur === 'pistol' && !P.holstered && P.inv.pistol.mag === 12 && P.inv.pistol.reserve === 12 && PICK.length === 0, 'pickup: walking over a dropped pistol takes it (12 / 12) and draws it; helmet goes back on');
      // 4 damage + death + headshot
      fresh(); equip('revolver', true); e = spawn('gunman', X, Z + 14, { ai: 'dummy', h: PI }); pad.hold('Mouse1'); aim(e.x, e.y + 1.69, e.z, .7); let shots = 0; const k0 = stats.kills, ed0 = calls.edown; while (!e.dead && shots < 12) { pad.hold('Mouse0'); step(.04); pad.hold('Mouse0', false); step(.2, () => botAim(bpt.set(e.x, e.y + 1.69, e.z), 1 / 60, 20)); shots++; } pad.hold('Mouse1', false);
      line(e.dead && stats.kills === k0 + 1 && stats.headshots === 1 && calls.edown === ed0 + 1, 'damage: revolver headshot drops the enemy (' + shots + ' shot, kills ' + stats.kills + ', headshots ' + stats.headshots + ', onEnemyDown ' + calls.edown + ')'); step(2.2); line(e.prone && e.tiltX !== 0, 'death: body falls and stays (tilt ' + e.tiltX.toFixed(2) + ' rad)');
      fresh(); equip('shotgun', true); e = spawn('gunman', X, Z + 5, { ai: 'dummy', h: PI }); const far = spawn('gunman', X + 1, Z + 40, { ai: 'dummy', h: PI }); pad.hold('Mouse1'); aim(e.x, 1.2, e.z, .6); pad.tap('Mouse0'); step(.1); const dNear = 80 - e.hp; aim(far.x, 1.2, far.z, .9); pad.tap('Mouse0'); step(.1); pad.hold('Mouse1', false);
      line(dNear > 60 && 80 - far.hp < dNear * .35, 'falloff: shotgun does ' + dNear.toFixed(0) + ' at 5 m and ' + (80 - far.hp).toFixed(0) + ' at 40 m');
      // 5 AI state transitions
      fresh(); addProp(X + 1.5, Z + 13.6, X + 3.5, Z + 14.4, 1.0, 'combat-crate', 'wood'); addProp(X - 6, Z + 9.6, X - 4, Z + 10.4, 1.0, 'combat-crate', 'wood'); addProp(X + 7, Z + 6.6, X + 9, Z + 7.4, 1.0, 'combat-crate', 'wood');
      e = spawn('gunman', X + 3, Z + 21, { h: PI }); const seen = new Set(), intents = new Set(); let sup = false; const hp0 = P.hp; step(14, () => { seen.add(e.state); if (e.suppressing && e.state === 'burst') sup = true; P.hp = max(P.hp, 60); });
      line(['react', 'move', 'cover', 'aimup', 'burst'].every(k => seen.has(k)), 'AI: idle -> ' + Array.from(seen).join(' -> ')); line(stats.damageTaken > 0 || e.mag < 12, 'AI: fires bursts at an exposed player (damage taken ' + stats.damageTaken.toFixed(0) + ', enemy mag ' + e.mag + ')');
      const err0 = e.aimErr; addProp(X - 3, Z + 1.2, X + 3, Z + 2.0, 3, 'wall', 'stucco'); step(13, () => { seen.add(e.state); intents.add(e.intent); if (e.suppressing) sup = true; });
      line(intents.has('flank') || intents.has('advance'), 'AI: player hidden -> ' + Array.from(intents).filter(Boolean).join(', ') + (sup ? ' + suppressive fire' : '')); line(seen.has('reload') || e.mag > 0, 'AI: ammo management (mag ' + e.mag + (seen.has('reload') ? ', reloaded behind cover' : '') + ')');
      e.morale = .05; e.state = 'cover'; e.t = 0; step(3, () => seen.add(e.state)); line(e.state === 'cower' && e.out, 'AI: broken morale -> surrenders (' + e.state + ')');
      // 6 cover
      fresh(); addProp(X - 1.2, Z + 1.3, X + 1.2, Z + 1.9, 1.0, 'combat-barrier', 'stucco'); P.z = Z + .55; e = spawn('gunman', X, Z + 16, { ai: 'dummy', h: PI }); const cs = buildCovers(X, Z, 20); pad.tap('KeyE'); step(.6);
      line(P.mode === 'cover' && P.crouchK > .8 && P.cover.c.low && coverHides(P.cover.c, e.x, e.z), 'cover: E snaps to low cover and crouches (' + cs.length + ' cover points, hidden from the threat)');
      const hpB = P.hp; e.alert = true; e.aimErr = 0; for (let i = 0; i < 6; i++) { e.mag = 5; enemyFire(e, true); } line(P.hp === hpB, 'cover: incoming rounds are stopped by the cover (hp ' + P.hp.toFixed(0) + ')');
      equip('pistol', true); pad.hold('Mouse1'); aim(e.x, 1.3, e.z, .6); const up = P.crouchK < .3; e.aimErr = 0; e.mag = 5; e.y = 0; let hitUp = false; for (let i = 0; i < 6 && !hitUp; i++) { e.mag = 5; enemyFire(e, true); hitUp = P.hp < hpB; } pad.hold('Mouse1', false); line(up && hitUp, 'cover: aiming pops up over the cover and exposes the player');
      step(.5); const z0 = P.z; pad.hold('KeyW'); CAM.yaw = 0; pad.tap('Space'); step(.1); const vm = P.mode; step(.8); pad.hold('KeyW', false); line(vm === 'vault' && P.z > Z + 2.2, 'cover: Space + forward vaults the low cover (z ' + z0.toFixed(1) + ' -> ' + P.z.toFixed(1) + ')');
      // 7 wheel
      fresh(); pad.hold('KeyQ'); step(.3); const wo = WH.open, wts = S.ts; pad.turn(0, 110 / 420); step(.1); const ws = WH.sel; pad.hold('KeyQ', false); step(.15); line(wo && wts < .3 && ws === 4 && P.cur === 'revolver' && GT.combat.wheel.slots.length === 8, 'wheel: hold Q slows time to ' + wts.toFixed(2) + ', mouse-down selects slot ' + ws + ', release equips ' + P.cur); step(.5);
      // 8 melee
      fresh(); equip('helmet', true); e = spawn('thug', X, Z + 1.5, { ai: 'dummy', h: PI, hp: 900 }); const kinds = []; const off = GT.combat.on('melee', m => kinds.push(m.kind + ':' + m.hits)); step(.3);
      for (let i = 0; i < 3; i++) { pad.tap('Mouse0'); step(.5); } line(kinds.join(',') === 'l1:1,l2:1,l3:1' && stats.meleeHits === 3, 'melee: helmet light combo ' + kinds.join(' , ') + ' (hits ' + stats.meleeHits + ')');
      step(1); let stag = false; pad.hold('Mouse0'); step(.5); pad.hold('Mouse0', false); step(1.2, () => { if (e.state === 'stagger' || e.state === 'down') stag = true; }); line(kinds[3] === 'heavy:1' && stag, 'melee: charged heavy swing connects and staggers / floors the enemy (' + kinds[3] + ')');
      pad.tap('KeyF'); step(.7); line(kinds[kinds.length - 1].startsWith('shove'), 'melee: F shoves (' + kinds[kinds.length - 1] + ')'); off();
      fresh(); const e2 = spawn('gunman', X, Z + 1.4, { ai: 'dummy', h: 0 }); pad.tap('KeyF'); step(1.4); line(e2.dead && e2.ko && stats.takedowns === 1 && calls.heat === (calls.h2 = calls.heat), 'melee: silent takedown from behind on an unaware enemy');
      fresh(); equip('fists', true); const e3 = spawn('thug', X, Z + 4, { h: PI }); e3.lastSeen = { x: X, z: Z, t: 0 }; const hs = new Set(); let blocked = 0; pad.hold('Mouse1'); step(4, () => hs.add(e3.state)); pad.hold('Mouse1', false);
      line(hs.has('chase') && hs.has('windup') && hs.has('strike') && stats.damageTaken > 0 && stats.damageTaken < 12, 'melee AI: chase -> windup (telegraph) -> strike; blocking absorbs most of it (' + stats.damageTaken.toFixed(1) + ' dmg)');
      P.x = X; P.z = Z; e3.x = X; e3.z = Z + 5; e3.state = 'chase'; e3.swing = null; freeTokens(e3); pad.hold('KeyS'); CAM.yaw = 0; step(.05); pad.tap('Space'); step(.1); const rm = P.mode; step(.7); pad.hold('KeyS', false); line(rm === 'roll' && P.z < Z - 2, 'dodge: Space rolls ' + (Z - P.z).toFixed(1) + ' m with i-frames');
      // 9 focus
      fresh(); equip('pistol', true); pad.hold('KeyC'); step(.6); const fts = S.ts, ff = P.focus; pad.hold('KeyC', false); step(.5); line(abs(fts - .35) < .03 && ff < .95 && S.ts === 1, 'focus: hold C -> time x' + fts.toFixed(2) + ', meter drains to ' + ff.toFixed(2) + ', release restores');
      e = spawn('gunman', X, Z + 10, { ai: 'dummy', h: PI }); e.alert = true; step(.5); pad.hold('KeyC'); pad.hold('Mouse1'); aim(e.x, e.y + 1.69, e.z, 1.2); pad.tap('Mouse0'); step(.2); pad.releaseAll(); line(e.dead, 'focus: a head weak-point hit in focus is an instant down'); step(1);
      // 10 health
      fresh(); GT.combat.damagePlayer(30); const h1 = P.hp; step(8.5); const h2 = P.hp; P.armor = 50; GT.combat.damagePlayer(40); line(h1 === 70 && h2 === 100 && P.armor < 50 && P.hp > 60, 'health: 100 -> ' + h1 + ' -> regen ' + h2 + ' after delay; armour soaks (' + P.armor.toFixed(0) + ' left, hp ' + P.hp.toFixed(0) + ')');
      P.armor = 0; GT.combat.damagePlayer(500); const ls = P.mode; step(.3); const lts = S.ts; step(6); line(ls === 'down' && lts < .6 && P.dead && calls.down === 1, 'health: lethal hit -> last stand (time x' + lts.toFixed(2) + ') -> down, hooks.onPlayerDown x' + calls.down);
      // 11 scenario beats
      fresh(); let sc = scenario('lobby'); const dir1 = _a.set(0, 0, 1).clone(), n1 = enemies.length, lb = [sc.beat]; step(.2); P.x = sc.goal.x; P.z = sc.goal.z - 1.5; step(.3); lb.push(sc.beat); const helm = P.cur === 'helmet' && !P.holstered; koEnemy(sc.w1[0], dir1); step(.2); const one = sc.beat === 'brawl' && !sc.pistol; koEnemy(sc.w1[1], dir1); step(.2); lb.push(sc.beat); const drop = one && sc.pistol && PICK.includes(sc.pistol);   /* the pistol comes off the second man down */
      if (sc.pistol) { P.x = sc.pistol.x; P.z = sc.pistol.z; } step(.6); const lay = !P.owned.pistol && sc.beat === 'pistol'; step(1.2); const inHand = P.cur === 'pistol' && !P.holstered && sc.beat === 'pistol'; step(4.8); lb.push(sc.beat); const gotP = !!P.owned.pistol && lay && inHand, n2 = enemies.length;   /* it lies there for 1.3 s, is in the hand the moment it is taken, and the gunfight waits 4.2 s more (the title band) */ for (const q of enemies.slice()) downEnemy(q, dir1); step(.3); lb.push(sc.beat); const n3 = enemies.length; for (const q of enemies.slice()) downEnemy(q, dir1); S.hitcam = null; step(.3); lb.push(sc.beat); P.x = sc.exit.x; P.z = sc.exit.z + .5; step(.3); lb.push(sc.beat);
      line(n1 === 3 && helm && drop && gotP && n2 === 4 && n3 === 5 && lb.join('>') === 'handoff>brawl>pistol>gunfight>steps>escape>done' && sc.done && sc.result && sc.result.state === 'clear', 'scenario lobby (' + (sc.real ? 'real' : 'stand-in') + '): ' + lb.join(' -> ') + ' (3 + 1 + 1 enemies, helmet drawn ' + helm + ', pistol dropped ' + !!drop + ', picked up ' + gotP + ')');
      fresh(); sc = scenario('wharf'); const m1 = enemies.length, wb = [sc.beat]; step(.2); P.x = sc.goal.x; P.z = sc.goal.z; step(.3); wb.push(sc.beat); for (const q of enemies.slice()) downEnemy(q, dir1); step(.3); wb.push(sc.beat); const m2 = enemies.length, hv = enemies.filter(q => q.kind === 'heavy').length; for (const q of enemies.slice()) downEnemy(q, dir1); S.hitcam = null; step(.3); wb.push(sc.beat);
      P.x = sc.cage.x; P.z = sc.cage.z; step(.3); wb.push(sc.beat); const fr = sc.freed; P.x = sc.pier.x; P.z = sc.pier.z; step(.3); wb.push(sc.beat);
      line(m1 === 5 && m2 === 9 && hv === 1 && fr && wb.join('>') === 'enter>wave1>wave2>free>pier>done' && sc.done && sc.result && sc.result.state === 'clear', 'scenario wharf (' + (sc.real ? 'real' : 'stand-in') + '): ' + wb.join(' -> ') + ' (' + m1 + ' + ' + (m2 - m1) + ' enemies, ' + hv + ' heavy, cage opened ' + fr + ', result ' + JSON.stringify(sc.result) + ')');
      const st = GT.combat.state; line(st && 'weapon' in st && 'ammo' in st && 'health' in st && 'inCover' in st && st.scenario && st.scenario.done, 'state: GT.combat.state exposes weapon/ammo/reserve/health/armor/focus/inCover/target + scenario');
      fresh(); addProp(X - 1, Z + 3, X + 1, Z + 3.6, 2.05, 'cover:counter', 'wood'); S.floorFn = (x, z) => (z > Z - 20 ? 1.05 : undefined); P.y = 1.05; step(.1); const cz = buildCovers(X, Z + 2, 8, 1.05), lowN = cz.filter(c => c.low).length; S.floorFn = null; S.coverKey = ''; const hiN = buildCovers(X, Z + 2, 8, 0).filter(c => c.low).length;
      line(abs(P.y - 1.05) < .01 && lowN >= 4 && hiN === 0, 'floors: on a raised floor (y 1.05) a 2.05 m-high collider is LOW cover (' + lowN + ' points); from street level it is a wall (' + hiN + ' low)');
    } catch (er) { line(false, 'self-test threw: ' + (er && er.stack || er)); }
    clear(); pad.releaseAll(); GT.world.boxes = oldBoxes; S.hooks = oldHooks; S.bot = oldBot; S.noHitcam = false; S.headless = hl; S.ts = 1; S.time = 0; resetPlayer(0, 0, 0, null); return out; }

  /* ================================================================== showcase: showcase.html?m=combat&scene=<range|melee|wheel|cover|focus|lobby|wharf|weapons>&at=<s>&auto=1[&live=1][&standin=1] */
  function ensureWorld(scene, name) { if (S.worldBuilt) return; S.worldBuilt = true; S.built = []; S.standin = Q.get('standin') === '1'; const eb = typeof document !== 'undefined' ? document.getElementById('err') : null;
    const tryB = (m, nm) => { if (m && m.build) { try { m.build(scene); S.built.push(m); return true; } catch (e) { if (eb) eb.textContent += 'combat: ' + nm + '.build threw: ' + (e.stack || e) + '\n'; } } return false; };
    if (name !== 'lobby' && name !== 'wharf') return; const road = tryB(GT.cnroad, 'cnroad'); if (!S.standin) { if (name === 'lobby') tryB(GT.landmarks, 'landmarks'); else tryB(GT.riverside, 'riverside'); }
    if (!road && !(name === 'wharf' && S.built.length)) { const k = GT.kit(); if (name === 'lobby') k.box('asphalt_worn', 120, .1, 60, 30, -.06, 118); else k.box('asphalt_worn', 90, .1, 90, -39, -.06, -150); const g = k.build(); S.root ? scene.add(g) : scene.add(g); } }
  const YX = 316, YZ = 487.25, AISLE = 400;                       // test-yard offsets from the old aisle coordinates
  const SCENES = {
    range(B) { SET.yard(); resetPlayer(405, AISLE - .4, HP, ALL); PROPS.begin(); PROPS.crate(413.2, 403.85, 1.0, .15); PROPS.barrier(419.5, 396.65, 2.4, true); PROPS.drums(424.2, 405.05); PROPS.pallet(431, 404.6, .1); PROPS.crate(434.2, 395.4, 1.2, .3, 0, '江城港务'); PROPS.end();
      const d1 = spawn('gunman', 416, 402.65, { ai: 'dummy', h: -HP, seed: 1 }), d2 = spawn('gunman', 419.4, 397.85, { ai: 'dummy', h: -HP, seed: 2 }), d3 = spawn('heavy', 424, 400.65, { ai: 'dummy', h: -HP, seed: 6 }); const ch = e => () => bpt.set(e.x, e.y + 1.28, e.z), hd = e => () => bpt.set(e.x, e.y + e.ht - .11, e.z);
      B.script = [[.2, b => b.tap('Digit4')], [.7, b => { b.hold('Mouse1'); b.aim = ch(d1); }], [1.3, b => b.tap('Mouse0')], [1.6, b => b.tap('Mouse0')], [1.9, b => { b.aim = hd(d1); }], [2.4, b => b.tap('Mouse0')], [2.9, b => { b.aim = () => bpt.set(411.95, P.y + 1.55, 409.5); }], [3.4, b => b.tap('Mouse0')], [3.62, b => { b.tap('Mouse0'); b.aim = () => bpt.set(411.8, P.y + 1.2, 409.5); }], [3.84, b => { b.tap('Mouse0'); b.aim = () => bpt.set(410.6, P.y + 1.35, 409.5); }], [4.06, b => b.tap('Mouse0')], [4.2, b => b.tap('Mouse0')],
        [4.4, b => { b.tap('Digit6'); b.aim = ch(d2); }], [5.2, b => b.tap('Mouse0')], [6.1, b => b.tap('Mouse0')], [6.9, b => { b.tap('Digit7'); b.aim = ch(d3); }], [7.7, b => b.hold('Mouse0')], [8.5, b => { b.release('Mouse0'); b.aim = hd(d3); }], [9, b => b.hold('Mouse0')], [9.6, b => b.release('Mouse0')], [10.2, b => { b.tap('Digit5'); b.aim = () => bpt.set(424.4, P.y + .6, 405.05); }], [11, b => b.tap('Mouse0')], [11.5, b => b.tap('Mouse0')]]; return { hours: 18.2 }; },
    focus(B) { const r = SCENES.range(B); for (const e of enemies) { e.alert = true; } const d1 = enemies[0], d3 = enemies[2]; B.script = [[.2, b => b.tap('Digit5')], [.7, b => { b.hold('Mouse1'); b.aim = () => bpt.set(d1.x, d1.y + 1.3, d1.z); }], [1.2, b => b.hold('KeyC')], [1.5, b => { b.aim = () => bpt.set(d3.x, d3.y + d3.ht - .11, d3.z); }], [3.2, b => b.tap('Mouse0')], [4.2, b => { b.aim = () => bpt.set(d1.x, d1.y + d1.ht - .11, d1.z); }], [5.6, b => b.tap('Mouse0')], [6.6, b => b.release('KeyC')]]; return r; },
    wheel(B) { const r = SCENES.range(B); const i = +(Q.get('slot') || 5), a = i / 8 * TAU; B.script = [[.2, b => b.tap('Digit4')], [.7, b => { b.hold('Mouse1'); b.aim = () => bpt.set(enemies[0].x, enemies[0].y + 1.3, enemies[0].z); }], [1.2, b => b.tap('Mouse0')], [1.5, b => { b.release('Mouse1'); b.aim = null; b.hold('KeyQ'); }], [1.9, b => VPAD.turn(sin(a) * 60 / 420, -cos(a) * 60 / 420)], [1.95, b => VPAD.turn(sin(a) * 50 / 420, -cos(a) * 50 / 420)], [4.5, b => b.release('KeyQ')], [5, b => { b.hold('Mouse1'); b.aim = () => bpt.set(enemies[2].x, enemies[2].y + 1.3, enemies[2].z); }]]; return r; },
    melee(B) { SET.yard(); resetPlayer(406, AISLE, HP, ALL); PROPS.begin(); PROPS.crate(412.5, 404.05, 1.0, .2); PROPS.pallet(415, 395.85, .1); PROPS.drums(418.6, 405.4); PROPS.end(); opts.meleeTokens = 1;
      spawn('thug', 411.5, AISLE + .3, { h: -HP, seed: 3, alert: true, hp: 150, weapon: 'pipe' }); spawn('thug', 414.5, AISLE - 1.6, { h: -HP, seed: 5, weapon: 'bat', alert: true, hp: 150 }); B.auto = true; B.melee = true; B.script = [[.15, b => b.tap('Digit2')], [6, b => { b.melee = false; b.auto = false; b.hold('Mouse0'); b.aim = () => bpt.set(enemies[1].x, enemies[1].y + 1.2, enemies[1].z); }], [6.7, b => b.release('Mouse0')], [7.6, b => { b.auto = true; b.melee = true; }]]; return { hours: 18.2 }; },
    cover(B) { SET.yard(); resetPlayer(406.5, AISLE - .3, HP, ALL); PROPS.begin(); PROPS.barrier(411, AISLE - .2, 2.4, false); PROPS.crate(420.6, 401.65, 1.0, .1); PROPS.crate(421.7, 401.75, 1.0, -.1); PROPS.barrier(422.5, 397.05, 2.4, false); PROPS.drums(427, 403.25); PROPS.pallet(416.5, 406.2, .2); PROPS.end();
      spawn('gunman', 424, 401.65, { h: -HP, seed: 1 }); spawn('gunman', 425, 397.25, { h: -HP, seed: 2, weapon: 'smg' }); B.aim = () => bpt.set(422, P.y + 1.3, 399.85); B.fire = false;
      B.script = [[.1, b => { b.tap('Digit4'); b.hold('KeyW'); }], [1.05, b => { b.release('KeyW'); b.tap('KeyE'); }], [4.2, b => { b.auto = true; b.fire = true; }], [9, b => { b.fire = false; b.auto = false; b.release('Mouse1'); b.aim = () => bpt.set(423, P.y + 1.3, 399.25); }], [9.6, b => b.tap('Mouse0')], [9.9, b => b.tap('Mouse0')], [10.2, b => b.tap('Mouse0')], [11, b => { b.auto = true; b.fire = true; }]]; return { hours: 18.2 }; },
    lobby(B) { const sc = scenario('lobby'); B.hunt = true; B.auto = true; B.melee = true; B.goal = sc.goal; B.rate = 7; B.gap = .5; B.script = [];
      GT.combat.on('scenario', d => { if (d.name !== 'lobby') return; if (d.beat === 'brawl') B.goal = null; if (d.beat === 'pistol' && sc.pistol) { B.goal = sc.pistol; B.prio = true; B.reach = .3; } if (d.beat === 'escape') { B.prio = true; B.reach = 1.2; B.goal = sc.door; B.goals = [sc.exit]; } });
      GT.combat.on('pickup', d => { if (d.id === 'pistol') { B.prio = false; B.goal = null; B.melee = false; B.reach = 1.4; } }); return { hours: sc.hours }; },
    wharf(B) { const sc = scenario('wharf'); B.hunt = true; B.auto = true; B.goal = sc.goal; B.rate = 6; B.gap = .5; B.script = [];
      GT.combat.on('scenario', d => { if (d.name !== 'wharf') return; if (d.beat === 'wave1') { B.goal = null; B.script.push([B.t + .4, b => b.tap('KeyE')], [B.t + 16, b => { b.goal = { x: -40.5, z: -149 }; }]); } if (d.beat === 'wave2') { B.script.push([B.t + .6, b => b.tap('Digit7')]); B.goal = { x: -41, z: -153 }; } if (d.beat === 'free') { B.prio = true; B.goal = sc.cage; B.reach = 1.6; } if (d.beat === 'pier') { B.goal = sc.back; B.goals = [sc.pier]; } B.script.sort((a, b) => a[0] - b[0]); }); return { hours: sc.hours }; }
  };
  GT.showcase.combat = ({ scene, camera }) => {
    if (Q.get('selftest')) { const lines = selftest(), el = document.createElement('pre'); el.style.cssText = 'position:fixed;left:16px;top:14px;right:16px;margin:0;color:#dfe;font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;z-index:8'; el.innerHTML = '<b style="color:#fff">GT.combat self-test — ' + lines.filter(l => l.startsWith('PASS')).length + ' / ' + lines.length + ' passed</b>\n' + lines.map(l => '<span style="color:' + (l.startsWith('PASS') ? '#8fe6a0' : '#ff7a6a') + '">' + l.replace(/</g, '&lt;') + '</span>').join('\n'); document.body.appendChild(el); scene.background = new T.Color(0x0c0e12); document.title = 'ready'; return { cam: [0, 2, 5], look: [0, 1, 0] }; }
    const name = SCENES[Q.get('scene')] ? Q.get('scene') : Q.get('scene') === 'weapons' ? 'weapons' : 'range'; if (name === 'weapons' && GT.showcase.combat_weapons) return GT.showcase.combat_weapons({ scene, camera });
    const at = Q.get('at') !== null ? +Q.get('at') : 3, live = Q.get('live') === '1' || (Q.get('auto') !== '1' && Q.get('at') === null);
    init(scene, {}); ensureWorld(scene, name); S.autoCam = !Q.get('cam'); S.ctx = { camera }; S.cam = camera; rnd = GT.rng('combat:' + name); const B = makeBot(); S.bot = B; const info = SCENES[name](B) || {}; B.script.sort((a, b) => a[0] - b[0]);
    const hours = Q.get('t') !== null ? +Q.get('t') : info.hours || 18.2; if (GT.atmos && GT.atmos.setTime) { try { GT.atmos.setTime(hours); } catch (e) {} }
    if (Q.get('auto') === '0') { S.bot = null; } if (Q.get('god') === '1') opts.god = true;
    let err = null; try { for (let t = 0; t < at - 1e-6; t += 1 / 60) update(1 / 60, { camera }); } catch (e) { err = e; const eb = document.getElementById('err'); if (eb) eb.textContent += 'combat preroll: ' + (e.stack || e) + '\n'; }
    if (Q.get('dbg')) { const eb = document.getElementById('err'); if (eb) eb.textContent += JSON.stringify(Object.assign({}, GT.combat.state, { target: null }), (k, v) => typeof v === 'number' ? +v.toFixed(2) : v) + '\n' + enemies.map(e => e.kind + ':' + e.state + (e.intent ? '/' + e.intent : '') + ' hp' + e.hp.toFixed(0) + ' @' + e.x.toFixed(1) + ',' + e.z.toFixed(1)).join('  ') + '\n' + JSON.stringify(stats) + '\n' + 'bot t=' + B.t.toFixed(2) + ' si=' + B.si + '/' + B.script.length + ' cur=' + P.cur + ' hol=' + P.holstered + ' owned=' + Object.keys(P.owned) + ' mode=' + P.mode + ' aimK=' + P.aimK.toFixed(2) + ' err=' + (+B.err).toFixed(3) + ' yaw=' + CAM.yaw.toFixed(2) + ' pitch=' + CAM.pitch.toFixed(2) + ' eng=' + S.engaged + '\n'; }
    return { cam: [P.x - 4, 3, P.z], look: [P.x, 1, P.z], hours, update(dt) { for (const m of S.built || []) { if (m.update) { try { m.update(dt); } catch (e) {} } } if (live) update(dt, { camera }); else if (S.autoCam && !err) { cameraUpdate(0, 0); HUD.update(0); } } };
  };
})();
