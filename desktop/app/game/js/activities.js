/* activities.js — SUNSET HEAT round 2: the things to do. Owner: activities agent.
   GT.activities = { init(scene, opts), update(dt), list, stats, start(id, ctx, arg), stop(), active, on(evt, cb), karma, karmaIndicator(), addKarma(n, why),
                     scouted, addPOI(poi), race: { start(), stop(), update(dt, carState), checkpoints, state, medals }, inventory, sellFish(), jukebox(), setController(ctl), dog }
   Ten small self-contained activities (hoops, weights, fishing, vending, bar, dog, binoculars, ring, race, karma). Each one registers through GT.act
   (queued on GT._actQueue when onfoot.js is not loaded yet) and borrows the camera / controls through ctx.ctl.takeover. Without an on-foot controller
   (showcase, tests) the module drives the hero stand-in and the camera itself. All HUD is DOM + one small 2D canvas, CSS injected here.
   Every activity keeps the hero in frame (third person); only the binocular lens view looks through the glass, after a third-person raise.
   Showcase: showcase.html?m=activities&act=<hoops|weights|fishing|vending|bar|dog|binoculars|ring|race>&at=<seconds>&auto=1[&play=1][&sub=<variant>] */
(function () {
  'use strict';
  const T = THREE, GT = window.GT; if (!T || !GT) return;
  const PI = Math.PI, TAU = PI * 2, HP = PI / 2, sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max;
  const cl = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t, ss = (x, a, b) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ease = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
  const V3 = (x, y, z) => new T.Vector3(x, y, z), C = hex => new T.Color(hex).convertSRGBToLinear();
  const fwd = h => [sin(h), cos(h)], rgt = h => [-cos(h), sin(h)];
  const _v = V3(), _v2 = V3();
  const money = n => '$' + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0);

  /* ================================================================== module state */
  const A = { scene: null, camera: null, opts: {}, root: null, time: 0, inited: false, active: null, auto: false, ctl: null, rnd: GT.rng('activities'),
    listeners: {}, spots: [], fb: {}, pois: [], scouted: [], karma: 0, inv: { snack: 0, drink: 0, fish: [] }, standin: null, cast: {}, cut: false, npcs: [],
    stats: { hoops: { shots: 0, made: 0, streak: 0, bestStreak: 0, challengeWins: 0, challengeTries: 0 }, physique: 12, lifts: { sets: 0, reps: 0, failed: 0 },
      fish: { caught: 0, lost: 0, biggest: null, sold: 0, earned: 0 }, vend: { bought: 0, eaten: 0, kicked: 0 }, focus: .5,
      bar: { drinks: 0, tips: 0, songs: 0, rumours: [] }, dog: { pets: 0, feeds: 0, bond: 0 }, scout: { tagged: 0 }, ring: { bets: 0, won: 0, net: 0, watched: 0 },
      race: { runs: 0, best: null, medal: null }, karma: 0 } };
  const ST = A.stats, SAVE_KEY = 'sunsetheat.activities';
  const on = (evt, cb) => { (A.listeners[evt] = A.listeners[evt] || []).push(cb); return () => { const l = A.listeners[evt], i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); }; };
  const emit = (evt, data) => { for (const cb of (A.listeners[evt] || []).concat(A.listeners['*'] || [])) { try { cb(data, evt); } catch (e) { console.warn('activities listener', e); } } };
  function save() { if (A.opts.persist === false) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify({ physique: ST.physique, karma: A.karma, best: ST.race.best, medal: ST.race.medal, ghost: RACE.ghost, bestStreak: ST.hoops.bestStreak, biggest: ST.fish.biggest })); } catch (e) { /* private mode */ } }
  function load() { if (A.opts.persist === false) return; try { const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (!d) return; if (d.physique > 0) ST.physique = cl(d.physique, 0, 100); if (typeof d.karma === 'number') A.karma = ST.karma = cl(d.karma, -1, 1);
      if (d.best > 0) { ST.race.best = d.best; ST.race.medal = d.medal || null; if (Array.isArray(d.ghost) && d.ghost.length > 8) RACE.ghost = d.ghost; } if (d.bestStreak) ST.hoops.bestStreak = d.bestStreak; if (d.biggest) ST.fish.biggest = d.biggest; } catch (e) { /* ignore */ } }

  /* ---- money (pinned contract: whoever loads first creates it) */
  GT.wallet = GT.wallet || (function () { const cbs = []; const w = { cash: 0, add(n, why) { n = +n || 0; w.cash += n; for (const cb of cbs) { try { cb(w.cash, n, why); } catch (e) { /* */ } } return w.cash; }, spend(n) { n = +n || 0; if (w.cash < n) return false; w.cash -= n; for (const cb of cbs) { try { cb(w.cash, -n, 'spend'); } catch (e) { /* */ } } return true; }, on(cb) { cbs.push(cb); } }; return w; })();
  const W = GT.wallet;

  /* ---- interaction registration helper (GT.act, or the queue onfoot.js drains) */
  function addSpot(s) { A.spots.push(s); if (GT.act && GT.act.add) GT.act.add(s); else (GT._actQueue = GT._actQueue || []).push(s); return s; }

  /* ---- input: GT.input when present, own tiny reader otherwise, scripted keys on autoplay */
  const OWN = { d: {}, p: {}, look: { dx: 0, dy: 0 }, wheel: 0, bound: false };
  function bindOwn() { if (OWN.bound) return; OWN.bound = true;
    addEventListener('keydown', e => { if (!OWN.d[e.code]) OWN.p[e.code] = true; OWN.d[e.code] = true; });
    addEventListener('keyup', e => { OWN.d[e.code] = false; });
    addEventListener('mousedown', e => { const c = 'Mouse' + e.button; OWN.p[c] = true; OWN.d[c] = true; }); addEventListener('mouseup', e => { OWN.d['Mouse' + e.button] = false; });
    addEventListener('mousemove', e => { if (document.pointerLockElement || OWN.d.Mouse0) { OWN.look.dx += (e.movementX || 0) * .0022; OWN.look.dy += (e.movementY || 0) * .0022; } });
    addEventListener('wheel', e => { OWN.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('blur', () => { OWN.d = {}; }); }
  const ownInput = { down: c => !!OWN.d[c], pressed: c => !!OWN.p[c], axis: () => ({ x: (OWN.d.KeyD ? 1 : 0) - (OWN.d.KeyA ? 1 : 0), y: (OWN.d.KeyW ? 1 : 0) - (OWN.d.KeyS ? 1 : 0) }), look: OWN.look, consume: c => { OWN.p[c] = false; } };
  const VK = { d: {}, p: {}, look: { dx: 0, dy: 0 } };                                  // virtual keys (autoplay)
  const virtInput = { down: c => !!VK.d[c], pressed: c => !!VK.p[c], axis: () => ({ x: (VK.d.KeyD ? 1 : 0) - (VK.d.KeyA ? 1 : 0), y: (VK.d.KeyW ? 1 : 0) - (VK.d.KeyS ? 1 : 0) }), look: VK.look, consume: c => { VK.p[c] = false; }, wheel: 0,
    hold(c, v) { if (v && !VK.d[c]) VK.p[c] = true; VK.d[c] = !!v; }, tap(c) { VK.p[c] = true; } };
  /** wrap whatever input object we were handed so activities can also read keys GT.input may not report (wheel, Escape under pointer lock) */
  function wrapInput(src) { src = src || GT.input || ownInput; const own = src === ownInput; return { down: c => !!(src.down(c) || OWN.d[c]), pressed: c => !!(src.pressed(c) || OWN.p[c]), axis: () => { const a = src.axis ? src.axis() : { x: 0, y: 0 }; return (a.x || a.y) ? a : ownInput.axis(); },
      look: !own && src.look ? src.look : OWN.look, consume: c => { if (src.consume) src.consume(c); OWN.p[c] = false; }, wheel: OWN.wheel }; }
  const anyPressed = (inp, list) => list.some(c => inp.pressed(c));
  const K_OK = ['KeyE', 'Enter'], K_GO = ['Space'], K_EXIT = ['Escape', 'Backspace'], K_L = ['KeyA', 'ArrowLeft'], K_R = ['KeyD', 'ArrowRight'], K_U = ['KeyW', 'ArrowUp'], K_D = ['KeyS', 'ArrowDown'];

  /* ---- sound: GT.audio.sfx for what it has, a few tiny synthesized one-shots (through GT.audio's context) for the rest */
  const HAS = n => GT.audio && GT.audio.sfxNames && GT.audio.sfxNames.includes(n);
  let noiseBuf = null;
  function synth(fn) { const ac = GT.audio && GT.audio.ctx; if (!ac || ac.state !== 'running') return; try { const out = ac.createGain(); out.gain.value = .5; out.connect(ac.destination); fn(ac, out, ac.currentTime + .005); } catch (e) { /* */ } }
  function tone(ac, out, t, o) { const os = ac.createOscillator(), g = ac.createGain(); os.type = o.type || 'sine'; os.frequency.setValueAtTime(o.f, t); if (o.f1) os.frequency.exponentialRampToValueAtTime(o.f1, t + (o.ft || o.d)); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.g || .3, t + (o.a || .004)); g.gain.exponentialRampToValueAtTime(.0008, t + o.d); os.connect(g); g.connect(out); os.start(t); os.stop(t + o.d + .03); }
  function noise(ac, out, t, o) { if (!noiseBuf || noiseBuf.sampleRate !== ac.sampleRate) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0), r = GT.rng('actnoise'); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noiseBuf; s.loop = true; f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f, t); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.d); f.Q.value = o.q || 1;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.g || .3, t + (o.a || .004)); g.gain.exponentialRampToValueAtTime(.0008, t + o.d); s.connect(f); f.connect(g); g.connect(out); s.start(t, (t * 7.3) % .9); s.stop(t + o.d + .03); }
  const SND = {
    bounce: (ac, o, t, p) => { tone(ac, o, t, { f: 150, f1: 62, d: .12, g: .5 * p.g }); noise(ac, o, t, { type: 'lowpass', f: 900, d: .05, g: .25 * p.g }); },
    rim: (ac, o, t, p) => { tone(ac, o, t, { type: 'triangle', f: 412, f1: 396, d: .35, g: .22 * p.g }); tone(ac, o, t, { f: 1130, d: .18, g: .1 * p.g }); noise(ac, o, t, { f: 2600, q: 3, d: .04, g: .2 * p.g }); },
    board: (ac, o, t, p) => { tone(ac, o, t, { f: 210, f1: 120, d: .14, g: .4 * p.g }); noise(ac, o, t, { type: 'lowpass', f: 1400, d: .07, g: .3 * p.g }); },
    swish: (ac, o, t, p) => { noise(ac, o, t, { f: 3200, f1: 900, q: .8, a: .02, d: .32, g: .35 * p.g }); },
    whoosh: (ac, o, t, p) => { noise(ac, o, t, { f: 600, f1: 2400, q: 1.2, a: .08, d: .3, g: .22 * p.g }); },
    splash: (ac, o, t, p) => { noise(ac, o, t, { f: 1500, f1: 420, q: .7, a: .01, d: .5, g: .4 * p.g }); tone(ac, o, t, { f: 320, f1: 90, d: .18, g: .2 * p.g }); },
    plop: (ac, o, t, p) => { tone(ac, o, t, { f: 520, f1: 190, d: .09, g: .35 * p.g }); noise(ac, o, t + .02, { f: 2400, q: 1, d: .12, g: .12 * p.g }); },
    reel: (ac, o, t, p) => { for (let i = 0; i < 4; i++) noise(ac, o, t + i * .028, { f: 3800, q: 6, d: .014, g: .16 * p.g }); },
    clunk: (ac, o, t, p) => { tone(ac, o, t, { f: 120, f1: 58, d: .16, g: .6 * p.g }); noise(ac, o, t, { type: 'lowpass', f: 700, d: .08, g: .4 * p.g }); tone(ac, o, t + .11, { type: 'triangle', f: 880, f1: 640, d: .1, g: .12 * p.g }); },
    coin: (ac, o, t, p) => { tone(ac, o, t, { type: 'triangle', f: 2100, d: .09, g: .14 * p.g }); tone(ac, o, t + .07, { type: 'triangle', f: 2800, d: .16, g: .12 * p.g }); },
    kick: (ac, o, t, p) => { tone(ac, o, t, { f: 90, f1: 44, d: .22, g: .7 * p.g }); noise(ac, o, t, { f: 420, q: .6, d: .12, g: .5 * p.g }); tone(ac, o, t + .03, { type: 'square', f: 233, f1: 201, d: .3, g: .05 * p.g }); },
    fizz: (ac, o, t, p) => { noise(ac, o, t, { f: 6500, q: 1.5, a: .005, d: .09, g: .25 * p.g }); noise(ac, o, t + .08, { type: 'highpass', f: 5000, a: .05, d: .7, g: .08 * p.g }); },
    gulp: (ac, o, t, p) => { for (let i = 0; i < 3; i++) tone(ac, o, t + i * .32, { f: 190, f1: 320, ft: .08, d: .12, g: .16 * p.g }); },
    bark: (ac, o, t, p) => { for (let i = 0; i < (p.n || 2); i++) { const tt = t + i * .26; tone(ac, o, tt, { type: 'sawtooth', f: 520, f1: 260, d: .13, g: .13 * p.g }); noise(ac, o, tt, { f: 1100, q: 1.4, d: .12, g: .22 * p.g }); } },
    pant: (ac, o, t, p) => { for (let i = 0; i < 4; i++) noise(ac, o, t + i * .19, { f: 2300, q: .9, a: .03, d: .12, g: .07 * p.g }); },
    bell: (ac, o, t, p) => { for (const f of [1320, 1985, 2640]) tone(ac, o, t, { type: 'triangle', f, d: 1.1, g: .1 * p.g }); },
    crowd: (ac, o, t, p) => { noise(ac, o, t, { f: 950, f1: 1500, q: .5, a: .12, d: p.d || 1.2, g: .28 * p.g }); noise(ac, o, t + .05, { f: 2300, q: .8, a: .2, d: (p.d || 1.2) * .8, g: .1 * p.g }); },
    slam: (ac, o, t, p) => { tone(ac, o, t, { f: 85, f1: 38, d: .3, g: .8 * p.g }); noise(ac, o, t, { type: 'lowpass', f: 500, d: .14, g: .5 * p.g }); },
    plate: (ac, o, t, p) => { tone(ac, o, t, { type: 'triangle', f: 760, f1: 730, d: .22, g: .1 * p.g }); tone(ac, o, t, { type: 'triangle', f: 1210, d: .12, g: .06 * p.g }); noise(ac, o, t, { f: 3000, q: 2, d: .03, g: .12 * p.g }); },
    beat: (ac, o, t, p) => { tone(ac, o, t, { type: 'triangle', f: p.f || 660, d: .05, g: .09 * p.g }); },
    tick: (ac, o, t, p) => { tone(ac, o, t, { type: 'square', f: 1500, d: .02, g: .04 * p.g }); },
    gate: (ac, o, t, p) => { tone(ac, o, t, { type: 'triangle', f: 880, d: .1, g: .14 * p.g }); tone(ac, o, t + .09, { type: 'triangle', f: 1320, d: .22, g: .14 * p.g }); },
    shutter: (ac, o, t, p) => { noise(ac, o, t, { f: 4200, q: 3, d: .025, g: .2 * p.g }); tone(ac, o, t + .03, { type: 'triangle', f: 1760, d: .07, g: .08 * p.g }); }
  };
  /** play a sound by name: GT.audio.sfx if it knows it, otherwise the local synth table. opts.g scales volume. */
  function snd(name, opts) { opts = opts || {}; if (opts.g === undefined) opts.g = 1; if (A.silent) return; emit('sound', { name });
    if (HAS(name)) { try { GT.audio.sfx(name, opts); } catch (e) { /* */ } return; } if (SND[name]) synth((ac, o, t) => SND[name](ac, o, t, opts)); }

  /* ================================================================== HUD (DOM, injected CSS) */
  const CSS = `
.ga-root{position:fixed;inset:0;pointer-events:none;z-index:30;font-family:"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;color:#f1ede4;-webkit-font-smoothing:antialiased;letter-spacing:.02em}
.ga-root *{box-sizing:border-box}
.ga-title{position:absolute;left:28px;top:26px;padding:0 0 0 13px;opacity:0;transform:translateX(-10px);transition:opacity .35s,transform .35s}
.ga-title::before{content:"";position:absolute;left:0;top:3px;bottom:3px;width:2px;background:#ffb454}
.ga-root.on .ga-title{opacity:1;transform:none}
.ga-name{font-size:19px;font-weight:600;letter-spacing:.14em;text-shadow:0 1px 8px rgba(0,0,0,.75)}
.ga-sub{font-size:12.5px;opacity:.86;margin-top:3px;letter-spacing:.08em;text-shadow:0 1px 6px rgba(0,0,0,.85)}
.ga-stats{position:absolute;left:28px;top:84px;display:flex;gap:1px;opacity:0;transition:opacity .35s}
.ga-root.on .ga-stats{opacity:1}
.ga-stat{background:rgba(10,12,16,.58);border-top:1px solid rgba(255,255,255,.16);padding:6px 12px 7px;min-width:62px;backdrop-filter:blur(6px)}
.ga-stat b{display:block;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.03em;line-height:1.15;white-space:nowrap}
.ga-stat i{display:block;font-style:normal;font-size:10.5px;opacity:.62;letter-spacing:.16em;margin-top:1px}
.ga-stat.hot b{color:#ffb454}
.ga-meter{position:absolute;left:50%;bottom:54px;transform:translateX(-50%);opacity:0;transition:opacity .25s}
.ga-root.on .ga-meter{opacity:1}
.ga-meter canvas{display:block;position:static;inset:auto;width:auto;height:auto}
.ga-msg{position:absolute;left:0;right:0;bottom:168px;text-align:center;font-size:27px;font-weight:600;letter-spacing:.3em;text-indent:.3em;text-shadow:0 2px 14px rgba(0,0,0,.8),0 0 2px rgba(0,0,0,.6);opacity:0;transition:opacity .18s}
.ga-msg.show{opacity:1}.ga-msg small{display:block;font-size:13px;letter-spacing:.14em;text-indent:.14em;font-weight:400;opacity:.9;margin-top:6px}
.ga-msg.good{color:#ffd28a}.ga-msg.bad{color:#ff9a8a}.ga-msg.cool{color:#9fe8dc}
.ga-keys{position:absolute;right:28px;bottom:30px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;opacity:0;transition:opacity .3s}
.ga-root.on .ga-keys{opacity:1}
.ga-key{display:flex;align-items:center;gap:9px;font-size:13px;letter-spacing:.1em;text-shadow:0 1px 6px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,.7)}
.ga-key kbd{font:600 11px/1 "SF Mono",ui-monospace,Menlo,monospace;min-width:24px;height:22px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.55);border-radius:3px;background:rgba(10,12,16,.5);letter-spacing:.04em;margin-left:-5px}
.ga-key kbd:first-of-type{margin-left:0}
.ga-key.dim{opacity:.45}
.ga-menu{position:absolute;right:28px;top:50%;transform:translateY(-58%);width:292px;opacity:0;transition:opacity .25s;display:none}
.ga-menu.show{opacity:1;display:block}
.ga-menu h4{margin:0 0 8px;font-size:11px;font-weight:500;letter-spacing:.3em;opacity:.8;text-shadow:0 1px 6px rgba(0,0,0,.9)}
.ga-item{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:8px 12px 9px;margin-bottom:2px;background:rgba(10,12,16,.55);border-left:2px solid transparent;backdrop-filter:blur(6px);font-size:14.5px;letter-spacing:.06em}
.ga-item small{display:block;font-size:11px;opacity:.6;letter-spacing:.06em;margin-top:2px}
.ga-item em{font-style:normal;font-variant-numeric:tabular-nums;font-size:13px;opacity:.85;white-space:nowrap}
.ga-item.sel{background:rgba(26,23,18,.82);border-left-color:#ffb454}.ga-item.sel em{color:#ffb454;opacity:1}
.ga-item.off{opacity:.42}
.ga-toasts{position:absolute;left:0;right:0;top:24px;display:flex;flex-direction:column;align-items:center;gap:6px}
.ga-toast{font-size:13.5px;letter-spacing:.1em;padding:7px 16px 8px;background:rgba(10,12,16,.62);border-bottom:1px solid rgba(255,255,255,.2);backdrop-filter:blur(6px);animation:ga-in .3s ease-out both;text-shadow:0 1px 4px rgba(0,0,0,.6)}
.ga-toast b{font-weight:600;color:#ffb454;margin-right:.6em}.ga-toast.out{opacity:0;transition:opacity .4s}
.ga-toast.k-good b{color:#9fe8dc}.ga-toast.k-bad b{color:#ff8f7c}
@keyframes ga-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.ga-say{position:absolute;left:50%;bottom:176px;transform:translateX(-50%);max-width:66%;text-align:center;font-size:18px;line-height:1.5;letter-spacing:.06em;text-shadow:0 1px 3px #000,0 0 14px rgba(0,0,0,.8);opacity:0;transition:opacity .25s}
.ga-say.show{opacity:1}.ga-say b{font-weight:500;opacity:.72;margin-right:.7em;font-size:14px;letter-spacing:.14em}
.ga-bino{position:absolute;inset:0;display:none}
.ga-bino.show{display:block}
.ga-bino svg{position:absolute;inset:0;width:100%;height:100%}
.ga-bino .ga-tag{position:absolute;transform:translate(14px,-50%);font-size:12px;letter-spacing:.14em;white-space:nowrap;padding:3px 8px 4px;border-left:1px solid rgba(255,255,255,.75);background:linear-gradient(90deg,rgba(8,10,12,.62),rgba(8,10,12,0));text-shadow:0 1px 3px #000}
.ga-bino .ga-tag small{display:block;font-size:10px;opacity:.75;letter-spacing:.1em}
.ga-bino .ga-tag.done{border-left-color:#ffb454;color:#ffd9a0}
.ga-bino .ga-dot{position:absolute;width:9px;height:9px;margin:-4.5px;border:1px solid rgba(255,255,255,.9);transform:rotate(45deg)}
.ga-bino .ga-dot.done{background:#ffb454;border-color:#ffb454}
.ga-bino .ga-read{position:absolute;left:50%;bottom:12.5%;transform:translateX(-50%);font:500 12px/1.6 "SF Mono",ui-monospace,Menlo,"PingFang SC",monospace;letter-spacing:.16em;text-align:center;opacity:.92;text-shadow:0 1px 3px #000;white-space:nowrap}
.ga-bino .ga-list{position:absolute;left:15%;top:24%;font-size:12px;letter-spacing:.12em;line-height:1.9;text-shadow:0 1px 3px #000}
.ga-bino .ga-list b{font-weight:500;color:#ffb454;margin-right:.5em}.ga-bino .ga-list span{opacity:.5}.ga-bino .ga-list div.done span{opacity:1}
`;
  const HUD = { root: null, el: {}, cv: null, g: null, w: 460, h: 96, cache: {}, msgT: 0, toasts: [], sayT: 0 };
  function hudInit() { if (HUD.root) return; const st = document.createElement('style'); st.id = 'ga-css'; st.textContent = CSS; document.head.appendChild(st);
    const r = HUD.root = document.createElement('div'); r.className = 'ga-root';
    r.innerHTML = '<div class="ga-bino"></div><div class="ga-title"><div class="ga-name"></div><div class="ga-sub"></div></div><div class="ga-stats"></div><div class="ga-msg"></div><div class="ga-meter"><canvas></canvas></div><div class="ga-menu"></div><div class="ga-keys"></div><div class="ga-say"></div><div class="ga-toasts"></div>';
    document.body.appendChild(r); for (const k of ['name', 'sub', 'stats', 'msg', 'meter', 'menu', 'keys', 'say', 'bino', 'toasts']) HUD.el[k] = r.querySelector('.ga-' + k);
    HUD.cv = r.querySelector('canvas'); HUD.g = HUD.cv.getContext('2d'); hudSize(HUD.w, HUD.h); }
  function hudSize(w, h) { const d = 2; HUD.w = w; HUD.h = h; HUD.cv.width = w * d; HUD.cv.height = h * d; HUD.cv.style.width = w + 'px'; HUD.cv.style.height = h + 'px'; HUD.g.setTransform(d, 0, 0, d, 0, 0); }
  const setHTML = (key, html) => { if (HUD.cache[key] !== html) { HUD.cache[key] = html; HUD.el[key].innerHTML = html; } };
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function hudOpen(def) { hudInit(); HUD.root.classList.add('on'); setHTML('name', esc(def.name)); HUD.el.menu.classList.remove('show'); HUD.el.msg.classList.remove('show'); HUD.msgT = 0; }
  function hudClose() { if (!HUD.root) return; HUD.root.classList.remove('on'); HUD.el.menu.classList.remove('show'); HUD.el.bino.classList.remove('show'); HUD.g.clearRect(0, 0, HUD.w, HUD.h); }
  /** info = { sub, stats:[[label,value,hot?]], keys:[[key,label,dim?]], menu:{title, items:[{label, note, price, off}], sel} | null } */
  function hudInfo(info) { setHTML('sub', esc(info.sub || ''));
    setHTML('stats', (info.stats || []).map(s => '<div class="ga-stat' + (s[2] ? ' hot' : '') + '"><b>' + esc(s[1]) + '</b><i>' + esc(s[0]) + '</i></div>').join(''));
    setHTML('keys', (info.keys || []).map(k => '<div class="ga-key' + (k[2] ? ' dim' : '') + '"><span>' + esc(k[1]) + '</span>' + String(k[0]).split('/').map(x => '<kbd>' + esc(x) + '</kbd>').join('') + '</div>').join(''));
    const m = info.menu; HUD.el.menu.classList.toggle('show', !!m);
    if (m) setHTML('menu', '<h4>' + esc(m.title || '') + '</h4>' + m.items.map((it, i) => '<div class="ga-item' + (i === m.sel ? ' sel' : '') + (it.off ? ' off' : '') + '"><div>' + esc(it.label) + (it.note ? '<small>' + esc(it.note) + '</small>' : '') + '</div><em>' + esc(it.price === undefined ? '' : it.price) + '</em></div>').join('')); }
  /** big transient line above the meter. kind: 'good' | 'bad' | 'cool' | '' */
  function hudMsg(text, sub, kind, secs) { hudInit(); const e = HUD.el.msg; e.className = 'ga-msg show ' + (kind || ''); e.innerHTML = esc(text) + (sub ? '<small>' + esc(sub) + '</small>' : ''); HUD.msgT = secs || 1.6; }
  function toast(tag, text, cls, secs) { hudInit(); const e = document.createElement('div'); e.className = 'ga-toast ' + (cls || ''); e.innerHTML = (tag ? '<b>' + esc(tag) + '</b>' : '') + esc(text); HUD.el.toasts.appendChild(e); HUD.toasts.push({ e, t: secs || 3.2 }); while (HUD.toasts.length > 3) { const o = HUD.toasts.shift(); o.e.remove(); } emit('toast', { tag, text }); }
  /** a spoken line: ctl.say -> GT.front.subtitle -> own overlay */
  function say(who, text, secs) { emit('say', { who, text, silent: true }); return;   /* spoken lines removed (no dialogue in the game); the event stays for tests */
    if (A.ctl && A.ctl.say && !A.auto) { A.ctl.say(who, text, secs); return; } if (GT.front && GT.front.subtitle && !A.auto && A.opts.ownSubs !== true) { GT.front.subtitle(who, text, secs); return; }
    hudInit(); HUD.el.say.innerHTML = (who ? '<b>' + esc(who) + '</b>' : '') + esc(text); HUD.el.say.classList.add('show'); HUD.sayT = secs || cl(1.6 + text.length * .14, 2.2, 6); }
  function hudTick(dt) { if (!HUD.root) return; if (HUD.msgT > 0) { HUD.msgT -= dt; if (HUD.msgT <= 0) HUD.el.msg.classList.remove('show'); } if (HUD.sayT > 0) { HUD.sayT -= dt; if (HUD.sayT <= 0) HUD.el.say.classList.remove('show'); }
    for (let i = HUD.toasts.length - 1; i >= 0; i--) { const o = HUD.toasts[i]; o.t -= dt; if (o.t <= 0 && !o.out) { o.out = true; o.e.classList.add('out'); } if (o.t < -.45) { o.e.remove(); HUD.toasts.splice(i, 1); } } }
  /* canvas drawing helpers for the meter panel */
  const FONT = '"PingFang SC","Noto Sans SC",system-ui,sans-serif';
  const G = {
    panel(g, x, y, w, h) { g.fillStyle = 'rgba(10,12,16,.6)'; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, w, 1); },
    label(g, text, x, y, o) { o = o || {}; g.font = (o.w || 500) + ' ' + (o.s || 11.5) + 'px ' + FONT; g.textAlign = o.align || 'left'; g.textBaseline = 'middle'; g.fillStyle = o.c || 'rgba(241,237,228,.78)'; g.fillText(text, x, y); },
    bar(g, x, y, w, h, v, col) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, w, h); g.fillStyle = col || '#f1ede4'; g.fillRect(x, y, w * cl(v, 0, 1), h); },
    pips(g, x, y, n, on, o) { o = o || {}; const s = o.s || 7, gap = o.gap || 5; for (let i = 0; i < n; i++) { const st = typeof on === 'function' ? on(i) : (i < on ? 1 : 0); g.fillStyle = st === 1 ? (o.c || '#ffb454') : st === 2 ? '#ff8f7c' : 'rgba(255,255,255,.2)'; g.fillRect(x + i * (s + gap), y - s / 2, s, s); } }
  };

  /* ================================================================== karma */
  function addKarma(n, why) { const before = A.karma; A.karma = ST.karma = cl(A.karma + n, -1, 1); if (why) toast(n > 0 ? '善' : '恶', why, n > 0 ? 'k-good' : 'k-bad', 2.6); emit('karma', { value: A.karma, delta: A.karma - before, why }); save(); return A.karma; }
  /** tiny halo / horn indicator for the HUD: { kind: 'halo' | 'horn' | 'none', level 0..1, value -1..1, label } */
  function karmaIndicator() { const k = A.karma, a = abs(k); return { kind: a < .08 ? 'none' : k > 0 ? 'halo' : 'horn', level: cl((a - .08) / .92, 0, 1), value: k, label: a < .08 ? '路人' : k > .6 ? '街坊都夸' : k > 0 ? '人还不错' : k < -.6 ? '见了就躲' : '不太好惹' }; }

  /* ================================================================== figures: the hero (GT.hero contract) or a GT.people stand-in, behind one adapter */
  const HSTATE = { drink: 'use', binoc: 'aim', kick: 'use' };                                        // activity-only states -> pinned GT.hero states
  const PSTATE = { idle: 'idle', walk: 'walk', run: 'run', sprint: 'run', crouch: 'crouch', sit: 'sit', talk: 'talk', phone: 'phone', handsup: 'handsup', aim: 'idle', lean: 'idle', use: 'idle', drink: 'idle', binoc: 'idle', kick: 'idle',
    jumpshot: 'idle', lift: 'idle', fish: 'idle', pet: 'crouch', cheer: 'idle', sit_stool: 'sit', fall: 'idle', carry: 'run', wave: 'wave', grapple: 'idle', strike: 'idle', down: 'idle', pin: 'crouch', stagger: 'idle' };
  const figs = new WeakMap();
  /** wrap a GT.hero instance / GT.people figure into { group, kind, update(dt, state, extra), bone(name), world(name, out), place(x,y,z,h) } */
  function figure(raw) {
    if (!raw) return null; if (raw.__ga) return raw; if (figs.has(raw)) return figs.get(raw);
    const isHero = !!(raw.bones && !Array.isArray(raw.bones) && raw.attach), f = { __ga: true, raw, group: raw.group, kind: isHero ? 'hero' : 'people', state: 'idle', ts: 0, height: raw.height || 1.78 };
    const byName = {}; if (!isHero && Array.isArray(raw.bones)) for (const b of raw.bones) byName[b.name] = b;
    f.bone = n => isHero ? raw.bones[n] : byName[n];
    f.place = (x, y, z, h) => { f.group.position.set(x, y, z); f.group.rotation.set(0, h === undefined ? f.group.rotation.y : h, 0); };
    f.world = (n, out) => { const b = f.bone(n); if (!b) return out.copy(f.group.position).setY(f.group.position.y + 1.2); f.group.updateMatrixWorld(true); return b.getWorldPosition(out); };
    f.update = (dt, state, extra) => { extra = extra || {}; if (state !== f.state) { f.state = state; f.ts = 0; } f.ts += dt;
      if (isHero) raw.update(dt, Object.assign({ state: HSTATE[state] || state, speed: 0, turn: 0, lookYaw: 0, lookPitch: 0, t: f.ts }, extra));
      else { let ps = PSTATE[state] || 'idle', nat = f.npc && NATIVE(state, extra); if (nat) ps = nat; if (state === 'lift' && extra.variant === 'bench' && !extra.lie) ps = 'sit'; const s = { state: ps, speed: extra.speed }; if (extra.lookAt) s.lookAt = extra.lookAt; if (extra.sync !== undefined) s.sync = extra.sync; if (extra.seat !== undefined) s.seat = extra.seat; raw.update(dt, s); if (!nat) overlay(f, state, extra, dt); } };
    figs.set(raw, f); return f; }
  /** NPCs use the upgraded people.js ambient states when that file has them (cheer, wrestle_a/b, sit_stool, drink) */
  const NATIVE = (state, e) => { const st = GT.people && GT.people.states; if (!st) return null; const n = state === 'grapple' ? (e.wr ? 'wrestle_b' : 'wrestle_a') : state === 'cheer' ? 'cheer' : state === 'sit_stool' ? 'sit_stool' : null; return n && st.includes(n) ? n : null; };
  /* pose overlays for GT.people figures (they do not know the activity states). Left-limb values; right is mirrored (y, z negated). */
  function overlay(f, state, e, dt) {
    const b = f.bone, L = (n, x, y, z, k) => { const o = b(n); if (!o) return; k = k === undefined ? 1 : k; o.rotation.x = lerp(o.rotation.x, x, k); o.rotation.y = lerp(o.rotation.y, y, k); o.rotation.z = lerp(o.rotation.z, z, k); };
    const add = (n, x, y, z) => { const o = b(n); if (o) { o.rotation.x += x; o.rotation.y += y || 0; o.rotation.z += z || 0; } };
    const t = f.ts, p = e.phase === undefined ? 0 : e.phase, hips = b('hips');
    if (state === 'jumpshot') { const up = ss(p, .15, .95), kn = p < .45 ? lerp(.15, .6, p / .45) : lerp(.6, 0, cl((p - .45) / .3, 0, 1));
      for (const s of ['L', 'R']) { add('thigh' + s, -kn * .75); add('shin' + s, kn * 1.5); } if (hips) hips.position.y -= kn * .16;
      const fr = p < .7 ? lerp(-1.75, -2.0, p / .7) : lerp(-2.0, -.12, cl((p - .7) / .22, 0, 1));
      L('armR', lerp(-.95, -2.72, up), 0, .1); L('foreR', fr, 0, 0); L('handR', p > .86 ? .7 : -.5, 0, 0);
      L('armL', lerp(-.9, -1.55, up) + (p > .8 ? (p - .8) * 3 : 0), 0, -.3); L('foreL', lerp(-1.7, -1.5, up), 0, 0); add('chest', -.1 * up); add('head', -.12 * up);
    } else if (state === 'lift') { const sh = (e.shake || 0) * sin(t * 37) * .03;
      if (e.variant === 'bench' && e.lie) { for (const s of [1, -1]) { const n = s > 0 ? 'L' : 'R'; L('clav' + n, 0, 0, 0); L('arm' + n, lerp(-.25, -HP, p) + sh, 0, s * lerp(1.32, .12, p)); L('fore' + n, lerp(-1.5, -.06, p), 0, 0); L('hand' + n, 0, 0, 0); L('thigh' + n, -.18, 0, s * .16); L('shin' + n, 1.5, 0, 0); L('foot' + n, -.15, 0, 0); }
        L('spine', 0, 0, 0); L('chest', -.04, 0, 0); L('neck', 0, 0, 0); L('head', .05, 0, 0); if (hips) { hips.rotation.set(0, 0, 0); } }
      else if (e.variant === 'bench') { for (const s of [1, -1]) { const n = s > 0 ? 'L' : 'R'; L('clav' + n, 0, 0, s * .2); L('arm' + n, -.25 + sh, s * (HP - .12), s * lerp(1.38, 2.72, p)); L('fore' + n, lerp(-1.9, -.14, p), 0, 0); L('hand' + n, 0, s * 1.2, 0); } add('chest', -.08 - .05 * p); add('head', -.05); }
      else { for (const s of [1, -1]) { const n = s > 0 ? 'L' : 'R'; L('arm' + n, .04 - .14 * p + sh, 0, s * .12); L('fore' + n, lerp(-.18, -2.25, p), 0, 0); L('hand' + n, 0, s * -1.3, 0); } add('spine', -.05 * p); add('thighL', -.05); add('thighR', -.05); } }
    else if (state === 'fish') { const c = e.cast === undefined ? 1 : e.cast, bend = e.bend || 0;      // cast 0 = rod back over the shoulder, 1 = forward / holding
      L('armR', lerp(-2.7, -1.0 - .25 * bend, c), 0, .12); L('foreR', lerp(-1.7, -.75, c), 0, 0); L('armL', -.7 - .2 * bend, 0, -.35); L('foreL', -1.55 + (e.reel ? sin(t * 14) * .12 : 0), 0, 0);
      add('chest', lerp(-.15, .05, c) - .1 * bend, lerp(-.25, 0, c)); add('spine', -.08 * bend); add('thighL', -.12); add('shinL', .22); add('thighR', .1); }
    else if (state === 'pet') { const st = sin(t * 5.2); L('armR', -1.25 + .1 * st, 0, .2); L('foreR', -.5 - .25 * st, 0, 0); L('handR', .3 * st, 0, 0); add('head', .12, .25); add('chest', .1); }
    else if (state === 'use') { const k = e.reach === undefined ? 1 : e.reach; L('armR', -1.2, 0, .08, k); L('foreR', -.55, 0, 0, k); add('chest', .06 * k, -.12 * k); }
    else if (state === 'drink') { const k = e.reach === undefined ? 1 : e.reach; L('armR', -1.05, .3, .5, k); L('foreR', -2.45, 0, 0, k); add('head', -.28 * k); add('neck', -.08 * k); }
    else if (state === 'binoc') { for (const s of [1, -1]) { const n = s > 0 ? 'L' : 'R'; L('arm' + n, -1.15, s * -.45, s * .45); L('fore' + n, -2.35, 0, 0); } add('head', -.03); }
    else if (state === 'kick') { const k = sin(cl(p, 0, 1) * PI); L('thighR', -1.25 * k, 0, 0, k); L('shinR', lerp(1.2, .15, ss(p, .3, .55)) * k, 0, 0, k); add('spine', -.12 * k); add('armL', -.5 * k); add('armR', .4 * k); if (hips) hips.rotation.y += .25 * k; }
    else if (state === 'cheer') { const w = sin(t * 9 + (e.seed || 0)); for (const s of [1, -1]) { const n = s > 0 ? 'L' : 'R'; L('clav' + n, 0, 0, s * .2); L('arm' + n, -.25, s * (HP - .1), s * (2.0 + .25 * w * s)); L('fore' + n, -.7 - .3 * w, 0, 0); } if (hips) hips.position.y += .025 * max(0, w); add('head', -.12); }
    else if (state === 'lean') { add('spine', .14); add('chest', .1); add('head', -.16); L('armL', -.55, 0, .1); L('foreL', -1.3, 0, 0); L('armR', -.55, 0, -.1); L('foreR', -1.3, 0, 0); add('thighL', -.1); add('shinL', .12); }
    else if (state === 'grapple') { const w = sin(t * 3.1 + (e.seed || 0)); for (const s of [1, -1]) { const n = s > 0 ? 'L' : 'R'; L('arm' + n, -1.35 + .12 * w * s, 0, s * -.12); L('fore' + n, -.55 - .2 * w, 0, 0); add('thigh' + n, -.42 + s * .16); add('shin' + n, .75); } add('spine', .32 + .05 * w); add('chest', .2); add('head', -.38); if (hips) hips.position.y -= .1; }
    else if (state === 'strike') { const k = sin(cl(p, 0, 1) * PI); L('armR', lerp(-.6, -1.55, k), 0, .25 * k); L('foreR', lerp(-2.1, -.15, k), 0, 0); L('armL', -.8, 0, .1); L('foreL', -1.9, 0, 0); add('chest', 0, .5 * k - .2); add('spine', .12, .25 * k); add('thighL', -.3); add('shinL', .45); add('thighR', .15); add('shinR', .25); if (hips) hips.position.y -= .05; }
    else if (state === 'stagger') { add('spine', -.22); add('chest', -.18); add('head', -.2); L('armL', -.5, 0, .6); L('armR', -.3, 0, -.7); L('foreL', -.9, 0, 0); L('foreR', -.6, 0, 0); add('thighR', .25); add('shinR', .3); }
    else if (state === 'down') { L('armL', -.2, 0, 1.25); L('armR', -.2, 0, -1.25); L('foreL', -.5, 0, 0); L('foreR', -.3, 0, 0); add('thighL', -.35 + .05 * sin(t * 2)); add('shinL', .7); add('head', .1, .3 * sin(t * 1.3)); }
    else if (state === 'pin') { L('armL', -1.3, 0, .3); L('armR', -1.3, 0, -.3); L('foreL', -.4, 0, 0); L('foreR', -.4, 0, 0); add('spine', .35); add('chest', .2); }
    if (e.drink && state !== 'drink') { const k = e.drink; L('armR', -1.05, .3, .5, k); L('foreR', -2.45, 0, 0, k); add('head', -.25 * k); }
  }
  /** a simple NPC (GT.people figure): locals, bartender, wrestlers, the ring crowd. f.want / f.extra drive it; A.npcs is ticked in update(). */
  function npc(type, seed, x, y, z, h, opts) { if (!GT.people || !GT.people.make) return null; const types = GT.people.pedTypes || []; if (Array.isArray(type)) type = type.find(t => types.includes(t)) || type[type.length - 1]; let raw; try { raw = GT.people.make('ped', Object.assign({ type, seed, phone: false }, opts || {})); } catch (e) { console.warn('activities npc', e); return null; }
    const f = figure(raw); f.place(x, y, z, h); f.npc = true; f.seed = seed; f.want = 'idle'; f.extra = { seed }; A.root.add(f.group); f.update(0, 'idle', {}); A.npcs.push(f); return f; }

  /* ================================================================== anchors: world registry first, then our private fall-backs */
  const ground = (x, z) => (GT.road && GT.road.groundHeight) ? GT.road.groundHeight(x, z) : 0;
  const SEA_Y = -1.5;
  const rawAnchor = name => GT.world.anchors[name] || A.fb[name] || null;
  /** site('gymBench') -> { x, y, z, h, real, a (the raw anchor) } or null. y: anchor.y, else the ground under it. */
  function site(name) { const a = rawAnchor(name); if (!a) return null; return { x: a.x, z: a.z, y: a.y !== undefined ? a.y : ground(a.x, a.z), h: a.h || 0, real: !!GT.world.anchors[name], seat: a.seat, a }; }
  const sites = (prefix, maxN) => { const out = []; for (let i = 0; i < (maxN || 8); i++) { const s = site(prefix + i); if (s) out.push(s); } if (!out.length) { const s = site(prefix); if (s) out.push(s); } return out; };
  const fbAnchor = (name, x, y, z, h, extra) => { A.fb[name] = Object.assign({ x, y, z, h: h || 0 }, extra || {}); };

  /* ---- shared small textures / materials of our own props */
  const TX = {};
  function canvasTex(key, w, h, draw, o) { if (TX[key]) return TX[key]; const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); if (!o || o.srgb !== false) t.encoding = T.sRGBEncoding; t.anisotropy = 8; if (o && o.repeat) t.wrapS = t.wrapT = T.RepeatWrapping; return TX[key] = t; }
  const speckle = (g, w, h, n, col, r0, r1, rnd) => { for (let i = 0; i < n; i++) { g.fillStyle = col(rnd); g.beginPath(); g.arc(rnd() * w, rnd() * h, r0 + rnd() * (r1 - r0), 0, TAU); g.fill(); } };
  const MATS = {};
  const stdMat = (key, o) => MATS[key] || (MATS[key] = new T.MeshStandardMaterial(o));
  const glowMat = (key, map, col, day, night) => { if (MATS[key]) return MATS[key]; const m = new T.MeshBasicMaterial({ map: map || null, color: 0xffffff }); GT.glow(m, col || new T.Color(1, 1, 1), day, night); m.color.copy(col || new T.Color(1, 1, 1)).multiplyScalar(lerp(day, night, (GT.env && GT.env.night) || 0)); return MATS[key] = m; };
  const padOn = (k, mat, x, z, w, d, top) => { k.box(mat, w, .9, d, x, top - .45, z, { bevel: .02 }); };
  const maxGround = (x, z, w, d) => { let m = -1e9; for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) m = max(m, ground(x - w / 2 + w * i / 4, z - d / 2 + d * j / 4)); return m; };

  /* ================================================================== stand-in set pieces (only where the hangouts anchors are missing) */
  const STAND = { built: {}, net: null, vend: {}, bar: null, ring: null };
  function buildStandins() {
    const k = GT.kit(), need = n => !GT.world.anchors[n] && A.opts.standins !== false, rnd = GT.rng('act-standins');
    /* ---- half-court */
    if (need('hoop')) { STAND.built.hoops = true; const hx = -34, hz = -66.5, h = PI, [fx, fz] = fwd(h), [rx, rz] = rgt(h), F = maxGround(hx + fx * 4.6, hz + fz * 4.6, 13, 12) + .1;
      const P = (a, b, y) => [hx + rx * a + fx * b, y, hz + rz * a + fz * b];                       // a = across, b = out from the board
      let p = P(0, 4.6, 0); padOn(k, 'concrete_stained', p[0], p[2], 13, 12.4, F); k.box('asphalt_worn', 12.4, .03, 11.8, p[0], F + .012, p[2], { bevel: .004 });
      const line = (a0, b0, a1, b1) => { const m0 = P(a0, b0, 0), m1 = P(a1, b1, 0), len = Math.hypot(m1[0] - m0[0], m1[2] - m0[2]); k.box('road_paint_white', .05, .006, len, (m0[0] + m1[0]) / 2, F + .03, (m0[2] + m1[2]) / 2, { ry: Math.atan2(m1[0] - m0[0], m1[2] - m0[2]) }); };
      line(-5.9, -1.2, 5.9, -1.2); line(-5.9, -1.2, -5.9, 10.2); line(5.9, -1.2, 5.9, 10.2); line(-1.8, -1.2, -1.8, 4.6); line(1.8, -1.2, 1.8, 4.6); line(-1.8, 4.6, 1.8, 4.6);
      for (let i = 0; i < 14; i++) { const a0 = -HP + i * PI / 14, a1 = a0 + PI / 14, R = 6.2; line(sin(a0) * R, cos(a0) * R, sin(a1) * R, cos(a1) * R); }
      for (let i = 0; i < 10; i++) { const a0 = -HP + i * PI / 10, a1 = a0 + PI / 10; line(sin(a0) * 1.8, 4.6 + cos(a0) * 1.8, sin(a1) * 1.8, 4.6 + cos(a1) * 1.8); }
      for (let i = 0; i < 7; i++) { p = P(-5 + rnd() * 10, rnd() * 9, F + .034); k.decal(['crack', 'oil_stain', 'gum_spots', 'water_stain', 'patch'][i % 5], 1.6 + rnd() * 1.6, 1.6 + rnd() * 1.6, p[0], p[1], p[2], rnd() * TAU); }
      // pole, gooseneck, board, rim
      const bb = -.375, pole = P(0, -1.55, 0); k.cyl('concrete', .32, .34, .16, pole[0], F + .08, pole[2], { seg: 12 }); k.cyl('metal_dark', .075, .085, 3.5, pole[0], F + 1.75, pole[2], { seg: 14 }); k.cyl('metal_galv', .11, .11, .03, pole[0], F + .17, pole[2], { seg: 12 });
      for (let i = 0; i < 4; i++) { const a = i * HP + .78; k.cyl('metal_galv', .014, .014, .03, pole[0] + cos(a) * .2, F + .18, pole[2] + sin(a) * .2, { seg: 6 }); }
      k.tube('metal_dark', [P(0, -1.55, F + 3.45), P(0, -1.5, F + 3.85), P(0, -1.1, F + 4.02), P(0, bb - .05, F + 3.72)], .06, { seg: 10 }); k.tube('metal_dark', [P(0, -1.52, F + 2.9), P(0, bb - .05, F + 3.3)], .028, { seg: 8 });
      p = P(0, bb - .02, F + 3.43); k.box(GT.mat('metal_painted_white', { color: 0xd9d6cc }), 1.83, 1.07, .035, p[0], p[1], p[2], { ry: h, bevel: .006 }); k.box('metal_dark', 1.89, .05, .06, p[0], F + 2.9, p[2], { ry: h, bevel: .01 }); k.box('metal_dark', 1.89, .05, .06, p[0], F + 3.97, p[2], { ry: h, bevel: .01 });
      for (const s of [-1, 1]) { const q = P(s * .93, bb - .02, F + 3.43); k.box('metal_dark', .05, 1.1, .06, q[0], q[1], q[2], { ry: h, bevel: .01 }); }
      const sq = (a0, y0, a1, y1) => { const m = P((a0 + a1) / 2, bb + .001, F + (y0 + y1) / 2); k.box('metal_painted_red', abs(a1 - a0) + .04, abs(y1 - y0) + .04, .004, m[0], m[1], m[2], { ry: h }); };
      sq(-.3, 3.05, .3, 3.05); sq(-.3, 3.5, .3, 3.5); sq(-.3, 3.05, -.3, 3.5); sq(.3, 3.05, .3, 3.5);
      p = P(0, bb + .003, F + 3.3); k.geo(GT.decalMat('rust_run'), new T.PlaneGeometry(.9, .8), { x: p[0], y: p[1], z: p[2], ry: h }); p = P(.55, bb + .003, F + 3.6); k.geo(GT.decalMat('grime_streak'), new T.PlaneGeometry(.7, .7), { x: p[0], y: p[1], z: p[2], ry: h });
      p = P(0, 0, F + 3.05); const tor = new T.TorusGeometry(.2286, .0095, 8, 28); tor.rotateX(HP); k.geo(GT.mat('metal_painted_red', { color: 0xc4532c }), tor, { x: p[0], y: p[1], z: p[2] });
      p = P(0, bb / 2 - .1, F + 3.03); k.box('metal_painted_red', .12, .03, .2, p[0], p[1], p[2], { ry: h, bevel: .005 }); p = P(0, bb + .02, F + 2.98); k.box('metal_painted_red', .14, .12, .02, p[0], p[1], p[2], { ry: h, bevel: .004 });
      // bench + bag + bottle for a little density
      p = P(-5.2, 3.2, F); k.box('wood_plank', .36, .05, 2.0, p[0], F + .46, p[2], { ry: h, bevel: .01 }); for (const s of [-.8, .8]) { const q = P(-5.2, 3.2 + s, F); k.box('metal_dark', .3, .44, .05, q[0], F + .22, q[2], { ry: h, bevel: .008 }); }
      p = P(-5.15, 2.7, F); k.box(GT.mat('fabric_dark', { color: 0x34404a }), .3, .24, .5, p[0], F + .6, p[2], { ry: h + .3, bevel: .08 }); p = P(-5.3, 3.9, F); k.cyl(GT.mat('plastic_white', { color: 0x9fc4d6 }), .04, .045, .24, p[0], F + .6, p[2], { seg: 10 });
      fbAnchor('hoop', hx, F + 3.05, hz, h, { floorY: F }); const sp = [[-70, 5.0], [-36, 5.3], [0, 4.6], [36, 5.3], [70, 5.0]];
      sp.forEach((s, i) => { const a = s[0] * PI / 180, q = P(sin(a) * s[1], cos(a) * s[1], F); fbAnchor('courtShot' + (i + 1), q[0], F, q[2], Math.atan2(hx - q[0], hz - q[2])); });
      GT.world.addPost(pole[0], pole[2], .2, 4, 'hoop'); p = P(4.9, 6.6, 0); A.fb.courtLocals = { x: p[0], y: F, z: p[2], h: 0 };
      STAND.net = makeNet(P(0, 0, F + 3.05)); }
    /* ---- outdoor gym */
    if (need('gymBench')) { STAND.built.gym = true; const gx = -19, gz = -38, F = maxGround(gx, gz, 7, 5) + .08; padOn(k, 'concrete_stained', gx, gz, 7.4, 5.2, F); k.box(GT.mat('rubber', { color: 0x1c1d1f, rough: .95 }), 6.8, .03, 4.6, gx, F + .012, gz, { bevel: .008 });
      const steel = GT.mat('metal_painted_yellow', { color: 0xb88a1c }), pad = 'leather_black';
      // press station (hero sits facing -X toward the sea)
      const bx = gx + 1.2, bz = gz - .8; k.box(pad, 1.15, .075, .3, bx - .05, F + .47, bz, { bevel: .03 }); k.box(pad, .08, .62, .3, bx + .5, F + .82, bz, { bevel: .03, rz: -.16 });
      for (const s of [-.45, .35]) { k.box('metal_dark', .06, .42, .34, bx + s, F + .22, bz, { bevel: .01 }); k.box('metal_dark', .1, .03, .5, bx + s, F + .03, bz, { bevel: .008 }); } k.box('metal_dark', .9, .05, .06, bx - .05, F + .4, bz, { bevel: .01 });
      for (const s of [-1, 1]) { k.box(steel, .07, 1.5, .07, bx + .62, F + .75, bz + s * .58, { bevel: .01 }); k.box(steel, .5, .05, .09, bx + .5, F + .03, bz + s * .58, { bevel: .01 }); k.box(steel, .16, .035, .06, bx + .56, F + 1.3, bz + s * .58, { bevel: .008 }); k.box(steel, .03, .1, .06, bx + .5, F + 1.34, bz + s * .58, { bevel: .006 });
        k.geo(GT.decalMat('rust_run'), new T.PlaneGeometry(.2, .6), { x: bx + .582, y: F + .5, z: bz + s * .58, ry: -HP }); }
      k.box(steel, .07, .07, 1.16, bx + .62, F + 1.48, bz, { bevel: .01 });
      // curl station: low rack + plate tree + dumbbells
      const cx = gx - 1.5, cz = gz + .9; for (const s of [-1, 1]) { k.box(steel, .06, .95, .06, cx - .42, F + .47, cz + s * .5, { bevel: .01 }); k.box(steel, .4, .05, .08, cx - .3, F + .03, cz + s * .5, { bevel: .01 }); k.box(steel, .15, .03, .06, cx - .36, F + .9, cz + s * .5, { bevel: .006 }); k.box(steel, .03, .08, .06, cx - .3, F + .94, cz + s * .5); }
      k.box(steel, .06, .06, 1.0, cx - .42, F + .25, cz, { bevel: .01 });
      const tx = gx - 2.7, tz = gz - 1.5; k.cyl('metal_dark', .04, .05, 1.1, tx, F + .55, tz, { seg: 10 }); k.box('metal_dark', .6, .04, .6, tx, F + .03, tz, { bevel: .01 });
      for (let i = 0; i < 3; i++) { const y = F + .35 + i * .3; k.cyl('metal_dark', .022, .022, .5, tx, y, tz, { seg: 8, rz: HP }); for (const s of [-1, 1]) for (let q = 0; q < 2 - (i > 1 ? 1 : 0); q++) k.cyl('rubber', .2 - i * .03, .2 - i * .03, .035, tx + s * (.1 + q * .045), y, tz, { seg: 20, rz: HP }); }
      const dx = gx + 2.6, dz = gz + 1.3; k.box('metal_dark', .36, .04, 1.5, dx, F + .5, dz, { bevel: .01, rz: .2 }); for (const s of [-.7, .7]) k.box('metal_dark', .34, .52, .05, dx, F + .26, dz + s, { bevel: .008 });
      for (let i = 0; i < 4; i++) { const z = dz - .52 + i * .35, r = .06 + i * .012; k.cyl('chrome', .014, .014, .2, dx, F + .6, z, { seg: 8, rz: HP }); for (const s of [-1, 1]) k.cyl('rubber', r, r, .07, dx + s * .11, F + .6 - s * .02, z, { seg: 12, rz: HP }); }
      k.cyl(GT.mat('plastic_white', { color: 0x4a7fa8 }), .05, .05, .26, bx - .7, F + .16, bz + .5, { seg: 10 }); k.box(GT.mat('fabric_dark', { color: 0xa9a394 }), .34, .02, .6, bx - .3, F + .52, bz + .02, { bevel: .008, ry: .2 });
      for (let i = 0; i < 4; i++) k.decal(['water_stain', 'gum_spots', 'crack', 'oil_stain'][i], 1.2 + rnd(), 1.2 + rnd(), gx - 2.5 + rnd() * 5, F + .034, gz - 1.6 + rnd() * 3.2, rnd() * TAU);
      fbAnchor('gymBench', bx - .1, F, bz, -HP, { seat: F + .51 }); fbAnchor('gymCurl', cx + .32, F, cz, -HP); A.fb.gymBenchRack = { x: bx + .46, y: F + 1.36, z: bz, h: -HP }; A.fb.gymCurlRack = { x: cx - .3, y: F + .955, z: cz, h: -HP };
      GT.world.addBox(bx - .6, bz - .7, bx + .7, bz + .7, 1.5, 'gym'); GT.world.addBox(dx - .3, dz - .8, dx + .3, dz + .8, .7, 'gym'); GT.world.addPost(tx, tz, .3, 1.2, 'gym'); }
    /* ---- vending machines on the promenade, backs to the seawall */
    if (need('vendDrink')) { STAND.built.vend = true; const y0 = ground(-9.2, -26);
      [['Drink', -25.4], ['Snack', -26.6]].forEach(([nm, vz], i) => { const vx = -9.42, drink = i === 0, body = drink ? GT.mat('metal_painted_blue', { color: 0x1d5560 }) : GT.mat('metal_painted_red', { color: 0x6a2a22 });
        k.push(vx, y0, vz, { ry: HP });                                                               // local +Z = front, toward the road
        k.box('metal_dark', .98, .06, .78, 0, .03, 0, { bevel: .01 }); for (const sx of [-.42, .42]) for (const sz of [-.32, .32]) k.cyl('metal_galv', .028, .034, .05, sx, .025, sz, { seg: 8 });
        k.box(body, .96, 1.78, .76, 0, .95, -.01, { bevel: .018 }); k.box('metal_dark', .9, .05, .7, 0, 1.86, -.01, { bevel: .012 });
        k.box('plastic_black', .68, 1.2, .03, -.11, 1.16, .372, { bevel: .01 }); k.box('plastic_black', .2, 1.2, .03, .355, 1.16, .372, { bevel: .01 });
        k.box('plastic_black', .62, .22, .05, -.11, .33, .365, { bevel: .012 }); k.box(GT.mat('plastic_grey', { color: 0x2c2e31 }), .54, .15, .012, -.11, .34, .392, { bevel: .004, rx: .12 });
        k.box('metal_galv', .1, .16, .012, .355, 1.02, .39, { bevel: .003 }); k.box('plastic_black', .045, .006, .014, .355, 1.06, .397); k.box('metal_galv', .1, .07, .03, .355, .8, .385, { bevel: .006 }); k.box('plastic_black', .07, .035, .02, .355, .795, .398);
        for (let b = 0; b < 4; b++) { k.box('plastic_black', .12, .055, .012, .355, 1.62 - b * .1, .39, { bevel: .004 }); }
        k.cyl('metal_galv', .012, .012, .5, .47, 1.3, .34, { seg: 6 }); k.box('metal_galv', .03, .08, .05, .47, 1.56, .35, { bevel: .004 }); k.box('metal_galv', .03, .08, .05, .47, 1.04, .35, { bevel: .004 });
        k.tube('rubber', [[-.3, .12, -.39], [-.34, .06, -.5], [-.7, .03, -.55], [-1.1, .03, -.5]], .012, { seg: 6 }); k.box('metal_galv', .1, .14, .06, -1.12, .12, -.5, { bevel: .008 });
        k.geo(GT.decalMat('rust_run'), new T.PlaneGeometry(.5, .7), { x: -.482, y: .5, z: .1, ry: -HP }); k.geo(GT.decalMat('grime_streak'), new T.PlaneGeometry(.8, .9), { x: 0, y: .5, z: .373, ry: 0 }); k.geo(GT.decalMat('water_stain'), new T.PlaneGeometry(.6, .6), { x: .482, y: 1.2, z: 0, ry: HP });
        k.pop(); k.decal('leak', 1.1, 1.3, vx + .7, y0 + .008, vz, rnd() * TAU); k.decal('gum_spots', 1.4, 1.4, vx + 1.1, y0 + .008, vz + .3, rnd() * TAU);
        const face = vendFace(drink), fm = new T.Mesh(new T.PlaneGeometry(.64, 1.16), glowMat('vendface' + i, face, new T.Color(1, 1, 1), .62, 1.5)); fm.position.set(vx + .389, y0 + 1.16, vz + .11); fm.rotation.y = HP; A.root.add(fm);
        const sel = new T.Mesh(new T.PlaneGeometry(.1, .04), new T.MeshBasicMaterial({ color: new T.Color(3, 1.7, .5) })); sel.position.set(vx + .398, y0 + 1.62, vz - .355); sel.rotation.y = HP; sel.visible = false; A.root.add(sel);
        STAND.vend[nm] = { sel, y0, x: vx, z: vz }; fbAnchor('vend' + nm, vx + 1.02, y0, vz, -HP); GT.world.addBox(vx - .4, vz - .5, vx + .4, vz + .5, 1.9, 'vending'); }); }
    /* ---- tiki bar */
    if (need('barOrder')) { STAND.built.bar = true; const bx = -19.5, bz = 6, F = maxGround(bx, bz, 7, 6) + .1, wd = 'wood_plank', dark = GT.mat('wood_plank', { color: 0x4a3524 });
      padOn(k, wd, bx, bz, 7.2, 6.4, F); for (let i = 0; i < 24; i++) k.box(i % 3 ? wd : dark, .285, .03, 6.4, bx - 3.45 + i * .3, F + .012, bz, { bevel: .006 });
      for (const [ax, az] of [[-2.6, -2.2], [2.6, -2.2], [-2.6, 2.2], [2.6, 2.2]]) { k.cyl('palm_trunk', .11, .13, 3.0, bx + ax, F + 1.5, bz + az, { seg: 10 }); for (let q = 0; q < 3; q++) k.cyl('rubber', .125, .125, .03, bx + ax, F + .5 + q * .9, bz + az, { seg: 10 }); }
      const thatch = GT.mat('wood_plank', { color: 0x8f7a4c, rough: 1 }); for (let i = 0; i < 5; i++) { const s = 1 - i * .19; k.box(thatch, 6.6 * s, .16, 5.8 * s, bx, F + 3.02 + i * .2, bz, { bevel: .06 }); }
      for (let i = 0; i < 46; i++) { const a = rnd() * TAU, ex = cos(a) > 0 ? 3.3 : -3.3, ez = sin(a) > 0 ? 2.9 : -2.9, side = i % 2; const x = side ? bx + ex : bx - 3.2 + rnd() * 6.4, z = side ? bz - 2.8 + rnd() * 5.6 : bz + ez; k.box(thatch, side ? .03 : .09, .32 + rnd() * .2, side ? .09 : .03, x, F + 2.86 - rnd() * .06, z, { rz: side ? (rnd() - .5) * .3 : 0, rx: side ? 0 : (rnd() - .5) * .3 }); }
      // counter (customers on the +X side, facing -X toward the sea and the bartender)
      const cx = bx + .5; k.box(dark, .5, 1.02, 4.0, cx, F + .51, bz, { bevel: .015 }); k.box(GT.mat('wood_plank', { color: 0x9a6f42, rough: .45 }), .72, .06, 4.3, cx + .06, F + 1.05, bz, { bevel: .02 });
      for (let i = 0; i < 17; i++) k.cyl(GT.mat('wood_plank', { color: 0xa88f5a }), .045, .045, .98, cx + .262, F + .5, bz - 1.92 + i * .24, { seg: 8 }); k.box('metal_galv', .03, .03, 4.1, cx + .42, F + .22, bz, { bevel: .008 }); for (const s of [-1.9, 0, 1.9]) k.box('metal_galv', .14, .03, .03, cx + .35, F + .22, bz + s);
      // back bar: shelf, bottles, cooler, taps
      k.box(dark, .4, .9, 3.2, bx - 1.9, F + .45, bz, { bevel: .015 }); k.box(dark, .34, .04, 3.2, bx - 1.9, F + 1.5, bz, { bevel: .01 }); k.box(dark, .34, .04, 3.2, bx - 1.9, F + 1.95, bz, { bevel: .01 }); for (const s of [-1.6, 1.6]) k.box(dark, .34, 1.1, .05, bx - 1.9, F + 1.45, bz + s, { bevel: .008 });
      const bcol = [0x3a5a34, 0x7a4a22, 0xb9c4c0, 0x2c3f52, 0x8a2f2a, 0xc79a3c]; for (let i = 0; i < 22; i++) { const sh = i % 2, z = bz - 1.45 + (i >> 1) * .28 + rnd() * .04, hgt = .22 + rnd() * .1, m = GT.mat('glass_tint', { color: bcol[(rnd() * 6) | 0] }); k.cyl(m, .034, .038, hgt, bx - 1.9, F + (sh ? 1.97 : 1.52) + hgt / 2, z, { seg: 10 }); k.cyl(m, .013, .02, .09, bx - 1.9, F + (sh ? 1.97 : 1.52) + hgt + .04, z, { seg: 8 }); }
      k.box(GT.mat('plastic_white', { color: 0xb8433a }), .5, .42, .8, bx - .9, F + .22, bz + 1.5, { bevel: .03 }); k.box('plastic_white', .52, .05, .82, bx - .9, F + .45, bz + 1.5, { bevel: .015 });
      for (let i = 0; i < 2; i++) { k.cyl('chrome', .018, .018, .26, cx - .1, F + 1.2, bz + 1.2 + i * .14, { seg: 8 }); k.box('plastic_black', .025, .09, .025, cx - .06, F + 1.36, bz + 1.2 + i * .14, { rz: -.3 }); }
      for (let i = 0; i < 5; i++) k.cyl(GT.mat('glass_clear'), .034, .028, .11, cx - .02, F + 1.135, bz - 1.5 + i * .13 + (i > 2 ? 1.1 : 0), { seg: 10 });
      k.box(GT.mat('plastic_white', { color: 0xcfc6a8 }), .14, .1, .2, cx + .02, F + 1.13, bz - .75, { bevel: .01 }); k.cyl(GT.mat('metal_galv'), .05, .04, .09, cx + .1, F + 1.125, bz + .78, { seg: 10 });
      // stools
      [-1.25, 0, 1.25].forEach((sz, i) => { const sx = cx + .78, z = bz + sz; k.cyl(GT.mat('wood_plank', { color: 0x6c4a2c }), .17, .16, .05, sx, F + .745, z, { seg: 16 }); k.cyl('leather_tan', .165, .17, .035, sx, F + .785, z, { seg: 16 });
        for (let q = 0; q < 4; q++) { const a = q * HP + .78; k.cyl('metal_dark', .016, .02, .76, sx + cos(a) * .14, F + .37, z + sin(a) * .14, { seg: 6, rz: -cos(a) * .12, rx: sin(a) * .12 }); } const ring = new T.TorusGeometry(.17, .011, 6, 18); ring.rotateX(HP); k.geo('metal_dark', ring, { x: sx, y: F + .28, z });
        fbAnchor('barStool' + i, sx, F, z, -HP, { seat: F + .8 }); });
      // chalkboard + string lights + jukebox
      const cb = new T.Mesh(new T.PlaneGeometry(1.5, 1.0), stdMat('chalk', { map: chalkTex(), roughness: .92, metalness: 0 })); cb.position.set(bx - 1.71, F + 2.52, bz); cb.rotation.y = HP; A.root.add(cb); k.box(dark, .05, 1.1, 1.6, bx - 1.75, F + 2.52, bz, { bevel: .01 });
      for (let i = 0; i < 18; i++) { const u = i / 17, z = bz - 2.8 + u * 5.6, y = F + 2.78 - sin(u * PI) * .16; k.sphere(i % 3 ? 'light_warm' : 'neon_amber', .028, bx + 3.25, y - .03, z, { seg: 6, seg2: 4 }); }
      k.tube('rubber', [[bx + 3.25, F + 2.8, bz - 2.8], [bx + 3.25, F + 2.63, bz], [bx + 3.25, F + 2.8, bz + 2.8]], .006, { seg: 4 });
      const jx = bx + 2.3, jz = bz - 2.45, jw = GT.mat('wood_plank', { color: 0x5a2f24, rough: .5 }); k.box(jw, .78, 1.05, .52, jx, F + .53, jz, { bevel: .04 }); k.cyl(jw, .39, .39, .52, jx, F + 1.05, jz, { seg: 20, rx: HP });
      const arch = new T.TorusGeometry(.33, .022, 8, 20, PI); k.geo('neon_amber', arch, { x: jx, y: F + 1.05, z: jz + .265 }); k.box('neon_cyan', .02, .5, .02, jx - .33, F + .8, jz + .265); k.box('neon_cyan', .02, .5, .02, jx + .33, F + .8, jz + .265);
      k.box('chrome', .56, .3, .02, jx, F + .42, jz + .262, { bevel: .006 }); for (let q = 0; q < 6; q++) k.box('plastic_black', .5, .012, .03, jx, F + .3 + q * .045, jz + .268); k.box(glowMat('juke', null, new T.Color(1, .75, .4), .5, 2.4), .46, .3, .01, jx, F + .98, jz + .262);
      for (let q = 0; q < 8; q++) k.box('plastic_white', .035, .02, .02, jx - .2 + q * .057, F + .72, jz + .275, { bevel: .004 });
      fbAnchor('barOrder', cx + .85, F, bz - .62, -HP); fbAnchor('barJukebox', jx, F, jz + .8, PI); A.fb.barTender = { x: bx - .55, y: F, z: bz + .2, h: HP }; A.fb.barTop = { x: cx + .06, y: F + 1.08, z: bz, h: -HP };
      GT.world.addBox(cx - .3, bz - 2.1, cx + .4, bz + 2.1, 1.1, 'bar'); GT.world.addBox(jx - .4, jz - .3, jx + .4, jz + .3, 1.5, 'jukebox'); for (const [ax, az] of [[-2.6, -2.2], [2.6, -2.2], [-2.6, 2.2], [2.6, 2.2]]) GT.world.addPost(bx + ax, bz + az, .14, 3, 'bar'); }
    /* ---- backyard ring */
    if (need('ringCentre')) { STAND.built.ring = true; const rx0 = -27, rz0 = 54, F0 = maxGround(rx0, rz0, 6, 6), F = F0 + .55, S2 = 2.2;
      padOn(k, 'wood_plank', rx0, rz0, 4.7, 4.7, F - .02); k.box(GT.mat('fabric_dark', { color: 0x8f8c82, rough: .95 }), 4.6, .05, 4.6, rx0, F - .005, rz0, { bevel: .02 });
      for (const s of [-1, 1]) { k.box(GT.mat('fabric_dark', { color: 0x20262e }), 4.72, .62, .02, rx0, F - .33, rz0 + s * 2.36); k.box(GT.mat('fabric_dark', { color: 0x20262e }), .02, .62, 4.72, rx0 + s * 2.36, F - .33, rz0); }
      const cols = ['metal_painted_red', 'metal_painted_blue', 'metal_painted_red', 'metal_painted_blue']; [[-1, -1], [1, 1], [1, -1], [-1, 1]].forEach(([sx, sz], i) => { const px = rx0 + sx * S2, pz = rz0 + sz * S2; k.cyl('metal_dark', .055, .06, 1.75, px, F + .62, pz, { seg: 10 }); k.sphere('metal_dark', .06, px, F + 1.5, pz, { seg: 8, seg2: 6 });
        for (let q = 0; q < 3; q++) k.box(GT.mat(cols[i]), .2, .2, .2, px - sx * .1, F + .42 + q * .36, pz - sz * .1, { bevel: .05, ry: PI / 4 }); });
      for (let q = 0; q < 3; q++) { const y = F + .42 + q * .36, col = GT.mat('rubber', { color: [0xb9b3a4, 0x8a2a26, 0x2a4a7a][q], rough: .8 });
        for (const s of [-1, 1]) { k.tube(col, [[rx0 - S2, y, rz0 + s * S2], [rx0, y - .03, rz0 + s * S2], [rx0 + S2, y, rz0 + s * S2]], .016, { seg: 6 }); k.tube(col, [[rx0 + s * S2, y, rz0 - S2], [rx0 + s * S2, y - .03, rz0], [rx0 + s * S2, y, rz0 + S2]], .016, { seg: 6 }); } }
      k.decal('water_stain', 2.2, 2.2, rx0 + .4, F + .024, rz0 - .3, 1); k.decal('grime_streak', 1.6, 1.6, rx0 - 1, F + .024, rz0 + .9, 2); k.decal('gum_spots', 2, 2, rx0, F + .024, rz0, .4);
      // steps, cooler, folding chairs, light poles with a string of bulbs
      for (let q = 0; q < 2; q++) k.box('wood_plank', .9, .2, .32, rx0 + 2.6 + q * .3, F0 + .12 + (1 - q) * .22, rz0 + 1.2, { bevel: .012 });
      k.box(GT.mat('plastic_white', { color: 0x3f6f8a }), .62, .36, .38, rx0 + 3.6, ground(rx0 + 3.6, rz0 - 2.2) + .18, rz0 - 2.2, { bevel: .03, ry: .3 }); k.box('plastic_white', .64, .06, .4, rx0 + 3.6, ground(rx0 + 3.6, rz0 - 2.2) + .39, rz0 - 2.2, { bevel: .02, ry: .3 });
      for (const [cx, cz, ry] of [[4.2, .2, -HP], [4.3, 1.0, -HP - .2], [-.6, 4.0, PI], [.5, 4.1, PI + .2]]) { const x = rx0 + cx, z = rz0 + cz, y = ground(x, z); k.push(x, y, z, { ry }); k.box('metal_painted_white', .42, .025, .4, 0, .44, 0, { bevel: .008 }); k.box('metal_painted_white', .42, .3, .025, 0, .72, -.2, { bevel: .008, rx: -.1 }); for (const sx of [-.2, .2]) { k.cyl('metal_galv', .012, .012, .95, sx, .44, 0, { seg: 6, rx: .32 }); k.cyl('metal_galv', .012, .012, .62, sx, .24, .02, { seg: 6, rx: -.5 }); } k.pop(); }
      for (const [sx, sz] of [[-1, -1], [1, 1], [1, -1], [-1, 1]]) { const px = rx0 + sx * 3.7, pz = rz0 + sz * 3.7, y = ground(px, pz); k.cyl('wood_plank', .05, .06, 4.2, px, y + 2.0, pz, { seg: 8 }); }
      for (let e = 0; e < 4; e++) { const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]], a = c[e], b = c[(e + 1) % 4]; for (let i = 1; i < 9; i++) { const u = i / 9, x = rx0 + lerp(a[0], b[0], u) * 3.7, z = rz0 + lerp(a[1], b[1], u) * 3.7, y = F0 + 3.95 - sin(u * PI) * .45; k.sphere(i % 2 ? 'light_warm' : 'neon_white', .035, x, y, z, { seg: 6, seg2: 4 }); }
        k.tube('rubber', [[rx0 + a[0] * 3.7, F0 + 4.0, rz0 + a[1] * 3.7], [rx0 + (a[0] + b[0]) * 1.85, F0 + 3.52, rz0 + (a[1] + b[1]) * 1.85], [rx0 + b[0] * 3.7, F0 + 4.0, rz0 + b[1] * 3.7]], .006, { seg: 4 }); }
      fbAnchor('ringCentre', rx0, F + .02, rz0, 0); [[3.3, -.9, -HP], [3.2, -2.6, -HP + .5], [-1.6, 3.4, PI], [1.6, 3.5, PI], [-3.3, .6, HP], [-3.2, -1.4, HP], [0, -3.4, 0], [3.4, 2.4, -HP - .5]].forEach((s, i) => fbAnchor('ringSide' + i, rx0 + s[0], ground(rx0 + s[0], rz0 + s[1]), rz0 + s[1], s[2]));
      GT.world.addBox(rx0 - 2.4, rz0 - 2.4, rx0 + 2.4, rz0 + 2.4, 1.8, 'ring'); }
    const g = k.build(); g.name = 'activities_standins'; A.root.add(g);
    /* ---- places that never come from hangouts */
    if (!site('fishSpot0')) { const y = ground(-70, 78) || .16; [-66, -80, -94].forEach((x, i) => fbAnchor('fishSpot' + i, x, y, 79.45, 0)); }
    if (!site('dogHome')) fbAnchor('dogHome', -8.7, ground(-8.7, -12), -12, 0);
    if (!site('overlook0')) { fbAnchor('overlook0', -8.6, ground(-8.6, -6), -6, HP); fbAnchor('overlook1', -9.2, ground(-9.2, 74), 74, HP * .6); }
    if (!site('raceStart')) fbAnchor('raceStart', GT.L.backRoad.x - 2.25, 0, -60, 0);
  }
  function vendFace(drink) { return canvasTex('vend' + drink, 384, 696, (g, w, h) => { const r = GT.rng('vend' + drink); g.fillStyle = drink ? '#0f3a44' : '#3a1712'; g.fillRect(0, 0, w, h);
      const gr = g.createLinearGradient(0, 0, 0, 150); gr.addColorStop(0, drink ? '#2b8f98' : '#b0502c'); gr.addColorStop(1, drink ? '#125560' : '#6a2418'); g.fillStyle = gr; g.fillRect(0, 0, w, 150);
      g.fillStyle = '#f4ead2'; g.font = '800 54px "PingFang SC","Noto Sans SC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(drink ? '珊瑚汽水' : '海风小食', w / 2, 62); g.font = '600 20px ui-monospace,Menlo,monospace'; g.fillStyle = 'rgba(244,234,210,.8)'; g.fillText(drink ? 'CORAL POP · ICE COLD' : 'BREEZE SNACKS · 24H', w / 2, 116);
      const cols = drink ? ['#d2553a', '#d8b23c', '#3f8f6a', '#bcd0d6'] : ['#d7a531', '#8a5a2a', '#7a2a22', '#4f9a88'];
      for (let row = 0; row < 4; row++) { const y = 168 + row * 130; g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(14, y, w - 28, 118); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(14, y + 104, w - 28, 14);
        for (let i = 0; i < 6; i++) { const x = 30 + i * 56, c = cols[row]; if (drink) { g.fillStyle = c; g.fillRect(x, y + 14, 40, 88); g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(x + 5, y + 14, 6, 88); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x, y + 14, 40, 8); g.fillStyle = '#f4ead2'; g.fillRect(x + 6, y + 44, 28, 20); }
          else { g.fillStyle = c; g.beginPath(); g.moveTo(x, y + 20); g.lineTo(x + 42, y + 16); g.lineTo(x + 40, y + 100); g.lineTo(x + 2, y + 102); g.fill(); g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x + 6, y + 30, 30, 26); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + 16, 42, 7); } }
        g.fillStyle = '#ffd98a'; g.font = '600 13px ui-monospace,Menlo,monospace'; g.textAlign = 'left'; g.fillText('$' + (drink ? [2, 2, 3, 1] : [2, 1, 3, 1])[row] + '.00', 22, y + 111); }
      speckle(g, w, h, 240, () => 'rgba(0,0,0,' + (.04 + r() * .08) + ')', 1, 9, r); g.fillStyle = 'rgba(255,255,255,.05)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w * .55, 0); g.lineTo(w * .15, h); g.lineTo(0, h); g.fill(); }); }
  function chalkTex() { return canvasTex('chalk', 768, 512, (g, w, h) => { const r = GT.rng('chalk'); g.fillStyle = '#1b211e'; g.fillRect(0, 0, w, h); speckle(g, w, h, 500, () => 'rgba(255,255,255,' + (r() * .035) + ')', 4, 40, r);
      g.fillStyle = '#efe7d2'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.font = '700 58px "PingFang SC","Noto Sans SC",sans-serif'; g.fillText('落潮酒吧', w / 2, 62); g.strokeStyle = 'rgba(239,231,210,.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(90, 108); g.lineTo(w - 90, 112); g.stroke();
      g.font = '500 38px "PingFang SC","Noto Sans SC",sans-serif'; BAR_MENU.slice(0, 4).forEach((m, i) => { const y = 168 + i * 70; g.textAlign = 'left'; g.fillStyle = ['#efe7d2', '#f2c98a', '#a9dccf', '#efe7d2'][i]; g.fillText(m.label, 80, y); g.textAlign = 'right'; g.fillText('$' + m.price, w - 80, y); });
      g.textAlign = 'center'; g.font = '400 26px "PingFang SC","Noto Sans SC",sans-serif'; g.fillStyle = 'rgba(239,231,210,.75)'; g.fillText('收鱼 · 现钱 · 不赊账', w / 2, h - 46); speckle(g, w, h, 60, () => 'rgba(27,33,30,.5)', 3, 14, r); }); }
  /** chain net: 12 strands x 4 rows of line segments hanging from the rim; kick(v) makes it swing */
  function makeNet(c) { const N = 12, Rw = 5, pos = new Float32Array(N * (Rw - 1) * 4 * 3), geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    const m = new T.LineSegments(geo, new T.LineBasicMaterial({ color: C(0xcfcbc0), transparent: true, opacity: .85 })); m.frustumCulled = false; A.root.add(m);
    const net = { c, m, sw: 0, vel: 0, dx: 0, dz: 0, pinch: 0, kick(v, dx, dz) { net.vel += v; net.dx = dx || 0; net.dz = dz || 0; net.pinch = 1; },
      update(dt) { net.vel += (-net.sw * 60 - net.vel * 5) * dt; net.sw += net.vel * dt; net.pinch = max(0, net.pinch - dt * 2.2); let o = 0; const P = (i, j) => { const u = j / (Rw - 1), a = (i + (j % 2) * .5) / N * TAU, r = lerp(.2286, .13, Math.pow(u, .8)) * (1 - net.pinch * .25 * u), y = -u * .42 - abs(net.sw) * .05 * u;
          return [c[0] + cos(a) * r + net.dx * net.sw * u * .22, c[1] + y, c[2] + sin(a) * r + net.dz * net.sw * u * .22]; };
        for (let i = 0; i < N; i++) for (let j = 0; j < Rw - 1; j++) { const a = P(i, j), b = P(i, j + 1), d = P(i + (j % 2 ? 1 : -1), j + 1); pos.set(a, o); pos.set(b, o + 3); pos.set(a, o + 6); pos.set(d, o + 9); o += 12; } geo.attributes.position.needsUpdate = true; } };
    net.update(0); return net; }

  /* ================================================================== session driver */
  const ACT = {};                                                                                    // id -> { name, start(S, ctx) (false = unavailable), update(S, dt, inp) -> done, camera(S, dt), info(S), draw?(S, g, w, h), late?(S, dt), end?(S), auto?(S, vk) }
  function heroFor(ctx) { let h = ctx && ctx.hero; if (!h && A.ctl && A.ctl.hero) h = A.ctl.hero; if (h && h.group) return figure(h); return standin(); }
  function standin() { if (A.standin) return A.standin; let raw = null;
    try { if (GT.hero && GT.hero.make && A.opts.who !== 'people') raw = GT.hero.make(A.opts.who || 'kai'); } catch (e) { console.warn('activities: GT.hero.make failed', e); raw = null; }
    try { if (!raw && GT.people && GT.people.make) raw = GT.people.make('ped', { type: (GT.people.pedTypes || []).includes('local_m') ? 'local_m' : 'tourist', seed: 7, phone: false }); } catch (e) { console.warn('activities: people stand-in failed', e); }
    if (!raw) { const g = new T.Group(); raw = { group: g, bones: [], update() { } }; } const f = figure(raw); if (!f.group.parent && A.root) A.root.add(f.group); f.isStandin = true; return A.standin = f; }
  /** start an activity. ctx is the GT.act context (ctl, hero, pos, h, ...) or {} in the showcase. arg picks variants. Returns false if busy / unavailable. */
  function start(id, ctx, arg) { if (A.active || !ACT[id] || !A.inited) return false; ctx = ctx || {}; const def = ACT[id], ctl = ctx.ctl || A.ctl || null;
    const S = { id, def, t: 0, ctx, ctl, hero: heroFor(ctx), hs: 'idle', hx: {}, hp: null, lie: null, cam: null, ct: { pos: [0, 2, 0], look: [0, 1, 0], fov: 50 }, camRate: 4.5, done: false, ended: false, arg: arg || {}, rnd: GT.rng('act:' + id + ':' + (A.opts.seed || 0) + ':' + (A.runs = (A.runs || 0) + 1)), inp: null };
    if (ctl && ctl.pos) S.origin = { x: ctl.pos.x, y: ctl.pos.y, z: ctl.pos.z, h: ctl.h || 0 }; else if (ctx.pos) S.origin = { x: ctx.pos.x, y: ground(ctx.pos.x, ctx.pos.z), z: ctx.pos.z, h: ctx.h || 0 }; else { const p = S.hero.group.position; S.origin = { x: p.x, y: p.y, z: p.z, h: S.hero.group.rotation.y }; }
    S.ext = !!(ctl && ctl.takeover && !A.auto && A.opts.ownDriver !== true);
    if (def.start(S, ctx) === false) return false;
    A.active = S; hudOpen(def); bindOwn();
    if (S.ext) { const sess = { blend: .5, update(dt, input) { return step(S, dt, input); }, camera(dt) { post(S, dt === undefined ? S.dt || 0 : dt); return camOut(S); }, onEnd() { finish(S); } }; Object.defineProperty(sess, 'heroState', { enumerable: true, get() { return HSTATE[S.hs] || S.hs; } }); ctl.takeover(sess); }
    emit('start', { id }); return true; }
  function stop() { if (A.active) A.active.done = true; }
  function camOut(S) { const c = S.cam || S.ct; return { pos: [c.pos[0], c.pos[1], c.pos[2]], look: [c.look[0], c.look[1], c.look[2]], fov: c.fov }; }
  /** where the hero stands this frame (also written into the on-foot controller so its own bookkeeping follows) */
  function heroPlace(S, x, y, z, h) { S.hp = { x, y, z, h }; const c = S.ctl; if (S.ext && c && c.pos) { c.pos.x = x; c.pos.y = y; c.pos.z = z; c.h = h; } }
  function heroAnim(S, state, extra) { S.hs = state; S.hx = extra || {}; }
  const _mb = new T.Matrix4(), _vx = V3(), _vy = V3(), _vz = V3();
  function applyPose(S) { const p = S.hp, g = S.hero.group; if (!p) return; if (S.lie) { const l = S.lie; _vy.set(sin(l.h), 0, cos(l.h)); _vz.set(0, 1, 0); _vx.crossVectors(_vy, _vz); _mb.makeBasis(_vx, _vy, _vz); g.quaternion.setFromRotationMatrix(_mb); g.position.set(l.x, l.y, l.z); } else S.hero.place(p.x, p.y, p.z, p.h); }
  function step(S, dt, input) { if (S.ended) return true; S.t += dt; S.dt = dt; const inp = S.inp = A.auto ? virtInput : wrapInput(input);
    if (A.auto && S.def.auto) S.def.auto(S, virtInput);
    let done = S.done || !!S.def.update(S, dt, inp); if (!done && anyPressed(inp, K_EXIT) && !S.noEsc) { done = S.def.abort ? !!S.def.abort(S) : true; for (const c of K_EXIT) inp.consume(c); }
    if (!S.ext) post(S, dt); for (const k in VK.p) VK.p[k] = false; return done; }
  /** everything that has to happen after the hero's pose is known: transform overrides, prop tracking, camera, HUD */
  function post(S, dt) { if (S.ended) return; applyPose(S);
    if (!S.ext || S.hero.kind !== 'hero') S.hero.update(dt, S.hs, S.hx);
    S.def.camera(S, dt); const t = S.ct;
    if (!S.cam) { S.cam = { pos: t.pos.slice(), look: t.look.slice(), fov: t.fov }; if (S.ext && A.camera) { const c = A.camera; c.getWorldDirection(_v); S.cam.pos = [c.position.x, c.position.y, c.position.z]; S.cam.look = [c.position.x + _v.x * 6, c.position.y + _v.y * 6, c.position.z + _v.z * 6]; S.cam.fov = c.fov; } }
    else if (S.cut || A.cut) { S.cam.pos = t.pos.slice(); S.cam.look = t.look.slice(); S.cam.fov = t.fov; S.cut = false; }
    else { const k = 1 - Math.exp(-(S.camRate) * dt); for (let i = 0; i < 3; i++) { S.cam.pos[i] += (t.pos[i] - S.cam.pos[i]) * k; S.cam.look[i] += (t.look[i] - S.cam.look[i]) * k; } S.cam.fov += (t.fov - S.cam.fov) * k; }
    if (S.def.late) S.def.late(S, dt);
    hudInfo(S.def.info(S)); const g = HUD.g; g.clearRect(0, 0, HUD.w, HUD.h); if (S.def.draw) S.def.draw(S, g, HUD.w, HUD.h); }
  function finish(S) { if (S.ended) return; S.ended = true; S.lie = null; try { if (S.def.end) S.def.end(S); } catch (e) { console.warn(e); } if (A.active === S) A.active = null; hudClose();
    if (S.hp) { S.hero.place(S.hp.x, S.hp.y, S.hp.z, S.hp.h); S.hero.group.visible = true; } if (!S.ext || S.hero.kind !== 'hero') S.hero.update(0, 'idle', {}); emit('end', { id: S.id, result: S.result || null }); save(); }
  function applyCam(S) { const c = A.camera; if (!c || !S.cam || A.freeCam) return; c.position.set(S.cam.pos[0], S.cam.pos[1], S.cam.pos[2]); c.lookAt(S.cam.look[0], S.cam.look[1], S.cam.look[2]); if (abs(c.fov - S.cam.fov) > .01) { c.fov = S.cam.fov; c.updateProjectionMatrix(); } }
  /** over-the-shoulder framing helper: camera behind/right of p (heading h), looking toward `to` */
  function shoulder(S, p, h, to, o) { o = o || {}; const [fx, fz] = fwd(h), [rx, rz] = rgt(h), d = o.dist === undefined ? 2.9 : o.dist, s = o.side === undefined ? .75 : o.side, up = o.up === undefined ? 1.75 : o.up;
    // try "behind the shoulder" first, then swing around the hero until the view is not blocked by a registered obstacle (fences, walls)
    const hx = p.x, hz = p.z, cy = p.y + up, cand = (yo, sd) => { const hh = h + yo, f = fwd(hh), r = rgt(hh); return [p.x - f[0] * d + r[0] * sd, p.z - f[1] * d + r[1] * sd]; };
    if (!S.shC || S.shC.key !== (o.key || 0) || segHit(hx, hz, cand(S.shC.yo, S.shC.sd * s)[0], cand(S.shC.yo, S.shC.sd * s)[1], cy) < .97) { let best = null; for (const yo of [0, .55, -.55, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2]) { for (const sd of [1, -1]) { const c = cand(yo, sd * s), t = min(segHit(hx, hz, c[0], c[1], cy), .55 + .45 * segHit(c[0], c[1], to[0], to[2], cy)); if (!best || t > best.t + .02) best = { yo, sd, t }; if (t >= .97) break; } if (best.t >= .97) break; } best.key = o.key || 0; S.shC = best; }
    const Pc = cand(S.shC.yo, S.shC.sd * s), tc = max(.28, min(1, segHit(hx, hz, Pc[0], Pc[1], cy) - .07)); S.ct.pos = [lerp(hx, Pc[0], tc), cy, lerp(hz, Pc[1], tc)]; const k = o.k === undefined ? .6 : o.k, hy = p.y + (o.head || 1.5); S.ct.look = [lerp(p.x, to[0], k), lerp(hy, to[1], k), lerp(p.z, to[2], k)]; S.ct.fov = o.fov || 50; }
  /** first hit (0..1, 1 = clear) of the ground-plane segment against the registered obstacle boxes that are tall enough to block a camera at height y */
  function segHit(x0, z0, x1, z1, y) { let best = 1; const dx = x1 - x0, dz = z1 - z0, m = .22; for (const b of GT.world.boxes) { const bx0 = b.x0 - m, bx1 = b.x1 + m, bz0 = b.z0 - m, bz1 = b.z1 + m; if (x0 > bx0 && x0 < bx1 && z0 > bz0 && z0 < bz1) continue; if (y !== undefined && ground((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) + b.h < y - .15) continue;
      let t0 = 0, t1 = 1; if (abs(dx) < 1e-9) { if (x0 < bx0 || x0 > bx1) continue; } else { let a = (bx0 - x0) / dx, c = (bx1 - x0) / dx; if (a > c) { const q = a; a = c; c = q; } t0 = max(t0, a); t1 = min(t1, c); if (t0 > t1) continue; }
      if (abs(dz) < 1e-9) { if (z0 < bz0 || z0 > bz1) continue; } else { let a = (bz0 - z0) / dz, c = (bz1 - z0) / dz; if (a > c) { const q = a; a = c; c = q; } t0 = max(t0, a); t1 = min(t1, c); if (t0 > t1) continue; } if (t0 < best) best = t0; } return best; }
  /** keep the camera above the terrain and in front of obstacles between it and (fx, fz) */
  function camClear(S, fx, fz) { const p = S.ct.pos; if (fx !== undefined) { const t = segHit(fx, fz, p[0], p[2], p[1]); if (t < .97) { const k = max(.3, t - .07); p[0] = lerp(fx, p[0], k); p[2] = lerp(fz, p[2], k); } } const gy = ground(p[0], p[2]) + .35; if (p[1] < gy) p[1] = gy; }

  /* ================================================================== 1. basketball shoot-around */
  const BALL_R = .12, RIM_R = .2286, GRAV = 9.81;
  const HOOP = { ball: null, shadow: null };
  function ballTex() { return canvasTex('ball', 512, 256, (g, w, h) => { const r = GT.rng('ball'); g.fillStyle = '#b5561f'; g.fillRect(0, 0, w, h); for (let i = 0; i < 5200; i++) { g.fillStyle = r() < .5 ? 'rgba(70,28,8,.22)' : 'rgba(235,150,90,.14)'; g.fillRect(r() * w, r() * h, 1.6, 1.6); }
      speckle(g, w, h, 40, () => 'rgba(60,40,30,' + (.05 + r() * .1) + ')', 8, 34, r); g.strokeStyle = '#1a120d'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      for (const x of [0, w / 2, w]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (const x of [w / 4, w * 3 / 4]) { g.beginPath(); g.ellipse(x, h / 2, w * .095, h * .46, 0, 0, TAU); g.stroke(); } }); }
  function makeBall() { if (HOOP.ball) return HOOP.ball; const hb = GT.hangouts && GT.hangouts.props && GT.hangouts.props.ball; if (hb && hb.isObject3D) { HOOP.rest = hb.position.clone(); HOOP.borrowed = true; return HOOP.ball = hb; } const m = new T.Mesh(new T.SphereGeometry(BALL_R, 28, 18), stdMat('ball', { map: ballTex(), roughness: .82, metalness: 0, bumpMap: ballTex(), bumpScale: .0015 })); m.castShadow = true; m.receiveShadow = true; m.visible = false; A.root.add(m); return HOOP.ball = m; }
  function hoopGeom() { const a = site('hoop'); if (!a) return null; const sp = []; for (let i = 1; i <= 5; i++) { const s = site('courtShot' + i); if (s) sp.push(s); }
    const an = rawAnchor('hoop'); let floorY = an.floorY; if (floorY === undefined && sp.length && rawAnchor('courtShot1').y !== undefined) floorY = sp[0].y; let rimY = an.y !== undefined ? (an.y > 2 ? an.y : an.y + 3.05) : (floorY !== undefined ? floorY + 3.05 : 1.0 + 3.05); if (floorY === undefined) floorY = rimY - 3.05;
    let h = an.h; if (h === undefined) { let cx = 0, cz = 0; for (const s of sp) { cx += s.x; cz += s.z; } h = sp.length ? Math.atan2(cx / sp.length - a.x, cz / sp.length - a.z) : 0; }
    if (!sp.length) { const [fx, fz] = fwd(h), [rx, rz] = rgt(h); for (const [ang, d] of [[-70, 5], [-36, 5.3], [0, 4.6], [36, 5.3], [70, 5]]) { const q = ang * PI / 180; sp.push({ x: a.x + rx * sin(q) * d + fx * cos(q) * d, y: floorY, z: a.z + rz * sin(q) * d + fz * cos(q) * d }); } }
    return { boardOff: an.boardZ !== undefined ? cl(abs(an.boardZ - a.z), .2, .6) : .375, rim: V3(a.x, rimY, a.z), h, f: fwd(h), r: rgt(h), floorY, spots: sp.map(s => ({ x: s.x, y: floorY, z: s.z, h: Math.atan2(a.x - s.x, a.z - s.z) })) }; }
  /** launch velocity that drops the ball through the rim centre from p with apex angle `ang` */
  function solveShot(p, rim, ang) { const dx = rim.x - p.x, dz = rim.z - p.z, d = Math.hypot(dx, dz), dy = rim.y - p.y, c = cos(ang), tn = Math.tan(ang), den = 2 * c * c * (d * tn - dy); const v = Math.sqrt(GRAV * d * d / max(.01, den)); return V3(dx / d * v * c, v * sin(ang), dz / d * v * c); }
  const HOOP_LINES = { swish: ['空心！', '网都没怎么动。', '干净。'], rim: ['蹭进去了。', '筐给面子。'], bank: ['打板，算数。', '板子是你朋友。'], miss: ['偏了。', '筐不认识你。', '再来。', '短了一点。'], streak: ['手热了。', '别停。', '今天是你的。'] };
  ACT.hoops = { name: '投篮 · 沙滩半场',
    start(S, ctx) { const G0 = hoopGeom(); if (!G0) return false; S.G = G0; S.ball = makeBall(); S.ball.visible = true; S.spot = S.arg.spot !== undefined ? S.arg.spot : nearestIdx(G0.spots, S.origin); S.ph = 'hold'; S.pt = 0; S.meter = 0; S.md = 1; S.b = { p: V3(), v: V3(), spin: V3(), live: false };
      S.made = 0; S.shots = 0; S.streak = 0; S.ch = null; S.log = []; S.jump = 0; S.walk = null; S.locals = castLocals(); const s = G0.spots[S.spot]; heroPlace(S, s.x, s.y, s.z, s.h); heroAnim(S, 'idle'); S.sweet = .74; S.trail = [];
      if (S.arg.challenge) hoopChallenge(S); },
    update(S, dt, inp) { const G0 = S.G, s = G0.spots[S.spot], b = S.b; S.pt += dt;
      if (S.ph === 'hold' || S.ph === 'charge') { const d = Math.hypot(G0.rim.x - s.x, G0.rim.z - s.z); S.half = cl(.15 - (d - 4.6) * .018 + min(S.streak, 4) * .008 - (S.ch ? .012 : 0), .085, .17);
        if (S.ph === 'hold') { heroAnim(S, 'jumpshot', { phase: .08 }); if (inp.pressed('Space') || inp.down('Space') && S.pt > .25) { S.ph = 'charge'; S.pt = 0; S.meter = 0; S.md = 1; }
          else if (!S.walk && anyPressed(inp, K_L)) hoopMove(S, -1); else if (!S.walk && anyPressed(inp, K_R)) hoopMove(S, 1); else if (!S.ch && anyPressed(inp, K_OK)) hoopChallenge(S); }
        else { S.meter += S.md * dt / .82; if (S.meter >= 1) { S.meter = 1; S.md = -1; } if (S.meter <= 0 && S.md < 0) { S.ph = 'hold'; S.pt = 0; S.meter = 0; }
          heroAnim(S, 'jumpshot', { phase: .1 + .45 * S.meter }); if ((S.pt % .11) < dt) snd('tick', { g: .4 + S.meter * .5 }); if (!inp.down('Space')) hoopRelease(S); }
        if (S.ph === 'release') { /* the ball has just left */ } else if (S.walk) hoopWalk(S, dt); else { S.hero.world('handR', _v); const hl = S.hero.world('handL', _v2); b.p.copy(_v).lerp(hl, .5).addScaledVector(V3(sin(s.h), 0, cos(s.h)), .1); b.p.y += .06; if (!S.hero.bone('handR')) b.p.set(s.x + sin(s.h) * .3, s.y + 1.3, s.z + cos(s.h) * .3); } }
      else if (S.ph === 'release') { const k = cl(S.pt / .16, 0, 1); S.jump = sin(cl(S.pt / .55, 0, 1) * PI) * .34; if (S.pt < .8) heroAnim(S, 'jumpshot', { phase: .55 + .45 * k }); else heroAnim(S, 'idle'); heroPlace(S, s.x, s.y + S.jump, s.z, s.h); if (S.pt > .62) { S.jump = 0; heroPlace(S, s.x, s.y, s.z, s.h); } if (!b.live) { S.ph = 'back'; S.pt = 0; } }
      else if (S.ph === 'back') { heroAnim(S, S.lastMade && S.pt < 1 ? 'cheer' : 'idle'); const tgt = _v.set(s.x + sin(s.h) * .35, s.y + 1.15, s.z + cos(s.h) * .35), k = cl(S.pt / .8, 0, 1); if (S.pt === dt) S.from = b.p.clone();
        b.p.lerpVectors(S.from || b.p, tgt, ss(k, 0, 1)); b.p.y += sin(k * PI) * .9 * (1 - k * .3) + (k < .98 ? abs(sin(k * 9)) * .08 : 0); S.ball.rotation.x -= dt * 9;
        if (k >= 1) { S.ph = 'hold'; S.pt = 0; snd('bounce', { g: .25 }); if (S.ch && S.ch.n >= 10) hoopChallengeEnd(S); else if (S.ch) { const ns = (S.ch.n >> 1) % G0.spots.length; if (ns !== S.spot) hoopGoto(S, ns); } } }
      if (b.live) hoopPhysics(S, dt); S.ball.position.copy(b.p);
      if (STAND.net) STAND.net.update(dt); for (const f of S.locals) { f.cheerT = max(0, (f.cheerT || 0) - dt); f.want = f.cheerT > 0 ? 'cheer' : (f.seed % 2 ? 'talk' : 'idle'); }
      return false; },
    camera(S, dt) { const G0 = S.G, s = S.hp || G0.spots[S.spot], b = S.b, fly = b.live ? 1 : 0; S.cf = ease(S.cf || 0, fly, 5, dt); const to = [lerp(G0.rim.x, b.p.x, S.cf * .45), lerp(G0.rim.y - .3, b.p.y, S.cf * .45), lerp(G0.rim.z, b.p.z, S.cf * .45)];
      shoulder(S, { x: s.x, y: G0.floorY, z: s.z }, G0.spots[S.spot].h, to, { dist: 3.5, side: 1.3, up: 2.0, k: .56, fov: 47, key: S.spot }); camClear(S); },
    info(S) { const st = [['命中', S.made + '/' + S.shots], ['连中', '×' + S.streak, S.streak >= 3], ['最佳', '×' + ST.hoops.bestStreak]]; if (S.ch) st.push(['挑战', S.ch.made + '/' + S.ch.n + ' · 目标 6', true]);
      return { sub: S.ch ? '街坊局 · 十投六中赢 ' + money(60) : '位置 ' + (S.spot + 1) + '/' + S.G.spots.length + ' · 随便投', stats: st, keys: [['Space', '按住蓄力 · 松开出手'], ['A/D', '换位置', !!S.ch], ['E', S.ch ? '挑战进行中' : '接街坊局 · 押 ' + money(20), !!S.ch], ['Esc', '离开']] }; },
    draw(S, g, w, h) { const x = 30, bw = w - 60, y = 40; G.panel(g, 0, 8, w, 72); G.label(g, '出手时机', x, 24); G.label(g, S.ph === 'charge' ? '松开！' : S.ph === 'hold' ? '按住 Space' : '', w - x, 24, { align: 'right', c: '#ffb454' });
      g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x, y, bw, 12); const sw = S.sweet, hf = S.half || .12; g.fillStyle = 'rgba(255,180,84,.3)'; g.fillRect(x + bw * (sw - hf), y, bw * hf * 2, 12); g.fillStyle = '#ffb454'; g.fillRect(x + bw * (sw - hf * .33), y, bw * hf * .66, 12);
      const m = S.ph === 'charge' ? S.meter : (S.lastMeter || 0); g.fillStyle = S.ph === 'charge' ? '#f1ede4' : 'rgba(241,237,228,.45)'; g.fillRect(x + bw * m - 1.5, y - 5, 3, 22); g.fillStyle = 'rgba(241,237,228,.22)'; g.fillRect(x, y + 3, bw * m, 6);
      const n = S.ch ? 10 : min(10, max(5, S.log.length)), lg = S.ch ? S.ch.log : S.log.slice(-10); G.pips(g, x, 68, n, i => lg[i] === undefined ? 0 : lg[i] ? 1 : 2, { s: 6, gap: 5 }); G.label(g, S.lastLabel || '', w - x, 68, { align: 'right' }); },
    end(S) { if (HOOP.borrowed) { S.ball.position.copy(HOOP.rest); S.ball.rotation.set(0, 0, 0); } else S.ball.visible = false; if (S.ch && S.ch.n < 10) toast('街坊局', '半路走人，押金不退。'); for (const f of S.locals) f.want = f.seed % 2 ? 'talk' : 'idle'; heroPlace(S, S.hp.x, S.G.floorY, S.hp.z, S.hp.h); S.result = { made: S.made, shots: S.shots }; },
    auto(S, vk) { const plan = S.arg.plan || [.74, .75, .9, .73, .58, .74, .76, .74]; if (S.ph === 'hold' && !S.walk) { if (S.pt > .7) vk.hold('Space', true); } else if (S.ph === 'charge') { const tg = plan[S.shots % plan.length]; if (S.meter >= tg && S.md > 0) vk.hold('Space', false); } else vk.hold('Space', false); }
  };
  const nearestIdx = (list, p) => { let bi = 0, bd = 1e9; list.forEach((s, i) => { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; bi = i; } }); return bi; };
  function hoopMove(S, dir) { if (S.ch) return; const n = S.G.spots.length, ns = cl(S.spot + dir, 0, n - 1); if (ns !== S.spot) hoopGoto(S, ns); }
  function hoopGoto(S, ns) { const a = S.G.spots[S.spot], b = S.G.spots[ns]; S.walk = { a, b, t: 0, d: Math.hypot(b.x - a.x, b.z - a.z), to: ns }; snd('ui_tick'); }
  function hoopWalk(S, dt) { const wk = S.walk; wk.t += dt * 3.4 / max(.5, wk.d); const k = cl(wk.t, 0, 1), x = lerp(wk.a.x, wk.b.x, k), z = lerp(wk.a.z, wk.b.z, k), hh = k > .85 ? wk.b.h : Math.atan2(wk.b.x - wk.a.x, wk.b.z - wk.a.z); heroPlace(S, x, wk.a.y, z, hh); heroAnim(S, 'run', { speed: 3.4 });
    S.b.p.set(x + sin(hh) * .35, wk.a.y + .55 + abs(sin(wk.t * wk.d * 2.2)) * .55, z + cos(hh) * .35); if (k >= 1) { S.spot = wk.to; S.walk = null; heroPlace(S, wk.b.x, wk.b.y, wk.b.z, wk.b.h); S.pt = 0; } }
  function hoopChallenge(S) { if (!W.spend(20)) { hudMsg('钱不够', '街坊局押 ' + money(20), 'bad'); snd('ui_bad'); return; } S.ch = { n: 0, made: 0, log: [] }; ST.hoops.challengeTries++; snd('ui_ok'); say('街坊', '十个球，进六个，这六十块就是你的。'); if (S.spot !== 0) hoopGoto(S, 0); emit('hoops', { type: 'challenge-start' }); }
  function hoopChallengeEnd(S) { const win = S.ch.made >= 6; if (win) { W.add(60, 'hoops'); ST.hoops.challengeWins++; hudMsg('街坊局 · 赢了', S.ch.made + '/10 · +' + money(60), 'good', 3); snd('cash'); say('街坊', '行，服了。钱拿走。'); for (const f of S.locals) f.cheerT = 2.5; }
    else { hudMsg('街坊局 · 没过', S.ch.made + '/10 · 押金归他们', 'bad', 3); snd('ui_bad'); say('街坊', '差得远呢，回去练练。'); } emit('hoops', { type: 'challenge-end', win, made: S.ch.made }); S.ch = null; }
  function hoopRelease(S) { const G0 = S.G, b = S.b, s = G0.spots[S.spot]; S.lastMeter = S.meter; const e = (S.meter - S.sweet) / S.half, ae = abs(e);
    S.hero.world('handR', _v); if (!S.hero.bone('handR')) _v.set(s.x, s.y + 2.0, s.z); const p0 = V3(_v.x, max(_v.y, s.y + 1.95) + .25, _v.z).addScaledVector(V3(sin(s.h), 0, cos(s.h)), .22);
    const v = solveShot(p0, G0.rim, 52 * PI / 180 + (S.rnd() - .5) * .03); let sp = 1, lat = 0;
    if (ae > .33) { const over = (ae - .33); sp += Math.sign(e) * (.012 + over * .04); lat = (S.rnd() - .5) * .05 * min(2, over * 1.6); } else { sp += e * .012; lat = (S.rnd() - .5) * .006; }
    v.multiplyScalar(sp); const cs = cos(lat), sn = sin(lat), vx = v.x * cs - v.z * sn, vz = v.x * sn + v.z * cs; v.x = vx; v.z = vz;
    b.p.copy(p0); b.v.copy(v); b.live = true; b.t = 0; b.hit = { rim: 0, board: 0, floor: 0 }; b.scored = false; b.below = false; S.quality = ae < .33 ? 'perfect' : ae < 1 ? 'ok' : (e < 0 ? 'short' : 'long'); S.ph = 'release'; S.pt = 0; S.shots++; ST.hoops.shots++; snd('whoosh', { g: .5 }); emit('hoops', { type: 'shot', quality: S.quality }); }
  function hoopPhysics(S, dt) { const G0 = S.G, b = S.b, rim = G0.rim, steps = 4, h = dt / steps;
    for (let i = 0; i < steps && b.live; i++) { b.t += h; b.v.y -= GRAV * h; b.v.multiplyScalar(1 - .02 * h); const py = b.p.y; b.p.addScaledVector(b.v, h);
      // rim: nearest point on the ring circle
      const dx = b.p.x - rim.x, dz = b.p.z - rim.z, dr = Math.hypot(dx, dz) || 1e-6, qx = rim.x + dx / dr * RIM_R, qz = rim.z + dz / dr * RIM_R; _v.set(b.p.x - qx, b.p.y - rim.y, b.p.z - qz); const dist = _v.length();
      if (dist < BALL_R + .012 && !b.scored) { _v.normalize(); const vn = b.v.dot(_v); if (vn < 0) { b.v.addScaledVector(_v, -(1 + .52) * vn); b.v.multiplyScalar(.93); b.p.addScaledVector(_v, BALL_R + .012 - dist); if (b.hit.rim++ < 4) snd('rim', { g: cl(-vn / 4, .25, 1) }); if (STAND.net) STAND.net.kick(.6, dx / dr, dz / dr); } }
      // backboard: plane at rim - f * .375, facing f
      const fx = G0.f[0], fz = G0.f[1], bd = (b.p.x - rim.x) * fx + (b.p.z - rim.z) * fz + G0.boardOff, ba = (b.p.x - rim.x) * G0.r[0] + (b.p.z - rim.z) * G0.r[1], by = b.p.y - rim.y;
      if (bd < BALL_R && bd > -.2 && abs(ba) < .92 && by > -.18 && by < .92) { const vn = b.v.x * fx + b.v.z * fz; if (vn < 0) { b.v.x -= (1 + .68) * vn * fx; b.v.z -= (1 + .68) * vn * fz; b.p.x += fx * (BALL_R - bd); b.p.z += fz * (BALL_R - bd); b.hit.board++; snd('board', { g: cl(-vn / 5, .3, 1) }); } }
      // score: centre passes down through the rim plane inside the ring
      if (!b.scored && py >= rim.y && b.p.y < rim.y && b.v.y < 0 && dr < RIM_R - .035) { b.scored = true; hoopScore(S); b.v.x *= .45; b.v.z *= .45; b.v.y *= .8; }
      if (b.scored && b.p.y < rim.y && b.p.y > rim.y - .42) { const k = cl(dr / .14, 0, 3); if (k > 1) { b.p.x = rim.x + dx / dr * .14; b.p.z = rim.z + dz / dr * .14; } }
      if (!b.scored && !b.below && b.p.y < rim.y - .5 && b.v.y < 0) { b.below = true; hoopMiss(S); }
      // floor
      if (b.p.y < G0.floorY + BALL_R) { b.p.y = G0.floorY + BALL_R; if (b.v.y < 0) { const vy = -b.v.y; b.v.y = vy * .72; b.v.x *= .82; b.v.z *= .82; if (vy > .6) snd('bounce', { g: cl(vy / 6, .15, 1) }); b.hit.floor++; if (!b.scored && !b.below) { b.below = true; hoopMiss(S); } } }
      if (b.hit.floor >= 2 || b.t > 4.5) b.live = false; }
    S.ball.rotation.x -= dt * 7; S.ball.rotation.z += dt * 1.3; }
  function hoopScore(S) { const b = S.b, kind = b.hit.board ? 'bank' : b.hit.rim ? 'rim' : 'swish'; S.made++; S.streak++; ST.hoops.made++; ST.hoops.streak = S.streak; ST.hoops.bestStreak = max(ST.hoops.bestStreak, S.streak); S.log.push(1); S.lastMade = true; if (S.ch) { S.ch.n++; S.ch.made++; S.ch.log.push(1); }
    snd('swish', { g: kind === 'swish' ? 1 : .7 }); if (STAND.net) STAND.net.kick(kind === 'swish' ? 2.2 : 1.4, 0, 0); if (GT.hangouts && GT.hangouts.netKick) { try { GT.hangouts.netKick(kind === 'swish' ? 1 : .6); } catch (e) { /* */ } }
    const L = HOOP_LINES[kind]; S.lastLabel = { swish: '空心', rim: '蹭筐进', bank: '打板进' }[kind]; hudMsg({ swish: '空心入网', rim: '蹭筐进了', bank: '打板命中' }[kind], S.streak >= 3 ? '连中 ×' + S.streak + ' · ' + HOOP_LINES.streak[S.streak % 3] : L[(S.shots + S.made) % L.length], 'good');
    for (const f of S.locals) f.cheerT = S.streak >= 3 ? 1.8 : (f.seed % 2 ? 1.1 : 0); if (S.streak === 3 || S.streak === 6) snd('crowd', { g: .5, d: 1 }); emit('hoops', { type: 'made', kind, streak: S.streak }); }
  function hoopMiss(S) { const b = S.b, kind = b.hit.rim ? 'rim-out' : b.hit.board ? 'brick' : 'airball'; if (S.streak >= 3) emit('hoops', { type: 'streak-end', streak: S.streak }); S.streak = 0; ST.hoops.streak = 0; S.log.push(0); S.lastMade = false; if (S.ch) { S.ch.n++; S.ch.log.push(0); }
    S.lastLabel = { 'rim-out': '涮筐而出', brick: '砸板', airball: S.quality === 'long' ? '大了' : '三不沾' }[kind]; const L = HOOP_LINES.miss; hudMsg(S.lastLabel, L[S.shots % L.length], 'bad', 1.3); emit('hoops', { type: 'miss', kind }); }
  function castLocals() { if (A.cast.locals) return A.cast.locals; const out = [], c = A.fb.courtLocals || (site('courtLocals') || null), G0 = hoopGeom(); if (A.opts.cast === false || !G0) return A.cast.locals = out;
    const base = c || { x: G0.rim.x + G0.r[0] * 4.6 + G0.f[0] * 6.4, y: G0.floorY, z: G0.rim.z + G0.r[1] * 4.6 + G0.f[1] * 6.4 };
    [[['baller', 'jogger'], 11, 0, 0], [['baller', 'skater'], 14, .8, .5], [['local_f', 'beach_f', 'tourist'], 21, -.3, 1.1]].forEach(([tp, sd, ox, oz], i) => { const x = base.x + ox, z = base.z + oz, f = npc(tp, sd, x, base.y, z, Math.atan2(G0.rim.x - x, G0.rim.z - z) + (i - 1) * .5); if (f) out.push(f); }); return A.cast.locals = out; }

  /* ================================================================== 2. weights */
  const GYM = { bars: {} };
  function makeBarbell(kind) { if (GYM.bars[kind]) return GYM.bars[kind]; const k = GT.kit(), len = kind === 'bench' ? 1.9 : 1.35, pr = kind === 'bench' ? [.2, .2, .15] : [.15, .11];
    k.cyl('chrome', .0135, .0135, len, 0, 0, 0, { seg: 12, rz: HP }); for (const s of [-1, 1]) { const x0 = s * (len / 2 - .36); k.cyl('chrome', .024, .024, .34, s * (len / 2 - .17), 0, 0, { seg: 12, rz: HP }); k.cyl('chrome', .035, .035, .02, x0 + s * .0, 0, 0, { seg: 12, rz: HP });
      pr.forEach((r, i) => { const x = x0 + s * (.035 + i * .042); k.cyl(GT.mat('rubber', { color: i === 0 ? 0x16171a : 0x1d1e21, rough: .8 }), r, r, .036, x, 0, 0, { seg: 26, rz: HP }); k.cyl('metal_galv', r * .34, r * .34, .04, x, 0, 0, { seg: 12, rz: HP }); const tg = new T.TorusGeometry(r * .78, .004, 4, 22); tg.rotateY(HP); k.geo('metal_galv', tg, { x: x + s * .019 }); });
      k.cyl('metal_galv', .03, .03, .035, x0 + s * (.05 + pr.length * .042), 0, 0, { seg: 10, rz: HP }); }
    for (const s of [-1, 1]) k.cyl(GT.mat('metal_dark', { rough: .85 }), .0142, .0142, .22, s * .3, 0, 0, { seg: 10, rz: HP });
    const g = k.build(); g.name = 'barbell_' + kind; A.root.add(g); return GYM.bars[kind] = g; }
  function restBarbell(kind) { const b = makeBarbell(kind), r = site(kind === 'bench' ? 'gymBenchRack' : 'gymCurlRack'), a = site(kind === 'bench' ? 'gymBench' : 'gymCurl'); if (!a) { b.visible = false; return; }
    if (r) { b.position.set(r.x, r.y, r.z); b.rotation.set(0, r.h, 0); b.visible = true; } else { const [fx, fz] = fwd(a.h); b.position.set(a.x + fx * .45, a.y + .12 + (kind === 'bench' ? .08 : 0), a.z + fz * .45); b.rotation.set(0, a.h, 0); b.visible = false; } }
  const LIFT_LINES = { good: ['肩膀记住这个重量了。', '汗滴进沙子里，值。', '明天胳膊会找你算账。', '节奏稳，像打拍子。'], bad: ['杠铃赢了这一局。', '砸下来之前先放回去。', '手抖成这样，歇会儿吧。'], full: ['今天练够了，再练就是伤。'] };
  ACT.weights = { name: '撸铁 · 海边健身角',
    start(S) { const v = S.variant = S.arg.variant || S.variant || 'bench', a = site(v === 'bench' ? 'gymBench' : 'gymCurl'); if (!a) return false; S.a = a; const raw = a.a || {}, hp = GT.hangouts && GT.hangouts.props;
      S.reps = 0; S.need = v === 'bench' ? 8 : 10; S.beat = .66; S.bt = -1.6; S.idx = 0; S.fat = 0; S.miss = 0; S.p = 0; S.pT = 0; S.judge = []; S.ph = 'set'; S.shake = 0; S.qual = 0; S.hitFx = 0; S.lastRes = null; S.autoIdx = -1; S.lastBeat = null;
      if (!S.bar && !S.dbs) { if (v === 'bench') { S.bar = (a.real && hp && hp.barbell) || makeBarbell('bench'); S.barRest = S.bar === (hp && hp.barbell) ? { p: S.bar.position.clone(), q: S.bar.quaternion.clone() } : null; }
        else if (a.real && hp && hp.dumbbells && hp.dumbbells.length >= 2) { S.dbs = hp.dumbbells.slice(0, 2); S.dbRest = S.dbs.map(d => ({ p: d.position.clone(), q: d.quaternion.clone() })); } else S.bar = makeBarbell('curl'); if (S.bar) S.bar.visible = true; }
      if (v === 'bench' && raw.head) { const hd = Math.atan2(raw.head.x - a.x, raw.head.z - a.z), H = S.hero.height || 1.78; S.lie = { h: hd, x: raw.head.x - sin(hd) * (H * .9), y: a.y + .115, z: raw.head.z - cos(hd) * (H * .9) }; S.y = a.y; S.face = hd; S.floorY = a.y - .5; heroPlace(S, a.x, a.y, a.z, hd); }
      else { const seat = a.seat !== undefined ? a.seat : a.y + .5; S.y = v === 'bench' ? seat - .5 : a.y; S.face = a.h; S.floorY = a.y; heroPlace(S, a.x, S.y, a.z, a.h); }
      heroAnim(S, 'lift', { variant: v, phase: 0, lie: !!S.lie }); },
    update(S, dt, inp) { const v = S.variant; S.win = lerp(.17, .075, cl(S.fat, 0, 1)); S.hitFx = max(0, S.hitFx - dt * 3); S.shake = ease(S.shake, S.fat * .8 + (S.ph === 'fail' ? 1 : 0), 4, dt);
      if (S.ph === 'set') { S.bt += dt; const want = S.idx % 2 === 0 ? 'KeyA' : 'KeyD', other = S.idx % 2 === 0 ? 'KeyD' : 'KeyA', due = S.idx * S.beat, err = S.bt - due;
        if (S.lastBeat !== Math.floor(S.bt / S.beat) && S.bt > -S.beat * 2.01) { S.lastBeat = Math.floor(S.bt / S.beat); snd('beat', { g: .5, f: (S.lastBeat & 1) ? 520 : 700 }); }
        let res = null; if (inp.pressed(want) || inp.pressed(want === 'KeyA' ? 'ArrowLeft' : 'ArrowRight')) { if (abs(err) <= S.win) res = abs(err) < S.win * .45 ? 'perfect' : 'good'; else if (err < -S.win && err > -S.beat * .6) res = 'early'; } else if (inp.pressed(other) && abs(err) < S.beat * .5) res = 'wrong'; if (!res && err > S.win) res = 'late';
        if (res) { const ok = res === 'perfect' || res === 'good'; S.judge.push(ok ? (res === 'perfect' ? 2 : 1) : 0); S.lastRes = res; S.hitFx = 1; S.hitOk = ok;
          if (ok) { S.pT = S.idx % 2 === 0 ? 1 : 0; S.qual += res === 'perfect' ? 1 : .6; if (S.idx % 2 === 1) { S.reps++; ST.lifts.reps++; snd('plate', { g: .6 }); } S.fat += .028 + S.reps * .004; } else { S.miss++; S.fat += .1; snd('ui_bad', { g: .5 }); }
          S.idx++; if (!ok && res !== 'late' && res !== 'wrong') { /* an early press burns the beat */ }
          if (S.miss >= 4) { S.ph = 'fail'; S.pt = 0; S.pT = 0; ST.lifts.failed++; snd('slam', { g: .7 }); const L = LIFT_LINES.bad; hudMsg('这组废了', L[ST.lifts.failed % L.length], 'bad', 2.6); }
          else if (S.reps >= S.need && S.idx % 2 === 0) { S.ph = 'done'; S.pt = 0; liftDone(S); } } }
      else { S.pt += dt; S.pT = 0; if (S.pt > 2.4 && S.ph !== 'out') { if (S.ph === 'done' && A.auto !== true && S.wantMore) { /* */ } S.ph = 'out'; } if (S.ph === 'out') { if (anyPressed(inp, K_GO) || anyPressed(inp, K_OK)) { ACT.weights.start(S); return false; } if (S.pt > 6 && !A.auto) return true; } }
      S.p = ease(S.p, S.pT, S.pT > S.p ? 9 - S.fat * 4 : 6, dt); heroAnim(S, 'lift', { variant: v, phase: S.p, shake: S.shake, lie: !!S.lie }); return false; },
    late(S) { const hl = S.hero.world('handL', _v), hr = S.hero.world('handR', _v2), b = S.bar, has = !!S.hero.bone('handL'), [fx, fz] = fwd(S.face), sh = sin(S.t * 31) * S.shake * .006;
      if (S.dbs) { S.dbs.forEach((d, i) => { const hnd = i ? hr : hl; if (!has) hnd.set(S.a.x + fx * .3 + (i ? -.2 : .2) * fz, S.y + 1 + S.p * .4, S.a.z + fz * .3); d.position.copy(hnd); d.position.y += sh; d.rotation.set(0, S.face + HP, 0); }); return; }
      if (!has) { b.position.set(S.a.x + fx * .3, S.y + 1 + S.p * .5, S.a.z + fz * .3); b.rotation.set(0, S.face, 0); return; }
      const mid = V3().addVectors(hl, hr).multiplyScalar(.5), d = V3().subVectors(hl, hr); if (S.lie) d.y = 0; else d.y *= .4; if (d.lengthSq() < 1e-6) d.set(1, 0, 0); d.normalize(); mid.y += S.variant === 'bench' ? .04 : 0; mid.x += sh; b.position.copy(mid); b.quaternion.setFromUnitVectors(_vx.set(1, 0, 0), d); },
    camera(S) { const a = S.a; if (S.lie) { const [fx, fz] = fwd(S.face), [rx, rz] = rgt(S.face); S.ct.pos = [a.x - fx * 2.5 + rx * 1.9, S.floorY + 1.5, a.z - fz * 2.5 + rz * 1.9]; S.ct.look = [a.x + fx * .15, a.y + .32, a.z + fz * .15]; S.ct.fov = 44; camClear(S, a.x, a.z); return; }
      const [fx, fz] = fwd(a.h), [rx, rz] = rgt(a.h); S.ct.pos = [a.x - fx * 2.35 + rx * 1.75, a.y + 1.55, a.z - fz * 2.35 + rz * 1.75]; S.ct.look = [a.x + fx * .5, a.y + (S.variant === 'bench' ? 1.18 : 1.15), a.z + fz * .5]; S.ct.fov = 46; camClear(S, a.x, a.z); },
    info(S) { return { sub: (S.variant === 'bench' ? (S.lie ? '卧推' : '坐姿推举') : (S.dbs ? '哑铃弯举' : '杠铃弯举')) + ' · 跟着拍子 A、D 交替', stats: [['次数', S.reps + '/' + S.need], ['体格', ST.physique.toFixed(1), S.ph === 'done'], ['失误', S.miss + '/4', S.miss >= 3]], keys: S.ph === 'set' ? [['A', '发力'], ['D', '回放'], ['Esc', '放下走人']] : [['Space', '再来一组'], ['Esc', '离开']] }; },
    draw(S, g, w, h) { G.panel(g, 0, 8, w, 80); const cx = w / 2, y = 46, pps = 150; G.label(g, '节奏', 30, 22); G.label(g, S.lastRes ? { perfect: '完美', good: '不错', early: '早了', late: '晚了', wrong: '按反了' }[S.lastRes] : '', w - 30, 22, { align: 'right', c: S.hitOk ? '#ffb454' : '#ff8f7c' });
      g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(30, y - 1, w - 60, 2); const ww = S.win * pps; g.fillStyle = 'rgba(255,180,84,' + (.22 + S.hitFx * .3) + ')'; g.fillRect(cx - ww, y - 15, ww * 2, 30); g.fillStyle = '#ffb454'; g.fillRect(cx - 1, y - 19, 2, 38);
      if (S.ph === 'set') for (let i = S.idx; i < S.idx + 7; i++) { const x = cx + (i * S.beat - S.bt) * pps; if (x > w - 34 || x < 34 || i >= S.need * 2) continue; const up = i % 2 === 0; g.fillStyle = up ? '#f1ede4' : 'rgba(241,237,228,.55)'; g.beginPath(); g.arc(x, y, 12, 0, TAU); g.fill(); g.fillStyle = '#14161a'; g.font = '700 12px ui-monospace,Menlo,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(up ? 'A' : 'D', x, y + .5); }
      G.label(g, '乏力', 30, 76); G.bar(g, 66, 73, 120, 5, S.fat, S.fat > .7 ? '#ff8f7c' : '#9fe8dc'); G.pips(g, w - 30 - S.need * 11, 76, S.need, S.reps, { s: 6, gap: 5 }); },
    end(S) { if (S.barRest) { S.bar.position.copy(S.barRest.p); S.bar.quaternion.copy(S.barRest.q); } else if (S.bar) restBarbell(S.variant); if (S.dbs) S.dbs.forEach((d, i) => { d.position.copy(S.dbRest[i].p); d.quaternion.copy(S.dbRest[i].q); }); const st = S.a.a && S.a.a.stand; if (st) heroPlace(S, st.x, ground(st.x, st.z), st.z, st.h || 0); else heroPlace(S, S.a.x, S.a.y, S.a.z, S.a.h); S.result = { reps: S.reps, physique: ST.physique }; },
    auto(S, vk) { if (S.ph !== 'set') return; const due = S.idx * S.beat, off = (S.arg.sloppy && S.idx > 5) ? .2 : .01 * ((S.idx * 7) % 3 - 1); if (S.bt >= due + off && S.autoIdx !== S.idx) { S.autoIdx = S.idx; vk.tap(S.idx % 2 === 0 ? 'KeyA' : 'KeyD'); } }
  };
  function liftDone(S) { const today = ST.lifts.sets, q = cl(S.qual / (S.need * 2), .3, 1), gain = today >= 5 ? 0 : +(0.6 * q * (1 - today * .15) * (1 - ST.physique / 140)).toFixed(2); ST.lifts.sets++; ST.physique = cl(ST.physique + gain, 0, 100); snd('ui_ok'); snd('plate', { g: 1 });
    const L = gain > 0 ? LIFT_LINES.good : LIFT_LINES.full; hudMsg('一组完成', (gain > 0 ? '体格 +' + gain.toFixed(2) + ' · ' : '') + L[ST.lifts.sets % L.length], 'good', 2.6); ST.focus = cl(ST.focus - .08, 0, 1); emit('weights', { type: 'set', reps: S.reps, gain, physique: ST.physique }); save(); }

  /* ================================================================== 3. fishing */
  const FISH = [
    { id: 'jack', name: '码头小鲹', kg: [.2, .9], w: 34, price: 6, col: 0x9fb0b4, belly: 0xe6e2d4, fight: .35 },
    { id: 'bream', name: '落日鲷', kg: [.4, 1.8], w: 30, price: 9, col: 0xc9764a, belly: 0xf0d2b0, fight: .5 },
    { id: 'needle', name: '霓虹颌针', kg: [.3, 1.1], w: 14, price: 12, col: 0x3f9a8c, belly: 0xd8e8e0, fight: .6, slim: 1 },
    { id: 'bass', name: '琥珀鲈', kg: [1.2, 4.5], w: 12, price: 11, col: 0x8a6a2c, belly: 0xe6d8a8, fight: .78 },
    { id: 'ray', name: '浅滩燕魟', kg: [3, 9], w: 4, price: 8, col: 0x5a5448, belly: 0xd9d2c2, fight: .95, flat: 1 },
    { id: 'junk', name: '泡烂的球鞋', kg: [.3, .5], w: 6, price: 0, col: 0x4a4f52, belly: 0x6a6f72, fight: .15, junk: 1 }];
  const FSH = { rod: null, line: null, float: null, rings: [], fish: {} };
  function makeRod() { if (FSH.rod) return FSH.rod; const g = new T.Group(), segs = [], N = 7, mat = GT.mat('metal_dark', { color: 0x23262a, rough: .35 }); let y = 0;
    const kk = GT.kit(); kk.cyl(GT.mat('rubber', { color: 0x6a5a44, rough: .95 }), .014, .016, .34, 0, .02, 0, { seg: 10 }); kk.cyl('chrome', .018, .018, .03, 0, .2, 0, { seg: 10 }); kk.cyl('metal_dark', .03, .03, .034, .03, .14, 0, { seg: 14, rz: HP }); kk.cyl('chrome', .02, .02, .05, .03, .14, 0, { seg: 10, rz: HP }); kk.box('metal_dark', .01, .01, .06, .06, .14, .03, { bevel: .003 }); const handle = kk.build(); g.add(handle);
    for (let i = 0; i < N; i++) { const len = .36, r0 = lerp(.0085, .0022, i / N), r1 = lerp(.0085, .0022, (i + 1) / N), m = new T.Mesh(new T.CylinderGeometry(r1, r0, len, 8), mat), piv = new T.Group(); m.position.y = len / 2; m.castShadow = true; piv.add(m);
      const eye = new T.Mesh(new T.TorusGeometry(.008 - i * .0007, .0012, 4, 10), GT.mat('chrome')); eye.position.set(0, len * .95, .01 - i * .0006); eye.rotation.x = HP; piv.add(eye); piv.position.y = i === 0 ? .2 : .36; (i === 0 ? g : segs[i - 1]).add(piv); segs.push(piv); }
    const tip = new T.Object3D(); tip.position.y = .36; segs[N - 1].add(tip); g.userData = { segs, tip }; A.root.add(g); g.visible = false;
    const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.BufferAttribute(new Float32Array(20 * 3), 3)); FSH.line = new T.Line(lg, new T.LineBasicMaterial({ color: C(0xe8e6de), transparent: true, opacity: .7 })); FSH.line.frustumCulled = false; FSH.line.visible = false; A.root.add(FSH.line);
    const fk = GT.kit(); fk.sphere(GT.mat('plastic_red', { color: 0xd23a22, rough: .35 }), .04, 0, .022, 0, { seg: 14, seg2: 10, s: [1, .9, 1] }); fk.sphere(GT.mat('plastic_white', { rough: .35 }), .0395, 0, -.006, 0, { seg: 14, seg2: 10, s: [1, .95, 1] }); fk.cyl(GT.mat('plastic_red', { color: 0xe8662a }), .004, .004, .12, 0, .1, 0, { seg: 6 }); fk.cyl('plastic_black', .005, .003, .05, 0, -.06, 0, { seg: 6 }); FSH.float = fk.build(); FSH.float.visible = false; A.root.add(FSH.float);
    const rm = new T.MeshBasicMaterial({ color: new T.Color(.9, .85, .75), transparent: true, opacity: .5, depthWrite: false, side: T.DoubleSide }); for (let i = 0; i < 5; i++) { const r = new T.Mesh(new T.RingGeometry(.92, 1, 40), rm.clone()); r.rotation.x = -HP; r.visible = false; r.userData = { t: -1 }; A.root.add(r); FSH.rings.push(r); }
    return FSH.rod = g; }
  function ripple(x, z, size) { const r = FSH.rings.find(q => q.userData.t < 0) || FSH.rings[0]; r.position.set(x, SEA_Y + .012, z); r.userData = { t: 0, size: size || 1 }; r.visible = true; }
  function makeFish(sp) { if (FSH.fish[sp.id]) return FSH.fish[sp.id]; const g = new T.Group(), N = 14, M = 12, L = 1, pos = [], col = [], idx = [], c0 = C(sp.col), c1 = C(sp.belly);
    if (sp.junk) { const k = GT.kit(); k.box(GT.mat('fabric_dark', { color: 0x4f5557 }), .1, .09, .27, 0, 0, 0, { bevel: .035 }); k.box(GT.mat('rubber', { color: 0x8f8c80 }), .105, .03, .28, 0, -.05, 0, { bevel: .012 }); k.box(GT.mat('fabric_dark', { color: 0x3f4547 }), .09, .1, .1, 0, .06, -.07, { bevel: .03 }); g.add(k.build()); g.userData.len = .28; }
    else { for (let i = 0; i <= N; i++) { const u = i / N, prof = Math.pow(sin(PI * Math.pow(u, .62)), .8), hh = (sp.flat ? .05 : sp.slim ? .05 : .15) * prof + .004, ww = (sp.flat ? .34 * Math.pow(sin(PI * cl(u * 1.25, 0, 1)), 1.2) : sp.slim ? .028 : .055) * (sp.flat ? 1 : prof) + .003;
        for (let j = 0; j < M; j++) { const a = j / M * TAU, y = cos(a) * hh, x = sin(a) * ww * (cos(a) < 0 ? 1 : .8); pos.push(x, y, (u - .5) * L); const k = ss(cos(a), -.5, .45) * (1 - .25 * sin(u * 23) * sin(u * 23)); col.push(lerp(c1.r, c0.r, k), lerp(c1.g, c0.g, k), lerp(c1.b, c0.b, k)); } }
      for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * M + j, b = i * M + (j + 1) % M, c = a + M, d = b + M; idx.push(a, c, b, b, c, d); }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new T.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      const mat = stdMat('fishbody', { vertexColors: true, roughness: .32, metalness: .25 }), body = new T.Mesh(geo, mat); body.castShadow = true; g.add(body);
      const fin = (pts, z, y) => { const s = new T.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); const m = new T.Mesh(new T.ShapeGeometry(s), stdMat('fin' + sp.id, { color: c0.clone().multiplyScalar(.6), roughness: .5, side: T.DoubleSide, transparent: true, opacity: .9 })); m.rotation.y = -HP; m.position.set(0, y, z); g.add(m); return m; };
      if (!sp.flat) { fin([[0, 0], [.16, .13], [.19, 0], [.16, -.13]], -.47, 0); fin([[0, 0], [.1, .09], [.26, .03], [.3, 0]], .12, .13 * (sp.slim ? .35 : 1)); fin([[0, 0], [.08, -.07], [.16, -.01]], 0, -.13 * (sp.slim ? .35 : 1)); } else fin([[0, 0], [.5, .012], [.5, -.012]], -.5, 0);
      const eye = new T.Mesh(new T.SphereGeometry(.012, 8, 6), GT.mat('plastic_black', { rough: .1 })); eye.position.set(sp.flat ? .05 : .03, .03, .36); g.add(eye); const e2 = eye.clone(); e2.position.x *= -1; g.add(e2); g.userData.len = 1; }
    g.visible = false; A.root.add(g); return FSH.fish[sp.id] = g; }
  function pickFish(S, power) { const tot = FISH.reduce((a, f) => a + f.w * (f.kg[1] > 2 ? .5 + power : 1), 0); let r = S.rnd() * tot; for (const f of FISH) { r -= f.w * (f.kg[1] > 2 ? .5 + power : 1); if (r <= 0) return f; } return FISH[0]; }
  const FISH_LINES = { wait: ['浮漂随浪点头。', '海不急，你也别急。', '远处有船在慢慢挪。'], lost: ['线一松，它就没了。', '跑了。大的总是跑。'], snap: ['啪。线断了。', '太硬来了。'] };
  ACT.fishing = { name: '钓鱼 · 栈桥',
    start(S) { const a = (S.arg.spot !== undefined ? site('fishSpot' + S.arg.spot) : null) || nearestSite('fishSpot', S.origin) || site('pier'); if (!a) return false; S.a = a; S.rod = makeRod(); S.rod.visible = true; FSH.line.visible = true; S.ph = 'ready'; S.pt = 0; S.power = 0; S.pd = 1; S.fl = V3(); S.fv = V3(); S.cast = 1; S.bend = 0; S.count = 0; S.tension = .4; S.prog = 0; S.bag0 = A.inv.fish.length;
      heroPlace(S, a.x, a.y, a.z, a.h); heroAnim(S, 'fish', { cast: 1 }); S.seaY = SEA_Y; S.dist = 0; },
    update(S, dt, inp) { const a = S.a, [fx, fz] = fwd(a.h); S.pt += dt; const sp = inp.down('Space') || inp.down('Mouse0'), spP = inp.pressed('Space') || inp.pressed('Mouse0');
      if (S.ph === 'ready') { S.cast = ease(S.cast, 1, 6, dt); S.bend = ease(S.bend, 0, 5, dt); if (spP && S.pt > .3) { S.ph = 'charge'; S.pt = 0; S.power = 0; S.pd = 1; } }
      else if (S.ph === 'charge') { S.power += S.pd * dt / .9; if (S.power >= 1) { S.power = 1; S.pd = -1; } if (S.power <= 0) { S.power = 0; S.pd = 1; } S.cast = ease(S.cast, .15 - S.power * .15, 8, dt); if (!sp) { S.ph = 'swing'; S.pt = 0; S.castPower = S.power; snd('whoosh', { g: .7 }); } }
      else if (S.ph === 'swing') { S.cast = cl(S.pt / .22, 0, 1); if (S.pt >= .2 && !S.flying) { S.flying = true; fishTip(S, _v); S.fl.copy(_v); const d = 5 + S.castPower * 17; S.target = V3(a.x + fx * (d + 1.2), S.seaY, a.z + fz * (d + 1.2)); const tt = .75 + S.castPower * .55; S.fv.set((S.target.x - S.fl.x) / tt, (S.target.y - S.fl.y) / tt + .5 * GRAV * tt, (S.target.z - S.fl.z) / tt); snd('reel', { g: .5 }); }
        if (S.flying) { S.fv.y -= GRAV * dt; S.fl.addScaledVector(S.fv, dt); if (S.fl.y <= S.seaY) { S.fl.y = S.seaY; S.flying = false; S.ph = 'wait'; S.pt = 0; S.dist = Math.hypot(S.fl.x - a.x, S.fl.z - a.z); snd('plop'); ripple(S.fl.x, S.fl.z, 1); S.biteAt = (S.arg.biteAt) || 3 + S.rnd() * 6; S.nib = S.biteAt * (.35 + S.rnd() * .3); S.sp = pickFish(S, S.castPower); S.kg = +(lerp(S.sp.kg[0], S.sp.kg[1], Math.pow(S.rnd(), 1.6 - S.castPower * .8))).toFixed(2); } } }
      else if (S.ph === 'wait') { if (S.pt > S.nib && !S.nibbed) { S.nibbed = true; S.dip = .35; ripple(S.fl.x, S.fl.z, .5); snd('tick', { g: .7 }); } if (S.pt > S.biteAt) { S.ph = 'bite'; S.pt = 0; S.dip = 1; snd('plop', { g: 1 }); snd('bell', { g: .5 }); ripple(S.fl.x, S.fl.z, 1.3); hudMsg('咬钩！', '按 Space 扬竿', 'cool', 1); } else if (spP && S.pt > .5) { fishReset(S, '收线重来。'); } }
      else if (S.ph === 'bite') { if ((S.pt % .3) < dt) ripple(S.fl.x, S.fl.z, .8); if (spP) { S.ph = 'reel'; S.pt = 0; S.tension = .45; S.prog = 0; S.d0 = S.dist; S.surge = 0; S.slack = 0; S.over = 0; snd('reel'); hudMsg(S.sp.junk ? '好沉……' : '中鱼！', '按住 Space 收线，别让张力爆表', 'good', 1.6); } else if (S.pt > 1.0) { ST.fish.lost++; fishReset(S, '慢了半拍，饵没了。'); } }
      else if (S.ph === 'reel') { const f = S.sp.fight; S.surgeT = (S.surgeT || 0) - dt; if (S.surgeT <= 0) { S.surge = S.rnd() < .45 + f * .3 ? (.35 + S.rnd() * .65) * f : 0; S.surgeT = .5 + S.rnd() * 1.1; if (S.surge > .5) ripple(S.fl.x, S.fl.z, .9); }
        const pull = S.surge * 1.15, reel = sp ? 1 : 0; S.tension += ((reel ? .62 + pull * .75 : -.55 + pull * .5) - (S.tension - .5) * .25) * dt * 1.25; S.tension = cl(S.tension, 0, 1.15);
        if (reel) { S.prog += dt * (.2 - S.surge * .1) / (.6 + f * .8 + S.kg * .04); if ((S.pt % .12) < dt) snd('reel', { g: .35 }); } else S.prog -= dt * S.surge * .05; S.prog = cl(S.prog, 0, 1);
        S.over = S.tension > 1 ? S.over + dt : max(0, S.over - dt * 2); S.slack = S.tension < .12 ? S.slack + dt : max(0, S.slack - dt * 2); S.bend = ease(S.bend, cl(S.tension, 0, 1.1), 8, dt);
        const d = lerp(S.d0, 1.6, S.prog), wob = sin(S.pt * 3.1) * .9 * S.surge + sin(S.pt * 1.3) * .5; S.fl.set(a.x + fx * (d + 1.2) + rgt(a.h)[0] * wob, S.seaY - .05, a.z + fz * (d + 1.2) + rgt(a.h)[1] * wob); S.dip = .8;
        if ((S.pt % .5) < dt) ripple(S.fl.x, S.fl.z, .5 + S.surge * .6);
        if (S.over > .7) { ST.fish.lost++; snd('ui_bad'); fishReset(S, FISH_LINES.snap[ST.fish.lost % 2], '断线'); } else if (S.slack > 1.6) { ST.fish.lost++; fishReset(S, FISH_LINES.lost[ST.fish.lost % 2], '脱钩'); } else if (S.prog >= 1) fishLand(S); }
      else if (S.ph === 'landed') { S.bend = ease(S.bend, .25, 5, dt); if (S.pt > 1.2 && (spP || anyPressed(inp, K_OK)) || S.pt > 4.2) { if (S.fishObj) S.fishObj.visible = false; S.ph = 'ready'; S.pt = 0; FSH.float.visible = false; } }
      S.dip = ease(S.dip || 0, S.ph === 'bite' ? 1 : S.ph === 'reel' ? .8 : 0, S.ph === 'wait' ? 5 : 9, dt);
      heroAnim(S, 'fish', { cast: S.cast, bend: S.bend, reel: S.ph === 'reel' && sp, t: S.t }); for (const r of FSH.rings) if (r.userData.t >= 0) { const u = r.userData; u.t += dt; const k = u.t / 1.5; r.scale.setScalar((.12 + k * 1.1) * u.size); r.material.opacity = .5 * (1 - k); if (k >= 1) { u.t = -1; r.visible = false; } }
      return false; },
    late(S) { const a = S.a, rod = S.rod, [fx, fz] = fwd(a.h), seg = rod.userData.segs; S.hero.world('handR', _v); if (!S.hero.bone('handR')) _v.set(a.x + fx * .35, a.y + 1.1, a.z + fz * .35);
      rod.position.copy(_v); const pitch = lerp(-.9, .95, S.cast) - S.bend * .12 + (S.ph === 'landed' ? -.55 : 0); rod.rotation.set(0, 0, 0); rod.rotation.order = 'YXZ'; rod.rotation.y = a.h; rod.rotation.x = pitch;
      const bend = (S.ph === 'swing' ? (.5 - abs(S.cast - .5)) * -.5 : S.bend * .16) + (S.ph === 'bite' ? .1 : 0); for (let i = 0; i < seg.length; i++) seg[i].rotation.x = bend * (.4 + i * .22);
      const tip = fishTip(S, _v2), fl = FSH.float, wave = sin(S.t * 1.7 + S.fl.x * .4) * .028 + sin(S.t * 2.9 + S.fl.z * .7) * .014;
      if (S.ph === 'ready' || S.ph === 'charge' || (S.ph === 'swing' && !S.flying)) { S.fl.copy(tip); S.fl.y -= .55; S.fl.x += sin(S.t * 2.2) * .03; fl.visible = S.ph !== 'landed'; fl.position.copy(S.fl); fl.rotation.set(0, 0, 0); }
      else if (S.ph === 'landed') { fl.visible = false; S.fl.copy(tip); S.fl.y -= .7; if (S.fishObj) { const o = S.fishObj; o.position.copy(S.fl); o.position.y -= o.scale.z * .5; o.rotation.set(-HP + sin(S.t * 6) * .12 * max(0, 1 - S.pt * .4), a.h + HP + sin(S.t * 4.3) * .3 * max(0, 1 - S.pt * .5), 0); } }
      else { fl.visible = true; fl.position.set(S.fl.x, S.fl.y + (S.flying ? 0 : wave - (S.dip || 0) * .085), S.fl.z); fl.rotation.set(S.flying ? 1 : sin(S.t * 1.9) * .12 + (S.dip || 0) * .5, 0, S.flying ? 0 : cos(S.t * 1.4) * .1); }
      const lp = FSH.line.geometry.attributes.position, end = S.ph === 'landed' ? S.fl : fl.position, sag = S.ph === 'reel' ? (1 - cl(S.tension, 0, 1)) * .5 : S.flying ? .15 : S.ph === 'wait' || S.ph === 'bite' ? 1.1 - (S.dip || 0) * .7 : .02, n = 20; for (let i = 0; i < n; i++) { const u = i / (n - 1); lp.setXYZ(i, lerp(tip.x, end.x, u), lerp(tip.y, end.y + .1, u) - sin(u * PI) * sag * (1 + u), lerp(tip.z, end.z, u)); } lp.needsUpdate = true; },
    camera(S, dt) { const a = S.a, [fx, fz] = fwd(a.h), far = S.ph === 'wait' || S.ph === 'bite' || S.ph === 'reel' || S.flying; S.ck = ease(S.ck || 0, far ? 1 : 0, 2.5, dt);
      if (S.ph === 'landed') { const [rx, rz] = rgt(a.h); S.ct.pos = [a.x - fx * 1.5 + rx * 2.3, a.y + 1.55, a.z - fz * 1.5 + rz * 2.3]; S.ct.look = [a.x + fx * .9, a.y + 1.35, a.z + fz * .9]; S.ct.fov = 44; return; }
      const d = S.dist || 10, to = [a.x + fx * lerp(4, min(d, 14) * .8, S.ck), lerp(a.y + .9, S.seaY + .6, S.ck), a.z + fz * lerp(4, min(d, 14) * .8, S.ck)]; shoulder(S, a, a.h, to, { dist: lerp(2.9, 2.5, S.ck), side: lerp(.95, 1.25, S.ck), up: lerp(1.8, 2.05, S.ck), k: .8, fov: lerp(50, S.ph === 'bite' || S.ph === 'reel' ? 36 : 42, S.ck) }); },
    info(S) { const bag = A.inv.fish, keys = { ready: [['Space', '按住蓄力抛竿']], charge: [['Space', '松开抛出']], swing: [], wait: [['Space', '收线重抛', true]], bite: [['Space', '扬竿！']], reel: [['Space', '按住收线 · 松开放线']], landed: [['Space', '继续']] }[S.ph].concat([['Esc', '收竿']]);
      return { sub: { ready: '找个顺手的力道', charge: '力道越大，抛得越远', swing: '', wait: FISH_LINES.wait[Math.floor(S.t / 5) % 3], bite: '有东西在拽！', reel: '张力留在中段', landed: '' }[S.ph], stats: [['鱼护', bag.length + ' 条'], ['估价', money(bag.reduce((s, f) => s + f.value, 0))], ['最大', ST.fish.biggest ? ST.fish.biggest.kg.toFixed(1) + ' kg' : '—']], keys }; },
    draw(S, g, w, h) { const x = 30, bw = w - 60; if (S.ph === 'ready' || S.ph === 'charge' || S.ph === 'swing') { G.panel(g, 0, 8, w, 62); G.label(g, '抛竿力道', x, 24); const p = S.ph === 'charge' ? S.power : S.castPower || 0; G.label(g, (5 + p * 17).toFixed(0) + ' m', w - x, 24, { align: 'right', c: '#ffb454' });
        g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 6; g.beginPath(); g.moveTo(x, 54); g.quadraticCurveTo(w / 2, 26, w - x, 54); g.stroke(); g.strokeStyle = '#f1ede4'; g.beginPath(); const n = 24; for (let i = 0; i <= n * p; i++) { const u = i / n, px = lerp(x, w - x, u), py = 54 - 14 * 4 * u * (1 - u) * .5 * 2; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke(); }
      else if (S.ph === 'wait' || S.ph === 'bite') { G.panel(g, 0, 8, w, 62); G.label(g, S.ph === 'bite' ? '咬钩' : '等口', x, 24, { c: S.ph === 'bite' ? '#9fe8dc' : undefined }); G.label(g, '落点 ' + S.dist.toFixed(0) + ' m', w - x, 24, { align: 'right' }); const cy = 48; g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 1; g.beginPath(); for (let i = 0; i <= 60; i++) { const px = x + bw * i / 60, py = cy + sin(i * .5 + S.t * 2.4) * 3; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke();
        const fy = cy + sin(30 * .5 + S.t * 2.4) * 3 + (S.dip || 0) * 9; g.fillStyle = '#e2452c'; g.beginPath(); g.arc(w / 2, fy - 3, 6, PI, 0); g.fill(); g.fillStyle = '#f1ede4'; g.beginPath(); g.arc(w / 2, fy - 3, 6, 0, PI); g.fill(); if (S.ph === 'bite') { const k = (S.pt * 2.5) % 1; g.strokeStyle = 'rgba(159,232,220,' + (1 - k) + ')'; g.lineWidth = 2; g.beginPath(); g.arc(w / 2, fy - 3, 8 + k * 26, 0, TAU); g.stroke(); G.label(g, '!', w / 2 + 44, 46, { s: 26, w: 700, c: '#9fe8dc' }); } }
      else if (S.ph === 'reel') { G.panel(g, 0, 8, w, 80); G.label(g, '线张力', x, 24); G.label(g, S.tension > 1 ? '要断了！' : S.tension < .12 ? '太松！' : '', w - x, 24, { align: 'right', c: '#ff8f7c' }); g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x, 36, bw, 12); g.fillStyle = 'rgba(159,232,220,.25)'; g.fillRect(x + bw * .3 / 1.15, 36, bw * .55 / 1.15, 12); g.fillStyle = 'rgba(255,143,124,.35)'; g.fillRect(x + bw / 1.15, 36, bw * .15 / 1.15, 12);
        g.fillStyle = S.tension > 1 ? '#ff8f7c' : '#f1ede4'; g.fillRect(x + bw * S.tension / 1.15 - 1.5, 31, 3, 22); G.label(g, '收回', x, 70); G.bar(g, x + 40, 67, bw - 40, 5, S.prog, '#ffb454'); }
      else if (S.ph === 'landed') { G.panel(g, 0, 8, w, 62); G.label(g, S.sp.name, x, 30, { s: 18, w: 600, c: '#f1ede4' }); G.label(g, S.sp.junk ? '不是鱼，但也算收获' : S.kg.toFixed(2) + ' kg · 约 ' + money(S.value), x, 54, { s: 12 }); if (S.record) G.label(g, '个人最大', w - x, 30, { align: 'right', c: '#ffb454' }); } },
    end(S) { S.rod.visible = false; FSH.line.visible = false; FSH.float.visible = false; if (S.fishObj) S.fishObj.visible = false; for (const r of FSH.rings) { r.visible = false; r.userData.t = -1; } S.result = { caught: A.inv.fish.length - S.bag0 }; if (A.inv.fish.length > S.bag0) toast('鱼护', '落潮酒吧收鱼，去吧台问问。'); },
    auto(S, vk) { const tp = (S.arg.power) || .7; if (S.ph === 'ready') vk.hold('Space', S.pt > .6); else if (S.ph === 'charge') { if (S.power >= tp) vk.hold('Space', false); } else if (S.ph === 'wait' || S.ph === 'swing') vk.hold('Space', false); else if (S.ph === 'bite') { if (S.pt > .45) vk.hold('Space', true); }
      else if (S.ph === 'reel') vk.hold('Space', S.tension < (S.surge > .4 ? .62 : .82)); else if (S.ph === 'landed') vk.hold('Space', false); }
  };
  const nearestSite = (prefix, p) => { const l = sites(prefix); if (!l.length) return null; return l[nearestIdx(l, p)]; };
  function fishTip(S, out) { S.rod.updateMatrixWorld(true); return S.rod.userData.tip.getWorldPosition(out); }
  function fishReset(S, line, title) { hudMsg(title || '空竿', line, 'bad', 1.8); S.ph = 'ready'; S.pt = 0; S.flying = false; S.nibbed = false; S.bend = 0; }
  function fishLand(S) { const sp = S.sp, value = sp.junk ? 0 : Math.round(sp.price * S.kg); S.value = value; S.ph = 'landed'; S.pt = 0; S.nibbed = false; snd('splash'); ripple(S.fl.x, S.fl.z, 1.6); S.record = false;
    if (!sp.junk) { A.inv.fish.push({ id: sp.id, name: sp.name, kg: S.kg, value }); ST.fish.caught++; if (!ST.fish.biggest || S.kg > ST.fish.biggest.kg) { ST.fish.biggest = { name: sp.name, kg: S.kg }; S.record = true; } snd('ui_ok'); } else { addKarma(.02, '捞起一只垃圾，海干净了一点'); }
    const o = S.fishObj = makeFish(sp), len = sp.junk ? 1 : cl(.26 + Math.pow(S.kg, .42) * .26, .22, .95); o.scale.setScalar(sp.junk ? 1 : len); o.visible = true; hudMsg(sp.junk ? '……一只球鞋' : '上鱼！', sp.name + (sp.junk ? '' : ' · ' + S.kg.toFixed(2) + ' kg'), sp.junk ? '' : 'good', 2.4); emit('fishing', { type: 'catch', fish: sp.id, kg: S.kg, value }); }
  /** sell everything in the fish bag (the tiki bar does this). returns the cash paid. */
  function sellFish() { const n = A.inv.fish.length; if (!n) return 0; const sum = A.inv.fish.reduce((s, f) => s + f.value, 0); A.inv.fish.length = 0; W.add(sum, 'fish'); ST.fish.sold += n; ST.fish.earned += sum; snd('cash'); emit('fishing', { type: 'sold', n, sum }); return sum; }

  /* ================================================================== 4. vending machines */
  const VEND = { Drink: [{ id: 'citrus', label: '柑橘汽水', price: 2, col: 0xc94a32, focus: .22 }, { id: 'tea', label: '冰柠茶', price: 2, col: 0xc9a22e, focus: .2 }, { id: 'volt', label: '满格能量饮', price: 3, col: 0x2f8a62, focus: .4 }, { id: 'water', label: '矿泉水', price: 1, col: 0xa9c4cf, focus: .12 }],
    Snack: [{ id: 'chips', label: '海盐薯片', price: 2, col: 0xd0a030 }, { id: 'peanut', label: '花生酥', price: 1, col: 0x8a5a2a }, { id: 'jerky', label: '牛肉干', price: 3, col: 0x7a2a22, dog: 2 }, { id: 'mint', label: '薄荷糖', price: 1, col: 0x4f9a88 }], props: {} };
  function vendProp(kind, it) { const key = kind + it.id; if (VEND.props[key]) return VEND.props[key]; const k = GT.kit();
    if (kind === 'Drink') { k.cyl(GT.mat('metal_painted_red', { color: it.col, rough: .3 }), .033, .033, .1, 0, 0, 0, { seg: 18 }); k.cyl('aluminium_brushed', .028, .033, .012, 0, .056, 0, { seg: 18 }); k.cyl('aluminium_brushed', .033, .027, .01, 0, -.055, 0, { seg: 18 }); k.cyl(GT.mat('plastic_white', { color: 0xf1ead8 }), .0335, .0335, .03, 0, .005, 0, { seg: 18 }); k.box('aluminium_brushed', .012, .003, .02, 0, .0635, .006, { bevel: .001 }); }
    else { k.box(GT.mat('plastic_red', { color: it.col, rough: .4 }), .11, .15, .035, 0, 0, 0, { bevel: .014 }); k.box(GT.mat('plastic_white', { color: 0xf1ead8 }), .08, .05, .037, 0, .01, 0, { bevel: .006 }); k.box('aluminium_brushed', .11, .012, .006, 0, .078, 0); k.box('aluminium_brushed', .11, .012, .006, 0, -.078, 0); }
    const g = k.build(); g.visible = false; A.root.add(g); return VEND.props[key] = g; }
  const VEND_LINES = { eaten: ['它把钱吞了，连声谢谢都没有。', '硬币掉进去，没有回音。', '屏幕闪了一下，然后装作无事发生。'], kickOk: ['咣当。它想通了。', '掉下来了，还多响了一声。'], kickNo: ['它嗡了一声，像是在笑。', '脚疼，罐子没出来。'], drink: ['凉的。脑子清楚了一截。', '气很足。', '甜得不讲道理。'] };
  ACT.vending = { name: '自动贩卖机',
    start(S) { const kind = S.kind = (S.arg.kind) || 'Drink', a = site('vend' + kind); if (!a) return false; S.a = a; S.items = VEND[kind]; S.sel = 0; S.ph = 'pick'; S.pt = 0; S.kicks = 0; S.shake = 0; S.reach = 0; S.prop = null; const mc = a.a && a.a.machine, mh = mc ? Math.atan2(mc[0] - a.x, mc[2] - a.z) : a.h, [fx, fz] = fwd(mh); a.h = mh; S.front = mc ? { x: mc[0] - fx * .18, z: mc[2] - fz * .18 } : { x: a.x + fx * .62, z: a.z + fz * .62 };
      heroPlace(S, a.x, a.y, a.z, a.h); heroAnim(S, 'idle'); S.forceEat = S.arg.eat; },
    update(S, dt, inp) { const a = S.a, it = S.items[S.sel]; S.pt += dt; S.shake = max(0, S.shake - dt * 3);
      if (S.ph === 'pick') { S.reach = ease(S.reach, 0, 6, dt); heroAnim(S, 'idle'); if (anyPressed(inp, K_L) || anyPressed(inp, K_U)) { S.sel = (S.sel + S.items.length - 1) % S.items.length; snd('ui_tick'); } else if (anyPressed(inp, K_R) || anyPressed(inp, K_D)) { S.sel = (S.sel + 1) % S.items.length; snd('ui_tick'); }
        else if (anyPressed(inp, K_OK) || anyPressed(inp, K_GO)) { if (!W.spend(it.price)) { hudMsg('零钱不够', it.label + ' ' + money(it.price), 'bad', 1.4); snd('ui_bad'); } else { S.ph = 'pay'; S.pt = 0; S.it = it; snd('coin'); ST.vend.bought++; } } }
      else if (S.ph === 'pay') { S.reach = ease(S.reach, 1, 9, dt); heroAnim(S, 'use', { reach: S.reach }); if (S.pt > .75) { const eat = S.forceEat !== undefined ? !!S.forceEat : S.rnd() < .13; S.forceEat = undefined; if (eat) { S.ph = 'eaten'; S.pt = 0; ST.vend.eaten++; snd('ui_bad', { g: .6 }); const L = VEND_LINES.eaten; hudMsg('吞币了', L[ST.vend.eaten % L.length], 'bad', 2.2); } else vendDrop(S); } }
      else if (S.ph === 'eaten') { S.reach = ease(S.reach, 0, 5, dt); heroAnim(S, 'idle'); if (inp.pressed('KeyF') && S.kicks < 3) { S.ph = 'kick'; S.pt = 0; S.kicks++; } else if (anyPressed(inp, K_OK)) { S.ph = 'pick'; S.pt = 0; } }
      else if (S.ph === 'kick') { heroAnim(S, 'kick', { phase: cl(S.pt / .5, 0, 1) }); if (S.pt > .22 && !S.kicked) { S.kicked = true; S.shake = 1; snd('kick'); ST.vend.kicked++; addKarma(-.04, '踹了贩卖机一脚'); emit('vending', { type: 'kick' }); }
        if (S.pt > .7) { S.kicked = false; const ok = S.arg.kickOk !== undefined ? S.arg.kickOk : S.rnd() < .55; if (ok) { const L = VEND_LINES.kickOk; hudMsg('出来了', L[S.kicks % L.length], 'good', 1.6); vendDrop(S); } else { const L = VEND_LINES.kickNo; hudMsg(S.kicks >= 3 ? '算了' : '没动静', S.kicks >= 3 ? '它不打算理你了。' : L[S.kicks % L.length], 'bad', 1.8); S.ph = S.kicks >= 3 ? 'pick' : 'eaten'; S.pt = 0; } } }
      else if (S.ph === 'drop') { const p = S.prop, fl = a.y + .36; S.vy -= 9.8 * dt; S.py += S.vy * dt; if (S.py < fl) { S.py = fl; if (S.vy < -.6) snd('clunk', { g: cl(-S.vy / 3, .3, 1) }); S.vy = -S.vy * .28; S.roll += 1; } p.position.set(S.front.x, S.py, S.front.z); p.rotation.set(HP, a.h + S.pt * 2, 0); heroAnim(S, 'idle'); S.reach = ease(S.reach, 0, 5, dt); if (S.pt > .85) { S.ph = 'grab'; S.pt = 0; } }
      else if (S.ph === 'grab') { S.reach = ease(S.reach, 1, 7, dt); heroAnim(S, S.pt < .55 ? 'crouch' : 'use', { reach: S.reach }); const p = S.prop; if (S.pt > .45) { S.hero.world('handR', _v); if (!S.hero.bone('handR')) _v.set(a.x, a.y + 1, a.z); p.position.lerp(_v, cl((S.pt - .45) / .25, 0, 1)); p.rotation.set(0, a.h, 0); }
        if (S.pt > 1.0) { if (S.kind === 'Drink') { S.ph = 'drink'; S.pt = 0; snd('fizz'); } else { A.inv.snack += S.it.dog || 1; S.ph = 'pocket'; S.pt = 0; hudMsg(S.it.label, '揣进口袋 · 可以喂狗', 'cool', 1.8); emit('vending', { type: 'snack', id: S.it.id }); } } }
      else if (S.ph === 'drink') { const k = ss(S.pt, .3, .8) * (1 - ss(S.pt, 2.0, 2.4)); heroAnim(S, 'drink', { reach: k }); S.hero.world('handR', _v); if (!S.hero.bone('handR')) _v.set(a.x, a.y + 1.5, a.z); S.prop.position.copy(_v); S.prop.position.y += .06; S.prop.rotation.set(-k * 1.3, a.h, 0); if (S.pt > .8 && !S.gulp) { S.gulp = true; snd('gulp'); }
        if (S.pt > 2.5) { S.gulp = false; ST.focus = cl(ST.focus + S.it.focus, 0, 1); A.inv.drink++; const L = VEND_LINES.drink; hudMsg('专注 +' + Math.round(S.it.focus * 100), L[ST.vend.bought % L.length], 'cool', 1.8); S.prop.visible = false; S.ph = 'pick'; S.pt = 0; emit('vending', { type: 'drink', id: S.it.id, focus: ST.focus }); } }
      else if (S.ph === 'pocket') { heroAnim(S, 'idle'); S.prop.position.y -= dt * .9; if (S.pt > .5) { S.prop.visible = false; S.ph = 'pick'; S.pt = 0; } }
      const v = STAND.vend[S.kind]; if (v) { v.sel.visible = true; v.sel.position.y = v.y0 + 1.62 - S.sel * .1; v.sel.material.color.setRGB(3, 1.7, .5).multiplyScalar(S.ph === 'pay' ? .5 + .5 * sin(S.t * 30) : S.ph === 'eaten' ? .25 : 1); }
      return false; },
    camera(S) { const a = S.a, [fx, fz] = fwd(a.h), sh = S.shake * sin(S.t * 50) * .02; shoulder(S, a, a.h, [S.front.x - rgt(a.h)[0] * .25, a.y + .95, S.front.z - rgt(a.h)[1] * .25], { dist: 1.75, side: 1.55, up: 1.55, k: .92, fov: 48 }); S.ct.pos[1] += sh; S.ct.look[0] += sh; },
    info(S) { const eaten = S.ph === 'eaten'; return { sub: S.kind === 'Drink' ? '冷饮 · 投币口有点松' : '零食 · 最下面一排卡过货', stats: [['现金', money(W.cash)], ['专注', Math.round(ST.focus * 100) + '%', S.ph === 'drink'], ['零食', '×' + A.inv.snack]],
        menu: { title: S.kind === 'Drink' ? '冷 饮' : '零 食', sel: S.sel, items: S.items.map(i => ({ label: i.label, price: money(i.price), off: W.cash < i.price, note: i.dog ? '狗最爱' : undefined })) },
        keys: eaten ? [['F', '踹一脚', S.kicks >= 3], ['E', '认栽'], ['Esc', '离开']] : [['A/D', '选择'], ['E', '投币购买', S.ph !== 'pick'], ['Esc', '离开']] }; },
    end(S) { if (S.prop) S.prop.visible = false; const v = STAND.vend[S.kind]; if (v) v.sel.visible = false; },
    auto(S, vk) { const sc = (S.arg.script) || 'buy'; if (S.ph === 'pick' && S.pt > .5) { const want = (S.arg.item) || 0; if (S.sel !== want) { if (S.pt > .7) { vk.tap('KeyD'); S.pt = .5; } } else if (S.pt > 1.1 && !(S.autoN >= ((S.arg.n) || 1))) { vk.tap('KeyE'); S.autoN = (S.autoN || 0) + 1; } } else if (S.ph === 'eaten' && S.pt > 1.6) vk.tap(sc === 'giveup' ? 'KeyE' : 'KeyF'); }
  };
  function vendDrop(S) { const p = S.prop = vendProp(S.kind, S.it); p.visible = true; S.ph = 'drop'; S.pt = 0; S.py = S.a.y + .62; S.vy = 0; S.roll = 0; }

  /* ================================================================== 5. tiki bar */
  const BAR_MENU = [{ id: 'coco', label: '椰子冰', price: 4, note: '专注回一大截', col: 0xe9e2cf, focus: .35 }, { id: 'punch', label: '朗姆潘趣', price: 6, note: '甜，后劲不小', col: 0xc8452e, focus: .1 }, { id: 'beer', label: '冰啤', price: 3, note: '凉的就行', col: 0xd9a02c, focus: .15 }, { id: 'soda', label: '苏打水', price: 2, note: '开车的喝这个', col: 0xcfe2e6, focus: .12 },
    { id: 'tip', label: '放点小费', price: 2, note: '老板会记得你' }, { id: 'sell', label: '卖鱼' }, { id: 'juke', label: '点唱机 · 换台' }, { id: 'listen', label: '听听隔壁在聊什么' }];
  const RUMOURS = ['球场那帮人押二十，十投六中给六十。上周有个开车的把他们赢哭了。', '栈桥往外走，天擦黑的时候上琥珀鲈。抛远点，别怕费线。', '那台汽水机十次里吞一次钱。踹一脚有时候管用，就是不太体面。', '沙滩上那个拳台今晚有摔跤。“铁锚”老莫年纪大了，赔率可还把他当年轻人算。',
    '后街那条环线，有人掐表跑进了四十秒。北口常蹲着一辆巡逻车。', '加油站那家店，门口一个探头，柜台后头还有一个。站海堤上拿望远镜，看得一清二楚。', '堤上那条黄狗谁都不认，就认牛肉干。', '健身角那根杠铃没人收。练完放回去，别学上一个。'];
  const BARK = { glass: null, liquid: null, tender: null, station: 0 };
  function barGlass(col) { if (!BARK.glass) { const g = new T.Group(), gl = new T.Mesh(new T.CylinderGeometry(.036, .029, .12, 16, 1, true), GT.mat('glass_clear')), liq = new T.Mesh(new T.CylinderGeometry(.033, .028, .09, 14), new T.MeshStandardMaterial({ roughness: .15, transparent: true, opacity: .88 })); liq.position.y = -.012; const base = new T.Mesh(new T.CylinderGeometry(.029, .029, .008, 14), GT.mat('glass_clear')); base.position.y = -.058;
      const straw = new T.Mesh(new T.CylinderGeometry(.003, .003, .17, 6), GT.mat('plastic_red', { color: 0xe8e2d0 })); straw.position.set(.012, .03, 0); straw.rotation.z = -.2; g.add(liq, gl, base, straw); g.visible = false; A.root.add(g); BARK.glass = g; BARK.liquid = liq; } BARK.liquid.material.color.copy(C(col)); return BARK.glass; }
  function stationName(i) { const s = GT.audio && GT.audio.stations; return s && s[i] ? s[i].name : ['Coral 98.1', 'Marea 104.5', 'Low Tide 88.3'][i % 3]; }
  /** jukebox: next radio station through GT.audio when it is there */
  function jukebox() { let idx; if (GT.audio && GT.audio.nextStation && GT.audio.ready) { try { idx = GT.audio.nextStation(); if (GT.audio.ambience) GT.audio.ambience({ interior: 0 }); } catch (e) { idx = undefined; } } if (idx === undefined) idx = (BARK.station + 1) % ((GT.audio && GT.audio.stations && GT.audio.stations.length) || 3); BARK.station = idx; ST.bar.songs++; snd('thunk', { g: .6 }); toast('点唱机', stationName(idx)); emit('bar', { type: 'jukebox', station: idx, name: stationName(idx) }); return idx; }
  ACT.bar = { name: '落潮酒吧',
    start(S) { const stools = sites('barStool', 6); const a = S.arg.stool !== undefined ? stools[S.arg.stool] : (stools.length ? stools[nearestIdx(stools, S.origin)] : site('barOrder')); if (!a) return false; S.a = a; S.seat = a.seat !== undefined ? a.seat : a.y + (stools.length ? .78 : 0); S.sit = stools.length > 0; S.sel = 0; S.ph = 'menu'; S.pt = 0; S.k = 0; S.rum = ST.bar.rumours.length % RUMOURS.length;
      heroPlace(S, a.x, S.sit ? S.seat - .5 : a.y, a.z, a.h); heroAnim(S, S.sit ? 'sit' : 'lean'); S.top = site('barTop'); const [fx, fz] = fwd(a.h); S.gp = S.top ? V3(S.top.x + .12, S.top.y + .062, a.z) : V3(a.x + fx * .62, S.seat + .33, a.z + fz * .62); S.tender = castTender(); if (S.tender) S.tender.want = 'idle'; },
    update(S, dt, inp) { S.pt += dt; const items = S.items = BAR_MENU.map(m => m.id === 'sell' ? Object.assign({}, m, { note: A.inv.fish.length ? A.inv.fish.length + ' 条 · ' + money(A.inv.fish.reduce((s, f) => s + f.value, 0)) : '鱼护是空的', off: !A.inv.fish.length }) : Object.assign({}, m, { off: m.price !== undefined && W.cash < m.price })), it = items[S.sel];
      if (S.ph === 'menu') { heroAnim(S, S.sit ? 'sit' : 'lean'); if (anyPressed(inp, K_U) || anyPressed(inp, K_L)) { S.sel = (S.sel + items.length - 1) % items.length; snd('ui_tick'); } else if (anyPressed(inp, K_D) || anyPressed(inp, K_R)) { S.sel = (S.sel + 1) % items.length; snd('ui_tick'); }
        else if (anyPressed(inp, K_OK) || anyPressed(inp, K_GO)) { if (it.id === 'juke') jukebox(); else if (it.id === 'listen') { const line = RUMOURS[S.rum % RUMOURS.length]; S.rum++; if (!ST.bar.rumours.includes(line)) ST.bar.rumours.push(line); say('隔壁桌', line); snd('ui_tick'); S.ph = 'listen'; S.pt = 0; emit('bar', { type: 'rumour', line }); }
          else if (it.id === 'sell') { const sum = sellFish(); if (sum) { hudMsg('鱼卖了', '+' + money(sum), 'good', 1.8); say('老板', '今天的鱼还行，现钱给你。'); } else { snd('ui_bad'); hudMsg('没有鱼', '栈桥上可以钓', 'bad', 1.4); } }
          else if (!W.spend(it.price)) { snd('ui_bad'); hudMsg('钱不够', it.label + ' ' + money(it.price), 'bad', 1.4); }
          else if (it.id === 'tip') { ST.bar.tips++; snd('coin'); addKarma(.04, '给了小费'); say('老板', ['谢了，下回给你留靠海的位子。', '客气。想听什么歌自己去按。', '行，记你一笔好。'][ST.bar.tips % 3]); }
          else { S.it = it; S.ph = 'pour'; S.pt = 0; S.glass = barGlass(it.col); S.glass.visible = true; snd('glass', { g: .25, distance: 20 }); if (S.tender) S.tender.want = 'use'; } } }
      else if (S.ph === 'pour') { const k = ss(S.pt, .3, 1.1); S.glass.position.set(S.gp.x - (1 - k) * .55 * fwd(S.a.h)[0] * -1 - .0, S.gp.y, S.gp.z - (1 - k) * .0); S.glass.position.x = S.gp.x - (1 - k) * .5; S.glass.rotation.set(0, 0, 0); if (S.pt > 1.3) { S.ph = 'drink'; S.pt = 0; if (S.tender) S.tender.want = 'idle'; } }
      else if (S.ph === 'drink') { const k = ss(S.pt, .2, .9) * (1 - ss(S.pt, 2.3, 2.9)); S.k = k; heroAnim(S, S.sit ? 'sit' : 'lean', { drink: k }); if (S.pt > .9 && !S.g1) { S.g1 = true; snd('gulp'); }
        if (S.pt > 3.1) { S.g1 = false; ST.bar.drinks++; ST.focus = cl(ST.focus + S.it.focus, 0, 1); hudMsg(S.it.label, '专注 +' + Math.round(S.it.focus * 100), 'cool', 1.6); S.glass.visible = false; S.ph = 'menu'; S.pt = 0; emit('bar', { type: 'drink', id: S.it.id }); } }
      else if (S.ph === 'listen') { if (S.pt > 1.2) { S.ph = 'menu'; S.pt = 0; } }
      if (S.tender) { S.tender.extra.lookAt = _v.set(S.a.x, S.a.y + 1.4, S.a.z).clone(); } return false; },
    late(S) { if (S.ph !== 'drink' || !S.glass) return; const k = S.k; if (S.hero.kind !== 'hero' && S.hero.bone('armR') && k > .01) { const b = S.hero.bone, L = (n, x, y, z) => { const o = b(n); o.rotation.x = lerp(o.rotation.x, x, k); o.rotation.y = lerp(o.rotation.y, y, k); o.rotation.z = lerp(o.rotation.z, z, k); }; L('armR', -1.05, .3, .5); L('foreR', -2.45, 0, 0); b('head').rotation.x -= .25 * k; }
      S.hero.world('handR', _v); if (!S.hero.bone('handR')) _v.copy(S.gp); _v.y += .05; S.glass.position.lerpVectors(S.gp, _v, cl(k * 1.6, 0, 1)); S.glass.rotation.set(-k * .9, S.a.h, 0); },
    camera(S) { const a = S.a, [fx, fz] = fwd(a.h); shoulder(S, { x: a.x, y: S.sit ? S.seat - .5 : a.y, z: a.z }, a.h, [a.x + fx * 2.2, a.y + 1.3, a.z + fz * 2.2], { dist: 2.3, side: 1.15, up: 1.72, k: .8, head: 1.3, fov: 46 }); },
    info(S) { return { sub: '日落场 · ' + stationName(GT.audio && GT.audio.station !== undefined && GT.audio.radioOn ? GT.audio.station : BARK.station), stats: [['现金', money(W.cash)], ['专注', Math.round(ST.focus * 100) + '%', S.ph === 'drink'], ['传闻', ST.bar.rumours.length + '/' + RUMOURS.length]], menu: { title: '黑板上写着', sel: S.sel, items: (S.items || BAR_MENU).map(i => ({ label: i.label, note: i.note, price: i.price !== undefined ? money(i.price) : '', off: i.off })) }, keys: [['W/S', '选择'], ['E', '就这个', S.ph !== 'menu'], ['Esc', '起身']] }; },
    end(S) { if (S.glass) S.glass.visible = false; if (S.tender) S.tender.want = 'idle'; heroPlace(S, S.a.x + fwd(S.a.h)[0] * -.45, S.a.y, S.a.z + fwd(S.a.h)[1] * -.45, S.a.h); },
    auto(S, vk) { const script = (S.arg.script) || [0, 7, 6, 4]; S.ai = S.ai || 0; if (S.ph !== 'menu' || S.ai >= script.length) return; const want = script[S.ai]; if (S.pt > .45 && S.sel !== want) { vk.tap('KeyS'); S.pt = .25; } else if (S.pt > 1.0 && S.sel === want) { vk.tap('KeyE'); S.ai++; S.pt = 0; } }
  };
  function castTender() { if (BARK.tender !== null) return BARK.tender; const a = A.fb.barTender || site('barTender'); if (!a || A.opts.cast === false) return BARK.tender = undefined; const f = npc(['bartender', 'worker'], 33, a.x, a.y, a.z, a.h); return BARK.tender = f || undefined; }

  /* ================================================================== 6. the dog */
  const DOG = { built: false, root: null, st: 'idle', x: 0, y: 0, z: 0, h: 0, tx: 0, tz: 0, t: 0, timer: 2, speed: 0, follow: 0, wag: .3, pant: 0, P: null, TP: null, ph: 0, lookAt: null, hold: false, spots: [] };
  function furTex() { return canvasTex('fur', 256, 256, (g, w, h) => { const r = GT.rng('fur'); g.fillStyle = '#bcbcbc'; g.fillRect(0, 0, w, h); for (let i = 0; i < 9000; i++) { const x = r() * w, y = r() * h, l = 4 + r() * 10, v = 120 + r() * 135 | 0; g.strokeStyle = 'rgba(' + v + ',' + v + ',' + v + ',.42)'; g.lineWidth = .6 + r() * .7; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 3, y + l); g.stroke(); } }, { repeat: true }); }
  /** lofted tube: secs = [[t, rA, rB, oA, oB], ...] along `axis` ('z' -> ring in XY, 'y' -> ring in XZ, t measured downward). col(a 0..TAU, u 0..1) -> [r,g,b] */
  function loft(axis, secs, col, M) { M = M || 12; const e0 = secs[0], e1 = secs[secs.length - 1], rr = (s, d, k, q) => [s[0] + d * s[1] * k, s[1] * q, s[2] * q, s[3], s[4]]; secs = [rr(e0, -1, .78, .5), rr(e0, -1, .42, .87)].concat(secs, [rr(e1, 1, .42, .87), rr(e1, 1, .78, .5)]);
    const pos = [], cc = [], uv = [], idx = [], n = secs.length;
    for (let i = 0; i < n; i++) { const s = secs[i], u = i / (n - 1); for (let j = 0; j <= M; j++) { const a = j / M * TAU, ca = cos(a), sa = sin(a), A_ = ca * s[1] + (s[3] || 0), B_ = sa * s[2] + (s[4] || 0); if (axis === 'z') pos.push(A_, B_, s[0]); else pos.push(A_, -s[0], B_); const c = col(a, u); cc.push(c[0], c[1], c[2]); uv.push(j / M * 5, s[0] * 16); } }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + 1, c = a + M + 1, d = c + 1; if (axis === 'z') idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); }
    for (const e of [0, n - 1]) { const s = secs[e], base = pos.length / 3, c = col(0, e ? 1 : 0); if (axis === 'z') pos.push(s[3] || 0, s[4] || 0, s[0] + (e ? 1 : -1) * s[1] * .35); else pos.push(s[3] || 0, -s[0] - (e ? 1 : -1) * s[1] * .35, s[4] || 0); cc.push(c[0], c[1], c[2]); uv.push(.5, s[0] * 9);
      for (let j = 0; j < M; j++) { const a = e * (M + 1) + j, b = a + 1; if ((axis === 'z') === (e === 0)) idx.push(base, b, a); else idx.push(base, a, b); } }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(cc, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const nr = g.attributes.normal; for (let i = 0; i < n; i++) { const a = i * (M + 1), b = a + M, x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b), l = Math.hypot(x, y, z) || 1; nr.setXYZ(a, x / l, y / l, z / l); nr.setXYZ(b, x / l, y / l, z / l); } return g; }
  function buildDog() { if (DOG.built) return DOG; DOG.built = true; const tan = C(0xb07d42), dark = C(0x5e3e22), cream = C(0xe2d0aa), white = C(0xece4d4), mix = (a, b, k) => [lerp(a.r, b.r, k), lerp(a.g, b.g, k), lerp(a.b, b.b, k)], mx3 = (c, b, k) => [lerp(c[0], b.r, k), lerp(c[1], b.g, k), lerp(c[2], b.b, k)];
    const fur = new T.MeshStandardMaterial({ vertexColors: true, map: furTex(), bumpMap: furTex(), bumpScale: .0034, roughness: .98, metalness: 0 }), M_ = (g, par, x, y, z) => { const m = new T.Mesh(g, fur); m.castShadow = true; m.receiveShadow = true; m.position.set(x || 0, y || 0, z || 0); par.add(m); return m; };
    const J = (par, x, y, z) => { const o = new T.Group(); o.position.set(x, y, z); par.add(o); return o; };
    const root = DOG.root = new T.Group(); root.name = 'activities_dog'; const flip = J(root, 0, 0, 0), body = J(flip, 0, 0, 0);
    // torso: rump (-z) to chest (+z): deep chest, tucked waist. colour: dark saddle on top, cream belly, white bib
    const patch = (a, u) => .5 + .5 * sin(a * 3 + u * 9) * sin(u * 14 + a);
    const bodyCol = (a, u) => { const up = sin(a), k = ss(up, .15, .8) * ss(u, .04, .22) * (1 - ss(u, .62, .9)), bel = ss(-up, .3, .85); let c = mix(tan, dark, k * (.62 + .25 * patch(a, u))); c = mx3(c, cream, bel * .8); return mx3(c, white, ss(u, .74, 1) * ss(-up, -.55, .35) * .85); };
    M_(loft('z', [[-.345, .04, .05, 0, .05], [-.31, .092, .105, 0, .035], [-.22, .118, .13, 0, .02], [-.08, .108, .118, 0, .022], [.05, .12, .14, 0, .002], [.17, .13, .165, 0, -.02], [.26, .118, .15, 0, -.016], [.325, .08, .1, 0, .004]], bodyCol, 18), body);
    // neck + head
    const neck = J(body, 0, .07, .29); M_(loft('z', [[-.06, .09, .115, 0, -.02], [.04, .078, .095, 0, -.006], [.13, .068, .08, 0, .004], [.18, .062, .07, 0, .008]], (a, u) => mix(tan, white, ss(-sin(a), .15, .85) * .8), 14), neck);
    const collar = new T.Mesh(new T.TorusGeometry(.076, .011, 8, 22), GT.mat('leather_tan', { color: 0x8a2a22 })); collar.position.set(0, .002, .1); collar.scale.set(1, 1.16, 1); neck.add(collar); const tag = new T.Mesh(new T.CylinderGeometry(.015, .015, .003, 12), GT.mat('chrome')); tag.rotation.x = HP; tag.position.set(0, -.103, .108); neck.add(tag);
    const head = J(neck, 0, .012, .18), hs = J(head, 0, 0, 0); hs.scale.setScalar(1.22);
    const headCol = (a, u) => { const top = ss(sin(a), -.2, .6), blaze = (1 - ss(abs(cos(a)), .0, .34)) * ss(sin(a), .1, .8); return mx3(mix(cream, tan, top), white, blaze * .75); };
    M_(loft('z', [[-.075, .046, .05, 0, .0], [-.03, .068, .07, 0, .006], [.04, .072, .068, 0, .004], [.09, .058, .052, 0, -.008], [.125, .044, .037, 0, -.017]], headCol, 16), hs);
    M_(loft('z', [[.1, .043, .035, 0, -.015], [.15, .038, .031, 0, -.019], [.2, .034, .028, 0, -.021], [.228, .027, .022, 0, -.021]], (a, u) => mix(cream, white, ss(sin(a), -.9, .4) * .5 + u * .2), 14), hs);
    const nose = new T.Mesh(new T.SphereGeometry(.018, 12, 8), GT.mat('plastic_black', { rough: .22 })); nose.position.set(0, -.012, .24); nose.scale.set(1.2, .85, .8); hs.add(nose);
    for (const s of [-1, 1]) { const eye = new T.Mesh(new T.SphereGeometry(.0135, 12, 8), GT.mat('plastic_black', { color: 0x24120a, rough: .06 })); eye.position.set(s * .041, .024, .1); hs.add(eye); const hl = new T.Mesh(new T.SphereGeometry(.0035, 6, 4), new T.MeshBasicMaterial({ color: 0xffffff })); hl.position.set(s * .041 + .004, .03, .112); hs.add(hl);
 }
    const jaw = J(hs, 0, -.03, .08); M_(loft('z', [[0, .036, .015, 0, 0], [.07, .032, .013, 0, -.002], [.135, .023, .01, 0, -.002]], () => mix(cream, white, .4), 10), jaw);
    const tongue = new T.Mesh(GT.boxGeo(.032, .006, .1, .003), new T.MeshStandardMaterial({ color: C(0xd96a78), roughness: .35 })); tongue.position.set(0, .012, .09); jaw.add(tongue); const mouth = new T.Mesh(GT.boxGeo(.05, .004, .1, .002), GT.mat('plastic_black', { color: 0x2a1512, rough: .5 })); mouth.position.set(0, -.027, .15); hs.add(mouth);
    const ears = []; for (const s of [-1, 1]) { const e = J(hs, s * .056, .052, -.016); M_(loft('y', [[0, .011, .03], [.04, .01, .042], [.095, .008, .036], [.14, .005, .015]], (a, u) => mix(dark, tan, .2 + u * .15), 10), e); ears.push(e); }
    // tail (carried up, sickle curve)
    const tail = []; let tp = J(body, 0, .075, -.335); for (let i = 0; i < 5; i++) { const r0 = .03 - i * .0046, r1 = .03 - (i + 1) * .0046; M_(loft('y', [[0, r0, r0], [.04, (r0 + r1) / 2 + .003, (r0 + r1) / 2 + .003], [.08, r1, r1]], (a, u) => i > 3 ? mix(tan, white, u) : mix(dark, tan, .55), 8), tp); tail.push(tp); if (i < 4) tp = J(tp, 0, -.075, 0); }
    // legs: thick at the shoulder / thigh, white socks fading in
    const legCol = (sock) => (a, u) => mix(tan, white, sock ? ss(u, .35, .8) : 0), paw = par => M_(loft('z', [[-.03, .026, .02], [0, .033, .027], [.04, .034, .025], [.066, .026, .017]], (a, u) => mix(white, cream, .5 + .4 * sin(a)), 10), par, 0, -.004, .004);
    const legs = []; for (const s of [1, -1]) { const sh = J(body, s * .088, -.05, .215); M_(loft('y', [[-.05, .046, .068], [.04, .042, .058], [.12, .032, .038], [.18, .0225, .025]], legCol(false), 12), sh); const el = J(sh, 0, -.185, 0); M_(loft('y', [[0, .022, .0245], [.055, .0245, .028], [.13, .021, .022], [.172, .0195, .0205]], legCol(true), 12), el); const pw = J(el, 0, -.175, 0); paw(pw); legs.push({ front: true, s, a: sh, b: el, c: pw }); }
    for (const s of [1, -1]) { const hp = J(body, s * .092, .0, -.24); M_(loft('y', [[-.06, .05, .085], [.04, .05, .078], [.12, .036, .05], [.18, .0235, .027]], legCol(false), 12), hp); const kn = J(hp, 0, -.185, 0); M_(loft('y', [[0, .023, .0265], [.055, .0255, .031], [.12, .02, .0225], [.172, .0165, .0175]], legCol(false), 12), kn); const hk = J(kn, 0, -.175, 0); M_(loft('y', [[0, .0165, .0175], [.06, .018, .019], [.122, .019, .02]], legCol(true), 10), hk); const pw = J(hk, 0, -.125, 0); paw(pw); legs.push({ front: false, s, a: hp, b: kn, c: hk, d: pw }); }
    Object.assign(DOG, { flip, body, neck, head, jaw, tongue, ears, tail, legs }); DOG.P = dogPose('idle', 0); DOG.TP = DOG.P; A.root.add(root); return DOG; }
  /* pose vector: [bodyPitch, bodyY(extra), neckX, headX, headY(yaw), headZ(roll), jaw, earL, earR, tailLift, FL.a, FL.b, FR.a, FR.b, HL.a, HL.b, HL.c, HR.a, HR.b, HR.c, flip, pawF, pawH] — leg angles: + = forward */
  function dogPose(st, t, ph) { const P = new Float32Array(24), w = sin(t * 1.3);
    P[2] = -.85; P[3] = .85; P[9] = -2.3; P[10] = P[12] = -.12; P[11] = P[13] = .2; P[14] = P[17] = .45; P[15] = P[18] = -1.2; P[16] = P[19] = .9; P[7] = P[8] = 0;
    if (st === 'sit') { P[0] = -.72; P[2] = -.55; P[3] = 1.15; P[10] = P[12] = -.72 + .04; P[11] = P[13] = .02; P[14] = P[17] = 1.92 - .72; P[15] = P[18] = -2.02; P[16] = P[19] = 1.67; P[21] = .0; P[22] = -.1; P[9] = -1.75; }
    else if (st === 'trot' || st === 'walk') { const amp = st === 'trot' ? 1 : .55; for (let i = 0; i < 2; i++) { const p = ph * TAU + (i ? PI : 0), sw = sin(p), lift = max(0, cos(p)); P[10 + i * 2] = -.12 + .5 * sw * amp; P[11 + i * 2] = .2 - .95 * lift * amp; const q = p + PI, sw2 = sin(q), lift2 = max(0, cos(q)); P[14 + i * 3] = .45 + .42 * sw2 * amp; P[15 + i * 3] = -1.2 - .5 * lift2 * amp + .2 * sw2 * amp; P[16 + i * 3] = .9 + .35 * lift2 * amp; }
      P[1] = .012 * abs(sin(ph * TAU * 2)) * amp; P[0] = .02 * sin(ph * TAU * 2); P[2] = -.7; P[3] = .72; P[9] = -2.0; P[7] = P[8] = .12 * sin(ph * TAU * 2); }
    else if (st === 'roll') { P[20] = PI; P[10] = 1.0 + .25 * sin(t * 6); P[11] = -1.5; P[12] = .9 + .25 * sin(t * 6 + 2); P[13] = -1.4; P[14] = 1.5 + .2 * sin(t * 5 + 1); P[15] = -2.0; P[16] = 1.0; P[17] = 1.3 + .25 * sin(t * 5 + 3); P[18] = -1.9; P[19] = 1.1; P[2] = -.35; P[3] = .2; P[5] = .5 * sin(t * 2.2); P[9] = -1.5; P[6] = .35; }
    else if (st === 'eat') { P[2] = .35; P[3] = .9 + .12 * sin(t * 11); P[6] = .22 + .2 * sin(t * 11); P[10] = P[12] = -.3; P[11] = P[13] = .5; P[0] = .16; P[9] = -2.0; }
    else if (st === 'beg') { P[0] = -.72; P[2] = -.75; P[3] = .85; P[10] = P[12] = -.72 + .04; P[14] = P[17] = 1.92 - .72; P[15] = P[18] = -2.02; P[16] = P[19] = 1.67; P[9] = -1.6; P[6] = .25; P[5] = .18 * w; }
    else { P[3] = .85 + .03 * w; P[5] = .06 * sin(t * .7); }
    return P; }
  function dogApply(dt) { const D = DOG, P = D.P, TP = D.TP, k = 1 - Math.exp(-9 * dt); for (let i = 0; i < 24; i++) P[i] += (TP[i] - P[i]) * k; const t = D.t;
    const pant = D.pant, br = sin(t * (pant > .3 ? 11 : 1.6)) * (pant > .3 ? .012 : .008); D.body.rotation.x = P[0]; D.body.scale.set(1 + br * 1.5, 1 + br * 1.5, 1);
    D.neck.rotation.x = P[2] + br; D.neck.rotation.y = (D.lookY || 0) * .5; D.head.rotation.set(P[3], (D.lookY || 0) * .5 + P[4], P[5] + (D.tilt || 0)); D.jaw.rotation.x = P[6] + pant * (.3 + .08 * sin(t * 11)); D.tongue.position.z = .09 + pant * .035; D.tongue.rotation.x = pant * .5; D.tongue.visible = pant > .15 || P[6] > .15;
    const tw = sin(t * 2.3) > .97 ? .25 : 0; D.ears[0].rotation.x = P[7] + tw - (D.alert || 0) * .2; D.ears[1].rotation.x = P[8] - (D.alert || 0) * .2; D.ears[0].rotation.z = .22 + (D.alert || 0) * .22; D.ears[1].rotation.z = -.22 - (D.alert || 0) * .22;
    const wag = sin(t * (6 + D.wag * 9)) * (.25 + D.wag * .75); D.tail[0].rotation.x = -P[9]; D.tail[0].rotation.z = wag * .5; for (let i = 1; i < 5; i++) { D.tail[i].rotation.x = .2; D.tail[i].rotation.z = wag * .32; } if (P[20] < .5) D.body.rotation.y = wag * .05 * D.wag; else D.body.rotation.y = 0;
    for (let i = 0; i < 4; i++) { const L = D.legs[i]; if (L.front) { const o = 10 + (L.s > 0 ? 0 : 2); L.a.rotation.x = -(P[o]) - 0; L.b.rotation.x = -P[o + 1]; L.c.rotation.x = P[o] + P[o + 1] - P[0] + P[21]; } else { const o = 14 + (L.s > 0 ? 0 : 3); L.a.rotation.x = -P[o]; L.b.rotation.x = -P[o + 1]; L.c.rotation.x = -P[o + 2]; L.d.rotation.x = P[o] + P[o + 1] + P[o + 2] - P[0] + P[22]; } }
    // ground the lowest paws; the roll pivots about the torso axis
    D.body.position.y = 0; D.flip.position.y = 0; D.flip.rotation.z = 0; D.root.updateMatrixWorld(true); let low = 1e9; for (const L of D.legs) { const pw = L.front ? L.c : L.d; pw.getWorldPosition(_v); D.root.worldToLocal(_v); low = min(low, _v.y - .034); }
    D.flip.rotation.z = P[20]; D.flip.position.y = lerp(-low + P[1], .145, ss(P[20], .2, 2.4));
    D.root.position.set(D.x, D.y, D.z); D.root.rotation.y = D.h; }
  /** per-frame dog brain. hp = hero position {x,z} or null */
  function dogUpdate(dt, hp) { const D = DOG; if (!D.built) return; D.t += dt; D.follow = max(0, D.follow - dt); const home = site('dogHome') || { x: 0, z: 0, y: 0 }, dH = hp ? Math.hypot(hp.x - D.x, hp.z - D.z) : 99;
    let st = D.st; if (!D.hold) { D.timer -= dt;
      if (D.follow > 0 && hp) { if (dH > 2.0) { D.tx = hp.x; D.tz = hp.z; st = 'trot'; } else if (st === 'trot' || st === 'walk') { st = D.t % 9 < 5 ? 'sit' : 'idle'; D.timer = 3; } D.pantT = 1; }
      else if (st === 'trot' || st === 'walk') { if (Math.hypot(D.tx - D.x, D.tz - D.z) < .25) { st = A.rnd() < .4 ? 'sit' : 'idle'; D.timer = 2.5 + A.rnd() * 4; D.pantT = A.rnd() < .5 ? 2.5 : 0; } }
      else if (D.timer <= 0) { const r = A.rnd(); D.tx = home.x + (A.rnd() - .5) * 1.5; D.tz = home.z + (A.rnd() - .5) * 18; if (ground(D.tx, D.tz) > ground(home.x, home.z) + .2) D.tx = home.x; st = r < .65 ? 'walk' : 'trot'; } }
    D.st = st; const moving = st === 'trot' || st === 'walk';
    if (moving) { const sp = st === 'trot' ? (D.follow > 0 ? cl(dH * 1.2, 2.2, 4.2) : 2.3) : .95, th = Math.atan2(D.tx - D.x, D.tz - D.z); D.h += angDiff(D.h, th) * (1 - Math.exp(-7 * dt)); D.x += sin(D.h) * sp * dt; D.z += cos(D.h) * sp * dt; D.ph = (D.ph + dt * sp / (st === 'trot' ? .62 : .42)) % 1; D.speed = sp; } else D.speed = 0;
    D.y = ground(D.x, D.z); D.pantT = max(0, (D.pantT || 0) - dt); D.pant = ease(D.pant, (D.pantT > 0 || st === 'trot') ? 1 : 0, 4, dt); if (D.pant > .6 && !moving && (D.t % 1.6) < dt && dH < 8) snd('pant', { g: .4 });
    // attention: look at the hero when close
    let ly = 0; if (hp && dH < 7 && !moving) { ly = cl(angDiff(D.h, Math.atan2(hp.x - D.x, hp.z - D.z)), -1.1, 1.1); if (abs(ly) > 1 && !D.hold && st !== 'roll') D.h += angDiff(D.h, Math.atan2(hp.x - D.x, hp.z - D.z)) * dt * 2; } D.lookY = ease(D.lookY || 0, ly, 5, dt); D.alert = ease(D.alert || 0, hp && dH < 5 ? 1 : 0, 3, dt);
    D.wag = ease(D.wag, D.hold ? D.wagT || .8 : D.follow > 0 ? .7 : (hp && dH < 4 ? .5 : .12), 3, dt); D.TP = dogPose(st, D.t, D.ph); dogApply(dt);
    for (const s of D.spots) { s.x = D.x; s.z = D.z; s.y = D.y; } }
  const DOG_LINES = { pet: ['它把脑袋顶进你手心里。', '尾巴扫起一小片沙。', '它眯起眼，像是认识你很久了。'], roll: ['四脚朝天，毫无防备。'], feed: ['两口就没了，然后看着你。', '它决定今天跟你混。'], none: ['口袋里没有吃的。它看穿了。'] };
  ACT.dog = { name: '堤上的黄狗',
    start(S) { const D = buildDog(); S.mode = (S.arg.mode) || 'pet'; D.hold = true; S.ph = 'come'; S.pt = 0; S.love = 0; S.fed = false; const o = S.origin, h = Math.atan2(D.x - o.x, D.z - o.z); S.hh = h; S.o = { x: o.x, y: ground(o.x, o.z) || o.y, z: o.z }; if (S.origin.y !== undefined && abs(S.origin.y - S.o.y) > .05) S.o.y = S.origin.y; heroPlace(S, o.x, S.o.y, o.z, h); heroAnim(S, 'idle'); D.tx = o.x + sin(h) * .78; D.tz = o.z + cos(h) * .78; D.st = 'trot'; D.wagT = .7; snd('bark', { g: .6, n: 1 }); },
    update(S, dt, inp) { const D = DOG; S.pt += dt; const o = S.o;
      if (S.ph === 'come') { const d = Math.hypot(D.tx - D.x, D.tz - D.z); if (d < .12 || S.pt > 4) { D.st = 'sit'; S.ph = 'pet'; S.pt = 0; D.h = Math.atan2(o.x - D.x, o.z - D.z); } heroAnim(S, 'idle'); }
      else if (S.ph === 'pet') { D.h += angDiff(D.h, Math.atan2(o.x - D.x, o.z - D.z)) * (1 - Math.exp(-6 * dt)); const petting = inp.down('Space') || inp.down('KeyE') || inp.down('Mouse0'); heroAnim(S, 'pet', {}); D.wagT = petting ? 1 : .6; D.tilt = ease(D.tilt || 0, petting ? .28 : 0, 4, dt); D.pantT = S.love > .4 ? 1 : 0;
        if (petting) { S.love = min(1, S.love + dt / 3.2); if ((S.pt % .9) < dt) snd('pant', { g: .3 }); } if (S.love >= 1 && !S.rolled) { S.rolled = true; D.st = 'roll'; S.ph = 'roll'; S.pt = 0; ST.dog.pets++; ST.dog.bond = cl(ST.dog.bond + .12, 0, 1); addKarma(.03, '陪狗玩了一会儿'); snd('bark', { g: .5, n: 2 }); hudMsg('它翻了肚皮', DOG_LINES.roll[0], 'good', 2.2); emit('dog', { type: 'pet', bond: ST.dog.bond }); }
        else if (S.love > .5 && !S.said) { S.said = true; hudMsg('摸摸', DOG_LINES.pet[ST.dog.pets % 3], 'cool', 1.8); }
        if (inp.pressed('KeyF')) dogFeed(S); }
      else if (S.ph === 'roll') { heroAnim(S, 'pet', {}); D.wagT = 1; if (S.pt > 3.2) { D.st = 'sit'; S.ph = 'pet2'; S.pt = 0; } if (inp.pressed('KeyF')) dogFeed(S); }
      else if (S.ph === 'pet2') { heroAnim(S, 'pet', {}); D.wagT = .8; if (inp.pressed('KeyF')) dogFeed(S); if (S.pt > 6 && A.auto) return true; }
      else if (S.ph === 'feed') { heroAnim(S, 'pet', {}); D.st = 'eat'; D.wagT = 1; if ((S.pt % .35) < dt && S.pt < 2) snd('tick', { g: .5 }); if (S.pt > 2.4) { D.st = 'beg'; S.ph = 'pet2'; S.pt = 0; snd('bark', { g: .7, n: 2 }); hudMsg('吃完了', DOG_LINES.feed[ST.dog.feeds % 2], 'good', 2); } }
      return false; },
    camera(S) { const D = DOG, o = S.o, [fx, fz] = fwd(S.hh), [rx, rz] = rgt(S.hh); S.ct.pos = [o.x - fx * 1.55 + rx * 1.75, o.y + .95, o.z - fz * 1.55 + rz * 1.75]; S.ct.look = [lerp(o.x, D.x, .62), o.y + .52, lerp(o.z, D.z, .62)]; S.ct.fov = 44; camClear(S, o.x, o.z); },
    info(S) { return { sub: S.ph === 'come' ? '它小跑过来了' : S.ph === 'feed' ? '吃得很认真' : '没有项圈牌子上的名字，只有一道划痕', stats: [['亲近', Math.round(ST.dog.bond * 100) + '%', S.ph === 'roll'], ['零食', '×' + A.inv.snack], ['摸过', ST.dog.pets + ' 次']], keys: [['Space', '按住 摸狗'], ['F', '喂（零食 ×' + A.inv.snack + '）', !A.inv.snack], ['Esc', '起身']] }; },
    draw(S, g, w, h) { G.panel(g, 90, 30, w - 180, 44); G.label(g, '亲近', 112, 52); G.bar(g, 154, 49, w - 180 - 90, 6, S.love, '#ffb454'); },
    end(S) { const D = DOG; D.hold = false; D.st = 'idle'; D.tilt = 0; D.timer = 3; D.follow = S.fed ? 60 : S.rolled ? 25 : 6; heroPlace(S, S.o.x, S.o.y, S.o.z, S.hh); if (D.follow > 10) toast('黄狗', '它跟上来了。'); S.result = { fed: S.fed, rolled: !!S.rolled }; },
    auto(S, vk) { const sc = S.mode; if (S.ph === 'pet') { vk.hold('Space', S.pt > .5); if (sc === 'feed' && S.pt > 1.2 && !S.fed) vk.tap('KeyF'); } else { vk.hold('Space', false); if (S.ph === 'pet2' && sc === 'both' && !S.fed && S.pt > 1) vk.tap('KeyF'); } }
  };
  function dogFeed(S) { if (S.fed) return; if (A.inv.snack <= 0) { hudMsg('没有吃的', DOG_LINES.none[0], 'bad', 1.6); snd('ui_bad', { g: .5 }); return; } A.inv.snack--; S.fed = true; S.ph = 'feed'; S.pt = 0; ST.dog.feeds++; ST.dog.bond = cl(ST.dog.bond + .2, 0, 1); addKarma(.05, '喂了流浪狗'); emit('dog', { type: 'feed', bond: ST.dog.bond }); }

  /* ================================================================== 7. binoculars */
  const BINO = { built: false, pc: new T.PerspectiveCamera(10, 16 / 9, .1, 3000), tags: {}, canvas: null, prop: null };
  /** register a point of interest for the binoculars. poi = { id, kind: 'clerk' | 'camera' | 'patrol' | 'door' | ..., label, note?, pos: {x,y,z} | () => {x,y,z} } */
  function addPOI(poi) { if (!poi || !poi.id) return null; const i = A.pois.findIndex(p => p.id === poi.id); if (i >= 0) A.pois[i] = poi; else A.pois.push(poi); return poi; }
  function defaultPOIs() { const an = n => GT.world.anchors[n], L = GT.L && GT.L.station, st = L && L.store; if (!st) return;
    const reg = an('register') || { x: st.x0 + 6, z: st.doorZ + 4 }; addPOI({ id: 'clerk', kind: 'clerk', label: '店员', note: '柜台后 · 一个人', pos: { x: reg.x + .9, y: 1.45, z: reg.z } });
    addPOI({ id: 'cam_door', kind: 'camera', label: '门口探头', note: '朝着加油岛', pos: { x: st.x0 - .14, y: 3.16, z: st.doorZ + 1.1 } });
    if (L.canopy) addPOI({ id: 'cam_canopy', kind: 'camera', label: '油棚探头', note: '西北角 · 广角', pos: { x: L.canopy.x - L.canopy.w / 2 + .6, y: L.canopy.h - .16, z: L.canopy.z - L.canopy.d / 2 + .6 } });
    addPOI({ id: 'cam_counter', kind: 'camera', label: '柜台探头', note: '对着收银机', pos: { x: reg.x + .1, y: 2.75, z: reg.z - 2.55 } });
    const door = an('storeDoor') || { x: st.x0, z: st.doorZ }; addPOI({ id: 'door_front', kind: 'door', label: '正门', note: '自动门 · 朝西', pos: { x: door.x + 1, y: 1.2, z: door.z } });
    const back = an('storeBackDoor'); if (back) addPOI({ id: 'door_back', kind: 'door', label: '后门', note: '员工通道', pos: { x: back.x, y: 1.2, z: back.z } });
    const pc = an('patrolCar'); if (pc) addPOI({ id: 'patrol', kind: 'patrol', label: '巡逻车', note: '停着 · 没熄火', pos: { x: pc.x, y: .9, z: pc.z } }); }
  const poiPos = (p, out) => { const q = typeof p.pos === 'function' ? p.pos() : p.pos; return out.set(q.x, q.y === undefined ? 1.2 : q.y, q.z); };
  function binoDom() { if (BINO.built) return; BINO.built = true; hudInit(); const e = HUD.el.bino;
    e.innerHTML = '<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><defs><filter id="ga-bl" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter>' +
      '<radialGradient id="ga-vg" cx="50%" cy="50%" r="50%"><stop offset="72%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".55"/></radialGradient></defs>' +
      '<ellipse cx="800" cy="450" rx="700" ry="430" fill="url(#ga-vg)"/>' +
      '<mask id="ga-mk"><rect x="-100" y="-100" width="1800" height="1100" fill="#fff"/><circle cx="600" cy="450" r="392" fill="#000"/><circle cx="1000" cy="450" r="392" fill="#000"/></mask><g filter="url(#ga-bl)"><rect x="-100" y="-100" width="1800" height="1100" fill="#020303" mask="url(#ga-mk)"/></g>' +
      '<g stroke="#f1ede4" stroke-width="1.4" fill="none" opacity=".8"><circle cx="800" cy="450" r="26"/><path d="M800 396v36M800 468v36M746 450h36M818 450h36"/><path d="M640 450h60M900 450h60" opacity=".5"/>' +
      '<path d="M700 444v12M720 446v8M740 446v8M760 446v8M840 446v8M860 446v8M880 446v8M900 444v12" opacity=".5"/><path class="ga-arc" d="" stroke="#ffb454" stroke-width="3"/></g>' +
      '<g class="ga-comp" fill="#f1ede4" font-family="ui-monospace,Menlo,monospace" font-size="15" text-anchor="middle" opacity=".8"></g></svg><div class="ga-list"></div><div class="ga-read"></div><div class="ga-tags"></div>';
    BINO.arc = e.querySelector('.ga-arc'); BINO.comp = e.querySelector('.ga-comp'); BINO.list = e.querySelector('.ga-list'); BINO.read = e.querySelector('.ga-read'); BINO.tagBox = e.querySelector('.ga-tags'); }
  function binoProp() { if (BINO.prop) return BINO.prop; const k = GT.kit(), m = GT.mat('plastic_black', { rough: .7 }); for (const s of [-1, 1]) { k.cyl(m, .024, .021, .085, s * .034, 0, .0, { seg: 14, rx: HP }); k.cyl(m, .03, .026, .05, s * .036, 0, .065, { seg: 14, rx: HP }); k.cyl('glass_tint', .026, .026, .004, s * .036, 0, .091, { seg: 14, rx: HP }); k.cyl('rubber', .019, .022, .02, s * .034, 0, -.05, { seg: 12, rx: HP }); }
    k.box(m, .03, .022, .05, 0, .006, .0, { bevel: .006 }); k.cyl('metal_dark', .012, .012, .02, 0, .02, .0, { seg: 10 }); const g = k.build(); g.visible = false; A.root.add(g); return BINO.prop = g; }
  const compass = d => ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(d / 45) % 8];
  ACT.binoculars = { name: '望远镜',
    start(S) { binoDom(); if (!A.pois.length) defaultPOIs(); const o = S.origin, ov = S.arg.overlook !== undefined ? site('overlook' + S.arg.overlook) : null; S.o = ov || { x: o.x, y: o.y, z: o.z, h: o.h }; if (S.ctl && S.ctl.camera && !ov && S.arg.yaw === undefined) S.o.h = S.ctl.camera.yaw !== undefined ? S.ctl.camera.yaw : S.o.h;
      S.yaw = S.arg.yaw !== undefined ? S.arg.yaw : S.o.h; S.pitch = S.arg.pitch || 0; S.fov = 13; S.fovT = S.arg.fov || 13; S.ph = 'raise'; S.pt = 0; S.blur = 0; S.dwell = {}; S.prog = 0; S.cur = null; S.pv = 0; S.eyeY = (S.hero.height || 1.78) * .925; BINO.canvas = A.opts.canvas || (GT.render && GT.render.renderer && GT.render.renderer.domElement) || (A.camera && document.querySelector('canvas')) || null;
      heroPlace(S, S.o.x, S.o.y, S.o.z, S.yaw); heroAnim(S, 'binoc'); S.prop = binoProp(); S.prop.visible = true; S.tagged0 = A.scouted.length; snd('ui_tick'); },
    update(S, dt, inp) { S.pt += dt; const o = S.o;
      if (S.ph === 'raise') { if (S.pt > .55) { S.ph = 'view'; S.pt = 0; S.cut = true; HUD.el.bino.classList.add('show'); S.hero.group.visible = false; S.hideHero = true; S.blur = 3.5; snd('shutter', { g: .5 }); } return false; }
      const z = S.fov / 13, ax = inp.axis ? inp.axis() : { x: 0, y: 0 }, lk = inp.look || { dx: 0, dy: 0 }; let dy = (lk.dx || 0) * z * .5 + ax.x * dt * .55 * z, dp = -(lk.dy || 0) * z * .5 + ax.y * dt * .4 * z; if (inp.down('ArrowLeft')) dy -= dt * .55 * z; if (inp.down('ArrowRight')) dy += dt * .55 * z; if (inp.down('ArrowUp')) dp += dt * .4 * z; if (inp.down('ArrowDown')) dp -= dt * .4 * z;
      if (S.autoAim) { dy = S.autoAim[0]; dp = S.autoAim[1]; }
      S.yaw -= dy; S.pitch = cl(S.pitch + dp, -.5, .45); const wh = inp.wheel || 0; if (wh) S.fovT *= wh > 0 ? 1.18 : .85; if (inp.down('KeyZ') || inp.down('KeyQ')) S.fovT *= 1 - dt * 1.3; if (inp.down('KeyX') || inp.down('KeyR')) S.fovT *= 1 + dt * 1.3; S.fovT = cl(S.fovT, 3.6, 20);
      const pf = S.fov; S.fov = ease(S.fov, S.fovT, 7, dt); S.pv = ease(S.pv, (abs(dy) + abs(dp)) / max(dt, 1e-3) / max(z, .2), 8, dt); S.blur = ease(S.blur, cl(S.pv * 1.4 + abs(S.fov - pf) / max(dt, 1e-3) * .12, 0, 5), S.blur > 1 ? 2.2 : 5, dt);
      // what is under the reticle?
      const [fx, fz] = fwd(S.yaw), cp = cos(S.pitch), dir = _v.set(fx * cp, sin(S.pitch), fz * cp), eye = _v2.set(o.x, o.y + S.eyeY, o.z); let best = null, bd = S.fov * PI / 180 * .11; S.dist = 0;
      for (const p of A.pois) { const q = poiPos(p, V3()).sub(eye), d = q.length(), a = Math.acos(cl(q.dot(dir) / d, -1, 1)); if (a < bd && d < 420) { bd = a; best = p; S.dist = d; } }
      if (best !== S.cur) { S.cur = best; S.prog = 0; if (best && !BINO.tags[best.id]) snd('tick', { g: .8 }); }
      const hold = inp.down('Space') || inp.down('Mouse0') || inp.down('KeyE');
      if (best && !BINO.tags[best.id]) { S.prog += dt / (hold ? .7 : 2.4); if (S.prog >= 1) binoTag(S, best); } else S.prog = 0;
      heroPlace(S, o.x, o.y, o.z, S.yaw); return false; },
    camera(S, dt) { const o = S.o; if (S.ph === 'raise') { const [fx, fz] = fwd(S.yaw); shoulder(S, o, S.yaw, [o.x + fx * 6, o.y + 1.6, o.z + fz * 6], { dist: lerp(2.2, 1.0, ss(S.pt, .1, .55)), side: .5, up: 1.7, k: .7, fov: 44 }); return; }
      const [fx, fz] = fwd(S.yaw), cp = cos(S.pitch), br = sin(S.t * .9) * .0016 + sin(S.t * 2.3) * .0007, bx = sin(S.t * 1.3) * .0012; S.camRate = 30;
      const ey = o.y + S.eyeY, ex = o.x + fx * .12, ez = o.z + fz * .12, dx = fx * cp + bx * fz, dyy = sin(S.pitch + br), dz = fz * cp - bx * fx; S.ct.pos = [ex, ey, ez]; S.ct.look = [ex + dx * 50, ey + dyy * 50, ez + dz * 50]; S.ct.fov = S.fov * (1 + sin(S.t * .7) * .012 + S.blur * .004); },
    late(S, dt) { const pr = S.prop, o = S.o; if (S.ph === 'raise') { S.hero.world('handR', _v); const hl = S.hero.world('handL', _v2); if (S.hero.bone('handR')) pr.position.copy(_v).lerp(hl, .5); else pr.position.set(o.x, o.y + 1.5, o.z); pr.rotation.set(0, S.yaw, 0); return; }
      pr.visible = false; S.hero.group.visible = false; if (BINO.canvas) BINO.canvas.style.filter = S.blur > .12 ? 'blur(' + S.blur.toFixed(2) + 'px)' : '';
      // project the points of interest with our own copy of the camera (independent of who applies the real one)
      const c = BINO.pc, cm = S.cam || S.ct; c.fov = cm.fov; c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); c.position.set(cm.pos[0], cm.pos[1], cm.pos[2]); c.lookAt(cm.look[0], cm.look[1], cm.look[2]); c.updateMatrixWorld(true);
      let html = ''; for (const p of A.pois) { const q = poiPos(p, _v).project(c); if (q.z > 1 || abs(q.x) > .78 || abs(q.y) > .8) continue; const done = !!BINO.tags[p.id], cur = S.cur === p, x = (q.x * .5 + .5) * 100, y = (-q.y * .5 + .5) * 100;
        html += '<div class="ga-dot' + (done ? ' done' : '') + '" style="left:' + x.toFixed(2) + '%;top:' + y.toFixed(2) + '%"></div>'; if (done || cur) html += '<div class="ga-tag' + (done ? ' done' : '') + '" style="left:' + x.toFixed(2) + '%;top:' + y.toFixed(2) + '%">' + esc(p.label) + '<small>' + esc(done ? (p.note || '') : '按住 Space 标记') + '</small></div>'; }
      if (BINO.tagHtml !== html) { BINO.tagHtml = html; BINO.tagBox.innerHTML = html; }
      const a = S.cur && !BINO.tags[S.cur.id] ? S.prog : 0, r = 34, a1 = -HP + a * TAU; BINO.arc.setAttribute('d', a > .01 ? 'M800 ' + (450 - r) + 'A' + r + ' ' + r + ' 0 ' + (a > .5 ? 1 : 0) + ' 1 ' + (800 + cos(a1) * r).toFixed(1) + ' ' + (450 + sin(a1) * r).toFixed(1) : '');
      const deg = ((S.yaw * 180 / PI) % 360 + 360) % 360, read = '方位 ' + String(Math.round(deg)).padStart(3, '0') + '° ' + compass(deg) + '  ·  ' + (65 / S.fov).toFixed(1) + '×  ·  ' + (S.cur ? '距离 ' + S.dist.toFixed(0) + ' m' : '距离 ——'); if (BINO.readT !== read) { BINO.readT = read; BINO.read.textContent = read; }
      const kinds = { clerk: '人', camera: '探头', patrol: '巡逻', door: '出入口' }, lst = '<b>已标记 ' + A.scouted.length + '</b>' + A.pois.map(p => '<div class="' + (BINO.tags[p.id] ? 'done' : '') + '"><span>' + (BINO.tags[p.id] ? '◆ ' : '◇ ') + esc(kinds[p.kind] || p.kind) + ' · ' + esc(BINO.tags[p.id] ? p.label : '——') + '</span></div>').join(''); if (BINO.listT !== lst) { BINO.listT = lst; BINO.list.innerHTML = lst; } },
    info(S) { return { sub: S.ph === 'raise' ? '举起来' : '把准星压在可疑的东西上', stats: [], keys: S.ph === 'raise' ? [] : [['鼠标/A/D', '转动'], ['滚轮/Z/X', '变焦'], ['Space', '按住标记'], ['Esc', '放下']] }; },
    end(S) { HUD.el.bino.classList.remove('show'); if (BINO.canvas) BINO.canvas.style.filter = ''; S.prop.visible = false; S.hero.group.visible = true; heroPlace(S, S.o.x, S.o.y, S.o.z, S.yaw); S.result = { tagged: A.scouted.length - S.tagged0, scouted: A.scouted }; if (A.scouted.length > S.tagged0) toast('踩点', '记下了 ' + (A.scouted.length - S.tagged0) + ' 处，动手的时候用得上。'); },
    auto(S, vk) { if (S.ph !== 'view') return; const list = (S.arg.targets || ['cam_door', 'clerk', 'cam_canopy', 'patrol']).map(id => A.pois.find(p => p.id === id)).filter(Boolean); S.ai = S.ai || 0; while (S.ai < list.length && BINO.tags[list[S.ai].id] && !(S.arg.stay && S.ai === list.length - 1)) S.ai++; const tg = list[min(S.ai, list.length - 1)]; if (!tg) return;
      const o = S.o, q = poiPos(tg, V3()), wy = Math.atan2(q.x - o.x, q.z - o.z), wp = Math.atan2(q.y - (o.y + S.eyeY), Math.hypot(q.x - o.x, q.z - o.z)), ey = angDiff(S.yaw, wy), ep = wp - S.pitch, k = min(1, S.dt * 3.2); S.autoAim = [-ey * k, ep * k]; vk.hold('Space', abs(ey) < .004 && abs(ep) < .004); S.fovT = S.arg.fov || cl(520 / Math.hypot(q.x - o.x, q.z - o.z), 4.5, 13); }
  };
  function binoTag(S, p) { const q = poiPos(p, V3()); BINO.tags[p.id] = true; const rec = { id: p.id, kind: p.kind, label: p.label, note: p.note || '', x: q.x, y: q.y, z: q.z, time: A.time, hours: GT.env ? GT.env.hours : 0 }; A.scouted.push(rec); ST.scout.tagged = A.scouted.length; S.prog = 0; snd('shutter'); snd('ui_ok', { g: .5 }); emit('scout', rec); }

  /* ================================================================== 8. backyard match */
  const FIGHTERS = [{ id: 'mo', name: '“铁锚”老莫', tag: '老将 · 力气大，喘得快', pub: .58, real: .47, type: 'worker', seed: 41 }, { id: 'di', name: '“海蛇”小迪', tag: '新人 · 快，下盘不稳', pub: .42, real: .53, type: 'jogger', seed: 52 }];
  const STAKES = [0, 5, 10, 20, 50], RING = { cast: null };
  function ringCast() { if (RING.cast) return RING.cast; const c = site('ringCentre'); if (!c) return null; const w = FIGHTERS.map((f, i) => npc(['wrestler', f.type], f.seed, c.x + (i ? .9 : -.9), c.y, c.z, i ? -HP : HP)).filter(Boolean), crowd = [];
    if (A.opts.cast !== false) sites('ringSide', 8).forEach((s, i) => { if (i === 0 || i > 6) return; const f = npc([['local_m', 'tourist'], ['beach_m', 'skater'], ['local_f', 'sundress'], ['patron_m', 'oldman'], ['beach_f', 'jogger'], ['patron_f', 'worker']][i % 6], 60 + i, s.x, s.y, s.z, Math.atan2(c.x - s.x, c.z - s.z)); if (f) { f.side = i; crowd.push(f); } });
    return RING.cast = { w, crowd, c }; }
  function ringIdle(dt) { const R = RING.cast; if (!R || (A.active && A.active.id === 'ring')) return; R.w.forEach((f, i) => { f.want = 'idle'; f.extra.lookAt = null; }); for (const f of R.crowd) f.want = f.seed % 3 ? 'idle' : 'talk'; }
  const ODDS = p => Math.max(1.1, Math.round(.92 / p * 20) / 20);
  ACT.ring = { name: '沙滩拳台 · 后院局',
    start(S) { const R = S.R = ringCast(); if (!R || R.w.length < 2) return false; const sides = sites('ringSide', 8), a = S.arg.side !== undefined ? sides[S.arg.side] : (sides.length ? sides[nearestIdx(sides, S.origin)] : { x: R.c.x + 3.4, y: ground(R.c.x + 3.4, R.c.z), z: R.c.z }); S.a = a; S.h = Math.atan2(R.c.x - a.x, R.c.z - a.z);
      heroPlace(S, a.x, a.y, a.z, S.h); heroAnim(S, 'idle'); S.ph = 'bet'; S.pt = 0; S.pick = 0; S.stake = 2; S.round = 0; ringReset(S); for (const f of R.crowd) f.hiddenBy = Math.hypot(f.group.position.x - a.x, f.group.position.z - a.z) < .8; for (const f of R.crowd) f.group.visible = !f.hiddenBy; },
    update(S, dt, inp) { const R = S.R, c = R.c; S.pt += dt; S.shake = max(0, (S.shake || 0) - dt * 2.5);
      if (S.ph === 'bet') { heroAnim(S, 'idle'); if (anyPressed(inp, K_L)) { S.pick = 0; snd('ui_tick'); } else if (anyPressed(inp, K_R)) { S.pick = 1; snd('ui_tick'); } else if (anyPressed(inp, K_U)) { S.stake = min(STAKES.length - 1, S.stake + 1); snd('ui_tick'); } else if (anyPressed(inp, K_D)) { S.stake = max(0, S.stake - 1); snd('ui_tick'); }
        else if (anyPressed(inp, K_OK) || anyPressed(inp, K_GO)) { const st = STAKES[S.stake]; if (st > 0 && !W.spend(st)) { snd('ui_bad'); hudMsg('钱不够', '押 ' + money(st), 'bad', 1.4); } else { S.bet = st; S.odds = ODDS(FIGHTERS[S.pick].pub); if (st > 0) ST.ring.bets++; ST.ring.watched++; S.ph = 'fight'; S.pt = 0; snd('bell'); snd('crowd', { g: .6, d: 1.6 }); if (st > 0) say('庄家', '押' + FIGHTERS[S.pick].name.replace(/[“”]/g, '') + '，' + money(st) + '，落手无悔。'); } }
        ringPose(S, dt, 0); }
      else if (S.ph === 'fight') { S.ft += dt; S.xt -= dt; const F = S.F;
        if (!S.fin && S.xt <= 0) { // next exchange
          if (F[0].hp <= 0 || F[1].hp <= 0 || S.ft > 15.5) { S.fin = true; S.winner = F[0].hp === F[1].hp ? (S.rnd() < .5 ? 0 : 1) : (F[0].hp > F[1].hp ? 0 : 1); S.fint = 0; S.shake = 1; snd('slam'); snd('crowd', { g: 1, d: 2.2 }); for (const f of R.crowd) f.cheerT = 2.5; }
          else { const att = S.rnd() < S.pReal ? 0 : 1, big = S.rnd() < .28; S.ex = { att, t: 0, big, hit: false }; S.xt = big ? 2.3 : 1.55 + S.rnd() * .5; } }
        if (S.ex && !S.fin) { const e = S.ex; e.t += dt; if (!e.hit && e.t > .42) { e.hit = true; const d = F[1 - e.att]; d.hp = max(0, d.hp - (e.big ? .3 : .17)); d.stag = e.big ? 1 : .6; S.shake = e.big ? .8 : .35; snd(e.big ? 'slam' : 'kick', { g: e.big ? .8 : .5 }); if (e.big || S.rnd() < .5) { snd('crowd', { g: e.big ? .8 : .4, d: 1 }); for (const f of R.crowd) if (S.rnd() < (e.big ? .9 : .4)) f.cheerT = 1.2; } emit('ring', { type: 'hit', attacker: FIGHTERS[e.att].id, big: e.big }); } }
        if (S.fin) { S.fint += dt; const n = S.fint < 1.2 ? 0 : min(3, 1 + Math.floor((S.fint - 1.2) / .75)); if (n !== S.count) { S.count = n; if (n > 0) { snd('thunk', { g: .8 }); hudMsg(['', '一', '二', '三'][n] + '！', '', 'cool', .7); } } if (S.fint > 3.9) ringResult(S); }
        heroAnim(S, S.shake > .4 || (S.fin && S.bet > 0 && S.winner === S.pick) ? 'cheer' : 'idle'); ringPose(S, dt, 1); }
      else if (S.ph === 'result') { heroAnim(S, S.won ? 'cheer' : 'idle'); ringPose(S, dt, 2); if (S.pt > 4.5 && (anyPressed(inp, K_OK) || anyPressed(inp, K_GO) || A.auto && S.pt > 6)) { if (A.auto) return true; S.ph = 'bet'; S.pt = 0; S.round++; ringReset(S); } }
      for (const f of R.crowd) { f.cheerT = max(0, (f.cheerT || 0) - dt); f.want = f.cheerT > 0 ? 'cheer' : (f.seed % 3 ? 'idle' : 'talk'); f.extra.lookAt = V3((R.w[0].group.position.x + R.w[1].group.position.x) / 2, c.y + 1.2, (R.w[0].group.position.z + R.w[1].group.position.z) / 2); }
      return false; },
    camera(S) { const R = S.R, a = S.a, m = [(R.w[0].group.position.x + R.w[1].group.position.x) / 2, R.c.y + 1.05, (R.w[0].group.position.z + R.w[1].group.position.z) / 2]; shoulder(S, a, S.h, m, { dist: 2.5, side: 1.35, up: 1.95, k: .8, fov: 46 }); const sh = (S.shake || 0) * sin(S.t * 47) * .025; S.ct.pos[1] += sh; S.ct.look[1] += sh * 2; camClear(S); },
    info(S) { const f = FIGHTERS, st = STAKES[S.stake]; if (S.ph === 'bet') return { sub: '第 ' + (S.round + 1) + ' 场 · 庄家抽水，赔率写在纸板上', stats: [['现金', money(W.cash)], ['押注', st ? money(st) : '只看', st > 0], ['可赢', st ? money(st * ODDS(f[S.pick].pub)) : '—']],
          menu: { title: '押谁', sel: S.pick, items: f.map(x => ({ label: x.name, note: x.tag, price: '赔 ' + ODDS(x.pub).toFixed(2) })) }, keys: [['A/D', '选人'], ['W/S', '加减注'], ['E', st ? '下注开打' : '不押，看一场'], ['Esc', '走人']] };
      return { sub: S.ph === 'fight' ? (S.bet ? '押了 ' + f[S.pick].name + ' ' + money(S.bet) : '只看不押') : '散场了', stats: [['现金', money(W.cash)], ['输赢', (ST.ring.net >= 0 ? '+' : '−') + money(abs(ST.ring.net)), ST.ring.net > 0], ['看过', ST.ring.watched + ' 场']], keys: S.ph === 'result' ? [['E', '再来一场'], ['Esc', '走人']] : [['Esc', '走人（押注不退）']] }; },
    draw(S, g, w, h) { if (S.ph === 'bet') { G.panel(g, 60, 26, w - 120, 46); G.label(g, '押注', 82, 49); STAKES.forEach((s, i) => { const x = 130 + i * 52; g.fillStyle = i === S.stake ? '#ffb454' : 'rgba(255,255,255,.12)'; g.fillRect(x, 38, 46, 22); G.label(g, s ? '$' + s : '不押', x + 23, 49.5, { align: 'center', c: i === S.stake ? '#14161a' : 'rgba(241,237,228,.8)', w: 600 }); }); return; }
      G.panel(g, 0, 8, w, 72); const F = S.F, bw = (w - 110) / 2; for (let i = 0; i < 2; i++) { const x = i ? w - 30 - bw : 30, mine = S.bet > 0 && S.pick === i; G.label(g, FIGHTERS[i].name + (mine ? '  ◆' : ''), i ? w - 30 : 30, 24, { align: i ? 'right' : 'left', c: mine ? '#ffb454' : undefined }); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, 36, bw, 9); g.fillStyle = F[i].hp < .3 ? '#ff8f7c' : '#f1ede4'; const v = bw * F[i].shown; if (i) g.fillRect(x + bw - v, 36, v, 9); else g.fillRect(x, 36, v, 9); }
      G.label(g, S.fin ? (S.count ? '压制 ' + S.count : '倒地！') : max(0, 16 - S.ft).toFixed(0), w / 2, 40, { align: 'center', s: 16, w: 600, c: '#f1ede4' }); G.label(g, S.bet ? '押 ' + money(S.bet) + ' · 赔 ' + S.odds.toFixed(2) : '没下注', w / 2, 66, { align: 'center' }); },
    end(S) { const R = S.R; if (S.ph === 'fight' && S.bet > 0) { ST.ring.net -= S.bet; toast('后院局', '中途走人，押的 ' + money(S.bet) + ' 归庄家。'); } ringReset(S); ringPose(S, 0, 0); for (const f of R.crowd) { f.group.visible = true; f.want = 'idle'; } S.result = { net: ST.ring.net }; },
    auto(S, vk) { if (S.ph === 'bet') { const pk = S.arg.pick === undefined ? 1 : S.arg.pick, sk = S.arg.stake === undefined ? 3 : S.arg.stake; if (S.pt > .5 && S.pick !== pk) { vk.tap(pk ? 'KeyD' : 'KeyA'); } else if (S.pt > .9 && S.stake !== sk && (S.pt % .3) < S.dt) vk.tap(S.stake < sk ? 'KeyW' : 'KeyS'); else if (S.pt > 2.4 && S.stake === sk) vk.tap('KeyE'); } }
  };
  function ringReset(S) { S.F = [{ hp: 1, shown: 1, stag: 0, lean: 0 }, { hp: 1, shown: 1, stag: 0, lean: 0 }]; S.ft = 0; S.xt = 1.6; S.ex = null; S.fin = false; S.count = 0; S.winner = -1; S.ang = S.round * 1.3 + .4; S.sep = 1.7; S.bet = 0; S.won = false; const form = (S.rnd() - .5) * .16; S.pReal = cl(FIGHTERS[0].real + form, .25, .75); if (S.arg.winner !== undefined) S.pReal = S.arg.winner === 0 ? .97 : .03; S.fall = 0; }
  function ringResult(S) { S.ph = 'result'; S.pt = 0; const w = S.winner, f = FIGHTERS[w]; if (S.bet > 0) { if (w === S.pick) { const pay = Math.round(S.bet * S.odds); W.add(pay, 'ring'); ST.ring.won++; ST.ring.net += pay - S.bet; S.won = true; snd('cash'); hudMsg(f.name + ' 赢了', '到手 ' + money(pay), 'good', 4); } else { ST.ring.net -= S.bet; hudMsg(f.name + ' 赢了', '押的 ' + money(S.bet) + ' 没了', 'bad', 4); snd('ui_bad'); } } else hudMsg(f.name + ' 赢了', '这场你只是看客', '', 4);
    snd('bell'); emit('ring', { type: 'result', winner: f.id, bet: S.bet, won: S.won, net: ST.ring.net }); }
  /** place + animate the two wrestlers. mode 0 = waiting, 1 = fighting, 2 = after */
  function ringPose(S, dt, mode) { const R = S.R, c = R.c, F = S.F, w = R.w, e = S.ex; let sep = 1.7, circ = .25;
    if (mode === 1 && !S.fin) { const close = e && e.t < 1.1; sep = close ? lerp(1.5, .78, ss(e.t, 0, .35)) : 1.35; circ = close ? .12 : .5; } else if (mode === 1 || mode === 2) { sep = .5; circ = 0; }
    S.sep = ease(S.sep, sep, 5, dt); S.ang += circ * dt; const cx = c.x + sin(S.t * .23) * .25, cz = c.z + cos(S.t * .19) * .25;
    for (let i = 0; i < 2; i++) { const f = w[i], s = i ? 1 : -1, a = S.ang + (i ? PI : 0), st = F[i]; st.shown = ease(st.shown, st.hp, 5, dt); st.stag = max(0, st.stag - dt * 1.6); let x = cx + sin(a) * S.sep / 2, z = cz + cos(a) * S.sep / 2, y = c.y, hh = a + PI, state = 'idle', extra = { seed: f.seed }, rx = 0;
      if (mode === 1 && !S.fin) { state = 'grapple'; extra.wr = i; extra.sync = S.t; if (e && e.att === i && e.t < .8) { state = 'strike'; extra.phase = cl(e.t / .7, 0, 1); x -= sin(a) * .12 * sin(cl(e.t / .7, 0, 1) * PI); z -= cos(a) * .12 * sin(cl(e.t / .7, 0, 1) * PI); }
        if (st.stag > 0) { state = 'stagger'; x += sin(a) * .3 * st.stag; z += cos(a) * .3 * st.stag; rx = -.22 * st.stag; } }
      else if (S.fin || mode === 2) { const lose = i !== S.winner; if (lose) { S.fall = ease(S.fall, 1, 6, dt); state = 'down'; rx = -HP * S.fall; y = c.y + .13 * S.fall; x = cx + sin(a) * .9; z = cz + cos(a) * .9; } else { const up = mode === 2 || S.fint > 3.5; state = up ? 'cheer' : 'pin'; x = cx + sin(a + PI) * (up ? .2 : -.15) ; z = cz + cos(a + PI) * (up ? .2 : -.15); if (up) hh = S.h + PI; } }
      f.group.position.set(x, y, z); f.group.rotation.set(0, 0, 0); f.group.rotation.order = 'YXZ'; f.group.rotation.y = hh; f.group.rotation.x = rx; f.want = state; f.extra = extra; } }

  /* ================================================================== 9. street time-trial */
  const RACE = { state: { active: false, phase: 'idle', t: 0, cp: 0, n: 0, countdown: 0, delta: null, last: null, medal: null, best: null, finished: false }, checkpoints: [], medals: { gold: 38, silver: 45, bronze: 55 }, ghost: null, rec: [], splits: [], gsplits: [], objs: null, path: null, far: 0, dT: 0, prize: { gold: 150, silver: 80, bronze: 40 }, paid: {} };
  function raceSetup() { const L = GT.L, bx = L.backRoad.x, lane = 2.25, zn = L.crossN.z, zs = L.crossS.z, hx = 3, s = site('raceStart') || { x: bx - lane, z: -60, h: 0 };
    const pts = [[s.x, s.z, 0], [bx - lane, 60, 0], [bx - 12, zn - lane, -HP], [75, zn - lane, -HP], [hx, zn - 22, PI], [hx, 40, PI], [hx, -60, PI], [hx + 11, zs + lane, HP], [80, zs + lane, HP], [bx - lane, zs + 24, 0]];
    RACE.checkpoints = pts.map((p, i) => ({ i, x: p[0], z: p[1], h: p[2], r: 7 })); RACE.state.n = pts.length;
    // centre-line path (with rounded corners) used for the default ghost and the showcase autopilot
    const corner = (cx, cz, a0, r) => { const o = []; for (let i = 0; i <= 6; i++) { const a = a0 + i / 6 * HP; o.push([cx + cos(a) * r, cz + sin(a) * r]); } return o; }, R = 9;
    let path = [[s.x, s.z], [bx - lane, zn - lane - R]]; path = path.concat(corner(bx - lane - R, zn - lane - R, 0, R)); path.push([hx + R, zn - lane]); path = path.concat(corner(hx + R, zn - lane - R, HP, R)); path.push([hx, zs + lane + R]); path = path.concat(corner(hx + R, zs + lane + R, PI, R)); path.push([bx - lane - R, zs + lane]); path = path.concat(corner(bx - lane - R, zs + lane + R, -HP, R)); path.push([s.x, s.z]);
    let d = 0; RACE.path = path.map((p, i) => { if (i) d += Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]); return { x: p[0], z: p[1], d }; }); RACE.len = d; }
  const pathAt = d => { const P = RACE.path; d = cl(d, 0, RACE.len); let i = 1; while (i < P.length - 1 && P[i].d < d) i++; const a = P[i - 1], b = P[i], k = (d - a.d) / max(1e-6, b.d - a.d); return { x: lerp(a.x, b.x, k), z: lerp(a.z, b.z, k), h: Math.atan2(b.x - a.x, b.z - a.z) }; };
  /** synthetic ghost lap at a given total time (speed dips through the corners) */
  function ghostLap(total) { const out = [], N = 240; let acc = 0; const w = []; for (let i = 0; i < N; i++) { const d0 = RACE.len * i / N, h0 = pathAt(d0).h, h1 = pathAt(d0 + 14).h, hm = pathAt(max(0, d0 - 10)).h, turn = max(abs(angDiff(h0, h1)), abs(angDiff(hm, h0))); const sp = lerp(1, .42, cl(turn / .5, 0, 1)) * (i < 8 ? .35 + i * .08 : 1); w.push(1 / sp); acc += 1 / sp; }
    let t = 0; for (let i = 0; i <= N; i++) { const p = pathAt(RACE.len * i / N); out.push([+t.toFixed(3), +p.x.toFixed(2), +p.z.toFixed(2), +p.h.toFixed(3)]); if (i < N) t += w[i] / acc * total; } return out; }
  function ghostAt(g, t) { if (!g || !g.length) return null; if (t >= g[g.length - 1][0]) return g[g.length - 1]; let lo = 0, hi = g.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (g[m][0] <= t) lo = m; else hi = m; } const a = g[lo], b = g[hi], k = (t - a[0]) / max(1e-6, b[0] - a[0]); return [t, lerp(a[1], b[1], k), lerp(a[2], b[2], k), a[3] + angDiff(a[3], b[3]) * k]; }
  function ghostSplits(g) { return RACE.checkpoints.map((c, i) => { if (i === 0) return 0; let best = 1e9, bt = 0; for (const s of g) { const d = Math.hypot(s[1] - c.x, s[2] - c.z); if (d < best) { best = d; bt = s[0]; } } return bt; }).concat([g[g.length - 1][0]]); }
  function raceObjs() { if (RACE.objs) return RACE.objs; const mk = (col, op) => new T.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false });
    const gate = dim => { const g = new T.Group(), m = mk(new T.Color(2.6, 1.45, .4).multiplyScalar(dim), .9), m2 = mk(new T.Color(1.6, .9, .25).multiplyScalar(dim), .32); for (const s of [-1, 1]) { const p = new T.Mesh(new T.CylinderGeometry(.045, .045, 5.2, 8), m); p.position.set(s * 4.6, 2.6, 0); g.add(p); const b = new T.Mesh(new T.CylinderGeometry(.16, .22, .14, 12), m); b.position.set(s * 4.6, .07, 0); g.add(b); const halo = new T.Mesh(new T.PlaneGeometry(.7, 5.2), m2); halo.position.set(s * 4.6, 2.6, 0); g.add(halo); }
      for (let i = 0; i < 3; i++) { const sh = new T.Shape(); sh.moveTo(-1.5, 0); sh.lineTo(0, 1.1); sh.lineTo(1.5, 0); sh.lineTo(1.5, .42); sh.lineTo(0, 1.52); sh.lineTo(-1.5, .42); const c = new T.Mesh(new T.ShapeGeometry(sh), m2); c.rotation.x = HP; c.position.set(0, .04, -1.6 + i * 1.5); c.userData.chev = i; g.add(c); } g.visible = false; A.root.add(g); return g; };
    const gk = GT.kit(), gm = mk(new T.Color(.25, .9, 1.1), .16); gk.box(gm, 1.78, .5, 4.4, 0, .58, 0, { bevel: .16 }); gk.box(gm, 1.5, .46, 2.1, 0, 1.05, -.25, { bevel: .2 }); for (const sx of [-1, 1]) for (const sz of [-1.35, 1.4]) gk.cyl(gm, .32, .32, .22, sx * .84, .32, sz, { seg: 14, rz: HP }); const ghost = gk.build({ cast: false, recv: false }); ghost.traverse(o => { if (o.isMesh) o.renderOrder = 5; }); ghost.visible = false; A.root.add(ghost);
    // start line + sign (always in the world)
    const s = RACE.checkpoints[0], tx = canvasTex('chk', 256, 32, (g, w, h) => { for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#d8d4c8' : '#1a1a1c'; g.fillRect(i * 16, j * 16, 16, 16); } const r = GT.rng('chk'); speckle(g, w, h, 90, () => 'rgba(40,40,40,' + r() * .4 + ')', 1, 5, r); });
    const ln = new T.Mesh(new T.PlaneGeometry(9, .9), new T.MeshStandardMaterial({ map: tx, roughness: .85, transparent: true, opacity: .82, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); ln.rotation.x = -HP; ln.position.set(GT.L.backRoad.x, .012, s.z); ln.receiveShadow = true; A.root.add(ln);
    const k = GT.kit(), sx = GT.L.backRoad.x - 5.4, sy = ground(sx, s.z - .6); k.cyl('metal_galv', .03, .035, 2.7, sx, sy + 1.35, s.z - .6, { seg: 8 }); k.cyl('concrete', .14, .16, .1, sx, sy + .05, s.z - .6, { seg: 10 }); k.box('metal_dark', .04, .62, 1.12, sx + .04, sy + 2.3, s.z - .6, { bevel: .006 });
    const sm = new T.Mesh(new T.PlaneGeometry(1.06, .56), new T.MeshStandardMaterial({ map: GT.signTex('环线计时 · LOOP TT', { w: 512, h: 256, bg: '#1d2a2e', color: '#f0e6cc' }), roughness: .7 })); sm.position.set(sx + .062, sy + 2.3, s.z - .6); sm.rotation.y = HP; A.root.add(sm); A.root.add(k.build()); GT.world.addPost(sx, s.z - .6, .1, 2.7, 'race-sign');
    return RACE.objs = { gates: [gate(1), gate(.35)], ghost }; }
  function raceHud(on) { if (on) { hudOpen({ name: '环线计时赛' }); RACE.hud = true; } else if (RACE.hud) { RACE.hud = false; if (!A.active) hudClose(); } }
  const fmtT = t => { const m = Math.floor(t / 60), s = t - m * 60; return (m ? m + ':' : '') + (m ? String(Math.floor(s)).padStart(2, '0') : Math.floor(s)) + '.' + String(Math.floor((s % 1) * 100)).padStart(2, '0'); };
  const medalFor = t => t <= RACE.medals.gold ? 'gold' : t <= RACE.medals.silver ? 'silver' : t <= RACE.medals.bronze ? 'bronze' : null, MEDAL = { gold: '金', silver: '银', bronze: '铜' };
  RACE.start = function () { const st = RACE.state; if (st.active || A.active || !A.inited) return false; raceObjs(); if (!RACE.ghost) RACE.ghost = ghostLap((RACE.medals.silver + RACE.medals.bronze) / 2 - 2); RACE.gsplits = ghostSplits(RACE.ghost);
    Object.assign(st, { active: true, phase: 'countdown', t: 0, cp: 1, countdown: 3, delta: null, last: null, medal: null, finished: false, best: ST.race.best }); RACE.rec = []; RACE.splits = [0]; RACE.far = 0; RACE.dT = 0; RACE.beep = 4; bindOwn(); raceHud(true); ST.race.runs++; emit('race', { type: 'start' }); return true; };
  RACE.stop = function (why) { const st = RACE.state; if (!st.active) return; st.active = false; st.phase = 'idle'; if (RACE.objs) { RACE.objs.gates.forEach(g => g.visible = false); RACE.objs.ghost.visible = false; } raceHud(false); if (why) toast('计时赛', why); emit('race', { type: 'stop', why }); };
  /** feed every frame while a race is on: carState = { x, z, h, speed } */
  RACE.update = function (dt, car) { const st = RACE.state; if (!st.active || !car) return st; const O = raceObjs(), cps = RACE.checkpoints, N = cps.length;
    if (st.phase === 'countdown') { st.countdown -= dt; const b = Math.ceil(st.countdown); if (b !== RACE.beep && b > 0) { RACE.beep = b; snd('beat', { g: 1.2, f: 520 }); } if (st.countdown <= 0) { st.phase = 'run'; st.t = 0; snd('gate', { g: 1.2 }); hudMsg('走！', '', 'good', .9); } }
    else if (st.phase === 'run') { st.t += dt; RACE.dT += dt; if (RACE.rec.length === 0 || st.t - RACE.rec[RACE.rec.length - 1][0] >= .1) RACE.rec.push([+st.t.toFixed(3), +car.x.toFixed(2), +car.z.toFixed(2), +(car.h || 0).toFixed(3)]);
      const tg = cps[st.cp % N], [fx, fz] = fwd(tg.h), along = (car.x - tg.x) * fx + (car.z - tg.z) * fz, lat = abs((car.x - tg.x) * fz - (car.z - tg.z) * fx), dist = Math.hypot(car.x - tg.x, car.z - tg.z);
      if (along >= 0 && along < 14 && lat < tg.r) { RACE.splits.push(st.t); const gs = RACE.gsplits[st.cp]; st.delta = gs !== undefined ? st.t - gs : null; RACE.dT = 0; st.last = st.cp; if (st.cp === N) raceFinish(); else { st.cp++; snd('gate'); emit('race', { type: 'checkpoint', i: st.last, t: st.t, delta: st.delta }); } }
      RACE.far = dist > 260 ? RACE.far + dt : 0; if (RACE.far > 6 || st.t > 240) RACE.stop('跑偏太远，这圈作废。'); if (OWN.p.Escape || OWN.p.Backspace) RACE.stop('计时取消。'); }
    else if (st.phase === 'done') { st.countdown -= dt; if (st.countdown <= 0) RACE.stop(); }
    // visuals: next two gates + the ghost
    for (let i = 0; i < 2; i++) { const g = O.gates[i], idx = st.cp + i, c = cps[idx % N], on = st.phase !== 'done' && idx <= N; g.visible = on; if (on) { g.position.set(c.x, ground(c.x, c.z), c.z); g.rotation.y = c.h; for (const ch of g.children) if (ch.userData.chev !== undefined) ch.material.opacity = .32; g.children.forEach(ch => { if (ch.userData.chev !== undefined) ch.position.y = .04 + .0; }); g.scale.y = 1 + sin(A.time * 4 + i) * .03; } }
    const gp = st.phase === 'run' ? ghostAt(RACE.ghost, st.t) : st.phase === 'countdown' ? RACE.ghost[0] : null; O.ghost.visible = !!gp; if (gp) { O.ghost.position.set(gp[1], ground(gp[1], gp[2]), gp[2]); O.ghost.rotation.y = gp[3]; }
    raceDraw(car); return st; };
  function raceFinish() { const st = RACE.state, t = st.t, med = medalFor(t), prev = ST.race.best, pb = prev === null || t < prev; st.phase = 'done'; st.finished = true; st.countdown = 5; st.medal = med; st.final = t;
    if (pb) { ST.race.best = t; ST.race.medal = med; RACE.ghost = RACE.rec.concat([[+t.toFixed(3), RACE.checkpoints[0].x, RACE.checkpoints[0].z, 0]]); }
    let pay = 0; if (med && !RACE.paid[med]) { for (const m of ['bronze', 'silver', 'gold']) { if (!RACE.paid[m]) { RACE.paid[m] = true; pay += RACE.prize[m]; } if (m === med) break; } if (pay) W.add(pay, 'race'); }
    snd('gate', { g: 1.3 }); if (med) snd('cash'); hudMsg(fmtT(t) + (med ? ' · ' + MEDAL[med] + '牌' : ''), (pb ? (prev === null ? '第一圈成绩' : '个人最佳 −' + (prev - t).toFixed(2)) : '离最佳差 ' + (t - prev).toFixed(2)) + (pay ? ' · 奖金 ' + money(pay) : ''), med || pb ? 'good' : '', 4.5); emit('race', { type: 'finish', time: t, medal: med, best: ST.race.best, pb }); save(); }
  function raceDraw(car) { const st = RACE.state, g = HUD.g, w = HUD.w, h = HUD.h, N = RACE.checkpoints.length; hudInfo({ sub: '后街 → 北横街 → 公路 → 南横街 · 一圈', stats: [['最佳', ST.race.best ? fmtT(ST.race.best) : '—'], ['奖牌', ST.race.medal ? MEDAL[ST.race.medal] : '—', !!ST.race.medal], ['幽灵', fmtT(RACE.ghost[RACE.ghost.length - 1][0])]], keys: [['Esc', '放弃这圈']] });
    g.clearRect(0, 0, w, h); G.panel(g, 0, 8, w, 80); const t = st.phase === 'countdown' ? 0 : st.phase === 'done' ? st.final : st.t;
    if (st.phase === 'countdown') G.label(g, String(max(1, Math.ceil(st.countdown))), w / 2, 40, { align: 'center', s: 34, w: 700, c: '#ffb454' }); else G.label(g, fmtT(t), 30, 38, { s: 30, w: 600, c: '#f1ede4' });
    if (st.phase !== 'countdown') { if (st.delta !== null && (RACE.dT < 3.5 || st.phase === 'done')) G.label(g, (st.delta <= 0 ? '−' : '+') + abs(st.delta).toFixed(2), 176, 40, { s: 17, w: 600, c: st.delta <= 0 ? '#9fe8dc' : '#ff8f7c' }); G.label(g, '检查点 ' + min(st.cp - 1, N) + '/' + N, w - 30, 28, { align: 'right' }); G.label(g, Math.round((car.speed || 0) * 3.6) + ' km/h', w - 30, 46, { align: 'right', c: 'rgba(241,237,228,.6)' }); }
    G.pips(g, 30, 70, N, i => i < st.cp - 1 || st.phase === 'done' ? 1 : 0, { s: 7, gap: 5 }); const mx = 30 + N * 12 + 16; let x = mx; for (const m of ['gold', 'silver', 'bronze']) { const ok = t <= RACE.medals[m]; G.label(g, MEDAL[m] + ' ' + RACE.medals[m] + 's', x, 70, { c: ok ? { gold: '#ffcf70', silver: '#d9dde2', bronze: '#d79a6a' }[m] : 'rgba(241,237,228,.3)' }); x += 76; } }

  /* ================================================================== init / update / interaction spots */
  const LIST = [
    { id: 'hoops', name: '投篮', anchors: ['hoop', 'courtShot1..5'] }, { id: 'weights', name: '撸铁', anchors: ['gymBench', 'gymCurl'] }, { id: 'fishing', name: '钓鱼', anchors: ['fishSpot0..2'] },
    { id: 'vending', name: '贩卖机', anchors: ['vendDrink', 'vendSnack'] }, { id: 'bar', name: '落潮酒吧', anchors: ['barOrder', 'barStool*', 'barJukebox'] }, { id: 'dog', name: '黄狗', anchors: ['dogHome'] },
    { id: 'binoculars', name: '望远镜', anchors: ['overlook*'], key: 'KeyB' }, { id: 'ring', name: '后院局', anchors: ['ringCentre', 'ringSide*'] }, { id: 'race', name: '环线计时赛', anchors: ['raceStart'], mode: 'car' }];
  const free = () => !A.active && !RACE.state.active;
  function registerSpots() { const use = (id, arg) => ctx => { start(id, ctx, typeof arg === 'function' ? arg(ctx) : arg); };
    const spot = (id, s, o) => { if (!s) return null; return addSpot(Object.assign({ id: 'act_' + id, x: s.x, z: s.z, y: s.y, r: 1.4, key: 'KeyE', mode: 'foot', enabled: free }, o)); };
    for (let i = 1; i <= 5; i++) spot('hoops' + i, site('courtShot' + i), { label: '投篮', r: 1.2, marker: i === 1, icon: 'ball', onUse: use('hoops', { spot: i - 1 }) });
    const gb = site('gymBench'); if (gb) { const st = gb.a && gb.a.stand; spot('bench', st ? { x: st.x, z: st.z, y: ground(st.x, st.z) } : gb, { label: gb.a && gb.a.head ? '卧推' : '坐姿推举', marker: true, icon: 'weight', onUse: use('weights', { variant: 'bench' }) }); }
    spot('curl', site('gymCurl'), { label: '弯举', icon: 'weight', onUse: use('weights', { variant: 'curl' }) });
    for (let i = 0; i < 3; i++) spot('fish' + i, site('fishSpot' + i), { label: '钓鱼', marker: i === 0, icon: 'fish', onUse: use('fishing', { spot: i }) });
    spot('vendDrink', site('vendDrink'), { label: '买饮料', icon: 'can', r: 1.2, onUse: use('vending', { kind: 'Drink' }) }); spot('vendSnack', site('vendSnack'), { label: '买零食', icon: 'can', r: 1.2, onUse: use('vending', { kind: 'Snack' }) });
    const stools = sites('barStool', 6); stools.forEach((s, i) => spot('stool' + i, s, { label: '坐下 · 点单', r: 1.0, marker: i === 0, icon: 'glass', onUse: use('bar', { stool: i }) })); if (!stools.length) spot('barOrder', site('barOrder'), { label: '吧台点单', marker: true, icon: 'glass', onUse: use('bar', {}) });
    spot('jukebox', site('barJukebox'), { label: '点唱机 · 换台', r: 1.2, icon: 'note', onUse: () => jukebox() });
    DOG.spots = [addSpot({ id: 'act_dog_pet', x: DOG.x, z: DOG.z, r: 1.7, key: 'KeyE', mode: 'foot', label: '摸狗', icon: 'paw', enabled: free, onUse: use('dog', { mode: 'pet' }) }),
      addSpot({ id: 'act_dog_feed', x: DOG.x, z: DOG.z, r: 1.7, key: 'KeyF', mode: 'foot', label: () => '喂（零食 ×' + A.inv.snack + '）', icon: 'paw', enabled: () => free() && A.inv.snack > 0, onUse: use('dog', { mode: 'feed' }) })];
    sites('overlook', 4).forEach((s, i) => spot('overlook' + i, s, { label: '望远镜 · 踩点', marker: true, icon: 'binoculars', onUse: use('binoculars', { overlook: i }) }));
    sites('ringSide', 8).slice(0, 4).forEach((s, i) => spot('ring' + i, s, { label: '看比赛 · 下注', r: 1.3, marker: i === 0, icon: 'ring', onUse: use('ring', { side: i }) }));
    const rs = site('raceStart'); if (rs) addSpot({ id: 'act_race', x: rs.x, z: rs.z, r: 6, key: 'KeyE', mode: 'car', label: '环线计时赛 · 开始', marker: true, icon: 'flag', enabled: free, onUse: () => RACE.start() }); }
  /** init(scene, opts?) — call once after the world modules (road / station / hangouts) have built.
      opts: { camera, ctl, persist (default true), standins (default true: build stand-in set pieces where hangouts anchors are missing), cast (default true: our own NPCs),
              binocKey (default true: KeyB anywhere on foot), ownDriver (drive hero + camera ourselves even if a ctl exists), seed, who } */
  function init(scene, opts) { if (A.inited) return API; opts = opts || {}; A.scene = scene; A.opts = opts; A.camera = opts.camera || null; A.ctl = opts.ctl || (GT.onfoot && GT.onfoot.ctl) || null;
    A.root = new T.Group(); A.root.name = 'activities'; scene.add(A.root); load(); hudInit(); const t0 = performance.now();
    buildStandins(); raceSetup(); raceObjs(); defaultPOIs();
    const dh = site('dogHome'); buildDog(); DOG.x = dh.x; DOG.z = dh.z; DOG.h = dh.h + 1.2; DOG.y = dh.y; DOG.tx = dh.x; DOG.tz = dh.z; dogUpdate(0, null);
    if (STAND.built.gym) { restBarbell('bench'); restBarbell('curl'); }
    if (opts.cast !== false) { castLocals(); castTender(); } ringCast();
    registerSpots(); A.inited = true; A.info = { ms: Math.round(performance.now() - t0), standins: Object.keys(STAND.built), npcs: A.npcs.length, spots: A.spots.length }; return API; }
  const playerPos = () => { const c = A.ctl; if (A.opts.playerPos) return A.opts.playerPos(); if (c && c.pos && c.enabled !== false) return c.pos; if (A.standin) return A.standin.group.position; return null; };
  function update(dt) { if (!A.inited) return; dt = cl(dt || 0, 0, .1); A.time += dt; if (!A.ctl && GT.onfoot && GT.onfoot.ctl) A.ctl = GT.onfoot.ctl;
    if (A.active && !A.active.ext) { const S = A.active; if (step(S, dt)) finish(S); else applyCam(S); }
    dogUpdate(dt, playerPos()); ringIdle(dt);
    const cp = A.camera ? A.camera.position : null; for (const f of A.npcs) { if (!f.group.visible) continue; if (cp && cp.distanceToSquared(f.group.position) > 6400) continue; f.update(dt, f.want, f.extra); }
    if (STAND.net && !(A.active && A.active.id === 'hoops')) STAND.net.update(dt);
    const ctl = A.ctl; if (free() && ctl && ctl.enabled !== false && ctl.takeover && A.opts.binocKey !== false && GT.input && GT.input.pressed && GT.input.pressed('KeyB')) start('binoculars', { ctl, hero: ctl.hero });
    hudTick(dt); for (const k in OWN.p) OWN.p[k] = false; OWN.look.dx = OWN.look.dy = 0; OWN.wheel = 0; }
  const API = GT.activities = { init, update, list: LIST, stats: ST, start, stop, on, addKarma, karmaIndicator, scouted: A.scouted, addPOI, race: RACE, inventory: A.inv, sellFish, jukebox, say, toast,
    setController(ctl) { A.ctl = ctl; return API; }, setCamera(cam) { A.camera = cam; return API; }, site, dog: DOG, fish: FISH, rumours: RUMOURS,
    get karma() { return A.karma; }, get active() { return A.active ? A.active.id : (RACE.state.active ? 'race' : null); }, get info() { return A.info; }, _A: A };

  /* ================================================================== showcase: showcase.html?m=activities&act=<id>&at=<seconds>&auto=1 [&sub=<variant>] [&play=1] [&who=people] [&cash=80]
     Builds the real world, puts the hero stand-in at the activity and plays it on a deterministic autoplay. `at` pre-rolls the simulation at 60 Hz, then time is frozen
     (play=1 keeps it running). Pass cam= / look= to inspect from a free camera instead of the activity's own. */
  GT.showcase.activities = ({ scene, camera }) => {
    const Q = new URLSearchParams(location.search), act = Q.get('act') || 'hoops', at = +(Q.get('at') || 0), auto = Q.get('auto') !== '0', play = Q.get('play') === '1', sub = Q.get('sub') || '', errBox = document.getElementById('err'), fail = m => { if (errBox) errBox.textContent += m + '\n'; };
    for (const m of ['road', 'station', 'motel', 'hangouts']) { try { if (GT[m] && GT[m].build && Q.get('no') !== m) GT[m].build(scene); } catch (e) { fail('activities showcase: ' + m + '.build threw ' + (e.stack || e)); } }
    W.cash = Q.get('cash') !== null ? +Q.get('cash') : 80;
    init(scene, { camera, persist: false, ownDriver: true, ownSubs: true, seed: Q.get('seed') || 0, who: Q.get('who') || undefined, standins: Q.get('standins') === '0' ? false : undefined });
    A.auto = auto; A.silent = true; A.freeCam = !!Q.get('cam'); const hero = standin(), put = (s, dx, dz, h) => { if (s) hero.place(s.x + (dx || 0), s.y, s.z + (dz || 0), h === undefined ? s.h : h); };
    let arg = {}, car = null, lap = null, world = 0, look = [0, 1, 0], camP = [6, 3, 8];
    if (act === 'hoops') { put(site('courtShot' + (+sub || 3))); arg = { spot: (+sub || 3) - 1, challenge: sub === 'challenge', plan: sub === 'miss' ? [.5, .97, .5] : undefined }; if (sub === 'challenge') arg.spot = 0; }
    else if (act === 'weights') { put(site(sub === 'curl' ? 'gymCurl' : 'gymBench')); arg = { variant: sub === 'curl' ? 'curl' : 'bench', sloppy: sub === 'fail' }; }
    else if (act === 'fishing') { put(site('fishSpot' + (+sub || 0))); arg = { spot: +sub || 0, biteAt: 4.2, power: +(Q.get('power') || .72) }; }
    else if (act === 'vending') { const kind = sub === 'snack' ? 'Snack' : 'Drink'; put(site('vend' + kind)); arg = { kind, eat: sub === 'eat' || sub === 'kick' || sub === 'giveup', kickOk: sub !== 'giveup', script: sub === 'giveup' ? 'giveup' : 'buy', item: sub === 'snack' ? 2 : 0, n: 1 }; }
    else if (act === 'bar') { put(site('barStool1') || site('barOrder'), .6, 0); arg = { stool: 1 }; if (sub === 'fish') { A.inv.fish.push({ id: 'bass', name: '琥珀鲈', kg: 2.4, value: 26 }, { id: 'bream', name: '落日鲷', kg: 1.1, value: 10 }); arg.script = [5, 0]; } }
    else if (act === 'dog') { const d = site('dogHome'); put(d, 1.1, 2.3, PI + .4); arg = { mode: sub || 'pet' }; if (sub === 'feed' || sub === 'both') A.inv.snack = 2; }
    else if (act === 'binoculars') { const o = site('overlook' + (+sub || 0)); put(o); arg = { overlook: +sub || 0, stay: true };
      if (GT.vehicles) { try { const pc = GT.vehicles.make('cruiser', { lights: { head: 0 } }); pc.group.position.set(6.2, 0, -31); pc.group.rotation.y = PI; scene.add(pc.group); } catch (e) { fail('cruiser: ' + e); } } addPOI({ id: 'patrol', kind: 'patrol', label: '巡逻车', note: '停在南口 · 没熄火', pos: { x: 6.2, y: .95, z: -31 } }); }
    else if (act === 'ring') { put(site('ringSide0')); arg = { side: 0, pick: sub === 'lose' ? 0 : 1, stake: 3, winner: 1 }; }
    else if (act === 'race') { hero.group.visible = false; try { car = GT.vehicles ? GT.vehicles.make(Q.get('car') || 'hero', {}) : null; } catch (e) { fail('race car: ' + e); } if (!car) { const g = new T.Group(), m = new T.Mesh(GT.boxGeo(1.8, 1.2, 4.4, .2), GT.mat('car_paint')); m.position.y = .7; g.add(m); car = { group: g, update() { } }; } scene.add(car.group); lap = ghostLap(+(Q.get('lap') || 39.2)); }
    const cs = { x: 0, z: 0, h: 0, speed: 0 }, cc = { p: null };
    const drive = dt => { const st = RACE.state, t = st.phase === 'run' ? st.t : st.phase === 'done' ? 1e3 : 0, g = ghostAt(lap, t), g2 = ghostAt(lap, t + .05); cs.speed = st.phase === 'run' ? Math.hypot(g2[1] - g[1], g2[2] - g[2]) / .05 : 0; cs.x = g[1]; cs.z = g[2]; cs.h = g[3]; car.group.position.set(cs.x, 0, cs.z); car.group.rotation.y = cs.h; if (car.wheels) for (const w of car.wheels) { const sp = w.children && w.children[0]; if (sp) sp.rotation.x += cs.speed * dt / .34; }
      if (car.update) car.update(dt); RACE.update(dt, cs); const [fx, fz] = fwd(cs.h), want = [cs.x - fx * 7.2 + fz * .9, 2.5, cs.z - fz * 7.2 - fx * .9]; if (!cc.p) cc.p = want.slice(); else for (let i = 0; i < 3; i++) cc.p[i] += (want[i] - cc.p[i]) * (1 - Math.exp(-5 * dt));
      camP = cc.p.slice(); look = [cs.x + fx * 5, 1.1, cs.z + fz * 5]; };
    const tick = dt => { world += dt; if (act === 'race') { if (!RACE.state.active && !RACE.state.finished) RACE.start(); drive(dt); } update(dt); };
    if (act !== 'race' && act !== 'none' && sub !== 'idle') { if (!start(act, {}, arg)) fail('activities showcase: could not start "' + act + '" (anchor missing?)'); }
    if (act === 'dog' && sub === 'idle') { DOG.hold = !!Q.get('dogst'); if (Q.get('dogst')) { DOG.st = Q.get('dogst'); DOG.pantT = Q.get('dogst') === 'pant' ? 99 : 0; if (DOG.st === 'pant') DOG.st = 'idle'; DOG.tx = DOG.x; DOG.tz = DOG.z + 40; } look = [DOG.x, DOG.y + .4, DOG.z]; camP = [DOG.x + 1.6, DOG.y + .7, DOG.z + 1.5]; }
    try { const n = Math.round(at * 60); for (let i = 0; i < n; i++) tick(1 / 60); tick(1e-4); } catch (e) { fail('activities showcase pre-roll threw: ' + (e.stack || e)); }
    for (const m of ['road', 'hangouts', 'station', 'motel']) { try { if (GT[m] && GT[m].update) GT[m].update(Math.max(.016, at)); } catch (e) { /* */ } }
    const view = () => { if (A.freeCam) return; if (act === 'race') { camera.position.set(camP[0], camP[1], camP[2]); camera.lookAt(look[0], look[1], look[2]); } else if (A.active) applyCam(A.active); else if (act === 'dog') { look = [DOG.x, DOG.y + .4, DOG.z]; camera.position.set(camP[0], camP[1], camP[2]); camera.lookAt(look[0], look[1], look[2]); } };
    const S = A.active; if (S && S.cam) { camP = S.cam.pos.slice(); look = S.cam.look.slice(); if (act === 'binoculars') look = [S.o.x, S.o.y, S.o.z]; else if (S.hp) look = [S.hp.x, S.hp.y + 1, S.hp.z]; }
    return { cam: camP, look, hours: 18.2, update(dt) { if (play) { try { tick(Math.min(dt, .05)); for (const m of ['road', 'hangouts', 'station']) if (GT[m] && GT[m].update) GT[m].update(dt); } catch (e) { if (!A.failed) { A.failed = true; fail('activities showcase tick threw: ' + (e.stack || e)); } } } view(); } };
  };
})();
