/* coast.js — 月湾 Moonbay, the ocean front of the fictional city 维尔蒙港 Port Vermont (cn.html?world=coast). Modelled on a real art-deco beach district:
   sea -> white sand with lifeguard huts and umbrellas -> dunes -> a palm park with a winding walk -> 月湾大道 Moonbay Drive (one lane each way, kerbside parking)
   -> a row of two-to-four storey pastel deco hotels with porches, eyebrows, sign fins and neon -> white balcony towers behind -> a hazy skyline.
   World module in the same mould as js/chinatown.js: publishes GT.cnroad ({ build, update, groundHeight, surfaceAt, inRoad, onCrossing, lanes, signals, busStops, layout })
   on the engine's loop (avenue x = 0 along Z, cross streets z = ±160, back road x = 150), a GT.riverside with the sea (inWater / waterY), and GT.coast with the same
   interface as GT.chinatown (active, populate(api), people(), placeShops(SITES), zoneName(x, z), mapBase(rect, which), mapLabels, extraShops, views, stats).
   With ?world=coast it also sets GT.chinatown = GT.coast so js/cngame.js and js/shops.js need no changes.
   The heavy parts live in js/coast_sea.js (terrain, water, sand, boats, bridge), js/coast_beach.js (palms, beach and park furniture) and js/coast_deco.js (hotels, towers,
   skyline); each registers GT.coastParts.<name>(C) and is built from here with the shared context C. Sea at -X, the sun sets over it (south-west at 17:15).
   Fixed camera stills: &cam=x,y,z&look=x,y,z[&fov=deg] pins the camera every frame (see GT.coast.views). */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!T || !GT) return;
  const QS = new URLSearchParams(location.search), ACTIVE = QS.get('world') === 'coast';
  if (!ACTIVE) return;
  const PI = Math.PI, HP = PI / 2, TAU = PI * 2, abs = Math.abs, min = Math.min, max = Math.max, lerp = (a, b, t) => a + (b - a) * t, cl = (v, a, b) => max(a, min(b, v)), sst = (x, a, b) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const L = GT.L, CN = GT.CN, TR = GT.coastTerrain || { SEA: -1, xw: () => -108, depth: () => 0, landY: () => .3, PK: -10.5, DUNE0: -38, DUNE1: -52, ACC0: -2, ACCP: 60, duneEdge: () => -38 };
  /* ---- layout (metres) */
  const HW = 6.5, KERB = .15, FX = 14, LA = 1.9, LBK = 3.75, PKX = 5.45, BX = 150, CW = 4.5, IX = BX - CW, OX = BX + CW, IZ = 160 - CW, OZ = 160 + CW, PK = TR.PK, AL0 = 34, AL1 = 39, ZEND = 470;
  /* MG: 玉埠 Jade Landing (js/chinatown.js, GT.jadeLanding) is built into the coast as a district: 灯笼街 Lantern St leaves 月湾大道 where 八街 was (z = -95), runs between the hotels
     with a pavement each side, widens past the service lane (x 39) into the Chinatown street and crosses the back road (x 150) to the city street at x 262 */
  const J = GT.jadeLanding && GT.jadeLanding.embedded ? GT.jadeLanding : null, EX = J ? J.foot.slice() : [];
  const SIDE = [{ z: 18, hw: 5, zh: '十一街', en: '11TH ST', name: '十一街 11th St' }, J ? { z: -95, hw: 3.2, zh: '灯笼街', en: 'LANTERN ST', name: '灯笼街 Lantern St', walk: 1 } : { z: -95, hw: 5, zh: '八街', en: '8TH ST', name: '八街 8th St' }], XING = [-44, 66], ZH = 2.2, STOP = 5.2, SPAWN = { x: 8.6, z: -34, h: 0 };
  const MSPAWN = { x: -7.15, z: -80.6, h: .2, car: { x: -5.45, z: -81.8 } };   /* where js/cngame.js starts a new game when GT.chinatown is active (its SPAWNS.ct); the coast keeps the pavement and the kerb there clear */
  CN.avenue.crossings = XING.slice(); CN.riderStart = { x: 7.4, z: -47, h: PI }; CN.river.x1 = -400; CN.promenade = { x0: -400, x1: -399 };
  if (GT.atmos) { GT.atmos.envDay = .42; if (QS.get('cloudCover') === null) GT.atmos.cloudCover = .44; }
  const xw = TR.xw, SEA = TR.SEA;
  /** MG: a rectangle [x0, z0, x1, z1] minus the district's ground (at most four pieces per cut) */
  function cutEX(r, m) { m = m || 0; let out = [r]; for (const e0 of EX) { const e = m ? [e0[0] - m, e0[1] - m, e0[2] + m, e0[3] + m] : e0; const nx = []; for (const q of out) { if (q[2] <= e[0] || q[0] >= e[2] || q[3] <= e[1] || q[1] >= e[3]) { nx.push(q); continue; } if (q[0] < e[0]) nx.push([q[0], q[1], e[0], q[3]]); if (q[2] > e[2]) nx.push([e[2], q[1], q[2], q[3]]); const x0 = max(q[0], e[0]), x1 = min(q[2], e[2]); if (q[1] < e[1]) nx.push([x0, q[1], x1, e[1]]); if (q[3] > e[3]) nx.push([x0, e[3], x1, q[3]]); } out = nx; } return out.filter(q => q[2] - q[0] > .05 && q[3] - q[1] > .05); }
  /* MG (from the play-test line, PT1): GT.L.bounds stopped walkers at x = -58, short of the sea, and at x = 162, short of 玉埠. Walkable now from the shallows to the city street,
     along the whole front; the sea is closed off where the water gets to about knee deep by a line of low colliders (see shoreline() in build) */
  if (GT.L && GT.L.bounds) Object.assign(GT.L.bounds, { x0: -150, x1: 300, z0: -472, z1: 472 });
  const R = GT.rng('moonbay'), rr = (a, b) => a + (b - a) * R(), pick = a => a[(R() * a.length) | 0];
  GT.coast = { active: true, stats: {}, name: { city: '维尔蒙港 Port Vermont', district: '月湾 Moonbay' } };
  GT.chinatown = GT.coast;   /* js/cngame.js and js/shops.js only know GT.chinatown: the coast answers under that name */
  /* round 2: a bare cn.html now opens the coast (cn.html DEFAULT_WORLD = 'coast'). cn.html's coast block fills in auto=free / t / px / pz for ?world=coast, which would skip the
     gate, the logo and the menu; when the page was navigated to WITHOUT ?world and ?auto (the navigation entry still has the address before history.replaceState), those
     defaults are taken back out of the query handed to GT.cngame.boot and the gate is put up, so the start is the same as 玉埠's: gate → logo → menu → 开始游戏 → loading → the street.
     ?world=coast typed by hand keeps the old behaviour (straight into free roam at 17:15). */
  const NAVQ = (() => { try { const e = performance.getEntriesByType('navigation')[0]; return e && e.name ? new URL(e.name).searchParams : null; } catch (e) { return null; } })();
  const BARE = !!NAVQ && !NAVQ.has('world') && !NAVQ.has('auto') && !NAVQ.has('selftest') && !QS.has('auto');
  GT.coast.bare = BARE;
  /* the same hook sets js/cngame.js's cap on animated people to 32 on the coast (its own &pop= knob; the rigged figures of 2026-11-17 cost ~35 draw calls each) unless the address sets &pop */
  { let cg; try { Object.defineProperty(GT, 'cngame', { configurable: true, enumerable: true, get: () => cg, set: v => { cg = v; if (v && typeof v.boot === 'function' && !v.boot._coast) { const b0 = v.boot; v.boot = function (o) {
      try { const q = o && o.query; if (q && !q.has('pop') && !q.has('selftest')) q.set('pop', '32'); if (BARE) { if (q) for (const k of ['auto', 't', 'px', 'pz', 'ph']) q.delete(k); if (!window.GTsplash && GT.front && GT.front.splash) { GT.front.init(); window.GTsplash = GT.front.splash({ gate: true }); } } } catch (e) { console.warn('[coast] menu start', e); }
      return b0.call(this, o); }; v.boot._coast = 1; } } }); } catch (e) { console.warn('[coast] boot hook', e); } }
  if (BARE) try { if (GT.front && GT.front.splash && GT.front.init) { GT.front.init(); window.GTsplash = GT.front.splash({ gate: true }); } } catch (e) { console.warn('[coast] gate', e); }

  /* ---- ground queries */
  function inRoad(x, z) { if (J && J.inside(x, z)) return J.inRoad(x, z); const az = abs(z); if (abs(x) <= HW && az <= ZEND) return true; if (x >= 0 && x <= OX && az >= IZ && az <= OZ) return true; if (x >= IX && x <= OX && az <= OZ) return true;
    for (const s of SIDE) if (abs(z - s.z) <= s.hw && x > 0 && x <= 66) return true; if (x >= AL0 && x <= AL1 && az <= IZ) return true; if (x >= 39 && x <= 57 && z >= 26 && z <= 46) return true; return false; }
  const FLOORS = [];
  function groundHeight(x, z) { if (J && J.inside(x, z)) return J.ground(x, z); if (inRoad(x, z)) return 0; if (x > PK) { for (let i = 0; i < FLOORS.length; i++) { const f = FLOORS[i]; if (x >= f[0] && x <= f[2] && z >= f[1] && z <= f[3]) return f[4]; } return KERB; } return TR.landY(x, z); }
  const inWater = (x, z) => x < PK && TR.depth(x, z) > .55;
  function surfaceAt(x, z) { if (inRoad(x, z)) return 'asphalt'; if (x > PK) return 'paver'; if (inWater(x, z)) return 'water'; return 'dirt'; }
  function onCrossing(x, z) { if (abs(x) > HW + 1.2) return null; for (const zc of XING) if (abs(z - zc) <= ZH + .4) return zc; return null; }
  GT.riverside = { inWater, groundHeight: (x, z) => groundHeight(x, z), waterY: SEA, build: () => null };

  /* ---- signals (same cycle as the engine's stand-in) */
  const signals = { time: 0, cycle: 43, crossings: XING.slice(), stopLines: [],
    at() { const t = ((this.time % 43) + 43) % 43; if (t < 20) return { car: 'green', ped: 'dont', t: 25 - t, tCar: 20 - t }; if (t < 23) return { car: 'amber', ped: 'dont', t: 25 - t, tCar: 23 - t }; if (t < 25) return { car: 'red', ped: 'dont', t: 25 - t, tCar: 43 - t }; if (t < 36) return { car: 'red', ped: 'walk', t: 41 - t, tCar: 43 - t }; if (t < 41) return { car: 'red', ped: 'flash', t: 41 - t, tCar: 43 - t }; return { car: 'red', ped: 'dont', t: 68 - t, tCar: 43 - t }; },
    state(z) { const zc = z === undefined || abs(z - XING[0]) < abs(z - XING[1]) ? XING[0] : XING[1], s = this.at(); s.z = zc; return s; },
    stopFor(z, dir) { let best = null; for (const zc of this.crossings) { const zs = zc - dir * STOP, d = (zs - z) * dir; if (d > -1 && (!best || d < best.dist)) best = { z: zs, dist: d, crossing: zc, car: this.at().car }; } return best; },
    update(dt) { this.time += dt; }, setTime(t) { this.time = t; } };
  for (const zc of XING) signals.stopLines.push({ crossing: zc, z: zc - STOP, dir: 1, x0: -HW, x1: 0 }, { crossing: zc, z: zc + STOP, dir: -1, x0: 0, x1: HW });

  /* ---- lanes: closed loops with the ids the engine asks for (Moonbay Drive northbound at x = -1.9, southbound at +1.9) */
  const BUS = [{ id: 'busStopE', x: 8.3, z: -80, dir: -1, name: '月湾大道 Moonbay Dr' }, { id: 'busStopW', x: -8.3, z: 100, dir: 1, name: '月湾大道 Moonbay Dr' }];
  function makeLanes() {
    const P = (x, z) => ({ x: +x.toFixed(2), z: +z.toFixed(2) }), bez = (a, b, c, n) => { const o = []; for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; o.push(P(u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1])); } return o; };
    const run = (x0, z0, x1, z1, step) => { const n = max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step)), o = []; for (let i = 0; i <= n; i++) o.push(P(lerp(x0, x1, i / n), lerp(z0, z1, i / n))); return o; };
    const zN = 162.25, zS = -162.25, xE = BX + 2.25, zNi = 157.75, zSi = -157.75, xEi = BX - 2.25, kb = 156.6, ko = 163.5, kx = IX + 1, kxo = OX - 1;
    const outer = [].concat(run(-LA, -146, -LA, 146, 12), bez([-LA, 146], [-LA, zN], [13, zN], 6), run(22, zN, 138, zN, 12), bez([138, zN], [xE, zN], [xE, 148], 6), run(xE, 138, xE, -138, 12), bez([xE, -148], [xE, zS], [138, zS], 6), run(128, zS, 22, zS, 12), bez([13, zS], [-LA, zS], [-LA, -146], 6)); outer.pop();
    const inner = [].concat(run(LA, 146, LA, -146, 12), bez([LA, -146], [LA, zSi], [12, zSi], 5), run(22, zSi, 136, zSi, 12), bez([140, zSi], [xEi, zSi], [xEi, -150], 5), run(xEi, -140, xEi, 140, 12), bez([xEi, 150], [xEi, zNi], [140, zNi], 5), run(130, zNi, 22, zNi, 12), bez([12, zNi], [LA, zNi], [LA, 146], 5)); inner.pop();
    const bikeOuter = [].concat(run(-LBK, -150, -LBK, 150, 10), bez([-LBK, 150], [-LBK, ko], [10, ko], 6), run(18, ko, 144, ko, 14), bez([144, ko], [kxo, ko], [kxo, 154], 5), run(kxo, 144, kxo, -144, 14), bez([kxo, -154], [kxo, -ko], [144, -ko], 5), run(134, -ko, 18, -ko, 14), bez([10, -ko], [-LBK, -ko], [-LBK, -150], 6)); bikeOuter.pop();
    const bikeInner = [].concat(run(LBK, 140, LBK, -150, 10), bez([LBK, -150], [LBK, -kb], [13, -kb], 5), run(22, -kb, 140, -kb, 14), bez([140, -kb], [kx, -kb], [kx, -150], 5), run(kx, -140, kx, 140, 14), bez([kx, 150], [kx, kb], [140, kb], 5), run(130, kb, 22, kb, 14), bez([13, kb], [LBK, kb], [LBK, 150], 5)); bikeInner.pop();
    const lanes = [{ id: 'outer', kind: 'car', closed: true, speed: 10, pts: outer }, { id: 'inner', kind: 'car', closed: true, speed: 10, pts: inner }, { id: 'bikeOuter', kind: 'bike', closed: true, speed: 6, pts: bikeOuter }, { id: 'bikeInner', kind: 'bike', closed: true, speed: 6, pts: bikeInner }];
    lanes.byId = id => lanes.find(l => l.id === id); lanes.busStops = BUS.map(b => ({ x: b.x > 0 ? LA : -LA, z: b.z, h: b.x > 0 ? PI : 0 })); return lanes; }

  /* ---- shared materials */
  const MATS = {}, NIGHT = [], cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  /** tiling photograph from assets/tex/<name>.jpg: one tile covers m metres (kit boxes carry UVs in metres) */
  function tile(name, m, o) { o = o || {}; const key = 'tile|' + name + '|' + m + '|' + (o.mv || '') + '|' + (o.color || '') + '|' + (o.rough || '') + '|' + (o.metal || '') + '|' + (o.bump || '') + (o.key || ''); if (MATS[key]) return MATS[key]; const t = GT.tex.image('assets/tex/' + name + '.jpg', { repeat: [1 / m, 1 / (o.mv || m)] });
    const mat = new T.MeshStandardMaterial({ map: t, color: o.color === undefined ? 0xffffff : o.color, roughness: o.rough === undefined ? .9 : o.rough, metalness: o.metal || 0 }); if (o.bump !== 0) { mat.bumpMap = t; mat.bumpScale = o.bump || .015; } mat.name = 'co_' + name; return MATS[key] = mat; }
  /** a photograph on a 0..1 quad; glow = brightness at night (emissive from its own picture) */
  function pic(name, o) { o = o || {}; const key = 'pic|' + name + '|' + (o.glow || 0) + '|' + (o.day || 0) + '|' + (o.color || '') + '|' + (o.rough || '') + '|' + (o.tint || '') + (o.glass ? '|g' + JSON.stringify(o.glass) : ''); if (MATS[key]) return MATS[key]; const t = GT.tex.image('assets/tex/' + name + '.jpg');
    let mat = new T.MeshStandardMaterial({ map: t, color: o.color === undefined ? 0xffffff : o.color, roughness: o.rough === undefined ? .7 : o.rough, metalness: o.metal || 0 }); if (o.glass && GT.glassify) mat = GT.glassify(mat, o.glass, { gloss: o.gloss, refl: o.refl });   /* LT: glass where the picture shows glass (reflection probe + Fresnel over the room behind) */ if (o.glow || o.day) { mat.emissiveMap = t; mat.emissive = new T.Color(o.tint || 0xffffff); mat.emissiveIntensity = o.day || 0; NIGHT.push([mat, o.day || 0, o.glow || 0]); } mat.name = 'co_' + name; return MATS[key] = mat; }
  const flat = (hex, rough, metal, key) => { const k = 'flat|' + hex + '|' + rough + '|' + (metal || 0) + '|' + (key || ''); return MATS[k] || (MATS[k] = new T.MeshStandardMaterial({ color: hex, roughness: rough === undefined ? .8 : rough, metalness: metal || 0 })); };
  const glow = (hex, day, night, key) => { const k = 'glow|' + hex + '|' + day + '|' + night + '|' + (key || ''); if (MATS[k]) return MATS[k]; const m = new T.MeshStandardMaterial({ color: hex, roughness: .45, emissive: new T.Color(hex), emissiveIntensity: day }); NIGHT.push([m, day, night]); return MATS[k] = m; };
  /** a photograph shot on white, keyed to alpha (fronds, grass, flowers) */
  function keyed(path) { const k = 'key|' + path; if (MATS[k]) return MATS[k]; const c = cv(8, 8), t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    GT.tex.imageEl(path, img => { const W = c.width = img.width, H = c.height = img.height, g = c.getContext('2d'); g.drawImage(img, 0, 0); const im = g.getImageData(0, 0, W, H), d = im.data;
      for (let i = 0; i < d.length; i += 4) { const mn = min(d[i], d[i + 1], d[i + 2]), mx = max(d[i], d[i + 1], d[i + 2]), a = cl((240 - mn) / 34 + (mx - mn) / 45, 0, 1); if (a > .08 && a < 1) for (let j = 0; j < 3; j++) d[i + j] = cl((d[i + j] - (1 - a) * 255) / a, 0, 255); d[i + 3] = a * 255; }
      g.putImageData(im, 0, 0); t.needsUpdate = true; }); return MATS[k] = t; }
  function cardMat(path, o) { o = o || {}; const k = 'card|' + path + '|' + (o.color || '') + '|' + (o.sss || ''); if (MATS[k]) return MATS[k]; const t = keyed(path), m = new T.MeshStandardMaterial({ map: t, alphaTest: .42, side: T.DoubleSide, roughness: o.rough || .8, color: o.color === undefined ? 0xffffff : o.color });
    if (o.sss) { m.emissiveMap = t; m.emissive = new T.Color(o.sss); m.emissiveIntensity = 1; NIGHT.push([m, 1, .06]); } m.name = 'co_card'; return MATS[k] = m; }
  /** soft contact shade laid on the ground: 'strip' dark along one long edge, 'blob' dark in the middle */
  function aoMat(kind, op) { const k = 'ao|' + kind + '|' + (op || ''); if (MATS[k]) return MATS[k]; const c = cv(128, 128), g = c.getContext('2d');
    if (kind === 'strip') { const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    else { const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.55, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    const t = new T.CanvasTexture(c); return MATS[k] = new T.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, opacity: op || (kind === 'strip' ? .5 : .55), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); }
  /** warm light pool on the ground (night only, additive) */
  function poolMat() { if (MATS.pool) return MATS.pool; const c = cv(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(255,200,130,.6)'); gr.addColorStop(.5, 'rgba(255,170,90,.2)'); gr.addColorStop(1, 'rgba(255,150,70,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return MATS.pool = new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); }

  const PEOPLE = [], PARK = [], SITEPOS = {}, LAMPS = [], EXTRA = [], UPD = [], OPEN = new Set();
  const state = { root: null, t: 0, parts: {}, cam: null };
  const C = { T, GT, QS, R, rr, pick, lerp, cl, sst, tile, pic, flat, glow, keyed, cardMat, aoMat, poolMat, NIGHT, MATS, cv, TR, SEA, xw, ground: groundHeight, inRoad, EX, cutEX,
    L: { HW, KERB, FX, LA, LBK, PKX, BX, CW, IX, OX, IZ, OZ, PK, AL0, AL1, ZEND, SIDE, XING, SPAWN, DUNE0: TR.DUNE0, DUNE1: TR.DUNE1 }, PEOPLE, PARK, sitePos: SITEPOS, floors: FLOORS, lamps: LAMPS, extra: EXTRA, trees: [], hotels: [], umbrellasAt: [] };

  /* LT: damp patches and small puddles on 月湾大道 and both sidewalks (js/materials.js GT.wetDecals). Own random stream, so no palm, person or car moves. Gutters along the kerbs get the most
     and the lowest ranks (still there on a dry afternoon); the rest come out at night and in rain. */
  function wetSpots() { const r = GT.rng('lt-coast-wet'), q = (a, b) => a + (b - a) * r(), S = [];
    for (let i = 0; i < 480; i++) { const z = q(-ZEND + 10, ZEND - 10); if (XING.some(c => abs(z - c) < 3)) continue; S.push({ x: q(-HW + .9, HW - .9), z, w: q(1.1, 3.4), l: q(1.4, 4.4), a: q(0, PI), k: r() }); }
    for (const s of [-1, 1]) for (let i = 0; i < 170; i++) S.push({ x: s * (HW - q(.3, .6)), z: q(-ZEND + 10, ZEND - 10), w: q(.6, 1.2), l: q(1.8, 5.2), a: q(-.06, .06), k: Math.pow(r(), 1.8), gut: 1 });
    for (const [x0, x1] of [[HW + .6, FX - .8], [PK + .6, -HW - .6]]) for (let i = 0; i < 110; i++) S.push({ x: q(x0, x1), z: q(-ZEND + 10, ZEND - 10), w: q(.6, 1.8), l: q(.7, 2.2), a: q(0, PI), k: .15 + r() * .85 });
    return S; }
  /* ---- roads, sidewalks, paint, lamps, signals */
  function streets(K) { const wb = GT.world;
    const asph = tile('coast/asphalt_sun', 7, { rough: .9, bump: 0, color: 0xe6e2dc }), walk = tile('sidewalk', 2.4, { color: 0xeadccc, rough: .88, bump: .01 }), walkB = tile('sidewalk', 2.4, { color: 0xe4d6c8, rough: .88, bump: .01, key: 'b' }), kerb = tile('sidewalk', 1.8, { color: 0xd8d0c4, rough: .85, bump: .01, key: 'k' });
    if (GT.wetGround) try { GT.wetGround(asph, { wet: 1 }); GT.wetGround(walk, { wet: .7 }); GT.wetGround(walkB, { wet: .7 }); } catch (e) { console.warn('[coast] wetGround', e); }   /* round 2: at night the damp road takes the neon */
    K.box(asph, 700, .2, 2 * ZEND + 260, PK + 350, -.1, 0); { const g = new T.PlaneGeometry(4200, 8000); g.rotateX(-HP); K.geo(flat(0x6e6c66, .95, 0, 'land'), g, { x: PK + 2100, y: -.16, z: 0 }); }   /* everything inland of the park sits on asphalt; slabs on top wherever it is not a carriageway */
    const xs = [PK, -HW, HW, FX, AL0, AL1, 57, 66, IX, OX, 330], zs = [-ZEND - 120, -OZ, -IZ, SIDE[1].z - SIDE[1].hw, SIDE[1].z + SIDE[1].hw, SIDE[0].z - SIDE[0].hw, SIDE[0].z + SIDE[0].hw, 26, 46, IZ, OZ, ZEND + 120];
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) { const a = xs[i], b = xs[i + 1], c = zs[j], d = zs[j + 1], mx = (a + b) / 2, mz = (c + d) / 2; if (inRoad(mx, mz) || abs(mx) <= HW) continue; for (const q of cutEX([a, c, b, d])) K.box(a < 0 ? walkB : walk, q[2] - q[0], KERB, q[3] - q[1], (q[0] + q[2]) / 2, KERB / 2, (q[1] + q[3]) / 2); }
    for (const s of [-1, 1]) { const gaps = s > 0 ? SIDE.map(q => [q.z - q.hw, q.z + q.hw]).concat([[-OZ, -IZ], [IZ, OZ]]) : []; let segs = [[-ZEND - 100, ZEND + 100]]; for (const [g0, g1] of gaps) segs = segs.flatMap(([a, b]) => g1 <= a || g0 >= b ? [[a, b]] : [[a, g0], [g1, b]].filter(q => q[1] - q[0] > .1));
      for (const [a, b] of segs) { K.box(kerb, .24, KERB + .01, b - a, s * (HW + .12), (KERB + .01) / 2, (a + b) / 2, { bevel: .03 }); K.geo(aoMat('strip'), new T.PlaneGeometry(b - a, .4), { x: s * (HW - .2), y: .006, z: (a + b) / 2, rx: -HP, ry: -s * HP }); } }
    /* paint: double yellow, parking lane line, crosswalks, stop bars */
    const yl = GT.mat('road_paint_yellow'), wh = GT.mat('road_paint_white'), zebra = tile('sidewalk', 2.2, { color: 0xf0ece2, rough: .8, bump: .004, key: 'z' });
    for (const q of [-.12, .12]) { let segs = [[-ZEND, ZEND]]; for (const zc of XING) segs = segs.flatMap(([a, b]) => [[a, zc - STOP], [zc + STOP, b]]); for (const [a, b] of segs) K.box(yl, .1, .006, b - a, q, .004, (a + b) / 2); }
    for (const s of [-1, 1]) for (let z = -ZEND; z < ZEND; z += 6.2) { if (XING.some(c => abs(z - c) < 5) || (s > 0 && SIDE.some(q => abs(z - q.z) < q.hw + 1))) continue; K.box(wh, .1, .006, 5.6, s * 3.65, .004, z + 3.1); K.box(wh, .55, .006, .1, s * 4.2, .004, z); }
    for (const zc of XING) { for (let x = -HW + .5; x < HW; x += 1.1) K.box(zebra, .55, .006, ZH * 2, x, .005, zc); K.box(wh, HW, .006, .35, -HW / 2, .004, zc - STOP + .3); K.box(wh, HW, .006, .35, HW / 2, .004, zc + STOP - .3); }
    for (const q of SIDE) { K.box(wh, .35, .006, q.hw * 2, HW + .6, .004, q.z); const x1 = q.walk ? AL0 - .4 : 66.5; for (const sz of [-1, 1]) K.box(yl, x1 - HW - 1, .006, .1, (HW + 1 + x1) / 2, .004, q.z + sz * .12); }   /* MG: 灯笼街's centre line stops at the service lane; 玉埠 paints its own */
    for (let i = 0; i < 60; i++) K.decal(pick(['crack', 'oil_stain', 'tire_marks', 'patch', 'oil_stain']), rr(1.2, 2.8), rr(1.4, 3.4), rr(-6, 6), .012, rr(-ZEND, ZEND), rr(0, TAU));
    for (let i = 0; i < 40; i++) K.decal(pick(['gum_spots', 'water_stain', 'crack']), rr(.8, 1.8), rr(.8, 1.8), rr(7, 13.5), KERB + .012, rr(-160, 160), rr(0, TAU));
    /* street lamps: deco posts with lantern heads, both sidewalks, every 24 m */
    const post = flat(0x2a3a3c, .45, .6, 'lamp'), cap = flat(0x1e2a2c, .4, .7, 'lampc'), head = glow(0xfff0d8, .05, 3.0, 'lamphead'); post.name = cap.name = 'co_thin';   /* r2: a 15 cm pole under a 17-degree sun threw a 17 m shadow that the shadow map broke into dashes across the road: thin posts cast none */
    for (let z = -ZEND + 6; z < ZEND; z += 24) for (const s of [-1, 1]) { const x = s * (HW + .6), zz = z + (s > 0 ? 12 : 0); if ((s < 0 && abs(zz - MSPAWN.z) < 5) || XING.some(c => abs(zz - c) < 4) || (s > 0 && SIDE.some(q => abs(zz - q.z) < q.hw + 1.5)) || BUS.some(b => (b.x > 0) === (s > 0) && abs(zz - b.z) < 4)) continue;
      K.cyl(post, .16, .2, .6, x, KERB + .3, zz, { seg: 10 }); K.cyl(post, .07, .09, 4.4, x, KERB + 2.8, zz, { seg: 10 }); for (const y of [.62, 1.2, 4.9]) K.cyl(cap, .11, .11, .06, x, KERB + y, zz, { seg: 10 });
      K.cyl(head, .2, .14, .7, x, KERB + 5.4, zz, { seg: 8 }); K.cyl(cap, .26, .08, .22, x, KERB + 5.86, zz, { seg: 8 }); K.cyl(cap, .025, .025, .3, x, KERB + 6.1, zz, { seg: 5 }); K.cyl(cap, .2, .2, .05, x, KERB + 5.04, zz, { seg: 8 });
      wb.addPost(x, zz, .2, 5, 'lamp'); LAMPS.push([x, zz]); }
    { const m = poolMat(); for (const [x, z] of LAMPS) { if (abs(z) > 200) continue; K.geo(m, new T.PlaneGeometry(9, 9), { x: x * 1.25, y: KERB + .03, z, rx: -HP }); } state.poolMat = m; }
    /* signal masts at the two crossings */
    const ml = flat(0x2a2d30, .5, .6, 'mast'); ml.name = 'co_thin'; state.lens = { r: glow(0xff2a1a, .1, .1, 'lr'), a: glow(0xffb01a, .1, .1, 'la'), g: glow(0x2aff8a, .1, .1, 'lg'), p: glow(0xff6a2a, .1, .1, 'lp') }; const lens = state.lens;
    for (const zc of XING) for (const [x, dirZ] of [[-(HW + .5), 1], [HW + .5, -1]]) { const z = zc - dirZ * (STOP - .4), sx = x > 0 ? -1 : 1, arm = 5.6; K.cyl(ml, .1, .14, 6.4, x, KERB + 3.2, z, { seg: 12 }); K.cyl(ml, .06, .08, arm, x + sx * arm / 2, KERB + 6.1, z, { rz: HP, seg: 10 });
      for (const ox of [arm * .5, arm * .92]) { const hx = x + sx * ox; K.box(flat(0xd9a514, .5, .2, 'sig'), .34, 1.0, .3, hx, KERB + 5.5, z, { bevel: .03 }); ['r', 'a', 'g'].forEach((c, i) => K.sphere(lens[c], .1, hx, KERB + 5.82 - i * .32, z - dirZ * .15, { seg: 10 })); }
      K.box(flat(0x1a1a1c, .6), .3, .34, .16, x + sx * .25, KERB + 2.6, z, { bevel: .02 }); K.sphere(lens.p, .09, x + sx * .25, KERB + 2.6, z - dirZ * .09, { seg: 8 }); wb.addPost(x, z, .16, 6, 'signal'); }
    /* bus shelters */
    for (const b of BUS) { const s = b.x > 0 ? 1 : -1, x0 = b.x + s * .9, fr = flat(0xe8e4dc, .4, .4, 'shel'), glass = GT.mat('glass_clear'); K.push(x0, KERB, b.z, { ry: s > 0 ? -HP : HP });
      for (const xq of [-1.85, 1.85]) K.box(fr, .08, 2.5, .08, xq, 1.25, .05, { bevel: .02 }); K.box(glass, 3.6, 1.9, .02, 0, 1.2, .05); K.box(fr, 4.0, .1, 1.6, 0, 2.55, .7, { bevel: .03, rx: -.05 }); K.box(flat(0x2f8f9a, .4, .2), 4.0, .26, .06, 0, 2.42, 1.5, { bevel: .01 });
      K.box(tile('wood_plank', 1.2, { color: 0xb08a5a }), 2.0, .05, .4, .3, .47, .35, { bevel: .01 }); K.box(fr, .12, 1.95, 1.2, -1.85, 1.2, .65, { bevel: .015 }); K.geo(aoMat('blob'), new T.PlaneGeometry(4.6, 2.2), { x: 0, y: .007, z: .7, rx: -HP }); K.pop(); wb.addBox(x0 - .1, b.z - 1.9, x0 + .1, b.z + 1.9, 2.6, 'bus-shelter'); GT.world.anchor(b.id, { x: b.x, z: b.z, h: s > 0 ? -HP : HP }); }
    /* street-name blades */
    const blade = (x, z, ry, zh, en) => { const c = cv(512, 96), g = c.getContext('2d'); g.fillStyle = '#1f6a5a'; g.fillRect(0, 0, 512, 96); g.strokeStyle = '#f2f2e6'; g.lineWidth = 4; g.strokeRect(6, 6, 500, 84); g.fillStyle = '#f2f2e6'; g.font = '800 46px "PingFang SC","Heiti SC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(zh + '  ' + en, 256, 50, 480);
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; const m = new T.MeshStandardMaterial({ map: t, roughness: .5 }); K.cyl(flat(0x6a6f74, .45, .7), .035, .035, 3.4, x, KERB + 1.7, z, { seg: 8 }); for (const q of [0, PI]) K.geo(m, new T.PlaneGeometry(1.7, .32), { x, y: KERB + 3.2, z, ry: ry + q }); };
    for (const q of SIDE) blade(HW + .7, q.z - q.hw - .7, 0, q.zh, q.en); blade(HW + .7, SIDE[0].z + SIDE[0].hw + .8, HP, '月湾大道', 'MOONBAY DR'); blade(-HW - .7, -20, HP, '月湾大道', 'MOONBAY DR');
  }

  /** MG (PT1): a line of low colliders where the sea gets to about 0.42 m deep: you can wade in off the sand but not walk out into the sea (cngame sends anyone deeper than 0.5 m back) */
  function shoreline() { let n = 0; for (let z = -470; z < 470; z += 8) { const zc = z + 4; let x = xw(zc); for (let k = 0; k < 60 && TR.depth(x, zc) < .42; k++) x -= .5; GT.world.addBox(x - 1.4, z, x, z + 8.05, .9, 'shore'); n++; } GT.coast.stats.shore = n; }
  /* ---- build */
  function build(scene) {
    if (state.root) return state.root; const t0 = performance.now(), root = state.root = new T.Group(); root.name = 'coast'; scene.add(root); const K = GT.kit(); C.root = root; C.scene = scene; C.K = K; C.wb = GT.world;
    if (GT.streetkit && GT.streetkit.use) { try { GT.streetkit.use(K, root, { ground: groundHeight, facadeX: null }); C.sk = GT.streetkit; } catch (e) { console.warn('[coast] streetkit', e); } }
    try { streets(K); } catch (e) { console.warn('[coast] streets', e); }
    for (const name of ['sea', 'beach', 'deco']) { const f = GT.coastParts && GT.coastParts[name]; if (!f) { console.warn('[coast] part missing: ' + name); continue; } const ta = performance.now(); try { const p = f(C) || {}; state.parts[name] = p; if (p.update) UPD.push(p.update); } catch (e) { console.warn('[coast] part ' + name, e); if (window.GTfail) GTfail('coast part ' + name + ': ' + (e && e.message)); } GT.coast.stats['ms_' + name] = Math.round(performance.now() - ta); }
    const grp = K.build(); grp.name = 'coast_static'; grp.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingSphere(); o.geometry.boundingSphere.radius += 2; o.frustumCulled = true; if (o.material.transparent || o.material.alphaTest) o.castShadow = !!o.material.alphaTest; if (o.material.name === 'co_thin') o.castShadow = false; } }); root.add(grp);
    GT.perf?.chunkStatic?.(grp,90,{minTris:8500,minChunk:1400});
    grp.userData.staticRenderTree=true;
    if (J) { const ta = performance.now(); try { J.build(scene, { parked: QS.get('ctparked') !== null ? +QS.get('ctparked') : 16 }); } catch (e) { console.warn('[coast] 玉埠', e); if (window.GTfail) GTfail('jade landing: ' + (e && e.message)); } GT.coast.stats.ms_jade = Math.round(performance.now() - ta); GT.coast.stats.jade = J.stats; GT.coast.extraShops = (GT.coast.extraShops || []).concat(J.extraShops()); }   /* MG: + 玉埠's pawn shop and key cutter on the maps */
    shoreline();
    if (GT.wetDecals) try { root.add(GT.wetDecals.build(wetSpots(), groundHeight, { name: 'coast_wet' })); } catch (e) { console.warn('[coast] wet decals', e); }
    /* parked cars along both kerbs, nearest the spawn first */
    const kinds = ['muscle', 'sedan', 'sports', 'suv', 'hatch', 'muscle', 'sports', 'pickup', 'sedan', 'muscle'], cols = [0x6fd6c8, 0xf2f0ea, 0xe86a9a, 0x1a1c20, 0xf2d24a, 0x8a1c1c, 0x7ab8e8, 0xd9d6cc, 0x2a5a4a, 0xc4541a, 0x23344a];
    let pk = 0; for (const s of [-1, 1]) for (let z = -160; z < 160; z += 6.3) { if ((s < 0 && z > MSPAWN.car.z - 6.2 && z < MSPAWN.car.z + 21) || XING.some(c => abs(z - c) < 7) || (s > 0 && SIDE.some(q => abs(z - q.z) < q.hw + 3)) || BUS.some(b => (b.x > 0) === (s > 0) && abs(z - b.z) < 9) || (s > 0 && abs(z - SPAWN.z - 3.5) < 4)) continue; pk++; if (pk % 3 === 0) continue; PARK.push({ kind: kinds[pk % kinds.length], x: s * PKX, z: z + rr(-.3, .3), h: s > 0 ? PI : 0, color: cols[(pk * 5) % cols.length] }); }
    { const T2 = ['local_m', 'local_f', 'tourist', 'tourist_f', 'sundress', 'patron_m', 'patron_f', 'guest', 'beach_f', 'skater', 'jogger', 'local_f'];
      for (let i = 0; i < 16; i++) { const s = i % 3 === 2 ? -1 : 1, x = s > 0 ? rr(7.9, 8.6) : rr(-9.6, -8.2), za = rr(-150, 150), dir = R() < .5 ? 1 : -1, zb = cl(za + dir * rr(70, 150), -158, 158), ty = T2[i % T2.length];
        PEOPLE.push({ type: ty, x, z: za, h: dir > 0 ? 0 : PI, sched: [[0, 24, ty === 'skater' ? 'skate' : ty === 'jogger' ? 'jog' : 'walk']], speed: ty === 'skater' ? 3 : ty === 'jogger' ? 2.6 : rr(1, 1.4), path: { pts: [[x, za], [x, zb], [x, za]] }, seed: 100 + i, pri: 0 }); }
      (C.cafe || []).slice(0, 18).forEach((c, i) => { if (i % 2) return; PEOPLE.push({ type: pick(['patron_f', 'patron_m', 'guest', 'tourist_f', 'local_f', 'sundress']), x: c[0] + .55, z: c[1] + .2, h: -HP + .6, sched: [[8, 24, pick(['drink', 'talk_group', 'phone_look'])]], y: c[2], seed: 140 + i, pri: 1 }); }); }
    PARK.sort((a, b) => abs(a.z - SPAWN.z) - abs(b.z - SPAWN.z)); PARK.unshift({ kind: 'muscle', x: PKX, z: SPAWN.z + 3.6, h: PI, color: 0x5fd0c4, hero: 1 });
    /* round 2: open-top cars (js/cnvehicles.js variants 'sports:roadster' and 'muscle:conv'): one right ahead of the new-game car on the sea side, a few more along both kerbs */
    PARK.splice(1, 0, { kind: 'muscle', x: -PKX, z: MSPAWN.car.z + 6.6, h: 0, color: 0x6fd8e8, opts: { variant: 'conv' } }, { kind: 'sports', x: -PKX, z: MSPAWN.car.z + 15.4, h: 0, color: 0xf4f2ee, opts: { variant: 'roadster' } }, { kind: 'muscle', x: PKX, z: SPAWN.z - 6.8, h: PI, color: 0xf2d24a, opts: { variant: 'conv' } });
    for (let i = 0, n = 0; i < PARK.length && n < 5; i++) { const p = PARK[i]; if (i > 3 && i % 4 === 2 && (p.kind === 'sports' || p.kind === 'muscle')) { p.opts = { variant: p.kind === 'sports' ? 'roadster' : 'conv' }; p.color = [0xf4f2ee, 0xd8203a, 0x6fd8e8, 0xf2d24a, 0x1a1c20][n % 5]; n++; } }
    { const K2 = GT.kit(), lim = QS.get('parked') !== null ? +QS.get('parked') : 30; PARK.slice(0, lim).forEach(p => K2.geo(aoMat('blob', .6), new T.PlaneGeometry(2.4, 5.2), { x: p.x, y: groundHeight(p.x, p.z) + .009, z: p.z, rx: -HP, ry: p.h })); const sg = K2.build({ cast: false }); sg.name = 'coast_carshade'; root.add(sg); }
    GT.world.anchor('aveNorth', { x: -LA, z: 140, h: 0 }); GT.world.anchor('aveSouth', { x: LA, z: -140, h: PI }); GT.world.anchor('highwayNorth', { x: -LA, z: 150, h: 0 }); GT.world.anchor('highwaySouth', { x: LA, z: -150, h: PI }); GT.world.anchor('backRoadMid', { x: BX + 2.25, z: 0, h: PI }); GT.world.anchor('busStop', GT.world.anchors.busStopE);
    GT.world.anchor('swimGate', { x: xw(0) + 9, z: 0, h: -HP });
    /* round 2: the night sky over a lit beach city is not black: deep blue overhead, violet-magenta city glow low over the land, a warmer band over the sea (additive, camera-centred, only at night) */
    { const g = new T.SphereGeometry(2300, 40, 14, 0, TAU, 0, HP * 1.04), m = new T.ShaderMaterial({ uniforms: { uK: { value: 0 } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.BackSide, fog: false,
        vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0); }',
        fragmentShader: 'uniform float uK; varying vec3 vD; void main() { float h = clamp(vD.y, 0.0, 1.0), land = smoothstep(-0.3, 0.8, vD.x); vec3 zen = vec3(0.012, 0.02, 0.07), hor = mix(vec3(0.06, 0.04, 0.1), vec3(0.13, 0.045, 0.1), land); vec3 c = mix(hor, zen, pow(h, 0.42)) + vec3(0.05, 0.02, 0.06) * exp(-h * 14.0) * land; gl_FragColor = vec4(c * uK, 1.0); }' });
      const me = new T.Mesh(g, m); me.frustumCulled = false; me.renderOrder = 1002; me.name = 'coast_nightglow'; root.add(me); state.glowU = m.uniforms.uK; }
    /* more people on the hotel walk, day and night (café groups standing at the terraces, strollers on both pavements) */
    { const T3 = ['local_f', 'tourist_f', 'sundress', 'patron_m', 'patron_f', 'guest', 'tourist', 'local_m', 'skater', 'beach_f'];
      for (let i = 0; i < 18; i++) { const s = i % 4 === 3 ? -1 : 1, x = s > 0 ? rr(7.6, 8.8) : rr(-9.4, -7.9), za = rr(-150, 150), dir = R() < .5 ? 1 : -1, zb = cl(za + dir * rr(50, 120), -158, 158), ty = T3[i % T3.length];
        PEOPLE.push({ type: ty, x, z: za, h: dir > 0 ? 0 : PI, sched: [[0, 24, ty === 'skater' ? 'skate' : 'walk']], speed: ty === 'skater' ? 3 : rr(.9, 1.3), path: { pts: [[x, za], [x, zb], [x, za]] }, seed: 1300 + i, pri: i < 4 ? 0 : 1 }); }
      for (let i = 0; i < 44; i++) { const s = i % 3 === 2 ? -1 : 1, x = s > 0 ? rr(7.7, 9) : rr(-9.6, -7.8), za = -150 + i * 6.8 + rr(-2, 2), dir = i % 2 ? 1 : -1, zb = cl(za + dir * rr(25, 60), -158, 158), ty = T3[(i * 7) % T3.length];   /* the evening crowd */
        PEOPLE.push({ type: ty, x, z: za, h: dir > 0 ? 0 : PI, sched: [[17.6, 24, ty === 'skater' ? 'skate' : 'walk']], speed: ty === 'skater' ? 3 : rr(.8, 1.2), path: { pts: [[x, za], [x, zb], [x, za]] }, seed: 1460 + i, pri: 1 }); }   /* pri 0 skips js/people.js's cap: keep it for a few */
      for (let i = 0; i < 16; i++) { const z = -150 + i * 19 + rr(-3, 3); if (XING.some(c => abs(z - c) < 5) || abs(z - SPAWN.z) < 4) continue; for (let k = 0; k < 2 + (i % 2); k++) PEOPLE.push({ type: pick(['patron_f', 'sundress', 'guest', 'tourist_f', 'patron_m', 'local_f']), x: 10.8 + rr(-.4, .4), z: z + k * .9, h: -HP + rr(-.6, .6) + (k % 2 ? PI : 0), sched: [[16, 24, 'talk_group']], seed: 1400 + i * 4 + k, pri: 1 }); } }
    /* js/people.js activates people by priority, not by distance, and pri 0 skips its cap: with ~125 pri-0 beach-goers and the heavier rigged figures of 2026-11-17
       the beach ran at 31 fps. Pri 0 is kept for at most 16 people on the busy stretch in front of the second hut and on the pavements by the two spawn points; the rest wait for the cap. */
    { const keyZ = p => (p.x < -40 && p.z > -75 && p.z < -15) || (p.x > -12 && p.x < 16 && p.z > -95 && p.z < -25) || p.type === 'lifeguard'; let n0 = 0; for (const p of PEOPLE) { if (p.pri !== 0) continue; if (keyZ(p) && n0 < 16) n0++; else p.pri = 1; } GT.coast.stats.pri0 = n0;
      /* the cap takes people in list order within a priority: list them nearest first to the places the game shows (the busy beach, the two spawn points, the hotel walk), so the ones that get a figure are the ones in view */
      const KEY = [[-95, -48], [-7, -80], [8.6, -34], [10, -60], [-30, -40]], kd = p => Math.min(...KEY.map(k => Math.hypot(p.x - k[0], p.z - k[1]))); PEOPLE.forEach((p, i) => { p._k = kd(p) + i * 1e-4; }); PEOPLE.sort((a, b) => (a.pri - b.pri) || (a._k - b._k)); }
    /* MG: 玉埠's people, and walkers who go between 月湾大道 and 灯笼街 on the pavements of the side street (after the sort and all at priority 0: js/people.js builds their figures while the game loads and hides them while the player is far away, so walking into 玉埠 costs no figure builds) */
    if (J) { for (const p of J.people()) PEOPLE.push(Object.assign({}, p, { pri: 0 })); const T4 = ['local_f', 'uncle', 'tourist_f', 'granny', 'tourist', 'local_m', 'student', 'patron_f'];
      for (let i = 0; i < 8; i++) { const n = i % 2 === 0, z1 = n ? -90.9 : -99.1, z2 = n ? -86.7 : -103.3, pts = [[9.6, n ? -87.5 : -102.5], [10.4, z1], [33.2, z1], [40.5, z2], [70 + (i % 4) * 18, z2]], back = i % 4 > 1, path = back ? pts.slice().reverse() : pts, st = path[(i * 3) % path.length];
        PEOPLE.push({ type: T4[i], x: st[0], z: st[1], h: back ? -HP : HP, sched: [[7, 24, 'walk']], speed: rr(1, 1.35), path: { pts: path }, seed: 2100 + i, pri: 0 }); } }
    let dc = 0, tris = 0; root.traverse(o => { if (o.isMesh) { dc++; const g = o.geometry; tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1); } });
    Object.assign(GT.coast.stats, { drawCalls: dc, tris: Math.round(tris), buildMs: Math.round(performance.now() - t0), colliders: GT.world.boxes.length, parked: PARK.length, people: PEOPLE.length });
    for (const [id, x, z, zh, item, price] of EXTRA) { const sp = { id: 'co:shop:' + id, x, z, r: 1.6, label: zh + ' · ' + item + ' $' + price, onUse: () => { const e = GT.cngame && GT.cngame.economy; if (e && e.buy) e.buy(item, price, 2, '', zh); } }; if (GT.act && GT.act.add) GT.act.add(sp); else (GT._actQueue = GT._actQueue || []).push(sp); GT.coast.extraShops = (GT.coast.extraShops || []).concat([{ id, x, z, n: zh }]); }
    update(0); return root;
  }

  /* ---- sun: rises inland (east), stands south at noon, sets over the sea in the west-south-west; golden hour lights the hotel fronts and the beach */
  const START_H = 13.75;
  const EVE = [[12, 67.5], [16, 30], [17, 22], [17.5, 18], [18, 13.5], [18.5, 8.6], [19, 3.6], [19.2, 2], [19.45, 0], [19.6, -1.4]], MORN = [[5.6, -3], [6.1, 0], [6.5, 5], [7.5, 15], [8.5, 25], [10, 40], [12, 67.5]];
  const curve = (k, x) => { if (x <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (x <= k[i][0]) return lerp(k[i - 1][1], k[i][1], (x - k[i - 1][0]) / (k[i][0] - k[i - 1][0])); return k[k.length - 1][1]; };
  function sunFor(h) { if (QS.get('sun') === '0' || !GT.atmos) return; if (h > 5.7 && h < 19.6) { const e = h >= 12 ? curve(EVE, h) : curve(MORN, h), az = h >= 12 ? -HP - (HP - .5) * cl((h - 12) / 5.25, 0, 1.35) : lerp(.25, -HP, cl((h - 6) / 6, 0, 1)); GT.atmos.dbgSun = [az, max(1.2, e), e > 2 && h > 15 ? e + 6 * cl((19.3 - h) / 1.5, 0, 1) : 0]; } else GT.atmos.dbgSun = null; }
  sunFor(QS.get('t') !== null && isFinite(+QS.get('t')) ? +QS.get('t') : 17.25);

  const CAMP = QS.get('cam') ? QS.get('cam').split(',').map(Number) : null, LOOKP = QS.get('look') ? QS.get('look').split(',').map(Number) : null;
  function update(dt) { if (!state.root) return; dt = dt || 0; state.t += dt; signals.update(dt); const env = GT.env || {}, night = env.night || 0, h = env.hours || 17.25;
    { const g = GT.cngame, G = g && g.G; if (G) { if (G.leaving && G.phase !== 'play' && G.fixedHours === null && abs(G.hours - START_H) > .05) { G.hours = START_H; if (GT.atmos && GT.atmos.setTime) GT.atmos.setTime(START_H); } }   /* every frame of the start-game fade and loading (cngame sets 17.4 part-way through it) */   /* LT (user: "白天太黄了"): a new game on 月湾 starts in the early afternoon (cngame starts every world at 17:24); the menu flyby stays golden */
      if (state.sunH === undefined || abs(h - state.sunH) > .01) { state.sunH = h; sunFor(h); } }   /* the sun path follows the running clock (it was fixed at the load hour) */
    const eve = cl((h - 18.2) / 1.4, 0, 1), k = max(night, eve * .6); for (const [m, d, n] of NIGHT) m.emissiveIntensity = lerp(d, n, k); if (state.poolMat) state.poolMat.opacity = cl(night * 1.2, 0, 1) * .75;
    const lens = state.lens; if (lens) { const s = signals.at(), on = 3.2, off = .06; lens.r.emissiveIntensity = s.car === 'red' ? on : off; lens.a.emissiveIntensity = s.car === 'amber' ? on : off; lens.g.emissiveIntensity = s.car === 'green' ? on : off; lens.p.emissive.setHex(s.ped === 'walk' ? 0xffffff : 0xff5a1a); lens.p.emissiveIntensity = s.ped === 'flash' ? (state.t % 1 < .5 ? 2.4 : .1) : 2.4; }
    { const f = C.scene && C.scene.fog; if (f && f.density !== undefined) { if (f.density !== state.fogSet) state.fogBase = f.density; f.density = state.fogBase * (QS.get('fogk') !== null ? +QS.get('fogk') : .78); state.fogSet = f.density; } }
    sunFor(h); if (GT.render && GT.render.fx && QS.get('ev') === null) { const pq = state.cam || (CAMP && LOOKP ? { p: CAMP } : null), cy = pq ? pq.p[1] : GT.cngame && GT.cngame.camera ? GT.cngame.camera.position.y : 2; GT.render.fx.exposureBias = lerp(QS.get('evd') !== null ? +QS.get('evd') : .35, QS.get('evn') !== null ? +QS.get('evn') : -.45, night) + .32 * sst(cy, 25, 80) * (1 - night); }   /* r2: from the air the meter sees mostly glittering sea and exposes the land dark; lift it a third of a stop up there */
    if (GT.atmos && GT.atmos.sun && GT.atmos.sun.isLight && QS.get('moon') === null) GT.atmos.sun.intensity = lerp(1, .4, night);
    if (C.wash) for (const m of C.wash) m.opacity = cl(max(night, eve * .5) * 1.1, 0, 1) * .75;
    if (state.glowU) state.glowU.value = cl(night * 1.1, 0, 1) * (QS.get('glow') !== null ? +QS.get('glow') : 1);
    menuStep(dt);
    /* an open-top car is driven from the chase camera when you get in (the shared first-person cockpit of js/cockpit.js has a closed roof; V still switches to it) */
    { const g = GT.cngame, P = g && g.player, CAM = g && g.sim && g.sim.CAM, e = P && P.mode === 'car' ? P.ent : null; if (e !== state.inCar) { state.inCar = e; if (e && OPEN.has(e) && CAM && CAM.mode === 'fp') { CAM.mode = 'chase'; CAM.init = false; } } }
    /* round 2: js/cngame.js's traffic table is the China edition's (the 江城 bus on route 521, the 江城出租 taxis, the cargo tricycle); on Moonbay Drive those are taken off the loop the
       moment they exist and the taxis come back as plain American saloons, SUVs and pickups on the same path (the jacked-car top-up in cngame never brings a bus back) */
    if (!state.traf && state.t > .25) { const g = GT.cngame, G = g && g.G, S = g && g.sim; if (G && G.traffic && G.traffic.length && S && S.mkEnt && S.removeEnt) { state.traf = 1; const REPL = ['sedan', 'suv', 'pickup', 'sedan', 'hatch', 'suv'], COL = [0xf2f2f0, 0x1a1c20, 0x8a8e94, 0x23344a, 0xb01c1c, 0xd8d4c8, 0x2a5a8a, 0x6fd6c8]; let k = 0;
      for (const e of G.traffic.slice()) { if (!/^(bus|taxi|trike|van)$/.test(e.kind) || e === (g.player && g.player.ent)) continue; const path = e.path, sv = e.s, cr = e.cruise || 10; try { S.removeEnt(e); if (!/taxi|van/.test(e.kind) || !path) continue; const c = S.mkEnt(REPL[k % REPL.length], { mode: 'traffic', cruise: cr, color: COL[(k * 3) % COL.length] }); k++; S.placeOnPath(c, path, sv); c.v = cr * .8; G.traffic.push(c); } catch (err) { console.warn('[coast] traffic swap', err); } } } }
    if (QS.get('hud') === '0' && (state.hudT = (state.hudT || 0) - dt) <= 0) { state.hudT = 1; const e = document.getElementById('of-ui'); if (e) e.style.display = 'none'; }
    for (const f of UPD) { try { f(dt, state); } catch (e) { if (!f.bad) { f.bad = 1; console.warn('[coast] update', e); } } }
    if (C.sk) try { C.sk.update(dt); } catch (e) {}
    if (J) { try { J.update(dt); } catch (e) { if (!state.jbad) { state.jbad = 1; console.warn('[coast] 玉埠 update', e); } }
      if (!state.ctShops && state.t > 1) state.ctShops = ctShops(); if (state.shopKeep && GT.shops && !GT.shops.isOpen) { Object.assign(state.shopKeep[0], state.shopKeep[1]); state.shopKeep = null; } }
    if (!state.keepers && state.t > 1.2 && GT.cngame && GT.cngame.sim && GT.cngame.sim.NPCS && GT.people && GT.people.make) { state.keepers = 1; const MAP = { vendor: 'patron_f', auntie: 'sundress', uncle: 'local_m', office_m: 'guest' };   /* the shop keepers of js/shops.js are China-edition figures: dress them for the beach */
      for (const n of GT.cngame.sim.NPCS) { if (!n.keep || !MAP[n.kind] || !n.group) continue; try { const f = GT.people.make(MAP[n.kind], { seed: 7 + (n.x | 0) }); if (!f || !f.group) continue; const par = n.group.parent; if (par) { par.remove(n.group); par.add(f.group); } f.group.visible = n.group.visible; n.fig = f; n.group = f.group; } catch (e) {} } }
    const pin = state.cam || (CAMP && LOOKP ? { p: CAMP, l: LOOKP } : null); if (pin && GT.cngame && GT.cngame.camera) { const c = GT.cngame.camera; c.position.set(pin.p[0], pin.p[1], pin.p[2]); c.up.set(0, 1, 0); c.lookAt(pin.l[0], pin.l[1], pin.l[2]); if (QS.get('fov') && c.fov !== +QS.get('fov')) { c.fov = +QS.get('fov'); c.updateProjectionMatrix(); } c.updateMatrixWorld(true); } }

  /* ---- the main menu over the coast (round 2): js/cngame.js plays its menu flyby from FLYBY_CT whenever GT.chinatown is active; the coast swaps in its own golden-hour
     shots the frame the menu cutscene starts, and puts its own name on the menu corner and the loading captions. GT.coast.menu is the same data as an interface, for when
     js/cngame.js reads it itself (see the notes CO2). */
  const MENU = { hours: 17.6, corner: ['维尔蒙港 · 月湾', '月湾大道 · 自由漫游'], caps: [['城市', '维尔蒙港', '海风、霓虹，和永远堵在跨海桥上的车。'], ['街区', '月湾 · 月湾大道', '白沙滩、救生员小屋、一排粉彩装饰风酒店。'], ['座驾', '满街都是', '路边停的车都能开走，敞篷的也行。有人看见就会报警。'], ['通缉', '警察', '星越多追得越紧。离开视线几秒，追捕就变成搜索。']], spawn: MSPAWN,
    flyby: [
      { d: 14, fi: 1.2, f: [40, 38], sh: .45, p: [[-74, 5.5, -128], [-70, 6.8, -100]], l: [[-38, 4, 30], [-34, 5, 62]] },          /* low over the sand, up the beach: huts, umbrellas, the hotel row in the sun */
      { d: 13, fi: 1.2, f: [42, 40], sh: .45, p: [[-6.5, 3.0, -150], [-5.5, 3.4, -126]], l: [[16, 6.5, -104], [16, 7, -76]] },       /* Moonbay Drive: the sea-side pavement, the deco fronts lit gold */
      { d: 13, fi: 1.2, f: [40, 38], sh: .45, p: [[-150, 2.6, -24], [-142, 3.2, -40]], l: [[-86, 2.2, -34], [-80, 3, -40]] },         /* from the water: the surf, a lifeguard hut, the palms */
      { d: 13, fi: 1.2, f: [38, 37], sh: .45, p: [[-34, 16, 36], [-30, 27, 44]], l: [[36, 9, 10], [56, 13, 0]] },                    /* crane up over the park: the hotels, the towers behind */
      { d: 15, fi: 1.2, f: [48, 46], sh: .3, p: [[-240, 92, -70], [-228, 104, -36]], l: [[-82, 0, 30], [-70, 0, 52]] }               /* the whole bay from the air */
    ] };
  function menuStep(dt) { const g = GT.cngame; if (!g || !g.G) return; const G = g.G, D = g.sim && g.sim.DIR;
    if (D && D.cur && D.cur.menu && !D.cur._coast) { const c = D.cur, sh = MENU.flyby.map(q => Object.assign({}, q)); let t = 0; for (const q of sh) { q.t0 = t; t += q.d; } c.shots = sh; c.i = 0; c.t = 0; c.len = t; c._coast = 1; try { if (g.sim.shotPose) g.sim.shotPose(c, 0); const cam = g.camera; cam.position.copy(D.p); cam.lookAt(D.l); if (D.fov && cam.fov !== D.fov) { cam.fov = D.fov; cam.updateProjectionMatrix(); } } catch (e) {} }
    if ((state.domT = (state.domT || 0) - dt) > 0) return; state.domT = .25;
    if (G.phase === 'menu') { const co = document.querySelector('#gtf .f-menu .fm-corner'); if (co && /玉埠|灯笼/.test(co.innerHTML)) co.innerHTML = '<b>' + MENU.corner[0] + '</b><span>' + MENU.corner[1] + '</span>'; }
    const cap = document.querySelector('.cn-load .cl-cap'); if (cap && cap.children.length > 2) { const i = MENU.caps.findIndex(q => q[0] === cap.children[0].textContent); if (i >= 0 && (cap.children[1].textContent !== MENU.caps[i][1] || cap.children[2].textContent !== MENU.caps[i][2])) { cap.children[1].textContent = MENU.caps[i][1]; cap.children[2].textContent = MENU.caps[i][2]; } } }

  /* ---- parked cars are real vehicles; the sea sends swimmers back to the sand */
  function populate(api) { let n = 0; const lim = QS.get('parked') !== null ? +QS.get('parked') : 20, thin = QS.get('parked') !== null ? 0 : 1; for (let i = 0; i < PARK.length; i++) { const p = PARK[i]; if (n >= lim && !p.hero) break; if (thin && !p.hero && !p.opts && i % 3 === 2) continue; try { const e = api.spawnVehicle(p.kind, p.x, p.z, p.h, p.opts ? { color: p.color, mode: 'parked', opts: p.opts } : { color: p.color, mode: 'parked' }); if (p.hero && e) GT.coast.heroCar = e; if (p.opts && e) { OPEN.add(e); if (!GT.coast.convertible) GT.coast.convertible = e; } n++; } catch (e) { console.warn('[coast] parked ' + p.kind, e); } } GT.coast.stats.parkedSpawned = n;
    if (J) { let m = 0; const lim = QS.get('ctparked') !== null ? +QS.get('ctparked') : 11; for (const p of J.park()) { if (m >= lim) break; try { api.spawnVehicle(p.kind, p.x, p.z, p.h, { color: p.color, mode: 'parked' }); m++; } catch (e) { console.warn('[coast] 玉埠 parked ' + p.kind, e); } } GT.coast.stats.jadeParked = m; }
    /* MG (PT1): two patrol cars at the kerb outside the police station, an ambulance in the bay outside the emergency entrance */
    if (QS.get('civic') !== '0') { const cv = C.civic || {}; try { if (cv.police) for (const dz of [-6.5, 6.8]) api.spawnVehicle('police', PKX, cv.police.zc + dz, PI, { mode: 'parked' }); if (cv.hospital) api.spawnVehicle('ambulance', PKX, cv.hospital.zc - 3.2, PI, { mode: 'parked' }); } catch (e) { console.warn('[coast] civic cars', e); } }
    /* MG: two closed loops through 灯笼街 in the engine's path format (cngame's sim.mkPath), sharing 月湾大道 and the back road with the main loop. Not driven from here:
       js/traffic.js (TF) owns the coast's moving cars and places them on loopA / loopB only; GT.coast.jadePaths is there for it to use. */
    try { const S = api.sim; if (J && S && S.mkPath) { const zA = -95 - LA, zB = -95 + LA; GT.coast.jadePaths = [S.mkPath([[-LA, zA], [-LA, 162.25], [BX + 2.25, 162.25], [BX + 2.25, zA]], 7, true), S.mkPath([[LA, 157.75], [LA, zB], [BX - 2.25, zB], [BX - 2.25, 157.75]], 6, true)]; } } catch (e) { console.warn('[coast] 灯笼街 paths', e); }
    if (api.on) api.on('water', () => { const p = api.player; try { api.teleport(xw(p.z) + 8, p.z, -HP); if (api.say) api.say('救生员', '回来！别往深处游。', 2.2); } catch (e) {} return true; });
    try { const S = api.sim, G = api.G; if (S && S.mkEnt && S.placeOnPath && G && G.traffic && api.paths) for (const [kind, path, f, cruise, col, vr] of [['sports', 'loopA', .35, 10.5, 0xf2f0ea, 'roadster'], ['muscle', 'loopB', .55, 10, 0x5fd0c4, 'conv'], ['sports', 'loopB', .78, 11, 0xe86a9a], ['muscle', 'loopA', .02, 10.5, 0xf2d24a], ['sports', 'loopB', .2, 10, 0xd8203a, 'roadster'], ['muscle', 'loopA', .66, 9.5, 0xf4f2ee, 'conv']]) { const pth = api.paths[path]; if (!pth) continue; const c = S.mkEnt(kind, vr ? { mode: 'traffic', cruise, color: col, opts: { variant: vr } } : { mode: 'traffic', cruise, color: col }); S.placeOnPath(c, pth, pth.len * f); c.v = cruise * .8; G.traffic.push(c); if (vr) OPEN.add(c); } } catch (e) { console.warn('[coast] extra traffic', e); } }
  const SHOPN = { outlet: '海盐服饰 Sea Salt Apparel', stall: '浪花泳装 Swell Swimwear', tailor: '亚麻西服 Linen & Palm Tailors', tofu: '珊瑚枪械 Coral Arms', weapons: '冲浪五金 Surf & Hardware', dealer: '月湾经典车行 Moonbay Classic Motors' };
  function placeShops(SITES) { for (const s of SITES) { const p = SITEPOS[s.id]; if (p && isFinite(p.x)) { s.x = p.x; s.z = p.z; s.h = p.h; if (C.counter && s.id !== 'dealer') s.build = C.counter; s.fp = [max(.6, min(1.2, (p.hw || 2) - .4)), .7, 2.0]; s.stand = 1.45; s.n = s.label = SHOPN[s.id] || s.n; }
    else if (s.id === 'dealer') { s.x = 41.2; s.z = 30.5; s.h = HP; s.n = s.label = SHOPN.dealer; } } }
  /* ---- MG: 玉埠's five shop counters. js/shops.js knows one site per shop (weapons, tofu, stall, outlet, tailor), placed on 月湾大道; 玉埠 has the same five shops in its bays.
     Each gets its counter and its own prompt here; using it moves that site to the 玉埠 counter for as long as the bill is open (GT.shops.open), then puts it back. */
  function ctShops() { const sh = GT.shops; if (!J || !sh || !sh.sites || !sh.open || !GT.act || !GT.act.add) return false; const N = J.shopNames, SP = J.sites, out = [];
    for (const id of ['weapons', 'tofu', 'stall', 'outlet', 'tailor']) { const p = SP[id]; if (!p || !isFinite(p.x) || !sh.sites.some(q => q.id === id)) continue; const st = { id, x: p.x, z: p.z, h: p.h, y: groundHeight(p.x, p.z), stand: 1.45, fp: [max(.6, min(1.2, (p.hw || 2) - .4)), .7, 2.0], n: N[id], label: N[id], clothes: /stall|outlet|tailor/.test(id) };
      try { J.counter(st); } catch (e) { console.warn('[coast] 玉埠 counter', e); }
      const fx = Math.sin(st.h), fz = Math.cos(st.h), sx = min(1, (st.fp[0] + .4) * 2 / 2.7) * .95, cx = st.x + fx * .1, cz = st.z + fz * .1; GT.world.addBox(cx - abs(fz) * sx - abs(fx) * .32, cz - abs(fx) * sx - abs(fz) * .32, cx + abs(fz) * sx + abs(fx) * .32, cz + abs(fx) * sx + abs(fz) * .32, 1.2, 'shop:ct:' + id);
      GT.act.add({ id: 'ct:shops:' + id, x: st.x - fx * .35, z: st.z - fz * .35, r: st.stand + 1.75, label: st.label, enabled: c => !sh.isOpen && (!c || !c.pos || (c.pos.x - st.x) * fx + (c.pos.z - st.z) * fz > -.15), onUse: () => openAt(st) }); out.push(st); }
    GT.coast.mapShops = out; return true; }
  function openAt(st) { const sh = GT.shops, s = sh && sh.sites && sh.sites.find(q => q.id === st.id); if (!s || sh.isOpen || state.shopKeep) return false; const keep = {}; for (const k of ['x', 'z', 'h', 'y', 'stand', 'fp', 'n', 'label']) keep[k] = s[k];
    Object.assign(s, { x: st.x, z: st.z, h: st.h, y: st.y, stand: st.stand, fp: st.fp, n: st.n, label: st.label }); let ok = false; try { ok = sh.open(st.id); } catch (e) { console.warn('[coast] 玉埠 shop', e); } if (ok) state.shopKeep = [s, keep]; else Object.assign(s, keep); return ok; }
  /* ---- the minimap and the big map */
  function mapBase(rect, which) { const big = which === 'big', road = big ? '#7a7f87' : '#6d7178', walk = big ? '#5c5a56' : '#4e4d4a';
    rect(-3000, -3000, 3000, 3000, big ? '#1d2124' : '#24282b'); rect(-3000, -3000, -112, 3000, big ? '#1f5f7a' : '#1d5068'); rect(-3000, -3000, -160, 3000, big ? '#18466a' : '#163e5a');
    rect(-112, -3000, -52, 3000, big ? '#cbbf9c' : '#b0a585'); rect(-52, -3000, -38, 3000, big ? '#9a9a6a' : '#86865c'); rect(-38, -3000, PK, 3000, big ? '#4f7a46' : '#44683c');
    rect(PK, -3000, -HW, 3000, walk); rect(HW, -3000, FX, 3000, walk); rect(FX, -IZ, AL0, IZ, '#8a5f6a'); rect(AL1, -IZ, IX, IZ, '#3a3d40');
    rect(-HW, -ZEND, HW, ZEND, road); rect(0, -OZ, OX, -IZ, road); rect(0, IZ, OX, OZ, road); rect(IX, -OZ, OX, OZ, road); for (const q of SIDE) rect(HW, q.z - q.hw, q.walk ? AL1 : 66, q.z + q.hw, road); rect(AL0, -IZ, AL1, IZ, big ? '#6a6660' : '#5e5a55'); rect(39, 26, 57, 46, big ? '#56534e' : '#4c4a46');
    rect(-.12, -ZEND, .12, ZEND, '#c9b25a'); for (const [x, z] of C.trees) rect(x - .9, z - .9, x + .9, z + .9, big ? 'rgba(110,170,90,.8)' : 'rgba(110,170,90,.6)'); for (const hz of C.hotels) rect(FX, hz[0], FX + 18, hz[1], hz[2]);
    if (J) J.mapBase(rect, which); const cv = C.civic || {}; if (cv.police) rect(FX, cv.police.zc - 14, FX + 18, cv.police.zc + 14, '#2a4a7a'); if (cv.hospital) rect(FX, cv.hospital.zc - 14, FX + 18, cv.hospital.zc + 14, '#2a7a84'); }   /* MG: 玉埠 over the coast; the police station and the hospital */
  function zoneName(x, z) { if (x < -112) return '月湾海面 Moonbay Waters'; if (x < -50) return '白沙滩 Whitesand Beach'; if (x < PK) return '棕影公园 Palmshade Park'; if (J) { const n = J.zoneName(x, z); if (n) return n; } for (const q of SIDE) if (abs(z - q.z) < q.hw + 2 && x > HW && x < 66) return q.name; if (x >= AL0 - 1 && x <= AL1 + 1) return '贝壳巷 Shell Ln'; if (x > 39 && x < 58 && z > 26 && z < 46) return '月湾汽修 Moonbay Garage'; if (abs(x) < FX + 2) return '月湾大道 Moonbay Dr'; if (x > IX - 6) return '棕榈大道 Palmera Ave'; return '月湾 Moonbay'; }

  GT.cnroad = { build, update, groundHeight, surfaceAt, inRoad, onCrossing, lanes: makeLanes(), signals, busStops: BUS, stats: GT.coast.stats, busLaneX: LA,
    layout: { halfWidth: HW, kerb: KERB, laneA: LA, laneB: LA, bike: LBK, crossings: XING.slice(), zebraHalf: ZH, stopOffset: STOP, railGapHalf: 0, sidewalkEast: [HW, FX], sidewalkWest: [PK, -HW], zoneY: 0, innerBlock: [FX, -IZ, IX, IZ] } };
  Object.assign(GT.coast, { C, state, menu: MENU, openTop: OPEN, pinCamera: (p, l) => { state.cam = p ? { p, l } : null; }, mapBase, populate, placeShops, people: () => PEOPLE, sitePos: SITEPOS, zoneName, inWater, groundHeight,
    mapLabels: [[0, -20, '月湾大道 Moonbay Dr'], [-26, 40, '棕影公园 Palmshade Park'], [-82, 0, '白沙滩 Whitesand Beach'], [36, 18, '十一街 11th St'], [36, 0, '贝壳巷 Shell Ln'], [48, 36, '汽修 Garage'], [150, 30, '棕榈大道 Palmera Ave'], [-260, 0, '月湾 Moonbay'], [24, 182, '警察局 Police'], [24, -182, '医院 Hospital']].concat(J ? J.mapLabels : [[36, -95, '八街 8th St']]),
    mainStreet: '月湾大道 Moonbay Dr', mapShops: [],
    /* MG (PT1): where js/cngame.js puts you back after an arrest or a knock-out (it reads GT.coast.respawn first) */
    respawn: { police: { x: 8.8, z: 182, h: -HP, name: '月湾警局门口' }, hospital: { x: 8.8, z: -182, h: -HP, name: '月湾医疗中心急诊门口' } },
    views: { aerial: 'cam=-235,100,-48&look=-82,0,34&fov=50&px=-80&pz=20&t=17.25', beach: 'px=-95&pz=-66&ph=-6&yaw=-6&pitch=2&view=fp&t=17.25', hotels: 'px=-8.3&pz=-128&ph=22&yaw=22&pitch=-3&view=fp&t=17.25', palms: 'px=-13.5&pz=6&ph=78&yaw=78&pitch=-34&view=fp&t=17.25', night: 'cam=-8.2,1.7,-72&look=14,6.5,-30&fov=60&px=-20&pz=-100&t=21', drive: 'auto=car&view=chase&pz=150&t=17.25',
      /* MG: 玉埠 Jade Landing */ jadeFromDrive: 'cam=10,1.8,-95.6&look=70,6,-95&fov=40&px=9&pz=-116&t=14', jadeGate: 'cam=42,1.7,-95.4&look=62,7.5,-95&fov=58&px=38&pz=-99&t=14', jadeStreet: 'cam=134,1.7,-92.2&look=190,3.5,-96.5&fov=58&px=128&pz=-88&t=14', jadeNight: 'cam=96,1.6,-87&look=150,6,-96&fov=60&px=90&pz=-86&t=21', jadeJunction: 'cam=24,2.6,-97.6&look=62,4.5,-93&fov=64&px=21&pz=-99&t=14', jadeAir: 'cam=-160,110,-95&look=140,0,-95&fov=45&px=40&pz=-88&t=14', police: 'cam=-6,2.2,166&look=16,6,184&fov=58&px=-6&pz=150&t=14', hospital: 'cam=-6,2.2,-166&look=16,5,-184&fov=58&px=-6&pz=-150&t=14' } });
})();
