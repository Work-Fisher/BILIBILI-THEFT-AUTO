/* hangouts.js — SUNSET HEAT round 2: the public places where the neighbourhood's small activities happen.
   GT.hangouts = { build(scene, opts?) -> Group, update(dt), anchors, props, groundHeight(x, z), install(), info }
   Six set pieces, all at world coordinates:
     1 half-court (-34,-60)   2 outdoor gym (-30,-20)   3 tiki bar "The Drift Line" (-32,30)
     4 fishing pier dressing on the road module's pier (z = 78)   5 backyard wrestling ring in lot D (120,63.8)   6 shop-front corner on the store's south wall (50..62,-30)
   Geometry is merged per material in four regional kits (court+gym / bar+pier / ring / corner) plus one global kit for everything small
   (atlas art, colour-swatch props, decals, glows), so the whole module stays well under 80 draw calls. Owner: hangouts agent. */
(function () {
  'use strict';
  const T = THREE, GT = window.GT, PI = Math.PI, HP = PI / 2, TAU = PI * 2, lerp = GT.lerp, cl = GT.clamp;
  const S = { built: null, t: 0, plats: [], over: [], anchors: {}, props: {}, lights: {}, fans: [], info: {}, base: null, sway: [] };
  let K = null, KG = null, M = null, A = null, AG = null, ART = null;
  const UP = { rx: -HP }, N_ = {}, S_ = { ry: PI }, E_ = { ry: HP }, W_ = { ry: -HP }, WHITE = new T.Color(1, 1, 1), YAX = new T.Vector3(0, 1, 0), ONE = new T.Vector3(1, 1, 1);
  const FB = "'Arial Black','Helvetica Neue',Impact,Arial,sans-serif", FH = "'Marker Felt','Chalkboard SE','Comic Sans MS',cursive", FC = "'Chalkduster','Chalkboard SE','Marker Felt',cursive",
    FN = "'DIN Condensed','Arial Narrow','Helvetica Neue',Arial,sans-serif", FS = "'Brush Script MT','Snell Roundhand','Savoye LET',cursive";
  const warn = m => { const e = document.getElementById('err'); if (e) e.textContent += '[hangouts] ' + m + '\n'; console.warn('[hangouts]', m); };

  /* ================================================================== ground + registry helpers */
  const fallbackGround = (x, z) => (x < -10.42 ? -.42 - 1.22 * Math.pow(cl((-10.42 - x) / 50, 0, 1), 1.12) : x < -7.5 ? .14 : 0);
  /** terrain height from the road module (the un-wrapped original), without our platforms */
  const gy = (x, z) => (S.base ? S.base(x, z) : fallbackGround(x, z));
  /** ground height including every walkable surface this module adds (court slab, gym pad, bar deck + steps, pier deck, ring canvas, corner pad)
      and two fixes the beach needs to be reachable on foot (the seawall stair ramps and the pier mouth). */
  function groundHeight(x, z) {
    for (const o of S.over) if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1) return typeof o.y === 'function' ? o.y(x, z) : o.y;
    let y = gy(x, z);
    for (const p of S.plats) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) { const py = typeof p.y === 'function' ? p.y(x, z) : p.y; if (py > y) y = py; }
    return y;
  }
  const plat = (x0, z0, x1, z1, y, tag) => S.plats.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y, tag });
  const box = (x0, z0, x1, z1, h, tag) => GT.world.addBox(x0, z0, x1, z1, h, 'hangouts:' + tag);
  const post = (x, z, r, h, tag) => GT.world.addPost(x, z, r, h, 'hangouts:' + tag);
  const anchor = (name, v) => { S.anchors[name] = v; GT.world.anchor(name, v); return v; };

  /* ================================================================== canvas helpers + atlases */
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const css = h => '#' + ('000000' + (h >>> 0).toString(16)).slice(-6);
  function Atlas(W, H, bg) {
    const c = cv(W, H), g = c.getContext('2d'), items = []; if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
    const at = { c, g, W, H, tex: null,
      add(w, h, draw) { const r = { w, h }; items.push({ w, h, draw, r }); return r; },
      pack(reserve) { items.sort((p, q) => q.h - p.h || q.w - p.w); let x = 3, y = 3, rh = 0; const lim = H - (reserve || 0);
        for (const it of items) { if (x + it.w + 3 > W) { x = 3; y += rh + 6; rh = 0; } if (y + it.h + 3 > lim) warn('atlas overflow ' + it.w + 'x' + it.h);
          g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, it.w, it.h); g.clip(); try { it.draw(g, it.w, it.h); } catch (e) { warn('art: ' + e.message); } g.restore();
          Object.assign(it.r, { u0: (x + .5) / W, u1: (x + it.w - .5) / W, v1: 1 - (y + .5) / H, v0: 1 - (y + it.h - .5) / H }); x += it.w + 6; rh = Math.max(rh, it.h); }
        const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; at.tex = t; return t; } };
    return at;
  }
  /** colour swatches live in the bottom 128 px of the lit atlas: any small prop can be any paint colour without another draw call */
  const SW = { map: new Map(), n: 0 };
  function swUV(hex) { let e = SW.map.get(hex); if (e) return e; const i = SW.n++, x = (i % 64) * 32, y = A.H - 128 + ((i / 64) | 0) * 32; if (i >= 256) warn('swatches exhausted');
    A.g.fillStyle = css(hex); A.g.fillRect(x, y, 32, 32); A.tex.needsUpdate = true; e = [(x + 16) / A.W, 1 - (y + 16) / A.H]; SW.map.set(hex, e); return e; }
  const flat = (g, hex) => { const e = swUV(hex), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, e[0], e[1]); return g; };
  const remap = (g, r, flip) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = flip ? 1 - uv.getX(i) : uv.getX(i); uv.setXY(i, lerp(r.u0, r.u1, u), lerp(r.v0, r.v1, uv.getY(i))); } return g; };
  function txt(g, s, x, y, px, col, font, o) { o = o || {}; g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot); if (o.skew) g.transform(1, 0, o.skew, 1, 0, 0); g.font = (o.wt || '700') + ' ' + px + 'px ' + (font || FB); g.textAlign = o.al || 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = o.sw || px * .14; g.strokeText(s, 0, 0, o.max); } g.fillStyle = col; g.fillText(s, 0, 0, o.max); g.restore(); }
  /** sun-fade + dirt speckle + streaks + grubby bottom edge on any painted art */
  function grime(g, w, h, seed, amt) { const r = GT.rng(seed), k = w * h / 65536; g.save(); g.fillStyle = 'rgba(232,224,204,' + (.1 * amt) + ')'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 110 * amt * k; i++) { const x = r() * w, y = r() * h, s = 1 + r() * r() * 9; g.fillStyle = 'rgba(' + (40 + r() * 40 | 0) + ',' + (32 + r() * 30 | 0) + ',' + (22 + r() * 20 | 0) + ',' + ((.04 + r() * .2) * amt).toFixed(3) + ')'; g.beginPath(); g.ellipse(x, y, s, s * (.4 + r() * .6), r() * 3, 0, TAU); g.fill(); }
    for (let i = 0; i < 9 * amt * (w / 256); i++) { const x = r() * w, y0 = r() * h * .5, l = h * (.2 + r() * .6), gr = g.createLinearGradient(0, y0, 0, y0 + l); gr.addColorStop(0, 'rgba(50,38,26,' + (.26 * amt).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(50,38,26,0)'); g.fillStyle = gr; g.fillRect(x, y0, 1.5 + r() * 5, l); }
    const eg = g.createLinearGradient(0, h * .72, 0, h); eg.addColorStop(0, 'rgba(60,48,34,0)'); eg.addColorStop(1, 'rgba(60,48,34,' + (.3 * amt).toFixed(3) + ')'); g.fillStyle = eg; g.fillRect(0, h * .72, w, h * .28); g.restore(); }
  const sign = (g, w, h, text, o) => { const t = GT.signTex(text, Object.assign({ w, h }, o)); if (t && t.image) g.drawImage(t.image, 0, 0, w, h); };
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  /* ================================================================== kit helpers (K = current regional kit, KG = global kit) */
  const P = (x, y, z, o) => { K.push(x, y, z, o); KG.push(x, y, z, o); };
  const Q = () => { K.pop(); KG.pop(); };
  const mt = (n, o) => GT.mat(n, o);
  const B = (m, w, h, d, x, y, z, b, o) => K.box(m, w, h, d, x, y, z, Object.assign({ bevel: b || 0 }, o));
  const E = (m, x0, y0, z0, x1, y1, z1, b) => K.box(m, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, { bevel: b || 0 });
  const C = (m, rt, rb, h, x, y, z, o) => K.cyl(m, rt, rb, h, x, y, z, o);
  function rodGeo(a, b, r, seg, r2) { const d = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length() || 1e-4, g = new T.CylinderGeometry(r2 === undefined ? r : r2, r, len, seg || 8, 1, false), uv = g.attributes.uv, c = TAU * r;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * c, uv.getY(i) * len);
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), new T.Quaternion().setFromUnitVectors(YAX, d.multiplyScalar(1 / len)), ONE)); return g; }
  /** one board with the wood grain running along its length. Modelled with the length on local X: flat along Z -> {ry: HP}; upright on a wall facing ±Z -> {rz: HP, ry: HP}; upright facing ±X -> {rz: HP} */
  let PLK = 0;
  function PLX(m, L, th, w, x, y, z, b, o) { const g = GT.boxGeo(L, th, w, b || 0), uv = g.attributes.uv, i = PLK++, du = (i * .617) % 1.5, dv = .07 + ((i * 5) % 6) * .14; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) + du, uv.getY(k) + dv); return K.geo(m, g, Object.assign({ x, y, z }, o)); }
  /** round bar between two points (frames, braces, ropes). r = radius at a, r2 = radius at b */
  const rod = (m, a, b, r, seg, r2) => K.geo(m, rodGeo(a, b, r, seg, r2));
  /** square bar between two points */
  function bar(m, a, b, w, d) { const v = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = v.length() || 1e-4, g = GT.boxGeo(w, len, d === undefined ? w : d, Math.min(w, d === undefined ? w : d) * .12);
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), new T.Quaternion().setFromUnitVectors(YAX, v.multiplyScalar(1 / len)), ONE)); return K.geo(m, g); }
  /* swatch-coloured primitives (global kit, lit atlas). o.metal -> metallic variant */
  const sgeo = (g, hex, x, y, z, o) => { o = o || {}; return KG.geo(o.metal ? M.litM : M.lit, flat(g, hex), { x, y, z, rx: o.rx, ry: o.ry, rz: o.rz, s: o.s }); };
  const sb = (hex, w, h, d, x, y, z, o) => sgeo(GT.boxGeo(w, h, d, o && o.bevel), hex, x, y, z, o);
  const sc = (hex, rt, rb, h, x, y, z, o) => sgeo(new T.CylinderGeometry(rt, rb, h, (o && o.seg) || 12, 1, !!(o && o.open)), hex, x, y, z, o);
  const ss = (hex, r, x, y, z, o) => sgeo(new T.SphereGeometry(r, (o && o.seg) || 12, (o && o.seg2) || 8), hex, x, y, z, o);
  const srod = (hex, a, b, r, seg, o) => KG.geo(o && o.metal ? M.litM : M.lit, flat(rodGeo(a, b, r, seg, o && o.r2), hex));
  const stube = (hex, pts, r, o) => { o = o || {}; const curve = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p[0], p[1], p[2])), false, 'catmullrom', .5); return KG.geo(o.metal ? M.litM : M.lit, flat(new T.TubeGeometry(curve, o.steps || pts.length * 5, r, o.seg || 6, false), hex)); };
  const stor = (hex, R, r, x, y, z, o) => sgeo(new T.TorusGeometry(R, r, (o && o.seg) || 8, (o && o.seg2) || 20, (o && o.arc) || TAU), hex, x, y, z, o);
  /** atlas quad: plane w×h mapped to rect r. two: also add the back face (mirrored like a real printed banner) */
  function aq(m, r, w, h, x, y, z, rot, two) { rot = rot || {}; KG.geo(m, remap(new T.PlaneGeometry(w, h), r), Object.assign({ x, y, z }, rot));
    if (two) { const g = remap(new T.PlaneGeometry(w, h), r, true); g.rotateY(PI); KG.geo(m, g, Object.assign({ x, y, z }, rot)); } }
  /** flat shape (THREE.Shape in metres) textured with an atlas rect stretched over its bounds */
  function shapeFace(m, shape, r, o, seg) { const g = new T.ShapeGeometry(shape, seg || 10); g.computeBoundingBox(); const bb = g.boundingBox, p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, lerp(r.u0, r.u1, (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x)), lerp(r.v0, r.v1, (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y))); return KG.geo(m, g, o); }
  const dec = (name, w, d, x, y, z, ry) => KG.decal(name, w, d, x, y, z, ry || 0);
  const wdec = (name, w, h, x, y, z, rot) => KG.quad(GT.decalMat(name), w, h, x, y, z, rot);
  const spill = (w, d, x, y, z) => aq(M.spill, ART.pool, w, d, x, y, z, UP);
  /** low sand mound: drifts against kerbs, on tiles and planks */
  function drift(x, y, z, rx, rz, h, ry, mat) { const NR = 5, NA = 22, pos = [0, h, 0], uv = [x, z], idx = [], r = GT.rng('d' + x.toFixed(2) + '_' + z.toFixed(2)), rad = []; for (let a = 0; a < NA; a++) rad.push(.72 + r() * .56);
    for (let i = 1; i <= NR; i++) { const t = i / NR, py = i === NR ? -.012 : h * Math.pow(.5 + .5 * Math.cos(PI * t), 1.3); for (let a = 0; a < NA; a++) { const an = a / NA * TAU, k = (rad[a] * .6 + rad[(a + 1) % NA] * .2 + rad[(a + NA - 1) % NA] * .2) * t, px = Math.cos(an) * rx * k, pz = Math.sin(an) * rz * k; pos.push(px, py, pz); uv.push(x + px, z + pz); } }
    for (let a = 0; a < NA; a++) idx.push(0, 1 + (a + 1) % NA, 1 + a); for (let i = 0; i < NR - 1; i++) for (let a = 0; a < NA; a++) { const p = 1 + i * NA + a, q = 1 + i * NA + (a + 1) % NA; idx.push(p, q, p + NA, q, q + NA, p + NA); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return K.geo(mat || 'sand', g, { x, y, z, ry: ry || 0 }); }
  /** sagging line between two points -> [[x,y,z]...] */
  const sag = (a, b, drop, n) => { const o = []; n = n || 10; for (let i = 0; i <= n; i++) { const t = i / n; o.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) - drop * 4 * t * (1 - t), lerp(a[2], b[2], t)]); } return o; };
  /* instanced helpers */
  const INST = { bulbs: [], bottles: [] };
  /** festoon: cable + bulbs every `step` m. colours cycle through `cols` (linear rgb triples) */
  /** local (current push frame) -> world [x, y, z] */
  const wp = (x, y, z) => { const v = new T.Vector3(x, y, z).applyMatrix4(K.top); return [v.x, v.y, v.z]; };
  const bulb = (x, y, z, c, s) => { const v = wp(x, y, z); INST.bulbs.push([v[0], v[1], v[2], c ? c[0] : 1, c ? c[1] : .78, c ? c[2] : .5, s || 1]); };
  /** festoon: cable + bulbs every `step` m. cols = list of linear rgb triples to cycle through */
  function festoon(a, b, drop, step, cols) { const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(2, Math.round(len / step)), pts = sag(a, b, drop, n); K.tube('rubber', pts, .007, { seg: 4, steps: n });
    for (let i = 1; i < n; i++) { const p = pts[i]; bulb(p[0], p[1] - .06, p[2], cols ? cols[(i + INST.bulbs.length) % cols.length] : null); sc(0x1b1b1b, .013, .013, .045, p[0], p[1] - .022, p[2], { seg: 6 }); } return pts; }

  /* ================================================================== artwork (two atlases + court paint + chain-link) — all original names */
  function banner(g, w, h, bg, col, big, small, seed) { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.globalAlpha = .13; g.fillStyle = '#000'; for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h); for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, h - 12);
    for (let x = 20; x < w; x += 62) for (const y of [11, h - 11]) { g.fillStyle = '#b9b6a8'; g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); g.fillStyle = '#1c1c1c'; g.beginPath(); g.arc(x, y, 2.2, 0, TAU); g.fill(); }
    txt(g, big, w / 2, h * .43, h * .44, col, FB, { max: w * .9 }); txt(g, small, w / 2, h * .79, h * .16, col, FN, { max: w * .9 }); grime(g, w, h, seed, 1.3); }
  function flyer(g, x, y, w, h, rot, bg, pin, draw) { g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(rot); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 6; g.shadowOffsetY = 3; g.fillStyle = bg; g.fillRect(-w / 2, -h / 2, w, h); g.shadowColor = 'transparent';
    g.save(); g.translate(-w / 2, -h / 2); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(g, w, h); g.restore(); g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(1.5, -h / 2 + 10, 5.5, 0, TAU); g.fill(); g.fillStyle = pin; g.beginPath(); g.arc(0, -h / 2 + 8, 5, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(-1.5, -h / 2 + 6.5, 1.6, 0, TAU); g.fill(); g.restore(); }
  const lines = (g, w, y0, dy, n, col) => { g.fillStyle = col; const r = GT.rng('ln' + y0 + n); for (let i = 0; i < n; i++) g.fillRect(w * .1, y0 + i * dy, w * (.5 + r() * .3), 2); };
  const tabs = (g, w, h, n) => { g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1; for (let i = 1; i < n; i++) { g.beginPath(); g.moveTo(w * i / n, h - 30); g.lineTo(w * i / n, h); g.stroke(); } g.beginPath(); g.moveTo(0, h - 30); g.lineTo(w, h - 30); g.stroke(); };

  function makeArt() {
    A = Atlas(3072, 2048, '#6b6860'); AG = Atlas(1024, 1024, '#000'); const a = {}, r0 = GT.rng('hangart');
    // ---- court
    a.banner1 = A.add(1024, 160, (g, w, h) => banner(g, w, h, '#1f3b33', '#e9e2cc', 'SOUTH SHORE DUSK LEAGUE', '3 ON 3  ·  WINNER STAYS  ·  PLAY TILL DARK', 'bn1'));
    a.banner2 = A.add(1024, 160, (g, w, h) => banner(g, w, h, '#23304a', '#e3b54a', 'MARISOL TIRE & LUBE', 'PROUD SPONSOR OF STREET BALL SINCE 1989  ·  HWY 9 AT COQUINA', 'bn2'));
    a.board = A.add(384, 272, (g, w, h) => { g.fillStyle = '#d9d6cc'; g.fillRect(0, 0, w, h); g.strokeStyle = '#b5532a'; g.lineWidth = 9; g.strokeRect(w * .5 - 62, h - 132, 124, 96); g.lineWidth = 7; g.strokeStyle = 'rgba(181,83,42,.75)'; g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = 'rgba(40,40,40,.5)'; for (let y = 22; y < h - 14; y += 13) for (let x = 22 + ((y / 13) & 1) * 6.5; x < w - 16; x += 13) { g.beginPath(); g.arc(x, y, 1.7, 0, TAU); g.fill(); }
      const r = GT.rng('bb'); for (let i = 0; i < 26; i++) { const x = r() * w, y = r() * h, s = 3 + r() * 14, gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, 'rgba(110,58,28,.7)'); gr.addColorStop(1, 'rgba(110,58,28,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2 + 30 * r()); }
      txt(g, 'DUSK LGE', w * .2, h * .2, 22, 'rgba(30,60,90,.7)', FH, { rot: -.12 }); grime(g, w, h, 'bbg', 1.6); });
    a.ball = A.add(256, 128, (g, w, h) => { g.fillStyle = '#a4542a'; g.fillRect(0, 0, w, h); const r = GT.rng('ball'); for (let i = 0; i < 2600; i++) { g.fillStyle = r() < .5 ? 'rgba(60,24,8,.25)' : 'rgba(220,140,90,.16)'; g.fillRect(r() * w, r() * h, 1.6, 1.6); }
      g.strokeStyle = '#17120f'; g.lineWidth = 3.2; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); for (const u of [0, .25, .5, .75, 1]) { g.moveTo(u * w, 0); g.lineTo(u * w, h); } g.stroke();
      for (const u of [.125, .625]) { g.beginPath(); g.ellipse(u * w, h / 2, w * .085, h * .36, 0, 0, TAU); g.stroke(); } g.fillStyle = 'rgba(90,80,70,.35)'; g.fillRect(0, h * .6, w, h * .4); });
    a.net = A.add(256, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.lineCap = 'round'; for (const [col, lw, o] of [['#4a4a48', 6, 1.5], ['#b4b6b4', 3.6, 0]]) { g.strokeStyle = col; g.lineWidth = lw; for (let i = -2; i < 14; i++) { const x = i * w / 12; g.beginPath(); g.moveTo(x + o, 0); g.lineTo(x + w / 6 * 1.0 + o, h); g.moveTo(x + w / 6 + o, 0); g.lineTo(x + o, h); g.stroke(); } } g.clearRect(0, h - 3, w, 3); });
    // ---- gym
    a.rules = A.add(384, 512, (g, w, h) => { g.fillStyle = '#e4dcc6'; g.fillRect(0, 0, w, h); g.strokeStyle = '#1f4a78'; g.lineWidth = 10; g.strokeRect(12, 12, w - 24, h - 24); txt(g, 'IRON SHORE', w / 2, 62, 52, '#1f4a78', FB, { max: w * .82 }); txt(g, 'OUTDOOR GYM · FREE · DAWN TO DUSK', w / 2, 104, 17, '#b03a26', FN, { max: w * .8 });
      ['1. RE-RACK YOUR WEIGHTS', '2. WIPE THE BENCH, CHAMP', '3. SPOT YOUR NEIGHBOUR', '4. NO GLASS ON THE PAD', '5. NO SHIRT? NO PROBLEM', '6. CHALK STAYS IN THE BUCKET', '7. GRUNTING IS PERMITTED'].forEach((s, i) => txt(g, s, 40, 152 + i * 43, 25, '#20252a', FH, { al: 'left', max: w - 76, rot: (r0() - .5) * .02 }));
      g.fillStyle = '#b03a26'; g.fillRect(28, h - 70, w - 56, 42); txt(g, 'LIFT AT YOUR OWN RISK', w / 2, h - 48, 24, '#f0e8d4', FB, { max: w - 80 }); grime(g, w, h, 'rules', 1.5); });
    a.plate = A.add(128, 128, (g, w, h) => { g.fillStyle = '#26262a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#3c3c42'; g.lineWidth = 6; for (const rr_ of [58, 40, 16]) { g.beginPath(); g.arc(64, 64, rr_, 0, TAU); g.stroke(); } g.save(); g.translate(64, 64); const s = '20 KG · IRON SHORE · 20 KG · '; for (let i = 0; i < s.length; i++) { g.save(); g.rotate(i / s.length * TAU); txt(g, s[i], 0, -49, 11, '#8a8a8e', FB); g.restore(); } g.restore();
      const r = GT.rng('pl'); for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(120,62,30,' + (.1 + r() * .3) + ')'; g.beginPath(); g.arc(r() * w, r() * h, 2 + r() * 7, 0, TAU); g.fill(); } });
    a.towel = A.add(128, 64, (g, w, h) => { g.fillStyle = '#d8d2c2'; g.fillRect(0, 0, w, h); for (const [x, c] of [[14, '#3d7a84'], [30, '#c9713f'], [86, '#3d7a84'], [102, '#c9713f']]) { g.fillStyle = c; g.fillRect(x, 0, 10, h); } grime(g, w, h, 'tw', 1); });
    // ---- bar
    a.menu = A.add(448, 576, (g, w, h) => { g.fillStyle = '#1b2220'; g.fillRect(0, 0, w, h); const r = GT.rng('menu'); for (let i = 0; i < 70; i++) { g.fillStyle = 'rgba(225,228,215,' + (.015 + r() * .035) + ')'; g.beginPath(); g.ellipse(r() * w, r() * h, 30 + r() * 90, 8 + r() * 26, r() * 3, 0, TAU); g.fill(); }
      txt(g, 'The Drift Line', w / 2, 54, 62, '#f2ead6', FS, { wt: '400' }); txt(g, '~  T O N I G H T  ~', w / 2, 104, 20, '#e8b04a', FC);
      [['Rum Squall', 9, '#f2ead6'], ['Mango Riptide', 8, '#f0b45a'], ['Pier Pressure', 10, '#f2ead6'], ['Sunburn Spritz', 8, '#ef8a6a'], ['Salt Dog', 7, '#f2ead6'], ['Coco Slush', 9, '#9fd6c8'], ['Low Tide Lager', 5, '#f2ead6'], ['Lazy Gator IPA', 6, '#b8d88a'], ['Virgin Undertow', 5, '#f2ead6']].forEach((d, i) => { const y = 152 + i * 40; txt(g, d[0], 34, y, 25, d[2], FC, { al: 'left', max: w * .62 }); txt(g, '$' + d[1], w - 34, y, 25, '#f2ead6', FC, { al: 'right' }); g.fillStyle = 'rgba(242,234,214,.35)'; for (let x = w * .7; x < w - 86; x += 9) g.fillRect(x, y + 8, 2, 2); });
      g.strokeStyle = '#e8b04a'; g.lineWidth = 3; g.setLineDash([9, 6]); g.strokeRect(30, h - 72, w - 60, 48); g.setLineDash([]); txt(g, 'HAPPY HOUR 4–7 · 2 for 1 SLUSH', w / 2, h - 47, 21, '#e8b04a', FC, { max: w - 84 }); });
    a.aframe = A.add(320, 448, (g, w, h) => { g.fillStyle = '#20282a'; g.fillRect(0, 0, w, h); const r = GT.rng('af'); for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(225,228,215,' + (.02 + r() * .04) + ')'; g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 60, 6 + r() * 20, r() * 3, 0, TAU); g.fill(); }
      txt(g, 'COLD', w / 2, 70, 74, '#9fd6c8', FC); txt(g, 'DRINKS', w / 2, 142, 62, '#9fd6c8', FC); txt(g, '&', w / 2, 204, 44, '#f2ead6', FS, { wt: '400' }); txt(g, 'HOT', w / 2, 262, 74, '#ef8a6a', FC); txt(g, 'SUNSETS', w / 2, 332, 52, '#ef8a6a', FC); txt(g, 'the drift line  →', w / 2, 404, 30, '#f2ead6', FS, { wt: '400' }); grime(g, w, h, 'afg', .6); });
    a.poster1 = A.add(192, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#d98a3a'); gr.addColorStop(.6, '#b2452c'); gr.addColorStop(1, '#3a1d22'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#f3d9a0'; g.beginPath(); g.arc(w / 2, h * .46, 44, 0, TAU); g.fill(); g.fillStyle = '#2a1616'; g.fillRect(w / 2 - 15, h * .34, 30, 78); g.fillRect(w / 2 - 8, h * .26, 16, 24);
      txt(g, 'ISLA BRAVA', w / 2, 34, 28, '#f6e7c2', FB, { max: w * .9 }); txt(g, 'dark rum', w / 2, h - 52, 34, '#f6e7c2', FS, { wt: '400' }); txt(g, 'AGED BY THE TIDE', w / 2, h - 20, 13, '#e3b54a', FN); grime(g, w, h, 'p1', 1.2); });
    a.poster2 = A.add(192, 256, (g, w, h) => { g.fillStyle = '#e6dcc0'; g.fillRect(0, 0, w, h); g.fillStyle = '#2f7f8a'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0, 150 + i * 16); g.bezierCurveTo(50, 120 + i * 16, 110, 180 + i * 16, w, 140 + i * 16); g.lineTo(w, h); g.lineTo(0, h); g.fill(); g.fillStyle = ['#3d98a0', '#25606c', '#1a4450'][i % 3]; }
      g.fillStyle = '#e0683a'; g.beginPath(); g.arc(w * .68, 78, 34, 0, TAU); g.fill(); txt(g, 'SOUTH SHORE', w / 2, 26, 22, '#23304a', FB, { max: w * .9 }); txt(g, 'SURF CLASSIC', w / 2, 122, 24, '#23304a', FB, { max: w * .9 }); txt(g, "'94", w * .25, 80, 46, '#e0683a', FB); txt(g, 'PIER BREAK · OCT 8–9', w / 2, h - 18, 14, '#f2ead6', FN); grime(g, w, h, 'p2', 1.6); });
    a.plate1 = A.add(256, 128, (g, w, h) => sign(g, w, h, 'DRFTLN', { style: 'plate' }));
    a.plate2 = A.add(256, 128, (g, w, h) => sign(g, w, h, 'L8R G8R', { style: 'plate', color: '#7a2a1c', distress: .6 }));
    a.cash = A.add(256, 96, (g, w, h) => sign(g, w, h, 'CASH ONLY', { color: '#1d3a52', bg: '#e9dfc6', distress: .55 }));
    a.tips = A.add(128, 96, (g, w, h) => { g.fillStyle = '#efe6cc'; g.fillRect(0, 0, w, h); txt(g, 'TIPS', w / 2, 34, 38, '#20252a', FH); txt(g, '= good karma', w / 2, 72, 17, '#b03a26', FH); });
    a.surf1 = A.add(128, 512, (g, w, h) => { g.fillStyle = '#e9e2cc'; g.fillRect(0, 0, w, h); g.fillStyle = '#c9603a'; g.fillRect(w * .42, 0, w * .16, h); g.fillStyle = '#2f7f8a'; g.fillRect(w * .28, 0, w * .06, h); g.fillRect(w * .66, 0, w * .06, h); txt(g, 'DRIFT', w / 2, h * .3, 30, '#23304a', FB, { rot: -HP }); grime(g, w, h, 's1', 1.8); });
    a.surf2 = A.add(128, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#e2b94f'); gr.addColorStop(.5, '#d98058'); gr.addColorStop(1, '#3d7a84'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = '#f2ead6'; g.lineWidth = 5; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke(); g.fillStyle = '#f2ead6'; g.beginPath(); g.arc(w / 2, h * .22, 26, 0, TAU); g.fill(); txt(g, 'BAR', w / 2, h * .22, 20, '#23304a', FB); grime(g, w, h, 's2', 1.6); });
    a.juke = A.add(256, 160, (g, w, h) => { g.fillStyle = '#efe9d8'; g.fillRect(0, 0, w, h); const r = GT.rng('jk'); for (let c = 0; c < 4; c++) for (let i = 0; i < 6; i++) { const x = 8 + c * 62, y = 8 + i * 25; g.fillStyle = i % 2 ? '#f6d6cf' : '#d6ecf0'; g.fillRect(x, y, 56, 21); g.fillStyle = '#b03a26'; g.fillRect(x, y + 9, 56, 3); g.fillStyle = '#222'; g.fillRect(x + 4, y + 3, 20 + r() * 28, 2.2); g.fillRect(x + 4, y + 15, 16 + r() * 30, 2.2); } });
    // ---- pier
    a.nodive = A.add(256, 256, (g, w, h) => { g.fillStyle = '#ebe7dc'; g.fillRect(0, 0, w, h); g.strokeStyle = '#20252a'; g.lineWidth = 5; g.strokeRect(7, 7, w - 14, h - 14); g.fillStyle = '#20252a'; g.save(); g.translate(w / 2, 96); g.rotate(.75); g.fillRect(-36, -7, 60, 14); g.beginPath(); g.arc(34, 0, 10, 0, TAU); g.fill(); g.fillRect(-58, -5, 26, 10); g.restore(); g.strokeStyle = '#2f6f8a'; g.lineWidth = 4; g.beginPath(); for (let x = 50; x < 206; x += 2) g.lineTo(x, 146 + Math.sin(x * .2) * 4); g.stroke();
      g.strokeStyle = '#c2291d'; g.lineWidth = 13; g.beginPath(); g.arc(w / 2, 100, 66, 0, TAU); g.moveTo(w / 2 - 47, 53); g.lineTo(w / 2 + 47, 147); g.stroke(); txt(g, 'NO DIVING', w / 2, 196, 36, '#c2291d', FB, { max: w * .86 }); txt(g, 'SHALLOW WATER · SUBMERGED PILES', w / 2, 230, 13, '#20252a', FN, { max: w * .84 }); grime(g, w, h, 'nd', 1.5); });
    a.fishsign = A.add(384, 128, (g, w, h) => { g.fillStyle = '#1f4a78'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e9e2cc'; g.lineWidth = 4; g.strokeRect(7, 7, w - 14, h - 14); txt(g, 'FISH CLEANING STATION', w / 2, 46, 30, '#e9e2cc', FB, { max: w * .9 }); txt(g, 'RINSE THE TABLE · SCRAPS IN THE BIN, NOT ON THE DECK · THE PELICANS ARE WATCHING', w / 2, 92, 14, '#e9e2cc', FN, { max: w * .9 }); grime(g, w, h, 'fs', 1.6); });
    a.bait = A.add(256, 128, (g, w, h) => { g.fillStyle = '#eeeade'; g.fillRect(0, 0, w, h); txt(g, 'LIVE BAIT', w / 2, 48, 46, '#c2291d', FB, { max: w * .9 }); txt(g, 'SHRIMP · PINFISH · ICE   $4 A SCOOP', w / 2, 98, 15, '#20252a', FN, { max: w * .9 }); grime(g, w, h, 'bt', 1.4); });
    a.pierrules = A.add(256, 320, (g, w, h) => { g.fillStyle = '#e9e4d4'; g.fillRect(0, 0, w, h); g.fillStyle = '#17564e'; g.fillRect(0, 0, w, 62); txt(g, 'CORAL COAST', w / 2, 22, 22, '#e9e4d4', FB, { max: w * .9 }); txt(g, 'FISHING PIER', w / 2, 46, 17, '#e9e4d4', FN);
      ['OPEN DAWN TO MIDNIGHT', 'TWO RODS PER ANGLER', 'NO CAST NETS FROM THE RAIL', 'RELEASE ALL SHARKS & RAYS', 'SNOOK: 28–32 IN SLOT ONLY', 'NO BIKES · NO SKATING', 'TAKE YOUR LINE HOME'].forEach((s, i) => { g.fillStyle = '#17564e'; g.beginPath(); g.arc(24, 92 + i * 30, 4, 0, TAU); g.fill(); txt(g, s, 38, 92 + i * 30, 16, '#20252a', FN, { al: 'left', max: w - 52 }); }); grime(g, w, h, 'pr', 1.5); });
    // ---- ring
    a.ringbanner = A.add(1024, 256, (g, w, h) => { g.fillStyle = '#ddd6c4'; g.fillRect(0, 0, w, h); const r = GT.rng('rb'); g.strokeStyle = 'rgba(120,110,95,.25)'; g.lineWidth = 2; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(r() * w, 0); g.lineTo(r() * w, h); g.stroke(); }
      txt(g, 'BACKYARD BRAWL', w / 2, 84, 112, '#a3231c', FB, { max: w * .93, stroke: '#16130f', sw: 9, skew: -.12 }); txt(g, 'F E D E R A T I O N', w / 2, 170, 44, '#16130f', FH, { max: w * .8 }); txt(g, 'EVERY SAT 8 PM · B.Y.O.B. · NO CRYING', w / 2, 222, 30, '#1f4a78', FH, { max: w * .85 });
      g.fillStyle = '#a3231c'; for (let i = 0; i < 16; i++) { const x = 90 + r() * 840; g.fillRect(x, 128, 3 + r() * 4, 12 + r() * 44); } for (const x of [22, w - 22]) for (const y of [22, h - 22]) { g.fillStyle = '#8f8c82'; g.beginPath(); g.arc(x, y, 9, 0, TAU); g.fill(); g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(x, y, 4, 0, TAU); g.fill(); } grime(g, w, h, 'rbg', 1.5); });
    a.canvas = A.add(512, 512, (g, w, h) => { g.fillStyle = '#a9afae'; g.fillRect(0, 0, w, h); const r = GT.rng('cnv'); for (let i = 0; i < 4; i++) { g.strokeStyle = 'rgba(70,74,74,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, h * (i + .5) / 4 + 4); g.lineTo(w, h * (i + .5) / 4 - 4); g.stroke(); }
      g.save(); g.translate(w / 2, h / 2); g.rotate(-.05); g.globalAlpha = .5; g.strokeStyle = '#8f2620'; g.lineWidth = 16; g.beginPath(); g.arc(0, 0, 150, 0, TAU); g.stroke(); txt(g, 'B.B.F', 0, 6, 120, '#8f2620', FB, { max: 250 }); g.globalAlpha = 1; g.restore();
      for (let i = 0; i < 160; i++) { const x = r() * w, y = r() * h, s = 6 + r() * r() * 60; const gr = g.createRadialGradient(x, y, 0, x, y, s); const c = r() < .25 ? '96,52,40' : '70,62,50'; gr.addColorStop(0, 'rgba(' + c + ',' + (.1 + r() * .22) + ')'); gr.addColorStop(1, 'rgba(' + c + ',0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2); }
      for (let i = 0; i < 6; i++) { g.save(); g.translate(r() * w, r() * h); g.rotate(r() * 3); g.fillStyle = 'rgba(150,152,150,.95)'; g.fillRect(-34, -9, 68, 18); g.fillRect(-9, -30, 18, 60); g.restore(); } grime(g, w, h, 'cnvg', 1.3); });
    a.apron = A.add(512, 96, (g, w, h) => { g.fillStyle = '#17181a'; g.fillRect(0, 0, w, h); txt(g, 'B.B.F.  ★  NO REFUNDS  ★  B.B.F.', w / 2, h / 2, 46, '#c9c2ac', FB, { max: w * .92 }); grime(g, w, h, 'apr', 1.8); const r = GT.rng('apr2'); for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(150,130,100,' + (.08 + r() * .2) + ')'; g.fillRect(r() * w, h * .6 + r() * h * .4, 20 + r() * 60, 3 + r() * 10); } });
    a.card = A.add(256, 192, (g, w, h) => { g.fillStyle = '#a98558'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(80,58,34,.25)'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1.5); txt(g, 'RINGSIDE $5', w / 2, 44, 38, '#141210', FH, { max: w * .9, rot: -.03 }); txt(g, 'LAWN CHAIR $3', w / 2, 96, 32, '#141210', FH, { max: w * .9, rot: .02 }); txt(g, 'KIDS FREE', w / 2, 146, 34, '#8f2620', FH, { rot: -.02 }); grime(g, w, h, 'cd', 1.2); });
    // ---- corner
    a.vend = A.add(384, 640, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0d5b70'); gr.addColorStop(.55, '#1397a8'); gr.addColorStop(1, '#0a3d55'); g.fillStyle = gr; g.fillRect(0, 0, w, h); const r = GT.rng('vend');
      g.fillStyle = 'rgba(210,244,246,.2)'; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(0, 250 + i * 60); g.bezierCurveTo(70, 190 + i * 60, 150, 320 + i * 60, 290, 230 + i * 60); g.lineTo(290, h); g.lineTo(0, h); g.fill(); }
      for (let i = 0; i < 46; i++) { g.fillStyle = 'rgba(230,250,250,' + (.15 + r() * .4) + ')'; g.beginPath(); g.arc(r() * 284, 150 + r() * 480, 2 + r() * 8, 0, TAU); g.fill(); }
      g.save(); g.translate(150, 400); g.rotate(-.2); g.fillStyle = '#e8f3f1'; rr(g, -52, -150, 104, 300, 22); g.fill(); g.fillStyle = '#f08a2c'; g.fillRect(-52, -70, 104, 120); txt(g, 'TIDAL', 0, -16, 34, '#fff', FB, { max: 96, skew: -.2 }); g.fillStyle = '#9aa7a8'; rr(g, -40, -164, 80, 20, 6); g.fill(); g.restore();
      txt(g, 'TIDAL', 146, 76, 96, '#fff', FB, { max: 262, skew: -.2, stroke: '#f08a2c', sw: 10 }); txt(g, 'CITRUS SODA', 146, 138, 26, '#ffe9a8', FN); txt(g, 'ICE COLD', 146, h - 34, 40, '#fff', FB, { max: 250 });
      g.fillStyle = '#10161a'; g.fillRect(292, 0, 92, h); ['#f08a2c', '#e8d23c', '#d8433a', '#4fb85a', '#6a4fb8', '#e8f3f1'].forEach((c, i) => { const y = 40 + i * 62; g.fillStyle = '#2a343a'; rr(g, 302, y, 72, 50, 6); g.fill(); g.fillStyle = c; rr(g, 308, y + 6, 36, 38, 5); g.fill(); g.fillStyle = '#39d86a'; g.beginPath(); g.arc(360, y + 25, 5, 0, TAU); g.fill(); });
      txt(g, '$1.50', 338, 440, 22, '#ffb02a', FN); grime(g, w, h, 'vg', .7); });
    a.snackhead = A.add(384, 96, (g, w, h) => { g.fillStyle = '#b8352a'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2c23c'; g.beginPath(); g.ellipse(w / 2, h / 2, w * .44, h * .4, 0, 0, TAU); g.fill(); txt(g, 'MUNCH BOX', w / 2, h * .46, 42, '#5a1712', FB, { max: w * .76, skew: -.1 }); txt(g, 'SNACKS · CANDY · CHIPS', w / 2, h * .8, 13, '#5a1712', FN); grime(g, w, h, 'sh', .6); });
    a.snackside = A.add(128, 384, (g, w, h) => { g.fillStyle = '#b8352a'; g.fillRect(0, 0, w, h); for (let i = 0; i < 7; i++) { g.fillStyle = i % 2 ? '#f2c23c' : '#e9e2cc'; g.beginPath(); g.arc(w / 2 + Math.sin(i * 2.1) * 26, 40 + i * 50, 22, 0, TAU); g.fill(); } txt(g, 'MUNCH', w / 2, h * .5, 30, '#5a1712', FB, { rot: -HP, max: h * .8 }); grime(g, w, h, 'ss', 1.4); });
    a.clawhead = A.add(320, 96, (g, w, h) => { g.fillStyle = '#5a2f8a'; g.fillRect(0, 0, w, h); const r = GT.rng('ch'); for (let i = 0; i < 16; i++) { g.fillStyle = '#f2c23c'; const x = r() * w, y = r() * h, s = 3 + r() * 5; g.beginPath(); for (let k = 0; k < 10; k++) { const a_ = k * PI / 5, q = k % 2 ? s * .45 : s; g.lineTo(x + Math.sin(a_) * q, y - Math.cos(a_) * q); } g.fill(); } txt(g, 'LUCKY GRAB', w / 2, h * .5, 44, '#fff3c4', FB, { max: w * .88, stroke: '#d8433a', sw: 7, skew: -.12 }); });
    a.clawbase = A.add(320, 224, (g, w, h) => { g.fillStyle = '#e2b42e'; g.fillRect(0, 0, w, h); g.fillStyle = '#5a2f8a'; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * .55); g.bezierCurveTo(w * .3, h * .3, w * .7, h * .8, w, h * .45); g.lineTo(w, h); g.fill(); txt(g, 'WIN A PRIZE!', w / 2, 46, 40, '#5a2f8a', FB, { max: w * .88 }); txt(g, '2 PLAYS $1', w / 2, 160, 40, '#fff3c4', FB, { max: w * .8 }); txt(g, 'SKILL CRANE · NO REFUNDS · PRIZES MAY SHIFT', w / 2, h - 16, 11, '#fff3c4', FN); grime(g, w, h, 'cb', 1.5); });
    a.phone = A.add(192, 320, (g, w, h) => { g.fillStyle = '#d5d8d6'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f4a78'; g.fillRect(0, 0, w, 64); txt(g, 'CORAL BELL', w / 2, 24, 24, '#fff', FB, { max: w * .88 }); txt(g, 'PUBLIC TELEPHONE', w / 2, 48, 13, '#cfe0f0', FN); for (let i = 0; i < 12; i++) { const x = 44 + (i % 3) * 38, y = 96 + ((i / 3) | 0) * 34; g.fillStyle = '#8f9496'; rr(g, x, y, 28, 24, 4); g.fill(); g.fillStyle = '#e8eaea'; rr(g, x + 1, y + 1, 26, 20, 4); g.fill(); txt(g, '123456789*0#'[i], x + 14, y + 11, 14, '#20252a', FN); }
      g.fillStyle = '#20252a'; g.fillRect(34, 246, 124, 46); txt(g, 'LOCAL CALLS 50¢', w / 2, 262, 13, '#e8eaea', FN); txt(g, 'EMERGENCY — NO COIN', w / 2, 280, 11, '#f0a03a', FN); grime(g, w, h, 'ph', 1.6); });
    a.notice = A.add(768, 512, (g, w, h) => { g.fillStyle = '#9a7648'; g.fillRect(0, 0, w, h); const r = GT.rng('nb'); for (let i = 0; i < 5200; i++) { g.fillStyle = r() < .5 ? 'rgba(60,40,20,.28)' : 'rgba(220,180,130,.22)'; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2); }
      const F = (x, y, fw, fh, bg, pin, d) => flyer(g, x, y, fw, fh, (r() - .5) * .13, bg, pin, d);
      F(22, 26, 170, 220, '#f1ecdc', '#c2291d', (g, w, h) => { txt(g, 'LOST', w / 2, 34, 40, '#c2291d', FB); g.fillStyle = '#5a8a3a'; g.beginPath(); g.ellipse(w / 2, 100, 30, 40, 0, 0, TAU); g.fill(); g.fillStyle = '#e8b02a'; g.beginPath(); g.moveTo(w / 2 + 22, 84); g.lineTo(w / 2 + 44, 94); g.lineTo(w / 2 + 22, 100); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(w / 2 + 10, 82, 4, 0, TAU); g.fill(); txt(g, 'PARROT', w / 2, 158, 24, '#20252a', FB); txt(g, 'answers to "MANGO"', w / 2, 180, 12, '#20252a', FN); txt(g, 'swears in 2 languages', w / 2, 194, 11, '#20252a', FN); tabs(g, w, h, 8); });
      F(206, 20, 150, 150, '#f3d94a', '#1f4a78', (g, w, h) => { txt(g, 'DUSK LEAGUE', w / 2, 30, 20, '#20252a', FB, { max: w * .9 }); txt(g, '3 ON 3', w / 2, 68, 40, '#b03a26', FB); txt(g, 'beach court · sign up', w / 2, 104, 12, '#20252a', FN); txt(g, 'WINNER STAYS', w / 2, 128, 15, '#20252a', FB); });
      F(372, 30, 180, 130, '#e8e3d2', '#3a8a4a', (g, w, h) => { txt(g, 'BACKYARD BRAWL FED.', w / 2, 26, 15, '#a3231c', FB, { max: w * .92 }); txt(g, 'SAT 8PM', w / 2, 62, 34, '#16130f', FB); txt(g, 'lot D — behind the teal trailer', w / 2, 94, 11, '#20252a', FN); txt(g, 'bring a chair', w / 2, 112, 13, '#20252a', FH); });
      F(566, 22, 180, 236, '#dfe9ee', '#c2291d', (g, w, h) => { txt(g, 'PIER FISHING', w / 2, 30, 20, '#17564e', FB, { max: w * .9 }); txt(g, 'TOURNAMENT', w / 2, 54, 20, '#17564e', FB, { max: w * .9 }); g.fillStyle = '#17564e'; g.beginPath(); g.ellipse(w / 2 - 8, 110, 52, 20, 0, 0, TAU); g.fill(); g.beginPath(); g.moveTo(w / 2 + 38, 110); g.lineTo(w / 2 + 70, 90); g.lineTo(w / 2 + 70, 130); g.fill(); txt(g, 'biggest snook wins $200', w / 2, 156, 13, '#20252a', FN); lines(g, w, 176, 11, 4, 'rgba(30,40,50,.6)'); });
      F(212, 190, 140, 180, '#f4f1e8', '#e8b02a', (g, w, h) => { txt(g, 'ROOM', w / 2, 30, 30, '#20252a', FB); txt(g, 'FOR RENT', w / 2, 60, 20, '#20252a', FB); txt(g, '$650 / mo', w / 2, 92, 20, '#b03a26', FH); lines(g, w, 112, 10, 3, 'rgba(30,40,50,.6)'); tabs(g, w, h, 7); });
      F(366, 178, 184, 120, '#f6c8b8', '#1f4a78', (g, w, h) => { txt(g, 'BEACH CLEAN-UP', w / 2, 28, 19, '#20252a', FB, { max: w * .9 }); txt(g, 'SAT 8 AM · LIFEGUARD TOWER 7', w / 2, 54, 12, '#20252a', FN); txt(g, 'free tacos after', w / 2, 86, 20, '#17564e', FH); });
      F(30, 268, 164, 216, '#e9efe4', '#3a8a4a', (g, w, h) => { txt(g, 'GUITAR', w / 2, 30, 28, '#20252a', FB); txt(g, 'LESSONS', w / 2, 58, 22, '#20252a', FB); txt(g, 'surf · bolero · sad songs', w / 2, 84, 12, '#20252a', FN); g.strokeStyle = '#7a4a22'; g.lineWidth = 6; g.beginPath(); g.moveTo(w / 2, 100); g.lineTo(w / 2, 150); g.stroke(); g.fillStyle = '#b87838'; g.beginPath(); g.ellipse(w / 2, 158, 22, 26, 0, 0, TAU); g.fill(); tabs(g, w, h, 8); });
      F(372, 312, 170, 176, '#ffffff', '#c2291d', (g, w, h) => { txt(g, 'YARD SALE', w / 2, 30, 26, '#c2291d', FB, { max: w * .9 }); txt(g, 'everything must go', w / 2, 58, 15, '#20252a', FH); txt(g, 'weights · VCR · jet ski (no engine)', w / 2, 84, 10, '#20252a', FN, { max: w * .9 }); txt(g, 'UNIT 14', w / 2, 122, 28, '#20252a', FB); });
      F(560, 276, 186, 210, '#20252a', '#e8b02a', (g, w, h) => { txt(g, 'THE DRIFT LINE', w / 2, 34, 20, '#ff6fae', FB, { max: w * .9 }); txt(g, 'tiki bar', w / 2, 66, 30, '#9fd6c8', FS, { wt: '400' }); txt(g, 'LIVE: Los Naufragos', w / 2, 108, 14, '#f2ead6', FN); txt(g, 'FRI · SUNSET', w / 2, 134, 20, '#e8b04a', FB); txt(g, 'on the sand by tower 7', w / 2, 178, 11, '#f2ead6', FN); });
      F(214, 384, 140, 104, '#cfe3f2', '#3a8a4a', (g, w, h) => { txt(g, 'DOG WALKER', w / 2, 26, 17, '#20252a', FB, { max: w * .9 }); txt(g, 'cheap · honest', w / 2, 52, 14, '#20252a', FH); tabs(g, w, h, 6); }); grime(g, w, h, 'nbg', .8); });
    // ---- cutouts
    a.frond = A.add(512, 128, (g, w, h) => { g.clearRect(0, 0, w, h); const r = GT.rng('frond'); g.lineCap = 'round'; for (let i = 0; i < 64; i++) { const t = i / 63, x = 14 + t * (w - 40), len = h * .5 * (.35 + .65 * Math.sin(Math.min(1, t * 1.35 + .12) * PI)) * (.85 + r() * .25), lean = 10 + t * 22;
        for (const s of [-1, 1]) { const dry = r() < .12; g.strokeStyle = dry ? 'rgb(' + (128 + r() * 30 | 0) + ',' + (110 + r() * 20 | 0) + ',58)' : 'rgb(' + (52 + r() * 26 | 0) + ',' + (84 + r() * 30 | 0) + ',' + (34 + r() * 14 | 0) + ')'; g.lineWidth = 3.2 + r() * 2.2; g.beginPath(); g.moveTo(x, h / 2); g.quadraticCurveTo(x + lean * .5, h / 2 + s * len * .6, x + lean + r() * 6, h / 2 + s * len); g.stroke(); } }
      g.strokeStyle = '#6f7a3c'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w - 22, h / 2); g.stroke(); });
    a.fringe = A.add(256, 96, (g, w, h) => { g.clearRect(0, 0, w, h); const r = GT.rng('fringe'); g.lineCap = 'round'; for (let i = 0; i < 150; i++) { const x = r() * w, l = h * (.45 + r() * .55); const k = .72 + r() * .5; g.strokeStyle = 'rgb(' + (168 * k | 0) + ',' + (138 * k | 0) + ',' + (82 * k | 0) + ')'; g.lineWidth = 2 + r() * 3; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - .5) * 10, l); g.stroke(); } g.fillStyle = '#8f7646'; g.fillRect(0, 0, w, 12); });
    A.pack(128);
    // ---- glow atlas
    a.neonName = AG.add(768, 192, (g, w, h) => sign(g, w, h, 'The Drift Line', { style: 'neon', color: '#ff4f9e', font: FS }));
    a.neonTiki = AG.add(384, 128, (g, w, h) => sign(g, w, h, 'TIKI BAR', { style: 'neon', color: '#3fe0f0' }));
    a.neonOpen = AG.add(256, 128, (g, w, h) => sign(g, w, h, 'OPEN', { style: 'neon', color: '#ffb02a' }));
    a.lcd = AG.add(128, 48, (g, w, h) => sign(g, w, h, '1.50', { style: 'lcd', color: '#ffb02a' }));
    a.tv = AG.add(256, 160, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#12406a'); gr.addColorStop(1, '#1d86a4'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.5)'; for (let i = 0; i < 3; i++) { g.beginPath(); for (let x = 0; x <= w; x += 4) g.lineTo(x, 84 + i * 16 + Math.sin(x * .06 + i * 2) * 6); g.lineTo(w, h); g.lineTo(0, h); g.fill(); g.fillStyle = 'rgba(20,90,130,.6)'; }
      g.fillStyle = '#c2291d'; g.fillRect(0, 0, 92, 26); txt(g, 'COAST 7', 46, 14, 16, '#fff', FB); txt(g, 'SURF REPORT', w * .66, 16, 15, '#fff', FN); txt(g, '2–3 FT', 76, 58, 34, '#fff', FB); txt(g, 'WATER 81°', w * .72, 58, 20, '#ffe9a8', FN); g.fillStyle = '#0c1c2c'; g.fillRect(0, h - 24, w, 24); txt(g, 'RIP CURRENT ADVISORY SOUTH OF THE PIER · HIGH TIDE 9:42 PM', w / 2, h - 12, 11, '#ffe9a8', FN, { max: w * .96 });
      g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1); });
    a.jukeglow = AG.add(256, 320, (g, w, h) => { g.fillStyle = '#060404'; g.fillRect(0, 0, w, h); g.lineCap = 'butt'; [['#ff8a1c', 118, 22], ['#ff3f8a', 96, 14], ['#ffd23c', 80, 10], ['#3fe0f0', 66, 8]].forEach(d => { g.strokeStyle = d[0]; g.lineWidth = d[2]; g.shadowColor = d[0]; g.shadowBlur = 14; g.beginPath(); g.moveTo(w / 2 - d[1], h); g.lineTo(w / 2 - d[1], 140); g.arc(w / 2, 140, d[1], PI, 0); g.lineTo(w / 2 + d[1], h); g.stroke(); }); g.shadowBlur = 0;
      g.fillStyle = '#fff1d0'; g.fillRect(w / 2 - 50, 150, 100, 60); g.fillStyle = '#2a1408'; for (let i = 0; i < 5; i++) g.fillRect(w / 2 - 44, 157 + i * 11, 88, 2); g.fillStyle = '#1a0d06'; g.fillRect(w / 2 - 52, 224, 104, 96); g.strokeStyle = '#c98a2c'; g.lineWidth = 3; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(w / 2 - 50 + i * 12.5, 226); g.lineTo(w / 2 - 50 + i * 12.5, h); g.stroke(); } });
    a.pool = AG.add(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.5)'); gr.addColorStop(.7, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    a.lantern = AG.add(128, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#7a3a10'); gr.addColorStop(.5, '#ffb65a'); gr.addColorStop(1, '#8a4212'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(60,20,0,.35)'; for (let y = 2; y < h; y += 6) g.fillRect(0, y, w, 1.5); });
    a.lanternR = AG.add(128, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5a1210'); gr.addColorStop(.5, '#ff5a4a'); gr.addColorStop(1, '#6a1612'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(50,0,0,.35)'; for (let y = 2; y < h; y += 6) g.fillRect(0, y, w, 1.5); });
    a.lanternC = AG.add(128, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0e4a4a'); gr.addColorStop(.5, '#6ae8d8'); gr.addColorStop(1, '#125252'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,40,40,.35)'; for (let y = 2; y < h; y += 6) g.fillRect(0, y, w, 1.5); });
    AG.pack(0); ART = a; return a;
  }
  /** the whole half-court paint job as one transparent overlay (13.6 × 15 m): faded colour fields, lines, roundel, wear, sealed cracks, sand dust */
  function courtTex(W, D) { const S_ = 2048, c = cv(S_, S_), g = c.getContext('2d'), r = GT.rng('courtpaint'), sx = S_ / W, sy = S_ / D; g.scale(sx, sy);
    const hx = W / 2, hy = 2.48, base = .9, ft = base + 5.8, cor = 5.9, arcR = 6.75, a0 = Math.acos(cor / arcR);
    const arcPath = () => { g.beginPath(); g.moveTo(hx - cor, base); g.lineTo(hx - cor, hy + arcR * Math.sin(a0)); g.arc(hx, hy, arcR, PI - a0, a0, true); g.lineTo(hx + cor, base); };
    g.fillStyle = 'rgba(58,92,96,.5)'; g.fillRect(.3, base, W - .6, D - base - .6);                       // old sea-green court coat
    arcPath(); g.closePath(); g.fillStyle = 'rgba(70,96,118,.62)'; g.fill();                               // inside the arc: slate blue
    g.fillStyle = 'rgba(168,84,58,.7)'; g.fillRect(hx - 2.45, base, 4.9, 5.8);                            // key: faded coral
    g.beginPath(); g.arc(hx, ft, 1.8, 0, TAU); g.fillStyle = 'rgba(168,84,58,.55)'; g.fill();
    // roundel
    const ry_ = 11.3; g.save(); g.translate(hx, ry_); g.beginPath(); g.arc(0, 0, 1.95, 0, TAU); g.fillStyle = 'rgba(226,214,180,.82)'; g.fill(); g.beginPath(); g.arc(0, 0, 1.38, 0, TAU); g.fillStyle = 'rgba(35,48,74,.85)'; g.fill();
    g.save(); g.beginPath(); g.arc(0, 0, 1.38, 0, TAU); g.clip(); g.fillStyle = 'rgba(224,128,62,.9)'; g.beginPath(); g.arc(0, .2, .72, PI, 0); g.fill(); g.strokeStyle = 'rgba(226,214,180,.9)'; g.lineWidth = .09; for (let i = 0; i < 3; i++) { g.beginPath(); for (let x = -1.5; x <= 1.5; x += .05) g.lineTo(x, .42 + i * .26 + Math.sin(x * 5 + i * 1.7) * .07); g.stroke(); }
    g.fillStyle = 'rgba(224,128,62,.9)'; for (let i = 0; i < 9; i++) { g.save(); g.rotate(PI + (i + .5) * PI / 9 - HP); g.fillRect(.84, -.035, .3, .07); g.restore(); } g.restore();
    const ring = 'DUSK LEAGUE · SOUTH SHORE · EST. 1989 · '; g.fillStyle = 'rgba(35,48,74,.9)'; g.font = '900 36px ' + FB; g.textAlign = 'center'; g.textBaseline = 'middle'; for (let i = 0; i < ring.length; i++) { g.save(); g.rotate(i / ring.length * TAU); g.scale(.01, .01); g.fillText(ring[i], 0, -166); g.restore(); } g.restore();
    // lines
    g.strokeStyle = 'rgba(232,228,214,.93)'; g.lineWidth = .055; g.lineCap = 'butt'; g.strokeRect(.3, base, W - .6, D - base - .6); g.strokeRect(hx - 2.45, base, 4.9, 5.8); arcPath(); g.stroke();
    g.beginPath(); g.arc(hx, ft, 1.8, 0, PI); g.stroke(); g.setLineDash([.35, .35]); g.beginPath(); g.arc(hx, ft, 1.8, PI, TAU); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.arc(hx, hy, 1.25, 0, PI); g.stroke(); g.beginPath(); g.arc(hx, D - .6, 1.8, PI, TAU); g.stroke();
    for (const s of [-1, 1]) for (const d of [1.75, 2.6, 3.45, 4.3]) { g.beginPath(); g.moveTo(hx + s * 2.45, base + d); g.lineTo(hx + s * 2.7, base + d); g.stroke(); }
    g.fillStyle = 'rgba(232,228,214,.6)'; g.font = '900 50px ' + FB; g.textAlign = 'center'; g.save(); g.translate(hx, D - 1.25); g.scale(.01, .01); g.fillText('WINNER STAYS', 0, 0); g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
    // wear: paint flaked off down to the asphalt (heaviest in the key, on the arc top and where feet pivot)
    g.globalCompositeOperation = 'destination-out'; const P2 = (x, y) => [x * sx, y * sy];
    for (let i = 0; i < 5200; i++) { let x = r() * W, y = r() * D; if (r() < .45) { const a = r() * TAU, d = r() * r() * 4.4; x = hx + Math.cos(a) * d; y = 3.4 + Math.sin(a) * d * 1.3; } const p = P2(x, y), s = 2 + r() * r() * 26; g.globalAlpha = .25 + r() * .6; g.beginPath(); g.ellipse(p[0], p[1], s, s * (.3 + r() * .7), r() * 3, 0, TAU); g.fill(); }
    for (let i = 0; i < 260; i++) { let x = r() * W, y = r() * D; if (r() < .5) { x = hx + (r() - .5) * 7; y = 1.2 + r() * 8; } const p = P2(x, y), s = 30 + r() * 150, gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], s); g.globalAlpha = 1; gr.addColorStop(0, 'rgba(0,0,0,' + (.12 + r() * .3) + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(p[0] - s, p[1] - s, s * 2, s * 2); } g.fillStyle = '#000';
    g.lineCap = 'round'; for (let i = 0; i < 26; i++) { let x = r() * W, y = r() * D, a = r() * TAU; g.globalAlpha = .85; g.lineWidth = 2 + r() * 5; g.beginPath(); g.moveTo(x * sx, y * sy); for (let k = 0; k < 30; k++) { a += (r() - .5) * .9; x += Math.cos(a) * .22; y += Math.sin(a) * .22; g.lineTo(x * sx, y * sy); } g.stroke(); }
    g.globalAlpha = .05; for (let i = 0; i < 900; i++) { g.fillRect(r() * S_, r() * S_, 40 + r() * 200, 2 + r() * 5); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    // tar-sealed cracks, scuffs, sand dust creeping in from the edges
    for (let i = 0; i < 9; i++) { let x = r() * W, y = r() * D, a = r() * TAU; g.strokeStyle = 'rgba(14,14,15,.82)'; g.lineWidth = 5 + r() * 5; g.beginPath(); g.moveTo(x * sx, y * sy); for (let k = 0; k < 22; k++) { a += (r() - .5) * 1.1; x += Math.cos(a) * .3; y += Math.sin(a) * .3; g.lineTo(x * sx, y * sy); } g.stroke(); }
    for (let i = 0; i < 70; i++) { const p = P2(hx + (r() - .5) * 9, 1 + r() * 8), a = r() * TAU, l = 20 + r() * 90; g.strokeStyle = 'rgba(12,12,12,' + (.12 + r() * .25) + ')'; g.lineWidth = 2 + r() * 4; g.beginPath(); g.moveTo(p[0], p[1]); g.quadraticCurveTo(p[0] + Math.cos(a) * l * .5 + (r() - .5) * 30, p[1] + Math.sin(a) * l * .5 + (r() - .5) * 30, p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l); g.stroke(); }
    for (let i = 0; i < 520; i++) { const e = r() * r() * 2.6, side = (r() * 4) | 0, t = r(), x = side === 0 ? e : side === 1 ? W - e : t * W, y = side === 2 ? e : side === 3 ? D - e : t * D, p = P2(x, y), s = 18 + r() * 80, gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], s); gr.addColorStop(0, 'rgba(206,188,146,' + (.18 + r() * .3) + ')'); gr.addColorStop(1, 'rgba(206,188,146,0)'); g.fillStyle = gr; g.fillRect(p[0] - s, p[1] - s, s * 2, s * 2); }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; }
  function linkTex() { const s = 128, c = cv(s, s), g = c.getContext('2d'); g.lineWidth = 7; g.lineCap = 'square'; for (const [col, o] of [['rgb(58,60,60)', 1.6], ['rgb(170,174,172)', 0]]) { g.strokeStyle = col; for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(k * s + o, o); g.lineTo(k * s + s + o, s + o); g.moveTo(k * s + s + o, o); g.lineTo(k * s + o, s + o); g.stroke(); } }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; t.wrapS = t.wrapT = T.RepeatWrapping; return t; }

  function makeMats() {
    M = {}; const at = A.tex, ag = AG.tex;
    M.lit = new T.MeshStandardMaterial({ map: at, roughness: .72, metalness: 0 }); M.lit.name = 'hang_lit';
    M.litM = new T.MeshStandardMaterial({ map: at, roughness: .34, metalness: .92 }); M.litM.name = 'hang_litMetal';
    M.self = new T.MeshStandardMaterial({ map: at, roughness: .45, metalness: 0, emissiveMap: at, emissive: new T.Color(1, 1, 1), emissiveIntensity: .12 }); M.self.name = 'hang_selfLit'; GT.glow(M.self, WHITE, .1, 1.35, 'emissiveIntensity');
    M.cut = new T.MeshStandardMaterial({ map: at, roughness: .8, metalness: 0, alphaTest: .42, side: T.DoubleSide }); M.cut.name = 'hang_cutout';
    M.glow = new T.MeshBasicMaterial({ map: ag }); M.glow.name = 'hang_glow'; GT.glow(M.glow, WHITE, .95, 3.0);
    M.spill = new T.MeshBasicMaterial({ map: ag, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); M.spill.name = 'hang_spill'; GT.glow(M.spill, new T.Color(1, .8, .56), 0, .3);
    M.court = new T.MeshStandardMaterial({ map: courtTex(13.6, 15), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, roughness: .86, metalness: 0 }); M.court.name = 'hang_courtpaint';
    M.link = new T.MeshStandardMaterial({ map: linkTex(), transparent: true, side: T.DoubleSide, roughness: .45, metalness: .7, depthWrite: false, alphaTest: .02 }); M.link.name = 'hang_chainlink';
    M.bulb = new T.MeshBasicMaterial({ color: 0xffffff }); M.bulb.name = 'hang_bulbs'; GT.glow(M.bulb, WHITE, .75, 5.5);
    M.bottle = new T.MeshStandardMaterial({ color: 0xffffff, roughness: .12, metalness: 0, emissive: new T.Color(1, 1, 1), emissiveIntensity: 0 }); M.bottle.name = 'hang_bottles';
    M.bottle.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive;\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor;\n#endif'); };
    GT.glow(M.bottle, WHITE, .02, .55, 'emissiveIntensity');
    M.wood = mt('wood_plank', { color: 0x917a5c }); M.thatch = mt('wood_plank', { color: 0xb59c64, rough: 1 }); M.rub = mt('rubber', { color: 0x2b2a2a }); M.rubRed = mt('rubber', { color: 0x4a332d });
  }

  /* ================================================================== shared props */
  function linkFence(x0, z0, x1, z1, h, y0, o) { o = o || {}; const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / (o.span || 2.4))), dx = (x1 - x0) / len, dz = (z1 - z0) / len, pm = o.post || 'metal_galv';
    for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / n), z = lerp(z0, z1, i / n); C(pm, .03, .03, h + .3, x, y0 + h / 2 - .1, z, { seg: 8 }); C(pm, .037, .037, .03, x, y0 + h + .06, z, { seg: 8 }); }
    rod(pm, [x0, y0 + h, z0], [x1, y0 + h, z1], .021, 6); rod(pm, [x0, y0 + .09, z0], [x1, y0 + .09, z1], .006, 4); if (h > 2.5) rod(pm, [x0, y0 + h * .5, z0], [x1, y0 + h * .5, z1], .018, 6);
    const g = new T.PlaneGeometry(len, h - .08), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / .085, uv.getY(i) * (h - .08) / .085);
    KG.geo(M.link, g, { x: (x0 + x1) / 2, y: y0 + .04 + h / 2, z: (z0 + z1) / 2, ry: Math.atan2(-dz, dx) });
    if (o.collide !== false) box(Math.min(x0, x1) - .06, Math.min(z0, z1) - .06, Math.max(x0, x1) + .06, Math.max(z0, z1) + .06, h, o.tag || 'fence'); }
  function frondGeo(top, az, th0, droop, L, Wd, rect) { const NS = 7, ox = Math.cos(az), oz = Math.sin(az), sxv = -oz, szv = ox, pos = [], uv = [], idx = []; let px = top[0] + ox * .12, py = top[1], pz = top[2] + oz * .12, th = th0;
    for (let i = 0; i <= NS; i++) { const t = i / NS, w = Wd * .5, vy = .2 * w;
      pos.push(px - sxv * w, py + vy, pz - szv * w, px, py, pz, px + sxv * w, py + vy, pz + szv * w); const u = lerp(rect.u0, rect.u1, t); uv.push(u, rect.v0, u, (rect.v0 + rect.v1) / 2, u, rect.v1);
      if (i < NS) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
      const seg = L / NS; px += ox * Math.cos(th) * seg; pz += oz * Math.cos(th) * seg; py += Math.sin(th) * seg; th -= droop / NS * (.6 + t * 1.2); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; }
  /** coconut palm, leaning towards `lean` (radians, 0 = +X). Returns the crown position. */
  function palm(x, z, Hh, lean, seed, bendK) { const r = GT.rng(seed), y0 = gy(x, z) - .25, lx = Math.cos(lean), lz = Math.sin(lean), bend = Hh * (bendK === undefined ? .2 : bendK), pts = [], NSEG = 8;
    for (let i = 0; i <= NSEG; i++) { const t = i / NSEG; pts.push([x + lx * bend * t * t, y0 + Hh * t, z + lz * bend * t * t]); }
    for (let i = 0; i < NSEG; i++) rod('palm_trunk', pts[i], pts[i + 1], lerp(.2, .12, i / NSEG), 10, lerp(.2, .12, (i + 1) / NSEG));
    C('palm_trunk', .205, .33, .5, x, y0 + .22, z, { seg: 10 }); const top = pts[NSEG]; K.sphere('palm_trunk', .19, top[0], top[1] + .02, top[2], { seg: 8, seg2: 6, s: [1, 1.4, 1] });
    for (let i = 0; i < 20; i++) { const tier = i % 3, az = i * 2.399 + r() * .4; KG.geo(M.cut, frondGeo([top[0], top[1] + .12, top[2]], az, [1.0, .5, -.1][tier] + (r() - .5) * .3, [1.5, 1.7, 1.2][tier] + r() * .4, 2.6 + r() * .9, .9 + r() * .3, ART.frond)); }
    for (let i = 0; i < 4; i++) { const a = r() * TAU; ss(0x4a3a22, .075, top[0] + Math.cos(a) * .2, top[1] - .14, top[2] + Math.sin(a) * .2, { seg: 8, seg2: 6 }); }
    post(x, z, .26, Hh, 'palm'); return top; }
  function duffel(hex, x, y, z, len, r, ry, strap) { P(x, y, z, { ry }); sc(hex, r, r, len, 0, r * .78, 0, { rz: HP, s: [.78, 1, 1], seg: 14 }); for (const s of [-1, 1]) { ss(hex, r, s * len / 2, r * .78, 0, { s: [.4, .78, 1], seg: 12, seg2: 8 }); sb(strap || 0x1a1a1c, .035, r * 1.6, r * 2.04, s * len * .24, r * .78, 0, { bevel: .008 }); }
    stube(strap || 0x1a1a1c, [[-len * .24, r * 1.5, 0], [-len * .12, r * 1.95, .03], [len * .12, r * 1.95, .03], [len * .24, r * 1.5, 0]], .012, { seg: 5 }); sb(0xb8bcc0, len * .7, .008, .012, 0, r * 1.565, 0, { metal: true }); Q(); }
  const sportBottle = (hex, x, y, z, lie) => { if (lie) { sc(hex, .034, .034, .19, x, y + .034, z, { rz: HP, ry: lie, seg: 10 }); return; } sc(hex, .034, .032, .19, x, y + .095, z, { seg: 10 }); sc(0x1c1c1e, .022, .03, .04, x, y + .21, z, { seg: 8 }); };
  const ballGeo = r => remap(new T.SphereGeometry(r, 18, 12), ART.ball);
  const ball = (x, y, z, rx, ry) => KG.geo(M.lit, ballGeo(.12), { x, y, z, rx, ry });
  function bucket(hex, x, y, z, r, h) { sc(hex, r, r * .8, h, x, y + h / 2, z, { seg: 14, open: true }); sc(hex, r * .8, r * .8, .012, x, y + .006, z, { seg: 14 }); sc(hex, r * 1.04, r * 1.04, .016, x, y + h - .008, z, { seg: 14, open: true }); stube(0x8a8d8c, [[x - r, y + h - .02, z], [x - r * .8, y + h * .55, z + r * .7], [x, y + h * .42, z + r * .95], [x + r * .8, y + h * .55, z + r * .7], [x + r, y + h - .02, z]], .004, { seg: 4, metal: true }); }
  function boombox(x, y, z, ry) { P(x, y, z, { ry }); sb(0x2a2c30, .52, .26, .15, 0, .13, 0, { bevel: .02 }); for (const s of [-1, 1]) { sc(0x0e0f10, .085, .085, .02, s * .155, .115, .07, { rx: HP, seg: 16 }); stor(0xb8bcc0, .085, .008, s * .155, .115, .081, { metal: true, seg: 6, seg2: 18 }); sc(0x55585c, .03, .03, .012, s * .155, .115, .084, { rx: HP, seg: 10 }); sc(0xb8bcc0, .014, .014, .02, s * .2, .268, 0, { seg: 8, metal: true }); }
    sb(0x15171a, .13, .085, .012, 0, .13, .076, { bevel: .003 }); sb(0xa9adb0, .5, .03, .012, 0, .232, .072, { metal: true }); for (let i = 0; i < 5; i++) sb(0x1a1a1c, .025, .012, .02, -.06 + i * .03, .264, .04); stube(0x1a1a1c, [[-.22, .25, 0], [-.22, .34, 0], [.22, .34, 0], [.22, .25, 0]], .011, { seg: 5, steps: 12 }); srod(0xc4c8cc, [.2, .26, -.05], [.44, .64, -.1], .004, 5, { metal: true }); Q(); }
  /** bar + plates into kit k (axis along local X). plates = [[radius, thickness], ...] from the collar outwards */
  function barbellInto(k, plates, plateMat) { k.cyl('chrome', .0145, .0145, 1.32, 0, 0, 0, { rz: HP, seg: 10 });
    for (const s of [-1, 1]) { k.cyl('chrome', .025, .025, .41, s * .875, 0, 0, { rz: HP, seg: 12 }); k.cyl('chrome', .042, .042, .03, s * .665, 0, 0, { rz: HP, seg: 12 }); let x = .684;
      for (const [rad, th] of plates) { k.cyl(plateMat, rad, rad, th, s * (x + th / 2), 0, 0, { rz: HP, seg: 24 }); k.cyl(plateMat, rad * .97, rad * .97, th + .012, s * (x + th / 2), 0, 0, { rz: HP, seg: 24, open: true }); k.cyl('chrome', .05, .05, th + .008, s * (x + th / 2), 0, 0, { rz: HP, seg: 12 }); x += th + .006; }
      k.cyl('metal_dark', .036, .036, .045, s * (x + .028), 0, 0, { rz: HP, seg: 10 }); } }

  /* ================================================================== 1. HALF-COURT  (-34, -60) */
  function buildCourt() {
    const cx = -34, cz = -60, x0 = -40.8, x1 = -27.2, z0 = -67.5, z1 = -52.5, W = x1 - x0, D = z1 - z0, r = GT.rng('court'), R = (a, b) => a + (b - a) * r();
    let top = -9; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) top = Math.max(top, gy(lerp(x0, x1, i / 10), lerp(z0, z1, j / 10)));
    const Y = top + .1; plat(x0 - .25, z0 - .25, x1 + .25, z1 + .25, Y, 'court');
    B('concrete_stained', W + .5, 1.5, D + .5, cx, Y - .77, cz, .03); B('asphalt_worn', W, .06, D, cx, Y - .03, cz);
    KG.geo(M.court, new T.PlaneGeometry(W, D), { x: cx, y: Y + .003, z: cz, rx: -HP });
    for (let i = 0; i < 7; i++) dec('crack', R(2, 4), R(2, 4), R(x0 + 2, x1 - 2), Y + .006, R(z0 + 2, z1 - 2), R(0, TAU)); dec('gum_spots', 1.2, 1.2, x1 - 1.0, Y + .006, -62.8, 1); dec('water_stain', 3.5, 3, -36, Y + .006, -56.5, .6);
    // sand creeping over the kerb (east + north are level with the beach) and a little blown across the surface
    for (let i = 0; i < 13; i++) drift(x1 + R(-.25, .35), Y, lerp(z0, z1, (i + r()) / 13), R(.5, 1.1), R(.7, 1.6), R(.05, .11));
    for (let i = 0; i < 11; i++) drift(lerp(x0, x1, (i + r()) / 11), Y, z1 + R(-.2, .35), R(.7, 1.6), R(.5, 1.0), R(.05, .1));
    for (let i = 0; i < 8; i++) drift(R(x0, x1), Y - .02, z0 - R(-.1, .3), R(.6, 1.4), R(.4, .8), R(.04, .08)); for (let i = 0; i < 6; i++) drift(x0 + R(-.3, .2), Y - .03, R(z0, z1), R(.4, .8), R(.7, 1.5), R(.03, .07));
    // ---- hoop: gooseneck pole, fan board, bent rim, chain net
    const px = cx, pz = -67.12, rimY = Y + 3.05, bbZ = -65.4, by = rimY + .31;
    B('concrete_stained', .74, .12, .74, px, Y + .04, pz, .02); B('metal_galv', .42, .025, .42, px, Y + .112, pz, .004); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { C('metal_galv', .02, .02, .035, px + a * .16, Y + .135, pz + b * .16, { seg: 6 }); C('metal_galv', .009, .009, .07, px + a * .16, Y + .15, pz + b * .16, { seg: 5 }); }
    K.tube('metal_dark', [[px, Y + .1, pz], [px, Y + 2.3, pz], [px, Y + 3.3, pz + .14], [px, Y + 3.76, pz + .75], [px, Y + 3.78, bbZ - .12]], .075, { seg: 12, steps: 48, tension: .4 });
    wdec('rust_run', .16, .9, px, Y + .62, pz + .0765, N_);
    sc(0x2b4a70, .135, .135, 1.75, px, Y + 1.05, pz, { seg: 14 }); for (const yy of [.3, 1.0, 1.8]) sc(0x8d908e, .138, .138, .05, px, Y + yy, pz, { seg: 14 }); sb(0xd9d5c8, .1, .14, .01, px, Y + 1.4, pz + .136);
    const fan = new T.Shape(); fan.moveTo(-.42, -.46); fan.lineTo(.42, -.46); fan.bezierCurveTo(.62, -.42, .69, -.24, .69, -.08); fan.lineTo(.69, .14); fan.quadraticCurveTo(.64, .53, 0, .53); fan.quadraticCurveTo(-.64, .53, -.69, .14); fan.lineTo(-.69, -.08); fan.bezierCurveTo(-.69, -.24, -.62, -.42, -.42, -.46);
    K.geo('metal_painted_white', new T.ExtrudeGeometry(fan, { depth: .028, bevelEnabled: false, curveSegments: 10 }), { x: px, y: by, z: bbZ - .028 }); shapeFace(M.lit, fan, ART.board, { x: px, y: by, z: bbZ + .0015 });
    B('metal_dark', .34, .3, .02, px, by - .22, bbZ - .04, .004); B('metal_dark', .12, .12, .1, px, Y + 3.78, bbZ - .09, .01); for (const s of [-1, 1]) { rod('metal_dark', [px, Y + 3.78, bbZ - .12], [px + s * .5, by + .3, bbZ - .03], .014, 6); rod('metal_dark', [px, Y + 3.7, bbZ - .12], [px + s * .34, by - .34, bbZ - .03], .014, 6); }
    wdec('rust_run', .3, .5, px + .4, by - .1, bbZ + .003, N_);
    P(px, rimY, bbZ + .012, { rx: .13, rz: .055 });
    sb(0xb5461c, .17, .13, .014, 0, -.03, 0, { metal: true }); sb(0xb5461c, .11, .014, .13, 0, .0, .06, { metal: true }); stor(0xb5461c, .229, .0098, 0, 0, .34, { rx: HP, seg: 8, seg2: 30, metal: true });
    for (const s of [-1, 1]) srod(0xb5461c, [s * .07, -.09, .005], [s * .17, -.008, .2], .006, 5, { metal: true });
    KG.geo(M.cut, remap(new T.CylinderGeometry(.226, .15, .42, 18, 3, true), ART.net), { x: 0, y: -.22, z: .34 });
    const hp = wp(0, 0, .34); Q();
    anchor('hoop', { x: hp[0], y: hp[1], z: hp[2], h: 0, r: .229, boardZ: bbZ, floorY: Y }); post(px, pz, .16, 4, 'hoop');
    // ---- chain-link back-stop with windscreen banners
    const fz = -67.64, fy = Y - .02; linkFence(x0 - .12, fz, x1 + .12, fz, 3.7, fy, { tag: 'court-fence' }); linkFence(x0 - .12, fz, x0 - .12, -63.4, 3.7, fy, { tag: 'court-fence' }); linkFence(x1 + .12, fz, x1 + .12, -63.4, 3.7, fy, { tag: 'court-fence' });
    aq(M.lit, ART.banner1, 5.7, .89, -37.6, Y + 1.12, fz + .035, { rz: -.012 }, true); aq(M.lit, ART.banner2, 5.7, .89, -30.4, Y + 1.08, fz + .035, { rz: .01 }, true);
    for (const bxx of [-37.6, -30.4]) for (const s of [-1, 1]) for (const t of [-1, 1]) sb(0x101010, .012, .07, .05, bxx + s * 2.78, Y + 1.1 + t * .4, fz + .02);
    wdec('grime_streak', 3, .7, -38, Y + .35, fz + .04, N_);
    // ---- bleachers on the sand, facing the court and the sunset
    { const bx = -26.2, bz = -63, yb = gy(bx, bz) - .02; P(bx, yb, bz, { ry: -HP }); const gm = 'metal_galv', al = 'aluminium_brushed';
      for (const x of [-2.25, -.75, .75, 2.25]) { bar(gm, [x, .03, .7], [x, .03, -.6], .05); bar(gm, [x, .03, .55], [x, .43, .55], .04); bar(gm, [x, .03, -.45], [x, .87, -.45], .04); bar(gm, [x, .06, .5], [x, .84, -.42], .035); bar(gm, [x, .43, .64], [x, .43, .1], .04); bar(gm, [x, .87, -.08], [x, .87, -.54], .04); bar(gm, [x, .45, .1], [x, .45, -.42], .035);
        for (const zz of [.6, -.5]) drift(x, .03, zz, .3, .28, .08); }
      B(al, 5.0, .042, .25, 0, .472, .44, .008); B(al, 5.0, .042, .25, 0, .912, -.3, .008); B(al, 5.0, .036, .22, 0, .486, -.02, .008); bar(gm, [-2.25, .25, -.45], [2.25, .25, -.45], .03); bar(gm, [-2.25, .1, -.44], [-.75, .8, -.44], .025); bar(gm, [2.25, .1, -.44], [.75, .8, -.44], .025);
      for (const s of [-1, 1]) { sb(0x18181a, .02, .05, .26, s * 2.51, .472, .44); sb(0x18181a, .02, .05, .26, s * 2.51, .912, -.3); }
      boombox(-1.55, .494, .44, .2); duffel(0x7a2f2a, 1.2, .494, .44, .56, .15, .1); duffel(0x2f4a3a, .1, .934, -.3, .5, .13, -.2, 0x8a8a84); sportBottle(0x3d8a9a, -.9, .494, .47); sportBottle(0xc9c6bc, 1.75, .494, .4); sportBottle(0xd98a2c, 1.9, .494, .5); sportBottle(0x3d8a9a, .9, .03, .95, .5);
      P(-.5, .934, -.3, { ry: .15 }); aq(M.lit, ART.towel, .5, .26, 0, .001, 0, UP, true); aq(M.lit, ART.towel, .5, .2, 0, -.1, .13, { rx: .12 }, true); Q();
      sb(0x23304a, .3, .42, .2, 2.1, .2, .95, { bevel: .05, rx: -.2 }); sb(0x1a1a1c, .22, .14, .06, 2.1, .2, 1.06, { bevel: .02, rx: -.2 });   // backpack on the sand
      ball(-.2, .12 + .03, 1.0, .4, 1); ball(1.6, .14, -.9, 1.2, .3);
      const sb_ = wp(0, .494, .44); anchor('courtBench', { x: sb_[0], y: sb_[1], z: sb_[2], h: -HP, row2: wp(0, .934, -.3) }); Q(); box(bx - .75, bz - 2.55, bx + .7, bz + 2.55, 1, 'bleachers'); }
    // ---- water fountain
    { const x = -27.75, z = -66.4; B('concrete_stained', .36, .92, .36, x, Y + .46, z, .03); C('chrome', .17, .12, .07, x, Y + .955, z, { seg: 16 }); C('chrome', .013, .013, .06, x + .09, Y + 1.01, z, { seg: 8 }); C('chrome', .028, .028, .02, x, Y + .78, z + .185, { rx: HP, seg: 10 }); rod('metal_galv', [x, Y + .9, z - .1], [x, Y + .02, z - .2], .02, 6);
      wdec('water_stain', .36, .7, x, Y + .5, z + .182, N_); dec('puddle', .9, .7, x - .1, Y + .007, z + .55, .3); dec('water_stain', 1.6, 1.4, x - .1, Y + .006, z + .5, 1); post(x, z, .22, 1, 'fountain'); }
    // ---- floodlight pole (west kerb), two heads aimed across the court
    { const x = x0 - .02, z = cz; B('concrete_stained', .62, .6, .62, x, Y + .06, z, .03); C('metal_galv', .06, .095, 7.7, x, Y + 4.2, z, { seg: 10 }); B('metal_galv', .09, .09, 1.8, x, Y + 8.0, z, .01); C('metal_galv', .1, .1, .02, x, Y + .37, z, { seg: 10 });
      for (const s of [-1, 1]) { P(x + .14, Y + 7.82, z + s * .62, { rz: -.72, ry: -s * .22 }); B('metal_dark', .2, .34, .46, 0, 0, 0, .03); K.box('light_cool', .012, .28, .4, .104, 0, 0); B('metal_dark', .16, .02, .5, .14, .175, 0); B('metal_galv', .06, .2, .06, -.1, .08, 0, .005); Q(); }
      B('metal_galv', .24, .34, .13, x + .12, Y + 1.6, z, .012); rod('metal_galv', [x + .12, Y + 1.77, z], [x + .075, Y + 7.9, z], .012, 5); wdec('rust_run', .3, .7, x + .187, Y + 1.25, z, E_); sb(0xd9a514, .16, .1, .004, x + .187, Y + 1.62, z, { ry: HP });
      spill(13, 14, cx - .6, Y + .012, cz); post(x, z, .3, 8, 'floodlight'); S.lights.court = [new T.PointLight(0xdbe6ff, 0, 27, 1.5), 1.25]; S.lights.court[0].position.set(cx - 3.2, Y + 6.6, cz); }
    // ---- loose stuff on the court
    ball(-31.3, Y + .12, -62.2, .7, 2.1); sportBottle(0xd98a2c, x1 - .5, Y, -60.2); sportBottle(0xc9c6bc, x1 - .42, Y, -59.9, 1.1); duffel(0x1f2f4a, x1 - .55, Y, -58.9, .6, .15, 1.4, 0xc9c6bc);
    S.props.ball = new T.Mesh(ballGeo(.12), M.lit); S.props.ball.position.set(-39.6, Y + .12, -66.6); S.props.ball.castShadow = true; S.props.ball.name = 'hang_prop_ball';
    const hx = hp[0], hz = hp[2]; [[cx, -60.55], [-38.3, -62.3], [-27.95, -64.7], [cx, -57.95], [-35.6, -54.9]].forEach((p, i) => anchor('courtShot' + (i + 1), { x: p[0], y: Y, z: p[1], h: Math.atan2(hx - p[0], hz - p[1]), dist: +Math.hypot(hx - p[0], hz - p[1]).toFixed(2) }));
    S.info.courtY = Y;
  }

  /* ================================================================== 2. OUTDOOR GYM  (-30, -20) */
  function makeDumbbell(R) { const gs = [flat(new T.CylinderGeometry(.015, .015, .15, 8), 0xb9bcc0)]; for (const s of [-1, 1]) { const g = flat(new T.CylinderGeometry(R, R, .075, 6), 0x1c1c1e); g.translate(0, s * .105, 0); gs.push(g); }
    const m = new T.Mesh(GT.mergeGeos(gs), M.litM); m.geometry.rotateX(HP); m.castShadow = true; m.name = 'hang_prop_dumbbell'; return m; }
  function buildGym() {
    const cx = -30, cz = -20, hw = 5, hd = 4, r = GT.rng('gym'), R = (a, b) => a + (b - a) * r(), f = 'metal_painted_yellow', gv = 'metal_galv';
    let top = -9; for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) top = Math.max(top, gy(lerp(cx - hw, cx + hw, i / 8), lerp(cz - hd, cz + hd, j / 8)));
    const Y = top + .08; plat(cx - hw - .18, cz - hd - .18, cx + hw + .18, cz + hd + .18, Y, 'gym'); const lbox = (a, b, c, d, h, tag) => box(cx + a, cz + b, cx + c, cz + d, h, tag);
    P(cx, Y, cz);
    B(M.rub, 2 * hw, .9, 2 * hd, 0, -.5, 0);
    for (let i = 0; i < 10; i++) for (let j = 0; j < 8; j++) { const lift = r() < .06; B(r() < .18 ? M.rubRed : M.rub, .985, .05, .985, -4.5 + i, -.025 + (r() - .5) * .006 + (lift ? .014 : 0), -3.5 + j, .012, lift ? { rz: (r() - .5) * .05, rx: (r() - .5) * .05 } : undefined); }
    for (const s of [-1, 1]) { B('wood_plank', 2 * hw + .36, .9, .18, 0, -.42, s * (hd + .09), .015); B('wood_plank', .18, .9, 2 * hd, s * (hw + .09), -.42, 0, .015); }
    for (let i = 0; i < 9; i++) drift(R(-hw, hw), 0, (r() < .5 ? -1 : 1) * (hd + R(-.5, .1)), R(.5, 1.2), R(.3, .7), R(.04, .09)); for (let i = 0; i < 8; i++) drift((r() < .7 ? 1 : -1) * (hw + R(-.6, .1)), 0, R(-hd, hd), R(.3, .8), R(.5, 1.3), R(.04, .09));
    // ---- bench press
    const bx = -2.7, bz = -2.0;
    bar(f, [bx, .04, bz - .62], [bx, .04, bz + .6], .05); B(f, .5, .05, .05, bx, .04, bz + .6, .006); B(f, 1.17, .05, .05, bx, .04, bz - .62, .006); bar(f, [bx, .04, bz + .45], [bx, .41, bz + .45], .05); bar(f, [bx, .04, bz - .3], [bx, .41, bz - .3], .05); bar(f, [bx, .4, bz - .6], [bx, .4, bz + .6], .05, .04);
    B('leather_black', .3, .075, 1.22, bx, .458, bz, .022); sb(0x8d908e, .31, .078, .07, bx, .458, bz + .2, { bevel: .02 });
    for (const s of [-1, 1]) { const x = bx + s * .56; bar(f, [x, .04, bz - .5], [x, 1.16, bz - .5], .05); B(f, .05, .05, .52, x, .04, bz - .38, .006); B(gv, .062, .012, .1, x, .93, bz - .44); B(gv, .062, .08, .012, x, .97, bz - .392); B(gv, .062, .14, .012, x, 1.0, bz - .472); wdec('rust_run', .08, .4, x, .5, bz - .474, N_); }
    { const k = GT.kit(); barbellInto(k, [[.225, .035], [.225, .035], [.14, .025]], 'metal_rust'); const g = k.build(), p = wp(bx, .965, bz - .44); g.position.set(p[0], p[1], p[2]); g.name = 'hang_prop_barbell'; S.props.barbell = g; S.props.barbellRest = p; }
    const gb = wp(bx, .5, bz), gh = wp(bx, .5, bz - .5), gf = wp(bx, 0, bz + .95); anchor('gymBench', { x: gb[0], y: gb[1], z: gb[2], h: PI, head: { x: gh[0], z: gh[2] }, stand: { x: gf[0], z: gf[2], h: PI }, barY: gb[1] + .465, barZ: gh[2] + .06 }); lbox(bx - 1.2, bz - .7, bx + 1.2, bz + .7, 1.1, 'gym-bench');
    // ---- squat rack with a loaded bar
    { const rx = .8, rz = -3.1; for (const s of [-1, 1]) { const x = rx + s * .62; bar(f, [x, .03, rz - .55], [x, .03, rz + .7], .06); bar(f, [x, .03, rz], [x, 2.26, rz], .06); bar(f, [x, .06, rz - .5], [x, 1.25, rz], .04); for (let yy = .5; yy < 2.15; yy += .1) sb(0x121212, .022, .022, .004, x, yy, rz + .031);
        B(gv, .075, .11, .02, x, 1.44, rz + .04); B(gv, .075, .02, .1, x, 1.395, rz + .09); B(gv, .075, .06, .012, x, 1.425, rz + .138); bar(gv, [x, .86, rz + .03], [x, .86, rz + .62], .045); rod(gv, [x + s * .03, .5, rz - .28], [x + s * .28, .53, rz - .28], .022, 8);
        C(M.rub, .2, .2, .045, x + s * .1, .508, rz - .28, { rz: HP, seg: 22 }); C('metal_rust', .15, .15, .03, x + s * .145, .512, rz - .28, { rz: HP, seg: 20 }); KG.geo(M.lit, remap(new T.CircleGeometry(.15, 20), ART.plate), { x: x + s * .161, y: .512, z: rz - .28, ry: s * HP }); }
      B(f, 1.3, .06, .06, rx, 2.26, rz, .008); B(f, 1.3, .06, .06, rx, .03, rz - .55, .008); rod(gv, [rx - .62, 2.14, rz + .13], [rx + .62, 2.14, rz + .13], .016, 8); for (const s of [-1, 1]) B(gv, .03, .05, .14, rx + s * .6, 2.16, rz + .07);
      K.push(rx, 1.435, rz + .09); barbellInto(K, [[.225, .05], [.225, .05], [.2, .03]], M.rub); K.pop(); for (const s of [-1, 1]) KG.geo(M.lit, remap(new T.CircleGeometry(.2, 22), ART.plate), { x: rx + s * .834, y: 1.435, z: rz + .09, ry: s * HP });
      wdec('rust_run', .1, .6, rx - .62, 1.1, rz + .032, N_); lbox(rx - .9, rz - .6, rx + .9, rz + .72, 2.3, 'gym-rack'); }
    // ---- pull-up bars + dip station
    { const pz = -3.35; for (const x of [2.85, 4.25]) { C(f, .045, .045, 2.75, x, 1.25, pz, { seg: 10 }); C('concrete_stained', .15, .17, .05, x, .02, pz, { seg: 10 }); sc(0x151515, .047, .047, .03, x, 2.63, pz, { seg: 10 }); lbox(x - .1, pz - .1, x + .1, pz + .1, 2.6, 'gym-post'); }
      C(f, .045, .045, 2.4, 4.25, 1.08, -2.1, { seg: 10 }); C('concrete_stained', .15, .17, .05, 4.25, .02, -2.1, { seg: 10 }); lbox(4.15, -2.2, 4.35, -2.0, 2.3, 'gym-post');
      rod(gv, [2.85, 2.5, pz], [4.25, 2.5, pz], .017, 8); rod(gv, [4.25, 2.15, pz], [4.25, 2.15, -2.1], .017, 8); sb(0xd9d5c8, .06, .003, .2, 3.3, 2.518, pz); sb(0xd9d5c8, .06, .003, .2, 3.8, 2.518, pz);
      for (const x of [2.9, 3.9]) for (const z of [-1.55, -1.0]) { C(f, .035, .035, 1.36, x, .66, z, { seg: 8 }); C('concrete_stained', .12, .14, .05, x, .02, z, { seg: 8 }); } for (const z of [-1.55, -1.0]) { rod(gv, [2.78, 1.34, z], [4.02, 1.34, z], .02, 8); wdec('rust_run', .07, .3, 2.9, 1.1, z + .036, N_); } lbox(2.8, -1.6, 4.0, -.95, 1.35, 'gym-dip'); }
    // ---- dumbbell rack (two tiers), a pair left on the floor
    { const zc = 3.4; for (const x of [-3.85, -1.35]) { bar(f, [x, .03, zc - .4], [x, .03, zc + .35], .05); bar(f, [x, .03, zc + .2], [x, .98, zc + .2], .05); bar(f, [x, .4, zc + .2], [x, .32, zc - .32], .04); bar(f, [x, .84, zc + .2], [x, .78, zc - .24], .04); }
      const tiers = [[.345, zc - .09, .074], [.8, zc - .03, .052]]; tiers.forEach((t, ti) => { rod(gv, [-3.85, t[0] - .03, t[1] - .1], [-1.35, t[0] - .03, t[1] - .1], .015, 6); rod(gv, [-3.85, t[0], t[1] + .1], [-1.35, t[0], t[1] + .1], .015, 6);
        for (let i = 0; i < 6; i++) { if (ti === 1 && i === 2) continue; const x = -3.6 + i * .4, Rr = t[2] + i * .006, y = t[0] - .015 + Rr * .88; for (const d of [-.028, .028]) { const xx = x + d * (Rr / .028) * 1.02; C('chrome', .014, .014, .14, xx, y, t[1], { rx: HP - .15, seg: 8 }); for (const s of [-1, 1]) C(M.rub, Rr, Rr, .075, xx, y + s * .015, t[1] + s * .105, { rx: HP - .15, seg: 6 }); } } });
      lbox(-3.95, zc - .42, -1.25, zc + .4, 1, 'gym-dumbbells');
      const d1 = makeDumbbell(.064), d2 = makeDumbbell(.064), p1 = wp(-2.25, .064, 2.3), p2 = wp(-1.95, .064, 2.42); d1.position.set(p1[0], p1[1], p1[2]); d1.rotation.y = .5; d2.position.set(p2[0], p2[1], p2[2]); d2.rotation.y = -.3; S.props.dumbbells = [d1, d2];
      const gc = wp(-2.1, 0, 2.0); anchor('gymCurl', { x: gc[0], y: gc[1], z: gc[2], h: -HP }); }
    // ---- kettlebells, tyre + sledgehammer
    for (let i = 0; i < 4; i++) { const x = .25 + i * .45, z = 3.45 + (i % 2) * .08, Rr = .085 + .013 * i; K.sphere('metal_dark', Rr, x, Rr * .9, z, { seg: 14, seg2: 10 }); K.geo('metal_dark', new T.TorusGeometry(Rr * .6, .016, 6, 14, PI), { x, y: Rr * 1.68, z, ry: .3 * i }); C('metal_dark', Rr * .62, Rr * .62, .03, x, .015, z, { seg: 12 }); sc([0x3d7a84, 0xc9a12c, 0x8a8d8c, 0xa3231c][i], Rr * 1.004, Rr * 1.004, .028, x, Rr * .9, z, { seg: 14, open: true }); }
    K.geo(mt('rubber', { tread: true }), new T.TorusGeometry(.5, .26, 12, 28), { x: 3.6, y: .255, z: 2.35, rx: HP }); drift(3.6, .1, 2.35, .3, .3, .1); lbox(2.9, 1.65, 4.3, 3.05, .5, 'gym-tyre');
    rod('wood_plank', [2.75, .05, 1.35], [3.2, .56, 1.9], .019, 7); B('metal_dark', .08, .08, .2, 2.75, .05, 1.35, .01, { ry: .7, rz: .5 });
    // ---- punching bag on a gallows frame (the bag itself is a swinging prop)
    { const x = -4.5, z = 1.3; bar(f, [x, .03, z], [x, 2.86, z], .1); B(gv, .42, .02, .42, x, .012, z, .004); bar(f, [x, .04, z - .65], [x, .04, z + .65], .07); bar(f, [x - .35, .04, z], [x + .75, .04, z], .07); bar(f, [x, 2.81, z], [x + 1.0, 2.81, z], .08); bar(f, [x, 2.25, z], [x + .55, 2.78, z], .05); C(gv, .012, .012, .07, x + .88, 2.75, z, { seg: 6 }); wdec('rust_run', .12, .8, x, 1.3, z + .052, N_);
      for (const [dx, dz] of [[.7, 0], [0, .6], [0, -.6]]) B('fabric_dark', .34, .12, .24, x + dx, .15, z + dz, .05);   // sandbags on the feet
      const k = GT.kit(); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.geo('metal_galv', rodGeo([0, 0, 0], [a * .1, -.34, b * .1], .006, 5)); k.cyl('metal_galv', .02, .02, .05, 0, .01, 0, { seg: 8 }); k.cyl('leather_black', .175, .165, 1.12, 0, -.92, 0, { seg: 18 }); k.cyl('leather_black', .15, .175, .05, 0, -.335, 0, { seg: 18 }); k.sphere('leather_black', .165, 0, -1.48, 0, { seg: 18, seg2: 8, s: [1, .25, 1] }); k.cyl('metal_galv', .178, .178, .05, 0, -.72, 0, { seg: 18, open: true }); k.cyl('metal_galv', .176, .176, .07, 0, -1.12, 0, { seg: 18, open: true });
      const g = k.build(), p = wp(x + .88, 2.72, z); g.position.set(p[0], p[1], p[2]); g.name = 'hang_prop_bag'; S.props.bag = g; S.sway.push({ o: g, ax: .035, az: .02, f: .9, ph: 1.3 });
      const ga = wp(x + 1.85, 0, z); anchor('gymBag', { x: ga[0], y: ga[1], z: ga[2], h: -HP, bag: { x: p[0], y: p[1] - .92, z: p[2] } }); lbox(x - .4, z - .7, x + .8, z + .7, 2.8, 'gym-bagframe'); lbox(x + .7, z - .22, x + 1.1, z + .22, 2, 'gym-bag'); }
    // ---- chalk, towels, water
    bucket(0xd9d6cc, -1.75, 0, -1.25, .15, .27); sb(0xf1efe8, .09, .05, .06, -1.75, .2, -1.25, { ry: .4 }); sb(0xf1efe8, .07, .05, .06, -1.7, .24, -1.3, { ry: 1.2 }); sc(0xd8d6cf, .34, .34, .003, -1.72, .003, -1.2, { seg: 16 }); sc(0xd8d6cf, .13, .13, .003, -2.2, .003, -1.5, { seg: 10 });
    P(bx, .5, bz + .45, { ry: .1 }); aq(M.lit, ART.towel, .44, .3, 0, 0, 0, UP, true); aq(M.lit, ART.towel, .44, .22, .0, -.11, .15, N_, true); Q(); P(4.25, 2.15, -2.7, { ry: HP }); aq(M.lit, ART.towel, .5, .34, 0, -.17, .02, N_, true); aq(M.lit, ART.towel, .5, .3, 0, -.15, -.02, S_, true); Q();
    sb(0x2f5d8a, .36, .28, .36, 4.35, .14, -.2, { bevel: .012 }); sb(0x1d3d5c, .3, .02, .3, 4.35, .285, -.2); sc(0xc0621f, .165, .155, .42, 4.35, .5, -.2, { seg: 16 }); sc(0xe6e2d6, .17, .17, .05, 4.35, .735, -.2, { seg: 16 }); sc(0xe6e2d6, .02, .02, .05, 4.35, .36, -.02, { rx: HP, seg: 8 }); for (let i = 0; i < 3; i++) sc(0xe9e6dc, .034, .028, .08, 4.62, .04 + i * .012, .1, { seg: 10 }); dec('water_stain', .9, .9, 4.4, .004, .05, .5);
    sportBottle(0x3d8a9a, -2.2, 0, -1.0); sportBottle(0xd98a2c, 1.7, 0, -2.5, .8); duffel(0x2a2c30, 1.9, 0, .2, .62, .16, .5, 0xc9a12c); for (const s of [-1, 1]) sb(0xc94f3a, .1, .02, .26, 2.6 + s * .08, .01, .3 + s * .05, { bevel: .008, ry: .4 + s * .1 });   // flip-flops
    // ---- hand-painted rules board at the entrance
    for (const z of [-1.76, -.64]) PLX('wood_plank', 2.5, .09, .09, 5.42, .95, z, .01, { rz: HP }); B('wood_painted', .04, 1.26, .98, 5.42, 1.52, -1.2, .01); aq(M.lit, ART.rules, .9, 1.2, 5.442, 1.52, -1.2, E_); B('wood_plank', .08, .05, 1.2, 5.42, 2.18, -1.2, .008, { rx: .0 }); lbox(5.34, -1.82, 5.5, -.58, 2.2, 'gym-sign');
    Q();
    // ---- palms for shade + a duckboard path from the seawall stairs
    palm(-36.3, -24.8, 7.6, .7, 'gp1'); palm(-24.2, -14.9, 6.9, 3.7, 'gp2'); palm(-36.7, -16.4, 8.3, .1, 'gp3', .14);
    for (let x = -12.75; x > -24.75; x -= .168) { const z = cz + Math.sin(x * .9) * .05, y = gy(x, z); PLX(M.wood, 1.25 + (r() - .5) * .06, .035, .15, x, y + .028, z + (r() - .5) * .04, .005, { rx: -Math.atan((gy(x + .15, z) - gy(x - .15, z)) / .3), ry: HP + (r() - .5) * .04 }); }
    for (let i = 0; i < 9; i++) { const x = R(-24.5, -13), z = cz + R(-.7, .7); drift(x, gy(x, z) + .04, z, R(.3, .7), R(.25, .5), R(.04, .07)); }
    S.info.gymY = Y;
  }

  /* ================================================================== 3. TIKI BAR "The Drift Line"  (-32, 30) */
  /** quad from 4 corner points (counter-clockwise seen from the visible side), UVs in metres along a->b / a->d */
  function quadGeo(a, b, c, d) { const g = new T.BufferGeometry(), u = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), v = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    g.setAttribute('position', new T.Float32BufferAttribute([].concat(a, b, c, d), 3)); g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, u, 0, u, v, 0, v], 2)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return g; }
  const V3 = (a) => new T.Vector3(a[0], a[1], a[2]);
  /** shaggy thatch on one roof plane: eave edge p0->p1, top edge q0->q1 (q0 === q1 for a hip end) */
  function thatch(p0, p1, q0, q1, rows, r) { const P0 = V3(p0), P1 = V3(p1), Q0 = V3(q0), Q1 = V3(q1), m4 = new T.Matrix4(), a = new T.Vector3(), d = new T.Vector3(), n = new T.Vector3(), c = new T.Vector3(), A_ = new T.Vector3(), B_ = new T.Vector3(), R_ = ART.fringe;
    d.subVectors(P0, Q0).add(c.subVectors(P1, Q1)).normalize();
    for (let row = 0; row < rows; row++) { const t = row / rows; A_.lerpVectors(P0, Q0, t); B_.lerpVectors(P1, Q1, t); const len = A_.distanceTo(B_), cnt = Math.max(1, Math.round(len / .1));
      a.subVectors(B_, A_).normalize(); n.crossVectors(d, a); if (n.y < 0) { a.negate(); n.negate(); }
      for (let i = 0; i < cnt; i++) { const u = (i + .5 + (r() - .5) * .6) / cnt, L = .55 + r() * .5, w = len / cnt * (1.1 + r() * .5), g = GT.boxGeo(L, .022 + r() * .02, w, 0), uv = g.attributes.uv, du = r() * 1.5, dv = r() * .84; for (let q = 0; q < uv.count; q++) uv.setXY(q, uv.getX(q) * .7 + du, uv.getY(q) * .35 + dv);
        c.lerpVectors(A_, B_, u).addScaledVector(d, L * .5 - .22 - r() * .1).addScaledVector(n, .03 + r() * .04);
        const a2 = a.clone().applyAxisAngle(n, (r() - .5) * .3), d2 = new T.Vector3().crossVectors(a2, n).normalize().applyAxisAngle(a2, -.05 - r() * .09), n2 = new T.Vector3().crossVectors(d2, a2);
        m4.makeBasis(d2, n2, a2.clone().negate()).setPosition(c); g.applyMatrix4(m4); K.geo(M.thatch, g); }
      // loose straw ends lying over each course
      const nq = Math.max(1, Math.round(len / 1.2)); for (let i = 0; i < nq; i++) { const pa = A_.clone().lerp(B_, i / nq).addScaledVector(n, .075), pb = A_.clone().lerp(B_, (i + 1) / nq).addScaledVector(n, .075), pc = pb.clone().addScaledVector(d, .5).addScaledVector(n, -.02), pd = pa.clone().addScaledVector(d, .5).addScaledVector(n, -.02), g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute([pd.x, pd.y, pd.z, pc.x, pc.y, pc.z, pb.x, pb.y, pb.z, pa.x, pa.y, pa.z], 3)); g.setAttribute('uv', new T.Float32BufferAttribute([R_.u0, R_.v0, R_.u1, R_.v0, R_.u1, R_.v1, R_.u0, R_.v1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); KG.geo(M.cut, g); } } }
  function fringe(p0, p1, h) { const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]), n = Math.max(1, Math.round(len / 1.3)); for (let i = 0; i < n; i++) { const a = [lerp(p0[0], p1[0], i / n), p0[1], lerp(p0[2], p1[2], i / n)], b = [lerp(p0[0], p1[0], (i + 1) / n), p0[1], lerp(p0[2], p1[2], (i + 1) / n)];
      const g = new T.BufferGeometry(), R_ = ART.fringe; g.setAttribute('position', new T.Float32BufferAttribute([a[0], a[1] - h, a[2], b[0], b[1] - h, b[2], b[0], b[1], b[2], a[0], a[1], a[2]], 3)); g.setAttribute('uv', new T.Float32BufferAttribute([R_.u0, R_.v0, R_.u1, R_.v0, R_.u1, R_.v1, R_.u0, R_.v1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); KG.geo(M.cut, g); } }
  const BOTTLE = [[.4, .16, .03], [.4, .16, .03], [.1, .045, .02], [.1, .045, .02], [.04, .13, .05], [.04, .13, .05], [.58, .66, .64], [.58, .66, .64], [.05, .1, .26], [.55, .38, .09], [.3, .05, .03], [.02, .02, .025]];
  const bottleAt = (x, y, z, r, sc_, lean) => { const p = wp(x, y, z), c = BOTTLE[(r() * BOTTLE.length) | 0], s = sc_ || (.82 + r() * .3); INST.bottles.push([p[0], p[1], p[2], r() * TAU, s, lean || 0, c[0], c[1], c[2], .9 + r() * .25]); };
  function stool(x, z, ry, seatY) { P(x, 0, z, { ry }); C('wood_plank', .175, .165, .045, 0, seatY - .0225, 0, { seg: 18 }); C('wood_plank', .15, .15, .02, 0, seatY - .055, 0, { seg: 14 });
    for (let i = 0; i < 4; i++) { const a = i * HP + PI / 4, cx = Math.cos(a), sz = Math.sin(a); rod('metal_dark', [cx * .2, 0, sz * .2], [cx * .12, seatY - .06, sz * .12], .015, 6); sc(0x111111, .02, .02, .02, cx * .2, .01, sz * .2, { seg: 6 }); }
    K.geo('metal_galv', new T.TorusGeometry(.172, .011, 6, 20), { y: .28, rx: HP }); Q(); }
  function glass(x, y, z, liquid, umbrella) { C('glass_clear', .034, .026, .12, x, y + .06, z, { seg: 10, open: true }); if (liquid) sc(liquid, .03, .024, .085, x, y + .048, z, { seg: 10 }); if (umbrella) { srod(0xd9d2bc, [x + .01, y + .05, z], [x + .05, y + .19, z + .02], .0025, 4); sgeo(new T.ConeGeometry(.05, .025, 10, 1, true), umbrella, x + .05, y + .185, z + .02, { rz: -.25 }); } }
  function marlin(x, y, z) { P(x, y, z, { s: .85 }); B('wood_plank', 1.5, .34, .03, 0, 0, 0, .01); ss(0x3b5f86, .16, 0, .03, .12, { s: [3.4, .95, .5], seg: 16, seg2: 10, metal: true }); ss(0xc9d0d2, .15, .02, -.01, .125, { s: [3.2, .8, .46], seg: 14, seg2: 8 });
    sgeo(new T.ConeGeometry(.025, .5, 8), 0x2a3440, .76, .04, .12, { rz: -HP }); const fin = new T.Shape(); fin.moveTo(-.3, 0); fin.quadraticCurveTo(-.1, .34, .32, .26); fin.lineTo(.2, .05); fin.lineTo(.3, 0); sgeo(new T.ExtrudeGeometry(fin, { depth: .008, bevelEnabled: false }), 0x24456e, .05, .16, .115);
    const tail = new T.Shape(); tail.moveTo(0, 0); tail.quadraticCurveTo(-.14, .1, -.26, .3); tail.lineTo(-.1, .02); tail.lineTo(-.26, -.26); tail.quadraticCurveTo(-.12, -.08, 0, 0); sgeo(new T.ExtrudeGeometry(tail, { depth: .01, bevelEnabled: false }), 0x24456e, -.5, .03, .115); ss(0x111111, .014, .36, .06, .195, { seg: 6, seg2: 4 }); Q(); }
  function surfboard(rect, o) { const sh = new T.Shape(); sh.moveTo(0, -1.02); sh.bezierCurveTo(.2, -1.0, .27, -.5, .27, 0); sh.bezierCurveTo(.27, .55, .14, .95, 0, 1.06); sh.bezierCurveTo(-.14, .95, -.27, .55, -.27, 0); sh.bezierCurveTo(-.27, -.5, -.2, -1.0, 0, -1.02);
    const g = new T.ExtrudeGeometry(sh, { depth: .05, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 2, curveSegments: 12 }); g.translate(0, 0, -.025); sgeo(g, 0xdcd6c4, o.x, o.y, o.z, o); const f = new T.ShapeGeometry(sh, 12); f.computeBoundingBox(); const bb = f.boundingBox, p = f.attributes.position, uv = f.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, lerp(rect.u0, rect.u1, (p.getX(i) - bb.min.x) / .54), lerp(rect.v0, rect.v1, (p.getY(i) - bb.min.y) / 2.08)); f.translate(0, 0, .039); KG.geo(M.lit, f, o); }
  function lantern(x, y, z, rect, top) { KG.geo(M.glow, remap(new T.SphereGeometry(.15, 14, 10), rect), { x, y, z, s: [1, .86, 1] }); sc(0x2a1a10, .05, .05, .02, x, y + .13, z, { seg: 10 }); sc(0x2a1a10, .05, .05, .02, x, y - .13, z, { seg: 10 }); srod(0x1a1a1a, [x, y + .13, z], [x, top, z], .003, 4); stube(0xa3231c, [[x, y - .13, z], [x + .01, y - .2, z], [x, y - .27, z + .01]], .006, { seg: 4 }); }
  function buildBar() {
    const cx = -32, cz = 30, hx = 4, hz = 2.8, r = GT.rng('bar'), R = (a, b) => a + (b - a) * r(), wd = M.wood, dk = 'wood_plank';
    let top = -9; for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) top = Math.max(top, gy(lerp(cx - hx, cx + hx, i / 8), lerp(cz - hz, cz + hz, j / 8)));
    const Yd = top + .5, sandE = gy(cx + 5.2, cz + 1.7); plat(cx - hx - .05, cz - hz - .05, cx + hx + .05, cz + hz + .05, Yd, 'bar-deck'); const lbox = (a, b, c, d, h, tag) => box(cx + a, cz + b, cx + c, cz + d, h, tag);
    P(cx, Yd, cz);
    // ---- deck: piles, beams, planks
    for (const x of [-3.8, -1.27, 1.27, 3.8]) for (const z of [-2.6, 0, 2.6]) C('palm_trunk', .095, .11, 1.6, x, -.95, z, { seg: 8 });
    for (const z of [-2.6, 0, 2.6]) B(dk, 8.0, .16, .1, 0, -.125, z, .01); for (const z of [-2.82, 2.82]) B(dk, 8.08, .2, .035, 0, -.11, z, .008); for (const x of [-4.02, 4.02]) B(dk, .035, .2, 5.6, x, -.11, 0, .008);
    for (let i = 0; i < 57; i++) PLX(wd, 5.6 + (r() - .5) * .05, .036, .132, -3.93 + i * .1404, -.018 + (r() - .5) * .005, (r() - .5) * .03, .006, { ry: HP });
    for (let i = 0; i < 7; i++) drift(R(-4.6, 4.6), -.5 + R(-.05, .02), (r() < .5 ? -1 : 1) * R(2.6, 3.2), R(.6, 1.3), R(.4, .8), R(.1, .2)); drift(3.4, .0, 2.3, .5, .4, .035); drift(-3.5, 0, .9, .35, .5, .03); drift(3.6, 0, -.3, .3, .5, .03);
    // ---- roof: six palm posts, ring beams, rafters, shaggy thatch with a fringe
    const ex = 4.65, ez = 3.45, ye = 2.36, yr = 4.4, rl = 1.35, PX = [-3.82, 0, 3.82], PZ = [-2.62, 2.62];
    for (const x of PX) for (const z of PZ) { C('palm_trunk', .085, .1, 2.6, x, 1.26, z, { seg: 10 }); for (const yy of [2.34, 2.42]) sc(0xa08a5e, .1, .1, .05, x, yy, z, { seg: 10 }); lbox(x - .12, z - .12, x + .12, z + .12, 2.6, 'bar-post'); }
    for (const z of PZ) B(dk, 8.2, .15, .1, 0, 2.56, z, .012); for (const x of PX) B(dk, .1, .15, 5.6, x, 2.68, 0, .012);
    const eaveAt = (x, z) => [x, ye, z], ridgeAt = x => [cl(x, -rl, rl), yr - .06, 0];
    for (const s of [-1, 1]) { for (let x = -3.9; x <= 3.91; x += .78) rod('palm_trunk', [x, ye + .02, s * ez], ridgeAt(x), .038, 6, .03); for (const zz of [-1.7, 0, 1.7]) rod('palm_trunk', [s * ex, ye + .02, zz], [s * rl, yr - .06, 0], .038, 6, .03); for (const t of [-1, 1]) rod('palm_trunk', [s * ex, ye + .02, t * ez], [s * rl, yr - .04, 0], .05, 6, .04); }
    rod('palm_trunk', [-rl - .1, yr - .02, 0], [rl + .1, yr - .02, 0], .06, 8);
    const und = mt('wood_plank', { color: 0x4a3a28 }), e = -.12; // woven underside, a hand below the thatch
    K.geo(und, quadGeo([-ex, ye + e, -ez], [ex, ye + e, -ez], [rl, yr - .26, 0], [-rl, yr - .26, 0])); K.geo(und, quadGeo([ex, ye + e, ez], [-ex, ye + e, ez], [-rl, yr - .26, 0], [rl, yr - .26, 0]));
    K.geo(und, quadGeo([ex, ye + e, -ez], [ex, ye + e, ez], [rl, yr - .26, 0], [rl, yr - .26, 0])); K.geo(und, quadGeo([-ex, ye + e, ez], [-ex, ye + e, -ez], [-rl, yr - .26, 0], [-rl, yr - .26, 0]));
    thatch([-ex, ye, -ez], [ex, ye, -ez], [-rl, yr, 0], [rl, yr, 0], 13, r); thatch([ex, ye, ez], [-ex, ye, ez], [rl, yr, 0], [-rl, yr, 0], 13, r); thatch([ex, ye, -ez], [ex, ye, ez], [rl, yr, 0], [rl, yr, 0], 13, r); thatch([-ex, ye, ez], [-ex, ye, -ez], [-rl, yr, 0], [-rl, yr, 0], 13, r);
    for (let x = -rl - .2; x <= rl + .2; x += .15) for (const s of [-1, 1]) PLX(M.thatch, .5 + r() * .15, .035, .18, x, yr + .02, s * .2, 0, { rz: -s * .62, ry: HP + (r() - .5) * .2 }); rod('palm_trunk', [-rl - .35, yr + .16, 0], [rl + .35, yr + .16, 0], .045, 7);
    fringe([-ex, ye + .05, -ez - .08], [ex, ye + .05, -ez - .08], .36); fringe([ex, ye + .05, ez + .08], [-ex, ye + .05, ez + .08], .36); fringe([ex + .08, ye + .05, -ez], [ex + .08, ye + .05, ez], .36); fringe([-ex - .08, ye + .05, ez], [-ex - .08, ye + .05, -ez], .36);
    // ---- back wall (south): weathered planks, light leaking between them
    for (let i = 0; i < 50; i++) { const x = -3.72 + i * .152, hgt = 2.46 - (r() < .12 ? R(.05, .4) : 0); PLX(wd, hgt, .028, .14, x, hgt / 2, -2.7 + (r() - .5) * .008, .005, { rz: HP, ry: HP }); } for (const yy of [.5, 1.6, 2.38]) B(dk, 7.6, .09, .05, 0, yy, -2.74, .008); lbox(-3.85, -2.8, 3.85, -2.62, 2.5, 'bar-wall');
    // ---- U-shaped counter: slatted front, thick worn top, foot rail
    const top_ = mt('wood_plank', { color: 0x5c3d27, rough: .55 }), CT = 1.11;
    const counter = (x0, z0, x1, z1) => { const w = x1 - x0, d = z1 - z0; B(dk, w - .06, CT - .08, d - .06, (x0 + x1) / 2, (CT - .08) / 2, (z0 + z1) / 2, .01); B(top_, w + .2, .065, d + .2, (x0 + x1) / 2, CT - .0325, (z0 + z1) / 2, .018); lbox(x0, z0, x1, z1, CT, 'bar-counter'); };
    counter(-2.6, -.95, 2.6, -.35); counter(-2.6, -2.6, -2.0, -.95); counter(2.0, -1.95, 2.6, -.95);
    for (let x = -2.56; x < 2.6; x += .105) PLX(wd, .96, .02, .09, x, .5, -.335, .004, { rz: HP, ry: HP }); for (let z = -2.55; z < -.4; z += .105) PLX(wd, .96, .02, .09, -2.615, .5, z, .004, { rz: HP }); for (let z = -1.9; z < -.4; z += .105) PLX(wd, .96, .02, .09, 2.615, .5, z, .004, { rz: HP });
    K.tube('metal_galv', [[-2.86, .2, -2.5], [-2.86, .2, -.2], [-2.75, .2, -.1], [2.75, .2, -.1], [2.86, .2, -.2], [2.86, .2, -1.9]], .021, { seg: 8, steps: 60, tension: .02 }); for (const p of [[-2.86, -2.3], [-2.86, -1.2], [-1.8, -.1], [-.6, -.1], [.6, -.1], [1.8, -.1], [2.86, -1.2]]) rod('metal_galv', [p[0], .2, p[1]], [p[0] * .93, .2, p[1] < -.2 ? p[1] : -.33], .012, 5);
    wdec('grime_streak', 2.4, .5, -1.2, .3, -.322, N_); wdec('grime_streak', 2.2, .5, 1.3, .3, -.322, N_);
    dec('water_stain', .5, .5, -.9, CT + .002, -.62, 1); dec('water_stain', .4, .4, 1.5, CT + .002, -.7, 2); dec('water_stain', .45, .45, -2.3, CT + .002, -1.6, .5); B(M.rub, .6, .012, .2, -1.7, CT + .006, -.78, .004); B(M.rub, .5, .012, .2, .45, CT + .006, -.8, .004);
    // ---- stools (8) + anchors
    const SEAT = .78, stools = [[-2.15, .1, PI], [-1.35, .14, PI], [-.55, .1, PI], [.95, .12, PI], [1.8, .1, PI], [-3.08, -1.25, HP], [-3.06, -2.05, HP], [3.07, -1.42, -HP]];
    stools.forEach((s, i) => { stool(s[0], s[1], r() * TAU, SEAT); const p = wp(s[0], SEAT, s[1]); anchor('barStool' + i, { x: p[0], y: p[1], z: p[2], h: s[2] }); post(p[0], p[2], .17, .8, 'bar-stool'); });
    const bo = wp(.2, 0, .32), bt = wp(.2, 0, -1.5); anchor('barOrder', { x: bo[0], y: bo[1], z: bo[2], h: PI }); anchor('barTender', { x: bt[0], y: bt[1], z: bt[2], h: 0 });
    // ---- back bar: cabinet, three backlit shelves of bottles, blenders, register
    B(dk, 4.6, .9, .45, 0, .45, -2.44, .012); B(top_, 4.7, .05, .52, 0, .925, -2.42, .012); for (let i = 0; i < 6; i++) { B(wd, .7, .74, .016, -1.9 + i * .76, .45, -2.21, .006); sc(0xb8bcc0, .012, .012, .03, -1.65 + i * .76, .5, -2.195, { rx: HP, seg: 6, metal: true }); } lbox(-2.3, -2.68, 2.3, -2.2, 1.0, 'bar-backbar');
    B('wood_plank', 4.5, 1.18, .02, 0, 1.6, -2.672, .004); for (const x of [-2.25, 2.25]) B(dk, .04, 1.2, .24, x, 1.6, -2.55, .006);
    [1.18, 1.52, 1.86].forEach((yy, k) => { B(dk, 4.5, .03, .24, 0, yy, -2.55, .006); K.box('light_warm', 4.4, .014, .014, 0, yy + .022, -2.655); let x = -2.12; while (x < 2.12) { bottleAt(x, yy + .016, -2.54 + (r() - .5) * .05, r); x += .1 + r() * .11; if (r() < .1) x += .2; } });
    for (const [x, col] of [[-1.5, 0x3d7a84], [-1.1, 0xb8352a]]) { sb(0x1c1c1e, .17, .12, .19, x, 1.01, -2.42, { bevel: .02 }); C('glass_clear', .075, .055, .24, x, 1.19, -2.42, { seg: 12, open: true }); sc(col, .068, .052, .12, x, 1.135, -2.42, { seg: 12 }); sc(0x1c1c1e, .08, .08, .025, x, 1.32, -2.42, { seg: 12 }); sb(0xb8bcc0, .05, .02, .01, x, 1.0, -2.322, { metal: true }); }
    sb(0x55504a, .38, .2, .36, .9, 1.05, -2.42, { bevel: .02 }); sb(0x3a3632, .34, .12, .2, .9, 1.2, -2.48, { bevel: .015, rx: -.5 }); sb(0x9fd6a0, .2, .05, .005, .9, 1.26, -2.4, { rx: -.5 }); sb(0x8a8d8c, .36, .08, .3, .9, .99, -2.26, { bevel: .01, metal: true });
    sc(0x8a6a3a, .16, .1, .08, 1.7, .99, -2.42, { seg: 14 }); for (const [dx, dz, c] of [[0, 0, 0x7fa83a], [.07, .03, 0xd98a2c], [-.06, .04, 0x7fa83a], [.02, -.07, 0xd9b52c], [-.03, -.03, 0xd98a2c]]) ss(c, .04, 1.7 + dx, 1.05 + Math.abs(dz), -2.42 + dz, { seg: 8, seg2: 6 });
    sc(0xb8bcc0, .1, .085, .2, 0, 1.05, -2.4, { seg: 14, metal: true }); for (let i = 0; i < 6; i++) glass(-.6 + (i % 3) * .09, .95, -2.5 + ((i / 3) | 0) * .09);
    C('aluminium_brushed', .2, .2, .58, -1.2, .29, -1.28, { seg: 16 }); C('aluminium_brushed', .21, .21, .03, -1.2, .1, -1.28, { seg: 16 }); C('aluminium_brushed', .21, .21, .03, -1.2, .48, -1.28, { seg: 16 }); C('aluminium_brushed', .2, .2, .58, -.72, .29, -1.3, { seg: 16 }); sb(0xb03a26, .7, .42, .4, 1.1, .21, -1.22, { bevel: .03 }); sb(0xe6e2d6, .72, .08, .42, 1.1, .46, -1.22, { bevel: .02 });
    // ---- on the counter: tap tower, tip jar, drinks, bottles
    C('chrome', .045, .055, .34, -1.75, CT + .17, -.7, { seg: 14 }); C('chrome', .04, .04, .36, -1.75, CT + .36, -.7, { rz: HP, seg: 14 }); C('chrome', .075, .075, .02, -1.75, CT + .01, -.7, { seg: 14 });
    [0xb03a26, 0xd9b52c, 0x2f6f4a].forEach((c, i) => { const x = -1.89 + i * .14; C('chrome', .012, .012, .07, x, CT + .34, -.64, { rx: HP, seg: 8 }); C('chrome', .01, .013, .08, x, CT + .3, -.6, { seg: 8 }); sb(c, .035, .16, .028, x, CT + .47, -.61, { bevel: .01, rx: .25 }); });
    B('metal_galv', .46, .025, .2, -1.75, CT + .0125, -.56, .006); dec('water_stain', .5, .3, -1.75, CT + .028, -.56, 0);
    C('glass_clear', .07, .06, .2, .95, CT + .1, -.52, { seg: 14, open: true }); sc(0x4a6a4a, .055, .05, .05, .95, CT + .03, -.52, { seg: 10 }); sb(0x6f8f5a, .08, .004, .035, .95, CT + .07, -.52, { ry: .6, rz: .5 }); aq(M.lit, ART.tips, .1, .075, .95, CT + .1, -.447, N_);
    glass(-.75, CT, -.5, 0xd9772c, 0xd8433a); glass(-.3, CT, -.7, 0xb8352a, 0xe8c83a); glass(1.55, CT, -.55, 0x9fd6c8, 0xd8433a); glass(-2.28, CT, -1.5, 0xd9b52c); glass(2.3, CT, -1.3, 0xd9772c, 0x3d7a84); glass(.1, CT, -.72);
    bottleAt(-1.1, CT, -.78, r, 1); bottleAt(1.9, CT, -.72, r, .9); bottleAt(-2.33, CT, -2.2, r, 1); bottleAt(2.25, CT, -1.7, r, .95); bottleAt(.5, CT + .036, -.6, r, .9, HP);
    sb(0x1c1c1e, .12, .09, .1, -.1, CT + .045, -.55, { bevel: .01 }); for (let i = 0; i < 8; i++) sb(0xe6e2d6, .11, .002, .09, -.1, CT + .09 + i * .0025, -.55, { ry: i * .08 }); sc(0x2a2c30, .05, .04, .1, .3, CT + .05, -.86, { seg: 10 }); for (let i = 0; i < 7; i++) srod([0xd8433a, 0xe6e2d6, 0x3d7a84][i % 3], [.3, CT + .02, -.86], [.3 + (r() - .5) * .07, CT + .22, -.86 + (r() - .5) * .07], .003, 4);
    for (const [x, z] of [[-.9, -.62], [1.3, -.6], [-2.3, -1.9]]) sc(0xd9d2bc, .048, .048, .004, x, CT + .003, z, { seg: 12 });
    // ---- wall dressing: chalkboard menu, neon, marlin, surfboard, plates, posters, TV
    B(dk, 1.02, 1.3, .03, 3.02, 1.55, -2.672, .01); aq(M.lit, ART.menu, .92, 1.18, 3.02, 1.55, -2.654, N_); B(dk, .96, .03, .06, 3.02, .93, -2.64, .006); sb(0xf1efe8, .07, .016, .016, 2.8, .953, -2.63); sb(0xe8b04a, .05, .016, .016, 3.2, .953, -2.63);
    B(M.rub, .9, .3, .02, 0, 2.31, -2.672, .006); aq(M.glow, ART.neonTiki, .84, .28, 0, 2.31, -2.655, N_);
    marlin(-3.03, 2.12, -2.672); surfboard(ART.surf1, { x: -2.3, y: 1.0, z: -2.86, ry: PI, rx: -.07, rz: .05 }); aq(M.lit, ART.plate1, .3, .15, -2.82, 1.62, -2.67, { rz: .05 }); aq(M.lit, ART.plate2, .3, .15, -2.78, 1.42, -2.67, { rz: -.07 }); aq(M.lit, ART.poster1, .42, .56, -2.75, 1.0, -2.668, { rz: .02 }); aq(M.lit, ART.poster2, .42, .56, 2.85, 2.28 - 1.86, -2.668, { rz: -.03 }); aq(M.lit, ART.cash, .5, .19, 2.2 + .8, 2.32, -2.668, { rz: .02 });
    P(-3.6, 2.06, -1.3, { ry: HP + .35, rx: .12 }); sb(0x1c1c1e, .54, .42, .44, 0, 0, 0, { bevel: .03 }); KG.geo(M.glow, remap(new T.PlaneGeometry(.42, .31), ART.tv), { x: -.03, y: .0, z: .224 }); sb(0x2a2c30, .06, .03, .01, .2, -.17, .222); Q(); B('metal_dark', .05, .4, .05, -3.72, 2.36, -1.3, .006); B('metal_dark', .3, .04, .3, -3.62, 2.18 - .34, -1.3, .006);
    // ---- ceiling fans (spinning props), lanterns, festoons, rooftop neon
    for (const x of [-1.7, 1.7]) { srod(0x2a2c30, [x, 3.02, 0], [x, yr - .12, 0], .014, 6); sc(0x2a2c30, .075, .075, .12, x, 2.98, 0, { seg: 12 });
      const gs = [flat(new T.CylinderGeometry(.09, .07, .07, 12), 0x3a3632)]; for (let i = 0; i < 4; i++) { const g = flat(GT.boxGeo(.56, .01, .13, .004), 0x6a4a30); g.rotateX(.2); g.translate(.36, -.01, 0); g.rotateY(i * HP); gs.push(g); const a = flat(GT.boxGeo(.14, .012, .03, 0), 0x8a8d8c); a.translate(.1, -.005, 0); a.rotateY(i * HP); gs.push(a); }
      const m = new T.Mesh(GT.mergeGeos(gs), M.lit), p = wp(x, 2.9, 0); m.position.set(p[0], p[1], p[2]); m.castShadow = true; m.name = 'hang_prop_fan'; S.fans.push({ o: m, w: x < 0 ? 5.2 : -4.4 }); }
    [[-2.3, ART.lantern], [-1.2, ART.lanternR], [1.2, ART.lanternC], [2.3, ART.lantern]].forEach((d, i) => lantern(d[0], 2.02 - (i % 2) * .1, -.66, d[1], 2.5));
    const PARTY = [[1, .72, .4], [1, .3, .22], [1, .72, .4], [.3, .9, .75], [1, .72, .4], [1, .55, .15]], EY = ye - .1;
    festoon([-ex + .1, EY, ez], [0, EY, ez], .16, .34); festoon([0, EY, ez], [ex - .1, EY, ez], .16, .34); festoon([ex, EY, ez - .1], [ex, EY, -ez + .1], .18, .34); festoon([-ex, EY, ez - .1], [-ex, EY, -ez + .1], .18, .34);
    const poleA = [8.2, 0, 3.4], poleB = [7.6, 0, -2.4]; for (const q of [poleA, poleB]) { const yq = gy(cx + q[0], cz + q[2]) - Yd; C('wood_plank', .05, .065, 3.9, q[0], yq + 1.75, q[2], { seg: 8 }); drift(q[0], yq, q[2], .4, .4, .08); q[1] = yq + 3.6; post(cx + q[0], cz + q[2], .08, 3.5, 'bar-pole'); }
    festoon([ex, EY + .1, ez], poleA, .45, .36, PARTY); festoon([ex, EY + .1, -ez], poleB, .4, .36, PARTY); festoon(poleA, poleB, .5, .36, PARTY);
    P(ex - .25, ye + .55, -.3, { ry: HP }); B(M.rub, 3.5, .92, .05, 0, .3, 0, .012); aq(M.glow, ART.neonName, 3.4, .85, 0, .3, .028, N_); for (const x of [-1.5, 0, 1.5]) { bar('metal_dark', [x, -.25, -.02], [x, -.1, -.7], .035); bar('metal_dark', [x, .7, -.03], [x, .25, -1.0], .03); } Q();
    // ---- two barrel high-tops with candle jars, jukebox
    [[-2.2, 1.9], [1.6, 1.95]].forEach((tb, i) => { const x = tb[0], z = tb[1]; K.geo(dk, new T.CylinderGeometry(.27, .27, .92, 18, 4).translate(0, .46, 0), { x, y: 0, z }); C(dk, .31, .31, .5, x, .46, z, { seg: 18 }); for (const yy of [.08, .3, .62, .84]) K.geo('metal_galv', new T.CylinderGeometry(yy > .2 && yy < .8 ? .314 : .276, yy > .2 && yy < .8 ? .314 : .276, .035, 18, 1, true), { x, y: yy, z });
      C(top_, .4, .4, .045, x, .955, z, { seg: 22 }); glass(x + .12, .98, z + .1, [0xd9772c, 0x9fd6c8][i], 0xe8c83a); glass(x - .15, .98, z - .05, 0xd9b52c); C('glass_clear', .04, .04, .09, x, 1.025, z - .18, { seg: 10, open: true }); bulb(x, 1.01, z - .18, [1, .62, .25], .8); sc(0xd9d2bc, .048, .048, .004, x + .2, .98, z - .12, { seg: 12 });
      const p = wp(x + (i ? -.78 : .78), 0, z + .1); anchor('barTable' + i, { x: p[0], y: p[1], z: p[2], h: i ? HP : -HP, top: Yd + .98 }); lbox(x - .33, z - .33, x + .33, z + .33, 1, 'bar-table'); });
    { P(-3.5, 0, 2.15, { ry: HP }); sb(0x4a2a1c, .8, 1.0, .56, 0, .5, 0, { bevel: .03 }); sgeo(new T.CylinderGeometry(.4, .4, .56, 20, 1, false, 0, PI).rotateX(HP).rotateZ(HP), 0x4a2a1c, 0, 1.0, 0); { const js = new T.Shape(); js.moveTo(-.36, .46); js.lineTo(.36, .46); js.lineTo(.36, 1.0); js.absarc(0, 1.0, .36, 0, PI, false); js.lineTo(-.36, .46); shapeFace(M.glow, js, ART.jukeglow, { x: 0, y: 0, z: .284 }, 14); } aq(M.self, ART.juke, .44, .27, 0, .98, .29, N_);
      sb(0xb8bcc0, .82, .03, .04, 0, .04, .29, { metal: true }); sb(0xb8bcc0, .7, .05, .04, 0, .6, .3, { metal: true }); for (let i = 0; i < 8; i++) sb(0xe6e2d6, .05, .03, .02, -.28 + i * .08, .6, .325); sb(0x1c1c1e, .08, .1, .02, .3, .46, .29); Q();
      const p = wp(-2.6, 0, 2.15); anchor('barJukebox', { x: p[0], y: p[1], z: p[2], h: -HP }); lbox(-3.8, 1.7, -3.2, 2.6, 1.5, 'bar-jukebox'); }
    // ---- rail (rope between posts) on three sides; steps down to the sand on the east
    const rail = (x0, z0, x1, z1) => { const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 1.3)); for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / n), z = lerp(z0, z1, i / n); PLX(wd, 1.02, .09, .09, x, .5, z, .01, { rz: HP }); sb(0x3a3632, .1, .02, .1, x, 1.02, z); }
      PLX(wd, len + .1, .05, .1, (x0 + x1) / 2, 1.04, (z0 + z1) / 2, .012, { ry: Math.atan2(-(z1 - z0), x1 - x0) }); for (let i = 0; i < n; i++) for (const yy of [.72, .4]) stube(0xa89068, sag([lerp(x0, x1, i / n), yy, lerp(z0, z1, i / n)], [lerp(x0, x1, (i + 1) / n), yy, lerp(z0, z1, (i + 1) / n)], .05, 5), .014, { seg: 5, steps: 8 });
      lbox(Math.min(x0, x1) - .07, Math.min(z0, z1) - .07, Math.max(x0, x1) + .07, Math.max(z0, z1) + .07, 1.1, 'bar-rail'); };
    rail(-3.93, -2.5, -3.93, 2.72); rail(-3.93, 2.72, 3.93, 2.72); rail(3.93, -2.5, 3.93, .75); PLX(wd, 1.02, .09, .09, 3.93, .5, 2.55, .01, { rz: HP });
    const drop = sandE - Yd, ns = Math.max(2, Math.ceil(-drop / .17)), rise = drop / (ns + 0); for (let i = 1; i <= ns; i++) { const x = 4.02 + (i - .5) * .3, y = rise * i * (ns / (ns + 1)); PLX(wd, 1.62, .04, .3, x, y - .02, 1.65, .008, { ry: HP }); plat(cx + x - .15, cz + .84, cx + x + .15, cz + 2.46, Yd + y, 'bar-step'); }
    for (const z of [.86, 2.44]) bar(dk, [4.0, -.1, z], [4.05 + ns * .3, drop + .02, z], .05, .2); drift(4.2 + ns * .3, drop - .02, 1.65, .7, 1.0, .06);
    // ---- outside: plank path, A-frame, second surfboard as a sign, OPEN neon, warm spill
    Q();
    for (let i = 0; i < 46; i++) { const x = cx + 4.25 + ns * .3 + i * .172, z = cz + 1.65 + Math.sin(i * .16) * .5 + i * .012, y = gy(x, z); PLX(wd, 1.15 + (r() - .5) * .08, .035, .15, x, y + .026, z + (r() - .5) * .04, .005, { rx: -Math.atan((gy(x + .15, z) - gy(x - .15, z)) / .3), ry: HP + (r() - .5) * .05 - Math.cos(i * .16) * .08 }); }
    { const x = cx + 6.4, z = cz + 3.7, y = gy(x, z); P(x, y, z, { ry: .9 }); for (const s of [-1, 1]) { B(dk, .62, .98, .03, 0, .46, s * .17, .008, { rx: s * .2 }); } aq(M.lit, ART.aframe, .56, .8, 0, .47, .19, { rx: -.2 }); aq(M.lit, ART.aframe, .56, .8, 0, .47, -.19, { rx: .2, ry: PI }); drift(0, 0, 0, .5, .4, .05); Q(); post(x, z, .3, 1, 'bar-aframe'); }
    { const x = cx + 4.75, z = cz - 3.0, y = gy(x, z); surfboard(ART.surf2, { x, y: y + .86, z, ry: HP + .2, rx: -.1 }); K.geo('sand', new T.SphereGeometry(.3, 10, 6), { x, y: y - .1, z, s: [1, .5, 1] }); post(x, z, .25, 1.8, 'bar-surfboard');
      B(M.rub, .02, .34, .62, cx + 4.3, Yd + 1.98, cz - .9, .006); aq(M.glow, ART.neonOpen, .58, .3, cx + 4.315, Yd + 1.98, cz - .9, E_); for (const s of [-1, 1]) rod('metal_galv', [cx + 4.3, Yd + 2.14, cz - .9 + s * .26], [cx + 4.3, Yd + 2.42, cz - .9 + s * .26], .004, 4); }
    spill(11, 9, cx + .5, Yd + .012, cz); spill(9, 8, cx + 7, gy(cx + 7, cz + 1) + .05, cz + 1);
    S.lights.bar = [new T.PointLight(0xffb070, 0, 15, 1.6), 1.7, 6.3]; S.lights.bar[0].position.set(cx, Yd + 2.15, cz - .2); S.info.barY = Yd;
  }

  /* ================================================================== 4. FISHING PIER — dressing + colliders + deck height for the road module's pier (z = 78) */
  function gull(x, y, z, ry, s) { P(x, y, z, { ry, s: s || 1 }); ss(0xe9e7e0, .09, 0, .15, 0, { s: [.95, .78, 1.75], seg: 12, seg2: 8 }); for (const k of [-1, 1]) ss(0x8d949a, .085, k * .04, .165, -.03, { s: [.5, .55, 1.75], seg: 10, seg2: 6 }); sb(0x25272b, .07, .012, .12, 0, .16, -.2, { rx: .2 }); ss(0xeeece6, .047, 0, .245, .12, { seg: 10, seg2: 8 });
    sgeo(new T.ConeGeometry(.016, .06, 6), 0xd9a52a, 0, .238, .19, { rx: HP + .15 }); for (const k of [-1, 1]) { ss(0x111111, .007, k * .03, .255, .15, { seg: 5, seg2: 4 }); srod(0xd98a3a, [k * .03, .1, .0], [k * .03, 0, .01], .005, 4); sb(0xd98a3a, .03, .004, .045, k * .03, .002, .025); } Q(); }
  function fishingRod(a, b, hex) { srod(hex, a, b, .009, 6, { r2: .0025 }); const t = .12, p = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; sc(0x8a8d8c, .028, .028, .035, p[0] + .03, p[1], p[2], { rz: HP, seg: 10, metal: true }); sc(0x1c1c1e, .014, .014, .2, lerp(a[0], b[0], .04), lerp(a[1], b[1], .04), lerp(a[2], b[2], .04), { seg: 6, rx: Math.atan2(b[2] - a[2], b[1] - a[1]) }); }
  function buildPier() {
    const pz = 78, yd = .16, zn = pz + 1.93, zs = pz - 1.93, wd = 'wood_plank', gv = 'metal_galv', r = GT.rng('pier'), R = (a, b) => a + (b - a) * r(), RT = yd + 1.09;
    plat(-109.5, pz - 2.0, -10.0, pz + 2.0, yd, 'pier'); plat(-118.5, pz - 4, -109.5, pz + 4, yd, 'pier-head');
    box(-109.5, zn - .06, -10.42, zn + .12, 1.2, 'pier-rail'); box(-109.5, zs - .12, -10.42, zs + .06, 1.2, 'pier-rail'); for (const s of [-1, 1]) { box(-118.5, pz + s * 3.93 - .08, -109.5, pz + s * 3.93 + .08, 1.2, 'pier-rail'); box(-109.6, pz + s * 1.93, -109.4, pz + s * 4, 1.2, 'pier-rail'); } box(-118.52, pz - 4, -118.36, pz + 4, 1.2, 'pier-rail'); box(-117.3, pz - 2.2, -112.3, pz + 2.2, 3, 'pier-hut');
    // close the open corners where the walkway meets the head platform
    for (const s of [-1, 1]) { for (const zz of [2.0, 2.95, 3.9]) PLX(wd, 1.05, .09, .09, -109.52, yd + .52, pz + s * zz, .008, { rz: HP }); B(wd, .13, .06, 2.0, -109.52, yd + 1.06, pz + s * 2.95, .008); B(wd, .08, .04, 2.0, -109.52, yd + .56, pz + s * 2.95); }
    // ---- three fishing spots: rod holders on the rail, rods, buckets, tackle
    const spots = [[-64, -1], [-72, 1], [-83, -1]];
    spots.forEach((sp, i) => { const x = sp[0], s = sp[1], zr = pz + s * 1.93, p = { x, y: yd, z: zr - s * .62, h: s > 0 ? 0 : PI, rail: zr, water: -1.5 }; anchor('fishSpot' + i, p);
      for (const dx of [-.75, .75]) { rod(gv, [x + dx, RT - .16, zr + s * .07], [x + dx, RT + .2, zr + s * .2], .03, 8); B(gv, .06, .1, .16, x + dx, RT - .07, zr + s * .02, .006); }
      const hx = x + (i === 1 ? .75 : -.75); fishingRod([hx, RT - .1, zr + s * .09], [hx + .12, RT + 2.0, zr + s * 1.05], [0x1f2f4a, 0x2a2c30, 0x5a1f1c][i]);
      if (i !== 1) { const h2 = x + .75; fishingRod([h2, RT - .1, zr + s * .09], [h2 - .1, RT + 1.7, zr + s * .95], 0x2a2c30); }
      bucket([0xd9d6cc, 0xb8352a, 0x2f5d8a][i], x + s * .3 + .9, yd, zr - s * .32, .15, .3); wdec('water_stain', .5, .5, x, yd + .5, zr - s * .05, s > 0 ? S_ : N_); dec('water_stain', 1.5, 1.1, x, yd + .004, zr - s * .6, i);
      bulb(x - 1.3, RT + .16, zr, [1, .7, .38], 1.7); sc(0x2a2c30, .05, .06, .05, x - 1.3, RT + .07, zr, { seg: 8 }); sc(0x2a2c30, .06, .06, .012, x - 1.3, RT + .23, zr, { seg: 8 }); spill(3.4, 2.8, x - 1.3, yd + .012, zr - s * .9); });
    P(-63.1, yd, zs + .5, { ry: .4 }); sb(0x3f5a3a, .42, .2, .24, 0, .1, 0, { bevel: .015 }); sb(0x2f4a2f, .43, .03, .25, 0, .215, 0, { bevel: .01 }); stube(0x1c1c1e, [[-.1, .23, 0], [-.08, .28, 0], [.08, .28, 0], [.1, .23, 0]], .008, { seg: 4 }); Q();
    P(-82.2, yd, zs + .75, { ry: -.5 }); for (const k of [-1, 1]) { srod(0x8a8d8c, [k * .2, 0, -.18], [-k * .2, .42, .18], .009, 5, { metal: true }); srod(0x8a8d8c, [k * .2, 0, .18], [-k * .2, .42, -.18], .009, 5, { metal: true }); } sb(0x2f4a3a, .44, .012, .4, 0, .43, 0); Q();
    // ---- bait cooler
    P(-70.2, yd, zn - .42); sb(0xe6e3da, 1.0, .46, .5, 0, .28, 0, { bevel: .03 }); sb(0xdcd9cf, 1.04, .09, .54, 0, .555, 0, { bevel: .025 }); for (const k of [-1, 1]) { sb(0x8a8d8c, .06, .04, .02, k * .3, .5, -.265, { metal: true }); sb(0x2a2c30, .03, .12, .1, k * .52, .36, 0); sb(0x2a2c30, .1, .05, .1, k * .4, .025, .15); sb(0x2a2c30, .1, .05, .1, k * .4, .025, -.15); }
    aq(M.lit, ART.bait, .62, .31, 0, .3, -.253, S_); wdec('grime_streak', .9, .3, 0, .16, -.256, S_); stube(0x2a2c30, [[.3, .6, .1], [.35, .75, .2], [.2, .72, .34], [.1, .3, .36]], .008, { seg: 4 }); sb(0x3a3d42, .12, .08, .08, .3, .64, .1, { bevel: .01 }); Q(); box(-70.75, zn - .7, -69.65, zn - .1, .7, 'pier-cooler'); dec('water_stain', 1.6, 1.0, -70.2, yd + .004, zn - .8, .2);
    srod(0x8a8d8c, [-69.3, yd, zn - .12], [-69.25, yd + 1.5, zn - .1], .012, 6, { metal: true }); stor(0x8a8d8c, .16, .008, -69.25, yd + 1.66, zn - .1, { metal: true, seg: 5, seg2: 14 });
    // ---- fish-cleaning table
    P(-78.6, yd, zs + .44); for (const x of [-.7, .7]) for (const z of [-.24, .24]) B(gv, .045, .9, .045, x, .45, z, .005); B(gv, 1.4, .04, .04, 0, .3, -.24); B(gv, 1.4, .04, .04, 0, .3, .24); for (const x of [-.7, .7]) B(gv, .04, .04, .48, x, .3, 0);
    sb(0xdedbd0, 1.56, .045, .62, 0, .925, 0, { bevel: .012 }); sb(0xdedbd0, 1.56, .34, .03, 0, 1.11, -.3, { bevel: .008 }); aq(M.lit, ART.fishsign, .9, .3, 0, 1.13, -.283, N_); sb(0x8a8d8c, .4, .1, .34, .48, .9, .02, { bevel: .01, metal: true }); sb(0x55585c, .34, .008, .28, .48, .952, .02);
    stube(0x8a8d8c, [[.48, .95, -.22], [.48, 1.22, -.22], [.48, 1.26, -.12], [.48, 1.2, -.06]], .012, { seg: 6, metal: true }); sb(0xb03a26, .03, .05, .012, .56, 1.0, -.24); sb(0xc9b88a, .46, .022, .3, -.36, .96, .04, { bevel: .006, ry: .08 });
    ss(0x9aa7ad, .05, -.4, 1.0, .04, { s: [2.6, .7, .35], seg: 10, seg2: 6, metal: true, ry: .3 }); ss(0x8f9ba0, .042, -.2, .995, .12, { s: [2.4, .7, .35], seg: 10, seg2: 6, metal: true, ry: -.2 }); sb(0x1c1c1e, .11, .014, .022, -.56, .98, .14, { ry: .5 }); sb(0xc4c8cc, .16, .003, .02, -.45, .978, .2, { ry: .5, metal: true });
    stor(0x3f6a3a, .13, .02, -.74, .5, .3, { ry: HP, seg: 6, seg2: 16 }); stor(0x3f6a3a, .125, .02, -.77, .5, .3, { ry: HP, seg: 6, seg2: 16 }); bucket(0xdedbd0, .2, 0, .5, .15, .3); wdec('rust_run', .3, .5, -.7, .5, .264, N_); Q();
    dec('water_stain', 2.2, 1.6, -78.8, yd + .005, zs + 1.0, 1.2); box(-79.4, zs + .1, -77.8, zs + .78, 1.3, 'pier-table'); bulb(-78.6, yd + 1.4, zs + .16, [1, .7, .38], 1.7); sc(0x2a2c30, .05, .06, .05, -78.6, yd + 1.31, zs + .16, { seg: 8 }); spill(3.6, 3, -78.6, yd + .012, zs + 1.0);
    // ---- signs
    const signPost = (x, z, rect, w, h, rot, yy) => { PLX(wd, 1.2, .07, .07, x, yd + (yy || 1.5) - .25, z, .006, { rz: HP }); const g = GT.boxGeo(w + .04, h + .04, .018, .004); K.geo(mt('metal_painted_white'), g, Object.assign({ x, y: yd + (yy || 1.5) + .12, z }, rot)); const f = rot.ry || 0; aq(M.lit, rect, w, h, x + Math.sin(f) * .011, yd + (yy || 1.5) + .12, z + Math.cos(f) * .011, rot); };
    signPost(-58, zn + .02, ART.nodive, .5, .5, S_); signPost(-91, zs - .02, ART.nodive, .5, .5, N_); signPost(-104, zn + .02, ART.nodive, .5, .5, S_); signPost(-12.3, zn + .02, ART.pierrules, .52, .65, { ry: PI - .5 }, 1.55);
    // ---- life ring station, bench
    P(-66.6, yd, zn - .02); B(wd, .1, 1.0, .06, 0, 1.6, 0, .008); sb(0xb8352a, .56, .66, .02, 0, 1.72, -.045, { bevel: .006 }); stor(0xd9552c, .2, .05, 0, 1.72, -.1, { seg: 8, seg2: 22 }); for (let i = 0; i < 4; i++) sgeo(new T.TorusGeometry(.2, .052, 8, 5, .4).rotateZ(i * HP + .6), 0xe9e6dc, 0, 1.72, -.1); stor(0xd9d2bc, .12, .012, 0, 1.42, -.07, { seg: 5, seg2: 14 }); stor(0xd9d2bc, .11, .012, .01, 1.42, -.085, { seg: 5, seg2: 14 }); Q();
    { P(-55.6, yd, zn - .45, { ry: PI }); for (const k of [-1, 1]) { B(gv, .05, .44, .4, k * .7, .22, 0, .008); bar(gv, [k * .7, .42, -.18], [k * .7, .9, -.26], .045); } for (let i = 0; i < 4; i++) B(wd, 1.7, .03, .09, 0, .455, -.15 + i * .1, .006); for (let i = 0; i < 3; i++) B(wd, 1.7, .09, .025, 0, .6 + i * .12, -.215 - i * .02, .006, { rx: -.16 }); Q(); box(-56.5, zn - .72, -54.7, zn - .2, .9, 'pier-bench'); }
    // ---- tackle clutter + cast net + a forgotten cap
    ss(0x5a5f52, .22, -86.5, yd + .03, zn - .5, { s: [1.3, .28, 1], seg: 12, seg2: 6 }); for (let i = 0; i < 9; i++) ss(0xb8a07a, .022, -86.5 + Math.cos(i * .7) * .3, yd + .03, zn - .5 + Math.sin(i * .7) * .22, { seg: 6, seg2: 4 });
    sc(0x23304a, .09, .095, .06, -74.4, RT + .06, zs, { seg: 12 }); sb(0x23304a, .12, .008, .1, -74.4, RT + .035, zs + .1);
    for (let i = 0; i < 7; i++) dec('water_stain', R(1.2, 2.4), R(1, 1.8), R(-105, -16), yd + .004, pz + R(-1.3, 1.3), R(0, TAU)); dec('gum_spots', 2, 2, -30, yd + .004, pz, 0); dec('gum_spots', 2, 2, -68, yd + .004, pz + .3, 1);
    // ---- gulls: on the rails, the table and one lamp
    gull(-61.9, RT, zs, 2.3); gull(-68.4, RT, zn, .4, 1.05); gull(-68.75, RT, zn, -.9); gull(-79.25, yd + 1.28, zs + .14, PI + .4); gull(-86.3, RT, zn, 1.2); gull(-95, RT, zs, -2.2, 1.1); gull(-101.3, RT, zs, 2.9); gull(-68, yd + 3.71, zn, 1.9); gull(-46, yd + 3.71, zn, -.6); gull(-109.52, yd + 1.1, pz + 3.3, -HP);
    const pe = { x: -117.92, y: yd, z: pz + 3.1, h: -HP }; anchor('pierEnd', pe); anchor('pierDeck', { x: -14, y: yd, z: pz, h: -HP });
  }

  /* ================================================================== 5. BACKYARD RING — lot D, between two mobile homes  (120, 63.8) */
  /** metal folding chair. state: 0 upright, 1 folded (leaning), 2 knocked over and bent */
  function foldChair(x, z, ry, hex, state) { const o = { ry }; if (state === 1) { o.rx = -.22; } if (state === 2) { o.rz = HP - .08; o.rx = .2; }
    P(x, state === 2 ? .23 : 0, z, o); const M_ = { metal: true }, leg = (a, b) => srod(0x8f9294, a, b, .011, 6, M_);
    if (state === 1) { for (const s of [-1, 1]) { leg([s * .2, 0, 0], [s * .2, .92, .03]); leg([s * .19, .02, .04], [s * .19, .8, .05]); } sb(hex, .4, .4, .02, 0, .42, .04, { bevel: .008, rx: HP - .04, metal: true }); sb(hex, .4, .2, .02, 0, .82, .03, { bevel: .008, metal: true }); Q(); return; }
    for (const s of [-1, 1]) { leg([s * .2, 0, .24], [s * .2, .88, -.2]); leg([s * .19, 0, -.22], [s * .19, .45, .18]); leg([s * .2, .16, .16], [s * .2, .16, -.14]); } leg([-.2, .06, .22], [.2, .06, .22]); leg([-.19, .06, -.2], [.19, .06, -.2]);
    sb(hex, .4, .022, .39, 0, .45, .0, { bevel: .01, metal: true, rx: state === 2 ? .25 : .03 }); sb(hex, .4, .2, .022, 0, .78, -.165, { bevel: .01, rx: -.2, metal: true }); Q(); }
  function tyreStack(x, z, n, R_) { for (let i = 0; i < n; i++) K.geo(mt('rubber', { tread: true }), new T.TorusGeometry(R_ * .68, R_ * .32, 10, 20), { x: x + (i % 2) * .03, y: R_ * .32 + i * R_ * .62, z: z + (i % 2) * .02, rx: HP }); }
  function buildRing() {
    const cx = 120, cz = 63.8, r = GT.rng('ring'), R = (a, b) => a + (b - a) * r(), gv = 'metal_galv', wd = 'wood_plank', H = 2.2, CY = .78, lbox = (a, b, c, d, h, tag) => box(cx + a, cz + b, cx + c, cz + d, h, tag);
    P(cx, 0, cz);
    // ---- worn ground
    drift(.2, .0, -.1, 5.6, 5.2, .03, .3, 'dirt'); drift(-5.2, 0, .3, 2.6, 1.6, .025, 0, 'dirt'); drift(1.5, 0, 4.6, 2.2, 1.5, .02, .5, 'dirt'); dec('water_stain', 5, 4, -3.5, .04, 1, 1.2); dec('leak', 3, 3, 4.4, .014, 4.6, 0); dec('water_stain', 5, 4, 2, .013, -4.4, 2.2);
    // ---- the ring: pipe posts, pallet-and-tyre platform, sagging canvas, apron, three taped ropes, mismatched pads
    const hs = 2.2; for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { C(gv, .055, .06, H, sx * hs, H / 2, sz * hs, { seg: 12 }); C(gv, .11, .11, .014, sx * hs, .007, sz * hs, { seg: 12 }); sc(0x1c1c1e, .058, .058, .03, sx * hs, H + .01, sz * hs, { seg: 12 }); wdec('rust_run', .1, .7, sx * hs, .5, sz * hs + .058, N_); post(cx + sx * hs, cz + sz * hs, .1, H, 'ring-post'); }
    for (const s of [-1, 1]) { B(wd, 4.5, .19, .05, 0, CY - .13, s * 2.2, .008); B(wd, .05, .19, 4.4, s * 2.2, CY - .13, 0, .008); } for (let i = -3; i <= 3; i++) B(wd, .05, .14, 4.4, i * .62, CY - .12, 0, 0); B(wd, 4.44, .03, 4.44, 0, CY - .035, 0, 0);
    for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5], [0, 0], [0, -1.6], [0, 1.6]]) tyreStack(x, z, 2, .34); for (const [x, z] of [[-2.05, 0], [2.05, 0], [-1.0, 2.05], [1.0, 2.05], [-1, -2.05], [1, -2.05]]) { B('cinderblock', .39, .19, .19, x, .095, z, .008); B('cinderblock', .19, .19, .39, x, .285, z, .008); B('cinderblock', .39, .19, .19, x, .475, z, .008); }
    { const g = new T.PlaneGeometry(4.5, 4.5, 14, 14), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), e = (1 - Math.pow(x / 2.25, 2)) * (1 - Math.pow(y / 2.25, 2)); p.setZ(i, -.07 * e + Math.sin(x * 5.1 + y * 2.3) * .006 * e); } g.computeVertexNormals(); KG.geo(M.lit, remap(g, ART.canvas), { y: CY + .012, rx: -HP }); sb(0x35506e, 4.46, .05, 4.46, 0, CY - .085, 0, {}); }
    aq(M.lit, ART.apron, 4.4, .62, 0, CY - .33, -2.235, S_); aq(M.lit, ART.apron, 4.4, .62, -2.235, CY - .33, 0, W_); for (let i = 0; i < 3; i++) sb(0x17181a, .02, .62 - i * .05, 1.2, 2.235, CY - .33 + i * .02, -1.5 + i * 1.3, { rx: (i - 1) * .03 }); sb(0x17181a, 1.6, .62, .02, -1.3, CY - .33, 2.235, { rz: .02 }); sb(0x17181a, 1.1, .34, .02, 1.5, CY - .2, 2.24, { rz: -.25 });
    const ROPE = [[CY + .45, 0x2c4670], [CY + .8, 0xc9c4b4], [CY + 1.15, 0x962a24]], PADS = [[0x962a24, 0x962a24, 0x962a24], [0x23406a, 0x17181a, 0x23406a], [0x17181a, 0x962a24, 0], [0xc9a12c, 0x23406a, 0x23406a]];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach((c, ci) => { const n = [[1, -1], [1, 1], [-1, 1], [-1, -1]][ci], ax = c[0] * hs, az = c[1] * hs, bx = n[0] * hs, bz = n[1] * hs, dx = Math.sign(bx - ax), dz = Math.sign(bz - az);
      ROPE.forEach((rp, ri) => { const y = rp[0], a = [ax + dx * .3, y, az + dz * .3], b = [bx - dx * .3, y, bz - dz * .3]; stube(rp[1], sag(a, b, .035 + ri * .012 + r() * .02, 6), .021, { seg: 7, steps: 14 }); rod(gv, [ax, y, az], a, .012, 6); rod(gv, [bx, y, bz], b, .012, 6); sc(0x8f9294, .02, .02, .1, ax + dx * .16, y, az + dz * .16, { seg: 6, rx: dz ? HP : 0, rz: dx ? HP : 0, metal: true });
        const pc = PADS[ci][ri]; if (pc) sb(pc, .27, .25, .27, ax - c[0] * .17, y, az - c[1] * .17, { bevel: .06, ry: PI / 4 }); });
      for (const t of [.33, .67]) srod(0xd9d5c8, [lerp(ax, bx, t), ROPE[0][0] - .02, lerp(az, bz, t)], [lerp(ax, bx, t), ROPE[2][0] - .03, lerp(az, bz, t)], .008, 5); });
    sb(0xc9a12c, .26, .24, .26, 2.9, .13, 2.75, { bevel: .05, ry: .5, rz: .3 });   // the missing pad
    for (const s of [-1, 1]) lbox(-2.3, s * 2.2 - .1, 2.3, s * 2.2 + .1, 2.1, 'ring-ropes'), lbox(s * 2.2 - .1, -2.3, s * 2.2 + .1, 2.3, 2.1, 'ring-ropes'); plat(cx - 2.15, cz - 2.15, cx + 2.15, cz + 2.15, CY, 'ring');
    B('cinderblock', .39, .19, .19, -2.6, .095, .4, .008); B('cinderblock', .39, .19, .19, -2.6, .095, .0, .008); B('cinderblock', .39, .19, .19, -2.58, .285, .2, .008, { ry: .06 }); PLX(wd, 1.0, .04, .3, -2.62, .4, .2, .006, { ry: HP });
    // ---- yard fence: corrugated sheets (north), pallets (south), chain-link (east + west with a gap for the gate)
    const fx = 6.5, fz0 = -6.4, fz1 = 6.6, cor = 'corrugated_metal';
    for (let i = 0; i < 13; i++) { const x = -fx + .5 + i * 1.0, hh = 1.75 + (r() - .5) * .25; B(cor, .98, hh, .03, x, hh / 2 + .02, fz1 + (r() - .5) * .04, 0, { rz: (r() - .5) * .04, rx: (r() - .5) * .05 }); if (i % 2 === 0) PLX(wd, 2.0, .09, .09, x - .5, .95, fz1 - .07, .008, { rz: HP }); } PLX(wd, 13, .04, .09, 0, 1.3, fz1 - .06, .006); wdec('graffiti_a', 3.2, 1.5, 2.2, .95, fz1 - .03, S_); wdec('rust_run', .6, 1.2, -3, 1.0, fz1 - .03, S_); wdec('rust_run', .7, 1.3, .2, 1.05, fz1 - .03, S_); wdec('rust_run', .5, 1.1, 4.6, 1.1, fz1 - .03, S_); wdec('grime_streak', 4, .6, -2, .3, fz1 - .03, S_); lbox(-fx, fz1 - .1, fx, fz1 + .1, 1.9, 'ring-fence');
    for (let i = 0; i < 11; i++) { const x = -fx + .6 + i * 1.2; P(x, 0, fz0, { rx: (r() - .5) * .08, ry: (r() - .5) * .06 }); for (let k = 0; k < 7; k++) PLX(wd, 1.18 + (i % 3) * .1, .02, .1, -.51 + k * .17, .62 + (i % 3) * .05, 0, .004, { rz: HP, ry: HP }); for (const yy of [.12, .62, 1.1]) PLX(wd, 1.16, .09, .04, 0, yy, .03, .004); Q(); } lbox(-fx, fz0 - .1, fx, fz0 + .1, 1.3, 'ring-fence'); wdec('graffiti_b', 2.4, 1.1, -3.4, .7, fz0 + .06, N_);
    // ---- banner between two poles, festoons, work light, extension cord
    Q();
    linkFence(cx + fx, cz + fz0, cx + fx, cz + fz1, 1.8, 0, { span: 2.2, tag: 'ring-fence' }); linkFence(cx - fx, cz + fz0, cx - fx, cz - 1.5, 1.8, 0, { span: 2.4, tag: 'ring-fence' }); linkFence(cx - fx, cz + 1.7, cx - fx, cz + fz1, 1.8, 0, { span: 2.4, tag: 'ring-fence' });
    const W = (x, y, z) => [cx + x, y, cz + z];
    for (const z of [-2.75, 2.75]) { C(wd, .05, .065, 3.9, cx + 6.15, 1.9, cz + z, { seg: 8 }); post(cx + 6.15, cz + z, .08, 3.8, 'ring-pole'); } for (const p of [[-6.2, -6.0], [-6.2, 6.2]]) { C(wd, .05, .065, 3.7, cx + p[0], 1.8, cz + p[1], { seg: 8 }); post(cx + p[0], cz + p[1], .08, 3.6, 'ring-pole'); }
    aq(M.lit, ART.ringbanner, 5.0, 1.25, cx + 6.1, 2.72, cz, { ry: -HP, rx: 0 }, true); for (const s of [-1, 1]) for (const yy of [2.15, 3.3]) rod('rubber', W(6.1, yy, s * 2.46), W(6.15, yy + (yy > 3 ? .12 : -.1), s * 2.75), .005, 4);
    const WARM = [[1, .74, .42]]; festoon(W(6.15, 3.72, 2.75), W(-6.2, 3.55, 6.2), .55, .42, WARM); festoon(W(6.15, 3.72, -2.75), W(-6.2, 3.55, -6.0), .55, .42, WARM); festoon(W(-6.2, 3.6, -6.0), W(-6.2, 3.6, 6.2), .6, .42, WARM); festoon(W(6.15, 3.8, -2.75), W(6.15, 3.8, 2.75), .2, .42, WARM);
    P(cx, 0, cz);
    { const x = 4.7, z = -4.5; for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + .4; srod(0x2a2c30, [x + Math.cos(a) * .5, 0, z + Math.sin(a) * .5], [x, .9, z], .012, 5); } srod(0x2a2c30, [x, .6, z], [x, 1.95, z], .014, 6); sb(0x2a2c30, .5, .03, .03, x, 1.95, z, { ry: .8 });
      for (const s of [-1, 1]) { P(x + s * .17, 1.98, z - s * .17, { ry: -.78 + PI, rx: .35 }); sb(0xd9a514, .22, .17, .1, 0, .08, 0, { bevel: .015 }); K.box('light_warm', .19, .14, .01, 0, .08, .052); sb(0x2a2c30, .24, .19, .02, 0, .08, .058, {}); Q(); }
      stube(0xc8601c, [[x, .02, z + .5], [x - .8, .02, z - .6], [x - 2.5, .02, z - 1.3], [x - 4, .02, z - 1.7], [x - 6.5, .02, z - 1.85]], .008, { seg: 4, steps: 30 }); post(cx + x, cz + z, .2, 2, 'ring-worklight'); }
    // ---- camera on a tripod at ringside
    { const x = -3.5, z = -3.35; for (let i = 0; i < 3; i++) { const a = i * TAU / 3; srod(0x1c1c1e, [x + Math.cos(a) * .42, 0, z + Math.sin(a) * .42], [x, 1.18, z], .011, 5); } srod(0x1c1c1e, [x, 1.0, z], [x, 1.36, z], .013, 6); P(x, 1.4, z, { ry: .82 }); sb(0x1c1c1e, .08, .03, .1, 0, -.02, 0); sb(0x2a2c30, .1, .12, .26, 0, .06, 0, { bevel: .015 }); sc(0x111111, .04, .045, .09, 0, .06, .17, { rx: HP, seg: 12 }); sc(0x334a66, .034, .034, .004, 0, .06, .216, { rx: HP, seg: 12, metal: true }); sb(0x1c1c1e, .03, .04, .09, .05, .13, -.1); sb(0x1c1c1e, .012, .1, .08, -.065, .08, .0, { ry: .5 }); srod(0x1c1c1e, [0, -.03, -.05], [.2, -.12, -.3], .007, 4); bulb(.03, .125, .13, [1, .05, .03], .22); Q(); post(cx + x, cz + z, .25, 1.5, 'ring-camera'); }
    // ---- seating, cooler, broken table, grill, ladder, bin, cans
    const CH = [0x8a8478, 0x6f7376, 0x8a8478, 0x5a4a3a];
    [[-4.3, -.9, HP + .1], [-4.4, .1, HP - .15], [-4.25, 1.15, HP + .25], [-5.3, -.4, HP], [-5.2, .8, HP - .1], [-1.2, -4.0, .1], [-.2, -4.1, -.1], [1.0, -3.95, .2], [.2, 4.0, PI + .15], [1.4, 4.15, PI - .2]].forEach((c, i) => foldChair(c[0], c[1], c[2], CH[i % 4], 0));
    foldChair(6.25, 4.6, -HP, CH[1], 1); foldChair(6.28, 5.1, -HP, CH[0], 1); foldChair(3.2, -2.9, .7, CH[2], 2); sb(0xb8962c, .2, .13, .012, -.2, .475, -4.1, { rx: -HP + .05, metal: true }); sb(0x17181a, .7, .1, .008, -.2, .47, -4.1, { rx: -HP + .05 });
    P(-4.6, 0, 3.3, { ry: .3 }); sb(0xa3231c, .62, .36, .36, 0, .2, 0, { bevel: .03 }); sb(0xe6e2d6, .64, .07, .38, 0, .415, 0, { bevel: .025 }); sb(0xe6e2d6, .05, .03, .2, .34, .3, 0); for (const [x, z, c] of [[-.18, .05, 0xb8bcc0], [.02, -.06, 0xb03a26], [.2, .08, 0xb8bcc0]]) sc(c, .033, .033, .12, x, .51, z, { seg: 10, metal: true }); Q(); lbox(-4.95, 3.05, -4.25, 3.55, .5, 'ring-cooler');
    sb(0xe9e7de, .5, .3, .34, -3.9, .16, 3.9, { bevel: .03, ry: -.4 }); sb(0xdedbd0, .52, .05, .36, -3.9, .34, 3.9, { bevel: .02, ry: -.4 });
    { P(3.6, 0, 3.3, { ry: -.5 }); for (const s of [-1, 1]) { sb(0xd6d3c8, .88, .035, .72, s * .4, .5, 0, { bevel: .012, rz: s * .42 }); srod(0x8f9294, [s * .72, 0, .28], [s * .66, .66, .28], .012, 5, { metal: true }); srod(0x8f9294, [s * .72, 0, -.28], [s * .66, .66, -.28], .012, 5, { metal: true }); srod(0x8f9294, [s * .72, .05, .28], [s * .72, .05, -.28], .012, 5, { metal: true }); } Q(); lbox(2.8, 2.7, 4.4, 3.9, .7, 'ring-table'); }
    { const x = 5.1, z = 5.2; K.geo('metal_dark', new T.CylinderGeometry(.29, .29, .86, 16, 1, false, 0, PI).rotateZ(HP).rotateY(.3), { x, y: .8, z }); for (const [a, b] of [[-.3, -.2], [.3, -.2], [-.3, .2], [.3, .2]]) rod('metal_dark', [x + a * 1.15, 0, z + b * 1.2], [x + a, .76, z + b * .6], .014, 5); B(gv, .8, .012, .5, x, .81, z, 0, { ry: .3 }); wdec('rust_run', .5, .3, x, .68, z + .3, N_); post(cx + x, cz + z, .45, .9, 'ring-grill'); }
    { const x = 2.95, z = -5.3, al = 'aluminium_brushed'; for (const s of [-1, 1]) { bar(al, [x + s * .26, 0, z + .5], [x + s * .2, 1.85, z], .05, .025); bar(al, [x + s * .26, 0, z - .5], [x + s * .2, 1.85, z], .04, .02); } for (let i = 1; i < 6; i++) { const t = i / 6.2; B(al, .5 - t * .1, .025, .07, x, t * 1.85, z + .5 * (1 - t), .004); } sb(0xb03a26, .46, .04, .16, x, 1.86, z, { bevel: .01 }); post(cx + x, cz + z, .35, 1.8, 'ring-ladder'); }
    C(gv, .26, .23, .7, -5.6, .35, -5.4, { seg: 16 }); for (const yy of [.15, .35, .55]) C(gv, .268, .268, .025, -5.6, yy, -5.4, { seg: 16 }); C(gv, .29, .29, .03, -4.9, .03, -5.5, { seg: 16, rx: .08 }); sc(0x1c1c1e, .24, .2, .1, -5.6, .72, -5.4, { seg: 12 }); post(cx - 5.6, cz - 5.4, .28, .8, 'ring-bin');
    for (let i = 0; i < 16; i++) { const x = R(-5.5, 5.5), z = R(-5.5, 5.5); if (Math.abs(x) < 2.5 && Math.abs(z) < 2.5) continue; if (r() < .6) sc([0xb8bcc0, 0xb03a26, 0x2f6f4a][i % 3], .033, .033, .12, x, .034, z, { rz: HP, ry: R(0, TAU), seg: 8, metal: true }); else sc(0xb5202a, .045, .032, .11, x, .045, z, { rz: HP + .1, ry: R(0, TAU), seg: 10, open: true }); }
    tyreStack(-5.7, 5.6, 3, .36); tyreStack(5.6, -5.6, 1, .36);
    // ---- gate: hand-lettered price card
    PLX(wd, 1.5, .04, .07, -6.45, .72, -1.95, .004, { rz: HP }); aq(M.lit, ART.card, .56, .42, -6.48, 1.2, -1.95, { ry: -HP, rz: .04 }, true);
    spill(11, 11, 0, .03, 0);
    const AN = [[-3.7, 0, HP], [0, -3.7, 0], [3.7, 0, -HP], [0, 3.7, PI]]; Q();
    AN.forEach((a, i) => anchor('ringSide' + i, { x: cx + a[0], y: 0, z: cz + a[1], h: a[2] })); anchor('ringCentre', { x: cx, y: CY, z: cz, h: -HP, size: 4.4, ropeY: CY + 1.15 }); anchor('ringGate', { x: cx - 7.4, y: 0, z: cz + .1, h: HP });
    S.lights.ring = [new T.PointLight(0xffb878, 0, 17, 1.5), 1.5]; S.lights.ring[0].position.set(cx + .5, 3.3, cz);
  }

  /* ================================================================== 6. SHOP-FRONT CORNER — along the store's south wall from its south-west corner */
  function bike(x, z, ry, lean, R_, hex, cruiser) { P(x, 0, z, { ry, rz: lean }); const wb = cruiser ? .56 : .46, M_ = { metal: true }, fr = (a, b, rad) => srod(hex, a, b, rad || .016, 7, M_), st = (a, b, rad) => srod(0xa9adb0, a, b, rad || .006, 5, M_), bbY = R_ - .04, seatY = cruiser ? .92 : .74, headY = cruiser ? 1.0 : .82;
    for (const s of [-1, 1]) { const wz = s * wb; K.geo(M.rub, new T.TorusGeometry(R_ - .022, .024, 8, 26), { y: R_, z: wz, ry: HP }); sgeo(new T.TorusGeometry(R_ - .05, .009, 5, 26), 0xb4b8bc, 0, R_, wz, { ry: HP, metal: true }); sc(0x8f9294, .022, .022, .09, 0, R_, wz, { rz: HP, seg: 8, metal: true }); for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; st([(i % 2 ? .03 : -.03), R_, wz], [0, R_ + Math.sin(a) * (R_ - .05), wz + Math.cos(a) * (R_ - .05)], .0025); } }
    const bb = [0, bbY, -.06], seat = [0, seatY - .08, -.22], head = [0, headY - .1, wb - .2], headT = [0, headY, wb - .23];
    fr(bb, seat, .017); fr(seat, headT, .016); fr(bb, head, .019); fr(head, headT, .02); fr(bb, [0, R_, -wb], .011); fr(seat, [0, R_, -wb], .01); fr(head, [.0, R_, wb], .013); st(seat, [0, seatY, -.24], .012); st(headT, [0, headY + .12, wb - .26], .012);
    sb(0x1c1c1e, .15, .05, .27, 0, seatY + .02, -.25, { bevel: .02 }); stube(0xa9adb0, cruiser ? [[-.3, headY + .2, wb - .42], [-.22, headY + .16, wb - .28], [0, headY + .12, wb - .26], [.22, headY + .16, wb - .28], [.3, headY + .2, wb - .42]] : [[-.3, headY + .3, wb - .25], [-.2, headY + .3, wb - .25], [-.1, headY + .12, wb - .26], [.1, headY + .12, wb - .26], [.2, headY + .3, wb - .25], [.3, headY + .3, wb - .25]], .011, { seg: 6, steps: 18, metal: true });
    for (const s of [-1, 1]) sc(0x1c1c1e, .017, .017, .1, s * (cruiser ? .29 : .27), headY + (cruiser ? .2 : .3), wb - (cruiser ? .41 : .25), { rz: HP, seg: 8 });
    sc(0x8f9294, .085, .085, .006, .045, bbY, -.06, { rz: HP, seg: 18, metal: true }); st([.05, bbY, -.06], [.07, bbY - .15, -.02], .008); st([-.05, bbY, -.06], [-.07, bbY + .15, -.1], .008); sb(0x1c1c1e, .09, .02, .06, .11, bbY - .15, -.02); sb(0x1c1c1e, .09, .02, .06, -.11, bbY + .15, -.1); st([.045, bbY + .08, -.06], [.045, R_ + .03, -wb], .004); st([.045, bbY - .08, -.06], [.045, R_ - .03, -wb], .004);
    if (cruiser) { for (const s of [-1, 1]) sgeo(new T.TorusGeometry(R_ + .012, .022, 4, 14, PI * .62).rotateZ(s > 0 ? .25 : .55), 0xd8d2c0, 0, R_, s * wb, { ry: -HP, s: [1, 1, .35] }); for (const [a, b] of [[-.16, .16], [.16, .16], [-.16, -.0], [.16, -.0]]) st([a, headY + .02, wb + .1 + b], [a, headY + .24, wb + .1 + b], .004); sb(0x6f7376, .34, .01, .2, 0, headY + .02, wb + .18, { metal: true }); for (const yy of [.12, .24]) { sb(0x6f7376, .34, .008, .008, 0, headY + yy, wb + .1); sb(0x6f7376, .34, .008, .008, 0, headY + yy, wb + .26); sb(0x6f7376, .008, .008, .17, -.17, headY + yy, wb + .18); sb(0x6f7376, .008, .008, .17, .17, headY + yy, wb + .18); } }
    else for (const s of [-1, 1]) sc(0x8f9294, .017, .017, .09, s * .08, R_, -wb, { rz: HP, seg: 8, metal: true });
    Q(); }
  function buildCorner() {
    const ST = GT.L.station.store, wz = ST.z0, cx = 56, r = GT.rng('corner'), R = (a, b) => a + (b - a) * r(), gv = 'metal_galv', FY = .15, x0 = 49.9, x1 = 62.4, zf = wz - 2.35;
    B('concrete', x1 - x0, .5, 2.35, (x0 + x1) / 2, FY - .25, wz - 1.175, .015); plat(x0, zf, x1, wz, FY, 'corner-pad'); for (let x = x0 + 2.05; x < x1 - .5; x += 2.08) sb(0x4a4945, .012, .004, 2.33, x, FY + .002, wz - 1.17);
    sb(0xb8a02a, x1 - x0, .012, .1, (x0 + x1) / 2, FY - .05, zf - .003, {}); // faded yellow kerb face
    dec('gum_spots', 1.3, 1.1, 54.4, FY + .004, wz - 1.3, 0); dec('gum_spots', 1.2, 1.1, 58.6, FY + .004, wz - 1.2, 1.4); dec('crack', 2.2, 2.2, 60.8, FY + .004, wz - 1.2, .5); dec('oil_stain', 1.6, 1.6, 51, .014, zf - 1.2, 0); dec('water_stain', 2.6, 1.6, 55.2, FY + .005, wz - .9, 0); dec('leak', 1.3, 1.6, 54.3, FY + .006, wz - 1.2, 0); dec('puddle', .5, .36, 57.2, FY + .006, wz - .5, .4);
    P(cx, FY, wz, { ry: PI });   // local +Z points south (away from the wall), local +X points WEST
    const LX = x => cx - x, LZ = z => wz - z, lbox = (a, b, c, d, h, tag) => box(LX(a), LZ(b), LX(c), LZ(d), h, tag);
    // ---- lean-to canopy with a tube light
    { const xa = -2.25, xb = 2.55; for (const x of [xa + .05, xb - .05]) { B(gv, .07, 2.5, .07, x, 1.25, 2.1, .008); B(gv, .2, .015, .2, x, .008, 2.1, .003); lbox(x - .08, 2.02, x + .08, 2.18, 2.5, 'corner-post'); wdec('rust_run', .1, .5, x, .35, 2.137, N_); }
      B(gv, xb - xa, .07, .05, (xa + xb) / 2, 2.52, 2.1, .006); B(gv, xb - xa, .07, .05, (xa + xb) / 2, 2.8, .04, .006); for (let x = xa + .05; x <= xb; x += (xb - xa - .1) / 4) bar(gv, [x, 2.8, .04], [x, 2.52, 2.1], .045);
      K.geo('corrugated_metal', GT.boxGeo(xb - xa + .3, .03, 2.4, 0), { x: (xa + xb) / 2, y: 2.72, z: 1.18, rx: .135 }); B(gv, xb - xa + .3, .08, .09, (xa + xb) / 2, 2.52, 2.38, .01); rod(gv, [xa - .1, 2.5, 2.38], [xa - .1, .05, 2.3], .03, 7);
      for (const x of [-1.0, 1.3]) { sb(0xdedbd0, 1.3, .05, .14, x, 2.58, 1.2, { bevel: .01 }); K.cyl('light_cool', .016, .016, 1.22, x, 2.545, 1.2, { rz: HP, seg: 8 }); } wdec('water_stain', 3, .8, (xa + xb) / 2, 2.45, .02, N_); }
    // ---- drink machine "TIDAL"
    { P(1.7, 0, .47); sb(0x0e4654, 1.0, 1.84, .84, 0, .94, 0, { bevel: .03 }); sb(0x16181a, 1.02, .1, .86, 0, .05, 0, {}); sb(0x0a3340, .94, 1.72, .03, 0, .95, .42, { bevel: .01 }); aq(M.self, ART.vend, .82, 1.366, -.02, 1.07, .437, N_);
      sb(0x0c0d0e, .56, .2, .05, -.13, .26, .425, { bevel: .01 }); sb(0x1e2224, .5, .15, .02, -.13, .25, .452, { rx: .25 }); aq(M.glow, ART.lcd, .13, .05, .27, 1.3, .44, N_); sb(0xb8bcc0, .08, .1, .012, .27, 1.16, .44, { metal: true }); sb(0x101112, .05, .008, .014, .27, 1.17, .446); sb(0x1b1d1f, .1, .07, .02, .27, 1.02, .44, { bevel: .005 }); bulb(.3, 1.02, .455, [.2, 1, .4], .16);
      sb(0xb8bcc0, .03, .2, .03, .44, 1.0, .43, { metal: true }); sb(0x8f9294, .9, .05, .7, 0, 1.875, -.02, {}); wdec('rust_run', .5, .45, -.2, .26, .425, N_); wdec('grime_streak', .8, .5, 0, .3, -.0, N_); for (const s of [-1, 1]) KG.quad(GT.decalMat('grime_streak'), .8, 1.2, s * .503, .7, 0, { ry: s * HP }); Q();
      const p = wp(1.7, 0, 1.55); anchor('vendDrink', { x: p[0], y: p[1], z: p[2], h: 0, machine: wp(1.7, 0, .47), price: 1.5 }); }
    // ---- snack machine "MUNCH BOX": product rows behind glass
    { P(.56, 0, .47); const cab = 0x26282b; sb(cab, 1.0, .42, .86, 0, .21, 0, { bevel: .02 }); sb(cab, 1.0, 1.84, .5, 0, .92, -.18, { bevel: .02 }); sb(cab, 1.0, .3, .86, 0, 1.69, 0, { bevel: .02 }); sb(cab, .05, 1.84, .86, -.475, .92, 0, { bevel: .01 }); sb(cab, .05, 1.84, .86, .475, .92, 0, { bevel: .01 }); sb(cab, .26, 1.84, .86, .345, .92, 0, { bevel: .01 });
      aq(M.self, ART.snackhead, .92, .23, 0, 1.69, .433, N_); sb(0xe9e6dc, .68, 1.1, .01, -.12, .98, .075, {}); K.cyl('light_cool', .012, .012, .62, -.12, 1.51, .36, { rz: HP, seg: 6 });
      const PC = [0xc8a02c, 0xb8352a, 0x2f6f8a, 0x3d8a4a, 0xd9772c, 0x6a3f8a, 0xe6e2d6, 0x8a4a2a, 0xd8433a, 0x1f4a78];
      for (let row = 0; row < 6; row++) { const y = .5 + row * .168; sb(0x8f9294, .68, .008, .3, -.12, y - .004, .23, { metal: true }); sb(0xe6e2d6, .68, .022, .004, -.12, y + .006, .385);
        for (let c = 0; c < 6; c++) { const x = -.41 + c * .116, col = PC[(row * 3 + c * 7 + ((r() * 3) | 0)) % PC.length], bag = row < 3; for (let d = 0; d < 3; d++) { if (d === 0 && r() < .12) continue; if (bag) sb(col, .09, .125, .022, x, y + .066, .345 - d * .075, { bevel: .008, rx: -.12 }); else sb(col, .085, .045 + (row % 2) * .05, .06, x, y + .024 + (row % 2) * .025, .34 - d * .078, { bevel: .006 }); } sgeo(new T.TorusGeometry(.03, .003, 4, 10), 0xb4b8bc, x, y + .045, .375, { metal: true }); } }
      K.box('glass_clear', .7, 1.12, .012, -.12, .98, .425); sb(0x111213, .72, .03, .03, -.12, 1.545, .425); sb(0x111213, .72, .03, .03, -.12, .415, .425); sb(0x16181a, .7, .16, .03, -.12, .26, .43, { bevel: .01 }); sb(0x2a2c30, .6, .1, .012, -.12, .26, .448, { rx: .2 });
      sb(0x16181a, .2, .5, .02, .345, 1.12, .432, { bevel: .008 }); for (let i = 0; i < 12; i++) sb(0xc9c6bc, .034, .028, .012, .3 + (i % 3) * .045, 1.18 - ((i / 3) | 0) * .04, .445, { bevel: .004 }); aq(M.glow, ART.lcd, .13, .05, .345, 1.3, .445, N_); sb(0xb8bcc0, .07, .09, .012, .345, .98, .444, { metal: true }); bulb(.39, .93, .452, [1, .3, .1], .14);
      KG.geo(M.lit, remap(new T.PlaneGeometry(.8, 1.7), ART.snackside), { x: -.502, y: .95, z: 0, ry: -HP }); wdec('grime_streak', .9, .5, 0, .25, .432, N_); Q();
      const p = wp(.56, 0, 1.55); anchor('vendSnack', { x: p[0], y: p[1], z: p[2], h: 0, machine: wp(.56, 0, .47), price: 1.25 }); }
    // ---- claw machine "LUCKY GRAB"
    { P(-.5, 0, .45); const pu = 0x4f2c7a; sb(pu, .82, .78, .8, 0, .39, 0, { bevel: .025 }); aq(M.lit, ART.clawbase, .74, .52, 0, .4, .402, N_); sb(0x1b1c1f, .82, .09, .34, 0, .82, .23, { bevel: .015, rx: .28 }); srod(0x1b1c1f, [-.14, .86, .25], [-.15, .96, .27], .008, 6); ss(0xb8352a, .024, -.15, .975, .273, { seg: 10, seg2: 8 }); sc(0xd9a514, .028, .028, .014, .1, .872, .27, { rx: .28, seg: 12 }); sb(0xb8bcc0, .06, .08, .012, .26, .86, .29, { rx: .28, metal: true });
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) sb(pu, .05, .82, .05, a * .385, 1.27, b * .375, { bevel: .008 }); sb(pu, .82, .28, .8, 0, 1.82, 0, { bevel: .025 }); aq(M.self, ART.clawhead, .76, .23, 0, 1.82, .402, N_); sb(0xdedbd0, .7, .012, .68, 0, 1.672, 0); K.cyl('light_warm', .012, .012, .6, 0, 1.655, .28, { rz: HP, seg: 6 });
      K.box('glass_clear', .72, .8, .01, 0, 1.27, .38); K.box('glass_clear', .01, .8, .7, -.39, 1.27, 0); K.box('glass_clear', .01, .8, .7, .39, 1.27, 0); sb(0x23406a, .72, .8, .01, 0, 1.27, -.38); sb(0x9aa0a4, .74, .02, .72, 0, .87, 0);
      const PL = [0xd98fa4, 0x8fc4d9, 0xe6d27a, 0x9ad98f, 0xd9a58f, 0xb89ad9, 0xe6e2d6]; for (let i = 0; i < 22; i++) { const x = R(-.3, .3), z = R(-.28, .28), y = .93 + r() * .12 + (i > 14 ? .1 : 0), c = PL[i % PL.length], s = .06 + r() * .025; ss(c, s, x, y, z, { seg: 8, seg2: 6 }); ss(c, s * .6, x + R(-.03, .03), y + s * .9, z + R(-.03, .03), { seg: 6, seg2: 5 }); }
      srod(0xb4b8bc, [.12, 1.66, .05], [.12, 1.42, .05], .006, 5, { metal: true }); sc(0x8f9294, .03, .03, .04, .12, 1.41, .05, { seg: 8, metal: true }); for (let i = 0; i < 3; i++) { const a = i * TAU / 3; stube(0xb4b8bc, [[.12, 1.39, .05], [.12 + Math.cos(a) * .06, 1.34, .05 + Math.sin(a) * .06], [.12 + Math.cos(a) * .035, 1.27, .05 + Math.sin(a) * .035]], .004, { seg: 4, metal: true }); }
      wdec('grime_streak', .7, .4, 0, .2, .405, N_); Q(); const p = wp(-.5, 0, 1.5); anchor('vendClaw', { x: p[0], y: p[1], z: p[2], h: 0 }); }
    lbox(-.95, 0, 2.25, .95, 1.9, 'corner-machines');
    // ---- gumball machine
    { const x = -1.3, z = .55; C('metal_dark', .17, .2, .03, x, .015, z, { seg: 14 }); C('chrome', .022, .025, .86, x, .45, z, { seg: 10 }); sb(0xa3231c, .19, .2, .19, x, .97, z, { bevel: .02 }); sb(0xb8bcc0, .08, .09, .02, x, .97, z + .1, { metal: true }); sc(0x8f9294, .022, .022, .02, x, .97, z + .115, { rx: HP, seg: 8, metal: true }); sb(0x1b1c1f, .09, .04, .03, x, .885, z + .1);
      K.sphere('glass_clear', .155, x, 1.2, z, { seg: 16, seg2: 12 }); for (let i = 0; i < 46; i++) { const a = r() * TAU, rad = Math.sqrt(r()) * .125, yy = 1.075 + r() * r() * .15; ss([0xd8433a, 0xe8c83a, 0x3d8ad9, 0x4fb85a, 0xe6e2d6, 0xd97ab8][i % 6], .017, x + Math.cos(a) * rad * (1 - (yy - 1.075) * 2), yy, z + Math.sin(a) * rad * (1 - (yy - 1.075) * 2), { seg: 6, seg2: 4 }); } sc(0xa3231c, .07, .11, .05, x, 1.365, z, { seg: 14 }); lbox(x - .2, z - .2, x + .2, z + .2, 1.4, 'corner-gumball'); }
    // ---- payphone on a pedestal (handset off the hook)
    { P(3.3, 0, .4); B(gv, .32, .02, .32, 0, .01, 0, .004); B(gv, .09, 1.1, .09, 0, .56, 0, .008); B('aluminium_brushed', .5, .82, .34, 0, 1.5, -.03, .02); B('aluminium_brushed', .56, .05, .44, 0, 1.935, .0, .012); for (const s of [-1, 1]) B('aluminium_brushed', .025, .86, .26, s * .262, 1.5, .25, .006); sb(0x1f4a78, .56, .14, .02, 0, 2.03, .2, { bevel: .006 }); sb(0xe6e2d6, .3, .05, .004, 0, 2.03, .212);
      sb(0x17181a, .4, .7, .1, 0, 1.5, .16, { bevel: .015 }); aq(M.lit, ART.phone, .36, .6, 0, 1.52, .212, N_); sb(0xb8bcc0, .1, .09, .014, .1, 1.22, .213, { metal: true }); sb(0x8f9294, .07, .16, .03, -.17, 1.62, .215, { bevel: .01, metal: true });
      stube(0xa9adb0, [[-.17, 1.5, .22], [-.2, 1.2, .3], [-.12, .92, .34], [-.1, .82, .33]], .008, { seg: 5, steps: 14, metal: true }); P(-.1, .7, .33, { rz: .25, rx: .1 }); sb(0x17181a, .045, .2, .04, 0, 0, 0, { bevel: .012 }); sb(0x17181a, .06, .05, .06, 0, .1, .01, { bevel: .015 }); sb(0x17181a, .06, .05, .06, 0, -.1, .01, { bevel: .015 }); Q();
      wdec('rust_run', .1, .5, 0, .4, .046, N_); Q(); lbox(3.0, .05, 3.6, .75, 2.1, 'corner-phone'); const p = wp(3.3, 0, 1.25); anchor('cornerPhone', { x: p[0], y: p[1], z: p[2], h: 0 }); }
    // ---- community noticeboard on the wall
    { const x = 4.85; PLX('wood_plank', 1.36, .05, .05, x, 2.02, .04, .006); PLX('wood_plank', 1.36, .05, .05, x, 1.08, .04, .006); for (const s of [-1, 1]) PLX('wood_plank', .98, .05, .05, x + s * .655, 1.55, .04, .006, { rz: HP }); B('wood_plank', 1.5, .03, .16, x, 2.07, .09, .006, { rx: .25 }); aq(M.lit, ART.notice, 1.28, .854, x, 1.55, .032, N_);
      for (let i = 0; i < 3; i++) aq(M.lit, [ART.poster2, ART.card, ART.poster1][i], .2, .27, x - .4 + i * .42, .82 - i * .015, .012, { rz: (r() - .5) * .2 }); const p = wp(x, 0, 1.2); anchor('cornerNotice', { x: p[0], y: p[1], z: p[2], h: 0 }); }
    // ---- bench against the wall + bin
    { P(-3.2, 0, .42); for (const s of [-1, 1]) { B('concrete_stained', .12, .42, .44, s * .8, .21, 0, .02); B('concrete_stained', .12, .5, .1, s * .8, .64, -.23, .015, { rx: -.16 }); } for (let i = 0; i < 4; i++) PLX('wood_plank', 1.9, .04, .095, 0, .44, -.15 + i * .105, .008); for (let i = 0; i < 3; i++) PLX('wood_plank', 1.9, .1, .035, 0, .58 + i * .125, -.245 - i * .02, .008, { rx: -.16 });
      sportBottle(0xd98a2c, .55, .46, .05); sb(0xe6e2d6, .2, .003, .28, -.35, .462, .02, { ry: .3 }); sb(0xb5202a, .2, .001, .1, -.35, .464, .08, { ry: .3 }); dec('gum_spots', .9, .6, 0, .004, .6, 0); const p = wp(0, .46, .0); anchor('cornerBench', { x: p[0], y: p[1], z: p[2], h: PI }); Q(); lbox(-4.2, .1, -2.2, .72, .9, 'corner-bench'); }
    { const x = -4.75, z = .42; C('concrete_stained', .29, .26, .8, x, .4, z, { seg: 16 }); C('metal_dark', .3, .3, .06, x, .83, z, { seg: 16 }); sc(0x0c0c0d, .2, .2, .012, x, .862, z, { seg: 14 }); sc(0xe6e2d6, .04, .03, .1, x + .05, .9, z, { seg: 8, rz: .5 }); wdec('grime_streak', .5, .5, x, .35, z + .285, N_); dec('leak', .9, .9, x, .004, z + .3, 1); lbox(x - .3, z - .3, x + .3, z + .3, .9, 'corner-bin'); sc(0xb5202a, .04, .03, .1, x + .5, .04, z + .5, { rz: HP, seg: 8, open: true }); }
    // ---- bike rack with two bikes, by the corner
    { const z = 1.55; for (const x of [5.05, 5.6, 6.15]) { K.tube(gv, [[x, 0, z - .32], [x, .72, z - .32], [x, .86, z - .2], [x, .86, z + .2], [x, .72, z + .32], [x, 0, z + .32]], .024, { seg: 8, steps: 26, tension: .3 }); for (const s of [-1, 1]) C(gv, .05, .05, .012, x, .006, z + s * .32, { seg: 10 }); }
      bike(5.33, z - .08, .08, .13, .26, 0x8a2a22, false); bike(5.9, z + .06, PI - .06, -.11, .33, 0x3d7a84, true); stor(0xd98a2c, .1, .012, 5.5, .62, z - .25, { ry: .3, seg: 6, seg2: 14 }); lbox(4.9, z - .9, 6.3, z + .9, 1.1, 'corner-bikes'); }
    // ---- loose paper, a crate to sit on
    sb(0x2f5d8a, .36, .3, .36, -5.6, .15, .5, { bevel: .012, ry: .2 }); sb(0xdedbd0, .28, .002, .38, 2.4, .003, 1.7, { ry: .7 }); sb(0xdedbd0, .2, .002, .28, -1.9, .003, 1.4, { ry: -.4 }); sc(0xb8bcc0, .033, .033, .12, .9, .034, 1.75, { rz: HP, ry: .6, seg: 8, metal: true });
    spill(7.5, 5, .4, .012, 2.3);
    Q();
    S.lights.corner = [new T.PointLight(0xcfe6ff, 0, 11, 1.6), 1.25]; S.lights.corner[0].position.set(cx - .6, 1.9, wz - 1.7);
  }

  /* ================================================================== access fixes, build, update */
  /** make the beach reachable on foot: open the road module's continuous 'seawall' collider at its two stair gaps and at the pier mouth */
  function openSeawall() { const W = GT.world; if (W._hangSeawall) return; const i = W.boxes.findIndex(b => b.tag === 'seawall'); if (i < 0) return; W._hangSeawall = true;
    const b = W.boxes[i], gaps = [[-21.05, -18.95], [75.95, 80.05], [94.95, 97.05]]; W.boxes.splice(i, 1); let z = b.z0; for (const g of gaps) { W.boxes.push({ x0: b.x0, z0: z, x1: b.x1, z1: g[0], h: b.h, tag: 'seawall' }); z = g[1]; } W.boxes.push({ x0: b.x0, z0: z, x1: b.x1, z1: b.z1, h: b.h, tag: 'seawall' });
    for (const zs of [-20, 96]) for (const s of [-1, 1]) box(-12.4, zs + s * 1.15 - .1, -10, zs + s * 1.15 + .1, 1.1, 'stair-cheek'); }
  /** wrap GT.road.groundHeight so every on-foot system sees our decks, slabs, the pier and the stair ramps; also opens the seawall collider. Idempotent. */
  function install() { if (GT.road && GT.road.groundHeight && !GT.road._hangoutsBase) { GT.road._hangoutsBase = GT.road.groundHeight; S.base = GT.road._hangoutsBase; GT.road.groundHeight = groundHeight; } openSeawall(); S.info.installed = true; }
  function accessFixes() {
    for (const zs of [-20, 96]) S.over.push({ x0: -12.35, x1: -10.0, z0: zs - 1.05, z1: zs + 1.05, y: (x, z) => Math.max(gy(Math.min(x, -10.45), z), lerp(.14, -.64, cl((-10 - x) / 2.1, 0, 1))) });
    S.over.push({ x0: -10.45, x1: -9.99, z0: 76, z1: 80, y: .16 });
  }
  function instances(root) {
    if (INST.bulbs.length) { const g = new T.SphereGeometry(.03, 8, 6); g.scale(1, 1.25, 1); const im = new T.InstancedMesh(g, M.bulb, INST.bulbs.length), m4 = new T.Matrix4(), c = new T.Color();
      INST.bulbs.forEach((b, i) => { m4.makeScale(b[6], b[6], b[6]); m4.setPosition(b[0], b[1], b[2]); im.setMatrixAt(i, m4); im.setColorAt(i, c.setRGB(b[3], b[4], b[5])); }); im.frustumCulled = false; im.name = 'hang_bulbs'; root.add(im); }
    if (INST.bottles.length) { const pr = [[0, 0], [.034, 0], [.037, .015], [.037, .15], [.031, .19], [.014, .225], [.0125, .285], [.016, .29], [.016, .3], [0, .3]].map(p => new T.Vector2(p[0], p[1])), g = new T.LatheGeometry(pr, 10);
      const im = new T.InstancedMesh(g, M.bottle, INST.bottles.length), m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), c = new T.Color(), v = new T.Vector3(), sv = new T.Vector3();
      INST.bottles.forEach((b, i) => { q.setFromEuler(e.set(b[5] || 0, b[3], 0, 'YXZ')); m4.compose(v.set(b[0], b[1], b[2]), q, sv.set(b[4], b[4] * (b[9] || 1), b[4])); im.setMatrixAt(i, m4); im.setColorAt(i, c.setRGB(b[6], b[7], b[8])); }); im.frustumCulled = false; im.castShadow = true; im.name = 'hang_bottles'; root.add(im); }
  }
  /** build(scene, opts?) — opts.install === false skips install() (ground wrap + seawall gaps). Returns the root Group. */
  function build(scene, opts) {
    if (S.built) { if (scene && S.built.parent !== scene) scene.add(S.built); return S.built; }
    opts = opts || {}; const t0 = performance.now();
    if (GT.road && GT.road.groundHeight) S.base = GT.road._hangoutsBase || GT.road.groundHeight;
    makeArt(); makeMats(); const tArt = performance.now();
    const root = new T.Group(); root.name = 'hangouts'; KG = GT.kit(); accessFixes();
    const region = (name, fns) => { K = GT.kit(); for (const f of fns) { try { f(); } catch (e) { warn(name + ': ' + (e.stack || e)); } while (K.stack.length > 1) { K.pop(); KG.pop(); } } const g = K.build(); g.name = 'hang_' + name; g.traverse(o => { if (o.isMesh) o.name = 'hang_' + name + ':' + (o.material.name || ''); }); root.add(g); };
    region('beachSouth', [buildCourt, buildGym]); region('beachNorth', [buildBar, buildPier]); region('ring', [buildRing]); region('corner', [buildCorner]);
    K = GT.kit(); const gg = KG.build(); gg.name = 'hang_global';
    gg.traverse(o => { if (!o.isMesh) return; const m = o.material; o.name = 'hang_global:' + (m.name || '');
      if (m === M.spill) { o.renderOrder = 4; o.receiveShadow = false; } else if (m.transparent) o.renderOrder = 1;
      if (m === M.glow || m === M.spill || m === M.court || m === M.link || (m.name || '').startsWith('decal_')) o.castShadow = false; });
    root.add(gg); instances(root);
    for (const k in S.props) { const p = S.props[k]; if (Array.isArray(p)) p.forEach(o => o.isObject3D && root.add(o)); else if (p && p.isObject3D) root.add(p); }
    for (const k in S.lights) root.add(S.lights[k][0]);
    if (opts.install !== false) install();
    let dc = 0, tris = 0; const per = {}; root.traverse(o => { if (!o.isMesh) return; dc++; const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); tris += n; const key = (o.parent && o.parent.name || '') ; per[key] = (per[key] || 0) + Math.round(n); });
    Object.assign(S.info, { drawCalls: dc, tris: Math.round(tris), buildMs: Math.round(performance.now() - t0), artMs: Math.round(tArt - t0), perGroup: per, bulbs: INST.bulbs.length, bottles: INST.bottles.length, swatches: SW.n });
    console.log('[hangouts] build ' + S.info.buildMs + ' ms (art ' + S.info.artMs + '), meshes ' + dc + ', tris ' + S.info.tris);
    K = null; KG = null; S.built = root; if (scene) scene.add(root); update(0); return root;
  }
  function update(dt) {
    if (!S.built) return; S.t += dt || 0; const t = S.t, night = (GT.env && GT.env.night) || 0;
    for (const f of S.fans) f.o.rotation.y += (dt || 0) * f.w;
    for (const s of S.sway) { s.o.rotation.x = Math.sin(t * s.f + s.ph) * s.ax + Math.sin(t * s.f * 2.3 + 1) * s.ax * .25; s.o.rotation.z = Math.cos(t * s.f * .83 + s.ph) * s.az; }
    for (const k in S.lights) { const l = S.lights[k]; l[0].intensity = l[1] * night * (l[2] ? 1 + Math.sin(t * l[2]) * .04 : 1); l[0].visible = night > .02; }
  }

  GT.hangouts = { build, update, anchors: S.anchors, props: S.props, groundHeight, install, info: S.info };

  /* ================================================================== showcases */
  const WORLD = ['road', 'station', 'motel'];
  function stage(scene) { for (const n of WORLD) if (GT[n] && GT[n].build) { try { GT[n].build(scene); } catch (e) { warn(n + '.build threw: ' + e.message); } } build(scene);
    const q = new URLSearchParams(location.search); if (q.get('stats')) { const e = document.getElementById('err'); if (e) e.textContent += JSON.stringify(S.info) + '\n'; } }
  const FLY = [[[-8, 2.2, -74], [-34, .6, -62], 0], [[-22, 3.2, -50], [-34, .2, -61], 5], [[-17, 2.4, -27], [-30, .2, -20], 10], [[-21, 2.0, -9], [-30, .4, -19], 14], [[-18, 2.6, 40], [-32, .8, 30], 20], [[-26, 1.4, 35.5], [-32, .9, 29.5], 25],
    [[-58, 2.2, 74.6], [-74, 1.2, 78], 31], [[-84, 2.6, 81.5], [-70, 1.0, 77.5], 36], [[109, 3.4, 60], [120, .8, 63.8], 42], [[124.5, 2.0, 68.8], [120, .9, 63.8], 47], [[47, 2.2, -36.5], [55.5, 1.1, -30], 53], [[58, 1.7, -34.5], [55, 1.1, -30], 58]];
  /** every hangouts showcase accepts &at=<seconds> (pre-rolls update so animation can be inspected in a still) and &stats=1 */
  const show = (cam, look, hours, fly) => ({ scene, camera }) => { stage(scene); const q = new URLSearchParams(location.search), at = +q.get('at') || 0, free = fly && !q.get('cam'); let ft = at;
    const upd = dt => { update(dt); for (const n of WORLD) if (GT[n] && GT[n].update) GT[n].update(dt); }; for (let i = 0, n = Math.min(1800, Math.round(at * 30)); i < n; i++) update(1 / 30);
    const flyTo = tt => { const T_ = FLY[FLY.length - 1][2]; tt = ((tt % T_) + T_) % T_; let i = 0; while (i < FLY.length - 2 && FLY[i + 1][2] <= tt) i++; const a = FLY[i], b = FLY[i + 1], jump = Math.hypot(a[0][0] - b[0][0], a[0][2] - b[0][2]) > 60, k = jump ? 0 : GT.sstep(tt, a[2], b[2]);
      camera.position.set(lerp(a[0][0], b[0][0], k), lerp(a[0][1], b[0][1], k), lerp(a[0][2], b[0][2], k)); camera.lookAt(lerp(a[1][0], b[1][0], k), lerp(a[1][1], b[1][1], k), lerp(a[1][2], b[1][2], k)); };
    let first = true; return { cam, look, hours: hours || 18.2, update: dt => { upd(dt); if (free) { if (!first) ft += dt; first = false; flyTo(ft); } } }; };
  GT.showcase.hangouts = show([-8, 2.2, -74], [-34, .6, -62], 18.2, true);
  GT.showcase.hangouts_atlas = ({ scene }) => { makeArt(); const m = new T.Mesh(new T.PlaneGeometry(9, 6), new T.MeshBasicMaterial({ map: A.tex, transparent: true })), n = new T.Mesh(new T.PlaneGeometry(4, 4), new T.MeshBasicMaterial({ map: AG.tex })); n.position.set(7, 0, 0); scene.add(m, n); scene.add(new T.Mesh(new T.PlaneGeometry(30, 20), new T.MeshBasicMaterial({ color: 0x406080 })).translateZ(-.1)); return { cam: [1.5, 0, 9], look: [1.5, 0, 0] }; };
  GT.showcase.hangouts_court = show([-30.6, .95, -55.4], [-34.6, 1.3, -64]);
  GT.showcase.hangouts_gym = show([-23.2, .9, -15.6], [-30.5, .2, -20.6]);
  GT.showcase.hangouts_bar = show([-24.6, 1.0, 35.2], [-32, .9, 29.6]);
  GT.showcase.hangouts_pier = show([-74.6, 1.8, 79.3], [-79.4, 1.0, 76.5]);
  GT.showcase.hangouts_ring = show([115.0, 1.65, 59.7], [120.4, 1.0, 64.2]);
  GT.showcase.hangouts_corner = show([52.6, 1.75, -35.6], [55.6, 1.1, -30]);
})();
