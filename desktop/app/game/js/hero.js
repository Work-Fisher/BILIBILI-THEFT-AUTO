/* hero.js — the two leads of BILIBILI THEFT AUTO 1 (China edition) at third-person quality:
   阿凯 (kai, 28, 「跑得快」 delivery rider) and 阿烈 (lie, his cousin, dish-washer at the hotpot place).
   GT.hero.make(who, opts) -> { group, who, height, outfits, outfit, setOutfit, bones, attach, detach, update, setHelmet, setBox, setMask, setShades, ... }
   (contract: SPEC-LIFE.md + SPEC-CN.md).

   How it is built
   - One T.Bone skeleton per hero (root > hips > spine > chest > neck > head; clavicle > upper arm > forearm > hand > 3 shared finger
     joints + 2 thumb joints; thigh > shin > foot > toe; spring bones for the insulated box and the hair). Bind pose is a shallow A-pose.
   - Every surface is a parametric loft ("tube") written against that chain and GPU-skinned with smooth joint weights, so limbs and
     garments bend without gaps. Garments are their own lofts standing off the body with turned hems, collars, cuffs and baked folds;
     each garment has a painted atlas (albedo + height->normal + roughness/metal) with seams, stitches, pockets, prints and wear.
   - Animation is procedural. A pose is a flat channel array: hips offset/rotation, spine chain eulers, HAND TARGETS (chest space and/or
     root space, with an elbow pole) and FOOT TARGETS (root space, heel/toe roll); two-bone IK solves arms and legs every frame, so
     blending any two states (0.22 s smoothstep) always gives a plausible body, and the gait plants feet exactly
     (stance foot moves back at −speed; stride × cadence = speed). Springs add secondary motion to the box, straps and hair.
   Conventions: group origin at the feet, +Z forward, +Y up, the character's LEFT is +X. All maths runs in "kai units" (1.80 m body); 阿烈 is
   the same rig uniformly scaled. */
