/* traffic.js — the cars of 月湾大道 Moonbay Drive (TF, 2026-11-17). Coast map only (cn.html?world=coast, the default); ?tf=0 leaves js/cngame.js's own traffic alone.
   How it plugs in: js/cngame.js keeps owning the cars (G.traffic: drivers, 抢车, separateEnts, the police AI). Its trafficStep calls GT.traffic.pre(dt) once, works out each car's speed cap as
   before (scare, rush, siren, the man at the door) and hands the car to GT.traffic.drive(c, vT, dt) instead of its own followPath when c.tf is set. Its frame loop skips syncEnt for e.tfLite.
   Rings (distance to the player; the camera in the menu): < 30 m full step every frame (three probes, world collision, lane changes, horns); 30–80 m the decisions every other frame
   (centre probe only, no world collision; the car still moves every frame); 80–140 m 10 Hz on rails (no animation, the driver hidden — the body is placed here); > 140 m back to the pool:
   the car comes back 105–135 m away on a lane, out of the camera's view. Nothing in the frame loop allocates (preallocated hash buckets, scratch objects).
   Lanes on the existing loops of js/coast.js (GT.cnroad.lanes 'outer' / 'inner'): northbound on the sea side (x = -1.9, one lane); southbound on the hotel side as two lanes laid over the one
   path by a lateral offset: the fast lane (x = +1.15) and the kerb-side slow lane (x = +3.25, cruising, drop-offs). Kerb slots (x = ±5.45) are the gaps between the parked cars; four of them
   in front of hotels are drop-off bays with a valet of js/peds.js.
   Probes: centre and ±15°, max(6, v × 1.25) m past the front bumper, tested against an 8 m spatial hash of cars, the player and people in the roadway (rebuilt once a frame). Side probes only
   count what is coming into the car's path (people stepping off the kerb, a car pulling out or reversing, a car cutting in), never the parked row or the pavement.
   Characters (original names): Corvane Saltwind (retro coupé: low cruise, blips the throttle pulling away), Halbrook Gravelback (muscle: quick lane changes, short gaps, leans on the horn),
   Pellani Sunreach (open-tops: gentle, radio on), Ostrander Highmoor (big SUV: long braking, slow round corners), Tillman Fieldhand (pickup: now and then on the shoulder),
   Halbrook Vigil · PVPS (patrol car — cngame's own patrol AI: it ignores the player until he is wanted, then the nearest units respond).
   Sirens: a unit with its lights on behind (or coming the other way) makes everyone pull right and slow down; stop at the kerb when it is close behind.
   API: GT.traffic = { active, pre(dt), drive(c, vT, dt), stats(), cars, cops, slots, ARCH, selftest() }.  &tfn=<n> moving cars (25), &tfcop=<n> patrol cars (2). */
