/* game.js — SUNSET HEAT: main loop, driving model, heist director, wanted system, police AI, traffic, HUD, camera, autopilot + self-test.
   Exposes GT.game (see the API block at the bottom). Page: index.html, styles: css/hud.css.
   URL: ?auto=wait|honk|drive|chase|swap|busted|clean (scripted state via a deterministic fast-forward of the real simulation)
        &at=<sim seconds>  &freeze=1 (hold that instant)  &t=<hours> (fixed time of day)  &seed=<n>  &sig=flash
        &cam=chase  &look=<yawDeg>,<pitchDeg>  &hud=0  &passenger=0  &mirror=0  &fx=0  &atmos=0  &only=a,b  &debug=1  &boot=0  &selftest=1 Integrates every other module defensively: each one is feature-detected,
   wrapped in try/catch, and replaced by a GT.kit placeholder if missing or broken, so the loop is always playable.
   Conventions (core.js): heading h, forward = (sin h, 0, cos h), LEFT = (cos h, 0, -sin h). Vehicle-local: +Z forward, +X left, driver sits at +X. */
(function () {
  'use strict';
  const T = THREE, GT = window.GT, L = GT.L;
  const { clamp, lerp, sstep, angDiff, TAU } = GT;
  const hyp = Math.hypot, PI = Math.PI;
  const fail = m => { if (window.GTfail) window.GTfail(m); else console.error(m); };
  const warn = (label, e) => { console.warn('[game] ' + label, e); G.warnings.push(label + ': ' + (e && e.message || e)); };
  const safe = (label, fn, fb) => { try { return fn(); } catch (e) { warn(label, e); return fb; } };

  /* ================================================================== global game state */
  const G = {
    Q: new URLSearchParams(''), visual: true, warnings: [], mods: {},
    scene: null, camera: null, canvas: null, hudRoot: null,
    time: 0, phase: 'boot', phaseT: 0, paused: false, started: false, auto: null, seed: 1,
    cars: [], cops: [], traffic: [], peds: [], swapCars: [],
    input: { throttle: 0, brake: 0, steer: 0, hand: 0, horn: false, focus: false, lookBack: false },
    keys: {}, events: [], focusE: 1, slow: 1, startHours: 18 + 10 / 60, fixedHours: null,
    storyOn: false, holdHours: null, sens: 1, invertY: false, master: .8, subsOn: true      // story seam (js/story.js) + settings applied by it
  };
  /** the story director (js/story.js) when it owns the flow, else null. Every seam below is `const st = ST(); if (st) ...` so the legacy game is untouched when the story is off. */
  const ST = () => (G.storyOn && GT.story) || null;
  let rnd = GT.rng('game1');

  /* ================================================================== paths (lane centre lines the AI drives along) */
  function mkPath(pts, rad, closed) {
    const raw = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (!closed && (i === 0 || i === n - 1)) { raw.push([p[0], p[1]]); continue; }
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], la = hyp(p[0] - a[0], p[1] - a[1]), lb = hyp(b[0] - p[0], b[1] - p[1]);
      const r = Math.min(rad, la * .45, lb * .45);
      if (r < .3) { raw.push([p[0], p[1]]); continue; }
      const p0 = [p[0] + (a[0] - p[0]) / la * r, p[1] + (a[1] - p[1]) / la * r], p1 = [p[0] + (b[0] - p[0]) / lb * r, p[1] + (b[1] - p[1]) / lb * r];
      for (let k = 0; k <= 8; k++) { const t = k / 8, u = 1 - t; raw.push([u * u * p0[0] + 2 * u * t * p[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * p[1] + t * t * p1[1]]); }
    }
    if (closed) raw.push([raw[0][0], raw[0][1]]);
    const d = [0]; for (let i = 1; i < raw.length; i++) d.push(d[i - 1] + hyp(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    return { p: raw, d, len: d[d.length - 1], closed: !!closed };
  }
  function pathAt(path, s, out) {
    out = out || {}; const d = path.d, p = path.p;
    if (path.closed) s = ((s % path.len) + path.len) % path.len; else s = clamp(s, 0, path.len);
    let lo = 0, hi = d.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] <= s) lo = m; else hi = m; }
    const seg = d[hi] - d[lo] || 1, t = (s - d[lo]) / seg, a = p[lo], b = p[hi];
    out.x = a[0] + (b[0] - a[0]) * t; out.z = a[1] + (b[1] - a[1]) * t; out.h = Math.atan2(b[0] - a[0], b[1] - a[1]); return out;
  }
  function pathNearest(path, x, z) {
    const p = path.p, d = path.d; let best = 1e18, bs = 0;
    for (let i = 0; i < p.length - 1; i++) { const ax = p[i][0], az = p[i][1], bx = p[i + 1][0] - ax, bz = p[i + 1][1] - az, l2 = bx * bx + bz * bz || 1;
      const t = clamp(((x - ax) * bx + (z - az) * bz) / l2, 0, 1), dx = ax + bx * t - x, dz = az + bz * t - z, dd = dx * dx + dz * dz;
      if (dd < best) { best = dd; bs = d[i] + (d[i + 1] - d[i]) * t; } }
    pathNearest.dist = Math.sqrt(best); return bs;
  }
  const _pa = {};
  /** local forward search: keeps a car's progress parameter glued to the path without a global scan */
  function pathAdvance(path, s, x, z) {
    let best = 1e18, bs = s;
    for (let k = -2; k <= 14; k += 1) { const q = pathAt(path, s + k, _pa), dd = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z); if (dd < best) { best = dd; bs = s + k; } }
    if (path.closed) bs = ((bs % path.len) + path.len) % path.len; else bs = clamp(bs, 0, path.len);
    return bs;
  }
  const PATHS = {};
  function buildPaths() {
    const H = L.highway, cs = L.crossS.z, cn = L.crossN.z, bx = L.backRoad.x, o = 2.25;
    // loop A: highway northbound lane (x=-3), left turns, outer lanes.  loop B: highway southbound (x=+3), inner lanes.
    PATHS.loopA = mkPath([[-3, cs - o], [-3, cn + o], [bx + o, cn + o], [bx + o, cs - o]], 11, true);
    PATHS.loopB = mkPath([[3, cn - o], [3, cs + o], [bx - o, cs + o], [bx - o, cn - o]], 7, true);
    // the highway is a dead end at both ends (road closures), so the outer highway lanes are driven as two more loops sharing the side streets
    PATHS.loopC = mkPath([[-6, cs - o], [-6, cn + o], [bx + o, cn + o], [bx + o, cs - o]], 13, true);
    PATHS.loopD = mkPath([[6, cn - o], [6, cs + o], [bx - o, cs + o], [bx - o, cn - o]], 9, true);
    // GT.road.lanes (if the road module provides closed 'outer' / 'inner' loops) replaces the two main loops so AI follows the painted lanes exactly
    const RL = GT.road && GT.road.lanes; if (Array.isArray(RL)) for (const [id, key] of [['outer', 'loopA'], ['inner', 'loopB']]) { const l = RL.find(q => q && q.id === id);
      if (l && l.closed && l.pts && l.pts.length >= 8 && isFinite(l.pts[0].x + l.pts[0].z)) { const np = mkPath(l.pts.map(q => [q.x, q.z]), 0, true); if (Math.abs(angDiff(pathAt(np, pathNearest(np, key === 'loopA' ? -3 : 3, 0), {}).h, key === 'loopA' ? 0 : PI)) < .3) { PATHS[key] = np; G.mods.lanes = 'road'; } } }
    const st = L.station, dN = st.drives[1], hs = L.heroStart, pmp = anchor('pump5i', { x: 34, z: st.pumps[1][1], h: PI });
    // scripted WAIT-phase paths: the cruiser that pulls in behind you (arrives from the north street, hidden by the motel), the witness car to the pumps
    PATHS.patrolIn = mkPath([[78, cn - o], [3, cn - o], [3, dN + 16], [9, dN + 2], [20, dN - 1], [36, dN - 5], [hs.x - .4, dN - 9], [hs.x - .2, hs.z + 9.5]], 7, false);
    PATHS.witnessIn = mkPath([[3, 150], [3, dN + 15], [9, dN + 1.5], [19, dN - 2], [29, dN - 6], [pmp.x, dN - 12.5], [pmp.x, pmp.z]], 6, false);
    G.pumpSpot = pmp;
  }

  /* ================================================================== world queries: surface, ground height, colliders, line of sight */
  const SURF = { asphalt: [1, 0], road: [1, 0], concrete: [.97, 0], sidewalk: [.95, 0], paint: [.93, 0], sand: [.52, 2.4], beach: [.52, 2.4], grass: [.68, .9], dirt: [.74, .6], gravel: [.7, .5], water: [.35, 7], sea: [.35, 7], wet: [.8, 0] };
  const _surf = { grip: 1, drag: 0, name: 'asphalt' };
  function surfaceFallback(x, z) {
    const H = L.highway, hw = H.width / 2 + L.sidewalk;
    if (x < L.ocean.x1) return 'water'; if (x < L.beach.x1 - 2) return 'sand';
    if (Math.abs(x) <= hw) return 'asphalt';
    if (x > 0 && x < L.backRoad.x + 6 && Math.abs(z) < L.crossN.z + 6) return 'asphalt';
    return 'dirt';
  }
  function surface(x, z) {
    let s = null;
    if (GT.road && GT.road.surfaceAt && !G.noSurf) { try { s = GT.road.surfaceAt(x, z); } catch (e) { G.noSurf = true; warn('road.surfaceAt', e); } }
    if (s === null || s === undefined) s = surfaceFallback(x, z);
    if (typeof s === 'number') { _surf.grip = clamp(s, .2, 1.2); _surf.drag = 0; _surf.name = 'surface'; return _surf; }
    if (typeof s === 'object') { const nm = String(s.name || s.type || s.kind || s.surface || 'asphalt'); let g = s.grip !== undefined ? s.grip : (s.mu !== undefined ? s.mu : null), dr = s.drag !== undefined ? s.drag : null;
      if (g === null || dr === null) { const k = Object.keys(SURF).find(k => nm.indexOf(k) >= 0), v = SURF[k] || SURF.asphalt; if (g === null) g = v[0]; if (dr === null) dr = v[1]; }
      _surf.grip = clamp(g, .2, 1.3); _surf.drag = dr; _surf.name = nm; return _surf; }
    const nm = String(s), k = Object.keys(SURF).find(k => nm.indexOf(k) >= 0), v = SURF[k] || SURF.asphalt; _surf.grip = v[0]; _surf.drag = v[1]; _surf.name = nm; return _surf;
  }
  function groundY(x, z) {
    if (GT.road && GT.road.groundHeight && !G.noGround) { try { const y = GT.road.groundHeight(x, z); if (typeof y === 'number' && isFinite(y)) return y; } catch (e) { G.noGround = true; warn('road.groundHeight', e); } }
    return 0;
  }
  /* uniform grid over GT.world.boxes for the player's collision broadphase */
  const GRID = { cell: 12, map: new Map(), n: -1, stamp: 0, out: [] };
  function gridBuild() {
    GRID.map.clear(); const B = GT.world.boxes; GRID.n = B.length;
    for (const b of B) { if (!(b.x1 > b.x0) || !(b.z1 > b.z0)) continue; b._st = 0;
      if (b.x1 - b.x0 > 400 || b.z1 - b.z0 > 400) continue;
      for (let cx = Math.floor(b.x0 / GRID.cell); cx <= Math.floor(b.x1 / GRID.cell); cx++) for (let cz = Math.floor(b.z0 / GRID.cell); cz <= Math.floor(b.z1 / GRID.cell); cz++) {
        const k = cx * 4096 + cz; let a = GRID.map.get(k); if (!a) GRID.map.set(k, a = []); a.push(b); } }
  }
  function nearBoxes(x, z, r) {
    if (GRID.n !== GT.world.boxes.length) gridBuild();
    const out = GRID.out; out.length = 0; const st = ++GRID.stamp, c = GRID.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) for (let cz = Math.floor((z - r) / c); cz <= Math.floor((z + r) / c); cz++) {
      const a = GRID.map.get(cx * 4096 + cz); if (!a) continue; for (const b of a) if (b._st !== st) { b._st = st; out.push(b); } }
    return out;
  }
  /** true if nothing taller than minH blocks the segment (2D slab test against every registered box) */
  function los(ax, az, bx, bz, minH) {
    minH = minH === undefined ? 1.4 : minH; const dx = bx - ax, dz = bz - az, B = GT.world.boxes;
    for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.h < minH) continue;
      if ((ax > b.x0 && ax < b.x1 && az > b.z0 && az < b.z1) || (bx > b.x0 && bx < b.x1 && bz > b.z0 && bz < b.z1)) continue;
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) { if (ax < b.x0 || ax > b.x1) continue; } else { let u = (b.x0 - ax) / dx, v = (b.x1 - ax) / dx; if (u > v) { const w = u; u = v; v = w; } if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) continue; }
      if (Math.abs(dz) < 1e-9) { if (az < b.z0 || az > b.z1) continue; } else { let u = (b.z0 - az) / dz, v = (b.z1 - az) / dz; if (u > v) { const w = u; u = v; v = w; } if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) continue; }
      return false; }
    return true;
  }
  const anchor = (names, fb) => { for (const n of [].concat(names)) { const a = GT.world.anchors[n]; if (a && isFinite(a.x) && isFinite(a.z)) return a; } return fb; };

  /* ================================================================== placeholder builders (used only when a module is missing or throws) */
  const FB_DIMS = { hero: [4.9, 1.94, 1.3], sedan: [4.75, 1.84, 1.46], pickup: [5.5, 1.98, 1.82], compact: [4.05, 1.74, 1.5], cruiser: [5.05, 1.92, 1.5] };
  const FB_COL = { hero: 0x7a1f1c, sedan: 0x8d939a, pickup: 0x39485a, compact: 0xb9a583, cruiser: 0xe8e8e4 };
  function fbVehicle(kind, o) {
    o = o || {}; const D = FB_DIMS[kind] || FB_DIMS.sedan, Lc = D[0], W = D[1], H = D[2], wb = Lc * .58, tr = W - .34, rw = kind === 'pickup' ? .39 : .34;
    const paint = GT.mat('car_paint', { color: o.color !== undefined ? o.color : FB_COL[kind] || 0x777777 }), k = GT.kit(), g = new T.Group();
    const by = rw * .7, bh = H * .44, top = by + bh;
    k.box(paint, W, bh, Lc, 0, by + bh / 2, 0, { bevel: .13 });
    k.box('plastic_black', W - .08, .16, Lc - .1, 0, by + .02, 0, { bevel: .04 });
    const cz = kind === 'pickup' ? Lc * .1 : -Lc * .05, cl = kind === 'pickup' ? Lc * .3 : Lc * .44, ch = H - top - .04;
    k.box('glass_tint', W * .86, ch, cl, 0, top + ch / 2 - .02, cz, { bevel: .16 });
    k.box(paint, W * .8, .06, cl * .72, 0, top + ch - .02, cz, { bevel: .025 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(paint, .07, ch - .08, .07, sx * W * .4, top + ch / 2 - .04, cz + sz * cl * .42, { bevel: .02, rx: -sz * .35 });
    k.box('chrome', W - .1, .09, .1, 0, by + .12, Lc / 2 - .02, { bevel: .03 }); k.box('chrome', W - .1, .09, .1, 0, by + .12, -Lc / 2 + .02, { bevel: .03 });
    k.box('plastic_black', W * .5, .14, .04, 0, by + bh * .55, Lc / 2 - .005, { bevel: .01 });
    if (kind === 'cruiser') { k.box(GT.mat('car_paint', { color: 0x15171b }), W + .01, bh * .7, Lc * .3, 0, by + bh * .55, 0, { bevel: .05 }); k.box('plastic_black', 1.1, .09, .3, 0, H + .05, cz, { bevel: .03 }); }
    g.add(k.build());
    const mk = (hex) => new T.MeshBasicMaterial({ color: hex });
    const lm = { head: mk(0), tail: mk(0), rev: mk(0), l: mk(0), r: mk(0), sa: mk(0), sb: mk(0) };
    const quad = (m, w, h, x, y, z, back) => { const q = new T.Mesh(new T.PlaneGeometry(w, h), m); q.position.set(x, y, z); if (back) q.rotation.y = PI; g.add(q); };
    for (const sx of [-1, 1]) { quad(lm.head, .26, .13, sx * (W / 2 - .3), by + bh * .62, Lc / 2 + .004); quad(lm.tail, .34, .1, sx * (W / 2 - .32), by + bh * .66, -Lc / 2 - .004, true);
      quad(sx > 0 ? lm.l : lm.r, .1, .1, sx * (W / 2 - .1), by + bh * .62, Lc / 2 + .004); quad(sx > 0 ? lm.l : lm.r, .1, .1, sx * (W / 2 - .1), by + bh * .66, -Lc / 2 - .004, true); }
    quad(lm.rev, .12, .08, 0, by + bh * .5, -Lc / 2 - .004, true);
    if (kind === 'cruiser') { const b1 = new T.Mesh(GT.boxGeo(.5, .1, .26, .02), lm.sa), b2 = new T.Mesh(GT.boxGeo(.5, .1, .26, .02), lm.sb); b1.position.set(.28, H + .12, cz); b2.position.set(-.28, H + .12, cz); g.add(b1, b2); }
    const wheels = [], steer = [], wk = GT.kit();
    wk.cyl(GT.mat('rubber'), rw, rw, .24, 0, 0, 0, { rz: PI / 2, seg: 20 }); wk.cyl('aluminium_brushed', rw * .62, rw * .62, .25, 0, 0, 0, { rz: PI / 2, seg: 14 }); wk.box('metal_dark', .26, rw * 1.1, .05, 0, 0, 0);
    const wsrc = wk.build();
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const piv = new T.Group(), w = wsrc.clone(); piv.position.set(sx * tr / 2, rw, sz * wb / 2); piv.add(w); g.add(piv); wheels.push(w); if (sz > 0) steer.push(piv); }
    const st = { head: 0, brake: 0, reverse: 0, left: 0, right: 0, siren: 0 }; let ph = 0;
    const api = { group: g, dims: { L: Lc, W, H, wheelbase: wb, track: tr, eye: new T.Vector3(.38, H - .22, -Lc * .06) }, wheels, steer, placeholder: true,
      setLights(s) { Object.assign(st, s); },
      update(dt) { ph += dt; const n = (GT.env && GT.env.night) || 0, bl = Math.sin(ph * 9) > 0 ? 1 : 0;
        lm.head.color.setRGB(1, .9, .72).multiplyScalar(st.head ? 9 : .25); lm.tail.color.setRGB(1, .05, .03).multiplyScalar(st.brake ? 7 : (st.head ? 1.6 : .12));
        lm.rev.color.setRGB(1, 1, 1).multiplyScalar(st.reverse ? 5 : .1); lm.l.color.setRGB(1, .5, .05).multiplyScalar(st.left && bl ? 6 : .15); lm.r.color.setRGB(1, .5, .05).multiplyScalar(st.right && bl ? 6 : .15);
        const f = st.siren ? (Math.sin(ph * 14) > 0 ? 1 : 0) : -1, k = 5 + n * 9; lm.sa.color.setRGB(1, .04, .04).multiplyScalar(f === 1 ? k : .12); lm.sb.color.setRGB(.05, .2, 1).multiplyScalar(f === 0 ? k : .12); } };
    api.update(0); return api;
  }
  function fbPerson(kind, o) {
    const col = { partner: [0x24262b, 0x1a1b1e], clerk: [0x9a3b34, 0x2b2f3a], cop: [0x1d2a44, 0x16181d], ped: [0x8a8f6e, 0x3a4252], driver: [0x5d6a78, 0x25272c] }[kind] || [0x777777, 0x333333];
    const g = new T.Group(), k = GT.kit(), top = GT.mat('fabric_dark', { color: col[0] }), bot = GT.mat('fabric_dark', { color: col[1] }), skin = GT.mat('plastic_grey', { color: kind === 'partner' ? 0x18181a : 0xb98a6a, rough: .8 });
    k.box(top, .44, .58, .24, 0, 1.2, 0, { bevel: .08 }); k.sphere(skin, .11, 0, 1.64, 0); k.box(top, .1, .56, .1, .27, 1.18, 0, { bevel: .04 }); k.box(top, .1, .56, .1, -.27, 1.18, 0, { bevel: .04 });
    g.add(k.build()); const legs = [];
    for (const sx of [1, -1]) { const lk = GT.kit(); lk.box(bot, .15, .88, .16, 0, -.44, 0, { bevel: .05 }); const lg = lk.build(); lg.position.set(sx * .1, .9, 0); g.add(lg); legs.push(lg); }
    let bag = null; if (kind === 'partner') { const bk = GT.kit(); bk.box(GT.mat('fabric_dark', { color: 0x3b3a30 }), .22, .3, .42, 0, 0, 0, { bevel: .08 }); bag = bk.build(); bag.position.set(-.34, .85, .05); bag.visible = false; g.add(bag); }
    let ph = 0;
    return { group: g, placeholder: true, update(dt, s) { s = s || {}; const sp = s.speed || 0; ph += dt * (2 + sp * 2.4); const sw = sp > .2 ? Math.sin(ph) * Math.min(.8, .25 + sp * .12) : 0;
      legs[0].rotation.x = sw; legs[1].rotation.x = -sw; const st = s.state || 'idle'; if (bag) bag.visible = st === 'carry_run';
      g.children[0].position.y = st === 'crouch' ? -.55 : (st === 'sit' ? -.5 : Math.abs(Math.sin(ph)) * .03 * Math.min(1, sp)); legs[0].visible = legs[1].visible = st !== 'sit' && st !== 'crouch'; } };
  }
  function fbCockpit(dims) {
    const k = GT.kit(), g = new T.Group(), W = (dims && dims.W) || 1.9, hw = W / 2 - .12, eye = new T.Vector3(.37, 1.07, -.32);
    k.box('dash_vinyl', W - .2, .2, .46, 0, .82, .52, { bevel: .06 }); k.box('dash_vinyl', .36, .13, .2, .37, .95, .4, { bevel: .05 }); k.box('plastic_black', W - .26, .42, .1, 0, .55, .44, { bevel: .03 });
    k.box('plastic_black', .28, .5, .9, 0, .42, -.25, { bevel: .05 }); k.box('fabric_dark', W - .3, .04, 1.5, 0, 1.325, -.45, { bevel: .01 });
    for (const sx of [-1, 1]) { k.box('plastic_black', .07, .62, .07, sx * (hw - .02), 1.06, .46, { bevel: .02, rx: -.95 }); k.box('plastic_black', .06, .2, 1.3, sx * (hw + .03), .76, -.3, { bevel: .03 }); k.box('plastic_black', .07, .5, .08, sx * (hw + .02), 1.08, -.72, { bevel: .02 }); }
    k.box('leather_black', .5, .12, .5, .37, .46, -.36, { bevel: .05 }); k.box('leather_black', .5, .12, .5, -.37, .46, -.36, { bevel: .05 });
    k.box('leather_black', .48, .62, .12, -.37, .8, -.64, { bevel: .05, rx: -.2 });
    k.box('plastic_black', .3, .1, .05, 0, 1.262, .4, { bevel: .02 }); k.cyl('plastic_black', .012, .012, .08, 0, 1.3, .41);
    g.add(k.build({ cast: false }));
    const wheel = new T.Group(), wk = GT.kit(); wk.geo('leather_black', new T.TorusGeometry(.18, .018, 10, 36)); wk.box('plastic_black', .34, .035, .02, 0, 0, 0, { bevel: .008 }); wk.box('plastic_black', .035, .17, .02, 0, -.09, 0, { bevel: .008 }); wk.cyl('plastic_black', .05, .05, .03, 0, 0, 0, { rx: PI / 2 });
    wheel.add(wk.build({ cast: false })); const col = new T.Group(); col.position.set(.37, .93, .2); col.rotation.x = .38; col.add(wheel); g.add(col);
    let mq = null; const mt = GT.render && GT.render.mirror && GT.render.mirror.texture;
    const pg = new T.PlaneGeometry(.27, .078), uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    mq = new T.Mesh(pg, new T.MeshBasicMaterial(mt ? { map: mt } : { color: 0x334455 })); mq.position.set(0, 1.262, .372); mq.rotation.y = PI; g.add(mq);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96; const cx = cv.getContext('2d'), tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding;
    const scr = new T.Mesh(new T.PlaneGeometry(.2, .075), new T.MeshBasicMaterial({ map: tex })); scr.position.set(.37, .975, .298); scr.rotation.set(-.3, PI, 0, 'YXZ'); g.add(scr); let last = '';
    return { group: g, eye, placeholder: true, update(dt, s) { wheel.rotation.z = -(s.steer || 0) * 3.2; scr.material.color.setScalar(1.2 + (s.night || 0) * 1.6);
      const kmh = Math.round(Math.abs(s.speed || 0) * 3.6), txt = kmh + '|' + s.gear; if (txt !== last) { last = txt; cx.fillStyle = '#05080a'; cx.fillRect(0, 0, 256, 96); cx.fillStyle = '#ffb968'; cx.font = '600 62px "Avenir Next Condensed","DIN Condensed","Helvetica Neue",sans-serif'; cx.textAlign = 'right'; cx.textBaseline = 'middle'; cx.fillText(kmh, 168, 50);
        cx.font = '500 20px "Helvetica Neue",sans-serif'; cx.textAlign = 'left'; cx.fillStyle = '#9a8d7c'; cx.fillText('km/h', 178, 62); cx.fillStyle = '#7fe3ff'; cx.fillText(String(s.gear), 178, 34); tex.needsUpdate = true; } } };
  }
  function fbRoad(scene) {
    const k = GT.kit(), H = L.highway, y = -.02;
    k.box('dirt', 700, .2, 700, 60, -.14, 0); k.box('sand', 52, .2, 520, -35, -.1, 0); k.box(GT.mat('water_pool', { color: 0x2f6f86 }), 600, .1, 700, -360, -.12, 0);
    k.box('asphalt', H.width, .1, H.zMax - H.zMin + 120, 0, y, 0); k.box('asphalt', L.crossS.x1 + 12, .1, 9, L.crossS.x1 / 2, y + .002, L.crossS.z); k.box('asphalt', L.crossN.x1 + 12, .1, 9, L.crossN.x1 / 2, y + .002, L.crossN.z); k.box('asphalt', 9, .1, 330, L.backRoad.x, y + .001, 0);
    for (const sx of [-1, 1]) k.box('concrete', L.sidewalk, .16, 300, sx * (H.width / 2 + L.sidewalk / 2), .06, 0, { bevel: .02 });
    const st = L.station, mo = L.motel; k.box('concrete_stained', st.x1 - st.x0, .1, st.z1 - st.z0, (st.x0 + st.x1) / 2, y + .004, (st.z0 + st.z1) / 2); k.box('asphalt_worn', mo.x1 - mo.x0, .1, mo.z1 - mo.z0, (mo.x0 + mo.x1) / 2, y + .004, (mo.z0 + mo.z1) / 2);
    for (const dz of st.drives.concat([mo.drive])) k.box('asphalt_worn', 8, .1, 9, 11, y + .09, dz);
    for (let z = H.zMin - 50; z < H.zMax + 50; z += 9) { k.box('road_paint_white', .12, .01, 3, -4.5, y + .056, z); k.box('road_paint_white', .12, .01, 3, 4.5, y + .056, z); }
    for (const sx of [-1.5, 1.5]) k.box('road_paint_yellow', .12, .01, 440, sx, y + .056, 0); for (const sx of [-7.2, 7.2]) k.box('road_paint_white', .12, .01, 440, sx, y + .056, 0);
    k.box('road_paint_yellow', L.crossS.x1 - 12, .01, .12, L.crossS.x1 / 2 + 6, y + .058, L.crossS.z); k.box('road_paint_yellow', L.crossN.x1 - 12, .01, .12, L.crossN.x1 / 2 + 6, y + .058, L.crossN.z); k.box('road_paint_yellow', .12, .01, 300, L.backRoad.x, y + .058, 0);
    const r = GT.rng('fbroad'); for (let i = 0; i < 40; i++) { const x = (r() - .5) * 12, z = (r() - .5) * 360; k.decal(['oil_stain', 'tire_marks', 'patch', 'crack'][i % 4], 2 + r() * 3, 2 + r() * 4, x, y + .06, z, r() * TAU); }
    for (let i = 0; i < 26; i++) { const z = -180 + i * 14.5, x = -11.5 - (i % 3); k.cyl('palm_trunk', .16, .22, 8, x, 4, z, { seg: 10 }); for (let f = 0; f < 7; f++) k.box('palm_leaf', .5, .03, 3.2, x + Math.sin(f * .9) * 1.4, 7.8, z + Math.cos(f * .9) * 1.4, { ry: f * .9, rx: .35 }); GT.world.addPost(x, z, .25, 8, 'palm'); }
    scene.add(k.build());
  }
  function fbStation(scene) {
    const k = GT.kit(), st = L.station, s = st.store, c = st.canopy, sw = s.x1 - s.x0, sd = s.z1 - s.z0, cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    k.box('tile_floor', sw, .16, sd, cx, .06, cz); k.box('concrete', 3, .14, sd + 2, s.x0 - 1.5, .05, cz, { bevel: .02 });
    k.box('stucco_cream', .3, s.h, sd, s.x1, s.h / 2, cz, { bevel: .02 }); k.box('stucco_cream', sw, s.h, .3, cx, s.h / 2, s.z0, { bevel: .02 }); k.box('stucco_cream', sw, s.h, .3, cx, s.h / 2, s.z1, { bevel: .02 });
    k.box('stucco_cream', .34, 1.1, sd, s.x0, s.h - .55, cz, { bevel: .02 }); k.box('stucco_cream', .34, .7, sd, s.x0, .35, cz, { bevel: .02 }); k.box('roof_tar', sw + .6, .24, sd + .6, cx, s.h + .1, cz, { bevel: .03 }); k.box('ceiling_panel', sw - .4, .06, sd - .4, cx, s.h - 1.05, cz);
    for (let z = s.z0; z <= s.z1 + .01; z += 3) k.box('aluminium_brushed', .1, s.h - 1.8, .1, s.x0 - .1, .7 + (s.h - 1.8) / 2, z, { bevel: .01 });
    k.box('glass_clear', .03, s.h - 1.8, sd - .3, s.x0 - .1, .7 + (s.h - 1.8) / 2, cz);
    for (let z = s.z0 + 3; z < s.z1 - 2; z += 4.2) k.box('light_warm', sw - 3, .04, .3, cx, s.h - 1.1, z);
    for (let i = 0; i < 4; i++) k.box('metal_painted_white', 1, 1.7, 9, s.x0 + 5 + i * 3, .98, cz + 6, { bevel: .03 });
    k.box('wood_painted', 1.1, 1.05, 4.5, s.x0 + 6.5, .65, s.doorZ - 7, { bevel: .03 });
    k.box('metal_painted_white', c.w, .7, c.d, c.x, c.h + .35, c.z, { bevel: .05 }); k.box('light_cool', c.w - 3, .03, c.d - 4, c.x, c.h - .01, c.z);
    for (const p of st.pumps) { k.box('concrete', 1.3, .2, 3.6, p[0], .1, p[1], { bevel: .05 }); k.box('metal_painted_red', .7, 1.7, .9, p[0], 1.05, p[1], { bevel: .06 }); k.box('plastic_black', .72, .5, .7, p[0], 1.35, p[1], { bevel: .02 });
      k.cyl('metal_painted_white', .2, .2, c.h, p[0], c.h / 2, p[1] + 2.6, { seg: 14 }); GT.world.addBox(p[0] - .5, p[1] - .6, p[0] + .5, p[1] + .6, 1.8, 'pump'); GT.world.addPost(p[0], p[1] + 2.6, .22, c.h, 'column'); }
    k.box('metal_dark', .5, 9, .5, st.sign.x, 4.5, st.sign.z, { bevel: .04 }); k.box('neon_amber', .3, 2.2, 3.6, st.sign.x, 8, st.sign.z, { bevel: .03 }); GT.world.addPost(st.sign.x, st.sign.z, .3, 9, 'pylon');
    k.geo(GT.signMat ? GT.signMat('24H MARKET', { style: 'neon', color: '#ff5fa8', w: 1024, h: 128 }) : 'neon_pink', new T.PlaneGeometry(8, 1), { x: s.x0 - .2, y: s.h - .5, z: cz, ry: -PI / 2 });
    scene.add(k.build());
    GT.world.addBox(s.x1 - .2, s.z0, s.x1 + .2, s.z1, s.h, 'store'); GT.world.addBox(s.x0, s.z0 - .2, s.x1, s.z0 + .2, s.h, 'store'); GT.world.addBox(s.x0, s.z1 - .2, s.x1, s.z1 + .2, s.h, 'store');
    GT.world.addBox(s.x0 - .2, s.z0, s.x0 + .2, s.doorZ - 1, 1.2, 'storefront'); GT.world.addBox(s.x0 - .2, s.doorZ + 1, s.x0 + .2, s.z1, 1.2, 'storefront');
    GT.world.anchor('storeDoor', { x: s.x0, z: s.doorZ, h: -PI / 2 }); GT.world.anchor('registerFront', { x: s.x0 + 5, z: s.doorZ - 7, h: PI / 2 }); GT.world.anchor('clerk', { x: s.x0 + 8, z: s.doorZ - 7, h: -PI / 2 }); GT.world.anchor('safe', { x: s.x1 - 2.5, z: s.z0 + 3, h: PI / 2 });
    return { state: { alarm: false, doorOpen: false }, placeholder: true };
  }
  function fbMotel(scene) {
    const k = GT.kit(), m = L.motel, hh = m.floors * m.floorH;
    for (const [w, mat] of [[m.wingE, 'stucco_pink'], [m.wingN, 'stucco_teal']]) { k.box(mat, w.x1 - w.x0, hh, w.z1 - w.z0, (w.x0 + w.x1) / 2, hh / 2, (w.z0 + w.z1) / 2, { bevel: .04 }); k.box('roof_tar', w.x1 - w.x0 + .8, .25, w.z1 - w.z0 + .8, (w.x0 + w.x1) / 2, hh + .1, (w.z0 + w.z1) / 2, { bevel: .03 }); GT.world.addBox(w.x0, w.z0, w.x1, w.z1, hh, 'motel'); }
    for (let z = m.wingE.z0 + 2; z < m.wingE.z1 - 2; z += 4.6) for (let f = 0; f < m.floors; f++) { k.box('wood_painted', .08, 2.05, .95, m.wingE.x0 - .03, f * m.floorH + 1.1, z, { bevel: .01 }); k.box('light_warm', .06, .9, 1.3, m.wingE.x0 - .03, f * m.floorH + 1.6, z + 1.9); }
    k.box('concrete', 1.6, .16, m.wingE.z1 - m.wingE.z0, m.wingE.x0 - .8, m.floorH, (m.wingE.z0 + m.wingE.z1) / 2, { bevel: .02 });
    k.box(GT.mat('water_pool'), m.pool.w, .1, m.pool.d, m.pool.x, .02, m.pool.z); k.box('concrete', m.pool.w + 2, .12, m.pool.d + 2, m.pool.x, 0, m.pool.z, { bevel: .02 });
    k.box('metal_dark', .4, 8, .4, m.sign.x, 4, m.sign.z, { bevel: .04 }); k.box('neon_cyan', .3, 1.6, 4, m.sign.x, 7, m.sign.z, { bevel: .03 }); GT.world.addPost(m.sign.x, m.sign.z, .25, 8, 'sign');
    for (const p of m.parking) { k.box('road_paint_white', 5.2, .01, .1, p[0], .037, p[1] - 2); }
    scene.add(k.build()); return { placeholder: true };
  }
  /** colliders + anchors for a headless simulation (self-test): same footprint the placeholder world registers */
  function fbCollidersOnly() {
    const st = L.station, s = st.store, m = L.motel;
    GT.world.addBox(s.x1 - .2, s.z0, s.x1 + .2, s.z1, s.h, 'store'); GT.world.addBox(s.x0, s.z0 - .2, s.x1, s.z0 + .2, s.h, 'store'); GT.world.addBox(s.x0, s.z1 - .2, s.x1, s.z1 + .2, s.h, 'store');
    for (const p of st.pumps) GT.world.addBox(p[0] - .5, p[1] - .6, p[0] + .5, p[1] + .6, 1.8, 'pump');
    for (const w of [m.wingE, m.wingN]) GT.world.addBox(w.x0, w.z0, w.x1, w.z1, 6, 'motel');
    GT.world.anchor('storeDoor', { x: s.x0, z: s.doorZ, h: -PI / 2 }); GT.world.anchor('registerFront', { x: s.x0 + 5, z: s.doorZ - 7, h: PI / 2 }); GT.world.anchor('clerk', { x: s.x0 + 8, z: s.doorZ - 7, h: -PI / 2 }); GT.world.anchor('safe', { x: s.x1 - 2.5, z: s.z0 + 3, h: PI / 2 });
  }

  /* ================================================================== cars (visual + AI state) */
  let carSeq = 0;
  function normDims(d, kind) {
    const f = FB_DIMS[kind] || FB_DIMS.sedan; d = d || {};
    const o = { L: +d.L || f[0], W: +d.W || f[1], H: +d.H || f[2] }; o.wheelbase = +d.wheelbase || o.L * .58; o.track = +d.track || o.W - .34; o.wheelR = +d.wheelR || 0;
    const e = d.eye; o.eye = e ? (Array.isArray(e) ? new T.Vector3(e[0], e[1], e[2]) : new T.Vector3(+e.x || 0, +e.y || 0, +e.z || 0)) : new T.Vector3(.38, o.H - .22, -o.L * .06);
    return o;
  }
  function makeVehicle(kind, o) {
    if (!G.visual) return { group: null, dims: normDims(null, kind), wheels: [], steer: [], setLights() {}, update() {} };
    let v = null;
    const bad = G.mods.vehBad || (G.mods.vehBad = {});
    if (GT.vehicles && GT.vehicles.make && !bad[kind]) { if (GT.vehicles.kinds && GT.vehicles.kinds.indexOf(kind) < 0) { bad[kind] = true; warn('vehicles', 'kind "' + kind + '" not available, using placeholder'); } else v = safe('vehicles.make(' + kind + ')', () => GT.vehicles.make(kind, o || {}), null); }
    if (!v || !v.group) { bad[kind] = true; v = fbVehicle(kind, o); }
    v.dims = normDims(v.dims, kind); v.wheels = v.wheels || []; v.steer = v.steer || []; if (!v.setLights) v.setLights = () => {}; if (!v.update) v.update = () => {};
    for (let i = 0; i < v.steer.length; i++) if (v.steer[i] && v.steer[i] === v.wheels[i]) v.steer[i].rotation.order = 'YXZ';
    return v;
  }
  const CAR_MASS = { hero: 1700, sedan: 1500, pickup: 2100, compact: 1150, cruiser: 1900 };
  function mkCar(kind, o) {
    o = o || {};
    const c = { id: ++carSeq, kind, x: o.x || 0, z: o.z || 0, h: o.h || 0, y: 0, v: 0, steer: 0, px: 0, pz: 0, yk: 0, mode: o.mode || 'idle', path: null, s: 0, cruise: o.cruise || 12,
      parked: !!o.parked, isCop: kind === 'cruiser', mass: CAR_MASS[kind] || 1500, wheelRot: 0, stuckT: 0, revT: 0, brakeOn: false, alive: true, lights: { head: false, brake: false, reverse: false, left: false, right: false, siren: false }, lkey: '',
      roll: 0, pitch: 0, veh: null, root: null, body: null, dims: null, cop: null, wrap: !!o.wrap, color: o.color };
    c.veh = makeVehicle(kind, { color: o.color }); c.dims = c.veh.dims;
    if (G.visual) { c.root = new T.Group(); c.body = new T.Group(); c.body.add(c.veh.group); c.root.add(c.body); G.scene.add(c.root); }
    G.cars.push(c); return c;
  }
  function removeCar(c) { c.alive = false; if (c.root) G.scene.remove(c.root); let i = G.cars.indexOf(c); if (i >= 0) G.cars.splice(i, 1); i = G.cops.indexOf(c); if (i >= 0) G.cops.splice(i, 1); i = G.traffic.indexOf(c); if (i >= 0) G.traffic.splice(i, 1); }
  function syncCar(c, dt) {
    if (!c.root) return;
    c.root.position.set(c.x, c.y, c.z); c.root.rotation.y = c.h; c.body.rotation.z = c.roll; c.body.rotation.x = c.pitch;
    const v = c.veh, rw = c.dims.wheelR || .34; c.wheelRot += (c === P.car ? P.vx : c.v) / rw * dt;
    const wr = c === P.car ? P.wheelRot : c.wheelRot, wrR = c === P.car ? P.wheelRotR : c.wheelRot;
    for (let i = 0; i < v.wheels.length; i++) if (v.wheels[i]) v.wheels[i].rotation.x = i < 2 ? wr : wrR;
    const st = c === P.car ? P.steer : c.steer; for (let i = 0; i < v.steer.length; i++) if (v.steer[i]) v.steer[i].rotation.y = st;
    const l = c.lights, key = (l.head ? 1 : 0) + (l.brake ? 2 : 0) + (l.reverse ? 4 : 0) + (l.left ? 8 : 0) + (l.right ? 16 : 0) + (l.siren ? 32 : 0);
    if (key !== c.lkey) { c.lkey = key; safe('setLights', () => v.setLights({ head: l.head, brake: l.brake, reverse: l.reverse, left: l.left, right: l.right, siren: l.siren })); }
    if (!c.updBroken) { try { v.update(dt); } catch (e) { c.updBroken = true; warn('vehicle.update', e); } }
  }
  const _q1 = {}, _q2 = {};
  function aiDrive(c, tx, tz, vT, dt) {
    const err = angDiff(c.h, Math.atan2(tx - c.x, tz - c.z)), sp = Math.abs(c.v), maxS = .6 / (1 + (sp / 20) * (sp / 20)) + .03;
    let st = clamp(err * 1.7, -maxS, maxS);
    if (c.revT > 0) { c.revT -= dt; st = -Math.sign(err || 1) * .5; vT = -4.5; }
    c.steer += clamp(st - c.steer, -2.8 * dt, 2.8 * dt);
    const acc = c.isCop ? (c.cop && c.cop.state === 'pursue' ? 6.2 : 5) : 3, brk = c.isCop ? 12 : 8, dv = vT - c.v;
    c.brakeOn = dv < -.8 || (vT === 0 && sp < .3); c.v += clamp(dv, -brk * dt, acc * dt);
    const tn = Math.abs(Math.tan(c.steer)); if (tn > .02) { const vm = Math.sqrt(7.4 * c.dims.wheelbase / tn); if (c.v > vm) { c.v = Math.max(vm, c.v - 14 * dt); c.brakeOn = true; } }   // grip limit: AI cars cannot corner faster than ~0.75 g, so every bend is a chance to open a gap
    c.h += (c.v * Math.tan(c.steer) / c.dims.wheelbase + c.yk) * dt;
    c.x += (Math.sin(c.h) * c.v + c.px) * dt; c.z += (Math.cos(c.h) * c.v + c.pz) * dt;
    const dm = Math.exp(-3.2 * dt); c.px *= dm; c.pz *= dm; c.yk *= Math.exp(-3 * dt);
    c.roll += (clamp(c.v * c.v * Math.tan(c.steer) / c.dims.wheelbase * .0045, -.06, .06) - c.roll) * Math.min(1, dt * 5);
    c.pitch += (clamp(-dv * .012, -.03, .03) - c.pitch) * Math.min(1, dt * 4);
  }
  function coast(c, dt) {
    c.v *= Math.exp(-3.5 * dt); c.h += c.yk * dt; c.x += (Math.sin(c.h) * c.v + c.px) * dt; c.z += (Math.cos(c.h) * c.v + c.pz) * dt;
    const dm = Math.exp(-3.2 * dt); c.px *= dm; c.pz *= dm; c.yk *= dm; c.brakeOn = false; c.steer *= .9; c.roll *= .9; c.pitch *= .9;
  }
  /** keep distance from whatever is ahead in my lane (other cars, the player) */
  function gapLimit(c, vT) {
    const f = Math.sin(c.h), g = Math.cos(c.h), reach = 9 + Math.abs(c.v) * 1.7;
    const chk = (ox, oz, oh, ov) => { const dx = ox - c.x, dz = oz - c.z, fz = dx * f + dz * g; if (fz < 1 || fz > reach) return; if (Math.abs(dx * g - dz * f) > 1.95) return;
      const gap = fz - 5.6, lim = gap < .6 ? 0 : Math.max(0, ov * Math.cos(angDiff(c.h, oh))) + gap * .9; if (lim < vT) vT = lim; };
    for (const o of G.cars) if (o !== c && o !== P.car) chk(o.x, o.z, o.h, o.v);
    if (P.car) chk(P.x, P.z, P.h, P.vx);
    return vT;
  }
  const _ps1 = {}, _ps2 = {};
  /** highest speed that still makes the bends coming up on this path (lateral limit ~0.65 g, braking 4 m/s^2) */
  function pathSpeed(path, s, latA) {
    let lim = 99; for (const d of [0, 6, 13, 22, 32, 44]) { const th = Math.abs(angDiff(pathAt(path, s + d, _ps1).h, pathAt(path, s + d + 7, _ps2).h)); if (th < .03) continue; const vc2 = (latA || 6.5) * 7 / th; lim = Math.min(lim, Math.sqrt(vc2 + 8 * d)); }
    return Math.max(4.5, lim);
  }
  function followPath(c, vT, dt, noGap) {
    c.s = pathAdvance(c.path, c.s, c.x, c.z);
    const sp = Math.abs(c.v), q = pathAt(c.path, c.s + 4.5 + sp * .6, _q1);
    vT = Math.min(vT, pathSpeed(c.path, c.s, c.isCop && c.cop.state !== 'patrol' && c.cop.state !== 'scripted' ? 8 : 6));
    if (!c.path.closed) { const rem = c.path.len - c.s; if (c.stopAtEnd) vT = Math.min(vT, Math.max(0, (rem - .6) * .9)); }
    if (!noGap) vT = gapLimit(c, vT);
    aiDrive(c, q.x, q.z, vT, dt);
    return !c.path.closed && c.s >= c.path.len - 1.2;
  }
  function setPath(c, path, s) { c.path = path; c.s = s === undefined ? pathNearest(path, c.x, c.z) : s; }
  function placeOnPath(c, path, s) { const q = pathAt(path, s, _q1); c.x = q.x; c.z = q.z; c.h = q.h; c.path = path; c.s = s; c.v = 0; c.steer = 0; }
  function aiCollideWorld(c) {
    const r = 1.0, f = Math.sin(c.h), g = Math.cos(c.h); let hit = false;
    for (const k of [1.35, -1.35]) { const px = c.x + f * k, pz = c.z + g * k, B = nearBoxes(px, pz, r + .2);
      for (const b of B) { if (b.h < .35) continue; const qx = clamp(px, b.x0, b.x1), qz = clamp(pz, b.z0, b.z1), dx = px - qx, dz = pz - qz, d = hyp(dx, dz);
        if (d < r && d > 1e-4) { const p = r - d, nx = dx / d, nz = dz / d; c.x += nx * p; c.z += nz * p; const vn = (f * nx + g * nz) * Math.sign(c.v || 1); if (vn < -.5) c.v *= .55; else c.v *= .985; hit = true; } } }
    return hit;
  }
  function separateCars() {
    const C = G.cars;
    for (let i = 0; i < C.length; i++) { const a = C[i]; if (a === P.car) continue;
      for (let j = i + 1; j < C.length; j++) { const b = C[j]; if (b === P.car || (a.parked && b.parked)) continue; const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz; if (d2 > 7.3 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), p = (2.7 - d), nx = dx / d, nz = dz / d, fa = a.parked ? 0 : (b.parked ? 1 : .5); a.x -= nx * p * fa; a.z -= nz * p * fa; b.x += nx * p * (1 - fa); b.z += nz * p * (1 - fa); a.v *= .97; b.v *= .97; } }
  }

  /* ================================================================== pedestrians */
  function makeFigure(kind, o) {
    if (!G.visual) return { group: null, update() {} };
    let f = null; if (GT.people && GT.people.make && !G.mods.peopleBad) { f = safe('people.make(' + kind + ')', () => GT.people.make(kind, { seed: (o && o.seed) || 0 }), null); if (!f || !f.group) G.mods.peopleBad = true; }
    if (!f || !f.group) f = fbPerson(kind, o); if (!f.update) f.update = () => {}; return f;
  }
  function mkPed(kind, o) {
    o = o || {}; const p = { kind, x: o.x || 0, z: o.z || 0, h: o.h || 0, y: 0, state: o.state || 'idle', idle: o.state || 'idle', move: 'walk', spd: 0, speed: 0, wp: null, wpi: 0, onDone: null, vis: o.vis !== false, react: 0, witness: false, seat: null, fig: null, floor: 0, role: o.role || '' };
    p.fig = makeFigure(kind, o); if (p.fig.group) { G.scene.add(p.fig.group); p.fig.group.visible = p.vis; }
    G.peds.push(p); return p;
  }
  function pedGo(p, pts, spd, move, onDone) { p.wp = pts; p.wpi = 0; p.spd = spd; p.move = move || (spd > 2.4 ? 'run' : 'walk'); p.onDone = onDone || null; }
  function pedStep(p, dt) {
    if (p.wp && p.wpi < p.wp.length) { const w = p.wp[p.wpi], dx = w[0] - p.x, dz = w[1] - p.z, d = hyp(dx, dz), st = p.spd * dt;
      if (d <= st + .02) { p.x = w[0]; p.z = w[1]; p.wpi++; if (p.wpi >= p.wp.length) { p.wp = null; p.speed = 0; p.state = p.idle; const f = p.onDone; p.onDone = null; if (f) f(p); } }
      else { p.x += dx / d * st; p.z += dz / d * st; p.h += angDiff(p.h, Math.atan2(dx, dz)) * Math.min(1, dt * 10); p.speed = p.spd; p.state = p.move; } }
    else p.speed = 0;
    if (p.react > 0) { p.react -= dt; if (p.react <= 0 && !p.wp) p.state = p.idle; }
  }
  function syncPed(p, dt) {
    const g = p.fig.group; if (!g) return; const vis = p.vis && !(p.seat && CAM.mode === 'fp' && !G.showPassenger); g.visible = vis; if (!vis) return;
    if (p.seat) { const c = p.seat.car, s = Math.sin(c.h), co = Math.cos(c.h), o = p.seat; g.position.set(c.x + co * o.x + s * o.z, c.y + o.y, c.z - s * o.x + co * o.z); g.rotation.y = c.h; }
    else { const st = L.station.store, inside = p.x > st.x0 - .3 && p.x < st.x1 && p.z > st.z0 && p.z < st.z1; let y = groundY(p.x, p.z) + (p.lift || 0); if (inside) y = Math.max(y, G.storeFloor); p.y += (y - p.y) * Math.min(1, dt * 12); g.position.set(p.x, p.y, p.z); g.rotation.y = p.h; }
    if (!p.updBroken) { try { p.fig.update(dt, { state: p.state, speed: p.speed }); } catch (e) { p.updBroken = true; warn('people.update', e); } }
  }

  /* ================================================================== the player's car: arcade-sim bicycle model with weight transfer + tyre curve */
  const SPECS = {
    hero: { mass: 1700, Iz: 3000, hcg: .5, peakT: 540, final: 3.42, gears: [2.72, 1.98, 1.43, 1.0, .82], rev: 2.9, rw: .345, cd: .98, brake: 1.05, mu: 1.04, steerMax: .6, front: .53 },
    sedan: { mass: 1500, Iz: 2600, hcg: .55, peakT: 310, final: 3.7, gears: [3.4, 2.1, 1.4, 1.0, .78], rev: 3.2, rw: .33, cd: .9, brake: .98, mu: .96, steerMax: .58, front: .57 },
    pickup: { mass: 2100, Iz: 3900, hcg: .68, peakT: 440, final: 3.9, gears: [3.3, 2.0, 1.36, 1.0, .76], rev: 3.2, rw: .39, cd: 1.25, brake: .92, mu: .9, steerMax: .56, front: .58 },
    compact: { mass: 1150, Iz: 1800, hcg: .52, peakT: 200, final: 4.1, gears: [3.5, 2.05, 1.38, 1.0, .8], rev: 3.3, rw: .31, cd: .8, brake: 1.0, mu: .97, steerMax: .6, front: .6 }
  };
  const P = { x: 0, z: 0, h: 0, y: 0, vx: 0, vy: 0, r: 0, steer: 0, gear: 1, rpm: 850, shiftT: 0, revT: 0, axS: 0, ayS: 0, roll: 0, pitch: 0, spin: 0, slipF: 0, slipR: 0, squeal: 0, damage: 0, pull: 1,
    car: null, spec: null, engineOn: true, lightsOn: false, wheelRot: 0, wheelRotR: 0, lastHitT: -9, dip: 0, dipV: 0, odo: 0, thr: 0, brk: 0, hand: 0, bob: 0 };
  function setPlayerCar(c) {
    P.car = c; const base = SPECS[c.kind] || SPECS.sedan, S = Object.assign({}, base); S.wb = c.dims.wheelbase; S.a = S.wb * (1 - S.front); S.b = S.wb * S.front; P.spec = S;
    P.x = c.x; P.z = c.z; P.h = c.h; P.vx = P.vy = P.r = 0; P.steer = 0; P.gear = 1; P.rpm = 850; P.axS = P.ayS = 0; c.parked = false; c.mode = 'player';
  }
  /** put the player's car somewhere, at rest (story beats / checkpoints) */
  function placePlayer(x, z, h) { const c = P.car; P.x = x; P.z = z; P.h = h; P.vx = P.vy = P.r = 0; P.steer = 0; P.gear = 1; P.rpm = 850; P.axS = P.ayS = 0; P.roll = P.pitch = 0; P.revT = 0; P.y = groundY(x, z);
    if (c) { c.x = x; c.z = z; c.h = h; c.v = 0; c.y = P.y; c.roll = c.pitch = 0; c.steer = 0; } const I = G.input; I.throttle = I.brake = I.steer = I.hand = 0; }
  const TQ = [[600, .5], [1200, .68], [2200, .86], [3400, .98], [4200, 1], [5200, .93], [5900, .8], [6400, .55]];
  function torqueAt(rpm) { if (rpm <= TQ[0][0]) return TQ[0][1]; for (let i = 1; i < TQ.length; i++) if (rpm <= TQ[i][0]) { const a = TQ[i - 1], b = TQ[i]; return a[1] + (b[1] - a[1]) * (rpm - a[0]) / (b[0] - a[0]); } return .3; }
  const tyre = (a, B) => Math.sin(1.42 * Math.atan(B * a));
  function physStep(dt, inp) {
    const S = P.spec, m = S.mass, g = 9.81, a = S.a, b = S.b, wb = S.wb, sf = surface(P.x, P.z), mu = S.mu * sf.grip;
    let thr = P.engineOn ? inp.throttle : 0, brk = inp.brake; const hand = inp.hand;
    if (P.gear >= 0) { if (brk > .1 && thr < .1 && P.vx < .7) { P.revT += dt; if (P.revT > .12) P.gear = -1; } else P.revT = 0; if (P.gear === 0) P.gear = 1; }
    if (P.gear < 0) { if (thr > .1 && brk < .1 && P.vx > -.7) { P.gear = 1; P.revT = 0; } else { const t = thr; thr = brk; brk = t; } }
    const sp = hyp(P.vx, P.vy), beta = sp > 4 ? Math.atan2(P.vy, Math.abs(P.vx)) : 0, ab = Math.abs(beta);
    if (P.gear > 0 && hand <= 0) thr *= 1 - .55 * sstep(ab, .22, .6);          // easing the power when the tail is far out keeps slides catchable on a keyboard
    P.thr = thr; P.brk = brk; P.hand = hand;
    // steering: speed-sensitive lock, rate-limited, with a self-aligning assist that eases the wheels toward the direction of travel
    const lim = S.steerMax / (1 + Math.pow(sp / 15, 1.5)) + .03;
    let tgt = inp.steer * lim * (1 - .5 * sstep(ab, .2, .55) * (inp.steer * beta < 0 ? 1 : 0)); if (P.vx > 3) tgt += clamp(beta * .7, -.3, .3); if (sp > 6) tgt += P.damage * .03 * P.pull;
    const rate = (Math.abs(inp.steer) < .05 ? 3 : 2) * (1 + sp * .01); P.steer += clamp(tgt - P.steer, -rate * dt, rate * dt);
    // axle loads with longitudinal weight transfer
    const tr = m * P.axS * S.hcg / wb, Fzf = Math.max(m * g * .12, m * g * b / wb - tr), Fzr = Math.max(m * g * .12, m * g * a / wb + tr);
    // drivetrain
    const ratio = P.gear > 0 ? S.gears[P.gear - 1] : -S.rev, tot = ratio * S.final, rpmW = Math.abs(P.vx) / S.rw * Math.abs(tot) * 60 / TAU;
    const launch = (P.gear === 1 || P.gear < 0) ? 880 + thr * 2500 : 880, rpmT = Math.min(6450, Math.max(rpmW, launch));
    P.rpm += (rpmT - P.rpm) * Math.min(1, dt * (rpmT > P.rpm ? 10 : 5.5));
    if (P.shiftT > 0) P.shiftT -= dt;
    else if (P.gear > 0) { if (rpmW > 5750 && P.gear < S.gears.length) { P.gear++; P.shiftT = .2; }
      else if (P.gear > 1 && rpmW < (thr > .8 ? 3100 : 1850) && rpmW * S.gears[P.gear - 2] / S.gears[P.gear - 1] < 5300) { P.gear--; P.shiftT = .14; } }
    let Te = thr * S.peakT * torqueAt(P.rpm) * (1 - .3 * P.damage) * (P.shiftT > 0 ? .08 : 1); if (rpmW > 6350) Te = 0;
    if (thr < .04 && sp > 1) Te = -(26 + P.rpm * .011);
    let Fd = Te * tot * .88 / S.rw; if (thr < .04 && P.vx * tot < 0) Fd = 0;
    const dirx = clamp(P.vx * 3, -1, 1), capR = mu * Fzr;
    const FbF = -dirx * Math.min(brk * S.brake * m * g * .64, mu * Fzf * .98);
    let FbR = -dirx * Math.min(brk * S.brake * m * g * .36, capR * .9);
    if (hand > 0) { FbR = -dirx * capR * .9; Fd *= .25; }
    P.spin = Math.abs(Fd) / capR;
    let FxR = Fd + FbR; if (Math.abs(FxR) > capR * .94) FxR = Math.sign(FxR) * capR * .94;
    const use = Math.abs(FxR) / capR; let latK = Math.max(.6, Math.sqrt(Math.max(0, 1 - use * use))) * 1.13; if (hand > 0) latK = .36;
    // tyres
    const cs = Math.cos(P.steer), sn = Math.sin(P.steer), vfy = P.vy + a * P.r, vlat = -P.vx * sn + vfy * cs, vlong = P.vx * cs + vfy * sn;
    const af = Math.atan2(vlat, Math.max(Math.abs(vlong), 3)), ar = Math.atan2(P.vy - b * P.r, Math.max(Math.abs(P.vx), 3));
    const FyF = -mu * Fzf * tyre(af, 10.5), FyR = -latK * capR * tyre(ar, 11.5);
    P.slipF = Math.abs(af); P.slipR = Math.abs(ar);
    const rollR = (.014 * m * g + sf.drag * m * 1.2) * dirx;
    const Fx = FxR + FbF * cs - FyF * sn - S.cd * P.vx * Math.abs(P.vx) - rollR - sf.drag * m * P.vx * .35;
    const Fy = FyR + FyF * cs + FbF * sn - sf.drag * m * P.vy * .35, Mz = a * (FyF * cs + FbF * sn) - b * FyR - (hand > 0 ? 0 : S.Iz * 3.4 * sstep(ab, .3, .75) * P.r);
    const ax = Fx / m, ay = Fy / m;
    P.vx += (ax + P.vy * P.r) * dt; P.vy += (ay - P.vx * P.r) * dt; P.r += Mz / S.Iz * dt;
    P.axS += (ax - P.axS) * Math.min(1, dt * 7); P.ayS += (ay - P.ayS) * Math.min(1, dt * 7);
    if (sp < .35 && Math.abs(Fd) < 300) { const k = Math.exp(-14 * dt); P.vx *= k; P.vy *= k; P.r *= k; }
    const s = Math.sin(P.h), c = Math.cos(P.h); P.x += (s * P.vx + c * P.vy) * dt; P.z += (c * P.vx - s * P.vy) * dt; P.h += P.r * dt; P.odo += Math.abs(P.vx) * dt;
    P.wheelRot += P.vx / S.rw * dt; P.wheelRotR += (hand > 0 ? 0 : P.vx / S.rw * (1 + Math.max(0, P.spin - 1) * 1.6 * Math.sign(Fd * P.vx || 1))) * dt;
    const Bd = L.bounds; if (P.x < Bd.x0 - 6) { P.x = Bd.x0 - 6; wallStop(1, 0); } if (P.x > Bd.x1 + 30) { P.x = Bd.x1 + 30; wallStop(-1, 0); } if (P.z < Bd.z0 - 34) { P.z = Bd.z0 - 34; wallStop(0, 1); } if (P.z > Bd.z1 + 34) { P.z = Bd.z1 + 34; wallStop(0, -1); }
  }
  const _wv = { x: 0, z: 0 }, _imp = { jx: 0, jz: 0 };
  function getWv() { const s = Math.sin(P.h), c = Math.cos(P.h); _wv.x = s * P.vx + c * P.vy; _wv.z = c * P.vx - s * P.vy; }
  function setWv(x, z) { const s = Math.sin(P.h), c = Math.cos(P.h); P.vx = s * x + c * z; P.vy = c * x - s * z; }
  function wallStop(nx, nz) { getWv(); const vn = _wv.x * nx + _wv.z * nz; if (vn < 0) setWv(_wv.x - vn * nx * 1.1, _wv.z - vn * nz * 1.1); }
  /** impulse at contact offset (ox,oz) from the CG along normal n (pointing toward the player). Returns closing speed (>0 if they were colliding). */
  function applyImpulse(ox, oz, nx, nz, e, ovx, ovz, imO) {
    getWv(); const S = P.spec, vcx = _wv.x + P.r * oz - ovx, vcz = _wv.z - P.r * ox - ovz, vn = vcx * nx + vcz * nz; _imp.jx = _imp.jz = 0; if (vn >= 0) return 0;
    const c = oz * nx - ox * nz, k = 1 / S.mass + c * c / S.Iz + imO, j = -(1 + e) * vn / k;
    const tx = -nz, tz = nx, vt = vcx * tx + vcz * tz, ct = oz * tx - ox * tz, kt = 1 / S.mass + ct * ct / S.Iz + imO, jt = clamp(-vt / kt, -.3 * j, .3 * j);
    _imp.jx = j * nx + jt * tx; _imp.jz = j * nz + jt * tz;
    setWv(_wv.x + _imp.jx / S.mass, _wv.z + _imp.jz / S.mass); P.r = clamp(P.r + (j * c + jt * ct) / S.Iz, -4.5, 4.5);
    return -vn;
  }
  const CPTS = [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0], [1, .5], [-1, .5], [1, -.5], [-1, -.5]];
  function collideWorld() {
    const d = P.car.dims, hl = d.L / 2 - .06, hw = d.W / 2 - .03, s = Math.sin(P.h), c = Math.cos(P.h), B = nearBoxes(P.x, P.z, hl + 1.2);
    for (let bi = 0; bi < B.length; bi++) { const b = B[bi]; if (b.h < .3) continue;
      let best = 0, nx = 0, nz = 0, cx = 0, cz = 0; const tx = b.x1 - b.x0, tz = b.z1 - b.z0, bcx = (b.x0 + b.x1) / 2, bcz = (b.z0 + b.z1) / 2;
      for (let i = 0; i < CPTS.length; i++) { const lx = CPTS[i][0] * hw, lz = CPTS[i][1] * hl, wx = P.x + c * lx + s * lz, wz = P.z - s * lx + c * lz;
        if (wx <= b.x0 || wx >= b.x1 || wz <= b.z0 || wz >= b.z1) continue;
        let dep, ax, az; const d0 = wx - b.x0, d1 = b.x1 - wx, d2 = wz - b.z0, d3 = b.z1 - wz;
        if (tx < .6 && tx < tz) { if (P.x < bcx) { dep = d0; ax = -1; } else { dep = d1; ax = 1; } az = 0; }
        else if (tz < .6 && tz < tx) { if (P.z < bcz) { dep = d2; az = -1; } else { dep = d3; az = 1; } ax = 0; }
        else { dep = Math.min(d0, d1, d2, d3); ax = dep === d0 ? -1 : (dep === d1 ? 1 : 0); az = ax ? 0 : (dep === d2 ? -1 : 1); }
        if (dep > best) { best = dep; nx = ax; nz = az; cx = wx; cz = wz; } }
      const qx = clamp(P.x, b.x0, b.x1), qz = clamp(P.z, b.z0, b.z1), dx = qx - P.x, dz = qz - P.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < hw && Math.abs(lz) < hl) { const px = hw - Math.abs(lx), pz = hl - Math.abs(lz); let dep, ax, az;
        if (px < pz) { dep = px; const k = lx > 0 ? -1 : 1; ax = c * k; az = -s * k; } else { dep = pz; const k = lz > 0 ? -1 : 1; ax = s * k; az = c * k; }
        if (dep > best) { best = dep; nx = ax; nz = az; cx = qx; cz = qz; } }
      if (best > 0) { best = Math.min(best, 1.5); P.x += nx * best; P.z += nz * best; const vn = applyImpulse(cx - P.x, cz - P.z, nx, nz, .1, 0, 0, 0); if (vn > .4) onCrash(vn, 'world', b); } }
  }
  function collideCars() {
    const d = P.car.dims, rP = d.W / 2, oP = d.L / 2 - rP, sP = Math.sin(P.h), cP = Math.cos(P.h);
    for (const o of G.cars) { if (o === P.car) continue; const ddx = o.x - P.x, ddz = o.z - P.z; if (ddx * ddx + ddz * ddz > 42) continue;
      const rO = o.dims.W / 2, oO = o.dims.L / 2 - rO, sO = Math.sin(o.h), cO = Math.cos(o.h); let best = 0, nx = 0, nz = 0, cx = 0, cz = 0;
      for (let i = -1; i <= 1; i++) { const ax = P.x + sP * oP * i, az = P.z + cP * oP * i; for (let j = -1; j <= 1; j++) { const bx = o.x + sO * oO * j, bz = o.z + cO * oO * j, dx = ax - bx, dz = az - bz, dd = hyp(dx, dz), pen = rP + rO - dd;
        if (pen > best && dd > 1e-4) { best = pen; nx = dx / dd; nz = dz / dd; cx = bx + nx * rO; cz = bz + nz * rO; } } }
      if (best <= 0) continue;
      const fO = o.parked ? .3 : .45; P.x += nx * best * (1 - fO); P.z += nz * best * (1 - fO); o.x -= nx * best * fO; o.z -= nz * best * fO;
      const ovx = sO * o.v + o.px, ovz = cO * o.v + o.pz, vn = applyImpulse(cx - P.x, cz - P.z, nx, nz, .16, ovx, ovz, 1 / o.mass);
      if (vn > 0) { const jx = -_imp.jx / o.mass, jz = -_imp.jz / o.mass, al = jx * sO + jz * cO; o.v += al; o.px += jx - al * sO; o.pz += jz - al * cO;
        const rx = cx - o.x, rz = cz - o.z; o.yk = clamp(o.yk + (rz * -_imp.jx - rx * -_imp.jz) / (o.mass * 2.4), -2.5, 2.5); if (vn > .5) onCrash(vn, o.isCop ? 'cop' : 'car', o); } }
  }
  function onCrash(vn, what, obj) {
    const sev = clamp((vn - 1.5) / 24, 0, 1); if (sev > 0) { P.damage = Math.min(1, P.damage + sev * .42); if (P.damage > .15 && P.pull === 1) P.pull = rnd() < .5 ? -1 : 1; }
    if (G.time - P.lastHitT > .25 || vn > 6) emit('crash', { v: clamp(vn / 18, .08, 1), what, obj, vn });
    P.lastHitT = G.time; P.dipV -= Math.min(1.6, vn * .12);
  }
  function emit(type, data) { G.events.push({ type, data: data || {}, t: G.time }); if (G.events.length > 400) G.events.splice(0, 100); if (G.onEvent) G.onEvent(type, data || {}); }

  /* ================================================================== banter (original lines; shown as subtitles) */
  const WHO = { p: '阿烈', s: '警用频道', d: '电台', n: '' };
  const LINES = {
    start: [['p', '发动机别熄。盯着后视镜，看见警车就按喇叭。'], ['p', '两分钟。镜子里有动静就叫我。']],
    inside: [['p', '手举起来！钱，全部，装袋！'], ['p', '别按那个按钮。慢慢来，把抽屉打开。']],
    toSafe: [['p', '收银台就这点零钱。我去后面开保险柜。'], ['p', '抽屉太瘦了。保险柜在后面，等我。']],
    safe1: [['p', '第一层开了。再给我十秒。'], ['p', '有了！还有更厚的。']],
    safe2: [['p', '第二层……这家店生意不错。'], ['p', '再一层，再一层就走。']],
    safe3: [['p', '全空了！我出来了！'], ['p', '装满了，走！']],
    patrol1: [['s', '十二号车，沿海公路例行巡逻，一切正常。'], ['s', '十二号车报告，海滨路南向，无异常。']],
    patrol2: [['s', '十二号车，去加油站买杯咖啡，五分钟。'], ['s', '十二号车，日落加油站停一下，补给。']],
    patrolSeen: [['n', '后视镜里——巡逻车拐进来了。']],
    witnessCar: [['n', '有车进站加油。多一双眼睛。']],
    walker: [['n', '有人朝店门走过来了。']],
    honk: [['p', '听见了！出来了！'], ['p', '来了来了！']],
    flash: [['p', '看到灯了。撤。'], ['p', '收到。安静地走。']],
    flashMiss: [['n', '他在里屋，看不见车灯——只有喇叭叫得动他。']],
    nerve: [['n', '店员的手在往柜台下面摸。']],
    alarm: [['p', '该死，警报响了！'], ['p', '他按了！快走快走！']],
    silentCall: [['s', '各单位注意，日落加油站，有人报案称持械抢劫。']],
    copLook: [['s', '十二号车呼叫，加油站内有可疑情况，请求支援！']],
    getInCalm: [['p', '走。别急，像没事人一样开出去。'], ['p', '稳着点开。没人看见我们。']],
    getInHot: [['p', '开车开车开车！'], ['p', '踩到底！']],
    call: [['s', '各单位，日落加油站抢劫，嫌疑人已驾车离开。'], ['s', '海滨路全线注意，加油站劫案，嫌疑车辆在逃。']],
    callCar: [['s', '目击者描述：深红色双门跑车。'], ['s', '嫌疑车辆，暗红色肌肉车，注意拦截。']],
    callNoCar: [['s', '暂无车辆描述，留意可疑车辆。'], ['p', '他们不知道我们开什么车。别给他们理由拦你。']],
    spotted: [['p', '被咬上了！甩掉他！'], ['p', '后面！警车！'], ['s', '发现嫌疑车辆，正在追击！']],
    lost: [['p', '看不见他们了。别松油门……不，松一点。'], ['s', '目标脱离视线，各单位扩大搜索。'], ['p', '甩掉了。趁现在去旅馆换车。']],
    needSwap: [['p', '这车太扎眼了。去汽车旅馆，停车场里随便挑一辆。'], ['p', '他们认得这辆车。北边旅馆，换一辆。']],
    lowKey: [['p', '没人认得我们。慢慢开，等风头过去。']],
    stars4: [['s', '请求在路口设卡，重复，路口设卡。'], ['p', '他们在前面堵路了！']],
    crash: [['p', '嘿！这车还要还的！'], ['p', '看路！'], ['p', '我的牙……']],
    crashCop: [['p', '你撞的是警车！'], ['p', '这下罪名又多一条。']],
    swapNear: [['p', '就这辆。熄火，换。']],
    swapStart: [['p', '我放风。你接线，手别抖。'], ['p', '快点。镜子里有警车就先别动。']],
    hwOk: [['n', '火花——接上了一根。'], ['n', '又一根。']],
    hwFail: [['p', '轻点！你想让整条街都听见？'], ['p', '错了，重来。']],
    hwWait: [['p', '别动……有警车经过。等它走。']],
    swapSeen: [['p', '糟了，他们看见我们换车了！']],
    swapDone: [['p', '着了！我趴下，你就当自己是个下班的。'], ['p', '漂亮。慢慢开出去，别超速。']],
    cleanNear: [['p', '警车就在旁边……别看他，别加速。'], ['p', '稳住。我们只是路过。']],
    cleanFlag: [['p', '你开太野了，他们盯上这辆了！'], ['s', '可疑车辆，灰色轿车，拦下检查。']],
    pedPhone: [['n', '路边有人掏出了手机。']],
    exitOpen: [['p', '风头过了。去南头的封路口，老周在路障那儿等着接钱。'], ['p', '搜索撤了。南端路障，把车停到接应的人旁边。']],
    bustWarn: [['p', '别停下！一停就完了！']],
    busted: [['s', '嫌疑人已控制。']],
    abandon: [['p', '你……你把我丢下了？！']],
    engineDead: [['p', '车不行了……']],
    radio: [['d', '珊瑚电台，陪你把这条海岸线开到天黑。'], ['d', '今晚有风，适合开窗，不适合惹事。']]
  };
  const SUB = { cur: null, q: [], t: 0 };
  function say(key, force) {
    const set = LINES[key]; if (!set) return; const l = set[Math.floor(rnd() * set.length) % set.length], it = { who: WHO[l[0]], kind: l[0], text: l[1], dur: 1.6 + l[1].length * .13, key };
    if (force) SUB.q.length = 0; if (SUB.q.length < 3) SUB.q.push(it); emit('line', it);
  }
  function subStep(dt) { if (SUB.cur) { SUB.t += dt; if (SUB.t > SUB.cur.dur || (SUB.q.length && SUB.t > 1.3)) SUB.cur = null; } if (!SUB.cur && SUB.q.length) { SUB.cur = SUB.q.shift(); SUB.t = 0; } }

  /* ================================================================== the heist: WAIT -> GO */
  const R = {}, W = {}, HW = {};
  function resetRun() {
    for (const c of G.cars.slice()) removeCar(c);
    for (const p of G.peds) if (p.fig.group) G.scene.remove(p.fig.group);
    G.cars.length = G.cops.length = G.traffic.length = G.peds.length = G.swapCars.length = 0; G.events.length = 0; SUB.cur = null; SUB.q.length = 0;
    rnd = GT.rng('game' + G.seed); G.time = 0; G.slow = 1; G.focusE = 1; if (G.ap) Object.assign(G.ap, { stage: 0, honked: false, path: null, yieldT: 0 });
    Object.assign(R, { t: 0, stage: 'start', take: 0, nerve: 0, alarm: false, bell: false, honked: false, honkT: -99, flashT: -99, signalT: -1, regT: 0, safeT: 0, safeN: 0, pumpAlert: false, doorCam: false,
      faceSeen: false, carSeen: false, plateSeen: false, nRate: .85 + rnd() * .3, witnessCar: null, pumpGuy: null, walker: null, walkerSaw: false, patrol: null, visitor: null, patrolStage: 0, patrolStopT: 0, nerveWarned: false, doorT: 0, mirrorSaid: false, runT: 0, copSaw: false, alarmHow: '' });
    Object.assign(W, { stars: 0, peak: 0, hot: false, called: false, callT: -1, lastSeenT: -99, lastKnown: { x: L.heroStart.x, z: L.heroStart.z }, searchT: 0, susp: 0, idT: 0, bustT: 0, blockT: 0, swapped: false, exitOpen: false, visT: 0, spawnT: 0, crashT: -9, hotTime: 0, needSaid: false, exitSaid: false, nearSaid: -99, seenBy: 0,
      chips: { face: { on: false, valid: true }, car: { on: false, valid: true }, plate: { on: false, valid: true } } });
    Object.assign(HW, { stage: 0, p: 0, dir: 1, zones: [.5, .5, .5], w: .2, flash: -9, hold: 0, target: null, waitSaid: -99, nearSaid: false, seen: false, danger: false });
    Object.assign(P, { damage: 0, pull: 1, engineOn: true, lightsOn: false, lightsManual: false, flashT: 0, lastHitT: -9, dip: 0, dipV: 0, odo: 0, squeal: 0, roll: 0, pitch: 0 });
    const st = GT.station && GT.station.state || G.stationState; if (st) { st.alarm = false; st.doorOpen = false; }
  }
  const stationState = () => (GT.station && GT.station.state) || G.stationState;
  function startRun() {
    resetRun();
    const hs = L.heroStart, hero = mkCar('hero', { x: hs.x, z: hs.z, h: hs.h, color: 0x6e1a18 }); G.hero = hero; setPlayerCar(hero); attachCockpit(hero);
    const s = L.station.store, door = anchor(['storeDoor', 'door'], { x: s.x0, z: s.doorZ }), din = anchor(['storeInside'], null), reg = anchor(['registerFront', 'counterFront'], { x: s.x0 + 5, z: s.doorZ - 7 });
    G.pt = { door: din ? [door.x, door.z] : [door.x - 1.1, door.z], doorIn: din ? [din.x, din.z] : [door.x + 1.6, door.z], reg: [reg.x, reg.z], safe: (a => [a.x, a.z])(anchor(['safe', 'backRoom', 'office'], { x: s.x1 - 2.5, z: s.z0 + 3 })),
      clerk: (a => [a.x, a.z, a.h])(anchor(['clerk', 'register', 'registerBack', 'clerkSpot', 'counterBack'], { x: reg.x + 2.6, z: reg.z, h: -PI / 2 })) };
    G.storeFloor = door.y !== undefined ? door.y : .14;
    const rx = -Math.cos(hs.h), rz = Math.sin(hs.h);
    G.partner = mkPed('partner', { x: hs.x + rx * 1.45, z: hs.z + rz * 1.45, h: Math.atan2(door.x - hs.x, door.z - hs.z), role: 'partner' });
    G.clerk = mkPed('clerk', { x: G.pt.clerk[0], z: G.pt.clerk[1], h: G.pt.clerk[2] !== undefined ? G.pt.clerk[2] : Math.atan2(reg.x - G.pt.clerk[0], reg.z - G.pt.clerk[1]), role: 'clerk' });
    // swap candidates in the motel lot (nose-in, so the rear-view mirror looks back across the lot at the highway)
    const kinds = ['sedan', 'pickup', 'compact'], cols = [0x7d8388, 0x2f3d4c, 0xa89878], pk = L.motel.parking, pick = [1, 3, 6];
    for (let i = 0; i < 3; i++) { const a = anchor('swapSpot' + i, null), fb = pk[pick[i] % pk.length], x = a ? a.x : fb[0], z = a ? a.z : fb[1], h = a && a.h !== undefined ? a.h : PI / 2;
      const c = mkCar(kinds[i], { x, z, h, color: cols[i], parked: true }); c.swap = true; G.swapCars.push(c); }
    // traffic
    const tk = ['sedan', 'compact', 'pickup', 'sedan', 'compact', 'sedan', 'pickup', 'compact'], tc = [0x8a8f93, 0xb7b2a4, 0x4b5560, 0x2b2e33, 0x7c6f5c, 0xc9c7c0, 0x6a2f2a, 0x39566b];
    const defs = [['loopA', .1], ['loopA', .58], ['loopB', .45], ['loopB', .86], ['loopC', .3], ['loopC', .8], ['loopD', .04], ['loopD', .64]];
    defs.forEach((d, i) => { const c = mkCar(tk[i], { color: tc[i], cruise: 11 + rnd() * 3.5 }); placeOnPath(c, PATHS[d[0]], PATHS[d[0]].len * d[1]); c.mode = 'traffic'; c.v = c.cruise; G.traffic.push(c); });
    // sidewalk pedestrians
    const sx = L.highway.width / 2 + L.sidewalk / 2;
    for (let i = 0; i < 4; i++) { const side = i % 2 ? 1 : -1, z0 = -120 + rnd() * 240, p = mkPed('ped', { x: side * sx + (rnd() - .5) * .8, z: z0, role: 'walker', seed: i }); p.dir = rnd() < .5 ? 1 : -1; p.home = p.x; pedWander(p); }
    G.contact = mkPed('ped', { x: EXIT.x + 4.6, z: EXIT.z - 5.5, h: 0, role: 'contact', seed: 5 });
    G.phase = 'wait'; G.phaseT = 0; G.result = null; emit('phase', { phase: 'wait' });
    say('start');
  }
  function pedWander(p) { const z1 = p.dir > 0 ? 150 : -150; pedGo(p, [[p.home, z1]], 1.25 + (p.z * 7 % 1) * .2, 'walk', q => { q.dir = -q.dir; pedWander(q); }); }
  function partnerDoorPos(out) { const rx = -Math.cos(P.h), rz = Math.sin(P.h); out[0] = P.x + rx * 1.4 + Math.sin(P.h) * .1; out[1] = P.z + rz * 1.4 + Math.cos(P.h) * .1; return out; }
  const inProgress = () => R.stage === 'approach' || R.stage === 'register' || R.stage === 'tosafe' || R.stage === 'safe';
  function partnerRunOut(why) {
    if (R.stage === 'runout' || R.stage === 'incar') return; const p = G.partner; R.stage = 'runout'; R.runT = R.t; R.runWhy = why;
    const pts = []; if (p.x > G.pt.doorIn[0] + .2 || Math.abs(p.z - G.pt.door[1]) > 1.5) { if (hyp(p.x - G.pt.safe[0], p.z - G.pt.safe[1]) < 4 || p.x > G.pt.reg[0] + 1) pts.push(G.pt.reg.slice(0, 2)); pts.push(G.pt.doorIn); }
    pts.push(G.pt.door); pts.push(partnerDoorPos([0, 0])); R.runPts = pts;
    pedGo(p, pts, 5.4, 'carry_run'); G.clerk.state = G.clerk.idle = 'crouch'; emit('runout', { why });
  }
  function tripAlarm(how) {
    if (R.alarm) return; R.alarm = true; R.alarmHow = how; R.plateSeen = true;
    if (how !== 'witness') { R.bell = true; const st = stationState(); if (st) st.alarm = true; R.pumpAlert = true; emit('alarm', { how }); say(how === 'patrol' ? 'copLook' : 'alarm', true); }
    else { emit('scanner', { evt: 'call' }); say('silentCall', true); }
    if (how === 'clerk') G.clerk.state = G.clerk.idle = 'phone';
    if (how !== 'witness' && inProgress()) partnerRunOut('alarm');
  }
  function waitStep(dt) {
    R.t += dt; const t = R.t, p = G.partner, st = stationState();
    if (R.doorT > 0) { R.doorT -= dt; if (st) st.doorOpen = R.doorT > 0; }
    const nearDoor = hyp(p.x - (G.pt.door[0] + G.pt.doorIn[0]) / 2, p.z - G.pt.door[1]) < 2.2; if (nearDoor && p.speed > 0) R.doorT = .9;
    // --- partner script
    if (R.stage === 'start' && t > 1.6) { R.stage = 'approach'; emit('sfx', { name: 'door_close' }); P.dipV += .5; pedGo(p, [G.pt.door, G.pt.doorIn, G.pt.reg], 2.1, 'walk', () => { R.stage = 'register'; R.regT = R.t; p.state = p.idle = 'aim'; p.h = Math.atan2(G.pt.clerk[0] - p.x, G.pt.clerk[1] - p.z); G.clerk.state = G.clerk.idle = 'handsup'; say('inside'); }); }
    if (R.stage === 'register') { R.take = Math.min(1850, Math.round((t - R.regT) * 132 / 10) * 10); if (t - R.regT > 14.5) { R.stage = 'tosafe'; say('toSafe'); p.idle = 'idle'; pedGo(p, [G.pt.safe], 2.6, 'walk', () => { R.stage = 'safe'; R.safeT = R.t; p.state = p.idle = 'crouch'; }); } }
    if (R.stage === 'safe') { const n = Math.floor((t - R.safeT) / 10); if (n > R.safeN && R.safeN < 3) { R.safeN++; R.take += [4200, 5600, 7400][R.safeN - 1]; emit('sfx', { name: 'cash' }); say('safe' + R.safeN); if (R.safeN === 3) partnerRunOut('done'); } }
    // --- signals from the driver
    if (R.signalT >= 0 && inProgress()) { R.signalT -= dt; if (R.signalT < 0) { say(R.signalKind === 'honk' ? 'honk' : 'flash'); partnerRunOut(R.signalKind); } }
    // --- clerk nerve -> alarm
    if (R.stage === 'register' || R.stage === 'tosafe' || R.stage === 'safe') { R.nerve += dt * R.nRate * (R.stage === 'register' ? .0095 : .0225); if (R.nerve > .72 && !R.nerveWarned) { R.nerveWarned = true; say('nerve'); } if (R.nerve >= 1) tripAlarm('clerk'); }
    // --- store camera: creeping right up to the door puts the plate on tape
    if (inProgress() && Math.abs(P.z - G.pt.door[1]) < 2.4 && P.x > G.pt.door[0] - 4.6 && hyp(P.x - L.heroStart.x, P.z - L.heroStart.z) > 1.2) { if (!R.doorCam) { R.doorCam = true; R.plateSeen = true; } }
    // --- witness car to the pumps
    if (!R.witnessCar && t > .4) { const c = mkCar('compact', { color: 0x9aa7ad, cruise: 11 }); placeOnPath(c, PATHS.witnessIn, 0); c.v = 11; c.mode = 'scripted'; c.stopAtEnd = true; R.witnessCar = c; }
    if (R.witnessCar && !R.pumpGuy && R.witnessCar.s > PATHS.witnessIn.len - 1.6 && Math.abs(R.witnessCar.v) < .3) { const c = R.witnessCar; c.parked = true; c.mode = 'idle'; const rx = -Math.cos(c.h), rz = Math.sin(c.h), bk = c.dims.L / 2 - .5;
      R.pumpGuy = mkPed('ped', { x: c.x + rx * (c.dims.W / 2 + .32) - Math.sin(c.h) * bk, z: c.z + rz * (c.dims.W / 2 + .32) - Math.cos(c.h) * bk, h: c.h + PI / 2, role: 'pump', seed: 2 }); R.pumpGuy.witness = true; emit('sfx', { name: 'door_close', g: .4 }); say('witnessCar'); }
    // --- a customer walks along the store front to the door
    if (!R.walker && t > 36) { const wx = G.pt.door[0] + .32; R.walker = mkPed('ped', { x: wx, z: L.station.z1 - 2, h: PI, role: 'customer', seed: 4 }); R.walker.witness = true; R.walkerSaid = false;
      pedGo(R.walker, [[wx, G.pt.door[1] + 4.6], [wx - .45, G.pt.door[1] + 2.4], [G.pt.door[0] + .2, G.pt.door[1] + .5], G.pt.doorIn], 1.38, 'walk', q => { if (inProgress()) { R.walkerSaw = true; R.faceSeen = true; R.carSeen = true; q.state = 'crouch'; q.react = 1.2; q.idle = 'phone'; pedGo(q, [G.pt.door, [G.pt.door[0] - .3, L.station.z1 - 6]], 4.4, 'run'); tripAlarm('witness'); } else q.idle = 'idle'; }); }
    if (R.walker && !R.walkerSaid && R.walker.z < L.heroStart.z + 16) { R.walkerSaid = true; say('walker'); }
    // --- the patrol unit: one pass on the highway, then it pulls in behind you
    if (R.patrolStage === 0 && t > 6) { R.patrolStage = 1; emit('scanner', { evt: 'unit' }); say('patrol1'); const lp = PATHS.loopB;
      R.patrol = spawnCopAt(lp, pathNearest(lp, 3, L.heroStart.z) - 12.5 * (25 - t), 'scripted'); R.patrol.v = R.patrol.cruise = 12.5; }                 // rolls past on the highway at t = 25 s, then keeps circling
    if (R.patrolStage === 1 && t > 34.5) { R.patrolStage = 2; emit('scanner', { evt: 'unit' }); say('patrol2'); }
    if (R.patrolStage === 2 && t > 36) { R.patrolStage = 5; const c = R.visitor = spawnCopAt(PATHS.patrolIn, 0, 'scripted'); c.v = c.cruise = 16; c.stopAtEnd = true; }
    if (R.patrolStage === 5) { const c = R.visitor; c.cruise = c.s > PATHS.patrolIn.len - 75 ? 7.5 : 16; if (!R.mirrorSaid && c.s > PATHS.patrolIn.len - 46) { R.mirrorSaid = true; say('patrolSeen'); emit('mirror', {}); }
      if (c.s > PATHS.patrolIn.len - 2 && Math.abs(c.v) < .3) { R.patrolStopT += dt; if (R.patrolStopT > 3.5 && inProgress()) { R.carSeen = true; R.plateSeen = true; tripAlarm('patrol'); } } }
    // an officer notices a masked man sprinting out with a bag
    if (R.stage === 'runout' && !R.copSaw && p.x < G.pt.door[0] + .5) for (const c of G.cops) { const d = hyp(c.x - p.x, c.z - p.z); if (d < 48 && los(c.x, c.z, p.x, p.z)) { R.copSaw = true; R.carSeen = true; R.plateSeen = true; c.cop.alerted = true; emit('scanner', { evt: 'call' }); say('copLook', true); break; } }
    // --- who notices the car / the face
    if (R.honked && t - R.honkT < 8) R.pumpAlert = true;
    if (R.stage === 'runout') {
      const w = R.runPts, last = w[w.length - 1]; partnerDoorPos(last);
      if (R.walker && !R.walkerSaw && hyp(R.walker.x - p.x, R.walker.z - p.z) < 6.5) { R.walkerSaw = true; R.faceSeen = true; R.carSeen = true; const q = R.walker; q.state = 'crouch'; q.react = 1.4; q.idle = 'phone'; pedGo(q, [[q.x, L.station.z1 - 4]], 4.2, 'run'); }
      const d = hyp(p.x - last[0], p.z - last[1]);
      if (!p.wp || d < 1.25) { if (Math.abs(P.vx) < 2.2 && d < 2.2) partnerGetIn(); else if (!p.wp) pedGo(p, [last], 5.4, 'carry_run'); }
    }
    if (R.pumpGuy && R.pumpAlert && !R.pumpGuy.saw) { R.pumpGuy.saw = true; R.pumpGuy.state = R.pumpGuy.idle = 'wave'; R.pumpGuy.h = Math.atan2(P.x - R.pumpGuy.x, P.z - R.pumpGuy.z); }
    // --- abandoning him
    if (hyp(P.x - L.heroStart.x, P.z - L.heroStart.z) > 75) { say('abandon', true); endRun('abandon'); }
  }
  function signal(kind) {
    if (G.phase !== 'wait') return;
    if (kind === 'honk') { R.honked = true; R.honkT = R.t; if (inProgress()) { R.nerve += .1; if (R.signalT < 0) { R.signalT = .7; R.signalKind = 'honk'; } } }
    else if (kind === 'flash') { R.flashT = R.t; if (R.stage === 'register') { if (R.signalT < 0) { R.signalT = 1.6; R.signalKind = 'flash'; } } else if (inProgress() && R.stage !== 'approach') say('flashMiss'); }
  }
  function partnerGetIn() {
    const p = G.partner; R.stage = 'incar'; p.wp = null; p.seat = { car: P.car, x: -.43, y: -.03, z: -.42 }; p.state = p.idle = 'sit'; p.speed = 0;
    emit('sfx', { name: 'door_close' }); P.dipV += .9; emit('getin', {});
    const pg = R.pumpGuy; if (pg && R.pumpAlert) R.carSeen = true;
    if (R.bell) { R.carSeen = R.carSeen || !!pg; R.plateSeen = true; }
    if (R.nerve > .78) R.faceSeen = true;
    const C = W.chips; C.face.on = R.faceSeen; C.car.on = R.carSeen; C.plate.on = R.plateSeen && R.carSeen;
    G.phase = 'heat'; G.phaseT = 0; emit('phase', { phase: 'heat' });
    const hotStart = R.bell || R.copSaw || (R.visitor && R.alarm);
    say(hotStart ? 'getInHot' : 'getInCalm', true);
    if (R.alarm || R.copSaw) { W.callT = .1; W.stars = R.bell || R.copSaw ? 2 : 1; } else W.callT = 7 + (1 - R.nerve) * 7;
    for (const c of G.cops) { c.hold = false; c.stopAtEnd = false; c.cop.state = 'patrol'; if (!c.path || !c.path.closed) setPath(c, PATHS.loopB); if (R.alarm || R.copSaw) { c.cop.alerted = true; c.cop.state = 'respond'; } }
    for (const q of G.peds) if (q.role === 'customer' && !R.walkerSaw) q.idle = 'idle';
  }

  /* ================================================================== wanted system + police */
  function spawnCopAt(path, s, state) {
    const c = mkCar('cruiser', { color: 0xe9e9e4 }); placeOnPath(c, path, s); c.mode = 'cop'; c.cop = { state: state || 'respond', sees: false, d: 999, navT: 0, navEnd: 0, side: G.cops.length % 2 ? 1 : -1, loop: G.cops.length % 2 ? 'loopA' : 'loopB', searchT: 0, alerted: false, cone: 0, idx: G.cops.length };
    G.cops.push(c); return c;
  }
  function spawnCopFar() {
    const cands = []; for (const lp of [PATHS.loopA, PATHS.loopB]) for (let k = 0; k < 14; k++) { const q = pathAt(lp, lp.len * (k + .37) / 14, {}); cands.push([lp, q.x, q.z]); }
    let best = null, bs = -1e9;
    for (const c of cands) { const dP = hyp(c[1] - P.x, c[2] - P.z); if (dP < 105) continue; const vis = los(c[1], c[2], P.x, P.z); if (vis && dP < 190) continue;
      let crowd = 0; for (const o of G.cars) if (hyp(o.x - c[1], o.z - c[2]) < 14) crowd = 1; if (crowd) continue;
      const sc = -hyp(c[1] - W.lastKnown.x, c[2] - W.lastKnown.z) - (vis ? 80 : 0) + rnd() * 40; if (sc > bs) { bs = sc; best = c; } }
    if (!best) return null;
    const c = mkCar('cruiser', { color: 0xe9e9e4 }); c.x = best[1]; c.z = best[2]; c.path = best[0]; c.s = pathNearest(best[0], c.x, c.z); c.h = pathAt(best[0], c.s, _q1).h; c.v = 14; c.mode = 'cop';
    c.cop = { state: W.hot ? 'pursue' : 'respond', sees: false, d: 999, navT: 0, navEnd: 0, side: G.cops.length % 2 ? 1 : -1, loop: G.cops.length % 2 ? 'loopA' : 'loopB', searchT: 0, alerted: true, cone: 0, idx: G.cops.length };
    G.cops.push(c); emit('scanner', { evt: 'unit' }); return c;
  }
  function dispatchCall() {
    W.called = true; W.stars = Math.max(W.stars, 1); W.searchT = 0; W.lastKnown = { x: L.heroStart.x, z: L.heroStart.z };
    emit('scanner', { evt: 'call' }); say('call'); say(W.chips.car.on ? 'callCar' : 'callNoCar');
    for (const c of G.cops) { c.cop.alerted = true; if (c.cop.state === 'patrol' || c.cop.state === 'scripted') c.cop.state = 'respond'; }
  }
  function addStars(n) { const b = Math.floor(W.stars + 1e-6); W.stars = clamp(W.stars + n, 0, 6); if (Math.floor(W.stars + 1e-6) > b) emit('star', { stars: Math.floor(W.stars) }); W.peak = Math.max(W.peak, W.stars); }
  const matchRange = () => { const c = W.chips; let r = 0; if (c.car.on && c.car.valid) r = 78; if (c.plate.on && c.plate.valid) r = Math.max(r, 26); return r; };
  function wantedStep(dt) {
    if (!W.called && W.callT >= 0) { W.callT -= dt; if (W.callT <= 0) dispatchCall(); }
    W.visT -= dt; const sp = hyp(P.vx, P.vy), night = (GT.env && GT.env.night) || 0;
    if (W.visT <= 0) { const iv = .12; W.visT = iv; let recog = false, att = 0, idA = 0, nearest = 999; W.seenBy = 0; const mr = matchRange();
      for (const c of G.cops) { const K = c.cop, dx = P.x - c.x, dz = P.z - c.z, d = hyp(dx, dz); K.d = d; if (d < nearest) nearest = d;
        const ang = Math.abs(angDiff(c.h, Math.atan2(dx, dz))); K.sees = d < 130 && (d < 30 || ang < 1.15) && los(c.x, c.z, P.x, P.z);
        K.cone += ((K.sees ? 1 : 0) - K.cone) * .4; if (!K.sees) continue; W.seenBy++;
        if (W.hot) { if (d < 100) recog = true; continue; }
        if ((W.called || K.alerted) && d < mr) idA = Math.max(idA, .3 + 2.3 * (1 - d / mr));          // a description match takes a moment to register: quick up close, slow at range
        if (W.called || K.alerted || W.stars > 0) { if (sp > 21 && d < 75) att += 1; if (G.time - P.lastHitT < 1.2 && d < 75) att += 3; if (P.squeal > .55 && d < 50) att += .9; if (night > .7 && !P.lightsOn && sp > 3 && d < 45) att += .35;
          if (W.chips.face.on && d < 7.5 && sp < 9) att += .75; if (G.phase === 'swap' && G.time - HW.flash < .6 && d < 60) att += 5; }
        if (G.phase === 'heat' && G.phaseT < 6 && (R.bell || R.copSaw) && d < 90) recog = true; }
      W.nearest = nearest;
      for (const p of G.peds) if (p.phoneT > 0) { p.phoneT -= iv; if (p.phoneT <= 0 && W.called) { W.chips.car.on = true; W.chips.car.valid = true; W.stars = Math.max(W.stars, 1); W.searchT = 0; W.lastKnown = { x: p.x, z: p.z }; say('cleanFlag'); } }
      if (att > 0) W.susp = Math.min(1.2, W.susp + att * iv / 1.5); else W.susp = Math.max(0, W.susp - iv * .3);
      if (idA > 0 && !W.hot) { W.idT = Math.min(1.2, W.idT + idA * iv / 1.5); if (W.idT >= 1) { recog = true; W.idT = 0; } } else W.idT = Math.max(0, W.idT - iv * .5);
      if (W.susp >= 1 && !W.hot) { W.susp = 0; const C = W.chips; C.car.on = true; C.car.valid = true; C.plate.on = true; C.plate.valid = true; recog = true; if (W.swapped) say('cleanFlag'); if (!W.called) { W.called = true; W.callT = -1; } }
      if (recog) { if (!W.hot) { W.hot = true; addStars(W.stars < 2 ? 2 - W.stars : .5); emit('spotted', {}); say('spotted', true); W.exitOpen = false; } W.lastSeenT = G.time; W.lastKnown = { x: P.x, z: P.z }; }
    }
    if (W.hot) { W.hotTime += dt; if (G.time - W.lastSeenT < 1) addStars(dt / 30); if (G.time - W.lastSeenT > 5.5) { W.hot = false; W.searchT = 0; emit('lost', {}); say('lost'); for (const c of G.cops) if (c.cop.state === 'pursue') { c.cop.state = 'respond'; c.cop.navT = 0; } } }
    else if (W.stars > 0) { W.searchT += dt; const C = W.chips, floor = (C.car.on && C.car.valid) || (C.plate.on && C.plate.valid) ? 1 : 0;
      if (W.searchT > 12) W.stars = Math.max(floor, W.stars - dt / 11);
      if (W.stars <= 0) { W.stars = 0; emit('clear', {}); emit('scanner', { evt: 'clear' }); for (const c of G.cops) c.cop.state = 'patrol'; } }
    W.peak = Math.max(W.peak, W.stars);
    // objective hints
    const C = W.chips, valid = (C.car.on && C.car.valid) || (C.plate.on && C.plate.valid);
    if (W.called && !W.hot && !W.swapped && !W.needSaid && G.phase === 'heat' && G.phaseT > 4) { W.needSaid = true; say(valid ? 'needSwap' : 'lowKey'); }
    const open = W.called && !W.hot && W.stars === 0 && !valid; if (open && !W.exitOpen) { W.exitOpen = true; if (!W.exitSaid) { W.exitSaid = true; say('exitOpen'); } emit('exit', {}); } if (!open) W.exitOpen = false;
    if (!W.hot && W.swapped && W.nearest < 22 && W.seenBy && G.time - W.nearSaid > 14) { W.nearSaid = G.time; say('cleanNear'); }
    // busted: stopped with a cruiser beside you while they know it is you
    let close = false; if (W.hot && sp < 2) for (const c of G.cops) if (c.cop.d < 8.5 && Math.abs(c.v) < 3) close = true;
    if (close) { if (W.bustT === 0) say('bustWarn'); W.bustT += dt; if (W.bustT > 3.2) { say('busted', true); endRun('busted'); } } else W.bustT = Math.max(0, W.bustT - dt * 1.5);
    if (P.damage >= 1 && P.engineOn) { P.engineOn = false; say('engineDead'); }
  }
  function navTo(c, tx, tz, vT, dt) {
    const K = c.cop, d = hyp(tx - c.x, tz - c.z);
    if (d < 36 && los(c.x, c.z, tx, tz, .5)) { aiDrive(c, tx, tz, Math.min(vT, 3 + d * .55), dt); return d < 8; }
    K.navT -= dt;
    if (K.navT <= 0 || !c.path) { K.navT = 1.6; let best = null, bc = 1e9, bsc = 0, bst = 0;
      for (const nm of ['loopA', 'loopB']) { const p = PATHS[nm], sc = pathNearest(p, c.x, c.z), dc = pathNearest.dist, hd = Math.abs(angDiff(c.h, pathAt(p, sc, _q1).h)), stt = pathNearest(p, tx, tz), dtg = pathNearest.dist;
        const cost = ((stt - sc + p.len) % p.len) + dc * 2.5 + dtg + hd * 14 - (c.path === p ? 20 : 0); if (cost < bc) { bc = cost; best = p; bsc = sc; bst = stt; } }
      if (c.path !== best) { c.path = best; c.s = bsc; } K.navEnd = bst; }
    const rem = (K.navEnd - c.s + c.path.len) % c.path.len;
    if (rem < 7 || rem > c.path.len - 4) { aiDrive(c, tx, tz, Math.min(vT, 8), dt); return d < 9; }
    followPath(c, Math.min(vT, 6 + rem * .5), dt, true); return false;
  }
  function copStep(c, dt) {
    const K = c.cop, night = (GT.env && GT.env.night) || 0; let vWant = 0;
    c.lights.siren = K.state === 'pursue' || K.state === 'respond' || K.state === 'block' || (K.state === 'search' && W.stars >= 2);
    c.lights.head = night > .3 || c.lights.siren;
    if (K.state === 'scripted') { if (c.hold) { c.v = 0; return; } followPath(c, c.cruise, dt); c.lights.brake = c.brakeOn; return; }
    if (K.state !== 'block' && K.state !== 'scripted') { if (W.hot) K.state = 'pursue'; else if (K.state === 'pursue') K.state = 'respond'; }
    if (K.state === 'patrol') { if (!c.path || !c.path.closed) setPath(c, PATHS[K.loop]); followPath(c, 11.5, dt); vWant = 11; }
    else if (K.state === 'respond') { vWant = 27; if (navTo(c, W.lastKnown.x, W.lastKnown.z, 27, dt)) { K.state = 'search'; K.searchT = 0; setPath(c, PATHS[K.loop]); } }
    else if (K.state === 'search') { K.searchT += dt; if (!c.path || !c.path.closed) setPath(c, PATHS[K.loop]); vWant = 12; followPath(c, 12.5, dt); if (W.stars <= 0) K.state = 'patrol'; }
    else if (K.state === 'block') { c.v *= Math.exp(-5 * dt); coast(c, dt); if (!W.hot && G.time - W.lastSeenT > 12) { K.state = 'search'; setPath(c, PATHS[K.loop]); } }
    else if (K.state === 'pursue') {
      const d = hyp(P.x - c.x, P.z - c.z), direct = K.sees || (d < 45 && los(c.x, c.z, P.x, P.z, .5)); K.pitT = (K.pitT || 0) - dt;
      if (direct) { getWv(); const psp = Math.max(0, P.vx), s = Math.sin(P.h), co = Math.cos(P.h), rel = (c.x - P.x) * s + (c.z - P.z) * co; let tx, tz, vT;
        if (psp < 3) { const a = K.idx * 2.1 + 1; tx = P.x + Math.sin(P.h + a) * 5.6; tz = P.z + Math.cos(P.h + a) * 5.6; const dd = hyp(tx - c.x, tz - c.z); vT = dd > 2 && d > 5.2 ? Math.min(9, 2 + dd) : 0; if (d < 6.5) vT = 0; }   // box in
        else if (d > 34) { const lead = clamp(d / 30, 0, 1.2); tx = P.x + _wv.x * lead; tz = P.z + _wv.z * lead; vT = Math.min(35 + W.stars * 1.5, psp + 11); }               // close the distance
        else if (K.pitT > 0 && psp > 9) { tx = P.x - s * 1.3 + co * K.side * 1.15; tz = P.z - co * 1.3 - s * K.side * 1.15; vT = psp + 5; }                                // PIT: lean on a rear quarter
        else if (rel > -3) { tx = P.x + s * 9 + co * K.side * 3.2; tz = P.z + co * 9 - s * K.side * 3.2; vT = Math.max(4, psp - 2.5); }                                   // got ahead: ease in front and slow
        else { const back = 8.5 + (K.idx % 3) * 5.5, lat = K.idx % 3 ? K.side * 2.4 : 0; tx = P.x - s * back + co * lat; tz = P.z - co * back - s * lat;                // hold a slot on the tail
          vT = psp + clamp((hyp(tx - c.x, tz - c.z) - 1.5) * .7, -3, 7);
          if (K.pitT < -(K.pitCd || 4) && W.stars >= 3 && d < 19 && psp > 10) { K.pitT = 2.4; K.pitCd = 5 + rnd() * 5; } }
        vWant = vT; aiDrive(c, tx, tz, vT, dt); }
      else { vWant = 28; navTo(c, W.lastKnown.x, W.lastKnown.z, 30, dt); }
    }
    if (K.state !== 'patrol' && K.state !== 'search' && K.state !== 'block') { aiCollideWorld(c);
      if (Math.abs(c.v) < 1.2 && vWant > 3 && c.revT <= 0) { c.stuckT += dt; if (c.stuckT > 1.5) { c.revT = 1.3; c.stuckT = 0; } } else c.stuckT = 0; }
    c.lights.brake = c.brakeOn; c.lights.reverse = c.revT > 0;
  }
  function tryRoadblock() {
    let lp = null, bh = 9; for (const nm of ['loopA', 'loopB']) { const p = PATHS[nm], s = pathNearest(p, P.x, P.z), hd = Math.abs(angDiff(P.h, pathAt(p, s, _q1).h)) + pathNearest.dist * .02; if (hd < bh) { bh = hd; lp = p; lp._s = s; } }
    if (!lp) return false; const bx = L.backRoad.x, corners = [[0, L.crossS.z], [0, L.crossN.z], [bx, L.crossN.z], [bx, L.crossS.z]]; let best = null, bd = 1e9;
    for (const k of corners) { const sc = pathNearest(lp, k[0], k[1]), f = (sc - lp._s + lp.len) % lp.len; if (f > 120 && f < 380 && f < bd) { bd = f; best = sc; } }
    if (best === null) return false; const q = pathAt(lp, best - 26, {}); if (hyp(q.x - P.x, q.z - P.z) < 150 && los(q.x, q.z, P.x, P.z)) return false;
    const lx = Math.cos(q.h), lz = -Math.sin(q.h);
    for (const k of [-1, 1]) { const c = mkCar('cruiser', { color: 0xe9e9e4 }); c.x = q.x + lx * (k * 2.5 + 1.2); c.z = q.z + lz * (k * 2.5 + 1.2); c.h = q.h + PI / 2 + k * .25; c.mode = 'cop'; c.path = lp; c.s = best - 26;
      c.cop = { state: 'block', sees: false, d: 999, navT: 0, navEnd: 0, side: k, loop: lp === PATHS.loopA ? 'loopA' : 'loopB', searchT: 0, alerted: true, cone: 0, idx: G.cops.length }; G.cops.push(c); }
    emit('scanner', { evt: 'unit' }); say('stars4'); return true;
  }
  function policeStep(dt) {
    W.spawnT -= dt;
    const want = !W.called ? G.cops.length : (W.hot ? clamp(1 + Math.floor(W.stars), 2, 5) : (W.stars > 0 ? clamp(Math.ceil(W.stars) + 1, 2, 4) : 2));
    if (G.cops.length < want && W.spawnT <= 0) { if (spawnCopFar()) W.spawnT = W.hot ? 4 : 6; else W.spawnT = 1.5; }
    if (W.hot && W.stars >= 4 && G.time > W.blockT && G.cops.length < 7) { if (tryRoadblock()) W.blockT = G.time + 50; else W.blockT = G.time + 4; }
    if (!W.hot && G.cops.length > want + 1 && W.spawnT <= 0) { for (const c of G.cops) if (c.cop.d > 190 && c.cop.state !== 'scripted') { removeCar(c); W.spawnT = 3; break; } }
    for (const c of G.cops) copStep(c, dt);
  }

  /* ================================================================== traffic + bystanders */
  function trafficStep(dt) {
    let sirenNear = null; for (const c of G.cops) if (c.lights.siren) sirenNear = sirenNear || c;
    for (const c of G.traffic) { let vT = c.cruise; if (sirenNear) for (const k of G.cops) if (k.lights.siren && hyp(k.x - c.x, k.z - c.z) < 45) vT = Math.min(vT, 3.5);
      followPath(c, vT, dt); c.lights.brake = c.brakeOn; c.lights.head = ((GT.env && GT.env.night) || 0) > .3;
      if (!c.path.closed && c.s >= c.path.len - 3) { if (hyp(c.x - P.x, c.z - P.z) > 120) { placeOnPath(c, c.path, 0); c.v = c.cruise; } else c.s = c.path.len - 3; } }
    for (const c of G.cars) { if (c.mode === 'scripted' && !c.isCop) { const end = followPath(c, c.cruise, dt); c.lights.brake = c.brakeOn; } else if (c.mode === 'idle' || c.parked) { if (c !== P.car) coast(c, dt); } }
    separateCars();
  }
  function pedsStep(dt) {
    const sp = hyp(P.vx, P.vy), crash = G.time - P.lastHitT < .3;
    for (const p of G.peds) { pedStep(p, dt); if (p.seat || p === G.partner || p === G.clerk) continue;
      if (p.role === 'contact') { const near = W.exitOpen && hyp(p.x - P.x, p.z - P.z) < 55; p.state = near ? 'wave' : 'idle'; if (near) p.h = Math.atan2(P.x - p.x, P.z - p.z); continue; }
      const dx = p.x - P.x, dz = p.z - P.z, d = hyp(dx, dz);
      if (d < 3.2 && sp > 2) { const lx = Math.cos(P.h), lz = -Math.sin(P.h), side = (dx * lx + dz * lz) >= 0 ? 1 : -1; p.x += lx * side * 4.5 * dt; p.z += lz * side * 4.5 * dt; if (p.react <= 0) { p.state = 'crouch'; p.react = 1.2; } }
      const scare = (d < 10 && sp > 17) || (crash && d < 28) || (R.bell && d < 30 && G.phase !== 'wait' && G.phaseT < 3);
      if (scare && p.react <= 0 && p.role !== 'pump') { p.state = d < 6 ? 'crouch' : 'wave'; p.react = 2.5; p.h = Math.atan2(-dx, -dz);
        if (W.swapped && W.called && !p.phoneT && d < 16 && (sp > 21 || crash)) { p.phoneT = 4.5; p.state = 'phone'; p.react = 5; say('pedPhone'); } }
    }
  }

  /* ================================================================== swap + hot-wire */
  function nearestSwap() { let best = null, bd = 7.8; for (const c of G.swapCars) { if (c === P.car || c.used) continue; const d = hyp(c.x - P.x, c.z - P.z); if (d < bd) { bd = d; best = c; } } return best; }
  function swapStep(dt, holdF) {
    if (G.phase !== 'heat') return; const c = hyp(P.vx, P.vy) < 1.4 ? nearestSwap() : null; HW.target = c;
    if (c && !HW.nearSaid) { HW.nearSaid = true; say('swapNear'); }
    if (c && holdF) { HW.hold += dt; if (HW.hold > .85) beginSwap(c); } else HW.hold = Math.max(0, HW.hold - dt * 2);
  }
  function beginSwap(c) {
    const old = P.car; let seen = false; for (const k of G.cops) if (k.cop.sees && k.cop.d < 70) seen = true;
    old.parked = true; old.mode = 'idle'; old.v = 0; old.lights.head = old.lights.brake = false; old.used = true; c.used = true;
    setPlayerCar(c); attachCockpit(c); if (G.partner.seat) G.partner.seat.car = c; G.partner.state = G.partner.idle = 'crouch';
    P.engineOn = false; P.lightsOn = false; HW.stage = 0; HW.p = 0; HW.dir = 1; HW.hold = 0; HW.zones = [.3 + rnd() * .4, .25 + rnd() * .5, .2 + rnd() * .6]; HW.seen = seen; HW.target = null;
    G.phase = 'swap'; G.phaseT = 0; emit('phase', { phase: 'swap' }); emit('sfx', { name: 'door_open' }); emit('fade', {}); say(seen ? 'swapSeen' : 'swapStart', true);
    P.dipV += .8;
  }
  const hwWidth = () => .2 - HW.stage * .035;
  function hotwirePress() {
    if (G.phase !== 'swap' || G.phaseT < .5) return; HW.flash = G.time;
    if (Math.abs(HW.p - HW.zones[HW.stage]) < hwWidth() / 2) { HW.stage++; emit('sfx', { name: 'ui_ok' }); emit('spark', { ok: true });
      if (HW.stage >= 3) { P.engineOn = true; emit('sfx', { name: 'ignition' }); const C = W.chips; if (!HW.seen) { C.car.valid = false; C.plate.valid = false; } W.swapped = true; W.susp = 0; if (G.partner.seat) { G.partner.seat.y = -.34; G.partner.seat.z = -.3; } G.phase = 'clean'; G.phaseT = 0; emit('phase', { phase: 'clean' }); say('swapDone', true); }
      else say('hwOk'); }
    else { HW.stage = Math.max(0, HW.stage - 1); emit('sfx', { name: 'ui_bad' }); emit('spark', { ok: false }); say('hwFail'); }
  }
  function hotwireStep(dt) {
    const sp = .85 + HW.stage * .22; HW.p += HW.dir * sp * dt; if (HW.p > 1) { HW.p = 2 - HW.p; HW.dir = -1; } if (HW.p < 0) { HW.p = -HW.p; HW.dir = 1; }
    let near = false; for (const k of G.cops) if (k.cop.sees && k.cop.d < 60) near = true; HW.danger = near; if (near && G.time - HW.waitSaid > 9) { HW.waitSaid = G.time; say('hwWait'); }
  }

  /* ================================================================== end of run */
  const EXIT = { x: 3.5, z: L.crossS.z - 9.5 };   // the highway dead-ends at a road closure south of the last junction: the hand-over point
  function endRun(result) {
    if (G.phase === 'end') return; const take = result === 'clean' ? R.take : 0, peak = Math.round(W.peak);
    let score = R.take / 1000 - W.peak * 1.3 - G.time / 150, rank = 'C', title = '侥幸';
    if (result === 'clean') { if (score >= 12) { rank = 'S'; title = '幽灵'; } else if (score >= 6.5) { rank = 'A'; title = '老手'; } else if (score >= 2.5) { rank = 'B'; title = '还行'; } }
    else { rank = '—'; title = result === 'busted' ? '落网' : '叛徒'; }
    G.result = { result, take, lost: R.take - take, peak, time: G.time, rank, title, damage: P.damage, swapped: W.swapped, chips: JSON.parse(JSON.stringify(W.chips)) };
    G.phase = 'end'; G.phaseT = 0; emit('phase', { phase: 'end', result });
  }
  function crashHeat(d) {
    if (d.what === 'cop') { if (G.time - W.crashT > 4) { W.crashT = G.time; if (W.called || W.stars > 0) addStars(.35); if (!W.hot && d.obj && d.obj.cop) { W.susp = 1; d.obj.cop.alerted = true; } if (d.vn > 5) say('crashCop'); } }
    else if (d.vn > 5) { if (G.time - W.crashT > 1.5) { W.crashT = G.time; if (W.hot) addStars(.25); if (rnd() < .6) say('crash'); } }
    if (G.phase === 'wait' && d.vn > 3) { R.pumpAlert = true; R.nerve += .05; }
  }

  /* ================================================================== cockpit + camera */
  function attachCockpit(c) {
    if (!G.visual) return;
    if (!G.cockpit) { let ck = null; if (GT.cockpit && GT.cockpit.build) ck = safe('cockpit.build', () => GT.cockpit.build(), null); if (!ck || !ck.group) ck = fbCockpit(c.dims);
      const e = ck.eye; ck.eye = e ? (Array.isArray(e) ? new T.Vector3(e[0], e[1], e[2]) : new T.Vector3(e.x, e.y, e.z)) : new T.Vector3(.37, 1.08, -.3); if (!ck.update) ck.update = () => {}; G.cockpit = ck; }
    const ck = G.cockpit; if (ck.group.parent) ck.group.parent.remove(ck.group); c.veh.group.add(ck.group);
    if (c.kind === 'hero') ck.group.position.set(0, 0, 0); else ck.group.position.copy(c.dims.eye).sub(ck.eye);
    G.eyeLocal = ck.group.position.clone().add(ck.eye);
  }
  const CAM = { mode: 'fp', yaw: 0, pitch: 0, yawT: 0, pitchT: 0, idle: 0, fov: 60, head: new T.Vector3(), cpos: new T.Vector3(), ch: 0, init: false, locked: false, back: 0, titleA: 0, fixedLook: false };
  const _v1 = new T.Vector3(), _v2 = new T.Vector3(), _qa = new T.Quaternion(), _qb = new T.Quaternion(), _eu = new T.Euler(0, 0, 0, 'YXZ');
  function cameraStep(dt) {
    const cam = G.camera, c = P.car; if (!c || !c.root) return; const sp = hyp(P.vx, P.vy), ck = G.cockpit;
    c.root.updateMatrixWorld(true);
    const st = ST(); if (st && st.cine) { if (ck) ck.group.visible = false; const m = GT.render && GT.render.mirror; if (m) m.enabled = false; st.camera(cam, dt); return; }
    const k = 1 - Math.exp(-dt * 13); CAM.idle += dt;
    if (!CAM.fixedLook && CAM.idle > 3 && sp > 6 && G.started) { CAM.yawT += -CAM.yawT * Math.min(1, dt * .7); CAM.pitchT += ((CAM.mode === 'fp' ? -.05 : 0) - CAM.pitchT) * Math.min(1, dt * .7); }
    CAM.back += ((G.input.lookBack ? 1 : 0) - CAM.back) * Math.min(1, dt * 9);
    const yawGoal = lerp(CAM.yawT + (CAM.mode === 'fp' ? P.steer * .16 * sstep(sp, 3, 20) : 0), -2.62, CAM.back);
    CAM.yaw += (yawGoal - CAM.yaw) * k; CAM.pitch += (lerp(CAM.pitchT, -.05, CAM.back) - CAM.pitch) * k;
    const mode = !G.started && !G.auto ? 'title' : CAM.mode; if (ck) ck.group.visible = mode === 'fp';
    let fovT = 60;
    if (mode === 'title') {
      CAM.titleA += dt * .035; const a = CAM.titleA, hx = c.x, hz = c.z;
      cam.position.set(hx - 4.1 - Math.sin(a) * .9, .8 + Math.sin(a * .7) * .06, hz - 7.2 + Math.cos(a) * .7); cam.lookAt(hx + 2.5, 1.0, hz + .6); fovT = 38;
    } else if (mode === 'fp') {
      // head: pushed back under power, out of the corner, a little road bob; clamped so it never leaves the seat
      const tx = clamp(-P.ayS * .0042, -.055, .055), tz = clamp(-P.axS * .0052, -.06, .05), ty = P.bob + clamp(P.dip * .5, -.03, .03);
      CAM.head.x += (tx - CAM.head.x) * Math.min(1, dt * 5); CAM.head.z += (tz - CAM.head.z) * Math.min(1, dt * 5); CAM.head.y += (ty - CAM.head.y) * Math.min(1, dt * 14);
      _v1.copy(G.eyeLocal).add(CAM.head); if (CAM.back > .01) { _v1.x -= .1 * CAM.back; _v1.z -= .04 * CAM.back; }
      cam.position.copy(_v1).applyMatrix4(c.veh.group.matrixWorld);
      c.veh.group.getWorldQuaternion(_qa); _eu.set(CAM.pitch, PI + CAM.yaw, clamp(P.ayS * -.0012, -.02, .02), 'YXZ'); cam.quaternion.copy(_qa).multiply(_qb.setFromEuler(_eu));
      fovT = 60 + 9 * sstep(sp, 12, 46) - 5 * (1 - G.slow) / .68;
    } else {
      // chase: springy follow that lags the heading, orbit with the mouse
      if (!CAM.init) { CAM.ch = P.h; CAM.init = true; }
      CAM.ch += angDiff(CAM.ch, P.h + Math.atan2(P.vy, Math.max(4, Math.abs(P.vx))) * .5) * Math.min(1, dt * 3.6);
      const a = CAM.ch + CAM.yaw, dist = 6.6 + sstep(sp, 10, 45) * 1.6, hgt = 2.05 - CAM.pitch * 3;
      _v1.set(P.x - Math.sin(a) * dist, c.y + Math.max(.5, hgt), P.z - Math.cos(a) * dist);
      // never let a wall come between the camera and the car: pull in until the eye point is outside every tall collider
      for (let k = 1; k > .2; k -= .13) { const cx = P.x - Math.sin(a) * dist * k, cz = P.z - Math.cos(a) * dist * k; let inside = false;
        for (const b of nearBoxes(cx, cz, .6)) if (b.h > 1.6 && cx > b.x0 - .35 && cx < b.x1 + .35 && cz > b.z0 - .35 && cz < b.z1 + .35) { inside = true; break; }
        _v1.x = cx; _v1.z = cz; if (!inside) break; }
      cam.position.lerp(_v1, CAM.cpos.lengthSq() ? Math.min(1, dt * 9) : 1); CAM.cpos.copy(cam.position);
      cam.lookAt(P.x + Math.sin(P.h) * 1.5, c.y + 1.05, P.z + Math.cos(P.h) * 1.5); fovT = 54 + 10 * sstep(sp, 12, 46);
    }
    CAM.fov += (fovT - CAM.fov) * Math.min(1, dt * 4); if (Math.abs(cam.fov - CAM.fov) > .01) { cam.fov = CAM.fov; cam.updateProjectionMatrix(); }
    // rear-view mirror camera (looks straight back from just behind the rear glass)
    const mir = GT.render && GT.render.mirror;
    if (mir && mir.camera) { mir.enabled = mode === 'fp' && !G.noMirror; if (mir.enabled) { _v2.set(0, 1.08, -(c.dims.L / 2 + .12)).applyMatrix4(c.veh.group.matrixWorld); mir.camera.position.copy(_v2); c.veh.group.getWorldQuaternion(mir.camera.quaternion); mir.camera.updateMatrixWorld(); } }
  }
  function lookInput(dx, dy) { dx *= G.sens; dy *= G.sens * (G.invertY ? -1 : 1); CAM.yawT = clamp(CAM.yawT - dx * .0023, -2.094, 2.094); CAM.pitchT = clamp(CAM.pitchT - dy * .002, CAM.mode === 'fp' ? -.698 : -.25, CAM.mode === 'fp' ? .611 : .45); CAM.idle = 0; }

  /* ================================================================== input */
  const KEY = { thr: 0, brk: 0, left: 0, right: 0, hand: 0, f: 0, e: 0 };
  function bindInput() {
    const cv = G.canvas, doc = document;
    const down = e => {
      if (e.repeat) { if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault(); return; }
      const k = e.code; G.keys[k] = true;
      const st = ST(); if (st && st.blockKeys(k)) return;
      if (!G.started) { if (k === 'Enter' || k === 'Space') beginPlay(); return; }
      if (G.phase === 'end') { if ((k === 'Enter' || k === 'Space' || k === 'KeyR') && G.endT > 1) restart(); return; }
      if (k === 'Escape' || k === 'KeyP') { setPause(!G.paused); return; }
      if (G.paused) return;
      switch (k) {
        case 'KeyW': case 'ArrowUp': KEY.thr = 1; break; case 'KeyS': case 'ArrowDown': KEY.brk = 1; break;
        case 'KeyA': case 'ArrowLeft': KEY.left = 1; break; case 'KeyD': case 'ArrowRight': KEY.right = 1; break;
        case 'Space': KEY.hand = 1; if (G.phase === 'swap') hotwirePress(); e.preventDefault(); break;
        case 'KeyH': hornSet(true); break;
        case 'KeyR': if (GT.audio && G.audioOn) safe('radio', () => { GT.audio.nextStation(); HUD.radioT = 3; }); break;
        case 'KeyL': if (G.phase === 'wait') { P.flashT = .28; signal('flash'); emit('sfx', { name: 'ui_tick' }); } else { P.lightsOn = !P.lightsOn; P.lightsManual = true; emit('sfx', { name: 'ui_tick' }); } break;
        case 'KeyE': KEY.e = 1; if (G.phase === 'swap') hotwirePress(); break;
        case 'KeyF': KEY.f = 1; if (G.phase === 'swap') hotwirePress(); break;
        case 'KeyC': G.input.focus = true; break; case 'KeyQ': G.input.lookBack = true; break;
        case 'KeyV': CAM.mode = CAM.mode === 'fp' ? 'chase' : 'fp'; CAM.init = false; CAM.cpos.set(0, 0, 0); CAM.yawT = CAM.pitchT = 0; break;
        case 'KeyM': HUD.zoom = !HUD.zoom; emit('sfx', { name: 'ui_tick' }); break;
      }
    };
    const up = e => { const k = e.code; G.keys[k] = false;
      switch (k) { case 'KeyW': case 'ArrowUp': KEY.thr = 0; break; case 'KeyS': case 'ArrowDown': KEY.brk = 0; break; case 'KeyA': case 'ArrowLeft': KEY.left = 0; break; case 'KeyD': case 'ArrowRight': KEY.right = 0; break;
        case 'Space': KEY.hand = 0; break; case 'KeyH': hornSet(false); break; case 'KeyE': KEY.e = 0; break; case 'KeyF': KEY.f = 0; break; case 'KeyC': G.input.focus = false; break; case 'KeyQ': G.input.lookBack = false; break; } };
    addEventListener('keydown', down); addEventListener('keyup', up);
    addEventListener('blur', () => { KEY.thr = KEY.brk = KEY.left = KEY.right = KEY.hand = KEY.f = KEY.e = 0; G.input.focus = G.input.lookBack = false; hornSet(false); });
    let drag = false;
    const clickStart = () => { const st = ST(); if (st && (G.paused || st.blockKeys('Mouse'))) return; if (!G.started) beginPlay(); else if (G.phase === 'end') { if (G.endT > 1) restart(); } else if (G.paused) setPause(false); else if (!CAM.locked && cv.requestPointerLock) lockPointer(); };
    G.hudRoot.addEventListener('mousedown', e => { if (e.button === 0) { drag = true; clickStart(); } }); cv.addEventListener('mousedown', e => { if (e.button === 0) { drag = true; clickStart(); } });
    addEventListener('mouseup', () => { drag = false; });
    addEventListener('mousemove', e => { if (!G.started || G.paused) return; const st = ST(); if (st && st.blockKeys('Look')) return; if (CAM.locked) lookInput(e.movementX || 0, e.movementY || 0); else if (drag) lookInput(-(e.movementX || 0) * 1.4, -(e.movementY || 0) * 1.4); });
    doc.addEventListener('pointerlockchange', () => { const was = CAM.locked; CAM.locked = doc.pointerLockElement === cv; if (was && !CAM.locked && G.started && G.phase !== 'end' && !G.auto) setPause(true); const st = ST(); if (st && st.onLock) st.onLock(CAM.locked); });
    addEventListener('contextmenu', e => e.preventDefault());
  }
  function lockPointer() { try { const p = G.canvas.requestPointerLock && G.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { G.noLock = true; }); } catch (e) { G.noLock = true; } }
  function inputStep(dt) {
    const I = G.input; if (G.ap.on) return;
    I.throttle += clamp(KEY.thr - I.throttle, -7 * dt, (I.throttle < .35 ? 5 : 2.6) * dt); I.brake += clamp(KEY.brk - I.brake, -8 * dt, 6 * dt);
    const st = KEY.left - KEY.right; I.steer += clamp(st - I.steer, -(st === 0 ? 5 : 3.4) * dt, (st === 0 ? 5 : 3.4) * dt); I.hand = KEY.hand; I.holdF = !!(KEY.f || KEY.e);
  }
  function hornSet(on) { if (G.input.horn === on) return; G.input.horn = on; if (on && G.started && !G.paused) { signal('honk'); emit('horn', { on: true }); } else emit('horn', { on: false }); }
  function setPause(p) { if (G.auto || G.phase === 'end' || !G.started) return; const st = ST(); if (st && p && st.blockKeys('Pause')) return; if (G.paused === !!p) return; G.paused = !!p; if (!(st && st.pauseUI(p))) HUD.show('pause', p); if (p) { hornSet(false); if (document.exitPointerLock && CAM.locked) document.exitPointerLock(); } else if (G.canvas.requestPointerLock && !(st && st.blockKeys('Lock'))) lockPointer(); if (GT.audio && G.audioOn) safe('audio.master', () => GT.audio.setMaster(p ? G.master * .19 : G.master)); }
  function beginPlay() {
    if (G.started) return; G.started = true; HUD.show('title', false); HUD.root.classList.add('playing');
    if (GT.audio && !G.auto) { G.audioOn = !!safe('audio.init', () => GT.audio.init(), false); if (G.audioOn) { safe('audio.radio', () => GT.audio.setRadio(true, 0)); HUD.radioT = 4; } }
    if (!G.auto && G.canvas.requestPointerLock) lockPointer();
    CAM.yawT = -.5; CAM.pitchT = -.05; CAM.idle = 0;
  }
  function restart() { HUD.show('end', false); startRun(); HUD.reset(); CAM.yawT = -.5; CAM.pitchT = -.05; CAM.yaw = 0; if (!G.auto && G.canvas.requestPointerLock && !CAM.locked) lockPointer(); }

  /* ================================================================== audio glue */
  const AU = { squeal: 0, bell: false, hb: false, siren: 0 };
  function audioStep(dt) {
    if (!G.audioOn || !GT.audio) return; const A = GT.audio, sp = hyp(P.vx, P.vy);
    let sd = 999, sc = null; for (const c of G.cops) if (c.lights.siren) { const d = hyp(c.x - P.x, c.z - P.z); if (d < sd) { sd = d; sc = c; } }
    let rel = 0; if (sc) { getWv(); const nx = (P.x - sc.x) / (sd || 1), nz = (P.z - sc.z) / (sd || 1); rel = (Math.sin(sc.h) * sc.v - _wv.x) * nx + (Math.cos(sc.h) * sc.v - _wv.z) * nz; }
    const lvl = sc ? (W.hot ? clamp(.62 + W.stars * .06, 0, 1) : .4) : 0;
    const st = ST(), ext = !!(st && st.cine), ear = ext ? G.camera.position : P;
    safe('audio.update', () => A.update(dt, { engine: { on: P.engineOn, rpm: clamp((P.rpm - 720) / 5480, 0, 1), load: clamp(P.thr * (P.shiftT > 0 ? .2 : 1), 0, 1), speed: sp }, siren: { level: lvl, distance: sd, rel }, traffic: .45, interior: ext ? 0 : (CAM.mode === 'fp' ? 1 : .25), pos: { x: ear.x, z: ear.z } }));
    const sq = P.squeal > .12 ? P.squeal : 0; if (Math.abs(sq - AU.squeal) > .06 || (sq === 0 && AU.squeal !== 0)) { AU.squeal = sq; safe('squeal', () => A.sfx('tire_squeal', { level: sq })); }
    const s = L.station.store, bd = hyp(P.x - s.x0, P.z - s.doorZ), bell = R.bell && bd < 220 && G.phase !== 'end'; if (bell || AU.bell) { AU.bell = bell; safe('bell', () => A.sfx('alarm_bell', { on: bell, distance: bd })); }
    const hb = (G.phase === 'wait' && HUD.tension > .8) || W.bustT > 0 || G.phase === 'swap' && HW.danger; if (hb !== AU.hb) { AU.hb = hb; safe('hb', () => A.sfx('heartbeat', { on: hb, bpm: 104 })); }
  }
  function audioEvent(type, d) {
    if (!G.audioOn || !GT.audio) return; const A = GT.audio;
    safe('audio.evt', () => {
      if (type === 'sfx') A.sfx(d.name, d);
      else if (type === 'horn') A.sfx('horn', { on: !!d.on });
      else if (type === 'crash') { A.sfx('crash', { v: d.v }); if (d.v > .55) A.sfx('glass', { distance: 1 }); else if (d.v < .2) A.sfx('thunk'); }
      else if (type === 'star') A.sfx('star');
      else if (type === 'scanner') A.scanner(d.evt);
      else if (type === 'line' && d.kind === 's') A.scanner('unit');
      else if (type === 'spark') A.sfx(d.ok ? 'key_turn' : 'thunk');
      else if (type === 'getin') A.sfx('seatbelt', { g: .5 });
      else if (type === 'phase' && d.phase === 'end') { A.sfx(d.result === 'clean' ? 'cash' : 'ui_bad'); A.sfx('tire_squeal', { level: 0 }); A.sfx('heartbeat', { on: false }); }
    });
  }

  /* ================================================================== HUD (DOM + one 2D canvas for the minimap; styles in css/hud.css) */
  const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.4 5.9 20.8l1.4-6.8L2.2 9.3l6.9-.8z"/></svg>';
  const money = n => '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const HUD = {
    root: null, el: {}, zoom: false, tension: 0, radioT: 0, last: {}, crackLvl: 0, takeShown: 0, fadeT: 0, mapCtx: null, mapPx: 0,
    init(root) {
      this.root = root; if (!root) return;
      root.innerHTML =
        '<div class="h-vig" id="h-vig"></div><div class="h-vig h-red" id="h-red"></div><div class="h-vig h-blue" id="h-blue"></div><canvas id="h-crack"></canvas><div id="h-focus"><i></i></div>' +
        '<div id="h-tr"><div id="h-stars">' + STAR.repeat(6) + '</div><div id="h-chips">' +
        ['face|面孔', 'car|车型', 'plate|车牌'].map(s => { const a = s.split('|'); return '<span class="chip" data-k="' + a[0] + '"><i></i><em>' + a[1] + '</em><b>未知</b></span>'; }).join('') + '</div><div id="h-status"></div></div>' +
        '<div id="h-tension"><div class="t-head"><span>局势</span><b id="h-tpct"></b></div><div class="t-bar"><i id="h-tfill"></i><u style="left:72%"></u></div>' +
        '<div class="t-sub"><span data-k="clerk"><i></i>店员</span><span data-k="eyes"><i></i>目击</span><span data-k="patrol"><i></i>巡逻</span></div></div>' +
        '<div id="h-take"><span>到手</span><b id="h-takev">$0</b></div>' +
        '<div id="h-bl"><div id="h-mapwrap"><canvas id="h-map"></canvas><div class="h-ring"></div><div class="h-n" id="h-n">N</div></div><div id="h-info"><b id="h-clock">18:10</b><span id="h-dist"></span></div></div>' +
        '<div id="h-bc"><div id="h-sub"><span class="who"></span><span class="txt"></span></div><div id="h-obj"></div></div>' +
        '<div id="h-hint"></div><div id="h-radio"></div>' +
        '<div id="h-prompt"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19"/><circle class="p" cx="22" cy="22" r="19"/></svg><b></b><span></span></div>' +
        '<div id="h-hw"><div class="hw-title">接线点火</div><div class="hw-bar"><i class="hw-zone"></i><i class="hw-needle"></i></div><div class="hw-steps"><i></i><i></i><i></i></div><div class="hw-tip"></div></div>' +
        '<div id="h-fade"></div>' +
        '<div id="h-title" class="h-screen"><div class="tt-kicker">海滨公路 · 18:10 · 日落前</div><h1 style="font-size:clamp(26px,6.2vw,104px);white-space:nowrap">BILIBILI THEFT AUTO 1</h1><div class="tt-sub">你是司机。他进去，你等着。什么时候按喇叭，由你决定。</div><div class="tt-go">点击开始</div>' +
        '<div class="tt-keys"><span><kbd>W</kbd><kbd>S</kbd><kbd>A</kbd><kbd>D</kbd> 驾驶</span><span><kbd>空格</kbd> 手刹</span><span><kbd>H</kbd> 鸣笛</span><span><kbd>L</kbd> 闪灯 / 车灯</span><span><kbd>F</kbd> 换车</span><span><kbd>Q</kbd> 回头</span><span><kbd>C</kbd> 专注</span><span><kbd>V</kbd> 视角</span><span><kbd>R</kbd> 电台</span><span><kbd>M</kbd> 地图</span></div></div>' +
        '<div id="h-pause" class="h-screen"><h2>暂停</h2><div class="tt-go">点击继续</div></div>' +
        '<div id="h-end" class="h-screen"><div class="e-kicker"></div><h2 class="e-title"></h2><div class="e-rank"></div><div class="e-grid"></div><div class="tt-go">点击再来一次</div></div>';
      const ids = ['vig', 'red', 'blue', 'crack', 'focus', 'tr', 'stars', 'chips', 'status', 'tension', 'tpct', 'tfill', 'take', 'takev', 'bl', 'map', 'n', 'clock', 'dist', 'bc', 'sub', 'obj', 'hint', 'radio', 'prompt', 'hw', 'fade', 'title', 'pause', 'end'];
      for (const id of ids) this.el[id] = root.querySelector('#h-' + id);
      this.stars = Array.from(this.el.stars.children); this.chips = {}; for (const c of this.el.chips.children) this.chips[c.dataset.k] = c;
      this.tsub = {}; for (const c of root.querySelectorAll('.t-sub span')) this.tsub[c.dataset.k] = c;
      this.mapCtx = this.el.map.getContext('2d'); this.reset();
    },
    reset() { this.last = {}; this.crackLvl = 0; this.takeShown = 0; if (this.el.crack) { const c = this.el.crack; c.width = c.width; } this.show('end', false); },
    show(name, on) { const e = this.el[name]; if (e) e.classList.toggle('on', !!on); },
    set(key, el, val, prop) { if (this.last[key] === val) return; this.last[key] = val; if (prop === 'html') el.innerHTML = val; else if (prop) el.style[prop] = val; else el.textContent = val; },
    cls(key, el, name, on) { on = !!on; if (this.last[key] === on) return; this.last[key] = on; el.classList.toggle(name, on); },
    fade() { this.fadeT = .9; },
    update(dt) {
      if (!this.root) return; const st = ST(), pre = !!(st && st.pre), E = this.el, ph = G.phase, playing = G.started && ph !== 'end' && !(st && st.ui);
      this.cls('playing', this.root, 'playing', playing); this.cls('fp', this.root, 'fp', CAM.mode === 'fp');
      // --- wanted block
      const n = Math.min(6, Math.ceil(W.stars - .02)), searching = !W.hot && W.stars > 0;
      for (let i = 0; i < 6; i++) this.cls('st' + i, this.stars[i], 'on', i < n);
      this.cls('stS', E.stars, 'search', searching || (W.hot && G.time - W.lastSeenT > .9)); this.cls('stH', E.stars, 'hot', W.hot); this.cls('trOn', E.tr, 'on', !pre && (ph !== 'wait' || R.alarm));
      for (const k of ['face', 'car', 'plate']) { const c = W.chips[k], st = !W.called ? (c.on && ph !== 'wait' ? 'pend' : 'unk') : (c.on ? (c.valid ? 'on' : 'stale') : 'unk');
        if (this.last['chip' + k] !== st) { this.last['chip' + k] = st; const e = this.chips[k]; e.className = 'chip ' + st; e.lastChild.textContent = { unk: '未知', pend: '被看见', on: '在案', stale: '已失效' }[st]; } }
      const unseen = W.hot && G.time - W.lastSeenT > .9;
      this.set('status', E.status, pre ? '' : W.hot ? (unseen ? '脱离视线 · 再躲 ' + Math.max(1, Math.ceil(5.5 - (G.time - W.lastSeenT))) + ' 秒' : '追捕中') : (Math.max(W.idT, W.susp) > .2 && ph !== 'wait' ? '有警车在打量你 · 别慌' : searching ? '搜索中 · 别引起注意' : (W.called && W.stars === 0 ? '已脱身' : (ph !== 'wait' && !W.called ? '尚未报案' : ''))));
      // --- tension (WAIT)
      const showT = ph === 'wait'; this.cls('tOn', E.tension, 'on', showT && G.started); this.cls('takeOn', E.take, 'on', !pre && G.started && ph !== 'end' && (R.take > 0 || ph !== 'wait'));
      if (showT) { let eyes = 0; if (R.pumpGuy) eyes += R.pumpAlert ? .6 : .3; if (R.walker) eyes += R.walkerSaw ? .7 : clamp(1 - (R.walker.z - G.pt.door[1]) / 34, .1, .5);
        let pat = 0; for (const q of G.cops) pat = Math.max(pat, clamp(1 - hyp(q.x - P.x, q.z - P.z) / 150, 0, 1)); if (R.patrolStage === 5) pat = Math.max(pat, .35);
        eyes = clamp(eyes, 0, 1); const ten = R.alarm ? 1 : 1 - (1 - clamp(R.nerve, 0, 1)) * (1 - .45 * eyes) * (1 - .6 * pat); this.tension += (ten - this.tension) * Math.min(1, dt * 4);
        this.set('tfill', E.tfill, (this.tension * 100).toFixed(1) + '%', 'width'); this.set('tpct', E.tpct, Math.round(this.tension * 100)); this.cls('tHigh', E.tension, 'high', this.tension > .72);
        const sv = { clerk: clamp(R.nerve, 0, 1), eyes, patrol: pat }; for (const k in sv) this.set('ts' + k, this.tsub[k].firstChild, 'scaleX(' + sv[k].toFixed(2) + ')', 'transform'); }
      else this.tension = 0;
      if (Math.abs(this.takeShown - R.take) > .5) this.takeShown += (R.take - this.takeShown) * Math.min(1, dt * 5); else this.takeShown = R.take;
      this.set('takev', E.takev, money(this.takeShown));
      // --- clock / objective / subtitle
      const hrs = currentHours(), hh = Math.floor(hrs) % 24, mm = Math.floor((hrs % 1) * 60); this.set('clock', E.clock, (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm);
      const C = W.chips, valid = (C.car.on && C.car.valid) || (C.plate.on && C.plate.valid); let obj = '', tgt = null;
      if (ph === 'wait') obj = R.stage === 'runout' ? '等他上车' : (inProgress() ? '看好后视镜 · 决定什么时候叫他撤' : '');
      else if (ph === 'heat') { if (W.hot) obj = '甩掉警车'; else if (!W.called) obj = '离开加油站 · 别引人注意'; else if (valid) { obj = '去汽车旅馆换一辆车'; tgt = G.swapCars[1] || null; } else obj = W.exitOpen ? '开到南端封路口 · 停车交接' : '保持低调 · 等搜索结束'; }
      else if (ph === 'swap') obj = '接线点火';
      else if (ph === 'clean') obj = W.hot ? '甩掉警车' : (W.exitOpen ? '开到南端封路口 · 停车交接' : '按正常车速行驶 · 等搜索结束');
      if (W.exitOpen && (ph === 'heat' || ph === 'clean')) tgt = EXIT;
      if (pre && st.marker) tgt = st.marker;
      this.objTarget = tgt; this.set('obj', E.obj, obj);
      this.set('dist', E.dist, tgt ? Math.round(hyp(tgt.x - P.x, tgt.z - P.z) / 10) * 10 + ' m' : '');
      const s = SUB.cur; this.cls('subOn', E.sub, 'on', !!s && G.started && G.subsOn);
      if (s && this.last.subRef !== s) { this.last.subRef = s; E.sub.firstChild.textContent = s.who; E.sub.lastChild.textContent = s.text; E.sub.className = 'on k-' + s.kind; this.last.subOn = true; }
      // --- hints (context keys, tiny)
      let hint = '';
      if (ph === 'wait') hint = inProgress() ? '<kbd>H</kbd> 鸣笛叫他撤 <kbd>L</kbd> 闪灯（他在柜台前才看得见）' : '';
      else if (ph === 'swap') hint = '<kbd>E</kbd> / <kbd>空格</kbd> 在亮区接线';
      else if (ph === 'heat' && G.phaseT < 10) hint = '<kbd>Q</kbd> 回头 <kbd>C</kbd> 专注 <kbd>V</kbd> 视角 <kbd>M</kbd> 地图';
      else if (ph === 'heat' && W.called && !W.hot && !HW.target && valid && hyp(P.x - L.motel.parking[2][0], P.z - L.motel.parking[2][1]) < 45) hint = '停到停车场的车旁边 · 按住 <kbd>F</kbd> 换车';
      this.set('hint', E.hint, hint, 'html');
      if (this.radioT > 0) { this.radioT -= dt; const A = GT.audio; let nm = ''; if (A && A.stations && A.stations[A.station]) nm = A.stations[A.station].name + ' · ' + (A.stations[A.station].tag || ''); this.set('radio', E.radio, nm); }
      this.cls('radioOn', E.radio, 'on', this.radioT > 0);
      // --- hold-to-swap / busted ring
      let pr = 0, pk = '', pt = '';
      if (ph === 'heat' && HW.target) { pr = HW.hold / .85; pk = 'F'; pt = '按住换车'; } if (W.bustT > 0 && ph !== 'end') { pr = W.bustT / 3.2; pk = '!'; pt = '快动起来'; }
      this.cls('prOn', E.prompt, 'on', !!pk); this.cls('prBad', E.prompt, 'bad', pk === '!');
      if (pk) { this.set('prk', E.prompt.children[1], pk); this.set('prt', E.prompt.children[2], pt); this.set('prr', E.prompt.firstChild.lastChild, (119.4 * (1 - clamp(pr, 0, 1))).toFixed(1), 'strokeDashoffset'); }
      // --- hot-wire
      this.cls('hwOn', E.hw, 'on', ph === 'swap');
      if (ph === 'swap') { const bar = E.hw.children[1], z = HW.zones[Math.min(2, HW.stage)], w = hwWidth(); bar.firstChild.style.left = ((z - w / 2) * 100).toFixed(1) + '%'; bar.firstChild.style.width = (w * 100).toFixed(1) + '%'; bar.lastChild.style.left = (HW.p * 100).toFixed(2) + '%';
        const st = E.hw.children[2].children; for (let i = 0; i < 3; i++) this.cls('hws' + i, st[i], 'on', i < HW.stage); this.cls('hwD', E.hw, 'danger', !!HW.danger); this.cls('hwF', E.hw, 'flash', G.time - HW.flash < .18);
        this.set('hwtip', E.hw.children[3], HW.danger ? '有警车能看见你 · 先别动' : '指针进入亮区时按 E'); }
      // --- vignettes: heat pulse, focus
      const t = G.time, lvl = W.hot ? .3 + W.stars * .06 : 0, pulse = Math.sin(t * 5.2);
      const red = W.hot ? lvl * (.5 + .5 * pulse) : (W.bustT > 0 ? .5 : (searching ? .1 + .05 * Math.sin(t * 1.6) : (ph === 'wait' ? Math.max(0, this.tension - .6) * .5 * (1 + .3 * Math.sin(t * 3)) : 0)));
      const blue = W.hot && W.nearest < 90 ? lvl * (.5 - .5 * pulse) * .9 : 0;
      this.set('red', E.red, red.toFixed(3), 'opacity'); this.set('blue', E.blue, blue.toFixed(3), 'opacity');
      this.set('foc', E.focus, ((1 - G.slow) / .68).toFixed(2), 'opacity'); this.set('focE', E.focus.firstChild, 'scaleX(' + G.focusE.toFixed(3) + ')', 'transform');
      if (this.fadeT > 0) { this.fadeT -= dt; } this.set('fade', E.fade, clamp(this.fadeT > .55 ? (.9 - this.fadeT) / .2 : this.fadeT / .5, 0, 1).toFixed(2), 'opacity');
      // --- windshield cracks follow damage
      const lv = P.damage > .82 ? 4 : P.damage > .6 ? 3 : P.damage > .36 ? 2 : P.damage > .14 ? 1 : 0; if (lv > this.crackLvl) { for (let i = this.crackLvl; i < lv; i++) this.crack(i); this.crackLvl = lv; }
      if (this.crackLvl) { const kpx = (innerHeight / 2) / Math.tan(G.camera.fov * PI / 360), ay = Math.abs(CAM.yaw); this.set('crT', E.crack, 'translate(' + (CAM.yaw * kpx).toFixed(1) + 'px,' + (CAM.pitch * kpx).toFixed(1) + 'px)', 'transform'); this.set('crO', E.crack, (CAM.mode === 'fp' ? .9 * (1 - sstep(ay, .5, 1.1)) : 0).toFixed(2), 'opacity'); }
      this.drawMap();
    },
    crack(i) {
      const c = this.el.crack, w = innerWidth, h = innerHeight; if (c.width !== w || c.height !== h) { const old = c.width ? c : null; let img = null; if (old && old.width && old.height) { img = document.createElement('canvas'); img.width = c.width; img.height = c.height; img.getContext('2d').drawImage(c, 0, 0); } c.width = w; c.height = h; if (img) c.getContext('2d').drawImage(img, 0, 0, w, h); }
      const g = c.getContext('2d'), r = GT.rng('crack' + i + G.seed), cx = w * [.68, .3, .52, .8][i % 4] + (r() - .5) * 80, cy = h * [.3, .26, .2, .44][i % 4] + (r() - .5) * 50, R0 = h * (.2 + i * .05), rays = 9 + Math.floor(r() * 5), ends = [];
      g.lineCap = 'round';
      const stroke = (pts, wd, a) => { for (const [ox, col] of [[.8, 'rgba(10,14,18,' + a * .55 + ')'], [0, 'rgba(235,245,250,' + a + ')']]) { g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(p[0] + ox, p[1] + ox) : g.moveTo(p[0] + ox, p[1] + ox)); g.strokeStyle = col; g.lineWidth = wd; g.stroke(); } };
      for (let k = 0; k < rays; k++) { let a = k / rays * TAU + r() * .5, x = cx, y = cy; const len = R0 * (.45 + r() * .9), pts = [[x, y]], seg = 7; const ring = [];
        for (let s = 1; s <= seg; s++) { a += (r() - .5) * .34; x += Math.cos(a) * len / seg; y += Math.sin(a) * len / seg; pts.push([x, y]); ring.push([x, y]); if (s > 2 && r() < .22) { let bx = x, by = y, ba = a + (r() < .5 ? .7 : -.7); const bp = [[bx, by]]; for (let q = 0; q < 3; q++) { ba += (r() - .5) * .4; bx += Math.cos(ba) * len * .09; by += Math.sin(ba) * len * .09; bp.push([bx, by]); } stroke(bp, .6, .28); } }
        stroke(pts, .9, .42); ends.push(ring); }
      for (let s = 0; s < 4; s++) for (let k = 0; k < rays; k++) if (r() < .6 - s * .1) { const a = ends[k][s], b = ends[(k + 1) % rays][s]; if (a && b) stroke([a, [(a[0] + b[0]) / 2 + (r() - .5) * 6, (a[1] + b[1]) / 2 + (r() - .5) * 6], b], .55, .26); }
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R0 * .16); gr.addColorStop(0, 'rgba(240,248,255,.34)'); gr.addColorStop(1, 'rgba(240,248,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R0 * .16, 0, TAU); g.fill();
    },
    drawMap() {
      const cv = this.el.map, g = this.mapCtx; if (!cv || !g) return; const css = cv.clientWidth || 168, dpr = Math.min(2, window.devicePixelRatio || 1), S = Math.round(css * dpr);
      if (cv.width !== S) { cv.width = cv.height = S; } const Rr = S / 2, range = this.zoom ? 210 : 88; this.kz = (this.kz || Rr / range) + (Rr / range - (this.kz || Rr / range)) * .18; const k = this.kz;
      const h = CAM.mode === 'fp' || true ? P.h : 0, ch = Math.cos(h), sh = Math.sin(h), a = -k * ch, c = k * sh, b = -k * sh, d = -k * ch, oy = Rr * 1.22;
      const mx = (x, z) => Rr + a * (x - P.x) + c * (z - P.z), my = (x, z) => oy + b * (x - P.x) + d * (z - P.z);
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S); g.save(); g.beginPath(); g.arc(Rr, Rr, Rr - 1, 0, TAU); g.clip();
      g.fillStyle = 'rgba(13,17,22,.72)'; g.fillRect(0, 0, S, S);
      g.setTransform(a, b, c, d, Rr - a * P.x - c * P.z, oy - b * P.x - d * P.z);
      const H = L.highway, st = L.station, mo = L.motel, rect = (x0, z0, x1, z1) => g.fillRect(x0, z0, x1 - x0, z1 - z0);
      g.fillStyle = 'rgba(52,92,108,.5)'; rect(-900, -900, L.ocean.x1, 900); g.fillStyle = 'rgba(150,136,104,.2)'; rect(L.beach.x0, -900, L.beach.x1, 900);
      g.fillStyle = 'rgba(255,255,255,.055)'; rect(st.x0, st.z0, st.x1, st.z1); rect(mo.x0, mo.z0, mo.x1, mo.z1);
      g.fillStyle = 'rgba(205,212,220,.3)'; rect(-H.width / 2, H.zMin - 300, H.width / 2, H.zMax + 300); rect(0, L.crossS.z - 4.5, L.crossS.x1 + 4.5, L.crossS.z + 4.5); rect(0, L.crossN.z - 4.5, L.crossN.x1 + 4.5, L.crossN.z + 4.5); rect(L.backRoad.x - 4.5, L.backRoad.zMin, L.backRoad.x + 4.5, L.backRoad.zMax);
      for (const dz of st.drives.concat([mo.drive])) rect(H.width / 2, dz - 4, st.x0 + 6, dz + 4);
      g.fillStyle = 'rgba(232,226,214,.3)'; rect(st.store.x0, st.store.z0, st.store.x1, st.store.z1); rect(mo.wingE.x0, mo.wingE.z0, mo.wingE.x1, mo.wingE.z1); rect(mo.wingN.x0, mo.wingN.z0, mo.wingN.x1, mo.wingN.z1);
      g.strokeStyle = 'rgba(232,226,214,.22)'; g.lineWidth = .6; const cn = st.canopy; g.strokeRect(cn.x - cn.w / 2, cn.z - cn.d / 2, cn.w, cn.d);
      g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = .35; g.setLineDash([3, 5]); g.beginPath(); g.moveTo(0, H.zMin - 300); g.lineTo(0, H.zMax + 300); g.stroke(); g.setLineDash([]);
      // search area + vision cones
      if (!W.hot && W.stars > 0 && W.called) { g.strokeStyle = 'rgba(255,170,90,' + (.35 + .2 * Math.sin(G.time * 3)) + ')'; g.lineWidth = 1.2; g.setLineDash([4, 4]); g.beginPath(); g.arc(W.lastKnown.x, W.lastKnown.z, 26 + Math.min(40, W.searchT * 2.5), 0, TAU); g.stroke(); g.setLineDash([]); }
      for (const q of G.cops) { const K = q.cop, th = PI / 2 - q.h, see = K.cone || 0; g.beginPath(); g.moveTo(q.x, q.z); g.arc(q.x, q.z, 62, th - 1.0, th + 1.0); g.closePath();
        const gr = g.createRadialGradient(q.x, q.z, 2, q.x, q.z, 62), col = see > .3 ? '255,84,64' : '110,190,255', al = see > .3 ? .5 : .24; gr.addColorStop(0, 'rgba(' + col + ',' + al + ')'); gr.addColorStop(1, 'rgba(' + col + ',0)'); g.fillStyle = gr; g.fill(); }
      g.setTransform(1, 0, 0, 1, 0, 0);
      const dot = (x, z, r, col) => { g.beginPath(); g.arc(mx(x, z), my(x, z), r * dpr, 0, TAU); g.fillStyle = col; g.fill(); };
      for (const q of G.traffic) dot(q.x, q.z, 1.5, 'rgba(220,224,230,.34)');
      for (const q of G.cars) if (q.parked && !q.swap && q !== P.car) dot(q.x, q.z, 1.5, 'rgba(220,224,230,.28)');
      const C = W.chips, needSwap = G.phase === 'heat' && W.called && ((C.car.on && C.car.valid) || (C.plate.on && C.plate.valid));
      const mark = (x, z, col, shape) => { let X = mx(x, z), Y = my(x, z); const dx = X - Rr, dy = Y - Rr, dd = hyp(dx, dy), lim = Rr - 9 * dpr; let edge = false; if (dd > lim) { X = Rr + dx / dd * lim; Y = Rr + dy / dd * lim; edge = true; }
        g.save(); g.translate(X, Y); g.fillStyle = col; g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = dpr; g.beginPath();
        if (shape === 'sq') { g.rotate(PI / 4); g.rect(-3.2 * dpr, -3.2 * dpr, 6.4 * dpr, 6.4 * dpr); } else { g.arc(0, 0, 4.2 * dpr, 0, TAU); } g.fill(); g.stroke();
        if (!edge) { g.beginPath(); g.arc(0, 0, (7 + 2.5 * Math.sin(G.time * 4)) * dpr, 0, TAU); g.strokeStyle = col; g.globalAlpha = .45; g.stroke(); } g.restore(); };
      if (needSwap) for (const q of G.swapCars) if (!q.used) mark(q.x, q.z, '#8fe6c2', 'sq');
      if (W.exitOpen && G.phase !== 'end') mark(EXIT.x, EXIT.z, '#8fe6c2');
      { const st = ST(); if (st && st.pre && st.marker) mark(st.marker.x, st.marker.z, '#ffd08a'); }
      if (G.phase === 'wait' && G.partner && !G.partner.seat) dot(G.partner.x, G.partner.z, 2.2, '#ffd08a');
      for (const q of G.cops) { const X = mx(q.x, q.z), Y = my(q.x, q.z), fl = q.lights.siren && Math.sin(G.time * 12) > 0; g.beginPath(); g.arc(X, Y, 3.6 * dpr, 0, TAU); g.fillStyle = fl ? '#ff5a48' : '#6ebeff'; g.fill(); g.lineWidth = dpr; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke(); }
      // player arrow
      g.translate(Rr, oy); g.beginPath(); g.moveTo(0, -7.5 * dpr); g.lineTo(5 * dpr, 5.5 * dpr); g.lineTo(0, 2.6 * dpr); g.lineTo(-5 * dpr, 5.5 * dpr); g.closePath(); g.fillStyle = '#fff'; g.fill(); g.lineWidth = dpr; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke();
      g.setTransform(1, 0, 0, 1, 0, 0); g.restore();
      // north tick (+Z is "north": the motel is north of the station)
      const nx = sh, ny = -ch, nEl = this.el.n; if (nEl) { const r = css / 2 - 1; nEl.style.transform = 'translate(' + (nx * r).toFixed(1) + 'px,' + (ny * r).toFixed(1) + 'px)'; }
    },
    end(res) {
      const E = this.el.end; if (!E) return; const ok = res.result === 'clean', t = Math.floor(res.time), mmss = Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60);
      E.className = 'h-screen on ' + (ok ? 'ok' : 'bad');
      E.children[0].textContent = ok ? '干净脱身' : (res.result === 'busted' ? '落网' : '任务失败'); E.children[1].textContent = ok ? money(res.take) : (res.result === 'busted' ? 'BUSTED' : '你丢下了搭档');
      E.children[2].innerHTML = ok ? '<b>' + res.rank + '</b><span>' + res.title + '</span>' : '<span>' + (res.result === 'busted' ? '钱和车都留在了路边' : '他会记住这件事') + '</span>';
      const chip = k => res.chips[k].on ? (res.chips[k].valid ? '在案' : '已失效') : '未知';
      E.children[3].innerHTML = [['到手', money(res.take)], [ok ? '用时' : '坚持了', mmss], ['最高热度', '★'.repeat(res.peak) + '<i>' + '★'.repeat(6 - res.peak) + '</i>'], ['面孔 / 车型 / 车牌', chip('face') + ' · ' + chip('car') + ' · ' + chip('plate')], ['换车', res.swapped ? '是' : '否'], ['车损', Math.round(res.damage * 100) + '%']]
        .map(r => '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
    }
  };

  /* ================================================================== autopilot (deterministic; drives the real physics through the same inputs a player has) */
  G.ap = { on: false, plan: 'calm', honkAt: 20, sig: 'honk', path: null, s: 0, speed: 13, rev: false, stage: 0, honked: false, freezeHW: false, wait: 0, maxThr: .7 };
  function apRoute(pts, speed, rev, rad) { const A = G.ap; A.path = mkPath(pts, rad || 7, false); A.s = 0; A.speed = speed; A.rev = !!rev; }
  function apFollow(I) {
    const A = G.ap, p = A.path, S = P.spec, v = P.vx, sp = Math.abs(v); A.s = pathAdvance(p, A.s, P.x, P.z); const rem = p.len - A.s, lim = S.steerMax / (1 + Math.pow(sp / 15, 1.5)) + .03;
    if (!A.rev) {
      const q = pathAt(p, A.s + 4 + sp * .5, _q1), dd = Math.max(2, hyp(q.x - P.x, q.z - P.z)), err = angDiff(P.h, Math.atan2(q.x - P.x, q.z - P.z));
      I.steer = clamp(Math.atan(2 * S.wb * Math.sin(err) / dd) / lim, -1, 1);
      let vT = Math.min(A.speed, pathSpeed(p, A.s, A.plan === 'calm' ? 5 : 7.5)); vT = Math.min(vT, Math.sqrt(2 * 3.2 * Math.max(0, rem - 1.2)));
      const f = Math.sin(P.h), g = Math.cos(P.h); for (const o of G.cars) { if (o === P.car) continue; const dx = o.x - P.x, dz = o.z - P.z, fz = dx * f + dz * g; if (fz < 1 || fz > 9 + sp * 1.6 || Math.abs(dx * g - dz * f) > 1.9) continue; if (o.parked && rem < 14) continue;
        const gap = fz - 5.8, l = gap < .5 ? 0 : Math.max(0, o.v * Math.cos(angDiff(P.h, o.h))) + gap * .8; if (A.plan !== 'chase' || !o.isCop) vT = Math.min(vT, l); }
      // yield to crossing / oncoming traffic: will anyone be where my path is when I get there?
      if (A.plan === 'calm') { let conflict = false; for (let d = 5; d <= 23 && !conflict; d += 3) { const pt = pathAt(p, A.s + d, _q2), tm = d / Math.max(sp, 3.5);
        for (const o of G.cars) { if (o === P.car || Math.abs(o.v) < 2) continue; if (Math.abs(angDiff(P.h, o.h)) < .6 && (o.x - P.x) * f + (o.z - P.z) * g > 0) continue;
          for (const k of [.75, 1.15]) { const ox = o.x + Math.sin(o.h) * o.v * tm * k, oz = o.z + Math.cos(o.h) * o.v * tm * k; if (hyp(ox - pt.x, oz - pt.z) < 4.2) { conflict = true; break; } } if (conflict) break; } }
        if (conflict) { A.yieldT = .5; } if (A.yieldT > 0) { A.yieldT -= 1 / 60; vT = Math.min(vT, sp > 6 ? vT : 0); } }
      I.throttle = clamp((vT - v) * .3, 0, A.maxThr); I.brake = v > vT + 1 ? clamp((v - vT) * .35, 0, 1) : 0; if (vT < .3 && sp < .7) { I.brake = 0; I.hand = 1; I.throttle = 0; }
      return rem < 1.8 && sp < .5;
    }
    const q = pathAt(p, A.s + 3.2, _q1), err = angDiff(P.h + PI, Math.atan2(q.x - P.x, q.z - P.z)); I.steer = clamp(-err * 2.4, -1, 1);
    const vT = Math.min(3.4, Math.sqrt(2 * 2 * Math.max(0, rem - .8))), spR = -v;
    if (P.gear >= 0) { I.brake = .5; I.throttle = 0; } else { I.brake = clamp((vT - spR) * .4, 0, .45); I.throttle = spR > vT + .5 ? .5 : 0; }
    return rem < 1.3 && sp < .4;
  }
  function routeToMotel(chase) {
    const hs = L.heroStart, st = L.station, mo = L.motel, dS = st.drives[0], c = G.swapCars[0], c2 = G.swapCars[1] || c, fx = Math.sin(c.h), fz = Math.cos(c.h), o = 2.25, bx = L.backRoad.x;
    const mid = [(c.x + c2.x) / 2, (c.z + c2.z) / 2], end = [mid[0] - fx * 6.1, mid[1] - fz * 6.1], pre = [mid[0] - fx * 16, mid[1] - fz * 16];
    const out = [[hs.x, hs.z], [hs.x, hs.z - 13], [hs.x - 4, dS + 6.5], [hs.x - 14, dS + .5], [15, dS]];
    if (!chase) return out.concat([[4.5, dS + 1], [-3, dS + 12], [-3, mo.drive - 16], [2.5, mo.drive - 2.5], [15, mo.drive], [34, mo.drive + .5], pre, end]);
    return out.concat([[7, dS - 2], [3, dS - 13], [3, L.crossS.z + o], [bx - o, L.crossS.z + o], [bx - o, L.crossN.z - o], [3, L.crossN.z - o], [3, mo.drive + 15], [7.5, mo.drive + 2], [17, mo.drive], [34, mo.drive + .5], pre, end]);
  }
  function apStep(dt) {
    const A = G.ap, I = G.input, ph = G.phase; I.throttle = I.brake = I.steer = I.hand = 0; I.holdF = false;
    { const st = ST(); if (st && st.autopilot && st.autopilot(I, dt)) return; }
    if (ph === 'wait') { I.hand = 1; if (!A.honked && R.t >= A.honkAt && inProgress()) { A.honked = true; if (A.sig === 'honk') { signal('honk'); emit('sfx', { name: 'horn', dur: .7 }); } else { P.flashT = .3; signal('flash'); } } return; }
    if (ph === 'heat') {
      if (A.stage === 0) { const chase = A.plan !== 'calm'; apRoute(routeToMotel(chase), chase ? 25 : 14, false, chase ? 9 : 7); A.maxThr = chase ? .8 : .55; A.stage = 1; }
      if (A.plan === 'busted' && G.phaseT > 5) { I.brake = P.vx > 1 ? 1 : 0; I.hand = 1; return; }
      if (A.stage === 1) { if (apFollow(I)) A.stage = 2; } else if (A.stage === 2) { I.hand = 1; I.holdF = true; }
      return;
    }
    if (ph === 'swap') { I.hand = 1; A.stage = 3; if (A.freezeHW && HW.stage >= 1) return; if (G.phaseT > 1 && !HW.danger && Math.abs(HW.p - HW.zones[HW.stage]) < hwWidth() * .28) hotwirePress(); return; }
    if (ph === 'clean') {
      const c = P.car, mo = L.motel;
      if (A.stage <= 3) { const bx = -Math.sin(c.h), bz = -Math.cos(c.h), rx = -Math.cos(c.h), rz = Math.sin(c.h); A.home = [c.x, c.z];
        apRoute([[c.x, c.z], [c.x + bx * 8, c.z + bz * 8], [c.x + bx * 11.5 + rx * 1.6, c.z + bz * 11.5 + rz * 1.6], [c.x + bx * 13.2 + rx * 5.2, c.z + bz * 13.2 + rz * 5.2]], 3.4, true, 3); A.stage = 4; A.wait = 1.4; }
      if (A.stage === 4) { if (A.wait > 0) { A.wait -= dt; I.hand = 1; return; } if (apFollow(I)) A.stage = 5; return; }
      if (A.stage === 5) { if (!W.exitOpen) { I.hand = 1; return; } A.maxThr = .5; apRoute([[P.x, P.z], [A.home[0] - 15.5, mo.drive + 2.2], [A.home[0] - 21, mo.drive], [30, mo.drive], [16, mo.drive], [6.5, mo.drive - 2.5], [3, mo.drive - 13], [3, 0], [3, EXIT.z + 8], [EXIT.x, EXIT.z - 3.5]], 13.5, false, 6); A.stage = 6; }
      if (A.stage === 6) apFollow(I);
      return;
    }
    I.hand = 1;
  }

  /* ================================================================== simulation step (no rendering, no DOM: used by the game loop, the auto fast-forward and the self-test) */
  const _inp = { throttle: 0, brake: 0, steer: 0, hand: 0 }, TS = (20.5 - (18 + 10 / 60)) / 420;
  const currentHours = () => G.fixedHours !== null ? G.fixedHours : (G.holdHours !== null ? G.holdHours : Math.min(21.4, G.startHours + G.time * TS));
  function playerPost(dt) {
    const c = P.car, sp = hyp(P.vx, P.vy), night = (GT.env && GT.env.night) || 0;
    const sq = sp > 4 ? Math.max(sstep(P.slipR, .1, .28), sstep(P.slipF, .13, .3) * .8, P.hand > 0 ? .9 : 0) : 0; P.squeal += (Math.max(sq, P.thr > .4 ? clamp((P.spin - 1.04) * 1.5, 0, .75) * (1 - sstep(sp, 14, 26) * .6) : 0) - P.squeal) * Math.min(1, dt * 9);
    P.roll += (clamp(P.ayS * .0062, -.07, .07) - P.roll) * Math.min(1, dt * 6); P.pitch += (clamp(-P.axS * .0046, -.045, .05) - P.pitch) * Math.min(1, dt * 6);
    P.dipV += (-P.dip * 90 - P.dipV * 11) * dt; P.dip += P.dipV * dt * .02; P.dip = clamp(P.dip, -.06, .06);
    P.bob = Math.sin(P.odo * 1.9) * .0035 * sstep(sp, 2, 20) + (P.engineOn ? Math.sin(G.time * 31) * .0006 : 0);
    let y = 0; if (GT.road && GT.road.groundHeight && !G.noGround) { const s = Math.sin(P.h), co = Math.cos(P.h), a = c.dims.wheelbase / 2, t = c.dims.track / 2; y = (groundY(P.x + s * a + co * t, P.z + co * a - s * t) + groundY(P.x + s * a - co * t, P.z + co * a + s * t) + groundY(P.x - s * a + co * t, P.z - co * a - s * t) + groundY(P.x - s * a - co * t, P.z - co * a + s * t)) / 4; }
    const dy = y - P.y; if (Math.abs(dy) > .004 && sp > 1) P.dipV += clamp(dy * 14, -1.2, 1.2); P.y += dy * Math.min(1, dt * 14);
    c.x = P.x; c.z = P.z; c.h = P.h; c.v = P.vx; c.y = P.y + P.dip; c.roll = P.roll; c.pitch = P.pitch + P.dip * .25; c.steer = P.steer;
    if (P.flashT > 0) P.flashT -= dt; if (!P.lightsManual) P.lightsOn = night > .42 && P.engineOn;
    c.lights.head = P.lightsOn || P.flashT > 0; c.lights.brake = P.brk > .05; c.lights.reverse = P.gear < 0 && P.engineOn;
  }
  function step(dt) {
    G.time += dt; G.phaseT += dt; const I = G.input; if (G.ap.on) apStep(dt);
    const st = ST(), ph = G.phase, drive = ph === 'wait' || ph === 'heat' || ph === 'clean' || !!(st && st.drive);     // st.drive: the playable prologue drives; st.hold: parked during a cinematic
    _inp.throttle = drive ? I.throttle : 0; _inp.brake = drive ? I.brake : (ph === 'end' && P.vx > 1 ? .8 : 0); _inp.steer = drive || ph === 'end' ? I.steer : 0; _inp.hand = ph === 'swap' || ph === 'end' || (st && st.hold) ? 1 : I.hand;
    if (P.car) { const n = Math.max(1, Math.ceil(dt * 240 - 1e-6)), h = dt / n; for (let i = 0; i < n; i++) { physStep(h, _inp); collideWorld(); collideCars(); } playerPost(dt); }
    if (ph === 'wait') waitStep(dt);
    if (G.phase === 'heat' || G.phase === 'swap' || G.phase === 'clean') wantedStep(dt);
    if (G.phase !== 'end') policeStep(dt); else for (const c of G.cops) { c.v *= Math.exp(-2 * dt); coast(c, dt); }
    trafficStep(dt); pedsStep(dt);
    if (G.phase === 'heat') swapStep(dt, I.holdF);
    if (G.phase === 'swap') hotwireStep(dt);
    if ((G.phase === 'heat' || G.phase === 'clean') && W.exitOpen && P.z < EXIT.z + 3.5 && Math.abs(P.x) < 10 && hyp(P.vx, P.vy) < 4) endRun('clean');
    subStep(dt);
    if (st) st.step(dt);
  }
  function idleStep(dt) { trafficStep(dt); for (const p of G.peds) pedStep(p, dt); if (P.car) playerPost(dt); }
  function handleEvent(type, d) {
    if (type === 'crash') crashHeat(d);
    if (G.probe) G.probe(type, d);
    const st = ST(); if (st && type === 'phase' && d.phase === 'end') { if (G.visual && document.exitPointerLock && CAM.locked) document.exitPointerLock(); hornSet(false); if (!G.silent && G.visual) audioEvent(type, d); st.onEnd(G.result); return; }   // the story shows its own mission card instead of the end screen
    if (G.silent || !G.visual) return;
    if (type === 'fade') HUD.fade();
    if (type === 'phase' && d.phase === 'end') { HUD.end(G.result); if (document.exitPointerLock && CAM.locked) document.exitPointerLock(); hornSet(false); }
    audioEvent(type, d);
  }

  /* ================================================================== world build, visuals sync, main loop */
  function buildMod(scene, name, fb) { let res = null, ok = false; const m = GT[name];
    if (m && m.build) { try { res = m.build(scene); ok = true; } catch (e) { warn(name + '.build', e); } }
    if (!ok) { try { res = fb(scene); } catch (e) { warn(name + ' placeholder', e); } G.mods[name] = m ? 'broken→placeholder' : 'placeholder'; } else G.mods[name] = 'ok'; return res; }
  function buildStation(scene) { const st = buildMod(scene, 'station', fbStation); G.stationState = (GT.station && GT.station.state) || (st && st.state) || { alarm: false, doorOpen: false }; }
  function buildDone() { for (const n of ['people', 'vehicles', 'cockpit', 'render', 'atmos', 'audio']) G.mods[n] = GT[n] ? 'ok' : 'placeholder'; G.mods.materials = GT.tex ? 'ok' : 'stub'; }
  const _focus = new T.Vector3();
  function syncVisuals(dt) {
    for (const c of G.cars) syncCar(c, dt); for (const p of G.peds) syncPed(p, dt);
    const ck = G.cockpit; if (ck && !ck.broken && ck.group.visible !== false) { const A = GT.audio, hrs = currentHours(), sp = hyp(P.vx, P.vy);
      const radioOn = !!(A && A.radioOn), stn = A && A.stations && A.stations[A.station];
      const lim = P.spec.steerMax / (1 + Math.pow(sp / 15, 1.5)) + .03, hh = Math.floor(hrs) % 24, mm = Math.floor((hrs % 1) * 60);
      try { ck.update(dt, { speed: sp, kmh: sp * 3.6, mph: sp * 2.237, rpm: clamp((P.rpm - 720) / 5500, 0, 1.1), rpmRaw: P.rpm, steer: -clamp(P.steer / lim, -1, 1) * lerp(1, .5, sstep(sp, 6, 32)) * (ck.placeholder ? -1 : 1),   // cockpit convention: + = clockwise (right); ours: + = left
        throttle: P.thr, brake: P.brk, handbrake: P.hand,
        gear: P.gear < 0 ? 'R' : (G.phase === 'wait' && sp < .3 && P.thr < .05 || !P.engineOn ? 'P' : 'D'), gearIndex: P.gear, fuel: .62 - P.odo * .00004, temp: .46 + P.damage * .42, night: (GT.env && GT.env.night) || 0, lights: !!P.car.lights.head, highBeam: P.flashT > 0,
        signal: null, mirror: false, radioOn, radioText: stn ? stn.name : (G.started ? 'CORAL 98.1' : ''), clock: (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm, wanted: W.stars, look: { yaw: CAM.yaw, pitch: CAM.pitch }, engineOn: P.engineOn, damage: P.damage, horn: !!G.input.horn, oilWarn: P.damage > .8 }); }
      catch (e) { ck.broken = true; warn('cockpit.update', e); } }
  }
  const MODUPD = ['road', 'station', 'motel'];
  function tick(dt) {
    const fx = GT.render && GT.render.fx;
    if (G.started && !G.paused && !G.freeze) {
      inputStep(dt);
      const want = G.input.focus && G.focusE > .02 && G.phase !== 'end' ? .32 : 1; G.slow += (want - G.slow) * Math.min(1, dt * 8);
      if (want < 1) G.focusE = Math.max(0, G.focusE - dt / 5); else G.focusE = Math.min(1, G.focusE + dt / 14);
      step(Math.min(dt, 1 / 30) * G.slow * (G.phase === 'end' ? .4 : 1));
    } else if (!G.started) idleStep(dt);
    G.endT = G.phase === 'end' ? (G.endT || 0) + dt : 0;
    const vdt = G.paused || G.freeze ? 0 : dt * G.slow;
    if (fx) fx.focus = clamp((1 - G.slow) / .68, 0, 1);
    syncVisuals(vdt); cameraStep(dt);
    if (G.atmosOn) { const hrs = currentHours(), A = GT.atmos; A.timeScale = (G.started && !G.paused && G.fixedHours === null && G.holdHours === null && hrs < 21.39) ? TS * G.slow : 0; if (Math.abs(hrs - A.hours) > .012) A.setTime(hrs); try { A.update(dt, _focus.set(P.x, 0, P.z)); } catch (e) { if (!G.atmosErr) { G.atmosErr = true; warn('atmos.update', e); } } }
    for (const n of MODUPD) { const m = GT[n]; if (m && m.update && !G.mods[n + 'UpdErr']) { try { m.update(vdt); } catch (e) { G.mods[n + 'UpdErr'] = true; warn(n + '.update', e); } } }
    audioStep(dt); HUD.update(dt);
    if (G.useFx) GT.render.frame(G.scene, G.camera, dt);
    else { const r = G.renderer, w = innerWidth, h = innerHeight; if (G.rw !== w || G.rh !== h) { G.rw = w; G.rh = h; r.setSize(w, h, false); G.camera.aspect = w / h; G.camera.updateProjectionMatrix(); } r.render(G.scene, G.camera); }
  }
  function setupAuto() {
    const A = G.ap, Q = G.Q, at = Q.get('at') !== null ? +Q.get('at') : null; let until = null;
    switch (G.auto) {
      case 'wait': A.honkAt = 1e9; until = () => R.t >= (at || 24) || G.phase !== 'wait'; break;
      case 'honk': A.honkAt = 19; until = () => (R.stage === 'runout' && G.partner.x < G.pt.door[0] + (at || .25)) || G.phase !== 'wait'; break;
      case 'drive': A.plan = 'calm'; A.honkAt = 19; until = () => G.time >= (at || 52) || G.phase === 'end'; break;
      case 'chase': A.plan = 'chase'; A.honkAt = 49; until = () => G.time >= (at || 80) || G.phase === 'end'; break;
      case 'swap': A.plan = 'calm'; A.honkAt = 19; A.freezeHW = true; until = () => G.phase === 'swap' && HW.stage >= 1 && G.phaseT > (at || 2.4); break;
      case 'busted': A.plan = 'busted'; A.honkAt = 49; until = () => G.phase === 'end' && G.phaseT > 1.6; break;
      case 'clean': A.plan = 'calm'; A.honkAt = 19; until = () => G.phase === 'end' && G.phaseT > 1.6; break;
      default: G.auto = null; return;
    }
    A.on = true; A.sig = Q.get('sig') === 'flash' ? 'flash' : 'honk'; G.started = true; HUD.show('title', false); CAM.pitchT = CAM.pitch = -.05;
    const def = { wait: [-58, -2], honk: [-66, -3], swap: [8, 2] }[G.auto]; if (def) { CAM.yawT = CAM.yaw = def[0] * PI / 180; CAM.pitchT = CAM.pitch = def[1] * PI / 180; CAM.fixedLook = true; }
    G.silent = true; let n = 0; while (!until() && n++ < 60 * 900) step(1 / 60); G.silent = false; G.autoSteps = n;
    if (G.phase === 'end') HUD.end(G.result);
    G.freeze = Q.get('freeze') === '1' || (G.auto === 'honk' && Q.get('freeze') !== '0');
  }
  function boot(o) {
    const Q = G.Q = o.query || new URLSearchParams(location.search);
    G.canvas = o.canvas; G.hudRoot = o.hud; G.seed = Q.get('seed') || 1; G.auto = Q.get('auto'); G.fixedHours = Q.get('t') !== null && isFinite(+Q.get('t')) ? +Q.get('t') : null; G.showPassenger = Q.get('passenger') !== '0';
    if (Q.get('selftest') === '1') return selftest(o);
    // the boot is a list of labelled steps: run back to back here, or one per frame behind the loading screen when js/story.js owns the flow
    const steps = bootPlan(o);
    if (GT.story && GT.story.boot && GT.story.wants && safe('story.wants', () => GT.story.wants(Q), false)) { G.storyOn = true; return GT.story.boot({ steps, finish: bootFinish, canvas: o.canvas, hud: o.hud, query: Q }); }
    for (const s of steps) s[1](); bootFinish();
  }
  function bootPlan(o) {
    const Q = G.Q; let scene, camera;
    return [
      ['render', () => { scene = G.scene = new T.Scene(); camera = G.camera = new T.PerspectiveCamera(60, innerWidth / innerHeight, .07, 3000);
        G.useFx = false;
        if (Q.get('fx') !== '0' && GT.render && GT.render.init) G.useFx = safe('render.init', () => { GT.render.init({ canvas: o.canvas, scene, camera }); return true; }, false);
        if (!G.useFx) { const r = G.renderer = new T.WebGLRenderer({ canvas: o.canvas, antialias: true }); r.setPixelRatio(Math.min(1.5, devicePixelRatio || 1)); r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap; } }],
      ['atmos', () => { G.atmosOn = false;
        if (GT.atmos && GT.atmos.init && Q.get('atmos') !== '0') G.atmosOn = safe('atmos.init', () => { GT.atmos.init({ scene, camera, renderer: G.renderer || (GT.render && GT.render.renderer) }); return true; }, false);
        if (!G.atmosOn) { scene.background = new T.Color(0x9fb4c8); const sun = new T.DirectionalLight(0xffd2a0, 3); sun.position.set(-40, 18, 12); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 }); sun.shadow.bias = -.0005; scene.add(sun, new T.HemisphereLight(0xbcd0ff, 0x8a7a66, .9)); } }],
      ['road', () => { buildPaths(); buildMod(scene, 'road', fbRoad); }],
      ['station', () => buildStation(scene)],
      ['motel', () => { buildMod(scene, 'motel', fbMotel); buildDone(); gridBuild(); }],
      ['cast', () => { HUD.init(o.hud); if (Q.get('hud') === '0') o.hud.classList.add('off');
        G.onEvent = handleEvent; bindInput();
        if (Q.get('cam') === 'chase') CAM.mode = 'chase'; if (Q.get('mirror') === '0') G.noMirror = true;
        startRun(); }]
    ];
  }
  function bootFinish() {
    const Q = G.Q;
    if (ST()) { /* js/story.js decides what happens after the world is up (menu, cold open, ?auto= story states) */ } else if (G.auto) setupAuto(); else HUD.show('title', true);
    if (Q.get('look')) { const a = Q.get('look').split(',').map(Number); CAM.yawT = CAM.yaw = (a[0] || 0) * PI / 180; CAM.pitchT = CAM.pitch = (a[1] || 0) * PI / 180; CAM.fixedLook = true; }
    if (G.atmosOn) safe('atmos.setTime', () => GT.atmos.setTime(currentHours()));
    if (G.warnings.length && (G.auto || Q.get('debug'))) fail('[game] ' + G.warnings.join('\n[game] '));
    let last = performance.now(), frames = 0, shown = G.warnings.length;
    (function loop(now) { const dt = clamp((now - last) / 1000, .001, .05); last = now;
      try { tick(dt); } catch (e) { if (frames < 4 || !G.tickErr) { G.tickErr = true; fail('frame threw: ' + (e.stack || e)); } }
      if (G.warnings.length > shown && (G.auto || Q.get('debug'))) { fail('[game] ' + G.warnings.slice(shown).join('\n[game] ')); shown = G.warnings.length; }
      if (++frames === 12) document.title = 'BILIBILI THEFT AUTO 1'; requestAnimationFrame(loop); })(last);
  }

  /* ================================================================== headless logic self-test: index.html?selftest=1 */
  function headless() { G.visual = false; G.silent = true; G.started = true; G.onEvent = handleEvent; if (!GT.world.boxes.length) fbCollidersOnly(); buildPaths(); gridBuild(); G.stationState = { alarm: false, doorOpen: false }; }
  function selftest(o) {
    const out = [], pre = document.createElement('pre'); pre.id = 'selftest'; document.body.appendChild(pre);
    const line = (ok, msg) => { out.push((ok === null ? 'INFO  ' : ok ? 'PASS  ' : 'FAIL  ') + msg); };
    headless();
    const run = (plan, honkAt, maxT, sig) => { startRun(); Object.assign(G.ap, { on: true, plan, honkAt, sig: sig || 'honk', stage: 0, honked: false, freezeHW: false, path: null }); const seen = {}; let maxV = 0, nan = false, t0 = performance.now(), prev = G.phase; seen[prev] = 0;
      while (G.phase !== 'end' && G.time < maxT) { step(1 / 60); if (G.phase !== prev) { prev = G.phase; seen[prev] = +G.time.toFixed(1); } if (R.stage === 'runout' && seen.runout === undefined) seen.runout = +G.time.toFixed(1); maxV = Math.max(maxV, Math.abs(P.vx)); if (!isFinite(P.x + P.z + P.h + P.vx + P.vy + P.r)) { nan = true; break; } }
      return { seen, maxV, nan, ms: Math.round(performance.now() - t0), res: G.result, t: G.time }; };
    try {
      // 1. physics sanity on an empty stretch of highway
      startRun(); G.ap.on = false; P.x = -3; P.z = -200; P.h = 0; P.vx = P.vy = P.r = 0; let t = 0, t100 = null; const I = { throttle: 1, brake: 0, steer: 0, hand: 0 };
      while (t < 10) { physStep(1 / 240, I); t += 1 / 240; if (t100 === null && P.vx >= 27.78) t100 = t; }
      line(t100 !== null && t100 > 3 && t100 < 9, 'physics: 0-100 km/h in ' + (t100 === null ? 'never' : t100.toFixed(2) + ' s') + ', ' + (P.vx * 3.6).toFixed(0) + ' km/h after 10 s, gear ' + P.gear + ', lateral drift ' + Math.abs(P.x + 3).toFixed(2) + ' m');
      const z0 = P.z, v0 = P.vx; I.throttle = 0; I.brake = 1; t = 0; while (P.vx > .3 && t < 12) { physStep(1 / 240, I); t += 1 / 240; }
      line(t < 8, 'physics: brakes ' + (v0 * 3.6).toFixed(0) + '->0 km/h in ' + (P.z - z0).toFixed(0) + ' m / ' + t.toFixed(1) + ' s (' + (v0 * v0 / 2 / (P.z - z0) / 9.81).toFixed(2) + ' g)');
      P.x = 60; P.z = 0; P.h = 0; P.vx = 16; P.vy = P.r = 0; P.gear = 2; I.brake = 0; I.throttle = .35; I.steer = 1; t = 0; let latMax = 0; while (t < 5) { physStep(1 / 240, I); t += 1 / 240; latMax = Math.max(latMax, Math.abs(P.ayS)); }
      line(latMax > 6 && latMax < 13 && isFinite(P.r), 'physics: full-lock corner at ~58 km/h peaks at ' + (latMax / 9.81).toFixed(2) + ' g lateral, yaw rate ' + P.r.toFixed(2) + ' rad/s, slip ' + (Math.atan2(P.vy, P.vx) * 57.3).toFixed(1) + ' deg');
      P.vx = 18; P.vy = P.r = 0; I.steer = .6; I.hand = 1; I.throttle = 0; t = 0; const h0 = P.h; while (t < 1.6) { physStep(1 / 240, I); t += 1 / 240; }
      line(Math.abs(P.h - h0) > .6, 'physics: handbrake turn rotates the car ' + ((P.h - h0) * 57.3).toFixed(0) + ' deg in 1.6 s (tail steps out)');
      // 2. calm run: honk early -> flee -> swap -> clean
      let r = run('calm', 19, 420);
      line(!r.nan, 'calm run: no NaN in player state (' + r.ms + ' ms for ' + r.t.toFixed(0) + ' sim-seconds)');
      line(r.seen.runout !== undefined, 'calm run: honk at 19 s calls the partner out (runout @ ' + r.seen.runout + ' s)');
      line(r.seen.heat !== undefined, 'calm run: partner gets in, HEAT starts @ ' + r.seen.heat + ' s, take ' + money(R.take));
      line(r.seen.swap !== undefined, 'calm run: reaches motel and starts hot-wire @ ' + r.seen.swap + ' s');
      line(r.seen.clean !== undefined && W.swapped && !W.chips.car.valid, 'calm run: swap completes @ ' + r.seen.clean + ' s, CAR chip no longer valid');
      line(!!r.res && r.res.result === 'clean' && r.res.take > 0, 'calm run: banks the take -> ' + (r.res ? r.res.result + ' ' + money(r.res.take) + ' rank ' + r.res.rank + ' peak ' + r.res.peak + '* in ' + r.res.time.toFixed(0) + ' s' : 'no result (phase ' + G.phase + ', stars ' + W.stars.toFixed(2) + ', pos ' + P.x.toFixed(0) + ',' + P.z.toFixed(0) + ', ap ' + G.ap.stage + ')'));
      line(null, 'calm run: chips face/car/plate on file = ' + [W.chips.face.on, W.chips.car.on, W.chips.plate.on].join('/') + ', damage ' + (P.damage * 100).toFixed(0) + '%, top speed ' + (r.maxV * 3.6).toFixed(0) + ' km/h');
      // 3. silent run: flash the lights early -> nobody has a description
      r = run('calm', 12, 420, 'flash');
      line(r.seen.heat !== undefined && !W.chips.car.on, 'flash run: silent signal at the register leaves no CAR description (heat @ ' + r.seen.heat + ' s, take ' + money(R.take) + ')');
      line(null, 'flash run: result ' + (r.res ? r.res.result + ' ' + money(r.res.take) + ' rank ' + r.res.rank : 'none, phase ' + G.phase) + ' @ ' + r.t.toFixed(0) + ' s');
      // 4. greedy run + stopping: alarm, pursuit, busted
      r = run('busted', 1e9, 300);
      line(R.alarm || R.copSaw || R.walkerSaw, 'greedy run: staying for the whole safe gets you noticed (alarm: ' + (R.alarmHow || 'no') + ', patrol saw him: ' + R.copSaw + ', customer saw him: ' + R.walkerSaw + ', nerve ' + R.nerve.toFixed(2) + ', take ' + money(R.take) + ')');
      line(W.peak >= 2, 'greedy run: wanted level rises (peak ' + W.peak.toFixed(1) + ' stars, ' + G.cops.length + ' cruisers)');
      line(!!r.res && r.res.result === 'busted', 'greedy run: stopping beside a cruiser -> ' + (r.res ? r.res.result + ' @ ' + r.res.time.toFixed(0) + ' s' : 'no result (hot ' + W.hot + ', stars ' + W.stars.toFixed(1) + ', nearest ' + (W.nearest || 0).toFixed(0) + ' m)'));
      // 5. chase run: loop the block with cruisers behind, then the motel
      r = run('chase', 49, 200);
      line(!r.nan && W.peak >= 2 && W.hotTime > 5, 'chase run: pursued for ' + W.hotTime.toFixed(0) + ' s, peak ' + W.peak.toFixed(1) + ' stars, ' + G.cops.length + ' cruisers, damage ' + (P.damage * 100).toFixed(0) + '%, top ' + (r.maxV * 3.6).toFixed(0) + ' km/h, phase ' + G.phase + (r.res ? ' -> ' + r.res.result : ''));
      // 6. breaking line of sight: pursued, then hidden behind the motel wing -> cruisers lose you and fall back to a search
      startRun(); Object.assign(G.ap, { on: true, plan: 'chase', honkAt: 1e9, sig: 'honk', stage: 0, honked: false, path: null }); let lost = false; G.probe = (ty) => { if (ty === 'lost') lost = true; };
      while (G.phase !== 'end' && !W.hot && G.time < 120) step(1 / 60); const hotAt = G.time, s0 = W.stars;
      G.ap.on = false; G.input.throttle = G.input.brake = G.input.steer = 0; G.input.hand = 1; const hide = () => { P.x = L.motel.wingE.x1 + 9; P.z = (L.motel.wingE.z0 + L.motel.wingE.z1) / 2; P.vx = P.vy = P.r = 0; }; hide(); for (const c of G.cops) { c.x = 3; c.z = -120; }
      let tt = 0; while (G.phase !== 'end' && tt < 60 && (W.hot || W.stars > 1.01)) { step(1 / 60); tt += 1 / 60; if (tt < 1) hide(); } G.probe = null;
      line(hotAt < 120 && lost && !W.hot, 'hide run: hot @ ' + hotAt.toFixed(0) + ' s with ' + s0.toFixed(1) + ' stars; out of sight behind the motel -> lost after ' + tt.toFixed(0) + ' s, now ' + W.stars.toFixed(1) + ' stars, ' + G.cops.filter(c => c.cop.state === 'search' || c.cop.state === 'respond').length + '/' + G.cops.length + ' cruisers searching, phase ' + G.phase);
      // 7. story flow (js/story.js): fresh start with skips -> wait, prologue arrivals, busted -> checkpoint, clean -> stinger -> menu
      if (GT.story && GT.story.selftest) GT.story.selftest(line, { run }); else line(null, 'story: js/story.js not loaded, story cases skipped');
    } catch (e) { line(false, 'self-test threw: ' + (e.stack || e)); }
    G.storyOn = false;
    const fails = out.filter(l => l.indexOf('FAIL') === 0).length;
    pre.textContent = 'BILIBILI THEFT AUTO 1 — logic self-test (headless simulation, 60 Hz fixed step)\n\n' + out.join('\n') + '\n\n' + (fails ? fails + ' FAILED' : 'ALL PASS') + (G.warnings.length ? '\nwarnings: ' + G.warnings.join(' | ') : '');
    document.title = fails ? 'selftest FAIL' : 'selftest PASS'; G.selftest = out; return out;
  }

  /* ================================================================== exports */
  GT.game = {
    /** boot({canvas, hud, query?: URLSearchParams}) — build the world, start the loop (called by index.html) */
    boot,
    /** step(dt) — advance the whole simulation by dt seconds (no rendering) */
    step,
    /** restart() — new run from WAIT;  begin() — leave the title screen */
    restart, begin: beginPlay,
    /** signal('honk'|'flash'), say(lineKey), endRun('clean'|'busted'|'abandon') */
    signal, say, endRun,
    /** autopilot(plan: 'calm'|'chase'|'busted'|false, honkAt?: seconds) */
    autopilot(plan, honkAt) { Object.assign(G.ap, { on: !!plan, plan: plan || 'calm', honkAt: honkAt === undefined ? 19 : honkAt, stage: 0, honked: false, path: null, yieldT: 0, freezeHW: false }); if (!plan) { const I = G.input; I.throttle = I.brake = I.steer = I.hand = 0; I.holdF = false; } },
    selftest,
    /** live state for debugging: GT.game.state.phase, .player (P), .heist (R), .wanted (W), .hotwire (HW), .cars, .cops, .peds */
    get state() { return { phase: G.phase, time: G.time, hours: currentHours(), player: P, heist: R, wanted: W, hotwire: HW, cars: G.cars, cops: G.cops, peds: G.peds, mods: G.mods, warnings: G.warnings, camera: CAM, result: G.result, events: G.events }; },
    /** headless() — set the module up for simulation without a renderer (self-test / node); startRun() — reset to WAIT */
    headless, startRun,
    G, paths: PATHS, los, surface, hud: HUD,
    /** internals for js/story.js (the director): live objects + the helpers it reuses instead of duplicating them */
    x: { P, R, W, HW, CAM, HUD, SUB, KEY, EXIT, LINES, startRun, mkPed, pedGo, mkCar, removeCar, setPlayerCar, attachCockpit, placePlayer, partnerDoorPos, apRoute, apFollow, setPause, lockPointer, hornSet, anchor, groundY, emit, currentHours, money, makeFigure, nearBoxes, mkPath, pathAt }
  };
  GT.showcase.game = ({ scene }) => {
    const k = GT.kit(); k.box('asphalt_worn', 30, .2, 30, 0, -.1, 0); scene.add(k.build()); const v = fbVehicle('hero', { color: 0x6e1a18 }); scene.add(v.group); const c = fbVehicle('cruiser', {}); c.group.position.set(-3.2, 0, -5.5); c.setLights({ siren: 1, head: 1 }); scene.add(c.group);
    const p = fbPerson('partner'); p.group.position.set(-1.8, 0, 1); scene.add(p.group);
    return { cam: [5.2, 1.7, 6], look: [-.6, .7, -1.2], hours: 18.4, update(dt) { c.update(dt); p.update(dt, { state: 'idle', speed: 0 }); } };
  };
})();
