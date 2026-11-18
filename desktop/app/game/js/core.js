/* core.js — shared contract for every module. READ-ONLY for module agents (report needed changes instead of editing).
   Global: window.GT. three.js r128 global build (window.THREE). Units = metres, +Y up.
   Heading convention: h radians, forward = (sin h, 0, cos h), right = (-cos h, 0, sin h). h=0 faces +Z. */
(function () {
  'use strict';
  const T = THREE, GT = window.GT = window.GT || {};
  GT.TAU = Math.PI * 2;
  GT.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  GT.lerp = (a, b, t) => a + (b - a) * t;
  GT.sstep = (x, a, b) => { const t = GT.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  GT.angDiff = (a, b) => { let d = (b - a) % GT.TAU; if (d > Math.PI) d -= GT.TAU; if (d < -Math.PI) d += GT.TAU; return d; };
  /** sRGB hex -> linear THREE.Color. ALWAYS use this for material colours (renderer works in linear HDR). */
  GT.C = hex => new T.Color(hex).convertSRGBToLinear();
  /** deterministic RNG so the world is identical on every load: const r = GT.rng('station'); r() in [0,1) */
  GT.rng = seed => { let h = 2166136261; for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

  /* ------------------------------------------------------------------ world layout (the single source of truth) */
  GT.L = {
    highway: { x: 0, width: 15, lanes: [-6, -3, 3, 6], zMin: -190, zMax: 190 },     // runs along Z. +Z traffic uses x=-3,-6 ; -Z traffic uses x=+3,+6 ; x=0 is a centre turn lane
    crossS: { z: -160, width: 9, x0: 0, x1: 150 }, crossN: { z: 160, width: 9, x0: 0, x1: 150 },   // east-west streets
    backRoad: { x: 150, width: 9, zMin: -160, zMax: 160 },                             // north-south back road. highway+cross streets+back road = the drivable loop
    sidewalk: 2.5,                                                                     // on both sides of the highway
    beach: { x0: -60, x1: -10 }, ocean: { x1: -60 },                                   // west side: boardwalk, palms, sand, then sea. The sun sets over the sea (-X).
    station: { x0: 14, x1: 72, z0: -42, z1: 26,                                        // gas station lot (east of highway)
      canopy: { x: 34, z: -8, w: 16, d: 26, h: 5.2 }, pumps: [[30, -16], [30, -8], [30, 0], [38, -16], [38, -8], [38, 0]],
      store: { x0: 50, x1: 68, z0: -30, z1: 12, h: 4.4, doorZ: -8 },                  // glass front faces west (x = 50). Door centre at z = doorZ
      drives: [-36, 20], sign: { x: 16, z: 23 } },                                    // driveway centres on the highway edge (z), price pylon position
    heroStart: { x: 46.6, z: -4, h: Math.PI },                                         // hero car waits here facing -Z: store on the driver's RIGHT, sunset on the LEFT
    motel: { x0: 14, x1: 92, z0: 48, z1: 132,
      wingE: { x0: 74, x1: 86, z0: 54, z1: 128 }, wingN: { x0: 22, x1: 74, z0: 116, z1: 128 }, floors: 2, floorH: 3.1,
      pool: { x: 44, z: 84, w: 12, d: 7 }, sign: { x: 17, z: 51 }, drive: 62,
      parking: [[62, 60], [62, 64], [62, 68], [62, 72], [62, 76], [62, 96], [62, 100], [62, 104]] },   // stall centres, cars face +X (h = PI/2)
    lotC: { x0: 14, x1: 142, z0: -152, z1: -52 },    // filler: used-car lot + self-storage (road agent, lower detail)
    lotD: { x0: 98, x1: 142, z0: -42, z1: 132 },     // filler: trailer park / vacant lot + billboards
    lotE: { x0: 14, x1: 142, z0: 138, z1: 152 },     // thin strip, strip-mall backs
    bounds: { x0: -58, x1: 162, z0: -186, z1: 186 }
  };

  /* ------------------------------------------------------------------ CHINA EDITION zones (same road loop as GT.L; see SPEC-CN.md). River to the west, the sun sets over it. */
  GT.CN = {
    river: { x1: -60 }, promenade: { x0: -58, x1: -10 },                               // 江滩: was the beach. Dance plaza centre (-34, 30), winter-swim deck (-56, -20), bridge crosses the river near z = 150
    avenue: { x: 0, width: 15, crossings: [-8, 62] },                                  // 大马路: zebra crossings + signals at these z
    snack: { x0: 14, x1: 72, z0: -42, z1: 26, lane: { x: 32 }, noodle: { x0: 50, x1: 68, z0: -30, z1: 12, doorZ: -8 } },   // 小吃街 + enterable 面馆 (door on its west face)
    hotpot: { x0: 22, x1: 50, z0: 100, z1: 128, doorX: 36, doorZ: 100 },               // 火锅店, two storeys, door on the south face
    tenement: { x0: 74, x1: 86, z0: 54, z1: 128, home: { x: 74, z: 70 } },             // 筒子楼; the hero's room door is at `home`, facing west into the courtyard
    courtyard: { x0: 22, x1: 72, z0: 54, z1: 98 },                                     // 院子: mahjong tables, laundry lines, parked scooters, chess
    clock: { x0: 14, x1: 46, z0: 138, z1: 152, tower: { x: 20, z: 145, h: 30 } },      // 钟楼洋行 (stone bank building with clock tower), entrance on the south face at x = 30
    rail: { x: 131, y: 14, z0: -170, z1: 170, building: { x0: 120, x1: 142, z0: -18, z1: 18, h: 42 }, viewpoint: { x: 150, z: -34 } },   // 轻轨穿楼: elevated track along Z passes through the building
    market: { x0: 14, x1: 100, z0: -72, z1: -52 },                                     // 夜市 strip along the lane north of lotC
    wharf: { x0: -58, x1: -14, z0: -184, z1: -122 },                                   // 码头仓库: finale location on the riverbank
    riderStart: { x: 26, z: 60, h: Math.PI }                                           // the hero's e-scooter is parked here in the courtyard
  };

  /* ------------------------------------------------------------------ collision + anchors registry */
  GT.world = {
    boxes: [], anchors: {},
    /** axis-aligned obstacle footprint; h = height (camera/LOS use it). tag is free text. */
    addBox(x0, z0, x1, z1, h, tag) { this.boxes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h: h || 3, tag: tag || '' }); },
    addPost(x, z, r, h, tag) { this.addBox(x - r, z - r, x + r, z + r, h, tag); },
    /** named points other modules need: GT.world.anchor('storeDoor', {x,z,h}) */
    anchor(name, v) { if (v) this.anchors[name] = v; return this.anchors[name]; }
  };

  /* ------------------------------------------------------------------ materials (stub — js/materials.js replaces GT.mat with the real PBR library) */
  const STUB = { asphalt: [0x2c2d30, .9], asphalt_worn: [0x3a3a3c, .9], concrete: [0x8f8e88, .85], concrete_stained: [0x7c7a72, .9], curb_paint_yellow: [0xc9a21f, .7], road_paint_white: [0xdedcd4, .7], road_paint_yellow: [0xd0a61e, .7],
    sand: [0xd9c79c, 1], grass_dry: [0x7a7f45, 1], dirt: [0x6f5c45, 1], stucco_pink: [0xe9a9a0, .9], stucco_teal: [0x6fb8b0, .9], stucco_cream: [0xe8dcc0, .9], stucco_white: [0xecebe6, .9], brick_painted: [0xb9b3a6, .9], cinderblock: [0x9a9992, .95],
    roof_tar: [0x2a2a2c, .95], roof_tile_clay: [0xb5603c, .8], corrugated_metal: [0x9aa0a4, .5, .8], metal_galv: [0x9da3a8, .45, .9], metal_painted_white: [0xe6e6e2, .45, .3], metal_painted_red: [0xb3242c, .45, .3], metal_painted_blue: [0x23539a, .45, .3],
    metal_painted_yellow: [0xd9a514, .45, .3], metal_dark: [0x202227, .5, .7], metal_rust: [0x7a4326, .9, .4], chrome: [0xd8dadf, .08, 1], aluminium_brushed: [0xb9bcc2, .3, 1], rubber: [0x0f0f10, .9], plastic_black: [0x141518, .55], plastic_white: [0xe9e9e6, .5],
    plastic_red: [0xb5202a, .5], plastic_grey: [0x6d7076, .55], glass_clear: [0xbfd9e0, .05, .1], glass_tint: [0x1a2630, .05, .6], glass_dirty: [0x9fb0b0, .25, .1], wood_plank: [0x8a6a48, .8], wood_painted: [0xd8d2c2, .75], palm_trunk: [0x7a6248, 1], palm_leaf: [0x3f7d3a, .8],
    foliage: [0x2f6b34, 1], tile_floor: [0xc9cbc9, .3], terrazzo: [0xb9b3aa, .35], ceiling_panel: [0xdcdcd6, .9], fabric_dark: [0x1b1d22, 1], leather_black: [0x121214, .5], leather_tan: [0x8a5f3c, .5], dash_vinyl: [0x17181b, .65], carpet: [0x222327, 1], water_pool: [0x3fb6c8, .05, .1],
    car_paint: [0xb3242c, .3, .6] };
  const GLOWS = { neon_pink: [1, .16, .55], neon_cyan: [.15, .85, 1], neon_amber: [1, .6, .12], neon_white: [1, .97, .9], neon_red: [1, .1, .08], neon_green: [.2, 1, .45], light_warm: [1, .8, .52], light_cool: [.8, .9, 1], light_red: [1, .08, .05], emissive_screen: [.4, .8, 1] };
  /** every valid material name. Geometry agents must only use these (plus opts). */
  GT.MATERIALS = Object.keys(STUB).concat(Object.keys(GLOWS));
  const cache = {};
  /** GT.mat(name, opts?) -> THREE.Material (cached per name+opts). opts: {color: sRGB hex, rough, metal}. Glass names come back transparent. */
  GT.mat = function (name, opts) {
    const key = name + (opts ? JSON.stringify(opts) : ''); if (cache[key]) return cache[key];
    let m;
    if (GLOWS[name]) { const c = GLOWS[name]; m = new T.MeshBasicMaterial({ color: 0xffffff }); GT.glow(m, new T.Color(c[0], c[1], c[2]), name.startsWith('neon') ? .7 : .5, name.startsWith('neon') ? 6 : 8); }
    else { const s = STUB[name] || [0xff00ff, .5]; m = new T.MeshStandardMaterial({ color: GT.C(opts && opts.color !== undefined ? opts.color : s[0]), roughness: opts && opts.rough !== undefined ? opts.rough : s[1], metalness: opts && opts.metal !== undefined ? opts.metal : (s[2] || 0) });
      if (name.startsWith('glass') || name === 'water_pool') { m.transparent = true; m.opacity = name === 'glass_tint' ? .75 : .28; m.depthWrite = false; } }
    m.name = key; return cache[key] = m;
  };
  /* emissive things brighten at night. Register with GT.glow; js/atmos.js calls GT.applyGlow(night01) every frame. Values are linear HDR (>1 blooms). */
  GT.glowList = [];
  GT.glow = (material, baseColor, day, night, prop) => { GT.glowList.push({ m: material, c: baseColor.clone(), day, night, prop: prop || 'color' }); return material; };
  GT.applyGlow = n => { for (const g of GT.glowList) { const k = GT.lerp(g.day, g.night, n); if (g.prop === 'emissiveIntensity') g.m.emissiveIntensity = k; else g.m[g.prop].copy(g.c).multiplyScalar(k); } };

  /** GT.signTex(text, opts) -> CanvasTexture. Stub: plain text. materials.js replaces it (neon / painted / lcd / distressed styles). */
  GT.signTex = function (text, o) { o = o || {}; const w = o.w || 512, h = o.h || 128, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.fillStyle = o.bg || '#111'; g.fillRect(0, 0, w, h); g.fillStyle = o.color || '#fff'; g.font = `800 ${h * .6}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2, w * .92);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; };
  /** GT.decalMat(name) -> transparent material for flat grime quads. Stub: soft dark blob. materials.js replaces it. */
  GT.DECALS = ['oil_stain', 'crack', 'rust_run', 'grime_streak', 'tire_marks', 'puddle', 'leak', 'graffiti_a', 'graffiti_b', 'water_stain', 'patch', 'gum_spots', 'arrow', 'handicap', 'no_parking'];
  let blob;
  GT.decalMat = function () { if (blob) return blob; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    r.addColorStop(0, 'rgba(0,0,0,.6)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return blob = new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }); };

  /* ------------------------------------------------------------------ Kit: build detailed props out of primitives, merged to ONE mesh per material */
  function ensureIndexed(g) { if (!g.index) { const n = g.attributes.position.count, ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new T.BufferAttribute(ix, 1)); }
    if (!g.attributes.normal) g.computeVertexNormals(); if (!g.attributes.uv) g.setAttribute('uv', new T.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }
  GT.mergeGeos = function (gs) { let nv = 0, ni = 0; for (const g of gs) { ensureIndexed(g); nv += g.attributes.position.count; ni += g.index.count; }
    const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni); let vo = 0, io = 0;
    for (const g of gs) { P.set(g.attributes.position.array, vo * 3); Nn.set(g.attributes.normal.array, vo * 3); U.set(g.attributes.uv.array, vo * 2); const ix = g.index.array; for (let k = 0; k < ix.length; k++) I[io + k] = ix[k] + vo; vo += g.attributes.position.count; io += ix.length; g.dispose(); }
    const o = new T.BufferGeometry(); o.setAttribute('position', new T.BufferAttribute(P, 3)); o.setAttribute('normal', new T.BufferAttribute(Nn, 3)); o.setAttribute('uv', new T.BufferAttribute(U, 2)); o.setIndex(new T.BufferAttribute(I, 1)); return o; };
  /** box with rounded/chamfered edges (bevel in metres) and UVs in METRES (so tiling textures keep a constant texel density). */
  GT.boxGeo = function (w, h, d, bevel) {
    const b = Math.max(0, Math.min(bevel || 0, Math.min(w, h, d) * .49)), s = b > 0 ? 3 : 1, g = new T.BoxGeometry(w, h, d, s, s, s), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, hw = w / 2, hh = h / 2, hd = d / 2;
    const fix = (v, half) => { if (b <= 0) return v; const a = Math.abs(v); return a > half - 1e-6 ? v : Math.sign(v) * (half - b); };
    for (let i = 0; i < p.count; i++) { let x = fix(p.getX(i), hw), y = fix(p.getY(i), hh), z = fix(p.getZ(i), hd);
      if (b > 0) { const ix = GT.clamp(x, -(hw - b), hw - b), iy = GT.clamp(y, -(hh - b), hh - b), iz = GT.clamp(z, -(hd - b), hd - b); let nx = x - ix, ny = y - iy, nz = z - iz; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        x = ix + nx * b; y = iy + ny * b; z = iz + nz * b; n.setXYZ(i, nx, ny, nz); }
      p.setXYZ(i, x, y, z); const f = (i / ((s + 1) * (s + 1))) | 0; if (f < 2) uv.setXY(i, z, y); else if (f < 4) uv.setXY(i, x, z); else uv.setXY(i, x, y); }
    return g; };
  class Kit {
    constructor() { this.parts = new Map(); this.stack = [new T.Matrix4()]; this._m = new T.Matrix4(); this._q = new T.Quaternion(); this._e = new T.Euler(); }
    get top() { return this.stack[this.stack.length - 1]; }
    /** push a transform (position + optional euler YXZ rotation + optional uniform/vec scale); everything added until pop() is inside it. */
    push(x = 0, y = 0, z = 0, o = {}) { const s = o.s === undefined ? 1 : o.s, sv = Array.isArray(s) ? new T.Vector3(...s) : new T.Vector3(s, s, s);
      const m = new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ')), sv); this.stack.push(this.top.clone().multiply(m)); return this; }
    pop() { if (this.stack.length > 1) this.stack.pop(); return this; }
    /** add any BufferGeometry (already positioned in local space). mat = material name or THREE.Material. o: {x,y,z,rx,ry,rz,s} */
    geo(mat, g, o = {}) { const m = typeof mat === 'string' ? GT.mat(mat) : mat; ensureIndexed(g);
      const s = o.s === undefined ? 1 : o.s, sv = Array.isArray(s) ? new T.Vector3(...s) : new T.Vector3(s, s, s);
      this._m.compose(new T.Vector3(o.x || 0, o.y || 0, o.z || 0), this._q.setFromEuler(this._e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ')), sv); g.applyMatrix4(this.top.clone().multiply(this._m));
      if (!this.parts.has(m)) this.parts.set(m, []); this.parts.get(m).push(g); return this; }
    /** centred box. o: {bevel, rx, ry, rz}. Use a small bevel (0.005–0.03) on EVERYTHING man-made: bevels catch highlights and are the #1 realism cue. */
    box(mat, w, h, d, x = 0, y = 0, z = 0, o = {}) { return this.geo(mat, GT.boxGeo(w, h, d, o.bevel), { x, y, z, rx: o.rx, ry: o.ry, rz: o.rz }); }
    /** cylinder along Y (rotate with rx/rz). o: {seg, open, rx, ry, rz}. UV v is scaled to metres. */
    cyl(mat, rTop, rBot, h, x = 0, y = 0, z = 0, o = {}) { const g = new T.CylinderGeometry(rTop, rBot, h, o.seg || 16, 1, !!o.open), uv = g.attributes.uv, c = Math.PI * (rTop + rBot);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * c, uv.getY(i) * h); return this.geo(mat, g, { x, y, z, rx: o.rx, ry: o.ry, rz: o.rz }); }
    sphere(mat, r, x = 0, y = 0, z = 0, o = {}) { return this.geo(mat, new T.SphereGeometry(r, o.seg || 16, o.seg2 || 12), { x, y, z, s: o.s, rx: o.rx, ry: o.ry, rz: o.rz }); }
    /** round tube through points [[x,y,z],...] (pipes, cables, railings, sagging wires). o: {seg, closed, tension} */
    tube(mat, pts, r, o = {}) { const curve = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p[0], p[1], p[2])), !!o.closed, 'catmullrom', o.tension === undefined ? .5 : o.tension);
      return this.geo(mat, new T.TubeGeometry(curve, o.steps || Math.max(8, pts.length * 6), r, o.seg || 8, !!o.closed)); }
    /** flat textured quad (decal / sign face). Lies in XY facing +Z by default; rotate with o.rx/ry/rz. mat should be transparent + polygonOffset for decals. */
    quad(mat, w, h, x = 0, y = 0, z = 0, o = {}) { return this.geo(mat, new T.PlaneGeometry(w, h), { x, y, z, rx: o.rx, ry: o.ry, rz: o.rz }); }
    /** ground decal lying flat (facing +Y), rotated ry about Y. */
    decal(name, w, d, x, y, z, ry = 0) { return this.geo(GT.decalMat(name), new T.PlaneGeometry(w, d), { x, y, z, rx: -Math.PI / 2, ry }); }
    /** -> THREE.Group with one merged Mesh per material. o: {cast=true, recv=true} */
    build(o = {}) { const grp = new T.Group(); for (const [m, gs] of this.parts) { const mesh = new T.Mesh(GT.mergeGeos(gs), m); mesh.castShadow = o.cast !== false && !m.transparent && !m.isMeshBasicMaterial; mesh.receiveShadow = o.recv !== false; grp.add(mesh); } this.parts.clear(); return grp; }
  }
  GT.Kit = Kit; GT.kit = () => new Kit();

  /* ------------------------------------------------------------------ registries filled by modules */
  GT.showcase = {};   // GT.showcase.<name> = ({scene, T}) => ({cam:[x,y,z], look:[x,y,z], hours?:number})   — see showcase.html
  GT.env = { hours: 18.2, night: 0, sunDir: new T.Vector3(-.8, .3, .2).normalize(), sunColor: new T.Color(1, .75, .5), wet: 0 };
})();
