/* robbery.js — SUNSET HEAT round 2: the criminal systems on foot. Owner: robbery agent.
   GT.robbery = { init(scene, hooks), update(dt, ctx), store, cars, state, on(evt, cb) }
     hooks (all optional): addHeat(stars, reason), flag(kind: 'face'|'outfit'|'car'|'plate'|'weapon'|'partner'), alarm(on), say(who, text), cops() -> [{x,z}], wallet
                           + extras the game may give: unflag(kind), enterCar(car, record), film(npc), objective(text), camera (THREE.Camera), hud: false (do not draw my HUD)
     ctx  (all optional):  { pos:{x,z}, h, yaw (aim/camera yaw), crouch, speed, inCar, car, ctl (GT.onfoot controller), hero, partner (GT.hero figure), clerk (game ped {x,z,h,state,idle}),
                             cars:[{group,dims,kind,x,z,h,locked,security,owner?}], npcs:[{x,z,h?}], input (defaults to GT.input), camera, tools:{crowbar} }
   1. Store hold-up inside the SOLMAR food mart (anchors from js/station.js): mask / conceal, aim + per-person fear model, shout, panic button, partner orders 1-3,
      register / lottery case / floor safe (dial minigame) / ATM, evidence chips (camera face clothes weapon partner vehicle; unknown / logged / cleared),
      silent vs loud alarm + response clock, push-on-or-cut-losses objective, front vs back exit, clean variants (buy first, clerk alone, shift change).
   2. Tiered car theft on ctx.cars: slim-jim (old), smash (any), key-cloner (modern), immobiliser bypass (luxury), hot-wire / push-button start, car alarms.
   3. GT.robbery.state for the HUD + events 'start' 'alarm' 'loot' 'evidence' 'end' (also 'noise' 'order' 'film' 'phase' 'teleport' 'say').
   Everything is feature-detected; with scene === null the module runs headless (see selftest). Showcase: showcase.html?m=robbery&scene=store|safe|cctv|slimjim|smash|cloner|bypass&at=<s>&auto=1 , &selftest=1 */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!GT) return;
  const PI = Math.PI, HP = PI / 2, TAU = PI * 2, hyp = Math.hypot;
  const clamp = GT.clamp, lerp = GT.lerp, angDiff = GT.angDiff;
  const ST = GT.L.station.store, DZ = ST.doorZ, SF0 = DZ - 13.65, SF1 = DZ + 13.65;
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const mmss = s => { s = Math.max(0, Math.ceil(s)); return (s / 60 | 0) + ':' + (s % 60 < 10 ? '0' : '') + s % 60; };

  const VAL = { reg: 1850, kase: 740, safe: [4200, 5600, 7400], atm: 3200 };
  const RESP = { call: 75, silent: 55, loud: 38 }, RANK = { call: 1, silent: 2, loud: 3 };
  const EV = ['camera', 'face', 'clothes', 'weapon', 'partner', 'vehicle'];
  const EVN = { camera: '监控', face: '面孔', clothes: '衣着', weapon: '武器', partner: '同伙', vehicle: '车辆' };
  const FLAG = { face: 'face', clothes: 'outfit', weapon: 'weapon', partner: 'partner', vehicle: 'car' };
  const KEY = { use: 'KeyE', alt: 'KeyF', mask: 'KeyG', arm: 'KeyH', quit: 'KeyQ' };

  /* ================================================================== events, hooks, input */
  const listeners = {}, LOG = [];
  let HOOKS = {}, SCENE = null, CTX = {}, inited = false, rnd = GT.rng('robbery');
  function on(evt, cb) { (listeners[evt] = listeners[evt] || []).push(cb); return () => { const a = listeners[evt], i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); }; }
  function emit(evt, d) { d = d || {}; d.time = S.t; LOG.push({ evt, d }); if (LOG.length > 400) LOG.splice(0, 150); const a = listeners[evt]; if (a) for (const cb of a.slice()) { try { cb(d); } catch (e) { console.warn('[robbery] listener', e); } } }
  function hook(name) { const h = HOOKS && HOOKS[name]; if (typeof h !== 'function') return undefined; try { return h.apply(HOOKS, Array.prototype.slice.call(arguments, 1)); } catch (e) { console.warn('[robbery] hook ' + name, e); } }
  function say(who, text, sec) { if (!text) return; emit('say', { who, text }); if (HOOKS && typeof HOOKS.say === 'function') return hook('say', who, text, sec); const c = CTX.ctl; if (c && c.say) { try { c.say(who, text, sec); } catch (e) {} } else UI.sub(who, text, sec); }
  function sfx(name, o) { if (S.mute) return; try { if (GT.audio && GT.audio.sfx) GT.audio.sfx(name, o); } catch (e) {} }
  const NOIN = { down: () => false, pressed: () => false, axis: () => ({ x: 0, y: 0 }), look: { dx: 0, dy: 0 }, consume() {} };
  /** a scriptable GT.input look-alike (autoplay, self-test, and the keyboard fallback when onfoot.js is not loaded) */
  function mkInput() { const d = {}, p = {}; return { down: c => !!d[c], pressed: c => !!p[c], axis: () => ({ x: (d.KeyD ? 1 : 0) - (d.KeyA ? 1 : 0), y: (d.KeyW ? 1 : 0) - (d.KeyS ? 1 : 0) }), look: { dx: 0, dy: 0 },
    consume(c) { p[c] = false; }, set(c, v) { if (v && !d[c]) p[c] = true; d[c] = !!v; }, tap(c) { p[c] = true; }, end() { for (const k in p) p[k] = false; this.look.dx = this.look.dy = 0; }, clear() { for (const k in d) d[k] = false; this.end(); } }; }
  let In = NOIN;
  const aimDown = () => In.down('Mouse1') || In.down('Mouse2');
  const hit = c => { if (In.pressed(c)) { In.consume(c); return true; } return false; };
  const pressUse = () => hit(KEY.use) || hit('Space') || hit('Mouse0');

  /* ================================================================== state */
  function freshStore() { return { t: 0, phase: 'idle', started: false, startHow: '', tStart: 0, take: 0, paid: false, noise: 0, risk: 0, clock: null, alarm: null, alarmWhy: '', alarmKnown: false, alarmT: 0, arrived: false, callIn: -1, callWhy: '',
    masked: false, armed: false, aiming: false, target: null, shoutCd: 0, shoutT: -9, working: null, inStore: false, wasIn: false, behind: false, office: null, exit: null, leftT: -1, done: false, result: null, near: false, watching: 0, copSaw: false,
    cased: false, casedT: 0, bought: false, boughtT: -9, faceOnTape: false, waryLeft: 0, heat: 0, mute: false, mg: null, hint: '', hintT: 0, obj: '', lastEv: null, lastEvT: -9, heroState: null, pcar: null,
    loot: { reg: { p: 0, paid: 0, done: false }, kase: { smashed: false, done: false }, safe: { n: 0, done: false }, atm: { done: false, tripped: false } },
    cams: { A: { on: true }, B: { on: true }, rec: true, wiped: false }, tools: { crowbar: false, spray: true },
    shift: { on: true, next: 70, stage: 0, t: 0, n: 0 }, cfg: { customers: 'auto', shift: true } }; }
  let S = freshStore();
  const state = { phase: 'idle', take: 0, noise: 0, evidence: { camera: 'unknown', face: 'unknown', clothes: 'unknown', weapon: 'unknown', partner: 'unknown', vehicle: 'unknown' }, clock: null, risk: 0,
    alarm: null, alarmKnown: false, masked: false, armed: false, aiming: false, objective: '', hint: '', suspicion: 0, heroState: null, minigame: null, cased: false, inStore: false, result: null };
  const PL = { x: 0, z: 0, h: 0, yaw: 0, crouch: false, speed: 0, inCar: false };
  const PT = {};
  function A(name, fb) { const a = GT.world.anchors[name]; return a && isFinite(a.x) && isFinite(a.z) ? a : fb; }
  function resolve() {
    PT.door = A('storeDoor', { x: ST.x0 - 1.1, z: DZ }); PT.inside = A('storeInside', { x: ST.x0 + 1.7, z: DZ }); PT.clerk = A('register', A('clerk', { x: ST.x0 + 6.05, z: DZ + 4, h: -HP })); PT.front = A('registerFront', { x: PT.clerk.x - 2.3, z: PT.clerk.z, h: HP });
    PT.safe = A('safe', { x: PT.clerk.x + .05, z: PT.clerk.z - 1.6, h: HP }); PT.back = A('storeBackDoor', { x: ST.x1 + 1, z: -2, h: -HP });
    const c = PT.clerk; PT.held = { x: c.x + .13, z: c.z + 1.45, h: -HP }; PT.regWork = { x: c.x - .42, z: c.z + .1, h: -HP + .5 }; PT.kase = { x: PT.front.x + .12, z: c.z - 1.65, h: HP }; PT.atm = { x: c.x - .15, z: c.z + 6.5, h: HP };
    PT.staff = { x: c.x + .3, z: c.z + 4.75, h: HP }; PT.flapW = { x: PT.front.x + .15, z: c.z + 3.45 }; PT.flapE = { x: c.x - .35, z: c.z + 3.45 }; PT.cover = { x: PT.front.x - .4, z: c.z - .95 };
    PT.lane = c.x - .38; PT.queue = { x: PT.front.x - .1, z: c.z + .95 };
    PT.cams = { A: { x: 53, z: DZ, y: 2.99 }, B: { x: 60.5, z: -9, y: 2.99 } };
    PT.office = { x0: 57.2, x1: 63.6, z0: -3.7, z1: 2.3, y: .15, top: 2.85, desk: { x: 58.02, z: -2.5, h: PI - .12 }, exit: { x: 62.85, z: -2, h: HP }, enter: { x: 57.95, z: .75, h: HP } };
    PT.floorY = PT.door.y !== undefined ? PT.door.y : .15;
    PT.spots = { coffee: { x: 53.3, z: 4.45, h: 0 }, aisle: { x: 56.2, z: -12.3, h: PI }, fridge: { x: 60.7, z: -9.6, h: HP }, north: { x: 55.3, z: 1.9, h: -2.4 } };
  }

  /* ================================================================== evidence: every chip is a set of sources (tape, clerk, a witness...). No sources left = cleared. */
  let SRC = {}, HAD = {}; EV.forEach(k => { SRC[k] = {}; HAD[k] = false; });
  function refreshEv(kind, why) { const n = Object.keys(SRC[kind]).length, st = n ? 'logged' : (HAD[kind] ? 'cleared' : 'unknown'); if (state.evidence[kind] === st) return; state.evidence[kind] = st; S.lastEv = { kind, state: st, why: why || '' }; S.lastEvT = S.t;
    emit('evidence', { kind, state: st, sources: Object.keys(SRC[kind]), why: why || '' }); if (FLAG[kind]) { if (st === 'logged') hook('flag', FLAG[kind], why || ''); else if (st === 'cleared') hook('unflag', FLAG[kind], why || ''); } }
  function logEv(kind, from) { if (SRC[kind][from]) return false; SRC[kind][from] = true; HAD[kind] = true; refreshEv(kind, from); return true; }
  function unlogEv(kind, from) { if (!SRC[kind][from]) return; delete SRC[kind][from]; refreshEv(kind, from); }
  function unlogAll(from) { for (const k of EV) unlogEv(k, from); }
  /** drop every source of one chip (changed clothes, swapped car, ...) */
  function clearEv(kind, why) { if (!SRC[kind]) return; SRC[kind] = {}; HAD[kind] = true; refreshEv(kind, why || 'cleared'); }
  function resetEv() { EV.forEach(k => { SRC[k] = {}; HAD[k] = false; state.evidence[k] = 'unknown'; }); }
  const logged = () => EV.reduce((n, k) => n + (state.evidence[k] === 'logged' ? 1 : 0), 0);
  function noise(a, why) { S.noise = Math.min(1, S.noise + a); if (a >= .3) emit('noise', { amount: a, why: why || '', level: S.noise }); }
  function hint(text, sec) { S.hint = text; S.hintT = sec || 4; }

  /* ================================================================== line of sight (2D slab test; the glass storefront is see-through) */
  function los(ax, az, bx, bz, glass) {
    const dx = bx - ax, dz = bz - az, B = GT.world.boxes;
    for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.h < 1.5) continue;
      if ((ax > b.x0 && ax < b.x1 && az > b.z0 && az < b.z1) || (bx > b.x0 && bx < b.x1 && bz > b.z0 && bz < b.z1)) continue;
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) { if (ax < b.x0 || ax > b.x1) continue; } else { let u = (b.x0 - ax) / dx, v = (b.x1 - ax) / dx; if (u > v) { const w = u; u = v; v = w; } if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) continue; }
      if (Math.abs(dz) < 1e-9) { if (az < b.z0 || az > b.z1) continue; } else { let u = (b.z0 - az) / dz, v = (b.z1 - az) / dz; if (u > v) { const w = u; u = v; v = w; } if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) continue; }
      if (glass && b.x1 <= ST.x0 + .4 && b.x0 >= ST.x0 - .1 && Math.abs(dx) > 1e-6) { const zc = az + dz * ((ST.x0 + .15 - ax) / dx); if (zc > SF0 + .3 && zc < SF1 - .3) continue; }
      return false; }
    return true;
  }
  const inStoreAt = (x, z) => x > ST.x0 + .15 && x < 62.2 && z > SF0 - .3 && z < 5.9 && !(x > 57 && z > -7.2);

  /* ================================================================== people in the store: nerve / fear / compliance / panic */
  const C = { people: [], clerk: null, seq: 0 };
  const P2 = { on: false, forced: false, own: false, x: 0, z: 0, h: 0, job: 'follow', arrived: false, target: null, path: null, anim: 'idle', speed: 0, inside: false, work: 0, ctlBusy: false };
  function mkPerson(role, o) { o = o || {}; const id = role + (C.seq++), r = GT.rng('rb:' + id + ':' + (o.seed || 0));
    const p = { id, role, name: role === 'clerk' ? '店员' : '顾客', x: o.x || 0, z: o.z || 0, h: o.h || 0, nerve: o.nerve !== undefined ? o.nerve : (role === 'clerk' ? .42 + r() * .3 : .25 + r() * .55), fear: 0, comply: 0, panic: 0, reach: 0, phone: 0, alert: 0, cover: 0,
      mode: role === 'clerk' ? 'work' : 'browse', anim: o.anim || 'idle', anim0: o.anim || 'idle', speed: 0, present: o.present !== false, fled: false, pressed: false, called: false, sawFace: false, seenT: 0, aimOff: 9, wp: null, spd: 1.3, then: null, uncoverT: 0, ext: o.ext || null, fig: null, seed: o.seed || 0,
      plan: o.plan || null, planI: 0, planT: o.planT || 0, vis: false, d: 99, warned: false, warnT: 0, bagging: false, atCounter: role === 'clerk', ptype: o.ptype };
    C.people.push(p); if (role === 'clerk') C.clerk = p; return p; }
  function go(p, pts, spd, then) { p.wp = pts.map(q => [q.x !== undefined ? q.x : q[0], q.z !== undefined ? q.z : q[1]]); p.spd = spd || 1.3; p.then = then || null; }
  function walk(p, dt) { if (!p.wp) { p.speed = 0; return; } const w = p.wp[0], dx = w[0] - p.x, dz = w[1] - p.z, d = hyp(dx, dz), st = p.spd * dt;
    if (d <= st + .02) { p.x = w[0]; p.z = w[1]; p.wp.shift(); if (!p.wp.length) { p.wp = null; p.speed = 0; const f = p.then; p.then = null; if (f) f(p); } return; }
    p.x += dx / d * st; p.z += dz / d * st; p.speed = p.spd; p.h += angDiff(p.h, Math.atan2(dx, dz)) * Math.min(1, dt * 9); }
  const face = (p, x, z, dt) => { p.h += angDiff(p.h, Math.atan2(x - p.x, z - p.z)) * Math.min(1, (dt || 1) * 7); };
  const clerkHere = () => { const c = C.clerk; return !!(c && c.present && !c.fled && c.mode !== 'away'); };
  const insidePeople = () => C.people.filter(p => p.present && !p.fled);
  /** tension the safe-cracker feels: scared, uncovered people nearby + alarms + noise */
  function tension() { let f = 0, n = 0; for (const p of C.people) if (p.present && !p.fled) { f += p.fear * (1 - p.cover * .6) + p.panic * .4; n++; } return clamp((n ? f / n : 0) * .75 + (S.alarm && S.alarmKnown ? .3 : 0) + S.noise * .25, 0, 1); }

  function witness(p, key) { key = key || p.id; if (p.sawFace) logEv('face', key); if (p.seenT > 2.5) logEv('clothes', key); if (S.armed) logEv('weapon', key); if (P2.on && P2.inside) logEv('partner', key); }
  function startRobbery(how) { if (S.started || S.done) return; S.started = true; S.startHow = how; S.tStart = S.t; S.phase = 'holdup';
    for (const p of C.people) if (p.present) { p.fear = Math.max(p.fear, .25 + (1 - p.nerve) * .2); if (S.cased && p.role === 'clerk') p.reach = -.45; }
    if (S.cams.rec && S.faceOnTape) logEv('face', 'tape'); if (S.waryLeft) schedCall(10, 'left-wary');
    emit('start', { how, masked: S.masked, armed: S.armed, partner: P2.on, cased: S.cased, customers: C.people.filter(p => p.role !== 'clerk' && p.present).length }); emit('phase', { phase: 'holdup' }); }
  function schedCall(sec, why) { if (S.alarm) return; if (S.callIn < 0 || sec < S.callIn) { S.callIn = sec; S.callWhy = why; } }
  function alarm(kind, why) { if (S.alarm && RANK[kind] <= RANK[S.alarm]) return; S.alarm = kind; S.alarmWhy = why || ''; S.alarmT = S.t; S.clock = S.clock === null ? RESP[kind] : Math.min(S.clock, RESP[kind]); S.callIn = -1;
    const c = C.clerk; S.alarmKnown = kind === 'loud' || (why === 'clerk' && !!c && c.vis && Math.abs(angDiff(PL.yaw, Math.atan2(c.x - PL.x, c.z - PL.z))) < 1.1);
    if (kind === 'loud') { if (GT.station && GT.station.state) GT.station.state.alarm = true; hook('alarm', true); sfx('alarm_bell', { on: true, distance: 6 }); S.noise = 1; for (const p of C.people) p.fear = Math.min(1, p.fear + .12); if (P2.on) say('阿烈', '警报响了！拿上手里的就走！', 2.5); }
    else if (S.alarmKnown) { hint('你看见他的手按下去了——静默警报', 5); sfx('ui_bad'); }
    emit('alarm', { kind, why: S.alarmWhy, clock: S.clock, known: S.alarmKnown }); }
  const SHOUTS = ['手举起来！别动！', '看着我！手放在我看得见的地方！', '谁都别动！', '离柜台远点！'];
  function shout() { if (S.shoutCd > 0) return; S.shoutCd = 1.3; S.shoutT = S.t; S.noise = Math.min(1, S.noise + .34); if (!S.started) startRobbery('shout'); let n = 0;
    for (const p of C.people) { if (!p.present || p.fled || p.d > 10) continue; n++; p.fear = Math.min(1, p.fear + .3 * (1.25 - p.nerve)); if (p.fear > .85) p.panic = Math.min(1, p.panic + .22 + (1 - p.nerve) * .12); if (p.role === 'clerk') p.reach = Math.max(-.2, p.reach - .3); p.phone = Math.max(0, p.phone - .5); }
    say('阿凯', SHOUTS[(rnd() * SHOUTS.length) | 0], 1.6); sfx('thunk', { g: .6 }); emit('noise', { amount: .34, why: 'shout', level: S.noise, heard: n }); }

  function stepPerson(p, dt) {
    if (p.ext) { p.x = p.ext.x; p.z = p.ext.z; if (p.ext.h !== undefined && !S.started) p.h = p.ext.h; }
    if (!p.present) return;
    const d = p.d = hyp(PL.x - p.x, PL.z - p.z), vis = p.vis = (S.inStore || S.near) && !S.office && d < 15 && los(p.x, p.z, PL.x, PL.z, true);
    if (vis && !S.masked && d < 9) p.sawFace = true;
    if (vis && d < 11 && (S.masked || S.armed)) p.alert = Math.min(1, p.alert + dt * (S.armed ? 3 : .45)); else if (!S.started) p.alert = Math.max(0, p.alert - dt * .05);
    if (S.started && vis) { p.seenT += dt; witness(p); }
    // who is covering this person right now
    let cov = 0; if (S.aiming && vis) { if (S.target === p) cov = 1; else if (p.aimOff < .26) cov = .6; }
    if (P2.on && P2.job === 'cover' && P2.arrived && P2.target && P2.target.present) { const dT = P2.target === p ? 0 : hyp(p.x - P2.target.x, p.z - P2.target.z); if (dT < .1) cov = 1; else if (dT < 3 && los(P2.x, P2.z, p.x, p.z, true)) cov = Math.max(cov, .6); }
    p.cover += (cov - p.cover) * Math.min(1, dt * 6); if (p.cover < .3) p.uncoverT += dt; else p.uncoverT = 0;
    if (!S.started) { p.fear = Math.max(0, p.fear - dt * .05); if (p.role === 'clerk') stepClerkCalm(p, dt); else stepCustomerCalm(p, dt); walk(p, dt); return; }
    // --- fear model
    const aware = vis || p.alert > .5 || S.noise > .25 || S.alarm === 'loud';
    p.fear = clamp(p.fear + dt * (p.cover * (.5 + .5 * (1 - p.nerve)) - (1 - p.cover) * .1 * p.nerve + (aware ? .02 : 0)), 0, 1);
    const tgt = clamp((p.fear - p.nerve * .5) / .32, 0, 1) * (p.panic >= 1 ? .3 : 1); p.comply += (tgt - p.comply) * Math.min(1, dt * 1.6);
    if (p.fear > .88) p.panic = Math.min(1, p.panic + dt * (.012 + .06 * (1 - p.nerve)) * (S.t - S.shoutT < 2 ? 2 : 1)); else p.panic = Math.max(0, p.panic - dt * .06);
    if (p.role === 'clerk') stepClerkHeld(p, dt); else stepCustomerHeld(p, dt, aware);
    walk(p, dt);
  }
  function stepClerkCalm(p, dt) {
    const sh = S.shift;
    if (p.mode === 'work') { p.anim = S.bought && S.t - S.boughtT < 2.5 ? 'talk' : 'idle'; if (!p.wp) { const lk = p.d < 6 && p.vis; face(p, lk ? PL.x : PT.front.x, lk ? PL.z : PT.front.z, dt * .5); }
      if (p.alert >= 1 && !S.armed && S.masked) p.reach = Math.min(.45, p.reach + dt * .05);                        // a masked man walks in: he is already thinking about the button
      if ((!S.cams.A.on || !S.cams.B.on) && p.vis) p.alert = Math.min(1, p.alert + dt * .06);
      if (S.behind && p.vis) { p.alert = Math.min(1, p.alert + dt * .7); if (!p.warned) { p.warned = true; say('店员', '喂——柜台后面不能进！', 2); } if (p.alert >= 1) startRobbery('trespass'); } }
    if (p.alert >= 1 && S.armed) startRobbery('seen-armed');
    if (p.wp) p.anim = 'walk';
    if (!sh.on || !S.cfg.shift || S.started) return;
    if (sh.stage === 0 && S.t > sh.next && p.mode === 'work' && !S.office && !S.behind) { sh.stage = 1; p.mode = 'leaving'; p.atCounter = false;
      go(p, [[PT.lane + .2, PT.flapE.z], [PT.flapE.x + .2, PT.staff.z], PT.staff], 1.25, q => { q.present = false; q.mode = 'away'; sh.stage = 2; sh.t = 0; emit('phase', { phase: 'shift-gap' }); if (S.inStore) hint('换班——柜台后面现在没人', 5); });
      if (S.inStore) { say('店员', '到点了，我去后面换人。', 2.2); if (S.cased) hint('他在看表——换班的时候柜台会空十来秒', 5); } }
  }
  function shiftStep(dt) { const sh = S.shift, p = C.clerk; if (!p || !sh.on || !S.cfg.shift) return;
    if (sh.stage === 2) { sh.t += dt; if (sh.t > 11 && !S.office) { sh.stage = 3; sh.n++; p.present = true; p.mode = 'returning'; p.x = PT.staff.x; p.z = PT.staff.z; p.h = -HP; const r = GT.rng('rb:shift' + sh.n);
        Object.assign(p, { nerve: .4 + r() * .35, fear: 0, comply: 0, panic: 0, reach: 0, alert: 0, sawFace: false, seenT: 0, pressed: false, warned: false, seed: p.seed + 1, id: 'clerk-s' + sh.n }); VIS.swapClerk(p);
        go(p, [[PT.flapE.x + .2, PT.staff.z], [PT.lane + .2, PT.flapE.z], PT.clerk], 1.25, q => { q.mode = 'work'; q.atCounter = true; q.h = PT.clerk.h !== undefined ? PT.clerk.h : -HP; sh.stage = 0; sh.next = S.t + 150; }); emit('phase', { phase: 'shift-done' }); } } }
  function stepClerkHeld(p, dt) {
    if (p.mode === 'leaving' || p.mode === 'returning' || p.mode === 'work') { p.wp = null; p.then = null; p.atCounter = hyp(p.x - PT.clerk.x, p.z - PT.clerk.z) < 3.2 && p.x > PT.lane - .4; p.mode = 'held'; }
    if (p.mode === 'down') { p.anim = 'crouch'; return; } if (p.mode === 'gone') { p.anim = 'run'; return; }
    if (p.panic >= 1) { p.mode = 'down'; p.wp = null; noise(.3, 'scream'); say('店员', '别开枪！别开枪！', 2); return; }
    const byP2 = p.cover > .3 && P2.on && P2.job === 'cover' && P2.arrived && !(S.aiming && S.target === p); face(p, byP2 ? P2.x : PL.x, byP2 ? P2.z : PL.z, dt);
    // step back from the register when somebody is coming behind the counter
    const crowd = S.behind || (P2.on && (P2.job === 'register' || P2.job === 'safe'));
    if (p.atCounter && crowd && !p.wp && hyp(p.x - PT.held.x, p.z - PT.held.z) > .3) go(p, [PT.held], 1.1);
    // the register: he bags it himself while somebody keeps him covered
    const reg = S.loot.reg; p.bagging = false;
    if (p.atCounter && !reg.done && p.cover > .5 && p.comply > .55 && !crowd && hyp(p.x - PT.clerk.x, p.z - PT.clerk.z) < .6) { p.bagging = true; regProgress(dt / 5.5, 'clerk'); }
    // the panic button: only at the counter, only while nobody covers him
    if (p.atCounter && !p.pressed) {
      if (p.cover < .3) p.reach += dt * (.07 + .11 * p.nerve) * (1 - .5 * p.fear) * (p.uncoverT > 1 ? 1 : .3); else p.reach = Math.max(-.2, p.reach - dt * .28);
      if (p.reach > .55 && !p.warnT) { p.warnT = S.t; if (p.vis) hint('店员的手在往柜台下面摸', 3); emit('phase', { phase: 'reach' }); } if (p.reach < .3) p.warnT = 0;
      if (p.reach >= 1) { p.pressed = true; p.reach = 0; alarm('silent', 'clerk'); } }
    else if (!p.atCounter && !p.pressed && p.cover < .3 && p.uncoverT > 4) { p.pressed = true; p.mode = 'gone'; go(p, [PT.staff], 3.4, q => { q.present = false; q.fled = true; schedCall(5, 'clerk-office'); }); }   // caught away from the counter: he bolts for the office phone
    p.anim = p.wp ? (p.spd > 2 ? 'run' : 'walk') : p.bagging ? 'talk' : (p.reach > .5 && !p.pressed ? 'idle' : (p.comply > .3 || p.cover > .5 ? 'handsup' : 'idle'));
  }
  function stepCustomerCalm(p, dt) {
    if (p.alert >= 1 && S.armed) { startRobbery('seen-armed'); return; }
    if (p.alert >= 1 && S.masked && p.mode === 'browse') { p.mode = 'leaving'; p.plan = null; go(p, [PT.inside, PT.door, [PT.door.x - 1.5, PT.door.z + 9]], 1.7, q => { q.present = false; q.fled = true; S.waryLeft++; }); }      // sees a mask: quietly walks out
    if (p.plan && !p.wp && p.mode === 'browse') { p.planT -= dt; if (p.planT <= 0) { const st = p.plan[p.planI % p.plan.length]; p.planI++; p.planT = st.wait || 0; p.anim0 = st.anim || 'idle'; if (st.hide !== undefined) p.present = !st.hide; if (st.at) { p.x = st.at[0]; p.z = st.at[1]; } if (st.to) go(p, st.to, st.spd || 1.25, q => { if (st.h !== undefined) q.h = st.h; }); } }
    p.anim = p.wp ? 'walk' : (p.anim0 || 'idle');
  }
  function stepCustomerHeld(p, dt, aware) {
    if (p.mode === 'browse' || p.mode === 'leaving') { if (!aware) { p.anim = p.wp ? 'walk' : (p.anim0 || 'idle'); return; } p.mode = p.vis ? 'held' : 'hide'; p.wp = null; p.then = null; }
    if (p.mode === 'bolt' || p.mode === 'sneak') { p.anim = p.mode === 'bolt' ? 'run' : 'walk'; if (p.mode === 'sneak' && p.cover > .5) { p.mode = 'held'; p.wp = null; p.then = null; } return; }
    if (p.mode === 'down') { p.anim = 'crouch'; return; }
    const out = q => { q.fled = true; q.present = false; schedCall(q.mode === 'bolt' ? 4 : 7, 'runner'); emit('phase', { phase: 'runner' }); if (q.sawFace) logEv('face', q.id); logEv('clothes', q.id); };
    if (p.panic >= 1) { if (p.cover > .5 && p.d < 3.5) { p.mode = 'down'; return; } p.mode = 'bolt'; noise(.45, 'scream'); say('顾客', '救命啊——！', 1.8); go(p, [PT.inside, PT.door, [PT.door.x - 3, PT.door.z + 8]], 4.6, out); return; }
    if (p.mode === 'hide') { p.anim = p.phone > .05 ? 'phone' : 'crouch'; if (p.vis && p.cover > .3) { p.mode = 'held'; p.phone = 0; return; }
      if (!p.called) { p.phone += dt / (5 + 6 * (1 - p.nerve)); if (p.phone >= 1) { p.phone = 0; p.called = true; alarm('call', 'customer-phone'); } } return; }
    // held in the open
    face(p, PL.x, PL.z, dt); p.anim = p.comply > .25 || p.cover > .5 ? 'handsup' : 'idle';
    if (p.cover < .3 && p.uncoverT > 2.5) { if (p.nerve > .5 && p.aimOff > .8) { p.mode = 'sneak'; go(p, [PT.inside, PT.door, [PT.door.x - 2, PT.door.z + 7]], 1.0, out); }
      else if (p.d > 5 && !p.called) { p.anim = 'phone'; p.phone += dt / (6 + 6 * (1 - p.nerve)); if (p.phone >= 1) { p.phone = 0; p.called = true; alarm('call', 'customer-phone'); } } }
    else p.phone = Math.max(0, p.phone - dt * .5);
  }

  /* ================================================================== partner orders (1 看住店员 / 2 清收银机 / 3 去开保险柜) */
  const ORD = { cover: ['看住店员', '我盯着他。你干活。'], register: ['清收银机', '收银机归我。'], safe: ['去开保险柜', '保险柜交给我，你看住他们。'], follow: ['跟上', '跟着你。'] };
  function order(n) { if (!P2.on) return false; const job = typeof n === 'string' ? n : [null, 'cover', 'register', 'safe'][n]; if (!job || !ORD[job]) return false; if (P2.job === job && job !== 'cover') return false;
    if (job === 'register' && S.loot.reg.done) { say('阿烈', '收银机已经空了。', 1.6); return false; } if (job === 'safe' && S.loot.safe.done) { say('阿烈', '保险柜空了。', 1.6); return false; }
    const behind = P2.x > PT.lane - .5 && P2.z < PT.flapE.z + .4 && P2.z > PT.clerk.z - 3.2, via = [PT.flapW, PT.flapE];
    P2.job = job; P2.arrived = false; P2.work = 0; P2.target = job === 'cover' ? (C.clerk && C.clerk.present ? C.clerk : insidePeople()[0] || null) : null;
    if (job === 'cover') P2.path = behind ? [] : [PT.cover]; else if (job === 'register') P2.path = (behind ? [] : via).concat([{ x: PT.lane, z: PT.clerk.z + .15 }]); else if (job === 'safe') P2.path = (behind ? [] : via).concat([{ x: PT.lane, z: PT.safe.z + .05 }]); else P2.path = null;
    if (job !== 'follow' && !S.started && S.inStore) startRobbery('partner'); partnerGo(); say('阿烈', ORD[job][1], 1.8); sfx('ui_tick'); emit('order', { job, n }); return true; }
  function partnerGo() { const ctl = CTX.ctl, cp = ctl && ctl.partner; P2.ctlBusy = false;
    if (cp && cp.goTo) { try { if (cp.follow) cp.follow(P2.job === 'follow'); if (P2.job === 'follow') return; const pts = (P2.path || []).slice(); P2.ctlBusy = true; const next = () => { const q = pts.shift(); if (!q) { P2.ctlBusy = false; return; } cp.goTo(q.x, q.z, next); }; next(); } catch (e) { P2.ctlBusy = false; } } }
  function partnerStep(dt) {
    const ext = CTX.partner; P2.on = !!(ext || P2.forced); if (!P2.on) return;
    const ctlDriven = !!(ext && CTX.ctl && CTX.ctl.partner && CTX.ctl.partner.goTo);
    if (ext && ext.group && !P2.own) { P2.x = ext.group.position.x; P2.z = ext.group.position.z; P2.h = ext.group.rotation.y; } else if (ext && ext.x !== undefined && !ext.group && !P2.own) { P2.x = ext.x; P2.z = ext.z; }
    P2.inside = inStoreAt(P2.x, P2.z) || (!!S.office && P2.job === 'follow'); P2.speed = 0;
    if (P2.job === 'follow') { if (!ctlDriven) { const d = hyp(PL.x - P2.x, PL.z - P2.z); if (d > 1.7) { const sp = Math.min(4.2, 1 + (d - 1.7) * 2.2), dx = (PL.x - P2.x) / d, dz = (PL.z - P2.z) / d; P2.x += dx * sp * dt; P2.z += dz * sp * dt; P2.h += angDiff(P2.h, Math.atan2(dx, dz)) * Math.min(1, dt * 8); P2.speed = sp; } } P2.anim = P2.speed > 2.6 ? 'run' : P2.speed > .1 ? 'walk' : 'idle'; return; }
    if (!P2.arrived) {
      if (ctlDriven) { const last = P2.path && P2.path.length ? P2.path[P2.path.length - 1] : null; if (!P2.ctlBusy || !last || hyp(P2.x - last.x, P2.z - last.z) < .45) P2.arrived = true; }
      else if (P2.path && P2.path.length) { const w = P2.path[0], dx = w.x - P2.x, dz = w.z - P2.z, d = hyp(dx, dz), sp = 3.1, stp = sp * dt; if (d <= stp + .03) { P2.x = w.x; P2.z = w.z; P2.path.shift(); } else { P2.x += dx / d * stp; P2.z += dz / d * stp; P2.h += angDiff(P2.h, Math.atan2(dx, dz)) * Math.min(1, dt * 9); P2.speed = sp; } }
      else P2.arrived = true;
      P2.anim = P2.speed > 2.6 ? 'run' : P2.speed > .1 ? 'walk' : 'idle'; if (!P2.arrived) return; }
    const back = () => { P2.job = 'cover'; P2.target = C.clerk && C.clerk.present ? C.clerk : null; };
    if (P2.job === 'cover') { const t = P2.target && P2.target.present ? P2.target : (P2.target = insidePeople()[0] || null); if (t) P2.h += angDiff(P2.h, Math.atan2(t.x - P2.x, t.z - P2.z)) * Math.min(1, dt * 8); P2.anim = 'aim'; }
    else if (P2.job === 'register') { P2.h += angDiff(P2.h, HP + .5) * Math.min(1, dt * 8); P2.anim = 'use'; if (regProgress(dt / 4.5, 'partner')) { say('阿烈', '收银机清了。', 1.6); back(); } }
    else if (P2.job === 'safe') { P2.h += angDiff(P2.h, HP) * Math.min(1, dt * 8); P2.anim = 'crouch'; const sf = S.loot.safe; if (S.mg && S.mg.kind === 'safe') { back(); say('阿烈', '行，你来开，我盯人。', 1.6); return; } if (sf.done) { back(); return; }
      P2.work += dt / (8 * (1 + tension() * .6)); if (P2.work >= 1) { P2.work = 0; safeTumbler('partner'); if (sf.done) { say('阿烈', '全空了！', 1.5); back(); } else say('阿烈', ['第一层开了。', '第二层……再给我几秒。'][sf.n - 1] || '', 1.6); } }
  }

  /* ================================================================== loot */
  function gain(n, what, by) { if (n <= 0) return; S.take += n; emit('loot', { what, amount: n, take: S.take, by: by || 'player' }); sfx('cash'); }
  function regProgress(dp, by) { const r = S.loot.reg; if (r.done) return true; if (!S.started) startRobbery('register'); r.p = Math.min(1, r.p + dp); const due = Math.round(VAL.reg * r.p / 10) * 10; if (due - r.paid >= 300 || r.p >= 1) { gain(due - r.paid, 'register', by); r.paid = due; } if (r.p >= 1) { r.done = true; return true; } return false; }
  function safeTumbler(by) { const sf = S.loot.safe; if (sf.done) return; if (!S.started) startRobbery('safe'); gain(VAL.safe[sf.n], 'safe' + (sf.n + 1), by); sf.n++; if (sf.n >= 3) { sf.done = true; VIS.safeOpen(); } }
  function smashCase() { const k = S.loot.kase; if (k.smashed) return; k.smashed = true; if (!S.started) startRobbery('smash'); noise(.55, 'glass'); sfx('glass', { distance: 2 }); VIS.shards(); for (const p of C.people) if (p.present) p.fear = Math.min(1, p.fear + .12); }
  function remaining() { const L = S.loot, out = []; if (!L.reg.done) out.push(['收银机', VAL.reg - L.reg.paid]); if (!L.kase.done) out.push(['彩票柜', VAL.kase]); if (!L.safe.done) out.push(['保险柜', VAL.safe.slice(L.safe.n).reduce((a, b) => a + b, 0)]); if (!L.atm.done && S.tools.crowbar) out.push(['ATM', VAL.atm]); return out; }

  /* ================================================================== interaction spots (GT.act shape). Own prompt + key handling when GT.act is absent. */
  const SPOTS = []; let actMode = false;
  function actAdd(s) { if (GT.act && GT.act.add) { try { GT.act.add(s); } catch (e) {} } else (GT._actQueue = GT._actQueue || []).push(s); }
  function spot(o) { o.r = o.r || 1.15; o.key = o.key || KEY.use; o.mode = 'foot'; o.p = 0; const en = o.enabled; o.enabled = c => !S.done && !S.mg && !S.office && !PL.inCar && !!en(c); SPOTS.push(o); return o; }
  function buildSpots() {
    SPOTS.length = 0; const L = new Proxy({}, { get: (_, k) => S.loot[k] }), gap = () => !clerkHere();
    spot({ id: 'rb-buy', x: PT.front.x, z: PT.front.z, r: 1.0, label: '买包烟 · $8', enabled: () => S.inStore && !S.started && !S.masked && !S.armed && !S.bought && clerkHere() && C.clerk.mode === 'work',
      onUse() { const w = HOOKS.wallet || GT.wallet; if (w && w.spend && !w.spend(8)) { say('店员', '八块。……没带钱？', 2); return; } S.bought = S.cased = true; S.boughtT = S.t; sfx('cash', { g: .5 }); const c = C.clerk;
        say('店员', c.nerve > .58 ? '八块。——找你的。（他一直盯着你的手）' : '八、八块……谢谢惠顾。', 2.6); hint('踩点：' + casing(), 7); emit('phase', { phase: 'cased' }); } });
    spot({ id: 'rb-reg', x: PT.regWork.x, z: PT.regWork.z, r: .95, hold: 3.5, label: '清收银机', enabled: () => (S.started || gap()) && !L.reg.done && S.behind, tick(dp) { regProgress(dp * .999, 'player'); }, onUse() { regProgress(1, 'player'); } });
    spot({ id: 'rb-case', x: PT.kase.x, z: PT.kase.z, r: 1.0, label: '砸开彩票柜', enabled: () => S.inStore && !L.kase.smashed && (S.started || S.armed || gap()), onUse: smashCase });
    spot({ id: 'rb-case2', x: PT.kase.x, z: PT.kase.z, r: 1.0, hold: 2.4, label: '扫走彩票和烟', enabled: () => L.kase.smashed && !L.kase.done, onUse() { L.kase.done = true; gain(VAL.kase, 'case'); } });
    spot({ id: 'rb-safe', x: PT.safe.x, z: PT.safe.z, r: .85, label: () => '开保险柜' + (L.safe.n ? ' · ' + L.safe.n + '/3' : ''), enabled: () => (S.started || gap()) && !L.safe.done && S.behind, onUse() { openMG(safeMG()); } });
    spot({ id: 'rb-atm', x: PT.atm.x, z: PT.atm.z, r: 1.0, hold: 9, label: () => S.tools.crowbar ? '撬开 ATM' : 'ATM · 需要撬棍', dim: () => !S.tools.crowbar, enabled: () => S.inStore && !L.atm.done,
      tick(dp, p) { if (!S.tools.crowbar) return false; if (!S.started) startRobbery('atm'); S.noise = Math.min(1, S.noise + dp * 2.4); if (p > .55 && !L.atm.tripped) { L.atm.tripped = true; alarm('loud', 'atm-tamper'); } },
      onUse() { if (!S.tools.crowbar) { hint('没有撬棍，ATM 动不了', 3); sfx('ui_bad'); return; } if (!S.started) startRobbery('atm'); if (!L.atm.tripped) { L.atm.tripped = true; alarm('loud', 'atm-tamper'); } L.atm.done = true; gain(VAL.atm, 'atm'); } });
    for (const id of ['A', 'B']) spot({ id: 'rb-cam' + id, x: PT.cams[id].x, z: PT.cams[id].z, r: 1.25, hold: 1.2, key: KEY.alt, label: '喷掉摄像头', enabled: () => S.inStore && S.cams[id].on && S.tools.spray,
      onUse() { S.cams[id].on = false; VIS.spray(id); sfx('ui_tick'); noise(.08, 'spray'); const c = C.clerk; if (c && c.present && c.vis) c.alert = Math.min(1, c.alert + .35); emit('phase', { phase: 'camera-off', id }); if (!S.cams.A.on && !S.cams.B.on) { HAD.camera = true; unlogAll('tape'); refreshEv('camera', 'sprayed'); } } });
    spot({ id: 'rb-staff', x: PT.staff.x, z: PT.staff.z, r: .95, label: '进后屋', enabled: () => S.inStore && !(C.clerk && (C.clerk.mode === 'leaving' || C.clerk.mode === 'returning')), onUse() { enterOffice('store'); } });
    spot({ id: 'rb-backin', x: PT.back.x, z: PT.back.z, r: 1.1, hold: 2.5, label: () => S.tools.crowbar ? '撬后门' : '后门 · 从里面锁着', dim: () => !S.tools.crowbar, enabled: () => !S.inStore,
      tick(dp) { if (!S.tools.crowbar) return false; S.noise = Math.min(1, S.noise + dp * .5); }, onUse() { if (!S.tools.crowbar) { hint('后门从里面锁着', 2.5); return; } enterOffice('back'); } });
    for (const s of SPOTS) actAdd(s);
  }
  function casing() { const c = C.clerk, n = C.people.filter(p => p.role !== 'clerk' && p.present).length; return (c && c.present ? (c.nerve > .58 ? '店员是老手，手离按钮很近' : '店员是新来的，手在抖') : '柜台没人') + ' · ' + (n ? '店里还有 ' + n + ' 位客人' : '店里没别人') + ' · 两个摄像头，录像机在后屋' + (S.cfg.shift && S.shift.on ? ' · 快换班了' : ''); }
  const PROMPTS = [];
  function prompt(key, label, p, dim) { PROMPTS.push({ key: key.replace('Key', '').replace('Mouse1', '右键').replace('Digit', ''), label, p: p || 0, dim: !!dim }); }
  function spotsStep(dt) {
    S.working = null; actMode = !!(GT.act && GT.act.add && CTX.ctl && HOOKS.prompts !== 'own');
    if (actMode) { const us = SPOTS.find(s => s.hold && In.down(s.key) && s.enabled(CTX) && hyp(PL.x - s.x, PL.z - s.z) < s.r); if (us) { S.working = us; if (us.tick) us.tick(dt / us.hold, 0); } return; }
    const near = SPOTS.filter(s => s.enabled(CTX) && hyp(PL.x - s.x, PL.z - s.z) < s.r).sort((a, b) => hyp(PL.x - a.x, PL.z - a.z) - hyp(PL.x - b.x, PL.z - b.z)), seen = {};
    for (const s of SPOTS) if (near.indexOf(s) < 0 || !In.down(s.key)) s.p = Math.max(0, s.p - dt * 1.5);
    for (const s of near) { if (seen[s.key]) continue; seen[s.key] = true; const lab = typeof s.label === 'function' ? s.label(CTX) : s.label, dim = s.dim ? s.dim() : false;
      if (s.hold) { if (In.down(s.key) && !S.aiming) { const dp = dt / s.hold; if (s.tick && s.tick(dp, s.p) === false) { if (hit(s.key)) s.onUse(CTX); } else { s.p += dp; S.working = s; if (s.p >= 1) { s.p = 0; s.onUse(CTX); sfx('ui_ok'); In.consume(s.key); } } } }
      else if (!S.aiming && hit(s.key)) { s.onUse(CTX); if (S.mg || S.office) return; }
      prompt(s.key, (s.hold ? '按住 ' : '') + lab, s.p, dim); }
  }

  /* ================================================================== the back office: CCTV recorder + back door (a takeover) */
  function tp(x, z, h) { PL.x = x; PL.z = z; PL.h = h; PL.yaw = h; const c = CTX.ctl; if (c && c.teleport) { try { c.teleport(x, z, h); } catch (e) {} } emit('teleport', { x, z, h }); }
  const OFF = { x: 0, z: 0, h: 0, wp: null, spd: 2.2, speed: 0, then: null };
  function enterOffice(from) { const O = PT.office, bk = from === 'back'; S.office = { from, t: 0, wipe: 0, leaving: null }; UI.fade(.3); sfx('door_open', { g: .6 }); tp(bk ? O.exit.x - .9 : O.enter.x, bk ? O.exit.z : O.enter.z, bk ? -HP : HP);
    OFF.x = PL.x; OFF.z = PL.z; OFF.h = PL.h; go(OFF, [O.desk], 2.2); if (P2.on && P2.own) { P2.job = 'follow'; P2.x = O.enter.x + .2; P2.z = O.enter.z + .9; } takeover({ heroState: 'idle', camera: officeCam, done: () => !S.office }); emit('phase', { phase: 'office', from }); }
  function officeCam() { const w = S.office ? clamp(S.office.t / 1.1, 0, 1) : 1, e = w * w * (3 - 2 * w); return { pos: [lerp(60.7, 59.7, e), 1.72, lerp(.5, -.7, e)], look: [lerp(58.3, 58.52, e), 1.04, -3.3], fov: 50 }; }
  function officeStep(dt) { const o = S.office, O = PT.office; o.t += dt; walk(OFF, dt); PL.x = OFF.x; PL.z = OFF.z; if (OFF.wp) PL.h = OFF.h; PL.speed = OFF.speed;
    const atDesk = !OFF.wp && hyp(OFF.x - O.desk.x, OFF.z - O.desk.z) < .3; S.heroState = OFF.wp ? 'walk' : 'idle';
    if (o.leaving) { if (!OFF.wp) { const how = o.leaving; S.office = null; UI.fade(.3); sfx('door_close', { g: .6 });
        if (how === 'back') { tp(PT.back.x + .7, PT.back.z, HP); if (P2.on && P2.own) { P2.x = PT.back.x + .9; P2.z = PT.back.z + 1.2; } if (S.started) leftStore('back'); S.wasIn = false; } else { tp(PT.staff.x - .25, PT.staff.z, -HP); if (P2.on && P2.own) { P2.x = PT.staff.x - .6; P2.z = PT.staff.z + 1; } }
        emit('phase', { phase: 'office-out', how }); } return; }
    if (atDesk) { OFF.h += angDiff(OFF.h, O.desk.h) * Math.min(1, dt * 8); PL.h = OFF.h; const cm = S.cams;
      if (!cm.wiped) { if (In.down(KEY.use)) { o.wipe += dt / 4; S.heroState = 'use'; S.working = o; if (o.wipe >= 1) { cm.wiped = true; cm.rec = false; HAD.camera = true; unlogAll('tape'); refreshEv('camera', 'wiped'); sfx('ui_ok'); hint('录像机格式化完成——今天的带子没了', 5); emit('phase', { phase: 'wiped' }); } } else o.wipe = Math.max(0, o.wipe - dt * .8); prompt(KEY.use, '按住 抹掉录像', o.wipe); }
      else prompt(KEY.use, '录像已抹掉', 0, true); }
    prompt(KEY.alt, '从后门离开'); prompt(KEY.quit, '回店里');
    if (hit(KEY.alt)) { o.leaving = 'back'; go(OFF, [[O.exit.x - .5, O.exit.z]], 2.6); } else if (hit(KEY.quit)) { o.leaving = 'store'; go(OFF, [O.enter], 2.4); }
  }

  /* ================================================================== minigames (takeovers). UI reads S.mg. */
  let TAKE = null;
  function takeover(spec) { TAKE = spec; const c = CTX.ctl; if (c && c.takeover) { try { c.takeover({ update: () => spec.done(), camera: spec.camera ? () => spec.camera() : undefined, heroState: spec.heroState, onEnd() { if (TAKE === spec) TAKE = null; } }); } catch (e) {} } }
  function openMG(mg) { S.mg = mg; mg.t = 0; sfx('ui_tick'); if (mg.at) tp(mg.at.x, mg.at.z, mg.at.h); takeover({ heroState: mg.hero || 'use', camera: mg.cam, done: () => S.mg !== mg }); emit('phase', { phase: 'minigame', kind: mg.kind }); }
  function closeMG(ok) { const mg = S.mg; if (!mg) return; S.mg = null; if (mg.end) mg.end(!!ok); emit('phase', { phase: 'minigame-end', kind: mg.kind, ok: !!ok }); }
  const wrap1 = v => { v = (v % 1 + 1) % 1; return v > .5 ? v - 1 : v; };
  function safeMG() { const sf = S.loot.safe, r = GT.rng('rb:safe' + sf.n + ':' + (S.t * 10 | 0));
    const mg = { kind: 'safe', ang: 0, shown: 0, dir: 1, speed: .34, zone: { c: .2 + r() * .6, w: .12 - sf.n * .018 }, lock: 0, miss: 0, flash: 0, tens: 0, at: { x: PT.safe.x - .12, z: PT.safe.z, h: HP }, hero: 'crouch',
      cam: () => ({ pos: [PT.safe.x - 1.0, 1.72, PT.safe.z + 1.5], look: [PT.safe.x + .42, .12, PT.safe.z - .3], fov: 54 }),
      step(dt) { const tn = mg.tens = tension(); mg.t += dt; mg.flash -= Math.sign(mg.flash) * Math.min(Math.abs(mg.flash), dt * 3); S.heroState = 'crouch';
        if (mg.lock > 0) { mg.lock -= dt; return; }
        mg.ang = (mg.ang + mg.dir * mg.speed * (1 - .38 * tn) * dt + 1) % 1; const sh = tn * .034; mg.shown = (mg.ang + Math.sin(mg.t * 23) * sh + Math.sin(mg.t * 37.3) * sh * .6 + 1) % 1;       // the shaking hand
        if (hit(KEY.quit) || hit('Escape')) { closeMG(false); return; }
        if (pressUse()) { if (Math.abs(wrap1(mg.shown - mg.zone.c)) <= mg.zone.w / 2) { safeTumbler('player'); mg.flash = 1; sfx('key_turn'); if (sf.done) { closeMG(true); return; } mg.dir = -mg.dir; mg.speed *= 1.14; mg.zone = { c: (mg.zone.c + .3 + r() * .4) % 1, w: .12 - sf.n * .018 }; mg.lock = .35; }
          else { mg.miss++; mg.flash = -1; mg.lock = .55; noise(.12, 'dial'); sfx('ui_bad'); mg.zone.c = (mg.zone.c + .23 + r() * .3) % 1; } } },
      bot() { mg.botT = mg.lock > 0 ? 0 : (mg.botT || 0) + 1; if (mg.botT > 34 && Math.abs(wrap1(mg.shown - mg.zone.c)) <= mg.zone.w * .3 && In.tap) In.tap(KEY.use); } };
    return mg; }

  /* ================================================================== store step */
  function tapeStep() { const cm = S.cams; if (!cm.rec || S.office) return; let sees = false; for (const id of ['A', 'B']) { const c = PT.cams[id]; if (cm[id].on && hyp(PL.x - c.x, PL.z - c.z) < 10 && los(c.x, c.z, PL.x, PL.z, false)) sees = true; }
    if (!sees || !S.inStore) return; if (!S.started) { if (!S.masked) S.faceOnTape = true; return; }
    logEv('camera', 'tape'); logEv('clothes', 'tape'); if (S.armed) logEv('weapon', 'tape'); if (P2.on && P2.inside) logEv('partner', 'tape'); if (!S.masked || S.faceOnTape) logEv('face', 'tape'); }
  let NPC = new Map();
  function npcRec(n) { let r = NPC.get(n); if (!r) { r = { notice: 0, alerted: false, phone: -1, film: false, saw: false, sees: false, i: NPC.size }; NPC.set(n, r); } return r; }
  function outsideStep(dt) { const list = CTX.npcs || []; let watching = 0;
    for (const n of list) { const r = npcRec(n); n.rb = r; const d = hyp(n.x - PL.x, n.z - PL.z), dDoor = hyp(n.x - PT.door.x, n.z - PT.door.z);
      const sees = d < 24 && !S.office && los(n.x, n.z, PL.x, PL.z, true), show = S.started && (S.aiming || S.armed || S.masked || C.people.some(p => p.present && p.anim === 'handsup'));
      r.sees = sees;
      if (!r.alerted) { if (S.started && sees && show) r.notice += dt * (.16 + .5 * clamp(1 - d / 22, 0, 1)) * (S.masked ? 1.3 : 1); else if (S.started && S.noise > .6 && dDoor < 28) r.notice += dt * .35; else if (S.alarm === 'loud' && dDoor < 45) r.notice += dt * .8; else r.notice = Math.max(0, r.notice - dt * .08);
        if (r.notice >= 1) { r.alerted = true; r.phone = 3.2; r.film = (r.i % 2) === 0; if ('state' in n) n.state = n.idle = 'phone'; emit('phase', { phase: 'witness', npc: n }); if (r.film) { emit('film', { npc: n, x: n.x, z: n.z }); hook('film', n); } if (S.inStore) hint(r.film ? '玻璃外面有人举起手机在拍' : '玻璃外面有人看见了', 4); } }
      else { if (sees) { r.saw = true; if (!S.masked && d < 14) logEv('face', 'out' + r.i); logEv('clothes', 'out' + r.i); if (S.armed) logEv('weapon', 'out' + r.i); if (P2.on && hyp(n.x - P2.x, n.z - P2.z) < 24) logEv('partner', 'out' + r.i); watching++; }
        if (r.phone > 0) { r.phone -= dt; if (r.phone <= 0) alarm('call', 'witness-outside'); }
        if (S.started && PL.inCar && d < 34 && los(n.x, n.z, PL.x, PL.z, true)) logEv('vehicle', 'out' + r.i); }       // sees which car you leave in
      if (r.notice > .02 && n.h !== undefined && S.started) n.h += angDiff(n.h, Math.atan2(PL.x - n.x, PL.z - n.z)) * Math.min(1, dt * 3); }
    S.watching = watching;
    // an officer who happens to look in
    if (S.started && !S.copSaw && !S.done) { const cops = hook('cops'); if (Array.isArray(cops)) for (const c of cops) { if (hyp(c.x - PL.x, c.z - PL.z) < 30 && los(c.x, c.z, PL.x, PL.z, true) && (S.masked || S.armed)) { S.copSaw = true; S.heat += 2; hook('addHeat', 2, 'officer saw the hold-up'); alarm('loud', 'officer'); break; } } }
  }
  function objective() { const L = remaining(), next = L.length ? L[0][0] : null, tk = money(S.take);
    if (S.done) return ''; if (S.office) return S.cams.wiped ? '录像抹掉了 —— 后门出去最干净' : '后屋 · 录像机在桌上';
    if (!S.started) { if (!S.inStore) return ''; if (S.masked || S.armed) return '他们已经在看你了 —— 动手，或者转身出去'; return S.cased ? '踩点完成 —— 等店员落单，或者等换班' : '像个客人一样逛逛：看清楚人、摄像头和柜台'; }
    if (S.leftT >= 0) return '到手 ' + tk + ' · 离开这一带';
    if (S.arrived) return '到手 ' + tk + ' · 警察已经到门口了 —— 后门！';
    if (S.alarm && S.alarmKnown) { if (S.clock < 14) return '到手 ' + tk + ' · 警察 ' + mmss(S.clock) + ' 后到 —— 现在就走'; return '到手 ' + tk + ' · ' + (S.alarm === 'loud' ? '警铃在响' : '已经有人报警') + ' —— ' + (next && S.clock > 26 ? '再拿一样就撤，或者现在收手' : '见好就收'); }
    if (!next) return '到手 ' + tk + ' · 全拿完了 —— 走后门还是正门？';
    if (S.risk < .34) return '到手 ' + tk + ' · 风险低 —— ' + next + '还没动（' + money(L[0][1]) + '）';
    if (S.risk < .62) return '到手 ' + tk + ' · 风险在涨 —— 继续拿' + next + '，还是见好就收？';
    return '到手 ' + tk + ' · 太吵了，随时有人报警 —— 该走了'; }
  function leftStore(how) { if (S.leftT >= 0) return; S.exit = how; S.leftT = S.t; S.phase = 'escape'; emit('phase', { phase: 'escape', exit: how }); if (!S.alarm) { const c = C.clerk; schedCall(c && c.present && !c.fled ? (c.mode === 'down' ? 26 : 12 + c.fear * 10) : 60, 'clerk-after'); }
    if (how === 'front' && S.cams.rec && S.cams.A.on && S.pcar && hyp(S.pcar.x - PT.door.x, S.pcar.z - PT.door.z) < 6.5) logEv('vehicle', 'tape'); }
  function finish(result) { if (S.done) return; S.done = true; S.result = result; S.phase = 'done';
    let stars = S.alarm === 'loud' ? 2 : S.alarm ? 1 : 0; if (S.arrived) stars += 1; if (logged() >= 4) stars += 1; if (result === 'aborted') stars = 0; stars = Math.max(0, stars - S.heat);
    const w = HOOKS.wallet || GT.wallet; if (S.take > 0 && !S.paid && w && w.add) { try { w.add(S.take, 'robbery'); S.paid = true; } catch (e) {} }
    if (stars > 0) hook('addHeat', stars, 'store robbery: ' + (S.alarm || 'reported') + ', ' + logged() + ' description items');
    if (S.alarm === 'loud') { hook('alarm', false); sfx('alarm_bell', { on: false }); }
    emit('end', { result, take: S.take, exit: S.exit, alarm: S.alarm, arrived: S.arrived, stars, evidence: Object.assign({}, state.evidence), seconds: S.t - S.tStart, how: S.startHow }); emit('phase', { phase: 'done' }); }
  function storeStep(dt) {
    S.t += dt; S.shoutCd -= dt; if (S.hintT > 0) { S.hintT -= dt; if (S.hintT <= 0) S.hint = ''; } S.noise = Math.max(0, S.noise - dt * .22); S.heroState = null; S.working = null;
    const dDoor = hyp(PL.x - PT.door.x, PL.z - PT.door.z); S.inStore = !!S.office || inStoreAt(PL.x, PL.z); S.near = dDoor < 9; S.behind = S.inStore && !S.office && PL.x > PT.lane - .55 && PL.x < PT.clerk.x + .5 && PL.z > PT.clerk.z - 3.1 && PL.z < PT.flapE.z + .35;
    if (S.done) { for (const p of C.people) { if (p.present) { if (p.mode !== 'down') p.anim = p.wp ? 'walk' : 'idle'; walk(p, dt); } } partnerStep(dt); return; }
    // mask / conceal
    if (hit(KEY.mask)) { S.masked = !S.masked; sfx('ui_tick'); hint(S.masked ? '面罩拉上了' : '面罩摘了', 1.8); emit('phase', { phase: 'mask', on: S.masked }); }
    if (hit(KEY.arm)) { S.armed = !S.armed; sfx('ui_tick'); hint(S.armed ? '家伙亮出来了' : '家伙收起来了', 1.8); }
    // aim / shout / orders
    const wasAim = S.aiming; S.aiming = aimDown() && !S.mg && !S.office && !PL.inCar; S.target = null;
    if (S.aiming) { if (!S.armed) S.armed = true; let ba = .45; for (const p of C.people) { p.aimOff = 9; if (!p.present || p.fled) continue; const d = hyp(p.x - PL.x, p.z - PL.z); if (d > 13 || d < .3) continue; const a = Math.abs(angDiff(PL.yaw, Math.atan2(p.x - PL.x, p.z - PL.z))); p.aimOff = a; if (a < ba && los(PL.x, PL.z, p.x, p.z, true)) { ba = a; S.target = p; } }
      S.heroState = 'aim'; if (S.target && !S.started && (S.inStore || S.near)) startRobbery('aim'); if (S.inStore || S.near) { if (hit(KEY.use)) shout(); prompt(KEY.use, '喝令'); } }
    else for (const p of C.people) p.aimOff = 9;
    if (wasAim !== S.aiming && S.aiming) sfx('ui_tick', { g: .5 });
    if (P2.on && (S.inStore || S.near) && !S.mg) for (let n = 1; n <= 3; n++) if (hit('Digit' + n)) order(n);
    // people, partner, schedule
    for (const p of C.people) stepPerson(p, dt); shiftStep(dt); partnerStep(dt);
    // interactions
    if (S.office) officeStep(dt); else if (S.mg) { if (S.mg.car === undefined) S.mg.step(dt); } else spotsStep(dt);
    if (S.working && !S.heroState) S.heroState = 'use';
    if (!S.cased && S.inStore && !S.started && !S.masked && !S.office) { S.casedT += dt; if (S.casedT > 9) { S.cased = true; hint('踩点：' + casing(), 6); emit('phase', { phase: 'cased' }); } }
    tapeStep(); outsideStep(dt);
    // alarm timeline
    if (S.callIn >= 0 && !S.alarm) { S.callIn -= dt; if (S.callIn < 0) alarm('call', S.callWhy); }
    if (S.alarm && !S.alarmKnown && S.t - S.alarmT > 10) { S.alarmKnown = true; say('警用频道', S.alarm === 'silent' ? '各单位，日落加油站，静默报警触发，就近单位前往。' : '各单位，有人报案，日落加油站便利店疑似抢劫。', 3.2); }
    if (S.clock !== null && !S.arrived) { S.clock -= dt; if (S.clock <= 0) { S.clock = 0; S.arrived = true; const here = S.inStore || dDoor < 30; S.heat += here ? 3 : 2; S.alarmKnown = true; hook('addHeat', here ? 3 : 2, here ? 'police arrived while you were still at the store' : 'police arrived on scene'); emit('alarm', { kind: 'arrive', here, clock: 0, known: true }); } }
    // leaving
    if (S.started && S.leftT < 0 && !S.office && !S.inStore && S.wasIn) leftStore(PL.x < ST.x0 + .2 ? 'front' : 'back');
    S.wasIn = S.inStore;
    if (S.started && S.leftT >= 0) { if (dDoor > 45 || (PL.inCar && dDoor > 28)) finish(S.arrived && S.t - S.leftT < 3 ? 'cornered' : S.alarm ? 'hot' : 'clean'); }
    else if (S.started && !S.inStore && S.take === 0 && dDoor > 45) finish('aborted');
    if (!S.started) { if (S.phase !== 'idle' && !S.inStore) { S.phase = 'idle'; emit('phase', { phase: 'idle' }); } else if (S.inStore && S.phase === 'idle') { S.phase = 'casing'; emit('phase', { phase: 'casing' }); } }
    // risk + objective
    let rmax = 0; for (const p of C.people) if (p.present) rmax = Math.max(rmax, p.reach, p.phone, p.panic * .8);
    S.risk = !S.started ? clamp((S.masked ? .2 : 0) + (S.armed ? .2 : 0), 0, 1) : clamp(.12 + (S.alarm ? .4 + .45 * (1 - S.clock / RESP[S.alarm]) : rmax * .3) + .06 * logged() + .2 * S.noise + (S.watching ? .1 : 0), 0, 1);
    const o = objective(); if (o !== S.obj) { S.obj = o; hook('objective', o); }
  }

  /* ================================================================== car theft */
  let CR = new Map(); const TH = { near: null, susp: 0, clone: null, busyT: 0, alarmLeft: null };
  const SECN = { old: '老式机械锁', modern: '无钥匙进入', luxury: '防盗芯片' };
  function carRec(c) { let r = CR.get(c); if (!r) { const sec = c.security || ({ pickup: 'old', compact: 'old', sedan: 'modern', hero: 'luxury', cruiser: 'luxury' })[c.kind] || 'old';
      r = { car: c, security: sec, locked: c.locked !== false, unlocked: c.locked === false, broken: false, bypassed: false, keyless: false, started: false, stolen: false, alarm: null, hasAlarm: c.alarm !== undefined ? !!c.alarm : (sec !== 'old' || CR.size % 2 === 1), method: null, fumbles: 0, seen: false, report: -1, reportWhy: '', lock: 0, startP: 0, id: CR.size }; CR.set(c, r); } return r; }
  function carLocal(c, lx, lz) { const s = Math.sin(c.h || 0), k = Math.cos(c.h || 0); return { x: c.x + k * lx + s * lz, z: c.z - s * lx + k * lz }; }
  function eyeOf(c) { const e = c.dims && c.dims.eye; if (!e) return [.37, 1.15, -.05]; return Array.isArray(e) ? e : [e.x, e.y, e.z]; }
  function doorPos(c) { const W = (c.dims && c.dims.W) || 1.85, e = eyeOf(c), p = carLocal(c, W / 2 + .5, e[2] + .1); p.h = Math.atan2(-Math.cos(c.h || 0), Math.sin(c.h || 0)); return p; }
  function carCam(c, side) { const d = doorPos(c), f = [Math.sin(d.h), Math.cos(d.h)], r = [-Math.cos(d.h), Math.sin(d.h)], s = side || 1; return () => ({ pos: [d.x - f[0] * 1.9 + r[0] * .86 * s, 1.66, d.z - f[1] * 1.9 + r[1] * .86 * s], look: [d.x + f[0] * .7 + r[0] * .1 * s, .74, d.z + f[1] * .7 + r[1] * .1 * s], fov: 52 }); }
  function carAlarm(r, why) { if (r.alarm || !r.hasAlarm) return false; r.alarm = { t: 0, look: 8, dur: 26, looked: false, blip: 0 }; noise(.5, 'car-alarm'); emit('alarm', { kind: 'car', why: why || '', car: r.car, clock: 8, known: true }); hint('车辆警报响了——有人回头之前还有几秒', 3.5); return true; }
  function carLights(r, on) { const c = r.car, v = c.veh || c; try { if (v && v.setLights) v.setLights({ hazard: on ? 1 : 0, left: on ? 1 : 0, right: on ? 1 : 0 }); } catch (e) {} }
  function smash(r) { if (r.broken) return; r.broken = true; r.unlocked = true; r.method = r.method || 'smash'; TH.busyT = 3; noise(.75, 'glass'); sfx('glass', { distance: 1 }); VIS.carGlass(r); logEv('vehicle', 'broken-window:' + r.id); if (!carAlarm(r, 'smash')) hint('玻璃碎了一座位——没有警报，但整条街都听见了', 3.5); emit('phase', { phase: 'car-smash', car: r.car }); }
  function carSeen(r, who) { if (r.seen) return; r.seen = true; logEv('clothes', who); if (!S.masked) logEv('face', who); hook('addHeat', 1, 'seen breaking into a car'); emit('alarm', { kind: 'spotted', why: who, car: r.car, known: true }); hint('有人看见你在撬车', 3); }
  const mgFlash = (mg, dt) => { mg.flash -= Math.sign(mg.flash) * Math.min(Math.abs(mg.flash), dt * 3); };
  function slimMG(r) { const g = GT.rng('rb:slim' + r.id + ':' + r.fumbles), c = r.car;
    const mg = { kind: 'slimjim', car: c, rec: r, pos: .5, notch: .14 + g() * .72, feel: 0, pulse: 0, open: false, fumbles: 0, flash: 0, at: doorPos(c), hero: 'use', cam: carCam(c),
      step(dt) { mg.t += dt; mgFlash(mg, dt); TH.busyT = 1; S.heroState = 'use'; const ax = In.axis().x; mg.pos = clamp(mg.pos + ax * dt * .3 + (In.look.dx || 0) * .0007, 0, 1);
        mg.feel = Math.exp(-Math.pow((mg.pos - mg.notch) / .075, 2)); mg.pulse = (mg.t % 1.3) / 1.3; mg.open = mg.pulse > .58 && mg.pulse < .9;
        if (hit(KEY.quit) || hit('Escape')) { closeMG(false); return; }
        if (pressUse()) { if (mg.feel > .6 && mg.open) { r.unlocked = true; r.method = 'slimjim'; sfx('door_open', { g: .7 }); mg.flash = 1; closeMG(true); }
          else { mg.fumbles++; r.fumbles++; mg.flash = -1; noise(.17, 'fumble'); sfx('thunk', { g: .7 }); mg.pos = clamp(mg.pos + (g() - .5) * .16, 0, 1); if (r.fumbles >= 3) carAlarm(r, 'fumble'); } } },
      bot() { if (!In.set) return; const tg = mg.t < 3.2 ? clamp(mg.notch + .3 * Math.cos(mg.t * 1.5 + 1), .03, .97) : mg.notch, e = tg - mg.pos; In.set('KeyD', e > .012); In.set('KeyA', e < -.012); if (mg.t > 3.6 && Math.abs(mg.notch - mg.pos) < .03 && mg.pulse > .64 && mg.pulse < .84) In.tap(KEY.use); },
      end() { if (In.set) { In.set('KeyA', false); In.set('KeyD', false); } } };
    return mg; }
  const PADS = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  function bypassMG(r) { const g = GT.rng('rb:byp' + r.id), c = r.car;
    const mg = { kind: 'bypass', car: c, rec: r, round: 0, seq: [], show: 0, phase: 'show', inp: 0, lit: -1, litT: 0, mistakes: 0, tamper: 0, left: 24, late: false, flash: 0, botT: 0, at: doorPos(c), hero: 'use', cam: carCam(c),
      next() { const n = 3 + mg.round; mg.seq = []; for (let i = 0; i < n; i++) mg.seq.push((g() * 4) | 0); mg.phase = 'show'; mg.show = -.5; mg.inp = 0; },
      step(dt) { mg.t += dt; mgFlash(mg, dt); mg.litT -= dt; if (mg.litT <= 0 && mg.phase !== 'show') mg.lit = -1; TH.busyT = 1; S.heroState = 'use';
        mg.left -= dt; if (mg.left <= 0 && !mg.late) { mg.late = true; carAlarm(r, 'immobiliser'); }
        if (hit(KEY.quit) || hit('Escape')) { closeMG(false); return; }
        if (mg.phase === 'show') { mg.show += dt / .5; const i = Math.floor(mg.show); mg.lit = i >= 0 && i < mg.seq.length && mg.show - i < .72 ? mg.seq[i] : -1; if (mg.show >= mg.seq.length + .2) { mg.phase = 'input'; mg.lit = -1; } for (const k of PADS) In.consume(k); return; }
        for (let k = 0; k < 4; k++) if (hit(PADS[k])) { mg.lit = k; mg.litT = .18;
          if (k === mg.seq[mg.inp]) { mg.inp++; sfx('ui_tick'); if (mg.inp >= mg.seq.length) { mg.round++; mg.flash = 1; sfx('ui_ok'); if (mg.round >= 3) { r.unlocked = r.bypassed = r.keyless = true; r.method = r.method || 'bypass'; if (mg.mistakes) { r.report = 60; r.reportWhy = 'tracker'; } closeMG(true); return; } mg.next(); } }
          else { mg.mistakes++; mg.tamper = Math.min(1, mg.tamper + .34); mg.flash = -1; sfx('ui_bad'); noise(.1, 'beep'); if (mg.tamper >= 1) { carAlarm(r, 'immobiliser'); mg.tamper = .4; } mg.next(); } break; } },
      bot() { if (mg.phase === 'input' && In.tap && (++mg.botT) % 9 === 0) In.tap(PADS[mg.seq[mg.inp]]); } };
    mg.next(); return mg; }
  function hotwireMG(r) { const g = GT.rng('rb:hw' + r.id), c = r.car, need = r.security === 'old' ? 3 : 4;
    const mg = { kind: 'hotwire', car: c, rec: r, p: 0, dir: 1, stage: 0, need, zone: { c: .3 + g() * .4, w: .2 }, flash: 0, at: doorPos(c), hero: 'crouch', cam: carCam(c),
      step(dt) { mg.t += dt; mgFlash(mg, dt); TH.busyT = 1; S.heroState = 'crouch'; mg.p += mg.dir * dt * (.85 + mg.stage * .12); if (mg.p > 1) { mg.p = 1; mg.dir = -1; } if (mg.p < 0) { mg.p = 0; mg.dir = 1; }
        if (hit(KEY.quit) || hit('Escape')) { closeMG(false); return; }
        if (pressUse()) { if (Math.abs(mg.p - mg.zone.c) <= mg.zone.w / 2) { mg.stage++; mg.flash = 1; sfx('ui_ok'); if (mg.stage >= need) { r.started = true; r.method = r.method || 'hotwire'; if (r.alarm) { r.alarm = null; carLights(r, false); } sfx('ignition'); closeMG(true); return; } mg.zone = { c: .15 + g() * .7, w: Math.max(.11, .2 - mg.stage * .03) }; }
          else { mg.flash = -1; noise(.1, 'spark'); sfx('ui_bad'); mg.zone.c = .15 + g() * .7; } } },
      bot() { mg.botT = (mg.botT || 0) + 1; if (In.tap && mg.botT > 40 && Math.abs(mg.p - mg.zone.c) <= mg.zone.w * .3) { mg.botT = 0; In.tap(KEY.use); } } };
    return mg; }
  function cloneStep(dt) { const cl = TH.clone; if (!cl) return; const r = cl.rec, c = r.car, o = c.owner, dp = doorPos(c), dD = hyp(PL.x - dp.x, PL.z - dp.z); TH.busyT = .5;
    let sig = clamp(1 - (dD - .7) / 1.7, 0, 1) * .45, src = 'door';
    if (o) { const dO = hyp(PL.x - o.x, PL.z - o.z), so = clamp(1 - (dO - 1.1) / 3.6, 0, 1); if (so > sig) { sig = so; src = 'owner'; }
      const ang = o.h !== undefined ? Math.abs(angDiff(o.h, Math.atan2(PL.x - o.x, PL.z - o.z))) : 0, inView = dO < 5.2 && ang < 1.15 && los(o.x, o.z, PL.x, PL.z, true);
      if (inView) cl.susp += dt * .5 * (1.5 - dO / 5.2) * (PL.crouch ? .45 : 1) * (PL.speed > 3 ? 1.8 : 1) * (S.masked ? 2.5 : 1); else cl.susp = Math.max(0, cl.susp - dt * .3); }
    cl.sig = sig; cl.src = src; cl.p += dt * sig / 4; if (sig <= 0) { cl.lost += dt; if (cl.lost > 2) { TH.clone = null; hint('信号丢了——离车主或车门近一点', 3); return; } } else cl.lost = 0;
    if (cl.susp >= 1) { TH.clone = null; r.lock = 20; noise(.4, 'owner'); say('车主', '喂！你拿个什么东西对着我？！', 2.4); logEv('clothes', 'owner' + r.id); if (!S.masked) logEv('face', 'owner' + r.id); hook('addHeat', 1, 'caught cloning a key'); emit('alarm', { kind: 'spotted', why: 'owner', car: c, known: true }); return; }
    if (cl.p >= 1) { TH.clone = null; r.unlocked = r.keyless = true; r.method = 'cloner'; r.report = 120; r.reportWhy = 'owner-report'; sfx('ui_ok'); hint('钥匙克隆好了——车以为你就是车主', 3.5); emit('phase', { phase: 'car-cloned', car: c }); }
    else if (hit(KEY.quit)) TH.clone = null; }
  function carsStep(dt) {
    const cars = CTX.cars || []; let near = null, nd = 1.6; TH.busyT -= dt; TH.alarmLeft = null;
    for (const c of cars) { const r = carRec(c); r.lock = Math.max(0, r.lock - dt);
      if (r.alarm) { const a = r.alarm; a.t += dt; S.noise = Math.max(S.noise, .8); a.blip -= dt; if (a.blip <= 0) { a.blip = .62; sfx('horn', { dur: .22, g: .5 }); } carLights(r, (a.t % .7) < .35); if (!a.looked) TH.alarmLeft = TH.alarmLeft === null ? a.look - a.t : Math.min(TH.alarmLeft, a.look - a.t);
        if (a.t >= a.look && !a.looked) { a.looked = true; const dp = doorPos(c); if (hyp(PL.x - dp.x, PL.z - dp.z) < 8 && !(PL.inCar && PL.speed > 4)) { logEv('vehicle', 'alarm:' + r.id); carSeen(r, 'alarm-witness' + r.id); } emit('alarm', { kind: 'car-look', car: c, known: true }); }
        if (a.t > a.dur) { r.alarm = null; carLights(r, false); } }
      if (r.report > 0) { r.report -= dt; if (r.report <= 0) { logEv('vehicle', r.reportWhy + ':' + r.id); emit('phase', { phase: 'car-reported', car: c, why: r.reportWhy }); } }
      if (r.stolen) continue; const dp = doorPos(c), d = hyp(PL.x - dp.x, PL.z - dp.z); if (d < nd) { nd = d; near = r; } }
    TH.near = near; cloneStep(dt);
    // passers-by notice someone working on a car door
    if (TH.busyT > 0) { let att = 0; for (const n of (CTX.npcs || [])) { const d = hyp(n.x - PL.x, n.z - PL.z); if (d < 17 && los(n.x, n.z, PL.x, PL.z, true)) att += .2 * (1.3 - d / 17); } TH.susp = clamp(TH.susp + dt * (att * (PL.crouch ? .6 : 1) + S.noise * .12 - .04), 0, 1); const r = (S.mg && S.mg.rec) || near; if (TH.susp >= 1 && r) { TH.susp = .4; carSeen(r, 'passer-by' + r.id); } }
    else TH.susp = Math.max(0, TH.susp - dt * .15);
    if (S.mg) { if (S.mg.car !== undefined) S.mg.step(dt); return; } if (!near || PL.inCar || S.office || S.inStore) return;
    const r = near, sec = r.security;
    if (r.started) { prompt(KEY.use, '上车'); if (hit(KEY.use)) { r.stolen = true; S.pcar = r.car; emit('loot', { what: 'car', amount: 0, take: S.take, car: r.car, method: r.method, security: sec, by: 'player' }); hook('enterCar', r.car, r); } return; }
    if (!r.unlocked) {
      if (sec === 'old') { prompt(KEY.use, '撬锁'); if (hit(KEY.use)) { openMG(slimMG(r)); return; } }
      else if (sec === 'modern') { if (TH.clone) prompt(KEY.quit, '收起克隆器'); else { prompt(KEY.use, r.lock > 0 ? '克隆钥匙 · 车主盯着呢' : '克隆钥匙', 0, r.lock > 0); if (hit(KEY.use) && r.lock <= 0) { TH.clone = { rec: r, p: 0, susp: 0, sig: 0, src: 'door', lost: 0 }; sfx('ui_tick'); } } }
      else { prompt(KEY.use, '破解防盗'); if (hit(KEY.use)) { openMG(bypassMG(r)); return; } }
      prompt(KEY.alt, '砸窗'); if (hit(KEY.alt)) { TH.clone = null; smash(r); } return; }
    // inside: get it running
    if (sec === 'luxury' && !r.bypassed) { prompt(KEY.use, '破解防盗'); if (hit(KEY.use)) openMG(bypassMG(r)); return; }
    if (r.keyless) { if (In.down(KEY.use)) { r.startP += dt / .8; S.heroState = 'use'; if (r.startP >= 1) { r.started = true; r.startP = 0; if (r.alarm) { r.alarm = null; carLights(r, false); } sfx('ignition'); In.consume(KEY.use); } } else r.startP = Math.max(0, r.startP - dt * 2); prompt(KEY.use, '按住 一键启动', r.startP); return; }
    prompt(KEY.use, '接线点火'); if (hit(KEY.use)) openMG(hotwireMG(r));
  }

  /* ================================================================== HUD + minigame overlays (DOM, injected CSS; tone follows css/hud.css) */
  const CSS = `
#rb{position:fixed;inset:0;z-index:12;pointer-events:none;--u:clamp(.85px,.1389vh,1.6px);--amber:#ffb866;--hot:#ff5a44;--cool:#7cc6ff;--mint:#8fe6c2;--ink:rgba(9,12,16,.62);--line:rgba(255,255,255,.16);--top:22;--lb:26;
 --rbf:-apple-system,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif;--rbd:"Avenir Next Condensed","DIN Condensed","Helvetica Neue","PingFang SC",Impact,sans-serif;
 font-family:var(--rbf);color:#fff;font-size:calc(13*var(--u));text-shadow:0 1px 3px rgba(0,0,0,.75),0 0 12px rgba(0,0,0,.35);-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}
#rb>*{position:absolute;opacity:0;transition:opacity .3s}#rb>.on{opacity:1}
#rb kbd{display:inline-block;min-width:1.5em;padding:.08em .42em;margin:0 .18em;border:1px solid rgba(255,255,255,.38);border-radius:.32em;font:600 .86em/1.45 var(--rbf);text-align:center;color:rgba(255,255,255,.92);background:rgba(10,12,16,.38);text-shadow:none;box-sizing:border-box}
#rb u{text-decoration:none}
.rb-tr{right:calc(26*var(--u));top:calc(var(--top)*var(--u));display:flex;flex-direction:column;align-items:flex-end;gap:calc(7*var(--u))}
.rb-stars{display:flex;gap:calc(3*var(--u))}.rb-stars svg{width:calc(19*var(--u));height:calc(19*var(--u));fill:rgba(255,255,255,.08);stroke:rgba(255,255,255,.34);stroke-width:1.3;stroke-linejoin:round;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));transition:fill .25s,stroke .25s}
.rb-stars svg.on{fill:var(--hot);stroke:#ffd2c8;filter:drop-shadow(0 0 6px rgba(255,80,50,.8))}
.rb-ev{display:flex;gap:calc(4*var(--u))}
.rb-ic{position:relative;width:calc(27*var(--u));height:calc(22*var(--u));border:1px solid var(--line);border-radius:calc(6*var(--u));background:var(--ink);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:border-color .3s,background .3s}
.rb-ic svg{width:calc(15*var(--u));height:calc(15*var(--u));fill:none;stroke:rgba(255,255,255,.34);stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round;transition:stroke .3s}
.rb-ic.log{border-color:rgba(255,90,68,.78);background:rgba(70,14,8,.66)}.rb-ic.log svg{stroke:#ffd9d0}.rb-ic.log::before{content:'';position:absolute;right:calc(-2.5*var(--u));top:calc(-2.5*var(--u));width:calc(5*var(--u));height:calc(5*var(--u));border-radius:50%;background:var(--hot);box-shadow:0 0 6px var(--hot)}
.rb-ic.clr{border-color:rgba(143,230,194,.5)}.rb-ic.clr svg{stroke:rgba(143,230,194,.62)}.rb-ic.clr::after{content:'';position:absolute;left:calc(4*var(--u));right:calc(4*var(--u));top:50%;height:1px;background:var(--mint);transform:rotate(-26deg);box-shadow:0 0 4px rgba(143,230,194,.7)}
.rb-ic.pulse{animation:rb-pulse .7s ease-out}@keyframes rb-pulse{0%{transform:scale(1.5)}100%{transform:scale(1)}}
.rb-evl,.rb-st{font-size:calc(10.5*var(--u));letter-spacing:.2em;color:rgba(255,255,255,.62);min-height:1.2em;text-align:right}
.rb-evl b{font-weight:500;color:#ffb4a6}.rb-evl b.c{color:var(--mint)}
.rb-st.hot{color:#ffb4a6}.rb-st.warn{color:var(--amber)}.rb-st b{font:600 calc(15*var(--u))/1 var(--rbd);letter-spacing:.06em;color:#fff;margin-left:.5em;font-variant-numeric:tabular-nums}
.rb-nz{display:flex;align-items:center;gap:calc(8*var(--u));font-size:calc(9.5*var(--u));letter-spacing:.34em;color:rgba(255,255,255,.52)}
.rb-nz u,.rb-row u{display:block;position:relative;width:calc(74*var(--u));height:calc(3*var(--u));background:rgba(255,255,255,.16);border-radius:2px;overflow:hidden}
.rb-nz u i,.rb-row u i{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg,#f3e3c8,var(--amber) 55%,var(--hot));border-radius:2px}
.rb-take{left:calc(26*var(--u));top:calc(22*var(--u));display:flex;flex-direction:column;gap:calc(2*var(--u))}
.rb-take span{font-size:calc(10.5*var(--u));letter-spacing:.34em;color:rgba(255,255,255,.6)}.rb-take b{font:600 calc(27*var(--u))/1 var(--rbd);letter-spacing:.03em;color:#fff3df;font-variant-numeric:tabular-nums}
.rb-take em{font-style:normal;font-size:calc(10*var(--u));letter-spacing:.22em;color:rgba(255,255,255,.5);margin-top:calc(4*var(--u))}
.rb-bc{left:50%;bottom:calc(26*var(--u));width:66%;margin-left:-33%;text-align:center}
.rb-sub{display:inline-block;font-size:calc(17*var(--u));line-height:1.45;letter-spacing:.04em;text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 14px rgba(0,0,0,.6);opacity:0;transition:opacity .22s}.rb-sub.on{opacity:1}
.rb-sub .who{margin-right:.7em;font-size:.68em;letter-spacing:.2em;color:var(--amber);vertical-align:.12em}
.rb-hint{margin-top:calc(6*var(--u));font-size:calc(11.5*var(--u));letter-spacing:.14em;color:var(--mint);min-height:1.3em;opacity:0;transition:opacity .25s}.rb-hint.on{opacity:1}
.rb-obj{margin-top:calc(7*var(--u));font-size:calc(11*var(--u));letter-spacing:.3em;color:rgba(255,255,255,.7);min-height:1.3em}.rb-obj.hot{color:#ffc2b6}
.rb-ord{left:calc(26*var(--u));bottom:calc((var(--lb) + 34)*var(--u));display:flex;flex-direction:column;gap:calc(5*var(--u));font-size:calc(11*var(--u));letter-spacing:.14em;color:rgba(255,255,255,.62)}
.rb-ord div{display:flex;align-items:center;gap:calc(4*var(--u))}.rb-ord em{font-style:normal;font-size:.86em;letter-spacing:.2em;color:var(--mint);margin-left:calc(6*var(--u));opacity:0}
.rb-ord .cur{color:#fff}.rb-ord .cur em{opacity:1}.rb-ord .cur kbd{border-color:var(--mint);color:var(--mint)}.rb-ord .dn{opacity:.4;text-decoration:line-through}
.rb-ord h6{margin:0 0 calc(2*var(--u));font:500 calc(9.5*var(--u))/1 var(--rbf);letter-spacing:.34em;color:rgba(255,255,255,.45)}
.rb-keys{left:calc(26*var(--u));bottom:calc(var(--lb)*var(--u));display:flex;gap:calc(8*var(--u));font-size:calc(10.5*var(--u));letter-spacing:.12em;color:rgba(255,255,255,.6)}
.rb-keys span{display:flex;align-items:center;height:calc(22*var(--u));padding:0 calc(9*var(--u)) 0 calc(4*var(--u));border:1px solid var(--line);border-radius:calc(11*var(--u));background:var(--ink);text-shadow:none}
.rb-keys span.act{border-color:rgba(255,184,102,.6);color:#ffe2bd}
.rb-pr{right:calc(26*var(--u));bottom:calc(26*var(--u));display:flex;flex-direction:column;align-items:flex-end;gap:calc(7*var(--u))}.rb-pr.up{bottom:calc(66*var(--u))}
.rb-p{position:relative;display:flex;align-items:center;gap:calc(9*var(--u));font-size:calc(12.5*var(--u));letter-spacing:.14em;padding-bottom:calc(4*var(--u))}
.rb-p .k{min-width:calc(23*var(--u));height:calc(23*var(--u));padding:0 calc(5*var(--u));box-sizing:border-box;border:1px solid rgba(255,255,255,.55);border-radius:calc(5*var(--u));background:rgba(10,12,16,.5);font:600 calc(11.5*var(--u))/calc(21*var(--u)) var(--rbf);text-align:center;text-shadow:none}
.rb-p u{position:absolute;left:0;right:0;bottom:0;height:calc(2*var(--u));background:rgba(255,255,255,.14);opacity:0}.rb-p.h u{opacity:1}.rb-p u i{display:block;height:100%;width:100%;transform-origin:0 50%;background:var(--mint);box-shadow:0 0 8px var(--mint)}
.rb-p.dim{color:rgba(255,255,255,.45)}.rb-p.dim .k{border-color:rgba(255,255,255,.22);color:rgba(255,255,255,.4)}
.rb-tags{inset:0}.rb-tag{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:calc(2.5*var(--u));white-space:nowrap;will-change:transform}
.rb-tag b{font:500 calc(9.5*var(--u))/1.2 var(--rbf);letter-spacing:.24em;color:rgba(255,255,255,.8)}.rb-tag b::before{content:'';display:inline-block;width:calc(5*var(--u));height:calc(5*var(--u));margin-right:calc(5*var(--u));border-radius:50%;border:1px solid rgba(255,255,255,.6);vertical-align:.05em}
.rb-tag.cov b::before{background:var(--mint);border-color:var(--mint);box-shadow:0 0 6px var(--mint)}
.rb-tag u{display:block;position:relative;width:calc(40*var(--u));height:calc(2.5*var(--u));background:rgba(0,0,0,.45);border-radius:2px;overflow:hidden}.rb-tag u i{position:absolute;inset:0;transform-origin:0 50%;transform:scaleX(0)}
.rb-tag u.f i{background:linear-gradient(90deg,var(--amber),var(--hot))}.rb-tag u.c i{background:var(--mint)}
.rb-tag em{font-style:normal;font-size:calc(9.5*var(--u));letter-spacing:.16em;color:#ffb4a6;min-height:1.2em}.rb-tag.warn em{animation:rb-blink .6s ease-in-out infinite}@keyframes rb-blink{50%{opacity:.35}}
.rb-x{left:50%;top:50%;width:calc(5*var(--u));height:calc(5*var(--u));margin:calc(-2.5*var(--u)) 0 0 calc(-2.5*var(--u));border-radius:50%;border:1px solid rgba(255,255,255,.85);box-shadow:0 0 3px rgba(0,0,0,.8)}
.rb-mg{left:50%;bottom:calc(104*var(--u));width:calc(348*var(--u));margin-left:calc(-174*var(--u));padding:calc(14*var(--u)) calc(18*var(--u)) calc(12*var(--u));border:1px solid var(--line);border-radius:calc(10*var(--u));background:rgba(9,12,16,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);text-shadow:none;box-sizing:border-box;transition:opacity .3s,border-color .2s}
.rb-mg.good{border-color:rgba(143,230,194,.8)}.rb-mg.bad{border-color:rgba(255,90,68,.8)}
.rb-mt{font-size:calc(10.5*var(--u));letter-spacing:.4em;color:rgba(255,255,255,.66);text-align:center}.rb-mt b{font-weight:500;color:#fff}
.rb-tip{margin-top:calc(9*var(--u));font-size:calc(10.5*var(--u));letter-spacing:.14em;color:rgba(255,255,255,.6);text-align:center;line-height:1.7}.rb-tip .sh{color:var(--amber);margin-left:.8em;opacity:0}.rb-tip .sh.on{opacity:1;animation:rb-blink .5s infinite}
.rb-pips{display:flex;justify-content:center;gap:calc(7*var(--u));margin-top:calc(8*var(--u))}.rb-pips i{width:calc(22*var(--u));height:calc(3*var(--u));border-radius:2px;background:rgba(255,255,255,.18)}.rb-pips i.on{background:var(--mint);box-shadow:0 0 8px var(--mint)}.rb-pips.bad i.on{background:var(--hot);box-shadow:0 0 8px var(--hot)}
.rb-row{display:flex;align-items:center;justify-content:center;gap:calc(10*var(--u));margin-top:calc(9*var(--u));font-size:calc(9.5*var(--u));letter-spacing:.34em;color:rgba(255,255,255,.52)}.rb-row u{width:calc(150*var(--u))}
.rb-dial{display:block;width:calc(156*var(--u));height:calc(156*var(--u));margin:calc(10*var(--u)) auto 0}
.rb-dial .ring{fill:none;stroke:rgba(255,255,255,.1);stroke-width:13}.rb-dial .tick{fill:none;stroke:rgba(255,255,255,.5);stroke-width:7;stroke-dasharray:.9 8.315}.rb-dial .tick2{fill:none;stroke:rgba(255,255,255,.85);stroke-width:13;stroke-dasharray:1.3 44.78}
.rb-dial .zone{fill:none;stroke:var(--mint);stroke-width:13;filter:drop-shadow(0 0 5px rgba(143,230,194,.8))}.rb-dial .knob{fill:#14181d;stroke:rgba(255,255,255,.3);stroke-width:1.2}.rb-dial .knurl{fill:none;stroke:rgba(255,255,255,.2);stroke-width:5;stroke-dasharray:1.2 3.2}
.rb-dial .ptr{fill:#fff;filter:drop-shadow(0 0 4px #fff)}.rb-dial .mark{stroke:#fff;stroke-width:2.4;stroke-linecap:round}.rb-dial text{fill:#fff3df;font:600 30px var(--rbd);text-anchor:middle;letter-spacing:.04em;font-variant-numeric:tabular-nums}.rb-dial .hub{fill:#0b0e12;stroke:rgba(255,255,255,.18)}
.sj-track{position:relative;height:calc(34*var(--u));margin:calc(12*var(--u)) 0 calc(4*var(--u))}
.sj-seam{position:absolute;left:0;right:0;top:calc(13*var(--u));height:calc(8*var(--u));border-radius:calc(4*var(--u));background:repeating-linear-gradient(90deg,rgba(255,255,255,.12) 0 1px,transparent 1px calc(15.6*var(--u))),linear-gradient(180deg,rgba(0,0,0,.6),rgba(255,255,255,.1));box-shadow:inset 0 1px 3px rgba(0,0,0,.8)}
.sj-mark{position:absolute;top:0;bottom:0;width:calc(3*var(--u));margin-left:calc(-1.5*var(--u));background:#e9edf2;border-radius:1px;box-shadow:0 0 8px rgba(255,255,255,.6)}.sj-mark::after{content:'';position:absolute;left:calc(-4*var(--u));top:calc(-3*var(--u));width:calc(11*var(--u));height:calc(6*var(--u));border-radius:calc(2*var(--u));background:#c9ced6}
.sj-mark.hot{background:var(--mint);box-shadow:0 0 14px 2px var(--mint)}
.sj-feel{display:flex;align-items:flex-end;gap:calc(3*var(--u));height:calc(16*var(--u))}.sj-feel i{width:calc(5*var(--u));border-radius:1px;background:rgba(255,255,255,.2)}.sj-feel i.on{background:var(--amber)}.sj-feel.max i.on{background:var(--mint);box-shadow:0 0 6px var(--mint)}
.sj-pulse{position:relative;width:calc(86*var(--u));height:calc(6*var(--u));border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}.sj-pulse b{position:absolute;left:58%;width:32%;top:0;bottom:0;background:rgba(143,230,194,.35)}.sj-pulse i{position:absolute;top:0;bottom:0;width:2px;background:#fff;box-shadow:0 0 6px #fff}.sj-pulse.open b{background:rgba(143,230,194,.85)}
.cl-sig{display:flex;justify-content:center;align-items:flex-end;gap:calc(5*var(--u));height:calc(34*var(--u));margin-top:calc(12*var(--u))}.cl-sig i{width:calc(9*var(--u));border-radius:calc(2*var(--u));background:rgba(255,255,255,.16)}.cl-sig i.on{background:var(--cool);box-shadow:0 0 8px rgba(124,198,255,.7)}
.cl-bar{position:relative;height:calc(8*var(--u));margin-top:calc(11*var(--u));border-radius:calc(4*var(--u));background:rgba(255,255,255,.1);overflow:hidden}.cl-bar i{position:absolute;inset:0;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg,rgba(124,198,255,.6),var(--mint))}
.cl-bar::after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 calc(9*var(--u)),rgba(9,12,16,.55) calc(9*var(--u)) calc(10.5*var(--u)))}
.bp-dev{width:calc(214*var(--u));margin:calc(11*var(--u)) auto 0;padding:calc(9*var(--u)) calc(11*var(--u)) calc(11*var(--u));border-radius:calc(13*var(--u));background:linear-gradient(180deg,#22262c,#0e1114);border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 6px 18px rgba(0,0,0,.5)}
.bp-scr{display:flex;justify-content:space-between;align-items:center;height:calc(26*var(--u));padding:0 calc(9*var(--u));border-radius:calc(4*var(--u));background:#061014;border:1px solid rgba(124,198,255,.25);font:600 calc(13*var(--u))/1 ui-monospace,"SF Mono",Menlo,monospace;color:var(--cool);box-shadow:inset 0 0 12px rgba(60,160,220,.25)}
.bp-seq{display:flex;gap:calc(5*var(--u))}.bp-seq i{width:calc(7*var(--u));height:calc(7*var(--u));border-radius:50%;border:1px solid rgba(124,198,255,.6)}.bp-seq i.on{background:var(--cool);box-shadow:0 0 6px var(--cool)}
.bp-pads{display:grid;grid-template-columns:repeat(3,calc(38*var(--u)));grid-template-rows:repeat(2,calc(30*var(--u)));gap:calc(5*var(--u));justify-content:center;margin-top:calc(10*var(--u))}
.bp-pads i{display:flex;align-items:center;justify-content:center;border-radius:calc(6*var(--u));border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.05);font:600 calc(12*var(--u))/1 var(--rbf);font-style:normal;color:rgba(255,255,255,.6);transition:background .08s,box-shadow .08s}
.bp-pads i.lit{background:var(--amber);color:#201206;border-color:#ffe2bd;box-shadow:0 0 16px rgba(255,184,102,.8)}.bp-pads i:nth-child(1){grid-column:2}.bp-pads i:nth-child(2){grid-column:1;grid-row:2}.bp-pads i:nth-child(3){grid-column:2;grid-row:2}.bp-pads i:nth-child(4){grid-column:3;grid-row:2}
.hw-bar{position:relative;height:calc(12*var(--u));margin:calc(12*var(--u)) 0 0;border-radius:calc(3*var(--u));background:repeating-linear-gradient(90deg,rgba(255,255,255,.1) 0 1px,transparent 1px calc(17*var(--u))),rgba(255,255,255,.07)}
.hw-bar b{position:absolute;top:0;bottom:0;border-radius:calc(3*var(--u));background:linear-gradient(180deg,rgba(143,230,194,.95),rgba(88,190,150,.8));box-shadow:0 0 12px rgba(143,230,194,.55)}.hw-bar i{position:absolute;top:calc(-5*var(--u));bottom:calc(-5*var(--u));width:2px;margin-left:-1px;background:#fff;box-shadow:0 0 8px #fff}
.rb-fade{inset:0;background:#000;transition:opacity .16s}
`;
  const ICON = { camera: '<path d="M2 4.5h8.5l1.5 1.2v2.6l-1.5 1.2H2z"/><path d="M12 6l2-.8v3.6l-2-.8"/><path d="M5 9.5V12H3.2M5 12h2.4"/><circle cx="4.5" cy="7" r=".5"/>',
    face: '<path d="M8 2C5.4 2 4 3.9 4 6.3c0 2.9 1.7 6.2 4 6.2s4-3.3 4-6.2C12 3.9 10.6 2 8 2z"/><path d="M4.4 7.9h7.2"/><path d="M6.1 5.9h1M8.9 5.9h1"/>',
    clothes: '<path d="M5.5 2.5L2 4.6l1.3 2.3 1.5-.8v7.4h6.4V6.1l1.5.8L14 4.6l-3.5-2.1c-.4 1-1.3 1.6-2.5 1.6s-2.1-.6-2.5-1.600z"/>',
    weapon: '<path d="M2 4.5h11.5v2.6H8.7l-.5 1.6H6.5l.4 4.3H3.6L3 7.100H2z"/><path d="M8.300 7.300c0 1 .5 1.500 1.4 1.500"/>',
    partner: '<circle cx="5.6" cy="5.400" r="2.100"/><path d="M1.8 13c.3-2.600 1.700-4 3.800-4s3.500 1.400 3.800 4"/><circle cx="11.300" cy="5.900" r="1.600"/><path d="M11.200 9.300c1.700.2 2.800 1.400 3.100 3.400"/>',
    vehicle: '<path d="M1.5 10.500V8.300l1.600-.6 1.500-2.900h6.200l1.900 2.900 1.800.6v2.200z"/><circle cx="4.600" cy="10.800" r="1.300"/><circle cx="11.400" cy="10.800" r="1.300"/><path d="M5.300 7.600h5.700"/>' };
  const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.9 6.1 6.6.9-4.8 4.600 1.200 6.600L12 17.700l-5.900 3.100 1.200-6.600L2.500 9.600l6.600-.9z"/></svg>';
  const UI = { root: null, el: {}, last: {}, tags: new Map(), mgKind: '', subT: 0, fadeT: 0, stars: false,
    mount() { if (this.root || typeof document === 'undefined' || HOOKS.hud === false) return; if (!document.getElementById('rb-css')) { const st = document.createElement('style'); st.id = 'rb-css'; st.textContent = CSS; document.head.appendChild(st); }
      const r = this.root = document.createElement('div'); r.id = 'rb'; this.stars = !!HOOKS.showStars; const gameHud = !!document.getElementById('h-tr');
      r.style.setProperty('--top', HOOKS.hudTop !== undefined ? HOOKS.hudTop : (gameHud ? 86 : 22)); r.style.setProperty('--lb', HOOKS.hudLeftBottom !== undefined ? HOOKS.hudLeftBottom : (gameHud ? 204 : 26));
      r.innerHTML = '<div class="rb-tr">' + (this.stars ? '<div class="rb-stars">' + STAR.repeat(6) + '</div>' : '') + '<div class="rb-ev">' + EV.map(k => '<span class="rb-ic unk" data-k="' + k + '"><svg viewBox="0 0 16 16">' + ICON[k] + '</svg></span>').join('') + '</div><div class="rb-evl"></div><div class="rb-st"></div>' +
        '<div class="rb-nz nz"><span>噪音</span><u><i></i></u></div><div class="rb-nz su"><span>注意</span><u><i></i></u></div></div>' +
        (gameHud && !HOOKS.showTake ? '' : '<div class="rb-take"><span>到手</span><b>$0</b><em></em></div>') +
        '<div class="rb-bc on"><div class="rb-sub"></div><div class="rb-hint"></div><div class="rb-obj"></div></div><div class="rb-ord"><h6>阿烈</h6>' + ['cover', 'register', 'safe'].map((j, i) => '<div data-j="' + j + '"><kbd>' + (i + 1) + '</kbd>' + ORD[j][0] + '<em></em></div>').join('') + '</div>' +
        '<div class="rb-keys"><span data-k="mask"><kbd>G</kbd><b></b></span><span data-k="arm"><kbd>H</kbd><b></b></span><span data-k="aim"><kbd>右键 / J</kbd>瞄准</span></div><div class="rb-pr on"></div><div class="rb-tags on"></div><div class="rb-x"></div><div class="rb-mg"></div><div class="rb-fade"></div>';
      document.body.appendChild(r); const q = s => r.querySelector(s); this.el = { tr: q('.rb-tr'), ev: q('.rb-ev'), evl: q('.rb-evl'), st: q('.rb-st'), nz: q('.rb-nz.nz'), su: q('.rb-nz.su'), take: q('.rb-take'), sub: q('.rb-sub'), hint: q('.rb-hint'), obj: q('.rb-obj'), ord: q('.rb-ord'), keys: q('.rb-keys'), pr: q('.rb-pr'), tags: q('.rb-tags'), x: q('.rb-x'), mg: q('.rb-mg'), fade: q('.rb-fade'), stars: q('.rb-stars') };
      this.ic = {}; for (const e of this.el.ev.children) this.ic[e.dataset.k] = e; },
    set(key, v, fn) { if (this.last[key] === v) return; this.last[key] = v; fn(v); },
    sub(who, text, sec) { if (!this.root || !text) return; this.el.sub.innerHTML = (who ? '<span class="who">' + who + '</span>' : '') + '<span class="txt">' + text + '</span>'; this.el.sub.classList.add('on'); this.subT = sec || (1.6 + text.length * .12); },
    fade(sec) { if (!this.root) return; this.fadeT = sec; this.el.fade.style.opacity = 1; },
    setStars(n) { if (!this.el.stars) return; const c = this.el.stars.children; for (let i = 0; i < c.length; i++) c[i].classList.toggle('on', i < n); },
    render(dt) { const E = this.el; if (!this.root) return; const set = this.set.bind(this);
      const active = S.inStore || S.near || S.started || !!S.mg || !!TH.clone || !!TH.near || TH.alarmLeft !== null, showEv = S.started || S.done || logged() > 0 || EV.some(k => state.evidence[k] !== 'unknown') || (S.inStore && (S.masked || S.armed || S.cased));
      if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) E.sub.classList.remove('on'); } if (this.fadeT > 0) { this.fadeT -= dt; if (this.fadeT <= 0) E.fade.style.opacity = 0; }
      set('tr', showEv || !!TH.clone || TH.alarmLeft !== null || this.stars, v => E.tr.classList.toggle('on', v));
      for (const k of EV) set('ev' + k, state.evidence[k], v => { const e = this.ic[k]; e.className = 'rb-ic ' + (v === 'logged' ? 'log' : v === 'cleared' ? 'clr' : 'unk') + ' pulse'; });
      const le = S.lastEv && S.t - S.lastEvT < 5 ? S.lastEv : null; set('evl', le ? le.kind + le.state : '', () => { E.evl.innerHTML = le ? EVN[le.kind] + ' · <b class="' + (le.state === 'cleared' ? 'c' : '') + '">' + (le.state === 'logged' ? '在案' + srcName(le.why) : '已抹掉') + '</b>' : ''; });
      let st = '', cls = ''; if (S.arrived && !S.done) { st = '警察到场'; cls = 'hot'; } else if (S.alarm && S.alarmKnown && !S.done) { st = ({ loud: '警铃大作', silent: '静默警报', call: '有人报警' })[S.alarm] + '<b>' + mmss(S.clock) + '</b>'; cls = S.clock < 15 ? 'hot' : 'warn'; }
      else if (TH.alarmLeft !== null) { st = '车辆警报 · 有人回头前<b>' + mmss(Math.max(0, TH.alarmLeft)) + '</b>'; cls = 'hot'; } else if (S.started && !S.done) { st = '还没人报警'; }
      else if (S.done) st = S.result === 'clean' ? '干净脱身' : S.result === 'aborted' ? '收手了' : '带着热度离开';
      set('st', st + cls, () => { E.st.innerHTML = st; E.st.className = 'rb-st ' + cls; });
      set('nzOn', (S.started && !S.done) || S.noise > .05 || !!S.mg, v => E.nz.style.display = v ? '' : 'none'); set('nz', Math.round(S.noise * 50), v => E.nz.querySelector('i').style.transform = 'scaleX(' + v / 50 + ')');
      const su = TH.clone ? TH.clone.susp : TH.susp; set('suOn', su > .03 || !!(S.mg && S.mg.car), v => E.su.style.display = v ? '' : 'none'); set('su', Math.round(su * 50), v => E.su.querySelector('i').style.transform = 'scaleX(' + v / 50 + ')');
      if (E.take) { set('takeOn', S.started || S.take > 0, v => E.take.classList.toggle('on', v)); set('take', S.take, v => E.take.children[1].textContent = money(v)); const rem = remaining().reduce((a, b) => a + b[1], 0); set('rem', S.started && !S.done ? rem : -1, v => E.take.children[2].textContent = v > 0 ? '店里还有 ' + money(v) : ''); }
      set('hint', S.hint, v => { if (v) E.hint.textContent = v; E.hint.classList.toggle('on', !!v); });
      set('obj', S.obj, v => { E.obj.textContent = v; }); set('objHot', (S.alarm && S.alarmKnown) || S.risk > .62, v => E.obj.classList.toggle('hot', !!v));
      // partner orders
      set('ordOn', P2.on && (S.inStore || S.near) && !S.done && !S.mg, v => E.ord.classList.toggle('on', v));
      if (P2.on) for (const d of E.ord.children) { const j = d.dataset.j; if (!j) continue; const dn = (j === 'register' && S.loot.reg.done) || (j === 'safe' && S.loot.safe.done), cur = P2.job === j;
          set('o' + j, (cur ? 'cur' : '') + (dn ? ' dn' : '') + (cur ? (P2.arrived ? (j === 'safe' ? S.loot.safe.n + '/3' : j === 'register' ? Math.round(S.loot.reg.p * 100) + '%' : '在位') : '过去中') : ''), () => { d.className = (cur ? 'cur' : '') + (dn ? ' dn' : ''); d.lastChild.textContent = cur ? (P2.arrived ? (j === 'safe' ? '第 ' + Math.min(3, S.loot.safe.n + 1) + ' 层' : j === 'register' ? Math.round(S.loot.reg.p * 100) + '%' : '在位') : '过去中') : ''; }); }
      set('keysOn', (S.inStore || S.near) && !S.done && !S.mg && !S.office, v => E.keys.classList.toggle('on', v));
      set('kMask', S.masked, v => { const e = E.keys.children[0]; e.lastChild.textContent = v ? '面罩 · 戴着' : '面罩 · 没戴'; e.classList.toggle('act', v); }); set('kArm', S.armed, v => { const e = E.keys.children[1]; e.lastChild.textContent = v ? '家伙 · 亮着' : '家伙 · 收着'; e.classList.toggle('act', v); }); set('kAim', S.aiming, v => E.keys.children[2].classList.toggle('act', v));
      // prompts
      const sig = PROMPTS.map(p => p.key + p.label + (p.dim ? 'd' : '')).join('|'); set('prUp', actMode, v => E.pr.classList.toggle('up', v));
      set('pr', sig, () => { E.pr.innerHTML = PROMPTS.map(p => '<div class="rb-p' + (p.dim ? ' dim' : '') + '"><span class="k">' + p.key + '</span><span>' + p.label + '</span><u><i></i></u></div>').join(''); });
      for (let i = 0; i < PROMPTS.length && i < E.pr.children.length; i++) { const d = E.pr.children[i], p = PROMPTS[i].p; d.classList.toggle('h', p > 0); if (p > 0) d.lastChild.firstChild.style.transform = 'scaleX(' + Math.min(1, p).toFixed(3) + ')'; }
      set('x', S.aiming && !(CTX.ctl && CTX.ctl.takeover), v => E.x.classList.toggle('on', v));
      this.renderTags(); this.renderMG();
    },
    renderTags() { const cam = CTX.camera || HOOKS.camera, live = new Set(), W = window.innerWidth, H = window.innerHeight;
      if (S.started && !S.done && !S.office && !(S.mg && S.mg.car !== undefined)) for (const p of C.people) { if (!p.present || p.fled) continue; let x, y;
        if (cam && cam.isCamera && T) { const v = UI._v || (UI._v = new T.Vector3()); v.set(p.x, PT.floorY + (p.anim === 'crouch' ? 1.15 : p.anim === 'handsup' ? 2.0 : 1.8), p.z).project(cam); if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue; if (!p.vis && p.d > 3) continue; x = (v.x * .5 + .5) * W; y = (-v.y * .5 + .5) * H; }
        else { if (S.target !== p) continue; x = W / 2; y = H * .36; }
        let t = this.tags.get(p); if (!t) { t = document.createElement('div'); t.className = 'rb-tag'; t.innerHTML = '<b></b><u class="f"><i></i></u><u class="c"><i></i></u><em></em>'; t.firstChild.textContent = p.name; this.el.tags.appendChild(t); this.tags.set(p, t); }
        live.add(p); t.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) translate(-50%,-100%)'; t.children[1].firstChild.style.transform = 'scaleX(' + p.fear.toFixed(2) + ')'; t.children[2].firstChild.style.transform = 'scaleX(' + p.comply.toFixed(2) + ')';
        const warn = p.role === 'clerk' && p.reach > .55 && !p.pressed, txt = warn ? '手在往下摸' : p.mode === 'down' ? '吓瘫了' : p.mode === 'sneak' ? '在往门口挪' : p.phone > .1 ? '在掏手机' : p.bagging ? '在装钱' : p.panic > .6 ? '快崩溃了' : '';
        if (t._txt !== txt) { t._txt = txt; t.lastChild.textContent = txt; } t.classList.toggle('warn', warn || p.mode === 'sneak' || p.phone > .1); t.classList.toggle('cov', p.cover > .5); }
      for (const [p, t] of this.tags) if (!live.has(p)) { t.remove(); this.tags.delete(p); } },
    renderMG() { const E = this.el.mg, mg = S.mg, kind = mg ? mg.kind : TH.clone ? 'cloner' : ''; this.set('mgOn', !!kind, v => E.classList.toggle('on', v));
      if (kind !== this.mgKind) { this.mgKind = kind; if (!kind) return;
        const tip = t => '<div class="rb-tip">' + t + '</div>', pips = (n, c) => '<div class="rb-pips ' + (c || '') + '">' + '<i></i>'.repeat(n) + '</div>';
        E.innerHTML = kind === 'safe' ? '<div class="rb-mt">保险柜 · 第 <b>1</b>/3 层</div><svg class="rb-dial" viewBox="-104 -104 208 208"><circle r="88" class="ring"/><circle r="88" class="tick"/><circle r="88" class="tick2"/><path class="zone"/><g class="rot"><circle r="70" class="knob"/><circle r="64" class="knurl"/><line class="mark" y1="-68" y2="-52"/></g><circle r="34" class="hub"/><text y="11">00</text><path class="ptr" d="M0 -78L6.500 -101L-6.500 -101z"/></svg>' + pips(3) + tip('<kbd>E</kbd> 指针进绿区时落栓　<kbd>Q</kbd> 收手<span class="sh">手在抖</span>')
          : kind === 'slimjim' ? '<div class="rb-mt">撬锁 · <b>' + SECN.old + '</b></div><div class="sj-track"><div class="sj-seam"></div><div class="sj-mark"></div></div><div class="rb-row"><span>手感</span><div class="sj-feel">' + [4, 6, 8, 10, 12, 14, 16].map(h => '<i style="height:calc(' + h + '*var(--u))"></i>').join('') + '</div><span>卡口</span><div class="sj-pulse"><b></b><i></i></div></div>' + pips(3, 'bad') + tip('<kbd>A</kbd><kbd>D</kbd> 沿门缝探　手感最强、卡口亮起时 <kbd>E</kbd> 上提　<kbd>Q</kbd> 收手')
          : kind === 'cloner' ? '<div class="rb-mt">钥匙克隆器 · <b></b></div><div class="cl-sig">' + [8, 14, 20, 27, 34].map(h => '<i style="height:calc(' + h + '*var(--u))"></i>').join('') + '</div><div class="cl-bar"><i></i></div><div class="rb-row"><span>被注意</span><u><i></i></u></div>' + tip('离车主越近越快　别站在他视线里　<kbd>Q</kbd> 收起')
          : kind === 'bypass' ? '<div class="rb-mt">防盗芯片 · 第 <b>1</b>/3 轮</div><div class="bp-dev"><div class="bp-scr"><span class="bp-seq"></span><span class="bp-time">0:24</span></div><div class="bp-pads"><i>W</i><i>A</i><i>S</i><i>D</i></div></div><div class="rb-row"><span>防拆</span><u><i></i></u></div>' + tip('记住亮灯顺序，再用 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 重复　<kbd>Q</kbd> 放弃')
          : '<div class="rb-mt">接线点火</div><div class="hw-bar"><b></b><i></i></div>' + pips(mg.need) + tip('<kbd>E</kbd> 指针进绿区时搭线　<kbd>Q</kbd> 放弃'); this.mq = {}; }
      if (!kind) return; const q = s => this.mq[s] || (this.mq[s] = E.querySelector(s)), flash = mg ? mg.flash : 0; E.classList.toggle('good', flash > .3); E.classList.toggle('bad', flash < -.3);
      if (kind === 'safe') { const n = S.loot.safe.n, z = mg.zone, pt = a => (88 * Math.sin(a * TAU)).toFixed(2) + ' ' + (-88 * Math.cos(a * TAU)).toFixed(2); q('.rb-mt b').textContent = Math.min(3, n + 1); q('.zone').setAttribute('d', 'M' + pt(z.c - z.w / 2) + 'A88 88 0 0 1 ' + pt(z.c + z.w / 2));
        q('.ptr').setAttribute('transform', 'rotate(' + (mg.shown * 360).toFixed(1) + ')'); q('.rot').setAttribute('transform', 'rotate(' + (mg.shown * 360).toFixed(1) + ')'); q('text').textContent = ('0' + Math.floor(mg.shown * 100)).slice(-2); const pp = q('.rb-pips').children; for (let i = 0; i < 3; i++) pp[i].classList.toggle('on', i < n); q('.sh').classList.toggle('on', mg.tens > .35); }
      else if (kind === 'slimjim') { const m = q('.sj-mark'); m.style.left = (mg.pos * 100).toFixed(2) + '%'; m.style.transform = 'translateX(' + (Math.sin(mg.t * 41) * mg.feel * 1.6).toFixed(2) + 'px)'; m.classList.toggle('hot', mg.feel > .6 && mg.open); const f = q('.sj-feel'), n = Math.round(mg.feel * 7); for (let i = 0; i < 7; i++) f.children[i].classList.toggle('on', i < n); f.classList.toggle('max', mg.feel > .6);
        const pu = q('.sj-pulse'); pu.lastChild.style.left = (mg.pulse * 100).toFixed(1) + '%'; pu.classList.toggle('open', mg.open); const pp = q('.rb-pips').children; for (let i = 0; i < 3; i++) pp[i].classList.toggle('on', i < mg.rec.fumbles); }
      else if (kind === 'cloner') { const cl = TH.clone; q('.rb-mt b').textContent = cl.src === 'owner' ? '信号源：车主口袋里的钥匙' : '信号源：车门把手'; const n = Math.ceil(cl.sig * 5 - .001), b = q('.cl-sig').children; for (let i = 0; i < 5; i++) b[i].classList.toggle('on', i < n); q('.cl-bar i').style.transform = 'scaleX(' + cl.p.toFixed(3) + ')'; q('.rb-row u i').style.transform = 'scaleX(' + cl.susp.toFixed(2) + ')'; }
      else if (kind === 'bypass') { q('.rb-mt b').textContent = Math.min(3, mg.round + 1); const sq = q('.bp-seq'); if (sq.children.length !== mg.seq.length) sq.innerHTML = '<i></i>'.repeat(mg.seq.length); const k = mg.phase === 'show' ? Math.floor(mg.show + 1) : mg.inp; for (let i = 0; i < sq.children.length; i++) sq.children[i].classList.toggle('on', i < k);
        q('.bp-time').textContent = (mg.phase === 'show' ? '看 ' : '按 ') + mmss(Math.max(0, mg.left)); const pd = q('.bp-pads').children, map = [0, 3, 2, 1]; for (let i = 0; i < 4; i++) pd[i].classList.toggle('lit', mg.lit === map[i]); q('.rb-row u i').style.transform = 'scaleX(' + mg.tamper.toFixed(2) + ')'; }
      else if (kind === 'hotwire') { const z = q('.hw-bar b'); z.style.left = ((mg.zone.c - mg.zone.w / 2) * 100).toFixed(1) + '%'; z.style.width = (mg.zone.w * 100).toFixed(1) + '%'; q('.hw-bar i').style.left = (mg.p * 100).toFixed(1) + '%'; const pp = q('.rb-pips').children; for (let i = 0; i < pp.length; i++) pp[i].classList.toggle('on', i < mg.stage); }
    } };
  function srcName(s) { s = String(s || ''); return s === 'tape' ? '（监控录像）' : s.indexOf('clerk') === 0 ? '（店员）' : s.indexOf('customer') === 0 ? '（顾客）' : s.indexOf('out') === 0 ? '（店外目击者）' : s.indexOf('owner') === 0 ? '（车主）' : s.indexOf('broken') === 0 ? '（碎车窗）' : s.indexOf('alarm') === 0 || s.indexOf('passer') === 0 ? '（路人）' : s.indexOf('tracker') === 0 ? '（车载定位）' : ''; }

  /* ================================================================== 3D: figures, props, the back office set */
  const FIGMAP = { use: 'talk', carry: 'carry_run', sprint: 'run', crouch_walk: 'crouch', fall: 'crouch', cheer: 'wave', lean: 'idle', enter_car: 'crouch', exit_car: 'crouch', pet: 'crouch' };
  /** one adapter over GT.hero / GT.people / a kit capsule: { group, upd(dt, state, speed), bone(name), hero? } */
  function mkFig(kind, o) { o = o || {};
    if ((kind === 'kai' || kind === 'lie') && GT.hero && GT.hero.make) { try { const h = GT.hero.make(kind, o); if (kind === 'lie' && h.setMask) h.setMask(o.mask !== false); let last = '', t = 0;
        return { group: h.group, hero: h, kind, bone: n => (h.bones && h.bones[n]) || null, upd(dt, st, sp) { if (st !== last) { last = st; t = 0; } t += dt; h.update(dt, { state: st, speed: sp || 0, turn: 0, lookYaw: 0, lookPitch: 0, t, aimPitch: 0 }); } }; } catch (e) { console.warn('[robbery] hero.make', e); } }
    const pk = kind === 'kai' ? 'ped' : kind === 'lie' ? 'partner' : kind, po = kind === 'kai' ? Object.assign({ type: 'skater', seed: 11, phone: false }, o) : o;
    if (GT.people && GT.people.make) { try { const f = GT.people.make(pk, po), st8 = GT.people.states || []; return { group: f.group, people: f, kind, bone: n => (f.bones && f.bones.find && f.bones.find(b => b && b.name === n)) || null, upd(dt, st, sp) { st = st8.indexOf(st) >= 0 ? st : (FIGMAP[st] || 'idle'); f.update(dt, { state: st, speed: sp || 0 }); } }; } catch (e) { console.warn('[robbery] people.make', e); } }
    const g = new T.Group(), k = GT.kit(), col = { clerk: 0x2c5a55, partner: 0x26282c, lie: 0x26282c, kai: 0x5d6a78 }[kind] || 0x7a7468; k.box(GT.mat('fabric_dark', { color: col }), .44, .6, .24, 0, 1.2, 0, { bevel: .08 }); k.sphere(GT.mat('plastic_grey', { color: 0xb98a6a, rough: .8 }), .11, 0, 1.64, 0); k.box(GT.mat('fabric_dark', { color: 0x2b2f3a }), .34, .9, .2, 0, .45, 0, { bevel: .06 }); g.add(k.build());
    return { group: g, kind, bone: () => null, upd(dt, st) { g.children[0].scale.y = st === 'crouch' ? .62 : 1; } }; }
  const _v1 = T ? new T.Vector3() : null, _v2 = T ? new T.Vector3() : null, _q1 = T ? new T.Quaternion() : null, _m1 = T ? new T.Matrix4() : null, _up = T ? new T.Vector3(0, 1, 0) : null;
  /** put a prop in a figure's right hand: grip at the hand, +Z along heading h (works for any rig, like combat.js does) */
  function inHand(obj, fig, h, drop, fwd) { const hb = fig && fig.bone('handR'); if (!hb) return false; fig.group.updateMatrixWorld(true); hb.getWorldPosition(_v1); const fb = hb.parent; if (fb && fb.isBone) { fb.getWorldPosition(_v2); _v2.subVectors(_v1, _v2).normalize(); _v1.addScaledVector(_v2, fwd === undefined ? .07 : fwd); }
    obj.position.copy(_v1); obj.position.y += drop || 0; obj.rotation.set(0, h, 0); return true; }
  function crackTex() { const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d'), r = GT.rng('rb:crack'), cx = 250, cy = 150; g.lineCap = 'round';
    const ray = []; for (let i = 0; i < 19; i++) { const a = i / 19 * TAU + (r() - .5) * .25, len = 90 + r() * 330, pts = [[cx, cy]]; let x = cx, y = cy, aa = a; for (let s = 0; s < 7; s++) { aa += (r() - .5) * .22; x += Math.cos(aa) * len / 7; y += Math.sin(aa) * len / 7 * .8; pts.push([x, y]); } ray.push(pts); }
    for (let i = 0; i < ray.length; i++) { const a = ray[i], b = ray[(i + 1) % ray.length]; for (let s = 1; s < 5; s++) { if (r() < .25) continue; g.fillStyle = 'rgba(235,245,250,' + (.04 + r() * .1) + ')'; g.beginPath(); g.moveTo(a[s - 1][0], a[s - 1][1]); g.lineTo(a[s][0], a[s][1]); g.lineTo(b[s][0], b[s][1]); g.lineTo(b[s - 1][0], b[s - 1][1]); g.closePath(); g.fill(); g.strokeStyle = 'rgba(245,250,255,' + (.35 + r() * .4) + ')'; g.lineWidth = .8 + r(); g.beginPath(); g.moveTo(a[s][0], a[s][1]); g.lineTo(b[s][0], b[s][1]); g.stroke(); } }
    for (const p of ray) { g.strokeStyle = 'rgba(250,253,255,.85)'; g.lineWidth = 1.1 + r() * 1.2; g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (const q of p) g.lineTo(q[0], q[1]); g.stroke(); }
    g.fillStyle = 'rgba(6,8,10,.93)'; g.beginPath(); for (let i = 0; i < 13; i++) { const a = i / 13 * TAU, rr = 26 + r() * 30; g.lineTo(cx + Math.cos(a) * rr * 1.3, cy + Math.sin(a) * rr); } g.closePath(); g.fill(); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; g.stroke();
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; }
  function cctvDraw(V, mode, p) { const g = V.g, w = 256, h = 160; g.fillStyle = '#05080a'; g.fillRect(0, 0, w, h);
    if (mode === 'rec' || mode === 'wipe') { const r = GT.rng('rb:cctv'); for (let q = 0; q < 4; q++) { const x0 = (q % 2) * 128 + 2, y0 = (q >> 1) * 80 + 2; g.fillStyle = ['#26302f', '#2b3330', '#232b2e', '#2d2f2a'][q]; g.fillRect(x0, y0, 124, 76);
          g.fillStyle = 'rgba(190,205,195,.18)'; for (let i = 0; i < 6; i++) g.fillRect(x0 + r() * 100, y0 + 20 + r() * 50, 8 + r() * 30, 3 + r() * 14); g.strokeStyle = 'rgba(200,215,205,.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0 + 52 + q * 4); g.lineTo(x0 + 124, y0 + 30 + q * 6); g.stroke(); g.beginPath(); g.moveTo(x0 + 30, y0 + 76); g.lineTo(x0 + 70 + q * 8, y0 + 18); g.stroke();
          g.fillStyle = 'rgba(225,235,225,.75)'; g.font = '7px ui-monospace,Menlo,monospace'; g.fillText('CAM ' + (q + 1) + (q === 0 ? ' 收银台' : q === 1 ? ' 入口' : q === 2 ? ' 货架' : ' 后门'), x0 + 4, y0 + 10); g.fillText('18:1' + q + ':0' + (q * 2 + 1), x0 + 84, y0 + 72); }
      g.fillStyle = '#e23a2a'; g.beginPath(); g.arc(238, 12, 4, 0, TAU); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 8px ui-monospace,Menlo,monospace'; g.fillText('REC', 212, 15);
      if (mode === 'wipe') { g.fillStyle = 'rgba(4,8,10,.86)'; g.fillRect(28, 52, 200, 56); g.strokeStyle = '#8fe6c2'; g.strokeRect(28.5, 52.5, 199, 55); g.fillStyle = '#cfeee0'; g.font = 'bold 11px "PingFang SC",sans-serif'; g.fillText('正在格式化硬盘…  ' + Math.round(p * 100) + '%', 40, 74); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(40, 84, 176, 9); g.fillStyle = '#8fe6c2'; g.fillRect(40, 84, 176 * p, 9); } }
    else { g.fillStyle = '#0a1a2c'; g.fillRect(0, 0, w, h); g.fillStyle = '#9fc2e6'; g.font = 'bold 15px ui-monospace,Menlo,monospace'; g.textAlign = 'center'; g.fillText('NO DISK', 128, 70); g.font = '10px "PingFang SC",sans-serif'; g.fillText('硬盘已格式化 · 无录像', 128, 92); g.textAlign = 'left'; }
    for (let y = 0; y < h; y += 2) { g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(0, y, w, 1); } V.tex.needsUpdate = true; }
  function buildOffice(grp) { const O = PT.office, k = GT.kit(), r = GT.rng('rb:office'), x0 = O.x0, x1 = O.x1, z0 = O.z0, z1 = O.z1, y0 = O.y, y1 = O.top, xm = (x0 + x1) / 2, zm = (z0 + z1) / 2, W = x1 - x0, D = z1 - z0, H = y1 - y0;
    const M = n => GT.mat(n), card = GT.mat('wood_painted', { color: 0xa98a5e, rough: .92 }), card2 = GT.mat('wood_painted', { color: 0x8f7450, rough: .95 }), paper = GT.mat('plastic_white', { color: 0xe8e4d6, rough: .9 }), blk = M('plastic_black'), galv = M('metal_galv'), dark = M('metal_dark');
    const lockerM = GT.mat('metal_painted_blue', { color: 0x4a5e6a }), deskM = GT.mat('wood_plank', { color: 0x7b5b3c }), wallM = GT.mat('cinderblock', { color: 0xb9b6a8 }), doorM = GT.mat('metal_painted_white', { color: 0x9a9e9c }), crate = GT.mat('plastic_red', { color: 0x9c2a26 }), crateB = GT.mat('metal_painted_blue', { color: 0x2c4e86 });
    // shell
    k.box('concrete_stained', W + .26, .12, D + .4, xm + .07, y0 - .06, zm); k.box('concrete', W + .26, .14, D + .4, xm + .07, y1 + .07, zm);
    k.box(wallM, .06, H, D + .4, x0 - .03, y0 + H / 2, zm); k.box(wallM, .2, H, D + .4, x1 + .1, y0 + H / 2, zm); k.box(wallM, W + .06, H, .2, xm - .03, y0 + H / 2, z0 - .1); k.box(wallM, W + .06, H, .2, xm - .03, y0 + H / 2, z1 + .1);
    k.box(GT.mat('cinderblock', { color: 0x6f7a78 }), .012, 1.05, D, x0 + .006, y0 + .525, zm); k.box(GT.mat('cinderblock', { color: 0x6f7a78 }), .012, 1.05, D, x1 - .006, y0 + .525, zm); k.box(GT.mat('cinderblock', { color: 0x6f7a78 }), W, 1.05, .012, xm, y0 + .525, z0 + .006); k.box(GT.mat('cinderblock', { color: 0x6f7a78 }), W, 1.05, .012, xm, y0 + .525, z1 - .006);   // two-tone dado
    for (const [zz, s] of [[z0 + .016, 1], [z1 - .016, -1]]) k.box(blk, W, .1, .02, xm, y0 + .05, zz, { bevel: .004 });
    // staff door (inside face, west wall) + back exit (east wall) with push bar
    k.push(x0, y0, PT.staff.z, {}); k.box(M('aluminium_brushed'), .05, 2.14, .06, .03, 1.07, -.56, { bevel: .006 }); k.box(M('aluminium_brushed'), .05, 2.14, .06, .03, 1.07, .56, { bevel: .006 }); k.box(M('aluminium_brushed'), .05, .06, 1.18, .03, 2.14, 0, { bevel: .006 }); k.box(doorM, .04, 2.08, 1.06, .028, 1.05, 0, { bevel: .008 }); k.box(M('aluminium_brushed'), .008, .26, .9, .052, .2, 0);
    k.cyl('chrome', .022, .022, .07, .08, 1.02, -.4, { seg: 10, rz: HP }); k.box('chrome', .012, .14, .05, .054, 1.02, -.4, { bevel: .003 }); k.box(blk, .012, .12, .02, .06, 1.5, .3); k.box(GT.mat('fabric_dark', { color: 0x23262c }), .05, .62, .3, .085, 1.2, .3, { bevel: .02 }); k.pop();
    k.push(x1, y0, O.exit.z, {}); k.box(galv, .05, 2.2, .08, -.03, 1.1, -.58, { bevel: .006 }); k.box(galv, .05, 2.2, .08, -.03, 1.1, .58, { bevel: .006 }); k.box(galv, .05, .08, 1.24, -.03, 2.2, 0, { bevel: .006 }); k.box(doorM, .04, 2.12, 1.08, -.028, 1.08, 0, { bevel: .008 });
    k.box(blk, .05, .09, .94, -.075, 1.02, 0, { bevel: .012 }); k.cyl('chrome', .016, .016, .86, -.115, 1.02, 0, { seg: 8, rx: HP }); for (const s of [-1, 1]) k.box('chrome', .05, .04, .03, -.09, 1.02, s * .41, { bevel: .004 }); k.box(galv, .01, .3, .9, -.052, .2, 0);
    k.box(dark, .05, .2, .42, -.04, 2.46, 0, { bevel: .008 }); k.geo(GT.signMat ? GT.signMat('EXIT', { style: 'lcd', color: '#3cff7a', w: 256, h: 96 }) : GT.mat('neon_green'), new T.PlaneGeometry(.34, .13), { x: -.068, y: 2.46, z: 0, ry: -HP });
    k.cyl(M('metal_painted_red'), .065, .065, .42, -.1, 1.0, .95, { seg: 12 }); k.sphere(M('metal_painted_red'), .065, -.1, 1.21, .95, { seg: 10, seg2: 6 }); k.cyl(blk, .02, .02, .08, -.1, 1.29, .95, { seg: 8 }); k.box(galv, .03, .03, .16, -.02, 1.05, .95); k.quad(GT.decalMat('rust_run'), .5, 1.1, -.012, 1.0, -.3, { ry: -HP }); k.pop();
    // desk along the south wall: recorder stack, monitor, keyboard, lamp, clutter
    const dx = 58.55, dz = z0 + .42, dt_ = y0 + .76; k.push(dx, y0, dz, {});
    k.box(deskM, 2.1, .04, .78, 0, .76, 0, { bevel: .008 }); k.box(dark, 2.0, .05, .04, 0, .715, .34); for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(dark, .04, .74, .04, sx * 1.0, .37, sz * .34, { bevel: .005 });
    k.box(GT.mat('metal_painted_white', { color: 0x8a8f8c }), .44, .6, .66, .76, .42, 0, { bevel: .01 }); for (let i = 0; i < 3; i++) { k.box(GT.mat('metal_painted_white', { color: 0x7a7f7c }), .4, .17, .012, .76, .21 + i * .19, .336, { bevel: .004 }); k.box('chrome', .12, .012, .014, .76, .26 + i * .19, .346); }
    // DVR + switch
    k.box(GT.mat('aluminium_brushed', { color: 0x5a5e63 }), .44, .045, .26, -.42, .805, -.12, { bevel: .004 }); for (let i = 0; i < 12; i++) k.box(i % 5 === 3 ? 'neon_amber' : 'neon_green', .006, .006, .004, -.6 + i * .026, .81, .012); for (let i = 0; i < 6; i++) k.box(blk, .016, .014, .01, -.36 + i * .024, .805, .012);
    k.box(blk, .44, .09, .3, -.42, .875, -.11, { bevel: .006 }); k.box(GT.mat('plastic_grey', { color: 0x2a2d31 }), .42, .07, .006, -.42, .875, .043); k.box(GT.mat('emissive_screen'), .09, .028, .004, -.54, .885, .048); for (let i = 0; i < 4; i++) k.box(GT.mat('plastic_grey', { color: 0x3a3e44 }), .05, .018, .006, -.4 + i * .06, .862, .048, { bevel: .002 }); k.cyl(GT.mat('plastic_grey', { color: 0x3a3e44 }), .017, .017, .008, -.255, .876, .05, { seg: 14, rx: HP });
    k.box(paper, .1, .03, .003, -.42, .9, .046); k.box(GT.mat('plastic_grey', { color: 0x1b1d20 }), .3, .012, .2, -.42, .925, -.11);
    const cab = [[-.58, .86, -.26], [-.6, .95, -.33], [-.64, 1.3, -.385], [-.64, 2.0, -.39]]; for (let i = 0; i < 5; i++) k.tube(i % 2 ? GT.mat('plastic_black') : GT.mat('plastic_grey', { color: [0x2f5d8a, 0x8a8f96, 0xb8b23a][i % 3] }), cab.map((p, j) => [p[0] + i * .022 + (j === 1 ? (r() - .5) * .03 : 0), p[1] + (j === 0 ? -.05 : 0), p[2] - (j > 1 ? i * .003 : 0)]), .0045, { seg: 5 });
    k.box(galv, .16, .9, .03, -.6, 2.0, -.4, { bevel: .004 }); for (const yy of [1.36, 1.7]) k.box(blk, .2, .012, .012, -.6, yy, -.385);
    // monitor
    k.box(blk, .26, .014, .2, .26, .787, -.14, { bevel: .005 }); k.box(blk, .05, .16, .03, .26, .87, -.2, { bevel: .006 }); k.box(blk, .62, .4, .035, .26, 1.12, -.19, { bevel: .01, rx: -.08 }); k.box(GT.mat('plastic_grey', { color: 0x202326 }), .02, .012, .006, .53, .945, -.158);
    // keyboard, mouse, mug, papers, clipboard, pen, phone base
    k.box(GT.mat('plastic_grey', { color: 0x2b2e32 }), .42, .018, .14, .2, .789, .12, { bevel: .005, ry: .06 }); for (let rw = 0; rw < 4; rw++) for (let c = 0; c < 13; c++) k.box(GT.mat('plastic_grey', { color: 0x16181b }), .024, .008, .022, .015 + c * .0305 + rw * .004, .802, .073 + rw * .03, { ry: .06 });
    k.box(GT.mat('plastic_grey', { color: 0x202326 }), .06, .03, .1, .54, .795, .16, { bevel: .014, ry: -.2 }); k.box(GT.mat('rubber'), .22, .004, .19, .55, .782, .16);
    k.cyl(GT.mat('plastic_white', { color: 0xd9d4c4 }), .04, .035, .09, -.36, .825, .22, { seg: 14 }); k.cyl(GT.mat('plastic_black', { color: 0x2a1a10 }), .034, .034, .004, -.36, .862, .22, { seg: 12 }); k.geo(GT.mat('plastic_white', { color: 0xd9d4c4 }), new T.TorusGeometry(.026, .007, 6, 12, PI), { x: -.4, y: .825, z: .22, rz: HP });
    for (let i = 0; i < 6; i++) k.box(paper, .21, .0016, .297, .78 + (r() - .5) * .08, .782 + i * .0017, .1 + (r() - .5) * .06, { ry: (r() - .5) * .5 }); k.box(GT.mat('wood_plank', { color: 0x6a4a2c }), .23, .006, .32, -.82, .796, .16, { ry: .3 }); k.box(paper, .2, .002, .28, -.82, .8, .16, { ry: .3 }); k.box('chrome', .1, .012, .03, -.85, .806, .03, { ry: .3 }); k.cyl(GT.mat('metal_painted_blue'), .005, .005, .14, -.74, .802, .12, { seg: 6, rz: HP, ry: .9 });
    // desk lamp
    k.cyl(dark, .075, .085, .02, .92, .79, -.24, { seg: 16 }); k.tube(dark, [[.92, .8, -.24], [.9, 1.05, -.27], [.8, 1.25, -.22], [.7, 1.24, -.14]], .009, { seg: 6 }); k.cyl(dark, .05, .09, .12, .66, 1.2, -.11, { seg: 14, rx: .7, rz: .5 }); k.sphere('light_warm', .03, .645, 1.175, -.095, { seg: 8, seg2: 6 });
    k.pop();
    // wall above the desk: cork board, key cabinet, clock, schedule
    k.box(GT.mat('wood_plank', { color: 0x9a7a52, rough: .95 }), 1.3, .8, .02, 59.6, y0 + 1.75, z0 + .012, { bevel: .004 }); for (const s of [[-.66, 0, .03, .84], [.66, 0, .03, .84], [0, .41, 1.34, .03], [0, -.41, 1.34, .03]]) k.box(galv, s[2], s[3], .03, 59.6 + s[0], y0 + 1.75 + s[1], z0 + .016, { bevel: .003 });
    for (let i = 0; i < 9; i++) { const px = 59.1 + (i % 4) * .3 + (r() - .5) * .06, py = y0 + 1.52 + ((i / 4) | 0) * .24 + (r() - .5) * .05; k.box(i % 4 === 1 ? GT.mat('plastic_white', { color: 0xe6d67a, rough: .9 }) : i % 5 === 2 ? GT.mat('plastic_white', { color: 0xd98a8a, rough: .9 }) : paper, .16 + r() * .08, .2, .002, px, py, z0 + .025, { rz: (r() - .5) * .2 }); k.sphere(GT.mat('plastic_red'), .007, px, py + .085, z0 + .03, { seg: 6, seg2: 4 }); }
    k.geo(GT.signMat ? GT.signMat('排班表  早班 06–14  中班 14–19  晚班 19–03', { style: 'painted', color: '#20242a', bg: '#e9e5d6', w: 1024, h: 256, distress: .2 }) : paper, new T.PlaneGeometry(.52, .13), { x: 59.75, y: y0 + 2.04, z: z0 + .027 });
    k.box(galv, .34, .44, .08, 57.75, y0 + 1.62, z0 + .04, { bevel: .006 }); k.box(GT.mat('metal_galv', { color: 0x8f959a }), .3, .4, .012, 57.83, y0 + 1.62, z0 + .1, { ry: -.5 }); for (let i = 0; i < 8; i++) { k.cyl('chrome', .003, .003, .014, 57.63 + (i % 4) * .06, y0 + 1.74 - ((i / 4) | 0) * .16, z0 + .083, { seg: 5, rx: HP }); k.box(i % 3 ? 'chrome' : GT.mat('metal_painted_yellow'), .012, .05, .003, 57.63 + (i % 4) * .06, y0 + 1.71 - ((i / 4) | 0) * .16, z0 + .088); }
    k.cyl(M('plastic_white'), .15, .15, .03, 58.5, y0 + 2.25, z0 + .016, { seg: 24, rx: HP }); k.cyl(blk, .158, .158, .026, 58.5, y0 + 2.25, z0 + .012, { seg: 24, rx: HP }); k.box(blk, .008, .1, .004, 58.5, y0 + 2.29, z0 + .034, { rz: .5 }); k.box(blk, .006, .13, .004, 58.54, y0 + 2.22, z0 + .034, { rz: -1.1 });
    // breaker panel + alarm keypad + conduit on the west wall, south of the door
    k.box(galv, .09, .72, .5, x0 + .045, y0 + 1.5, -1.5, { bevel: .006 }); k.box(GT.mat('metal_galv', { color: 0x8a9095 }), .012, .66, .44, x0 + .096, y0 + 1.5, -1.5, { bevel: .004 }); k.box(blk, .014, .06, .03, x0 + .104, y0 + 1.5, -1.3); k.box(GT.mat('plastic_white', { color: 0xe6d67a }), .003, .1, .16, x0 + .104, y0 + 1.68, -1.5);
    for (const zz of [-1.62, -1.5, -1.38]) k.cyl(galv, .014, .014, y1 - y0 - 1.86, x0 + .04, (y0 + 1.86 + y1) / 2, zz, { seg: 8 }); k.box(GT.mat('plastic_white', { color: 0xdcd9cf }), .03, .15, .11, x0 + .015, y0 + 1.42, -.42, { bevel: .006 }); k.box('neon_green', .004, .008, .008, x0 + .032, y0 + 1.47, -.45); k.box(GT.mat('emissive_screen'), .004, .03, .07, x0 + .032, y0 + 1.445, -.41);
    // chair pushed aside
    k.push(60.35, y0, -2.35, { ry: -.9 }); for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; k.box(dark, .05, .03, .3, Math.sin(a) * .15, .06, Math.cos(a) * .15, { ry: a, bevel: .008 }); k.cyl(blk, .028, .028, .03, Math.sin(a) * .29, .028, Math.cos(a) * .29, { seg: 8, rz: HP, ry: a }); }
    k.cyl('chrome', .022, .022, .34, 0, .25, 0, { seg: 8 }); k.box(GT.mat('fabric_dark', { color: 0x24272c }), .46, .08, .46, 0, .47, 0, { bevel: .03 }); k.box(dark, .05, .3, .04, 0, .62, -.22, { rx: -.15 }); k.box(GT.mat('fabric_dark', { color: 0x24272c }), .42, .46, .07, 0, .92, -.26, { bevel: .03, rx: -.12 }); for (const s of [-1, 1]) { k.box(dark, .03, .2, .03, s * .25, .58, -.02); k.box(blk, .05, .03, .26, s * .25, .69, 0, { bevel: .01 }); } k.pop();
    // steel shelving on the north wall, stocked
    for (let u = 0; u < 2; u++) { const sx = 59.75 + u * 1.95; k.push(sx, y0, z1 - .3, {}); for (const px of [-.9, .9]) for (const pz of [-.24, .24]) k.box(galv, .035, 2.1, .035, px, 1.05, pz, { bevel: .004 }); for (let l = 0; l < 4; l++) { const sy = .12 + l * .58; k.box(galv, 1.84, .025, .5, 0, sy, 0, { bevel: .004 }); k.box(galv, 1.84, .05, .012, 0, sy - .02, -.25);
          let cx = -.84; while (cx < .6) { const bw = .28 + r() * .26, bh = Math.min(.5, .2 + r() * .3), bd = .32 + r() * .12, t = r(); if (r() < .14) { cx += bw * .6; continue; }
            if (t < .62) { const m = t < .35 ? card : card2; k.box(m, bw, bh, bd, cx + bw / 2, sy + .013 + bh / 2, (r() - .5) * .05, { bevel: .006, ry: (r() - .5) * .08 }); k.box(GT.mat('plastic_white', { color: 0xc9b98e, rough: .7 }), bw + .002, .003, .05, cx + bw / 2, sy + .015 + bh, 0); k.box(paper, .09, .06, .002, cx + bw / 2 - .04, sy + .013 + bh * .55, -bd / 2 - .002); }
            else if (t < .8) { for (let s = 0; s < Math.min(3, Math.round(bh / .14)); s++) { k.box(s % 2 ? crate : crateB, bw, .13, bd, cx + bw / 2, sy + .013 + .065 + s * .135, 0, { bevel: .01 }); k.box(blk, bw * .5, .04, .006, cx + bw / 2, sy + .1 + s * .135, -bd / 2 - .002); } }
            else { for (let j = 0; j < 2; j++) { k.cyl(GT.mat('plastic_white', { color: 0x9fc4d8, rough: .3 }), .1, .1, .3, cx + .11 + j * .23, sy + .163, 0, { seg: 12 }); k.cyl(GT.mat('metal_painted_blue'), .035, .035, .04, cx + .11 + j * .23, sy + .33, 0, { seg: 8 }); } }
            cx += bw + .03 + r() * .05; } } k.pop(); }
    // lockers on the south wall, east part
    for (let i = 0; i < 4; i++) { const lx = 61.75 + i * .42; k.box(lockerM, .4, 1.82, .46, lx, y0 + .93, z0 + .24, { bevel: .006 }); k.box(GT.mat('metal_painted_blue', { color: 0x3f525d }), .36, 1.7, .012, lx, y0 + .93, z0 + .476, { bevel: .004 }); for (let v = 0; v < 5; v++) k.box(dark, .2, .008, .004, lx, y0 + 1.62 - v * .03, z0 + .484); k.box('chrome', .016, .07, .02, lx + .13, y0 + .98, z0 + .49, { bevel: .003 }); if (i % 2 === 0) k.box(GT.mat('metal_painted_yellow', { color: 0xb08a2a }), .03, .04, .014, lx + .13, y0 + .92, z0 + .496, { bevel: .004 }); k.box(paper, .08, .03, .002, lx - .04, y0 + 1.42, z0 + .484); }
    k.box(GT.mat('wood_plank', { color: 0x6f5235 }), 1.3, .04, .32, 62.38, y0 + .44, z0 + .64, { bevel: .006 }); for (const s of [-.55, .55]) k.box(dark, .03, .42, .28, 62.38 + s, y0 + .21, z0 + .64);
    // hand truck, mop bucket, bags, crates near the back door
    k.push(63.25, y0, .55, { ry: -1.3 }); for (const s of [-1, 1]) { k.cyl(M('metal_painted_red'), .014, .014, 1.2, s * .17, .68, 0, { seg: 8, rx: -.2 }); k.cyl('rubber', .1, .1, .045, s * .22, .1, .1, { seg: 14, rz: HP }); } for (const yy of [.3, .62, .94]) k.cyl(M('metal_painted_red'), .011, .011, .34, 0, yy + .06, -.06 - yy * .2 + .12, { seg: 6, rz: HP }); k.box(M('metal_painted_red'), .36, .012, .22, 0, .05, .2, { bevel: .003 }); k.pop();
    k.push(62.55, y0, 1.25, { ry: .4 }); k.box(M('metal_painted_yellow'), .36, .3, .5, 0, .2, 0, { bevel: .035 }); k.box(M('metal_painted_yellow'), .3, .2, .2, 0, .42, -.16, { bevel: .02 }); for (let i = 0; i < 4; i++) k.cyl(blk, .03, .03, .03, (i & 1 ? .15 : -.15), .03, (i & 2 ? .2 : -.2), { seg: 8, rz: HP }); k.cyl(M('wood_plank'), .013, .013, 1.4, .05, .86, .02, { seg: 6, rx: .2, rz: .1 }); k.box(M('plastic_white'), .16, .12, .16, .04, .32, .12, { bevel: .04 }); k.pop();
    for (const b of [[62.75, 1.95, .34], [63.2, 1.75, .28], [62.9, 1.5, .22]]) k.sphere(GT.mat('plastic_black', { rough: .45 }), b[2], b[0], y0 + b[2] * .72, b[1], { seg: 12, seg2: 8, s: [1, .78, 1] });
    for (let i = 0; i < 4; i++) k.box(i % 2 ? crate : crateB, .36, .27, .36, 61.25 - (i > 2 ? .42 : 0), y0 + .135 + (i % 3) * .275, -3.42, { bevel: .012, ry: i * .07 });
    // east wall north of the exit: time clock + card rack, first-aid box, notices; a stack of flattened cartons and a step stool
    k.push(x1, y0, .35, {}); k.box(GT.mat('plastic_grey', { color: 0x3a3e44 }), .09, .26, .2, -.045, 1.45, 0, { bevel: .012 }); k.box(GT.mat('emissive_screen'), .004, .05, .12, -.092, 1.52, 0); k.box(blk, .02, .012, .14, -.09, 1.4, 0); k.box(galv, .03, .5, .34, -.015, 1.42, .42, { bevel: .004 });
    for (let i = 0; i < 10; i++) { k.box(galv, .028, .006, .3, -.03, 1.21 + i * .046, .42, { rx: 0 }); if (i % 3 !== 1) k.box(i % 4 ? paper : GT.mat('plastic_white', { color: 0xe6d67a, rough: .9 }), .004, .075, .2 + (i % 3) * .03, -.036, 1.25 + i * .046, .42); }
    k.box(M('plastic_white'), .1, .3, .38, -.05, 1.6, 1.25, { bevel: .012 }); k.box(M('plastic_red'), .004, .16, .05, -.102, 1.6, 1.25); k.box(M('plastic_red'), .004, .05, .16, -.102, 1.6, 1.25); k.box('chrome', .012, .03, .05, -.104, 1.5, 1.39);
    k.geo(GT.signMat ? GT.signMat('员工须知 · 现金每两小时入柜', { style: 'sticker', bg: '#b8322a', w: 768, h: 128 }) : paper, new T.PlaneGeometry(.62, .105), { x: -.008, y: 2.02, z: .6, ry: -HP }); k.geo(GT.signMat ? GT.signMat('SMILE · 你已被录像', { style: 'sticker', bg: '#d4a514', color: '#1a1a1a', w: 640, h: 128 }) : paper, new T.PlaneGeometry(.5, .1), { x: -.008, y: 1.86, z: 1.3, ry: -HP }); k.pop();
    for (let i = 0; i < 7; i++) k.box(i % 2 ? card : card2, .9, .014, .62, 60.05 + (r() - .5) * .05, y0 + .01 + i * .0145, -3.32 + (r() - .5) * .04, { ry: (r() - .5) * .12 }); k.tube(GT.mat('plastic_white', { color: 0xc9b98e, rough: .7 }), [[59.62, y0 + .02, -3.32], [59.62, y0 + .12, -3.32], [60.48, y0 + .12, -3.32], [60.48, y0 + .02, -3.32]], .006, { seg: 4, tension: 0 });
    k.push(59.35, y0, 1.25, { ry: .35 }); for (const s of [-1, 1]) { k.box(galv, .025, .46, .025, s * .2, .23, -.12, { rx: .12 }); k.box(galv, .025, .46, .025, s * .2, .23, .12, { rx: -.12 }); } k.box(GT.mat('plastic_grey', { color: 0x30343a }), .46, .03, .3, 0, .47, 0, { bevel: .008 }); k.box(GT.mat('plastic_grey', { color: 0x30343a }), .44, .025, .2, 0, .24, .1, { bevel: .006 }); k.pop();
    for (const zz of [-.2, .1]) k.cyl(GT.mat('metal_painted_red', { color: 0x8a2a22 }), .03, .03, W - .1, xm, y1 - .12, zz + 1.6, { seg: 8, rz: HP }); for (let i = 0; i < 4; i++) k.box(galv, .02, .1, .5, x0 + 1 + i * 1.6, y1 - .07, 1.55);
    // ceiling: fluorescent fittings, conduit, duct, detector
    for (const lx of [58.9, 61.7]) { k.box(M('metal_painted_white'), 1.28, .06, .2, lx, y1 - .03, -.8, { bevel: .008 }); for (const s of [-.05, .05]) k.cyl('light_cool', .014, .014, 1.2, lx, y1 - .072, -.8 + s, { seg: 8, rz: HP }); }
    k.cyl(galv, .016, .016, W - .4, xm, y1 - .05, z0 + .5, { seg: 8, rz: HP }); k.cyl(galv, .012, .012, D - .3, x0 + .5, y1 - .04, zm, { seg: 6, rx: HP }); k.box(galv, 3.0, .26, .42, 62.1, y1 - .13, .9, { bevel: .01 }); k.box(dark, .5, .012, .32, 61.6, y1 - .262, .9); for (let i = 0; i < 6; i++) k.box(galv, .5, .004, .01, 61.6, y1 - .27, .78 + i * .048);
    k.cyl(M('plastic_white'), .06, .07, .035, 61.2, y1 - .018, -1.9, { seg: 14 }); k.box('neon_red', .006, .004, .006, 61.2, y1 - .04, -1.85);
    // floor: mat, drain, stains
    k.box('rubber', 1.3, .012, .8, 58.75, y0 + .006, -2.5, { bevel: .004 }); k.cyl(dark, .09, .09, .006, 61.2, y0 + .003, -.6, { seg: 16 }); k.decal('tire_marks', .5, 3.2, 61.9, y0 + .004, .2, 1.2); k.decal('crack', 2.6, 2.6, 60.6, y0 + .004, .4, 2.1); k.decal('crack', 2, 2, 62.6, y0 + .004, -1.6, .7); k.decal('grime_streak', 3, 1.2, 62, y0 + .004, -2.9, 0); k.decal('gum_spots', 2, 2, 58.6, y0 + .004, .3, .4);
    k.quad(GT.decalMat('water_stain'), 1.4, 1.4, 60.2, y1 - .004, .6, { rx: HP }); k.quad(GT.decalMat('grime_streak'), 2.4, 1.2, 60.7, y0 + 1.6, z0 + .014, {}); k.quad(GT.decalMat('rust_run'), .5, 1.3, 63.2, y0 + 1.9, z1 - .014, { ry: PI }); k.quad(GT.decalMat('water_stain'), 1.6, 1.6, x1 - .014, y0 + 1.9, .9, { ry: -HP }); k.quad(GT.decalMat('grime_streak'), 2.2, .9, x0 + .014, y0 + .5, -2.4, { ry: HP });
    const g = k.build({ cast: false }); g.name = 'rb_office'; grp.add(g);
    // live pieces: CCTV screen, REC / HDD LEDs, room light
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160; const tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; const V = { g: cv.getContext('2d'), tex, mode: '', p: -1 };
    const scr = new T.Mesh(new T.PlaneGeometry(.58, .36), new T.MeshBasicMaterial({ map: tex })); scr.material.color.setScalar(1.5); scr.position.set(dx + .26, y0 + 1.12, dz - .19 + .02); scr.rotation.x = -.08; grp.add(scr);
    const led = (c, x, y, z) => { const m = new T.Mesh(new T.BoxGeometry(.01, .01, .004), new T.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); grp.add(m); return m; };
    V.rec = led(0xff2010, dx - .3, y0 + .893, dz + .049); V.hdd = led(0x30ff70, dx - .27, y0 + .893, dz + .049); V.scr = scr;
    const L = new T.PointLight(0xdfe8ff, 1.05, 11, 1.5); L.position.set(60.3, y1 - .5, -.7); grp.add(L); const L2 = new T.PointLight(0xffc98a, .5, 3.2, 1.6); L2.position.set(dx + .66, y0 + 1.12, dz - .02); grp.add(L2);
    return V; }
  function bandana() { const k = GT.kit(), m = GT.mat('fabric_dark', { color: 0x1c2026 }), m2 = GT.mat('fabric_dark', { color: 0x2a3038 });
    k.geo(m, new T.CylinderGeometry(.097, .082, .1, 16, 2, true, -1.95, 3.9), { x: 0, y: .028, z: .024 }); k.geo(m, new T.CylinderGeometry(.082, .03, .075, 12, 1, true, -1.2, 2.4), { x: 0, y: -.058, z: .03 });
    k.geo(m2, new T.TorusGeometry(.093, .011, 6, 20), { x: 0, y: .064, z: .016, rx: HP + .12 }); k.sphere(m2, .017, 0, .05, -.082, { seg: 8, seg2: 6 }); k.box(m2, .03, .09, .008, .014, 0, -.09, { rz: .25, rx: .2, bevel: .003 }); k.box(m2, .028, .075, .008, -.016, .008, -.092, { rz: -.3, rx: .15, bevel: .003 });
    const g = k.build(); g.name = 'rb_mask'; return g; }
  function pistolProp() { if (GT.weapons && GT.weapons.make) { try { const w = GT.weapons.make('pistol', { lod: 0 }); if (w && w.group) return w.group; } catch (e) {} }
    const k = GT.kit(), m = GT.mat('metal_dark', { color: 0x1a1b1e }); k.box(m, .028, .032, .17, 0, .05, .06, { bevel: .006 }); k.box(GT.mat('plastic_black'), .026, .1, .042, 0, -.02, .0, { bevel: .008, rx: -.2 }); k.box(m, .008, .02, .05, 0, .02, .05); return k.build(); }
  function toolProp(kind) { const k = GT.kit();
    if (kind === 'slim') { const m = GT.mat('aluminium_brushed', { color: 0x9a9da2 }); k.box(m, .022, .56, .0016, 0, .12, 0); k.box(m, .034, .03, .0016, .006, -.15, 0); k.box(m, .012, .05, .0016, .017, -.115, 0); k.box(GT.mat('rubber'), .028, .13, .006, 0, .36, 0, { bevel: .002 }); }
    else { const b = GT.mat('plastic_black'), g = GT.mat('plastic_grey', { color: 0x2c3036 }); k.box(b, .078, .14, .022, 0, .02, 0, { bevel: .008 }); k.box(g, .07, .02, .024, 0, -.035, 0, { bevel: .004 }); k.box(GT.mat('emissive_screen'), .058, .05, .002, 0, .045, .0125); for (let i = 0; i < 4; i++) k.box(i === 0 ? GT.mat('neon_green') : g, .011, .011, .003, -.024 + i * .016, -.005, .0125, { bevel: .001 }); k.cyl(b, .004, .005, .06, .026, .12, 0, { seg: 6 }); k.box('neon_amber', .004, .004, .002, -.028, .078, .0125);
      if (kind === 'bypass') { k.tube(GT.mat('plastic_grey', { color: 0x8a2a24 }), [[-.02, -.05, 0], [-.03, -.12, .01], [0, -.2, .03], [.05, -.25, .1]], .0035, { seg: 5 }); k.tube(b, [[.02, -.05, 0], [.03, -.13, .02], [.04, -.2, .05], [.06, -.25, .1]], .0035, { seg: 5 }); k.box(g, .03, .016, .04, .055, -.25, .11, { bevel: .003 }); } }
    return k.build({ cast: false }); }
  const VIS = { ok: false, grp: null, V: null, crack: null, blobs: {}, shardG: null, safeG: null, pmask: null, pgun: null, ptool: null, toolKind: '', pfig: null, p2gun: null, glass: new Map(), ledT: 0,
    init(scene) { if (this.ok || !scene || !T || typeof document === 'undefined') return; this.ok = true; const g = this.grp = new T.Group(); g.name = 'robbery'; scene.add(g);
      try { this.V = buildOffice(g); cctvDraw(this.V, 'rec', 0); this.V.mode = 'rec'; } catch (e) { console.warn('[robbery] office', e); }
      try { this.crack = new T.MeshBasicMaterial({ map: crackTex(), transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); this.crack.color.setScalar(1.25);
        // sprayed camera domes, smashed partition + shards, opened safe (all hidden until they happen)
        for (const id of ['A', 'B']) { const c = PT.cams[id], k = GT.kit(), m = GT.mat('plastic_black', { color: 0x0b0b0c, rough: .98 }); k.sphere(m, .088, c.x, c.y - .05, c.z, { seg: 12, seg2: 8 }); k.cyl(m, .12, .1, .012, c.x, c.y + .008, c.z, { seg: 14 }); for (let i = 0; i < 4; i++) k.cyl(m, .006, .003, .05 + i * .03, c.x + Math.sin(i * 1.9) * .05, c.y - .14 - i * .012, c.z + Math.cos(i * 1.9) * .05, { seg: 5 }); const b = k.build({ cast: false }); b.visible = false; g.add(b); this.blobs[id] = b; }
        { const k = GT.kit(), r = GT.rng('rb:shards'), top = PT.floorY + .95, px = PT.kase.x + .665, gl = GT.mat('glass_clear'); k.geo(this.crack, new T.PlaneGeometry(2.3, 1.15), { x: px - .012, y: top + .6, z: PT.kase.z - .05, ry: -HP });
          for (let i = 0; i < 70; i++) { const onF = i > 34, sx = onF ? px - .25 - r() * .9 : px + .05 + r() * .32, sz = PT.kase.z + (r() - .5) * 1.5, s = .015 + r() * .05, tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(new Float32Array([0, 0, 0, s, 0, s * (.3 + r()), s * (.2 + r() * .6), 0, -s * r()]), 3)); tg.setAttribute('normal', new T.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3)); tg.setAttribute('uv', new T.BufferAttribute(new Float32Array(6), 2)); tg.setIndex([0, 1, 2]); k.geo(gl, tg, { x: sx, y: (onF ? PT.floorY : top) + .004 + r() * .002, z: sz, ry: r() * TAU }); }
          for (let i = 0; i < 5; i++) k.box(GT.mat('plastic_white', { color: [0xd9b23a, 0xc94a3a, 0x3a8a6a][i % 3] }), .1, .002, .16, px - .3 - r() * .5, PT.floorY + .005, PT.kase.z + (r() - .5) * 1.1, { ry: r() * 3 }); const s = k.build({ cast: false }); s.visible = false; s.traverse(o => { if (o.material && o.material.transparent) o.renderOrder = 5; }); g.add(s); this.shardG = s; }
        { const k = GT.kit(), sx = PT.safe.x + .62, sz = PT.safe.z, y = PT.floorY + .3, cash = GT.mat('plastic_white', { color: 0x7f9a72, rough: .85 }); k.box(GT.mat('plastic_black', { color: 0x050506, rough: 1 }), .012, .44, .44, sx - .262, y, sz); k.box(GT.mat('metal_dark'), .46, .46, .03, sx - .5, y, sz + .245, { bevel: .008, ry: .25 }); k.cyl('chrome', .05, .05, .03, sx - .52, y + .06, sz + .27, { seg: 14, rx: HP, ry: .25 }); k.box(GT.mat('metal_galv'), .006, .012, .4, sx - .27, y, sz);
          for (let i = 0; i < 3; i++) k.box(cash, .07, .028, .155, sx - .2, y - .2 + i * .002, sz - .1 + i * .09, { ry: HP + i * .3, bevel: .004 }); const s = k.build({ cast: false }); s.visible = false; g.add(s); this.safeG = s; }
        this.pmask = bandana(); this.pmask.visible = false; this.pgun = pistolProp(); this.pgun.visible = false; g.add(this.pgun); this.p2gun = pistolProp(); this.p2gun.visible = false; g.add(this.p2gun);
      } catch (e) { console.warn('[robbery] props', e); } },
    reset() { if (!this.ok) return; for (const id in this.blobs) this.blobs[id].visible = false; if (this.shardG) this.shardG.visible = false; if (this.safeG) this.safeG.visible = false; for (const [, m] of this.glass) if (m.parent) m.parent.remove(m); this.glass.clear(); if (this.V) { this.V.mode = ''; } for (const p of C.people) this.dropFig(p); },
    dropFig(p) { if (p.fig && p.fig.group.parent) p.fig.group.parent.remove(p.fig.group); p.fig = null; },
    swapClerk(p) { this.dropFig(p); },
    spray(id) { if (this.blobs[id]) this.blobs[id].visible = true; }, shards() { if (this.shardG) this.shardG.visible = true; }, safeOpen() { if (this.safeG) this.safeG.visible = true; },
    carGlass(r) { if (!this.ok || this.glass.has(r)) return; const c = r.car, e = eyeOf(c), W = (c.dims && c.dims.W) || 1.85, k = GT.kit(), rr = GT.rng('rb:cg' + r.id), gl = GT.mat('glass_clear');
      k.geo(this.crack, new T.PlaneGeometry(.78, .4), { x: W / 2 - .115, y: e[1] - .02, z: e[2] + .12, ry: HP, rz: 0, rx: 0 });
      for (let i = 0; i < 46; i++) { const s = .012 + rr() * .035, tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(new Float32Array([0, 0, 0, s, 0, s * (.3 + rr()), s * (.2 + rr() * .6), 0, -s * rr()]), 3)); tg.setAttribute('normal', new T.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3)); tg.setAttribute('uv', new T.BufferAttribute(new Float32Array(6), 2)); tg.setIndex([0, 1, 2]); k.geo(gl, tg, { x: W / 2 + .05 + rr() * .7, y: .012 + rr() * .004, z: e[2] + .1 + (rr() - .5) * 1.2, ry: rr() * TAU }); }
      const m = k.build({ cast: false }); m.traverse(o => { if (o.material && o.material.transparent) o.renderOrder = 6; }); if (c.group) c.group.add(m); else { m.position.set(c.x, 0, c.z); m.rotation.y = c.h || 0; this.grp.add(m); } this.glass.set(r, m); },
    setMask(fig, on) { if (!fig) return; const h = fig.hero; if (h && h.setMask) { try { h.setMask(on); return; } catch (e) {} } const hb = fig.bone('head'); if (!hb || !this.pmask) return; if (on) { if (this.pmask.parent !== hb) hb.add(this.pmask); const o = fig.hero ? (HOOKS.maskOffsetHero || [0, .0, .012, 1]) : [0, -.014, .014, 1.03]; this.pmask.position.set(o[0], o[1], o[2]); this.pmask.scale.setScalar(o[3]); } this.pmask.visible = on; },
    update(dt) { if (!this.ok) return; const V = this.V;
      // module-owned people (clerk, customers): lazily built figures
      for (const p of C.people) { if (p.ext) { const e = p.ext; if (S.started || p.wp) { e.x = p.x; e.z = p.z; e.h = p.h; if ('speed' in e) e.speed = p.speed; } if ('state' in e && (S.started || S.done)) e.state = e.idle = p.anim; continue; }
        if (!p.fig) { if (!p.present) continue; p.fig = mkFig(p.role === 'clerk' ? 'clerk' : 'ped', p.role === 'clerk' ? { seed: p.seed } : { seed: p.seed, type: p.ptype }); this.grp.add(p.fig.group); }
        p.fig.group.visible = p.present; if (!p.present) continue; p.fig.group.position.set(p.x, inStoreAt(p.x, p.z) || p.x > ST.x0 - 2.6 ? PT.floorY : 0, p.z); p.fig.group.rotation.y = p.h; p.fig.upd(dt, p.anim === 'film' ? 'phone' : p.anim, p.speed); }
      // player-side props (the figure itself belongs to the game or to the showcase rig)
      const pf = this.pfig || (CTX.hero && (CTX.hero.upd ? CTX.hero : { hero: CTX.hero, group: CTX.hero.group, bone: n => (CTX.hero.bones && CTX.hero.bones[n]) || null }));
      if (pf) { if (this._m !== S.masked || this._mf !== pf.group) { this._m = S.masked; this._mf = pf.group; this.setMask(pf, S.masked); }
        const gun = S.aiming && !(GT.combat && GT.combat.engaged) && HOOKS.weaponProp !== false; this.pgun.visible = gun && inHand(this.pgun, pf, PL.yaw, .012, .08);
        const tk = S.mg && S.mg.kind === 'slimjim' ? 'slim' : S.mg && S.mg.kind === 'bypass' ? 'bypass' : TH.clone ? 'cloner' : ''; if (tk !== this.toolKind) { if (this.ptool) this.grp.remove(this.ptool); this.ptool = tk ? toolProp(tk) : null; if (this.ptool) this.grp.add(this.ptool); this.toolKind = tk; }
        if (this.ptool) { if (tk === 'slim') { const c = S.mg.car, e = eyeOf(c), W = (c.dims && c.dims.W) || 1.85, q = carLocal(c, W / 2 - .045, e[2] - .18 + S.mg.pos * .5); this.ptool.position.set(q.x, e[1] - .2 + Math.sin(S.mg.t * 9) * .006 * (1 + S.mg.feel * 3), q.z); this.ptool.rotation.set(0, (c.h || 0), .06); } else this.ptool.visible = inHand(this.ptool, pf, PL.h + PI, .05, .09); } }
      else this.pgun.visible = false;
      this.p2gun.visible = false;
      if (V) { const o = S.office, mode = S.cams.wiped ? 'off' : o && o.wipe > 0 ? 'wipe' : 'rec', pq = mode === 'wipe' ? Math.round(o.wipe * 25) : 0; if (mode !== V.mode || pq !== V.p) { V.mode = mode; V.p = pq; cctvDraw(V, mode, pq / 25); }
        this.ledT += dt; V.rec.visible = mode === 'rec' ? (this.ledT % 1.2) < .7 : mode === 'wipe' ? (this.ledT % .16) < .08 : false; V.hdd.visible = mode === 'off' ? false : Math.sin(this.ledT * 31) + Math.sin(this.ledT * 17.3) > -.3; V.rec.material.color.setScalar(1).multiply(_ledR); V.hdd.material.color.setScalar(1).multiply(_ledG); }
    } };
  const _ledR = T ? new T.Color(6, .5, .3) : null, _ledG = T ? new T.Color(.6, 5, 1.4) : null;

  /* ================================================================== module API: init / reset / update */
  function reset(o) { o = o || {}; const cfg = Object.assign({}, S.cfg, o.cfg || {}), mute = S.mute; VIS.reset(); S = freshStore(); S.cfg = cfg; S.mute = o.mute !== undefined ? !!o.mute : mute; if (o.tools) Object.assign(S.tools, o.tools);
    C.people = []; C.clerk = null; C.seq = 0; resetEv(); CR = new Map(); NPC = new Map(); Object.assign(TH, { near: null, susp: 0, clone: null, busyT: 0, alarmLeft: null }); Object.assign(P2, { on: false, forced: false, own: false, job: 'follow', arrived: false, target: null, path: null, anim: 'idle', speed: 0, inside: false, work: 0 });
    TAKE = null; LOG.length = 0; PROMPTS.length = 0; rnd = GT.rng('robbery' + (o.seed || 0)); for (const s of SPOTS) s.p = 0; if (GT.station && GT.station.state && GT.station.state.alarm) GT.station.state.alarm = false;
    if (o.clerk !== false) mkPerson('clerk', Object.assign({ x: PT.clerk.x, z: PT.clerk.z, h: PT.clerk.h !== undefined ? PT.clerk.h : -HP, seed: o.seed || 0 }, o.clerk || {}));
    if (cfg.customers === 'auto' && VIS.ok) { const I = PT.inside, D = PT.door, s = PT.spots;
      mkPerson('customer', { x: D.x - 3, z: D.z + 9, present: false, seed: 3, ptype: 'tourist', planT: 14, plan: [{ hide: false, at: [D.x - 2.5, D.z + 7], to: [D, I, [52.6, -6], s.coffee], h: s.coffee.h, wait: 26 }, { to: [PT.queue], h: HP, wait: 12, anim: 'talk' }, { to: [I, D, [D.x - 2, D.z - 8]], wait: 12 }, { hide: true, wait: 46 }] });
      mkPerson('customer', { x: D.x - 3, z: D.z - 9, present: false, seed: 8, ptype: 'sundress', planT: 52, plan: [{ hide: false, at: [D.x - 2.5, D.z - 7], to: [D, I, [51.6, -12.3], s.aisle], h: s.aisle.h, wait: 30, anim: 'phone' }, { to: [[51.6, -12.3], PT.queue], h: HP, wait: 15, anim: 'talk' }, { to: [I, D, [D.x - 2, D.z + 9]], wait: 13 }, { hide: true, wait: 70 }] }); }
    sync(); emit('phase', { phase: 'reset' }); return api; }
  function sync() { state.phase = S.phase; state.take = S.take; state.noise = S.noise; state.clock = S.clock; state.risk = S.risk; state.alarm = S.alarm; state.alarmKnown = S.alarmKnown; state.masked = S.masked; state.armed = S.armed; state.aiming = S.aiming; state.objective = S.obj; state.hint = S.hint;
    state.suspicion = TH.clone ? TH.clone.susp : TH.susp; state.heroState = S.heroState; state.minigame = S.mg ? S.mg.kind : (TH.clone ? 'cloner' : null); state.cased = S.cased; state.inStore = S.inStore; state.result = S.result; }
  function init(scene, hooks) { HOOKS = hooks || HOOKS || {}; if (!inited) { inited = true; SCENE = scene || null; resolve(); VIS.init(SCENE); buildSpots(); reset({}); } else if (scene && !SCENE) { SCENE = scene; VIS.init(scene); reset({}); }
    if (SCENE || HOOKS.hud === true) UI.mount(); return api; }
  function update(dt, ctx) { if (!inited) init(null, {}); CTX = ctx || {}; In = CTX.input || GT.input || NOIN; dt = clamp(+dt || 0, 0, .1);
    const ctl = CTX.ctl, pos = CTX.pos || (ctl && ctl.pos), free = !S.office && !(S.mg && S.mg.at);
    if (pos && free) { PL.x = pos.x; PL.z = pos.z; PL.h = CTX.h !== undefined ? CTX.h : (ctl && typeof ctl.h === 'number' ? ctl.h : PL.h); }
    if (free) PL.yaw = CTX.yaw !== undefined ? CTX.yaw : (ctl && ctl.camera && typeof ctl.camera.yaw === 'number' ? ctl.camera.yaw : PL.h);
    PL.crouch = !!(CTX.crouch || (ctl && /crouch/.test(ctl.state || ''))); if (free) PL.speed = CTX.speed !== undefined ? CTX.speed : (ctl && ctl.speed) || 0; PL.inCar = !!(CTX.inCar || (ctl && (ctl.seated || (ctl.enabled === false && !TAKE))));
    if (CTX.car) S.pcar = CTX.car; if (CTX.tools) Object.assign(S.tools, CTX.tools);
    const ck = C.clerk; if (ck && CTX.clerk && ck.ext !== CTX.clerk) { VIS.dropFig(ck); ck.ext = CTX.clerk; }
    if (TAKE && TAKE.done()) TAKE = null;
    PROMPTS.length = 0; storeStep(dt); carsStep(dt);
    if (ctl && HOOKS.driveCtl !== false) { if (S.office && ctl.teleport && (OFF.wp || S.office.t < .2)) { try { ctl.teleport(PL.x, PL.z, PL.h); } catch (e) {} } if ('armed' in ctl && (S.inStore || S.near) && S.armed && !(GT.combat && GT.combat.engaged)) ctl.armed = true; }
    sync(); VIS.update(dt); UI.render(dt); return state; }
  const store = { reset, order, clear: clearEv, log: logEv, start: startRobbery, alarm, finish, shout, enterOffice, config(o) { Object.assign(S.cfg, o || {}); return store; }, give(tool) { S.tools[tool] = true; return store; },
    setMask(b) { S.masked = !!b; return store; }, setArmed(b) { S.armed = !!b; return store; }, addPartner(o) { o = o || {}; P2.forced = true; P2.own = true; P2.on = true; P2.x = o.x || PL.x - .8; P2.z = o.z || PL.z - .8; P2.h = o.h || 0; return P2; },
    addCustomer(o) { return mkPerson('customer', o || {}); }, triggerShift() { S.shift.next = S.t; return store; }, leftIn(car) { S.pcar = car; return store; },
    get people() { return C.people; }, get clerk() { return C.clerk; }, get partner() { return P2; }, get player() { return PL; }, get loot() { return S.loot; }, get cams() { return S.cams; }, get tools() { return S.tools; }, get spots() { return SPOTS; }, get prompts() { return PROMPTS; },
    get minigame() { return S.mg; }, get takeover() { return TAKE; }, get raw() { return S; }, get log_() { return LOG; }, points: PT, values: VAL, response: RESP, sources: () => JSON.parse(JSON.stringify(SRC)), remaining, tension, input: mkInput };
  const cars = { get(c) { return carRec(c); }, get near() { return TH.near; }, get theft() { return TH; }, smash(c) { smash(carRec(c)); }, alarm(c) { return carAlarm(carRec(c), 'api'); }, doorPos, tiers: SECN, list: () => Array.from(CR.values()) };
  const api = GT.robbery = { init, update, store, cars, state, on, reset, version: 1 };

  /* ================================================================== showcase rig: a small third-person stand-in for onfoot.js (deterministic autoplay or keyboard) */
  function makeRig(scene, camera, Q) {
    const auto = Q.get('auto') !== '0', VI = mkInput(), R = { t: 0, VI, auto, npcs: [], cars: [], evts: [], whens: [], heat: 0, log: [], camFree: !!Q.get('cam') };
    const P = R.player = { x: 47.4, z: DZ, h: HP, yaw: HP, wp: null, spd: 1.8, speed: 0, aim: null, crouch: false, fig: mkFig('kai', {}), state: 'idle' };
    scene.add(P.fig.group); VIS.pfig = P.fig;
    const CAMR = R.cam = { yaw: HP, dist: 2.55, side: .5, h: 1.62, pitch: .1, fov: 55, follow: true, cur: null };
    R.at = (t, fn) => { R.evts.push({ t, fn }); R.evts.sort((a, b) => a.t - b.t); }; R.when = (cond, fn) => R.whens.push({ cond, fn }); R.after = (s, fn) => R.at(R.t + s, fn);
    R.go = (pts, spd, then) => { P.wp = pts.map(q => [q.x !== undefined ? q.x : q[0], q.z !== undefined ? q.z : q[1]]); P.spd = spd || 1.8; P.then = then || null; };
    R.aim = t => { P.aim = t || null; VI.set('Mouse1', !!t); }; R.tap = c => VI.tap(c); R.hold = (c, on) => VI.set(c, on !== false);
    R.npc = (o) => { const n = Object.assign({ x: 0, z: 0, h: 0, anim: 'idle', kind: 'ped' }, o); n.fig = mkFig(n.kind, { seed: n.seed || 0, type: n.type }); n.fig.group.position.set(n.x, n.y || 0, n.z); n.fig.group.rotation.y = n.h; scene.add(n.fig.group); R.npcs.push(n); return n; };
    R.car = (kind, x, z, h, o) => { o = o || {}; let v = null; try { if (GT.vehicles && GT.vehicles.make) v = GT.vehicles.make(kind, { color: o.color }); } catch (e) { console.warn(e); }
      if (!v) { const k = GT.kit(); k.box(GT.mat('car_paint', { color: o.color || 0x6f7a80 }), 1.85, .7, 4.5, 0, .65, 0, { bevel: .12 }); k.box('glass_tint', 1.6, .5, 2.2, 0, 1.2, -.1, { bevel: .14 }); v = { group: k.build(), dims: { L: 4.5, W: 1.85, H: 1.45, eye: [.37, 1.15, -.05] }, setLights() {}, update() {} }; }
      v.group.position.set(x, 0, z); v.group.rotation.y = h; scene.add(v.group); const c = Object.assign({ group: v.group, veh: v, dims: v.dims, kind, x, z, h, locked: true }, o); R.cars.push(c); return c; };
    const partner = { fig: null }; R.addPartner = (x, z, h) => { const p2 = store.addPartner({ x, z, h }); partner.fig = mkFig('lie', {}); scene.add(partner.fig.group); return p2; };
    on('teleport', d => { P.x = d.x; P.z = d.z; P.h = P.yaw = d.h; P.wp = null; });
    on('say', d => R.log.push(d.who + '：' + d.text));
    const hooks = R.hooks = { showStars: true, showTake: true, camera, addHeat(s, why) { R.heat = Math.min(6, R.heat + s); UI.setStars(Math.round(R.heat)); R.log.push('HEAT +' + s + ' ' + why); }, flag(k) { R.log.push('FLAG ' + k); }, alarm() {}, cops: () => R.cops || [], wallet: GT.wallet || { cash: 240, add(n) { this.cash += n; }, spend(n) { if (this.cash < n) return false; this.cash -= n; return true; }, on() {} },
      enterCar(c) { hint('（进入车辆——交还给游戏的上车流程）', 3); } };
    if (!auto && typeof addEventListener !== 'undefined') { addEventListener('keydown', e => { VI.set(e.code, true); }); addEventListener('keyup', e => VI.set(e.code, false)); addEventListener('mousedown', e => VI.set(e.button === 2 ? 'Mouse1' : 'Mouse0', true)); addEventListener('mouseup', e => VI.set(e.button === 2 ? 'Mouse1' : 'Mouse0', false)); addEventListener('contextmenu', e => e.preventDefault());
      addEventListener('mousemove', e => { if (e.buttons || document.pointerLockElement) { CAMR.yaw -= e.movementX * .004; CAMR.pitch = clamp(CAMR.pitch + e.movementY * .003, -.4, .7); VI.look.dx += e.movementX; } }); CAMR.follow = false; }
    const gy = (x, z, off) => inStoreAt(x, z) || off || (x > ST.x0 - 2.6 && x < ST.x0 + .5 && z > ST.z0 && z < ST.z1) ? PT.floorY : x > ST.x1 && x < ST.x1 + 1.4 && Math.abs(z - PT.back.z) < .9 ? .1 : (R.road && GT.road.groundHeight ? (GT.road.groundHeight(x, z) || 0) : 0);
    const collide = () => { for (const b of GT.world.boxes) { if (b.h < .5) continue; const nx = clamp(P.x, b.x0, b.x1), nz = clamp(P.z, b.z0, b.z1), dx = P.x - nx, dz = P.z - nz, d = hyp(dx, dz); if (d < .3 && d > 1e-4) { P.x = nx + dx / d * .3; P.z = nz + dz / d * .3; } } };
    R.step = (dt, adt) => { adt = adt === undefined ? dt : adt; R.t += dt;
      if (dt > 0) { while (R.evts.length && R.evts[0].t <= R.t) R.evts.shift().fn(); for (let i = R.whens.length - 1; i >= 0; i--) if (R.whens[i].cond()) R.whens.splice(i, 1)[0].fn(); }
      const mg = store.minigame, raw = store.raw, locked = !!(raw.office || (mg && mg.at)); if (auto && mg && mg.bot && dt > 0 && R.botOn !== false) mg.bot();
      if (!locked && dt > 0) {
        if (!auto) { const ax = (VI.down('KeyD') ? 1 : 0) - (VI.down('KeyA') ? 1 : 0), ay = (VI.down('KeyW') ? 1 : 0) - (VI.down('KeyS') ? 1 : 0), aimK = VI.down('Mouse1'), sp = aimK ? 1.4 : VI.down('ShiftLeft') ? 3.6 : 1.9; if (VI.pressed('KeyC')) P.crouch = !P.crouch;
          if (ax || ay) { const mh = CAMR.yaw + Math.atan2(-ax, ay); P.x += Math.sin(mh) * sp * dt; P.z += Math.cos(mh) * sp * dt; P.speed = sp; if (!aimK) P.h += angDiff(P.h, mh) * Math.min(1, dt * 10); collide(); } else P.speed = 0; if (aimK) { P.h += angDiff(P.h, CAMR.yaw) * Math.min(1, dt * 14); } P.yaw = CAMR.yaw; }
        else if (P.wp) { const w = P.wp[0], dx = w[0] - P.x, dz = w[1] - P.z, d = hyp(dx, dz), st = P.spd * dt; if (d <= st + .02) { P.x = w[0]; P.z = w[1]; P.wp.shift(); if (!P.wp.length) { P.wp = null; const f = P.then; P.then = null; if (f) f(); } } else { P.x += dx / d * st; P.z += dz / d * st; P.h += angDiff(P.h, Math.atan2(dx, dz)) * Math.min(1, dt * 9); } P.speed = P.spd; P.yaw = P.h; }
        else { P.speed = 0; if (P.aim) { const ty = Math.atan2(P.aim.x - P.x, P.aim.z - P.z); P.h += angDiff(P.h, ty) * Math.min(1, dt * 9); P.yaw = P.h; } else if (P.face !== undefined) { P.h += angDiff(P.h, P.face) * Math.min(1, dt * 8); P.yaw = P.h; } } }
      const ctx = { pos: P, h: P.h, yaw: P.yaw, crouch: P.crouch, speed: P.speed, inCar: false, cars: R.cars, npcs: R.npcs, input: VI, camera };
      update(dt, ctx); const pl = store.player; if (locked || raw.office || (store.minigame && store.minigame.at)) { P.x = pl.x; P.z = pl.z; P.h = pl.h; P.speed = pl.speed; }
      // figures
      const st = state.heroState || (P.speed > 2.7 ? 'run' : P.speed > .1 ? 'walk' : P.crouch ? 'crouch' : 'idle'); P.state = st; const py = gy(P.x, P.z, !!raw.office);
      P.fig.group.position.set(P.x, py, P.z); P.fig.group.rotation.y = P.h; P.fig.upd(adt, st, P.speed);
      const p2 = store.partner; if (partner.fig) { partner.fig.group.visible = p2.on; partner.fig.group.position.set(p2.x, gy(p2.x, p2.z, !!raw.office && p2.job === 'follow'), p2.z); partner.fig.group.rotation.y = p2.h; partner.fig.upd(adt, p2.anim, p2.speed); }
      for (const n of R.npcs) { const a = n.rb && n.rb.alerted ? 'phone' : n.anim; n.fig.group.rotation.y = n.h; n.fig.upd(adt, a, 0); }
      for (const c of R.cars) if (c.veh && c.veh.update) { try { c.veh.update(adt); } catch (e) {} }
      VIS.update(0);                                                                      // props follow the pose that was just written
      if (GT.station && GT.station.state) { const near = q => hyp(q.x - PT.door.x - .9, q.z - PT.door.z) < 2.3; GT.station.state.doorOpen = near(P) || (p2.on && near(p2)) || store.people.some(q => q.present && near(q)) ? 1 : 0; if (GT.station.update) GT.station.update(adt); }
      // camera
      if (!R.camFree) { const tk = store.takeover; let pos, look, fov;
        if (tk && tk.camera) { const c = tk.camera(); pos = c.pos; look = c.look; fov = c.fov || 50; }
        else { const aim = state.aiming, yaw = CAMR.follow ? P.h : CAMR.yaw; if (CAMR.follow) CAMR.yaw = yaw; const d = aim ? CAMR.aimDist || 1.5 : CAMR.dist, sd = aim ? .56 : CAMR.side, f = [Math.sin(CAMR.yaw), Math.cos(CAMR.yaw)], r = [-Math.cos(CAMR.yaw), Math.sin(CAMR.yaw)], cp = Math.cos(CAMR.pitch), hh = (P.crouch ? CAMR.h - .4 : CAMR.h) + py;
          const inS = inStoreAt(P.x, P.z), free = k2 => { const x = P.x - f[0] * d * cp * k2 + r[0] * sd * k2, z = P.z - f[1] * d * cp * k2 + r[1] * sd * k2; if (inS && !(x > ST.x0 + .55 && z > SF0 + .3 && z < 5.35 && (x < 56.75 || (z < -7.5 && x < 61.7)))) return false; for (const b of GT.world.boxes) if (b.h > 1.45 && x > b.x0 - .15 && x < b.x1 + .15 && z > b.z0 - .15 && z < b.z1 + .15) return false; return true; }; let kk = 1; while (kk > .3 && !free(kk)) kk -= .1;
          pos = [P.x - f[0] * d * cp * kk + r[0] * sd * kk, hh + Math.sin(CAMR.pitch) * d * kk + (1 - kk) * .12, P.z - f[1] * d * cp * kk + r[1] * sd * kk]; look = [P.x + f[0] * 5 + r[0] * sd * .7, hh - Math.sin(CAMR.pitch) * 5 - .12, P.z + f[1] * 5 + r[1] * sd * .7]; fov = aim ? 44 : CAMR.fov; }
        const C0 = CAMR.cur, k = C0 && dt > 0 ? 1 - Math.exp(-(CAMR.snap ? 60 : 7) * dt) : (C0 ? 0 : 1); if (!C0) CAMR.cur = { pos: pos.slice(), look: look.slice(), fov }; else { for (let i = 0; i < 3; i++) { C0.pos[i] += (pos[i] - C0.pos[i]) * k; C0.look[i] += (look[i] - C0.look[i]) * k; } C0.fov += (fov - C0.fov) * k; }
        const c = CAMR.cur; camera.position.set(c.pos[0], c.pos[1], c.pos[2]); camera.lookAt(c.look[0], c.look[1], c.look[2]); if (Math.abs(camera.fov - c.fov) > .05) { camera.fov = c.fov; camera.updateProjectionMatrix(); } }
      VI.end(); };
    return R; }
  /** scene scripts: every phase on a fixed, deterministic timeline */
  const SCENES = {
    store(R) { const P = R.player, s = PT.spots; store.config({ customers: 'none', shift: false }); reset({ seed: 2, clerk: { nerve: .55 } }); P.x = 47.2; P.z = DZ + .1; P.h = HP; R.addPartner(46.1, DZ + .8, HP);
      const cA = store.addCustomer({ x: s.north.x, z: s.north.z, h: s.north.h, nerve: .72, seed: 3, ptype: 'tourist' }), cB = store.addCustomer({ x: s.aisle.x, z: s.aisle.z, h: s.aisle.h, nerve: .3, seed: 8, ptype: 'sundress', anim: 'phone' });
      R.npc({ x: 48.35, z: -2.6, h: 1.9, seed: 4, type: 'jogger', y: .15 }); R.npc({ x: 33.6, z: -9.4, h: 1.3, seed: 6, type: 'worker', anim: 'talk' }); R.npc({ x: 34.5, z: -8.7, h: -1.9, seed: 9, type: 'oldman' });
      const ck = store.clerk, cam = R.cam; cam.follow = false; cam.yaw = HP; cam.dist = 2.5;
      R.at(.1, () => R.tap(KEY.mask)); R.at(.3, () => R.go([[51.9, DZ], [53.4, -3.2]], 2.1));
      R.at(5.0, () => { R.aim(ck); cam.yaw = HP - .35; }); R.at(6.1, () => R.tap(KEY.use)); R.at(7.4, () => R.tap('Digit1'));
      R.at(9.6, () => { R.aim(cA); cam.yaw = .55; }); R.at(12.6, () => { R.aim(null); cam.yaw = HP - .15; R.go([[PT.kase.x, PT.kase.z + .05]], 2); P.face = HP; });
      R.at(13.5, () => R.tap(KEY.use)); R.at(13.9, () => R.hold(KEY.use)); R.at(16.6, () => R.hold(KEY.use, false));
      R.at(16.9, () => { cam.follow = true; cam.dist = 2.2; R.go([PT.flapW, PT.flapE, [PT.lane + .08, PT.safe.z]], 3.1, () => { P.face = HP; }); });
      R.at(21.6, () => R.tap(KEY.use));
      R.when(() => R.t > 22 && !store.minigame && store.loot.safe.done, () => { R.after(.6, () => { R.go([[PT.lane, PT.flapE.z], [PT.staff.x - .15, PT.staff.z]], 3, () => { P.face = HP; }); }); R.after(3.4, () => R.tap(KEY.use)); R.after(6.2, () => R.hold(KEY.use)); R.after(11.2, () => { R.hold(KEY.use, false); R.tap(KEY.alt); }); }); return 12; },
    safe(R) { const P = R.player; store.config({ customers: 'none', shift: false }); reset({ seed: 5, clerk: { nerve: .62 } }); P.x = PT.front.x - .4; P.z = PT.front.z - .6; P.h = HP; R.addPartner(PT.cover.x - .6, PT.cover.z + .4, HP); store.setMask(true); const ck = store.clerk; R.cam.follow = false; R.cam.yaw = HP;
      R.at(.1, () => R.aim(ck)); R.at(1.2, () => R.tap('Digit1')); R.at(2.6, () => { R.aim(null); R.cam.follow = true; P.x = PT.flapE.x; P.z = PT.flapE.z; P.h = PI; R.go([[PT.lane + .08, PT.safe.z]], 3.2, () => { P.face = HP; }); }); R.at(4.6, () => R.tap(KEY.use)); return 9; },
    cctv(R) { const P = R.player; store.config({ customers: 'none', shift: false }); reset({ seed: 7, clerk: { nerve: .5 } }); P.x = PT.staff.x - .5; P.z = PT.staff.z - .5; P.h = PI - .4; store.setMask(true); const ck = store.clerk; R.cam.follow = false; R.cam.yaw = 2.6;
      R.at(.1, () => R.aim(ck)); R.at(2.2, () => { R.aim(null); R.go([[PT.staff.x - .1, PT.staff.z]], 2, () => { P.face = HP; }); }); R.at(3.0, () => R.tap(KEY.use)); R.at(5.2, () => R.hold(KEY.use)); R.at(9.6, () => R.hold(KEY.use, false)); R.at(10.6, () => R.tap(KEY.alt)); return 7.4; },
    _lot(R, kind, o, npcs) { store.config({ customers: 'none', shift: false }); reset({ seed: 9 }); const c = R.car(kind, 44.3, 9.2, HP, o), d = doorPos(c), P = R.player; P.x = d.x - 1.4; P.z = d.z - 3.4; P.h = 0; R.cam.follow = true; R.cam.dist = 2.5;
      R.npc({ x: 48.7, z: 2.2, h: -2.6, seed: 5, type: 'tourist', anim: 'phone', y: .15 }); if (npcs !== false) R.npc({ x: 35.5, z: 3.2, h: .3, seed: 12, type: 'worker' }); R.at(.2, () => R.go([[d.x, d.z - .3], [d.x, d.z]], 2, () => { P.face = d.h; })); return c; },
    slimjim(R) { const c = SCENES._lot(R, 'compact', { security: 'old', color: 0x7c6f5c, alarm: true }); R.at(2.4, () => R.tap(KEY.use)); R.when(() => cars.get(c).unlocked && !store.minigame, () => { R.after(.8, () => R.tap(KEY.use)); }); R.when(() => cars.get(c).started, () => R.after(1.2, () => R.tap(KEY.use))); return 4.4; },
    smash(R) { const c = SCENES._lot(R, 'pickup', { security: 'old', color: 0x39485a, alarm: true }); R.at(2.4, () => R.tap(KEY.alt)); R.at(4.2, () => R.tap(KEY.use)); R.when(() => cars.get(c).started, () => R.after(1.2, () => R.tap(KEY.use))); return 3.3; },
    cloner(R) { const c = SCENES._lot(R, 'sedan', { security: 'modern', color: 0x8d939a }, false), d = doorPos(c), P = R.player, ow = R.npc({ x: d.x - 3.6, z: d.z - 2.6, h: -HP - .3, seed: 2, type: 'oldman', anim: 'phone' }); c.owner = ow;
      R.at(2.4, () => R.tap(KEY.use)); R.at(3.2, () => R.go([[ow.x + 1.7, ow.z + .35]], 1.4, () => { P.face = -HP; })); R.when(() => cars.get(c).keyless, () => { P.crouch = false; R.go([[d.x, d.z]], 2, () => { P.face = d.h; R.hold(KEY.use); R.after(1.2, () => { R.hold(KEY.use, false); R.after(.5, () => R.tap(KEY.use)); }); }); }); return 6.2; },
    bypass(R) { const c = SCENES._lot(R, 'hero', { security: 'luxury', color: 0x1c3b46 }); R.at(2.4, () => R.tap(KEY.use)); R.when(() => cars.get(c).bypassed && !store.minigame, () => { R.after(.5, () => R.hold(KEY.use)); R.after(1.7, () => { R.hold(KEY.use, false); R.after(.5, () => R.tap(KEY.use)); }); }); return 7; } };
  GT.showcase.robbery = ({ scene, camera }) => { const Q = new URLSearchParams(location.search);
    if (Q.get('selftest')) { if (GT.station && GT.station.build) { try { GT.station.build(scene); } catch (e) {} } const out = selftest(); const pre = document.createElement('pre'); pre.id = 'rb-selftest'; pre.style.cssText = 'position:fixed;inset:0;margin:0;padding:26px 32px;background:#0b0e12;color:#d8dee6;font:12.5px/1.6 ui-monospace,Menlo,monospace;white-space:pre-wrap;z-index:60;overflow:auto'; pre.textContent = out.text; document.body.appendChild(pre); return { cam: [40, 6, 10], look: [55, 1, -4] }; }
    const name = SCENES[Q.get('scene')] && Q.get('scene')[0] !== '_' ? Q.get('scene') : 'store', lot = ['slimjim', 'smash', 'cloner', 'bypass'].indexOf(name) >= 0;
    let road = false; if (GT.road && GT.road.build && Q.get('road') !== '0') { try { GT.road.build(scene); road = true; } catch (e) { console.warn(e); } }
    if (!road) { const g = new T.Mesh(new T.PlaneGeometry(900, 900), GT.mat('asphalt')); g.rotation.x = -HP; g.position.y = -.02; g.receiveShadow = true; const uv = g.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 900, uv.getY(i) * 900); scene.add(g); }
    if (GT.station && GT.station.build) GT.station.build(scene);
    const R = makeRig(scene, camera, Q); R.road = road; init(scene, R.hooks); S.mute = true; const defAt = SCENES[name](R), at = Q.get('at') !== null ? +Q.get('at') : (R.auto ? defAt : 0), live = Q.get('live') === '1' || !R.auto || Q.get('at') === null && Q.get('auto') === null;
    R.cam.snap = true; for (let t = 0; t < at; t += 1 / 30) R.step(1 / 30); R.cam.snap = false; R.step(0, 0); GT.robbery.rig = R;
    if (Q.get('dbg')) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:8px;top:90px;color:#8f8;font:11px/1.4 monospace;z-index:30;background:rgba(0,0,0,.6);padding:4px 8px;white-space:pre'; document.body.appendChild(d); R.dbg = d; }
    return { cam: [44, 2, DZ], look: [56, 1.2, -4], hours: 18.2, update(dt) { R.step(live ? dt : 0, dt); if (!(GT.atmos && GT.atmos.update) || Q.get('atmos') === '0') GT.applyGlow((GT.env && GT.env.night) || 0);
      if (R.dbg) R.dbg.textContent = 't=' + R.t.toFixed(1) + ' phase=' + state.phase + ' alarm=' + state.alarm + ' clock=' + (state.clock === null ? '-' : state.clock.toFixed(0)) + ' take=' + state.take + '\n' + store.people.map(p => p.id + ' ' + p.mode + ' f' + p.fear.toFixed(2) + ' c' + p.comply.toFixed(2) + ' p' + p.panic.toFixed(2) + ' r' + p.reach.toFixed(2) + ' cov' + p.cover.toFixed(1)).join('\n') + '\n' + R.log.slice(-6).join('\n'); } }; };

  /* ================================================================== logic self-test (headless: no scene, no HUD) — showcase.html?m=robbery&selftest=1 */
  function selftest() {
    const out = []; let fails = 0; const line = (ok, msg) => { out.push((ok === null ? '      ' : ok ? 'PASS  ' : 'FAIL  ') + msg); if (ok === false) fails++; };
    const savedHooks = HOOKS, VI = mkInput(), calls = { heat: [], flag: [], unflag: [], alarm: [], enter: [], film: [] }, wallet = { cash: 100, add(n) { this.cash += n; }, spend(n) { if (this.cash < n) return false; this.cash -= n; return true; }, on() {} };
    const hooks = { hud: false, addHeat: (s, r) => calls.heat.push([s, r]), flag: k => calls.flag.push(k), unflag: k => calls.unflag.push(k), alarm: v => calls.alarm.push(v), say() {}, cops: () => [], wallet, enterCar: c => calls.enter.push(c), film: n => calls.film.push(n) };
    if (!inited) init(null, hooks); const ev = [], offs = ['start', 'alarm', 'loot', 'evidence', 'end', 'film', 'teleport'].map(n => on(n, d => { ev.push([n, d]); if (n === 'teleport') { pos.x = d.x; pos.z = d.z; ctx.h = ctx.yaw = d.h; } }));
    const pos = { x: 0, z: 0 }; let ctx = {}, bot = true;
    const run = (sec, until) => { for (let t = 0; t < sec; t += .05) { if (until && until()) return t; if (bot && S.mg && S.mg.bot) S.mg.bot(); update(.05, ctx); VI.end(); } return sec; };
    const place = (q, h) => { pos.x = q.x; pos.z = q.z; if (h !== undefined) ctx.h = ctx.yaw = h; };
    const fresh = o => { HOOKS = hooks; VI.clear(); reset(Object.assign({ mute: true, cfg: { customers: 'none', shift: false } }, o || {})); ev.length = 0; for (const k in calls) calls[k].length = 0; wallet.cash = 100; bot = true; ctx = { pos, h: HP, yaw: HP, input: VI, cars: [], npcs: [] }; place({ x: PT.door.x - 3, z: PT.door.z }, HP); run(.1); };
    const evs = n => ev.filter(e => e[0] === n), E = state.evidence, aimClerk = () => { place(PT.front, HP); VI.set('Mouse1', true); }, leave = () => { VI.set('Mouse1', false); place(PT.inside); run(.1); place({ x: PT.door.x - .6, z: PT.door.z }); run(.1); place({ x: PT.door.x - 60, z: PT.door.z }); run(.2); };
    const carOf = (kind, sec, o) => Object.assign({ kind, security: sec, x: 40, z: 14, h: PI, locked: true, dims: { L: 4.6, W: 1.85, H: 1.46, eye: [.37, 1.2, -.05] } }, o || {});
    try {
      // 1 — clean robbery: masked, clerk alone, keep him covered while he bags the register, walk out the front
      fresh({ clerk: { nerve: .45 } }); VI.tap(KEY.mask); run(.1); aimClerk(); const t1 = run(14, () => S.loot.reg.done); const c1 = C.clerk;
      line(S.started && S.startHow === 'aim' && evs('start').length === 1, 'clean: aiming at the clerk starts the hold-up (start event, how=' + S.startHow + ')');
      line(S.loot.reg.done && S.take === VAL.reg, 'clean: covered clerk bags the register in ' + t1.toFixed(1) + ' s (take ' + money(S.take) + ', fear ' + c1.fear.toFixed(2) + ', comply ' + c1.comply.toFixed(2) + ')');
      line(!c1.pressed && S.alarm === null, 'clean: no panic button while covered (reach ' + c1.reach.toFixed(2) + ')');
      line(E.face === 'unknown' && E.camera === 'logged' && E.weapon === 'logged' && E.vehicle === 'unknown', 'clean: evidence camera/face/clothes/weapon/partner/vehicle = ' + EV.map(k => E[k]).join(' / '));
      leave(); const e1 = evs('end')[0];
      line(!!e1 && e1[1].result === 'clean' && e1[1].exit === 'front' && S.done, 'clean: leaving by the front before any alarm ends the job "' + (e1 && e1[1].result) + '" (exit ' + (e1 && e1[1].exit) + ', stars ' + (e1 && e1[1].stars) + ')');
      line(wallet.cash === 100 + VAL.reg && calls.heat.every(h => h[0] < 2), 'clean: wallet credited ' + money(wallet.cash - 100) + ', heat calls ' + JSON.stringify(calls.heat.map(h => h[0])));
      line(calls.flag.indexOf('outfit') >= 0 && calls.flag.indexOf('weapon') >= 0 && calls.flag.indexOf('face') < 0, 'clean: hooks.flag got ' + calls.flag.join(',') + ' (no face: mask was on)');
      // 2 — panic-button path: work the safe alone, nobody covers the clerk
      fresh({ clerk: { nerve: .62 } }); VI.tap(KEY.mask); run(.1); aimClerk(); run(1.6); VI.set('Mouse1', false); place({ x: PT.safe.x - .12, z: PT.safe.z }, HP); run(.15); bot = false; VI.tap(KEY.use); run(.1);
      line(!!S.mg && S.mg.kind === 'safe', 'panic: floor safe opens the dial minigame (takeover, hero ' + (S.mg && S.mg.hero) + ')');
      const t2 = run(40, () => !!S.alarm), c2 = C.clerk, a2 = evs('alarm')[0];
      line(S.alarm === 'silent' && c2.pressed && !!a2 && a2[1].kind === 'silent', 'panic: uncovered clerk hits the silent alarm after ' + t2.toFixed(1) + ' s (alarm event kind=' + (a2 && a2[1].kind) + ', known=' + (a2 && a2[1].known) + ')');
      line(S.clock !== null && S.clock <= RESP.silent && S.clock > RESP.silent - 2, 'panic: response clock starts at ' + RESP.silent + ' s (now ' + (S.clock || 0).toFixed(1) + ')');
      run(12); line(S.alarmKnown && /警报|报警|走/.test(S.obj), 'panic: the scanner gives it away within 10 s; objective = "' + S.obj + '"');
      const r2a = S.risk; run(RESP.silent, () => S.arrived); line(S.arrived && calls.heat.some(h => h[0] === 3), 'panic: staying until the clock runs out -> police on scene, addHeat(3) (risk ' + r2a.toFixed(2) + ' -> ' + S.risk.toFixed(2) + ')');
      line(evs('alarm').some(e => e[1].kind === 'arrive'), 'panic: alarm events = ' + evs('alarm').map(e => e[1].kind).join(', '));
      // 3 — wipe the CCTV in the back office, leave by the back door
      fresh({ clerk: { nerve: .5 } }); VI.tap(KEY.mask); run(.1); aimClerk(); run(3.2); VI.set('Mouse1', false); line(E.camera === 'logged' && E.clothes === 'logged', 'wipe: tape + clerk log the robbery (camera ' + E.camera + ', clothes ' + E.clothes + ' from ' + Object.keys(store.sources().clothes).join('+') + ')');
      place(PT.staff, HP); run(.1); VI.tap(KEY.use); run(.1); line(!!S.office && !!TAKE && typeof TAKE.camera === 'function', 'wipe: staff door enters the back office (takeover with its own camera)');
      run(2.4); VI.set(KEY.use, true); const t3 = run(6, () => S.cams.wiped); VI.set(KEY.use, false);
      line(S.cams.wiped && E.camera === 'cleared' && E.clothes === 'logged' && Object.keys(store.sources().clothes).join() === 'clerk0', 'wipe: holding E for ' + t3.toFixed(1) + ' s formats the recorder -> camera ' + E.camera + '; clothes stay logged by the clerk only');
      VI.tap(KEY.alt); run(5, () => !S.office); line(!S.office && S.exit === 'back' && S.phase === 'escape' && pos.x > ST.x1, 'wipe: F leaves through the back door (exit ' + S.exit + ', player at x=' + pos.x.toFixed(1) + ')');
      place({ x: 130, z: -2 }); run(.2); line(S.done && S.result === 'clean', 'wipe: result "' + S.result + '"');
      // 3b — clean variant: case the place unmasked, wait for the shift change, come back masked; the only face on file is on the tape
      fresh({ clerk: { nerve: .5 }, cfg: { customers: 'none', shift: true } }); place(PT.front, HP); run(.5); const pb = PROMPTS.some(p => /买包烟/.test(p.label)); VI.tap(KEY.use); run(.2);
      line(pb && S.bought && S.cased && wallet.cash === 92, 'casing: buying first (prompt, $8 spent) marks the place cased; hint = "' + S.hint + '"');
      run(2); line(C.clerk.sawFace && S.faceOnTape, 'casing: the clerk and the camera have seen your face'); const oldId = C.clerk.id;
      place({ x: PT.door.x - 14, z: PT.door.z }); store.triggerShift(); const tg = run(20, () => S.shift.stage === 2); line(S.shift.stage === 2 && !clerkHere(), 'shift: the clerk walks to the back after ' + tg.toFixed(1) + ' s; the counter is unattended');
      run(30, () => S.shift.stage === 0); line(S.shift.stage === 0 && clerkHere() && !C.clerk.sawFace && C.clerk.id !== oldId, 'shift: a new clerk takes over who never saw you (' + oldId + ' -> ' + C.clerk.id + ')');
      place({ x: PT.door.x - 3, z: PT.door.z }); run(.2); VI.tap(KEY.mask); run(.1); aimClerk(); run(3); VI.set('Mouse1', false);
      line(E.face === 'logged' && Object.keys(store.sources().face).join() === 'tape', 'shift: face is logged, but only from the earlier tape (' + Object.keys(store.sources().face).join() + ')');
      place(PT.staff, HP); run(.1); VI.tap(KEY.use); run(2.6); VI.set(KEY.use, true); run(6, () => S.cams.wiped); VI.set(KEY.use, false); line(E.face === 'cleared' && E.camera === 'cleared' && calls.unflag.indexOf('face') >= 0, 'shift: wiping the recorder clears FACE and CAMERA (hooks.unflag: ' + calls.unflag.join(',') + ')');
      // 4 — partner orders: he covers, you crack the safe; then swap roles
      fresh({ clerk: { nerve: .6 } }); VI.tap(KEY.mask); run(.1); const p2 = store.addPartner({ x: PT.front.x - .8, z: PT.front.z + .6 }); aimClerk(); run(1); VI.tap('Digit1'); run(2.5); VI.set('Mouse1', false);
      line(P2.job === 'cover' && P2.arrived && C.clerk.cover > .9, 'partner: key 1 "看住店员" -> 阿烈 covers the clerk (cover ' + C.clerk.cover.toFixed(2) + ', anim ' + p2.anim + ')');
      place({ x: PT.safe.x - .12, z: PT.safe.z }, HP); run(.15); VI.tap(KEY.use); const t4 = run(45, () => S.loot.safe.done), sum = VAL.safe.reduce((a, b) => a + b, 0);
      line(S.loot.safe.done && S.take >= sum && !C.clerk.pressed && S.alarm === null, 'partner: three tumblers in ' + t4.toFixed(1) + ' s with the clerk covered (take ' + money(S.take) + ', no alarm, loot events ' + evs('loot').length + ')');
      line(E.partner === 'logged', 'partner: PARTNER chip is ' + E.partner); run(.3); VI.tap('Digit2'); const t4b = run(16, () => S.loot.reg.done);
      line(S.loot.reg.done && S.take === sum + VAL.reg && P2.job === 'cover' && evs('loot').some(e => e[1].by === 'partner'), 'partner: key 2 "清收银机" -> 阿烈 empties the register in ' + t4b.toFixed(1) + ' s (take ' + money(S.take) + ')');
      fresh({ clerk: { nerve: .6 } }); VI.tap(KEY.mask); run(.1); store.addPartner({ x: PT.front.x - .8, z: PT.front.z + .6 }); aimClerk(); run(.6); VI.tap('Digit3'); const t4c = run(60, () => { ctx.yaw = Math.atan2(C.clerk.x - pos.x, C.clerk.z - pos.z); return S.loot.safe.done; });
      line(S.loot.safe.done && !C.clerk.pressed, 'partner: key 3 "去开保险柜" -> 阿烈 cracks it himself in ' + t4c.toFixed(1) + ' s while you keep the clerk covered');
      // 5 — a customer you cannot see: shouting tells her what is going on, she phones it in
      fresh({ clerk: { nerve: .5 } }); const cu = store.addCustomer({ x: PT.spots.aisle.x, z: PT.spots.aisle.z, h: PI, nerve: .3 }); VI.tap(KEY.mask); run(.1); aimClerk(); run(1.2); line(cu.mode === 'browse' && !cu.vis, 'customer: hidden behind the gondolas she has not noticed yet (mode ' + cu.mode + ')');
      VI.tap(KEY.use); run(.2); const nz = S.noise; const t5 = run(20, () => !!S.alarm); line(nz > .3 && S.alarm === 'call' && S.alarmWhy === 'customer-phone', 'customer: a shout (noise ' + nz.toFixed(2) + ') sends her into hiding; she calls it in after ' + t5.toFixed(1) + ' s (alarm ' + S.alarm + ', clock ' + RESP.call + ' s)');
      fresh({ clerk: { nerve: .5 } }); const cv = store.addCustomer({ x: PT.spots.north.x, z: PT.spots.north.z, h: -2.4, nerve: .75 }); VI.tap(KEY.mask); run(.1); aimClerk(); run(8, () => cv.mode === 'sneak'); line(cv.mode === 'sneak', 'customer: one gun, two people — the uncovered one edges for the door (mode ' + cv.mode + ')');
      place(PT.front, Math.atan2(cv.x - PT.front.x, cv.z - PT.front.z)); run(1.5); line(cv.mode === 'held' && cv.cover > .5, 'customer: turning the gun on him stops him (mode ' + cv.mode + '), and now the clerk is uncovered (cover ' + C.clerk.cover.toFixed(2) + ')');
      // 6 — loud alarm: ATM with and without the tool, lottery case
      fresh({}); place(PT.atm, HP); run(.2); line(PROMPTS.some(p => /需要撬棍/.test(p.label) && p.dim), 'atm: without a pry bar the prompt reads "' + (PROMPTS[0] && PROMPTS[0].label) + '"'); VI.set(KEY.use, true); run(3); line(!S.started && S.take === 0, 'atm: nothing happens without the tool'); VI.set(KEY.use, false);
      fresh({ tools: { crowbar: true } }); place(PT.atm, HP); run(.2); VI.set(KEY.use, true); const t6 = run(12, () => S.loot.atm.done); VI.set(KEY.use, false);
      line(S.loot.atm.done && S.alarm === 'loud' && calls.alarm[0] === true && S.take === VAL.atm, 'atm: prying takes ' + t6.toFixed(1) + ' s, trips the LOUD alarm (hooks.alarm(true), clock ' + RESP.loud + ' s), take ' + money(S.take));
      line(!GT.station || !GT.station.state || GT.station.state.alarm === true, 'atm: station alarm strobe/bell state set');
      fresh({}); VI.tap(KEY.mask); VI.tap(KEY.arm); run(.1); place(PT.kase, HP); run(.2); VI.tap(KEY.use); run(.2); const nk = S.noise; VI.set(KEY.use, true); run(3.2, () => S.loot.kase.done); VI.set(KEY.use, false);
      line(S.loot.kase.done && nk >= .5 && S.take === VAL.kase && S.started, 'case: smash (noise ' + nk.toFixed(2) + ') + hold to scoop -> ' + money(S.take));
      // 7 — outside witnesses through the glass, filming, the car you leave in
      fresh({ clerk: { nerve: .5 } }); const w = { x: ST.x0 - 1.6, z: PT.front.z + .4, h: HP }; ctx.npcs = [w]; VI.tap(KEY.mask); run(.1); aimClerk(); const t7 = run(12, () => w.rb && w.rb.alerted);
      line(w.rb.alerted && evs('film').length === 1 && calls.film.length === 1, 'witness: a passer-by sees the hold-up through the glass after ' + t7.toFixed(1) + ' s and films it (film event + hooks.film)');
      run(4, () => !!S.alarm); line(S.alarm === 'call' && S.alarmWhy === 'witness-outside', 'witness: ...and calls it in (alarm ' + S.alarm + ')'); VI.set('Mouse1', false); place({ x: PT.door.x - 1, z: PT.door.z }); run(.2); ctx.inCar = true; run(.2);
      line(E.vehicle === 'logged', 'witness: getting into a car in front of him logs VEHICLE (' + E.vehicle + ')'); store.clear('vehicle', 'swapped'); line(E.vehicle === 'cleared', 'witness: store.clear("vehicle") after a car swap -> ' + E.vehicle); ctx.inCar = false;
      // 8 — car theft tiers
      fresh({}); let car = carOf('compact', 'old', { alarm: true }); ctx.cars = [car]; place(doorPos(car), doorPos(car).h); run(.1); line(PROMPTS.length === 2 && PROMPTS[0].label === '撬锁' && PROMPTS[1].label === '砸窗', 'old car: prompts "' + PROMPTS.map(p => p.key + ' ' + p.label).join(' / ') + '"');
      VI.tap(KEY.use); run(.1); const k8 = S.mg && S.mg.kind; const t8 = run(25, () => cars.get(car).unlocked); line(k8 === 'slimjim' && cars.get(car).unlocked && cars.get(car).method === 'slimjim', 'old car: slim-jim minigame, notch found and caught in ' + t8.toFixed(1) + ' s (fumbles ' + cars.get(car).fumbles + ')');
      run(.2); VI.tap(KEY.use); run(.1); const k8b = S.mg && S.mg.kind; const t8b = run(20, () => cars.get(car).started); line(k8b === 'hotwire' && cars.get(car).started, 'old car: hot-wire (3 contacts) in ' + t8b.toFixed(1) + ' s');
      run(.2); VI.tap(KEY.use); run(.1); line(calls.enter.length === 1 && cars.get(car).stolen && evs('loot').some(e => e[1].what === 'car') && E.vehicle === 'unknown', 'old car: "上车" hands over to hooks.enterCar; quiet job leaves VEHICLE ' + E.vehicle);
      fresh({}); car = carOf('compact', 'old', { alarm: true }); ctx.cars = [car]; place(doorPos(car), doorPos(car).h); run(.1); VI.tap(KEY.use); run(.1); bot = false; for (let i = 0; i < 3; i++) { VI.tap(KEY.use); run(.2); }
      line(cars.get(car).fumbles === 3 && !!cars.get(car).alarm && S.noise > .5, 'old car: three fumbles are loud (noise ' + S.noise.toFixed(2) + ') and set the car alarm off');
      fresh({}); car = carOf('pickup', 'old', { alarm: true }); ctx.cars = [car]; place(doorPos(car), doorPos(car).h); run(.1); VI.tap(KEY.alt); run(.1); let rc = cars.get(car);
      line(rc.broken && rc.unlocked && S.noise >= .7 && !!rc.alarm && E.vehicle === 'logged', 'smash: instant, loud (noise ' + S.noise.toFixed(2) + '), alarm on, VEHICLE ' + E.vehicle + ' (broken window)');
      line(TH.alarmLeft !== null && TH.alarmLeft > 7, 'smash: ' + (TH.alarmLeft || 0).toFixed(1) + ' s before someone looks'); run(8.5); line(calls.heat.some(h => h[0] === 1) && evs('alarm').some(e => e[1].kind === 'car-look') && E.clothes === 'logged', 'smash: still at the car when they look -> addHeat(1), CLOTHES ' + E.clothes + ' (alarm events ' + evs('alarm').map(e => e[1].kind).join(', ') + ')');
      bot = true; VI.tap(KEY.use); run(.1); run(20, () => rc.started); line(rc.started && !rc.alarm, 'smash: hot-wiring kills the alarm');
      fresh({}); car = carOf('sedan', 'modern'); ctx.cars = [car]; place(doorPos(car), doorPos(car).h); run(.1); line(PROMPTS[0].label === '克隆钥匙', 'modern car: prompt "' + PROMPTS.map(p => p.label).join(' / ') + '"'); VI.tap(KEY.use); const t9 = run(15, () => cars.get(car).keyless); rc = cars.get(car);
      line(rc.keyless && rc.unlocked && rc.method === 'cloner' && E.vehicle === 'unknown', 'modern car: key cloned off the door handle in ' + t9.toFixed(1) + ' s, unnoticed'); VI.set(KEY.use, true); run(1.2); VI.set(KEY.use, false); line(rc.started, 'modern car: push-button start (hold E)');
      run(125); line(E.vehicle === 'logged', 'modern car: the owner reports it two minutes later -> VEHICLE ' + E.vehicle);
      fresh({}); car = carOf('sedan', 'modern'); const dp = doorPos(car); car.owner = { x: dp.x - 2.2, z: dp.z, h: HP }; ctx.cars = [car]; place(dp, dp.h); run(.1); VI.tap(KEY.use); run(.1); const t9b = run(8, () => !TH.clone); rc = cars.get(car);
      line(!rc.keyless && rc.lock > 0 && calls.heat.length === 1 && E.clothes === 'logged' && E.face === 'logged', 'modern car: cloning in the owner\'s line of sight gets you made after ' + t9b.toFixed(1) + ' s (addHeat(1), FACE + CLOTHES logged)');
      fresh({}); car = carOf('sedan', 'modern'); const dq = doorPos(car); car.owner = { x: dq.x - 2.2, z: dq.z, h: -HP }; ctx.cars = [car]; place(dq, dq.h); run(.1); VI.tap(KEY.use); const t9c = run(8, () => cars.get(car).keyless);
      line(cars.get(car).keyless && calls.heat.length === 0, 'modern car: behind the owner\'s back the signal is strong — cloned in ' + t9c.toFixed(1) + ' s');
      fresh({}); car = carOf('hero', 'luxury'); ctx.cars = [car]; place(doorPos(car), doorPos(car).h); run(.1); line(PROMPTS[0].label === '破解防盗', 'luxury car: prompt "' + PROMPTS.map(p => p.label).join(' / ') + '"'); VI.tap(KEY.use); run(.1); const k10 = S.mg && S.mg.kind; const t10 = run(40, () => cars.get(car).bypassed); rc = cars.get(car);
      line(k10 === 'bypass' && rc.bypassed && rc.report < 0, 'luxury car: immobiliser sequence matched 3 rounds in ' + t10.toFixed(1) + ' s, clean (tracker never wakes)'); VI.set(KEY.use, true); run(1.2); VI.set(KEY.use, false); line(rc.started, 'luxury car: push-button start');
      fresh({}); car = carOf('hero', 'luxury'); ctx.cars = [car]; place(doorPos(car), doorPos(car).h); run(.1); VI.tap(KEY.use); run(.1); bot = false; const mg = S.mg; run(8, () => mg.phase === 'input'); VI.tap(PADS[(mg.seq[0] + 1) % 4]); run(.1);
      line(mg.mistakes === 1 && mg.tamper > .3, 'luxury car: a wrong pad raises the tamper meter (' + mg.tamper.toFixed(2) + ') and replays the round');
      // 9 — public state + housekeeping
      fresh({}); const keys = ['phase', 'take', 'noise', 'evidence', 'clock', 'risk']; line(keys.every(k => k in state) && EV.every(k => state.evidence[k] === 'unknown') && state.clock === null && state.phase === 'idle', 'state: { ' + keys.join(', ') + ' } present, fresh evidence all unknown');
      S.noise = 1; run(5); line(S.noise === 0, 'state: noise decays to 0'); place(PT.inside, HP); run(.2); line(state.phase === 'casing' && state.inStore, 'state: walking in unmasked -> phase "' + state.phase + '"');
      VI.tap(KEY.mask); run(3); line(C.clerk.alert >= 1 && C.clerk.reach > 0 && !S.started, 'state: walking in masked alarms the clerk early (alert ' + C.clerk.alert.toFixed(2) + ', hand already drifting ' + C.clerk.reach.toFixed(2) + ')');
      // 10 — GT.act / GT.onfoot contract (a stub controller stands in for onfoot.js)
      fresh({ clerk: { nerve: .5 } }); const ids = SPOTS.map(s => s.id), reg = GT.act && GT.act.list ? ids.filter(id => GT.act.list.some(s => s.id === id)).length : (GT._actQueue && GT._actQueue.length) || 0;
      line(SPOTS.every(s => typeof s.onUse === 'function' && typeof s.enabled === 'function' && s.label && s.mode === 'foot') && reg >= (GT.act ? ids.length : 1), 'act: ' + ids.length + ' store spots in GT.act shape (' + (GT.act ? reg + ' registered with GT.act' : 'queued in GT._actQueue') + ')');
      const hadAct = GT.act; if (!GT.act) GT.act = { add() {}, list: [] }; const tk = [], tps = []; ctx.ctl = { pos, h: HP, camera: { yaw: HP }, state: 'idle', speed: 0, enabled: true, armed: false, takeover(o) { tk.push(o); return {}; }, teleport(x, z, h) { tps.push([x, z, h]); pos.x = x; pos.z = z; }, say() {}, partner: null };
      VI.tap(KEY.mask); run(.1); aimClerk(); run(1.5); VI.set('Mouse1', false); place({ x: PT.safe.x - .12, z: PT.safe.z }, HP); ctx.ctl.camera.yaw = HP; run(.2);
      const sp = SPOTS.find(s => s.id === 'rb-safe'); line(actMode && PROMPTS.length === 0 && sp.enabled({}), 'act: with a controller present my own prompts stay silent and the safe spot is enabled for GT.act'); sp.onUse({ ctl: ctx.ctl });
      run(.2); line(!!S.mg && tk.length === 1 && tk[0].heroState === 'crouch' && typeof tk[0].camera === 'function' && tk[0].update() === false && tps.length === 1 && ctx.ctl.armed === true, 'act: spot.onUse -> ctl.teleport + ctl.takeover({heroState:"crouch", camera, update}) and ctl.armed is set');
      run(40, () => S.loot.safe.done); line(S.loot.safe.done && tk[0].update() === true, 'act: takeover.update() returns true once the safe is done'); if (!hadAct) delete GT.act; delete ctx.ctl;
    } catch (e) { line(false, 'self-test threw: ' + (e && e.stack || e)); }
    offs.forEach(f => f()); HOOKS = savedHooks; reset({ mute: false });
    out.unshift('SUNSET HEAT — robbery.js logic self-test', ''); out.push('', fails ? fails + ' FAILED' : 'ALL PASS (' + (out.length - 3) + ' checks)');
    if (typeof document !== 'undefined') document.title = fails ? 'selftest FAIL' : 'selftest PASS'; return { text: out.join('\n'), fails, lines: out }; }
  api.selftest = selftest;
})();
