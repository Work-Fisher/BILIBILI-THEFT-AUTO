/* samples.js — recorded sound layer (audio/sfx/<name>.ogg|.mp3 + manifest.json; sources and licences in audio/sfx/CREDITS.md). The procedural voices in js/audio.js stay as the fallback.
   GT.samples = { ready, has(name), play(name, {dst, t, g, rate, x, y, z}) → seconds, buffer(name), bed (current bed gains), rain, log (last voices), played ({name: count}), setVolume(v), stats() }
   Variants: names ending in _1, _2 … form a group ('gun_pst' → gun_pst_1..4); one is picked at random (never the same twice running) and detuned a little.
   Routing: through GT.audio.rig() — the same sfx / veh / amb / ui categories, master, compressor and ceiling as the synth (pause and quit fade it too); world one-shots get a pooled PannerNode
   (GT.audio's 24-slot pool) plus the street reverb send. Without the rig (old audio.js) it falls back to its own output.
   Hooks js/audio.js calls (each returns truthy when a recording took the job, and the synth voice is then skipped):
     sfx(name, o)   crash / glass / scooter_crash / scrape / tire_squeal {level} (looped skid) / brake_squeal / horn {on} (held, cars) / horn {dur, x, z} (traffic honks) / ignition / door_open /
                    door_close / body_fall / land / cash (till) / ui_tick / ui_ok / ui_bad / ui_phone / bike_bell
     engine(eng)    the player's car: idle / low / mid / high loops of a sedan (BMW 120d), a V8, a motorbike or a bus, cross-faded by rpm and pitched to it, darker off-throttle; gear changes clunk
     siren(sir)     recorded US wail and yelp loops on pooled panners at the two nearest siren cars, doppler from their closing speed (yelp from level .6 or mode 'yelp')
     step(e, sf)    footfalls by surface (concrete, asphalt, sand, boardwalk, grass, tile) and gait (walk / run); the Moonbay map is classified here (see groundOf)
     passBuffer(k)  traffic pass-by loops for js/audio.js makePass (cars, V8s, buses, motorbikes; electric two-wheelers keep the synth)
     emitGain(kind) how much of a synth city emitter to keep (chatter / vendors under the recorded market; snack-street emitters muted on the coast map)
   Hooks js/combat.js calls from its SND voices (one line each): shot(def, dst, t, dist, own), mech(kind, dst, t), shell(dst, t, hull), melee(dst, t, heavy, blocked, pos), swish(dst, t), body(dst, t).
     Shots: close set by weapon (9 mm pistol, .357 / 7.5 mm revolver, 9 mm SMG with the tail choked by the next round, rifle, shotgun), 9 mm at 15 m for mid range, rifle shots with natural
     reverb for far fire. Melee: face / body punches, kicks for heavy fists, alloy-bat and pipe / wrench metal on the weapon, swings, body falls, non-verbal grunts.
   Events: combat 'pickup' / 'cash' (weapon / money pickup), 'hit' (an enemy grunts now and then); cngame 'water' / 'fall' / 'exitCar' (splash), 'enterCar' (door), 'exitCar' (engine stop, remote lock),
     'crash' (metal scrape on walls, clank on cars), 'bigmap' (map unfold); polled: entering / leaving a room (door, shop bell), street-kit props and shop windows (GT.streetkit: hydrant
     knocked → clank + a water column loop while it gushes, bins, newspaper boxes, cartons, panes cracking / shattering).
   Beds (lazy-loaded 30 s stereo loops): coast — waves near / far, beach crowd, street day / night, wind in the palms, a muffled bar band at night; gull calls overhead by day;
     China maps — street, night market, Chinatown street market, river, insects, restaurant; rain everywhere. A police helicopter circles high above from four stars.
   ?samples=0 switches the whole layer off. Without files or audio it is a silent no-op. */
