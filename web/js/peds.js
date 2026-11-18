/* peds.js — the people of 月湾大道 Moonbay Drive (TF, 2026-11-17). Coast map only; ?pd=0 turns it off, &pdn=<n> sets the pool (48).
   They are ordinary records of js/people.js's crowd (GT.cngame.G.pop, added with pop.addDef, driven by group controllers registered in pop.ctl), so everything the crowd already does
   applies unchanged: being punched, shot or run over, falling and getting up, fighting back or phoning it in, witnesses for the wanted level, the blood, the dropped wallet.
   Pool and rings: the pool stays within 140 m of the player — 40 % on the park walk by the beach, 35 % on the hotel-side pavement, 25 % on the lawn and the benches; whoever is left
   140 m behind comes back 100–135 m away (walking towards him, out of the camera's view). js/people.js updates them on the 30 / 80 / 140 m rings (def.rings: every frame, every other, 10 Hz).
   Characters (js/people.js types; the Rocketbox models carry the faces): influencers (walk 20–30 s, stop for a selfie / a clip / a live stream, phone in hand; in trouble they film 3 s first,
   then run), skaters and joggers (2.2 × walking pace round the sea side of the park walk; a siren nearby and they are gone), hotel valets (wait at the drop-off bay of js/traffic.js, open the
   door for whoever pulls in, show the guest in; at gunfire they get behind the porch wall), sunburnt tourists (aloha shirts, a drink, slow, stand at the kerb looking about, cross at the lights;
   in trouble they curl up or run in circles). The ordinary walkers and sitters of js/coast.js stay as they were.
   States on top of the crowd's own: idle → walk → (brushed by the player) stagger and grumble → (shoved / brushed again) square up and fight (the crowd's 'fight' temper) →
   (a gun / a shot) run, curl up or film → (all clear) walk on; hit or run over → down → up (the crowd's hurt states).
   English barks (audio/barks, js/samples.js bark): bump, gunpoint, flee, film, road (drivers, from js/traffic.js), near (a car brushing past), push. No captions: the crowd's Chinese lines
   are kept off the screen on this map (G.barkOff) and turned into the matching English category. At most two at a time nearby, eight seconds between two from one person.
   API: GT.peds = { active, bark(cat, x, z, o), guest(x, z, tx, tz), stats(), S, selftest() }. */
