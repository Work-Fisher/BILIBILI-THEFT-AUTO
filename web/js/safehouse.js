/* safehouse.js — SUNSET HEAT round 2: 阿凯's long-stay room (CORAL COMET motel, room 106) as a walkable third-person interior.
   GT.safehouse = { build(scene), update(dt), enter(ctl), exit(ctl), inside (bool), anchors, state, news(text), setState(patch), stash }
   - The interior is a sealed set built INSIDE the motel's east wing at the real room position (the on-foot controller clamps to GT.L.bounds, so a
     far-away set is not walkable). build() hollows the 'motel-wingE' collider around the room; the set is invisible until enter().
   - While inside: every other top-level scene object and every exterior light is hidden (no exterior light leaks, no shader re-compiles for the
     world, and the frame gets cheap); the room is lit by its own rig: a shadow-casting "sun / neon" spot through real venetian slats, a bedside
     lamp, ceiling light, TV glow, bathroom + kitchenette fluorescents, fridge light, plus a small interior PMREM environment.
   - Interactions are registered through GT.act (queued in GT._actQueue until onfoot.js loads) and use ctx.ctl.takeover for scripted cameras.
   Showcases: safehouse (&v=0..3), safehouse_tv (&ch=0..4), safehouse_mirror, safehouse_fridge, safehouse_details (&d=0..6), safehouse_door (&open=1).
   Common showcase params: &at=<seconds pre-roll> &lc=x,y,z &ll=x,y,z (camera / look in ROOM-LOCAL metres) &blinds=0..2 &lamp=0|1 &ceil=0|1 &tv=0|1 &ac=0|1 */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!T || !GT) return;
  const PI = Math.PI, TAU = PI * 2, HP = PI / 2, sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max;
  const clamp = (v, a, b) => max(a, min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
  const sst = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hsh = n => { const s = sin(n * 127.1 + 3.7) * 43758.5453; return s - Math.floor(s); };
  const Q = new URLSearchParams(location.search);

  /* ------------------------------------------------------------------ placement
     room-local frame: x across the room (door side = +x), z along it (+z = front wall / the lot), origin at the centre of the main room floor.
     root.rotation.y = -PI/2  =>  world = (RX - lz, FLOOR + y, RZ + lx). */
  const HW = 2.1, ZF = 3.25, ZB = -3.25, ZR = -5.25, CH = 2.7;          // half width, front wall, partition, rear wall, ceiling
  const FLOOR = .14, RX = 78.05, RZ = 74.02, DOORX = 1.4, ROOM = 106;   // floor = motel walk level; the real door of room 106 is at world (74, 75.42)
  const EXT = { x: 74, z: RZ + DOORX };
  const W = (lx, lz) => ({ x: RX - lz, z: RZ + lx });
  const W3 = (lx, y, lz) => [RX - lz, FLOOR + y, RZ + lx];
  const WH = hl => hl - HP;                                              // local heading -> world heading

  const S = { built: false, inside: false, scene: null, cam: null, renderer: null, t: 0, pre: false, busy: false, seq: [], take: null, solo: null,
    st: { lamp: true, ceil: false, bath: true, kit: true, tv: true, ac: true, blinds: 1, fridge: false, ch: 2, water: false },
    stash: 0, snacks: 0, slept: 0, news: [], hidden: [], hidLights: [], envOld: null, envDirty: true, envT: 0, emDirty: true, tvT: 0, tvStatic: 0, tvAcc: 0,
    fan: 0, door: 0, doorT: 0, extDoor: 0, extDoorT: 0, fridge: 0, slat: .6, slatT: .6, acK: 1, outfit: 0, ui: null, uiText: '' };

  /* ------------------------------------------------------------------ materials: per-module clones (tinted via material.color, own interior envMap) */
  const MC = {}, envMats = [];
  const BASE = () => (GT.tex && GT.tex.colors) || {};
  /** M(name, tintHex?, o?) -> clone of GT.mat(name) whose albedo is re-tinted towards tintHex. o: {rough, metal, env} */
  function M(name, tint, o) {
    const key = name + '|' + (tint === undefined ? '' : tint.toString(16)) + (o ? JSON.stringify(o) : ''); if (MC[key]) return MC[key];
    const src = GT.mat(name); if (!src || !src.isMeshStandardMaterial) return MC[key] = src;
    const m = src.clone(); m.onBeforeCompile = src.onBeforeCompile; if (src.customProgramCacheKey) m.customProgramCacheKey = src.customProgramCacheKey; m.userData = {}; m.name = 'sh_' + key;
    if (tint !== undefined && (name === 'car_paint' || name === 'glass_clear' || name === 'glass_tint')) m.color.copy(GT.C(tint));
    else if (tint !== undefined) { const b = BASE()[name], bc = GT.C(b !== undefined && b !== 0xffffff ? b : 0xffffff), tc = GT.C(tint); m.color.setRGB(tc.r / max(bc.r, .004), tc.g / max(bc.g, .004), tc.b / max(bc.b, .004)); }
    if (o && o.rough !== undefined) m.roughness *= o.rough; if (o && o.metal !== undefined) { m.metalness = o.metal; m.metalnessMap = null; }
    m.envMapIntensity = (o && o.env !== undefined ? o.env : 1) * (src.envMapIntensity || 1); envMats.push(m); return MC[key] = m;
  }
  function std(p) { const m = new T.MeshStandardMaterial(p); envMats.push(m); return m; }

  /* ------------------------------------------------------------------ small geometry helpers */
  const UP = new T.Vector3(0, 1, 0), ONE = new T.Vector3(1, 1, 1);
  function rodGeo(a, b, r, r2, seg) { const va = new T.Vector3(a[0], a[1], a[2]), d = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length() || 1e-4;
    const g = new T.CylinderGeometry(r2 === undefined ? r : r2, r, len, seg || 8, 1, false); g.applyMatrix4(new T.Matrix4().compose(va.addScaledVector(d, .5), new T.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), ONE)); return g; }
  const rod = (k, mat, a, b, r, r2, seg) => k.geo(mat, rodGeo(a, b, r, r2, seg));
  function remap(g, r) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1])); return g; }
  /** atlas quad: a plane (w x h) showing atlas cell `rect`. o: {rx, ry, rz} */
  function aq(k, mat, rect, w, h, x, y, z, o) { k.geo(mat, remap(new T.PlaneGeometry(w, h), rect), Object.assign({ x, y, z }, o || {})); }
  /** thin "paper" lying flat on a surface (faces +Y), rotated ry */
  function flat(k, mat, rect, w, d, x, y, z, ry) { k.geo(mat, remap(new T.PlaneGeometry(w, d), rect), { x, y, z, rx: -HP, ry: ry || 0 }); }
  /** grid surface from f(u, v) -> [x, y, z]; UVs = (u, v) remapped into rect (or metres when rect is null) */
  function surf(nu, nv, f, rect, su, sv) { const P = [], U = [], I = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const u = i / nu, v = j / nv, p = f(u, v); P.push(p[0], p[1], p[2]); if (rect) U.push(rect[0] + u * (rect[2] - rect[0]), rect[1] + v * (rect[3] - rect[1])); else U.push(u * (su || 1), v * (sv || 1)); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; I.push(a, c, b, b, c, d); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals(); return g; }
  /** squashed "pillow" solid */
  function pillowGeo(w, h, d, pw) { const g = new T.SphereGeometry(1, 20, 14), p = g.attributes.position, e = pw || .55;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), sx = Math.sign(x) * Math.pow(abs(x), e), sz = Math.sign(z) * Math.pow(abs(z), e), pinch = 1 - .55 * Math.pow(max(abs(sx), abs(sz)), 6);
      p.setXYZ(i, sx * w / 2, y * h / 2 * max(.12, pinch) * (1 + .12 * sin(x * 7 + z * 5)), sz * d / 2); }
    g.computeVertexNormals(); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) + w, p.getZ(i) + d); return g; }

  /* ------------------------------------------------------------------ 2D drawing helpers (atlas + TV) */
  const FONT = "'PingFang SC','Hiragino Sans GB','Heiti SC','Microsoft YaHei','Noto Sans CJK SC','Helvetica Neue',Arial,sans-serif";
  const HAND = "'Bradley Hand','Marker Felt','Kaiti SC','STKaiti','Comic Sans MS',cursive";
  const SLAB = "'Arial Black','Impact','Helvetica Neue','PingFang SC','Heiti SC',sans-serif";
  function tx(g, s, x, y, px, col, o) { o = o || {}; g.font = (o.w || 700) + ' ' + px + 'px ' + (o.f || FONT); g.textAlign = o.a || 'left'; g.textBaseline = o.b || 'middle';
    if (o.rot) { g.save(); g.translate(x, y); g.rotate(o.rot); x = 0; y = 0; }
    if (o.ol) { g.lineJoin = 'round'; g.lineWidth = o.olw || px * .22; g.strokeStyle = o.ol; g.strokeText(s, x, y, o.max); }
    g.fillStyle = col; g.fillText(s, x, y, o.max); if (o.rot) g.restore(); }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function grad(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); for (let i = 0; i < stops.length; i += 2) gr.addColorStop(stops[i], stops[i + 1]); return gr; }
  function blob(g, x, y, rx, ry, col, a) { const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.save(); g.globalAlpha = a === undefined ? 1 : a; g.translate(x, y); g.scale(rx, ry); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore(); }
  function ell(g, x, y, rx, ry, col, rot) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); g.fill(); }
  /** side silhouette of a 70s muscle car, ~100 units long, wheels on y = 0 */
  function carSil(g, x, y, s, col, o) { o = o || {}; g.save(); g.translate(x, y); g.scale(s * (o.flip ? -1 : 1), s); g.fillStyle = col;
    g.beginPath(); g.moveTo(-50, -4); g.lineTo(-50, -12); g.quadraticCurveTo(-48, -17, -36, -18); g.lineTo(-19, -19); g.lineTo(-9, -29); g.lineTo(13, -29); g.lineTo(27, -19); g.lineTo(44, -17); g.quadraticCurveTo(51, -15, 50, -8); g.lineTo(50, -4); g.closePath(); g.fill();
    if (o.glass) { g.fillStyle = o.glass; g.beginPath(); g.moveTo(-16, -19.5); g.lineTo(-8, -27); g.lineTo(1, -27); g.lineTo(1, -19.5); g.closePath(); g.fill(); g.beginPath(); g.moveTo(3, -19.5); g.lineTo(3, -27); g.lineTo(12, -27); g.lineTo(23, -19.5); g.closePath(); g.fill(); }
    if (o.stripe) { g.fillStyle = o.stripe; g.fillRect(-48, -13, 96, 2.2); }
    for (const wx of [-31, 30]) { g.fillStyle = o.tyre || '#0b0b0c'; g.beginPath(); g.arc(wx, -5, 8.4, 0, TAU); g.fill(); g.fillStyle = o.hub || col; g.beginPath(); g.arc(wx, -5, 4.2, 0, TAU); g.fill(); }
    g.restore(); }
  /** standing human silhouette, feet at (x, y), ~100 units tall. o: {col, l, r: 'down'|'up'|'hip'|'cross'|'point', hair, flip, hat} */
  function person(g, x, y, s, o) { o = o || {}; g.save(); g.translate(x, y); g.scale(s * (o.flip ? -1 : 1), s); g.fillStyle = g.strokeStyle = o.col || '#111'; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.arc(0, -89, 8.5, 0, TAU); g.fill(); if (o.hair) { g.beginPath(); g.ellipse(0, -92, 12, 11, 0, PI * .95, TAU * 1.03); g.fill(); g.fillRect(-12, -92, 5, 16); g.fillRect(7, -92, 5, 16); }
    if (o.hat) { g.fillRect(-13, -96, 26, 3); g.fillRect(-8, -104, 16, 9); }
    g.beginPath(); g.moveTo(-15, -77); g.quadraticCurveTo(0, -81, 15, -77); g.lineTo(11, -40); g.lineTo(-11, -40); g.closePath(); g.fill(); g.fillRect(-3, -82, 6, 6);
    g.lineWidth = 6.5; const arm = (sx, a) => { g.beginPath(); g.moveTo(sx * 13.5, -74); if (a === 'up') { g.lineTo(sx * 21, -90); g.lineTo(sx * 25, -106); } else if (a === 'hip') { g.lineTo(sx * 24, -58); g.lineTo(sx * 12, -45); } else if (a === 'cross') { g.lineTo(sx * 15, -59); g.lineTo(-sx * 7, -62); } else if (a === 'point') { g.lineTo(sx * 27, -70); g.lineTo(sx * 42, -74); } else { g.lineTo(sx * 17, -58); g.lineTo(sx * 17, -42); } g.stroke(); };
    arm(-1, o.l); arm(1, o.r); g.lineWidth = 8.5; g.beginPath(); g.moveTo(-6, -42); g.lineTo(-8, -20); g.lineTo(-8, 0); g.moveTo(6, -42); g.lineTo(8, -20); g.lineTo(9, 0); g.stroke(); g.restore(); }
  function palm(g, x, y, hgt, lean, col, seed) { const r = GT.rng('palm' + seed), tx_ = x + lean, ty = y - hgt; g.strokeStyle = col; g.lineCap = 'round'; g.lineWidth = max(2, hgt * .045); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * .2, y - hgt * .6, tx_, ty); g.stroke();
    g.lineWidth = max(1.5, hgt * .028); for (let i = 0; i < 11; i++) { const a = -PI * .5 + (i - 5) * .52 + (r() - .5) * .2, L = hgt * (.36 + r() * .14), ex = tx_ + cos(a) * L, ey = ty + sin(a) * L * .7 + L * .34; g.beginPath(); g.moveTo(tx_, ty); g.quadraticCurveTo(tx_ + cos(a) * L * .6, ty + sin(a) * L * .75 - L * .12, ex, ey); g.stroke(); } }
  /** paper ageing: yellowing, corner stains, speckle */
  function age(g, w, h, seed, k) { const r = GT.rng('age' + seed); k = k === undefined ? 1 : k; g.fillStyle = 'rgba(196,160,92,' + (.12 * k) + ')'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) blob(g, r() * w, r() * h, w * (.15 + r() * .3), h * (.1 + r() * .25), 'rgba(120,84,40,1)', .1 * k);
    for (let i = 0; i < 40 * k; i++) { g.fillStyle = 'rgba(70,50,30,' + (.1 + r() * .25) + ')'; g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5); }
    const vg = g.createRadialGradient(w / 2, h / 2, min(w, h) * .3, w / 2, h / 2, max(w, h) * .75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,40,20,' + (.22 * k) + ')'); g.fillStyle = vg; g.fillRect(0, 0, w, h); }
  function lines(g, x, y, w, n, dy, col, seed) { const r = GT.rng('ln' + seed); g.fillStyle = col; for (let i = 0; i < n; i++) g.fillRect(x, y + i * dy, w * (.45 + r() * .55), max(1, dy * .28)); }

  /* ================================================================== texture atlas: every print, label and piece of paper in the room on ONE 2048² canvas */
  const AT = { c: null, g: null, tex: null, R: {}, x: 0, y: 0, rowH: 0, SZ: 2048 };
  function cell(name, w, h, draw) { const A = AT; if (A.x + w > A.SZ) { A.x = 0; A.y += A.rowH + 6; A.rowH = 0; } const g = A.g; g.save(); g.beginPath(); g.rect(A.x, A.y, w, h); g.clip(); g.translate(A.x, A.y); draw(g, w, h); g.restore();
    const i = 1.5; A.R[name] = [(A.x + i) / A.SZ, 1 - (A.y + h - i) / A.SZ, (A.x + w - i) / A.SZ, 1 - (A.y + i) / A.SZ]; A.R[name].px = [A.x, A.y, w, h]; A.x += w + 6; A.rowH = max(A.rowH, h); }
  function drawNote(g, w, h) { g.fillStyle = '#e9d86a'; g.fillRect(0, 0, w, h); g.fillStyle = grad(g, 0, 0, 0, h, [0, 'rgba(255,255,255,.25)', .2, 'rgba(255,255,255,0)', 1, 'rgba(120,90,0,.18)']); g.fillRect(0, 0, w, h);
    tx(g, '床底 / STASH', w / 2, h * .2, h * .15, '#2a3a6a', { f: HAND, a: 'center' }); tx(g, '$' + Math.round(S.stash).toLocaleString('en-US'), w / 2, h * .52, h * .3, '#16224a', { f: HAND, a: 'center', max: w * .9 });
    g.strokeStyle = '#16224a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(w * .14, h * .7); g.quadraticCurveTo(w * .5, h * .76, w * .86, h * .69); g.stroke(); tx(g, S.stash > 0 ? '别动！周五要用' : '空的。又空了。', w / 2, h * .86, h * .12, '#9a2a22', { f: HAND, a: 'center' }); }
  function buildAtlas() {
    const A = AT; A.c = document.createElement('canvas'); A.c.width = A.c.height = A.SZ; const g0 = A.g = A.c.getContext('2d'); g0.fillStyle = '#8a8478'; g0.fillRect(0, 0, A.SZ, A.SZ);
    // ---- faded tropical print (over the bed)
    cell('print', 640, 448, (g, w, h) => { g.fillStyle = grad(g, 0, 0, 0, h, [0, '#e7c9a4', .34, '#f0b98c', .58, '#f4d3a2', .6, '#8fbdb4', 1, '#5f9a98']); g.fillRect(0, 0, w, h);
      blob(g, w * .58, h * .56, 150, 150, 'rgba(255,244,214,1)', .9); ell(g, w * .58, h * .56, 46, 46, '#fff3d6'); g.fillStyle = '#8fbdb4'; g.fillRect(0, h * .6, w, h * .4); g.fillStyle = grad(g, 0, h * .6, 0, h, [0, '#9cc6ba', 1, '#5b9693']); g.fillRect(0, h * .6, w, h * .4);
      for (let i = 0; i < 26; i++) { g.fillStyle = 'rgba(255,240,205,' + (.5 - i * .017) + ')'; const yy = h * .61 + i * i * .22 + i * 2, ww = 30 + i * 9; g.fillRect(w * .58 - ww / 2 + sin(i * 2.3) * 8, yy, ww, 2 + i * .12); }
      g.fillStyle = '#7fa59a'; g.beginPath(); g.moveTo(0, h * .6); g.quadraticCurveTo(w * .12, h * .5, w * .3, h * .6); g.fill(); g.beginPath(); g.moveTo(w * .78, h * .6); g.quadraticCurveTo(w * .9, h * .54, w, h * .58); g.lineTo(w, h * .6); g.fill();
      palm(g, w * .16, h * .97, h * .78, 46, '#3f6f66', 1); palm(g, w * .3, h * 1.0, h * .56, -22, '#4d7f72', 2); palm(g, w * .9, h * .98, h * .66, -40, '#3f6f66', 3);
      for (const [fx, fs, fl] of [[.6, 1, 0], [.7, .8, 1]]) { const X = w * fx, Y = h * .86, c = '#d98f8c'; g.strokeStyle = c; g.lineCap = 'round'; g.lineWidth = 3 * fs; g.beginPath(); g.moveTo(X, Y); g.lineTo(X, Y - 60 * fs); g.moveTo(X + 4 * fs, Y - 60 * fs); g.lineTo(X + 12 * fs, Y - 34 * fs); g.lineTo(X + 4 * fs, Y - 22 * fs); g.stroke();
        ell(g, X + 2 * fs, Y - 70 * fs, 24 * fs, 14 * fs, c, -.15); g.lineWidth = 5 * fs; g.beginPath(); const d = fl ? -1 : 1; g.moveTo(X + d * 18 * fs, Y - 76 * fs); g.bezierCurveTo(X + d * 40 * fs, Y - 96 * fs, X + d * 8 * fs, Y - 120 * fs, X + d * 30 * fs, Y - 136 * fs); g.stroke(); ell(g, X + d * 34 * fs, Y - 138 * fs, 8 * fs, 6 * fs, c); g.fillStyle = '#4a3a3a'; g.fillRect(X + d * 38 * fs - (d < 0 ? 8 * fs : 0), Y - 139 * fs, 8 * fs, 3 * fs); }
      tx(g, 'COSTA BRISA', w * .5, h * .12, 44, 'rgba(120,70,60,.55)', { f: "'Snell Roundhand','Brush Script MT',cursive", a: 'center', w: 400 });
      g.fillStyle = 'rgba(236,228,200,.34)'; g.fillRect(0, 0, w, h); g.fillStyle = grad(g, 0, 0, w, 0, [0, 'rgba(255,246,214,.5)', .28, 'rgba(255,246,214,.08)', 1, 'rgba(255,246,214,0)']); g.fillRect(0, 0, w, h);   // sun-bleached on the window side
      age(g, w, h, 'print', 1.2); g.strokeStyle = '#efe6cf'; g.lineWidth = 26; g.strokeRect(0, 0, w, h); g.strokeStyle = 'rgba(90,70,40,.35)'; g.lineWidth = 1.5; g.strokeRect(14, 14, w - 28, h - 28); });
    // ---- the stunt-crew photo (silhouettes only)
    cell('photo', 448, 320, (g, w, h) => { g.fillStyle = grad(g, 0, 0, 0, h, [0, '#d98a4a', .45, '#f0c07a', .62, '#f6dca4', .63, '#6a5440', 1, '#3a2c22']); g.fillRect(0, 0, w, h); blob(g, w * .7, h * .6, 130, 90, 'rgba(255,240,200,1)', .9);
      g.fillStyle = '#4a3a2c'; g.beginPath(); g.moveTo(0, h * .63); g.lineTo(w * .2, h * .56); g.lineTo(w * .42, h * .62); g.lineTo(w, h * .6); g.lineTo(w, h * .66); g.lineTo(0, h * .66); g.fill();
      g.fillStyle = '#17120e'; g.beginPath(); g.moveTo(w * .02, h * .86); g.lineTo(w * .3, h * .6); g.lineTo(w * .33, h * .6); g.lineTo(w * .33, h * .86); g.fill(); g.strokeStyle = '#17120e'; g.lineWidth = 3; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(w * (.06 + i * .055), h * .86); g.lineTo(w * (.09 + i * .055), h * (.8 - i * .045)); g.stroke(); }
      g.save(); g.translate(w * .5, h * .34); g.rotate(-.24); carSil(g, 0, 0, 1.25, '#15100c', { hub: '#3a2c22' }); g.restore(); for (let i = 0; i < 7; i++) blob(g, w * (.36 - i * .03), h * (.52 + i * .03), 16 + i * 5, 10 + i * 3, 'rgba(250,225,180,1)', .16);
      const P = [[.52, 'cross', 'cross', 0], [.6, 'hip', 'up', 1], [.69, 'down', 'hip', 0], [.78, 'up', 'up', 1], [.87, 'cross', 'cross', 0]]; P.forEach((p, i) => person(g, w * p[0], h * .93, 1.32 + (i % 2) * .08, { col: '#120d0a', l: p[1], r: p[2], hair: !!p[3], hat: i === 2 }));
      g.fillStyle = '#15100c'; g.fillRect(0, h * .93, w, h * .07); g.fillStyle = 'rgba(30,20,14,.85)'; g.fillRect(w * .46, h * .1, w * .5, h * .1); tx(g, '火轮特技队 · FIREWHEEL', w * .71, h * .152, 17, '#f0d9a8', { a: 'center', f: SLAB, max: w * .46 });
      g.fillStyle = 'rgba(210,150,70,.22)'; g.fillRect(0, 0, w, h); age(g, w, h, 'photo', 1); tx(g, "'09 夏 — 最后一跳", w * .96, h * .955, 15, 'rgba(255,240,210,.85)', { f: HAND, a: 'right' }); g.strokeStyle = '#f2ecdc'; g.lineWidth = 16; g.strokeRect(0, 0, w, h); });
    // ---- corkboard with bills
    cell('cork', 672, 448, (g, w, h) => { const r = GT.rng('cork'); g.fillStyle = '#a9794a'; g.fillRect(0, 0, w, h); for (let i = 0; i < 5200; i++) { g.fillStyle = ['rgba(70,44,22,.5)', 'rgba(214,170,116,.5)', 'rgba(128,88,50,.6)'][i % 3]; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2); }
      const paper = (x, y, pw, ph, rot, col, fn) => { g.save(); g.translate(x, y); g.rotate(rot); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 8; g.shadowOffsetY = 3; g.fillStyle = col; g.fillRect(0, 0, pw, ph); g.shadowColor = 'transparent'; fn(pw, ph); const pc = ['#c22', '#2a5fc0', '#e0b020', '#2a8a4a'][(r() * 4) | 0]; g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(pw / 2 + 2, 11, 6, 0, TAU); g.fill(); g.fillStyle = pc; g.beginPath(); g.arc(pw / 2, 8, 6, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(pw / 2 - 2, 6, 2, 0, TAU); g.fill(); g.restore(); };
      paper(22, 26, 200, 262, -.04, '#f1ecdc', (pw, ph) => { g.fillStyle = '#1d4f8f'; g.fillRect(0, 22, pw, 30); tx(g, '海岸电力 COAST POWER', pw / 2, 37, 14, '#fff', { a: 'center' }); lines(g, 14, 70, pw - 28, 9, 13, 'rgba(40,40,50,.55)', 1); tx(g, '应付 $ 312.40', 14, 204, 17, '#222'); g.save(); g.translate(pw * .5, ph * .58); g.rotate(-.3); g.strokeStyle = '#c0261c'; g.lineWidth = 4; g.strokeRect(-78, -22, 156, 44); tx(g, '逾期 PAST DUE', 0, 1, 20, '#c0261c', { a: 'center', f: SLAB }); g.restore(); lines(g, 14, 226, pw - 28, 2, 12, 'rgba(40,40,50,.4)', 2); });
      paper(238, 16, 176, 150, .05, '#f6e7a8', (pw, ph) => { tx(g, '欠 郝老板', 14, 42, 26, '#1b2a5a', { f: HAND }); tx(g, '$4,200', 16, 82, 38, '#a3201a', { f: HAND }); tx(g, '周五之前！！', 14, 122, 22, '#1b2a5a', { f: HAND }); g.strokeStyle = '#a3201a'; g.lineWidth = 3; g.beginPath(); g.ellipse(74, 82, 68, 26, -.05, 0, TAU); g.stroke(); });
      paper(432, 28, 214, 150, -.03, '#e9e4d2', (pw, ph) => { g.fillStyle = '#d8a21c'; g.fillRect(0, 22, pw, 24); tx(g, '海湾拖车 GULF COAST TOWING', pw / 2, 34, 12, '#221', { a: 'center' }); tx(g, '工资单 / PAY STUB', 12, 62, 12, '#333'); lines(g, 12, 78, pw - 24, 4, 12, 'rgba(40,40,50,.5)', 3); tx(g, '实发 NET  $ 388.17', 12, 134, 15, '#222'); });
      paper(246, 182, 170, 240, .03, '#f4f1e8', (pw, ph) => { g.fillStyle = '#c0261c'; g.fillRect(0, 20, pw, 40); tx(g, '最后通知', pw / 2, 33, 17, '#fff', { a: 'center' }); tx(g, 'FINAL NOTICE', pw / 2, 51, 11, '#fff', { a: 'center' }); tx(g, '珊瑚彗星旅馆', 12, 78, 13, '#222'); tx(g, '106 号房 · 长租', 12, 96, 12, '#444'); lines(g, 12, 114, pw - 24, 6, 12, 'rgba(40,40,50,.5)', 4); tx(g, '欠租 2 周', 12, 198, 17, '#c0261c', { f: SLAB }); tx(g, '—— 经理 梅姨', 12, 222, 12, '#333', { f: HAND }); });
      paper(432, 196, 120, 150, .09, '#fff', (pw, ph) => { g.fillStyle = grad(g, 0, 0, 0, ph, [0, '#f0b070', .6, '#f6d8a0', .61, '#3a4a50', 1, '#20282c']); g.fillRect(8, 22, pw - 16, ph - 54); person(g, pw * .36, ph - 34, .62, { col: '#141414', r: 'up' }); person(g, pw * .66, ph - 34, .56, { col: '#141414', l: 'hip', hair: true }); tx(g, '阿烈 18 岁', pw / 2, ph - 16, 13, '#333', { f: HAND, a: 'center' }); });
      paper(566, 190, 92, 216, -.02, '#f3efe2', (pw, ph) => { tx(g, '违停', pw / 2, 34, 15, '#b3241c', { a: 'center' }); tx(g, 'PARKING', pw / 2, 52, 10, '#b3241c', { a: 'center' }); lines(g, 8, 68, pw - 16, 9, 11, 'rgba(40,40,50,.5)', 5); tx(g, '$75', pw / 2, 186, 24, '#222', { a: 'center', f: SLAB }); });
      paper(30, 306, 196, 118, .02, '#e8ddc0', (pw, ph) => { tx(g, '龙记外卖', 12, 36, 22, '#b3241c', { f: SLAB }); tx(g, 'DRAGON WOK · 送到门口', 12, 58, 11, '#333'); lines(g, 12, 72, pw - 24, 3, 11, 'rgba(60,40,30,.5)', 6); tx(g, '☎ 555-0166', 12, 106, 14, '#222'); });
      blob(g, w * .5, h * .5, w * .7, h * .7, 'rgba(0,0,0,0)', 1); g.fillStyle = grad(g, 0, 0, 0, h, [0, 'rgba(0,0,0,.18)', .1, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,.1)']); g.fillRect(0, 0, w, h); });
    // ---- calendar with FRIDAY circled
    cell('cal', 320, 448, (g, w, h) => { g.fillStyle = '#f2eee2'; g.fillRect(0, 0, w, h); g.fillStyle = grad(g, 0, 0, 0, 190, [0, '#e58a4a', .6, '#f4c98a', .62, '#33414a', 1, '#1c2428']); g.fillRect(0, 0, w, 190); blob(g, w * .62, 116, 80, 60, 'rgba(255,240,200,1)', .9); carSil(g, w * .46, 168, 1.9, '#141210', { hub: '#3a3530', stripe: '#c9a21f' });
      tx(g, '海湾拖车 2024 月历', w / 2, 20, 14, 'rgba(255,255,255,.9)', { a: 'center' }); g.fillStyle = '#b3241c'; g.fillRect(0, 190, w, 40); tx(g, '十一月  NOVEMBER', w / 2, 211, 20, '#fff', { a: 'center', f: SLAB });
      const D = ['日', '一', '二', '三', '四', '五', '六'], cw = w / 7, y0 = 236; D.forEach((d, i) => tx(g, d, cw * (i + .5), y0 + 12, 14, i === 5 ? '#b3241c' : '#555', { a: 'center' }));
      for (let d = 1; d <= 30; d++) { const i = (d + 4) % 7, j = ((d + 4) / 7) | 0, X = cw * (i + .5), Y = y0 + 44 + j * 34; tx(g, '' + d, X, Y, 16, i === 0 ? '#b3241c' : '#333', { a: 'center', w: 500 }); if (d < 13) { g.strokeStyle = 'rgba(30,40,90,.75)'; g.lineWidth = 2; g.beginPath(); g.moveTo(X - 9, Y + 8); g.lineTo(X + 9, Y - 9); g.stroke(); } }
      const fx = cw * 5.5, fy = y0 + 44 + 2 * 34; g.strokeStyle = '#c0201a'; g.lineWidth = 4; g.beginPath(); g.ellipse(fx, fy, 21, 17, -.2, 0, TAU * 1.08); g.stroke(); g.beginPath(); g.ellipse(fx + 1, fy + 1, 24, 19, .15, 0, TAU); g.stroke(); tx(g, 'FRIDAY!', fx - 6, fy + 31, 16, '#c0201a', { f: HAND, a: 'center', rot: -.12 }); g.beginPath(); g.moveTo(fx - 60, fy + 58); g.lineTo(fx - 22, fy + 22); g.stroke(); tx(g, '交钱', fx - 84, fy + 66, 20, '#c0201a', { f: HAND, a: 'center' });
      g.fillStyle = '#222'; for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(14 + i * 26.5, 5, 4, 0, TAU); g.fill(); } age(g, w, h, 'cal', .6); });
    // ---- car magazines
    [['V8 周刊', '#b3241c', '#f4d35e', '四百匹！老肌肉车复活记'], ['改装街', '#16324f', '#f2a65a', '夜跑海滨公路 · 实测'], ['TORQUE 扭力', '#e9e2d0', '#1d1d1f', '化油器还是电喷？'], ['热轮 HOT LAP', '#2b6e63', '#f5efe0', '特技车手的秘密']].forEach((m, i) => cell('mag' + i, 240, 312, (g, w, h) => {
      g.fillStyle = m[1]; g.fillRect(0, 0, w, h); g.fillStyle = grad(g, 0, h * .3, 0, h, [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,.45)']); g.fillRect(0, 0, w, h); blob(g, w * .5, h * .58, 150, 70, 'rgba(255,255,255,1)', .22);
      tx(g, m[0], w / 2, 40, 44, m[2], { a: 'center', f: SLAB, max: w * .9 }); carSil(g, w * .5, h * .7, 1.9, i === 2 ? '#b3241c' : '#111', { glass: 'rgba(160,200,220,.7)', hub: '#bbb', stripe: i === 3 ? '#f5efe0' : null, flip: i % 2 });
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(w * .5, h * .7, 96, 6, 0, 0, TAU); g.fill(); tx(g, m[3], w / 2, h * .82, 17, '#fff', { a: 'center', max: w * .9, ol: 'rgba(0,0,0,.5)' }); tx(g, '另：二手车避坑 12 条', 12, h * .9, 12, m[2]); tx(g, '$4.99', w - 12, h * .95, 12, '#fff', { a: 'right' });
      g.fillStyle = '#fff'; g.fillRect(12, h * .93, 44, 16); for (let b = 0; b < 14; b++) { g.fillStyle = '#111'; g.fillRect(14 + b * 3, h * .93 + 2, 1 + (b * 7 % 3) * .6, 12); } age(g, w, h, 'mag' + i, .8); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 0, 5, h); }));
    // ---- takeaway + pizza boxes, receipts, shoebox, jacket patch, sticky note
    cell('wok', 224, 224, (g, w, h) => { g.fillStyle = '#efe9da'; g.fillRect(0, 0, w, h); g.strokeStyle = '#b3241c'; g.lineWidth = 5; g.strokeRect(12, 12, w - 24, h - 24); g.beginPath(); g.arc(w / 2, h * .42, 46, PI, TAU); g.stroke(); for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(w / 2 - 36 + i * 18, h * .42 - 30 - (i % 2) * 6); g.quadraticCurveTo(w / 2 - 30 + i * 18, h * .42 - 52, w / 2 - 38 + i * 18, h * .42 - 66); g.stroke(); }
      tx(g, '龙记外卖', w / 2, h * .62, 34, '#b3241c', { a: 'center', f: SLAB }); tx(g, 'DRAGON WOK', w / 2, h * .76, 16, '#b3241c', { a: 'center' }); tx(g, '谢谢惠顾 THANK YOU', w / 2, h * .87, 11, '#b3241c', { a: 'center' }); blob(g, w * .7, h * .3, 50, 40, 'rgba(160,110,30,1)', .35); blob(g, w * .25, h * .75, 30, 34, 'rgba(160,110,30,1)', .3); });
    cell('pizza', 320, 320, (g, w, h) => { g.fillStyle = '#b08a58'; g.fillRect(0, 0, w, h); for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(90,60,30,.12)'; g.fillRect(0, i * 5.4, w, 1.2); } g.fillStyle = '#a3201a'; g.beginPath(); g.arc(w / 2, h * .46, 92, 0, TAU); g.fill(); g.fillStyle = '#b08a58'; g.beginPath(); g.arc(w / 2, h * .46, 78, 0, TAU); g.fill();
      g.fillStyle = '#a3201a'; g.beginPath(); g.moveTo(w / 2, h * .46); g.arc(w / 2, h * .46, 70, -.5, .5); g.fill(); tx(g, '卢叔披萨', w / 2, h * .46, 30, '#3a1a10', { a: 'center', f: SLAB }); tx(g, "UNCLE LU'S · 24H", w / 2, h * .86, 20, '#a3201a', { a: 'center', f: SLAB }); tx(g, '热！HOT & FRESH*', w / 2, h * .1, 15, '#a3201a', { a: 'center' }); tx(g, '*大概', w - 14, h * .95, 10, '#a3201a', { a: 'right' }); blob(g, w * .3, h * .7, 60, 50, 'rgba(70,40,10,1)', .4); blob(g, w * .76, h * .28, 40, 44, 'rgba(70,40,10,1)', .3); });
    cell('pizzaIn', 320, 320, (g, w, h) => { g.fillStyle = '#a98352'; g.fillRect(0, 0, w, h); blob(g, w / 2, h / 2, 150, 150, 'rgba(90,50,10,1)', .5); const sl = a => { g.save(); g.translate(w * .5, h * .52); g.rotate(a); g.fillStyle = '#c99a50'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 128, -.36, .36); g.fill(); g.fillStyle = '#d8b04a'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 112, -.33, .33); g.fill(); for (const [pr, pa] of [[50, -.1], [84, .15], [92, -.2], [66, .2]]) ell(g, cos(pa) * pr, sin(pa) * pr, 11, 11, '#a3301e'); g.restore(); };
      sl(.4); sl(1.35); const r = GT.rng('crumb'); for (let i = 0; i < 90; i++) ell(g, r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2, r() < .5 ? '#c99a50' : '#7a4a20'); });
    cell('receipt', 144, 320, (g, w, h) => { g.fillStyle = '#f3f1ea'; g.fillRect(0, 0, w, h); tx(g, '加油站便利店', w / 2, 20, 14, '#333', { a: 'center' }); tx(g, 'SUNDOWN FUEL', w / 2, 38, 10, '#444', { a: 'center' }); lines(g, 10, 56, w - 20, 13, 14, 'rgba(50,50,60,.6)', 7); tx(g, '合计  $ 41.07', 10, 250, 13, '#222'); tx(g, '现金  $ 45.00', 10, 268, 11, '#444'); for (let b = 0; b < 30; b++) { g.fillStyle = '#222'; g.fillRect(14 + b * 4, 286, 1 + (b * 5 % 3), 22); } age(g, w, h, 'rc', .5); });
    cell('shoebox', 288, 144, (g, w, h) => { g.fillStyle = '#a3643a'; g.fillRect(0, 0, w, h); g.fillStyle = '#efe6cf'; g.fillRect(10, 14, 112, 80); tx(g, 'STRIDE', 66, 40, 22, '#222', { a: 'center', f: SLAB }); tx(g, 'US 10.5 · 棕', 66, 68, 12, '#333', { a: 'center' }); tx(g, '收据', 196, 52, 44, '#111', { f: HAND, a: 'center', rot: -.06 }); tx(g, 'RECEIPTS 别扔', 198, 104, 17, '#111', { f: HAND, a: 'center', rot: -.04 }); age(g, w, h, 'sb', 1); });
    cell('patch', 288, 208, (g, w, h) => { g.fillStyle = '#24324a'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8a21c'; g.beginPath(); g.ellipse(w / 2, h / 2, 132, 90, 0, 0, TAU); g.fill(); g.fillStyle = '#1a2436'; g.beginPath(); g.ellipse(w / 2, h / 2, 122, 81, 0, 0, TAU); g.fill();
      tx(g, '海湾拖车', w / 2, h * .34, 40, '#e9e2d0', { a: 'center', f: SLAB }); tx(g, 'GULF COAST TOWING', w / 2, h * .56, 18, '#d8a21c', { a: 'center', f: SLAB }); g.strokeStyle = '#e9e2d0'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(w * .36, h * .7); g.lineTo(w * .58, h * .7); g.arc(w * .58, h * .76, 12, -HP, HP * 1.6); g.stroke(); tx(g, '24H', w * .7, h * .76, 20, '#e9e2d0', { a: 'center', f: SLAB });
      const r = GT.rng('patch'); for (let i = 0; i < 700; i++) { g.fillStyle = 'rgba(20,28,44,' + (.25 + r() * .4) + ')'; g.fillRect(r() * w, r() * h, 2 + r() * 3, 1); } });
    cell('note', 256, 208, drawNote);
    // ---- race poster
    cell('poster', 352, 480, (g, w, h) => { g.fillStyle = grad(g, 0, 0, 0, h, [0, '#1b1634', .45, '#a8324a', .62, '#f08a3c', .63, '#16121a', 1, '#0a080c']); g.fillRect(0, 0, w, h); blob(g, w * .5, h * .62, 190, 70, 'rgba(255,220,150,1)', .8);
      for (let i = 0; i < 9; i++) { g.strokeStyle = 'rgba(255,200,120,.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(w * .5, h * .63); g.lineTo(w * (i / 8) * 1.6 - w * .3, h); g.stroke(); }
      carSil(g, w * .5, h * .78, 2.9, '#0c0a0e', { glass: 'rgba(255,170,90,.5)', hub: '#55504a', stripe: '#e9e2d0' }); tx(g, '27', w * .52, h * .715, 30, '#e9e2d0', { a: 'center', f: SLAB });
      tx(g, 'CORAL 500', w / 2, 58, 62, '#f4d35e', { a: 'center', f: SLAB, max: w * .9, ol: '#1b1634' }); tx(g, '珊瑚海岸 · 夜间耐力赛', w / 2, 108, 22, '#fff', { a: 'center' }); tx(g, '八月十六 · 海滨赛道 · 门票 $12', w / 2, h - 34, 17, '#f4d35e', { a: 'center' }); tx(g, '车手 · 凯 "不刹车" 陈', w / 2, h - 62, 20, '#fff', { a: 'center', f: SLAB, max: w * .9 });
      g.fillStyle = 'rgba(240,226,190,.22)'; g.fillRect(0, 0, w, h); age(g, w, h, 'poster', 1.3); for (const [fx, fy] of [[.3, 0], [.7, 0]]) { g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, h * (.33 + fy)); g.lineTo(w, h * (.335 + fy)); g.moveTo(0, h * .67); g.lineTo(w, h * .665); g.stroke(); }
      for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) { g.save(); g.translate(cx, cy); g.rotate(PI / 4); g.fillStyle = 'rgba(232,222,186,.85)'; g.fillRect(-36, -11, 72, 22); g.restore(); } });
    // ---- wall clock (stopped), microwave, fridge labels, cereal, keypad, AC panel, plaques, plates, cards
    cell('clock', 224, 224, (g, w, h) => { g.fillStyle = '#e9e4d4'; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, TAU); g.fill(); for (let i = 0; i < 60; i++) { const a = i / 60 * TAU, r0 = i % 5 ? 98 : 88; g.strokeStyle = '#222'; g.lineWidth = i % 5 ? 1.5 : 4; g.beginPath(); g.moveTo(w / 2 + sin(a) * r0, h / 2 - cos(a) * r0); g.lineTo(w / 2 + sin(a) * 104, h / 2 - cos(a) * 104); g.stroke(); }
      for (let i = 1; i <= 12; i++) tx(g, '' + i, w / 2 + sin(i / 12 * TAU) * 74, h / 2 - cos(i / 12 * TAU) * 74, 20, '#222', { a: 'center' }); tx(g, 'SUNDOWN FUEL', w / 2, h * .66, 10, '#b3241c', { a: 'center' }); const hand = (a, L, lw, c) => { g.strokeStyle = c; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); g.moveTo(w / 2 - sin(a) * 10, h / 2 + cos(a) * 10); g.lineTo(w / 2 + sin(a) * L, h / 2 - cos(a) * L); g.stroke(); };
      hand(4.78 / 12 * TAU, 50, 7, '#222'); hand(47 / 60 * TAU, 78, 4.5, '#222'); hand(.31 * TAU, 84, 1.5, '#b3241c'); ell(g, w / 2, h / 2, 6, 6, '#222'); blob(g, w * .3, h * .3, 90, 90, 'rgba(160,130,70,1)', .25); });
    cell('micro', 352, 208, (g, w, h) => { g.fillStyle = '#d8d2c0'; g.fillRect(0, 0, w, h); g.fillStyle = '#17181a'; rr(g, 12, 14, 236, 180, 8); g.fill(); g.fillStyle = grad(g, 12, 14, 248, 194, [0, 'rgba(120,130,140,.3)', .5, 'rgba(20,22,24,0)', 1, 'rgba(90,100,110,.16)']); rr(g, 24, 26, 212, 156, 5); g.fill(); for (let y = 30; y < 180; y += 5) for (let x = 28 + (y % 10 ? 2.5 : 0); x < 232; x += 5) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(x, y, 2, 2); }
      g.fillStyle = '#0c1410'; g.fillRect(262, 18, 78, 30); tx(g, '12:00', 301, 34, 22, '#38e070', { a: 'center', f: 'monospace' }); for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) { g.fillStyle = '#c4bda8'; rr(g, 264 + i * 26, 58 + j * 26, 22, 22, 3); g.fill(); tx(g, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '解冻', '0', '开'][j * 3 + i], 275 + i * 26, 70 + j * 26, 9, '#333', { a: 'center' }); } g.fillStyle = '#b3241c'; rr(g, 264, 166, 74, 26, 4); g.fill(); tx(g, '启动', 301, 180, 12, '#fff', { a: 'center' }); blob(g, 60, 190, 80, 30, 'rgba(120,90,40,1)', .3); });
    cell('labels', 384, 256, (g, w, h) => { g.fillStyle = '#e9f0f2'; g.fillRect(0, 0, 96, 256); g.fillStyle = '#2a6fb0'; g.fillRect(0, 60, 96, 110); tx(g, '牛奶', 48, 100, 30, '#fff', { a: 'center', f: SLAB }); tx(g, 'MILK 2%', 48, 138, 15, '#fff', { a: 'center' }); tx(g, '保质期：前天', 48, 206, 10, '#b3241c', { a: 'center' });
      g.fillStyle = '#b3241c'; g.fillRect(100, 0, 92, 128); tx(g, '辣', 146, 46, 50, '#f4d35e', { a: 'center', f: SLAB }); tx(g, 'XXX 魔鬼辣酱', 146, 96, 11, '#fff', { a: 'center' }); g.fillStyle = '#d8a21c'; g.fillRect(100, 132, 92, 124); g.fillStyle = '#16324f'; g.fillRect(100, 168, 92, 46); tx(g, 'CAYO', 146, 184, 22, '#fff', { a: 'center', f: SLAB }); tx(g, '海岛啤酒', 146, 204, 11, '#f4d35e', { a: 'center' });
      g.fillStyle = '#f4f1e6'; g.fillRect(196, 0, 188, 128); tx(g, '炒面 · 周二', 290, 44, 26, '#1b2a5a', { a: 'center', f: HAND }); tx(g, '(也可能是周一)', 290, 84, 16, '#1b2a5a', { a: 'center', f: HAND }); g.fillStyle = '#c0261c'; g.fillRect(196, 132, 92, 124); tx(g, '番茄酱', 242, 180, 22, '#fff', { a: 'center', f: SLAB }); tx(g, 'KETCHUP', 242, 208, 12, '#fff', { a: 'center' }); g.fillStyle = '#1f7a4a'; g.fillRect(292, 132, 92, 124); tx(g, '青柠苏打', 338, 180, 18, '#fff', { a: 'center', f: SLAB }); tx(g, 'LIME FIZZ', 338, 208, 12, '#e9f08a', { a: 'center' }); });
    cell('cereal', 208, 288, (g, w, h) => { g.fillStyle = '#e2a21c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 12; i++) { g.save(); g.translate(w / 2, h * .62); g.rotate(i / 12 * TAU); g.fillStyle = i % 2 ? '#f4d35e' : '#e98a1c'; g.beginPath(); g.moveTo(0, 0); g.lineTo(-40, -260); g.lineTo(40, -260); g.fill(); g.restore(); }
      tx(g, '脆圈圈', w / 2, 46, 46, '#b3241c', { a: 'center', f: SLAB, ol: '#fff' }); tx(g, "CRUNCH-O's", w / 2, 88, 22, '#16324f', { a: 'center', f: SLAB }); ell(g, w / 2, h * .66, 74, 40, '#e9e2d0'); ell(g, w / 2, h * .64, 62, 28, '#f6f3ea'); const r = GT.rng('cer'); for (let i = 0; i < 16; i++) { g.strokeStyle = '#c98a3a'; g.lineWidth = 5; g.beginPath(); g.arc(w / 2 - 48 + r() * 96, h * .64 - 16 + r() * 28, 7, 0, TAU); g.stroke(); } tx(g, '含 9 种必需糖', w / 2, h - 22, 13, '#fff', { a: 'center' }); age(g, w, h, 'cereal', .5); });
    cell('keypad', 128, 208, (g, w, h) => { g.fillStyle = '#cfc7ae'; g.fillRect(0, 0, w, h); for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) { g.fillStyle = '#e6dfca'; rr(g, 14 + i * 36, 22 + j * 36, 28, 26, 4); g.fill(); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke(); tx(g, '123456789*0#'[j * 3 + i], 28 + i * 36, 36 + j * 36, 15, '#333', { a: 'center' }); } g.fillStyle = '#f1ecdc'; g.fillRect(14, 170, 100, 26); tx(g, '前台 0 · 外线 9', 64, 183, 10, '#333', { a: 'center' }); blob(g, 64, 80, 70, 90, 'rgba(110,84,40,1)', .22); });
    cell('acpanel', 320, 80, (g, w, h) => { g.fillStyle = '#b9b19a'; g.fillRect(0, 0, w, h); tx(g, 'POLAR-AIRE', 14, 20, 15, '#3a3a3a', { f: SLAB }); tx(g, '8000 BTU', 14, 40, 10, '#555'); for (const [cx, lab] of [[170, '风量 FAN'], [262, '温度 COOL']]) { ell(g, cx, 36, 24, 24, '#8a836e'); ell(g, cx, 36, 19, 19, '#2a2a2c'); g.strokeStyle = '#e6dfca'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, 36); g.lineTo(cx + 12, 24); g.stroke(); tx(g, lab, cx, 70, 9, '#333', { a: 'center' }); } tx(g, '关 · 低 · 高', 100, 62, 9, '#444', { a: 'center' }); blob(g, 220, 40, 120, 40, 'rgba(90,70,30,1)', .25); });
    cell('plaque', 256, 160, (g, w, h) => { const P = [['冠军 1ST', "珊瑚 500 · '11"], ['最佳特技', "火轮队 · '09"], ['第二名', '码头直线赛'], ['参与奖', '拖车技能大赛']]; P.forEach((p, i) => { const y = i * 40; g.fillStyle = grad(g, 0, y, 0, y + 38, [0, '#d9b65a', .5, '#f0d88a', 1, '#a8822e']); g.fillRect(0, y, w, 38); tx(g, p[0], 10, y + 13, 15, '#2a1c08', { f: SLAB }); tx(g, p[1], 10, y + 29, 11, '#3a2a10'); }); });
    cell('plate', 256, 128, (g, w, h) => { g.fillStyle = '#e9e4d0'; rr(g, 0, 0, w, h, 10); g.fill(); g.fillStyle = grad(g, 0, 0, 0, h, [0, 'rgba(238,128,52,.8)', .35, 'rgba(244,190,110,0)', 1, 'rgba(70,150,160,.45)']); g.fillRect(0, 0, w, h); tx(g, 'CORAL COAST', w / 2, 20, 16, '#1c3566', { a: 'center' }); tx(g, 'KAI 27', w / 2, 70, 58, '#1c3566', { a: 'center', f: SLAB }); tx(g, 'the sundown state', w / 2, 112, 12, '#1c3566', { a: 'center', w: 500 }); age(g, w, h, 'plate', 1.2); for (const bx of [22, w - 22]) ell(g, bx, 18, 5, 5, '#777'); });
    cell('rates', 224, 304, (g, w, h) => { g.fillStyle = '#efe9d6'; g.fillRect(0, 0, w, h); g.fillStyle = '#2b6e63'; g.fillRect(0, 0, w, 44); tx(g, '珊瑚彗星旅馆', w / 2, 16, 16, '#fff', { a: 'center' }); tx(g, 'THE CORAL COMET', w / 2, 34, 10, '#cfe8e0', { a: 'center' }); tx(g, '退房 11:00 · 概不退款', 12, 62, 12, '#333'); tx(g, '日租 $49 · 周租 $240', 12, 82, 12, '#333'); g.strokeStyle = '#333'; g.lineWidth = 1.5; g.strokeRect(22, 104, 180, 120); for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(22 + i * 30, 104); g.lineTo(22 + i * 30, 150); g.stroke(); } g.fillStyle = '#c0261c'; g.fillRect(142, 106, 30, 44); tx(g, '你在这', 157, 164, 10, '#c0261c', { a: 'center' }); g.strokeStyle = '#c0261c'; g.lineWidth = 3; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(157, 172); g.lineTo(157, 206); g.lineTo(40, 206); g.stroke(); g.setLineDash([]); tx(g, '火警逃生路线 FIRE EXIT', w / 2, 240, 11, '#333', { a: 'center' }); lines(g, 12, 256, w - 24, 3, 11, 'rgba(40,40,50,.5)', 9); age(g, w, h, 'rates', 1.1); });
    cell('dnd', 112, 256, (g, w, h) => { g.fillStyle = '#b3241c'; rr(g, 0, 0, w, h, 12); g.fill(); g.fillStyle = '#8a8478'; g.beginPath(); g.arc(w / 2, 44, 24, 0, TAU); g.fill(); g.fillRect(w / 2 - 8, 0, 16, 40); tx(g, '请勿', w / 2, 112, 32, '#fff', { a: 'center', f: SLAB }); tx(g, '打扰', w / 2, 152, 32, '#fff', { a: 'center', f: SLAB }); tx(g, 'DO NOT', w / 2, 198, 15, '#f4d35e', { a: 'center' }); tx(g, 'DISTURB', w / 2, 218, 15, '#f4d35e', { a: 'center' }); age(g, w, h, 'dnd', .6); });
    cell('num', 192, 96, (g, w, h) => { g.fillStyle = grad(g, 0, 0, 0, h, [0, '#d9bf78', .5, '#f0dc9a', 1, '#a88a3e']); g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(60,40,10,.6)'; g.lineWidth = 3; g.strokeRect(5, 5, w - 10, h - 10); tx(g, '' + ROOM, w / 2, h / 2 + 3, 66, '#241a0a', { a: 'center', f: SLAB }); for (const bx of [14, w - 14]) ell(g, bx, h / 2, 4, 4, '#6a5220'); });
    cell('sticker', 320, 96, (g, w, h) => { g.fillStyle = '#f1efe8'; rr(g, 0, 0, w, h, 10); g.fill(); g.fillStyle = '#16324f'; rr(g, 6, 6, w - 12, h - 12, 7); g.fill(); tx(g, '我的另一辆车', w / 2, 32, 24, '#f4d35e', { a: 'center', f: SLAB }); tx(g, '也是拖回来的', w / 2, 66, 24, '#fff', { a: 'center', f: SLAB }); age(g, w, h, 'stk', .7); });
    cell('vcr', 352, 80, (g, w, h) => { g.fillStyle = '#18191b'; g.fillRect(0, 0, w, h); g.fillStyle = '#0a0a0b'; g.fillRect(14, 12, 196, 30); g.strokeStyle = '#333'; g.strokeRect(14, 12, 196, 30); g.fillStyle = '#0c1410'; g.fillRect(228, 12, 84, 30); tx(g, '12:00', 270, 28, 22, '#3ad0e0', { a: 'center', f: 'monospace' }); for (let i = 0; i < 6; i++) { g.fillStyle = '#2a2b2e'; rr(g, 16 + i * 30, 54, 24, 14, 3); g.fill(); } tx(g, 'VIDSTAR HQ', 250, 62, 11, '#888'); ell(g, 330, 60, 4, 4, '#c22'); });
    cell('vhs', 288, 112, (g, w, h) => { ['比赛 03 / 珊瑚500', '特技合集（别洗）', '阿烈生日', '空白'].forEach((s, i) => { const y = i * 28; g.fillStyle = '#141416'; g.fillRect(0, y, w, 26); g.fillStyle = ['#f1ecdc', '#f6e7a8', '#f1ecdc', '#e8ddc0'][i]; g.fillRect(40, y + 4, w - 80, 18); tx(g, s, w / 2, y + 13, 14, '#1b2a5a', { f: HAND, a: 'center' }); }); });
    cell('shower', 512, 512, (g, w, h) => { g.fillStyle = '#d9dfd8'; g.fillRect(0, 0, w, h); const r = GT.rng('shower'); for (let j = 0; j < 5; j++) for (let i = 0; i < 4; i++) { const X = i * 128 + (j % 2 ? 64 : 0) + 30, Y = j * 104 + 40, k = (i + j) % 3; g.save(); g.translate(X, Y); g.rotate((r() - .5) * .6);
        if (k === 0) { g.fillStyle = '#4f9a94'; g.beginPath(); g.ellipse(0, 0, 30, 14, 0, 0, TAU); g.fill(); g.beginPath(); g.moveTo(-26, 0); g.lineTo(-48, -14); g.lineTo(-48, 14); g.fill(); ell(g, 16, -3, 3, 3, '#fff'); }
        else if (k === 1) { g.fillStyle = '#e09a6a'; for (let a = 0; a < 5; a++) { g.save(); g.rotate(a / 5 * TAU); g.beginPath(); g.moveTo(-7, 0); g.lineTo(0, -32); g.lineTo(7, 0); g.fill(); g.restore(); } }
        else { g.strokeStyle = '#7fb6c8'; g.lineWidth = 4; for (let a = 0; a < 3; a++) { g.beginPath(); g.arc(0, a * 9 - 9, 22 - a * 5, PI * 1.1, PI * 1.9); g.stroke(); } } g.restore(); }
      g.fillStyle = grad(g, 0, h * .55, 0, h, [0, 'rgba(60,70,40,0)', .7, 'rgba(60,70,40,.28)', 1, 'rgba(40,44,24,.6)']); g.fillRect(0, 0, w, h); for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(30,34,20,' + r() * .5 + ')'; const y = h - r() * r() * 150; g.fillRect(r() * w, y, 1 + r() * 3, 1 + r() * 3); } g.fillStyle = 'rgba(255,255,255,.1)'; for (let i = 0; i < 9; i++) g.fillRect(i * 60 + 10, 0, 12, h); });
    cell('towel', 160, 320, (g, w, h) => { g.fillStyle = '#d6d0c0'; g.fillRect(0, 0, w, h); for (const y of [30, 46, h - 60, h - 44]) { g.fillStyle = '#4f8a8a'; g.fillRect(0, y, w, 9); } tx(g, 'CORAL COMET', w / 2, h / 2, 13, 'rgba(60,110,110,.6)', { a: 'center' }); const r = GT.rng('tw'); for (let i = 0; i < 1800; i++) { g.fillStyle = 'rgba(255,255,255,' + r() * .14 + ')'; g.fillRect(r() * w, r() * h, 2, 2); } blob(g, w * .6, h * .7, 60, 50, 'rgba(120,100,60,1)', .25); });
    cell('rug', 288, 192, (g, w, h) => { g.fillStyle = '#4f7a78'; g.fillRect(0, 0, w, h); const r = GT.rng('rug'); for (let i = 0; i < 5000; i++) { g.fillStyle = r() < .5 ? 'rgba(20,40,40,.3)' : 'rgba(170,210,200,.2)'; g.fillRect(r() * w, r() * h, 2, 3 + r() * 3); } blob(g, w * .4, h * .5, 80, 60, 'rgba(40,30,20,1)', .3); g.strokeStyle = 'rgba(200,220,210,.5)'; g.lineWidth = 6; g.strokeRect(12, 12, w - 24, h - 24); });
    cell('scratch', 224, 128, (g, w, h) => { g.fillStyle = '#e9a21c'; g.fillRect(0, 0, w, h); tx(g, '金热浪 刮刮乐', w / 2, 20, 18, '#b3241c', { a: 'center', f: SLAB }); for (let i = 0; i < 3; i++) { g.fillStyle = i < 2 ? '#e9e2d0' : '#9a9a9a'; rr(g, 16 + i * 66, 40, 58, 44, 6); g.fill(); if (i < 2) tx(g, ['$0', '再来'][i], 45 + i * 66, 62, 18, '#333', { a: 'center' }); } tx(g, '头奖 $50,000 · 今天不是你', w / 2, 106, 11, '#3a1a10', { a: 'center' }); });
    cell('polaroid', 320, 128, (g, w, h) => { for (let i = 0; i < 3; i++) { const x = i * 106; g.fillStyle = '#f2efe6'; g.fillRect(x, 0, 100, 124); g.fillStyle = grad(g, 0, 8, 0, 92, [0, ['#e08a4a', '#5a7fa0', '#3a3a50'][i], 1, ['#f6dca4', '#cfe0e8', '#a8324a'][i]]); g.fillRect(x + 8, 8, 84, 84); if (i === 0) carSil(g, x + 50, 84, .66, '#141210'); else if (i === 1) { person(g, x + 36, 92, .6, { col: '#141414', r: 'up' }); person(g, x + 62, 92, .54, { col: '#141414', hair: true, l: 'up' }); } else person(g, x + 50, 92, .64, { col: '#0c0c10', l: 'cross', r: 'cross', hat: true }); tx(g, ['第一辆车', '迈阿密 08', '队长'][i], x + 50, 108, 12, '#333', { f: HAND, a: 'center' }); } });
    cell('envelope', 288, 160, (g, w, h) => { g.fillStyle = '#efeadb'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,.15)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(w / 2, h * .5); g.lineTo(w, 0); g.stroke(); g.fillStyle = '#fff'; g.fillRect(28, 70, 150, 52); lines(g, 36, 82, 130, 3, 12, 'rgba(40,40,50,.6)', 11); g.save(); g.translate(204, 44); g.rotate(-.12); g.strokeStyle = '#c0261c'; g.lineWidth = 3; g.strokeRect(-70, -18, 140, 36); tx(g, '最后通知 FINAL', 0, 1, 15, '#c0261c', { a: 'center', f: SLAB }); g.restore(); age(g, w, h, 'env', .8); });
    cell('switch', 96, 144, (g, w, h) => { g.fillStyle = '#d6cfb8'; rr(g, 0, 0, w, h, 8); g.fill(); g.fillStyle = '#b8b09a'; g.fillRect(34, 46, 28, 52); g.fillStyle = '#e6dfca'; g.fillRect(38, 50, 20, 22); for (const y of [16, h - 16]) ell(g, w / 2, y, 5, 5, '#8a836e'); blob(g, w / 2, 100, 46, 50, 'rgba(70,50,30,1)', .4); });
    cell('outlet', 96, 144, (g, w, h) => { g.fillStyle = '#d6cfb8'; rr(g, 0, 0, w, h, 8); g.fill(); for (const y of [44, 100]) { g.fillStyle = '#c4bca4'; rr(g, 24, y - 22, 48, 44, 10); g.fill(); g.fillStyle = '#2a2a2a'; g.fillRect(36, y - 10, 4, 14); g.fillRect(56, y - 10, 4, 14); g.beginPath(); g.arc(48, y + 12, 4, 0, TAU); g.fill(); } ell(g, w / 2, 72, 4, 4, '#8a836e'); });
    cell('soap', 160, 128, (g, w, h) => { g.fillStyle = '#2b6e63'; g.fillRect(0, 0, 80, h); tx(g, '洗发水', 40, 50, 18, '#fff', { a: 'center' }); tx(g, '椰子味', 40, 76, 12, '#cfe8e0', { a: 'center' }); g.fillStyle = '#e9e2d0'; g.fillRect(80, 0, 80, h); tx(g, '剃须膏', 120, 50, 18, '#16324f', { a: 'center' }); tx(g, 'CLASSIC', 120, 76, 11, '#b3241c', { a: 'center' }); });
    cell('menu', 192, 288, (g, w, h) => { g.fillStyle = '#f6e7a8'; g.fillRect(0, 0, w, h); g.fillStyle = '#b3241c'; g.fillRect(0, 0, w, 56); tx(g, '卢叔披萨', w / 2, 22, 22, '#fff', { a: 'center', f: SLAB }); tx(g, '外送菜单 · 24H', w / 2, 44, 11, '#f6e7a8', { a: 'center' }); ['大号芝士 ..... $9', '夏威夷(别问) $11', '全肉 ........ $13', '辣翅 12 只 ... $8', '可乐 2L ...... $3'].forEach((s, i) => tx(g, s, 12, 80 + i * 26, 13, '#3a1a10')); g.strokeStyle = '#1b2a5a'; g.lineWidth = 2.5; g.beginPath(); g.ellipse(84, 132, 78, 14, 0, 0, TAU); g.stroke(); tx(g, '☎ 555-0117', w / 2, 232, 18, '#b3241c', { a: 'center', f: SLAB }); tx(g, '第 10 张免费', w / 2, 262, 12, '#3a1a10', { a: 'center' }); age(g, w, h, 'menu', .8); });
    cell('led', 160, 64, (g, w, h) => { g.fillStyle = '#0a0606'; g.fillRect(0, 0, w, h); g.shadowColor = '#ff2a14'; g.shadowBlur = 8; tx(g, '4:47', w / 2, h / 2 + 2, 46, '#ff3a20', { a: 'center', f: "'Courier New',monospace" }); g.shadowBlur = 0; });
    A.tex = new T.CanvasTexture(A.c); A.tex.encoding = T.sRGBEncoding; A.tex.anisotropy = 8;
  }
  function redrawNote() { const R = AT.R.note; if (!R || !AT.tex) return; const p = R.px, g = AT.g; g.save(); g.beginPath(); g.rect(p[0], p[1], p[2], p[3]); g.clip(); g.translate(p[0], p[1]); drawNote(g, p[2], p[3]); g.restore(); AT.tex.needsUpdate = true; }

  /* ================================================================== other canvases: quilt, carpet wear, window backdrops, light shafts */
  function quiltTex() { const S_ = 1024, c = document.createElement('canvas'); c.width = c.height = S_; const g = c.getContext('2d'), r = GT.rng('quilt'), n = 8, cs = S_ / n, pal = ['#b8674a', '#c9a04e', '#5f8f88', '#d8ccb0', '#8a4a3e', '#a8b89a', '#6f7f9a'];
    g.fillStyle = '#cdbf9e'; g.fillRect(0, 0, S_, S_);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const X = i * cs, Y = j * cs, a = pal[(i * 3 + j * 5) % pal.length], b = pal[(i * 2 + j * 3 + 3) % pal.length]; g.fillStyle = (i + j) % 2 ? '#d6cab0' : '#c9bc9c'; g.fillRect(X, Y, cs, cs);
      g.save(); g.translate(X + cs / 2, Y + cs / 2); g.fillStyle = a; g.beginPath(); g.moveTo(0, -cs * .46); g.lineTo(cs * .46, 0); g.lineTo(0, cs * .46); g.lineTo(-cs * .46, 0); g.fill(); g.fillStyle = b; g.beginPath(); g.moveTo(0, -cs * .25); g.lineTo(cs * .25, 0); g.lineTo(0, cs * .25); g.lineTo(-cs * .25, 0); g.fill();
      if ((i + j) % 3 === 0) { g.fillStyle = '#d8ccb0'; for (let p = 0; p < 4; p++) { g.rotate(HP); g.beginPath(); g.ellipse(0, -cs * .12, cs * .035, cs * .09, 0, 0, TAU); g.fill(); } } g.restore();
      g.strokeStyle = 'rgba(250,244,226,.7)'; g.lineWidth = 2; g.setLineDash([6, 5]); g.strokeRect(X + 5, Y + 5, cs - 10, cs - 10); g.beginPath(); g.moveTo(X + cs / 2, Y + cs * .07); g.lineTo(X + cs * .93, Y + cs / 2); g.lineTo(X + cs / 2, Y + cs * .93); g.lineTo(X + cs * .07, Y + cs / 2); g.closePath(); g.stroke(); g.setLineDash([]); }
    g.fillStyle = 'rgba(214,196,160,.3)'; g.fillRect(0, 0, S_, S_);                                           // washed out
    for (let i = 0; i < 26000; i++) { g.fillStyle = r() < .5 ? 'rgba(255,250,235,.09)' : 'rgba(50,36,24,.09)'; g.fillRect(r() * S_, r() * S_, 1 + r() * 2, 1 + r() * 4); }
    for (let i = 0; i < 9; i++) blob(g, r() * S_, r() * S_, 60 + r() * 140, 50 + r() * 110, i % 3 ? 'rgba(96,70,40,1)' : 'rgba(250,240,214,1)', .16);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; }
  /** furniture / wall-panel veneer: continuous vertical grain (the shared wood_plank is short boards, wrong for laminate) */
  function veneerTex() { const w = 512, h = 512, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), r = GT.rng('veneer'); g.fillStyle = '#c4a985'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) { const x = r() * w, ww = 10 + r() * 50; g.fillStyle = 'rgba(' + (r() < .5 ? '96,62,30' : '226,200,160') + ',' + (.05 + r() * .1) + ')'; for (const ox of [0, w, -w]) g.fillRect(x + ox, 0, ww, h); }
    for (let i = 0; i < 1100; i++) { const x = r() * w, f = 1 + ((r() * 3) | 0), ph = r() * TAU, amp = 1 + r() * 5, dark = r() < .8; g.strokeStyle = dark ? 'rgba(70,40,16,' + (.05 + r() * .2) + ')' : 'rgba(240,220,180,' + (.05 + r() * .12) + ')'; g.lineWidth = .5 + r() * 1.6;
      for (const ox of [0, w, -w]) { g.beginPath(); for (let y = 0; y <= h; y += 16) { const X = x + ox + sin(y / h * TAU * f + ph) * amp; if (y) g.lineTo(X, y); else g.moveTo(X, y); } g.stroke(); } }
    for (let i = 0; i < 5; i++) { const x = r() * w, y = r() * h; g.strokeStyle = 'rgba(70,40,16,.16)'; for (let k = 1; k < 7; k++) { g.lineWidth = 1.2; g.beginPath(); g.ellipse(x, y, k * 3.2, k * 15, 0, 0, TAU); g.stroke(); } }
    for (let i = 0; i < 9000; i++) { g.fillStyle = 'rgba(50,30,12,' + r() * .12 + ')'; g.fillRect(r() * w, r() * h, 1, 2 + r() * 5); }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(1 / .7, 1 / 1.4); t.anisotropy = 8; return t; }
  function wearTex() { const w = 512, h = 768, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), r = GT.rng('wear');
    // canvas x: local x -2.1..2.1 ; canvas y: local z +3.25 (top) .. -3.25
    const P = (lx, lz) => [(lx + HW) / (2 * HW) * w, (ZF - lz) / (2 * ZF) * h], path = pts => { g.beginPath(); pts.forEach((p, i) => { const q = P(p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); };
    g.lineCap = g.lineJoin = 'round'; g.filter = 'blur(16px)';
    for (const [col, lw] of [['rgba(196,186,160,.34)', 92], ['rgba(40,34,26,.3)', 46]]) { g.strokeStyle = col; g.lineWidth = lw; path([[1.4, 3.2], [1.3, 2.2], [.9, .6], [.8, -1.2], [.7, -2.6], [.9, -3.3]]); g.stroke(); path([[.8, -2.5], [-.2, -2.85], [-.6, -3.3]]); g.stroke(); path([[1.2, 1.8], [-.2, 2.3], [-.9, 2.5]]); g.stroke(); path([[.8, -.2], [.1, .1], [-.8, .35]]); g.stroke(); }
    g.filter = 'blur(7px)'; for (let i = 0; i < 16; i++) { const q = P((r() - .5) * 3.8, (r() - .5) * 6.2); blob(g, q[0], q[1], 14 + r() * 40, 12 + r() * 34, i % 4 === 0 ? 'rgba(120,60,30,1)' : 'rgba(22,18,14,1)', .22 + r() * .25); }
    const d = P(1.4, 3.05); blob(g, d[0], d[1], 70, 46, 'rgba(24,20,16,1)', .55); const a = P(-.6, 3.0); blob(g, a[0], a[1], 62, 30, 'rgba(60,50,30,1)', .5); g.filter = 'none';
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t; }
  /** what is "outside" the window: the lot at golden hour / at night (two canvases, cross-faded by GT.env.night in the backdrop shader) */
  function backdropTex(night) { const w = 768, h = 512, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), r = GT.rng('lot'), hz = h * .56;
    g.fillStyle = night ? grad(g, 0, 0, 0, hz, [0, '#070a18', .6, '#1a1630', 1, '#3a2040']) : grad(g, 0, 0, 0, hz, [0, '#f2a25a', .45, '#ffc98a', .8, '#ffe6b8', 1, '#fff2d0']); g.fillRect(0, 0, w, hz + 2);
    if (!night) { blob(g, w * .58, hz - 34, 260, 150, 'rgba(255,250,225,1)', 1); ell(g, w * .58, hz - 36, 30, 30, '#fffdf0'); for (let i = 0; i < 6; i++) blob(g, r() * w, h * (.1 + r() * .25), 120 + r() * 100, 12 + r() * 12, 'rgba(255,214,170,1)', .5); }
    else { for (let i = 0; i < 70; i++) { g.fillStyle = 'rgba(255,255,255,' + (.2 + r() * .6) + ')'; g.fillRect(r() * w, r() * hz * .7, 1.5, 1.5); } blob(g, w * .2, hz, 300, 90, 'rgba(255,120,60,1)', .25); }
    const sil = night ? '#06070c' : '#3a2416', sil2 = night ? '#0b0d16' : '#6a4426';
    g.fillStyle = sil2; g.beginPath(); g.moveTo(0, hz); for (let x = 0; x <= w; x += 24) g.lineTo(x, hz - 8 - hsh(x * .37) * 14); g.lineTo(w, hz); g.fill();                    // far tree line across the highway
    for (const [px, ph, pl] of [[.08, .5, 26], [.34, .4, -18], [.82, .56, 30], [.95, .42, -12]]) palm(g, w * px, hz + 6, h * ph, pl, sil, px);
    g.fillStyle = night ? grad(g, 0, hz, 0, h, [0, '#15131c', 1, '#0a0a10']) : grad(g, 0, hz, 0, h, [0, '#c98a4e', .25, '#7a5636', 1, '#3a2c22']); g.fillRect(0, hz, w, h - hz);
    if (!night) { for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(255,226,170,' + (.5 - i * .03) + ')'; g.fillRect(w * .58 - 120 - i * 16, hz + 3 + i * 6, 240 + i * 32, 2 + i * .4); } }
    // motel sign pylon
    const sx = w * .23; g.fillStyle = sil; g.fillRect(sx - 5, hz - 150, 10, 170); g.fillRect(sx - 58, hz - 196, 116, 56); if (night) { blob(g, sx, hz - 168, 150, 80, 'rgba(255,60,150,1)', .55); tx(g, 'CORAL', sx, hz - 180, 24, '#ff5aa8', { a: 'center', f: SLAB }); tx(g, 'COMET', sx, hz - 156, 24, '#5ae0ff', { a: 'center', f: SLAB }); tx(g, 'VACANCY', sx, hz - 128, 11, '#ff7a3a', { a: 'center' }); }
    // parked cars + the walkway post and rail right outside
    carSil(g, w * .47, hz + 50, 2.1, night ? '#0a0b10' : '#2a1a12', { glass: night ? 'rgba(40,60,90,.6)' : 'rgba(255,220,160,.55)', hub: night ? '#1a1c24' : '#5a3c22' }); carSil(g, w * .86, hz + 62, 2.3, night ? '#08090d' : '#22160e', { flip: true, glass: night ? 'rgba(40,50,80,.5)' : 'rgba(255,210,150,.4)' });
    if (night) { blob(g, w * .47, hz + 60, 190, 34, 'rgba(255,80,160,1)', .3); blob(g, w * .7, hz + 110, 230, 44, 'rgba(60,200,255,1)', .18); for (const lx of [.62, .98]) { blob(g, w * lx, hz - 96, 60, 60, 'rgba(255,190,110,1)', .7); ell(g, w * lx, hz - 96, 5, 5, '#ffe2b0'); g.fillStyle = sil; g.fillRect(w * lx - 2, hz - 92, 4, 110); } }
    g.fillStyle = night ? '#040508' : '#1c120c'; g.fillRect(w * .68, 0, 26, h); g.fillRect(0, h * .8, w, 14); for (let x = 10; x < w; x += 34) g.fillRect(x, h * .8, 5, h * .2); g.fillRect(0, h * .97, w, h * .03);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t; }
  function shaftTex() { const w = 256, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), r = GT.rng('shaft'); g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const y = (i + .5) / 26 * h, a = .35 + r() * .65; g.fillStyle = grad(g, 0, 0, w, 0, [0, 'rgba(255,255,255,' + a + ')', .5, 'rgba(255,255,255,' + a * .5 + ')', 1, 'rgba(255,255,255,0)']); g.fillRect(0, y - 2.6, w, 5.2); }
    g.fillStyle = grad(g, 0, 0, 0, h, [0, 'rgba(0,0,0,.9)', .12, 'rgba(0,0,0,0)', .88, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,.9)']); g.fillRect(0, 0, w, h); const t = new T.CanvasTexture(c); return t; }

  /* ================================================================== emissive solids: ONE vertex-coloured unlit mesh, elements recoloured on state changes */
  const EM = { geos: [], els: {}, n: 0, mesh: null };
  function em(name, g, mtx) { if (mtx) g.applyMatrix4(mtx); if (!g.index) { const n = g.attributes.position.count, ix = []; for (let i = 0; i < n; i++) ix.push(i); g.setIndex(ix); } (EM.els[name] = EM.els[name] || []).push([EM.n, g.attributes.position.count]); EM.n += g.attributes.position.count; EM.geos.push(g); }
  const emAt = (g, x, y, z) => { g.translate(x, y, z); return g; };
  function emBuild() { const g = GT.mergeGeos(EM.geos); g.setAttribute('color', new T.BufferAttribute(new Float32Array(EM.n * 3), 3)); const mat = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, fog: false }); EM.mesh = new T.Mesh(g, mat); EM.mesh.name = 'safehouse_emissive'; return EM.mesh; }
  function emSet(name, r, g, b) { const c = EM.mesh.geometry.attributes.color; for (const [o, n] of EM.els[name] || []) for (let i = o; i < o + n; i++) c.setXYZ(i, r, g, b); c.needsUpdate = true; }
  /** box / cylinder whose every face shows one atlas cell (labels, cartons, cans) */
  function abox(k, mat, rect, w, h, d, x, y, z, o) { k.geo(mat, remap(new T.BoxGeometry(w, h, d), rect), Object.assign({ x, y, z }, o || {})); }
  function acyl(k, mat, rect, r, h, x, y, z, o) { k.geo(mat, remap(new T.CylinderGeometry(r, r, h, 14), rect), Object.assign({ x, y, z }, o || {})); }
  const sub = (R, i, n, vert) => vert ? [R[0], R[3] - (R[3] - R[1]) * (i + 1) / n, R[2], R[3] - (R[3] - R[1]) * i / n] : [R[0] + (R[2] - R[0]) * i / n, R[1], R[0] + (R[2] - R[0]) * (i + 1) / n, R[3]];
  const torus = (R_, r, arc, seg) => new T.TorusGeometry(R_, r, 6, seg || 14, arc === undefined ? TAU : arc);

  /* ================================================================== the room */
  function buildRoom() {
    const k = GT.kit(), R = AT.R, dyn = {};
    const m = S.m = {
      wall: M('stucco_cream', 0xcbbf9c),
      white: M('plastic_white', 0xd2cab2, { rough: 1.15, env: .96 }), carpet: M('carpet', 0x53645c), vinyl: M('tile_floor', 0xb7a888, { rough: 1.3 }), tile: M('tile_floor', 0xc9cdc6), tileW: M('tile_floor', 0xd6d2c0, { rough: 1.2 }), ceil: M('ceiling_panel', 0xcfc8b4),
      formica: M('plastic_white', 0xd8c58c, { rough: .7 }), plasW: M('plastic_white', 0xd3caaf), plasB: M('plastic_black'), plasG: M('plastic_grey'), tvB: M('plastic_black', 0x2a2a2c, { rough: 1.2 }), red: M('plastic_red'), foam: M('plastic_white', 0xe9e6dc, { rough: 1.8 }),
      porc: M('plastic_white', 0xe6e4d8, { rough: .4 }), porcIn: M('plastic_white', 0xbdb8a4, { rough: .5 }), enamel: M('plastic_white', 0xe2dccb, { rough: .75, env: .95 }), cream: M('metal_painted_white', 0xd6ccae),
      chrome: M('chrome'), alu: M('aluminium_brushed'), steel: M('aluminium_brushed', 0x8a8d90), dark: M('metal_dark'), galv: M('metal_galv'), gold: M('chrome', 0xd8a93a), toolR: M('metal_painted_red'),
      sheet: M('fabric_dark', 0xcfc6ae), pillow: M('fabric_dark', 0xdcd4bc), drape: M('fabric_dark', 0x9a7436, { env: .98 }), jacket: M('fabric_dark', 0x27344c, { env: .97 }), duffel: M('fabric_dark', 0x44462f), cloth: M('fabric_dark', 0x7a3a2e), denim: M('fabric_dark', 0x3a4c66),
      seat: M('leather_tan', 0x9a4c2a), leather: M('leather_tan', 0x6a4226), rubber: M('rubber'), card: M('plastic_white', 0xa68555, { rough: 1.9, env: .5 }), visor: M('plastic_black', 0x101114, { rough: .3 }), paper: M('plastic_white', 0xe6e0cc, { rough: 1.6 }),
      glass: M('glass_clear'), glassD: M('glass_dirty'), bottle: M('glass_tint', 0x4a2a10), helmet: M('car_paint', 0xd9d4c4), green: M('plastic_red', 0x3f7a3a), yellow: M('plastic_red', 0xd8b62a), terra: M('roof_tile_clay'), blue: M('plastic_red', 0x2a5fa8) };
    m.drape.side = m.jacket.side = T.DoubleSide;
    { const vt = veneerTex(), vm = (r, g, b, ro) => { const q = std({ map: vt, roughness: ro, metalness: 0 }); q.color.setRGB(r, g, b); q.envMapIntensity = .7; return q; }; m.panel = vm(.5, .42, .35, .62); m.wood = vm(.5, .4, .32, .5); m.woodD = vm(.27, .21, .165, .45); m.woodL = vm(.74, .64, .52, .55); }
    const AM = S.atlasMat = std({ map: AT.tex, roughness: .82, metalness: 0 }), AMD = std({ map: AT.tex, roughness: .9, metalness: 0, side: T.DoubleSide });
    const QM = std({ map: quiltTex(), roughness: .96, metalness: 0, side: T.DoubleSide }); QM.map.wrapS = QM.map.wrapT = T.RepeatWrapping;
    const dGrime = GT.decalMat('grime_streak'), dStain = GT.decalMat('water_stain'), dCrack = GT.decalMat('crack');

    /* ---------------------------------------------------------------- shell */
    k.box(m.carpet, 4.2, .1, 6.5, 0, -.05, 0); k.box(m.vinyl, 2.15, .1, 2.0, 1.025, -.05, -4.25); k.box(m.tile, 2.05, .1, 2.0, -1.075, -.05, -4.25);
    k.box(m.steel, 2.14, .014, .06, 1.03, .002, ZB, { bevel: .005 }); k.box(m.steel, .8, .014, .12, -.6, .002, ZB - .05, { bevel: .005 });
    k.box(m.ceil, 4.6, .14, 9.0, 0, CH + .07, -1.0);
    k.box(m.panel, .14, CH, 6.65, -HW - .07, CH / 2, .025); k.box(m.tileW, .14, CH, 2.02, -HW - .07, CH / 2, -4.31);
    k.box(m.wall, .14, CH, 8.67, HW + .07, CH / 2, -.985);
    k.box(m.tileW, 2.2, CH, .14, -1.1, CH / 2, ZR - .07); k.box(m.wall, 2.3, CH, .14, 1.05, CH / 2, ZR - .07);
    const fw = (x0, x1, y0, y1) => k.box(m.wall, x1 - x0, y1 - y0, .14, (x0 + x1) / 2, (y0 + y1) / 2, ZF + .07);
    fw(-2.17, -1.45, 0, CH); fw(-1.45, .25, 0, 1.0); fw(-1.45, .25, 2.2, CH); fw(.25, .945, 0, CH); fw(.945, 1.855, 2.05, CH); fw(1.855, 2.17, 0, CH);
    // partition + bathroom / kitchenette divider + soffit
    k.box(m.wall, 1.1, CH, .1, -1.55, CH / 2, ZB - .05); k.box(m.wall, .8, CH - 2.05, .1, -.6, (CH + 2.05) / 2, ZB - .05); k.box(m.wall, .1, CH, 2.0, -.1, CH / 2, -4.25); k.box(m.wall, .15, CH, .1, -.125, CH / 2, ZB - .05);
    k.box(m.wall, 2.15, .4, .3, 1.025, CH - .2, ZB - .15, { bevel: .01 });
    for (const sx of [-1.0, -.2]) k.box(m.white, .07, 2.09, .16, sx + (sx < -.5 ? .01 : -.01), 1.045, ZB - .05, { bevel: .008 }); k.box(m.white, .92, .08, .16, -.6, 2.085, ZB - .05, { bevel: .008 });
    for (const y of [.3, 1.75]) k.box(m.galv, .004, .1, .06, -.972, y, ZB - .05);                                         // hinge leaves of a door that left long ago
    // wood panelling grooves + cap rail on the left wall, baseboards everywhere
    for (let z = -3.15; z < 3.2; z += .305) k.box(m.woodD, .004, CH - .12, .009, -HW + .001, CH / 2 + .05, z);
    const bb = (x0, z0, x1, z1) => k.box(m.woodD, max(abs(x1 - x0), .016), .1, max(abs(z1 - z0), .016), (x0 + x1) / 2, .05, (z0 + z1) / 2, { bevel: .005 });
    bb(-HW + .008, ZB, -HW + .008, ZF); bb(HW - .008, ZR, HW - .008, ZF); bb(-HW, ZF - .008, .9, ZF - .008); bb(-HW, ZB + .008, -1.04, ZB + .008); bb(-.16, ZB + .008, -.05, ZB + .008);
    k.box(m.woodD, .02, .04, 6.5, -HW + .01, CH - .02, 0, { bevel: .006 });
    // ceiling + wall weathering
    k.quad(dStain, 1.7, 1.3, -.9, CH - .003, 1.6, { rx: HP }); k.quad(dStain, 1.1, .9, 1.2, CH - .003, -2.2, { rx: HP, rz: 1 }); k.quad(dCrack, 1.6, .9, .6, CH - .004, -.6, { rx: HP, rz: .4 }); k.quad(dStain, 1.2, 1.0, 1.0, CH - .003, -4.4, { rx: HP });
    k.quad(dGrime, 1.2, 1.5, HW - .003, 1.9, -.2, { ry: -HP }); k.quad(dGrime, .9, 1.3, HW - .003, 1.95, 2.2, { ry: -HP }); k.quad(dGrime, .8, 1.2, -1.75, 1.95, ZF - .003, { ry: PI }); k.quad(dCrack, .8, .6, 1.75, 2.3, ZF - .004, { ry: PI });
    k.quad(dStain, .9, .7, -.6, .28, ZF - .004, { ry: PI }); k.quad(dGrime, .5, .5, .62, 1.2, ZF - .003, { ry: PI }); k.quad(dGrime, 1.3, 1.2, -1.2, 2.0, ZR + .003, {}); k.quad(dStain, 1.4, .8, -1.1, .9, ZR + .004, {}); k.quad(dGrime, .9, 1.6, -HW + .003, 1.8, -4.6, { ry: HP });
    // smoke detector (battery door dangling), bathroom exhaust grille
    k.cyl(m.plasW, .065, .07, .035, .95, CH - .018, 2.05, { seg: 20 }); k.box(m.plasW, .05, .004, .03, .99, CH - .05, 2.05, { rz: .9 }); em('led', emAt(new T.SphereGeometry(.004, 6, 4), .93, CH - .037, 2.09));
    k.box(m.plasW, .3, .015, .3, -1.1, CH - .008, -4.1, { bevel: .004 }); for (let i = 0; i < 6; i++) k.box(m.plasG, .26, .006, .02, -1.1, CH - .018, -4.2 + i * .04);

    /* ---------------------------------------------------------------- window, blinds, drapes, AC */
    const wx = -.6, wy = 1.6, ww = 1.7, wh = 1.2;
    for (const sy of [-1, 1]) k.box(m.alu, ww, .04, .05, wx, wy + sy * (wh / 2 - .02), ZF + .085, { bevel: .004 }); for (const sx of [-1, 0, 1]) k.box(m.alu, sx ? .04 : .035, wh, .05, wx + sx * (ww / 2 - .02), wy, ZF + .085, { bevel: .004 });
    k.box(m.glassD, ww - .04, wh - .04, .006, wx, wy, ZF + .1); k.box(m.alu, .03, .05, .02, wx + .06, wy, ZF + .058, { bevel: .004 });
    k.box(m.white, ww + .2, .035, .13, wx, wy - wh / 2 - .018, ZF - .05, { bevel: .01 }); for (const sx of [-1, 1]) k.box(m.white, .06, wh + .16, .018, wx + sx * (ww / 2 + .03), wy + .02, ZF - .009, { bevel: .005 }); k.box(m.white, ww + .2, .07, .018, wx, wy + wh / 2 + .035, ZF - .009, { bevel: .005 });
    k.box(m.cream, ww - .03, .045, .055, wx, wy + wh / 2 - .025, ZF - .035, { bevel: .006 }); k.box(m.cream, ww - .05, .022, .05, wx, wy - wh / 2 + .05, ZF - .035, { bevel: .006 });
    for (const sx of [-.62, .62]) rod(k, m.paper, [wx + sx, wy + wh / 2 - .04, ZF - .035], [wx + sx, wy - wh / 2 + .05, ZF - .035], .0025, .0025, 4);
    rod(k, m.glass, [wx - .78, wy + wh / 2 - .05, ZF - .07], [wx - .8, wy - .22, ZF - .08], .005, .005, 6); rod(k, m.paper, [wx + .8, wy + wh / 2 - .05, ZF - .06], [wx + .8, wy - .35, ZF - .06], .002, .002, 4); k.cyl(m.plasW, .009, .005, .04, wx + .8, wy - .37, ZF - .06, { seg: 8 });
    // sill life: dead cactus, coins, sunglasses, a lighter
    k.cyl(m.terra, .045, .035, .07, wx - .55, wy - wh / 2 + .035, ZF - .06, { seg: 12 }); k.sphere(m.green, 1, wx - .55, wy - wh / 2 + .12, ZF - .06, { s: [.028, .06, .028], seg: 10 }); k.sphere(m.green, 1, wx - .53, wy - wh / 2 + .13, ZF - .045, { s: [.014, .025, .014], seg: 8 });
    for (let i = 0; i < 5; i++) k.cyl(i % 2 ? m.gold : m.steel, .011, .011, .002, wx + .3 + hsh(i) * .1, wy - wh / 2 + .003 + (i > 2 ? .002 : 0), ZF - .07 + hsh(i * 3) * .04, { seg: 10 });
    k.box(m.red, .022, .012, .055, wx + .52, wy - wh / 2 + .007, ZF - .06, { bevel: .004, ry: .6 }); k.box(m.plasB, .13, .012, .04, wx + .05, wy - wh / 2 + .008, ZF - .055, { bevel: .005, ry: -.15 });
    // drapes on a rod
    rod(k, m.chrome, [wx - 1.08, wy + wh / 2 + .16, ZF - .1], [wx + 1.08, wy + wh / 2 + .16, ZF - .1], .011); for (const sx of [-1, 1]) { k.sphere(m.chrome, .022, wx + sx * 1.09, wy + wh / 2 + .16, ZF - .1, { seg: 10 }); k.box(m.chrome, .02, .02, .1, wx + sx * 1.0, wy + wh / 2 + .16, ZF - .05); }
    for (const sx of [-1, 1]) k.geo(m.drape, surf(22, 14, (u, v) => { const g = sx < 0 ? .36 : .3, x0 = wx + sx * (ww / 2 + .16) - g / 2, y = lerp(wy + wh / 2 + .15, .22 + .03 * sin(u * 9), v); return [x0 + u * g + .012 * sin(v * 5 + u * 3), y, ZF - .1 - .035 * sin(u * TAU * 3.5 + v * 1.1) * (.5 + .5 * v) - .01]; }, null, .8, 2.1));
    // AC unit (through-wall), yellowed, with a drip stain and its cord
    const ax = wx, ay = .66; k.box(m.plasW, .7, .46, .2, ax, ay, ZF - .1, { bevel: .014 }); k.box(m.plasB, .6, .3, .012, ax, ay - .045, ZF - .2);
    for (let i = 0; i < 10; i++) k.box(m.plasW, .6, .011, .03, ax, ay - .18 + i * .03, ZF - .208, { rx: .55 }); for (const sx of [-1, 1]) k.box(m.plasW, .04, .32, .02, ax + sx * .32, ay - .045, ZF - .205, { bevel: .005 });
    aq(k, AM, R.acpanel, .46, .075, ax + .1, ay + .185, ZF - .2015, { ry: PI }); for (const cx of [.03, -.18]) k.cyl(m.plasB, .017, .019, .016, ax + .1 + cx - .005, ay + .192, ZF - .208, { rx: HP, seg: 12 });
    k.tube(m.rubber, [[ax + .3, ay - .2, ZF - .06], [ax + .5, .2, ZF - .05], [ax + .66, .12, ZF - .04], [ax + .72, .3, ZF - .015]], .006, { seg: 5, steps: 14 }); aq(k, AM, R.outlet, .075, .115, ax + .72, .3, ZF - .003, { ry: PI }); k.box(m.plasB, .03, .035, .03, ax + .72, .315, ZF - .02, { bevel: .006 });
    k.cyl(m.foam, .05, .04, .09, ax + .22, ay + .275, ZF - .1, { seg: 12 }); k.cyl(m.plasB, .051, .051, .008, ax + .22, ay + .322, ZF - .1, { seg: 12 });                              // forgotten coffee cup on the AC
    // door casing, light switch, race poster
    for (const sx of [-1, 1]) k.box(m.white, .07, 2.09, .03, DOORX + sx * .49, 1.045, ZF - .014, { bevel: .006 }); k.box(m.white, 1.05, .08, .03, DOORX, 2.09, ZF - .014, { bevel: .006 }); k.box(m.alu, .92, .012, .14, DOORX, .006, ZF + .06, { bevel: .004 });
    aq(k, AM, R.switch, .075, .115, .64, 1.2, ZF - .004, { ry: PI }); aq(k, AM, R.poster, .44, .6, .57, 1.74, ZF - .003, { ry: PI, rz: -.015 });

    /* ---------------------------------------------------------------- left wall: bed, nightstands, print, table + chairs */
    k.push(-HW, 0, -1.15, { ry: HP });                                   // bed frame: x along the wall (+x = toward the back of the room), z out into the room
    k.box(m.wood, 1.62, .95, .05, 0, .62, .03, { bevel: .012 }); k.box(m.woodD, 1.68, .05, .075, 0, 1.115, .037, { bevel: .014 }); for (const sx of [-1, 1]) k.box(m.woodD, .06, 1.12, .065, sx * .81, .56, .035, { bevel: .01 });
    for (let i = 0; i < 3; i++) k.box(m.woodD, .44, .6, .012, (i - 1) * .5, .68, .058, { bevel: .01 });
    for (const sx of [-1, 1]) for (const z of [.14, 1.98]) { k.box(m.dark, .05, .27, .05, sx * .69, .135, z); k.cyl(m.plasB, .028, .028, .02, sx * .69, .012, z, { seg: 8 }); }
    k.box(m.woodD, 1.5, .08, 2.0, 0, .31, 1.06, { bevel: .01 }); k.box(m.denim, 1.49, .13, 1.99, 0, .405, 1.06, { bevel: .03 }); k.box(m.sheet, 1.5, .19, 2.0, 0, .55, 1.06, { bevel: .07 });
    const zEdge = X => .62 + .36 * sst(X, -.35, .75) + .04 * sin(X * 5.3);
    k.geo(QM, surf(52, 64, (u, v) => { const X = (u - .5) * 2.1, ze = zEdge(X), Zf = lerp(ze, 2.52, v), ex = max(abs(X) - .765, 0), ez = max(Zf - 2.075, 0), drop = ex + ez, top = 1 - sst(drop, 0, .08);
      let y = .651 + top * (.012 * sin(X * 9 + Zf * 4.3) + .008 * sin(X * 17 - Zf * 11 + 1.3) + .006 * sin(X * 31 + Zf * 23)) + .05 * Math.exp(-Math.pow((Zf - ze - .045) / .055, 2)) - .014 * Math.exp(-(Math.pow(X + .22, 2) + Math.pow(Zf - 1.25, 2)) / .1);
      y -= sst(drop, 0, .06) * .03 + max(0, drop - .02) * .95; const fold = sst(drop, .02, .2);
      return [Math.sign(X) * (min(abs(X), .765) + min(ex, .03) * .7 + ex * .05) + fold * .014 * sin(Zf * 13 + drop * 17), max(y, .17 + .02 * sin(X * 20 + Zf * 16)), min(Zf, 2.075) + min(ez, .03) * .7 + ez * .05 + fold * .014 * sin(X * 15 + drop * 13)]; }, null, 1, 1).applyMatrix4(new T.Matrix4()), {});
    { const g = k.parts.get(QM), q = g[g.length - 1], uv = q.attributes.uv, n = uv.count; for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * 2.0, uv.getY(i) * 1.8); }
    k.geo(m.pillow, surf(26, 12, (u, v) => { const X = (u - .5) * 1.5, Z = lerp(.5, zEdge(X) + .1, v); return [X, .652 + .009 * sin(X * 23 + Z * 9) + .007 * sin(X * 7 - Z * 19) + .03 * sst(v, .7, 1), Z]; }, null, 1.5, .5));
    k.geo(m.pillow, pillowGeo(.64, .17, .43), { x: -.36, y: .735, z: .31, ry: .12, rx: -.3 }); k.geo(m.sheet, pillowGeo(.62, .16, .42), { x: .39, y: .715, z: .36, ry: -.32, rx: -.1, rz: .05 });
    flat(k, AM, R.mag1, .21, .273, -.3, .675, 1.5, .5); k.box(m.plasB, .045, .018, .16, .22, .676, 1.15, { bevel: .006, ry: .5 }); for (let i = 0; i < 6; i++) k.box(m.plasG, .008, .004, .008, .212 + (i % 2) * .016, .686, 1.1 + ((i / 2) | 0) * .02, { ry: .5 });
    k.geo(m.denim, pillowGeo(.46, .09, .3, .8), { x: -.25, y: .685, z: 1.9, ry: .7, rz: .08 });                                       // T-shirt left on the bed
    // under the bed: the duffel (stash), shoebox, sneakers
    k.sphere(m.duffel, 1, .3, .17, 1.97, { s: [.36, .165, .2], seg: 18, seg2: 12 }); for (const sx of [-.14, .14]) k.geo(m.leather, torus(.1, .012, PI, 12), { x: .3 + sx, y: .3, z: 1.97, ry: HP }); k.box(m.dark, .5, .008, .012, .3, .336, 1.97); k.box(m.galv, .02, .012, .03, .08, .338, 1.97, { bevel: .003 });
    for (const sx of [-.36, .36]) k.cyl(m.leather, .202, .202, .03, .3 + sx * .55, .17, 1.97, { rz: HP, seg: 16 });
    k.box(m.card, .3, .12, .2, -.4, .06, 1.75, { bevel: .004, ry: .2 }); for (const [sx, a] of [[-.06, .2], [.07, -.1]]) { k.box(m.paper, .095, .07, .27, -.72 + sx, .035, 2.16, { bevel: .028, ry: a }); k.box(m.rubber, .1, .022, .28, -.72 + sx, .011, 2.16, { bevel: .008, ry: a }); k.box(m.red, .09, .012, .1, -.72 + sx + sin(a) * .04, .072, 2.2, { bevel: .005, ry: a }); }
    // nightstands
    for (const bx of [-1.03, 1.03]) { k.push(bx, 0, 0); k.box(m.wood, .46, .46, .42, 0, .3, .23, { bevel: .01 }); k.box(m.woodD, .5, .03, .45, 0, .545, .235, { bevel: .008 }); for (const sx of [-1, 1]) for (const z of [.06, .4]) k.box(m.woodD, .035, .08, .035, sx * .2, .04, z);
      k.box(m.woodL, .4, .15, .016, 0, .42, .446, { bevel: .006 }); k.cyl(m.gold, .013, .013, .02, 0, .42, .462, { rx: HP, seg: 10 }); k.box(m.dark, .4, .17, .01, 0, .2, .436); k.pop(); }
    { const X = -1.03, T0 = .56;                                                                                           // front nightstand: lamp, alarm clock, water, pills, keys
      k.cyl(m.woodD, .07, .08, .02, X - .05, T0 + .01, .16, { seg: 16 }); k.sphere(m.terra, 1, X - .05, T0 + .12, .16, { s: [.075, .1, .075], seg: 16 }); k.cyl(m.gold, .012, .012, .12, X - .05, T0 + .27, .16, { seg: 8 }); k.cyl(m.gold, .02, .02, .03, X - .05, T0 + .33, .16, { seg: 8 });
      em('lamp', new T.CylinderGeometry(.105, .165, .22, 24, 1, true).translate(X - .05, T0 + .43, .16), k.top); em('lampBulb', emAt(new T.SphereGeometry(.03, 10, 8), X - .05, T0 + .4, .16), k.top);
      k.cyl(m.gold, .107, .107, .004, X - .05, T0 + .54, .16, { seg: 24, open: true }); rod(k, m.gold, [X - .05, T0 + .33, .19], [X - .05, T0 + .22, .2], .0015, .0015, 4); k.sphere(m.gold, .006, X - .05, T0 + .215, .2, { seg: 6, seg2: 4 });
      k.box(m.plasB, .13, .06, .075, X + .13, T0 + .03, .3, { bevel: .01, ry: -.25 }); aq(k, AM, R.led, .1, .04, X + .137, T0 + .032, .338, { ry: -.25 });
      k.cyl(m.glass, .032, .028, .1, X + .1, T0 + .05, .1, { seg: 14 }); k.cyl(m.red, .02, .02, .05, X - .17, T0 + .025, .33, { seg: 10 }); k.cyl(m.plasW, .021, .021, .012, X - .17, T0 + .056, .33, { seg: 10 });
      k.geo(m.chrome, torus(.014, .0018), { x: X + .02, y: T0 + .003, z: .37, rx: HP }); k.box(m.chrome, .008, .003, .05, X + .04, T0 + .003, .39, { ry: .6 }); k.box(m.galv, .007, .003, .045, X + .0, T0 + .003, .4, { ry: -.3 }); k.box(m.red, .03, .008, .045, X - .02, T0 + .005, .41, { bevel: .003, ry: .9 });
      // back nightstand: tissues, ashtray, paperback, charger
      const X2 = 1.03; k.box(m.blue, .22, .08, .12, X2, T0 + .04, .14, { bevel: .008, ry: .1 }); k.geo(m.paper, pillowGeo(.09, .09, .05, .9), { x: X2, y: T0 + .1, z: .14 }); k.cyl(m.glass, .055, .045, .025, X2 - .1, T0 + .013, .33, { seg: 14 }); for (let i = 0; i < 3; i++) k.cyl(m.paper, .004, .004, .03, X2 - .1 + (i - 1) * .015, T0 + .02, .33, { rz: HP - .2, ry: i, seg: 5 });
      abox(k, AM, R.mag2, .13, .025, .19, X2 + .1, T0 + .013, .32, { ry: -.2 }); k.tube(m.plasW, [[X2 + .16, T0 + .005, .2], [X2 + .23, T0 + .01, .3], [X2 + .245, T0 - .1, .32], [X2 + .245, .15, .3], [X2 + .2, .1, .02]], .003, { seg: 4, steps: 16 }); }
    k.pop();
    // laundry basket in the corner past the bed
    k.cyl(m.plasW, .21, .17, .42, -1.85, .21, -2.86, { seg: 18, open: true }); k.cyl(m.plasW, .17, .17, .012, -1.85, .008, -2.86, { seg: 18 }); k.geo(m.denim, pillowGeo(.36, .2, .34, .9), { x: -1.85, y: .4, z: -2.86, ry: .4 }); k.geo(m.cloth, pillowGeo(.3, .14, .24, .9), { x: -1.8, y: .5, z: -2.9, ry: -.6, rz: .2 }); k.geo(m.sheet, pillowGeo(.3, .08, .3, .9), { x: -1.62, y: .05, z: -2.7, ry: .3 });
    // left-wall frame: +x = toward the back of the room, +z = out of the wall
    k.push(-HW, 0, 0, { ry: HP });
    { const px = 1.15, py = 1.76; k.push(px, py, 0, { rz: .022 }); for (const s of [-1, 1]) { k.box(m.woodL, 1.0, .04, .03, 0, s * .345, .015, { bevel: .01 }); k.box(m.woodL, .04, .73, .03, s * .485, 0, .015, { bevel: .01 }); } aq(k, AM, R.print, .93, .65, 0, 0, .012); k.pop(); k.cyl(m.dark, .003, .003, .012, px, py + .42, .006, { rx: HP, seg: 5 });
      const fx = -1.72, fy = 1.52; k.push(fx, fy, 0, { rz: -.03 }); k.box(m.plasB, .5, .37, .02, 0, 0, .01, { bevel: .006 }); aq(k, AM, R.photo, .46, .33, 0, 0, .0205); k.box(m.glass, .46, .33, .003, 0, 0, .023); k.pop();
      k.cyl(m.plasB, .16, .16, .04, -1.9, 2.18, .02, { rx: HP, seg: 28 }); k.geo(AM, remap(new T.CircleGeometry(.148, 28), R.clock), { x: -1.9, y: 2.18, z: .0405 });
      aq(k, AM, R.plate, .3, .15, -2.75, 2.05, .004, { rz: .04 }); aq(k, AM, sub(R.polaroid, 0, 3), .085, .105, -1.28, 1.42, .004, { rz: .08 }); k.box(m.yellow, .03, .012, .001, -1.28, 1.47, .005, { rz: .5 }); }
    k.pop();
    // formica table against the left wall
    { const tx_ = -1.7, tz = 1.75, T0 = .752; k.box(m.formica, .78, .03, 1.12, tx_, .735, tz, { bevel: .01 }); for (const sx of [-1, 1]) k.box(m.alu, .012, .034, 1.13, tx_ + sx * .39, .735, tz, { bevel: .003 }); for (const sz of [-1, 1]) k.box(m.alu, .79, .034, .012, tx_, .735, tz + sz * .56, { bevel: .003 });
      k.box(m.dark, .6, .04, .9, tx_, .7, tz); for (const sx of [-1, 1]) for (const sz of [-1, 1]) { rod(k, m.chrome, [tx_ + sx * .29, .7, tz + sz * .44], [tx_ + sx * .35, .01, tz + sz * .5], .016, .012, 10); k.cyl(m.plasB, .015, .015, .014, tx_ + sx * .35, .007, tz + sz * .5, { seg: 8 }); }
      // open pizza box, two slices left
      k.push(tx_ - .08, T0, tz + .28, { ry: .22 }); k.box(m.card, .33, .008, .33, 0, .004, 0); for (const s of [-1, 1]) k.box(m.card, .008, .04, .33, s * .165, .02, 0); k.box(m.card, .33, .04, .008, 0, .02, .165); flat(k, AM, R.pizzaIn, .32, .32, 0, .0095, 0);
      k.push(0, .04, -.165, { rx: -1.15 }); k.box(m.card, .33, .008, .33, 0, 0, -.165); aq(k, AM, R.pizza, .32, .32, 0, -.0045, -.165, { rx: HP }); k.pop(); k.pop();
      // takeaway: two oyster pails with chopsticks, clamshell, bag, cup
      for (const [ox, oz, a] of [[.2, .3, .3], [.12, .14, 1.1]]) { k.cyl(m.paper, .058, .044, .1, tx_ + ox, T0 + .05, tz + oz, { seg: 4, ry: a }); k.geo(m.galv, torus(.05, .0015, PI, 10), { x: tx_ + ox, y: T0 + .1, z: tz + oz, ry: a + PI / 4 }); aq(k, AM, R.wok, .07, .07, tx_ + ox + sin(a + PI / 4) * .037, T0 + .05, tz + oz + cos(a + PI / 4) * .037, { ry: a + PI / 4, rx: -.07 }); }
      rod(k, m.woodL, [tx_ + .16, T0 + .06, tz + .31], [tx_ + .31, T0 + .17, tz + .25], .003, .0025, 5); rod(k, m.woodL, [tx_ + .17, T0 + .06, tz + .3], [tx_ + .3, T0 + .175, tz + .28], .003, .0025, 5);
      k.box(m.foam, .21, .035, .15, tx_ - .16, T0 + .018, tz - .1, { bevel: .012, ry: -.3 }); k.box(m.foam, .21, .03, .15, tx_ - .16, T0 + .05, tz - .1, { bevel: .012, ry: -.34, rx: -.08 }); rod(k, m.plasW, [tx_ - .02, T0 + .004, tz - .12], [tx_ + .1, T0 + .004, tz - .06], .004, .003, 5);
      k.box(m.card, .17, .25, .1, tx_ - .24, T0 + .125, tz + .02, { bevel: .012, ry: .5 }); aq(k, AM, R.wok, .13, .13, tx_ - .24 + sin(.5) * .051, T0 + .12, tz + .02 + cos(.5) * .051, { ry: .5 });
      k.cyl(m.foam, .043, .032, .13, tx_ + .05, T0 + .065, tz - .28, { seg: 14 }); k.cyl(m.plasW, .045, .045, .008, tx_ + .05, T0 + .133, tz - .28, { seg: 14 }); rod(k, m.red, [tx_ + .05, T0 + .1, tz - .28], [tx_ + .075, T0 + .22, tz - .27], .003, .003, 5);
      // car magazines, fanned
      [[R.mag0, -.02, -.42, .25], [R.mag2, .03, -.44, -.2], [R.mag3, .1, -.4, .6]].forEach((q, i) => { k.box(m.paper, .21, .005, .273, tx_ + q[1], T0 + .003 + i * .0055, tz + q[2], { ry: q[3] }); flat(k, AM, q[0], .21, .273, tx_ + q[1], T0 + .0062 + i * .0055, tz + q[2], q[3]); });
      // the shoebox of receipts
      k.push(tx_ - .16, T0, tz - .42, { ry: -.35 }); k.box(m.card, .3, .008, .19, 0, .004, 0); for (const s of [-1, 1]) { k.box(m.card, .3, .1, .006, 0, .05, s * .095); k.box(m.card, .006, .1, .19, s * .15, .05, 0); } aq(k, AM, R.shoebox, .29, .095, 0, .05, .0985); k.box(m.card, .31, .006, .2, .07, .012, -.21, { rz: .0, rx: .12 }); k.box(m.card, .31, .03, .006, .07, .024, -.11, { rx: .12 });
      for (let i = 0; i < 9; i++) aq(k, AMD, sub(R.receipt, 0, 1), .06, .13, -.11 + i * .028, .1 + hsh(i) * .035, -.02 + hsh(i * 7) * .06, { rx: -.2 + hsh(i * 3) * .5, ry: (hsh(i * 5) - .5) * 1.2, rz: (hsh(i * 9) - .5) * .4 }); k.pop();
      flat(k, AM, R.receipt, .07, .155, tx_ + .2, T0 + .0012, tz - .12, 1.2); flat(k, AM, R.scratch, .11, .063, tx_ + .24, T0 + .001, tz + .02, .3); flat(k, AM, R.scratch, .11, .063, tx_ + .2, T0 + .0018, tz + .06, -.5); flat(k, AM, R.envelope, .2, .11, tx_ + .13, T0 + .001, tz - .22, -.15);
      rod(k, m.blue, [tx_ + .2, T0 + .005, tz - .32], [tx_ + .31, T0 + .005, tz - .25], .004, .004, 6); for (let i = 0; i < 6; i++) k.cyl(i % 3 ? m.steel : m.gold, .0105, .0105, .0018, tx_ + .27 + hsh(i * 2) * .07, T0 + .001 + (i === 5 ? .002 : 0), tz + .12 + hsh(i * 4) * .06, { seg: 10 });
      for (const [bx, bz] of [[-.3, -.25], [-.26, -.33]]) { k.cyl(m.bottle, .031, .031, .14, tx_ + bx, T0 + .07, tz + bz, { seg: 12 }); k.cyl(m.bottle, .012, .028, .05, tx_ + bx, T0 + .165, tz + bz, { seg: 12 }); k.cyl(m.bottle, .012, .012, .05, tx_ + bx, T0 + .215, tz + bz, { seg: 10 }); acyl(k, AM, sub(R.labels, 0, 1), .0315, .06, tx_ + bx, T0 + .07, tz + bz, {}); }
      k.cyl(m.glass, .06, .05, .028, tx_ + .27, T0 + .014, tz + .42, { seg: 14 }); for (let i = 0; i < 5; i++) k.cyl(i % 2 ? m.paper : m.yellow, .004, .004, .028, tx_ + .27 + (hsh(i) - .5) * .05, T0 + .022, tz + .42 + (hsh(i * 3) - .5) * .05, { rz: HP - .25, ry: i * 1.3, seg: 5 });
      k.cyl(m.red, .019, .022, .09, tx_ + .32, T0 + .045, tz + .3, { seg: 10 }); k.cyl(m.green, .01, .012, .03, tx_ + .32, T0 + .105, tz + .3, { seg: 8 });
      k.geo(m.chrome, torus(.015, .002), { x: tx_ + .08, y: T0 + .003, z: tz - .02, rx: HP }); k.box(m.galv, .008, .003, .055, tx_ + .1, T0 + .003, tz - .0, { ry: .5 }); k.box(m.yellow, .04, .008, .055, tx_ + .05, T0 + .005, tz + .01, { bevel: .003, ry: -.4 });
    }
    // chairs: chrome tube + cracked vinyl
    const chair = (x, z, ry, jacket) => { k.push(x, 0, z, { ry });
      for (const sx of [-1, 1]) { rod(k, m.chrome, [sx * .17, .44, .17], [sx * .2, .012, .21], .011, .011, 8); k.tube(m.chrome, [[sx * .2, .012, -.22], [sx * .17, .44, -.18], [sx * .17, .62, -.19], [sx * .17, .96, -.23]], .011, { seg: 6, steps: 12 }); for (const z2 of [.21, -.22]) k.cyl(m.plasB, .014, .014, .012, sx * .2, .006, z2, { seg: 8 }); }
      rod(k, m.chrome, [-.17, .25, .19], [.17, .25, .19], .008); rod(k, m.chrome, [-.17, .25, -.2], [.17, .25, -.2], .008);
      k.box(m.seat, .4, .055, .4, 0, .465, 0, { bevel: .022 }); k.box(m.dark, .36, .015, .36, 0, .432, 0); k.box(m.seat, .4, .26, .04, 0, .8, -.215, { bevel: .018, rx: -.1 }); k.box(m.galv, .09, .001, .05, .1, .494, .08, { ry: .3 });
      if (jacket) { k.geo(m.jacket, surf(20, 26, (u, v) => { const X = (u - .5) * .5, t = v * .92 - .36, a = abs(t), sh = .03 * Math.exp(-Math.pow((abs(X) - .2) / .06, 2)); return [X * (1 + .1 * sst(a, .1, .5)), .972 + sh * (1 - sst(a, 0, .1)) - Math.sqrt(t * t + .0005) * .97 + .012 * sin(X * 23) * sst(a, .05, .3), -.22 - .037 * Math.tanh(t / .014) + .01 * sin(X * 31 + t * 11) * sst(a, .04, .2)]; }, null, .5, .9));
        aq(k, AM, R.patch, .25, .18, 0, .74, -.27, { ry: PI }); for (const sx of [-1, 1]) k.tube(m.jacket, [[sx * .24, .95, -.24], [sx * .285, .8, -.25], [sx * .29, .6, -.235], [sx * .27, .42, -.22]], .042, { seg: 7, steps: 10 }); k.tube(m.jacket, [[-.13, .985, -.24], [0, 1.0, -.25], [.13, .985, -.24]], .02, { seg: 6, steps: 8 }); }
      k.pop(); };
    chair(-1.7, .86, 0, false); chair(-1.03, 1.9, -HP - .35, true);

    /* ---------------------------------------------------------------- right wall: dresser + TV, wardrobe + mirror, shelf, corkboard, phone, tyre */
    k.push(HW, 0, -1.15, { ry: -HP });                                  // +x = toward the front of the room, +z = out of the wall
    k.box(m.wood, 1.3, .7, .46, 0, .42, .24, { bevel: .012 }); k.box(m.woodD, 1.36, .035, .5, 0, .79, .25, { bevel: .01 }); k.box(m.dark, 1.24, .07, .4, 0, .035, .22);
    for (const c of [-1, 1]) for (let r = 0; r < 3; r++) { const op = c === 1 && r === 1 ? .1 : c === -1 && r === 0 ? .025 : 0, y = .19 + r * .225; k.box(m.woodL, .6, .2, .02, c * .32, y, .476 + op, { bevel: .006 }); if (op > .05) { k.box(m.woodD, .56, .16, op, c * .32, y - .01, .47 + op / 2); k.geo(m.cloth, pillowGeo(.4, .1, .09, .9), { x: c * .32 + .05, y: y + .09, z: .52 }); k.tube(m.denim, [[c * .32 - .12, y + .1, .5], [c * .32 - .15, y + .07, .59], [c * .32 - .14, y - .08, .6]], .022, { seg: 6, steps: 8 }); }
      for (const s of [-1, 1]) k.cyl(m.gold, .005, .005, .022, c * .32 + s * .06, y, .497 + op, { rx: HP, seg: 6 }); rod(k, m.gold, [c * .32 - .075, y, .51 + op], [c * .32 + .075, y, .51 + op], .006, .006, 8); }
    const T0 = .808, tvx = -.24;
    k.box(m.tvB, .66, .5, .3, tvx, T0 + .27, .31, { bevel: .03 }); k.box(m.tvB, .5, .4, .2, tvx, T0 + .26, .13, { bevel: .05 }); k.box(m.plasB, .64, .48, .03, tvx, T0 + .27, .462, { bevel: .014 }); k.box(m.dark, .47, .36, .008, tvx - .075, T0 + .28, .476);
    for (const sx of [-1, 1]) k.box(m.plasB, .07, .02, .26, tvx + sx * .24, T0 + .01, .31, { bevel: .006 });
    for (let i = 0; i < 9; i++) k.box(m.plasG, .1, .006, .004, tvx + .245, T0 + .1 + i * .017, .479); for (const [yy, rr_] of [[.42, .022], [.345, .022], [.285, .012]]) { k.cyl(m.plasG, rr_, rr_ * 1.1, .02, tvx + .245, T0 + yy, .485, { rx: HP, seg: 14 }); k.box(m.plasW, .004, rr_ * 1.6, .004, tvx + .245, T0 + yy, .496, { rz: yy * 9 }); }
    aq(k, AM, sub(R.vcr, 3, 4), .08, .02, tvx + .245, T0 + .065, .4785); em('led', emAt(new T.SphereGeometry(.0035, 6, 4), tvx + .205, T0 + .285, .479), k.top);
    k.cyl(m.plasB, .05, .06, .025, tvx + .1, T0 + .533, .22, { seg: 14 }); rod(k, m.chrome, [tvx + .08, T0 + .545, .22], [tvx - .2, T0 + .98, .2], .003, .002, 6); rod(k, m.chrome, [tvx + .12, T0 + .545, .22], [tvx + .36, T0 + .92, .16], .003, .002, 6); k.sphere(m.alu, .022, tvx + .36, T0 + .925, .16, { seg: 7, seg2: 5 });
    k.box(m.plasB, .36, .085, .28, .42, T0 + .043, .27, { bevel: .008 }); aq(k, AM, R.vcr, .35, .078, .42, T0 + .043, .4115); for (let i = 0; i < 3; i++) { k.box(m.plasB, .19, .026, .105, .4 + hsh(i) * .04, T0 + .099 + i * .027, .3, { ry: (hsh(i * 3) - .5) * .3, bevel: .003 }); aq(k, AM, sub(R.vhs, i, 4, true), .17, .02, .4 + hsh(i) * .04, T0 + .099 + i * .027, .354, { ry: (hsh(i * 3) - .5) * .3 }); }
    k.cyl(m.terra, .06, .04, .03, .42, T0 + .19, .3, { seg: 14 }); for (let i = 0; i < 7; i++) k.cyl(i % 2 ? m.gold : m.steel, .0105, .0105, .002, .42 + (hsh(i) - .5) * .06, T0 + .2 + i * .0015, .3 + (hsh(i * 2) - .5) * .06, { seg: 8, rx: (hsh(i * 5) - .5) * .5 });
    k.box(m.glass, .04, .09, .03, .1, T0 + .045, .4, { bevel: .008 }); k.cyl(m.gold, .012, .012, .02, .1, T0 + .1, .4, { seg: 8 }); k.box(m.plasB, .05, .016, .17, .22, T0 + .008, .42, { bevel: .005, ry: .4 });
    k.tube(m.rubber, [[tvx, T0 + .2, .04], [tvx - .1, .5, .02], [tvx - .3, .06, .1], [-.74, .03, .3]], .005, { seg: 4, steps: 14 }); k.box(m.plasW, .26, .035, .05, -.82, .018, .34, { bevel: .008, ry: .3 }); em('led', emAt(new T.BoxGeometry(.012, .006, .008), -.93, .038, .375), k.top);
    k.pop();
    k.push(HW, 0, -2.62, { ry: -HP });                                  // wardrobe
    k.box(m.wood, 1.06, 1.96, .56, 0, 1.04, .28, { bevel: .012 }); k.box(m.dark, 1.0, .07, .5, 0, .035, .27); k.box(m.woodD, 1.1, .05, .6, 0, 2.045, .29, { bevel: .014 });
    k.box(m.woodL, .5, 1.86, .022, .265, 1.06, .571, { bevel: .006 }); k.box(m.woodD, .44, 1.6, .008, .265, 1.07, .584, { bevel: .003 }); k.cyl(m.gold, .012, .014, .025, .05, 1.0, .59, { rx: HP, seg: 10 });
    k.box(m.dark, .5, 1.86, .004, -.265, 1.06, .562); k.push(-.52, 0, .565, { ry: -.42 }); k.box(m.woodL, .5, 1.86, .022, .25, 1.06, .011, { bevel: .006 }); k.cyl(m.gold, .012, .014, .025, .46, 1.0, .03, { rx: HP, seg: 10 }); k.box(m.woodD, .36, .6, .006, .25, 1.5, .024, { bevel: .003 }); k.box(m.woodD, .36, .9, .006, .25, .62, .024, { bevel: .003 }); k.pop();
    k.tube(m.cloth, [[-.3, 1.55, .55], [-.33, 1.3, .6], [-.31, 1.05, .61], [-.33, .9, .6]], .04, { seg: 7, steps: 10 }); k.box(m.denim, .05, .9, .03, -.18, 1.2, .565, { bevel: .01 }); rod(k, m.chrome, [-.5, 1.72, .54], [-.02, 1.72, .54], .008);
    aq(k, AM, sub(R.polaroid, 1, 3), .08, .1, .1, 1.72, .5895, { rz: .12 }); aq(k, AM, sub(R.polaroid, 2, 3), .08, .1, .43, 1.5, .5895, { rz: -.1 }); aq(k, AM, R.sticker, .2, .06, .26, .2, .5835, { rz: .04 });
    // on top: old suitcase, a box, a hubcap
    k.box(m.leather, .62, .2, .4, .12, 2.17, .3, { bevel: .03, ry: .06 }); for (const sx of [-.2, .2]) { k.box(m.woodD, .04, .21, .41, .12 + sx, 2.17, .3, { bevel: .006, ry: .06 }); k.box(m.gold, .03, .035, .012, .12 + sx, 2.2, .505, { bevel: .004 }); } k.geo(m.leather, torus(.05, .01, PI, 10), { x: .12, y: 2.2, z: .51 });
    k.box(m.card, .3, .22, .3, -.33, 2.18, .28, { bevel: .006, ry: -.2 }); k.cyl(m.chrome, .17, .17, .02, -.33, 2.33, .3, { seg: 22, rx: .2 });
    k.pop();
    k.push(HW, 0, .95, { ry: -HP });                                    // shelf wall
    k.box(m.woodL, 1.24, .028, .22, 0, 1.5, .11, { bevel: .006 }); for (const sx of [-.45, .45]) { k.box(m.dark, .02, .2, .012, sx, 1.39, .006); k.box(m.dark, .02, .012, .2, sx, 1.482, .1); rod(k, m.dark, [sx, 1.3, .01], [sx, 1.48, .19], .005, .005, 4); }
    const trophy = (x, z, h, c) => { k.box(m.woodD, .085, .04, .085, x, 1.534, z, { bevel: .005 }); aq(k, AM, sub(R.plaque, c, 4, true), .07, .011, x, 1.534, z + .0431); k.cyl(m.gold, .01, .016, h * .5, x, 1.554 + h * .25, z, { seg: 10 }); const cu = h * 4; k.geo(m.gold, new T.LatheGeometry([[.008, 0], [.02, .012], [.04, .04], [.05, .075], [.052, .105], [.048, .11], [.045, .08], [.03, .03], [.0, .02]].map(p => new T.Vector2(p[0] * cu, p[1] * cu)), 16), { x, y: 1.554 + h * .5, z });
      for (const s of [-1, 1]) k.geo(m.gold, torus(.03 * cu, .0035, PI, 8), { x: x + s * .047 * cu, y: 1.554 + h * .5 + .07 * cu, z, rz: s * -HP }); };
    trophy(-.5, .11, .26, 0); trophy(-.36, .13, .17, 1); trophy(-.22, .1, .2, 2); k.box(m.woodD, .1, .13, .02, -.07, 1.58, .06, { bevel: .004, rx: -.2 }); aq(k, AM, sub(R.plaque, 3, 4, true), .085, .03, -.07, 1.58, .072, { rx: -.2 });
    // the cracked race helmet
    { const hx = .2, hy = 1.652, hz = .115; k.push(hx, hy, hz, { ry: .5 }); k.sphere(m.helmet, .135, 0, 0, 0, { s: [1, 1.0, 1.13], seg: 24, seg2: 16 }); k.geo(m.helmet, new T.TorusGeometry(.105, .04, 8, 18, PI * 1.15), { rx: HP, rz: 0, ry: PI * .075 + PI, y: -.082, z: .012, s: [1, 1.18, 1] }); k.geo(m.visor, new T.SphereGeometry(.1378, 24, 6, HP - 1.2, 2.4, 1.02, .56), { s: [1, 1.0, 1.13] }); k.geo(m.rubber, new T.SphereGeometry(.139, 24, 2, HP - 1.24, 2.48, .99, .035), { s: [1, 1, 1.13] }); k.geo(m.rubber, new T.SphereGeometry(.139, 24, 2, HP - 1.24, 2.48, 1.575, .035), { s: [1, 1, 1.13] });
      k.geo(m.red, new T.SphereGeometry(.1362, 28, 3, 0, TAU, HP - .1, .2), { rz: HP, s: [1, .98, 1.13] }); k.geo(m.blue, new T.SphereGeometry(.1366, 28, 2, 0, TAU, HP - .035, .07), { rz: HP, s: [1, .98, 1.13] });
      const cr = []; for (let i = 0; i < 9; i++) { const th = .55 + i * .12, ph = 2.6 + .25 * sin(i * 2.1) + i * .03; cr.push([-.137 * cos(ph) * sin(th), .134 * cos(th), .155 * sin(ph) * sin(th)]); } k.tube(m.dark, cr, .0024, { seg: 4, steps: 18 }); k.tube(m.dark, [cr[4], [cr[4][0] - .01, cr[4][1] + .02, cr[4][2] - .04], [cr[4][0] - .02, cr[4][1] + .01, cr[4][2] - .07]], .0012, { seg: 3, steps: 6 });
      k.box(m.galv, .05, .001, .03, -.11, .06, -.06, { rz: 1.1, ry: .5 }); k.cyl(m.rubber, .12, .12, .012, 0, -.135, 0, { seg: 18 }); k.pop(); }
    // model car + spray can
    { const cx = .47, cy = 1.527; k.box(m.red, .17, .028, .07, cx, cy + .014, .1, { bevel: .01 }); k.box(m.plasB, .08, .022, .06, cx - .012, cy + .038, .1, { bevel: .009 }); for (const sx of [-.055, .055]) for (const sz of [-.034, .034]) k.cyl(m.rubber, .013, .013, .012, cx + sx, cy + .008, .1 + sz, { rx: HP, seg: 10 }); k.cyl(m.dark, .03, .03, .15, .56, 1.59, .14, { seg: 12 }); k.cyl(m.red, .012, .012, .02, .56, 1.675, .14, { seg: 8 }); }
    // low bookcase: boombox, magazines, tapes, cactus
    k.box(m.wood, .9, .62, .28, 0, .33, .14, { bevel: .01 }); k.box(m.dark, .84, .24, .01, 0, .2, .282); k.box(m.dark, .84, .24, .01, 0, .47, .282); k.box(m.woodD, .94, .03, .3, 0, .652, .15, { bevel: .008 });
    for (let i = 0; i < 11; i++) { const hgt = .19 + hsh(i) * .04; k.box([m.card, m.red, m.blue, m.paper, m.green, m.plasB][i % 6], .022 + hsh(i * 3) * .014, hgt, .17, -.38 + i * .04, .09 + hgt / 2, .2, { rz: i === 10 ? -.25 : 0 }); } aq(k, AM, R.vhs, .3, .115, .22, .145, .286); for (let i = 0; i < 4; i++) abox(k, AM, R.mag0, .2, .012, .26, .22, .355 + i * .014, .15, { ry: (hsh(i) - .5) * .3 });
    aq(k, AM, R.vhs, .28, .1, -.2, .47, .286);
    k.box(m.plasB, .44, .2, .14, -.14, .77, .14, { bevel: .02 }); for (const sx of [-1, 1]) { k.cyl(m.plasG, .07, .07, .012, -.14 + sx * .13, .76, .212, { rx: HP, seg: 18 }); k.cyl(m.dark, .055, .03, .012, -.14 + sx * .13, .76, .216, { rx: HP, seg: 18 }); } k.box(m.dark, .1, .05, .006, -.14, .8, .212); k.geo(m.plasB, torus(.14, .008, PI, 12), { x: -.14, y: .87, z: .14 }); rod(k, m.chrome, [.04, .87, .09], [.26, 1.25, .06], .003, .002, 5);
    k.cyl(m.terra, .06, .045, .09, .32, .712, .15, { seg: 14 }); k.sphere(m.green, 1, .32, .82, .15, { s: [.04, .09, .04], seg: 10 }); k.sphere(m.green, 1, .345, .8, .16, { s: [.02, .04, .02], seg: 8 });
    // toolbox + boots on the floor, spare tyre under the phone
    k.push(.98, 0, .17, { ry: .12 }); k.box(m.toolR, .44, .18, .2, 0, .09, 0, { bevel: .012 }); k.box(m.toolR, .44, .05, .2, 0, .205, 0, { bevel: .018 }); k.geo(m.chrome, torus(.07, .008, PI, 10), { x: 0, y: .23, z: 0 }); for (const sx of [-.14, .14]) k.box(m.galv, .03, .05, .008, sx, .17, .102, { bevel: .003 }); k.quad(GT.decalMat('rust_run'), .3, .15, 0, .09, .1005); k.pop();
    aq(k, AM, R.cal, .22, .308, .83, 1.5, .004, { rz: .015 }); k.cyl(m.dark, .003, .003, .01, .83, 1.648, .005, { rx: HP, seg: 5 });
    { const cx = 1.42, cy = 1.5; for (const s of [-1, 1]) { k.box(m.woodL, .76, .03, .024, cx, cy + s * .245, .012, { bevel: .006 }); k.box(m.woodL, .03, .52, .024, cx + s * .365, cy, .012, { bevel: .006 }); } k.box(m.card, .72, .48, .014, cx, cy, .007); aq(k, AM, R.cork, .7, .465, cx, cy, .0145); aq(k, AM, R.note, .105, .085, cx + .27, cy - .18, .018, { rz: -.07 }); k.sphere(m.red, .006, cx + .27, cy - .145, .02, { seg: 6, seg2: 4 }); }
    k.pop();
    { // wall phone + its coiled cord, taped pizza menu
      k.push(HW, 0, -.02, { ry: -HP }); k.box(m.plasW, .2, .24, .05, 0, 1.36, .025, { bevel: .014 }); aq(k, AM, R.keypad, .1, .162, .02, 1.345, .0505); k.box(m.plasW, .055, .22, .045, -.075, 1.37, .07, { bevel: .02 }); k.box(m.plasW, .06, .05, .03, -.075, 1.46, .045, { bevel: .012 }); k.box(m.plasW, .06, .05, .03, -.075, 1.28, .045, { bevel: .012 });
      const pts = [], N = 64; for (let i = 0; i <= N; i++) { const t = i / N, cx = -.075 + .1 * sin(t * PI) + t * .03, cy = 1.25 - .52 * sin(t * PI) * (1 - .15 * t) - t * .03, a = t * TAU * 16; pts.push([cx + .012 * cos(a), cy + .004 * sin(a * .5), .06 + .012 * sin(a)]); } k.tube(m.plasW, pts, .0028, { seg: 4, steps: 150 });
      aq(k, AM, R.menu, .15, .225, .24, 1.38, .004, { rz: -.04 }); for (const yy of [1.49, 1.27]) k.box(m.paper, .04, .018, .001, .24, yy, .005, { rz: .3 }); k.pop();
      k.push(HW - .15, .315, -.02, { rz: .0, ry: 0, rx: 0 }); k.geo(m.rubber, new T.TorusGeometry(.225, .09, 12, 30), { ry: HP, rz: .0, rx: 0, x: .0 }); k.cyl(m.steel, .15, .15, .12, 0, 0, 0, { rz: HP, seg: 20 }); k.cyl(m.dark, .06, .06, .13, 0, 0, 0, { rz: HP, seg: 12 }); for (let i = 0; i < 5; i++) k.cyl(m.chrome, .012, .012, .14, 0, .095 * cos(i / 5 * TAU), .095 * sin(i / 5 * TAU), { rz: HP, seg: 6 }); k.pop();
      // work boots between the window and the door
      for (const [bx, a] of [[.42, .25], [.6, -.1]]) { k.push(bx, 0, ZF - .28, { ry: a }); k.box(m.rubber, .1, .03, .29, 0, .015, 0, { bevel: .01 }); k.box(m.leather, .095, .08, .28, 0, .07, 0, { bevel: .03 }); k.box(m.leather, .09, .16, .12, 0, .17, -.075, { bevel: .03 }); k.box(m.dark, .07, .012, .1, 0, .252, -.075, { bevel: .004 }); k.pop(); }
    }

    /* ---------------------------------------------------------------- kitchenette */
    { const Z = ZR, T0 = .9;
      k.box(m.wood, 1.42, .78, .56, .7, .47, Z + .28, { bevel: .008 }); k.box(m.dark, 1.38, .08, .5, .7, .04, Z + .26); k.box(m.formica, 1.46, .04, .62, .7, .88, Z + .31, { bevel: .012 }); k.box(m.alu, 1.47, .042, .012, .7, .88, Z + .622, { bevel: .003 });
      for (let i = 0; i < 3; i++) { const dx = .245 + i * .455, op = i === 2 ? .3 : 0; k.push(dx - .215, 0, Z + .565, { ry: -op }); k.box(m.woodL, .43, .68, .018, .215, .47, .009, { bevel: .005 }); k.box(m.chrome, .012, .1, .012, .39, .66, .026, { bevel: .004 }); k.pop(); }
      k.box(m.tileW, 1.46, .5, .012, .7, 1.15, Z + .006); k.quad(dGrime, 1.0, .5, .9, 1.15, Z + .0125, {});
      // sink with yesterday's dishes
      k.box(m.steel, .5, .012, .42, .36, T0 + .004, Z + .31, { bevel: .004 }); k.box(m.dark, .42, .004, .34, .36, T0 + .0105, Z + .31); k.box(m.steel, .42, .03, .012, .36, T0 + .02, Z + .14); k.tube(m.chrome, [[.36, T0, Z + .1], [.36, T0 + .2, Z + .1], [.36, T0 + .26, Z + .17], [.36, T0 + .2, Z + .25]], .012, { seg: 8, steps: 14 }); for (const sx of [-1, 1]) { k.cyl(m.chrome, .016, .02, .04, .36 + sx * .1, T0 + .03, Z + .1, { seg: 10 }); k.box(m.chrome, .05, .01, .012, .36 + sx * .1, T0 + .055, Z + .1, { bevel: .004, ry: sx * .5 }); }
      for (let i = 0; i < 3; i++) k.cyl(m.porc, .1 - i * .008, .06, .016, .32 + i * .012, T0 + .022 + i * .017, Z + .32, { seg: 18, rx: i * .06 }); k.cyl(m.dark, .1, .09, .05, .44, T0 + .06, Z + .36, { seg: 16, rx: .25, open: true }); rod(k, m.plasB, [.52, T0 + .08, Z + .4], [.68, T0 + .12, Z + .5], .01, .008, 6); rod(k, m.alu, [.3, T0 + .05, Z + .38], [.24, T0 + .15, Z + .46], .004, .003, 5);
      k.cyl(m.green, .028, .032, .15, .08, T0 + .075, Z + .14, { seg: 10 }); k.cyl(m.plasW, .01, .014, .03, .08, T0 + .165, Z + .14, { seg: 8 }); k.box(m.yellow, .1, .028, .065, .14, T0 + .034, Z + .42, { bevel: .008, ry: .3 }); k.box(m.green, .1, .008, .065, .14, T0 + .05, Z + .42, { ry: .3 });
      // hot plate with a dented pot, mugs, coffee maker, instant noodles, paper towels
      k.box(m.steel, .5, .06, .3, 1.02, T0 + .03, Z + .3, { bevel: .01 }); for (const sx of [-1, 1]) { for (const rr_ of [.035, .055, .075]) k.geo(m.dark, torus(rr_, .006, TAU, 18), { x: 1.02 + sx * .12, y: T0 + .064, z: Z + .29, rx: HP }); k.cyl(m.plasB, .017, .019, .016, 1.02 + sx * .12, T0 + .03, Z + .455, { rx: HP, seg: 12 }); } em('hot', emAt(new T.SphereGeometry(.005, 6, 4), 1.02, T0 + .032, Z + .452));
      k.cyl(m.alu, .09, .085, .1, .9, T0 + .12, Z + .29, { seg: 18, open: true }); k.cyl(m.alu, .085, .085, .006, .9, T0 + .074, Z + .29, { seg: 18 }); k.cyl(m.card, .083, .083, .004, .9, T0 + .13, Z + .29, { seg: 18 }); rod(k, m.plasB, [.98, T0 + .16, Z + .29], [1.1, T0 + .17, Z + .35], .009, .008, 6); rod(k, m.woodL, [.88, T0 + .13, Z + .3], [.8, T0 + .26, Z + .42], .006, .005, 5);
      const mug = (x, z, mat, a) => { k.cyl(mat, .04, .036, .09, x, T0 + .045, z, { seg: 14, open: true }); k.cyl(mat, .036, .036, .006, x, T0 + .004, z, { seg: 14 }); k.cyl(m.woodD, .036, .036, .003, x, T0 + .07, z, { seg: 12 }); k.geo(mat, torus(.026, .006, PI, 8), { x: x + cos(a) * .04, y: T0 + .045, z: z - sin(a) * .04, rz: -HP, ry: a }); };
      mug(.62, Z + .47, m.porc, .5); mug(.7, Z + .38, m.blue, 2.2); mug(1.28, Z + .5, m.yellow, -.6);
      k.box(m.plasB, .17, .3, .2, 1.3, T0 + .15, Z + .16, { bevel: .014 }); k.cyl(m.glass, .06, .065, .12, 1.3, T0 + .075, Z + .3, { seg: 14 }); k.cyl(m.woodD, .055, .06, .05, 1.3, T0 + .04, Z + .3, { seg: 14 }); k.box(m.plasB, .14, .03, .16, 1.3, T0 + .16, Z + .3, { bevel: .006 });
      for (let i = 0; i < 3; i++) { k.cyl(i === 1 ? m.red : m.foam, .05, .036, .095, .62 + i * .012, T0 + .0475 + i * .04, Z + .16, { seg: 14 }); } k.cyl(m.paper, .055, .055, .23, .74, T0 + .13, Z + .12, { seg: 16 }); k.cyl(m.woodL, .07, .07, .015, .74, T0 + .008, Z + .12, { seg: 14 }); rod(k, m.woodL, [.74, T0, Z + .12], [.74, T0 + .28, Z + .12], .01, .01, 6);
      // wall cabinets, under-cabinet tube, things on top
      k.box(m.wood, 1.42, .62, .32, .7, 1.78, Z + .16, { bevel: .008 }); for (let i = 0; i < 3; i++) { k.box(m.woodL, .44, .58, .018, .245 + i * .455, 1.78, Z + .33, { bevel: .005 }); k.box(m.chrome, .012, .09, .012, .245 + i * .455 + .17, 1.56, Z + .345, { bevel: .004 }); }
      k.box(m.plasW, .64, .03, .07, .7, 1.455, Z + .2, { bevel: .006 }); em('kit', new T.CylinderGeometry(.012, .012, .58, 8).rotateZ(HP).translate(.7, 1.432, Z + .2));
      k.box(m.card, .34, .24, .26, .3, 2.21, Z + .16, { bevel: .006, ry: .12 }); k.cyl(m.chrome, .19, .19, .025, .95, 2.26, Z + .08, { seg: 24, rx: HP - .3 }); k.cyl(m.dark, .07, .07, .03, .95, 2.26, Z + .085, { seg: 12, rx: HP - .3 }); k.box(m.red, .2, .12, .14, 1.26, 2.15, Z + .14, { bevel: .01, ry: -.2 });
      // fridge carcass (hollow), freezer box, shelves, permanent contents
      const fx = 1.75, fz = Z + .3; S.fr = { x: fx, z: fz };
      k.box(m.enamel, .56, .86, .03, fx, .43, Z + .035, { bevel: .008 }); for (const sx of [-1, 1]) k.box(m.enamel, .03, .86, .52, fx + sx * .265, .43, fz, { bevel: .008 }); k.box(m.enamel, .56, .03, .52, fx, .845, fz, { bevel: .008 }); k.box(m.enamel, .56, .1, .52, fx, .05, fz, { bevel: .008 }); k.box(m.dark, .5, .06, .01, fx, .04, Z + .562);
      k.box(m.plasW, .5, .7, .004, fx, .46, Z + .053); k.box(m.alu, .48, .13, .3, fx, .755, fz - .06, { bevel: .01 }); k.box(m.foam, .44, .02, .04, fx, .69, fz + .1, { bevel: .008 });
      for (const sy of [.3, .5]) { for (let i = 0; i < 7; i++) rod(k, m.chrome, [fx - .23 + i * .077, sy, Z + .06], [fx - .23 + i * .077, sy, Z + .5], .0025, .0025, 4); rod(k, m.chrome, [fx - .245, sy, Z + .5], [fx + .245, sy, Z + .5], .004, .004, 5); }
      k.cyl(m.red, .02, .024, .1, fx - .18, .355, fz + .1, { seg: 10 }); acyl(k, AM, [R.labels[0] + (R.labels[2] - R.labels[0]) * .26, R.labels[1] + (R.labels[3] - R.labels[1]) * .5, R.labels[0] + (R.labels[2] - R.labels[0]) * .5, R.labels[3]], .0245, .06, fx - .18, .35, fz + .1, {}); k.cyl(m.green, .012, .014, .03, fx - .18, .42, fz + .1, { seg: 8 });
      k.cyl(m.glass, .04, .04, .1, fx + .16, .355, fz - .05, { seg: 12 }); k.cyl(m.green, .034, .034, .06, fx + .16, .34, fz - .05, { seg: 10 }); k.cyl(m.gold, .042, .042, .012, fx + .16, .41, fz - .05, { seg: 12 }); k.sphere(m.yellow, 1, fx + .02, .327, fz + .14, { s: [.032, .026, .026], seg: 10 });
      k.box(m.card, .22, .06, .1, fx + .08, .535, fz - .08, { bevel: .01 }); k.box(m.yellow, .1, .03, .06, fx - .14, .52, fz - .1, { bevel: .008 }); k.box(m.plasW, .12, .035, .08, fx - .14, .13, fz, { bevel: .01 }); k.sphere(m.green, 1, fx + .1, .135, fz + .05, { s: [.07, .03, .05], seg: 10 });
      em('fridge', emAt(new T.BoxGeometry(.1, .02, .04), fx + .12, .675, fz + .12));
      // microwave, cereal, bananas on top
      k.box(m.plasW, .48, .27, .36, fx, .995, Z + .24, { bevel: .012 }); aq(k, AM, R.micro, .465, .262, fx, .995, Z + .4215); abox(k, AM, R.cereal, .19, .27, .065, fx - .1, 1.265, Z + .22, { ry: .25 }); for (let i = 0; i < 3; i++) k.tube(m.yellow, [[fx + .08, 1.15, Z + .16 + i * .035], [fx + .15, 1.142 + i * .004, Z + .19 + i * .035], [fx + .21, 1.16, Z + .2 + i * .04]], .016, { seg: 6, steps: 8 });
      // trash can with a pizza box and empties
      k.cyl(m.plasG, .14, .11, .36, .14, .18, -4.42, { seg: 16, open: true }); k.cyl(m.plasG, .11, .11, .01, .14, .006, -4.42, { seg: 16 }); k.box(m.card, .3, .03, .3, .14, .36, -4.42, { rz: 1.1, ry: .4 }); for (const [cx, cz, a] of [[.42, -4.52, 0], [.5, -4.44, 1.5], [.36, -4.38, 0]]) acyl(k, AM, [R.labels[0] + (R.labels[2] - R.labels[0]) * .26, R.labels[1], R.labels[0] + (R.labels[2] - R.labels[0]) * .5, R.labels[1] + (R.labels[3] - R.labels[1]) * .48], .032, .12, cx, a ? .032 : .06, cz, a ? { rz: HP, ry: a } : {});
      k.decal('grime_streak', 1.2, 1.0, 1.0, .003, -3.9, .5); k.decal('water_stain', .7, .6, 1.75, .003, -4.4, 0);
    }

    /* ---------------------------------------------------------------- bathroom nook */
    { const Z = ZR, bx = -1.125;
      k.box(m.porc, 1.95, .1, .75, bx, .07, Z + .375, { bevel: .02 }); k.box(m.porc, 1.95, .5, .09, bx, .25, Z + .705, { bevel: .03 }); k.box(m.porc, 1.95, .5, .06, bx, .25, Z + .03, { bevel: .02 }); for (const sx of [-1, 1]) k.box(m.porc, .09, .5, .75, bx + sx * .93, .25, Z + .375, { bevel: .03 });
      k.cyl(m.chrome, .02, .02, .004, bx + .7, .122, Z + .375, { seg: 10 }); k.decal('rust_run', .3, .4, bx + .7, .124, Z + .42, 0); k.quad(dStain, 1.6, .5, bx, .26, Z + .752, {});
      rod(k, m.chrome, [-HW, 2.0, Z + .77], [-.15, 2.0, Z + .77], .012); k.geo(AMD, surf(60, 10, (u, v) => [-2.05 + u * 1.22, lerp(1.98, .2, v), Z + .775 + .04 * sin(u * TAU * 7.5) * (.6 + .4 * v) + .012 * sin(u * 31 + v * 3)], [R.shower[0], R.shower[3], R.shower[2], R.shower[1]])); for (let i = 0; i < 10; i++) k.cyl(m.chrome, .018, .018, .004, -2.03 + i * .132, 1.995, Z + .77, { rz: HP, seg: 8 });
      rod(k, m.chrome, [-HW, 1.98, Z + .38], [-1.92, 1.93, Z + .38], .011); k.cyl(m.chrome, .05, .02, .05, -1.9, 1.9, Z + .38, { rz: -1.1, seg: 12 }); for (const sz of [-.1, .1]) { k.cyl(m.chrome, .028, .028, .05, -HW + .025, 1.0, Z + .38 + sz, { rz: HP, seg: 10 }); } rod(k, m.chrome, [-HW, .62, Z + .38], [-1.95, .58, Z + .38], .014);
      abox(k, AM, sub(R.soap, 0, 2), .055, .16, .035, -.42, .58, Z + .7, { ry: .3 }); abox(k, AM, sub(R.soap, 1, 2), .05, .14, .05, -.55, .57, Z + .705, { ry: -.2 }); k.box(m.yellow, .07, .022, .045, -.72, .511, Z + .705, { bevel: .009 });
      // pedestal sink + mirror cabinet + vanity lights (left wall)
      k.push(-HW, 0, -3.95, { ry: HP });
      k.cyl(m.porc, .075, .1, .72, 0, .36, .2, { seg: 14 }); k.box(m.porc, .52, .16, .44, 0, .8, .22, { bevel: .06 }); k.sphere(m.porcIn, 1, 0, .872, .24, { s: [.19, .03, .14], seg: 16 }); k.cyl(m.chrome, .016, .016, .004, 0, .845, .24, { seg: 8 });
      k.tube(m.chrome, [[0, .88, .05], [0, .98, .05], [0, 1.0, .1], [0, .96, .16]], .011, { seg: 8, steps: 12 }); for (const sx of [-1, 1]) { k.cyl(m.chrome, .014, .018, .035, sx * .11, .895, .05, { seg: 10 }); k.box(m.chrome, .05, .01, .01, sx * .11, .918, .05, { bevel: .004 }); k.box(m.chrome, .01, .01, .05, sx * .11, .918, .05, { bevel: .004 }); }
      k.box(m.plasW, .5, .64, .1, 0, 1.56, .05, { bevel: .012 }); k.box(m.chrome, .46, .008, .012, 0, 1.25, .1); k.box(m.glass, .46, .006, .09, 0, 1.19, .05); for (const sx of [-.18, .18]) k.box(m.chrome, .012, .012, .09, sx, 1.182, .05);
      k.cyl(m.blue, .03, .026, .08, -.15, 1.233, .05, { seg: 12, open: true }); rod(k, m.red, [-.15, 1.2, .05], [-.13, 1.36, .06], .004, .003, 5); rod(k, m.green, [-.16, 1.2, .05], [-.19, 1.35, .04], .004, .003, 5); k.box(m.paper, .12, .028, .03, .08, 1.207, .05, { bevel: .01, ry: .3 }); rod(k, m.plasB, [.13, 1.2, .03], [.2, 1.2, .075], .005, .004, 5); k.box(m.porc, .07, .02, .045, .16, .89, .34, { bevel: .008 }); k.box(m.yellow, .055, .02, .035, .16, .908, .34, { bevel: .009 });
      k.box(m.chrome, .42, .05, .05, 0, 1.97, .03, { bevel: .01 }); for (const sx of [-1, 0, 1]) { k.cyl(m.chrome, .028, .02, .03, sx * .14, 1.97, .07, { rx: HP, seg: 10 }); em('bath', emAt(new T.SphereGeometry(.034, 10, 8), sx * .14, 1.97, .11), k.top); }
      S.bathMirror = { m: k.top.clone(), w: .44, h: .58, x: 0, y: 1.56, z: .1012 };
      k.pop();
      // towel bar + towel on the partition, toilet, plunger, bath mat
      rod(k, m.chrome, [-1.95, 1.2, ZB - .17], [-1.3, 1.2, ZB - .17], .009); for (const tx_ of [-1.95, -1.3]) k.box(m.chrome, .03, .03, .07, tx_, 1.2, ZB - .135, { bevel: .006 });
      k.geo(AMD, surf(8, 22, (u, v) => { const t = v * .95 - .4, a = abs(t); return [-1.84 + u * .38 + .01 * sin(v * 9), 1.212 - Math.sqrt(t * t + .0002) * .98 + .0 * u, ZB - .17 - .014 * Math.tanh(t / .01) + .006 * sin(u * 9 + v * 4) * sst(a, .03, .2)]; }, [R.towel[0], R.towel[3], R.towel[2], R.towel[1]]));
      k.push(-.15, 0, -4.02, { ry: -HP }); k.box(m.porc, .42, .36, .18, 0, .6, .1, { bevel: .025 }); k.box(m.porc, .45, .035, .2, 0, .795, .1, { bevel: .012 }); k.box(m.chrome, .05, .012, .012, -.15, .7, .2, { bevel: .004 }); k.cyl(m.porc, .12, .14, .2, 0, .1, .38, { seg: 14 }); k.sphere(m.porc, 1, 0, .3, .44, { s: [.19, .17, .25], seg: 18 });
      k.cyl(m.porc, .2, .19, .03, 0, .41, .44, { seg: 20 }); k.geo(m.porc, new T.CylinderGeometry(.2, .2, .025, 20), { x: 0, y: .62, z: .225, rx: HP - .12, s: [1, 1, 1.12] });
      k.cyl(m.paper, .055, .055, .1, .12, .868, .1, { seg: 14 }); k.pop();
      k.cyl(m.paper, .055, .055, .1, -.18, .72, -4.42, { seg: 14, rx: HP }); rod(k, m.chrome, [-.15, .72, -4.42], [-.2, .72, -4.42], .006); k.box(m.paper, .1, .12, .002, -.235, .665, -4.42, { ry: 0 });
      rod(k, m.woodL, [-.3, .05, -3.5], [-.26, .62, -3.45], .012, .01, 6); k.sphere(m.rubber, .07, -.3, .05, -3.5, { s: [1, .7, 1], seg: 12, seg2: 8 });
      flat(k, AM, R.rug, .62, .41, -1.15, .004, -4.15, .08); k.decal('water_stain', .8, .7, -1.2, .003, -3.8, 1); k.quad(dGrime, .7, 1.4, -1.6, 1.3, Z + .004, {});
    }

    /* ---------------------------------------------------------------- ceiling fan (static part) */
    const FX = 0, FZ = .3; k.cyl(m.plasW, .07, .05, .05, FX, CH - .025, FZ, { seg: 16 }); k.cyl(m.gold, .012, .012, .2, FX, CH - .14, FZ, { seg: 8 }); k.cyl(m.plasW, .1, .115, .11, FX, CH - .29, FZ, { seg: 20 }); k.cyl(m.gold, .118, .118, .012, FX, CH - .29, FZ, { seg: 20 }); k.cyl(m.plasW, .06, .05, .07, FX, CH - .38, FZ, { seg: 14 });
    em('ceil', emAt(new T.SphereGeometry(.105, 18, 8, 0, TAU, HP, HP), FX, CH - .41, FZ)); k.cyl(m.gold, .108, .108, .014, FX, CH - .412, FZ, { seg: 20 });
    for (const [cx, len] of [[.05, .24], [-.045, .16]]) { rod(k, m.gold, [FX + cx, CH - .4, FZ + .04], [FX + cx, CH - .4 - len, FZ + .045], .0012, .0012, 4); k.sphere(m.gold, .007, FX + cx, CH - .405 - len, FZ + .045, { seg: 6, seg2: 4 }); }

    /* ---------------------------------------------------------------- build static meshes + emissives */
    const root = S.root = new T.Group(); root.name = 'safehouse_interior'; root.position.set(RX, FLOOR, RZ); root.rotation.y = -HP;
    // (R.led is drawn late: see buildAtlas extras)
    const stat = k.build(); stat.name = 'safehouse_static'; root.add(stat); root.add(emBuild());
    return { root, m, AM, AMD, wx, wy, ww, wh, FX, FZ };
  }

  /* ================================================================== moving parts, screens, mirror, backdrop, lights */
  const TVP = { x: -.315, y: 1.088, z: .481, w: .44, h: .33 };                 // screen centre in the dresser frame (root-local: x = HW - z, z = -1.15 + x)
  const TVW = { x: HW - .5, y: 1.088, z: -1.15 + TVP.x };
  const MIR = { x: HW - .5895, y: 1.07, z: -2.62 + .265, w: .4, h: 1.56 };     // wardrobe mirror (root-local), faces -x
  const SLAT = [.12, .75, 1.42], NSLAT = 24;
  const lab = (x0, y0, x1, y1) => { const R = AT.R.labels, w = R[2] - R[0], h = R[3] - R[1]; return [R[0] + w * x0 / 384, R[3] - h * y1 / 256, R[0] + w * x1 / 384, R[3] - h * y0 / 256]; };
  function capture(renderer, scene, camera) { if (camera === S.mirCam || (GT.render && GT.render.mirror && camera === GT.render.mirror.camera)) return; S.renderer = renderer; if (!S.cam || camera.isPerspectiveCamera) S.cam = camera; }

  function buildDynamic(B) {
    const { root, m, AM, wx, wy, ww, wh, FX, FZ } = B, R = AT.R;
    // ---- interior side of the room door (hinged on the +x jamb, swings into the room)
    { const k = GT.kit(); k.box(m.white, .9, 2.03, .044, -.45, 1.02, 0, { bevel: .004 }); k.box(m.white, .6, .7, .012, -.45, 1.5, -.026, { bevel: .006 }); k.box(m.white, .6, .76, .012, -.45, .62, -.026, { bevel: .006 });
      k.box(m.chrome, .05, .18, .008, -.83, 1.03, -.026, { bevel: .003 }); k.cyl(m.chrome, .011, .011, .05, -.83, 1.03, -.05, { rx: HP, seg: 8 }); k.box(m.chrome, .12, .02, .018, -.78, 1.03, -.076, { bevel: .006 }); k.cyl(m.chrome, .026, .026, .018, -.83, 1.19, -.03, { rx: HP, seg: 12 }); k.box(m.chrome, .012, .04, .014, -.83, 1.19, -.046, { bevel: .004 });
      k.box(m.gold, .09, .03, .01, -.84, 1.42, -.027, { bevel: .003 }); for (let i = 0; i < 7; i++) k.geo(m.gold, torus(.007, .0015, TAU, 6), { x: -.87 + .002 * i, y: 1.4 - i * .012, z: -.034, ry: i % 2 ? HP : 0 }); k.cyl(m.chrome, .014, .014, .012, -.45, 1.56, -.026, { rx: HP, seg: 10 });
      aq(k, AM, R.rates, .2, .272, -.45, 1.28, -.0328, { ry: PI, rz: .012 }); aq(k, AM, R.dnd, .078, .178, -.775, .93, -.09, { ry: PI, rz: .05 });
      k.box(m.chrome, .03, .05, .05, -.2, 1.72, -.045, { bevel: .01 }); k.sphere(m.jacket, .085, -.2, 1.66, -.1, { s: [1, .72, 1], seg: 14, seg2: 8 }); k.box(m.jacket, .15, .012, .1, -.2, 1.635, -.19, { bevel: .005, rx: .2 });      // cap on a hook
      k.quad(GT.decalMat('grime_streak'), .8, .6, -.45, .32, -.0225, { ry: PI, rz: PI }); for (const y of [.25, 1.03, 1.82]) k.box(m.galv, .02, .1, .012, -.008, y, -.026);
      const g = k.build(), piv = S.doorPiv = new T.Group(); piv.position.set(DOORX + .45, 0, ZF + .052); piv.add(g); root.add(piv); }
    // ---- ceiling fan blades
    { const k = GT.kit(); for (let i = 0; i < 4; i++) { k.push(0, 0, 0, { ry: i * HP + .2 }); k.box(m.dark, .16, .008, .05, .17, -.03, 0, { bevel: .003 }); k.box(m.woodL, .46, .008, .13, .47, -.035 - (i === 2 ? .012 : 0), 0, { bevel: .004, rx: .2, rz: i === 2 ? -.03 : 0 }); k.cyl(m.woodL, .065, .065, .008, .7, -.035 - (i === 2 ? .02 : 0), 0, { seg: 12, rx: .2 }); k.pop(); }
      const g = S.fanG = k.build(); g.position.set(FX, CH - .29, FZ); root.add(g); }
    // ---- fridge door (hinged on the wall side) + the three things you can eat
    { const k = GT.kit(), fx = S.fr.x; k.box(m.enamel, .56, .76, .05, -.28, .48, .025, { bevel: .012 }); k.box(m.plasG, .52, .72, .012, -.28, .48, -.004); k.box(m.plasW, .48, .68, .03, -.28, .48, -.02, { bevel: .01 });
      for (const y of [.24, .5]) { k.box(m.plasW, .44, .012, .08, -.28, y, -.07, { bevel: .004 }); k.box(m.plasW, .44, .06, .008, -.28, y + .03, -.108, { bevel: .003 }); }
      abox(k, AM, lab(196, 132, 288, 256), .05, .15, .05, -.4, .325, -.07, {}); k.cyl(m.red, .014, .02, .03, -.4, .415, -.07, { seg: 8 }); acyl(k, AM, lab(292, 132, 384, 256), .034, .2, -.2, .35, -.07, {}); k.cyl(m.green, .014, .03, .05, -.2, .475, -.07, { seg: 10 }); k.cyl(m.glass, .028, .028, .1, -.14, .56, -.07, { seg: 10 }); k.box(m.yellow, .12, .04, .05, -.36, .53, -.07, { bevel: .01 });
      k.box(m.chrome, .02, .3, .028, -.52, .58, .064, { bevel: .009 }); aq(k, AM, R.menu, .125, .188, -.2, .56, .0508, { rz: .05 }); aq(k, AM, sub(R.polaroid, 0, 3), .07, .088, -.4, .7, .0508, { rz: -.1 }); aq(k, AM, R.scratch, .09, .052, -.38, .36, .0508, { rz: .2 });
      for (const [mx, my, mm] of [[-.2, .665, m.red], [-.4, .752, m.blue], [-.34, .39, m.yellow], [-.1, .3, m.green]]) k.cyl(mm, .012, .012, .006, mx, my, .054, { rx: HP, seg: 10 }); k.quad(GT.decalMat('rust_run'), .4, .3, -.28, .22, .0506, {});
      const g = k.build(), piv = S.fridgePiv = new T.Group(); piv.position.set(fx + .28, 0, ZR + .58); piv.add(g); root.add(piv);
      const items = S.fridgeItems = new T.Group(), fz = S.fr.z; items.visible = false; root.add(items);
      const one = fn => { const kk = GT.kit(); fn(kk); const gg = kk.build(); items.add(gg); return gg; };
      S.food = [one(kk => abox(kk, AM, lab(0, 0, 96, 256), .07, .19, .07, fx - .06, .31 + .095, fz + .02, { ry: .3 })), one(kk => acyl(kk, AM, lab(100, 132, 192, 256), .033, .12, fx + .05, .51 + .06, fz + .1, {})), one(kk => abox(kk, AM, lab(196, 0, 384, 128), .17, .07, .12, fx - .02, .1 + .036, fz + .12, { ry: -.15 }))]; }
    // ---- venetian slats (instanced, cast the stripes)
    { const g = new T.BoxGeometry(ww - .07, .0018, .05), im = S.slats = new T.InstancedMesh(g, m.cream, NSLAT); im.castShadow = true; im.receiveShadow = true; im.name = 'safehouse_blinds'; S.slatBase = { x: wx, y: wy + wh / 2 - .072, z: ZF - .035 }; root.add(im); setSlats(S.slat); }
    // ---- ribbons tied to the AC grille
    { const g = new T.BufferGeometry(), n = 3, seg = 7, P = new Float32Array(n * (seg + 1) * 2 * 3), I = []; for (let r = 0; r < n; r++) for (let j = 0; j < seg; j++) { const a = (r * (seg + 1) + j) * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      g.setAttribute('position', new T.BufferAttribute(P, 3)); g.setIndex(I); const mesh = S.ribbons = new T.Mesh(g, std({ color: GT.C(0xb8452e), roughness: .7, side: T.DoubleSide })); mesh.frustumCulled = false; S.ribSeg = seg; S.ribBase = [[wx - .16, .75, ZF - .215], [wx + .02, .72, ZF - .215], [wx + .2, .76, ZF - .215]]; root.add(mesh); }
    // ---- TV screen (canvas texture)
    { const c = S.tvC = document.createElement('canvas'); c.width = 512; c.height = 384; S.tvG = c.getContext('2d'); const tex = S.tvTex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding; tex.minFilter = T.LinearFilter; tex.generateMipmaps = false;
      const g = surf(10, 8, (u, v) => [(u - .5) * TVP.w, (.5 - v) * TVP.h, .014 * (1 - (Math.pow(2 * u - 1, 2) + Math.pow(2 * v - 1, 2)) / 2)], [0, 1, 1, 0]);
      const mesh = S.tvMesh = new T.Mesh(g, new T.MeshBasicMaterial({ map: tex, fog: false })), grp = new T.Group(); grp.position.set(HW, 0, -1.15); grp.rotation.y = -HP; mesh.position.set(TVP.x, TVP.y, TVP.z); grp.add(mesh); root.add(grp); }
    // ---- wardrobe mirror: planar reflection rendered into a small target from the mirrored camera
    { const rt = S.mirRT = new T.WebGLRenderTarget(384, 1024, { minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat, type: T.HalfFloatType, depthBuffer: true, stencilBuffer: false }); rt.texture.generateMipmaps = false;
      const mat = new T.ShaderMaterial({ uniforms: { tD: { value: rt.texture }, uM: { value: new T.Matrix4() } }, toneMapped: false,
        vertexShader: 'uniform mat4 uM; varying vec4 vP; varying vec2 vUv; void main(){ vUv = uv; vP = uM * vec4(position, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D tD; varying vec4 vP; varying vec2 vUv;\nfloat h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nvoid main(){ vec3 c = texture2DProj(tD, vP).rgb * vec3(.84, .88, .86);\n vec2 e = min(vUv, 1.0 - vUv); float edge = smoothstep(.0, .06, min(e.x * 3.9, e.y)); float spot = step(.985, h(floor(vUv * vec2(90., 350.)))) * (1.0 - smoothstep(.0, .2, min(e.x * 3.9, e.y)));\n c = mix(vec3(.05, .045, .04), c, edge * (1.0 - spot * .8)); c += vec3(.012, .011, .010) * (.5 + .5 * h(floor(vUv * vec2(40., 160.))));\n gl_FragColor = vec4(c, 1.0);\n #include <encodings_fragment>\n }' });
      const mesh = S.mirror = new T.Mesh(new T.PlaneGeometry(MIR.w, MIR.h), mat); mesh.position.set(MIR.x, MIR.y, MIR.z); mesh.rotation.y = -HP; mesh.name = 'safehouse_mirror'; root.add(mesh);
      const vc = S.mirCam = new T.PerspectiveCamera(), wp = new T.Vector3(), cp = new T.Vector3(), nrm = new T.Vector3(), view = new T.Vector3(), look = new T.Vector3(), tgt = new T.Vector3(), rm = new T.Matrix4(), plane = new T.Plane(), cpl = new T.Vector4(), q = new T.Vector4();
      const bs = new T.Vector2(); mesh.onBeforeRender = function (renderer, scene, camera) { if (S.mirBusy || camera === vc || S.pre) return; capture(renderer, scene, camera);
        renderer.getDrawingBufferSize(bs); const rw = Math.min(1600, Math.max(256, bs.x | 0)), rh = Math.max(144, Math.round(rw * bs.y / Math.max(1, bs.x))); if (rt.width !== rw || rt.height !== rh) rt.setSize(rw, rh);
        wp.setFromMatrixPosition(mesh.matrixWorld); cp.setFromMatrixPosition(camera.matrixWorld); rm.extractRotation(mesh.matrixWorld); nrm.set(0, 0, 1).applyMatrix4(rm); view.subVectors(wp, cp); if (view.dot(nrm) > 0) return;
        view.reflect(nrm).negate().add(wp); rm.extractRotation(camera.matrixWorld); look.set(0, 0, -1).applyMatrix4(rm).add(cp); tgt.subVectors(wp, look).reflect(nrm).negate().add(wp);
        vc.position.copy(view); vc.up.set(0, 1, 0).applyMatrix4(rm).reflect(nrm); vc.lookAt(tgt); vc.far = camera.far; vc.near = camera.near; vc.updateMatrixWorld(); vc.projectionMatrix.copy(camera.projectionMatrix); vc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
        mat.uniforms.uM.value.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1).multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse).multiply(mesh.matrixWorld);
        plane.setFromNormalAndCoplanarPoint(nrm, wp).applyMatrix4(vc.matrixWorldInverse); cpl.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant); const pm = vc.projectionMatrix.elements;
        q.x = (Math.sign(cpl.x) + pm[8]) / pm[0]; q.y = (Math.sign(cpl.y) + pm[9]) / pm[5]; q.z = -1; q.w = (1 + pm[10]) / pm[14]; cpl.multiplyScalar(2 / cpl.dot(q)); pm[2] = cpl.x; pm[6] = cpl.y; pm[10] = cpl.z + 1 - .003; pm[14] = cpl.w;
        S.mirBusy = true; mesh.visible = false; const cur = renderer.getRenderTarget(), au = renderer.shadowMap.autoUpdate, ac = renderer.autoClear; renderer.shadowMap.autoUpdate = false; renderer.autoClear = true;
        try { renderer.setRenderTarget(rt); renderer.state.buffers.depth.setMask(true); renderer.clear(); renderer.render(scene, vc); } finally { renderer.shadowMap.autoUpdate = au; renderer.autoClear = ac; renderer.setRenderTarget(cur); mesh.visible = true; S.mirBusy = false; }
        const vp = camera.viewport; if (vp !== undefined) renderer.state.viewport(vp); }; }
    // ---- bathroom mirror: cheap (reflects the interior environment map)
    { const b = S.bathMirror, g = new T.PlaneGeometry(b.w, b.h); g.translate(b.x, b.y, b.z); g.applyMatrix4(b.m); const mm = std({ color: 0xc8d2cf, metalness: 1, roughness: .07 }); mm.envMapIntensity = 1.6; const mesh = new T.Mesh(g, mm); root.add(mesh); }
    // ---- sink stream (only while washing)
    { const g = new T.CylinderGeometry(.004, .006, .1, 6); g.translate(0, .9, .16); g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(-HW, 0, -3.95), new T.Quaternion().setFromEuler(new T.Euler(0, HP, 0)), ONE)); const mesh = S.stream = new T.Mesh(g, new T.MeshBasicMaterial({ color: 0xbfd6e0, transparent: true, opacity: .7 })); mesh.visible = false; root.add(mesh); }
    // ---- what is outside the window + god rays
    { const mat = S.bdMat = new T.ShaderMaterial({ uniforms: { tA: { value: backdropTex(false) }, tB: { value: backdropTex(true) }, uN: { value: 0 }, uG: { value: 3 }, uF: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D tA; uniform sampler2D tB; uniform float uN; uniform float uG; uniform float uF; varying vec2 vUv;\nvoid main(){ vec3 a = pow(texture2D(tA, vUv).rgb, vec3(2.2)); vec3 b = pow(texture2D(tB, vUv).rgb, vec3(2.2)); b *= mix(1.0, uF, smoothstep(.0, .5, vUv.x) * (1.0 - smoothstep(.4, .7, vUv.x)));\n vec3 dusk = a * vec3(.55, .28, .34) + b * .5; vec3 c = uN < .5 ? mix(a, dusk, uN * 2.0) : mix(dusk, b, uN * 2.0 - 1.0); gl_FragColor = vec4(c * uG, 1.0);\n #include <tonemapping_fragment>\n #include <encodings_fragment>\n }' });
      const mesh = new T.Mesh(new T.PlaneGeometry(4.6, 3.07), mat); mesh.position.set(wx + .25, wy + .12, ZF + .85); mesh.rotation.y = PI; mesh.name = 'safehouse_backdrop'; root.add(mesh);
      const lp = new T.Vector3(-.1, 2.84, 8.64), tg = new T.Vector3(-1.0, .6, -1.0), d = tg.clone().sub(lp).normalize(), P = [], U = [], I = [], L = 4.6; S.sunPos = lp; S.sunTgt = tg;
      for (let i = 0; i < 6; i++) { const x = wx - .72 + i * .288, y0 = wy - .56, y1 = wy + .56, z = ZF - .07, a = P.length / 3; P.push(x, y0, z, x, y1, z, x + d.x * L, y1 + d.y * L, z + d.z * L, x + d.x * L, y0 + d.y * L, z + d.z * L); U.push(0, 0, 0, 1, 1, 1, 1, 0); I.push(a, a + 1, a + 2, a, a + 2, a + 3); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setIndex(I);
      const sm = S.shaftMat = new T.MeshBasicMaterial({ map: shaftTex(), blending: T.AdditiveBlending, transparent: true, depthWrite: false, side: T.DoubleSide, fog: false }); const sh = S.shafts = new T.Mesh(g, sm); sh.renderOrder = 5; sh.name = 'safehouse_shafts'; root.add(sh); }
    // ---- carpet wear paths
    { const wm = std({ map: wearTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, roughness: 1 }); const mesh = new T.Mesh(new T.PlaneGeometry(2 * HW, 2 * ZF), wm); mesh.rotation.x = -HP; mesh.position.y = .002; mesh.receiveShadow = true; root.add(mesh); }

    /* ---------------------------------------------------------------- light rig (children of the root: only exists while the set is visible) */
    const L = S.L = {}, LG = new T.Group(); LG.name = 'safehouse_lights'; root.add(LG);
    const sun = L.sun = new T.SpotLight(0xffffff, 1, 24, .215, .3, 1.1); sun.position.copy(S.sunPos); sun.target.position.copy(S.sunTgt); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.near = 3.5; sun.shadow.camera.far = 17; sun.shadow.bias = -.0006; sun.shadow.normalBias = .012; sun.shadow.radius = 1.5; LG.add(sun, sun.target);
    const pl = (name, x, y, z, dist) => { const l = L[name] = new T.PointLight(0xffffff, 1, dist, 2); l.position.set(x, y, z); LG.add(l); return l; };
    pl('lamp', -1.82, 1.03, -.07, 5.2); pl('ceil', 0, 2.18, .3, 9); pl('tv', TVW.x - .35, 1.1, TVW.z, 5); pl('bath', -1.55, 1.9, -3.95, 4.2); pl('kit', .7, 1.36, ZR + .32, 3.4); pl('fridge', 1.72, .5, ZR + .62, 2.8);
    L.hemi = new T.HemisphereLight(0xffffff, 0xffffff, 1); LG.add(L.hemi);
    root.traverse(o => { if (o.isMesh && !o.onBeforeRenderSet && o !== S.mirror) { const prev = o.onBeforeRender; o.onBeforeRender = capture; o.onBeforeRenderSet = true; } });
  }
  const _sm = new T.Matrix4(), _sq = new T.Quaternion(), _se = new T.Euler(), _sp = new T.Vector3();
  function setSlats(a) { const im = S.slats, b = S.slatBase; if (!im) return; for (let i = 0; i < NSLAT; i++) { const bent = i === 9 ? .22 : i === 15 ? -.12 : 0; _se.set(-(a + (hsh(i * 3.3) - .5) * .08 + bent), 0, i === 9 ? .018 : (hsh(i) - .5) * .004); _sp.set(b.x, b.y - i * .046 - (i === 9 ? .006 : 0), b.z); im.setMatrixAt(i, _sm.compose(_sp, _sq.setFromEuler(_se), ONE)); } im.instanceMatrix.needsUpdate = true; }

  /* ---------------------------------------------------------------- interior environment map (tiny emissive proxy of the room -> PMREM) */
  const ENV = { scene: null, q: {}, pmrem: null, rt: null };
  function envBuild() { const sc = ENV.scene = new T.Scene(), mk = (name, w, h, x, y, z, rx, ry) => { const q = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: 0, side: T.DoubleSide })); q.position.set(x, y, z); q.rotation.set(rx || 0, ry || 0, 0); sc.add(q); ENV.q[name] = q.material; };
    const box = new T.Mesh(new T.BoxGeometry(4.2, 2.7, 8.5), new T.MeshBasicMaterial({ color: 0, side: T.BackSide })); box.position.set(0, .15, -1); sc.add(box); ENV.q.box = box.material;
    mk('floor', 4.1, 8.4, 0, -1.19, -1, -HP); mk('ceil', 4.1, 8.4, 0, 1.49, -1, HP); mk('win', 1.7, 1.2, -.6, .4, 3.2, 0, PI); mk('lamp', .3, .3, -2.0, -.2, -.1, 0, HP); mk('tv', .5, .38, 1.6, -.1, -1.45, 0, -HP); mk('cl', .5, .5, 0, 1.2, .3, HP); mk('bath', .8, 2.0, -.6, -.2, -3.3, 0, 0); mk('kit', .7, .1, .7, .2, -5.0, 0, 0); }
  function envUpdate() { const r = S.renderer || (GT.render && GT.render.renderer); if (!r) return false; if (!ENV.scene) envBuild(); if (!ENV.pmrem) ENV.pmrem = new T.PMREMGenerator(r);
    const L = S.L, q = ENV.q, amb = S.amb || new T.Color(.1, .08, .06), set = (m, c, k) => m.color.copy(c).multiplyScalar(k);
    set(q.box, amb, .55); q.floor.color.copy(amb).multiplyScalar(.25); set(q.ceil, amb, .7); set(q.win, S.bdCol || amb, 1); set(q.lamp, L.lamp.color, L.lamp.intensity * 6); set(q.tv, L.tv.color, L.tv.intensity * 4); set(q.cl, L.ceil.color, L.ceil.intensity * 5); set(q.bath, L.bath.color, L.bath.intensity * .5); set(q.kit, L.kit.color, L.kit.intensity * 4);
    const old = ENV.rt, cur = r.getRenderTarget(); ENV.rt = ENV.pmrem.fromScene(ENV.scene, .03, .1, 30); r.setRenderTarget(cur); for (const m of envMats) m.envMap = ENV.rt.texture; if (S.inside && S.scene) S.scene.environment = ENV.rt.texture; if (old) old.dispose(); return true; }

  /* ================================================================== exterior: the door of room 106 on the real motel */
  function buildExterior(scene) {
    const R = AT.R, teal = GT.mat('metal_painted_white', { color: 0x5aa59c }), AX = new T.MeshStandardMaterial({ map: AT.tex, roughness: .8, metalness: 0 }), PW = GT.mat('plastic_white'), CR = GT.mat('chrome'), AL = GT.mat('aluminium_brushed');
    const g = S.ext = new T.Group(); g.name = 'safehouse_exterior'; g.position.set(EXT.x, FLOOR, EXT.z); g.rotation.y = -HP; scene.add(g);                 // local +z = out of the wall (world -x), +x = world +z
    // the opening: darkness with a hint of lamp + TV, shown only while the slab swings
    const vc = document.createElement('canvas'); vc.width = 64; vc.height = 128; const vg = vc.getContext('2d'); vg.fillStyle = '#050403'; vg.fillRect(0, 0, 64, 128); blob(vg, 14, 70, 26, 34, 'rgba(255,170,90,1)', .5); blob(vg, 50, 62, 18, 16, 'rgba(120,170,255,1)', .35); vg.fillStyle = 'rgba(0,0,0,.6)'; vg.fillRect(0, 100, 64, 28);
    const vt = new T.CanvasTexture(vc); vt.encoding = T.sRGBEncoding; const vm = new T.MeshBasicMaterial({ map: vt, fog: false }), black = new T.MeshBasicMaterial({ color: 0 }); const VG = S.extVoid = new T.Group(); VG.visible = false; g.add(VG);
    const vq = new T.Mesh(new T.PlaneGeometry(.92, 2.06), vm); vq.position.set(0, 1.03, .0672); VG.add(vq); const lv = new T.Mesh(new T.BoxGeometry(.2, .3, .062), black); lv.position.set(-.37, 1.06, .096); VG.add(lv);
    // my slab (covers the motel's static door), hinged on the +x side, opens outward
    { const k = GT.kit(); k.box(teal, .912, 2.052, .05, -.456, 1.034, .03, { bevel: .004 }); k.box(teal, .62, .74, .012, -.456, 1.5, .058, { bevel: .005 }); k.box(teal, .62, .66, .012, -.456, .66, .058, { bevel: .005 }); k.box(AL, .86, .2, .004, -.456, .13, .0565);
      k.box(CR, .055, .2, .008, -.826, 1.06, .058, { bevel: .003 }); k.cyl(CR, .011, .011, .05, -.826, 1.0, .08, { rx: HP, seg: 8 }); k.box(CR, .12, .02, .016, -.778, 1.0, .104, { bevel: .005 }); k.cyl(CR, .024, .024, .014, -.826, 1.12, .064, { rx: HP, seg: 12 }); k.cyl(CR, .012, .012, .012, -.456, 1.52, .062, { rx: HP, seg: 10 });
      aq(k, AX, R.num, .17, .085, -.456, 1.69, .0562); aq(k, AX, R.sticker, .2, .06, -.44, 1.33, .0562, { rz: .04 }); k.quad(GT.decalMat('grime_streak'), .85, .7, -.456, .36, .0563, { rz: PI }); k.box(GT.mat('plastic_white', { color: 0xe6e0cc }), .1, .15, .002, -.9, .9, .06, { rz: .3 });
      const d = k.build(), piv = S.extPiv = new T.Group(); piv.position.set(.456, 0, .042); piv.add(d); g.add(piv); d.traverse(o => { if (o.isMesh) o.onBeforeRender = capture; }); }
    // lived-in doorstep: mat, lawn chair, cooler, coffee-can ashtray, flip-flops, rolled newspaper
    { const k = GT.kit(); k.box('rubber', .8, .014, .5, 0, .007, .42, { bevel: .004 }); k.decal('grime_streak', 1.0, .8, 0, .016, .5, 0);
      k.push(-1.38, 0, .62, { ry: .25 }); k.box(PW, .46, .025, .42, 0, .41, 0, { bevel: .01 }); k.box(PW, .44, .42, .025, 0, .66, -.22, { bevel: .01, rx: -.18 }); for (let i = 0; i < 4; i++) k.box(GT.mat('plastic_grey'), .012, .3, .004, -.15 + i * .1, .68, -.2, { rx: -.18 }); for (const sx of [-1, 1]) { rod(k, PW, [sx * .2, .41, .18], [sx * .25, 0, .24], .022, .018, 6); rod(k, PW, [sx * .2, .41, -.18], [sx * .24, 0, -.3], .022, .018, 6); k.box(PW, .05, .02, .42, sx * .24, .62, -.02, { bevel: .008 }); rod(k, PW, [sx * .24, .62, .18], [sx * .22, .41, .19], .018, .018, 6); } k.pop();
      k.box('plastic_red', .46, .26, .3, -2.02, .13, .36, { bevel: .02, ry: -.1 }); k.box(PW, .48, .06, .32, -2.02, .29, .36, { bevel: .018, ry: -.1 }); k.geo(PW, torus(.12, .01, PI, 10), { x: -2.02, y: .32, z: .36, ry: -.1 });
      k.cyl('metal_rust', .05, .05, .13, -.72, .065, .2, { seg: 12 }); for (let i = 0; i < 5; i++) k.cyl(PW, .004, .004, .03, -.72 + (hsh(i) - .5) * .05, .14, .2 + (hsh(i * 3) - .5) * .05, { rz: .5 + hsh(i), seg: 5 });
      for (const [fx, a] of [[.62, .3], [.74, -.2]]) { k.box('rubber', .1, .018, .26, fx, .023, .34, { bevel: .008, ry: a }); k.geo('plastic_red', torus(.04, .005, PI, 8), { x: fx, y: .03, z: .4, ry: a + HP }); }
      k.cyl(GT.mat('plastic_white', { color: 0xd8d2c0 }), .035, .035, .3, -.2, .05, .72, { rz: HP, ry: .4, seg: 10 });
      const st = k.build(); g.add(st); GT.world.addBox(EXT.x - .9, EXT.z - 1.66, EXT.x - .36, EXT.z - 1.1, .8, 'safehouse-chair'); GT.world.addBox(EXT.x - .54, EXT.z - 2.27, EXT.x - .2, EXT.z - 1.77, .42, 'safehouse-cooler'); }
    // light leaking under the door at night
    const gm = new T.MeshBasicMaterial({ color: 0, fog: false }); GT.glow(gm, new T.Color(1, .6, .28), 0, 2.4); const gl = new T.Mesh(new T.PlaneGeometry(.84, .014), gm); gl.position.set(0, .012, .0925); g.add(gl);
  }

  /* ================================================================== colliders + indoor zone */
  function cbox(x0, z0, x1, z1, h, tag) { const a = W(x0, z0), b = W(x1, z1); GT.world.addBox(a.x, a.z, b.x, b.z, h + FLOOR, 'safehouse-' + (tag || 'prop')); }
  function hollowWing() { if (S.hollow) return; const B = GT.world.boxes, i = B.findIndex(b => b.tag === 'motel-wingE'), zl = RZ - HW, zh = RZ + HW, xf = RX - ZF, xr = RX - ZR;
    if (i >= 0) { const b = B[i], x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1, h = b.h; B.splice(i, 1); GT.world.addBox(x0, z0, x1, zl, h, 'motel-wingE'); GT.world.addBox(x0, zh, x1, z1, h, 'motel-wingE'); GT.world.addBox(x0, zl, xf, zh, h, 'motel-wingE'); GT.world.addBox(xr, zl, x1, zh, h, 'motel-wingE'); S.hollow = true; }
    else if (!S.ownWalls) { S.ownWalls = true; GT.world.addBox(xf - 1, zl - 1, xr + 1, zl, 7, 'safehouse-wall'); GT.world.addBox(xf - 1, zh, xr + 1, zh + 1, 7, 'safehouse-wall'); GT.world.addBox(xf - 1, zl, xf, zh, 7, 'safehouse-wall'); GT.world.addBox(xr, zl, xr + 1, zh, 7, 'safehouse-wall'); }
    if (GT.onfoot && GT.onfoot.refreshColliders) GT.onfoot.refreshColliders(); }
  function colliders() {
    cbox(-HW, ZB - .1, -1.0, ZB, CH, 'partition'); cbox(-.2, ZR, -.05, ZB, CH, 'divider');
    cbox(-HW, -1.93, -.02, -.37, .7, 'bed'); cbox(-HW, -2.42, -1.62, -1.93, .6, 'nightstand'); cbox(-HW, -.37, -1.62, .12, 1.1, 'nightstand'); cbox(-2.07, -3.08, -1.63, -2.64, .5, 'basket');
    cbox(-HW, 1.18, -1.3, 2.32, .78, 'table'); cbox(-1.92, .64, -1.48, 1.08, .9, 'chair'); cbox(-1.27, 1.68, -.8, 2.14, .98, 'chair');
    cbox(1.6, -1.82, HW, -.48, 1.35, 'dresser'); cbox(1.5, -3.16, HW, -2.08, 2.05, 'wardrobe'); cbox(1.8, .5, HW, 1.42, .9, 'bookcase'); cbox(1.84, -.34, HW, .3, .63, 'tyre'); cbox(1.68, 1.68, HW, 2.18, .4, 'toolbox');
    cbox(-.96, 3.03, -.24, ZF, .9, 'ac'); cbox(-.05, ZR, 1.44, ZR + .63, .92, 'counter'); cbox(1.45, ZR, HW, ZR + .62, 1.2, 'fridge'); cbox(0, -4.56, .28, -4.28, .4, 'trash');
    cbox(-HW, ZR, -.15, ZR + .78, .55, 'tub'); cbox(-HW, -4.2, -1.62, -3.7, .9, 'sink'); cbox(-.86, -4.25, -.15, -3.79, .8, 'toilet');
  }
  function addZone() { if (S.zoned || !GT.onfoot || !GT.onfoot.addZone) return; S.zoned = true; const a = W(-HW, ZR), b = W(HW, ZF); GT.onfoot.addZone({ id: 'safehouse', x0: a.x, x1: b.x, z0: a.z, z1: b.z, indoor: true, floor: FLOOR, ceil: FLOOR + CH }); if (GT.onfoot.refreshColliders) GT.onfoot.refreshColliders(); }

  /* ================================================================== television: five original, fully procedural programmes on a 512x384 canvas
     every programme is a pure function of its own clock (so &at= can jump anywhere) and returns the mean screen colour for the room glow */
  const TW = 512, TH = 384, SERIF = "'Songti SC','STSong','Times New Roman',serif";
  const tvCap = (g, s, y) => tx(g, s, TW / 2, y || 346, 21, '#fff', { a: 'center', ol: '#000', olw: 5, max: TW - 24 });
  const tvBug = (g, s, col) => { g.fillStyle = col; rr(g, TW - 112, 12, 100, 26, 5); g.fill(); tx(g, s, TW - 62, 26, 14, '#fff', { a: 'center' }); };
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  function tvNature(g, t) { t %= 28; let c;
    if (t < 7) { const k = 1 + t * .012; g.save(); g.translate(TW / 2, TH / 2); g.scale(k, k); g.translate(-TW / 2, -TH / 2); g.fillStyle = grad(g, 0, 0, 0, TH, [0, '#f08a4a', .5, '#f6c58a', .6, '#e89a8a', 1, '#5a3a5a']); g.fillRect(0, 0, TW, TH); blob(g, 360, 190, 150, 110, 'rgba(255,240,200,1)', .9); ell(g, 360, 196, 34, 34, '#fff4d0');
      g.fillStyle = '#6a4a6a'; g.fillRect(0, 230, TW, TH); for (let i = 0; i < 9; i++) { g.fillStyle = 'rgba(255,220,170,' + (.4 - i * .04) + ')'; g.fillRect(320 - i * 14, 236 + i * 9, 80 + i * 28, 3); }
      const bob = sin(t * 1.3) * 4, X = 190, Y = 300; g.strokeStyle = '#e86a8a'; g.lineCap = 'round'; g.lineWidth = 6; g.beginPath(); g.moveTo(X, Y); g.lineTo(X, Y - 96); g.stroke(); g.beginPath(); g.moveTo(X + 8, Y - 96); g.lineTo(X + 26, Y - 64); g.lineTo(X + 10, Y - 44); g.stroke();
      ell(g, X + 4, Y - 118 + bob * .3, 46, 28, '#f07a9a', -.12); ell(g, X - 18, Y - 122 + bob * .3, 30, 18, '#e86a8a', .3); g.lineWidth = 11; g.strokeStyle = '#f07a9a'; g.beginPath(); g.moveTo(X + 36, Y - 128); g.bezierCurveTo(X + 84, Y - 160, X + 14, Y - 204 + bob, X + 58, Y - 232 + bob); g.stroke(); ell(g, X + 66, Y - 236 + bob, 15, 12, '#f07a9a'); g.fillStyle = '#2a1a1a'; g.beginPath(); g.moveTo(X + 76, Y - 240 + bob); g.lineTo(X + 104, Y - 228 + bob); g.lineTo(X + 78, Y - 226 + bob); g.fill(); ell(g, X + 68, Y - 240 + bob, 2.5, 2.5, '#111');
      for (let i = 0; i < 14; i++) { g.strokeStyle = '#3a2a3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(20 + i * 37, TH); g.quadraticCurveTo(26 + i * 37 + sin(t + i) * 6, TH - 50, 14 + i * 37 + sin(t * .8 + i) * 10, TH - 90 - (i % 3) * 22); g.stroke(); } g.restore();
      if (t < 2.4) { g.fillStyle = 'rgba(0,0,0,' + (.45 * (1 - seg(t, 1.8, 2.4))) + ')'; g.fillRect(0, 0, TW, TH); g.globalAlpha = 1 - seg(t, 1.8, 2.4); tx(g, '湿地之王', TW / 2, 150, 76, '#ffe9a8', { a: 'center', f: SERIF, ol: '#5a2a10', olw: 8 }); tx(g, '第 3 集 · 站着', TW / 2, 214, 24, '#fff', { a: 'center', f: SERIF }); g.globalAlpha = 1; }
      else tvCap(g, t < 4.8 ? '火烈鸟。它单腿站立，已经四十分钟了。' : '没有人知道为什么。它自己也不知道。'); c = [.95, .6, .45]; }
    else if (t < 14) { const u = t - 7; g.fillStyle = grad(g, 0, 0, 0, TH, [0, '#3a5a3a', .3, '#2a4a34', 1, '#16281e']); g.fillRect(0, 0, TW, TH); for (let i = 0; i < 30; i++) ell(g, (i * 97 + u * 6) % TW, 60 + (i * 53) % 300, 16 + i % 5 * 4, 3, 'rgba(120,160,90,.25)');
      const X = -60 + u * 78, Y = 210 + sin(u * 2) * 3; g.strokeStyle = 'rgba(200,230,190,.35)'; g.lineWidth = 2; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(X + 60, Y); g.lineTo(X - i * 46, Y - i * 13); g.moveTo(X + 60, Y); g.lineTo(X - i * 46, Y + i * 13); g.stroke(); }
      ell(g, X, Y, 70, 13, '#1c2a18'); ell(g, X + 62, Y + 1, 30, 8, '#1c2a18'); for (const ex of [-8, 16]) { ell(g, X + ex, Y - 12, 10, 8, '#22321c'); ell(g, X + ex, Y - 13, 5, 4, '#d8c84a'); g.fillStyle = '#111'; g.fillRect(X + ex - 1, Y - 17, 2, 8); } for (let i = 0; i < 6; i++) ell(g, X - 30 - i * 13, Y - 9, 5, 4, '#22321c');
      const dx = 380 + sin(u * 3) * 40, dy = 110 + cos(u * 4.1) * 24; g.strokeStyle = '#9ad8e8'; g.lineWidth = 3; g.beginPath(); g.moveTo(dx - 14, dy); g.lineTo(dx + 14, dy); g.stroke(); ell(g, dx - 4, dy - 5, 10, 3, 'rgba(220,240,255,.6)', .5); ell(g, dx + 4, dy - 5, 10, 3, 'rgba(220,240,255,.6)', -.5);
      tvCap(g, u < 3.5 ? '短吻鳄，缓缓逼近……' : '……它只是路过。它要去便利店。'); c = [.2, .34, .22]; }
    else if (t < 21) { const u = t - 14; g.fillStyle = grad(g, 0, 0, 0, TH, [0, '#5aa8e0', .55, '#bfe0f0', .56, '#2a6a9a', 1, '#16405a']); g.fillRect(0, 0, TW, TH); for (let i = 0; i < 5; i++) blob(g, (i * 130 + u * 9) % 600 - 40, 50 + i * 22, 70, 16, 'rgba(255,255,255,1)', .7);
      let X, Y, rot = 0, sub_ = false; if (u < 2.6) { X = 60 + u * 96; Y = 96 - sin(u * 1.2) * 20; } else if (u < 3.4) { const k = (u - 2.6) / .8; X = 310 + k * 30; Y = 80 + k * k * 150; rot = k * 1.3; } else if (u < 4.4) { X = 344; Y = 240; sub_ = true; } else { const k = min(1, (u - 4.4) / 1.2); X = 344 + k * 50; Y = 226 - k * 70 + sin(u * 5) * 3; rot = -.2; }
      if (u > 3.3 && u < 5.2) { const k = (u - 3.3) / 1.9; g.strokeStyle = 'rgba(255,255,255,' + (1 - k) + ')'; g.lineWidth = 4; for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(344, 216, 20 + k * 90 + i * 16, 5 + k * 16 + i * 3, 0, 0, TAU); g.stroke(); } for (let i = 0; i < 9; i++) ell(g, 344 + (i - 4) * 12, 210 - sin(k * PI) * (50 + i % 3 * 26), 4, 6, 'rgba(255,255,255,' + (1 - k) + ')'); }
      if (!sub_) { g.save(); g.translate(X, Y); g.rotate(rot); ell(g, 0, 0, 44, 22, '#e8e2d2'); g.fillStyle = '#b8b2a2'; g.beginPath(); g.moveTo(-20, -8); g.lineTo(-74, -40 + sin(u * 9) * 22); g.lineTo(-10, 6); g.fill(); ell(g, 42, -18, 16, 14, '#e8e2d2'); g.fillStyle = '#e0a03a'; g.beginPath(); g.moveTo(52, -24); g.lineTo(116, -8); g.lineTo(54, 2); g.fill(); g.fillStyle = '#c88a2a'; g.beginPath(); g.moveTo(56, -4); g.quadraticCurveTo(84, 26, 110, -8); g.fill(); ell(g, 44, -22, 3, 3, '#111');
        if (u > 4.4) { g.fillStyle = '#e84a6a'; rr(g, 96, -6, 44, 16, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 3; g.beginPath(); g.moveTo(104, -6); g.lineTo(116, 4); g.lineTo(128, -6); g.stroke(); } g.restore(); }
      tvCap(g, u < 3.3 ? '鹈鹕锁定了猎物。' : u < 4.6 ? '俯冲！' : '收获：一只人字拖。'); c = [.5, .72, .88]; }
    else { const u = t - 21; g.fillStyle = grad(g, 0, 0, 0, TH, [0, '#3aa0a8', 1, '#0e3a4a']); g.fillRect(0, 0, TW, TH); for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(200,255,240,.08)'; g.beginPath(); g.moveTo(60 + i * 80 + sin(u + i) * 10, 0); g.lineTo(110 + i * 80, 0); g.lineTo(40 + i * 90, TH); g.lineTo(-20 + i * 90, TH); g.fill(); }
      const X = 250 + sin(u * .5) * 30, Y = 190 + sin(u * .9) * 12; g.save(); g.translate(X, Y); g.rotate(sin(u * .6) * .08); ell(g, 0, 0, 150, 62, '#8a9498'); ell(g, -150, 6, 44, 30, '#8a9498', .2); ell(g, 128, -6, 60, 44, '#8a9498'); ell(g, 168, 4, 30, 24, '#9aa4a8'); ell(g, 150, -22, 4, 4, '#111'); ell(g, 176, 0, 3, 2, '#333'); ell(g, 186, 2, 3, 2, '#333'); ell(g, 40, 56, 40, 14, '#7a8488', .5); ell(g, 0, -20, 90, 20, 'rgba(255,255,255,.12)'); g.restore();
      for (let i = 0; i < 12; i++) { const by = (TH + 40 - ((u * 46 + i * 71) % (TH + 80))); g.strokeStyle = 'rgba(220,255,250,.6)'; g.lineWidth = 2; g.beginPath(); g.arc(60 + (i * 137) % 400 + sin(u * 2 + i) * 6, by, 3 + i % 4 * 2, 0, TAU); g.stroke(); }
      tx(g, '海牛：大自然的沙发', TW / 2, 54, 30, '#e8fff8', { a: 'center', f: SERIF, ol: 'rgba(0,40,50,.8)' }); tvCap(g, u < 3.6 ? '海牛。没有天敌，也没有计划。' : '下集预告：一块石头（上、下集）'); c = [.2, .55, .6]; }
    tvBug(g, '自然频道', 'rgba(30,110,70,.85)'); return c; }
  function tvShop(g, t) { t %= 24; let c; const car = (x, y, s, col) => carSil(g, x, y, s, col, { glass: 'rgba(200,230,240,.8)', hub: '#ccc' });
    const hat = (x, y, s) => { ell(g, x, y, 86 * s, 16 * s, '#e0b04a'); g.fillStyle = '#e8bc5a'; g.beginPath(); g.moveTo(x - 40 * s, y - 2); g.quadraticCurveTo(x, y - 86 * s, x + 40 * s, y - 2); g.fill(); g.strokeStyle = '#c0302a'; g.lineWidth = 6 * s; g.beginPath(); g.moveTo(x - 34 * s, y - 14 * s); g.quadraticCurveTo(x, y - 30 * s, x + 34 * s, y - 14 * s); g.stroke(); for (let i = 0; i < 7; i++) ell(g, x - 72 * s + i * 24 * s, y + 6 * s, 4 * s, 4 * s, i % 2 ? '#2a8a4a' : '#c0302a'); };
    if (t < 5) { g.fillStyle = '#777'; g.fillRect(0, 0, TW, TH); g.fillStyle = '#9a9a9a'; g.fillRect(0, 250, TW, TH); ell(g, 400, 70, 50, 50, '#e8e8e8'); for (let i = 0; i < 10; i++) { g.strokeStyle = '#e8e8e8'; g.lineWidth = 5; g.beginPath(); g.moveTo(400 + cos(i * .63 + t) * 62, 70 + sin(i * .63 + t) * 62); g.lineTo(400 + cos(i * .63 + t) * 84, 70 + sin(i * .63 + t) * 84); g.stroke(); }
      car(230 + sin(t * 30) * 2, 270, 2.6, '#444'); for (let i = 0; i < 6; i++) { const yy = 190 + ((t * 60 + i * 30) % 70); g.fillStyle = '#cfe0f0'; g.beginPath(); g.moveTo(130 + i * 40, yy - 9); g.quadraticCurveTo(138 + i * 40, yy + 6, 130 + i * 40, yy + 8); g.quadraticCurveTo(122 + i * 40, yy + 6, 130 + i * 40, yy - 9); g.fill(); }
      if (t > 2.5) { g.strokeStyle = '#d0201a'; g.lineWidth = 22; g.lineCap = 'round'; g.beginPath(); g.moveTo(130, 110); g.lineTo(340, 300); g.moveTo(340, 110); g.lineTo(130, 300); g.stroke(); } tx(g, '你的车……', TW / 2, 46, 36, '#fff', { a: 'center', f: SLAB, ol: '#000' }); tvCap(g, t < 2.5 ? '是不是也在大太阳底下流汗？' : '一定有更好的办法！（其实没有）'); c = [.5, .5, .5]; }
    else if (t < 13) { const u = t - 5; g.fillStyle = '#f4d35e'; g.fillRect(0, 0, TW, TH); g.save(); g.translate(TW / 2, 200); g.rotate(u * .5); for (let i = 0; i < 16; i++) { g.rotate(TAU / 16); g.fillStyle = i % 2 ? '#f08a2a' : '#f4d35e'; g.beginPath(); g.moveTo(0, 0); g.lineTo(-64, -520); g.lineTo(64, -520); g.fill(); } g.restore();
      const bn = abs(sin(u * 4)) * 10; car(256, 290 - bn, 3.0, '#c0302a'); hat(262, 198 - bn - max(0, 1 - u) * 240, 1.25); tx(g, 'SOMBRERO MAX™', TW / 2, 48, 46, '#c0302a', { a: 'center', f: SLAB, ol: '#fff', olw: 8, max: TW - 20 }); tx(g, '车顶遮阳帽', TW / 2, 96, 32, '#16324f', { a: 'center', f: SLAB, ol: '#fff', olw: 6 });
      if (u > 4) { g.save(); g.translate(96, 250); g.rotate(-.25 + sin(u * 6) * .05); g.fillStyle = '#16324f'; g.beginPath(); for (let i = 0; i < 20; i++) { const r_ = i % 2 ? 58 : 44; g.lineTo(cos(i / 20 * TAU) * r_, sin(i / 20 * TAU) * r_); } g.fill(); tx(g, '降温', 0, -8, 24, '#fff', { a: 'center', f: SLAB }); tx(g, '0.5℃!', 0, 18, 20, '#f4d35e', { a: 'center', f: SLAB }); g.restore(); } tvCap(g, u < 4 ? '给你的爱车——戴顶帽子！' : '遮阳！防雨！还有……风度！'); c = [1, .78, .3]; }
    else if (t < 19) { const u = t - 13, fl = Math.floor(u * 5) % 2; g.fillStyle = fl ? '#c0302a' : '#16324f'; g.fillRect(0, 0, TW, TH); tx(g, '原价 $99.99', TW / 2, 74, 40, '#ddd', { a: 'center', f: SLAB }); g.strokeStyle = '#f4d35e'; g.lineWidth = 8; g.beginPath(); g.moveTo(110, 92); g.lineTo(404, 56); g.stroke();
      const k = 1 + .08 * sin(u * 10); g.save(); g.translate(TW / 2, 176); g.scale(k, k); tx(g, '只要 $19.99', 0, 0, 78, '#f4d35e', { a: 'center', f: SLAB, ol: '#000', olw: 10, max: 480 }); g.restore(); if (u > 2.5) { hat(150, 300, .7); hat(350, 292, .5); tx(g, '+', 250, 286, 50, '#fff', { a: 'center', f: SLAB }); tvCap(g, '现在订购，再送第二顶！（给你的狗）'); } else tvCap(g, '但是等等——还没完！'); c = fl ? [.8, .25, .2] : [.15, .25, .45]; }
    else { const u = t - 19; g.fillStyle = '#111'; g.fillRect(0, 0, TW, TH); hat(256, 130, 1.1); tx(g, '立即拨打', TW / 2, 196, 34, '#fff', { a: 'center', f: SLAB }); tx(g, '1-555-0142', TW / 2, 248, 62, Math.floor(u * 4) % 2 ? '#f4d35e' : '#fff', { a: 'center', f: SLAB });
      const fine = '* 帽子在时速超过 15 公里时可能飞走。不适用于敞篷车、摩托车及任何车。狗不包括在内。本产品不能降温。    '; g.save(); g.beginPath(); g.rect(0, 300, TW, 30); g.clip(); tx(g, fine + fine, TW - u * 150, 315, 15, '#aaa'); g.restore(); tvCap(g, '接线员正在待命。只有一位。他叫老周。', 356); c = [.25, .22, .16]; }
    tvBug(g, '购物 24', 'rgba(192,48,42,.9)'); return c; }
  function newsItems() { const out = S.news.slice(-3).reverse(); let robbed = false, chase = false, stars = 0;
    try { const st = GT.game && GT.game.state; if (st) { const ev = st.events || []; for (const e of ev) { const ty = String(e.type || ''); if (/rob|heist|alarm|hold/i.test(ty)) robbed = true; if (/chase|wanted|pursuit|star/i.test(ty)) chase = true; } if (st.wanted && (st.wanted.stars || st.wanted.level)) { stars = st.wanted.stars || st.wanted.level; chase = true; } if (st.result === 'clean') robbed = true; }
      const rb = GT.robbery; if (rb && (rb.done || rb.robbed || (rb.state && /done|escape|flee|robbed/.test(String(rb.state.phase || rb.state))))) robbed = true; } catch (e) { /* other modules are optional */ }
    if (robbed) out.push(['快讯：加油站便利店遭抢', '店员：“他很有礼貌，还说了谢谢。”', 'rob']); if (chase) out.push(['海滨公路上演追车', '警方：嫌疑车辆“很吵，很旧，很快”' + (stars ? '  通缉 ' + '★'.repeat(min(5, stars)) : ''), 'chase']);
    out.push(['鹈鹕抢走游客热狗', '警方：“无可奉告。”鹈鹕：在逃。', 'bird'], ['珊瑚彗星旅馆泳池再次变绿', '经理梅姨：“这是薄荷味。”', 'pool'], ['本地男子连续第九天说“最后一单”', '表弟：“他每次都这么说。”', 'man']); return out.map(o => Array.isArray(o) ? o : [String(o), '本台正在核实。', 'man']); }
  function tvNews(g, t) { t %= 30; const items = newsItems(), idx = Math.floor(t / 10) % items.length, it = items[idx], u = t % 10;
    g.fillStyle = grad(g, 0, 0, TW, TH, [0, '#0e1e3e', 1, '#1a3a6a']); g.fillRect(0, 0, TW, TH); for (let i = 0; i < 8; i++) { g.strokeStyle = 'rgba(120,170,255,.12)'; g.lineWidth = 2; g.beginPath(); g.arc(120, 420, 120 + i * 46 + (t * 8) % 46, 0, TAU); g.stroke(); }
    // inset picture
    g.fillStyle = '#0a0f1c'; g.fillRect(268, 44, 222, 160); g.save(); g.beginPath(); g.rect(272, 48, 214, 152); g.clip(); const ix = 379, iy = 124;
    if (it[2] === 'rob') { g.fillStyle = '#2a2a34'; g.fillRect(272, 48, 214, 152); g.fillStyle = '#e8dcc0'; g.fillRect(300, 86, 150, 80); g.fillStyle = '#c0302a'; g.fillRect(300, 80, 150, 16); tx(g, 'FUEL · 便利店', 375, 88, 11, '#fff', { a: 'center' }); g.fillStyle = '#9ac8d8'; g.fillRect(312, 108, 60, 44); g.fillStyle = '#3a2a1a'; g.fillRect(392, 110, 34, 56); const fl = Math.floor(u * 4) % 2; blob(g, fl ? 290 : 470, 70, 60, 50, fl ? 'rgba(255,40,40,1)' : 'rgba(60,90,255,1)', .8); person(g, 350, 190, .5, { col: '#111', l: 'up', r: 'up' }); }
    else if (it[2] === 'chase') { g.fillStyle = '#20242c'; g.fillRect(272, 48, 214, 152); g.fillStyle = '#3a3e46'; g.fillRect(272, 130, 214, 50); for (let i = 0; i < 6; i++) { g.fillStyle = '#d8c84a'; g.fillRect(272 + ((i * 46 - u * 160) % 260 + 260) % 260, 153, 24, 4); } carSil(g, 400, 150, .8, '#b3242c', { hub: '#ccc' }); carSil(g, 318 + sin(u * 3) * 6, 152, .78, '#e8e8ea', { hub: '#333', stripe: '#16324f' }); blob(g, 318, 122, 26, 20, Math.floor(u * 6) % 2 ? 'rgba(255,40,40,1)' : 'rgba(60,90,255,1)', .9); }
    else if (it[2] === 'bird') { g.fillStyle = grad(g, 0, 48, 0, 200, [0, '#5aa8e0', 1, '#cfe8f0']); g.fillRect(272, 48, 214, 152); g.save(); g.translate(ix + sin(u) * 20, iy); ell(g, 0, 0, 34, 17, '#e8e2d2'); ell(g, 32, -14, 12, 11, '#e8e2d2'); g.fillStyle = '#e0a03a'; g.beginPath(); g.moveTo(40, -18); g.lineTo(88, -6); g.lineTo(42, 2); g.fill(); g.fillStyle = '#c0703a'; rr(g, 66, -10, 40, 12, 6); g.fill(); g.fillStyle = '#e8c84a'; g.fillRect(70, -6, 32, 3); g.restore(); tx(g, '嫌疑鸟（资料图）', ix, 188, 12, '#fff', { a: 'center', ol: '#000' }); }
    else if (it[2] === 'pool') { g.fillStyle = '#e8a8a0'; g.fillRect(272, 48, 214, 152); g.fillStyle = '#d8d2c0'; g.fillRect(272, 120, 214, 80); g.fillStyle = '#4a9a3a'; rr(g, 300, 132, 160, 54, 16); g.fill(); for (let i = 0; i < 5; i++) ell(g, 320 + i * 30, 158 + sin(u * 2 + i) * 6, 12, 3, 'rgba(180,230,120,.6)'); tx(g, 'CORAL COMET', ix, 92, 20, '#fff', { a: 'center', f: SLAB, ol: '#c0306a' }); }
    else { g.fillStyle = grad(g, 0, 48, 0, 200, [0, '#f0a05a', 1, '#5a3a4a']); g.fillRect(272, 48, 214, 152); person(g, ix, 204, 1.3, { col: '#111', l: 'hip', r: 'down' }); tx(g, '？', ix, 96, 40, '#fff', { a: 'center', f: SLAB, ol: '#000' }); }
    g.restore(); g.strokeStyle = '#c8d8f0'; g.lineWidth = 3; g.strokeRect(270, 46, 218, 156);
    // anchor: lacquered hair, shoulders, desk
    const bob = sin(t * 2.2) * 1.5; g.fillStyle = '#16203a'; g.beginPath(); g.moveTo(40, 300); g.quadraticCurveTo(60, 214, 136, 206 + bob); g.quadraticCurveTo(214, 214, 232, 300); g.fill(); g.fillStyle = '#e8e2d8'; g.beginPath(); g.moveTo(116, 210 + bob); g.lineTo(136, 250 + bob); g.lineTo(156, 210 + bob); g.fill(); g.fillStyle = '#b3242c'; g.beginPath(); g.moveTo(130, 222 + bob); g.lineTo(136, 270 + bob); g.lineTo(142, 222 + bob); g.fill();
    ell(g, 136, 160 + bob, 38, 46, '#c89a78'); ell(g, 136, 128 + bob, 46, 30, '#2a1a10'); g.fillStyle = '#2a1a10'; g.fillRect(92, 124 + bob, 16, 44); g.fillRect(166, 124 + bob, 12, 30); g.fillStyle = '#1a1210'; g.fillRect(118, 156 + bob, 14, 4); g.fillRect(142, 156 + bob, 14, 4); const mo = abs(sin(t * 9)) * 6 + 2; ell(g, 136, 186 + bob, 9, mo, '#5a1a1a');
    g.fillStyle = '#1c2c50'; g.fillRect(0, 286, TW, 30); g.fillStyle = '#c8d8f0'; g.fillRect(0, 284, TW, 3);
    // lower third + crawl
    const sl = seg(u, 0, .5); g.fillStyle = '#c0261c'; g.fillRect(-TW * (1 - sl), 300, 150, 30); tx(g, it[2] === 'rob' || it[2] === 'chase' ? '突发 LIVE' : '本地 LOCAL', 75 - TW * (1 - sl), 316, 16, '#fff', { a: 'center', f: SLAB }); g.fillStyle = 'rgba(240,244,250,.96)'; g.fillRect(150 - TW * (1 - sl), 300, TW - 150, 30); tx(g, it[0], 162 - TW * (1 - sl), 316, 19, '#101828', { f: SLAB, max: TW - 170 });
    g.fillStyle = 'rgba(16,28,56,.96)'; g.fillRect(0, 330, TW, 24); tx(g, it[1], 12, 343, 15, '#e8eefc', { max: TW - 20 });
    const crawl = '湿度 100%  ·  海滨公路北向：堵  ·  彩票头奖 $50,000 无人认领  ·  郝氏二手车：本周“几乎没泡过水”特卖  ·  飓风“小张”仍在海上犹豫  ·  今晚月色：有  ·  '; g.fillStyle = '#f4d35e'; g.fillRect(0, 356, TW, 28); g.save(); g.beginPath(); g.rect(64, 356, TW, 28); g.clip(); const cw = 1500; tx(g, crawl + crawl, 64 - (t * 70) % cw, 371, 16, '#101828', { w: 600 }); g.restore(); g.fillStyle = '#101828'; g.fillRect(0, 356, 64, 28); const hh = Math.floor(((GT.env && GT.env.hours) || 18.2)), mm = Math.floor((((GT.env && GT.env.hours) || 18.2) % 1) * 60); tx(g, hh + ':' + (mm < 10 ? '0' : '') + mm, 32, 371, 15, '#f4d35e', { a: 'center' });
    g.fillStyle = '#c0261c'; rr(g, 12, 12, 118, 30, 5); g.fill(); tx(g, '海岸六台', 71, 28, 18, '#fff', { a: 'center', f: SLAB }); return [.32, .4, .62]; }
  function tvNovela(g, t) { t %= 22; let zoom = 1, cxp = TW / 2, cyp = TH / 2, cap_, frz = false, c = [.75, .4, .3];
    if (t < 8) { zoom = 1 + t * .01; cap_ = t < 4 ? '罗德里戈：“我不是你的丈夫……”' : '玛丽索：“那你是谁？！”'; } else if (t < 14) { const k = sst(t, 8, 8.5); zoom = 1 + k * 1.3; cxp = lerp(TW / 2, 372, k); cyp = lerp(TH / 2, 150, k); frz = t > 8.6; cap_ = '“……我是他的双胞胎。开拖车的那个。”'; }
    else if (t < 18) { const k = sst(t, 14, 14.4); zoom = 1 + k * 1.6; cxp = lerp(TW / 2, 256, k); cyp = lerp(TH / 2, 176, k); cap_ = '奶奶：“我早就知道了。”'; } else { zoom = 1.25; frz = true; cap_ = ''; }
    const tt = frz ? 8.6 : t; g.save(); g.translate(TW / 2, TH / 2); g.scale(zoom, zoom); g.translate(-cxp, -cyp);
    g.fillStyle = grad(g, 0, 0, 0, TH, [0, '#5a1a2a', 1, '#2a0e1a']); g.fillRect(-TW, -TH, TW * 3, TH * 3); g.fillStyle = grad(g, 0, 40, 0, 250, [0, '#f0904a', .6, '#f6c88a', 1, '#e86a5a']); g.fillRect(190, 40, 130, 210); g.fillStyle = '#3a1420'; g.fillRect(252, 40, 6, 210); g.fillRect(190, 140, 130, 6); for (const sx of [170, 320]) { g.fillStyle = '#8a2a3a'; g.beginPath(); g.moveTo(sx, 30); g.quadraticCurveTo(sx + (sx < 200 ? 50 : -30), 150, sx + (sx < 200 ? 6 : 14), 262); g.lineTo(sx + (sx < 200 ? -14 : 34), 262); g.lineTo(sx + (sx < 200 ? -14 : 34), 30); g.fill(); }
    // grandma in the doorway (eye patch), the man (moustache), the woman (very big hair)
    ell(g, 256, 196, 22, 26, '#5a4a4a'); ell(g, 256, 176, 24, 14, '#d8d8d8'); g.fillStyle = '#111'; g.fillRect(244, 190, 12, 8); g.fillRect(238, 188, 36, 2); g.fillStyle = '#3a2a3a'; g.fillRect(232, 220, 48, 80);
    const breathe = sin(tt * 2) * 2; ell(g, 130, 150 + breathe, 40, 50, '#b8845a'); ell(g, 130, 112 + breathe, 44, 24, '#1a1210'); g.fillStyle = '#1a1210'; g.beginPath(); g.ellipse(142, 178 + breathe, 22, 8, 0, 0, PI); g.fill(); g.fillRect(140, 146 + breathe, 16, 4); g.fillStyle = '#e8e2d8'; g.beginPath(); g.moveTo(60, 400); g.quadraticCurveTo(70, 214, 130, 206 + breathe); g.quadraticCurveTo(200, 214, 206, 400); g.fill(); g.fillStyle = '#b8845a'; g.beginPath(); g.moveTo(114, 208 + breathe); g.lineTo(132, 250); g.lineTo(150, 208 + breathe); g.fill();
    ell(g, 372, 140 - breathe, 70, 76, '#3a1a10'); ell(g, 372, 156 - breathe, 36, 46, '#c89878'); ell(g, 360, 150 - breathe, 5, frz ? 9 : 4, '#fff'); ell(g, 386, 150 - breathe, 5, frz ? 9 : 4, '#fff'); ell(g, 360, 151 - breathe, 2.5, 2.5, '#111'); ell(g, 386, 151 - breathe, 2.5, 2.5, '#111'); ell(g, 372, 182 - breathe, frz ? 9 : 6, frz ? 12 : 3, '#8a1a2a'); g.fillStyle = '#c0306a'; g.beginPath(); g.moveTo(300, 400); g.quadraticCurveTo(310, 220, 372, 208 - breathe); g.quadraticCurveTo(440, 220, 450, 400); g.fill(); ell(g, 404, 176 - breathe, 5, 8, '#f4d35e');
    g.restore(); if (frz) { g.fillStyle = 'rgba(120,40,160,.16)'; g.fillRect(0, 0, TW, TH); const fl = max(0, 1 - (t - (t < 14 ? 8.6 : 18)) * 3); if (fl > 0) { g.fillStyle = 'rgba(255,255,255,' + fl + ')'; g.fillRect(0, 0, TW, TH); } g.strokeStyle = '#f4d35e'; g.lineWidth = 6; g.strokeRect(10, 10, TW - 20, TH - 20); tx(g, '定格', TW - 60, 60, 20, '#f4d35e', { a: 'center', f: SLAB, ol: '#000' }); c = [.7, .4, .6]; }
    if (t >= 18) { tx(g, '未完待续……', TW / 2, 178, 60, '#fff', { a: 'center', f: SERIF, ol: '#5a1a2a', olw: 9 }); tx(g, '《烈日孽缘》第 848 集 · 明晚同一时间', TW / 2, 240, 19, '#f4d35e', { a: 'center', ol: '#000' }); for (let i = 0; i < 9; i++) { const a = t * 2 + i, x = 60 + (i * 53) % 400, y = 60 + (i * 97) % 240, s = 4 + 4 * abs(sin(a)); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x, y - s * 2); g.lineTo(x + s * .4, y - s * .4); g.lineTo(x + s * 2, y); g.lineTo(x + s * .4, y + s * .4); g.lineTo(x, y + s * 2); g.lineTo(x - s * .4, y + s * .4); g.lineTo(x - s * 2, y); g.lineTo(x - s * .4, y - s * .4); g.fill(); } }
    if (cap_) tvCap(g, cap_); tvBug(g, '剧场 · 烈日孽缘', 'rgba(140,30,80,.85)'); return c; }
  function tvWeather(g, t) { t %= 26; g.fillStyle = grad(g, 0, 0, 0, TH, [0, '#1a5a8a', 1, '#0e2a4a']); g.fillRect(0, 0, TW, TH);
    // the coast (a blob), suns, a hesitant hurricane
    g.fillStyle = '#3a8a5a'; g.beginPath(); g.moveTo(520, 30); g.lineTo(300, 26); g.quadraticCurveTo(250, 80, 290, 150); g.quadraticCurveTo(240, 210, 300, 262); g.quadraticCurveTo(330, 300, 520, 296); g.fill(); g.strokeStyle = '#e8d8a0'; g.lineWidth = 5; g.beginPath(); g.moveTo(300, 26); g.quadraticCurveTo(250, 80, 290, 150); g.quadraticCurveTo(240, 210, 300, 262); g.quadraticCurveTo(330, 300, 520, 296); g.stroke();
    for (const [sx, sy, n] of [[360, 80, '北滩'], [420, 170, 'Costa Brisa'], [370, 240, '码头']]) { const p = 1 + .08 * sin(t * 3 + sx); ell(g, sx, sy, 15 * p, 15 * p, '#f4d35e'); for (let i = 0; i < 8; i++) { g.strokeStyle = '#f4d35e'; g.lineWidth = 3; g.beginPath(); g.moveTo(sx + cos(i * .785 + t) * 20, sy + sin(i * .785 + t) * 20); g.lineTo(sx + cos(i * .785 + t) * 27, sy + sin(i * .785 + t) * 27); g.stroke(); } tx(g, n, sx + 30, sy, 13, '#fff', { ol: 'rgba(0,0,0,.6)' }); }
    const hx = 150 + sin(t * .4) * 70, hy = 110 + cos(t * .3) * 40; g.save(); g.translate(hx, hy); g.rotate(-t * 1.5); for (let a = 0; a < 3; a++) { g.rotate(TAU / 3); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 7; g.beginPath(); for (let i = 0; i < 22; i++) { const r_ = 6 + i * 2.2, an = i * .32; g.lineTo(cos(an) * r_, sin(an) * r_); } g.stroke(); } g.restore(); ell(g, hx, hy, 6, 6, '#0e2a4a'); tx(g, '飓风“小张”（还在犹豫）', hx, hy + 66, 13, '#fff', { a: 'center', ol: 'rgba(0,0,0,.6)' });
    // presenter
    const px = 86 + sin(t * .7) * 8; person(g, px, 372, 2.3, { col: '#14181e', r: 'point', l: 'hip', hair: true }); g.fillStyle = '#c89878'; g.beginPath(); g.arc(px, 372 - 205, 17, 0, TAU); g.fill(); g.fillStyle = '#14181e'; g.beginPath(); g.ellipse(px, 372 - 216, 24, 20, 0, PI, TAU); g.fill();
    if (t < 9) { const k = 1 + .05 * sin(t * 6); g.save(); g.translate(250, 322); g.scale(k, k); tx(g, '湿度 100%', 0, 0, 62, '#fff', { a: 'center', f: SLAB, ol: '#0e2a4a', olw: 10 }); g.restore(); for (let i = 0; i < 12; i++) { const yy = ((t * 80 + i * 47) % 120); g.fillStyle = 'rgba(190,225,255,.8)'; g.beginPath(); g.ellipse(120 + i * 26, 266 + yy * .2 + (i % 3) * 8, 3, 6, 0, 0, TAU); g.fill(); } tvCap(g, t < 4.5 ? '今晚湿度百分之百。' : '是的，百分之百。空气基本上是汤。', 364); }
    else if (t < 19) { const D = [['周一', '热', '33°'], ['周二', '更热', '34°'], ['周三', '热+湿', '34°'], ['周四', '飓风(小)', '31°'], ['周五', '热', '35°']], n = min(5, Math.floor((t - 9) * 1.2) + 1); g.fillStyle = 'rgba(8,20,40,.82)'; g.fillRect(16, 250, TW - 32, 92);
      for (let i = 0; i < n; i++) { const X = 66 + i * 95; tx(g, D[i][0], X, 268, 16, '#9ac8f0', { a: 'center' }); if (i === 3) { g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(X, 296, 10, 0, TAU * .8); g.stroke(); } else ell(g, X, 296, 11, 11, '#f4d35e'); tx(g, D[i][1], X, 322, 15, '#fff', { a: 'center', max: 88 }); tx(g, D[i][2], X + 26, 290, 13, '#f4a05a', { a: 'center' }); } tvCap(g, '未来五天：热，更热，然后还是热。', 364); }
    else { g.fillStyle = 'rgba(8,20,40,.82)'; g.fillRect(16, 250, TW - 32, 92); tx(g, '体感温度', 140, 280, 22, '#9ac8f0', { a: 'center' }); tx(g, '41℃', 140, 316, 40, '#f4a05a', { a: 'center', f: SLAB }); tx(g, '像被一条热毛巾拥抱', 340, 282, 22, '#fff', { a: 'center', max: 280 }); tx(g, '穿衣建议：尽量少', 340, 316, 18, '#f4d35e', { a: 'center' }); tvCap(g, '以上是天气。我是阿芳，我要去冲凉了。', 364); }
    g.fillStyle = '#f08a2a'; rr(g, 12, 12, 132, 30, 5); g.fill(); tx(g, '海岸气象', 78, 28, 18, '#fff', { a: 'center', f: SLAB }); return [.25, .45, .7]; }
  const CHAN = [{ n: '自然', f: tvNature }, { n: '购物', f: tvShop }, { n: '新闻', f: tvNews }, { n: '剧场', f: tvNovela }, { n: '气象', f: tvWeather }];
  let noiseC = null;
  function tvStatic(g, a) { if (!noiseC) { noiseC = document.createElement('canvas'); noiseC.width = 256; noiseC.height = 192; const ng = noiseC.getContext('2d'), im = ng.createImageData(256, 192), r = GT.rng('static'); for (let i = 0; i < im.data.length; i += 4) { const v = r() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } ng.putImageData(im, 0, 0); }
    g.globalAlpha = a; const ox = (S.t * 977) % 256, oy = (S.t * 613) % 192; for (let y = -oy; y < TH; y += 192 * 2) for (let x = -ox; x < TW; x += 256 * 2) g.drawImage(noiseC, x, y, 512, 384); g.globalAlpha = 1; }
  function tvDraw() { const g = S.tvG, st = S.st; g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.shadowBlur = 0; let c = [0, 0, 0];
    if (!st.tv) { g.fillStyle = '#060708'; g.fillRect(0, 0, TW, TH); g.fillStyle = grad(g, 0, 0, TW, TH, [0, 'rgba(120,130,150,.10)', .4, 'rgba(0,0,0,0)', 1, 'rgba(90,80,60,.06)']); g.fillRect(0, 0, TW, TH); S.tvTex.needsUpdate = true; return c; }
    g.save(); try { c = CHAN[st.ch % CHAN.length].f(g, S.tvT) || c; } catch (e) { g.restore(); g.save(); g.fillStyle = '#103'; g.fillRect(0, 0, TW, TH); tx(g, '无信号', TW / 2, TH / 2, 40, '#fff', { a: 'center' }); if (!S.tvErr) { S.tvErr = true; console.warn('[safehouse] tv', e); } } g.restore(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    if (S.tvStatic > 0) { tvStatic(g, min(1, S.tvStatic * 4)); c = [.5, .5, .55]; } else tvStatic(g, .07);
    if (S.tvOsd > 0) { tx(g, 'CH 0' + (st.ch + 3) + '  ' + CHAN[st.ch].n, 22, 62, 24, '#5aff6a', { f: 'monospace', ol: '#031' }); }
    g.fillStyle = 'rgba(0,0,0,.16)'; for (let y = 0; y < TH; y += 3) g.fillRect(0, y, TW, 1); const roll = (S.t * 60) % (TH + 120) - 60; g.fillStyle = 'rgba(255,255,255,.045)'; g.fillRect(0, roll, TW, 46);
    const vg = g.createRadialGradient(TW / 2, TH / 2, TH * .35, TW / 2, TH / 2, TW * .72); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)'); g.fillStyle = vg; g.fillRect(0, 0, TW, TH); S.tvTex.needsUpdate = true; return c; }

  /* ================================================================== small services: wallet, input, sound, fade, UI pill, timers */
  GT.wallet = GT.wallet || (() => { const cbs = [], w = { cash: 0, add(n, why) { n = +n || 0; w.cash += n; for (const cb of cbs) try { cb(w.cash, n, why); } catch (e) { /* listener */ } return w.cash; },
    spend(n) { n = +n || 0; if (n > w.cash) return false; w.cash -= n; for (const cb of cbs) try { cb(w.cash, -n, 'spend'); } catch (e) { /* listener */ } return true; }, on(cb) { if (typeof cb === 'function') cbs.push(cb); } }; return w; })();
  const keys = {}, hits = {}; let listening = false;
  function listen() { if (listening) return; listening = true; addEventListener('keydown', e => { if (!keys[e.code]) hits[e.code] = true; keys[e.code] = true; }); addEventListener('keyup', e => { keys[e.code] = false; }); }
  const OWN = { down: c => !!keys[c], pressed: c => !!hits[c], consume: c => { hits[c] = false; }, axis: () => ({ x: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), y: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) }), look: { dx: 0, dy: 0 } };
  const inp = i => (i && i.pressed ? i : GT.input && GT.input.pressed ? GT.input : OWN);
  const hit = (I, ...codes) => { for (const c of codes) if (I.pressed(c)) { if (I.consume) I.consume(c); return true; } return false; };
  const leaveKey = I => hit(I, 'Escape', 'KeyQ', 'Backspace');
  function sfx(name, o) { try { if (GT.audio && GT.audio.sfx) GT.audio.sfx(name, o); } catch (e) { /* audio is optional */ } }
  function acSound(on) { const ac = GT.audio && GT.audio.ctx; if (!ac || !!S.acNode === on) return;
    try { if (on) { const sr = ac.sampleRate, len = sr * 2, buf = ac.createBuffer(1, len, sr), d = buf.getChannelData(0), r = GT.rng('achum'), per = Math.floor(sr / 11.5); let v = 0;
        for (let i = 0; i < len; i++) { v = (v + (r() * 2 - 1) * .05) * .985; const tt = i / sr; d[i] = v * 2.2 + .22 * sin(tt * TAU * 58.5) * (.8 + .2 * sin(tt * TAU * 3.5)) + .07 * sin(tt * TAU * 117) + (i % per < 36 ? (r() - .5) * .5 * (1 - (i % per) / 36) : 0); }
        const src = ac.createBufferSource(), lp = ac.createBiquadFilter(), g = ac.createGain(); src.buffer = buf; src.loop = true; lp.type = 'lowpass'; lp.frequency.value = 1100; g.gain.value = 0; g.gain.linearRampToValueAtTime(.05, ac.currentTime + .8); src.connect(lp); lp.connect(g); g.connect(ac.destination); src.start(); S.acNode = { src, g }; }
      else { const n = S.acNode; S.acNode = null; n.g.gain.cancelScheduledValues(ac.currentTime); n.g.gain.setValueAtTime(n.g.gain.value, ac.currentTime); n.g.gain.linearRampToValueAtTime(0, ac.currentTime + .5); n.src.stop(ac.currentTime + .6); } } catch (e) { S.acNode = null; } }
  function fade(v, ms) { if (S.pre) return; if (GT.front && GT.front.fade) { try { GT.front.fade(v, ms); return; } catch (e) { /* fall through */ } }
    if (!S.fadeEl) { const d = S.fadeEl = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:40'; document.body.appendChild(d); } S.fadeEl.style.transition = 'opacity ' + ms + 'ms ease-in-out'; void S.fadeEl.offsetWidth; S.fadeEl.style.opacity = v; }
  function ui(text) { if (!text && !S.ui) return; if (!S.ui) { const d = S.ui = document.createElement('div'); d.style.cssText = "position:fixed;left:50%;bottom:11%;transform:translateX(-50%);padding:9px 20px;border-radius:999px;background:rgba(12,14,18,.62);border:1px solid rgba(255,255,255,.16);color:#f3efe6;font:600 15px/1.2 'PingFang SC','Helvetica Neue',Arial,sans-serif;letter-spacing:.06em;white-space:nowrap;pointer-events:none;z-index:30;opacity:0;transition:opacity .2s;backdrop-filter:blur(6px)"; document.body.appendChild(d); }
    if (text) S.ui.textContent = text; S.ui.style.opacity = text ? 1 : 0; }
  function say(who, text, sec) { const ctl = S.ctl; try { if (ctl && ctl.say) return ctl.say(who, text, sec); if (GT.front && GT.front.subtitle && !S.showcase) return GT.front.subtitle(who, text, sec); } catch (e) { /* optional */ } S.lastSay = (who ? who + '：' : '') + text; if (!S.take) { ui(S.lastSay); S.sayT = sec || 3; } }
  const after = (t, fn) => S.seq.push({ t: S.t + t, fn });
  const pick = (arr, n) => arr[((n | 0) % arr.length + arr.length) % arr.length];

  /* ================================================================== inside / outside */
  S.keep = new Set();
  function topOf(o) { const sc = S.scene; while (o && o.parent && o.parent !== sc) o = o.parent; return o && o.parent === sc ? o : null; }
  function keepers(ctl) { for (const f of [ctl && ctl.hero, ctl && ctl.partnerFig, S.standIn]) { const t = f && f.group && topOf(f.group); if (t) S.keep.add(t); } }
  function hideWorld() { const sc = S.scene, env = ENV.rt && ENV.rt.texture; for (const o of sc.children) { if (o === S.root || !o.visible || o.isCamera || S.keep.has(o) || (o.userData && o.userData.keepIndoor) || (o.name && o.name.indexOf('onfoot_') === 0)) continue; o.visible = false; S.hidden.push(o); }
    if (env && sc.environment !== env) { S.envOld = sc.environment; sc.environment = env; } }
  function setInside(on) { on = !!on; if (!S.built || S.inside === on) return; S.inside = on; const sc = S.scene; S.root.visible = on;
    if (on) { S.hidden.length = 0; S.envOld = sc.environment; hideWorld(); S.envDirty = true; S.emDirty = true; S.tvAcc = 1; try { if (GT.audio && GT.audio.ambience) GT.audio.ambience({ interior: 1 }); } catch (e) { /* optional */ } }
    else { for (const o of S.hidden) o.visible = true; S.hidden.length = 0; if (ENV.rt && sc.environment === ENV.rt.texture) sc.environment = S.envOld; S.envOld = null; acSound(false); ui(''); try { if (GT.audio && GT.audio.ambience) GT.audio.ambience({ interior: 0 }); } catch (e) { /* optional */ } } }
  function freeze(ctl, sec, state) { if (!ctl || !ctl.takeover) return; let t = 0; ctl.takeover({ heroState: state || 'use', update(dt) { t += dt; return t > sec; } }); }
  function enter(ctl, o) { if (!S.built || S.inside || S.busy) return false; ctl = ctl || (GT.onfoot && GT.onfoot.ctl) || null; S.ctl = ctl; addZone(); hollowWing(); const instant = o && o.instant;
    const go = () => { keepers(ctl); setInside(true); S.extDoorT = S.extDoor = 0; S.door = instant ? 0 : .85; S.doorT = 0; if (ctl) { const p = W(DOORX, ZF - .8); if (ctl.teleport) ctl.teleport(p.x, p.z, WH(PI)); if (ctl.setCameraYaw) ctl.setCameraYaw(WH(PI)); const pt = ctl.partner; if (pt && pt.follow) { S.partnerWas = pt.state; try { pt.follow(false); } catch (e) { /* optional */ } } }
      fade(0, 300); after(.4, () => sfx('door_close')); S.busy = false; if (!S.greeted && !instant) { S.greeted = true; after(1.2, () => say('阿凯', pick(['家。暂时的。', '一〇六。空调还在吵，说明它还活着。'], S.snacks + S.slept))); } };
    if (instant) { go(); return true; } S.busy = true; S.extDoorT = 1; sfx('door_open'); freeze(ctl, .78); after(.36, () => fade(1, 230)); after(.62, go); return true; }
  function exit(ctl, o) { if (!S.built || !S.inside || S.busy) return false; ctl = ctl || S.ctl || (GT.onfoot && GT.onfoot.ctl) || null; const instant = o && o.instant;
    const go = () => { setInside(false); S.door = S.doorT = 0; S.extDoor = instant ? 0 : .9; S.extDoorT = 0; if (ctl) { if (ctl.teleport) ctl.teleport(A.door.x, A.door.z, -HP); if (ctl.setCameraYaw) ctl.setCameraYaw(-HP); const pt = ctl.partner; if (pt && pt.follow && S.partnerWas !== undefined && /follow/i.test(String(S.partnerWas))) { try { pt.follow(true); } catch (e) { /* optional */ } } S.partnerWas = undefined; }
      fade(0, 300); after(.4, () => sfx('door_close')); S.busy = false; };
    if (instant) { go(); return true; } S.busy = true; S.doorT = 1; sfx('door_open'); freeze(ctl, .78); after(.36, () => fade(1, 230)); after(.62, go); return true; }

  /* ================================================================== lighting + emissives, driven by the room state and GT.env */
  const _c = new T.Color(), mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  S.tvCol = [.3, .4, .6]; S.amb = new T.Color(.1, .08, .06); S.bdCol = new T.Color(1, .8, .5); S.lastN = -1;
  function applyLights(dt) { const L = S.L, st = S.st, env = GT.env || {}, n = clamp(env.night || 0, 0, 1), t = S.t, open = 1 - sst(S.slat, .95, 1.42);
    const col = n < .5 ? mix3([1, .58, .26], [1, .36, .3], n * 2) : mix3([1, .36, .3], [1, .25, .58], n * 2 - 1), buzz = n > .6 ? (.9 + .1 * sin(t * 13.7)) * (hsh(Math.floor(t * 8)) < .04 ? .55 : 1) : 1;
    const inten = lerp(lerp(30, 12, sst(n, 0, .5)), 5.5, sst(n, .5, 1)) * buzz; L.sun.color.setRGB(col[0], col[1], col[2]); L.sun.intensity = inten;
    const U = S.bdMat.uniforms; U.uN.value = n; U.uG.value = lerp(lerp(6.5, 2.6, sst(n, 0, .5)), 1.5, sst(n, .5, 1)); U.uF.value = buzz; S.bdCol.setRGB(col[0], col[1] * 1.2, col[2] * 1.3).multiplyScalar(U.uG.value * .5);
    const sk = (Math.pow(1 - n, 1.4) * .11 + n * .012) * (.2 + .8 * open); S.shaftMat.color.setRGB(col[0] * sk, col[1] * sk, col[2] * sk); S.shafts.visible = sk > .002;
    const lampK = st.lamp ? 1 : 0, ceilK = st.ceil ? 1 : 0, bathK = st.bath ? (.94 + .06 * hsh(Math.floor(t * 30))) : 0, kitK = st.kit ? (hsh(Math.floor(t * 12)) < .012 ? .5 : 1) : 0;
    L.lamp.color.setRGB(1, .6, .3); L.lamp.intensity = 2.5 * lampK; L.ceil.color.setRGB(1, .83, .62); L.ceil.intensity = 2.3 * ceilK; L.bath.color.setRGB(.86, 1, .9); L.bath.intensity = 1.25 * bathK; L.kit.color.setRGB(.8, .95, 1); L.kit.intensity = .95 * kitK;
    const tc = S.tvCol, lum = tc[0] * .3 + tc[1] * .5 + tc[2] * .2, fl = .92 + .08 * hsh(Math.floor(t * 24)); L.tv.color.setRGB(.25 + tc[0] * .75, .25 + tc[1] * .75, .3 + tc[2] * .7); L.tv.intensity = st.tv ? (.35 + lum * 1.6) * fl : 0;
    L.fridge.color.setRGB(.85, .95, 1); L.fridge.intensity = S.fridge * 1.7;
    // fill: what the sun patch, the lamps and the screen bounce back into the room
    const b = inten * .0042 * (.25 + .75 * open), a = S.amb; a.setRGB(col[0] * b + .05 * lampK + .11 * ceilK + .012 * bathK + tc[0] * .012 * (st.tv ? 1 : 0), col[1] * b + .03 * lampK + .09 * ceilK + .014 * bathK + tc[1] * .012 * (st.tv ? 1 : 0), col[2] * b + .016 * lampK + .065 * ceilK + .012 * bathK + tc[2] * .014 * (st.tv ? 1 : 0));
    L.hemi.color.copy(a).multiplyScalar(.9); L.hemi.groundColor.setRGB(a.r * .5, a.g * .56, a.b * .52); L.hemi.intensity = 1;
    S.tvMesh.material.color.setScalar(st.tv ? 1.9 : 1);
    if (abs(n - S.lastN) > .06) { S.lastN = n; S.envDirty = true; }
    if (S.emDirty || S.fridgeMoving) { S.emDirty = false; emSet('lamp', 3.4 * lampK + .1, 2.0 * lampK + .085, .95 * lampK + .06); emSet('lampBulb', 9 * lampK + .1, 7 * lampK + .1, 4.4 * lampK + .1); emSet('ceil', 5.2 * ceilK + .13, 4.3 * ceilK + .12, 3.1 * ceilK + .1); emSet('bath', 5.2 * bathK + .1, 6 * bathK + .11, 5.4 * bathK + .1);
      emSet('kit', 4.2 * kitK + .1, 5 * kitK + .11, 5.3 * kitK + .12); emSet('fridge', 4 * S.fridge, 4.5 * S.fridge, 4.8 * S.fridge); emSet('led', 2.6, .1, .06); emSet('hot', .25, .03, .02); S.envDirty = true; } }

  /* ================================================================== interactions */
  const A = {};                                                              // anchors (world): filled in build()
  const OUTFIT = { tee: '旧 T 恤', shirt: '花衬衫', jacket: '拖车夹克', workwear: '工装', hoodie: '连帽衫', jersey: '球衣', suit: '西装', tank: '背心' };
  function camNow(fallback) { const c = S.cam; if (!c) return fallback; const d = new T.Vector3(); c.getWorldDirection(d); return { pos: [c.position.x, c.position.y, c.position.z], look: [c.position.x + d.x * 2, c.position.y + d.y * 2, c.position.z + d.z * 2], fov: c.fov || 50 }; }
  const mixCam = (a, b, k) => ({ pos: [lerp(a.pos[0], b.pos[0], k), lerp(a.pos[1], b.pos[1], k), lerp(a.pos[2], b.pos[2], k)], look: [lerp(a.look[0], b.look[0], k), lerp(a.look[1], b.look[1], k), lerp(a.look[2], b.look[2], k)], fov: lerp(a.fov, b.fov, k) });
  function place(ctx, lx, lz, hl) { const ctl = ctx && ctx.ctl, p = W(lx, lz); if (ctl && ctl.teleport) ctl.teleport(p.x, p.z, WH(hl)); else if (S.standIn) { S.standIn.group.position.set(p.x, FLOOR, p.z); S.standIn.group.rotation.y = WH(hl); } }
  /** run a scripted mode: o = {to:{pos,look,fov}, blend?, heroState?, start?(), step(dt, I, o) -> true when done, end?()} */
  function run(ctx, o) { const ctl = ctx && ctx.ctl; S.take = o; o.t = 0; o.from = camNow(o.to); if (o.start) o.start(); listen();
    const upd = (dt, input) => { o.t += dt; return o.step(dt, inp(input), o) === true; }, cam = () => mixCam(o.from, o.to, sst(o.t, 0, o.blend || .8)), end = () => { if (S.take === o) S.take = null; ui(''); if (o.end) o.end(); };
    if (ctl && ctl.takeover) ctl.takeover({ update: upd, camera: cam, heroState: o.heroState || 'idle', onEnd: end }); else S.solo = { upd, cam, end }; }
  const TVCAM = () => ({ pos: W3(.6, 1.12, TVW.z + .05), look: W3(TVW.x, TVP.y - .01, TVW.z + .04), fov: 32 });
  const MIRCAM = () => ({ pos: W3(-1.2, 1.64, -1.5), look: W3(1.0, 1.02, -2.5), fov: 40 });
  const FRIDGECAM = () => ({ pos: W3(.82, 1.18, -3.72), look: W3(1.7, .5, -4.9), fov: 42 });
  function chan(d) { const st = S.st; st.ch = ((st.ch + d) % CHAN.length + CHAN.length) % CHAN.length; S.tvT = 0; S.tvStatic = .28; S.tvOsd = 2.5; S.tvAcc = 1; sfx('ui_tick'); }
  const tvUi = () => ui('◀ A    CH 0' + (S.st.ch + 3) + ' ' + CHAN[S.st.ch].n + '    D ▶      F 开关 · E 离开');
  function useTV(ctx) { const st = S.st; if (!st.tv) { st.tv = true; S.tvStatic = .35; S.emDirty = true; sfx('ui_tick'); } S.tvOsd = 2.5; place(ctx, .42, TVW.z + .02, HP);
    run(ctx, { to: TVCAM(), blend: .9, start: tvUi, step(dt, I, o) { if (o.t < .3) return false; if (hit(I, 'KeyA', 'ArrowLeft')) { chan(-1); tvUi(); } if (hit(I, 'KeyD', 'ArrowRight')) { chan(1); tvUi(); } if (hit(I, 'KeyF')) { st.tv = !st.tv; S.tvStatic = st.tv ? .35 : 0; S.tvAcc = 1; S.emDirty = true; sfx('ui_tick'); } return hit(I, 'KeyE') || leaveKey(I); } }); }
  function heroOf(ctx) { return (ctx && ctx.hero) || (S.ctl && S.ctl.hero) || S.standIn || null; }
  function useMirror(ctx) { const h = heroOf(ctx), list = (h && h.outfits && h.outfits.length ? h.outfits : ['tee', 'shirt', 'jacket', 'workwear']).slice(), orig = h && h.outfit; let i = max(0, list.indexOf(orig !== undefined ? orig : list[S.outfit % list.length]));
    const show = () => ui('◀ A    ' + (OUTFIT[list[i]] || list[i]) + '  ' + (i + 1) + '/' + list.length + '    D ▶      E 就这件 · Q 算了'), wear = () => { if (h && h.setOutfit) try { h.setOutfit(list[i]); } catch (e) { /* optional */ } sfx('ui_tick'); show(); };
    place(ctx, MIR.x - .95, MIR.z - .265, 1.3);
    run(ctx, { to: MIRCAM(), blend: .9, start: show, step(dt, I, o) { if (o.t < .3) return false; if (hit(I, 'KeyA', 'ArrowLeft')) { i = (i + list.length - 1) % list.length; wear(); } if (hit(I, 'KeyD', 'ArrowRight')) { i = (i + 1) % list.length; wear(); }
        if (hit(I, 'KeyE')) { S.outfit = i; sfx('ui_ok'); after(.2, () => say('阿凯', pick(['行，就这件。反正都是那几件。', '看着像个正经人。大概。', '这件上次洗是什么时候……算了。'], i))); if (API.onOutfit) try { API.onOutfit(list[i]); } catch (e) { /* hook */ } return true; }
        if (leaveKey(I)) { if (h && h.setOutfit && orig !== undefined) try { h.setOutfit(orig); } catch (e) { /* optional */ } return true; } return false; } }); }
  const FOOD = [['牛奶', '牛奶，过期两天。闻了闻——还行。'], ['啤酒', '半温不凉的啤酒。天热，它尽力了。'], ['周二的炒面', '冷炒面。越冷越香，这是科学。']];
  function useFridge(ctx) { const st = S.st; st.fridge = true; S.emDirty = true; sfx('thunk'); place(ctx, 1.7, -3.82, PI);
    const left = () => S.food.filter(f => f.visible).length, show = () => ui(left() ? 'E 拿点东西吃  （还剩 ' + left() + ' 样）      Q 关上冰箱' : '只剩辣酱和一个柠檬      Q 关上冰箱');
    run(ctx, { to: FRIDGECAM(), blend: .8, heroState: 'use', start: show, step(dt, I, o) { if (o.t < .45) return false; if (hit(I, 'KeyE')) { const k = S.food.findIndex(f => f.visible); if (k >= 0) { S.food[k].visible = false; S.snacks++; sfx('ui_ok'); say('阿凯', FOOD[k][1], 3); if (API.onSnack) try { API.onSnack(FOOD[k][0], S.snacks); } catch (e) { /* hook */ } } else say('阿凯', '该去趟便利店了。买东西的那种去法。', 3); show(); }
        return leaveKey(I); }, end() { st.fridge = false; sfx('thunk'); } }); }
  function useBed(ctx) { place(ctx, -.25, .55, -2.2); S.busy = true; const env = GT.env || {}, h0 = env.hours === undefined ? 18.2 : env.hours, add = 3, h1 = (h0 + add) % 24; let done = 0;
    run(ctx, { to: { pos: W3(.95, 1.55, 1.0), look: W3(-1.1, .55, -1.15), fov: 40 }, blend: 1.4, heroState: 'idle', start() { fade(1, 600); },
      step(dt, I, o) { if (o.t > .8 && done < 1) { done = 1; try { if (GT.atmos && GT.atmos.setTime) GT.atmos.setTime(h1); else if (GT.env) GT.env.hours = h1; } catch (e) { /* optional */ } S.slept++; S.food.forEach(f => { f.visible = true; }); S.envDirty = true; if (API.onSleep) try { API.onSleep(add, h1); } catch (e) { /* hook */ } }
        if (o.t > 1.7 && done < 2) { done = 2; fade(0, 800); say('阿凯', pick(['睡了三个钟头。梦见还在开车。', '醒了。天花板上的水渍好像又大了一点。', '三小时。够了，干这行的不需要更多。', '梦里郝老板在数钱。数的是我的。'], S.slept), 3.5); } return o.t > 2.6; }, end() { S.busy = false; } }); }
  function useStash(ctx) { const w = GT.wallet; if (w && w.cash > 0) { const n = w.cash; if (w.spend(n)) { S.stash += n; say('阿凯', '$' + n.toLocaleString('en-US') + ' 塞进床底的包。包里现在有 $' + S.stash.toLocaleString('en-US') + '。', 3.5); sfx('cash'); } }
    else if (S.stash > 0) { const n = S.stash; S.stash = 0; if (w) w.add(n, 'stash'); say('阿凯', '把 $' + n.toLocaleString('en-US') + ' 拿出来。周五之前别乱花。', 3.2); sfx('cash'); } else say('阿凯', '包是空的。和上周一样空。', 2.6);
    redrawNote(); if (API.onStash) try { API.onStash(S.stash); } catch (e) { /* hook */ } }
  function useSink(ctx) { place(ctx, -1.45, -3.95, -HP); S.st.water = true; sfx('thunk');
    run(ctx, { to: { pos: W3(-.92, 1.52, -3.58), look: W3(-2.05, 1.42, -3.98), fov: 44 }, blend: .7, heroState: 'use', step(dt, I, o) { if (o.t > 1.2 && !o.said) { o.said = true; say('阿凯', pick(['凉水。镜子里那个人看着需要睡一觉。', '洗把脸，清醒点。今晚还有活儿。', '水是温的。这地方连冷水都是温的。'], S.slept + S.snacks), 3); } return o.t > 2.6; }, end() { S.st.water = false; } }); }
  const PHONE = [['留言 · 郝老板', '“周五。别让我再打第二个电话。”'], ['留言 · 阿烈', '“哥，我找到个活儿，就五分钟的事。回我电话。”'], ['留言 · 梅姨', '“一〇六的，房租。还有，你的空调吵到一〇五了。”'], ['拨号音', '没有新留言。只有嘟——的一声。']];
  function toggle(key, onL, offL) { const st = S.st; st[key] = !st[key]; S.emDirty = true; S.envDirty = true; sfx(key === 'ac' ? 'thunk' : 'ui_tick'); if (onL) say('', st[key] ? onL : offL, 1.6); }
  function spot(id, lx, lz, r, label, onUse, extra) { const p = W(lx, lz), s = Object.assign({ id: 'safehouse:' + id, x: p.x, z: p.z, y: FLOOR, r, label, key: 'KeyE', mode: 'foot', enabled: () => S.inside && !S.busy && !S.take, onUse(ctx) { if (ctx && ctx.ctl) S.ctl = ctx.ctl; onUse(ctx || {}); } }, extra || {});
    if (GT.act && GT.act.add) GT.act.add(s); else (GT._actQueue = GT._actQueue || []).push(s); return s; }
  function registerSpots() {
    spot('door', 0, 0, 1.25, '进房间', ctx => enter(ctx.ctl), { x: A.door.x, z: A.door.z, marker: true, icon: 'door', enabled: () => S.built && !S.inside && !S.busy });
    spot('exit', DOORX, ZF - .55, .75, '出门', ctx => exit(ctx.ctl), { icon: 'door' });
    spot('mirror', MIR.x - .75, MIR.z - .1, .8, '换衣服', useMirror, { icon: 'shirt' }); spot('fridge', 1.7, -3.9, .8, '打开冰箱', useFridge); spot('tv', .95, TVW.z, .75, '看电视', useTV);
    spot('bed', -.75, .55, .75, '睡一觉', useBed, { hold: .5 }); spot('stash', .4, -1.7, .65, () => { const w = GT.wallet; return w && w.cash > 0 ? '藏钱  $' + Math.round(w.cash).toLocaleString('en-US') : S.stash > 0 ? '取出藏的钱  $' + Math.round(S.stash).toLocaleString('en-US') : '看看床底的包'; }, useStash);
    spot('sink', -1.3, -3.9, .7, '洗把脸', useSink); spot('switch', .7, ZF - .5, .5, () => S.st.ceil ? '关灯' : '开灯', () => toggle('ceil')); spot('lamp', -1.35, -.1, .55, () => S.st.lamp ? '关台灯' : '开台灯', () => toggle('lamp'));
    spot('ac', -.25, ZF - .6, .5, () => S.st.ac ? '关空调' : '开空调', () => toggle('ac', '空调：哐、哐、哐……嗡——', '空调停了。安静得不习惯。')); spot('blinds', -1.0, ZF - .6, .5, () => '拨百叶窗（' + ['全开', '半开', '合上'][S.st.blinds] + '）', () => { S.st.blinds = (S.st.blinds + 1) % 3; S.envDirty = true; sfx('ui_tick'); });
    spot('phone', 1.6, .0, .55, '听留言', () => { const p = pick(PHONE, S.phoneN = (S.phoneN || 0) + 1); sfx('ui_tick'); say(p[0], p[1], 4); });
  }

  /* ================================================================== build / update */
  function build(scene) { if (S.built) return S.root; const t0 = performance.now(); S.scene = scene;
    buildAtlas(); const B = buildRoom(); buildDynamic(B); scene.add(S.root); S.root.visible = false; if (GT.motel || Q.get('ext') !== '0') buildExterior(scene); colliders(); hollowWing(); addZone();
    const d = { x: EXT.x - 1.05, z: EXT.z, h: HP }, i = W(DOORX, ZF - .8); Object.assign(A, { door: d, inside: { x: i.x, z: i.z, h: WH(PI) }, bed: Object.assign(W(-.75, .55), { h: WH(-2.2) }), tv: Object.assign(W(.95, TVW.z), { h: WH(HP) }), mirror: Object.assign(W(MIR.x - .95, MIR.z - .265), { h: WH(1.3) }), fridge: Object.assign(W(1.7, -3.82), { h: WH(PI) }), sink: Object.assign(W(-1.45, -3.95), { h: WH(-HP) }), centre: Object.assign(W(.6, 0), { h: WH(PI) }) });
    GT.world.anchor('safehouseDoor', d); GT.world.anchor('safehouseInside', A.inside); registerSpots(); S.built = true; S.buildMs = performance.now() - t0; applyLights(0); return S.root; }
  function update(dt) { if (!S.built) return; dt = clamp(dt || 0, 0, .1); S.t += dt; const st = S.st;
    if (S.seq.length) { for (let i = 0; i < S.seq.length; i++) if (S.seq[i].t <= S.t) { const e = S.seq.splice(i--, 1)[0]; try { e.fn(); } catch (err) { console.warn('[safehouse]', err); } } }
    // exterior door
    if (S.ext) { if (S.extDoor !== S.extDoorT) { S.extDoor += clamp(S.extDoorT - S.extDoor, -dt * 3.2, dt * 3.2); S.extPiv.rotation.y = sst(S.extDoor, 0, 1) * 1.45; } S.extVoid.visible = S.extDoor > .004 && !S.inside; }
    if (S.sayT > 0 && (S.sayT -= dt) <= 0 && !S.take) ui('');
    if (!S.inside) { for (const k in hits) hits[k] = false; return; }
    hideWorld();
    if (S.door !== S.doorT) S.door += clamp(S.doorT - S.door, -dt * 3.2, dt * 3.2); S.doorPiv.rotation.y = -sst(S.door, 0, 1) * 1.62;
    const ft = st.fridge ? 1 : 0; S.fridgeMoving = S.fridge !== ft; if (S.fridgeMoving) S.fridge += clamp(ft - S.fridge, -dt * 2.6, dt * 2.6); S.fridgePiv.rotation.y = sst(S.fridge, 0, 1) * 1.74; S.fridgeItems.visible = S.fridge > .02;
    const sl = SLAT[st.blinds]; if (S.slat !== sl) { S.slat += clamp(sl - S.slat, -dt * 2.2, dt * 2.2); setSlats(S.slat); }
    S.fan += dt * 2.3; S.fanG.rotation.y = S.fan; S.fanG.rotation.z = .012 * sin(S.fan); S.fanG.rotation.x = .012 * cos(S.fan);
    S.acK += clamp((st.ac ? 1 : 0) - S.acK, -dt * 1.2, dt * 1.5); ribbons(); S.stream.visible = st.water;
    if (st.tv) S.tvT += dt; if (S.tvStatic > 0) S.tvStatic -= dt; if (S.tvOsd > 0) S.tvOsd -= dt; S.tvAcc += dt;
    if (!S.pre && S.tvAcc >= 1 / 30) { S.tvAcc = 0; const c = tvDraw(), k = st.tv ? .35 : 1; S.tvCol = [lerp(S.tvCol[0], c[0], k), lerp(S.tvCol[1], c[1], k), lerp(S.tvCol[2], c[2], k)]; }
    applyLights(dt);
    if (!S.pre) { acSound(st.ac); if (S.envDirty && (S.t - S.envT > .4 || !ENV.rt)) { if (envUpdate()) { S.envDirty = false; S.envT = S.t; } } }
    if (S.standIn && S.standIn.update) { try { S.standIn.update(dt, { state: S.standState || 'idle', speed: 0, turn: 0, lookYaw: 0, lookPitch: 0, t: S.t }); } catch (e) { /* stand-in only */ } }
    if (S.solo) { const so = S.solo; let done = false; try { done = so.upd(dt); } catch (e) { done = true; console.warn('[safehouse]', e); } if (S.cam && !S.fixedCam) { const c = so.cam(); S.cam.position.set(c.pos[0], c.pos[1], c.pos[2]); S.cam.lookAt(c.look[0], c.look[1], c.look[2]); if (S.cam.fov !== c.fov) { S.cam.fov = c.fov; S.cam.updateProjectionMatrix(); } } if (done) { S.solo = null; so.end(); } }
    for (const k in hits) hits[k] = false; }
  function ribbons() { const g = S.ribbons.geometry, P = g.attributes.position.array, seg = S.ribSeg, on = S.acK, t = S.t; let o = 0;
    S.ribBase.forEach((b, r) => { for (let j = 0; j <= seg; j++) { const s = j / seg * .19, wv = sin(t * 11 + j * 1.1 + r * 2.1) * .012 + sin(t * 17.3 + j * .7 + r) * .006, y = b[1] - s * lerp(1, .28, on) + wv * on * (j / seg) * 1.6, z = b[2] - .004 - s * .94 * on, x = b[0] + sin(t * 7 + r * 3 + j * .5) * .008 * on * (j / seg);
        P[o++] = x - .007; P[o++] = y; P[o++] = z; P[o++] = x + .007; P[o++] = y; P[o++] = z; } }); g.attributes.position.needsUpdate = true; g.computeVertexNormals(); }

  /* ================================================================== export */
  const API = GT.safehouse = { build, update, enter, exit, anchors: A, state: S.st, channels: CHAN.map(c => c.n), onSleep: null, onSnack: null, onStash: null, onOutfit: null,
    get inside() { return S.inside; }, get busy() { return S.busy || !!S.take; }, get stash() { return S.stash; }, set stash(v) { S.stash = max(0, +v || 0); redrawNote(); },
    /** push a headline to the room's TV news: news('标题', '副标题', kind?: 'rob'|'chase'|'bird'|'pool'|'man') */
    news(title, sub_, kind) { S.news.push([String(title), String(sub_ || '本台正在核实。'), kind || 'man']); if (S.news.length > 6) S.news.shift(); },
    /** setState({lamp, ceil, bath, kit, tv, ac, blinds: 0|1|2, fridge, ch}) */
    setState(p) { Object.assign(S.st, p || {}); S.st.ch = clamp(S.st.ch | 0, 0, CHAN.length - 1); S.st.blinds = clamp(S.st.blinds | 0, 0, 2); S.emDirty = S.envDirty = true; S.tvAcc = 1; },
    interact: { tv: useTV, mirror: useMirror, fridge: useFridge, bed: useBed, stash: useStash, sink: useSink }, room: { RX, RZ, FLOOR, HW, ZF, ZR, CH, toWorld: W3 }, _S: S };

  /* ================================================================== showcases */
  function standIn(lx, lz, hl, state) { let f = null; try { f = GT.hero && GT.hero.make ? GT.hero.make('kai') : GT.people && GT.people.make ? GT.people.make('ped', { type: 'worker', seed: 4 }) : null; } catch (e) { f = null; } if (!f || !f.group) return null;
    const p = W(lx, lz); f.group.position.set(p.x, FLOOR, p.z); f.group.rotation.y = WH(hl); S.scene.add(f.group); S.keep.add(f.group); S.standIn = f; S.standState = state || 'idle'; return f; }
  function prep(ctx, o) { o = o || {}; const num = (k, d) => Q.get(k) !== null && Q.get(k) !== '' ? +Q.get(k) : d, st = S.st; S.showcase = true; S.fixedCam = true;
    if (o.world) { for (const n of ['road', 'station', 'motel']) if (GT[n] && GT[n].build && !(S.worldBuilt = S.worldBuilt || {})[n]) { S.worldBuilt[n] = true; try { GT[n].build(ctx.scene); } catch (e) { console.warn('[safehouse] ' + n, e); } } }
    build(ctx.scene); S.cam = ctx.camera; st.blinds = clamp(num('blinds', st.blinds) | 0, 0, 2); st.lamp = !!num('lamp', 1); st.ceil = !!num('ceil', 0); st.tv = !!num('tv', 1); st.ac = !!num('ac', 1); st.bath = !!num('bath', 1); st.ch = clamp(num('ch', st.ch) | 0, 0, CHAN.length - 1); S.slat = SLAT[st.blinds]; setSlats(S.slat);
    if (o.fig && Q.get('fig') !== '0') standIn(o.fig[0], o.fig[1], o.fig[2], o.fig[3]); if (o.inside !== false) setInside(true); if (o.before) o.before();
    S.pre = true; for (let i = 0, n = Math.round(num('at', o.at || 0) * 30); i < n; i++) update(1 / 30); S.pre = false; S.tvAcc = 1; S.emDirty = true; }
  function view(c, l, fov) { const v = k => Q.get(k) ? Q.get(k).split(',').map(Number) : null, C = v('lc') || c, Lk = v('ll') || l; if (fov && !Q.get('fov') && S.cam) { S.cam.fov = fov; S.cam.updateProjectionMatrix(); } return { cam: W3(C[0], C[1], C[2]), look: W3(Lk[0], Lk[1], Lk[2]), hours: 18.2, update }; }
  const camView = c => { if (c.fov && !Q.get('fov') && S.cam) { S.cam.fov = c.fov; S.cam.updateProjectionMatrix(); } return { cam: c.pos, look: c.look, hours: 18.2, update }; };
  GT.showcase.safehouse = ctx => { const v = +Q.get('v') || 0; prep(ctx, { fig: v === 1 ? [.55, -1.6, .2, 'idle'] : v === 3 ? null : [.95, 1.25, PI + .12, 'idle'] });
    return v === 1 ? view([.7, 1.62, -3.05], [-.5, 1.1, 1.6], 58) : v === 2 ? view([-1.55, 1.6, 2.6], [1.2, .9, -2.2], 60) : v === 3 ? view([1.75, 2.35, 2.9], [-.6, .3, -1.6], 64) : view([1.62, 1.68, 3.02], [.25, 1.02, -1.7], 58); };
  GT.showcase.safehouse_tv = ctx => { prep(ctx, { at: 3 }); return camView(TVCAM()); };
  GT.showcase.safehouse_mirror = ctx => { prep(ctx, { fig: [MIR.x - .95, MIR.z - .265, 1.3, 'idle'], before() { ui('◀ A    拖车夹克  3/4    D ▶      E 就这件 · Q 算了'); } }); return camView(MIRCAM()); };
  GT.showcase.safehouse_fridge = ctx => { prep(ctx, { fig: [1.7, -3.82, PI, 'use'], at: 1.2, before() { S.st.fridge = true; ui('E 拿点东西吃  （还剩 3 样）      Q 关上冰箱'); } }); return camView(FRIDGECAM()); };
  GT.showcase.safehouse_details = ctx => { const d = +Q.get('d') || 0; prep(ctx, {});
    const V = [[[-.72, 1.32, 1.3], [-1.8, .78, 1.8], 46], [[1.0, 1.72, .5], [2.1, 1.52, 1.25], 44], [[-.55, 1.25, .75], [-2.0, .78, -.55], 46], [[.55, 1.45, -3.55], [1.15, 1.0, -5.2], 50], [[-.62, 1.5, -3.05], [-1.5, 1.05, -4.9], 58], [[.35, 1.35, 1.75], [-.75, 1.25, 3.3], 52], [[.5, 1.3, -.5], [2.1, 1.0, -1.35], 46]][d] || [[0, 1.5, 0], [0, 1, -2], 55]; return view(V[0], V[1], V[2]); };
  GT.showcase.safehouse_door = ctx => { prep(ctx, { world: true, inside: false, before() { if (Q.get('open') === '1') { S.extDoorT = 1; } } }); return { cam: [70.7, 1.72, 77.6], look: [74, 1.12, 75.0], hours: 18.2, update }; };
})();
