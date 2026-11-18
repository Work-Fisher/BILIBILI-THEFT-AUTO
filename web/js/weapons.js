/* weapons.js — BILIBILI THEFT AUTO 1 (China edition) hand weapons (owner: combat agent). Original designs, names and markings.
   list = fists, helmet (阿凯's rider helmet swung by the chin strap), bat, pipe, pistol, revolver, shotgun, smg.  (crowbar / rifle models stay available through make() but are not in the wheel.)
   GT.weapons = { defs, list, slots, make(id, opts?) -> { group, id, def, muzzle, ejector, support, twoHanded, update(dt, {fired, reloading, slideBack}) }, icon(id, w?, h?) -> canvas, tris(id) }
   Weapon space: grip (web of the firing hand) at the origin, barrel along +Z, +Y up, the shooter's LEFT is +X (so the ejection port is on -X).
   Models are built with GT.kit from many small bevelled parts; one template per (id, lod) is cached and instances share geometry + materials.
   Moving parts are separate child groups: slide / mag / cyl / hammer / pump / bolt.  opts.lod = 1 -> no bevels, static merge (for NPC hands at 6 m+). */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!T || !GT) return;
  const PI = Math.PI, HP = PI / 2, cl = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ------------------------------------------------------------------ gameplay definitions */
  const defs = {
    fists:    { id: 'fists', name: '拳头', en: 'FISTS', kind: 'melee', slot: 0, reach: 1.25, dmg: 16, heavy: 34, stagger: .5, swing: .34 },
    helmet:   { id: 'helmet', name: '头盔', en: 'RIDER HELMET', kind: 'melee', slot: 1, reach: 1.38, dmg: 24, heavy: 58, stagger: .9, swing: .37 },
    pipe:     { id: 'pipe', name: '水管', en: 'STEEL PIPE DN20', kind: 'melee', slot: 2, reach: 1.7, dmg: 34, heavy: 78, stagger: 1, swing: .45 },
    bat:      { id: 'bat', name: '铝棒', en: 'ALLOY BAT 32', kind: 'melee', slot: 2, reach: 1.75, dmg: 30, heavy: 70, stagger: 1, swing: .42, twoHanded: false },
    crowbar:  { id: 'crowbar', name: '撬棍', en: 'PRY BAR', kind: 'melee', slot: 2, reach: 1.6, dmg: 36, heavy: 80, stagger: 1, swing: .46 },
    pistol:   { id: 'pistol', name: '灰隼 9', en: 'HUISUN 9C', kind: 'gun', slot: 3, auto: false, rpm: 420, dmg: 26, head: 3.2, pellets: 1, hip: .042, aim: .0075, bloom: .012, recoil: .021, recoilYaw: .008, mag: 12, reserve: 60, reload: 1.45,
                near: 18, far: 55, minF: .45, shell: 'brass', loud: 1, tracer: 0.5, pitch: 1 },
    revolver: { id: 'revolver', name: '白嘴鸦 .38', en: 'ROOK .38', kind: 'gun', slot: 4, auto: false, rpm: 170, dmg: 58, head: 3, pellets: 1, hip: .036, aim: .0055, bloom: .02, recoil: .05, recoilYaw: .014, mag: 5, reserve: 30, reload: 2.3,
                near: 22, far: 60, minF: .5, shell: null, loud: 1.15, tracer: 0.5, pitch: .8 },
    shotgun:  { id: 'shotgun', name: '河口 12', en: 'HEKOU 12', kind: 'gun', slot: 5, auto: false, rpm: 68, dmg: 15, head: 1.6, pellets: 9, hip: .075, aim: .05, bloom: .01, recoil: .075, recoilYaw: .018, mag: 6, reserve: 30, reload: .52, perShell: true,
                near: 7, far: 26, minF: .12, shell: 'shot', loud: 1.3, tracer: 0.2, pitch: .62, twoHanded: true, pump: .5 },
    smg:      { id: 'smg', name: '蚊子 9', en: 'MOSQUITO 9', kind: 'gun', slot: 6, auto: true, rpm: 780, dmg: 17, head: 2.6, pellets: 1, hip: .05, aim: .012, bloom: .0065, recoil: .013, recoilYaw: .009, mag: 30, reserve: 150, reload: 1.9,
                near: 14, far: 45, minF: .4, shell: 'brass', loud: .95, tracer: 0.6, pitch: 1.15, twoHanded: true },
    rifle:    { id: 'rifle', name: '苍鹭卡宾', en: 'HERON 5.56', kind: 'gun', slot: 7, auto: true, rpm: 600, dmg: 30, head: 3, pellets: 1, hip: .055, aim: .0045, bloom: .0055, recoil: .017, recoilYaw: .007, mag: 30, reserve: 120, reload: 2.2,
                near: 40, far: 110, minF: .65, shell: 'brass', loud: 1.25, tracer: 1, pitch: .9, twoHanded: true, zoom: 1.25 },
    /* SH (2026-11-17): the gun shop's new stock. sample = which recorded shot js/samples.js plays for it */
    sniper:   { id: 'sniper', name: '鹗 .308', en: 'OSPREY .308', kind: 'gun', slot: 6, auto: false, rpm: 46, dmg: 96, head: 4, pellets: 1, hip: .1, aim: .0009, bloom: .03, recoil: .085, recoilYaw: .018, mag: 5, reserve: 25, reload: 2.7,
                near: 120, far: 300, minF: .8, shell: 'brass', loud: 1.55, tracer: 1.2, pitch: .7, twoHanded: true, zoom: 4.2, sample: 'rifle', pump: .55 },
    grenade:  { id: 'grenade', name: '手雷', en: 'M-61 FRAG', kind: 'throw', slot: 7, mag: 1, reserve: 2, fuse: 2.5, radius: 7.5, dmg: 190, throwV: 15 },
    molotov:  { id: 'molotov', name: '燃烧瓶', en: 'MOLOTOV', kind: 'throw', slot: 7, mag: 1, reserve: 2, fire: true, radius: 3.4, burn: 7, dps: 28, dmg: 30, throwV: 13.5 },
    knife:    { id: 'knife', name: '战术匕首', en: 'COMBAT KNIFE', kind: 'melee', slot: 2, reach: 1.3, dmg: 42, heavy: 88, stagger: .7, swing: .3 }
  };
  const list = ['fists', 'helmet', 'bat', 'pipe', 'knife', 'pistol', 'revolver', 'shotgun', 'smg', 'rifle', 'sniper', 'grenade', 'molotov'];
  /** the 8 wheel slots, clockwise from the top. slot 1 is the rider helmet, slot 2 holds whichever melee tool is carried; slot 7 is the empty throwable slot. */
  const slots = [{ ids: ['fists'] }, { ids: ['helmet'] }, { ids: ['pipe', 'bat', 'crowbar', 'knife'] }, { ids: ['pistol'] }, { ids: ['revolver'] }, { ids: ['shotgun'] }, { ids: ['smg', 'rifle', 'sniper'] }, { ids: ['grenade', 'molotov'], label: '投掷物' }];   /* SH: slot 6 = smg / carbine / sniper (press 7 again to cycle), slot 7 = throwables + the hardware tools */

  /* ------------------------------------------------------------------ materials */
  let M = null;
  function mats() {
    if (M) return M; const m = (n, o, x) => rimMat(GT.mat(n, o), x);
    M = { steel: m('metal_dark'), steelW: m('metal_dark', { color: 0x4a4d52, rough: .36 }), blued: m('metal_dark', { color: 0x15171c, rough: .3, metal: .9 }), park: m('metal_dark', { color: 0x2b2d2f, rough: .5 }),
      poly: m('rubber', { color: 0x17181b, rough: .58 }), polyG: m('rubber', { color: 0x1d1e21, rough: .72 }), rub: m('rubber'), alu: m('aluminium_brushed'), aluD: m('aluminium_brushed', { color: 0x8d9096, rough: .42 }), chrome: m('chrome'),
      brass: m('chrome', { color: 0xc49a45, rough: .3 }), wood: m('wood_plank', { color: 0x70482a, rough: .46 }), woodD: m('wood_plank', { color: 0x4f321d, rough: .55 }), red: m('plastic_red', { color: 0x8f2a24, rough: .6 }),
      paintR: m('metal_painted_red', { color: 0x9a2a22 }), gap: m('rubber', { color: 0x050505, rough: 1 }), tape: m('fabric_dark', { color: 0x1c1d20 }), tapeW: m('fabric_dark', { color: 0xb9b4a4 }), white: m('plastic_white'),
      glass: m('glass_tint'), dot: m('neon_red'), paintK: m('metal_dark', { color: 0x10131a, rough: .44, metal: .55 }), soot: m('metal_dark', { color: 0x17130e, rough: .82, metal: .3 }), nail: m('chrome', { color: 0xb07a48, rough: .42 }),
      hose: m('rubber', { color: 0x1c4fae, rough: .5 }), green: m('plastic_white', { color: 0x2f9a4a, rough: .5 }), sdot: m('plastic_white', { color: 0xbfe8c8, rough: .6 }, { emissive: GT.C ? GT.C(0x7dffa6) : new T.Color(0x7dffa6), emissiveIntensity: .3 }),
      shell: m('car_paint', { color: 0xd8a616, rough: .34, metal: .05 }), shellD: m('car_paint', { color: 0xa87d10, rough: .5, metal: .05 }), eps: m('rubber', { color: 0x2a2b2e, rough: .95 }), pad: m('fabric_dark', { color: 0x3b3d42 }), strap: m('fabric_dark', { color: 0x16171a }), refl: m('plastic_red', { color: 0xb3261e, rough: .25 }),
      olive: m('metal_dark', { color: 0x3c4a2e, rough: .55, metal: .35 }), bottle: m('glass_tint', { color: 0x2f6a3a, rough: .05 }), fuel: m('plastic_red', { color: 0xb5651d, rough: .2 }), rag: m('fabric_dark', { color: 0x9c8a6a }), lens: m('plastic_white', { color: 0xfff6e0, rough: .1 }, { emissive: GT.C ? GT.C(0xfff2d0) : new T.Color(0xfff2d0), emissiveIntensity: .6 }),
      polyD: m('rubber', { color: 0x17181b, rough: .58 }, { side: T.DoubleSide }), clear: m('glass_tint', { color: 0xa8c8d2, rough: .04 }, { transparent: true, opacity: .16, depthWrite: false }), galv: m('metal_galv', { color: 0x8d9296, rough: .5 }), galvD: m('metal_galv', { color: 0x6c7074, rough: .62 }), rust: m('metal_rust'), teflon: m('plastic_white', { color: 0xd8d6cc, rough: .7 }) };
    return M;
  }
  /* weapon materials are private clones with an edge-light term: steel and paint pick up the two colours of the street they are on (GT.weapons.light, called once a frame by js/combat.js)
     and the player's own muzzle flash for a frame or two. No light is added to the scene for it. */
  const colL = h => GT.C ? GT.C(h) : new T.Color(h);
  const RIM = { a: { value: colL(0x1fd6c4) }, b: { value: colL(0xff3d9a) }, k: { value: 0 }, f: { value: 0 } };
  function rimMat(base, x) { if (!base || !base.isMeshStandardMaterial) return base; const c = base.clone(); c.name = base.name; if (x) for (const n in x) c[n] = x[n];
    c.onBeforeCompile = sh => { sh.uniforms.uWRimA = RIM.a; sh.uniforms.uWRimB = RIM.b; sh.uniforms.uWRimK = RIM.k; sh.uniforms.uWFlash = RIM.f;
      sh.fragmentShader = 'uniform vec3 uWRimA;\nuniform vec3 uWRimB;\nuniform float uWRimK;\nuniform float uWFlash;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ float wf = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0); wf *= wf * (3.0 - 2.0 * wf) * 0.6 + 0.12; float wg = 0.25 + 0.75 * (1.0 - roughnessFactor); totalEmissiveRadiance += (mix(uWRimA, uWRimB, smoothstep(-0.35, 0.35, normal.x)) * uWRimK * wf + vec3(1.0, 0.56, 0.2) * uWFlash * (0.12 + 0.6 * wf)) * wg; }'); };
    c.customProgramCacheKey = () => 'gtwrim'; return c; }
  const ZONES = { ave: [0x1fd6c4, 0xff3d9a], snack: [0xffa23a, 0xff3d9a], river: [0x4a8dff, 0x1fd6c4], wharf: [0xffb347, 0xff8a2a], amber: [0xffb054, 0xff7a2a], sodium: [0xffb347, 0xffb347], day: [0xffd2a6, 0x9fd6e6] }, ZC = {};
  for (const n in ZONES) ZC[n] = [colL(ZONES[n][0]), colL(ZONES[n][1])];
  const _la = new T.Color(), _lb = new T.Color(), WHT = new T.Color(.62, .7, .74);
  /** light(x, z, night 0..1, flash 0..1, zone?) — edge light for every weapon model: by day a warm sun side and a sky side, at night the main colour and the accent of the district the player stands in
      (avenue teal + magenta, snack street amber + magenta, riverside cold blue + teal, wharf sodium); zone = 'amber' | 'sodium' | ... forces one (interiors). */
  function light(x, z, night, flash, zone) { const n = cl(night || 0, 0, 1), key = ZC[zone] ? zone : z < -110 ? 'wharf' : x < -30 ? 'river' : x > 22 && x < 42 && z > -75 && z < 2 ? 'snack' : 'ave', Z = ZC[key], D = ZC.day;
    _la.copy(D[0]).lerp(Z[0], n); _lb.copy(D[1]).lerp(Z[1], n); _lb.lerp(_la, .45 * n); _la.lerp(WHT, .35 * n); _lb.lerp(WHT, .35 * n); RIM.a.value.lerp(_la, .12); RIM.b.value.lerp(_lb, .12); RIM.k.value = .07 + .15 * n;   /* a soft sheen on the edges, not a neon outline (it used to draw a magenta line round the pistol at night) */ RIM.f.value = cl(flash || 0, 0, 1) * 1.6; return key; }
  const signM = {};
  function sign(text, color, w, h) { const key = text + color; if (signM[key]) return signM[key]; const o = { style: 'stencil', color: color || '#cfcabb', w: w || 512, h: h || 96, distress: .45 };
    let m; if (GT.signMat) { const b = GT.signMat(text, o); m = b.clone(); m.onBeforeCompile = b.onBeforeCompile; if (b.customProgramCacheKey) m.customProgramCacheKey = b.customProgramCacheKey; m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; } else { m = new T.MeshStandardMaterial({ map: GT.signTex(text, o), transparent: true, depthWrite: false, roughness: .6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }); }   /* QA: was -4 / -4: seen edge-on from behind the shooter the slope term pulled the markings through his back */
    m.userData.sign = true; return signM[key] = m; }

  /* ------------------------------------------------------------------ tiny build DSL around GT.kit */
  function tools(lod) {
    let k = GT.kit();
    const bev = (o, w, h, d) => lod ? 0 : (o && o.bevel !== undefined ? o.bevel : Math.min(.004, Math.min(w, h, d) * .24));
    const H = {
      /** box */ b(m, w, h, d, x, y, z, o) { k.box(m, w, h, d, x, y, z, Object.assign({}, o, { bevel: bev(o, w, h, d) })); return H; },
      /** cylinder along Z */ cz(m, r, len, x, y, z, o) { o = o || {}; k.cyl(m, o.r2 === undefined ? r : o.r2, r, len, x, y, z, { rx: HP, seg: lod ? 8 : (o.seg || 14), open: o.open }); return H; },
      /** cylinder along X */ cx(m, r, len, x, y, z, o) { o = o || {}; k.cyl(m, r, r, len, x, y, z, { rz: HP, seg: lod ? 6 : (o.seg || 10) }); return H; },
      /** cylinder along Y */ cy(m, r, len, x, y, z, o) { o = o || {}; k.cyl(m, o.r2 === undefined ? r : o.r2, r, len, x, y, z, { seg: lod ? 6 : (o.seg || 10), rx: o.rx, rz: o.rz }); return H; },
      tube(m, pts, r, o) { k.tube(m, pts, r, Object.assign({ seg: lod ? 5 : 8, steps: lod ? pts.length * 2 : pts.length * 5 }, o)); return H; },
      sph(m, r, x, y, z, s) { k.sphere(m, r, x, y, z, { seg: lod ? 6 : 12, seg2: lod ? 4 : 8, s }); return H; },
      /** marking on the left (+X, side = 1) or right (-X, side = -1) face */
      mark(text, w, h, x, y, z, side, color) { if (!lod) k.quad(sign(text, color), w, h, x, y, z, { ry: side > 0 ? HP : -HP }); return H; },
      geo(m, g, o) { k.geo(m, g, o); return H; },
      /** side profile [[z, y], ...] extruded to a rounded slab of the given width (stocks, grips) */
      prof(m, pts, width, round) { round = lod ? 0 : (round === undefined ? width * .3 : round); const sh = new T.Shape(); pts.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])); sh.closePath();
        const g = new T.ExtrudeGeometry(sh, { depth: width - round * 2, bevelEnabled: round > 0, bevelThickness: round, bevelSize: round, bevelOffset: -round, bevelSegments: lod ? 1 : 3, curveSegments: 4 }); g.translate(0, 0, -(width - round * 2) / 2); g.rotateY(-HP);
        const uv = g.attributes.uv, pp = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getZ(i), pp.getY(i) + pp.getX(i)); k.geo(m, g); return H; },
      push(x, y, z, o) { k.push(x, y, z, o); return H; }, pop() { k.pop(); return H; },
      /** finish the current part -> named Group; starts a new kit */
      end(name) { const g = k.build(); g.name = name; for (const c of g.children) { if (!(c.material.userData && c.material.userData.sign)) { const uv = c.geometry.attributes.uv; const wd = /wood/.test(c.material.name), su = wd ? .35 : 5.5, sv = wd ? 2.2 : 5.5; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + .13, uv.getY(i) * sv + .31); }
          else { c.castShadow = false; c.renderOrder = 2; } }
        k = GT.kit(); return g; }
    };
    return H;
  }
  const loop = (n, f) => { for (let i = 0; i < n; i++) f(i); };

  /* ================================================================== models */
  const BUILD = {};

  /* ---- 灰隼 9C: compact service pistol, an old one. Bore axis y = .051. Built from separate parts: frame + raked grip (20 degrees), squared trigger guard, slide with its own sights,
     a barrel and guide rod that stay put when the slide locks back on an empty magazine, electrician's tape round the grip, the safety lever worn to bright steel.
     The sight picture is real: two rear posts and the front blade end flush at y = sightY, so first person lines the notch up on the screen centre (js/combat.js). */
  BUILD.pistol = (H, m, lod) => {
    const out = {}, RK = .34;
    H.b(m.poly, .026, .014, .124, 0, .031, .057, { bevel: .003 }).b(m.poly, .0225, .014, .060, 0, .032, -.028, { bevel: .005 })      /* dust cover + rear of the frame under the slide */
      .b(m.poly, .017, .005, .014, 0, .033, -.062, { rx: -.25, bevel: .002 })                                                     /* beavertail */
      .prof(m.polyG, [[.012, .024], [-.036, .026], [-.047, -.010], [-.058, -.045], [-.074, -.083], [-.026, -.083], [-.012, -.045], [0, -.012]], .0285, .008)   /* grip, raked back */
      .prof(m.poly, [[-.004, -.002], [-.040, -.002], [-.064, -.074], [-.029, -.074]], .0297, .003)                                /* worn side panels */
      .b(m.poly, .0295, .007, .056, 0, -.0865, -.049, { bevel: .003 }).b(m.steel, .022, .003, .040, 0, -.0915, -.049)            /* magazine floor plate */
      .b(m.poly, .011, .046, .0055, 0, .001, .064, { rx: -.08, bevel: .002 }).b(m.poly, .011, .0055, .070, 0, -.021, .030, { bevel: .002 })   /* squared trigger guard */
      .b(m.steel, .0058, .024, .0058, 0, .003, .030, { rx: -.32, bevel: .002 })                                                 /* trigger */
      .cx(m.steel, .0042, .0305, 0, .004, .004).cx(m.steelW, .0021, .0275, 0, .026, .030).cx(m.steelW, .0021, .0275, 0, .025, -.030)    /* magazine catch + pins */
      .b(m.steel, .003, .0055, .032, .0142, .0365, .010).b(m.steel, .0045, .007, .009, .0155, .0385, -.006, { bevel: .002 })     /* slide stop (left) */
      .b(m.steel, .0295, .005, .010, 0, .028, .052, { bevel: .0015 })                                                           /* take-down bar */
      .b(m.alu, .0042, .0075, .020, .0152, .0375, -.040, { rx: -.12, bevel: .002 }).cx(m.alu, .0048, .004, .0152, .036, -.049, { seg: 8 })   /* safety lever: worn bright */
      .cz(m.aluD, .0066, .112, 0, .051, .073, { seg: 12 }).cz(m.gap, .0046, .003, 0, .051, .1282, { seg: 10 }).cz(m.steel, .0042, .100, 0, .0395, .070, { seg: 8 })   /* barrel + guide rod stay with the frame */
      .mark('江城机械 · 九毫米', .040, .0056, -.0134, .031, .066, -1, '#77756c');
    loop(3, i => H.b(m.gap, .0263, .0032, .004, 0, .0245, .078 + i * .012, { bevel: 0 }));                                        /* rail slots */
    loop(4, i => { const y = -.027 - i * .0098 + (i === 2 ? .0012 : 0); H.b(i === 1 ? m.pad : m.tape, .0303 + (i % 2) * .0005, .0104, .0515, 0, y, -.012 + (y - .024) * .355 - .0005, { rx: RK + (i === 3 ? .05 : -.02 * i), bevel: .0016 }); });   /* electrician's tape, four turns (one faded) */
    H.b(m.tape, .0016, .013, .012, .0164, -.060, -.058, { rz: -.5, rx: RK, bevel: 0 });                                          /* the lifted corner of the last turn */
    out.body = H.end('body');
    H.b(m.blued, .026, .024, .176, 0, .051, .033, { bevel: .004 }).b(m.park, .012, .0016, .150, 0, .0632, .036, { bevel: 0 })
      .b(m.steelW, .0022, .0012, .160, .0112, .0618, .033, { rz: -.78, bevel: 0 }).b(m.steelW, .0022, .0012, .160, -.0112, .0618, .033, { rz: .78, bevel: 0 })   /* top edges rubbed to steel */
      .b(m.steelW, .0268, .0245, .0025, 0, .051, .1205, { bevel: .004 })                                                        /* holster wear round the muzzle */
      .b(m.gap, .0125, .0125, .032, -.0078, .0572, .018, { bevel: .001 }).b(m.aluD, .0105, .0095, .028, -.0072, .0568, .0185, { bevel: .001 })   /* ejection port + barrel hood */
      .b(m.steel, .003, .004, .018, -.0134, .052, -.008)                                                                         /* extractor */
      .cz(m.gap, .0026, .0012, 0, .050, -.0552, { seg: 8 })                                                                      /* striker hole in the plain rear face */
      .b(m.steel, .0036, .0068, .0085, 0, .0692, .112, { bevel: .0006 })                                                         /* front blade */
      .b(m.steel, .022, .0042, .013, 0, .0648, -.045, { bevel: .001 }).b(m.steel, .0066, .0064, .0085, .0071, .0694, -.046, { bevel: .0006 }).b(m.steel, .0066, .0064, .0085, -.0071, .0694, -.046, { bevel: .0006 })   /* rear sight: base + two posts */
      .b(m.sdot, .0017, .0017, .0005, 0, .0707, .1076, { bevel: 0 }).b(m.sdot, .0017, .0017, .0005, .0071, .0707, -.0504, { bevel: 0 }).b(m.sdot, .0017, .0017, .0005, -.0071, .0707, -.0504, { bevel: 0 })
      .mark('灰隼 9C', .046, .0098, .0131, .050, .062, 1, '#8f8c82').mark('HS-09-4471', .030, .0052, -.0131, .0445, .070, -1, '#6f6d66');
    loop(7, i => { const z = -.049 + i * .0047; H.b(m.gap, .0264, .0185, .0019, 0, .0495, z, { rx: .2, bevel: 0 }); });            /* rear cocking grooves */
    out.slide = H.end('slide');
    H.b(m.steel, .021, .098, .030, 0, -.036, -.036, { rx: RK, bevel: .003 }).b(m.brass, .008, .004, .020, 0, .012, -.016, { bevel: .001 }); out.mag = H.end('mag'); out.mag.visible = false;   /* shows only while it is out of the grip */
    return { parts: out, muzzle: [0, .051, .132], ejector: [-.016, .058, .018], support: [.012, -.022, .012], slideTravel: .038, magDrop: [0, -.15, -.055], sightY: .0727, len: [-.076, .13] };
  };

  /* ---- ROOK .38: five-shot snub revolver. Bore axis y = .052 */
  BUILD.revolver = (H, m, lod) => {
    const out = {};
    H.b(m.steelW, .017, .064, .036, 0, .026, -.012, { bevel: .006 }).b(m.steelW, .016, .010, .060, 0, .0665, .012, { bevel: .003 })      // frame rear + top strap
      .b(m.steelW, .017, .022, .060, 0, .008, .025, { bevel: .005 }).b(m.steelW, .017, .050, .012, 0, .040, .052, { bevel: .003 })        // frame bottom + front
      .cz(m.steelW, .0095, .052, 0, .052, .083, { seg: 16 }).b(m.steelW, .012, .018, .050, 0, .037, .082, { bevel: .004 })                 // barrel + ejector shroud
      .cz(m.gap, .0048, .0525, 0, .052, .0835).cz(m.steel, .0034, .034, 0, .036, .083)                                                     // bore + ejector rod
      .b(m.steelW, .005, .009, .022, 0, .0685, .094, { rx: .3 }).b(m.red, .0035, .003, .008, 0, .0715, .090, { rx: .3 })                  // ramp front sight + insert
      .b(m.gap, .005, .004, .014, 0, .0718, -.012)                                                                                         // rear notch
      .b(m.steel, .004, .010, .012, .0105, .040, -.020).b(m.steel, .003, .006, .006, .0118, .041, -.020)                                   // cylinder latch
      .cx(m.steel, .003, .0185, 0, .012, .014).cx(m.steel, .0022, .0185, 0, .030, -.022).cx(m.steel, .0022, .0185, 0, .052, .046)          // screws
      .tube(m.steelW, [[0, .000, .046], [0, -.018, .046], [0, -.032, .032], [0, -.03, .008], [0, -.012, -.002]], .0036)
      .b(m.steel, .0058, .024, .007, 0, -.008, .022, { rx: .45 })
      // round-butt wood grip
      .prof(m.wood, [[.004, -.004], [.006, -.022], [-.001, -.042], [-.014, -.060], [-.034, -.066], [-.050, -.056], [-.049, -.036], [-.039, -.014], [-.034, .012], [-.02, .012]], .028, .010).b(m.steelW, .012, .056, .010, 0, -.020, -.0425, { rx: .3, bevel: .004 })   /* two-and-a-half-finger round butt (was a full-size grip) */
      .cx(m.brass, .0056, .0285, 0, -.020, -.018).cx(m.steel, .003, .029, 0, -.046, -.030)
      .b(m.gap, .0172, .044, .0012, 0, .0405, .0445, { bevel: 0 })   /* powder scorch in the cylinder gap */
      .mark('白嘴鸦 .38', .034, .0072, .0088, .0155, .026, 1, '#3a3a3a').mark('五连发', .016, .0046, -.0088, .0155, .034, -1, '#3a3a3a');
    out.body = H.end('body');
    H.cz(m.blued, .0188, .040, 0, 0, 0, { seg: 20 });
    loop(5, i => { const a = i / 5 * PI * 2 + .3, a2 = a + PI / 5; H.cz(m.gap, .0052, .028, Math.sin(a) * .0185, Math.cos(a) * .0185, .006, { seg: 8 });                // flutes
      H.cz(m.brass, .0052, .0015, Math.sin(a2) * .0118, Math.cos(a2) * .0118, -.0205, { seg: 10 }).cz(m.steelW, .0018, .0018, Math.sin(a2) * .0118, Math.cos(a2) * .0118, -.021, { seg: 6 }); });
    H.cz(m.steel, .004, .046, 0, 0, 0); out.cyl = H.end('cyl'); out.cyl.position.set(0, .0405, .022);
    H.b(m.steel, .0065, .020, .009, 0, .008, -.004, { rx: -.4 }).b(m.steel, .009, .005, .014, 0, .017, -.012, { rx: -.2 }); loop(4, i => H.b(m.steelW, .0092, .001, .0015, 0, .0198, -.016 + i * .003, { rx: -.2, bevel: 0 }));
    out.hammer = H.end('hammer'); out.hammer.position.set(0, .052, -.030);
    return { parts: out, muzzle: [0, .052, .113], ejector: [-.02, .04, .02], support: [.01, -.03, .008], cylStep: PI * 2 / 5, sightY: .0745, len: [-.055, .112] };
  };

  /* ---- BAYOU 12: pump shotgun, wood furniture, side shell carrier. Bore axis y = .058 */
  BUILD.shotgun = (H, m, lod) => {
    const out = {};
    H.b(m.park, .042, .062, .225, 0, .042, .085, { bevel: .007 }).b(m.park, .034, .008, .20, 0, .0745, .085, { bevel: .002 })                 // receiver + top flat
      .cz(m.park, .0115, .47, 0, .058, .430, { seg: 16 }).cz(m.gap, .0092, .0102, 0, .058, .6605)                                              // barrel + bore
      .cz(m.park, .0125, .36, 0, .030, .378, { seg: 14 }).cz(m.steelW, .0135, .016, 0, .030, .565).cz(m.steel, .006, .006, 0, .030, .575).cz(m.gap, .0138, .002, 0, .030, .560).cz(m.gap, .0138, .002, 0, .030, .568)       // magazine tube + cap
      .b(m.steel, .034, .044, .016, 0, .044, .535, { bevel: .004 }).cx(m.steelW, .003, .036, 0, .044, .535)                                    // barrel clamp
      .sph(m.brass, .0036, 0, .0725, .652).b(m.park, .005, .006, .012, 0, .0685, .652)                                                         // bead sight
      .b(m.gap, .003, .022, .064, -.0205, .052, .110).b(m.chrome, .003, .017, .040, -.0198, .052, .100, { bevel: .001 })                        // ejection port + bolt
      .b(m.gap, .028, .003, .070, 0, .0105, .120)                                                                                              // loading port
      .tube(m.park, [[0, .012, .075], [0, -.012, .072], [0, -.022, .045], [0, -.018, .012], [0, .0, .002]], .0042)
      .b(m.steel, .006, .022, .007, 0, -.002, .040, { rx: .4 }).cx(m.steelW, .0045, .046, 0, .028, .004).cx(m.steelW, .0026, .0435, 0, .040, .060).cx(m.steelW, .0026, .0435, 0, .030, .130)
      .b(m.steel, .004, .006, .014, .022, .020, .068)                                                                                          // action release
      // stock: wrist, comb, butt, recoil pad
      .prof(m.wood, [[.0, .058], [-.06, .050], [-.11, .036], [-.16, .040], [-.335, .030], [-.335, -.088], [-.20, -.050], [-.10, -.022], [-.065, -.050], [-.035, -.062], [-.012, -.048], [-.02, -.012], [.0, .004]], .040, .013)
      .b(m.rub, .041, .124, .022, 0, -.029, -.346, { bevel: .006 }).b(m.steel, .042, .122, .004, 0, -.029, -.335, { bevel: .001 })
      .cx(m.steel, .004, .014, 0, -.072, -.26).tube(m.steel, [[-.006, -.074, -.26], [0, -.092, -.26], [.006, -.074, -.26]], .0022).tube(m.steel, [[-.006, .014, .59], [0, -.002, .59], [.006, .014, .59]], .0022)   // sling swivels
      // side shell carrier (left)
      .b(m.aluD, .004, .050, .130, .0228, .042, .085, { bevel: .0015 }).b(m.poly, .016, .012, .128, .032, .026, .085, { bevel: .003 });
    loop(5, i => { const z = .035 + i * .025; H.cy(m.red, .0098, .046, .034, .048, z, { seg: 10 }).cy(m.brass, .0102, .012, .034, .020, z, { seg: 10 }).cy(m.poly, .0112, .012, .034, .046, z, { seg: 8 }); });
    H.cx(m.steelW, .0028, .006, .026, .062, .030).cx(m.steelW, .0028, .006, .026, .062, .140)
      .mark('河口 12号', .07, .0125, -.0214, .030, .150, -1, '#8a877c').mark('江城五金工具厂', .07, .008, .0214, .069, .120, 1, '#6d6b63');
    out.body = H.end('body');
    // pump fore-end + action bars
    H.cz(m.wood, .0245, .19, 0, .034, 0, { seg: 14 }).cz(m.woodD, .0225, .012, 0, .034, .100, { seg: 14 }).cz(m.woodD, .0225, .012, 0, .034, -.100, { seg: 14 });
    loop(11, i => H.cz(m.woodD, .0255, .0042, 0, .034, -.080 + i * .016, { seg: 14 }));
    H.b(m.steel, .003, .010, .17, .0135, .034, -.15).b(m.steel, .003, .010, .17, -.0135, .034, -.15);
    out.pump = H.end('pump'); out.pump.position.set(0, 0, .40);
    return { parts: out, muzzle: [0, .058, .67], ejector: [-.026, .054, .11], support: [.004, .012, .40], pumpTravel: .09, len: [-.36, .67] };
  };

  /* ---- MOSQUITO 9: compact SMG, folding wire stock, magazine ahead of the guard. Bore axis y = .050 */
  BUILD.smg = (H, m, lod) => {
    const out = {};
    H.b(m.park, .044, .058, .285, 0, .048, .095, { bevel: .006 }).b(m.poly, .040, .030, .16, 0, .012, .072, { bevel: .006 })                 // upper + lower
      .b(m.polyG, .030, .110, .044, 0, -.028, -.014, { rx: -.22, bevel: .008 }).b(m.rub, .0315, .06, .028, 0, -.036, -.018, { rx: -.22, bevel: .003 })
      .b(m.poly, .034, .044, .046, 0, -.012, .125, { bevel: .004 })                                                                           // mag well
      .tube(m.poly, [[0, .0, .098], [0, -.02, .094], [0, -.03, .06], [0, -.026, .024], [0, -.008, .006]], .004)
      .b(m.steel, .006, .022, .007, 0, -.006, .052, { rx: .4 })
      .cz(m.park, .017, .085, 0, .050, .278, { seg: 14 }).cz(m.steel, .0105, .028, 0, .050, .332, { seg: 12 }).cz(m.gap, .0052, .0285, 0, .050, .3325)   // shroud + barrel
      .b(m.gap, .003, .020, .050, -.0215, .056, .118).b(m.chrome, .003, .015, .030, -.021, .056, .110, { bevel: .001 })                        // ejection port
      .b(m.park, .024, .008, .250, 0, .081, .095, { bevel: .002 })                                                                            // top rail base
      .b(m.steel, .014, .022, .010, 0, .094, .205, { bevel: .003 }).b(m.steel, .022, .018, .012, 0, .092, -.020, { bevel: .003 }).b(m.gap, .006, .008, .013, 0, .096, -.020)   // sights
      .b(m.poly, .026, .020, .034, 0, .012, .222, { bevel: .005 }).b(m.polyG, .025, .062, .024, 0, -.024, .224, { rx: -.08, bevel: .007 }).geo(m.steel, new T.TorusGeometry(.0105, .002, lod ? 4 : 6, lod ? 8 : 14), { x: 0, y: .099, z: .205 })                                                                    // hand stop
      .cx(m.steelW, .0028, .0455, 0, .030, .020).cx(m.steelW, .0028, .0455, 0, .030, .150).cx(m.steelW, .004, .047, 0, .022, .095)             // pins + selector axis
      .b(m.steel, .004, .006, .018, .0235, .022, .098, { rx: .5 })                                                                            // selector
      .b(m.steel, .046, .040, .022, 0, .046, -.058, { bevel: .004 }).cx(m.steelW, .005, .05, 0, .046, -.058)                                   // stock hinge block
      .tube(m.steel, [[.017, .060, -.066], [.017, .060, -.20], [.017, .044, -.262]], .0042).tube(m.steel, [[-.017, .060, -.066], [-.017, .060, -.20], [-.017, .044, -.262]], .0042)
      .tube(m.steel, [[.017, .050, -.262], [.017, -.02, -.272], [0, -.05, -.276], [-.017, -.02, -.272], [-.017, .050, -.262]], .0048).b(m.rub, .044, .020, .012, 0, .046, -.268, { bevel: .004 })
      .mark('蚊子 WZ-9', .05, .011, .0224, .050, .050, 1, '#8f8c82').mark('保 · 单 · 连', .03, .0066, .0224, .034, .100, 1, '#b0553f').mark('口径 9毫米', .04, .007, -.0224, .036, .020, -1, '#77756c');
    loop(11, i => H.b(m.gap, .0245, .0042, .0052, 0, .0838, -.02 + i * .022));                                                                 // rail slots
    loop(4, i => loop(3, j => H.cx(m.gap, .0038, .0345, 0, .040 + j * .0105, .250 + i * .017, { seg: 6 })));                                    // shroud vents
    out.body = H.end('body');
    H.b(m.steel, .027, .190, .034, 0, -.020, 0, { bevel: .004 }).b(m.steelW, .029, .010, .037, 0, -.116, 0, { bevel: .003 }); loop(5, i => H.b(m.gap, .0275, .002, .020, 0, -.09 + i * .03, 0, { bevel: 0 }));
    out.mag = H.end('mag'); out.mag.position.set(0, -.092, .125); out.mag.rotation.x = .05;
    H.cx(m.steel, .0052, .022, 0, 0, 0).b(m.steel, .008, .012, .012, .012, 0, 0, { bevel: .003 }); out.bolt = H.end('bolt'); out.bolt.position.set(.03, .062, .16);
    return { parts: out, muzzle: [0, .050, .352], ejector: [-.026, .058, .115], support: [.006, -.004, .215], slideTravel: .05, magDrop: [0, -.26, 0], len: [-.28, .352] };
  };

  /* ---- HERON 5.56: carbine with a tube red-dot. Bore axis y = .056 */
  BUILD.rifle = (H, m, lod) => {
    const out = {};
    H.b(m.park, .040, .050, .210, 0, .058, .085, { bevel: .006 }).b(m.park, .038, .036, .190, 0, .018, .060, { bevel: .006 })                 // upper + lower receiver
      .b(m.park, .036, .060, .060, 0, -.018, .118, { bevel: .004 })                                                                           // mag well
      .b(m.polyG, .030, .118, .046, 0, -.032, -.016, { rx: -.3, bevel: .008 }).b(m.rub, .0315, .065, .030, 0, -.042, -.022, { rx: -.3, bevel: .003 })
      .tube(m.park, [[0, .0, .082], [0, -.022, .078], [0, -.026, .04], [0, -.02, .008]], .004).b(m.steel, .006, .022, .007, 0, -.006, .050, { rx: .4 })
      // handguard (slotted), barrel, gas block, flash hider
      .b(m.poly, .044, .048, .270, 0, .056, .325, { bevel: .012 }).b(m.park, .022, .008, .270, 0, .0838, .325, { bevel: .002 })
      .cz(m.park, .0092, .21, 0, .056, .545, { seg: 12 }).b(m.steel, .022, .030, .026, 0, .062, .50, { bevel: .004 }).cz(m.steel, .0118, .052, 0, .056, .664, { seg: 12 }).cz(m.gap, .0045, .0525, 0, .056, .6645)
      // receiver furniture
      .b(m.gap, .003, .018, .058, -.0195, .060, .100).b(m.chrome, .003, .013, .034, -.019, .060, .092, { bevel: .001 }).b(m.park, .004, .020, .060, -.0215, .046, .100, { rx: 0, bevel: .001 })   // port + open dust cover
      .b(m.park, .024, .008, .205, 0, .0868, .085, { bevel: .002 })                                                                           // top rail
      .b(m.steel, .034, .010, .022, 0, .074, -.022, { bevel: .003 }).b(m.steel, .008, .008, .012, .018, .074, -.03)                            // charging handle
      .cx(m.steelW, .0028, .0405, 0, .034, .010).cx(m.steelW, .0028, .0405, 0, .034, .150).cx(m.steelW, .0042, .042, 0, .030, .040)
      .b(m.steel, .004, .006, .020, .021, .030, .044, { rx: .6 }).b(m.steel, .004, .016, .010, .021, .034, .110).cz(m.steel, .006, .014, -.022, .054, .024)   // selector, bolt catch, forward assist
      // buffer tube + stock
      .cz(m.park, .0135, .19, 0, .056, -.115, { seg: 12 }).prof(m.poly, [[-.09, .078], [-.255, .078], [-.255, -.040], [-.225, -.040], [-.17, .010], [-.10, .026]], .038, .009).b(m.gap, .0385, .016, .05, 0, .030, -.185, { rx: -.5, bevel: .004 })
      .b(m.rub, .040, .122, .016, 0, .019, -.262, { bevel: .005 }).b(m.steel, .010, .010, .034, 0, .014, -.150, { bevel: .003 }).cx(m.steel, .004, .044, 0, .028, -.20)
      // red-dot: riser, tube, turrets, lens
      .b(m.steel, .026, .020, .050, 0, .100, .090, { bevel: .004 }).cx(m.steelW, .006, .034, 0, .098, .075).cx(m.steelW, .006, .034, 0, .098, .105)
      .cz(m.polyD, .0185, .078, 0, .130, .090, { seg: 20, open: true }).cz(m.polyD, .021, .012, 0, .130, .124, { seg: 20, open: true }).cz(m.polyD, .021, .012, 0, .130, .056, { seg: 20, open: true })
      .geo(m.polyD, new T.RingGeometry(.0172, .021, 20), { x: 0, y: .130, z: .130 }).geo(m.polyD, new T.RingGeometry(.0172, .021, 20), { x: 0, y: .130, z: .050 })   /* QA: an open tube you can look through (it was a solid black cylinder with a black rear cap over the eye) */
      .cz(m.clear, .0175, .002, 0, .130, .1285, { seg: 20 }).sph(m.dot, .0014, 0, .130, .1265)
      .cy(m.steel, .008, .012, 0, .152, .090).cx(m.steel, .008, .012, -.022, .130, .090).cy(m.steelW, .0085, .003, 0, .159, .090)
      // folded front sight + sling loop
      .b(m.steel, .016, .008, .034, 0, .094, .430, { bevel: .003 }).tube(m.steel, [[.022, .050, -.10], [.034, .040, -.10], [.022, .030, -.10]], .0024)
      .mark('HERON 5.56', .07, .0115, .0204, .020, .050, 1, '#8f8c82').mark('SAFE  SEMI  AUTO', .034, .005, .0204, .040, .044, 1, '#b0553f').mark('CAC-0417', .034, .006, -.0194, .016, .050, -1, '#77756c');
    loop(9, i => H.b(m.gap, .0245, .0042, .0052, 0, .0895, .002 + i * .0205));
    loop(12, i => H.b(m.gap, .0225, .0042, .0052, 0, .0865, .202 + i * .0205));
    loop(5, i => { H.b(m.gap, .0455, .009, .030, 0, .056, .225 + i * .05, { bevel: .003 }); H.b(m.gap, .012, .0495, .030, 0, .056, .225 + i * .05, { bevel: .003 }); });   // handguard slots (sides, top/bottom)
    loop(3, i => H.b(m.gap, .0245, .003, .006, 0, .056, .648 + i * .012, { bevel: 0 }));                                                       // flash hider slits
    out.body = H.end('body');
    loop(12, i => { const R = .34, a = (i * .0155) / R; H.b(m.park, .024, .0215, .056, 0, -R * Math.sin(a), R * (1 - Math.cos(a)), { rx: -a, bevel: .0016 }); });
    loop(3, i => { const R = .34, a = (.03 + i * .055) / R; H.b(m.steelW, .0246, .0022, .050, 0, -R * Math.sin(a), R * (1 - Math.cos(a)), { rx: -a, bevel: 0 }); });
    { const R = .34, a = .182 / R; H.b(m.poly, .026, .009, .060, 0, -R * Math.sin(a), R * (1 - Math.cos(a)), { rx: -a, bevel: .002 }); }
    out.mag = H.end('mag'); out.mag.position.set(0, -.045, .110);
    return { parts: out, muzzle: [0, .056, .695], ejector: [-.024, .062, .10], support: [.006, .022, .33], magDrop: [0, -.24, 0], len: [-.27, .69] };
  };

  /* ---- aluminium bat: lathe, dents, cloth grip tape. Held near the knob; the barrel runs along +Z */
  BUILD.bat = (H, m, lod) => {
    const prof = [[0, -.105], [.022, -.103], [.0245, -.094], [.021, -.086], [.0125, -.08], [.012, .10], [.0135, .22], [.019, .34], [.028, .45], [.0325, .53], [.033, .66], [.031, .695], [.022, .71], [0, .713]];
    const g = new T.LatheGeometry(prof.map(p => new T.Vector2(p[0], p[1])), lod ? 8 : 20), p = g.attributes.position, r = GT.rng('bat');
    const dents = [[.03, .5, .01, .06], [-.025, .6, .02, .05], [.01, .64, -.03, .045], [-.02, .42, -.02, .04], [.0, .56, .033, .035]];
    for (let i = 0; i < p.count; i++) { let x = p.getX(i), y = p.getY(i), z = p.getZ(i); for (const d of dents) { const dd = Math.hypot(x - d[0], y - d[1], z - d[2]); if (dd < d[3]) { const k = 1 - .16 * Math.pow(1 - dd / d[3], 2); x *= k; z *= k; } } p.setXYZ(i, x, y, z); }
    g.computeVertexNormals(); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * .2, uv.getY(i) * .8);
    H.geo(m.alu, g, { rx: HP });
    loop(lod ? 6 : 17, i => H.cz(i % 5 === 4 ? m.tapeW : m.tape, .0138 + (i % 2) * .0006, .0125, 0, 0, -.07 + i * (lod ? .033 : .0118), { seg: 10 }));              // wrapped tape turns
    H.cz(m.tape, .0142, .006, 0, 0, .134).cz(m.steelW, .0335, .004, 0, 0, .700, { seg: 16 }).cz(m.poly, .028, .003, 0, 0, .7135, { seg: 14 }).cz(m.red, .0195, .003, 0, 0, -.1055, { seg: 12 })
      .mark('江城少棒 32', .13, .022, .0336, 0, .59, 1, '#22303f').mark('铝合金 · 四方街体育用品', .1, .01, -.0325, 0, .57, -1, '#30343a');
    return { parts: { body: H.end('body') }, muzzle: [0, 0, .6], ejector: [0, 0, 0], support: [0, 0, .09], len: [-.1, .71] };
  };

  /* ---- crowbar: 75 cm of hex bar in blue-black paint, a full gooseneck with a nail slot at one end, a flattened chisel bent off-line at the other; both working ends are bright steel, two turns of tape where the hand goes */
  BUILD.crowbar = (H, m, lod) => {
    H.tube(m.paintK, [[0, 0, -.15], [0, 0, .10], [0, 0, .40]], .0098, { seg: 6, steps: 6 })
      .tube(m.paintK, [[0, 0, .40], [0, 0, .455], [0, .010, .505], [0, .040, .538], [0, .078, .536], [0, .103, .508], [0, .108, .470]], .0097, { seg: 6, steps: 18 })      /* gooseneck: a full turn back */
      .tube(m.steelW, [[0, .108, .470], [0, .107, .452], [0, .104, .436]], .0094, { seg: 6, steps: 4 })
      .b(m.steelW, .0105, .0058, .046, .0078, .101, .416, { rx: -.14, bevel: .0018 }).b(m.steelW, .0105, .0058, .046, -.0078, .101, .416, { rx: -.14, bevel: .0018 })   /* claw: two prongs, the nail slot between them */
      .b(m.chrome, .0107, .0026, .012, .0078, .0975, .397, { rx: -.14, bevel: .0008 }).b(m.chrome, .0107, .0026, .012, -.0078, .0975, .397, { rx: -.14, bevel: .0008 })
      .tube(m.paintK, [[0, 0, -.15], [0, 0, -.185], [0, -.007, -.215]], .0096, { seg: 6, steps: 5 })
      .b(m.steelW, .027, .0062, .066, 0, -.0125, -.243, { rx: -.3, bevel: .002 }).b(m.chrome, .0272, .0024, .014, 0, -.0235, -.2715, { rx: -.3, bevel: .0008 });        /* chisel end, bent 17 degrees */
    loop(lod ? 2 : 5, i => H.cz(m.steelW, .0101, .005 + (i % 2) * .006, 0, 0, .13 + i * .062, { seg: 6 }));                                                      /* paint knocked through on the corners */
    H.cz(m.rust, .0101, .03, 0, 0, .385, { seg: 6 }).cz(m.rust, .0101, .016, 0, 0, -.165, { seg: 6 });
    loop(lod ? 2 : 4, i => H.cz(m.tape, .0109 + (i % 2) * .0005, .0125, 0, 0, -.022 + i * .0118, { seg: 8 }));
    H.mark('四方街五金 750', .1, .009, .0086, 0, .24, 1, '#8b8f96');
    return { parts: { body: H.end('body') }, muzzle: [0, 0, .5], ejector: [0, 0, 0], support: [0, 0, .14], len: [-.275, .545] };
  };

  /* ---- 18-inch pipe wrench: forged I-section handle in red paint with a hang hole, an open housing with the knurled nut in it, the black hook jaw on its threaded shank, saw teeth on both jaws. Jaws open along the handle */
  BUILD.wrench = (H, m, lod) => {
    H.b(m.paintR, .0065, .026, .30, 0, 0, .065, { bevel: .002 }).b(m.paintR, .0145, .0062, .30, 0, .0135, .065, { bevel: .002 }).b(m.paintR, .0145, .0062, .30, 0, -.0135, .065, { bevel: .002 })   /* web + two flanges */
      .cx(m.paintR, .0168, .0145, 0, 0, -.094, { seg: 14 }).cx(m.gap, .0058, .0150, 0, 0, -.096, { seg: 8 }).cx(m.gap, .0058, .0150, 0, 0, -.086, { seg: 8 })                                   /* rounded tail + oblong hang hole */
      .b(m.rust, .0067, .0196, .05, 0, 0, .165, { bevel: 0 }).b(m.gap, .0067, .0196, .03, 0, 0, -.045, { bevel: 0 })                                                                           /* rust and old grease in the channel */
      .b(m.paintR, .021, .040, .085, 0, .002, .252, { bevel: .006 }).b(m.steelW, .019, .034, .016, 0, .000, .300, { bevel: .003 })                                                             /* head of the handle + heel jaw */
      .b(m.paintR, .029, .046, .011, 0, .040, .219, { bevel: .003 }).b(m.paintR, .029, .046, .011, 0, .040, .283, { bevel: .003 }).b(m.paintR, .029, .008, .075, 0, .0655, .251, { bevel: .003 })   /* housing: two walls and a bridge, open at the sides */
      .cz(m.steelW, .0172, .040, 0, .039, .251, { seg: 18 })                                                                                                                                   /* adjusting nut */
      .b(m.steel, .0135, .017, .190, 0, .039, .270, { bevel: .003 })                                                                                                                           /* hook jaw shank */
      .b(m.steel, .0185, .074, .022, 0, .014, .364, { bevel: .005 }).cx(m.steel, .0135, .0185, 0, .041, .359, { seg: 12 })                                                                     /* hook jaw: down across the mouth */
      .cx(m.steelW, .0034, .031, 0, .058, .219).cx(m.steelW, .0034, .031, 0, .058, .283);                                                                                                      /* housing rivets */
    loop(lod ? 3 : 7, i => H.b(m.chrome, .0192, .0028, .0038, 0, -.013 + i * .0048, .3088, { rx: .5, bevel: 0 }).b(m.chrome, .0187, .0028, .0038, 0, -.016 + i * .0048, .3522, { rx: -.5, bevel: 0 }));   /* teeth, both jaws */
    loop(lod ? 4 : 12, i => H.cz(m.steel, .0178, .0012, 0, .039, .2335 + i * .0032, { seg: 18 }));                                                                                             /* knurling */
    loop(lod ? 3 : 9, i => H.b(m.steelW, .0139, .0174, .0011, 0, .039, .180 + i * .0036, { bevel: 0 }));                                                                                       /* thread on the tail of the shank */
    loop(lod ? 2 : 6, i => H.b(m.steelW, .0149, .0018, .018 + (i % 3) * .011, 0, (i % 2 ? .0168 : -.0168), -.06 + i * .052, { bevel: 0 }));                                                    /* paint gone from the flange edges */
    H.b(m.steelW, .0172, .012, .0015, 0, 0, -.1105, { bevel: 0 }).b(m.rust, .0190, .030, .0012, 0, .014, .3757, { bevel: 0 });
    H.mark('江城五金 450', .12, .012, .0034, 0, .07, 1, '#d8cfb4').mark('铬钒钢 · 夹持 60', .09, .009, -.0034, 0, .09, -1, '#c9c2ae');
    return { parts: { body: H.end('body') }, muzzle: [0, .01, .34], ejector: [0, 0, 0], support: [0, 0, .12], len: [-.112, .376] };
  };

  /* ---- long-handled wok ladle: a shallow 12 cm bowl hung off a steel rod at the cook's angle, an oil-dark wooden grip. Burnt black outside, scoured bright inside */
  BUILD.ladle = (H, m, lod) => {
    const V = (r, y) => new T.Vector2(r, y), seg = lod ? 10 : 22;
    H.cz(m.wood, .0122, .112, 0, 0, -.012, { seg: 12 }).cz(m.woodD, .0126, .026, 0, 0, .050, { seg: 12 }).sph(m.wood, .0122, 0, 0, -.068, [1, 1, .7])                 /* wooden grip, darker at the steel end */
      .cz(m.steelW, .0098, .020, 0, 0, .072, { seg: 10 }).cx(m.steel, .0022, .026, 0, 0, -.06)                                                                 /* ferrule + the pin through the grip */
      .tube(m.steel, [[0, .012, -.074], [0, .024, -.082], [0, .012, -.092], [0, .004, -.080]], .0019, { seg: 5 })                                              /* hanging loop */
      .tube(m.steelW, [[0, 0, .08], [0, 0, .15], [0, 0, .205], [0, -.012, .248], [0, -.033, .277]], .0058, { seg: 8, steps: 14 });                            /* the rod, cranked down to the rim */
    H.push(0, -.012, .330, { rx: -.43 });
    H.geo(m.soot, new T.LatheGeometry([V(0, -.041), V(.016, -.0405), V(.035, -.036), V(.050, -.026), V(.0585, -.012), V(.0605, 0)], seg))
      .geo(m.alu, new T.LatheGeometry([V(.0595, 0), V(.0572, -.012), V(.0488, -.0252), V(.034, -.0348), V(.0155, -.0392), V(0, -.0397)], seg))
      .geo(m.steelW, new T.TorusGeometry(.0600, .0016, lod ? 4 : 6, seg), { rx: HP })
      .b(m.steelW, .016, .003, .022, 0, -.004, -.064, { rx: .5, bevel: .001 }).cx(m.steel, .0028, .003, .004, -.002, -.060, { seg: 6 }).cx(m.steel, .0028, .003, -.004, -.002, -.060, { seg: 6 });   /* riveted tang */
    H.pop();
    return { parts: { body: H.end('body') }, muzzle: [0, -.02, .36], ejector: [0, 0, 0], support: [0, 0, .12], len: [-.094, .395] };
  };

  /* ---- pneumatic framing nailer: an aluminium cylinder head with a vented black cap, a rubber handle straight down from it, the long nail magazine raked from the nose back past the heel of the handle (the triangle),
     a sprung contact tip in front of the nose, a brass quick coupler and a stub of blue air hose */
  BUILD.nailgun = (H, m, lod) => {
    const MA = -.842, mag = (mat, w, h, d, off, t, o) => H.b(mat, w, h, d, 0, -.075 + off * .666 - t * .747, .0325 - off * .747 - t * .666, Object.assign({ rx: MA }, o));   /* off = across the magazine (+ towards the front), t = along it (+ down and back) */
    H.cz(m.alu, .046, .118, 0, .076, .020, { seg: 20 }).cz(m.aluD, .0475, .012, 0, .076, .066, { seg: 20 }).cz(m.aluD, .0475, .010, 0, .076, -.026, { seg: 20 })      /* head + two cast bands */
      .cz(m.poly, .0468, .024, 0, .076, -.050, { seg: 20 }).cz(m.poly, .030, .010, 0, .076, -.066, { seg: 14 })                                               /* exhaust cap */
      .cz(m.aluD, .044, .028, 0, .076, .092, { r2: .034, seg: 18 })                                                                                           /* shoulder down to the nose */
      .b(m.steel, .030, .060, .050, 0, .060, .128, { bevel: .005 }).b(m.steelW, .012, .016, .062, 0, .056, .178, { bevel: .003 })                             /* nose casting + driver guide */
      .b(m.steelW, .018, .024, .004, 0, .056, .205, { bevel: .001 }).b(m.steelW, .003, .008, .070, .0105, .040, .176).b(m.steelW, .003, .008, .070, -.0105, .040, .176)   /* contact tip yoke */
      .b(m.red, .020, .016, .010, 0, .056, .2125, { bevel: .003 })                                                                                           /* red no-mar tip */
      .b(m.poly, .036, .020, .060, 0, .024, .008, { bevel: .006 })                                                                                           /* neck under the head */
      .b(m.rub, .034, .112, .041, 0, -.042, -.002, { bevel: .012 }).b(m.poly, .036, .012, .046, 0, -.102, -.002, { bevel: .004 })                             /* handle + heel */
      .b(m.steel, .0075, .028, .011, 0, .006, .030, { rx: -.3, bevel: .003 }).b(m.poly, .010, .005, .034, 0, -.012, .040, { rx: -.5, bevel: .002 })          /* trigger + guard bar */
      .cy(m.brass, .0072, .026, 0, -.121, -.006, { seg: 8 }).cy(m.brass, .0098, .010, 0, -.134, -.006, { seg: 6 }).cy(m.steelW, .0082, .012, 0, -.145, -.006, { seg: 8 })   /* quick coupler */
      .tube(m.hose, [[0, -.150, -.006], [0, -.185, -.012], [.012, -.225, -.040], [.034, -.250, -.090], [.050, -.262, -.150]], .0066, { seg: 7, steps: 16 })   /* air hose */
      .b(m.steel, .004, .034, .012, .019, .030, -.020, { bevel: .001 }).tube(m.steel, [[.021, .040, -.020], [.034, .020, -.020], [.034, -.030, -.020], [.028, -.040, -.020]], .002, { seg: 5 });   /* belt hook */
    mag(m.park, .020, .040, .310, 0, 0, { bevel: .003 }); mag(m.aluD, .0225, .008, .300, .022, 0, { bevel: .002 }); mag(m.aluD, .0225, .006, .300, -.021, 0, { bevel: .002 });   /* magazine channel + rails */
    mag(m.nail, .0205, .020, .150, .004, -.060, { bevel: 0 }); mag(m.steel, .026, .020, .030, .0, .150, { bevel: .004 }); mag(m.steel, .030, .010, .014, -.010, .112, { bevel: .003 });   /* a strip of nails showing in the window, end cap, pusher latch */
    H.b(m.steel, .024, .020, .050, 0, -.112, .010, { bevel: .003 });                                                                                         /* bracket: heel of the handle to the magazine */
    loop(lod ? 0 : 6, i => { const a = i / 6 * PI * 2; H.b(m.gap, .006, .018, .0255, Math.sin(a) * .036, .076 + Math.cos(a) * .036, -.0505, { rz: -a, bevel: 0 }); });   /* exhaust slots */
    loop(lod ? 0 : 4, i => H.cz(m.steelW, .0035, .004, Math.sin(i * HP + .78) * .039, .076 + Math.cos(i * HP + .78) * .039, -.0625, { seg: 6 }));              /* cap bolts */
    loop(lod ? 0 : 5, i => H.b(m.gap, .0345, .0028, .042, 0, -.012 - i * .016, -.002, { bevel: 0 }));                                                          /* grip grooves */
    H.b(m.steelW, .0005, .010, .040, .0462, .078, .020, { bevel: 0 }).b(m.steelW, .0005, .006, .020, -.0462, .090, .040, { bevel: 0 })                          /* scratches through the anodising */
      .mark('江城气动 F30', .085, .013, .0468, .074, .020, 1, '#1d1a12').mark('警告 · 请戴护目镜', .07, .009, -.0468, .074, .020, -1, '#1d1a12');
    return { parts: { body: H.end('body') }, muzzle: [0, .056, .220], ejector: [-.02, .05, .12], support: [0, .03, -.05], sightY: .126, len: [-.16, .22] };
  };

  /* ---- 4 kg dry powder extinguisher, carried by the handle: red cylinder with a domed shoulder and a black foot ring, brass valve with two black levers, a small gauge, the pin on its ring with a seal,
     the hose clipped to the body, a white picture label and the yellow inspection card */
  BUILD.extinguisher = (H, m, lod) => {
    const ZB = .046, R = .068;
    H.cy(m.paintR, R, .285, 0, -.262, ZB, { seg: 22 }).sph(m.paintR, R, 0, -.120, ZB, [1, .5, 1]).cy(m.paintR, .026, .022, 0, -.082, ZB, { seg: 12 })                     /* body, shoulder, neck ring */
      .cy(m.poly, R + .0015, .024, 0, -.412, ZB, { seg: 22 }).cy(m.steelW, R + .0008, .004, 0, -.398, ZB, { seg: 22 })                                         /* foot ring, the paint scuffed above it */
      .cy(m.brass, .019, .052, 0, -.048, ZB, { seg: 10 }).b(m.brass, .030, .024, .030, 0, -.040, ZB, { bevel: .004 })                                           /* valve */
      .b(m.paintK, .025, .0048, .120, 0, .013, -.006, { rx: -.1, bevel: .002 }).b(m.paintK, .025, .012, .016, 0, .0075, -.067, { rx: -.5, bevel: .004 })        /* squeeze lever, rolled tip */
      .b(m.paintK, .024, .0048, .100, 0, -.013, .003, { rx: .05, bevel: .002 }).b(m.paintK, .020, .026, .0048, 0, -.027, .034, { bevel: .002 })               /* carrying handle + its strut */
      .cx(m.steelW, .0034, .034, 0, -.004, ZB + .004, { seg: 8 })                                                                                              /* hinge pin */
      .cx(m.steelW, .0192, .012, .028, -.046, ZB, { seg: 16 }).cx(m.white, .0165, .0125, .0285, -.046, ZB, { seg: 16 }).b(m.green, .0008, .006, .016, .0350, -.037, ZB, { bevel: 0 }).b(m.red, .0008, .004, .007, .0350, -.052, ZB - .008, { bevel: 0 }).b(m.gap, .0009, .012, .0012, .0352, -.044, ZB + .002, { rx: .5, bevel: 0 })   /* gauge: green band, needle */
      .cx(m.steelW, .0016, .050, .004, -.002, ZB - .012, { seg: 5 }).geo(m.steelW, new T.TorusGeometry(.013, .0015, 5, lod ? 8 : 14), { x: -.036, y: -.004, z: ZB - .012, ry: 0 }).b(m.shell, .001, .016, .010, -.022, -.016, ZB - .012, { rz: .3, bevel: 0 })   /* safety pin, ring, seal */
      .tube(m.rub, [[0, -.046, ZB + .020], [0, -.050, ZB + .062], [0, -.092, ZB + .100], [0, -.140, ZB + .128], [0, -.158, ZB + .170], [0, -.160, ZB + .215]], .0092, { seg: 8, steps: 20 })   /* hose: out of the valve, down in a loop, the horn held level in front of the body */
      .cz(m.steelW, .0105, .016, 0, -.047, ZB + .026, { seg: 8 }).cz(m.poly, .013, .085, 0, -.160, ZB + .262, { r2: .024, seg: 14 }).cz(m.gap, .020, .002, 0, -.160, ZB + .3045, { seg: 12 })   /* ferrule, horn, mouth */
      .cy(m.rub, R + .0018, .013, 0, -.300, ZB, { seg: 22 }).b(m.rub, .020, .018, .022, 0, -.300, ZB + R + .008, { bevel: .004 })                                /* hose band + clip */
      .b(m.shell, .001, .060, .040, .060, -.120, ZB + .046, { rz: .12, ry: .5, bevel: 0 }).tube(m.steelW, [[.022, -.060, ZB + .016], [.044, -.074, ZB + .034], [.058, -.090, ZB + .044]], .0008, { seg: 4 });   /* inspection card on a wire */
    H.geo(m.white, new T.CylinderGeometry(R + .0006, R + .0006, .150, lod ? 6 : 12, 1, true, .55, 2.05), { y: -.245, z: ZB });                                 /* label: a third of the way round, on the left */
    loop(lod ? 0 : 3, i => { const a = .55 + .42 + i * .58; H.b(m.gap, .0012, .030, .028, Math.sin(a) * (R + .0008), -.262, ZB + Math.cos(a) * (R + .0008), { ry: a - HP, bevel: 0 }); });   /* three picture panels */
    H.mark('干粉灭火器 · 四公斤', .060, .011, R + .0014, -.192, ZB, 1, '#a3201a').mark('拔销 · 握管 · 压把', .056, .009, R + .0014, -.298, ZB, 1, '#2a2a2a');
    H.mark('江城消防器材', .05, .008, -(R + .0006), -.20, ZB, -1, '#f2e6d8');
    return { parts: { body: H.end('body') }, muzzle: [0, -.160, ZB + .31], ejector: [0, 0, 0], support: [0, -.158, ZB + .2], len: [-.1, .37] };
  };

  /* ---- rider helmet (阿凯's own, delivery yellow, two silly ears): swung by the bunched chin straps. The crown leads along +Z, the peak points up (+Y) */
  BUILD.helmet = (H, m, lod) => {
    const seg = lod ? 10 : 28, V = (r, y) => new T.Vector2(r, y), sc = [.93, 1, 1.12];
    const outer = [V(.1285, 0), V(.1335, .004), V(.1345, .016), V(.133, .05), V(.127, .09), V(.113, .13), V(.09, .162), V(.058, .184), V(.024, .195), V(0, .197)];
    const inner = [V(0, .176), V(.03, .172), V(.062, .16), V(.09, .138), V(.108, .104), V(.117, .06), V(.12, .012), V(.1285, 0)];          // crown -> rim: winding flipped, faces the cavity
    const fixUV = g => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * .16, uv.getY(i) * .06); return g; };
    H.push(0, .012, .132).geo(m.shell, fixUV(new T.LatheGeometry(outer, seg)), { rx: HP, s: sc }).geo(m.eps, fixUV(new T.LatheGeometry(inner, seg)), { rx: HP, s: sc });
    H.geo(m.rub, new T.TorusGeometry(.1305, .0052, lod ? 4 : 8, seg), { s: [.93, 1.12, 1] });                                               // rolled rubber rim trim
    if (!lod) { loop(6, i => { const a = (i + .5) / 6 * PI * 2; H.b(m.pad, .05, .034, .016, Math.sin(a) * .104 * .93, Math.cos(a) * .104 * 1.12, .03, { rz: -a, bevel: .007 }); });   // comfort pads round the liner
      H.b(m.pad, .07, .07, .012, 0, 0, .165, { bevel: .006 }); }
    // peak, vents, centre stripe, rear reflector, ears
    H.geo(m.poly, fixUV(new T.LatheGeometry([V(.1352, .003), V(.1368, .012), V(.1362, .03), V(.1338, .036)], seg)), { rx: HP, s: sc });                                   // two-tone: black band round the rim
    H.geo(m.poly, new T.SphereGeometry(.1, lod ? 8 : 18, lod ? 5 : 10), { x: 0, y: .158, z: .04, rx: -.42, s: [.86, .085, .5] }).geo(m.rub, new T.TorusGeometry(.084, .004, lod ? 4 : 6, lod ? 8 : 20, PI), { x: 0, y: .163, z: .034, rx: HP - .42, s: [1, .56, 1] });   // short moulded peak with a rubber edge
    { const rib = []; for (let i = 1; i < outer.length; i++) rib.push([0, outer[i].x * 1.12 - .0095, outer[i].y - .0095 * (i / outer.length)]); for (let i = outer.length - 2; i >= 1; i--) rib.push([0, -outer[i].x * 1.12 + .0095, outer[i].y - .0095 * (i / outer.length)]); H.tube(m.poly, rib, .0145, { seg: lod ? 4 : 6, steps: lod ? 14 : 44 }); }   // black centre stripe moulded proud of the shell, front to back
    loop(3, i => H.b(m.gap, .009, .0035, .03, (i - 1) * .034, .0935 - Math.abs(i - 1) * .0065, .1545, { rx: -.95, bevel: .0015 }));
    H.b(m.refl, .04, .005, .017, 0, -.1505, .052, { rx: -.08, bevel: .0015 }).b(m.refl, .012, .004, .012, .05, -.1385, .052, { rx: -.08, rz: .36, bevel: .0015 }).b(m.refl, .012, .004, .012, -.05, -.1385, .052, { rx: -.08, rz: -.36, bevel: .0015 });   // rear reflectors, flush
    for (const sx of [-1, 1]) { H.push(sx * .058, .06, .176, { rx: -.62, rz: -sx * .34 }); H.cy(m.shell, .019, .052, 0, .026, 0, { r2: .0045, seg: 12 }).cy(m.refl, .0105, .034, 0, .023, .0085, { r2: .003, seg: 8 }).cy(m.shellD, .0215, .006, 0, .002, 0, { seg: 12 }); H.pop();
      H.cx(m.steelW, .0052, .006, sx * .1215, .03, .028, { seg: 8 }).cx(m.steelW, .0052, .006, sx * .119, -.062, .028, { seg: 8 }); }                 // strap rivets
    H.mark('跑得快', .088, .032, .1266, -.006, .075, 1, '#17140e').mark('跑得快', .088, .032, -.1266, -.006, .075, -1, '#17140e').mark('骑手 0728', .05, .013, .1262, -.052, .05, 1, '#2a2418').mark('再晚也送到', .06, .012, -.1262, -.052, .05, -1, '#2a2418');
    H.pop();
    // chin straps gathered into the fist at the origin + buckle + loose tail
    for (const sx of [-1, 1]) { H.tube(m.strap, [[sx * .113, .044, .156], [sx * .085, .03, .09], [sx * .03, .008, .03], [0, 0, -.004]], .0052, { seg: 5 }).tube(m.strap, [[sx * .11, -.05, .156], [sx * .08, -.03, .09], [sx * .028, -.008, .03], [0, 0, -.004]], .0052, { seg: 5 }); }
    H.b(m.poly, .026, .014, .034, 0, 0, .05, { bevel: .004 }).b(m.red, .012, .0155, .012, 0, 0, .05, { bevel: .003 }).tube(m.strap, [[0, 0, -.004], [0, -.012, -.05], [.012, -.045, -.07], [.006, -.085, -.064]], .005, { seg: 5 }).b(m.poly, .016, .02, .006, .006, -.092, -.063, { bevel: .002 });
    return { parts: { body: H.end('body') }, muzzle: [0, 0, .3], ejector: [0, 0, 0], support: [0, 0, .1], len: [-.08, .34] };
  };

  /* ---- DN20 galvanised water pipe torn off a wall: threaded end, a coupling, an elbow with a stub and a broken wall clip; rag tape for a grip */
  BUILD.pipe = (H, m, lod) => {
    H.cz(m.galv, .0135, .60, 0, 0, .19, { seg: 12 }).cz(m.gap, .0105, .003, 0, 0, -.1105, { seg: 10 });
    loop(lod ? 3 : 9, i => H.cz(m.galvD, .0143, .0016, 0, 0, -.106 + i * (lod ? .012 : .0042), { seg: 10 }));                                 // cut thread at the grip end
    loop(lod ? 5 : 13, i => H.cz(i % 4 === 3 ? m.tapeW : m.tape, .0152 + (i % 2) * .0007, .0125, 0, 0, -.075 + i * (lod ? .03 : .0118), { seg: 10 }));   // rag / tape grip
    H.cz(m.galvD, .0198, .044, 0, 0, .245, { seg: 6 }).cz(m.galv, .0176, .05, 0, 0, .245, { seg: 12 }).cz(m.teflon, .0142, .008, 0, 0, .273, { seg: 10 }).cz(m.teflon, .0142, .006, 0, 0, .218, { seg: 10 });   // hex coupling + thread tape
    H.cz(m.rust, .0139, .05, 0, 0, .14, { seg: 12 }).cz(m.rust, .0139, .03, 0, 0, .40, { seg: 12 }).cz(m.rust, .0139, .012, 0, 0, .33, { seg: 12 });
    // elbow fitting + stub + bashed end
    H.cz(m.galvD, .0205, .03, 0, 0, .49, { seg: 12 }).sph(m.galvD, .021, 0, 0, .512).cy(m.galvD, .0205, .03, 0, .022, .512, { seg: 12 }).cy(m.galv, .0135, .07, 0, .07, .512, { seg: 12 }).cy(m.gap, .0105, .003, 0, .1055, .512, { seg: 10 });
    loop(lod ? 2 : 6, i => H.cy(m.galvD, .0143, .0016, 0, .084 + i * .0042, .512, { seg: 10 }));
    H.cz(m.galvD, .0218, .006, 0, 0, .476, { seg: 12 }).cy(m.galvD, .0218, .006, 0, .036, .512, { seg: 12 });
    // broken saddle clip still hanging on, with one screw
    H.b(m.steelW, .05, .003, .018, 0, -.0145, .355, { bevel: .001 }).b(m.steelW, .003, .026, .018, .0155, -.002, .355, { bevel: .001 }).b(m.steelW, .003, .026, .018, -.0155, -.002, .355, { bevel: .001 }).cy(m.steel, .003, .014, .022, -.02, .355, { seg: 6 });
    H.mark('江城水务 DN20', .11, .012, .0138, 0, .09, 1, '#2b3c52').mark('镀锌 · 1.6MPa', .07, .009, -.0138, 0, .42, -1, '#3a3f44');
    return { parts: { body: H.end('body') }, muzzle: [0, 0, .5], ejector: [0, 0, 0], support: [0, 0, .12], len: [-.115, .535] };
  };

  /* ---- SH: 鹗 .308 — a bolt-action precision rifle on a polymer chassis. Bore axis y = .052; a fixed 4x scope on rings (the shop's 'scope' upgrade adds a sunshade and more zoom) */
  BUILD.sniper = (H, m, lod) => {
    const out = {};
    H.b(m.park, .036, .046, .25, 0, .052, .07, { bevel: .006 }).b(m.park, .03, .012, .26, 0, .08, .07, { bevel: .002 })                        /* receiver + its rail */
      .cz(m.blued, .0112, .56, 0, .052, .48, { seg: 14, r2: .0092 }).cz(m.steel, .0158, .085, 0, .052, .80, { seg: 12 }).cz(m.gap, .0058, .086, 0, .052, .801, { seg: 10 })   /* tapered barrel + muzzle brake */
      .b(m.gap, .034, .008, .014, 0, .052, .78).b(m.gap, .034, .008, .014, 0, .052, .81)                                                      /* brake ports */
      .prof(m.polyG, [[.20, .036], [-.06, .036], [-.09, .018], [-.17, .03], [-.47, .045], [-.47, -.07], [-.43, -.07], [-.33, -.035], [-.15, -.03], [-.11, -.062], [-.085, -.115], [-.04, -.115], [-.03, -.06], [.03, -.03], [.20, -.012]], .044, .01)   /* chassis: fore-end, grip, thumbhole stock */
      .b(m.rub, .046, .13, .02, 0, -.012, -.478, { bevel: .006 }).b(m.poly, .03, .026, .11, 0, .062, -.34, { bevel: .006 })                      /* butt pad, cheek riser */
      .b(m.poly, .011, .05, .006, 0, -.012, .045, { rx: -.1, bevel: .002 }).b(m.poly, .011, .006, .07, 0, -.036, .012, { bevel: .002 }).b(m.steel, .006, .022, .007, 0, -.012, .018, { rx: .35 })   /* guard + trigger */
      .cz(m.blued, .0168, .30, 0, .125, .085, { seg: 16 }).cz(m.blued, .0175, .075, 0, .125, .265, { seg: 18, r2: .0255 }).cz(m.blued, .0205, .055, 0, .125, -.085, { seg: 16, r2: .0172 })   /* scope: tube, objective bell, eyepiece */
      .cz(m.glass, .0235, .003, 0, .125, .3035, { seg: 18 }).cz(m.glass, .0185, .003, 0, .125, -.113, { seg: 16 })
      .cy(m.blued, .011, .022, 0, .147, .085, { seg: 10 }).cx(m.blued, .011, .022, -.024, .125, .085, { seg: 10 })                            /* turrets */
      .b(m.park, .03, .036, .016, 0, .1, .02, { bevel: .003 }).b(m.park, .03, .036, .016, 0, .1, .15, { bevel: .003 })                          /* rings */
      .cz(m.steelW, .0045, .012, -.02, .066, -.03, { seg: 8 }).b(m.steel, .006, .006, .03, -.032, .06, -.03, { ry: -.6 }).sph(m.steel, .009, -.046, .06, -.044)   /* bolt handle */
      .tube(m.steel, [[.03, -.01, .3], [.034, -.04, .34], [.034, -.04, .52]], .004).tube(m.steel, [[-.03, -.01, .3], [-.034, -.04, .34], [-.034, -.04, .52]], .004)   /* folded bipod */
      .mark('鹗 OSPREY .308', .08, .012, .0185, .052, .09, 1, '#8f8c82').mark('PV-308-0091', .05, .007, -.0185, .05, .09, -1, '#77756c');
    loop(6, i => H.b(m.gap, .0215, .004, .006, 0, .086, -.03 + i * .04));
    out.body = H.end('body');
    H.b(m.poly, .026, .062, .066, 0, -.03, 0, { bevel: .004 }).b(m.steelW, .028, .008, .068, 0, -.064, 0, { bevel: .002 }); out.mag = H.end('mag'); out.mag.position.set(0, .0, .1);
    return { parts: out, muzzle: [0, .052, .845], ejector: [-.022, .06, .08], support: [.006, .01, .3], magDrop: [0, -.2, 0], len: [-.48, .845], sightY: .145 };
  };
  /* ---- SH: M-61 style fragmentation grenade: olive steel body (pressed segments), fuze head, spoon lever and pull ring. Held in the palm, top up */
  BUILD.grenade = (H, m, lod) => {
    const prof = [[0, -.042], [.018, -.04], [.029, -.03], [.033, -.012], [.033, .012], [.029, .03], [.02, .04], [.012, .046], [0, .047]];
    const g = new T.LatheGeometry(prof.map(p => new T.Vector2(p[0], p[1])), lod ? 8 : 22); if (!lod) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + .045 * Math.pow(Math.abs(Math.sin(a * 4)), 6) * (1 - Math.abs(y) / .047); p.setXYZ(i, x * k, y, z * k); } g.computeVertexNormals(); }
    H.geo(m.olive, g, { y: .01 }).cy(m.steel, .011, .022, 0, .065, 0, { seg: 12 }).cy(m.steelW, .0125, .006, 0, .056, 0, { seg: 12 })                               /* body, fuze, collar */
      .b(m.steelW, .012, .07, .006, .0175, .035, 0, { rz: -.15, bevel: .001 }).b(m.steelW, .012, .014, .006, .009, .074, 0, { rz: -1.1, bevel: .001 })               /* spoon */
      .geo(m.steel, new T.TorusGeometry(.011, .0016, lod ? 4 : 6, lod ? 8 : 16), { x: -.014, y: .074, z: 0, ry: HP }).cx(m.steel, .0015, .024, -.003, .07, 0);
    if (!lod) H.mark('M-61 · 破片', .03, .006, 0, .01, .034, 1, '#d8d2b0');
    return { parts: { body: H.end('body') }, muzzle: [0, .05, 0], ejector: [0, 0, 0], support: [0, 0, 0], len: [-.05, .06] };
  };
  /* ---- SH: molotov: a green glass bottle half full of fuel, a rag stuffed in the neck and knotted, held by the neck-end of the body */
  BUILD.molotov = (H, m, lod) => {
    const prof = [[0, -.11], [.032, -.11], [.036, -.104], [.036, .03], [.03, .055], [.014, .075], [.0125, .12], [.0145, .126], [.0145, .132], [.011, .134]];
    H.geo(m.bottle, new T.LatheGeometry(prof.map(p => new T.Vector2(p[0], p[1])), lod ? 8 : 20)).geo(m.fuel, new T.LatheGeometry([[0, -.104], [.031, -.104], [.031, -.02], [0, -.02]].map(p => new T.Vector2(p[0], p[1])), lod ? 8 : 16))
      .tube(m.rag, [[0, .12, 0], [.004, .15, .003], [.012, .175, -.006], [.02, .19, .004]], .0085, { seg: 6 }).tube(m.rag, [[0, .13, 0], [-.01, .158, .004], [-.022, .17, -.008]], .006, { seg: 6 })
      .cy(m.rag, .0158, .012, 0, .118, 0, { seg: 10 }).b(m.rag, .03, .006, .012, .02, .112, .012, { rz: .5 });
    if (!lod) H.mark('柴 油', .03, .016, 0, -.04, .0365, 1, '#f2e6c8');
    return { parts: { body: H.end('body') }, muzzle: [0, .19, 0], ejector: [0, 0, 0], support: [0, 0, 0], len: [-.11, .2] };
  };
  /* ---- SH: combat knife: ribbed polymer handle, steel guard, a dark-coated clip-point blade with a fuller */
  BUILD.knife = (H, m, lod) => {
    const sh = new T.Shape(); sh.moveTo(0, -.012); sh.lineTo(.13, -.012); sh.quadraticCurveTo(.168, -.006, .185, .012); sh.lineTo(.15, .006); sh.lineTo(.11, .016); sh.lineTo(0, .016); sh.closePath();
    const bg = new T.ExtrudeGeometry(sh, { depth: .0035, bevelEnabled: !lod, bevelThickness: .0012, bevelSize: .0012, bevelSegments: 1 }); bg.translate(0, 0, -.00175); bg.rotateY(-HP);
    H.geo(m.paintK, bg, { z: .02 }).b(m.steelW, .0012, .002, .1, .0026, .003, .085).b(m.steelW, .0012, .002, .1, -.0026, .003, .085)        /* blade + fuller edges */
      .b(m.steel, .02, .046, .008, 0, .002, .016, { bevel: .002 }).cz(m.polyG, .0135, .11, 0, .002, -.045, { seg: 10, r2: .012 }).cz(m.steel, .0125, .012, 0, .002, -.104, { seg: 10 });
    loop(lod ? 2 : 6, i => H.cz(m.poly, .0142, .006, 0, .002, -.088 + i * .017, { seg: 10 }));
    return { parts: { body: H.end('body') }, muzzle: [0, 0, .2], ejector: [0, 0, 0], support: [0, 0, .05], len: [-.11, .21] };
  };

  /* ================================================================== SH: attachments, finishes, the player's loadout
     ATT[id] = what that weapon takes; fit(inst, tp, att) builds them onto an instance (also the first-person one); TINTS recolour the polymer and the steel.
     kit[id] = { att: {sup, scope, ext, light, grip}, tint } is the player's own set (js/shops.js writes it, js/combat.js arms the player with it); effDef(id) = the def with what they change. */
  const ATT = { pistol: ['sup', 'light', 'ext'], smg: ['sup', 'scope', 'ext', 'light', 'grip'], rifle: ['sup', 'scope', 'ext', 'light', 'grip'], shotgun: ['sup', 'light', 'grip'], sniper: ['sup', 'scope', 'ext'], revolver: ['light'] };
  const ATTN = { sup: '消音器', scope: '瞄准镜', ext: '扩容弹匣', light: '战术手电', grip: '垂直握把' };
  const TINTS = [{ v: '', n: '原厂' }, { v: 'black', n: '午夜黑', poly: 0x111214, metal: 0x16171a }, { v: 'olive', n: '橄榄绿', poly: 0x3f4b2c, metal: 0x2c3328 }, { v: 'tan', n: '沙漠棕', poly: 0x8b7452, metal: 0x51463a },
    { v: 'gold', n: '镀金', poly: 0x2a2420, metal: 0xd6a93c, gm: .95 }, { v: 'plat', n: '铂金', poly: 0x2b2d31, metal: 0xd5dade, gm: 1 }, { v: 'pink', n: '樱花粉', poly: 0xd7789b, metal: 0x6e4250 }, { v: 'blue', n: '警用蓝', poly: 0x1f3b70, metal: 0x2b3446 }];
  const kit = {};
  const TM = {};
  function tintMat(base, t, role) { const k = t.v + role + base.uuid; if (TM[k]) return TM[k]; const c = base.clone(); c.onBeforeCompile = base.onBeforeCompile; c.customProgramCacheKey = base.customProgramCacheKey; c.name = base.name;
    if (role === 'poly') { c.color.copy(colL(t.poly)); } else { c.color.copy(colL(t.metal)); if (t.gm) { c.metalness = t.gm; c.roughness = .22; } } return TM[k] = c; }
  function retint(inst, tv) { const t = TINTS.find(q => q.v === tv); if (!t || !t.v) return; const m = mats(), role = new Map([[m.poly, 'poly'], [m.polyG, 'poly'], [m.paintK, 'poly'], [m.steel, 'metal'], [m.blued, 'metal'], [m.park, 'metal'], [m.aluD, 'metal'], [m.olive, 'poly']]);
    inst.group.traverse(o => { if (o.isMesh && role.has(o.material)) o.material = tintMat(o.material, t, role.get(o.material)); }); }
  const SUPR = { pistol: .0155, smg: .0195, rifle: .021, shotgun: .025, sniper: .022 }, SUPL = { pistol: .15, smg: .19, rifle: .2, shotgun: .21, sniper: .22 };
  function fit(inst, tp, att) { const id = inst.id, m = mats(), ok = ATT[id] || [], mz = tp.muzzle, k = tools(0), parts = {}; let beam = null;
    if (att.sup && ok.indexOf('sup') >= 0) { const r = SUPR[id] || .02, L = SUPL[id] || .18, z = mz[2] + L / 2 - .006; k.cz(m.poly, r, L, 0, mz[1], z, { seg: 18 }).cz(m.steel, r * 1.04, .012, 0, mz[1], mz[2] + L - .006, { seg: 18 }).cz(m.steel, r * 1.04, .01, 0, mz[1], mz[2] + .01, { seg: 18 }).cz(m.gap, r * .35, .004, 0, mz[1], mz[2] + L, { seg: 10 });
      loop(3, i => k.cz(m.park, r * 1.01, .004, 0, mz[1], mz[2] + L * (.3 + i * .2), { seg: 18 })); }
    if (att.scope && ok.indexOf('scope') >= 0) { if (id === 'sniper') { k.cz(m.blued, .0262, .07, 0, .125, .335, { seg: 18 }).cz(m.gap, .024, .003, 0, .125, .371, { seg: 18 }); }
      else { const y = id === 'rifle' ? .158 : .135, z0 = id === 'rifle' ? .3 : .09, ry = id === 'rifle' ? .087 : .085; k.cz(m.blued, .0135, .2, 0, y, z0, { seg: 16 }).cz(m.blued, .0138, .05, 0, y, z0 + .115, { seg: 16, r2: .02 }).cz(m.blued, .0165, .04, 0, y, z0 - .105, { seg: 16, r2: .0138 })
        .cz(m.glass, .018, .003, 0, y, z0 + .141, { seg: 16 }).cz(m.glass, .0145, .003, 0, y, z0 - .126, { seg: 16 }).cy(m.blued, .009, .018, 0, y + .019, z0, { seg: 10 }).cx(m.blued, .009, .018, -.018, y, z0, { seg: 10 });
        for (const dz of [-.05, .05]) k.b(m.park, .026, y - ry + .008, .013, 0, (y + ry) / 2, z0 + dz, { bevel: .002 }); } }
    if (att.light && ok.indexOf('light') >= 0) { const P = id === 'pistol' ? [0, .017, .095] : id === 'revolver' ? [0, .02, .07] : [-.032, mz[1] - .002, mz[2] - .17]; k.cz(m.poly, .0125, .07, P[0], P[1], P[2], { seg: 14 }).cz(m.steelW, .0135, .008, P[0], P[1], P[2] + .036, { seg: 14 }).cz(m.lens, .0105, .002, P[0], P[1], P[2] + .041, { seg: 14 });
      if (id !== 'pistol' && id !== 'revolver') k.b(m.park, .014, .02, .03, P[0] * .55, P[1], P[2]);
      const cone = new T.Mesh(BEAM.geo || (BEAM.geo = new T.ConeGeometry(.9, 9, 20, 1, true).translate(0, -4.5, 0).rotateX(-HP)), BEAM.mat || (BEAM.mat = new T.MeshBasicMaterial({ map: beamTex(), color: new T.Color(1.2, 1.15, 1.0), transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false, opacity: .12 })));
      cone.position.set(P[0], P[1], P[2] + .045); cone.renderOrder = 6; cone.castShadow = false; cone.name = 'beam'; beam = cone; }
    if (att.grip && ok.indexOf('grip') >= 0) { const z = (tp.support ? tp.support[2] : .3) + (id === 'shotgun' ? .02 : .03), y = id === 'smg' ? -.002 : id === 'shotgun' ? .0 : .03; k.b(m.park, .02, .012, .05, 0, y, z, { bevel: .002 }).cy(m.polyG, .0135, .085, 0, y - .048, z, { seg: 12 }).cy(m.poly, .0155, .01, 0, y - .093, z, { seg: 12 }); loop(4, i => k.cy(m.poly, .0142, .004, 0, y - .02 - i * .018, z, { seg: 12 })); }
    if (att.ext && ok.indexOf('ext') >= 0) { const mg = inst.parts.mag; if (mg && id !== 'pistol') { mg.scale.set(1, 1.5, 1.04); } else if (id === 'pistol') k.b(m.poly, .029, .03, .056, 0, -.103, -.051, { bevel: .004 }).b(m.steel, .026, .006, .05, 0, -.119, -.051); }
    const g = k.end('att'); if (g.children.length) inst.group.add(g); if (beam) { inst.group.add(beam); inst.beam = beam; } }
  const BEAM = {};
  function beamTex() { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.06, 'rgba(255,255,255,.55)'); gr.addColorStop(.3, 'rgba(255,255,255,.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 128); const t = new T.CanvasTexture(c); return t; }
  /** effDef(id, att?) -> the def with the attachments' effect (the player's kit unless att is given) */
  const EFF = {};
  function effDef(id, att) { const d = defs[id]; if (!d) return d; att = att || (kit[id] && kit[id].att); if (!att || d.kind !== 'gun') return d; const ok = ATT[id] || [], on = k => !!att[k] && ok.indexOf(k) >= 0, sig = id + ['sup', 'scope', 'ext', 'light', 'grip'].map(k => on(k) ? 1 : 0).join(''); if (EFF[sig]) return EFF[sig];
    const e = Object.assign({}, d); if (on('sup')) { e.sup = true; e.loud = d.loud * .3; e.dmg = d.dmg * .95; e.far = d.far * .9; } if (on('scope')) e.zoom = id === 'sniper' ? 7 : id === 'rifle' ? 2.6 : 2.0; if (on('ext')) e.mag = Math.round(d.mag * 1.6); if (on('grip')) { e.recoil = d.recoil * .7; e.bloom = d.bloom * .75; e.hip = d.hip * .85; } if (on('light')) e.light = true; return EFF[sig] = e; }

  /* ================================================================== templates + instances */
  const TPL = {};
  function template(id, lod) { const key = id + (lod ? '_l' : ''); if (TPL[key]) return TPL[key]; const spec = BUILD[id](tools(lod), mats(), lod); let tris = 0;
    for (const n in spec.parts) spec.parts[n].traverse(o => { if (o.isMesh) tris += o.geometry.index.count / 3; }); spec.tris = tris; return TPL[key] = spec; }
  function cloneGroup(g) { const o = new T.Group(); o.name = g.name; o.position.copy(g.position); o.rotation.copy(g.rotation); o.visible = g.visible;
    for (const c of g.children) { const mm = new T.Mesh(c.geometry, c.material); mm.castShadow = c.castShadow; mm.receiveShadow = true; mm.renderOrder = c.renderOrder; o.add(mm); } return o; }

  /** make(id, {lod?}) -> weapon instance. fists -> an empty group (no model). */
  function make(id, opts) {
    opts = opts || {}; const def = defs[id] || (opts.model && BUILD[id] ? { id, name: id, kind: 'melee' } : defs.fists), group = new T.Group(); group.name = 'weapon_' + def.id;   /* opts.model: a model with no gameplay definition (the ladle; the shop tools before js/shops.js registers them) */
    const muzzle = new T.Object3D(), ejector = new T.Object3D(), support = new T.Object3D(); group.add(muzzle, ejector, support);
    const inst = { group, id: def.id, def, muzzle, ejector, support, twoHanded: !!def.twoHanded, parts: {}, len: [-.1, .2], update() {} };
    if (def.id === 'fists' || !BUILD[def.id]) return inst;
    const tp = template(def.id, opts.lod ? 1 : 0), P = inst.parts; for (const n in tp.parts) { P[n] = cloneGroup(tp.parts[n]); group.add(P[n]); }
    muzzle.position.fromArray(tp.muzzle); ejector.position.fromArray(tp.ejector); support.position.fromArray(tp.support); if (tp.len) inst.len = tp.len; inst.sightY = tp.sightY || 0; inst.att = opts.att || null;
    if (opts.tint) retint(inst, opts.tint); if (opts.att && !opts.lod) { fit(inst, tp, opts.att); if (opts.tint) retint(inst, opts.tint); if (opts.att.sup && (ATT[def.id] || []).indexOf('sup') >= 0) muzzle.position.z += SUPL[def.id] || .18; }   /* SH: the player's attachments and finish */
    { const sc = def.id === 'sniper' || !!(opts.att && opts.att.scope && (ATT[def.id] || []).indexOf('scope') >= 0); inst.optic = sc ? 'scope' : def.id === 'rifle' ? 'dot' : null; inst.opticY = def.id === 'rifle' ? (sc ? .158 : .130) : def.id === 'smg' ? .135 : def.id === 'sniper' ? .125 : 0; }   /* QA: a scope aimed = the picture through the glass (js/combat.js scope view); the carbine's red dot is looked through */
    const home = {}; for (const n in P) home[n] = P[n].position.clone();
    const st = { kick: 0, lock: 0, cyl: 0, cylT: 0, ham: 0, pump: -1, rel: 0 };
    inst.update = function (dt, s) {
      s = s || {}; dt = dt || 0; if (inst.beam) { const n = GT.env ? GT.env.night || 0 : 0; inst.beam.material.opacity = (.02 + .13 * n) * (s.aim ? .35 : 1); }
      if (s.fired) { st.kick = 1; if (tp.cylStep) st.cylT += tp.cylStep; st.ham = 1; if (tp.pumpTravel) st.pump = 0; }
      st.kick = Math.max(0, st.kick - dt / .07); st.lock += ((s.slideBack ? 1 : 0) - st.lock) * cl(dt * 30, 0, 1); st.ham = Math.max(0, st.ham - dt / .12);
      const back = Math.max(st.kick > .5 ? (1 - st.kick) * 2 : st.kick * 2, st.lock);
      if (P.slide) P.slide.position.z = home.slide.z - back * (tp.slideTravel || 0);
      if (P.bolt) P.bolt.position.z = home.bolt.z - back * (tp.slideTravel || 0);
      if (P.cyl) { st.cyl += (st.cylT - st.cyl) * cl(dt * 22, 0, 1); P.cyl.rotation.z = st.cyl; }
      if (P.hammer) P.hammer.rotation.x = -.9 * (s.cocked ? 1 : st.ham > .5 ? 0 : 0) + (st.ham > 0 ? -.5 * Math.sin(st.ham * PI) : 0);
      if (P.pump) { let k = 0; if (st.pump >= 0) { st.pump += dt / (def.pump || .5); if (st.pump >= 1) st.pump = -1; else { const t = cl((st.pump - .25) / .6, 0, 1); k = Math.sin(t * PI); } } if (s.pump !== undefined) k = s.pump; P.pump.position.z = home.pump.z - k * tp.pumpTravel; inst.pumpK = k; }
      if (P.mag && tp.magDrop) { const r = s.reloading ? (s.reloadK === undefined ? .5 : s.reloadK) : -1; let k = 0; if (r >= 0) k = r < .25 ? r / .25 : r < .6 ? 1 : Math.max(0, 1 - (r - .6) / .22);   // 0 seated .. 1 dropped
        const body = def.id === 'pistol'; if (body) P.mag.visible = k > .02; P.mag.position.set(home.mag.x + tp.magDrop[0] * k, home.mag.y + tp.magDrop[1] * k, home.mag.z + tp.magDrop[2] * k); }
    };
    return inst;
  }

  /* ------------------------------------------------------------------ wheel icons: the real model rendered once, side-on, as a shaded cream silhouette */
  const ICONS = {}; let iconR = null;
  function icon(id, w, h) {
    w = w || 192; h = h || 96; const key = id + w + 'x' + h; if (ICONS[key]) return ICONS[key];
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; ICONS[key] = cv; const g = cv.getContext('2d');
    if (id === 'fists' || !BUILD[id]) { const cx = w / 2, cy = h / 2, s = h * .2; g.lineJoin = 'round';
      const rr = (x, y, ww, hh, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + ww, y, x + ww, y + hh, r); g.arcTo(x + ww, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + ww, y, r); g.closePath(); };
      const solid = (x, y, ww, hh, r) => { g.globalCompositeOperation = 'destination-out'; g.lineWidth = h * .05; rr(x, y, ww, hh, r); g.stroke(); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#efe6d2'; rr(x, y, ww, hh, r); g.fill(); };
      if (id === 'fists') { solid(cx - s * 1.05, cy - s * .3, s * 2.1, s * 1.5, s * .42);                                                       // back of the hand
        for (let i = 0; i < 4; i++) solid(cx - s * 1.05 + i * s * .53, cy - s * (i === 1 || i === 2 ? 1.22 : 1.08), s * .5, s * 1.25, s * .2);    // four curled fingers
        solid(cx - s * .55, cy + s * .12, s * 1.75, s * .56, s * .26); }                                                                        // thumb across
      else { g.strokeStyle = '#efe6d2'; g.lineWidth = h * .03; g.setLineDash([h * .07, h * .07]); g.globalAlpha = .45; g.beginPath(); g.arc(cx, cy, s * 1.4, 0, PI * 2); g.stroke(); }
      return cv; }
    try {
      if (!iconR) { iconR = new T.WebGLRenderer({ antialias: false, alpha: true }); iconR.setPixelRatio(1); }
      const SS = 3, W = w * SS, H = h * SS, rt = new T.WebGLRenderTarget(W, H), sc = new T.Scene(), inst = make(id), L = inst.len, len = L[1] - L[0], cz = (L[0] + L[1]) / 2; inst.group.updateMatrixWorld(true);
      inst.group.traverse(o => { if (o.isMesh && o.material.userData && o.material.userData.sign) o.visible = false; }); if (inst.parts.mag) inst.parts.mag.visible = id !== 'pistol';
      const box = new T.Box3().setFromObject(inst.group), cy = (box.min.y + box.max.y) / 2, hy = box.max.y - box.min.y, half = Math.max(len / 2 * 1.08, hy / 2 * 1.2 * (w / h)), cam = new T.OrthographicCamera(-half, half, half * h / w, -half * h / w, .01, 5);
      cam.position.set(-2, cy, cz); cam.up.set(0, 1, 0); cam.lookAt(0, cy, cz);
      const shade = new T.ShaderMaterial({ vertexShader: 'varying vec3 n; void main(){ n = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
        fragmentShader: 'varying vec3 n; void main(){ float l = .66 + .28 * n.y + .1 * n.x; gl_FragColor = vec4(vec3(.94, .90, .82) * l, 1.); }' });
      sc.overrideMaterial = shade; sc.add(inst.group); iconR.setRenderTarget(rt); iconR.setClearColor(0x000000, 0); iconR.clear(); iconR.render(sc, cam); const buf = new Uint8Array(W * H * 4); iconR.readRenderTargetPixels(rt, 0, 0, W, H, buf); iconR.setRenderTarget(null);
      const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; const tg = tmp.getContext('2d'), im = tg.createImageData(W, H); for (let y = 0; y < H; y++) im.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4); tg.putImageData(im, 0, 0);
      g.imageSmoothingQuality = 'high'; g.drawImage(tmp, 0, 0, w, h); shade.dispose(); rt.dispose();
    } catch (e) { g.fillStyle = '#efe6d2'; g.fillRect(w * .15, h * .42, w * .7, h * .16); }
    return cv;
  }
  function releaseIcons() { if (iconR) { try { iconR.forceContextLoss(); iconR.dispose(); } catch (e) {} iconR = null; } }

  /** register(def, build, slot?) — a weapon defined by another module (js/shops.js: the hardware-store tools). def as in `defs`; build(H, m, lod) -> { parts, muzzle, ejector, support, len } like BUILD.*;
      slot = wheel slot index (default def.slot). The spare 8th slot stops being "empty" the first time something is registered into it. */
  function register(def, build, slot) { if (!def || !def.id || defs[def.id]) return false; defs[def.id] = def; if (typeof build === 'function' && !BUILD[def.id]) BUILD[def.id] = build;   /* a model built here from the reference boards (wrench, nail gun, extinguisher) wins over the caller's */ if (list.indexOf(def.id) < 0) list.push(def.id);
    const s = slots[slot === undefined ? def.slot : slot]; if (s) { if (s.empty) { s.empty = false; s.label = '工具'; } if (s.ids.indexOf(def.id) < 0) s.ids.push(def.id); } return true; }

  GT.weapons = { defs, list, slots, make, icon, releaseIcons, register, light, tint: RIM.a.value, kit, ATT, ATTN, TINTS, effDef, loadout: id => kit[id] || null, model: (id, lod) => make(id, { lod, model: true }).group, tris: id => BUILD[id] ? template(id, 0).tris : 0, _tpl: template };

  /* ================================================================== showcase: every weapon on a turntable, seen from 0.6 m
     showcase.html?m=combat_weapons[&w=pistol][&rot=deg][&lod=1][&t=21]   (no &w -> contact sheet of all seven; also reachable as m=combat&scene=weapons) */
  GT.showcase.combat_weapons = ({ scene, camera }) => {
    const q = new URLSearchParams(location.search), one = q.get('w'), rot = (+q.get('rot') || 0) * PI / 180, lod = q.get('lod') === '1' ? 1 : 0, k = GT.kit(), ids = one ? one.split(',') : q.get('set') === 'tools' ? ['wrench', 'crowbar', 'ladle', 'nailgun', 'extinguisher', 'pipe'] : list.filter(i => i !== 'fists'), TOP = .93, single = ids.length === 1;
    k.box('concrete', 8, .2, 6, 0, -.1, 0).box('wood_plank', 3.2, .05, 1.3, 0, .9, 0, { bevel: .01 }).box('metal_dark', 3.0, .86, 1.1, 0, .44, 0, { bevel: .02 }).box('stucco_cream', 8, 3, .2, 0, 1.5, -1.6);
    k.box('rubber', 3.0, .006, 1.1, 0, .928, 0); scene.add(k.build());
    const lamp = new T.PointLight(0xfff0dc, q.get('t') === '21' ? 1.4 : .35, 5, 2); lamp.position.set(.3, 1.9, .8); scene.add(lamp);
    const SPOT = { shotgun: [-.72, -.3], bat: [.62, -.3], pipe: [-.95, -.02], helmet: [.02, .0], smg: [-.42, .38], pistol: [.3, .38], revolver: [.78, .38], rifle: [.62, .1], crowbar: [-.2, -.34], wrench: [-.75, .12], ladle: [-.1, .12], nailgun: [.5, .1], extinguisher: [1.05, .0] }, items = [], ray = new T.Raycaster(); if (q.get('set') === 'tools') SPOT.pipe = [.3, -.34]; if (GT.weapons.light) GT.weapons.light(0, 0, q.get('t') === '21' ? 1 : 0, 0, q.get('zone') || '');
    ids.forEach(id => { const w = make(id, { lod, model: true }), piv = new T.Group(), L = w.len, mid = (L[0] + L[1]) / 2, span = L[1] - L[0]; w.group.updateMatrixWorld(true); const bb = new T.Box3().setFromObject(w.group), lift = .1 - bb.min.y, sk = GT.kit();
      for (const s of [-1, 1]) { const zq = id === 'pistol' || id === 'revolver' ? (s < 0 ? -.02 : .07) : mid + s * span * .27; ray.set(new T.Vector3(0, -2, zq), new T.Vector3(0, 1, 0)); const hit = ray.intersectObject(w.group, true)[0], y = (hit ? hit.point.y : bb.min.y) + lift;
        sk.cyl('metal_dark', .005, .007, y, 0, y / 2, zq - mid, { seg: 8 }).box('rubber', .034, .008, .022, 0, y - .002, zq - mid, { bevel: .003 }).cyl('metal_dark', .028, .032, .006, 0, .003, zq - mid, { seg: 14 }); }
      w.group.position.set(0, lift, -mid); const turn = new T.Group(); turn.add(w.group, sk.build()); turn.rotation.y = HP; piv.add(turn);
      const sp = single ? [0, .1] : SPOT[id] || [0, 0]; piv.position.set(sp[0], TOP, sp[1]); piv.rotation.y = rot; scene.add(piv); items.push({ piv, w, span, hy: bb.max.y - bb.min.y }); });
    if (q.get('icons')) { const bar = document.createElement('div'); bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:10px;background:rgba(10,11,14,.82);display:flex;gap:10px;justify-content:center;z-index:9'; for (const id of list.concat(['none'])) { const c = icon(id, 264, 132); c.style.cssText = 'position:static;inset:auto;width:132px;height:66px;outline:1px solid rgba(255,255,255,.15)'; bar.appendChild(c); } document.body.appendChild(bar); }
    if (q.get('stats')) { const e = document.getElementById('err'); if (e) e.textContent += ids.map(id => id + ' ' + template(id, lod).tris).join('  ·  ') + '\n'; }
    const at = +q.get('at') || 0, d = single ? Math.max(.6, items[0].span * .95, items[0].hy * 2.6) : 0; if (single && !q.get('fov')) { camera.fov = 34; camera.updateProjectionMatrix(); }
    return { cam: single ? [d * .25, TOP + .2 + d * .22, .1 + d] : [0, 1.95, 1.5], look: single ? [0, TOP + .15, .1] : [0, .98, 0], hours: q.get('t') === '21' ? 21 : 18.2,
      update(dt) { if (q.get('spin')) for (const it of items) it.piv.rotation.y += dt * .6; for (const it of items) it.w.update(dt, { slideBack: at === 1, reloading: at === 2, reloadK: .45 }); } };
  };
})();