(function () {
  'use strict';
  const T = THREE, GT = window.GT; if (!T || !GT) return;
  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180, sin = Math.sin, cos = Math.cos, abs = Math.abs, sqrt = Math.sqrt, min = Math.min, max = Math.max, exp = Math.exp, pow = Math.pow, floor = Math.floor, round = Math.round, atan2 = Math.atan2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
  const sm = (x, a, b) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const G = (x, s) => exp(-(x * x) / (s * s));
  const spow = (v, e) => v < 0 ? -pow(-v, e) : pow(v, e);
  const tri = (x, a, b, c) => x <= a || x >= c ? 0 : x < b ? sm(x, a, b) : 1 - sm(x, b, c);
  const lin = hex => { const c = new T.Color(hex).convertSRGBToLinear(); return [c.r, c.g, c.b]; };
  const rgb = hex => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
  const css = (c, a) => `rgba(${clamp(c[0] * 255, 0, 255) | 0},${clamp(c[1] * 255, 0, 255) | 0},${clamp(c[2] * 255, 0, 255) | 0},${a === undefined ? 1 : a})`;
  const WHITE = [1, 1, 1];

  /* ================================================================== noise */
  function hsh(x, y, s) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vn(x, y, s) { const xi = floor(x), yi = floor(y), fx = x - xi, fy = y - yi, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), a = hsh(xi, yi, s), b = hsh(xi + 1, yi, s), c = hsh(xi, yi + 1, s), d = hsh(xi + 1, yi + 1, s); return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy; }
  function fb(x, y, s, o) { let v = 0, a = .5, t = 0; for (let i = 0; i < o; i++) { v += a * vn(x, y, s + i * 13); t += a; x *= 2.03; y *= 2.03; a *= .5; } return v / t; }
  /** tileable 512² fBm field (Float32 0..1), cached. px,py = lattice periods of the first octave (non-square = streaks). */
  const FLD = {};
  function field(px, py, oct, seed, gain) {
    gain = gain === undefined ? .5 : gain; const key = [px, py, oct, seed, gain].join('_'); if (FLD[key]) return FLD[key];
    const S = 512, out = new Float32Array(S * S), X0 = new Int32Array(S), X1 = new Int32Array(S), FX = new Float32Array(S); let amp = 1;
    for (let o = 0; o < oct; o++) { const gx = px << o, gy = py << o; if (gx > 256 || gy > 256) break;
      const lat = new Float32Array(gx * gy); for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) lat[j * gx + i] = hsh(i, j, seed * 131 + o * 17);
      for (let x = 0; x < S; x++) { const u = x / S * gx, i = floor(u), f = u - i; FX[x] = f * f * (3 - 2 * f); X0[x] = i % gx; X1[x] = (i + 1) % gx; }
      for (let y = 0; y < S; y++) { const v = y / S * gy, j = floor(v), f = v - j, fy = f * f * (3 - 2 * f), r0 = (j % gy) * gx, r1 = ((j + 1) % gy) * gx, row = y * S;
        for (let x = 0; x < S; x++) { const fx = FX[x], a = lat[r0 + X0[x]], b = lat[r0 + X1[x]], c = lat[r1 + X0[x]], d = lat[r1 + X1[x]], t = a + (b - a) * fx; out[row + x] += amp * (t + (c + (d - c) * fx - t) * fy); } }
      amp *= gain; }
    let mn = 1e9, mx = -1e9; for (let i = 0; i < out.length; i++) { const v = out[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const k = 1 / (mx - mn || 1); for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * k; return FLD[key] = out;
  }
  const fs = (f, x, y) => f[((y & 511) << 9) | (x & 511)];
  function fsb(f, x, y) { const xi = floor(x), yi = floor(y), fx = x - xi, fy = y - yi, a = fs(f, xi, yi), b = fs(f, xi + 1, yi), c = fs(f, xi, yi + 1), d = fs(f, xi + 1, yi + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; }

  /** keys: rows [t, v1, v2 ...] sorted by t -> f(t) returning a SHARED Float64Array of Catmull-Rom interpolated values (clamped at both ends). */
  function keyed(keys) { const n = keys.length, m = keys[0].length - 1, out = new Float64Array(m);
    return t => { if (t <= keys[0][0]) { for (let k = 0; k < m; k++) out[k] = keys[0][k + 1]; return out; } if (t >= keys[n - 1][0]) { for (let k = 0; k < m; k++) out[k] = keys[n - 1][k + 1]; return out; }
      let i = 0; while (i < n - 2 && t > keys[i + 1][0]) i++;
      const a = keys[i], b = keys[i + 1], p = keys[i - 1] || a, q = keys[i + 2] || b, h = b[0] - a[0], u = (t - a[0]) / h, u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      for (let k = 1; k <= m; k++) { const m0 = p === a ? (b[k] - a[k]) / h : (b[k] - p[k]) / (b[0] - p[0]), m1 = q === b ? (b[k] - a[k]) / h : (q[k] - a[k]) / (q[0] - a[0]); out[k - 1] = h00 * a[k] + h10 * h * m0 + h01 * b[k] + h11 * h * m1; }
      return out; }; }

  /* ================================================================== texture atlas painter (albedo + height->normal + roughness/metal) */
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  class Atlas {
    constructor(S) { this.S = S; this.col = new Uint8ClampedArray(S * S * 4); this.H = new Float32Array(S * S); this.orm = new Uint8ClampedArray(S * S * 4); this.o = { r: 0, g: 0, b: 0, h: 0, ro: .9, me: 0, a: 1 };
      for (let i = 0; i < S * S; i++) { const j = i * 4; this.col[j] = this.col[j + 1] = this.col[j + 2] = 128; this.col[j + 3] = 255; this.orm[j] = 255; this.orm[j + 1] = 230; this.orm[j + 2] = 0; this.orm[j + 3] = 255; } }
    /** per-pixel shader over rect [u0,v0,u1,v1] (v up). fn(u, v, x, y, o): u,v local 0..1; write o.r,o.g,o.b (sRGB 0..1), o.h (height), o.ro, o.me, o.a (alpha, hair only) */
    shade(rect, fn) { const S = this.S, x0 = round(rect[0] * S), x1 = round(rect[2] * S), yT = round((1 - rect[3]) * S), yB = round((1 - rect[1]) * S), o = this.o, col = this.col, orm = this.orm, H = this.H;
      for (let y = yT; y < yB; y++) { const v = 1 - (y + .5 - yT) / (yB - yT); for (let x = x0; x < x1; x++) { o.h = 0; o.ro = .9; o.me = 0; o.a = 1; fn((x + .5 - x0) / (x1 - x0), v, x, y, o); const i = (y * S + x) * 4;
        col[i] = o.r * 255; col[i + 1] = o.g * 255; col[i + 2] = o.b * 255; col[i + 3] = o.a * 255; H[y * S + x] = o.h; orm[i + 1] = o.ro * 255; orm[i + 2] = o.me * 255; } } return this; }
    /** switch to vector drawing. pen(rect) gives helpers in rect-local (u, v) coordinates, v up. */
    begin() { const S = this.S; this.cc = mkCanvas(S, S); this.g = this.cc.getContext('2d'); this.g.putImageData(new ImageData(this.col, S, S), 0, 0);
      this.hc = mkCanvas(S, S); this.gh = this.hc.getContext('2d'); this.gh.fillStyle = '#808080'; this.gh.fillRect(0, 0, S, S);
      this.oc = mkCanvas(S, S); this.go = this.oc.getContext('2d'); this.go.putImageData(new ImageData(this.orm, S, S), 0, 0); return this; }
    pen(rect) { const A = this, S = this.S, x0 = rect[0] * S, w = (rect[2] - rect[0]) * S, y0 = (1 - rect[1]) * S, h = (rect[3] - rect[1]) * S, all = [this.g, this.gh, this.go];
      const X = u => x0 + u * w, Y = v => y0 - v * h, hv = v => { const k = clamp(128 + v * 127, 0, 255) | 0; return `rgb(${k},${k},${k})`; };
      const P = {
        X, Y, w, h, g: this.g, gh: this.gh, go: this.go,
        clip(fn) { for (const c of all) { c.save(); c.beginPath(); c.rect(x0, y0 - h, w, h); c.clip(); } fn(); for (const c of all) c.restore(); },
        path(pts, closed) { for (const c of all) { c.beginPath(); c.moveTo(X(pts[0][0]), Y(pts[0][1])); for (let i = 1; i < pts.length; i++) c.lineTo(X(pts[i][0]), Y(pts[i][1])); if (closed) c.closePath(); } return P; },
        ellipse(u, v, ru, rv, rot) { for (const c of all) { c.beginPath(); c.ellipse(X(u), Y(v), ru * w, rv * h, rot || 0, 0, TAU); } return P; },
        rrect(u, v, du, dv, r) { const x = X(u), y = Y(v + dv), ww = du * w, hh = dv * h; r = min(r === undefined ? 4 : r, ww / 2, hh / 2); for (const c of all) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + ww, y, x + ww, y + hh, r); c.arcTo(x + ww, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + ww, y, r); c.closePath(); } return P; },
        /** o: {c: css colour | null, w: px, h: -1..1 height | undefined, hw: px width of the height stroke, dash: [..], ro, me, blur, a} */
        stroke(o) { const dash = o.dash || []; if (o.c) { A.g.save(); if (o.blur) A.g.filter = `blur(${o.blur}px)`; A.g.globalAlpha = o.a === undefined ? 1 : o.a; A.g.setLineDash(dash); A.g.lineCap = o.cap || 'butt'; A.g.lineJoin = 'round'; A.g.strokeStyle = o.c; A.g.lineWidth = o.w; A.g.stroke(); A.g.restore(); }
          if (o.h !== undefined) { A.gh.save(); if (o.hb) A.gh.filter = `blur(${o.hb}px)`; A.gh.setLineDash(dash); A.gh.lineJoin = 'round'; A.gh.strokeStyle = hv(o.h); A.gh.globalAlpha = o.ha === undefined ? 1 : o.ha; A.gh.lineWidth = o.hw || o.w; A.gh.stroke(); A.gh.restore(); }
          if (o.ro !== undefined) { A.go.save(); A.go.setLineDash(dash); A.go.strokeStyle = `rgb(255,${o.ro * 255 | 0},${(o.me || 0) * 255 | 0})`; A.go.lineWidth = o.w; A.go.stroke(); A.go.restore(); } return P; },
        fill(o) { if (o.c) { A.g.save(); if (o.blur) A.g.filter = `blur(${o.blur}px)`; A.g.globalAlpha = o.a === undefined ? 1 : o.a; A.g.fillStyle = o.c; A.g.fill(); A.g.restore(); }
          if (o.h !== undefined) { A.gh.save(); if (o.hb) A.gh.filter = `blur(${o.hb}px)`; A.gh.globalAlpha = o.ha === undefined ? 1 : o.ha; A.gh.fillStyle = hv(o.h); A.gh.fill(); A.gh.restore(); }
          if (o.ro !== undefined) { A.go.fillStyle = `rgb(255,${o.ro * 255 | 0},${(o.me || 0) * 255 | 0})`; A.go.fill(); } return P; },
        /** a sewn seam: recessed line + a row (or two) of thread stitches beside it */
        seam(pts, o) { o = o || {}; const th = o.thread || 'rgba(215,200,170,.9)', off = (o.off === undefined ? 3 : o.off) / w;
          P.path(pts).stroke({ c: o.dark || 'rgba(0,0,0,.35)', w: o.w || 1.6, h: -.55, hw: 2.2 });
          for (const k of (o.rows === 2 ? [1, 2.3] : o.rows === 0 ? [] : [1])) { const q = pts.map((p, i) => { const a = pts[max(i - 1, 0)], b = pts[min(i + 1, pts.length - 1)], dx = (b[0] - a[0]) * w, dy = (b[1] - a[1]) * h, l = Math.hypot(dx, dy) || 1; return [p[0] + (-dy / l) * off * k * (o.side || 1), p[1] + (dx / l) * off * k * (o.side || 1) * w / h]; });
            P.path(q).stroke({ c: th, w: o.tw || 1.3, dash: o.dash || [3.2, 2.2], h: .5, hw: 1.6 }); } return P; },
        text(str, u, v, px, o) { o = o || {}; for (const [c, st] of [[A.g, o.c || '#fff'], o.h !== undefined ? [A.gh, hv(o.h)] : null, o.ro !== undefined ? [A.go, `rgb(255,${o.ro * 255 | 0},0)`] : null].filter(Boolean)) { c.save(); c.translate(X(u), Y(v)); if (o.rot) c.rotate(o.rot); if (o.sx) c.scale(o.sx, 1); c.font = `${o.weight || 800} ${px}px ${o.font || "'Arial Narrow','Helvetica Neue',Arial,sans-serif"}`; c.textAlign = o.align || 'center'; c.textBaseline = 'middle';
          if (c === A.g) c.globalAlpha = o.a === undefined ? 1 : o.a; if (o.outline && c === A.g) { c.strokeStyle = o.outline; c.lineWidth = o.ow || 4; c.lineJoin = 'round'; c.strokeText(str, 0, 0); } c.fillStyle = st; c.fillText(str, 0, 0); c.restore(); } return P; }
      }; return P; }
    /** -> { map, normalMap, orm } textures. nk = normal strength. */
    finish(nk, o) { o = o || {}; if (!this.g) this.begin(); const S = this.S, H = this.H, hd = this.gh.getImageData(0, 0, S, S).data, nd = new Uint8ClampedArray(S * S * 4); nk = nk === undefined ? 1 : nk;
      for (let i = 0; i < S * S; i++) H[i] += (hd[i * 4] - 128) / 127;
      for (let y = 0; y < S; y++) { const yu = min(y + 1, S - 1) * S, yd = max(y - 1, 0) * S, row = y * S; for (let x = 0; x < S; x++) { const dx = (H[row + min(x + 1, S - 1)] - H[row + max(x - 1, 0)]) * nk, dy = (H[yu + x] - H[yd + x]) * nk, il = 127.5 / sqrt(dx * dx + dy * dy + 1), j = (row + x) * 4;
        nd[j] = 127.5 - dx * il; nd[j + 1] = 127.5 + dy * il; nd[j + 2] = 127.5 + il; nd[j + 3] = 255; } }
      const nc = mkCanvas(S, S); nc.getContext('2d').putImageData(new ImageData(nd, S, S), 0, 0);
      const tx = (c, srgb) => { const t = new T.CanvasTexture(c); t.anisotropy = 8; if (srgb) t.encoding = T.sRGBEncoding; if (o.repeatS) t.wrapS = T.RepeatWrapping; return t; };
      const out = { map: tx(this.cc, true), normalMap: tx(nc, false), orm: tx(this.oc, false) }; this.col = this.H = this.orm = null; return out; }
  }

  /* ================================================================== skeleton (bind pose, kai units, +X = the character's left) */
  const A_POSE = .24, L_ARM = .285, L_FORE = .255, L_TH = .43, L_SH = .41, ANK = .085, HIPX = .095, HIPY0 = .985, SHO = [.19, 1.452, -.025], WRIST = L_ARM + L_FORE;
  const BDEF = [['root', null, 0, 0, 0], ['hips', 'root', 0, HIPY0, 0], ['spine', 'hips', 0, .1, -.008], ['chest', 'spine', 0, .165, -.012], ['neck', 'chest', 0, .245, -.002], ['head', 'neck', 0, .09, .017], ['hair', 'head', 0, .15, 0], ['pack', 'chest', 0, 0, -.13]];
  for (const s of [1, -1]) { const S = s > 0 ? 'L' : 'R';
    BDEF.push(['clav' + S, 'chest', .035 * s, .202, .005], ['arm' + S, 'clav' + S, .155 * s, 0, -.01, A_POSE * s], ['fore' + S, 'arm' + S, 0, -L_ARM, 0], ['hand' + S, 'fore' + S, 0, -L_FORE, 0],
      ['f1' + S, 'hand' + S, 0, -.09, 0], ['f2' + S, 'f1' + S, 0, -.04, 0], ['f3' + S, 'f2' + S, 0, -.026, 0], ['t1' + S, 'hand' + S, -.008 * s, -.028, .03], ['t2' + S, 't1' + S, 0, -.034, .016],
      ['thigh' + S, 'hips', HIPX * s, -.06, 0], ['shin' + S, 'thigh' + S, 0, -L_TH, 0], ['foot' + S, 'shin' + S, 0, -L_SH, 0], ['toe' + S, 'foot' + S, 0, -.06, .125]); }
  for (const s of [1, -1]) { const S = s > 0 ? 'L' : 'R'; BDEF.push(['i1' + S, 'hand' + S, 0, -.09, 0], ['i2' + S, 'i1' + S, 0, -.042, 0], ['i3' + S, 'i2' + S, 0, -.027, 0]); }   /* the index finger has its own chain (named i*, so code that curls the f* chain leaves it alone): a trigger finger */
  const BI = {}; BDEF.forEach((b, i) => { BI[b[0]] = i; });
  /* H5: the hero's middle (m*) and little (q*) fingers get their own chains, jointed where their own knuckles are (the shared f* chain is jointed for the ring finger: the little finger's
     middle joint sat 16 mm short of its pivot, so in a fist it swung out like a hook). Hero only — street NPCs (people.js, built from BDEF) keep the shared chain. Indices are given after the lid. */
  const HX = []; for (const s of [1, -1]) { const S = s > 0 ? 'L' : 'R'; HX.push(['m1' + S, 'hand' + S, 0, -.091, 0], ['m2' + S, 'm1' + S, 0, -.044, 0], ['m3' + S, 'm2' + S, 0, -.029, 0], ['q1' + S, 'hand' + S, 0, -.081, 0], ['q2' + S, 'q1' + S, 0, -.033, 0], ['q3' + S, 'q2' + S, 0, -.02, 0]); }
  function makeSkeleton() { const D = BDEF.concat(HX), bones = D.map(d => { const b = new T.Bone(); b.name = d[0]; b.position.set(d[2], d[3], d[4]); if (d[5]) b.rotation.z = d[5]; if (/^[ifmq]1[LR]$/.test(d[0])) b.rotation.order = 'ZXY'; return b; });   /* finger roots: spread (x) applies before the curl (z), so a closing hand can bring its fingers together */
    D.forEach((d, i) => { if (d[1]) bones[BI[d[1]]].add(bones[i]); }); bones[0].updateMatrixWorld(true); return { bones, skeleton: new T.Skeleton(bones) }; }
  /** arm-down space (origin at the shoulder joint, arm along −Y, left arm) -> bind space. S = 1 left, −1 right (mirrored). */
  const CA = cos(A_POSE), SA = sin(A_POSE);
  const armXf = S => p => { const x = p[0] * CA - p[1] * SA, y = p[0] * SA + p[1] * CA; p[0] = (SHO[0] + x) * S; p[1] = SHO[1] + y; p[2] += SHO[2]; };
  const mirXf = S => S > 0 ? null : p => { p[0] = -p[0]; };

  /* ================================================================== mesher: skinned geometry from lofts */
  class Mesher {
    constructor() { this.p = []; this.t = []; this.si = []; this.sw = []; this.ix = []; }
    get count() { return this.p.length / 3; }
    /** w = [bone, weight, bone, weight ...] (any length; the 4 heaviest are kept and normalised) */
    v(x, y, z, u, v, w) { const i = this.p.length / 3; this.p.push(x, y, z); this.t.push(u, v); const b = [0, 0, 0, 0], g = [0, 0, 0, 0];
      for (let k = 0; k < w.length; k += 2) { let wt = w[k + 1], bn = w[k]; if (!(wt > 1e-4)) continue; for (let q = 0; q < 4; q++) if (wt > g[q]) { const tw = g[q], tb = b[q]; g[q] = wt; b[q] = bn; wt = tw; bn = tb; } }
      const s = g[0] + g[1] + g[2] + g[3] || 1; if (!(g[0] > 0)) { g[0] = 1; b[0] = 0; } this.si.push(b[0], b[1], b[2], b[3]); this.sw.push(g[0] / s, g[1] / s, g[2] / s, g[3] / s); return i; }
    tri(a, b, c) { this.ix.push(a, b, c); }
    get tris() { return this.ix.length / 3; }
    geo() { const g = new T.BufferGeometry(), P = this.p, n = P.length / 3; g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(this.t, 2));
      g.setAttribute('skinIndex', new T.Uint16BufferAttribute(this.si, 4)); g.setAttribute('skinWeight', new T.Float32BufferAttribute(this.sw, 4)); g.setIndex(this.ix); g.computeVertexNormals();
      const N = g.attributes.normal.array, map = new Map(); for (let i = 0; i < n; i++) { const k = round(P[i * 3] * 4e3) + '_' + round(P[i * 3 + 1] * 4e3) + '_' + round(P[i * 3 + 2] * 4e3); let a = map.get(k); if (!a) map.set(k, a = [0, 0, 0, []]); a[0] += N[i * 3]; a[1] += N[i * 3 + 1]; a[2] += N[i * 3 + 2]; a[3].push(i); }
      for (const a of map.values()) { if (a[3].length < 2) continue; const l = Math.hypot(a[0], a[1], a[2]) || 1; for (const i of a[3]) { N[i * 3] = a[0] / l; N[i * 3 + 1] = a[1] / l; N[i * 3 + 2] = a[2] / l; } }
      g.boundingSphere = new T.Sphere(new T.Vector3(0, .9, 0), 1.6); return g; }
  }
  /** loft. o: { n, rings, ring(i, t) -> {c:[x,y,z], a, f, b, e?, e2?, U?, V?, tx?, tz?, v?}  |  pt(i, u, out) -> info,   w(x,y,z, info, u, i) -> weights,
       uv:[u0,v0,u1,v1], arc:[uA,uB] (open), uvArc, mirrorU, xf(p), disp(i,u,ring), cap0, cap1, flip }.  u = 0 front (+Z), .25 = +X, .5 back, .75 = −X. */
  function tube(M, o) { const n = o.n || 16, K = o.rings, R = o.uv || [0, 0, 1, 1], uA = o.arc ? o.arc[0] : 0, uB = o.arc ? o.arc[1] : 1, base = M.count, pt = [0, 0, 0], cen = [], W = n + 1;
    for (let i = 0; i < K; i++) { const r = o.ring ? o.ring(i, K > 1 ? i / (K - 1) : 0) : null; let sx = 0, sy = 0, sz = 0;
      for (let j = 0; j <= n; j++) { const q = j / n, uu = o.uw ? o.uw(uA + (uB - uA) * q) : uA + (uB - uA) * q; let info = r;
        if (o.pt) info = o.pt(i, uu, pt) || r;
        else { const th = PI / 2 - TAU * uu, cs = cos(th), sn = sin(th), e = sn >= 0 ? (r.e || 1) : (r.e2 || r.e || 1), d = o.disp ? o.disp(i, uu, r) : 0, lx = (r.a + d) * spow(cs, e), lz = ((sn >= 0 ? r.f : r.b) + d) * spow(sn, e), c = r.c;
          if (r.U) { const U = r.U, V = r.V; pt[0] = c[0] + U[0] * lx + V[0] * lz; pt[1] = c[1] + U[1] * lx + V[1] * lz; pt[2] = c[2] + U[2] * lx + V[2] * lz; } else { pt[0] = c[0] + lx; pt[1] = c[1] + (r.tx || 0) * lx + (r.tz || 0) * lz; pt[2] = c[2] + lz; } }
        const w = o.w(pt[0], pt[1], pt[2], info, uu, i); if (o.xf) o.xf(pt);
        const uq = o.uvArc ? q : uu, um = o.mirrorU ? 1 - uq : uq, vv = info && info.v !== undefined ? info.v : (K > 1 ? i / (K - 1) : 0);
        M.v(pt[0], pt[1], pt[2], R[0] + (R[2] - R[0]) * um, R[1] + (R[3] - R[1]) * vv, w); sx += pt[0]; sy += pt[1]; sz += pt[2]; }
      cen.push([sx / W, sy / W, sz / W]); }
    let flip = o.flip;
    if (flip === undefined) { let dsum = 0; const P = M.p; for (const jq of [n >> 3, (n * 3) >> 3, (n * 5) >> 3, (n * 7) >> 3]) { const mid = min(K - 2, (K / 2) | 0), a = (base + mid * W + jq) * 3, b = a + 3, c = a + W * 3, e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, l = Math.hypot(nx, ny, nz) || 1, cm = cen[mid]; dsum += (nx * (P[a] - cm[0]) + ny * (P[a + 1] - cm[1]) + nz * (P[a + 2] - cm[2])) / l; } flip = dsum < 0; }
    for (let i = 0; i < K - 1; i++) for (let j = 0; j < n; j++) { const a = base + i * W + j, b = a + 1, c = a + W, d = c + 1; if (flip) { M.tri(a, d, b); M.tri(a, c, d); } else { M.tri(a, b, d); M.tri(a, d, c); } }
    const cap = (ri, off, front) => { const c = cen[ri], b0 = base + ri * W, P = M.p, cx = c[0] + (off && off[0] || 0), cy = c[1] + (off && off[1] || 0), cz = c[2] + (off && off[2] || 0), cv = M.count; M.p.push(cx, cy, cz); M.t.push(M.t[b0 * 2], M.t[b0 * 2 + 1]); M.si.push(M.si[b0 * 4], M.si[b0 * 4 + 1], M.si[b0 * 4 + 2], M.si[b0 * 4 + 3]); M.sw.push(M.sw[b0 * 4], M.sw[b0 * 4 + 1], M.sw[b0 * 4 + 2], M.sw[b0 * 4 + 3]);
      for (let j = 0; j < n; j++) { const a = b0 + j, b = a + 1; if (front !== flip) M.tri(cv, a, b); else M.tri(cv, b, a); } };
    if (o.cap0) cap(0, o.cap0 === true ? null : o.cap0, false); if (o.cap1) cap(K - 1, o.cap1 === true ? null : o.cap1, true);
    return { base, W, K }; }
  /** flat ribbon / strap along a path. o: { width, thick, U:[lateral axis], steps, w, uv, xf, e } */
  function strip(M, pts, o) { const curve = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p[0], p[1], p[2])), false, 'catmullrom', .5), K = o.steps || pts.length * 4, U = o.U || [1, 0, 0], tv = new T.Vector3(), pv = new T.Vector3(), r = { c: [0, 0, 0], a: (o.width || .03) / 2, f: (o.thick || .006) / 2, b: (o.thick || .006) / 2, e: o.e || .45, U, V: [0, 0, 1], v: 0 };
    return tube(M, { n: o.n || 8, rings: K, uv: o.uv, xf: o.xf, w: o.w, cap0: true, cap1: true, ring: (i, t) => { curve.getPoint(t, pv); curve.getTangent(t, tv); const vx = tv.y * U[2] - tv.z * U[1], vy = tv.z * U[0] - tv.x * U[2], vz = tv.x * U[1] - tv.y * U[0], l = Math.hypot(vx, vy, vz) || 1;
      r.c = [pv.x, pv.y, pv.z]; r.V = [vx / l, vy / l, vz / l]; r.v = o.vRep ? t * o.vRep : t; r.a = (o.widthAt ? o.widthAt(t) : (o.width || .03)) / 2; return r; } }); }
  /** ellipsoid blob. */
  function ellip(M, c, rad, o) { const K = o.rings || 7, r = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0 }, lim = PI / 2 - .22;
    return tube(M, { n: o.n || 10, rings: K, uv: o.uv, xf: o.xf, w: o.w, cap0: true, cap1: true, ring: (i, t) => { const ph = -lim + 2 * lim * t, k = cos(ph); r.c = [c[0], c[1] + rad[1] * sin(ph), c[2]]; r.a = rad[0] * k; r.f = rad[2] * k * (o.front === undefined ? 1 : o.front); r.b = rad[2] * k; r.v = t; r.e = o.e || 1; return r; } }); }
  /** bevelled box, rigid to one bone (or weight fn). o: { bevel, rect | rects(face 0..5 = +x,-x,+y,-y,+z,-z), w, rx, ry, rz } */
  const _bm = new T.Matrix4(), _be = new T.Euler(), _bv = new T.Vector3();
  function boxPart(M, w, h, d, x, y, z, o) { o = o || {}; const g = GT.boxGeo(w, h, d, o.bevel === undefined ? .008 : o.bevel), P = g.attributes.position, s = o.bevel === 0 ? 1 : 3, per = (s + 1) * (s + 1), base = M.count;
    _bm.makeRotationFromEuler(_be.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ')); _bm.setPosition(x, y, z);
    for (let i = 0; i < P.count; i++) { const f = (i / per) | 0, px = P.getX(i), py = P.getY(i), pz = P.getZ(i), R = o.rects ? o.rects(f) : (o.rect || [0, 0, 1, 1]); let u, v;
      if (f === 0) { u = .5 - pz / d; v = .5 + py / h; } else if (f === 1) { u = .5 + pz / d; v = .5 + py / h; } else if (f === 2) { u = .5 + px / w; v = .5 - pz / d; } else if (f === 3) { u = .5 + px / w; v = .5 + pz / d; } else if (f === 4) { u = .5 + px / w; v = .5 + py / h; } else { u = .5 - px / w; v = .5 + py / h; }
      _bv.set(px, py, pz).applyMatrix4(_bm); M.v(_bv.x, _bv.y, _bv.z, R[0] + (R[2] - R[0]) * clamp(u, 0, 1), R[1] + (R[3] - R[1]) * clamp(v, 0, 1), typeof o.w === 'function' ? o.w(_bv.x, _bv.y, _bv.z) : o.w); }
    const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) M.tri(base + ix[k], base + ix[k + 1], base + ix[k + 2]); g.dispose(); }

  /* ================================================================== skin weights by region (bind-space position -> bones) */
  const wTorso = (x, y, z) => { const ax = abs(x), S = x >= 0 ? 'L' : 'R', wh0 = 1 - sm(y, .975, 1.085), wc0 = sm(y, 1.14, 1.28), wsp = max(0, 1 - wh0 - wc0), wn = sm(y, 1.475, 1.535), whd = sm(y, 1.56, 1.6),
      wth = wh0 * (1 - sm(y, .875, .985)) * .9, sL = sm(x, -.07, .07), lat = sm(y, 1.33, 1.41), wcl = sm(ax, .09, .17) * lat * .6, war = sm(ax, .165, .22) * lat * .4, cc = wc0 * (1 - wn);
    return [BI.hips, wh0 - wth, BI.thighL, wth * sL, BI.thighR, wth * (1 - sL), BI.spine, wsp, BI.chest, cc * (1 - wcl - war), BI['clav' + S], cc * wcl, BI['arm' + S], cc * war, BI.neck, wc0 * wn * (1 - whd), BI.head, wc0 * wn * whd]; };
  const wArm = (S, s) => { const L = S > 0 ? 'L' : 'R', wa = sm(s, -.07, .045), wf = sm(s, L_ARM - .05, L_ARM + .05), wh = sm(s, WRIST - .03, WRIST + .012);
    return [BI['clav' + L], (1 - wa) * .55, BI.chest, (1 - wa) * .45, BI['arm' + L], wa * (1 - wf), BI['fore' + L], wf * (1 - wh), BI['hand' + L], wf * wh]; };
  const wLeg = (S, y) => { const L = S > 0 ? 'L' : 'R', wt = 1 - sm(y, .87, .985), ws = 1 - sm(y, .44, .545), wf = 1 - sm(y, .08, .125);
    return [BI.hips, 1 - wt, BI['thigh' + L], wt * (1 - ws), BI['shin' + L], ws * (1 - wf), BI['foot' + L], ws * wf]; };
  const wPelvis = (x, y) => { const up = sm(y, .875, .985), sL = sm(x, -.04, .04), sp = sm(y, 1.0, 1.1); return [BI.hips, up * (1 - sp), BI.spine, up * sp, BI.thighL, (1 - up) * sL, BI.thighR, (1 - up) * (1 - sL)]; };
  const wOne = name => [BI[name], 1];

  /* ================================================================== body shape */
  /* torso cross-sections: y -> half width, front depth, back depth, centre z */
  const BODYK = [[.84, .152, .090, .108, 0], [.93, .174, .100, .128, 0], [1.0, .163, .098, .114, 0], [1.07, .144, .094, .094, -.004], [1.15, .150, .102, .098, -.008], [1.25, .164, .114, .108, -.012], [1.34, .178, .123, .119, -.014], [1.41, .188, .114, .124, -.018], [1.455, .189, .095, .115, -.02], [1.49, .132, .073, .099, -.02], [1.52, .066, .058, .069, -.02]];
  /* SHP: optional shape modifiers used ONLY while js/people.js builds NPC bodies (GT.hero._b.setShape); always null for the heroes, so their output is unchanged */
  let SHP = null; const BODY0 = keyed(BODYK), BODY = y => { const q = BODY0(y); return SHP && SHP.body ? (SHP.body(q, y) || q) : q; };
  /* head: y -> half width at the ear line, front depth, back depth, centre z, jaw taper (how much the front half narrows towards the chin) */
  const HEAD2 = keyed([[1.47, .060, .056, .064, -.024, 0], [1.52, .054, .052, .060, -.022, 0], [1.55, .054, .052, .060, -.018, .05], [1.568, .0565, .058, .062, -.012, .2], [1.578, .060, .074, .064, -.006, .32], [1.588, .0635, .082, .067, -.002, .34], [1.60, .0675, .0858, .071, 0, .3], [1.615, .071, .0882, .077, .002, .24], [1.635, .0735, .0915, .084, .003, .17], [1.655, .075, .092, .090, .004, .1], [1.68, .0758, .092, .095, .004, .05], [1.70, .0762, .0955, .098, .004, .03], [1.725, .0775, .097, .100, .004, 0]]);
  const NOSEK = keyed([[1.63, 0], [1.634, .003], [1.640, .02], [1.647, .0265], [1.665, .013], [1.69, .004], [1.706, 0]]);
  const HTOP = 1.8025, EYE = { du: .0695, y: 1.6778, hw: .031, rx: .0135, ry: .0125, rz: .0125, x: 0, z: 0 };
  /** sculpt: radial offset of the face at (du = turns from the nose, y) */
  function faceD(du, y) { const ad = abs(du); if (ad > .32) return 0; let d = 0;
    if (y > 1.628 && y < 1.705) d += NOSEK(y)[0] * G(du, .013 + .011 * sm(y, 1.668, 1.645)) + .007 * G(ad - .034, .013) * G(y - 1.6405, .0065);
    d -= .011 * G(ad - .045, .022) * G(y - 1.679, .011) + .004 * G(ad - .08, .03) * G(y - 1.679, .012);                       // eye sockets (deep beside the nose)
    d += .0048 * G(ad - .055, .055) * G(y - 1.7005, .007) + .0035 * G(ad - .135, .045) * G(y - 1.655, .016);                    // brow ridge, cheekbones
    d -= .003 * G(ad - .15, .05) * G(y - 1.615, .016) + .002 * G(ad - .17, .04) * G(y - 1.70, .02) + .0015 * G(ad - .06, .012) * G(y - 1.628, .012);   // cheek hollow, temples, nasolabial
    d += .0012 * G(du, .075) * G(y - 1.615, .02) + .0022 * G(du, .07) * G(y - 1.6175, .0038) + .003 * G(du, .06) * G(y - 1.6068, .0042) + .006 * G(du, .05) * G(y - 1.5885, .009);   // muzzle, lips, chin
    d -= .003 * G(du, .075) * G(y - 1.6122, .0016) + .0028 * G(du, .035) * G(y - 1.5985, .0045) + .002 * G(ad - .058, .012) * G(y - 1.612, .005) + .0012 * G(du, .008) * G(y - 1.626, .006);
    d += .004 * G(du, .03) * G(y - 1.535, .012); return SHP && SHP.face ? d + SHP.face(du, y) : d; }
  const FACEFLAT = /[?&]face0=1/.test(location.search) ? 0 : .17, JAWK = /[?&]face0=1/.test(location.search) ? 1 : .68;
  function headRaw(u, y, out) { let k = HEAD2(clamp(y, 1.47, 1.725)), a = k[0], f = k[1], b = k[2], cz = k[3], tau = k[4]; if (SHP && SHP.head) { const m = SHP.head(y); a *= m[0]; f *= m[1]; b *= m[2]; tau *= m[3]; }
    if (y < 1.52) { const q = BODY(max(y, .84)), w = sm(y, 1.44, 1.52); a = lerp(q[0] - .012, a, w); f = lerp(q[1] - .012, f, w); b = lerp(q[2] - .012, b, w); cz = lerp(q[3], cz, w); tau *= w; }
    if (y > 1.725) { const d = sqrt(max(0, 1 - pow((y - 1.725) / .0775, 2))); a *= d; f *= d; b *= d; }
    const th = PI / 2 - TAU * u, cs = cos(th), sn = sin(th), du = u - round(u), d = y > 1.5 && y < 1.76 ? faceD(du, y) : 0, fl = sn > 0 ? FACEFLAT * sm(y, 1.54, 1.6) * (1 - sm(y, 1.72, 1.77)) : 0, e = .95 - fl;   /* PP: a flatter, wider front to the face (the round section made every face narrow) */
    out[0] = (a + d) * spow(cs, e) * (sn > 0 ? 1 - JAWK * tau * sn * sn : 1); out[1] = y; out[2] = cz + ((sn >= 0 ? f : b) + d) * spow(sn, e); return out; }
  { const t = headRaw(EYE.du, EYE.y, [0, 0, 0]); EYE.x = t[0]; EYE.z = t[2] + .004 - EYE.rz; BI.lid = BDEF.length; BDEF.push(['lid', 'head', 0, EYE.y - 1.585, EYE.z + .005]); }
  HX.forEach((b, i) => { BI[b[0]] = BDEF.length + i; });
  /** point on the head/neck surface. u around (0 = face), y height; off = offset along the outward normal. */
  function headPt(u, y, off, out) { headRaw(u, y, out);
    if (y > 1.66 && y < 1.695 && out[2] > 0) { const dx = (abs(out[0]) - EYE.x) / (EYE.rx + .0012), dy = (y - EYE.y) / (EYE.ry + .0012), q = 1 - dx * dx - dy * dy; if (q > 0) { const zg = EYE.z + (EYE.rz + .0012) * sqrt(q), dz = out[2] - zg; out[2] = .5 * (out[2] + zg + sqrt(dz * dz + 1e-6)); } }
    let x = out[0], z = out[2];
    if (off) { const nx = x, ny = (y - 1.685) * 1.15, nz = z - .004, l = Math.hypot(nx, ny, nz) || 1; x += nx / l * off; y += ny / l * off; z += nz / l * off; }
    out[0] = x; out[1] = y; out[2] = z; return out; }
  /* hairline: lower edge of the hair as a function of the angle from the back of the head (0 = nape centre, .5 = forehead centre) */
  const HLK = { kai: keyed([[0, 1.622], [.1, 1.626], [.19, 1.655], [.235, 1.694], [.275, 1.674], [.33, 1.716], [.41, 1.75], [.5, 1.754]]), lie: keyed([[0, 1.612], [.1, 1.616], [.19, 1.648], [.235, 1.69], [.275, 1.668], [.33, 1.712], [.41, 1.744], [.5, 1.746]]) };
  const hairline = (who, u) => HLK[who](abs(u - floor(u) - .5))[0];
  /* arm: s (m from the shoulder joint) -> lateral radius, front/back radius */
  const ARMK0 = keyed([[-.02, .028, .032], [-.008, .043, .047], [.012, .051, .056], [.05, .053, .058], [.13, .0465, .051], [.22, .041, .043], [.285, .039, .039], [.34, .0405, .041], [.44, .032, .033], [.50, .0245, .0275], [.545, .0205, .0265]]), ARMK = s => { const q = ARMK0(s); return SHP && SHP.arm ? (SHP.arm(q, s) || q) : q; };
  /* leg: y -> centre x, lateral radius, front, back, centre z */
  const LEGK0 = keyed([[.97, .098, .088, .094, .104, 0], [.86, .098, .086, .092, .098, 0], [.78, .098, .080, .087, .090, .002], [.62, .096, .068, .076, .076, .004], [.50, .095, .058, .066, .058, .004], [.40, .095, .056, .052, .067, -.004], [.25, .095, .045, .046, .053, -.008], [.12, .095, .039, .044, .046, -.012], [.06, .095, .038, .044, .046, -.012]].reverse()), LEGK = y => { const q = LEGK0(y); return SHP && SHP.leg ? (SHP.leg(q, y) || q) : q; };
  const foldV = (u, y, seed) => fb(cos(TAU * u) * 5 + 7, sin(TAU * u) * 5 + y * 3, seed, 2) - .5;
  const lin_ = (a, b, n) => { const o = []; for (let i = 0; i < n; i++) o.push(a + (b - a) * i / (n - 1)); return o; };
  /** periodic-in-u fold noise (so closed tubes do not crack at the seam) */
  const foldN = (u, y, fy, seed) => .62 - abs(2 * fb(cos(TAU * u) * 1.7 + 7, sin(TAU * u) * 1.7 + y * fy, seed, 2) - 1) * 1.6;

  /* PP: anatomy (js/humans.js): pecs or breasts, clavicles, buttocks, deltoids, biceps, elbows, knees, calves as radial offsets on every body loft; NPCs pass their own build through setShape (SHP.anat) */
  const ANAT = (k, u, y, e) => { const H = GT.humans; if (!H || !H.anat || ANAT_OFF) return 0; return H.anat[k](u, y, (SHP && SHP.anat) || H.anat.HERO, e); }, ANAT_OFF = /[?&]anat=0/.test(location.search);
  /* PP: how a top hangs: below the chest it falls straight from the widest part of the chest and the shoulder blades instead of following the waist in (L = looseness, 1 = a tee) */
  const drape = (y, u, L, yT) => { yT = yT || 1.3; if (y >= yT || !L) return 0; const q0 = BODY(yT), q = BODY(clamp(y, .84, 1.52)), c = cos(TAU * u), sn = sin(TAU * u), k = L * sm(yT - y, 0, .1), cf = max(0, c), cb = max(0, -c);
    return k * (sn * sn * max(0, q0[0] * .95 - q[0]) + cf * cf * max(0, q0[1] * .9 - q[1]) + cb * cb * max(0, q0[2] * .92 - q[2])); };
  const dUu = (u, c) => { const d = abs(u - c) % 1; return min(d, 1 - d); };
  /* PP: the ease a top needs below the hip joint so its hem clears the tops of the thighs inside the trousers (m = their ease + a margin): the side, and the front where the thigh is fullest */
  const hipNeed = (y, m) => { if (y >= .99) return 0; m = m === undefined ? .021 : m; const q = BODY(clamp(y, .84, 1.52)), L = LEGK(clamp(y, .06, .97)), A = q[0], F = q[1], cx = L[0], fz = L[2] + L[4] + m; let e = max(0, cx + L[1] + m - A);
    let lo = 0, hi = .09; for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2, a = A + mid, f = F + mid; if ((cx / a) * (cx / a) + (fz / f) * (fz / f) <= 1) hi = mid; else lo = mid; } return max(e, hi) * (1 - sm(y, .95, .99)); };
  /** torso garment / body shell. o: { ys:[...], ease(y,u) | number, bw, n, uv, arc, uvArc, lip, e, disp(u,y), w, vOf(y), tilt } */
  function torsoTube(M, o) { const ys = o.ys, K = ys.length, r = { c: [0, 0, 0], a: 0, f: 0, b: 0, e: o.e || .9, v: 0, y: 0 }, bw = o.bw || 1, y0 = ys[0], y1 = ys[K - 1], lip = o.lip ? 2 : 0, top = o.lipTop ? 2 : 0;
    const es = (y, u) => typeof o.ease === 'function' ? o.ease(y, u) : (o.ease || 0);
    return tube(M, { n: o.n || 44, rings: K + lip + top, uv: o.uv, arc: o.arc, uvArc: o.uvArc, cap1: o.cap1, cap0: o.cap0, w: o.w || wTorso, xf: o.xf,
      ring: i => { let k = i - lip, inset = 0; if (k < 0) { inset = k === -2 ? .016 : .009; k = 0; } let yy = ys[min(k, K - 1)]; if (k >= K) { inset = k === K ? .008 : .016; } const q = BODY(clamp(yy, .84, 1.52));
        r.y = yy; r.inset = inset; r.c = [0, yy + (i < lip ? (i === 0 ? .022 : .004) : 0) - (k >= K ? (k === K ? .003 : .02) : 0), q[3] + (o.cz ? o.cz(yy) : 0)]; r.a = q[0] * bw; r.f = q[1] * (o.fw || bw); r.b = q[2] * (o.fw || bw); r.v = o.vOf ? o.vOf(yy) : (yy - y0) / (y1 - y0); r.tz = o.tilt || 0; return r; },
      disp: (i, u, rr) => es(rr.y, u) - rr.inset + (o.disp ? o.disp(u, rr.y) * (o.lip ? .15 + .85 * sm(rr.y, y0, y0 + .1) : 1) : 0) + (o.flat ? 0 : ANAT('torso', u, rr.y, es(rr.y, u))) + (o.flat ? 0 : .006 * G(abs(u - .5) - .07, .035) * G(rr.y - 1.37, .07) - .005 * G(u - .5, .018) * sm(rr.y, 1.0, 1.15) * (1 - sm(rr.y, 1.36, 1.46)) + .004 * G(abs(u - .5) - .43, .05) * G(rr.y - 1.33, .06) + .011 * G(abs(u - .5) - .075, .05) * G(rr.y - .93, .055)) }); }
  /** sleeve or bare arm. o: { s0, s1, K, ease(s,u)|number, uv, lip, w?, disp(u,s), n } */
  function armTube(M, S, o) { const s0 = o.s0 === undefined ? -.014 : o.s0, s1 = o.s1, K = o.K || 22, lip = o.lip ? 2 : 0, r = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0, s: 0, e: .96 }, es = (s, u) => typeof o.ease === 'function' ? o.ease(s, u) : (o.ease || 0);
    return tube(M, { n: o.n || 18, rings: K + lip, uv: o.uv, mirrorU: S < 0, xf: armXf(S), cap0: s0 < 0, cap1: o.cap1, w: (x, y, z, rr) => wArm(S, rr.s),
      ring: i => { const k = min(i, K - 1), t = k / (K - 1), s = s0 + (s1 - s0) * (s0 < 0 ? pow(t, 1.25) : t), q = ARMK(clamp(s, -.02, .545)), ins = i >= K ? (i === K ? .007 : .014) : 0;
        r.s = s; r.ins = ins; r.c = [-.024 * (1 - sm(s, -.02, .07)) + (o.cx ? o.cx(s) : 0), -s + (i >= K ? (i === K ? .003 : .02) : 0), .002 * sm(s, .2, .5)]; r.a = q[0]; r.f = q[1]; r.b = q[1]; r.v = 1 - (s - s0) / (s1 - s0); return r; },
      disp: (i, u, rr) => es(rr.s, u) * (o.capEase === false ? 1 : sm(rr.s, -.02, .02) * .6 + .4) - rr.ins + (o.disp ? o.disp(u, rr.s) : 0) + (o.flat ? 0 : ANAT('arm', u, rr.s, es(rr.s, u))) }); }
  /** trouser leg / bare leg. o: { y0 (top), y1 (hem), K, ease(y,u)|number, uv, lip, disp(u,y) } */
  function legTube(M, S, o) { const K = o.K || 26, lip = o.lip ? 2 : 0, r = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0, y: 0, e: .95 }, es = (y, u) => typeof o.ease === 'function' ? o.ease(y, u) : (o.ease || 0);
    return tube(M, { n: o.n || 20, rings: K + lip, uv: o.uv, mirrorU: S < 0, xf: mirXf(S), cap0: true, w: (x, y, z, rr) => wLeg(S, rr.y),
      ring: i => { const k = min(i, K - 1), y = o.y0 + (o.y1 - o.y0) * k / (K - 1), q = LEGK(clamp(y, .06, .97)), ins = i >= K ? (i === K ? .007 : .014) : 0;
        r.y = y; r.ins = ins; r.c = [q[0], y + (i >= K ? (i === K ? .003 : .022) : 0), q[4]]; r.a = q[1]; r.f = q[2]; r.b = q[3]; r.v = (y - o.y1) / (o.y0 - o.y1); return r; },
      disp: (i, u, rr) => es(rr.y, u) - rr.ins + (o.disp ? o.disp(u, rr.y) : 0) + (o.flat ? 0 : ANAT('leg', u, rr.y, es(rr.y, u))) }); }

  /* ================================================================== painted atlases */
  const CJK = "'PingFang SC','Hiragino Sans GB','Heiti SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif";
  const R_TOR = [0, .42, 1, 1], R_SLV = [0, 0, .5, .42], R_INN = [.5, .12, 1, .42], R_TRIM = [.5, 0, 1, .12];          // top atlas
  const R_LEG = [0, 0, .5, .72], R_PEL = [0, .72, 1, 1], R_BX = [.5, 0, 1, .72];                                         // bottom atlas
  const NAILU = 0;   /* u of the dorsal centre line round a finger tube (the nail sits there) */
  const R_HEAD = [0, .5, 1, 1], R_ARM = [0, .1, .5, .5], R_HAND = [.5, 0, 1, .5], R_EYE = [0, 0, .125, .1], R_EAR = [.13, 0, .19, .1], R_CON = [.19, 0, .25, .1], R_LID = [.25, 0, .31, .1];                                         // skin atlas
  const R_SHOE = [0, .5, .5, 1], R_HELM = [0, 0, .5, .5], R_GLV = [.5, .5, 1, .75], R_SHAFT = [.5, .75, 1, 1], R_BLK = [.5, 0, .75, .25], R_LENS = [.75, 0, 1, .25], R_MASK = [.5, .25, .75, .5], R_WEB = [.75, .25, 1, .5];   // gear atlas
  const R_PB = [0, .5, .5, 1], R_PS = [.5, .5, 1, 1], R_PT = [0, 0, .5, .5], R_PW = [.5, 0, 1, .25], R_PK = [.5, .25, 1, .5];   // pack atlas
  const TV = y => (y - .84) / .69;                 // torso v from height
  const TEXC = {};
  const TIMES = {}, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const cached = (key, fn) => { if (TEXC[key]) return TEXC[key]; const t0 = now(), r = TEXC[key] = fn(); TIMES['tex ' + key] = round(now() - t0); return r; };
  /** woven cloth shader factory. o: { seed, ro, wr (wrinkle height), weave, kx, twill } */
  const CLOTHC = {};
  function cloth(col, o) { const ck = col + JSON.stringify(o || 0); return CLOTHC[ck] || (CLOTHC[ck] = cloth_(col, o)); }
  function cloth_(col, o) { o = o || {}; const c = rgb(col), s0 = o.seed || 5, sd = 5 + (s0 % 3) * 3, ox = (s0 * 37) & 511, oy = (s0 * 91) & 511, f1 = field(3, 3, 6, sd), f2 = field(24, 24, 3, sd + 1), fw = field(4, 11, 5, sd + 2), wv = o.weave === undefined ? 1 : o.weave, kx = o.kx || 1.9, ro = o.ro === undefined ? .86 : o.ro, wr = o.wr === undefined ? .9 : o.wr;
    return (x, y, out, mul) => { const X = x + ox, Y = y + oy, n1 = fs(f1, X, Y), n2 = fs(f2, X, Y), w = .3 - abs(2 * fs(fw, X, Y) - 1) * .8, tw = o.twill ? ((((x + (y >> 1)) & 3) < 2) ? .8 : -.8) : (((x ^ y) & 1) ? .7 : -.7), k = (mul === undefined ? 1 : mul) * (.85 + n1 * .22 + n2 * .07 + tw * .012 * wv + w * .085 * wr);
      out.r = c[0] * k; out.g = c[1] * k; out.b = c[2] * k; out.h = tw * .035 * wv + w * wr * 1.3 + (n1 - .5) * .5; out.ro = ro + (n2 - .5) * .14; out.me = 0; return w; }; }
  const FH = () => field(2, 22, 5, 71), FV = () => field(40, 2, 5, 72), FD = () => field(5, 5, 6, 73);
  const tint = (o, c, k) => { o.r = lerp(o.r, c[0], k); o.g = lerp(o.g, c[1], k); o.b = lerp(o.b, c[2], k); };
  const reflective = (x, y, o, k) => { const hx = sin(x * 1.05) * sin((y + (floor(x * 1.05 / PI) & 1) * 3) * 1.05); o.r = o.g = (.66 + hx * .05) * k; o.b = (.69 + hx * .05) * k; o.h = .25 + hx * .18; o.ro = .3; o.me = .55; };
  /** the original 「跑得快」 mark: a black disc with a yellow bolt and speed lines. P = pen, (u,v) centre, r in px. */
  function logoMark(P, u, v, r, col, fg) { const g = P.g, x = P.X(u), y = P.Y(v); g.save(); g.translate(x, y); g.fillStyle = col || '#17171a'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.fillStyle = fg || '#e7b417'; g.beginPath(); for (const [px, py] of [[.18, -.72], [-.42, .08], [-.06, .08], [-.28, .74], [.5, -.16], [.1, -.16], [.44, -.72]]) g.lineTo(px * r, py * r); g.closePath(); g.fill();
    g.strokeStyle = col || '#17171a'; g.lineCap = 'round'; g.lineWidth = r * .13; for (const [yy, l] of [[-.38, .8], [0, 1.05], [.38, .7]]) { g.beginPath(); g.moveTo(-r * 1.22, yy * r); g.lineTo(-r * (1.22 + l * .55), yy * r); g.stroke(); } g.restore(); }
  function wordmark(P, u, v, px, col, o) { P.text('跑得快', u, v, px, Object.assign({ c: col || '#17171a', font: CJK, weight: 900, h: .25, ro: .45 }, o || {})); }

  /* ---- tops ---- */
  function paintRiderTop() { return cached('top_rider', () => { const A = new Atlas(1024), yel = cloth(0xd9a514, { seed: 3, ro: .6, wr: 1.25, kx: 2.3 }), blk = cloth(0x1c1d21, { seed: 4, ro: .72, wr: 1 }), yelS = cloth(0xdca811, { seed: 3, ro: .56, wr: .45, weave: 0 }), fh = FH(), fd = FD();
    A.shade(R_TOR, (u, v, x, y, o) => { const side = abs(abs(u - .5) - .25), dirt = 1 - .2 * (1 - sm(v, .04, .26)) * fs(fd, x, y) - .07 * fs(fd, x * 2, y * 2), panel = v < .44 && side < .018, yoke = v > .885 + .01 * cos(TAU * u * 2);
      if (v < .05) { blk(x, y, o, .9); o.h = sin(x * 1.25) * .55; o.ro = .8; return; }
      if (panel) blk(x, y, o, dirt + .08); else { const w = yel(x, y, o, dirt); o.h += (fs(fh, x, y) - .5) * 2.2 * G(v - .3, .16); if (v < .09) o.h -= sm(v, .09, .05) * .5; }
      if (v > .47 && v < .505 && !panel) reflective(x, y, o, dirt * .96 + .04); });
    A.shade(R_SLV, (u, v, x, y, o) => { const dirt = 1 - .16 * (1 - sm(v, .05, .3)) * fs(fd, x, y) - .05 * fs(fd, x * 2, y * 2), el = (fs(fh, x, y * 1.4) - .5) * 2.4 * G(v - .46, .12);
      if (v < .06) { blk(x, y, o, .9); o.h = sin(x * .5) * .05; return; }
      { yelS(x, y, o, dirt * (1 + el * .05)); o.h += el; }   /* sleeves: smooth windbreaker nylon (no 1-texel weave, soft wrinkles): they are the nearest cloth to the eye in first person */
      if (v > .665 && v < .715) reflective(x, y, o, dirt); });
    A.shade(R_TRIM, (u, v, x, y, o) => { blk(x, y, o, 1); o.h = sin(x * 1.25) * .5; });
    A.shade(R_INN, (u, v, x, y, o) => { blk(x, y, o, .8); });
    A.begin(); const P = A.pen(R_TOR), K = 'rgba(20,20,24,.9)';
    for (const uz of [.004, .996]) { P.path([[uz, .05], [uz, .93]]).stroke({ c: '#15151a', w: 9, h: -.3, hw: 11, ro: .6 }); P.path([[uz, .05], [uz, .93]]).stroke({ c: '#8d8f96', w: 3, dash: [2, 2], h: .5, ro: .35, me: .7 }); }
    P.seam([[0, .885], [.125, .893], [.25, .885], [.375, .877], [.5, .875], [.625, .877], [.75, .885], [.875, .893], [1, .885]], { rows: 2, thread: 'rgba(60,50,20,.8)' });
    P.seam([[0, .05], [1, .05]], { rows: 1, thread: 'rgba(60,50,20,.7)' }); 
    for (const s of [.115, .885]) { const d = s < .5 ? 1 : -1; P.path([[s - .028 * d, .34], [s + .03 * d, .2]]).stroke({ c: K, w: 5, h: -.6, hw: 7, ro: .6 }); P.seam([[s - .034 * d, .345], [s - .034 * d + .012 * d, .19], [s + .04 * d, .19]], { rows: 1, thread: 'rgba(60,50,20,.6)' }); }
    /* back print */
    logoMark(P, .505, .8, 40); wordmark(P, .5, .705, 86, '#17171a'); P.path([[.395, .648], [.605, .648]]).stroke({ c: '#17171a', w: 3.5 }); P.text('再 晚 也 送 到', .5, .615, 30, { c: '#17171a', font: CJK, weight: 800 });
    P.text('PAO DE KUAI · RIDER', .5, .572, 15, { c: 'rgba(23,23,26,.85)', weight: 800, font: 'Arial,sans-serif' });
    /* chest: left-chest mark + right-chest rider tag */
    logoMark(P, .072, .735, 15); wordmark(P, .112, .735, 26, '#17171a'); P.rrect(.862, .715, .082, .042, 4).fill({ c: '#e9e6dc', h: .3, ro: .55 }); P.text('骑手 0728', .903, .736, 17, { c: '#1b1b1e', font: CJK, weight: 800 });
    /* wear: cracked print + dust */
    const g = A.g; g.save(); g.globalCompositeOperation = 'multiply'; const rr = GT.rng('ridertop'); for (let i = 0; i < 260; i++) { const x = rr() * 1024, y = 1024 * (1 - (R_TOR[1] + rr() * .2)), r = 4 + rr() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(120,96,66,.16)'); gr.addColorStop(1, 'rgba(120,96,66,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); } g.restore();
    const Ps = A.pen(R_SLV); Ps.seam([[.5, .06], [.5, .9]], { rows: 1, thread: 'rgba(60,50,20,.7)' });  Ps.seam([[0, .06], [1, .06]], { rows: 1 });
    Ps.rrect(.2, .76, .1, .1, 5).fill({ c: '#1a1a1d', h: .35, ro: .5 }); logoMark(Ps, .25, .822, 15, '#e7b417', '#1a1a1d'); Ps.text('跑得快', .25, .782, 15, { c: '#e7b417', font: CJK, weight: 900 });
    return fabricPhoto(A.finish(3.2), 'assets/tex/fabric_jacket_yellow.jpg', [[R_SLV, .07, 1, 230, 1], [R_TOR, .06, .86, 300, .6]]); }); }
  /** H5: the default T-shirt: light heather-grey cotton jersey, ribbed crew neck, double-stitched hems, a generated jersey photo multiplied in (assets/tex/fabric_tee_grey.jpg) */
  function paintTeeTop() { return cached('top_tee', () => { const A = new Atlas(1024), tee = cloth(0xc3c6c6, { seed: 31, ro: .94, wr: .7, kx: 2.8, weave: .35 }), rib = cloth(0xadb0b0, { seed: 32, ro: .95, wr: .3, weave: 0 }), fh = FH(), fd = FD();
    A.shade(R_TOR, (u, v, x, y, o) => { tee(x, y, o, 1 + .035 * fs(fd, x, y) - .06 * (1 - sm(v, .02, .16)) * fs(fd, x * 2, y * 2) - .05 * G(abs(u - .5) - .25, .03)); o.h += (fs(fh, x, y) - .5) * 1.3 * G(v - .3, .18); if (v < .035) o.h -= .3; });
    A.shade(R_SLV, (u, v, x, y, o) => { tee(x, y, o, 1 + .035 * fs(fd, x, y) - .04 * G(u - .5, .04)); o.h += (fs(fh, x, y * 1.3) - .5) * .9; if (v < .07) o.h -= .25; });
    A.shade(R_TRIM, (u, v, x, y, o) => { rib(x, y, o, 1); o.h = sin(x * 1.2) * .45; });
    A.shade(R_INN, (u, v, x, y, o) => { tee(x, y, o, .9); });
    A.begin(); const P = A.pen(R_TOR), th = 'rgba(120,121,118,.55)';
    P.seam([[0, .03], [1, .03]], { rows: 2, thread: th }); for (const s of [.25, .75]) P.seam([[s, .03], [s, .9]], { rows: 0, dark: 'rgba(0,0,0,.12)' }); P.seam([[0, .905], [.25, .915], [.5, .905], [.75, .915], [1, .905]], { rows: 0, dark: 'rgba(0,0,0,.1)' });
    const Ps = A.pen(R_SLV); Ps.seam([[0, .06], [1, .06]], { rows: 2, thread: th }); Ps.seam([[.5, .06], [.5, .98]], { rows: 0, dark: 'rgba(0,0,0,.1)' });
    return fabricPhoto(A.finish(2), 'assets/tex/fabric_tee_grey.jpg', [[R_SLV, 0, 1, 190, .9], [R_TOR, 0, 1, 260, .7]]); }); }
  /** H5: dark-wash jeans with a generated denim photo multiplied in (assets/tex/fabric_denim_dark.jpg) */
  function paintDenimDark() { return cached('bot_denimdark_ph', () => fabricPhoto(paintBottom('darkjeans'), 'assets/tex/fabric_denim_dark.jpg', [[R_LEG, 0, 1, 220, .75, 0], [R_PEL, 0, 1, 220, .6, 0]])); }
  function paintPlainTop() { return cached('top_plain', () => { const A = new Atlas(1024), sh = cloth(0x2a3442, { seed: 13, ro: .9, wr: 1.3, kx: 1.5, twill: true }), tee = cloth(0xdedad0, { seed: 14, ro: .92, wr: .8, kx: 2.6, weave: .5 }), fh = FH(), fd = FD();
    A.shade(R_TOR, (u, v, x, y, o) => { const fade = 1 + .1 * G(v - .88, .06) + .06 * fs(fd, x, y) - .1 * (1 - sm(v, .02, .14)); sh(x, y, o, fade); const cx = sin(x * .19) * .5 + .5, cy = sin(y * .19) * .5 + .5; tint(o, [.38, .22, .2], .1 * (cx > .86 ? 1 : 0) + .08 * (cy > .86 ? 1 : 0)); tint(o, [.08, .1, .14], .16 * (cx < .1 ? 1 : 0) + .16 * (cy < .1 ? 1 : 0)); o.h += (fs(fh, x, y) - .5) * 2 * G(v - .32, .18); });
    A.shade(R_SLV, (u, v, x, y, o) => { const el = (fs(fh, x, y * 1.4) - .5) * 3.2 * G(v - .46, .13); sh(x, y, o, 1 + el * .05 + .05 * fs(fd, x, y)); const cx = sin(x * .19) * .5 + .5, cy = sin(y * .19) * .5 + .5; tint(o, [.38, .22, .2], .1 * (cx > .86 ? 1 : 0) + .08 * (cy > .86 ? 1 : 0)); tint(o, [.08, .1, .14], .16 * (cx < .1 ? 1 : 0) + .16 * (cy < .1 ? 1 : 0)); o.h += el; });
    A.shade(R_INN, (u, v, x, y, o) => { tee(x, y, o, 1 - .1 * (1 - sm(v, 0, .2)) * fs(fd, x, y) - .05 * G(v - .9, .08)); o.h += (fs(fh, x, y) - .5) * 1.6 * G(v - .3, .2); });
    A.shade(R_TRIM, (u, v, x, y, o) => { sh(x, y, o, .92); });
    A.begin(); const P = A.pen(R_TOR), th = 'rgba(150,160,175,.6)';
    P.seam([[0, .86], [.2, .868], [.5, .845], [.8, .868], [1, .86]], { rows: 2, thread: th }); P.seam([[.5, .845], [.5, .1]], { rows: 0, dark: 'rgba(0,0,0,.2)' }); P.seam([[0, .075], [1, .075]], { rows: 1, thread: th });
    for (const s of [.045, .955]) { P.seam([[s, .06], [s, .93]], { rows: 1, thread: th }); for (let i = 0; i < 6; i++) { P.ellipse(s < .5 ? s - .02 : s + .02, .2 + i * .115, .0055, .0075).fill({ c: '#c9c3b4', h: .6, ro: .4 }); } }
    for (const s of [.115, .885]) { P.rrect(s - .05, .62, .1, .115, 3).stroke({ c: 'rgba(0,0,0,.4)', w: 2, h: -.5, hw: 3 }); P.seam([[s - .05, .7], [s + .05, .7]], { rows: 1, thread: th }); P.ellipse(s, .715, .0055, .0075).fill({ c: '#c9c3b4', h: .6, ro: .4 }); }
    const Ps = A.pen(R_SLV); Ps.seam([[.5, .0], [.5, .95]], { rows: 1, thread: th }); Ps.seam([[0, .11], [1, .11]], { rows: 2, thread: th });
    const Pi = A.pen(R_INN); Pi.seam([[0, .07], [1, .07]], { rows: 2, thread: 'rgba(120,118,110,.55)', dark: 'rgba(0,0,0,.14)' }); Pi.seam([[.25, .07], [.25, .8]], { rows: 0, dark: 'rgba(0,0,0,.1)' }); Pi.seam([[.75, .07], [.75, .8]], { rows: 0, dark: 'rgba(0,0,0,.1)' });
    Pi.text('江 城', .09, .76, 20, { c: 'rgba(40,44,52,.82)', font: CJK, weight: 800 });
    return A.finish(2.2); }); }
  function paintBomberTop() { return cached('top_jacket', () => { const A = new Atlas(1024), ny = cloth(0x39402f, { seed: 23, ro: .5, wr: 1.6, kx: 2.9, weave: .5 }), rib = cloth(0x23261f, { seed: 24, ro: .9 }), fh = FH(), fd = FD(), fv = FV();
    A.shade(R_TOR, (u, v, x, y, o) => { if (v < .075 || v > .93) { rib(x, y, o, 1); o.h = sin(x * 1.0) * .6; return; } ny(x, y, o, 1 + .08 * fs(fd, x, y) - .12 * (1 - sm(v, .07, .2)) * fs(fd, x * 2, y)); o.h += (fs(fh, x, y) - .5) * 3 * (G(v - .16, .1) + .4) + (fs(fv, x, y) - .5) * .8; });
    A.shade(R_SLV, (u, v, x, y, o) => { if (v < .085) { rib(x, y, o, 1); o.h = sin(x * 1.0) * .6; return; } const el = (fs(fh, x, y * 1.3) - .5) * 4 * (G(v - .46, .16) + .35); ny(x, y, o, 1 + el * .05 + .06 * fs(fd, x, y)); o.h += el; });
    A.shade(R_TRIM, (u, v, x, y, o) => { rib(x, y, o, 1); o.h = sin(x * 1.0) * .6; }); A.shade(R_INN, (u, v, x, y, o) => { cloth(0xb5501e, { seed: 25, ro: .6 })(x, y, o, 1); });
    A.begin(); const P = A.pen(R_TOR), th = 'rgba(30,34,24,.8)';
    for (const uz of [.004, .996]) { P.path([[uz, .075], [uz, .93]]).stroke({ c: '#14150f', w: 10, h: -.3, hw: 12 }); P.path([[uz, .075], [uz, .93]]).stroke({ c: '#9a958a', w: 3, dash: [2, 2], h: .5, ro: .3, me: .8 }); }
    P.seam([[0, .075], [1, .075]], { rows: 1, thread: th }); P.seam([[0, .93], [1, .93]], { rows: 1, thread: th }); P.seam([[.25, .08], [.25, .7]], { rows: 1, thread: th }); P.seam([[.75, .08], [.75, .7]], { rows: 1, thread: th });
    for (const s of [.12, .88]) { const d = s < .5 ? 1 : -1; P.path([[s - .03 * d, .36], [s + .035 * d, .2]]).stroke({ c: 'rgba(0,0,0,.6)', w: 6, h: -.7, hw: 8 }); P.seam([[s - .04 * d, .37], [s + .045 * d, .185]], { rows: 1, thread: th, off: 7 }); P.ellipse(s, .29, .006, .008).fill({ c: '#77736a', h: .7, ro: .3, me: .8 }); }
    const Ps = A.pen(R_SLV); Ps.seam([[.5, .085], [.5, .95]], { rows: 1, thread: th }); Ps.seam([[0, .085], [1, .085]], { rows: 1, thread: th }); Ps.rrect(.19, .62, .12, .17, 3).stroke({ c: 'rgba(0,0,0,.5)', w: 2.5, h: -.5, hw: 4 }); Ps.path([[.2, .76], [.3, .76]]).stroke({ c: '#8a867b', w: 3, dash: [2, 2], h: .5, ro: .3, me: .8 }); Ps.rrect(.275, .64, .016, .1, 2).fill({ c: '#b5501e', h: .3 });
    return A.finish(2.6); }); }
  function paintKitchenTop() { return cached('top_kitchen', () => { const A = new Atlas(1024), tee = cloth(0xb9b6ab, { seed: 33, ro: .93, wr: .9, kx: 2.6, weave: .5 }), ap = cloth(0x6e2622, { seed: 34, ro: .82, wr: .9, kx: 1.4, twill: true }), fh = FH(), fd = FD();
    A.shade(R_TOR, (u, v, x, y, o) => { const st = fs(fd, x * 1.5, y * 1.5); tee(x, y, o, 1 - .16 * (1 - sm(v, 0, .25)) * fs(fd, x, y) - .07 * G(v - .9, .07) - .1 * sm(st, .62, .8)); tint(o, [.55, .47, .3], .1 * sm(st, .55, .8)); o.h += (fs(fh, x, y) - .5) * 1.8 * G(v - .32, .2); });
    A.shade(R_SLV, (u, v, x, y, o) => { tee(x, y, o, 1 - .1 * fs(fd, x, y)); o.h += (fs(fh, x, y) - .5) * 1.4; });
    A.shade([.5, 0, 1, .42], (u, v, x, y, o) => { const st = fs(fd, x * 1.3 + 90, y * 1.3), wet = sm(st, .56, .72) * sm(v, .75, .3); ap(x, y, o, 1 - .2 * wet - .08 * fs(fd, x * 3, y * 3)); o.ro -= wet * .3; tint(o, [.75, .7, .62], .1 * sm(fs(fd, x * 4 + 40, y * 4), .7, .8)); o.h += (fs(fh, y, x) - .5) * 1.2; });
    A.begin(); const P = A.pen(R_TOR), th = 'rgba(120,118,110,.5)'; P.seam([[0, .14], [1, .14]], { rows: 2, thread: th, dark: 'rgba(0,0,0,.14)' }); P.seam([[.25, .14], [.25, .8]], { rows: 0, dark: 'rgba(0,0,0,.1)' }); P.seam([[.75, .14], [.75, .8]], { rows: 0, dark: 'rgba(0,0,0,.1)' });
    const Ps = A.pen(R_SLV); Ps.seam([[0, .08], [1, .08]], { rows: 2, thread: th, dark: 'rgba(0,0,0,.14)' });
    const Pa = A.pen([.5, 0, 1, .42]), ta = 'rgba(214,190,150,.75)'; Pa.seam([[.02, .02], [.02, .7], [.2, .985], [.8, .985], [.98, .7], [.98, .02], [.02, .02]], { rows: 1, thread: ta, off: 4 });
    Pa.rrect(.2, .2, .6, .2, 3).stroke({ c: 'rgba(0,0,0,.4)', w: 2.5, h: -.5, hw: 4 }); Pa.seam([[.2, .4], [.8, .4]], { rows: 1, thread: ta }); Pa.seam([[.5, .2], [.5, .4]], { rows: 1, thread: ta });
    Pa.text('辣姐火锅', .5, .8, 44, { c: '#e3c489', font: CJK, weight: 900, h: .2 }); Pa.text('四方街 · 老灶', .5, .72, 19, { c: 'rgba(227,196,137,.85)', font: CJK, weight: 700 }); Pa.ellipse(.5, .885, .05, .028).stroke({ c: '#e3c489', w: 3 }); Pa.text('辣', .5, .885, 22, { c: '#e3c489', font: CJK, weight: 900 });
    return A.finish(2.2); }); }
  function paintHoodieTop() { return cached('top_hoodie', () => { const A = new Atlas(1024), fl = cloth(0x4d5560, { seed: 43, ro: .95, wr: 1.3, kx: 2.2, weave: .7 }), rib = cloth(0x454c57, { seed: 44, ro: .95 }), fh = FH(), fd = FD();
    A.shade(R_TOR, (u, v, x, y, o) => { if (v < .08) { rib(x, y, o, .95); o.h = sin(x * .95) * .6; return; } fl(x, y, o, 1 + .08 * fs(fd, x, y) - .1 * (1 - sm(v, .08, .22)) * fs(fd, x * 2, y)); o.h += (fs(fh, x, y) - .5) * 2.6 * (G(v - .2, .12) + .3); });
    A.shade(R_SLV, (u, v, x, y, o) => { if (v < .09) { rib(x, y, o, .95); o.h = sin(x * .95) * .6; return; } const el = (fs(fh, x, y * 1.3) - .5) * 3.6 * (G(v - .46, .16) + .3); fl(x, y, o, 1 + el * .05 + .06 * fs(fd, x, y)); o.h += el; });
    A.shade([.5, 0, 1, .42], (u, v, x, y, o) => { fl(x, y, o, .93 + .08 * fs(fd, x, y)); o.h += (fs(fh, y, x) - .5) * 2; });
    A.begin(); const P = A.pen(R_TOR), th = 'rgba(40,46,54,.7)'; P.seam([[0, .08], [1, .08]], { rows: 2, thread: th });
    P.path([[.89, .2], [.93, .36], [1, .37]]).stroke({ c: 'rgba(0,0,0,.45)', w: 4, h: -.6, hw: 6 }); P.path([[.11, .2], [.07, .36], [0, .37]]).stroke({ c: 'rgba(0,0,0,.45)', w: 4, h: -.6, hw: 6 }); P.seam([[.87, .19], [.92, .38], [1, .385]], { rows: 1, thread: th }); P.seam([[.13, .19], [.08, .38], [0, .385]], { rows: 1, thread: th }); P.seam([[.89, .2], [1, .2]], { rows: 1, thread: th }); P.seam([[0, .2], [.11, .2]], { rows: 1, thread: th });
    P.text('四方街', .5, .72, 54, { c: 'rgba(214,208,196,.9)', font: CJK, weight: 900, h: .2, ro: .5 }); P.text('SIFANG ST. 江城', .5, .66, 19, { c: 'rgba(214,208,196,.8)', font: CJK, weight: 800 });
    const Ps = A.pen(R_SLV); Ps.seam([[0, .09], [1, .09]], { rows: 2, thread: th }); Ps.seam([[.5, .09], [.5, .95]], { rows: 0 });
    return A.finish(2.4); }); }

  /* ---- bottoms ---- */
  function paintBottom(kind) { return cached('bot_' + kind, () => { const A = new Atlas(1024), fh = FH(), fd = FD(), fv = FV();
    const D = { work: [0x26282c, { ro: .8, wr: .5, kx: 2.2 }, 'rgba(70,70,74,.7)'], jeans: [0x34465e, { ro: .88, wr: .45, kx: 1.7, twill: true }, 'rgba(196,140,62,.85)'], darkjeans: [0x1f2839, { ro: .86, wr: .45, kx: 1.7, twill: true }, 'rgba(182,132,66,.8)'], black: [0x1b1c20, { ro: .86, wr: .45, kx: 1.7, twill: true }, 'rgba(70,70,76,.8)'], chef: [0x30323a, { ro: .9, wr: .6, kx: 2 }, 'rgba(80,80,88,.6)'], jogger: [0x767a80, { ro: .95, wr: .6, kx: 2.3, weave: .6 }, 'rgba(60,62,66,.6)'] }[kind];
    const cl = cloth(D[0], Object.assign({ seed: 50 + kind.length }, D[1])), th = D[2], denim = kind === 'jeans' || kind === 'black' || kind === 'darkjeans';
    A.shade(R_LEG, (u, v, x, y, o) => { const front = G(min(u, 1 - u), .16), knee = (fs(fh, x, y * 1.2) - .5) * 3.4 * G(v - .47, .1), stack = (fs(fh, x, y * 2.2) - .5) * 4.5 * (1 - sm(v, .02, .2)), back = G(u - .5, .13);
      let k = 1 + .05 * fs(fd, x, y) + (knee + stack) * .05; if (denim) k += .2 * front * G(v - .74, .2) + .14 * front * G(v - .47, .07) + .1 * back * G(v - .86, .1) + (fs(fv, x, y) - .5) * .1; k -= .2 * (1 - sm(v, 0, .12)) * fs(fd, x * 2, y * 2);
      cl(x, y, o, k); o.h += knee + stack + (fs(fh, x, y) - .5) * 1.5 * back * G(v - .42, .08);
      if (kind === 'chef') { const c = ((floor(x / 5) + floor(y / 5)) & 1); o.r *= .82 + c * .3; o.g *= .82 + c * .3; o.b *= .82 + c * .3; }
      if (kind === 'work' && v > .3 && v < .33) reflective(x, y, o, .8);
      if (kind === 'jogger' && v < .075) { o.h = sin(x * 1.0) * .6; o.r *= .9; o.g *= .9; o.b *= .9; } });
    A.shade(R_PEL, (u, v, x, y, o) => { const back = G(u - .5, .2); let k = 1 + .06 * fs(fd, x, y); if (denim) k += .16 * G(abs(u - .5) - .085, .05) * G(v - .45, .3) + (fs(fv, x, y) - .5) * .1; cl(x, y, o, k); o.h += (fs(fh, x, y) - .5) * 1.6 * (1 - back * .5);
      if (kind === 'chef') { const c = ((floor(x / 5) + floor(y / 5)) & 1); o.r *= .82 + c * .3; o.g *= .82 + c * .3; o.b *= .82 + c * .3; }
      if (kind === 'jogger' && v > .84) { o.h = sin(x * 1.0) * .6; } });
    A.begin(); const P = A.pen(R_LEG), Pp = A.pen(R_PEL);
    P.seam([[.25, 0], [.25, 1]], { rows: denim ? 2 : 1, thread: th }); P.seam([[.75, 0], [.75, 1]], { rows: 1, thread: th }); P.seam([[0, .035], [1, .035]], { rows: denim ? 2 : 1, thread: th });
    if (kind === 'work') { P.seam([[0, .56], [.25, .58], [.5, .56]], { rows: 2, thread: th }); P.seam([[0, .39], [.25, .37], [.5, .39]], { rows: 2, thread: th }); P.rrect(.19, .62, .13, .15, 3).stroke({ c: 'rgba(0,0,0,.5)', w: 2.5, h: -.5, hw: 4 }); P.seam([[.19, .735], [.32, .735]], { rows: 1, thread: th }); }
    Pp.seam([[0, .86], [1, .86]], { rows: denim ? 2 : 1, thread: th });
    if (kind !== 'jogger' && kind !== 'chef') { for (const lu of [.06, .22, .4, .5, .6, .78, .94]) Pp.rrect(lu - .006, .82, .012, .17, 2).fill({ c: 'rgba(0,0,0,.25)', h: .7 }); Pp.seam([[.25, 0], [.25, .86]], { rows: 1, thread: th }); Pp.seam([[.75, 0], [.75, .86]], { rows: 1, thread: th });
      Pp.seam([[.26, .78], [.5, .64], [.74, .78]], { rows: 2, thread: th }); Pp.seam([[.5, .64], [.5, 0]], { rows: 2, thread: th });
      for (const s of [.405, .595]) { const w = .07, pts = [[s - w, .6], [s + w, .6], [s + w * .92, .2], [s, .08], [s - w * .92, .2], [s - w, .6]]; Pp.path(pts, true).fill({ c: 'rgba(0,0,0,.07)', h: .35 }); Pp.seam(pts, { rows: 2, thread: th, side: -1 }); if (denim) Pp.path([[s - w * .8, .42], [s, .34], [s + w * .8, .42]]).stroke({ c: th, w: 1.4, dash: [3, 2] }); }
      if (denim) Pp.rrect(.63, .87, .05, .1, 2).fill({ c: '#8c6a44', h: .5, ro: .6 });
      for (const s of [.1, .9]) { const d = s < .5 ? 1 : -1; Pp.seam([[s - .08 * d, .86], [s - .04 * d, .62], [s + .1 * d, .5]], { rows: 2, thread: th }); } Pp.seam([[.004, 0], [.004, .86]], { rows: 2, thread: th }); Pp.ellipse(.0, .92, .009, .04).fill({ c: '#8a857a', h: .7, ro: .3, me: .8 }); Pp.ellipse(1, .92, .009, .04).fill({ c: '#8a857a', h: .7, ro: .3, me: .8 }); }
    else { Pp.seam([[.5, .86], [.5, 0]], { rows: 1, thread: th }); Pp.path([[.02, .9], [.03, .55]]).stroke({ c: '#d8d4c8', w: 3, h: .6 }); Pp.path([[.98, .9], [.965, .5]]).stroke({ c: '#d8d4c8', w: 3, h: .6 }); for (const s of [.11, .89]) { const d = s < .5 ? 1 : -1; Pp.path([[s - .03 * d, .8], [s + .05 * d, .4]]).stroke({ c: 'rgba(0,0,0,.45)', w: 3.5, h: -.6, hw: 5 }); } }
    return A.finish(2.4); }); }

  /* ---- skin, hair ---- */
  const SKINC = { kai: 0xbd9070, lie: 0xcba383 }, HAIRC = { kai: 0x16120f, lie: 0x1d1612 };
  const HVK = [[1.38, 0], [1.56, .14], [1.72, .8], [HTOP, 1]];          // head texture v: most of it goes to the face
  const HV = y => { let i = 1; while (i < 3 && y > HVK[i][0]) i++; return lerp(HVK[i - 1][1], HVK[i][1], (y - HVK[i - 1][0]) / (HVK[i][0] - HVK[i - 1][0])); };
  const HVI = v => { let i = 1; while (i < 3 && v > HVK[i][1]) i++; return lerp(HVK[i - 1][0], HVK[i][0], (v - HVK[i - 1][1]) / (HVK[i][1] - HVK[i - 1][1])); };
  const eyeTop = ex => EYE.y + .0012 * ex + .005 * pow(max(0, 1 - ex * ex), .65), eyeBot = ex => EYE.y + .0012 * ex - .0032 * pow(max(0, 1 - ex * ex), .8);
  function paintSkin(who) { return cached('skin_' + who, () => { const A = new Atlas(1024), sk = rgb(SKINC[who]), hc = rgb(HAIRC[who]), f1 = field(4, 4, 6, 91), f2 = field(48, 48, 3, 92), f3 = field(128, 128, 2, 93), fa = field(2, 30, 4, 95), fhr = field(300, 36, 2, 96), rect = R_HEAD, kai = who === 'kai';
    const base = (x, y, o, k) => { const n = fs(f1, x, y), m = fs(f2, x, y); o.r = sk[0] * k * (.95 + n * .1); o.g = sk[1] * k * (.93 + n * .12 + m * .02); o.b = sk[2] * k * (.92 + n * .12 + m * .03); o.h = (m - .5) * .14 + (fs(f3, x, y) - .5) * .12; o.ro = .52 + m * .1 + n * .06; o.me = 0; };
    A.shade(rect, (u, v, x, y, o) => { const yy = HVI(v), du = u > .5 ? u - 1 : u, adu = abs(du), hl = hairline(who, u), back = G(u - .5, .16);
      base(x, y, o, 1 - .1 * back * G(yy - 1.56, .06) + .035 * G(du, .1) * G(yy - 1.725, .03) + .03 * G(adu - .12, .04) * G(yy - 1.66, .012));
      if (yy < 1.575) { const q = sm(yy, 1.575, 1.53); o.h *= 1 - .85 * q; const kk = 1 - .1 * back * G(yy - 1.56, .06); o.r = lerp(o.r, sk[0] * kk, .8 * q); o.g = lerp(o.g, sk[1] * kk * .99, .8 * q); o.b = lerp(o.b, sk[2] * kk * .985, .8 * q); }   /* PP: few texels cover the neck: its noise ran into vertical streaks */
      if (adu < .34 && yy > 1.5 && yy < 1.76) {
      const warm = .075 * G(adu - .125, .05) * G(yy - 1.646, .02) + .08 * G(du, .03) * G(yy - 1.646, .012) + .06 * G(adu - .25, .04) * G(yy - 1.675, .03) + .03 * G(du, .06) * G(yy - 1.59, .01); o.r *= 1 + warm * .6; o.g *= 1 - warm * .45; o.b *= 1 - warm * .6;
      const ao = .2 * G(adu - .046, .018) * G(yy - 1.681, .009) + .13 * G(adu - .07, .036) * G(yy - 1.6865, .0035) + .09 * G(adu - .072, .03) * G(yy - 1.669, .0045) + .2 * G(du, .05) * G(yy - 1.6335, .003) + .1 * G(du, .04) * G(yy - 1.5995, .004) + .08 * G(adu - .04, .012) * G(yy - 1.641, .008)
        + .17 * sm(yy, 1.585, 1.568) * sm(yy, 1.49, 1.555) * sm(adu, .42, .1) + .06 * G(adu - .16, .05) * G(yy - 1.612, .016); o.r *= 1 - ao * .8; o.g *= 1 - ao; o.b *= 1 - ao;
      { const st = sm(adu, .24, .15) * sm(yy, 1.645, 1.618) * sm(yy, 1.552, 1.575) * (1 - .85 * G(du, .05) * G(yy - 1.612, .0075)) * (.45 + .55 * fs(f3, x * 2, y * 2)); tint(o, [.25, .24, .25], st * (kai ? .3 : .1)); } }
      const k = sm(yy, hl - .018, hl + .012), dots = sm(fs(f3, x * 1.5, y * 1.5) + k * 1.1, .7, 1.1); if (k > 0) { tint(o, [hc[0] * 1.3, hc[1] * 1.3, hc[2] * 1.3], max(dots * .85, sm(yy, hl + .004, hl + .02))); o.ro = lerp(o.ro, .8, k); }
      const ex = (adu - EYE.du) / EYE.hw; if (ex > -1 && ex < 1 && yy < eyeTop(ex) && yy > eyeBot(ex)) { o.a = 0; if (abs(ex) < .42) { o.r = .13; o.g = .08; o.b = .06; } else { o.r = .72; o.g = .68; o.b = .64; } } });
    A.shade(R_ARM, (u, v, x, y, o) => { base(x, y, o, .9 - .03 * G(u - .25, .2) + .02 * G(u - .75, .15)); o.g *= .975; o.b *= .94; o.h += (fs(fa, x, y) - .5) * .5 * G(v - .46, .04);
      if (kai) { const dor = sm(min(abs(u - .25), 1 - abs(u - .25)), .3, .08), hr = sm(fs(fhr, x, y), .76, .9) * dor * (.3 + .7 * sm(v, .02, .25)); o.r *= 1 - .07 * hr; o.g *= 1 - .09 * hr; o.b *= 1 - .1 * hr; o.h += hr * .08; o.ro = lerp(o.ro, .64, hr); } });   /* H5: bare forearms in first person: fine dark hair along the outer side, thinning towards the wrist */
    A.shade(R_HAND, (u, v, x, y, o) => { base(x, y, o, .88); o.g *= .975; o.b *= .94;   /* H4: a shade darker and warmer, the hands washed out to dough in direct sun */ const dd = min(abs(u - .25), 1 - abs(u - .25)), dor = sm(dd, .3, .12), pal = sm(dd, .2, .38);
      if (v < .5) { /* digits (tt = 0 at the root, 1 at the tip): wrinkled knuckles on the back, three creases and pink pads underneath, shaded sides, a nail with a cuticle, a lunula and a pale free edge */
        const tt = 1 - 2 * v, side = G(dd - .25, .07), wr = dor * (G(tt - .45, .032) * (.5 + .5 * cos((tt - .45) * TAU * 55)) + G(tt - .72, .022) * (.5 + .5 * cos((tt - .72) * TAU * 70))), kn = dor * (G(tt - .45, .045) + G(tt - .72, .035) + G(tt - .06, .05)), cr = pal * (G(tt - .06, .006) + G(tt - .45, .006) + .5 * G(tt - .47, .004) + G(tt - .72, .005));
        const sh = (1 - .13 * side) * (1 - .13 * wr) * (1 - .15 * cr); o.r *= sh * (1 + .07 * kn + .05 * pal); o.g *= sh * (1 - .05 * kn - .03 * pal); o.b *= sh * (1 - .07 * kn - .05 * pal); o.h -= wr * .5 + cr * .9;
        const tipw = sm(tt, .76, 1) * pal; o.r *= 1 + .06 * tipw; o.g *= 1 - .05 * tipw; o.b *= 1 - .06 * tipw;
        const nl = sm(tt, .775, .8) * sm(tt, .975, .955) * sm(dd, .135, .105), cut = (G(tt - .775, .007) * sm(dd, .16, .1) + G(dd - .125, .014) * sm(tt, .76, .8) * sm(tt, .98, .94)) * (1 - nl * .6); o.r *= 1 - .2 * cut; o.g *= 1 - .24 * cut; o.b *= 1 - .26 * cut;
        if (nl > 0) { const lun = sm(tt, .86, .8) * sm(dd, .1, .03), edge = sm(tt, .93, .955); o.r = lerp(o.r, lerp(sk[0] * 1.08 + .06 + lun * .1, .9, edge), nl * .9); o.g = lerp(o.g, lerp(sk[1] * .93 + .05 + lun * .13, .86, edge), nl * .9); o.b = lerp(o.b, lerp(sk[2] * .95 + .06 + lun * .14, .8, edge), nl * .9); o.ro = lerp(o.ro, .24, nl); o.h += nl * .6; } }
      else { /* palm loft (tp = 0 forearm end, 1 knuckles): red knuckles and faint veins on the back; a pinker palm with wrist creases, the line round the ball of the thumb and two lines across */
        const tp = 2 * (1 - v), kn = dor * G(tp - .955, .045), vein = dor * sm(tp, .25, .45) * sm(tp, .92, .75) * G(fs(fa, x * .5, y * .22) - .5, .04), wc = pal * (G(tp - .13, .006) + .7 * G(tp - .165, .005));
        const dth = Math.hypot(min(abs(u - .9), 1 - abs(u - .9)) / .15, (tp - .4) / .3), life = G(dth - 1, .024) * .8 * (u > .6 && u < .89 ? 1 : 0) * sm(tp, .2, .3), head = G(tp - (.63 + .3 * (u - .75)), .007) * sm(u, .6, .66) * sm(u, .9, .84), heart = G(tp - (.79 - .22 * (u - .75)), .007) * sm(u, .56, .62) * sm(u, .84, .78), ln = pal * max(life, head, heart);
        const sh = (1 - .13 * wc) * (1 - .13 * ln) * (1 - .06 * pal * sm(tp, .3, .12)); o.r *= sh * (1 + .07 * kn + .05 * pal - .03 * vein); o.g *= sh * (1 - .05 * kn - .03 * pal); o.b *= sh * (1 - .07 * kn - .05 * pal + .03 * vein); o.h += kn * .4 - (wc + ln) * .9; } });
    A.shade(R_EYE, (u, v, x, y, o) => { const dx = (u - .5) / .215, dy = (v - .5) / .232, r = sqrt(dx * dx + dy * dy), vein = fs(f2, x * 3, y * 3), edge = sm(Math.hypot((u - .5) * 2, (v - .5) * 2), .45, 1);
      o.r = .86 - .22 * edge + .04 * vein; o.g = .83 - .3 * edge; o.b = .8 - .32 * edge; o.h = 0; o.ro = .12; o.me = 0;
      if (r < 1.06) { const k = sm(r, 1.06, .92), fib = fs(f3, atan2(dy, dx) * 40 + 300, r * 12), ic = [.2 + .16 * fib * sm(r, .25, .7), .11 + .08 * fib * sm(r, .25, .7), .05 + .03 * fib], rim = sm(r, .7, 1); o.r = lerp(o.r, ic[0] * (1 - .6 * rim), k); o.g = lerp(o.g, ic[1] * (1 - .6 * rim), k); o.b = lerp(o.b, ic[2] * (1 - .6 * rim), k); if (r < .4) { o.r = o.g = o.b = .012; } }
      const hx = (u - .5) / .215 + .38, hy = (v - .5) / .232 - .42, hl = G(Math.hypot(hx, hy), .16); o.r += hl * .8; o.g += hl * .8; o.b += hl * .8; o.r *= 1 - .35 * sm(v, .55, .95); o.g *= 1 - .35 * sm(v, .55, .95); o.b *= 1 - .35 * sm(v, .55, .95); });
    A.shade(R_EAR, (u, v, x, y, o) => { base(x, y, o, 1.02); o.r *= 1.06; o.g *= .95; o.b *= .93; });
    A.shade(R_LID, (u, v, x, y, o) => { base(x, y, o, .9 - .12 * sm(v, .6, .2)); if (v < .16) { o.r = .08; o.g = .05; o.b = .045; } });
    A.shade(R_CON, (u, v, x, y, o) => { base(x, y, o, .72); o.r *= 1.08; o.g *= .9; o.b *= .88; });
    A.begin(); const P = A.pen(rect), hair = css([hc[0] * 1.2, hc[1] * 1.2, hc[2] * 1.2]), rr = GT.rng('face_' + who);
    for (const s of [1, -1]) { const U = d => s > 0 ? d : 1 - d, EX = ex => U(EYE.du + EYE.hw * ex), up = [], lo = [], cr = [];
      for (let i = 0; i <= 12; i++) { const ex = -1 + i / 6; up.push([EX(ex), HV(eyeTop(ex) + .0003)]); lo.push([EX(ex), HV(eyeBot(ex) - .0002)]); cr.push([EX(ex * 1.02), HV(eyeTop(ex) + .0028 + .0014 * (1 - ex * ex))]); }
      P.path(cr).stroke({ c: 'rgba(70,38,30,.45)', w: 2, blur: .7, h: -.5, hw: 3, hb: 1 }); P.path(up).stroke({ c: '#1c1210', w: 2.3, h: .3, hw: 3, cap: 'round' }); P.path(up.slice(7)).stroke({ c: '#1c1210', w: 3, cap: 'round' }); P.path(lo).stroke({ c: 'rgba(74,40,34,.6)', w: 1.5 });
      const kb = kai ? 1 : .8; for (let i = 0; i < 90; i++) { const t = rr(), d = .03 + .087 * t, yb = 1.6975 + .005 * sm(t, 0, .55) - .005 * sm(t, .55, 1) + (rr() - .5) * .0046 * (1 - .55 * t) * kb; P.path([[U(d), HV(yb)], [U(d + .009), HV(yb + .0022 - .0045 * t)]]).stroke({ c: hair, w: 1.7 * kb, a: .78, cap: 'round' }); }
      P.path([[U(.03), HV(1.698)], [U(.07), HV(1.7025)], [U(.115), HV(1.6975)]]).stroke({ c: hair, w: 5 * kb, blur: 1.6, a: .5, cap: 'round' });
      P.path([[U(0), HV(1.6196)], [U(.012), HV(1.6216)], [U(.034), HV(1.6176)], [U(.062), HV(1.6123)], [U(.034), HV(1.6119)], [U(0), HV(1.6119)]], true).fill({ c: 'rgba(140,76,68,.62)', blur: 1 });
      P.path([[U(0), HV(1.6119)], [U(.034), HV(1.6117)], [U(.06), HV(1.6123)], [U(.04), HV(1.6048)], [U(.016), HV(1.602)], [U(0), HV(1.6013)]], true).fill({ c: 'rgba(158,90,80,.55)', blur: 1 });
      P.path([[U(0), HV(1.612)], [U(.034), HV(1.6117)], [U(.065), HV(1.6128)]]).stroke({ c: 'rgba(52,22,18,.9)', w: 1.8, cap: 'round' });
      P.ellipse(U(.024), HV(1.6372), .0105, .011).fill({ c: 'rgba(36,16,12,.85)', blur: 1.4 }); }
    const out = skinPhoto(A.finish(1.5)); if (GT.humans && !/[?&]faces=0/.test(location.search)) GT.humans.bakeFace(out, { id: 'm1', mir: !kai }, { mode: 'hero', rect: R_HEAD }); return out; }); }   /* PP: a photographic face (js/humans.js) over the painted one */
  /* photographic skin detail: two generated macro photos (back of the hand, palm) are multiplied, mean-normalised, into the hand and forearm regions of the painted atlas once they have loaded */
  /* H4: a generated photograph of the real cloth (creases, ripstop grid, dust) multiplied into a painted garment atlas once it has loaded. rects: [atlas rect, v from, v to, tile px, strength] */
  function fabricPhoto(out, url, rects) { const Li = GT.tex && GT.tex.imageEl; if (!Li || !out || !out.map) return out; Li(url, img => { try { const cv = out.map.image, S = cv.width, g = cv.getContext('2d');
        for (const R of rects) { const rect = R[0], N = R[3], kS = R[4], c = mkCanvas(N, N), q = c.getContext('2d'); q.drawImage(img, 0, 0, N, N); const td = q.getImageData(0, 0, N, N).data; let m = 0; for (let i = 0; i < td.length; i += 4) m += td[i] * .3 + td[i + 1] * .59 + td[i + 2] * .11; m /= td.length / 4;
          const x0 = round(rect[0] * S), w = round((rect[2] - rect[0]) * S), yT = round((1 - (rect[1] + (rect[3] - rect[1]) * R[2])) * S), yB = round((1 - (rect[1] + (rect[3] - rect[1]) * R[1])) * S), h = yB - yT, im = g.getImageData(x0, yT, w, h), d = im.data;
          for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) { const i = (py * w + px) * 4; if (d[i] < (R[5] === undefined ? 70 : R[5]) && d[i + 1] < (R[5] === undefined ? 70 : R[5])) continue; /* black trim, prints (R[5]: the cut-off, 0 for dark cloth) */ const j = ((py % N) * N + (px % N)) * 4, l = (td[j] * .3 + td[j + 1] * .59 + td[j + 2] * .11) / m, k = clamp(1 + (l - 1) * 1.5 * kS, .62, 1.3); d[i] *= k; d[i + 1] *= k; d[i + 2] *= k * (1 - .04 * kS); } g.putImageData(im, x0, yT); }
        out.map.needsUpdate = true; } catch (e) { console.warn('[hero] fabric photo', e); } }); return out; }
  function skinPhoto(out) { const Li = GT.tex && GT.tex.imageEl; if (!Li || !out || !out.map) return out; Li('assets/tex/skin_hand_back.jpg', ib => Li('assets/tex/skin_palm.jpg', ip => { try { const cv = out.map.image, S = cv.width, g = cv.getContext('2d'), N = 160;
        const tile = img => { const c = mkCanvas(N, N), q = c.getContext('2d'); q.drawImage(img, 0, 0, N, N); const d = q.getImageData(0, 0, N, N).data, m = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; } const n = d.length / 4; return { d, m: [m[0] / n, m[1] / n, m[2] / n] }; }, B = tile(ib), P = tile(ip);
        const apply = (rect, kf) => { const x0 = round(rect[0] * S), w = round((rect[2] - rect[0]) * S), y0 = round((1 - rect[3]) * S), h = round((rect[3] - rect[1]) * S), im = g.getImageData(x0, y0, w, h), d = im.data;
          for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) { const i = (py * w + px) * 4, j = ((py % N) * N + (px % N)) * 4, kp = kf((px + .5) / w); for (let c = 0; c < 3; c++) { const rb = B.d[j + c] / B.m[c], rp = P.d[j + c] / P.m[c], q = clamp(lerp(pow(rb, 2.2), pow(rp, 1.15), kp), .6, 1.45); d[i + c] = d[i + c] * q; } } g.putImageData(im, x0, y0); };
        apply(R_HAND, u => sm(min(abs(u - .25), 1 - abs(u - .25)), .2, .38)); apply(R_ARM, () => 0); out.map.needsUpdate = true; } catch (e) { console.warn('[hero] skin photo', e); } })); return out; }
  function paintHair(who) { return cached('hair_' + who, () => { const A = new Atlas(512), hc = rgb(HAIRC[who]), st = field(128, 3, 2, 111), st2 = field(48, 4, 3, 112), cl = field(10, 4, 4, 113), tip = who === 'lie' ? [.36, .24, .14] : null;
    for (let k = 0; k < 5; k++) A.shade([0, k / 5, 1, (k + 1) / 5], (u, v, x, y, o) => { const c = fs(cl, x, y), wx = x + (c - .5) * 46 + sin(y * .09 + c * 9) * 3, s = fs(st, wx, y * .6), s2 = fs(st2, wx, y * .5), lum = .86 + s * .2 + s2 * .22 + c * .12; o.r = hc[0] * lum; o.g = hc[1] * lum; o.b = hc[2] * lum;
      if (tip) tint(o, [tip[0] * (.6 + s), tip[1] * (.6 + s), tip[2] * (.6 + s)], sm(v, .5, .95) * (k > 0 ? .42 : .25) * sm(c, .3, .65)); o.h = (s - .5) * .9 + (s2 - .5) * .8; o.ro = .5 + s2 * .2; o.me = 0;
      o.a = k === 4 ? clamp((s * .55 + s2 * .5 - .12 - sm(v, .35, 1) * .62) * 6 + .5, 0, 1) : k === 0 ? clamp((sm(v, 0, .3) * 1.2 + s * .55 + s2 * .35 - .75) * 5 + .5, 0, 1) : clamp((s * .5 + s2 * .35 + c * .5 - (.36 + k * .1) - (1 - sm(v, 0, .34)) * .5 - sm(v, .8, 1) * .1) * 6 + .5, 0, 1); });
    return A.finish(2); }); }

  /* ---- shoes, helmet, gloves, small gear ---- */
  function paintGear(key, d) { return cached('gear_' + key, () => { const A = new Atlas(512), up = cloth(d.shoe, { seed: 61, ro: d.shoeRo || .8, wr: .5, kx: 2.6 }), fd = FD(), f2 = field(40, 40, 3, 121), fsc = field(60, 6, 3, 122), sole = rgb(d.sole), acc = rgb(d.accent || 0x888888);
    A.shade(R_SHOE, (u, v, x, y, o) => { const bot = abs(u - .5); if (bot < .23) { const tread = bot < .13; const k = tread ? .32 : (.9 - .25 * fs(fd, x * 2, y * 2) - .2 * sm(bot, .19, .13)); o.r = sole[0] * k; o.g = sole[1] * k; o.b = sole[2] * k; o.h = tread ? sin(y * .9) * .5 : .5 + sin(y * .5) * .1; o.ro = .75; o.me = 0; return; }
      const dirt = 1 - .28 * sm(bot, .34, .23) * fs(fd, x * 2, y * 2) - .1 * fs(fd, x, y); up(x, y, o, dirt); if (d.boot) { o.ro = .38 + fs(f2, x, y) * .2; o.h = (fs(fd, x, y) - .5) * .6; } else { o.h += .5 * sm(v, .7, .78) - .2; if (v > .74) { o.r *= .88; o.g *= .88; o.b *= .88; } } });
    A.shade(R_SHAFT, (u, v, x, y, o) => { if (d.boot) { up(x, y, o, 1 - .2 * fs(fd, x * 2, y * 2) * (1 - v)); o.ro = .36 + fs(f2, x, y) * .2; o.h = (fs(fd, x, y * 3) - .5) * 1.2 + (v > .9 ? .5 : 0); } else { cloth(d.sock || 0xd8d4c8, { seed: 62, ro: .95 })(x, y, o, 1); o.h = sin(x * 1.1) * .5; } });
    A.shade(R_HELM, (u, v, x, y, o) => { const yel = rgb(0xdcab12), stripe = min(u, 1 - u, abs(u - .5)) < .034 && v > .12, n = fs(fd, x, y), sc = fs(fsc, x + y * .4, y); let c = stripe ? [.09, .09, .1] : yel; if (v < .075) c = [.07, .07, .08];
      const k = .9 + n * .16 - sm(sc, .78, .86) * .18; o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k; o.h = (v < .075 ? -.3 : 0) + sm(sc, .78, .86) * -.3; o.ro = v < .075 ? .8 : .26 + n * .12 + sm(sc, .7, .86) * .3; o.me = 0;
      for (const cu of [.13, .87, .37, .63]) { const dx = abs(u - cu), slot = dx < .028 && v > .5 && v < .78 && ((v * 14) % 1) < .5; if (slot) { o.r = o.g = o.b = .03; o.h = -1; o.ro = .9; } } });
    A.shade(R_GLV, (u, v, x, y, o) => { cloth(0x1c1d20, { seed: 63, ro: .82, kx: 2.8, weave: 0, wr: .12 })(x, y, o, 1); if (v > .8) { o.h = sin(x * .4) * .1; }   /* smooth synthetic glove: the knit ribs and the stretched wrinkle field filled the first-person view with moire stripes */ if (abs(u - .25) < .12 && v > .25 && v < .7) { o.r *= 1.5; o.g *= 1.5; o.b *= 1.5; o.h += .4; o.ro = .55; } });
    A.shade(R_BLK, (u, v, x, y, o) => { o.r = o.g = o.b = .055 + fs(f2, x, y) * .02; o.h = 0; o.ro = .42; o.me = 0; });
    A.shade(R_LENS, (u, v, x, y, o) => { o.r = .03; o.g = .035; o.b = .04; o.h = 0; o.ro = .08; o.me = .6; });
    A.shade(R_MASK, (u, v, x, y, o) => { cloth(d.mask || 0x1e2126, { seed: 64, ro: .92, kx: 2.9 })(x, y, o, 1); o.h += sin(y * .22 + 1) * .9; });
    A.shade(R_WEB, (u, v, x, y, o) => { cloth(0x18191c, { seed: 65, ro: .7, kx: 2.2, twill: true })(x, y, o, 1); });
    A.begin(); const P = A.pen(R_SHOE);
    if (!d.boot) { for (let i = 0; i < 6; i++) { const v0 = .44 + i * .05; const lc = { c: css(rgb(d.lace || 0xd8d4c8)), w: 2.6, h: .8, hw: 3.5 }, vm = v0 + .0125; P.path([[.955, v0], [1, vm]]).stroke(lc); P.path([[0, vm], [.045, v0 + .025]]).stroke(lc); P.path([[.955, v0 + .025], [1, vm]]).stroke(lc); P.path([[0, vm], [.045, v0]]).stroke(lc); }
      for (const s of [.17, .83]) { const dd = s < .5 ? 1 : -1; P.path([[s - .05 * dd, .3], [s + .03 * dd, .62]]).stroke({ c: css(acc), w: 7, h: .3, cap: 'round' }); P.path([[s - .02 * dd, .22], [s + .06 * dd, .52]]).stroke({ c: css(acc), w: 5, h: .3, cap: 'round' }); P.seam([[s - .09 * dd, .78], [s + .09 * dd, .7]], { rows: 1, thread: 'rgba(200,200,200,.4)' }); P.seam([[s - .08 * dd, .05], [s - .08 * dd, .3], [s + .07 * dd, .12]], { rows: 1, thread: 'rgba(200,200,200,.4)' }); } }
    const Ph = A.pen(R_HELM); logoMark(Ph, .25, .36, 13); Ph.text('跑得快', .25, .22, 15, { c: '#17171a', font: CJK, weight: 900 }); logoMark(Ph, .75, .36, 13); Ph.text('跑得快', .75, .22, 15, { c: '#17171a', font: CJK, weight: 900 }); Ph.text('0728', .5, .2, 15, { c: '#e9e6dc', weight: 800, font: 'Arial,sans-serif' });
    return A.finish(2); }); }

  /* ---- insulated delivery box ---- */
  function paintPack() { return cached('pack', () => { const A = new Atlas(1024), yel = cloth(0xdaa814, { seed: 81, ro: .5, wr: .7, kx: 1.3 }), blk = cloth(0x18191c, { seed: 82, ro: .65, kx: 2.2, twill: true }), fd = FD(), fh = FH();
    const body = (u, v, x, y, o) => { const dirt = 1 - .34 * (1 - sm(v, 0, .3)) * fs(fd, x, y) - .1 * fs(fd, x * 2, y * 2), edge = min(u, 1 - u, v, 1 - v); yel(x, y, o, dirt); o.h += (fs(fh, x, y) - .5) * .8 + (fs(fd, x * 3, y * 3) - .5) * .6; { const cn = max(0, 1 - Math.hypot(min(u, 1 - u), min(v, 1 - v)) / .13) * sm(fs(fd, x * 5, y * 5), .35, .7); if (cn > 0) { tint(o, [.62, .56, .44], cn * .7); o.ro += cn * .3; o.h -= cn * .4; } } if (edge < .03) { blk(x, y, o, 1); o.h = .5; } if (v > .78 && v < .8) { o.r *= .5; o.g *= .5; o.b *= .5; o.h = -.5; } };
    A.shade(R_PB, (u, v, x, y, o) => { body(u, v, x, y, o); if (v > .14 && v < .2 && u > .03 && u < .97) reflective(x, y, o, .9); });
    A.shade(R_PS, (u, v, x, y, o) => { body(u, v, x, y, o); if (v > .14 && v < .2 && u > .03 && u < .97) reflective(x, y, o, .9); });
    A.shade(R_PT, (u, v, x, y, o) => { body(u, .5, x, y, o); }); A.shade(R_PW, (u, v, x, y, o) => { blk(x, y, o, 1); o.h += sin(y * 1.5) * .4; }); A.shade(R_PK, (u, v, x, y, o) => { blk(x, y, o, .9); });
    A.begin(); const P = A.pen(R_PB); logoMark(P, .5, .62, 58); wordmark(P, .5, .41, 92, '#17171a'); P.text('再晚也送到', .5, .29, 30, { c: '#17171a', font: CJK, weight: 800 }); P.text('保温 · 保冷 · 准时', .5, .095, 22, { c: 'rgba(23,23,26,.8)', font: CJK, weight: 700 });
    P.path([[.03, .79], [.97, .79]]).stroke({ c: '#77736a', w: 3, dash: [2, 2], h: .5, ro: .3, me: .8 });
    const Ps = A.pen(R_PS); logoMark(Ps, .5, .56, 40); wordmark(Ps, .5, .37, 56, '#17171a'); Ps.path([[.03, .79], [.97, .79]]).stroke({ c: '#77736a', w: 3, dash: [2, 2], h: .5, ro: .3, me: .8 }); Ps.rrect(.3, .84, .4, .09, 4).fill({ c: '#19191c', h: .6, ro: .6 });
    const Pt = A.pen(R_PT); Pt.rrect(.3, .42, .4, .16, 5).fill({ c: '#19191c', h: .7, ro: .6 }); wordmark(Pt, .5, .76, 44, '#17171a');
    return A.finish(2.2); }); }

  /* Two shader extras on every hero material (霓虹江城 style guide): a fresnel rim that lifts the silhouette off the dark street (teal at night, a trace of warm by day),
     and retro-reflective tape: the texels painted by reflective() (metal .55, rough .3) answer with their own light at night, strongest face-on, as the bands on a rider's jacket do in a headlamp. */
  const HU = { value: new T.Vector4(0, 0, 0, 0) };
  const heroRim = () => { const n = (GT.env && GT.env.night) || 0; HU.value.set(lerp(.075, .05, n), lerp(.05, .26, n), lerp(.028, .3, n), n * 1.5); };
  const mkMat = (tex, o) => { const m = new T.MeshStandardMaterial(Object.assign({ map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.orm, metalnessMap: tex.orm, roughness: 1, metalness: 1, skinning: true }, o || {})); m.normalScale = new T.Vector2(1, 1);
    m.onBeforeCompile = sh => { sh.uniforms.uGtRim = HU; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uGtRim;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n { float gF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0); float gNr = smoothstep(0.55, 1.5, length(vViewPosition)); /* no edge light on the arms of the first-person view: at that distance the whole sleeve is edge and it turned bright cyan at night */ totalEmissiveRadiance += uGtRim.rgb * pow(gF, 3.0) * (0.3 + 0.7 * diffuseColor.rgb) * gNr;\n float gRf = smoothstep(0.44, 0.52, metalnessFactor) * (1.0 - smoothstep(0.6, 0.68, metalnessFactor)) * (1.0 - smoothstep(0.34, 0.46, roughnessFactor)); totalEmissiveRadiance += vec3(0.8, 0.88, 0.96) * gRf * uGtRim.a * (0.3 + 0.7 * (1.0 - gF)) * (0.25 + 0.75 * gNr); }'); };
    return m; };
  const MATC = {};
  const matOf = (key, fn) => MATC[key] || (MATC[key] = fn());

  /* ================================================================== body parts */
  const ysT = (y0, y1) => { const o = []; for (let y = y0; y < 1.395; y += .028) o.push(y); for (const y of [1.4, 1.425, 1.445, 1.462, 1.478, 1.492, 1.506, 1.52]) if (y <= y1 + 1e-6) o.push(y); return o; };
  /** z of a torso garment surface at (x, y). front = true -> chest side. */
  function surfZ(x, y, ease, front) { const q = BODY(clamp(y, .84, 1.52)), A = q[0] + ease, F = (front ? q[1] : q[2]) + ease, cz = q[3], cs = pow(min(1, abs(x) / A), 1 / .9), sn = sqrt(max(0, 1 - cs * cs)); return cz + (front ? 1 : -1) * F * pow(sn, .9); }
  const HEAD_YS = [1.38, 1.42, 1.455, 1.48, 1.5, 1.52, 1.535, 1.55, 1.56, 1.568, 1.573, 1.578, 1.582, 1.586, 1.59, 1.594, 1.5975, 1.601, 1.6045, 1.6075, 1.61, 1.6122, 1.6145, 1.617, 1.62, 1.6235, 1.627, 1.6305, 1.634, 1.637, 1.64, 1.6435, 1.647, 1.651, 1.656, 1.661, 1.666, 1.67, 1.6735, 1.677, 1.6805, 1.684, 1.6875, 1.691, 1.695, 1.699, 1.703, 1.708, 1.715, 1.725, 1.74, 1.755, 1.77, 1.782, 1.792, 1.7995];
  const uwFace = q => q - .62 * sin(TAU * q) / TAU;
  const wHead = (x, y, z) => { const yy = y + clamp(z, -.03, .09) * .45, wn = sm(y, 1.475, 1.535), whd = sm(yy, 1.555, 1.6); return [BI.chest, 1 - wn, BI.neck, wn * (1 - whd), BI.head, wn * whd]; };
  function addHead(M, who, ho) { const ys = ho && ho.ys || HEAD_YS, info = { v: 0 }, hb = wOne('head'), earLod = ho && ho.ears !== undefined ? ho.ears : 2;
    tube(M, { n: ho && ho.n || 64, rings: ys.length, uv: R_HEAD, cap1: true, uw: uwFace, w: wHead, pt: (i, u, out) => { headPt(u, ys[i], 0, out); info.v = HV(ys[i]); return info; } });
    for (const S of [1, -1]) { /* eyeballs: a cap of the globe behind the lid opening (the opening itself is cut by the skin texture's alpha) */
      if (ho && ho.eyes === false) continue;   /* PP: the far NPC LOD has no eyes (and no ears) */
      const base = M.count, R = R_EYE, NS = 12, NR = 5; M.v(S * EYE.x, EYE.y, EYE.z + EYE.rz, (R[0] + R[2]) / 2, (R[1] + R[3]) / 2, hb);
      for (let k = 1; k <= NR; k++) { const ph = k / NR * 1.5, sp = sin(ph), cp = cos(ph); for (let j = 0; j < NS; j++) { const al = j / NS * TAU, ca = cos(al), sa = sin(al); M.v(S * EYE.x + EYE.rx * sp * ca, EYE.y + EYE.ry * sp * sa, EYE.z + EYE.rz * cp, lerp(R[0], R[2], .5 + .5 * sp * ca * S), lerp(R[1], R[3], .5 + .5 * sp * sa), hb); } }
      for (let j = 0; j < NS; j++) { const j1 = (j + 1) % NS; M.tri(base, base + 1 + j, base + 1 + j1); for (let k = 0; k < NR - 1; k++) { const a = base + 1 + k * NS + j, b = base + 1 + k * NS + j1, c = a + NS, d = b + NS; M.tri(a, c, d); M.tri(a, d, b); } }
      { const b0 = M.count, wl = wOne('lid'), NX = 7, NY = 4, L = R_LID; for (let i = 0; i <= NY; i++) for (let j = 0; j <= NX; j++) { const th = lerp(-.4, .5, i / NY), ps = lerp(-1.2, 1.2, j / NX), cp = cos(ps); M.v(S * EYE.x + (EYE.rx + .0006) * sin(ps), EYE.y + (EYE.ry + .0006) * cp * sin(th), EYE.z + (EYE.rz + .0006) * cp * cos(th), lerp(L[0], L[2], .1 + .8 * j / NX), lerp(L[1], L[3], .02 + .96 * i / NY), wl); }
        for (let i = 0; i < NY; i++) for (let j = 0; j < NX; j++) { const a = b0 + i * (NX + 1) + j, b = a + 1, c = a + NX + 1, d = c + 1; M.tri(a, b, d); M.tri(a, d, c); } }
      /* ear: concha plate + helix rim + lobe + tragus, flared back */
      if (!earLod) continue; const cx = .0745, rot = q => { const dx = q[0] - cx, dz = q[2] + .004, c = cos(.3), sn = sin(.3); q[0] = (cx - .003 + dx * c - dz * sn) * S; q[2] = -.004 + dx * sn + dz * c; }, wh = () => hb;
      ellip(M, [cx + .002, 1.676, -.016], [.0035, .029, .015], { uv: R_CON, w: wh, n: 10, rings: 7, xf: rot });
      if (earLod < 2) continue; strip(M, [[1.692, .004], [1.703, -.003], [1.706, -.013], [1.699, -.024], [1.683, -.029], [1.666, -.026], [1.653, -.018], [1.648, -.009]].map(q => [cx + .0055, q[0], q[1]]), { width: .0056, thick: .0056, e: 1, U: [1, 0, 0], uv: R_EAR, w: wh, steps: 14, n: 6, xf: rot });
      ellip(M, [cx + .003, 1.6515, -.008], [.004, .0075, .007], { uv: R_EAR, w: wh, n: 8, rings: 5, xf: rot }); ellip(M, [cx + .003, 1.672, .0005], [.003, .005, .0035], { uv: R_EAR, w: wh, n: 6, rings: 4, xf: rot }); } }
  /* hand (rebuilt): a palm loft with thenar / hypothenar pads, a hollow, a knuckle row and a slanted end; four fingers of three phalanges each (their own length, taper, knuckle swell, pads, round tip, rest curl and splay); a two-phalanx thumb leaving the radial edge.
     Local frame before xf: -y down the arm, +x = back of the hand, -x = palm, +z = thumb side. Round a loft u = .25 is dorsal, .75 palmar. Skin atlas: upper half of R_HAND = palm loft, lower half = digits (v = .5 * (1 - tt), creases at tt = .45 / .72, nail .78-.97). */
  function addHand(M, S, uv, grow, glove) { const L = S > 0 ? 'L' : 'R', xf = armXf(S), g = grow || 0, bh = BI['hand' + L], bf = BI['fore' + L], f1 = BI['f1' + L], f2 = BI['f2' + L], f3 = BI['f3' + L], i1 = BI['i1' + L], i2 = BI['i2' + L], i3 = BI['i3' + L], t1 = BI['t1' + L], t2 = BI['t2' + L], r = { c: [0, 0, 0], a: 0, f: 0, b: 0, e: 1, v: 0, t: 0, s: 0, rad: 0, tz: 0, U: null, V: null }, Y0 = -WRIST, lo = !!SHP;   /* street NPCs (people.js builds through setShape) get the same hand with a third of the triangles */
    const dU = (u, c) => { const d = abs(u - c); return min(d, 1 - d); }, plin = (x, xs, ys) => { if (x <= xs[0]) return ys[0]; for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return lerp(ys[i - 1], ys[i], (x - xs[i - 1]) / (xs[i] - xs[i - 1])); return ys[ys.length - 1]; };
    const PE = .74, FZ = [.0288, .0096, -.0096, -.0278], KU = FZ.map(z => Math.acos(clamp(Math.sign(z) * pow(abs(z) / .041, 1 / PE), -1, 1)) / TAU), dv = uv[3] - uv[1], uvD = [uv[0], uv[1], uv[2], uv[1] + dv * .5];
    const PK = keyed([[0, .0148, .0205, .0205], [.14, .0142, .0218, .0216], [.32, .0146, .029, .0276], [.56, .0136, .0362, .0338], [.78, .012, .0388, .0362], [.9, .0108, .0388, .036], [.955, .0092, .038, .0352], [.985, .0066, .0368, .034], [1, .0032, .0352, .0324]]);   /* H4: a thinner, slightly narrower palm */
    tube(M, { n: lo ? 12 : 28, rings: lo ? 9 : 24, uv, mirrorU: S < 0, xf, cap1: true,
      w: (x, y, z, rr, u) => { const t = rr.t, k = sm(t, .03, .2), kt = .42 * G(dU(u, .9), .1) * G(t - .42, .16), kf = .3 * sm(t, .88, 1); return [bf, 1 - k, bh, k * (1 - kt - kf), t1, k * kt, f1, k * kf]; },
      disp: (i, u, rr) => { const t = rr.t; let d = .0082 * G(dU(u, .88), .085) * G(t - .42, .17) + .0044 * G(dU(u, .63), .08) * G(t - .42, .2) - .003 * G(dU(u, .75), .07) * G(t - .66, .14) + .001 * G(dU(u, .44), .06) * G(t - .13, .06);
        for (let k = 0; k < 4; k++) { const q = G(dU(u, KU[k]), .032); d += .0027 * q * G(t - .915, .04) + .0006 * G(dU(u, lerp(.25, KU[k], sm(t, .2, .95))), .018) * sm(t, .38, .6) * sm(t, .93, .8); } return d; },
      ring: (i, q0) => { const t = 1 - pow(1 - q0, 1.5), q = PK(t); r.t = t; r.s = 0; r.c = [-.0015 - .003 * sm(t, .7, 1), Y0 + .016 - t * .1125, .0025 + .002 * t]; r.a = q[0] + g; r.f = q[1] + g; r.b = q[2] + g; r.e = lerp(lerp(.95, PE, sm(t, .15, .5)), .92, sm(t, .88, 1)); r.tz = -.1 * sm(t, .7, 1); r.U = null; r.v = 1 - t * .5; return r; } });
    const MY = [-.089, -.091, -.088, -.081], P1 = [.042, .044, .041, .033], P2 = [.027, .029, .027, .02], P3 = [.023, .024, .023, .02], FR = (lo ? [.0088, .0091, .0086, .0076] : [.0094, .0097, .0092, .0082]), CU = [.007, .008, .009, .010], SP = [.06, 0, -.05, -.13], S0 = .016, FT = [0, .06, .45, .72, 1];
    for (let k = 0; k < 4; k++) { const l1 = P1[k], l12 = l1 + P2[k], Lk = l12 + P3[k], cut = glove ? l1 + P2[k] * .4 : Lk, K = glove ? 10 : lo ? 7 : 20, kn = [-S0, 0, l1, l12, Lk], rt = FR[k] * .85, sAt = i => { const q = i / (K - 1); return -S0 + (cut + S0) * (glove ? q : 1 - pow(1 - q, 1.4)); };
      tube(M, { n: lo ? 5 : 14, rings: K, uv: uvD, mirrorU: S < 0, xf, cap1: true,
        w: (x, y, z, rr) => { const s = rr.s, w1 = sm(s, -.011, .007), w2 = sm(s, l1 - .008, l1 + .007), w3 = sm(s, l12 - .007, l12 + .006), ix = k === 0 && !lo, cn = lo ? '' : k === 1 ? 'm' : k === 3 ? 'q' : '', b1 = ix ? i1 : cn ? BI[cn + '1' + L] : f1, b2 = ix ? i2 : cn ? BI[cn + '2' + L] : f2, b3 = ix ? i3 : cn ? BI[cn + '3' + L] : f3;   /* street NPCs (people.js poses f* itself) keep all four fingers on the shared chain */ return [bh, 1 - w1, b1, w1 * (1 - w2), b2, w2 * (1 - w3), b3, w2 * w3]; },
        disp: (i, u, rr) => { const s = rr.s, dor = G(dU(u, .25), .12), pal = G(dU(u, .75), .14); return rr.rad * (.11 * dor * (G(s - l1, .0055) + .8 * G(s - l12, .0045)) + .1 * pal * (G(s - l1 * .5, .011) + G(s - (l1 + l12) / 2, .008) + 1.3 * G(s - (l12 + Lk) / 2, .008)) - .07 * pal * (G(s - l1, .003) + G(s - l12, .003))); },
        ring: (i) => { const s = sAt(i), tn = clamp(s / Lk, 0, 1), tip = glove || s < Lk - rt ? 1 : sqrt(max(.03, 1 - pow((s - (Lk - rt)) / rt, 2))), rad = (FR[k] + g) * (1 - .2 * tn) * tip; r.s = s; r.rad = rad; r.t = tn;
          r.c = [-.0012 - CU[k] * tn * tn, Y0 + MY[k] - s, FZ[k] + SP[k] * max(s, 0)]; r.a = rad * .92; r.f = rad; r.b = rad; r.e = 1; r.tz = 0; r.U = null; r.v = 1 - plin(s, kn, FT); return r; } }); }
    const nrm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }, tb = [-.011, -.029, .0305], td = nrm3([-.33, -.86, .39]), n0 = [.45, 0, .9], dn = n0[0] * td[0] + n0[1] * td[1] + n0[2] * td[2], TU = nrm3([n0[0] - dn * td[0], n0[1] - dn * td[1], n0[2] - dn * td[2]]), TV = [td[1] * TU[2] - td[2] * TU[1], td[2] * TU[0] - td[0] * TU[2], td[0] * TU[1] - td[1] * TU[0]];
    const TL1 = .037, TL2 = .031, TB = .55, cB = cos(TB), sB = sin(TB), TD2 = [td[0] * cB - TU[0] * sB, td[1] * cB - TU[1] * sB, td[2] * cB - TU[2] * sB], TU2 = [TU[0] * cB + td[0] * sB, TU[1] * cB + td[1] * sB, TU[2] * cB + td[2] * sB], UQ = [0, 0, 0], TL = TL1 + TL2, TS0 = .02, tcut = glove ? TL1 * .9 : TL, TK = glove ? 8 : lo ? 6 : 18, trt = .0095, tkn = [-TS0, 0, .003, TL1, TL], TT = [0, .4, .5, .72, 1];
    tube(M, { n: lo ? 5 : 14, rings: TK, uv: uvD, mirrorU: S < 0, xf, cap1: true,
      w: (x, y, z, rr) => { const s = rr.s, k1 = sm(s, -.012, .008), k2 = sm(s, TL1 - .008, TL1 + .007); return [bh, 1 - k1, t1, k1 * (1 - k2), t2, k1 * k2]; },
      disp: (i, u, rr) => { const s = rr.s, dor = G(dU(u, .25), .12), pal = G(dU(u, .75), .14); return rr.rad * (.1 * dor * G(s - TL1, .006) + .12 * pal * (G(s - TL1 * .5, .012) + 1.2 * G(s - (TL1 + TL) / 2, .01)) - .06 * pal * G(s - TL1, .003)); },
      ring: (i) => { const q = i / (TK - 1), s = -TS0 + (tcut + TS0) * (glove ? q : 1 - pow(1 - q, 1.35)), tn = clamp(s / TL, 0, 1), tip = glove || s < TL - trt ? 1 : sqrt(max(.03, 1 - pow((s - (TL - trt)) / trt, 2))), rad = (.0112 + g) * (1 - .14 * tn) * tip, s1 = min(s, TL1), s2 = max(0, s - TL1), kb = sm(s, TL1 - .006, TL1 + .006); r.s = s; r.rad = rad; r.t = tn;   /* the last joint rests bent towards the fingers, so a fist closes with the thumb across them rather than pointing */
        r.c = [tb[0] + td[0] * s1 + TD2[0] * s2, Y0 + tb[1] + td[1] * s1 + TD2[1] * s2, tb[2] + td[2] * s1 + TD2[2] * s2]; for (let q = 0; q < 3; q++) UQ[q] = lerp(TU[q], TU2[q], kb); r.a = rad * .88; r.f = rad * 1.06; r.b = rad * 1.06; r.e = 1; r.tz = 0; r.U = UQ; r.V = TV; r.v = 1 - plin(s, tkn, TT); return r; } }); }
  function addHair(M, who) { const kai = who === 'kai', top = kai ? .012 : .03, side = kai ? .004 : .01, K = 13, info = { v: 0 }, bh = BI.head, bs = BI.hair;
    for (let k = 0; k < 3; k++) { const grow = k * (kai ? .006 : .009);
      tube(M, { n: 36, rings: K, uv: [0, k / 5 + .003, 1, (k + 1) / 5 - .006], cap1: true, w: (x, y) => { const q = sm(y, 1.75, 1.83) * (kai ? .2 : .55); return [bh, 1 - q, bs, q]; },   /* PP: rows inset: the crown cap sampled the next row's transparent edge (a hole on top) */
        pt: (i, u, out) => { const s = i / (K - 1), du = u > .5 ? u - 1 : u, fr = G(du, kai ? .1 : .13), hl = hairline(who, u) - (kai ? 0 : .034 * fr) - k * .003, y = hl + (HTOP - .0012 - hl) * pow(s, .85);
          let off = (side + (top - side) * sm(y, 1.7, 1.775) + (kai ? .007 : .012) * fr * sm(y, 1.72, 1.775) * (1 - sm(y, 1.785, 1.8)) + (kai ? 0 : .012 * fr * (1 - s))) * sm(s, -.01, .14 + .3 * (1 - fr)) + grow * sm(s, 0, .3) * (.3 + .7 * sm(y, 1.68, 1.76)) + foldN(u, y, 46, 31 + k) * (kai ? .006 : .011) * sm(y, 1.69, 1.76) + (k === 0 ? 0 : .0008);
          headPt(u, y, max(off, .0006), out); info.v = s; return info; } }); }
    /* clumps: tapered locks growing out of the scalp along a flow field (forward and to his left on top, down on the sides) */
    const rr = GT.rng('hairclump_' + who), NC = kai ? 96 : 130, p0 = [0, 0, 0], wC = (x, y) => { const q = sm(y, 1.74, 1.84) * (kai ? .35 : .7); return [bh, 1 - q, bs, q]; };
    for (let i = 0; i < NC; i++) { const u = rr(), du = u > .5 ? u - 1 : u, fr = G(du, .14), hl = hairline(who, u), top = kai || rr() < .72, y0 = top ? lerp(1.74 + .022 * fr, 1.797, pow(rr(), .8)) : lerp(max(hl + .016, kai ? 1.7 : 1.67), 1.745, rr()); headPt(u, y0, .003, p0);
      let nx = p0[0], ny = (y0 - 1.685) * 1.15, nz = p0[2] - .004; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      let fx = (top ? .45 : nx * .6) + (rr() - .5) * .7, fy = top ? -.1 : -1, fz = top ? 1 : .35 + .5 * fr; const dd = fx * nx + fy * ny + fz * nz; fx -= dd * nx; fy -= dd * ny; fz -= dd * nz; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      const len = (kai ? (top ? .034 + .02 * fr * sm(y0, 1.77, 1.74) : .02) : (top ? .062 : .04)) * (.7 + rr() * .6), lift = (kai ? .007 : .013) * (.4 + rr()) * (top ? 1 + 1.2 * fr * sm(y0, 1.75, 1.73) : .4), wd = (kai ? .022 : .024) * (.75 + rr() * .6), ux = fy * nz - fz * ny, uy = fz * nx - fx * nz, uz = fx * ny - fy * nx, v0 = rr() * .7;
      const pts = [0, .34, .68, 1].map(t => { const l = lift * sin(t * PI * .78) + .0025 * t; return [p0[0] + fx * len * t + nx * l, p0[1] + fy * len * t + ny * l - .004 * t * t, p0[2] + fz * len * t + nz * l]; });
      strip(M, pts, { width: wd, widthAt: t => wd * (1 - .55 * t * t), thick: .002, U: [ux, uy, uz], steps: 4, n: 4, uv: [v0, .8, v0 + .3, 1], w: wC }); } }
  function addShoe(M, S, o) { const L = S > 0 ? 'L' : 'R', bf = BI['foot' + L], bt = BI['toe' + L], bs = BI['shin' + L], r = { c: [0, 0, 0], a: 0, f: 0, b: 0, e: 1, e2: .55, U: [1, 0, 0], V: [0, 1, 0], v: 0, z: 0 }, boot = o.boot, sc = o.scale || 1, RS = o.uv || R_SHOE, RSH = o.uvShaft || R_SHAFT;
    const SK = keyed([[-.09, .01, .052, .022], [-.082, .03, .086, .006], [-.06, .037, boot ? .13 : .112, 0], [-.02, .041, boot ? .13 : .116, 0], [.02, .044, boot ? .118 : .104, 0], [.06, .047, .084, 0], [.10, .05, .066, 0], [.14, .048, .054, .002], [.17, .04, .044, .006], [.19, .02, .032, .013]]);
    const zs = [-.09, -.084, -.072, -.052, -.03, -.008, .014, .036, .058, .08, .1, .12, .14, .158, .174, .185, .19];
    tube(M, { n: o.n || 18, rings: zs.length, uv: RS, mirrorU: S < 0, xf: mirXf(S), cap0: true, cap1: true, w: (x, y, z, rr) => { const k = sm(rr.z, .09, .135); return [bf, 1 - k, bt, k]; },
      ring: i => { const z = zs[i], q = SK(z), bot = q[2], topY = q[1] * sc, yc = bot + (topY - bot) * .42; r.z = z; r.c = [HIPX, yc, z - .012]; r.a = q[0] * sc * 1.07; r.f = topY - yc; r.b = yc - bot; r.v = (z + .09) / .28; return r; } });
    { const w = RS[2] - RS[0], rs = { c: [0, 0, 0], a: 0, f: .012, b: .012, e: .4, U: [1, 0, 0], V: [0, 1, 0], v: 0, z: 0 }; tube(M, { n: o.nw || 14, rings: zs.length, uv: [RS[0] + .3 * w, RS[1], RS[0] + .355 * w, RS[3]], mirrorU: S < 0, xf: mirXf(S), cap0: true, cap1: true, w: (x, y, z, q) => { const k = sm(q.z, .09, .135); return [bf, 1 - k, bt, k]; },
      ring: i => { const z = zs[i], q = SK(z), heel = 1 + .25 * (1 - sm(z, -.09, .0)); rs.z = z; rs.c = [HIPX, q[2] + .012 * heel, z - .012 + (i === 0 ? -.004 : i === zs.length - 1 ? .004 : 0)]; rs.a = q[0] * sc * 1.07 + .0045 - (i === 0 || i === zs.length - 1 ? .006 : 0); rs.f = rs.b = .012 * heel; rs.v = (z + .09) / .28; return rs; } }); }
    const top = boot ? .37 : .19, rr = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0, y: 0 }, K = boot ? 8 : 4;
    tube(M, { n: 14, rings: K + 2, uv: RSH, mirrorU: S < 0, xf: mirXf(S), w: (x, y, z, q) => { const k = sm(q.y, .085, .13); return [bf, 1 - k, bs, k]; },
      ring: i => { const k = min(i, K - 1), y = .085 + (top - .085) * k / (K - 1), ins = i >= K ? (i === K ? .005 : .011) : 0, rad = (boot ? lerp(.05, .06, sm(y, .12, .36)) : .04) - ins; rr.y = y; rr.c = [HIPX, y - (i >= K ? (i === K ? .002 : .02) : 0), -.014 - (boot ? .004 : 0)]; rr.a = rad; rr.f = rad + .004; rr.b = rad + .006; rr.v = (y - .085) / (top - .085); return rr; } }); }
  /** peaked cap (the 保安 uniform): band, a crown that overhangs it and stands taller in front, a short glossy peak, a brass badge. Worn on the head bone like the helmet. */
  function addCap(M) { const info = { v: 0 }, bh = wOne('head'), YR = 1.72, rim = u => 1.712 + .014 * cos(TAU * u), RY = [0, 0, .034, .04, .082, .1], RO = [.004, .013, .014, .018, .04, .026];
    tube(M, { n: 36, rings: 6, uv: R_BLK, cap1: true, w: () => bh, pt: (i, u, out) => { const du = u > .5 ? u - 1 : u, fr = G(du, .2); headPt(u, YR, RO[i] + (i > 3 ? .012 * fr : 0), out); out[1] = rim(u) + RY[i] + (i > 3 ? .016 * fr : 0); info.v = i / 5; return info; } });
    tube(M, { n: 16, rings: 4, arc: [.8, 1.2], uvArc: true, uv: R_BLK, w: () => bh, flip: false, pt: (i, u, out) => { const du = u - 1, k = i / 3, len = .068 * G(du, .11) * k; headPt(u, YR, .014, out); out[1] = rim(u) + .006 - len * .34; out[2] += len; info.v = k; return info; } });
    tube(M, { n: 16, rings: 2, arc: [.8, 1.2], uvArc: true, uv: R_BLK, w: () => bh, flip: true, pt: (i, u, out) => { const du = u - 1, len = .068 * G(du, .11) * i; headPt(u, YR, .014, out); out[1] = rim(u) + .002 - len * .34 - .003 * i; out[2] += len; info.v = i; return info; } });
    const q = [0, 0, 0]; headPt(0, YR, .032, q); ellip(M, [0, rim(0) + .062, q[2] + .006], [.015, .02, .006], { uv: [.11, .42, .15, .48], w: () => bh, n: 10, rings: 5 });
    for (const S of [1, -1]) { headPt(S > 0 ? .21 : .79, YR, .016, q); ellip(M, [q[0], rim(.21) + .018, q[2]], [.006, .006, .006], { uv: [.11, .42, .15, .48], w: () => bh, n: 8, rings: 4 }); } }
  function addHelmet(M) { const K = 12, info = { v: 0 }, bh = wOne('head'), rimY = u => { const du = u > .5 ? u - 1 : u; return 1.662 + .036 * G(du, .17) + .016 * G(abs(du) - .25, .08); };
    tube(M, { n: 40, rings: K + 2, uv: R_HELM, cap1: true, w: () => bh, pt: (i, u, out) => { const k = max(0, i - 2), s = k / (K - 1), du = u > .5 ? u - 1 : u, ry = rimY(u), y = ry + (HTOP - .001 - ry) * sin(s * PI / 2) + (i === 0 ? .012 : 0);
      const off = (i === 0 ? .012 : i === 1 ? .022 : .031) + .02 * G(du, .1) * (1 - sm(s, 0, .3)) * (i > 1 ? 1 : .5) + .004 * G(abs(du) - .25, .12) * (1 - s); headPt(u, y, off, out); info.v = s; return info; } });
    tube(M, { n: 16, rings: 4, arc: [.83, 1.17], uvArc: true, uv: R_BLK, w: () => bh, flip: false, pt: (i, u, out) => { const du = u - 1, k = i / 3, len = .042 * G(du, .1) * k; headPt(u, rimY(u) + .004, .03, out); out[2] += len; out[1] -= len * .06 + .002 * k; info.v = k; return info; } });
    tube(M, { n: 16, rings: 2, arc: [.83, 1.17], uvArc: true, uv: R_BLK, w: () => bh, flip: true, pt: (i, u, out) => { const du = u - 1, len = .042 * G(du, .1) * i; headPt(u, rimY(u) - .001, .03, out); out[2] += len; out[1] -= len * .06 + .004 * i; info.v = i; return info; } });
    const r = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0 }; for (const S of [1, -1]) tube(M, { n: 10, rings: 6, uv: [.11, .42, .15, .48], cap1: true, w: () => bh, ring: (i, t) => { r.c = [S * (.06 + .012 * t), 1.805 + .062 * t, -.012]; r.a = .024 * (1 - t * .78); r.f = .011 * (1 - t * .6); r.b = r.f; r.v = t; return r; } });
    strip(M, [[.086, 1.69, .0], [.083, 1.63, .02], [.062, 1.582, .05], [0, 1.563, .069], [-.062, 1.582, .05], [-.083, 1.63, .02], [-.086, 1.69, 0]], { width: .016, thick: .003, U: [0, 0, 1], uv: R_WEB, w: () => bh, steps: 22, n: 6 });
    boxPart(M, .02, .014, .012, 0, 1.562, .07, { rect: R_BLK, w: bh, bevel: .003 }); }
  function addMask(M) { const info = { v: 0 }, bh = wOne('head'), K = 7; tube(M, { n: 18, rings: K, arc: [.815, 1.185], uvArc: true, uv: R_MASK, w: () => bh, pt: (i, u, out) => { const s = i / (K - 1), du = u - 1, edge = sm(abs(du), .08, .185), y = lerp(1.572 + edge * .03, 1.664 - edge * .02, s); headPt(u, y, .0045 + .006 * (1 - edge) * sin(s * PI) + .016 * G(du, .028) * G(y - 1.647, .02) * 0, out); info.v = s; return info; } });
    for (const S of [1, -1]) strip(M, [[.071 * S, 1.652, .052], [.081 * S, 1.672, .012], [.085 * S, 1.66, -.022], [.081 * S, 1.63, -.016], [.074 * S, 1.6, .04]], { width: .004, thick: .003, U: [0, 0, 1], uv: R_WEB, w: () => bh, steps: 14, n: 5 }); }
  function addShades(M) { const bh = wOne('head'); for (const S of [1, -1]) { boxPart(M, .056, .038, .004, .0315 * S, 1.678, .1015, { rect: R_LENS, w: bh, bevel: .0019, ry: -.2 * S, rx: -.08 }); boxPart(M, .056, .007, .007, .033 * S, 1.697, .1, { rect: R_BLK, w: bh, bevel: .002, ry: -.2 * S }); boxPart(M, .005, .008, .098, .0745 * S, 1.69, .047, { rect: R_BLK, w: bh, bevel: .002, ry: .09 * S, rx: .05 }); }
    boxPart(M, .022, .008, .006, 0, 1.688, .106, { rect: R_BLK, w: bh, bevel: .002 }); }
  /** the insulated box worn as a backpack, with shoulder straps and a sternum strap. be = ease of the garment under it. */
  function addPack(M, be) { const wp = wOne('pack'), wS = (x, y, z) => { if (z < -.15) return wp; const k = sm(z, -.15, -.09), w = wTorso(x, y, z); for (let i = 1; i < w.length; i += 2) w[i] *= k; w.push(BI.pack, 1 - k); return w; };
    boxPart(M, .41, .45, .33, 0, 1.25, -.345, { bevel: .022, rects: f => f === 5 ? R_PB : f === 2 ? R_PT : f < 2 ? R_PS : R_PK, w: wp });
    boxPart(M, .425, .05, .345, 0, 1.452, -.345, { bevel: .018, rects: f => f === 2 ? R_PT : R_PK, w: wp });
    strip(M, [[-.075, 1.475, -.345], [-.04, 1.512, -.345], [.04, 1.512, -.345], [.075, 1.475, -.345]], { width: .034, thick: .007, U: [0, 0, 1], uv: R_PW, w: () => wp, steps: 12 });
    for (const sx of [1, -1]) { for (const sz of [1, -1]) boxPart(M, .022, .44, .022, .2 * sx, 1.25, -.345 + .158 * sz, { rect: R_PK, w: wp, bevel: .007 });
      boxPart(M, .34, .014, .03, 0, 1.021, -.345 + .1 * sx, { rect: R_PK, w: wp, bevel: .005 }); boxPart(M, .005, .024, .3, .2065 * sx, 1.365, -.345, { rect: R_PW, w: wp, bevel: .002 }); boxPart(M, .01, .036, .044, .209 * sx, 1.365, -.31, { rect: R_PK, w: wp, bevel: .004 }); }
    boxPart(M, .012, .17, .2, -.211, 1.125, -.345, { rect: R_PW, w: wp, bevel: .005 }); boxPart(M, .06, .026, .012, 0, 1.432, -.514, { rect: R_PK, w: wp, bevel: .004 }); boxPart(M, .012, .045, .004, .16, 1.412, -.5125, { rect: R_PK, w: wp, bevel: .0015, rz: .2 });
    for (const S of [1, -1]) { const X = x => x * S, e = be + .009, pts = [[X(.1), 1.43, -.178], [X(.104), 1.5, -.11], [X(.108), 1.526, -.03], [X(.113), 1.492, .055], [X(.122), 1.42, surfZ(.122, 1.42, e, true)], [X(.134), 1.33, surfZ(.134, 1.33, e, true)], [X(.15), 1.24, surfZ(.15, 1.24, e, true) - .004], [X(.152 + be), 1.16, .02], [X(.165), 1.1, -.1], [X(.15), 1.07, -.178]];
      strip(M, pts, { width: .048, thick: .009, uv: R_PW, w: wS, steps: 40, vRep: 1 });
      boxPart(M, .03, .05, .012, X(.139), 1.3, surfZ(.139, 1.3, e, true) + .006, { rect: R_PK, w: wTorso, bevel: .004 }); }
    const zc = surfZ(.06, 1.36, be + .01, true); strip(M, [[-.126, 1.362, surfZ(.126, 1.36, be + .012, true)], [-.06, 1.36, zc], [0, 1.36, surfZ(0, 1.36, be + .012, true)], [.06, 1.36, zc], [.126, 1.362, surfZ(.126, 1.36, be + .012, true)]], { width: .022, thick: .005, U: [0, 1, 0], uv: R_PW, w: wTorso, steps: 14 });
    boxPart(M, .034, .03, .01, 0, 1.36, surfZ(0, 1.36, be + .016, true), { rect: R_PK, w: wTorso, bevel: .004 }); }

  /* ================================================================== outfits */
  const tuck = ease => (y, u) => (typeof ease === 'function' ? ease(y, u) : ease) * (1 - .88 * sm(y, .915, .955));
  const pelvis = (M, ease, o) => torsoTube(M, Object.assign({ ys: lin_(.845, 1.04, 9), ease: tuck(ease), uv: R_PEL, vOf: y => (y - .845) / .195, w: (x, y) => wPelvis(x, y), cap0: true, lipTop: true, n: 40 }, o || {}));
  const legs = (M, o) => { for (const S of [1, -1]) legTube(M, S, Object.assign({ y0: .965, y1: .1, uv: R_LEG, lip: true }, o, { ease: tuck(o.ease) })); };
  const kneeFold = (amp, hem) => (u, y) => foldN(u, y, 55, 17) * amp * (G(y - .5, .07) * (.4 + .6 * G(u - .5, .22)) + (1 - sm(y, hem, hem + .13)) * 1.5) + .004 * G(y - .49, .04) * G(min(u, 1 - u), .12);
  const elbowFold = amp => (u, s) => foldN(u, s, 50, 9) * amp * (G(s - .285, .08) + .25) - .004 * G(s - .29, .03) * G(min(u, 1 - u), .14);
  const OUTFITS = {
    kai: {
      /* H5: the default look (the key stays 'rider': every caller asks for it by that name) is a plain short-sleeved T-shirt, dark jeans and white trainers, a black watch on the left
         wrist. No helmet, no delivery box (bare: setHelmet / setBox still record the state, nothing is drawn). The old courier jacket is kept as the hidden 'courier' cut. */
      rider: { bare: true, build(M) { const te = (y, u) => .009 + .006 * G(y - 1.0, .1) + .002 * G(y - 1.34, .1) + drape(y, u, .9) + .004 * (1 - sm(y, .87, .95)) + hipNeed(y);   /* PP: the tee hangs from the chest and stands off the hips and the tops of the thighs (they pushed through it as notches) */
          torsoTube(M.top, { ys: ysT(.872, 1.506), ease: te, e: 1, uv: R_TOR, vOf: TV, lip: true, lipTop: true, n: 46, disp: (u, y) => { const f = foldN(u, y, 22, 81) * .006 * G(y - 1.02, .15) + foldN(u, y, 2.6, 84) * .006 * sm(1.25 - y, 0, .25) + foldN(u, y, 9, 82) * .003 + foldV(u, y, 7) * .004 * sm(y, .9, 1.05) * (1 - sm(y, 1.25, 1.4)) + .003 * sin(u * TAU * 5 + 1.3) * (1 - sm(y, .875, .93)); return y < 1.0 ? max(f, -.0015) : f; } });
          const cr = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0 }; tube(M.top, { n: 30, rings: 4, uv: R_TRIM, w: wTorso, ring: (i, t) => { const y = [1.497, 1.506, 1.514, 1.517][i], gr = [.012, .009, .007, .005][i]; cr.c = [0, y, -.019]; cr.a = .057 + gr; cr.f = .054 + gr; cr.b = .062 + gr; cr.tz = -.22; cr.v = t; return cr; } });   /* PP: a lower, thinner rib that dips at the front */   /* ribbed crew neck */
          for (const S of [1, -1]) armTube(M.top, S, { s1: .185, K: 12, ease: (s, u) => (.008 + .009 * sm(s, .04, .185)) * (.55 + .9 * G(dUu(u, .75), .25)), disp: (u, s) => foldN(u, s, 16, 83) * .004 * sm(s, .05, .15) + foldN(u, s, 3, 85) * .003 * G(dUu(u, .75), .2), lip: true, uv: R_SLV });   /* short sleeves: snug on top, the spare cloth under the arm */
          addHead(M.skin, 'kai'); addHair(M.hair, 'kai'); for (const S of [1, -1]) { armTube(M.skin, S, { s0: .1, s1: .548, K: 22, uv: R_ARM, ease: s => -.0052 * sm(s, .5, .548) }); addHand(M.skin, S, R_HAND); }   /* the bare forearm narrows into the hand at the wrist (an open sleeve-end of skin stood proud of the hand there) */
          pelvis(M.bot, .012); legs(M.bot, { ease: y => .013 + .006 * (1 - sm(y, .1, .32)) + .003 * G(y - .76, .16), disp: kneeFold(.008, .1) }); for (const S of [1, -1]) addShoe(M.gear, S, {});
          armTube(M.gear, 1, { s0: .506, s1: .526, K: 4, ease: (s, u) => .0022 + .0045 * G(min(abs(u - .25), 1 - abs(u - .25)), .07) * sm(s, .506, .51) * sm(s, .526, .522), uv: R_BLK, n: 24, capEase: false }); },   /* a slim black watch on the left wrist, its face a low bump on the back of the wrist */
        tex() { return { top: paintTeeTop(), bot: paintDenimDark(), gear: paintGear('tee', { shoe: 0xe6e4de, sole: 0xf1efe9, accent: 0xd2cec6, lace: 0xf3f1eb, sock: 0xe4e2dc, shoeRo: .62 }) }; }, packEase: .03 },
      courier: { box: 'pack', build(M) { const ease = (y, u) => .026 + .01 * G(y - .98, .1) + .004 * G(y - 1.3, .15);
          torsoTube(M.top, { ys: ysT(.885, 1.506), ease, uv: R_TOR, vOf: TV, lip: true, n: 48, disp: (u, y) => foldN(u, y, 24, 5) * .022 * G(y - 1.03, .12) + foldN(u, y, 12, 6) * .006 + foldV(u, y, 8) * .012 * sm(y, .93, 1.1) * (1 - sm(y, 1.3, 1.44)) });
          const cr = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0 }; tube(M.top, { n: 30, rings: 5, arc: [.035, .965], uvArc: true, uv: R_TRIM, w: wTorso, ring: (i, t) => { const y = [1.49, 1.51, 1.536, 1.55, 1.54][i], gr = [.032, .026, .022, .019, .013][i]; cr.c = [0, y, -.021]; cr.a = .058 + gr; cr.f = .055 + gr; cr.b = .063 + gr; cr.v = t; return cr; } });
          for (const S of [1, -1]) armTube(M.top, S, { s1: .525, K: 24, ease: s => .019 + .005 * G(s - .25, .1) - .012 * sm(s, .46, .525), disp: elbowFold(.012), lip: true, uv: R_SLV });
          addHead(M.skin, 'kai'); addHair(M.hair, 'kai'); for (const S of [1, -1]) { armTube(M.skin, S, { s0: .42, s1: .548, K: 6, uv: R_ARM }); addHand(M.skin, S, R_HAND); }   /* bare hands: the half-finger gloves went with the hand rebuild */
          pelvis(M.bot, .018); legs(M.bot, { ease: y => .022 + .009 * (1 - sm(y, .1, .36)) + .005 * G(y - .76, .16), disp: kneeFold(.009, .1) }); for (const S of [1, -1]) { addShoe(M.gear, S, {});
            ellip(M.gear, [HIPX, .5, .062], [.052, .075, .03], { uv: R_BLK, w: (x, y) => wLeg(S, y), xf: mirXf(S), n: 12, rings: 7, e: .8 }); ellip(M.gear, [HIPX, .5, .078], [.036, .05, .022], { uv: R_GLV, w: (x, y) => wLeg(S, y), xf: mirXf(S), n: 10, rings: 5, e: .8 });
            boxPart(M.bot, .014, .15, .12, (HIPX + .097) * S, .7, .002, { rect: [.095, .446, .16, .554], w: wOne('thigh' + (S > 0 ? 'L' : 'R')), bevel: .008, rz: -.035 * S }); }
          boxPart(M.top, .009, .024, .005, 0, 1.468, surfZ(0, 1.468, .034, true), { rect: R_TRIM, w: wTorso, bevel: .002 }); },
        tex() { return { top: paintRiderTop(), bot: paintBottom('work'), gear: paintGear('rider', { shoe: 0x24252a, sole: 0xcfcbc0, accent: 0xd9a514, lace: 0x2a2b30, sock: 0x1c1d20 }) }; }, packEase: .037 },
      plain: { build(M) { torsoTube(M.top, { ys: ysT(.915, 1.506), ease: y => .011 + .01 * G(y - 1.0, .1), uv: R_INN, vOf: y => (y - .915) / .591, lip: true, lipTop: true, n: 40, disp: (u, y) => foldN(u, y, 22, 41) * .008 * G(y - 1.03, .14) });
          torsoTube(M.top, { ys: ysT(.862, 1.506), arc: [.04, .96], ease: (y, u) => .03 + .012 * G(y - .98, .12) + .014 * sm(abs(u - .5), .4, .46) * (1 - sm(y, 1.3, 1.45)), uv: R_TOR, vOf: TV, lip: true, n: 46, disp: (u, y) => foldN(u, y, 22, 42) * .014 * G(y - 1.04, .16) + foldN(u, y, 9, 43) * .006 });
          const cr = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0 }; tube(M.top, { n: 30, rings: 6, arc: [.05, .95], uvArc: true, uv: R_TRIM, w: wTorso, ring: (i, t) => { const y = [1.5, 1.525, 1.547, 1.55, 1.528, 1.502][i], gr = [.03, .022, .019, .026, .04, .05][i]; cr.c = [0, y, -.021]; cr.a = .058 + gr; cr.f = .055 + gr; cr.b = .063 + gr; cr.v = t; return cr; } });
          for (const S of [1, -1]) armTube(M.top, S, { s1: .5, K: 24, ease: s => .016 + .004 * G(s - .25, .1) + .004 * sm(s, .42, .5), disp: elbowFold(.011), lip: true, uv: R_SLV });
          addHead(M.skin, 'kai'); addHair(M.hair, 'kai'); for (const S of [1, -1]) { armTube(M.skin, S, { s0: .4, s1: .548, K: 7, uv: R_ARM }); addHand(M.skin, S, R_HAND); }
          pelvis(M.bot, .011); legs(M.bot, { ease: y => .012 + .004 * (1 - sm(y, .1, .3)), disp: kneeFold(.007, .1) }); for (const S of [1, -1]) addShoe(M.gear, S, {}); },
        tex() { return { top: paintPlainTop(), bot: paintBottom('jeans'), gear: paintGear('plain', { shoe: 0xcfcabd, sole: 0xdcd8cc, accent: 0x7a2a28, lace: 0xe2ded2, sock: 0xd8d4c8 }) }; }, packEase: .034 },
      jacket: { build(M) { const ease = y => .026 + .03 * G(y - 1.0, .1) - .012 * (1 - sm(y, .9, .955)) + .006 * G(y - 1.3, .15);
          torsoTube(M.top, { ys: ysT(.9, 1.506), ease, uv: R_TOR, vOf: TV, lip: true, n: 48, disp: (u, y) => foldN(u, y, 22, 51) * .02 * G(y - 1.03, .14) + foldN(u, y, 10, 52) * .007 });
          const cr = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0 }; tube(M.top, { n: 30, rings: 5, uv: R_TRIM, w: wTorso, ring: (i, t) => { const y = [1.49, 1.51, 1.535, 1.548, 1.538][i], gr = [.032, .027, .024, .02, .013][i]; cr.c = [0, y, -.021]; cr.a = .058 + gr; cr.f = .055 + gr; cr.b = .063 + gr; cr.v = t; return cr; } });
          for (const S of [1, -1]) armTube(M.top, S, { s1: .53, K: 24, ease: s => .021 + .008 * G(s - .25, .12) - .018 * sm(s, .46, .525), disp: elbowFold(.014), lip: true, uv: R_SLV });
          addHead(M.skin, 'kai'); addHair(M.hair, 'kai'); for (const S of [1, -1]) { armTube(M.skin, S, { s0: .42, s1: .548, K: 6, uv: R_ARM }); addHand(M.skin, S, R_HAND); }
          pelvis(M.bot, .011); legs(M.bot, { ease: y => .012 + .004 * (1 - sm(y, .1, .3)), disp: kneeFold(.007, .1) }); for (const S of [1, -1]) addShoe(M.gear, S, {}); },
        tex() { return { top: paintBomberTop(), bot: paintBottom('black'), gear: paintGear('jacket', { shoe: 0x2b2622, sole: 0x3a352e, accent: 0x4a443c, lace: 0x3a352e, sock: 0x1c1d20, shoeRo: .6 }) }; }, packEase: .04 }
    },
    lie: {
      kitchen: { build(M) { const te = y => .019 + .012 * G(y - 1.0, .1), ae = (y, u) => te(max(y, .9)) + .012 + .04 * (1 - sm(y, .76, .93));
          torsoTube(M.top, { ys: ysT(.9, 1.506), ease: te, uv: R_TOR, vOf: TV, lip: true, lipTop: true, n: 44, bw: .96, disp: (u, y) => foldN(u, y, 22, 61) * .009 * G(y - 1.03, .14) });
          for (const S of [1, -1]) armTube(M.top, S, { s1: .2, K: 12, ease: s => .014 + .008 * sm(s, .1, .2), lip: true, uv: R_SLV });
          torsoTube(M.top, { ys: lin_(.56, 1.1, 14), arc: [.8, 1.2], uvArc: true, ease: ae, uv: [.5, 0, 1, .27], vOf: y => (y - .56) / .54, n: 20, bw: .96, disp: (u, y) => foldN(u, y, 9, 62) * .008 * (1 - sm(y, .7, 1.0)) });
          torsoTube(M.top, { ys: lin_(1.1, 1.375, 8), arc: [.905, 1.095], uvArc: true, ease: ae, uv: [.6, .27, .9, .42], vOf: y => (y - 1.1) / .275, n: 12, bw: .96 });
          const zf = surfZ(.07, 1.37, .03, true); for (const S of [1, -1]) { strip(M.top, [[.062 * S, 1.365, zf], [.08 * S, 1.45, .07], [.082 * S, 1.522, -.02], [.05 * S, 1.508, -.088], [.012 * S, 1.5, -.098]], { width: .022, thick: .004, uv: [.52, .3, .58, .4], w: wTorso, steps: 20 });
            strip(M.top, [[.176 * S, 1.095, .03], [.168 * S, 1.095, -.05], [.1 * S, 1.095, surfZ(.1, 1.095, .03, false)], [.012 * S, 1.095, surfZ(0, 1.095, .032, false)]], { width: .02, thick: .004, U: [0, 1, 0], uv: [.52, .3, .58, .4], w: wTorso, steps: 16 });
            strip(M.top, [[.01 * S, 1.095, surfZ(0, 1.095, .036, false)], [.04 * S, 1.07, surfZ(0, 1.07, .04, false)], [.05 * S, .99, surfZ(.05, .99, .03, false)]], { width: .018, thick: .003, uv: [.52, .3, .58, .4], w: wTorso, steps: 8, U: [.9, 0, .4] }); }
          boxPart(M.top, .03, .024, .016, 0, 1.095, surfZ(0, 1.095, .04, false), { rect: [.52, .3, .58, .4], w: wTorso, bevel: .006 });
          addHead(M.skin, 'lie'); addHair(M.hair, 'lie'); for (const S of [1, -1]) { armTube(M.skin, S, { s0: .1, s1: .548, K: 18, uv: R_ARM }); addHand(M.skin, S, R_HAND); }
          pelvis(M.bot, .016, { bw: .96 }); for (const S of [1, -1]) legTube(M.bot, S, { y0: .965, y1: .3, uv: R_LEG, ease: tuck(y => .022 - .012 * (1 - sm(y, .3, .42))), disp: kneeFold(.009, .3) }); for (const S of [1, -1]) addShoe(M.gear, S, { boot: true, scale: 1.04 }); },
        tex() { return { top: paintKitchenTop(), bot: paintBottom('chef'), gear: paintGear('kitchen', { shoe: 0x1b1d1f, sole: 0x8a7f5c, boot: true, mask: 0x9db4c4 }) }; }, packEase: .03 },
      hoodie: { build(M) { const ease = (y, u) => .028 + .026 * G(y - 1.0, .1) - .008 * (1 - sm(y, .9, .95)) + .014 * G(min(u, 1 - u), .12) * G(y - 1.03, .07);
          torsoTube(M.top, { ys: ysT(.9, 1.506), ease, uv: R_TOR, vOf: TV, lip: true, n: 48, bw: .96, disp: (u, y) => foldN(u, y, 20, 71) * .018 * G(y - 1.04, .15) + foldN(u, y, 9, 72) * .007 });
          ellip(M.top, [0, 1.452, -.118], [.132, .1, .062], { uv: [.5, 0, 1, .42], w: wTorso, n: 16, rings: 9, e: .85 });
          const cr = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0 }; tube(M.top, { n: 30, rings: 6, arc: [.07, .93], uvArc: true, uv: [.5, 0, 1, .42], w: wTorso, ring: (i, t) => { const y = [1.485, 1.515, 1.545, 1.556, 1.535, 1.5][i], gr = [.04, .034, .03, .038, .05, .056][i]; cr.c = [0, y, -.024]; cr.a = .058 + gr; cr.f = .052 + gr; cr.b = .066 + gr; cr.v = t; return cr; } });
          for (const S of [1, -1]) { armTube(M.top, S, { s1: .53, K: 24, ease: s => .02 + .007 * G(s - .25, .12) - .014 * sm(s, .46, .525), disp: elbowFold(.013), lip: true, uv: R_SLV });
            strip(M.top, [[.03 * S, 1.49, .082], [.036 * S, 1.43, surfZ(.036, 1.43, .036, true)], [.04 * S, 1.36, surfZ(.04, 1.36, .034, true)], [.038 * S, 1.31, surfZ(.04, 1.31, .034, true)]], { width: .007, thick: .006, uv: [.02, .01, .06, .05], w: wTorso, steps: 10, n: 6, e: 1 }); }
          addHead(M.skin, 'lie'); addHair(M.hair, 'lie'); for (const S of [1, -1]) { armTube(M.skin, S, { s0: .42, s1: .548, K: 6, uv: R_ARM }); addHand(M.skin, S, R_HAND); }
          pelvis(M.bot, .016, { bw: .96 }); legs(M.bot, { y1: .115, ease: y => .02 - .012 * (1 - sm(y, .115, .2)), disp: kneeFold(.008, .13) }); for (const S of [1, -1]) addShoe(M.gear, S, {}); },
        tex() { return { top: paintHoodieTop(), bot: paintBottom('jogger'), gear: paintGear('hoodie', { shoe: 0x2a2c31, sole: 0xd6d2c6, accent: 0xb5502a, lace: 0xd6d2c6, sock: 0xd8d4c8, mask: 0x1e2126 }) }; }, packEase: .04 }
    }
  };
  Object.defineProperty(OUTFITS.kai, 'courier', { value: OUTFITS.kai.courier, enumerable: false });   /* H5: off the wardrobe lists, still wearable by name */
  const ALIAS = { kai: { tee: 'rider', shirt: 'plain', workwear: 'courier', delivery: 'courier', courier_jacket: 'courier', bomber: 'jacket' }, lie: { jersey: 'hoodie', apron: 'kitchen', tee: 'kitchen' } };
  const GEOC = {};
  function outfitGeo(who, name) { const key = who + '_' + name; if (GEOC[key]) return GEOC[key]; const t0 = now(), M = { skin: new Mesher(), hair: new Mesher(), top: new Mesher(), bot: new Mesher(), gear: new Mesher() }; OUTFITS[who][name].build(M);
    const out = { tris: 0 }; for (const k in M) { out.tris += M[k].tris; out[k] = M[k].geo(); } out.head = splitHead(out.skin); splitSleeves(out); TIMES['geo ' + key] = round(now() - t0); return GEOC[key] = out; }
  /** first person: the head (skull, face, eyes, ears, upper neck) is cut out of the skin geometry into its own index list sharing the same vertex buffers, so the player's own camera can skip it
      (it still casts its shadow — see fpCull in make()). A triangle goes with the head when all three corners are mostly weighted to the neck / head / lid / hair bones. */
  function splitHead(g) { const ix = g.index.array, si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, HB = [BI.head, BI.neck, BI.hair, BI.lid], body = [], head = [];
    const hw = i => { let w = 0; for (let k = 0; k < 4; k++) if (HB.indexOf(si[i * 4 + k]) >= 0) w += sw[i * 4 + k]; return w > .5; };
    for (let i = 0; i < ix.length; i += 3) (hw(ix[i]) && hw(ix[i + 1]) && hw(ix[i + 2]) ? head : body).push(ix[i], ix[i + 1], ix[i + 2]);
    g.setIndex(body); const h = new T.BufferGeometry(); for (const n in g.attributes) h.setAttribute(n, g.attributes[n]); h.setIndex(head); h.boundingSphere = g.boundingSphere; return h; }
  /* first person (H4): the sleeves are cut out of the top into their own index list (same vertex buffers), and a second, slimmer copy of them is made for the player's own camera.
     Seen from the eye a loose jacket sleeve fills the bottom of the frame as two yellow lumps; the first-person pair hugs the forearm (radius pulled in towards the arm axis below the
     elbow, cuff kept clear of the wrist) on the same bones, so every hold the combat rig solves still fits. Which pair is drawn is decided per draw from the rendering camera (fpRange). */
  function splitSleeves(out) { const g = out.top; out.slv = out.fps = null; if (!g || !g.index) return; const ix = g.index.array, si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, AB = ['armL', 'foreL', 'handL', 'armR', 'foreR', 'handR'].map(n => BI[n]), body = [], slv = [];
    const aw = i => { let w = 0; for (let k = 0; k < 4; k++) if (AB.indexOf(si[i * 4 + k]) >= 0) w += sw[i * 4 + k]; return w > .5; };
    for (let i = 0; i < ix.length; i += 3) (aw(ix[i]) && aw(ix[i + 1]) && aw(ix[i + 2]) ? slv : body).push(ix[i], ix[i + 1], ix[i + 2]); if (!slv.length) return;
    g.setIndex(body); const a = new T.BufferGeometry(); for (const n in g.attributes) a.setAttribute(n, g.attributes[n]); a.setIndex(slv); a.boundingSphere = g.boundingSphere; out.slv = a;
    const P0 = g.attributes.position.array, P1 = new Float32Array(P0), seen = new Uint8Array(P0.length / 3);
    for (const i of slv) { if (seen[i]) continue; seen[i] = 1; const S = P0[i * 3] >= 0 ? 1 : -1, x = P0[i * 3] * S - SHO[0], y = P0[i * 3 + 1] - SHO[1], z = P0[i * 3 + 2] - SHO[2], ax = x * CA + y * SA, ay = -x * SA + y * CA, sA = -ay, k = 1 - .25 * sm(sA, .13, .31) + .07 * sm(sA, .45, .52), ax2 = ax * k, z2 = (z - .002) * k + .002;
      P1[i * 3] = (SHO[0] + ax2 * CA - ay * SA) * S; P1[i * 3 + 1] = SHO[1] + ax2 * SA + ay * CA; P1[i * 3 + 2] = SHO[2] + z2; }
    const f = new T.BufferGeometry(); for (const n in g.attributes) if (n !== 'position') f.setAttribute(n, g.attributes[n]); f.setAttribute('position', new T.Float32BufferAttribute(P1, 3)); f.setIndex(slv); f.boundingSphere = g.boundingSphere; out.fps = f; }
  let FPT_SET = false;
  const RIDE = { hr: .03, sp: .04, ch: .03, nk: -.05, hd: -.03 };   /* H5: scooter seat posture (hips / spine / chest / neck / head pitch), tunable: GT.hero._ride */
  const FIST = { i: [1.1, 1.1, 1.2], m: [1.03, 1.03, 1.05], q: [1.04, 1, 1], spr: [.07, 0, -.06, -.14], thf: [-.75, -1.3, -.3, 1.1] };   /* H5: per-chain curl factors and the thumb-across offsets of a closed hand (tunable: GT.hero._fist) */
  const shareGeo = g => { const o = new T.BufferGeometry(); for (const n in g.attributes) o.setAttribute(n, g.attributes[n]); o.setIndex(g.index); o.boundingSphere = g.boundingSphere; return o; };   /* its own draw range per figure */
  function extraGeo(key, fn) { if (GEOC[key]) return GEOC[key]; const M = new Mesher(); fn(M); const g = M.geo(); g.userData.tris = M.tris; return GEOC[key] = g; }

  /* ================================================================== poses (flat channel arrays) */
  const C_HP = 0, C_HR = 3, C_SP = 6, C_CH = 9, C_NK = 12, C_HD = 15, C_CL = 18, C_ARM = 22, C_LEG = 52, C_X = 68, NCH = 72;
  /* arm (15): 0-2 chest-space wrist target rel. shoulder (x = outward) · 3-5 root-space target (x = outward) · 6 root weight · 7-9 elbow pole (chest space) · 10-12 wrist euler · 13 finger curl · 14 thumb
     leg (8): 0-2 ankle target, root space (x = outward) · 3 pitch (+ toes up) · 4 yaw (+ toe-out) · 5 roll · 6 toe bend · 7 knee out
     extra: C_X phone, +1 bowl/chopsticks */
  const LMAX = (L_TH + L_SH) * .994, HEEL = .055, BALL = .118;
  function neutral(P) { P.fill(0); for (let s = 0; s < 2; s++) { const a = C_ARM + s * 15, l = C_LEG + s * 8; P[a] = .055; P[a + 1] = -.522; P[a + 2] = .05; P[a + 3] = .25; P[a + 4] = .93; P[a + 5] = .03; P[a + 7] = .35; P[a + 9] = -1; P[a + 13] = .32; P[a + 14] = .2; P[l] = HIPX + .008; P[l + 1] = ANK; P[l + 2] = -.012; P[l + 4] = .12; } }
  const hand = (P, s, x, y, z) => { const a = C_ARM + s * 15; P[a] = x; P[a + 1] = y; P[a + 2] = z; P[a + 6] = 0; };
  const handW = (P, s, x, y, z, w) => { const a = C_ARM + s * 15; P[a + 3] = x; P[a + 4] = y; P[a + 5] = z; P[a + 6] = w === undefined ? 1 : w; };
  const pole = (P, s, x, y, z) => { const a = C_ARM + s * 15; P[a + 7] = x; P[a + 8] = y; P[a + 9] = z; };
  const wrist = (P, s, rx, ry, rz, curl, th) => { const a = C_ARM + s * 15; P[a + 10] = rx; P[a + 11] = ry; P[a + 12] = rz; if (curl !== undefined) P[a + 13] = curl; if (th !== undefined) P[a + 14] = th; };
  const foot = (P, s, x, y, z, pitch, yaw, toe, kout) => { const l = C_LEG + s * 8; P[l] = x; P[l + 1] = y; P[l + 2] = z; P[l + 3] = pitch || 0; P[l + 4] = yaw || 0; P[l + 6] = toe || 0; P[l + 7] = kout || 0; };
  const armFK = (P, s, al, be, xo) => hand(P, s, xo, (-L_ARM * cos(al) - L_FORE * cos(al + be)) * .985, (L_ARM * sin(al) + L_FORE * sin(al + be)) * .985);
  /** ankle (y, z) for a foot whose flat position is zc and whose pitch is p (heel pivot when toes are up, ball pivot when the heel is up) */
  const _ff = [0, 0];
  function footFlat(zc, p) { if (p >= 0) { _ff[0] = ANK * cos(p) + HEEL * sin(p); _ff[1] = zc - HEEL - ANK * sin(p) + HEEL * cos(p); } else { const q = -p; _ff[0] = ANK * cos(q) + BALL * sin(q); _ff[1] = zc + BALL + ANK * sin(q) - BALL * cos(q); } return _ff; }
  const strideLen = v => .5 + .56 * v - .024 * v * v;
  const DEFSPEED = { walk: 1.5, run: 3.8, sprint: 6.4, crouch_walk: 1.1, carry: 3.2 };

  /** locomotion: legs + pelvis + (optionally) swinging arms. o: { crouch, arms, lean } */
  function loco(P, c, v, o) { o = o || {}; const ph = c.phase, run = sm(v, 2.3, 3.6), spr = sm(v, 5, 6.8), cr = o.crouch || 0, mv = sm(v, .05, .6), D = lerp(.62, .37, run) - .05 * spr, S = D * c.stride, z0 = lerp(-.1, -.13, run) - .03 * spr + .07 * cr;
    const pHS = lerp(.36, .1, run) * mv * (1 - cr * .6), qTO = lerp(.9, 1.12, run) * mv, hz = -.015 * run - .04 * cr, base = -.012 - .3 * cr;
    let hy = HIPY0 + base + lerp(-.02 * cos(2 * TAU * (ph - .05)), -.034 * cos(2 * TAU * (ph - D / 2)) + .01, run) * mv;
    for (let s = 0; s < 2; s++) { const p = (ph + s * .5) % 1, l = C_LEG + s * 8; let zc, pitch, lift = 0, plant = 0, toe;
      if (p < D) { const u = p / D; zc = z0 + S * (.5 - u); pitch = pHS * (1 - sm(u, 0, .24)) - qTO * sm(u, .52, 1); plant = 1 - sm(u, .5, .78); toe = max(0, -pitch); }
      else { const u = (p - D) / (1 - D), e = u * u * (3 - 2 * u); zc = z0 + S * (e - .5); pitch = lerp(-qTO, pHS, sm(u, .12, .92)) - sin(u * PI) * (.25 + .5 * run) * mv; lift = (lerp(.045, .17, run) + .1 * spr + .05 * cr) * mv * sin(PI * pow(u, lerp(.92, .62, run))); toe = max(0, -pitch) * (1 - sm(u, 0, .35)); plant = sm(u, .93, 1) * .6; }
      const f = footFlat(zc, pitch), ay = f[0] + lift, az = f[1]; P[l] = .088 + .012 * cr + .03 * (1 - mv); P[l + 1] = ay; P[l + 2] = az; P[l + 3] = pitch; P[l + 4] = .09 + .1 * cr + .06 * (1 - mv); P[l + 6] = min(1.1, toe); P[l + 7] = .04 + .1 * cr;
      if (plant > 0) { const dz = az - hz, need = ay + sqrt(max(.04, LMAX * LMAX - dz * dz)) + .06; if (need < hy) hy = lerp(hy, need, plant); } }
    const yawA = (.07 + .07 * run) * mv, cy = cos(TAU * ph), sy = sin(TAU * ph), lean = (.035 + .1 * run + .09 * spr) * mv + .34 * cr + (o.lean || 0), tl = clamp((c.turn || 0) * v * .022, -.28, .28);
    P[C_HP] = .02 * sy * mv * (1 - run * .5) + tl * .25; P[C_HP + 1] = hy - HIPY0; P[C_HP + 2] = hz; P[C_HR] = lean * .45; P[C_HR + 1] = -yawA * cy; P[C_HR + 2] = (.045 - .02 * run) * sy * mv - tl;
    P[C_SP] = lean * .3; P[C_SP + 2] = -.028 * sy * mv + tl * .3; P[C_CH] = lean * .25; P[C_CH + 1] = 2.1 * yawA * cy; P[C_CH + 2] = tl * .2; P[C_NK] = -lean * .35 - .1 * cr; P[C_HD] = -lean * .25 - .12 * cr; P[C_HD + 1] = -1.0 * yawA * cy; P[C_HD + 2] = tl * .35;
    const sw = o.arms === undefined ? 1 : o.arms, A = (.4 * min(1, v / 1.5) + .28 * run + .22 * spr) * mv * sw;
    for (let s = 0; s < 2; s++) { const al = (s ? 1 : -1) * A * cos(TAU * ph - .2) + .06 * run, be = lerp(.2 + .32 * max(0, al) + .7 * cr, 1.42 + .12 * al, run * sw), a = C_ARM + s * 15;
      armFK(P, s, al, be, .055 - .1 * run * sm(al, -.1, .8) + .02 * cr); pole(P, s, .35, -1.3 * run - .5 * cr, -1 + .45 * run); P[a + 13] = .36 + .55 * run; P[a + 14] = .2 + .4 * run; P[C_CL + s * 2] = .03 * run; P[C_CL + s * 2 + 1] = al * .14; P[a + 10] = -.12 * al * (1 - run); }
  }
  /** feet stay planted in the world while the root turns on the spot; past ~22 deg a foot lifts and steps round (alternating). */
  function turnFeet(P, c) { const tf = c.tf, w = c.turn || 0, dt = c.dt || 0; if (!tf) return;
    if (tf.f !== c.frame) { tf.f = c.frame; tf.d[0] = clamp(tf.d[0] - w * dt, -.75, .75); tf.d[1] = clamp(tf.d[1] - w * dt, -.75, .75);
      if (tf.step < 0) { const a0 = abs(tf.d[0]), a1 = abs(tf.d[1]); if (max(a0, a1) > (abs(w) > .35 ? .38 : .05)) { tf.step = a0 > a1 + .02 ? 0 : a1 > a0 + .02 ? 1 : 1 - tf.last; tf.u = 0; tf.from = tf.d[tf.step]; } }
      if (tf.step >= 0) { tf.u = min(1, tf.u + dt / .27); tf.d[tf.step] = lerp(tf.from, clamp(w * .1, -.22, .22), sm(tf.u, 0, 1)); if (tf.u >= 1) { tf.last = tf.step; tf.step = -1; } } }
    for (let k = 0; k < 2; k++) { const sg = k ? -1 : 1, l = C_LEG + k * 8, d = tf.d[k]; if (!d && tf.step !== k) continue; const x = sg * P[l], z = P[l + 2], cd = cos(d), sd = sin(d), up = tf.step === k ? sin(PI * tf.u) : 0;
      P[l] = sg * (x * cd + z * sd); P[l + 2] = -x * sd + z * cd; P[l + 4] += sg * d; P[l + 1] += .04 * up; P[l + 3] -= .22 * up; P[l + 6] += .2 * up; }
    const av = (tf.d[0] + tf.d[1]) * .5, st = tf.step >= 0 ? sin(PI * tf.u) : 0; P[C_HR + 1] += .4 * av; P[C_CH + 1] -= .15 * av; P[C_HD + 1] += clamp(w * .09, -.3, .3) - .2 * av; P[C_HP + 1] -= .012 * st; P[C_HP] += (tf.step === 0 ? -.02 : .02) * st; }
  const idleBase = (P, c) => { const t = c.time, br = sin(t * 1.55), cyc = t * .09 + c.seed * .37, ph = cyc - floor(cyc), side = (floor(cyc) & 1) ? -1 : 1, w = side * (2 * sm(ph, 0, .12) - 1), aw = abs(w),
      gl = .26 * sin(t * .33 + c.seed) * sm(sin(t * .13 + c.seed * 2.1), .1, .8) + .05 * sin(t * .71 + 1.3);
    P[C_HP] = .03 * w; P[C_HP + 1] = -.012 - .003 * br - .007 * aw; P[C_HP + 2] = -.004; P[C_HR] = .0; P[C_HR + 1] = .05 * w; P[C_HR + 2] = .05 * w;
    P[C_SP] = .02 + .006 * br; P[C_SP + 2] = -.034 * w; P[C_CH] = .03 + .014 * br; P[C_CH + 1] = -.04 * w + gl * .12; P[C_CH + 2] = -.012 * w; P[C_NK] = -.01 + .004 * br; P[C_NK + 1] = gl * .3; P[C_HD] = -.03; P[C_HD + 1] = gl * .6; P[C_HD + 2] = -.01 * w; P[C_CL] = P[C_CL + 2] = .012 * br + .008;
    foot(P, 0, .128, ANK, .03, 0, .17, 0, .03 + .05 * max(0, -w)); foot(P, 1, .132, ANK, -.04, 0, .2, 0, .03 + .05 * max(0, w));
    for (let s = 0; s < 2; s++) { hand(P, s, .06 + .004 * br, -.508, .06 + .012 * sin(t * .6 + s * 2 + c.seed) + (s ? -1 : 1) * .012 * w); P[C_ARM + s * 15 + 13] = .4 + .07 * sin(t * .8 + s * 1.7); }
    turnFeet(P, c); };
  const sitLegs = (P, seatH, spread) => { P[C_HP + 1] = seatH + .1 - HIPY0; foot(P, 0, .11 + (spread || 0), ANK, .4, 0, .12, 0, .05); foot(P, 1, .11 + (spread || 0), ANK, .38, 0, .14, 0, .05); };
  const guard = (P, c) => { const b = sin(c.time * 3.1) * .008; P[C_HP + 1] = -.05 + b; P[C_HR] = .06; P[C_HR + 1] = -.2; P[C_SP] = .1; P[C_CH] = .1; P[C_CH + 1] = -.18; P[C_NK] = -.1; P[C_HD + 1] = .34; P[C_HD] = -.02;
    foot(P, 0, .12, ANK, .17, 0, -.05, 0, 0); { const f = footFlat(-.2, -.45); foot(P, 1, .14, f[0], f[1], -.45, .55, .45, .1); }
    hand(P, 0, -.1, -.13, .27); pole(P, 0, .5, -1, -.1); wrist(P, 0, 0, .3, 0, 1, .8); hand(P, 1, -.07, -.17, .2); pole(P, 1, .55, -1, -.2); wrist(P, 1, 0, .3, 0, 1, .8); P[C_CL] = P[C_CL + 2] = .06; };
  const POSE = {
    idle: idleBase,
    walk: (P, c, s, v) => loco(P, c, v), run: (P, c, s, v) => loco(P, c, v), sprint: (P, c, s, v) => loco(P, c, v),
    crouch(P, c, s, v) { if (v > .25) return loco(P, c, v, { crouch: 1, arms: .45 }); const b = sin(c.time * 1.5) * .004; P[C_HP + 1] = -.4 + b; P[C_HP + 2] = -.07; P[C_HR] = .2; P[C_SP] = .22; P[C_CH] = .2; P[C_NK] = -.22; P[C_HD] = -.22;
      foot(P, 0, .13, ANK, .13, 0, .2, 0, .12); { const f = footFlat(-.2, -.7); foot(P, 1, .13, f[0], f[1], -.7, .2, .7, .1); } handW(P, 0, .15, .56, .24); pole(P, 0, 1, 0, -.4); handW(P, 1, .14, .44, .1); pole(P, 1, 1, 0, -.5); },
    crouch_walk: (P, c, s, v) => loco(P, c, v, { crouch: 1, arms: .45 }),
    aim(P, c, s, v) { if (v > .25) loco(P, c, v, { arms: 0, lean: .02 }); else { idleBase(P, c); P[C_HP + 1] = -.03; foot(P, 0, .12, ANK, .1, 0, .05); foot(P, 1, .13, ANK, -.12, 0, .4); P[C_HR + 1] = -.12; P[C_CH + 1] = -.1; P[C_HD + 1] = .2; }
      const ap = clamp(s.aimPitch || 0, -1, 1); P[C_CH] += .06 + ap * .25; P[C_SP] += ap * .15; P[C_NK] -= ap * .1;
      hand(P, 1, -.165, -.03 - .26 * sin(ap * .6), .5 * cos(ap * .6)); pole(P, 1, .5, -.85, -.2); wrist(P, 1, 0, 0, 0, .95, .7); hand(P, 0, -.2, -.055 - .24 * sin(ap * .6), .455 * cos(ap * .6)); pole(P, 0, .45, -.9, -.1); wrist(P, 0, 0, .35, 0, .9, .6); P[C_CL] = P[C_CL + 2] = .08; },
    carry(P, c, s, v) { loco(P, c, v > .05 ? v : 0, { arms: 1.15 }); hand(P, 1, .1, -.515, .0); pole(P, 1, .4, 0, -1); wrist(P, 1, 0, 0, 0, 1, .9); P[C_CH + 2] += -.07; P[C_SP + 2] += -.04; P[C_CL + 2] = -.06; P[C_CL] = .05; },
    /* at the wheel of a car (H4): seated low, feet at the pedals, hands at ten and two on a wheel that turns with s.steer. s.wheel = [y above the seat, z forward, radius, rake] */
    drive(P, c, s) { const br = sin(c.time * 1.6), seatH = s.seatH === undefined ? .3 : s.seatH, wh = s.wheel || [.5, .4, .17, .42], st = clamp(s.steer || 0, -1, 1) * 1.25, cy = seatH + .1 + wh[0], cz = wh[1], R = wh[2], rk = wh[3];
      P[C_HP + 1] = seatH + .1 - HIPY0; P[C_HP + 2] = -.06; foot(P, 0, .16, ANK + .03, .5, -.25, .1, 0, .12); foot(P, 1, .1, ANK + .04, .56, -.3, .06, 0, .1); P[C_HR] = -.16; P[C_SP] = .07 + .005 * br; P[C_CH] = .06; P[C_CH + 1] = -st * .04; P[C_NK] = .03; P[C_HD] = .02; P[C_HD + 1] = -st * .12;
      for (let k = 0; k < 2; k++) { const sg = k ? -1 : 1, a = sg * .92 + st, x = R * sin(a), up = R * cos(a); handW(P, k, sg * x, cy + up * cos(rk), cz - up * sin(rk), 1); pole(P, k, 1, -.75, -.35); wrist(P, k, -.25, -1.25, sg * st * .2, 1.0, .75); } },
    sit(P, c, s) { const br = sin(c.time * 1.6); sitLegs(P, s.seatH === undefined ? .45 : s.seatH); P[C_HR] = -.1; P[C_SP] = .1 + .006 * br; P[C_CH] = .08; P[C_NK] = -.06; for (let k = 0; k < 2; k++) { handW(P, k, .125, (s.seatH === undefined ? .45 : s.seatH) + .125, .26 + k * .02); pole(P, k, 1, .1, -.5); wrist(P, k, .25, -.9, 0, .2); } },
    lean(P, c) { const sw = sin(c.time * .4 + c.seed); P[C_HP + 1] = -.03; P[C_HP + 2] = -.07; P[C_HR] = -.1; P[C_SP] = -.02; P[C_CH] = .08; P[C_NK] = .06; P[C_HD + 1] = .25 * sw; P[C_HD] = .04;
      foot(P, 0, .1, ANK, .13, 0, .1); { const f = footFlat(.25, 0); foot(P, 1, .04, f[0], f[1], 0, -.3, 0, .15); } for (let k = 0; k < 2; k++) { hand(P, k, .03, -.405, .1); pole(P, k, 1, .1, -.8); wrist(P, k, 0, 0, 0, .9); } },
    phone(P, c, s, v) { if (v > .25) loco(P, c, v, { arms: .7 }); else idleBase(P, c); const t = c.time; hand(P, 1, -.125, -.215 + .004 * sin(t * 1.7), .28); pole(P, 1, .7, -.7, -.3); wrist(P, 1, -.7, 1.25, 0, .5, .35); P[C_NK] += .2; P[C_HD] += .22; P[C_HD + 1] += -.08; P[C_CH] += .04; P[C_X] = 1; },
    talk(P, c, s, v) { if (v > .25) loco(P, c, v, { arms: .6 }); else idleBase(P, c); const t = c.time, g = sin(t * 2.3) * .5 + sin(t * 3.7 + 1) * .5; hand(P, 1, .03 + .04 * g, -.3 + .05 * sin(t * 2.9), .27 + .04 * sin(t * 1.7)); pole(P, 1, .8, -.5, -.4); wrist(P, 1, -.2 + .2 * g, .9, 0, .25, .1);
      if (!(v > .25)) { hand(P, 0, .0, -.44, .12); pole(P, 0, 1, 0, -.6); } P[C_HD] += .05 * sin(t * 2.3); P[C_HD + 1] += .08 * sin(t * .9); P[C_CH + 1] += .04 * g; },
    handsup(P, c, s, v) { if (v > .25) loco(P, c, v, { arms: 0 }); else idleBase(P, c); const b = sin(c.time * 5) * .004; for (let k = 0; k < 2; k++) { hand(P, k, .115, .25 + b, .1); pole(P, k, 1, -.75, .05); wrist(P, k, -.15, 0, 0, .06, 0); } P[C_CL] = P[C_CL + 2] = .22; P[C_CH] -= .05; },
    use(P, c, s) { idleBase(P, c); const k = sm(c.t, 0, .3); P[C_CH] += .12 * k; P[C_SP] += .08 * k; P[C_CH + 1] += .16 * k; hand(P, 1, lerp(.055, -.03, k), lerp(-.52, -.17, k), lerp(.05, .5, k)); pole(P, 1, .6, -.6, -.5); wrist(P, 1, 0, .2 * k, 0, .3); },
    enter_car(P, c, s) { const k = sm(c.t, .05, .75), d = sin(k * PI); idleBase(P, c); const sh = (s.seatH === undefined ? .36 : s.seatH) + .1 - HIPY0; P[C_HP + 1] = lerp(-.01, sh, k) - .1 * d; P[C_HR] = .35 * d - .1 * k; P[C_SP] = .2 * d + .1 * k; P[C_NK] = -.15 * d; foot(P, 0, .11, ANK, lerp(.02, .42, k), 0, .12); foot(P, 1, .11, ANK + .1 * sin(sm(k, .3, .9) * PI), lerp(-.03, .4, sm(k, .3, .9)), 0, .14);
      hand(P, 1, lerp(.055, -.02, d), lerp(-.52, -.2, d), lerp(.05, .42, d)); if (k > .6) { const q = sm(k, .6, 1); handW(P, 0, .2, .86, .42, q); handW(P, 1, .2, .86, .42, q * (1 - d)); } },
    exit_car(P, c, s) { const t0 = c.t; c.t = max(0, .8 - t0); POSE.enter_car(P, c, s); c.t = t0; },
    fall(P, c) { const t = c.t, a = sm(t, 0, .34), b = sm(t, .2, .62), bo = sin(sm(t, .56, .9) * PI) * .025, fl = sin(sm(t, .04, .52) * PI), b2 = b * b;   // knees buckle, sit back, roll onto the back, limbs settle
      P[C_HP + 1] = -.4 * a * (1 - b) - .872 * b + bo; P[C_HP + 2] = -.2 * a - .32 * b; P[C_HR] = -.3 * a - 1.22 * b; P[C_HR + 2] = .05 * b; P[C_SP] = .25 * fl - .03 * b; P[C_CH] = .28 * fl; P[C_NK] = .35 * fl + .06 * b; P[C_HD] = .25 * fl; P[C_HD + 1] = .3 * b; P[C_CL] = P[C_CL + 2] = .15 * fl;
      foot(P, 0, .16, ANK + .07 * sin(b * PI), lerp(.02, .36, b), .4 * sin(a * PI) * (1 - b), .2 + .3 * b, 0, .12 * b); foot(P, 1, .13, ANK + .11 * sin(b * PI), lerp(-.03, .2, b), .4 * sin(a * PI) * (1 - b), .2 + .45 * b, 0, .22 * b);
      handW(P, 0, .52, lerp(1.25, .045, b2) + .2 * fl * (1 - b), lerp(.08, -.72, b), a); handW(P, 1, .46, lerp(1.35, .045, b2) + .2 * fl * (1 - b), lerp(.16, -.92, b), a); pole(P, 0, 1, .3, 0); pole(P, 1, 1, .3, 0); wrist(P, 0, 0, 0, 0, .15); wrist(P, 1, 0, 0, 0, .25); },
    dive(P, c) { const k = sm(c.t, 0, .55), air = sin(k * PI); P[C_HP + 1] = lerp(0, -.83, k * k) + .22 * air; P[C_HP + 2] = .35 * k; P[C_HR] = 1.5 * sm(c.t, 0, .42); P[C_SP] = -.12 * k; P[C_CH] = -.1 * k; P[C_NK] = -.45 * k; P[C_HD] = -.3 * k;
      for (let s = 0; s < 2; s++) { foot(P, s, .1 + s * .03, lerp(ANK, .07, k) + .3 * air, lerp(0, -.5 - s * .04, k), -1.3 * k, .1, 0); handW(P, s, .16 + s * .04, lerp(1.0, .06, k * k) + .35 * air, lerp(.3, 1.22, k), 1); pole(P, s, 1, -.2, 0); wrist(P, s, 0, 0, 0, .1); } },
    /* pt1: the on-foot jump (js/onfoot.js, Space). s.jump = { ph: 0 take-off dip (k 0..1) | 1 in the air (u = vy / vy0: 1 leaving the ground … -1 falling) | 2 landing (k 0..1, h = how hard), run 0..1 }.
       Standing: both knees tuck and the arms come up; running: a split stride, lead knee high, trail leg back, arms opposite; on the way down the legs reach for the ground; landing soaks it up in the knees. */
    jump(P, c, s) { const J = s.jump || { ph: 1, u: 0 }, run = clamp(J.run || 0, 0, 1); idleBase(P, c); P[C_HR + 1] = 0; P[C_CH + 1] = 0;
      if (J.ph === 0) { const k = sm(J.k || 0, 0, 1); P[C_HP + 1] = -.14 * k; P[C_HP + 2] = -.03 * k; P[C_HR] = .2 * k; P[C_SP] = .12 * k; P[C_CH] = .08 * k; P[C_NK] = -.12 * k; foot(P, 0, .11, ANK, .08 + .1 * run, 0, .12); foot(P, 1, .12, ANK, -.06 - .14 * run, -.25 * run, .15, .25 * run);
        for (let q = 0; q < 2; q++) { hand(P, q, .08, -.47 + .04 * k, -.16 * k); pole(P, q, .4, -.4, -1); } return; }
      if (J.ph === 2) { const k = J.k || 0, h = clamp(J.h || .5, .2, 1), d = sin(min(1, k * 1.5) * PI * .5) * (1 - sm(k, .45, 1)), dd = d * (.08 + .12 * h); P[C_HP + 1] = -dd; P[C_HP + 2] = -.02 - .04 * d; P[C_HR] = .26 * d * h + .05; P[C_SP] = .16 * d; P[C_CH] = .1 * d; P[C_NK] = -.1 * d;
        foot(P, 0, .12, ANK, .1 + .06 * run, 0, .15, 0, .06); foot(P, 1, .13, ANK, -.08 - .08 * run, -.2 * run * (1 - k), .18, .2 * run * (1 - k), .06); for (let q = 0; q < 2; q++) { hand(P, q, .12 + .05 * d, -.42 + .08 * d, .14 * d + .04); pole(P, q, .6, -.6, -.6); } return; }
      const u = clamp(J.u === undefined ? 0 : J.u, -1, 1), up = max(0, u), dn = max(0, -u), tuck = 1 - dn * .75, st = 1 - run;
      P[C_HP + 1] = -.03 + .02 * up; P[C_HP + 2] = -.02; P[C_HR] = .06 + .1 * run - .05 * dn; P[C_SP] = .05 + .06 * run; P[C_CH] = .03; P[C_NK] = -.06 - .06 * dn; P[C_HD] = -.04 + .06 * dn;
      /* lead leg (0): knee up and forward · trail leg (1): standing jump tucks it the same, a running jump sends it back */
      { const ly = ANK + (.3 + .08 * run) * tuck, lz = .13 + .14 * run * tuck; foot(P, 0, .11, ly, lz, -.25 * tuck, .1, 0, .08); }
      { const ty = ANK + lerp(.26 * tuck, .2 + .1 * tuck, run), tz = lerp(.06 * tuck, -.32 + .12 * dn, run); foot(P, 1, .125, ty, tz, lerp(-.3, -.9, run) * tuck, .14, .5 * run * tuck, .06); }
      for (let q = 0; q < 2; q++) { const lead = q === 0, sw = run * (lead ? -1 : 1); hand(P, q, .1 + .1 * dn + .06 * st * up, -.36 + .2 * up * st + .14 * dn + .08 * sw * -1, .12 + .16 * sw + .1 * st * up); pole(P, q, .6, -.8, -.4); wrist(P, q, 0, 0, 0, .5); } P[C_CL] = P[C_CL + 2] = .05 + .04 * up; },
    jump0(P, c, s) { POSE.jump(P, c, s); }, land(P, c, s) { POSE.jump(P, c, s); },   /* pt1: take-off dip and landing are their own states so the pose blends into and out of the air */
    cheer(P, c) { idleBase(P, c); const t = c.time, b = abs(sin(t * 4.6)); P[C_HP + 1] = -.05 + .04 * b; P[C_CH] = -.08; P[C_HD] = -.12; for (let k = 0; k < 2; k++) { hand(P, k, .13 + .03 * sin(t * 4.6 + k), .3 + .07 * b + .03 * k, .07); pole(P, k, 1, -.6, .1); wrist(P, k, 0, 0, 0, k ? 1 : .1, k ? .8 : 0); } P[C_CL] = P[C_CL + 2] = .25; },
    jumpshot(P, c) { const k = sm(c.t, 0, .45), d = sin(sm(c.t, 0, .9) * PI); idleBase(P, c); P[C_HP + 1] = -.16 * (1 - k) * sm(c.t, 0, .15) - .01; P[C_CH] = -.1 * k; hand(P, 1, .02, lerp(-.2, .4, k), lerp(.2, .2, k)); pole(P, 1, .9, -.5, .2); wrist(P, 1, -.6 * k + .9 * sm(c.t, .45, .6), .3, 0, .2); hand(P, 0, -.1, lerp(-.2, .24, k), .2); pole(P, 0, .8, -.6, 0); wrist(P, 0, 0, .4, 0, .2); },
    lift(P, c) { idleBase(P, c); const u = .5 - .5 * cos(c.time * 3); for (let k = 0; k < 2; k++) { armFK(P, k, .08, .15 + 2.1 * u, .07); pole(P, k, .3, 0, -1); wrist(P, k, 0, 1.3, 0, 1, .8); } P[C_CH] = -.03; },
    fish(P, c) { idleBase(P, c); const t = c.time; hand(P, 1, -.09, -.33 + .01 * sin(t * .8), .27); pole(P, 1, .6, -.6, -.5); wrist(P, 1, 0, .5, 0, 1, .8); hand(P, 0, -.15, -.28, .38); pole(P, 0, .5, -.8, -.2); wrist(P, 0, 0, .7, 0, 1, .8); P[C_HR + 1] = -.12; },
    pet(P, c) { POSE.crouch(P, c, {}, 0); const t = c.time; handW(P, 1, .02 + .04 * sin(t * 3), .36 + .03 * sin(t * 6), .5, 1); pole(P, 1, 1, .2, -.4); wrist(P, 1, .3, -1.2, 0, .15); P[C_HD] = .1; },
    ride(P, c, s) { const ped = !!s.pedal, seatH = s.seatH === undefined ? (ped ? .9 : .74) : s.seatH, bars = s.bars || (ped ? [.27, 1.06, .5] : [.27, 1.03, .46]), deck = s.deck || [.12, .3, .26], tn = clamp(s.steer !== undefined ? s.steer * 1.2 : (s.turn || 0), -1.5, 1.5), v = abs(s.speed || 0), swg = sin(clamp(s.swing || 0, 0, 1) * PI), ms = (s.mountSide || 1) > 0 ? 1 : 0, br = sin(c.time * 1.6), vib = sin(c.time * 31) * .0015 * min(1, v / 4);
      P[C_HP + 1] = seatH + .1 - HIPY0 + vib; P[C_HP + 2] = -.02; P[C_HR] = ped ? .3 : RIDE.hr; P[C_HR + 2] = -tn * .1; P[C_SP] = ped ? .28 : RIDE.sp; P[C_SP + 2] = tn * .04; P[C_CH] = (ped ? .14 : RIDE.ch) + .006 * br; P[C_CH + 1] = tn * .06; P[C_NK] = ped ? -.32 : RIDE.nk; P[C_HD] = ped ? -.14 : RIDE.hd; P[C_HD + 1] = tn * .22; P[C_HD + 2] = tn * .06;   /* H5: on the scooter he sits up (the head about 15 cm further back than the old racing crouch), which is how scooters are ridden and what lets the first-person view see the bars below a level gaze */
      for (let k = 0; k < 2; k++) { const sg = k ? -1 : 1; handW(P, k, bars[0], bars[1] + vib, bars[2] - sg * tn * .05 * (s.gripIK ? 0 : 1), 1);   /* gripIK: js/onfoot.js puts the hands on the real grips afterwards (H.reach), turning with the bars */ pole(P, k, 1, -.6, -.4); wrist(P, k, -.3, -1.3, 0, .95, .7);
        if (ped) { const cr = s.crank || [.1, .3, .12], a = c.pedal * TAU + k * PI; foot(P, k, cr[0], cr[1] + ANK + .17 * cos(a), cr[2] + .17 * sin(a) - .07, -.12 + .22 * sin(a), .04, 0, .02); }
        else foot(P, k, deck[0] + (k === ms ? .1 * swg : 0), deck[1] + ANK + (k === ms ? .34 * swg : 0), deck[2] + k * .03 - (k === ms ? .42 * swg : 0), k === ms ? -.5 * swg : 0, .14, 0, .1);
        if (s.pillion) { handW(P, k, .15, seatH + .34, .2, 1); pole(P, k, 1, 0, -.6); wrist(P, k, 0, 0, 0, .5); } }
      { const stop = (1 - sm(v, .25, 1.3)) * (1 - min(1, swg * 3)) * (ped || s.pillion || s.feetUp ? 0 : 1), nz = (fb(c.time * (1.5 + v * .9), 3.7, 5, 2) - .5) * 2 * min(1, v / 5), ac = clamp(-(c.acc || 0) * .014, -.09, .13), tuck = .05 * sm(v, 6, 13), md = ms ? -1 : 1;
        P[C_SP] += ac * .5 + tuck + .02 * nz + .1 * swg; P[C_CH] += ac * .5 + tuck + .014 * nz; P[C_NK] -= ac * .5 + tuck + .012 * nz; P[C_HD] -= ac * .4 + tuck * .8 + .02 * nz; P[C_HD + 2] += tn * .05; P[C_NK + 2] = tn * .04; P[C_CH + 1] += md * .2 * swg; P[C_HR + 2] -= md * .1 * swg; P[C_HP + 1] += .004 * nz;
        for (let k = 0; k < 2; k++) P[C_LEG + k * 8 + 7] += .07 * max(0, (k ? -1 : 1) * tn);
        if (stop > 0) { const l = C_LEG; P[l] = lerp(P[l], .25, stop); P[l + 1] = lerp(P[l + 1], ANK + .004, stop); P[l + 2] = lerp(P[l + 2], .08, stop); P[l + 4] = lerp(P[l + 4], .3, stop); P[l + 7] = lerp(P[l + 7], .25, stop); P[C_HR + 2] += .03 * stop; } }
      if (s.pillion) { P[C_HR] = .04; P[C_SP] = .08; P[C_CH] = .06; P[C_NK] = -.06; } },
    mount(P, c, s) { POSE.ride(P, c, Object.assign({}, s, { swing: sin(PI * clamp(c.t / .8, 0, 1)), speed: 0, feetUp: c.t < .9 })); },
    dismount(P, c, s) { POSE.ride(P, c, Object.assign({}, s, { swing: sin(PI * clamp(c.t / .8, 0, 1)), speed: 0, feetUp: true })); },
    getup(P, c, s) { const t0 = c.t, u = clamp(t0 / 1.6, 0, 1), a = sm(u, 0, .6), b = sm(u, .55, 1), mid = sin(a * PI) * (1 - b); neutral(TA); c.t = 2; POSE.fall(TA, c, s); neutral(TB); c.t = t0; POSE.crouch(TB, c, s, 0); idleBase(P, c);
      for (let i = 0; i < NCH; i++) P[i] = lerp(lerp(TA[i], TB[i], a), P[i], b); P[C_HR] += .5 * mid; P[C_SP] += .25 * mid; P[C_CH] += .2 * mid; P[C_NK] -= .15 * mid; P[C_HP + 1] -= .06 * mid;
      handW(P, 0, .3, lerp(.05, .5, sm(u, .45, .8)), lerp(-.5, .1, a), 1 - b); P[C_ARM + 13] = .1; },
    wash(P, c, s) { const t = c.time, ph = s.beat !== undefined ? s.beat * PI : t * 7, u = (t % 2.8) / 2.8, rk = sm(u, .72, .82) * (1 - sm(u, .9, .99)); idleBase(P, c); P[C_HP + 1] = -.03; P[C_HP + 2] = -.03; P[C_HR] = .14; P[C_SP] = .2; P[C_CH] = .16 + .01 * sin(ph); P[C_CH + 1] = .05 * sin(ph * .5) + .25 * rk; P[C_NK] = -.02; P[C_HD] = .22; P[C_HD + 1] = .3 * rk;
      foot(P, 0, .13, ANK, .0, 0, .2); foot(P, 1, .13, ANK, -.02, 0, .22); handW(P, 0, lerp(.09, .42, rk), lerp(.94, 1.04, rk) + .04 * sin(rk * PI), lerp(.37, .3, rk), 1); pole(P, 0, 1, -.4, -.4); wrist(P, 0, -.2, .6, 0, .7, .4);
      handW(P, 1, .05 + .045 * cos(ph) * (1 - rk), .955 + .018 * sin(ph * 2) * (1 - rk), .375 + .04 * sin(ph) * (1 - rk), 1); pole(P, 1, 1, -.4, -.5); wrist(P, 1, -.3, -.4, 0, .8, .5); },
    eat(P, c, s, v) { const t = c.time, cyc = (t % 2.4) / 2.4, u = sm(cyc, .15, .42) * (1 - sm(cyc, .62, .85)); if (s.seated) { sitLegs(P, s.seatH === undefined ? .45 : s.seatH, .02); P[C_HR] = -.02; P[C_SP] = .16; } else idleBase(P, c);
      P[C_CH] += .08 + .08 * u; P[C_NK] += .1; P[C_HD] += .12 + .16 * u; hand(P, 0, -.115, -.3, .25); pole(P, 0, .8, -.6, -.3); wrist(P, 0, -.1, 1.45, 0, .35, 0); hand(P, 1, lerp(-.13, -.165, u), lerp(-.27, .075, u), lerp(.3, .2, u)); pole(P, 1, 1, -.3 - .4 * u, -.3); wrist(P, 1, -.3 - .3 * u, .7, 0, .75, .5); P[C_X + 1] = 1; },
    dance(P, c, s) { const b = s.beat !== undefined ? s.beat : c.time * 2, sx = sin(PI * b / 2), bo = abs(sin(PI * b)), seg = sm(sin(PI * b / 4), -.25, .25); idleBase(P, c);
      P[C_HP] = .1 * sx; P[C_HP + 1] = -.025 - .025 * bo; P[C_HR + 1] = .16 * sx; P[C_HR + 2] = .05 * sx; P[C_SP + 2] = -.05 * sx; P[C_CH + 1] = -.1 * sx; P[C_CH] = -.02; P[C_HD + 2] = .06 * sx; P[C_HD + 1] = .1 * sx;
      for (let k = 0; k < 2; k++) { const sg = k ? -1 : 1, lf = max(0, sin(PI * b + k * PI)), up = pow(lf, 2) * .07, wv = sin(PI * b / 2 + k * .5);
        const fx = .12 + sg * sx * .07; { const f = footFlat(.01 - k * .02, -up * 6); foot(P, k, fx, f[0] + up * .3, f[1], -up * 6, .2, up * 6); }
        const ax = lerp(.12 + .2 * sg * wv, k ? .16 : .34 + .05 * bo, seg), ay = lerp(.18 + .1 * cos(PI * b + k), k ? -.36 : -.02, seg), az = lerp(.16, k ? .06 : .05, seg); hand(P, k, ax, ay, az); pole(P, k, 1, lerp(-.6, k ? .1 : -.3, seg), lerp(0, k ? -.9 : -.1, seg)); wrist(P, k, 0, lerp(0, k ? 0 : .8, seg), 0, .15, 0); }
      P[C_CL] = P[C_CL + 2] = .12; },
    punch(P, c, s) { guard(P, c); const hv = !!s.heavy, dur = hv ? .62 : .34, u = clamp(c.t / dur, 0, 1);
      if (!hv) { const e = sin(PI * pow(u, .7)); hand(P, 0, lerp(-.1, -.19, e), lerp(-.13, .0, e), lerp(.27, .575, e)); pole(P, 0, .5, -1 + .4 * e, -.1); wrist(P, 0, 0, .3 - 1.2 * e, 0, 1, .8); P[C_CH + 1] += -.3 * e; P[C_HR + 1] += -.1 * e; P[C_HP + 2] = .04 * e; P[C_CL] = .06 + .1 * e; }
      else { const w = sm(u, 0, .3) * (1 - sm(u, .3, .45)), e = sm(u, .3, .5) * (1 - sm(u, .68, 1)); hand(P, 1, lerp(-.07, .06, w) - .19 * e, -.17 + .05 * w + .2 * e, .2 - .12 * w + .4 * e); pole(P, 1, .6, -.8 + .5 * e, -.2); wrist(P, 1, 0, .3 - 1.2 * e, 0, 1, .8);
        P[C_CH + 1] += .22 * w + .6 * e - .1; P[C_HR + 1] += .08 * w + .38 * e; P[C_HP + 2] = -.03 * w + .09 * e; P[C_SP] += .1 * e; P[C_CL + 2] = .06 + .12 * e; const f = footFlat(-.2 + .05 * e, -.45 - .3 * e); foot(P, 1, .14, f[0], f[1], -.45 - .3 * e, .55 - .7 * e, .45 + .3 * e, .1 - .2 * e); } },
    hit(P, c, s) { guard(P, c); const t = c.t, env = sin(min(1, t / .1) * PI / 2) * exp(-max(0, t - .1) * 4.2), e2 = sm(t, .05, .3) * (1 - sm(t, .5, .9)), sd = s.side || 1; P[C_CH] += -.42 * env; P[C_SP] += -.2 * env; P[C_NK] += -.2 * env; P[C_HD] += -.25 * env; P[C_HD + 1] += -.5 * env * sd; P[C_CH + 1] += -.3 * env * sd; P[C_HP + 2] = -.12 * e2; P[C_HP + 1] += -.04 * e2;
      for (let k = 0; k < 2; k++) { const a = C_ARM + k * 15; P[a] += .12 * env; P[a + 1] += .1 * env * (k ? 1 : -1); P[a + 2] -= .1 * env; P[a + 13] = 1 - .7 * env; } const f = footFlat(-.2 - .16 * e2, -.3 * (1 - e2)); foot(P, 1, .15, f[0] + .04 * sin(e2 * PI), f[1], -.3 * (1 - e2), .5, .3 * (1 - e2), .1); }
  };
  const TA = new Float32Array(NCH), TB = new Float32Array(NCH), STATES = Object.keys(POSE);
  const BLEND = { punch: .09, hit: .07, fall: .12, dive: .1, aim: .16, getup: .12, mount: .3, dismount: .2, jump0: .05, jump: .08, land: .06 };

  /* ================================================================== rigid hand props (phone, bowl, chopsticks) */
  function handProps(B) { const out = {};
    for (const S of [1, -1]) { const g = new T.Group(); g.name = 'prop' + (S > 0 ? 'L' : 'R'); g.position.set(-.024 * S, -.072, .004); B['hand' + (S > 0 ? 'L' : 'R')].add(g); out[g.name] = g; }
    /* built on first use (the kit materials are not free) */
    const built = {}, lazy = (name, fn) => Object.defineProperty(out, name, { enumerable: true, get() { if (!built[name]) { built[name] = fn(); built[name].visible = false; } return built[name]; } });
    lazy('phone', () => { const kp = GT.kit(); kp.box(GT.mat('plastic_black', { rough: .3 }), .0085, .152, .073, .006, -.02, .004, { bevel: .003 }); kp.box('emissive_screen', .001, .14, .066, .0108, -.02, .004); kp.box(GT.mat('plastic_black', { color: 0x2b2d33 }), .003, .03, .03, .0005, .028, .016, { bevel: .001 }); const m = kp.build({ cast: true }); out.propR.add(m); return m; });
    lazy('bowl', () => { const kb = GT.kit(), cer = GT.mat('plastic_white', { color: 0xe9e4d6, rough: .25 }); kb.push(-.04, -.012, .004, { rz: PI / 2 }); kb.cyl(cer, .066, .034, .05, 0, .014, 0, { seg: 20 }); kb.cyl(cer, .034, .03, .008, 0, -.014, 0, { seg: 20 }); kb.cyl(GT.mat('plastic_red', { color: 0x9c2f22, rough: .5 }), .067, .066, .004, 0, .04, 0, { seg: 20 }); kb.sphere(GT.mat('plastic_white', { color: 0xc9a25a, rough: .6 }), .058, 0, .026, 0, { s: [1, .32, 1] }); kb.pop(); const m = kb.build({ cast: true }); out.propL.add(m); return m; });
    lazy('sticks', () => { const kc = GT.kit(), wd = GT.mat('wood_plank', { color: 0x7a5a38 }); kc.cyl(wd, .0022, .0032, .235, .018, -.115, .012, { seg: 6, rx: .42, rz: -.12 }); kc.cyl(wd, .0022, .0032, .235, .026, -.112, .0, { seg: 6, rx: .3, rz: -.16 }); const m = kc.build({ cast: true }); out.propR.add(m); return m; });
    out._built = built; return out; }

  /* ================================================================== the figure */
  const IDENT = new T.Matrix4(), SALIAS = { get_up: 'getup', stand_up: 'getup', turn: 'idle', turn_l: 'idle', turn_r: 'idle', jab: 'punch', carry_run: 'carry', wave: 'cheer', jog: 'run', cower: 'crouch', stagger: 'hit', scooter: 'ride', bike: 'ride' };
  let SEED = 0;
  function make(who, opts) { who = who === 'lie' ? 'lie' : 'kai'; opts = opts || {};
    const group = new T.Group(), inner = new T.Group(), SC = who === 'kai' ? .986 : .947; group.name = 'hero_' + who; group.add(inner); inner.scale.setScalar(SC);
    const sk = makeSkeleton(), skeleton = sk.skeleton, B = {}; sk.bones.forEach(b => { B[b.name] = b; }); inner.add(sk.bones[0]);
    const props = handProps(B), sets = {}, extra = {}; B.head.scale.setScalar(who === 'kai' ? 1.045 : 1.05);
    const mk = (geo, mat, name) => { const m = new T.SkinnedMesh(geo, mat); m.name = 'hero_' + who + '_' + name; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; inner.add(m); m.bind(skeleton, IDENT); return m; };
    const H = { group, who, height: who === 'kai' ? 1.8 : 1.74, scale: SC, outfits: Object.keys(OUTFITS[who]), outfit: null, state: 'idle', fpRadius: .3, headShown: true, helmet: false, box: false, mask: false, shades: false, props,
      bones: { root: B.root, hips: B.hips, spine: B.spine, chest: B.chest, neck: B.neck, head: B.head, handL: B.handL, handR: B.handR, footL: B.footL, footR: B.footR, armL: B.armL, armR: B.armR, foreL: B.foreL, foreR: B.foreR, thighL: B.thighL, thighR: B.thighR, shinL: B.shinL, shinR: B.shinR, clavL: B.clavL, clavR: B.clavR, toeL: B.toeL, toeR: B.toeR, pack: B.pack, propL: props.propL, propR: props.propR } };
    function ensureSet(name) { if (sets[name]) return sets[name]; const def = OUTFITS[who][name], g = outfitGeo(who, name), tx = def.tex(), set = { meshes: {}, def, tris: g.tris };
      const mats = { skin: matOf('skin_' + who, () => mkMat(paintSkin(who), { alphaTest: .5 })), hair: matOf('hair_' + who, () => mkMat(paintHair(who), { alphaTest: .5, side: T.DoubleSide })),
        head: matOf('skinH_' + who, () => mkMat(paintSkin(who), { alphaTest: .5 })), gearH: matOf('gearH_' + who + name, () => mkMat(tx.gear, { side: T.DoubleSide })),
        top: matOf('top_' + who + name, () => mkMat(tx.top, { side: T.DoubleSide })), bot: matOf('bot_' + who + name, () => mkMat(tx.bot, { side: T.DoubleSide })), gear: matOf('gear_' + who + name, () => mkMat(tx.gear, { side: T.DoubleSide })) };
      { const Hm = GT.humans; if (Hm) { Hm.patchSkin(mats.skin); Hm.patchSkin(mats.head); Hm.patchHair(mats.hair); Hm.patchCloth(mats.top); Hm.patchCloth(mats.bot); } }   /* PP: skin, hair and cloth shading */
      for (const k of ['skin', 'head', 'hair', 'top', 'bot', 'gear']) { set.meshes[k] = mk(g[k], mats[k], k + '_' + name); set.meshes[k].visible = false; } fpCull(set.meshes.head); fpCull(set.meshes.hair);
      if (g.slv) { set.meshes.slv = fpRange(mk(shareGeo(g.slv), mats.top, 'slv_' + name), false); set.meshes.fps = fpRange(mk(shareGeo(g.fps), mats.top, 'fps_' + name), true); set.meshes.slv.visible = set.meshes.fps.visible = false; } fingerSync(set.meshes.skin); set.mats = mats; return sets[name] = set; }
    /* first person: anything on the head is skipped by a camera that sits inside it (colour and depth writes off for that one draw); every other camera — cut-scenes, mirrors, the
       shadow pass (which uses its own depth material) — still sees the whole man. Decided per draw from the camera that is rendering, so no mode flag can get out of step. */
    const _hc = new T.Vector3(), _cc = new T.Vector3();
    function fpCull(m) { m.userData.fpHead = true; m.onBeforeRender = function (r, sc, cam, geo, mat) { const e = B.head.matrixWorld.elements, ce = cam.matrixWorld.elements; _hc.set(e[12] + e[4] * .1 + e[8] * .02, e[13] + e[5] * .1 + e[9] * .02, e[14] + e[6] * .1 + e[10] * .02); _cc.set(ce[12], ce[13], ce[14]);
        const show = _cc.distanceToSquared(_hc) > H.fpRadius * H.fpRadius; if (mat.colorWrite !== show) { mat.colorWrite = show; mat.depthWrite = show; } H.headShown = show; }; return m; }
    /* sleeves: the loose pair for every outside camera, the slim pair for the camera inside the head (draw range, not visibility: the choice is per draw) */
    function fpRange(m, inFp) { m.onBeforeRender = function (r, sc, cam, geo) { const e = B.head.matrixWorld.elements, ce = cam.matrixWorld.elements; _hc.set(e[12] + e[4] * .1 + e[8] * .02, e[13] + e[5] * .1 + e[9] * .02, e[14] + e[6] * .1 + e[10] * .02); _cc.set(ce[12], ce[13], ce[14]);
        const inside = _cc.distanceToSquared(_hc) <= H.fpRadius * H.fpRadius; geo.setDrawRange(0, inside === inFp ? Infinity : 0); }; return m; }
    /* the index finger follows the other three (whoever curled them last: the pose layer, or the first-person rig in combat.js, which only knows the f* chain); with a gun in the right
       hand it stays straighter, on the trigger. Done at draw time so it lands after every pose pass; the skeleton is re-flattened only when something moved. */
    const TW = [9, 9], THF = FIST.thf;
    function fingerSync(m) { m.onBeforeRender = function () { let ch = false; if (!FPT_SET && GT.combat && GT.combat._fpt) { FPT_SET = true; GT.combat._fpt.az = .34; }   /* aimed hand guns are held a little closer than a locked-out arm: the gun and both hands read larger, the forearms leave by the bottom of the frame */ const cp = GT.combat && GT.combat.player, gun = !!(cp && cp.w && cp.w.def && cp.w.def.kind === 'gun') && B.handR.children.some(o => !o.isBone && o !== props.propR && o.visible);
        for (let k = 0; k < 2; k++) { const L = k ? 'R' : 'L', tr = gun && k === 1; for (let j = 1; j <= 3; j++) { const fb = B['f' + j + L], ib = B['i' + j + L], z = fb.rotation.z * (tr ? (j === 1 ? .3 : j === 2 ? .55 : .5) : FIST.i[j - 1]); if (abs(ib.rotation.z - z) > 1e-4) { ib.rotation.z = z; ch = true; }
          for (const c of 'mq') { const xb = B[c + j + L], zx = fb.rotation.z * FIST[c][j - 1]; if (abs(xb.rotation.z - zx) > 1e-4) { xb.rotation.z = zx; ch = true; } } } }
        for (let k = 0; k < 2; k++) { const L = k ? 'R' : 'L', ck = clamp((abs(B['f1' + L].rotation.z) - .5) / .7, 0, 1); for (let n = 0; n < 4; n++) { const b = B['imfq'[n] + '1' + L], x = FIST.spr[n] * ck; if (abs(b.rotation.x - x) > 1e-4) { b.rotation.x = x; ch = true; } } }   /* a fist brings the fingers together: the mesh's spread (index +.06, ring −.05, little −.13 rad) is turned out at the knuckle */   /* H5: the middle and little fingers follow the shared chain on their own joints */
        /* a closed fist (or a hand round a handle) puts the thumb ACROSS the fingers: the pose layers only know one thumb curl, which leaves it pointing along the index finger */
        for (let k = 0; k < 2; k++) { const L = k ? 'R' : 'L', sg = k ? -1 : 1, t1 = B['t1' + L], t2 = B['t2' + L], fk = (gun ? 0 : 1) * clamp((abs(B['f1' + L].rotation.z) - .9) / .5, 0, 1); if (fk > 0 && abs(t2.rotation.z - TW[k]) > 1e-4) { const D = FIST.thf; t1.rotation.x += D[0] * fk; t1.rotation.y += sg * D[1] * fk; t1.rotation.z += -sg * D[2] * fk; t2.rotation.z += -sg * D[3] * fk; TW[k] = t2.rotation.z; t1.updateMatrixWorld(true); ch = true; } }
        if (ch) { B.handL.updateMatrixWorld(true); B.handR.updateMatrixWorld(true); skeleton.update(); } }; return m; }
    function ensureExtra(kind) { const set = sets[H.outfit]; let key = kind, geo, mat = set.mats.gearH;
      if (kind === 'pack') { key = 'pack_' + set.def.packEase; geo = extraGeo(key, M => addPack(M, set.def.packEase)); mat = matOf('pack', () => mkMat(paintPack())); } else geo = extraGeo(kind, kind === 'helmet' ? addHelmet : kind === 'mask' ? addMask : kind === 'cap' ? addCap : addShades);
      let e = extra[kind]; if (!e || e.key !== key) { if (e) { inner.remove(e.mesh); } e = extra[kind] = { key, mesh: mk(geo, mat, kind) }; if (kind !== 'pack') fpCull(e.mesh); } e.mesh.material = mat; return e.mesh; }
    function refresh() { const set = sets[H.outfit]; if (!set) return; const bare = !!set.def.bare; for (const k of ['helmet', 'pack', 'mask', 'shades', 'cap']) { const on = k === 'pack' ? H.box && !bare : k === 'helmet' ? H.helmet && !bare : k === 'cap' ? H.cap && !(H.helmet && !bare) : H[k]; if (on) ensureExtra(k).visible = true; else if (extra[k]) extra[k].mesh.visible = false; } set.meshes.hair.visible = !H.cap && !(H.helmet && !bare); }   /* bare (H5 default look): the helmet and the delivery box are not drawn */
    H.setOutfit = function (name) { name = OUTFITS[who][name] ? name : (ALIAS[who][name] || H.outfit || H.outfits[0]); if (name === H.outfit) return H; if (H.outfit && sets[H.outfit]) for (const k in sets[H.outfit].meshes) sets[H.outfit].meshes[k].visible = false;
      const set = ensureSet(name); for (const k in set.meshes) set.meshes[k].visible = true; H.outfit = name; refresh(); return H; };
    H.setHelmet = b => { H.helmet = !!b; refresh(); return H; }; H.setBox = b => { H.box = !!b; refresh(); return H; }; H.setMask = b => { H.mask = !!b; refresh(); return H; }; H.setShades = b => { H.shades = !!b; refresh(); return H; }; H.setCap = b => { H.cap = !!b; refresh(); return H; };
    H.attach = (o, bone) => { const b = H.bones[bone] || B[bone] || B.handR; b.add(o); return o; }; H.detach = o => { if (o && o.parent) o.parent.remove(o); return o; };
    /** H5: two-bone reach after the pose pass — wrist (hand bone) to a WORLD point, the elbow poled along (x, y, z) in figure space (x mirrored for the right arm, as pole()),
        and optionally the hand turned to a WORLD quaternion. Used by js/onfoot.js to keep the hands on the scooter grips as the bars turn. k: 0 left, 1 right. */
    const RQ = { g: new T.Quaternion(), c: new T.Quaternion(), a: new T.Quaternion(), f: new T.Quaternion(), i: new T.Quaternion(), m: new T.Matrix4(), s: new T.Vector3(), t: new T.Vector3(), p: new T.Vector3() };
    H.reach = function (k, tw, px, py, pz, hq) { const L = k ? 'R' : 'L', sg = k ? -1 : 1, arm = B['arm' + L], fore = B['fore' + L], hand = B['hand' + L], cl = B['clav' + L];
      group.updateMatrixWorld(true); RQ.m.copy(inner.matrixWorld).invert(); inner.getWorldQuaternion(RQ.g);
      RQ.s.setFromMatrixPosition(arm.matrixWorld).applyMatrix4(RQ.m); RQ.t.copy(tw).applyMatrix4(RQ.m); RQ.p.set(sg * px, py, pz);
      cl.getWorldQuaternion(RQ.c); RQ.c.premultiply(RQ.i.copy(RQ.g).invert());
      ik2(RQ.s, RQ.t, RQ.p, L_ARM, L_FORE, 1, RQ.a, RQ.f); arm.quaternion.copy(RQ.i.copy(RQ.c).invert()).multiply(RQ.a); fore.quaternion.copy(RQ.i.copy(RQ.a).invert()).multiply(RQ.f);
      if (hq) hand.quaternion.copy(RQ.i.copy(RQ.g).multiply(RQ.f).invert()).multiply(hq); arm.updateMatrixWorld(true); return H; };
    H.world = (bone, out) => { const b = H.bones[bone] || B[bone]; out = out || new T.Vector3(); if (!b) return out.setFromMatrixPosition(group.matrixWorld); b.updateWorldMatrix(true, false); return out.setFromMatrixPosition(b.matrixWorld); };
    H.stats = () => { let tris = 0, draws = 0; inner.traverse(o => { if (o.isMesh && o.visible && (!o.parent || o.parent.visible !== false)) { let p = o, vis = true; while (p && p !== inner) { if (!p.visible) vis = false; p = p.parent; } if (vis) { draws++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } } }); return { tris, draws }; };

    /* ---------------- animation ---------------- */
    const PA = new Float32Array(NCH), PB = new Float32Array(NCH), PO = new Float32Array(NCH), SNAP = new Float32Array(NCH), seed = (SEED++) * 1.7 + (who === 'lie' ? 2.3 : 0);
    const c = { time: seed * 3, seed, phase: seed % 1, stride: 1, pedal: 0, state: null, prev: null, prevLive: false, prevT: 0, k: 1, dur: .22, t: 0, ti: 0, turn: 0, dt: 0, frame: 0, acc: 0, lv: null, blink: 1 + seed % 3, tf: { d: [0, 0], step: -1, u: 0, from: 0, last: 1, f: -1 } };
    const spd = (st, s) => { const v = s.speed; return v === undefined || v === null ? (DEFSPEED[st] || 0) : abs(v); };
    function evalState(st, P, s, t) { neutral(P); c.t = t; (POSE[st] || POSE.idle)(P, c, s, spd(st, s)); }
    const qH = new T.Quaternion(), qS = new T.Quaternion(), qC = new T.Quaternion(), qCl = new T.Quaternion(), qA = new T.Quaternion(), qF = new T.Quaternion(), qT = new T.Quaternion(), qSh = new T.Quaternion(), qFt = new T.Quaternion(), qi = new T.Quaternion(), gq = new T.Quaternion(), e = new T.Euler(), m4 = new T.Matrix4();
    const pH = new T.Vector3(), pS = new T.Vector3(), pC = new T.Vector3(), pCl = new T.Vector3(), pSh = new T.Vector3(), tg = new T.Vector3(), tR = new T.Vector3(), pv = new T.Vector3(), pl = new T.Vector3(), dn = new T.Vector3(), El = new T.Vector3(), va = new T.Vector3(), vb = new T.Vector3(), X = new T.Vector3(), Y = new T.Vector3(), Z = new T.Vector3(), wp = new T.Vector3(), vel = new T.Vector3(), acc = new T.Vector3();
    const sp = { init: false, p: new T.Vector3(), v: new T.Vector3(), x: [0, 0, 0], d: [0, 0, 0] };
    const basis = (q, Xv, Yv) => { Z.crossVectors(Xv, Yv); m4.makeBasis(Xv, Yv, Z); q.setFromRotationMatrix(m4); };
    function ik2(S, target, poleV, l1, l2, sign, qUp, qLo) { dn.copy(target).sub(S); const dist = dn.length() || 1e-5; dn.multiplyScalar(1 / dist); const dd = clamp(dist, abs(l1 - l2) + .02, (l1 + l2) * .999), x = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = sqrt(max(0, l1 * l1 - x * x));
      pl.copy(poleV).addScaledVector(dn, -poleV.dot(dn)); if (pl.lengthSq() < 1e-6) { pl.set(0, 0, 1); if (abs(dn.z) > .9) pl.set(0, 1, 0); pl.addScaledVector(dn, -pl.dot(dn)); } pl.normalize();
      El.copy(S).addScaledVector(dn, x).addScaledVector(pl, h); va.copy(El).sub(S).normalize(); vb.copy(S).addScaledVector(dn, dd).sub(El).normalize();
      if (sign > 0) X.crossVectors(dn, pl); else X.crossVectors(pl, dn); X.normalize(); Y.copy(va).negate(); basis(qUp, X, Y); Y.copy(vb).negate(); basis(qLo, X, Y); }
    function applyPose(P, s, dt) { let ly = s.lookYaw || 0, lp = s.lookPitch || 0;
      if (s.lookAt && s.lookAt.isVector3) { group.updateWorldMatrix(true, false); tg.copy(s.lookAt); group.worldToLocal(tg); ly = clamp(atan2(tg.x, tg.z), -1.2, 1.2); lp = clamp(-atan2(tg.y - 1.62, Math.hypot(tg.x, tg.z)), -.6, .6); }
      ly = clamp(ly, -1.4, 1.4); lp = clamp(lp, -.8, .8);
      B.hips.position.set(P[C_HP], HIPY0 + P[C_HP + 1], P[C_HP + 2]); B.hips.quaternion.setFromEuler(e.set(P[C_HR], P[C_HR + 1], P[C_HR + 2], 'YXZ')); qH.copy(B.hips.quaternion); pH.copy(B.hips.position);
      B.spine.quaternion.setFromEuler(e.set(P[C_SP], P[C_SP + 1] + ly * .08, P[C_SP + 2], 'YXZ')); B.chest.quaternion.setFromEuler(e.set(P[C_CH] + lp * .08, P[C_CH + 1] + ly * .12, P[C_CH + 2], 'YXZ'));
      B.neck.quaternion.setFromEuler(e.set(P[C_NK] + lp * .35, P[C_NK + 1] + ly * .3, P[C_NK + 2], 'YXZ')); B.head.quaternion.setFromEuler(e.set(P[C_HD] + lp * .5, P[C_HD + 1] + ly * .5, P[C_HD + 2], 'YXZ'));
      pS.copy(B.spine.position).applyQuaternion(qH).add(pH); qS.multiplyQuaternions(qH, B.spine.quaternion); pC.copy(B.chest.position).applyQuaternion(qS).add(pS); qC.multiplyQuaternions(qS, B.chest.quaternion);
      for (let k = 0; k < 2; k++) { const sg = k ? -1 : 1, L = k ? 'R' : 'L', a = C_ARM + k * 15, l = C_LEG + k * 8, cl = B['clav' + L], arm = B['arm' + L], fore = B['fore' + L];
        cl.quaternion.setFromEuler(e.set(0, -sg * P[C_CL + k * 2 + 1], sg * P[C_CL + k * 2], 'YXZ')); qCl.multiplyQuaternions(qC, cl.quaternion); pCl.copy(cl.position).applyQuaternion(qC).add(pC); pSh.copy(arm.position).applyQuaternion(qCl).add(pCl);
        tg.set(sg * P[a], P[a + 1], P[a + 2]).applyQuaternion(qC).add(pSh); tR.set(sg * P[a + 3], P[a + 4], P[a + 5]); tg.lerp(tR, clamp(P[a + 6], 0, 1)); pv.set(sg * P[a + 7], P[a + 8], P[a + 9]).applyQuaternion(qC);
        ik2(pSh, tg, pv, L_ARM, L_FORE, 1, qA, qF); arm.quaternion.copy(qi.copy(qCl).invert()).multiply(qA); fore.quaternion.copy(qi.copy(qA).invert()).multiply(qF);
        B['hand' + L].quaternion.setFromEuler(e.set(P[a + 10], sg * P[a + 11], sg * P[a + 12], 'YXZ')); const cu = clamp(P[a + 13], -.1, 1.15), th = clamp(P[a + 14], 0, 1);
        B['f1' + L].rotation.z = -sg * cu * 1.15; B['f2' + L].rotation.z = -sg * cu * 1.3; B['f3' + L].rotation.z = -sg * cu * .85; B['i1' + L].rotation.z = -sg * cu * 1.15; B['i2' + L].rotation.z = -sg * cu * 1.3; B['i3' + L].rotation.z = -sg * cu * .85; B['t1' + L].rotation.set(th * .35, 0, -sg * (.12 + th * .6)); B['t2' + L].rotation.z = -sg * th * .7;
        const th_ = B['thigh' + L], shin = B['shin' + L]; pSh.copy(th_.position).applyQuaternion(qH).add(pH); tg.set(sg * P[l], P[l + 1], P[l + 2]); const yk = sg * (P[l + 4] * .6 + P[l + 7]) + P[C_HR + 1] * .5; pv.set(sin(yk), .2, cos(yk));
        ik2(pSh, tg, pv, L_TH, L_SH, -1, qT, qSh); th_.quaternion.copy(qi.copy(qH).invert()).multiply(qT); shin.quaternion.copy(qi.copy(qT).invert()).multiply(qSh);
        qFt.setFromEuler(e.set(-P[l + 3], sg * P[l + 4], sg * P[l + 5], 'YXZ')); B['foot' + L].quaternion.copy(qi.copy(qSh).invert()).multiply(qFt); B['toe' + L].rotation.x = -clamp(P[l + 6], 0, 1.2); }
      { const pb = props._built, a1 = P[C_X] > .5, a2 = P[C_X + 1] > .5; if (a1 || pb.phone) props.phone.visible = a1; if (a2 || pb.bowl) { props.bowl.visible = a2; props.sticks.visible = a2; } }
      /* secondary motion: the box, its straps and the hair lag behind the chest */
      if (dt > 1e-4) { wp.copy(pC).multiplyScalar(SC).applyMatrix4(group.matrixWorld); if (sp.init) { vel.copy(wp).sub(sp.p).multiplyScalar(1 / dt); acc.copy(vel).sub(sp.v).multiplyScalar(1 / dt); if (acc.lengthSq() > 2500) acc.setLength(50); group.getWorldQuaternion(gq); acc.applyQuaternion(gq.invert()); sp.v.copy(vel); } else acc.set(0, 0, 0); sp.p.copy(wp); sp.init = true;
        const tx = clamp(-acc.z * .0045, -.15, .15) + P[C_HR] * -.08, tz = clamp(acc.x * .0045, -.15, .15) - P[C_HR + 2] * .5, ty = clamp(-acc.y * .0012, -.022, .022), T3 = [tx, tz, ty], n = dt > .02 ? 2 : 1, h = dt / n;
        for (let q = 0; q < n; q++) for (let i = 0; i < 3; i++) { sp.d[i] += ((T3[i] - sp.x[i]) * 150 - sp.d[i] * 11) * h; sp.x[i] += sp.d[i] * h; } }
      if (B.lid) { c.blink -= dt; if (c.blink < -.15) c.blink = 2.2 + 3.5 * hsh(c.frame, 7, 3); const bl = s.eyesClosed ? 1 : c.blink < 0 ? sin(PI * clamp(-c.blink / .15, 0, 1)) : 0; B.lid.rotation.x = -.85 * (1 - bl) + .12 * clamp(lp, -.5, .8) * (1 - bl); }
      B.pack.rotation.set(sp.x[0], 0, sp.x[1]); B.pack.position.y = sp.x[2]; B.hair.rotation.set(sp.x[0] * 1.5, 0, sp.x[1] * 1.5); }
    H.update = function (dt, s) { heroRim(); s = s || {}; dt = min(.1, max(0, dt || 0)); let st = s.state || 'idle'; if (!POSE[st]) st = SALIAS[st] || 'idle';
      c.time += dt; c.dt = dt; c.frame++; c.turn = s.turn || 0; const v = spd(st, s); if (c.lv === null) c.lv = v; if (dt > 1e-5) c.acc += (clamp((v - c.lv) / dt, -14, 14) - c.acc) * min(1, dt * 7); c.lv = v; c.stride = strideLen(v) * (st === 'crouch' || st === 'crouch_walk' ? .7 : 1); c.phase = (c.phase + (s.back ? -1 : 1) * dt * v / c.stride + 1) % 1; c.pedal = (c.pedal + dt * v / 5.2) % 1;
      if (st !== c.state) { if (c.state !== null) { if (c.k >= 1) { c.prev = c.state; c.prevLive = true; c.prevT = c.t; c.prevS = Object.assign({}, c.ls); } else { SNAP.set(PO); c.prevLive = false; } c.k = 0; c.dur = BLEND[st] || .22; } c.state = st; c.ti = 0; }
      c.ti += dt; const t = typeof s.t === 'number' && isFinite(s.t) ? s.t : c.ti; evalState(st, PA, s, t);
      if (c.k < 1) { c.k = min(1, c.k + dt / c.dur); const k = c.k * c.k * (3 - 2 * c.k); let F = SNAP; if (c.prevLive) { c.prevT += dt; evalState(c.prev, PB, c.prevS || s, c.prevT); c.t = t; F = PB; } for (let i = 0; i < NCH; i++) PO[i] = F[i] + (PA[i] - F[i]) * k; } else PO.set(PA);
      { const al = clamp(c.acc * .016, -.13, .13) * (st === 'ride' || st === 'sit' || st === 'drive' ? 0 : 1); PO[C_HR] += al * .5; PO[C_SP] += al * .3; PO[C_CH] += al * .25; PO[C_HD] -= al * .45; }
      c.ls = Object.assign(c.ls || {}, s); applyPose(PO, s, dt); H.state = st; return H; };
    H.setOutfit(opts.outfit || H.outfits[0]); if (opts.helmet) H.setHelmet(true); if (opts.box) H.setBox(true); if (opts.mask) H.setMask(true); if (opts.shades) H.setShades(true);
    /* MD (2026-11-17): the lead's Rocketbox model (GT.humans.mdl 'kai': grey tee, dark jeans, white trainers) is what every outside camera sees while he wears the default look;
       this rig keeps posing (all the states, the IK, combat.js and onfoot.js on top) and the model follows it. The lofted body is still what the first-person camera sees
       (its slim sleeves and the hands the gun and fist poses were made for) — decided per draw by whether the camera sits inside the head, as fpCull does — and it is the
       whole figure again in any other outfit, with the mask on, or when the model is missing (?mdl=0, a failed load). */
    const MH = GT.humans && GT.humans.mdl; H.mdl = null;
    const inHead = cam => { const e = B.head.matrixWorld.elements, ce = cam.matrixWorld.elements; _hc.set(e[12] + e[4] * .1 + e[8] * .02, e[13] + e[5] * .1 + e[9] * .02, e[14] + e[6] * .1 + e[10] * .02); _cc.set(ce[12], ce[13], ce[14]); return _cc.distanceToSquared(_hc) <= H.fpRadius * H.fpRadius; };
    /* pt1: the model is the man in every outfit now — js/shops.js describes the look (H.dress) and GT.humans.mdl.dress paints / layers it on the model; the lofted figure is only the first-person body */
    const mdlOn = () => !!H.mdl; H.mdlOn = mdlOn; H.look = null; H.lookOn = false;
    H.dress = look => { H.look = look || null; H.lookOn = false; if (H.mdl && MH && MH.dress && H.look) H.lookOn = !!MH.dress(H.mdl, H.look); return H.lookOn; };
    function mdlWrap(m) { if (m.userData.mdw) return; m.userData.mdw = true; const prev = m.onBeforeRender;
      m.onBeforeRender = function (r, sc, cam, geo, mat, grp) { if (prev) prev.call(this, r, sc, cam, geo, mat, grp); if (!mat) return; let show = true; if (mdlOn() && !inHead(cam)) show = false; else if (m.userData.fpHead) return; if (mat.colorWrite !== show) { mat.colorWrite = show; mat.depthWrite = show; } }; }
    function mdlTick() { if (!MH || MH.off || who !== 'kai') return; if (!H.mdl) { if (!MH.ready('kai')) { MH.load('kai'); return; } H.mdl = MH.attach('kai', inner, B, { hide: inHead }); if (!H.mdl) return; }
      if (H.look && !H.lookOn && MH.dress) H.lookOn = !!MH.dress(H.mdl, H.look);   /* the atlas may still be loading: try each frame until it takes */
      const on = mdlOn(); H.mdl.root.visible = on; for (const m of inner.children) if (m.isMesh && m !== H.mdl.mesh) { mdlWrap(m); m.castShadow = !on; } }
    const upd0 = H.update; H.update = function (dt, s) { upd0(dt, s); try { mdlTick(); } catch (e) { if (!H.mdlErr) { H.mdlErr = 1; console.warn('[hero] model', e); } } return H; };
    H.update(0, { state: 'idle' }); return H; }

  /** build geometry + textures of every outfit of `who` ahead of time (avoids a hitch at the wardrobe mirror) */
  const preload = (who, o) => { const names = Object.keys(OUTFITS[who] || {}), one = n => { outfitGeo(who, n); OUTFITS[who][n].tex(); }; if (!names.length) return; const first = o && OUTFITS[who][o.outfit] ? o.outfit : names[0]; one(first); paintSkin(who); paintHair(who);
    const rest = names.filter(n => n !== first); if (o && o.all) rest.forEach(one); else { const step = () => { const n = rest.shift(); if (!n) return; try { one(n); } catch (e) { /* built on demand instead */ } if (rest.length) setTimeout(step, 60); }; if (rest.length) setTimeout(step, 400); } };
  GT.hero = { _fist: FIST, _ride: RIDE, make, preload, times: TIMES, states: STATES, outfits: { kai: Object.keys(OUTFITS.kai), lie: Object.keys(OUTFITS.lie) }, _Atlas: Atlas, _p: { field, fs, fsb, fb, vn, hsh, keyed, Atlas, sm, G, tri, spow, lerp, clamp, lin, rgb, css } };
  /* builders shared with js/people.js (street NPCs are built from the same lofts, skeleton and gait). setShape(null) restores the hero's own tables. */
  GT.hero._b = { drape, dUu, hipNeed, Mesher, tube, strip, ellip, boxPart, torsoTube, armTube, legTube, tuck, pelvis, legs, kneeFold, elbowFold, foldN, foldV, lin_, ysT, surfZ, headRaw, headPt, faceD, HEAD2, HEAD_YS, uwFace, addHead, addHand, addShoe, Atlas, cloth, mkMat, tint, reflective, FH, FV, FD, CJK,
    field, fs, fb, hsh, keyed, loco, idleBase, turnFeet, footFlat, neutral, strideLen, BDEF, BI, armXf, mirXf, wTorso, wArm, wLeg, wPelvis, wOne, wHead, HV, HVI, EYE, eyeTop, eyeBot, HTOP, TV,
    R: { HEAD: R_HEAD, ARM: R_ARM, HAND: R_HAND, EYE: R_EYE, EAR: R_EAR, CON: R_CON, LID: R_LID }, K: { A_POSE, L_ARM, L_FORE, L_TH, L_SH, ANK, HIPX, HIPY0, SHO, WRIST, LMAX, HEEL, BALL }, C: { HP: C_HP, HR: C_HR, SP: C_SP, CH: C_CH, NK: C_NK, HD: C_HD, CL: C_CL, ARM: C_ARM, LEG: C_LEG, X: C_X, N: NCH },
    setShape(s) { SHP = s || null; } };
  /* a cut registered from outside (js/shops.js: the tailor's suit). mk(defs, tools) -> { build(M), tex(), packEase }. Non-enumerable, so hero.outfits, wardrobes that cycle through it and preload() never list it. */
  GT.hero.addOutfit = (who, name, mk) => { const O = OUTFITS[who]; if (!O || typeof mk !== 'function') return false; if (!O[name]) Object.defineProperty(O, name, { value: mk(O, { addHair, BODY: y => BODY(y) }), enumerable: false }); return true; };

  /* ================================================================== showcases */
  const QS = () => new URLSearchParams(location.search);
  function stage(scene, o) { o = o || {}; const k = GT.kit(), cx = o.cx || 0, cz = o.cz || 0; k.box('asphalt_worn', 30, .3, 24, cx, -.15, cz); k.box('concrete_stained', 30, .16, 2.4, cx, .0, cz + 4.4, { bevel: .02 });
    if (o.wall !== false) { k.box('brick_painted', 30, 3.4, .3, cx, 1.7, cz + 5.7, { bevel: .01 }); k.box('concrete', 30, .22, .5, cx, .11, cz + 5.45, { bevel: .02 }); }
    if (o.lines) for (let i = -8; i < 9; i++) k.box('road_paint_white', .12, .012, .5, cx + o.lines, .002, cz + i * 1.0, { bevel: 0 });
    k.decal('oil_stain', 2.2, 2.2, cx + 1.6, .012, cz - .8, .4); k.decal('crack', 3, 1.3, cx + 4, .012, cz + 1.4, 1.1); k.decal('gum_spots', 2, 2, cx - 1, .012, cz + 1, .2); scene.add(k.build()); }
  const flags = (h, q, d) => { d = d || {}; const f = n => q.get(n) !== null ? q.get(n) === '1' : !!d[n]; h.setHelmet(f('helmet')); h.setBox(f('box')); h.setMask(f('mask')); h.setShades(f('shades')); h.setCap(f('cap')); return h; };
  const SAMPLE = { walk: [1.5, 0], run: [3.8, 0], sprint: [6.4, 0], crouch_walk: [1.1, 0], carry: [3.2, 0], fall: [0, .95], dive: [0, .4], punch: [0, .17], hit: [0, .12], enter_car: [0, .42], exit_car: [0, .4], use: [0, .5], jumpshot: [0, .5], ride: [4, 0], getup: [0, .8], mount: [0, .4], dismount: [0, .4] };
  function presim(h, s, at) { const o = Object.assign({}, s); for (let t = 0; t < at; t += 1 / 60) { if (o.t !== undefined) o.t = t; h.update(1 / 60, o); } }
  GT.showcase.hero = ({ scene }) => { const q = QS(), hs = [], st = q.get('state') || 'idle', one = q.get('o'); stage(scene, { cx: 2.4 });
    const list = [['kai', 'rider', {}], ['kai', 'rider', { helmet: 1, box: 1 }], ['kai', 'plain', {}], ['kai', 'jacket', { shades: 1 }], ['lie', 'kitchen', {}], ['lie', 'hoodie', { mask: 1 }]].filter(d => !one || d[1] === one);
    list.forEach((d, i) => { const h = make(d[0], { outfit: d[1] }); flags(h, q, d[2]); h.group.position.set(i * .98, 0, 0); h.group.rotation.y = +q.get('rot') || 0; scene.add(h.group); const s = { state: st, speed: q.get('speed') !== null ? +q.get('speed') : (SAMPLE[st] || [0])[0] }; presim(h, s, .5 + i * .37); hs.push([h, s]); });
    GT.showcase._heroes = hs.map(x => x[0]); const play = q.get('play') === '1';
    return { cam: [-1.0, 1.72, -2.35], look: [.6, 1.1, 0], hours: 18.2, update(dt) { for (const x of hs) x[0].update(play ? dt : 0, x[1]); } }; };
  GT.showcase.hero_walk = ({ scene }) => { const q = QS(), st = q.get('state') || 'walk', sm_ = SAMPLE[st] || [0, 0], speed = q.get('speed') !== null ? +q.get('speed') : sm_[0], at = q.get('at') !== null ? +q.get('at') : 1.2, n = +q.get('n') || 6, hs = [], who = q.get('who') || 'kai'; stage(scene, { cz: 3, lines: .9, wall: q.get('wall') === '1' });
    const sts = q.get('states') ? q.get('states').split(',') : null;
    for (let i = 0; i < n; i++) { const h = make(who, { outfit: q.get('o') || undefined }); flags(h, q); h.group.position.set(0, 0, i * 1.35); scene.add(h.group); const tok = sts ? sts[i % sts.length].split(':') : [st], sx = sts ? (SAMPLE[tok[0]] || [0, 0]) : sm_, fl = tok[1] || '', s = { state: tok[0], speed: sts ? sx[0] : speed, turn: +q.get('turn') || 0, heavy: q.get('heavy') === '1' || fl === 'heavy', pedal: q.get('pedal') === '1' || fl === 'pedal', seated: q.get('seated') === '1' || fl === 'seated' }; if (sx[1] || q.get('tl') === '1') s.t = 0; if (sts && sx[1]) { presim(h, s, sx[1]); s.t = sx[1]; hs.push([h, s]); continue; } presim(h, s, at + i * (+q.get('step') || .09)); if (s.t !== undefined) s.t = at + i * (+q.get('step') || .09); hs.push([h, s]); }
    const play = q.get('play') === '1'; return { cam: [-4.6, 1.25, (n - 1) * .675], look: [0, .92, (n - 1) * .675], hours: 18.2, update(dt) { for (const x of hs) x[0].update(play ? dt : 0, x[1]); } }; };
  GT.showcase.hero_states = ({ scene }) => { const q = QS(), page = +q.get('page') || 0, per = 14, list = STATES.slice(page * per, page * per + per), hs = [], k = GT.kit(); stage(scene, { cx: 3.6, cz: -3, wall: false }); k.box('concrete', 9.6, .8, 1.5, 3.6, .4, -1.9, { bevel: .02 }); scene.add(k.build());
    list.forEach((st, i) => { const row = (i / 7) | 0, col = i % 7, who = (i + page) % 3 === 2 ? 'lie' : 'kai', outs = GT.hero.outfits[who], h = make(who, { outfit: outs[(i + row) % outs.length] }); if (st === 'ride' || i % 5 === 1) h.setHelmet(who === 'kai'); if (i % 4 === 2) h.setBox(true);
      h.group.position.set(col * 1.22, row ? .8 : 0, row ? -1.9 : 0); h.group.rotation.y = +q.get('rot') || .45; scene.add(h.group); const sp_ = SAMPLE[st] || [0, 0], s = { state: st, speed: sp_[0], heavy: i % 2 === 0 }; if (sp_[1]) s.t = 0; presim(h, s, sp_[1] || 1.3 + i * .21); if (sp_[1]) s.t = sp_[1]; hs.push([h, s]);
      const tx = GT.signTex(st, { w: 256, h: 64, bg: '#16171a', color: '#e8e2d0' }), lab = new T.Mesh(new T.PlaneGeometry(.6, .15), new T.MeshBasicMaterial({ map: tx })); lab.position.set(col * 1.22, row ? .62 : .09, row ? -1.14 : .75); lab.rotation.x = row ? 0 : -.9; scene.add(lab); });
    return { cam: [3.66, 2.3, 6.3], look: [3.66, .95, -.6], hours: 18.2, update(dt) { for (const x of hs) x[0].update(0, x[1]); } }; };
  GT.showcase.hero_close = ({ scene }) => { const q = QS(), who = q.get('who') || 'kai', st = q.get('state') || 'idle', t0 = performance.now(), h = make(who, { outfit: q.get('o') || undefined }), t1 = performance.now(), v = q.get('v') || 'rear', s = { state: st, speed: (SAMPLE[st] || [0])[0] }; stage(scene, {}); flags(h, q); scene.add(h.group); presim(h, s, +q.get('at') || .8);
    const V = { rear: [[-.62, 1.52, -1.03], [.02, 1.33, 0]], profile: [[-1.25, 1.5, .1], [0, 1.4, .04]], front: [[.45, 1.6, 1.15], [0, 1.42, 0]], back: [[0, 1.45, -1.3], [0, 1.3, 0]], legs: [[-.9, .7, -1.1], [0, .45, 0]], game: [[-.75, 1.75, -2.35], [.1, 1.15, 0]] }[v] || [[-.62, 1.52, -1.03], [.02, 1.33, 0]];
    if (q.get('stats') === '1') { const d = document.createElement('div'), x = h.stats(); d.style.cssText = 'position:fixed;left:10px;bottom:10px;color:#fff;font:14px monospace;z-index:9;background:rgba(0,0,0,.5);padding:4px 8px'; d.textContent = who + '/' + h.outfit + '  tris ' + Math.round(x.tris) + '  draws ' + x.draws + '  build ' + Math.round(t1 - t0) + ' ms'; document.body.appendChild(d);
      if (q.get('test') === '1') { const th = make(who), prev = {}, names = ['handL', 'handR', 'footL', 'footR', 'head']; let worst = 0, wn = '', nan = 0, worstB = 0, wb = '', last = '';
        for (const stt of STATES.concat(STATES.slice().reverse(), ['idle', 'run', 'idle', 'ride', 'walk', 'punch', 'hit', 'fall', 'idle'])) { for (let f = 0; f < 40; f++) { th.update(1 / 60, { state: stt, speed: (SAMPLE[stt] || [0])[0] }); th.group.updateMatrixWorld(true); for (const n of names) { const p = th.world(n); if (!isFinite(p.x + p.y + p.z)) nan++; if (prev[n]) { const dd = p.distanceTo(prev[n]); if (dd > worst) { worst = dd; wn = last + '>' + stt + ':' + n + ':' + f; } if (f < 14 && dd > worstB) { worstB = dd; wb = last + '>' + stt + ':' + n + ':' + f; } } prev[n] = p.clone(); } } last = stt; }
        d.textContent += '  | NaN ' + nan + '  max step ' + worst.toFixed(3) + ' m/frame (' + wn + ')  max in-blend ' + worstB.toFixed(3) + ' (' + wb + ')'; } }
    GT.showcase._heroes = [h]; return { cam: V[0], look: V[1], hours: 18.2, update(dt) { h.update(q.get('play') === '1' ? dt : 0, s); } }; };
  /** hero2 — the review harness. One figure or a strip of phases, any state, any camera.
       who=kai|lie  o=<outfit>  helmet= box= mask= shades=  state=<state>  speed=  turn=  at=<s into the state>  play=1
       view=game (behind the right shoulder, 2.6 m) | front | head | face | hands | side | rear | legs | turn (4-up turnaround)
       n=<copies> step=<s between copies> sv=side|rear|front|q  -> a strip of n phases instead of one figure
       veh=escooter|sharebike (needs cnvehicles in only=)  swing=0..1  steer=  heavy=1  stats=1 */
  GT.showcase.hero2 = ({ scene }) => { const q = QS(), who = q.get('who') || 'kai', st = q.get('state') || 'idle', view = q.get('view') || 'game', n = view === 'turn' ? 4 : (+q.get('n') || 1), step = +q.get('step') || .1, sv = q.get('sv') || 'side', at = q.get('at') !== null ? +q.get('at') : .8, hs = [], along = sv === 'side' && view !== 'turn' ? 'z' : 'x', gap = +q.get('gap') || (q.get('veh') ? 2.1 : sv === 'side' ? 1.3 : 1.0);
    stage(scene, { cz: 2, wall: q.get('wall') === '1', lines: sv === 'side' && n > 1 ? .9 : 0 }); const t0 = now(); let t1 = t0;
    for (let i = 0; i < n; i++) { const h = make(who, { outfit: q.get('o') || undefined }); if (i === 0) t1 = now(); flags(h, q); const d = SAMPLE[st] || [0, 0], s = { state: st, speed: q.get('speed') !== null ? +q.get('speed') : d[0], turn: +q.get('turn') || 0, heavy: q.get('heavy') === '1', steer: +q.get('steer') || 0, lean: +q.get('lean') || 0, swing: +q.get('swing') || 0, mountSide: 1 };
      const ti = at + (view === 'turn' ? 0 : i * step), timed = q.get('tl') === '1' || !!d[1] || ['getup', 'mount', 'dismount', 'turn_l', 'turn_r', 'stop', 'start'].includes(st); let root = h.group;
      if (q.get('veh') && GT.cnvehicles) { const car = GT.cnvehicles.make(q.get('veh'), { parked: false }), sp = car.seat.position; if (car.setStand) car.setStand(false); h.group.position.set(sp.x, sp.y - (q.get('veh') === 'sharebike' ? .9 : .74), sp.z + .02); car.seat.parent.add(h.group); if (q.get('lean') && car.lean) car.lean(+q.get('lean')); if (q.get('steer')) car.steer.forEach(p => p.rotation.y = +q.get('steer') * .5); root = car.group; s.pedal = q.get('veh') === 'sharebike'; }
      root.position[along] = i * gap; if (view === 'turn') root.rotation.y = (q.get('rots') ? q.get('rots').split(',').map(Number) : [0, 135, 180, -90])[i] * DEG; else if (q.get('rot')) root.rotation.y = +q.get('rot'); scene.add(root);
      if (q.get('from')) presim(h, { state: q.get('from'), speed: (SAMPLE[q.get('from')] || [0])[0] }, .6);
      if (timed) { s.t = 0; for (let t = 0; t < ti; t += 1 / 60) { s.t = t; h.update(1 / 60, s); } s.t = ti; } else presim(h, s, ti); hs.push([h, s]); }
    const c = (n - 1) * gap / 2, V = n > 1 ? ({ side: [[-5.2, 1.15, c], [0, .9, c]], rear: [[c + .3, 1.5, -5.4], [c, .95, 0]], front: [[c - .3, 1.4, 5.4], [c, .95, 0]], q: [[c + 2.2, 1.9, -5.0], [c, .9, 0]] }[sv])
      : ({ game: [[-.62, 1.72, -2.52], [.12, 1.2, 0]], front: [[.35, 1.45, 2.3], [0, 1.12, 0]], head: [[.2, 1.69, .62], [0, 1.655, 0]], face: [[.02, 1.675, .42], [0, 1.662, 0]], head34: [[-.42, 1.7, .5], [0, 1.66, 0]], headside: [[-.7, 1.68, .05], [0, 1.66, .02]], headrear: [[.3, 1.74, -.6], [0, 1.66, 0]], hands: [[-.62, 1.0, .5], [-.2, .9, .02]], side: [[-3.2, 1.1, 0], [0, .95, 0]], rear: [[-.8, 1.3, -2.0], [0, .98, 0]], legs: [[-.9, .6, -1.3], [0, .42, 0]], feet: [[-.7, .3, .5], [0, .1, .02]] }[view] || [[-.62, 1.72, -2.52], [.12, 1.2, 0]]);
    if (q.get('stats') === '1') { const d = document.createElement('div'), x = hs[0][0].stats(); d.style.cssText = 'position:fixed;left:10px;bottom:10px;right:10px;color:#fff;font:12px monospace;z-index:9;background:rgba(0,0,0,.6);padding:4px 8px;white-space:pre-wrap'; d.textContent = who + '/' + hs[0][0].outfit + '  tris ' + Math.round(x.tris) + '  draws ' + x.draws + '  make ' + Math.round(t1 - t0) + ' ms\n' + Object.keys(TIMES).map(k => k + ' ' + TIMES[k]).join(' | '); document.body.appendChild(d); }
    GT.showcase._heroes = hs.map(x => x[0]); const play = q.get('play') === '1'; return { cam: V[0], look: V[1], hours: 18.2, update(dt) { for (const x of hs) x[0].update(play ? dt : 0, x[1]); } }; };
})();
