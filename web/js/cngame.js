/* cngame.js — BILIBILI THEFT AUTO 1: boot flow, main loop, third-person play, e-scooter / bike / car models, traffic on GT.cnroad lanes,
   the wanted system + police AI, cash ($), HUD. Free roam only (g7, 2026-11-17): the story, the delivery jobs and the debt are gone — js/cnstory.js, js/cntrailer.js,
   js/opening.js, js/economy.js and js/vo.js live in _archive/2026-11-17-story/. The hooks that used to reach them are still feature-detected, so nothing breaks without them.
   Start: gate → studio logo → menu (开始游戏 / 继续 / 设置 / 退出) → loading art → on foot in the street beside a car you can drive, $500 in the pocket.
   Page: cn.html, styles: css/cn.css. Exposes GT.cngame (API block at the bottom of this file).

   URL: ?auto=<state>   menu | load | free | foot | cross | ride | fall | bike | car | carchase | wanted | busted | market | room | noodle | hotpot | lobby | warehouse | shop
        &at=<seconds of simulation to fast-forward>   &t=<hours, fixed time of day>   &px=&pz=&ph=<deg> (hero placement, on-foot states)   &yaw=<deg>&pitch=<deg> (camera)
        &hud=0   &fx=0   &atmos=0   &only=a,b,c (cn.html: load fewer modules)   &pop=0 (no pedestrians)   &traffic=0   &view=1 (first person; third person is the default)   &partner=1   &debug=1   &selftest=1 (headless logic test)
   Every other module is feature-detected and wrapped in try/catch; a missing or broken one is replaced by a GT.kit placeholder so the loop always runs.
   Conventions (core.js): heading h, forward = (sin h, 0, cos h), LEFT = (cos h, 0, -sin h). Vehicle-local: +Z forward, +X left. */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!GT) return;
  const L = GT.L, CN = GT.CN;
  const { clamp, lerp, sstep, angDiff, TAU } = GT;
  const hyp = Math.hypot, PI = Math.PI, sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max;
  const fail = m => { if (window.GTfail) window.GTfail(m); else console.error(m); };
  const warn = (label, e) => { if (window.console) console.warn('[cngame] ' + label, e); const s = label + ': ' + (e && e.message || e); if (G.warnings.indexOf(s) < 0 && G.warnings.length < 40) G.warnings.push(s); };
  const safe = (label, fn, fb) => { try { return fn(); } catch (e) { warn(label, e); return fb; } };
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const money = n => '$' + (Math.round(n * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 1 : 0, maximumFractionDigits: 1 });
  const clock = h => { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; };
  const mmss = s => { s = max(0, Math.ceil(s)); return (s / 60 | 0) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); };

  /* ================================================================== state */
  const G = {
    Q: new URLSearchParams(''), visual: true, warnings: [], mods: {}, bad: {}, events: [],
    scene: null, camera: null, canvas: null, hudRoot: null, renderer: null, useFx: false, atmosOn: false,
    time: 0, phase: 'boot', started: false, paused: false, freeze: false, auto: null, story: false,
    hours: 7.5, holdHours: null, fixedHours: null, dayRate: 1 / 150,                       // one game hour = 2.5 real minutes
    ents: [], traffic: [], cops: [], seq: 0, vehDirty: false,
    hp: 100, battery: 1, ap: { on: false, thr: 0, steer: 0, brake: false, path: null, s: 0, speed: 9 },
    ctl: null, kai: null, lie: null, hero: null, scooter: null, pop: null, cockpit: null, cine: null, tk: null
  };
  /** the player, whatever he is doing. mode: 'foot' | 'two' (riding) | 'car' | 'exit' (stepping out). x/z/h/y are refreshed every step. */
  const P = { mode: 'foot', x: 26, z: 62, y: 0, h: PI, speed: 0, vx: 0, vz: 0, ent: null, down: 0, lastHitT: -9, lastOffT: -99, jay: false, onRoad: false, indoor: false, outfit: 'rider', mask: false, zone: '', inside: false, wetT: 0 };
  let rnd = GT.rng('cngame1');

  /* ---- events: GT.cngame.on(evt, cb) -> off(). A listener returning true marks the event as handled (the default reaction is skipped). */
  const LST = {};
  function on(evt, cb) { if (typeof cb !== 'function') return () => {}; (LST[evt] = LST[evt] || []).push(cb); return () => { const a = LST[evt], i = a ? a.indexOf(cb) : -1; if (i >= 0) a.splice(i, 1); }; }
  function emit(type, data) {
    data = data || {}; G.events.push({ type, t: +G.time.toFixed(2) }); if (G.events.length > 300) G.events.splice(0, 100);
    let handled = false; const a = LST[type]; if (a) for (const cb of a.slice()) { try { if (cb(data) === true) handled = true; } catch (e) { warn('listener ' + type, e); } }
    const b = LST['*']; if (b) for (const cb of b.slice()) { try { cb(type, data); } catch (e) { warn('listener *', e); } }
    if (G.visual && !G.silent) audioEvent(type, data);
    return handled;
  }

  /* ================================================================== paths (lane centre lines; adapted from js/game.js) */
  function mkPath(pts, rad, closed) {
    const raw = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (!rad || (!closed && (i === 0 || i === n - 1))) { raw.push([p[0], p[1]]); continue; }
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], la = hyp(p[0] - a[0], p[1] - a[1]), lb = hyp(b[0] - p[0], b[1] - p[1]), r = min(rad, la * .45, lb * .45);
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
  function pathAdvance(path, s, x, z) {
    let best = 1e18, bs = s;
    for (let k = -2; k <= 14; k += 1) { const q = pathAt(path, s + k, _pa), dd = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z); if (dd < best) { best = dd; bs = s + k; } }
    if (path.closed) bs = ((bs % path.len) + path.len) % path.len; else bs = clamp(bs, 0, path.len);
    return bs;
  }
  const PATHS = {};
  function buildPaths() {
    const lanes = GT.cnroad && GT.cnroad.lanes, by = id => { const l = lanes && (lanes.byId ? lanes.byId(id) : lanes.find(q => q.id === id)); return l && l.pts && l.pts.length >= 4 ? l.pts : null; };
    const cs = L.crossS.z, cn = L.crossN.z, bx = L.backRoad.x;
    const mk = (id, fb, rad) => { const pts = by(id); if (pts && isFinite(pts[0].x + pts[0].z)) { G.mods.lanes = 'cnroad'; return mkPath(pts.map(q => [q.x, q.z]), 0, true); } return mkPath(fb, rad, true); };
    PATHS.loopA = mk('outer', [[-2, cs - 2.25], [-2, cn + 2.25], [bx + 2.25, cn + 2.25], [bx + 2.25, cs - 2.25]], 11);     // northbound on the avenue (x < 0), outside of the loop
    PATHS.loopB = mk('inner', [[2, cn - 2.25], [2, cs + 2.25], [bx - 2.25, cs + 2.25], [bx - 2.25, cn - 2.25]], 7);         // southbound (x > 0)
    PATHS.bikeA = mk('bikeOuter', [[-6.85, cs - 3.6], [-6.85, cn + 3.6], [bx + 3.6, cn + 3.6], [bx + 3.6, cs - 3.6]], 9);
    PATHS.bikeB = mk('bikeInner', [[6.85, cn - 3.5], [6.85, cs + 3.5], [bx - 3.5, cs + 3.5], [bx - 3.5, cn - 3.5]], 5);
    // buses keep to the kerb-side lane on the avenue (x = ∓4.9) and share the side streets with everyone else
    const CT = !!(GT.chinatown && GT.chinatown.active), kerb = (path, sx) => CT ? path : mkPath(path.p.slice(0, -1).map(q => (abs(q[0] - sx * 2) < .3 && abs(q[1]) <= 138) ? [sx * 4.9, q[1]] : q), 0, true);   /* ?world=ct: one lane each way, buses stay in it */
    PATHS.busA = kerb(PATHS.loopA, -1); PATHS.busB = kerb(PATHS.loopB, 1);
    const bs = lanes && lanes.busStops; G.busStops = (Array.isArray(bs) && bs.length ? bs : [{ x: 5.4, z: 34, h: PI }, { x: -5.4, z: 22, h: 0 }]).map(b => ({ x: b.x, z: b.z, dir: b.x > 0 ? -1 : 1 }));
  }

  /* ================================================================== signals (GT.cnroad.signals, or a tiny stand-in with the same cycle) */
  const FBSIG = { time: 0, cycle: 43, crossings: [-8, 62], stopLines: [],
    at(zc) { const t = ((this.time + (zc > 20 ? 9 : 0)) % 43 + 43) % 43; if (t < 20) return { car: 'green', ped: 'dont', t: 25 - t }; if (t < 23) return { car: 'amber', ped: 'dont', t: 25 - t }; if (t < 25) return { car: 'red', ped: 'dont', t: 25 - t }; if (t < 36) return { car: 'red', ped: 'walk', t: 41 - t }; if (t < 41) return { car: 'red', ped: 'flash', t: 41 - t }; return { car: 'red', ped: 'dont', t: 68 - t }; },
    state(z) { const zc = abs(z + 8) < abs(z - 62) ? -8 : 62, s = this.at(zc); s.z = zc; return s; },
    stopFor(z, dir) { let best = null; for (const zc of this.crossings) { const zs = zc - dir * 5.6, d = (zs - z) * dir; if (d > -1 && (!best || d < best.dist)) best = { z: zs, dist: d, crossing: zc, car: this.at(zc).car }; } return best; },
    update(dt) { this.time += dt; } };
  for (const zc of FBSIG.crossings) { FBSIG.stopLines.push({ crossing: zc, z: zc - 5.6, dir: 1, x0: -7.5, x1: 0 }, { crossing: zc, z: zc + 5.6, dir: -1, x0: 0, x1: 7.5 }); }
  const SIG = () => (GT.cnroad && GT.cnroad.signals && !G.bad.sig && GT.cnroad.signals) || FBSIG;
  const sigState = z => { let s = null; const S = SIG(); try { s = S.state(z); } catch (e) { G.bad.sig = 1; warn('signals.state', e); } return s || FBSIG.state(z); };
  const sigStop = (z, dir) => { const S = SIG(); try { return S.stopFor(z, dir); } catch (e) { G.bad.sig = 1; warn('signals.stopFor', e); return FBSIG.stopFor(z, dir); } };
  const stopLines = () => { const S = SIG(); return (S.stopLines && S.stopLines.length ? S.stopLines : FBSIG.stopLines); };

  /* ================================================================== world queries: ground, surface, water, colliders, line of sight */
  function fbGround(x, z) { if (x < -60) return -2.6; const ax = abs(x); if (ax <= 7.5) return 0; if ((x < 0 && x > -58) || (x > 0 && x < 14)) return .15; return 0; }
  function groundY(x, z, y) {
    let g = 0, got = false;
    if (x <= -10 && GT.riverside && GT.riverside.groundHeight && !G.bad.rvG) { try { g = GT.riverside.groundHeight(x, z, y === undefined ? P.y + .3 : y); got = isFinite(g) && g !== 0; } catch (e) { G.bad.rvG = 1; warn('riverside.groundHeight', e); } }
    if (!got) { if (GT.cnroad && GT.cnroad.groundHeight && !G.bad.rdG) { try { g = GT.cnroad.groundHeight(x, z); } catch (e) { G.bad.rdG = 1; warn('cnroad.groundHeight', e); g = fbGround(x, z); } } else g = fbGround(x, z); }
    if (!isFinite(g)) g = 0;
    if (GT.snackstreet && x > 14 && x < 50 && z > -30 && z < 13.8 && g < .04) g = .04;
    return g;
  }
  const inWater = (x, z) => { if (GT.riverside && GT.riverside.inWater && !G.bad.rvW) { try { return !!GT.riverside.inWater(x, z); } catch (e) { G.bad.rvW = 1; } } return x < -60.5; };
  const inRoad = (x, z) => { if (GT.cnroad && GT.cnroad.inRoad && !G.bad.rdR) { try { return !!GT.cnroad.inRoad(x, z); } catch (e) { G.bad.rdR = 1; } } return abs(x) < 7.5 && abs(z) < 170; };
  const onCrossing = (x, z) => { if (GT.cnroad && GT.cnroad.onCrossing && !G.bad.rdC) { try { return GT.cnroad.onCrossing(x, z); } catch (e) { G.bad.rdC = 1; } } for (const zc of FBSIG.crossings) if (abs(z - zc) < 2.6 && abs(x) < 7.6) return zc; return null; };
  const SURF = { asphalt: [1, 0], paver: [.94, 0], concrete: [.97, 0], water: [.35, 7], dirt: [.74, .6] }, _surf = { grip: 1, drag: 0, name: 'asphalt' };
  function surface(x, z) { let s = 'asphalt'; if (GT.cnroad && GT.cnroad.surfaceAt && !G.bad.rdS) { try { s = GT.cnroad.surfaceAt(x, z) || 'asphalt'; } catch (e) { G.bad.rdS = 1; } } if (inWater(x, z)) s = 'water';
    const v = SURF[s] || SURF.asphalt; _surf.grip = v[0] * (1 - .12 * ((GT.env && GT.env.wet) || 0)); _surf.drag = v[1]; _surf.name = s; return _surf; }
  /* uniform grid over GT.world.boxes for the collision broadphase */
  const GRID = { cell: 12, map: new Map(), n: -1, stamp: 0, out: [] };
  function gridBuild() {
    GRID.map.clear(); const B = GT.world.boxes; GRID.n = B.length;
    for (const b of B) { if (!(b.x1 > b.x0) || !(b.z1 > b.z0)) continue; b._cs = 0; if (b.x1 - b.x0 > 500 || b.z1 - b.z0 > 500) continue;
      for (let cx = Math.floor(b.x0 / GRID.cell); cx <= Math.floor(b.x1 / GRID.cell); cx++) for (let cz = Math.floor(b.z0 / GRID.cell); cz <= Math.floor(b.z1 / GRID.cell); cz++) { const k = cx * 4096 + cz; let a = GRID.map.get(k); if (!a) GRID.map.set(k, a = []); a.push(b); } }
  }
  function nearBoxes(x, z, r) {
    if (GRID.n !== GT.world.boxes.length) gridBuild();
    const out = GRID.out; out.length = 0; const st = ++GRID.stamp, c = GRID.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) for (let cz = Math.floor((z - r) / c); cz <= Math.floor((z + r) / c); cz++) { const a = GRID.map.get(cx * 4096 + cz); if (!a) continue; for (const b of a) if (b._cs !== st) { b._cs = st; out.push(b); } }
    return out;
  }
  /** boxes a wheeled thing can roll over or through: kerbs, floors, steps, and anything flagged passable */
  const FLOORISH = /stair|step|ramp|dock|platform|kerb|curb|floor|deck|podium|stage|pier|terrace/;
  const solidFor = (b, minH) => b.h >= minH && !b.passable && !(b.tag && FLOORISH.test(b.tag) && b.h < 1.2);
  /** true if nothing taller than minH blocks the segment (2D slab test) */
  function los(ax, az, bx, bz, minH) {
    minH = minH === undefined ? 1.6 : minH; const dx = bx - ax, dz = bz - az, len = hyp(dx, dz); if (len < .01) return true;
    if (GRID.n !== GT.world.boxes.length) gridBuild();
    const steps = Math.ceil(len / (GRID.cell * .45)) + 1, st = ++GRID.stamp;
    for (let i = 0; i <= steps; i++) { const t = i / steps, a = GRID.map.get(Math.floor((ax + dx * t) / GRID.cell) * 4096 + Math.floor((az + dz * t) / GRID.cell)); if (!a) continue;
      for (const b of a) { if (b._cs === st) continue; b._cs = st; if (b.h < minH || b.x1 - b.x0 < .5 && b.z1 - b.z0 < .5) continue;
        if ((ax > b.x0 && ax < b.x1 && az > b.z0 && az < b.z1) || (bx > b.x0 && bx < b.x1 && bz > b.z0 && bz < b.z1)) continue;
        let t0 = 0, t1 = 1;
        if (abs(dx) < 1e-9) { if (ax < b.x0 || ax > b.x1) continue; } else { let u = (b.x0 - ax) / dx, v = (b.x1 - ax) / dx; if (u > v) { const w = u; u = v; v = w; } if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) continue; }
        if (abs(dz) < 1e-9) { if (az < b.z0 || az > b.z1) continue; } else { let u = (b.z0 - az) / dz, v = (b.z1 - az) / dz; if (u > v) { const w = u; u = v; v = w; } if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) continue; }
        return false; } }
    return true;
  }
  const anchor = (names, fb) => { for (const n of [].concat(names)) { const a = GT.world.anchors[n]; if (a && isFinite(a.x) && isFinite(a.z)) return a; } return fb; };
  const ZNAME = [['wharf', '码头仓库'], ['market', '夜市'], ['snack', '小吃街'], ['hotpot', '辣姐火锅'], ['courtyard', '六十七号院'], ['tenement', '筒子楼'], ['clock', '钟楼洋行'], ['promenade', '江滩']];
  function zoneName(x, z) { if (GT.chinatown && GT.chinatown.active && GT.chinatown.zoneName) return GT.chinatown.zoneName(x, z); for (const [k, nm] of ZNAME) { const r = CN[k]; if (r && x >= r.x0 && x <= r.x1 && (r.z0 === undefined || (z >= r.z0 && z <= r.z1))) return nm; }
    const b = CN.rail.building; if (x > b.x0 - 4 && x < b.x1 + 16 && z > b.z0 - 30 && z < b.z1 + 8) return '轻轨穿楼'; if (abs(x) < 14) return '大马路'; if (x < -58) return '江'; return '四方街'; }

  /* ================================================================== placeholders (only when a module is missing or throws) */
  const DIMS = { escooter: [1.75, .68, 1.15, 1.3, .215], sharebike: [1.72, .58, 1.08, 1.1, .33], trike: [2.9, 1.2, 1.6, 1.9, .24], taxi: [4.6, 1.8, 1.5, 2.7, .31], police: [4.7, 1.82, 1.55, 2.75, .32], van: [4.4, 1.65, 1.9, 2.6, .29], sports: [4.4, 1.86, 1.24, 2.6, .33], bus: [12, 2.55, 3.1, 6.1, .48], laotoule: [2.3, 1.25, 1.62, 1.55, .2], sedan: [4.86, 1.85, 1.47, 2.8, .33], suv: [4.9, 1.9, 1.8, 2.8, .38], copsuv: [4.9, 1.9, 1.9, 2.8, .38], hatch: [3.95, 1.76, 1.47, 2.52, .31], pickup: [5.15, 1.92, 1.78, 2.97, .4], muscle: [4.9, 1.93, 1.34, 2.8, .33], boxtruck: [5.2, 1.98, 2.9, 3.4, .38], ambulance: [5.2, 1.98, 2.8, 3.4, .38] };   /* laotoule: the 「跑不快」 mobility car of js/street.js */
  const FBCOL = { escooter: 0xd6a21a, sharebike: 0x0f8f86, trike: 0x2a5c9a, taxi: 0xd9b21c, police: 0xe8e8e4, van: 0xdedcd2, sports: 0xb3201c, bus: 0x3a8a5a, laotoule: 0xf08fb0 };
  const TWO = { escooter: 1, sharebike: 1 };
  function fbVehicle(kind, o) {
    o = o || {}; const D = DIMS[kind] || DIMS.taxi, Lc = D[0], W = D[1], H = D[2], wb = D[3], rw = D[4], g = new T.Group(), k = GT.kit(), paint = GT.mat('car_paint', { color: o.color !== undefined ? o.color : FBCOL[kind] }), wheels = [], steer = [];
    const wheel = (x, z, st) => { const wk = GT.kit(); wk.cyl('rubber', rw, rw, TWO[kind] ? .09 : .22, 0, 0, 0, { rz: PI / 2, seg: 18 }); wk.cyl('aluminium_brushed', rw * .6, rw * .6, TWO[kind] ? .1 : .23, 0, 0, 0, { rz: PI / 2, seg: 10 }); const w = wk.build(), piv = new T.Group(); piv.position.set(x, rw, z); piv.add(w); g.add(piv); wheels.push(w); if (st) steer.push(piv); };
    let seat = null;
    if (TWO[kind]) { k.box(paint, .26, .3, Lc * .62, 0, rw + .22, -.05, { bevel: .06 }); k.box('plastic_black', .3, .08, .5, 0, .74, -.22, { bevel: .03 }); k.cyl('metal_dark', .025, .025, .8, 0, .72, wb / 2 - .08, { rx: -.3 }); k.box('plastic_black', .56, .04, .04, 0, 1.06, wb / 2 - .2, { bevel: .01 });
      if (kind === 'escooter' && o.box !== false) k.box(GT.mat('metal_painted_yellow'), .46, .44, .46, 0, 1.0, -.62, { bevel: .03 }); wheel(0, wb / 2, true); wheel(0, -wb / 2, false); seat = new T.Object3D(); seat.position.set(0, .74, -.2); g.add(seat); }
    else { const by = rw * .8, bh = H * .46, top = by + bh, ch = H - top - .03, cl = kind === 'bus' ? Lc * .96 : Lc * .5; k.box(paint, W, bh, Lc, 0, by + bh / 2, 0, { bevel: .12 }); k.box('glass_tint', W * .88, ch, cl, 0, top + ch / 2 - .02, kind === 'bus' ? 0 : -Lc * .06, { bevel: .14 }); k.box(paint, W * .82, .06, cl * .8, 0, top + ch, kind === 'bus' ? 0 : -Lc * .06, { bevel: .02 });
      if (kind === 'police') k.box('plastic_black', 1.0, .1, .3, 0, H + .06, -.2, { bevel: .03 }); for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) wheel(sx * (W / 2 - .16), sz * wb / 2, sz > 0); seat = new T.Object3D(); seat.position.set(.37, by + .3, -.2); g.add(seat); }
    g.add(k.build());
    const mk = () => new T.MeshBasicMaterial({ color: 0 }), lm = { head: mk(), tail: mk(), sa: mk(), sb: mk() }, st = { head: 0, brake: 0, siren: 0 }; let ph = 0;
    const quad = (m, w, h, x, y, z, back) => { const q = new T.Mesh(new T.PlaneGeometry(w, h), m); q.position.set(x, y, z); if (back) q.rotation.y = PI; g.add(q); };
    if (TWO[kind]) { quad(lm.head, .12, .1, 0, .95, wb / 2 + .06); quad(lm.tail, .1, .06, 0, .7, -Lc / 2 + .02, true); }
    else { for (const sx of [-1, 1]) { quad(lm.head, .26, .13, sx * (W / 2 - .3), H * .42, Lc / 2 + .004); quad(lm.tail, .3, .1, sx * (W / 2 - .3), H * .45, -Lc / 2 - .004, true); }
      if (kind === 'police') { const b1 = new T.Mesh(GT.boxGeo(.45, .1, .24, .02), lm.sa), b2 = new T.Mesh(GT.boxGeo(.45, .1, .24, .02), lm.sb); b1.position.set(.26, H + .14, -.2); b2.position.set(-.26, H + .14, -.2); g.add(b1, b2); } }
    const api = { group: g, kind, placeholder: true, dims: { L: Lc, W, H, wheelbase: wb, track: W - .32, wheelR: rw, eye: [.37, H - .28, -Lc * .05], seatH: .74 }, wheels, steer, seat, twoWheeler: !!TWO[kind], setLights(s) { Object.assign(st, s); }, setStand() {}, lean() {},
      update(dt) { ph += dt; lm.head.color.setRGB(1, .9, .72).multiplyScalar(st.head ? 8 : .25); lm.tail.color.setRGB(1, .05, .03).multiplyScalar(st.brake ? 7 : (st.head ? 1.6 : .12)); const f = st.siren ? (sin(ph * 14) > 0 ? 1 : 0) : -1; lm.sa.color.setRGB(1, .04, .04).multiplyScalar(f === 1 ? 9 : .12); lm.sb.color.setRGB(.05, .2, 1).multiplyScalar(f === 0 ? 9 : .12); } };
    api.update(0); return api;
  }
  function fbPerson(col) {
    const g = new T.Group(), k = GT.kit(), top = GT.mat('fabric_dark', { color: col || 0xd6a21a }), bot = GT.mat('fabric_dark', { color: 0x23262d }), skin = GT.mat('plastic_grey', { color: 0xb98a6a, rough: .8 });
    k.box(top, .44, .58, .24, 0, 1.2, 0, { bevel: .08 }); k.sphere(skin, .11, 0, 1.64, 0); k.box(top, .1, .56, .1, .27, 1.18, 0, { bevel: .04 }); k.box(top, .1, .56, .1, -.27, 1.18, 0, { bevel: .04 }); g.add(k.build());
    const legs = []; for (const sx of [1, -1]) { const lk = GT.kit(); lk.box(bot, .15, .88, .16, 0, -.44, 0, { bevel: .05 }); const lg = lk.build(); lg.position.set(sx * .1, .9, 0); g.add(lg); legs.push(lg); }
    let ph = 0; const fig = { group: g, placeholder: true, height: 1.78, who: 'kai', outfits: ['rider'], outfit: 'rider', bones: {}, setOutfit() { return fig; }, setHelmet() { return fig; }, setBox() { return fig; }, setMask() { return fig; }, attach(o) { g.add(o); return o; }, detach(o) { g.remove(o); },
      update(dt, s) { s = s || {}; const sp = s.speed || 0; ph += dt * (2 + sp * 2.4); const sw = sp > .2 && s.state !== 'ride' ? sin(ph) * min(.8, .25 + sp * .12) : (s.state === 'ride' || s.state === 'sit' ? -1.2 : 0); legs[0].rotation.x = sw; legs[1].rotation.x = s.state === 'ride' || s.state === 'sit' ? sw : -sw; g.children[0].rotation.x = s.state === 'fall' ? -1.3 : 0; return fig; } };
    return fig;
  }
  /** flat stand-in neighbourhood: enough ground, road and walls to play on when the world modules are absent */
  function fbWorld(scene) {
    const k = GT.kit(), H = L.highway;
    k.box('concrete_stained', 420, .2, 520, 60, -.12, 0); k.box(GT.mat('water_pool', { color: 0x4b6b68 }), 500, .1, 700, -310, -2, 0);
    k.box('asphalt', H.width, .1, 400, 0, -.05, 0); k.box('asphalt', 165, .1, 9, 75, -.048, L.crossS.z); k.box('asphalt', 165, .1, 9, 75, -.048, L.crossN.z); k.box('asphalt', 9, .1, 330, L.backRoad.x, -.049, 0);
    k.box('concrete', 48, .15, 380, -34, .075, 0, { bevel: .02 }); k.box('concrete', 6.5, .15, 300, 10.75, .075, 0, { bevel: .02 });
    for (let z = -180; z < 180; z += 9) { k.box('road_paint_white', .12, .01, 3, -3.5, .006, z); k.box('road_paint_white', .12, .01, 3, 3.5, .006, z); }
    for (const zc of FBSIG.crossings) for (let x = -6.6; x < 7; x += 1.2) k.box('road_paint_white', .6, .01, 4.6, x, .007, zc);
    for (const [key, mat, h] of [['hotpot', 'brick_painted', 8], ['tenement', 'stucco_cream', 18], ['clock', 'cinderblock', 14]]) { const r = CN[key]; k.box(mat, r.x1 - r.x0, h, r.z1 - r.z0, (r.x0 + r.x1) / 2, h / 2, (r.z0 + r.z1) / 2, { bevel: .05 }); GT.world.addBox(r.x0, r.z0, r.x1, r.z1, h, 'fb-' + key); }
    const n = CN.snack.noodle; k.box('stucco_white', n.x1 - n.x0, 7, n.z1 - n.z0, (n.x0 + n.x1) / 2, 3.5, (n.z0 + n.z1) / 2, { bevel: .05 }); GT.world.addBox(n.x0, n.z0, n.x1, n.z1, 7, 'fb-noodle');
    scene.add(k.build()); return { placeholder: true };
  }
  function fbCollidersOnly() { for (const key of ['hotpot', 'tenement', 'clock']) { const r = CN[key]; GT.world.addBox(r.x0, r.z0, r.x1, r.z1, 10, 'fb-' + key); } }

  /* ================================================================== vehicles: one entity per vehicle (visual from GT.cnvehicles, state here) */
  const MASS = { escooter: 95, sharebike: 28, trike: 320, taxi: 1450, police: 1550, van: 1250, sports: 1400, bus: 11000, laotoule: 420, sedan: 1450, suv: 1950, copsuv: 2000, hatch: 1100, pickup: 2150, muscle: 1650, boxtruck: 3400, ambulance: 3000 };
  const eyeOf = (d, ent) => { const e = d.eye, v = e ? (Array.isArray(e) ? new T.Vector3(e[0], e[1], e[2]) : new T.Vector3(+e.x || 0, +e.y || 0, +e.z || 0)) : new T.Vector3(.37, d.H - .28, -d.L * .05); if (ent && ent.veh && ent.veh.group) v.y -= ent.veh.group.userData.cmDrop || 0; return v; };   /* QA: a car lowered in js/carmods.js (userData.cmDrop) seats the driver, the cockpit and the eye that much lower with its body */
  function normDims(d, kind) { const f = DIMS[kind] || DIMS.taxi; d = d || {}; d.L = +d.L || f[0]; d.W = +d.W || f[1]; d.H = +d.H || f[2]; d.wheelbase = +d.wheelbase || f[3]; d.wheelR = +d.wheelR || f[4]; d.track = +d.track || d.W - .32; return d; }
  function makeVehicle(kind, o) {
    if (!G.visual) return { group: null, kind, dims: normDims(null, kind), wheels: [], steer: [], twoWheeler: !!TWO[kind], setLights() {}, update() {}, setStand() {} };
    let v = null;
    if (GT.cnvehicles && GT.cnvehicles.make && !G.bad['veh:' + kind]) v = safe('cnvehicles.make(' + kind + ')', () => GT.cnvehicles.make(kind, o || {}), null);
    if (!v || !v.group) { if (GT.cnvehicles) G.bad['veh:' + kind] = 1; v = fbVehicle(kind, o); }
    v.dims = normDims(v.dims, kind); v.wheels = v.wheels || []; v.steer = v.steer || []; if (!v.setLights) v.setLights = () => {}; if (!v.update) v.update = () => {}; if (!v.setStand) v.setStand = () => {};
    if (v.twoWheeler === undefined) v.twoWheeler = !!TWO[kind]; v.group.rotation.order = 'YXZ';
    return v;
  }
  const PLCH = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  const plateGen = two => { let s = ''; for (let i = 0; i < (two ? 5 : 7); i++) s += (two ? i > 1 : i === 0 || i > 3) ? PLCH[24 + (rnd() * 10 | 0)] : PLCH[rnd() * 24 | 0]; return s; };   /* g6: US-style plates (7ABC123 / AB123) */
  /** mkEnt(kind, {x, z, h, mode: 'parked'|'traffic'|'cop'|'scripted', color, plate, rider: people type, opts: extra cnvehicles options, locked, tag}) */
  function mkEnt(kind, o) {
    o = o || {}; if (!DIMS[kind]) kind = 'taxi';
    if (kind === 'escooter') { o = Object.assign({}, o); o.opts = Object.assign({ box: false }, o.opts); if (o.color === undefined && !o.opts.patrol) o.color = [0x3a3f46, 0xd8d6cf, 0x8a1f24, 0x2a4f7a][(G.seq + 1) % 4]; }   /* g7: no delivery box on any scooter, and none comes out in the old platform yellow unless asked */
    const e = { id: ++G.seq, kind, two: !!TWO[kind], x: o.x || 0, z: o.z || 0, h: o.h || 0, y: 0, v: 0, steer: 0, lean: 0, leanV: 0, roll: 0, pitch: 0, px: 0, pz: 0, yk: 0, mode: o.mode || 'parked', path: null, s: 0, cruise: o.cruise || 10,
      mass: MASS[kind] || 1400, lights: { head: false, brake: false, left: false, right: false, siren: false, hazard: false }, lkey: -1, wheelRot: 0, steerVis: 0, stuckT: 0, revT: 0, brakeOn: false, alive: true, cop: null, rider: null,
      plate: o.plate || plateGen(!!TWO[kind]), paint: 0, color: o.color, dwell: 0, skipStop: -1, c: null, fallen: 0, wobT: rnd() * 9, tag: o.tag || '', bump: 0, hornT: 0, locked: !!o.locked, owner: o.owner || '' };
    e.veh = makeVehicle(kind, Object.assign({ plate: e.plate, color: o.color, seed: e.id }, o.opts)); e.dims = e.veh.dims; e.veh.ent = e; e.y = groundY(e.x, e.z, 0);
    if (G.visual && e.veh.group) { G.scene.add(e.veh.group); if (o.rider) addRider(e, o.rider); if (e.two && e.mode === 'parked') safe('setStand', () => e.veh.setStand(true)); syncEnt(e, 0); }
    G.ents.push(e); G.vehDirty = true; return e;
  }
  function removeEnt(e) { if (!e || !e.alive) return; e.alive = false; if (e.veh.group && e.veh.group.parent) e.veh.group.parent.remove(e.veh.group); for (const a of [G.ents, G.traffic, G.cops]) { const i = a.indexOf(e); if (i >= 0) a.splice(i, 1); } G.vehDirty = true; }
  function addRider(e, type) {
    if (!G.visual || !e.veh.group) return; let f = null;
    if (GT.people && GT.people.make && !G.bad.people) f = safe('people.make(' + type + ')', () => GT.people.make(type, { seed: e.id * 7 + 3, phone: false }), null);
    if (!f || !f.group) f = fbPerson(type === 'traffic_police' ? 0x9fd0ea : 0x54606e);
    const s = e.veh.seat, sy = s && s.isObject3D ? s.position.y : (e.dims.seatH || .74), sz = s && s.isObject3D ? s.position.z : -.2;
    f.group.position.set(0, sy + .1 - .9, sz + .02); e.veh.group.add(f.group); e.rider = f; e.riderState = f.placeholder ? 'ride' : 'drive';
  }
  function syncEnt(e, dt) {
    const v = e.veh, g = v.group; if (!g) return;
    g.position.set(e.x, e.y + e.bump, e.z); g.rotation.set(e.pitch + (e.dive || 0), e.h, e.two ? e.lean : e.roll);   // e.dive: braking dive / squat (alive layer, visual only)
    if (dt > 0) { const rw = e.dims.wheelR || .3; e.wheelRot += e.v / rw * dt; for (let i = 0; i < v.wheels.length; i++) if (v.wheels[i]) v.wheels[i].rotation.x = e.wheelRot; }
    for (let i = 0; i < v.steer.length; i++) if (v.steer[i]) v.steer[i].rotation.y = e.two ? e.steerVis : e.steer;
    const l = e.lights, key = (l.head ? 1 : 0) + (l.brake ? 2 : 0) + (l.left ? 4 : 0) + (l.right ? 8 : 0) + (l.siren ? 16 : 0) + (l.hazard ? 32 : 0);
    if (key !== e.lkey) { e.lkey = key; safe('setLights', () => v.setLights({ head: l.head ? 1 : 0, brake: l.brake ? 1 : 0, left: l.left ? 1 : 0, right: l.right ? 1 : 0, siren: l.siren ? 1 : 0, hazard: l.hazard ? 1 : 0 })); }
    if (!e.updBad) { try { v.update(dt); } catch (err) { e.updBad = true; warn('vehicle.update', err); } }
    if (e.rider && !e.riderBad) { try { e.rider.update(dt, { state: e.riderState, speed: abs(e.v), steer: e.steerVis }); } catch (err) { e.riderBad = true; warn('rider.update', err); } }
  }
  const entOf = veh => (veh && veh.ent) || G.ents.find(q => q.veh === veh) || null;
  /** GT.cngame.spawnVehicle(kind, x, z, h, opts) -> entity {veh, x, z, h, v, plate, ...}. opts as mkEnt. */
  function spawnVehicle(kind, x, z, h, o) { return mkEnt(kind, Object.assign({ x, z, h: h || 0 }, o)); }

  /* ---- AI driving (bicycle model on rails with real steering; adapted from js/game.js) */
  const _q1 = {}, _ps1 = {}, _ps2 = {};
  function aiDrive(c, tx, tz, vT, dt) {
    const err = angDiff(c.h, Math.atan2(tx - c.x, tz - c.z)), sp = abs(c.v), maxS = .6 / (1 + (sp / 20) * (sp / 20)) + .03;
    let st = clamp(err * 1.7, -maxS, maxS);
    if (c.revT > 0) { c.revT -= dt; st = -Math.sign(err || 1) * .5; vT = -3.5; }
    c.steer += clamp(st - c.steer, -2.8 * dt, 2.8 * dt);
    const hot = c.cop && c.cop.state === 'pursue', acc = c.cop ? (hot ? 6 : 4.6) : (c.kind === 'bus' ? 1.5 : c.two ? 3.4 : 2.6), brk = c.cop ? 12 : (c.kind === 'bus' ? 5 : 8), dv = vT - c.v;
    c.brakeOn = dv < -.8 || (vT === 0 && sp < .3); c.v += clamp(dv, -brk * dt, acc * dt);
    const wb = c.dims.wheelbase, tn = abs(Math.tan(c.steer)); if (tn > .02) { const vm = Math.sqrt(7.4 * wb / tn); if (c.v > vm) { c.v = max(vm, c.v - 14 * dt); c.brakeOn = true; } }
    const yaw = c.v * Math.tan(c.steer) / wb + c.yk; c.h += yaw * dt;
    c.x += (sin(c.h) * c.v + c.px) * dt; c.z += (cos(c.h) * c.v + c.pz) * dt;
    const dm = Math.exp(-3.2 * dt); c.px *= dm; c.pz *= dm; c.yk *= Math.exp(-3 * dt);
    if (c.two) { c.lean += (clamp(-Math.atan(c.v * yaw / 9.81), -.55, .55) - c.lean) * min(1, dt * 5); c.steerVis = c.steer * (1 - sstep(sp, 0, 8) * .75); }
    else { c.roll += (clamp(c.v * c.v * Math.tan(c.steer) / wb * .0045, -.06, .06) - c.roll) * min(1, dt * 5); c.pitch += (clamp(-dv * .012, -.03, .03) - c.pitch) * min(1, dt * 4); }
  }
  function coast(c, dt) {
    c.v *= Math.exp(-3.5 * dt); c.h += c.yk * dt; c.x += (sin(c.h) * c.v + c.px) * dt; c.z += (cos(c.h) * c.v + c.pz) * dt;
    const dm = Math.exp(-3.2 * dt); c.px *= dm; c.pz *= dm; c.yk *= dm; c.brakeOn = false; c.steer *= .9; c.roll *= .9; c.pitch *= .9;
  }
  /** keep distance from whatever is ahead in my lane: other vehicles (the player's included) and, on a crossing with the walk light, the player on foot */
  function gapLimit(c, vT) {
    const f = sin(c.h), g = cos(c.h), reach = 8 + abs(c.v) * 1.7 + c.dims.L * .5, lat = c.two ? .95 : c.dims.W / 2 + .85;
    const chk = (ox, oz, oh, ov, half) => { const dx = ox - c.x, dz = oz - c.z, fz = dx * f + dz * g; if (fz < .6 || fz > reach + half) return; if (abs(dx * g - dz * f) > lat) return;
      const gap = fz - (c.dims.L / 2 + half + 1.1), lim = gap < .5 ? 0 : max(0, ov * cos(angDiff(c.h, oh))) + gap * .9; if (lim < vT) vT = lim; };
    for (const o of G.ents) if (o !== c && !(o.two && o.mode === 'parked' && !o.fallen) ) { if (abs(o.x - c.x) + abs(o.z - c.z) > reach + 14) continue; chk(o.x, o.z, o.h, o.v, o.dims.L / 2); }
    if (P.mode === 'foot' && !c.noYield && !(G.jayStrict && P.jay) && (c.two || c.kind === 'trike' || !G.jayStrict || (!P.jay && inRoadCache()))) chk(P.x, P.z, c.h, 0, .4);   /* noYield / G.jayStrict: the vehicle a mission sends at a jaywalker (cnstory jaywalkWatch) does not brake, and while that rule is on no rider brakes for a man in the road against the light, or the rule could never fire. In free roam every rider still brakes for him */   /* a rider always brakes for someone on foot in front of him (kerb lane, pavement or crossing): scooters used to ride straight through the hero and fill the first-person view */
    return vT;
  }
  const inRoadCache = () => P.onRoad;
  /** the hero's own headlamp at night: ONE small point light just ahead of and above the bars (lamp spill on the cowl, bars, hands and the first metres of road; it rides inside the js/perf.js light budget, so the light count of the scene does not change)
      and a stronger ground pool from the vehicle's own fx mesh. Off by day and off the saddle. */
  const RL = { l: null, v: null, p: [0, 1.42, .5], i: 1.15 };
  function rideLamp(e) { if (!G.visual || !G.scene || !window.THREE) return; const n = (GT.env && GT.env.night) || 0, on = !!(e && e.veh && e.veh.group && n > .35);
    if (!RL.l) { if (!on) return; RL.l = new THREE.PointLight(0xffe2b8, 0, 7.5, 1.7); RL.l.name = 'rideLamp'; RL.v = new THREE.Vector3(); G.scene.add(RL.l); }
    if (!on) { RL.l.intensity = 0; return; } RL.v.set(RL.p[0], RL.p[1], RL.p[2]).applyMatrix4(e.veh.group.matrixWorld); RL.l.position.copy(RL.v); RL.l.intensity = RL.i * clamp((n - .35) / .3, 0, 1); if (e.veh.setBeam) e.veh.setBeam(3.4); }
  /** red and amber lights: stop at the line (GT.cnroad.signals.stopFor) */
  function signalLimit(c, vT) {
    if (abs(c.x) > 8.4 || abs(sin(c.h)) > .5) return vT;
    const dir = cos(c.h) > 0 ? 1 : -1, st = sigStop(c.z + dir * c.dims.L / 2, dir); if (!st || st.car === 'green' || st.dist > 46) return vT;
    if (st.car === 'amber' && st.dist < abs(c.v) * 1.15) return vT;                      // too close to stop: clear the junction
    c.atLight = true; return min(vT, max(0, (st.dist - .7) * .85));
  }
  function pathSpeed(path, s, latA) {
    let lim = 99; for (const d of [0, 6, 13, 22, 32]) { const th = abs(angDiff(pathAt(path, s + d, _ps1).h, pathAt(path, s + d + 7, _ps2).h)); if (th < .03) continue; lim = min(lim, Math.sqrt((latA || 6.5) * 7 / th + 8 * d)); }
    return max(3.5, lim);
  }
  function followPath(c, vT, dt, o) {
    c.s = pathAdvance(c.path, c.s, c.x, c.z); c.atLight = false;
    const sp = abs(c.v), q = pathAt(c.path, c.s + (c.two ? 3.2 : 4.5) + sp * .6, _q1);
    vT = min(vT, pathSpeed(c.path, c.s, c.cop && c.cop.state !== 'patrol' ? 8 : (c.kind === 'bus' ? 3.2 : 5.5)));
    if (!(o && o.noSignal)) vT = signalLimit(c, vT);
    if (!(o && o.noGap)) vT = gapLimit(c, vT);
    aiDrive(c, q.x, q.z, vT, dt);
  }
  function setPath(c, path, s) { c.path = path; c.s = s === undefined ? pathNearest(path, c.x, c.z) : s; }
  function placeOnPath(c, path, s) { const q = pathAt(path, s, _q1); c.x = q.x; c.z = q.z; c.h = q.h; c.path = path; c.s = s; c.v = 0; c.steer = 0; c.y = groundY(c.x, c.z, 0); }
  function aiCollideWorld(c) {
    const r = c.two ? .45 : 1.0, f = sin(c.h), g = cos(c.h), off = c.two ? .4 : 1.35; let hit = false;
    for (const k of [off, -off]) { const px = c.x + f * k, pz = c.z + g * k, B = nearBoxes(px, pz, r + .2);
      for (const b of B) { if (!solidFor(b, .35)) continue; const qx = clamp(px, b.x0, b.x1), qz = clamp(pz, b.z0, b.z1), dx = px - qx, dz = pz - qz, d = hyp(dx, dz);
        if (d < r && d > 1e-4) { const p = r - d, nx = dx / d, nz = dz / d; c.x += nx * p; c.z += nz * p; const vn = (f * nx + g * nz) * Math.sign(c.v || 1); if (vn < -.5) c.v *= .55; else c.v *= .985; hit = true; } } }
    return hit;
  }
  function separateEnts() {
    const C = G.ents;
    for (let i = 0; i < C.length; i++) { const a = C[i]; if (a === P.ent) continue;
      for (let j = i + 1; j < C.length; j++) { const b = C[j]; if (b === P.ent || (a.mode === 'parked' && b.mode === 'parked')) continue; const dx = b.x - a.x, dz = b.z - a.z, rr = (min(a.dims.L, 5) + min(b.dims.L, 5)) * .29 + .2, d2 = dx * dx + dz * dz; if (d2 > rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), p = rr - d, nx = dx / d, nz = dz / d, fa = a.mode === 'parked' ? (a.two ? .8 : 0) : (b.mode === 'parked' ? (b.two ? .2 : 1) : b.mass / (a.mass + b.mass)); a.x -= nx * p * fa; a.z -= nz * p * fa; b.x += nx * p * (1 - fa); b.z += nz * p * (1 - fa); a.v *= .97; b.v *= .97; } }
  }

  /* ================================================================== traffic: taxis, vans and buses on the car loops, scooters and a cargo trike in the kerb lane */
  const TRAFFIC = [
    ['taxi', 'loopA', .06, 11], ['bus', 'busA', .22, 9], ['escooter', 'bikeA', .1, 6.4, 'local_m', 0x2f6fb5], ['van', 'loopB', .5, 10], ['bus', 'busB', .12, 9], ['escooter', 'bikeB', .16, 6, 'office_m', 0xc8c4b8],
    ['taxi', 'loopB', .92, 11.5], ['trike', 'bikeA', .36, 4.6, 'uncle'], ['escooter', 'bikeB', .62, 6.8, 'office_f', 0x8a1f24], ['taxi', 'loopA', .47, 10.5], ['escooter', 'bikeA', .78, 6.2, 'student', 0xb84a4a], ['van', 'loopA', .8, 9.5],
    ['sedan', 'loopA', .16, 11, undefined, 0x6b7078], ['suv', 'loopB', .08, 10.5, undefined, 0x2a3a4a], ['pickup', 'loopA', .3, 10, undefined, 0x8a8f96], ['hatch', 'loopB', .24, 11, undefined, 0x9a2a22], ['muscle', 'loopA', .62, 12, undefined, 0xc4541a], ['boxtruck', 'loopB', .66, 9, undefined, 0xd8d6cf], ['sedan', 'loopB', .38, 11, undefined, 0xe6e2d6], ['suv', 'loopA', .9, 10.5, undefined, 0x7a1f1c], ['hatch', 'loopA', .72, 11, undefined, 0x2e5f8a]   /* g6: American street mix */
  ];
  function spawnTraffic(n) {
    n = n === undefined ? TRAFFIC.length : n;
    for (let i = 0; i < min(n, TRAFFIC.length); i++) { const d = TRAFFIC[i], path = PATHS[d[1]]; if (!path) continue;
      trafficOne(d, path.len * d[2]); }
    if (G.visual && GT.cnvehicles && GT.cnvehicles._tpl) setTimeout(() => { safe('warm police', () => GT.cnvehicles._tpl('police')); setTimeout(() => safe('warm copsuv', () => GT.cnvehicles._tpl('copsuv')), 400); }, 2500);   /* g6: the patrol bodies are lofted a few seconds into the session, not in the frame the first unit arrives */
    G.trafficN = G.traffic.length;
  }
  function trafficOne(d, s) { const path = PATHS[d[1]], opts = d[0] === 'escooter' ? { box: false } : d[0] === 'trike' ? { load: 'crates' } : d[0] === 'van' ? { dirt: .7 } : {};
    const c = mkEnt(d[0], { mode: 'traffic', cruise: d[3] + (rnd() - .5), color: d[5], rider: d[4], opts }); c.riderType = d[4]; placeOnPath(c, path, s); c.v = c.cruise * .8; G.traffic.push(c); syncEnt(c, 0); return c; }
  function busStops(c, vT, dt) {
    const dir = cos(c.h) > 0 ? 1 : -1; if (abs(sin(c.h)) > .3 || abs(c.x) > 8) return vT;
    for (let i = 0; i < G.busStops.length; i++) { const b = G.busStops[i]; if (b.dir !== dir || c.skipStop === i && G.time < c.skipT) continue; const d = (b.z - c.z) * dir; if (d < -1.5 || d > 34) continue;
      c.lights.right = dir > 0 ? false : true; c.lights.left = dir > 0;                 // indicating toward the kerb
      if (d < 1 && abs(c.v) < .4) { c.dwell += dt; c.lights.hazard = true; if (c.dwell > 7.5) { c.dwell = 0; c.skipStop = i; c.skipT = G.time + 45; c.lights.hazard = false; emit('bus', { ent: c, stop: i, leave: true }); } else if (c.dwell - dt <= 0) emit('bus', { ent: c, stop: i }); return 0; }
      return min(vT, max(0, (d - .2) * .7)); }
    c.lights.left = c.lights.right = false; return vT;
  }
  function trafficStep(dt) {
    const night = ((GT.env && GT.env.night) || 0) > .3, TF = !G.bad.tf && GT.traffic && GT.traffic.active ? GT.traffic : null;   /* TF (2026-11-17): js/traffic.js drives the coast's cars (lanes, probes, rings, the pool); everything else here stays */
    if (TF) { try { TF.pre(dt); } catch (e) { G.bad.tf = 1; warn('traffic.pre', e); } }
    for (const c of G.traffic) {
      let vT = c.cruise; for (const k of G.cops) if (k.lights.siren && hyp(k.x - c.x, k.z - c.z) < 40) vT = min(vT, 3);
      if (P.mode === 'foot' && abs(c.v) < 2 && !G.jayStrict && c.kind !== 'bus') { if (hyp(P.x - c.x, P.z - c.z) < c.dims.L / 2 + 2.4) { c.nearT = (c.nearT || 0) + dt; if (c.nearT < 4) c.scare = max(c.scare || 0, .4); } else c.nearT = max(0, (c.nearT || 0) - dt * .5); }   /* somebody at the door of a stopped vehicle: the driver hesitates for up to four seconds before pulling away (time to reach the handle) */
      if (c.scare > 0) { c.scare -= dt; vT = 0; } else if (c.rushT > G.time) vT *= 1.45;
      if (c.kind === 'bus') vT = busStops(c, vT, dt);
      if (TF && c.tf && !G.bad.tf) { try { TF.drive(c, vT, dt); } catch (e) { G.bad.tf = 1; warn('traffic.drive', e); } } else if (c.path) followPath(c, vT, dt); c.lights.brake = c.brakeOn; c.lights.head = night; c.y = damp(c.y, groundY(c.x, c.z, 0), 12, dt);
      // a horn for whoever stands in the lane against the light
      if (P.mode === 'foot' && P.jay && c.hornT <= 0 && abs(c.v) > 3) { const dx = P.x - c.x, dz = P.z - c.z, fz = dx * sin(c.h) + dz * cos(c.h); if (fz > 0 && fz < 16 && abs(dx * cos(c.h) - dz * sin(c.h)) < 1.8) { c.hornT = 2.5; emit('honk', { ent: c, x: c.x, z: c.z }); } }
      if (c.hornT > 0) c.hornT -= dt;
      if (G.visual && !c.two && c.kind !== 'bus' && !c.rider && !c.noDrv && G.pop && hyp(P.x - c.x, P.z - c.z) < 36) addDriver(c);
      c.veh.locked = abs(c.v) > 4.5;   /* a slow or stopped vehicle can be taken with F (抢车), its driver or rider pulled off (ejectDriver) */
    }
    for (const c of G.ents) { if (c.mode === 'parked' && c !== P.ent) { if (abs(c.v) > .01 || abs(c.px) + abs(c.pz) > .01) { coast(c, dt); c.y = groundY(c.x, c.z, c.y + .3); } if (c.two) { const tl = c.fallen ? c.fallen * 1.42 : 0; if (c.fallen || abs(c.lean) > .001) c.lean = damp(c.lean, tl, 9, dt); c.steerVis *= .9; } c.lights.brake = false; c.lights.head = false; } }
    separateEnts(); jackStep(dt);
    /* taken vehicles are not lost to the street for good: one left far behind is cleared, and a new one joins the loop out of sight */
    if ((G.trafLost > 0 || G.trafSweep) && (G.trafT = (G.trafT || 0) - dt) <= 0) { G.trafT = 6; G.trafSweep = G.ents.some(e => e.jack === 2);   /* only what was taken off the loop by a 抢车 is replaced: a mission that clears the street keeps it clear */
      for (const e of G.ents.slice()) if (e.jack === 2 && e !== P.ent && e.mode === 'parked' && G.time - e.jackT > 40 && hyp(e.x - P.x, e.z - P.z) > 110) removeEnt(e);
      if (G.trafLost > 0 && !JACK.e && G.time - (G.jackAt || -99) > 6) { const d = TRAFFIC[(G.trafI = (G.trafI || 0) + 1) % TRAFFIC.length], path = PATHS[d[1]]; if (path && d[0] !== 'bus') for (let k = 0; k < 5; k++) { const sv = path.len * rnd(), q = pathAt(path, sv, _q1); if (hyp(q.x - P.x, q.z - P.z) < 95 || G.ents.some(o => hyp(o.x - q.x, o.z - q.z) < 9)) continue; trafficOne(d, sv); G.trafLost--; break; } } }
  }

  /* ================================================================== input: one small struct filled from GT.input (or the autopilot) */
  const IN = { thr: 0, steer: 0, brake: false, hand: 0, horn: false, fPressed: false, vPressed: false, lookDx: 0, lookDy: 0, pr: {} }, WATCH = ['KeyT', 'Digit1', 'Digit2', 'Digit3', 'KeyX', 'Escape', 'KeyI'];
  const PR = c => !!IN.pr[c];     // keys latched at the top of the step (ctl.update / ctl.updateCar may latch GT.input again before the HUD reads it)
  const KD = c => !!(GT.input && GT.input.down && GT.input.down(c)), KP = c => !!(GT.input && GT.input.pressed && GT.input.pressed(c));
  function readInput(dt) {
    const A = G.ap; IN.lookDx = IN.lookDy = 0; for (const c of WATCH) IN.pr[c] = false;
    if (A.on) { IN.thr = A.thr; IN.steer = A.steer; IN.brake = !!A.brake; IN.hand = A.hand || 0;   /* A.hand: the trailer's scripted handbrake turn */ IN.horn = false; IN.fPressed = IN.vPressed = false; return; }
    if (!GT.input || G.inputOff) { IN.thr = IN.steer = 0; IN.brake = false; IN.hand = 0; IN.horn = false; IN.fPressed = IN.vPressed = false; return; }
    const a = safe('input.axis', () => GT.input.axis(), null) || { x: 0, y: 0 };
    IN.thr = a.y; IN.steer = a.x; IN.brake = KD('Space'); IN.hand = KD('Space') ? 1 : 0; IN.horn = KD('KeyH'); IN.fPressed = KP('KeyF'); IN.vPressed = KP('KeyV'); for (const c of WATCH) IN.pr[c] = KP(c);
    const lk = GT.input.look; if (lk) { IN.lookDx = lk.dx || 0; IN.lookDy = lk.dy || 0; }
  }

  /* ================================================================== two-wheelers: the e-scooter and the shared bike
     Model: speed along the heading + a lean angle. Above walking pace the bike turns because it leans (yaw = g·tan(lean)/v) and the lean follows the stick at a limited
     rate, so there is a beat between asking and turning — and the bars flick the other way first (countersteer). Below ~8 km/h it steers by the bars and wobbles. */
  const BIKE = {
    escooter: { vmax: 12.5, acc: 5.6, brake: 9.5, lean: .62, r: .42, drain: 1 / 1500 },        // 45 km/h; a full battery lasts ~25 min of full throttle
    sharebike: { vmax: 6.4, acc: 2.5, brake: 7, lean: .5, r: .4, drain: 0 }
  };
  function rideStep(e, dt, inp) {
    const B = BIKE[e.kind] || BIKE.escooter, sp = abs(e.v), flat = e === G.scooter && G.battery <= 0, vmax = B.vmax * (e.vmaxMul || 1) * (flat ? .26 : 1), sf = surface(e.x, e.z);   /* vmaxMul / accMul / drainMul / launchMul / brakeMul / gripMul: js/shops.js tuning */
    // drive / brake
    if (inp.thr > 0) { e.v += B.acc * (e.accMul || 1) * (e.launchMul && e.v < 4.5 && e.v >= 0 ? e.launchMul : 1) * inp.thr * (flat ? .3 : 1) * max(0, 1 - Math.pow(max(0, e.v) / vmax, 1.7)) * dt; if (e === G.scooter) G.battery = max(0, G.battery - B.drain * (e.drainMul || 1) * inp.thr * dt); }
    else if (inp.thr < 0) e.v = e.v > .2 ? max(0, e.v - B.brake * (e.brakeMul || 1) * -inp.thr * sf.grip * dt) : max(-1.3, e.v - 2.2 * dt);
    else e.v -= Math.sign(e.v) * min(abs(e.v), (.45 + sp * .07 + sf.drag) * dt);
    if (inp.brake) e.v -= Math.sign(e.v) * min(abs(e.v), B.brake * (e.brakeMul || 1) * 1.25 * sf.grip * dt);
    e.lights.brake = inp.brake || inp.thr < 0;
    // lean follows the stick at a limited rate (faster at speed); the wobble only lives at walking pace
    const leanMax = lerp(.08, B.lean, sstep(sp, 1.2, 9)) * sf.grip * (e.gripMul || 1), want = inp.steer * leanMax, rate = lerp(1.3, 3.3, sstep(sp, 2, 10));
    const d = clamp(want - e.lean, -rate * dt, rate * dt); e.lean += d; e.leanV = damp(e.leanV, dt > 0 ? d / dt : 0, 10, dt);
    const wob = sp > .15 ? 1 - sstep(sp, .7, 2.7) : 0; e.wobT += dt * (5 + sp * 2); e.wob = (sin(e.wobT * 1.9) * .05 + sin(e.wobT * 3.1 + 1) * .022) * wob;
    // yaw: balance turn at speed, handlebar turn when slow
    const yawFast = 9.81 * Math.tan(e.lean) / max(sp, 3.2), yawSlow = inp.steer * 1.9 * clamp(sp / 1.6, 0, 1), yaw = lerp(yawSlow, yawFast, sstep(sp, 2, 5)) * (e.v < 0 ? -1 : 1);
    e.h -= (yaw + e.wob * 1.4 * clamp(sp, 0, 1)) * dt; e.yaw = yaw;
    // bars (positive = left): into the turn, minus the countersteer kick while the lean is building
    const bars = sp < 2.2 ? -inp.steer * .5 : -Math.atan(e.dims.wheelbase * yaw / max(sp, 2)) * 1.6;
    e.steerVis = damp(e.steerVis, clamp(bars + e.leanV * .11 * sstep(sp, 3, 8) - e.wob * 2.2, -.6, .6), 14, dt);
    // move + collide (circle against the world boxes; kerbs are ridden over with a bump)
    const fx = sin(e.h), fz = cos(e.h); let nx = e.x + (fx * e.v + e.px) * dt, nz = e.z + (fz * e.v + e.pz) * dt; const dm = Math.exp(-4 * dt); e.px *= dm; e.pz *= dm;
    let worst = 0;
    for (const b of nearBoxes(nx, nz, B.r + .3)) { if (!solidFor(b, .3)) continue; const qx = clamp(nx, b.x0, b.x1), qz = clamp(nz, b.z0, b.z1); let dx = nx - qx, dz = nz - qz, dd = hyp(dx, dz);
      if (dd >= B.r) continue; if (dd < 1e-4) { const l = nx - b.x0, r2 = b.x1 - nx, n = nz - b.z0, f = b.z1 - nz, m = min(l, r2, n, f); dx = m === l ? -1 : m === r2 ? 1 : 0; dz = dx ? 0 : (m === n ? -1 : 1); dd = 0; nx += dx * (m + B.r); nz += dz * (m + B.r); } else { dx /= dd; dz /= dd; nx += dx * (B.r - dd); nz += dz * (B.r - dd); }
      const into = -(fx * dx + fz * dz) * e.v; if (into > worst) worst = into; if (into > 0) { e.v -= Math.sign(e.v) * min(abs(e.v), into * .8);
        const dn = fx * dx + fz * dz, tx = fx - dn * dx, tz = fz - dn * dz; if (hyp(tx, tz) > .35) { let dh = Math.atan2(tx, tz) - e.h; while (dh > PI) dh -= 2 * PI; while (dh < -PI) dh += 2 * PI; e.h += clamp(dh, -5 * dt, 5 * dt); e.lean *= Math.exp(-6 * dt); } } }
    e.x = nx; e.z = nz;
    const gy = groundY(e.x + fx * .5, e.z + fz * .5, e.y + .3), dy = gy - e.y; if (abs(dy) > .06 && sp > 1.5) { e.bumpV = clamp(dy * 9, -1.2, 1.6); e.v *= dy > 0 ? .9 : .97; }
    e.y = damp(e.y, gy, 16, dt); e.bumpV = (e.bumpV || 0) + (-e.bump * 120 - (e.bumpV || 0) * 12) * dt; e.bump = clamp(e.bump + e.bumpV * dt, -.04, .09); e.pitch = damp(e.pitch, clamp(-e.bumpV * .05, -.08, .08), 12, dt);
    // other vehicles: a nudge is a wobble, a real hit throws you off
    for (const o of G.ents) { if (o === e || !o.alive) continue; const ddx = e.x - o.x, ddz = e.z - o.z; if (abs(ddx) + abs(ddz) > o.dims.L + 2) continue;
      const so = sin(o.h), co = cos(o.h), lx = ddx * co - ddz * so, lz = ddx * so + ddz * co, hw = o.dims.W / 2 + B.r * .8, hl = o.dims.L / 2 + B.r * .8; if (abs(lx) >= hw || abs(lz) >= hl) continue;
      const px = hw - abs(lx), pz = hl - abs(lz); let wx, wz; if (px < pz) { const k = lx > 0 ? 1 : -1; wx = co * k; wz = -so * k; e.x += wx * px; e.z += wz * px; } else { const k = lz > 0 ? 1 : -1; wx = so * k; wz = co * k; e.x += wx * pz; e.z += wz * pz; }
      const rvx = fx * e.v - so * o.v, rvz = fz * e.v - co * o.v, closing = -(rvx * wx + rvz * wz);
      if (closing > 0) { e.px += wx * closing * .5; e.pz += wz * closing * .5; e.v *= .7; if (o.two && o.mode === 'parked') { o.px -= wx * closing * .6; o.pz -= wz * closing * .6; if (closing > 3) o.fallen = o.fallen || (rnd() < .5 ? 1 : -1); }
        if (closing > worst) { worst = closing; e.hitBy = o; } } }
    if (worst > 1.2 && G.time - P.lastHitT > .3) { P.lastHitT = G.time; emit('crash', { v: clamp(worst / 12, .08, 1), vn: worst, ent: e, by: e.hitBy || null, two: true }); }
    const hitBy = e.hitBy; e.hitBy = null; return worst > 10.2 ? { vn: worst, by: hitBy } : null;
  }

  /* ================================================================== cars: arcade-sim bicycle model with weight transfer and a tyre curve (js/game.js, per-entity state) */
  const SPECS = {
    taxi: { mass: 1450, Iz: 2500, hcg: .55, peakT: 255, final: 3.9, gears: [3.4, 2.1, 1.4, 1.0, .78], rev: 3.2, rw: .31, cd: .9, brake: 1, mu: .97, steerMax: .6, front: .58 },
    police: { mass: 1550, Iz: 2700, hcg: .54, peakT: 340, final: 3.7, gears: [3.3, 2.05, 1.4, 1.0, .8], rev: 3.2, rw: .32, cd: .92, brake: 1.03, mu: 1.0, steerMax: .6, front: .57 },
    van: { mass: 1250, Iz: 2400, hcg: .78, peakT: 150, final: 4.6, gears: [3.6, 2.1, 1.4, 1.0, .82], rev: 3.5, rw: .29, cd: 1.25, brake: .9, mu: .86, steerMax: .58, front: .52 },
    sports: { mass: 1400, Iz: 2400, hcg: .46, peakT: 520, final: 3.5, gears: [2.9, 2.0, 1.45, 1.1, .86], rev: 2.9, rw: .33, cd: .86, brake: 1.08, mu: 1.07, steerMax: .6, front: .5 },
    sedan: { mass: 1450, Iz: 2500, hcg: .55, peakT: 270, final: 3.9, gears: [3.4, 2.1, 1.4, 1.0, .78], rev: 3.2, rw: .31, cd: .9, brake: 1, mu: .97, steerMax: .6, front: .58 },
    hatch: { mass: 1100, Iz: 1700, hcg: .54, peakT: 170, final: 4.1, gears: [3.5, 2.0, 1.35, 1.0, .8], rev: 3.3, rw: .29, cd: .88, brake: 1, mu: .96, steerMax: .62, front: .6 },
    suv: { mass: 1950, Iz: 3500, hcg: .72, peakT: 380, final: 3.9, gears: [3.5, 2.1, 1.4, 1.0, .76], rev: 3.3, rw: .37, cd: 1.15, brake: .96, mu: .93, steerMax: .58, front: .55 },
    copsuv: { mass: 2000, Iz: 3600, hcg: .7, peakT: 470, final: 3.7, gears: [3.4, 2.05, 1.4, 1.0, .78], rev: 3.3, rw: .37, cd: 1.12, brake: 1.02, mu: .98, steerMax: .58, front: .55 },
    pickup: { mass: 2150, Iz: 4200, hcg: .74, peakT: 430, final: 3.9, gears: [3.6, 2.2, 1.45, 1.0, .75], rev: 3.4, rw: .39, cd: 1.2, brake: .94, mu: .9, steerMax: .56, front: .57 },
    muscle: { mass: 1650, Iz: 2900, hcg: .5, peakT: 560, final: 3.4, gears: [2.9, 1.9, 1.35, 1.0, .8], rev: 2.9, rw: .34, cd: .9, brake: 1.02, mu: 1.0, steerMax: .58, front: .54 },
    boxtruck: { mass: 3400, Iz: 9000, hcg: 1.0, peakT: 420, final: 5.2, gears: [4.2, 2.4, 1.5, 1.0, .8], rev: 4, rw: .38, cd: 2.2, brake: .82, mu: .84, steerMax: .52, front: .5 },
    ambulance: { mass: 3000, Iz: 8000, hcg: .95, peakT: 480, final: 4.8, gears: [4.0, 2.3, 1.5, 1.0, .8], rev: 4, rw: .38, cd: 2.0, brake: .88, mu: .88, steerMax: .52, front: .5 },
    bus: { mass: 11000, Iz: 120000, hcg: 1.25, peakT: 1000, final: 6.2, gears: [5.6, 3.2, 1.9, 1.3, 1.0], rev: 5, rw: .48, cd: 5.5, brake: .78, mu: .8, steerMax: .66, front: .45 },   /* g6: every kind can be driven — a bus is slow off the line, heavy on the brakes and needs the whole road to turn */
    laotoule: { mass: 420, Iz: 380, hcg: .6, peakT: 40, final: 5, gears: [1], rev: 1, rw: .2, cd: 8.1, brake: .85, mu: .82, steerMax: .62, front: .5 }   /* js/street.js 老头乐: one gear, drag-limited to about 35 km/h */
  };
  const TQ = [[600, .5], [1200, .68], [2200, .86], [3400, .98], [4200, 1], [5200, .93], [5900, .8], [6400, .55]];
  function torqueAt(rpm) { if (rpm <= TQ[0][0]) return TQ[0][1]; for (let i = 1; i < TQ.length; i++) if (rpm <= TQ[i][0]) { const a = TQ[i - 1], b = TQ[i]; return a[1] + (b[1] - a[1]) * (rpm - a[0]) / (b[0] - a[0]); } return .3; }
  const tyre = (a, B) => sin(1.42 * Math.atan(B * a));
  function carInit(e) { const S = Object.assign({}, SPECS[e.kind] || SPECS.taxi); S.wb = e.dims.wheelbase; S.a = S.wb * (1 - S.front); S.b = S.wb * S.front;
    e.c = { S, vx: e.v || 0, vy: 0, r: 0, steer: 0, gear: 1, rpm: 850, shiftT: 0, revT: 0, axS: 0, ayS: 0, spin: 0, slipF: 0, slipR: 0, squeal: 0, damage: e.c ? e.c.damage : 0, thr: 0, brk: 0, hand: 0, odo: 0, dip: 0, dipV: 0, wr: 0 }; return e.c; }
  function carPhys(e, dt, inp) {
    const C = e.c, S = C.S, m = S.mass, g = 9.81, a = S.a, b = S.b, wb = S.wb, sf = surface(e.x, e.z), mu = S.mu * sf.grip * (e.muMul || 1);   /* muMul: js/shops.js (spoiler / wide body / lowered stance) */
    let thr = inp.thr > 0 ? inp.thr : 0, brk = inp.thr < 0 ? -inp.thr : 0; const hand = inp.hand;
    if (C.gear >= 0) { if (brk > .1 && thr < .1 && C.vx < .7) { C.revT += dt; if (C.revT > .12) C.gear = -1; } else C.revT = 0; if (C.gear === 0) C.gear = 1; }
    if (C.gear < 0) { if (thr > .1 && brk < .1 && C.vx > -.7) { C.gear = 1; C.revT = 0; } else { const t = thr; thr = brk; brk = t; } }
    const sp = hyp(C.vx, C.vy), beta = sp > 4 ? Math.atan2(C.vy, abs(C.vx)) : 0, ab = abs(beta);
    if (C.gear > 0 && hand <= 0) thr *= 1 - .55 * sstep(ab, .22, .6);
    C.thr = thr; C.brk = brk; C.hand = hand;
    const lim = S.steerMax / (1 + Math.pow(sp / 15, 1.5)) + .03, sIn = -inp.steer;                 // input: + = right; model: + = left
    let tgt = sIn * lim * (1 - .5 * sstep(ab, .2, .55) * (sIn * beta < 0 ? 1 : 0)); if (C.vx > 3) tgt += clamp(beta * .7, -.3, .3);
    const rate = (abs(sIn) < .05 ? 3 : 2) * (1 + sp * .01); C.steer += clamp(tgt - C.steer, -rate * dt, rate * dt);
    const tr = m * C.axS * S.hcg / wb, Fzf = max(m * g * .12, m * g * b / wb - tr), Fzr = max(m * g * .12, m * g * a / wb + tr);
    const ratio = C.gear > 0 ? S.gears[C.gear - 1] : -S.rev, tot = ratio * S.final, rpmW = abs(C.vx) / S.rw * abs(tot) * 60 / TAU;
    const launch = (C.gear === 1 || C.gear < 0) ? 880 + thr * 2500 : 880, rpmT = min(6450, max(rpmW, launch));
    C.rpm += (rpmT - C.rpm) * min(1, dt * (rpmT > C.rpm ? 10 : 5.5));
    if (C.shiftT > 0) C.shiftT -= dt;
    else if (C.gear > 0) { if (rpmW > 5750 && C.gear < S.gears.length) { C.gear++; C.shiftT = .2; } else if (C.gear > 1 && rpmW < (thr > .8 ? 3100 : 1850) && rpmW * S.gears[C.gear - 2] / S.gears[C.gear - 1] < 5300) { C.gear--; C.shiftT = .14; } }
    let Te = thr * S.peakT * torqueAt(C.rpm) * (1 - .3 * C.damage) * (C.shiftT > 0 ? .08 : 1); if (rpmW > 6350) Te = 0; if (thr < .04 && sp > 1) Te = -(26 + C.rpm * .011) * (C.gear < 0 ? 3 : 1);   /* reverse is a short gear: lifting off backs the car down (it used to coast 20 m) */ if (C.gear < 0 && thr > 0 && C.vx < -6.5) Te = 0;   /* and it tops out at about 23 km/h */
    let Fd = Te * tot * .88 / S.rw; if (thr < .04 && C.vx * tot < 0) Fd = 0;
    const dirx = clamp(C.vx * 3, -1, 1), capR = mu * Fzr, FbF = -dirx * min(brk * S.brake * m * g * .64, mu * Fzf * .98);
    let FbR = -dirx * min(brk * S.brake * m * g * .36, capR * .9), FbFh = 0; if (hand > 0) { FbR = -dirx * capR * .9; Fd *= .25; if (C.vx < -.05 || sp < 2.5) FbFh = -dirx * mu * Fzf * .85; }   /* backing up, or nearly stopped: Space is the whole brake, all four wheels — a second on it used to take 16 km/h off a reversing car and let it roll on for 11 m */
    C.spin = abs(Fd) / capR; let FxR = Fd + FbR; if (abs(FxR) > capR * .94) FxR = Math.sign(FxR) * capR * .94;
    const use = abs(FxR) / capR; let latK = max(.6, Math.sqrt(max(0, 1 - use * use))) * 1.13; if (hand > 0) latK = .36;
    const cs = cos(C.steer), sn = sin(C.steer), vfy = C.vy + a * C.r, vlat = -C.vx * sn + vfy * cs, vlong = C.vx * cs + vfy * sn;
    const af = Math.atan2(vlat, max(abs(vlong), 3)), ar = Math.atan2(C.vy - b * C.r, max(abs(C.vx), 3)), FyF = -mu * Fzf * tyre(af, 10.5), FyR = -latK * capR * tyre(ar, 11.5);
    C.slipF = abs(af); C.slipR = abs(ar);
    const rollR = (.014 * m * g + sf.drag * m * 1.2) * dirx, Fx = FxR + (FbF + FbFh) * cs - FyF * sn - S.cd * C.vx * abs(C.vx) - rollR - sf.drag * m * C.vx * .35;
    const Fy = FyR + FyF * cs + FbF * sn - sf.drag * m * C.vy * .35, Mz = a * (FyF * cs + FbF * sn) - b * FyR - (hand > 0 ? 0 : S.Iz * 3.4 * sstep(ab, .3, .75) * C.r);
    const ax = Fx / m, ay = Fy / m; C.vx += (ax + C.vy * C.r) * dt; C.vy += (ay - C.vx * C.r) * dt; C.r += Mz / S.Iz * dt;
    C.axS += (ax - C.axS) * min(1, dt * 7); C.ayS += (ay - C.ayS) * min(1, dt * 7);
    if (sp < .35 && abs(Fd) < 300) { const k = Math.exp(-14 * dt); C.vx *= k; C.vy *= k; C.r *= k; }
    const s = sin(e.h), c = cos(e.h); e.x += (s * C.vx + c * C.vy) * dt; e.z += (c * C.vx - s * C.vy) * dt; e.h += C.r * dt; C.odo += abs(C.vx) * dt;
  }
  const _wv = { x: 0, z: 0 }, _imp = { jx: 0, jz: 0 };
  function getWv(e) { const C = e.c, s = sin(e.h), c = cos(e.h); _wv.x = s * C.vx + c * C.vy; _wv.z = c * C.vx - s * C.vy; }
  function setWv(e, x, z) { const C = e.c, s = sin(e.h), c = cos(e.h); C.vx = s * x + c * z; C.vy = c * x - s * z; }
  function applyImpulse(e, ox, oz, nx, nz, rest, ovx, ovz, imO) {
    getWv(e); const C = e.c, S = C.S, vcx = _wv.x + C.r * oz - ovx, vcz = _wv.z - C.r * ox - ovz, vn = vcx * nx + vcz * nz; _imp.jx = _imp.jz = 0; if (vn >= 0) return 0;
    const c = oz * nx - ox * nz, k = 1 / S.mass + c * c / S.Iz + imO, j = -(1 + rest) * vn / k, tx = -nz, tz = nx, vt = vcx * tx + vcz * tz, ct = oz * tx - ox * tz, kt = 1 / S.mass + ct * ct / S.Iz + imO, jt = clamp(-vt / kt, -.3 * j, .3 * j);
    _imp.jx = j * nx + jt * tx; _imp.jz = j * nz + jt * tz; setWv(e, _wv.x + _imp.jx / S.mass, _wv.z + _imp.jz / S.mass); C.r = clamp(C.r + (j * c + jt * ct) / S.Iz, -4.5, 4.5); return -vn;
  }
  const CPTS = [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0], [1, .5], [-1, .5], [1, -.5], [-1, -.5]];
  function carCollideWorld(e) {
    const d = e.dims, hl = d.L / 2 - .06, hw = d.W / 2 - .03, s = sin(e.h), c = cos(e.h), B = nearBoxes(e.x, e.z, hl + 1.2);
    for (let bi = 0; bi < B.length; bi++) { const b = B[bi]; if (!solidFor(b, .3)) continue;
      let best = 0, nx = 0, nz = 0, cx = 0, cz = 0; const tx = b.x1 - b.x0, tz = b.z1 - b.z0, bcx = (b.x0 + b.x1) / 2, bcz = (b.z0 + b.z1) / 2;
      for (let i = 0; i < CPTS.length; i++) { const lx = CPTS[i][0] * hw, lz = CPTS[i][1] * hl, wx = e.x + c * lx + s * lz, wz = e.z - s * lx + c * lz; if (wx <= b.x0 || wx >= b.x1 || wz <= b.z0 || wz >= b.z1) continue;
        let dep, ax, az; const d0 = wx - b.x0, d1 = b.x1 - wx, d2 = wz - b.z0, d3 = b.z1 - wz;
        if (tx < .6 && tx < tz) { if (e.x < bcx) { dep = d0; ax = -1; } else { dep = d1; ax = 1; } az = 0; } else if (tz < .6 && tz < tx) { if (e.z < bcz) { dep = d2; az = -1; } else { dep = d3; az = 1; } ax = 0; }
        else { dep = min(d0, d1, d2, d3); ax = dep === d0 ? -1 : (dep === d1 ? 1 : 0); az = ax ? 0 : (dep === d2 ? -1 : 1); }
        if (dep > best) { best = dep; nx = ax; nz = az; cx = wx; cz = wz; } }
      const qx = clamp(e.x, b.x0, b.x1), qz = clamp(e.z, b.z0, b.z1), dx = qx - e.x, dz = qz - e.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (abs(lx) < hw && abs(lz) < hl) { const px = hw - abs(lx), pz = hl - abs(lz); let dep, ax, az; if (px < pz) { dep = px; const k = lx > 0 ? -1 : 1; ax = c * k; az = -s * k; } else { dep = pz; const k = lz > 0 ? -1 : 1; ax = s * k; az = c * k; } if (dep > best) { best = dep; nx = ax; nz = az; cx = qx; cz = qz; } }
      if (best > 0) { best = min(best, 1.5);
        if (tx < .5 && tz < .5 && abs(e.c.vx) > 5) { const lxp = (bcx - e.x) * c - (bcz - e.z) * s; if (abs(lxp) > hw * .42) { const kq = lxp > 0 ? -1 : 1, sl = max(0, hw - abs(lxp)) + max(tx, tz) / 2 + .05; e.x += c * kq * sl; e.z -= s * kq * sl; e.c.vx *= .82; e.c.r = clamp(e.c.r + kq * .35 * (e.c.vx > 0 ? 1 : -1), -4.5, 4.5); carCrash(e, 3.6, 'world', null); continue; } }   /* a sign pole or bollard (under half a metre both ways) caught with the outer part of the body at speed: the car is shouldered sideways past it and loses a fifth of its speed, instead of stopping dead from 47 km/h on a 0.2 m pole (m4 loop, the south street at (100, -155): two of four test drives ended there) */
        e.x += nx * best; e.z += nz * best; const vn = applyImpulse(e, cx - e.x, cz - e.z, nx, nz, .1, 0, 0, 0); if (vn > .4) carCrash(e, vn, 'world', null); } }
  }
  function carCollideEnts(e) {
    const d = e.dims, rP = d.W / 2, oP = d.L / 2 - rP, sP = sin(e.h), cP = cos(e.h);
    for (const o of G.ents) { if (o === e || !o.alive) continue; const ddx = o.x - e.x, ddz = o.z - e.z; if (ddx * ddx + ddz * ddz > 90) continue;
      const rO = o.dims.W / 2, oO = max(0, o.dims.L / 2 - rO), sO = sin(o.h), cO = cos(o.h), nO = o.dims.L > 7 ? 3 : 1; let best = 0, nx = 0, nz = 0, cx = 0, cz = 0;
      for (let i = -1; i <= 1; i++) { const ax = e.x + sP * oP * i, az = e.z + cP * oP * i; for (let j = -nO; j <= nO; j++) { const bx = o.x + sO * oO * j / nO, bz = o.z + cO * oO * j / nO, dx = ax - bx, dz = az - bz, dd = hyp(dx, dz), pen = rP + rO - dd; if (pen > best && dd > 1e-4) { best = pen; nx = dx / dd; nz = dz / dd; cx = bx + nx * rO; cz = bz + nz * rO; } } }
      if (best <= 0) continue;
      const fO = o.mass > 5000 ? 0 : o.two ? .9 : (o.mode === 'parked' ? .3 : .45); e.x += nx * best * (1 - fO); e.z += nz * best * (1 - fO); o.x -= nx * best * fO; o.z -= nz * best * fO;
      const ovx = sO * o.v + o.px, ovz = cO * o.v + o.pz, vn = applyImpulse(e, cx - e.x, cz - e.z, nx, nz, .16, ovx, ovz, 1 / o.mass);
      if (vn > 0) { const jx = -_imp.jx / o.mass, jz = -_imp.jz / o.mass, al = jx * sO + jz * cO; o.v += clamp(al, -8, 8); o.px += clamp(jx - al * sO, -8, 8); o.pz += clamp(jz - al * cO, -8, 8);
        const rx = cx - o.x, rz = cz - o.z; o.yk = clamp(o.yk + (rz * -_imp.jx - rx * -_imp.jz) / (o.mass * 2.4), -2.5, 2.5); if (o.two && vn > 1.5) { o.fallen = o.fallen || (rnd() < .5 ? 1 : -1); if (o.mode === 'traffic') { const i = G.traffic.indexOf(o); if (i >= 0) G.traffic.splice(i, 1); o.mode = 'parked'; } } if (vn > .5) carCrash(e, vn, o.cop ? 'cop' : 'car', o); } }
  }
  function carCrash(e, vn, what, obj) {
    const C = e.c; let vd = vn; if (what === 'cop') { vd = min(vn, G.time - (C.copHitT || -9) < 1.2 ? 3 : 9.5); C.copHitT = G.time; }   /* a pursuing unit closing at 60 km/h used to take a fifth of the car per touch with no speed lost by the player (+0.2 a contact at six stars): its ram counts as a 34 km/h knock at most, once per 1.2 s */
    const sev = clamp((vd - 3) / 26, 0, 1); if (sev > 0) C.damage = min(1, C.damage + sev * sev * .5 + sev * .12);   /* a nudge under 11 km/h costs nothing, a 36 km/h contact about 7%, a 70 km/h one about 30%: it used to be three ordinary touches to a wreck */
    if (G.time - P.lastHitT > .25 || vn > 6) emit('crash', { v: clamp(vn / 18, .08, 1), vn, what, ent: e, by: obj });
    P.lastHitT = G.time; C.dipV -= min(1.6, vn * .12);
  }
  function carStep(e, dt) {
    const n = max(1, Math.ceil(dt * 240 - 1e-6)), h = dt / n; for (let i = 0; i < n; i++) { carPhys(e, h, IN); carCollideWorld(e); carCollideEnts(e); }
    const C = e.c, sp = hyp(C.vx, C.vy);
    const sq = sp > 4 ? max(sstep(C.slipR, .1, .28), sstep(C.slipF, .13, .3) * .8, C.hand > 0 ? .9 : 0) : 0; C.squeal += (max(sq, C.thr > .4 ? clamp((C.spin - 1.04) * 1.5, 0, .75) * (1 - sstep(sp, 14, 26) * .6) : 0) - C.squeal) * min(1, dt * 9);
    e.roll += (clamp(C.ayS * .0062, -.07, .07) - e.roll) * min(1, dt * 6); e.pitch += (clamp(-C.axS * .0046, -.045, .05) - e.pitch) * min(1, dt * 6);
    C.dipV += (-C.dip * 90 - C.dipV * 11) * dt; C.dip = clamp(C.dip + C.dipV * dt * .02, -.06, .06);
    const s = sin(e.h), co = cos(e.h), a = e.dims.wheelbase / 2, t = e.dims.track / 2, y = (groundY(e.x + s * a + co * t, e.z + co * a - s * t, e.y + .3) + groundY(e.x + s * a - co * t, e.z + co * a + s * t, e.y + .3) + groundY(e.x - s * a + co * t, e.z - co * a - s * t, e.y + .3) + groundY(e.x - s * a - co * t, e.z - co * a + s * t, e.y + .3)) / 4;
    const dy = y - e.y; if (abs(dy) > .004 && sp > 1) C.dipV += clamp(dy * 14, -1.2, 1.2); e.y += dy * min(1, dt * 14); e.bump = C.dip;
    e.v = C.vx; e.steer = C.steer; e.lights.brake = C.brk > .05; e.lights.head = ((GT.env && GT.env.night) || 0) > .35;
  }

  /* ================================================================== the player: on foot, falling, mounting, driving */
  function refreshPlayer(dt) {
    const c = G.ctl, e = P.ent, ox = P.x, oz = P.z;
    if (G.kai && G.kai.setCap) { let cp = false; try { cp = !!(GT.shops && GT.shops.role && GT.shops.role() === 'guard'); } catch (err) {} if (cp !== !!G.capOn) { G.capOn = cp; safe('cap', () => G.kai.setCap(cp)); } }   /* the 保安 uniform comes with its peaked cap (js/hero.js setCap) */
    if ((P.mode === 'two' || P.mode === 'car') && e) { P.x = e.x; P.z = e.z; P.y = e.y; P.h = e.h; P.speed = abs(e.v); }
    else if (c && G.visual) { P.x = c.pos.x; P.z = c.pos.z; P.y = c.pos.y; P.h = c.h; P.speed = c.speed; }
    if (dt > 0) { P.vx = (P.x - ox) / dt; P.vz = (P.z - oz) / dt; }
    P.onRoad = inRoad(P.x, P.z); P.zone = zoneName(P.x, P.z);
    if (P.mode === 'foot' && P.onRoad) { const zc = onCrossing(P.x, P.z); P.jay = zc === null || sigState(zc).ped === 'dont'; } else P.jay = false;
  }
  /** GT.cngame.teleport(x, z, h, {mount: true | entity}) — on foot by default; steps off whatever he was on */
  function teleport(x, z, h, o) {
    o = o || {}; const c = G.ctl; if (P.mode === 'car') leaveCarNow(); if (P.mode === 'two') leaveBikeNow();
    P.mode = 'foot'; P.ent = null; P.x = x; P.z = z; P.h = h === undefined ? P.h : h; P.y = groundY(x, z, 0); P.speed = 0; P.down = 0; P.pz0 = undefined;
    if (c) { c.enabled = true; safe('ctl.teleport', () => c.teleport(x, z, P.h)); P.y = c.pos.y; }
    if (o.mount) { const e = o.mount === true ? G.scooter : o.mount; if (e) { e.x = x; e.z = z; e.h = P.h; e.v = 0; e.lean = 0; e.fallen = 0; e.y = groundY(x, z, 0); syncEnt(e, 0); mountNow(e); } }
    refreshPlayer(0); return api;
  }
  function mountNow(e) { if (!e) return false; P.pz0 = undefined; if (!e.two) { enterCarNow(e); return true; } e.fallen = 0; e.lean = 0; e.mode = 'player'; P.mode = 'two'; P.ent = e; safe('setStand', () => e.veh.setStand(false)); const i = G.traffic.indexOf(e); if (i >= 0) G.traffic.splice(i, 1);
    if (G.ctl && e.veh.group) { syncEnt(e, 0); syncVehList(); safe('ctl.mountNow', () => G.ctl.mountNow(e.veh)); G.ctl.rideAssist = false; } onMounted(e); return true; }
  function onMounted(e) { if (G.kai && G.visual) { safe('helmet', () => G.kai.setHelmet(true)); if (e.kind === 'escooter' && G.kai.setBox && G.kai.box) { G.boxWas = true; safe('box', () => G.kai.setBox(false)); } } if (e.kind === 'sharebike') e.rented = true; emit('mount', { ent: e, kind: e.kind }); }
  function leaveBikeNow() { const e = P.ent; if (!e) return; e.mode = 'parked'; e.v = 0; safe('setStand', () => e.veh.setStand(!e.fallen)); if (G.kai && G.visual) { safe('helmet', () => G.kai.setHelmet(false)); if (G.kai.setBox && G.boxWas) { G.boxWas = false; safe('box', () => G.kai.setBox(true)); } } P.mode = 'foot'; P.ent = null; emit('dismount', { ent: e, kind: e.kind }); }
  /* g6: in the chase view the driver's seat is not empty — a seated figure in the rider's yellow jacket holds the wheel (hidden in first person, where the cockpit has its own hands) */
  function seatKai(e) { if (!G.visual || !e || !e.veh.group || !GT.people || !GT.people.make || G.bad.people) return; if (e.rider && e.rider.group) { if (e.rider.group.parent) e.rider.group.parent.remove(e.rider.group); e.rider = null; }
    let f = G.kaiSeat; if (!f) f = G.kaiSeat = safe('people.make(kaiSeat)', () => GT.people.make('rider_y', { seed: 77, phone: false }), null); if (!f || !f.group) return; const ey = eyeOf(e.dims, e); if (f.group.parent) f.group.parent.remove(f.group); f.group.position.set(ey.x, ey.y - 1.46, ey.z - .06); f.group.rotation.set(0, 0, 0); e.veh.group.add(f.group); f.cmDrop = e.veh.group.userData.cmDrop || 0; safe('kaiSeat.pose', () => f.update(0, { state: 'drive', snap: true })); G.kaiSeatOn = e; }
  function unseatKai() { const f = G.kaiSeat; if (f && f.group && f.group.parent) f.group.parent.remove(f.group); G.kaiSeatOn = null; }
  function enterCarNow(e) {
    const was = e.mode; e.mode = 'player'; const i = G.traffic.indexOf(e); if (i >= 0) G.traffic.splice(i, 1); carInit(e); P.mode = 'car'; P.ent = e; e.veh.locked = false;
    if (G.ctl) { G.ctl.enabled = false; if (G.visual) attachCockpit(e); } CAM.init = false; CAM.yawT = CAM.pitchT = CAM.yaw = 0; CAM.pitch = -.04;
    seatKai(e); emit('enterCar', { ent: e, kind: e.kind, stolen: was === 'traffic' || e.owner === 'npc' });
    if (was === 'traffic') { violation('jack', e); }
  }
  function leaveCarNow() { const e = P.ent; if (!e) return; e.mode = 'parked'; e.v = 0; if (e.c) { e.c.vx = e.c.vy = e.c.r = 0; } if (G.cockpit) G.cockpit.group.visible = false; unseatKai(); streakBack(); P.mode = 'foot'; P.ent = null; if (G.ctl) G.ctl.enabled = true; const m = GT.render && GT.render.mirror; if (m) m.enabled = false; emit('exitCar', { ent: e, kind: e.kind }); }
  function exitCar() {
    const e = P.ent, c = G.ctl; if (!e || P.mode !== 'car') return; e.lights.brake = false;
    if (!c || !G.visual || !e.veh.group) { const lx = cos(e.h), lz = -sin(e.h); leaveCarNow(); P.x = e.x + lx * (e.dims.W / 2 + .7); P.z = e.z + lz * (e.dims.W / 2 + .7); if (c) c.teleport(P.x, P.z, e.h); return; }
    P.mode = 'exit'; e.mode = 'parked'; e.v = 0; if (e.c) e.c.vx = e.c.vy = e.c.r = 0; if (G.cockpit) G.cockpit.group.visible = false; unseatKai(); streakBack(); const m = GT.render && GT.render.mirror; if (m) m.enabled = false;
    syncEnt(e, 0); syncVehList(); const ok = safe('ctl.playExitCar', () => c.playExitCar(e.veh), false);
    if (!ok) { P.mode = 'car'; leaveCarNow(); const lx = cos(e.h), lz = -sin(e.h); c.teleport(e.x + lx * (e.dims.W / 2 + .7), e.z + lz * (e.dims.W / 2 + .7), e.h); }
  }
  /** thrown off / knocked down: a short slide and tumble, then he gets up. Works on foot (hit by traffic) and from the saddle. */
  function knockDown(vx, vz, dmg, why, by) {
    if (P.down > 0) return; const c = G.ctl, e = P.mode === 'two' ? P.ent : null;
    if (e) { e.fallen = e.lean >= 0 ? 1 : -1; e.px = sin(e.h) * e.v * .12 - cos(e.h) * e.fallen * 1.6; e.pz = cos(e.h) * e.v * .12 + sin(e.h) * e.fallen * 1.6; e.v = 0; e.mode = 'parked'; P.mode = 'foot'; P.ent = null; if (G.kai && G.visual) { safe('helmet', () => G.kai.setHelmet(false)); if (G.kai.setBox && G.boxWas) { G.boxWas = false; safe('box', () => G.kai.setBox(true)); } } emit('dismount', { ent: e, kind: e.kind, fall: true }); }
    P.down = 2.2; hurt(dmg, by); emit('fall', { why, by: by || null, dmg, jay: P.jay });
    if (!c || !G.visual) { P.x += vx * .4; P.z += vz * .4; return; }
    const vl = hyp(vx, vz) || 1, x0 = e ? e.x + vx / vl * 1.1 : c.pos.x, z0 = e ? e.z + vz / vl * 1.1 : c.pos.z; safe('ctl.teleport', () => c.teleport(x0, z0, Math.atan2(vx, vz) || c.h)); c.enabled = true; if (e && c.camera) { c.camera.yaw = (Math.atan2(vx, vz) || c.h) + e.fallen * 1.15; c.camera.pitch = .14; }
    let t = 0, sx = vx * (e ? .85 : .55), sz = vz * (e ? .85 : .55); const q = GT.onfoot && GT.onfoot.query, tk = { heroState: 'fall', look: true,
      update(dt) { t += dt; const k = Math.exp(-3.2 * dt); sx *= k; sz *= k; const nx = c.pos.x + sx * dt, nz = c.pos.z + sz * dt; if (!q || !q.isFree || safe('isFree', () => q.isFree(nx, nz, .3), true)) { c.pos.x = nx; c.pos.z = nz; } else { sx = sz = 0; }
        if (t > 1.15) tk.heroState = 'crouch'; if (t > 1.75) tk.heroState = 'idle'; return t > 2.0; },
      onEnd() { P.down = 0; emit('getup', {}); } };
    safe('ctl.takeover', () => c.takeover(tk));
  }
  function hurt(n, by) { if (!(n > 0)) return; if (GT.combat && GT.combat.damagePlayer && G.combatOn) safe('combat.damage', () => GT.combat.damagePlayer(n, by ? { x: by.x, z: by.z } : undefined)); else { G.hp = max(0, G.hp - n); if (G.hp <= 0) playerDown(); } G.hurtT = G.time; }
  const hp01 = () => { if (GT.combat && G.combatOn && GT.combat.player) { const p = GT.combat.player; return clamp(p.hp / (p.maxHp || 100), 0, 1); } return clamp(G.hp / 100, 0, 1); };
  function heal(n) { if (GT.combat && G.combatOn && GT.combat.heal) safe('combat.heal', () => GT.combat.heal(n)); G.hp = min(100, G.hp + n); }
  /** out cold: the clinic patches him up for a fee and he wakes at home */
  function playerDown() {
    if (G.downT > 0) return; G.downT = 3; const ev = { lines: [] }; if (emit('death', ev)) { G.downT = 0; return; }   /* js/economy.js: the notes he carried are gone (ev.lines / ev.seized) */
    const fee = min(wallet().cash, 200); if (fee > 0) wallet().spend(fee);
    const after = () => respawnHome(() => { ui.slip('WASTED · 阵亡', [['医院急救费', -fee]].concat(ev.lines || []), -fee - (ev.seized || 0)); const R = respawnPt('hospital'); if (R.name && G.visual && !G.silent) HUD.toast(R.name, '醒来了'); }, 'hospital');
    /* QA (GTA): the moment of death — slow motion, the colour drains, the death camera (js/combat.js) pulls out to the body, the big 阵亡 card; about 4 s later the fade and the hospital door */
    if (G.visual && !G.silent) { G.downT = 99; endCard(true, '阵亡', 'WASTED', '#c8261e'); G.slowmo = .35; safe('fx', () => { if (GT.render && GT.render.fx) GT.render.fx.focus = 1; }); setTimeout(after, 3300); } else after();
  }
  /* QA: the big word of a death or an arrest (original: a dark band across the middle, the word in the game's own face, the English under it), matching the receipt card's type */
  function endCard(on, zh, en, col) { if (!G.visual || typeof document === 'undefined') return; let e = HUD.endCard; if (!e && on) { e = HUD.endCard = document.createElement('div'); e.className = 'cn-endcard'; e.style.cssText = 'position:fixed;inset:0;z-index:58;pointer-events:none;display:flex;align-items:flex-start;justify-content:center;padding-top:calc(31vh - 9vh);box-sizing:border-box;opacity:0;transition:opacity .5s ease-out';   /* the card sits in the upper third: the body below it stays in view */
      e.innerHTML = '<div style="position:absolute;left:0;right:0;top:31%;height:19vh;transform:translateY(-50%);background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.5) 18%,rgba(0,0,0,.5) 82%,rgba(0,0,0,0))"></div><div style="position:relative;text-align:center"><b style="display:block;font:900 15vh/1 var(--cnf,\'PingFang SC\',\'Microsoft YaHei\',sans-serif);letter-spacing:.32em;margin-right:-.32em;text-shadow:0 .5vh 2vh rgba(0,0,0,.7)"></b><small style="display:block;margin-top:1.4vh;font:800 2.4vh/1 \'Courier New\',monospace;letter-spacing:.9em;margin-right:-.9em;color:#efe9da;opacity:.85"></small></div>'; document.body.appendChild(e); }
    if (!e) return; if (on) { e.querySelector('b').textContent = zh; e.querySelector('b').style.color = col || '#c8261e'; e.querySelector('small').textContent = en; e.style.transition = 'opacity .5s ease-out'; void e.offsetWidth; e.style.opacity = '1'; } else { e.style.transition = 'opacity .35s'; e.style.opacity = '0'; } }
  /* pt1: where you come back — BUSTED at the police station door, WASTED at the hospital door (月湾: two pavement spots on 月湾大道; the world line can put the buildings behind them). Elsewhere: the home spawn. */
  const RESPAWN = { coast: { police: { x: 8.8, z: 47, h: PI, name: '月湾警局门口' }, hospital: { x: 8.8, z: -128, h: 0, name: '月湾医院门口' } } };
  function respawnPt(kind) { const R = kind && GT.coast && GT.coast.active ? ((GT.coast.respawn && GT.coast.respawn[kind]) || RESPAWN.coast[kind]) : null;   /* the world module may publish its own: GT.coast.respawn = { police: {x, z, h, name}, hospital: {…} } */ if (!R) return spawnPt(); if (R.ok) return R;
    const free = (x, z) => { for (const b of nearBoxes(x, z, .5)) { if (!solidFor(b, .35)) continue; if (x > b.x0 - .4 && x < b.x1 + .4 && z > b.z0 - .4 && z < b.z1 + .4) return false; } return true; };
    for (let k = 0; k < 24 && !free(R.x, R.z); k++) R.z += (k % 2 ? -1 : 1) * (k + 1) * .5; R.ok = true; return R; }
  function respawnHome(then, kind) {
    const go = () => { clearWanted(true); W.custodyT = G.time; G.hp = 100; if (GT.combat && G.combatOn) { safe('combat.clear', () => GT.combat.clear && GT.combat.clear()); safe('combat.heal', () => GT.combat.heal && GT.combat.heal(999)); }
      const rs = CN.riderStart; if (G.scooter) { const s = G.scooter; s.x = rs.x; s.z = rs.z; s.h = rs.h; s.v = 0; s.fallen = 0; s.lean = 0; s.mode = 'parked'; s.y = groundY(s.x, s.z, 0); safe('setStand', () => s.veh.setStand(true)); }
      { const sp = respawnPt(kind); teleport(sp.x, sp.z, sp.h); if (GT.combat && G.combatOn && GT.combat.revive) safe('combat.revive', () => GT.combat.revive(P.x, P.z, P.h)); if (G.visual) placeMyCar(); } G.slowmo = 1; G.busting = false; endCard(false); safe('fx', () => { if (GT.render && GT.render.fx) GT.render.fx.focus = 0; });   /* QA: the fighting layer kept a dead man (and his old spot) after the respawn: the game hung on the body */ if (G.holdHours === null) G.hours = (G.hours + .5) % 24; G.downT = 0; if (then) then(); if (G.visual && GT.front && GT.front.fade) safe('fade', () => GT.front.fade(0, 900)); };
    if (G.visual && !G.silent && GT.front && GT.front.fade) { safe('fade', () => GT.front.fade(1, 600)); setTimeout(go, 750); } else go();
  }
  function footStep(dt) {
    // traffic does not stop for a pedestrian in the road against the light: being hit is a knock-down and a hospital bill in the making
    if (P.down > 0) { if (!G.ctl || !G.visual) { P.down -= dt; if (P.down <= 0) { P.down = 0; emit('getup', {}); } } return; }
    for (const o of G.ents) { if (!o.alive || abs(o.v) < 2.4 || o.mode === 'parked') continue; const dx = P.x - o.x, dz = P.z - o.z; if (abs(dx) + abs(dz) > o.dims.L + 2) continue;
      const so = sin(o.h), co = cos(o.h), lx = dx * co - dz * so, lz = dx * so + dz * co; if (abs(lx) > o.dims.W / 2 + .28 || abs(lz) > o.dims.L / 2 + .3) continue;
      const jay = P.jay; knockDown(so * o.v + co * Math.sign(lx || 1) * 2, co * o.v - so * Math.sign(lx || 1) * 2, min(70, (o.two ? 6 : 14) + abs(o.v) * (o.kind === 'bus' ? 4.5 : o.two ? 1.2 : 2.6)), 'traffic', o);
      o.v *= .25; o.scare = 2.5; emit('hit', { by: o, kind: o.kind, jay }); break; }
    if (inWater(P.x, P.z) && P.y < -1.5) { P.wetT += dt; if (P.wetT > .6) { P.wetT = 0; if (!emit('water', {})) { const a = anchor('swimGate', { x: -54, z: -20, h: PI / 2 }); teleport(a.x + 2.5, a.z, PI / 2); ui.achievement('冬泳体验卡（未经本人同意）'); } } } else P.wetT = 0;
  }
  function vehicleInput(dt) {
    const e = P.ent; if (!e) return;
    if (IN.horn && !e.hornOn) { e.hornOn = true; emit('horn', { on: true, ent: e, x: e.x, z: e.z }); } else if (!IN.horn && e.hornOn) { e.hornOn = false; emit('horn', { on: false, ent: e }); }
    if (P.mode === 'car') { if (IN.vPressed) { CAM.mode = CAM.mode === 'fp' ? 'chase' : 'fp'; CAM.init = false; CAM.cpos.set(0, 0, 0); CAM.yawT = CAM.pitchT = 0; } if (IN.fPressed && abs(e.v) < 1.6) exitCar(); }
  }
  function playerStep(dt) {
    const c = G.ctl;
    if (c && G.visual) {       // the controller tells us when a mount / dismount / car entry has played out
      if (P.mode === 'two' && !c.riding) { leaveBikeNow(); rideLamp(null); }
      else if (P.mode === 'foot' && c.riding) { const e = entOf(c.riding); if (e) { e.mode = 'player'; e.fallen = 0; e.lean = 0; P.mode = 'two'; P.ent = e; c.rideAssist = false; safe('setStand', () => e.veh.setStand(false)); const i = G.traffic.indexOf(e); if (i >= 0) G.traffic.splice(i, 1); onMounted(e); } }
    }
    if (P.mode === 'two') { const e = P.ent, hit = rideStep(e, dt, IN); vehicleInput(dt); e.lights.head = ((GT.env && GT.env.night) || 0) > .35; rideLamp(e);
      if (c) { c.ride.steer = IN.steer; c.ride.lean = e.lean; e.veh.speed = e.v; }
      if (hit) { const k = e.v; knockDown(sin(e.h) * max(k, hit.vn) , cos(e.h) * max(k, hit.vn), 8 + hit.vn * 2.2, 'crash', hit.by); if (hit.by && hit.by.cop) violation('hitcop', hit.by); }
      else if (inWater(e.x, e.z)) { e.v = 0; knockDown(0, 0, 5, 'water', null); const a = anchor('swimGate', { x: -54, z: -20 }); e.x = a.x + 4; e.z = a.z + 3; e.y = groundY(e.x, e.z, 1); } }
    else if (P.mode === 'car') { const e = P.ent; carStep(e, dt); vehicleInput(dt); if (inWater(e.x, e.z)) { const x = clamp(e.x, -9, -8), z = e.z; exitCar(); teleport(x, z, PI / 2); ui.achievement('水陆两用（并不）'); } }
    else if (P.mode === 'foot') { if (RL.l && RL.l.intensity) rideLamp(null); footStep(dt); }
    refreshPlayer(dt);
  }
  /** the list the on-foot controller prompts for (F 上车 / 骑车) */
  function syncVehList() { if (!G.ctl || !G.visual) return; G.vehDirty = false; safe('ctl.setVehicles', () => G.ctl.setVehicles(G.ents.filter(e => e.alive && e.veh.group).map(e => { if (e.rider && e.mode !== 'traffic' && e.mode !== 'cop') e.veh.enter = false; else { e.veh.enter = true; if (!e.veh.enterLabel) e.veh.enterLabel = () => e.mode === 'cop' ? '抢警车' : e.mode === 'traffic' ? (e.kind === 'bus' ? '抢公交车' : '抢车') : e.two ? '骑车' : '上车'; } if (e.mode === 'cop') e.veh.locked = abs(e.v) > 3; e.veh.locked = e.locked || !!e.veh.locked; return e.veh; }))); }

  /* ================================================================== car camera: first-person cockpit (js/cockpit.js) or chase; on foot and in the saddle GT.onfoot owns the camera */
  const CAM = { mode: 'fp', yaw: 0, pitch: -.04, yawT: 0, pitchT: -.04, idle: 0, fov: 60, head: new T.Vector3(), cpos: new T.Vector3(), ch: 0, init: false };
  const _v1 = new T.Vector3(), _v2 = new T.Vector3(), _v3 = new T.Vector3(), _qa = new T.Quaternion(), _qb = new T.Quaternion(), _eu = new T.Euler(0, 0, 0, 'YXZ');
  function streakBack() { const fx = GT.render && GT.render.fx; if (fx && G.streak0 !== undefined) { fx.streak = G.streak0; G.streak0 = undefined; } }
  function attachCockpit(e) {
    if (!G.visual) return;
    if (!G.cockpit && !G.bad.cockpit) { let ck = null; if (GT.cockpit && GT.cockpit.build) ck = safe('cockpit.build', () => GT.cockpit.build(), null); if (!ck || !ck.group) { G.bad.cockpit = 1; return; }
      const ey = ck.eye; ck.eyeV = ey ? (Array.isArray(ey) ? new T.Vector3(ey[0], ey[1], ey[2]) : new T.Vector3(ey.x, ey.y, ey.z)) : new T.Vector3(.37, 1.08, -.3); if (!ck.update) ck.update = () => {}; ck.group.userData.keepIndoor = false; G.cockpit = ck; }
    const ck = G.cockpit; if (!ck) return; if (ck.group.parent) ck.group.parent.remove(ck.group); e.veh.group.add(ck.group); ck.group.position.copy(eyeOf(e.dims, e)).sub(ck.eyeV); ck.dropAt = e.veh.group.userData.cmDrop || 0; ck.group.visible = true; G.eyeLocal = ck.group.position.clone().add(ck.eyeV);
  }
  /* first-person driving view: the eye sits a little forward of and above the modelled head position and looks slightly down, so the windscreen (not the roof and dash) fills the frame */
  const FPV = { up: .02, fwd: .08, pitch: -.085 };
  function carCamera(dt) {
    const cam = G.camera, e = P.ent; if (!e || !e.veh.group) return; if (G.auto && G.Q) { const qv = G.Q.get('view'); if (qv === 'fp') CAM.mode = 'fp'; else if (qv === 'chase') CAM.mode = 'chase'; } const C = e.c, sp = hyp(C.vx, C.vy), ck = G.cockpit; e.veh.group.updateMatrixWorld(true);
    if (dt > 0 && !G.inputOff && !G.ap.on) { CAM.yawT = clamp(CAM.yawT - IN.lookDx, -2.1, 2.1); CAM.pitchT = clamp(CAM.pitchT - IN.lookDy, CAM.mode === 'fp' ? -.7 : -.25, CAM.mode === 'fp' ? .6 : .45); if (abs(IN.lookDx) + abs(IN.lookDy) > 1e-5) CAM.idle = 0; }
    CAM.idle += dt; if (CAM.idle > 3 && sp > 6 && !CAM.fixed) { CAM.yawT += -CAM.yawT * min(1, dt * .7); CAM.pitchT += ((CAM.mode === 'fp' ? -.05 : 0) - CAM.pitchT) * min(1, dt * .7); }
    const k = 1 - Math.exp(-dt * 13); CAM.yaw += (CAM.yawT + (CAM.mode === 'fp' ? C.steer * .16 * sstep(sp, 3, 20) : 0) - CAM.yaw) * k; CAM.pitch += (CAM.pitchT - CAM.pitch) * k;
    { const dr = e.veh.group.userData.cmDrop || 0; if (ck && ck.group.parent === e.veh.group && ck.dropAt !== dr) { ck.dropAt = dr; ck.group.position.copy(eyeOf(e.dims, e)).sub(ck.eyeV); G.eyeLocal = ck.group.position.clone().add(ck.eyeV); } const ks = G.kaiSeat; if (ks && ks.group && ks.group.parent === e.veh.group && (ks.cmDrop || 0) !== dr) { ks.group.position.y += (ks.cmDrop || 0) - dr; ks.cmDrop = dr; } }   /* QA: lowered in the body shop while sitting in it: the cockpit, the eye and the seated driver go down with the body (the roof liner used to come down over the eye) */
    const mode = CAM.mode === 'fp' && ck ? 'fp' : 'chase'; if (ck) ck.group.visible = mode === 'fp'; if (G.kaiSeat && G.kaiSeat.group && G.kaiSeatOn === e) { G.kaiSeat.group.visible = mode !== 'fp'; if (mode !== 'fp' && dt > 0) safe('kaiSeat.update', () => G.kaiSeat.update(dt, { state: 'drive', steer: e.steer || 0 })); } let fovT;
    { const fx = GT.render && GT.render.fx; if (fx && fx.streak !== undefined) { if (mode === 'fp') { if (G.streak0 === undefined) G.streak0 = fx.streak; fx.streak = G.streak0 * .3; } else streakBack(); } }   /* behind glass the anamorphic streak of an oncoming lamp pair ran right across the windscreen */
    if (mode === 'fp') {
      const tx = clamp(-C.ayS * .0042, -.055, .055), tz = clamp(-C.axS * .0052, -.06, .05); CAM.head.x += (tx - CAM.head.x) * min(1, dt * 5); CAM.head.z += (tz - CAM.head.z) * min(1, dt * 5); CAM.head.y += (clamp(C.dip * .5, -.03, .03) - CAM.head.y) * min(1, dt * 14);
      _v1.copy(G.eyeLocal).add(CAM.head); _v1.y += FPV.up; _v1.z += FPV.fwd; cam.position.copy(_v1).applyMatrix4(e.veh.group.matrixWorld);
      e.veh.group.getWorldQuaternion(_qa); _eu.set(CAM.pitch + FPV.pitch, PI + CAM.yaw, clamp(C.ayS * -.0012, -.02, .02), 'YXZ'); cam.quaternion.copy(_qa).multiply(_qb.setFromEuler(_eu)); fovT = 60 + 9 * sstep(sp, 12, 46);
    } else {
      if (!CAM.init) { CAM.ch = e.h; CAM.init = true; CAM.cpos.set(0, 0, 0); }
      CAM.ch += angDiff(CAM.ch, e.h + Math.atan2(C.vy, max(4, abs(C.vx))) * .5) * min(1, dt * 3.6);
      const db = !!(GT.combat && GT.combat.dbOn); CAM.dbK = (CAM.dbK || 0) + ((db ? 1 : 0) - (CAM.dbK || 0)) * min(1, dt * 7); const dk = CAM.dbK;   /* QA: drive-by aim: the chase camera comes in lower and looks along the aim */
      const a = CAM.ch + CAM.yaw, big = max(0, e.dims.L - 5), dist = (6.2 + big * 1.25 + sstep(sp, 10, 45) * 1.6) * (1 - .32 * dk), hgt = lerp(2.0 + max(0, e.dims.H - 1.6) * 1.1 - CAM.pitch * 3, 1.85 + max(0, e.dims.H - 1.6), dk); _v1.set(e.x - sin(a) * dist, e.y + max(.5, hgt), e.z - cos(a) * dist);
      for (let q = 1; q > .2; q -= .13) { const cx = e.x - sin(a) * dist * q, cz = e.z - cos(a) * dist * q; let inside = false; for (const b of nearBoxes(cx, cz, .6)) if (b.h > 1.6 && cx > b.x0 - .35 && cx < b.x1 + .35 && cz > b.z0 - .35 && cz < b.z1 + .35) { inside = true; break; } _v1.x = cx; _v1.z = cz; if (!inside) break; }
      cam.position.lerp(_v1, CAM.cpos.lengthSq() ? min(1, dt * 9) : 1); CAM.cpos.copy(cam.position); cam.up.set(0, 1, 0); if (dk > .01) { _v2.set(e.x + sin(e.h) * 1.5, e.y + 1.05, e.z + cos(e.h) * 1.5).lerp(_v3.set(e.x + sin(a) * 16, e.y + 1.3 - CAM.pitch * 9, e.z + cos(a) * 16), dk); cam.lookAt(_v2); } else cam.lookAt(e.x + sin(e.h) * 1.5, e.y + 1.05, e.z + cos(e.h) * 1.5); fovT = 54 + 10 * sstep(sp, 12, 46);
    }
    CAM.fov += (fovT - CAM.fov) * min(1, dt * 4); if (abs(cam.fov - CAM.fov) > .01) { cam.fov = CAM.fov; cam.updateProjectionMatrix(); }
    const mir = GT.render && GT.render.mirror; if (mir && mir.camera) { mir.enabled = mode === 'fp'; if (mir.enabled) { _v2.set(0, 1.08, -(e.dims.L / 2 + .12)).applyMatrix4(e.veh.group.matrixWorld); mir.camera.position.copy(_v2); e.veh.group.getWorldQuaternion(mir.camera.quaternion); mir.camera.updateMatrixWorld(); } }
    if (ck && mode === 'fp' && !ck.broken) { const lim = C.S.steerMax / (1 + Math.pow(sp / 15, 1.5)) + .03, night = (GT.env && GT.env.night) || 0;
      try { ck.update(dt, { speed: sp, kmh: sp * 3.6, mph: sp * 2.237, rpm: clamp((C.rpm - 720) / 5500, 0, 1.1), rpmRaw: C.rpm, steer: -clamp(C.steer / lim, -1, 1) * lerp(1, .5, sstep(sp, 6, 32)), throttle: C.thr, brake: C.brk, handbrake: C.hand, gear: C.gear < 0 ? 'R' : 'D', gearIndex: C.gear, fuel: .58, temp: .46 + C.damage * .42, night, lights: !!e.lights.head, highBeam: false, signal: null, mirror: false, radioOn: !!GT.vehicleRadio?.on, radioText: GT.vehicleRadio?.name || '', clock: clock(G.hours), wanted: W.stars, look: { yaw: CAM.yaw, pitch: CAM.pitch }, engineOn: true, damage: C.damage, horn: !!e.hornOn, oilWarn: C.damage > .8 }); }
      catch (err) { ck.broken = true; warn('cockpit.update', err); } }
  }

  /* ================================================================== 违章: the wanted system (0–6 stars) with a description row — 脸 face / 衣 clothes / 车 vehicle / 牌 plate
     Offences add stars. 警察 only chase what they can recognise: a description chip is filed when an officer (or a junction camera) gets a look, and it stays valid only
     while it still matches — change clothes or put a mask on, swap vehicles, or re-plate in the courtyard. Out of sight for a few seconds turns pursuit into a search
     around the last known position; an empty file lets the stars drain. Stopped beside an officer while hot: 罚单 and a walk home. */
  const OFF = {            // id: [stars, fine $, label, camera-caught]
    redlight: [.5, 200, '闯红灯', 1], wrongway: [.5, 200, '逆行', 0], speeding: [.5, 150, '超速', 1], sidewalk: [.25, 50, '人行道骑行', 0], crash: [.35, 100, '剐蹭', 0], hitped: [1, 500, '撞人', 0],
    hitcop: [1.5, 1000, '冲撞巡逻车', 0], jack: [1.2, 800, '抢车', 0], fight: [1, 300, '打架斗殴', 0], gun: [2, 2000, '开枪', 0], shootped: [2, 3000, '开枪伤人', 0], flee: [.5, 300, '拒不停车', 0]
  };
  const TRAFOFF = { redlight: 1, wrongway: 1, speeding: 1, sidewalk: 1, crash: 1 };
  const W = { stars: 0, peak: 0, hot: false, lastSeenT: -99, lastKnown: { x: 0, z: 0 }, searchT: 0, bustT: 0, spawnT: 0, hotTime: 0, fines: 0, log: [], seenBy: 0, nearest: 999, visT: 0, fleeT: 0, wrongT: 0, speedT: 0, walkT: 0, lastLine: null, enabled: true, cover: false,
    chips: { face: { on: false, sig: '' }, cloth: { on: false, sig: '' }, car: { on: false, sig: '' }, plate: { on: false, sig: '' } } };
  const CHIPS = [['face', '脸'], ['cloth', '衣'], ['car', '车'], ['plate', '牌']];
  const sigOf = { face: () => (P.mask ? 'mask' : 'bare'), cloth: () => P.outfit, car: () => (P.ent ? P.ent.id + ':' + P.ent.paint : ''), plate: () => (P.ent ? P.ent.plate : '') };
  /** js/shops.js 吸睛指数 (ent.eye 0..100): how quickly an officer matches the vehicle you are on against the file. Unmodified vehicles sit near 1. */
  const eyeK = () => { const e = P.ent, sh = GT.shops; return (e && (P.mode === 'car' || P.mode === 'two') && e.eye !== undefined ? .5 + 1.7 * e.eye / 100 : 1) * (sh && sh.suspicion ? sh.suspicion() : 1) * (GT.economy && GT.economy.matchK ? GT.economy.matchK() : 1); };   /* × js/shops.js suspicion(): what the clothes do (rider jacket .6, sweeper's vest .5, a suit in the 洋行 quarter .55 …) */
  const chipValid = k => { const c = W.chips[k]; return c.on && c.sig === sigOf[k](); };
  /** how far away an officer can match the current look against the file (0 = nothing on file matches) */
  function matchRange() { let r = 0; const veh = P.mode === 'car' || P.mode === 'two';
    if (veh && chipValid('car')) r = 78; if (veh && chipValid('plate')) r = max(r, 26);
    if (P.mode !== 'car') { if (chipValid('cloth')) r = max(r, 42); if (chipValid('face')) r = max(r, 9); } return r; }
  function fileChip(k) { const c = W.chips[k], s = sigOf[k](); if (!s) return; if (!c.on || c.sig !== s) { c.on = true; c.sig = s; emit('chip', { chip: k, on: true }); } }
  function addStars(n) { const b = Math.floor(W.stars + 1e-6); W.stars = clamp(W.stars + n, 0, 6); if (Math.floor(W.stars + 1e-6) > b) emit('star', { stars: Math.floor(W.stars + 1e-6) }); W.peak = max(W.peak, W.stars); }
  /** violation(id | {stars, fine, label}, by?) — the single entry point for anything that raises heat */
  function violation(id, by) {
    if (!W.enabled) return; if (typeof id === 'string' && TRAFOFF[id] && !W.trafficLaw && !G.story) return;   /* g6: free roam is GTA-style — only crimes raise heat, traffic rules do not (missions and the self-test keep them) */ if (typeof id !== 'string' && id && /逃逸/.test(id.label || '') && G.time - (W.custodyT || -99) < 8) return;   /* taken home by the patrol while the 老头乐 driver was still on the ground: being driven off is not driving off (it used to add 「撞老头乐逃逸」, +0.8 star and $500, play report b3-world2-r2) */
    const o = typeof id === 'string' ? OFF[id] : null, stars = o ? o[0] : (id.stars || 0), fine = o ? o[1] : (id.fine || 0), label = o ? o[2] : (id.label || '违章'), key = typeof id === 'string' ? id : label;
    if (W.lastLine && W.lastLine.key === key && G.time - W.lastLine.t < 3) return;
    W.lastLine = { key, t: G.time }; W.fines += fine; W.log.push({ id: key, label, fine, t: G.time, hours: G.hours }); if (W.log.length > 30) W.log.shift();
    P.lastOffT = G.time; W.searchT = 0; if (!W.hot) W.lastKnown = { x: P.x, z: P.z }; addStars(W.cover && !W.hot ? 0 : GT.economy && GT.economy.offence ? GT.economy.offence(key, stars) : stars);   /* parked behind the bay curtain with nobody on you: the fine is logged, the stars do not climb */
    // junction cameras read plates; the point-duty officer at the second crossing sees everything nearby
    if (o && o[3] && P.ent && !(P.ent.eye < 20 && rnd() < .5)) { fileChip('plate'); fileChip('car'); }   /* a dull vehicle (js/shops.js 吸睛指数 under 20) slips past the junction camera half the time */
    if (hyp(P.x - 8.4, P.z - 60.2) < 42 && los(8.4, 60.2, P.x, P.z)) { fileChip('car'); fileChip('plate'); fileChip('cloth'); emit('whistle', { x: 8.4, z: 60.2 }); }
    if (key === 'jack' || key === 'fight' || key === 'hitped' || key === 'shootped') { fileChip('cloth'); fileChip('face'); if (P.ent) fileChip('car'); }
    emit('violation', { id: key, label, fine, stars: W.stars }); if (G.visual && !G.silent) HUD.toast('通缉 · ' + label, '');
  }
  function clearWanted(all) { scuffleTimes.length = 0; W.stars = 0; W.hot = false; W.searchT = 0; W.bustT = 0; W.hotTime = 0; if (all) { W.fines = 0; W.log.length = 0; W.peak = 0; for (const k in W.chips) { W.chips[k].on = false; W.chips[k].sig = ''; } for (const c of G.cops.slice()) removeEnt(c); } emit('clear', {}); }
  /** traffic rules the player can break while riding or driving */
  function rulesStep(dt) {
    const e = P.ent; if (!e || !(P.mode === 'two' || P.mode === 'car') || !W.enabled) { W.wrongT = W.speedT = W.walkT = 0; P.pz0 = undefined; return; }
    const dir = cos(e.h) * (e.v >= 0 ? 1 : -1) > 0 ? 1 : -1, sp = abs(e.v), onAve = abs(e.x) < 7.5 && abs(e.z) < 150 && abs(sin(e.h)) < .6;
    // red light: crossing a stop line (in its direction) while the signal shows red
    if (P.pz0 !== undefined && sp > 1.5) for (const l of stopLines()) { if (e.x < l.x0 - .2 || e.x > l.x1 + .2 || (l.dir !== dir && !(e.v > 3))) continue;   /* driving forward against the flow on the wrong half: the oncoming lane's stop line, crossed from behind, stands in for the one he never had (js/street.js round, play report b2-shops-r1 note 10) */ if ((P.pz0 - l.z) * dir < 0 && (e.z - l.z) * dir >= 0 && sigState(l.crossing).car === 'red') { violation('redlight'); emit('redlight', { crossing: l.crossing }); } }
    P.pz0 = e.z;
    // wrong way on the avenue: northbound belongs to x < 0
    if (onAve && sp > 3 && abs(e.x) > .6 && (e.x < 0 ? dir < 0 : dir > 0)) { W.wrongT += dt; if (W.wrongT > 1.6) { W.wrongT = -12; violation('wrongway'); } } else if (W.wrongT > 0) W.wrongT = max(0, W.wrongT - dt * 2);
    // speeding: 60 km/h on the avenue, 40 elsewhere (cars; the scooter is limited to 45 by its controller, so it only speeds on the pavement)
    if (P.mode === 'car' && sp > (onAve ? 17.5 : 12.5)) { W.speedT += dt; if (W.speedT > 2.5) { W.speedT = -6; violation('speeding'); } } else if (W.speedT > 0) W.speedT = max(0, W.speedT - dt);
    // riding fast among pedestrians on the pavement / promenade
    if (!P.onRoad && sp > 7 && (abs(e.x) < 14 || e.x < -10) && e.x > -58) { W.walkT += dt; if (W.walkT > 3) { W.walkT = -8; if (W.seenBy || W.stars > 0) violation('sidewalk'); } } else if (W.walkT > 0) W.walkT = max(0, W.walkT - dt);
  }
  function wantedStep(dt) {
    if (!W.enabled) return; rulesStep(dt);
    W.visT -= dt; const sp = P.speed;
    if (W.visT <= 0) { const iv = .12; W.visT = iv; let recog = false, nearest = 999; W.seenBy = 0; const mr = matchRange(), fresh = G.time - P.lastOffT < 4;
      const cov = inBay(); W.cover = cov; const blindZ = !!(GT.economy && GT.economy.live && GT.economy.live() && GT.economy.blind);   /* economy.blind is a getter: the zone's name, '' outside one */   /* 筒子楼 / indoors: no camera feed and no radio fix, so a unit has to be within 16 m to keep him */
      for (const c of G.cops) { const K = c.cop, dx = P.x - c.x, dz = P.z - c.z, d = hyp(dx, dz); K.d = d; if (d < nearest) nearest = d;
        const ang = abs(angDiff(c.h, Math.atan2(dx, dz))); K.sees = !P.inside && d < 120 && (d < 30 || ang < 1.2) && !(cov && d > BAY.far) && !(blindZ && d > 16) && los(c.x, c.z, P.x, P.z);
        if (!K.sees) continue; W.seenBy++;
        if (W.stars <= 0) continue;
        if (W.hot) { if (d < 100) recog = true; }
        else if (fresh && d < 80) recog = true;                                                    // caught in the act
        else if (mr > 0 && d < mr) { K.idT = (K.idT || 0) + iv * (.5 + 2.2 * (1 - d / mr)) * eyeK(); if (K.idT >= 1) { K.idT = 0; recog = true; } }   // a description match takes a moment
        else if (K.state === 'respond' && d < 16 && W.searchT < 45 && hyp(P.x - W.lastKnown.x, P.z - W.lastKnown.z) < 25) { K.idT = (K.idT || 0) + iv * .7 * eyeK(); if (K.idT >= 1) { K.idT = 0; recog = true; } }   /* answering a call, and the one person standing where it came from is you: no file needed, a look from 14 m does it (b3-eco1: units sent to a fresh report never stopped anyone) */
        else K.idT = max(0, (K.idT || 0) - iv * .5);
        if (recog || W.hot) { const veh = P.mode === 'car' || P.mode === 'two'; if (veh && d < 80) fileChip('car'); if (veh && d < 26) fileChip('plate'); if (P.mode !== 'car' && d < 42) fileChip('cloth'); if (P.mode !== 'car' && d < 9) fileChip('face'); } }
      W.nearest = nearest;
      if (recog) { if (!W.hot) { W.hot = true; if (W.stars < 1) addStars(1 - W.stars); emit('spotted', {}); } W.lastSeenT = G.time; W.lastKnown = { x: P.x, z: P.z }; }
    }
    if (W.hot) { W.hotTime += dt; if (G.time - W.lastSeenT < 1) { addStars(GT.economy && GT.economy.climb ? GT.economy.climb(dt) : dt / 45);   /* js/economy.js TIERS: how fast running in sight escalates at each tier */ if (sp > 6) { W.fleeT += dt; if (W.fleeT > 8) { W.fleeT = 0; violation('flee'); } } }
      if (G.time - W.lastSeenT > 5.5) { W.hot = false; W.searchT = 0; W.fleeT = 0; if (W.cover) W.lastKnown = { x: -4.6, z: 132 };   /* lost behind the curtain: the units carry on up the avenue, where you were heading */
        emit('lost', {}); for (const c of G.cops) if (c.cop.state === 'pursue') { c.cop.state = 'respond'; c.cop.navT = 0; } } }
    else if (W.stars > 0) { W.searchT += dt; const floor = matchRange() > 0 && W.searchT < 75 && W.peak >= 1 ? min(1, W.stars) : 0;
      if (W.searchT > 10) W.stars = max(floor, W.stars - dt / 9);
      if (W.stars <= 0) { W.stars = 0; W.peak = 0; emit('clear', { fines: W.fines }); for (const c of G.cops) c.cop.state = 'patrol'; } }
    // busted: stopped (or down) with an officer beside you while they know it is you
    /* also (play reports b3-eco1 / b3-eco2): a unit that has got as near as it can (K.end: a van at a 2.6 m gate) makes the stop from 15 m with a sight line, and a man on foot does not have to stand still — an officer at his shoulder grabs him.
       W.graceT (js/cnstory.js m4: the loop start is also the retry spot) holds the stop off, and the first time a unit pulls up on a standing player it is said on screen before the 2.6 s run out. */
    /* pt1 (play-test 1: "碰到就逮捕"): on foot a patrol car beside you no longer arrests you. Only an officer on foot holding you at arm's length does (js/combat.js grabbedBy), and only while you stand and do not
       fight: 2 s at one or two stars, 2.8 s from three. Run (over ~1.4 m/s), swing, shoot — the hold is broken and the count starts again. In a vehicle the old stop stays: stopped and boxed in by a unit. */
    const foot = P.mode === 'foot', CB = G.combatOn && GT.combat, cs = CB && CB.player ? (CB.player.speed || 0) : sp, grab = foot && CB && CB.grabbedBy ? CB.grabbedBy() : null, fight = !!(CB && CB.attacking && CB.attacking());
    let close = false, slow = sp < 1.6 || P.down > 0; if (W.hot && !foot) for (const c of G.cops) { const K = c.cop; if (K.crew) continue; if (slow && abs(c.v) < 3 && (K.d < 7.5 || (K.d < 15 && K.end && K.sees))) close = true; }
    if (W.stars > 0 && grab && cs < 1.4 && !fight && !(CB.player && CB.player.dead) && !P.inside) close = true; if (fight) W.bustT = 0; W.grab = grab;
    if (W.hot && !foot && slow && W.nearest < 22 && G.time - (W.warnT || -99) > 14 && G.visual && !G.silent) { W.warnT = G.time; HUD.toast('巡逻车贴上来了', P.mode === 'foot' ? '站着不动就被带走 · 跑' : '停着不动就被扣下 · 动起来'); emit('bustwarn', {}); }
    /* boxed in: from two stars the units do not ride behind a crawling vehicle for ever (play report b3-eco2-r2 issue 3: a moto sat 4–10 m behind a rider doing 2–4 m/s for 40 s). Under 4.5 m/s with a unit within 9 m that sees him: after 3 s it is said, after 6 s the unit cuts in front and the stop begins */
    if (W.hot && W.stars >= 2 && P.mode !== 'foot' && sp < 4.5 && W.nearest < 9 && W.seenBy > 0) { W.boxT = (W.boxT || 0) + dt; if (W.boxT > 3 && !W.boxTold) { W.boxTold = true; if (G.visual && !G.silent) HUD.toast('要被别停了', '太慢 · 再不提速，巡逻车就切到你前头'); emit('bustwarn', { box: true }); } if (W.boxT > 6) close = true; } else { W.boxT = max(0, (W.boxT || 0) - dt * 2); if (W.boxT <= 0) W.boxTold = false; }
    if (close && G.time < (W.graceT || 0)) close = false;
    if (G.ctl) G.ctl.poseOverride = close && foot && W.bustT > .35 ? 'handsup' : null;   /* pt1: held by an officer and not fighting: his hands go up */
    if (close) { if (!W.bustTold) { W.bustTold = true; if (G.visual && !G.silent) { HUD.toast('要被扣下了', P.mode === 'foot' ? '两秒内跑开 · 不然人被带走' : '两秒内动起来 · 不然人车带走'); say('警察', P.mode === 'foot' ? '别动！手放在看得见的地方！' : '熄火！下车！', 2.4); if (foot) HUD.toast('被警察按住了', '跑开挣脱 · 或者还手'); } emit('bustwarn', { imminent: true }); }   /* no stop without a word: the 2.6 s always open with a toast and a shout (a standing car at the m4 loop start was booked with nothing on screen) */ W.bustT += dt; if (W.bustT > (foot ? (W.stars <= 2 ? 2 : 2.8) : 2.6)) busted(); } else { W.bustT = max(0, W.bustT - dt * 1.5); if (W.bustT <= 0) W.bustTold = false; }
  }
  function busted() {
    if (G.busting && G.visual) return;   /* QA: the card is up, the respawn is on its way */
    const stars = max(1, Math.ceil(W.stars - 1e-6)), lines = [], seen = {}; let total = 0;
    for (const l of W.log) { if (!l.fine) continue; if (seen[l.label]) { seen[l.label][1] -= l.fine; seen[l.label].n++; } else { seen[l.label] = [l.label, -l.fine]; seen[l.label].n = 1; lines.push(seen[l.label]); } total += l.fine; }
    for (const l of lines) if (l.n > 1) l[0] += ' ×' + l.n;
    const extra = stars * 100; lines.push(['保释金', -extra]); total += extra; const cash = wallet().cash, paid = min(cash, total); if (total > cash) lines.push(['钱不够 · 其余免除', '']);
    const res = { fine: total, paid, stars, lines }; W.bustT = 0; W.bustTold = false; W.boxT = 0; W.boxTold = false;
    if (emit('busted', res)) { clearWanted(!res.keepUnits); return; }   /* js/economy.js: a one-star ticket is written on the spot (keepUnits: the officer rides off instead of vanishing); from two stars the carried cash is confiscated (res.seized) */
    if (paid > 0) wallet().spend(paid);
    { let had = false; try { const cp = GT.combat && GT.combat.player; had = !!(cp && Object.keys(cp.owned || {}).some(k => k !== 'fists')); } catch (e) {} safe('confiscate', () => { if (GT.combat && GT.combat.strip) GT.combat.strip(); if (GT.shops && GT.shops.confiscate) GT.shops.confiscate(); }); if (had) lines.push(['武器全部没收', '']); }   /* pt1: arrested — the guns and the bat stay at the station */
    const afterB = () => respawnHome(() => { ui.slip('BUSTED · 被捕', lines, -paid - (res.seized || 0)); const R = respawnPt('police'); if (R.name && G.visual && !G.silent) HUD.toast(R.name, '保释出来了'); }, 'police');
    if (G.visual && !G.silent) { G.busting = true; endCard(true, '被捕', 'BUSTED', '#e8c547'); G.slowmo = .5; setTimeout(afterB, 2200); } else afterB();   /* QA: the same card as a death, in yellow */
  }

  /* ---- 警察: scooters at low heat, patrol cars from two stars, 特警 vans at five. Driving AI adapted from js/game.js (respond / pursue / search / patrol). */
  function spawnCop(kind, x, z, h, state) {
    const k = kind === 'moto' ? 'escooter' : kind === 'swat' || kind === 'riot' ? 'van' : (G.cops.length % 3 === 2 ? 'copsuv' : 'police');   /* riot: the white 特警 light truck of a three-star roadblock (js/economy.js) */
    const c = mkEnt(k, { x, z, h, mode: 'cop', color: kind === 'moto' ? 0xeeeeea : kind === 'swat' ? 0x1a2430 : kind === 'riot' ? 0xdfe4ea : undefined, rider: kind === 'moto' ? 'traffic_police' : null, opts: kind === 'moto' ? { box: false, patrol: true, plate: 'PVPS' + (100 + (rnd() * 800 | 0)) } : kind === 'swat' || kind === 'riot' ? { dirt: .1, variant: kind === 'swat' ? 'armoured' : 'riot' } : { unit: 1 + (G.cops.length % 9) } });   /* js/cnvehicles.js: patrol scooter with mast lamp and panniers; riot truck and armoured van are their own bodies, not the plain van in two colours */
    c.cop = { unit: kind, state: state || 'respond', sees: false, d: 999, navT: 0, navEnd: 0, side: G.cops.length % 2 ? 1 : -1, loop: G.cops.length % 2 ? 'loopA' : 'loopB', searchT: 0, idT: 0, idx: G.cops.length, pitT: 0 };
    c.veh.locked = false; G.cops.push(c); emit('unit', { ent: c, unit: kind }); return c;
  }
  /* pt1: officers on foot. A unit that has run a man on foot down pulls up and puts one officer out (two from two stars, a shotgun from four): js/combat.js 'cop' with arrest: true —
     he runs the man down and holds him at arm's length with the gun pointed (wantedStep counts the hold as the arrest); hit an officer, pull a gun or fire, or reach three stars, and every
     officer fights (cover, bursts). They can be punched, clubbed and shot dead; a dead one drops his pistol and ammo (E). If the man drives off, or the heat is gone, the crew runs back and
     the unit drives on; a unit whose officers are all down is left where it stands, an empty police car anyone can take. */
  function dropCrew(c) { const K = c.cop, C = GT.combat, n = W.stars >= 2 && !c.two ? 2 : 1, s = sin(c.h), co = cos(c.h), hw = c.two ? .9 : ((c.dims && c.dims.W) || 1.9) / 2 + .75; K.crew = []; K.crewT = 0;
    for (let i = 0; i < n; i++) { const side = i ? 1 : -1, x = c.x + co * side * hw + s * (c.two ? 0 : .4), z = c.z - s * side * hw + co * (c.two ? 0 : .4), kind = W.stars >= 4 && i === 1 ? 'cop2' : 'cop';
      const e = safe('combat.spawn cop', () => C.spawn(kind, x, z, { h: Math.atan2(P.x - x, P.z - z), alert: true, noHeat: true, arrest: W.stars < 3, group: 'police', seed: (K.idx || 0) * 3 + i + 11 }), null); if (e) { e.unit = c; K.crew.push(e); } }
    if (!K.crew.length) { K.crew = null; K.noCrewT = G.time + 20; return; } if (c.rider && c.rider.group) c.rider.group.visible = false; if (W.stars >= 3) safe('copsLethal', () => C.copsLethal()); emit('copsOut', { n: K.crew.length }); }
  function crewStep(c, dt) { const K = c.cop, C = GT.combat; K.crewT += dt; aiDrive(c, c.x + sin(c.h) * 4, c.z + cos(c.h) * 4, 0, dt); c.lights.siren = true; c.lights.hazard = true; c.lights.head = ((GT.env && GT.env.night) || 0) > .3;
    K.crew = K.crew.filter(e => C.enemies.indexOf(e) >= 0); const alive = K.crew.filter(e => !e.dead);
    if (!alive.length) { K.crew = null; const i = G.cops.indexOf(c); if (i >= 0) G.cops.splice(i, 1); c.mode = 'parked'; c.v = 0; c.lights.siren = false; c.lights.hazard = true; G.vehDirty = true; emit('unitDown', { ent: c }); return; }   /* every officer of this unit is down: an empty police car left with its hazards on */
    if (W.stars >= 3) safe('copsLethal', () => C.copsLethal());
    const away = P.mode !== 'foot' && hyp(P.x - c.x, P.z - c.z) > 22, done = W.stars <= 0;
    if (away || done) { alive.forEach((e, k) => { if (!e.recall) { const sd = k ? 1 : -1; e.recall = { x: c.x + cos(c.h) * sd * 1.5, z: c.z - sin(c.h) * sd * 1.5 }; } if (e.boarded || hyp(e.x - P.x, e.z - P.z) > 75) C.remove(e); });
      if (alive.every(e => C.enemies.indexOf(e) < 0)) { K.crew = null; if (c.rider && c.rider.group) c.rider.group.visible = true; K.noCrewT = G.time + 8; K.state = W.hot ? 'pursue' : W.stars > 0 ? 'respond' : 'patrol'; } }
    else for (const e of alive) { e.recall = null; e.boarded = false; } }
  function spawnCopFar() {
    const cands = []; for (const lp of [PATHS.loopA, PATHS.loopB]) for (let k = 0; k < 14; k++) { const q = pathAt(lp, lp.len * (k + .37) / 14, {}); cands.push([lp, q.x, q.z]); }
    let best = null, bs = -1e9;
    for (const c of cands) { const dP = hyp(c[1] - P.x, c[2] - P.z); if (dP < 85) continue; const vis = los(c[1], c[2], P.x, P.z); if (vis && dP < 150) continue; let crowd = 0; for (const o of G.ents) if (hyp(o.x - c[1], o.z - c[2]) < 12) crowd = 1; if (crowd) continue;
      const sc = -hyp(c[1] - W.lastKnown.x, c[2] - W.lastKnown.z) - (vis ? 80 : 0) + rnd() * 40; if (sc > bs) { bs = sc; best = c; } }
    if (!best) return null;
    const nSwat = G.cops.filter(c => c.cop.unit === 'swat').length, nMoto = G.cops.filter(c => c.cop.unit === 'moto').length, ek = GT.economy && GT.economy.unitFor ? GT.economy.unitFor(G.cops) : null, kind = ek || (W.stars >= 5 && nSwat < 2 ? 'swat' : (W.stars < 2 || (nMoto < 1 && W.stars < 4)) ? 'moto' : 'police');   /* js/economy.js TIERS: which unit each of the four tiers sends (null in story missions: the old mix) */
    const s = pathNearest(best[0], best[1], best[2]), q = pathAt(best[0], s, {}), c = spawnCop(kind, best[1], best[2], q.h, W.hot ? 'pursue' : 'respond'); c.path = best[0]; c.s = s; c.v = 10; c.y = groundY(c.x, c.z, 0); return c;
  }
  /* NAV-BEGIN ---- off-lane navigation for the units (play reports b3-eco1 / b3-eco2: three scooters sat on the avenue behind the median rail for two minutes "seeing" a man on the riverside, and a runner on foot lost them).
     A 1 m grid over the whole map, filled lazily from GT.world.boxes with the same test the units collide with (solidFor, 0.35 m), one layer per clearance (scooter / car). navPlan is an A* over it that prefers the roadway and, when the
     target cannot be reached (a 2.6 m gate for a van), ends at the reachable cell nearest to it. navSeek follows the plan with a look-ahead to the furthest cell it can drive at in a straight line. */
  const NAV = { x0: -66, z0: -178, w: 236, h: 356, n: -1, free: null, road: null, g: null, came: null, seen: null, stamp: 0, hf: [], hi: [], planT: -9, range: 105, rad: [.7, 1.3], dx: [1, -1, 0, 0, 1, 1, -1, -1], dz: [0, 0, 1, -1, 1, -1, 1, -1] };
  function navReset() { const n = NAV.w * NAV.h; NAV.n = GT.world.boxes.length; NAV.free = [new Uint8Array(n), new Uint8Array(n)]; if (!NAV.g) { NAV.road = new Uint8Array(n); NAV.g = new Float32Array(n); NAV.came = new Int32Array(n); NAV.seen = new Int32Array(n); } }
  function navFree(k, ix, iz) {
    if (ix < 0 || iz < 0 || ix >= NAV.w || iz >= NAV.h) return false; if (NAV.n !== GT.world.boxes.length) navReset();
    const a = NAV.free[k], i = iz * NAV.w + ix; let v = a[i];
    if (!v) { const x = NAV.x0 + ix + .5, z = NAV.z0 + iz + .5, r = NAV.rad[k]; v = 1; if (inWater(x, z)) v = 2; else for (const b of nearBoxes(x, z, r + .1)) { if (!solidFor(b, .35)) continue; const qx = clamp(x, b.x0, b.x1), qz = clamp(z, b.z0, b.z1); if (hyp(x - qx, z - qz) < r) { v = 2; break; } } a[i] = v; }
    return v === 1;
  }
  const navIdx = (x, z) => clamp(Math.floor(z - NAV.z0), 0, NAV.h - 1) * NAV.w + clamp(Math.floor(x - NAV.x0), 0, NAV.w - 1);
  function navRoad(i) { if (!NAV.road) navReset(); let v = NAV.road[i]; if (!v) { v = inRoad(NAV.x0 + i % NAV.w + .5, NAV.z0 + (i / NAV.w | 0) + .5) ? 1 : 2; NAV.road[i] = v; } return v === 1; }
  /** can a unit of clearance class k (0 scooter, 1 car) drive the straight line a -> b? (the cell it stands in is not counted: it may be leaning on something) */
  function navClear(k, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, n = Math.ceil(hyp(dx, dz) / .5) || 1, sx = Math.floor(ax - NAV.x0), sz = Math.floor(az - NAV.z0);
    for (let i = 1; i <= n; i++) { const t = i / n, ix = Math.floor(ax + dx * t - NAV.x0), iz = Math.floor(az + dz * t - NAV.z0); if (ix === sx && iz === sz) continue; if (!navFree(k, ix, iz)) return false; } return true; }
  function navPush(f, i) { const hf = NAV.hf, hi = NAV.hi; let n = hf.length; hf.push(f); hi.push(i); while (n > 0) { const p = (n - 1) >> 1; if (hf[p] <= f) break; hf[n] = hf[p]; hi[n] = hi[p]; n = p; } hf[n] = f; hi[n] = i; }
  function navPop() { const hf = NAV.hf, hi = NAV.hi, top = hi[0], f = hf.pop(), i = hi.pop(), len = hf.length; if (len) { let n = 0; for (;;) { let c = n * 2 + 1; if (c >= len) break; if (c + 1 < len && hf[c + 1] < hf[c]) c++; if (hf[c] >= f) break; hf[n] = hf[c]; hi[n] = hi[c]; n = c; } hf[n] = f; hi[n] = i; } return top; }
  /** A* from (sx, sz) towards (tx, tz): an array of [x, z] cell centres, .reach = it ends at the target. null when the start is walled in. */
  function navPlan(k, sx, sz, tx, tz) {
    const w = NAV.w, h = NAV.h, cx = v => clamp(Math.floor(v - NAV.x0), 0, w - 1), cz = v => clamp(Math.floor(v - NAV.z0), 0, h - 1); navFree(k, 0, 0);
    let six = cx(sx), siz = cz(sz); const tix = cx(tx), tiz = cz(tz);
    if (!navFree(k, six, siz)) { let bd = 1e9, fx = -1, fz = 0; for (let r = 1; r <= 4 && fx < 0; r++) for (let ix = six - r; ix <= six + r; ix++) for (let iz = siz - r; iz <= siz + r; iz++) { if (!navFree(k, ix, iz)) continue; const d = hyp(ix + .5 + NAV.x0 - sx, iz + .5 + NAV.z0 - sz); if (d < bd) { bd = d; fx = ix; fz = iz; } } if (fx < 0) return null; six = fx; siz = fz; }
    const m = 48, x0 = max(0, min(six, tix) - m), x1 = min(w - 1, max(six, tix) + m), z0 = max(0, min(siz, tiz) - m), z1 = min(h - 1, max(siz, tiz) + m), g = NAV.g, came = NAV.came, seen = NAV.seen, st = (NAV.stamp += 2), DX = NAV.dx, DZ = NAV.dz;
    const H = (ix, iz) => { const a = abs(ix - tix), b = abs(iz - tiz); return max(a, b) + .4142 * min(a, b); };
    NAV.hf.length = NAV.hi.length = 0; const s0 = siz * w + six; g[s0] = 0; came[s0] = -1; seen[s0] = st; navPush(H(six, siz), s0); let best = s0, bh = H(six, siz), left = 16000;
    while (NAV.hi.length && left-- > 0) { const i = navPop(); if (seen[i] === st + 1) continue; seen[i] = st + 1; const ix = i % w, iz = (i / w) | 0, hh = H(ix, iz); if (hh < bh) { bh = hh; best = i; if (hh < .5) break; }
      for (let q = 0; q < 8; q++) { const dx = DX[q], dz = DZ[q], jx = ix + dx, jz = iz + dz; if (jx < x0 || jx > x1 || jz < z0 || jz > z1 || !navFree(k, jx, jz)) continue; if (dx && dz && !(navFree(k, jx, iz) && navFree(k, ix, jz))) continue;
        const j = jz * w + jx; if (seen[j] === st + 1) continue; const ng = g[i] + (dx && dz ? 1.4142 : 1) * (navRoad(j) ? 1 : 1.25); if (seen[j] === st && ng >= g[j]) continue; seen[j] = st; g[j] = ng; came[j] = i; navPush(ng + H(jx, jz), j); } }
    const out = []; for (let i = best; i >= 0; i = came[i]) out.push([NAV.x0 + i % w + .5, NAV.z0 + (i / w | 0) + .5]); out.reverse(); out.reach = bh < 1.5; return out;
  }
  /** drive unit c to (tx, tz) around whatever stands in the way and pull up `stop` metres short. True once it is there, or as near as its plan gets (K.nav.reach tells which). K.navV: the speed it asked for. */
  function navSeek(c, tx, tz, vT, dt, stop) {
    const K = c.cop, k = c.two ? 0 : 1, d = hyp(tx - c.x, tz - c.z), near = c.two ? 1.5 : 2.4; let nv = K.nav; stop = stop || 0;
    if (d < stop + .5) { K.navV = 0; aiDrive(c, tx, tz, 0, dt); return true; }
    const age = nv ? abs(G.time - nv.t) : 99, stale = !nv || age > 3.5 || (age > .9 && hyp(tx - nv.tx, tz - nv.tz) > 2.5 + d * .06) || (age > 2.5 && nv.i >= nv.pts.length - 1 && !nv.reach);
    if (stale && abs(G.time - NAV.planT) > .08) { NAV.planT = G.time; const pts = navPlan(k, c.x, c.z, tx, tz); nv = K.nav = pts ? { pts, i: 0, j: 0, lookT: 0, t: G.time, tx, tz, reach: pts.reach } : null; }
    if (!nv) { K.navV = min(vT, 4); aiDrive(c, tx, tz, K.navV, dt); return false; }
    const pts = nv.pts, n = pts.length - 1; while (nv.i < n && hyp(pts[nv.i][0] - c.x, pts[nv.i][1] - c.z) < near) nv.i++;
    if ((nv.lookT -= dt) <= 0 || nv.j < nv.i) { nv.lookT = .15; let j = nv.i; for (let q = min(n, nv.i + 18); q > nv.i; q--) if (navClear(k, c.x, c.z, pts[q][0], pts[q][1])) { j = q; break; } nv.j = j;
      let bi = nv.i, bd = 1e9; for (let q = nv.i; q <= j; q++) { const dd = hyp(pts[q][0] - c.x, pts[q][1] - c.z); if (dd < bd) { bd = dd; bi = q; } } nv.i = bi; }
    const last = nv.j === n, gx = last && nv.reach ? tx : pts[nv.j][0], gz = last && nv.reach ? tz : pts[nv.j][1], dd = hyp(gx - c.x, gz - c.z), pull = last ? (nv.reach ? stop : 0) : 0;
    const v = last ? (dd < pull + .5 ? 0 : min(vT, 2 + (dd - pull) * .8)) : min(vT, (c.two ? 5 : 4) + dd * .75, navRoad(navIdx(c.x, c.z)) ? 99 : (c.two ? 11 : 8));
    K.navV = v; aiDrive(c, gx, gz, v, dt); return last && dd < pull + near;
  }
  /* NAV-END */
  function navTo(c, tx, tz, vT, dt) {
    const K = c.cop, d = hyp(tx - c.x, tz - c.z), k = c.two ? 0 : 1;
    if (d < 36 && navClear(k, c.x, c.z, tx, tz)) { K.nav = null; K.navV = min(vT, 3 + d * .55); aiDrive(c, tx, tz, K.navV, dt); return d < 8; }
    if (d < NAV.range) return navSeek(c, tx, tz, vT, dt, 3);   /* inside 105 m the grid takes it there: across the median at a crossing, through a yard gate, down onto the promenade */
    K.navT -= dt;
    if (K.navT <= 0 || !c.path) { K.navT = 1.6; let best = null, bc = 1e9, bsc = 0, bst = 0, bdc = 0;
      for (const nm of ['loopA', 'loopB']) { const p = PATHS[nm], sc = pathNearest(p, c.x, c.z), dc = pathNearest.dist, hd = abs(angDiff(c.h, pathAt(p, sc, _q1).h)), stt = pathNearest(p, tx, tz), dtg = pathNearest.dist;
        const cost = ((stt - sc + p.len) % p.len) + dc * 2.5 + dtg + hd * 14 - (c.path === p ? 20 : 0); if (cost < bc) { bc = cost; best = p; bsc = sc; bst = stt; bdc = dc; } }
      if (c.path !== best || bdc > 3) { c.path = best; c.s = bsc; } K.navEnd = bst; }
    const rem = (K.navEnd - c.s + c.path.len) % c.path.len;
    if (rem < 7 || rem > c.path.len - 4) return navSeek(c, tx, tz, min(vT, 9), dt, 3);
    if (navRejoin(c, min(vT, 10), dt)) return false;
    K.nav = null; K.navV = vT; followPath(c, min(vT, 6 + rem * .5), dt, { noGap: true, noSignal: true }); return false;
  }
  /** a unit that is off its lane with something between it and the lane (the median rail, a row of trees): take the grid back to the lane first. True while it is doing that. */
  function navRejoin(c, vT, dt) { const q = pathAt(c.path, c.s + 5, _q1); if (hyp(q.x - c.x, q.z - c.z) < 3.4 || navClear(c.two ? 0 : 1, c.x, c.z, q.x, q.z)) return false;
    const K = c.cop; if ((K.rejT = (K.rejT || 0) - dt) <= 0) { K.rejT = 1.2; c.s = pathNearest(c.path, c.x, c.z); } const q2 = pathAt(c.path, c.s + 12, _q1); navSeek(c, q2.x, q2.z, vT, dt, 0); return true; }
  function copStep(c, dt) {
    const K = c.cop, night = (GT.env && GT.env.night) || 0, vmaxU = K.unit === 'moto' ? 15.5 : K.unit === 'swat' ? 22 : 30; let vWant = 0;
    if (K.crew) { crewStep(c, dt); return; }
    if (G.combatOn && G.visual && GT.combat && GT.combat.spawn && P.mode === 'foot' && W.hot && W.stars > 0 && K.state === 'pursue' && !(G.time < (K.noCrewT || 0))) { const d = hyp(P.x - c.x, P.z - c.z); if (d < 15 || (K.end && d < 40)) { K.stopping = true; } else if (d > 30) K.stopping = false; }
    if (K.stopping && !K.crew) { aiDrive(c, c.x + sin(c.h) * 4, c.z + cos(c.h) * 4, 0, dt); c.lights.siren = true; c.lights.brake = true; if (abs(c.v) < .7 || P.mode !== 'foot') { K.stopping = false; if (P.mode === 'foot') dropCrew(c); } return; }   /* pt1: pull up and get out */
    if (K.state === 'block') { c.v = 0; c.steer = 0; c.lights.siren = !K.quiet; c.lights.hazard = true; c.lights.head = night > .3; c.lights.brake = false; return; }   /* js/economy.js: a unit standing at a roadblock / checkpoint; it still sees (wantedStep) and can bust */
    c.lights.siren = K.state === 'pursue' || K.state === 'respond' || (K.state === 'search' && W.stars >= 2); c.lights.head = night > .3 || c.lights.siren; if (K.unit !== 'police') c.lights.hazard = c.lights.siren;
    if (W.hot) K.state = 'pursue'; else if (K.state === 'pursue') K.state = 'respond';
    K.end = false; let offLane = false;
    if (K.state === 'patrol') { if (!c.path || !c.path.closed) setPath(c, PATHS[K.loop]); if (navRejoin(c, 8, dt)) { offLane = true; vWant = K.navV; } else { K.nav = null; followPath(c, 10, dt); vWant = 10; } }
    else if (K.state === 'respond') { const there = navTo(c, W.lastKnown.x, W.lastKnown.z, vmaxU * .85, dt); vWant = K.navV === undefined ? vmaxU * .85 : K.navV; if (!there) K.lookT = 0; else if ((K.lookT = (K.lookT || 0) + dt) > 3.2) { K.lookT = 0; K.state = 'search'; K.searchT = 0; K.nav = null; setPath(c, PATHS[K.loop]); } }   /* at the spot the call came from it stops and looks round for three seconds (wantedStep: that look is what recognises whoever is standing there) before it starts circling */
    else if (K.state === 'search') { K.searchT += dt; if (!c.path || !c.path.closed) setPath(c, PATHS[K.loop]); if (navRejoin(c, 9, dt)) { offLane = true; vWant = K.navV; } else { K.nav = null; vWant = 11; followPath(c, 11.5, dt, { noSignal: W.stars >= 2 }); } if (W.stars <= 0) K.state = 'patrol'; }
    else if (K.state === 'pursue') {
      const d = hyp(P.x - c.x, P.z - c.z), direct = K.sees || (d < 45 && !(W.cover && d > BAY.far) && los(c.x, c.z, P.x, P.z, .5)), foot = P.mode === 'foot', nk = c.two ? 0 : 1; K.pitT -= dt;
      if (direct) { const psp = foot ? 0 : max(0, P.speed), fsp = foot && !(P.down > 0) ? hyp(P.vx || 0, P.vz || 0) : 0, s = sin(P.h), co = cos(P.h), rel = (c.x - P.x) * s + (c.z - P.z) * co; let tx, tz, vT;
        if (fsp > 2.2 && fsp < 12) { const ux = P.vx / fsp, uz = P.vz / fsp, gap = (P.x - c.x) * ux + (P.z - c.z) * uz, far = max(7, d * .8), sd = K.side * (1.3 + (K.idx % 3) * .5); tx = P.x + ux * far + uz * sd; tz = P.z + uz * far - ux * sd; vT = clamp(fsp + clamp((gap - K.idx % 3 * 1.6) * 1.1, -2.5, 8), 0, vmaxU); }   /* a man running: ride him down. It steers for a point well ahead of him on a line a pace to his side (a shallow closing angle) and takes its speed from how far behind him it still is, so it ends up level with his shoulder at his own pace — where wantedStep's grab counts. (It used to cap at 7 m/s against a 6.3 m/s sprint.) */
        else if (psp < 3) { const a = K.idx * 2.1 + 1, rr = foot ? 4.2 : 5.6; tx = P.x + sin(P.h + a) * rr; tz = P.z + cos(P.h + a) * rr; const dd = hyp(tx - c.x, tz - c.z); vT = dd > 2 && d > rr - .4 ? min(foot ? 8 : 9, 2 + dd) : 0; if (d < rr + .9) vT = 0; }   // box in
        else if (d > 34) { const lead = clamp(d / 30, 0, 1.2); tx = P.x + P.vx * lead; tz = P.z + P.vz * lead; vT = min(vmaxU, psp + 10); }
        else if (K.pitT > 0 && psp > 9 && P.mode === 'car') { tx = P.x - s * 1.3 + co * K.side * 1.15; tz = P.z - co * 1.3 - s * K.side * 1.15; vT = psp + 5; }
        else if (rel > -3) { tx = P.x + s * 9 + co * K.side * 3.2; tz = P.z + co * 9 - s * K.side * 3.2; vT = max(4, psp - 2.5); }
        else { const back = 7 + (K.idx % 3) * 5, lat = K.idx % 3 ? K.side * 2.2 : 0; tx = P.x - s * back + co * lat; tz = P.z - co * back - s * lat; vT = min(vmaxU, psp + clamp((hyp(tx - c.x, tz - c.z) - 1.5) * .7, -3, 7));
          if (K.pitT < -(K.pitCd || 4) && W.stars >= 3 && d < 19 && psp > 10 && K.unit !== 'moto') { K.pitT = 2.4; K.pitCd = 5 + rnd() * 5; } }
        if (navClear(nk, c.x, c.z, tx, tz)) { K.nav = null; vWant = vT; aiDrive(c, tx, tz, vT, dt); }
        else { K.end = navSeek(c, P.x, P.z, min(vmaxU, max(vT, c.two ? 9 : 7)), dt, foot ? 3.4 : 5) && !(K.nav && K.nav.reach && d < 7); vWant = K.navV; }   /* something low stands between them (median rail, bollards, planters, a gate): go round it. K.end: this is as near as the unit can get — wantedStep lets it make the stop from there */
      }
      else { K.end = navTo(c, W.lastKnown.x, W.lastKnown.z, vmaxU * .9, dt) && !!K.nav && !K.nav.reach; vWant = K.navV === undefined ? vmaxU * .9 : K.navV; }
    }
    if ((K.state !== 'patrol' && K.state !== 'search') || offLane) { aiCollideWorld(c); if (abs(c.v) < 1.2 && vWant > 3 && c.revT <= 0) { c.stuckT += dt; if (c.stuckT > 1.5) { c.revT = 1.3; c.stuckT = 0; } } else c.stuckT = 0; }
    c.lights.brake = c.brakeOn; c.y = damp(c.y, groundY(c.x, c.z, c.y + .3), 12, dt);
  }
  function policeStep(dt) {
    if (!W.enabled) return; W.spawnT -= dt;
    const et = GT.economy && GT.economy.tier ? GT.economy.tier() : null, nAct = G.cops.reduce((n, c) => n + (c.cop.state === 'block' ? 0 : 1), 0);   /* js/economy.js: the tier sets how many units chase; units standing at a block do not count */
    const want = W.stars <= 0 ? 0 : et ? (W.hot ? et.count : max(1, et.count - 1)) : (W.hot ? clamp(Math.ceil(W.stars), 1, 4) : clamp(Math.ceil(W.stars * .75), 1, 3));
    if (nAct < want && W.spawnT <= 0) { if (spawnCopFar()) W.spawnT = W.hot ? 4 : 6; else W.spawnT = 1.5; }
    if (W.stars <= 0 && G.cops.length && W.spawnT <= 0) { for (const c of G.cops) if (!c.cop.keep && (hyp(c.x - P.x, c.z - P.z) > 150 || !los(c.x, c.z, P.x, P.z))) { removeEnt(c); W.spawnT = 2; break; } }
    for (const c of G.cops.slice()) copStep(c, dt);
  }

  /* ================================================================== economy: GT.wallet in $, stalls (eat = heal), corner shop, re-plating, shared bikes */
  function wallet() { if (!GT.wallet) { const cbs = []; GT.wallet = { cash: 0, add(n, why) { this.cash = Math.round((this.cash + n) * 10) / 10; cbs.forEach(cb => { try { cb(this.cash, n, why); } catch (e) { /* listener */ } }); }, spend(n) { if (this.cash + 1e-9 < n) return false; this.add(-n, 'spend'); return true; }, on(cb) { cbs.push(cb); } }; } return GT.wallet; }
  const STALLS = {     // anchor stall_<id> (js/snackstreet.js): [dish, price $, heal, vendor line]
    reganmian: ['热干面', 8, 40, '拐子哥：芝麻酱管够！'], shengjian: ['生煎（四只）', 12, 45, '小心烫，汤先嘬。'], shaokao: ['烧烤（五串）', 15, 50, '辣不辣？微辣是底线。'], choudoufu: ['臭豆腐', 10, 35, '闻着臭，吃着香。'],
    xiaomian: ['红油小面', 9, 40, '二两，加青！'], doupi: ['三鲜豆皮', 9, 40, '刚出锅的。'], tangshui: ['绿豆糖水', 6, 25, '冰的，慢点喝。'], jianbing: ['煎饼果子', 8, 35, '加蛋加肠？'],
    fruit: ['切好的西瓜', 6, 20, '保甜。'], baozi: ['鲜肉包（两个）', 5, 30, '趁热。'], luwei: ['卤味拼盘', 18, 55, '鸭脖多给你两节。'], liangcha: ['凉茶', 4, 15, '下火的。'], chaofen: ['炒粉', 12, 45, '锅气足得很。']
  };
  function addSpot(s) { if (!G.visual) return; if (GT.act && GT.act.add) safe('act.add', () => GT.act.add(s)); else (GT._actQueue = GT._actQueue || []).push(s); }
  function buy(name, price, healN, line, who) {
    if (GT.economy && GT.economy.price) price = safe('eco.price', () => GT.economy.price(price), price);   /* 市井威望: the stalls knock a bit off for a face they know */
    if (!wallet().spend(price)) { say(who || '摊主', '差' + money(price - wallet().cash) + '。先去跑两单？'); emit('broke', { name, price }); return false; }
    heal(healN); if (line) say(who || '摊主', line); if (G.visual) HUD.toast(name, '−' + money(price)); emit('buy', { name, price, heal: healN }); return true;
  }
  function say(who, text, sec, o) { if (!G.visual || G.silent || !text) return; if (who && !(o && o.bark)) return;   /* no spoken lines: dialogue was removed (2026-11-17). who === '' is a functional notice; {bark: true} is a bystander's one-word cry */ if (G.ctl && G.ctl.say) safe('say', () => G.ctl.say(who, text, sec)); else if (GT.front && GT.front.subtitle) safe('subtitle', () => GT.front.subtitle(who, text, sec)); }
  function registerSpots() {
    for (const id in STALLS) { const a = GT.world.anchors['stall_' + id]; if (!a) continue; const d = STALLS[id];
      addSpot({ id: 'cn:eat:' + id, x: a.x, z: a.z, r: 1.5, label: '买' + d[0] + ' ' + money(d[1]), onUse: () => buy(d[0], d[1], d[2], d[3], id === 'reganmian' ? '拐子哥' : '摊主') }); }
    const spot = (id, names, fb, label, fn, o) => { const a = anchor(names, fb); if (!a) return; addSpot(Object.assign({ id, x: a.x, z: a.z, r: 1.6, label, onUse: fn }, o)); };
    spot('cn:eat:noodle', 'noodleCashier', null, '堂食热干面 ' + money(8), () => buy('热干面', 8, 45, '搞么斯？面来了，趁热！', '拐子哥'));
    spot('cn:eat:hotpot', 'hotpotCashier', null, '单人小火锅 ' + money(38), () => buy('单人小火锅', 38, 100, '要得！莫慌，先吃。', '辣姐'));
    spot('cn:eat:mange', ['mangeFront', 'mange'], null, '满哥臭豆腐 ' + money(10), () => buy('臭豆腐', 10, 40, '恰了冒？多放辣椒哒。', '满哥'), { enabled: () => G.hours >= 17.5 || G.hours < 2.5 });
    spot('cn:eat:bbq', 'bbqFront', null, '夜市烧烤 ' + money(20), () => buy('烧烤拼盘', 20, 60, '腰子要不要？'), { enabled: () => G.hours >= 17.5 || G.hours < 2.5 });
    spot('cn:shop:mask', 'cornerShop', null, () => (P.mask ? '摘下口罩' : '买口罩 ' + money(5)), () => { if (!P.mask && !buy('一次性口罩', 5, 0, '十个一包，拆开卖你一个。', '小卖部')) return; setMask(!P.mask); });
    // re-plate at the key-cutter's drive-in bay on the courtyard lane (BAY, anchor replateBay): a new plate and a quick wrap, so the 车 and 牌 on file stop matching
    buildBay(); GT.world.anchor('replateBay', { x: BAY.x, z: BAY.z, h: PI / 2 });
    addSpot({ id: 'cn:replate', x: BAY.x, z: BAY.z, r: 4.4, hold: 1.2, mode: 'both', label: () => '换牌贴膜 ' + money(200), enabled: () => { const t = replateTarget(); return !!t && !(t.wrapT !== undefined && G.time - t.wrapT < 120); }, onUse: () => replate() });   /* a car that has just been done is not offered again for two minutes: the prompt goes when the plate is on */
    for (const e of G.ents) if (e.kind === 'sharebike' && e.locked) bikeSpot(e);
  }
  /* ---- 换牌车位: the key-cutter's drive-in bay on the courtyard lane, 26 m inside the gate (the booth itself sits in the pedestrian corner of the yard, where no car can get). A cantilevered tin canopy off the
     south wall, a bench with the key machine, a board of blank plates, film rolls, a lit sign; when a vehicle stops inside, a tarp curtain drops along the lane side. While it is down (W.cover) a patrol further
     than 26 m away cannot make the vehicle out, so a tail can be waited out here instead of looping forever; one that followed you in still can. */
  const BAY = { x: 48.5, z: 58.4, x0: 46.2, x1: 50.8, z0: 55.9, z1: 60.1, far: 26, curtain: null, k: 0, lamp: null };
  const inBay = () => (P.mode === 'car' || P.mode === 'two') && P.speed < 2.2 && P.x > BAY.x0 && P.x < BAY.x1 && P.z > BAY.z0 && P.z < BAY.z1;
  function buildBay() {
    GT.world.addBox(46.0, 53.3, 51.0, 54.75, 1.1, 'replate-bench'); for (const x of [44.4, 52.6]) GT.world.addPost(x, 53.75, .07, 3.2, 'replate-post');
    if (!G.visual || !G.scene) return; safe('buildBay', () => {
      const k = GT.kit(), y0 = groundY(BAY.x, 55, 0), root = new T.Group(), tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.anisotropy = 4; return t; }, F = '"PingFang SC","Microsoft YaHei",sans-serif';
      /* frame: two posts at the wall, raking arms out over the lane, tie rods back to the post heads, purlins, tin roof with a fall towards the lane */
      for (const x of [44.4, 52.6]) { k.cyl('metal_galv', .06, .07, 3.6, x, y0 + 1.8, 53.75, { seg: 10 }); k.box('concrete', .34, .16, .34, x, y0 + .08, 53.75, { bevel: .02 }); k.box('metal_galv', .08, .12, 7.5, x, y0 + 2.98, 57.4, { bevel: .01, rx: .062 }); k.cyl('metal_dark', .014, .014, 5.3, x, y0 + 3.3, 56.3, { seg: 6, rx: PI / 2 + .118 }); k.cyl('metal_dark', .014, .014, 2.6, x, y0 + 2.0, 54.7, { seg: 6, rx: .75 }); }
      for (let i = 0; i < 5; i++) k.box('metal_galv', 8.9, .05, .07, BAY.x, y0 + 3.26 - i * .105, 53.9 + i * 1.72, { bevel: .008 });
      k.box('corrugated_metal', 9.2, .035, 7.7, BAY.x, y0 + 3.12, 57.4, { rx: .062 }); k.box('metal_dark', 9.24, .09, .05, BAY.x, y0 + 2.86, 61.24, { bevel: .01 }); k.box('metal_galv', 9.2, .1, .1, BAY.x, y0 + 2.9, 61.15, { bevel: .03 });
      /* bench against the wall: vice, key machine, blanks, a tray of screws; drawers under it */
      k.box('wood_plank', 4.6, .07, 1.05, BAY.x, y0 + .92, 54.05, { bevel: .012 }); for (const x of [46.35, 48.5, 50.65]) for (const z of [53.62, 54.5]) k.box('metal_dark', .06, .9, .06, x, y0 + .45, z, { bevel: .008 }); k.box('metal_painted_blue', 1.5, .62, .86, 49.75, y0 + .5, 54.05, { bevel: .015 }); for (let i = 0; i < 3; i++) { k.box('metal_dark', 1.36, .012, .012, 49.75, y0 + .34 + i * .19, 54.49); k.box('chrome', .22, .025, .03, 49.75, y0 + .43 + i * .19, 54.5, { bevel: .006 }); }
      k.box('metal_painted_red', .42, .3, .34, 47.2, y0 + 1.11, 54.0, { bevel: .03 }); k.cyl('metal_dark', .09, .09, .05, 47.2, y0 + 1.19, 54.21, { seg: 14, rx: PI / 2 }); k.cyl('chrome', .02, .02, .34, 47.48, y0 + 1.24, 54.0, { seg: 8, rz: PI / 2 }); k.box('metal_dark', .2, .13, .26, 46.5, y0 + 1.02, 53.95, { bevel: .015 }); k.box('chrome', .05, .1, .3, 46.5, y0 + 1.12, 54.02, { bevel: .008 }); k.cyl('chrome', .012, .012, .3, 46.5, y0 + 1.12, 54.26, { seg: 6, rz: PI / 2 });
      k.box('plastic_grey', .5, .06, .34, 48.3, y0 + .985, 54.15, { bevel: .01 }); for (let i = 0; i < 9; i++) k.cyl('chrome', .012, .012, .02, 48.12 + (i % 3) * .17, y0 + 1.02, 54.06 + ((i / 3) | 0) * .09, { seg: 6 });
      /* film rolls standing in a rack, a stack of two tyres, a stool, the heat gun on its cable */
      const rolls = [0x1c1c20, 0xc7c9cc, 0x2f6a4a, 0x7a1f1c, 0x24406e, 0xd0a020]; rolls.forEach((c, i) => { const m = GT.mat('car_paint', { color: c }); k.cyl(m, .085, .085, 1.5, 51.25 - (i % 2) * .2, y0 + .78, 54.2 + i * .21, { seg: 12, rx: .09 }); k.cyl('plastic_black', .03, .03, 1.54, 51.25 - (i % 2) * .2, y0 + .78, 54.2 + i * .21, { seg: 8, rx: .09 }); }); k.box('metal_dark', .5, .05, 1.5, 51.15, y0 + .04, 54.75, { bevel: .01 }); k.box('metal_dark', .03, .7, 1.5, 51.42, y0 + .37, 54.75);
      for (let i = 0; i < 2; i++) { k.geo('rubber', new T.TorusGeometry(.25, .11, 8, 18), { x: 45.75, y: y0 + .12 + i * .23, z: 54.9, rx: PI / 2 }); } k.cyl('plastic_red', .16, .14, .44, 47.6, y0 + .22, 55.35, { seg: 12 }); k.cyl('plastic_red', .17, .17, .03, 47.6, y0 + .45, 55.35, { seg: 12 });
      k.box('plastic_black', .07, .2, .07, 48.95, y0 + 1.06, 54.3, { bevel: .015, rz: .5 }); k.cyl('metal_dark', .022, .03, .2, 49.06, y0 + 1.13, 54.3, { seg: 8, rz: -1.07 }); k.tube('rubber', [[48.9, y0 + .97, 54.3], [48.6, y0 + .96, 54.45], [48.3, y0 + 1.6, 53.6], [48.5, y0 + 2.9, 53.5]], .008, { seg: 4 });
      /* the bay on the ground: hatched box and stop bar */
      for (const [w, d, x, z] of [[9, .1, BAY.x, 56.05], [9, .1, BAY.x, 60.75], [.1, 4.8, 44.0, 58.4], [.1, 4.8, 53.0, 58.4]]) k.box('road_paint_yellow', w, .012, d, x, y0 + .05, z); for (let i = 0; i < 8; i++) k.box('road_paint_yellow', .09, .012, 1.5, 44.9 + i * 1.03, y0 + .05, 56.75, { ry: .7 });
      root.add(k.build());
      /* pegboard of plates on the wall (blank blue and green ones, invented numbers) */
      const board = new T.Mesh(new T.PlaneGeometry(3.3, 1.5), new T.MeshStandardMaterial({ roughness: .8, metalness: .05, map: tex(660, 300, (g, w, h) => { g.fillStyle = '#5b4a36'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.28)'; for (let y = 10; y < h; y += 14) for (let x = 10; x < w; x += 14) { g.beginPath(); g.arc(x, y, 1.7, 0, TAU); g.fill(); }
        const pl = [['江A·7K2M9', '#1f4fa8', '#fff'], ['江A·D30L8', '#2f8f52', '#101010'], ['江A·   ', '#1f4fa8', '#fff'], ['江A·Q61X4', '#1f4fa8', '#fff'], ['江城 58213', '#e6e2d6', '#101010'], ['江A·   ', '#2f8f52', '#101010'], ['江A·3W09P', '#d8b21e', '#101010'], ['江A·N4T77', '#1f4fa8', '#fff']];
        pl.forEach((p, i) => { const x = 18 + (i % 4) * 160, y = 26 + ((i / 4) | 0) * 132, r = ((i * 37) % 7 - 3) * .012; g.save(); g.translate(x + 72, y + 24); g.rotate(r); g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(-70, -20, 146, 50); g.fillStyle = p[1]; g.fillRect(-72, -24, 146, 50); g.strokeStyle = p[2]; g.lineWidth = 2; g.strokeRect(-68, -20, 138, 42); g.fillStyle = p[2]; g.font = '700 26px ' + F; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p[0], 1, 2); g.restore(); });
        g.fillStyle = '#efe6cf'; g.fillRect(250, 96, 164, 26); g.fillStyle = '#7a1f1c'; g.font = '700 17px ' + F; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('现配现取 · 不问来路', 332, 110); }) })); board.position.set(48.0, y0 + 1.95, 53.085); root.add(board);
      /* lit sign on the canopy edge, facing the lane; price card hanging under it */
      const sm = new T.MeshBasicMaterial({ fog: false, map: tex(1024, 176, (g, w, h) => { g.fillStyle = '#10151c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffb21e'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16); g.shadowColor = '#ff7a1a'; g.shadowBlur = 22; g.fillStyle = '#ffd24a'; g.font = '900 104px ' + F; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText('配钥匙  换牌  贴膜', w / 2, h / 2 + 6); }) });
      if (GT.glow) GT.glow(sm, new T.Color(1, 1, 1), .55, 2.4); const sign = new T.Mesh(new T.PlaneGeometry(4.4, .76), sm); sign.position.set(BAY.x, y0 + 3.02, 61.29); root.add(sign); const signB = new T.Mesh(GT.boxGeo(4.5, .84, .1, .02), GT.mat('metal_dark')); signB.position.set(BAY.x, y0 + 3.02, 61.22); root.add(signB);
      const card = new T.Mesh(new T.PlaneGeometry(.62, .86), new T.MeshStandardMaterial({ roughness: .9, side: T.DoubleSide, map: tex(248, 344, (g, w, h) => { g.fillStyle = '#f1e7c9'; g.fillRect(0, 0, w, h); g.fillStyle = '#a3261f'; g.font = '900 40px ' + F; g.textAlign = 'center'; g.fillText('价目', w / 2, 52); g.fillStyle = '#1b1b1b'; g.font = '700 25px ' + F; g.textAlign = 'left'; [['配钥匙', '$5'], ['开锁', '$80'], ['换牌贴膜', '$200'], ['不问 不记', '']].forEach((r, i) => { g.fillText(r[0], 22, 112 + i * 54); g.textAlign = 'right'; g.fillText(r[1], w - 22, 112 + i * 54); g.textAlign = 'left'; }); g.strokeStyle = '#a3261f'; g.lineWidth = 3; g.strokeRect(8, 8, w - 16, h - 16); }) })); card.position.set(44.95, y0 + 2.2, 55.3); card.rotation.y = .5; root.add(card);
      /* caged work lamp under the roof */
      const bulb = new T.Mesh(new T.SphereGeometry(.07, 10, 8), new T.MeshBasicMaterial({ color: new T.Color(3, 2.3, 1.3), fog: false })); bulb.position.set(BAY.x, y0 + 2.62, 56.6); root.add(bulb); if (GT.glow) GT.glow(bulb.material, new T.Color(1, .78, .45), .6, 3.4);
      /* no real light (every lit surface in the city would pay for it): a warm pool on the ground under the lamp, additive, faded in at night */
      const pool = new T.Mesh(new T.CircleGeometry(4.6, 40), new T.MeshBasicMaterial({ map: tex(128, 128, (g, w) => { const q = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); q.addColorStop(0, 'rgba(255,206,140,.9)'); q.addColorStop(.5, 'rgba(255,190,120,.35)'); q.addColorStop(1, 'rgba(255,180,110,0)'); g.fillStyle = q; g.fillRect(0, 0, w, w); }), transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false })); pool.rotation.x = -PI / 2; pool.scale.set(1, .8, 1); pool.position.set(BAY.x, y0 + .058, 57.2); pool.renderOrder = 3; root.add(pool); BAY.lamp = pool;
      /* blade sign on the west post, square to the lane: what a driver coming in from the gate reads first */
      const blade = new T.Mesh(new T.PlaneGeometry(1.5, .56), new T.MeshBasicMaterial({ fog: false, side: T.DoubleSide, map: tex(384, 144, (g, w, h) => { g.fillStyle = '#7a1512'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffd24a'; g.lineWidth = 5; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = '#ffe9a8'; g.font = '900 78px ' + F; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('换牌贴膜', w / 2, h / 2 + 4); }) })); if (GT.glow) GT.glow(blade.material, new T.Color(1, 1, 1), .6, 2); blade.rotation.y = -PI / 2; blade.position.set(44.4, y0 + 2.45, 55.0); root.add(blade); k2: { const kb = GT.kit(); kb.box('metal_dark', .05, .62, 1.56, 44.43, y0 + 2.45, 55.0, { bevel: .01 }); kb.box('metal_galv', .04, .04, .5, 44.4, y0 + 2.8, 54.2); root.add(kb.build()); }
      /* the curtain: a pleated tarp on the lane side with two short returns, rolled up under the canopy edge until a vehicle stops inside */
      const cur = new T.Group(), curTex = tex(512, 512, (g, w, h) => { /* (shops lane) the tarp is no longer one flat blue: woven polythene with seams, eyelets, sun-fade, patches and road dirt up from the hem */ const q = GT.rng('baycurtain'); g.fillStyle = '#3f6f8f'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 40; i++) { const x = q() * w, ww = 6 + q() * 30, f = g.createLinearGradient(x, 0, x + ww, 0); f.addColorStop(0, 'rgba(0,0,0,0)'); f.addColorStop(.5, q() < .55 ? 'rgba(6,18,30,.3)' : 'rgba(190,220,240,.2)'); f.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = f; g.fillRect(x, 0, ww, h); }
        g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1; for (let y = 0; y < h; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } for (const x of [0, w / 2]) { g.fillStyle = 'rgba(16,36,54,.55)'; g.fillRect(x, 0, 7, h); g.fillStyle = 'rgba(210,230,245,.25)'; g.fillRect(x + 7, 0, 2, h); }
        g.fillStyle = 'rgba(20,40,60,.6)'; g.fillRect(0, 0, w, 20); for (let x = 20; x < w; x += 64) { g.fillStyle = '#c9ced4'; g.beginPath(); g.arc(x, 10, 6, 0, 7); g.fill(); g.fillStyle = '#0c1014'; g.beginPath(); g.arc(x, 10, 3, 0, 7); g.fill(); }
        for (let i = 0; i < 16; i++) { g.fillStyle = 'rgba(150,190,215,' + (q() * .2).toFixed(2) + ')'; g.beginPath(); g.ellipse(q() * w, q() * h * .7, 20 + q() * 60, 14 + q() * 40, q() * 3, 0, 7); g.fill(); } for (let i = 0; i < 4; i++) { const x = q() * (w - 80), y = 120 + q() * 260; g.fillStyle = ['#6f95ad', '#2f5a78', '#d8d4c6', '#b8261f'][i]; g.fillRect(x, y, 40 + q() * 40, 30 + q() * 30); g.strokeStyle = 'rgba(10,20,30,.5)'; g.setLineDash([5, 4]); g.strokeRect(x + 3, y + 3, 34, 24); g.setLineDash([]); }
        const mud = g.createLinearGradient(0, h * .62, 0, h); mud.addColorStop(0, 'rgba(60,50,36,0)'); mud.addColorStop(1, 'rgba(52,42,30,.8)'); g.fillStyle = mud; g.fillRect(0, h * .62, w, h * .38); for (let i = 0; i < 300; i++) { g.fillStyle = 'rgba(52,42,30,' + (.2 + q() * .5).toFixed(2) + ')'; g.beginPath(); g.arc(q() * w, h * (1 - q() * q() * .4), 1 + q() * 4, 0, 7); g.fill(); } }),
        curSet = (curTex.encoding = T.sRGBEncoding, curTex.wrapS = T.RepeatWrapping, curTex.repeat.set(3, 1), 1), cm = new T.MeshStandardMaterial({ color: 0xffffff, map: curTex, roughness: .78, metalness: 0, side: T.DoubleSide, emissive: new T.Color(1, .78, .5), emissiveMap: curTex, emissiveIntensity: .1 * curSet }), pleat = (w, n) => { const g = new T.PlaneGeometry(w, 1, n, 6), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, sin(x * 5.2) * .05 + sin(x * 1.7 + y * 2.2) * .03); p.setY(i, y - .5); } g.computeVertexNormals(); return g; };
      const front = new T.Mesh(pleat(9.2, 56), cm); front.position.set(BAY.x, 0, 61.1); cur.add(front); for (const x of [43.92, 53.08]) { const sd = new T.Mesh(pleat(3.4, 20), cm); sd.rotation.y = PI / 2; sd.position.set(x, 0, 59.4); cur.add(sd); } cur.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      cur.position.y = y0 + 2.84; cur.scale.y = .12; root.add(cur); BAY.curtain = cur; BAY.y0 = y0; G.scene.add(root); BAY.root = root; });
  }
  function bayStep(dt) { const cov = inBay(); W.cover = cov; const want = cov ? 1 : 0; if (BAY.k !== want) { const k0 = BAY.k; BAY.k = want > BAY.k ? min(1, BAY.k + dt / .7) : max(0, BAY.k - dt / .9); if (G.visual && !G.silent && k0 === 0 && want && W.stars > 0) { safe('sfx', () => GT.audio && GT.audio.sfx && GT.audio.sfx('thunk')); HUD.toast('帘子放下来了', '外头看不清这台车'); } }
    if (BAY.curtain) { const e = BAY.k * BAY.k * (3 - 2 * BAY.k); BAY.curtain.scale.y = .12 + 2.5 * e; } if (BAY.lamp) BAY.lamp.material.opacity = .34 * clamp((((GT.env && GT.env.night) || 0) - .25) * 3, 0, 1); }
  /* ---- the hero's scooter: a live read-out over the dash screen (the model's own screen is a baked '25'). A small emissive plane in the steering group, redrawn when the number or the battery bar changes. */
  const DASH = { mesh: null, ent: null, key: '', cv: null, g: null, tex: null };
  function dashStep() { const e = G.scooter; if (!G.visual || !e || !e.veh || !e.veh.group) return;
    if (DASH.ent !== e) { DASH.ent = e; DASH.mesh = null; safe('dash.build', () => { const st = e.veh.group.getObjectByName('steer'), host = st && st.children[0]; if (!host) return; const cv = DASH.cv = document.createElement('canvas'); cv.width = 200; cv.height = 125; DASH.g = cv.getContext('2d'); DASH.tex = new T.CanvasTexture(cv); DASH.tex.anisotropy = 4;
        const m = new T.Mesh(new T.PlaneGeometry(.1, .0625), new T.MeshBasicMaterial({ map: DASH.tex, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); m.rotation.order = 'YXZ'; m.rotation.set(.35 - PI / 2, PI, 0); m.position.set(0, 1.0855 + .0019, .2894 - .0007); m.renderOrder = 2; host.add(m); DASH.mesh = m; DASH.key = ''; }); }
    if (!DASH.mesh) return; const kmh = Math.round(abs(e.v || 0) * 3.6), bars = Math.ceil(clamp(G.battery, 0, 1) * 5), on = e === P.ent || e.mode === 'player', key = (on ? kmh : -1) + ':' + bars; if (key === DASH.key) return; DASH.key = key;
    const g = DASH.g; g.fillStyle = '#05080a'; g.fillRect(0, 0, 200, 125); if (on) { g.fillStyle = '#5fe3ff'; g.textBaseline = 'middle'; g.textAlign = 'right'; g.font = '700 74px "Helvetica Neue",Arial,sans-serif'; g.fillText(String(kmh), 118, 56); g.font = '700 19px "Helvetica Neue",Arial,sans-serif'; g.textAlign = 'left'; g.fillText('km/h', 124, 74); }
    for (let k = 0; k < 5; k++) { g.globalAlpha = k < bars ? (on ? 1 : .35) : .14; g.fillStyle = bars <= 1 ? '#ff5a3c' : '#36d671'; g.fillRect(22 + k * 32, 98, 26, 12); } g.globalAlpha = 1; DASH.tex.needsUpdate = true; }
  function setMask(on) { P.mask = !!on; if (G.kai && G.kai.setMask) safe('setMask', () => G.kai.setMask(P.mask)); emit('mask', { on: P.mask }); }
  const replateTarget = () => { if (P.ent && (P.mode === 'car' || P.mode === 'two')) return P.ent; let best = null, bd = 6; for (const e of G.ents) { if (e.cop || e.mode !== 'parked') continue; const d = hyp(e.x - P.x, e.z - P.z); if (d < bd) { bd = d; best = e; } } return best; };
  /** the wrap: matte graphite film over whatever the paint was. wrap(ent) -> true when the body was recoloured (visual builds only; ent.wrapped is set either way) */
  function wrap(e) { if (!e) return false; e.wrapped = true; e.color = 0x5b6066; if (!G.visual || !e.veh || !e.veh.meshes) return false; return !!safe('wrap', () => { let k = 0; for (const nm in e.veh.meshes) { const me = e.veh.meshes[nm], mt = me && me.material; if (!mt || !/paint$/.test(nm) || !mt.color) continue; const m2 = mt.userData && mt.userData.gtWrap ? mt : mt.clone(); if (m2 !== mt) { m2.onBeforeCompile = mt.onBeforeCompile; if (mt.customProgramCacheKey) m2.customProgramCacheKey = mt.customProgramCacheKey; m2.userData = Object.assign({}, mt.userData, { gtWrap: true }); }
        m2.color.copy(GT.C ? GT.C(0x5b6066) : new T.Color(0x5b6066)); m2.roughness = .82; m2.metalness = .12; if (m2.clearcoat !== undefined) { m2.clearcoat = .04; m2.clearcoatRoughness = .7; } m2.envMapIntensity = .22; m2.needsUpdate = true; me.material = m2; k++; } return k > 0; }, false); }
  function replate(e) { e = e || replateTarget(); if (!e) return false; if (W.hot) { say('配钥匙的师傅', '后头跟着巡逻车，你莫害我。停进黄线框里，等帘子放下来。'); return false; } if (!(GT.economy && GT.economy.payCash ? GT.economy.payCash(200) : wallet().spend(200))) { say('配钥匙的师傅', '两百，少一分都不贴。现金。'); return false; }
    e.plate = plateGen(e.two); e.paint++; e.wrapT = G.time; if (!e.two) wrap(e); if (G.visual && e.veh && GT.cnvehicles && GT.cnvehicles.setPlate) safe('setPlate', () => GT.cnvehicles.setPlate(e.veh, e.plate)); say('配钥匙的师傅', '新牌 ' + e.plate + '。出了这个门，我没见过你。'); emit('replate', { ent: e, plate: e.plate }); if (G.visual) HUD.toast('换牌贴膜', '−' + money(200)); return true; }
  function bikeSpot(e) { addSpot({ id: 'cn:bike:' + e.id, x: e.x, z: e.z, r: 1.7, hold: .7, label: '扫码开锁 ' + money(1.5), enabled: () => e.locked && e.alive, onUse: () => unlockBike(e) }); }
  function unlockBike(e) { if (!e || !e.locked) return false; if (!wallet().spend(1.5)) { say('', '余额不足 $1.5。'); return false; } e.locked = false; e.veh.locked = false; e.rented = true; if (G.visual) { HUD.toast('小青单车 · 已开锁', '−' + money(1.5)); PHONE.flash('扫码成功', '开锁 $1.5 · 骑行愉快'); } emit('unlock', { ent: e }); return true; }
  function bikesStep() { for (const e of G.ents) if (e.kind === 'sharebike' && !e.locked && e.rented && e !== P.ent && hyp(e.x - P.x, e.z - P.z) > 12) { e.locked = true; e.veh.locked = true; e.rented = false; const s = GT.act && GT.act.get && GT.act.get('cn:bike:' + e.id); if (s) { s.x = e.x; s.z = e.z; } else bikeSpot(e); if (G.visual) HUD.toast('小青单车 · 已还车', ''); } }

  /* ================================================================== delivery jobs + the rider phone — g7: removed. What is left are inert stand-ins with the old names, so callers
     (js/shops.js reads jobs.current / jobs.offer, HUD.update reads JOBS.cur, the loop calls jobsStep, toMenu calls failJob) keep working and simply get nothing.
     The full delivery code is in _archive/2026-11-17-before-story-removal/js/cngame.js. */
  const JOBS = { offers: [], cur: null, done: 0, earned: 0, late: 0, seq: 0, nextT: 1e9, enabled: false, history: [] };
  const makeOffer = () => null, pushOffer = () => null, acceptJob = () => false, failJob = () => {}, jobsStep = () => {};
  const PHONE = { open: false, el: null, dirty: false, init() {}, toggle() {}, ping() {}, flash() {}, update() {} };

  /* ================================================================== glue: pedestrians, combat, hotpot room callbacks */
  const PEV = [];     // events for GT.people this frame: horn, crash, gunshot…
  function peopleInit() {
    if (!G.visual || !GT.people || !GT.people.populateCN || G.Q.get('pop') === '0') return;
    const CT = GT.chinatown && GT.chinatown.active; G.pop = safe('people.populateCN', () => GT.people.populateCN(G.scene, { only: CT ? ['extra'] : null, extra: CT ? GT.chinatown.people() : null, max: +G.Q.get('pop') || 44, hours: () => G.hours, groundHeight: (x, z) => groundY(x, z, 0),
      onBark: (npc, b) => { if (b && b.text && !G.cine && !G.barkOff && hyp((npc && npc.x || 0) - P.x, (npc && npc.z || 0) - P.z) < 14 && G.time - (G.barkT || -9) > 5) { G.barkT = G.time; say(b.name || (npc && npc.label) || '路人', b.text, 1.6, { bark: true }); } emit('bark', { npc, bark: b }); },
      onEvent: (type, data) => { if (emit('npc:' + type, data || {})) return; if (type === 'pengci') pengci(data); else if (type === 'attack') { if (P.mode === 'foot' && P.down <= 0) { hurt(data.dmg || 6, data.npc); shake(.35); } } else if (type === 'report') { fileChip('cloth'); fileChip('face'); violation({ stars: 1, fine: 300, label: '路人举报 · 打人' }); } } }), null);
    if (G.pop) G.mods.people = 'ok';
  }
  /** 碰瓷: the default when no story is listening — pay up, or call his bluff */
  function pengci(d) {
    const pop = G.pop, npc = d && d.npc; if (!pop || !npc) return; const amt = (d && d.amount) || 500; if (G.visual && !G.silent) HUD.toast('碰瓷', '他要 ' + money(amt) + ' · 走过去选：赔钱，或者不赔');
    const done = paid => { GT.act.remove('cn:pc:pay'); GT.act.remove('cn:pc:no'); safe('pengci.resolve', () => pop.pengci.resolve(paid)); if (paid) ui.slip('碰瓷和解', [['营养费', -amt], ['大爷的腰', '当场痊愈']], -amt, { auto: 6 }); else { ui.achievement('火眼金睛'); say('大爷', '……现在的年轻人，一点同情心都没得。'); } emit('pengciEnd', { paid }); };
    addSpot({ id: 'cn:pc:pay', x: npc.x, z: npc.z, r: 4, mode: 'both', key: 'KeyE', label: '赔钱 ' + money(amt), onUse: () => { if (wallet().spend(amt)) done(true); else say('大爷', '没钱？没钱你骑么斯车！'); } });
    addSpot({ id: 'cn:pc:no', x: npc.x, z: npc.z, r: 4, mode: 'both', key: 'KeyR', label: '「我有行车记录仪」', onUse: () => done(false) });
  }
  function peopleStep(dt) {
    const pop = G.pop; if (!pop || G.bad.popUpd) return;
    const tf = G.trailer && G.camera ? G.camera.position : null;   // the trailer cuts all over the block: the crowd follows the camera, not the hero
    try { pop.update(dt, tf ? { x: tf.x, z: tf.z, y: 0, h: 0, speed: 0, vehicle: null } : { x: P.x, z: P.z, y: P.y, h: P.h, speed: P.speed, vehicle: P.mode === 'two' ? 'scooter' : P.mode === 'car' ? 'car' : null }, PEV); } catch (e) { G.bad.popUpd = 1; warn('people.update', e); }
    PEV.length = 0;
    /* the bell: on two wheels at up to 31 km/h, somebody on foot dead ahead within braking distance gets a ring, and the crowd's own 'horn' reaction steps him aside. It rings by itself, at most once every 1.4 s.
       (Riding out of the yard gate used to end in 撞人, a star and $500–700 two times out of three, play reports b3-eco1-r2 issue 3 and b3-eco2-r2 issue 1.) */
    if (P.mode === 'two' && P.ent && P.speed > 1.2 && P.speed < 8.6 && pop.list && !G.trailer && G.time - (P.bellT || -9) > 1.4) { const e = P.ent, fx = sin(e.h), fz = cos(e.h), reach = 2.2 + P.speed * .75;
      for (const n of pop.list) { if (n.active === false || !n.group || n.group.visible === false || n.type === 'dog') continue; const dx = n.x - e.x, dz = n.z - e.z, al = dx * fx + dz * fz; if (al < .4 || al > reach) continue; if (abs(dx * fz - dz * fx) > 1.15 || abs((n.y || 0) - e.y) > 1.2) continue;
        P.bellT = G.time; safe('pop.bell', () => pop.emit('horn', e.x + fx * max(0, al - 2.4), e.z + fz * max(0, al - 2.4), 5.5, 1.2)); emit('bell', { x: e.x, z: e.z, npc: n }); emit('honk', { x: e.x, z: e.z, bell: true }); break; } }
    /* a gun levelled in the street: people near it react (gunpoint), and a driver looking down the barrel stops. A car driven along the pavement scatters whoever is ahead. */
    { const cp = G.combatOn && GT.combat.player, wd = cp && !cp.holstered && GT.weapons && GT.weapons.defs && GT.weapons.defs[cp.cur];
      if (P.mode === 'foot' && wd && wd.kind === 'gun' && !wd.tool && cp.aimK > .5) { PEV.push({ type: 'gunpoint', x: P.x, z: P.z, r: 14 }); const ax = cp.aimDir.x, az = cp.aimDir.z; for (const c of G.traffic) { const dx = c.x - P.x, dz = c.z - P.z, d = hyp(dx, dz); if (d < 26 && d > .5 && (dx * ax + dz * az) / d > .86) { c.scare = max(c.scare || 0, 1.5); c.held = G.time; } } }
      if (P.mode === 'car' && P.speed > 4 && !P.onRoad && P.ent) PEV.push({ type: 'panic', x: P.x + sin(P.ent.h) * 5, z: P.z + cos(P.ent.h) * 5, r: 11 }); }
    // riding or driving into someone: they go down, you get a star (and on two wheels you go down too)
    if ((P.mode === 'two' || P.mode === 'car') && P.speed > 3.5 && pop.list && !G.trailer) { const e = P.ent, r = P.mode === 'car' ? 1.1 : .55, fx = sin(e.h), fz = cos(e.h), cx = e.x + fx * (e.dims.L / 2 - r * .5), cz = e.z + fz * (e.dims.L / 2 - r * .5);
      for (const n of pop.list) { if (n.active === false || !n.group || n.group.visible === false || n.type === 'dog') continue; const d = hyp(n.x - cx, n.z - cz); if (d > r + .3 || abs((n.y || 0) - e.y) > 1.2) continue; if (G.time - (n.hitT || -9) < 3) continue; n.hitT = G.time;
        safe('pop.emit', () => pop.emit('crash', n.x, n.z, 12, 3)); if (pop.hurt) safe('pop.hurt', () => pop.hurt(n, 18 + e.v * 5, fx, fz, { down: true, heavy: true, push: 2 + abs(e.v) * .5, ko: abs(e.v) > 13 })); scareTraffic(n.x, n.z, 16); if (!emit('hitped', { npc: n })) crime('hitped', n.x, n.z, n); if (P.mode === 'two') knockDown(fx * e.v, fz * e.v, 6 + e.v, 'ped', null); else if (e.c) e.c.vx *= .6; break; } }
  }
  /* ---- open-world basics (2026-11-17): who saw it, what a blow does to a bystander, how a driver leaves his seat
     witnesses(x, z, r, skip, hear): officers who see the player + people on foot within r with a sight line (hear: by ear, no sight line needed) + drivers passing close.
     crime(id, x, z, victim): the offence goes on the sheet only when somebody saw it (or a unit is already on him). The victim is not his own witness: if he is the kind who reports, he phones it in himself (crowd event 'report'). */
  function witnesses(x, z, r, skip, hear) { let n = W.seenBy || 0; const pop = G.pop; if (pop && pop.list) for (const q of pop.list) { if (!q.active || q === skip || q.ko || q.type === 'dog' || q.role === 'dog' || (q.hurt && q.hurt.ph === 'fall')) continue; const d = hyp(q.x - x, q.z - z); if (d > r) continue; if (hear || d < 5 || los(q.x, q.z, x, z)) n++; }
    for (const c of G.traffic) if (hyp(c.x - x, c.z - z) < r * .6) n++; return n; }
  function crime(id, x, z, skip, r) { const n = witnesses(x, z, r || 24, skip, false); emit('crime', { id, witnesses: n, x, z }); if (n > 0 || W.hot) { violation(id); return true; } return false; }
  function scareTraffic(x, z, r) { for (const c of G.traffic) { if (hyp(c.x - x, c.z - z) > r || c.kind === 'bus') continue; if (rnd() < .55) c.scare = max(c.scare || 0, 1.6 + rnd() * 2); else c.rushT = G.time + 5; } }
  // Count contacts by swing time: a shove that touches two pedestrians is one action.
  const scuffleTimes = [];
  function sustainedScuffle() {
    while (scuffleTimes.length && G.time - scuffleTimes[0] > 10) scuffleTimes.shift();
    if (scuffleTimes[scuffleTimes.length - 1] !== G.time) scuffleTimes.push(G.time);
    if (scuffleTimes.length > 3) scuffleTimes.shift();
    return scuffleTimes.length === 3;
  }
  function civHit(n, o) { const pop = G.pop; if (!pop || !pop.hurt || !n) return false; const wasDown = !!(n.hurt && n.hurt.ph === 'fall'), r = safe('pop.hurt', () => pop.hurt(n, o.dmg, o.dx, o.dz, { heavy: o.heavy, gun: o.gun, push: o.shove ? 3.2 : undefined }), null); if (!r) return false;
    scareTraffic(n.x, n.z, o.gun ? 40 : 14); const down = !!(n.hurt && n.hurt.ph === 'fall'); emit('civHit', { npc: n, dmg: o.dmg, gun: !!o.gun, down, ko: !!n.ko });
    const injury = n.hurt, officer = /police|patrol|^cop$/.test(n.type || ''), offence = o.gun ? 'shootped' : 'fight';
    const minor = !officer && !o.gun && (!o.weapon || o.weapon === 'fists') && !down && !o.heavy;
    if (minor && !sustainedScuffle()) {
      if (injury && injury.allowCall === undefined) injury.allowCall = false;
      return true;
    }
    if (injury && injury.filedOffence === offence && !(down && !wasDown)) return true;
    const filed = officer ? (violation(offence), true) : crime(offence, n.x, n.z, n);
    if (injury) { injury.allowCall = !filed; if (filed) injury.filedOffence = offence; }
    return true; }
  /* 抢车: F beside a vehicle somebody is driving. The driver is pulled out when the player reaches the door (or after 1.4 s), joins the crowd as a 'guest' (js/people.js adopt) and runs, phones it in or comes back swinging;
     the vehicle becomes an ordinary parked one, so the on-foot controller's own door / mount animation and the driving code take it from there. */
  const JACK = { e: null, t: 0 }, DRIVERS = ['office_m', 'uncle', 'student', 'office_f', 'local_m', 'auntie'];
  /* somebody is at the wheel of every car on the loop once the player is near enough to see in (built on demand, a few ms): he is the one who gets pulled out */
  function addDriver(e) { e.noDrv = true; if (!GT.people || !GT.people.make || G.bad.people) return; const type = DRIVERS[e.id % DRIVERS.length], f = safe('people.make(driver)', () => GT.people.make(type, { seed: e.id * 5 + 1, phone: false }), null); if (!f || !f.group) return;
    const ey = eyeOf(e.dims, e); f.group.position.set(ey.x, ey.y - 1.46, ey.z - .06); e.veh.group.add(f.group); e.rider = f; e.riderType = type; e.riderState = 'drive'; safe('driver.pose', () => f.update(0, { state: 'drive', snap: true })); }
  function startJack(e) { if (!e || JACK.e === e || (e.mode !== 'traffic' && e.mode !== 'cop')) return; JACK.e = e; JACK.t = 0; e.scare = 6; if (!e.two && !G.cockpit && !G.bad.cockpit && P.mode === 'foot') { attachCockpit(e); if (G.cockpit) G.cockpit.group.visible = false; }   /* the interior is built on first use (about half a second): now, while he walks to the door, not in the frame he sits down */ }
  /* the first-person car interior takes about 150 ms to build: it is built behind the loading screen (newStory), or a few seconds into a session that skipped it, never in the frame a car is taken */
  function ckWarm() { if (!G.visual || G.ckDrawn || G.bad.cockpit || P.mode === 'car' || !G.scene) return; if (!G.cockpit) { let b = null; for (const q of G.ents) if (q.alive && !q.two && q.veh && q.veh.group && q.kind !== 'bus') { b = q; break; } if (!b) return; attachCockpit(b); } const ck = G.cockpit; if (!ck) return; G.ckDrawn = true;
    /* drawn for a few frames deep under the street (never culled, never seen), with the rear-view pass running, so the interior's programs, buffers and textures and the mirror target are on the GPU before a car is taken */
    const L = [], cp = G.camera.position, mir = GT.render && GT.render.mirror, mOn = mir && mir.enabled; if (ck.group.parent) ck.group.parent.remove(ck.group); G.scene.add(ck.group); ck.group.position.set(cp.x, cp.y - 45, cp.z); ck.group.visible = true; ck.group.traverse(o => { if (o.frustumCulled) { o.frustumCulled = false; L.push(o); } });
    if (mir && mir.camera && !mOn) { mir.camera.position.copy(cp); mir.camera.quaternion.copy(G.camera.quaternion); mir.camera.updateMatrixWorld(); mir.enabled = true; } G.ckHot = { n: 5, L, mir: mir && !mOn ? mir : null }; }
  function jackStep(dt) { if (G.ckHot && --G.ckHot.n <= 0) { const H = G.ckHot; G.ckHot = null; for (const o of H.L) o.frustumCulled = true; if (H.mir && P.mode === 'foot') H.mir.enabled = false; const ck = G.cockpit; if (ck && P.mode !== 'car') { ck.group.visible = false; if (ck.group.parent === G.scene) G.scene.remove(ck.group); } }
    const e = JACK.e; if (!e) { if (!G.ckDrawn && !G.bad.cockpit && G.phase === 'play' && P.mode === 'foot' && !G.cine && (G.ckT = (G.ckT || 0) + dt) > 5) { G.ckT = -1e9; ckWarm(); }
      if (G.visual && G.phase === 'play' && P.mode === 'foot' && !G.cine && !P.inside && (!G.tipPunch || !G.tipJack) && (G.tipT = (G.tipT || 0) - dt) <= 0) { G.tipT = .4;   /* said once each, the first time it applies */
        if (!G.tipJack) for (const c of G.traffic) { if (abs(c.v) > 4.5 || hyp(c.x - P.x, c.z - P.z) > 5.5) continue; G.tipJack = true; F('hint', ['F'], '抢车 · 站到车前面，车会停下', 6); break; }
        if (!G.tipPunch && G.tipJack !== 'now' && G.combatOn && G.pop && G.pop.list && !(GT.combat.player && !GT.combat.player.holstered && GT.combat.player.cur !== 'fists')) for (const n of G.pop.list) { if (!n.active || n.label || n.pin || hyp(n.x - P.x, n.z - P.z) > 2.6) continue; G.tipPunch = true; F('hint', ['左键'], '出拳 · 按住再松开是重拳', 6); break; } }
      return; } JACK.t += dt; if (!e.alive || (e.mode !== 'traffic' && e.mode !== 'cop')) { JACK.e = null; return; } e.scare = 3; e.v *= Math.exp(-9 * dt);
    const lx = cos(e.h), lz = -sin(e.h), k = e.two ? .55 : e.dims.W / 2 + .45; if (hyp(P.x - (e.x + lx * k), P.z - (e.z + lz * k)) < 1.7 || JACK.t > 1.4 || P.mode !== 'foot') { JACK.e = null; ejectDriver(e); } }
  function ejectDriver(e) { const wasCop = !!e.cop; if (wasCop) { const ci = G.cops.indexOf(e); if (ci >= 0) G.cops.splice(ci, 1); e.cop = null; e.lights.siren = false; e.stolenCop = true; }
    const i = G.traffic.indexOf(e); if (i >= 0) G.traffic.splice(i, 1); e.mode = 'parked'; e.v = 0; e.scare = 0; e.jack = 2; e.jackT = G.time; G.jackAt = G.time; G.trafLost = (G.trafLost || 0) + 1; G.trafSweep = true; e.owner = 'npc'; e.lights.brake = false; e.veh.locked = false; e.locked = false; if (e.two) { e.fallen = 0; e.lean = 0; } G.vehDirty = true;
    const pop = G.pop, lx = cos(e.h), lz = -sin(e.h), sd = e.two ? -1 : 1, ox = lx * sd, oz = lz * sd, k = e.two ? .7 : e.dims.W / 2 + .75, x = e.x + ox * k - sin(e.h) * .5, z = e.z + oz * k - cos(e.h) * .5; let fig = e.rider, type = wasCop ? 'traffic_police' : 'uncle', n = null;
    if (fig && fig.group) { if (fig.group.parent) fig.group.parent.remove(fig.group); fig.group.position.set(0, 0, 0); fig.group.rotation.set(0, 0, 0); e.rider = null; type = e.riderType || 'local_m'; }
    else if (G.visual && GT.people && GT.people.make && pop && pop.adopt) { type = wasCop ? 'traffic_police' : DRIVERS[e.id % DRIVERS.length]; fig = safe('people.make(driver)', () => GT.people.make(type, { seed: e.id * 5 + 1, phone: false }), null); }
    if (fig && fig.group && pop && pop.adopt) { const t = rnd(); n = safe('pop.adopt', () => pop.adopt(fig, { x, z, h: e.h, type, brave: rnd(), temper: t < .22 ? 'fight' : t < .5 ? 'report' : 'flee', ttl: 50 }), null); if (n) safe('pop.hurt', () => pop.hurt(n, 0, ox - sin(e.h) * .4, oz - cos(e.h) * .4, { down: rnd() < .55, push: 4.6, quiet: true })); }
    if (pop && pop.emit) safe('pop.emit', () => pop.emit('panic', e.x, e.z, 13, 3)); scareTraffic(e.x, e.z, 18); emit('jack', { ent: e, kind: e.kind, driver: n }); crime('jack', e.x, e.z, n); if (wasCop) violation({ stars: 2, fine: 0, label: '抢警车' });
  }
  function combatInit() {
    if (!G.visual || !GT.combat || !GT.combat.init || !G.ctl) return;
    G.combatOn = !!safe('combat.init', () => { GT.combat.init(G.scene, {
      addHeat: (stars, reason) => { const gun = /^(gun|gunshot|gunfire|fire)$/.test(reason || ''); if (gun && !(witnesses(P.x, P.z, 42, null, true) > 0 || W.hot)) { emit('crime', { id: 'gun', witnesses: 0, x: P.x, z: P.z }); return; }   /* a shot nobody heard raises nothing */
        violation({ stars: stars || .5, fine: gun ? 500 : 300, label: gun ? '开枪' : (typeof reason === 'string' && /[一-龥]/.test(reason) ? reason : '打架斗殴') }); },
      civs: () => { const out = [], pop = G.pop; if (pop && pop.list && (P.mode === 'foot' || GT.combat.dbOn) && !G.inputOff && !G.cine && !G.paused && !document.querySelector('.cn-phone.on')) for (const n of pop.list) { if (!n.active || n.vis === false || n.dist > 60 || n.ko || n.label || n.pin || n.type === 'dog' || n.role === 'dog' || n.type === 'kid' || n.role === 'kid') continue; n.lying = !!(n.hurt && n.hurt.ph === 'fall'); out.push(n); } return out; },
      civHit: (n, o) => civHit(n, o),
      flag: kind => { if (kind === 'face') fileChip('face'); else if (kind === 'cloth' || kind === 'clothes') fileChip('cloth'); },
      cops: () => G.cops.map(c => ({ x: c.x, z: c.z })), say: (who, text, sec) => say(who, text, sec), onPlayerDown: () => playerDown(), onEnemyDown: e => emit('enemyDown', { enemy: e }), noHelmet: true, calmThreat: () => !G.story });   /* pt1 calmThreat: in free roam an alerted officer does not take the controls away — run, jump, get in a car; attacking or drawing a weapon starts the fight */ return true; }, false);
    if (G.combatOn && GT.combat.on) { safe('combat.on', () => { GT.combat.on('fire', () => { PEV.push({ type: 'gunshot', x: P.x, z: P.z }); if (G.time - (G.shotScareT || -9) > .8) { G.shotScareT = G.time; scareTraffic(P.x, P.z, 38); } }); GT.combat.on('scenario', d => emit('scenario', d)); }); }
  }
  function roomInit() {
    const H = GT.hotpot; if (!H) return;
    H.onOutfit = name => { P.outfit = name || (G.kai && G.kai.outfit) || P.outfit; emit('outfit', { outfit: P.outfit }); if (G.visual && (W.chips.cloth.on)) HUD.toast('换了身衣服', chipValid('cloth') ? '' : '描述「衣」已失效'); };
    H.onSleep = h => { if (typeof h === 'number') { G.hours = h; if (G.holdHours !== null) G.holdHours = h; } heal(100); emit('sleep', { hours: G.hours }); };
    H.onCharge = on => { G.charging = !!on; emit('charge', { on: !!on }); };
    H.onSnack = n => { heal(15); emit('snack', { n }); };
    H.onEnter = () => { P.inside = true; emit('room', { inside: true }); }; H.onExit = () => { P.inside = false; emit('room', { inside: false }); };
  }

  /* ================================================================== markers + timers (for jobs and for the story) */
  const MARKS = [], TIMERS = [];
  /** marker(x, z, label, {color, r, y}) -> {x, z, label, set(x, z), remove(), dist(), reached(r?)} | null — a beacon in the world, a blip on the minimap, a distance tag on screen */
  const MKY = '#ffd23f', MK = { disc: null, cone: null, beam: null, tex: null };
  function mkParts() { if (MK.disc) return; MK.tex = (() => { const c = document.createElement('canvas'), w = c.width = c.height = 256, g = c.getContext('2d'); { const q = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); q.addColorStop(0, 'rgba(255,255,255,0)'); q.addColorStop(.45, 'rgba(255,255,255,.05)'); q.addColorStop(.8, 'rgba(255,255,255,.16)'); q.addColorStop(.875, 'rgba(255,255,255,.3)'); q.addColorStop(.915, 'rgba(255,255,255,1)'); q.addColorStop(.955, 'rgba(255,255,255,.3)'); q.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = q; g.fillRect(0, 0, w, w); } return new T.CanvasTexture(c); })();
    MK.disc = new T.CircleGeometry(1, 48); MK.cone = new T.ConeGeometry(.15, .32, 4); MK.cone.rotateX(PI); MK.beam = new T.CylinderGeometry(.07, .13, 30, 10, 1, true); }
  /* one look for every objective in the world: a soft breathing ground halo, a small pointer above it, a thin pale shaft that is only there from a distance. kind 'enemy': a small red pointer over a head, nothing on the ground. */
  function marker(x, z, label, o) {
    o = o || {}; const enemy = o.kind === 'enemy', m = { x, z, label: label || '', color: enemy ? '#ff4a3a' : MKY, kind: o.kind || 'goal', r: o.r || 3, y: o.y, alive: true, mesh: null, tag: null,
      set(nx, nz) { m.x = nx; m.z = nz; return m; }, dist() { return hyp(P.x - m.x, P.z - m.z); }, reached(r) { return m.dist() < (r || m.r); },
      remove() { if (!m.alive) return; m.alive = false; const i = MARKS.indexOf(m); if (i >= 0) MARKS.splice(i, 1); if (m.mesh && m.mesh.parent) m.mesh.parent.remove(m.mesh); if (m.tag && m.tag.parentNode) m.tag.parentNode.removeChild(m.tag); } };
    if (G.visual && G.scene) { mkParts(); const col = new T.Color(m.color).convertSRGBToLinear(), g = new T.Group(), bm = c => new T.MeshBasicMaterial(Object.assign({ color: col.clone().multiplyScalar(1.7), transparent: true, depthWrite: false, fog: false }, c));
      const cone = new T.Mesh(MK.cone, bm({ opacity: .95 })); cone.position.y = enemy ? 2.1 : 2.5; if (enemy) cone.scale.setScalar(.7); g.add(cone); g.userData.cone = cone;
      if (!enemy) { const rr = clamp(m.r * .5, 1.1, 2.4), ring = new T.Mesh(MK.disc, bm({ map: MK.tex, opacity: .8, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); ring.rotation.x = -PI / 2; ring.position.y = .05; ring.scale.setScalar(rr); ring.userData.rr = rr;
        const beam = new T.Mesh(MK.beam, bm({ opacity: .3, side: T.DoubleSide })); beam.position.y = 17.5; g.add(beam, ring); g.userData.ring = ring; g.userData.beam = beam; }
      g.userData.keepIndoor = false; g.renderOrder = 5; G.scene.add(g); m.mesh = g;
      if (HUD.root && !enemy && m.label) { m.tag = document.createElement('div'); m.tag.className = 'cn-tag'; m.tag.style.setProperty('--c', m.color); m.tag.innerHTML = '<i></i><b></b><span></span>'; HUD.tags.appendChild(m.tag); } }
    MARKS.push(m); return m;
  }
  /** timer(seconds, label, {silent, up}) -> {left, t, label, stop(), add(s), onEnd(cb), done} | null — shown top-centre unless silent */
  function timer(seconds, label, o) {
    o = o || {}; const t = { left: seconds, t: 0, total: seconds, label: label || '', silent: !!o.silent, up: !!o.up, done: false, alive: true, cbs: [], stop() { t.alive = false; const i = TIMERS.indexOf(t); if (i >= 0) TIMERS.splice(i, 1); }, add(s) { t.left += s; return t; }, onEnd(cb) { t.cbs.push(cb); return t; } };
    TIMERS.push(t); return t;
  }
  /* every enemy still standing carries a small red pointer over his head and a red dot on the minimap (js/combat.js enemies), so a fight always shows who is left and where */
  const FOES = { list: [], pool: [] };
  function foesStep() { const es = (G.combatOn && GT.combat && GT.combat.enemies) || [], L = FOES.list; L.length = 0; for (const e of es) { if (!e || e.dead || e.out || e.gone || (e.hp !== undefined && e.hp <= 0)) continue; if (hyp(e.x - P.x, e.z - P.z) < 70) L.push(e); }
    const pk = (G.combatOn && GT.combat && GT.combat.pickups) || [], PL = FOES.picks || (FOES.picks = []), PP = FOES.ppool || (FOES.ppool = []); PL.length = 0; for (const p of pk) if (p && hyp(p.x - P.x, p.z - P.z) < 60) PL.push(p);
    if (!G.scene) return; mkParts(); for (let i = 0; i < max(PL.length, PP.length); i++) { let c = PP[i]; const p = PL[i]; if (!p) { if (c) c.visible = false; continue; }
      if (!c) { c = PP[i] = new T.Mesh(MK.cone, new T.MeshBasicMaterial({ color: new T.Color(MKY).convertSRGBToLinear().multiplyScalar(1.7), transparent: true, opacity: .95, depthWrite: false, fog: false })); c.scale.setScalar(.6); c.renderOrder = 5; G.scene.add(c); }
      c.visible = !G.cine; c.position.set(p.x, (p.y || 0) + .75 + sin(G.time * 2.4 + i) * .06, p.z); c.rotation.y = G.time * 1.6; }
    for (let i = 0; i < max(L.length, FOES.pool.length); i++) { let c = FOES.pool[i]; const e = L[i]; if (!e) { if (c) c.visible = false; continue; }
      if (!c) { c = FOES.pool[i] = new T.Mesh(MK.cone, new T.MeshBasicMaterial({ color: new T.Color('#ff4a3a').convertSRGBToLinear().multiplyScalar(1.7), transparent: true, opacity: .95, depthWrite: false, fog: false })); c.scale.setScalar(.62); c.renderOrder = 5; G.scene.add(c); }
      const ey = e.y !== undefined ? e.y : (e.group && e.group.position ? e.group.position.y : groundY(e.x, e.z, P.y + .3)); c.visible = !G.cine; c.position.set(e.x, ey + (e.down || e.prone ? 1.2 : 2.12) + sin(G.time * 2.4 + i) * .05, e.z); c.rotation.y = G.time * 1.6; } }
  /* the line on the minimap from the player to the objective. On foot it crosses the avenue at a zebra crossing; on wheels it follows the traffic loop that gets there soonest. Recomputed twice a second. */
  const ROUTE = { pts: [], t: 0, m: null };
  function routeStep(dt) { ROUTE.t -= dt; if (ROUTE.t > 0) return; ROUTE.t = .5; const R = ROUTE.pts; R.length = 0; let m = null; for (const q of MARKS) if (q.kind !== 'enemy') m = q; ROUTE.m = m; if (!m || P.inside || G.cine) return; const d = m.dist(); if (d < (m.via ? 5 : 14)) return;
    if (P.mode === 'foot') { const sp = P.x < -7.5 ? -1 : P.x > 7.5 ? 1 : 0, sm = m.x < -7.5 ? -1 : m.x > 7.5 ? 1 : 0; R.push([P.x, P.z]);
      if (sp && sm && sp !== sm && abs(P.z) < 152 ) { let bz = null, bd = 1e9; for (const zc of (GT.cnroad && GT.cnroad.layout && GT.cnroad.layout.crossings) || FBSIG.crossings) { const dd = abs(P.z - zc) + abs(m.z - zc); if (dd < bd) { bd = dd; bz = zc; } } if (bz !== null) R.push([sp * 9.6, bz], [sm * 9.6, bz]); }
      if (R.length === 1 && m.via && m.via.length) { let bi = -1, bd = 1e9; m.via.forEach((v, i) => { const dd = hyp(v[0] - P.x, v[1] - P.z); if (dd < bd) { bd = dd; bi = i; } }); if (bd < d) { if (bi < m.via.length - 1 && bd < 3) bi++; for (let i = bi; i < m.via.length; i++) R.push(m.via[i]); } }   /* the story's own way round walls and through doors */
      R.push([m.x, m.z]); return; }
    let best = null, bl = 1e9; for (const nm of ['loopA', 'loopB']) { const p = PATHS[nm]; if (!p) continue; const s0 = pathNearest(p, P.x, P.z), d0 = pathNearest.dist, s1 = pathNearest(p, m.x, m.z), d1 = pathNearest.dist, arc = ((s1 - s0) % p.len + p.len) % p.len, cost = arc + d0 * 2 + d1 * 2; if (cost < bl) { bl = cost; best = [p, s0, arc]; } }
    R.push([P.x, P.z]); if (best && bl < d * 3.2 + 60) { const n = max(2, Math.ceil(best[2] / 6)); for (let i = 0; i <= n; i++) { const q = pathAt(best[0], best[1] + best[2] * i / n, _q1); R.push([q.x, q.z]); } } R.push([m.x, m.z]); }
  function marksStep(dt) {
    for (const t of TIMERS.slice()) { t.t += dt; t.left -= dt; if (!t.done && !t.up && t.left <= 0) { t.done = true; t.left = 0; for (const cb of t.cbs) safe('timer.onEnd', cb); emit('timer', { timer: t }); if (!t.silent) t.stop(); } }
    if (!G.visual) return;
    const cp = G.camera && G.camera.position;
    for (const m of MARKS) { if (!m.mesh) continue; const U = m.mesh.userData, y = m.y !== undefined ? m.y : groundY(m.x, m.z, P.y + .3), cd = cp ? hyp(cp.x - m.x, cp.z - m.z) : 20; m.mesh.position.set(m.x, y, m.z); m.mesh.visible = !G.cine && (!P.inside || cd < 30);
      U.cone.rotation.y = G.time * 1.6; U.cone.position.y = (m.kind === 'enemy' ? 2.1 : 2.5) + sin(G.time * 2.4 + m.x) * .09; U.cone.material.opacity = .95 * sstep(cd, 2.6, 6);
      if (U.ring) { const s = U.ring.userData.rr * (1 + sin(G.time * 2.2) * .06); U.ring.scale.set(s, s, 1); U.ring.material.opacity = (.5 + .3 * sstep(cd, 2.5, 9)) * (.85 + .15 * sin(G.time * 2.2)); const k = P.inside ? 0 : sstep(cd, 9, 26); U.beam.visible = k > .01; U.beam.material.opacity = .32 * k; } }   /* close up the shaft is gone and the pointer fades: the thing you came for is not hidden behind its own marker */
    foesStep(); routeStep(dt); BIG.step(); for (const c of G.cops) { c.veh.locked = abs(c.v) > 3; if (c.veh.enter === false && !c.two) { c.veh.enter = true; G.vehDirty = true; } }
  }

  /* ================================================================== HUD: minimal layout — round minimap bottom-left, mission line top-left, money + stars + description row top-right,
     prompts bottom-right (GT.act, drawn by onfoot.js), subtitles bottom-centre (GT.front), achievement bar top-centre, itemised slip, fail card. Styles: css/cn.css */
  const HUD = { root: null, el: {}, mapT: 0, toasts: [], achQ: [], achT: 0, slipRes: null, failRes: null, cash: -1, starKey: '', chipKey: '', missionText: '', tags: null,
    init(root) {
      if (!G.visual || !root) return; this.root = root; root.classList.add('cn-hud');
      root.innerHTML = '<div class="cn-mission"><i></i><span></span></div>' +
        '<div class="cn-status"><div class="cn-cash"><small>$</small><b>0</b></div><div class="cn-stars">' + '<i></i>'.repeat(6) + '</div><div class="cn-chips">' + CHIPS.map(c => '<span data-k="' + c[0] + '">' + c[1] + '</span>').join('') + '</div><div class="cn-toasts"></div></div>' +
        '<div class="cn-mapwrap"><canvas class="cn-map" width="380" height="380"></canvas><div class="cn-ring"></div><div class="cn-n">北</div><div class="cn-bars"><div class="hp"><i></i></div><div class="bt"><i></i></div></div><div class="cn-loc"><b></b><span></span></div></div>' +
        '<div class="cn-speed"><b>0</b><small>km/h</small><div class="cn-batt"><i></i></div><span></span></div>' +
        '<div class="cn-timer"><span></span><b></b></div><div class="cn-ach"><i>成就达成</i><b></b></div>' +
        '<div class="cn-slip"><div class="cs-top"><small>B STAR · ' + CITY() + '</small><b></b></div><div class="cs-lines"></div><div class="cs-total"><span>合计</span><b></b></div><div class="cs-go"><span class="k">Enter</span>收下</div><div class="cs-teeth"></div></div>' +
        '<div class="cn-fail"><small>任务失败</small><b></b><div><span class="k">Enter</span>再来一次</div></div><div class="cn-tags"></div><div class="cn-hurt"></div>';
      const q = s => root.querySelector(s); this.el = { mission: q('.cn-mission'), cash: q('.cn-cash b'), stars: q('.cn-stars'), chips: q('.cn-chips'), toasts: q('.cn-toasts'), map: q('.cn-map'), mapwrap: q('.cn-mapwrap'), n: q('.cn-n'), hp: q('.cn-bars .hp i'), bt: q('.cn-bars .bt'), bti: q('.cn-bars .bt i'), loc: q('.cn-loc'),
        speed: q('.cn-speed'), timer: q('.cn-timer'), ach: q('.cn-ach'), slip: q('.cn-slip'), fail: q('.cn-fail'), hurt: q('.cn-hurt') }; this.tags = q('.cn-tags'); this.g = this.el.map.getContext('2d');
      PHONE.init(root);
      addEventListener('keydown', e => { if (e.repeat) return; if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') { if (this.failRes && performance.now() - this.failT0 > 600) { this.closeFail(); e.preventDefault(); } else if (this.slipRes && performance.now() - this.slipT0 > 500) { this.closeSlip(); e.preventDefault(); } } });
    },
    show(on) { if (this.root) this.root.classList.toggle('on', !!on); document.body.classList.toggle('cn-play', !!on); },
    toast(a, b) { if (!this.root) return; const d = document.createElement('div'); d.innerHTML = '<b></b><span></span>'; d.firstChild.textContent = a; d.lastChild.textContent = b || ''; this.el.toasts.appendChild(d); this.toasts.push({ el: d, t: 4.2 }); if (this.toasts.length > 4) { const o = this.toasts.shift(); o.el.remove(); } requestAnimationFrame(() => d.classList.add('on')); },
    closeSlip() { const r = this.slipRes; this.slipRes = null; this.slipAuto = 0; if (this.el.slip) this.el.slip.classList.remove('on'); if (r) r(); },
    closeFail() { const r = this.failRes; this.failRes = null; if (this.el.fail) this.el.fail.classList.remove('on'); G.paused = false; if (r) r(); },
    update(dt) {
      if (!this.root) return; const E = this.el; const foot = P.mode === 'foot' && !G.cine; if (foot !== this.foot) { this.foot = foot; document.body.classList.toggle('cn-foot', foot); }
      { const rf = P.mode === 'two' && !G.cine && !!G.ctl && G.ctl.view === 'fp'; if (rf !== this.rideFp) { this.rideFp = rf; document.body.classList.toggle('cn-ridefp', rf); if (rf && !this.rideCss) { this.rideCss = true; const st = document.createElement('style'); st.textContent = 'body.cn-ridefp #gtf:not(.lb) .f-sub{bottom:calc(250 * var(--u));}'; document.head.appendChild(st); } } }   /* first person on the scooter: the subtitle sits above the handlebars, so the speaker's name is not printed across the phone mount */
      const cash = wallet().cash; if (cash !== this.cash) { const up = cash > this.cash && this.cash >= 0; this.cash = cash; E.cash.textContent = (Math.round(cash * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: cash % 1 ? 1 : 0 }); if (up) { E.cash.parentNode.classList.remove('up'); void E.cash.offsetWidth; E.cash.parentNode.classList.add('up'); } }
      const eI = GT.economy && GT.economy.starIcons ? GT.economy.starIcons() : -1, st = eI >= 0 ? eI : Math.ceil(W.stars - .02), sk = st + (W.hot ? 'h' : W.stars > 0 ? 's' : '');   /* js/economy.js: in free roam the icons are the tier (four at most), so they agree with the label under them */ if (sk !== this.starKey) { this.starKey = sk; E.stars.className = 'cn-stars' + (W.stars > 0 ? ' on' : '') + (W.hot ? ' hot' : ''); for (let i = 0; i < 6; i++) E.stars.children[i].className = i < st ? 'on' : ''; }
      let ck = ''; for (const c of CHIPS) ck += W.chips[c[0]].on ? (chipValid(c[0]) ? '1' : 'x') : '0'; if (ck !== this.chipKey) { this.chipKey = ck; E.chips.className = 'cn-chips' + (ck !== '0000' ? ' on' : ''); for (let i = 0; i < 4; i++) E.chips.children[i].className = ck[i] === '1' ? 'on' : ck[i] === 'x' ? 'off' : ''; }
      for (let i = this.toasts.length - 1; i >= 0; i--) { const o = this.toasts[i]; o.t -= dt; if (o.t <= 0) { o.el.remove(); this.toasts.splice(i, 1); } else if (o.t < .4) o.el.classList.remove('on'); }
      // achievement queue
      if (this.achT > 0) { this.achT -= dt; if (this.achT <= 0) { this.achT = 0; E.ach.classList.remove('on'); this.achGap = .7; } } else if (this.achGap > 0) this.achGap -= dt;
      else if (this.achQ.length) { E.ach.querySelector('b').textContent = this.achQ.shift(); E.ach.classList.add('on'); this.achT = 4.6; if (!G.silent) safe('sfx', () => GT.audio && GT.audio.sfx && GT.audio.sfx('sting_ach')); }
      if (this.slipRes && this.slipAuto > 0) { this.slipAuto -= dt; if (this.slipAuto <= 0) this.closeSlip(); }
      // vitals + location + speed
      const hp = hp01(); E.hp.style.transform = 'scaleX(' + hp.toFixed(3) + ')'; E.hp.parentNode.className = 'hp' + (hp < .3 ? ' low' : ''); const veh = P.mode === 'two' || P.mode === 'car';
      const onSc = P.ent === G.scooter && P.mode === 'two'; E.bt.style.opacity = G.scooter ? 1 : 0; E.bti.style.transform = 'scaleX(' + G.battery.toFixed(3) + ')'; E.bt.className = 'bt' + (G.battery < .15 ? ' low' : '') + (G.chargingNow ? ' chg' : '');
      this.locT = (this.locT || 0) - dt; if (this.locT <= 0) { this.locT = .5; E.loc.firstChild.textContent = P.inside ? '家' : P.zone; E.loc.lastChild.textContent = clock(G.hours); }
      E.speed.classList.toggle('on', veh); if (veh) { E.speed.firstChild.textContent = Math.round(P.speed * 3.6); E.speed.lastChild.textContent = P.ent.kind === 'escooter' ? (G.battery <= 0 && onSc ? '没电 · 脚蹬' : '电动车') : P.ent.kind === 'sharebike' ? '小青单车' : (P.ent.c && P.ent.c.gear < 0 ? 'R' : 'D') + ' · ' + ({ taxi: '出租车', van: '面包车', sports: '跑车', police: '巡逻车', laotoule: '老头乐' }[P.ent.kind] || '车'); E.speed.querySelector('.cn-batt').style.display = onSc ? '' : 'none'; if (onSc) E.speed.querySelector('.cn-batt i').style.transform = 'scaleX(' + G.battery.toFixed(3) + ')'; }
      const tm = TIMERS.find(t => !t.silent) || (JOBS.cur && JOBS.cur.tm); E.timer.classList.toggle('on', !!tm); if (tm) { E.timer.firstChild.textContent = tm.label; E.timer.lastChild.textContent = tm.up ? mmss(tm.t) : (tm.left < 0 ? '+' + mmss(-tm.left) : mmss(tm.left)); E.timer.classList.toggle('low', !tm.up && tm.left < 15); }
      E.hurt.style.opacity = clamp(1 - (G.time - (G.hurtT || -9)) / .8, 0, 1) * .8 + (hp < .3 ? .25 + sin(G.time * 5) * .1 : 0);
      this.mapT -= dt; if (this.mapT <= 0) { this.mapT = 1 / 30; this.drawMap(); } this.drawTags();
    },
    /** minimap: heading-up, 150 m across. Roads, river, zones, both crossings with their live signal, blips. */
    drawMap() {
      const g = this.g, S = 380, R = S / 2, sc = R / 78, cam = G.camera, yaw = P.mode === 'foot' || P.mode === 'two' ? ((G.ctl && G.ctl.camera && G.ctl.camera.yaw) || P.h) : P.h + (CAM.mode === 'chase' ? CAM.yaw : 0), s = sin(yaw), c = cos(yaw);
      const mx = (x, z) => R - ((x - P.x) * c - (z - P.z) * s) * sc, my = (x, z) => R - ((x - P.x) * s + (z - P.z) * c) * sc;
      const rect = (x0, z0, x1, z1, fill) => { g.beginPath(); g.moveTo(mx(x0, z0), my(x0, z0)); g.lineTo(mx(x1, z0), my(x1, z0)); g.lineTo(mx(x1, z1), my(x1, z1)); g.lineTo(mx(x0, z1), my(x0, z1)); g.closePath(); g.fillStyle = fill; g.fill(); };
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S); g.save(); g.beginPath(); g.arc(R, R, R - 2, 0, TAU); g.clip(); g.fillStyle = 'rgba(22,26,30,.86)'; g.fillRect(0, 0, S, S);
      if (GT.chinatown && GT.chinatown.active && GT.chinatown.mapBase) GT.chinatown.mapBase(rect, 'mini'); else {   /* ct2: ?world=ct draws its own streets and blocks */
      rect(-400, -400, -60, 400, '#27495a'); rect(-58, -200, -10, 200, '#3a3d3c'); rect(14, -152.5, 143, 152.5, '#2c2f31');
      for (const [k, col] of [['snack', '#5a4a34'], ['market', '#4d3a4c'], ['hotpot', '#5e3530'], ['courtyard', '#3d4438'], ['tenement', '#484a4e'], ['clock', '#55524a'], ['wharf', '#3b4650']]) { const r = CN[k]; rect(r.x0, r.z0, r.x1, r.z1, col); }
      const rb = CN.rail.building; rect(rb.x0, rb.z0, rb.x1, rb.z1, '#4a4f58'); rect(CN.rail.x - 1.6, CN.rail.z0, CN.rail.x + 1.6, CN.rail.z1, 'rgba(160,170,190,.35)');
      const road = '#6d7178'; rect(-7.5, -190, 7.5, 190, road); rect(-7.5, -164.5, 157, -155.5, road); rect(-7.5, 155.5, 157, 164.5, road); rect(145.5, -164.5, 154.5, 164.5, road);
      rect(-.25, -150, .25, -13, '#a9a595'); rect(-.25, -3, .25, 57, '#a9a595'); rect(-.25, 67, .25, 150, '#a9a595'); }
      for (const zc of (GT.cnroad && GT.cnroad.layout && GT.cnroad.layout.crossings) || FBSIG.crossings) { const st = sigState(zc); rect(-7.5, zc - 2.5, 7.5, zc + 2.5, st.ped === 'dont' ? 'rgba(235,235,225,.55)' : 'rgba(120,255,170,.85)');
        for (const sx of [-9.2, 9.2]) { g.beginPath(); g.arc(mx(sx, zc), my(sx, zc), 5, 0, TAU); g.fillStyle = st.car === 'green' ? '#39d36b' : st.car === 'amber' ? '#ffb629' : '#ff4a3a'; g.fill(); } }
      // labels (upright)
      g.font = '600 17px "PingFang SC","Microsoft YaHei",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(240,232,214,.62)';
      for (const [x, z, t] of (GT.chinatown && GT.chinatown.active ? GT.chinatown.mapLabels : [[32, -8, '小吃街'], [57, -62, '夜市'], [36, 114, '火锅'], [47, 76, '院'], [30, 145, '钟楼'], [131, 0, '轻轨'], [-36, -152, '码头'], [-34, 30, '江滩']])) { const px = mx(x, z), py = my(x, z); if (hyp(px - R, py - R) < R - 14) g.fillText(t, px, py); }
      const blip = (x, z, col, r, clampEdge, shape) => { let px = mx(x, z), py = my(x, z); const d = hyp(px - R, py - R); if (d > R - 12) { if (!clampEdge) return; px = R + (px - R) / d * (R - 12); py = R + (py - R) / d * (R - 12); r *= .8; }
        g.fillStyle = col; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 2; g.beginPath(); if (shape === 'd') { g.moveTo(px, py - r * 1.3); g.lineTo(px + r, py); g.lineTo(px, py + r * 1.3); g.lineTo(px - r, py); g.closePath(); } else if (shape === 's') g.rect(px - r, py - r, r * 2, r * 2); else g.arc(px, py, r, 0, TAU); g.fill(); g.stroke(); };
      for (const e of G.ents) { if (e === P.ent || !e.alive) continue; if (e.cop) blip(e.x, e.z, (G.time * 4 | 0) % 2 ? '#ff3b30' : '#3b82ff', 7, W.hot); else if (e.mode === 'traffic') blip(e.x, e.z, 'rgba(210,214,220,.55)', e.two ? 2.5 : 4); }
      { const sh = GT.shops; if (sh && sh.sites) { g.font = '800 13px "PingFang SC",sans-serif'; for (const q of sh.sites.concat((GT.chinatown && GT.chinatown.active && GT.chinatown.mapShops) || [])) { const px = mx(q.x, q.z), py = my(q.x, q.z);   /* MG: + the world's second set of counters (玉埠 on the coast) */ if (hyp(px - R, py - R) > R - 16) continue; const c = BIG.CATS[BIG.catOf(q.id)]; g.beginPath(); g.arc(px, py, 10, 0, TAU); g.fillStyle = c[1]; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke(); g.fillStyle = '#0d0f12'; g.fillText(c[2], px, py + 1); } } }   /* g6: shops on the minimap, same colours and glyphs as the big map (M) */
      if (G.scooter && P.ent !== G.scooter) blip(G.scooter.x, G.scooter.z, '#ffd24a', 6, true, 's');
      if (W.stars > 0 && !W.hot) { g.beginPath(); g.arc(mx(W.lastKnown.x, W.lastKnown.z), my(W.lastKnown.x, W.lastKnown.z), 26 * sc, 0, TAU); g.fillStyle = 'rgba(255,60,48,' + (.14 + sin(G.time * 4) * .05) + ')'; g.fill(); }
      if (ROUTE.pts.length > 1) { g.beginPath(); ROUTE.pts.forEach((q, i) => { const x = i ? mx(q[0], q[1]) : R, y = i ? my(q[0], q[1]) : R; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.lineJoin = g.lineCap = 'round'; g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 11; g.stroke(); g.strokeStyle = '#ffd23f'; g.lineWidth = 6.5; g.stroke(); }
      for (const e of FOES.list) blip(e.x, e.z, '#ff4a3a', 6, true); for (const p of FOES.picks || []) blip(p.x, p.z, '#ffd23f', 5, true, 's');
      for (const m of MARKS) { if (m.kind === 'enemy') { blip(m.x, m.z, '#ff4a3a', 6, true); continue; } let px = mx(m.x, m.z), py = my(m.x, m.z); const d = hyp(px - R, py - R), off = d > R - 16; if (off) { px = R + (px - R) / d * (R - 16); py = R + (py - R) / d * (R - 16); }
        g.save(); g.translate(px, py); g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 3; g.fillStyle = '#ffd23f'; if (off) { g.rotate(Math.atan2(py - R, px - R) + PI / 2); g.beginPath(); g.moveTo(0, -15); g.lineTo(11, 8); g.lineTo(0, 3); g.lineTo(-11, 8); g.closePath(); g.fill(); g.stroke(); }
        else { const k = 1 + sin(G.time * 4) * .08; g.beginPath(); g.arc(0, 0, 10 * k, 0, TAU); g.fill(); g.stroke(); g.beginPath(); g.arc(0, 0, 3.6, 0, TAU); g.fillStyle = '#101114'; g.fill(); } g.restore(); }
      // the player
      const a = yaw - P.h; g.translate(R, R); g.rotate(a); g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 5); g.lineTo(-8, 9); g.closePath(); g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 2; g.fill(); g.stroke(); g.restore();
      this.el.n.style.transform = 'rotate(' + (yaw + PI).toFixed(3) + 'rad) translateY(calc(var(--mr) * -1)) rotate(' + (-yaw - PI).toFixed(3) + 'rad)';
    },
    drawTags() { const cam = G.camera; if (!cam) return; const w = innerWidth, h = innerHeight;
      for (const m of MARKS) { if (!m.tag) continue; const d = m.dist(); _v1.set(m.x, (m.mesh ? m.mesh.position.y : 0) + 3.25, m.z).project(cam); let x = (_v1.x * .5 + .5) * w, y = (-_v1.y * .5 + .5) * h; const back = _v1.z > 1; if (back) { x = w - x; y = h * .9; }
        x = clamp(x, 90, w - 90); y = clamp(y, 90, h * .6); { const u = min(w / 1280, h / 720); if (x > w - 330 * u && y < 200 * u) y = 200 * u; } m.tag.style.transform = 'translate(' + x.toFixed(0) + 'px,' + y.toFixed(0) + 'px)'; m.tag.style.opacity = d < 3.2 || (P.inside && d > 30) || G.cine || HUD.slipRes || HUD.failRes ? 0 : 1; m.tag.children[1].textContent = m.label; m.tag.lastChild.textContent = Math.round(d) + ' m'; } }
  };
  /** GT.cngame.ui — what the story calls. slip() and fail() return Promises resolved when dismissed. */
  const ui = {
    achievement(text) { emit('achievement', { text }); if (!G.visual || !HUD.root) return; HUD.achQ.push(String(text)); },
    /** slip(title, [[label, value] | {label, value}], total, {auto: seconds}) — value: number ($, signed) or string */
    slip(title, lines, total, o) { emit('slip', { title, lines, total }); if (!G.visual || !HUD.root) return Promise.resolve(); const E = HUD.el.slip; if (HUD.slipRes) HUD.closeSlip();
      const fmt = v => typeof v === 'number' ? (v > 0 ? '+' : v < 0 ? '−' : '') + money(abs(v)) : String(v === undefined ? '' : v);
      E.querySelector('.cs-top b').textContent = title || ''; E.querySelector('.cs-lines').innerHTML = (lines || []).map((l, i) => { const lab = Array.isArray(l) ? l[0] : l.label, val = Array.isArray(l) ? l[1] : l.value; return '<div style="--i:' + i + '" class="' + (typeof val === 'number' ? (val < 0 ? 'neg' : 'pos') : 'txt') + '"><span></span><i></i><b></b></div>'; }).join('');
      (lines || []).forEach((l, i) => { const row = E.querySelector('.cs-lines').children[i]; row.firstChild.textContent = Array.isArray(l) ? l[0] : l.label; row.lastChild.textContent = fmt(Array.isArray(l) ? l[1] : l.value); });
      const tt = E.querySelector('.cs-total'); tt.style.display = total === undefined || total === null ? 'none' : ''; tt.style.setProperty('--i', (lines || []).length); tt.className = 'cs-total' + (typeof total === 'number' && total < 0 ? ' neg' : typeof total === 'number' && Math.abs(total) < .005 ? ' zero' : ''); tt.lastChild.textContent = fmt(total);
      E.classList.remove('on'); void E.offsetWidth; E.classList.add('on'); HUD.slipT0 = performance.now(); HUD.slipAuto = (o && o.auto) || 0; if (!G.silent) safe('sfx', () => GT.audio && GT.audio.sfx && GT.audio.sfx('ui_ok'));
      return new Promise(res => { HUD.slipRes = res; }); },
    mission(text) { text = text || ''; emit('mission', { text }); if (!G.visual || !HUD.root) return; if (text === HUD.missionText) return; HUD.missionText = text; const el = HUD.el.mission; el.classList.remove('on'); if (!text) return; setTimeout(() => { if (HUD.missionText !== text) return; el.lastChild.textContent = text; el.classList.add('on'); }, 260); },
    /** fail(reason) — 「任务失败：…」 card; the world pauses until Enter */
    fail(reason) { emit('fail', { reason }); if (!G.visual || !HUD.root) return Promise.resolve(); const E = HUD.el.fail, fb = E.querySelector('b'), len = [...String(reason || '')].length; fb.textContent = reason || ''; fb.style.cssText = len > 9 ? 'font-size:calc(var(--u) * ' + Math.max(30, Math.min(86, 1040 / (len * 1.13))).toFixed(1) + ');text-align:center;max-width:88vw;line-height:1.3;letter-spacing:.1em;padding-left:.1em' : 'text-align:center'; E.classList.add('on'); HUD.failT0 = performance.now(); G.paused = true; if (!G.silent) safe('sfx', () => GT.audio && GT.audio.sfx && GT.audio.sfx('ui_bad')); return new Promise(res => { HUD.failRes = res; }); },
    toast: (a, b) => HUD.toast(a, b), subtitle: (who, text, sec) => say(who, text, sec), hud: on => HUD.show(on !== false)
  };

  /* ================================================================== director: cutscene(shots) — a list of camera moves with optional lines, letterboxed
     shot = { d: seconds, p: [[x,y,z],[x,y,z]] (camera from → to), l: [[x,y,z],[x,y,z]] (look-at from → to), f: [fov0, fov1], e: 'io' | 'o' | undefined, say: [who, text], on() }
     On foot and in the saddle the shots run through ctl.takeover (the hero keeps animating); in a car or before play this module owns the camera. */
  const DIR = { cur: null, clock: 0, p: new T.Vector3(), l: new T.Vector3() };
  function shotPose(c, dt) {
    c.t += dt; DIR.clock += dt; let sh = c.shots[c.i]; while (sh && c.t >= sh.t0 + sh.d) { c.i++; sh = c.shots[c.i]; if (sh) startShot(c, sh); }
    if (!sh) { if (c.loop) { c.t = 0; c.i = 0; sh = c.shots[0]; startShot(c, sh); } else return null; }
    let u = clamp((c.t - sh.t0) / sh.d, 0, 1); const sm = u * u * (3 - 2 * u); u = sh.e === 'io' ? sm : sh.e === 'o' ? 1 - (1 - u) * (1 - u) : lerp(u, sm, .3);
    const a = sh.p, b = sh.l, p1 = a[1] || a[0], l1 = b[1] || b[0], k = sh.sh === undefined ? 1 : sh.sh, t = DIR.clock;
    DIR.p.set(lerp(a[0][0], p1[0], u) + sin(t * .83 + 1.3) * .012 * k, lerp(a[0][1], p1[1], u) + sin(t * 1.07) * .009 * k, lerp(a[0][2], p1[2], u) + sin(t * .71 + 4.1) * .012 * k); DIR.l.set(lerp(b[0][0], l1[0], u), lerp(b[0][1], l1[1], u), lerp(b[0][2], l1[2], u));
    DIR.fov = sh.f ? lerp(sh.f[0], sh.f[1] === undefined ? sh.f[0] : sh.f[1], u) : 40; if (sh.fol) trackPose(sh, sh.fol, u, dt); return sh;
  }
  /* tracking shot: sh.fol = { ent: object | () => object with {x, z, y?, h} (a vehicle entity, GT.cngame.player, a combat actor…),
       a: [a0, a1] bearing of the camera round the subject in rad (0 = dead ahead of it, PI = behind, +PI/2 = on its left), r: [r0, r1] distance m, y: [y0, y1] camera height above its feet,
       ly: look-at height (1), lead: metres the look-at point runs ahead of the subject (0), side: metres it sits to the subject's left (0), world: true = `a` is a compass bearing, not relative to its heading,
       at: [x, y, z] = camera bolted to a fixed spot instead (a / r / y ignored): a pan that follows the subject, lag: heading smoothing 1/s (4), hh: handheld sway 0..2 (1), to: second subject — look at the midpoint }
     The ordinary sh.e / sh.f easing and fov apply. Trauma from crashes (shake()) is added by the alive layer when the cutscene is live. */
  function trackPose(sh, F, u, dt) {
    const e = typeof F.ent === 'function' ? F.ent() : F.ent; if (!e) return; const L2 = (v, d) => v === undefined ? d : Array.isArray(v) ? lerp(v[0], v[1] === undefined ? v[0] : v[1], u) : v;
    if (F._h === undefined) F._h = e.h || 0; else F._h += angDiff(F._h, e.h || 0) * min(1, dt * (F.lag || 4));
    const h = F.world ? 0 : F._h, ey = e.y || 0, lead = L2(F.lead, 0), side = L2(F.side, 0); let lx = e.x + sin(e.h || 0) * lead + cos(h) * side, lz = e.z + cos(e.h || 0) * lead - sin(h) * side, ly = ey + L2(F.ly, 1);
    if (F.to) { const o = typeof F.to === 'function' ? F.to() : F.to; if (o) { lx = (lx + o.x) / 2; lz = (lz + o.z) / 2; ly = (ly + (o.y || 0) + L2(F.ly, 1)) / 2; } }
    if (F.at) DIR.p.set(F.at[0], F.at[1], F.at[2]); else { const a = h + L2(F.a, PI), r = L2(F.r, 6); DIR.p.set(e.x + sin(a) * r, ey + L2(F.y, 1.4), e.z + cos(a) * r); }
    const t = DIR.clock, k = (F.hh === undefined ? 1 : F.hh) * hyp(DIR.p.x - lx, DIR.p.z - lz) * .0045;       // handheld: the aim wanders a few milliradians, two detuned sines per axis
    DIR.l.set(lx + (sin(t * 2.3 + 1) + sin(t * 3.7) * .6) * k, ly + (sin(t * 2.9 + 2) + sin(t * 4.3 + .5) * .6) * k * .7, lz + (sin(t * 2.6 + 4) + sin(t * 3.3 + 3) * .6) * k);
  }
  function startShot(c, sh) { if (sh.say && !G.silent) say(sh.say[0], sh.say[1], sh.say[2]); if (sh.on) safe('shot.on', sh.on); if (c.fade && sh.fi !== undefined && GT.front && GT.front.fade && !G.silent) { safe('fade', () => GT.front.fade(1, 0)); safe('fade', () => GT.front.fade(0, sh.fi * 1000)); } const fx = GT.render && GT.render.fx; if (fx && 'mblur' in fx) { c.mb = c.mb === undefined ? fx.mblur : c.mb; fx.mblur = 0; c.cut = 2; } }
  function applyDir(cam) { cam.position.copy(DIR.p); cam.up.set(0, 1, 0); cam.lookAt(DIR.l); if (abs(cam.fov - DIR.fov) > .005) { cam.fov = DIR.fov; cam.updateProjectionMatrix(); } }
  /** cutscene(shots, {letterbox: true, loop: false, hud: false}) -> Promise (resolves when the last shot ends or skip() is called) */
  function cutscene(shots, o) {
    o = o || {}; if (!Array.isArray(shots) || !shots.length) return Promise.resolve(); endCutscene();
    let t = 0; for (const s of shots) { s.t0 = t; s.d = s.d > 0 ? s.d : 3; t += s.d; }
    const c = DIR.cur = { shots, i: 0, t: 0, len: t, loop: !!o.loop, fade: o.fade !== false, res: null, tk: null, menu: !!o.menu, live: !!o.live, lb: o.letterbox !== false }; G.cine = c; startShot(c, shots[0]);
    if (G.visual && !o.menu) { if (o.letterbox !== false && GT.front && GT.front.letterbox) safe('letterbox', () => GT.front.letterbox(true)); if (!o.hud) HUD.show(false); }
    /* live (the trailer): the simulation, the controller and combat keep running under the shots; the camera is simply overwritten each frame by dirTick() */
    const ctl = G.ctl; if (ctl && G.visual && ctl.enabled && P.mode !== 'car' && !o.menu && !o.live) { c.tk = safe('ctl.takeover', () => ctl.takeover({ heroState: o.heroState || 'idle', blend: .01, blendOut: o.blendOut === undefined ? .6 : o.blendOut, update(dt) { return !shotPose(c, dt) || DIR.cur !== c; }, camera() { return { pos: [DIR.p.x, DIR.p.y, DIR.p.z], look: [DIR.l.x, DIR.l.y, DIR.l.z], fov: DIR.fov }; }, onEnd() { if (DIR.cur === c) endCutscene(); } }), null); shotPose(c, 0); }
    return new Promise(res => { c.res = res; });
  }
  function endCutscene() { const c = DIR.cur; if (!c) return; DIR.cur = null; G.cine = null; const fx = GT.render && GT.render.fx; if (fx && c.mb !== undefined) fx.mblur = c.mb; if (c.tk && c.tk.end) { const tk = c.tk; c.tk = null; safe('tk.end', () => tk.end()); }
    if (G.visual && !c.menu) { if (c.lb && GT.front && GT.front.letterbox) safe('letterbox', () => GT.front.letterbox(false)); if (G.phase === 'play' && G.Q.get('hud') !== '0' && !G.trailer) HUD.show(true); } if (c.res) c.res(); }
  /** own-camera cutscenes (menu flyby, in a car, no controller): advanced from the main loop */
  function dirTick(dt) { const c = DIR.cur; if (!c || c.tk) return false; if (!shotPose(c, dt)) { endCutscene(); return false; } if (c.cut > 0) c.cut--; else { const fx = GT.render && GT.render.fx; if (fx && c.mb !== undefined && fx.mblur !== c.mb) fx.mblur = c.mb; } applyDir(G.camera); return true; }

  /* ================================================================== audio glue (GT.audio: round-1 synth for cars / sirens / ui + the "alive" layer: footsteps, e-scooter, city bed, impacts, stings) */
  const AU = { on: false, siren: 0, sq: 0, sig: false, pv: 0, squealT: -9, bumpT: -9, missT: -9, cardT: -9, inn: -1, veh: [] };
  function audioInit() { if (AU.on || !GT.audio || !GT.audio.init || !G.visual) return; AU.on = !!safe('audio.init', () => { GT.audio.init(); return true; }, false); if (AU.on) safe('audio.amb', () => { GT.audio.setRadio && GT.audio.setRadio(false); GT.audio.ambience({ surf: 0, traffic: .5, whoosh: false }); }); }
  function audioStep(dt) {
    if (!AU.on) return; const A = GT.audio, e = P.ent, car = P.mode === 'car' && e && e.c, two = P.mode === 'two' && e;
    if (GT.vehicleRadio) GT.vehicleRadio.update(!!car, G.phase === 'play' && !G.paused && !G.cine && !document.hidden);
    let sd = 999, sc = null; for (const c of G.cops) if (c.lights.siren) { const d = hyp(c.x - P.x, c.z - P.z); if (d < sd) { sd = d; sc = c; } }
    const lvl = (sc ? (W.hot ? clamp(.62 + W.stars * .06, 0, 1) : .4) : 0) * (1 - clamp(G.sirenMask || 0, 0, .96));   /* G.sirenMask: js/street.js, the dance speaker drowns the sirens */
    // the V8 voice is for cars only (the e-scooter has its own electric voice below); place / hour / traffic now come from A.city()
    safe('audio.update', () => A.update(dt, { engine: { on: !!car, rpm: car ? clamp((e.c.rpm - 720) / 5480, 0, 1) : 0, load: car ? clamp(e.c.thr, 0, 1) : 0, speed: car ? P.speed : 0 }, siren: { level: lvl, distance: sd, rel: 0 } }));
    const sq = car && G.phase === 'play' && !G.paused && !G.cine && !document.hidden ? e.c.squeal : 0;
    if (sq > .28 || AU.sq > .28) safe('squeal', () => A.sfx('tire_squeal', { level: sq }));
    AU.sq = sq;
    if (!A.city || !A.scooter) return;
    safe('audio.alive', () => {
      // e-scooter: motor whine / regen / tyre roll / wind follow speed, throttle, brake and surface; squeal at the end of a hard stop, thunk on kerbs, indicator tick
      const esc = two && e.kind === 'escooter', v = two ? abs(e.v) : 0, dv = dt > 0 ? (v - AU.pv) / dt : 0, braking = two && (IN.brake || IN.thr < 0); AU.pv = v; AU.decel = two ? lerp(AU.decel || 0, -dv, min(1, dt * 12)) : 0;
      A.scooter({ on: !!esc, speed: v, thr: esc ? max(0, IN.thr) : 0, brake: esc && braking ? 1 : 0, surface: two ? surface(e.x, e.z).name : 'asphalt', wet: two && GT.fxsmall && GT.fxsmall.wetAt && GT.fxsmall.wetAt(e.x, e.z) ? 1 : (GT.env && GT.env.wet) || 0 });
      if (two && dt > 0) {
        if (braking && AU.decel > 5 && v > .8 && v < 5.5 && G.time - AU.squealT > 1.6) { AU.squealT = G.time; A.sfx('brake_squeal', { v: clamp(AU.decel / 9, .3, 1) }); }
        if (abs(e.bumpV || 0) > .55 && v > 1.5 && G.time - AU.bumpT > .4) { AU.bumpT = G.time; A.sfx('kerb', { v: clamp(abs(e.bumpV) / 1.4, .3, 1) }); shake(.22); }
      }
      const sig = !!(two && (e.lights.left || e.lights.right || e.lights.hazard)); if (sig !== AU.sig) { AU.sig = sig; A.sfx('turn_signal', { on: sig, g: .7 }); }
      // interiors: short room reverb on your own steps, the street low-passed (P.indoor comes from the controller's 'zone' event, P.inside from the hero's room)
      const inn = P.inside ? 1 : P.indoor ? .55 : car && CAM.mode === 'fp' ? .8 : 0; if (inn !== AU.inn) { AU.inn = inn; A.interior(P.inside || P.indoor ? 1 : 0); }
      // the city bed: listener at the player's head, facing where the camera looks; nearby traffic for pass-by voices
      const cam = G.camera, cin = G.cine && !G.cine.tk, ex = cin ? cam.position.x : P.x, ez = cin ? cam.position.z : P.z, ey = cin ? cam.position.y : (P.y || 0) + 1.6, d = cam.getWorldDirection(_v2), veh = AU.veh; let n = 0, miss = null;
      for (const o of G.ents) { if (o === e || !o.alive || o.mode === 'parked' || o.mode === 'player') continue; const dd = abs(o.x - ex) + abs(o.z - ez); if (dd > 90) continue;
        const q = veh[n] || (veh[n] = {}); n++; q.id = o.id; q.x = o.x; q.z = o.z; q.vx = sin(o.h) * o.v; q.vz = cos(o.h) * o.v; q.v = abs(o.v); q.kind = o.kind;
        if (dd < 4.5 && !cin && P.mode !== 'car') { const rvx = q.vx - (two ? sin(e.h) * e.v : 0), rvz = q.vz - (two ? cos(e.h) * e.v : 0); if (hyp(rvx, rvz) > 6.5 && hyp(o.x - ex, o.z - ez) < (o.dims.W || 1.8) / 2 + 1.7) miss = o; } }
      veh.length = n;
      if (miss && G.time - AU.missT > 2 && P.down <= 0) { AU.missT = G.time; A.sfx('whoosh', { g: 1 }); shake(.3); }                      // near miss: a gust and a flinch
      const tr = GT.landmarks && GT.landmarks.train, rl = CN.rail;
      A.city({ x: ex, y: ey, z: ez, fx: d.x, fz: d.z, vx: two || car ? sin(e.h) * e.v : 0, vz: two || car ? cos(e.h) * e.v : 0, hours: G.hours, night: (GT.env && GT.env.night) || 0, interior: inn, indoor: !!(P.inside || P.indoor), vehicles: veh, force: !!AU.force,
        train: tr ? { x: tr.x, y: (rl && rl.y) || 14, z: tr.z, speed: tr.speed, visible: tr.visible } : null });
    });
  }
  function audioEvent(type, d) {
    if (!AU.on) return; const A = GT.audio;
    safe('audio.evt', () => {
      if (type === 'horn') A.sfx('horn', { on: !!d.on, weedy: !!(d.ent && d.ent.two), g: 1 });
      else if (type === 'honk') { const dd = hyp(d.x - P.x, d.z - P.z); if (dd < 45) A.sfx('horn', { dur: d.bell ? .14 : .35, weedy: !!d.bell, x: d.x, y: 1.1, z: d.z, g: d.bell ? .55 : .9 }); }
      else if (type === 'crash') { const v = d.v || .3; if (d.two) { A.sfx(v > .3 ? 'scooter_crash' : 'scrape', { v }); if (v > .3 && !d.by) A.sfx('scrape', { v: v * .8 }); } else { A.sfx('crash', { v }); if (v > .55) A.sfx('glass', { distance: 1 }); else if (v < .2) A.sfx('thunk'); } shake(.2 + v * .9); }
      else if (type === 'fall') { A.sfx('body_fall', { v: .9 }); shake(.7); } else if (type === 'hit') { A.sfx('body_fall', { v: 1 }); A.sfx('thunk'); shake(1); } else if (type === 'getup') A.sfx('cloth', { g: 1.6 });
      else if (type === 'land') { A.sfx('land', { v: clamp(((d && d.h) || .4) / 1.1, .3, 1) }); shake(.12); }
      else if (type === 'star') A.sfx('star'); else if (type === 'spotted' || type === 'unit') A.scanner && A.scanner('unit'); else if (type === 'clear') A.scanner && A.scanner('clear');
      else if (type === 'delivered' || type === 'buy') A.sfx('cash'); else if (type === 'broke') A.sfx('ui_bad'); else if (type === 'order' && d.state === 'deliver') A.sfx('pickup');
      else if (type === 'mount') { A.sfx('kickstand', { up: true }); if (d.kind === 'escooter') A.sfx('key_turn', { g: .4 }); } else if (type === 'dismount') A.sfx('kickstand');
      else if (type === 'enterCar') A.sfx('ignition'); else if (type === 'exitCar') A.sfx('door_close', { g: .7 });
      else if (type === 'violation') { if (!G.trailer) A.sfx('ui_bad', { g: .6 }); } else if (type === 'whistle') A.sfx('ui_tick');
      else if (type === 'bus') { const b = d.ent; if (b) A.sfx('bus_door', { x: b.x, y: 1.4, z: b.z, g: 1 }); }
      else if (type === 'missionStart') A.sfx('sting_start'); else if (type === 'missionDone') A.sfx('sting_complete'); else if (type === 'fail' || type === 'busted') A.sfx('sting_fail');
      else if (type === 'mission') { if (d.text && d.text !== AU.card && G.time - AU.cardT > .8) { AU.cardT = G.time; A.sfx('ui_card'); } AU.card = d.text; }
      else if (type === 'phone') A.sfx('ui_phone', { open: !!d.open }); else if (type === 'charge') { if (d.on) A.sfx('ui_ok', { g: .5 }); }
    });
  }

  /* ================================================================== "alive" layer glue: small reactive fx (js/fxsmall.js), camera shake, braking dive. Sound is wired in audioStep / audioEvent above. */
  const FEEL = { tr: 0, t: 0 };
  /** add camera trauma 0..1 (decays ~2/s; displacement goes with its square) */
  function shake(a) { FEEL.tr = min(1, FEEL.tr + a); }
  function aliveInit() {
    if (GT.audio && GT.audio.footstep && !GT.audio._fsGuard) { const fs = GT.audio.footstep; GT.audio._fsGuard = true; GT.audio.footstep = ev => (G.silent || !G.visual ? null : fs(ev)); }   // no footsteps while ff() fast-forwards the simulation
    const F = GT.fxsmall; if (!F || !F.init || !G.visual || G.Q.get('fxsmall') === '0') return; if (!safe('fxsmall.init', () => { F.init(G.scene); return true; }, false)) return; G.fxs = F;
    const ctl = G.ctl; if (ctl) { ctl.on('step', ev => emit('step', ev)); ctl.on('land', ev => emit('land', ev)); }                              // forwarded so GT.cngame.on('step' | 'land') works for everyone
    on('step', ev => { if (!G.silent) safe('fx.step', () => F.step(ev)); }); on('land', ev => { if (!G.silent) safe('fx.land', () => F.land(ev)); });
    on('crash', ev => { if (G.silent || !ev || !ev.two) return; const e = ev.ent || P.ent || G.scooter, v = ev.v || .3; if (!e) return; safe('fx.crash', () => { const fx = sin(e.h), fz = cos(e.h); F.sparks(e.x + fx * .6, (e.y || 0) + .35, e.z + fz * .6, Math.round(5 + v * 16), -fx, -fz); F.puff(e.x + fx * .5, e.y || 0, e.z + fz * .5, { n: 3 + Math.round(v * 4), size: .4, a: .22, spread: .8 }); }); });
    on('fall', () => { if (!G.silent) safe('fx.fall', () => F.puff(P.x, P.y || 0, P.z, { n: 5, size: .45, a: .2, spread: .9, up: .2 })); });
  }
  /** ?auto=free&audiolog=walk (&px=&pz=) | ?auto=ride&audiolog=ride — proof that the real game loop triggers the sounds: 20 s of the simulation
      (scripted walk: 8 s walk, 3 s sprint, turn, 9 s walk back / ride: autopilot, a hard stop at 9 s, autopilot again, a deliberate scrape at 14.5 s, brake, F to get off, walk), then GT.audio.stats() on the page.
      Default = paced in real time against the audio clock, so clock-scheduled sounds (birds, emitter sequencers) are counted properly; &live=0 = 1200 steps in one go. */
  function aliveLog(kind) {
    G.freeze = false; audioInit(); const A = GT.audio, ctl = G.ctl, pre = document.createElement('pre'); pre.id = 'audiolog'; pre.style.cssText = 'position:fixed;inset:0;margin:0;padding:10px 14px;background:rgba(8,10,14,.93);color:#d5dbe3;font:' + (+G.Q.get('font') || 12) + 'px/1.3 ui-monospace,Menlo,monospace;z-index:99999;white-space:pre-wrap;column-count:3';
    document.body.appendChild(pre); if (!A || !A.stats || !AU.on) { pre.textContent = 'audio not running: ' + (A ? 'init failed' : 'GT.audio missing'); return; } A.resetStats(); pre.textContent = 'running ' + kind + ' …';
    const feed = v => GT.input && GT.input.feed && GT.input.feed(v), ev = {}, off = on('*', t => { ev[t] = (ev[t] || 0) + 1; }), trail = [], live = G.Q.get('live') !== '0', a0 = A.ctx ? A.ctx.currentTime : 0;
    let maxTr = 0, maxDive = 0, minDive = 0, maxV = 0, t = 0, frames = 0, done = false, mark = 2;
    const drive = () => {
      if (kind === 'walk') { if (frames % 30 === 0) { trail.dodge = trail.lx !== undefined && hyp(P.x - trail.lx, P.z - trail.lz) < .15 ? (trail.dodge ? -trail.dodge : .9) : 0; trail.lx = P.x; trail.lz = P.z; }   // walked into something: sidestep
        if (ctl && ctl.camera) { ctl.camera.yaw = (t < 11 ? 0 : PI) + (trail.dodge || 0); ctl.camera.pitch = .14; } feed({ down: t < 8 ? ['KeyW'] : t < 11 ? ['KeyW', 'ShiftLeft'] : ['KeyW'] }); }
      else { const e = P.ent;   // 0-9 s autopilot, 9-11 hard brake, 11-14.5 autopilot again, 14.5-16.5 throttle into the kerb side (a deliberate scrape), brake, F to get off, walk
        if (t >= 9 && t < 11) { G.ap.on = false; feed({ down: ['Space', 'KeyS'] }); } else if (t >= 11 && t < 14.5) { if (!G.ap.on && P.mode === 'two') { feed({ down: [] }); apOn('bikeB', 10.5); } }
        else if (t >= 14.5 && t < 16.5) { G.ap.on = false; feed({ down: ['KeyW', 'KeyA'] }); } else if (t >= 16.5 && P.mode === 'two') { G.ap.on = false; if (e && abs(e.v) < 1.4 && !trail.off) { trail.off = 1; feed({ down: [], press: ['KeyF'] }); } else feed({ down: trail.off ? [] : ['Space'] }); } else if (t >= 16.5) feed({ down: ['KeyW'] }); } };
    const sample = dt => { t += dt; frames++; maxTr = max(maxTr, FEEL.tr); const e = P.ent; if (e) { maxDive = max(maxDive, e.dive || 0); minDive = min(minDive, e.dive || 0); maxV = max(maxV, abs(e.v)); } if (t >= mark) { trail.push(mark + 's ' + P.x.toFixed(1) + ',' + P.z.toFixed(1) + ' ' + (P.mode === 'foot' && ctl ? ctl.state : P.mode)); mark += 2; } };
    const finish = () => { done = true; feed(null); off(); G.freeze = true; G.logHook = null; const st = A.stats(), F = GT.fxsmall, keys = Object.keys(st.counts).sort(), pad = (k, n) => (k + ' '.repeat(n)).slice(0, n);
      pre.textContent = 'AUDIO TRIGGER LOG — ' + kind + ', 20 s of the real ' + (live ? 'simulation in real time (' + frames + ' steps, audio clock advanced ' + ((A.ctx ? A.ctx.currentTime : 0) - a0).toFixed(1) + ' s)' : 'simulation (1200 bare steps)') + ', hour ' + G.hours.toFixed(2) + '\nplayer ended at x ' + P.x.toFixed(1) + ' z ' + P.z.toFixed(1) + ' mode ' + P.mode + (kind === 'ride' ? '  top speed ' + maxV.toFixed(1) + ' m/s' : '') +
        '\ntrail ' + trail.join(' | ') + '\nflocks ' + (F ? F.flocks.map(f => f.kind + '@' + f.x + ',' + f.z + ' y' + f.y.toFixed(2) + ' ' + f.state).join(' ') + ' | hero y ' + (P.y || 0).toFixed(2) : '-') + '\n\nGT.audio.stats().counts\n' +
        keys.map(k => '  ' + pad(k, 24) + st.counts[k]).join('\n') + '\n\nvoices ' + JSON.stringify(st.voices) + '\ncontext ' + st.state + '\n\ngame events seen\n' + Object.keys(ev).sort().map(k => '  ' + pad(k, 24) + ev[k]).join('\n') +
        '\n\ncamera trauma peak ' + maxTr.toFixed(2) + '   braking dive max ' + maxDive.toFixed(3) + ' rad, squat ' + minDive.toFixed(3) + '\n\nGT.fxsmall.stats\n  ' + (F ? JSON.stringify(F.stats).replace(/,"/g, '\n  "') : 'not loaded') + '\n\nwarnings ' + G.warnings.length + (G.warnings.length ? '\n  ' + G.warnings.slice(0, 12).join('\n  ') : ''); document.title = 'audiolog-done'; };
    if (live) {   // paced by the audio clock (the only real-time clock a virtual-time headless run has): 1200 steps of step + audioStep + aliveStep, each waiting for its 1/60 s of audio time
      G.freeze = true; (async () => { const ac = A.ctx; for (let i = 0; i < 1200; i++) { drive(); step(1 / 60); audioStep(1 / 60); aliveStep(1 / 60, true); sample(1 / 60);
          for (let k = 0; k < 400 && ac && ac.state === 'running' && ac.currentTime < a0 + (i + 1) / 60; k++) { await new Promise(r => setTimeout(r, 0)); let junk = 0; for (let j = 0; j < 5000000; j++) junk += Math.sqrt(j); if (junk < 0) break; } }
        finish(); })().catch(e => { pre.textContent += '\nlog failed: ' + (e.stack || e); }); return; }
    AU.force = true; for (let i = 0; i < 1200; i++) { drive(); step(1 / 60); audioStep(1 / 60); aliveStep(1 / 60, true); sample(1 / 60); } AU.force = false; finish();
  }
  /** stills of the small fx: ?fxrun=<max s>[&fxkeys=KeyW,ShiftLeft][&fxuntil=<fxsmall emitter>:<n>][&fxmore=<s>][&fxap=0] — after the ?auto= jump keep simulating (not silent)
      with those keys held until that emitter has fired n times (+ fxmore seconds), then freeze for the screenshot */
  function aliveStill() { const Q = G.Q, maxT = +Q.get('fxrun') || 0; if (!maxT) return; const keys = (Q.get('fxkeys') || '').split(',').filter(Boolean), un = (Q.get('fxuntil') || '').split(':'), more = +Q.get('fxmore') || 0, F = GT.fxsmall, feed = v => GT.input && GT.input.feed && GT.input.feed(v);
    if (Q.get('fxap') === '0') G.ap.on = false; G.freeze = false; let t = 0, hit = -1; const n0 = F && un[0] ? (F.stats.emitted[un[0]] || 0) : 0, yw = Q.get('yaw') !== null && G.ctl ? +Q.get('yaw') * PI / 180 : null;
    while (t < maxT) { if (yw !== null && Q.get('fxyaw') === '1') G.ctl.camera.yaw = yw; if (keys.length || !G.ap.on) feed({ down: keys }); step(1 / 60); aliveStep(1 / 60, true); t += 1 / 60; if (hit < 0 && un[0] && F && (F.stats.emitted[un[0]] || 0) - n0 >= (+un[1] || 1)) hit = t; if (hit >= 0 && t >= hit + more) break; }
    if (Q.get('fxdemo') === '1' && F) {   // contact sheet: fire every emitter once in a row across the view, 2.5-4 m ahead of the player, and let them live for 0.12 s
      const yw = G.ctl ? G.ctl.camera.yaw : P.h, fx = sin(yw), fz = cos(yw), rx = -cos(yw), rz = sin(yw), y = P.y || 0, at = (k, d) => [P.x + fx * d + rx * k, P.z + fz * d + rz * k];
      let p = at(-2.2, 3.2); F.puff(p[0], y, p[1], { n: 6, size: .45, a: .3, spread: .5 }); p = at(-1.1, 3); F.splash(p[0], y, p[1], 1); p = at(0, 3.4); F.leaves(p[0], y, p[1], 9, 0, 0);
      p = at(1.1, 3); F.sparks(p[0], y + .4, p[1], 22, rx, rz); p = at(2.2, 3.2); for (let k = 0; k < 6; k++) F.skid(p[0] + fx * k * .35, y, p[1] + fz * k * .35, yw, .4);
      for (let i = 0; i < 7; i++) F.update(1 / 60, G.camera, { x: P.x, y, z: P.z, speed: 0 }); }
    feed(null); G.freeze = true; if (G.ctl) safe('ctl.update', () => G.ctl.update(0)); }
  function aliveStep(dt, play) {
    const e = P.ent, two = P.mode === 'two' && e;
    if (play && dt > 0) {
      // braking dive / squat on the bike (visual only: rideStep already springs e.bump / e.pitch for kerbs; this adds the fork diving under the brakes — applied in syncEnt)
      if (two) { const a = AU.on ? (AU.decel || 0) : 0, acc = AU.on ? a : ((FEEL.pv2 || 0) - abs(e.v)) / dt; FEEL.pv2 = abs(e.v); FEEL.acc = lerp(FEEL.acc || 0, acc, min(1, dt * 10)); e.dive = damp(e.dive || 0, clamp(FEEL.acc * .0085, -.03, .065), 9, dt); }
      if (G.fxs && two) safe('fx.ride', () => G.fxs.ride({ x: e.x, y: e.y, z: e.z, h: e.h, v: e.v, brake: !!(IN.brake || IN.thr < 0), decel: FEEL.acc || 0, surface: surface(e.x, e.z).name, dt }));
      // camera feel: trauma shake (crash, fall, kerb, near miss) + a faint road buzz at speed. Applied after the controller placed the camera, before the frame is drawn.
      FEEL.t += dt; FEEL.tr = max(0, FEEL.tr - dt * 1.9); const cam = G.camera;
      if (cam && (!G.cine || G.cine.live) && G.Q.get('shake') !== '0') { const sp = two ? abs(e.v) : 0, buzz = two ? sstep(sp, 5, 13) * (surface(e.x, e.z).name === 'paver' ? .0055 : .0032) : 0, k = FEEL.tr * FEEL.tr, t = FEEL.t;
        if (k > 1e-4 || buzz > 1e-5) { const n1 = sin(t * 37.1) + sin(t * 59.3 + 1.3) * .6, n2 = sin(t * 43.7 + .7) + sin(t * 71.9 + 2.1) * .6, n3 = sin(t * 31.3 + 4.1);
          cam.position.y += n1 * (k * .05 + buzz); cam.position.x += n2 * k * .035; cam.rotation.z += n3 * k * .022; cam.rotation.x += n2 * (k * .012 + buzz * .2); } }
    }
    if (G.fxs) safe('fx.update', () => G.fxs.update(G.paused || G.freeze ? 0 : dt, G.camera, { x: P.x, y: P.y || 0, z: P.z, speed: P.speed || 0 }));
  }

  /* ================================================================== simulation step (no rendering; also used by the ?auto= fast-forward and the self-test) */
  function apStep(dt) {
    const A = G.ap, e = P.ent; if (!e || !A.path) return;
    A.s = pathAdvance(A.path, A.s, e.x, e.z); const sp = abs(e.v), q = pathAt(A.path, A.s + 4 + sp * .55, _q1), err = angDiff(e.h, Math.atan2(q.x - e.x, q.z - e.z));
    A.steer = clamp(-err * 2.6, -1, 1); let vT = min(A.speed, pathSpeed(A.path, A.s, 5));
    if (!A.runRed && abs(e.x) < 8.4 && abs(sin(e.h)) < .5) { const dir = cos(e.h) > 0 ? 1 : -1, st = sigStop(e.z + dir * e.dims.L / 2, dir); if (st && st.car !== 'green' && st.dist < 40 && !(st.car === 'amber' && st.dist < sp * 1.1)) vT = min(vT, max(0, (st.dist - .8) * .8)); }
    A.thr = sp < vT - .3 ? 1 : sp > vT + 1.2 ? -1 : sp > vT + .3 ? -.3 : .15; A.brake = vT === 0 && sp < 1;
  }
  function step(dt) {
    G.time += dt; if (G.fixedHours === null && G.holdHours === null) G.hours = (G.hours + dt * G.dayRate) % 24; else G.hours = G.fixedHours !== null ? G.fixedHours : G.holdHours;
    if (G.downT > 0 && !G.visual) G.downT = 0;
    const S = SIG(); if (!G.sigHold) { if (S.update && !G.bad.sigU) { try { S.update(dt); } catch (e) { G.bad.sigU = 1; warn('signals.update', e); } } if (S !== FBSIG) FBSIG.time += dt; }   /* sigHold: signalLock() — every light held at red (four stars) */
    const ctl = G.visual ? G.ctl : null; if (ctl && GT.input && GT.input.frame) safe('input.frame', () => GT.input.frame());
    if (G.trailer && G.trailer.step) G.trailer.step(dt);       // js/cntrailer.js: scripted drivers (the van, the roadblock…) and timed stunts, on the simulation clock so ?auto=trailer&at= reproduces them
    if (G.ap.on) apStep(dt); readInput(dt);
    playerStep(dt); trafficStep(dt); wantedStep(dt); policeStep(dt); bayStep(dt); dashStep(); jobsStep(dt); marksStep(dt); bikesStep(); if (GT.shops && GT.shops.update && !G.bad.shops) { try { GT.shops.update(dt); } catch (e) { G.bad.shops = 1; warn('shops.update', e); } } if (GT.street && GT.street.update && !G.bad.street) { try { GT.street.update(dt); } catch (e) { G.bad.street = 1; warn('street.update', e); } } if (GT.economy && GT.economy.update && !G.bad.eco) { try { GT.economy.update(dt); } catch (e) { G.bad.eco = 1; warn('economy.update', e); } }   /* js/street.js: the five street set pieces */
    const sc = G.scooter; if (sc) { const rs = CN.riderStart; G.chargingNow = (G.charging || (sc.mode === 'parked' && hyp(sc.x - rs.x, sc.z - rs.z) < 5)) && G.battery < 1; if (G.chargingNow) G.battery = min(1, G.battery + dt / 70); }
    if (ctl) { if (P.ent) syncEnt(P.ent, 0); if (G.vehDirty && !ctl.busy) syncVehList();
      try { ctl.update(dt); } catch (e) { if (!G.bad.ctlU) { G.bad.ctlU = 1; warn('ctl.update', e); } }
      if (P.mode === 'car' && P.ent) { ctl.pos.x = P.x; ctl.pos.z = P.z; ctl.pos.y = P.y; ctl.h = P.h; if (G.kai.group) G.kai.group.visible = false; safe('ctl.updateCar', () => ctl.updateCar && ctl.updateCar(dt, { x: P.x, z: P.z, h: P.h, speed: P.speed })); }
      if (G.combatOn && !G.bad.combatU && (P.mode === 'foot' || GT.combat.engaged) && (!G.cine || G.cine.live)) { try { GT.combat.update(dt, { ctl, hero: ctl.hero || G.hero, camera: G.camera, input: GT.input, partner: G.partnerOn ? ctl.partnerFig : null }); } catch (e) { G.bad.combatU = 1; warn('combat.update', e); } }
      else if (G.combatOn && !G.bad.combatU && P.mode !== 'foot' && GT.combat.npcTick && G.cops.some(c => c.cop && c.cop.crew)) safe('combat.npcTick', () => GT.combat.npcTick(dt, P.x, P.z, P.y || 0, P.speed || 0));
      if (G.combatOn && !G.bad.combatU && P.mode !== 'foot' && !GT.combat.engaged && GT.combat.lootTick) { const e = P.ent; safe('combat.lootTick', () => GT.combat.lootTick(dt, P.x, P.z, P.y || 0, e ? { h: e.h, L: e.two ? 2 : (e.dims && e.dims.L) || 4.5, W: e.two ? .9 : (e.dims && e.dims.W) || 1.9 } : null)); } }   /* QA: loot on the ground keeps its clock while he drives, and driving over it picks it up */   /* pt1: officers still on foot while he drives keep moving (back to their unit) */
    const hi = Math.floor(G.hours); if (hi !== G.hourI) { G.hourI = hi; emit('hour', { hours: hi }); }
  }

  /* ================================================================== world build + cast */
  function buildMod(scene, name, fb) { let res = null, ok = false; const m = GT[name];
    if (m && m.build) { try { res = m.build(scene); ok = true; } catch (e) { warn(name + '.build', e); } }
    if (!ok && fb) { try { res = fb(scene); } catch (e) { warn(name + ' placeholder', e); } } G.mods[name] = ok ? 'ok' : (m ? 'broken' : 'missing') + (fb ? '→placeholder' : ''); return res; }
  function wrapHero(k) { const w = Object.create(k); w.update = (dt, s) => { const e = P.ent; if (s && e && P.mode === 'two' && e.kind === 'sharebike' && s.state === 'ride') { s.pedal = abs(e.v) > .4 ? 1 : 0; s.seatH = .9; s.speed = abs(e.v); } return k.update(dt, s); }; return w; }
  /** g7: where a game starts — on the pavement, $500 in the pocket, a car of his own at the kerb beside him (unlocked, F to get in). ct = 玉埠 Lantern St south of the gate, between the kerb
      and the walkers' lanes (x = -8 … -9.1) and past the parking meter, so the third-person camera starts clear of both; river = the old 江城 courtyard. */
  const START_CASH = 500, SPAWNS = { ct: { x: -7.15, z: -80.6, h: .2, car: { kind: 'muscle', x: -5.45, z: -81.8, h: 0, color: 0x1d3c63 } }, river: { x: 28.4, z: 61.6, h: -PI / 2, car: { kind: 'muscle', x: 30.5, z: 57.6, h: -PI / 2, color: 0x1d3c63 } } };
  const spawnPt = () => GT.chinatown && GT.chinatown.active ? SPAWNS.ct : SPAWNS.river;
  function placeMyCar() { const c = spawnPt().car; let e = G.mycar; if (e && (!e.alive || P.ent === e)) e = null; if (!e) { e = G.mycar = mkEnt(c.kind, { x: c.x, z: c.z, h: c.h, color: c.color, mode: 'parked', tag: 'mine' }); G.vehDirty = true; }
    e.x = c.x; e.z = c.z; e.h = c.h; e.v = 0; e.mode = 'parked'; e.y = groundY(c.x, c.z, 0); if (e.c) { e.c.vx = e.c.vy = e.c.r = 0; } safe('syncEnt', () => syncEnt(e, 0)); return e; }
  function castStep(o) {
    const scene = G.scene, rs = spawnPt(); wallet(); if (!G.cashInit) { G.cashInit = true; if (wallet().cash <= 0) wallet().add(START_CASH, 'pocket'); }
    if (GT.hero && GT.hero.make) { safe('hero.preload', () => { if (GT.hero.preload && !G.auto) { GT.hero.preload('kai'); } }); G.kai = safe('hero.make(kai)', () => GT.hero.make('kai', { outfit: 'rider', box: false }), null); if (G.Q.get('partner') === '1') G.lie = safe('hero.make(lie)', () => GT.hero.make('lie', { outfit: 'kitchen' }), null); }   /* outfit 'rider' is hero.js's key for the plain grey tee, jeans and white trainers */
    if (!G.kai || !G.kai.group) { G.kai = fbPerson(0x8a8d92); G.mods.hero = 'placeholder'; } else G.mods.hero = 'ok';
    scene.add(G.kai.group); if (G.lie && G.lie.group) scene.add(G.lie.group); G.hero = G.kai.placeholder ? G.kai : wrapHero(G.kai);
    G.scooter = null; placeMyCar();   /* g7: no scooter of his own any more (G.scooter stays null outside the self-test) */
    if (GT.chinatown && GT.chinatown.active) safe('chinatown.populate', () => GT.chinatown.populate(api)); else for (const [nm, fx, fz] of [['bikeBay4', 12.85, 48], ['bikeBay3', 12.85, 8], ['bikeBay1', 12.85, -62]]) { const a = anchor(nm, { x: fx, z: fz }); mkEnt('sharebike', { x: a.x, z: a.z + 1.1, h: -PI / 2, locked: true, opts: { parked: true } }); }
    if (G.Q.get('traffic') !== '0') spawnTraffic(G.Q.get('traffic') !== null ? +G.Q.get('traffic') : undefined);
    if (GT.onfoot && GT.onfoot.create) {
      const ctl = G.ctl = safe('onfoot.create', () => GT.onfoot.create({ scene, camera: G.camera, hero: G.hero, partner: G.lie || false, dom: o.canvas, pointerLock: !G.auto, groundHeight: (x, z) => groundY(x, z), view: G.Q.get('view') === '1' || G.Q.get('view') === 'fp' ? 'fp' : 'tp' }), null);   /* g7: third person by default (&view=1 for first person) */
      if (ctl) { G.mods.onfoot = 'ok';
        safe('snack floors', () => { const s = GT.snackstreet; if (s && s.floors && GT.onfoot.addFloor) { s.floors.forEach(f => GT.onfoot.addFloor(f)); (s.zones || []).forEach(z => GT.onfoot.addZone(z)); } });
        safe('hotpot.registerOnfoot', () => GT.hotpot && GT.hotpot.registerOnfoot && GT.hotpot.registerOnfoot()); safe('refreshColliders', () => GT.onfoot.refreshColliders && GT.onfoot.refreshColliders());
        ctl.on('enterCar', ev => { if (ev && !ev.twoWheeler) { const e = entOf(ev.vehicle); if (e) enterCarNow(e); } });
        ctl.on('exitCar', ev => { if (ev && !ev.twoWheeler && P.mode === 'exit') { const e = P.ent; P.mode = 'foot'; P.ent = null; emit('exitCar', { ent: e, kind: e && e.kind }); } });
        ctl.on('zone', ev => { P.indoor = !!(ctl.zone && ctl.zone.indoor); emit('zone', ev); }); ctl.on('interact', ev => { const v = ev && ev.spot && ev.spot.vehicle, e = v && entOf(v); if (e && (e.mode === 'traffic' || e.mode === 'cop')) { e.scare = 3.5; startJack(e); } emit('interact', ev); }); ctl.on('crash', ev => emit('crash', { v: .3, vn: (ev && ev.speed) || 3, two: true }));
        if (G.Q.get('hud') === '0') ctl.fpDot = false;
        ctl.rideAssist = false; ctl.teleport(rs.x, rs.z, rs.h); ctl.enabled = false;
        if (ctl.partner && G.lie) { const a = anchor('hotpotKitchen', { x: 44.3, z: 125.5, h: PI }); safe('partner.park', () => { ctl.partner.follow(false); ctl.partner.teleport(a.x, a.z, a.h || 0); }); } }
    }
    if (!G.ctl) G.mods.onfoot = 'missing';
    registerSpots(); roomInit(); peopleInit(); combatInit(); syncVehList(); aliveInit(); if (GT.shops && GT.shops.init) safe('shops.init', () => GT.shops.init(api)); if (GT.economy && GT.economy.init) safe('economy.init', () => GT.economy.init(api)); if (GT.street && GT.street.init) safe('street.init', () => GT.street.init(api));   // aliveInit: js/fxsmall.js + step / land forwarding
    if (GT.phone && GT.phone.init) safe('phone.init', () => GT.phone.init({ canvas: o.canvas, key: null, footKey: null }));
    refreshPlayer(0);
  }
  function bootPlan(o) {
    const Q = G.Q; let scene, camera;
    return [
      ['渲染器', () => { scene = G.scene = new T.Scene(); camera = G.camera = new T.PerspectiveCamera(58, innerWidth / innerHeight, .07, 3000); G.useFx = false;
        if (Q.get('fx') !== '0' && GT.render && GT.render.init) G.useFx = safe('render.init', () => { GT.render.init({ canvas: o.canvas, scene, camera }); return true; }, false);
        if (!G.useFx) { const r = G.renderer = new T.WebGLRenderer({ canvas: o.canvas, antialias: true }); r.setPixelRatio(min(1.5, devicePixelRatio || 1)); r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap; } }],
      ['天色', () => { G.atmosOn = false; if (GT.atmos && GT.atmos.init && Q.get('atmos') !== '0') G.atmosOn = safe('atmos.init', () => { GT.atmos.init({ scene, camera, renderer: G.renderer || (GT.render && GT.render.renderer) }); GT.atmos.timeScale = 0; GT.atmos.setTime(G.hours); return true; }, false);
        if (!G.atmosOn) { scene.background = new T.Color(0x9fb4c8); const sun = new T.DirectionalLight(0xffd2a0, 3); sun.position.set(-40, 18, 12); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 }); sun.shadow.bias = -.0005; scene.add(sun, new T.HemisphereLight(0xbcd0ff, 0x8a7a66, .9)); } }],
      ['大马路', () => { buildMod(scene, 'cnroad', fbWorld); buildPaths(); }],
      ['江滩与码头', () => buildMod(scene, 'riverside')],
      ['小吃街', () => buildMod(scene, 'snackstreet')],
      ['火锅店与筒子楼', () => buildMod(scene, 'hotpot')],
      ['钟楼与轻轨', () => { buildMod(scene, 'landmarks'); gridBuild(); if (GT.perf && GT.perf.chunkWorld) safe('perf.chunkWorld', () => GT.perf.chunkWorld(scene)); }],   // perf.js: cut the zone-sized merged meshes into cells so frustum culling works
      ['街坊邻居', () => { HUD.init(o.hud); if (Q.get('hud') === '0') o.hud.style.display = 'none'; castStep(o); for (const n of ['people', 'cnvehicles', 'cockpit', 'render', 'atmos', 'audio', 'combat', 'front']) if (!G.mods[n]) G.mods[n] = GT[n] ? 'ok' : 'missing'; }]
    ];
  }

  /* ================================================================== front end: studio logo → main menu over a live flyby → 开始游戏 / 继续 → loading art → free roam (g7: no story, no film, no wake-up) */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const F = (name, ...a) => { const f = GT.front; if (!f) return undefined; try { const p = name.split('.'); let fn = f, self = f; for (const k of p) { self = fn; fn = fn && fn[k]; } return typeof fn === 'function' ? fn.apply(self, a) : undefined; } catch (e) { warn('front.' + name, e); return undefined; } };
  const isCT = () => !!(GT.chinatown && GT.chinatown.active), CITY = () => isCT() ? '维尔蒙港' : '江城';
  const FLYBY = [
    { d: 14, fi: 1.2, f: [34, 34], sh: .5, p: [[-27, 5.2, -64], [-31, 6.4, -38]], l: [[-70, 6, 40], [-84, 9, 96]] },          // the river, the bridge, the far bank
    { d: 13, fi: 1.2, f: [36, 36], sh: .5, p: [[10.4, 7.5, 24], [10.4, 9.5, 42]], l: [[0, 0, 60], [-2, 0, 84]] },             // the avenue and the second crossing
    { d: 13, fi: 1.2, f: [38, 37], sh: .5, p: [[17.5, 2.1, -8.6], [24, 2.3, -8.2]], l: [[40, 2.4, -8], [46, 2.3, -8]] },      // into the snack street
    { d: 13, fi: 1.2, f: [36, 36], sh: .5, p: [[11.5, 4.6, 84], [12.5, 6.4, 96]], l: [[36, 6.5, 108], [31, 15, 142]] },       // the hotpot place, then up to the clock tower
    { d: 14, fi: 1.2, f: [34, 33], sh: .5, p: [[152, 3.2, -52], [150, 4.6, -40]], l: [[131, 17, -6], [131, 17, 0]] }          // the monorail through the building
  ];
  /* g7: the menu behind 玉埠 at the golden hour (held at 17:36). The low sun stands south, beyond the gate: the outside of the gate is lit, every move from inside looks back into the haze */
  const FLYBY_CT = [
    { d: 14, fi: 1.2, f: [36, 34], sh: .45, p: [[1.6, 1.9, -97], [.8, 2.6, -84]], l: [[0, 6.2, -40], [0, 6.4, -30]] },          /* low push towards the lit gate */
    { d: 13, fi: 1.2, f: [40, 39], sh: .45, p: [[-3.6, 7.9, -8], [-4.8, 7.2, -26]], l: [[2, 5.6, -60], [2.5, 5.8, -80]] },       /* among the lantern strings, the gate in the sun */
    { d: 13, fi: 1.2, f: [38, 37], sh: .45, p: [[-2.4, 2.4, 60], [-1.6, 2.9, 46]], l: [[2, 4, -6], [2, 4.2, -24]] },             /* the north end, low, into the haze */
    { d: 13, fi: 1.2, f: [40, 40], sh: .45, p: [[-.8, 2.8, -46], [-1.5, 2.2, -36]], l: [[0, 6.2, -80], [0, 6, -70]] },           /* the gate from inside, 天下为公 against the light */
    { d: 14, fi: 1.2, f: [38, 36], sh: .45, p: [[1.6, 5.2, 62], [1.9, 10.5, 57]], l: [[0, 4, 4], [0, 3.2, -14]] }                /* crane up over the whole street */
  ];
  const TIPS = ['按 M 打开大地图，点商店图标可以直接导航。', '任何车都能抢：站到车前让它停下，走到车门边按 F。', '警察记的是描述：脸、衣、车、牌。换掉对得上的那一项。', '离开视线五六秒，追捕就变成搜索。', '左键出拳。路人会逃跑、还手或者打电话举报。', '路人被打倒会掉钱，走过去就能捡。', '服装店换一身衣服，通缉描述里的「衣」就对不上了。', '五金店、枪店、服装店和车行都在大地图上。', '走到车旁按 F 上车。有司机的车也能抢，但会被通缉。', '按 Esc 暂停，可以调音量、灵敏度和画质。'];
  const CAPS_CT = [['城市', '维尔蒙港', '海风、霓虹，和永远堵在桥上的车。'], ['街区', '玉埠 · 灯笼街', '牌坊、茶楼、金铺，后巷里还有一家汽修。'], ['座驾', '满街都是', '路边停的车都能开走。有人看见就会报警。'], ['通缉', '警察', '星越多追得越紧。离开视线几秒，追捕就变成搜索。']];
  const CAPS_RIVER = [['城市', '江城', '一条江，一座桥，一条大马路。'], ['街区', '四方街', '大马路、江滩、小吃街、码头。'], ['座驾', '满街都是', '路边停的车都能开走。有人看见就会报警。'], ['通缉', '警察', '星越多追得越紧。离开视线几秒，追捕就变成搜索。']];
  const LOAD = { el: null, on: false, p: 0, i: 0, t: 0,
    show() { if (!G.visual) return; if (!this.el) { const el = this.el = document.createElement('div'); el.className = 'cn-load'; el.innerHTML = '<canvas width="1600" height="900"></canvas><div class="cl-shade"></div><div class="cl-top"><div class="cl-wm"><span>BILIBILI THEFT AUTO</span><b>1</b></div><em>B STAR</em></div><div class="cl-cap"><small></small><b></b><span></span></div><div class="cl-foot"><div class="cl-tip"><small>提示</small><span></span><em></em></div><div class="cl-bar"><i></i></div></div>'; document.body.appendChild(el); safe('poster', () => drawPoster(el.querySelector('canvas').getContext('2d'))); }
      this.on = true; this.i = 0; this.t = 0; this.cap(); this.progress(0, '正在搭建街区'); void this.el.offsetWidth; this.el.classList.add('on'); },
    cap() { const C = isCT() ? CAPS_CT : CAPS_RIVER, c = C[this.i % C.length], e = this.el.querySelector('.cl-cap'); e.classList.remove('go'); void e.offsetWidth; e.children[0].textContent = c[0]; e.children[1].textContent = c[1]; e.children[2].textContent = c[2]; e.classList.add('go'); this.el.querySelector('.cl-tip span').textContent = TIPS[(this.i * 3 + 1) % TIPS.length]; },
    progress(p, label) { if (!this.el) return; this.p = clamp(p, 0, 1); this.el.querySelector('.cl-bar i').style.transform = 'scaleX(' + this.p.toFixed(3) + ')'; if (label) this.label = label; this.el.querySelector('.cl-tip em').textContent = (this.label || '') + ' ' + Math.round(this.p * 100) + '%'; },
    tick(dt) { if (!this.on) return; this.t += dt; if (this.t > 4.2) { this.t = 0; this.i++; this.cap(); } },
    hide() { this.on = false; if (this.el) this.el.classList.remove('on'); } };
  /** loading art, painted with canvas 2D: dusk over the water, the towers of the city, the sun on the water */
  function drawPoster(g) {
    const W = 1600, H = 900, hz = 600; let gr = g.createLinearGradient(0, 0, 0, hz); gr.addColorStop(0, '#6a5acd'); gr.addColorStop(.45, '#e86aa6'); gr.addColorStop(.8, '#ff9a5a'); gr.addColorStop(1, '#ffd98a'); g.fillStyle = gr; g.fillRect(0, 0, W, hz);
    g.fillStyle = 'rgba(255,244,200,.9)'; g.beginPath(); g.arc(1080, hz - 30, 150, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.arc(1080, hz - 30, 260, 0, TAU); g.fill();
    const r = GT.rng('poster6'); for (let layer = 0; layer < 2; layer++) { g.fillStyle = layer ? '#5b3b8c' : '#b06ab8'; let x = -20; while (x < W) { const w = 40 + r() * 90, h = (layer ? 50 : 90) + r() * (layer ? 120 : 190); g.fillRect(x, hz - h, w, h + 2); x += w + r() * 14; } }
    gr = g.createLinearGradient(0, hz, 0, H); gr.addColorStop(0, '#ff9a6a'); gr.addColorStop(.2, '#7a4fa8'); gr.addColorStop(1, '#2a1a5e'); g.fillStyle = gr; g.fillRect(0, hz, W, H - hz);
    g.fillStyle = 'rgba(255,230,170,.7)'; for (let k = 0; k < 14; k++) { const y = hz + 10 + k * k * 1.4, w = 200 - k * 9 + r() * 40; g.fillRect(1080 - w / 2 + (r() - .5) * 30, y, w, 3 + k * .4); }
  }
  function startFlyby() { const h = isCT() ? 17.6 : 18.2; if (G.fixedHours === null) G.holdHours = h; G.hours = G.fixedHours !== null ? G.fixedHours : h; return cutscene((isCT() ? FLYBY_CT : FLYBY).map(s => Object.assign({}, s)), { menu: true, loop: true }); }
  function patchMenu() {       /* GT.front's menu copy is generic: put this world's name in the corner and the tag */
    const m = document.querySelector('#gtf .f-menu'); if (!m) return; const MAP = { 'B STAR': 'B STAR · 全部由代码生成' };
    const co = m.querySelector('.fm-corner'); if (co) co.innerHTML = isCT() ? '<b>维尔蒙港 · 玉埠</b><span>灯笼街 · 自由漫游</span>' : '<b>江城 · 四方街</b><span>自由漫游</span>';
    const tg = m.querySelector('.fm-tag'); if (tg) tg.textContent = CITY() + ' · 自由漫游';
    const d = m.querySelector('.fm-desc'); if (d && !d._cn) { d._cn = true; const fix = () => { const t = MAP[d.textContent]; if (t && t !== d.textContent) d.textContent = t; }; new MutationObserver(fix).observe(d, { childList: true, characterData: true, subtree: true }); fix(); }
    const pc = document.querySelector('#gtf .f-pause .fm-corner'); if (pc) pc.innerHTML = '<b>' + CITY() + ' · ' + zoneName(P.x, P.z) + '</b><span>' + clock(G.hours) + '</span>';
  }
  /** a saved session to continue: js/shops.js keeps the wallet, the wardrobe, the weapons and the owned vehicles under one key */
  const canContinue = () => !!(GT.shops && GT.shops.state && typeof GT.shops.state.cash === 'number');
  function showMenu() {
    G.phase = 'menu'; HUD.show(false); if (G.ctl) G.ctl.enabled = false; if (!DIR.cur) startFlyby();
    if (GT.front && GT.front.menu) { F('fade', 0, 1200); F('menu.show', { canContinue: canContinue(), onNew: () => startGame(true), onContinue: () => startGame(false), onQuit: onBack => quitCard(onBack) }); patchMenu(); }
    else { const el = document.createElement('div'); el.className = 'cn-title'; el.innerHTML = '<small>B STAR 出品</small><b>BILIBILI THEFT AUTO <i>1</i></b><span>按 Enter 开始游戏</span>'; document.body.appendChild(el); const go = e => { if (e.type === 'keydown' && e.code !== 'Enter' && e.code !== 'Space') return; removeEventListener('keydown', go); el.removeEventListener('mousedown', go); el.remove(); startGame(true); }; addEventListener('keydown', go); el.addEventListener('mousedown', go); }
  }
  /** 退出: a black card over the menu (a page cannot close itself). quitCard(onBack) -> { back() }: GT.front pushes a modal whose any-key calls back(); a click does too */
  function quitCard(onBack) { const old = document.getElementById('cn-quit'); if (old) old.remove(); const q = document.createElement('div'); q.id = 'cn-quit'; q.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#07060c;color:#efe9df;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.1em;font:600 22px "PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:.12em;opacity:0;transition:opacity .5s ease';
    q.innerHTML = '<b style="font-size:40px;letter-spacing:.3em">已退出</b><span style="opacity:.7">可以直接关闭这个页面</span><small style="opacity:.45;font-size:15px;margin-top:2.4em">按任意键回到主菜单</small>'; document.body.appendChild(q); void q.offsetWidth; q.style.opacity = '1'; if (AU.on && GT.audio && GT.audio.setMaster) safe('master', () => GT.audio.setMaster(0));
    const t0 = performance.now(); let gone = false; const back = () => { if (gone || performance.now() - t0 < 600) return; gone = true; removeEventListener('mousedown', click, true); q.style.opacity = '0'; setTimeout(() => q.remove(), 520); if (AU.on && GT.audio && GT.audio.setMaster) safe('master', () => GT.audio.setMaster(.8)); if (typeof onBack === 'function') safe('quit.back', onBack); }, click = e => { if (performance.now() - t0 < 600) return; e.stopImmediatePropagation(); e.preventDefault(); back(); };
    addEventListener('mousedown', click, true); return { back }; }
  /** a new game: the saved wardrobe / weapons / vehicles are wiped and the pocket holds $500 */
  function newGameState(keepShops) { if (!keepShops && GT.shops && GT.shops.reset) safe('shops.reset', () => GT.shops.reset()); const w = wallet(); w.add(START_CASH - w.cash, 'newgame'); clearWanted(true); G.hp = 100; if (GT.combat && G.combatOn && GT.combat.heal) safe('combat.heal', () => GT.combat.heal(999)); }
  /** 开始游戏 (fresh) / 继续: the loading art while the street is put in order, then straight into the street — on foot, the car at the kerb */
  async function startGame(fresh) {
    if (G.leaving) return; G.leaving = true; audioInit(); await (F('fade', 1, 650) || sleep(650)); await (F('menu.hide') || Promise.resolve()); LOAD.show(); F('fade', 0, 0); endCutscene();
    const sp = spawnPt(); G.holdHours = null; if (G.fixedHours === null) G.hours = isCT() ? 17.4 : 17.5;
    const jobs = [() => { if (fresh) newGameState(); }, () => { teleport(sp.x, sp.z, sp.h); placeMyCar(); syncVehList(); if (G.ctl) { G.ctl.enabled = false; if (G.ctl.setCameraYaw) G.ctl.setCameraYaw(sp.h); } }, () => G.atmosOn && GT.atmos.setTime(G.hours), () => gridBuild(), () => G.pop && G.pop.resnap && G.pop.resnap(), () => ckWarm()];
    for (let i = 0; i < jobs.length; i++) { LOAD.progress((i + .5) / (jobs.length + 2), '正在铺开街区'); await sleep(420); safe('load job', jobs[i]); }
    LOAD.progress(.9, '正在点亮路灯'); await sleep(1500); LOAD.progress(1, '好了'); await sleep(450); F('fade', 1, 0); LOAD.hide(); await sleep(350); G.leaving = false;
    beginPlay(); F('fade', 0, 1100);
  }
  /** hand control to the player: free roam (there is no story any more) */
  function beginPlay() {
    G.phase = 'play'; G.started = true; if (G.Q.get('hud') !== '0') HUD.show(true); audioInit();
    G.inputOff = false; if (G.ctl && P.mode !== 'car') G.ctl.enabled = true;   /* the menu parks the controller disabled */
    if (GT.input && GT.input.flush) GT.input.flush();   /* pt1: keys pressed at the gate, the logo and the menu (any key, K, Space …) must not fire on the first frame of play — a K there used to start a quick change into the plaid shirt */
    freeRoam(true);
  }
  /** GT.cngame.freeRoam() — no mission, no jobs: the city to wander */
  function freeRoam(intro) {
    G.story = false; G.phase = 'play'; G.started = true; JOBS.enabled = false; W.enabled = true; G.inputOff = false; if (G.ctl && P.mode !== 'car') G.ctl.enabled = true; if (G.Q.get('hud') !== '0') HUD.show(true); ui.mission('');
    if (intro && G.visual && !G.auto) { F('locationCard', zoneName(P.x, P.z), CITY() + ' · ' + clock(G.hours), 4); setTimeout(() => { F('hint', ['W', 'A', 'S', 'D'], '走动　F 上车　M 地图', 7); }, 4200); }
    emit('freeRoam', {}); return api;
  }
  /* ================================================================== g6: the big map (M) — north up, the whole district, every shop by category, click to set a waypoint (a normal marker: beam, minimap blip, route) */
  const BIG = { on: false, el: null, cv: null, g: null, k: 2.4, ox: 48, oz: 0, drag: null, moved: 0, wp: null, hover: null, pts: [],
    CATS: { gun: ['武器', '#ff5a4a', '枪'], wear: ['服装', '#5ab8ff', '衣'], food: ['食品', '#ffb23f', '食'], mod: ['修车改装', '#b78cff', '修'], car: ['车行', '#4fd08a', '车'], misc: ['当铺 · 配钥匙', '#e6c86a', '当'], home: ['安全屋', '#ffffff', '家'] },
    catOf(id) { return id === 'weapons' || id === 'tofu' ? 'gun' : id === 'dealer' ? 'car' : id === 'garage' ? 'mod' : 'wear'; },
    points() { const out = [], sh = GT.shops; if (sh && sh.sites) for (const q of sh.sites.concat((GT.chinatown && GT.chinatown.active && GT.chinatown.mapShops) || [])) { const gar = q.id === 'garage', px = gar && sh.pad ? sh.pad.x : q.x + sin(q.h || 0) * (q.stand || 1.4), pz = gar && sh.pad ? sh.pad.z : q.z + cos(q.h || 0) * (q.stand || 1.4); out.push({ cat: this.catOf(q.id), n: String(q.n).replace(/ · .*/, ''), x: q.x, z: q.z, gx: px, gz: pz }); }
      const an = (GT.world && GT.world.anchors) || {}; for (const id in STALLS) { const a = an['stall_' + id]; if (a) out.push({ cat: 'food', n: STALLS[id][0], x: a.x, z: a.z, gx: a.x, gz: a.z }); }
      for (const q of (GT.chinatown && GT.chinatown.active && GT.chinatown.extraShops) || []) out.push({ cat: 'misc', n: q.n, x: q.x, z: q.z, gx: q.x, gz: q.z });   /* ct2: pawn shop, key cutter */
      return out; },   /* g7: no home any more (the old 住处 pin was the courier's rented room) */
    init() { if (this.el) return; const el = this.el = document.createElement('div'); el.className = 'cn-bigmap'; el.innerHTML = '<canvas></canvas><div class="bm-head"><b>地图</b><small></small></div><div class="bm-legend"></div><div class="bm-tip"></div><div class="bm-keys"><span><kbd>滚轮</kbd>缩放</span><span><kbd>拖动</kbd>平移</span><span><kbd>左键</kbd>设导航点</span><span><kbd>右键</kbd>取消导航</span><span><kbd>M</kbd><kbd>Esc</kbd>关闭</span></div>'; document.body.appendChild(el);
      this.cv = el.firstChild; this.g = this.cv.getContext('2d'); el.querySelector('.bm-legend').innerHTML = Object.keys(this.CATS).filter(k => k !== 'home' && (k !== 'misc' || (GT.chinatown && GT.chinatown.active))).map(k => '<span><i style="background:' + this.CATS[k][1] + '">' + this.CATS[k][2] + '</i>' + this.CATS[k][0] + '</span>').join('') + '<span><i class="me"></i>你</span><span><i class="wp"></i>导航点 / 任务</span>';
      const cv = this.cv; cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, w0 = this.w2(mx, my), k1 = clamp(this.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 1.2, 14); this.k = k1; const w1 = this.w2(mx, my); this.ox += w0[0] - w1[0]; this.oz += w0[1] - w1[1]; this.draw(); }, { passive: false });
      cv.addEventListener('mousedown', e => { this.drag = [e.clientX, e.clientY, this.ox, this.oz, e.button]; this.moved = 0; });
      addEventListener('mousemove', e => { if (!this.on) return; const r = cv.getBoundingClientRect(); if (this.drag) { const dx = e.clientX - this.drag[0], dy = e.clientY - this.drag[1]; this.moved = max(this.moved, abs(dx) + abs(dy)); if (this.moved > 5) { this.ox = this.drag[2] + dx / this.k; this.oz = this.drag[3] + dy / this.k; } } this.hover = this.pick(e.clientX - r.left, e.clientY - r.top); cv.style.cursor = this.hover ? 'pointer' : this.drag && this.moved > 5 ? 'grabbing' : 'crosshair'; this.draw(); });
      addEventListener('mouseup', e => { if (!this.on || !this.drag) return; const d = this.drag; this.drag = null; if (this.moved > 5) return; const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; if (d[4] === 2) { this.clear(); this.draw(); return; } const h = this.pick(mx, my); if (h) this.setWp(h.gx, h.gz, h.n); else { const w = this.w2(mx, my); this.setWp(w[0], w[1], '导航点'); } this.draw(); });
      cv.addEventListener('contextmenu', e => e.preventDefault());
      addEventListener('keydown', e => { if (e.code === 'KeyM' && !e.repeat) { if (this.on) { e.stopImmediatePropagation(); this.close(); } else if (this.can()) { e.stopImmediatePropagation(); this.open(); } } else if (this.on) { e.stopImmediatePropagation(); e.preventDefault(); if (e.code === 'Escape') this.close(); } }, true);
      addEventListener('resize', () => { if (this.on) this.draw(); }); },
    can() { return G.phase === 'play' && G.visual && !G.paused && !G.cine && !HUD.failRes && !HUD.slipRes && !(GT.shops && GT.shops.isOpen) && !(GT.front && GT.front.busy && typeof GT.front.busy === 'function' && GT.front.busy()); },
    sx(x) { return this.cv.clientWidth / 2 - (x - this.ox) * this.k; }, sy(z) { return this.cv.clientHeight / 2 - (z - this.oz) * this.k; }, w2(mx, my) { return [this.ox - (mx - this.cv.clientWidth / 2) / this.k, this.oz - (my - this.cv.clientHeight / 2) / this.k]; },
    pick(mx, my) { let b = null, bd = 16; for (const q of this.pts) { const d = hyp(this.sx(q.x) - mx, this.sy(q.z) - my); if (d < bd) { bd = d; b = q; } } return b; },
    setWp(x, z, label) { this.clear(); this.wp = marker(x, z, label, { color: '#ffd23f', r: 4 }); if (this.wp) this.wp.user = true; if (GT.audio && GT.audio.sfx) safe('sfx', () => GT.audio.sfx('ui_ok')); HUD.toast('导航点 · ' + label, '跟着小地图上的黄线走'); },
    clear() { if (this.wp) { this.wp.remove(); this.wp = null; } },
    open() { this.init(); this.pts = this.points(); this.on = true; G.paused = true; this.ox = clamp(P.x, -20, 260); this.oz = clamp(P.z, -200, 200); this.k = clamp(min(innerWidth / 330, innerHeight / 210), 2.2, 5); if (document.exitPointerLock) safe('unlock', () => document.exitPointerLock()); this.el.classList.add('on'); document.body.classList.add('cn-mapopen'); this.draw(); emit('bigmap', { open: true }); },
    close() { if (!this.on) return; this.on = false; this.drag = null; this.el.classList.remove('on'); document.body.classList.remove('cn-mapopen'); G.paused = false; const c = G.renderer && G.renderer.domElement || document.getElementById('c'); if (c && c.requestPointerLock && !G.auto) safe('lock', () => { const p = c.requestPointerLock(); if (p && p.catch) p.catch(() => {}); }); emit('bigmap', { open: false }); },
    step() { if (this.wp && hyp(P.x - this.wp.x, P.z - this.wp.z) < 5) { this.clear(); if (G.visual) HUD.toast('已到达导航点', ''); } },
    draw() { const cv = this.cv, g = this.g, dpr = min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight; if (cv.width !== (W * dpr | 0) || cv.height !== (H * dpr | 0)) { cv.width = W * dpr | 0; cv.height = H * dpr | 0; } g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#12161a'; g.fillRect(0, 0, W, H);
      const X = x => this.sx(x), Y = z => this.sy(z), k = this.k, rect = (x0, z0, x1, z1, fill) => { g.fillStyle = fill; g.fillRect(min(X(x0), X(x1)), min(Y(z0), Y(z1)), abs(X(x1) - X(x0)), abs(Y(z1) - Y(z0))); };
      const CTW = !!(GT.chinatown && GT.chinatown.active && GT.chinatown.mapBase); if (CTW) GT.chinatown.mapBase(rect, 'big', k); else {   /* ct2: ?world=ct draws its own streets, blocks and water */
      rect(-400, -400, -60, 400, '#1f4a5e'); rect(-58, -200, -10, 200, '#30352f'); rect(14, -152.5, 143, 152.5, '#23272a');
      for (const [kk, col] of [['snack', '#5a4a34'], ['market', '#4d3a4c'], ['hotpot', '#5e3530'], ['courtyard', '#3d4438'], ['tenement', '#484a4e'], ['clock', '#55524a'], ['wharf', '#3b4650']]) { const r = CN[kk]; if (r) rect(r.x0, r.z0, r.x1, r.z1, col); } }
      if (!CTW && CN.rail) { const rb = CN.rail.building; rect(rb.x0, rb.z0, rb.x1, rb.z1, '#4a4f58'); rect(CN.rail.x - 1.6, CN.rail.z0, CN.rail.x + 1.6, CN.rail.z1, 'rgba(160,170,190,.35)'); }
      const bx = (GT.world && GT.world.boxes) || []; g.fillStyle = 'rgba(255,255,255,.07)'; if (k > 2) for (const b of bx) { if (!(b.h > 2.5) || b.x1 - b.x0 > 60 || b.z1 - b.z0 > 60) continue; g.fillRect(min(X(b.x0), X(b.x1)), min(Y(b.z0), Y(b.z1)), abs(X(b.x1) - X(b.x0)), abs(Y(b.z1) - Y(b.z0))); }
      if (!CTW) { const road = '#7a7f87'; rect(-7.5, -190, 7.5, 190, road); rect(-7.5, -164.5, 157, -155.5, road); rect(-7.5, 155.5, 157, 164.5, road); rect(145.5, -164.5, 154.5, 164.5, road); rect(-.25, -150, .25, 150, '#b9b5a5'); }
      for (const zc of (GT.cnroad && GT.cnroad.layout && GT.cnroad.layout.crossings) || FBSIG.crossings) rect(-7.5, zc - 2.2, 7.5, zc + 2.2, 'rgba(235,235,225,.5)');
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 ' + clamp(k * 5.5, 13, 26) + 'px "PingFang SC","Hiragino Sans GB",sans-serif'; g.fillStyle = 'rgba(255,255,255,.34)';
      for (const [x, z, t] of (GT.chinatown && GT.chinatown.active ? GT.chinatown.mapLabels : [[32, -8, '小吃街'], [57, -62, '夜市'], [36, 114, '火锅'], [47, 76, '院'], [30, 145, '钟楼'], [131, 0, '轻轨'], [-36, -152, '码头'], [-34, 30, '江滩'], [-150, 0, '江']])) g.fillText(t, X(x), Y(z));
      g.font = '600 12px "PingFang SC",sans-serif'; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText(CTW ? (GT.chinatown.mainStreet || '灯笼街 Lantern St') : '大马路', X(0) , Y(175));
      if (ROUTE.pts.length > 1) { g.beginPath(); ROUTE.pts.forEach((q, i) => { if (i) g.lineTo(X(q[0]), Y(q[1])); else g.moveTo(X(q[0]), Y(q[1])); }); g.lineJoin = g.lineCap = 'round'; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 8; g.stroke(); g.strokeStyle = '#ffd23f'; g.lineWidth = 4.5; g.stroke(); }
      for (const q of this.pts) { const c = this.CATS[q.cat], x = X(q.x), y = Y(q.z), hv = this.hover === q, r = hv ? 15 : 12; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = c[1]; g.fill(); g.lineWidth = 2.5; g.strokeStyle = hv ? '#fff' : 'rgba(0,0,0,.75)'; g.stroke(); g.fillStyle = '#0d0f12'; g.font = '800 ' + (hv ? 15 : 13) + 'px "PingFang SC",sans-serif'; g.fillText(c[2], x, y + 1); }
      for (const m of MARKS) { if (m.kind === 'enemy') continue; const x = X(m.x), y = Y(m.z); g.save(); g.translate(x, y); g.rotate(PI / 4); g.fillStyle = '#ffd23f'; g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 2.5; g.fillRect(-8, -8, 16, 16); g.strokeRect(-8, -8, 16, 16); g.restore(); g.font = '700 13px "PingFang SC",sans-serif'; g.fillStyle = '#ffd23f'; g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = 3; g.strokeText(m.label || '', x, y - 20); g.fillText(m.label || '', x, y - 20); }
      { const yaw = P.mode === 'foot' || P.mode === 'two' ? ((G.ctl && G.ctl.camera && G.ctl.camera.yaw) || P.h) : P.h; g.save(); g.translate(X(P.x), Y(P.z)); g.rotate(yaw); g.beginPath(); g.moveTo(0, -13); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2.5; g.fill(); g.stroke(); g.restore(); }
      { g.save(); g.translate(W - 46, 60); g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '800 14px sans-serif'; g.fillText('N', 0, -22); g.beginPath(); g.moveTo(0, -12); g.lineTo(7, 8); g.lineTo(0, 3); g.lineTo(-7, 8); g.closePath(); g.fill(); g.restore(); }
      const tip = this.el.querySelector('.bm-tip'); tip.textContent = this.hover ? this.CATS[this.hover.cat][0] + ' · ' + this.hover.n + ' — 点击导航到门口' : ''; tip.classList.toggle('on', !!this.hover); this.el.querySelector('.bm-head small').textContent = zoneName(P.x, P.z) + (this.wp ? ' · 导航中：' + this.wp.label : ''); } };
  const DAY_PARTS = [
    { name: '早上', start: 5, hour: 7 }, { name: '中午', start: 11, hour: 12 },
    { name: '傍晚', start: 16, hour: 18.5 }, { name: '晚上', start: 20, hour: 22 }
  ];
  function dayPartIndex() {
    for (let i = DAY_PARTS.length - 1; i >= 0; i--) if (G.hours >= DAY_PARTS[i].start) return i;
    return DAY_PARTS.length - 1;
  }
  function cycleDayPart() {
    const part = DAY_PARTS[(dayPartIndex() + 1) % DAY_PARTS.length];
    G.fixedHours = null;  // A manual choice takes over from the free-roam preset.
    setHours(part.hour);
    if (G.paused) patchMenu();
    else HUD.toast(part.name, clock(part.hour));
    return part.name;
  }
  function setPause(p) {
    if (G.phase !== 'play' || HUD.failRes || G.paused === !!p) return; G.paused = !!p;
    if (p) { if (document.exitPointerLock) safe('unlock', () => document.exitPointerLock()); if (GT.front && GT.front.pause) { F('pause.show', { dayPart: DAY_PARTS[dayPartIndex()].name, onDayPart: cycleDayPart, onMap: () => { setPause(false); setTimeout(() => BIG.open(), 320); }, onResume: () => setPause(false), onRestart: () => { G.paused = false; respawnHome(); }, onMenu: () => { G.paused = false; toMenu(); } }); patchMenu(); } else HUD.toast('暂停', 'Esc 继续'); }
    else if (GT.front && GT.front.pause) F('pause.hide');
    if (AU.on && GT.audio.setMaster) safe('master', () => GT.audio.setMaster(p ? .15 : .8));
  }
  function toMenu() { failJob(''); clearWanted(true); if (P.mode !== 'foot') { const sp = spawnPt(); teleport(sp.x, sp.z, sp.h); } G.story = false; F('clearSubtitles'); showMenu(); }

  /* ================================================================== main loop */
  const _focus = new T.Vector3(), WORLD_UPD = ['cnroad', 'riverside', 'hotpot', 'landmarks'];
  function tick(dt) {
    const play = G.phase === 'play' && !G.paused && !G.freeze;
    // real-time even at low frame rates: a long frame is simulated as up to four sub-steps of at most 1/30 s (was one clamped step = slow motion)
    const sub = play ? clamp(Math.ceil(dt * 30 - 1e-6), 1, 4) : 1, sdt = min(dt / sub, 1 / 30);
    const ts = (G.trailer && G.trailer.ts ? G.trailer.ts : 1) * (G.slowmo > 0 && G.slowmo < 1 ? G.slowmo : 1);       // QA: G.slowmo = a death / an arrest. The trailer's slow-motion hit: only the simulation slows down, the director's clock does not
    let pausePressed = false;
    if (play) { for (let i = 0; i < sub; i++) { step(sdt * ts); pausePressed ||= PR('Escape'); } } else { if (G.phase === 'menu' || G.phase === 'load') { trafficStep(dt); const S = SIG(); if (S.update) safe('sig', () => S.update(dt)); G.time += dt; refreshPlayer(0); } LOAD.tick(dt); }
    if (G.demo && G.demo.pre) safe('demo.pre', () => G.demo.pre(dt));   /* js/demo.js (the opening film): stages its shot and hands the director this frame's lens */
    if (!dirTick(play || G.phase === 'menu' ? dt : 0) && P.mode === 'car' && G.visual && !(G.cine && G.cine.tk)) carCamera(play ? dt : 0);
    if (G.combatOn && !G.bad.combatU && GT.combat.driveBy) { const e = P.ent; if ((P.mode === 'car' || P.mode === 'two') && e && e.veh && G.visual && play && !G.cine && !G.inputOff) safe('combat.driveBy', () => GT.combat.driveBy(dt, { ent: e, camera: G.camera, input: GT.input, fp: P.mode === 'car' ? CAM.mode === 'fp' : !!(G.ctl && G.ctl.view === 'fp'), eye: G.cockpit && G.cockpit.group.parent === e.veh.group && G.eyeLocal ? G.eyeLocal : eyeOf(e.dims, e), seat: G.kaiSeatOn === e ? G.kaiSeat : null })); else if (GT.combat.dbOn) safe('combat.driveBy', () => GT.combat.driveBy(0, {})); }   /* QA: GTA-style shooting from the driver's seat (js/combat.js driveBy) */
    const edt = play || G.phase === 'menu' ? dt : 0, vdt = G.paused && !G.freeze ? 0 : dt;
    if (play && NPCS.length) for (let i = 0; i < sub; i++) npcStep(sdt * ts);
    for (const e of G.ents) { if (e.veh.group) { const far = hyp(e.x - G.camera.position.x, e.z - G.camera.position.z) > (e.tfFar || 190); if (e.veh.group.visible === far && !P.inside) e.veh.group.visible = !far; if (!far && !e.tfLite) syncEnt(e, edt); } }   /* e.tfLite: js/traffic.js places the 80–140 m cars itself, no wheels or lamps; e.tfFar: its draw distance for them (shorter at the wheel) */
    if (G.atmosOn) { const A = GT.atmos; if (abs(G.hours - A.hours) > .003) safe('atmos.setTime', () => A.setTime(G.hours)); try { A.update(dt, _focus.set(G.cine && !G.cine.tk ? G.camera.position.x : P.x, 0, G.cine && !G.cine.tk ? G.camera.position.z : P.z)); } catch (e) { if (!G.bad.atmosU) { G.bad.atmosU = 1; warn('atmos.update', e); } } }
    for (const n of WORLD_UPD) { const m = GT[n]; if (m && m.update && G.mods[n] === 'ok' && !G.bad[n + 'U']) { try { m.update(vdt); } catch (e) { G.bad[n + 'U'] = 1; warn(n + '.update', e); } } }
    if (GT.snackstreet && GT.snackstreet.update && G.mods.snackstreet === 'ok' && !G.bad.snackU) { try { GT.snackstreet.update(vdt, G.camera); } catch (e) { G.bad.snackU = 1; warn('snackstreet.update', e); } }
    if (G.pop) { if (G.phase === 'menu') { const c = G.camera.position; safe('pop.update', () => G.pop.update(dt, { x: c.x, z: c.z, y: 0, h: 0, speed: 0, vehicle: null }, PEV)); PEV.length = 0; } else if (play || (G.freeze && G.phase === 'play')) peopleStep(dt); }
    if (G.phase === 'play') PHONE.update(play ? dt : 0); if (play && !G.ap.on && pausePressed) { IN.pr.Escape = false; setPause(true); }
    audioStep(dt); aliveStep(dt, play); if (G.phase === 'play') HUD.update(play ? dt : 0);
    if (GT.phone && GT.phone.update && !G.bad.phoneU) { try { GT.phone.update(dt, { pos: { x: P.x, z: P.z }, h: P.h, mode: P.mode === 'car' ? 'car' : 'foot', speed: P.speed }); } catch (e) { G.bad.phoneU = 1; } }
    if (GT.perf && GT.perf.update && !G.bad.perfU) { try { GT.perf.update(dt, G.camera, G.scene); } catch (e) { G.bad.perfU = 1; warn('perf.update', e); } }   // point-light budget + ?fps=1 readout (F3)
    if (G.demo && G.demo.post) safe('demo.post', () => G.demo.post(dt));   /* js/demo.js: roll, exposure, lens flare, last placement before the frame is drawn */
    if (G.useFx) GT.render.frame(G.scene, G.camera, dt);
    else { const r = G.renderer, w = innerWidth, h = innerHeight; const ratio = GT.render?.nativePixelRatio?.(w, h) ?? min(1.5, devicePixelRatio || 1); if (G.rw !== w || G.rh !== h || r.getPixelRatio() !== ratio) { G.rw = w; G.rh = h; if (r.getPixelRatio() !== ratio) r.setPixelRatio(ratio); r.setSize(w, h, false); G.camera.aspect = w / h; G.camera.updateProjectionMatrix(); } r.render(G.scene, G.camera); }
  }
  function startLoop() {
    if (G.looping) return; G.looping = true; let last = performance.now(), frames = 0, shown = 0; const dbg = G.auto || G.Q.get('debug');
    addEventListener('keydown', e => { if (e.code === 'Escape' && G.paused && !(GT.front && GT.front.pause)) setPause(false); }); if (G.visual) safe('bigmap.init', () => BIG.init());
    addEventListener('keydown', e => {
      if (e.code !== 'KeyU' || e.repeat || e.altKey || e.ctrlKey || e.metaKey || G.inputOff || BIG.on || !BIG.can() || document.querySelector('.cn-phone.on') || e.target?.matches?.('input, textarea, [contenteditable="true"]')) return;
      cycleDayPart();
    });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && G.phase === 'play' && !G.paused && !G.auto && G.started && !GT.shops?.isOpen && !HUD.slipRes && !G.cine && performance.now() - (G.lockT || 0) > 1500) setPause(true); else if (document.pointerLockElement) G.lockT = performance.now(); });
    (function loop(now) { const dt = clamp((now - last) / 1000, .001, .1333); last = now;
      try { tick(dt); } catch (e) { if (frames < 4 || !G.tickErr) { G.tickErr = true; fail('frame threw: ' + (e.stack || e)); } }
      if (dbg && G.warnings.length > shown) { fail('[cngame] ' + G.warnings.slice(shown).join('\n[cngame] ')); shown = G.warnings.length; }
      if (++frames === 12) document.title = 'BILIBILI THEFT AUTO 1'; requestAnimationFrame(loop); })(last);
  }

  /* ================================================================== ?auto= states: place, fast-forward the real simulation, hold */
  function ff(sec) { const was = G.silent; G.silent = true; const n = Math.round(sec * 60); for (let i = 0; i < n; i++) step(1 / 60); G.silent = was; }
  function apOn(pathName, speed, at) { const A = G.ap, e = P.ent, path = PATHS[pathName]; A.on = true; A.path = path; A.speed = speed; A.s = pathNearest(path, e.x, e.z); A.runRed = false; return A; }
  function jump(a) {
    const Q = G.Q, num = (k, d) => (Q.get(k) !== null && isFinite(+Q.get(k)) ? +Q.get(k) : d), at = num('at', -1), ctl = G.ctl;
    G.phase = 'play'; G.started = true; if (HUD.root) HUD.root.classList.add('now'); document.body.classList.add('cn-still'); if (Q.get('hud') !== '0' && a !== 'menu' && a !== 'load') HUD.show(true); if (ctl) ctl.enabled = a !== 'menu' && a !== 'load'; JOBS.nextT = 1e9;   /* g7: no delivery offers under any ?auto= */
    const hrs = h => { if (G.fixedHours === null) { G.holdHours = h; G.hours = h; } }, yaw = () => { if (ctl && Q.get('yaw') !== null) { ctl.camera.yaw = num('yaw', 0) * PI / 180; if (Q.get('pitch') !== null) ctl.camera.pitch = num('pitch', 8) * PI / 180; } };
    const testSc = () => G.scooter || (G.scooter = mkEnt('escooter', { x: CN.riderStart.x, z: CN.riderStart.z, h: 0, color: 0x3a3f46 }));   /* g7: ?auto=ride / fall / wanted borrow a street scooter (the hero has none of his own) */
    const rideAt = (ent, x, z, h, path, speed, sec) => { ent.x = x; ent.z = z; ent.h = h; ent.y = groundY(x, z, 0); mountNow(ent); apOn(path, speed); ff(sec); };
    const INDOOR = { noodle: ['noodleInside', 51.3, -8, PI / 2], hotpot: ['hotpotInside', 36, 104.4, 0], lobby: ['clockLobby', 30, 143, 0], warehouse: ['wharfInside', -39, -139.5, PI], market: ['marketGate', 18, -59.6, PI / 2] };
    switch (a) {
      case 'menu': G.phase = 'menu'; G.started = false; showMenu(); if (at > 0 && DIR.cur) { shotPose(DIR.cur, at); } if (GT.front && GT.front._seek) F('_seek', num('seek', 3)); return;
      case 'trailer': if (GT.demo && GT.demo.auto && GT.demo.auto(api, at)) return; break;   /* js/demo.js: ?auto=trailer plays the opening film, &at=<s> freezes on that second */
      case 'load': G.phase = 'load'; HUD.show(false); LOAD.show(); LOAD.el.classList.add('now'); LOAD.progress(num('p', .62), '正在铺开街区'); LOAD.i = num('panel', 0) | 0; LOAD.cap(); return;
      case 'cross': hrs(7.5); teleport(num('px', 10.1), num('pz', -8), num('ph', -90) * PI / 180); ff(at > 0 ? at : 6); break;
      case 'ride': if (GT.chinatown && GT.chinatown.active) { hrs(num('t', 17.8)); rideAt(testSc(), -3.75, num('pz', -52), 0, 'bikeA', 8, at > 0 ? at : 3); break; } hrs(18.2); rideAt(testSc(), 6.85, num('pz', 52), PI, 'bikeB', 10.5, at > 0 ? at : 5); break;
      case 'fall': { hrs(18.2); rideAt(testSc(), 6.85, num('pz', 52), PI, 'bikeB', 10.5, 3); G.ap.on = false; const e = G.scooter; knockDown(sin(e.h) * e.v, cos(e.h) * e.v, 22, 'crash', null); ff(at > 0 ? at : .7); break; }
      case 'bike': { hrs(7.5); const b = G.ents.find(e => e.kind === 'sharebike'); b.locked = false; b.veh.locked = false; rideAt(b, -6.85, num('pz', -30), 0, 'bikeA', 5.4, at > 0 ? at : 5); break; }
      case 'car': case 'carchase': { hrs(a === 'car' ? 18.2 : 19.2); const c = mkEnt(a === 'car' ? 'taxi' : 'sports', { x: 2, z: num('pz', 46), h: PI, mode: 'parked' }); enterCarNow(c); CAM.mode = a === 'car' ? 'fp' : 'chase'; apOn('loopB', a === 'car' ? 11 : 15); ff(at > 0 ? at : 5); break; }
      case 'wanted': { hrs(19.4); const s = testSc(); s.x = 6.85; s.z = num('pz', 40); s.h = PI; mountNow(s); apOn('bikeB', 11.5); G.ap.runRed = true; ff(1); violation('redlight'); violation('wrongway'); W.stars = 3; W.hot = true; W.lastSeenT = G.time; fileChip('car'); fileChip('plate'); fileChip('cloth');
        const c1 = spawnCop('moto', 6.2, s.z + 16, PI, 'pursue'), c2 = spawnCop('police', 2.2, s.z + 27, PI, 'pursue'); c1.v = c2.v = 9; ff(at > 0 ? at : 4); break; }
      case 'busted': hrs(19.4); teleport(9.6, 30, PI); violation('redlight'); violation('wrongway'); G.time += 4; violation('speeding'); W.stars = 2.4; busted(); break;
      case 'shop': hrs(num('t', 14)); teleport(26, 58, 0); ff(.3); if (GT.shops && GT.shops.auto) safe('shops.auto', () => GT.shops.auto(Q.get('shop'), Q)); break;   /* js/shops.js: ?auto=shop&shop=weapons|tofu|clothes|stall|outlet|tailor|dealer|garage [&cash=][&trust=][&veh=][&part=|&tab=][&sel=][&buy=1][&open=0][&resetshop=1] */
      case 'room': hrs(7.5); if (GT.hotpot && GT.hotpot.enter) safe('hotpot.enter', () => GT.hotpot.enter(ctl, { instant: true })); ff(at > 0 ? at : .5); break;
      case 'noodle': case 'hotpot': case 'lobby': case 'warehouse': case 'market': { const d = INDOOR[a], an = anchor(d[0], { x: d[1], z: d[2] }); hrs(a === 'market' || a === 'warehouse' ? 21 : a === 'hotpot' ? 19.3 : 12); teleport(num('px', an.x), num('pz', an.z), num('ph', d[3] * 180 / PI) * PI / 180); ff(at > 0 ? at : .6); break; }
      default: { const sp = spawnPt(); hrs(num('t', 7.5)); teleport(num('px', sp.x), num('pz', sp.z), num('ph', sp.h * 180 / PI) * PI / 180); } ff(at > 0 ? at : .5); if (a !== 'foot') G.auto = 'foot';
    }
    yaw();
    /* first-person stills: &weapon=<fists|helmet|pipe|bat|crowbar|pistol|revolver|shotgun|smg> draws it (&aim=1 holds the right button, &swing=<seconds into a swing / after a shot>, &reload=1), &view=3 = third person */
    if (Q.get('weapon') && G.combatOn && P.mode === 'foot') safe('auto weapon', () => { const C = GT.combat, id = Q.get('weapon'), down = Q.get('aim') === '1' ? ['Mouse1'] : []; if (id !== 'fists') { C.give(id, 60); C.equip(id); } ff(.1); yaw(); GT.input.feed({ down }); ff(1);
      if (Q.get('reload') === '1') { GT.input.feed({ down, press: ['Mouse0'] }); ff(.05); GT.input.feed({ down, press: ['KeyR'] }); ff(num('swing', .5)); } else if (Q.get('swing') !== null) { GT.input.feed({ down, press: ['Mouse0'] }); ff(.034); GT.input.feed({ down }); ff(num('swing', .15)); } });
    if (Q.get('lean') && P.mode === 'two' && P.ent) { P.ent.lean = num('lean', 0); syncEnt(P.ent, 0); }       // &lean=<rad>: a still of the bike heeled over
    if (Q.get('freeze') !== '0' && a !== 'room') G.freeze = true;
    if (G.freeze && G.ctl) { /* one zero-length update so the camera, hero pose and prompts are laid out for the still */ safe('ctl.update', () => G.ctl.update(0)); if (P.mode === 'car') carCamera(0); }
  }

  /* ================================================================== boot */
  function boot(o) {
    o = o || {}; const Q = G.Q = o.query || new URLSearchParams(location.search);
    G.canvas = o.canvas; G.hudRoot = o.hud; G.auto = Q.get('auto'); G.fixedHours = Q.get('t') !== null && isFinite(+Q.get('t')) ? +Q.get('t') : null; if (G.fixedHours !== null) G.hours = G.fixedHours;
    if (Q.get('selftest') === '1') return selftest();
    /* alive layer: ?audiotest=1 renders every sound + three scenes offline and prints levels (GT.audio.selftest); &from=&to= page through the table, &only=<substring> */
    if (Q.get('audiotest') === '1') { const bt = document.getElementById('boot'); if (bt) bt.style.display = 'none'; if (GT.audio && GT.audio.selftest) GT.audio.selftest({ print: true, only: Q.get('only2') || '', from: +Q.get('from') || 0, to: +Q.get('to') || 0, font: +Q.get('font') || 11 }).catch(e => fail('audiotest: ' + (e.stack || e))); else fail('GT.audio.selftest missing'); return api; }
    const steps = bootPlan(o), run = s => { try { s[1](); } catch (e) { warn('boot step ' + s[0], e); fail('boot step "' + s[0] + '" threw: ' + (e.stack || e)); } };
    if (G.auto) { for (const s of steps) run(s); safe('front.init', () => GT.front && GT.front.init && GT.front.init()); try { jump(G.auto); } catch (e) { fail('auto=' + G.auto + ' threw: ' + (e.stack || e)); } if (Q.get('audiolog')) safe('aliveLog', () => aliveLog(Q.get('audiolog'))); else if (Q.get('fxrun')) safe('aliveStill', aliveStill); startLoop(); return api; }
    bootAsync(steps, run); return api;
  }
  async function bootAsync(steps, run) {
    let splash = window.GTsplash || null, logoDone = false; if (!splash && GT.front && GT.front.splash) { safe('front.init', () => GT.front.init()); splash = F('splash'); }
    if (splash && splash.then) splash.then(() => { logoDone = true; }, () => { logoDone = true; }); else logoDone = true;
    const bt = document.getElementById('boot'); if (bt && splash) bt.style.display = 'none'; const line = document.createElement('div'); line.className = 'cn-bootline'; line.innerHTML = '<i></i><span></span>'; document.body.appendChild(line);
    const DIST = (GT.coast && GT.coast.active) ? '月湾' : (GT.chinatown && GT.chinatown.active) ? '玉埠' : '维尔蒙港', lbl = p => '正在加载 · ' + DIST + '  ' + Math.round(p * 100) + '%';   /* pt1: one neutral label, on the bottom line only (the step names — 街坊邻居, 小吃街 … — were build-step names, not places) */
    const prog = (p, t) => { line.firstChild.style.transform = 'scaleX(' + p.toFixed(3) + ')'; line.lastChild.textContent = p < 1 ? lbl(p) : ''; const f = document.getElementById('boot-fill'), m = document.getElementById('boot-msg'); if (splash && splash.progress) splash.progress(p); if (f) f.style.width = Math.round(p * 100) + '%'; if (m) m.textContent = lbl(p); };
    F('fade', 1, 0); await sleep(splash ? 700 : 30);
    for (let i = 0; i < steps.length; i++) { prog((i + .3) / (steps.length + 1), steps[i][0]); await sleep(34); run(steps[i]); }       // a timer, not rAF: the tab may be in the background while it loads
    prog(.96, '点灯'); G.phase = 'menu'; startFlyby(); startLoop();                    // the first frames compile every shader, still behind the logo
    const DEMO = GT.demo && G.Q.get('demo') !== '0' ? GT.demo : null; if (DEMO && DEMO.prepare) safe('demo.prepare', () => DEMO.prepare(api, { warm: true }));   /* js/demo.js: builds the film's cast and warms every shot behind the gate */
    await sleep(400);
    prog(1, ''); if (bt) bt.classList.add('gone');
    if (splash && splash.ready) splash.ready(); line.classList.add('gone'); while (!logoDone) await sleep(100);       // the logo waits for a click (sound needs a gesture) and then plays over a finished, idle block
    line.classList.add('gone'); if (bt) bt.style.display = 'none';
    if (DEMO && DEMO.play) await safe('demo.play', () => DEMO.play(api), null);   /* gate → logo → the opening film (js/demo.js, any key skips) → menu */
    showMenu();   /* g7: logo → menu (the opening trailer is gone) */
    if (G.warnings.length && G.Q.get('debug')) fail('[cngame] ' + G.warnings.join('\n[cngame] '));
  }

  /* ================================================================== story-facing helpers */
  const NPCS = [];
  /** spawnNPC(kind, x, z, {h, state, hostile, weapon, seed}) -> {group, fig, x, z, h, state, goTo(pts, speed, then), say(text, sec), remove()}
      kind: any GT.people type ('auntie', 'tourist_cn', 'thug'…) or a named one ('lajie', 'guaizi', 'yeshu', 'mange', 'ertong'; these are moved, not duplicated, when the street cast is live).
      hostile: true routes 'thug' | 'gunman' | 'heavy' | 'cop' through GT.combat.spawn. */
  function spawnNPC(kind, x, z, o) {
    o = o || {};
    if (o.hostile && GT.combat && G.combatOn && GT.combat.spawn) return safe('combat.spawn', () => GT.combat.spawn(kind, x, z, o), null);
    const named = GT.people && GT.people.cnNamed && (Array.isArray(GT.people.cnNamed) ? GT.people.cnNamed.indexOf(kind) >= 0 : kind in GT.people.cnNamed);
    if (named && G.pop && G.pop.place) { const rec = safe('pop.place', () => { G.pop.place(kind, { x, z, h: o.h || 0, state: o.state || 'idle' }); return (G.pop.named && G.pop.named[kind]) || G.pop.find(kind); }, null); if (rec) { rec.remove = rec.remove || (() => safe('pop.release', () => G.pop.release(kind))); rec.say = rec.say || ((t, s) => say((GT.people.namesCN && GT.people.namesCN[kind]) || '', t, s)); return rec; } }
    let fig = null; if (G.visual) { if (GT.people && GT.people.make && !G.bad.people) fig = safe('people.make(' + kind + ')', () => GT.people.make(kind, { seed: o.seed === undefined ? NPCS.length * 5 + 2 : o.seed, kit: o.kit, phone: o.phone }), null); if (!fig || !fig.group) fig = fbPerson(0x6a7078); G.scene.add(fig.group); }
    const n = { kind, fig, group: fig && fig.group, x, z, y: groundY(x, z, 0), h: o.h || 0, state: o.state || 'idle', idle: o.state || 'idle', speed: 0, wp: null, then: null, spd: 1.3, alive: true,
      goTo(pts, spd, then) { n.wp = (Array.isArray(pts[0]) ? pts : [pts]).map(p => Array.isArray(p) ? { x: p[0], z: p[1] } : p); n.spd = spd || 1.3; n.then = then || null; return n; },
      say(text, sec) { say(o.name || '', text, sec); return n; }, remove() { n.alive = false; const i = NPCS.indexOf(n); if (i >= 0) NPCS.splice(i, 1); if (n.group && n.group.parent) n.group.parent.remove(n.group); } };
    NPCS.push(n); return n;
  }
  function npcStep(dt) {
    for (const n of NPCS) { if (n.wp && n.wp.length) { const w = n.wp[0], dx = w.x - n.x, dz = w.z - n.z, d = hyp(dx, dz), st = n.spd * dt; if (d <= st + .02) { n.x = w.x; n.z = w.z; n.wp.shift(); if (!n.wp.length) { n.wp = null; n.speed = 0; n.state = n.idle; const f = n.then; n.then = null; if (f) safe('npc.then', () => f(n)); } } else { n.x += dx / d * st; n.z += dz / d * st; n.h += angDiff(n.h, Math.atan2(dx, dz)) * min(1, dt * 10); n.speed = n.spd; n.state = n.spd > 2.6 ? 'run' : 'walk'; } } else n.speed = 0;
      n.y = damp(n.y, groundY(n.x, n.z, n.y + .3), 12, dt); if (n.group) { n.group.position.set(n.x, n.y, n.z); n.group.rotation.y = n.h; if (!n.bad) { try { n.fig.update(dt, { state: n.state, speed: n.speed }); } catch (e) { n.bad = true; warn('npc.update', e); } } } }
  }
  /** setHours(h, {hold}) — jump the clock. hold: true freezes it there (missions); setHours(h) or {hold: false} lets the day run on from h. setHours(null) just releases a hold. */
  function setHours(h, o) { if (h === null || h === undefined) { G.holdHours = null; return api; } h = ((+h % 24) + 24) % 24; G.hours = h; G.holdHours = o && o.hold ? h : null; if (G.fixedHours !== null) G.fixedHours = h; if (G.atmosOn) safe('atmos.setTime', () => GT.atmos.setTime(h)); if (G.pop && G.pop.reschedule) safe('pop.reschedule', () => G.pop.reschedule()); emit('hours', { hours: h }); return api; }
  /** signalLock(true): run the cycle on to the first moment every stop line shows red, then hold it there (the lamps really are red); signalLock(false) lets it run again */
  function signalLock(on) { on = !!on; if (on === !!G.sigHold) return api; if (on) { const S = SIG(); let n = 0; while (n++ < 400 && !stopLines().every(l => sigState(l.crossing).car === 'red')) { safe('signals.update', () => S.update && S.update(.25)); if (S !== FBSIG) FBSIG.time += .25; } } G.sigHold = on; emit('signals', { locked: on }); return api; }
  /** setControl(false) parks the player's input (cut-scenes, dialogue); the world keeps running */
  function setControl(on) {
    G.inputOff = !on; if (!on) { IN.thr = IN.steer = 0; IN.brake = false; }
    const c = G.ctl; if (c && G.visual) { if (!on && !G.ctlHold && P.mode === 'foot' && c.enabled && !G.cine) G.ctlHold = safe('ctl.takeover', () => c.takeover({ heroState: 'idle', look: true, update: () => !G.inputOff, onEnd() { G.ctlHold = null; } }), null); else if (on && G.ctlHold) { const h = G.ctlHold; G.ctlHold = null; safe('hold.end', () => h.end && h.end()); } }
    return api; }

  /* ================================================================== headless logic self-test: cn.html?selftest=1 */
  function headless() { G.visual = false; G.silent = true; G.started = true; G.phase = 'play'; if (!GT.world.boxes.length) fbCollidersOnly(); buildPaths(); gridBuild(); wallet(); }
  function resetSim() {
    for (const e of G.ents.slice()) removeEnt(e); G.traffic.length = G.cops.length = 0; for (const m of MARKS.slice()) m.remove(); TIMERS.length = 0; clearWanted(true); W.enabled = true; W.lastLine = null; G.time = 0; rnd = GT.rng('cngame1');
    P.mode = 'foot'; P.ent = null; P.down = 0; P.lastOffT = -99; P.lastHitT = -9; P.mask = false; P.outfit = 'rider'; G.hp = 100; G.battery = 1; JOBS.offers.length = 0; JOBS.cur = null; JOBS.done = 0; JOBS.earned = 0; JOBS.nextT = 1e9; Object.assign(G.ap, { on: false, thr: 0, steer: 0, brake: false, path: null, runRed: false });
    IN.thr = IN.steer = 0; IN.brake = false; IN.hand = 0; G.scooter = mkEnt('escooter', { x: CN.riderStart.x, z: CN.riderStart.z, h: PI, plate: '江城52177' }); teleport(28, 62, 0); const w = wallet(); w.add(1000 - w.cash, 'test');
  }
  function selftest() { W.trafficLaw = true;
    const out = [], pre = document.createElement('pre'); pre.id = 'selftest'; document.body.appendChild(pre); const bt = document.getElementById('boot'); if (bt) bt.style.display = 'none';
    const line = (ok, msg) => { out.push((ok === null ? 'INFO  ' : ok ? 'PASS  ' : 'FAIL  ') + msg); }, seen = {}, off = on('*', (t, d) => { seen[t] = (seen[t] || 0) + 1; if (t === 'bus' && !d.leave) seen.busStop = (seen.busStop || 0) + 1; if (t === 'hit') seen.hitJay = d.jay; });
    const run = (sec, fn) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { step(1 / 60); if (fn && fn(i / 60) === true) return (i + 1) / 60; } return sec; };
    headless();
    try {
      // 1. e-scooter model on open ground
      resetSim(); let e = G.scooter; e.x = 400; e.z = -100; e.h = 0; e.v = 0; e.mode = 'player'; const I = { thr: 1, steer: 0, brake: false }; let t = 0, t40 = null;
      while (t < 14) { rideStep(e, 1 / 60, I); t += 1 / 60; if (t40 === null && e.v >= 11.11) t40 = t; }
      line(t40 !== null && t40 > 2 && t40 < 7.5 && e.v * 3.6 > 42 && e.v * 3.6 < 46.5, 'scooter: 0-40 km/h in ' + (t40 === null ? 'never' : t40.toFixed(1) + ' s') + ', top speed ' + (e.v * 3.6).toFixed(1) + ' km/h, drift ' + abs(e.x - 400).toFixed(2) + ' m');
      const z0 = e.z, v0 = e.v; I.thr = 0; I.brake = true; t = 0; while (e.v > .1 && t < 8) { rideStep(e, 1 / 60, I); t += 1 / 60; }
      line(e.z - z0 < 16 && t < 4, 'scooter: brakes ' + (v0 * 3.6).toFixed(0) + '->0 km/h in ' + (e.z - z0).toFixed(1) + ' m / ' + t.toFixed(1) + ' s');
      e.v = 9; e.lean = 0; e.h = 0; e.steerVis = 0; e.leanV = 0; I.brake = false; I.thr = .5; I.steer = 1; let early = 0, hEnd = 0; t = 0; while (t < 2) { rideStep(e, 1 / 60, I); t += 1 / 60; if (abs(t - .1) < .009) early = e.steerVis; } hEnd = e.h;
      line(e.lean > .3 && hEnd < -.6 && early > .01 && e.steerVis < 0, 'scooter: right turn at 32 km/h leans ' + (e.lean * 57.3).toFixed(0) + ' deg, heading ' + (hEnd * 57.3).toFixed(0) + ' deg in 2 s; bars flick ' + (early * 57.3).toFixed(1) + ' deg left first (countersteer), then ' + (e.steerVis * 57.3).toFixed(1) + ' deg into the turn');
      let wobLo = 0, wobHi = 0; I.steer = 0; e.lean = 0; for (const [v, k] of [[1.4, 0], [9, 1]]) { e.v = v; I.thr = v < 2 ? .2 : .5; t = 0; while (t < 3) { rideStep(e, 1 / 60, I); e.v = v; t += 1 / 60; if (k) wobHi = max(wobHi, abs(e.wob)); else wobLo = max(wobLo, abs(e.wob)); } }
      line(wobLo > .02 && wobHi < .001, 'scooter: wobbles at 5 km/h (±' + (wobLo * 57.3).toFixed(1) + ' deg), steady at 32 km/h (±' + (wobHi * 57.3).toFixed(2) + ' deg)');
      // 2. hitting a wall at speed throws the rider
      resetSim(); e = G.scooter; GT.world.addBox(396, 20, 404, 21, 3, 'selftest-wall'); gridBuild(); e.x = 400; e.z = -20; e.h = 0; e.y = groundY(400, -20, 0); mountNow(e); Object.assign(G.ap, { on: true, path: null, thr: 1, steer: 0 }); seen.fall = 0;
      run(8, () => P.down > 0 || P.mode === 'foot'); line(seen.fall === 1 && P.mode === 'foot' && e.fallen !== 0 && G.hp < 100, 'scooter: wall at ' + (12.5 * 3.6).toFixed(0) + ' km/h -> thrown off (fall events ' + seen.fall + ', hp ' + G.hp.toFixed(0) + ', scooter on its side: ' + (e.fallen !== 0) + ')');
      run(3); line(P.down === 0, 'rider gets back up after the tumble'); GT.world.boxes.pop(); gridBuild();
      // 3. shared bike + car models
      resetSim(); const bk = mkEnt('sharebike', { x: 400, z: -100, h: 0 }); bk.mode = 'player'; I.thr = 1; I.steer = 0; I.brake = false; t = 0; while (t < 12) { rideStep(bk, 1 / 60, I); t += 1 / 60; }
      line(bk.v * 3.6 > 19 && bk.v * 3.6 < 25, 'shared bike: pedals up to ' + (bk.v * 3.6).toFixed(1) + ' km/h');
      const car = mkEnt('sports', { x: 420, z: -200, h: 0 }); carInit(car); const CI = { thr: 1, steer: 0, hand: 0 }; let t100 = null; t = 0; while (t < 10) { carPhys(car, 1 / 240, CI); t += 1 / 240; if (t100 === null && car.c.vx >= 27.78) t100 = t; }
      line(t100 !== null && t100 > 3 && t100 < 9, 'sports car: 0-100 km/h in ' + (t100 === null ? 'never' : t100.toFixed(2) + ' s') + ', ' + (car.c.vx * 3.6).toFixed(0) + ' km/h after 10 s, gear ' + car.c.gear);
      const cz = car.z, cv = car.c.vx; CI.thr = -1; t = 0; while (car.c.vx > .3 && t < 12) { carPhys(car, 1 / 240, CI); t += 1 / 240; } line(t < 8, 'sports car: brakes ' + (cv * 3.6).toFixed(0) + '->0 km/h in ' + (car.z - cz).toFixed(0) + ' m (' + (cv * cv / 2 / (car.z - cz) / 9.81).toFixed(2) + ' g)');
      car.c.vx = 16; car.c.vy = car.c.r = 0; car.c.gear = 2; CI.thr = .35; CI.steer = 1; t = 0; let lat = 0; const h0 = car.h; while (t < 4) { carPhys(car, 1 / 240, CI); t += 1 / 240; lat = max(lat, abs(car.c.ayS)); }
      line(lat > 6 && lat < 13 && car.h < h0 && isFinite(car.c.r), 'sports car: full right lock at 58 km/h -> ' + (lat / 9.81).toFixed(2) + ' g, turns right (' + ((car.h - h0) * 57.3).toFixed(0) + ' deg)');
      // 4. traffic obeys the signals; buses stop at the stops
      resetSim(); spawnTraffic(); seen.busStop = 0; let reds = 0, nan = false, moved = 0; const prev = new Map(); G.traffic.forEach(c => prev.set(c, c.z)); const t0 = performance.now();
      run(240, () => { for (const c of G.traffic) { if (!isFinite(c.x + c.z + c.h + c.v)) nan = true; const pz = prev.get(c), dir = cos(c.h) > 0 ? 1 : -1; if (abs(c.x) < 7.5 && abs(sin(c.h)) < .4) for (const l of stopLines()) if (l.dir === dir && c.x >= l.x0 - .3 && c.x <= l.x1 + .3) { const f = c.dims.L / 2 * dir; if ((pz + f - l.z) * dir < 0 && (c.z + f - l.z) * dir >= 0 && sigState(l.crossing).car === 'red') reds++; } prev.set(c, c.z); moved += abs(c.v) / 60; } });
      line(!nan && reds === 0, 'traffic: ' + G.traffic.length + ' vehicles for 240 s, ' + reds + ' ran a red light, no NaN (' + Math.round(performance.now() - t0) + ' ms)');
      line(moved / G.traffic.length > 400, 'traffic: keeps flowing — ' + (moved / G.traffic.length).toFixed(0) + ' m per vehicle on average (lanes: ' + (G.mods.lanes || 'fallback loops') + ')');
      line(seen.busStop >= 2, 'traffic: buses pulled in at stops ' + seen.busStop + ' times');
      // 5. 违章: running a red light on the scooter -> camera files the plate -> 警察 respond
      resetSim(); e = G.scooter; const sl = stopLines().find(l => l.dir === -1); let guard = 0; while (!(sigState(sl.crossing).car === 'red' && sigState(sl.crossing).ped === 'walk') && guard++ < 400) { SIG().update(.25); if (SIG() !== FBSIG) FBSIG.time += .25; }
      e.x = 6.85; e.z = sl.z + 14; e.h = PI; e.y = groundY(e.x, e.z, 0); mountNow(e); Object.assign(G.ap, { on: true, path: null, thr: 1, steer: 0 }); run(5);
      line(W.stars >= .5 && W.log.some(l => l.id === 'redlight') && W.chips.plate.on && chipValid('plate'), '违章: red light at z=' + sl.crossing + ' -> ' + W.stars.toFixed(1) + ' stars, fine ' + money(W.fines) + ', 牌 on file: ' + W.chips.plate.on + ', 车 on file: ' + W.chips.car.on);
      G.ap.thr = 0; G.ap.brake = true; const tc = run(40, () => G.cops.length > 0); line(G.cops.length > 0, '警察: a unit (' + (G.cops[0] ? G.cops[0].cop.unit : '-') + ') is dispatched after ' + tc.toFixed(1) + ' s, out of sight ' + (G.cops[0] ? hyp(G.cops[0].x - P.x, G.cops[0].z - P.z).toFixed(0) : '-') + ' m away');
      // re-plating clears 车 + 牌
      fileChip('car'); const was = chipValid('car') && chipValid('plate'); P.x = e.x; P.z = e.z; replate(e); line(was && !chipValid('car') && !chipValid('plate') && matchRange() === 0, 're-plate: ' + money(200) + ' -> new plate ' + e.plate + ', the description no longer matches');
      // 6. busted: hot, stopped, an officer beside you
      resetSim(); e = G.scooter; e.x = 6.85; e.z = 20; e.h = PI; mountNow(e); violation('redlight'); violation('wrongway'); const cash0 = wallet().cash, c1 = spawnCop('moto', 6.85, 24.5, PI, 'pursue'); W.hot = true; W.lastSeenT = G.time; seen.busted = 0; Object.assign(G.ap, { on: true, path: null, thr: 0, steer: 0, brake: true });
      const tb = run(12, () => seen.busted > 0); line(seen.busted === 1 && W.stars === 0 && wallet().cash < cash0 && P.mode === 'foot', 'busted: stopped beside the officer for ' + tb.toFixed(1) + ' s -> 罚单 ' + money(cash0 - wallet().cash) + ', stars cleared, back at the start point (' + P.x.toFixed(0) + ', ' + P.z.toFixed(0) + ')');
      // pt1: on foot a patrol car parked beside you is no arrest any more — only an officer on foot holding you is (js/combat.js grabbedBy)
      { resetSim(); teleport(10.1, 30, PI); W.stars = 1.5; W.hot = true; W.lastSeenT = G.time; seen.busted = 0; spawnCop('police', 12.6, 30.5, PI, 'block'); const tq = run(5, () => { W.lastSeenT = G.time; W.hot = true; return seen.busted > 0; }); line(seen.busted === 0 && W.stars > 0 && P.mode === 'foot', 'busted (pt1): standing on foot 2.5 m from a parked patrol car for ' + tq.toFixed(1) + ' s while hot is not an arrest'); clearWanted(true); }
      // 7. losing them: nothing on file matches a man on foot -> search runs out
      resetSim(); e = G.scooter; e.x = 6.85; e.z = 20; e.h = PI; mountNow(e); violation('redlight'); violation('wrongway'); violation('speeding'); fileChip('car'); fileChip('plate'); const s0 = W.stars; teleport(60, 76, 0); seen.clear = 0;
      const tl = run(120, () => W.stars <= 0); line(s0 >= 1 && W.stars === 0 && seen.clear > 0, 'lose them: ' + s0.toFixed(1) + ' stars on the scooter, walk away into the courtyard -> clear after ' + tl.toFixed(0) + ' s (units out: ' + G.cops.length + ')');
      // 8. a man standing in a lane: free-roam traffic brakes for him (the old mission rule that ran him over went with the story)
      { resetSim(); const t2 = mkEnt('taxi', { mode: 'traffic', cruise: 11 }); placeOnPath(t2, PATHS.loopB, pathNearest(PATHS.loopB, 2, 44)); t2.v = 11; G.traffic.push(t2); teleport(t2.x, 14, 0); seen.hit = 0; guard = 0; while (sigState(62).car !== 'green' && guard++ < 400) { SIG().update(.25); } run(6, () => abs(t2.v) < .3 && hyp(t2.x - P.x, t2.z - P.z) < 12);
        line(seen.hit === 0 && abs(t2.v) < .3 && !t2.veh.locked, 'free roam: a taxi stops for a man standing in its lane (' + hyp(t2.x - P.x, t2.z - P.z).toFixed(1) + ' m short) and can be taken with F'); }
      // 9. g7: no delivery jobs, a new game, the start point, the hospital bill
      resetSim(); { const o = pushOffer({ shop: 'x', from: { x: 30, z: 62 }, to: { x: 44, z: 70 } }); line(o === null && !acceptJob(0) && !JOBS.enabled && api.jobs.current === null && !api.jobs.enabled && !PHONE.el, 'no delivery: an offer is refused, there is nothing to accept, no rider phone is built'); }
      { const w = wallet(); w.add(1234 - w.cash, 'test'); W.stars = 2; W.hot = true; newGameState(true); line(wallet().cash === START_CASH && W.stars === 0 && !W.hot, 'new game: ' + money(wallet().cash) + ' in the pocket, nothing on file'); }
      { resetSim(); G.scooter = null; const sp = spawnPt(), car = placeMyCar(); teleport(sp.x, sp.z, sp.h); const d = hyp(car.x - P.x, car.z - P.z), pave = !inRoad(sp.x, sp.z), free = !car.locked && car.mode === 'parked'; enterCarNow(car); const inCar = P.mode === 'car' && P.ent === car; leaveCarNow();
        line(d < 5 && pave && free && inCar, 'start point: on the pavement (' + sp.x + ', ' + sp.z + '), his own car ' + d.toFixed(1) + ' m away, unlocked, F gets him in'); removeEnt(car); G.mycar = null; }
      { resetSim(); const w = wallet(); w.add(500 - w.cash, 'test'); teleport(0, 20, 0); G.downT = 0; playerDown(); const sp = spawnPt(); line(abs(wallet().cash - 300) < .01 && hyp(P.x - sp.x, P.z - sp.z) < .5 && P.mode === 'foot' && G.downT === 0, 'wasted: knocked out with $500 -> $200 hospital bill, he comes to on the pavement at the start point'); }
      { const CL = GT.shops && GT.shops.catalogue && GT.shops.catalogue.clothes; if (CL) line(Object.keys(CL).every(k => !/骑手|外卖|跑得快/.test(CL[k].n + CL[k].d) && CL[k].role !== 'rider'), 'shops: the wardrobe sells plain clothes (' + CL.c_rider.n + ', ' + CL.c_bluerider.n + '), no rider jackets'); }
      // 10. economy + API surface
      resetSim(); G.hp = 40; const okBuy = buy('热干面', 8, 40, null); line(okBuy && G.hp === 80 && wallet().cash === 992, 'economy: 热干面 ' + money(8) + ' heals 40 (hp ' + G.hp + ', cash ' + money(wallet().cash) + ')');
      const bike = mkEnt('sharebike', { x: 12.85, z: 49, h: 0, locked: true }); unlockBike(bike); line(!bike.locked && abs(wallet().cash - 990.5) < .01, 'shared bike: scan to unlock for ' + money(1.5));
      /* 10b. open-world basics: a driven vehicle can be taken, and an offence nobody saw raises nothing */
      { resetSim(); spawnTraffic(); const tx = G.traffic.find(c => c.kind === 'taxi'), n0 = G.traffic.length; tx.v = 0; teleport(tx.x + cos(tx.h) * 1.6, tx.z - sin(tx.h) * 1.6, 0); G.traffic.length = 0; G.traffic.push(tx); W.seenBy = 0; W.stars = 0; W.hot = false; startJack(tx); run(.2);
        const ej = tx.mode === 'parked' && tx.jack === 2 && G.traffic.indexOf(tx) < 0, s0 = W.stars; enterCarNow(tx); const drv = P.mode === 'car' && P.ent === tx; leaveCarNow();
        line(ej && drv && s0 === 0, '抢车: F on a driven taxi pulls the driver, the car is yours; with no witness the sheet stays clean (stars ' + s0.toFixed(2) + ', traffic ' + n0 + ')');
        W.seenBy = 1; W.lastLine = null; const seen = crime('jack', P.x, P.z, null), s1 = W.stars; W.seenBy = 0; W.stars = 0; W.lastLine = null; const unseen = crime('fight', P.x, P.z, null);
        line(seen && s1 >= 1 && !unseen && W.stars === 0, 'witnesses: an officer watching makes 抢车 ' + s1.toFixed(1) + ' star; a punch nobody saw adds none');
        resetSim(); }
      const need = ['boot', 'spawnVehicle', 'spawnNPC', 'teleport', 'setHours', 'on', 'marker', 'timer', 'cutscene', 'freeRoam'], miss = need.filter(k => typeof api[k] !== 'function').concat(['achievement', 'slip', 'mission', 'fail'].filter(k => typeof api.ui[k] !== 'function').map(k => 'ui.' + k));
      const mk = api.marker(1, 2, 'x'), tm = api.timer(5, 't'); run(1); line(!miss.length && mk && tm && abs(tm.left - 4) < .05 && typeof api.wanted.stars === 'number' && api.player === P, 'API: GT.cngame exposes ' + need.join(', ') + ', ui.*, wanted, player, scooter' + (miss.length ? ' — MISSING ' + miss.join(', ') : '')); mk.remove(); tm.stop();
      api.setHours(21, { hold: true }); run(2); const held = abs(G.hours - 21) < 1e-6; api.setHours(7.5); run(2); line(held && G.hours > 7.5, 'clock: setHours(21, {hold}) holds, setHours(7.5) runs on (' + clock(G.hours) + ')');
      if (GT.shops && GT.shops.selftest) safe('shops.selftest', () => { for (const l of GT.shops.selftest()) line(l.indexOf('FAIL') !== 0, 'shops: ' + l.slice(5)); }); else line(null, 'shops: js/shops.js not loaded');   /* js/shops.js pure-logic checks (cn.html loads shops for the self-test) */
      for (const m of ['traffic', 'peds']) { if (GT[m] && GT[m].selftest) safe(m + '.selftest', () => { for (const l of GT[m].selftest()) line(l.indexOf('FAIL') !== 0, l.slice(6)); }); else line(null, m + ': js/' + m + '.js not loaded'); }   /* TF: js/traffic.js / js/peds.js pure-logic checks */
    } catch (err) { line(false, 'self-test threw: ' + (err.stack || err)); }
    off(); const fails = out.filter(l => l.indexOf('FAIL') === 0).length;
    pre.textContent = 'BILIBILI THEFT AUTO 1 — logic self-test (headless simulation, 60 Hz fixed step)\n\n' + out.join('\n') + '\n\n' + (fails ? fails + ' FAILED' : 'ALL PASS') + (G.warnings.length ? '\nwarnings: ' + G.warnings.join(' | ') : '');
    document.title = fails ? 'selftest FAIL' : 'selftest PASS'; G.selftest = out; return out;
  }

  /* ================================================================== exports */
  const api = GT.cngame = {
    /** boot({canvas, hud, query?}) — build the world behind the studio logo, then the menu (or an ?auto= state / the self-test) */
    boot,
    /** step(dt) — advance the whole simulation (no rendering) */
    step,
    /** live state: phase 'boot'|'menu'|'load'|'play', time (s), hours, paused, mods (what loaded / fell back), warnings */
    get state() { return { phase: G.phase, time: G.time, hours: G.hours, paused: G.paused, story: G.story, mode: P.mode, zone: P.zone, hp: hp01() * 100, battery: G.battery, stars: W.stars, hot: W.hot, job: JOBS.cur, mods: G.mods, warnings: G.warnings, vehicles: G.ents, cops: G.cops, traffic: G.traffic, events: G.events, camera: CAM }; },
    /** the player: {mode: 'foot'|'two'|'car', x, z, y, h, speed, ent (vehicle entity or null), down, jay, outfit, mask, zone, inside} — refreshed every step */
    player: P,
    get ctl() { return G.ctl; }, get hero() { return G.kai; }, get partner() { return G.lie; }, get scooter() { return G.scooter; }, get people() { return G.pop; }, get scene() { return G.scene; }, get camera() { return G.camera; },
    spawnVehicle, removeVehicle: removeEnt, spawnNPC, teleport, mount: mountNow, warmCockpit(e) { if (G.visual && !G.cockpit && !G.bad.cockpit && e && e.veh && e.veh.group && !e.two && P.mode !== 'car') { attachCockpit(e); if (G.cockpit) G.cockpit.group.visible = false; } return api; },   /* js/shops.js: build the first-person interior while the car is on the bench, not in the frame you drive off */
    exitVehicle() { if (P.mode === 'car') exitCar(); else if (P.mode === 'two' && G.ctl) safe('exit', () => G.ctl.playExitCar()); return api; },
    setHours, setControl, signalLock, heal, hurt, knockDown, say, freeRoam, toMenu, pause: setPause,
    get battery() { return G.battery; }, set battery(v) { G.battery = clamp(+v || 0, 0, 1); },
    /** partner(on): 阿烈 follows (true) or goes back to the hotpot kitchen (false) */
    setPartner(on) { G.partnerOn = !!on; const c = G.ctl; if (c && c.partner) safe('partner', () => { if (on) { c.partner.teleport(P.x - sin(P.h) * 1.4, P.z - cos(P.h) * 1.4, P.h); c.partner.follow(true); } else { const a = anchor('hotpotKitchen', { x: 44.3, z: 125.5 }); c.partner.follow(false); c.partner.teleport(a.x, a.z, a.h || 0); } }); return api; },
    /** 违章 */
    wanted: { get stars() { return W.stars; }, set stars(v) { W.stars = clamp(+v || 0, 0, 6); W.peak = max(W.peak, W.stars); if (W.stars > 0) { W.searchT = 0; W.lastKnown = { x: P.x, z: P.z }; } }, get hot() { return W.hot; }, get enabled() { return W.enabled; }, set enabled(v) { W.enabled = !!v; if (!v) clearWanted(true); },
      get chips() { const o = {}; for (const c of CHIPS) o[c[0]] = { on: W.chips[c[0]].on, valid: chipValid(c[0]), label: c[1] }; return o; }, get fines() { return W.fines; }, get log() { return W.log.slice(); },
      add: violation, addStars, clear: clearWanted, file: fileChip, spawn: (kind, x, z, h, state) => spawnCop(kind || 'police', x, z, h || 0, state), offences: OFF, state: W },
    ui, on, emit, marker, get marks() { return MARKS; }, timer, cutscene, skipCutscene: endCutscene,
    /** delivery jobs: removed (g7), inert */
    jobs: { get current() { return null; }, get offers() { return []; }, get done() { return 0; }, get earned() { return 0; }, get enabled() { return false; }, set enabled(v) { }, offer: pushOffer, accept: acceptJob, cancel: failJob, generate: makeOffer },   /* g7: inert (no delivery jobs) */
    economy: { buy, stalls: STALLS, replate, wrap, unlockBike, setMask },
    /** world queries the story can reuse */
    groundY, inRoad, onCrossing, inWater, los, anchor, signal: sigState, paths: PATHS, pathAt, pathNearest, zoneName,
    autopilot(pathName, speed) { if (!pathName) { G.ap.on = false; return api; } if (P.ent) apOn(pathName, speed || 9); return api; },
    /** ff(seconds): run the simulation forward without rendering (used by ?auto= states) */
    ff, selftest, headless, G,
    /** internals for js/cntrailer.js (staging the opening trailer with the real simulation). Not a story API. */
    witnesses, crime, sim: { W, IN, DIR, HUD, CAM, FEEL, NPCS, PEV, JACK, startJack, ejectDriver, civHit, scareTraffic, mkPath, mkEnt, removeEnt, syncEnt, aiDrive, aiCollideWorld, followPath, setPath, placeOnPath, enterCarNow, leaveCarNow, carInit, apOn, spawnCop, clearWanted, fileChip, shake, audioInit, shotPose, endCutscene, startFlyby, npcStep, peopleStep, syncVehList, refreshPlayer, audioStep, aliveStep, sleep, F }
  };

  /* showcase.html?m=cngame — the HUD pieces over a small stand-in street (the real game is cn.html) */
  GT.showcase.cngame = ({ scene, camera }) => {
    G.scene = scene; G.camera = camera; G.Q = new URLSearchParams(location.search); buildPaths();
    const road = GT.cnroad && GT.cnroad.build ? safe('cnroad.build', () => GT.cnroad.build(scene), null) : null; if (!road) fbWorld(scene); gridBuild();
    const sc = mkEnt('escooter', { x: 6.85, z: 30, h: PI, plate: '江城52177' }), tx = mkEnt('taxi', { x: 2, z: 21, h: PI }), bus = mkEnt('bus', { x: 4.9, z: 6, h: PI }), co = spawnCop('moto', 6.6, 24.5, PI, 'patrol'), pc = spawnCop('police', -2, 16, 0, 'patrol'); G.scooter = sc; safe('stand', () => sc.veh.setStand(false));
    for (const e of [tx, bus, co, pc]) e.lights.head = true; pc.lights.siren = co.lights.siren = true; sc.lean = .28; sc.steerVis = -.12;
    let hud = document.getElementById('hud'); if (!hud) { hud = document.createElement('div'); hud.id = 'hud'; document.body.appendChild(hud); const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/cn.css?v=' + Date.now(); document.head.appendChild(l); }
    document.body.classList.add('cn-still'); HUD.init(hud); HUD.root.classList.add('now'); HUD.show(true); G.phase = 'play'; wallet().add(1286.5, 'demo'); P.x = 6.85; P.z = 30; P.h = PI; P.mode = 'two'; P.ent = sc; W.stars = 3; W.hot = true; fileChip('car'); fileChip('plate'); W.chips.cloth.on = true; W.chips.cloth.sig = 'old';
    ui.mission('超时 · 把臭豆腐送到轻轨观景台'); ui.achievement('能屈能伸'); HUD.achGap = 0; marker(9, 4, '送达 · 轻轨观景台', { color: '#5fe0c8' }); timer(84, '送达倒计时');
    if (G.Q.get('slip') === '1') ui.slip('跑得快 · 订单完成', [['配送费', 12.5], ['平台服务费 20%', -2.5], ['准时小费', 4], ['用时', '1:12 / 1:40']], 14);
    return { cam: [3.4, 2.1, 38.5], look: [6, .9, 28], hours: 18.4, update(dt) { G.time += dt; for (const e of G.ents) syncEnt(e, dt); marksStep(dt); HUD.update(dt); } };
  };
})();
