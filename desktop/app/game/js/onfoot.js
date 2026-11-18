/* onfoot.js — BILIBILI THEFT AUTO 1 (China edition): the on-foot / in-the-saddle game layer. Owner: onfoot agent.
   Exports (pinned in SPEC-LIFE.md):
     GT.input  = { down(code), pressed(code), axis() -> {x,y}, look:{dx,dy}, consume(code) }          (+ frame(), feed(v), sens, locked — extras)
     GT.wallet = { cash, add(n, why), spend(n) -> bool, on(cb) }                                        (only created if absent)
     GT.act    = { add(spot), remove(id), get(id), list, near(pos, mode) -> spot|null, prompt(spot) -> string }
     GT.onfoot = { create({scene, camera, hero?, partner?: fig|false, dom?, pointerLock?, groundHeight?(x,z)}) -> ctl, addZone(zone), addFloor(floor), zones, floors,
                   ctl (last created), figure(who, given?), query:{groundY,isFree,segHit,segClear,resolve}, refreshColliders(), standIn:{car(), scooter()} }
   ctl: enabled, pos{x,y,z}, h, speed, state, teleport(x,z,h), setCameraYaw(yaw), update(dt), camera{yaw,pitch,dist,shoulder,fov,side,height},
        takeover({update(dt,input)->bool, camera?(dt)->{pos,look,fov}, heroState?, onEnd?, look?, blend?, blendOut?}) -> {end()}, say(who,text,seconds?),
        partner{follow(b),goTo(x,z,then?,{h}?),teleport(x,z,h),state,pos,h,fig}, on('enterCar'|'exitCar'|'mount'|'dismount'|'interact'|'zone'|'step'|'crash', cb), off(name, cb),
        setVehicles(list), mountNow(vehicle), playEnterCar(vehicle, then) / playExitCar(vehicle?, then)   — cars: walk to the door, slide in, camera eases to the driver's eye (first person, the game then sets
          ctl.enabled = false and shows its cockpit); vehicle.twoWheeler: walk to the bike, swing a leg over, hero state 'ride', camera STAYS third person, ctl.riding = vehicle and
          ctl.update keeps running: the hero is pinned to vehicle.seat, the chase camera follows whatever moves vehicle.group (the game, or the built-in ctl.rideAssist arcade physics).
        riding (vehicle | null), ride{speed, steer, lean} (write steer/lean if you drive the bike yourself; hero.update receives them), rideAssist (bool), autoDismount (bool: F prompt when slow)
        view ('fp' | 'tp'; create({view}) default 'tp'; V toggles), setView(v), headPos(out), fpFov
        extras: updateCar(dt,{x,z,h,speed}), hero, heroFig, partnerFig, zone, armed, autoDoors, seated, busy, time, applyCamera(), dispose()
   Ground height: opts.groundHeight -> GT.cnroad.groundHeight -> GT.road.groundHeight -> 0, plus GT.onfoot.addFloor slabs, indoor zone floors and GT.world boxes you can step onto
   (boxes lower than 0.35 m are kerbs; boxes whose top is at/below your feet carry you; boxes TAGGED stair|step|ramp|dock|platform|deck|floor|terrace… can be climbed one 0.35 m riser at a
   time, so a flight of stairs is a row of GT.world.addBox(..., h, 'stair') of rising height; everything else is a wall).
   Conventions (core.js): heading h, forward = (sin h, 0, cos h), right = (-cos h, 0, sin h). Camera yaw uses the same convention; pitch > 0 looks down. Vehicle-local +X is the LEFT side.
   Everything is feature-detected: works with GT.hero.make (hero.js), falls back to GT.people figures, then to a kit-built rider mannequin.
   Self-demo (builds its own back street when the China world modules are not loaded):
     showcase.html?m=onfoot&script=<walk|run|orbit|corner|interact|car|exit|scooter|partner|indoor|stairs|vault|free>&at=<seconds>[&dbg=1][&live=1][&shoulder=L][&aim=1][&crouch=1][&orbit=<rad>][&pillion=1][&px=&pz=&ph=][&t=18.2] */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!T || !GT) return;
  const PI = Math.PI, TAU = PI * 2, HP = PI / 2, sin = Math.sin, cos = Math.cos, abs = Math.abs, hyp = Math.hypot, min = Math.min, max = Math.max;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
  const sst = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
  const approach = (a, b, step) => a < b ? min(b, a + step) : max(b, a - step);
  const safe = (fn, dflt) => { try { return fn(); } catch (e) { safe.last = e; if (!safe.warned) { safe.warned = true; if (window.console) console.warn('[onfoot]', e); } return dflt; } };

  /* ================================================================== GT.input */
  const IN = { keys: new Set(), pend: new Set(), cur: new Set(), pdx: 0, pdy: 0, v: null, latched: false, bound: false, canvas: null, wantLock: false };
  const input = {
    look: { dx: 0, dy: 0 }, sens: .0023, locked: false,
    down(code) { return IN.keys.has(code) || !!(IN.v && IN.v.down && IN.v.down.has(code)); },
    resumeAfterShop() {
      const game = GT.cngame?.G, canvas = IN.canvas;
      if (!canvas || !game || game.phase !== 'play' || game.paused || document.hidden) return;
      IN.shopLook = true;
      game.lockT = performance.now();
      if (!document.pointerLockElement && canvas.requestPointerLock && document.hasFocus()) {
        try { canvas.requestPointerLock()?.catch(() => {}); } catch (e) { /* Unlocked mouse look remains active on the canvas. */ }
      }
    },
    pressed(code) { return IN.cur.has(code); },
    axis() { const d = c => (input.down(c) ? 1 : 0); return { x: clamp(d('KeyD') + d('ArrowRight') - d('KeyA') - d('ArrowLeft'), -1, 1), y: clamp(d('KeyW') + d('ArrowUp') - d('KeyS') - d('ArrowDown'), -1, 1) }; },
    consume(code) { IN.cur.delete(code); },
    /** pt1: drop every press not yet read (held keys stay held) — called when play starts after the menus */
    flush() { IN.pend.clear(); IN.cur.clear(); },
    /** latch one frame of events. ctl.update() calls it automatically; call it yourself (once per frame, before reading) only if no controller is being updated. */
    frame() {
      IN.cur.clear(); for (const c of IN.pend) IN.cur.add(c); IN.pend.clear();
      const fs = GT.front && GT.front.settings, k = input.sens * (fs && fs.sens > 0 ? fs.sens : 1), inv = fs && fs.invertY ? -1 : 1;
      let dx = IN.pdx * k, dy = IN.pdy * k * inv; IN.pdx = IN.pdy = 0;
      if (IN.v) { if (IN.v.press) { for (const c of IN.v.press) IN.cur.add(c); IN.v.press = null; } dx += IN.v.dx || 0; dy += IN.v.dy || 0; IN.v.dx = IN.v.dy = 0; }
      input.look.dx = dx; input.look.dy = dy; IN.latched = true;
    },
    /** scripted / virtual input (showcase, cut-scenes, tests): feed({down:[codes], press:[codes], dx, dy}) — dx/dy in radians; feed(null) clears it. */
    feed(v) { IN.v = v ? { down: new Set(v.down || []), press: v.press ? v.press.slice() : null, dx: v.dx || 0, dy: v.dy || 0 } : null; }
  };
  const mcode = b => b === 0 ? 'Mouse0' : b === 2 ? 'Mouse1' : 'Mouse2';      // Mouse0 = left, Mouse1 = right, Mouse2 = middle
  function bindInput() {
    if (IN.bound || typeof document === 'undefined') return; IN.bound = true;
    const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
    addEventListener('keydown', e => { if (typing(e)) return; if (!e.repeat) { IN.keys.add(e.code); IN.pend.add(e.code); } if (IN.wantLock && (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow'))) e.preventDefault(); });
    addEventListener('keyup', e => { IN.keys.delete(e.code); });
    addEventListener('blur', () => { IN.keys.clear(); });
    addEventListener('mousedown', e => { const c = mcode(e.button); IN.keys.add(c); IN.pend.add(c); if (IN.wantLock && IN.canvas && e.target === IN.canvas && !document.pointerLockElement) safe(() => { const p = IN.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); }); });
    addEventListener('mouseup', e => { IN.keys.delete(mcode(e.button)); });
    addEventListener('contextmenu', e => { if (e.target && e.target.tagName === 'CANVAS') e.preventDefault(); });
    addEventListener('mousemove', e => { const lock = !!document.pointerLockElement; input.locked = lock; const game = GT.cngame?.G;
      const shopLook = IN.shopLook && e.target === IN.canvas && game?.phase === 'play' &&
        !game.paused && !game.cine && !GT.shops?.isOpen && !GT.front?.busy;
      if (lock || shopLook || (IN.wantLock && (IN.keys.has('Mouse0') || IN.keys.has('Mouse1')))) { IN.pdx += e.movementX || 0; IN.pdy += e.movementY || 0; } });
    document.addEventListener('pointerlockchange', () => { input.locked = !!document.pointerLockElement; });
  }
  bindInput(); GT.input = input;

  /* ================================================================== GT.wallet */
  GT.wallet = GT.wallet || (() => { const cbs = []; const w = { cash: 0,
    add(n, why) { n = +n || 0; w.cash += n; for (const cb of cbs) safe(() => cb(w.cash, n, why)); return w.cash; },
    spend(n) { n = +n || 0; if (n > w.cash) return false; w.cash -= n; for (const cb of cbs) safe(() => cb(w.cash, -n, 'spend')); return true; },
    on(cb) { if (typeof cb === 'function') cbs.push(cb); return w; } }; return w; })();

  /* ================================================================== world queries: grid over GT.world.boxes, cars as oriented boxes */
  const STEP_H = .35, GRID = { n: -1, cell: 8, map: new Map(), big: [], q: 0 };
  const VEH = [];                                                      // {src, group, dims, x, z, h, c, s, hw, hl, H}
  function gridSync() { const B = GT.world.boxes;
    if (B.length === GRID.n && B === GRID.arr) { if (++GRID.tick < 240) return; GRID.tick = 0; let c = 0; for (const b of B) c += b.x0 + b.z0 * 1.3 + b.x1 * 1.7 + b.z1 * 2.1 + b.h; if (c === GRID.sum) return; }   // someone edited boxes in place (same count): periodic checksum catches it
    { let c = 0; for (const b of B) c += b.x0 + b.z0 * 1.3 + b.x1 * 1.7 + b.z1 * 2.1 + b.h; GRID.sum = c; GRID.tick = 0; GRID.arr = B; } GRID.n = B.length; GRID.map.clear(); GRID.big.length = 0; const cs = GRID.cell;
    for (const b of B) { const i0 = Math.floor(b.x0 / cs), i1 = Math.floor(b.x1 / cs), j0 = Math.floor(b.z0 / cs), j1 = Math.floor(b.z1 / cs);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) { GRID.big.push(b); continue; }
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * 8192 + j; let a = GRID.map.get(k); if (!a) GRID.map.set(k, a = []); a.push(b); } } }
  const QB = [];
  /** boxes overlapping the rectangle -> shared array QB (valid until the next call) */
  function boxesIn(x0, z0, x1, z1) { gridSync(); QB.length = 0; const cs = GRID.cell, q = ++GRID.q, i0 = Math.floor(x0 / cs), i1 = Math.floor(x1 / cs), j0 = Math.floor(z0 / cs), j1 = Math.floor(z1 / cs);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = GRID.map.get(i * 8192 + j); if (!a) continue; for (const b of a) { if (b._ofq === q) continue; b._ofq = q; if (b.x1 >= x0 && b.x0 <= x1 && b.z1 >= z0 && b.z0 <= z1) QB.push(b); } }
    for (const b of GRID.big) if (b.x1 >= x0 && b.x0 <= x1 && b.z1 >= z0 && b.z0 <= z1) QB.push(b); return QB; }
  function syncOne(v) { const g = v.group; if (!g) return; g.updateMatrixWorld(); const e = g.matrixWorld.elements; v.x = e[12]; v.y = e[13]; v.z = e[14]; v.h = Math.atan2(e[8], e[10]); v.c = cos(v.h); v.s = sin(v.h); }
  function syncVehicles() { for (const v of VEH) syncOne(v); }
  const toCar = (v, x, z, o) => { const dx = x - v.x, dz = z - v.z; o.x = dx * v.c - dz * v.s; o.z = dx * v.s + dz * v.c; return o; };
  const fromCar = (v, lx, lz, o) => { o.x = v.x + lx * v.c + lz * v.s; o.z = v.z - lx * v.s + lz * v.c; return o; };
  const _l = { x: 0, z: 0 }, _l2 = { x: 0, z: 0 }, _w = { x: 0, z: 0 };

  let GROUND_FN = null, QY = 0;                                         // opts.groundHeight override; feet height used by isFree() (step-up is relative to where you stand)
  function roadY(x, z) { const f = GROUND_FN || (GT.cnroad && GT.cnroad.groundHeight) || (GT.road && GT.road.groundHeight); if (f && roadY.bad !== f) { try { const y = f(x, z); if (typeof y === 'number' && isFinite(y)) return y; } catch (e) { roadY.bad = f; } } return 0; }
  const surfAt = (x, z) => { const f = (GT.cnroad && GT.cnroad.surfaceAt) || (GT.road && GT.road.surfaceAt); return f ? safe(() => f(x, z), '') : ''; };
  const ZONES = [];
  const zArea = z => (z.x1 - z.x0) * (z.z1 - z.z0);
  function zoneAt(x, z) { let best = null; for (const zn of ZONES) if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1 && (!best || (zn.indoor && !best.indoor) || (!!zn.indoor === !!best.indoor && zArea(zn) < zArea(best)))) best = zn; return best; }
  /** walkable height under a point: terrain, indoor floors, and low boxes (kerbs, planters) which count as steps */
  const FLOORS = [];
  function groundY(x, z, fromY) { let y = roadY(x, z); const zn = zoneAt(x, z); if (zn && zn.floor !== undefined && zn.floor > y) y = zn.floor;
    for (const f of FLOORS) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) { const fy = typeof f.y === 'function' ? f.y(x, z) : f.y; if (fy > y && (fromY === undefined || fy - fromY <= .45)) y = fy; }
    const B = boxesIn(x, z, x, z); for (const b of B) if (b.h > y && (fromY === undefined ? b.h < STEP_H : (b.h <= fromY + .02 || (b.h - fromY <= STEP_H + .05 && (b.h < STEP_H || STAIR.test(b.tag)))))) y = b.h; return y; }

  /** boxes you walk over rather than into: low ones (kerbs), anything whose top is at or below your feet (you are standing on it / above it), and stair-like boxes one riser up.
      World modules: tag stair treads / ramps / raised decks with one of these words so they can be climbed; everything else taller than 0.35 m is a wall. */
  const STAIR = /stair|step|ramp|dock|platform|kerb|curb|floor|deck|podium|stage|pier|terrace/i, passable = (b, fy) => b.h < STEP_H || b.h <= fy + .06 || (b.h - fy < STEP_H && STAIR.test(b.tag));
  const HIT = { nx: 0, nz: 0, box: null, n: 0 };
  /** push a circle out of every solid box and car; returns true if anything was touched (HIT has the last normal + box) */
  function resolve(p, r, skipVeh) { HIT.n = 0; HIT.box = null; const fy = p.y || 0;
    for (let it = 0; it < 3; it++) { let moved = false; const B = boxesIn(p.x - r, p.z - r, p.x + r, p.z + r);
      for (const b of B) { if (passable(b, fy)) continue; const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1), dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz; if (d2 >= r * r) continue;
        if (d2 > 1e-10) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; HIT.nx = dx / d; HIT.nz = dz / d; }
        else { const a = p.x - b.x0, c = b.x1 - p.x, e = p.z - b.z0, f = b.z1 - p.z, m = min(a, c, e, f); if (m === a) { p.x = b.x0 - r; HIT.nx = -1; HIT.nz = 0; } else if (m === c) { p.x = b.x1 + r; HIT.nx = 1; HIT.nz = 0; } else if (m === e) { p.z = b.z0 - r; HIT.nx = 0; HIT.nz = -1; } else { p.z = b.z1 + r; HIT.nx = 0; HIT.nz = 1; } }
        HIT.box = b; HIT.n++; moved = true; }
      for (const v of VEH) { if (v === skipVeh || !v.group || v.group.visible === false) continue; toCar(v, p.x, p.z, _l); const cx = clamp(_l.x, -v.hw, v.hw), cz = clamp(_l.z, -v.hl, v.hl), dx = _l.x - cx, dz = _l.z - cz, d2 = dx * dx + dz * dz; if (d2 >= r * r) continue;
        let nx, nz; if (d2 > 1e-10) { const d = Math.sqrt(d2), k = (r - d) / d; _l.x += dx * k; _l.z += dz * k; nx = dx / d; nz = dz / d; }
        else { const a = _l.x + v.hw, c = v.hw - _l.x, e = _l.z + v.hl, f = v.hl - _l.z, m = min(a, c, e, f); nx = nz = 0; if (m === a) { _l.x = -v.hw - r; nx = -1; } else if (m === c) { _l.x = v.hw + r; nx = 1; } else if (m === e) { _l.z = -v.hl - r; nz = -1; } else { _l.z = v.hl + r; nz = 1; } }
        fromCar(v, _l.x, _l.z, p); HIT.nx = nx * v.c + nz * v.s; HIT.nz = -nx * v.s + nz * v.c; HIT.box = v; HIT.n++; moved = true; }
      if (!moved) break; }
    const bd = GT.L && GT.L.bounds; if (bd && !inExtra(p.x, p.z)) { p.x = clamp(p.x, bd.x0 + r, bd.x1 - r); p.z = clamp(p.z, bd.z0 + r, bd.z1 - r); }
    return HIT.n > 0; }
  /** walkable pockets outside the level bounds (a pier out over the river): GT.L.extra = [{x0, x1, z0, z1}] */
  function inExtra(x, z) { const ex = GT.L && GT.L.extra; if (!ex) return false; for (const e of ex) if (x > e.x0 && x < e.x1 && z > e.z0 && z < e.z1) return true; return false; }
  function isFree(x, z, r, skipVeh) { const bd = GT.L && GT.L.bounds; if (bd && !inExtra(x, z) && (x < bd.x0 + r || x > bd.x1 - r || z < bd.z0 + r || z > bd.z1 - r)) return false;
    const B = boxesIn(x - r, z - r, x + r, z + r); for (const b of B) { if (passable(b, QY)) continue; const dx = x - clamp(x, b.x0, b.x1), dz = z - clamp(z, b.z0, b.z1); if (dx * dx + dz * dz < r * r) return false; }
    for (const v of VEH) { if (v === skipVeh || !v.group || v.group.visible === false) continue; toCar(v, x, z, _l); const dx = _l.x - clamp(_l.x, -v.hw, v.hw), dz = _l.z - clamp(_l.z, -v.hl, v.hl); if (dx * dx + dz * dz < r * r) return false; } return true; }
  /** segment vs solids. Returns the first hit parameter t in [0,1] (1 = clear). rad inflates the boxes. o: {thin: ignore posts narrower than this (camera), skipVeh, noVeh} */
  function segHit(ax, ay, az, bx, by, bz, rad, o) { let best = 1; const dx = bx - ax, dy = by - ay, dz = bz - az, thin = (o && o.thin) || 0;
    const test = (px, py, pz, ex, ey, ez, x0, x1, y1, z0, z1) => { let t0 = 0, t1 = 1, a, b, s;
      if (abs(ex) < 1e-9) { if (px < x0 || px > x1) return 1; } else { a = (x0 - px) / ex; b = (x1 - px) / ex; if (a > b) { s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return 1; }
      if (abs(ez) < 1e-9) { if (pz < z0 || pz > z1) return 1; } else { a = (z0 - pz) / ez; b = (z1 - pz) / ez; if (a > b) { s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return 1; }
      if (abs(ey) < 1e-9) { if (py > y1) return 1; } else { a = (-50 - py) / ey; b = (y1 - py) / ey; if (a > b) { s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return 1; }
      return t0; };
    const B = boxesIn(min(ax, bx) - rad, min(az, bz) - rad, max(ax, bx) + rad, max(az, bz) + rad);
    for (const b of B) { if (b.h < STEP_H) continue; if (thin && b.x1 - b.x0 < thin && b.z1 - b.z0 < thin) continue; const t = test(ax, ay, az, dx, dy, dz, b.x0 - rad, b.x1 + rad, b.h + rad, b.z0 - rad, b.z1 + rad); if (t < best) best = t; }
    if (!(o && o.noVeh)) for (const v of VEH) { if ((o && v === o.skipVeh) || !v.group || v.group.visible === false) continue; toCar(v, ax, az, _l); toCar(v, bx, bz, _l2);
      const t = test(_l.x, ay - v.y, _l.z, _l2.x - _l.x, dy, _l2.z - _l.z, -v.hw - rad, v.hw + rad, v.H + rad, -v.hl - rad, v.hl + rad); if (t < best) best = t; }
    return best; }
  const segClear = (ax, az, bx, bz, pad, o) => segHit(ax, QY + .6, az, bx, QY + .6, bz, pad || 0, o) >= 1;
  /* ---- camera-only blockers (alive layer). GT.world.boxes are footprints that reach the ground, so anything you can walk UNDER (stall awnings, shopfront canopies, the lane roof)
     and anything taller than its collision box (a stall is a 1.15 m counter box but a 3 m frame with a signboard) was invisible to the boom: the camera swung inside them.
     OVER holds axis-aligned slabs {x0,x1,z0,z1,y0,y1}: y0 > 0.5 = something with an underside (the camera stops at its face or ducks beneath it), y0 <= 0.5 = a full-height
     volume the camera may not enter. Sources: GT.onfoot.addOverhead(box) for any module, plus what the snack street exposes (stall positions + lane layout), harvested lazily.
     Thin posts are still ignored by the ordinary boom test (CAMQ.thin); the player never collides with these. */
  const OVER = []; let OVER_SRC = /[?&]camfix=0/.test(typeof location !== 'undefined' ? location.search : '');   // ?camfix=0 = old behaviour, for before/after stills
  function addOverhead(o) { if (!o || o.x0 === undefined) return null; const v = { id: o.id || 'over' + OVER.length, x0: min(o.x0, o.x1), x1: max(o.x0, o.x1), z0: min(o.z0, o.z1), z1: max(o.z0, o.z1), y0: o.y0 === undefined ? -50 : o.y0, y1: o.y1 === undefined ? (o.y0 || 0) + .5 : o.y1 };
    const i = OVER.findIndex(q => q.id === v.id); if (i >= 0) OVER[i] = v; else OVER.push(v); return v; }
  function overSync() { if (OVER_SRC) return; const sn = GT.snackstreet, L = sn && sn.layout; if (!sn || !sn.stalls || !L || !Object.keys(sn.stalls).length) return; OVER_SRC = true;
    const Y = sn.groundY || 0, rect = (id, ox, oz, h, lx0, lz0, lx1, lz1, y0, y1) => { const s = sin(h), c = cos(h), ax = ox + lx0 * c + lz0 * s, az = oz - lx0 * s + lz0 * c, bx = ox + lx1 * c + lz1 * s, bz = oz - lx1 * s + lz1 * c; addOverhead({ id, x0: ax, z0: az, x1: bx, z1: bz, y0, y1 }); };
    for (const id in sn.stalls) { const c = sn.stalls[id].cook; if (!c || id === 'reganmian' || id === 'fruit' || id === 'jianbing') continue;     // the ten frame stalls: cook = local (0, -.18), local +z faces the lane
      const ox = c.x + .18 * sin(c.h), oz = c.z + .18 * cos(c.h); rect('stallBody_' + id, ox, oz, c.h, -1.78, -1.34, 1.78, 1.02, -50, Y + 3.05); rect('stallAwning_' + id, ox, oz, c.h, -1.8, 1.0, 1.8, 2.1, Y + 1.7, Y + 2.3); }
    const WX = L.wallW, EX = L.wallE, Z0 = L.laneZ0, Z1 = L.laneZ1, P0 = L.passageZ0, P1 = L.passageZ1, AX = L.avenueSideX, FX = L.forecourtX0, DZ = L.doorZ;
    addOverhead({ id: 'snackCanopy', x0: WX, x1: EX, z0: Z0, z1: Z1, y0: Y + 4.05, y1: Y + 5.4 });                                                  // the lane's corrugated roof
    for (const [k, z] of [[0, DZ - 16.1], [1, DZ + 15.8]]) { addOverhead({ id: 'shopAwnW' + k, x0: WX, x1: WX + 1.35, z0: z - 1.85, z1: z + 1.85, y0: Y + 2.1, y1: Y + 2.75 }); addOverhead({ id: 'shopAwnE' + k, x0: EX - 1.35, x1: EX, z0: z - 1.85, z1: z + 1.85, y0: Y + 2.1, y1: Y + 2.75 }); }
    for (const [k, a, b] of [[0, Z0, P0], [1, P1, Z1]]) { addOverhead({ id: 'frontAwnA' + k, x0: AX - 1.3, x1: AX, z0: a, z1: b, y0: Y + 2.2, y1: Y + 2.85 }); addOverhead({ id: 'frontAwnF' + k, x0: FX, x1: FX + 1.3, z0: a, z1: b, y0: Y + 2.2, y1: Y + 2.85 }); }   // canvas awnings over the shopfronts on the outer faces
    for (const [k, a, b] of [[0, AX, WX], [1, EX, FX]]) { addOverhead({ id: 'frontAwnS' + k, x0: a, x1: b, z0: Z0 - 1.3, z1: Z0, y0: Y + 2.2, y1: Y + 2.85 }); addOverhead({ id: 'frontAwnN' + k, x0: a, x1: b, z0: Z1, z1: Z1 + 1.3, y0: Y + 2.2, y1: Y + 2.85 }); } }

  /* ================================================================== figures: GT.hero -> GT.people -> kit capsule */
  const PEOPLE_MAP = { idle: 'idle', walk: 'walk', run: 'run', sprint: 'run', crouch: 'crouch', crouch_walk: 'crouch', aim: 'aim', carry: 'carry_run', sit: 'sit', lean: 'idle', phone: 'phone', talk: 'talk', handsup: 'handsup', use: 'talk', enter_car: 'crouch', exit_car: 'crouch', cheer: 'wave', pet: 'crouch', ride: 'sit', fall: 'crouch' };
  const _v1 = new T.Vector3(), _v2 = new T.Vector3(), _v3 = new T.Vector3();
  /** last-resort figure (no hero.js, no people.js): articulated mannequin — two-segment limbs, knee/elbow flex, the poses the controller uses. +X is the figure's left. */
  function capsuleFigure(who) { const dark = who === 'lie', group = new T.Group(); group.name = 'onfoot_capsule_' + who;
    const top = GT.mat('fabric_dark', { color: dark ? 0x26282d : 0xc59a22 }), jeans = GT.mat('fabric_dark', { color: dark ? 0x1c2230 : 0x2b3547 }), skin = GT.mat('plastic_white', { color: 0xb98a68, rough: .72 }), shoe = GT.mat('leather_black'), hair = GT.mat('fabric_dark', { color: 0x15130f }), slv = dark ? top : skin;
    const node = (parent, x, y, z, fn) => { const g = new T.Group(); g.position.set(x, y, z); if (fn) { const k = GT.kit(); fn(k); g.add(k.build()); } parent.add(g); return g; };
    const root = node(group, 0, .96, 0), torso = node(root, 0, 0, 0, k => { k.push(0, 0, 0, { s: [1, 1, .64] }); k.cyl(jeans, .168, .162, .17, 0, .0, 0, { seg: 18 }); k.cyl(top, .152, .172, .2, 0, .17, 0, { seg: 18 }); k.cyl(top, .192, .152, .27, 0, .4, 0, { seg: 18 }); k.sphere(top, .192, 0, .535, 0, { s: [1, .4, 1] }); k.pop();
      k.sphere(top, .074, -.212, .5, 0); k.sphere(top, .074, .212, .5, 0); k.box(GT.mat('leather_black'), .33, .035, .215, 0, .075, 0, { bevel: .012 }); if (dark) k.sphere(top, .135, 0, .6, -.07, { s: [1.15, .8, 1] }); });
    const head = node(torso, 0, .6, 0, k => { k.cyl(skin, .05, .058, .1, 0, .03, 0, { seg: 12 }); k.sphere(skin, .1, 0, .175, .012, { s: [.9, 1.14, 1] }); k.sphere(skin, .022, -.092, .17, .0, { s: [.5, 1.2, 1] }); k.sphere(skin, .022, .092, .17, .0, { s: [.5, 1.2, 1] });
      if (dark) k.sphere(top, .112, 0, .185, -.012, { s: [.95, 1.12, 1.02] }); else { const hel = GT.mat('metal_painted_yellow', { rough: .38 }); k.sphere(hair, .104, 0, .19, -.014, { s: [.93, .98, 1] }); k.sphere(hel, .128, 0, .215, -.008, { s: [.96, .86, 1.08], seg: 20 }); k.box(GT.mat('plastic_black'), .2, .016, .1, 0, .2, .125, { bevel: .006, rx: .18 }); k.box(GT.mat('plastic_black'), .262, .03, .05, 0, .15, -.02, { bevel: .01 });
        k.box(GT.mat('plastic_black'), .018, .13, .02, -.108, .1, .03, { bevel: .005, rx: -.2 }); k.box(GT.mat('plastic_black'), .018, .13, .02, .108, .1, .03, { bevel: .005, rx: -.2 }); } });
    if (!dark) { const k = GT.kit(); k.box(GT.mat('plastic_white', { color: 0xdad6c8 }), .2, .05, .006, 0, .47, -.127, { bevel: .002 }); k.box(GT.mat('metal_galv'), .3, .022, .004, 0, .3, -.118, { bevel: .001 }); torso.add(k.build()); }
    const L = {}; for (const sx of [-1, 1]) { const thigh = node(root, sx * .095, -.02, 0, k => { k.sphere(jeans, .083, 0, 0, 0); k.cyl(jeans, .083, .066, .44, 0, -.22, 0, { seg: 12 }); });
      const shin = node(thigh, 0, -.44, 0, k => { k.sphere(jeans, .066, 0, 0, 0); k.cyl(jeans, .063, .05, .42, 0, -.21, 0, { seg: 12 }); k.box(shoe, .1, .085, .27, 0, -.46, .055, { bevel: .036 }); k.box(GT.mat('plastic_white'), .102, .022, .272, 0, -.492, .055, { bevel: .008 }); });
      const arm = node(torso, sx * .228, .5, 0, k => { k.cyl(top, .054, .046, .2, 0, -.1, 0, { seg: 10 }); k.cyl(slv, .045, .042, .1, 0, -.245, 0, { seg: 10 }); });
      const fore = node(arm, 0, -.29, 0, k => { k.sphere(slv, .043, 0, 0, 0); k.cyl(slv, .04, .032, .25, 0, -.125, 0, { seg: 10 }); k.sphere(skin, .042, 0, -.295, .005, { s: [.62, 1.2, 1] }); }); L[sx] = { thigh, shin, arm, fore }; }
    if (dark) group.scale.setScalar(.965);
    let ph = 0, blend = 0; const P = { cr: 0, sit: 0, tx: 0, a1: 0, f1: 0, a_1: 0, f_1: 0, az: 0, kn: 0 };
    return { group, height: dark ? 1.74 : 1.8, kind: 'capsule', bones: { hips: root, spine: torso, chest: torso, neck: head, head, handL: L[1].fore, handR: L[-1].fore, footL: L[1].shin, footR: L[-1].shin },
      update(dt, s) { const st = s.state, v = s.speed || 0, loco = st === 'walk' || st === 'run' || st === 'sprint' || st === 'crouch_walk' || st === 'carry', t = s.t || 0; if (loco) ph += dt * (.55 + v * .25);
        const snap = dt === 0 ? 1 : 0, dk = (a, b, k) => snap ? b : damp(a, b, k, dt); blend = dk(blend, loco ? 1 : 0, 10); const run = sst(v, 2, 5), A = lerp(.45, .9, run) * blend;
        const seated = st === 'sit' || st === 'enter_car' ? 1 : st === 'ride' ? .82 : 0, cr = st === 'crouch' || st === 'crouch_walk' ? .72 : st === 'exit_car' ? .4 : st === 'pet' ? .8 : 0;
        let aR = 0, fR = -.1, aL = 0, fL = -.1, az = 0, tx = run * .16 * blend + (st === 'sprint' ? .08 : 0) + cr * .42 + seated * .1;
        if (st === 'use' || st === 'enter_car') { aR = -1.2; fR = -.35; } else if (st === 'aim') { aR = aL = -1.38 + (s.aimPitch || 0) * .8; fR = fL = -.12; az = .16; } else if (st === 'handsup') { aR = aL = -2.75; fR = fL = -.3; az = -.25; }
        else if (st === 'phone') { aR = -.38; fR = -1.95; tx += .05; } else if (st === 'talk') { aR = -.3 + sin(t * 3.1) * .08; fR = -1.15 + sin(t * 5.3) * .2; fL = -.3; } else if (st === 'lean') { tx = -.1; aR = aL = .12; fR = fL = -.25; }
        else if (st === 'cheer') { aR = aL = -2.8 + sin(t * 9) * .2; az = -.2; } else if (st === 'ride') { aR = aL = -.98; fR = fL = -.5; az = .1; tx += .04; } else if (st === 'fall') { aR = aL = -1.9; az = .5; tx = .5; } else if (st === 'carry') { aR = .1; fR = -.25; } else if (st === 'pet') { aR = -.9; fR = -.4; }
        P.cr = dk(P.cr, cr, 9); P.sit = dk(P.sit, seated, 9); P.tx = dk(P.tx, tx, 8); P.a1 = dk(P.a1, aL, 10); P.f1 = dk(P.f1, fL, 10); P.a_1 = dk(P.a_1, aR, 10); P.f_1 = dk(P.f_1, fR, 10); P.az = dk(P.az, az, 10); P.kn = dk(P.kn, st === 'ride' ? 1 : 0, 9); const swing = st === 'ride' ? (s.swing || 0) : 0, mside = s.mountSide || 1;
        for (const sx of [-1, 1]) { const l = L[sx], p = ph * TAU + (sx > 0 ? PI : 0), sw = sin(p), lift = max(0, cos(p)), leanK = st === 'lean' && sx > 0 ? 1 : 0;
          l.thigh.rotation.x = -sw * A - P.cr * 1.05 - P.sit * 1.45 - leanK * .35; l.shin.rotation.x = (lift * lerp(.85, 1.75, run) + .07) * blend + P.cr * 1.75 + P.sit * 1.5 + leanK * .8;
          l.arm.rotation.x = sw * A * .8 + (sx > 0 ? P.a1 : P.a_1); l.fore.rotation.x = -(.16 + run * 1.25) * blend + (sx > 0 ? P.f1 : P.f_1); l.arm.rotation.z = sx * (.06 + P.az); l.thigh.rotation.z = sx * (P.kn * .13 + (sx === -mside ? swing * 1.05 : 0)); if (swing > 0 && sx === -mside) { l.thigh.rotation.x = lerp(l.thigh.rotation.x, .25, swing); l.shin.rotation.x = lerp(l.shin.rotation.x, .5, swing); } }
        root.position.y = .96 - P.cr * .27 - P.sit * .42 + abs(cos(ph * TAU)) * .028 * blend * (1 + run); torso.rotation.x = P.tx; torso.rotation.y = (s.lookYaw || 0) * .3 + sin(ph * TAU) * .1 * blend; torso.rotation.z = -(s.turn || 0) * .03;
        head.rotation.y = (s.lookYaw || 0) * .6; head.rotation.x = (s.lookPitch || 0) * .6 - P.tx * .6; } }; }
  function makeFigure(who, given) {
    if (given && given.group && given.update) return wrapFigure(given, given.bones && given.bones.hips && !given.spec ? 'hero' : (given.spec ? 'people' : 'hero'), who);
    if (GT.hero && GT.hero.make) { const f = safe(() => GT.hero.make(who)); if (f && f.group) return wrapFigure(f, 'hero', who); }
    if (GT.people && GT.people.make) { const f = safe(() => who === 'lie' ? GT.people.make('partner', { mask: false, bag: false }) : GT.people.make('ped', { type: 'local_m', seed: 3 })); if (f && f.group) return wrapFigure(f, 'people', who); }
    return wrapFigure(capsuleFigure(who), 'capsule', who); }
  function wrapFigure(f, kind, who) { const w = { src: f, group: f.group, kind, who, height: f.height || 1.8, bones: f.bones || {} }; let bad = 0;
    w.update = (dt, s) => { if (bad > 3) return;
      try { if (kind === 'people') { const ns = GT.people.newStates, st = (ns && s.state === 'lean' && ns.includes('lean_wall')) ? 'lean_wall' : (ns && ns.includes(s.state) && !PEOPLE_MAP[s.state]) ? s.state : (PEOPLE_MAP[s.state] || 'idle'), o = { state: st, speed: s.speed, steer: clamp(-(s.turn || 0) * .2, -1, 1) };
          if (s.lookYaw || s.lookPitch) { const g = f.group, a = g.rotation.y + (s.lookYaw || 0); o.lookAt = _v1.set(g.position.x + sin(a) * 6, g.position.y + 1.6 - (s.lookPitch || 0) * 6, g.position.z + cos(a) * 6); } f.update(dt, o); }
        else if (s.state === 'ride' && kind === 'hero' && GT.hero && Array.isArray(GT.hero.states) && !GT.hero.states.includes('ride')) { const o = Object.assign({}, s); o.state = 'sit'; f.update(dt, o); }
        else f.update(dt, s); } catch (e) { bad++; if (window.console) console.warn('[onfoot] figure.update', e); } };
    w.headY = () => w.height * .93; w.hips = (f.bones && f.bones.hips) || safe(() => f.group.getObjectByName('hips'), null) || null; return w; }

  /* ================================================================== GT.act — registry */
  const ACT = { list: [], byId: new Map() };
  const act = GT.act = {
    list: ACT.list,
    add(spot) { if (!spot || typeof spot.onUse !== 'function') return null; if (spot.id === undefined || spot.id === null) spot.id = 'spot' + (++act._n); if (ACT.byId.has(spot.id)) act.remove(spot.id); ACT.byId.set(spot.id, spot); ACT.list.push(spot); return spot; },
    remove(id) { const s = ACT.byId.get(id && id.id !== undefined ? id.id : id); if (!s) return false; ACT.byId.delete(s.id); const i = ACT.list.indexOf(s); if (i >= 0) ACT.list.splice(i, 1); if (s._mk) { s._mk.visible = false; s._mk.userData.free = true; s._mk = null; } return true; },
    get(id) { return ACT.byId.get(id) || null; },
    /** best usable spot for a position {x, z, y?, h?} — nearest first, facing breaks ties and rejects spots behind you */
    near(pos, mode, _all) { mode = mode || 'foot'; const ctx = act._ctx(pos, mode), out = _all || null; let best = null, bs = 1e9;
      for (const s of ACT.list) { const m = s.mode || 'foot'; if (m !== 'both' && m !== mode) continue; const r = s.r || 1.4, dx = s.x - pos.x, dz = s.z - pos.z, d = hyp(dx, dz); if (d > r) continue;
        if (s.y !== undefined && pos.y !== undefined && abs(s.y - pos.y) > 1.9) continue; if (s.enabled && !safe(() => s.enabled(ctx), false)) continue;
        let score = d / r; if (pos.h !== undefined && d > .45) { const a = abs(angDiff(pos.h, Math.atan2(dx, dz))); if (mode === 'foot' && a > (pos.look ? 1.6 : 2.2) && d > .8) continue; score += a * (pos.look ? .62 : .28); }
        s._score = score; if (out) out.push(s); if (score < bs) { bs = score; best = s; } }
      if (out) out.sort((a, b) => a._score - b._score); return best; },
    prompt(spot) { if (!spot) return ''; const l = spot.label; return typeof l === 'function' ? String(safe(() => l(act._ctx(null, spot.mode === 'car' ? 'car' : 'foot')), '') || '') : String(l || ''); },
    _n: 0, _ctl: null,
    _ctx(pos, mode) { const c = act._ctl, p = pos || (c ? c.pos : { x: 0, z: 0 }); return { ctl: c, pos: { x: p.x, z: p.z }, h: pos && pos.h !== undefined ? pos.h : (c ? c.h : 0), mode: mode || 'foot', hero: c ? c.hero : null, partner: c ? c.partner : null, time: c ? c.time : 0, hours: (GT.env && GT.env.hours) || 0 }; }
  };
  { const q = GT._actQueue; if (Array.isArray(q)) q.splice(0).forEach(s => act.add(s)); GT._actQueue = { push() { for (let i = 0; i < arguments.length; i++) act.add(arguments[i]); return ACT.list.length; }, length: 0 }; }

  /* ================================================================== prompt UI + fallback subtitles (DOM) */
  const UI = { root: null, rows: [], sub: null, subQ: [], subT: 0, subCur: null };
  const CSS = `
#of-ui{position:fixed;inset:0;pointer-events:none;z-index:40;font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;user-select:none}
#of-ui .of-prompts{position:absolute;right:4.2vw;bottom:9.5vh;display:flex;flex-direction:column-reverse;align-items:flex-end;gap:9px}
#of-ui .of-p{display:flex;align-items:center;gap:13px;padding:7px 18px 7px 9px;border-radius:26px 6px 6px 26px;color:#f6f1e7;
  background:linear-gradient(90deg,rgba(12,13,17,.74),rgba(12,13,17,.52) 62%,rgba(12,13,17,.34));box-shadow:0 0 0 1px rgba(255,255,255,.07) inset,0 10px 26px rgba(0,0,0,.34);
  border-right:2px solid #ff9d47;opacity:0;transform:translateX(18px);transition:opacity .16s ease,transform .2s cubic-bezier(.2,.8,.2,1);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}
#of-ui .of-p.on{opacity:1;transform:none}
#of-ui .of-p.sec{padding:4px 13px 4px 6px;gap:9px;border-right-color:rgba(255,255,255,.3)}
#of-ui .of-p.sec.on{opacity:.74}
#of-ui .of-k{position:relative;width:42px;height:42px;flex:none}
#of-ui .of-k svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}
#of-ui .of-k circle{fill:none;stroke-width:2.6}
#of-ui .of-k .tr{stroke:rgba(255,255,255,.2)}
#of-ui .of-k .pg{stroke:#ffab52;stroke-linecap:round;stroke-dasharray:119.4;stroke-dashoffset:119.4;filter:drop-shadow(0 0 3px rgba(255,150,60,.8))}
#of-ui .of-k:not(.hold) svg{display:none}
#of-ui .of-cap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:28px;height:28px;box-sizing:border-box;padding:0 7px;border-radius:7px;display:flex;align-items:center;justify-content:center;
  font:800 16px/1 "SF Pro Display","Helvetica Neue",Arial,"PingFang SC",sans-serif;letter-spacing:.2px;color:#16181c;background:linear-gradient(180deg,#fdfaf3,#d9d3c6);
  box-shadow:0 2px 0 #8f897c,0 3px 7px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.55) inset;white-space:nowrap}
#of-ui .of-k.hold .of-cap{min-width:25px;height:25px;font-size:14px;border-radius:13px}
#of-ui .of-k.press .of-cap{transform:translate(-50%,-44%);box-shadow:0 0 0 #8f897c,0 1px 4px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.55) inset}
#of-ui .of-l{font-size:19px;font-weight:600;letter-spacing:.5px;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.75)}
#of-ui .of-l small{display:block;font-size:11.5px;font-weight:500;letter-spacing:1.6px;color:#ffc98f;opacity:.92;margin-top:2px}
#of-ui .of-ic{font-size:15px;margin-right:7px;color:#ffc98f}
#of-ui .of-p.sec .of-k{width:28px;height:28px}
#of-ui .of-p.sec .of-cap{min-width:22px;height:22px;font-size:12.5px;border-radius:6px;padding:0 5px}
#of-ui .of-p.sec .of-l{font-size:14.5px;font-weight:500}
#of-ui .of-p.sec .of-l small{display:none}
#of-ui .of-sub{position:absolute;left:50%;bottom:12vh;transform:translateX(-50%);max-width:70vw;text-align:center;color:#f7f3ea;font-size:21px;line-height:1.45;font-weight:500;text-shadow:0 1px 2px #000,0 0 12px rgba(0,0,0,.75);opacity:0;transition:opacity .2s}
#of-ui .of-sub.on{opacity:1}
#of-ui .of-sub b{color:#ffc27a;font-weight:700;margin-right:.6em}
#of-ui .of-dbg{position:absolute;left:10px;bottom:10px;color:#9f9;font:12px/1.35 Menlo,monospace;white-space:pre;text-shadow:0 1px 2px #000}`;
  const KEYNAMES = { Space: '空格', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', Enter: '↵', Tab: 'Tab', Escape: 'Esc', Mouse0: '左键', Mouse1: '右键', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  const keyName = c => KEYNAMES[c] || (c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : c);
  function uiInit() { if (UI.root || typeof document === 'undefined') return; const st = document.createElement('style'); st.id = 'of-css'; st.textContent = CSS; document.head.appendChild(st);
    const root = UI.root = document.createElement('div'); root.id = 'of-ui'; const box = document.createElement('div'); box.className = 'of-prompts'; root.appendChild(box);
    for (let i = 0; i < 3; i++) { const p = document.createElement('div'); p.className = 'of-p' + (i ? ' sec' : '');
      p.innerHTML = '<div class="of-k"><svg viewBox="0 0 42 42"><circle class="tr" cx="21" cy="21" r="19"/><circle class="pg" cx="21" cy="21" r="19"/></svg><div class="of-cap"></div></div><div class="of-l"></div>';
      box.appendChild(p); UI.rows.push({ el: p, k: p.querySelector('.of-k'), cap: p.querySelector('.of-cap'), pg: p.querySelector('.pg'), l: p.querySelector('.of-l'), key: '', text: '', on: false, hold: false, prog: -1, press: false }); }
    UI.sub = document.createElement('div'); UI.sub.className = 'of-sub'; root.appendChild(UI.sub); document.body.appendChild(root); }
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function uiRow(i, spot, prog, press) { const r = UI.rows[i]; if (!r) return; if (!spot) { if (r.on) { r.on = false; r.el.classList.remove('on'); } return; }
    const key = keyName(spot.key || 'KeyE'), label = act.prompt(spot), hold = spot.hold > 0, text = (spot.icon ? spot.icon + '|' : '') + label + (hold && !i ? '|h' : '');
    if (r.key !== key) { r.key = key; r.cap.textContent = key; } if (r.text !== text) { r.text = text; r.l.innerHTML = (spot.icon && !/^[\w-]+$/.test(spot.icon) ? '<span class="of-ic">' + esc(spot.icon) + '</span>' : '') + esc(label) + (hold && !i ? '<small>按住</small>' : ''); }
    if (r.hold !== hold) { r.hold = hold; r.k.classList.toggle('hold', hold); } const pg = hold ? Math.round(clamp(prog || 0, 0, 1) * 200) / 200 : -1; if (r.prog !== pg) { r.prog = pg; if (hold) r.pg.style.strokeDashoffset = (119.4 * (1 - pg)).toFixed(1); }
    if (r.press !== !!press) { r.press = !!press; r.k.classList.toggle('press', !!press); } if (!r.on) { r.on = true; r.el.classList.add('on'); } }
  function subShow(dt) { if (!UI.sub) return; if (UI.subCur) { UI.subT -= dt; if (UI.subT <= 0) { UI.subCur = null; UI.sub.classList.remove('on'); } } if (!UI.subCur && UI.subQ.length) { const s = UI.subCur = UI.subQ.shift(); UI.subT = s.sec; UI.sub.innerHTML = (s.who ? '<b>' + esc(s.who) + '</b>' : '') + esc(s.text); UI.sub.classList.add('on'); } }

  /* soft world markers: one additive sprite per spot.marker */
  let MK_TEX = null; const MK = { pool: [], group: null };
  function markerTex() { if (MK_TEX) return MK_TEX; const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); let r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,244,224,1)'); r.addColorStop(.1, 'rgba(255,228,190,.95)'); r.addColorStop(.2, 'rgba(255,190,120,.3)'); r.addColorStop(.55, 'rgba(255,170,90,.07)'); r.addColorStop(1, 'rgba(255,160,80,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,236,208,.62)'; g.lineWidth = 2.2; g.beginPath(); g.arc(64, 64, 30, 0, TAU); g.stroke(); MK_TEX = new T.CanvasTexture(c); MK_TEX.encoding = T.sRGBEncoding; return MK_TEX; }
  function markerFor(scene, s) { if (s._mk) return s._mk; if (!MK.group) { MK.group = new T.Group(); MK.group.name = 'onfoot_markers'; scene.add(MK.group); }
    let m = MK.pool.find(p => p.userData.free); if (!m) { m = new T.Sprite(new T.SpriteMaterial({ map: markerTex(), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false })); m.renderOrder = 6; MK.pool.push(m); MK.group.add(m); }
    m.userData.free = false; m.userData.ph = (ACT.list.indexOf(s) * 1.7) % TAU; s._mk = m; return m; }

  /* ================================================================== zones */
  function defaultZones() { if (defaultZones.done || !GT.L) return; defaultZones.done = true; const S = GT.L.station, st = S && S.store, M = GT.L.motel;
    const has = id => ZONES.some(z => z.id === id);
    if (!GT.station && !GT.road) {                                     // China edition: named areas for 'zone' events; interiors only tighten the camera until their module registers exact rooms via GT.onfoot.addZone
      const N = GT.CN; if (!N || !(GT.cnroad || GT.cngame || GT.cnstory)) return; const bd = GT.L.bounds, out = (id, r, z0, z1) => { if (r && !has(id)) ZONES.unshift({ id, x0: r.x0, x1: r.x1, z0: z0 !== undefined ? z0 : r.z0, z1: z1 !== undefined ? z1 : r.z1 }); };
      out('promenade', N.promenade, bd.z0, bd.z1); out('snack', N.snack); out('courtyard', N.courtyard); out('tenement', N.tenement); out('market', N.market); out('wharf', N.wharf); out('clockSteps', N.clock && { x0: N.clock.x0, x1: N.clock.x1, z0: N.clock.z0 - 8, z1: N.clock.z1 });
      const inn = (id, r) => { if (r && !has(id)) ZONES.push({ id, x0: r.x0 + .3, x1: r.x1 - .3, z0: r.z0 + .3, z1: r.z1 - .3, indoor: true }); }; inn('noodle', N.snack && N.snack.noodle); inn('hotpot', N.hotpot); inn('clock', N.clock); return; }
    if (S && !has('station')) ZONES.unshift({ id: 'station', x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1 }); if (M && !has('motel')) ZONES.unshift({ id: 'motel', x0: M.x0, x1: M.x1, z0: M.z0, z1: M.z1 });
    if (GT.L.beach && !has('beach')) ZONES.unshift({ id: 'beach', x0: GT.L.beach.x0, x1: GT.L.beach.x1, z0: GT.L.bounds.z0, z1: GT.L.bounds.z1 });
    if (st && !has('store')) { ZONES.push({ id: 'store', x0: st.x0 + .15, x1: st.x1, z0: st.z0, z1: st.z1, indoor: true, ceil: 3.05, floor: .15 });
      // raised slabs the terrain query does not know about (station.js: store sidewalk 47.58..50 at +0.15, door ramp)
      addFloor({ id: 'storeWalk', x0: st.x0 - 2.42, x1: st.x0 + .2, z0: st.z0 - 1, z1: st.z1 + 1, y: .15 }); addFloor({ id: 'storeRamp', x0: st.x0 - 3.5, x1: st.x0 - 2.42, z0: st.doorZ - 1.05, z1: st.doorZ + 1.05, y: x => clamp((x - (st.x0 - 3.5)) / 1.08, 0, 1) * .15 }); } }
  /** extra walkable surfaces above the terrain: {id, x0, z0, x1, z1, y: number | (x, z) -> number} */
  function addFloor(f) { if (!f || f.x0 === undefined) return null; const i = FLOORS.findIndex(q => q.id !== undefined && q.id === f.id), fl = { id: f.id, x0: min(f.x0, f.x1), x1: max(f.x0, f.x1), z0: min(f.z0, f.z1), z1: max(f.z0, f.z1), y: f.y || 0 }; if (i >= 0) FLOORS[i] = fl; else FLOORS.push(fl); return fl; }
  function addZone(z) { if (!z || z.x0 === undefined) return null; const i = ZONES.findIndex(q => q.id === z.id); const zn = { id: z.id || 'zone' + ZONES.length, x0: min(z.x0, z.x1), x1: max(z.x0, z.x1), z0: min(z.z0, z.z1), z1: max(z.z0, z.z1), indoor: !!z.indoor, ceil: z.ceil, floor: z.floor };
    if (i >= 0) ZONES[i] = zn; else ZONES.push(zn); return zn; }

  /* ================================================================== controller */
  const SPEED = { walk: 1.55, run: 3.7, sprint: 6.3, crouch: 1.15, aim: 1.5 }, RAD = .3, PRAD = .28;
  const locoState = (v, crouch) => crouch ? (v > .2 ? 'crouch_walk' : 'crouch') : v < .18 ? 'idle' : v < 2.5 ? 'walk' : v < 5.1 ? 'run' : 'sprint';

  function create(o) {
    o = o || {}; const scene = o.scene, camera = o.camera; if (typeof o.groundHeight === 'function') GROUND_FN = o.groundHeight; defaultZones(); uiInit();
    if (o.dom || o.pointerLock) { IN.canvas = o.dom || (GT.render && GT.render.renderer && GT.render.renderer.domElement) || document.querySelector('canvas'); IN.wantLock = o.pointerLock !== false; }
    const hero = makeFigure('kai', o.hero), pfig = o.partner === false ? null : makeFigure('lie', o.partner);
    if (scene) { if (!hero.group.parent) scene.add(hero.group); if (pfig && !pfig.group.parent) scene.add(pfig.group); }
    const ev = {}, emit = (n, a) => { const l = ev[n]; if (l) for (const cb of l.slice()) safe(() => cb(a)); };

    const ctl = { enabled: true, pos: { x: 0, y: 0, z: 0 }, h: 0, speed: 0, state: 'idle', time: 0, armed: false, autoDoors: true, seated: null, riding: null, autoDismount: true, rideAssist: false, ride: { speed: 0, steer: 0, lean: 0 }, zone: null, hero: hero.src, heroFig: hero, partnerFig: pfig ? pfig.src : null,
      camera: { yaw: 0, pitch: .17, dist: 2.6, shoulder: 'R', fov: 58, side: .55, height: 1.55 }, view: o.view === 'fp' ? 'fp' : 'tp', fpFov: 64 };
    const S = { cmd: 0, ax: 0, ay: 0, crouch: false, jog: false, sprintLatch: false, shiftT: 0, shiftDown: false, lastTap: -9, noInT: 0, stateT: 0, turn: 0, phase: 0, bob: 0, lookIdle: 9, vault: null, lookYaw: 0, moveH: 0, wantMove: false, mode: 'foot', car: null, ride: { k: 0, swing: 0, side: 1, v: null, sl: null, vel: 0, steer: 0, lean: 0 } };
    const CAM = { fx: 0, fy: 0, fz: 0, lax: 0, laz: 0, side: .55, sideLim: .55, dist: 2.6, distWant: 2.6, h: 1.55, fov: 58, init: false, pos: new T.Vector3(), look: new T.Vector3(), out: new T.Vector3(), outLook: new T.Vector3(), outFov: 58, aim: 0,
      ov: { fn: null, w: 0, pos: new T.Vector3(), look: new T.Vector3(), fov: 58, manual: false, inT: .45, outT: .5, hold: false, has: false } };
    let TK = null;                                                     // active takeover

    /* ---------------------------------------------------------------- events, teleport */
    ctl.on = (n, cb) => { (ev[n] = ev[n] || []).push(cb); return ctl; };
    ctl.off = (n, cb) => { const l = ev[n]; if (l) { const i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); } return ctl; };
    ctl.teleport = (x, z, h) => { if (ctl.riding) { ctl.seated = null; ctl.riding = null; S.ride.k = 0; S.ride.swing = 0; } ctl.pos.x = x; ctl.pos.z = z; if (h !== undefined) { ctl.h = h; ctl.camera.yaw = h; } ctl.pos.y = groundY(x, z); S.cmd = 0; ctl.speed = 0; CAM.init = false; trail.length = 0; placeHero(); return ctl; };
    ctl.setCameraYaw = yaw => { ctl.camera.yaw = yaw; CAM.init = false; return ctl; };
    function placeHero() { hero.group.position.set(ctl.pos.x, ctl.pos.y, ctl.pos.z); hero.group.rotation.set(0, ctl.h + (S.legYaw || 0), 0); }
    const _qy = new T.Quaternion(), _ay = new T.Vector3(0, 1, 0);

    /* ---------------------------------------------------------------- locomotion */
    const _p = { x: 0, y: 0, z: 0 };
    function moveBody(b, dx, dz, r, skipVeh) { const d = hyp(dx, dz), n = max(1, Math.ceil(d / .1)); let touched = false; _p.x = b.x; _p.z = b.z; _p.y = b.y || 0;
      for (let i = 0; i < n; i++) { _p.x += dx / n; _p.z += dz / n; if (resolve(_p, r, skipVeh)) touched = true; } b.x = _p.x; b.z = _p.z; return touched; }
    function control(dt) {
      const a = input.axis(), aim = input.down('Mouse1'), C = ctl.camera;
      S.ax = damp(S.ax, a.x, 14, dt); S.ay = damp(S.ay, a.y, 14, dt); let mag = min(1, hyp(S.ax, S.ay)); const raw = hyp(a.x, a.y) > .1; if (!raw && mag < .12) mag = 0;
      const fx = sin(C.yaw), fz = cos(C.yaw), mx = fx * S.ay - fz * S.ax, mz = fz * S.ay + fx * S.ax, want = mag > .05;
      // gait
      const shift = input.down('ShiftLeft') || input.down('ShiftRight');
      if (shift && !S.shiftDown) { if (ctl.time - S.lastTap < .32) S.sprintLatch = true; S.lastTap = ctl.time; S.shiftT = 0; }
      if (!shift && S.shiftDown && S.shiftT < .22 && !S.sprintLatch) S.jog = !S.jog;
      S.shiftDown = shift; if (shift) S.shiftT += dt;
      if (!raw) { S.noInT += dt; if (S.noInT > .35) S.sprintLatch = false; } else S.noInT = 0;
      if (input.pressed('KeyC')) { S.crouch = !S.crouch; input.consume('KeyC'); }
      if (S.crouch && (shift || S.sprintLatch)) S.crouch = false;
      const gait = aim ? 'aim' : S.crouch ? 'crouch' : (S.sprintLatch || (shift && S.shiftT > .4)) ? 'sprint' : (shift || S.jog) ? 'run' : 'walk';
      let tSpeed = 0, turn = 0; const h0 = ctl.h;
      const fp = ctl.view === 'fp';
      if (fp) { ctl.h = C.yaw - input.look.dx; if (want) S.moveH = Math.atan2(mx, mz); S.legBack = want && S.ay < -.25; S.legWant = want ? clamp(angDiff(ctl.h, S.moveH + (S.legBack ? PI : 0)), -1.25, 1.25) : 0; tSpeed = want ? (aim ? SPEED.aim : gait === 'sprint' && S.ay < .5 ? SPEED.run : SPEED[gait] * (S.ay < -.3 && gait !== 'crouch' ? .8 : 1)) * mag : 0; }   // first person: the body stays square to the view, WASD strafes; sprint only forwards
      else if (aim) { ctl.h += angDiff(ctl.h, C.yaw) * (1 - Math.exp(-16 * dt)); tSpeed = want ? SPEED.aim * mag : 0; }
      else if (want) { const wh = Math.atan2(mx, mz), diff = angDiff(ctl.h, wh), rate = lerp(11.5, 5.2, sst(S.cmd, 1.4, 6.2)); S.moveH = wh;
        ctl.h += clamp(diff * (1 - Math.exp(-13 * dt)), -rate * dt, rate * dt); const ad = abs(diff); tSpeed = SPEED[gait] * mag * (ad > 1.9 ? .25 : ad > 1.0 ? .65 : 1); }
      turn = angDiff(h0, ctl.h) / max(dt, 1e-4); S.turn = damp(S.turn, turn, 9, dt);
      const acc = tSpeed > S.cmd ? (gait === 'sprint' ? 7.5 : gait === 'run' ? 8.5 : 6.5) : (S.cmd > 4.5 ? 9.5 : 11); S.cmd = approach(S.cmd, tSpeed, acc * dt); S.wantMove = want;
      /* pt1: Space jumps (on foot; a seated / ridden / taken-over hero never gets here). In the air the jump has its own step (airStep); on landing the ground step below takes over again */
      if (S.jump) { airStep(dt, mx, mz, want, fp); return; }
      if (S.landT > 0) S.landT = max(0, S.landT - dt);
      if (input.pressed('Space') && ctl.jumpKey !== false && dt > 0 && ctl.time - (S.jumpT || -9) > .32) { const gy0 = groundY(ctl.pos.x, ctl.pos.z, ctl.pos.y + .05); if (ctl.pos.y - gy0 < .08 && !S.dropH) { input.consume('Space'); startJump(mx, mz, want, fp); airStep(dt, mx, mz, want, fp); return; } }
      // integrate with sub-stepped capsule collision
      const px = ctl.pos.x, pz = ctl.pos.z; let vx, vz; if ((aim || fp) && want) { const l = hyp(mx, mz) || 1; vx = mx / l * S.cmd; vz = mz / l * S.cmd; } else if (fp) { vx = sin(S.moveH) * S.cmd; vz = cos(S.moveH) * S.cmd; } else { vx = sin(ctl.h) * S.cmd; vz = cos(ctl.h) * S.cmd; }
      const touched = S.cmd > .001 ? moveBody(ctl.pos, vx * dt, vz * dt, RAD) : false, hb = HIT.box, hnx = HIT.nx, hnz = HIT.nz;
      const moved = hyp(ctl.pos.x - px, ctl.pos.z - pz), real = dt > 0 ? moved / dt : 0; ctl.speed = damp(ctl.speed, real, 12, dt); if (touched) S.cmd = min(S.cmd, real + 1.2);
      if (dt > 0) { S.lvx = (ctl.pos.x - px) / dt; S.lvz = (ctl.pos.z - pz) / dt; }
      S.phase += moved; footfall(moved); { const y0 = ctl.pos.y, gy = groundY(ctl.pos.x, ctl.pos.z, ctl.pos.y + .05); ctl.pos.y = stepY(y0, gy, dt);
        /* alive layer: 'land' {h, x, y, z, kind} when a drop of more than 0.3 m ends (the vault fires its own) */
        if (y0 - gy > .3 && !S.dropH) S.dropH = y0 - gy; else if (S.dropH && ctl.pos.y - gy < .02) { emit('land', { h: S.dropH, kind: 'drop', x: ctl.pos.x, y: gy, z: ctl.pos.z, surface: surfAt(ctl.pos.x, ctl.pos.z) }); S.dropH = 0; } }
      // vault: sprinting square into something low and thin
      if (touched && gait === 'sprint' && S.cmd > 2.5 && hb && !hb.group && !/counter|glass|window/i.test(hb.tag || '') && hb.h - ctl.pos.y <= 1.15 && (fp ? (hnx * vx + hnz * vz) / (hyp(vx, vz) || 1) : hnx * sin(ctl.h) + hnz * cos(ctl.h)) < -.8) tryVault(hb, hnx, hnz);
      ctl.state = ctl.armed && aim ? 'aim' : S.landT > 0 ? 'land' : locoState(ctl.speed, S.crouch); if (S.landT > 0) { const L = S.jpose || (S.jpose = {}); L.ph = 2; L.k = 1 - S.landT / (S.landDur || .2); }
    }
    /* pt1 jump: a 0.07 s dip, then a ballistic arc (g 18 m/s²) that keeps the run's momentum — standing ~0.75 m up, running ~0.9 m and 3 m on, a sprint ~4.5 m; a little air control.
       Boxes below the feet stop being walls (js/onfoot.js passable), so a kerb, a bench, a planter or a wall up to ~0.85 m can be landed on; anything taller still stops you. */
    const JG = 18;
    function startJump(mx, mz, want, fp) { const sp = hyp(S.lvx || 0, S.lvz || 0), run = sst(sp, 2.2, 5.5), boost = 1 + .1 * run; let vx = (S.lvx || 0) * boost, vz = (S.lvz || 0) * boost;
      if (sp < 1 && want) { const l = hyp(mx, mz) || 1; vx = mx / l * 1.7; vz = mz / l * 1.7; }   /* a standing jump with a direction held still hops a step that way */
      const vy = lerp(5.2, 5.75, run); S.crouch = false; S.jump = { ph: 0, t: 0, pre: .07, vx, vz, vy, vy0: vy, y0: ctl.pos.y, top: ctl.pos.y, run, fp }; S.jumpT = ctl.time; S.landT = 0;
      S.stepAcc = 99; footfall(0); emit('jump', { x: ctl.pos.x, y: ctl.pos.y, z: ctl.pos.z, run, speed: sp }); }
    function airStep(dt, mx, mz, want, fp) { const J = S.jump; J.t += dt; const L = S.jpose || (S.jpose = {}); L.run = J.run;
      if (J.ph === 0) { L.ph = 0; L.k = min(1, J.t / J.pre); const ox = ctl.pos.x, oz = ctl.pos.z; moveBody(ctl.pos, J.vx * dt * .6, J.vz * dt * .6, RAD); S.phase += hyp(ctl.pos.x - ox, ctl.pos.z - oz); ctl.state = 'jump0'; S.arc = 0; if (J.t >= J.pre) { J.ph = 1; J.t = 0; } return; }
      if (want) { const l = hyp(mx, mz) || 1, cap = max(hyp(J.vx, J.vz), 1.6), a = 3.2 * dt; J.vx += mx / l * a; J.vz += mz / l * a; const h = hyp(J.vx, J.vz); if (h > cap) { J.vx *= cap / h; J.vz *= cap / h; } }
      else { const k = Math.exp(-2.2 * dt); J.vx *= k; J.vz *= k; }   /* let go of the keys in the air and the jump shortens: that is how you land ON a bench instead of over it */
      const y0 = ctl.pos.y; J.vy -= JG * dt; ctl.pos.y += J.vy * dt; J.top = max(J.top, ctl.pos.y);
      const ox = ctl.pos.x, oz = ctl.pos.z; moveBody(ctl.pos, J.vx * dt, J.vz * dt, RAD);   /* the wish to go forward is kept against a wall: once the feet clear its top the jump carries on over it */
      const mv = hyp(ctl.pos.x - ox, ctl.pos.z - oz); ctl.speed = damp(ctl.speed, mv / max(dt, 1e-4), 12, dt); S.phase += mv * .3; S.lvx = J.vx; S.lvz = J.vz;
      if (!fp && hyp(J.vx, J.vz) > .6) ctl.h += angDiff(ctl.h, Math.atan2(J.vx, J.vz)) * min(1, dt * 6);
      const gy = groundY(ctl.pos.x, ctl.pos.z, max(y0, ctl.pos.y) + .02); S.arc = max(0, min(ctl.pos.y, J.top) - max(J.y0, gy > J.y0 + .05 ? J.y0 : gy));
      L.ph = 1; L.u = clamp(J.vy / J.vy0, -1, 1); ctl.state = 'jump';
      if (J.vy <= 0 && ctl.pos.y <= gy) { const fall = J.top - gy; ctl.pos.y = gy; S.jump = null; S.arc = 0; S.cmd = min(hyp(J.vx, J.vz), SPEED.sprint || 7); S.landDur = J.run > .5 && want ? .13 : .24; S.landT = S.landDur; L.ph = 2; L.k = 0; L.h = clamp(fall / 1.1, .2, 1);
        emit('land', { h: max(.35, fall), kind: 'jump', x: ctl.pos.x, y: gy, z: ctl.pos.z, surface: surfAt(ctl.pos.x, ctl.pos.z) }); }
      else if (J.t > 4) { ctl.pos.y = gy; S.jump = null; S.arc = 0; } }
    /** footfalls: emits 'step' {foot, speed, surface} (and calls GT.audio.footstep if a later audio pass provides it) */
    function footfall(moved) { S.stepAcc = (S.stepAcc || 0) + moved; const stride = ctl.speed > 5 ? 1.3 : ctl.speed > 2.5 ? 1.02 : .7; if (S.stepAcc < stride) return; S.stepAcc = 0; S.foot = S.foot ? 0 : 1;
      const surface = surfAt(ctl.pos.x, ctl.pos.z), e = { foot: S.foot ? 'R' : 'L', speed: ctl.speed, surface: ctl.zone && ctl.zone.indoor ? 'indoor' : surface, crouch: S.crouch, x: ctl.pos.x, y: ctl.pos.y, z: ctl.pos.z, h: ctl.h, zone: ctl.zone ? ctl.zone.id : null };   // alive layer: where the foot landed (surface-specific sound, dust / splash)
      emit('step', e); if (GT.audio && GT.audio.footstep) safe(() => GT.audio.footstep(e)); }
    function stepY(y, g, dt) { return g > y ? min(g, y + max(.02, (g - y)) * min(1, dt * 16)) : max(g, y - max(.02, (y - g)) * min(1, dt * 12)); }
    function tryVault(b, nx, nz) { const thick = abs(nx) > .5 ? b.x1 - b.x0 : b.z1 - b.z0; if (thick > 1.3) return; const d = thick + RAD * 2 + .25, tx = ctl.pos.x - nx * d, tz = ctl.pos.z - nz * d; if (!isFree(tx, tz, RAD)) return;
      const y0 = ctl.pos.y, y1 = groundY(tx, tz), top = b.h + .08, x0 = ctl.pos.x, z0 = ctl.pos.z, hh = Math.atan2(-nx, -nz), dur = .52 + thick * .12; let t = 0;
      ctl.takeover({ heroState: 'sprint', _internal: true, update(dt) { t += dt; const u = min(1, t / dur), e = u * u * (3 - 2 * u); ctl.pos.x = lerp(x0, tx, u); ctl.pos.z = lerp(z0, tz, u); S.arc = sin(PI * u) * (top - min(y0, y1)) * .92; ctl.pos.y = lerp(y0, y1, e) + S.arc; ctl.h += angDiff(ctl.h, hh) * min(1, dt * 12); S.cmd = 4.2; ctl.speed = d / dur; return u >= 1; }, onEnd() { S.arc = 0; emit('land', { h: max(.5, top - y1), kind: 'vault', x: ctl.pos.x, y: ctl.pos.y, z: ctl.pos.z, surface: surfAt(ctl.pos.x, ctl.pos.z) }); } }); }

    /* ---------------------------------------------------------------- takeover */
    ctl.takeover = t => { if (!t || typeof t.update !== 'function') return null; if (TK) endTakeover(); TK = { o: t, t: 0 }; S.ax = S.ay = 0; if (!t._internal) { S.cmd = 0; }
      if (t.camera) { CAM.ov.fn = t.camera; CAM.ov.manual = !!t._manual; CAM.ov.inT = t.blend !== undefined ? max(.01, t.blend) : .45; CAM.ov.outT = t.blendOut !== undefined ? max(.01, t.blendOut) : .5; CAM.ov.hold = false; }
      return { end: () => { if (TK && TK.o === t) endTakeover(); } }; };
    function endTakeover() { const t = TK; TK = null; if (!t) return; if (CAM.ov.fn === t.o.camera) CAM.ov.fn = null; safe(() => t.o.onEnd && t.o.onEnd()); }
    Object.defineProperty(ctl, 'busy', { get: () => !!TK || !!ctl.seated });

    /* ---------------------------------------------------------------- say */
    ctl.say = (who, text, seconds) => { if (!text) return ctl; if (who === '阿烈' || who === 'lie') P.talkT = seconds > 0 ? seconds : clamp(1.3 + String(text).length * .16, 1.9, 7); if (GT.front && GT.front.subtitle) { const ok = safe(() => { GT.front.subtitle(who, text, seconds); return true; }, false); if (ok) return ctl; }
      UI.subQ.push({ who: who || '', text: String(text), sec: seconds > 0 ? seconds : clamp(1.3 + String(text).length * .16, 1.9, 7) }); return ctl; };

    /* ---------------------------------------------------------------- partner */
    const trail = [];
    const P = { fig: pfig, x: 0, z: 0, y: 0, h: 0, cmd: 0, speed: 0, turn: 0, state: 'follow', anim: 'idle', animT: 0, mode: pfig ? 'follow' : 'none', path: null, then: null, slot: 0, slotT: 0, idleT: 0, moving: false, stuckT: 0, sx: 0, sz: 0, stuckN: 0, lookYaw: 0,
      lean: null, leanTried: 0, yieldT: 0, yx: 0, yz: 0, gotoT: 0, placed: false, hSlot: 0, phoneT: 0, car: null, hidden: false, faceH: null };
    const partner = ctl.partner = {
      follow(b) { if (!pfig) return partner; if (P.mode === 'car' || P.mode === 'pillion') return partner; P.boarding = null; P.mode = b === false ? 'hold' : 'follow'; P.path = null; P.then = null; P.lean = null; P.idleT = 0; return partner; },
      goTo(x, z, then, o) { if (!pfig) { if (then) safe(then); return partner; } if (P.mode === 'car') partnerOutOfCar(); if (P.mode === 'pillion') { P.car = null; } P.pk = 0; P.seq = null; P.hidden = false; P.mode = 'goto'; P.path = Array.isArray(x) ? x.map(q => ({ x: q.x, z: q.z })) : [{ x, z }]; P.then = typeof z === 'function' ? z : (then || null); P.faceH = o && o.h !== undefined ? o.h : (Array.isArray(x) && then && typeof then === 'object' ? then.h : null);
        P.gotoT = 0; P.lean = null; P.idleT = 0; P.stuckN = 0; return partner; },
      teleport(x, z, h) { if (!pfig) return partner; P.x = x; P.z = z; P.y = groundY(x, z); if (h !== undefined) P.h = h; P.cmd = 0; P.placed = true; P.lean = null; return partner; },
      get state() { return P.state; }, get pos() { return { x: P.x, y: P.y, z: P.z }; }, get h() { return P.h; }, get fig() { return pfig ? pfig.src : null; }
    };
    // candidate standing spots as [away from the camera shoulder (left by default), forward] offsets from the player. Abreast is home; the ring is the fallback in tight places.
    const SLOTS = [[1.15, 0], [1.5, .45], [1.2, .9], [1.15, -1.0], [-1.5, .4], [-1.25, 1.2]];   // home = abreast on the far side from the camera shoulder: fully in frame (left-rear sat exactly on the frame edge and got sliced)
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + .26; SLOTS.push([sin(a) * 1.75, cos(a) * 1.75]); } for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; SLOTS.push([sin(a) * 2.5, cos(a) * 2.5]); } for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + .39; SLOTS.push([sin(a) * 3.5, cos(a) * 3.5]); }   // outer ring: last resort when everything near is in front of the lens
    function slotPos(i, o) { const h = P.hSlot, s = SLOTS[i], sd = s[0] * (ctl.camera.shoulder === 'L' ? -1 : 1); o.x = ctl.pos.x + cos(h) * sd + sin(h) * s[1]; o.z = ctl.pos.z - sin(h) * sd + cos(h) * s[1]; return o; }
    /** distance from a point to the camera boom (player's head -> camera), so 阿烈 never parks himself in front of the lens */
    function boomDist(x, z) { const ax = ctl.pos.x, az = ctl.pos.z, bx = CAM.out.x, bz = CAM.out.z, dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; if (l2 < .01 || CAM.ov.w > .5) return 9; const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, .25, 1.25); return hyp(x - ax - dx * t, z - az - dz * t); }
    function boomDist2(x, z) { return min(boomDist(x, z), CAM.ov.w > .5 ? 9 : hyp(x - CAM.out.x, z - CAM.out.z) - (P.camPad || 1.2)); }
    /** true where a standing figure would be sliced by the left/right frame edge at close range — an ugly half-silhouette; idle 阿烈 prefers fully in or fully out */
    function edgeBand(x, z) { if (CAM.ov.w > .5) return false; const C = ctl.camera, dx = x - CAM.out.x, dz = z - CAM.out.z, dep = dx * sin(C.yaw) + dz * cos(C.yaw); if (dep < .3 || dep > 3.6) return false; const r = abs(dx * cos(C.yaw) - dz * sin(C.yaw)) / dep, k = Math.tan(CAM.outFov * PI / 360) * (camera ? camera.aspect : 1.78); return r > k * .7 && r < k * 1.3; }
    function slotOk(k, o) { slotPos(k, o); return isFree(o.x, o.z, PRAD + .04) && segClear(ctl.pos.x, ctl.pos.z, o.x, o.z, .1); }
    /** true in doorways / gaps: something solid close on two opposite sides — 阿烈 never stops there */
    function narrow(x, z) { return (!isFree(x + .8, z, .12) && !isFree(x - .8, z, .12)) || (!isFree(x, z + .8, .12) && !isFree(x, z - .8, .12)); }
    function pickSlot() { let best = 1, bs = 1e9; const hx = SLOTS[0][0], hz = SLOTS[0][1];
      for (let k = 0; k < SLOTS.length; k++) { if (!slotOk(k, _w)) continue; const bd = boomDist2(_w.x, _w.z), s = SLOTS[k]; let sc = hyp(s[0] - hx, s[1] - hz) + (k > 5 ? .6 : 0) + (bd < .75 ? 6 + (.75 - bd) * 4 : 0) + (edgeBand(_w.x, _w.z) ? (P.camPad > 1 ? 1.6 : .9) : 0) - (k === P.slot ? .5 : 0) + (narrow(_w.x, _w.z) ? 3 : 0); if (sc < bs) { bs = sc; best = k; } if (k === 0 && sc < .01) break; }
      return best; }
    function partnerTeleport() { const C = ctl.camera, bx = -sin(C.yaw), bz = -cos(C.yaw), rx = -cos(C.yaw), rz = sin(C.yaw), cx = CAM.out.x, cz = CAM.out.z;
      for (let i = 0; i < 6; i++) for (const j of [0, -1, 1, -2, 2]) { const x = cx + bx * (1.3 + i * .8) + rx * j * .9, z = cz + bz * (1.3 + i * .8) + rz * j * .9; if (hyp(x - ctl.pos.x, z - ctl.pos.z) < 1.2 || !isFree(x, z, PRAD + .05)) continue; if (!segClear(x, z, ctl.pos.x, ctl.pos.z, .1)) continue;
        partner.teleport(x, z, Math.atan2(ctl.pos.x - x, ctl.pos.z - z)); return true; }
      for (let k = 0; k < SLOTS.length; k++) { slotPos(k, _w); if (isFree(_w.x, _w.z, PRAD)) { partner.teleport(_w.x, _w.z, ctl.h); return true; } } return false; }
    function findLean() { const B = boxesIn(P.x - 1.7, P.z - 1.7, P.x + 1.7, P.z + 1.7); let best = null, bd = 1.7;
      for (const b of B) { if (b.h < 1.9 || /pump|pole|column|pylon|bollard|tree|palm|post|sign/i.test(b.tag || '')) continue; const cx = clamp(P.x, b.x0, b.x1), cz = clamp(P.z, b.z0, b.z1), dx = P.x - cx, dz = P.z - cz, d = hyp(dx, dz); if (d < .05 || d > bd) continue;
        let nx = 0, nz = 0, len; if (abs(dx) > abs(dz)) { nx = Math.sign(dx); len = min(cz - b.z0, b.z1 - cz); } else { nz = Math.sign(dz); len = min(cx - b.x0, b.x1 - cx); } if (len < .7) continue;
        const lx = cx + nx * .31, lz = cz + nz * .31; if (hyp(lx - ctl.pos.x, lz - ctl.pos.z) < 1.1 || !isFree(lx, lz, .22) || boomDist(lx, lz) < .8) continue; let nearSpot = false; for (const s of ACT.list) if (hyp(s.x - lx, s.z - lz) < 1.6) { nearSpot = true; break; } if (nearSpot) continue;
        const dr = GT.world.anchors && GT.world.anchors.storeDoor; if (dr && hyp(dr.x - lx, dr.z - lz) < 2.6) continue; bd = d; best = { x: lx, z: lz, h: Math.atan2(nx, nz) }; }
      return best; }
    function partnerOutOfCar() { if (P.mode !== 'car') return; const v = P.car; P.car = null; P.mode = 'follow'; P.hidden = false; if (v) { doorPoint(v, -1, _w); partner.teleport(_w.x, _w.z, v.h); } }
    function partnerUpdate(dt) {
      if (!pfig) return; const g = pfig.group;
      if (!P.placed) { P.hSlot = ctl.h; P.slot = pickSlot(); slotPos(P.slot, _w); partner.teleport(_w.x, _w.z, ctl.h); }
      if (P.mode === 'car') { P.state = 'car'; g.visible = false; if (P.car) { P.x = P.car.x; P.z = P.car.z; } return; }
      if (P.mode === 'pillion') { const v = P.car; P.state = 'ride'; if (!v || !v.group || !P.pl) { P.mode = 'follow'; P.pk = 0; return; } P.x = v.x; P.z = v.z; P.y = v.y; P.h = v.h; g.visible = true; v.group.getWorldQuaternion(_q1); g.quaternion.copy(_q1); g.position.set(v.x, v.y, v.z);
        pfig.update(dt, { state: 'ride', speed: ctl.speed, turn: 0, lookYaw: 0, lookPitch: 0, t: P.animT += dt, pillion: true }); pinHips(pfig, v, P.pl, 1); return; }
      if (P.seq) { if (P.seq(dt)) P.seq = null; g.visible = !P.hidden; g.position.set(P.x, P.y, P.z); g.rotation.set(0, P.h, 0); pfig.update(dt, { state: P.anim, speed: 0, turn: 0, lookYaw: 0, lookPitch: 0, t: P.animT += dt }); if (P.pk > 0 && P.car && P.pl) pinHips(pfig, P.car, P.pl, P.pk); return; }
      // breadcrumbs of the player's path (used to get through doors and around corners)
      const lt = trail[trail.length - 1]; if (!lt || hyp(lt.x - ctl.pos.x, lt.z - ctl.pos.z) > .55) { trail.push({ x: ctl.pos.x, z: ctl.pos.z }); if (trail.length > 48) trail.shift(); }
      const dP = hyp(ctl.pos.x - P.x, ctl.pos.z - P.z), playerMoving = ctl.speed > .25; let gx = P.x, gz = P.z, maxV = 0, arrive = .3, wantGo = false, slow = false;
      if (P.mode === 'follow') {
        if (playerMoving) P.hSlot += angDiff(P.hSlot, ctl.h) * min(1, dt * 3.5); P.camPad = playerMoving ? 1.0 : 1.9;   // single file close behind the lens is fine on the move; standing still he keeps his face away from it
        P.slotT -= dt; if (P.slotT <= 0) { P.slotT = .3; slotPos(P.slot, _w); P.boomT = boomDist2(_w.x, _w.z) < .62 || (!playerMoving && !P.moving && !P.lean && edgeBand(P.x, P.z)) ? (P.boomT || 0) + .3 : 0; P.lensT = CAM.ov.w < .5 && hyp(P.x - CAM.out.x, P.z - CAM.out.z) < 1.9 ? 1.5 : max(0, (P.lensT || 0) - .3); if (P.lensT >= 1.5 && !playerMoving) P.boomT += 1.5;   // the lens has swung right onto him: move now, briskly
          if (!slotOk(P.slot, _w) || P.boomT > (playerMoving ? .6 : .9) || (!playerMoving && narrow(_w.x, _w.z)) || (P.slot !== 0 && playerMoving)) { const k = pickSlot(); if (k !== P.slot) { P.slot = k; P.lean = null; } } }
        slotPos(P.slot, _w); gx = _w.x; gz = _w.z; const d = hyp(gx - P.x, gz - P.z);
        // someone walking straight at us in a tight spot: step aside
        if (!P.moving && playerMoving && dP < 1.5) { const vx = sin(ctl.h), vz = cos(ctl.h), tx = (P.x - ctl.pos.x) / (dP || 1), tz = (P.z - ctl.pos.z) / (dP || 1); if (vx * tx + vz * tz > .55 && P.yieldT <= 0) { const side = (vx * tz - vz * tx) > 0 ? 1 : -1;
            for (const sg of [side, -side]) { const x = P.x + (-vz) * sg * -1.0, z = P.z + vx * sg * -1.0; if (isFree(x, z, PRAD)) { P.yx = x; P.yz = z; P.yieldT = .9; break; } } } }
        if (P.yieldT > 0) { P.yieldT -= dt; gx = P.yx; gz = P.yz; }
        const dd = hyp(gx - P.x, gz - P.z); wantGo = P.moving ? dd > .28 : (dd > (playerMoving ? .55 : boomDist2(P.x, P.z) < .62 || edgeBand(P.x, P.z) ? .3 : 1.05) || P.yieldT > 0);   // loitering short of the slot is fine unless that leaves him in front of the lens
        if (P.lean && boomDist(P.lean.x, P.lean.z) < .6) P.lean = null;
        if (P.lean && !playerMoving && dP < 6) { gx = P.lean.x; gz = P.lean.z; wantGo = hyp(gx - P.x, gz - P.z) > .12; arrive = .1; } else if (P.lean) P.lean = null;
        maxV = dd > 7 ? clamp(ctl.speed + 1.5, 6.1, 7.8) : dd > 2.4 ? max(3.8, ctl.speed + .9) : max(1.5, min(ctl.speed * 1.12 + .35, 4.2)); if (!playerMoving && dd < 2.4) maxV = P.lensT > 0 ? 2.5 : 1.6;
        // the slot is behind us while the player walks on: never turn round to fetch it — ease off and let it catch up
        if (playerMoving && dd < 2.8 && !P.lean && P.yieldT <= 0) { const hx = sin(ctl.h), hz = cos(ctl.h), f = (gx - P.x) * hx + (gz - P.z) * hz; if (f < .1) { const lat = (gx - P.x) * hz - (gz - P.z) * hx; gx = P.x + hx * 1.6 + hz * clamp(lat, -.8, .8); gz = P.z + hz * 1.6 - hx * clamp(lat, -.8, .8); maxV = max(.5, ctl.speed * (f < -.6 ? .45 : .75)); wantGo = true; slow = true; } }
        // no straight line to the slot (door, corner): follow the player's breadcrumbs instead
        if (wantGo && !P.lean && !segClear(P.x, P.z, gx, gz, PRAD * .8)) { let found = false; for (let i = trail.length - 1; i >= 0; i--) { const q = trail[i]; if (hyp(q.x - P.x, q.z - P.z) > .35 && segClear(P.x, P.z, q.x, q.z, PRAD * .8)) { gx = q.x; gz = q.z; found = true; break; } }
          if (!found && segClear(P.x, P.z, ctl.pos.x, ctl.pos.z, .1)) { gx = ctl.pos.x; gz = ctl.pos.z; } arrive = .2;
          if (hyp(gx - ctl.pos.x, gz - ctl.pos.z) < 1.25) { arrive = 2.0; if (dP < 1.4) wantGo = false; } }                 // the crumb is the player himself: stop short, never run into his back
        if (dP > 40) { partnerTeleport(); return; }
      } else if (P.mode === 'goto' && P.path && P.path.length) { const q = P.path[0]; gx = q.x; gz = q.z; const last = P.path.length === 1, d = hyp(gx - P.x, gz - P.z); arrive = last ? .14 : .4; maxV = d > 3 || !last ? 3.6 : 1.7; wantGo = true; P.gotoT += dt;
        if (d < arrive || P.gotoT > 9) { if (P.gotoT > 9) { const e = P.path[P.path.length - 1]; P.x = e.x; P.z = e.z; P.path.length = 1; } P.path.shift(); P.gotoT = 0;
          if (!P.path.length) { P.mode = 'hold'; P.path = null; if (P.faceH !== null && P.faceH !== undefined) P.h = P.faceH; const th = P.then; P.then = null; P.cmd = 0; if (th) safe(th); } wantGo = false; } }
      // steering
      const h0 = P.h; let tV = 0;
      if (wantGo) { let dx = gx - P.x, dz = gz - P.z; const d = hyp(dx, dz) || 1; dx /= d; dz /= d;
        if (P.mode === 'follow' && dP < 1.25 && dP > .01 && !P.lean) { const k = (1.25 - dP) * 2.6; dx += (P.x - ctl.pos.x) / dP * k; dz += (P.z - ctl.pos.z) / dP * k; }
        let wh = Math.atan2(dx, dz);
        if (d > .6) { const probe = min(.95, d); if (!isFree(P.x + sin(wh) * probe, P.z + cos(wh) * probe, PRAD * .9, P.skipVeh)) { for (const a of [.6, -.6, 1.15, -1.15, 1.75, -1.75]) { const hh = wh + a * (P.avoidSide || 1); if (isFree(P.x + sin(hh) * probe, P.z + cos(hh) * probe, PRAD * .9, P.skipVeh)) { wh = hh; P.avoidSide = Math.sign(a * (P.avoidSide || 1)); break; } } } }
        const diff = angDiff(P.h, wh), rate = lerp(10, 5.5, sst(P.cmd, 1.4, 6)); P.h += clamp(diff * (1 - Math.exp(-12 * dt)), -rate * dt, rate * dt);
        tV = (slow ? maxV : min(maxV, max(.5, (d - arrive * .5) * 3.2))) * (abs(diff) > 1.8 ? .3 : abs(diff) > 1 ? .65 : 1); P.moving = true; P.idleT = 0;
      } else { P.moving = false; P.idleT += dt; }
      P.cmd = approach(P.cmd, tV, (tV > P.cmd ? 7.5 : 11) * dt);
      const ox = P.x, oz = P.z; if (P.cmd > .001) { const b = { x: P.x, y: P.y, z: P.z }; moveBody(b, sin(P.h) * P.cmd * dt, cos(P.h) * P.cmd * dt, P.lean && hyp(gx - P.x, gz - P.z) < .5 ? .2 : PRAD, P.skipVeh); P.x = b.x; P.z = b.z; }
      // never overlap the player
      { const dx = P.x - ctl.pos.x, dz = P.z - ctl.pos.z, d = hyp(dx, dz), m = .72; if (d < m && !TK) { const k = d > 1e-3 ? (m - d) / d : 0; if (d > 1e-3) { const b = { x: P.x + dx * k, y: P.y, z: P.z + dz * k }; resolve(b, PRAD); P.x = b.x; P.z = b.z; } else P.x += m; } }
      const real = dt > 0 ? hyp(P.x - ox, P.z - oz) / dt : 0; P.speed = damp(P.speed, real, 12, dt); P.turn = damp(P.turn, angDiff(h0, P.h) / max(dt, 1e-4), 9, dt); P.y = stepY(P.y, groundY(P.x, P.z, P.y + .05), dt);
      // stuck -> quiet teleport (follow) or snap (goto)
      P.stuckT += dt; if (P.stuckT > 1.2) { const m = hyp(P.x - P.sx, P.z - P.sz); P.stuckN = wantGo && m < .3 && P.yieldT <= 0 ? P.stuckN + 1 : 0; P.sx = P.x; P.sz = P.z; P.stuckT = 0;
        if (P.stuckN >= 3) { P.stuckN = 0; if (P.mode === 'follow') { if (dP > 3.5) partnerTeleport(); } else if (P.mode === 'goto' && P.path && P.path.length) { const q = P.path[0]; P.x = q.x; P.z = q.z; } } }
      // idle life: face where the player faces, look around, lean on a wall or check the phone
      let anim = locoState(P.speed, false), lookYaw = 0; if (P.talkT > 0) P.talkT -= dt;
      if (!P.moving && P.speed < .2) { anim = 'idle';
        if (P.mode === 'hold' && P.faceH !== null && P.faceH !== undefined) P.h += angDiff(P.h, P.faceH) * min(1, dt * 6);
        else if (P.lean && hyp(P.lean.x - P.x, P.lean.z - P.z) < .16) { P.h += angDiff(P.h, P.lean.h) * min(1, dt * 7); anim = 'lean'; }
        else if (P.idleT > .5 && P.idleT < 3) { const th = Math.atan2(ctl.pos.x + sin(ctl.h) * 4 - P.x, ctl.pos.z + cos(ctl.h) * 4 - P.z); if (abs(angDiff(P.h, th)) > .5) P.h += clamp(angDiff(P.h, th), -2.4 * dt, 2.4 * dt); }
        if (P.mode === 'follow' && !P.lean && P.idleT > 4.5 && ctl.time - P.leanTried > 4) { P.leanTried = ctl.time; P.lean = findLean(); }
        if (!P.lean && P.idleT > 9 && ((P.idleT - 9) % 16) < 7) anim = 'phone'; if (P.talkT > 0 && anim !== 'lean') anim = 'talk';
        const toP = clamp(angDiff(P.h, Math.atan2(ctl.pos.x - P.x, ctl.pos.z - P.z)), -1.1, 1.1), w = P.idleT > 1.5 ? sst(sin(ctl.time * .43 + 1.3), -.2, .6) : 0; lookYaw = anim === 'phone' ? 0 : lerp(sin(ctl.time * .31) * .75 + sin(ctl.time * .83) * .2, toP, w) * sst(P.idleT, .8, 2.2);
      } else if (P.speed > .3 && dP < 4) lookYaw = clamp(angDiff(P.h, Math.atan2(ctl.pos.x - P.x, ctl.pos.z - P.z)), -.7, .7) * .35 * sst(sin(ctl.time * .5), .2, .9);
      P.lookYaw = damp(P.lookYaw, lookYaw, 4, dt); if (anim !== P.anim) { P.anim = anim; P.animT = 0; } P.animT += dt;
      P.state = P.mode === 'goto' ? 'goto' : P.mode === 'hold' ? 'hold' : anim === 'lean' ? 'lean' : P.moving ? 'follow' : 'idle';
      g.visible = !P.hidden; g.position.set(P.x, P.y, P.z); g.rotation.set(0, P.h, 0); pfig.update(dt, { state: anim, speed: P.speed, turn: P.turn, lookYaw: P.lookYaw, lookPitch: 0, t: P.animT });
    }

    /* ---------------------------------------------------------------- vehicles: door spots + enter / exit choreography */
    function doorPoint(v, side, o) { const e = v.dims.eye || [.37, 1.1, -.1]; return fromCar(v, side * (v.hw + .5), (Array.isArray(e) ? e[2] : e.z) + .12, o); }
    function eyeLocal(v) { const e = v.dims.eye || [.37, 1.1, -.1]; return Array.isArray(e) ? e : [e.x, e.y, e.z]; }
    /** waypoints from a point to a door of the car, walking round the nearest end if the car is in the way */
    function carPath(v, fx, fz, side, lzT, off) { const dz = lzT !== undefined ? lzT : eyeLocal(v)[2] + .12, door = fromCar(v, side * (v.hw + (off || .5)), dz, { x: 0, z: 0 }), out = [], l = toCar(v, fx, fz, { x: 0, z: 0 }), m = .62, sx = l.x * side;
      if (sx < v.hw + .15) { const end = (abs(l.z - v.hl) + abs(dz - v.hl)) <= (abs(l.z + v.hl) + abs(dz + v.hl)) ? 1 : -1, ez = end * (v.hl + m);
        if (abs(l.z) < v.hl + m * .7) out.push(fromCar(v, -side * (v.hw + m), ez, { x: 0, z: 0 }));       // on the far flank: clear that corner first
        out.push(fromCar(v, side * (v.hw + m), ez, { x: 0, z: 0 })); }
      out.push(door); return out; }
    function doorSide(v, prefer) { const a = doorPoint(v, prefer, { x: 0, z: 0 }); if (isFree(a.x, a.z, RAD * .8, v)) return prefer; const b = doorPoint(v, -prefer, { x: 0, z: 0 }); return isFree(b.x, b.z, RAD * .8, v) ? -prefer : prefer; }
    function vehRec(src, i) { const d = src.dims || {}, two = !!(src.twoWheeler || d.twoWheeler);
      return { src, group: src.group, kind: src.kind || (two ? 'escooter' : 'car'), dims: d, two, hw: (d.W || (two ? .68 : 1.85)) / 2, hl: (d.L || (two ? 1.8 : 4.7)) / 2, H: d.H || (two ? 1.12 : 1.4), x: 0, y: 0, z: 0, h: 0, c: 1, s: 0, spotId: i === undefined ? null : 'car:' + i }; }
    /** vehicles the hero can walk around, get into (cars: first-person cockpit hand-over) or swing a leg over (vehicle.twoWheeler: stays third person).
        item = GT.vehicles / GT.cnvehicles object: { group, dims:{L,W,H,eye}, twoWheeler?, seat?: [x,y,z] | Object3D, pillion?: true | [x,y,z] | Object3D, locked?, enter?: false, enterLabel?, passenger?: false, maxSpeed? } */
    ctl.setVehicles = list => { const was = ctl.seated && ctl.seated.src; for (const v of VEH) act.remove(v.spotId); VEH.length = 0;
      (list || []).forEach((src, i) => { if (!src || !src.group) return; const v = vehRec(src, i); VEH.push(v); src._onfoot = v; if (src === was) { ctl.seated = v; S.ride.v = v; }
        if (src.enter !== false) act.add({ id: v.spotId, x: 0, z: 0, r: v.two ? 2.05 : v.hl + 1.35, key: 'KeyF', label: () => typeof src.enterLabel === 'function' ? src.enterLabel() : (src.enterLabel || (v.two ? '骑车' : '上车')), mode: 'foot', vehicle: src, enabled: () => !src.locked && !ctl.seated && src.group.visible !== false, onUse: () => { ctl.playEnterCar(src, null); } }); });
      syncVehicles(); for (const v of VEH) { const s = act.get(v.spotId); if (s) { s.x = v.x; s.z = v.z; } } return ctl; };
    const vehOf = src => src && (src._onfoot && VEH.includes(src._onfoot) ? src._onfoot : VEH.find(v => v.src === src || v.group === src.group)) || null;
    function tempVeh(src) { const v = vehRec(src); src.group.updateMatrixWorld(); const e = src.group.matrixWorld.elements; v.x = e[12]; v.y = e[13]; v.z = e[14]; v.h = Math.atan2(e[8], e[10]); v.c = cos(v.h); v.s = sin(v.h); return v; }
    function eyePose(v, pos, look) { const e = eyeLocal(v); fromCar(v, e[0], e[2], _w); pos.set(_w.x, v.y + e[1], _w.z); look.set(_w.x + sin(v.h) * 10, v.y + e[1] - .35, _w.z + cos(v.h) * 10); }
    const sfx = n => { if (GT.audio && GT.audio.sfx) safe(() => GT.audio.sfx(n)); };
    /** walk to the driver's door, open it, slide in while the camera eases to the driver's eye. then() fires when seated; 'enterCar' is emitted with {vehicle}. */
    ctl.playEnterCar = (src, then) => { if (!src || !src.group || ctl.seated) { return false; } const v = vehOf(src) || tempVeh(src); syncVehicles(); if (v.two) return playMount(v, then); if (TK) endTakeover();
      const side = doorSide(v, 1), path = carPath(v, ctl.pos.x, ctl.pos.z, side), e = eyeLocal(v), fovEye = src.eyeFov || 62; let phase = 0, t = 0, walkT = 0, u = 0; const from = { x: 0, z: 0, h: 0, y: 0 };
      if (pfig && P.mode === 'follow' && src.passenger !== false) { const ps = doorSide(v, -side), pp = carPath(v, P.x, P.z, ps); P.skipVeh = null; P.boarding = v; partner.goTo(pp, () => { let tt = 0; const a = { x: P.x, z: P.z }, seat = fromCar(v, -e[0], e[2], { x: 0, z: 0 }); P.anim = 'use'; P.animT = 0;
          P.seq = dt => { tt += dt; P.h += angDiff(P.h, v.h + ps * -HP) * min(1, dt * 9); if (tt > .4 && P.anim !== 'enter_car') { P.anim = 'enter_car'; P.animT = 0; } const k = ease((tt - .45) / .7); P.x = lerp(a.x, seat.x, k); P.z = lerp(a.z, seat.z, k); if (k > .2) P.h += angDiff(P.h, v.h) * min(1, dt * 6); if (tt > 1.0) P.hidden = true; if (tt > 1.2) { P.mode = 'car'; P.car = v; P.hidden = false; P.boarding = null; return true; } return false; }; }, { h: v.h - ps * HP }); }
      ctl.takeover({ _internal: true, _manual: true, heroState: 'walk',
        camera() { // two-stage path: down to the driver's window first, then sideways into the seat — never through the roof
          eyePose(v, CAM.ov.pos, CAM.ov.look); const k = ease((u - .38) / .62); fromCar(v, side * (v.hw + .5), e[2] - .25, _w); _v1.set(_w.x, v.y + e[1] + .12, _w.z); CAM.ov.pos.lerpVectors(_v1, CAM.ov.pos, k);
          return { pos: CAM.ov.pos, look: CAM.ov.look, fov: fovEye, w: ease(u / .62), raw: true }; },
        update(dt) { t += dt;
          if (phase === 0) { walkT += dt; const q = path[0], last = path.length === 1, dx = q.x - ctl.pos.x, dz = q.z - ctl.pos.z, d = hyp(dx, dz), wh = Math.atan2(dx, dz), diff = angDiff(ctl.h, wh); ctl.h += clamp(diff * (1 - Math.exp(-12 * dt)), -9 * dt, 9 * dt);
            const tv = min(d > 2.2 || !last ? 3.3 : 1.6, max(.6, d * 3)) * (abs(diff) > 1.6 ? .35 : 1); S.cmd = approach(S.cmd, tv, 7 * dt); const ox = ctl.pos.x, oz = ctl.pos.z; moveBody(ctl.pos, sin(ctl.h) * S.cmd * dt, cos(ctl.h) * S.cmd * dt, RAD);
            ctl.speed = damp(ctl.speed, hyp(ctl.pos.x - ox, ctl.pos.z - oz) / max(dt, 1e-4), 12, dt); S.phase += hyp(ctl.pos.x - ox, ctl.pos.z - oz); ctl.pos.y = stepY(ctl.pos.y, groundY(ctl.pos.x, ctl.pos.z, ctl.pos.y + .05), dt); ctl.state = locoState(ctl.speed, false); ctl.camera.yaw += angDiff(ctl.camera.yaw, ctl.h) * min(1, dt * 2.2); S.wantMove = false;
            if (d < (last ? .12 : .38) || walkT > 7) { if (walkT > 7) { const z = path[path.length - 1]; ctl.pos.x = z.x; ctl.pos.z = z.z; path.length = 1; } path.shift(); if (!path.length) { phase = 1; t = 0; S.cmd = 0; } }
          } else if (phase === 1) {          // door-open beat: square up to the car, reach for the handle
            ctl.speed = damp(ctl.speed, 0, 14, dt); ctl.h += angDiff(ctl.h, v.h - side * HP) * min(1, dt * 10); ctl.state = 'use'; ctl.camera.yaw += angDiff(ctl.camera.yaw, v.h - side * .5) * min(1, dt * 2.2); ctl.camera.pitch = damp(ctl.camera.pitch, .16, 3, dt);
            if (t > .5) { phase = 2; t = 0; sfx('door_open'); from.x = ctl.pos.x; from.z = ctl.pos.z; from.y = ctl.pos.y; from.h = ctl.h; }
          } else if (phase === 2) {          // slide in; camera eases to the driver's eye
            const D = 1.05; u = ease(t / D); const seat = fromCar(v, e[0], e[2], _w), k = ease((t - .08) / (D * .8)); ctl.pos.x = lerp(from.x, seat.x, k); ctl.pos.z = lerp(from.z, seat.z, k); ctl.pos.y = from.y; ctl.h = from.h + angDiff(from.h, v.h) * ease((t - .25) / (D * .6)); ctl.state = 'enter_car'; ctl.speed = 0;
            ctl.camera.yaw += angDiff(ctl.camera.yaw, v.h) * min(1, dt * 3);
            if (t >= D) { u = 1; return true; } }
          return false; },
        onEnd() { if (phase < 2 || u < 1) return; ctl.seated = v; CAM.ov.hold = true; sfx('door_close'); ctl.state = 'sit'; if (then) safe(() => then(src)); emit('enterCar', { vehicle: src, ctl }); } });
      return true; };
    /** reverse: starts from wherever the camera is right now (the cockpit view), hero steps out of the driver's door, control returns. Sets ctl.enabled = true. */
    ctl.playExitCar = (src, then) => { src = src || (ctl.seated && ctl.seated.src); if (!src || !src.group) return false; const v = vehOf(src) || tempVeh(src); syncVehicles(); if (v.two) return playDismount(v, then); if (TK) endTakeover(); ctl.enabled = true; ctl.seated = null; S.mode = 'foot';
      const e = eyeLocal(v), seat = fromCar(v, e[0], e[2], { x: 0, z: 0 }), door = doorPoint(v, 1, { x: 0, z: 0 }); let side = 1; if (!isFree(door.x, door.z, RAD * .9, v)) { const d2 = doorPoint(v, -1, { x: 0, z: 0 }); if (isFree(d2.x, d2.z, RAD * .9, v)) { door.x = d2.x; door.z = d2.z; side = -1; seat.x = fromCar(v, -e[0], e[2], _w).x; seat.z = _w.z; } }
      const p0 = camera ? camera.position.clone() : new T.Vector3(), l0 = new T.Vector3(0, 0, -1), f0 = camera ? camera.fov : 62; if (camera) { camera.getWorldDirection(l0); } l0.multiplyScalar(10).add(p0);
      ctl.pos.x = seat.x; ctl.pos.z = seat.z; ctl.pos.y = groundY(door.x, door.z); ctl.h = v.h; ctl.camera.yaw = v.h + side * .35; ctl.camera.pitch = .14; S.cmd = 0; ctl.speed = 0; CAM.init = false; trail.length = 0; let t = 0, u = 0; const D = 1.15; sfx('door_open');
      if (pfig && P.mode === 'car') { const pd = doorPoint(v, -side, { x: 0, z: 0 }), ps = fromCar(v, -side * e[0], e[2], { x: 0, z: 0 }); P.mode = 'follow'; P.car = null; P.x = ps.x; P.z = ps.z; P.y = groundY(pd.x, pd.z); P.h = v.h; P.hidden = true; P.anim = 'exit_car'; P.animT = 0; P.placed = true; let tt = 0;
        P.seq = dt => { tt += dt; if (tt > .35) P.hidden = false; const k = ease((tt - .3) / .8); P.x = lerp(ps.x, pd.x, k); P.z = lerp(ps.z, pd.z, k); P.h = v.h - side * -HP * k * .6; return tt > 1.2; }; }
      ctl.takeover({ _internal: true, _manual: true, heroState: 'exit_car',
        camera() { fromCar(v, side * (v.hw + .5), e[2] - .25, _w); _v1.set(_w.x, v.y + e[1] + .12, _w.z); CAM.ov.pos.lerpVectors(p0, _v1, ease(u / .45)); CAM.ov.look.copy(l0).sub(p0).add(CAM.ov.pos); return { pos: CAM.ov.pos, look: CAM.ov.look, fov: f0, w: 1 - ease((u - .3) / .7), raw: true }; },
        update(dt) { t += dt; u = ease(t / D); const k = ease((t - .2) / (D * .75)); ctl.pos.x = lerp(seat.x, door.x, k); ctl.pos.z = lerp(seat.z, door.z, k); ctl.h = v.h + side * HP * .55 * k; ctl.state = 'exit_car'; S.hideHero = t < .3; return t >= D; },
        onEnd() { S.hideHero = false; sfx('door_close'); ctl.state = 'idle'; if (then) safe(() => then(src)); emit('exitCar', { vehicle: src, ctl }); } });
      return true; };

    /* ---------------------------------------------------------------- two-wheelers: mount / ride / dismount — third person throughout */
    const _q1 = new T.Quaternion(), _sw = new T.Vector3(), _hw = new T.Vector3();
    function mountLocal(v, m, dflt) { if (m && m.isObject3D) { v.group.updateMatrixWorld(true); _hw.setFromMatrixPosition(m.matrixWorld); v.group.worldToLocal(_hw); return [_hw.x, _hw.y, _hw.z]; } if (Array.isArray(m)) return m; if (m && typeof m === 'object' && m.y !== undefined) return [m.x || 0, m.y, m.z || 0]; return dflt; }
    const seatLocal = v => mountLocal(v, v.src.seat, [0, v.dims.seatH || .76, -.2]);
    /** put a seated figure's pelvis on a saddle point (follows the bike's lean): k = 0 leaves the figure where it stands, 1 = pinned */
    function pinHips(fig, v, sl, k, lift) { const g = fig.group; g.updateMatrixWorld(true); _sw.set(sl[0], sl[1], sl[2]).applyMatrix4(v.group.matrixWorld); _sw.y += .1 + (lift || 0);
      if (fig.hips) { fig.hips.getWorldPosition(_hw); g.position.x += (_sw.x - _hw.x) * k; g.position.y += (_sw.y - _hw.y) * k; g.position.z += (_sw.z - _hw.z) * k; }
      else { g.position.x = lerp(g.position.x, _sw.x, k); g.position.z = lerp(g.position.z, _sw.z, k); g.position.y = lerp(g.position.y, _sw.y - .62, k); } }
    /** scripted walk along waypoints with the normal collision; true when the last one is reached */
    function walkTo(W, dt) { W.t += dt; const path = W.path, q = path[0], last = path.length === 1, dx = q.x - ctl.pos.x, dz = q.z - ctl.pos.z, d = hyp(dx, dz), wh = Math.atan2(dx, dz), diff = angDiff(ctl.h, wh); ctl.h += clamp(diff * (1 - Math.exp(-12 * dt)), -9 * dt, 9 * dt);
      const tv = min(d > 2.2 || !last ? 3.3 : 1.6, max(.6, d * 3)) * (abs(diff) > 1.6 ? .35 : 1); S.cmd = approach(S.cmd, tv, 7 * dt); const ox = ctl.pos.x, oz = ctl.pos.z; moveBody(ctl.pos, sin(ctl.h) * S.cmd * dt, cos(ctl.h) * S.cmd * dt, RAD);
      const m = hyp(ctl.pos.x - ox, ctl.pos.z - oz); ctl.speed = damp(ctl.speed, m / max(dt, 1e-4), 12, dt); S.phase += m; ctl.pos.y = stepY(ctl.pos.y, groundY(ctl.pos.x, ctl.pos.z, ctl.pos.y + .05), dt); ctl.state = locoState(ctl.speed, false); S.wantMove = false;
      if (d < (last ? .12 : .38) || W.t > 7) { if (W.t > 7) { const z = path[path.length - 1]; ctl.pos.x = z.x; ctl.pos.z = z.z; path.length = 1; } path.shift(); if (!path.length) { S.cmd = 0; return true; } } return false; }
    function sideFree(v, lz, off) { const a = fromCar(v, v.hw + off, lz, { x: 0, z: 0 }); if (isFree(a.x, a.z, RAD * .8, v)) return 1; const b = fromCar(v, -(v.hw + off), lz, { x: 0, z: 0 }); return isFree(b.x, b.z, RAD * .8, v) ? -1 : 1; }
    /** walk to the bike's left (right if blocked), take the bars, swing a leg over. The camera never leaves third person. Ends with ctl.riding = vehicle, state 'ride'. */
    function playMount(v, then) { if (ctl.seated) return false; if (TK) endTakeover(); const src = v.src, sl = seatLocal(v), side = sideFree(v, sl[2], .36), W = { path: carPath(v, ctl.pos.x, ctl.pos.z, side, sl[2] + .04, .36), t: 0 }, R = S.ride, from = { x: 0, y: 0, z: 0, h: 0 }, D = .85; let phase = 0, t = 0;
      R.v = v; R.sl = sl; R.side = side; R.k = 0; R.swing = 0; R.vel = 0; R.steer = 0; R.lean = 0;
      if (pfig && P.mode === 'follow' && src.pillion) { const pl = mountLocal(v, src.pillion === true ? null : src.pillion, [0, sl[1] + .03, sl[2] - .44]); P.boarding = null;
        partner.goTo(carPath(v, P.x, P.z, -side, pl[2], .36), () => { let tt = 0; P.anim = 'ride'; P.animT = 0; P.pl = pl; P.car = v; P.pk = 0; P.seq = dt => { tt += dt; P.h += angDiff(P.h, v.h) * min(1, dt * 10); P.pk = ease((tt - .15) / .7); if (tt > .9) { P.mode = 'pillion'; P.pk = 1; return true; } return false; }; }, { h: v.h }); }
      ctl.takeover({ _internal: true, look: true, heroState: 'walk',
        update(dt) { t += dt;
          if (phase === 0) { if (walkTo(W, dt)) { phase = 1; t = 0; } if (S.lookIdle > 1) ctl.camera.yaw += angDiff(ctl.camera.yaw, v.h + side * .5) * min(1, dt * 1.5); }
          else if (phase === 1) { ctl.speed = damp(ctl.speed, 0, 14, dt); ctl.h += angDiff(ctl.h, v.h) * min(1, dt * 11); ctl.state = 'use'; if (t > .36) { phase = 2; t = 0; from.x = ctl.pos.x; from.y = ctl.pos.y; from.z = ctl.pos.z; from.h = ctl.h; sfx('thunk'); } }
          else { const u = ease(t / D); ctl.pos.x = lerp(from.x, v.x, u); ctl.pos.z = lerp(from.z, v.z, u); ctl.pos.y = lerp(from.y, v.y, u); ctl.h = from.h + angDiff(from.h, v.h) * u; ctl.state = 'ride'; ctl.speed = 0; R.k = u; R.swing = sin(PI * clamp(t / (D * .9), 0, 1)); if (t >= D) { phase = 3; return true; } }
          return false; },
        onEnd() { if (phase < 3) { R.k = 0; R.swing = 0; return; } R.k = 1; R.swing = 0; ctl.seated = v; ctl.riding = src; ctl.state = 'ride'; S.lookIdle = 9; if (then) safe(() => then(src)); emit('enterCar', { vehicle: src, ctl, twoWheeler: true }); emit('mount', { vehicle: src, ctl }); } });
      return true; }
    function playDismount(v, then) { if (TK) endTakeover(); const src = v.src, R = S.ride, sl = R.sl && R.v === v ? R.sl : seatLocal(v), side = sideFree(v, sl[2], .36), to = fromCar(v, side * (v.hw + .36), sl[2] + .04, { x: 0, z: 0 }), gy = groundY(to.x, to.z, v.y + .3), D = .75, x0 = v.x, z0 = v.z, y0 = v.y, lean0 = R.lean; let t = 0;
      R.v = v; R.sl = sl; R.side = side; R.k = 1; R.vel = 0; if (typeof src.speed === 'number') src.speed = 0; ctl.seated = null; ctl.riding = null; ctl.enabled = true; ctl.pos.x = x0; ctl.pos.z = z0; ctl.pos.y = y0; ctl.h = v.h;
      if (pfig && (P.mode === 'pillion' || P.pk > 0)) { const pd = fromCar(v, -side * (v.hw + .42), (P.pl ? P.pl[2] : -.6), { x: 0, z: 0 }); P.seq = null; P.pk = 0; P.car = null; P.mode = 'follow'; P.path = null; P.then = null; partner.teleport(pd.x, pd.z, v.h); }
      ctl.takeover({ _internal: true, look: true, heroState: 'ride',
        update(dt) { t += dt; const u = ease(t / D); R.k = 1 - u; R.swing = sin(PI * clamp(t / (D * .9), 0, 1)); ctl.pos.x = lerp(x0, to.x, u); ctl.pos.z = lerp(z0, to.z, u); ctl.pos.y = lerp(y0, gy, u); ctl.h = v.h; ctl.state = u < .7 ? 'ride' : 'idle'; ctl.speed = 0; S.cmd = 0;
          if (ctl.rideAssist && lean0) { R.lean = lean0 * (1 - u); v.group.rotation.z = R.lean; } return t >= D; },
        onEnd() { R.k = 0; R.swing = 0; ctl.state = 'idle'; if (then) safe(() => then(src)); emit('exitCar', { vehicle: src, ctl, twoWheeler: true }); emit('dismount', { vehicle: src, ctl }); } });
      return true; }
    /** start already in the saddle (mission starts, respawns): no animation, no events */
    ctl.mountNow = src => { if (!src || !src.group) return false; const v = vehOf(src) || tempVeh(src); if (!v.two) return false; if (TK) endTakeover(); syncOne(v); const R = S.ride; R.v = v; R.sl = seatLocal(v); R.side = 1; R.k = 1; R.swing = 0; R.vel = 0; R.steer = 0; R.lean = 0;
      ctl.seated = v; ctl.riding = src; ctl.state = 'ride'; ctl.speed = 0; ctl.pos.x = v.x; ctl.pos.z = v.z; ctl.pos.y = v.y; ctl.h = v.h; ctl.camera.yaw = v.h; if (ctl.view === 'fp') ctl.camera.pitch = FP.ridePitch; CAM.init = false; return true; };
    /** optional built-in arcade physics for the ridden two-wheeler (ctl.rideAssist = true): W/S throttle-brake, A/D steer, Space brake, circle collision, lean into turns */
    function rideSim(dt, v) { const R = S.ride, a = TK ? { x: 0, y: 0 } : input.axis(), src = v.src, g = v.group, vmax = src.maxSpeed || 11.5, brake = !TK && input.down('Space');
      if (a.y > 0) R.vel += 5.4 * a.y * max(0, 1 - max(0, R.vel) / vmax) * dt; else if (a.y < 0) R.vel = R.vel > .15 ? max(0, R.vel - 9.5 * dt) : max(-1.5, R.vel - 2.2 * dt); else R.vel = approach(R.vel, 0, (.9 + abs(R.vel) * .12) * dt); if (brake) R.vel = approach(R.vel, 0, 12 * dt);
      R.steer = damp(R.steer, a.x, 5.5, dt); const sp = abs(R.vel), rate = lerp(2.3, .85, sst(sp, 2, vmax)) * clamp(sp / 1.4, 0, 1) * (R.vel < 0 ? -1 : 1), h = v.h - R.steer * rate * dt;
      const b = { x: v.x, y: v.y, z: v.z }, hit = sp > .01 ? moveBody(b, sin(h) * R.vel * dt, cos(h) * R.vel * dt, .4, v) : false;
      if (hit) { const into = max(0, -(HIT.nx * sin(h) + HIT.nz * cos(h)) * (R.vel < 0 ? -1 : 1)); if (into > .5 && sp > 4) emit('crash', { vehicle: src, speed: sp, ctl }); R.vel *= 1 - min(1, dt * (2 + into * 9)); }
      R.lean = damp(R.lean, R.steer * clamp(sp / 7, 0, 1) * .36, 6, dt); const y = stepY(v.y, groundY(b.x, b.z, v.y + .05), dt);
      g.rotation.order = 'YXZ'; g.position.set(b.x, y, b.z); g.rotation.set(0, h, R.lean); src.speed = R.vel;
      if (Array.isArray(src.wheels)) { const wr = v.dims.wheelR || .2; for (const w of src.wheels) if (w && w.rotation) w.rotation.x += R.vel * dt / wr; }
      if (Array.isArray(src.steer)) for (const nd of src.steer) if (nd && nd.rotation) nd.rotation.y = -R.steer * .42 * (1 - sst(sp, 0, 8) * .7);
      ctl.ride.steer = R.steer; ctl.ride.lean = R.lean; }
    function rideUpdate(dt) { const v = ctl.seated, src = v.src, R = S.ride; if (ctl.rideAssist && dt > 0) rideSim(dt, v); else { R.steer = ctl.ride.steer || 0; R.lean = ctl.ride.lean || 0; }
      v.group.updateMatrixWorld(true); syncVehicles(); syncOne(v); const ox = ctl.pos.x, oz = ctl.pos.z, oh = ctl.h; ctl.pos.x = v.x; ctl.pos.z = v.z; ctl.pos.y = v.y; ctl.h = v.h;
      if (dt > 0) { const sp = typeof src.speed === 'number' ? abs(src.speed) : hyp(v.x - ox, v.z - oz) / dt; ctl.speed = damp(ctl.speed, min(sp, 40), 10, dt); S.turn = damp(S.turn, angDiff(oh, ctl.h) / dt, 9, dt); }
      ctl.state = 'ride'; S.moveH = v.h; S.wantMove = ctl.speed > .6; R.v = v; R.k = 1; ctl.ride.speed = ctl.speed; const sp = act.get('ride:off'); if (sp) { sp.x = v.x; sp.z = v.z; } }
    /** seat the hero on the saddle (called after hero.update so the pelvis bone is current) */
    function ridePose() { const R = S.ride, v = R.v; if (!v || !v.group || !R.sl) return; const g = hero.group;
      if (R.k >= 1) { v.group.getWorldQuaternion(_q1); g.quaternion.copy(_q1); g.position.set(v.x, v.y, v.z); } else g.rotation.set(0, ctl.h, R.side * R.swing * .12);
      pinHips(hero, v, R.sl, R.k, R.swing * .05); gripHands(v, R); }
    /* H5: in the saddle the hands close round the bike's real grips (src.seat.gripL / gripR ride inside the steering group, so the hands turn with the bars). The hand frame is built
       from the grip: thumb side along the bar towards the bike's middle, knuckles along the line from the shoulder to the grip lifted a little (a straight, slightly cocked wrist),
       and the wrist set back from the bar by a fist's depth, so the grip runs through the closed hand instead of under it. */
    const _gq = new T.Quaternion(), _gp = new T.Vector3(), _gg = new T.Vector3(), _gw = new T.Vector3(), _gk = new T.Vector3(), _gx = new T.Vector3(), _gy = new T.Vector3(), _gz = new T.Vector3(), _gm = new T.Matrix4(), GRIP = { lift: .3, back: .072, palm: .02 };
    ctl._grip = GRIP;
    function gripHands(v, R) { const src = v.src, st = src && src.seat; const F = hero.src; if (R.k < 1 || !st || !st.gripL || !st.gripR || !F || typeof F.reach !== 'function') return; hero.group.updateMatrixWorld(true); v.group.updateMatrixWorld(true);
      for (let k = 0; k < 2; k++) { const gr = k ? st.gripR : st.gripL, e = gr.matrixWorld.elements; _gg.setFromMatrixPosition(gr.matrixWorld); _gp.setFromMatrixPosition(hero.bones[k ? 'armR' : 'armL'].matrixWorld);
        _gk.copy(_gg).sub(_gp).normalize(); _gk.y += GRIP.lift; _gk.normalize();                                                    // knuckles: shoulder → grip, lifted
        _gz.set(e[0], e[1], e[2]).normalize().multiplyScalar(k ? 1 : -1); _gy.copy(_gk).negate(); _gz.addScaledVector(_gy, -_gz.dot(_gy)).normalize(); _gx.crossVectors(_gy, _gz);   // Z = thumb side (inboard along the bar), X = Y × Z
        _gm.makeBasis(_gx, _gy, _gz); _gq.setFromRotationMatrix(_gm); _gw.copy(_gg).addScaledVector(_gk, -GRIP.back).addScaledVector(_gx, (k ? -1 : 1) * GRIP.palm);   // X is the right palm / the back of the left hand
        F.reach(k, _gw, 1, -.6, -.4, _gq); } }
    act.add({ id: 'ride:off', x: 0, z: 0, r: 4, key: 'KeyF', mode: 'car', label: '下车', enabled: () => !!ctl.riding && ctl.autoDismount && ctl.speed < 1.6, onUse: () => { ctl.playExitCar(); } });

    /* ---------------------------------------------------------------- camera */
    function cameraThird(dt) { CAM.roll = 0; const C = ctl.camera, zn = ctl.zone, indoor = !!(zn && zn.indoor), active = !TK && ctl.enabled, ride = !!ctl.riding, aim = active && !ride && input.down('Mouse1'), sprint = ctl.state === 'sprint'; CAMQ.skipVeh = ride ? ctl.seated : (S.ride.k > 0 ? S.ride.v : null);
      if (active || (TK && TK.o.look)) { C.yaw -= input.look.dx; C.pitch += input.look.dy; if (abs(input.look.dx) + abs(input.look.dy) > 1e-5) S.lookIdle = 0; } S.lookIdle += dt;
      if (active && input.pressed('KeyQ')) { C.shoulder = C.shoulder === 'R' ? 'L' : 'R'; input.consume('KeyQ'); }
      // gentle look-ahead into turns: when the mouse is at rest the camera drifts round behind the direction of travel
      if (active && !aim && S.wantMove && ctl.speed > .8 && S.lookIdle > .7) { const d = angDiff(C.yaw, S.moveH); if (abs(d) < (ride ? 3.2 : 2.5)) C.yaw += d * min(1, dt * (ride ? 2.4 : .75) * sst(S.lookIdle, .7, 1.8)); }
      C.pitch = clamp(C.pitch, -.85, 1.12); if (C.yaw > PI * 4 || C.yaw < -PI * 4) C.yaw = C.yaw % TAU;
      CAM.aim = damp(CAM.aim, aim ? 1 : 0, 9, dt);
      const sgn = C.shoulder === 'L' ? -1 : 1, crouch = ctl.state === 'crouch' || ctl.state === 'crouch_walk';
      const tSide = lerp(ride ? min(C.side, .34) : indoor ? min(C.side, .44) : C.side, .6, CAM.aim) * sgn, tH = (ride ? C.height + .2 : crouch ? C.height - .42 : indoor ? C.height - .04 : C.height) + CAM.aim * .03;
      let tDist = ride ? C.dist + .9 + sst(ctl.speed, 2, 11) * .9 : (indoor ? min(C.dist, 1.95) : C.dist) + (sprint ? .28 : 0); tDist = lerp(tDist, 1.3, CAM.aim); tDist *= C.pitch < 0 ? 1 - .42 * sst(-C.pitch, 0, .85) : 1 + .1 * sst(C.pitch, .2, 1.1);
      const tFov = lerp(C.fov + (ride ? 2 + sst(ctl.speed, 3, 11) * 9 : (sprint ? 5 : 0) + (indoor ? 1.5 : 0)), 43, CAM.aim);
      if (!CAM.init) { CAM.init = true; CAM.fx = ctl.pos.x; CAM.fy = ctl.pos.y; CAM.fz = ctl.pos.z; CAM.lax = CAM.laz = 0; CAM.side = tSide; CAM.h = tH; CAM.distWant = tDist; CAM.dist = tDist; CAM.fov = tFov; dt = 0; }
      CAM.side = damp(CAM.side, tSide, 7, dt); CAM.h = damp(CAM.h, tH, 8, dt); CAM.distWant = damp(CAM.distWant, tDist, 5.5, dt); CAM.fov = damp(CAM.fov, tFov, 6, dt);
      // follow lag + look-ahead
      const vx = sin(ctl.h) * ctl.speed, vz = cos(ctl.h) * ctl.speed; CAM.lax = damp(CAM.lax, vx * .1, 2.6, dt); CAM.laz = damp(CAM.laz, vz * .1, 2.6, dt);
      CAM.fx = damp(CAM.fx, ctl.pos.x, 15, dt); CAM.fz = damp(CAM.fz, ctl.pos.z, 15, dt); CAM.fy = damp(CAM.fy, ctl.pos.y - (S.arc || 0) * .8, 9, dt);
      const lag = hyp(CAM.fx - ctl.pos.x, CAM.fz - ctl.pos.z); if (lag > .9) { const k = .9 / lag; CAM.fx = ctl.pos.x + (CAM.fx - ctl.pos.x) * k; CAM.fz = ctl.pos.z + (CAM.fz - ctl.pos.z) * k; }
      const rx = -cos(C.yaw), rz = sin(C.yaw), cp = cos(C.pitch), dx = sin(C.yaw) * cp, dy = -sin(C.pitch), dz = cos(C.yaw) * cp;
      const hx = CAM.fx + CAM.lax, hy = CAM.fy + CAM.h, hz = CAM.fz + CAM.laz, turnShift = clamp(-S.turn * .028, -.14, .14) * sst(ctl.speed, .5, 3);
      // shoulder offset: pulled in when a wall is beside the character
      const sAbs = abs(CAM.side), ss = Math.sign(CAM.side) || 1, cast = sAbs + .2, ts = segHit(hx, hy, hz, hx + rx * ss * cast, hy, hz + rz * ss * cast, .13, CAMQ), lim = max(0, ts * cast - .2);
      CAM.sideLim = lim < CAM.sideLim ? lim : min(lim, CAM.sideLim + dt * 1.6); const side = min(sAbs, CAM.sideLim) * ss + turnShift * (min(sAbs, CAM.sideLim) > .3 ? 1 : 0);
      const px = hx + rx * side, py = hy, pz = hz + rz * side;
      // boom: pulled in when anything solid is between the pivot and the camera
      const want = CAM.distWant, ext = want + .22; let hit = max(.12, segHit(px, py, pz, px - dx * ext, py - dy * ext, pz - dz * ext, .15, CAMQ) * ext - .22);
      for (const sx of [-.2, .2]) { const t2 = segHit(px, py, pz, px - dx * ext + rx * sx, py - dy * ext, pz - dz * ext + rz * sx, .1, CAMQ) * ext - .2; if (t2 < hit && t2 > .5) hit = max(hit * .0 + t2, .12); }
      if (indoor && zn.ceil !== undefined && dy < 0) { const top = zn.ceil - .2, yEnd = py - dy * want; if (yEnd > top) hit = min(hit, max(.12, (top - py) / -dy)); }
      // alive layer — awnings, canopies and stall bodies (OVER): the boom stops short of a face it would enter, and stays below an underside it would rise through.
      // Both limits are eased (in over ~2-3 frames, out slowly) instead of snapped, so swinging the camera past an awning edge does not pop; with dt = 0 (stills, teleports) they resolve at once.
      overSync(); let ceilY = 1e9, ovHit = 1e9;
      if (OVER.length) { const ex = -dx * ext, ey = -dy * ext, ez = -dz * ext, m = .14, pad = .22; let nq = 0;
        for (const o of OVER) { let ta = 0, tb = 1, a, b, w;                                                                 // clip the boom against the padded footprint
          if (abs(ex) < 1e-9) { if (px < o.x0 - pad || px > o.x1 + pad) continue; } else { a = (o.x0 - pad - px) / ex; b = (o.x1 + pad - px) / ex; if (a > b) { w = a; a = b; b = w; } if (a > ta) ta = a; if (b < tb) tb = b; if (ta > tb) continue; }
          if (abs(ez) < 1e-9) { if (pz < o.z0 - pad || pz > o.z1 + pad) continue; } else { a = (o.z0 - pad - pz) / ez; b = (o.z1 + pad - pz) / ez; if (a > b) { w = a; a = b; b = w; } if (a > ta) ta = a; if (b < tb) tb = b; if (ta > tb) continue; }
          const lo = o.y0 - m;
          if (o.y0 > .5 && py <= lo + .3) { if (max(py + ey * ta, py + ey * tb) > lo) ceilY = min(ceilY, lo); continue; }             // something with an underside above head height: slide beneath it
          OVQ[nq++] = o; OVQ[nq++] = ta; OVQ[nq++] = tb; }
        for (let i = 0; i < nq; i += 3) { const o = OVQ[i], ta = OVQ[i + 1], tb = OVQ[i + 2], hi = o.y1 + m, yA = min(py + ey * ta, ceilY), yB = min(py + ey * tb, ceilY);   // full-height volumes (and slabs the pivot is level with), at the ducked height
          if ((yA > hi && yB > hi) || (yA < o.y0 - m && yB < o.y0 - m)) continue; if (ta > 0) ovHit = min(ovHit, ta * ext - .12); } }
      { const lim = max(.12, ovHit), cur = CAM.ovLim === undefined ? 1e9 : CAM.ovLim; CAM.ovLim = !(dt > 0) ? lim : lim < cur ? damp(min(cur, CAM.dist), lim, 40, dt) : (lim > 50 && cur > want + .3 ? 1e9 : min(lim, cur + dt * 3)); hit = min(hit, CAM.ovLim); }
      const dl = min(want, hit); CAM.dist = dl < CAM.dist ? dl : min(dl, CAM.dist + dt * (2.2 + (dl - CAM.dist) * 3));
      let cx = px - dx * CAM.dist, cy = py - dy * CAM.dist, cz = pz - dz * CAM.dist; const cyAim = cy;
      { const over = max(0, cy - ceilY), dk = CAM.duck || 0; CAM.duck = !(dt > 0) ? over : damp(dk, over, over > dk ? 30 : 4, dt); cy -= CAM.duck; }     // duck under an awning; the look point below keeps aiming from the un-ducked height so the hero stays framed
      const gy = groundY(cx, cz, ctl.pos.y + .6) + .24; if (cy < gy) cy = gy;
      // motion sway
      const amp = ride || S.ride.k > 0 ? 0 : sst(ctl.speed, .3, 1.6) * .009 + sst(ctl.speed, 2.4, 6.4) * .02; S.bob = damp(S.bob, amp, 6, dt); const ph = S.phase * (ctl.speed > 2.5 ? 2.4 : 4.2);
      const by = sin(ph * 2) * S.bob, bx = sin(ph) * S.bob * .7; cx += rx * bx; cz += rz * bx; cy += by;
      CAM.pos.set(cx, cy, cz); CAM.look.set(cx + dx * 10, (CAM.duck > 0 ? cyAim + by : cy) + dy * 10 - by * .6, cz + dz * 10); }
    const CAMQ = { thin: .75 }, OVQ = [];
    /* ---------------------------------------------------------------- first-person camera (ctl.view === 'fp'; V toggles; third person above is untouched)
       The eye rides on the hero's real head bone (so the step cycle, crouch, vault arc, mount swing, the saddle, lean, braking dive and a tumble all move it for free), low-passed so the
       gait reads as a gentle bob; orientation is the player's yaw / pitch only. The hero's head is skipped by this camera in js/hero.js (fpCull), the rest of the body is the real figure. */
    const FP = { ox: 0, oy: 1.6, oz: 0, dip: 0, dipV: 0, roll: 0, fov: 64, vh0: 0, rideV: null, snap: true, ridePitch: .26, rideBack: .1, rideUp: .05, sk: 0 }, FPQ = { skipVeh: null }, _fe = new T.Vector3(), _fu = new T.Vector3();
    function headPoint(out) { const hb = hero.bones && hero.bones.head; if (!hb || !hb.matrixWorld) return out.set(ctl.pos.x, ctl.pos.y + hero.height * .91, ctl.pos.z); hero.group.updateMatrixWorld(true); const e = hb.matrixWorld.elements; return out.set(e[12] + e[4] * .085, e[13] + e[5] * .085, e[14] + e[6] * .085); }
    /** world position of the hero's head (what NPCs should look at / aim at) */
    ctl.headPos = out => headPoint(out || new T.Vector3()); ctl._fpCam = FP;   /* tuning handle (first-person lens) */
    ctl.setView = v => { v = v === 'fp' || v === 1 || v === '1' ? 'fp' : 'tp'; if (v !== ctl.view) { ctl.view = v; CAM.init = false; FP.snap = true; emit('view', { view: v }); } return ctl; };
    ctl.on('land', e => { FP.dipV -= clamp((e && e.h) || .4, .3, 1.8) * 1.5; });
    /* a small centre dot while walking in first person: what E / F will act on is what it is on (GT.act weighs the view direction) */
    let fpDotEl = null, fpDotOn = false;
    function fpDot(show) { show = !!show && ctl.fpDot !== false; if (show === fpDotOn || typeof document === 'undefined') return; fpDotOn = show;
      if (!fpDotEl) { fpDotEl = document.createElement('div'); fpDotEl.className = 'of-fpdot'; fpDotEl.style.cssText = 'position:fixed;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:rgba(255,255,255,.78);box-shadow:0 0 3px rgba(0,0,0,.85);pointer-events:none;z-index:6;opacity:0;transition:opacity .18s'; document.body.appendChild(fpDotEl); }
      fpDotEl.style.opacity = show ? '1' : '0'; }
    function cameraFirst(dt) { const C = ctl.camera, active = !TK && ctl.enabled, ride = !!ctl.riding, v = ride ? ctl.seated : null, aim = active && !ride && input.down('Mouse1'), sprint = ctl.state === 'sprint'; CAM.aim = 0;
      if (active || (TK && TK.o.look)) { C.yaw -= input.look.dx; C.pitch += input.look.dy; if (abs(input.look.dx) + abs(input.look.dy) > 1e-5) S.lookIdle = 0; } S.lookIdle += dt;
      if (v) {                                                   // in the saddle: the view turns with the bike, looks round freely, and comes back to the road when the mouse rests
        if (FP.rideV === v) C.yaw += angDiff(FP.vh0, v.h); FP.rideV = v; FP.vh0 = v.h; let rel = angDiff(v.h, C.yaw);
        if (ctl.speed > .8 && S.lookIdle > .7) { const k = Math.exp(-2.6 * dt * sst(S.lookIdle, .7, 1.6)); rel *= k; C.pitch = FP.ridePitch + (C.pitch - FP.ridePitch) * (1 - (1 - k) * .6); }
        rel = clamp(rel, -2.3, 2.3); C.yaw = v.h + rel; C.pitch = clamp(C.pitch, -.9, 1.05); }
      else { FP.rideV = null; C.pitch = clamp(C.pitch, -1.45, 1.45); if (TK && TK.o._internal && TK.o.heroState !== 'sprint' && (!TK.o.look || S.lookIdle > .5)) { C.yaw += angDiff(C.yaw, S.ride.k > 0 && S.ride.v ? S.ride.v.h : ctl.h) * min(1, dt * 5); if (S.ride.k > 0) C.pitch = damp(C.pitch, FP.ridePitch, 3, dt); } }
      if (C.yaw > PI * 4 || C.yaw < -PI * 4) { C.yaw = C.yaw % TAU; FP.vh0 = v ? v.h : 0; }
      headPoint(_fe); const tx = _fe.x - ctl.pos.x, ty = _fe.y - ctl.pos.y, tz = _fe.z - ctl.pos.z, seated = ride || S.ride.k > 0;
      const tFov = ride ? ctl.fpFov + 3 + sst(ctl.speed, 3, 11) * 6 : aim ? 47 : ctl.fpFov + (sprint ? 6 : 0);
      if (!CAM.init || FP.snap) { CAM.init = true; FP.snap = false; FP.ox = tx; FP.oy = ty; FP.oz = tz; FP.dip = FP.dipV = 0; FP.roll = 0; FP.fov = tFov; dt = 0; }
      const kf = seated ? 26 : 13; FP.ox = damp(FP.ox, tx, kf, dt); FP.oz = damp(FP.oz, tz, kf, dt); FP.oy = damp(FP.oy, ty, seated ? 26 : 11, dt); FP.fov = damp(FP.fov, tFov, 6, dt);
      for (let i = 0, n = dt > .02 ? 2 : 1, h = dt / n; i < n; i++) { FP.dipV += (-FP.dip * 95 - FP.dipV * 13) * h; FP.dip = clamp(FP.dip + FP.dipV * h, -.16, .05); }
      let vp = 0, sn = null; if (v) { sn = v.src.seat && v.src.seat.isObject3D ? v.src.seat : v.group; const e = sn.matrixWorld.elements, l = hyp(e[8], e[9], e[10]) || 1; vp = clamp(-Math.asin(clamp(e[9] / l, -1, 1)), -.3, .3) * cos(angDiff(v.h, C.yaw)) * .85; }   // the bike's own pitch (braking dive, kerb kick) tips the view with it
      FP.vp = damp(FP.vp || 0, vp, 18, dt); const pch = C.pitch + FP.vp, cp = cos(pch), fxw = sin(C.yaw), fzw = cos(C.yaw), dx = fxw * cp, dy = -sin(pch), dz = fzw * cp, rx = -fzw, rz = fxw;
      FP.sk = damp(FP.sk, seated ? S.ride.k : 0, 10, dt); const down = sst(C.pitch, .2, 1.3), fwd = lerp(.1 + .11 * down, lerp(-FP.rideBack, .13, v ? sst(abs(angDiff(v.h, C.yaw)), .75, 1.9) : 0) + .1 * down, FP.sk),   /* in the saddle the lens sits behind the head point; turned to look back that put it in FRONT of the neck, looking down the collar into the hollow jacket */ cx = ctl.pos.x + FP.ox, cz = ctl.pos.z + FP.oz;                 // looking down the head cranes forward a little: the chest never crosses the lens
      let ex = cx + fxw * fwd, ey = ctl.pos.y + FP.oy - .045 * down + FP.dip + FP.rideUp * FP.sk, ez = cz + fzw * fwd;   /* H5: in the saddle the lens sits a little behind and above the eyes and the rest pitch is near level (ridePitch): the road fills the frame, the bars, the speedo and both hands sit in its lower third */
      if (!seated) { FPQ.skipVeh = null; const t = segHit(ctl.pos.x, ey, ctl.pos.z, ex, ey, ez, .17, FPQ); if (t < 1) { ex = ctl.pos.x + (ex - ctl.pos.x) * t; ez = ctl.pos.z + (ez - ctl.pos.z) * t; }      // the lens stays 17 cm clear of walls and cars
        const zn = ctl.zone; if (zn && zn.indoor && zn.ceil !== undefined) ey = min(ey, zn.ceil - .12); }
      // roll: a little of the bike's lean in the saddle; on foot a trace of sway with each step and into a strafe
      let tRoll = 0;
      if (v) { const e = sn.matrixWorld.elements; _fu.set(e[4], e[5], e[6]).normalize(); tRoll = -Math.asin(clamp(_fu.x * rx + _fu.z * rz, -1, 1)) * .3; }
      else if (!seated && !TK) { const k = sst(ctl.speed, .5, 3.2), stride = ctl.speed > 5 ? 1.3 : ctl.speed > 2.5 ? 1.02 : .7; tRoll = (S.foot ? 1 : -1) * sin(PI * clamp((S.stepAcc || 0) / stride, 0, 1)) * .0042 * k + S.ax * .011 * k; }
      FP.roll = damp(FP.roll, tRoll, v ? 14 : 9, dt);
      CAM.pos.set(ex, ey, ez); CAM.look.set(ex + dx * 10, ey + dy * 10, ez + dz * 10); CAM.fov = FP.fov; CAM.roll = FP.roll; CAM.fx = ctl.pos.x; CAM.fy = ctl.pos.y; CAM.fz = ctl.pos.z; }
    function cameraFinal(dt) { const ov = CAM.ov, fp = ctl.view === 'fp', cut = fp && !ov.manual; let fov = CAM.fov, roll = CAM.roll || 0;       // first person: a cinematic camera CUTS in and out (a blend would fly the lens through the hero's own head)
      if (ov.fn) { const r = safe(() => ov.fn(dt), null); if (r) { if (!r.raw) { ov.pos.set(r.pos[0], r.pos[1], r.pos[2]); ov.look.set(r.look[0], r.look[1], r.look[2]); } ov.fov = r.fov || CAM.fov; ov.has = true; if (ov.manual) ov.w = clamp(r.w === undefined ? 1 : r.w, 0, 1); else ov.w = cut ? 1 : min(1, ov.w + dt / ov.inT); } }
      else if (ov.hold && ctl.seated) { eyePose(ctl.seated, ov.pos, ov.look); ov.w = 1; }
      else if (ov.w > 0) { ov.w = cut || (fp && !ctl.enabled) ? 0 : max(0, ov.w - dt / ov.outT); if (ov.w === 0) ov.has = false; }
      if (ov.w > 0 && ov.has) { const k = ov.manual || ov.hold ? ov.w : ease(ov.w); CAM.out.lerpVectors(CAM.pos, ov.pos, k); _v2.copy(CAM.look).sub(CAM.pos).normalize(); _v3.copy(ov.look).sub(ov.pos).normalize(); _v2.lerp(_v3, k).normalize(); CAM.outLook.copy(CAM.out).addScaledVector(_v2, 10); fov = lerp(CAM.fov, ov.fov, k); roll *= 1 - k; }
      else { CAM.out.copy(CAM.pos); CAM.outLook.copy(CAM.look); }
      CAM.outFov = fov; CAM.outRoll = roll; applyCamera(); const cine = ov.w > 0 && ov.has;
      // never show the inside of a character
      const hd = hyp(CAM.out.x - ctl.pos.x, CAM.out.z - ctl.pos.z), near = hd < .34 && CAM.out.y < ctl.pos.y + hero.height + .25; hero.group.visible = !((near && !(fp && !cine)) || S.hideHero || (TK && TK.o.hideHero && cine) || (ctl.seated && !ctl.riding) || (TK && TK.o._manual && (fp ? ov.w > .02 : ov.w > .8 && ctl.state === 'enter_car')));   // first person: the body is simply not drawn while the lens travels between the eye and the driver's seat
      if (pfig && pfig.group.visible) { const pd = hyp(CAM.out.x - P.x, CAM.out.z - P.z); if (pd < (fp && !cine ? .42 : 1.2) && CAM.out.y < P.y + pfig.height + .5) pfig.group.visible = false; } }
    function applyCamera() { if (!camera) return; camera.position.copy(CAM.out); camera.up.set(0, 1, 0); camera.lookAt(CAM.outLook); if (CAM.outRoll) camera.rotateZ(CAM.outRoll); if (abs(camera.fov - CAM.outFov) > .01) { camera.fov = CAM.outFov; camera.updateProjectionMatrix(); } }
    ctl.applyCamera = applyCamera;

    /* ---------------------------------------------------------------- interaction prompts */
    const A = { cur: null, holdT: 0, holding: false, lock: false, list: [], pressT: 0 };
    function actUpdate(dt, pos, mode, show) { A.list.length = 0; const best = show ? act.near(pos, mode, A.list) : null;
      if (best !== A.cur) { A.cur = best; A.holdT = 0; A.holding = false; }
      if (A.lock && !(best && input.down(best.key || 'KeyE'))) A.lock = false;
      let prog = 0; A.pressT = max(0, A.pressT - dt);
      if (best) { const key = best.key || 'KeyE';
        if (best.hold > 0) { if (input.pressed(key) && !A.lock) { A.holding = true; input.consume(key); } if (A.holding && input.down(key)) { A.holdT += dt; prog = A.holdT / best.hold; if (prog >= 1) { A.holding = false; A.holdT = 0; A.lock = true; use(best, pos, mode); prog = 1; } } else { A.holding = false; A.holdT = max(0, A.holdT - dt * 2.5); prog = A.holdT / best.hold; } }
        else if (input.pressed(key) && !A.lock) { input.consume(key); A.lock = true; A.pressT = .14; use(best, pos, mode); } }
      // other keys on other spots in reach still work (stacked prompts)
      let row = 1; uiRow(0, show && (!ctl.seated || ctl.riding || mode === 'car') && !(TK && !A.pressT) ? best : null, prog, A.holding || A.pressT > 0);   /* mode 'car' (ctl.updateCar): the driver's-seat spots — 入库上户, 换牌贴膜 — show their prompt and hold ring too */
      for (const s of A.list) { if (s === best || row > 2) continue; const key = s.key || 'KeyE'; if (key !== (best.key || 'KeyE') && !(s.hold > 0) && input.pressed(key)) { input.consume(key); use(s, pos, mode); } uiRow(row++, TK ? null : s, 0, false); }
      for (; row < 3; row++) uiRow(row, null);
      // world markers
      if (scene) for (const s of ACT.list) { if (!s.marker) { if (s._mk) { s._mk.visible = false; s._mk.userData.free = true; s._mk = null; } continue; } const m = markerFor(scene, s), d = hyp(s.x - CAM.out.x, s.z - CAM.out.z), dp = hyp(s.x - pos.x, s.z - pos.z);
        const en = !s.enabled || safe(() => s.enabled(act._ctx(pos, mode)), false), a = en && (mode === 'foot' || ctl.riding) && (!ctl.seated || ctl.riding) ? sst(d, ctl.riding ? 40 : 22, ctl.riding ? 24 : 12) * (.3 + .7 * sst(dp, .7, 2.6)) : 0; m.visible = a > .01; if (!m.visible) continue;
        const pulse = 1 + sin(ctl.time * 2.4 + m.userData.ph) * .12, sc = (.3 + clamp(d, 2, 22) * .017) * pulse, night = (GT.env && GT.env.night) || 0; m.position.set(s.x, s.markerY !== undefined ? s.markerY : (s.y !== undefined ? s.y : groundY(s.x, s.z)) + 1.05, s.z); m.scale.set(sc, sc, 1); m.material.opacity = a; m.material.color.setScalar(lerp(2.6, 1.1, night) * (s === best ? 1.5 : 1)); } }
    function use(spot, pos, mode) { const ctx = act._ctx(pos, mode); if (GT.audio && GT.audio.sfx) safe(() => GT.audio.sfx('ui_tick', { g: .6 })); safe(() => spot.onUse(ctx)); emit('interact', { spot, ctx }); }

    /* ---------------------------------------------------------------- update */
    function zoneUpdate() { const z = zoneAt(ctl.pos.x, ctl.pos.z); if (z !== ctl.zone) { const old = ctl.zone; ctl.zone = z; if (old) emit('zone', { id: old.id, inside: false, zone: old }); if (z) emit('zone', { id: z.id, inside: true, zone: z }); }
      if (ctl.autoDoors && GT.station && GT.station.state && GT.world.anchors.storeDoor) { const d = GT.world.anchors.storeDoor, near = hyp(ctl.pos.x - d.x - .9, ctl.pos.z - d.z) < 2.7 || (pfig && P.mode !== 'car' && hyp(P.x - d.x - .9, P.z - d.z) < 2.2);
        if (near) { GT.station.state.doorOpen = 1; S.door = true; } else if (S.door) { GT.station.state.doorOpen = 0; S.door = false; } } }
    ctl.update = dt => {
      dt = clamp(+dt || 0, 0, .1); if (!IN.latched) input.frame(); IN.latched = false; IN.shared = true;   /* this frame's latch is still current: ctl.updateCar, called right after by the host, must read it and not latch again (that wiped the pressed set, so hold-E spots never started for a seated player) */
      act._ctl = ctl; GT.onfoot.ctl = ctl;
      if (!ctl.enabled) { if (S.wasOn !== false) { S.wasOn = false; for (let i = 0; i < 3; i++) uiRow(i, null); fpDot(false); if (MK.group) MK.group.visible = false;
          if (pfig && P.boarding) { P.mode = 'car'; P.car = P.boarding; P.boarding = null; P.seq = null; P.path = null; P.then = null; P.hidden = false; P.state = 'car'; pfig.group.visible = false; } } subShow(dt); return; }
      if (S.wasOn === false) { S.wasOn = true; if (MK.group) MK.group.visible = true; CAM.init = CAM.init && !!TK; if (ctl.seated && !ctl.riding && !TK) { ctl.seated = null; CAM.ov.hold = false; CAM.ov.w = 0; CAM.ov.has = false; partnerOutOfCar(); } }
      ctl.time += dt; QY = ctl.pos.y; syncVehicles(); for (const v of VEH) { const s = act.get(v.spotId); if (s) { s.x = v.x; s.z = v.z; } }
      const st0 = ctl.state;
      if (ctl.seated && ctl.riding) rideUpdate(dt);
      if (ctl.seated && !ctl.riding) { ctl.speed = 0; }
      else if (TK) { TK.t += dt; const o = TK.o; if (ctl.riding) { if (o.heroState && !o._internal) ctl.state = o.heroState; } else if (!o._internal) { S.cmd = approach(S.cmd, 0, 12 * dt); ctl.speed = damp(ctl.speed, 0, 12, dt); if (o.heroState) ctl.state = o.heroState; else if (ctl.speed < .2) ctl.state = 'idle'; ctl.pos.y = stepY(ctl.pos.y, groundY(ctl.pos.x, ctl.pos.z, ctl.pos.y + .05), dt); }
        let done = false; try { done = o.update(dt, input) === true; } catch (e) { done = true; if (window.console) console.warn('[onfoot] takeover', e); } if (done && TK && TK.o === o) endTakeover(); }
      else if (!ctl.riding) control(dt);
      if (ctl.poseOverride && !TK && !ctl.seated && !S.jump && ctl.speed < .6 && !ctl.riding) ctl.state = ctl.poseOverride;   /* pt1: the host can hold a pose for a standing hero (hands up while an officer holds him) */
      if (ctl.state !== st0) S.stateT = 0; else S.stateT += dt;
      zoneUpdate();
      // hero pose
      { const on = ctl.view === 'fp' && !TK && !ctl.riding && !ctl.seated && S.ride.k <= 0; if (!on) { S.legWant = 0; S.legBack = false; } S.legYaw = damp(S.legYaw || 0, S.legWant || 0, 9, dt); if (abs(S.legYaw) < 1e-3 && !S.legWant) S.legYaw = 0; }
      placeHero(); const idle = ctl.state === 'idle' || ctl.state === 'crouch'; S.lookYaw = damp(S.lookYaw, idle && !TK ? clamp(angDiff(ctl.h, ctl.camera.yaw), -1.15, 1.15) * .75 : clamp(angDiff(ctl.h, ctl.camera.yaw), -.6, .6) * .25, 5, dt);
      if (S.jump && (TK || ctl.seated || ctl.riding)) { S.jump = null; S.arc = 0; }   /* pt1: a takeover (door, shop, cut-scene) or a seat ends a jump where it is */
      hero.update(dt, { jump: ctl.state === 'jump' || ctl.state === 'jump0' || ctl.state === 'land' ? S.jpose : null, state: ctl.state, speed: ctl.speed, turn: S.turn, lookYaw: S.lookYaw, lookPitch: clamp(ctl.camera.pitch - .1, -.5, .5) * .5, t: S.stateT, aimPitch: ctl.camera.pitch, swing: S.ride.swing, mountSide: S.ride.side, lean: S.ride.lean, steer: S.ride.steer, back: !!S.legBack, gripIK: S.ride.k >= 1 && !!(hero.src && hero.src.reach) });
      if (S.legYaw && hero.bones.spine && hero.bones.chest) { _qy.setFromAxisAngle(_ay, -S.legYaw * .5); hero.bones.spine.quaternion.premultiply(_qy); hero.bones.chest.quaternion.premultiply(_qy); }
      if (S.ride.k > 0) ridePose();
      partnerUpdate(dt);
      if (!TK && input.pressed('KeyV') && ctl.viewKey !== false) { input.consume('KeyV'); ctl.setView(ctl.view === 'fp' ? 'tp' : 'fp'); }
      if (ctl.view === 'fp') cameraFirst(dt); else cameraThird(dt); cameraFinal(dt);
      actUpdate(dt, { x: ctl.pos.x, y: ctl.pos.y, z: ctl.pos.z, h: ctl.riding ? ctl.h : ctl.view === 'fp' ? ctl.camera.yaw : ctl.h, look: ctl.view === 'fp' && !ctl.riding }, ctl.riding ? 'car' : 'foot', !TK && (!ctl.seated || !!ctl.riding));
      fpDot(ctl.view === 'fp' && !TK && !ctl.seated && !(CAM.ov.w > 0 && CAM.ov.has));
      subShow(dt);
    };
    /** optional: call while driving (ctl.enabled === false) so spots with mode 'car' / 'both' prompt and fire. p = {x, z, h, speed} */
    ctl.updateCar = (dt, p) => { if (!IN.latched && !IN.shared) input.frame(); IN.latched = false; IN.shared = false; act._ctl = ctl; ctl.time += dt; if (!p) return; actUpdate(dt, { x: p.x, z: p.z, h: p.h }, 'car', true); subShow(dt); };
    ctl.dispose = () => { for (const v of VEH) act.remove(v.spotId); VEH.length = 0; act.remove('ride:off'); if (hero.group.parent && !o.hero) hero.group.parent.remove(hero.group); if (pfig && pfig.group.parent && !o.partner) pfig.group.parent.remove(pfig.group); for (let i = 0; i < 3; i++) uiRow(i, null); };
    ctl._dbg = () => ({ S, CAM, P, A, TK, VEH });
    ctl.teleport(0, 0, 0); act._ctl = ctl; GT.onfoot.ctl = ctl; return ctl;
  }

  GT.onfoot = { create, addZone, addFloor, zones: ZONES, floors: FLOORS, ctl: null, figure: makeFigure, query: { groundY, isFree, segHit, segClear, resolve }, addOverhead, overheads: OVER, refreshColliders() { GRID.n = -1; }, standIn: { car: () => standInCar(), scooter: () => standInScooter() } };

  /* ================================================================== showcase: a self-built back-street test bed (used when the China-edition world modules are not loaded) */
  /** brush-painted wall slogan on a transparent ground (GT.signTex 'stencil' cuts Latin stencil bridges through every glyph, which wrecks Chinese) */
  function wallTextTex(text, tw, th, color) { const c = document.createElement('canvas'); c.width = tw; c.height = th; const g = c.getContext('2d'), r = GT.rng('wt' + text); g.textAlign = 'center'; g.textBaseline = 'middle'; let px = th * .78; g.font = `900 ${px}px "PingFang SC","Heiti SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
    const mw = g.measureText(text).width; if (mw > tw * .94) { px *= tw * .94 / mw; g.font = `900 ${px}px "PingFang SC","Heiti SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`; } g.fillStyle = color; g.globalAlpha = .86; g.fillText(text, tw / 2, th * .53); g.globalAlpha = .5; g.fillText(text, tw / 2 + 1, th * .53 + 1);
    g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 420; i++) { g.globalAlpha = .25 + r() * .5; const x = r() * tw, y = r() * th, s = 1 + r() * r() * 7; g.fillRect(x, y, s * (1 + r() * 2), s * .6); } for (let i = 0; i < 14; i++) { g.globalAlpha = .35; g.fillRect(r() * tw, 0, 1 + r() * 3, th); }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; }
  function signMesh(text, w, h, o) { o = o || {}; const tw = o.tw || 512, tex = o.wall ? wallTextTex(text, tw, max(32, Math.round(tw * h / w)), o.wall) : GT.signTex(text, Object.assign({ w: tw, h: max(32, Math.round(tw * h / w)) }, o.tex || {})); let m; if (o.wall) o.alpha = true;
    if (o.glow) { m = new T.MeshBasicMaterial({ map: tex, transparent: !!o.alpha }); GT.glow(m, new T.Color(1, 1, 1), o.glow[0], o.glow[1]); }
    else m = new T.MeshStandardMaterial({ map: tex, roughness: o.rough || .72, metalness: 0, transparent: !!o.alpha, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new T.Mesh(new T.PlaneGeometry(w, h), m); mesh.receiveShadow = !o.glow; return mesh; }
  /** parked saloon stand-in (only when no vehicle module is loaded) — same shape of object as GT.vehicles.make */
  function standInCar() { const k = GT.kit(), paint = GT.mat('car_paint', { color: 0x6f6f6a }), blk = GT.mat('plastic_black'), L = 4.42, W = 1.78;
    k.box(paint, W, .5, L, 0, .57, 0, { bevel: .1 }); k.box(paint, W - .06, .12, L - .7, 0, .84, -.05, { bevel: .05 }); k.box('glass_tint', W - .24, .44, 2.3, 0, 1.1, -.2, { bevel: .12 }); k.box(paint, W - .34, .05, 1.7, 0, 1.335, -.22, { bevel: .024 });
    for (const sx of [-1, 1]) { for (const z of [.9, -.22, -1.3]) k.box(paint, .05, .46, .07, sx * (W / 2 - .13), 1.1, z, { bevel: .02, rz: sx * .16 }); k.box(paint, .2, .11, .1, sx * (W / 2 + .07), .98, .72, { bevel: .035 }); k.box(blk, .03, .09, L - 1.5, sx * (W / 2 - .004), .36, 0, { bevel: .012 });
      for (const z of [.78, -.28, -1.2]) k.box(blk, .008, .46, .012, sx * (W / 2 + .001), .6, z); for (const z of [.35, -.72]) k.box('chrome', .016, .024, .14, sx * (W / 2 + .006), .78, z, { bevel: .006 });
      for (const z of [1.36, -1.34]) { k.cyl('rubber', .32, .32, .22, sx * .8, .32, z, { rz: HP, seg: 24 }); k.cyl('aluminium_brushed', .2, .2, .232, sx * .8, .32, z, { rz: HP, seg: 14 }); k.cyl('metal_dark', .06, .06, .24, sx * .8, .32, z, { rz: HP, seg: 10 }); k.box(blk, .06, .12, .78, sx * (W / 2 - .02), .6, z, { bevel: .03 }); }
      k.box('light_warm', .36, .09, .05, sx * .6, .68, L / 2 - .03, { bevel: .02 }); k.box('light_red', .4, .09, .05, sx * .58, .72, -L / 2 + .03, { bevel: .02 }); }
    k.box(blk, W - .02, .2, .2, 0, .37, L / 2 - .07, { bevel: .06 }); k.box(blk, W - .02, .2, .2, 0, .37, -L / 2 + .07, { bevel: .06 }); k.box(blk, .95, .12, .04, 0, .56, L / 2 + .002, { bevel: .01 }); k.box('chrome', .5, .014, .02, 0, .64, L / 2 + .01);
    k.box('glass_tint', .9, .012, .5, 0, 1.365, -.1, { bevel: .004 }); k.decal('grime_streak', 1.5, .5, 0, .832, 1.5, 0);
    const g = k.build(); for (const [z, ry] of [[L / 2 + .012, 0], [-L / 2 - .012, PI]]) { const p = signMesh('江A·7K302', .44, .14, { tw: 512, tex: { style: 'plate', bg: '#1d4fa8', color: '#f2f2f2', h: 160, distress: .25 } }); p.position.set(0, .44, z); p.rotation.y = ry; g.add(p); }
    return { group: g, kind: 'sedan', standIn: true, dims: { L, W, H: 1.38, wheelR: .32, eye: [.37, 1.1, -.12] }, update() {} }; }
  /** delivery e-scooter stand-in: yellow box on the rack, wheels are separate nodes so they spin. twoWheeler + seat as GT.cnvehicles will provide. */
  function standInScooter() { const root = new T.Group(), k = GT.kit(), yel = GT.mat('metal_painted_yellow', { rough: .42 }), blk = GT.mat('plastic_black'), gry = GT.mat('plastic_grey'), dk = GT.mat('metal_dark');
    k.box(blk, .3, .07, .52, 0, .235, .1, { bevel: .028 }); k.box('rubber', .25, .012, .42, 0, .276, .1, { bevel: .004 }); k.box(yel, .34, .33, .76, 0, .475, -.42, { bevel: .1 }); k.box(blk, .3, .1, .62, 0, .3, -.44, { bevel: .035 }); k.box('leather_black', .29, .085, .64, 0, .716, -.3, { bevel: .04 });
    k.box(yel, .36, .52, .07, 0, .57, .4, { bevel: .03, rx: -.2 }); k.box(yel, .28, .2, .2, 0, .8, .5, { bevel: .075 }); k.box(blk, .2, .045, .36, 0, .42, .62, { bevel: .02, rx: .12 }); k.box(blk, .16, .04, .36, 0, .43, -.64, { bevel: .018, rx: -.15 });
    k.cyl(dk, .022, .022, .36, 0, .96, .45, { rx: -.2 }); k.box(blk, .2, .1, .12, 0, 1.09, .42, { bevel: .04 }); k.box('emissive_screen', .1, .004, .05, 0, 1.142, .41); k.cyl(dk, .013, .013, .6, 0, 1.09, .4, { rz: HP });
    for (const sx of [-1, 1]) { k.cyl('rubber', .019, .019, .12, sx * .27, 1.09, .4, { rz: HP }); k.cyl(dk, .005, .005, .2, sx * .2, 1.2, .4, { rz: sx * -.25 }); k.box(blk, .1, .06, .014, sx * .235, 1.31, .4, { bevel: .006 }); k.cyl('metal_galv', .014, .014, .38, sx * .065, .36, .6, { rx: -.2 }); k.box('light_warm', .03, .02, .02, sx * .15, .78, .6, { bevel: .006 }); k.cyl(dk, .008, .008, .5, sx * .13, .46, -.68, { rx: .25 }); }
    k.sphere('light_warm', .055, 0, .82, .6, { s: [1.25, .85, .45] }); k.box('light_red', .12, .04, .025, 0, .61, -.805, { bevel: .008 }); k.cyl(dk, .008, .008, .3, -.12, .15, -.1, { rz: .5, rx: .2 });
    k.box(dk, .3, .02, .42, 0, .775, -.74, { bevel: .006 }); k.box(yel, .46, .44, .44, 0, 1.01, -.74, { bevel: .03 }); k.box(blk, .47, .028, .45, 0, 1.225, -.74, { bevel: .01 }); k.box(blk, .012, .44, .012, .224, 1.01, -.522); k.box(blk, .012, .44, .012, -.224, 1.01, -.522); k.box('metal_galv', .06, .03, .008, 0, 1.2, -.515, { bevel: .003 });
    root.add(k.build()); const wheels = [];
    for (const z of [.63, -.61]) { const wk = GT.kit(); wk.cyl('rubber', .2, .2, .095, 0, 0, 0, { rz: HP, seg: 22 }); wk.cyl('aluminium_brushed', .125, .125, .1, 0, 0, 0, { rz: HP, seg: 12 }); wk.cyl(dk, .04, .04, .13, 0, 0, 0, { rz: HP, seg: 8 }); const w = wk.build(); w.position.set(0, .2, z); root.add(w); wheels.push(w); }
    for (const [x, z, ry, w] of [[0, -.962, PI, .36], [.232, -.74, HP, .34], [-.232, -.74, -HP, .34]]) { const s = signMesh('跑得快', w, w * .36, { tw: 256, tex: { style: 'painted', bg: '#d8a515', color: '#1b1b1b', distress: .3 } }); s.position.set(x, 1.04, z); s.rotation.y = ry; root.add(s); }
    { const p = signMesh('江城·E0817', .2, .1, { tw: 256, tex: { style: 'painted', bg: '#e9e6da', color: '#16306b', distress: .2 } }); p.position.set(0, .5, -.812); p.rotation.y = PI; root.add(p); }
    return { group: root, kind: 'escooter', standIn: true, twoWheeler: true, seat: [0, .76, -.24], dims: { L: 1.78, W: .66, H: 1.24, wheelR: .2 }, wheels, maxSpeed: 11.5, update() {} }; }

  function buildTestStreet(scene) { const k = GT.kit(), rnd = GT.rng('onfoot-street'), W = GT.world, B = (x0, z0, x1, z1, h, tag) => W.addBox(x0, z0, x1, z1, h, tag || 'teststreet');
    const slab = (mat, x0, z0, x1, z1, y0, y1, bev) => k.box(mat, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, { bevel: bev === undefined ? .015 : bev });
    const signs = [], sign = (text, w, h, x, y, z, ry, o) => { const m = signMesh(text, w, h, o); m.position.set(x, y, z); m.rotation.y = ry || 0; if (o && o.rz) m.rotation.z = o.rz; signs.push(m); return m; };
    const fab = c => GT.mat('fabric_dark', { color: c }), card = GT.mat('wood_plank', { color: 0xb59467 });
    /** window with glass, frame and (optionally) a welded security cage with pots; dir = +1 faces +X, -1 faces -X, on the wall plane x = xf */
    const win = (xf, dir, zc, y0, w, h, cage) => { const x = xf + dir * .01; slab('glass_tint', x - .02, zc - w / 2, x + .02, zc + w / 2, y0, y0 + h, 0); slab('metal_painted_white', x - .04, zc - w / 2 - .05, x + .04, zc + w / 2 + .05, y0 - .06, y0, .01); slab('metal_painted_white', x - .03, zc - w / 2 - .05, x + .03, zc + w / 2 + .05, y0 + h, y0 + h + .05, .01);
      slab('metal_painted_white', x - .03, zc - .02, x + .03, zc + .02, y0, y0 + h, .006); slab('concrete_stained', xf - .06, zc - w / 2 - .08, xf + .06, zc + w / 2 + .08, y0 - .12, y0 - .06, .01);
      if (cage) { const d = .38, xo = xf + dir * d; for (let i = 0; i <= 8; i++) { const z = zc - w / 2 - .06 + (w + .12) * i / 8; k.box('metal_rust', .014, h + .16, .014, xo, y0 + h / 2 - .02, z); } for (const yy of [y0 - .1, y0 + h * .5, y0 + h + .06]) { k.box('metal_rust', .016, .016, w + .14, xo, yy, zc); for (const sz of [-1, 1]) k.box('metal_rust', d, .016, .016, xf + dir * d / 2, yy, zc + sz * (w / 2 + .06)); }
        k.box('metal_rust', d, .012, w + .12, xf + dir * d / 2, y0 - .1, zc, { bevel: .004 }); for (let i = 0; i < 3; i++) { const z = zc - w * .32 + i * w * .32 + (rnd() - .5) * .1; k.cyl('roof_tile_clay', .09, .065, .14, xf + dir * .22, y0 - .02, z, { seg: 10 }); k.sphere('foliage', .16 + rnd() * .06, xf + dir * .22, y0 + .16, z, { s: [1, 1.1 + rnd() * .5, 1], seg: 8, seg2: 6 }); } } };
    const ac = (xf, dir, y, z) => { const x = xf + dir * .2; k.box('metal_painted_white', .32, .56, .82, x, y, z, { bevel: .025 }); k.cyl('metal_dark', .2, .2, .012, xf + dir * .364, y, z + .14, { rz: HP, seg: 18 }); k.cyl('plastic_grey', .05, .05, .016, xf + dir * .37, y, z + .14, { rz: HP, seg: 10 }); for (const sz of [-.3, .3]) { k.box('metal_rust', .4, .03, .03, x, y - .3, z + sz); k.box('metal_rust', .03, .3, .03, xf + dir * .03, y - .44, z + sz, { rz: 0 }); }
      k.tube('plastic_white', [[xf + dir * .05, y - .2, z - .45], [xf + dir * .06, y - .9, z - .5], [xf + dir * .05, y - 2.2, z - .48]], .012); const q = new T.PlaneGeometry(.5, 1.6); k.geo(GT.decalMat('rust_run'), q, { x: xf + dir * .006, y: y - 1.1, z, ry: dir * HP }); };
    const stool = (x, z, m) => { k.box(m, .3, .03, .3, x, .46 + groundY(x, z), z, { bevel: .012 }); for (const a of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(m, .03, .45, .03, x + a[0] * .12, .225 + groundY(x, z), z + a[1] * .12, { bevel: .008, rz: a[0] * -.08, rx: a[1] * .08 }); };

    /* ---- ground, kerb, pavement */
    slab('asphalt_worn', -40, -40, 40, 40, -.3, 0, 0); slab('concrete', 4.12, -30, 7, 30, 0, .15, .01); slab('concrete_stained', 4, -30, 4.14, 30, 0, .16, .02); B(4, -30, 7, 30, .15, 'kerb');
    for (let z = -28; z < 30; z += 6) slab('curb_paint_yellow', 3.995, z, 4.145, z + 2.6, .1, .163, .018);
    k.cyl('metal_dark', .36, .36, .02, .8, .006, -3.2, { seg: 28 }); k.cyl('metal_rust', .3, .3, .022, .8, .006, -3.2, { seg: 6 }); slab('metal_dark', 3.5, 6.6, 3.96, 7.3, 0, .012, .004);
    for (const d of [['oil_stain', 2.4, 2.4, -2.6, 14.8, .3], ['oil_stain', 1.4, 1.4, 3.2, -11.6, 1], ['crack', 4, 2.4, -.5, -6, .4], ['crack', 3.6, 2, 1.5, 9, 2.1], ['crack', 3, 2, -3, 22, 1.2], ['puddle', 2.6, 1.7, .9, 3.6, .5], ['puddle', 1.8, 1.2, -1.6, -10.5, 2], ['puddle', 2.2, 1.3, 2.9, 19, .2], ['patch', 3, 2.2, -1.2, 18.5, .1], ['patch', 2.4, 1.8, 1.6, -19, 1.5],
      ['tire_marks', 5, 1.6, .2, -1.5, 1.45], ['grime_streak', 6, .8, 3.6, 2, HP], ['grime_streak', 6, .8, 3.6, -14, HP], ['water_stain', 2.6, 2.2, 3.2, 6.6, 0], ['leak', 1.6, 2.4, -6.9, -3.2, 0]]) k.decal(d[0], d[1], d[2], d[3], .012, d[4], d[5]);
    for (const d of [['gum_spots', 2.4, 2.4, 5.4, 1.5], ['gum_spots', 2.4, 2.4, 5.6, -5], ['water_stain', 2, 1.6, 6.2, 5.2], ['crack', 2.2, 1.4, 5.5, 12], ['grime_streak', 5, .7, 6.6, 12, HP], ['oil_stain', 1.2, 1.2, 6.2, -3.4]]) k.decal(d[0], d[1], d[2], d[3], .162, d[4], d[5] || 0);

    /* ---- the noodle shop (enterable): x 7..15, z -8..6 */
    const wallM = 'stucco_cream';
    slab(wallM, 7, -8, 7.25, -1.65, 0, 3.4); slab(wallM, 7, -.35, 7.25, 1, 0, 3.4); slab(wallM, 7, 1, 7.25, 4.6, 0, .95); slab(wallM, 7, 1, 7.25, 4.6, 2.35, 3.4); slab(wallM, 7, 4.6, 7.25, 6, 0, 3.4); slab(wallM, 7, -1.65, 7.25, -.35, 2.35, 3.4);
    slab(wallM, 7.25, -8, 15, -7.75, 0, 3.4); slab(wallM, 7.25, 5.75, 15, 6, 0, 3.4); slab(wallM, 14.75, -7.75, 15, 5.75, 0, 3.4); slab('stucco_white', 7, -8, 15, 6, 3.4, 6.7, .02); slab('concrete_stained', 6.9, -8.1, 15.1, 6.1, 6.7, 6.95, .03); slab('concrete_stained', 6.94, -8.06, 15.06, 6.06, 3.34, 3.46, .02);
    B(7, -8, 7.25, -1.65, 6.7, 'shop wall'); B(7, -.35, 7.25, 6, 6.7, 'shop wall window glass'); B(7.25, -8, 15, -7.75, 6.7, 'shop wall'); B(7.25, 5.75, 15, 6, 6.7, 'shop wall'); B(14.75, -7.75, 15, 5.75, 6.7, 'shop wall');
    for (const [z0, z1] of [[-8, -1.72], [-.28, 6]]) slab('tile_floor', 6.975, z0, 7.0, z1, .15, 1.05, .004);          // white ceramic dado, every back-street shopfront has one
    slab('glass_dirty', 7.11, 1, 7.14, 4.6, .95, 2.35, 0); for (const z of [1, 2.2, 3.4, 4.6]) slab('aluminium_brushed', 7.07, z - .025, 7.18, z + .025, .95, 2.35, .008); for (const y of [.95, 2.35]) slab('aluminium_brushed', 7.06, 1, 7.19, 4.6, y - .03, y + .03, .008);
    slab('terrazzo', 6.92, .95, 7.27, 4.65, .9, .95, .012); for (const z of [-1.65, -.35]) slab('aluminium_brushed', 7.05, z - .03, 7.2, z + .03, .15, 2.35, .01); slab('aluminium_brushed', 7.05, -1.65, 7.2, -.35, 2.3, 2.38, .01); slab('metal_galv', 6.96, -1.7, 7.28, -.3, .15, .17, .004);
    for (let i = 0; i < 8; i++) { const z = -1.6 + i * .16 + .08; k.box('glass_clear', .004, 2.12 - (i % 3) * .015, .15, 7.12 + sin(i * 2.1) * .012, 1.24 + (i % 3) * .008, z, { ry: sin(i * 1.3) * .12 }); }                   // PVC strip curtain
    slab('tile_floor', 7.25, -7.75, 14.75, 5.75, 0, .15, 0); slab('ceiling_panel', 7.25, -7.75, 14.75, 5.75, 3.0, 3.34, 0); for (const z of [-4.6, -.6, 3.2]) { slab('metal_painted_white', 10.3, z - .07, 11.7, z + .07, 2.94, 3.0, .01); slab('light_cool', 10.36, z - .03, 11.64, z + .03, 2.915, 2.94, .01); }
    slab('wood_painted', 12.6, -6.5, 13.2, -.5, .15, 1.1, .02); slab('terrazzo', 12.54, -6.56, 13.26, -.44, 1.1, 1.15, .012); slab('metal_galv', 12.585, -6.5, 12.6, -.5, .15, .32, .003); B(12.6, -6.5, 13.2, -.5, 1.15, 'counter');
    slab('wood_plank', 14.35, -7.6, 14.75, -.4, .15, 1.0, .015); slab('aluminium_brushed', 14.3, -7.62, 14.76, -.38, 1.0, 1.04, .01); B(14.3, -7.7, 14.75, -.4, 1.05, 'counter back');
    k.cyl('aluminium_brushed', .3, .28, .42, 14.5, 1.25, -5.6, { seg: 22 }); k.cyl('aluminium_brushed', .31, .31, .02, 14.5, 1.47, -5.6, { seg: 22 }); k.cyl('aluminium_brushed', .2, .19, .3, 14.52, 1.19, -4.5, { seg: 18 }); k.box('metal_dark', .5, .1, 1.9, 14.5, 1.0, -5.05, { bevel: .02 });
    for (let i = 0; i < 9; i++) { const z = -3.6 + i * .34, c = [0x7a1f16, 0x2c2a1c, 0xb9a36a, 0x3b1d12][i % 4]; k.cyl(GT.mat('plastic_red', { color: c }), .055, .06, .2 + (i % 3) * .04, 14.52, 1.14 + (i % 3) * .02, z, { seg: 10 }); k.cyl('plastic_white', .04, .04, .02, 14.52, 1.26 + (i % 3) * .04, z, { seg: 10 }); }
    for (let i = 0; i < 6; i++) { k.cyl('plastic_white', .085, .05, .07, 12.9, 1.185 + (i % 3) * .022, -5.9 + i * .19 - (i % 3) * .19 + (i > 2 ? .9 : 0), { seg: 14 }); } k.box('plastic_red', .16, .12, .12, 12.9, 1.21, -1.2, { bevel: .02 }); k.cyl('metal_galv', .05, .05, .16, 12.85, 1.23, -2.2, { seg: 10 });
    for (let i = 0; i < 7; i++) k.box('wood_plank', .008, .24, .008, 12.85 + sin(i * 2.4) * .025, 1.36, -2.2 + cos(i * 2.4) * .025, { rx: sin(i) * .12, rz: cos(i) * .12 });
    for (const zc of [2.0, 4.1]) { slab('wood_painted', 7.75, zc - .32, 8.85, zc + .32, .86, .9, .012); for (const a of [[7.83, -.25], [8.77, -.25], [7.83, .25], [8.77, .25]]) k.box('metal_dark', .03, .72, .03, a[0], .5, zc + a[1]); B(7.78, zc - .3, 8.82, zc + .3, .9, 'table');
      k.cyl('plastic_red', .04, .05, .15, 8.0, .975, zc - .1, { seg: 10 }); k.cyl('metal_galv', .035, .035, .11, 8.05, .955, zc + .12, { seg: 10 }); k.box('plastic_white', .11, .07, .11, 8.6, .935, zc + .05, { bevel: .01 }); }
    slab('metal_painted_white', 13.95, 4.5, 14.7, 5.25, .15, 2.1, .03); slab('emissive_screen', 13.935, 4.56, 13.95, 5.19, .5, 1.95, 0); slab('metal_dark', 13.92, 4.5, 13.95, 4.56, .3, 2.0, .004); B(13.95, 4.5, 14.75, 5.3, 2.1, 'fridge');
    slab('metal_painted_red', 14.7, -6.3, 14.745, -1.1, 1.75, 2.85, .01);
    ['热干面　８元', '牛肉粉　１５元', '三鲜豆皮　６元', '蛋酒　４元'].forEach((t, i) => sign(t, 2.3, .24, 14.69, 2.66 - i * .255, -3.7 + (i % 2) * .05, -HP, { tw: 512, tex: { style: 'painted', bg: '#8f1d16', color: '#f3e3b4', distress: .15 } }));
    sign('本店不赊账', 1.5, .3, 14.69, 1.62, -2.0, -HP, { tw: 512, tex: { style: 'painted', bg: '#efe6cf', color: '#a3231b', distress: .3 } }); sign('福', .46, .46, 11.2, 2.1, 5.74, PI, { tw: 256, rz: PI / 4, tex: { style: 'painted', bg: '#b3201a', color: '#f0cf78', distress: .2 } });
    sign('营业中', .9, .3, 7.1, 2.05, 2.8, -HP, { tw: 512, glow: [1.3, 2.6], tex: { style: 'neon', color: '#ff5a3c', bg: '#0a0605' } });
    /* shop front dressing: awning, sign board, light box, lanterns */
    k.box('corrugated_metal', 1.5, .03, 7.6, 6.28, 2.84, 1.3, { rz: .16, bevel: .004 }); k.box('metal_galv', .03, .05, 7.6, 5.55, 2.72, 1.3); for (const z of [-2.4, 1.3, 5.0]) { k.tube('metal_galv', [[7, 2.5, z], [5.6, 2.74, z]], .014); k.box('metal_galv', 1.48, .03, .03, 6.28, 2.82, z, { rz: .16 }); }
    slab('metal_dark', 6.9, -2.2, 7.0, 4.4, 3.5, 4.42, .012); sign('巷子口小面', 6.3, .84, 6.892, 3.96, 1.1, -HP, { tw: 1024, tex: { style: 'painted', bg: '#a8261c', color: '#f4e6bd', distress: .45 } });
    sign('热干面 · 牛肉粉 · 豆皮 · 蛋酒　　二十年老店', 6.3, .2, 6.89, 3.44, 1.1, -HP, { tw: 1024, th: 48, tex: { style: 'painted', bg: '#efe2bf', color: '#7b1a13', distress: .4 } });
    slab('metal_dark', 6.2, 5.62, 6.98, 5.74, 2.5, 5.3, .015); k.box('metal_dark', .7, .03, .03, 6.6, 5.2, 5.68); k.box('metal_dark', .7, .03, .03, 6.6, 2.7, 5.68);
    ['面', '粉', '饭'].forEach((t, i) => { for (const dz of [-1, 1]) sign(t, .7, .86, 6.59, 4.8 - i * .9, 5.68 + dz * .064, dz > 0 ? 0 : PI, { tw: 256, glow: [.95, 2.4], tex: { style: 'painted', bg: i === 1 ? '#f3ead2' : '#c12a1f', color: i === 1 ? '#b3261e' : '#f7ecc8', distress: .12 } }); });
    for (const z of [-2.05, .05]) { k.tube('rubber', [[6.86, 2.8, z], [6.86, 2.56, z]], .004); k.sphere('neon_red', .15, 6.86, 2.4, z, { s: [1, .82, 1], seg: 16 }); k.cyl('metal_painted_yellow', .06, .06, .03, 6.86, 2.535, z, { seg: 12 }); k.cyl('metal_painted_yellow', .05, .05, .03, 6.86, 2.27, z, { seg: 12 }); for (let i = 0; i < 6; i++) k.box('metal_painted_yellow', .004, .14, .004, 6.86 + sin(i) * .03, 2.19, z + cos(i) * .03); }
    win(7, -1, -5.2, 4.2, 1.5, 1.3, true); win(7, -1, 2.6, 4.2, 1.5, 1.3, true); ac(7, -1, 4.0, -2.2); ac(7, -1, 5.2, -.2);
    k.tube('metal_galv', [[6.6, 5.3, -5.9], [5.1, 5.34, -5.9]], .012); k.tube('metal_galv', [[6.6, 5.3, -4.5], [5.1, 5.34, -4.5]], .012); k.tube('metal_galv', [[5.2, 5.34, -6.1], [5.2, 5.34, -4.3]], .01);
    [[0x8a3a34, .5, .62], [0x3d5873, .46, .7], [0xc9c3b2, .42, .5], [0x4d6b4a, .5, .58]].forEach((c, i) => k.box(fab(c[0]), .02, c[2], c[1], 5.2, 5.34 - c[2] / 2 - .02, -5.95 + i * .52, { bevel: .008, rz: sin(i * 2) * .04 }));
    /* pavement clutter */
    k.box('wood_painted', .7, .03, .7, 5.3, .86, -5.6, { bevel: .01 }); for (const a of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box('metal_galv', .025, .7, .025, 5.3 + a[0] * .3, .5, -5.6 + a[1] * .3, { rz: a[0] * .05 }); B(4.98, -5.92, 5.62, -5.28, .9, 'table');
    stool(5.35, -6.4, GT.mat('plastic_red')); stool(4.62, -5.5, GT.mat('plastic_red', { color: 0x2f5fa0 })); stool(5.9, -4.95, GT.mat('plastic_red')); k.cyl('plastic_white', .09, .055, .075, 5.2, .915, -5.5, { seg: 14 }); k.cyl('plastic_red', .035, .04, .12, 5.45, .935, -5.75, { seg: 10 });
    k.cyl(GT.mat('metal_painted_blue', { color: 0x6c7f8f }), .16, .16, .62, 6.6, .5, 5.2, { seg: 18 }); k.sphere(GT.mat('metal_painted_blue', { color: 0x6c7f8f }), .16, 6.6, .81, 5.2, { s: [1, .6, 1] }); k.cyl('metal_rust', .1, .1, .06, 6.6, .92, 5.2, { seg: 12, open: true }); k.cyl('metal_rust', .17, .17, .04, 6.6, .17, 5.2, { seg: 14 }); k.tube('rubber', [[6.6, .95, 5.2], [6.75, .7, 5.0], [6.95, .5, 4.9]], .012); B(6.42, 5.02, 6.78, 5.38, 1, 'gas bottle post');
    for (let i = 0; i < 3; i++) { const z = 1.5 + i * 1.02; k.box(GT.mat('plastic_white', { color: 0xe4e2d8 }), .36, .26, .62, 6.72, .28, z, { bevel: .03, ry: (rnd() - .5) * .1 }); k.box('dirt', .3, .02, .56, 6.72, .405, z); for (let j = 0; j < 3; j++) k.sphere('foliage', .13 + rnd() * .09, 6.72 + (rnd() - .5) * .1, .52 + rnd() * .12, z - .18 + j * .18, { s: [1, 1.2 + rnd() * .6, 1], seg: 8, seg2: 6 }); }
    B(6.5, 1.1, 6.94, 3.95, .42, 'planter');
    k.cyl(GT.mat('plastic_red', { color: 0x3a6ea8 }), .15, .12, .26, 6.7, .28, -7.3, { seg: 14, open: true }); k.tube('wood_plank', [[6.72, .2, -7.3], [6.86, 1.5, -7.42]], .013); k.box(fab(0x8f8a7c), .22, .1, .1, 6.7, .25, -7.3, { bevel: .03 });
    for (let i = 0; i < 4; i++) k.box(GT.mat('plastic_grey', { color: [0x2e5f9a, 0x9a2f2a, 0x2e5f9a, 0x3d7a4a][i] }), .52, .3, .36, 6.62 + (i === 3 ? -.56 : 0), .3 + (i === 3 ? 0 : i) * .305, 7.6 + (i === 3 ? .05 : sin(i) * .03), { bevel: .02, ry: (rnd() - .5) * .12 }); B(6.0, 7.35, 6.92, 7.85, 1.1, 'crates post');
    { const g0 = groundY(4.75, -2.9); for (const s of [-1, 1]) k.box('wood_painted', .5, .82, .025, 4.75, g0 + .4, -2.9 + s * .13, { rx: s * -.16, bevel: .008 }); B(4.5, -3.1, 5.0, -2.7, .85, 'a-frame post'); for (const s of [-1, 1]) { const m = sign('外卖取餐', .44, .22, 4.75, g0 + .56, -2.9 + s * .166, s > 0 ? 0 : PI, { tw: 256, tex: { style: 'painted', bg: '#e8e0c8', color: '#b3261e', distress: .35 } }); m.rotation.x = s * -.16; const m2 = sign('请勿堵门', .44, .16, 4.75, g0 + .34, -2.9 + s * .2, s > 0 ? 0 : PI, { tw: 256, tex: { style: 'painted', bg: '#e8e0c8', color: '#26211b', distress: .35 } }); m2.rotation.x = s * -.16; } }

    /* ---- neighbours on the east side */
    slab('brick_painted', 7, 6, 15, 20, 0, 7.2, .02); B(7, 6, 15, 20, 7.2, 'building'); slab('concrete_stained', 6.92, 5.98, 15.08, 20.08, 7.2, 7.5, .03);
    slab('corrugated_metal', 6.955, 9, 7.0, 12.6, .15, 2.95, .004); slab('metal_dark', 6.93, 8.9, 7.0, 9, .15, 3.05, .008); slab('metal_dark', 6.93, 12.6, 7.0, 12.7, .15, 3.05, .008); slab('metal_dark', 6.9, 8.9, 7.0, 12.7, 2.95, 3.2, .01); slab('metal_galv', 6.93, 9.05, 6.96, 12.55, .15, .24, .006);
    sign('旺铺招租', 1.7, .42, 6.945, 2.0, 10.8, -HP, { tw: 512, wall: '#a8241c' }); sign('文明养犬　从我做起', 5.2, .52, 6.99, 3.75, 13.2, -HP, { tw: 1024, wall: '#a3231b' });
    [['开锁换锁', '#f2e9c9', '#b3261e'], ['疏通下水道', '#e9f0e2', '#1f4d2a'], ['空调移机', '#e6eef5', '#1b3f7a'], ['回收旧家电', '#f5e7d0', '#26211b'], ['搬家拉货', '#fbf3c0', '#b3261e'], ['上门修伞', '#efe9df', '#3b2b6b']].forEach((a, i) => sign(a[0], .34, .13, 6.992, 1.25 + (i % 3) * .21 + rnd() * .05, 7.0 + (i > 2 ? 6.4 : 0) + (i % 2) * .4 + rnd() * .2, -HP, { tw: 256, rz: (rnd() - .5) * .14, tex: { style: 'painted', bg: a[1], color: a[2], distress: .5 } }));
    k.tube('plastic_grey', [[6.92, 7.2, 6.3], [6.92, .5, 6.3], [6.8, .26, 6.3]], .055, { seg: 10 }); for (const y of [1.2, 3.2, 5.4]) k.box('metal_galv', .14, .03, .14, 6.93, y, 6.3, { bevel: .005 });
    for (let i = 0; i < 3; i++) { k.box('metal_galv', .14, .36, .26, 6.93, 1.75, 14.0 + i * .34, { bevel: .012 }); k.box('glass_dirty', .01, .1, .14, 6.855, 1.82, 14.0 + i * .34); k.tube('plastic_grey', [[6.95, 1.93, 14.0 + i * .34], [6.95, 3.4 + i * .06, 14.0 + i * .34], [6.95, 3.5 + i * .06, 17.5]], .012); }
    win(7, -1, 8.6, 4.4, 1.5, 1.3, true); win(7, -1, 16.4, 4.4, 1.5, 1.3, true); ac(7, -1, 4.2, 12.2); ac(7, -1, 5.6, 18.6);
    slab('cinderblock', 7, 23, 15, 30, 0, 5.6, .02); B(7, 23, 15, 30, 5.6, 'building'); slab('concrete_stained', 6.94, 22.94, 15.06, 30.06, 5.6, 5.85, .03); win(7, -1, 26.4, 1.4, 1.6, 1.2, true); ac(7, -1, 3.6, 24.2);
    sign('老街五金 · 水暖电料', 3.8, .5, 6.985, 3.1, 26.4, -HP, { tw: 1024, tex: { style: 'painted', bg: '#1f4f8a', color: '#f1efe6', distress: .45 } });
    slab('brick_painted', 15, 18, 17, 25, 0, 5, .02); B(15, 18, 17, 25, 5, 'building'); slab('metal_painted_blue', 14.955, 20.9, 15, 21.9, 0, 2.05, .01); slab('metal_dark', 14.94, 20.82, 15, 20.9, 0, 2.12, .006); slab('metal_dark', 14.94, 21.9, 15, 21.98, 0, 2.12, .006); k.sphere('light_warm', .07, 14.86, 2.42, 21.4, { s: [1, .7, 1] }); k.box('metal_dark', .16, .05, .12, 14.9, 2.5, 21.4, { bevel: .01 });
    for (const [x, c] of [[13.6, 0x3d6b4a], [12.75, 0x4a4d52]]) { k.box(GT.mat('plastic_grey', { color: c }), .6, .9, .7, x, .47, 20.5, { bevel: .04 }); k.box(GT.mat('plastic_grey', { color: c }), .64, .06, .74, x, .95, 20.48, { bevel: .02, rx: -.05 }); B(x - .3, 20.15, x + .3, 20.85, 1, 'bin'); }
    k.tube('metal_rust', [[7.4, 2.6, 20.06], [14.6, 2.6, 20.06]], .03); k.tube('plastic_grey', [[7.4, 2.9, 22.94], [14.6, 2.75, 22.94]], .02); k.decal('puddle', 1.6, 1, 9.4, .012, 21.3, .3);
    slab('stucco_white', 7, -30, 15, -8, 0, 7.4, .02); B(7, -30, 15, -8.02, 7.4, 'building'); win(7, -1, -12, 4.4, 1.5, 1.3, true); win(7, -1, -18.5, 4.4, 1.5, 1.3, true); win(7, -1, -25, 4.4, 1.5, 1.3, false); ac(7, -1, 4.1, -14.6); ac(7, -1, 4.3, -21.4);
    slab('corrugated_metal', 6.955, -17.5, 7.0, -13.5, .15, 2.9, .004); slab('metal_dark', 6.9, -17.6, 7.0, -13.4, 2.9, 3.14, .01); sign('便民理发', 3.4, .62, 6.985, 3.55, -15.5, -HP, { tw: 512, tex: { style: 'painted', bg: '#e8e2d0', color: '#1f6a5a', distress: .5 } }); for (const z of [-20, -27, -9.6]) slab('tile_floor', 6.975, z - 1.4, 7.0, z + 1.4, .15, 1.05, .004);

    /* ---- west side: courier depot on a loading dock (stairs), low wall + planting, perimeter wall, tenement backdrop */
    slab('stucco_white', -17, -16, -12, -4, 0, 5.8, .02); B(-17, -16, -12, -4, 5.8, 'building'); slab('concrete_stained', -17.06, -16.06, -11.94, -3.94, 5.8, 6.05, .03);
    slab('concrete_stained', -12, -14, -6, -6, 0, 1.12, .02); B(-12, -14, -6, -6, 1.12, 'dock'); slab('metal_painted_yellow', -6.02, -14, -5.98, -6, .98, 1.125, .008); for (let z = -13.5; z < -6; z += 1) slab('metal_dark', -6.03, z, -5.975, z + .5, .98, 1.127, .006);
    for (let i = 0; i < 6; i++) { const top = 1.12 - .16 * (i + 1), z0 = -6 + .32 * i; slab('concrete', -10.4, z0, -8, z0 + .32, 0, top, .012); slab('curb_paint_yellow', -10.4, z0 + .26, -8, z0 + .322, top - .01, top + .004, .003); B(-10.4, z0, -8, z0 + .32, top, 'stair'); }
    for (const x of [-10.4, -8]) { k.tube('metal_galv', [[x, 2.02, -6.02], [x, 1.06, -4.1], [x, 1.0, -3.95]], .022); k.box('metal_galv', .04, .92, .04, x, 1.58, -6.02); k.box('metal_galv', .04, .98, .04, x, .5, -4.02); k.tube('metal_galv', [[x, 1.56, -6.02], [x, .58, -4.06]], .014); }
    const rail = (x0, z0, x1, z1) => { const n = max(1, Math.round(hyp(x1 - x0, z1 - z0) / 1.3)); for (let i = 0; i <= n; i++) k.box('metal_galv', .04, .94, .04, lerp(x0, x1, i / n), 1.59, lerp(z0, z1, i / n)); for (const y of [2.04, 1.58]) k.tube('metal_galv', [[x0, y, z0], [x1, y, z1]], y > 2 ? .022 : .014); B(min(x0, x1) - .04, min(z0, z1) - .04, max(x0, x1) + .04, max(z0, z1) + .04, 2.1, 'rail'); };
    rail(-12, -6.02, -10.4, -6.02); rail(-8, -6.02, -6.02, -6.02); rail(-6.02, -6.02, -6.02, -14);
    slab('cinderblock', -17, -30, -6, -14, 0, 6.4, .02); B(-17, -30, -6, -14, 6.4, 'building'); slab('concrete_stained', -17.06, -30.06, -5.94, -13.94, 6.4, 6.62, .03); sign('仓库重地　严禁烟火', 4.4, .5, -5.99, 3.0, -22, HP, { tw: 1024, wall: '#a3231b' }); ac(-6, 1, 4.4, -18); ac(-6, 1, 4.6, -26);
    slab('plastic_black', -12.02, -12.6, -11.96, -8.9, 1.12, 3.3, 0); slab('corrugated_metal', -11.99, -12.6, -11.94, -8.9, 2.5, 3.5, .004); slab('metal_dark', -12, -12.72, -11.9, -12.6, 1.12, 3.6, .008); slab('metal_dark', -12, -8.9, -11.9, -8.78, 1.12, 3.6, .008); slab('metal_dark', -12, -12.72, -11.88, -8.78, 3.5, 3.72, .01);
    sign('四方街快递代收点', 4.6, .62, -11.965, 4.25, -10.75, HP, { tw: 1024, tex: { style: 'painted', bg: '#1d4f96', color: '#f3f1e8', distress: .4 } }); sign('取件请报手机尾号', 1.9, .22, -11.975, 2.0, -7.4, HP, { tw: 512, tex: { style: 'painted', bg: '#f0e9d2', color: '#26211b', distress: .4 } });
    { const colH = {}; for (let i = 0; i < 18; i++) { const w = .3 + rnd() * .28, h = .16 + rnd() * .22, d = .26 + rnd() * .26, col = i % 5 === 0 ? GT.mat('plastic_white', { color: 0xd9d6cb }) : i % 7 === 0 ? GT.mat('plastic_black', { color: 0x2a2c30 }) : card, grp = i < 10 ? 0 : 1, ci = grp * 10 + (i % (grp ? 2 : 3)), z = grp ? -13.55 + (i % 2) * .6 : -7.95 + (i % 3) * .56, y0 = colH[ci] || 1.12;
        k.box(col, w, h, d, -11.5 + (rnd() - .5) * .12, y0 + h / 2, z + (rnd() - .5) * .06, { bevel: .012, ry: (rnd() - .5) * .35 }); colH[ci] = y0 + h; } }
    B(-12, -8.3, -10.9, -6.5, 2.0, 'parcels post'); B(-12, -14, -10.9, -12.9, 1.9, 'parcels post');
    slab('metal_painted_blue', -7.1, -13.7, -6.3, -12.9, 1.12, 1.24, .02); for (const a of [[-7, -13.6], [-6.4, -13.6], [-7, -13], [-6.4, -13]]) k.cyl('rubber', .05, .05, .04, a[0], 1.17, a[1], { rz: HP }); k.tube('metal_galv', [[-7.06, 1.24, -13.66], [-7.06, 2.1, -13.76], [-6.34, 2.1, -13.76], [-6.34, 1.24, -13.66]], .016); k.box(card, .5, .4, .45, -6.7, 1.44, -13.3, { bevel: .012, ry: .2 });
    slab('cinderblock', -4.6, 2, -4.3, 12, 0, .85, .012); slab('concrete', -4.65, 1.95, -4.25, 12.05, .85, .9, .015); B(-4.6, 2, -4.3, 12, .9, 'low wall'); slab('dirt', -13, 2, -4.6, 12, 0, .05, 0);
    for (let i = 0; i < 9; i++) { const x = -5.4 - rnd() * 6.5, z = 2.8 + rnd() * 8.4, r = .45 + rnd() * .5; k.sphere('foliage', r, x, r * .62, z, { s: [1.15, .8, 1.1], seg: 9, seg2: 7 }); }
    { const tx = -8.2, tz = 7.2; k.cyl('palm_trunk', .16, .24, 3.4, tx, 1.7, tz, { seg: 10 }); k.cyl('palm_trunk', .1, .15, 1.9, tx + .5, 3.9, tz + .2, { seg: 8, rz: -.55 }); k.cyl('palm_trunk', .09, .14, 1.8, tx - .45, 3.9, tz - .25, { seg: 8, rz: .5, rx: .2 }); for (let i = 0; i < 11; i++) { const a = i * 2.4, r = .9 + rnd() * 1.5, rr = 1 + rnd() * .8; k.sphere('foliage', rr, tx + cos(a) * r, 4.6 + rnd() * 1.6, tz + sin(a) * r, { s: [1.1, .72, 1.1], seg: 9, seg2: 7 }); } B(tx - .25, tz - .25, tx + .25, tz + .25, 3.4, 'tree post'); }
    slab('brick_painted', -13.3, -4, -13, 30, 0, 2.6, .012); slab('concrete_stained', -13.36, -4, -12.94, 30, 2.6, 2.7, .015); B(-13.3, -4, -13, 30, 2.7, 'wall'); k.geo(GT.decalMat('grime_streak'), new T.PlaneGeometry(1.2, 2.4), { x: -12.985, y: 1.3, z: 20, ry: HP }); k.geo(GT.decalMat('water_stain'), new T.PlaneGeometry(2, 2), { x: -12.985, y: 1.5, z: 14.5, ry: HP });
    sign('小心台阶', .7, .2, -10.42, 1.75, -5.99, 0, { tw: 256, tex: { style: 'painted', bg: '#e9c81e', color: '#1b1b1b', distress: .4 } });
    for (const [x0, z0, x1, z1, h, mat] of [[-28, -3, -15, 14, 17, 'stucco_cream'], [-28, 17, -15, 36, 13.5, 'stucco_white']]) { slab(mat, x0, z0, x1, z1, 0, h, .03); for (let f = 0; f < Math.floor((h - 3.4) / 3); f++) for (let z = z0 + 1.6; z < z1 - 1; z += 3.1) { slab('glass_tint', x1 - .02, z - .7, x1 + .02, z + .7, 3.6 + f * 3, 4.9 + f * 3, 0); slab('concrete_stained', x1, z - .8, x1 + .1, z + .8, 3.5 + f * 3, 3.58 + f * 3, .01); if ((f * 7 + Math.round(z)) % 3 === 0) k.box('metal_painted_white', .3, .5, .75, x1 + .17, 3.3 + f * 3, z + 1.4, { bevel: .02 }); if ((f * 5 + Math.round(z)) % 4 === 1) k.box(fab([0x8a3a34, 0x3d5873, 0xc9c3b2][f % 3]), .02, .6, 1.1, x1 + .5, 4.3 + f * 3, z, { bevel: .008 }); } }
    /* ---- both ends of the lane */
    slab('stucco_white', -14, 30, 17, 39, 0, 9, .03); B(-14, 30, 17, 39, 9, 'building'); for (let x = -11.5; x < 15; x += 3.3) for (const y of [4.1, 6.9]) { slab('glass_tint', x - .7, 29.98, x + .7, 30.02, y, y + 1.3, 0); slab('concrete_stained', x - .8, 29.9, x + .8, 30, y - .1, y - .02, .01); }
    for (const x of [-9, -2.5, 4]) { slab('corrugated_metal', x - 1.5, 29.955, x + 1.5, 30, 0, 2.8, .004); slab('metal_dark', x - 1.6, 29.9, x + 1.6, 30, 2.8, 3.04, .01); }
    { const s1 = sign('江城日杂 · 烟酒副食', 5.4, .7, -2.5, 3.5, 29.94, PI, { tw: 1024, tex: { style: 'painted', bg: '#b3261e', color: '#f6e9bf', distress: .45 } }), s2 = sign('老友棋牌', 2.6, .6, 4, 3.45, 29.94, PI, { tw: 512, tex: { style: 'painted', bg: '#20563f', color: '#f1e7c2', distress: .45 } }), s3 = sign('修车补胎', 2.4, .56, -9, 3.42, 29.94, PI, { tw: 512, tex: { style: 'painted', bg: '#e9e3cf', color: '#1b1b1b', distress: .5 } }); void s1; void s2; void s3; }
    slab('brick_painted', -14, -39, 17, -30, 0, 8, .03); B(-14, -39, 17, -30, 8, 'building'); for (let x = -3.5; x < 6; x += 3.3) for (const y of [4.1, 6.4]) slab('glass_tint', x - .7, -30.02, x + .7, -29.98, y, y + 1.2, 0); sign('四方街 · 南巷', 2.2, .46, 1, 2.6, -29.97, 0, { tw: 512, tex: { style: 'painted', bg: '#1d4f96', color: '#f3f1e8', distress: .3 } });
    /* ---- lamps + overhead wires */
    const lamps = []; for (const [x, z, sx] of [[4.5, 15.5, -1], [-12.6, -1.5, 1], [4.5, -21, -1]]) { const g0 = groundY(x, z); k.cyl('metal_galv', .06, .085, 6.2, x, g0 + 3.1, z, { seg: 12 }); k.cyl('metal_dark', .11, .12, .5, x, g0 + .25, z, { seg: 12 }); k.tube('metal_galv', [[x, g0 + 6.0, z], [x + sx * .7, g0 + 6.35, z], [x + sx * 1.9, g0 + 6.3, z]], .035); k.box('metal_dark', .7, .1, .26, x + sx * 2.0, g0 + 6.26, z, { bevel: .04 }); k.box('light_warm', .5, .03, .18, x + sx * 2.0, g0 + 6.2, z, { bevel: .01 });
      B(x - .1, z - .1, x + .1, z + .1, 6.2, 'lamp post pole'); const L = new T.PointLight(0xffc98a, 0, 22, 1.6); L.position.set(x + sx * 2.0, g0 + 6.0, z); scene.add(L); lamps.push(L); }
    for (const w of [[[7, 6.4, -6], [1, 5.5, -8], [-6, 5.9, -11], [-12, 5.6, -10]], [[7, 6.9, 7], [4.5, 6.15, 15.5], [0, 5.3, 22], [-13.1, 2.9, 26]], [[4.5, 6.1, 15.5], [5.2, 5.2, 3], [4.5, 6.1, -21]], [[7, 5.2, 19.5], [2, 4.6, 12], [-12.6, 6.1, -1.5]], [[4.5, 5.9, -21], [-2, 5.1, -18], [-6, 6.2, -15]]]) for (let j = 0; j < 2; j++) k.tube('rubber', w.map((p, i) => [p[0], p[1] - j * .09 - (i > 0 && i < w.length - 1 ? j * .12 : 0), p[2] + j * .05]), .011, { seg: 5 });
    const grp = k.build(); grp.name = 'onfoot_teststreet'; for (const m of signs) grp.add(m); scene.add(grp);
    const inLight = new T.PointLight(0xfff0d8, .9, 13, 1.5); inLight.position.set(10.8, 2.55, -1); scene.add(inLight); const lan = new T.PointLight(0xff5a30, 0, 7, 1.8); lan.position.set(6.3, 2.3, -1); scene.add(lan);
    addZone({ id: 'tsShop', x0: 7.25, x1: 14.75, z0: -7.75, z1: 5.75, indoor: true, ceil: 3.0, floor: .15 }); addZone({ id: 'tsLane', x0: -13, x1: 7, z0: -30, z1: 30 }); addZone({ id: 'tsDock', x0: -12, x1: -6, z0: -14, z1: -6 });
    W.anchor('tsShopDoor', { x: 6.6, z: -1, h: HP }); W.anchor('tsCounter', { x: 12.05, z: -3.4, h: HP }); W.anchor('tsDock', { x: -9.2, z: -9, h: PI }); W.anchor('tsScooter', { x: 3.3, z: -12, h: 0 }); W.anchor('tsCar', { x: -2.8, z: 15.5, h: 0 });
    return { update() { const n = (GT.env && GT.env.night) || 0; for (const L of lamps) L.intensity = n * 2.2; lan.intensity = n * 1.1; inLight.intensity = .7 + n * .7; } }; }

  GT.showcase.onfoot = ({ scene, camera }) => {
    const Q = new URLSearchParams(location.search), script = Q.get('script') || 'walk', at = Q.get('at') !== null ? +Q.get('at') : 2.5, live = Q.get('live') === '1' || script === 'free';
    const cn = !!(GT.cnroad && GT.cnroad.build) && Q.get('world') !== 'test'; let street = null; const worldUp = [];
    if (cn) { for (const m of ['cnroad', 'riverside', 'snackstreet', 'hotpot', 'landmarks']) if (GT[m] && GT[m].build && Q.get('no') !== m) { safe(() => GT[m].build(scene)); if (GT[m].update) worldUp.push(GT[m]); } }
    else { GROUND_FN = () => 0; street = buildTestStreet(scene); }
    const R0 = cn ? GT.CN.riderStart : { x: 3.3, z: -12, h: 0 }, C0 = cn ? { x: R0.x + 6, z: R0.z + 3, h: R0.h } : { x: -2.8, z: 15.5, h: 0 };
    const mk = (kinds, standIn) => { let v = null; if (GT.cnvehicles && GT.cnvehicles.make) for (const kd of kinds) { v = safe(() => GT.cnvehicles.make(kd, {}), null); if (v && v.group) break; v = null; } return v || standIn(); };
    const scooter = mk(['escooter'], standInScooter), car = mk(['sports', 'taxi'], () => (GT.vehicles && GT.vehicles.make && safe(() => GT.vehicles.make('hero', { plate: '江A·7K302' }), null)) || standInCar());
    for (const [v, p] of [[scooter, R0], [car, C0]]) { v.group.position.set(p.x, cn ? roadY(p.x, p.z) : 0, p.z); v.group.rotation.y = p.h; scene.add(v.group); }
    if (Q.get('pillion') === '1') scooter.pillion = true;
    const ctl = GT.onfoot.create({ scene, camera, dom: document.getElementById('c'), pointerLock: live, groundHeight: cn ? undefined : () => 0 }); ctl.setVehicles([scooter, car]); ctl.rideAssist = true;
    if (!GT.wallet.cash) GT.wallet.add(50, 'demo');
    if (!cn) {
      act.add({ id: 'demo:menu', x: 6.35, z: 2.8, r: 1.5, label: '看看今天的菜单', hold: .8, marker: true, onUse(ctx) { let t = 0; const p = ctx.ctl.pos, h = ctx.ctl.h; ctx.ctl.say('阿凯', '热干面八块……兜里还差两块。');
          ctx.ctl.takeover({ heroState: 'use', update(dt) { t += dt; return t > 2.6; }, camera() { const a = h + 2.3 + t * .12; return { pos: [p.x + sin(a) * 1.7, p.y + 1.5, p.z + cos(a) * 1.7], look: [p.x + sin(h) * .5, p.y + 1.25, p.z + cos(h) * .5], fov: 46 }; } }); } });
      act.add({ id: 'demo:plants', x: 6.3, z: 3.7, r: 1.6, label: '给泡沫箱里的葱浇点水', key: 'KeyG', onUse(ctx) { ctx.ctl.say('阿烈', '哥，那是人家老板的葱。'); } });
      act.add({ id: 'demo:order', x: 12.05, z: -3.4, r: 1.5, label: () => '点一碗热干面  ¥8', marker: true, enabled: () => GT.wallet.cash >= 8, onUse(ctx) { GT.wallet.spend(8); ctx.ctl.say('老板', '热干面一碗——要得，坐到等！'); } });
      act.add({ id: 'demo:parcel', x: -10.6, z: -8.9, y: 1.12, r: 1.6, label: '取快递', hold: 1, marker: true, onUse(ctx) { ctx.ctl.say('阿凯', '尾号 0817……又是我妈寄的腊肉。'); } });
    }
    const yawRate = (t, t0, t1, total) => t >= t0 && t < t1 ? total / (t1 - t0) / 60 : 0, once = {}, fire = (k, t, when, fn) => { if (t >= when && !once[k]) { once[k] = true; fn(); } };
    const SC = {
      walk: { start: [1.2, -13, 0], run(t) { return { down: ['KeyW'], dx: yawRate(t, 2.2, 3.4, -.4) }; } },
      run: { start: [0, -22, 0], run(t) { fire('s', t, 3, () => ctl.say('阿烈', '哥，等等我！你跑那么快搞么斯。')); return { down: ['KeyW', 'ShiftLeft'], dx: yawRate(t, 2.5, 4, .5) }; } },
      orbit: { start: [2.2, -1, HP], run(t) { return { down: [], dx: t > .3 ? TAU / 8 / 60 : 0, dy: sin(t * .8) * .0015 }; } },
      corner: { start: [5.5, 14, 0], run(t) { return { down: ['KeyW'], dx: yawRate(t, 4.3, 5.3, -HP) }; } },
      interact: { start: [5.6, .6, 0], run(t) { return { down: (t < 1.3 ? ['KeyW'] : []).concat(t >= 2.0 && t < 3.4 ? ['KeyE'] : []), press: t >= 2.0 && !once.e ? (once.e = 1, ['KeyE']) : null }; } },
      car: { start: [.5, 9, 0], run(t) { fire('c', t, .4, () => ctl.playEnterCar(car, () => { once.seated = t; })); return { down: [] }; } },
      exit: { start: [.5, 9, 0], run(t) { fire('c', t, .05, () => { const v = ctl._dbg().VEH[1]; if (!v) return; const e = car.dims.eye; camera.position.set(v.x + e[0] * v.c + e[2] * v.s, e[1], v.z - e[0] * v.s + e[2] * v.c); camera.lookAt(camera.position.x + sin(v.h) * 10, e[1] - .35, camera.position.z + cos(v.h) * 10); camera.updateMatrixWorld(); const d = ctl._dbg().P; if (ctl.partnerFig) { d.mode = 'car'; d.car = v; d.placed = true; } ctl.playExitCar(car); }); return { down: t > 2.4 ? ['KeyW'] : [] }; } },
      scooter: { start: [5.5, -15, 0], run(t) { fire('m', t, .3, () => ctl.playEnterCar(scooter, () => { once.rid = t; })); fire('o', t, 13.5, () => ctl.playExitCar()); return { down: (t < 9.5 ? ['KeyW'] : t < 12.5 ? ['KeyS'] : []).concat(t > 6.2 && t < 7 ? ['KeyA'] : t > 7.4 && t < 8.1 ? ['KeyD'] : []) }; } },
      partner: { start: [0, -10, 0], run(t) { fire('s', t, 1, () => ctl.say('阿烈', '哥，这单跑完，我请你恰火锅。')); fire('g', t, 26, () => ctl.partner.goTo(2, 2, () => ctl.say('阿烈', '到了。'))); fire('f', t, 32, () => ctl.partner.follow(true)); return { down: t < 3.2 || (t > 20 && t < 22) ? ['KeyW'] : [], dx: yawRate(t, 1.2, 2.4, 1.2) + yawRate(t, 4, 6, -2.4) }; } },
      indoor: { start: [5.3, -1, HP], run(t) { return { down: t < 4.2 ? ['KeyW'] : [], dx: yawRate(t, 5, 9, 2.4) }; } },
      stairs: { start: [-9.2, -1.2, PI], run(t) { return { down: t < 5 ? ['KeyW'] : [], dx: yawRate(t, 5.2, 7.2, -2.2) }; } },
      vault: { start: [1.5, 7, -HP], run() { return { down: ['KeyW', 'ShiftLeft'] }; } },
      free: { start: [1.2, -13, 0], run() { return null; } }
    };
    const sc = SC[script] || SC.walk, base = cn ? [R0.x + 2.5, R0.z + 2, R0.h] : sc.start, sp = [Q.get('px') !== null ? +Q.get('px') : base[0], Q.get('pz') !== null ? +Q.get('pz') : base[1], Q.get('ph') !== null ? +Q.get('ph') : base[2]];
    ctl.teleport(sp[0], sp[1], sp[2]); if (Q.get('yaw') !== null) ctl.camera.yaw = +Q.get('yaw'); if (Q.get('pitch') !== null) ctl.camera.pitch = +Q.get('pitch'); if (Q.get('shoulder')) ctl.camera.shoulder = Q.get('shoulder') === 'L' ? 'L' : 'R';
    if (Q.get('dist') !== null) ctl.camera.dist = +Q.get('dist'); if (Q.get('partner') === '0') { const d = ctl._dbg().P; if (ctl.partnerFig) { ctl.partner.teleport(sp[0] - 30, sp[1] - 60, 0); ctl.partner.follow(false); ctl.heroFig && (d.fig.group.visible = false); d.hidden = true; } }
    let t = 0; const hold = (Q.get('hold') || '').split(',').filter(Boolean), orbit = Q.get('orbit') !== null ? +Q.get('orbit') : 0;
    const step = dt => { if (script !== 'free') { const v = sc.run(t) || { down: [] }; v.down = (v.down || []).concat(hold); if (Q.get('aim') === '1') v.down.push('Mouse1'); if (Q.get('crouch') === '1' && !once.cr) { once.cr = 1; v.press = (v.press || []).concat(['KeyC']); } input.feed(v); }
      for (const m of worldUp) safe(() => m.update(dt)); if (street) street.update(dt); if (car.update) safe(() => car.update(dt)); if (scooter.update) safe(() => scooter.update(dt)); ctl.update(dt); t += dt; };
    const n = Math.round(at * 60); for (let i = 0; i < n; i++) step(1 / 60); if (!n) step(0);
    if (orbit) { input.feed({ down: [], dx: -orbit }); ctl.update(0); input.feed({ down: [] }); ctl.update(0); }   // &orbit=<rad>: swing the finished frame's camera round the hero (riding shots from the side / front)
    let dbg = null; if (Q.get('dbg') === '1') { dbg = document.createElement('div'); dbg.className = 'of-dbg'; UI.root.appendChild(dbg); }
    const look = [ctl.pos.x, 0, ctl.pos.z], ret = { cam: camera.position.toArray(), look, hours: 18.2,
      update(dt) { if (live) step(dt); else { ctl.applyCamera(); if (street) street.update(0); } look[0] = ctl.pos.x; look[2] = ctl.pos.z;
        if (dbg) { const d = ctl._dbg(); dbg.textContent = `t ${t.toFixed(2)}  ${script}\npos ${ctl.pos.x.toFixed(2)} ${ctl.pos.y.toFixed(2)} ${ctl.pos.z.toFixed(2)}  h ${ctl.h.toFixed(2)}  v ${ctl.speed.toFixed(2)}  ${ctl.state}${ctl.riding ? ' RIDING' : ''}\ncam yaw ${ctl.camera.yaw.toFixed(2)} pitch ${ctl.camera.pitch.toFixed(2)} dist ${d.CAM.dist.toFixed(2)}/${d.CAM.distWant.toFixed(2)} side ${d.CAM.sideLim.toFixed(2)} fov ${d.CAM.outFov.toFixed(1)} ov ${d.CAM.ov.w.toFixed(2)}\npartner ${ctl.partner.state} ${d.P.anim} d ${hyp(d.P.x - ctl.pos.x, d.P.z - ctl.pos.z).toFixed(2)} slot ${d.P.slot} @${d.P.x.toFixed(1)},${d.P.z.toFixed(1)} cam ${d.CAM.out.x.toFixed(1)},${d.CAM.out.y.toFixed(1)},${d.CAM.out.z.toFixed(1)}  zone ${ctl.zone ? ctl.zone.id : '-'}  fig ${ctl.heroFig.kind}  boxes ${GT.world.boxes.length}  cash ${GT.wallet.cash}${safe.last ? '\nERR ' + (safe.last.stack || safe.last).toString().slice(0, 300) : ''}`; } } };
    return ret;
  };
})();