(function () {
  'use strict';
  const GT = window.GT; if (!GT) return;
  const QS = new URLSearchParams(location.search), PI = Math.PI, TAU = PI * 2, HP = PI / 2, abs = Math.abs, min = Math.min, max = Math.max, hyp = Math.hypot, sin = Math.sin, cos = Math.cos;
  const cl = (v, a, b) => v < a ? a : v > b ? b : v, rnd = Math.random, adiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; }, rr = (a, b) => a + (b - a) * rnd();
  const XP = z => -24 + 6.2 * sin(z * TAU / 74 + .6);   /* the park walk's centre line (js/coast_beach.js xp) */
  const NPOOL = QS.get('pdn') !== null ? max(0, +QS.get('pdn')) : 44, FAR = 140;
  const S = { on: false, ready: false, t: 0, list: [], addQ: [], log: [], act: [], man: null, lastCat: {}, lastId: {}, sir: [], nv: [], recT: 0, nmT: 0, lastShot: -99, stats: { bumps: 0, shoves: 0, fights: 0, nearMiss: 0, recycled: 0, drops: 0, guests: 0, crossings: 0, films: 0, cowers: 0, panics: 0, covers: 0, sirenRuns: 0, handsup: 0, barks: 0, barkPlayed: 0, barkSkip: 0, ms: 0 } };
  const api = GT.peds = { active: false, S, bark, guest, stats, selftest, mapBark };
  S.on = api.active = QS.get('world') === 'coast' && QS.get('pd') !== '0' && QS.get('pop') !== '0' && QS.get('selftest') !== '1';

  let g = null, G = null, P = null, pop = null;
  const ground = (x, z) => { try { return g.groundY(x, z, 0); } catch (e) { return 0; } };
  const isOld = n => /old|granny/.test(n.type || ''), isF = n => !!(n.fig && n.fig.spec && n.fig.spec.female) || /_f$|sundress|beach_f|jogger$|oldwoman|tourist_f|patron_f|local_f/.test(n.type || '');
  const isYoung = n => /student|skater|jogger|beach|streamer|sundress/.test(n.type || '') || (n.def && /tfJog|tfInfl/.test(n.def.ctl || ''));
  const voiceOf = n => (isF(n) ? 'f' : 'm') + (isOld(n) ? 'O' : isYoung(n) ? 'Y' : 'A');

  /* ================================================================== barks */
  /** bark(cat, x, z, {npc, voice}) → the clip id played (or logged) | null. Two at a time within 32 m of the listener, 8 s between two from one person, 1.2 s between two of a category. */
  function bark(cat, x, z, o) { o = o || {}; const n = o.npc || null, now = S.t; if (!S.man) return null; const L = listener(); if (hyp(x - L.x, z - L.z) > 32) return null;
    if (n && !o.force && now - (n.tfBarkT === undefined ? -99 : n.tfBarkT) < 8) { S.stats.barkSkip++; return null; }   /* force: an escalation (grumble -> squaring up) is said even right after the first line */ if (now - (S.lastCat[cat] === undefined ? -99 : S.lastCat[cat]) < 1.2) { S.stats.barkSkip++; return null; }
    let busy = 0; for (const a of S.act) if (a.until > now && hyp(a.x - L.x, a.z - L.z) < 34) busy++; if (busy >= 2) { S.stats.barkSkip++; return null; }
    const v = o.voice || (n ? voiceOf(n) : 'mA'), id = pickClip(cat, v); if (!id) return null; const clip = S.man[id];
    let played = 0; try { if (GT.samples && GT.samples.bark) played = GT.samples.bark(id, { x, z, g: cat === 'film' || cat === 'gunpoint' ? .85 : 1 }) || 0; } catch (e) { played = 0; }
    const dur = played || clip.dur || 1.5; S.act.push({ until: now + dur + .15, x, z }); if (S.act.length > 8) S.act.shift(); if (n) n.tfBarkT = now; S.lastCat[cat] = now; S.lastId[cat] = id;
    S.stats.barks++; if (played) S.stats.barkPlayed++; S.log.push({ t: +now.toFixed(1), cat, id, text: clip.text, played: !!played, who: n ? n.type : (o.from ? 'driver' : '-') }); if (S.log.length > 60) S.log.shift(); return id; }
  function pickClip(cat, v) { const M = S.man, ids = []; for (const id in M) if (M[id].cat === cat && M[id].voice === v) ids.push(id); if (!ids.length) for (const id in M) if (M[id].cat === cat && M[id].voice[0] === v[0]) ids.push(id); if (!ids.length) for (const id in M) if (M[id].cat === cat) ids.push(id);
    if (!ids.length) return null; let id = ids[(rnd() * ids.length) | 0]; if (ids.length > 1 && id === S.lastId[cat]) id = ids[(ids.indexOf(id) + 1) % ids.length]; return id; }
  function listener() { const cam = g && g.camera; if (G && G.phase !== 'play' && cam) return cam.position; return P || { x: 0, z: 0 }; }
  /** the crowd's own bark (Chinese text, js/people.js say) → the English category for this situation, or null (idle chatter stays silent) */
  function mapBark(n, cat) { const a = n && n.reactA, ty = a && a.type, H = n && n.hurt;
    if (cat === 'film') return 'film'; if (cat === 'gun') return ty === 'gunpoint' ? 'gunpoint' : 'flee';
    if (cat === 'flee') { if (n && n.mode === 'hurt') return H && H.gun ? 'flee' : (n.temper === 'fight' ? 'push' : null); return ty === 'gunshot' ? 'flee' : ty === 'gunpoint' ? 'gunpoint' : ty === 'crash' || ty === 'horn' || ty === 'scooter_near' ? 'near' : null; }
    if (cat === 'aside' || cat === 'scold') return 'bump'; if (cat === 'horn' || cat === 'scooter') return 'near'; return null; }

  /* ================================================================== props: a phone for the influencers, a cup for the tourists (on the crowd skeleton's hand prop bones: shown only while the pose holds them) */
  let PHONE = null, CUP = null;
  function props() { const T = window.THREE; if (PHONE || !T) return; const pg = new T.BoxGeometry(.009, .15, .072); pg.translate(.02, .005, .006); const sg = new T.PlaneGeometry(.062, .134); sg.rotateY(HP); sg.translate(.0255, .005, .006);
    PHONE = { g: pg, m: new T.MeshStandardMaterial({ color: 0x0d0e12, roughness: .25, metalness: .4 }), sg, sm: new T.MeshBasicMaterial({ color: 0x9fc8ff, side: T.DoubleSide }) };
    const cg = new T.CylinderGeometry(.04, .033, .14, 12); cg.translate(0, -.03, .035); CUP = { g: cg, m: new T.MeshStandardMaterial({ color: 0xf2ece0, roughness: .6 }), lid: new T.MeshStandardMaterial({ color: 0xd8463a, roughness: .5 }) }; }
  /* everyone in the pool carries a phone (shown only in the poses that hold one: no draw call otherwise); the influencers always have it out when they pose */
  const PHONE_ST = { film: 1, selfie: 1, livestream: 1, phone_look: 1, phone_call: 1, phone: 1, squat_phone: 1 };
  function attachProps(n) { const f = n.fig; if (n.tfProps || !f || !f.attach) return; props(); const T = window.THREE; if (!PHONE) return; n.tfProps = 1; const d = n.def;
    if (d.ctl !== 'tfGuest' && d.ctl !== 'tfSit') { const g0 = new T.Group(); g0.add(new T.Mesh(PHONE.g, PHONE.m)); g0.add(new T.Mesh(PHONE.sg, PHONE.sm)); g0.visible = false; f.attach(g0, 'propR'); n.tfPhone = g0; }
    if (d.cup) { const g1 = new T.Group(); g1.add(new T.Mesh(CUP.g, CUP.m)); f.attach(g1, 'propL'); n.tfCup = g1; } }

  /* ================================================================== zones and lines
     'walk': the park walk, x = XP(z) + off (sea side negative) · 'side': the hotel pavement, x = off · 'west': the sea-side pavement of the avenue, x = off */
  const lineX = (d, z) => d.zone === 'walk' ? XP(z) + d.off : d.off;
  const OBS = { side: [], walk: [], west: [] };
  function obstacles() { const B = (GT.world && GT.world.boxes) || []; for (const k in OBS) OBS[k].length = 0;
    for (const b of B) { if (!(b.h > .35) || b.x1 - b.x0 > 6 || b.z1 - b.z0 > 14) continue; const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, hx = (b.x1 - b.x0) / 2;
      if (cx > 6.6 && cx < 11.4) OBS.side.push([cz, (b.z1 - b.z0) / 2, cx, hx]); else if (cx > -10.6 && cx < -6.4) OBS.west.push([cz, (b.z1 - b.z0) / 2, cx, hx]); else if (abs(cx - XP(cz)) < 3.4) OBS.walk.push([cz, (b.z1 - b.z0) / 2, cx - XP(cz), hx]); }
    for (const k in OBS) OBS[k].sort((a, b) => a[0] - b[0]); }
  /** sideways shift to clear whatever stands on the line in the next 2.6 m (0 when clear) */
  function swerve(d, z, lat, dir) { const A = OBS[d.zone]; if (!A || !A.length) return 0; let lo = 0, hi = A.length; const za = min(z, z + dir * 2.6) - 1.5; while (lo < hi) { const m = (lo + hi) >> 1; if (A[m][0] < za) lo = m + 1; else hi = m; }
    for (let i = lo; i < A.length && A[i][0] < max(z, z + dir * 2.6) + 1.5; i++) { const o = A[i]; if (abs(o[0] - z) > o[1] + 2.6) continue; const ox = o[2], w = o[3] + .42; if (abs(lat - ox) < w) return (lat >= ox ? 1 : -1) * (w - abs(lat - ox) + .05); } return 0; }
  function go(n, tx, tz, sp, dt) { const th = Math.atan2(tx - n.x, tz - n.z); n.h += adiff(n.h, th) * min(1, dt * 6); const st = sp * dt * max(.25, cos(adiff(n.h, th))); n.x += sin(n.h) * st; n.z += cos(n.h) * st; const gy = ground(n.x, n.z); n.y += (gy - n.y) * min(1, dt * 12); return hyp(tx - n.x, tz - n.z); }
  function walkLine(n, dt, sp) { const d = n.def, m = n.mem, dir = m.dir; m.swT = (m.swT || 0) - dt;
    if (m.swT <= 0) { m.swT = .2; m.sw = swerve(d, n.z, d.off, dir); } let tz = n.z + dir * 2.2, tx = lineX(d, tz) + (m.sw || 0);
    if (P && P.mode === 'foot' && n.dist < 2.6) { const fx = sin(n.h), fz = cos(n.h), rx = P.x - n.x, rz = P.z - n.z, ah = rx * fx + rz * fz, lt = rx * fz - rz * fx; if (ah > -.2 && abs(lt) < .8) { tx += (lt > 0 ? -1 : 1) * fz * .9; if (n.dist < 1) sp *= .5; } }   /* the player in the way: step round him */
    go(n, tx, tz, sp, dt); }

  /* ================================================================== the controllers (js/people.js CTL: init / step / exit / react) */
  const SPD = { tfWalk: [1.05, 1.4], tfTour: [.72, .9], tfInfl: [1, 1.25], tfJog: [2.6, 3.1] };
  function initLine(n) { const d = n.def, m = n.mem; m.dir = d.dir || 1; m.sp = d.speed || rr(SPD[d.ctl][0], SPD[d.ctl][1]); m.ph = 'walk'; m.t = d.ctl === 'tfInfl' ? rr(8, 26) : rr(10, 30); m.sw = 0; m.swT = 0; m.bump = null; m.al = null; n.seated = false; }
  /* the player brushing past: stagger and grumble; a shove (running into them) or the second brush: the brave ones square up (the crowd's fight temper), the rest stagger away */
  function bumpCheck(n, dt) { const m = n.mem; if (m.bump) { m.bump.t += dt; const b = m.bump; if (b.t < .55) { n.state = 'stagger'; n.speed = 0; n.x += b.vx * dt; n.z += b.vz * dt; return true; } if (b.t < 2.3) { n.state = 'scold'; n.speed = 0; n.h += adiff(n.h, Math.atan2(P.x - n.x, P.z - n.z)) * min(1, dt * 6); n.lookAt = n.look.set(P.x, (P.y || 0) + 1.5, P.z); return true; } m.bump = null; return false; }
    if (!P || P.mode !== 'foot' || n.dist > 1.05 || (P.down || 0) > 0) return false; const dx = n.x - P.x, dz = n.z - P.z, dd = hyp(dx, dz) || .01, ps = P.speed || 0; if (dd > .78 || ps < .9) return false;
    const toward = (sin(P.h) * dx + cos(P.h) * dz) / dd; if (toward < .35 || S.t - (m.bumpT === undefined ? -99 : m.bumpT) < 1.5) return false;
    m.bumps = S.t - (m.bumpT === undefined ? -99 : m.bumpT) < 9 ? (m.bumps || 0) + 1 : 1; m.bumpT = S.t; const shove = ps > 3.4 || m.bumps >= 2; S.stats.bumps++;
    if (shove && n.brave > .52 && !isOld(n) && pop.hurt) { S.stats.shoves++; S.stats.fights++; bark('push', n.x, n.z, { npc: n, force: true }); try { pop.hurt(n, 0, dx / dd, dz / dd, { push: 1.1, quiet: true }); } catch (e) { /* crowd off */ } n.temper = 'fight'; return true; }
    if (shove) S.stats.shoves++; m.bump = { t: 0, vx: dx / dd * (shove ? 1.4 : .7), vz: dz / dd * (shove ? 1.4 : .7) }; bark('bump', n.x, n.z, { npc: n }); return true; }
  /* a gun pointed straight at me (within 9 m, inside 20° of his aim): hands up for as long as it stays there */
  function aimedAt(n) { const C = GT.combat && GT.combat.player; if (!C || !C.aimDir || !P) return false; const dx = n.x - P.x, dz = n.z - P.z, d = hyp(dx, dz); if (d > 9 || d < .4) return false; return (dx * C.aimDir.x + dz * C.aimDir.z) / d > .94; }
  function reactCommon(n, a, d, scared) { const m = n.mem; if (a.type === 'gunpoint' && aimedAt(n)) { m.al = { kind: 'handsup', a, t: 0 }; S.stats.handsup++; return true; } if (a.type === 'gunshot') S.lastShot = S.t; return undefined; }
  function alarmStep(n, dt) { const m = n.mem, al = m.al; if (!al) return false; al.t += dt; const live = pop.alerts.indexOf(al.a) >= 0;
    if (al.kind === 'handsup') { n.state = 'handsup'; n.speed = 0; n.h += adiff(n.h, Math.atan2(P.x - n.x, P.z - n.z)) * min(1, dt * 5); if (al.t > .25 && !al.said) { al.said = 1; bark('gunpoint', n.x, n.z, { npc: n }); } if (!live && al.t > 1.5 && !aimedAt(n)) { m.al = null; flee(n, al.a, 6); } return true; }
    if (al.kind === 'film') { n.state = 'film'; n.speed = 0; n.h += adiff(n.h, Math.atan2(al.a.x - n.x, al.a.z - n.z)) * min(1, dt * 5); if (al.t > .3 && !al.said) { al.said = 1; bark('film', n.x, n.z, { npc: n }); S.stats.films++; } if (al.t > al.dur) { m.al = null; if (al.then) flee(n, al.a, 8); } return true; }
    if (al.kind === 'panic') { n.state = 'flee'; const sp = 3.6 + n.brave * .8; n.speed = sp; al.ct -= dt; if (al.ct <= 0) { al.ct = .5 + rnd() * .7; al.h += (rnd() < .5 ? -1 : 1) * rr(.6, 1.7); if (pop.fleeDir) al.h = pop.fleeDir(n, al.a.x, al.a.z, al.h); }   /* running in circles: a new heading every half second or so, still away from the trouble and round walls */
      if (al.t < .3 && !al.said) { al.said = 1; bark(al.a.type === 'gunpoint' ? 'gunpoint' : 'flee', n.x, n.z, { npc: n }); } go(n, n.x + sin(al.h) * 3, n.z + cos(al.h) * 3, sp, dt); if (al.t > al.dur) m.al = null; return true; }
    if (al.kind === 'cover') { const c = al.cov, left = hyp(c.x - n.x, c.z - n.z); if (left > .35 && !al.in) { n.state = 'flee'; n.speed = 3.9; go(n, c.x, c.z, 3.9, dt); } else { al.in = 1; n.state = 'cower'; n.speed = 0; n.h += adiff(n.h, c.h) * min(1, dt * 4); }
      if (al.t > .4 && !al.said) { al.said = 1; bark('flee', n.x, n.z, { npc: n }); } if (S.t - S.lastShot > 9 && !live && al.t > 6) m.al = null; return true; }
    m.al = null; return false; }
  /** hand over to the crowd's own flight (doReact 'flee': steers round walls, keeps off the carriageway), then back to this controller */
  function flee(n, a, T1) { n.prevMode = 'ctl'; n.mode = 'react'; n.react = 'flee'; n.reactA = a; n.reactT = 0; n.delay = 0; n.fleeT = T1 || 7.5; n.fleeH = Math.atan2(n.x - a.x, n.z - a.z) + (rnd() - .5) * .9; n.steerT = 0; }

  const CTL = {
    tfWalk: { init(n) { initLine(n); attachProps(n); },
      step(n, dt) { const m = n.mem; if (alarmStep(n, dt) || bumpCheck(n, dt)) return; m.t -= dt;
        if (m.ph === 'stop') { n.state = m.st; n.speed = 0; if (m.t <= 0) { m.ph = 'walk'; m.t = rr(18, 40); } return; }
        if (m.t <= 0) { m.ph = 'stop'; m.t = rr(4, 9); m.st = n.def.stops[(rnd() * n.def.stops.length) | 0]; return; } n.state = 'walk'; n.speed = m.sp; walkLine(n, dt, m.sp); },
      react: (n, a, d, scared) => reactCommon(n, a, d, scared) },
    /* skaters and joggers: the sea side of the park walk at 2.2 × walking pace; a siren within 50 m and they leave the walk for the sand side at a sprint */
    tfJog: { init(n) { initLine(n); n.def.off = n.mem.dir > 0 ? -1.3 : -.6; },
      step(n, dt) { const m = n.mem; if (alarmStep(n, dt) || bumpCheck(n, dt)) return; let sp = m.sp; const skate = n.def.type === 'skater';
        if (m.leave > 0) { m.leave -= dt; sp *= 1.65; n.state = skate ? 'skate' : 'run'; n.speed = sp; walkLine(n, dt, sp); return; }
        for (const k of S.sir) if (hyp(k.x - n.x, k.z - n.z) < 50) { m.leave = 6 + rnd() * 3; m.dir = n.z > k.z ? 1 : -1; n.def.off = m.dir > 0 ? -1.3 : -.6; S.stats.sirenRuns++; return; }   /* a siren: off down the walk, away from it, at a sprint */
        n.state = skate ? 'skate' : 'jog'; n.speed = sp; walkLine(n, dt, sp); },
      react: (n, a, d, scared) => { const r = reactCommon(n, a, d, scared); if (r !== undefined) return r; return scared ? 'flee' : (a.type === 'siren' || a.type === 'horn' ? 'look' : undefined); } },
    /* influencers: walk 20–30 s, stop and shoot (selfie / clip / live), phone always in hand while posing; trouble: film 3 s, then run */
    tfInfl: { init(n) { initLine(n); attachProps(n); },
      step(n, dt) { const m = n.mem; attachProps(n); if (alarmStep(n, dt) || bumpCheck(n, dt)) return; m.t -= dt;
        if (m.ph === 'pose') { n.state = m.st; n.speed = 0; n.h += adiff(n.h, m.ph0) * min(1, dt * 2); if (m.t <= 0) { m.ph = 'walk'; m.t = rr(20, 30); } return; }
        if (m.t <= 0) { m.ph = 'pose'; m.t = rr(7, 12); m.st = ['selfie', 'film', 'livestream', 'selfie'][(rnd() * 4) | 0]; m.ph0 = n.def.zone === 'side' ? (m.st === 'selfie' ? HP : -HP) + rr(-.4, .4) : -HP + rr(-.6, .6); return; }
        n.state = 'walk'; n.speed = m.sp; walkLine(n, dt, m.sp); },
      react: (n, a, d, scared) => { const r = reactCommon(n, a, d, scared); if (r !== undefined) return r; if (scared || a.type === 'fight' || a.type === 'crash') { n.mem.al = { kind: 'film', a, t: 0, dur: scared ? 3 : 6 + rnd() * 4, then: scared }; return true; } return undefined; } },
    /* sunburnt tourists: a slow stroll with a drink, a stop now and then to look about at the kerb; now and then over the avenue at the lights */
    tfTour: { init(n) { initLine(n); attachProps(n); },
      step(n, dt) { const m = n.mem, d = n.def; attachProps(n); if (alarmStep(n, dt) || bumpCheck(n, dt)) return; m.t -= dt;
        if (m.ph === 'look') { n.state = m.st; n.speed = 0; m.lt -= dt; if (m.lt <= 0) { m.lt = rr(1.2, 2.4); const a = rr(-1.3, 1.3) + (d.zone === 'side' ? -HP : d.zone === 'west' ? HP : -HP); n.look.set(n.x + sin(a) * 8, n.y + 1.5, n.z + cos(a) * 8); } n.lookAt = n.look; if (m.t <= 0) { m.ph = m.cross ? 'kerb' : 'walk'; m.t = rr(16, 34); } return; }
        if (m.ph === 'kerb' || m.ph === 'cross') { crossStep(n, dt); return; }
        if (m.t <= 0) { m.ph = 'look'; m.t = rr(5, 9); m.lt = 0; m.st = rnd() < .5 ? 'drink' : 'idle'; m.cross = (d.zone === 'side' || d.zone === 'west') && rnd() < .3; return; }
        n.state = 'walk'; n.speed = m.sp; walkLine(n, dt, m.sp); },
      react: (n, a, d, scared) => { const r = reactCommon(n, a, d, scared); if (r !== undefined) return r; if (!scared) return undefined; if (n.brave < .5 || d < 6) { S.stats.cowers++; return 'cower'; }
        S.stats.panics++; n.mem.al = { kind: 'panic', a, t: 0, ct: .4, h: Math.atan2(n.x - a.x, n.z - a.z), dur: 5 + rnd() * 4 }; return true; } },
    /* valets: wait at the bay, open the door for whoever pulls in, show the guest in; at gunfire, behind the porch wall until it has been quiet a while */
    tfValet: { init(n) { const m = n.mem; m.ph = 'stand'; n.seated = false; },
      step(n, dt) { const m = n.mem, d = n.def, s = d.slot, st = d.stand; if (alarmStep(n, dt)) { if (s && s.valet === n) s.valet = null; m.ph = 'back'; return; } if (bumpCheck(n, dt)) return; m.t = (m.t || 0) + dt;
        const car = s && s.car; if (m.ph === 'stand') { const left = hyp(st.x - n.x, st.z - n.z); if (left > .3) { n.state = 'walk'; n.speed = 1.2; go(n, st.x, st.z, 1.2, dt); return; } n.state = 'kibitz'; n.speed = 0; n.h += adiff(n.h, -HP + .25) * min(1, dt * 3);
          if (car && s.st === 'dwell' && !s.valet && car.alive) { s.valet = n; s.done = false; m.ph = 'toCar'; m.t = 0; } return; }
        if (!car || !car.alive || (s.st !== 'dwell' && m.ph !== 'back')) { if (s && s.valet === n) s.valet = null; if (m.ph !== 'back') m.ph = 'back'; }
        if (m.ph === 'toCar') { const r = (car.dims.W / 2) + .55, dx = -cos(car.h) * r + sin(car.h) * .35, dz = sin(car.h) * r + cos(car.h) * .35, left = go(n, car.x + dx, car.z + dz, 1.7, dt); n.state = 'walk'; n.speed = 1.7; if (left < .3 || m.t > 9) { m.ph = 'open'; m.t = 0; } return; }
        if (m.ph === 'open') { n.state = 'point'; n.speed = 0; n.h += adiff(n.h, Math.atan2(car.x - n.x, car.z - n.z)) * min(1, dt * 6); if (m.t > .9 && !s.open) { s.open = true; S.stats.drops++; const r = car.dims.W / 2 + 1.1; guest(car.x - cos(car.h) * r - sin(car.h) * .6, car.z + sin(car.h) * r - cos(car.h) * .6, s.door.x, s.door.z); } if (m.t > 1.5) { m.ph = 'welcome'; m.t = 0; } return; }
        if (m.ph === 'welcome') { n.state = 'wave'; n.speed = 0; n.h += adiff(n.h, HP) * min(1, dt * 3); if (m.t > 2) { s.done = true; m.ph = 'back'; m.t = 0; } return; }
        const left = hyp(st.x - n.x, st.z - n.z); if (left > .3) { n.state = 'walk'; n.speed = 1.3; go(n, st.x, st.z, 1.3, dt); } else { m.ph = 'stand'; if (s && s.valet === n && s.st !== 'dwell') s.valet = null; } },
      react: (n, a, d, scared) => { const r = reactCommon(n, a, d, scared); if (r !== undefined) return r; if (!scared) return undefined; S.stats.covers++; const st = n.def.stand; n.mem.al = { kind: 'cover', a, t: 0, cov: { x: 11.75, z: st.z + (n.def.coverDz || 1.6), h: -HP } }; return true; } },
    /* sitters on the benches and the lawn */
    tfSit: { init(n) { n.seated = !!n.def.seat; }, step(n, dt) { if (alarmStep(n, dt)) return; n.state = n.def.pose; n.speed = 0; n.x = n.home.x; n.z = n.home.z; n.h += adiff(n.h, n.home.h) * min(1, dt * 3); }, react: (n, a, d, scared) => reactCommon(n, a, d, scared) },
    /* the guest stepping out of a car at a hotel bay; parked out of sight otherwise */
    tfGuest: { init(n) { n.mem.ph = 'park'; }, step(n, dt) { const m = n.mem; if (m.ph === 'park') { n.state = 'idle'; n.speed = 0; if (n.group) n.group.visible = false; return; }
        if (n.group) n.group.visible = true; const left = go(n, m.tx, m.tz, 1.15, dt); n.state = 'walk'; n.speed = 1.15; if (left < .5 || (m.t = (m.t || 0) + dt) > 20) { m.ph = 'park'; if (n.group) n.group.visible = false; } } }
  };
  /* tourists crossing: to the kerb, wait for the walk light at a crossing (or a gap mid-block, one in four), over, then on along the other pavement */
  const XING = [-44, 66];
  function crossStep(n, dt) { const m = n.mem, d = n.def, side = d.zone === 'side' ? 1 : -1;
    if (m.ph === 'kerb') { if (m.cz === undefined) { const zc = XING.reduce((b, z) => abs(z - n.z) < abs(b - n.z) ? z : b, XING[0]); m.cz = abs(zc - n.z) < 40 ? zc : (rnd() < .25 ? n.z + m.dir * 4 : null); if (m.cz === null) { m.ph = 'walk'; m.cz = undefined; return; } m.jay = abs(m.cz - zc) > 3; }
      const kx = side * 6.95, left = go(n, kx, m.cz, m.sp, dt); n.state = 'walk'; n.speed = m.sp; if (left > .35) return; n.state = 'idle'; n.speed = 0; n.h += adiff(n.h, side > 0 ? -HP : HP) * min(1, dt * 4); n.look.set(n.x, n.y + 1.5, n.z + (rnd() < .5 ? 12 : -12)); n.lookAt = n.look;
      let ok = false; const SG = GT.cnroad && GT.cnroad.signals; if (!m.jay && SG && SG.state) { try { const s = SG.state(m.cz); ok = s && s.ped === 'walk'; } catch (e) { ok = false; } }
      else if (m.jay) { ok = true; const TF = GT.traffic && GT.traffic.cars; if (TF) for (const c of TF) if (c.alive && abs(c.x) < 6.5 && abs(c.z - m.cz) < 22 && abs(c.v) > 1) { ok = false; break; } }
      m.wait = (m.wait || 0) + dt; if (ok || m.wait > 40) { m.ph = 'cross'; m.wait = 0; S.stats.crossings++; } return; }
    const tx = -side * 7.6, left = go(n, tx, m.cz, max(m.sp, 1.15), dt); n.state = 'walk'; n.speed = max(m.sp, 1.15); if (left < .4) { d.zone = side > 0 ? 'west' : 'side'; d.off = d.zone === 'west' ? (m.dir > 0 ? -8.3 : -8.9) : (m.dir > 0 ? 8.85 : 8.3); m.ph = 'walk'; m.cz = undefined; m.t = rr(20, 40); } }

  /* ================================================================== the guest of a drop-off */
  function guest(x, z, tx, tz) { for (const n of S.list) { if (n.def.ctl !== 'tfGuest' || !n.active || n.mem.ph !== 'park') continue; n.x = x; n.z = z; n.y = ground(x, z); n.h = Math.atan2(tx - x, tz - z); n.mem.ph = 'walk'; n.mem.tx = tx; n.mem.tz = tz; n.mem.t = 0; n.snap = true; S.stats.guests++; return n; } return null; }

  /* ================================================================== setup: the plan (who, where), added a few a frame */
  const W_TYPES = ['local_m', 'local_f', 'sundress', 'patron_m', 'patron_f', 'guest', 'local_m', 'sundress', 'oldman', 'oldwoman'], B_TYPES = ['beach_f', 'local_f', 'beach_m', 'sundress', 'local_m', 'oldman', 'oldwoman'];
  function plan() { const out = [], pz = P ? P.z : -34, z0 = () => cl(pz + rr(-85, 85), -440, 440), seeds = {}; const sd = t => { seeds[t] = ((seeds[t] || 0) + 1) % 7; return 600 + seeds[t] * 11 + t.length; };
    const k = NPOOL / 48, cnt = v => Math.max(0, Math.round(v * k));
    const add = (ctl, type, zone, extra) => { const dir = rnd() < .5 ? 1 : -1, z = extra && extra.z !== undefined ? extra.z : z0(); const off = zone === 'walk' ? (dir > 0 ? rr(-.2, .5) : rr(.6, 1.2)) : zone === 'side' ? (dir > 0 ? rr(8.75, 8.95) : rr(8.2, 8.4)) : (dir > 0 ? rr(-8.4, -8.15) : rr(-9.05, -8.8));
      out.push(Object.assign({ grp: 'tf', type, ctl, zone, off, dir, x: zone === 'walk' ? XP(z) + off : off, z, h: dir > 0 ? 0 : PI, sched: [[0, 24, 'walk']], pri: 0, rings: true, far: FAR, seed: sd(type), stops: ['phone_look', 'drink', 'idle', 'phone_call'] }, extra || {})); };
    /* the park walk (40 %) */
    for (let i = 0; i < cnt(3); i++) add('tfInfl', ['sundress', 'local_f', 'local_m'][i % 3], 'walk', { phone: 1, kit: { phone: 0x0c0d10 } });
    for (let i = 0; i < cnt(7); i++) add('tfJog', ['skater', 'beach_f', 'jogger_m', 'skater', 'beach_f', 'jogger_m', 'skater'][i % 7], 'walk');   /* the women run in beachwear (the Rocketbox set has no running kit for them; the bikini model reads right on a beach walk) */
    for (let i = 0; i < cnt(3); i++) add('tfTour', i % 2 ? 'tourist_f' : 'tourist', 'walk', { cup: 1, kit: { propL: 'cup' } });
    for (let i = 0; i < cnt(6); i++) add('tfWalk', B_TYPES[i % B_TYPES.length], 'walk');
    /* the hotel pavement (35 %) */
    for (let i = 0; i < cnt(2); i++) add('tfInfl', ['local_f', 'sundress'][i % 2], 'side', { phone: 1, kit: { phone: 0x0c0d10 } });
    for (let i = 0; i < cnt(4); i++) add('tfTour', i % 2 ? 'tourist_f' : 'tourist', i < 3 ? 'side' : 'west', { cup: 1, kit: { propL: 'cup' } });
    for (let i = 0; i < cnt(7); i++) add('tfWalk', W_TYPES[i % W_TYPES.length], i % 4 === 3 ? 'west' : 'side');
    const slots = (GT.traffic && GT.traffic.slots) || [], H = ((GT.coast && GT.coast.C && GT.coast.C.hotels) || []).filter(h => abs((h[0] + h[1]) / 2) < 120); let nv = 0;
    for (const s of slots) { if (nv >= 4) break; out.push({ grp: 'tf', type: nv % 2 ? 'patron_m' : 'guest', ctl: 'tfValet', zone: 'side', slot: s, stand: { x: s.stand.x, z: s.stand.z }, x: s.stand.x, z: s.stand.z, h: -HP, sched: [[0, 24, 'kibitz']], pri: 0, rings: true, far: FAR, seed: 620 + nv, brave: .3 }); nv++; }
    for (const h of H) { if (nv >= 4) break; const zc = (h[0] + h[1]) / 2; if (slots.some(s => abs(s.z - zc) < 25)) continue; out.push({ grp: 'tf', type: 'patron_m', ctl: 'tfValet', zone: 'side', slot: null, stand: { x: 7.9, z: zc + 2 }, x: 7.9, z: zc + 2, h: -HP, sched: [[0, 24, 'kibitz']], pri: 0, rings: true, far: FAR, seed: 630 + nv, brave: .3 }); nv++; }
    /* the lawn and the benches (25 %) */
    const benches = []; for (let z = -460, kk = 0; z < 460; z += 17, kk++) { const kz = -160 + kk * 17; if (kk % 3 === 1) continue; const zz = kz; if (zz > 460) break; if ([-2, 58, 118, 178, -62, -122, -182, 238, -242, 298, -302, 358, -362, 418, -422].some(a => abs(zz - a) < 4)) continue; const s = kk % 2 ? 1 : -1, ry = s > 0 ? -HP : HP; benches.push({ x: XP(zz) + s * 2.6 + Math.sin(ry) * .15, z: zz, h: ry }); }
    S.benches = benches; const lawnPose = ['sit_ground', 'sunbathe', 'talk_group', 'phone_look', 'stretch', 'sit_ground'];
    for (let i = 0; i < cnt(10); i++) { const z = z0(); if (i % 2 === 0) { let b = null, bd = 1e9; for (const q of benches) { const dz = abs(q.z - z); if (dz < bd && !out.some(o => o.bench === q)) { bd = dz; b = q; } } if (b) { out.push({ grp: 'tf', type: W_TYPES[(i * 3) % W_TYPES.length], ctl: 'tfSit', zone: 'lawn', bench: b, x: b.x, z: b.z, h: b.h, y: undefined, seat: .46, pose: 'sit_bench', sched: [[0, 24, 'sit_bench']], pri: 0, rings: true, far: FAR, seed: sd('bench') }); continue; } }
      const lz = z, lx = rr(XP(lz) + 3.6, -12.2), ps = lawnPose[i % lawnPose.length]; out.push({ grp: 'tf', type: ps === 'sunbathe' ? 'beach_f' : B_TYPES[i % B_TYPES.length], ctl: 'tfSit', zone: 'lawn', x: lx, z: lz, h: rr(-PI, PI), pose: ps, sched: [[0, 24, ps]], pri: 0, rings: true, far: FAR, seed: sd('lawn') }); }
    /* two guests for the drop-offs */
    for (let i = 0; i < 2; i++) out.push({ grp: 'tf', type: i ? 'sundress' : 'patron_m', ctl: 'tfGuest', zone: 'side', x: 20, z: pz, h: 0, sched: [[0, 24, 'idle']], pri: 0, rings: true, far: FAR, seed: 640 + i, noReact: true });
    for (const d of out) { d.mdFar = 42; d.shadow = 24; }   /* the textured model out to 42 m, the one-mesh figure past it; sun shadows out to 24 m (js/people.js def.mdFar / def.shadow) */
    return out; }
  function setup() { g = GT.cngame; G = g && g.G; P = g && g.player; pop = G && G.pop; if (!pop || !pop.addDef || !pop.ctl || !GT.coast || !GT.coast.C) return false; if (GT.traffic && GT.traffic.active && !(GT.traffic.S && GT.traffic.S.ready)) return false;
    for (const k in CTL) pop.ctl[k] = CTL[k]; obstacles(); G.barkOff = true;   /* no captions on this map: the lines are spoken (English) */
    S.addQ = plan(); g.on('bark', d => { try { const cat = mapBark(d.npc, d.bark && d.bark.cat); if (cat && d.npc) bark(cat, d.npc.x, d.npc.z, { npc: d.npc }); } catch (e) { /* never into the crowd's frame */ } });
    g.on('npc:hurt', d => { if (d && d.npc && d.npc.def && d.npc.def.ctl === 'tfValet' && d.npc.def.slot && d.npc.def.slot.valet === d.npc) d.npc.def.slot.valet = null; });
    fetch('audio/barks/manifest.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(m => { S.man = m || null; }, () => { S.man = null; });
    S.ready = true; return true; }
  function addBatch() { let k = 0; while (S.addQ.length && k < 3) { const d = S.addQ.shift(); const n = pop.addDef(d); S.list.push(n); k++; } try { pop.reschedule(); } catch (e) { console.warn('[peds] reschedule', e); } }

  /* ================================================================== the pool: whoever is left 140 m behind comes back 100–135 m away, walking towards the player, out of view */
  function inView(x, z) { const cam = g.camera; if (!cam) return false; const e = cam.matrixWorld.elements, fx = -e[8], fz = -e[10], l = hyp(fx, fz) || 1, dx = x - cam.position.x, dz = z - cam.position.z, d = hyp(dx, dz) || 1; return (dx * fx + dz * fz) / (d * l) > .3 && d < 125; }
  function recycle() { let k = 0; for (const n of S.list) { if (k >= 3) break; if (!n.active || n.dist <= FAR || n.mode !== 'ctl' || n.def.ctl === 'tfValet' || n.def.ctl === 'tfGuest') continue; const d = n.def, m = n.mem;
      if (d.ctl === 'tfSit') { const B = d.bench ? S.benches : null; let placed = false; for (let t = 0; t < 8 && !placed; t++) { const z = cl(P.z + (rnd() < .5 ? -1 : 1) * rr(45, 110), -440, 440); if (inView(XP(z) + 4, z) && t < 6) continue;
          if (B) { let b = null, bd = 1e9; for (const q of B) { const dz = abs(q.z - z); if (dz < bd && !S.list.some(o => o.def.bench === q)) { bd = dz; b = q; } } if (!b) continue; d.bench = b; d.x = b.x; d.z = b.z; d.h = b.h; } else { d.x = rr(XP(z) + 3.6, -12.2); d.z = z; }
          n.home.x = n.x = d.x; n.home.z = n.z = d.z; n.home.h = n.h = d.h; n.y = n.home.y = ground(n.x, n.z); placed = true; } if (placed) { n.snap = true; k++; S.stats.recycled++; } continue; }
      let side = rnd() < .5 ? 1 : -1, z = 0, ok = false; for (let t = 0; t < 6 && !ok; t++) { z = cl(P.z + side * (t < 4 ? rr(50, 110) : rr(105, 135)), -440, 440); const x = lineX(d, z); if (t >= 4 || !inView(x, z)) ok = true; else side = -side; } if (!ok) continue;   /* back out of view 50–110 m away (or, when everything near is in the picture, 105–135 m ahead) */
      m.dir = z > P.z ? -1 : 1; if (d.ctl === 'tfJog') d.off = m.dir > 0 ? -1.3 : -.6; else if (d.zone === 'side') d.off = m.dir > 0 ? rr(8.75, 8.95) : rr(8.2, 8.4); else if (d.zone === 'west') d.off = m.dir > 0 ? rr(-8.4, -8.15) : rr(-9.05, -8.8);
      n.z = z; n.x = lineX(d, z); n.h = m.dir > 0 ? 0 : PI; n.y = ground(n.x, n.z); n.home.x = n.x; n.home.z = n.z; n.snap = true; m.ph = 'walk'; m.al = null; m.bump = null; m.cz = undefined; k++; S.stats.recycled++; } }
  /* cars brushing past people: 'near' from whoever it nearly took, and they jump aside (the crowd's 'scooter_near' dodge) */
  function nearMiss() { const NV = S.nv; NV.length = 0; const F = listener(); for (const c of G.ents) { if (!c.alive || c.two || abs(c.v || 0) < 6 || hyp(c.x - F.x, c.z - F.z) > 50) continue; NV.push(c); } if (!NV.length) return;
    for (const n of pop.list) { if (!n.active || n.vis === false || n.dist > 45 || n.mode === 'hurt' || n.ko || n.seated) continue; for (const c of NV) { const dx = n.x - c.x, dz = n.z - c.z, f = sin(c.h), gg = cos(c.h), al = dx * f + dz * gg, lt = abs(dx * gg - dz * f); if (al < -1 || al > c.dims.L / 2 + 3 || lt > c.dims.W / 2 + 1.25 || lt < c.dims.W / 2 + .2) continue;
        if (S.t - (n.tfNmT === undefined ? -99 : n.tfNmT) < 12) continue; n.tfNmT = S.t; S.stats.nearMiss++; bark('near', n.x, n.z, { npc: n }); try { pop.emit('scooter_near', n.x, n.z, 1.5, 1); } catch (e) { /* crowd off */ } break; } } }

  /* ================================================================== the frame (own rAF: the pool and the barks need not run in step with the simulation) */
  let last = performance.now();
  function tick(now) { requestAnimationFrame(tick); const dt = min(.1, (now - last) / 1000); last = now; if (!S.on) return; const t0 = performance.now();
    try { g = GT.cngame; G = g && g.G; if (!G || !G.pop) return; P = g.player; pop = G.pop; if (!S.ready) { if (G.phase === 'boot' || !setup()) return; }
      if (S.addQ.length) addBatch(); if (!S.bk && GT.samples && GT.samples.ready && GT.samples.barks) { S.bk = 1; GT.samples.barks(); }   /* the bark clips start decoding once the recorded layer is up */
      if (G.paused || G.phase !== 'play') return; S.t += dt;
      S.sir.length = 0; for (const k of G.cops) if (k.alive && k.lights && k.lights.siren) S.sir.push(k);
      const far = P.mode === 'car' ? (+QS.get('pdfar') || 85) : FAR;   /* at the wheel the pool is drawn out to 85 m, not 140: the street goes by too fast to miss them, and the frame needs the room */
      for (const n of S.list) { if (!n.tfProps && n.fig) attachProps(n); const ph = n.tfPhone; if (ph) { const on = !!PHONE_ST[n.state] && n.vis !== false && n.dist < 60; if (ph.visible !== on) ph.visible = on; } if (n.def.far !== far && n.def.ctl !== 'tfGuest') { n.def.far = far; n.def.mdFar = P.mode === 'car' ? 24 : 42; } }   /* and the textured model only to 24 m: past it the one-mesh figure */
      if ((S.recT -= dt) <= 0) { S.recT = .25; recycle(); } nearMiss(); } catch (e) { if (!S.err) { S.err = 1; console.warn('[peds] tick', e); } }
    S.stats.ms += performance.now() - t0; }
  if (S.on) requestAnimationFrame(tick);

  function stats() { const by = {}, zone = {}; let act = 0, vis = 0, w140 = 0; for (const n of S.list) { if (n.active) act++; if (n.vis) vis++; if (n.active && n.dist < 140) w140++; by[n.def.ctl] = (by[n.def.ctl] || 0) + 1; zone[n.def.zone] = (zone[n.def.zone] || 0) + 1; }
    const all = pop && pop.list ? pop.list.filter(n => n.active && n.dist < 140).length : 0, near = pop && pop.list ? pop.list.filter(n => n.active && n.dist < 60).length : 0;
    return { on: S.on, ready: S.ready, pool: S.list.length, queued: S.addQ.length, active: act, visible: vis, within140: w140, crowd140: all, crowd60: near, by, zone, man: S.man ? Object.keys(S.man).length : 0, st: Object.assign({}, S.stats, { ms: +S.stats.ms.toFixed(1) }), log: S.log.slice(-12) }; }

  /* ================================================================== pure-logic checks for cn.html?selftest=1 */
  function selftest() { const out = [], ok = (b, m) => out.push((b ? 'PASS  ' : 'FAIL  ') + m), sv = { man: S.man, t: S.t, act: S.act.slice(), lc: Object.assign({}, S.lastCat), on: S.on }, gS = g, PS = P;
    S.man = { a_0_fO: { cat: 'bump', voice: 'fO', text: 'a', dur: 1 }, a_1_mY: { cat: 'bump', voice: 'mY', text: 'b', dur: 1 }, f_0_fA: { cat: 'flee', voice: 'fA', text: 'c', dur: 1.5 }, f_1_mA: { cat: 'flee', voice: 'mA', text: 'd', dur: 1.5 }, g_0_mA: { cat: 'gunpoint', voice: 'mA', text: 'e', dur: 1 } };
    g = null; P = { x: 0, z: 0 }; S.act.length = 0; S.lastCat = {}; S.t = 100;
    const old = { type: 'oldwoman', fig: { spec: { female: true } }, def: {} }, kid = { type: 'skater', fig: { spec: { female: false } }, def: { ctl: 'tfJog' } };
    ok(voiceOf(old) === 'fO' && voiceOf(kid) === 'mY' && voiceOf({ type: 'local_m', def: {} }) === 'mA', 'peds barks: voices by who speaks — an old woman fO, a skater mY, a man in the street mA');
    const n1 = { type: 'oldwoman', fig: { spec: { female: true } }, def: {} }, n2 = { type: 'local_m', def: {} }, n3 = { type: 'local_m', def: {} };
    const a = bark('bump', 3, 3, { npc: n1 }), b = bark('flee', 4, 2, { npc: n2 }), c = bark('gunpoint', 2, 1, { npc: n3 });
    ok(a === 'a_0_fO' && b === 'f_1_mA' && c === null, 'peds barks: two at a time nearby — the third line waits (' + [a, b, c].join(', ') + ')');
    S.t = 104; S.act.length = 0; const d2 = bark('bump', 3, 3, { npc: n1 }); S.t = 109.5; const d3 = bark('bump', 3, 3, { npc: n1 }); ok(d2 === null && d3 !== null, 'peds barks: eight seconds between two lines from one person');
    S.t = 120; S.act.length = 0; ok(bark('bump', 60, 0, { npc: n2 }) === null, 'peds barks: nobody 60 m away is heard');
    const al = t => ({ reactA: { type: t }, mode: 'react' }); ok(mapBark(al('gunpoint'), 'gun') === 'gunpoint' && mapBark(al('gunshot'), 'flee') === 'flee' && mapBark(al('crash'), 'flee') === 'near' && mapBark(al('panic'), 'flee') === null && mapBark({}, 'aside') === 'bump' && mapBark({}, 'idle') === null, 'peds barks: the crowd\'s reaction -> gunpoint / flee / near / bump; idle chatter stays silent');
    const L = [-120, -37, 0, 37, 74].map(z => lineX({ zone: 'walk', off: 0 }, z)); ok(L.every(x => x > -30.3 && x < -17.7), 'peds lines: the park walk winds between x = -30.2 and -17.8 (' + L.map(x => x.toFixed(1)).join(', ') + ')');
    P = { z: 0 }; const gc = GT.coast; if (!gc) GT.coast = { C: { hotels: [[-90, -68], [-49, -25], [23, 48], [69, 97]] } };   /* the hotel row the valets stand at (fixture: the coast is not loaded in the self-test) */
    const pl = plan(), z = { walk: 0, side: 0, west: 0, lawn: 0 }; if (!gc) delete GT.coast; for (const q of pl) if (q.ctl !== 'tfGuest') z[q.zone]++; const tot = z.walk + z.side + z.west + z.lawn;
    ok(tot >= 36 && abs(z.walk / tot - .4) < .06 && abs((z.side + z.west) / tot - .35) < .06 && abs(z.lawn / tot - .25) < .06, 'peds pool: ' + tot + ' people — park walk ' + z.walk + ', pavements ' + (z.side + z.west) + ', lawn and benches ' + z.lawn + ' (40 / 35 / 25 %)');
    ok(pl.filter(q => q.ctl === 'tfInfl').length >= 4 && pl.filter(q => q.ctl === 'tfJog').length >= 6 && pl.filter(q => q.ctl === 'tfTour').length >= 6 && pl.every(q => q.rings && q.far === 140), 'peds characters: influencers, skaters / joggers, tourists in the pool, all on the 30 / 80 / 140 m rings');
    S.man = sv.man; S.t = sv.t; S.act = sv.act; S.lastCat = sv.lc; g = gS; P = PS; S.on = sv.on; return out; }
})();
