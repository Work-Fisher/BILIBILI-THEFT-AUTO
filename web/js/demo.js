/* demo.js — BILIBILI THEFT AUTO 1: the opening film (DM, 2026-11-17). 72 s: twenty-five shots of 月湾 Moonbay / 维尔蒙港 Port Vermont cut to a CC0 track at 120 BPM
   (audio/music/demo_theme.ogg, source and licence in audio/music/CREDITS.md). Shot order, pacing, framing and time-of-day plan follow the first GTA VI trailer
   (reports/GTA6预告片观察.md, the shot list in the notes DM-演示片.md): a dusk road and silhouettes, a hard cut to turquoise water from the air, a low angle up a tower through palms,
   the beach crowd, a speedboat under the causeway, night, a sunny street, a night aerial, the neon hotel row, the causeway from the air, a big sign against the sunset, phone clips,
   a live news feed, a chase, dust at sunset, the title. Nothing of that trailer is reused: no logo, no title words, no characters, no channel marks, no brands, no song.
   GT.demo = { prepare(game, o), play(game) -> Promise, replay(), auto(game, at), abort(), shots, length, state }
   Flow (js/cngame.js bootAsync): prepare() + the warm-up pass behind the gate (every shot staged and drawn four frames: shaders, textures, and one exposure reading per shot),
   gate → logo → play() → menu. The menu item 观看预告 (js/front.js) calls replay(). Any key, click or touch skips after 1 s. cn.html?demo=0 turns the film off.
   cn.html?auto=trailer plays it at once; &at=<s> stages the shot holding second s, runs that shot from its first frame on a fixed 60 Hz clock up to s and freezes there.
   Hooks in js/cngame.js tick(): G.demo.pre(dt) before the director poses the camera, G.demo.post(dt) right before the frame is drawn.
   Camera: one live cutscene of the game's director (the shadows, the crowd, the traffic and the sound follow the lens) whose single tracking shot is fed this file's pose each frame.
   Exposure: the game's eye adaptation would pump at every hard cut; the meter is put on manual at the level read for each shot, and its lag is cancelled through exposureBias.
   Props built here and taken out again at the end: a chain-link fence with razor wire, the MOONBAY letters on the beach, a dust plume. Never a // comment in the middle of a line. */