(function () {
  'use strict';
  const GT = window.GT = window.GT || {}, Q = new URLSearchParams(location.search), BASE = 'audio/sfx/';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), rnd = Math.random, sst = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const win = (h, a, b, f) => { f = f || .5; return a <= b ? sst(h, a - f, a + f) * (1 - sst(h, b - f, b + f)) : Math.max(sst(h, a - f, a + f), 1 - sst(h, b - f, b + f)); };
  const S = { buf: {}, man: null, rig: null, ac: null, out: null, vol: 1, last: {}, grp: {}, pickLast: {}, choke: {}, beds: {}, bedLoading: {}, bedOffT: {}, eng: null, sir: [], sirT: 0, cops: null,
    skid: null, horn: null, hyd: new Map(), seen: new WeakMap(), pend: null, picked: false, inside: false, gull: 0, heli: null, gear: 0, kindNow: '' };
  const api = GT.samples = {
    ready: false, bed: {}, count: 0, rain: 0, log: [], played: {},
    has(n) { return !!(S.buf[n] || S.grp[n]); },
    buffer(n) { return S.buf[n] || null; },
    setVolume(v) { S.vol = clamp(+v || 0, 0, 1); if (S.out) S.out.gain.value = S.vol; },
    play(n, o) { try { const v = voice(pick(n), o || {}); return v ? v.dur : 0; } catch (e) { return 0; } },   /* never throws into the caller's frame */
    stats() { return { ready: api.ready, loaded: Object.keys(S.buf).length, beds: Object.assign({}, api.bed), played: Object.assign({}, api.played), engine: S.eng ? S.eng.set : null, sirens: S.sir.filter(Boolean).length, rig: !!S.rig }; }
  };
  if (Q.get('samples') === '0') return;

  /* ================================================================== voices */
  /** group name or exact name → a buffer name (random variant, not the same one twice running) */
  function pick(n) { if (S.buf[n]) return n; const g = S.grp[n]; if (!g || !g.length) return n; if (g.length === 1) return g[0]; let k = Math.floor(rnd() * g.length); if (g[k] === S.pickLast[n]) k = (k + 1) % g.length; S.pickLast[n] = g[k]; return g[k]; }
  const running = () => { const ac = S.ac; return !!(ac && (!ac.state || ac.state === 'running')); };
  function bus(name) { const R = S.rig; if (!R) return S.out; switch (name) { case 'self': return R.selfBus; case 'ui': return R.uiBus; case 'eng': return R.engineBus; case 'music': return R.musicBus; case 'amb': return R.wcat.amb; case 'ambIn': return R.cat.amb; case 'world': return R.wcat.sfx; case 'wveh': return R.wcat.veh; default: return R.cabinBus; } }
  /** start one voice. o: {dst (node), bus ('cabin'|'self'|'ui'|'eng'|'world'…), t, g, rate, loop, x, y, z (pooled panner), cat, lvl, ref, prio, off (start offset), dur (cut)}. null when nothing could play */
  function voice(n, o) { const b = S.buf[n], ac = S.ac; if (!b || !ac || !running()) return null; o = o || {};
    let dst = o.dst || null, t0 = o.t || 0, use = null;
    if (dst && dst.context && dst.context !== ac) { t0 = t0 ? ac.currentTime + Math.max(0, t0 - dst.context.currentTime) : 0; dst = null; }   /* a bus on another AudioContext (combat.js boots its own when GT.audio had none): play on ours, with the start moved to our clock */
    const t = Math.max(t0 || 0, ac.currentTime); let rate = o.rate || 1; const gain = o.g === undefined ? 1 : o.g;
    if (!dst && o.x !== undefined && o.z !== undefined && S.rig && S.rig.voice) {
      use = S.rig.voice({ cat: o.cat || 'sfx', x: o.x, y: o.y === undefined ? 1.2 : o.y, z: o.z, lvl: o.lvl === undefined ? .5 : o.lvl, prio: o.prio || 0, dur: o.loop ? 0 : b.duration / rate + .15, ref: o.ref || 5 }, t);
      if (!use) return null; dst = use.g; const L = S.rig.listener || { x: 0, z: 0 }, d = Math.hypot(o.x - L.x, o.z - L.z), rf = o.ref || 5; if (S.rig.verbIn && o.verb !== false) { const s = ac.createGain(); s.gain.value = .12 * rf / (rf + d) * (o.verb || 1); use.g.connect(s); s.connect(S.rig.verbIn); }
    }
    if (!dst) dst = bus(o.bus);
    const smg = /^gun_smg/.test(n); if (smg) { const p = S.choke.smg; rate *= 1 + (rnd() - .5) * .03; if (p) { try { p.g.gain.setTargetAtTime(0, t + .03, .045); p.src.stop(t + .5); } catch (e) {} } }   /* automatic fire: each round chokes the tail of the one before, only the last rings out */
    const src = ac.createBufferSource(), g = ac.createGain(); src.buffer = b; src.playbackRate.value = rate; src.loop = !!o.loop; g.gain.value = gain; src.connect(g);
    try { g.connect(dst); } catch (e) { g.connect(bus()); } src.start(t, o.off || 0); if (o.cut) src.stop(t + o.cut);
    if (smg) S.choke.smg = { src, g };
    api.count++; api.log.push(n); if (api.log.length > 40) api.log.shift(); api.played[n] = (api.played[n] || 0) + 1;
    return { src, g, dur: o.loop ? 0 : b.duration / rate, rate, use, t }; }
  /** a one-shot by group, with a minimum gap per group and ±4 % pitch */
  function one(n, o, gap) { if (!S.ac || !api.has(n)) return null; const t = S.ac.currentTime; if (t - (S.last[n] === undefined ? -9 : S.last[n]) < (gap === undefined ? .05 : gap)) return null;
    o = Object.assign({}, o || {}); o.rate = (o.rate || 1) * (.96 + rnd() * .08); const v = voice(pick(n), o); if (v) S.last[n] = t; return v; }
  const fade = (v, t, tc) => { if (!v) return; try { const T = t === undefined ? S.ac.currentTime : t; v.g.gain.cancelScheduledValues(T); v.g.gain.setTargetAtTime(0, T, tc || .08); v.src.stop(T + (tc || .08) * 8); if (v.use) v.use.release(T + (tc || .08) * 8); } catch (e) {} };
  const cg = () => { try { return GT.cngame || null; } catch (e) { return null; } };
  const here = () => { const G = cg(); return (G && G.player) || null; };
  const cb = () => GT.combat || null;

  /* ================================================================== world: which map, what is underfoot */
  function world() { if (GT.coast && GT.coast.active) return 'coast'; if (Q.get('world') === 'ct') return 'ct'; return 'cn'; }
  /** Moonbay ground from GT.coastTerrain: sand seaward of the dune line, boardwalks over the dunes at every beach access, the access walk and the park lawn behind,
      the drive and sidewalks east of the park wall. (A world-side GT.cnroad.groundType(x, z) would replace this guess — see the notes.) */
  function coastGround(x, z, sf) { const T = GT.coastTerrain; if (!T) return null; if (sf === 'tile' || sf === 'wet') return null; if (sf === 'asphalt') return 'asp'; if (x > T.PK) return 'con';
    const de = T.duneEdge ? T.duneEdge(z) : -38, P = T.ACCP || 60, u = (((z - (T.ACC0 || 0)) % P) + P) % P, dz = Math.min(u, P - u);
    if (dz < 1.25 && x > (T.DUNE1 || -52) - 3 && x < de + 1.5) return 'wood';
    if (dz < 1.3 && x >= de + 1.5) return 'con';
    if (x > de) return 'grass'; return 'sand'; }
  function groundOf(e, sf) { const W = world(), x = e && e.x, z = e && e.z;
    try { const f = GT.cnroad && GT.cnroad.groundType; if (f && x !== undefined) { const g = f(x, z); const m = { concrete: 'con', pavement: 'con', paver: 'con', asphalt: 'asp', sand: 'sand', wood: 'wood', boardwalk: 'wood', grass: 'grass', tile: 'tile' }[g]; if (m) return m; } } catch (er) {}
    if (sf === 'tile') return 'tile'; if (sf === 'wood') return 'wood'; if (sf === 'wet') return null;
    if (W === 'coast' && x !== undefined) { const c = coastGround(x, z, sf); if (c) return c; }
    if (sf === 'asphalt') return 'asp'; if (sf === 'dirt' || sf === 'grass') return 'grass'; return 'con'; }
  const STEP = { con: { w: .55, r: .7 }, asp: { w: .55, r: .62 }, sand: { w: .45, r: .55 }, wood: { w: .62, r: .72 }, grass: { w: .5, r: .55 }, tile: { w: .42, r: .55 } };

  /* ================================================================== hooks for js/audio.js */
  const H = {};
  H.step = function (e, sf) { if (!api.ready || !running()) return false; const k = groundOf(e, sf); if (!k) return false; const run = (+e.speed || 0) > 4.2, set = 'step_' + k + '_' + (run ? 'r' : 'w'); if (!api.has(set)) return false;
    const L = STEP[k], g = (run ? L.r : L.w) * (e.crouch ? .45 : 1) * (.85 + rnd() * .3); voice(pick(set), { bus: 'self', g, rate: (e.foot === 'L' ? .98 : 1.02) * (.95 + rnd() * .1) }); return true; };
  const NEEDS = { crash: 'crash_heavy', glass: 'crash_glass', scooter_crash: 'crash_light', scrape: 'crash_rail', tire_squeal: 'tire_skid_loop', brake_squeal: 'brake_squeal', horn: 'horn_car', ignition: 'eng_start', door_open: 'car_door_open', door_close: 'car_door_close',
    body_fall: 'bodyfall', land: 'land', cash: 'register', ui_tick: 'ui_click', ui_ok: 'ui_ok', ui_bad: 'ui_error', ui_phone: 'ui_open', bike_bell: 'bike_bell' };   /* sfx names a recording answers, and the group it needs */
  H.sfx = function (name, o) {
    if ((!api.ready && name !== 'tire_squeal') || !running() || !NEEDS[name] || !api.has(NEEDS[name]) || (name === 'horn' && o.weedy)) return 0;
    const r = sfx1(name, o); return r || .01;
  };
  function sfx1(name, o) { const vv = o.v !== undefined ? clamp(+o.v || 0, .08, 1) : .7, gg = o.g !== undefined ? +o.g || 0 : 1, dist = o.distance ? 10 / (10 + o.distance) : 1;
    let v = null;
    switch (name) {
      case 'crash': v = one(vv < .35 ? 'crash_light' : 'crash_heavy', { g: (vv < .35 ? .45 + vv : .55 + .45 * vv) * dist * gg, rate: vv < .35 ? 1.05 : 1 }, .08); if (vv > .2 && vv < .7 && rnd() < .5) one('crash_clank', { g: .35 * vv * dist }, .1); break;
      case 'glass': v = one(o.distance > 6 ? 'crash_glass' : 'glass_shop', { g: .8 * dist * gg }, .1); break;
      case 'scooter_crash': v = one('crash_light', { g: .5 + .4 * vv, rate: 1.12 }, .08); one('crash_clank', { g: .3 * vv, rate: 1.2 }, .1); break;
      case 'scrape': v = one('crash_rail', { g: .25 + .45 * vv, rate: 1.05 + rnd() * .15, cut: .3 + .9 * vv }, .25); break;
      case 'tire_squeal': skid(+o.level || 0); return true;
      case 'brake_squeal': v = one(rnd() < .5 ? 'brake_squeal' : 'tire_screech', { g: .22 * vv, rate: 1.2 }, .5); break;
      case 'horn': if (o.weedy) return 0; if (o.on !== undefined) { hornHold(!!o.on, gg); return true; }
        v = o.x !== undefined ? one('horn_car', { x: o.x, y: o.y || 1.1, z: o.z, g: .9 * gg, cat: 'veh', lvl: .7, ref: 7, cut: (o.dur || .4) + .25 }, .1) : one('horn_car', { g: .7 * gg, cut: (o.dur || .4) + .25 }, .1); break;
      case 'ignition': v = one('eng_start', { bus: 'eng', g: .8 }, .5); break;
      case 'door_open': v = one('car_door_open', { g: .8 * gg }, .2); break;
      case 'door_close': v = one('car_door_close', { g: .85 * gg }, .2); break;
      case 'body_fall': v = one('bodyfall', { g: .5 + .45 * vv }, .15); break;
      case 'land': { const P = here(); v = one('land', { bus: 'self', g: .35 + .5 * vv }, .15); if (P) H.step({ x: P.x, z: P.z, speed: 6, foot: 'L' }, (GT.cnroad && GT.cnroad.surfaceAt) ? safeSurf(P.x, P.z) : 'asphalt'); break; }
      case 'cash': v = one('register', { bus: 'ui', g: .7 }, .3); break;
      case 'ui_tick': v = one('ui_click', { bus: 'ui', g: .55 * gg }, .03); break;
      case 'ui_ok': v = one('ui_ok', { bus: 'ui', g: .6 * gg }, .05); break;
      case 'ui_bad': v = one('ui_error', { bus: 'ui', g: .55 * gg }, .1); break;
      case 'ui_phone': v = one(o.open === false ? 'ui_close' : 'ui_open', { bus: 'ui', g: .55 }, .05); break;
      case 'bike_bell': v = o.x !== undefined ? one('bike_bell', { x: o.x, y: o.y || 1, z: o.z, g: .7 * gg, cat: 'veh', ref: 5 }, .3) : one('bike_bell', { g: .6 * gg }, .3); break;
      default: return 0;
    }
    return v ? Math.max(.01, v.dur) : 0; };
  function safeSurf(x, z) { try { const s = GT.cnroad.surfaceAt(x, z); return s === 'water' ? 'wet' : s || 'asphalt'; } catch (e) { return 'asphalt'; } }
  /* Start on clear slip and release below a lower threshold to avoid chatter. */
  function skid(l) { const ac = S.ac, t = ac.currentTime; if (l <= (S.skid ? .28 : .42)) { if (S.skid) { fade(S.skid.v, t, .018); S.skid = null; } return; }
    if (!S.skid) { const v = voice('tire_skid_loop', { bus: 'eng', loop: true, g: 0, off: rnd() * 2 }); if (!v) return; S.skid = { v }; }
    S.skid.at = t; S.skid.v.g.gain.setTargetAtTime(.30 * sst(l, .28, 1), t, .06); }
  function hornHold(on, g) { const t = S.ac.currentTime; if (!on) { if (S.horn) { fade(S.horn, t, .03); S.horn = null; } return; } if (S.horn) return; S.horn = voice('horn_hold', { bus: 'eng', loop: true, g: .55 * (g || 1) }); }

  /* ---------------------------------------------------------------- the player's engine */
  const SETS = {
    sedan: [['eng_sedan_idle', 840, 840], ['eng_sedan_low', 1500, 1470], ['eng_sedan_mid', 2300, 2000], ['eng_sedan_high', 3600, 3300]],
    muscle: [['eng_muscle_idle', 800, 810], ['eng_muscle_low', 1900, 2700], ['eng_muscle_mid', 3200, 2860], ['eng_muscle_high', 4700, 4500]],
    moto: [['eng_moto_idle', 1100, 1200], ['eng_moto_low', 2400, 1600], ['eng_moto_high', 5000, 4000]],
    bus: [['eng_bus_idle', 900, 760]], truck: [['eng_truck_idle', 900, 800]]
  };   /* [loop, rpm where it is at full weight, rpm it was recorded at] */
  function setOf(kind) { const k = String(kind || ''); if (/escooter|sharebike|bicycle|trike/.test(k)) return null; if (/sport|muscle|police|cop|cruiser|coupe|pony/.test(k)) return 'muscle'; if (/bus|coach/.test(k)) return 'bus'; if (/truck|lorry|tow/.test(k)) return 'truck'; if (/moto|bike|cycle/.test(k)) return 'moto'; return 'sedan'; }
  function engStop(t) { const E = S.eng; if (!E) return; for (const L of E.layers) fade(L.v, t, .12); try { E.out.gain.setTargetAtTime(0, t, .1); } catch (e) {} S.eng = null; }
  H.engine = function (p) { if (!S.rig || !running()) return !api.ready && !S.loadFailed; const ac = S.ac, t = ac.currentTime, P = here(), ent = P && P.mode === 'car' ? P.ent : null, kind = ent ? ent.kind : S.kindNow;
    const set = setOf(kind || 'sedan'), def = set && SETS[set]; if (!def || !def.every(d => S.buf[d[0]])) { engStop(t); return !api.ready && !S.loadFailed; }
    if (!p.on) { engStop(t); return true; }
    if (!S.eng || S.eng.set !== set) { engStop(t); const out = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = .6; lp.frequency.value = 4000; out.gain.value = 0; lp.connect(out); out.connect(S.rig.engineBus);
      const layers = def.map(d => { const v = voice(d[0], { dst: lp, loop: true, g: 0, off: rnd() * S.buf[d[0]].duration }); return { v, c: d[1], n: d[2] }; }); S.eng = { set, out, lp, layers, van: /van/.test(String(kind)) ? .88 : 1 }; out.gain.setTargetAtTime(.9, t, .05); }
    if (ent) S.kindNow = ent.kind;
    const E = S.eng, rpm = 720 + clamp(+p.rpm || 0, 0, 1) * 5480, load = clamp(+p.load || 0, 0, 1), Ls = E.layers, n = Ls.length;
    for (let i = 0; i < n; i++) { const L = Ls[i]; let w; if (n === 1) w = 1; else if (i === 0) w = rpm <= L.c ? 1 : rpm >= Ls[1].c ? 0 : Math.cos((rpm - L.c) / (Ls[1].c - L.c) * Math.PI / 2);
      else if (i === n - 1) w = rpm >= L.c ? 1 : rpm <= Ls[i - 1].c ? 0 : Math.sin((rpm - Ls[i - 1].c) / (L.c - Ls[i - 1].c) * Math.PI / 2);
      else w = rpm <= Ls[i - 1].c || rpm >= Ls[i + 1].c ? 0 : rpm < L.c ? Math.sin((rpm - Ls[i - 1].c) / (L.c - Ls[i - 1].c) * Math.PI / 2) : Math.cos((rpm - L.c) / (Ls[i + 1].c - L.c) * Math.PI / 2);
      const idleBoost = i === 0 ? 1 : .55 + .45 * load + .2 * sst(rpm, 2500, 5000);
      if (L.v) { L.v.g.gain.setTargetAtTime(w * idleBoost, t, .05); L.v.src.playbackRate.setTargetAtTime(clamp(rpm / L.n * E.van, .45, 2.3), t, .04); } }
    E.lp.frequency.setTargetAtTime(1400 + 9000 * (.25 + .75 * load) * (.5 + .5 * sst(rpm, 900, 4000)), t, .06); E.out.gain.setTargetAtTime(.75 + .25 * load, t, .08);
    const C = ent && ent.c; if (C && C.gear > 0) { if (S.gear && C.gear !== S.gear && rpm > 1200) { one('gear_shift', { bus: 'eng', g: .35 }, .25); E.out.gain.setTargetAtTime(.55, t, .02); E.out.gain.setTargetAtTime(.75 + .25 * load, t + .09, .06); } S.gear = C.gear; }
    return true; };

  /* ---------------------------------------------------------------- sirens: the two nearest siren cars get a pooled voice each */
  H.siren = function (sir) { if (!api.ready || !S.rig || !S.buf.siren_wail || !S.buf.siren_yelp) return false; const ac = S.ac, t = ac.currentTime, lvl = clamp(+sir.level || 0, 0, 1);
    if (t - S.sirT > .1) { S.sirT = t; let cops = []; try { const st = cg() && cg().state; cops = ((st && st.cops) || []).filter(c => c && c.lights && c.lights.siren && c.x !== undefined); } catch (e) { cops = []; } S.cops = cops; }
    const P = here(), lx = P ? P.x : 0, lz = P ? P.z : 0, yelp = sir.mode ? sir.mode === 'yelp' : lvl >= .6;
    const cs = (S.cops || []).map(c => [Math.hypot(c.x - lx, c.z - lz), c]).sort((a, b) => a[0] - b[0]).slice(0, lvl > .8 ? 2 : 1);
    for (let i = 0; i < 2; i++) { let u = S.sir[i]; const c = lvl > 0 ? (cs[i] ? cs[i][1] : (i === 0 && sir.distance < 900 ? { x: lx + sir.distance, z: lz, v: 0, h: 0, fake: 1 } : null)) : null;
      if (!c) { if (u) { fade(u.w, t, .2); fade(u.y, t, .2); S.sir[i] = null; } continue; }
      if (u && (u.w.use && u.w.use.dead)) { fade(u.w, t, .05); fade(u.y, t, .05); u = S.sir[i] = null; }
      if (!u) { const o = { x: c.x, y: 1.6, z: c.z, loop: true, g: 0, cat: 'veh', lvl: .9, prio: 1, ref: 14, off: rnd() * 5 }; const w = voice('siren_wail', o), y = voice('siren_yelp', Object.assign({}, o, { off: rnd() })); if (!w || !y) { fade(w, t, .02); fade(y, t, .02); continue; } u = S.sir[i] = { w, y, det: i ? 1.035 : 1 }; }
      const dx = lx - c.x, dz = lz - c.z, d = Math.hypot(dx, dz) || 1, vx = Math.sin(c.h || 0) * (c.v || 0), vz = Math.cos(c.h || 0) * (c.v || 0), pe = P && P.ent, lvx = pe ? Math.sin(pe.h || 0) * (pe.v || 0) : 0, lvz = pe ? Math.cos(pe.h || 0) * (pe.v || 0) : 0;
      const closing = clamp(((vx - lvx) * dx + (vz - lvz) * dz) / d, -50, 50), dop = 343 / (343 - closing) * u.det, g = (.35 + .65 * lvl) * (i ? .7 : 1);
      for (const vv of [u.w, u.y]) { if (vv.use) vv.use.move(c.x, 1.6, c.z, t, .08); vv.src.playbackRate.setTargetAtTime(dop, t, .1); }
      u.w.g.gain.setTargetAtTime(yelp ? 0 : g, t, .12); u.y.g.gain.setTargetAtTime(yelp ? g * .85 : 0, t, .12); }
    return true; };

  /* ---------------------------------------------------------------- traffic pass-bys and synth city emitters */
  H.passBuffer = function (kind) { const s = setOf(kind); if (!s) return null; const n = s === 'bus' ? 'eng_bus_idle' : s === 'truck' ? 'eng_truck_idle' : s === 'moto' ? 'eng_moto_low' : s === 'muscle' ? 'eng_muscle_low' : 'eng_sedan_low', b = S.buf[n];
    if (!b) return null; api.played[n] = (api.played[n] || 0) + 1; return { buf: b, r0: s === 'muscle' ? .5 : s === 'moto' ? .75 : s === 'bus' || s === 'truck' ? .95 : .7, r1: s === 'bus' || s === 'truck' ? .7 : 1, g: s === 'bus' || s === 'truck' ? .75 : .55 }; };
  H.emitGain = function (kind) { const W = world();
    if (W === 'coast') return /sizzle|steam|walla|vendor|mahjong|dance|river|train/.test(kind) ? 0 : 1;   /* snack-street / riverbank emitters are laid out for the China maps */
    if (!api.ready) return 1;
    if (kind === 'walla') return S.buf.amb_street_day || S.buf.amb_ct_market ? .3 : 1; if (kind === 'vendor') return .5; if (kind === 'river') return S.bedOn && S.bedOn.amb_river ? .35 : 1; return 1; };

  /* ================================================================== hooks for js/combat.js (SND voices) */
  const GUN = { pistol: 'gun_pst', revolver: 'gun_rev', smg: 'gun_smg', shotgun: 'gun_sg', rifle: 'gun_rfl' };
  H.shot = function (def, dst, t, dist, own) { if (!api.ready || !def) return false;
    if (def.sup) {
      const group = 'suppressed_' + def.id;
      if (!api.has(group)) return false;
      return !!voice(pick(group), { dst, t, g: own ? 1 : .8, rate: .98 + rnd() * .04 });
    }
    const set = GUN[def.id]; if (!set || !api.has(set)) return false; dist = +dist || 0;
    const far = sst(dist, 40, 90), mid = own ? 0 : sst(dist, 16, 40) * (1 - far), close = 1 - Math.max(mid, far), heavy = set === 'gun_rfl' || set === 'gun_sg';
    let sounded = false;
    if (close > .02) sounded = !!voice(pick(set), { dst, t, g: .9 * close * (own ? 1 : .9), rate: .97 + rnd() * .06 });
    if (mid > .02) sounded = !!voice(pick(heavy ? 'gun_far' : 'gun_mid'), { dst, t, g: 1.3 * mid * (heavy ? 1.2 : 1), rate: (heavy ? .95 : 1) * (.96 + rnd() * .08) }) || sounded;
    if (far > .02) sounded = !!voice(pick('gun_far'), { dst, t, g: 2.2 * far, rate: (set === 'gun_pst' || set === 'gun_smg' ? 1.12 : .95) * (.96 + rnd() * .08) }) || sounded;
    if (own && sounded) voice(pick('gun_mid'), { dst, t: t + .075, g: heavy ? .23 : .12, rate: heavy ? .84 : 1.04 });
    return sounded; };
  H.mech = function (kind, dst, t) { if (!api.ready) return false;
    switch (kind) {
      case 'dry': return !!voice(pick('gun_empty'), { dst, t, g: .8, rate: .95 + rnd() * .1 });
      case 'magout': return !!voice(pick('gun_reload_2'), { dst, t, g: .55, rate: 1.1, cut: .45 });
      case 'magin': S.pend = { dst, t }; S.picked = false; Promise.resolve().then(() => { const p = S.pend; S.pend = null; if (p && !S.picked) voice(pick('gun_reload'), { dst: p.dst, t: p.t, g: .7 }); S.picked = false; }); return true;   /* a pickup emits right after this in the same call: that one plays the pickup sound instead */
      case 'rack': return !!voice(pick('gun_rack'), { dst, t, g: .8 });
      case 'pump': return !!voice(pick('gun_pump'), { dst, t, g: .85 });
      case 'shellin': return !!voice('gun_reload_2', { dst, t, g: .45, rate: 1.35, cut: .25 });
      default: return false; } };
  H.shell = function (dst, t, hull) { if (!api.ready || !api.has('shell')) return false; return !!voice(pick('shell'), { dst, t, g: hull ? .5 : .65, rate: hull ? .62 + rnd() * .08 : .95 + rnd() * .15 }); };
  const METAL = { pipe: 1, crowbar: 1 };
  H.melee = function (dst, t, heavy, blocked, pos) { if (!api.ready || !api.has('punch_face')) return false; const C = cb(), P = C && C.player, toPlayer = !!(P && pos === P);
    const sw = (!toPlayer && P && P.swing) || {}, def = sw.def || {}, id = def.id || 'fists', metal = !!METAL[id] || def.kind === 'gun';
    if (blocked) { if (metal || id === 'bat') voice(pick('wrench_hit'), { dst, t, g: .5, rate: 1.2 }); voice(pick('punch_body'), { dst, t, g: .45, rate: 1.25 }); return true; }
    if (toPlayer) { voice(pick('punch_body'), { dst, t, g: .85 }); if (rnd() < .65) voice(pick('grunt'), { dst, t: t + .04, g: .5, rate: .92 + rnd() * .1 }); return true; }
    if (id === 'bat') { voice('bat_hit_1', { dst, t, g: heavy ? .95 : .75, rate: .95 + rnd() * .1 }); voice(pick('punch_body'), { dst, t, g: .5 }); }
    else if (metal) { voice(rnd() < .5 ? 'hit_metal' : 'wrench_hit_1', { dst, t, g: heavy ? .7 : .5, rate: 1.05 + rnd() * .2 }); voice(pick('punch_body'), { dst, t, g: .55 }); }
    else if (id === 'helmet') { voice(pick('punch_body'), { dst, t, g: .8, rate: 1.05 }); voice(pick('crash_clank'), { dst, t, g: .25, rate: 1.4 }); }
    else voice(pick(heavy ? (rnd() < .5 ? 'kick' : 'punch_face') : rnd() < .6 ? 'punch_face' : 'punch_body'), { dst, t, g: heavy ? .95 : .8, rate: .95 + rnd() * .1 });
    if (heavy || rnd() < .35) voice(pick(heavy ? 'grunt_heavy' : 'grunt'), { dst, t: t + .05, g: heavy ? .55 : .4, rate: .85 + rnd() * .12 });   /* the one who took it: non-verbal */
    return true; };
  H.swish = function (dst, t) { if (!api.ready || !api.has('swing')) return false; return !!voice(pick('swing'), { dst, t, g: .55, rate: .9 + rnd() * .2 }); };
  H.body = function (dst, t) { if (!api.ready || !api.has('bodyfall')) return false; return !!voice(pick('bodyfall'), { dst, t, g: .85, rate: .95 + rnd() * .1 }); };
  Object.assign(api, H);

  /* ================================================================== loading */
  const ext = (() => { try { return new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? '.ogg' : '.mp3'; } catch (e) { return '.mp3'; } })();
  const isBed = n => /^amb_/.test(n);
  function fetchBuf(n) { const ac = S.ac; return fetch(BASE + n + ext).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(a => new Promise((ok, no) => ac.decodeAudioData(a, ok, no))).then(b => { S.buf[n] = b; return b; }); }
  function load(ac) { S.ac = ac; S.out = ac.createGain(); S.out.gain.value = S.vol; S.out.connect(ac.destination); try { S.rig = GT.audio && GT.audio.rig ? GT.audio.rig() : null; } catch (e) { S.rig = null; }
    fetch(BASE + 'manifest.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(m => { if (!m) return; S.man = m;
      const early = new Set(['tire_skid_loop', ...Object.values(SETS).flat().map(layer => layer[0])]);
      const names = Object.keys(m).filter(n => !isBed(n)).sort((a, b) => Number(early.has(b)) - Number(early.has(a))), out = []; let i = 0;
      const next = () => { if (i >= names.length) return Promise.resolve(); const n = names[i++]; return fetchBuf(n).then(() => { const group = n.replace(/_\d+$/, ''); if (group !== n) (S.grp[group] ||= []).push(n); }).catch(() => {}).then(next); };   /* six fetches at a time */
      for (let k = 0; k < 6; k++) out.push(next()); return Promise.all(out); })
      .then(() => { if (!S.man) { S.loadFailed = true; return; } api.ready = true; hookGame(); setInterval(mix, 400); setInterval(tick, 100); }).catch(() => { S.loadFailed = true; }); }

  /* ================================================================== game events */
  function hookGame() { const Cb = cb(), G = cg();
    if (Cb && Cb.on && !S.hc) { S.hc = true;
      Cb.on('pickup', d => { S.picked = true; const P = Cb.player; voice(pick('weapon_pick'), { bus: 'cabin', g: .6 }); if (d && d.id && GUN[d.id]) voice(pick('gun_rack'), { bus: 'cabin', g: .4, t: S.ac.currentTime + .15 }); });
      Cb.on('cash', () => { S.picked = true; voice(pick('cash_pick'), { bus: 'ui', g: .6 }); });
      Cb.on('hit', d => { const e = d && d.e; if (!e || e.x === undefined || rnd() > .3) return; one('grunt', { x: e.x, y: 1.5, z: e.z, g: .5, ref: 5, rate: .9 + rnd() * .15 }, .4); }); }
    if (G && G.on && !S.hg) { S.hg = true; const wet = (x, z) => { try { return !!(GT.riverside && GT.riverside.inWater && GT.riverside.inWater(x, z)); } catch (e) { return false; } }, splash = () => { one('splash', { g: .8 }, 2.5); };
      G.on('water', () => { splash(); }); G.on('fall', d => { if (d && d.why === 'water') splash(); });
      G.on('enterCar', d => { const e = d && d.ent; S.kindNow = e ? e.kind : ''; S.gear = 0; if (e && !e.two) one('car_door_open', { g: .7 }, .3); });
      G.on('exitCar', d => { const e = d && d.ent; if (e && wet(e.x, e.z)) splash(); if (e && !e.two && setOf(e.kind)) { one('eng_stop', { bus: 'eng', g: .55 }, .5); if (rnd() < .6) setTimeout(() => { try { one('car_lock', { x: e.x, y: 1, z: e.z, g: .6, cat: 'veh', ref: 5 }, .5); } catch (er) {} }, 900); } });
      G.on('crash', d => { if (!d || d.two) return; const v = d.v || .3; if (d.what === 'world' && v > .3 && rnd() < .7) one('crash_rail', { g: .35 * v + .15, rate: .95 + rnd() * .1, cut: .6 + v }, .5); else if ((d.what === 'car' || d.what === 'cop') && v > .15) one('crash_clank', { g: .4 * v + .1 }, .15); });
      G.on('bigmap', d => { one(d && d.open ? 'map_open' : 'ui_close', { bus: 'ui', g: .55 }, .1); }); } }
  /** 10 Hz: rooms (door + shop bell), breakable street furniture and shop windows, the skid watchdog, gulls, the helicopter */
  function tick() { if (!api.ready || !running()) return; if (!S.hc || !S.hg) hookGame(); const t = S.ac.currentTime, P = here();
    if (S.skid && t - S.skid.at > .35) skid(0);
    if (P) { const inn = !!P.inside; if (inn !== S.inside) { S.inside = inn; if (P.mode === 'foot') { one(inn ? 'door_open' : 'door_close', { g: .55 }, .5); if (inn && /shop|store|market|mart|便利|店/.test(String(P.inside && (P.inside.id || P.inside.name || P.inside.kind || P.inside)))) one('shop_bell', { g: .45, t: t + .15 }, 2); } } }
    props(t); gulls(t); heli(t); }
  function props(t) { const K = GT.streetkit || (GT.chinatown && GT.chinatown.dx); const L = S.rig && S.rig.listener; if (!K || !L) return; const list = K.props || [], panes = K.panes || [];
    for (const p of list) { const prev = S.seen.get(p), st = p.st || 0; if (prev === undefined) { S.seen.set(p, st); continue; }
      if (prev === 0 && st) { const d = Math.hypot(p.x - L.x, p.z - L.z); if (d < 70) { const o = { x: p.x, y: (p.y0 || 0) + .5, z: p.z, g: .8, ref: 5, lvl: .5 };
        if (p.kind === 'hydrant') { one('crash_clank', o, .1); one('metal_knock', Object.assign({}, o, { g: .7 }), .1); }
        else if (p.kind === 'bin') one('trashcan', o, .15); else if (p.kind === 'box') one('box_fall', Object.assign({}, o, { g: .7 }), .1); else if (p.kind === 'rack') { one('box_fall', o, .1); one('metal_knock', Object.assign({}, o, { g: .5 }), .1); }
        else one(rnd() < .5 ? 'metal_knock' : 'trashcan', o, .12); } }
      S.seen.set(p, st);
      const gush = p.kind === 'hydrant' && p.st && p.geyser > 0 && Math.hypot(p.x - L.x, p.z - L.z) < 75, h = S.hyd.get(p);
      if (gush && !h) { const v = voice('water_gush', { x: p.x, y: (p.y0 || 0) + .8, z: p.z, loop: true, g: 0, cat: 'sfx', lvl: .6, ref: 6, off: rnd() * 8 }); if (v) { v.g.gain.setTargetAtTime(.8 * Math.min(1, p.geyser), t, .15); S.hyd.set(p, v); } }
      else if (h && (!gush || (h.use && h.use.dead))) { fade(h, t, .4); S.hyd.delete(p); } else if (h) h.g.gain.setTargetAtTime(.8 * clamp(p.geyser, 0, 1), t, .3); }
    for (const q of panes) { const prev = S.seen.get(q), st = q.st || 0; if (prev === undefined) { S.seen.set(q, st); continue; } if (st > prev && q.c) { const d = Math.hypot(q.c.x - L.x, q.c.z - L.z); if (d < 70) one(st >= 2 ? 'glass_shop' : 'crash_glass', { x: q.c.x, y: q.c.y, z: q.c.z, g: st >= 2 ? .9 : .35, rate: st >= 2 ? 1 : 1.3, ref: 6, lvl: .6 }, .1); } S.seen.set(q, st); } }
  function gulls(t) { if (world() !== 'coast' || !api.has('gull') || t < S.gull) return; const G = cg(), P = here(); let h = 12; try { h = G.state.hours; } catch (e) {} S.gull = t + 3 + rnd() * 9; const T = GT.coastTerrain;
    if (!P || P.inside || win(h, 6.2, 19.2, .6) < .5) return; const xw = T ? T.xw(P.z) : -108; if (P.x - xw > 120) return;
    one('gull', { x: Math.min(P.x - 8, xw + 25) - rnd() * 30, y: 9 + rnd() * 10, z: P.z + (rnd() - .5) * 70, g: .45 + rnd() * .3, cat: 'amb', ref: 10, lvl: .3, rate: .92 + rnd() * .16 }, 1); }
  function heli(t) { let stars = 0; try { stars = (cg().wanted || {}).stars || 0; } catch (e) {} const P = here(), on = stars >= 4 && P && !P.inside && S.buf.heli_loop;
    if (!on) { if (S.heli) { fade(S.heli.v, t, 1.2); S.heli = null; } return; }
    if (!S.heli || (S.heli.v.use && S.heli.v.use.dead)) { const v = voice('heli_loop', { x: P.x + 90, y: 70, z: P.z, loop: true, g: 0, cat: 'veh', lvl: .8, prio: 1, ref: 30, off: rnd() * 4 }); if (!v) return; S.heli = { v, a: rnd() * 6.28 }; v.g.gain.setTargetAtTime(.75, t, 1.5); }
    const H2 = S.heli; H2.a += .1 * .12; if (H2.v.use) H2.v.use.move(P.x + Math.cos(H2.a) * 85, 70, P.z + Math.sin(H2.a) * 85, t, .3); }

  /* ================================================================== ambience beds */
  /** is rain falling (not just a wet road)? GT.env.raining, or GT.env.wet during a story mission whose clock line says 雨 */
  function rainNow() { const E = GT.env; if (!E) return 0; if (E.raining) return 1; if (!(E.wet > .5)) return 0; try { const st = GT.cnstory, s = st && st.state, m = s && s.on && s.mission && (st.missions || []).find(q => q.id === s.mission); return m && /雨/.test(m.clock || '') ? clamp(E.wet, 0, 1) : 0; } catch (e) { return 0; } }
  function targets() { const G = cg(), tg = {}; let st = null, p = null; api.rain = 0; try { st = G && G.state; p = G && G.player; } catch (e) {}
    if (!(st && st.phase === 'play' && !st.paused && p)) return tg; const h = st.hours === undefined ? 12 : st.hours, night = clamp(h >= 12 ? (h - 18.6) / 1.6 : (6.2 - h) / 1.2, 0, 1), inside = p.inside || p.indoor ? 1 : 0, out = 1 - inside, wet = api.rain = rainNow();
    if (world() === 'coast') { const T = GT.coastTerrain, xw = T ? T.xw(p.z) : -108, PK = T ? T.PK : -10.5, de = T && T.duneEdge ? T.duneEdge(p.z) : -38, sea = clamp(1 - (p.x - xw) / 75, 0, 1);
      const beach = clamp((de + 4 - p.x) / 10, 0, 1), street = clamp((p.x - PK + 20) / 25, 0, 1), park = clamp(1 - Math.abs(p.x - (de + PK) / 2) / 22, 0, 1), bar = win(h, 19, 2.5, .7) * clamp(1 - Math.abs(p.x - 22) / 34, 0, 1);
      tg.amb_waves_near = out * Math.pow(sea, 1.4) * .55; tg.amb_waves_far = out * clamp(1 - (p.x - xw) / 280, .12, 1) * .3 * (1 - .6 * sea);
      tg.amb_beach_people = out * beach * win(h, 8.5, 18.8, 1) * .4 * (1 - .85 * wet); tg.amb_coast_day = out * (.25 + .75 * street) * (1 - .85 * night) * .3; tg.amb_coast_night = out * (.35 + .65 * street) * night * .32;
      tg.amb_palm_wind = out * (.3 + .7 * Math.max(park, beach * .6)) * .2; tg.amb_bar_music = out * bar * .26; tg.amb_night_insects = out * night * park * .16; tg.amb_restaurant = inside * .3;
      tg.amb_rain = wet * (inside ? .07 : p.mode === 'car' ? .3 : .4); }
    else { const river = world() === 'cn' ? clamp((-22 - p.x) / 26, 0, 1) : 0, dm = Math.hypot(p.x - 24, p.z + 58), market = world() === 'cn' ? clamp(1 - dm / 46, 0, 1) : .5, ct = world() === 'ct' ? 1 : 0;
      tg.amb_street_day = out * (1 - night * .65) * (1 - river * .7) * (1 - market * .5) * (ct ? .2 : .3); tg.amb_ct_market = out * win(h, 7.5, 20.5, 1) * (ct ? .38 : .18 * market) * (1 - .6 * wet);
      tg.amb_market_night = out * market * (.25 + .75 * night) * (ct ? .3 : .42); tg.amb_river = out * river * .4;
      tg.amb_night_insects = out * night * (1 - market * .7) * .22; tg.amb_restaurant = inside * .34; tg.amb_rain = wet * (inside ? .07 : p.mode === 'car' ? .3 : .4); if (wet) { tg.amb_street_day *= .7; tg.amb_night_insects *= .25; } }
    return tg; }
  function mix() { if (!api.ready) return; if (!S.hc || !S.hg) hookGame(); const t = S.ac.currentTime, tg = targets(); S.bedOn = {};
    for (const n of Object.keys(S.man || {})) { if (!isBed(n)) continue; const v = tg[n] || 0, b = S.beds[n]; api.bed[n] = Math.round(v * 100) / 100;
      if (v > .005) { S.bedOn[n] = 1; S.bedOffT[n] = t; if (!b) { if (S.buf[n]) startBed(n); else if (!S.bedLoading[n]) { S.bedLoading[n] = 1; fetchBuf(n).then(() => { S.bedLoading[n] = 0; }, () => { S.bedLoading[n] = 0; }); } } }
      const bb = S.beds[n]; if (bb) { bb.g.gain.setTargetAtTime(v, t, .9); if (v <= .005 && t - (S.bedOffT[n] || 0) > 90) { fade(bb, t, .5); delete S.beds[n]; delete S.buf[n]; } } }   /* a bed nobody needed for 90 s gives its 10 MB back */
    const any = Object.keys(S.beds).some(n => (tg[n] || 0) > .08 && n !== 'amb_restaurant' && n !== 'amb_rain'); try { if (GT.audio && GT.audio.synthAmb) GT.audio.synthAmb(any ? .3 : 1); } catch (e) {} }
  function startBed(n) { const v = voice(n, { bus: n === 'amb_restaurant' ? 'ambIn' : 'amb', loop: true, g: 0, off: rnd() * 20 }); if (v) S.beds[n] = v; }

  /* ================================================================== TF (2026-11-17): street barks, car radios, throttle blips (js/peds.js, js/traffic.js)
     barks(): the bark table (audio/barks/manifest.json from tools/tts.mjs --barks), fetched once; every clip is then decoded in the background, two at a time.
     bark(id, {x, z, g}) → seconds (0 = not loaded yet): one English line as a world one-shot on a pooled panner. The rules (two at a time nearby, a cool-down per person) live in js/peds.js.
     loopAt(name, {x, z, g, cat}) → { move(x, z), level(g), stop() } | null: a looped voice that follows a moving car (the open-top cars' radios on the muffled club bed, lazy-loaded).
     blip(name, {x, z, g, rate0, rate1, dur}) → seconds: a short enveloped one-shot with a pitch ramp (a coupe blipping its throttle as it pulls away). */
  const BK = { man: null, busy: false, q: [] };
  const bkLoad = () => { if (BK.busy || !BK.q.length || !S.ac) return; BK.busy = true; const id = BK.q.shift(), k = 'bark:' + id;
    fetch('audio/barks/' + id + '.mp3').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(a => new Promise((ok, no) => S.ac.decodeAudioData(a, ok, no))).then(b => { S.buf[k] = b; }, () => {}).then(() => { BK.busy = false; bkLoad(); }); };
  api.barks = () => { if (BK.man || BK.asked || !S.ac) return BK.man; BK.asked = true; fetch('audio/barks/manifest.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(m => { BK.man = m || {}; BK.q = Object.keys(BK.man); bkLoad(); bkLoad(); }, () => { BK.man = {}; }); return null; };
  api.bark = (id, o) => { const k = 'bark:' + id; if (!S.buf[k] || !running()) return 0; const v = voice(k, Object.assign({ cat: 'sfx', lvl: .62, ref: 6, prio: 1 }, o || {})); return v ? v.dur : 0; };
  api.loopAt = (n, o) => { o = o || {}; if (!S.ac || !running()) return null; if (!S.buf[n]) { if (!S.bedLoading[n] && S.man && S.man[n] !== undefined) { S.bedLoading[n] = 1; fetchBuf(n).then(() => { S.bedLoading[n] = 0; }, () => { S.bedLoading[n] = 0; }); } return null; }
    const v = voice(n, { loop: true, cat: o.cat || 'music', lvl: o.lvl === undefined ? .35 : o.lvl, ref: o.ref || 4, x: o.x, z: o.z, y: 1.1, g: o.g === undefined ? .8 : o.g, off: rnd() * 20, rate: o.rate || 1 }); if (!v) return null; if (!v.use) { try { v.src.stop(); } catch (e) {} return null; }
    return { move(x, z) { try { v.use.move(x, 1.1, z, S.ac.currentTime); } catch (e) {} }, level(g) { try { v.g.gain.setTargetAtTime(g, S.ac.currentTime, .3); } catch (e) {} },
      stop() { try { const t = S.ac.currentTime; v.g.gain.setTargetAtTime(0, t, .25); v.src.stop(t + 1.4); if (v.use.release) v.use.release(t + 1.5); } catch (e) {} } }; };
  api.blip = (n, o) => { o = o || {}; if (!S.ac || !running() || !api.has(n)) return 0; const d = o.dur || 1.1, g = o.g === undefined ? .8 : o.g, v = voice(pick(n), { cat: 'veh', lvl: .5, ref: 7, x: o.x, z: o.z, y: .7, g: 0, cut: d + .25 }); if (!v) return 0;
    try { const t = v.t, r1 = o.rate1 || 1.3; v.g.gain.setValueAtTime(0, t); v.g.gain.linearRampToValueAtTime(g, t + .07); v.g.gain.setTargetAtTime(0, t + d * .55, d * .16); v.src.playbackRate.setValueAtTime(o.rate0 || .8, t); v.src.playbackRate.linearRampToValueAtTime(r1, t + d * .4); v.src.playbackRate.linearRampToValueAtTime(r1 * .8, t + d); } catch (e) {} return d; };

  /* ?auto= URLs skip the menu, the only place js/cngame.js starts the audio: the first real key or click while the game is in play starts it here */
  function wake() { try { const A = GT.audio, G = cg(); if (!A || !A.init || !G || !G.sim || !G.sim.audioInit) return; const st = G.state; if (st && st.phase === 'play') G.sim.audioInit(); } catch (e) {} }
  if (typeof addEventListener === 'function') for (const ev of ['keydown', 'pointerdown', 'mousedown']) addEventListener(ev, wake, true);
  const wait = setInterval(() => { const ac = GT.audio && GT.audio.ctx; if (ac) { clearInterval(wait); load(ac); } }, 200);   /* no give-up: the context may be made minutes after the page loaded */
})();