(function () {
  'use strict';
  const GT = window.GT; if (!GT) return;
  const QS = new URLSearchParams(location.search), PI = Math.PI, abs = Math.abs, min = Math.min, max = Math.max, hyp = Math.hypot, sin = Math.sin, cos = Math.cos, sqrt = Math.sqrt;
  const cl = (v, a, b) => v < a ? a : v > b ? b : v, rnd = Math.random, adiff = (a, b) => { let d = (b - a) % (2 * PI); if (d > PI) d -= 2 * PI; if (d < -PI) d += 2 * PI; return d; };
  const R0 = 30, R1 = 80, R2 = 140, SP0 = 105, SP1 = 135, C15 = cos(15 * PI / 180), S15 = sin(15 * PI / 180), T15 = S15 / C15;
  const NMOVE = QS.get('tfn') !== null ? max(0, +QS.get('tfn')) : 16, NCOP = QS.get('tfcop') !== null ? max(0, +QS.get('tfcop')) : 2;
  /* lateral offsets, metres to the right of a loop's centre line: north lane, north pulled over, south fast, south slow, south pulled over, a kerb slot */
  const OFF = { N: 0, NP: 1.65, F: -.75, S: 1.35, SP: 1.6, KERB: 3.55, SHOULDER: 1.05 };
  const ARCH = {
    retro:  { id: 'retro',  zh: '复古跑车', name: 'Corvane Saltwind',     n: 7, kinds: [['sports']], cruise: [8, 9.8], acc: 3.3, brk: 6.5, latA: 6, gapT: .8, hornD: 2.4, hornRep: 4.5, laneK: .5, slowLane: .75, latV: 1.2, cols: [0xf2f0ea, 0x6fd6c8, 0xe86a9a, 0xd8203a, 0x7ab8e8, 0xf2d24a, 0xf4a85a] },
    muscle: { id: 'muscle', zh: '肌肉车',   name: 'Halbrook Gravelback',  n: 6, kinds: [['muscle']], cruise: [11, 13], acc: 3.8, brk: 7.2, latA: 6.5, gapT: .45, hornD: .8, hornRep: 1.7, laneK: 2, slowLane: .1, latV: 2.3, cols: [0x17181b, 0x8a1c1c, 0xc4541a, 0xf2f0ea, 0x2a3a5a, 0x3a5a2a] },
    conv:   { id: 'conv',   zh: '敞篷车',   name: 'Pellani Sunreach',     n: 7, kinds: [['sports', 'roadster'], ['muscle', 'conv']], cruise: [7.5, 9], acc: 2.4, brk: 6, latA: 5.5, gapT: 1, hornD: 3.6, hornRep: 7, laneK: .3, slowLane: .85, latV: 1, radio: 1, cols: [0xf4f2ee, 0xe86a9a, 0x6fd8e8, 0xf2d24a, 0xd8203a, 0x9ad8b8] },
    suv:    { id: 'suv',    zh: '大SUV',    name: 'Ostrander Highmoor',   n: 4, kinds: [['suv']], cruise: [9.5, 11], acc: 2.1, brk: 4.4, latA: 3.6, gapT: 1.25, hornD: 1.8, hornRep: 4, laneK: .7, slowLane: .3, latV: .9, cols: [0x17181b, 0xf2f2f0, 0x8a8e94, 0x23344a, 0x3a3f46] },
    pickup: { id: 'pickup', zh: '皮卡',     name: 'Tillman Fieldhand',    n: 1, kinds: [['pickup']], cruise: [9.5, 11], acc: 2.3, brk: 5.4, latA: 4.4, gapT: 1, hornD: 1.6, hornRep: 4, laneK: .6, slowLane: .45, latV: 1.1, shoulder: 1, cols: [0xe6e2d6, 0x8a6a4a, 0x2f4a3a, 0x9a2a22] },
    cop:    { id: 'cop',    zh: '巡逻警车', name: 'Halbrook Vigil · PVPS', n: 0, kinds: [['police']], cruise: [9, 9], acc: 3, brk: 8, latA: 6, gapT: .9, hornD: 99, hornRep: 99, laneK: 0, slowLane: .5, latV: 1.2, cols: [] } };
  const ORDER = ['retro', 'muscle', 'conv', 'suv', 'pickup'], TOTAL = ORDER.reduce((a, k) => a + ARCH[k].n, 0);
  const S = { on: false, ready: false, t: 0, frame: 0, cars: [], cops: [], slots: [], kerb: [], spawnQ: [], made: 0, removed: 0, recycled: 0, adopted: 0, honks: 0, rage: 0, yields: 0, pulls: 0, drops: 0, parks: 0, outs: 0, laneCh: 0, pedBrakes: 0,
    ms: 0, msF: 0, ring: [0, 0, 0, 0], radios: [null, null], radT: 0, recT: 0, kerbT: 0, focus: { x: 0, z: 0, fx: 0, fz: 1 }, samples: null, lastSir: 0 };
  const api = GT.traffic = { active: false, ARCH, OFF, S, cars: S.cars, cops: S.cops, slots: S.slots, pre, drive, stats, selftest, honk, laneOf: c => c.tf ? c.tf.lane : -1 };
  S.on = api.active = QS.get('world') === 'coast' && QS.get('tf') !== '0' && QS.get('traffic') !== '0' && QS.get('selftest') !== '1';

  let g = null, G = null, P = null, SIM = null;
  const _q = { x: 0, z: 0, h: 0 }, _q2 = { x: 0, z: 0, h: 0 }, PL = { isPlayer: true, x: 0, z: 0, v: 0, h: 0 }, SIR = [], NEAR = [], RAD = [];
  const pathAt = (p, s, o) => { const d = p.d, pp = p.p, L = p.len; s = p.closed ? ((s % L) + L) % L : cl(s, 0, L); let lo = 0, hi = d.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] <= s) lo = m; else hi = m; } const seg = d[hi] - d[lo] || 1, t = (s - d[lo]) / seg, a = pp[lo], b = pp[hi]; o.x = a[0] + (b[0] - a[0]) * t; o.z = a[1] + (b[1] - a[1]) * t; o.h = Math.atan2(b[0] - a[0], b[1] - a[1]); o.i = lo; return o; };
  /** nearest arc length to (x, z) on the path near s (the segment s is on and its two neighbours each way) */
  function proj(p, s, x, z) { pathAt(p, s, _q2); const n = p.p.length - 1, d = p.d; let best = 1e18, bs = s;
    for (let k = -2; k <= 2; k++) { let i = _q2.i + k; if (p.closed) i = ((i % n) + n) % n; else if (i < 0 || i >= n) continue; const a = p.p[i], b = p.p[i + 1], bx = b[0] - a[0], bz = b[1] - a[1], l2 = bx * bx + bz * bz || 1, u = cl(((x - a[0]) * bx + (z - a[1]) * bz) / l2, 0, 1), dx = a[0] + bx * u - x, dz = a[1] + bz * u - z, dd = dx * dx + dz * dz;
      if (dd < best) { best = dd; bs = d[i] + (d[i + 1] - d[i]) * u; } } return bs; }
  /** 1 on the avenue's straight (the two-lane and pull-over offsets apply), easing to 0 into the bends at the cross streets */
  const aveK = (x, z) => abs(x) > 6.5 ? 0 : 1 - cl((abs(z) - 128) / 12, 0, 1);

  /* ---------------------------------------------------------------- spatial hash: 8 m cells, 4096 buckets, reused every frame */
  const CELL = 8, GN = 4096, GB = [], GC = new Int32Array(GN), GU = new Int32Array(GN); let gUsed = 0; for (let i = 0; i < GN; i++) GB.push([]);
  const gk = (ix, iz) => (((ix * 73856093) ^ (iz * 19349663)) >>> 0) & (GN - 1);
  function gClear() { for (let i = 0; i < gUsed; i++) GC[GU[i]] = 0; gUsed = 0; }
  function gAdd(o, x, z) { const k = gk(Math.floor(x / CELL), Math.floor(z / CELL)); if (GC[k] === 0) GU[gUsed++] = k; const b = GB[k]; if (GC[k] < b.length) b[GC[k]] = o; else b.push(o); GC[k]++; }
  /** calls fn(o) once for everything stored in the cells over [x0, x1] × [z0, z1] (buckets can collide: fn checks distance itself) */
  let qStamp = 1; const QSEEN = new Int32Array(GN);
  function gQuery(x0, z0, x1, z1, fn) { qStamp++; const i0 = Math.floor(x0 / CELL), i1 = Math.floor(x1 / CELL), j0 = Math.floor(z0 / CELL), j1 = Math.floor(z1 / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = gk(i, j); if (QSEEN[k] === qStamp) continue; QSEEN[k] = qStamp; const n = GC[k], b = GB[k]; for (let m = 0; m < n; m++) fn(b[m]); } }

  /* ---------------------------------------------------------------- setup: adopt cngame's coast traffic, top it up to the mix, two patrol units */
  const archOf = e => { const k = e.kind, open = !!(GT.coast && GT.coast.openTop && GT.coast.openTop.has(e)) || !!(e.veh && e.veh.group && e.veh.group.userData && e.veh.group.userData.openTop);
    return k === 'sports' ? (open ? 'conv' : 'retro') : k === 'muscle' ? (open ? 'conv' : 'muscle') : k === 'suv' ? 'suv' : k === 'pickup' ? 'pickup' : null; };
  function tfOf(c, a, lane) { const A = ARCH[a]; c.tf = { a: A, id: a, lane: lane || 0, off: 0, offT: 0, s: c.s || 0, ring: 0, st: 'cruise', slot: null, t: 0, acc: 0, lite: 0, vL: 0, hornT: 0, honks: 0, blockT: 0, blk: 0, slowT: 0, chT: 2 + rnd() * 6, ind: 0, stopT: 0,
      launch: 0, yieldT: 0, shT: 20 + rnd() * 40, sh: 0, kerbT: 8 + rnd() * 40, rageT: 0, curveT: 0, curveV: 99, dwell: 0, back: 0, look: 0, hitT: 0 };
    c.cruise = A.cruise[0] + rnd() * (A.cruise[1] - A.cruise[0]); return c.tf; }
  function setup() {
    g = GT.cngame; G = g && g.G; P = g && g.player; SIM = g && g.sim; if (!G || !SIM || !g.paths || !g.paths.loopA || !g.paths.loopB) return false;
    if (G.traffic.some(e => /^(bus|taxi|trike|van)$/.test(e.kind)) && S.t < 3) return false;   /* js/coast.js swaps the China-edition taxis and buses out in its first quarter second */
    const have = {}; for (const k of ORDER) have[k] = 0;
    for (const e of G.traffic.slice()) { if (e.two || e.cop) continue; const a = archOf(e); if (a && have[a] < ARCH[a].n) { have[a]++; adopt(e, a); } else { try { SIM.removeEnt(e); S.removed++; } catch (err) { /* already gone */ } } }
    for (const k of ORDER) for (let i = have[k]; i < max(0, Math.round(ARCH[k].n * NMOVE / TOTAL)); i++) S.spawnQ.push(k);
    for (let i = 0; i < NCOP; i++) S.spawnQ.push('cop');
    kerbSlots(); S.ready = true; spread(); return true; }
  function adopt(e, a) { const lane = SB(e.path) ? (rnd() < ARCH[a].slowLane ? 1 : 0) : 0; tfOf(e, a, lane); e.tf.s = g.pathNearest(e.path || g.paths.loopA, e.x, e.z); if (!e.path) e.path = g.paths.loopA; S.cars.push(e); S.adopted++; }
  function make(a) { const A = ARCH[a], kd = A.kinds[(rnd() * A.kinds.length) | 0], col = A.cols[(rnd() * A.cols.length) | 0];
    if (a === 'cop') { const c = SIM.spawnCop('police', 0, 0, 0, 'patrol'); if (!c) return null; c.cop.keep = true; c.cop.loop = S.cops.length % 2 ? 'loopA' : 'loopB'; tfOf(c, 'cop', 0); S.cops.push(c); if (!place(c, g.paths[c.cop.loop], true)) parkFar(c); S.made++; return c; }
    const c = SIM.mkEnt(kd[0], kd[1] ? { mode: 'traffic', color: col, opts: { variant: kd[1] } } : { mode: 'traffic', color: col }); if (!c) return null;
    if (kd[1] && GT.coast && GT.coast.openTop) GT.coast.openTop.add(c); G.traffic.push(c); tfOf(c, a, 0); S.cars.push(c); S.made++; if (!place(c, null, S.t < 4)) parkFar(c); return c; }
  /** no room near the player: somewhere on the loop, the pool brings it in when there is */
  function parkFar(c) { const p = (c.cop && g.paths[c.cop.loop]) || g.paths.loopA, F = S.focus; let s = 0, bd = -1; for (let k = 0; k < 24; k++) { const sv = p.len * k / 24; pathAt(p, sv, _q); const d = hyp(_q.x - F.x, _q.z - F.z); if (d > bd) { bd = d; s = sv; } }   /* the far side of the loop: out of sight, the pool brings it in next frame or the one after */
    SIM.placeOnPath(c, p, s); c.tf.s = s; c.tf.lane = 0; c.tf.off = c.tf.offT = 0; c.v = c.cruise * .8; c.tf.ring = 3; if (c.cop) { c.path = p; c.s = s; } }

  /* kerb slots: gaps of 7.5 m or more between the parked cars on both sides (no crossings, side streets or bus stops); four in front of hotels are drop-off bays */
  function kerbSlots() { S.kerb.length = 0; S.slots.length = 0; const parked = [[], []];
    for (const e of G.ents) if (e.alive && e.mode === 'parked' && !e.two && abs(abs(e.x) - 5.45) < 1.2 && abs(e.z) < 150) parked[e.x > 0 ? 1 : 0].push(e.z);
    const bad = (side, z) => abs(z + 44) < 9 || abs(z - 66) < 9 || (side && (abs(z - 18) < 8 || abs(z + 95) < 8 || abs(z + 80) < 8)) || (!side && abs(z - 100) < 8) || abs(z + 81) < 6 || abs(z + 34) < 6;
    for (let side = 0; side < 2; side++) { const zs = parked[side].sort((a, b) => a - b); zs.unshift(-138); zs.push(138);
      for (let i = 0; i < zs.length - 1; i++) { const a = zs[i] + 3.6, b = zs[i + 1] - 3.6; for (let z = a + 3.2; z <= b - 3.2; z += 7.6) if (!bad(side, z)) S.kerb.push({ side, x: side ? 5.45 : -5.45, z, car: null, cool: 0, drop: false }); } }
    const H = (GT.coast && GT.coast.C && GT.coast.C.hotels) || []; let n = 0;
    for (const hz of H.slice().sort((a, b) => abs((a[0] + a[1]) / 2 + 20) - abs((b[0] + b[1]) / 2 + 20))) { if (n >= 4) break; const zc = (hz[0] + hz[1]) / 2; if (abs(zc) > 125) continue;
      let best = null, bd = 6; for (const k of S.kerb) if (k.side === 1 && !k.drop && abs(k.z - zc) < bd) { bd = abs(k.z - zc); best = k; } if (!best || S.slots.some(s => abs(s.z - best.z) < 30)) continue;
      best.drop = true; S.slots.push({ x: 5.45, z: best.z, kerb: best, hotel: zc, car: null, st: 'free', t: 0, cool: 10 * n, open: false, guest: 0, stand: { x: 7.7, z: best.z + 3.2 }, door: { x: 13.6, z: zc } }); n++; } }

  /* ---------------------------------------------------------------- placement (spawn, pool) */
  /* lanes: the two avenue loops of js/coast.js and, once the Chinatown merge published them, the two loops through 灯笼街 Lantern St (GT.coast.jadePaths: J1 clockwise —
     Moonbay Dr north, the north cross street, Palmera Ave south, Lantern St west; J2 anticlockwise — Moonbay Dr south, Lantern St east, Palmera Ave north). Weights = share of the cars. */
  const LANES = [['loopA', 0, .24], ['loopB', 0, .17], ['loopB', 1, .21], ['J1', 0, .18], ['J2', 0, .09], ['J2', 1, .11]];
  const JP = () => (GT.coast && GT.coast.jadePaths) || [], PTH = n => n === 'J1' ? JP()[0] : n === 'J2' ? JP()[1] : g.paths[n];
  /** southbound on the avenue (two lanes on the hotel side): the inner loop or J2 */
  const SB = p => !!p && (p === g.paths.loopB || p === JP()[1]);
  function laneOff(c, t) { if (SB(c.path)) return t.lane ? OFF.S : OFF.F; return OFF.N; }
  /** a spot on a lane between r0 and r1 from the focus, clear of other cars by 11 m, out of view when asked */
  function findSpot(path, r0, r1, hidden) { const F = S.focus, step = 6, n = Math.floor(path.len / step), o = (rnd() * n) | 0; let best = -1, bs = -1e9, found = 0;
    for (let k = 0; k < n; k++) { const s = ((o + k) % n) * step; pathAt(path, s, _q); const dx = _q.x - F.x, dz = _q.z - F.z, d = hyp(dx, dz); if (d < r0 || d > r1) continue;
      if (hidden && d < 125 && (dx * F.fx + dz * F.fz) / (d || 1) > .25) continue; let busy = false; gQuery(_q.x - 11, _q.z - 11, _q.x + 11, _q.z + 11, e => { if (!busy && e.dims && hyp(e.x - _q.x, e.z - _q.z) < 11) busy = true; }); if (busy) continue;
      const app = sin(_q.h) * dx + cos(_q.h) * dz < 0, sc = (abs(_q.x) < 7 ? 30 : 0) + (app ? 60 : 0) + rnd() * 20; if (sc > bs) { bs = sc; best = s; } if (app && ++found >= 6) break; } return best; }   /* heading towards the player: it drives past him instead of straight back out of range */
  function place(c, path, initial) { const t = c.tf; let p = null, s = -1, lane = 0;
    for (let tries = 0; tries < 4 && s < 0; tries++) { let li; if (path) { p = path; li = path === g.paths.loopA ? 0 : (rnd() < .5 ? 1 : 2); } else { li = laneFor(); p = PTH(LANES[li][0]); if (!p) { li = rnd() < .4 ? 0 : rnd() < .5 ? 1 : 2; p = PTH(LANES[li][0]); } } lane = LANES[li][1];
      s = initial ? findSpot(p, tries ? 20 : 30, 136, false) : findSpot(p, tries > 1 ? 70 : SP0, tries > 1 ? 137 : SP1, tries < 3); }
    if (s < 0 || !p) return false; SIM.placeOnPath(c, p, s); t.s = s; t.lane = c.cop ? 0 : lane; t.off = t.offT = c.cop ? 0 : laneOff(c, t) * aveK(c.x, c.z); c.x -= cos(c.h) * t.off; c.z += sin(c.h) * t.off;
    c.v = c.cruise * .85; t.st = 'cruise'; t.slot = null; t.blockT = t.honks = t.hornT = t.slowT = t.yieldT = t.sh = 0; t.ind = 0; c.scare = 0; c.rushT = 0; c.held = 0; c.lights.hazard = c.lights.left = c.lights.right = false; c.revT = 0; c.px = c.pz = c.yk = 0;
    if (c.cop) { c.path = p; c.s = s; } if (c.veh && c.veh.group) { c.veh.group.position.set(c.x, c.y, c.z); c.veh.group.rotation.set(0, c.h, 0); } gAdd(c, c.x, c.z); return true; }   /* into the hash now: the next car placed this frame must see it */
  /** the lane furthest under its share among the cars near the player */
  const LN = [0, 0, 0, 0, 0, 0];
  function laneKey(c) { const p = c.path, J = JP(); return p === g.paths.loopA ? 0 : p === g.paths.loopB ? (c.tf.lane ? 2 : 1) : p === J[0] ? 3 : p === J[1] ? (c.tf.lane ? 5 : 4) : 0; }
  function laneFor() { LN.fill(0); let n = 0; for (const c of S.cars) { if (!c.alive || !c.tf || c.tf.ring > 2) continue; LN[laneKey(c)]++; n++; } const jp = JP().length === 2; let best = 0, bs = -1e9;
    for (let i = 0; i < LANES.length; i++) { if (i >= 3 && !jp) continue; const sc = LANES[i][2] - LN[i] / max(1, n) + rnd() * .04; if (sc > bs) { bs = sc; best = i; } } return best; }
  /** the first frames: every car somewhere on a lane within 135 m (no view test: this happens behind the loading art or in the first second) */
  function spread() { for (const c of S.cars) if (c.alive && G.traffic.indexOf(c) >= 0 && c !== P.ent) place(c, null, true); }

  /* ---------------------------------------------------------------- the frame prologue */
  function pre(dt) { const t0 = performance.now(); if (!S.on) return; S.t += dt;
    if (!S.ready) { if (!setup()) return; }
    S.frame++; const cam = g.camera, menu = G.phase !== 'play'; if (menu && cam) { S.focus.x = cam.position.x; S.focus.z = cam.position.z; } else { S.focus.x = P.x; S.focus.z = P.z; }
    if (cam) { const e = cam.matrixWorld.elements, fx = -e[8], fz = -e[10], l = hyp(fx, fz) || 1; S.focus.fx = fx / l; S.focus.fz = fz / l; }
    gClear(); for (let i = 0; i < G.ents.length; i++) { const e = G.ents[i]; if (e.alive) gAdd(e, e.x, e.z); }
    if (P.mode === 'foot') { PL.x = P.x; PL.z = P.z; PL.v = P.speed || 0; PL.h = P.h; gAdd(PL, P.x, P.z); }
    const pop = G.pop; if (pop && pop.list) for (let i = 0; i < pop.list.length; i++) { const n = pop.list[i]; if (!n.active || n.vis === false || n.dist > 120 || n.ko || n.y > 1.2) continue; if (abs(n.x) < 7.2 || (n.x > 140 && n.x < 160) || abs(abs(n.z) - 160) < 7 || (abs(n.z + 95) < 6.5 && n.x > 6 && n.x < 160)) gAdd(n, n.x, n.z); }   /* people near a carriageway (the avenue, Palmera Ave, the cross streets, Lantern St) */
    SIR.length = 0; for (const k of G.cops) if (k.alive && k.lights && k.lights.siren && hyp(k.x - S.focus.x, k.z - S.focus.z) < 200) SIR.push(k);
    /* spawn queue, two a frame */
    for (let k = 0; k < 2 && S.spawnQ.length; k++) { try { make(S.spawnQ.shift()); } catch (e) { console.warn('[traffic] spawn', e); } }
    /* cars cngame added on its own (a replacement after a 抢车): ours if they fit the mix, else swapped for the type that is short */
    if ((S.adT = (S.adT || 0) - dt) <= 0) { S.adT = 1; for (const e of G.traffic) { if (e.tf || e.two || e.cop) continue; const a = archOf(e); if (a) adopt(e, a); else { const cnt = {}; for (const k of ORDER) cnt[k] = 0; for (const c of S.cars) if (c.alive && c.tf) cnt[c.tf.id] = (cnt[c.tf.id] || 0) + 1; let need = 'retro', gap = -9; for (const k of ORDER) { const d = ARCH[k].n - cnt[k]; if (d > gap) { gap = d; need = k; } } try { SIM.removeEnt(e); } catch (err) { /* gone */ } S.spawnQ.push(need); } break; } }
    /* the pool: cars past 140 m come back 105–135 m away, out of view (three a frame); jacked and destroyed ones leave the list */
    for (let i = S.cars.length - 1; i >= 0; i--) { const c = S.cars[i]; if (!c.alive || G.traffic.indexOf(c) < 0) { if (c.tfLite) unlite(c); if (c.tf && c.tf.slot) freeSlot(c.tf); S.cars.splice(i, 1); } }
    /* at the wheel the pool runs 17 cars round the player (the street goes by fast, and the frame needs the room); the rest wait on the far side of the loop, still, unseen */
    { const cap = P.mode === 'car' ? (+QS.get('tfcap') || 17) : 999; let act = 0; for (const c of S.cars) if (c.alive && !c.tf.away) act++;
      if (act > cap) { for (const c of S.cars) { if (act <= cap) break; const t = c.tf; if (t.away || c === P.ent || t.st !== 'cruise' || t.ring < 2 || seen(c)) continue; parkFar(c); t.away = true; c.v = 0; act--; } }
      else if (act < cap) { for (const c of S.cars) if (c.tf.away) { c.tf.away = false; c.tf.ring = 3; break; } } }
    let rec = 0; for (const c of S.cars) { const t = c.tf; if (t.away) { if (hyp(c.x - S.focus.x, c.z - S.focus.z) < 170) parkFar(c); continue; } if (rec >= 3 || t.ring < 3 || c === P.ent || c.held) continue; if (seen(c) && hyp(c.x - S.focus.x, c.z - S.focus.z) < 170) continue;   /* not while it is in the picture */ if (t.slot) freeSlot(t); if (place(c, null, false)) { rec++; S.recycled++; t.ring = 2; } }
    for (const c of S.cops) { if (!c.alive || !c.cop) continue; const K = c.cop, d = hyp(c.x - S.focus.x, c.z - S.focus.z); c.tf.ring = d < R0 ? 0 : d < R1 ? 1 : d < R2 ? 2 : 3;
      if (!c.path) parkFar(c); if (K.state === 'patrol' && !K.crew && c.tf.ring === 3 && rec < 3) { if (place(c, g.paths[K.loop], false)) { rec++; S.recycled++; } }
      if (K.state === 'patrol' && g.wanted.stars > 0 && !K.crew) { K.state = 'respond'; K.nav = null; } }   /* dispatch: on a call the patrol units nearby respond (cngame's policeStep counts them as units out) */
    kerbStep(dt); radios(dt); drivers(dt); S.ms += performance.now() - t0; }
  /* drivers: cngame seats one in every car that comes within 36 m (a figure built on the spot). With the whole pool near the player that meant a build every few frames while
     driving, so they are seated here ahead of time, one every quarter second, from a handful of looks (the figures share geometry); and nobody at the wheel is drawn past 35 m
     (55 m in an open-top), where the glass hides him anyway. */
  const DRV = ['office_m', 'local_m', 'local_f', 'office_f', 'uncle', 'student'];
  function drivers(dt) { if ((S.drvT = (S.drvT || 0) - dt) > 0 || !GT.people || !GT.people.make || !G.visual || !G.pop) return; S.drvT = .25;
    for (const c of S.cars) { if (!c.alive || c.rider || c.noDrv || c.two || !c.veh || !c.veh.group || c === P.ent) continue; c.noDrv = true; let f = null; const ty = DRV[c.id % DRV.length];
      try { f = GT.people.make(ty, { seed: (c.id % 4) * 5 + 1, phone: false }); } catch (e) { f = null; } if (!f || !f.group) return;
      const d = c.dims, ey = d.eye ? (Array.isArray(d.eye) ? { x: d.eye[0], y: d.eye[1], z: d.eye[2] } : d.eye) : { x: .37, y: d.H - .28, z: -d.L * .05 }; f.group.position.set(+ey.x || 0, (+ey.y || 1.2) - 1.46, (+ey.z || 0) - .06); c.veh.group.add(f.group);
      c.rider = f; c.riderType = ty; c.riderState = 'drive'; try { f.update(0, { state: 'drive', snap: true }); f.update(.3, { state: 'drive' }); c.riderBad = true; } catch (e) { /* pose next frame */ } f.group.visible = false;   /* riderBad: a seated driver keeps that pose, cngame need not re-pose him every frame */ S.drivers = (S.drivers || 0) + 1; return; } }
  /** sun shadows only for the cars near the player (< 45 m): every caster is drawn once more per shadow cascade, and 25 cars at ~65k triangles each cost more there than they
      give back; the contact shadow under each body (cnvehicles' ground-fx mesh) stays at every distance */
  function shadowVis(c, d) { const t = c.tf; if (!t.casters) { t.casters = []; c.veh.group.traverse(o => { if (o.isMesh && o.castShadow) t.casters.push(o); }); t.cast = true; } const sd = P.mode === 'car' ? 26 : 45, on = t.cast ? d < sd + 3 : d < sd; if (on === t.cast) return; t.cast = on; for (const m of t.casters) m.castShadow = on; }
  function driverVis(c, d) { const r = c.rider; if (!r || !r.group || c.tfLite) return; const far = (c.tf && c.tf.a.radio ? 55 : 35) * (P.mode === 'car' ? .6 : 1), on = r.group.visible ? d < far + 3 : d < far; if (r.group.visible !== on) r.group.visible = on; }

  const seen = c => { const dx = c.x - S.focus.x, dz = c.z - S.focus.z, d = hyp(dx, dz) || 1; return G.phase === 'play' && (dx * S.focus.fx + dz * S.focus.fz) / d > .55; };
  /* ---------------------------------------------------------------- one car */
  function drive(c, vT, dt) { const t0 = performance.now(), t = c.tf; if (!t || !S.ready) { if (c.path) SIM.followPath(c, vT, dt); return; } if (!c.path) parkFar(c); if (t.away) { c.v = 0; c.tfLite = true; return; }
    const d = hyp(c.x - S.focus.x, c.z - S.focus.z), ring = d < R0 ? 0 : d < R1 ? 1 : d < R2 ? 2 : 3; t.ring = ring; S.ring[ring]++;
    t.hornT -= dt; t.chT -= dt; t.yieldT -= dt; t.launch -= dt; t.hitT -= dt; if (t.ind > 0) { t.ind -= dt; if (t.ind <= 0) { c.lights.left = c.lights.right = false; } }
    if (c.veh && c.veh.group && ((S.frame + c.id) & 7) === 0) { shadowVis(c, d); c.tfFar = P.mode === 'car' ? 118 : 0; }   /* at the wheel: sun shadows to 26 m and the pool's cars drawn to 118 m (cngame reads e.tfFar) */
    if (ring >= 2 && t.st === 'cruise' && !c.held && c !== P.ent) lite(c, t, vT, dt);
    else { if (c.tfLite) unlite(c); driverVis(c, d); if (ring === 1 && ((S.frame + c.id) & 1) && t.st === 'cruise') coastStep(c, t, dt); else full(c, t, vT, dt, ring === 0); }
    S.msF += performance.now() - t0; }
  function unlite(c) { c.tfLite = false; c.steer = 0; }   /* the driver comes back with driverVis */
  /** 80–140 m: on rails at 10 Hz, moved every frame, no animation */
  function lite(c, t, vT, dt) { if (!c.tfLite) { c.tfLite = true; if (c.rider && c.rider.group) c.rider.group.visible = false; t.lite = 0; t.vL = c.v; }
    t.lite -= dt; if (t.lite <= 0) { t.lite = .1; let v = min(vT, c.cruise); v = sigLimit(c, v, 999); let lead = 99; const f = sin(c.h), gg = cos(c.h);
      gQuery(c.x + f * 9 - 9, c.z + gg * 9 - 9, c.x + f * 9 + 9, c.z + gg * 9 + 9, o => { if (o === c || !o.dims) return; const dx = o.x - c.x, dz = o.z - c.z, a = dx * f + dz * gg; if (a < 1 || a > 18 || abs(dx * gg - dz * f) > 1.4) return; const gap = a - (c.dims.L + o.dims.L) / 2; if (gap < lead) lead = gap; });
      if (lead < 99) v = min(v, max(0, (lead - 3) * .8)); t.vL = v; }
    c.v += cl(t.vL - c.v, -6 * dt, 2.5 * dt); t.s += c.v * dt; const p = c.path; pathAt(p, t.s, _q); t.offT = laneOff(c, t) * aveK(_q.x, _q.z); t.off += cl(t.offT - t.off, -dt, dt);
    c.x = _q.x - cos(_q.h) * t.off; c.z = _q.z + sin(_q.h) * t.off; c.h = _q.h; c.s = t.s; c.steer = 0; c.brakeOn = false; const gr = c.veh && c.veh.group; if (gr) { gr.position.set(c.x, c.y, c.z); gr.rotation.set(0, c.h, 0); } }
  /** 30–80 m, every other frame: keep going with the last speed and steer */
  function coastStep(c, t, dt) { const wb = c.dims.wheelbase || 2.6; c.h += c.v * Math.tan(c.steer) / wb * dt; c.x += sin(c.h) * c.v * dt; c.z += cos(c.h) * c.v * dt; t.s += c.v * dt * .98; }

  /** traffic lights (GT.cnroad.signals, same rule as cngame's own) */
  function sigLimit(c, vT, reach) { if (abs(c.x) > 8.4 || abs(sin(c.h)) > .5) return vT; const SG = GT.cnroad && GT.cnroad.signals; if (!SG || !SG.stopFor) return vT; let st = null; const dir = cos(c.h) > 0 ? 1 : -1;
    try { st = SG.stopFor(c.z + dir * c.dims.L / 2, dir); } catch (e) { return vT; } if (!st || st.car === 'green' || st.dist > min(reach || 46, 46)) return vT; if (st.car === 'amber' && st.dist < abs(c.v) * 1.15) return vT; c.atLight = true; return min(vT, max(0, (st.dist - .7) * .85)); }
  function curveLimit(c, t, s) { const p = c.path; let lim = 99; pathAt(p, s, _q); const h0 = _q.h; for (const dd of [6, 14, 24]) { pathAt(p, s + dd, _q2); const th = abs(adiff(h0, _q2.h)); if (th < .06) continue; lim = min(lim, sqrt(t.a.latA * dd / th) + 1.5); } return max(3.2, lim); }

  /* probes: centre and ±15°, max(6, v × 1.25) m past the front bumper */
  const PR = { d: 99, v: 0, kind: 0, o: null, b: 0, eL: 0, sd: 99, sk: 0, so: null };
  function probes(c, t, full) { const f = sin(c.h), gg = cos(c.h), hl = c.dims.L / 2, hw = c.dims.W / 2, sp = abs(c.v), Lp = max(6, sp * 1.25), bx = c.x + f * hl, bz = c.z + gg * hl, corr = hw * .8, reach = Lp + 3.2;   /* lanes are 2.1 m apart and cars 2 m wide: the corridor is a little narrower than the car, so the next lane and the parked row never count as 'in my path' */
    PR.d = 99; PR.v = 0; PR.kind = 0; PR.o = null; PR.sd = 99; PR.sk = 0; PR.so = null;
    const x0 = min(bx, bx + f * reach) - reach * S15 - 3, x1 = max(bx, bx + f * reach) + reach * S15 + 3, z0 = min(bz, bz + gg * reach) - reach * S15 - 3, z1 = max(bz, bz + gg * reach) + reach * S15 + 3;
    gQuery(x0, z0, x1, z1, o => { if (o === c) return; const dx = o.x - bx, dz = o.z - bz, a = dx * f + dz * gg, b = dx * gg - dz * f; if (a < -3.5 || a > reach) return;
      let eA = .35, eL = .35, kind = 2, ov = 0; if (o.dims) { const dh = adiff(c.h, o.h), ca = abs(cos(dh)), sa = abs(sin(dh)); eA = o.dims.L / 2 * ca + o.dims.W / 2 * sa; eL = (o.dims.L / 2 * sa + o.dims.W / 2 * ca) * .92; kind = 1; ov = (o.v || 0) * cos(dh); }
      else if (o.isPlayer) { kind = 3; ov = 0; } else { ov = 0; kind = 2; }
      const hd = a - eA; if (hd > Lp) return;
      /* centre ray: anything in my path */
      if (abs(b) - eL < corr && a + eA > -1.2) { if (hd < PR.d) { PR.d = hd; PR.v = ov; PR.kind = kind; PR.o = o; PR.b = b; PR.eL = eL; } return; }
      if (!full) return;
      /* side rays: only what is moving into my path */
      const side = b > 0 ? 1 : -1, ry = max(0, a) * T15 + .3; if (abs(b) - eL > ry + corr) return;
      let entering = false; if (kind === 2 || kind === 3) { const inRoad = abs(o.x) < 6.5 || (o.x > 145 && o.x < 156) || abs(abs(o.z) - 162) < 4.5 || (abs(o.z + 95) < 4.2 && o.x > 6.5 && o.x < 150); entering = inRoad; }
      else if (o.tf && (o.tf.st === 'out' || o.tf.back > 0)) entering = true; else if (o.mode !== 'parked' && abs(o.v || 0) > .5) { const lat = (o.v || 0) * (sin(o.h) * gg - cos(o.h) * f); entering = lat * side < -.6; }
      if (entering && hd < PR.sd) { PR.sd = hd; PR.sk = kind; PR.so = o; } });
    return PR; }

  function full(c, t, vT, dt, ring0) { const A = t.a; if (!c.path) parkFar(c); const p = c.path;
    t.s = proj(p, t.s, c.x, c.z); c.s = t.s; c.atLight = false; const sp = abs(c.v), f = sin(c.h), gg = cos(c.h); pathAt(p, t.s, _q); const ave = aveK(_q.x, _q.z);
    if ((t.curveT -= dt) <= 0) { t.curveT = .3; t.curveV = curveLimit(c, t, t.s); } vT = min(vT, t.curveV);
    /* kerb manoeuvres own the car until it is back in its lane */
    if (t.st !== 'cruise') { kerbCar(c, t, vT, dt); return; }
    let offT = laneOff(c, t) * ave;
    if (A.shoulder && ave > .9) { t.shT -= dt; if (t.shT <= 0) { t.sh = t.sh ? 0 : 1; t.shT = t.sh ? 3 + rnd() * 3 : 30 + rnd() * 50; } if (t.sh) offT += OFF.SHOULDER * (SB(c.path) && !t.lane ? 0 : 1); }
    /* sirens */
    let yk = 0; for (const k of SIR) { if (k === c) continue; const dx = k.x - c.x, dz = k.z - c.z, dd = hyp(dx, dz); if (dd > 55) continue; const rel = dx * f + dz * gg, same = cos(adiff(c.h, k.h));
      if (same > .4 && rel < 5 && rel > -55) yk = max(yk, rel > -24 ? 2 : 1); else if (same < -.4 && rel > 0) yk = max(yk, 1); else if (dd < 22) yk = max(yk, 1); }
    if (yk) { if (t.yieldT <= 0) S.yields++; t.yieldT = 1.6; t.yk = yk; } if (t.yieldT > 0) { offT = (SB(c.path) ? OFF.SP : OFF.NP) * ave; vT = min(vT, t.yk === 2 ? (abs(t.off - offT) > .3 ? 1.8 : 0) : 3);   /* close behind: creep over to the kerb first, then stop */ c.lights.right = (S.t % .8) < .4; c.lights.left = false; t.ind = .3; }
    vT = sigLimit(c, vT);
    const pr = probes(c, t, ring0); let blk = 0; t.pk = pr.kind; t.pd = pr.d; t.po = pr.o ? (pr.o.id || (pr.o.isPlayer ? 'P' : 'ped')) : 0; t.psk = pr.sk;   /* last probe, for stats / debugging */
    if (pr.kind === 1) { const o = pr.o, vl = max(0, pr.v), gap0 = 1.4 + A.gapT * sp, vf = vl + (pr.d - gap0) * .9, vs = sqrt(2 * A.brk * max(0, pr.d - 1)) + vl * .9; vT = min(vT, max(0, min(vf, vs))); if (pr.d < .6) vT = 0;
      /* changing lanes round it: if it does not stand in the lane I am moving into, creep past instead of waiting for ever */
      const bT = -(offT - t.off); if (abs(offT - t.off) > .3 && abs(pr.b - bT) > pr.eL + hwOf(c) * .8 && pr.d > .5 && SB(c.path)) vT = max(vT, min(2.4, pr.d * .9, c.cruise));
      if (vl < .6 && !o.atLight && !c.atLight) blk = o === (P && P.ent) ? 4 : o.tf && o.tf.st !== 'cruise' ? 0 : 3; if (vl < c.cruise * .55 && vl > .6 && !c.atLight) t.slowT += dt; else t.slowT = 0; }
    else t.slowT = 0;
    if (pr.kind === 2 || pr.kind === 3) { vT = min(vT, pr.d < 2.4 ? 0 : sqrt(2 * A.brk * max(0, pr.d - 2.2))); if (sp > .5 && pr.d < 6 && t.hitT <= 0) { S.pedBrakes++; t.hitT = 3; } blk = pr.kind === 3 ? 2 : 1;
      if (pr.d < .25 && sp > 2.5 && pr.kind === 2 && t.hitT < 2.5) bump(c, pr.o); }
    if (pr.sk) { const o = pr.so; vT = min(vT, pr.sk === 1 && o.tf && (o.tf.st === 'out' || o.tf.back > 0) ? 0 : sqrt(2 * A.brk * max(0, pr.sd - .8)) + 1.5); }
    /* lane changes: the hotel side has two */
    if (SB(c.path) && ave > .98 && t.chT <= 0 && t.yieldT <= 0) laneChange(c, t, pr, sp);
    /* steer for the lane centre ahead, offset sideways */
    t.off += cl(offT - t.off, -A.latV * dt, A.latV * dt); const look = 4.5 + sp * .6; pathAt(p, t.s + look, _q2); const tx = _q2.x - cos(_q2.h) * t.off, tz = _q2.z + sin(_q2.h) * t.off;
    const v0 = c.v; SIM.aiDrive(c, tx, tz, vT, dt);
    /* character: launch, acceleration, braking */
    if (vT > c.v + .2) { const extra = (A.acc - 2.6) + (t.launch > 0 ? 2.2 : 0); if (extra > 0) c.v = min(vT, c.v + extra * dt); }
    if (v0 < .3 && vT > 3) { if (t.stopT > 1 && A.id === 'retro' && t.ring === 0 && GT.samples && GT.samples.blip) { t.launch = 1.4; try { GT.samples.blip('eng_muscle_mid', { x: c.x, z: c.z, g: .75, rate0: .75, rate1: 1.35, dur: 1.2 }); } catch (e) { /* no audio */ } } t.stopT = 0; } else if (abs(c.v) < .3) t.stopT += dt;
    if (ring0) SIM.aiCollideWorld(c);
    /* horns: something sits in the lane and does not move */
    if (blk) t.blockT += dt; else { t.blockT = 0; if (t.hornT < -4) t.honks = 0; }
    /* who honks: at the player (on foot or in a car standing in the lane) and at people in the road, everyone, again and again, slower after the third; at a stalled car ahead
       only the muscle cars keep at it, the rest give it one go (a queue behind one blocked car is not a choir) */
    const q3 = blk === 3 && A.id !== 'muscle'; if (blk && t.blockT > A.hornD * (q3 ? 2.5 : 1) && t.hornT <= 0 && t.ring <= 1 && !c.atLight && !(q3 && t.honks >= 1)) { honk(c, blk === 3 ? .35 : .5); t.hornT = A.hornRep * (.8 + rnd() * .5) * (t.honks >= 3 ? 2 : 1); t.honks++; if (blk !== 3 && t.honks >= 2 && t.honks % 2 === 0) rage(c); }
    else if (A.id === 'muscle' && t.slowT > 3 && t.hornT <= 0 && t.ring <= 1) { honk(c, .3); t.hornT = 5 + rnd() * 4; t.slowT = 0; }
    kerbChance(c, t, dt); }

  function laneChange(c, t, pr, sp) { const A = t.a, want = t.lane ? 0 : 1, lead = pr.kind === 1 && pr.d < 16 ? pr : null, slowLead = lead && (lead.v < c.cruise - (A.id === 'muscle' ? 1 : 2.6) || (lead.o.tf && lead.o.tf.st !== 'cruise'));
    let go = false; if (t.lane === 1 && slowLead) go = true; else if (t.lane === 0 && !lead && rnd() < A.slowLane * .02) go = true; else if (t.lane === 0 && A.id !== 'muscle' && rnd() < .004 * A.slowLane) go = true; else if (t.lane === 1 && A.id === 'muscle' && rnd() < .01) go = true;
    if (!go) return; const tOff = want ? OFF.S : OFF.F, f = sin(c.h), gg = cos(c.h), back = A.id === 'muscle' ? 4.5 : 8 + sp * .6, front = A.id === 'muscle' ? 5.5 : 9; let free = true;
    gQuery(c.x - 20, c.z - 20, c.x + 20, c.z + 20, o => { if (!free || o === c || !o.dims) return; const dx = o.x - c.x, dz = o.z - c.z, a = dx * f + dz * gg, lat = -(dx * gg - dz * f) + t.off; if (abs(lat - tOff) > 1.7) return; if (a > -back - (o.v || 0) * .8 && a < front) free = false; });
    if (!free) { t.chT = .6; return; } t.lane = want; t.chT = A.id === 'muscle' ? 2.5 + rnd() * 3 : 6 + rnd() * 8; S.laneCh++; const toLeft = tOff < t.off; c.lights.left = toLeft; c.lights.right = !toLeft; t.ind = 1.8;
    if (A.id === 'muscle' && lead && lead.d < 9 && t.ring <= 1 && rnd() < .5) honk(c, .25); }

  const hwOf = c => (c.dims && c.dims.W || 1.9) / 2;
  /* horn: the recorded honk at the car (cngame's 'honk' event) and the people in front step back */
  function honk(c, dur) { S.honks++; try { g.emit('honk', { ent: c, x: c.x, z: c.z }); } catch (e) { /* no listener */ } const pop = G.pop; if (pop && pop.emit) try { pop.emit('horn', c.x + sin(c.h) * 6, c.z + cos(c.h) * 6, 8, 1.5); } catch (e) { /* crowd off */ } }
  function rage(c) { const t = c.tf; if (t.rageT > S.t) return; t.rageT = S.t + 9; S.rage++; if (GT.peds && GT.peds.bark) try { GT.peds.bark('road', c.x, c.z, { voice: (c.id % 2 ? 'm' : 'f') + (c.id % 3 ? 'A' : 'Y'), from: c }); } catch (e) { /* no barks */ } }
  /** a pedestrian the brakes did not save: down he goes (cngame's crowd does the rest: fall, get up, run or phone it in) */
  function bump(c, n) { const pop = G.pop; if (!pop || !pop.hurt || !n || !n.def) return; c.tf.hitT = 3; try { pop.hurt(n, 10 + abs(c.v) * 3, sin(c.h), cos(c.h), { down: abs(c.v) > 3.5, push: 1.5 + abs(c.v) * .4, quiet: false }); pop.emit('crash', n.x, n.z, 14, 3); } catch (e) { /* crowd off */ } }

  /* ---------------------------------------------------------------- the kerb: drop-offs at the hotels and short stops in the gaps between parked cars, reversing out */
  function freeSlot(t) { const k = t.slot; if (!k) return; if (k.car) k.car = null; if (k.dropSlot) { const s = k.dropSlot; if (s.car) s.car = null; s.st = 'free'; s.open = false; s.done = false; s.cool = 15; } t.slot = null; }
  function kerbChance(c, t, dt) { if (t.ring > 1 || c.cop || c === P.ent || t.yieldT > 0) return; t.kerbT -= dt; const A = t.a, f = sin(c.h), gg = cos(c.h), side = SB(c.path) ? 1 : 0;
    if (side && !t.lane) return; if (t.kerbT > 0) return; t.kerbT = 4 + rnd() * 6;
    const busy = S.cars.filter(o => o.tf && o.tf.st !== 'cruise' && o.tf.ring <= 1).length; if (busy >= 3) return;
    let best = null, bd = 1e9; for (const k of S.kerb) { if (k.side !== side || k.car || k.cool > 0) continue; const a = (k.x - c.x) * f + (k.z - c.z) * gg; if (a < 14 || a > 45) continue; const ds = k.drop ? S.slots.find(s => s.kerb === k) : null;
      if (k.drop ? !(ds && ds.st === 'free' && ds.cool <= 0 && (A.id === 'conv' || A.id === 'retro' || A.id === 'suv') && rnd() < .7) : rnd() > .22) continue; if (a < bd) { bd = a; best = k; } }
    if (!best) return; let occ = false; gQuery(best.x - 6, best.z - 6, best.x + 6, best.z + 6, o => { if (o !== c && o.dims && abs(o.x - best.x) < 1.6 && abs(o.z - best.z) < 5.2) occ = true; }); if (occ) { best.cool = 20; return; }
    best.car = c; t.slot = best; t.st = 'pull'; t.dwell = 0; S.pulls++; c.lights.right = true; c.lights.left = false; t.ind = 99; if (best.drop) { const ds = S.slots.find(s => s.kerb === best); best.dropSlot = ds; ds.car = c; ds.st = 'arriving'; ds.t = 0; } }
  function kerbCar(c, t, vT, dt) { const k = t.slot, A = t.a, p = c.path, f = sin(c.h), gg = cos(c.h); if (!k) { t.st = 'cruise'; return; }
    const a = (k.x - c.x) * f + (k.z - c.z) * gg, lat = (k.x - c.x) * cos(c.h) * -1 + (k.z - c.z) * sin(c.h);
    if (t.st === 'pull') { const offT = OFF.KERB * (a < 22 ? 1 : 0); t.off += cl(offT - t.off, -1.25 * dt, 1.25 * dt); vT = min(vT, a < .4 ? 0 : sqrt(2 * 1.8 * max(0, a - .3)) + .2, 6); vT = sigLimit(c, vT);
      const pr = probes(c, t, false); if (pr.kind && pr.d < 6) vT = min(vT, max(0, pr.d - 1.5));
      pathAt(p, t.s + 3.5 + abs(c.v) * .5, _q2); SIM.aiDrive(c, _q2.x - cos(_q2.h) * t.off, _q2.z + sin(_q2.h) * t.off, vT, dt); t.s = proj(p, t.s, c.x, c.z); c.s = t.s;
      if (a < .7 && abs(c.v) < .25 && abs(lat) < .7) { t.st = 'dwell'; t.dwell = k.drop ? 9 + rnd() * 4 : 12 + rnd() * 18; c.v = 0; c.lights.right = false; t.ind = 0; c.lights.hazard = !!k.drop; if (k.drop) { S.drops++; k.dropSlot.st = 'dwell'; k.dropSlot.t = 0; } else S.parks++; }
      else if (a < -3 || t.ring >= 2) { freeSlot(t); t.st = 'cruise'; c.lights.right = false; t.ind = 0; } return; }
    if (t.st === 'dwell') { c.v = 0; c.brakeOn = false; c.lights.brake = false; t.dwell -= dt; const ds = k.dropSlot; if (ds) ds.t += dt; const waitV = ds && ds.valet && !ds.done && t.dwell > -12;   /* a valet on the way: wait for him (up to 12 s more) */
      if (t.dwell <= 0 && !waitV) { t.st = 'out'; t.back = 0; let tight = false; gQuery(c.x - 8, c.z - 8, c.x + 8, c.z + 8, o => { if (o !== c && o.dims && o.mode === 'parked' && abs(o.x - c.x) < 1.2) { const fa = (o.x - c.x) * f + (o.z - c.z) * gg; if (fa > 0 && fa < c.dims.L / 2 + o.dims.L / 2 + 1.6) tight = true; } }); if (tight) t.back = 1.1; c.lights.hazard = false; c.lights.left = true; c.lights.right = false; t.ind = 99; S.outs++; if (ds) { ds.st = 'leaving'; } } return; }
    if (t.st === 'out') { if (t.back > 0) { const v = 1.1; c.x -= f * v * dt; c.z -= gg * v * dt; c.v = -v; t.back -= v * dt; c.lights.brake = false; return; }
      /* wait for a gap in the lane behind, then merge */
      let clear = true; const bOff = laneOff(c, t) * aveK(c.x, c.z); gQuery(c.x - 30, c.z - 30, c.x + 30, c.z + 30, o => { if (!clear || o === c || !o.dims || o.mode === 'parked') return; const dx = o.x - c.x, dz = o.z - c.z, al = dx * f + dz * gg, lt = -(dx * gg - dz * f) + t.off; if (abs(lt - bOff) > 2 || al > 6 || al < -26) return; if ((o.v || 0) > 1 || al > -5) clear = false; });   /* a car standing behind is letting me out; one beside me is not */
      if (!clear && t.dwell > -6) { t.dwell -= dt; c.v = 0; return; } t.off += cl(bOff - t.off, -1.1 * dt, 1.1 * dt); pathAt(p, t.s + 5 + abs(c.v) * .5, _q2); SIM.aiDrive(c, _q2.x - cos(_q2.h) * t.off, _q2.z + sin(_q2.h) * t.off, min(vT, 5), dt); t.s = proj(p, t.s, c.x, c.z); c.s = t.s;
      if (abs(t.off - bOff) < .2) { freeSlot(t); k.cool = 25; t.st = 'cruise'; c.lights.left = false; t.ind = 0; t.kerbT = 40 + rnd() * 40; } } }
  function kerbStep(dt) { for (const k of S.kerb) if (k.cool > 0) k.cool -= dt; for (const s of S.slots) { if (s.cool > 0) s.cool -= dt; if (s.car && (!s.car.alive || !s.car.tf || s.car.tf.slot !== s.kerb)) { s.car = null; s.st = 'free'; s.open = false; s.done = false; } } }

  /* ---------------------------------------------------------------- the open-tops play the radio (the muffled club bed, js/samples.js loopAt), the two nearest within 22 m */
  function radios(dt) { if ((S.radT -= dt) > 0) { for (let i = 0; i < 2; i++) { const R = S.radios[i]; if (R && R.c.alive) R.h.move(R.c.x, R.c.z); } return; } S.radT = .25; const Sm = GT.samples; if (!Sm || !Sm.loopAt || !Sm.ready) return;
    const L = S.focus; RAD.length = 0; for (const c of S.cars) if (c.alive && c.tf && c.tf.a.radio && c !== P.ent) { const d = hyp(c.x - L.x, c.z - L.z); if (d < 22) RAD.push(c); } RAD.sort((a, b) => hyp(a.x - L.x, a.z - L.z) - hyp(b.x - L.x, b.z - L.z)); RAD.length = min(RAD.length, 2);
    for (let i = 0; i < 2; i++) { const R = S.radios[i]; if (R && (RAD.indexOf(R.c) < 0 || !R.c.alive)) { R.h.stop(); S.radios[i] = null; } }
    for (const c of RAD) { if (S.radios.some(R => R && R.c === c)) continue; const i = S.radios[0] ? 1 : 0; if (S.radios[i]) continue; const h = Sm.loopAt('amb_bar_music', { x: c.x, z: c.z, g: .55, lvl: .32, ref: 3.5, rate: .96 + (c.id % 5) * .02 }); if (h) S.radios[i] = { c, h }; } }

  /** test / staging helper: put an open-top in the slow lane 34 m before drop-off bay i, already pulling in (the valet of js/peds.js takes it from there) */
  function stageDrop(i) { const sl = S.slots[i || 0]; if (!sl || !S.ready) return null; let c = null, bd = 1e9; for (const o of S.cars) { if (!o.alive || !o.tf || o === P.ent || o.tf.st !== 'cruise' || !/conv|retro/.test(o.tf.id)) continue; const d = hyp(o.x - S.focus.x, o.z - S.focus.z); if (d > 40 && d < bd) { bd = d; c = o; } } if (!c) return null;
    const p = g.paths.loopB, s = g.pathNearest(p, 3.25, sl.z + 34); SIM.placeOnPath(c, p, s); const t = c.tf; t.s = s; t.lane = 1; t.off = t.offT = OFF.S; c.x -= cos(c.h) * t.off; c.z += sin(c.h) * t.off; c.v = 4; if (sl.kerb.car && sl.kerb.car !== c && sl.kerb.car.tf) freeSlot(sl.kerb.car.tf);
    sl.kerb.car = c; t.slot = sl.kerb; sl.kerb.dropSlot = sl; sl.car = c; sl.st = 'arriving'; sl.t = 0; sl.cool = 0; t.st = 'pull'; t.dwell = 0; c.lights.right = true; t.ind = 99; S.pulls++; return c; }
  api.stageDrop = stageDrop;
  function stats() { const r = S.ring.slice(); S.ring[0] = S.ring[1] = S.ring[2] = S.ring[3] = 0; const by = {}; let moving = 0, near = 0; for (const c of S.cars) if (c.alive && c.tf) { by[c.tf.id] = (by[c.tf.id] || 0) + 1; if (abs(c.v) > .5) moving++; if (c.tf.ring < 3) near++; }
    const F = S.focus, parked = G ? G.ents.filter(e => e.alive && e.mode === 'parked' && !e.two && hyp(e.x - F.x, e.z - F.z) < 140).length : 0;
    return { on: S.on, ready: S.ready, cars: S.cars.length, cops: S.cops.filter(c => c.alive).length, copStates: S.cops.map(c => c.cop ? c.cop.state : '-'), within140: near, parked140: parked, moving, by, ringCalls: r, made: S.made, removed: S.removed, adopted: S.adopted, recycled: S.recycled,
      honks: S.honks, rage: S.rage, yields: S.yields, pulls: S.pulls, drops: S.drops, parks: S.parks, outs: S.outs, laneCh: S.laneCh, pedBrakes: S.pedBrakes, kerbSlots: S.kerb.length, dropSlots: S.slots.map(s => s.st + '@' + s.z.toFixed(0)), msPre: +S.ms.toFixed(2), msDrive: +S.msF.toFixed(2), radios: S.radios.filter(Boolean).length,
      lanes: S.cars.reduce((o, c) => { if (c.tf && c.tf.ring < 3) { const k = ['N', 'S-fast', 'S-slow', 'J1', 'J2-fast', 'J2-slow'][laneKey(c)]; o[k] = (o[k] || 0) + 1; } return o; }, {}) }; }

  /* ---------------------------------------------------------------- pure-logic checks for cn.html?selftest=1 (no world needed) */
  function selftest() { const out = [], ok = (b, m) => out.push((b ? 'PASS  ' : 'FAIL  ') + m);
    /* probes on a car heading +Z: a car 9 m ahead in its lane is a centre hit, one parked 3.9 m to the side is not, a person stepping off the kerb 7 m ahead is a side hit */
    const sv = { on: S.on, ready: S.ready }; gClear(); const me = { id: 1, x: 0, z: 0, h: 0, v: 8, dims: { L: 4.5, W: 1.9 }, mode: 'traffic' }, ahead = { id: 2, x: .2, z: 11.5, h: 0, v: 3, dims: { L: 4.5, W: 1.9 }, mode: 'traffic' }, park = { id: 3, x: -3.9, z: 8, h: 0, v: 0, dims: { L: 4.5, W: 1.9 }, mode: 'parked' }, ped = { x: 2.6, z: 9, def: {} };
    for (const o of [me, ahead, park]) gAdd(o, o.x, o.z); const t = { a: ARCH.retro, st: 'cruise' }; let r = probes(me, t, true); ok(r.kind === 1 && r.o === ahead && abs(r.d - 7) < .3 && !r.sk, 'traffic probes: car 11.5 m ahead -> centre hit at ' + r.d.toFixed(2) + ' m past the bumper, the parked row ignored');
    const pr2 = max(6, 8 * 1.25); ok(abs(pr2 - 10) < 1e-9 && max(6, 2 * 1.25) === 6, 'traffic probes: length max(6, v x 1.25) = ' + pr2 + ' m at 8 m/s, 6 m at walking pace');
    gClear(); gAdd(me, 0, 0); gAdd(ped, ped.x, ped.z); r = probes(me, t, true); ok(r.sk === 2 && r.kind === 0, 'traffic probes: a person stepping off the kerb 9 m ahead, 2.6 m aside -> side-probe hit (' + (r.sd < 99 ? r.sd.toFixed(1) : '-') + ' m)');
    gClear(); gAdd(me, 0, 0); ped.x = 7.5; gAdd(ped, ped.x, ped.z); r = probes(me, t, true); ok(!r.sk && !r.kind, 'traffic probes: somebody on the pavement 7.5 m aside is not a hazard');
    /* hash: 500 objects, a 20 m query sees exactly the ones within its cells */
    gClear(); const objs = []; for (let i = 0; i < 500; i++) { const o = { x: (i % 25) * 6 - 70, z: ((i / 25) | 0) * 6 - 60 }; objs.push(o); gAdd(o, o.x, o.z); } let n = 0; gQuery(-10, -10, 10, 10, o => { if (abs(o.x) <= 10 && abs(o.z) <= 10) n++; }); const want = objs.filter(o => abs(o.x) <= 10 && abs(o.z) <= 10).length;
    ok(n === want, 'traffic hash: ' + n + '/' + want + ' found by a 20 m query out of 500'); gClear();
    /* rings */
    const ringOf = d => d < R0 ? 0 : d < R1 ? 1 : d < R2 ? 2 : 3; ok(ringOf(12) === 0 && ringOf(45) === 1 && ringOf(100) === 2 && ringOf(150) === 3, 'traffic rings: 12 / 45 / 100 / 150 m -> full / every other frame / 10 Hz rails / pooled');
    /* lanes and the mix */
    ok(abs(1.9 + OFF.S - 3.25) < .01 && abs(1.9 + OFF.F - 1.15) < .01 && OFF.N === 0 && abs(-1.9 - OFF.NP + 3.55) < .01 && abs(1.9 + OFF.KERB - 5.45) < .01 && 5.45 - 3.25 > 1.9 + .25, 'traffic lanes: hotel-side slow lane x = 3.25, fast lane x = 1.15, northbound x = -1.9 (pulled over for a siren -3.55), kerb slots x = ±5.45 (a car width and a hand clear of the parked row)');
    const mix = ORDER.map(k => ARCH[k].n), tot = mix.reduce((a, b) => a + b, 0) + NCOP; ok(tot >= 25 && tot <= 30 && abs(ARCH.retro.n / tot - .25) < .05 && abs(ARCH.muscle.n / tot - .2) < .05 && abs(ARCH.conv.n / tot - .25) < .05 && abs(ARCH.suv.n / tot - .15) < .05, 'traffic mix: ' + ORDER.map(k => ARCH[k].name + ' ' + ARCH[k].n).join(', ') + ', patrol ' + NCOP);
    ok(ARCH.suv.brk < ARCH.retro.brk && ARCH.suv.latA < ARCH.retro.latA && ARCH.muscle.hornD < ARCH.conv.hornD && ARCH.muscle.latV > ARCH.conv.latV, 'traffic characters: SUV brakes longer and corners slower, muscle honks sooner and changes lanes harder than the open-tops');
    S.on = sv.on; S.ready = sv.ready; return out; }
})();