(function () {
  'use strict';
  const GT = window.GT; if (!GT) return; const T = window.THREE, doc = document, QS = new URLSearchParams(location.search);
  const PI = Math.PI, HP = PI / 2, TAU = PI * 2, sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max, hyp = Math.hypot, atan2 = Math.atan2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t, sst = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const eio = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }, eo = u => 1 - Math.pow(1 - clamp(u, 0, 1), 2.2), V3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
  const BPM = 120, BEAT = 60 / BPM, LEN = 72, TITLE = 64;
  let game = null, G = null, X = null;
  const D = { on: false, mode: '', t: 0, i: -1, done: false, res: null, pool: null, warmed: false, warming: false, c: null, e: 0, cb: 0, wb: undefined, cut: 0, mb: null, keep: null, el: null, long: [], cuts: [], log: [], skipped: false, at: -1, roll: 0, fov: 40, offs: [], hidP: [] };
  const warn = (l, e) => { D.log.push(l + ': ' + (e && e.message || e)); if (window.console) console.warn('[demo] ' + l, e); };
  const safe = (l, f, fb) => { try { return f(); } catch (e) { warn(l, e); return fb; } };
  const gy = (x, z) => { try { return game.groundY(x, z, 0); } catch (e) { return 0; } };
  const TER = () => GT.coastTerrain || { SEA: -1, xw: () => -108 }, SEA = () => TER().SEA, xw = z => TER().xw(z);
  const F = (name, ...a) => { const f = GT.front; if (!f) return null; const p = name.split('.'); let o = f; for (let i = 0; i < p.length - 1; i++) o = o && o[p[i]]; const fn = o && o[p[p.length - 1]]; return typeof fn === 'function' ? safe('front.' + name, () => fn.apply(o, a), null) : null; };
  const active = () => !!(GT.coast && GT.coast.active && GT.cngame);

  /* ================================================================== the cast: vehicles (the game's own, kinematic), people (GT.people), boats (js/coast_sea.js) */
  const CARS = [];
  function car(kind, o) { const e = safe('mkEnt ' + kind, () => X.mkEnt(kind, Object.assign({ mode: 'scripted', tag: 'demo', x: 0, z: -3000 - CARS.length * 14, h: 0 }, o)), null); if (!e) return null; e.locked = true; if (e.veh) { e.veh.locked = true; e.veh.enter = false; } e.demo = true; CARS.push(e); stash(e); return e; }
  function stash(e) { if (!e) return; e.on = false; e.x = 40 + CARS.indexOf(e) * 14; e.z = -3200; e.y = -40; e.v = 0; e.pitch = e.roll = e.steer = e.bump = 0; const L = e.lights; L.head = L.brake = L.siren = L.hazard = false; }
  function put(e, x, z, h, v, o) { if (!e) return; o = o || {}; e.on = true; e.x = x; e.z = z; e.h = h; e.v = v || 0; e.y = o.y !== undefined ? o.y : gy(x, z); e.pitch = o.pitch || 0; e.roll = o.roll || 0; e.steer = o.steer || 0; e.bump = o.bump || 0; const L = e.lights; L.head = !!o.head; L.brake = !!o.brake; L.siren = !!o.siren; L.hazard = !!o.hazard; }
  /** a straight run: start point, heading, speed, time */
  function run(e, x0, z0, h, v, t, o) { put(e, x0 + sin(h) * v * t, z0 + cos(h) * v * t, h, v, o); }
  /** a point relative to a vehicle: f metres ahead, s to its left, u above its wheels */
  const rel = (e, f, s, u) => [e.x + sin(e.h) * f + cos(e.h) * s, (e.y || 0) + u, e.z + cos(e.h) * f - sin(e.h) * s];
  const ACT = [];
  function actor(type, seed) { const fig = safe('people.make ' + type, () => GT.people.make(type, { seed, phone: false }), null); if (!fig || !fig.group) return null; G.scene.add(fig.group); fig.group.visible = false; const a = { fig, type, x: 0, y: 0, z: 0, h: 0, st: 'idle', sp: 0, ph: 0, on: false, bad: false }; ACT.push(a); return a; }
  function pose(a, x, z, h, st, o) { if (!a) return; o = o || {}; a.on = true; a.x = x; a.z = z; a.h = h; a.st = st || 'idle'; a.sp = o.sp || 0; a.ph = o.ph || 0; a.y = o.y !== undefined ? o.y : gy(x, z); }
  function walk(a, x0, z0, h, v, t, o) { if (!a) return; pose(a, x0 + sin(h) * v * t, z0 + cos(h) * v * t, h, 'walk', Object.assign({ sp: v }, o)); }
  const UPD = {};
  function actTick(dt, t) { for (const a of ACT) { const g = a.fig.group; if (!a.on) { if (g.visible) g.visible = false; continue; } g.visible = true; g.position.set(a.x, a.y, a.z); g.rotation.y = a.h; if (a.bad) continue;
    UPD.state = a.st; UPD.speed = a.sp; UPD.t = t + a.ph; UPD.snap = !!a.snap; UPD.steer = 0; UPD.sync = undefined; UPD.variant = undefined; UPD.drop = undefined; a.snap = false; try { a.fig.update(dt, UPD); } catch (e) { a.bad = true; warn('actor ' + a.type, e); } } }
  /* boats: a shot can take one of the sea's boats and run it on its own line (b.path is an arc-length line, so th = metres along it) */
  const BO = { list: null, taken: [] };
  function boats() { if (BO.list) return BO.list; const p = GT.coast && GT.coast.state && GT.coast.state.parts && GT.coast.state.parts.sea; BO.list = p && p.boats ? p.boats : []; return BO.list; }
  function boat(kind, n) { let k = 0; for (const b of boats()) if (b.kind === kind && !b.fixed && !b.lin) { if (k++ === (n || 0)) return b; } return null; }
  function steer(b, x0, z0, h, v, t) { if (!b) return; if (!b._keep) { b._keep = { path: b.path, th: b.th, speed: b.speed }; BO.taken.push(b); } const dx = sin(h), dz = cos(h); b.path = th => [x0 + dx * th, z0 + dz * th]; b.speed = v; b.th = v * t; }
  function circle(b, cx, cz, r, v, t, ph) { if (!b) return; if (!b._keep) { b._keep = { path: b.path, th: b.th, speed: b.speed }; BO.taken.push(b); } b.path = th => [cx + r * sin(th / r + ph), cz + r * cos(th / r + ph)]; b.speed = v; b.th = v * t; }
  function freeBoats() { for (const b of BO.taken) { if (b._keep) { b.path = b._keep.path; b.th = b._keep.th; b.speed = b._keep.speed; b._keep = null; } } BO.taken.length = 0; }

  /* ================================================================== props built for the film */
  function canvasTex(w, h, draw, rep) { const c = doc.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); t.anisotropy = 8; return t; }
  function buildFence() {
    /* 060 m of chain-link on posts with a raked top arm, three strands of barbed wire and a concertina coil (the silhouette of 006–007 in our own palm park) */
    const L = 60, H = 2.7, grp = new T.Group(); grp.name = 'demo_fence';
    const net = canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.closePath(); g.stroke(); }, [L / .11, H / .11]);
    const netM = new T.MeshStandardMaterial({ color: 0x6a6e74, roughness: .45, metalness: .75, alphaMap: net, alphaTest: .45, side: T.DoubleSide }); netM.userData.gtNoProbe = 1;
    const steel = new T.MeshStandardMaterial({ color: 0x2c2e32, roughness: .5, metalness: .7 }); steel.userData.gtNoProbe = 1;
    const K = GT.kit(); K.quad(netM, L, H, 0, H / 2 + .05, 0, { ry: HP });
    for (let z = -L / 2; z <= L / 2 + .01; z += 3.2) { K.cyl(steel, .045, .05, H + .5, 0, (H + .5) / 2, z, { seg: 8 }); K.cyl(steel, .03, .03, .9, -.32, H + .78, z, { seg: 6, rz: -.62 }); }
    K.cyl(steel, .03, .03, L, 0, H + .1, 0, { seg: 6, rx: HP }); for (const k of [0, 1, 2]) K.cyl(steel, .006, .006, L, -.12 - k * .2, H + .45 + k * .15, 0, { seg: 4, rx: HP });
    const fixed = K.build({ cast: true }); grp.add(fixed);
    /* the coil: overlapping rings, each a little turned, one instanced mesh */
    const N = Math.round(L / .16), ring = new T.TorusGeometry(.36, .011, 4, 28), im = new T.InstancedMesh(ring, steel, N), m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), s = new T.Vector3(1, 1, 1), p = new T.Vector3();
    for (let i = 0; i < N; i++) { const z = -L / 2 + i * .16, j = sin(i * 12.9898) * .5; e.set(.35 * sin(i * 1.7), HP + .3 * j, 0); q.setFromEuler(e); p.set(-.2 + .04 * j, H + .74 + .03 * cos(i * 2.3), z); s.setScalar(.92 + .12 * abs(j)); m.compose(p, q, s); im.setMatrixAt(i, m); }
    im.castShadow = true; grp.add(im); grp.visible = false; G.scene.add(grp); return { grp, geos: [ring], mats: [netM, steel], tex: [net] };
  }
  function buildSign() {
    /* MOONBAY in nine-metre block letters on a steel frame and legs, on the dune crest; the face reads from the land side (the sun sets behind it over the sea) */
    const grp = new T.Group(); grp.name = 'demo_moonbay'; const face = new T.MeshStandardMaterial({ color: 0x9a9084, roughness: .9, metalness: .05 }), steel = new T.MeshStandardMaterial({ color: 0x34322f, roughness: .7, metalness: .5 });
    const K = GT.kit(), H = 9, W = 6, SW = 1.45, TH = .45, GAP = 1.6, LEG = 2.2;
    const bar = (x0, y0, x1, y1, w) => { const dx = x1 - x0, dy = y1 - y0, l = hyp(dx, dy); K.box(face, l + w * .02, w, TH, (x0 + x1) / 2, (y0 + y1) / 2 + LEG, 0, { rz: atan2(dy, dx) }); };
    const ring = (cx, cy, rx, ry, w, a0, a1) => { const sh = new T.Shape(), n = 28; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); sh[i ? 'lineTo' : 'moveTo'](cx + cos(a) * rx, cy + sin(a) * ry); } for (let i = n; i >= 0; i--) { const a = lerp(a0, a1, i / n); sh.lineTo(cx + cos(a) * (rx - w), cy + sin(a) * (ry - w)); }
      const g = new T.ExtrudeGeometry(sh, { depth: TH, bevelEnabled: false, curveSegments: 4 }); g.translate(0, LEG, -TH / 2); K.geo(face, g); };
    const L = { M: x => { bar(x + SW / 2, 0, x + SW / 2, H, SW); bar(x + W - SW / 2, 0, x + W - SW / 2, H, SW); bar(x + SW * .6, H - SW * .4, x + W / 2, H * .38, SW * .95); bar(x + W - SW * .6, H - SW * .4, x + W / 2, H * .38, SW * .95); },
      O: x => ring(x + W / 2, H / 2, W / 2, H / 2, SW, 0, TAU),
      N: x => { bar(x + SW / 2, 0, x + SW / 2, H, SW); bar(x + W - SW / 2, 0, x + W - SW / 2, H, SW); bar(x + SW * .7, H - SW * .5, x + W - SW * .7, SW * .5, SW); },
      B: x => { bar(x + SW / 2, 0, x + SW / 2, H, SW); bar(x + SW, H - SW / 2, x + W * .55, H - SW / 2, SW); bar(x + SW, H * .5, x + W * .55, H * .5, SW * .9); bar(x + SW, SW / 2, x + W * .55, SW / 2, SW); ring(x + W * .55, H * .74, W * .42, H * .26, SW, -HP, HP); ring(x + W * .55, H * .26, W * .45, H * .26, SW, -HP, HP); },
      A: x => { bar(x + SW * .55, 0, x + W / 2, H, SW * 1.05); bar(x + W - SW * .55, 0, x + W / 2, H, SW * 1.05); bar(x + W * .26, H * .33, x + W * .74, H * .33, SW * .85); },
      Y: x => { bar(x + SW * .55, H, x + W / 2, H * .46, SW); bar(x + W - SW * .55, H, x + W / 2, H * .46, SW); bar(x + W / 2, 0, x + W / 2, H * .5, SW * 1.05); } };
    const word = 'MOONBAY', tot = word.length * W + (word.length - 1) * GAP; let x = -tot / 2;
    for (const ch of word) { L[ch](x); /* frame behind each letter, legs into the sand */ for (const fx of [.8, W - .8]) { K.box(steel, .18, H + LEG + .4, .18, x + fx, (H + LEG) / 2 - .2, -TH / 2 - .45); }
      for (const fy of [.3, .5, .72]) K.box(steel, W - .6, .14, .14, x + W / 2, LEG + H * fy, -TH / 2 - .45); K.box(steel, .12, hyp(W - 1.6, H * .7), .12, x + W / 2, LEG + H * .45, -TH / 2 - .5, { rz: atan2(W - 1.6, H * .7) }); x += W + GAP; }
    const g = K.build({ cast: true }); grp.add(g); grp.visible = false; G.scene.add(grp); return { grp, len: tot, mats: [face, steel] };
  }
  function buildDust() {
    const N = 380, pos = new Float32Array(N * 3), aux = new Float32Array(N * 2), geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('aux', new T.BufferAttribute(aux, 2));
    const mat = new T.ShaderMaterial({ uniforms: { uCol: { value: new T.Color(1, .8, .6) }, uScale: { value: 500 } }, transparent: true, depthWrite: false,
      vertexShader: 'attribute vec2 aux; varying float vA; varying float vS; uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = min(900.0, aux.x * uScale / max(0.5, -mv.z)); vA = aux.y; vS = fract(position.x * 0.37 + position.z * 0.53) * 40.0; }',
      fragmentShader: 'uniform vec3 uCol; varying float vA; varying float vS; float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + 1.0), f.x), f.y); } void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; vec2 q = gl_PointCoord * 3.0 + vS; float m = 0.55 * n(q) + 0.3 * n(q * 2.3 + 7.0) + 0.15 * n(q * 5.1 + 3.0); float a = (1.0 - smoothstep(0.1, 1.0, r)) * smoothstep(0.25, 0.75, m + 0.35 * (1.0 - r)); a = a * vA; if (a < 0.003) discard; gl_FragColor = vec4(uCol * (0.8 + 0.4 * (0.5 - d.y)), a); }' });
    mat.blending = T.CustomBlending; mat.blendSrc = T.SrcAlphaFactor; mat.blendDst = T.OneMinusSrcAlphaFactor; mat.blendSrcAlpha = T.ZeroFactor; mat.blendDstAlpha = T.OneFactor;   /* the alpha channel carries js/render.js's wet-ground flag: dust leaves it alone */
    const pts = new T.Points(geo, mat); pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 6; G.scene.add(pts); return { pts, pos, aux, geo, mat, N };
  }
  /** the plume as a pure function of the shot clock: particle i leaves the rear wheels of `src(t)` at its birth time and grows, rises and drifts (seekable) */
  function dust(t, dur, src, o) { const P = D.pool && D.pool.dust; if (!P) return; o = o || {}; P.pts.visible = true; const N = P.N, life = o.life || 2.6, wind = o.wind || [.6, 0, .4];
    for (let i = 0; i < N; i++) { const tb = -life * .6 + (i / N) * (dur + life * .6), age = t - tb, k = i * 3, r1 = sin(i * 12.99) * 43758.5 % 1, r2 = sin(i * 78.23) * 12345.6 % 1, r3 = sin(i * 39.42) * 9876.5 % 1;
      if (age < 0 || age > life) { P.aux[i * 2 + 1] = 0; P.pos[k] = 0; P.pos[k + 1] = -99; P.pos[k + 2] = 0; continue; }
      const s = src(tb, i & 1), sp = .9 + 1.4 * abs(r1); P.pos[k] = s[0] + (r1 * 1.4 + wind[0]) * age * sp; P.pos[k + 1] = s[1] + .25 + (.35 + abs(r2) * .9) * Math.pow(age, .8); P.pos[k + 2] = s[2] + (r3 * 1.4 + wind[2]) * age * sp;
      P.aux[i * 2] = (o.size || 1) * (.5 + 3.4 * Math.pow(age / life, .55)) * (.75 + .5 * abs(r2)); P.aux[i * 2 + 1] = (o.a || .32) * min(1, age * 6) * Math.pow(1 - age / life, 1.2); }
    P.geo.attributes.position.needsUpdate = true; P.geo.attributes.aux.needsUpdate = true;
    { const cam = G.camera, R = GT.render && GT.render.renderer, hpx = R ? R.domElement.height : innerHeight; if (cam) P.mat.uniforms.uScale.value = hpx / (2 * Math.tan(cam.fov * PI / 360)); }
    const env = GT.env || {}, sc = env.sunColor, k2 = o.k || 1.6; if (sc) P.mat.uniforms.uCol.value.setRGB(sc.r * k2 + .12, sc.g * k2 * .92 + .1, sc.b * k2 * .8 + .1); }

  /* ================================================================== prepare: build the cast once (kept hidden between plays) */
  function bind(g) { game = g; G = g.G; X = g.sim; }
  function prepare(g, o) {
    if (!active()) return false; bind(g); o = o || {}; if (D.pool) { readd(); if (o.warm && !D.warmed) startWarm(); return true; } if (!G || !G.visual || !X || !T || !X.mkEnt) return false;
    const pool = D.pool = { cars: CARS, act: ACT };
    pool.W = car('sports', { color: 0xf3f1ec, opts: { variant: 'roadster' }, rider: 'patron_f', plate: 'MB·7731' });          /* the white open-top (night drive, the neon row, the dancer's car) */
    pool.R = car('sports', { color: 0xc8161c, plate: 'PVT·0911' });                                          /* the red one the police want */
    pool.C1 = car('police', {}); pool.C2 = car('police', {});   /* closed cars carry no figure: the seated drivers poke through low roofs */
    pool.M = car('muscle', { color: 0xd8461c, plate: 'DUNE·66' });                                            /* the orange muscle car in the sand */
    pool.P = car('muscle', { color: 0xd8307a, opts: { variant: 'conv' }, rider: 'patron_m', plate: 'JADE·88' });                 /* the magenta convertible in 玉埠 */
    pool.gen = [car('sedan', { color: 0xe8e6e0 }), car('suv', { color: 0x1c1e22 }), car('pickup', { color: 0x8a8e94 }), car('hatch', { color: 0x2a5a8a }), car('sedan', { color: 0xb01c1c }), car('suv', { color: 0xd8d4c8 })].filter(Boolean);
    pool.walk = [actor('beach_f', 3), actor('beach_m', 5), actor('tourist_f', 8), actor('beach_f', 11)].filter(Boolean);
    pool.stand = actor('streamer_f', 4); pool.fans = [actor('tourist', 21), actor('guest', 22), actor('beach_m', 23)].filter(Boolean);
    pool.dance = [actor('patron_f', 31), actor('patron_m', 32), actor('streamer_f', 33), actor('tourist_f', 34)].filter(Boolean);
    pool.fence = safe('fence', buildFence, null); pool.sign = safe('sign', buildSign, null); pool.dust = safe('dust', buildDust, null);
    overlay(); loadAudio();
    if (o.warm) startWarm(); return true;
  }
  /** after a play the cast is out of the scene; a replay puts the same objects back (no new materials, so nothing compiles again) */
  function readd() { for (const e of CARS) { if (!e.alive) { e.alive = true; if (e.veh.group) G.scene.add(e.veh.group); G.ents.push(e); G.vehDirty = true; } stash(e); } for (const a of ACT) { if (!a.fig.group.parent) G.scene.add(a.fig.group); a.on = false; }
    const P = D.pool; for (const k of ['fence', 'sign']) if (P[k] && !P[k].grp.parent) G.scene.add(P[k].grp); if (P.dust && !P.dust.pts.parent) G.scene.add(P.dust.pts); }
  function takeOut() { for (const e of CARS) { stash(e); safe('removeEnt', () => X.removeEnt(e)); } for (const a of ACT) { a.on = false; if (a.fig.group.parent) a.fig.group.parent.remove(a.fig.group); }
    const P = D.pool; if (!P) return; for (const k of ['fence', 'sign']) if (P[k] && P[k].grp.parent) P[k].grp.parent.remove(P[k].grp); if (P.dust && P.dust.pts.parent) P.dust.pts.parent.remove(P.dust.pts); }
  function showPeople() { for (const n of D.hidP) if (n.vis !== false && n.group) n.group.visible = true; D.hidP.length = 0; }
  function hideAll() { showPeople(); for (const e of CARS) if (e.on) stash(e); for (const a of ACT) a.on = false; const P = D.pool; if (P) { if (P.fence) P.fence.grp.visible = false; if (P.sign) P.sign.grp.visible = false; if (P.dust) P.dust.pts.visible = false; } freeBoats(); }

  /* ================================================================== camera helpers */
  /** handheld: the aim wanders a few milliradians on detuned sines, plus a little roll (k = 0 locked off, .2 a breathing tripod, 1 shoulder, 2 phone) */
  function hand(O, t, k, f) { f = f || 1; const d = hyp(O.l[0] - O.p[0], O.l[1] - O.p[1], O.l[2] - O.p[2]) || 1, a = .0055 * k * d;
    O.l[0] += (sin(t * 1.9 * f + 1) + .6 * sin(t * 3.3 * f) + .25 * sin(t * 7.1 * f + 2)) * a; O.l[1] += (sin(t * 2.3 * f + 2) + .5 * sin(t * 4.1 * f + .5) + .25 * sin(t * 8.3 * f)) * a * .8;
    O.l[2] += (sin(t * 1.7 * f + 4) + .6 * sin(t * 2.9 * f + 3)) * a; O.r += (sin(t * 1.3 * f + .7) + .5 * sin(t * 2.7 * f)) * .007 * k; }
  const dolly = (O, u, p0, p1, l0, l1, f0, f1) => { O.p = V3(p0, p1 || p0, u); O.l = V3(l0, l1 || l0, u); O.f = lerp(f0, f1 === undefined ? f0 : f1, u); };

  /* ================================================================== the shot list (film seconds; one beat = 0.5 s, one bar = 2 s; the cuts sit on beats) */
  /* the causeway of js/coast_sea.js (GT.coastBridge: A → B, road surface top(s), SC = the middle of the channel span); BR.n is the normal on its south side (towards the city, the island-bound lanes).
     BR (2026-11-17): the bridge is now modelled for real (girders, piers, lamps, its own traffic), so the film no longer lays a deck of its own over it. */
  const CB = GT.coastBridge || null, BR = CB ? { A: CB.A, B: CB.B, L: CB.L, u: CB.u, n: CB.n, h: CB.h, SC: CB.SC, y: CB.top, at: CB.at } : { A: [-60, 1190], B: [-1420, 1760] };
  if (!CB) { BR.L = hyp(BR.B[0] - BR.A[0], BR.B[1] - BR.A[1]); BR.u = [(BR.B[0] - BR.A[0]) / BR.L, (BR.B[1] - BR.A[1]) / BR.L]; BR.n = [-BR.u[1], BR.u[0]]; if (BR.n[1] > 0) BR.n = [-BR.n[0], -BR.n[1]]; BR.SC = BR.L * .45;
    BR.h = atan2(BR.u[0], BR.u[1]); BR.y = s => SEA() + 7.5 + 17 * Math.exp(-(((s - BR.L * .45) / 120) ** 2)) + 1.45; BR.at = (s, off) => [BR.A[0] + BR.u[0] * s + BR.n[0] * (off || 0), BR.A[1] + BR.u[1] * s + BR.n[1] * (off || 0)]; }
  const P_ = () => D.pool || {};
  const SH = [
    { n: '黄昏大道', ref: '003', d: 4, h: 19.12, ev: -.25, flare: .6, amb: { street: .5, waves: .25 }, hide: [6, -102, 270, -88],
      /* 灯笼街 runs east-west from the back road to 月湾大道: from above the back road the street, 玉埠's roofs and the hotel row lead straight into the sun over the sea */
      step(S, t) { const g = P_().gen || [], P = P_(); [[g[0], 120, -96.6, 9], [g[1], 96, -96.6, 8.5], [P.W, 72, -96.6, 9]].forEach(q => run(q[0], q[1], q[2], -HP, q[3], t, { head: true }));
        [[g[3], 40, -93.4, 8.5], [g[4], 70, -93.4, 9], [g[5], 104, -93.4, 8]].forEach(q => run(q[0], q[1], q[2], HP, q[3], t, { head: true })); },
      cam(S, t, u, O) { dolly(O, eio(u), [162, 31, -92], [151, 29, -93], [-150, -10, -102], [-150, -10, -101.5], 36, 34); hand(O, t, .15); } },
    { n: '铁丝网', ref: '006', d: 3, h: 18.95, ev: -.35, flare: .7, amb: { wind: .5, street: .2 },
      enter() { const f = P_().fence; if (f) { f.grp.position.set(-24, gy(-24, 94) - .05, 94); f.grp.visible = true; } },
      cam(S, t, u, O) { const y = gy(-21.2, 88); dolly(O, u, [-21.2, y + 1.5, 85], [-21.2, y + 1.62, 91], [-200, 30, 56], [-200, 30, 60], 44, 43); hand(O, t, .2); } },
    { n: '日落海滩', ref: '007', d: 3, h: 19.05, ev: -.6, flare: .8, amb: { waves: .7, wind: .2 },
      step(S, t) { const W = P_().walk || []; walk(W[1], -98.5, 30.5, 0, 1.1, t); walk(W[0], -99.6, 29.4, 0, 1.1, t, { ph: .4 }); },
      cam(S, t, u, O) { const y = gy(-72.5, 41.5); dolly(O, u, [-72.5, y + .55, 41.5], [-73.8, y + .62, 40.2], [-100, 5, 36], [-100, 5.3, 35.4], 40, 39); hand(O, t, .2); } },
    { n: '快艇俯拍', ref: '012', d: 2, h: 13.6, ev: 0, amb: { waves: .6, engine: .25 },
      step(S, t) { steer(boat('speed', 0), -160, -80, .36, 15, t + 1); },
      cam(S, t, u, O) { const dx = sin(.36), dz = cos(.36), k = 15 * .74 * (t + 1) + 8; O.p = [-160 + dx * k + 2, 31, -80 + dz * k - 1.5]; O.l = [O.p[0] + dx * 1.2, 0, O.p[2] + dz * 1.2]; O.f = 38; O.r = -.55; hand(O, t, .15, .6); } },
    { n: '海滩航拍', ref: '014', d: 3, h: 13.6, ev: .05, amb: { waves: .5, beach: .5 },
      step(S, t) { steer(boat('jet', 0), -150, -110, .2, 9, t); steer(boat('jet', 1), -138, -70, 2.9, 10, t); },
      cam(S, t, u, O) { dolly(O, eio(u * .9 + .1), [-222, 24, -128], [-188, 40, -92], [-70, 4, -30], [5, 20, 2], 48, 46); hand(O, t, .12); } },
    { n: '黑卡', d: 1, black: 1, amb: {}, cam(S, t, u, O) { O.p = [0, 50, 0]; O.l = [1, 50, 0]; O.f = 40; } },
    { n: '仰拍高楼', ref: '018', d: 2, h: 13.6, ev: .1, flare: .8, amb: { wind: .55, street: .35 }, hide: [-12, -40, 8, 10],
      cam(S, t, u, O) { const p = D.palm || [-11, -14], y = gy(p[0] - 4.2, p[1]); dolly(O, u, [p[0] - 4.4, y + .4, p[1] - .4], [p[0] - 4.0, y + .45, p[1] - .1], [86, 62, -10], [86, 70, -6], 66, 64); O.r = lerp(-.16, -.05, eio(u)); hand(O, t, .2); } },
    { n: '海滩人群', ref: '022', d: 2, h: 14.2, ev: .05, amb: { beach: .8, waves: .4 }, hide: [-109, 32, -92, 68], hideP: 1,
      /* the near crowd is the film's own: two walk towards the lens, two cross it in opposite directions, one walks away; the beach's own people in the foreground are kept out of this shot */
      step(S, t) { const W = P_().walk || [], F = P_().fans || []; walk(W[0], -99.6, 50.5, -.06, 1.3, t); walk(W[2], -97.6, 45.2, .1, 1.2, t, { ph: .6 }); walk(W[1], -105.6, 49.4, HP - .12, 1.4, t, { ph: .3 }); walk(W[3], -95.6, 52.6, -HP + .1, 1.3, t, { ph: .9 }); walk(F[2], -102.9, 55.6, PI + .05, 1.15, t, { ph: .2 }); },
      cam(S, t, u, O) { const y = gy(-101.2, 64); dolly(O, u, [-101.2, y + 1.4, 64.5], [-101.2, y + 1.42, 63.2], [-98.5, 1.3, 25], [-98.5, 1.3, 25], 20, 20); hand(O, t, .35); } },
    { n: '桥下快艇', ref: '024', d: 2, h: 14.6, ev: 0, amb: { waves: .5, engine: .8 },
      /* BR: a speedboat bursts out of the navigation channel under the high span, straight at a lens skimming the water; the box girder and a main pier fill the top of the frame */
      step(S, t) { const hn = atan2(BR.n[0], BR.n[1]), s0 = BR.at(BR.SC + 4, 4); steer(boat('speed', 1), s0[0], s0[1], hn - .05, 29, t); const s1 = BR.at(BR.SC - 14, -26); steer(boat('jet', 1), s1[0], s1[1], hn + .05, 17, t); },
      cam(S, t, u, O) { const c0 = BR.at(BR.SC + 9, 74), c1 = BR.at(BR.SC + 8.5, 72), l0 = BR.at(BR.SC + 1, 0), l1 = BR.at(BR.SC + 2, 8); dolly(O, eio(u), [c0[0], SEA() + 1.15, c0[1]], [c1[0], SEA() + 1.3, c1[1]], [l0[0], 9, l0[1]], [l1[0], 6.5, l1[1]], 36, 38); hand(O, t, .3, 1.1); } },
    { n: '夜晚敞篷车', ref: '026', d: 2, h: 21.6, ev: .15, amb: { night: .6, engine: .55 }, hide: [-5, -230, 0.6, -120],
      step(S, t) { const P = P_(); run(P.W, -1.9, -198, 0, 12.5, t, { head: true }); if (P.stand && P.W) { const q = rel(P.W, -.4, -.4, .45); pose(P.stand, q[0], q[2], P.W.h, 'cheer', { y: q[1] }); } },
      cam(S, t, u, O) { const e = P_().W; if (!e) return; O.p = rel(e, -2.3, .45, 1.95); O.l = rel(e, 14, -.5, 1.5); O.f = 58; hand(O, t, .7, 1.2); } },
    { n: '唐人街改装车', ref: '029', d: 2, h: 14.0, ev: 0, amb: { market: .55, engine: .3 }, hide: [40, -99, 100, -91],
      step(S, t) { const P = P_(); run(P.P, 64, -94, -HP, 3.4, t, { head: false }); if (P.P) { P.P.pitch = .05 * sin(t * 6.5); P.P.bump = .06 * abs(sin(t * 6.5)); } },
      cam(S, t, u, O) { dolly(O, u, [44.5, .5, -95.9], [45.3, .5, -95.9], [80, 2.4, -94.2], [80, 2.4, -94.2], 30, 29); hand(O, t, .3); } },
    { n: '夜景航拍', ref: '034', d: 2, h: 21.6, ev: .1, amb: { night: .45, waves: .2 },
      cam(S, t, u, O) { dolly(O, u, [-172, 150, -332], [-158, 147, -300], [26, 0, -62], [36, 0, -44], 46, 45); hand(O, t, .1); } },
    { n: '霓虹酒店街', ref: '035', d: 2, h: 21.6, ev: .1, amb: { night: .6, club: .25 }, hide: [2.5, -142, 8, -120],
      enter() { put(P_().W, 5.45, -131, PI, 0); if (P_().W && P_().W.rider) P_().W.rider.group.visible = false; }, exit() { const W = P_().W; if (W && W.rider) W.rider.group.visible = true; },
      cam(S, t, u, O) { dolly(O, eio(u), [3.1, .5, -137.8], [2.9, .55, -136.4], [9.5, 3.5, -121], [9.5, 3.7, -121], 52, 51); hand(O, t, .2); } },
    { n: '跨海桥航拍', ref: '039', d: 2, h: 15.3, ev: -.12, amb: { waves: .4, wind: .3 },
      /* BR: from high on the north side with the sun behind the lens: the causeway runs out to the key, its shadow lies on the shallows beside it, boats cut wakes along it */
      step(S, t) { const s0 = BR.at(330, -70); steer(boat('speed', 2), s0[0], s0[1], BR.h, 17, t); const s1 = BR.at(560, -120); steer(boat('cat', 0), s1[0], s1[1], BR.h + PI - .1, 6, t); const s2 = BR.at(470, 60); steer(boat('speed', 3), s2[0], s2[1], BR.h + PI + .15, 15, t); },
      cam(S, t, u, O) { const c0 = BR.at(190, -215), c1 = BR.at(232, -206), l0 = BR.at(950, 25), l1 = BR.at(985, 28); dolly(O, u, [c0[0], 168, c0[1]], [c1[0], 160, c1[1]], [l0[0], 0, l0[1]], [l1[0], 0, l1[1]], 48, 47); hand(O, t, .1); } },
    { n: '蓝调招牌', ref: '041', d: 2, h: 19.4, ev: 0, amb: { street: .35, wind: .3 },
      cam(S, t, u, O) { dolly(O, eio(u), [2.4, 1.0, -96.5], [2.7, 1.0, -98.8], [14, 13, -117], [14, 13.6, -118], 50, 49); O.r = lerp(.06, .02, u); hand(O, t, .2); } },
    { n: 'MOONBAY 大字', ref: '043', d: 3, h: 18.95, ev: -.8, flare: 1, amb: { wind: .55, waves: .3 },
      enter() { const s = P_().sign; if (s) { s.grp.position.set(-80, gy(-80, 0) + .2, 0); s.grp.rotation.y = HP; s.grp.visible = true; } },
      cam(S, t, u, O) { const y = gy(-55, -2); dolly(O, eio(u), [-54.5, y + .55, -2], [-56.5, y + .6, -2.4], [-80, 8.6, -.5], [-80, 8.8, -1], 46, 44); hand(O, t, .2); } },
    { n: '手机·水上摩托', ref: '045', d: 2.5, h: 14.5, ev: 0, ov: 'phone', who: '@沙滩巡逻队', txt: '这位大哥在浅水区转了四十圈了，救生员已经放弃劝说 #月湾 #白沙滩', amb: { waves: .7, beach: .5, engine: .3 },
      step(S, t) { circle(boat('jet', 0), -122, -27, 7, 9, t, 0); },
      cam(S, t, u, O) { const y = gy(-106, -32); O.p = [-106, y + 1.55, -32]; const b = boat('jet', 0), q = b ? [b.x, SEA() + .7, b.z] : [-122, 0, -27]; O.l = [lerp(-122, q[0], .6), q[1], lerp(-27, q[2], .6)]; O.f = 40; hand(O, t, 2, 1.1); } },
    { n: '手机·车上跳舞', ref: '049', d: 2.5, h: 16.6, ev: .1, ov: 'phone', who: '@moonbay.miri', txt: '谁的敞篷车？反正现在是我的舞台了 💃 #维尔蒙港 #月湾大道', amb: { street: .5, beach: .3 }, hide: [-7.5, -72, -3.4, -52],
      step(S, t) { const P = P_(); put(P.W, -5.45, -62, 0, 0); if (P.W && P.W.rider) P.W.rider.group.visible = false; if (P.stand && P.W) { const q = rel(P.W, -1.15, 0, .74); pose(P.stand, q[0], q[2], -HP, 'dance', { y: q[1] }); }
        const f = P.fans || []; pose(f[0], -7.9, -60.1, HP + .3, 'film'); pose(f[1], -8.3, -66.2, .9, 'cheer', { ph: .3 }); pose(f[2], -3.4, -65.6, -HP - .5, 'film', { ph: .6 }); },
      exit() { const W = P_().W; if (W && W.rider) W.rider.group.visible = true; },
      cam(S, t, u, O) { O.p = [-9.2, gy(-9.2, -65) + 1.6, -65]; O.l = [-5.4, 1.95, -63.1]; O.f = 64; hand(O, t, 2, 1.3); } },
    { n: '直播·霓虹街', ref: '053', d: 2.5, h: 21.6, ev: .6, ov: 'live', who: '@霓虹带夜巡', txt: '霓虹带今晚不睡觉 🔴', amb: { club: .7, night: .35 },
      step(S, t) { const d = P_().dance || []; [[9.6, -121.6], [10.9, -123.0], [8.9, -124.4], [11.4, -125.6], [10.0, -126.8]].forEach((q, i) => pose(d[i], q[0], q[1], .15 * sin(i * 2.1) + (i % 2 ? .5 : -.4), 'dance', { ph: i * .37 })); },
      cam(S, t, u, O) { O.p = [10.1, 1.55, -117.6]; O.l = [10.3, 1.45, -125]; O.f = 62; hand(O, t, 1.8, 1.2); } },
    { n: '新闻·大道堵车', ref: '074', d: 3.5, h: 15.5, ev: 0, ov: 'news', head: '月湾大道大堵车', sub: '游客停车看日落 · 整条大道一动不动', amb: { heli: .55, street: .35 }, hide: [-7, -96, 7, 6],
      step(S, t) { const g = P_().gen || [], P = P_(); const lane = [[g[0], 1.15, -16], [g[1], 3.25, -21], [g[2], 1.15, -23.5], [g[3], 3.25, -28], [g[4], 1.15, -31], [g[5], 3.25, -35], [P.W, 1.15, -38.5]];
        lane.forEach(q => put(q[0], q[1], q[2], PI, 0, { brake: true })); put(P.P, -.6, -46, HP + .35, 0, { hazard: true }); put(P.M, -2.4, -52.5, .2, 0, { hazard: true }); put(P.C1, -2.2, -33, .08, 0, { siren: true, head: true }); },
      cam(S, t, u, O) { const a = -2.2 + .25 * u; O.p = [-2 + 40 * cos(a), 40, -40 + 40 * sin(a)]; O.l = [0, 0, -38]; O.f = 32; hand(O, t, .55, .7); } },
    { n: '新闻·追车', ref: '079', d: 2.5, h: 15.5, ev: 0, ov: 'news', head: '红色跑车连闯三个路口', sub: '警方：司机称自己只是想赶上日落', amb: { heli: .5, siren: .6, engine: .4 }, hide: [-7, 40, 7, 240],
      step(S, t) { const P = P_(); run(P.R, 1.15, 178, PI, 30, t, { head: true }); run(P.C1, 3.25, 178 + 20, PI, 30, t, { siren: true, head: true }); run(P.C2, 1.15, 178 + 38, PI, 30.5, t, { siren: true, head: true }); },
      cam(S, t, u, O) { const e = P_().R; const z = e ? e.z : 120; O.p = [-36, 50, z - 24]; O.l = [2, 0, z + 14]; O.f = 34; hand(O, t, .6, .7); } },
    { n: '地面追车', ref: '079', d: 2, h: 15.5, ev: 0, amb: { siren: .9, engine: .9, street: .3 }, hide: [-7, 60, 7, 260], hideP: 1,
      step(S, t) { const P = P_(); run(P.R, 1.15, 156, PI, 33, t, { head: true }); run(P.C1, 3.25, 156 + 24, PI, 32, t, { siren: true, head: true }); run(P.C2, 1.15, 156 + 46, PI, 32.5, t, { siren: true, head: true }); },
      cam(S, t, u, O) { const e = P_().R; O.p = [-.5, .9, 110]; const tz = e ? max(e.z, 115) : 150; O.l = [lerp(1.2, 2.8, sst(tz, 124, 115)), .85, tz]; O.f = lerp(22, 36, sst(t, .7, 1.4)); hand(O, t, .5, 1.3); } },
    { n: '日落扬尘·远', ref: '084', d: 2.5, h: 18.75, ev: -.25, flare: .6, amb: { engine: .8, skid: .6, waves: .4 },
      step(S, t) { const P = P_(), e = P.M; if (!e) return; const z = 22 - 15.5 * t, x = -99.5 + 1.6 * sin(t * 1.4); put(e, x, z, PI - .42 + .12 * sin(t * 2.2), 15.5, {}); dust(t, S.d, (tb, w) => { const zb = 22 - 15.5 * tb, xb = -99.5 + 1.6 * sin(tb * 1.4); return [xb + (w ? .9 : -.9) - .7, gy(xb, zb), zb + 2.2]; }, { size: 1.0, a: .5, k: 2.6 }); },
      cam(S, t, u, O) { const y = gy(-80, 8); O.p = [-80, y + .45, 8]; const e = P_().M; O.l = e ? [lerp(-102, e.x, .45), 1.2, lerp(2, e.z, .45)] : [-102, 1.2, 2]; O.f = 30; hand(O, t, .4, 1.1); } },
    { n: '日落扬尘·近', ref: '086', d: 2, h: 18.75, ev: -.25, flare: .9, amb: { engine: 1, skid: .5, waves: .3 },
      step(S, t) { const P = P_(), e = P.M; if (!e) return; const z = -20 - 13 * t, x = -105 - 1.2 * t; put(e, x, z, PI + .1 + .3 * sin(t * 3.1), 13, {}); dust(t + 1.5, S.d + 1.5, (tb, w) => { const zb = -20 - 13 * (tb - 1.5), xb = -105 - 1.2 * (tb - 1.5); return [xb + (w ? .9 : -.9), gy(xb, zb), zb + 2.1]; }, { size: .7, a: .34, k: .95 }); },
      cam(S, t, u, O) { const e = P_().M; if (!e) return; O.p = [e.x - 1.0, max(gy(e.x - 1, e.z + 6), SEA() + .1) + .6, e.z + 6.4 + .6 * u]; O.l = [e.x + .3, .9, e.z - 6]; O.f = 48; hand(O, t, .8, 1.4); } },
    { n: '夜晚掠过', ref: '028', d: 2.5, h: 21.6, ev: .15, amb: { night: .5, engine: .9 }, hide: [-6, -150, 6, 40],
      step(S, t) { run(P_().R, 1.15, -60, PI, 34, t, { head: true }); },
      cam(S, t, u, O) { const e = P_().R; O.p = [-.4, .42, -112]; const tz = e ? max(e.z, -109) : -60; O.l = [lerp(.8, 2.6, sst(tz, -100, -109)), .8, tz]; O.f = lerp(30, 44, sst(t, 1.1, 1.5)); hand(O, t, .4, 1.4); } },
    { n: '金色海湾', ref: '016', d: 4, h: 18.7, ev: -.1, amb: { waves: .45, wind: .3 },
      step(S, t) { steer(boat('speed', 0), -200, 150, PI + .3, 14, t); steer(boat('jet', 1), -150, 60, PI - .2, 10, t); },
      cam(S, t, u, O) { dolly(O, eio(u), [-262, 58, 170], [-246, 70, 140], [30, 14, -40], [44, 18, -62], 42, 40); hand(O, t, .1); } },
    { n: '黑场', d: .5, black: 1, amb: {}, cam(S, t, u, O) { O.p = [0, 50, 0]; O.l = [1, 50, 0]; O.f = 40; } },
    { n: '片名', d: 8, black: 1, title: 1, amb: {}, cam(S, t, u, O) { O.p = [0, 50, 0]; O.l = [1, 50, 0]; O.f = 40; } }
  ];
  { let t = 0; SH.forEach((s, i) => { s.i = i; s.t0 = t; t += s.d; }); D.len = t; }
  const shotAt = t => { for (let i = SH.length - 1; i >= 0; i--) if (t >= SH[i].t0 - 1e-6) return i; return 0; };

  /* ================================================================== per frame */
  const O = { p: [0, 0, 0], l: [0, 0, 1], f: 40, r: 0 };
  /* the coast's sun path (the same curve as js/coast.js sunFor): js/atmos.js recomputes its state only when the hour changes, and the coast writes the new sun a little later in
     the same frame, so with the clock held the sun of the hour before would stay. It is written here first, then the hour is set, so the first frame of a cut has the right sun. */
  const EVE = [[12, 67.5], [16, 30], [17, 22], [17.5, 18], [18, 13.5], [18.5, 8.6], [19, 3.6], [19.2, 2], [19.45, 0], [19.6, -1.4]], MORN = [[5.6, -3], [6.1, 0], [6.5, 5], [7.5, 15], [8.5, 25], [10, 40], [12, 67.5]];
  const curve = (k, x) => { if (x <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (x <= k[i][0]) return lerp(k[i - 1][1], k[i][1], (x - k[i - 1][0]) / (k[i][0] - k[i - 1][0])); return k[k.length - 1][1]; };
  function sunFor(h) { if (QS.get('sun') === '0' || !GT.atmos) return; if (h > 5.7 && h < 19.6) { const e = h >= 12 ? curve(EVE, h) : curve(MORN, h), az = h >= 12 ? -HP - (HP - .5) * clamp((h - 12) / 5.25, 0, 1.35) : lerp(.25, -HP, clamp((h - 6) / 6, 0, 1)); GT.atmos.dbgSun = [az, max(1.2, e), e > 2 && h > 15 ? e + 6 * clamp((19.3 - h) / 1.5, 0, 1) : 0]; } else GT.atmos.dbgSun = null; }
  /* GT.atmos.setTime(h) with a jump re-bakes the whole 2048² cloud texture in one frame (60–80 ms: a stall at every cut). While the film plays the hour is moved through
     atmos.update's own clock instead (timeScale for exactly one frame, holdHour lifted): no full cloud bake, the sky and light follow at once, the environment map is
     re-baked in that frame by atmos's own rule (the last bake is always more than 1.5 s old at a cut), and the clouds re-light over the next two seconds as they do in play. */
  function hours(h) { if (h === undefined) return; const A = GT.atmos; if (!(abs(G.hours - h) > 1e-3 || G.holdHours !== h || abs((A && A.hours) - h) > 1e-3)) return; G.hours = h; G.holdHours = h; sunFor(h); if (!A) return;
    const d = min(max(D.dt || 0, 0), .1); if (D.mode === 'play' && d > .001 && A.setTime) { if (!D.ts) D.ts = [A.timeScale, A.holdHour]; A.holdHour = 99; A.timeScale = (h - A.hours) / d; A.hours = h; }
    else if (A.setTime) safe('setTime', () => A.setTime(h)); }
  function cut(i) { const c0 = performance.now(), old = SH[D.i]; if (old && old.exit) safe('exit ' + old.n, () => old.exit(old)); D.i = i; const S = SH[i]; hideAll(); hours(S.h);
    if (S.enter) safe('enter ' + S.n, () => S.enter(S)); D.cut = 2; if (D.mode === 'play') audioShot(S); ovShot(S); if (D.cuts && D.mode !== 'warm') D.cuts.push([i, Math.round(performance.now() - c0)]); }
  function stage(t, dt) { const i = shotAt(t); if (i !== D.i) cut(i); const S = SH[D.i], lt = t - S.t0; D.lt = lt;
    if (S.step) safe('step ' + S.n, () => S.step(S, lt, dt)); actTick(dt, lt);
    O.p = [0, 0, 0]; O.l = [0, 0, 1]; O.f = 40; O.r = 0; safe('cam ' + S.n, () => S.cam(S, lt, clamp(lt / S.d, 0, 1), O)); D.roll = O.r; D.fov = O.f;
    const sh = D.shot; if (sh) { sh.fol.at[0] = O.p[0]; sh.fol.at[1] = O.p[1]; sh.fol.at[2] = O.p[2]; D.tgt.x = O.l[0]; D.tgt.y = O.l[1]; D.tgt.z = O.l[2]; sh.f[0] = sh.f[1] = O.f; }
    ovTick(t); }
  function pre(dt) {
    if (D.ts && GT.atmos) { GT.atmos.timeScale = D.ts[0]; GT.atmos.holdHour = D.ts[1]; D.ts = null; }   /* the one-frame hour move of the last cut is over */
    if (!D.on) return; D.dt = dt; if (D.mode === 'warm') return warmStep(); if (D.mode === 'still') { stage(D.t, 0); return; }
    let t; if (D.mode === 'seek') { t = D.t; for (let k = 0; k < 10; k++) { t += 1 / 60; if (t >= D.at - 1e-4) { t = D.at; break; } if (k < 9) { D.t = t; stage(t, 1 / 60); } } if (t >= D.at - 1e-4) freeze(); }   /* up to ten 60 Hz steps a frame: every staged thing is a function of the shot clock */
    else { t = D.t + dt; const ta = audioTime(); if (ta !== null && ta >= 0) { const d = ta - t; if (abs(d) > .4) t = ta; else t += clamp(d, -.012, .03); } }
    const fdt = max(0, t - D.t); D.t = t; if (D.mode === 'play' && t >= D.len) { finish(false); return; } stage(t, D.mode === 'still' ? 0 : fdt);
  }
  const _v = T ? new T.Vector3() : null;
  function post(dt) {
    if (!D.on) return; const cam = G.camera, fx = GT.render && GT.render.fx, S = SH[D.i];
    if (D.roll && cam) cam.rotateZ(D.roll);
    if (fx) { if (D.cut > 0) { if (D.mb === null) D.mb = fx.mblur; fx.mblur = 0; D.cut--; } else if (D.mb !== null) { fx.mblur = D.mb; D.mb = null; } if (D.mode !== 'warm') expo(dt, fx, S); }
    if (S && S.hide) { const r = S.hide; for (const e of G.ents) if (!e.demo && e.veh && e.veh.group && e.x > r[0] && e.x < r[2] && e.z > r[1] && e.z < r[3]) e.veh.group.visible = false;
      if (S.hideP && G.pop && G.pop.list) for (const n of G.pop.list) if (n.group && n.group.visible && n.x > r[0] && n.x < r[2] && n.z > r[1] && n.z < r[3]) { n.group.visible = false; D.hidP.push(n); } }   /* people in the road of a chase: put back on the next cut */
    if (D.hero && D.hero.visible) D.hero.visible = false;
    if (D.mode !== 'warm') { flare(S, cam); if (S && (S.ov === 'phone' || S.ov === 'live') && (D.cut > 0 || D.mode === 'still' || (D.bgN = (D.bgN || 0) + 1) % 4 === 0)) Promise.resolve().then(copyBg); }   /* the blurred side panels are refreshed at 15 Hz: under that much blur nobody sees it, and each copy reads the frame back */
    if (D.mode === 'play') { const now = performance.now(), R = GT.render && GT.render.renderer, np = R && R.info && R.info.programs ? R.info.programs.length : 0; if (D.np && np > D.np) D.progs.push([+D.t.toFixed(2), np - D.np]); D.np = np; if (D.lf && now - D.lf > 28) D.long.push([+D.t.toFixed(2), Math.round(now - D.lf)]); if (D.lf) D.worst = max(D.worst || 0, now - D.lf); D.lf = now; D.frames = (D.frames || 0) + 1; }
  }
  /** exposure: manual at the level metered for this shot, with the meter's own lag (rates 3.2 / 1.1 per second, as in js/render.js) cancelled through the bias */
  function expo(dt, fx, S) { if (!S || !D.calib) return; let cb = fx.exposureBias; if (D.wb !== undefined && cb === D.wb) cb = D.cb; D.cb = cb;
    const E = S.E || D.Edef || 1; fx.autoExposure = false; fx.exposure = E; const d = dt > 0 ? min(dt, .1) : .016; if (!(D.e > 0)) D.e = E; D.e = lerp(D.e, E, 1 - Math.exp(-d * (E < D.e ? 3.2 : 1.1)));
    fx.exposureBias = D.wb = cb + Math.log2(E / D.e) + (S.ev || 0); }
  function meterTarget(avg) { const fx = GT.render.fx, env = GT.env || {}, night = env.night || 0, el = env.sunElev || 0;
    const key = fx.exposureKey * (1 - fx.nightDim * night) * (fx.sunny && night < .5 ? 1 - fx.lowSunDim + fx.lowSunDim * clamp((el - 2) / 20, 0, 1) : 1), mx = fx.exposureMax + (min(fx.exposureMax, fx.nightMax) - fx.exposureMax) * night * fx.look;
    return clamp(Math.pow(key / avg, .7) * Math.pow(min(.19 / avg, 1), .85), fx.exposureMin, mx); }

  /* ================================================================== lens flare: ghosts along the line from the sun through the centre (2D, screen blend), only where a shot asks for it */
  function flare(S, cam) { const cv = D.fl; if (!cv) return; const k = S && !S.black ? (S.flare || 0) : 0, g = cv.getContext('2d'); if (cv.width !== innerWidth || cv.height !== innerHeight) { cv.width = innerWidth; cv.height = innerHeight; }
    g.clearRect(0, 0, cv.width, cv.height); if (!(k > 0) || !cam || !GT.env) return; const sd = GT.env.trueSunDir || GT.env.sunDir; if (!sd || sd.y < -.02) return;
    _v.copy(sd).multiplyScalar(1000).add(cam.position).project(cam); if (_v.z > 1 || abs(_v.x) > 1.6 || abs(_v.y) > 1.6) return;
    const W = cv.width, H = cv.height, sx = (_v.x * .5 + .5) * W, sy = (-_v.y * .5 + .5) * H, cx = W / 2, cy = H / 2, edge = 1 - sst(max(abs(_v.x), abs(_v.y)), .85, 1.5), a = k * edge * clamp((GT.env.sunElev || 0) / 6 + .4, .2, 1);
    if (a < .01) return; g.globalCompositeOperation = 'lighter';
    let gr = g.createRadialGradient(sx, sy, 0, sx, sy, H * .55); gr.addColorStop(0, 'rgba(255,214,160,' + (.34 * a) + ')'); gr.addColorStop(.25, 'rgba(255,170,110,' + (.12 * a) + ')'); gr.addColorStop(1, 'rgba(255,140,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const G6 = [[.45, .05, '120,200,255', .14], [.7, .025, '255,190,120', .2], [1.15, .07, '170,255,200', .08], [1.45, .035, '255,120,180', .12], [1.85, .11, '140,170,255', .06]];
    for (const q of G6) { const px = sx + (cx - sx) * q[0] * 2, py = sy + (cy - sy) * q[0] * 2, r = H * q[1];
      const rg = g.createRadialGradient(px, py, r * .2, px, py, r); rg.addColorStop(0, 'rgba(' + q[2] + ',' + (q[3] * a * .5) + ')'); rg.addColorStop(.75, 'rgba(' + q[2] + ',' + (q[3] * a) + ')'); rg.addColorStop(1, 'rgba(' + q[2] + ',0)'); g.fillStyle = rg; g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'source-over'; }

  /* ================================================================== overlay: black, the presents card, phone and news frames, the title (inside #gtf so the wordmark styles apply) */
  const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.6 6.6 4.6c2.1 0 3.6 1.2 5.4 3.2 1.8-2 3.3-3.2 5.4-3.2 3.6 0 5.7 3.8 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>';
  const BUBBLE = '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>';
  const WM = '<div class="f-wm dm-wm"><span class="a"><i>BILIBILI</i><b>THEFT AUTO</b></span><span class="b">1</span></div>';
  const TICK = '维尔蒙港天气：晴，海风三级　·　救生员提醒：浅水区禁止水上摩托原地转圈　·　玉埠牌坊下周重新刷漆　·　月湾大道周末傍晚限行　·　海鸥抢游客薯条事件本周第七起　·　棕影公园新增四十张长椅　·　';
  const CMTS = [['kk_404', '这是哪家酒店门口？'], ['椰子不加冰', '音乐好上头'], ['海风收费站', '维尔蒙港的夜生活就是这么朴实无华'], ['lifeguard_dad', '明早六点还要上班的我默默点了个赞'], ['MiriFan', '左边那个大哥的舞步我学会了'], ['shell.ln', '霓虹带就没有安静的晚上'], ['夜跑的阿青', '路过，真的很吵，但是好看']];
  function overlay() {
    let host = doc.getElementById('gtf'); if (!host) { F('init'); host = doc.getElementById('gtf'); } if (!host) host = doc.body; if (D.el) { if (D.el.parentNode !== host) host.appendChild(D.el); return D.el; }
    const el = D.el = doc.createElement('div'); el.id = 'gt-demo'; el.className = 'dm';
    el.innerHTML = '<canvas class="dm-bg"></canvas><canvas class="dm-flare"></canvas><div class="dm-edge l"></div><div class="dm-edge r"></div>' +
      '<div class="dm-phone"><div class="ph-top"><span class="ph-live"><b>LIVE</b><em>1.2万 在看</em></span><span class="ph-ics"><i>' + BUBBLE + '</i><i>' + HEART + '</i></span></div><div class="ph-hearts"></div><div class="ph-cmts"></div>' +
        '<div class="ph-bot"><div class="ph-who"><i class="ph-av"></i><b></b><span class="ph-fol">关注</span></div><p></p></div></div>' +
      '<div class="dm-news"><div class="nw-live"><i></i>直播 LIVE</div><div class="nw-bug">BAY<b>7</b></div><div class="nw-low"><div class="nw-logo"><div><b>BAY</b><u>7</u></div><small>维港新闻</small><em class="nw-clock">15:42</em></div>' +
        '<div class="nw-bar"><div class="nw-h"></div><div class="nw-s"></div></div></div><div class="nw-tick"><b>快讯</b><div><span>' + TICK + TICK + '</span></div></div></div>' +
      '<div class="dm-black"></div><div class="dm-card"><small>B<i>★</i>STAR GAMES</small><b>出 品</b></div>' +
      '<div class="dm-title"><div class="tt-kick">B<i>★</i>STAR GAMES　出品</div>' + WM + '<div class="tt-tag">维尔蒙港　·　自由漫游</div></div><div class="dm-badge"><b>B<i>★</i>STAR</b></div><div class="dm-skip">按任意键跳过</div>';
    host.appendChild(el); D.fl = el.querySelector('.dm-flare'); D.bg = el.querySelector('.dm-bg');
    const hs = el.querySelector('.ph-hearts'); D.hearts = []; for (let i = 0; i < 14; i++) { const h = doc.createElement('i'); h.innerHTML = HEART; h.style.color = ['#ff3b6b', '#ff7aa8', '#ffd23f', '#ff5a3a', '#ffffff'][i % 5]; hs.appendChild(h); D.hearts.push(h); }
    const cm = el.querySelector('.ph-cmts'), lines = CMTS.map(c => '<p><b>' + c[0] + '</b>' + c[1] + '</p>').join(''); cm.innerHTML = '<div>' + lines + lines + '</div>'; D.cm = cm.firstChild;
    el.style.display = 'none'; return el; }
  const q = s => D.el && D.el.querySelector(s);
  function ovShot(S) { const el = D.el; if (!el) return; el.classList.toggle('phone', S.ov === 'phone' || S.ov === 'live'); el.classList.toggle('live', S.ov === 'live'); el.classList.toggle('news', S.ov === 'news');
    if (S.ov === 'phone' || S.ov === 'live') { q('.ph-who b').textContent = S.who || ''; q('.ph-bot p').textContent = S.txt || ''; }
    if (S.ov === 'news') { q('.nw-h').textContent = S.head || ''; q('.nw-s').textContent = S.sub || ''; }
    const bg = D.bg; el.classList.toggle('dof', !!S.dof && !S.ov); if (S.dof && !S.ov) { const a = (S.dof[0] * 100).toFixed(1), b = (S.dof[1] * 100).toFixed(1), m = 'linear-gradient(180deg, #000 0%, transparent ' + a + '%, transparent ' + b + '%, #000 ' + min(100, +b + 12) + '%)'; bg.style.webkitMaskImage = bg.style.maskImage = m; bg.style.setProperty('--b', S.dof[2] + 'px'); }
    else { bg.style.webkitMaskImage = bg.style.maskImage = ''; } }
  /** the blurred copies (the phone clips' side panels, the shallow-focus bands): the frame just drawn is copied into a small 2D canvas once the game's frame callback has returned
      (a microtask: the WebGL buffer is still the new frame), and CSS blurs and masks it. In a phone clip the copy is the portrait strip zoomed to fill the width, as a phone video is shown. */
  function copyBg() { const S = SH[D.i], bg = D.bg, R = GT.render && GT.render.renderer, src = (R && R.domElement) || G.canvas; if (!S || !bg || !src || !src.width) return; const phone = S.ov === 'phone' || S.ov === 'live';
    const W = src.width, H = src.height, w = phone ? 160 : 640, h = Math.round(w * H / W); if (bg.width !== w || bg.height !== h) { bg.width = w; bg.height = h; } const g = bg.getContext('2d');
    try { if (phone) { const sw = H * 9 / 16, sh = sw * H / W; g.drawImage(src, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, w, h); } else g.drawImage(src, 0, 0, W, H, 0, 0, w, h); } catch (e) { /* not drawable this frame */ } }
  function ovTick(t) { const el = D.el; if (!el) return; const S = SH[D.i], lt = D.lt || 0;
    /* black: the film opens from black over the first second; the cards and the title sit on black */
    const blk = S.black || D.mode === 'warm' ? 1 : t < 1.1 ? 1 - sst(t, .1, 1.1) : 0; q('.dm-black').style.opacity = blk.toFixed(3);
    const card = q('.dm-card'), ca = sst(t, 12.9, 13.6) * (1 - sst(t, 15.75, 16)); card.style.opacity = ca.toFixed(3); card.classList.toggle('on', ca > 0);
    /* BR (user: "最末尾黑色跳 logo，音乐突然没了"): the track now ends on a downbeat at 64.0 s that rings out (audio/music/CREDITS.md); the title holds until the ring has died away (~69 s),
       the badge follows on black while the game's own sound is brought up under it (from 70 s, 2 s), so the menu starts with its ambience already there */
    const ti = q('.dm-title'), tt = t - TITLE; ti.style.opacity = (tt < 0 ? 0 : sst(tt, 0, .08) * (1 - sst(tt, 5.0, 5.8))).toFixed(3);
    if (D.mode === 'play' && tt >= 6 && !D.amIn) { D.amIn = true; masterRamp(.8, 2); } ti.style.setProperty('--k', eo(clamp(tt / .5, 0, 1)).toFixed(3)); ti.style.setProperty('--n', clamp((tt - .32) / .22, 0, 1).toFixed(3)); ti.style.setProperty('--g', sst(tt, 1.1, 1.9).toFixed(3));
    q('.dm-badge').style.opacity = (sst(tt, 5.9, 6.4) * (1 - sst(tt, 7.55, 7.95))).toFixed(3);
    q('.dm-skip').style.opacity = D.mode === 'play' ? (sst(t, 1, 1.6) * (1 - sst(t, 5, 6))).toFixed(3) : '0';
    if (S.ov === 'live') { D.hearts.forEach((h, i) => { const p = ((lt * .55 + i / D.hearts.length) % 1), x = 18 * sin(p * 5 + i * 1.7) + (i % 3) * 9, s = .7 + .5 * ((i * 7) % 5) / 5; h.style.transform = 'translate(' + x.toFixed(1) + 'px,' + (-p * 260).toFixed(1) + 'px) scale(' + (s * (.6 + .4 * sst(p, 0, .15))).toFixed(2) + ')'; h.style.opacity = (sst(p, 0, .1) * (1 - sst(p, .7, 1))).toFixed(2); });
      const ph = innerHeight * .032; D.cm.style.transform = 'translateY(' + (-((lt * 1.1 * ph) % (CMTS.length * ph))).toFixed(1) + 'px)'; }
    if (S.ov === 'news') { const s = q('.nw-tick span'); s.style.transform = 'translateX(' + (-(t * 70) % (s.scrollWidth / 2 || 1600)).toFixed(1) + 'px)'; q('.nw-clock').textContent = '15:4' + (2 + ((t / 10) | 0) % 2); }
  }

  /* ================================================================== sound: the track is the clock; recorded beds (audio/sfx) under it, cut with the picture */
  const AU = { ac: null, out: null, buf: {}, src: null, t0: 0, beds: {}, ok: false, loading: null };
  const BEDS = { waves: 'amb_waves_near', beach: 'amb_beach_people', street: 'amb_coast_day', night: 'amb_coast_night', wind: 'amb_palm_wind', siren: 'siren_wail', engine: 'eng_muscle_high', skid: 'tire_skid_loop', heli: 'heli_loop', club: 'amb_bar_music', market: 'amb_ct_market' };
  const base = () => { const s = doc.currentScript && doc.currentScript.src; return D.base || (D.base = (s ? s.replace(/js\/demo\.js.*$/, '') : '')); }; base();
  function loadAudio() { if (AU.loading || QS.get('demosound') === '0') return AU.loading; const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OAC || !window.fetch) return null;
    const dec = (url, rate) => fetch(url).then(r => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.arrayBuffer(); }).then(b => new Promise((res, rej) => { const o = new OAC(2, 1024, rate); o.decodeAudioData(b, res, rej); }));
    const one = (name, file, rate) => dec(base() + file + '.ogg', rate).catch(() => dec(base() + file + '.mp3', rate)).then(b => { AU.buf[name] = b; }, e => warn('audio ' + file, e));
    AU.loading = Promise.all([one('music', 'audio/music/demo_theme', 44100)].concat(Object.keys(BEDS).map(k => one(k, 'audio/sfx/' + BEDS[k], 22050)))); return AU.loading; }
  const vol = () => { const s = GT.front && GT.front.settings; return s && s.volume !== undefined ? s.volume : .8; };
  function audioStart() { AU.ok = false; if (!AU.buf.music) return false; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;   /* ?auto=trailer without a click: no sound (a browser would refuse it), the picture runs on its own clock */
    try { if (!AU.ac || AU.ac.state === 'closed') { AU.ac = new AC(); AU.out = AU.ac.createGain(); AU.out.connect(AU.ac.destination); } const ac = AU.ac; if (ac.state === 'suspended' && ac.resume) ac.resume(); AU.out.gain.value = vol();
      const t = ac.currentTime + .1; AU.t0 = t; const m = ac.createBufferSource(), mg = ac.createGain(); m.buffer = AU.buf.music; mg.gain.value = .9; m.connect(mg); mg.connect(AU.out); m.start(t); AU.src = m;
      AU.beds = {}; for (const k in BEDS) { const b = AU.buf[k]; if (!b) continue; const s = ac.createBufferSource(), g = ac.createGain(); s.buffer = b; s.loop = true; g.gain.value = 0; s.connect(g); g.connect(AU.out); s.start(t, (k.length * 3.7) % max(1, b.duration - 1)); AU.beds[k] = { s, g }; }
      AU.ok = true; return true; } catch (e) { warn('audio start', e); return false; } }
  function audioTime() { if (!AU.ok || !AU.ac || AU.ac.state !== 'running') return null; return AU.ac.currentTime - AU.t0; }
  function audioShot(S) { if (!AU.ok) return; const ac = AU.ac, now = ac.currentTime, amb = S.amb || {}; for (const k in AU.beds) { const g = AU.beds[k].g.gain, v = (amb[k] || 0) * .34; g.cancelScheduledValues(now); g.setTargetAtTime(v, now, v > g.value ? .03 : .06); } }
  /** the film's own sound out over `sec` on an equal-power curve (1.8 s into the menu, 0.6 s on a skip), then the context is closed */
  function audioStop(sec) { const ac = AU.ac; if (!ac) return; AU.ok = false; try { const now = ac.currentTime, g = AU.out.gain, v0 = g.value, n = 48, cv = new Float32Array(n); for (let i = 0; i < n; i++) cv[i] = v0 * cos(i / (n - 1) * HP); cv[n - 1] = 0;
      g.cancelScheduledValues(now); try { g.setValueCurveAtTime(cv, now, max(.05, sec)); } catch (e) { g.setTargetAtTime(0, now, sec / 4); } setTimeout(() => { try { if (AU.src) AU.src.stop(); for (const k in AU.beds) AU.beds[k].s.stop(); } catch (e) { /* stopped */ } AU.src = null; AU.beds = {}; try { ac.close(); } catch (e) { /* closed */ } AU.ac = null; }, sec * 1000 + 120); } catch (e) { /* closed */ } }

  /** the game's own master (js/audio.js setMaster eases each step over 30 ms) brought to `to` over `sec` on a sine curve: the menu's ambience fades in under the end of the film instead of switching on */
  function masterRamp(to, sec) { if (D.mr) { clearInterval(D.mr); D.mr = 0; } const A = GT.audio; if (!A || !A.setMaster || !A.ready) return; if (!(sec > 0)) { safe('master', () => A.setMaster(to)); return; }
    const t0 = performance.now(), from = D.mv === undefined ? to : D.mv; D.mr = setInterval(() => { const u = clamp((performance.now() - t0) / (sec * 1000), 0, 1), v = from + (to - from) * sin(u * HP); D.mv = v; safe('master', () => A.setMaster(v)); if (u >= 1) { clearInterval(D.mr); D.mr = 0; } }, 40); }
  function masterSet(v) { if (D.mr) { clearInterval(D.mr); D.mr = 0; } D.mv = v; if (GT.audio && GT.audio.setMaster && GT.audio.ready) safe('master', () => GT.audio.setMaster(v)); }

  /* ================================================================== run */
  function begin(mode) {
    D.on = true; D.mode = mode; D.done = false; D.skipped = false; D.t = 0; D.i = -1; D.lt = 0; D.cut = 0; D.mb = null; D.e = 0; D.wb = undefined; D.long = []; D.cuts = []; D.lf = 0; D.frames = 0; D.worst = 0; D.progs = []; D.np = 0;
    const fx = GT.render && GT.render.fx; D.keep = { fixed: G.fixedHours, hold: G.holdHours, hours: G.hours, auto: fx ? fx.autoExposure : true, expo: fx ? fx.exposure : 1, phase: G.phase, fov: G.camera ? G.camera.fov : 40 };
    G.fixedHours = null; G.demo = D.api; G.inputOff = true; if (G.ctl) G.ctl.enabled = false; safe('hud', () => X.HUD.show(false)); overlay(); if (mode !== 'warm' || QS.get('auto') === 'trailer') { doc.body.classList.add('gt-demo'); D.el.style.display = ''; }   /* the warm-up behind the gate shows nothing of its own */
    D.hero = safe('hero', () => (G.kai && (G.kai.group || G.kai.root)) || null, null); if (D.hero && D.hero.isObject3D) D.hero.visible = false; else D.hero = null;
    if (D.palm === undefined) { let best = null, bd = 1e9; for (const p of (GT.coast.C && GT.coast.C.palms) || []) { const d = hyp(p[0] + 11, p[1] + 14); if (p[0] < -7 && d < bd) { bd = d; best = p; } } D.palm = best ? [best[0], best[1]] : null; }   /* the park palm nearest the foot of the tall tower (the low angle, 018) */
    D.tgt = { x: 0, y: 0, z: 1, h: 0 }; D.shot = { d: 1e5, p: [[0, 0, 0]], l: [[0, 0, 1]], f: [40, 40], sh: 0, e: 'lin', fol: { ent: D.tgt, at: [0, 0, 0], ly: 0, hh: 0, world: true, lag: 99 } };
    safe('cutscene', () => game.cutscene([D.shot], { live: true, letterbox: false, fade: false, hud: false })); D.c = G.cine; G.phase = 'menu';
  }
  function restore() {
    if (D.ts && GT.atmos) { GT.atmos.timeScale = D.ts[0]; GT.atmos.holdHour = D.ts[1]; D.ts = null; }
    const K = D.keep || {}; if (G.cine && G.cine === D.c) safe('endCutscene', () => X.endCutscene()); D.c = null; D.shot = null; hideAll(); if (SH[D.i] && SH[D.i].exit) safe('exit', () => SH[D.i].exit(SH[D.i])); D.i = -1;
    G.fixedHours = K.fixed === undefined ? null : K.fixed; G.holdHours = K.hold === undefined ? null : K.hold; if (K.hours !== undefined) { G.hours = K.hours; sunFor(K.hours); if (GT.atmos && GT.atmos.setTime) safe('setTime', () => GT.atmos.setTime(K.hours)); } G.paused = false; G.demo = null; G.inputOff = false;
    const fx = GT.render && GT.render.fx; if (fx) { fx.autoExposure = K.auto !== false; fx.exposure = K.expo || 1; if (D.mb !== null) { fx.mblur = D.mb; D.mb = null; } } D.wb = undefined;
    if (D.hero) { D.hero.visible = true; D.hero = null; } if (G.camera && K.fov) { G.camera.fov = K.fov; G.camera.updateProjectionMatrix(); }
    doc.body.classList.remove('gt-demo'); if (D.el) { D.el.className = 'dm'; D.el.style.display = 'none'; } if (D.fl) { const g = D.fl.getContext('2d'); g.clearRect(0, 0, D.fl.width, D.fl.height); }
    takeOut(); D.on = false; D.mode = '';
  }
  /* the warm-up: every shot staged at its middle and drawn four frames; the fourth reads the meter (the average luminance of the third) and stores the exposure that shot wants */
  let warmRes = null; const WARM = { i: 0, f: 0, t0: 0 };
  function startWarm() { if (D.warming || D.on) return warmP(); D.warming = true; begin('warm'); WARM.i = 0; WARM.f = 0; WARM.t0 = performance.now(); if (QS.get('auto') === 'trailer') q('.dm-black').style.opacity = '1'; D.calib = false; return warmP(); }
  function warmP() { if (!D.warming) return Promise.resolve(); return D.wp || (D.wp = new Promise(r => { warmRes = r; })); }
  function warmStep() {
    while (WARM.i < SH.length && SH[WARM.i].black) WARM.i++;
    if (WARM.i >= SH.length || performance.now() - WARM.t0 > 20000) { endWarm(); return; }
    const S = SH[WARM.i]; if (WARM.f === 0) { cut(WARM.i); } const t = S.t0 + S.d * .5; stage(t, 0);
    if (WARM.f === 3) { const r = GT.render && GT.render.readExposure ? GT.render.readExposure() : null; if (r && r[1] > 0) S.E = meterTarget(r[1]); WARM.i++; WARM.f = 0; return; } WARM.f++;
  }
  function endWarm() { D.warmed = true; D.calib = SH.some(s => s.E > 0); const Es = SH.filter(s => s.E > 0).map(s => s.E); D.Edef = Es.length ? Es.reduce((a, b) => a + b, 0) / Es.length : 1; D.warmMs = Math.round(performance.now() - WARM.t0);
    D.warming = false; restore(); if (D.pool) readd(); safe('flyby', () => { if (G.phase === 'menu' && !G.cine && X.startFlyby) X.startFlyby(); }); const r = warmRes; warmRes = null; D.wp = null; if (r) r(); }

  function play(g) {
    if (!active()) return Promise.resolve(); bind(g); if (!G.visual || D.on && D.mode === 'play') return Promise.resolve(); if (!D.pool && !prepare(g, {})) return Promise.resolve();
    return warmP().then(() => (D.warmed ? null : startWarm())).then(() => Promise.race([AU.loading || Promise.resolve(), new Promise(r => setTimeout(r, 4000))])).then(() => new Promise(res => {
      D.res = res; readd(); begin('play'); D.calib = SH.some(s => s.E > 0); { const r = GT.render && GT.render.readExposure ? GT.render.readExposure() : null; D.e = r && r[0] > 0 ? r[0] : 0; }
      D.amIn = false; masterSet(0); audioStart();
      const t0 = performance.now(), key = e => { if (performance.now() - t0 < 1000 || D.done || D.mode !== 'play') return; if (e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey || /^F\d+$/.test(e.key))) return; e.preventDefault(); e.stopImmediatePropagation(); finish(true); };
      for (const ev of ['keydown', 'mousedown', 'touchstart']) { addEventListener(ev, key, true); D.offs.push(() => removeEventListener(ev, key, true)); }
    }));
  }
  function finish(skipped) {
    if (D.done || !D.on) return; D.done = true; D.skipped = !!skipped; D.offs.splice(0).forEach(f => f()); audioStop(skipped ? .6 : 1.8); q('.dm-black').style.opacity = '1'; F('fade', 1, 0);
    if (!D.amIn) { D.amIn = true; masterRamp(.8, skipped ? 1.2 : 1.8); }   /* the film's sound and the game's cross over (a natural end already started this at 70 s) */
    D.stats = { frames: D.frames, fps: +(D.frames / max(1, D.t)).toFixed(1), worst: Math.round(D.worst || 0), long: D.long.slice(), progs: D.progs.slice(), cuts: D.cuts.slice(), skipped: D.skipped, t: +D.t.toFixed(2) };
    setTimeout(() => { restore(); const r = D.res; D.res = null; if (r) r(); }, skipped ? 320 : 60);
  }
  function abort() { if (!D.on) return; if (D.mode === 'warm') { endWarm(); return; } D.offs.splice(0).forEach(f => f()); audioStop(.2); if (D.mode === 'play' && !D.amIn) { D.amIn = true; masterRamp(.8, .6); } D.done = true; restore(); const r = D.res; D.res = null; if (r) r(); }
  /** the menu's 观看预告: fade the menu out, play, come back to the menu */
  async function replay() { const g = GT.cngame; if (!g || D.on || !active()) return; bind(g); await (F('fade', 1, 500) || new Promise(r => setTimeout(r, 500))); await (F('menu.hide') || Promise.resolve()); safe('endCutscene', () => X.endCutscene());
    G.phase = 'menu'; await play(g); safe('toMenu', () => g.toMenu()); }
  /** ?auto=trailer[&at=<s>] */
  function auto(g, at) { if (!active()) return false; bind(g); G.phase = 'menu'; G.started = false; G.freeze = false; if (G.ctl) G.ctl.enabled = false; safe('hud', () => X.HUD.show(false)); doc.body.classList.remove('cn-still');
    if (!prepare(g, {})) return false; startWarm(); warmP().then(() => { if (at >= 0) seek(at); else play(g).then(() => safe('toMenu', () => g.toMenu())); }); return true; }
  function seek(at) { readd(); begin('seek'); D.calib = SH.some(s => s.E > 0); { const r = GT.render && GT.render.readExposure ? GT.render.readExposure() : null; D.e = r && r[0] > 0 ? r[0] : 0; } at = clamp(+at || 0, 0, D.len - .01); D.at = at; const i = shotAt(at); D.t = max(0, SH[i].t0 - 1 / 60); }
  /** a running page can be moved to another second without reloading (screenshots): GT.demo.seek(s) */
  function seekTo(at) { if (!D.warmed || !active()) return false; if (D.on) { D.offs.splice(0).forEach(f => f()); restore(); } seek(at); return true; }
  function freeze() { D.mode = 'still'; G.phase = 'demo'; G.paused = true; G.freeze = false; }

  D.api = { pre, post };
  GT.demo = { prepare, play, replay, auto, abort, seek: seekTo, shots: SH, get ok() { return active(); }, get length() { return D.len; }, state: D, BPM, _audio: AU };
})();
