/* people.js — human figures for SUNSET HEAT. Round 2: built to hold up at 2.5–4 m in third person, plus a living neighbourhood.
   GT.people.make(kind, opts) -> { group, kind, update(dt, s), ... }      kinds: partner, clerk, cop, ped (opts.type = archetype), driver
   GT.people.populate(scene, opts) -> { list, update(dt, playerPos, events), ... }   ~36 NPCs in clusters, LOD, reactions, barks
   Every figure is ONE skeleton (23 bones) driving 2–3 skinned meshes (cloth / skin / optional print) built from lofted
   cross-sections. Geometry is cached per spec, materials are shared by every figure. All animation is procedural. */
(function () {
  'use strict';
  const T = THREE, GT = window.GT; if (!T || !GT) return;
  if (!GT.humans) { try { const x = new XMLHttpRequest(); x.open('GET', 'js/humans.js?v=' + Date.now(), false); x.send(); if (x.status === 200) (0, eval)(x.responseText); } catch (e) { console.warn('[people] humans.js', e); } }   /* PP: pages that do not list js/humans.js (the showcases) load it here, before any figure is built */
  const PI = Math.PI, TAU = PI * 2, sin = Math.sin, cos = Math.cos, abs = Math.abs;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
  const sm = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const G = (x, s) => Math.exp(-(x * x) / (s * s));
  const lin = hex => { const c = new T.Color(hex).convertSRGBToLinear(); return [c.r, c.g, c.b]; };
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  /* ------------------------------------------------------------------ bones */
  const BN = ['hips', 'spine', 'chest', 'neck', 'head', 'clavL', 'armL', 'foreL', 'handL', 'clavR', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'propL', 'propR', 'propR2', 'aux'];
  const PAR = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 2, 9, 10, 11, 0, 13, 14, 0, 16, 17, 8, 12, 12, -1];
  const HIPS = 0, SPINE = 1, CHEST = 2, NECK = 3, HEAD = 4, CLAV = 5, ARM = 6, FORE = 7, HAND = 8, THIGH = 13, SHIN = 14, FOOT = 15, PROPL = 19, PROPR = 20, PROPR2 = 21, AUX = 22;
  const mir = b => b < 13 ? b + 4 : b + 3;                     // left bone index -> right bone index
  // pose channels: 19 bones * 3 euler, then extras
  const HX = 57, HY = 58, HZ = 59, PL = 60, PR = 61, FPL = 62, FPR = 63, YAL = 64, YAR = 65, BOB = 66, TW = 67, BGX = 68, BGZ = 69, CLAMP = 70, PR2 = 71, AXX = 72, AXY = 73, AXZ = 74, ARX = 75, ARY = 76, ARZ = 77, AXS = 78, NCH = 79;

  /* ------------------------------------------------------------------ mesh building with skin weights */
  const bucket = () => ({ P: [], N: [], U: [], C: [], R: [], SI: [], SW: [], I: [] });
  class Piece {
    constructor(b) { this.b = b; this.P = []; this.U = []; this.C = []; this.R = []; this.W = []; this.I = []; }
    v(x, y, z, u, v, col, rough, w) { const i = this.P.length / 3; this.P.push(x, y, z); this.U.push(u, v); this.C.push(col[0], col[1], col[2]); this.R.push(rough); this.W.push(w); return i; }
    tri(a, b, c) { this.I.push(a, b, c); }
    quad(a, b, c, d) { this.I.push(a, b, c, a, c, d); }
    /** computes smooth normals (shared by position), orients the surface outward, appends to the bucket. o: {hard, flip, out:[x,y,z]} */
    end(o) {
      o = o || {}; let P = this.P, U = this.U, C = this.C, R = this.R, W = this.W, I = this.I;
      if (o.hard) { const nP = [], nU = [], nC = [], nR = [], nW = [], nI = []; for (let k = 0; k < I.length; k++) { const i = I[k]; nP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); nU.push(U[i * 2], U[i * 2 + 1]); nC.push(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]); nR.push(R[i]); nW.push(W[i]); nI.push(k); } P = nP; U = nU; C = nC; R = nR; W = nW; I = nI; }
      const nv = P.length / 3, id = new Int32Array(nv), map = new Map(), acc = []; let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < nv; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; cx += x; cy += y; cz += z;
        let key; if (o.hard) { const t = (i / 3) | 0, a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];   // key by face plane so both tris of a quad share a normal
          const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; key = Math.round(nx / l * 50) + ',' + Math.round(ny / l * 50) + ',' + Math.round(nz / l * 50) + '|' + Math.round(x * 2e4) + ',' + Math.round(y * 2e4) + ',' + Math.round(z * 2e4); }
        else key = Math.round(x * 2e4) + ',' + Math.round(y * 2e4) + ',' + Math.round(z * 2e4);
        let k = map.get(key); if (k === undefined) { k = acc.length / 3; map.set(key, k); acc.push(0, 0, 0); } id[i] = k; }
      cx /= nv; cy /= nv; cz /= nv; let orient = 0; const ov = o.out;
      for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2];
        const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const q of [a, b, c]) { const k = id[q] * 3; acc[k] += nx; acc[k + 1] += ny; acc[k + 2] += nz; }
        if (ov) orient += nx * ov[0] + ny * ov[1] + nz * ov[2];
        else orient += nx * (ax + (ux + vx) / 3 - cx) + ny * (ay + (uy + vy) / 3 - cy) + nz * (az + (uz + vz) / 3 - cz); }
      const flip = o.flip !== undefined ? o.flip : orient < 0, sg = flip ? -1 : 1, B = this.b, base = B.P.length / 3;
      for (let i = 0; i < nv; i++) { const k = id[i] * 3, l = Math.hypot(acc[k], acc[k + 1], acc[k + 2]) || 1;
        B.P.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); B.N.push(sg * acc[k] / l, sg * acc[k + 1] / l, sg * acc[k + 2] / l); B.U.push(U[i * 2], U[i * 2 + 1]); B.C.push(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]); B.R.push(R[i]);
        const w = W[i], pr = []; for (let q = 0; q < w.length; q += 2) if (w[q + 1] > 1e-3) pr.push([w[q], w[q + 1]]); pr.sort((a, b) => b[1] - a[1]); pr.length = Math.min(pr.length, 4);
        let s = 0; for (const p of pr) s += p[1]; for (let q = 0; q < 4; q++) { B.SI.push(pr[q] ? pr[q][0] : 0); B.SW.push(pr[q] ? pr[q][1] / s : 0); } }
      for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2];
        if (a === b || b === c || a === c) continue; if (id[a] === id[b] || id[b] === id[c] || id[a] === id[c]) continue;   // drop degenerate (pole) triangles
        if (flip) B.I.push(base + a, base + c, base + b); else B.I.push(base + a, base + b, base + c); }
    }
  }
  const se = (a, e) => { const c = cos(a), s = sin(a), k = 2 / e; return [Math.sign(c) * Math.pow(abs(c), k), Math.sign(s) * Math.pow(abs(s), k)]; };
  /** Catmull-Rom through table rows [key, v1, v2, ...] */
  function interp(tb, y) { const n = tb.length; if (y <= tb[0][0]) return tb[0]; if (y >= tb[n - 1][0]) return tb[n - 1];
    let i = 0; while (tb[i + 1][0] < y) i++; const a = tb[Math.max(0, i - 1)], b = tb[i], c = tb[i + 1], d = tb[Math.min(n - 1, i + 2)], h = c[0] - b[0], t = (y - b[0]) / h, t2 = t * t, t3 = t2 * t, o = [y];
    for (let k = 1; k < b.length; k++) { const m1 = (c[k] - a[k]) / (c[0] - a[0]) * h, m2 = (d[k] - b[k]) / (d[0] - b[0]) * h; o.push((2 * t3 - 3 * t2 + 1) * b[k] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * c[k] + (t3 - t2) * m2); } return o; }
  /** ring: {p:[x,y,z], rx, rf, rb, e, ax:'y'|'z', U, V, mod(a)} -> seg+1 points (closed) */
  function ringPts(r, seg) { const out = [], p = r.p, e = r.e || 2, rb = r.rb === undefined ? r.rf : r.rb;
    for (let j = 0; j <= seg; j++) { const a = j / seg * TAU, cs = se(a, e), m = r.mod ? r.mod(a) : 1, du = r.rx * cs[0] * m, dv = (cs[1] > 0 ? r.rf : rb) * cs[1] * m;
      if (r.U) out.push([p[0] + r.U[0] * du + r.V[0] * dv, p[1] + r.U[1] * du + r.V[1] * dv, p[2] + r.U[2] * du + r.V[2] * dv]);
      else if (r.ax === 'z') out.push([p[0] + du, p[1] + dv, p[2]]); else out.push([p[0] + du, p[1], p[2] + dv]); }
    out[seg] = out[0].slice(); return out; }
  const UVS = 2.2;   // cloth uv per metre
  /** skin a surface through a list of rings. o: {col, rough, w, blank (constant uv)} ; per ring: col / cf(p,t), rough, w / wf(p,t), pts */
  function loft(pc, rings, seg, o) { o = o || {}; let v = 0, prev = null, prow = null;
    for (const r of rings) { const pts = r.pts || ringPts(r, seg), n = pts.length, row = [];
      if (prev) { const k = Math.min((n / 4) | 0, prev.length - 1); v += Math.hypot(pts[k][0] - prev[k][0], pts[k][1] - prev[k][1], pts[k][2] - prev[k][2]); }
      let u = 0;
      for (let j = 0; j < n; j++) { const p = pts[j]; if (j) u += Math.hypot(p[0] - pts[j - 1][0], p[1] - pts[j - 1][1], p[2] - pts[j - 1][2]);
        const t = j / (n - 1), w = r.wf ? r.wf(p, t) : (r.w || o.w), ro = r.rough !== undefined ? r.rough : o.rough; let col = r.cf ? r.cf(p, t) : (r.col || o.col);
        if (!o.blank && o.vary !== 0) col = mul(col, 1 + (o.vary || .1) * sin(p[0] * 31 + p[1] * 17 + 1) * sin(p[1] * 37 + p[2] * 29 + 2));
        row.push(o.blank ? pc.v(p[0], p[1], p[2], .003, .997, col, ro, w) : pc.v(p[0], p[1], p[2], u * UVS, v * UVS, col, ro, w)); }
      if (prow) for (let j = 0; j < n - 1; j++) pc.quad(prow[j], prow[j + 1], row[j + 1], row[j]);
      prow = row; prev = pts; } }
  const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], vnorm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  /** round tube along pts with per-point radii, capped */
  function tube(bkt, pts, radii, seg, o) { const pc = new Piece(bkt), rings = [], n = pts.length; let U0 = null;
    for (let i = 0; i < n; i++) { const t = vnorm(vsub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])); let ref = U0 ? vcross(t, vcross(U0, t)) : (abs(t[1]) < .9 ? [0, 1, 0] : [1, 0, 0]);
      const U = vnorm(vcross(ref, t)), V = vcross(t, U); U0 = U; const r0 = Array.isArray(radii) ? radii[i] : radii, ex = o.flat || 1, cp = o.cap === undefined ? .5 : o.cap, r = r0 * cp * 2;
      if (i === 0) rings.push({ p: [pts[0][0] - t[0] * r * .5, pts[0][1] - t[1] * r * .5, pts[0][2] - t[2] * r * .5], U, V, rx: 0, rf: 0, w: o.ws ? o.ws[0] : undefined });
      rings.push({ p: pts[i], U, V, rx: r0, rf: r0 * ex, w: o.ws ? o.ws[i] : undefined });
      if (i === n - 1) rings.push({ p: [pts[i][0] + t[0] * r * .5, pts[i][1] + t[1] * r * .5, pts[i][2] + t[2] * r * .5], U, V, rx: 0, rf: 0, w: o.ws ? o.ws[i] : undefined }); }
    loft(pc, rings, seg, o); pc.end(); }
  /** thin strap lying on a surface. path: [{p, n, s?, w?}] */
  function ribbon(bkt, path, hw, th, o) { const pc = new Piece(bkt), rings = [];
    for (const q of path) { const s = q.s || [1, 0, 0], n = q.n, p = q.p, f = (a, b) => [p[0] + s[0] * a + n[0] * b, p[1] + s[1] * a + n[1] * b, p[2] + s[2] * a + n[2] * b], a0 = f(-hw, th);
      rings.push({ pts: [a0, f(hw, th), f(hw, -.006), f(-hw, -.006), a0.slice()], w: q.w, col: q.col }); }
    loft(pc, rings, 0, o); pc.end(o.end); }
  function box(bkt, c, sz, col, rough, w, ry, rx, blank) { const pc = new Piece(bkt), hx = sz[0] / 2, hy = sz[1] / 2, hz = sz[2] / 2, cy = cos(ry || 0), sy = sin(ry || 0), cx = cos(rx || 0), sx = sin(rx || 0), ix = [];
    for (let i = 0; i < 8; i++) { const x = (i & 1 ? hx : -hx), y0 = (i & 2 ? hy : -hy), z0 = (i & 4 ? hz : -hz), y = y0 * cx - z0 * sx, z = y0 * sx + z0 * cx; ix.push(pc.v(c[0] + x * cy + z * sy, c[1] + y, c[2] - x * sy + z * cy, blank ? .003 : (x + y) * UVS, blank ? .997 : (z + y) * UVS, col, rough, w)); }
    pc.quad(ix[0], ix[1], ix[3], ix[2]); pc.quad(ix[4], ix[6], ix[7], ix[5]); pc.quad(ix[0], ix[4], ix[5], ix[1]); pc.quad(ix[2], ix[3], ix[7], ix[6]); pc.quad(ix[0], ix[2], ix[6], ix[4]); pc.quad(ix[1], ix[5], ix[7], ix[3]); pc.end({ hard: true }); }

  /* ------------------------------------------------------------------ textures + shared materials */
  let TEX = null, MATS = null;
  function wrinkleNormal() { const S = 256, h = new Float32Array(S * S), r = GT.rng('people-cloth');
    const add = (nx, ny, amp) => { const L = new Float32Array(nx * ny); for (let i = 0; i < L.length; i++) L[i] = r();
      for (let y = 0; y < S; y++) { const fy = y / S * ny, y0 = fy | 0, ty = fy - y0, sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % ny;
        for (let x = 0; x < S; x++) { const fx = x / S * nx, x0 = fx | 0, tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % nx; h[y * S + x] += amp * lerp(lerp(L[y0 * nx + x0], L[y0 * nx + x1], sx), lerp(L[y1 * nx + x0], L[y1 * nx + x1], sx), sy); } } };
    add(6, 3, 1); add(13, 6, .5); add(27, 15, .2); add(64, 64, .03);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += .006 * sin(x * TAU * 43 / S) * sin(y * TAU * 43 / S);
    const d = new Uint8Array(S * S * 4), K = 5.5;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const dx = (h[y * S + (x + 1) % S] - h[y * S + (x + S - 1) % S]) * K, dy = (h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x]) * K, l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
      d[i] = (-dx / l * .5 + .5) * 255; d[i + 1] = (-dy / l * .5 + .5) * 255; d[i + 2] = (1 / l * .5 + .5) * 255; d[i + 3] = 255; }
    const t = new T.DataTexture(d, S, S, T.RGBAFormat); t.wrapS = t.wrapT = T.RepeatWrapping; t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true; return t; }
  function floralTex() { const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), r = GT.rng('people-floral');
    g.fillStyle = '#e4dcc8'; g.fillRect(0, 0, S, S);
    const wrap = fn => { for (let ox = -S; ox <= S; ox += S) for (let oy = -S; oy <= S; oy += S) { g.save(); g.translate(ox, oy); fn(); g.restore(); } };
    for (let i = 0; i < 26; i++) { const x = r() * S, y = r() * S, a = r() * TAU, l = 16 + r() * 16, c = ['#6d8672', '#577060', '#8a9a7a'][i % 3];
      wrap(() => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = c; g.beginPath(); g.ellipse(0, 0, l, l * .28, 0, 0, TAU); g.fill(); g.strokeStyle = 'rgba(40,60,45,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-l, 0); g.lineTo(l, 0); g.stroke(); g.restore(); }); }
    for (let i = 0; i < 15; i++) { const x = r() * S, y = r() * S, a = r() * TAU, R = 9 + r() * 7, c = ['#c4675a', '#d08a6a', '#b85a5e', '#d9b77a'][i % 4];
      wrap(() => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = c; for (let p = 0; p < 5; p++) { g.rotate(TAU / 5); g.beginPath(); g.ellipse(R * .62, 0, R * .62, R * .36, 0, 0, TAU); g.fill(); } g.fillStyle = '#e8cf8a'; g.beginPath(); g.arc(0, 0, R * .2, 0, TAU); g.fill(); g.restore(); }); }
    const t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; return t; }
  const FACE = { male: 0, female: 1, old: 2, stubble: 3, glasses: 4, fglasses: 5, stache: 6, mask: 7 };
  function faceAtlas() { const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 512);
    const k = 256 / .26, X = x => 128 + x * k, Y = y => 128 - y * k;
    const rad = (x, y, rx, ry, col, a) => { g.save(); g.translate(X(x), Y(y)); g.scale(rx * k, ry * k); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(.5, `rgba(${col},${a * .55})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore(); };
    const face = (ci, o) => { g.save(); g.beginPath(); g.rect((ci % 4) * 256, (ci >> 2) * 256, 256, 256); g.clip(); g.translate((ci % 4) * 256, (ci >> 2) * 256); g.lineCap = 'round'; g.lineJoin = 'round';
      if (o.mask) { g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(70,70,76,.5)'; g.lineWidth = 1; for (let y = 4; y < 256; y += 5) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
        g.beginPath(); g.ellipse(X(0), Y(.007), .06 * k, .0185 * k, 0, 0, TAU); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#222226'; g.lineWidth = 3; g.stroke(); g.clip(); }
      for (const s of [-1, 1]) { rad(s * .031, .009, .03, .021, '70,42,32', o.old ? .5 : .4); rad(s * .046, -.04, .03, .03, '255,140,120', .1); rad(s * .017, -.02, .012, .03, '90,60,50', .13); }
      rad(0, -.0535, .021, .0075, '55,30,26', .55); rad(0, -.089, .022, .0075, '70,45,40', .3); rad(0, .02, .012, .012, '90,60,50', .12);
      if (o.stubble) { g.save(); g.filter = 'blur(5px)'; g.fillStyle = `rgba(52,50,58,${o.stubble})`; g.beginPath(); g.moveTo(X(-.074), Y(-.025)); g.lineTo(X(-.06), Y(-.095)); g.lineTo(X(0), Y(-.128)); g.lineTo(X(.06), Y(-.095)); g.lineTo(X(.074), Y(-.025)); g.lineTo(X(.04), Y(-.058)); g.lineTo(X(0), Y(-.052)); g.lineTo(X(-.04), Y(-.058)); g.closePath(); g.fill(); g.restore(); }
      if (o.old) { g.strokeStyle = 'rgba(80,50,40,.3)'; g.lineWidth = 1.3; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(X(-.04), Y(.047 + i * .012)); g.quadraticCurveTo(X(0), Y(.051 + i * .012), X(.04), Y(.047 + i * .012)); g.stroke(); }
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(X(s * .02), Y(-.04)); g.quadraticCurveTo(X(s * .034), Y(-.058), X(s * .033), Y(-.08)); g.stroke(); g.beginPath(); g.moveTo(X(s * .019), Y(-.008)); g.quadraticCurveTo(X(s * .031), Y(-.016), X(s * .044), Y(-.008)); g.stroke(); } }
      // brows
      g.strokeStyle = o.brow; g.lineWidth = o.browW; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(X(s * .0135), Y(.0185)); g.quadraticCurveTo(X(s * .033), Y(.0265), X(s * .055), Y(.0185)); g.stroke(); }
      // eyes
      if (o.glasses) { g.fillStyle = '#101013'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(X(s * .033), Y(.003), .0255 * k, .0165 * k, 0, 0, TAU); g.fill(); }
        g.strokeStyle = '#101013'; g.lineWidth = 3; g.beginPath(); g.moveTo(X(-.01), Y(.008)); g.lineTo(X(.01), Y(.008)); g.stroke(); g.beginPath(); g.moveTo(X(-.056), Y(.008)); g.lineTo(X(-.13), Y(.012)); g.moveTo(X(.056), Y(.008)); g.lineTo(X(.13), Y(.012)); g.stroke();
        g.strokeStyle = 'rgba(150,160,175,.35)'; g.lineWidth = 2; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(X(s * .033 - .014), Y(.011)); g.lineTo(X(s * .033 - .004), Y(.014)); g.stroke(); } }
      else for (const s of [-1, 1]) { g.save(); g.translate(X(s * .031), Y(.004)); g.scale(1.18, 1.25); g.translate(-X(s * .031), -Y(.004)); const eye = () => { g.beginPath(); g.moveTo(X(s * .0175), Y(.002)); g.quadraticCurveTo(X(s * .031), Y(.0125), X(s * .0455), Y(.004)); g.quadraticCurveTo(X(s * .031), Y(-.0045), X(s * .0175), Y(.002)); };
        g.save(); eye(); g.fillStyle = '#e4dcd2'; g.fill(); g.clip(); g.fillStyle = '#2a1a11'; g.beginPath(); g.arc(X(s * .031), Y(.0042), .0058 * k, 0, TAU); g.fill(); g.fillStyle = '#060404'; g.beginPath(); g.arc(X(s * .031), Y(.0042), .0026 * k, 0, TAU); g.fill(); g.restore();
        g.strokeStyle = 'rgba(28,16,10,.9)'; g.lineWidth = o.lash; g.beginPath(); g.moveTo(X(s * .0175), Y(.002)); g.quadraticCurveTo(X(s * .031), Y(.0125), X(s * .047), Y(.0045)); g.stroke();
        g.strokeStyle = 'rgba(60,35,28,.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(s * .02), Y(.0005)); g.quadraticCurveTo(X(s * .031), Y(-.005), X(s * .044), Y(.002)); g.stroke(); g.restore(); }
      // nostrils, lips
      g.fillStyle = 'rgba(40,20,18,.6)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(X(s * .0085), Y(-.0485), .0042 * k, .0024 * k, 0, 0, TAU); g.fill(); }
      g.fillStyle = o.lipU; g.beginPath(); g.moveTo(X(-.024), Y(-.071)); g.quadraticCurveTo(X(-.01), Y(-.063), X(0), Y(-.066)); g.quadraticCurveTo(X(.01), Y(-.063), X(.024), Y(-.071)); g.quadraticCurveTo(X(0), Y(-.0725), X(-.024), Y(-.071)); g.fill();
      g.fillStyle = o.lipL; g.beginPath(); g.moveTo(X(-.024), Y(-.071)); g.quadraticCurveTo(X(0), Y(-.0725), X(.024), Y(-.071)); g.quadraticCurveTo(X(0), Y(-.087), X(-.024), Y(-.071)); g.fill();
      g.strokeStyle = 'rgba(55,22,22,.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(-.025), Y(-.0705)); g.quadraticCurveTo(X(0), Y(-.073), X(.025), Y(-.0705)); g.stroke();
      if (o.stache) { g.save(); g.filter = 'blur(1.2px)'; g.fillStyle = o.stache; g.beginPath(); g.moveTo(X(-.03), Y(-.07)); g.quadraticCurveTo(X(-.012), Y(-.052), X(0), Y(-.057)); g.quadraticCurveTo(X(.012), Y(-.052), X(.03), Y(-.07)); g.quadraticCurveTo(X(0), Y(-.064), X(-.03), Y(-.07)); g.fill(); g.restore(); }
      g.restore(); };
    const M = { brow: 'rgba(38,26,18,.88)', browW: 5, lash: 2.4, lipU: 'rgba(160,92,84,.5)', lipL: 'rgba(175,100,92,.42)' };
    face(0, M); face(1, { brow: 'rgba(48,32,22,.85)', browW: 3.2, lash: 3.6, lipU: 'rgba(168,62,66,.82)', lipL: 'rgba(182,72,76,.78)' });
    face(2, Object.assign({}, M, { old: 1, brow: 'rgba(120,112,104,.75)', stubble: .12 })); face(3, Object.assign({}, M, { stubble: .34 }));
    face(4, Object.assign({}, M, { glasses: 1 })); face(5, { glasses: 1, brow: 'rgba(48,32,22,.85)', browW: 3.2, lash: 3, lipU: 'rgba(168,62,66,.82)', lipL: 'rgba(182,72,76,.78)' });
    face(6, Object.assign({}, M, { glasses: 1, stache: 'rgba(40,28,20,.85)', stubble: .16 })); face(7, Object.assign({}, M, { mask: 1 }));
    const t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; }
  /* ---- China edition: one shared atlas of printed things (team shirts, rider jackets, vests, aprons, the guide's flag, marriage adverts, a phone live-stream) */
  const DECAL = {}, WHT = [1, 1, 1];
  function decalAtlas() { const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), r = GT.rng('people-decal'); g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
    const F = (px, wt) => (wt || 900) + ' ' + px + 'px "PingFang SC","Hiragino Sans GB","Heiti SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
    let cx = 0, cy = 0, rowH = 0;
    const cell = (name, w, h, fn) => { if (cx + w > S) { cx = 0; cy += rowH; rowH = 0; } g.save(); g.beginPath(); g.rect(cx, cy, w, h); g.clip(); g.translate(cx, cy); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; fn(w, h); g.restore();
      DECAL[name] = [(cx + 2) / S, 1 - (cy + h - 2) / S, (cx + w - 2) / S, 1 - (cy + 2) / S]; cx += w; rowH = Math.max(rowH, h); };
    const grime = (w, h, k) => { for (let i = 0; i < 22 * k; i++) { g.fillStyle = 'rgba(' + (r() < .55 ? '30,24,18' : '255,250,240') + ',' + (.03 + r() * .06).toFixed(3) + ')'; g.beginPath(); g.ellipse(r() * w, r() * h, 4 + r() * 26, 2 + r() * 9, r() * 3, 0, TAU); g.fill(); } };
    const label = (name, w, h, text, bg, fg, o) => cell(name, w, h, () => { o = o || {}; g.fillStyle = bg; g.fillRect(0, 0, w, h); if (o.border) { g.strokeStyle = o.border; g.lineWidth = 5; g.strokeRect(7, 7, w - 14, h - 14); }
      if (o.pre) o.pre(w, h); g.fillStyle = fg; const sub = o.sub, ty = sub ? h * .4 : h * .53; g.font = F(o.px || Math.round(h * (sub ? .5 : .6)), o.wt); if (o.italic) { g.save(); g.transform(1, 0, -.18, 1, h * .08, 0); } g.fillText(text, w / 2, ty, w - 18); if (o.italic) g.restore();
      if (sub) { g.font = F(Math.round(h * .18), 800); g.fillStyle = o.subFg || fg; g.fillText(sub, w / 2, h * .79, w - 24); } grime(w, h, o.grime === undefined ? 1 : o.grime); });
    cell('white', 16, 128, () => { });                                                   // (0,0) stays pure white: blank uv of the glow / decal buckets
    label('dance', 320, 128, '四方街舞蹈队', '#c22a26', '#f6d24a', { sub: '健康 · 快乐 · 不扰民', subFg: '#fbe9b0' });
    label('pdk', 272, 128, '跑得快', '#f0b81c', '#16130e', { italic: 1, sub: '— 使命必达 —', pre: () => { g.fillStyle = 'rgba(22,19,14,.85)'; for (let i = 0; i < 3; i++) g.fillRect(12, 28 + i * 15, 30 - i * 8, 6); } });
    label('msd', 272, 128, '马上到', '#2463c0', '#f4f6fa', { italic: 1, sub: '同城急送 · 风雨无阻' });
    label('cg', 272, 128, 'POLICE', '#141a2a', '#e9edf2', { sub: 'HARBOR CITY', border: '#c9a23a', wt: 800 });
    label('ba', 208, 128, '保安', '#141a26', '#e6e8ea', { sub: 'SECURITY', border: '#8a9098' });
    label('hw', 272, 128, '江城环卫', '#e2621c', '#eef0ee', { sub: '城市美容师' });
    label('jj', 208, 128, 'POLICE', '#141a2a', '#e9edf2', { sub: 'HARBOR CITY', border: '#c9a23a', wt: 800 });
    label('dj', 240, 128, '代驾', '#1a1a1e', '#f08a1c', { sub: '安全到家 · 随叫随到', subFg: '#e8e8e4' });
    label('school', 272, 128, '江城七中', '#f1f1ec', '#1d4fa0', { sub: 'JIANGCHENG NO.7 MIDDLE SCHOOL' });
    label('hao', 320, 128, '郝氏金融', '#0f0f11', '#d8b04a', { sub: '信誉第一 · 上门服务', subFg: '#c9c4b4' });
    label('dog', 128, 128, '旺财', '#b8281e', '#f6d24a', {});
    label('lajie', 256, 128, '辣姐老灶火锅', '#7a1414', '#f2c84a', { sub: '莫慌 先吃' });
    label('guaizi', 256, 128, '拐子热干面', '#f4f1e6', '#b3201a', { sub: '过早 就这一碗' });
    label('mange', 256, 128, '满哥臭豆腐', '#16130f', '#f0c020', { sub: '闻起臭 恰起香' });
    label('swim', 256, 128, '四方冬泳队', '#1d4f8f', '#f4f1e6', { sub: '一年四季 天天下水' });
    cell('tour', 336, 224, (w, h) => { g.fillStyle = '#f2c81c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#b3201a'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16); g.fillStyle = '#b3201a'; g.font = F(64); g.fillText('江城一日游', w / 2, h * .4, w - 40); g.font = F(30, 700); g.fillText('跟紧小旗 · 莫掉队', w / 2, h * .74, w - 40); grime(w, h, 1.2); });
    const ads = [['男 1994年', '身高178 本科', '国企 有房', '人老实 会做饭', '觅：温柔顾家'], ['女 1996年', '身高163 硕士', '小学教师', '性格好 爱旅游', '觅：有上进心']];
    ads.forEach((a, i) => cell('ad' + (i + 1), 184, 256, (w, h) => { g.fillStyle = i ? '#fbe9ee' : '#f6f3ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#b3201a'; g.font = F(34); g.fillText(a[0], w / 2, 34, w - 14); g.fillRect(14, 58, w - 28, 3); g.fillStyle = '#1b1b1b'; g.font = F(24, 700); for (let l = 1; l < 5; l++) g.fillText(a[l], w / 2, 58 + l * 40, w - 16); g.fillStyle = '#1d3f78'; g.font = F(17, 600); g.fillText('有意请与家长面谈', w / 2, 238, w - 12); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; g.strokeRect(3, 3, w - 6, h - 6); grime(w, h, .6); }));
    cell('live', 144, 256, (w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a2a4a'); gr.addColorStop(.55, '#c88a7a'); gr.addColorStop(1, '#2a2030'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#e8c4a8'; g.beginPath(); g.ellipse(w / 2, 104, 30, 37, 0, 0, TAU); g.fill(); g.fillStyle = '#1a1210'; g.beginPath(); g.ellipse(w / 2, 86, 33, 26, 0, PI, TAU); g.fill();
      g.fillStyle = '#e8283a'; g.fillRect(8, 8, 46, 20); g.fillStyle = '#fff'; g.font = F(14); g.fillText('直播中', 31, 19); g.font = F(13, 700); g.fillText('1.2万人在看', 100, 19); g.textAlign = 'left';
      ['老铁666', '主播看镜头', '这是哪里呀', '轻轨来了！！'].forEach((s, k) => { g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(6, 162 + k * 21, 14 + s.length * 13, 18); g.fillStyle = ['#ffd84a', '#fff', '#9fe0ff', '#ff9ab0'][k]; g.font = F(12, 700); g.fillText(s, 11, 172 + k * 21); });
      g.fillStyle = '#ff5a7a'; for (let k = 0; k < 5; k++) { const hx = 118 + sin(k * 2.1) * 12, hy = 150 - k * 22, hs2 = 7 - k * .7; g.beginPath(); g.arc(hx - hs2 / 2, hy, hs2 / 2, 0, TAU); g.arc(hx + hs2 / 2, hy, hs2 / 2, 0, TAU); g.moveTo(hx - hs2, hy + 1); g.lineTo(hx, hy + hs2 * 1.4); g.lineTo(hx + hs2, hy + 1); g.fill(); } });
    cell('cap', 128, 256, (w, h) => { g.fillStyle = '#d8281e'; g.fillRect(0, 0, w, h); g.fillStyle = '#f6d24a'; g.beginPath(); g.arc(w / 2, 70, 46, 0, TAU); g.fill(); g.fillStyle = '#b3201a'; g.font = F(60); g.fillText('游', w / 2, 74); g.fillStyle = '#f6d24a'; g.font = F(22, 800); g.fillText('江城旅行', w / 2, 160, w - 10); g.fillText('3号团', w / 2, 200, w - 10); });
    label('cart', 384, 128, '现摘水果 十元三斤', '#f4f1e6', '#b3201a', { sub: '不甜不要钱', subFg: '#1d3f78', border: '#b3201a' });
    label('arm', 256, 128, '治安巡逻', '#c0201a', '#f6d24a', { px: 62 });
    cell('pdks', 128, 128, (w, h) => { g.fillStyle = '#f0b81c'; g.fillRect(0, 0, w, h); g.fillStyle = '#16130e'; g.beginPath(); g.arc(w / 2, h / 2, 50, 0, TAU); g.fill(); g.fillStyle = '#f0b81c'; g.font = F(64); g.save(); g.transform(1, 0, -.18, 1, 10, 0); g.fillText('跑', w / 2, h / 2 + 3); g.restore(); });
    cell('msds', 128, 128, (w, h) => { g.fillStyle = '#2463c0'; g.fillRect(0, 0, w, h); g.fillStyle = '#f4f6fa'; g.beginPath(); g.arc(w / 2, h / 2, 50, 0, TAU); g.fill(); g.fillStyle = '#2463c0'; g.font = F(64); g.fillText('马', w / 2, h / 2 + 3); });
    const t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; }
  /** flat textured quad skinned to one bone. c = centre, U/V = unit axes (front faces U x V), o: { two (readable from both sides), col, rough } */
  function sheet(bkt, cellName, c, U, V, w, h, wgt, o) { o = o || {}; const R = DECAL[cellName] || DECAL.white || [.003, .9, .01, .997], n = vcross(U, V), col = o.col || WHT;
    for (const f of (o.two ? [1, -1] : [1])) { const pc = new Piece(bkt), ix = [];
      for (const q of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const a = q[0], b = q[1], u = (a * f + 1) / 2, v = (b + 1) / 2, e = f * .0018; ix.push(pc.v(c[0] + U[0] * a * w / 2 + V[0] * b * h / 2 + n[0] * e, c[1] + U[1] * a * w / 2 + V[1] * b * h / 2 + n[1] * e, c[2] + U[2] * a * w / 2 + V[2] * b * h / 2 + n[2] * e, lerp(R[0], R[2], u), lerp(R[1], R[3], v), col, o.rough || .7, wgt)); }
      pc.quad(ix[0], ix[1], ix[2], ix[3]); pc.end({ out: [n[0] * f, n[1] * f, n[2] * f] }); } }
  /* ---- a small dog in a jacket, skinned to the same 23-bone skeleton (arms = front legs, aux = tail) so it shares make(), LOD and populate */
  function buildDog(sp) { const bk = { cloth: bucket(), decal: bucket() }, fc = lin(sp.fur), fc2 = lin(sp.fur2 !== undefined ? sp.fur2 : 0xeee4d0), jc = lin(sp.jacket), trim = lin(0xf0e8d8), dk = lin(0x14100d), J = BN.map(() => [0, 0, 0]), FR = .96;
    const setJ = (i, x, y, z) => { J[i] = [x, y, z]; };
    setJ(HIPS, 0, .3, -.15); setJ(SPINE, 0, .31, -.04); setJ(CHEST, 0, .31, .08); setJ(NECK, 0, .36, .17); setJ(HEAD, 0, .43, .23);
    for (const s of [1, -1]) { const a = s > 0 ? 0 : 4, b = s > 0 ? 0 : 3; setJ(CLAV + a, s * .03, .3, .1); setJ(ARM + a, s * .062, .26, .12); setJ(FORE + a, s * .062, .14, .125); setJ(HAND + a, s * .062, .035, .13); setJ(THIGH + b, s * .064, .27, -.17); setJ(SHIN + b, s * .068, .15, -.205); setJ(FOOT + b, s * .068, .04, -.19); }
    setJ(PROPL, .062, .03, .13); setJ(PROPR, -.062, .03, .13); setJ(PROPR2, -.062, .03, .13);
    const wZ = z => { const a = sm(z, -.12, -.02), b = sm(z, .02, .12); return [HIPS, 1 - a, SPINE, a * (1 - b), CHEST, b]; };
    { const pc = new Piece(bk.cloth), rs = []; for (const q of [[-.275, 0, 0, .3], [-.262, .05, .05, .3], [-.2, .08, .085, .3], [-.1, .088, .09, .305], [0, .085, .088, .305], [.1, .092, .1, .3], [.17, .085, .095, .31], [.215, .05, .06, .33], [.228, 0, 0, .33]]) rs.push({ p: [0, q[3], q[0]], rx: q[1], rf: q[2], rb: q[2] * 1.05, e: 2.2, ax: 'z', w: wZ(q[0]), cf: p => p[1] < q[3] - .035 ? fc2 : fc });
      loft(pc, rs, 12, { col: fc, rough: FR, vary: .14 }); pc.end(); }
    { const pc = new Piece(bk.cloth), rs = []; for (const q of [[-.135, .086, .094, 1], [-.128, .098, .106, 1], [-.06, .099, .104, 0], [.05, .1, .106, 0], [.13, .104, .114, 0], [.168, .1, .11, 1], [.176, .088, .098, 1]]) rs.push({ p: [0, .304, q[0]], rx: q[1], rf: q[2], rb: q[2] * .9, e: 2.2, ax: 'z', w: wZ(q[0]), col: q[3] ? trim : jc, mod: a => 1 + .012 * sin(a * 9) });
      loft(pc, rs, 12, { col: jc, rough: .62, vary: .05 }); pc.end(); sheet(bk.decal, 'dog', [0, .418, .0], [1, 0, 0], [0, 0, -1], .1, .1, [SPINE, 1]); }
    for (const s of [1, -1]) { const a = s > 0 ? ARM : ARM + 4, b = s > 0 ? THIGH : THIGH + 3;
      tube(bk.cloth, [[s * .062, .27, .12], [s * .062, .14, .125], [s * .062, .04, .13], [s * .062, .014, .15]], [.036, .024, .02, .023], 6, { col: fc, rough: FR, ws: [[a, 1], [a, .5, a + 1, .5], [a + 1, .5, a + 2, .5], [a + 2, 1]] });
      tube(bk.cloth, [[s * .064, .29, -.17], [s * .068, .15, -.205], [s * .068, .045, -.19], [s * .068, .014, -.165]], [.05, .028, .02, .023], 6, { col: fc, rough: FR, ws: [[b, 1], [b, .5, b + 1, .5], [b + 1, .5, b + 2, .5], [b + 2, 1]] });
      tube(bk.cloth, [[s * .044, .485, .238], [s * .054, .52, .232], [s * .06, .548, .226]], [.024, .016, .004], 5, { col: mul(fc, .78), rough: FR, w: [HEAD, 1] });
      ballGeo(bk.cloth, [s * .03, .462, .292], .0085, dk, .2, [HEAD, 1], { seg: 6 }); }
    tube(bk.cloth, [[0, .33, .15], [0, .385, .2], [0, .43, .225]], [.075, .062, .055], 8, { col: fc, rough: FR, ws: [[CHEST, 1], [NECK, 1], [HEAD, 1]] });
    { const pc = new Piece(bk.cloth), rs = []; for (const q of [[.178, 0, 0, .44], [.19, .046, .046, .442], [.235, .066, .064, .446], [.28, .06, .056, .44], [.305, .04, .036, .426], [.355, .031, .027, .42], [.384, .024, .021, .418], [.393, 0, 0, .418]]) rs.push({ p: [0, q[3], q[0]], rx: q[1], rf: q[2], rb: q[2], e: 2.1, ax: 'z', cf: p => (p[2] > .3 && p[1] < .425) ? fc2 : fc });
      loft(pc, rs, 10, { col: fc, rough: FR, w: [HEAD, 1], vary: .1 }); pc.end(); ballGeo(bk.cloth, [0, .43, .392], .013, dk, .25, [HEAD, 1], { seg: 6 }); }
    tube(bk.cloth, [[0, 0, 0], [0, .06, -.035], [0, .115, -.02], [0, .13, .03]], [.024, .021, .018, .009], 6, { col: fc, rough: FR, w: [AUX, 1] });
    return finishGeo(bk, { J, top: .56, torch: null }); }
  function mats() { if (MATS) return MATS; TEX = { face: faceAtlas(), wrinkle: wrinkleNormal(), floral: floralTex(), decal: decalAtlas() };
    const mk = o => { const m = new T.MeshStandardMaterial(Object.assign({ vertexColors: true, skinning: true, metalness: 0, roughness: 1 }, o));
      m.onBeforeCompile = sh => { sh.vertexShader = 'attribute float aRough;\nvarying float vRough;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvRough = aRough;');
        sh.fragmentShader = 'varying float vRough;\n' + sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor *= vRough;'); };
      m.customProgramCacheKey = () => 'gt_people'; return m; };
    MATS = { cloth: mk({ normalMap: TEX.wrinkle, normalScale: new T.Vector2(.7, .7) }), skin: mk({ map: TEX.face }), print: mk({ map: TEX.floral, normalMap: TEX.wrinkle, normalScale: new T.Vector2(.4, .4) }) };
    MATS.cloth.name = 'people_cloth'; MATS.skin.name = 'people_skin'; MATS.print.name = 'people_print';
    MATS.decal = mk({ map: TEX.decal, normalMap: TEX.wrinkle, normalScale: new T.Vector2(.25, .25) }); MATS.decal.name = 'people_decal';
    MATS.glow = new T.MeshBasicMaterial({ map: TEX.decal, vertexColors: true, skinning: true }); MATS.glow.name = 'people_glow'; GT.glow(MATS.glow, new T.Color(1, 1, 1), .85, 2.6);
    const lm = new T.MeshBasicMaterial({ color: 0xffffff }); lm.name = 'people_torch'; GT.glow(lm, new T.Color(.85, .93, 1), 5, 16); MATS.torch = lm; return MATS; }

  /* ------------------------------------------------------------------ anatomy tables (1.75 m figure, metres) */
  // torso: [y, half width, front depth, back depth]
  const TB_M = [[.80, .07, .05, .062], [.84, .135, .08, .1], [.90, .166, .098, .116], [.96, .164, .1, .11], [1.02, .152, .098, .096], [1.09, .145, .098, .09], [1.17, .153, .105, .094], [1.25, .166, .115, .102], [1.32, .178, .118, .11], [1.38, .19, .104, .108], [1.425, .192, .087, .097], [1.455, .16, .07, .082], [1.49, .064, .056, .064]];
  const TB_F = [[.80, .07, .05, .064], [.84, .138, .08, .104], [.90, .172, .098, .12], [.96, .166, .098, .11], [1.02, .142, .092, .092], [1.09, .124, .088, .082], [1.17, .13, .096, .086], [1.25, .142, .118, .092], [1.31, .154, .126, .098], [1.37, .166, .1, .097], [1.413, .166, .081, .088], [1.444, .138, .064, .074], [1.48, .058, .05, .056]];
  // arm: [dist below shoulder joint, rx, rz]   leg: [dist below hip joint, rx, rf, rb]
  const ARM_T = [[-.04, 0, 0], [-.034, .028, .032], [-.017, .045, .05], [.018, .054, .06], [.075, .053, .058], [.155, .048, .053], [.235, .043, .046], [.288, .041, .043], [.33, .044, .047], [.40, .04, .043], [.48, .032, .035], [.545, .0255, .031], [.57, .0245, .03]];
  const LEG_T = [[-.088, 0, 0, 0], [-.07, .05, .05, .05], [-.03, .078, .08, .082], [.03, .086, .09, .092], [.12, .082, .086, .088], [.24, .07, .073, .074], [.34, .059, .062, .06], [.42, .054, .058, .054], [.49, .05, .05, .056], [.57, .052, .048, .064], [.68, .043, .042, .048], [.78, .035, .036, .038], [.86, .033, .036, .036]];
  // head: [y from head centre, half width, front, back, centre z]
  const HT = [[-.119, 0, 0, 0, .035], [-.114, .034, .034, .024, .03], [-.104, .049, .054, .038, .022], [-.088, .06, .071, .052, .014], [-.068, .0675, .085, .067, .006], [-.045, .072, .090, .082, .002], [-.02, .074, .091, .094, 0], [0, .0755, .092, .099, 0], [.02, .0765, .096, .101, 0], [.045, .075, .094, .099, 0], [.07, .069, .085, .091, -.002], [.092, .057, .066, .074, -.004], [.108, .036, .04, .046, -.006], [.1165, 0, 0, 0, -.006]];
  const HEAD_Y = [-.119, -.114, -.104, -.094, -.083, -.073, -.063, -.052, -.04, -.028, -.016, -.005, .006, .017, .028, .042, .058, .074, .09, .104, .112, .1165];
  const featZ = (x, y) => -.0065 * G(abs(x) - .031, .014) * G(y - .004, .011) + .003 * G(y - .022, .008) * sm(.064 - abs(x), 0, .02) + .004 * G(x, .013) * G(y + .03, .022) + .0035 * G(x, .024) * G(y + .07, .011) + .003 * G(abs(x) - .04, .02) * G(y + .025, .02);
  function headSurf(a, y, off, feat) { const t = interp(HT, y), cs = se(a, 2.15); const x = (t[1] + off) * cs[0]; let z = t[4] + ((cs[1] > 0 ? t[2] : t[3]) + off) * cs[1]; if (feat && cs[1] > 0) z += featZ(x, y) * sm(cs[1], .15, .6); return [x, y, z]; }

  /* ------------------------------------------------------------------ figure geometry from a spec */
  const GEO = {};
  /** small uv-less sphere (balls, pom-poms) */
  function ballGeo(bkt, c, r, col, rough, w, o) { const pc = new Piece(bkt), rings = [], n = 6; o = o || {};
    for (let i = 0; i <= n; i++) { const a = -PI / 2 + PI * i / n, rr = r * cos(a); rings.push({ p: [c[0], c[1] + r * sin(a), c[2]], rx: rr, rf: rr, e: 2, col: o.band && i === n / 2 ? o.band : col }); }
    loft(pc, rings, o.seg || 10, { col, rough, w, vary: .05 }); pc.end(); }
  function buildFigure(sp, NB) {
    if (sp.dog) return buildDog(sp);
    const bk = { cloth: bucket(), skin: bucket(), print: bucket(), decal: bucket(), glow: bucket() }, fem = !!sp.female, sh = sp.sh * .935, hp = sp.hp, sY = fem ? 1.385 : 1.40, ny = fem ? -.012 : 0;
    const J = [[0, .95, 0], [0, 1.07, 0], [0, 1.25, 0], [0, 1.47 + ny, 0], [0, 1.565 + ny * 1.8, .012], [.03, sY + .015, 0], [sh, sY, 0], [sh, sY - .29, 0], [sh, sY - .55, 0], [-.03, sY + .015, 0], [-sh, sY, 0], [-sh, sY - .29, 0], [-sh, sY - .55, 0],
      [hp, .925, 0], [hp, .505, 0], [hp, .085, 0], [-hp, .925, 0], [-hp, .505, 0], [-hp, .085, 0], [sh - .014, sY - .635, .008], [-(sh - .014), sY - .635, .008], [-(sh - .014), sY - .635, .008], [0, 0, 0]];
    const hs = (fem ? 1.02 : 1.06) * (sp.headK || 1), HC = [0, J[HEAD][1] + .069 * hs + .005, .022], top = HC[1] + .1165 * hs + Math.min(.03, sp.hair && sp.hair.th || 0);
    const kb = 1 + (sp.bulk - 1) * .7, tb = (fem ? TB_F : TB_M).map(r => { const y = r[0], b = (sp.belly || 0) * G(y - 1.05, .13), u = y < 1.44 ? kb : 1, ch = (sp.chest || 0) * G(y - 1.3, .09); return [y, r[1] * u + b * .45 + ch * .5, r[2] * u + b + ch, r[3] * u + b * .15 + ch * .4]; });
    const skinC = lin(sp.skin), SK = .62;
    const wT = y => { const h = 1 - sm(y, .99, 1.11), c = sm(y, 1.16, 1.30), n = sm(y, J[NECK][1] - .035, J[NECK][1] + .03); return [HIPS, h, SPINE, 1 - h - c, CHEST, c * (1 - n), NECK, c * n]; };
    const tRing = (y, off, o) => { const t = interp(tb, y); return Object.assign({ p: [0, y, 0], rx: t[1] + off, rf: t[2] + off, rb: t[3] + off, e: lerp(2.3, 2.0, sm(y, 1.1, 1.42)), w: wT(y) }, o); };
    const surfZ = (x, y) => { const t = interp(tb, clamp(y, .86, 1.46)), e = 2.25, q = abs(x) / t[1]; return q >= 1 ? 0 : t[2] * Math.pow(1 - Math.pow(q, e), 1 / e); };
    const surfZb = (x, y) => { const t = interp(tb, clamp(y, .86, 1.46)), e = 2.25, q = abs(x) / t[1]; return q >= 1 ? 0 : -t[3] * Math.pow(1 - Math.pow(q, e), 1 / e); };
    const top_ = sp.top, bot = sp.bottom, bare = top_.type === 'bare', midriff = bare || top_.hem > 1.07;
    const topB = bare ? bk.skin : top_.print ? bk.print : bk.cloth, topC = bare ? skinC : lin(top_.col), topR = bare ? SK : (top_.rough || .88), trimC = top_.trim !== undefined ? lin(top_.trim) : null;
    const K = sp.kit || {};

    /* ---- legs */
    const botC = lin(bot.col), botR = bot.rough || .9, stripeC = bot.stripe !== undefined ? lin(bot.stripe) : null;
    const legRing = (side, d, off, o) => { const t = interp(LEG_T, d), k = sp.legBulk || sp.bulk, kn = sm(d, .365, .475), an = sm(d, .79, .87), b = side > 0 ? THIGH : THIGH + 3;
      return Object.assign({ p: [side * hp, .925 - d, 0], rx: t[1] * k + off, rf: t[2] * k + off, rb: t[3] * k + off, e: 2, w: an > 0 ? [b + 1, 1 - an, b + 2, an] : [b, 1 - kn, b + 1, kn] }, o); };
    const LD = [-.088, -.07, -.03, .03, .09, .15, .21, .27, .32, .36, .39, .42, .45, .48, .52, .57, .63, .69, .74, .79, .84];
    if (!NB) for (const side of [1, -1]) {
      let dEnd = -1; const inner = (p, d) => 1 - .2 * sm(-(p[0] - side * hp) * side, 0, .06) * sm(d, -.02, .06) * (1 - sm(d, .1, .36));
      if (bot.type === 'jeans' || bot.type === 'trousers') { dEnd = bot.crop ? .7 : .815; const pc = new Piece(bk.cloth), rings = [], open = bot.open === undefined ? .06 : bot.open, off = bot.off || .008;
        for (const d of [-.088, -.07, -.03, .03, .09, .15, .21, .27, .32, .36, .39, .42, .45, .48, .52, .57, .63, .69, .74, .78, .815].filter(d => d < dEnd - .012).concat([dEnd])) { const r = legRing(side, d, off);
          if (d > .44 && open) { const q = sm(d, .44, .6); r.rx = lerp(r.rx, Math.max(r.rx, open), q); r.rf = lerp(r.rf, Math.max(r.rf, open), q); r.rb = lerp(r.rb, Math.max(r.rb, open * 1.04), q); }
          if (d > .34 && d < .5 && off > .004) { const ph = d * 55 + side; r.mod = a => 1 + .04 * sin(a * 3 + ph) * (sin(a) < .3 ? 1 : .35); }
          const fade = bot.fade || 0; r.cf = p => mul(botC, (1 + fade * Math.max(0, p[2] / .09) * (G(d - .2, .15) + .6 * G(d - .44, .05))) * inner(p, d) * (d === dEnd ? .8 : 1));
          if (stripeC) { const cf0 = r.cf; r.cf = p => (abs(p[2]) < .012 && (p[0] - side * hp) * side > 0) ? stripeC : cf0(p); }
          if (d > .7 && bot.stack) { const ph = d * 70; r.mod = a => 1 + .035 * sin(a * 2 + ph); r.rx += .004 * sin(d * 90); }
          rings.push(r); }
        const l = rings[rings.length - 1]; rings.push(Object.assign({}, l, { p: [l.p[0], l.p[1] + .012, 0], rx: l.rx - .014, rf: l.rf - .014, rb: l.rb - .014, mod: null }));
        loft(pc, rings, 12, { col: botC, rough: botR }); pc.end(); }
      else if (bot.type === 'shorts') { dEnd = bot.len || .35; const pc = new Piece(bk.cloth), rings = [], off = bot.off || .018;
        for (const d of [-.088, -.07, -.03, .03, .09, .15, .21, .27, .32, .36, .40].filter(d => d < dEnd - .03).concat([dEnd - .022, dEnd])) { const r = legRing(side, d, off + (d > .1 ? .012 * sm(d, .1, dEnd) * (bot.flare || 1) : 0)); r.w = [side > 0 ? THIGH : THIGH + 3, 1];
          r.cf = p => (stripeC && abs(p[2]) < .012 && (p[0] - side * hp) * side > 0) ? stripeC : mul(botC, inner(p, d) * (d === dEnd ? .78 : 1)); rings.push(r); }
        const l = rings[rings.length - 1]; rings.push(Object.assign({}, l, { p: [l.p[0], l.p[1] + .015, 0], rx: l.rx - .016, rf: l.rf - .016, rb: l.rb - .016 }));
        loft(pc, rings, 12, { col: botC, rough: botR }); pc.end(); }
      if (dEnd < .8) { const pc = new Piece(bk.skin), rings = [], d0 = dEnd < 0 ? -.088 : dEnd - .04, dSh = dEnd > 0 ? dEnd : top_.skirt ? .925 - top_.hem : -1;
        for (const d of LD) if (d >= d0 - .001) rings.push(legRing(side, d, 0, { col: mul(skinC, (dSh > 0 ? 1 - .3 * (1 - sm(d, dSh - .03, dSh + .1)) : 1) * (1 - .12 * G(d - .44, .03))) }));
        loft(pc, rings, 12, { col: skinC, rough: SK, blank: true }); pc.end();
        if (sp.socks) { const ps = new Piece(bk.cloth), rs = []; for (const d of [sp.socks, sp.socks + .01, .74, .79, .84]) rs.push(legRing(side, d, d === sp.socks ? .001 : .005)); loft(ps, rs, 12, { col: lin(sp.sockCol || 0xd9d6cc), rough: .95 }); ps.end(); } }
    }
    /* ---- pelvis, waistband, pockets */
    const bOff = (bot.off || .008) + .002, brief = bot.type === 'brief';
    if (!NB && !top_.skirt) { const pc = new Piece(bk.cloth), rings = [{ p: [0, .786, 0], rx: 0, rf: 0, w: [HIPS, 1] }];
      for (const y of (brief ? [.80, .84, .90, .955, .992] : [.80, .84, .90, .96, 1.02, 1.065])) rings.push(tRing(y, brief ? .004 : (!midriff && y > top_.hem + .01 ? Math.min(bOff, top_.off - .005) : bOff), y < .86 && !brief ? { col: mul(botC, .8) } : null));
      if (brief) { const l = rings[rings.length - 1]; rings.push(Object.assign({}, l, { p: [0, l.p[1] - .006, 0], rx: l.rx - .01, rf: l.rf - .01, rb: l.rb - .01 })); }
      loft(pc, rings, 16, { col: botC, rough: botR }); pc.end();
      if (!brief && (midriff || top_.hem > .98) && !K.belt) { const p2 = new Piece(bk.cloth), wc = bot.band !== undefined ? lin(bot.band) : mul(botC, .74);
        loft(p2, [tRing(1.028, bOff), tRing(1.031, bOff + .006), tRing(1.066, bOff + .006), tRing(1.07, bOff - .004)], 16, { col: wc, rough: bot.band !== undefined ? .5 : botR }); p2.end();
        if (bot.band !== undefined) box(bk.cloth, [0, 1.048, interp(tb, 1.048)[2] + bOff + .008], [.045, .036, .006], lin(0xa8a59a), .3, [HIPS, .6, SPINE, .4]);
        else if (bot.type === 'shorts') for (const s of [-1, 1]) tube(bk.cloth, [[s * .012, 1.05, interp(tb, 1.05)[2] + bOff + .008], [s * .02, 1.0, interp(tb, 1.0)[2] + bOff + .012], [s * .026, .95, interp(tb, .96)[2] + bOff + .012]], .0035, 4, { col: lin(0xd8d4c8), rough: .9, w: [HIPS, 1] }); }
      if (bot.pockets) for (const s of [-1, 1]) box(bk.cloth, [s * .078, .91, surfZb(s * .078, .91) - bOff - .0035], [.088, .096, .004], mul(botC, .8), botR, [HIPS, 1], s * .2, -.08); }

    /* ---- bare skin torso (bare chest, crop top, bikini) */
    if (!NB && midriff) { const pc = new Piece(bk.skin), rings = [];
      for (const y0 of [.97, 1.02, 1.06, 1.1, 1.15, 1.2, 1.25, 1.3, 1.345, 1.39, 1.425, 1.455, 1.487]) { if (y0 < 1 && !brief) continue; const y = y0 > 1.33 ? y0 + ny : y0, r = tRing(y, y0 > 1.47 ? -.004 : 0), mus = bare && !fem ? 1 : 0;
        r.cf = p => mul(skinC, (1 - .13 * sm(abs(p[0]), r.rx * .7, r.rx) * sm(y, 1.05, 1.18) * (1 - sm(y, 1.3, 1.37))) * (1 - mus * .1 * G(y - 1.235, .03) * (p[2] > 0 ? 1 : 0)) * (1 - .1 * G(y - 1.03, .04))); rings.push(r); }
      loft(pc, rings, 16, { col: skinC, rough: SK, blank: true }); pc.end(); }

    /* ---- torso garment */
    const off = top_.off, hem = top_.hem, neckY = (top_.neck || 1.487) + ny;
    const tOff = y => off + (top_.rib ? .012 * G(y - (hem + .055), .035) : 0) + (top_.blouse ? .008 * G(y - (hem + .04), .03) : 0);
    if (!NB && !bare) { const pc = new Piece(topB), rings = [], ys = [];
      if (top_.skirt) for (const y of [hem, hem + .09, hem + .19, hem + .29]) ys.push(y);
      let y = top_.skirt ? .93 : hem; if (!top_.skirt) { ys.push(hem); y = hem + .022; } while (y < 1.29 && y < neckY - .03) { ys.push(y); y += .052; } for (const q of [1.32, 1.375, 1.42, 1.446, 1.468]) if (q + ny < neckY - .012 && q + ny > hem + .02) ys.push(q + ny); ys.push(neckY);
      for (const y of ys) { let r;
        if (top_.skirt && y < .98) { const q = Math.pow((.98 - y) / (.98 - hem), .85), t = interp(tb, .96), fl = top_.flare || 1; r = { p: [0, y, 0], rx: lerp(t[1] + off + .004, .215 * fl, q), rf: lerp(t[2] + off, .15 * fl, q), rb: lerp(t[3] + off, .165 * fl, q), e: 2.2,
          wf: p => { const s = sm(p[0], -.07, .07), lw = sm(.97 - y, 0, .3) * .72; return [HIPS, 1 - lw, THIGH, lw * s, THIGH + 3, lw * (1 - s)]; }, mod: a => 1 + .04 * q * sin(a * 7 + 1) }; if (y === hem) r.col = mul(topC, .82); }
        else { r = tRing(Math.max(y, .9), tOff(y)); r.p = [0, y, 0]; r.w = wT(y); if (y < 1.0) { const q = 1 - sm(y, .935, 1.0), bo = (bot.off || .008) + (bot.type === 'shorts' ? .012 * (bot.flare || 1) * .4 : 0), k = sp.legBulk || sp.bulk; r.rx = Math.max(r.rx, lerp(r.rx, hp + .088 * k + bo + .01, q)); r.rf = Math.max(r.rf, lerp(r.rf, (.092 * k + bo) * 1.1 + .008, q)); r.rb = Math.max(r.rb, lerp(r.rb, (.094 * k + bo) * 1.1 + .006, q)); } if (top_.pocket) r.rf += .012 * G(y - 1.0, .06); if (y === hem && top_.rib) { r.rx -= .008; r.rf -= .008; r.rb -= .008; }
          if (y > hem + .03 && y < 1.2 && off > .012) { const ph = y * 34; r.mod = a => 1 + .02 * sin(a * 5 + ph) + .012 * sin(a * 2 + ph * 1.7); }
          const rx0 = r.rx, edge = (y === hem && !top_.skirt) ? .78 : 1, base = (trimC && (y >= neckY - .001 || y === hem)) ? trimC : topC;
          r.cf = p => mul(base, edge * (1 - .22 * sm(abs(p[0]), rx0 * .7, rx0) * sm(y, 1.05, 1.18) * (1 - sm(y, 1.37, 1.43))) * (p[2] < 0 && abs(p[0]) < .01 ? 1 - .13 * sm(y, .98, 1.12) * (1 - sm(y, 1.36, 1.44)) : 1) * (1 - .08 * (1 - sm(y, hem, hem + .12)))); }
        rings.push(r); }
      const f = rings[0], lp = top_.skirt ? .014 : Math.min(.012, Math.max(.002, off - .012)); rings.unshift(Object.assign({}, f, { p: [0, f.p[1] + lp + .004, 0], rx: f.rx - lp, rf: f.rf - lp, rb: f.rb - lp, mod: null }));
      const l = rings[rings.length - 1]; rings.push(Object.assign({}, l, { p: [0, l.p[1] - .01, 0], rx: l.rx - .016, rf: l.rf - .016, rb: l.rb - .016 }));
      loft(pc, rings, 16, { col: topC, rough: topR }); pc.end(); }
    // bare upper chest / shoulders (tank, dress) + straps
    if (!NB && neckY < 1.44 && !midriff) { const pc = new Piece(bk.skin), rings = []; for (const y of [neckY - .04, neckY, 1.375 + ny, 1.42 + ny, 1.455 + ny, 1.487 + ny]) if (y >= neckY - .041) rings.push(tRing(y, y < neckY ? -.004 : 0)); loft(pc, rings, 16, { col: skinC, rough: SK, blank: true }); pc.end(); }
    if (!NB && neckY < 1.44 && !bare) for (const side of [1, -1]) { const x = side * (top_.strapX || (fem ? .078 : .092)), path = [], yT = 1.452 + ny; const stC = trimC || topC;
      for (const y of [neckY - .02, neckY + .03, yT - .014]) path.push({ p: [x, y, surfZ(x, y) + .0055], n: [0, .2, 1], w: wT(y) });
      path.push({ p: [x, yT + .01, 0], n: [0, 1, 0], w: wT(yT) });
      for (const y of [yT - .014, neckY + .03, neckY - .02]) path.push({ p: [x, y, surfZb(x, y) - .0055], n: [0, .2, -1], w: wT(y) });
      ribbon(topB, path, top_.strap || .02, .0035, { col: stC, rough: topR }); }

    /* ---- arms */
    const armRing = (side, d, off, o) => { const t = interp(ARM_T, d), k = sp.armBulk || sp.bulk, el = sm(d, .255, .325), wr = sm(d, .525, .57), b = side > 0 ? ARM : ARM + 4;
      return Object.assign({ p: [side * sh, sY - d, 0], rx: t[1] * k + off, rf: t[2] * k + off, e: 2, w: wr > 0 ? [b + 1, 1 - wr, b + 2, wr] : [b, 1 - el, b + 1, el] }, o); };
    const slC = top_.slCol !== undefined ? lin(top_.slCol) : topC, slB = top_.slCol !== undefined ? bk.cloth : topB;
    if (!NB) for (const side of [1, -1]) { let dEnd = -1; const so = top_.slOff || .012;
      if (top_.sl === 'long') { dEnd = top_.slEnd || .548; const pc = new Piece(slB), rings = [];
        for (const d of [-.04, -.034, -.017, .018, .07, .12, .17, .22, .255, .29, .325, .36, .41, .46, .50, .526, .548].filter(d => d < dEnd - .012).concat([dEnd])) { const cuff = top_.rib && d > .52, r = armRing(side, d, cuff ? .006 : so * (.35 + .65 * sm(d, -.03, .1)) + (top_.rib ? .008 * G(d - .49, .035) : 0));
          if (d > .2 && d < .38) { const ph = d * 60 + side; r.mod = a => 1 + .05 * sin(a * 3 + ph) * (sin(a) > -.2 ? 1 : .3); } if (d === dEnd) r.col = mul(slC, .8); rings.push(r); }
        const l = rings[rings.length - 1]; rings.push(Object.assign({}, l, { p: [l.p[0], l.p[1] + .01, 0], rx: l.rx - .01, rf: l.rf - .01 }));
        loft(pc, rings, 10, { col: slC, rough: topR }); pc.end(); }
      else if (top_.sl === 'short') { dEnd = top_.slEnd || .165; const pc = new Piece(slB), rings = [];
        for (const d of [-.04, -.034, -.017, .018, .07, .12, .17, .21].filter(d => d < dEnd - .03).concat([dEnd - .018, dEnd])) rings.push(armRing(side, d, so * (.3 + .7 * sm(d, -.03, .12)) + (d === dEnd ? .003 : 0), d === dEnd ? { col: trimC || mul(slC, .78) } : null));
        const l = rings[rings.length - 1]; rings.push(Object.assign({}, l, { p: [l.p[0], l.p[1] + .012, 0], rx: l.rx - .013, rf: l.rf - .013 }));
        loft(pc, rings, 10, { col: slC, rough: topR }); pc.end(); }
      if (dEnd < .5) { const pc = new Piece(bk.skin), rings = [], d0 = dEnd < 0 ? -.04 : dEnd - .035;
        for (const d of [-.04, -.034, -.017, .018, .07, .12, .17, .22, .255, .29, .325, .36, .41, .46, .51, .55]) if (d >= d0 - .001) rings.push(armRing(side, d, 0, { col: mul(skinC, dEnd > 0 ? 1 - .3 * (1 - sm(d, dEnd - .02, dEnd + .08)) : 1) }));
        loft(pc, rings, 10, { col: skinC, rough: SK, blank: true }); pc.end(); }
      if (sp.watch && side > 0) { const pc = new Piece(bk.cloth), rs = []; for (const d of [.5, .503, .522, .525]) rs.push(armRing(side, d, d === .5 || d === .525 ? .001 : .005)); loft(pc, rs, 10, { col: lin(sp.watch === true ? 0x18181a : sp.watch), rough: .35, vary: 0 }); pc.end(); }
      /* hand: palm + four fingers + thumb */
      const gl = sp.gloves !== undefined && sp.gloves !== null, hb = gl ? bk.cloth : bk.skin, hc = gl ? lin(sp.gloves) : skinC, hk = (gl ? 1.14 : 1) * 1.1 * (fem ? .95 : 1), W = [side * sh, sY - .55, 0], hw = [side > 0 ? HAND : HAND + 4, 1], ho = { col: hc, rough: gl ? .7 : SK, w: hw, blank: !gl };
      { const pc = new Piece(hb), rings = [];
        for (const r of [[.016, .021, .027, 0], [-.02, .02, .031, 0], [-.05, .0175, .040, 0], [-.08, .0155, .041, -.002], [-.092, .011, .036, -.003], [-.097, 0, 0, -.003]]) rings.push({ p: [W[0] + side * r[3], W[1] + r[0] * hk, .004], rx: r[1] * hk, rf: r[2] * hk, e: 2.3 });
        loft(pc, rings, 8, ho); pc.end();
        for (const f of [[-.03, .054], [-.0105, .068], [.009, .076], [.0275, .069]]) { const z = .004 + f[0] * hk, y0 = W[1] - .084 * hk, L = f[1] * hk;
          tube(hb, [[W[0], y0, z], [W[0] - side * .005, y0 - L * .5, z + .003], [W[0] - side * .02, y0 - L * .95, z + .004]], [.0098 * hk, .009 * hk, .0076 * hk], 5, ho); }
        tube(hb, [[W[0] - side * .004, W[1] - .022 * hk, .03 * hk], [W[0] - side * .012, W[1] - .062 * hk, .05 * hk], [W[0] - side * .022, W[1] - .1 * hk, .052 * hk]], [.0125 * hk, .011 * hk, .0085 * hk], 6, ho); }
    }

    /* ---- neck + head */
    if (!NB) { const pc = new Piece(sp.mask ? bk.cloth : bk.skin), rings = [], nk = (fem ? .86 : 1) * (1 + (sp.bulk - 1) * .8), y0 = 1.40 + ny, y1 = J[HEAD][1] + .045, nc = sp.mask ? lin(0x0e0e10) : skinC;
      for (let i = 0; i <= 5; i++) { const y = lerp(y0, y1, i / 5), fl = 1 + .5 * (1 - sm(y, y0, y0 + .09)), n1 = sm(y, J[NECK][1] - .03, J[NECK][1] + .03), hd = sm(y, J[HEAD][1] - .035, J[HEAD][1] + .02);
        rings.push({ p: [0, y, lerp(-.006, .016, i / 5)], rx: .056 * nk * fl, rf: .056 * nk * fl, rb: .06 * nk * fl, e: 2, col: mul(nc, i >= 3 ? .8 : 1), w: [CHEST, 1 - n1, NECK, n1 * (1 - hd), HEAD, hd] }); }
      loft(pc, rings, 10, { col: nc, rough: sp.mask ? .9 : SK, blank: !sp.mask }); pc.end(); }
    const hv = p => [HC[0] + p[0] * hs * 1.05, HC[1] + p[1] * hs, HC[2] + p[2] * hs], HW = [HEAD, 1];
    if (!NB) { const pc = new Piece(bk.skin), NC = 24, cell = FACE[sp.face] || 0, cu = (cell % 4) / 4, cvv = 1 - ((cell >> 2) + 1) / 2, maskC = lin(0x0b0b0d), pts = [], idx = {};
      for (let i = 0; i < HEAD_Y.length; i++) { pts.push([]); for (let j = 0; j < NC; j++) { const phi = -PI + TAU * j / NC, a = PI / 2 - (phi - .3 * sin(phi)); pts[i].push(headSurf(a, HEAD_Y[i], 0, true)); } }
      const vert = (i, j, f) => { j %= NC; const key = (i * 64 + j) * 2 + (f ? 1 : 0); if (idx[key] !== undefined) return idx[key]; const p = pts[i][j], q = hv(p);
        return idx[key] = f ? pc.v(q[0], q[1], q[2], cu + (p[0] / .26 + .5) / 4, cvv + (p[1] / .26 + .5) / 2, skinC, sp.mask ? .85 : SK, HW) : pc.v(q[0], q[1], q[2], .003, .997, sp.mask ? maskC : skinC, sp.mask ? .85 : SK, HW); };
      for (let i = 0; i < HEAD_Y.length - 1; i++) for (let j = 0; j < NC; j++) { const j1 = (j + 1) % NC, f = pts[i][j][2] > .014 && pts[i][j1][2] > .014 && pts[i + 1][j][2] > .014 && pts[i + 1][j1][2] > .014;
        pc.quad(vert(i, j, f), vert(i, j + 1, f), vert(i + 1, j + 1, f), vert(i + 1, j, f)); }
      pc.end();
      // nose
      const nc = sp.mask ? maskC : skinC, pn = new Piece(bk.skin), nr = [];
      for (const r of [[.006, 0, 0], [-.002, .0055, .003], [-.016, .0075, .009], [-.03, .0105, .0165], [-.04, .013, .0195], [-.047, .0115, .011], [-.052, 0, 0]]) { const zb = headSurf(PI / 2, r[0], 0, false)[2] - .004, c = hv([0, r[0], zb]); nr.push({ p: c, rx: r[1] * hs, rf: (r[2] + .004) * hs, rb: .003, e: 1.8 }); }
      loft(pn, nr, 8, { col: mul(nc, .97), rough: sp.mask ? .85 : SK, w: HW, blank: true }); pn.end();
      // ears
      if (!sp.noEars) for (const side of [1, -1]) { const pe = new Piece(bk.skin), er = []; for (let i = 0; i <= 5; i++) { const t = i / 5 * 2 - 1, s = Math.sqrt(Math.max(0, 1 - t * t)), y = -.004 + t * .032; er.push({ p: hv([side * (.0755 + .003 * s), y, -.014 - t * .004]), rx: .0085 * s, rf: .011 * s, rb: .018 * s, e: 2 }); }
        loft(pe, er, 6, { col: mul(skinC, .93), rough: SK, w: HW, blank: true }); pe.end(); }
    }
    /* ---- hair: a noisy shell with per-strand colour, plus sheets / tails / braids */
    const hair = sp.hair, rnd = GT.rng('hair' + sp.key), HR = .58, domeHat = !!sp.hat && sp.hat !== 'visor' && sp.hat !== 'headband';
    if (!NB && hair && hair.style !== 'none') { const st = hair, hc = lin(hair.col), pc = new Piece(bk.cloth), N = 22, n = 7, rows = [], hl = [[0, st.f], [.75, st.t], [1.35, st.s], [1.95, st.s2], [2.6, st.b], [PI, st.b]], topY = st.top || .1165, cols = [], puff = st.puff || 0;
      const nz0 = [], nz = []; for (let j = 0; j < N; j++) { nz0.push([]); for (let i = 0; i <= n; i++) nz0[j].push(rnd() * 2 - 1); } for (let j = 0; j < N; j++) { nz.push([]); for (let i = 0; i <= n; i++) nz[j].push(.5 * nz0[j][i] + .25 * (nz0[(j + 1) % N][i] + nz0[(j + N - 1) % N][i])); }
      for (let j = 0; j <= N; j++) cols.push(mul(hc, .78 + .44 * rnd())); cols[N] = cols[0];
      for (let i = 0; i <= n; i++) { const tt = i / n, row = []; for (let j = 0; j <= N; j++) { const a = -PI / 2 + TAU * j / N; let f = abs(a - PI / 2); if (f > PI) f = TAU - f; const yh = interp(hl, f)[1], y = lerp(topY, yh, Math.pow(tt, .85));
          let o = st.th * (st.round ? 1 - Math.pow(tt, 6) : 1 - tt * tt * tt) * (1 + puff * nz[j % N][i] * (i ? 1 : 0)); if (st.fade) o *= 1 - .82 * sm(tt, .3, .62); if (domeHat) o = Math.min(o, lerp(.003, o, sm(.05 - y, 0, .03))); if (st.quiff && !domeHat) o += st.quiff * G(f, .75) * (1 - tt) * (1 - tt); o += .0018;
          const p = headSurf(a, Math.min(y, .1164), o, false); p[1] = y + (topY > .116 && !domeHat ? st.th * (st.round ? 1.15 : 1) * sm(y, .05, .1165) : 0); const q = hv(p); row.push(pc.v(q[0], q[1], q[2], j * .05, tt * .4, mul(cols[j], i === n ? .7 : 1), HR, HW)); } rows.push(row); }
      for (let i = 0; i < n; i++) for (let j = 0; j < N; j++) { const a = -PI / 2 + TAU * (j + .5) / N; let f = abs(a - PI / 2); if (f > PI) f = TAU - f; if (st.fmin && f < st.fmin) continue; pc.quad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]); }
      pc.end();
      if (st.sheet) { const pl = new Piece(bk.cloth), rings = [], k = st.sheet, wv = st.wave || .03, wd = st.wide || 1; for (const r of [[.03, .072, .02, .03, -.07], [-.04, .082, .03, .036, -.078], [-.10, .086, .03, .034, -.082], [-.16, .088, .028, .032, -.088], [-.22, .086, .024, .03, -.098], [-.27, .074, .02, .026, -.104], [-.30, 0, 0, 0, -.105]]) { const yy = r[0] > 0 ? r[0] : r[0] * k, q = hv([0, yy, r[4] * (r[0] > 0 ? 1 : lerp(1, .9 + .1 * k, .6))]), hd = sm(yy, -.14, -.05), ck = 1 - sm(yy, -.22, -.13), ph = r[0] * 40;
          rings.push({ p: q, rx: r[1] * wd, rf: r[2], rb: r[3] * (1 + (wd - 1) * 2), e: 2.4, w: [HEAD, hd, NECK, (1 - hd) * ck, CHEST, (1 - hd) * (1 - ck)], cf: (p, t) => mul(hc, .8 + .3 * abs(sin(t * 37 + ph * .2))), mod: a => 1 + wv * sin(a * 9 + ph) }); }
        loft(pl, rings, 12, { col: mul(hc, .95), rough: HR, vary: 0 }); pl.end(); }
      if (st.style === 'tied') tube(bk.cloth, [[0, .045, -.098], [0, .04, -.132], [0, -.01, -.162], [0, -.08, -.168], [0, -.15, -.15]].map(hv), [.02, .03, .031, .025, .011], 8, { col: mul(hc, .95), rough: HR, w: HW });
      if (st.style === 'pony') tube(bk.cloth, [[0, .075, -.082], [0, .098, -.125], [0, .06, -.172], [0, -.03, -.186], [0, -.12, -.17], [0, -.19, -.15]].map(hv), [.017, .028, .032, .028, .02, .008], 8, { col: mul(hc, .95), rough: HR, w: HW });
      if (!domeHat && (st.style === 'bun' || st.style === 'topknot')) { const up = st.style === 'topknot'; tube(bk.cloth, (up ? [[0, .1, -.05], [0, .135, -.06], [0, .16, -.066]] : [[0, .05, -.09], [0, .062, -.115], [0, .07, -.14]]).map(hv), [.03, .042, .03], 8, { col: mul(hc, .95), rough: HR, w: HW }); }
      if (st.style === 'braids') for (let b = 0; b < 7; b++) { const a = (b - 3) * .33, x = sin(a) * .082, z = -cos(a) * .088 - .004, l = .2 + .06 * rnd(); tube(bk.cloth, [[x * .9, .0, z], [x, -.07, z - .006], [x * 1.04, -.07 - l * .5, z - .012], [x, -.07 - l, z - .004]].map(hv), [.012, .0115, .011, .007], 5, { col: mul(hc, .8 + .3 * rnd()), rough: HR, ws: [HW, [HEAD, .6, NECK, .4], [NECK, .5, CHEST, .5], [CHEST, 1]] }); } }
    /* ---- beard */
    if (!NB && sp.beard) { const pc = new Piece(bk.cloth), bc = lin(sp.beard.col !== undefined ? sp.beard.col : (hair ? hair.col : 0x2a1d15)), th = sp.beard.th || .007, N = 12, ys = [-.03, -.05, -.072, -.094, -.112, -.121], rows = [];
      ys.forEach((y, i) => { const row = []; for (let j = 0; j <= N; j++) { const a = .08 + (PI - .16) * j / N, p = headSurf(a, y, th * (i === 0 ? .25 : i === ys.length - 1 ? .7 : 1) * (1 + .3 * sin(j * 5 + i * 3)), false); if (i === ys.length - 1) p[1] -= sp.beard.len || 0; const q = hv(p); row.push(pc.v(q[0], q[1], q[2], j * .04, i * .04, mul(bc, .82 + .3 * rnd()), HR + .1, HW)); } rows.push(row); });
      for (let i = 0; i < ys.length - 1; i++) for (let j = 0; j < N; j++) { const fr = abs(j + .5 - N / 2); if (i === 1 && fr < 1.2) continue; if (i === 0 && fr < 3.6 && !sp.beard.full) continue; pc.quad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]); }
      pc.end({ out: [0, -.4, 1] }); }
    /* ---- sunglasses / glasses as geometry */
    const hvE = NB ? (p => hv([p[0], p[1] - .0105, p[2] + .002])) : hv;
    if (sp.shades) { const gc = lin(sp.shades === true ? 0x0a0a0c : sp.shades), zs = headSurf(1.12, .004, 0, false)[2];
      for (const s of [1, -1]) { const c = hvE([s * .033, .002, zs + .0085]), n = [s * .2, -.05, .98]; tube(bk.cloth, [[c[0] - n[0] * .002, c[1] - n[1] * .002, c[2] - n[2] * .002], [c[0] + n[0] * .002, c[1] + n[1] * .002, c[2] + n[2] * .002]], [.033 * hs, .031 * hs], 10, { col: gc, rough: .08, w: HW, vary: 0, flat: .7, cap: .04 });
        tube(bk.cloth, [hvE([s * .062, .008, zs + .004]), hvE([s * .0775, .01, .02]), hvE([s * .079, .006, -.03])], .0028, 4, { col: mul(gc, 1.5), rough: .3, w: HW, vary: 0 }); }
      box(bk.cloth, hvE([0, .01, zs + .014]), [.02 * hs, .007, .005], gc, .2, HW); }

    /* ---- headwear */
    const headRing = (y, o, e) => { const out = [], N = 20; e = e || {}; for (let j = 0; j <= N; j++) { const a = j / N * TAU, p = headSurf(a, y, o, false), sc = e.sc || 1; out.push(hv([p[0] * sc, (e.yo !== undefined ? e.yo : y) + (e.tilt || 0) * sin(a), p[2] * sc + (e.dz || 0)])); } out[N] = out[0].slice(); return out; };
    const brim = (y, o, a0, a1, wf, tilt, col, rough) => { const pc = new Piece(bk.cloth), rings = [], N = Math.round(20 * (a1 - a0) / TAU), full = a1 - a0 > 6.2;
      for (let j = 0; j <= N; j++) { const a = a0 + (a1 - a0) * (full ? (j % N) : j) / N, p = headSurf(a, y, o, false), w = wf(a), dx = cos(a), dz = sin(a), ct = cos(tilt), stt = sin(tilt), i0 = hv(p), o0 = hv([p[0] + dx * w * ct, y - w * stt, p[2] + dz * w * ct]);
        rings.push({ pts: [[i0[0], i0[1] + .003, i0[2]], [o0[0], o0[1] + .0025, o0[2]], [o0[0], o0[1] - .0025, o0[2]], [i0[0], i0[1] - .004, i0[2]], [i0[0], i0[1] + .003, i0[2]]] }); }
      loft(pc, rings, 0, { col, rough, w: HW }); pc.end({ out: [0, 1, 0], flip: undefined }); };
    const dome = (rows, col, rough) => { const pc = new Piece(bk.cloth), rings = rows.map(r => ({ pts: headRing(r[0], r[1], r[2]), col: r[3] })); loft(pc, rings, 0, { col, rough, w: HW }); pc.end(); };
    const hat = sp.hat, CAPD = [[.04, .002], [.037, .006], [.07, .007], [.095, .008], [.108, .008], [.108, -.02, { yo: .121 }], [.108, -.04, { yo: .1235, sc: .1 }]];
    if (hat === 'cap_police') { const navy = lin(sp.hatCol !== undefined ? sp.hatCol : 0x151a28), blk = lin(0x0c0c0e);
      dome([[.05, .002], [.047, .007, null, blk], [.07, .008, null, blk], [.0705, .009, { yo: .0705 }], [.085, .016, { yo: .092, tilt: .008 }], [.085, .034, { yo: .118, tilt: .016, dz: .004 }], [.085, .03, { yo: .128, tilt: .014, dz: .004 }], [.085, -.03, { yo: .134, tilt: .01, dz: .004 }], [.085, -.085, { yo: .135, tilt: .01, sc: .2, dz: .004 }]], navy, .8);
      brim(.05, .006, .42, PI - .42, a => .058 * Math.pow(sin((a - .42) / (PI - .84) * PI), .6), .42, blk, .22);
      box(bk.cloth, hv([0, .1, .108]), [.03, .034, .006], lin(0xb89a48), .3, HW, 0, -.2); }
    else if (hat === 'panama' || hat === 'sunhat') { const straw = lin(sp.hatCol !== undefined ? sp.hatCol : 0xcdbf9a), band = lin(sp.hatBand !== undefined ? sp.hatBand : 0x2a2622), wide = hat === 'sunhat';
      dome([[.046, .003], [.043, .008, null, band], [.066, .009, null, band], [.0665, .0095, null], [.095, .012, { yo: .1 }], [.095, .008, { yo: .13, sc: .97 }], [.095, -.014, { yo: .139, sc: .9 }], [.095, -.05, { yo: .131, sc: .6 }], [.095, -.09, { yo: .128, sc: .1 }]], straw, .85);
      brim(.046, .007, 0, TAU, a => (wide ? .1 : .056) + (wide ? .02 : .012) * abs(sin(a)), wide ? .2 : .1, straw, .85); }
    else if (hat === 'hardhat') { const hc = lin(sp.hatCol !== undefined ? sp.hatCol : 0xd8d2c4);
      dome([[.04, .006], [.037, .014], [.07, .017], [.095, .019, { yo: .1 }], [.095, .01, { yo: .125 }], [.095, -.02, { yo: .1375, sc: .85 }], [.095, -.06, { yo: .143, sc: .5 }], [.095, -.09, { yo: .145, sc: .08 }]], hc, .35);
      brim(.04, .013, 0, TAU, a => .012 + .034 * Math.pow(Math.max(0, sin(a)), 2), .22, hc, .35);
      tube(bk.cloth, [[0, .1, .118], [0, .138, .07], [0, .151, 0], [0, .14, -.07], [0, .1, -.12]].map(hv), .009, 5, { col: hc, rough: .35, w: HW }); }
    else if (hat === 'helmet') { const hc = lin(sp.hatCol !== undefined ? sp.hatCol : 0x1a1c20), dk = lin(0x0c0c0e);
      dome([[.03, .008], [.027, .016], [.06, .02], [.09, .022, { yo: .095 }], [.095, .014, { yo: .122 }], [.095, -.016, { yo: .138, sc: .88 }], [.095, -.055, { yo: .146, sc: .5 }], [.095, -.09, { yo: .148, sc: .08 }]], hc, .3);
      brim(.045, .016, .7, PI - .7, a => .03 * Math.pow(sin((a - .7) / (PI - 1.4) * PI), .6), .1, dk, .5);
      for (const s of [1, -1]) tube(bk.cloth, [hv([s * .08, .02, .02]), hv([s * .074, -.05, .03]), hv([s * .04, -.108, .05]), hv([0, -.122, .058])], .004, 4, { col: dk, rough: .7, w: HW, vary: 0 }); }
    else if (hat === 'cap' || hat === 'cap_back') { const hc = lin(sp.hatCol !== undefined ? sp.hatCol : 0x39424e), back = hat === 'cap_back';
      dome(CAPD, hc, .85); tube(bk.cloth, [hv([0, .121, -.004]), hv([0, .129, -.004])], .008, 5, { col: hc, rough: .85, w: HW });
      if (back) brim(.03, .005, PI + .55, TAU - .55, a => .07 * Math.pow(sin((a - PI - .55) / (PI - 1.1) * PI), .55), .05, mul(hc, .9), .7);
      else brim(.042, .005, .5, PI - .5, a => .075 * Math.pow(sin((a - .5) / (PI - 1) * PI), .55), .22, mul(hc, .9), .7); }
    else if (hat === 'bucket') { const hc = lin(sp.hatCol !== undefined ? sp.hatCol : 0xb8b09a); dome(CAPD, hc, .9); brim(.042, .006, 0, TAU, () => .05, .78, mul(hc, .93), .9); }
    else if (hat === 'visor') { const hc = lin(sp.hatCol !== undefined ? sp.hatCol : 0xe6e2d6);
      dome([[.04, .003], [.038, .008], [.07, .008], [.073, .003]], hc, .8); brim(.042, .006, .4, PI - .4, a => .082 * Math.pow(sin((a - .4) / (PI - .8) * PI), .55), .2, hc, .6); }
    else if (hat === 'headband') { dome([[.05, .003], [.048, .0075], [.072, .0075], [.074, .003]], lin(sp.hatCol !== undefined ? sp.hatCol : 0xd8d4c8), .95); }
    else if (hat === 'bandana') { const hc = lin(sp.hatCol !== undefined ? sp.hatCol : 0x8a2a2a);
      dome([[.04, .003], [.037, .0075], [.07, .008], [.095, .008], [.108, .007], [.108, -.02, { yo: .1195 }], [.108, -.04, { yo: .122, sc: .1 }]], hc, .92);
      tube(bk.cloth, [hv([0, .03, -.1]), hv([.01, .01, -.125]), hv([.03, -.04, -.128])], [.014, .012, .004], 5, { col: hc, rough: .92, w: HW }); tube(bk.cloth, [hv([0, .03, -.1]), hv([-.02, .0, -.122]), hv([-.035, -.05, -.118])], [.012, .011, .004], 5, { col: hc, rough: .92, w: HW }); }
    else if (hat === 'beanie') { const hc = lin(sp.hatCol !== undefined ? sp.hatCol : 0x5a3f38);
      dome([[.02, .004], [.017, .013], [.045, .014], [.047, .0105], [.08, .012], [.1, .014], [.1, .01, { yo: .12 }], [.1, -.012, { yo: .136, dz: -.012 }], [.1, -.055, { yo: .141, sc: .12, dz: -.02 }]], hc, .95); }
    if (K.headphones) { const pcx = lin(K.headphones === true ? 0x121214 : K.headphones), up = (sp.hair && sp.hair.th || 0) + .012;
      tube(bk.cloth, [hv([.083, .0, -.012]), hv([.08, .07, -.012]), hv([.05, .112 + up * .7, -.012]), hv([0, .1165 + up, -.012]), hv([-.05, .112 + up * .7, -.012]), hv([-.08, .07, -.012]), hv([-.083, .0, -.012])], .006, 5, { col: pcx, rough: .4, w: HW, vary: 0, flat: 1.8 });
      for (const s of [1, -1]) tube(bk.cloth, [hv([s * .078, -.004, -.014]), hv([s * .1, -.004, -.014])], [.036, .032], 9, { col: pcx, rough: .5, w: HW, vary: 0, cap: .2 }); }
    if (sp.hood) { const pc = new Piece(bk.cloth), rings = [], N = 18, hc = topC;
      for (const r of [[.152, 0, 0, 0, 0], [.143, .046, .055, .055, 0], [.122, .078, .092, .088, 0], [.094, .096, .116, .108, 0], [.062, .104, .118, .118, .5], [.02, .108, .112, .124, .78], [-.03, .108, .104, .124, .86], [-.075, .104, .096, .115, .8], [-.11, .1, .09, .106, .62], [-.142, .1, .088, .1, .3], [-.168, .118, .092, .106, 0], [-.196, .14, .098, .112, 0]]) {
        const y = r[0], om = r[4], pts = [], hd = sm(y, -.13, -.06), ck = 1 - sm(y, -.19, -.13), w = [HEAD, hd, NECK, (1 - hd) * ck, CHEST, (1 - hd) * (1 - ck)];
        for (let j = 0; j <= N; j++) { const a = PI / 2 + om + (TAU - 2 * om) * j / N, cs = se(a, 2.2); pts.push(hv([r[1] * cs[0], y, -.008 + (cs[1] > 0 ? r[2] : r[3]) * cs[1]])); }
        const lip = p => [lerp(p[0], HC[0], .22), p[1], p[2] - .03]; pts.unshift(lip(pts[0])); pts.push(lip(pts[pts.length - 1]));
        rings.push({ pts, w }); }
      loft(pc, rings, 0, { col: hc, rough: topR }); pc.end(); }
    else if (top_.type === 'hoodie') { const pc = new Piece(bk.cloth), rings = [];   // hood down: a roll of cloth behind the neck
      for (const r of [[1.4, .1, .02, .075], [1.435, .118, .03, .105], [1.47, .11, .028, .112], [1.495, .08, .02, .09]]) rings.push({ p: [0, r[0] + ny, -.012], rx: r[1], rf: r[2], rb: r[3], e: 2.2, w: [CHEST, .7, NECK, .3], mod: a => 1 + .05 * sin(a * 6) });
      rings.push({ p: [0, 1.5 + ny, -.03], rx: 0, rf: 0, rb: 0, w: [CHEST, .7, NECK, .3] }); loft(pc, rings, 12, { col: mul(topC, .92), rough: topR }); pc.end(); }

    /* ---- collar, placket + buttons, guayabera pleats + pockets */
    if (!NB && top_.collar) { const pc = new Piece(topB), rings = [], y = neckY, nk = (fem ? .86 : 1) * (1 + (sp.bulk - 1) * .8);
      for (const r of [[y + .016, .06, .06, .065, .002], [y + .021, .068, .07, .072, .002], [y - .012, .104, .084, .09, .0], [y - .018, .09, .072, .082, 0]]) rings.push({ p: [0, r[0], r[4]], rx: r[1] * nk, rf: r[2] * nk, rb: r[3] * nk, e: 2, w: wT(r[0] - .01), mod: a => (sin(a) > .93 ? .86 : 1) });
      loft(pc, rings, 14, { col: mul(trimC || topC, .96), rough: topR }); pc.end(); }
    if (!NB && top_.placket && !bare) { const y0 = top_.placket === true ? hem + .012 : neckY - top_.placket, path = [], n = 6;
      for (let i = 0; i <= n; i++) { const y = lerp(y0, neckY - .022, i / n); path.push({ p: [0, y, surfZ(0, y) + tOff(y) + .0035 + (y < .96 ? .012 * (1 - sm(y, .9, .96)) : 0)], n: [0, 0, 1], w: wT(y) }); }
      ribbon(topB, path, .013, .0025, { col: mul(topC, .9), rough: topR, end: { out: [0, 0, 1] } });
      for (let i = 0; i < n; i++) { const y = lerp(y0, neckY - .022, (i + .5) / n); if (y > .93) box(bk.cloth, [0, y, surfZ(0, y) + tOff(y) + .007], [.011, .011, .003], lin(top_.btn !== undefined ? top_.btn : 0xd8d4c8), .35, wT(y)); } }
    if (!NB && top_.pleats) { for (const s of [1, -1]) for (const fr of [1, -1]) { const x = s * .082, path = []; for (const y of [hem + .02, 1.0, 1.1, 1.2, 1.3, 1.38]) path.push({ p: [x, y, fr > 0 ? surfZ(x, y) + tOff(y) + .003 + (y < .96 ? .012 * (1 - sm(y, .9, .96)) : 0) : surfZb(x, y) - tOff(y) - .003 - (y < .96 ? .012 * (1 - sm(y, .9, .96)) : 0)], n: [0, 0, fr], w: wT(y) });
        ribbon(bk.cloth, path, .011, .003, { col: mul(topC, 1.08), rough: topR, end: { out: [0, 0, fr] } }); }
      for (const s of [1, -1]) for (const y of [1.0, 1.28]) box(bk.cloth, [s * .092, y, surfZ(s * .092, y) + off + .0035], [.062, .068, .004], mul(topC, .93), topR, wT(y), s * .28, -.04); }

    /* ---- shoes */
    const sh_ = sp.shoes, shC = lin(sh_.col), soC = lin(sh_.sole), boot = sh_.type === 'boot', flat = sh_.type === 'flat', sandal = sh_.type === 'sandal' || sh_.type === 'bare';
    if (!NB) for (const side of [1, -1]) { const x0 = side * hp, fw = [side > 0 ? FOOT : FOOT + 3, 1], yb = sandal ? .012 : .02, pc = new Piece(sandal ? bk.skin : bk.cloth), rings = [], ps = new Piece(bk.cloth), sr = [];
      const U = sandal ? [[-.07, 0, .045], [-.064, .022, .075], [-.044, .03, .092], [-.012, .034, .092], [.025, .037, .078], [.07, .041, .058], [.115, .044, .044], [.155, .042, .036], [.184, .032, .03], [.196, 0, .024]]
        : [[-.074, 0, .05], [-.068, .024, .084], [-.046, .035, boot ? .165 : flat ? .078 : .108], [-.012, .0405, boot ? .175 : flat ? .074 : .118], [.025, .0425, boot ? .135 : flat ? .07 : .106], [.07, .046, .084], [.115, .049, .066], [.155, .046, .054], [.186, .034, .044], [.2, 0, .034]];
      for (const r of U) { const cy = (r[2] + yb) / 2, k = boot ? 1.06 : 1; rings.push({ p: [x0, r[1] ? cy : r[2] - .012, r[0] * k], rx: r[1] * k, rf: r[1] ? r[2] - cy : 0, rb: r[1] ? cy - yb : 0, e: 2.5, ax: 'z', col: sandal ? skinC : r[0] > .15 && sh_.toe !== undefined ? lin(sh_.toe) : (sh_.stripe !== undefined && abs(r[0] - .05) < .03 ? lin(sh_.stripe) : shC) }); }
      loft(pc, rings, 10, { col: sandal ? skinC : shC, rough: sandal ? SK : (sh_.rough || .6), w: fw, blank: sandal }); pc.end();
      if (sh_.type !== 'bare') { for (const r of U) { const k = boot ? 1.06 : 1, y0 = sandal ? 0 : .012 * sm(r[0], .12, .2), y1 = yb + (sandal ? .002 : .008), th = r[1] ? (y1 - y0) / 2 : 0; sr.push({ p: [x0, r[1] ? (y0 + y1) / 2 : (sandal ? .007 : .018), r[0] * k * 1.02], rx: r[1] ? r[1] * k + .004 : 0, rf: th, rb: th, e: 4, ax: 'z' }); }
        loft(ps, sr, 10, { col: soC, rough: .8, w: fw }); ps.end(); }
      if (sh_.type === 'sandal') for (const s2 of [1, -1]) tube(bk.cloth, [[x0, .052, .14], [x0 + s2 * .028, .068, .09], [x0 + s2 * .042, .03, .035]], .005, 4, { col: shC, rough: .6, w: fw, vary: 0 });
      else if (!sandal && sh_.laces !== false && !flat) box(bk.cloth, [x0, boot ? .125 : .092, .055], [.03, .012, .07], lin(sh_.lace !== undefined ? sh_.lace : 0xd8d4c8), .9, fw, 0, -.5); }

    /* ---- kind-specific kit */
    if (K.apron) { const pc = new Piece(bk.cloth), ac = lin(K.apron), waist = !!K.apronWaist, ys = (waist ? [.7, .78, .86, .94, 1.0, 1.05] : [.66, .74, .82, .9, .98, 1.06, 1.1, 1.16, 1.24, 1.32, 1.365]), NX = 8, rows = [];
      for (const y of ys) { const hwid = lerp(waist ? .2 : .172, .1, sm(y, 1.06, 1.14)), row = []; for (let i = 0; i <= NX; i++) { const x = (i / NX * 2 - 1) * hwid, z = surfZ(x, Math.max(y, .9)) + off + .008 + (y < .9 ? .004 * sin(x * 40 + y * 30) + .014 : 0), lw = sm(.92 - y, 0, .25) * .5, s = sm(x, -.07, .07), wt = wT(y);
          row.push(pc.v(x, y, z, x * UVS, y * UVS, ac, .9, y < .95 ? [HIPS, 1 - lw, THIGH, lw * s, THIGH + 3, lw * (1 - s)] : wt)); } rows.push(row); }
      for (let r = 0; r < ys.length - 1; r++) for (let i = 0; i < NX; i++) pc.quad(rows[r][i], rows[r][i + 1], rows[r + 1][i + 1], rows[r + 1][i]);
      pc.end({ out: [0, 0, 1] });
      if (!waist) for (const side of [1, -1]) { const x = side * .085, path = [], yT = 1.447 + ny; for (const y of [1.35, 1.41, yT - .008]) path.push({ p: [lerp(x, side * .07, sm(y, 1.35, 1.44)), y, surfZ(x, y) + off + .004], n: [0, .2, 1], w: wT(y) });
        path.push({ p: [side * .066, yT + off + .012, 0], n: [0, 1, 0], w: wT(yT) }); path.push({ p: [side * .04, yT - .005, surfZb(.04, yT) - off - .004], n: [0, .3, -1], w: wT(yT) }); path.push({ p: [0, yT - .012, surfZb(0, yT - .01) - off - .004], n: [0, .3, -1], w: wT(yT), s: [.5, 0, side > 0 ? -.8 : .8] });
        ribbon(bk.cloth, path, .012, .004, { col: ac, rough: .9 }); }
      const yt = waist ? 1.03 : 1.085, pt = new Piece(bk.cloth); loft(pt, [tRing(yt, off + .0085), tRing(yt + .02, off + .0105), tRing(yt + .04, off + .0085)], 16, { col: mul(ac, .8), rough: .9 }); pt.end(); }
    if (K.tag) { const x = .078, y = 1.3 + ny; box(bk.cloth, [x, y, surfZ(x, y) + off + (K.apron && !K.apronWaist ? .016 : .006)], [.062, .022, .005], lin(0xe8e6de), .4, [CHEST, 1], -.1, -.12); box(bk.cloth, [x, y + .007, surfZ(x, y) + off + (K.apron && !K.apronWaist ? .0185 : .0085)], [.062, .006, .002], lin(K.tag), .4, [CHEST, 1], -.1, -.12); }
    if (K.belt) { const pc = new Piece(bk.cloth), bc = lin(0x0d0d0f), y = 1.035, duty = K.belt !== 'plain'; loft(pc, [tRing(y - .03, off + .004, { e: 2.7 }), tRing(y - .027, off + .012, { e: 2.7 }), tRing(y + .022, off + .012, { e: 2.7 }), tRing(y + .025, off + .004, { e: 2.7 })], 16, { col: bc, rough: .42 }); pc.end();
      const t = interp(tb, y), rx = t[1] + off + .012, HWt = [HIPS, .75, SPINE, .25];
      box(bk.cloth, [0, y - .003, t[2] + off + .014], [.05, .04, .008], lin(0x8a8d92), .3, HWt);
      if (duty) { if (K.pistol) { box(bk.cloth, [-(rx + .022), y - .07, -.005], [.045, .16, .1], bc, .4, [HIPS, .6, THIGH + 3, .4], 0, .12);                    // holster
          box(bk.cloth, [-(rx + .024), y + .02, .012], [.03, .06, .05], lin(0x16161a), .5, [HIPS, .7, SPINE, .3], 0, -.25); }            // holstered grip
        box(bk.cloth, [rx + .02, y - .02, -.02], [.04, .1, .065], bc, .5, HWt); tube(bk.cloth, [[rx + .02, y + .03, -.035], [rx + .022, y + .1, -.04]], .005, 4, { col: bc, rough: .5, w: HWt });
        for (const q of [[.085, 1], [-.075, 1], [.06, -1], [-.07, -1], [-.12, -1]]) { const z = q[1] > 0 ? surfZ(q[0], y) + off + .028 : surfZb(q[0], y) - off - .028; box(bk.cloth, [q[0], y - .008, z], [.05, .07, .035], bc, .5, HWt, q[0] * q[1] * 2.5); } } }
    if (K.badge) { const x = .085, y = 1.315; box(bk.cloth, [x, y, surfZ(x, y) + off + .005], [.036, .046, .005], lin(0xc2a654), .28, [CHEST, 1], -.25, -.15);
      box(bk.cloth, [-.085, y + .005, surfZ(.085, y) + off + .004], [.07, .014, .004], lin(0xb8b8b4), .3, [CHEST, 1], .25, -.15);
      for (const side of [1, -1]) box(bk.cloth, [side * (sh + .058), sY - .075, 0], [.006, .07, .06], lin(0x8f7f4a), .7, [side > 0 ? ARM : ARM + 4, 1]);
      if (K.badge !== 'guard') { box(bk.cloth, [.12, 1.405, surfZ(.12, 1.4) + off + .022], [.042, .065, .03], lin(0x0e0e10), .45, [CHEST, 1], -.3, -.5);          // shoulder mic
        const pth = []; for (const y2 of [1.39, 1.3, 1.2, 1.1, 1.05]) { const x2 = lerp(.125, .168, sm(1.39 - y2, 0, .34)); pth.push([x2, y2, surfZ(x2 * .96, y2) + off + .008]); }
        tube(bk.cloth, pth, .0045, 4, { col: lin(0x0c0c0e), rough: .5, ws: [1.39, 1.3, 1.2, 1.1, 1.05].map(wT) }); }
      for (const side of [1, -1]) { const y2 = 1.275, z2 = surfZ(.085, y2) + off; box(bk.cloth, [side * .085, y2, z2 + .001], [.082, .09, .005], mul(topC, .86), topR, [CHEST, 1], -side * .3, -.06); box(bk.cloth, [side * .085, y2 + .034, z2 + .004], [.086, .026, .005], mul(topC, .8), topR, [CHEST, 1], -side * .3, -.06); } }
    if (K.hivis) { const pc = new Piece(bk.cloth), vc = lin(K.hivis), rings = [], o2 = off + .012, sil = lin(0xb9bcbc);
      for (const y of [.925, .935, .99, 1.045, 1.1, 1.16, 1.22, 1.28, 1.33, 1.38, 1.42, 1.447]) { const r = tRing(y, y === .925 ? off : o2); if (y > 1.36) { r.rx -= .02 * sm(y, 1.36, 1.42); } rings.push(r); }
      loft(pc, rings, 16, { col: vc, rough: .7 }); pc.end();
      for (const yb2 of (K.plainVest ? [] : [1.0, 1.12])) { const p2 = new Piece(bk.cloth); loft(p2, [tRing(yb2 - .003, o2), tRing(yb2, o2 + .003), tRing(yb2 + .045, o2 + .003), tRing(yb2 + .048, o2)], 16, { col: sil, rough: .32 }); p2.end(); }
      for (const side of (K.plainVest ? [] : [1, -1])) { const x = side * .095, path = []; for (const y of [1.165, 1.25, 1.33, 1.4, 1.437]) path.push({ p: [x, y, surfZ(x, y) + o2], n: [0, .15, 1], w: wT(y) });
        path.push({ p: [x, 1.452 + o2, 0], n: [0, 1, 0], w: wT(1.45) }); for (const y of [1.437, 1.4, 1.33, 1.25, 1.165]) path.push({ p: [x, y, surfZb(x, y) - o2], n: [0, .15, -1], w: wT(y) });
        ribbon(bk.cloth, path, .022, .003, { col: sil, rough: .32 }); } }
    if (K.bag) { const w = [PROPL, 1], g = J[PROPL], c = [g[0] + .075, g[1] - .3, 0], bc = lin(K.bag), pc = new Piece(bk.cloth), rings = [];
      for (const r of [[-.31, 0, 0, 0], [-.3, .07, .07, .08], [-.27, .112, .105, .12], [-.14, .128, .108, .134], [0, .132, .1, .138], [.14, .128, .108, .134], [.27, .112, .105, .12], [.3, .07, .07, .08], [.31, 0, 0, 0]]) rings.push({ p: [c[0], c[1] + (r[1] ? 0 : -.01), c[2] + r[0]], rx: r[1], rf: r[2], rb: r[3], e: 3, ax: 'z', mod: a => 1 + .02 * sin(a * 4 + r[0] * 30) });
      loft(pc, rings, 12, { col: bc, rough: .82, w }); pc.end();
      ribbon(bk.cloth, [-.27, -.14, 0, .14, .27].map(z => ({ p: [c[0], c[1] + (abs(z) > .2 ? .104 : abs(z) > .1 ? .108 : .1), c[2] + z], n: [0, 1, 0], s: [1, 0, 0], w })), .012, .003, { col: lin(0x4a4c50), rough: .5 });
      for (const sx of [-.06, .06]) tube(bk.cloth, [[c[0] + sx, c[1] + .09, -.13], [c[0] + sx * .6, c[1] + .2, -.07], [g[0], g[1] + .01, -.012], [g[0], g[1] + .01, .012], [c[0] + sx * .6, c[1] + .2, .07], [c[0] + sx, c[1] + .09, .13]], .009, 5, { col: lin(0x101012), rough: .7, w });
      for (const z of [-.2, .2]) { const p2 = new Piece(bk.cloth); loft(p2, [{ p: [c[0], c[1] - .005, z - .016], rx: .133, rf: .111, rb: .139, e: 3, ax: 'z' }, { p: [c[0], c[1] - .005, z + .016], rx: .133, rf: .111, rb: .139, e: 3, ax: 'z' }], 12, { col: lin(0x101012), rough: .7, w }); p2.end(); } }
    if (K.pistol) { const w = [PROPR, 1], g = J[PROPR], gc = lin(0x101113);
      box(bk.cloth, [g[0], g[1] - .002, g[2] - .012], [.03, .06, .11], gc, .5, w, 0, -.2);                 // grip
      box(bk.cloth, [g[0], g[1] - .06, g[2] + .04], [.028, .2, .038], gc, .35, w);                         // slide (points along the fingers)
      box(bk.cloth, [g[0], g[1] - .055, g[2] + .012], [.02, .06, .03], gc, .5, w); }
    let torch = null;
    if (K.torch) { const w = [PROPL, 1], g = J[PROPL], gc = lin(0x141517);
      tube(bk.cloth, [[g[0], g[1] + .06, g[2] + .01], [g[0], g[1] - .06, g[2] + .01], [g[0], g[1] - .075, g[2] + .01], [g[0], g[1] - .11, g[2] + .01]], [.016, .016, .024, .025], 8, { col: gc, rough: .4, w });
      torch = [0, -.118, .01]; }
    if (K.phone) { const w = [PROPR, 1], g = J[PROPR], pcol = lin(K.phone === 1 || K.phone === true ? 0x0c0d10 : K.phone); box(bk.cloth, [g[0] + .02, g[1] + .005, g[2] + .006], [.009, .15, .072], pcol, .22, w); box(bk.cloth, [g[0] + .0255, g[1] + .005, g[2] + .006], [.002, .138, .064], lin(0x05070c), .08, w); }

    /* ---- worn accessories (skinned to the torso, zero extra draw calls) */
    const strapPath = (x, y0, y1, o2, back) => { const path = []; for (const y of [y0, (y0 + 1.437) / 2, 1.4, 1.437]) path.push({ p: [x, y, surfZ(x, y) + o2], n: [0, .15, 1], w: wT(y) }); path.push({ p: [x, 1.455 + o2, 0], n: [0, 1, 0], w: wT(1.45) });
      for (const y of [1.437, 1.4, (y1 + 1.437) / 2, y1]) path.push({ p: [x, y, surfZb(x, y) - o2 - (back || 0) * sm(1.437 - y, 0, .12)], n: [0, .15, -1], w: wT(y) }); return path; };
    if (K.backpack || K.cube) { const cube = !!K.cube, bc = lin(cube ? K.cube : K.backpack), o2 = off + .006, pc = new Piece(bk.cloth), rings = [], hw_ = cube ? .2 : .135, dp = cube ? .15 : .07, y0 = cube ? 1.04 : 1.03, y1 = cube ? 1.47 : 1.42;
      for (const q of [[y0 - .012, .6], [y0, .92], [y0 + .03, 1], [lerp(y0, y1, .5), 1.02], [y1 - .05, 1], [y1 - .012, cube ? .96 : .82], [y1, cube ? .7 : .4]]) { const zc = surfZb(0, Math.min(q[0], 1.4)) - o2 - dp - .004; rings.push({ p: [0, q[0], Math.min(zc, -.11 - dp)], rx: hw_ * q[1], rf: dp * q[1], rb: dp * q[1], e: cube ? 6 : 3.2, w: cube ? [CHEST, 1] : wT(q[0]) }); }
      rings.unshift(Object.assign({}, rings[0], { rx: 0, rf: 0, rb: 0 })); rings.push(Object.assign({}, rings[rings.length - 1], { rx: 0, rf: 0, rb: 0 }));
      loft(pc, rings, 12, { col: bc, rough: cube ? .55 : .85, vary: cube ? .03 : .1 }); pc.end();
      const zb = Math.min(surfZb(0, 1.2) - o2 - dp * 2 - .004, -.11 - dp * 2);
      if (cube) { box(bk.cloth, [0, 1.3, zb - .003], [.26, .12, .004], lin(0xe8e6de), .5, [CHEST, 1]); box(bk.cloth, [0, y1 - .03, zb + dp], [.41, .012, dp * 2 + .01], mul(bc, .7), .5, [CHEST, 1]); }
      else { box(bk.cloth, [0, 1.13, zb - .012], [.19, .15, .03], mul(bc, .85), .85, wT(1.13)); tube(bk.cloth, [[-.03, y1, zb + .05], [0, y1 + .035, zb + .045], [.03, y1, zb + .05]], .006, 4, { col: mul(bc, .6), rough: .7, w: [CHEST, 1] }); }
      for (const side of [1, -1]) ribbon(bk.cloth, strapPath(side * .1, 1.2, 1.3, o2, .03), .017, .004, { col: mul(bc, cube ? .25 : .7), rough: .8 }); }
    if (K.tote) { const bc = lin(K.tote), g = J[PROPR2], w = [PROPR2, 1], pc = new Piece(bk.cloth), rs = [], x = g[0] + .012, yt = g[1] - .2;
      for (const r of [[.0, .012, .15, .8], [-.012, .03, .155, 1], [-.12, .05, .165, 1], [-.24, .058, .17, 1], [-.3, .05, .165, 1], [-.318, .0, .16, 1]]) rs.push({ p: [x, yt + r[0], g[2]], rx: r[1], rf: r[1] ? r[2] : 0, rb: r[1] ? r[2] : 0, e: 4, col: mul(bc, r[3]), mod: a2 => 1 + .03 * sin(a2 * 5 + r[0] * 40) });
      loft(pc, rs, 10, { col: bc, rough: .92, w }); pc.end();
      for (const dz of [-.07, .07]) tube(bk.cloth, [[x, yt - .01, g[2] + dz], [x + .01, yt + .1, g[2] + dz * .5], [g[0] + .02, g[1] - .035, g[2] + dz * .15]], .005, 4, { col: mul(bc, .75), rough: .9, w, vary: 0 }); }
    if (K.sling) { const bc = lin(K.sling), o2 = off + .005, f = [], b = [];
      for (let i = 0; i <= 5; i++) { const t = i / 5, x = lerp(-.11, .15, t), y = lerp(1.43, 1.06, t); f.push({ p: [x, y, surfZ(x, y) + o2], n: [0, 0, 1], s: [.82, .57, 0], w: wT(y) }); b.push({ p: [x, y, surfZb(x, y) - o2], n: [0, 0, -1], s: [.82, .57, 0], w: wT(y) }); }
      ribbon(bk.cloth, f, .014, .003, { col: mul(bc, .7), rough: .7, end: { out: [0, 0, 1] } }); ribbon(bk.cloth, b, .014, .003, { col: mul(bc, .7), rough: .7, end: { out: [0, 0, -1] } });
      tube(bk.cloth, [[-.075, 1.3, surfZ(-.03, 1.26) + o2 + .028], [.065, 1.21, surfZ(.02, 1.24) + o2 + .028]], [.042, .042], 8, { col: bc, rough: .6, w: [CHEST, 1], flat: .62 }); }
    if (K.towel) { const c1 = lin(K.towel), c2 = K.towel2 !== undefined ? lin(K.towel2) : mul(c1, .8),   /* the second band is a darker tone of the towel itself: a blue towel banded with the old default off-white read as a blocky chequer up close (b3 look report) */ o2 = off + .008, x = .115, path = [], ys = [1.05, 1.13, 1.21, 1.29, 1.37, 1.43];
      ys.forEach((y, i) => path.push({ p: [x, y, surfZ(x, y) + o2], n: [0, .1, 1], w: wT(y), col: i % 2 ? c2 : c1 })); path.push({ p: [x, 1.456 + o2, 0], n: [0, 1, 0], w: wT(1.45), col: c1 });
      ys.slice().reverse().forEach((y, i) => path.push({ p: [x, y - .06, surfZb(x, y) - o2], n: [0, .1, -1], w: wT(y), col: i % 2 ? c1 : c2 }));
      ribbon(bk.cloth, path, .062, .007, { col: c1, rough: .98 }); }
    if (K.surf) { const g = J[PROPR2], w = [FORE + 4, 1],   /* on the forearm: the hand bone turns about the arm as it walks */ pc = new Piece(bk.cloth), rs = [], bc = lin(K.surf), st = lin(K.surfStripe !== undefined ? K.surfStripe : 0x2a6f8f), x = g[0] - .058, yc = g[1] + .2, zc = g[2] + .14;   /* PP: a surfboard carried at the side, the hand on its near rail */
      const Q = new T.Quaternion().setFromEuler(new T.Euler(-.56, .24, -.01, 'XYZ')).invert(), pv = new T.Vector3(), piv = new T.Vector3(g[0], g[1], g[2]);   /* the walking forearm's own turn, undone, so the board rides level and along the walk */
      for (const r of [[-.95, .0], [-.94, .15], [-.82, .2], [-.45, .245], [0, .26], [.4, .24], [.68, .185], [.86, .1], [.93, .035], [.95, 0]]) { const rg = { p: [x, yc, zc + r[0]], rx: r[1] ? .028 : 0, rf: r[1], rb: r[1], e: 2.4, ax: 'z' }, str = Math.abs(r[0] - .1) < .05; rs.push({ pts: ringPts(rg, 12).map(q => { pv.set(q[0], q[1], q[2]).sub(piv).applyQuaternion(Q).add(piv); return [pv.x, pv.y, pv.z]; }), col: str ? st : bc }); }
      loft(pc, rs, 12, { col: bc, rough: .35, w, vary: 0 }); pc.end(); }
    if (K.whistle) { tube(bk.cloth, [[-.062, 1.455 + ny, -.035], [-.074, 1.44 + ny, .03], [-.02, 1.3, surfZ(0, 1.3) + off + .006], [.02, 1.3, surfZ(0, 1.3) + off + .006], [.074, 1.44 + ny, .03], [.062, 1.455 + ny, -.035]], .003, 4, { col: lin(0xb3242c), rough: .7, ws: [wT(1.45), wT(1.44), wT(1.3), wT(1.3), wT(1.44), wT(1.45)], vary: 0 });
      box(bk.cloth, [0, 1.285, surfZ(0, 1.285) + off + .012], [.03, .018, .014], lin(K.whistle === true ? 0xd8a020 : K.whistle), .3, wT(1.285)); }
    if (K.guitar) { const A = vnorm([.62, .27, -.05]), V = vnorm(vsub([0, .22, .97], [A[0] * (A[1] * .22 + A[2] * .97), A[1] * (A[1] * .22 + A[2] * .97), A[2] * (A[1] * .22 + A[2] * .97)])), U = vcross(V, A), C0 = [-.085, 1.005, interp(tb, 1.02)[2] + off + .075], w = [CHEST, .55, SPINE, .45];
      const at = (s, u, v) => [C0[0] + A[0] * s + U[0] * (u || 0) + V[0] * (v || 0), C0[1] + A[1] * s + U[1] * (u || 0) + V[1] * (v || 0), C0[2] + A[2] * s + U[2] * (u || 0) + V[2] * (v || 0)];
      const wood = lin(K.guitar === true ? 0xb8803a : K.guitar), side_ = lin(0x4a2a16), dark = lin(0x1c1410), pc = new Piece(bk.cloth), rings = [];
      for (const r of [[-.255, 0, 1], [-.248, .1, 1], [-.2, .162, 1], [-.11, .186, 1], [-.03, .162, 1], [.035, .136, 1], [.1, .146, 1], [.17, .14, 1], [.215, .1, 1], [.23, .03, 1], [.232, .027, 0], [.6, .022, 0], [.612, .036, 0], [.74, .03, 0], [.75, 0, 0]]) { const body = r[2] === 1, th = body ? .046 : .013;
        rings.push({ p: at(r[0], 0, body ? 0 : .03), U, V, rx: r[1], rf: r[1] ? th : 0, rb: r[1] ? th : 0, e: body ? 5 : 3, cf: (p, t) => body ? ((t > .09 && t < .41) ? wood : side_) : (r[0] > .605 ? side_ : dark) }); }
      loft(pc, rings, 12, { col: wood, rough: .28, w, vary: 0 }); pc.end();
      { const p2 = new Piece(bk.cloth), c = at(.06, 0, .0475), pts = ringPts({ p: c, U: A, V: U, rx: .045, rf: .045 }, 10), ctr = p2.v(c[0], c[1], c[2], 0, 0, dark, .9, w), ix = pts.map(q => p2.v(q[0], q[1], q[2], 0, 0, dark, .9, w)); for (let i = 0; i < 10; i++) p2.tri(ctr, ix[i], ix[i + 1]); p2.end({ out: V }); }
      tube(bk.cloth, [at(-.13, -.045, .05), at(-.13, .045, .05)], .006, 4, { col: dark, rough: .5, w, vary: 0 });
      tube(bk.cloth, [at(-.13, 0, .054), at(.61, 0, .047)], .0035, 4, { col: lin(0xc8c4b8), rough: .3, w, vary: 0, flat: 5 });
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) box(bk.cloth, at(.635 + i * .035, s * .036, .03), [.014, .014, .012], lin(0xc8c4b8), .3, w);
      tube(bk.cloth, [at(-.255, 0, 0), [-(interp(tb, 1.0)[1] + off + .02), 1.02, -.02], [-.1, 1.16, surfZb(-.1, 1.16) - off - .012], [.07, 1.38, surfZb(.07, 1.38) - off - .012], [.125, 1.462 + off, 0], [.14, 1.36, surfZ(.14, 1.36) + off + .01], at(.2, .12, -.02)], .011, 4, { col: lin(K.strap !== undefined ? K.strap : 0x2a2420), rough: .8, ws: [w, wT(1.02), wT(1.16), wT(1.38), [CHEST, 1], wT(1.36), w], flat: 2.2 }); }

    /* ---- China edition: printed patches + extra worn kit (all skinned, no extra draw calls beyond the decal / glow buckets) */
    const patch = (cellName, x, y, w, h, back, o2, wf) => { const R = DECAL[cellName]; if (!R) return; const pc = new Piece(bk.decal), NX = 5, NY = 3, rows = [];
      for (let j = 0; j <= NY; j++) { const row = [], yy = y + (j / NY - .5) * h; for (let i = 0; i <= NX; i++) { const xx = x + (i / NX - .5) * w, z = back ? surfZb(xx, yy) - o2 : surfZ(xx, yy) + o2, u = back ? 1 - i / NX : i / NX; row.push(pc.v(xx, yy, z, lerp(R[0], R[2], u), lerp(R[1], R[3], j / NY), WHT, .82, wf || wT(yy))); } rows.push(row); }
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) pc.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]); pc.end({ out: [0, 0, back ? -1 : 1] }); };
    if (hat === 'swimcap') dome([[.022, .002], [.019, .005], [.05, .006], [.085, .006], [.108, .006], [.108, -.02, { yo: .1185 }], [.108, -.04, { yo: .121, sc: .1 }]], lin(sp.hatCol !== undefined ? sp.hatCol : 0xe0661c), .32);
    if (K.patches) for (const q of K.patches) patch(q.cell, q.x || 0, q.y, q.w, q.h, !!q.back, off + (q.o !== undefined ? q.o : (K.hivis ? .019 : (K.apron && !K.apronWaist && !q.back) ? .015 : .0065)));
    if (K.plainVest) for (const s of [1, -1]) for (const q of [[1.03, .09, .1], [1.24, .075, .07]]) { const x = s * .088, z = surfZ(x, q[0]) + off + .016; box(bk.cloth, [x, q[0], z], [q[1], q[2], .014], mul(lin(K.hivis), .9), .8, wT(q[0]), -s * .3, -.04); box(bk.cloth, [x, q[0] + q[2] * .42, z + .004], [q[1] + .004, q[2] * .3, .012], mul(lin(K.hivis), .78), .8, wT(q[0]), -s * .3, -.04); }
    if (K.lapel) { const L = K.lapel, lc = L.col !== undefined ? lin(L.col) : mul(topC, .88), o2 = off + .0045, yB = L.y || 1.17, ys = [0, .25, .5, .75, 1].map(t => lerp(yB + .012, 1.447 + ny, t));
      { const pc = new Piece(bk.cloth), sc = lin(L.shirt !== undefined ? L.shirt : 0xece8dc), rows = ys.map((y, i) => [-1, 1].map(s => { const x = s * .054 * i / 4; return pc.v(x, y, surfZ(x, y) + o2, x * UVS, y * UVS, sc, .82, wT(y)); })); for (let i = 0; i < 4; i++) pc.quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]); pc.end({ out: [0, 0, 1] }); }
      if (L.tie !== undefined) ribbon(bk.cloth, ys.slice(1).map(y => ({ p: [0, y - .012, surfZ(0, y - .012) + o2 + .0025], n: [0, 0, 1], w: wT(y) })), .017, .003, { col: lin(L.tie), rough: .55, end: { out: [0, 0, 1] } });
      for (const s of [1, -1]) ribbon(bk.cloth, [[.062, 1.445 + ny], [.084, 1.38], [.068, 1.29], [.026, yB]].map(q => ({ p: [s * q[0], q[1], surfZ(s * q[0], q[1]) + o2 + .003], n: [0, 0, 1], w: wT(q[1]) })), .027, .0045, { col: lc, rough: topR, end: { out: [0, 0, 1] } });
      if (L.square !== undefined) box(bk.cloth, [.098, 1.305, surfZ(.098, 1.305) + off + .006], [.05, .02, .005], lin(L.square), .7, [CHEST, 1], -.25, -.12); }
    if (K.chain) { const cc = lin(K.chain === true ? 0xd8a82c : K.chain), yb = K.chainY || 1.3, o2 = off + .0095; tube(bk.cloth, [[-.066, 1.462 + ny, -.03], [-.082, 1.44 + ny, .03], [-.052, 1.37, surfZ(-.052, 1.37) + o2], [0, yb, surfZ(0, yb) + o2], [.052, 1.37, surfZ(.052, 1.37) + o2], [.082, 1.44 + ny, .03], [.066, 1.462 + ny, -.03]], K.chainR || .0058, 5, { col: cc, rough: .22, ws: [1.45, 1.44, 1.37, yb, 1.37, 1.44, 1.45].map(wT), vary: 0 }); }
    if (K.lanyard) { const lc = lin(K.lanyard === true ? 0x1d4fa0 : K.lanyard), yb = 1.17, o2 = off + .0075; tube(bk.cloth, [[-.06, 1.46 + ny, -.03], [-.072, 1.44 + ny, .03], [-.03, 1.32, surfZ(-.03, 1.32) + o2], [0, yb, surfZ(0, yb) + o2], [.03, 1.32, surfZ(.03, 1.32) + o2], [.072, 1.44 + ny, .03], [.06, 1.46 + ny, -.03]], .0034, 4, { col: lc, rough: .7, ws: [1.45, 1.44, 1.32, yb, 1.32, 1.44, 1.45].map(wT), vary: 0, flat: 2.2 });
      box(bk.cloth, [0, yb - .045, surfZ(0, yb - .04) + o2 + .004], [.058, .085, .004], lin(0xeceae2), .35, wT(yb - .04)); box(bk.cloth, [0, yb - .03, surfZ(0, yb - .04) + o2 + .0065], [.04, .03, .002], lin(0x3a5a8a), .4, wT(yb - .04)); }
    if (K.armband !== undefined) { const pc = new Piece(bk.cloth), rs = []; for (const d of [.1, .104, .17, .174]) rs.push(armRing(1, d, (top_.slOff || .012) + (d === .1 || d === .174 ? .004 : .0095))); loft(pc, rs, 10, { col: lin(K.armband === true ? 0xc0201a : K.armband), rough: .8, vary: .04 }); pc.end(); }
    if (K.cuffs !== undefined) for (const side of [1, -1]) { const pr_ = K.cuffs === 'print', pc = new Piece(pr_ ? bk.print : bk.cloth), rs = [], cc = pr_ ? lin(0xf2ead8) : lin(K.cuffs);
      for (const d of [.3, .305, .36, .42, .48, .515, .52]) { const r = armRing(side, d, (top_.sl === 'long' ? (top_.slOff || .012) : 0) + (d === .3 || d === .52 ? .004 : .011)); if (d > .31 && d < .5) { const ph = d * 50; r.mod = a => 1 + .05 * sin(a * 4 + ph); } rs.push(r); } loft(pc, rs, 10, { col: cc, rough: .9 }); pc.end(); }
    if (K.fanny !== undefined) { const fc = lin(K.fanny === true ? 0x1c1c20 : K.fanny), y = 1.0, t = interp(tb, y), pcb = new Piece(bk.cloth), o3 = off + (K.apron ? .016 : .006); loft(pcb, [tRing(y - .016, o3), tRing(y - .013, o3 + .006), tRing(y + .013, o3 + .006), tRing(y + .016, o3)], 16, { col: mul(fc, .7), rough: .6 }); pcb.end();
      const pc = new Piece(bk.cloth), rs = [], zc = t[2] + o3 + .03; for (const q of [[-.118, 0, 0], [-.108, .03, .02], [-.06, .048, .036], [.06, .048, .036], [.108, .03, .02], [.118, 0, 0]]) rs.push({ p: [q[0], y - .012, zc], U: [0, 1, 0], V: [0, 0, 1], rx: q[1], rf: q[2], e: 3 });
      loft(pc, rs, 10, { col: fc, rough: .7, w: [HIPS, .7, SPINE, .3] }); pc.end(); box(bk.cloth, [0, y + .014, zc + .03], [.13, .004, .008], lin(0x8a8d92), .35, [HIPS, .7, SPINE, .3]); }
    if (K.earrings) for (const s of [1, -1]) ballGeo(bk.cloth, hv([s * .0795, -.04, -.012]), .0078, lin(K.earrings === true ? 0xd8a82c : K.earrings), .25, HW, { seg: 6 });
    const specsK = K.specs || (NB && (sp.face === 'glasses' || sp.face === 'fglasses') ? 0x1a1a1c : 0);
    if (specsK) { const gc = lin(specsK === true ? 0xb8963a : specsK), zs = headSurf(1.12, .004, 0, false)[2];
      for (const s of [1, -1]) { const pts = []; for (let i = 0; i <= 10; i++) { const a = i / 10 * TAU; pts.push(hvE([s * .033 + cos(a) * .0215, .003 + sin(a) * .0175, zs + .0105 - .004 * Math.max(0, cos(a) * s)])); } tube(bk.cloth, pts, .0019, 4, { col: gc, rough: .3, w: HW, vary: 0 }); tube(bk.cloth, [hvE([s * .0545, .006, zs + .006]), hvE([s * .0775, .01, .02]), hvE([s * .079, .006, -.03])], .0018, 4, { col: gc, rough: .3, w: HW, vary: 0 }); }
      tube(bk.cloth, [hv([-.0115, .008, zs + .0125]), hv([0, .0115, zs + .0145]), hv([.0115, .008, zs + .0125])], .0018, 4, { col: gc, rough: .3, w: HW, vary: 0 }); }
    if (K.goggles) { const gc = lin(K.goggles === true ? 0x1a4a8a : K.goggles), zs = headSurf(PI / 2, .062, 0, false)[2], hr = headRing(.06, .0055); tube(bk.cloth, hr.filter((p, i) => i % 2 === 0).concat([hr[0]]), .0042, 4, { col: lin(0x101012), rough: .6, w: HW, vary: 0, flat: 2.2 });
      for (const s of [1, -1]) { const c2 = hv([s * .03, .062, zs + .006]); tube(bk.cloth, [[c2[0], c2[1], c2[2] - .004], [c2[0], c2[1] + .002, c2[2] + .009]], [.025 * hs, .021 * hs], 8, { col: gc, rough: .1, w: HW, vary: 0, flat: .72, cap: .12 }); } }
    if (K.ears) for (const s of [1, -1]) tube(bk.cloth, [hv([s * .05, .13, -.012]), hv([s * .058, .162, -.014]), hv([s * .064, .192, -.016])], [.021, .014, .004], 6, { col: lin(K.ears === true ? 0xf0b81c : K.ears), rough: .5, w: HW, vary: 0 });
    if (K.screen && K.phone) { const g = J[PROPR]; sheet(bk.glow, 'live', [g[0] + .0272, g[1] + .005, g[2] + .006], [0, 0, -1], [0, 1, 0], .062, .134, [PROPR, 1], { col: [1.2, 1.2, 1.25] }); }
    /** China-edition hand props. In the bind pose the arm hangs: local -Y runs along the fingers, +Z is "up" once the forearm is raised level. */
    const propCN = (name, bone, side, g, w, c, T2, pin) => { const GL = (pts, r, colv, seg) => tube(bk.glow, pts, r, seg || 6, { col: colv, rough: 1, w, vary: 0, blank: true });
      if (name === 'fan') { const fc = lin(K.fanCol !== undefined ? K.fanCol : 0xc8201a), gold = lin(0xe0b030), wood = lin(0x3a2416), R = .31, N = 10, o = [g[0], g[1] - .035, g[2] + .012];
        for (const fz of [1, -1]) { const pc = new Piece(bk.cloth), ctr = pc.v(o[0], o[1], o[2] + fz * .002, 0, 0, wood, .6, w), rg = [[], [], []];
          for (let i = 0; i <= N; i++) { const a = lerp(-1.3, 1.3, i / N), zz = o[2] + (i % 2 ? .008 : -.008) + fz * .002, sh2 = i % 2 ? 1 : .84; [[.34, wood], [.93, mul(fc, sh2)], [1, mul(gold, sh2)]].forEach((q, j) => rg[j].push(pc.v(o[0] + sin(a) * R * q[0], o[1] - cos(a) * R * q[0], zz, i * .12, j * .3, q[1], .75, w))); }
          for (let i = 0; i < N; i++) { pc.tri(ctr, rg[0][i], rg[0][i + 1]); pc.quad(rg[0][i], rg[1][i], rg[1][i + 1], rg[0][i + 1]); pc.quad(rg[1][i], rg[2][i], rg[2][i + 1], rg[1][i + 1]); } pc.end({ out: [0, 0, fz] }); } }
      else if (name === 'cane') { const x = g[0] + pin * .012, wc = K.caneCol !== undefined ? K.caneCol : 0x33200f; T2([[x, g[1] + .0, g[2] + .012], [x, g[1] - .36, g[2] + .03], [x, g[1] - .7, g[2] + .05]], [.0115, .0105, .009], wc, .35, 6); T2([[x, g[1] + .0, g[2] + .012], [x, g[1] + .035, g[2] - .005], [x, g[1] + .04, g[2] - .05], [x, g[1] + .012, g[2] - .085]], [.012, .0125, .012, .01], wc, .35, 6);
        T2([[x, g[1] - .7, g[2] + .05], [x, g[1] - .735, g[2] + .052]], [.0105, .01], 0xb8963a, .3, 6); T2([[x, g[1] - .02, g[2] + .013], [x, g[1] - .04, g[2] + .014]], [.0128, .0128], 0xb8963a, .3, 6); }
      else if (name === 'bowl') { T2([[c[0], c[1], c[2] - .005], [c[0], c[1], c[2] + .03], [c[0], c[1], c[2] + .07]], [.036, .064, .08], K.bowlCol !== undefined ? K.bowlCol : 0xe9e6dc, .28, 12); T2([[c[0], c[1], c[2] + .064], [c[0], c[1], c[2] + .075]], [.072, .066], K.foodCol !== undefined ? K.foodCol : 0xc79a48, .85, 10); T2([[c[0], c[1], c[2] + .067], [c[0], c[1], c[2] + .072]], [.0805, .0805], 0x2c4a8a, .3, 12); }
      else if (name === 'chopsticks') { for (const dx of [0, .011]) T2([[g[0] + dx * pin, g[1] - .0, g[2] + .03], [g[0] + pin * .02 + dx * pin * .3, g[1] - .2, g[2] + .12]], [.0034, .0026], 0xb89a5a, .6, 4); }
      else if (name === 'selfie') { T2([[g[0], g[1] + .05, g[2] + .012], [g[0], g[1] - .07, g[2] + .012]], .0135, 0x18181a, .7, 6); T2([[g[0], g[1] - .07, g[2] + .012], [g[0], g[1] - .6, g[2] + .012]], .0055, 0xb8bcc0, .3, 5); box(bk.cloth, [g[0], g[1] - .612, g[2] + .012], [.05, .02, .04], lin(0x18181a), .5, w);
        box(bk.cloth, [g[0], g[1] - .628, g[2] + .03], [.078, .011, .158], lin(K.phoneCol !== undefined ? K.phoneCol : 0xe8c8d0), .3, w); sheet(bk.glow, 'live', [g[0], g[1] - .6215, g[2] + .03], [-1, 0, 0], [0, 0, 1], .07, .148, w, { col: [1.25, 1.25, 1.3] }); }
      else if (name === 'gimbal') { T2([[c[0], c[1], c[2] - .09], [c[0], c[1], c[2] + .08]], [.017, .015], 0x1c1c20, .6, 8); T2([[c[0], c[1], c[2] + .08], [c[0] + .05, c[1], c[2] + .12], [c[0] + .05, c[1], c[2] + .17]], .009, 0x2a2c30, .4, 5); box(bk.cloth, [c[0], c[1] - .012, c[2] + .185], [.158, .011, .078], lin(0x101114), .3, w);
        sheet(bk.glow, 'white', [c[0], c[1] - .0055, c[2] + .185], [-1, 0, 0], [0, 0, 1], .148, .07, w, { col: [.5, .9, 1.25] }); GL([[c[0] - .06, c[1] - .019, c[2] + .2], [c[0] - .06, c[1] - .021, c[2] + .2]], [.006, .006], [2.6, .2, .15], 5); }
      else if (name === 'flag') { T2([[c[0], c[1], c[2] - .1], [c[0], c[1], c[2] + .7], [c[0], c[1], c[2] + 1.22]], [.008, .0065, .005], 0xc8ccd0, .3, 5); T2([[c[0], c[1], c[2] - .1], [c[0], c[1], c[2] + .03]], .013, 0x18181a, .8, 6); sheet(bk.decal, 'tour', [c[0] - pin * .185, c[1], c[2] + 1.09], [1, 0, 0], [0, 0, 1], .36, .24, w, { two: true, rough: .85 }); }
      else if (name === 'paper') { sheet(bk.decal, K.paperCell || 'ad1', [c[0] - pin * .02, c[1] - .03, c[2] + .12], [1, 0, 0], [0, 0, 1], .215, .3, w, { two: true, rough: .6 }); }
      else if (name === 'birdcage') { const x = g[0] + pin * .01, z = g[2] + .015, yT = g[1] - .1, yB = g[1] - .39, R = .1, wd = K.cageCol !== undefined ? K.cageCol : 0x6a4424; T2([[x, g[1] - .0, z], [x, g[1] - .05, z], [x + .018, g[1] - .075, z], [x, yT, z]], .0045, 0xb8963a, .3, 4);
        T2([[x, yT + .012, z], [x, yT - .04, z]], [.02, R * 1.02], wd, .5, 12); T2([[x, yB + .012, z], [x, yB - .012, z]], [R * 1.05, R * 1.05], wd, .5, 12); T2([[x, yT - .04, z], [x, yT - .13, z]], [R * 1.04, R * 1.05], K.coverCol !== undefined ? K.coverCol : 0x2c4a7a, .92, 12);
        for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; T2([[x + cos(a) * R, yT - .12, z + sin(a) * R], [x + cos(a) * R, yB + .01, z + sin(a) * R]], .0022, 0xc8a868, .5, 3); } T2([[x - R * .8, yB + .1, z], [x + R * .8, yB + .1, z]], .004, wd, .6, 4); ballGeo(bk.cloth, [x + .01, yB + .128, z], .024, lin(0xd8b02c), .7, w, { seg: 6 }); ballGeo(bk.cloth, [x + .01, yB + .155, z + .018], .014, lin(0x3a3a34), .7, w, { seg: 6 }); }
      else if (name === 'whip') { T2([[g[0], g[1] + .05, g[2] + .012], [g[0], g[1] - .5, g[2] + .03]], [.013, .007], 0x5a3a20, .6, 5); T2([[g[0], g[1] - .5, g[2] + .03], [g[0] - pin * .1, g[1] - .85, g[2] + .2], [g[0], g[1] - 1.12, g[2] + .6], [g[0] + pin * .08, g[1] - 1.18, g[2] + 1.05], [g[0], g[1] - 1.05, g[2] + 1.45]], [.006, .005, .0045, .004, .003], 0x2a2018, .8, 3); }
      else if (name === 'baton') { T2([[g[0], g[1] + .05, g[2] + .012], [g[0], g[1] - .08, g[2] + .012]], .015, 0x121214, .6, 6); GL([[g[0], g[1] - .08, g[2] + .012], [g[0], g[1] - .36, g[2] + .012]], .017, [2.6, .25, .12], 6); T2([[g[0], g[1] - .36, g[2] + .012], [g[0], g[1] - .375, g[2] + .012]], [.018, .014], 0x121214, .6, 6); }
      else if (name === 'thermos') { T2([[c[0], c[1], c[2] - .075], [c[0], c[1], c[2] + .07]], [.031, .031], K.thermosCol !== undefined ? K.thermosCol : 0x8a9098, .25, 10); T2([[c[0], c[1], c[2] + .07], [c[0], c[1], c[2] + .105]], [.028, .026], 0x18181a, .5, 10); }
      else if (name === 'ladle') { T2([[c[0], c[1], c[2] - .07], [c[0], c[1], c[2] + .06]], .011, 0x5a3a20, .7, 6); T2([[c[0], c[1], c[2] + .06], [c[0], c[1], c[2] + .4]], .005, 0xb8bcc0, .3, 5); T2([[c[0], c[1] - .0, c[2] + .4], [c[0], c[1] - .03, c[2] + .425], [c[0], c[1] - .06, c[2] + .43]], [.03, .05, .052], 0xb8bcc0, .28, 9); }
      else if (name === 'tongs') { for (const dx of [-.012, .012]) T2([[c[0], c[1], c[2] - .06], [c[0] + dx * .6, c[1], c[2] + .12], [c[0] + dx, c[1], c[2] + .3]], .0042, 0xb8bcc0, .3, 4, 2.2); }
      else if (name === 'pipe') { T2([[g[0], g[1] + .07, g[2] + .012], [g[0], g[1] - .5, g[2] + .025]], .0135, 0x7c8086, .35, 6); T2([[g[0], g[1] + .07, g[2] + .012], [g[0], g[1] - .06, g[2] + .014]], .0155, 0x1a1a1c, .9, 6); }
      else if (name === 'plasticbag') { const pc = new Piece(bk.cloth), rs = [], x = g[0] + pin * .012, bc = lin(K.bagCol !== undefined ? K.bagCol : 0xc64a40); for (const q of [[-.02, .008], [-.07, .03], [-.14, .075], [-.23, .1], [-.3, .085], [-.335, 0]]) rs.push({ p: [x, g[1] + q[0], g[2] + .012], rx: q[1], rf: q[1] * .8, e: 2.4, mod: a => 1 + .08 * sin(a * 5 + q[0] * 40) });
        loft(pc, rs, 10, { col: bc, rough: .32, w, vary: .12 }); pc.end(); for (const d of [-.03, .02]) T2([[x + d, g[1] - .12, g[2] + .012 + d], [x + d * 3, g[1] + .06, g[2] + .1 + d]], [.008, .005], 0x4a8a3a, .7, 4); } };
    /* ---- hand props: left hand = role prop (PROPL), right = phone (PROPR) or a second role prop (PROPR2) */
    const handProp = (name, bone, side) => { if (!name) return; const g = J[bone], w = [bone, 1], pin = -side, c = [g[0] + pin * .036, g[1] - .028, g[2]], T2 = (pts, r, col, rough, seg, fl) => tube(bk.cloth, pts, r, seg || 8, { col: lin(col), rough, w, vary: 0, flat: fl, cap: Array.isArray(r) && r[0] > .02 ? .06 : .5 });
      if (name === 'cup' || name === 'coffee') { const coffee = name === 'coffee'; T2([[c[0], c[1], c[2] - .05], [c[0], c[1], c[2] + .065]], [.029, .038], coffee ? 0xe6e2d8 : (K.cupCol !== undefined ? K.cupCol : 0xb3262c), .5, 10); T2([[c[0], c[1], c[2] + .068], [c[0], c[1], c[2] + .076]], [.04, .04], coffee ? 0x2a2420 : 0xe8e6e0, .4, 10);
        if (coffee) T2([[c[0], c[1], c[2] - .02], [c[0], c[1], c[2] + .03]], [.0335, .0365], 0x8a6a48, .9, 10); else T2([[c[0] + .012, c[1], c[2] + .07], [c[0] + .02, c[1] + .004, c[2] + .16]], .0035, 0xe8e6e0, .4, 4); }
      else if (name === 'can') { T2([[c[0], c[1], c[2] - .05], [c[0], c[1], c[2] + .058]], [.031, .031], K.canCol !== undefined ? K.canCol : 0x2a6a8a, .3, 10); T2([[c[0], c[1], c[2] + .058], [c[0], c[1], c[2] + .064]], [.027, .027], 0xb8bcc0, .25, 10); }
      else if (name === 'bottle') { T2([[c[0], c[1], c[2] - .065], [c[0], c[1], c[2] + .04], [c[0], c[1], c[2] + .075], [c[0], c[1], c[2] + .145]], [.03, .03, .014, .0125], K.bottleCol !== undefined ? K.bottleCol : 0x4a2a10, .12, 10); T2([[c[0], c[1], c[2] - .03], [c[0], c[1], c[2] + .02]], [.0308, .0308], 0xd8d0b8, .7, 10); }
      else if (name === 'cig') { const x = g[0] + pin * .012, y = g[1] - .102; T2([[x, y, g[2] + .02], [x, y, g[2] + .088]], .0038, 0xe8e4da, .8, 5); T2([[x, y, g[2] + .088], [x, y, g[2] + .096]], .0038, 0xd0602a, .6, 5); T2([[x, y, g[2] + .0], [x, y, g[2] + .022]], .0039, 0xb8894a, .8, 5); }
      else if (name === 'ball') ballGeo(bk.cloth, [g[0] + pin * .125, g[1] - .03, g[2] + .02], .12, lin(0xb8561e), .75, w, { band: lin(0x1c1410) });
      else if (name === 'dumbbell') { T2([[c[0], c[1], c[2] - .1], [c[0], c[1], c[2] + .1]], .013, 0x8a8d92, .35, 6); for (const s of [-1, 1]) T2([[c[0], c[1], c[2] + s * .075], [c[0], c[1], c[2] + s * .13]], [.055, .055], 0x18181a, .6, 10); }
      else if (name === 'spatula') { T2([[c[0], c[1], c[2] - .05], [c[0], c[1], c[2] + .12]], .008, 0x18181a, .5, 5); T2([[c[0], c[1], c[2] + .12], [c[0], c[1], c[2] + .25]], .004, 0xb8bcc0, .3, 4); box(bk.cloth, [c[0], c[1], c[2] + .3], [.004, .07, .1], lin(0xb8bcc0), .3, w); }
      else if (name === 'rag') { const pc = new Piece(bk.cloth), rs = []; for (const r of [[.0, .03], [-.05, .045], [-.12, .05], [-.2, .03], [-.22, 0]]) rs.push({ p: [c[0], c[1] + r[0], c[2]], rx: r[1] * .5, rf: r[1], e: 2, mod: a => 1 + .2 * sin(a * 4 + r[0] * 30) }); loft(pc, rs, 8, { col: lin(K.ragCol !== undefined ? K.ragCol : 0xd8d4c8), rough: .98, w }); pc.end(); }
      else if (name === 'tray') { box(bk.cloth, [g[0], g[1] - .05, g[2] + .05], [.3, .012, .4], lin(0x6a4a2a), .5, w); } else propCN(name, bone, side, g, w, c, T2, pin); };
    if (K.propL) handProp(K.propL, PROPL, 1);
    if (K.propR2) handProp(K.propR2, PROPR2, -1);

    /* ---- free prop on the AUX bone (origin = the bone; the pose moves it) */
    const X = K.aux, AW = [AUX, 1], AT = (pts, r, col, rough, seg, fl) => tube(bk.cloth, pts, r, seg || 8, { col: lin(col), rough, w: AW, vary: 0, flat: fl, cap: Array.isArray(r) && r[0] > .02 ? .06 : .5 });
    if (X === 'ball') ballGeo(bk.cloth, [0, 0, 0], .12, lin(0xb8561e), .75, AW, { band: lin(0x1c1410) });
    else if (X === 'box') { const cc = lin(K.boxCol !== undefined ? K.boxCol : 0xa8875a); box(bk.cloth, [0, 0, 0], [.44, .3, .32], cc, .92, AW); box(bk.cloth, [0, .152, 0], [.445, .004, .06], mul(cc, 1.25), .5, AW); box(bk.cloth, [0, .02, .162], [.12, .08, .003], lin(0xe8e6de), .6, AW); }
    else if (X === 'board') { const dc = lin(K.boardCol !== undefined ? K.boardCol : 0x2a2a2c), pc = new Piece(bk.cloth), rs = [];
      for (const r of [[-.41, .0, .14], [-.4, .06, .138], [-.33, .098, .112], [-.26, .102, .1], [.26, .102, .1], [.33, .098, .112], [.4, .06, .138], [.41, 0, .14]]) rs.push({ p: [0, r[2], r[0]], rx: r[1], rf: r[1] ? .007 : 0, rb: r[1] ? .007 : 0, e: 4, ax: 'z', cf: (p, t) => (t > .05 && t < .45) ? dc : lin(0x9a7a4a) });
      loft(pc, rs, 10, { col: dc, rough: .95, w: AW, vary: 0 }); pc.end();
      for (const z of [-.22, .22]) { box(bk.cloth, [0, .075, z], [.06, .03, .05], lin(0x9a9da2), .35, AW); AT([[-.1, .055, z], [.1, .055, z]], .006, 0x9a9da2, .35, 5); for (const s of [-1, 1]) AT([[s * .075, .028, z], [s * .115, .028, z]], [.028, .028], K.wheelCol !== undefined ? K.wheelCol : 0xd8d0b0, .6, 8); } }
    else if (X === 'scooter') { const fc = K.scooterCol !== undefined ? K.scooterCol : 0x1e2024; box(bk.cloth, [0, .13, -.02], [.15, .035, .56], lin(fc), .5, AW); box(bk.cloth, [0, .15, -.02], [.13, .004, .46], lin(0x0c0c0e), .95, AW);
      AT([[0, .13, .26], [0, .2, .36], [0, .3, .385]], .022, fc, .45, 6); AT([[0, .3, .385], [0, 1.0, .29]], .019, fc, .45, 6); AT([[-.25, 1.02, .285], [.25, 1.02, .285]], .014, 0x0c0c0e, .6, 6); for (const s of [-1, 1]) AT([[s * .17, 1.02, .285], [s * .26, 1.02, .285]], [.018, .018], 0x0c0c0e, .9, 6);
      box(bk.cloth, [0, .98, .31], [.07, .045, .03], lin(0x0c0c0e), .4, AW); box(bk.cloth, [0, .93, .318], [.04, .03, .012], lin(0xe8e6da), .2, AW);
      for (const z of [.44, -.33]) { AT([[-.022, .105, z], [.022, .105, z]], [.105, .105], 0x0e0e10, .9, 12); AT([[-.026, .105, z], [.026, .105, z]], [.05, .05], 0x9a9da2, .4, 8); }
      for (const s of [-1, 1]) AT([[s * .03, .3, .385], [s * .03, .105, .44]], .008, fc, .45, 4); box(bk.cloth, [0, .225, -.33], [.07, .012, .2], lin(fc), .5, AW, 0, .25); box(bk.cloth, [0, .2, -.44], [.04, .02, .01], lin(0xb3242c), .3, AW); }
    else if (X === 'barbell') { AT([[-.95, 0, 0], [.95, 0, 0]], .0135, 0xa8abb0, .3, 6); for (const s of [-1, 1]) { AT([[s * .62, 0, 0], [s * .67, 0, 0]], [.2, .2], K.plateCol !== undefined ? K.plateCol : 0x18191c, .7, 14); AT([[s * .675, 0, 0], [s * .715, 0, 0]], [.16, .16], 0x2a2c30, .7, 12); AT([[s * .72, 0, 0], [s * .76, 0, 0]], [.03, .03], 0xa8abb0, .3, 6); } }
    else if (X === 'broom') { AT([[0, .1, 0], [0, 1.42, 0]], .0125, 0xa87a48, .7, 6); box(bk.cloth, [0, .1, 0], [.34, .05, .06], lin(0x7a2a22), .6, AW); const pc = new Piece(bk.cloth), rs = [];
      for (const r of [[.085, .165, .028], [.04, .18, .04], [0, .2, .05]]) rs.push({ p: [0, r[0], 0], rx: r[1], rf: r[2], e: 4, mod: a => 1 + .06 * sin(a * 23) }); rs.push({ p: [0, -.004, 0], rx: 0, rf: 0 }); loft(pc, rs, 12, { col: lin(0xc8a85a), rough: .95, w: AW }); pc.end(); }
    else if (X === 'rod') { AT([[0, 0, -.22], [0, 0, .12]], [.016, .014], 0x6a4a2a, .9, 6); AT([[0, 0, .12], [0, 0, 1.2], [0, .0, 2.7]], [.009, .006, .0028], 0x1a1c20, .3, 5); box(bk.cloth, [0, -.045, .05], [.035, .06, .06], lin(0x9a9da2), .3, AW); AT([[.02, -.045, .05], [.06, -.045, .05]], .006, 0x18181a, .5, 4);
      const th = .55; AT([[0, 0, 2.7], [0, -cos(th) * 1.6, 2.7 - sin(th) * 1.6], [0, -cos(th) * 3.4, 2.7 - sin(th) * 3.4]], .0022, 0xd8dce0, .4, 3); }

    /* ---- China edition free props on the AUX bone. ks rescales to real metres for short figures (kids). */
    const ks = top / sp.height, AB = (c, sz, col, rough, ry, rx) => box(bk.cloth, c, sz, lin(col), rough, AW, ry, rx), wheel = (x, y, z, r, wd, tyre, hub) => { AT([[x - wd, y, z], [x + wd, y, z]], [r, r], tyre === undefined ? 0x0e0e10 : tyre, .9, 12); AT([[x - wd - .004, y, z], [x + wd + .004, y, z]], [r * .5, r * .5], hub === undefined ? 0x9a9da2 : hub, .4, 8); };
    if (X === 'bbroom') { AT([[0, .3, 0], [0, 1.15, .004], [0, 1.98, 0]], [.017, .015, .0125], 0xb89a50, .55, 6); for (const y of [.62, 1.0, 1.4, 1.78]) AT([[0, y - .007, 0], [0, y + .007, 0]], [.0185, .0185], 0x8a7438, .6, 6);
      const pc = new Piece(bk.cloth), rs = []; for (const r of [[.56, .035, .035], [.44, .06, .05], [.3, .15, .075], [.14, .26, .1], [.02, .34, .12]]) rs.push({ p: [0, r[0], 0], rx: r[1], rf: r[2], e: 3, mod: a => 1 + .09 * sin(a * 19 + r[0] * 30) + .05 * sin(a * 7), cf: (p, t) => mul(lin(0x8f7c46), .75 + .4 * abs(sin(t * 61 + r[0] * 9))) }); rs.push({ p: [0, -.01, 0], rx: .0, rf: .0 });
      loft(pc, rs, 16, { col: lin(0x8f7c46), rough: .95, w: AW, vary: 0 }); pc.end(); for (const y of [.5, .38]) AT([[0, y - .008, 0], [0, y + .008, 0]], [y > .45 ? .05 : .085, y > .45 ? .05 : .085], 0x3a6a3a, .7, 8, y > .45 ? 1 : .6); }
    else if (X === 'pole' || X === 'pole_load') { AT([[0, 0, -.78], [0, .012, 0], [0, 0, .78]], [.021, .023, .021], 0xb8a058, .5, 6); for (const z of [-.52, -.26, 0, .26, .52]) AT([[0, 0, z - .006], [0, 0, z + .006]], [.0245, .0245], 0x8a7438, .6, 6);
      const ring = (z, r, y0) => { const pts = []; for (let i = 0; i <= 10; i++) { const a = i / 10 * TAU; pts.push([cos(a) * r * .5, y0 - r + sin(a) * r * 1.0 + r, z + sin(a * 2) * .012]); } AT(pts.map(p => [p[0], p[1] - r, p[2]]), .0075, 0x9a8a62, .9, 4); };
      if (X === 'pole') { ring(-.5, .12, .02); ring(-.47, .13, .02); ring(-.44, .115, .02); AT([[0, 0, .7], [.0, -.05, .72], [.02, -.09, .7]], .006, 0x6a6e74, .4, 4); }
      else { for (const s of [-1, 1]) { const z = s * .62; for (const dx of [-.07, .07]) AT([[0, .0, z], [dx, -.3, z], [dx * 1.6, -.5, z]], .006, 0x9a8a62, .9, 3); }
        { const pc = new Piece(bk.cloth), rs = [], z = .62; for (const r of [[-.86, 0, 0], [-.84, .1, .08], [-.74, .2, .16], [-.6, .22, .18], [-.48, .16, .13], [-.44, .05, .05], [-.43, 0, 0]]) rs.push({ p: [0, r[0], z], rx: r[1], rf: r[2], e: 2.6, mod: a => 1 + .04 * sin(a * 6 + r[0] * 20), cf: (p, t) => (Math.floor(t * 24) % 6 === 0) ? lin(0xb83a34) : (Math.floor(t * 24) % 6 === 3) ? lin(0x2a5aa8) : lin(0xd6d0c0) }); loft(pc, rs, 12, { col: lin(0xd6d0c0), rough: .8, w: AW, vary: .06 }); pc.end(); }
        AB([0, -.66, -.62], [.4, .32, .3], 0xa8875a, .92, .2); AB([0, -.498, -.62], [.405, .004, .06], 0xc8a878, .5, .2); AB([0, -.86, -.62], [.36, .1, .26], 0x7a6a4a, .9, -.15); } }
    else if (X === 'trolley') { const tc = K.trolleyCol !== undefined ? K.trolleyCol : 0x3a5a7a; for (const s of [-1, 1]) wheel(s * .17, .075, 0, .075, .016); AT([[-.17, .075, 0], [.17, .075, 0]], .008, 0x8a8d92, .4, 5);
      { const pc = new Piece(bk.cloth), rs = []; for (const r of [[.1, .13, .09], [.13, .16, .11], [.4, .165, .115], [.62, .16, .11], [.66, .1, .07]]) rs.push({ p: [0, r[0], .05], rx: r[1], rf: r[2], e: 4, cf: (p, t) => (Math.floor(t * 16) % 4 === 0) ? mul(lin(tc), 1.5) : (p[1] > .5 ? mul(lin(tc), .8) : lin(tc)), mod: a => 1 + .02 * sin(a * 5 + r[0] * 20) }); rs.unshift({ p: [0, .09, .05], rx: 0, rf: 0 }); rs.push({ p: [0, .665, .05], rx: 0, rf: 0 }); loft(pc, rs, 12, { col: lin(tc), rough: .9, w: AW }); pc.end(); }
      for (const s of [-1, 1]) AT([[s * .13, .08, -.045], [s * .13, .62, -.07], [s * .12, .98, -.1]], .009, 0x9a9da2, .35, 5); AT([[-.12, .98, -.1], [.12, .98, -.1]], .012, 0x18181a, .8, 6); AB([0, .06, .14], [.24, .012, .1], 0x8a8d92, .4);
      for (const q of [[-.06, .02], [.03, .06], [.08, -.01]]) AT([[q[0], .6, .05 + q[1]], [q[0] * 1.6, .86, .08 + q[1] * 2]], [.011, .006], 0x4a8a3a, .7, 4); AT([[-.02, .62, .08], [-.05, .8, .12]], [.02, .016], 0xe8e4d0, .6, 5); }
    else if (X === 'balance_bike') { const s = ks, fc = K.bikeCol !== undefined ? K.bikeCol : 0xd8442c; for (const z of [.3, -.27]) { AT([[-.016 * s, .15 * s, z * s], [.016 * s, .15 * s, z * s]], [.15 * s, .15 * s], 0x101012, .9, 12); AT([[-.02 * s, .15 * s, z * s], [.02 * s, .15 * s, z * s]], [.1 * s, .1 * s], 0xe8e4d8, .5, 10); }
      AT([[0, .15 * s, -.27 * s], [0, .3 * s, -.1 * s], [0, .36 * s, .2 * s]], .017 * s, fc, .35, 6); AT([[0, .15 * s, .3 * s], [0, .36 * s, .22 * s], [0, .55 * s, .2 * s]], .014 * s, fc, .35, 6); AT([[-.18 * s, .55 * s, .2 * s], [.18 * s, .55 * s, .2 * s]], .012 * s, 0x18181a, .7, 6);
      AT([[0, .3 * s, -.1 * s], [0, .4 * s, -.12 * s]], .012 * s, 0x9a9da2, .35, 5); AB([0, .415 * s, -.13 * s], [.1 * s, .03 * s, .2 * s], 0x18181a, .7); }
    else if (X === 'foldbike') { for (const z of [.38, -.36]) { wheel(0, .14, z, .14, .02); } AT([[0, .14, -.36], [0, .2, -.1], [0, .3, .05], [0, .26, .3]], .022, 0x1c1c20, .4, 6); AT([[0, .2, -.1], [0, .78, -.2]], .016, 0x9a9da2, .3, 6); AB([0, .8, -.21], [.15, .045, .24], 0x121214, .7);
      AT([[0, .14, .38], [0, .5, .34], [0, .98, .3]], .016, 0x1c1c20, .4, 6); AT([[-.24, .98, .3], [.24, .98, .3]], .012, 0x18181a, .7, 6); AB([0, .24, .08], [.11, .1, .3], 0xd8641c, .5); AB([0, .92, .33], [.07, .05, .03], 0x121214, .4); AB([0, .31, -.4], [.1, .012, .2], 0x1c1c20, .5, 0, .2);
      tube(bk.glow, [[0, .92, .347], [0, .92, .351]], [.018, .018], 6, { col: [1.6, 1.5, 1.2], rough: 1, w: AW, vary: 0, blank: true }); }
    else if (X === 'ringlight') { for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + .5; AT([[0, .62, 0], [cos(a) * .34, .01, sin(a) * .34]], .009, 0x18181a, .5, 4); } AT([[0, .55, 0], [0, 1.2, 0], [0, 1.52, 0]], [.013, .011, .009], 0x18181a, .45, 6);
      const pts = []; for (let i = 0; i <= 14; i++) { const a = i / 14 * TAU; pts.push([cos(a) * .17, 1.7 + sin(a) * .17, 0]); } tube(bk.glow, pts, .02, 6, { col: [2.3, 2.15, 1.85], rough: 1, w: AW, vary: 0, blank: true, flat: .7 }); AT(pts.map(p => [p[0], p[1], p[2] - .012]), .021, 0x18181a, .6, 5);
      AB([0, 1.7, .0], [.078, .158, .011], 0x101114, .3); sheet(bk.glow, 'live', [0, 1.7, .0062], [1, 0, 0], [0, 1, 0], .07, .148, AW, { col: [1.25, 1.25, 1.3] }); AT([[0, 1.52, 0], [0, 1.6, -.01]], .008, 0x18181a, .5, 4); }
    else if (X === 'top') { const pc = new Piece(bk.cloth), rs = []; for (const r of [[.0, 0], [.012, .012], [.07, .05], [.1, .062], [.15, .064], [.165, .05], [.17, 0]]) rs.push({ p: [0, r[0], 0], rx: r[1], rf: r[1], e: 2, cf: (p, t) => r[0] > .08 && r[0] < .16 ? [lin(0xc8281e), lin(0xe8c020), lin(0x2463c0), lin(0xe8e4d8)][Math.floor(t * 8) % 4] : lin(0x8a6a3a) }); loft(pc, rs, 12, { col: lin(0x8a6a3a), rough: .5, w: AW, vary: 0 }); pc.end(); }
    else if (X === 'buoy') { const pc = new Piece(bk.cloth), rs = []; for (const r of [[-.2, 0], [-.18, .07], [-.08, .12], [.06, .12], [.16, .075], [.19, 0]]) rs.push({ p: [0, 0, r[0]], rx: r[1], rf: r[1] * .85, e: 2.2, ax: 'z' }); loft(pc, rs, 10, { col: lin(K.buoyCol !== undefined ? K.buoyCol : 0xe8641c), rough: .45, w: AW, vary: .04 }); pc.end(); AT([[0, .04, .19], [0, -.02, .7], [0, -.1, 1.15]], .004, 0xd8d4c8, .8, 3); }
    else if (X === 'pstool') { const sc = K.stoolCol !== undefined ? K.stoolCol : 0xb5202a, pc = new Piece(bk.cloth), rs = []; for (const r of [[.0, .17], [.2, .155], [.4, .14], [.425, .15], [.44, .145]]) rs.push({ p: [0, r[0], 0], rx: r[1], rf: r[1], e: 5, mod: a => 1 - .1 * Math.pow(abs(sin(a * 2)), 6) * (r[0] < .41 ? 1 : 0) }); rs.push({ p: [0, .44, 0], rx: .0, rf: .0 }); loft(pc, rs, 16, { col: lin(sc), rough: .45, w: AW, vary: .05 }); pc.end(); }
    else if (X === 'mazha') { for (const s of [-1, 1]) { AT([[s * .15, .01, -.13], [s * .15, .31, .13]], .009, 0x8a8d92, .35, 5); AT([[s * .15, .01, .13], [s * .15, .31, -.13]], .009, 0x8a8d92, .35, 5); } for (const z of [-.13, .13]) { AT([[-.16, .31, z], [.16, .31, z]], .009, 0x8a8d92, .35, 5); AT([[-.16, .012, z], [.16, .012, z]], .008, 0x8a8d92, .35, 5); } AB([0, .305, 0], [.3, .008, .26], K.stoolCol !== undefined ? K.stoolCol : 0x3a5a3a, .95); }
    else if (X === 'fruitcart') { const wd = 0x7a5a36; AB([0, .66, 0], [.82, .05, 1.3], wd, .85); for (const s of [-1, 1]) { AB([s * .41, .74, 0], [.03, .14, 1.3], wd, .85); wheel(s * .46, .3, .08, .3, .022, 0x151517, 0x8a3a2a); AT([[s * .36, .68, -.65], [s * .36, .78, -1.05], [s * .36, .86, -1.2]], .018, 0x6a4a2a, .7, 6); AT([[s * .34, .64, .5], [s * .34, .0, .52]], .02, 0x5a4a3a, .7, 5); } AB([0, .74, .65], [.82, .14, .03], wd, .85); AB([0, .74, -.65], [.82, .14, .03], wd, .85); AT([[-.46, .3, .08], [.46, .3, .08]], .016, 0x5a5d62, .5, 6);
      const fr = GT.rng('fruit'), heap = (x0, z0, w, d, col, rad, n) => { AB([x0, .72, z0], [w, .09, d], 0x4a7a3a, .7); for (let i = 0; i < n; i++) ballGeo(bk.cloth, [x0 + (fr() - .5) * (w - rad * 2), .78 + rad * .4 + fr() * rad * 1.2, z0 + (fr() - .5) * (d - rad * 2)], rad, mul(lin(col), .85 + .3 * fr()), .55, AW, { seg: 5 }); };
      heap(-.2, .38, .36, .46, 0xe0861c, .05, 7); heap(.2, .38, .36, .46, 0xb8281e, .052, 6); heap(-.2, -.14, .36, .46, 0x6a9a2c, .048, 6); heap(.2, -.14, .36, .46, 0xe8c83a, .046, 6);
      AB([.0, .84, -.5], [.3, .05, .22], 0xb8bcc0, .35); AB([0, .9, -.5], [.24, .015, .18], 0xd8dce0, .25); AB([0, .93, -.6], [.12, .09, .02], 0x1c1c20, .4, 0, -.3);
      AT([[.36, .7, .6], [.36, 1.75, .6]], .012, 0x8a8d92, .4, 5); sheet(bk.decal, 'cart', [.02, 1.6, .6], [-1, 0, 0], [0, 1, 0], .66, .22, AW, { two: true, rough: .7 }); }
    return finishGeo(bk, { J, top, torch, tb, hs, HC, sY, ny }, NB ? HB.BDEF.length : 0);
  }
  function finishGeo(bk, out, boneOff) { out.tris = 0; out.geo = {};
    if (boneOff) for (const name in bk) { const SI = bk[name].SI; for (let i = 0; i < SI.length; i++) SI[i] += boneOff; }
    for (const name in bk) { const b = bk[name]; if (!b.I.length) continue; const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(b.P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(b.N, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(b.U, 2)); g.setAttribute('color', new T.Float32BufferAttribute(b.C, 3));
      g.setAttribute('aRough', new T.Float32BufferAttribute(b.R, 1)); g.setAttribute('skinIndex', new T.Uint16BufferAttribute(b.SI, 4)); g.setAttribute('skinWeight', new T.Float32BufferAttribute(b.SW, 4)); g.setIndex(b.I);
      g.boundingSphere = new T.Sphere(new T.Vector3(0, .9, 0), 3.2); g.boundingBox = new T.Box3(new T.Vector3(-2.4, -.6, -2.4), new T.Vector3(2.4, 2.6, 3.6)); out.geo[name] = g; out.tris += b.I.length / 3; }
    return out;
  }

  /* ------------------------------------------------------------------ specs per kind / archetype */
  const SKIN = [0xe8c0a0, 0xd6a47e, 0xc48e62, 0xa06e48, 0x76503a, 0x513828];
  const HAIRC = [0x17120f, 0x2a1d15, 0x46301f, 0x6e5234, 0xa88c5a, 0x8c8a86, 0xc9c7c0];
  const HAIR = { short: { th: .016, f: .072, t: .05, s: .014, s2: -.03, b: -.076, puff: .3 }, buzz: { th: .004, f: .072, t: .05, s: .016, s2: -.028, b: -.07 }, mop: { th: .024, f: .05, t: .024, s: -.028, s2: -.058, b: -.092, puff: .45 },
    tied: { th: .011, f: .074, t: .05, s: .008, s2: -.04, b: -.084 }, bun: { th: .012, f: .074, t: .05, s: .006, s2: -.04, b: -.084 }, topknot: { th: .01, f: .074, t: .05, s: .01, s2: -.036, b: -.08 }, pony: { th: .012, f: .074, t: .05, s: .008, s2: -.04, b: -.084, puff: .15 },
    long: { th: .022, f: .062, t: .03, s: -.055, s2: -.085, b: -.105, puff: .2, sheet: 1 }, wavy: { th: .028, f: .058, t: .026, s: -.06, s2: -.09, b: -.108, puff: .4, sheet: 1.1, wave: .07, wide: 1.12 }, bob: { th: .026, f: .056, t: .026, s: -.062, s2: -.09, b: -.104, puff: .25, sheet: .52, wide: 1.08 },
    sides: { th: .006, f: .05, t: .05, s: .012, s2: -.03, b: -.074, top: .062, fmin: .95 }, afro: { th: .058, f: .064, t: .04, s: .004, s2: -.036, b: -.078, puff: .16, round: 1 }, curly: { th: .034, f: .058, t: .034, s: -.012, s2: -.046, b: -.086, puff: .55 },
    fade: { th: .026, f: .07, t: .05, s: .016, s2: -.028, b: -.07, fade: 1, puff: .3 }, quiff: { th: .017, f: .072, t: .05, s: .014, s2: -.03, b: -.074, quiff: .03, fade: .6, puff: .25 }, slick: { th: .009, f: .074, t: .052, s: .012, s2: -.034, b: -.082 },
    braids: { th: .012, f: .07, t: .046, s: .0, s2: -.04, b: -.082, puff: .5 } };
  const hairOf = (style, col) => Object.assign({ style, col }, HAIR[style] || HAIR.short);
  const C_TEE = [0x1f2a3a, 0x6e2a28, 0x3b4733, 0xa07c2a, 0x275353, 0xb85c46, 0x17171a, 0xcfcabb, 0x55606c, 0x7a4662, 0x40627f, 0xa89a7c, 0x9a342e, 0x2f3d2c, 0x8a8f94, 0xc4b08a];
  const C_PASTEL = [0xdcd6c6, 0xb4cbd4, 0xddd09c, 0xb3d1be, 0xdfbaae, 0xc8c2d8], C_SWIM = [0xb83a34, 0x1c627f, 0xd89a2c, 0x26805f, 0x17171a, 0xcf6282, 0x36458f, 0xe2ddd0, 0xd96a2c];
  const C_SURF = [0xf2efe6, 0xe9e2c8, 0x8fd0e0, 0xf1c84a, 0xe86f4f, 0x6fc2a0];
  const C_DENIM = [0x2b3649, 0x45525f, 0x1c222c, 0x5e6e7c, 0x333a44], C_KHAKI = [0x9e8f70, 0x858269, 0x67727a, 0x544f40, 0x36393e, 0x6e6046], C_DARK = [0x17181b, 0x23272e, 0x2c2f2a, 0x34282a];
  const C_SHOE = [0x1a1a1c, 0xd8d5cc, 0x8a9aa8, 0xb8563e, 0x3a4658, 0x6a4e30, 0xe6e2d8];
  const TOPS = { tee: { type: 'tee', off: .012, hem: .885, sl: 'short', slOff: .013, slEnd: .19 }, fitted: { type: 'tee', off: .006, hem: .9, sl: 'short', slOff: .008, slEnd: .14 }, baggy: { type: 'tee', off: .018, hem: .84, sl: 'short', slOff: .016, slEnd: .225 },
    tank: { type: 'tank', off: .008, hem: .89, sl: 'none', neck: 1.4, strap: .034 }, tankf: { type: 'tank', off: .005, hem: .95, sl: 'none', neck: 1.385, strap: .022, rough: .7 }, crop: { type: 'crop', off: .005, hem: 1.14, sl: 'none', neck: 1.385, strap: .02, rough: .7 },
    bikini: { type: 'bikini', off: .006, hem: 1.243, sl: 'none', neck: 1.335, strap: .006, rough: .6 }, bare: { type: 'bare', off: 0, hem: 1.03, sl: 'none' },
    shirt: { type: 'shirt', off: .014, hem: .875, sl: 'short', slOff: .016, slEnd: .2, collar: true, placket: true }, aloha: { type: 'shirt', print: true, off: .016, hem: .87, sl: 'short', slOff: .015, slEnd: .2, collar: true, placket: true },
    guayabera: { type: 'shirt', off: .015, hem: .86, sl: 'short', slOff: .017, slEnd: .21, collar: true, placket: true, pleats: true }, polo: { type: 'polo', off: .008, hem: .9, sl: 'short', slOff: .012, slEnd: .17, collar: true, placket: .15 },
    long: { type: 'long', off: .012, hem: .885, sl: 'long', slOff: .012 }, hoodie: { type: 'hoodie', off: .02, hem: .88, sl: 'long', slOff: .015, rib: true, pocket: true, rough: .93 }, jacket: { type: 'jacket', off: .018, hem: .9, sl: 'long', slOff: .016, collar: true, placket: true, rough: .55, btn: 0x8a8d92 },
    jersey: { type: 'jersey', off: .014, hem: .85, sl: 'none', neck: 1.405, strap: .05, rough: .6 }, dress: { type: 'dress', off: .006, hem: .6, sl: 'none', neck: 1.34, skirt: true, strap: .014, rough: .85 }, uniform: { type: 'uniform', off: .011, hem: 1.03, sl: 'short', slOff: .013, slEnd: .175, collar: true, blouse: true, placket: true, rough: .8 } };
  const BOTS = { jeans: { type: 'jeans', off: .009, open: .066, stack: true, fade: .35, pockets: true }, slim: { type: 'jeans', off: .005, open: .05, fade: .2, pockets: true }, leggings: { type: 'jeans', off: .003, open: 0, rough: .6 }, capri: { type: 'jeans', off: .003, open: 0, rough: .6, crop: true },
    trousers: { type: 'trousers', off: .012, open: .066 }, work: { type: 'trousers', off: .014, open: .074, stack: true, pockets: true }, shorts: { type: 'shorts', off: .018, len: .37 }, cargo: { type: 'shorts', off: .02, len: .41, flare: 1.1 }, run: { type: 'shorts', off: .007, len: .16, flare: .35, rough: .75 },
    board: { type: 'shorts', off: .016, len: .32, flare: 1.2, rough: .7 }, bball: { type: 'shorts', off: .022, len: .43, flare: 1.35, rough: .6 }, hot: { type: 'shorts', off: .007, len: .1, flare: .25 }, brief: { type: 'brief', off: .003, rough: .6 }, none: { type: 'none' } };
  const TOP = (t, col, x) => Object.assign({ col }, TOPS[t] || TOPS.tee, x), BOT = (t, col, x) => Object.assign({ col: col || 0 }, BOTS[t] || BOTS.jeans, x);
  const SNK = (col, sole, x) => Object.assign({ type: 'sneaker', col, sole: sole === undefined ? 0xd6d2c6 : sole }, x), FLIP = col => ({ type: 'sandal', col, sole: col }), BAREF = { type: 'bare', col: 0, sole: 0 };
  /** archetype table for kind 'ped' (opts.type). r = seeded rng, pick = seeded choice. Each returns partial spec fields. */
  const PED = {
    tourist: (r, pick) => ({ height: 1.74 + r() * .06, bulk: 1.06, belly: .045, face: 'glasses', hat: r() < .6 ? 'cap' : r() < .5 ? 'bucket' : null, hatCol: pick([0xc9c2ae, 0x3a4658, 0x7a5a4a]), socks: .66, hair: hairOf('short', pick(HAIRC.slice(1, 5))), watch: true,
      top: TOP('aloha', pick([0xffffff, 0xffe9c8, 0xcfe6ff, 0xffd8d0])), bottom: BOT('shorts', pick(C_KHAKI.slice(0, 3))), shoes: SNK(0xb8b4a8, 0xd8d4c8), kit: r() < .5 ? { sling: 0x2a2c30 } : {} }),
    tourist_f: (r, pick) => ({ female: true, height: 1.62 + r() * .07, sh: .168, hp: .09, bulk: .98, armBulk: .94, belly: .01, face: 'fglasses', hat: 'sunhat', hatCol: pick([0xd6c8a0, 0xe2d8c0]), hatBand: pick([0x8a2a3a, 0x1f4a5a, 0x2a2622]), hair: hairOf(pick(['bob', 'long', 'tied']), pick(HAIRC.slice(1, 5))),
      top: TOP('tankf', pick(C_PASTEL)), bottom: BOT('capri', pick([0xd8d4c8, 0x3a4658, 0x8a9aa8])), shoes: FLIP(pick([0x8a6a4a, 0x2a2420])), kit: { tote: pick([0xc8b88a, 0x5a7a8a, 0xb85c46]) } }),
    jogger: (r, pick) => ({ female: true, height: 1.66 + r() * .06, sh: .168, hp: .088, bulk: .92, armBulk: .92, face: r() < .5 ? 'fglasses' : 'female', hair: hairOf(pick(['pony', 'tied', 'pony']), pick(HAIRC.slice(0, 5))), socks: .76, hat: r() < .35 ? 'visor' : r() < .3 ? 'headband' : null, watch: 0x2a2c30,
      top: TOP(r() < .5 ? 'crop' : 'tankf', pick([0xa85a50, 0x3f7a78, 0x6a5a82, 0xc9c4b8, 0x17171a, 0xd96a2c])), bottom: r() < .5 ? BOT('run', pick(C_DARK)) : BOT('leggings', pick([0x17181b, 0x2a3040, 0x4a2a44])), shoes: SNK(pick([0xd8d5cc, 0x8a9aa8, 0xc47a5a]), 0xe0ddd4, { toe: 0x50545a }), kit: r() < .5 ? { headphones: true } : {} }),
    jogger_m: (r, pick) => ({ height: 1.76 + r() * .08, sh: .19, bulk: .96, face: r() < .5 ? 'stubble' : 'male', shades: r() < .5, hair: hairOf(pick(['fade', 'buzz', 'short']), pick(HAIRC.slice(0, 4))), socks: .72, hat: r() < .3 ? 'cap_back' : null, hatCol: 0x17171a, watch: true,
      top: r() < .4 ? TOP('bare') : TOP(r() < .5 ? 'tank' : 'fitted', pick([0x8a8f94, 0x17171a, 0x9a342e, 0x1f2a3a, 0xc4d43a])), bottom: BOT('run', pick(C_DARK), { len: .22 }), shoes: SNK(pick([0x17171a, 0xd8d5cc, 0xd96a2c]), 0xe0ddd4), kit: r() < .5 ? { headphones: true } : {} }),
    skater: (r, pick) => ({ height: 1.72 + r() * .08, sh: .182, bulk: .9, armBulk: .88, face: 'male', hat: r() < .5 ? 'beanie' : r() < .5 ? 'cap_back' : null, hatCol: pick([0x5a3f38, 0x2e3a35, 0x3a3a40, 0x8a2a2a]), hair: hairOf(pick(['mop', 'curly', 'mop']), pick(HAIRC.slice(0, 5))), socks: .7, sockCol: 0xe2dfd4,
      top: TOP('baggy', pick([0x8a8474, 0x51606a, 0x6a4a44, 0x17171a, 0xa07c2a, 0x2f3d2c])), bottom: r() < .5 ? BOT('jeans', pick([0x4a5868, 0x37352f, 0x5a5a52]), { off: .016, open: .084 }) : BOT('cargo', pick(C_KHAKI)), shoes: SNK(0x1a1a1c, 0xd0ccc0, { stripe: 0xd8d4c8 }), kit: { aux: 'board', boardCol: pick([0x2a2a2c, 0x3a2a22]), wheelCol: pick([0xd8d0b0, 0xb83a34, 0x26805f]) } }),
    oldman: (r, pick) => ({ height: 1.68 + r() * .05, sh: .18, bulk: .98, belly: .04, stoop: .2, face: 'old', skin: pick(SKIN.slice(0, 4)), hat: r() < .75 ? 'panama' : null, hair: hairOf('sides', pick(HAIRC.slice(5))), beard: r() < .35 ? { col: 0xc9c7c0, th: .006 } : null, watch: 0xb89a48,
      top: TOP('guayabera', pick([0xe2ded2, 0xb9cdd6, 0xddd3a4, 0xb6d2c2, 0xd8c0b4])), bottom: BOT('trousers', pick([0x8a8068, 0x6a6a62, 0x756a58, 0x3a3d42])), shoes: { type: 'flat', col: 0x4a3526, sole: 0x2a2018, rough: .45 } }),
    oldwoman: (r, pick) => ({ female: true, height: 1.56 + r() * .05, sh: .166, hp: .094, bulk: 1.06, belly: .03, stoop: .16, face: 'fglasses', skin: pick(SKIN.slice(0, 4)), hair: hairOf(pick(['bob', 'bun', 'curly']), pick(HAIRC.slice(5))), hat: r() < .4 ? 'sunhat' : null,
      top: TOP('dress', pick([0x6a7f8f, 0x8a6a7a, 0x5f7a62, 0xa8875a]), { hem: .5, flare: .9, neck: 1.39, strap: .05 }), bottom: BOT('none'), shoes: { type: 'flat', col: 0x6a5238, sole: 0x3a2a1c, rough: .5 }, kit: { tote: 0x8a7a5a } }),
    sundress: (r, pick) => ({ female: true, height: 1.64 + r() * .07, sh: .166, hp: .088, bulk: .93, armBulk: .92, face: r() < .4 ? 'fglasses' : 'female', shades: r() < .25, hair: hairOf(pick(['long', 'wavy', 'bun', 'bob', 'braids']), pick(HAIRC.slice(0, 5))),
      top: TOP('dress', pick([0xb86a52, 0x7f8f6e, 0xd0c29e, 0x567687, 0xc0934f, 0x8a3a4a, 0xe2ddd0]), { hem: r() < .5 ? .6 : .68 }), bottom: BOT('none'), shoes: r() < .5 ? FLIP(pick([0x8a6a4a, 0x2a2420, 0xd8d4c8])) : { type: 'flat', col: pick([0x8a6a4a, 0xc9b99a, 0x3a2a22]), sole: 0x6a5238, rough: .5 } }),
    worker: (r, pick) => ({ height: 1.78 + r() * .07, sh: .198, bulk: 1.1, belly: .03, face: 'stubble', hat: r() < .7 ? 'hardhat' : 'cap', hatCol: pick([0xd8d2c4, 0xc9a23a, 0xd8d2c4]), hair: hairOf('buzz', pick(HAIRC.slice(0, 3))), gloves: r() < .5 ? 0x8a7a4a : null, beard: r() < .3 ? { th: .008 } : null,
      top: TOP('tee', pick([0x5a5d60, 0x3f4650, 0x6a6458, 0x2c3a52]), { off: .009, hem: .9 }), bottom: BOT('work', pick([0x4a4d52, 0x5a5444, 0x2e3340])), shoes: { type: 'boot', col: 0x6a4e30, sole: 0x1a1612, rough: .7 }, kit: { hivis: pick([0xb9c43a, 0xd0782a, 0xb9c43a]) } }),
    local_m: (r, pick) => { const t = pick(['tee', 'tee', 'baggy', 'tank', 'shirt', 'polo', 'hoodie', 'long', 'fitted']); return { height: 1.7 + r() * .16, sh: .182 + r() * .02, bulk: .92 + r() * .24, belly: r() < .35 ? .02 + r() * .05 : 0, face: pick(['male', 'stubble', 'stubble', 'glasses', 'stache']), shades: r() < .3, beard: r() < .28 ? { th: .006 + r() * .008, full: r() < .5, len: r() < .3 ? .02 : 0 } : null,
      hair: hairOf(pick(['short', 'fade', 'buzz', 'curly', 'afro', 'quiff', 'slick', 'mop', 'braids', 'topknot']), pick(HAIRC.slice(0, 5))), hat: r() < .3 ? pick(['cap', 'cap_back', 'beanie', 'bucket']) : null, hatCol: pick([0x17171a, 0x3a4658, 0x8a2a2a, 0xc9c2ae, 0x2f3d2c]), watch: r() < .4, socks: r() < .5 ? .72 : 0,
      top: TOP(t, pick(t === 'shirt' ? C_PASTEL.concat(C_TEE) : C_TEE)), bottom: r() < .55 ? BOT(pick(['jeans', 'slim', 'trousers']), pick(r() < .6 ? C_DENIM : C_KHAKI)) : BOT(pick(['shorts', 'cargo', 'bball']), pick(C_KHAKI.concat(C_DARK))), shoes: r() < .2 ? FLIP(0x2a2420) : SNK(pick(C_SHOE), pick([0xd6d2c6, 0xd6d2c6, 0x1a1a1c])), kit: r() < .18 ? { backpack: pick([0x2a2c30, 0x4a3a2a, 0x2c4a5a]) } : r() < .15 ? { sling: 0x17171a } : {} }; },
    local_f: (r, pick) => { const t = pick(['tankf', 'crop', 'fitted', 'tee', 'tankf', 'long']); return { female: true, height: 1.58 + r() * .14, sh: .162 + r() * .012, hp: .086 + r() * .008, bulk: .9 + r() * .2, armBulk: .92, chest: r() * .012, face: pick(['female', 'female', 'fglasses']), shades: r() < .3,
      hair: hairOf(pick(['long', 'wavy', 'pony', 'bun', 'bob', 'braids', 'curly', 'afro', 'tied']), pick(HAIRC.slice(0, 5))), hat: r() < .15 ? pick(['cap', 'bucket', 'visor']) : null, hatCol: pick([0xd8d4c8, 0x17171a, 0xcf6282]), watch: r() < .3 ? 0xb89a48 : false,
      top: TOP(t, pick(C_TEE.concat(C_PASTEL))), bottom: r() < .4 ? BOT(pick(['slim', 'leggings', 'capri']), pick(C_DENIM.concat(C_DARK))) : BOT(pick(['hot', 'run', 'shorts']), pick(C_DENIM.concat(C_KHAKI)), { off: .008 }), shoes: r() < .35 ? FLIP(pick([0x8a6a4a, 0xd8d4c8, 0x17171a])) : SNK(pick(C_SHOE), 0xe0ddd4), kit: r() < .3 ? { tote: pick([0xc8b88a, 0x2a2c30, 0x8a3a4a]) } : r() < .2 ? { sling: 0x8a6a4a } : {} }; },
    beach_m: (r, pick) => ({ height: 1.72 + r() * .14, sh: .188 + r() * .014, bulk: .94 + r() * .2, belly: r() < .4 ? .03 + r() * .05 : 0, chest: r() * .012, face: pick(['male', 'stubble', 'glasses']), shades: r() < .5, beard: r() < .2 ? { th: .007 } : null, hair: hairOf(pick(['short', 'mop', 'curly', 'buzz', 'topknot', 'fade']), pick(HAIRC.slice(0, 5))), hat: r() < .25 ? pick(['cap', 'bucket', 'cap_back']) : null, hatCol: pick([0xd8d4c8, 0x3a4658, 0xb83a34]),
      top: r() < .7 ? TOP('bare') : TOP('tank', pick(C_TEE)), bottom: BOT('board', pick(C_SWIM), { stripe: r() < .5 ? 0xe2ddd0 : undefined }), shoes: r() < .6 ? BAREF : FLIP(pick([0x2a2420, 0x1c627f])), kit: (q => q < .3 ? { surf: pick(C_SURF), keepR: true } : q < .65 ? { towel: pick(C_SWIM), towel2: 0xe8e4d8 } : {})(r()) }),   /* PP: a third carry a surfboard */
    beach_f: (r, pick) => ({ female: true, height: 1.6 + r() * .12, sh: .164, hp: .088 + r() * .006, bulk: .9 + r() * .16, armBulk: .92, chest: .004 + r() * .012, face: r() < .5 ? 'fglasses' : 'female', shades: r() < .4, hair: hairOf(pick(['long', 'wavy', 'bun', 'pony', 'braids', 'bob']), pick(HAIRC.slice(0, 5))), hat: r() < .3 ? 'sunhat' : null,
      ...((c, q) => q < .3 ? { top: TOP('tankf', c, { hem: .86, neck: 1.36, strap: .02, off: .004, rough: .55 }), bottom: BOT('brief', c) } : { top: TOP('bikini', c), bottom: q < .78 ? BOT('brief', c) : BOT('hot', pick(C_DENIM), { off: .007 }) })(pick(C_SWIM), r()),   /* PP: a bikini in one colour, or a one-piece */
      shoes: r() < .6 ? BAREF : FLIP(pick([0x8a6a4a, 0xd8d4c8])), kit: (q => q < .3 ? { tote: pick([0xc8b88a, 0xcf6282, 0x1c627f]) } : q < .45 ? { surf: pick(C_SURF), keepR: true } : q < .7 ? { towel: pick(C_SWIM), towel2: 0xe8e4d8 } : {})(r()), _same: true }),
    bartender: (r, pick) => ({ height: 1.74 + r() * .1, sh: .19, bulk: 1, face: pick(['stubble', 'male', 'stache']), beard: r() < .5 ? { th: .009, full: true } : null, hair: hairOf(pick(['slick', 'topknot', 'fade', 'quiff']), pick(HAIRC.slice(0, 4))), watch: true,
      top: TOP('aloha', pick([0x40484f, 0x6a3a3a, 0x2f4a4a]), { slEnd: .17 }), bottom: BOT('shorts', 0x23272e, { len: .39 }), shoes: SNK(0x17171a, 0x17171a), kit: { apron: 0x2a2420, apronWaist: true, propL: 'bottle', propR2: 'rag' } }),
    musician: (r, pick) => ({ height: 1.74 + r() * .08, sh: .186, bulk: .95, face: pick(['stubble', 'male']), shades: r() < .6, beard: r() < .6 ? { th: .01, full: true, len: .012 } : null, hair: hairOf(pick(['long', 'curly', 'mop', 'wavy']), pick(HAIRC.slice(0, 5))), hat: r() < .65 ? 'panama' : null, hatCol: pick([0x4a3a2a, 0x2a2622, 0xcdbf9a]), hatBand: 0x8a2a2a,
      top: TOP('shirt', pick([0xcfcabb, 0x40627f, 0x6e2a28, 0x3b4733]), { off: .016, hem: .87, slEnd: .2 }), bottom: BOT('jeans', pick(C_DENIM)), shoes: { type: 'boot', col: 0x5a4028, sole: 0x1a1612, rough: .6 }, kit: { guitar: pick([0xb8803a, 0xc89a52, 0x8a4a22]) } }),
    cook: (r, pick) => ({ height: 1.7 + r() * .1, sh: .192, bulk: 1.1, belly: .05, face: pick(['stache', 'stubble']), hair: hairOf('buzz', pick(HAIRC.slice(0, 3))), hat: 'bandana', hatCol: pick([0x8a2a2a, 0x17171a, 0x2c3a52]),
      top: TOP('tee', 0xdcd8cc, { off: .01 }), bottom: BOT('trousers', pick([0x23272e, 0x4a4d52]), { off: .013 }), shoes: SNK(0x17171a, 0x17171a), kit: { apron: pick([0xd8d4c8, 0x8a2a2a]), propR2: 'spatula', propL: 'cig' } }),
    baller: (r, pick) => { const c = pick([[0xb83a34, 0xe8e4d8], [0xe8e4d8, 0x1c3a7f], [0x1c3a7f, 0xd8a02c], [0x17171a, 0xb83a34], [0x26805f, 0xe8e4d8], [0xd8a02c, 0x4a2a7a]]); return { height: 1.52 + r() * .16, headK: 1.07, sh: .176, hp: .086, bulk: .86, armBulk: .84, legBulk: .86, face: 'male', hair: hairOf(pick(['fade', 'buzz', 'afro', 'curly', 'braids', 'short']), pick(HAIRC.slice(0, 3))), hat: r() < .25 ? 'headband' : null, socks: .64, sockCol: 0xe2dfd4, skin: pick(SKIN.slice(1)),
      top: r() < .25 ? TOP('bare') : TOP('jersey', c[0], { trim: c[1] }), bottom: BOT('bball', r() < .5 ? c[0] : pick(C_DARK), { stripe: c[1] }), shoes: SNK(pick([0xe6e2d8, 0x17171a, 0xb83a34]), 0xe6e2d8, { type: 'boot', rough: .6, stripe: c[1] }), kit: { aux: 'ball', propL: 'ball' } }; },
    lifeguard: (r, pick) => ({ female: r() < .4, height: 1.74 + r() * .1, sh: .19, bulk: 1.02, chest: .01, face: 'male', shades: true, hair: hairOf(pick(['short', 'mop', 'pony', 'bun']), pick(HAIRC.slice(2, 5))), hat: pick(['visor', 'cap', null]), hatCol: 0xb3242c, skin: pick(SKIN.slice(1, 4)),
      top: TOP('tank', 0xe2ddd0, { trim: 0xb3242c }), bottom: BOT('board', 0xb3242c, { stripe: 0xe2ddd0 }), shoes: FLIP(0x17171a), kit: { whistle: true, propL: 'cup', cupCol: 0xe2ddd0 }, _lg: true }),
    guard: (r, pick) => ({ height: 1.8 + r() * .06, sh: .2, bulk: 1.12, belly: .035, face: pick(['stache', 'stubble', 'glasses']), shades: r() < .5, hair: hairOf('buzz', pick(HAIRC.slice(0, 3))), hat: 'cap', hatCol: 0x17181b, watch: true,
      top: TOP('uniform', pick([0xd8d8d2, 0xa8b8c8]), {}), bottom: BOT('trousers', 0x1a1c22, { off: .012, open: .068 }), shoes: { type: 'boot', col: 0x0c0c0d, sole: 0x0a0a0a, rough: .35 }, kit: { belt: 'duty', badge: 'guard', tag: 0x1c3a7f, torch: 1 } }),
    rider: (r, pick) => { const c = pick([0x26a08a, 0xd96a2c, 0xc4d43a, 0xcf3a5a]); return { height: 1.7 + r() * .1, sh: .184, bulk: .95, face: pick(['male', 'stubble']), hair: hairOf('short', pick(HAIRC.slice(0, 3))), hat: 'helmet', hatCol: pick([0x1a1c20, 0xe2ddd0, c]),
      top: TOP('jacket', c, { rough: .5 }), bottom: BOT('jeans', pick(C_DENIM)), shoes: SNK(0x17171a, 0xd6d2c6), kit: { cube: c, aux: 'scooter' } }; },
    lifter: (r, pick) => ({ height: 1.76 + r() * .1, sh: .206, bulk: 1.2, armBulk: 1.32, legBulk: 1.12, chest: .022, face: pick(['stubble', 'male']), beard: r() < .4 ? { th: .008 } : null, hair: hairOf(pick(['buzz', 'fade', 'topknot']), pick(HAIRC.slice(0, 3))), hat: r() < .3 ? 'cap_back' : null, hatCol: 0x17171a, skin: pick(SKIN.slice(1)), socks: .7,
      top: r() < .5 ? TOP('bare') : TOP('tank', pick([0x17171a, 0x8a8f94, 0x9a342e]), { strap: .026, neck: 1.37 }), bottom: BOT('run', pick(C_DARK), { len: .26, off: .012 }), shoes: SNK(pick([0x17171a, 0xd8d5cc]), 0xd6d2c6), kit: { aux: 'barbell', plateCol: pick([0x18191c, 0x8a2a2a, 0x1c3a7f]) } }),
    angler: (r, pick) => ({ height: 1.7 + r() * .08, sh: .186, bulk: 1.04, belly: .04, stoop: .08, face: pick(['old', 'stubble']), beard: r() < .5 ? { col: 0x8c8a86, th: .01, full: true } : null, hair: hairOf('short', pick(HAIRC.slice(3))), hat: 'bucket', hatCol: pick([0x858269, 0xb8b09a, 0x544f40]),
      top: TOP('shirt', pick([0x9aa88a, 0xb4a888, 0x8a9aa8]), { sl: 'long', slEnd: .4, slOff: .018 }), bottom: BOT('cargo', pick(C_KHAKI)), shoes: FLIP(0x2a2420), kit: { aux: 'rod' } }),
    wrestler: (r, pick) => ({ height: 1.74 + r() * .1, sh: .204, bulk: 1.16, armBulk: 1.22, legBulk: 1.1, belly: r() * .04, chest: .016, face: pick(['stubble', 'stache']), beard: r() < .5 ? { th: .01, full: true } : null, hair: hairOf(pick(['long', 'buzz', 'mop', 'topknot']), pick(HAIRC.slice(0, 4))), hat: r() < .3 ? 'headband' : null, hatCol: 0xb83a34, skin: pick(SKIN),
      top: TOP('bare'), bottom: r() < .5 ? BOT('leggings', pick([0xb83a34, 0x1c3a7f, 0x17171a, 0xd8a02c]), { stripe: 0xe2ddd0 }) : BOT('run', pick(C_SWIM), { len: .2, off: .01 }), shoes: { type: 'boot', col: pick([0x17171a, 0xe2ddd0, 0xb83a34]), sole: 0x17171a, rough: .5 }, phone: false }),
    patron_m: (r, pick) => ({ height: 1.72 + r() * .14, sh: .188, bulk: .96 + r() * .16, belly: r() < .3 ? .04 : 0, face: pick(['male', 'stubble', 'glasses']), shades: r() < .25, beard: r() < .3 ? { th: .008, full: true } : null, hair: hairOf(pick(['slick', 'quiff', 'short', 'fade', 'curly']), pick(HAIRC.slice(0, 5))), watch: 0xb89a48,
      top: TOP(pick(['aloha', 'shirt', 'polo', 'fitted']), pick([0xffffff, 0x17171a, 0x40627f, 0xdcd6c6, 0x6e2a28, 0xffd8d0])), bottom: r() < .5 ? BOT('shorts', pick(C_KHAKI)) : BOT('slim', pick(C_DENIM.concat([0xcfcabb]))), shoes: r() < .4 ? FLIP(0x2a2420) : SNK(pick([0xd8d5cc, 0x6a4e30]), 0xd6d2c6), kit: { propL: pick(['bottle', 'cup', 'can']) } }),
    patron_f: (r, pick) => ({ female: true, height: 1.6 + r() * .12, sh: .164, hp: .088, bulk: .92 + r() * .1, armBulk: .92, chest: .008, face: 'female', shades: r() < .2, hair: hairOf(pick(['wavy', 'long', 'bob', 'pony', 'braids', 'curly']), pick(HAIRC.slice(0, 5))), watch: r() < .4 ? 0xb89a48 : false,
      top: r() < .55 ? TOP('dress', pick([0x8a3a4a, 0x17171a, 0xe2ddd0, 0x26805f, 0xd89a2c, 0x567687]), { hem: .66 + r() * .06, strap: .01 }) : TOP('crop', pick(C_TEE.concat(C_PASTEL))), bottom: null, shoes: r() < .5 ? FLIP(pick([0x8a6a4a, 0xd8a02c])) : { type: 'flat', col: pick([0x17171a, 0xc9b99a]), sole: 0x3a2a1c, rough: .4 }, kit: { propL: pick(['cup', 'bottle', 'cup']), cupCol: pick([0xb3262c, 0xe8e6e0, 0x26805f]) }, _pf: true }),
    guest: (r, pick) => ({ height: 1.72 + r() * .12, sh: .186, bulk: 1 + r() * .14, belly: r() < .5 ? .05 : .01, face: pick(['stubble', 'male', 'glasses']), hair: hairOf(pick(['short', 'buzz', 'mop', 'sides']), pick(HAIRC.slice(0, 6))),
      top: TOP(pick(['tank', 'tee', 'bare', 'aloha']), pick([0xcfcabb, 0x8a8f94, 0x40627f, 0xffffff])), bottom: BOT('board', pick(C_SWIM.concat(C_KHAKI))), shoes: FLIP(pick([0x2a2420, 0x1c627f])), kit: { propL: pick(['can', 'bottle', 'coffee']), towel: r() < .4 ? 0xe2ddd0 : undefined } })
  };
  /* ------------------------------------------------------------------ China edition cast (四方街). Every entry sets cn: true (skin / hair defaults); kit.patches are printed from the decal atlas. */
  const SKIN_CN = [0xe6bf9e, 0xdcb08a, 0xd4a57c, 0xc9976a], SKIN_TAN = [0xc48e62, 0xb98258, 0xc9976a], HAIR_BLK = [0x14110f, 0x1a1512, 0x221a15], HAIR_GREY = [0x8c8a86, 0xb9b7b0, 0x5e5c58, 0xc9c7c0], HAIR_DYE = [0x4a1f1c, 0x5a2a20, 0x2a1d15, 0x3a2418];
  const PCH = (cell, y, w, h, back, x) => ({ cell, y, w, h, back: !!back, x: x || 0 });
  const CLOTH_SHOE = { type: 'flat', col: 0x17171a, sole: 0xe8e4d8, rough: .9 }, LIBERATION = () => SNK(0x4f5c3a, 0x23261c, { rough: .85, lace: 0x3a4428 });
  const uncle = (r, pick, x) => { const t = pick(['tank', 'polo', 'shirt', 'tee', 'polo', 'shirt', 'jacket', 'long', 'jacket']), old = r() < .7, build = r(); /* build: wiry, average, stout, big — not one body with a different shirt */ return Object.assign({ cn: true, height: 1.6 + r() * .17, sh: .178 + r() * .018, bulk: build < .25 ? .86 + r() * .08 : build > .8 ? 1.16 + r() * .14 : .96 + r() * .2, belly: build > .8 ? .07 + r() * .05 : build < .25 ? r() * .02 : .02 + r() * .06, hat: r() < .16 ? 'cap' : null, hatCol: pick([0x23272e, 0x5a5f44, 0x8a8f94, 0x7a2a22]), stoop: old ? .06 + r() * .1 : .02, face: old ? pick(['old', 'old', 'stubble']) : pick(['male', 'stubble', 'stache']), hair: hairOf(pick(['sides', 'buzz', 'short', 'short', 'slick']), old ? pick(HAIR_GREY) : pick(HAIR_BLK)), watch: r() < .3 ? 0x8a8d92 : false,
    top: TOP(t, t === 'tank' ? 0xe9e6dc : t === 'jacket' ? pick([0x3a4352, 0x5a5444, 0x23272e, 0x6a7480, 0x4a3a30, 0x2f4a3c]) : pick([0xe2ded2, 0xb9c4c8, 0x6a7480, 0x8a8f94, 0x40505f, 0x9aa890, 0xc8bca0, 0x5a4a44, 0x2f3d4c, 0x7a3a34, 0x3f6a5a]), t === 'tank' ? { rough: .92, strap: .04 } : t === 'jacket' ? { rough: pick([.62, .9, .93]), placket: r() < .5 } : null), bottom: r() < .3 ? BOT('cargo', pick(C_KHAKI), { len: .43 }) : r() < .25 ? BOT('trousers', pick([0x23272e, 0x1c2436, 0x3a3d42]), { stripe: pick([0xe8e4d8, 0xc8281e]), rough: .7 }) : r() < .3 ? BOT('jeans', pick(C_DENIM)) : BOT('trousers', pick([0x3a3d42, 0x4a4d52, 0x2a2c30, 0x5a5444, 0x23272e])),
    shoes: r() < .45 ? CLOTH_SHOE : r() < .5 ? FLIP(pick([0x2a2420, 0x2c4a7a, 0x6a4a2a])) : SNK(pick([0x2a2a2c, 0x8a8f94]), 0xd6d2c6), kit: r() < .22 ? { specs: 0x2a2a2c } : {}, phone: false }, x); };
  const auntie = (r, pick, x) => { const pr = r() < .55, old = r() < .4, build = r(); return Object.assign({ cn: true, female: true, height: 1.49 + r() * .14, sh: .162 + r() * .008, hp: .09 + r() * .008, bulk: build < .25 ? .9 + r() * .08 : build > .78 ? 1.18 + r() * .12 : 1.02 + r() * .14, belly: build > .78 ? .05 + r() * .04 : .02 + r() * .03, hat: r() < .14 ? 'sunhat' : null, hatCol: pick([0xd6c8a0, 0xe8b8c8, 0xcdbf9a]), chest: .008 + r() * .008, stoop: old ? .08 : 0, face: 'female', hair: hairOf(pick(['curly', 'curly', 'bob', 'bun', 'tied']), old ? pick(HAIR_GREY) : pick(HAIR_DYE)),
    top: pr ? TOP('aloha', pick([0xffffff, 0xf2dcd8, 0xd8e4f0, 0xf0e4c0, 0xd8c0d8]), { slEnd: .21 }) : TOP(pick(['tee', 'long', 'polo', 'jacket', 'long']), pick([0x8a3a4a, 0x6a5a82, 0x3f7a78, 0xb85c46, 0xc8b0b8, 0x7a4662, 0x4a6a5a, 0xc23b6a, 0x2f4f8f, 0xd8c8a8])), bottom: BOT(pick(['trousers', 'trousers', 'capri', 'leggings']), pick([0x23272e, 0x2a2c30, 0x3a3440, 0x34282a, 0x1c2436, 0x4a3a44])),
    shoes: r() < .6 ? { type: 'flat', col: pick([0x17171a, 0x5a2a2a, 0x3a3440]), sole: 0xd8d4c8, rough: .7 } : SNK(pick([0xe6e2d8, 0xd8a0a8]), 0xe6e2d8), kit: r() < .35 ? { cuffs: 'print' } : {}, phone: false }, x); };
  Object.assign(PED, {
    uncle: (r, pick) => uncle(r, pick), auntie: (r, pick) => auntie(r, pick),
    auntie_dance: (r, pick) => auntie(r, pick, { /* one troupe, forty different women: the red team polo is the only thing they agreed on — trousers, shoes, sun sleeves, visors and hair are their own */ top: TOP('polo', pick([0xc22a26, 0xc22a26, 0xc22a26, 0xb4242a, 0xcc3428]), { trim: 0xf2c84a, slEnd: pick([.19, .19, .22, .17]) }), bottom: BOT(pick(['trousers', 'trousers', 'trousers', 'capri', 'leggings']), pick([0x17181b, 0x17181b, 0x23272e, 0x1c2436, 0x3a2030, 0x2a2c30]), { off: .014, open: .074 }), shoes: pick([SNK(0xeceae2, 0xeceae2, { rough: .5 }), SNK(0xeceae2, 0xeceae2, { rough: .5 }), SNK(0xc22a26, 0xeceae2, { rough: .5 }), SNK(0x17171a, 0xd6d2c6), { type: 'flat', col: 0x17171a, sole: 0xe8e4d8, rough: .9 }, SNK(0xe8a0b0, 0xeceae2)]),
      hat: r() < .22 ? 'visor' : null, hatCol: pick([0xc22a26, 0xeceae2, 0xe8a0b0, 0xf2c84a]), socks: r() < .3 ? .7 : undefined, hair: hairOf(pick(['curly', 'curly', 'bob', 'bun', 'tied', 'pony']), pick(HAIR_DYE.concat(HAIR_GREY))), kit: { patches: [PCH('dance', 1.3, .26, .104, true)], propL: 'fan', propR2: 'fan', keepR: true, fanCol: 0xd8281e } }),
    auntie_lead: (r, pick) => auntie(r, pick, { height: 1.6, top: TOP('polo', 0xf2c84a, { trim: 0xc22a26, slEnd: .19 }), bottom: BOT('trousers', 0x17181b, { off: .014, open: .074 }), shoes: SNK(0xeceae2, 0xeceae2, { rough: .5 }), hat: 'visor', hatCol: 0xc22a26, hair: hairOf('pony', 0x2a1d15), kit: { patches: [PCH('dance', 1.3, .26, .104, true)], propL: 'fan', propR2: 'fan', keepR: true, fanCol: 0xf2c84a, fanny: 0x1c1c20, headphones: 0x1c1c20 } }),
    swim_uncle: (r, pick) => ({ cn: true, height: 1.64 + r() * .1, sh: .19, bulk: 1.02 + r() * .16, belly: .04 + r() * .06, chest: .008, face: pick(['old', 'stubble', 'old']), skin: pick(SKIN_TAN), hair: hairOf(pick(['buzz', 'sides', 'short']), pick(HAIR_GREY)), hat: r() < .7 ? 'swimcap' : null, hatCol: pick([0xe0661c, 0xe8c020, 0xc8281e, 0x2463c0]),
      top: TOP('bare'), bottom: BOT('brief', pick([0x17203a, 0x17171a, 0x8a1c1c, 0x1c4a6a])), shoes: BAREF, kit: { goggles: pick([0x1a4a8a, 0x1a1a1c]), aux: 'buoy', towel: r() < .35 ? pick([0xe2ddd0, 0x3a7a9a]) : undefined }, phone: false }),
    angler_cn: (r, pick) => ({ cn: true, height: 1.66 + r() * .1, sh: .186, bulk: 1.04, belly: .045, stoop: .06, face: pick(['old', 'stubble', 'glasses']), skin: pick(SKIN_TAN), hair: hairOf('short', pick(HAIR_GREY.concat(HAIR_BLK))), hat: pick(['bucket', 'bucket', 'cap']), hatCol: pick([0x5a5f44, 0x858269, 0x3a4032]),
      top: TOP('long', pick([0x9aa88a, 0xa8a090, 0x7a8a98, 0xc8c0a8]), { off: .013 }), bottom: BOT('trousers', pick([0x4a4d44, 0x5a5444, 0x3a3d42])), shoes: SNK(pick([0x3a3d32, 0x2a2a2c]), 0x8a8474), kit: { hivis: pick([0x6a6a4a, 0x5a6048, 0x7a7258]), plainVest: true, aux: 'rod' }, phone: false }),
    chess_uncle: (r, pick) => uncle(r, pick, { face: pick(['old', 'old', 'stubble']), kit: r() < .5 ? { propL: 'thermos', specs: r() < .4 ? 0x2a2a2c : undefined } : { specs: r() < .4 ? 0x2a2a2c : undefined } }),
    bird_uncle: (r, pick) => uncle(r, pick, { face: 'old', hair: hairOf('sides', pick(HAIR_GREY)), top: TOP('guayabera', pick([0xe2ded2, 0xc8ccc0, 0xb8c4cc])), bottom: BOT('trousers', pick([0x3a3d42, 0x2a2c30])), shoes: CLOTH_SHOE, kit: { propL: 'birdcage' } }),
    whip_uncle: (r, pick) => uncle(r, pick, { bulk: 1.08, belly: .03, stoop: 0, face: 'stubble', hair: hairOf('buzz', pick(HAIR_GREY)), top: TOP('tank', 0xe9e6dc, { rough: .92, strap: .04 }), bottom: BOT('shorts', 0x23272e, { len: .36 }), shoes: SNK(0xe6e2d8, 0xd6d2c6), kit: { propR2: 'whip', keepR: true, aux: 'top' } }),
    pengci: (r, pick) => uncle(r, pick, { height: 1.62, bulk: .9, belly: .01, stoop: .2, face: 'old', hair: hairOf('sides', 0xc9c7c0), hat: 'cap', hatCol: 0x3a3d42, beard: { col: 0xc9c7c0, th: .005, len: .012 }, top: TOP('jacket', 0x4a4f58, { rough: .9, placket: true, btn: 0x2a2c30 }), bottom: BOT('trousers', 0x2a2c30, { off: .014 }), shoes: CLOTH_SHOE, kit: {} }),
    streamer_f: (r, pick) => ({ cn: true, female: true, height: 1.62 + r() * .06, sh: .162, hp: .087, bulk: .9, armBulk: .9, chest: .01, face: 'female', skin: SKIN_CN[0], hair: hairOf(pick(['long', 'wavy', 'pony']), pick([0xb88a6a, 0xd89aa8, 0x2a1d15, 0x8a5a3a])), hat: r() < .4 ? 'bucket' : null, hatCol: pick([0xf2ead8, 0xe8b8c8, 0x17171a]),
      top: TOP(pick(['crop', 'fitted', 'tankf']), pick([0xf2ead8, 0xe8b8c8, 0xc8d8f0, 0x17171a, 0xd8e8c0])), bottom: r() < .5 ? BOT('hot', pick([0x5e6e7c, 0x17171a, 0xe8e4d8]), { off: .008 }) : BOT('slim', pick([0x2b3649, 0xe8e4d8])), shoes: SNK(0xeceae2, 0xeceae2, { toe: 0xe8b8c8 }), socks: .7, watch: 0xe8b8c8,
      kit: { propR2: 'selfie', keepR: true, aux: 'ringlight', sling: 0xe8e4d8, earrings: 0xd8d8dc }, phone: false }),
    streamer_m: (r, pick) => ({ cn: true, height: 1.72 + r() * .08, sh: .184, bulk: .92, face: pick(['male', 'stubble']), hair: hairOf(pick(['quiff', 'mop', 'fade']), pick([0xc8a868, 0x2a1d15, 0x8a8f94])), top: TOP(pick(['baggy', 'hoodie']), pick([0xe8b41c, 0x17171a, 0x6a5a82, 0xeceae2])), bottom: BOT('jeans', pick([0x17171a, 0x45525f]), { off: .014, open: .08 }), shoes: SNK(pick([0xeceae2, 0xd8442c]), 0xeceae2),
      kit: { propR2: 'gimbal', keepR: true, headphones: 0xeceae2 }, phone: false }),
    tourist_cn: (r, pick) => { const f = r() < .5; return Object.assign({ cn: true, height: f ? 1.56 + r() * .08 : 1.66 + r() * .1, bulk: 1 + r() * .14, belly: f ? .02 : .045, face: f ? 'female' : pick(['glasses', 'male', 'old']), hat: f && r() < .4 ? 'sunhat' : 'cap', hatCol: 0xd8281e, hatBand: 0xd8281e, hair: hairOf(f ? pick(['bob', 'curly', 'tied']) : 'short', pick(HAIR_BLK.concat(HAIR_GREY))), socks: .68,
      top: TOP(f ? pick(['tee', 'long', 'polo']) : pick(['polo', 'tee', 'shirt']), pick([0xd8d4c8, 0x4a6a8a, 0xb85c46, 0x7a8a5a, 0xc8a0b0, 0x8a8f94, 0xe8dcb0])), bottom: f ? BOT('capri', pick([0x23272e, 0x5e6e7c, 0xd8d4c8])) : BOT(pick(['cargo', 'trousers']), pick(C_KHAKI)), shoes: SNK(pick([0xd8d5cc, 0x8a9aa8, 0x3a4658]), 0xd6d2c6),
      kit: Object.assign({ screen: true }, f ? { cuffs: 0xeceae2, tote: pick([0xc8b88a, 0x8a3a4a]) } : (r() < .5 ? { sling: 0x2a2c30 } : { backpack: pick([0x2a2c30, 0x4a3a2a]) })) }, f ? { female: true, sh: .166, hp: .092 } : {}); },
    guide: () => ({ cn: true, female: true, height: 1.62, sh: .164, hp: .088, bulk: .94, face: 'female', hair: hairOf('pony', 0x1a1512), hat: 'cap', hatCol: 0xd8281e, top: TOP('polo', 0xf2c81c, { trim: 0xd8281e }), bottom: BOT('slim', 0x2b3649), shoes: SNK(0xeceae2, 0xeceae2), kit: { propL: 'flag', fanny: 0xd8281e, lanyard: 0xd8281e, headphones: 0x1c1c20 }, phone: false }),
    match_parent: (r, pick) => { const f = r() < .6, b = f ? auntie(r, pick) : uncle(r, pick); return Object.assign(b, { hat: r() < .45 ? (f ? 'sunhat' : 'cap') : null, hatCol: f ? 0xd6c8a0 : 0x4a4d52, kit: Object.assign({}, b.kit, { propL: 'paper', paperCell: f ? 'ad1' : 'ad2', aux: 'mazha', tote: f ? 0x8a7a5a : undefined }) }); },
    chengguan: (r, pick) => ({ cn: true, height: 1.72 + r() * .08, sh: .194, bulk: 1.06 + r() * .1, belly: .03 + r() * .04, face: pick(['male', 'stubble', 'glasses']), hair: hairOf('buzz', pick(HAIR_BLK)), hat: 'cap_police', hatCol: 0x151a28, watch: true,
      top: TOP('uniform', 0x1a2030, { placket: false }), bottom: BOT('trousers', 0x141925, { open: .068, rough: .85 }), shoes: { type: 'boot', col: 0x0c0c0d, sole: 0x0a0a0a, rough: .4 }, kit: { belt: 1, badge: 1, pistol: 1, patches: [PCH('cg', 1.3, .25, .118, true)] }, phone: false }),
    vendor: (r, pick) => { const f = r() < .5; return Object.assign(f ? auntie(r, pick) : uncle(r, pick), { skin: pick(SKIN_TAN), stoop: .04, hat: 'sunhat', hatCol: 0xcdbf9a, hatBand: 0x5a4a3a, top: TOP('long', pick([0x7a8a9a, 0x9a6a6a, 0x6a7a5a, 0x8a8478]), { off: .013 }), bottom: BOT('trousers', 0x2a2c30), shoes: SNK(0x3a3d42, 0x8a8474), kit: { apron: pick([0x3a5a7a, 0x7a3a3a]), apronWaist: true, cuffs: 'print', fanny: 0x2a2420, aux: 'fruitcart' } }); },
    rider_y: (r, pick) => ({ cn: true, height: 1.66 + r() * .12, sh: .184, bulk: .94 + r() * .12, face: pick(['male', 'stubble', 'male']), skin: pick(SKIN_TAN.concat(SKIN_CN)), hair: hairOf('short', pick(HAIR_BLK)), hat: 'helmet', hatCol: 0xf0b81c,
      top: TOP('jacket', 0xf0b81c, { rough: .62, placket: false, trim: 0x16130e }), bottom: BOT(pick(['jeans', 'trousers']), pick([0x23272e, 0x2b3649, 0x3a3d42])), shoes: SNK(pick([0x17171a, 0x3a3d42]), 0xd6d2c6), kit: { ears: r() < .6 ? 0xf0b81c : undefined, sling: 0x17171a, patches: [PCH('pdk', 1.3, .25, .118, true), PCH('pdks', 1.31, .062, .062, false, .085)], screen: true } }),
    rider_b: (r, pick) => ({ cn: true, height: 1.66 + r() * .12, sh: .184, bulk: .94 + r() * .12, face: pick(['male', 'stubble', 'glasses']), skin: pick(SKIN_TAN.concat(SKIN_CN)), hair: hairOf('short', pick(HAIR_BLK)), hat: 'helmet', hatCol: 0x2463c0,
      top: TOP('jacket', 0x2463c0, { rough: .62, placket: false, trim: 0xe8ecf2 }), bottom: BOT(pick(['jeans', 'trousers']), pick([0x23272e, 0x2b3649])), shoes: SNK(0x17171a, 0xd6d2c6), kit: { sling: 0x17171a, patches: [PCH('msd', 1.3, .25, .118, true), PCH('msds', 1.31, .062, .062, false, .085)], screen: true } }),
    daijia: (r, pick) => ({ cn: true, height: 1.68 + r() * .1, sh: .186, bulk: 1 + r() * .1, belly: .02, face: pick(['stubble', 'male', 'glasses']), hair: hairOf('short', pick(HAIR_BLK)), hat: 'helmet', hatCol: 0x1c1c20, top: TOP('long', 0x2a2c30, { off: .011 }), bottom: BOT('trousers', 0x1c1c20), shoes: SNK(0x17171a, 0x2a2a2c),
      kit: { hivis: 0x1c1c20, patches: [PCH('dj', 1.3, .23, .12, true)], aux: 'foldbike', lanyard: 0xf08a1c, screen: true } }),
    bangbang: (r, pick) => ({ cn: true, height: 1.62 + r() * .08, sh: .186, bulk: .94, armBulk: 1.04, belly: .01, stoop: .08, face: pick(['stubble', 'old']), skin: pick(SKIN_TAN), hair: hairOf(pick(['buzz', 'short']), pick(HAIR_BLK.concat(HAIR_GREY))), top: TOP(pick(['tee', 'tank']), pick([0x5a6648, 0x6a6e60, 0x7a7468]), { rough: .95 }), bottom: BOT('trousers', pick([0x3a4032, 0x3a3d42]), { crop: true, off: .014 }), shoes: LIBERATION(),
      kit: { towel: 0xd8d4c8, towel2: 0xc8c4b8, aux: 'pole', propL: r() < .5 ? 'cig' : undefined }, phone: false }),
    sanitation: (r, pick) => { const f = r() < .5; return { cn: true, female: f, height: f ? 1.56 : 1.66 + r() * .06, sh: f ? .168 : .184, hp: f ? .094 : .09, bulk: 1.04, belly: .03, stoop: .08, face: f ? 'female' : 'old', skin: pick(SKIN_TAN), hair: hairOf(f ? 'tied' : 'short', pick(HAIR_GREY.concat(HAIR_BLK))), hat: pick(['sunhat', 'cap']), hatCol: f ? 0xcdbf9a : 0xe2621c, hatBand: 0xe2621c, gloves: 0xd8d4c8,
      top: TOP('long', 0x5a6a80, { off: .013 }), bottom: BOT('trousers', 0x4a5868), shoes: SNK(0x2a2a2c, 0x3a3a3a), kit: { hivis: 0xe2621c, patches: [PCH('hw', 1.3, .24, .112, true)], aux: 'bbroom' }, phone: false }; },
    guard_cn: (r, pick) => ({ cn: true, height: 1.66 + r() * .12, sh: .188, bulk: .92 + r() * .26, belly: r() * .06, face: pick(['male', 'old', 'stache', 'stubble']), hair: hairOf('buzz', pick(HAIR_BLK.concat(HAIR_GREY))), hat: 'cap_police', hatCol: 0x141a26,
      top: TOP('uniform', 0x1c2436, { placket: false }), bottom: BOT('trousers', 0x141a26, { open: .07 }), shoes: { type: 'boot', col: 0x0c0c0d, sole: 0x0a0a0a, rough: .5 }, kit: { belt: 'plain', badge: 'guard', patches: [PCH('ba', 1.3, .2, .12, true)], armband: true, torch: 1 }, phone: false }),
    student: (r, pick) => { const f = r() < .5; return { cn: true, female: f, height: 1.5 + r() * .16, headK: 1.05, sh: f ? .16 : .172, hp: .086, bulk: .86 + r() * .1, armBulk: .86, legBulk: .88, face: f ? 'female' : 'male', hair: hairOf(f ? pick(['pony', 'bob', 'tied']) : pick(['short', 'mop', 'buzz']), pick(HAIR_BLK)),
      top: TOP('jacket', 0xeeeee8, { slCol: 0x1d4fa0, trim: 0x1d4fa0, placket: false, rough: .7, off: .02 }), bottom: BOT('trousers', 0x1d4fa0, { stripe: 0xeeeee8, off: .016, open: .078, rough: .7 }), shoes: SNK(pick([0xeceae2, 0x17171a, 0xd8442c]), 0xeceae2), kit: { backpack: pick([0x2a2c30, 0x8a2a3a, 0x2c4a7a, 0x4a6a3a]), patches: [PCH('school', 1.33, .2, .09, false)], specs: r() < .4 ? 0x1a1a1c : undefined, screen: true } }; },
    office_m: (r, pick) => ({ cn: true, height: 1.68 + r() * .12, sh: .186, bulk: .96 + r() * .14, belly: r() * .05, face: pick(['male', 'stubble', 'male']), hair: hairOf(pick(['short', 'slick', 'quiff']), pick(HAIR_BLK)), watch: true, top: TOP('shirt', pick([0xeceae2, 0xc8d8ec, 0xd8dce4]), { sl: 'long', slOff: .013, hem: 1.03, blouse: true }), bottom: BOT('trousers', pick([0x23272e, 0x2b3040, 0x3a3d42])), shoes: { type: 'flat', col: 0x1a1512, sole: 0x17171a, rough: .35 },
      kit: { lanyard: true, belt: 'plain', backpack: r() < .6 ? 0x23272e : undefined, propL: pick(['coffee', 'cup']), cupCol: 0xe8dcc8, specs: r() < .45 ? 0x1a1a1c : undefined, screen: true } }),
    office_f: (r, pick) => ({ cn: true, female: true, height: 1.58 + r() * .1, sh: .162, hp: .088, bulk: .9 + r() * .08, armBulk: .9, chest: .008, face: 'female', hair: hairOf(pick(['long', 'bob', 'pony', 'wavy']), pick(HAIR_BLK.concat([0x3a2418]))), top: TOP('long', pick([0xeceae2, 0xe8d0d4, 0xc8d8ec, 0xd8c8a8]), { off: .008, hem: 1.0 }), bottom: r() < .5 ? BOT('slim', pick([0x23272e, 0xc8b89a])) : BOT('capri', 0x23272e),
      shoes: { type: 'flat', col: pick([0x17171a, 0xc9b99a]), sole: 0x3a2a1c, rough: .4 }, kit: { lanyard: true, tote: pick([0x2a2c30, 0xc8b88a, 0x8a3a4a]), propL: 'cup', cupCol: 0xe8dcc8, screen: true } }),
    granny: (r, pick) => auntie(r, pick, { height: 1.48 + r() * .06, stoop: .2, bulk: 1.04, hair: hairOf(pick(['bun', 'curly', 'bob']), pick(HAIR_GREY)), top: TOP('aloha', pick([0xf2dcd8, 0xe4d8f0, 0xf0e4c0]), { slEnd: .23, off: .018 }), bottom: BOT('trousers', pick([0x23272e, 0x3a3440]), { off: .016 }), shoes: CLOTH_SHOE, kit: { aux: 'trolley', propL: 'plasticbag', cuffs: r() < .5 ? 0x4a6a8a : undefined } }),
    kid: (r, pick) => ({ cn: true, height: .98 + r() * .12, headK: 1.3, sh: .15, hp: .08, bulk: .92, armBulk: .9, legBulk: .92, belly: .02, face: 'male', hair: hairOf(pick(['mop', 'short', 'bob']), pick(HAIR_BLK)), hat: 'helmet', hatCol: pick([0xd8442c, 0x2a8ac8, 0xe8c020, 0xe87aa0]), top: TOP('tee', pick([0xe8c020, 0x4aa8d8, 0xe87aa0, 0x6ac86a, 0xf0f0ea])), bottom: BOT('shorts', pick([0x2b3649, 0x8a8f94, 0xd8442c]), { len: .3 }), socks: .7,
      shoes: SNK(pick([0xeceae2, 0xd8442c, 0x2a8ac8]), 0xeceae2), kit: { aux: 'balance_bike', bikeCol: pick([0xd8442c, 0x2a8ac8, 0x6ac86a, 0xe8c020]) }, phone: false }),
    traffic_police: (r, pick) => ({ cn: true, height: 1.76 + r() * .06, sh: .196, bulk: 1.06, belly: .02, face: pick(['male', 'glasses']), hair: hairOf('buzz', pick(HAIR_BLK)), hat: r() < .7 ? 'cap_police' : null, hatCol: 0x151a28, top: TOP('uniform', 0x1a2030, { placket: false }), bottom: BOT('trousers', 0x141925, { open: .068, rough: .85 }), shoes: { type: 'boot', col: 0x0c0c0d, sole: 0x0a0a0a, rough: .35 },
      kit: { belt: 1, badge: 1, pistol: 1, torch: 1, patches: [PCH('jj', 1.3, .2, .12, true)], keepR: true }, phone: false }),   /* a patrol officer of a fictional American city: dark navy shirt and trousers, badge, duty belt with holster and torch, POLICE across the back */
    dog_owner: (r, pick) => ({ cn: true, female: true, height: 1.6 + r() * .06, sh: .162, hp: .088, bulk: .92, armBulk: .9, face: 'female', hair: hairOf(pick(['long', 'pony']), pick(HAIR_BLK)), hat: r() < .5 ? 'cap' : null, hatCol: 0xeceae2, top: TOP('hoodie', pick([0xd8c8d8, 0xc8d8c8, 0xe8dcc8])), bottom: BOT('leggings', 0x17181b), shoes: SNK(0xeceae2, 0xeceae2), kit: { propL: 'cup', cupCol: 0xe8dcc8, screen: true } }),
    dog: (r, pick) => ({ cn: true, dog: true, height: .5 + r() * .07, fur: pick([0xc8915a, 0xe8dcc4, 0x3a2e24, 0xd8b48a, 0xa8703a]), fur2: 0xf0e8d8, jacket: pick([0xc8281e, 0xe8b41c, 0x2a6ac8, 0xd86a8a]), hair: null, top: TOP('bare'), bottom: BOT('none'), shoes: BAREF, phone: false }),
    /* ---- named characters */
    lajie: () => ({ cn: true, named: '辣姐', female: true, height: 1.66, sh: .172, hp: .092, bulk: 1.02, armBulk: 1, chest: .014, face: 'female', skin: SKIN_CN[1], hair: hairOf('bun', 0x17120f), watch: 0xd8a82c, top: TOP('shirt', 0xa81c22, { slEnd: .17, rough: .62, btn: 0xd8a82c }), bottom: BOT('slim', 0x17171a), shoes: { type: 'flat', col: 0x17171a, sole: 0x2a2018, rough: .45 },
      kit: { apron: 0x4a1012, apronWaist: true, patches: [PCH('lajie', 1.3, .25, .122, true)], earrings: true, chain: 0xd8a82c, chainR: .0032, chainY: 1.34, propR2: 'ladle', keepR: true, cuffs: 0x2a2420 }, phone: false }),
    guaizi: () => ({ cn: true, named: '拐子哥', height: 1.74, sh: .198, bulk: 1.14, armBulk: 1.12, belly: .075, chest: .012, face: 'stubble', skin: SKIN_TAN[0], hair: hairOf('buzz', 0x17120f), top: TOP('tank', 0xeceae2, { rough: .92, strap: .042, neck: 1.39 }), bottom: BOT('cargo', 0x2a3040, { len: .44 }), shoes: FLIP(0x2c4a7a),
      kit: { apron: 0x23304a, apronWaist: true, towel: 0xe8e4d8, towel2: 0xd8d4c8, patches: [PCH('guaizi', 1.2, .2, .1, false)], propR2: 'tongs', keepR: true, propL: 'bowl' }, watch: 0x8a8d92, phone: false }),
    yeshu: () => ({ cn: true, named: '爷叔', height: 1.72, sh: .184, bulk: .95, belly: .015, stoop: .05, face: 'old', skin: SKIN_CN[0], hair: hairOf('slick', 0xc9c7c0), hat: 'panama', hatCol: 0xe4dcc4, hatBand: 0x2a2622, watch: 0xd8a82c, top: TOP('jacket', 0xd9cfb4, { rough: .93, placket: true, btn: 0x8a7a5a, off: .02, hem: .86 }), bottom: BOT('trousers', 0xd4cab0, { off: .013, open: .07, rough: .93 }), shoes: { type: 'flat', col: 0x6a3f24, sole: 0x2a1c12, rough: .3, toe: 0xe8e0cc },
      kit: { lapel: { shirt: 0xf2efe6, tie: 0x6a2a2a, square: 0x8a2a2a, y: 1.16 }, specs: true, propR2: 'cane', keepR: true }, phone: false }),
    mange: () => ({ cn: true, named: '满哥', height: 1.7, sh: .19, bulk: 1.08, belly: .05, face: 'stache', skin: SKIN_CN[2], hair: hairOf('mop', 0x17120f), hat: 'bandana', hatCol: 0xb8281e, top: TOP('aloha', 0xfff0d0, { slEnd: .2 }), bottom: BOT('cargo', 0x3a3d42, { len: .42 }), shoes: FLIP(0x2a2420), watch: true,
      kit: { apron: 0x16130f, patches: [PCH('mange', 1.2, .19, .095, false, 0)], fanny: 0x2a2420, propR2: 'tongs', keepR: true, propL: 'cig', chain: 0xd8a82c, chainR: .003, chainY: 1.36 }, phone: false }),
    ertong: () => ({ cn: true, named: '二筒', height: 1.86, sh: .206, bulk: 1.14, armBulk: 1.16, legBulk: 1.06, belly: .02, chest: .014, face: 'stubble', skin: SKIN_CN[2], shades: 0x0a0a0c, hair: hairOf('fade', 0x14110f), beard: { th: .005, full: true }, watch: 0xd8a82c, top: TOP('jacket', 0x15120f, { rough: .3, placket: false, off: .021, hem: .9 }), bottom: BOT('slim', 0x121214, { off: .008 }), shoes: { type: 'boot', col: 0x0c0c0d, sole: 0x0a0a0a, rough: .3 },
      kit: { lapel: { shirt: 0x1a1a1c, col: 0x1c1814, y: 1.12 }, chain: true, chainR: .0075, chainY: 1.25, belt: 'plain', propL: 'cig' } }),
    thug: (r, pick) => ({ cn: true, height: 1.72 + r() * .14, sh: .194 + r() * .01, bulk: 1.04 + r() * .16, armBulk: 1.12, belly: r() * .04, face: pick(['stubble', 'male', 'stache']), shades: r() < .35, hair: hairOf(pick(['buzz', 'fade', 'quiff', 'topknot']), pick([0x14110f, 0x14110f, 0xc8a868, 0x8a2a1c])), top: TOP(pick(['tee', 'fitted', 'tank']), 0x141416, { rough: .85 }), bottom: BOT(pick(['jeans', 'trousers']), pick([0x17171a, 0x23272e]), r() < .5 ? { stripe: 0xe8e4d8 } : null), shoes: SNK(pick([0x17171a, 0xeceae2]), 0xd6d2c6),
      kit: { patches: [PCH('hao', 1.3, .25, .1, true)], chain: r() < .6 ? pick([0xd8a82c, 0xb8bcc0]) : undefined, chainR: .004, propR2: r() < .6 ? 'pipe' : undefined, keepR: true }, phone: false })
  });
  const CN_TYPES = ['auntie_dance', 'auntie_lead', 'swim_uncle', 'angler_cn', 'chess_uncle', 'uncle', 'auntie', 'bird_uncle', 'whip_uncle', 'pengci', 'streamer_f', 'streamer_m', 'tourist_cn', 'guide', 'match_parent', 'chengguan', 'vendor', 'rider_y', 'rider_b', 'daijia', 'bangbang', 'sanitation', 'guard_cn', 'student', 'office_m', 'office_f', 'granny', 'kid', 'dog_owner', 'dog', 'traffic_police', 'thug'], CN_NAMED = ['lajie', 'guaizi', 'yeshu', 'mange', 'ertong'];
  const PED_TYPES = Object.keys(PED), LEGACY = ['tourist', 'jogger', 'skater', 'oldman', 'sundress', 'worker'];
  function specFor(kind, o) { const seed = o.seed === undefined ? 0 : o.seed, r = GT.rng('people:' + kind + ':' + (o.type || '') + ':' + seed), pick = a => a[(r() * a.length) | 0];
    const sp = { kind, female: false, height: 1.76 + r() * .08, sh: .19, hp: .09, bulk: 1, belly: 0, stoop: 0, skin: pick(SKIN), face: 'male', hair: hairOf('short', pick(HAIRC.slice(0, 4))), hat: null,
      top: TOP('tee', 0x55606c, { off: .008, hem: .895, slOff: .012, slEnd: .165 }), bottom: BOT('jeans', 0x2b3649), shoes: SNK(0x2a2a2c, 0xcfcabd), kit: {} };
    if (kind === 'partner') { const mask = o.mask !== false; Object.assign(sp, { height: 1.8, sh: .193, bulk: 1.03, skin: SKIN[1], face: mask ? 'mask' : 'stubble', mask, hood: true, noEars: true, hair: null, gloves: 0x0e0e10,
        top: TOP('hoodie', o.color !== undefined ? o.color : 0x26282c, { off: .021 }), bottom: BOT('jeans', 0x222a38, { off: .01, open: .068, fade: .3 }), shoes: SNK(0x151517, 0xc8c3b6) });
      if (o.bag !== false) sp.kit.bag = 0x1f2125; }
    else if (kind === 'clerk') { Object.assign(sp, { height: 1.72, bulk: .97, belly: .012, face: seed % 2 ? 'stubble' : 'male', hair: hairOf(seed % 3 === 1 ? 'buzz' : 'short', pick(HAIRC.slice(0, 3))),
        top: TOP('polo', o.color !== undefined ? o.color : 0x2c5a55, { placket: false }), bottom: BOT('trousers', 0x5d5646), shoes: SNK(0x1c1c1e, 0x2a2a2c) });
      sp.kit.apron = 0x23262c; sp.kit.tag = 0xa83a32; }
    else if (kind === 'cop') { Object.assign(sp, { height: 1.84, sh: .2, bulk: 1.1, belly: .012, face: seed % 2 ? 'stache' : 'glasses', hair: hairOf('buzz', pick(HAIRC.slice(0, 3))), hat: 'cap_police',
        top: TOP('uniform', 0x1a2030, { placket: false }), bottom: BOT('trousers', 0x141925, { open: .068, rough: .85 }), shoes: { type: 'boot', col: 0x0c0c0d, sole: 0x0a0a0a, rough: .35 } });
      sp.kit.belt = 1; sp.kit.badge = 1; sp.kit.pistol = 1; sp.kit.torch = 1; }
    else if (kind === 'driver') { Object.assign(sp, { height: 1.76, face: seed % 3 === 0 ? 'glasses' : seed % 3 === 1 ? 'stubble' : 'male', top: TOP('tee', pick([0x5f6468, 0x7a6a58, 0x3d4a5a, 0x8a8478, 0x4a5548]), { off: .008, hem: .895, slOff: .012, slEnd: .165 }) });
      if (seed % 4 === 3) sp.hat = 'cap'; }
    else { const type = o.type !== undefined && PED[o.type] ? o.type : LEGACY[((seed % 6) + 6) % 6]; sp.type = type; const a = PED[type](r, pick), kit = a.kit || {}; Object.assign(sp, a); sp.kit = kit;
      if (a.skin === undefined) sp.skin = pick(a.cn ? SKIN_CN : SKIN); if (!sp.bottom) sp.bottom = sp.top.skirt ? BOT('none') : BOT('hot', pick(C_DENIM), { off: .008 });
      if (a._same) { if (sp.bottom.type === 'brief') sp.bottom.col = sp.top.col; delete sp._same; } if (a._lg) { if (sp.female) { sp.sh = .166; sp.bulk = .94; sp.armBulk = .92; sp.face = 'female'; sp.top = TOP('tankf', 0xb3242c, { hem: .93 }); sp.bottom = BOT('run', 0xb3242c, { len: .14 }); } delete sp._lg; } delete sp._pf;
      if (o.phone !== false && a.phone !== false) sp.kit.phone = pick([0x0c0d10, 0x0c0d10, 0xd8d4c8, 0x8a2a3a, 0x2c4a5a]); delete sp.phone; }
    if (o.skin !== undefined) sp.skin = o.skin; if (o.color !== undefined && kind !== 'partner' && kind !== 'clerk') sp.top = Object.assign({}, sp.top, { col: o.color }); if (o.hat !== undefined) sp.hat = o.hat; if (o.shades !== undefined) sp.shades = o.shades;
    if (o.kit) sp.kit = Object.assign({}, sp.kit, o.kit); if (o.height) sp.height = o.height;
    if (sp.shades && (sp.face === 'glasses' || sp.face === 'fglasses')) sp.face = sp.female ? 'female' : 'stubble';
    sp.key = ''; sp.key = JSON.stringify(sp); return sp; }

  /* ------------------------------------------------------------------ pose helpers (round 2) */
  const clr3 = (P, b) => { P[b * 3] = P[b * 3 + 1] = P[b * 3 + 2] = 0; };
  /** absolute arm pose (clears the standing default). side +1 = left, -1 = right; values in left-arm convention: ax<0 raises forward, ay>0 turns the forearm outward, az>0 abducts, fx<0 bends the elbow, yaw>0 swings across the body */
  const arm = (P, side, ax, ay, az, fx, yaw) => { const a = side > 0 ? ARM : ARM + 4; clr3(P, a); clr3(P, a + 1); P[a * 3] = ax; P[a * 3 + 1] = side * ay; P[a * 3 + 2] = side * az; P[(a + 1) * 3] = fx; P[side > 0 ? YAL : YAR] = -side * (yaw || 0); };
  const pulse = (t, per, on, edge) => { const x = ((t % per) + per) % per, e = edge || .5; return sm(x, 0, e) * (1 - sm(x, on, on + e)); };
  /* ------------------------------------------------------------------ procedural poses */
  const gw = (p, c, w) => { const d = ((p - c + 1.5) % 1) - .5; return Math.exp(-(d * d) / (w * w)); };
  const WALK_FOOT = [[0, -.34], [.07, -.05], [.14, 0], [.4, .02], [.5, .3], [.6, .86], [.68, .76], [.8, .25], [.92, -.24], [1, -.34]];
  const RUN_FOOT = [[0, -.1], [.08, 0], [.2, .06], [.3, .46], [.4, 1.0], [.55, 1.25], [.75, .5], [.9, 0], [1, -.1]];
  const set = (P, b, x, y, z) => { P[b * 3] += x; P[b * 3 + 1] += y; P[b * 3 + 2] += z; };
  const both = (P, b, x, y, z) => { set(P, b, x, y, z); set(P, mir(b), x, -y, -z); };
  const sideSet = (P, side, b, x, y, z) => side > 0 ? set(P, b, x, y, z) : set(P, mir(b), x, -y, -z);   // values given for the LEFT limb, mirrored for the right
  function stand(P, c, arms) { if (arms !== false) { both(P, ARM, .04, -.15, .065); both(P, FORE, -.3, 0, 0); } both(P, THIGH, 0, .13, .035); P[CLAMP] = 1;
    const s = c.sp.stoop; if (s) { P[SPINE * 3] += s * .55; P[CHEST * 3] += s * .6; P[NECK * 3] -= s * .25; P[HEAD * 3] -= s * .45; P[HIPS * 3] += s * .12; both(P, THIGH, -s * .1, 0, 0); both(P, SHIN, s * .2, 0, 0); } }
  function sway(P, c, k) { const t = c.t, s = sin(t * .31 + c.sd), w = clamp(s * 2.6, -1, 1) * k, wl = Math.max(0, w), wr = Math.max(0, -w);
    P[HX] += .03 * w; P[HIPS * 3 + 2] += .05 * w; P[SPINE * 3 + 2] -= .032 * w; P[CHEST * 3 + 2] -= .028 * w; P[HEAD * 3 + 2] += .012 * w;
    set(P, THIGH + 3, -.17 * wl, 0, -.03 * wl); set(P, SHIN + 3, .36 * wl, 0, 0); P[FPR] += .16 * wl; set(P, THIGH, -.17 * wr, 0, .03 * wr); set(P, SHIN, .36 * wr, 0, 0); P[FPL] += .16 * wr;
    P[HEAD * 3 + 1] += .14 * sin(t * .23 + c.sd * 2) + .05 * sin(t * .71 + c.sd); P[HEAD * 3] += .03 * sin(t * .4 + c.sd); P[CHEST * 3 + 1] += .03 * sin(t * .19 + c.sd);
    set(P, ARM, .03 * sin(t * .5 + c.sd), 0, 0); set(P, ARM + 4, .03 * sin(t * .43 + c.sd + 2), 0, 0); }
  /* street muscle waiting for trouble (m1's thugs stood in the neutral pose): feet planted wide, weight back on the heels, shoulders rolled forward and the chin down so he looks up from under his brows;
     the arms never hang straight — squared off and held away from the body, or folded across the chest when the right hand is empty, the pipe hand flexing; now and then the neck rolls */
  function thugStance(P, c) { const t = c.t + c.sd * 7, v3 = ((c.sd * 5.3) | 0) % 3, holds = !!(c.sp.kit && c.sp.kit.propR2), roll = pulse(t, 11 + (c.sd % 3), 1.1, .5), fl = .5 + .5 * sin(t * 1.3);
    both(P, THIGH, .02, .1, .075); both(P, SHIN, .05, 0, 0); P[HIPS * 3] -= .03; P[SPINE * 3] += .07; P[CHEST * 3] += .06; P[NECK * 3] += .1; P[HEAD * 3] += .06 - .1 * roll; P[HEAD * 3 + 2] += .22 * roll * (v3 === 1 ? -1 : 1); both(P, CLAV, 0, 0, .13);
    if (v3 === 1 && !holds) { arm(P, 1, -.42, -.2, .12, -1.85, .82); arm(P, -1, -.3, -.2, .16, -1.7, .74); P[CHEST * 3] -= .04; }                                          /* arms folded */
    else if (v3 === 2) { arm(P, 1, .16, .1, .34, -1.05, -.1); arm(P, -1, -.06 - .03 * fl, -.2, .2, -.5 - .1 * fl, 0); P[HIPS * 3 + 2] += .05; P[SPINE * 3 + 2] -= .04; }   /* a fist on the hip, the other hand working */
    else { arm(P, 1, -.03, -.25, .24, -.5 - .06 * fl, 0); arm(P, -1, -.03, -.25, .24, -.55 - .08 * (1 - fl), 0); } }                                                           /* squared off, elbows out */
  const POSE = {
    idle(P, c) { stand(P, c); sway(P, c, 1); if (c.sp.type === 'thug') thugStance(P, c); },
    walk(P, c) { stand(P, c, false); const v = c.v, amp = clamp(v / 1.4, .45, 1.15), ph = c.ph, cp = cos(TAU * ph), sp_ = sin(TAU * ph);
      for (const side of [1, -1]) { const p = side > 0 ? ph : (ph + .5) % 1, f = (.09 + .37 * cos(TAU * (p + .03))) * amp, k = .09 + (.22 * gw(p, .12, .09) + 1.0 * gw(p, .7, .125)) * amp;
        sideSet(P, side, THIGH, -f, 0, 0); sideSet(P, side, SHIN, k, 0, 0); P[side > 0 ? FPL : FPR] += interp(WALK_FOOT, p)[1] * amp;
        sideSet(P, side, ARM, (.36 * cos(TAU * p) - .03) * amp + .02, 0, .085); sideSet(P, side, FORE, -(.3 - .22 * cos(TAU * p + .4)) * amp - .06, 0, 0); P[side > 0 ? YAL : YAR] += -side * .12 * Math.max(0, -cos(TAU * p)) * amp; }
      set(P, HIPS, .035 + .012 * v, -.085 * cp * amp, .045 * sp_ * amp); P[HX] += .016 * sp_; set(P, SPINE, 0, .05 * cp * amp, -.018 * sp_); set(P, CHEST, 0, .12 * cp * amp, -.03 * sp_ * amp); set(P, NECK, -.02, -.04 * cp * amp, 0); set(P, HEAD, -.015 - .012 * v, -.04 * cp * amp, .012 * sp_); },
    run(P, c, carry) { stand(P, c, false); const v = c.v, amp = clamp(.72 + v * .065, .8, 1.15), ph = c.ph, cp = cos(TAU * ph), sp_ = sin(TAU * ph);
      for (const side of [1, -1]) { const p = side > 0 ? ph : (ph + .5) % 1, f = (.3 + .7 * cos(TAU * (p + .06))) * amp, k = .38 + .3 * gw(p, .14, .1) + 1.6 * gw(p, .66, .15) * amp;
        sideSet(P, side, THIGH, -f, 0, 0); sideSet(P, side, SHIN, k, 0, 0); P[side > 0 ? FPL : FPR] += interp(RUN_FOOT, p)[1];
        if (carry && side > 0) { set(P, ARM, .1 + .1 * cos(TAU * p), 0, .24); set(P, FORE, -.2, 0, 0); }
        else { sideSet(P, side, ARM, (.8 * cos(TAU * p) + .12) * amp * (carry ? 1.1 : 1), 0, .16); sideSet(P, side, FORE, -1.5 - .3 * cos(TAU * p + .5), 0, 0); P[side > 0 ? YAL : YAR] += -side * (.2 + .25 * Math.max(0, -cos(TAU * p))); } }
      set(P, HIPS, .17 + .014 * v, -.14 * cp, .05 * sp_); P[HX] += .012 * sp_; set(P, SPINE, .07, .08 * cp, -.02 * sp_); set(P, CHEST, .05, .26 * cp, -.03 * sp_ + (carry ? .08 : 0)); set(P, NECK, -.1, -.1 * cp, 0); set(P, HEAD, -.14, -.1 * cp, 0); P[BOB] = 1;
      if (carry) { P[PL] = 1; P[BGX] = .2 * sin(TAU * ph * 2 + 1) - .12; P[BGZ] = .08 * cp; P[SPINE * 3 + 2] += .05; } },
    carry_run(P, c) { POSE.run(P, c, true); },
    handsup(P, c) { stand(P, c, false); const t = c.t, tr = .012 * sin(t * 13 + c.sd) + .008 * sin(t * 19);
      for (const side of [1, -1]) { sideSet(P, side, ARM, -.22, PI / 2 - .12, 1.82 + tr + side * .05); sideSet(P, side, FORE, -1.22 + tr * 2 - side * .06, 0, 0); sideSet(P, side, CLAV, 0, 0, .22); sideSet(P, side, HAND, 0, 1.2, .1); }
      set(P, SPINE, -.04, 0, 0); set(P, CHEST, -.05, 0, 0); set(P, HEAD, .1, .05 * sin(t * .9), 0); both(P, SHIN, .08, 0, 0); both(P, THIGH, -.04, 0, .02); sway(P, c, .25); },
    crouch(P, c) { stand(P, c, false); const t = c.t; set(P, THIGH, -1.75, .1, .22); set(P, SHIN, 2.25, 0, 0); set(P, THIGH + 3, -1.25, -.1, -.2); set(P, SHIN + 3, 2.2, 0, 0); P[FPL] = .25; P[FPR] = .95;
      set(P, HIPS, .25, .12, 0); set(P, SPINE, .32, 0, 0); set(P, CHEST, .25, -.1, 0); set(P, NECK, -.3, 0, 0); set(P, HEAD, -.32, .2 * sin(t * .5 + c.sd), 0);
      set(P, ARM, -.95, 0, .12); set(P, FORE, -.75, 0, 0); P[YAL] = -.25; set(P, ARM + 4, -.5, 0, -.2); set(P, FORE + 4, -1.3, 0, 0); P[YAR] = .3; P[HY] = .006 * sin(t * 1.6); },
    aim(P, c) { stand(P, c, false); const t = c.t, br = .006 * sin(t * 1.7 + c.sd);
      set(P, THIGH, -.3, .1, .13); set(P, SHIN, .34, 0, 0); set(P, THIGH + 3, .14, -.3, -.16); set(P, SHIN + 3, .22, 0, 0); set(P, HIPS, .1, -.2, 0); set(P, SPINE, .06, .06, 0); set(P, CHEST, .06, .08, 0); set(P, NECK, -.08, .04, 0); set(P, HEAD, -.1, .02, 0);
      set(P, ARM + 4, -1.43 + br, 0, 0); set(P, FORE + 4, -.1, 0, 0); P[YAR] = .2; set(P, HAND + 4, 0, 0, .18); set(P, CLAV + 4, 0, .1, -.08);
      set(P, ARM, -1.36 + br, -.35, 0); set(P, FORE, -.26, 0, 0); P[YAL] = -.3; set(P, HAND, 0, 0, -.2); set(P, CLAV, 0, -.1, .06);
      P[PR] = 1; P[PL] = 1; P[TW] = .85; },
    sit(P, c) { stand(P, c, false); const t = c.t; both(P, THIGH, -1.42, .06, .09); both(P, SHIN, 1.5, 0, 0); set(P, HIPS, -.06, 0, 0); set(P, SPINE, .05, 0, 0); set(P, CHEST, .06, .03 * sin(t * .3 + c.sd), 0); set(P, HEAD, -.03, .2 * sin(t * .27 + c.sd), 0);
      both(P, ARM, -.12, 0, .08); both(P, FORE, -1.12, 0, 0); P[YAL] = -.2; P[YAR] = .2; P[HZ] = -.12; },
    talk(P, c) { stand(P, c); sway(P, c, .7); const t = c.t;
      if (c.kind === 'cop') { P[ARM * 3] = P[ARM * 3 + 1] = P[ARM * 3 + 2] = 0; P[FORE * 3] = 0; set(P, ARM, -.3, -.25, .3); set(P, FORE, -2.25, 0, 0); set(P, CLAV, 0, 0, .1); set(P, HEAD, .12, .32, -.16); set(P, NECK, .04, .1, -.06);
        set(P, ARM + 4, 0, 0, -.14); set(P, FORE + 4, -.5, 0, 0); set(P, HAND + 4, 0, 0, 0); P[YAR] = .1; }
      else { const g1 = sin(t * 2.3 + c.sd), g2 = sin(t * 3.7 + c.sd * 3), e = .5 + .5 * sin(t * .6 + c.sd);
        set(P, ARM + 4, -.32 - .12 * g1 * e, .3, -.08); set(P, FORE + 4, -1.25 - .3 * g2 * e, 0, 0); P[YAR] += .1 + .2 * g1 * e; set(P, HAND + 4, 0, -.6, .2 * g2);
        set(P, ARM, -.12, 0, .04); set(P, FORE, -.55 - .15 * g1 * (1 - e), 0, 0); set(P, HEAD, .04 * sin(t * 2.9), .08 * g1, .03 * g2); set(P, CHEST, 0, .05 * g1, 0); } },
    phone(P, c) { stand(P, c); sway(P, c, .8); const t = c.t; P[(ARM + 4) * 3] = P[(ARM + 4) * 3 + 2] = 0; P[(FORE + 4) * 3] = 0;
      set(P, ARM + 4, -.8, -.55, -.44); set(P, FORE + 4, -2.6, 0, 0); set(P, HAND + 4, -.1, -.3, -.15); set(P, CLAV + 4, 0, 0, -.12); set(P, HEAD, .05, -.08, .16); set(P, NECK, 0, 0, .06); P[PR] = 1;
      set(P, ARM, 0, 0, .02); set(P, FORE, -.1 - .08 * sin(t * .7), 0, 0); },
    wave(P, c) { stand(P, c); sway(P, c, .5); const t = c.t, wv = sin(t * 7.5); P[(ARM + 4) * 3] = P[(ARM + 4) * 3 + 2] = 0; P[(FORE + 4) * 3] = 0;
      sideSet(P, -1, ARM, -.2, PI / 2 - .1, 2.05); sideSet(P, -1, FORE, -.95 - .38 * wv, 0, 0); sideSet(P, -1, CLAV, 0, 0, .25); sideSet(P, -1, HAND, 0, 1.3, .25 * wv); set(P, CHEST, 0, 0, .05); set(P, HEAD, -.05, 0, -.04); },
    drive(P, c) { const t = c.t, st = c.steer || 0; both(P, THIGH, -1.3, .05, .12); both(P, SHIN, .95, 0, 0); P[FPL] = -.35; P[FPR] = -.25; set(P, HIPS, -.2, 0, 0); set(P, SPINE, .06, 0, 0); set(P, CHEST, .08, -.06 * st, 0); set(P, NECK, .05, 0, 0); set(P, HEAD, .05, .04 * sin(t * .4 + c.sd), 0);
      set(P, ARM, -.98 - .22 * st, -.3, .16); set(P, FORE, -.62 + .2 * st, 0, 0); P[YAL] = -.2; set(P, ARM + 4, -.98 + .22 * st, .3, -.16); set(P, FORE + 4, -.62 - .2 * st, 0, 0); P[YAR] = .2; P[CLAMP] = 0; },
    /* ---------------- round 2: ambient behaviours. Conventions: arm() values are given for the LEFT arm and mirrored; +yaw swings the arm in across the body.
       Placement notes — lean_wall: origin ~0.30 m in front of the wall, facing away from it. sit_bench/sit_stool: origin under the seat front edge centre, s.seat = seat height (m).
       lean_rail: origin ~0.35 m behind a ~1.05 m rail. wrestle_a / wrestle_b: two figures 0.80 m apart facing each other, same s.sync clock. spot: 0.75 m behind the lifter, same s.sync. */
    lean_wall(P, c) { stand(P, c, false); const t = c.t, v = c.var % 3; P[HZ] = -.11; set(P, HIPS, -.16, 0, 0); set(P, SPINE, .1, 0, 0); set(P, CHEST, .12, .04 * sin(t * .21 + c.sd), 0); set(P, NECK, .02, 0, 0); set(P, HEAD, .02, .22 * sin(t * .17 + c.sd * 2) + .06 * sin(t * .53), 0);
      set(P, THIGH, .02, 0, 0); set(P, SHIN, .1, 0, 0); set(P, THIGH + 3, -.72, 0, -.04); set(P, SHIN + 3, 1.75, 0, 0); P[FPR] = 1.2;
      if (v === 0) { arm(P, 1, -.34, -1.0, .1, -1.72, 0); arm(P, -1, -.42, -1.0, .1, -1.55, 0); sideSet(P, 1, HAND, 0, 0, -.3); sideSet(P, -1, HAND, 0, 0, -.3); }
      else if (v === 1) { arm(P, 1, .1, -.3, .13, -.5, 0); arm(P, -1, .1, -.3, .13, -.5, 0); }
      else { arm(P, 1, .1, -.3, .13, -.5, 0); arm(P, -1, -.42, -.2, .06, -1.75, .32); sideSet(P, -1, HAND, -.25, -.5, 0); P[HEAD * 3] += .34; P[NECK * 3] += .12; P[PR] = 1; } },
    sit_bench(P, c) { const t = c.t, v = c.var % 3, seat = c.seat === undefined ? .46 : c.seat, hj = seat + .1, dangle = seat < .22; P[CLAMP] = 0; P[HY] = hj - .95; P[HZ] = dangle ? -.1 : -.17;
      const a = dangle ? 1.5 : Math.acos(clamp((hj - .5) / .42, -.55, .96)), sp_ = v === 1 ? .2 : .12; both(P, THIGH, -a, .08, sp_); both(P, SHIN, dangle ? 1.42 + .05 * sin(t * .9 + c.sd) : a + (v === 2 ? -.3 : .02), 0, 0); if (dangle) { P[FPL] = .5; P[FPR] = .5; } else if (v === 2) { P[FPL] = -.3; P[FPR] = -.3; }
      set(P, HEAD, 0, .25 * sin(t * .19 + c.sd) + .08 * sin(t * .47 + c.sd), 0);
      if (v === 1) { set(P, HIPS, .12, 0, 0); set(P, SPINE, .3, 0, 0); set(P, CHEST, .26, 0, 0); set(P, NECK, -.2, 0, 0); P[HEAD * 3] -= .22; arm(P, 1, -.72, -.25, .1, -.95, 0); arm(P, -1, -.72, -.25, .1, -.95, 0); }
      else if (v === 2) { set(P, HIPS, -.2, 0, 0); set(P, SPINE, .0, 0, 0); set(P, CHEST, .04, 0, 0); arm(P, 1, .35, 0, .95, -.25, 0); arm(P, -1, -.22, -.2, .1, -1.05, 0); P[HZ] = -.2; }
      else { set(P, HIPS, -.06, 0, 0); set(P, SPINE, .06, 0, 0); set(P, CHEST, .06, .03 * sin(t * .3 + c.sd), 0); arm(P, 1, -.2, -.25, .1, -1.1, 0); arm(P, -1, -.2, -.25, .1, -1.1, 0); } },
    sit_ground(P, c) { const t = c.t, v = c.var % 3; P[CLAMP] = 0; P[HY] = .125 - .95; set(P, HEAD, 0, .22 * sin(t * .2 + c.sd) + .06 * sin(t * .5), 0);
      if (v === 0) { both(P, THIGH, -2.12, .05, .1); both(P, SHIN, 1.24, 0, 0); set(P, HIPS, -.18, 0, 0); set(P, SPINE, .32, 0, 0); set(P, CHEST, .3, 0, 0); set(P, NECK, -.22, 0, 0); P[HEAD * 3] -= .2; arm(P, 1, -1.05, -.5, .12, -.55, .2); arm(P, -1, -1.05, -.5, .12, -.55, .2); }
      else if (v === 1) { both(P, THIGH, -1.45, .25, .82); both(P, SHIN, 2.2, 0, 0); P[FPL] = .9; P[FPR] = .9; set(P, HIPS, -.05, 0, 0); set(P, SPINE, .16, 0, 0); set(P, CHEST, .14, 0, 0); set(P, NECK, -.12, 0, 0); arm(P, 1, -.3, -.35, .2, -1.0, 0); arm(P, -1, -.3, -.35, .2, -1.0, 0); }
      else { set(P, THIGH, -1.52, .1, .12); set(P, SHIN, .12, 0, 0); set(P, THIGH + 3, -1.9, -.1, -.14); set(P, SHIN + 3, 1.3, 0, 0); P[FPL] = -1.1; P[FPR] = 0; set(P, HIPS, -.42, 0, 0); set(P, SPINE, .06, 0, 0); set(P, CHEST, .1, 0, 0); set(P, NECK, .12, 0, 0); P[HEAD * 3] += .1; arm(P, 1, .78, 0, .22, -.08, 0); arm(P, -1, .78, 0, .22, -.08, 0); sideSet(P, 1, HAND, 1.0, 0, 0); sideSet(P, -1, HAND, 1.0, 0, 0); } },
    sit_stool(P, c) { const t = c.t, v = c.var % 2, seat = c.seat === undefined ? .76 : c.seat; P[CLAMP] = 0; P[HY] = seat + .1 - .95; both(P, THIGH, -1.22, .1, .14); both(P, SHIN, 1.62, 0, 0); P[FPL] = .5; P[FPR] = .45;
      const dr = pulse(t + c.sd * 3, 9 + (c.sd % 3), 1.6, .8);
      set(P, HIPS, .1, 0, 0); set(P, SPINE, .2, 0, 0); set(P, CHEST, .16, .05 * sin(t * .3 + c.sd), 0); set(P, NECK, -.16, 0, 0); set(P, HEAD, -.12 - .18 * dr, .3 * sin(t * .16 + c.sd) + .08 * sin(t * .5), 0);
      arm(P, -1, -.82, -.35, .16, -1.12, .1); arm(P, 1, lerp(-.82, -.95, dr), lerp(-.35, -.1, dr), .16, lerp(-1.12, -2.25, dr), .1 + .2 * dr); if (v) { arm(P, -1, -.5, -.9, .1, -1.5, 0); } P[PL] = 1; },
    talk_group(P, c) { stand(P, c); sway(P, c, .8); const t = c.t, v = c.var % 3, spk = c.speak !== undefined ? c.speak : sm(sin(t * .42 + c.sd * 1.7), .15, .55), g1 = sin(t * 2.3 + c.sd), g2 = sin(t * 3.7 + c.sd * 3), g3 = sin(t * 1.3 + c.sd * 2);
      arm(P, -1, lerp(-.1, -.5 - .16 * g1, spk), lerp(-.2, -.35, spk), .1, lerp(-.5, -1.35 - .32 * g2, spk), .12 * spk * g1); sideSet(P, -1, HAND, 0, .5 * spk, .25 * g2 * spk);
      if (v === 0) arm(P, 1, lerp(.06, -.4 - .1 * g3, spk * .7), -.25, .1, lerp(-.3, -1.2 - .25 * g1, spk * .7), 0); else if (v === 1) { arm(P, 1, .28, -1.2, .52, -1.45, 0); } else arm(P, 1, .1, -.3, .13, -.5, 0);
      set(P, HEAD, .05 * sin(t * 3.1 + c.sd) * spk + .07 * Math.max(0, sin(t * 1.9 + c.sd)) * (1 - spk), .09 * g1 * spk, .04 * g2 * spk); set(P, CHEST, 0, .06 * g1 * spk, 0); P[SPINE * 3] += .03 * spk; },
    phone_look(P, c) { stand(P, c); sway(P, c, .7); const t = c.t, sc = pulse(t + c.sd, 3.1, .4, .25); set(P, NECK, .22, 0, 0); set(P, HEAD, .36 + .03 * sin(t * .7), -.06, 0); P[CHEST * 3] += .06;
      arm(P, -1, -.42, -.12, .05, -1.5, .22); sideSet(P, -1, HAND, -.2 + .08 * sc, -.5, 0); P[PR] = 1; if (c.var % 2) arm(P, 1, .1, -.3, .13, -.5, 0); else arm(P, 1, -.3, -.95, .08, -1.5, 0); },
    phone_call(P, c) { POSE.phone(P, c); const t = c.t, g = sin(t * 2.1 + c.sd), e = sm(sin(t * .37 + c.sd * 2), .2, .6); arm(P, 1, lerp(.05, -.35 - .1 * g, e), -.3, .12, lerp(-.3, -1.2 - .3 * sin(t * 3.3), e), 0); P[HEAD * 3 + 1] += .15 * sin(t * .5 + c.sd); P[HIPS * 3 + 1] += .12 * sin(t * .23 + c.sd); },
    smoke(P, c) { stand(P, c); sway(P, c, .9); const t = c.t + c.sd * 5, per = 8.5 + (c.sd % 2.5), x = ((t % per) + per) % per, up = sm(x, 0, 1.0) * (1 - sm(x, 2.3, 3.2)), ex = sm(x, 3.0, 3.6) * (1 - sm(x, 4.4, 5.4));
      arm(P, 1, lerp(-.1, -.72, up), lerp(-.3, -.55, up), lerp(.1, .3, up), lerp(-.62, -2.42, up), .25 * up); sideSet(P, 1, HAND, 0, -.4 * up, -.2 * up); P[PL] = 1;
      set(P, HEAD, -.1 * ex + .03 * up, -.1 * up + .2 * sin(t * .21), 0); P[CHEST * 3] -= .03 * ex; if (c.var % 2) arm(P, -1, .1, -.3, .13, -.5, 0); },
    drink(P, c) { stand(P, c); sway(P, c, .8); const t = c.t + c.sd * 4, per = 7 + (c.sd % 3), x = ((t % per) + per) % per, up = sm(x, 0, .9) * (1 - sm(x, 2.0, 2.9));
      arm(P, 1, lerp(-.3, -.82, up), lerp(-.35, -.3, up), lerp(.1, .22, up), lerp(-1.25, -2.35, up), .1 + .22 * up); sideSet(P, 1, HAND, -.35 * up, 0, 0); P[PL] = 1;
      set(P, HEAD, -.22 * sm(x, .7, 1.4) * (1 - sm(x, 1.9, 2.5)), .18 * sin(t * .2) * (1 - up), 0); if (c.var % 2) arm(P, -1, .1, -.3, .13, -.5, 0); },
    dance(P, c) { stand(P, c, false); const t = c.t * (1.72 + .1 * (c.sd % 1)) * TAU, b = sin(t), b2 = sin(t * .5 + c.sd), k = Math.max(0, sin(t)) * .5 + .25, v = c.var % 2;
      both(P, THIGH, -.18 * k, 0, 0); both(P, SHIN, .4 * k, 0, 0); P[HX] = .035 * b2; set(P, HIPS, 0, .1 * b2, .07 * b2); set(P, SPINE, .03, -.06 * b2, -.05 * b2); set(P, CHEST, .02, -.1 * b2, -.04 * b2); set(P, HEAD, .05 * b, .06 * b2, .03 * b2);
      arm(P, 1, -.3 + .1 * b, -.4, .2 + .06 * b2, -1.5 + .2 * b, 0); arm(P, -1, -.3 - .1 * b, -.4, .2 - .06 * b2, -1.5 - .2 * b, 0); sideSet(P, 1, CLAV, 0, 0, .06 * b); sideSet(P, -1, CLAV, 0, 0, -.06 * b); if (v) { arm(P, 1, -.5, -.3, .14, -1.3 + .1 * b, 0); P[PL] = 1; } },
    cheer(P, c) { stand(P, c, false); const t = c.t, f = 5.2 + (c.sd % 1), j = Math.max(0, sin(t * f)), e = .6 + .4 * sin(t * .7 + c.sd), v = c.var % 2;
      both(P, THIGH, -.12 * (1 - j), 0, 0); both(P, SHIN, .26 * (1 - j), 0, 0); P[HY] = .05 * j * e; P[CLAMP] = 1 - .9 * j * e; set(P, SPINE, -.05, 0, 0); set(P, CHEST, -.08, .06 * sin(t * 2), 0); set(P, HEAD, -.12, .1 * sin(t * 1.3 + c.sd), 0);
      if (v) { const cl = sin(t * 9); arm(P, 1, -1.05, -.1, .12, -1.0 + .08 * cl, .0 + .1 * cl); arm(P, -1, -1.05, -.1, .12, -1.0 + .08 * cl, .0 + .1 * cl); }
      else for (const side of [1, -1]) { arm(P, side, -.2, PI / 2 - .12, 2.2 + .22 * j + side * .06, -.75 - .35 * j, 0); sideSet(P, side, CLAV, 0, 0, .24); } },
    film(P, c) { stand(P, c); sway(P, c, .5); const t = c.t; arm(P, -1, -1.3 + .015 * sin(t * 1.9), .1, .1, -.55, .0); sideSet(P, -1, HAND, -.5, -.9, 0); P[PR] = 1; P[TW] = .7;
      if (c.var % 2) arm(P, 1, -1.15, .1, .05, -.75, .1); set(P, HEAD, .03, 0, .04); P[SPINE * 3] -= .03; },
    flee(P, c) { POSE.run(P, c); const t = c.t, ph = c.ph; P[(ARM) * 3 + 2] += .14; P[(ARM + 4) * 3 + 2] -= .14; P[CHEST * 3] += .1; P[HEAD * 3] += .06; P[HEAD * 3 + 1] += .5 * sm(sin(t * 1.1 + c.sd), .55, .9) * (c.var % 2 ? 1 : -1); P[HX] += .02 * sin(TAU * ph); },
    cower(P, c) { stand(P, c, false); const t = c.t, tr = .012 * sin(t * 17 + c.sd) + .008 * sin(t * 23);
      set(P, THIGH, -1.95, .1, .16); set(P, SHIN, 2.35, 0, 0); set(P, THIGH + 3, -1.95, -.1, -.16); set(P, SHIN + 3, 2.35, 0, 0); P[FPL] = .5; P[FPR] = .5;
      set(P, HIPS, .3, 0, 0); set(P, SPINE, .5, 0, 0); set(P, CHEST, .42, tr * 2, 0); set(P, NECK, .25, 0, 0); set(P, HEAD, .3 + tr, .1 * sin(t * .9), 0);
      for (const side of [1, -1]) { arm(P, side, -2.25 + tr, -.5, .35, -2.25, .2); sideSet(P, side, CLAV, 0, 0, .25); } },
    point(P, c) { stand(P, c); sway(P, c, .5); const t = c.t, jab = .05 * Math.max(0, sin(t * 3.1 + c.sd)); arm(P, -1, -1.42 - jab, -.1, .04, -.06, .1); sideSet(P, -1, HAND, 0, -1.2, 0); P[TW] = .75;
      if (c.var % 2) { arm(P, 1, -.5, -.6, .1, -2.2, .3); } set(P, HEAD, -.02, 0, 0); P[SPINE * 3] -= .04; },
    shrug(P, c) { stand(P, c); sway(P, c, .8); const t = c.t + c.sd * 3, e = pulse(t, 4.2, 1.1, .35);
      for (const side of [1, -1]) { arm(P, side, lerp(.04, -.2, e), lerp(-.15, .9, e), lerp(.07, .32, e), lerp(-.3, -1.45, e), 0); sideSet(P, side, CLAV, 0, 0, .3 * e); sideSet(P, side, HAND, 0, .8 * e, 0); }
      set(P, HEAD, -.04 * e, .12 * sin(t * .4), .14 * e * (c.var % 2 ? 1 : -1)); P[NECK * 3] += .06 * e; },
    play_guitar(P, c) { stand(P, c, false); sway(P, c, .35); const t = c.t, bt = t * 3.4 + c.sd, s = sin(bt * TAU / 2), acc = Math.pow(abs(sin(bt * TAU / 4)), 3), tap = Math.max(0, sin(bt * TAU / 2 + 1));
      arm(P, 1, -.62, -.2, .42, -1.72, -.1); sideSet(P, 1, HAND, -.3, -1.2, .3 + .08 * sin(bt * .9));
      arm(P, -1, -.2, -.75, .2, -1.5 + (.1 + .06 * acc) * s, .1); sideSet(P, -1, HAND, .15 * s, -.3, -.25);
      set(P, SPINE, .05, 0, .0); set(P, CHEST, .06, .05, .03 * sin(bt * TAU / 8)); set(P, NECK, .06, 0, 0); set(P, HEAD, .14 + .04 * s * acc, -.26 + .22 * sm(sin(t * .31 + c.sd), .3, .8), .05 * sin(bt * TAU / 8));
      set(P, THIGH, -.1, .2, .06); set(P, SHIN, .12, 0, 0); P[FPL] += -.22 * tap; P[HX] = -.02; },
    dribble(P, c) { stand(P, c, false); const t = c.t * (2.25 + .2 * (c.sd % 1)), u = abs(cos(PI * t)), hi = Math.pow(u, .7), k = c.k, v = c.var % 2, sw = sin(c.t * .7 + c.sd);
      both(P, THIGH, -.52, .14, .14); both(P, SHIN, .92, 0, 0); set(P, HIPS, .12, .12 * sw, 0); set(P, SPINE, .26, 0, 0); set(P, CHEST, .2, -.1, 0); set(P, NECK, -.2, 0, 0); set(P, HEAD, -.22, .25 * sin(c.t * .5 + c.sd), 0); P[HY] = -.012 * (1 - u);
      arm(P, -1, -.38, -.1, .16, lerp(-.55, -1.18, hi), -.1); sideSet(P, -1, HAND, lerp(.5, -.2, hi), 0, 0); arm(P, 1, -.5, -.5, .5, -1.1, 0);
      P[AXX] = (-.3 + .05 * sw) * k; P[AXZ] = (.26 + .04 * sin(c.t * 1.1)) * k; P[AXY] = (.12 + .62 * u) * k; P[ARX] = c.t * 9; P[AXS] = 1; P[PL] = -1; if (v) P[CHEST * 3 + 1] -= .12; },
    shoot_hoop(P, c) { stand(P, c, false); const k = c.k, per = 4.4, x = (((c.t + c.sd * 2) % per) + per) % per, d = c.dist || 4.3, hoop = 3.05;
      const dip = sm(x, .5, 1.0) * (1 - sm(x, 1.0, 1.25)), up = sm(x, 1.0, 1.32), air = sm(x, 1.08, 1.3) * (1 - sm(x, 1.55, 1.8)), fol = sm(x, 1.3, 1.45) * (1 - sm(x, 2.5, 3.0)), land = sm(x, 1.75, 1.9) * (1 - sm(x, 2.0, 2.4)), rdy = 1 - sm(x, 2.6, 3.2) + sm(x, 3.9, 4.4) * 0, gather = 1 - sm(x, 2.3, 3.0);
      const kn = .25 + .75 * dip + .5 * land; both(P, THIGH, -.36 * kn, .1, .08); both(P, SHIN, .7 * kn, 0, 0); P[CLAMP] = 1 - air; P[HY] = .26 * air * k; if (air > .3) { P[FPL] = .5 * air; P[FPR] = .5 * air; }
      set(P, HIPS, .06 * dip, 0, 0); set(P, SPINE, .1 * dip - .04 * up * gather, 0, 0); set(P, CHEST, .08 * dip - .08 * up * gather, 0, 0); set(P, HEAD, -.12 - .16 * up * gather, 0, 0);
      const r = up * gather;   // 0 = ball at chest, 1 = arms extended
      arm(P, -1, lerp(-.75, -2.55, r), -.2, .08, lerp(-1.9, -.25, r), lerp(.3, .1, r)); sideSet(P, -1, HAND, lerp(-.7, .7, fol), 0, 0); arm(P, 1, lerp(-.7, -2.2, r) + .9 * fol * r, -.3, .1, lerp(-1.85, -.7, r), lerp(.42, .25, r));
      const fl = clamp((x - 1.36) / 1.05, 0, 1), y0 = 2.18 + .26, inHand = x < 1.36 || x > 3.1, hy = lerp(1.2, y0, r) + (x < 1.36 ? P[HY] / k * .9 - .1 * dip : 0);
      if (x < 1.36) { P[AXX] = -.04 * k; P[AXY] = hy * k; P[AXZ] = lerp(.26, .2, r) * k; P[AXS] = 1; }
      else if (x < 2.41) { P[AXX] = -.04 * k; P[AXZ] = lerp(.2, d, fl) * k; P[AXY] = (lerp(y0, hoop, fl) + 1.55 * 4 * fl * (1 - fl) * .55) * k; P[ARX] = -fl * 14; P[AXS] = 1; }
      else if (x < 3.0) { const q = (x - 2.41) / .59; P[AXX] = -.04 * k; P[AXZ] = (d - .05) * k; P[AXY] = lerp(hoop, 1.9, q * q) * k; P[AXS] = 1 - sm(q, .6, 1); }
      else { P[AXX] = -.04 * k; P[AXY] = 1.2 * k; P[AXZ] = .26 * k; P[AXS] = sm(x, 3.2, 3.6); arm(P, -1, lerp(-.3, -.75, sm(x, 3.1, 3.7)), -.2, .08, lerp(-1.0, -1.9, sm(x, 3.1, 3.7)), .3); arm(P, 1, lerp(-.3, -.7, sm(x, 3.1, 3.7)), -.3, .1, lerp(-1.0, -1.85, sm(x, 3.1, 3.7)), .42); }
      P[PL] = -1; },
    lift(P, c) { stand(P, c, false); const k = c.k, t = c.sync !== undefined ? c.sync : c.t, per = 3.6, x = ((t % per) + per) % per, e = sm(x, .2, 1.3) * (1 - sm(x, 1.9, 3.2)), sh_ = .012 * sin(t * 21) * sm(e, .2, .8) * (1 - sm(e, .9, 1));
      both(P, THIGH, -.1 - .08 * (1 - e), .16, .16); both(P, SHIN, .2 + .16 * (1 - e), 0, 0); set(P, SPINE, -.06, 0, 0); set(P, CHEST, -.1 - .04 * e, 0, 0); set(P, HEAD, -.1 + .1 * e, 0, 0);
      for (const side of [1, -1]) { arm(P, side, -.12 + sh_, PI / 2 - .1, lerp(1.32, 2.72, e) + sh_, lerp(-2.02, -.2, e), 0); sideSet(P, side, CLAV, 0, 0, .12 + .2 * e); sideSet(P, side, HAND, 0, 1.2, 0); }
      P[AXY] = (lerp(1.47, 2.1, e) + sh_ * .3) * k; P[AXZ] = .05 * k; P[AXS] = 1; },
    spot(P, c) { stand(P, c, false); const t = c.sync !== undefined ? c.sync : c.t, per = 3.6, x = ((t % per) + per) % per, e = sm(x, .2, 1.3) * (1 - sm(x, 1.9, 3.2));
      both(P, THIGH, -.22, .18, .18); both(P, SHIN, .42, 0, 0); set(P, SPINE, .1, 0, 0); set(P, CHEST, .06, 0, 0); set(P, HEAD, -.2 - .15 * e, .04 * sin(t * .7), 0);
      for (const side of [1, -1]) { arm(P, side, lerp(-1.5, -2.2, e), -.3, .2, lerp(-.95, -.5, e), .12); sideSet(P, side, HAND, .6, 0, 0); } },
    wrestle_a(P, c, sgn) { stand(P, c, false); sgn = sgn || 1; const t = (c.sync !== undefined ? c.sync : c.t), w = sin(t * 1.5), w2 = sin(t * .63 + 1), surge = pulse(t, 6.5, .9, .3), st = sin(t * 3 + (sgn > 0 ? 0 : PI)), low = .2 * surge * (sgn > 0 ? 1 : .3);
      set(P, THIGH, -.72 - low - .12 * Math.max(0, st), .28, .26); set(P, SHIN, 1.0 + low * 1.4 + .2 * Math.max(0, st), 0, 0); set(P, THIGH + 3, -.3 - low - .12 * Math.max(0, -st), -.28, -.3); set(P, SHIN + 3, .78 + low * 1.4 + .2 * Math.max(0, -st), 0, 0);
      P[HZ] = sgn * (.09 * w + .1 * surge) - .05; P[HX] = sgn * .05 * w2; set(P, HIPS, .34 + .06 * w * sgn, .2 + .12 * w2 * sgn, 0); set(P, SPINE, .3, -.06, .06 * w); set(P, CHEST, .22, -.1, .08 * w); set(P, NECK, -.28, .2, .16); set(P, HEAD, -.3, .26, .18);
      arm(P, -1, -1.2 + .12 * w * sgn, -.2, .22, -.72 - .2 * w * sgn, .25); sideSet(P, -1, HAND, 0, -.6, .3); arm(P, 1, -.85 - .1 * w * sgn, -.35, .3, -1.05 + .2 * w * sgn, .12); sideSet(P, 1, CLAV, 0, 0, .12); sideSet(P, -1, CLAV, 0, 0, .12); P[PL] = -1; },
    wrestle_b(P, c) { POSE.wrestle_a(P, c, -1); },
    carry_box(P, c) { if (c.v > .15) POSE.walk(P, c); else { stand(P, c, false); sway(P, c, .4); } const k = c.k, bob = c.v > .15 ? .012 * sin(TAU * c.ph * 2) : 0;
      for (const side of [1, -1]) { arm(P, side, -.38, -.4, .12, -1.3, .1); sideSet(P, side, HAND, 0, -.2, .3); } P[SPINE * 3] -= .08; P[CHEST * 3] -= .06; P[AXY] = (1.12 + bob) * k; P[AXZ] = .31 * k; P[AXS] = 1; P[HEAD * 3] -= .04; },
    sweep(P, c) { stand(P, c, false); const k = c.k, t = c.t * 2.9 + c.sd, s = sin(t), s2 = sin(t - .6), walk_ = sin(c.t * .35 + c.sd);
      set(P, THIGH, -.3, .2, .12); set(P, SHIN, .34, 0, 0); set(P, THIGH + 3, .12, -.2, -.1); set(P, SHIN + 3, .2, 0, 0); set(P, HIPS, .18, .25 + .08 * s, 0); set(P, SPINE, .2, -.1 - .08 * s2, 0); set(P, CHEST, .14, -.14 - .12 * s2, 0); set(P, NECK, -.1, .1, 0); set(P, HEAD, .16, .12 + .1 * walk_, 0);
      arm(P, 1, -.62 - .18 * s, -.3, .1, -.5 + .14 * s, .42); arm(P, -1, -.3 - .1 * s, -.5, .08, -1.5 + .1 * s, .5); sideSet(P, 1, HAND, 0, -.5, .3); sideSet(P, -1, HAND, 0, -.5, .3);
      P[AXX] = (.06 + .3 * s) * k; P[AXZ] = (.62 + .1 * abs(s)) * k; P[AXY] = .005; P[ARX] = -.5 - .06 * abs(s); P[ARZ] = .1 + .26 * s; P[AXS] = 1; },
    fish(P, c) { stand(P, c, false); sway(P, c, .5); const k = c.k, t = c.t + c.sd, tug = pulse(t, 11, .5, .2), reel = pulse(t + 4, 17, 3, .5), cr = sin(t * 9) * reel;
      set(P, SPINE, .04, 0, 0); set(P, CHEST, .04, 0, 0); set(P, HEAD, .08, .12 * sin(t * .23), 0); arm(P, -1, -.42 - .14 * tug, -.3, .06, -1.42 - .1 * tug, .24); arm(P, 1, -.5 - .1 * tug, -.35 + .08 * cr, .1 + .05 * cr, -1.25 + .08 * cr, .3);
      P[AXX] = -.06 * k; P[AXY] = (1.06 + .05 * tug) * k; P[AXZ] = .24 * k; P[ARX] = -.5 - .22 * tug + .015 * sin(t * 1.3); P[ARY] = .08 + .02 * sin(t * .5); P[AXS] = 1; },
    sunbathe(P, c) { const t = c.t, v = c.var % 3, back = v !== 1; P[CLAMP] = 0; P[HY] = .13 - .95; P[HIPS * 3] = back ? -PI / 2 + .03 : PI / 2 - .04;
      if (back) { set(P, THIGH, .06, .12, .06); set(P, THIGH + 3, v === 2 ? -.95 : .06, -.12, -.06); set(P, SHIN + 3, v === 2 ? 1.75 : 0, 0, 0); P[FPL] = -PI / 2 - .6; P[FPR] = v === 2 ? 0 : -PI / 2 - .6; set(P, SPINE, .02, 0, 0); set(P, NECK, .06, 0, 0); set(P, HEAD, .05, .25 * sin(t * .11 + c.sd), 0);
        if (v === 2) { arm(P, 1, -2.9, -.4, .5, -2.3, 0); arm(P, -1, -2.9, -.4, .5, -2.3, 0); } else { arm(P, 1, .05, 0, .28, -.05, 0); arm(P, -1, -.5, -1.1, .1, -1.6, 0); } }
      else { both(P, THIGH, -.03, .1, .07); P[FPL] = PI / 2 + .9; P[FPR] = PI / 2 + .9; set(P, SPINE, -.1, 0, 0); set(P, CHEST, -.16, 0, 0); set(P, NECK, -.3, 0, 0); set(P, HEAD, -.3, .3 * sin(t * .13 + c.sd), 0); P[HY] += .0;
        arm(P, 1, -1.35, -.3, .5, -1.9, 0); arm(P, -1, -1.35, -.3, .5, -1.9, 0); set(P, SHIN, .9 + .4 * sin(t * .6 + c.sd), 0, 0); } },
    lean_rail(P, c) { stand(P, c, false); const t = c.t, v = c.var % 2; P[HZ] = -.16; set(P, HIPS, .3, 0, 0); set(P, SPINE, .26, 0, 0); set(P, CHEST, .2, .04 * sin(t * .2 + c.sd), 0); set(P, NECK, -.3, 0, 0); set(P, HEAD, -.26, .3 * sin(t * .15 + c.sd) + .08 * sin(t * .44), 0);
      set(P, THIGH, -.36, .1, .06); set(P, SHIN, .12, 0, 0); set(P, THIGH + 3, -.2, -.1, -.06); set(P, SHIN + 3, .5, 0, 0); P[FPR] = .5;
      arm(P, 1, -.82, -.75, .12, -1.25, .0); arm(P, -1, -.82, -.75, .12, -1.25, .0); if (v) { P[PL] = 1; } },
    skate(P, c) { stand(P, c, false); const k = c.k, t = c.t, ph = c.ph, push = sm(sin(TAU * ph * .5), .55, .95), bal = sin(t * 1.3 + c.sd);
      P[CLAMP] = 0; P[HY] = .07; set(P, HIPS, .08, -1.25, .03 * bal); set(P, SPINE, .14, .45, 0); set(P, CHEST, .1, .5, 0); set(P, NECK, -.08, .2, 0); set(P, HEAD, -.1, .1, 0);
      set(P, THIGH, -.42, .1, .2); set(P, SHIN, .62, 0, 0); set(P, THIGH + 3, lerp(-.25, .5, push), -.1, -.22 - .1 * push); set(P, SHIN + 3, lerp(.6, .5, push), 0, 0); P[FPR] = .5 * push;
      arm(P, 1, -.3 + .2 * bal, -.2, .5 + .1 * bal, -.5, 0); arm(P, -1, .3 - .2 * bal, -.2, .45 - .1 * bal, -.6, 0); P[AXS] = 1; P[ARZ] = .0; P[AXZ] = .02 * k; },
    scoot(P, c) { stand(P, c, false); const k = c.k, t = c.t, bal = sin(t * 1.1 + c.sd); P[CLAMP] = 0; P[HY] = .15 + .004 * sin(t * 13); P[HZ] = -.1;
      set(P, THIGH, -.3, .3, -.1); set(P, SHIN, .3, 0, 0); set(P, THIGH + 3, .16, -.5, .1); set(P, SHIN + 3, .2, 0, 0); set(P, HIPS, .06, -.12, 0); set(P, SPINE, .12, .06, 0); set(P, CHEST, .1, .06, 0); set(P, NECK, -.1, 0, 0); set(P, HEAD, -.08, .1 * bal, 0);
      arm(P, 1, -.55, -.3, .1, -.45, .06); arm(P, -1, -.55, -.3, .1, -.45, .06); P[AXS] = 1; },
    stretch(P, c) { stand(P, c, false); sway(P, c, .3); const t = c.t + c.sd, e = pulse(t, 9, 4, 1), s = c.var % 2 ? 1 : -1; set(P, SPINE, 0, 0, .16 * e * s); set(P, CHEST, -.04, 0, .2 * e * s); set(P, HEAD, 0, 0, .08 * e * s);
      arm(P, s, lerp(.04, -.2, e), lerp(-.15, PI / 2 - .2, e), lerp(.07, 2.75, e), lerp(-.3, -.5, e), 0); sideSet(P, s, CLAV, 0, 0, .3 * e); arm(P, -s, .1, -1.0, .45, -1.3, 0); }
  };
  /* ------------------------------------------------------------------ China edition behaviours (四方街 street life + combat-ready states).
     One-shot states (dive, fake_fall, fall, hit) read c.ts = seconds since the state began (or s.t when the caller passes it). Group states read s.sync (shared clock).
     Placement notes — chess_move / mahjong / eat_bowl / flyer / fish take s.seat (seat height above the figure origin, origin under the seat centre, facing the table).
     square_dance / fan_dance / taichi: s.sync = the shared beat clock in seconds (BPM below). dive: stand 0.3 m from the edge facing the water, s.drop = deck height above the water.
     swim: origin on the water surface. push_cart / pull_trolley / carry_pole / bird_walk / balance_bike / tour_follow / queue / chase: pass s.speed (0 = the standing variant). */
  const BPM = 108, _A = new Float32Array(NCH), _B = new Float32Array(NCH);
  const mixP = (P, A, B, k) => { for (let i = 0; i < NCH; i++) P[i] = A[i] + (B[i] - A[i]) * k; };
  const cyc = (t, per) => ((t % per) + per) % per;
  const seatLegs = (P, c, seat, spread) => { const hj = seat + .1, a = Math.acos(clamp((hj - .5) / .42, -.55, .96)); P[CLAMP] = 0; P[HY] = hj - .95; both(P, THIGH, -a, .08, spread === undefined ? .14 : spread); both(P, SHIN, a + .02, 0, 0); return a; };
  const squat = (P, c, open) => { stand(P, c, false); both(P, THIGH, -2.2, .14, open === undefined ? .34 : open); both(P, SHIN, 2.62, 0, 0); P[FPL] = 0; P[FPR] = 0; set(P, HIPS, .2, 0, 0); set(P, SPINE, .22, 0, 0); set(P, CHEST, .14, 0, 0); set(P, NECK, -.1, 0, 0); };
  /* dance phrases: (sway -1..1, bounce 0..1, twice-per-beat wave, energy) -> [left ax, ay, az, fx, yaw, right ax, ay, az, fx, yaw] in the arm() convention */
  const SQ_MV = [
    (sw) => [-.75, -.2, .35 + .4 * sw, -1.0, .35 * Math.max(0, -sw), -.75, -.2, .35 - .4 * sw, -1.0, .35 * Math.max(0, sw)],
    (sw, bo) => [-.2, 1.35, 2.45 + .22 * sw, -.45 - .2 * bo, 0, -.2, 1.35, 2.45 - .22 * sw, -.45 - .2 * bo, 0],
    (sw) => [-1.15 - .35 * sw, -.1, .12, -.75 + .55 * sw, 0, -1.15 + .35 * sw, -.1, .12, -.75 - .55 * sw, 0],
    (sw, bo) => [0, .7, 1.4 + .1 * bo, -.2, 0, 0, .7, 1.4 + .1 * bo, -.2, 0]];
  const FAN_MV = [
    (sw, bo) => [-.9, -.3, .25 + .5 * bo, -1.3 + .5 * bo, .4 * (1 - bo), -.9, -.3, .25 + .5 * bo, -1.3 + .5 * bo, .4 * (1 - bo)],
    (sw) => [-.25, 1.4, 2.6 + .15 * sw, -.3, 0, -.25, 1.4, 2.6 - .15 * sw, -.3, 0],
    (sw) => [-.2, 1.2, 1.5 + 1.0 * sw, -.25, 0, -.2, 1.2, 1.5 - 1.0 * sw, -.25, 0],
    (sw, bo) => [0, .7, 1.5, -.15 - .2 * bo, 0, 0, .7, 1.5, -.15 - .2 * bo, 0]];
  const SWIM_ARM = [[0, -2.95, .1, -.1], [.35, -2.9, .14, -.1], [.55, -2.05, 1.0, -.5], [.7, -1.2, .55, -1.9], [.85, -2.2, .12, -1.6], [1, -2.95, .1, -.1]], SWIM_LEG = [[0, .12, .05, .1], [.5, .12, .05, .1], [.7, -.75, .5, 1.75], [.84, -.3, .6, .7], [1, .12, .05, .1]];
  Object.assign(POSE, {
    square_dance(P, c, fan) { stand(P, c, false); const lag = .11 * ((c.sd * 7.3) % 1), bt = ((c.sync !== undefined ? c.sync : c.t) - lag) * BPM / 60, b = cyc(bt, 32), ph = Math.floor(b / 8), e = .82 + .18 * ((c.sd * 3.1) % 1), sw = sin(bt * PI), bo = abs(sin(bt * PI)), L = Math.max(0, -sw), R = Math.max(0, sw);
      P[HX] = .085 * sw * e; set(P, HIPS, 0, .1 * sw * e, .05 * sw); set(P, SPINE, .02, -.05 * sw, -.04 * sw); set(P, CHEST, 0, -.08 * sw, -.03 * sw); set(P, HEAD, .04 * bo, .16 * sw, .03 * sw); P[HY] = -.018 * bo;
      set(P, THIGH, -.24 * L * e, 0, -.05 * L); set(P, SHIN, .5 * L * e, 0, 0); set(P, THIGH + 3, -.24 * R * e, 0, .05 * R); set(P, SHIN + 3, .5 * R * e, 0, 0); P[FPL] = .35 * L; P[FPR] = .35 * R;
      const tw = sin(bt * TAU), M = fan ? FAN_MV : SQ_MV, k = sm(b % 8, 7.1, 8), a0 = M[ph](sw, bo, tw, e), a1 = M[(ph + 1) % 4](sw, bo, tw, e);
      for (let i = 0; i < 2; i++) { const s = i ? -1 : 1, o = i * 5, az = lerp(a0[o + 2], a1[o + 2], k); arm(P, s, lerp(a0[o], a1[o], k), lerp(a0[o + 1], a1[o + 1], k), az, lerp(a0[o + 3], a1[o + 3], k), lerp(a0[o + 4], a1[o + 4], k)); sideSet(P, s, CLAV, 0, 0, .12 * Math.max(0, az - 1.2)); sideSet(P, s, HAND, 0, 0, (fan ? .5 : .2) * tw); }
      if (ph === 3) P[HIPS * 3 + 1] += TAU * sm(b - 24, .6, 7.4);
      if (fan) P[PL] = 1; },
    fan_dance(P, c) { POSE.square_dance(P, c, true); },
    taichi(P, c) { stand(P, c, false); const t = (c.sync !== undefined ? c.sync : c.t) * .5 + .15 * (c.sd % 1), s = sin(t), s2 = sin(t - .9), cs = cos(t), W = .5 + .5 * s;
      P[HX] = .11 * s; set(P, HIPS, .03, .28 * s, 0); set(P, SPINE, .02, .12 * s2, 0); set(P, CHEST, 0, .14 * s2, 0); set(P, HEAD, .04, .1 * s2, 0);
      set(P, THIGH, -.42 - .16 * W, .28, .3); set(P, SHIN, .62 + .2 * W, 0, 0); set(P, THIGH + 3, -.42 - .16 * (1 - W), -.28, -.3); set(P, SHIN + 3, .62 + .2 * (1 - W), 0, 0);
      arm(P, 1, -1.05 - .3 * s, .3, .45 + .35 * cs, -.75 + .25 * cs, .25 * Math.max(0, -s)); arm(P, -1, -1.05 + .3 * s, .3, .45 - .35 * cs, -.75 - .25 * cs, .25 * Math.max(0, s)); sideSet(P, 1, HAND, -.3, .4 * cs, 0); sideSet(P, -1, HAND, -.3, -.4 * cs, 0); },
    handstand(P, c) { const t = c.t, wb = .05 * sin(t * 1.3 + c.sd) + .03 * sin(t * 2.9), wz = .04 * sin(t * .8 + c.sd * 2), sc = .12 * sin(t * .7 + c.sd); P[CLAMP] = 0; P[HIPS * 3] = PI + wb; P[HIPS * 3 + 2] = wz; P[HY] = .13; P[HX] = .02 * sin(t * .8 + c.sd * 2);
      set(P, SPINE, -.06 - wb * .5, 0, 0); set(P, CHEST, -.08, 0, 0); set(P, NECK, -.3, 0, 0); set(P, HEAD, -.45, 0, 0);
      for (const s of [1, -1]) { arm(P, s, -3.02 + wb * .6, 0, .1, -.12 - .4 * abs(wb), 0); sideSet(P, s, CLAV, 0, 0, .3); sideSet(P, s, HAND, -1.35, 0, 0); }
      set(P, THIGH, .12 + sc - wb, 0, .06); set(P, SHIN, .1 + .25 * Math.max(0, -sc), 0, 0); set(P, THIGH + 3, .12 - sc - wb, 0, -.06); set(P, SHIN + 3, .1 + .25 * Math.max(0, sc), 0, 0); P[FPL] = PI + .5; P[FPR] = PI + .5; },
    dive(P, c) { const x = c.ts, k = c.k, cr = sm(x, .15, .55) * (1 - sm(x, .68, .82)), air = sm(x, .72, .9), fl = clamp((x - .78) / .75, 0, 1), drop = c.drop === undefined ? .8 : c.drop; stand(P, c, false);
      both(P, THIGH, -.7 * cr - .15 * air * (1 - fl), 0, 0); both(P, SHIN, 1.3 * cr, 0, 0); P[CLAMP] = 1 - air;
      for (const s of [1, -1]) { arm(P, s, lerp(lerp(.04, .65, cr), -3.0, air), 0, .1, -.1, 0); sideSet(P, s, CLAV, 0, 0, .25 * air); }
      set(P, HIPS, .5 * cr * (1 - air) + 2.15 * sm(fl, .05, .8), 0, 0); set(P, SPINE, .3 * cr * (1 - air), 0, 0); set(P, HEAD, -.2 * air, 0, 0);
      P[HZ] = (.25 * cr + 2.3 * fl) * k; P[HY] = (1.8 * fl * (1 - fl) - (drop + 1.7) * fl * fl) * k * air; if (air > .3) { P[FPL] = 1.2 + P[HIPS * 3]; P[FPR] = P[FPL]; } },
    swim(P, c) { const k = c.k, per = 2.0, p = cyc(c.t + c.sd, per) / per, A = interp(SWIM_ARM, p), Lg = interp(SWIM_LEG, p), gl = sin(p * TAU); P[CLAMP] = 0; P[HIPS * 3] = PI / 2 - .2 - .05 * gl; P[HY] = -.95 - (.17 + .03 * gl) * k; P[HIPS * 3 + 2] = .03 * sin(c.t * .9);
      set(P, SPINE, -.1, 0, 0); set(P, CHEST, -.14, 0, 0); set(P, NECK, -.45, 0, 0); set(P, HEAD, -.55 + .1 * gl, .1 * sin(c.t * .4 + c.sd), 0);
      for (const s of [1, -1]) { arm(P, s, A[1], .3, A[2], A[3], 0); sideSet(P, s, CLAV, 0, 0, .2); }
      both(P, THIGH, Lg[1], 0, Lg[2]); both(P, SHIN, Lg[3], 0, 0); P[FPL] = PI / 2 + .7; P[FPR] = PI / 2 + .7;
      P[AXS] = 1; P[AXX] = .3 * k; P[AXY] = .03 * k + .015 * sin(c.t * 2.1); P[AXZ] = -1.25 * k; P[ARY] = .15 * sin(c.t * .7); },
    chess_move(P, c) { const seat = c.seat === undefined ? .46 : c.seat, t = c.t + c.sd * 5, per = 9 + (c.sd % 4), x = cyc(t, per), mv = sm(x, 0, .55) * (1 - sm(x, 1.25, 1.9)), slam = G(x - 1.02, .1), th = sm(sin(t * .21 + c.sd), .2, .7); seatLegs(P, c, seat, .22);
      set(P, HIPS, .16, 0, 0); set(P, SPINE, .26 + .1 * mv, 0, 0); set(P, CHEST, .2 + .06 * mv, -.08 * mv, 0); set(P, NECK, -.08, 0, 0); set(P, HEAD, .24 - .08 * mv, .1 * sin(t * .3), 0);
      arm(P, 1, lerp(-.7, -.78, th), lerp(-.3, -.2, th), .14, lerp(-1.2, -2.2, th), lerp(.15, .28, th));
      arm(P, -1, lerp(-.62, -1.22, mv) + .1 * slam, -.2, .1, lerp(-1.15, -.5, mv) + .18 * slam, .18); sideSet(P, -1, HAND, .35 * slam, -.5, 0); if (c.var % 3 === 0) P[HEAD * 3 + 1] += .25 * pulse(t + 3, 7, .8, .3) * sin(t * 9); },
    kibitz(P, c) { stand(P, c, false); sway(P, c, .6); const t = c.t + c.sd * 3, pt = pulse(t, 13 + (c.sd % 5), 1.6, .4) * (c.var % 2), shk = pulse(t + 5, 11, 1.2, .3), ln = .5 + .5 * sin(t * .17 + c.sd);
      set(P, SPINE, .06 + .07 * ln, 0, 0); set(P, CHEST, .05 + .05 * ln, 0, 0); set(P, NECK, .08, 0, 0); set(P, HEAD, .24, .22 * shk * sin(t * 7), .05 * sin(t * .3)); both(P, THIGH, -.05 * ln, 0, 0);
      arm(P, 1, .25, -1.75, .1, -1.25, 0); arm(P, -1, lerp(.25, -.95, pt), lerp(-1.75, -.15, pt), .1, lerp(-1.25, -.35, pt), 0); sideSet(P, -1, HAND, 0, -.9 * pt, 0); },
    mahjong(P, c) { const seat = c.seat === undefined ? .46 : c.seat, T1 = (c.sync !== undefined ? c.sync : c.t), sh = pulse(T1, 46, 6, .6), t = T1 + (c.var % 4) * 1.6, x = cyc(t, 6.4), reach = sm(x, 0, .4) * (1 - sm(x, .7, 1.1)), look = sm(x, .9, 1.3) * (1 - sm(x, 2.0, 2.4)), dis = sm(x, 2.3, 2.6) * (1 - sm(x, 2.9, 3.3)), slap = G(x - 2.72, .07); seatLegs(P, c, seat, .2);
      set(P, HIPS, .1, 0, 0); set(P, SPINE, .18 + .08 * (reach + dis), 0, 0); set(P, CHEST, .14, .12 * sin(T1 * .23 + c.sd) * (1 - sh), 0); set(P, NECK, -.05, 0, 0); set(P, HEAD, .22 + .12 * look, .3 * sin(T1 * .31 + c.sd * 2) * (1 - look) * (1 - sh), 0);
      const cs = sin(T1 * 5 + c.sd), cc = cos(T1 * 5 + c.sd), ext = Math.max(reach, dis) * (1 - sh);
      arm(P, -1, lerp(-.72, -1.2, ext) - .12 * look * (1 - ext) + .1 * sh * cs, -.25, .12 + .1 * sh * cc, lerp(-1.3, -.55, ext) - .5 * look * (1 - ext) + .12 * slap + .2 * sh * cc, .2 + .15 * sh * cs); sideSet(P, -1, HAND, .3 * slap, -.6, 0);
      arm(P, 1, -.72 - .3 * sh + .1 * sh * cs, -.25, .12 - .1 * sh * cc, -1.3 + .4 * sh - .2 * sh * cc, .2 - .15 * sh * cs); sideSet(P, 1, HAND, 0, -.6, 0); },
    whip_top(P, c) { stand(P, c, false); const k = c.k, t = c.t + c.sd, x = cyc(t, 2.3), wind = sm(x, 0, .8) * (1 - sm(x, .95, 1.12)), crack = sm(x, .95, 1.12) * (1 - sm(x, 1.5, 2.1)), sn = G(x - 1.08, .08);
      set(P, THIGH, -.34 - .2 * crack, .15, .16); set(P, SHIN, .4 + .25 * crack, 0, 0); set(P, THIGH + 3, .16, -.2, -.16); set(P, SHIN + 3, .2, 0, 0); set(P, HIPS, .08 + .14 * crack, .2 - .5 * wind + .35 * crack, 0); set(P, SPINE, .04 + .12 * crack, -.2 * wind + .2 * crack, 0); set(P, CHEST, .04 + .1 * crack, -.3 * wind + .3 * crack, 0); set(P, HEAD, -.05 + .15 * crack, .3 * wind - .1 * crack, 0);
      arm(P, -1, lerp(-.5, -2.5, wind) * (1 - crack) - .95 * crack, .4 * wind, .3 + .4 * wind, lerp(-.6, -1.5, wind) * (1 - crack) - .15 * crack, .35 * crack); sideSet(P, -1, HAND, .5 * sn, 0, 0); arm(P, 1, -.3 - .3 * crack, -.3, .35, -.9, 0);
      P[AXS] = 1; P[AXX] = (.25 + .08 * sin(t * .43)) * k; P[AXZ] = (1.95 + .1 * sin(t * .31)) * k; P[AXY] = 0; P[ARY] = c.t * 31; P[ARZ] = .06 * sin(t * 3.1); P[ARX] = .06 * cos(t * 3.1); },
    bird_walk(P, c) { const mv = c.v > .15; if (mv) POSE.walk(P, c); else { stand(P, c); sway(P, c, .5); } const t = c.t, sw = mv ? cos(TAU * c.ph) : .25 * sin(t * 1.2 + c.sd);
      arm(P, 1, -.12 - .5 * sw, 0, .16, -.12, 0); P[PL] = 1; arm(P, -1, .25, -1.75, .1, -1.25, 0); if (!mv) { set(P, HEAD, .2, .35, 0); set(P, NECK, .08, .15, 0); } else { P[SPINE * 3] -= .04; P[CHEST * 3] -= .05; } },
    fake_fall(P, c) { const x = c.ts, e = sm(x, .35, 1.7), bump = sin(PI * clamp((x - .3) / 1.3, 0, 1)), wail = sm(x, 1.6, 2.2), t = c.t, A = _A, B = _B; A.fill(0); B.fill(0);
      stand(A, c, false); set(A, CHEST, -.12 * sm(x, 0, .3), 0, 0); arm(A, -1, -.7, -.9, .1, -2.0, .3); arm(A, 1, -.4, .3, .5, -.8, 0); set(A, HEAD, -.25, 0, 0);
      B[HY] = .14 - .95; B[HIPS * 3] = -PI / 2 + .06; set(B, THIGH, .05, .1, .08); set(B, THIGH + 3, -.85, -.1, -.1); set(B, SHIN + 3, 1.5, 0, 0); B[FPL] = -PI / 2 - .5; B[FPR] = -.2; set(B, SPINE, .1, 0, 0); set(B, CHEST, .14, 0, 0); set(B, NECK, .3, 0, 0); set(B, HEAD, .3, .35 * sin(t * 1.3) * wail, 0);
      arm(B, -1, -.5, -.9, .15, -1.9, .3); arm(B, 1, -1.5 - .25 * sin(t * 4) * wail, .2, .25, -.5 - .3 * sin(t * 4 + 1) * wail, 0);
      mixP(P, A, B, e); both(P, THIGH, -1.0 * bump, 0, .1 * bump); both(P, SHIN, 1.7 * bump, 0, 0); P[SPINE * 3] += .5 * bump; P[CHEST * 3] += .3 * bump; P[CLAMP] = 1 - sm(x, .5, 1.0); P[HY] += .1 * bump * (1 - e); P[HZ] = -.35 * e * c.k; },
    demand(P, c) { const t = c.t + c.sd, rub = sin(t * 7), pl = .5 + .5 * sin(t * .8), sp_ = c.speak === undefined ? 1 : c.speak; P[CLAMP] = 0; P[HY] = .125 - .95; set(P, THIGH, -1.5, .1, .14); set(P, SHIN, .1, 0, 0); set(P, THIGH + 3, -1.95, -.1, -.14); set(P, SHIN + 3, 1.35, 0, 0); P[FPL] = -1.1; P[FPR] = 0;
      set(P, HIPS, -.3, 0, 0); set(P, SPINE, .1, 0, 0); set(P, CHEST, .12, .1, 0); set(P, NECK, .05, 0, 0); set(P, HEAD, -.15 + .1 * pl, .15 * sin(t * 2.3) * pl, 0);
      arm(P, 1, -.95 + .1 * sin(t * 3), -.4, .1, -.9, .35); sideSet(P, 1, HAND, .1 * rub, 0, 0);
      arm(P, -1, lerp(-.6, -1.25, sp_), .9, .2, lerp(-1.4, -.55, sp_) + .05 * rub * sp_, 0); sideSet(P, -1, HAND, 0, 1.3, .12 * rub * sp_); },
    livestream(P, c) { stand(P, c, false); sway(P, c, .6); const t = c.t + c.sd, g = cyc(t, 16), wave = sm(g, 0, .4) * (1 - sm(g, 3, 3.5)), heart = sm(g, 5, 5.5) * (1 - sm(g, 8, 8.5)), ptg = sm(g, 10, 10.5) * (1 - sm(g, 13.5, 14)), bo = abs(sin(t * 2.6)), tr = sin(t * .35), rest = (1 - heart) * (1 - ptg);
      P[HY] = .012 * bo; set(P, HIPS, 0, .35 * tr * ptg, 0); set(P, CHEST, -.04, .1 * sin(t * 1.1), .04 * sin(t * 1.7)); set(P, HEAD, -.06, .1 * sin(t * 1.3), .14 * sin(t * .9));
      arm(P, -1, -1.2 + .03 * sin(t * 2), .15, .22, -.35, .1); sideSet(P, -1, HAND, -.25, 0, 0); P[TW] = .5;
      arm(P, 1, lerp(lerp(-.25, -.3, wave), -1.0, Math.max(heart, ptg)), lerp(-.3, 1.2, wave) * rest - .6 * heart, lerp(.15, 1.9, wave) * rest + .2 * heart + .5 * ptg, lerp(-.6, -1.1 - .35 * sin(t * 8), wave) * rest - 2.1 * heart - .2 * ptg, .3 * heart);
      if (c.var % 2) { set(P, THIGH + 3, -.3, 0, 0); set(P, SHIN + 3, .7, 0, 0); P[FPR] = .6; } },
    selfie(P, c) { stand(P, c, false); sway(P, c, .4); const t = c.t + c.sd, tl = sin(t * .5), pk = pulse(t, 6, 3, .4); set(P, CHEST, -.06, .12, .06 * tl); set(P, HEAD, -.12, .15, .2 + .06 * tl); set(P, HIPS, 0, .15, .06); set(P, THIGH + 3, -.35, 0, 0); set(P, SHIN + 3, .8, 0, 0); P[FPR] = .7;
      arm(P, -1, -1.85, .2, .4, -.25, .15); sideSet(P, -1, HAND, -.4, 0, 0); arm(P, 1, lerp(-.3, -.85, pk), -.5, .3, lerp(-.8, -2.3, pk), .1); sideSet(P, 1, HAND, 0, -.8 * pk, 0); P[TW] = .4; },
    group_photo(P, c) { const v = c.var % 4, t = c.t + c.sd, pk = .92 + .08 * sin(t * 1.3), jn = pulse(c.sync !== undefined ? c.sync : t, 9, .5, .15);
      if (v === 2) { squat(P, c, .3); P[HEAD * 3] -= .45; P[NECK * 3] -= .1; arm(P, 1, -.9, -.5, .3, -2.25 * pk, .15); arm(P, -1, -.9, -.5, .3, -2.25 * pk, .15); return; }
      stand(P, c, false); sway(P, c, .4); set(P, HEAD, -.04, 0, (v === 1 ? -.14 : .14)); set(P, CHEST, -.05, 0, 0); P[HY] = .03 * jn;
      if (v === 0) { arm(P, 1, -.85, -.5, .32, -2.3 * pk, .1); arm(P, -1, -.85, -.5, .32, -2.3 * pk, .1); } else if (v === 1) { arm(P, -1, -1.05, .2, .25, -1.5, 0); sideSet(P, -1, HAND, 0, 1.2, 0); arm(P, 1, .28, -1.2, .52, -1.45, 0); }
      else { arm(P, 1, -.2, 1.35, 2.3 + .1 * sin(t * 6), -.6, 0); sideSet(P, 1, CLAV, 0, 0, .22); arm(P, -1, .1, -.3, .13, -.5, 0); } },
    tour_follow(P, c) { if (c.v > .15) { POSE.walk(P, c); P[HEAD * 3 + 1] += .5 * sin(c.t * .5 + c.sd); P[HEAD * 3] -= .12; return; } const v = c.var % 3, t = c.t + c.sd; stand(P, c); sway(P, c, .7);
      if (v === 0) { arm(P, -1, -1.25 + .02 * sin(t * 1.7), .1, .1, -.6, .05); sideSet(P, -1, HAND, -.5, -.9, 0); arm(P, 1, -1.15, .1, .05, -.75, .12); P[PR] = 1; P[TW] = .6; P[PR2] = -1; set(P, HEAD, -.1, 0, .03); P[SPINE * 3] -= .05; }
      else if (v === 1) { set(P, HEAD, -.35, .3 * sin(t * .4), 0); set(P, NECK, -.12, 0, 0); arm(P, 1, -.5, .6, .35, -2.3, 0); P[SPINE * 3] -= .06; }
      else { const fn = sin(t * 6); arm(P, -1, -.5, -.3, .15, -1.9 + .15 * fn, .25 + .1 * fn); P[PR2] = -1; set(P, HEAD, -.05, .25 * sin(t * .3), 0); } },
    tour_lead(P, c) { const mv = c.v > .15, t = c.t + c.sd, sp_ = c.speak === undefined ? .5 + .5 * sin(t * .5) : c.speak; if (mv) POSE.walk(P, c); else { stand(P, c); sway(P, c, .6); }
      arm(P, 1, -.3, -.2, .12, -1.5 + .04 * sin(t * 2.2), 0); P[PL] = 1; if (!mv) { arm(P, -1, lerp(-.2, -1.1 - .15 * sin(t * 2.6), sp_), .4 * sp_, .15 + .3 * sp_, lerp(-.5, -.9 - .3 * sin(t * 3.4), sp_), 0); sideSet(P, -1, HAND, 0, .8 * sp_, 0); set(P, HEAD, .04 * sin(t * 3) * sp_, .3 * sin(t * .6), 0); } },
    flyer(P, c) { const t = c.t + c.sd, of = c.speak === undefined ? pulse(t, 9, 3, .5) : c.speak, nod = sin(t * 4.2) * of; if (c.seat !== undefined) { seatLegs(P, c, c.seat, .16); set(P, HIPS, .05, 0, 0); set(P, SPINE, .1, 0, 0); } else { stand(P, c); sway(P, c, .5); }
      arm(P, 1, lerp(-.42, -.95, of), -.25, .1, lerp(-1.45, -.95, of), .22); sideSet(P, 1, HAND, 0, -.3, 0); P[PL] = 1; arm(P, -1, lerp(-.2, -.85, of), -.2, .12, lerp(-.7, -1.5 + .2 * sin(t * 5), of), lerp(0, .4, of)); sideSet(P, -1, HAND, 0, -.7 * of, 0);
      set(P, CHEST, .06 * of, .1 * sin(t * .4), 0); set(P, HEAD, .05 + .07 * nod, .3 * sin(t * .27) * (1 - of), 0); },
    chase(P, c) { const t = c.t; if (c.v < .2) { stand(P, c, false); sway(P, c, .3); set(P, SPINE, .3, 0, 0); set(P, CHEST, .24 + .05 * sin(t * 4.5), 0, 0); set(P, HEAD, -.3, 0, 0); both(P, THIGH, -.3, 0, .08); both(P, SHIN, .5, 0, 0); arm(P, 1, -.75, -.2, .15, -.35, .1); arm(P, -1, -.75, -.2, .15, -.35, .1); return; }
      POSE.run(P, c); arm(P, -1, -1.35 + .1 * sin(t * 7), -.1, .1, -.3 - .2 * abs(sin(t * 7)), .1); sideSet(P, -1, HAND, 0, -1.2, 0); P[HEAD * 3] += .08; },
    push_cart(P, c) { const k = c.k, t = c.t, mv = c.v > .2; if (mv) { POSE.run(P, c); P[BOB] = .5; P[HIPS * 3] += .1; P[SPINE * 3] += .1; for (const s of [1, -1]) { arm(P, s, -.55, -.2, .1, -.3, .04); sideSet(P, s, HAND, -.3, 0, 0); } P[HEAD * 3 + 1] += .9 * sm(sin(t * 1.4 + c.sd), .5, .95); }
      else { stand(P, c); sway(P, c, .5); const call = pulse(t + c.sd, 8, 2.6, .4); arm(P, -1, lerp(-.55, -.6, call), -.2, .12, lerp(-.4, -2.3, call), .1 + .2 * call); arm(P, 1, -.55, -.2, .12, -.35, .04); set(P, HEAD, -.1 * call, .35 * sin(t * .4 + c.sd), 0); }
      P[AXS] = 1; P[AXX] = 0; P[AXY] = 0; P[AXZ] = 1.52 * k; P[ARZ] = mv ? .012 * sin(TAU * c.ph * 2) : 0; P[ARX] = mv ? -.02 : 0; },
    squat_phone(P, c) { squat(P, c); const t = c.t + c.sd, sc = pulse(t, 2.7, .3, .2), lk = pulse(t + 3, 12, 1.6, .5); set(P, HEAD, .32 - .5 * lk, .5 * lk * (c.var % 2 ? 1 : -1), 0); arm(P, -1, -1.17, -.35, .2, -1.75, .28); sideSet(P, -1, HAND, -.2 + .08 * sc, -.5, 0); P[PR] = 1; arm(P, 1, -1.17, -.1, .22, -1.0, .12); },
    smoke_squat(P, c) { squat(P, c); const t = c.t + c.sd * 5, x = cyc(t, 9), up = sm(x, 0, 1.0) * (1 - sm(x, 2.3, 3.2)), ex = sm(x, 3.0, 3.6) * (1 - sm(x, 4.4, 5.4)); set(P, HEAD, .1 - .2 * ex, .3 * sin(t * .21), 0);
      arm(P, 1, lerp(-1.17, -1.0, up), lerp(-.1, -.5, up), .22, lerp(-1.0, -2.3, up), .12 + .15 * up); P[PL] = 1; arm(P, -1, -1.17, -.1, .22, -1.0, .12); },
    eat_bowl(P, c) { const t = c.t + c.sd * 3, x = cyc(t, 11), eat = 1 - sm(x, 6.5, 7.2) * (1 - sm(x, 9.6, 10.4)), sh = sin(t * 7.5) * eat, sl = pulse(t, 2.2, .7, .25) * eat;
      if (c.seat !== undefined) { seatLegs(P, c, c.seat, .2); set(P, HIPS, .12, 0, 0); set(P, SPINE, .2 + .12 * eat, 0, 0); set(P, CHEST, .14 + .08 * eat, 0, 0); } else { stand(P, c, false); sway(P, c, .5); set(P, SPINE, .06 + .1 * eat, 0, 0); set(P, CHEST, .06 + .08 * eat, 0, 0); }
      set(P, NECK, .1 * eat, 0, 0); set(P, HEAD, .1 + .28 * eat + .05 * sl, .35 * sin(t * .4) * (1 - eat), 0);
      arm(P, 1, lerp(-.5, -.82, eat), -.45, .2, lerp(-1.35, -2.0, eat), .32); sideSet(P, 1, HAND, 0, -.3, 0); P[PL] = 1; arm(P, -1, lerp(-.45, -.8, eat) - .05 * sh, -.5, .22, lerp(-1.2, -2.05, eat) + .16 * sh + .15 * sl, .32); sideSet(P, -1, HAND, -.2, -.4, 0); },
    queue(P, c) { if (c.v > .12) { POSE.walk(P, c); return; } stand(P, c); sway(P, c, 1.1); const t = c.t + c.sd, v = c.var % 3, cr = pulse(t, 10 + (c.sd % 4), 1.8, .5);
      set(P, HEAD, -.12 * cr, (.25 + .2 * (v - 1)) * cr * (c.var % 2 ? 1 : -1), .1 * cr); P[FPL] += .35 * cr; P[FPR] += .35 * cr;
      if (v === 0) { arm(P, 1, -.34, -1.0, .1, -1.72, 0); arm(P, -1, -.42, -1.0, .1, -1.55, 0); } else if (v === 1) { arm(P, 1, .1, -.3, .13, -.5, 0); arm(P, -1, .1, -.3, .13, -.5, 0); }
      else if (c.sp.kit && c.sp.kit.phone) { set(P, NECK, .2 * (1 - cr), 0, 0); P[HEAD * 3] += .32 * (1 - cr); arm(P, -1, -.42, -.12, .05, -1.5, .22); sideSet(P, -1, HAND, -.2, -.5, 0); P[PR] = 1; } },
    carry_pole(P, c) { const mv = c.v > .15, t = c.t; if (mv) { POSE.walk(P, c); P[BOB] = .45; } else { stand(P, c); sway(P, c, .5); } const bob = mv ? .014 * sin(TAU * c.ph * 2) : .004 * sin(t * 1.4);
      arm(P, -1, -1.25, -.3, .3, -2.05, .1); sideSet(P, -1, CLAV, 0, 0, .12); sideSet(P, -1, HAND, -.3, 0, 0); P[SPINE * 3] += .1; P[CHEST * 3] += .06; P[CHEST * 3 + 2] += .05; P[NECK * 3 + 2] -= .1; P[HEAD * 3] -= .08;
      P[AXS] = 1; P[AXX] = -.165; P[AXY] = 1.475 + bob - .5 * (c.sp.stoop || 0) * .12; P[AXZ] = .06; P[ARX] = .1 + .03 * sin(t * 2.2 + 1); P[ARY] = .06; P[ARZ] = mv ? .03 * sin(TAU * c.ph) : 0; },
    scold(P, c) { stand(P, c, false); sway(P, c, .4); const t = c.t + c.sd, wag = sin(t * 9.5), em = .6 + .4 * sin(t * 1.7), jab = Math.max(0, sin(t * 3.1));
      set(P, SPINE, .1 + .05 * jab, 0, 0); set(P, CHEST, .08, .12, 0); set(P, NECK, .04, 0, 0); set(P, HEAD, -.04 + .05 * sin(t * 6.2) * em, .06 * wag * em, 0); P[HZ] = .03 * jab;
      arm(P, 1, .28, -1.2, .52, -1.45, 0); arm(P, -1, -1.05 - .12 * jab, -.1, .12, -1.25 + .25 * jab, .12 + .14 * wag * em); sideSet(P, -1, HAND, -.2, -1.2, .25 * wag); P[TW] = .5; },
    applaud(P, c) { stand(P, c, false); sway(P, c, .5); const t = c.t + c.sd, cl = sin(t * (10 + (c.sd % 2))), up = c.var % 2 ? .3 : 0; set(P, CHEST, -.04, .05 * sin(t * 1.1), 0); set(P, HEAD, -.06 + .04 * sin(t * 2.4), .1 * sin(t * .8), 0);
      for (const s of [1, -1]) { arm(P, s, -1.02 - up, -.1, .12, -1.05 + .07 * cl - up, .2 + .1 * cl); sideSet(P, s, HAND, 0, -.2, 0); } },
    shoot(P, c) { POSE.aim(P, c); const per = .42 + (c.sd % .2), r = Math.exp(-cyc(c.t, per) * 14); P[(ARM + 4) * 3] -= .1 * r; P[ARM * 3] -= .08 * r; P[(FORE + 4) * 3] -= .12 * r; P[CHEST * 3] -= .03 * r; P[HEAD * 3] += .02 * r; P[HZ] -= .012 * r; },
    hit(P, c) { stand(P, c, false); const x = c.ts, e = Math.exp(-x * 3.2) * (1 - Math.exp(-x * 40)), s = c.var % 2 ? 1 : -1; set(P, HIPS, -.1 * e, .25 * s * e, 0); set(P, SPINE, -.25 * e, .2 * s * e, .1 * s * e); set(P, CHEST, -.3 * e, .35 * s * e, .12 * s * e); set(P, NECK, -.2 * e, 0, 0); set(P, HEAD, -.35 * e, -.3 * s * e, 0); P[HZ] = -.12 * e;
      both(P, THIGH, -.25 * e, 0, .08 * e); both(P, SHIN, .5 * e, 0, 0); arm(P, 1, .04 - .5 * e, -.15, .07 + .7 * e, -.3 - .6 * e, 0); arm(P, -1, .04 - .3 * e, -.15, .07 + .5 * e, -.3 - .9 * e, 0); },
    stagger(P, c) { stand(P, c, false); const t = c.t * 1.6 + c.sd, s1 = sin(t * 1.7), s2 = sin(t * 2.3 + 1); P[HX] = .07 * s1; P[HZ] = .05 * s2; set(P, HIPS, .2, .15 * s2, .08 * s1); set(P, SPINE, .32 + .08 * s2, 0, -.1 * s1); set(P, CHEST, .26, .1 * s1, -.08 * s1); set(P, NECK, .1, 0, 0); set(P, HEAD, .3, .2 * s2, .12 * s1);
      set(P, THIGH, -.35 - .25 * Math.max(0, s1), 0, .14); set(P, SHIN, .6 + .4 * Math.max(0, s1), 0, 0); set(P, THIGH + 3, -.35 - .25 * Math.max(0, -s1), 0, -.14); set(P, SHIN + 3, .6 + .4 * Math.max(0, -s1), 0, 0); arm(P, 1, -.5, -.9, .1, -1.75, .3); arm(P, -1, -.3 + .2 * s2, .2, .5 + .2 * s1, -.7, 0); },
    fall(P, c) { const x = c.ts, e = sm(x, 0, .75), e2 = e * e, bn = x > .75 ? .06 * Math.exp(-(x - .75) * 6) * abs(sin((x - .75) * 14)) : 0, A = _A, B = _B, s = c.var % 2 ? 1 : -1; A.fill(0); B.fill(0); stand(A, c, false); arm(A, 1, -.6, .3, .7, -.6, 0); arm(A, -1, -.6, .3, .7, -.6, 0); set(A, HEAD, -.3, 0, 0);
      B[HY] = .075 - .95; B[HIPS * 3] = -PI / 2 + .04; B[HIPS * 3 + 1] = .12 * s; set(B, THIGH, .04, .15, .16); set(B, THIGH + 3, -.4 * (s > 0 ? 1 : .2), -.15, -.2); set(B, SHIN + 3, .8 * (s > 0 ? 1 : .2), 0, 0); B[FPL] = -PI / 2 - .5; B[FPR] = -PI / 2 - .3; set(B, NECK, .1, 0, 0); set(B, HEAD, .1, .5 * s, 0); arm(B, 1, -.2, 0, .95, -.12, 0); arm(B, -1, -.25, 0, .5, -.22, 0);   /* QA: lying flat, both arms on the ground (one hand used to point at the sky) and the back on the floor (the body floated a hand's width over it) */
      mixP(P, A, B, e2); const bump = sin(PI * e) * (1 - e * .3); both(P, THIGH, -.7 * bump, 0, 0); both(P, SHIN, 1.3 * bump, 0, 0); P[CLAMP] = 1 - sm(x, .15, .5); P[HY] += bn; P[HZ] = -.5 * e2 * c.k; },
    punch(P, c) { stand(P, c, false); const t = c.t * 1.15 + c.sd, x = cyc(t, 1.5), jab = sm(x, .0, .09) * (1 - sm(x, .13, .3)), crs = sm(x, .42, .54) * (1 - sm(x, .6, .82)), bo = sin(t * 6.5) * .5 + .5;
      set(P, THIGH, -.32, .2, .14); set(P, SHIN, .42, 0, 0); set(P, THIGH + 3, .1, -.35, -.16); set(P, SHIN + 3, .36, 0, 0); P[FPR] = .25; P[HY] = -.01 * bo; set(P, HIPS, .06, -.35 + .12 * jab + .5 * crs, 0); set(P, SPINE, .08, .1 + .25 * crs, 0); set(P, CHEST, .1, .12 - .1 * jab + .35 * crs, 0); set(P, NECK, -.05, -.1 * crs, 0); set(P, HEAD, .06, .1 - .5 * crs, 0); P[HZ] = .04 * jab + .08 * crs;
      arm(P, 1, lerp(-.75, -1.45, jab), -.3, .15, lerp(-2.15, -.12, jab), .25 * (1 - jab)); arm(P, -1, lerp(-.7, -1.5, crs), -.3, .2, lerp(-2.2, -.1, crs), .25 * (1 - crs) + .15 * crs); sideSet(P, 1, CLAV, 0, 0, .1 + .12 * jab); sideSet(P, -1, CLAV, 0, 0, .1 + .12 * crs); },
    traffic(P, c) { stand(P, c, false); sway(P, c, .25); const t = c.t + c.sd, ph = Math.floor(cyc(t, 16) / 8), x = cyc(t, 8), on = sm(x, .2, .7) * (1 - sm(x, 6.6, 7.4)), bk = sin(t * 5.2) * on, stopS = ph ? -1 : 1; set(P, CHEST, -.04, 0, 0); set(P, HEAD, -.02, (ph ? -.7 : .7) * on, 0);
      arm(P, stopS, lerp(.04, -.05, on), lerp(-.15, .5, on), lerp(.07, 1.5, on), lerp(-.3, -.08, on), 0); sideSet(P, stopS, HAND, 0, 0, -1.2 * on); arm(P, -stopS, lerp(.04, -1.0, on), lerp(-.15, -.2, on), lerp(.07, .3, on), lerp(-.3, -1.2 - .5 * bk, on), .35 * on); },
    pull_trolley(P, c) { const k = c.k, mv = c.v > .12; if (mv) POSE.walk(P, c); else { stand(P, c); sway(P, c, .6); } arm(P, -1, .5, 0, .1, -.12, 0); P[PL] = 1;
      P[AXS] = 1; P[AXX] = -.2 * k; P[AXY] = 0; P[AXZ] = -.62 * k; P[ARX] = .5 + (mv ? .03 * sin(TAU * c.ph * 2) : 0); },
    balance_bike(P, c) { stand(P, c, false); const mv = c.v > .2, p = c.ph, t = c.t; P[HZ] = -.02;
      for (const s of [1, -1]) { const q = s > 0 ? p : (p + .5) % 1, f = mv ? .5 * cos(TAU * q) : 0, kn = mv ? .25 + .5 * Math.max(0, sin(TAU * q)) : .2; sideSet(P, s, THIGH, -.35 - f, 0, .3); sideSet(P, s, SHIN, .5 + kn, 0, 0); arm(P, s, -1.0, -.2, .28, -.45, 0); }
      set(P, HIPS, .1, 0, mv ? .05 * sin(TAU * p) : 0); set(P, SPINE, .14, 0, 0); set(P, CHEST, .1, 0, 0); set(P, NECK, -.14, 0, 0); set(P, HEAD, -.12, .25 * sin(t * .6 + c.sd), 0);
      P[AXS] = 1; P[AXX] = 0; P[AXY] = 0; P[AXZ] = .02; P[ARZ] = mv ? .04 * sin(TAU * p) : 0; },
    cook(P, c) { stand(P, c, false); sway(P, c, .4); const t = c.t + c.sd, v = c.var % 2, st = sin(t * (v ? 5.2 : 3.4)), up = pulse(t, 5.5, 1.4, .35) * v, call = c.speak === undefined ? pulse(t + 2, 12, 2.5, .5) : c.speak; set(P, SPINE, .1, 0, 0); set(P, CHEST, .08, .08 * st * (1 - call), 0); set(P, HEAD, .2 * (1 - call) - .05 * call, .4 * call, 0);
      arm(P, -1, -.72 - .1 * st - .45 * up, -.3, .14, -1.2 + .14 * st - .5 * up, .2 + .1 * st); sideSet(P, -1, HAND, .2 * st, -.3, 0); arm(P, 1, lerp(-.6, -.9, call), -.35, .16, lerp(-1.3, -1.9 - .2 * sin(t * 5), call), .2); P[PL] = 1; },
    dog_idle(P, c) { const t = c.t + c.sd, pant = sin(t * 5.5), lk = sin(t * .4); P[NECK * 3] = -.12; P[HEAD * 3] = -.08 + .03 * pant + .12 * sin(t * .23); P[HEAD * 3 + 1] = .5 * lk; P[NECK * 3 + 1] = .25 * lk; P[CHEST * 3 + 1] = .06 * lk; P[HEAD * 3 + 2] = .25 * pulse(t, 9, 1.2, .3);
      P[AXS] = 1; P[AXY] = .345; P[AXZ] = -.262; P[ARX] = -.2; P[ARZ] = .55 * sin(t * 13) * sm(sin(t * .3), -.2, .5); },
    dog_trot(P, c) { const p = c.ph, t = c.t; P[HY] = .012 * sin(TAU * p * 2); P[HIPS * 3 + 2] = .04 * sin(TAU * p); P[NECK * 3] = -.2; P[HEAD * 3] = .05 * sin(TAU * p * 2); P[HEAD * 3 + 1] = .2 * sin(t * .7 + c.sd);
      for (const s of [0, 1]) { const q = (p + s * .5) % 1, a = s ? ARM + 4 : ARM, b = s ? THIGH : THIGH + 3, sw = sin(TAU * q), lf = Math.max(0, cos(TAU * q)); P[a * 3] = .55 * sw; P[(a + 1) * 3] = .75 * lf; P[(a + 2) * 3] = -.3 * lf; P[b * 3] = .5 * sw; P[(b + 1) * 3] = .7 * lf; }
      P[AXS] = 1; P[AXY] = .35 + P[HY]; P[AXZ] = -.262; P[ARX] = -.35; P[ARZ] = .4 * sin(t * 11); },
    dog_sit(P, c) { const t = c.t + c.sd, lk = sin(t * .35); P[HIPS * 3] = -.62; P[HY] = -.115; P[THIGH * 3] = -.85; P[(THIGH + 3) * 3] = -.85; P[SHIN * 3] = 1.95; P[(SHIN + 3) * 3] = 1.95; P[ARM * 3] = .6; P[(ARM + 4) * 3] = .6; P[NECK * 3] = .28; P[HEAD * 3] = .3 + .04 * sin(t * 5.5); P[HEAD * 3 + 1] = .5 * lk; P[HEAD * 3 + 2] = .3 * pulse(t, 7, 1.5, .3);
      P[AXS] = 1; P[AXY] = .2; P[AXZ] = -.3; P[ARX] = -1.2; P[ARZ] = .5 * sin(t * 9) * sm(sin(t * .4), 0, .6); }
  });
  { const fish0 = POSE.fish; POSE.fish = (P, c) => { fish0(P, c); if (c.seat !== undefined) { for (const b of [THIGH, SHIN, THIGH + 3, SHIN + 3]) clr3(P, b); P[FPL] = P[FPR] = 0; P[HX] = 0; P[HIPS * 3 + 2] = 0; seatLegs(P, c, c.seat, .2); P[AXY] += P[HY]; P[SPINE * 3] += .12; } }; }
  const CN_STATES = ['square_dance', 'fan_dance', 'taichi', 'handstand', 'dive', 'swim', 'chess_move', 'kibitz', 'mahjong', 'whip_top', 'bird_walk', 'fake_fall', 'demand', 'livestream', 'selfie', 'group_photo', 'tour_follow', 'tour_lead', 'flyer', 'chase', 'push_cart', 'squat_phone', 'smoke_squat', 'eat_bowl', 'queue', 'carry_pole', 'scold', 'applaud', 'shoot', 'hit', 'stagger', 'fall', 'punch', 'traffic', 'pull_trolley', 'balance_bike', 'cook', 'dog_idle', 'dog_trot', 'dog_sit'];
  /** China-edition locomotion states: default speed when the caller passes none (0 = the standing variant) */
  const CN_LOCO = { bird_walk: .8, chase: 4.2, push_cart: 3.6, carry_pole: 1.1, pull_trolley: .9, balance_bike: 1.7, tour_follow: 0, tour_lead: 0, queue: 0, dog_trot: 1.6 }, CN_RUN = { chase: 1, push_cart: 1 };
  const UPRIGHT_L = { flag: 1, paper: 1, bowl: 1, cup: 1, coffee: 1, thermos: 1, can: 1, bottle: 1 }, HOLD_OK = { idle: 1, walk: 1, talk: 1, talk_group: 1, queue: 1, phone_look: 1, phone_call: 1, tour_follow: 1, point: 1, film: 1, scold: 1, kibitz: 1, applaud: 0, shrug: 1, wave: 1, bird_walk: 0, pull_trolley: 1, selfie: 0, group_photo: 0 };
  POSE.jog = POSE.run;
  const STATES = Object.keys(POSE);
  const LOCO = { walk: 1, run: 1, jog: 1, carry_run: 1, flee: 1, carry_box: 1, skate: 1, scoot: 0, bird_walk: 1, chase: 1, push_cart: 1, carry_pole: 1, pull_trolley: 1, balance_bike: 1, tour_follow: 1, tour_lead: 1, queue: 1, dog_trot: 1 };
  const NEW_STATES = ['lean_wall', 'sit_bench', 'sit_ground', 'sit_stool', 'talk_group', 'phone_look', 'phone_call', 'smoke', 'drink', 'dance', 'cheer', 'film', 'flee', 'cower', 'point', 'shrug', 'play_guitar', 'dribble', 'shoot_hoop', 'spot', 'wrestle_a', 'wrestle_b', 'carry_box', 'sweep', 'lift', 'fish', 'sunbathe', 'lean_rail', 'skate', 'scoot', 'stretch', 'jog'];
  /** where a figure's AUX prop rests while the current state does not use it: [x, y, z, rx, ry, rz] */
  const AUX_REST = { board: [.265, .415, .05, -PI / 2 + .05, 0, 0], scooter: [.52, 0, .05, 0, .35, 0], barbell: [0, .2, .5, 0, 0, 0], broom: [-.3, .0, .16, -.06, 0, .05], box: [0, .152, .5, 0, .3, 0],
    bbroom: [-.3, 0, .16, -.06, 0, .05], pole: [.3, .78, .1, -PI / 2 + .07, 0, 0], pole_load: [.55, .88, .35, 0, PI / 2 - .2, 0], trolley: [-.36, 0, -.05, 0, -.3, 0], foldbike: [.62, 0, .05, 0, .5, 0], ringlight: [.12, 0, 1.05, 0, PI, 0], fruitcart: [0, 0, 1.52, 0, 0, 0], pstool: [0, 0, -.16, 0, 0, 0], mazha: [0, 0, -.16, 0, .2, 0], balance_bike: [.42, 0, .1, 0, .5, 0], buoy: [.32, .1, .2, 0, .6, 0] };
  const USES_R = { phone: 1, phone_look: 1, phone_call: 1, film: 1, point: 1, wave: 1, aim: 1, handsup: 1, cheer: 1, shoot_hoop: 1, dribble: 1, lift: 1, spot: 1, play_guitar: 1, carry_box: 1, cower: 1 };
  const NO_REST = { flee: 1, cower: 1, run: 1, jog: 1, carry_run: 1, walk: 1, handsup: 1, sit_ground: 1, sunbathe: 1, wrestle_a: 1, wrestle_b: 1, handstand: 1, dive: 1, swim: 1, fake_fall: 1, demand: 1, fall: 1, chase: 1, stagger: 1, hit: 1 };
  const HIDE_HAND = { handstand: 1, dive: 1, swim: 1, fall: 1, fake_fall: 1, demand: 1, punch: 1, aim: 1, shoot: 1, handsup: 1, cower: 1, stagger: 1 };

  { const idle0 = POSE.idle; POSE.idle = (P, c) => { idle0(P, c); if (c.sp.kit && c.sp.kit.propL === 'ball') { arm(P, 1, -.12, -.7, .34, -1.05, 0); P[PL] = 1; } else if (c.var % 4 === 1 && c.kind === 'ped') { arm(P, 1, .1, -.3, .13, -.5, 0); arm(P, -1, .1, -.3, .13, -.5, 0); } else if (c.var % 4 === 2 && c.kind === 'ped') { arm(P, 1, -.34, -1.0, .1, -1.72, 0); arm(P, -1, -.42, -1.0, .1, -1.55, 0); } }; }

  { const idle1 = POSE.idle; POSE.idle = (P, c) => { idle1(P, c); const kt = c.sp.kit || {}; if (kt.propR2 === 'cane') { arm(P, -1, -.12, 0, .1, -.12, 0); if (c.var % 2) arm(P, 1, .25, -1.75, .1, -1.25, 0); } else if (c.sp.named === '辣姐') { arm(P, 1, -.34, -1.0, .1, -1.72, 0); arm(P, -1, -.2, -.3, .16, -.9, 0); } }; }

  /* ------------------------------------------------------------------ instances */
  const _m = new T.Matrix4(), _m2 = new T.Matrix4(), _v = new T.Vector3(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _e = new T.Euler(), YAX = new T.Vector3(0, 1, 0);
  const SOLE = [[0, -.085, -.07], [0, -.085, .13], [0, -.079, .2]];
  const KINDS = ['partner', 'clerk', 'cop', 'ped', 'driver'];
  let count = 0;
  /* ================================================================== round 3 — NPC bodies from the hero's builders (GT.hero._b)
     The figure is the hero's skeleton (same bone names, fingers, toes, eyelids) carrying three vertex-coloured skinned meshes (skin / hair / cloth)
     lofted with the hero's tube builders, in two levels of detail (near ≈ 9–11k tris, built lazily one per frame; mid ≈ 2.5k). Every NPC shares
     three materials and a handful of neutral atlases (colour comes from vertex colours), so there are no per-NPC textures or shader variants.
     The round-2 pose system (FK channels + props on PROPL/PROPR/AUX) drives the new skeleton unchanged; the round-2 accessories (hats, vests,
     aprons, bags, patches, hand props, carts) are still built by buildFigure(sp, true) and ride on "legacy" skeleton entries: the same bones
     with inverse-bind matrices that map the old 1.75 m mannequin onto the new body. Walking uses the hero's gait (IK, planted feet). */
  let HB = null, NBON = null, CM = null, NBM = null, NBR = null, NBINV = null;
  const NBGEO = {}, NBQ = [], NBT = { build: 0, n: 0, near: 0, nearN: 0, tex: 0 }, CAMP = new T.Vector3(), CAMS = { f: -1, qf: -2 }, WHT3 = [1, 1, 1], NKY = 1.055, NSH = .045;
  const nbNow = () => performance.now(), FAR_ON = !/[?&]farlod=0/.test(location.search), MD_FAR = +((location.search.match(/[?&]mdfar=([\d.]+)/) || [])[1] || 60);
  const nbOK = () => { if (NBON === null) { HB = (GT.hero && GT.hero._b) || null; NBON = !!HB && !/[?&]npcold=1/.test(location.search); if (NBON) nbInit(); } return NBON; };
  const nbHC = col => { const c = lin(col), m = Math.max(c[0], c[1], c[2], .02); return mul(c, Math.min(1.75, .42 / m)); };
  const nmy = y => y <= .925 ? y : .925 + (y - .925) * NKY;
  const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const hashS = s => { let h = 2166136261; for (let i = 0; i < s.length; i += 7) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0); };
  function nbInit() {
    const B = HB;
    CM = class extends B.Mesher { constructor() { super(); this.c = []; this.col = WHT3; this.cf = null; }
      v(x, y, z, u, v, w) { const i = this.p.length, c = this.cf ? this.cf(x, y, z, u, v) : this.col; this.c[i] = c[0]; this.c[i + 1] = c[1]; this.c[i + 2] = c[2]; return super.v(x, y, z, u, v, w); }
      geo() { const g = super.geo(), n = this.p.length, c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = this.c[i] === undefined ? (i >= 3 ? c[i - 3] : 1) : this.c[i]; g.setAttribute('color', new T.BufferAttribute(c, 3)); g.boundingSphere = new T.Sphere(new T.Vector3(0, .95, 0), 1.45); return g; } };
    NBR = { TOR: [0, .5, .5, 1], TORJ: [.5, .5, 1, 1], SLV: [0, .25, .25, .5], SLVJ: [.25, .25, .5, .5], LEG: [.5, .1, .75, .5], LEGD: [.75, .1, 1, .5], PEL: [0, .1, .5, .25], SHOE: [0, 0, .25, .1], SHAFT: [.25, 0, .375, .1], KNIT: [.375, 0, .5, .1], FLAT: [.5, 0, .625, .1], PLAIN: [.06, .62, .2, .72], SKIN: [.02, .14, .48, .46] };
    const D = B.BDEF, bones = D.map(d => { const b = new T.Bone(); b.position.set(d[2], d[3], d[4]); if (d[5]) b.rotation.z = d[5]; return b; }); D.forEach((d, i) => { if (d[1]) bones[B.BI[d[1]]].add(bones[i]); }); bones[0].updateMatrixWorld(true);
    NBINV = bones.map(b => new T.Matrix4().copy(b.matrixWorld).invert());
    NBM = { tex: {}, skin: {}, hair: null, cloth: null };
  }
  /* ---- shared neutral atlases (albedo is near white: vertex colours carry skin tone, dye and hair colour) */
  function nbClothTex() { const t0 = nbNow(), B = HB, A = new B.Atlas(1024), fs = B.fs, fh = B.FH(), fd = B.FD(), fv = B.FV(), R = NBR;
    const cot = B.cloth(0xf4f4f4, { seed: 3, ro: .9, wr: .4, kx: 2.2 }), nyl = B.cloth(0xf2f2f2, { seed: 23, ro: .5, wr: .55, kx: 2.9, weave: .5 }), den = B.cloth(0xe8e8e8, { seed: 7, ro: .88, wr: .45, kx: 1.7, twill: true }), tw = B.cloth(0xf0f0f0, { seed: 9, ro: .84, wr: .5, kx: 2.2 }), knit = B.cloth(0xeeeeee, { seed: 44, ro: .95 });
    A.shade(R.TOR, (u, v, x, y, o) => { cot(x, y, o, 1 + .05 * fs(fd, x, y) - .09 * (1 - sm(v, .02, .14))); o.h += (fs(fh, x, y) - .5) * 1.1 * G(v - .32, .18); });
    A.shade(R.TORJ, (u, v, x, y, o) => { if (v < .07) { knit(x, y, o, .93); o.h = sin(x * 1.0) * .6; return; } nyl(x, y, o, 1 + .06 * fs(fd, x, y) - .1 * (1 - sm(v, .07, .2)) * fs(fd, x * 2, y)); o.h += (fs(fh, x, y) - .5) * 1.3 * (G(v - .16, .1) + .3) + (fs(fv, x, y) - .5) * .4; });
    A.shade(R.SLV, (u, v, x, y, o) => { const el = (fs(fh, x, y * 1.4) - .5) * 1.8 * G(v - .46, .13); cot(x, y, o, 1 + el * .02 + .04 * fs(fd, x, y)); o.h += el; });
    A.shade(R.SLVJ, (u, v, x, y, o) => { if (v < .085) { knit(x, y, o, .93); o.h = sin(x * 1.0) * .6; return; } const el = (fs(fh, x, y * 1.3) - .5) * 2.2 * (G(v - .46, .16) + .3); nyl(x, y, o, 1 + el * .02 + .05 * fs(fd, x, y)); o.h += el; });
    A.shade(R.LEG, (u, v, x, y, o) => { const knee = (fs(fh, x, y * 1.2) - .5) * 2 * G(v - .47, .1), stack = (fs(fh, x, y * 2.2) - .5) * 2.6 * (1 - sm(v, .02, .2)); tw(x, y, o, 1 + .05 * fs(fd, x, y) + (knee + stack) * .02 - .16 * (1 - sm(v, 0, .1)) * fs(fd, x * 2, y * 2)); o.h += knee + stack; });
    A.shade(R.LEGD, (u, v, x, y, o) => { const front = G(Math.min(u, 1 - u), .16), back = G(u - .5, .13), knee = (fs(fh, x, y * 1.2) - .5) * 2.2 * G(v - .47, .1), stack = (fs(fh, x, y * 2.2) - .5) * 3 * (1 - sm(v, .02, .2));
      den(x, y, o, .9 + .04 * fs(fd, x, y) + (knee + stack) * .025 + .14 * front * G(v - .74, .2) + .1 * front * G(v - .47, .07) + .07 * back * G(v - .86, .1) + (fs(fv, x, y) - .5) * .1 - .16 * (1 - sm(v, 0, .12)) * fs(fd, x * 2, y * 2)); o.h += knee + stack; });
    A.shade(R.PEL, (u, v, x, y, o) => { tw(x, y, o, 1 + .05 * fs(fd, x, y)); o.h += (fs(fh, x, y) - .5) * 1.5; });
    A.shade(R.SHOE, (u, v, x, y, o) => { const bot = abs(u - .5); if (bot < .23) { const tread = bot < .13; o.r = o.g = o.b = tread ? .5 : .92 - .2 * fs(fd, x * 2, y * 2); o.h = tread ? sin(y * .9) * .5 : .4; o.ro = .75; o.me = 0; return; } tw(x, y, o, 1 - .22 * sm(bot, .34, .23) * fs(fd, x * 2, y * 2)); o.ro = .62; o.h += .5 * sm(v, .7, .78) - .2; if (v > .74) { o.r *= .9; o.g *= .9; o.b *= .9; } });
    A.shade(R.SHAFT, (u, v, x, y, o) => { knit(x, y, o, 1); o.h = sin(x * 1.1) * .5; });
    A.shade(R.KNIT, (u, v, x, y, o) => { knit(x, y, o, 1); o.h = sin(x * 1.0) * .6; });
    A.shade(R.FLAT, (u, v, x, y, o) => { o.r = o.g = o.b = .93 + .05 * fs(fd, x, y); o.h = (fs(fd, x * 2, y * 2) - .5) * .3; o.ro = .34 + .12 * fs(fd, x * 3, y * 3); o.me = 0; });
    A.begin(); const th = 'rgba(120,120,124,.6)', dk = 'rgba(0,0,0,.28)';
    { const P = A.pen(R.TOR); P.seam([[0, .935], [.2, .94], [.5, .925], [.8, .94], [1, .935]], { rows: 1, thread: th, dark: 'rgba(0,0,0,.16)' });   /* PP: the shoulder seam sits on top of the shoulder, not across the chest */ P.seam([[.25, .06], [.25, .8]], { rows: 0, dark: 'rgba(0,0,0,.14)' }); P.seam([[.75, .06], [.75, .8]], { rows: 0, dark: 'rgba(0,0,0,.14)' }); P.seam([[0, .075], [1, .075]], { rows: 2, thread: th, dark: dk }); }
    { const P = A.pen(R.TORJ); for (const uz of [.006, .994]) { P.path([[uz, .075], [uz, .95]]).stroke({ c: 'rgba(40,40,44,.75)', w: 8, h: -.3, hw: 10 }); P.path([[uz, .075], [uz, .95]]).stroke({ c: '#b4b2ac', w: 2.5, dash: [2, 2], h: .5, ro: .3, me: .8 }); }
      P.seam([[0, .075], [1, .075]], { rows: 1, thread: th }); P.seam([[.25, .08], [.25, .7]], { rows: 1, thread: th }); P.seam([[.75, .08], [.75, .7]], { rows: 1, thread: th }); P.seam([[0, .87], [.25, .88], [.5, .86], [.75, .88], [1, .87]], { rows: 1, thread: th });
      for (const s of [.12, .88]) { const d = s < .5 ? 1 : -1; P.path([[s - .03 * d, .36], [s + .035 * d, .2]]).stroke({ c: 'rgba(0,0,0,.5)', w: 4, h: -.7, hw: 6 }); P.seam([[s - .04 * d, .37], [s + .045 * d, .185]], { rows: 1, thread: th, off: 5 }); } }
    { const P = A.pen(R.SLV); P.seam([[.5, 0], [.5, .95]], { rows: 1, thread: th, dark: dk }); P.seam([[0, .1], [1, .1]], { rows: 2, thread: th, dark: dk }); const Q = A.pen(R.SLVJ); Q.seam([[.5, .085], [.5, .95]], { rows: 1, thread: th }); Q.seam([[0, .085], [1, .085]], { rows: 1, thread: th }); }
    for (const rc of [R.LEG, R.LEGD]) { const P = A.pen(rc), dn = rc === R.LEGD; P.seam([[.25, 0], [.25, 1]], { rows: dn ? 2 : 1, thread: th, dark: dk }); P.seam([[.75, 0], [.75, 1]], { rows: 1, thread: th, dark: dk }); P.seam([[0, .035], [1, .035]], { rows: dn ? 2 : 1, thread: th, dark: dk }); }
    { const P = A.pen(R.PEL); P.seam([[0, .86], [1, .86]], { rows: 1, thread: th, dark: dk }); for (const lu of [.06, .22, .4, .5, .6, .78, .94]) P.rrect(lu - .006, .82, .012, .17, 2).fill({ c: 'rgba(0,0,0,.2)', h: .7 }); P.seam([[.25, 0], [.25, .86]], { rows: 1, thread: th, dark: dk }); P.seam([[.75, 0], [.75, .86]], { rows: 1, thread: th, dark: dk });
      P.seam([[.26, .78], [.5, .64], [.74, .78]], { rows: 1, thread: th, dark: dk }); P.seam([[.5, .64], [.5, 0]], { rows: 1, thread: th, dark: dk }); for (const s of [.405, .595]) { const w = .07, pts = [[s - w, .6], [s + w, .6], [s + w * .92, .2], [s, .08], [s - w * .92, .2], [s - w, .6]]; P.path(pts, true).fill({ c: 'rgba(0,0,0,.06)', h: .35 }); P.seam(pts, { rows: 1, thread: th, side: -1, dark: dk }); }
      for (const s of [.1, .9]) { const d = s < .5 ? 1 : -1; P.seam([[s - .08 * d, .86], [s - .04 * d, .62], [s + .1 * d, .5]], { rows: 1, thread: th, dark: dk }); } P.seam([[.006, 0], [.006, .86]], { rows: 1, thread: th, dark: dk }); P.ellipse(.0, .92, .009, .05).fill({ c: '#a8a49a', h: .7, ro: .3, me: .8 }); P.ellipse(1, .92, .009, .05).fill({ c: '#a8a49a', h: .7, ro: .3, me: .8 }); }
    { const P = A.pen(R.SHOE); for (let i = 0; i < 5; i++) { const v0 = .46 + i * .055, lc = { c: 'rgba(255,255,255,.9)', w: 2, h: .8, hw: 3 }, vm = v0 + .014; P.path([[.94, v0], [1, vm]]).stroke(lc); P.path([[0, vm], [.06, v0 + .028]]).stroke(lc); P.path([[.94, v0 + .028], [1, vm]]).stroke(lc); P.path([[0, vm], [.06, v0]]).stroke(lc); }
      for (const s of [.17, .83]) { const dd = s < .5 ? 1 : -1; P.seam([[s - .09 * dd, .78], [s + .09 * dd, .7]], { rows: 1, thread: th, dark: dk }); P.seam([[s - .08 * dd, .05], [s - .08 * dd, .3], [s + .07 * dd, .12]], { rows: 1, thread: th, dark: dk }); } }
    const out = A.finish(1.7); NBT.tex += nbNow() - t0; return out; }
  function nbHairTex() { const t0 = nbNow(), B = HB, A = new B.Atlas(512), fs = B.fs, st = B.field(128, 3, 2, 111), st2 = B.field(48, 4, 3, 112), cl = B.field(10, 4, 4, 113);
    for (let k = 0; k < 5; k++) A.shade([0, k / 5, 1, (k + 1) / 5], (u, v, x, y, o) => { const c = fs(cl, x, y), wx = x + (c - .5) * 46 + sin(y * .09 + c * 9) * 3, s = fs(st, wx, y * .6), s2 = fs(st2, wx, y * .5), lum = .62 + s * .2 + s2 * .22 + c * .12; o.r = o.g = o.b = lum; o.h = (s - .5) * .9 + (s2 - .5) * .8; o.ro = .48 + s2 * .2; o.me = 0;
      o.a = k === 4 ? clamp((s * .55 + s2 * .5 - .12 - sm(v, .35, 1) * .62) * 6 + .5, 0, 1) : k === 0 ? clamp((sm(v, 0, .3) * 1.2 + s * .55 + s2 * .35 - .75) * 5 + .5, 0, 1) : clamp((s * .5 + s2 * .35 + c * .5 - (.36 + k * .1) - (1 - sm(v, 0, .34)) * .5 - sm(v, .8, 1) * .1) * 6 + .5, 0, 1); });
    const out = A.finish(2); NBT.tex += nbNow() - t0; return out; }
  /* face variants: child, f_young, f_old, m_young, m_stubble, m_stache, m_old */
  const NB_FACE = { child: { blush: 1.5, browK: .55, brow: '#2a211c', lipU: 'rgba(190,96,92,.5)', lipL: 'rgba(200,104,98,.5)', lash: 1 }, f_young: { fem: 1, blush: 1.5, browK: .62, brow: '#1e1613', lipU: 'rgba(168,44,52,.82)', lipL: 'rgba(182,52,58,.82)', lash: 1.9 },
    f_old: { fem: 1, old: .7, blush: 1.2, browK: .5, brow: '#241a16', lipU: 'rgba(150,62,62,.7)', lipL: 'rgba(160,70,66,.7)', lash: 1.4 }, m_young: { blush: .8, browK: 1, brow: '#1a1310', lipU: 'rgba(150,86,78,.55)', lipL: 'rgba(166,98,88,.5)', lash: 1, stubble: .1 },
    m_stubble: { blush: .7, browK: 1.1, brow: '#18110e', lipU: 'rgba(140,80,72,.55)', lipL: 'rgba(156,92,82,.5)', lash: 1, stubble: .34 }, m_stache: { blush: .8, browK: 1.15, brow: '#18110e', lipU: 'rgba(140,80,72,.55)', lipL: 'rgba(156,92,82,.5)', lash: 1, stubble: .16, stache: 1 },
    m_old: { old: 1, blush: .9, browK: .9, brow: '#6e6a66', lipU: 'rgba(138,90,84,.5)', lipL: 'rgba(150,100,92,.45)', lash: .9, stubble: .12 },
    /* street muscle: heavy brows drawn down to the nose, a crease between them, bags and hollow cheeks, a day's stubble, thin dark lips, a scar through one brow (hard = extra shadow, frown = how far the brows tilt) */
    m_thug: { blush: .35, browK: 1.4, brow: '#120c0a', lipU: 'rgba(112,62,58,.7)', lipL: 'rgba(124,70,64,.62)', lash: 1.25, stubble: .5, hard: 1, frown: 1, scar: 1, old: .28 }, m_thug2: { blush: .3, browK: 1.3, brow: '#120c0a', lipU: 'rgba(112,62,58,.7)', lipL: 'rgba(124,70,64,.62)', lash: 1.2, stubble: .3, stache: 1, hard: .8, frown: .8, old: .2 } };
  function nbSkinTex(key) { const t0 = nbNow(), V = NB_FACE[key] || NB_FACE.m_young, B = HB, A = new B.Atlas(512), fs = B.fs, EYE = B.EYE, HV = B.HV, HVI = B.HVI, f1 = B.field(4, 4, 6, 91), f2 = B.field(48, 48, 3, 92), f3 = B.field(128, 128, 2, 93), fa = B.field(2, 30, 4, 95), R = B.R, old = V.old || 0, fem = !!V.fem, eyeTop = B.eyeTop, eyeBot = B.eyeBot;
    const base = (x, y, o, k) => { const X = x * 2, Y = y * 2, n = fs(f1, X, Y), m = fs(f2, X, Y); k *= .9; o.r = k * (.96 + n * .1); o.g = k * (.94 + n * .12 + m * .02); o.b = k * (.93 + n * .12 + m * .03); o.h = (m - .5) * .07 + (fs(f3, X, Y) - .5) * (.05 + .05 * old); o.ro = .52 + m * .1 + n * .06; o.me = 0; };
    A.shade(R.HEAD, (u, v, x, y, o) => { const yy = HVI(v), du = u > .5 ? u - 1 : u, adu = abs(du), back = G(u - .5, .16);
      base(x, y, o, 1 - .1 * back * G(yy - 1.56, .06) + .03 * G(du, .1) * G(yy - 1.725, .03) + .03 * G(adu - .12, .04) * G(yy - 1.66, .012));
      if (yy < 1.575) { const q = sm(yy, 1.575, 1.53); o.h *= 1 - .85 * q; o.r = lerp(o.r, .87, .8 * q); o.g = lerp(o.g, .85, .8 * q); o.b = lerp(o.b, .84, .8 * q); }   /* PP: no streaks down the neck */
      if (adu < .34 && yy > 1.5 && yy < 1.76) {
        const warm = .075 * V.blush * G(adu - .125, .05) * G(yy - 1.646, .02) + .08 * G(du, .03) * G(yy - 1.646, .012) + .06 * G(adu - .25, .04) * G(yy - 1.675, .03) + .03 * G(du, .06) * G(yy - 1.59, .01); o.g *= 1 - warm * .8; o.b *= 1 - warm * 1.0;
        let ao = .2 * G(adu - .046, .018) * G(yy - 1.681, .009) + .13 * G(adu - .07, .036) * G(yy - 1.6865, .0035) + .09 * G(adu - .072, .03) * G(yy - 1.669, .0045) + .2 * G(du, .05) * G(yy - 1.6335, .003) + .1 * G(du, .04) * G(yy - 1.5995, .004) + .08 * G(adu - .04, .012) * G(yy - 1.641, .008)
          + .17 * sm(yy, 1.585, 1.568) * sm(yy, 1.49, 1.555) * sm(adu, .42, .1) + .06 * G(adu - .16, .05) * G(yy - 1.612, .016);
        if (old) ao += old * (.12 * G(adu - .068, .028) * G(yy - 1.6635, .0055) + .1 * G(adu - .1, .03) * G(yy - 1.598, .012) + .07 * sm(fs(f2, x * 5, y * 5), .7, .82) * G(adu - .16, .1));
        if (fem) ao += .1 * G(adu - .07, .034) * G(yy - 1.69, .0045);
        if (V.hard) ao += V.hard * (.13 * G(adu - .072, .036) * G(yy - 1.672, .006) + .12 * G(adu - .05, .04) * G(yy - 1.6935, .0045) + .09 * G(adu - .185, .05) * G(yy - 1.628, .022) + .07 * G(du, .02) * G(yy - 1.7, .012));
        o.r *= 1 - ao * .8; o.g *= 1 - ao; o.b *= 1 - ao;
        if (V.stubble) { const st = sm(adu, .24, .15) * sm(yy, 1.645, 1.618) * sm(yy, 1.552, 1.575) * (1 - .85 * G(du, .05) * G(yy - 1.612, .0075)) * (.45 + .55 * fs(f3, x * 4, y * 4)); B.tint(o, [.3, .29, .3], st * V.stubble); } }
      const ex = (adu - EYE.du) / EYE.hw; if (ex > -1 && ex < 1 && yy < eyeTop(ex) && yy > eyeBot(ex)) { o.a = 0; if (abs(ex) < .42) { o.r = .13; o.g = .08; o.b = .06; } else { o.r = .72; o.g = .68; o.b = .64; } } });
    A.shade(R.ARM, (u, v, x, y, o) => { base(x, y, o, 1.0 - .06 * G(u - .25, .2)); o.h += (fs(fa, x * 2, y * 2) - .5) * .5 * G(v - .46, .04); });
    A.shade(R.HAND, (u, v, x, y, o) => { base(x, y, o, .98); o.g *= 1 - .04 * G(v - .5, .06) * G(u - .25, .2); o.h += (fs(fa, x * 2, y * 2.6) - .5) * (1 + old) * (G(v - .47, .03) + G(v - .3, .03)); });
    A.shade(R.EYE, (u, v, x, y, o) => { const dx = (u - .5) / .215, dy = (v - .5) / .232, r = Math.sqrt(dx * dx + dy * dy), vein = fs(f2, x * 6, y * 6), edge = sm(Math.hypot((u - .5) * 2, (v - .5) * 2), .45, 1);
      o.r = .7 - .24 * edge + .04 * vein; o.g = .67 - .3 * edge; o.b = .64 - .32 * edge; o.h = 0; o.ro = .12; o.me = 0;   /* PP: duller whites: in the photo faces they glowed */
      if (r < 1.06) { const k = sm(r, 1.06, .92), fib = fs(f3, Math.atan2(dy, dx) * 40 + 300, r * 12), ic = [.19 + .15 * fib * sm(r, .25, .7), .1 + .08 * fib * sm(r, .25, .7), .05 + .03 * fib], rim = sm(r, .7, 1); o.r = lerp(o.r, ic[0] * (1 - .6 * rim), k); o.g = lerp(o.g, ic[1] * (1 - .6 * rim), k); o.b = lerp(o.b, ic[2] * (1 - .6 * rim), k); if (r < .4) { o.r = o.g = o.b = .012; } }
      const hx = (u - .5) / .215 + .38, hy = (v - .5) / .232 - .42, hl = G(Math.hypot(hx, hy), .16); o.r += hl * .8; o.g += hl * .8; o.b += hl * .8; const sh = 1 - .35 * sm(v, .55, .95); o.r *= sh; o.g *= sh; o.b *= sh; });
    A.shade(R.EAR, (u, v, x, y, o) => { base(x, y, o, 1.02); o.g *= .93; o.b *= .9; });
    A.shade(R.LID, (u, v, x, y, o) => { base(x, y, o, .9 - .12 * sm(v, .6, .2)); if (v < .16) { o.r = .1; o.g = .07; o.b = .06; } });
    A.shade(R.CON, (u, v, x, y, o) => { base(x, y, o, .74); o.g *= .86; o.b *= .82; });
    A.begin(); const P = A.pen(R.HEAD), rr = GT.rng('nbface_' + key), kb = V.browK;
    for (const s of [1, -1]) { const U = d => s > 0 ? d : 1 - d, EX = ex => U(EYE.du + EYE.hw * ex), up = [], lo = [], cr = [];
      for (let i = 0; i <= 12; i++) { const ex = -1 + i / 6; up.push([EX(ex), HV(eyeTop(ex) + .0003)]); lo.push([EX(ex), HV(eyeBot(ex) - .0002)]); cr.push([EX(ex * 1.02), HV(eyeTop(ex) + .0028 + .0014 * (1 - ex * ex))]); }
      P.path(cr).stroke({ c: 'rgba(90,50,40,.4)', w: 1.1, blur: .5, h: -.5, hw: 1.6, hb: .6 }); P.path(up).stroke({ c: '#1c1210', w: 1.25 * V.lash, h: .3, hw: 1.6, cap: 'round' }); P.path(up.slice(7)).stroke({ c: '#1c1210', w: 1.6 * V.lash, cap: 'round' }); P.path(lo).stroke({ c: 'rgba(84,46,40,.55)', w: .8 });
      if (fem) P.path([[EX(.92), HV(eyeTop(.92))], [EX(1.22), HV(eyeTop(1) + .003)]]).stroke({ c: '#1c1210', w: 1.3, cap: 'round' });
      for (let i = 0; i < 70; i++) { const t = rr(), d = .03 + .087 * t, arch = fem ? .0065 : .005, yb = 1.6975 + arch * sm(t, 0, .55) - arch * sm(t, .55, 1) + (rr() - .5) * .0046 * (1 - .55 * t) * kb + (V.frown || 0) * (.0056 * t - .0036); P.path([[U(d), HV(yb)], [U(d + .009), HV(yb + .0022 - .0045 * t)]]).stroke({ c: V.brow, w: 1.0 * kb, a: .78, cap: 'round' }); }
      { const fr = V.frown || 0; P.path([[U(.03), HV(1.698 - .0036 * fr)], [U(.07), HV(1.7025 - .001 * fr)], [U(.115), HV(1.6975 + .002 * fr)]]).stroke({ c: V.brow, w: 2.6 * kb, blur: .9, a: .5, cap: 'round' });
        if (fr) { P.path([[U(.011), HV(1.71)], [U(.0135), HV(1.6955)]]).stroke({ c: 'rgba(64,32,26,' + (.5 * fr).toFixed(2) + ')', w: 1.3, blur: .6, h: -.5, hw: 2, hb: .8, cap: 'round' }); P.path([[U(.04), HV(1.641)], [U(.064), HV(1.627)], [U(.076), HV(1.607)]]).stroke({ c: 'rgba(96,56,46,' + (.3 * fr).toFixed(2) + ')', w: 1.2, blur: .7, h: -.4, hw: 1.8, hb: .8, cap: 'round' }); }
        if (V.scar && s > 0) { P.path([[U(.07), HV(1.719)], [U(.084), HV(1.7)], [U(.09), HV(1.684)]]).stroke({ c: 'rgba(206,150,138,.8)', w: 1.7, blur: .4, h: .5, hw: 2.2, hb: .6, cap: 'round' }); for (const q of [[.076, 1.711], [.086, 1.694]]) P.path([[U(q[0] - .006), HV(q[1] - .002)], [U(q[0] + .006), HV(q[1] + .002)]]).stroke({ c: 'rgba(150,96,88,.6)', w: .9, cap: 'round' }); } }
      P.path([[U(0), HV(1.6196)], [U(.012), HV(1.6216)], [U(.034), HV(1.6176)], [U(.062), HV(1.6123)], [U(.034), HV(1.6119)], [U(0), HV(1.6119)]], true).fill({ c: V.lipU, blur: .6 });
      P.path([[U(0), HV(1.6119)], [U(.034), HV(1.6117)], [U(.06), HV(1.6123)], [U(.04), HV(1.6048)], [U(.016), HV(1.602)], [U(0), HV(1.6013)]], true).fill({ c: V.lipL, blur: .6 });
      P.path([[U(0), HV(1.612)], [U(.034), HV(1.6117)], [U(.065), HV(1.6128)]]).stroke({ c: 'rgba(60,26,22,.9)', w: 1.0, cap: 'round' });
      P.ellipse(U(.024), HV(1.6372), .0105, .011).fill({ c: 'rgba(40,18,14,.85)', blur: .8 });
      if (old) { const wc = { c: `rgba(110,70,58,${.2 * old})`, w: 1.1, blur: .7, h: -.3, hw: 1.6, hb: .8, cap: 'round' };
        P.path([[U(.042), HV(1.642)], [U(.066), HV(1.628)], [U(.08), HV(1.606)], [U(.082), HV(1.592)]]).stroke(wc);
        for (const q of [[1.722, .085], [1.736, .095]]) P.path([[U(.01), HV(q[0])], [U(q[1] * .5), HV(q[0] + .002)], [U(q[1]), HV(q[0] - .0015)]]).stroke(wc);
        for (const a of [-.35, 0, .35]) P.path([[U(.105), HV(1.679)], [U(.132), HV(1.679 + a * .02)]]).stroke(wc);
        P.path([[U(.038), HV(1.667)], [U(.066), HV(1.6615)], [U(.094), HV(1.666)]]).stroke(wc); }
      if (V.stache) for (let i = 0; i < 60; i++) { const t = rr(), d = .004 + .07 * t, y0 = 1.6295 - .006 * t + (rr() - .5) * .003; P.path([[U(d), HV(y0)], [U(d + .006), HV(y0 - .0075 - .002 * t)]]).stroke({ c: '#17110e', w: 1.3, a: .85, cap: 'round' }); } }
    const out = A.finish(1.1); NBT.tex += nbNow() - t0; return out; }
  function nbMats() { if (NBM.cloth) return NBM; const B = HB; NBM.cloth = B.mkMat(nbClothTex(), { vertexColors: true, side: T.DoubleSide }); NBM.cloth.name = 'npc_cloth'; NBM.hair = B.mkMat(nbHairTex(), { vertexColors: true, alphaTest: .5, side: T.DoubleSide }); NBM.hair.name = 'npc_hair';
    { const src = NBM.cloth.map.image, cv = document.createElement('canvas'); cv.width = cv.height = 1024; const g = cv.getContext('2d'); g.drawImage(src, 0, 0); g.globalCompositeOperation = 'multiply'; const pt = g.createPattern(mats() && TEX.floral.image, 'repeat'); if (pt.setTransform) pt.setTransform(new DOMMatrix().scale(.5)); g.fillStyle = pt; g.fillRect(0, 0, 512, 512); g.fillRect(0, 512, 256, 256);
      const tx = new T.CanvasTexture(cv); tx.anisotropy = 8; tx.encoding = T.sRGBEncoding; NBM.print = B.mkMat({ map: tx, normalMap: NBM.cloth.normalMap, orm: NBM.cloth.roughnessMap }, { vertexColors: true, side: T.DoubleSide }); NBM.print.name = 'npc_print'; }
    /* PP: photographic cloth. Generated macro photos multiplied into the neutral atlas (jersey on tops and sleeves, denim on jeans, slub weave on trousers and shorts, a smooth knit on
       the nylon pieces); the print tops get a real hibiscus print, the dresses with print = 'floral' a small daisy print. Cloth and hair get their own shading (js/humans.js). */
    const H = GT.humans; if (H) { const cm = NBM.cloth.map, R = NBR;
      H.fabric({ map: cm }, 'assets/tex/fabric_tee_grey.jpg', [R.TOR, R.SLV, R.KNIT, R.SHAFT], { tile: 170, k: .42 }); H.fabric({ map: cm }, 'assets/tex/fabric_denim_dark.jpg', [R.LEGD], { tile: 150, k: .6 });
      H.fabric({ map: cm }, 'assets/tex/people/fab_linen.jpg', [R.LEG, R.PEL], { tile: 170, k: .45 }); H.fabric({ map: cm }, 'assets/tex/people/fab_swim.jpg', [R.TORJ, R.SLVJ], { tile: 170, k: .4 });
      const src = cm.image, RP = [[0, .5, .5, 1], [0, .25, .25, .5]];
      H.printCanvas(src, 'assets/tex/people/fab_aloha.jpg', RP, 150, tx => { const o = NBM.print.map; NBM.print.map = tx; NBM.print.needsUpdate = true; if (o) o.dispose(); });
      NBM.print2 = B.mkMat({ map: NBM.print.map, normalMap: NBM.cloth.normalMap, orm: NBM.cloth.roughnessMap }, { vertexColors: true, side: T.DoubleSide }); NBM.print2.name = 'npc_print2';
      H.printCanvas(src, 'assets/tex/people/fab_floral.jpg', RP, 110, tx => { NBM.print2.map = tx; NBM.print2.needsUpdate = true; });
      H.patchCloth(NBM.cloth); H.patchCloth(NBM.print); H.patchCloth(NBM.print2); H.patchHair(NBM.hair); }
    { const nm = NBM.cloth.normalMap, cv = nm && nm.image, g = cv && cv.getContext && cv.getContext('2d'); if (g) { const S = cv.width; for (const k of ['TOR', 'TORJ', 'SLV', 'SLVJ', 'LEG', 'LEGD', 'PEL']) { const r = NBR[k], x0 = Math.round(r[0] * S), x1 = Math.round(r[2] * S), yT = Math.round((1 - r[3]) * S), h = Math.round((r[3] - r[1]) * S);
        for (let i = 0; i < 4; i++) { g.drawImage(cv, x0 + 4, yT, 1, h, x0 + i, yT, 1, h); g.drawImage(cv, x1 - 5, yT, 1, h, x1 - 1 - i, yT, 1, h); } } nm.needsUpdate = true; } }   /* PP: the normals of the outer columns of each wrapped rect were taken across into the next rect (a crease down the middle of every top): copied from inside */
    for (const k of ['TOR', 'TORJ', 'SLV', 'SLVJ', 'LEG', 'LEGD', 'PEL']) { const r = NBR[k]; NBR[k] = [r[0] + 2 / 1024, r[1], r[2] - 2 / 1024, r[3]]; }   /* PP: UVs stay 2 texels inside the painted rects: a loft closing exactly on a rect edge sampled the neighbour (a dark seam down the front) */
    if (!NBM.print2) NBM.print2 = NBM.print; NBM.far = new T.MeshStandardMaterial({ vertexColors: true, color: new T.Color(.78, .78, .78), roughness: .8, metalness: 0, skinning: true }); NBM.far.name = 'npc_far'; if (H) H.patchCloth(NBM.far); return NBM; }
  /* PP: a skin key is '<painted face>' or '<painted face>|<photo id>[m]' (m = mirrored): the photo face is baked over the painted one once it has loaded */
  const nbSkinMat = key => { if (NBM.skin[key]) return NBM.skin[key]; const pi = key.indexOf('|'), base = pi < 0 ? key : key.slice(0, pi), tex = nbSkinTex(base), H = GT.humans;
    if (H && pi >= 0) { const ph = key.slice(pi + 1); H.bakeFace(tex, { id: ph.replace(/m$/, ''), mir: /m$/.test(ph) && ph.length > 2 }, { mode: 'npc', rect: HB.R.HEAD }); }
    const m = Object.assign(HB.mkMat(tex, { vertexColors: true, alphaTest: .5 }), { name: 'npc_skin_' + key }); if (H) H.patchSkin(m); return NBM.skin[key] = m; };
  /* ---- who is it: age class (0 child, 1 young, 2 middle-aged, 3 elderly), face atlas, body + face shape, gait */
  const NB_AGE = { kid: 0, student: 1, granny: 3, yeshu: 3, pengci: 3, bird_uncle: 3, auntie: 2, auntie_dance: 2, auntie_lead: 2, vendor: 2, match_parent: 2, lajie: 2, guaizi: 2, mange: 2, ertong: 2, swim_uncle: 3, angler_cn: 2, sanitation: 2, bangbang: 2, chengguan: 2, oldman: 3, cook: 2, bartender: 2 };
  const nbGrey = c => { const r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255, mx = Math.max(r, g, b); return mx - Math.min(r, g, b) < 26 && mx > 84; };
  const nbAge = sp => { if (sp.height < 1.36) return 0; if (sp.face === 'old' || (sp.stoop || 0) >= .1 || (sp.hair && nbGrey(sp.hair.col))) return 3; const a = NB_AGE[sp.type]; return a !== undefined ? a : ((sp.belly || 0) > .035 ? 2 : 1); };
  const nbFaceKey = (sp, age) => age === 0 ? 'child' : sp.female ? (age >= 2 && !sp.named ? 'f_old' : 'f_young') : (sp.face === 'old' || age === 3) ? 'm_old' : (sp.type === 'thug' || sp.type === 'ertong') ? (sp.face === 'stache' ? 'm_thug2' : 'm_thug') : sp.face === 'stache' ? 'm_stache' : (sp.face === 'stubble' || sp.face === 'mask') ? 'm_stubble' : 'm_young';
  function nbShape(sp, fig, age) { const tb = fig.tb, fem = !!sp.female, r = GT.rng('nbshape' + sp.key), ab = (sp.armBulk || sp.bulk) * (fem ? .93 : 1) * (age === 0 ? .92 : 1), lb = (sp.legBulk || sp.bulk) * (age === 0 ? .94 : 1), heavy = clamp(((sp.belly || 0) - .02) * 14 + (sp.bulk - 1) * 2, 0, 1), nk = (fem ? .88 : 1) * (1 + (sp.bulk - 1) * .8) * (age === 0 ? .86 : 1);
    const F = { cheek: (r() - .5) * .005 + .004 * heavy + (age === 0 ? .004 : age === 3 ? -.0025 : 0), jaw: 1 + (r() - .5) * .08 + .05 * heavy - (fem ? .04 : 0) - (age === 0 ? .03 : 0), nose: (r() - .5) * .005 - (fem ? .0015 : 0) - (age === 0 ? .004 : 0) + (age === 3 ? .0015 : 0), chin: (r() - .5) * .005 - (age === 0 ? .003 : 0) - (fem ? .001 : 0), jowl: .004 * heavy + (age === 3 ? .003 : 0), brow: (r() - .5) * .003 - (fem || age === 0 ? .003 : 0) }, hm = [1, 1, 1, 1];
    const anat = { fem, fat: heavy, musc: clamp(((sp.bulk || 1) - .9) * 3.2 + (age === 3 ? -.35 : 0) + (fem ? -.1 : .15), .15, 1.35) * (age === 0 ? .3 : 1), bust: fem && age ? clamp(.009 + (sp.chest || 0) * .9, .007, .024) : 0, glute: (fem ? 1.3 : .85) * (age === 0 ? .4 : 1) };   /* PP: anatomy for the body lofts (js/humans.js) */
    return { age, nk, heavy, anat, hx: 1 + (r() - .5) * .07 + .03 * heavy, hy: 1 + (r() - .5) * .05,
      body(q, y) { const yo = y <= .925 ? y : .925 + (y - .925) / NKY, t = interp(tb, clamp(yo, .84, 1.49)); q[0] = t[1]; q[1] = t[2]; q[2] = t[3]; q[3] = -NSH * clamp(y - 1.0, 0, .46); return q; },
      arm(q) { q[0] *= ab; q[1] *= ab; return q; }, leg(q) { q[1] *= lb; q[2] *= lb; q[3] *= lb; return q; },
      head(y) { const j = 1 - sm(y, 1.6, 1.665), n = lerp(1, nk, 1 - sm(y, 1.535, 1.575)); hm[0] = (1 + (F.jaw - 1) * j) * n; hm[1] = n; hm[2] = n; hm[3] = 1; return hm; },
      face(du, y) { const ad = abs(du); return F.cheek * G(ad - .13, .07) * G(y - 1.625, .03) + F.nose * G(du, .024) * G(y - 1.648, .012) + F.chin * G(du, .06) * G(y - 1.582, .012) + F.jowl * G(ad - .1, .05) * G(y - 1.592, .016) + F.brow * G(ad - .055, .055) * G(y - 1.7005, .007); } }; }
  const nbGait = (sp, age) => { const heavy = clamp(((sp.belly || 0) - .03) * 16 + (sp.bulk - 1.05) * 2, 0, 1), st = sp.stoop || 0;
    return age === 3 ? { stride: .8 - st * .5, wide: .022, sway: 1.25, twist: .7, lift: .62, sink: .012 + st * .05, arm: .65 } : age === 0 ? { stride: .92, wide: 0, sway: 1.1, twist: 1.2, lift: 1.15, sink: 0, arm: 1.2 } : { stride: 1 - .1 * heavy - (sp.female ? .03 : 0), wide: .018 * heavy - (sp.female ? .01 : 0), sway: 1 + .5 * heavy + (sp.female ? .25 : 0), twist: 1, lift: 1 - .15 * heavy, sink: .004 * heavy, arm: 1 }; };
  /* ---- hair */
  const NB_HL = { m: [[0, 1.622], [.1, 1.626], [.19, 1.655], [.235, 1.694], [.275, 1.674], [.33, 1.716], [.41, 1.75], [.5, 1.754]], f: [[0, 1.6], [.1, 1.606], [.19, 1.65], [.235, 1.694], [.275, 1.664], [.33, 1.722], [.41, 1.753], [.5, 1.758]], rec: [[0, 1.626], [.1, 1.63], [.19, 1.657], [.235, 1.694], [.275, 1.682], [.33, 1.735], [.41, 1.776], [.5, 1.768]],
    fade: [[0, 1.668], [.1, 1.672], [.19, 1.695], [.235, 1.712], [.275, 1.71], [.33, 1.732], [.41, 1.752], [.5, 1.754]], bald: [[0, 1.63], [.1, 1.634], [.19, 1.66], [.235, 1.694], [.275, 1.69], [.33, 1.75], [.41, 1.81], [.5, 1.81]] }, NB_HLK = {};
  const NB_HAIR = { short: { hl: 'm', top: .015, side: .004, cl: 56, len: .034 }, buzz: { hl: 'm', top: .0035, side: .002, cl: 0, sh: 1, dens: .8 }, fade: { hl: 'fade', top: .019, side: .003, cl: 60, len: .036 }, quiff: { hl: 'fade', top: .022, side: .004, cl: 70, len: .046, lift: .02 }, slick: { hl: 'rec', top: .008, side: .004, cl: 0, sh: 2 }, mop: { hl: 'm', top: .028, side: .012, cl: 90, len: .06, fringe: .03 },
    sides: { hl: 'bald', top: .006, side: .006, cl: 0, sh: 2, capY: 1.752 }, topknot: { hl: 'fade', top: .008, side: .002, cl: 0, sh: 1, knot: 1 }, tied: { hl: 'f', top: .008, side: .005, cl: 0, sh: 2, bun: [0, 1.672, -.112, .034] }, bun: { hl: 'f', top: .009, side: .005, cl: 0, sh: 2, bun: [0, 1.715, -.108, .044] }, pony: { hl: 'f', top: .009, side: .005, cl: 0, sh: 2, pony: 1 },
    bob: { hl: 'f', top: .02, side: .015, cl: 24, len: .05, hang: .07, fringe: .022 }, long: { hl: 'f', top: .018, side: .012, cl: 16, len: .05, hang: .2 }, wavy: { hl: 'f', top: .022, side: .016, cl: 20, len: .05, hang: .2, wave: .012 }, braids: { hl: 'f', top: .014, side: .01, cl: 0, hang: .22, wave: .006 }, curly: { hl: 'f', top: .03, side: .03, cl: 90, len: .032, curl: .016, low: .022 }, afro: { hl: 'm', top: .05, side: .04, cl: 80, len: .03, curl: .014 } };
  function nbHairDef(sp, age) { if (!sp.hair || sp.hair.style === 'none' || sp.mask) return { st: null, HL: () => 9, dens: 0 };
    let st = NB_HAIR[sp.hair.style] || NB_HAIR.short; const hk = (st.hl === 'm' && age === 3 && !sp.female) ? 'rec' : (st.hl === 'm' && sp.female) ? 'f' : st.hl, tb = NB_HLK[hk] || (NB_HLK[hk] = HB.keyed(NB_HL[hk])), fr = st.fringe || 0;
    const hat = !!sp.hat && sp.hat !== 'visor' && sp.hat !== 'headband';
    return { st, hat, grey: nbGrey(sp.hair.col) || age === 3, dens: st.dens || .9, capY: st.capY, HL: u => { const w = u - Math.floor(u), du = w > .5 ? w - 1 : w; return tb(abs(w - .5))[0] - fr * G(du, .13) - (st.low ? st.low * (1 - G(du, .2)) : 0); } }; }
  function nbHair(M, sp, hd, lod) { const st = hd.st; if (!st) return; const B = HB, near = lod === 0, hc = nbHC(sp.hair.col), rr = GT.rng('nbhair' + sp.key), bh = B.BI.head, bs = B.BI.hair, info = { v: 0 }, hat = hd.hat, HT = B.HTOP - .0012, yTop = hat ? 1.746 : st.capY || HT, top = hat ? Math.min(st.top, .005) : st.top, side = hat ? Math.min(st.side, .007) : st.side;
    const far = lod === 2, NS = near ? Math.min(st.sh || 2, 2) : 1, KR = near ? 7 : far ? 4 : 7, N = near ? 16 : far ? 8 : 14, grey = hd.grey && !nbGrey(sp.hair.col), tone = () => { const k = .8 + .4 * rr(); return grey && rr() < .3 ? [.62 * k, .62 * k, .62 * k] : mul(hc, k); }, wH = (x, y) => { const q = sm(y, 1.75, 1.83) * .3; return [bh, 1 - q, bs, q]; }, open = hat || !!st.capY;
    for (let k = 0; k < NS; k++) { const grow = k * (.004 + top * .22); M.cf = (x, y, z, u) => { const h = B.hsh((u * 31) | 0, k, 7); return grey && h > .72 ? [.6, .6, .6] : mul(hc, .82 + .36 * h); };
      B.tube(M, { n: N, rings: KR, uv: [0, k / 5 + .003, 1, (k + 1) / 5 - .006], cap1: !open, w: wH, pt: (i, u, out) => { const s = i / (KR - 1), w = u - Math.floor(u), du = w > .5 ? w - 1 : w, fr = G(du, .12), hl = Math.min(hd.HL(u) - k * .003, yTop), y = hl + (yTop - hl) * Math.pow(s, .85);
          let o = (side + (top - side) * sm(y, 1.7, 1.775) + (st.lift || 0) * fr * sm(y, 1.72, 1.775) * (1 - sm(y, 1.785, 1.8)) + (st.fringe ? .01 * fr * (1 - s) : 0)) * sm(s, -.01, .14 + .3 * (1 - fr)) + grow * sm(s, 0, .3) * (.3 + .7 * sm(y, 1.68, 1.76)) + B.foldN(u, y, 46, 31 + k) * top * .35 * sm(y, 1.69, 1.76)
            + (st.curl ? st.curl * (.5 + .5 * sin(u * TAU * 8 + y * 55 + k * 2)) * (.5 + .5 * sin(y * 110 + u * 19 + k)) * sm(s, .0, .2) : 0) + (k ? .0008 : 0); if (open) o *= 1 - .85 * sm(s, .75, 1);
          B.headPt(u, Math.min(y, HT), Math.max(o, .0006), out); info.v = s; return info; } }); }
    if (st.hang) { const yA = 1.735, yE = 1.6 - st.hang, KH = near ? 7 : far ? 3 : 5, wHg = (x, y) => { const wh = sm(y, 1.5, 1.6); return [bh, wh, B.BI.neck, (1 - wh) * .5, B.BI.chest, (1 - wh) * .5]; };
      for (let k = 0; k < (near ? 2 : 1); k++) { M.cf = (x, y, z, u) => { const h = B.hsh((u * 41) | 0, k + 3, 7); return grey && h > .72 ? [.6, .6, .6] : mul(hc, .8 + .36 * h); };
        B.tube(M, { n: near ? 16 : far ? 6 : 12, rings: KH, arc: [.14, .86], uv: [0, (k ? 4 : 1) / 5, 1, (k ? 5 : 2) / 5], w: wHg, pt: (i, u, out) => { const s = i / (KH - 1), y = yA - (yA - yE) * s, bk = G(u - .5, .16), o = side + .005 + k * .006 + (st.wave || 0) * sin(y * 60 + u * 40) * sm(s, .2, .6) + (st.curl || 0) * sin(u * TAU * 11 + y * 70);
            if (y >= 1.61) B.headPt(u, y, o, out); else { B.headPt(u, 1.61, o, out); const d = 1.61 - y; out[1] = y; out[2] -= d * (.28 * bk + .12); out[0] *= 1 + d * .5 * (1 - bk); } info.v = s; return info; } }); } }
    M.cf = null;
    if (!hat && (st.bun || st.knot)) { const b = st.knot ? [0, 1.815, -.02, .03] : st.bun; M.col = mul(hc, .95); B.ellip(M, [b[0], b[1], b[2]], [b[3], b[3] * .85, b[3]], { uv: [0, .09, 1, .19], w: () => [bh, 1], n: near ? 12 : far ? 5 : 8, rings: near ? 7 : far ? 3 : 5 }); }
    if (st.pony) { M.col = mul(hc, .95); B.strip(M, [[0, 1.722, -.088], [0, 1.735, -.135], [0, 1.69, -.172], [0, 1.6, -.18], [0, 1.52, -.165]], { width: .05, widthAt: t => .054 * (1 - .65 * t * t), thick: .034, e: 1, n: near ? 8 : far ? 4 : 6, steps: near ? 12 : far ? 3 : 6, uv: [0, .09, 1, .19], U: [1, 0, 0], w: (x, y) => { const q = sm(1.7 - y, 0, .16) * .8; return [bh, 1 - q, bs, q]; } }); }
    if (near && !hat && st.cl) { const p0 = [0, 0, 0], wC = (x, y) => { const q = sm(y, 1.74, 1.84) * .4; return [bh, 1 - q, bs, q]; };
      for (let i = 0, ncl = Math.round(st.cl * .32); i < ncl; i++) { const u = rr(), du = u > .5 ? u - 1 : u, fr = G(du, .14), hl = hd.HL(u), tp = rr() < .7, y0 = tp ? lerp(1.74 + .022 * fr, 1.797, Math.pow(rr(), .8)) : lerp(Math.max(hl + .016, 1.68), 1.745, rr()); if (y0 < hl + .012) { rr(); rr(); rr(); rr(); rr(); continue; } B.headPt(u, y0, .003, p0);
        let nx = p0[0], ny = (y0 - 1.685) * 1.15, nz = p0[2] - .004; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        let fx = (tp ? .45 : nx * .6) + (rr() - .5) * (st.curl ? 2 : .7), fy = tp ? (st.lift ? .3 : -.1) : -1, fz = tp ? (st.curl ? rr() - .5 : 1) : .35 + .5 * fr; const dd = fx * nx + fy * ny + fz * nz; fx -= dd * nx; fy -= dd * ny; fz -= dd * nz; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
        const len = (tp ? st.len * (1 + (st.fringe ? .5 * fr : 0)) : st.len * .6) * (.7 + rr() * .6), lift = (.005 + top * .3) * (.4 + rr()) * (tp ? 1 + (st.lift ? 2.5 : 1.2) * fr * sm(y0, 1.75, 1.73) : .4), wd = .023 * (.75 + rr() * .6), ux = fy * nz - fz * ny, uy = fz * nx - fx * nz, uz = fx * ny - fy * nx, v0 = rr() * .7;
        const pts = [0, .34, .68, 1].map(t => { const l = lift * sin(t * PI * .78) + .0025 * t; return [p0[0] + fx * len * t + nx * l, p0[1] + fy * len * t + ny * l - .004 * t * t, p0[2] + fz * len * t + nz * l]; });
        M.col = tone(); B.strip(M, pts, { width: wd, widthAt: t => wd * (1 - .55 * t * t), thick: .002, U: [ux, uy, uz], steps: 3, n: 3, uv: [v0, .8, v0 + .3, 1], w: wC }); } } }
  /* ---- low-detail hand and shoe for the mid LOD */
  function nbMitt(M, s, uv, grow, far) { const B = HB, L = s > 0 ? 'L' : 'R', bh = B.BI['hand' + L], bf = B.BI['fore' + L], f1 = B.BI['f1' + L], f2 = B.BI['f2' + L], W = B.K.WRIST, r = { c: [0, 0, 0], a: 0, f: 0, b: 0, e: .8, v: 0, t: 0 }, TB = [[.017, .023], [.019, .031], [.0155, .04], [.012, .037], [.007, .026]];
    B.tube(M, { n: far ? 5 : 8, rings: far ? 3 : 5, uv, mirrorU: s < 0, xf: B.armXf(s), cap1: true, w: (x, y, z, rr) => rr.t < .1 ? [bf, .6, bh, .4] : rr.t > .8 ? [f1, .4, f2, .6] : rr.t > .55 ? [bh, .4, f1, .6] : [bh, 1], ring: (i, t) => { const q = TB[far ? i * 2 : i]; r.t = t; r.c = [-.002 - .01 * t * t, -W + .016 - t * .185, .004]; r.a = q[0] + grow; r.f = q[1] + grow; r.b = q[1] + grow; r.v = 1 - t * .5; return r; } }); }
  function nbShoeLo(M, s, sc, uv, uvShaft, boot, far) { const B = HB, L = s > 0 ? 'L' : 'R', bf = B.BI['foot' + L], bt = B.BI['toe' + L], bs = B.BI['shin' + L], r = { c: [0, 0, 0], a: 0, f: 0, b: 0, e: 1, e2: .5, U: [1, 0, 0], V: [0, 1, 0], v: 0, z: 0 }, TB = [[-.09, .012, .05, .02], [-.075, .034, .1, 0], [-.02, .041, .116, 0], [.06, .047, .084, 0], [.12, .05, .06, 0], [.17, .04, .044, .006], [.19, .02, .032, .013]], HX = B.K.HIPX;
    const TI = far ? [0, 2, 4, 6] : [0, 1, 2, 3, 4, 5, 6]; B.tube(M, { n: far ? 5 : 8, rings: TI.length, uv, mirrorU: s < 0, xf: B.mirXf(s), cap0: true, cap1: true, w: (x, y, z, rr) => { const k = sm(rr.z, .09, .135); return [bf, 1 - k, bt, k]; }, ring: i => { const q = TB[TI[i]], tp = q[2] * sc, yc = q[3] + (tp - q[3]) * .42; r.z = q[0]; r.c = [HX, yc, q[0] - .012]; r.a = q[1] * sc * 1.08; r.f = tp - yc; r.b = yc - q[3]; r.v = (q[0] + .09) / .28; return r; } });
    const r2 = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0, y: 0 }, tp = boot ? .36 : .18; B.tube(M, { n: far ? 5 : 8, rings: far ? 2 : 3, uv: uvShaft, mirrorU: s < 0, xf: B.mirXf(s), w: (x, y, z, q) => { const k = sm(q.y, .085, .13); return [bf, 1 - k, bs, k]; }, ring: (i, t) => { const y = lerp(.08, tp, t); r2.y = y; r2.c = [HX, y, -.016]; r2.a = boot ? .052 : .04; r2.f = r2.a + .004; r2.b = r2.a + .006; r2.v = t; return r2; } }); }
  /** bare foot (sandals, swimmers): heel, arch, ball and five toes; lift = sole thickness under it */
  function nbFoot(M, s, lift, uv) { const B = HB, L = s > 0 ? 'L' : 'R', bf = B.BI['foot' + L], bt = B.BI['toe' + L], bs = B.BI['shin' + L], HX = B.K.HIPX, r = { c: [0, 0, 0], a: 0, f: 0, b: 0, e: 1, e2: .5, U: [1, 0, 0], V: [0, 1, 0], v: 0, z: 0 };
    const TB = [[-.088, .012, .04, .012], [-.078, .027, .066, 0], [-.05, .031, .1, 0], [-.02, .033, .09, 0], [.02, .035, .064, 0], [.06, .04, .045, 0], [.095, .044, .033, 0], [.125, .046, .026, 0], [.15, .044, .021, .001], [.166, .036, .017, .003], [.174, .018, .013, .005]];
    B.tube(M, { n: 10, rings: TB.length, uv, mirrorU: s < 0, xf: B.mirXf(s), cap0: true, cap1: true, w: (x, y, z, rr) => { const k = sm(rr.z, .1, .14), a = sm(y, .07, .12) * (1 - sm(rr.z, -.03, .02)); return [bf, (1 - k) * (1 - a), bt, k, bs, a]; }, ring: i => { const q = TB[i], yc = q[3] + (q[2] - q[3]) * .4 + lift; r.z = q[0]; r.c = [HX + .004 * sm(q[0], .0, .12), yc, q[0] - .012]; r.a = q[1]; r.f = q[2] + lift - yc; r.b = yc - q[3] - lift; r.v = (q[0] + .09) / .28; return r; } });
    const TX = [-.031, -.012, .003, .017, .03], TZ = [.176, .175, .168, .159, .148], TR = [.0125, .0102, .0096, .009, .0084], wt = () => [bt, 1], xm = B.mirXf(s);
    for (let k = 0; k < 5; k++) B.ellip(M, [HX + .004 + TX[k], TR[k] * .82 + lift, TZ[k] - .012], [TR[k], TR[k] * .82, TR[k] * 1.5], { uv, w: wt, xf: xm, n: 5, rings: 3 }); }
  const nbYs = (gap, dense) => { const a = HB.HEAD_YS, o = [a[0]]; for (let i = 1; i < a.length - 1; i++) if (a[i] - o[o.length - 1] >= gap || (dense && a[i] > 1.596 && a[i] < 1.652)) o.push(a[i]); o.push(a[a.length - 1]); return o; };
  /* ---- the body: skin / hair / cloth lofts for one spec at one level of detail (0 near, 1 mid) */
  function nbBody(sp, fig, lod) { const B = HB, R = B.R, BI = B.BI, near = lod === 0, far = lod === 2, M0 = far ? new CM() : null, M = far ? { skin: M0, hair: M0, cloth: M0 } : { skin: new CM(), hair: new CM(), cloth: new CM() }, S = M.skin, C = M.cloth, fem = !!sp.female, top = sp.top, bot = sp.bottom, age = nbAge(sp), sd = hashS(sp.key) % 89;
    const CK = 1.14, skinC = mul(lin(sp.skin), 1.26), cl = hex => mul(lin(hex), CK), shape = nbShape(sp, fig, age), hd = nbHairDef(sp, age), maskC = [.012, .012, .014], NT = near ? 30 : far ? 8 : 16, NL = near ? 12 : far ? 6 : 8, NA = near ? 10 : far ? 5 : 8;   /* PP: near ≤ ~8k triangles a figure, far (lod 2, one mesh, one material) ≤ 1k */
    const thin = a => near ? a : a.filter((y, i) => i === 0 || i === a.length - 1 || i % (far ? 4 : 2) === 0);
    B.setShape(shape);
    try {
      /* head, eyes, ears */
      { const hairC = hd.st ? mul(nbHC(sp.hair.col), .85) : null, scalpC = hairC ? mix3(skinC, hairC, hd.dens) : skinC;
        S.cf = (x, y, z, u, v) => { if (v < .1) return u < .125 ? WHT3 : (sp.mask ? maskC : skinC); if (sp.mask) return maskC; if (!hairC) return skinC; const yy = B.HVI((v - .5) * 2), hl = hd.HL(u); let k = sm(yy, hl - .012, hl + .014); if (hd.capY) k *= 1 - sm(yy, hd.capY - .02, hd.capY + .008); return k > 0 ? mix3(skinC, scalpC, k) : skinC; };
        B.addHead(S, null, { n: near ? 24 : far ? 8 : 20, ys: near ? nbYs(.0105, false) : far ? nbYs(.06, false) : nbYs(.017, false), ears: sp.noEars || far ? 0 : 1, eyes: !far }); S.cf = null; S.col = skinC; }
      const DB = window.PPDBG && near ? (window.PPDBG[sp.key] = []) : null, ck = l => { if (DB) DB.push(l + ':' + (S.tris + C.tris + M.hair.tris + (M.print ? M.print.tris : 0))); }; ck('head');
      nbHair(M.hair, sp, hd, lod); ck('hair');
      if (sp.beard && !sp.mask && !far) { const H = M.hair, th = sp.beard.th || .007, info = { v: 0 }, KB = 6, wb = [BI.head, 1], ln = sp.beard.len || 0; H.cf = null; H.col = nbHC(sp.beard.col !== undefined ? sp.beard.col : (sp.hair ? sp.hair.col : 0x2a1d15));
        B.tube(H, { n: near ? 22 : 10, rings: KB, arc: [.765, 1.235], uvArc: true, uv: [0, .2, 1, .4], w: () => wb, pt: (i, u, out) => { const s = i / (KB - 1), ad = abs(u - 1), y = lerp(1.556 - ln * G(ad, .08), lerp(1.6, 1.656, sm(ad, .07, .22)), s); B.headPt(u, y, th * sin(PI * clamp(s * .9 + .1, 0, 1)) * (1 - .5 * sm(ad, .15, .235)) + .0012 + ln * .3 * G(ad, .08) * (1 - s), out); info.v = 1 - s * .9; return info; } });
        if (sp.beard.full) B.tube(H, { n: near ? 10 : 6, rings: 3, arc: [.925, 1.075], uvArc: true, uv: [0, .2, 1, .4], w: () => wb, pt: (i, u, out) => { const s = i / 2, ad = abs(u - 1); B.headPt(u, lerp(1.6185 - .005 * sm(ad, .03, .075), 1.6185 + .0105 * (1 - .7 * sm(ad, .02, .075)), s), th * .4 * sin(PI * (s * .8 + .1)) + .001, out); info.v = .12 + s * .5; return info; } }); }
      ck('beard');
      /* arms, hands, sleeves */
      const sl = top.sl === 'long' ? 2 : top.sl === 'short' ? 1 : 0, bare = top.type === 'bare', off = top.off || 0, so = top.slOff || .012, slEnd = sl === 2 ? Math.min(top.slEnd || .53, .53) : sl === 1 ? (top.slEnd || .165) : 0, gl = sp.gloves !== undefined && sp.gloves !== null, amp = clamp(off, .004, .022);
      const topC = bare ? skinC : cl(top.col), trimC = top.trim !== undefined ? cl(top.trim) : null, slC = top.slCol !== undefined ? cl(top.slCol) : topC, jk = (top.type === 'jacket' && top.placket === false) || (top.rough !== undefined && top.rough < .7 && sl === 2 && top.type !== 'jacket' && !top.collar), RT = jk ? NBR.TORJ : NBR.TOR, RS = jk ? NBR.SLVJ : NBR.SLV, KT = sp.kit || {}, over_ = !!(KT.apron || KT.hivis || KT.lapel || KT.backpack || KT.sling), TC = top.print && !far ? (top.print === 'floral' ? (M.print2 = new CM()) : (M.print = new CM())) : C;
      for (const s of [1, -1]) {
        if (!(sl === 2 && gl)) { S.col = skinC; B.armTube(S, s, { s0: sl === 2 ? .44 : sl === 1 ? slEnd - .05 : undefined, s1: .548, K: near ? (sl === 2 ? 4 : sl === 1 ? 11 : 16) : far ? (sl === 2 ? 2 : 3) : (sl === 2 ? 3 : 7), n: NA, uv: R.ARM }); }
        if (gl) { C.cf = null; C.col = cl(sp.gloves); if (near) B.addHand(C, s, NBR.KNIT, .0022); else nbMitt(C, s, NBR.KNIT, .002, far); B.armTube(C, s, { s0: .5, s1: .556, K: 3, ease: .004, uv: NBR.KNIT, n: NA }); }
        else if (near) B.addHand(S, s, R.HAND); else nbMitt(S, s, R.HAND, 0, far);
        if (sl) { TC.cf = trimC ? ((x, y, z, u, v) => (v - RS[1]) / (RS[3] - RS[1]) < .07 ? trimC : slC) : null; TC.col = slC;
          B.armTube(TC, s, { s1: slEnd, K: near ? (sl === 2 ? 16 : 8) : far ? 2 : (sl === 2 ? 8 : 4), n: NA, ease: sl === 2 ? (q => so + .004 + .004 * G(q - .25, .1) - (top.rib ? .01 : .004) * sm(q, .45, .525)) : ((q, u) => (so * (.35 + .4 * sm(q, -.02, .08)) + .002 + .006 * sm(q, .05, slEnd)) * (.55 + .9 * G(B.dUu(u, .75), .25))), disp: near && sl === 2 ? B.elbowFold(.005 + amp * .35) : null, lip: true, uv: RS }); TC.cf = null; } }
      if (near && sp.watch) { C.col = cl(sp.watch === true ? 0x18181a : sp.watch); B.armTube(C, 1, { s0: .5, s1: .524, K: 3, ease: .0045, uv: NBR.FLAT, n: 12 }); }
      ck('arms');
      /* torso: bare skin where it shows, then the garment */
      const hemY = nmy(top.skirt ? (top.hem || .885) : Math.max(top.hem || .885, .875)),   /* PP: no tee hangs below the crotch (a low hem had to flare out round the thighs like a skirt) */
        hemY0 = 0, neckOld = (top.neck || 1.487) + fig.ny, low = neckOld < 1.44, neckY = low ? nmy(neckOld) : 1.506, midriff = bare || (top.hem || 0) > 1.07, bo = bot.off || .008, be = bot.type === 'brief' ? .006 : over_ && !bare ? Math.min(bo + .007, off + .002) : bo + .007;
      if (midriff || low) { const hv_ = shape.heavy, dk = mul(skinC, .62), nip = [skinC[0] * .7, skinC[1] * .45, skinC[2] * .4]; S.col = skinC;
        S.cf = (x, y, z) => { if (z < 0) return mul(skinC, 1 - .1 * G(x, .02) * sm(y, 1.05, 1.2)); const ax = abs(x); let k = 1 - .16 * G(ax - .09, .06) * G(y - 1.288 + .03 * hv_, .014) - .08 * G(x, .014) * sm(y, 1.2, 1.3) * (1 - sm(y, 1.38, 1.44)) - .1 * sm(ax, .12, .17) * G(y - 1.12, .12) - .1 * hv_ * G(y - 1.0, .03) + .05 * G(y - 1.1, .06) * G(x, .08);
          if (!fem && Math.hypot(ax - .094, y - 1.318) < .017) return nip; if (Math.hypot(x, y - 1.078) < .016) return dk; return mul(skinC, k); };
        B.torsoTube(S, { ys: thin(B.ysT(bare ? 1.0 : midriff ? .98 : neckY - .05, 1.506)), ease: 0, uv: NBR.SKIN, vOf: B.TV, n: near ? 32 : NT, disp: (u, y) => { const du = u > .5 ? u - 1 : u; return .005 * G(abs(du) - .075, .05) * G(y - 1.335, .045) * (fem ? 0 : 1) + .004 * hv_ * G(y - 1.09, .05) * G(du, .1) - .004 * G(du, .014) * G(y - 1.078, .012); } }); S.cf = null; }
      if (!bare) { const skirt = !!top.skirt, e0 = off + (over_ ? .004 : .006), fa = over_ ? amp * .3 : amp, over = Math.max(0, be + .008 - e0), ys0 = B.ysT(skirt ? .875 : hemY, neckY), ys = skirt ? B.lin_(hemY, .845, near ? 7 : far ? 2 : 3).concat(ys0) : ys0, fl = top.flare || 1;
        const hangL = skirt || low || midriff ? 0 : top.type === 'tee' ? clamp(off / .012, .25, 1.3) * .9 : top.type === 'shirt' || top.type === 'polo' ? 1 : top.type === 'long' || top.type === 'hoodie' || top.type === 'jersey' ? .85 : top.type === 'jacket' ? .75 : top.type === 'tank' ? .3 : .5;   /* PP: tops hang from the chest */
        const ease = (y, u) => e0 + B.drape(y, u, hangL) + (skirt ? 0 : Math.min(.03, B.hipNeed(y, be + .005) * .9)) + fa * .5 * G(y - (hemY + .1), .09) * (top.blouse || top.rib ? 1.6 : 1) + over * (1 - sm(y, .93, 1.0)) + (skirt ? (.03 + .09 * fl) * Math.pow(clamp((.95 - y) / (.95 - hemY), 0, 1), .85) : 0) + (top.pocket ? .008 * G(y - 1.0, .06) * G(Math.min(u, 1 - u), .12) : 0);
        const fold = (u, y) => B.foldN(u, y, 22, sd + 3) * fa * .55 * G(y - 1.03, .13) + B.foldN(u, y, 2.6, sd + 7) * fa * .5 * hangL * sm(1.25 - y, 0, .25) + (skirt ? 0 : .0025 * sin(u * TAU * 5 + sd) * (1 - sm(y, hemY, hemY + .05))) + B.foldN(u, y, 10, sd + 4) * fa * .22 * (1 - sm(y, 1.18, 1.3)) + (skirt ? .012 * fl * sin(u * TAU * 9 + sd) * (1 - sm(y, hemY, .93)) : 0);
        const wSk = (x, y, z) => { if (y > .93) return B.wTorso(x, y, z); const sL = sm(x, -.09, .09), lw = sm(.93 - y, 0, .3) * .75; return [BI.hips, 1 - lw, BI.thighL, lw * sL, BI.thighR, lw * (1 - sL)]; };
        TC.cf = trimC ? ((x, y) => (y > neckY - .016 || (!skirt && !jk && y < hemY + .012)) ? trimC : topC) : null; TC.col = topC;
        B.torsoTube(TC, { ys: thin(ys), ease, e: 1, uv: RT, vOf: y => Math.max(0, B.TV(y)), lip: !skirt, lipTop: !top.collar && !low, n: NT, disp: (u, y) => { const f = fold(u, y); return y < 1.0 && !skirt ? Math.max(f, -.0015) : f; }, w: skirt ? wSk : undefined }); TC.cf = null;
        if (low) { TC.col = trimC || topC; const sx = top.strapX || (fem ? .078 : .092), e1 = e0 + .002; let yt = 1.44; while (yt < 1.53 && B.surfZ(sx, yt, e1, true) - B.surfZ(sx, yt, e1, false) > .05) yt += .004;
          for (const s of [1, -1]) { const X = sx * s, pts = [], ym = (neckY + yt) / 2; for (const y of [neckY - .015, ym, yt - .012]) pts.push([X, y, B.surfZ(sx, y, e1, true)]); pts.push([X * .98, yt + .012, (B.surfZ(sx, yt, e1, true) + B.surfZ(sx, yt, e1, false)) / 2]); for (const y of [yt - .012, ym, neckY - .015]) pts.push([X, y, B.surfZ(sx, y, e1, false)]);
            B.strip(TC, pts, { width: Math.max(.012, (top.strap || .02) * 1.5), thick: .004, uv: NBR.KNIT, w: B.wTorso, steps: near ? 14 : far ? 3 : 8, n: near ? 5 : far ? 3 : 4 }); } }
        if (top.collar) { TC.col = trimC && top.type === 'polo' ? trimC : mul(topC, .97); const cr = { c: [0, 0, 0], a: 0, f: 0, b: 0, v: 0 }, stand = jk && top.placket === false, YS = stand ? [1.49, 1.51, 1.532, 1.544, 1.536] : [1.496, 1.514, 1.53, 1.533, 1.516, 1.494], GR = stand ? [.03, .024, .02, .017, .012] : [.024, .016, .013, .019, .033, .045], nk = shape.nk;
          if (!far) B.tube(TC, { n: near ? 20 : 12, rings: YS.length, arc: stand ? [.035, .965] : [.07, .93], uvArc: true, uv: stand ? NBR.KNIT : NBR.PLAIN, w: B.wTorso, ring: (i, t) => { cr.c = [0, YS[i], -.021]; cr.a = .058 * nk + GR[i]; cr.f = .055 * nk + GR[i]; cr.b = .063 * nk + GR[i]; cr.v = t; return cr; } }); }
        if (near && top.placket && !low && !(sp.kit && sp.kit.lapel)) { const y0 = top.placket === true ? hemY + .02 : neckY - top.placket * NKY, pts = [], zf = y => B.surfZ(0, y, ease(y, 0) + Math.max(0, fold(0, y)) + .0045, true); for (let i = 0; i <= 5; i++) { const y = lerp(y0, neckY - .03, i / 5); pts.push([0, y, zf(y)]); }
          TC.col = mul(topC, .9); B.strip(TC, pts, { width: .026, thick: .003, uv: NBR.PLAIN, w: B.wTorso, steps: 12, n: 4 }); TC.col = cl(top.btn !== undefined ? top.btn : 0xd8d4c8); for (let i = 0; i < 5; i++) { const y = lerp(y0, neckY - .03, (i + .5) / 5); if (y > .95) B.boxPart(TC, .011, .011, .004, 0, y, zf(y) + .003, { rect: NBR.FLAT, w: B.wTorso(0, y, .1), bevel: 0 }); } } }
      ck('torso');
      /* bottoms, bare legs, socks */
      const botC = cl(bot.col || 0), stripeC = bot.stripe !== undefined ? cl(bot.stripe) : null, bandC = bot.band !== undefined ? cl(bot.band) : null, RL = bot.type === 'jeans' ? NBR.LEGD : NBR.LEG; let y1 = -1;
      if (bot.type !== 'none') { C.cf = bandC ? ((x, y) => y > 1.005 ? bandC : botC) : null; C.col = botC; if (bot.type === 'brief') B.torsoTube(C, { ys: B.lin_(.845, 1.04, near ? 8 : far ? 3 : 5), ease: be, uv: NBR.PEL, vOf: y => (y - .845) / .195, w: (x, y) => B.wPelvis(x, y), cap0: true, lipTop: true, n: near ? 28 : far ? 8 : 14 }); else B.pelvis(C, be, { uv: NBR.PEL, n: near ? 28 : far ? 8 : 14, ys: B.lin_(.845, 1.04, near ? 8 : far ? 3 : 5) });
        const stripe = stripeC ? ((x, y, z) => abs(z) < .018 && abs(x) - .096 > .026 ? stripeC : botC) : null; C.cf = stripe;
        if (bot.type === 'jeans' || bot.type === 'trousers') { y1 = bot.crop ? .33 : .1; const op = Math.max(0, (bot.open === undefined ? .06 : bot.open) - .048), yb = y1; B.legs(C, { y1, uv: RL, K: near ? 15 : far ? 4 : 9, n: NL, ease: y => be + op * (1 - sm(y, yb, yb + .42)), disp: near ? B.kneeFold(.004 + bo * .35, yb) : null }); }
        else if (bot.type === 'shorts') { y1 = .925 - (bot.len || .35); const yb = y1, flr = bot.flare || 1; B.legs(C, { y1, uv: RL, K: near ? 8 : far ? 2 : 5, n: NL, ease: y => be + .014 * flr * (1 - sm(y, yb, yb + .22)) }); }
        else if (bot.type === 'brief') { y1 = .885; for (const s of [1, -1]) B.legTube(C, s, { y0: .965, y1, K: far ? 2 : 4, n: NL, ease: be, uv: RL, lip: !far }); }
        C.cf = null; }
      const needLeg = bot.type === 'none' || y1 > .18;
      if (needLeg) { const yt = Math.min(.965, bot.type === 'none' ? (top.skirt ? Math.min(.9, hemY + .12) : .965) : y1 + .05); S.col = skinC; for (const s of [1, -1]) B.legTube(S, s, { y0: yt, y1: .09, K: near ? Math.max(6, Math.round((yt - .09) * 18)) : far ? Math.max(3, Math.round((yt - .09) * 5)) : Math.max(4, Math.round((yt - .09) * 10)), n: NL, uv: NBR.SKIN }); }
      if (sp.socks && !far) { C.col = cl(sp.sockCol || 0xd9d6cc); for (const s of [1, -1]) B.legTube(C, s, { y0: Math.max(.16, .925 - sp.socks), y1: .09, K: 4, n: NL, ease: .0035, uv: NBR.KNIT }); }
      ck('legs');
      /* feet */
      { const sh = sp.shoes, barefoot = sh.type === 'bare', sandal = sh.type === 'sandal', skinFoot = barefoot || sandal, boot = sh.type === 'boot', upC = skinFoot ? skinC : cl(sh.col), soC = barefoot ? mul(skinC, .88) : cl(sh.sole), shaftC = skinFoot ? skinC : boot ? upC : (sp.socks || sh.type === 'sneaker') ? cl(sp.sockCol || 0xd9d6cc) : mul(skinC, .92), FM = skinFoot ? S : C, sc = skinFoot ? .84 : sh.type === 'flat' ? .9 : 1, toeC = sh.toe !== undefined && !skinFoot ? cl(sh.toe) : null;
        FM.cf = (x, y, z) => y < (sandal ? .014 : barefoot ? 0 : .03) ? soC : y > .108 ? shaftC : (toeC && z > .13 ? toeC : upC);
        for (const s of [1, -1]) { if (near && skinFoot) { nbFoot(S, s, sandal ? .013 : 0, NBR.SKIN); if (sandal) { C.cf = null; C.col = soC; B.boxPart(C, .094, .013, .262, B.K.HIPX * s + .004 * s, .0065, .036, { rect: NBR.FLAT, w: (x, y, z) => { const k = sm(z, .1, .14); return [BI['foot' + (s > 0 ? 'L' : 'R')], 1 - k, BI['toe' + (s > 0 ? 'L' : 'R')], k]; }, bevel: .005 }); } } else if (near) B.addShoe(FM, s, { n: 10, nw: 6, boot, scale: sc, uv: skinFoot ? NBR.SKIN : NBR.SHOE, uvShaft: skinFoot ? NBR.SKIN : boot ? NBR.FLAT : NBR.SHAFT }); else nbShoeLo(FM, s, sc, skinFoot ? NBR.SKIN : NBR.SHOE, skinFoot ? NBR.SKIN : boot ? NBR.FLAT : NBR.SHAFT, boot, far); }
        FM.cf = null;
        if (sandal && near) { C.col = cl(sh.col); for (const s of [1, -1]) { const x0 = B.K.HIPX * s, wf = [BI['foot' + (s > 0 ? 'L' : 'R')], 1]; for (const s2 of [1, -1]) B.strip(C, [[x0 - s * .016, .04, .128], [x0 + s2 * .022 - s * .004, .066, .085], [x0 + s2 * .04, .034, .03]], { width: .011, thick: .004, U: [0, 0, 1], uv: NBR.FLAT, w: () => wf, steps: 8, n: 4 }); } } }
      ck('feet');
    } finally { B.setShape(null); }
    const ph = !sp.mask && GT.humans && !/[?&]faces=0/.test(location.search) ? GT.humans.pickFace(sp, { age }) : null, out = { tris: 0, age, face: nbFaceKey(sp, age) + (ph ? '|' + ph.id + (ph.mir ? 'm' : '') : '') };   /* PP: + a photo face */ if (far) { out.far = M0.geo(); out.tris = M0.tris; return out; } for (const k in M) if (M[k].tris) { out[k] = M[k].geo(); out.tris += M[k].tris; } return out; }
  function nbFigure(sp) { const t0 = nbNow(), leg = buildFigure(sp, true), fig = { J: leg.J, leg, torch: leg.torch, hs: leg.hs, HC: leg.HC, sY: leg.sY, ny: leg.ny, tb: leg.tb, top: leg.top, mid: null, near: null }; nbMats();
    fig.mid = nbBody(sp, fig, 1); fig.far = nbBody(sp, fig, 2); fig.tris = leg.tris + fig.mid.tris; NBT.build += nbNow() - t0; NBT.n++; return fig; }
  const nbNear = (sp, fig) => { if (!fig.near) { const t0 = nbNow(); fig.near = nbBody(sp, fig, 0); NBT.near += nbNow() - t0; NBT.nearN++; } return fig.near; };
  /* ---- skeleton: the hero's bones + prop bones, followed by "legacy" entries (old bone order) whose inverse-bind matrices fit round-2 geometry to the new body */
  const NB_OLD = ['hips', 'spine', 'chest', 'neck', 'head', 'clavL', 'armL', 'foreL', 'handL', 'clavR', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
  function nbSkel(sp, fig, shape) { const B = HB, D = B.BDEF, BI = B.BI, J = fig.J, by = {}, bones = D.map(d => { const b = new T.Bone(); b.name = d[0]; b.position.set(d[2], d[3], d[4]); if (d[5]) b.rotation.z = d[5]; by[d[0]] = b; return b; });
    D.forEach((d, i) => { if (d[1]) bones[BI[d[1]]].add(bones[i]); });
    const OB = NB_OLD.map((n, i) => { const b = by[n]; b.rotation.order = i <= HEAD ? 'YXZ' : 'ZXY'; return b; });
    for (const n of ['propL', 'propR', 'propR2', 'aux']) { const b = new T.Bone(); b.name = n; b.rotation.order = n === 'aux' ? 'YXZ' : 'ZXY'; by[n] = b; OB.push(b); }
    by.propL.position.set(-.024, -.082, .008); by.handL.add(by.propL); by.propR.position.set(.024, -.082, .008); by.handR.add(by.propR); by.propR2.position.set(.024, -.082, .008); by.handR.add(by.propR2); by.root.add(by.aux);
    /* proportions of this spec: shoulder / hip width, shoulder height, head size and shape */
    const shx = J[ARM][0], hpx = J[THIGH][0], dyS = (fig.sY - 1.40) * NKY, sH = fig.hs / 1.06 * 1.045;
    by.clavL.position.y += dyS; by.clavR.position.y += dyS; by.armL.position.x = shx - .035; by.armR.position.x = -(shx - .035); by.thighL.position.x = hpx; by.thighR.position.x = -hpx; by.head.scale.set(sH * shape.hx, sH * shape.hy, sH);
    /* legacy inverse binds */
    const inv = NBINV.slice(), M4 = () => new T.Matrix4(), KX = 1.05, c0 = .925 * (1 - NKY), fitT = M4().set(KX, 0, 0, 0, 0, NKY, 0, c0, 0, -NSH * NKY, KX, -NSH * (c0 - 1), 0, 0, 0, 1);
    const dY = 1.585 + .2175 * sH - fig.HC[1] - .1165 * fig.hs, dZ = -.005 + .0075 * sH - .022 + .0035 * fig.hs;
    for (let i = 0; i < 23; i++) { let m;
      if (i <= NECK || i === CLAV || i === CLAV + 4) m = M4().multiplyMatrices(NBINV[BI[NB_OLD[i]]], fitT);
      else if (i === HEAD) m = M4().makeScale(1 / sH, 1 / sH, 1 / sH).multiply(NBINV[BI.head]).multiply(M4().makeTranslation(0, dY, dZ));
      else m = M4().makeTranslation(-J[i][0], -J[i][1], -J[i][2]);
      inv.push(m); }
    return { root: bones[0], by, OB, skeleton: new T.Skeleton(bones.concat(OB), inv), sH }; }
  /* two-bone IK (same solver as the hero's) */
  const _kd = new T.Vector3(), _kp = new T.Vector3(), _ke = new T.Vector3(), _ka = new T.Vector3(), _kb = new T.Vector3(), _kx = new T.Vector3(), _ky = new T.Vector3(), _kz = new T.Vector3(), _km = new T.Matrix4();
  const nbBasis = (q, X, Y) => { _kz.crossVectors(X, Y); _km.makeBasis(X, Y, _kz); q.setFromRotationMatrix(_km); };
  function nbIk2(S, target, poleV, l1, l2, sign, qUp, qLo) { _kd.copy(target).sub(S); const dist = _kd.length() || 1e-5; _kd.multiplyScalar(1 / dist); const dd = clamp(dist, abs(l1 - l2) + .02, (l1 + l2) * .999), x = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    _kp.copy(poleV).addScaledVector(_kd, -poleV.dot(_kd)); if (_kp.lengthSq() < 1e-6) { _kp.set(0, 0, 1); if (abs(_kd.z) > .9) _kp.set(0, 1, 0); _kp.addScaledVector(_kd, -_kp.dot(_kd)); } _kp.normalize();
    _ke.copy(S).addScaledVector(_kd, x).addScaledVector(_kp, h); _ka.copy(_ke).sub(S).normalize(); _kb.copy(S).addScaledVector(_kd, dd).sub(_ke).normalize();
    if (sign > 0) _kx.crossVectors(_kd, _kp); else _kx.crossVectors(_kp, _kd); _kx.normalize(); _ky.copy(_ka).negate(); nbBasis(qUp, _kx, _ky); _ky.copy(_kb).negate(); nbBasis(qLo, _kx, _ky); }
  /* finger curl by state [left, right] (a held prop closes the hand by itself) */
  const NB_GRIP = { push_cart: [1, 1], carry_pole: [.9, .9], pull_trolley: [.4, 1], sweep: [1, 1], fish: [.95, .95], lift: [1, 1], punch: [1, 1], aim: [.9, 1], shoot: [.9, 1], balance_bike: [1, 1], scoot: [1, 1], whip_top: [.4, 1], applaud: [.04, .04], cheer: [.1, .1], wave: [.36, .05], handsup: [.04, .04], taichi: [.1, .1], square_dance: [.14, .14], fan_dance: [.14, .14], traffic: [.08, .08],
    scold: [.4, .75], point: [.4, .75], cower: [.6, .6], swim: [.08, .08], dive: [.04, .04], handstand: [0, 0], chess_move: [.4, .62], mahjong: [.5, .5], play_guitar: [.5, .62], carry_box: [.5, .5], carry_run: [1, .5], run: [.7, .7], flee: [.3, .3], chase: [.7, .7], jog: [.7, .7], wrestle_a: [.8, .8], wrestle_b: [.8, .8], demand: [.3, .1], fake_fall: [.2, .2], fall: [.2, .2], stretch: [.1, .1], dribble: [.2, .15], shoot_hoop: [.2, .2], cook: [.5, .9], smoke: [.4, .5], smoke_squat: [.4, .5] };
  const SURF_OK = { walk: 1 };
  const NB_NOIK = { skate: 1, scoot: 1, balance_bike: 1, dog_trot: 1 }, _nq1 = new T.Quaternion(), _nq2 = new T.Quaternion(), _nq3 = new T.Quaternion(), _nqT = new T.Quaternion(), _nqS = new T.Quaternion(), _nqF = new T.Quaternion(), _nqH = new T.Quaternion(), _np1 = new T.Vector3(), _np2 = new T.Vector3(), _np3 = new T.Vector3(), NB_ID = new T.Matrix4();
  let NBLP = null; const NBLC = { phase: 0, stride: 1, turn: 0 }, NBLO = { arms: 0 };
  function makeNB(kind, opts, sp) {
    const B = HB, KK = B.K, CH = B.C, M = mats(), NM = nbMats(), fig = NBGEO[sp.key] || (NBGEO[sp.key] = nbFigure(sp)), J = fig.J, age = fig.mid.age, shape = nbShape(sp, fig, age), gait = nbGait(sp, age), scale = sp.height / 1.8;
    const group = new T.Group(), inner = new T.Group(); group.name = 'person_' + kind + (sp.type ? '_' + sp.type : ''); inner.scale.setScalar(scale); group.add(inner);
    const sk = nbSkel(sp, fig, shape), by = sk.by, bones = sk.OB, skel = sk.skeleton, meshes = [], lodM = [[], [], []]; inner.add(sk.root);
    const mkm = (geo, mat, name) => { const m = new T.SkinnedMesh(geo, mat); m.name = 'person_' + name; m.castShadow = mat !== M.glow; m.receiveShadow = mat !== M.glow; inner.add(m); m.bind(skel, NB_ID); meshes.push(m); return m; };
    const legM = []; for (const name in fig.leg.geo) legM.push(mkm(fig.leg.geo[name], M[name], name)); const legFar = !!(sp.kit && (sp.kit.surf || sp.kit.aux));   /* PP: hats, bags and hand props are dropped at the far LOD (big carried things stay) */
    const body = (set, lod) => { const sm_ = nbSkinMat(set.face); for (const k of ['skin', 'hair', 'cloth', 'print', 'print2']) if (set[k]) { const m = mkm(set[k], k === 'skin' ? sm_ : NM[k], k + lod); lodM[lod].push(m); } };
    const camHook = (r, sc, cam) => { if (cam.isPerspectiveCamera) { const e = cam.matrixWorld.elements; CAMP.set(e[12], e[13], e[14]); CAMS.f = r.info.render.frame; } };
    body(fig.mid, 1); lodM[1][0].onBeforeRender = camHook;
    if (fig.far && fig.far.far) { const fm = mkm(fig.far.far, NM.far, 'far2'); fm.visible = false; fm.onBeforeRender = camHook; lodM[2].push(fm); }   /* PP: the far LOD, one mesh and one shared material */
    let torch = null; if (fig.torch) { torch = new T.Mesh(TORCH_GEO || (TORCH_GEO = new T.CircleGeometry(.021, 12).rotateX(PI / 2)), M.torch); torch.position.set(fig.torch[0], fig.torch[1], fig.torch[2]); bones[PROPL].add(torch); }
    const sd = (opts.seed || 0) * 1.7 + (count++) * 2.39, K = sp.kit || {};
    const st = { state: 'idle', t: sd * 3, ph: (sd * .37) % 1, blend: 1, lookY: 0, lookP: 0, cur: new Float32Array(NCH), from: new Float32Array(NCH), to: new Float32Array(NCH), bagX: 0, bagV: 0, ik: 0, vr: 0, stride: 1, fc: [.36, .36], blink: 1 + (sd % 3), lod: 1, lodF: opts.lod !== undefined ? opts.lod : null, queued: false, hasNear: false, fr: 0 };
    const ctx = { t: 0, ph: 0, v: 0, kind, sd, sp, steer: 0, k: 1 / scale, var: opts.variant !== undefined ? opts.variant : ((sd * 7.31) | 0) % 12, seat: opts.seat, speak: undefined, sync: undefined, dist: opts.dist };
    const hold = opts.hold !== undefined ? !!opts.hold : !!(K.propL && K.propL !== 'ball' && K.propL !== 'dumbbell'), rest = opts.auxRest === false ? null : AUX_REST[K.aux] || null, hipY = KK.HIPY0, eyeY0 = 1.585 + .093 * sk.sH;
    const FB = [0, 1].map(k => { const L = k ? 'R' : 'L'; return { sg: k ? -1 : 1, f1: by['f1' + L], f2: by['f2' + L], f3: by['f3' + L], t1: by['t1' + L], t2: by['t2' + L], th: by['thigh' + L], sn: by['shin' + L], ft: by['foot' + L], toe: by['toe' + L] }; });
    /* MD (2026-11-17): a Rocketbox model (GT.humans.mdl) stands in for the lofted body at the near and middle LOD once it has loaded; this skeleton keeps posing and the model follows it.
       The far LOD stays the one-mesh lofted figure. Worn accessories (hats, vests, bags) were cut for the lofted body and are not drawn over a model; big carried things (surfboards, carts) are. */
    const MH = GT.humans && GT.humans.mdl; let mdl = null, mdlId;   /* the model also stands in at the far LOD out to MD_FAR m (the lofted far figure wears different clothes: switching at 30 m was a visible swap) */
    function mdlTry() { if (mdl || !MH || MH.off) return; if (mdlId === undefined) mdlId = MH.pick(sp); if (!mdlId) return; if (MH.P[mdlId] && MH.P[mdlId].state === 'failed') { mdlId = MH.pick(sp); if (!mdlId) return; } if (!MH.ready(mdlId)) { MH.load(mdlId); return; } mdl = MH.attach(mdlId, inner, by, { seed: hashS(sp.key || '') + (opts.seed || 0) * 7 }); if (mdl) { mdl.setShadow(lodM[1][0] ? lodM[1][0].castShadow : true); const l = st.lod; st.lod = -1; setLod(l);
        if (mdl.obr && mdl.meshes) { const ob = mdl.obr; for (const m of mdl.meshes) m.onBeforeRender = function (r, sc, cam, geo, mat) { camHook(r, sc, cam); ob.call(this, r, sc, cam, geo, mat); }; } } }   /* TF: the model's draw also tells the LOD where the camera is (the lofted meshes it hides used to be the only ones that did, so with every figure on a model the 60 m switch to the one-mesh far figure never happened) */
    function setLod(l) { if (l === 0 && !st.hasNear && !mdl) { if (st.lodF === 0 || opts.lod === 0) buildNear(); else { if (!st.queued) { st.queued = true; NBQ.push(buildNear); } l = 1; } } if (l === st.lod) return; st.lod = l; const mm = !!mdl && (l !== 2 || !st.vfar);
      for (const m of lodM[0]) m.visible = l === 0 && !mm; for (const m of lodM[1]) m.visible = l === 1 && !mm; for (const m of lodM[2]) m.visible = l === 2 && !mm; if (!legFar) for (const m of legM) m.visible = l !== 2 && !mm; if (mdl) mdl.root.visible = mm; }
    function dropNear() { if (!st.hasNear || sp.named || opts.lod === 0) return; st.hasNear = false; st.queued = false; for (const m of lodM[0]) { inner.remove(m); const i = meshes.indexOf(m); if (i >= 0) meshes.splice(i, 1); } lodM[0].length = 0; fig.nearRefs--; if (fig.nearRefs <= 0 && fig.near) { for (const k of ['skin', 'hair', 'cloth', 'print', 'print2']) if (fig.near[k]) fig.near[k].dispose(); fig.near = null; fig.nearRefs = 0; } out.tris = fig.tris; }
    function buildNear() { if (st.hasNear) return; st.hasNear = true; fig.nearRefs = (fig.nearRefs || 0) + 1; st.farN = 0; body(nbNear(sp, fig), 0); for (const m of lodM[0]) { m.visible = st.lod === 0; m.castShadow = lodM[1][0].castShadow; } out.tris = fig.leg.tris + fig.near.tris; }
    function lodTick() { if (NBQ.length && CAMS.f !== CAMS.qf) { CAMS.qf = CAMS.f; NBQ.shift()(); } if (!mdl && MH) mdlTry();
      let want = st.lod; if (st.lodF !== null) want = st.lodF === 2 ? 2 : st.lodF ? 1 : 0; else if (CAMS.f >= 0) { const e = group.matrixWorld.elements, d = Math.hypot(e[12] - CAMP.x, e[13] - CAMP.y, e[14] - CAMP.z); want = d < (st.lod === 0 ? 16 : 13.5) ? 0 : d > (st.lod === 2 ? 27 : 30) && FAR_ON ? 2 : 1; const mf = (opts.def && opts.def.mdFar) || opts.mdFar || MD_FAR, vf = d > (st.vfar ? mf - 4 : mf);   /* TF: opts.mdFar — a nearer switch to the one-mesh figure for a crowd that is always round the player */ if (vf !== !!st.vfar) { st.vfar = vf; if (mdl) { const l0 = st.lod; st.lod = -1; setLod(want === l0 ? l0 : want); } } }
      if (want === 0) st.farN = 0; else if (st.hasNear && ++st.farN > 90) dropNear();
      setLod(want); }
    function apply(P, dt, s) {
      for (let i = 0; i < 19; i++) { const b = bones[i]; b.rotation.x = P[i * 3]; b.rotation.y = P[i * 3 + 1]; b.rotation.z = P[i * 3 + 2]; }
      let ty = 0, tp = 0;
      if (s && s.lookAt) { group.updateWorldMatrix(true, false); _v.copy(s.lookAt); group.worldToLocal(_v); _v.divideScalar(scale); const eyeY = eyeY0 + P[HY]; ty = Math.atan2(_v.x, _v.z); tp = Math.atan2(_v.y - eyeY, Math.hypot(_v.x, _v.z));
        if (abs(ty) > 2.2) ty = 0; ty = clamp(ty, -1.25, 1.25); tp = clamp(tp, -.6, .6); }
      const k = 1 - Math.exp(-dt * 7); st.lookY += (ty - st.lookY) * k; st.lookP += (tp - st.lookP) * k;
      const tw = P[TW], yb = st.lookY * tw, yh = st.lookY * (1 - tw);
      bones[SPINE].rotation.y += yb * .45; bones[CHEST].rotation.y += yb * .55; bones[NECK].rotation.y += yh * .4; bones[HEAD].rotation.y += yh * .6; bones[NECK].rotation.x -= st.lookP * .35; bones[HEAD].rotation.x -= st.lookP * .5; if (tw > .3) bones[CHEST].rotation.x -= st.lookP * tw * .25;
      const br = sin(st.t * 1.45 + sd); bones[CHEST].rotation.x -= .012 * br; bones[CHEST].scale.set(1 + .006 * br, 1, 1 + .014 * br); bones[CLAV].rotation.z += .012 * br; bones[CLAV + 4].rotation.z -= .012 * br;
      for (const side of [0, 4]) { const b = bones[ARM + side], yaw = P[side ? YAR : YAL]; b.quaternion.setFromEuler(b.rotation); if (yaw) { _q.setFromAxisAngle(YAX, yaw); b.quaternion.premultiply(_q); } }
      const hx = bones[HIPS].rotation.x, hz = bones[HIPS].rotation.z;
      for (const side of [0, 3]) { const f = bones[FOOT + side], th = bones[THIGH + side], sn = bones[SHIN + side]; f.rotation.set((side ? P[FPR] : P[FPL]) - th.rotation.x - sn.rotation.x - hx * cos(th.rotation.z), 0, -(hz + th.rotation.z) * .85); }
      const hips = bones[HIPS]; hips.position.set(P[HX], hipY, P[HZ]);
      if (P[CLAMP] > .01) { hips.updateMatrix(); let low = 1e9;
        for (const side of [0, 3]) { const th = bones[THIGH + side], sn = bones[SHIN + side], f = bones[FOOT + side]; th.updateMatrix(); sn.updateMatrix(); f.updateMatrix(); _m.multiplyMatrices(hips.matrix, th.matrix).multiply(sn.matrix).multiply(f.matrix);
          for (const q of SOLE) { const y = _v.set(q[0], q[1], q[2]).applyMatrix4(_m).y; if (y < low) low = y; } }
        hips.position.y -= low * P[CLAMP]; }
      if (P[BOB] > .01) { const a = Math.max(0, cos(TAU * 2 * (st.ph - .43))); hips.position.y += .075 * P[BOB] * a * Math.sqrt(a); }
      hips.position.y += P[HY];
      FB[0].toe.rotation.x = -.8 * clamp(P[FPL], 0, 1) * P[CLAMP]; FB[1].toe.rotation.x = -.8 * clamp(P[FPR], 0, 1) * P[CLAMP];
      /* gait: the hero's locomotion solves hips + legs (feet plant at the figure's own speed); blended over the FK legs by st.ik */
      if (st.ik > .002) { const L = NBLP || (NBLP = new Float32Array(CH.N)), w = st.ik, g = gait, stp = sp.stoop || 0; B.neutral(L); NBLC.phase = st.ph; NBLC.stride = st.stride; NBLC.turn = 0; B.loco(L, NBLC, st.vr, NBLO);
        const gz = .075 * (1 - sm(st.vr, .6, 1.5)) + stp * .2; _e.set(L[CH.HR] + stp * .14 + P[HIPS * 3] * .55, L[CH.HR + 1] * g.twist, L[CH.HR + 2] * g.sway, 'YXZ'); _nqH.setFromEuler(_e); _np1.set(L[CH.HP] * g.sway, hipY + L[CH.HP + 1] - g.sink, L[CH.HP + 2]);
        hips.position.lerp(_np1, w); hips.quaternion.slerp(_nqH, w); _nq1.copy(hips.quaternion).invert();
        for (let k2 = 0; k2 < 2; k2++) { const f = FB[k2], sg = f.sg, l = CH.LEG + k2 * 8, pit = L[l + 3] * g.lift, ay = KK.ANK + (L[l + 1] - KK.ANK) * (L[l + 1] > KK.ANK ? g.lift : 1);
          _np2.copy(f.th.position).applyQuaternion(hips.quaternion).add(hips.position); _np3.set(sg * (L[l] + g.wide), ay, L[l + 2] + gz); const yk = sg * (L[l + 4] * .6 + L[l + 7]) + L[CH.HR + 1] * .5; _v.set(sin(yk), .2, cos(yk));
          nbIk2(_np2, _np3, _v, KK.L_TH, KK.L_SH, -1, _nqT, _nqS); _nq2.copy(_nq1).multiply(_nqT); f.th.quaternion.slerp(_nq2, w); _nq2.copy(_nqT).invert().multiply(_nqS); f.sn.quaternion.slerp(_nq2, w);
          _nqF.setFromEuler(_e.set(-pit, sg * (L[l + 4] + (age === 3 ? .08 : 0)), sg * L[l + 5], 'YXZ')); _nq2.copy(_nqS).invert().multiply(_nqF); f.ft.quaternion.slerp(_nq2, w); f.toe.rotation.x = lerp(f.toe.rotation.x, -clamp(L[l + 6] * g.lift, 0, 1.2), w); }
        _e.order = 'XYZ'; }
      const pl = clamp(P[PL], 0, 1), pr = clamp(P[PR], 0, 1), pr2 = clamp(P[PR2], 0, 1), bl = bones[PROPL], brr = bones[PROPR], b2 = bones[PROPR2]; bl.scale.setScalar(Math.max(pl, 1e-4)); brr.scale.setScalar(Math.max(pr, 1e-4)); b2.scale.setScalar(Math.max(pr2, 1e-4)); bl.visible = pl > .02; brr.visible = pr > .02;
      if (K.bag) { const ax = bones[ARM].rotation.x + bones[FORE].rotation.x, az = bones[ARM].rotation.z; bl.rotation.set(-ax + P[BGX], 0, -az * .9 + P[BGZ]); }
      const ax_ = bones[AUX], as = clamp(P[AXS], 0, 1); ax_.position.set(P[AXX], P[AXY], P[AXZ]); ax_.rotation.set(P[ARX], P[ARY], P[ARZ]); ax_.scale.setScalar(Math.max(as, 1e-4));
      /* fingers, eyelids */
      { const gr = NB_GRIP[st.state], kf = Math.min(1, dt * 10 + (dt === 0 ? 1 : 0)), tl = Math.max(gr ? gr[0] : .36, K.propL ? pl * .95 : 0), tr = Math.max(gr ? gr[1] : .36, Math.max(K.phone || K.pistol ? pr : 0, K.propR2 || K.tote || K.surf ? pr2 : 0) * .95); st.fc[0] += (tl - st.fc[0]) * kf; st.fc[1] += (tr - st.fc[1]) * kf;
        by.hair.rotation.set(.03 * sin(st.t * 1.1 + sd) + .06 * sin(TAU * 2 * st.ph) * st.ik, 0, .07 * sin(TAU * st.ph) * st.ik);
        for (let k2 = 0; k2 < 2; k2++) { const f = FB[k2], cu = st.fc[k2] + (st.fc[k2] < .6 ? .05 * sin(st.t * (.9 + k2 * .23) + sd + k2 * 2) : 0), th = cu > .6 ? .75 : .2 + cu * .3; f.f1.rotation.z = -f.sg * cu * 1.15; f.f2.rotation.z = -f.sg * cu * 1.3; f.f3.rotation.z = -f.sg * cu * .85; f.t1.rotation.set(th * .35, 0, -f.sg * (.12 + th * .6)); f.t2.rotation.z = -f.sg * th * .7; }
        st.blink -= dt; if (st.blink < -.15) st.blink = 2 + 3.6 * ((st.t * 7.13 + sd) % 1); by.lid.rotation.x = -.85 * (1 - (st.blink < 0 ? sin(PI * clamp(-st.blink / .15, 0, 1)) : 0)); }
    }
    function update(dt, s) {
      dt = clamp(dt || 0, 0, .25); s = s || {}; let name = s.state || 'idle'; if (!POSE[name]) name = 'idle';
      if (name !== st.state) { st.from.set(st.cur); st.blend = (st.fresh || s.snap) ? 1 : 0; st.state = name; st.ts = 0; } const snap = st.fresh || s.snap; st.fresh = false; st.ts = (st.ts || 0) + dt;
      const loco = LOCO[name], v = s.speed !== undefined ? Math.max(0, s.speed) : (name === 'walk' ? 1.4 : CN_LOCO[name] !== undefined ? CN_LOCO[name] : name === 'carry_box' || name === 'skate' ? 0 : loco ? 5 : 0), walkish = name === 'walk' || name === 'carry_box' || (CN_LOCO[name] !== undefined && !CN_RUN[name]);
      const ikable = loco && !NB_NOIK[name], vr = v / scale; st.t += dt; st.vr = vr;
      if (ikable) { st.stride = B.strideLen(Math.min(vr, 6.6)) * gait.stride; st.ph = (st.ph + dt * vr / st.stride) % 1; }
      else if (loco) st.ph = (st.ph + dt * (name === 'skate' ? .55 : v / (walkish ? .9 + .38 * v : 1.2 + .42 * v))) % 1;
      { const ikT = ikable ? sm(vr, .06, .32) : 0; st.ik = snap ? ikT : st.ik + (ikT - st.ik) * Math.min(1, dt * 9); }
      ctx.t = st.t; ctx.ts = s.t !== undefined ? s.t : st.ts; ctx.drop = s.drop; ctx.ph = st.ph; ctx.v = v; ctx.steer = s.steer || 0; ctx.speak = s.speak; ctx.sync = s.sync; if (s.seat !== undefined) ctx.seat = s.seat; if (s.dist !== undefined) ctx.dist = s.dist; if (s.variant !== undefined) ctx.var = s.variant;
      const P = st.to; P.fill(0); POSE[name](P, ctx);
      if (ikable && gait.arm !== 1 && (name === 'walk' || name === 'run' || name === 'jog' || name === 'flee')) { P[ARM * 3] *= gait.arm; P[(ARM + 4) * 3] *= gait.arm; }
      if (opts.bag === true && K.bag) P[PL] = 1;
      if (sp.cn && UPRIGHT_L[K.propL] && HOLD_OK[name] && P[PL] >= 0) arm(P, 1, -.3, -.2, .12, -1.45, 0);
      if (K.propL && !K.bag) P[PL] = P[PL] < 0 ? 0 : Math.max(P[PL], (hold && !NO_REST[name]) || (sp.cn && !HIDE_HAND[name]) ? 1 : 0); if (K.propR2 || K.tote) P[PR2] = K.keepR ? (P[PR2] < 0 || HIDE_HAND[name] ? 0 : 1) : (P[PR2] < 0 || NO_REST[name] || USES_R[name] ? 0 : 1); if (K.surf) { P[PR2] = SURF_OK[name] ? 1 : 0; P[(ARM + 4) * 3] *= .3; P[(ARM + 4) * 3 + 2] -= .06 * P[PR2]; }   /* PP: the surfboard shows walking and standing, the arm that carries it barely swings */
      if (rest && P[AXS] === 0 && !NO_REST[name] && !LOCO[name]) { P[AXX] = rest[0] * ctx.k; P[AXY] = rest[1] * ctx.k; P[AXZ] = rest[2] * ctx.k; P[ARX] = rest[3]; P[ARY] = rest[4]; P[ARZ] = rest[5]; P[AXS] = 1; }
      if (st.blend < 1) { st.blend = Math.min(1, st.blend + dt / (s.blend || .28)); const k = st.blend * st.blend * (3 - 2 * st.blend), F = st.from, C = st.cur; for (let i = 0; i < NCH; i++) C[i] = F[i] + (P[i] - F[i]) * k; } else st.cur.set(P);
      apply(st.cur, dt, s); if ((st.fr++ & 7) === 0 || snap) lodTick();
    }
    const out = { group, kind, type: sp.type || kind, update, spec: sp, bones, meshes, height: sp.height, scale, tris: fig.tris, nb: true, age, get state() { return st.state; }, get lod() { return st.lod; },
      setLod(l) { st.lodF = l === null || l === undefined ? null : l; lodTick(); }, stats() { let t = 0, d = 0; for (const m of meshes) if (m.visible) { d++; t += m.geometry.index.count / 3; } if (mdl && mdl.root.visible) { d += mdl.meshes.length; t += mdl.tris; } return { tris: t, draws: d }; },
      setShadow(on) { for (const m of meshes) m.castShadow = on && m.material !== M.glow; if (mdl) mdl.setShadow(on); }, attach(obj, bone) { const b = bones[BN.indexOf(bone)] || by[bone]; if (b) b.add(obj); return obj; }, get model() { return mdl; } };
    if (MH) mdlTry(); if ((opts.lod === 0 || sp.named) && !mdl) buildNear();
    st.fresh = true; update(0, { state: opts.state }); st.fresh = true;
    st.blend = 1; st.cur.set(st.to); apply(st.cur, 1, {});
    return out;
  }
  /* H4: the figure cngame seats at the wheel of a car the player drives (it asks for make('rider_y', {seed: 77, phone: false})) is the hero himself: the same model, in whatever he is
     wearing, in hero.js's 'drive' pose (hands on the wheel, turning with the steering). Placed so his eyes are where the street figure's were (y 1.46, z .06 in the group cngame positions). */
  function kaiDriver() { const h = GT.hero.make('kai', {}), group = new T.Group(), v = new T.Vector3(); group.name = 'kai_driver'; group.add(h.group); h.setBox(false); h.setHelmet(false);
    const place = () => { h.group.position.set(0, 0, 0); for (let i = 0; i < 6; i++) h.update(.1, { state: 'drive', steer: 0 });   /* run the blend out: the pose must be the seated one when the head is measured */ group.updateMatrixWorld(true); h.world('head', v); group.worldToLocal(v); h.group.position.set(-v.x, 1.46 - (v.y + .085), .06 - (v.z + .07)); };
    const sync = () => { const ph = GT.cngame && GT.cngame.hero; if (ph && ph.outfit && ph.outfit !== h.outfit && h.outfits.indexOf(ph.outfit) >= 0) { h.setOutfit(ph.outfit); h.setBox(false); h.setHelmet(false); } if (ph && h.setShades && !!ph.shades !== !!h.shades) h.setShades(!!ph.shades); };
    sync(); place(); return { group, kind: 'rider_y', hero: h, isHero: true, update(dt, s) { sync(); h.update(dt || 0, { state: 'drive', steer: s && s.steer || 0 }); return this; } }; }
  function make(kind, opts) {
    opts = opts || {}; if (kind === 'rider_y' && opts.seed === 77 && opts.phone === false && GT.hero && GT.hero.make) { try { return kaiDriver(); } catch (e) { console.warn('[people] kaiDriver', e); } } if (!KINDS.includes(kind)) { if (PED[kind]) opts = Object.assign({ type: kind }, opts); kind = 'ped'; }
    { const sp0 = specFor(kind, opts); if (!sp0.dog && kind !== 'driver' && nbOK()) return makeNB(kind, opts, sp0); }
    const M = mats(), sp = specFor(kind, opts), fig = GEO[sp.key] || (GEO[sp.key] = buildFigure(sp)), J = fig.J;
    const group = new T.Group(), inner = new T.Group(), scale = sp.height / fig.top; group.name = 'person_' + kind + (sp.type ? '_' + sp.type : ''); inner.scale.setScalar(scale); group.add(inner);
    const bones = BN.map((n, i) => { const b = new T.Bone(); b.name = n; b.rotation.order = (i <= HEAD || i === AUX) ? 'YXZ' : 'ZXY'; return b; }), inv = [];
    for (let i = 0; i < bones.length; i++) { const p = PAR[i], j = J[i]; if (p < 0) { bones[i].position.set(j[0], j[1], j[2]); inner.add(bones[i]); } else { bones[i].position.set(j[0] - J[p][0], j[1] - J[p][1], j[2] - J[p][2]); bones[p].add(bones[i]); } inv.push(new T.Matrix4().makeTranslation(-j[0], -j[1], -j[2])); }
    const skel = new T.Skeleton(bones, inv), meshes = [];
    for (const name in fig.geo) { const m = new T.SkinnedMesh(fig.geo[name], M[name]); m.name = 'person_' + name; m.castShadow = name !== 'glow'; m.receiveShadow = name !== 'glow'; inner.add(m); m.bind(skel, new T.Matrix4()); meshes.push(m); }
    let torch = null; if (fig.torch) { torch = new T.Mesh(TORCH_GEO || (TORCH_GEO = new T.CircleGeometry(.021, 12).rotateX(PI / 2)), M.torch); torch.position.set(fig.torch[0], fig.torch[1], fig.torch[2]); bones[PROPL].add(torch); }
    const sd = (opts.seed || 0) * 1.7 + (count++) * 2.39, driver = kind === 'driver', K = sp.kit || {};
    const st = { state: driver ? 'drive' : 'idle', t: sd * 3, ph: (sd * .37) % 1, blend: 1, lookY: 0, lookP: 0, cur: new Float32Array(NCH), from: new Float32Array(NCH), to: new Float32Array(NCH), bagX: 0, bagV: 0 };
    const ctx = { t: 0, ph: 0, v: 0, kind, sd, sp, steer: 0, k: 1 / scale, var: opts.variant !== undefined ? opts.variant : ((sd * 7.31) | 0) % 12, seat: opts.seat, speak: undefined, sync: undefined, dist: opts.dist };
    const hold = opts.hold !== undefined ? !!opts.hold : !!(K.propL && K.propL !== 'ball' && K.propL !== 'dumbbell'), rest = opts.auxRest === false ? null : AUX_REST[K.aux] || null;
    const hipY = J[HIPS][1];
    function apply(P, dt, s) {
      for (let i = 0; i < 19; i++) { const b = bones[i]; b.rotation.x = P[i * 3]; b.rotation.y = P[i * 3 + 1]; b.rotation.z = P[i * 3 + 2]; }
      // look-at: neck/head yaw + pitch, optionally the torso too (aim / film / point)
      let ty = 0, tp = 0;
      if (s && s.lookAt) { group.updateWorldMatrix(true, false); _v.copy(s.lookAt); group.worldToLocal(_v); _v.divideScalar(scale); const eyeY = driver ? .7 : J[HEAD][1] + .07 + P[HY]; ty = Math.atan2(_v.x, _v.z); tp = Math.atan2(_v.y - eyeY, Math.hypot(_v.x, _v.z));
        if (abs(ty) > 2.2) ty = 0; ty = clamp(ty, -1.25, 1.25); tp = clamp(tp, -.6, .6); }
      const k = 1 - Math.exp(-dt * 7); st.lookY += (ty - st.lookY) * k; st.lookP += (tp - st.lookP) * k;
      const tw = P[TW], yb = st.lookY * tw, yh = st.lookY * (1 - tw);
      bones[SPINE].rotation.y += yb * .45; bones[CHEST].rotation.y += yb * .55; bones[NECK].rotation.y += yh * .4; bones[HEAD].rotation.y += yh * .6; bones[NECK].rotation.x -= st.lookP * .35; bones[HEAD].rotation.x -= st.lookP * .5; if (tw > .3) bones[CHEST].rotation.x -= st.lookP * tw * .25;
      // breathing
      const br = sin(st.t * 1.45 + sd); bones[CHEST].rotation.x -= .012 * br; bones[CHEST].scale.set(1 + .006 * br, 1, 1 + .014 * br); bones[CLAV].rotation.z += .012 * br; bones[CLAV + 4].rotation.z -= .012 * br;
      // arms: outer yaw
      for (const side of [0, 4]) { const b = bones[ARM + side], yaw = P[side ? YAR : YAL]; b.quaternion.setFromEuler(b.rotation); if (yaw) { _q.setFromAxisAngle(YAX, yaw); b.quaternion.premultiply(_q); } }
      // feet: world pitch -> ankle
      const hx = bones[HIPS].rotation.x, hz = bones[HIPS].rotation.z;
      for (const side of [0, 3]) { const f = bones[FOOT + side], th = bones[THIGH + side], sn = bones[SHIN + side]; f.rotation.set((side ? P[FPR] : P[FPL]) - th.rotation.x - sn.rotation.x - hx * cos(th.rotation.z), 0, -(hz + th.rotation.z) * .85); }
      // hips + ground clamp
      const hips = bones[HIPS]; hips.position.set(J[HIPS][0] + P[HX], hipY, J[HIPS][2] + P[HZ]);
      if (driver) hips.position.set(0, .13, 0);
      else if (P[CLAMP] > .01) { hips.updateMatrix(); let low = 1e9;
        for (const side of [0, 3]) { const th = bones[THIGH + side], sn = bones[SHIN + side], f = bones[FOOT + side]; th.updateMatrix(); sn.updateMatrix(); f.updateMatrix(); _m.multiplyMatrices(hips.matrix, th.matrix).multiply(sn.matrix).multiply(f.matrix);
          for (const q of SOLE) { const y = _v.set(q[0], q[1], q[2]).applyMatrix4(_m).y; if (y < low) low = y; } }
        hips.position.y -= low * P[CLAMP]; }
      if (P[BOB] > .01) { const a = Math.max(0, cos(TAU * 2 * (st.ph - .43))); hips.position.y += .075 * P[BOB] * a * Math.sqrt(a); }
      hips.position.y += P[HY];
      // props
      const pl = clamp(P[PL], 0, 1), pr = clamp(P[PR], 0, 1), pr2 = clamp(P[PR2], 0, 1), bl = bones[PROPL], brr = bones[PROPR], b2 = bones[PROPR2]; bl.scale.setScalar(Math.max(pl, 1e-4)); brr.scale.setScalar(Math.max(pr, 1e-4)); b2.scale.setScalar(Math.max(pr2, 1e-4)); bl.visible = pl > .02; brr.visible = pr > .02;
      if (K.bag) { const ax = bones[ARM].rotation.x + bones[FORE].rotation.x, az = bones[ARM].rotation.z; bl.rotation.set(-ax + P[BGX], 0, -az * .9 + P[BGZ]); }
      const ax_ = bones[AUX], as = clamp(P[AXS], 0, 1); ax_.position.set(P[AXX], P[AXY], P[AXZ]); ax_.rotation.set(P[ARX], P[ARY], P[ARZ]); ax_.scale.setScalar(Math.max(as, 1e-4));
    }
    function update(dt, s) {
      dt = clamp(dt || 0, 0, .25); s = s || {}; let name = s.state || (driver ? 'drive' : 'idle'); if (driver && (name === 'sit' || name === 'idle')) name = 'drive'; if (!POSE[name]) name = 'idle';
      if (sp.dog && name.slice(0, 4) !== 'dog_') name = (LOCO[name] && (s.speed === undefined || s.speed > .2)) ? 'dog_trot' : (name === 'cower' || name.slice(0, 3) === 'sit') ? 'dog_sit' : 'dog_idle';
      if (name !== st.state) { st.from.set(st.cur); st.blend = (st.fresh || s.snap) ? 1 : 0; st.state = name; st.ts = 0; } st.fresh = false; st.ts = (st.ts || 0) + dt;
      const loco = LOCO[name], v = s.speed !== undefined ? Math.max(0, s.speed) : (name === 'walk' ? 1.4 : CN_LOCO[name] !== undefined ? CN_LOCO[name] : name === 'carry_box' || name === 'skate' ? 0 : loco ? 5 : 0), walkish = name === 'walk' || name === 'carry_box' || (CN_LOCO[name] !== undefined && !CN_RUN[name]);
      st.t += dt; if (loco) st.ph = (st.ph + dt * (name === 'skate' ? .55 : v / (name === 'dog_trot' ? .3 + .22 * v : walkish ? .9 + .38 * v : 1.2 + .42 * v))) % 1;
      ctx.t = st.t; ctx.ts = s.t !== undefined ? s.t : st.ts; ctx.drop = s.drop; ctx.ph = st.ph; ctx.v = v; ctx.steer = s.steer || 0; ctx.speak = s.speak; ctx.sync = s.sync; if (s.seat !== undefined) ctx.seat = s.seat; if (s.dist !== undefined) ctx.dist = s.dist; if (s.variant !== undefined) ctx.var = s.variant;
      const P = st.to; P.fill(0); POSE[name](P, ctx);
      if (opts.bag === true && K.bag) P[PL] = 1;
      if (sp.cn && UPRIGHT_L[K.propL] && HOLD_OK[name] && P[PL] >= 0) arm(P, 1, -.3, -.2, .12, -1.45, 0);
      if (K.propL && !K.bag) P[PL] = P[PL] < 0 ? 0 : Math.max(P[PL], (hold && !NO_REST[name]) || (sp.cn && !HIDE_HAND[name]) ? 1 : 0); if (K.propR2 || K.tote) P[PR2] = K.keepR ? (P[PR2] < 0 || HIDE_HAND[name] ? 0 : 1) : (P[PR2] < 0 || NO_REST[name] || USES_R[name] ? 0 : 1);
      if (rest && P[AXS] === 0 && !NO_REST[name] && !LOCO[name]) { P[AXX] = rest[0] * ctx.k; P[AXY] = rest[1] * ctx.k; P[AXZ] = rest[2] * ctx.k; P[ARX] = rest[3]; P[ARY] = rest[4]; P[ARZ] = rest[5]; P[AXS] = 1; }
      if (st.blend < 1) { st.blend = Math.min(1, st.blend + dt / (s.blend || .28)); const k = st.blend * st.blend * (3 - 2 * st.blend), F = st.from, C = st.cur; for (let i = 0; i < NCH; i++) C[i] = F[i] + (P[i] - F[i]) * k; } else st.cur.set(P);
      apply(st.cur, dt, s);
    }
    st.fresh = true; update(0, { state: opts.state }); st.fresh = true;
    st.blend = 1; st.cur.set(st.to); apply(st.cur, 1, {});
    return { group, kind, type: sp.type || kind, update, spec: sp, bones, meshes, height: sp.height, scale, tris: fig.tris, get state() { return st.state; },
      setShadow(on) { for (const m of meshes) m.castShadow = on && m.material !== M.glow; }, attach(obj, bone) { const b = bones[BN.indexOf(bone)]; if (b) b.add(obj); return obj; } };
  }
  let TORCH_GEO = null;
  GT.people = { make, nbStats: NBT, states: STATES, newStates: NEW_STATES, kinds: KINDS, pedTypes: PED_TYPES, cnTypes: CN_TYPES, cnNamed: CN_NAMED, cnStates: CN_STATES, bpm: BPM, decals: DECAL };

  /* ------------------------------------------------------------------ populate: a living neighbourhood
     GT.people.populate(scene, opts) -> { list, groups, props, update(dt, playerPos, events), emit(type, x, z, r, ttl), say(npc, cat), resnap(), setVisible(b), dispose(), stats }
     opts: { max (36), seed, onBark(npc, text), spots: { name: {x, z, y?, h?} | false }, groundHeight(x, z), props (true), lodNear (35), lodFar (120), shadowDist (40),
             skip: [group names], extra: [def...], barks: { cat: [lines] } (merged over the built-in lines) }
     playerPos: {x, z, y?, h?, speed?, inCar?} or THREE.Vector3.   events: [{ type: 'gunpoint' | 'gunshot' | 'crash' | 'siren' | 'fight', x, z, r? }] passed every frame while active (or use emit()). */
  const BARKS = {
    idle: ['今晚的风真舒服。', '你听说了吗，加油站又涨价了。', '再坐五分钟就走。', '这日落，拍多少次都不腻。', '明天还得早起，烦。', '那辆红色肌肉车是谁的？真带劲。', '海边一到傍晚人就多。', '我跟你讲，那家塔可是真的好吃。', '手机快没电了。', '热死了，冰机那边凉快点。', '房租又要涨，这日子。', '等会儿去码头看看？'],
    stare: ['看什么看？', '有事吗，朋友？', '你盯着我干嘛。', '咱们认识？', '离远点行吗。', '再看要收费了啊。'],
    run: ['跑这么急，赶着投胎？', '喂，慢点！', '后面有鬼追你啊？', '小心点，别撞到人。', '年轻人火气真大。'],
    aside: ['借过借过。', '哎，看着点路。', '你先走。', '挤什么呀。', '别踩我拖鞋！'],
    car: ['会不会开车啊！', '疯了吧你！', '这是人行道！', '我记住你车牌了！'],
    flee: ['快跑！', '有枪！他有枪！', '别过去，快走！', '报警，快报警！', '我的妈呀！', '让开让开！'],
    film: ['这段发出去肯定火。', '家人们快看，出事了。', '别挡我镜头。', '直播间的朋友们，现场直击。', '拍到了拍到了。'],
    cower: ['别开枪！', '我什么都没看见！', '求你了，别伤害我。', '钱包给你，都给你。'],
    crash: ['我去，撞上了！', '人没事吧？', '这下保险公司有得忙了。', '刚才那一下听着都疼。'],
    siren: ['又是警笛。', '今晚不太平啊。', '条子来了。', '是往加油站那边去的吧？'],
    cheer: ['漂亮！', '再来一个！', '摔他！摔他！', '好球！'],
    bartender: ['来点什么？今天朗姆半价。', '慢慢喝，夜还长。', '账记在谁头上？'],
    musician: ['点歌十块，打赏随意。', '这首送给落日。', '谢谢，谢谢捧场。'],
    cook: ['塔可三块一个，辣酱自己加。', '歇口气，抽完这根就回去。', '今天的牛舌卖完了。'],
    guard: ['这里不许逗留。', '泳池十点关门。', '有事找前台。'],
    lifeguard: ['下班了，别找我救人。', '今天浪不大，放心游。', '涂防晒了吗？'],
    baller: ['传球！这边！', '这球不算，重来！', '你防不住我的。'],
    lifter: ['最后一组！', '帮我看着点杠铃。', '别偷懒，再来两个。'],
    angler: ['嘘，鱼都被你吓跑了。', '今天一条都没咬钩。', '耐心，钓鱼靠的是耐心。'],
    worker: ['这破地方扫不完的。', '老板又让加班。', '箱子放哪儿？'],
    oldman: ['以前这条街可没这么吵。', '年轻那会儿，我也开过快车。', '坐下歇歇，急什么。'],
    skater: ['让一让，刹不住！', '这段路面真烂。'],
    jogger: ['还差两公里。', '借过，谢谢。'],
    rider: ['外卖到了，麻烦接一下。', '导航又把我带错路。'],
    tourist: ['帮我们拍张照好吗？', '这里和宣传册上一模一样。', '纪念品店在哪边？'],
    couple: ['你看那片云，像不像鲸鱼。', '明年还来这儿，好不好。'],
    smoker: ['借个火。', '说好这是最后一包。'],
    guest: ['房间空调又坏了。', '泳池的水有点凉。']
  };
  function populate(scene, opts) {
    opts = opts || {}; const W = GT.world, rng = GT.rng('populate:' + (opts.seed || 0)), root = new T.Group(); root.name = 'people_populate'; scene.add(root);
    const lodNear = opts.lodNear || 35, lodFar = opts.lodFar || 120, shadowDist = opts.shadowDist || 40, skip = opts.skip || [], spotsO = opts.spots || {}, lines = Object.assign({}, BARKS, opts.barks || {});
    const ground = (x, z) => opts.groundHeight ? opts.groundHeight(x, z) : (GT.hangouts && GT.hangouts.groundHeight && GT.hangouts.info && GT.hangouts.info.courtY !== undefined) ? GT.hangouts.groundHeight(x, z) : (GT.road && GT.road.groundHeight) ? GT.road.groundHeight(x, z) : 0;
    const anc = names => { for (const n of names) { const a = W.anchors[n]; if (a) return a; } return null; };
    /** resolve a named spot: opts.spots override > world anchors > default. false disables the group. */
    const spot = (name, names, def) => { const o = spotsO[name]; if (o === false || skip.includes(name)) return null; if (o) return Object.assign({}, def, o); const a = anc(names || []); return a ? Object.assign({}, def, a) : def; };
    const loc = (s, lx, lz) => { const h = s.h || 0, c = cos(h), sn = sin(h); return [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c]; };
    const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
    const defs = [], hasHang = !!(GT.hangouts && GT.hangouts.info && GT.hangouts.info.courtY !== undefined), HPI = PI / 2;
    /** add(group, type, x, z, h, state, extra): extra = { y, seat, variant, seed, pri, look: [x,y,z] | 'mates', alts: [states], bark, path, speed, kit, hold, sync, dist, role, noStep, brave } */
    const add = (group, type, x, z, h, state, e) => { const d = Object.assign({ group, type, x, z, h, state, pri: 1, seed: defs.length * 7 + 3 }, e); defs.push(d); return d; };

    /* ---- 1. gas-station store front: loiterers by the ice chest + a leaner on the storefront, a guy on his phone by the payphone */
    { const s = spot('storefront', [], { x: 49, z: 10.1, y: .15 }); if (s) { const y = s.y;
        add('storefront', 'local_m', s.x - .32, s.z - .75, face(s.x - .32, s.z - .75, s.x - .15, s.z + .8), 'talk_group', { y, look: 'mates', seed: 3, bark: 'idle', kit: { propL: 'can', canCol: 0x9a2a2a } });
        add('storefront', 'skater', s.x - .15, s.z + .8, face(s.x - .15, s.z + .8, s.x - .32, s.z - .75), 'drink', { y, look: 'mates', seed: 5, kit: { propL: 'can', canCol: 0x2a8a5a }, hold: true, bark: 'idle' });
        add('storefront', 'local_f', s.x + .68, s.z - 5.7, -HPI, 'lean_wall', { y, variant: 2, seed: 8, alts: ['lean_wall', 'lean_wall', 'phone_look'], bark: 'idle' });
        add('storefront', 'local_m', s.x + .1, s.z - 4.3, -HPI + .5, 'phone_call', { y, seed: 21, pri: 3, alts: ['phone_call', 'phone_look', 'smoke'], kit: { propL: 'cig' }, bark: 'smoker' }); } }
    /* ---- 2. a pair smoking on the pump island (of all places) */
    { const p = GT.L.station.pumps, s = spot('pumps', [], { x: p[0][0], z: (p[0][1] + p[1][1]) / 2, y: 0 }); if (s) { const y = s.y;
        add('pumps', 'local_m', s.x - .1, s.z + .5, face(0, .5, .35, -.45), 'smoke', { y, seed: 13, kit: { propL: 'cig' }, look: 'mates', bark: 'smoker' });
        add('pumps', 'worker', s.x + .35, s.z - .45, face(.35, -.45, -.1, .5), 'talk_group', { y, seed: 4, look: 'mates', kit: { propL: 'coffee' }, hold: true, bark: 'worker' }); } }
    /* ---- 3. tow-yard / station hands in hi-vis by the service bay */
    { const s = spot('workers', [], { x: 49.3, z: -25.8, y: .15 }); if (s) { const y = s.y;
        add('workers', 'worker', s.x, s.z, PI + .4, 'sweep', { y, seed: 6, kit: { aux: 'broom' }, bark: 'worker', alts: ['sweep', 'sweep', 'idle'] });
        add('workers', 'worker', s.x - .82, s.z - 3.2, 0, 'carry_box', { y, seed: 9, pri: 2, kit: { aux: 'box' }, bark: 'worker', speed: 1.05, path: { pts: [[s.x - .82, s.z - 3.2], [s.x - .82, s.z + 8.4]], wait: [5, 7], waitState: 'idle' } }); } }
    /* ---- 4. beach bar. With the hangouts deck: bartender on barTender, patrons on the two end stools, a pair at the east high-top, a dancer on the sand by the steps.
            Without it: a loose standing group around the coordinates (no seats assumed). */
    { const s = spot('bar', ['barCentre', 'tikiBar'], { x: -32, z: 30, h: HPI }); if (s) { const bt = anc(['barTender', 'bartender']), A = n => W.anchors[n], P = (lx, lz) => loc(s, lx, lz);
        const onStool = (a, type, seed, pri, v) => { const h = a.h || 0, fy = ground(a.x, a.z); add('bar', type, a.x + sin(h) * .1, a.z + cos(h) * .1, h, 'sit_stool', { y: fy, seat: clamp(a.y - fy, .6, .9), seed, variant: v, hold: true, pri, noStep: true, bark: 'idle', look: bt ? [bt.x, fy + 1.5, bt.z] : undefined }); };
        if (bt) { add('bar', 'bartender', bt.x, bt.z, bt.h || 0, 'idle', { y: bt.y, seed: 1, bark: 'bartender', alts: ['idle', 'talk_group', 'idle'], noStep: true, stay: true, role: 'bartender', kit: { propL: null } });
          if (A('barStool4')) onStool(A('barStool4'), 'patron_m', 11, 1, 0); if (A('barStool6')) onStool(A('barStool6'), 'local_f', 26, 3, 1);
          const tb = A('barTable1'); if (tb) { const tx = tb.x + .78, tz = tb.z - .1; add('bar', 'patron_f', tx + .8, tz + .05, -HPI, 'talk_group', { y: tb.y, seed: 2, look: 'mates', hold: true, bark: 'idle', noStep: true, stay: true, tgrp: 1 }); add('bar', 'patron_m', tx + .05, tz + .68, PI, 'drink', { y: tb.y, seed: 6, look: 'mates', bark: 'idle', noStep: true, stay: true, tgrp: 1 }); }
          add('bar', 'patron_f', s.x + 5.5, s.z + .5, -HPI + .3, 'dance', { seed: 9, variant: 1, hold: true, bark: 'idle', pri: 2 }); }
        else { let p = P(-.2, -1.55); add('bar', 'bartender', p[0], p[1], s.h, 'idle', { seed: 1, bark: 'bartender', alts: ['idle', 'talk_group'], noStep: true, stay: true, role: 'bartender', pri: hasHang ? 9 : 1 });
          p = P(1.9, 2.3); const q = P(.75, 2.75); add('bar', 'patron_f', p[0], p[1], face(p[0], p[1], q[0], q[1]), 'talk_group', { seed: 2, look: 'mates', hold: true, bark: 'idle' }); add('bar', 'patron_m', q[0], q[1], face(q[0], q[1], p[0], p[1]), 'drink', { seed: 6, look: 'mates', bark: 'idle' });
          p = P(-1.9, 2.9); add('bar', 'patron_f', p[0], p[1], s.h + PI + .4, 'dance', { seed: 9, variant: 1, hold: true, bark: 'idle' });
          p = P(-2.6, 1.7); add('bar', 'patron_m', p[0], p[1], s.h + PI - .5, 'phone_look', { seed: 11, pri: 3, alts: ['phone_look', 'drink', 'idle'], hold: true }); } } }
    /* ---- 5. half-court: kids playing two-on-one, one on the bleachers */
    { const s = spot('court', ['courtCentre'], { x: -34, z: -60 }); if (s) { const hoop = anc(['hoop']) || { x: s.x, z: s.z - 6.6, y: 3.05, floorY: undefined }, bench = anc(['courtBench']), y = hoop.floorY;
        const a = [s.x - 2.6, s.z + 1.3], b = [s.x + 2.3, s.z + 2.9], c = [s.x + 1.6, s.z - 2.2], dist = p => Math.hypot(hoop.x - p[0], hoop.z - p[1]);
        add('court', 'baller', a[0], a[1], face(a[0], a[1], hoop.x, hoop.z), 'shoot_hoop', { y, seed: 2, dist: dist(a), bark: 'baller', noStep: true, look: [hoop.x, (hoop.y || 3.05), hoop.z] });
        add('court', 'baller', b[0], b[1], face(b[0], b[1], c[0], c[1]), 'dribble', { y, seed: 5, bark: 'baller', noStep: true, look: 'mates' });
        add('court', 'baller', c[0], c[1], face(c[0], c[1], b[0], b[1]), 'idle', { y, seed: 8, kit: { aux: null, propL: null }, alts: ['idle', 'cheer', 'stretch', 'idle'], look: 'mates', bark: 'baller' });
        if (bench) add('court', 'baller', bench.x + sin(bench.h || 0) * .2 + .55 * cos(bench.h || 0), bench.z + cos(bench.h || 0) * .2 - .55 * sin(bench.h || 0), bench.h || 0, 'sit_bench', { y: y !== undefined ? y : undefined, seat: y !== undefined ? bench.y - y : .46, seed: 12, variant: 1, pri: 2, kit: { aux: null, propL: null }, noStep: true, look: [s.x, 1.2, s.z] }); } }
    /* ---- 6. outdoor gym */
    { const s = spot('gym', ['gymCentre'], { x: -30, z: -20 }); if (s) { const a = [s.x + 1.3, s.z + .35];
        add('gym', 'lifter', a[0], a[1], -HPI, 'lift', { seed: 1, sync: 'gym', bark: 'lifter', noStep: true, alts: ['lift', 'lift', 'idle'] });
        add('gym', 'lifter', a[0] + .78, a[1], -HPI, 'spot', { seed: 4, sync: 'gym', bark: 'lifter', noStep: true, altsFollow: true, kit: { aux: null } });
        if (hasHang) add('gym', 'jogger_m', s.x + 3.12, s.z + 2.35, -HPI, 'sit_bench', { seat: .5, seed: 7, variant: 1, pri: 3, noStep: true, look: [a[0], 1.4, a[1]] });
        else add('gym', 'jogger', s.x + 2.4, s.z + 2.6, -HPI - .5, 'stretch', { seed: 7, pri: 3 }); } }
    /* ---- 7. pier angler */
    { const s = spot('pier', ['fishSpot1', 'pierFish', 'fishSpot', 'pierAngler'], { x: -31.5, z: 79.25, y: .16, h: 0 }); if (s) { const far = Math.hypot(s.x + 9, s.z - 78) < 1;   // only the road module's 'pier' anchor (the pier mouth): walk out along the deck
        const x = far ? -31.5 : s.x + (s.h === undefined ? 0 : -cos(s.h) * 1.6), z = far ? 79.25 : s.z + (s.h === undefined ? 0 : sin(s.h) * 1.6);
        add('pier', 'angler', x, z, s.h || 0, 'fish', { y: s.y !== undefined ? s.y : .16, seed: 2, bark: 'angler', noStep: true, stay: true }); } }
    /* ---- 8. lifeguard off duty by the tower */
    { const t = anc(['lifeguardTower']) || { x: -36, z: 25 }, s = spot('lifeguard', [], { x: t.x + 2.9, z: t.z - 2.9 }); if (s) add('lifeguard', 'lifeguard', s.x, s.z, -HPI - .3, 'drink', { seed: 3, bark: 'lifeguard', alts: ['drink', 'idle', 'phone_look'], look: [-80, 0, s.z + 6] }); }
    /* ---- 9. sand: sunbathers on towels, someone sitting by a cooler */
    { const s = spot('sand', [], { x: -22.5, z: 4 }); if (s) {
        add('sand', 'beach_f', s.x, s.z, HPI + .12, 'sunbathe', { seed: 4, variant: 0, noStep: true, towel: 0xc2413a, kit: { tote: null, towel: null } });
        add('sand', 'beach_m', s.x + .35, s.z + 2.05, HPI - .1, 'sunbathe', { seed: 7, variant: 1, noStep: true, towel: 0x1f6a8a, pri: 2, kit: { towel: null } });
        add('sand', 'beach_f', s.x + 2.3, s.z - .9, -HPI + .3, 'sit_ground', { seed: 10, variant: 2, noStep: true, cooler: true, look: [-80, 0, s.z], kit: { tote: null, towel: null } }); } }
    /* ---- 10. a couple on the sea wall watching the sun go down */
    { const s = spot('seawall', [], { x: -10.37, z: 27.2, y: .42 }); if (s) {
        add('seawall', 'local_f', s.x, s.z, -HPI, 'sit_bench', { y: s.y, seat: 0, seed: 15, variant: 0, noStep: true, look: [-90, 2, s.z + 4], bark: 'couple', kit: { tote: null } });
        add('seawall', 'local_m', s.x, s.z + .6, -HPI, 'sit_bench', { y: s.y, seat: 0, seed: 17, variant: 1, noStep: true, look: [-90, 2, s.z - 6], bark: 'couple', kit: { backpack: null, sling: null } }); } }
    /* ---- 11. street musician on the promenade + a listener on the bench */
    { const s = spot('musician', ['busker'], { x: -9.52, z: 9.6, y: .14, h: HPI - .3 }); if (s) {
        add('musician', 'musician', s.x, s.z, s.h, 'play_guitar', { y: s.y, seed: 1, bark: 'musician', noStep: true, guitarCase: true, role: 'musician' });
        add('musician', 'tourist_f', -9.09, 6.35, HPI, 'sit_bench', { y: .14, seat: .465, seed: 3, variant: 0, noStep: true, look: [s.x, 1.4, s.z], pri: 2, kit: { tote: null } });
        add('musician', 'local_m', s.x + 1.05, s.z + 1.75, face(s.x + 1.05, s.z + 1.75, s.x, s.z), 'film', { y: .14, seed: 30, pri: 3, alts: ['film', 'idle', 'dance'], look: [s.x, 1.3, s.z], brave: 1 }); } }
    /* ---- 12. old locals in guayaberas on a promenade bench */
    { const s = spot('locals', [], { x: -9.09, z: 52, y: .14 }); if (s) {
        add('locals', 'oldman', s.x, s.z - .42, HPI, 'sit_bench', { y: s.y, seat: .465, seed: 1, variant: 2, noStep: true, bark: 'oldman', look: 'mates' });
        add('locals', 'oldman', s.x + .72, s.z + .95, -HPI - .75, 'talk_group', { y: s.y, seed: 2, bark: 'oldman', look: 'mates' }); } }
    /* ---- 13. motel: a guest on the upper walkway rail, feet in the pool, someone by the pool gate, security */
    { const M = GT.L.motel, s = spot('motel', [], { x: M.pool.x, z: M.pool.z }); if (s) { const fh = M.floorH || 3.1, gate = anc(['motelPoolGate']);
        add('motel', 'guest', M.wingE.x0 - 1.52, 71.5, -HPI, 'lean_rail', { y: .14 + fh, seed: 2, variant: 1, hold: true, noStep: true, bark: 'guest', look: [20, 2, 66] });
        add('motel', 'beach_f', s.x + M.pool.w / 2 - .06, s.z + 1.4, -HPI, 'sit_bench', { y: .14, seat: 0, seed: 5, variant: 0, noStep: true, kit: { tote: null, towel: null }, bark: 'guest' });
        add('motel', 'guest', s.x + M.pool.w / 2 + 1.5, s.z - 1.6, -HPI + .4, 'drink', { y: .14, seed: 8, pri: 3, bark: 'guest', alts: ['drink', 'phone_look'] });
        const g = gate ? [gate.x + 1.6, gate.z - 1.2] : [s.x + 7.4, s.z - 7.2]; add('motel', 'guard', g[0], g[1], PI + .3, 'idle', { seed: 1, variant: 2, bark: 'guard', role: 'guard', brave: 1, pri: 2 }); } }
    /* ---- 14. taco truck: the cook on a smoke break, a customer at a standing table */
    { const t = anc(['tacoTruck']) || { x: 109, z: -25 }, s = spot('taco', [], { x: t.x, z: t.z }); if (s) {
        add('taco', 'cook', s.x - 3.9, s.z + .9, PI - .5, 'smoke', { seed: 1, bark: 'cook', pri: 3, kit: { propR2: null } });
        add('taco', 'local_m', s.x - 1.75, s.z - 2.5, HPI + .9, 'drink', { seed: 40, pri: 4, hold: true, kit: { propL: 'can' } }); } }
    /* ---- 15. bus stop */
    { const b = anc(['busStop']) || { x: 11.15, z: 34.6 }, s = spot('busstop', [], { x: b.x, z: b.z }); if (s) add('busstop', 'oldwoman', s.x + .44, s.z - .55, -HPI, 'sit_bench', { y: .18, seat: .42, seed: 2, variant: 0, noStep: true, pri: 4, kit: { tote: null } }); }
    /* ---- 16. backyard wrestling (only when the ring exists or a spot is given) */
    { const s = spot('ring', ['ringCentre', 'ring', 'wrestleRing', 'ringCenter'], null); if (s) { const y = s.y, h = s.h || 0, P = (lx, lz) => loc({ x: s.x, z: s.z, h }, lx, lz), a = P(-.4, 0), b = P(.4, 0);
        add('ring', 'wrestler', a[0], a[1], face(a[0], a[1], b[0], b[1]), 'wrestle_a', { y, seed: 1, sync: 'ring', noStep: true, brave: 1, pri: 0 }); add('ring', 'wrestler', b[0], b[1], face(b[0], b[1], a[0], a[1]), 'wrestle_b', { y, seed: 4, sync: 'ring', noStep: true, brave: 1, pri: 0 });
        const R = s.r || (s.size ? s.size / 2 + 2.1 : 4.3); [['local_m', 'cheer', 50, PI / 4 + .12], ['patron_m', 'film', 51, 3 * PI / 4 - .1], ['local_f', 'cheer', 52, -3 * PI / 4 + .15], ['skater', 'drink', 53, -PI / 4 - .1]].forEach((q, i) => { const p = P(sin(q[3]) * R, cos(q[3]) * R); add('ring', q[0], p[0], p[1], face(p[0], p[1], s.x, s.z), q[1], { seed: q[2], pri: 0, look: [s.x, (y || 0) + 1.2, s.z], bark: 'cheer', alts: [q[1], 'cheer', 'film'], hold: true, brave: 1 }); }); } }
    /* ---- 16b. shop-front corner (vending machines on the store's south wall) — only when the hangouts corner exists or a spot is given */
    { const cb = anc(['cornerBench']), vd = anc(['vendClaw', 'vendSnack', 'vendDrink']), s = spot('corner', [], cb || vd ? { x: cb ? cb.x : vd.x + 2.7, z: cb ? cb.z : vd.z + 1.1, y: vd && vd.y !== undefined ? vd.y : .15, h: cb && cb.h !== undefined ? cb.h : PI, seatY: cb ? cb.y : undefined } : null); if (s) { const y = s.y !== undefined && s.y < .4 ? s.y : .15, fx = sin(s.h), fz = cos(s.h), lx = cos(s.h), lz = -sin(s.h);
        if (s.seatY !== undefined) add('corner', 'local_f', s.x + fx * .2 + lx * .5, s.z + fz * .2 + lz * .5, s.h, 'sit_bench', { y, seat: clamp(s.seatY - y, .3, .6), seed: 41, variant: 0, noStep: true, bark: 'idle', look: 'mates', tgrp: 2 });
        add('corner', 'local_m', s.x + fx * 1.75 + lx * .15, s.z + fz * 1.75 + lz * .15, s.h + PI + .2, 'talk_group', { y, seed: 44, look: 'mates', kit: { propL: 'can', canCol: 0xd8a02c }, hold: true, bark: 'idle', tgrp: 2 });
        add('corner', 'skater', s.x - lx * 1.85 + fx * .02, s.z - lz * 1.85 + fz * .02 - .0, s.h, 'lean_wall', { y, seed: 47, variant: 1, pri: 3, alts: ['lean_wall', 'phone_look'], noStep: true, kit: { aux: null } }); } }
    /* ---- 17. walkers: jogger + skater + a tourist couple on the promenade, a delivery rider and a local on the east sidewalk */
    if (!skip.includes('walkers') && spotsO.walkers !== false) { const prom = (x, z0, z1) => ({ pts: [[x, z0], [x, z1]] });
      add('walkers', 'jogger', -7.9, -18, 0, 'jog', { seed: 3, speed: 2.9, path: prom(-7.9, -128, 132), bark: 'jogger' });
      add('walkers', 'skater', -8.2, 44, PI, 'skate', { seed: 6, speed: 3.4, path: prom(-8.2, -110, 118), bark: 'skater', pri: 2 });
      add('walkers', 'tourist', -7.85, -34, 0, 'walk', { seed: 5, speed: 1.05, path: Object.assign(prom(-7.85, -70, 70), { stops: [{ z: 20, t: 9, state: 'film', look: [-90, 3, 30] }, { z: -30, t: 6, state: 'point', look: [-90, 2, -20] }] }), bark: 'tourist', mate: 1 });
      add('walkers', 'tourist_f', -8.47, -34.3, 0, 'walk', { seed: 2, speed: 1.05, follow: true, bark: 'tourist' });
      add('walkers', 'rider', 9.25, -60, 0, 'scoot', { seed: 1, speed: 4.4, path: { pts: [[9.25, -140], [9.25, 140]] }, bark: 'rider', pri: 2 });
      add('walkers', 'local_f', 8.7, 30, PI, 'walk', { seed: 33, speed: 1.3, path: { pts: [[8.7, 112], [8.7, -52]], stops: [{ z: 2, t: 7, state: 'phone_look' }] }, pri: 3 }); }
    if (opts.extra) for (const e of opts.extra) defs.push(Object.assign({ group: 'extra', type: 'local_m', x: 0, z: 0, h: 0, state: 'idle', pri: 0, seed: defs.length * 7 + 3 }, e));

    /* ---- instantiate (highest priority first up to opts.max) */
    const max = (opts.max || 38) + defs.filter(d => d.group === 'ring').length, order = defs.map((d, i) => [d, i]).sort((a, b) => (a[0].pri - b[0].pri) || (a[1] - b[1])).slice(0, max).sort((a, b) => a[1] - b[1]).map(a => a[0]);
    const list = [], groups = {}, clocks = {}, tmpV = new T.Vector3();
    for (const d of order) { const kit = d.kit ? Object.keys(d.kit).reduce((o, k2) => { o[k2] = d.kit[k2] === null ? undefined : d.kit[k2]; return o; }, {}) : undefined;
      const fig = make(d.type, { seed: d.seed, kit, hold: d.hold, variant: d.variant, seat: d.seat, dist: d.dist }), y = d.y !== undefined ? d.y : ground(d.x, d.z);
      const n = { id: list.length, def: d, fig, group: fig.group, type: d.type, role: d.role || d.bark || d.type, grp: d.group, x: d.x, y, z: d.z, h: d.h, home: { x: d.x, y, z: d.z, h: d.h }, state: d.state, base: d.state, mode: d.path || d.follow ? 'path' : 'home', t: rng() * 20, altT: 8 + rng() * 14, lookT: 0, stare: 0, ox: 0, oz: 0,
        brave: d.brave !== undefined ? d.brave : rng(), lookAt: null, look: new T.Vector3(), acc: 0, lod: 0, dist: 0, barkT: -99, react: null, reactT: 0, fleeH: 0, seated: /^sit_|sunbathe|lean_rail|sit$/.test(d.state) || !!d.stay, fixedY: d.y !== undefined, speed: 0, wait: 0, dir: 1, seg: 0, stopI: -1, side: 0, lastBark: null, vis: true };
      if (d.path) { const p = d.path.pts; n.seg = 0; n.dir = (d.h > HPI || d.h < -HPI) ? (p[1][1] < p[0][1] ? 1 : -1) : (p[1][1] > p[0][1] ? 1 : -1); }
      fig.group.position.set(n.x, n.y, n.z); fig.group.rotation.y = n.h; root.add(fig.group); list.push(n); (groups[d.group] = groups[d.group] || []).push(n); }
    for (const n of list) { n.mates = groups[n.grp].filter(m => m !== n && m.def.tgrp === n.def.tgrp && (m.def.look === 'mates' || m.def.state === 'talk_group') ); if (n.def.follow) { n.leader = groups[n.grp].find(m => m.def.mate) || null; if (!n.leader) n.mode = 'home'; } }

    /* ---- small props that belong to the people: towels, a cooler, the busker's open case */
    let props = null;
    if (opts.props !== false && GT.kit) { const k = GT.kit(), col = (name, c) => GT.mat(name, { color: c });
      for (const n of list) { const d = n.def, c = cos(n.h), s = sin(n.h);
        if (d.towel) { const back = d.variant !== 1, o = back ? .08 : -.08; k.push(n.x + s * o, n.y, n.z + c * o, { ry: n.h + (rng() - .5) * .08 }); k.box(col('fabric_dark', d.towel), .86, .012, 1.92, 0, .008, 0, { bevel: .004 }); for (const zz of [-.7, -.35, 0, .35, .7]) k.box(col('fabric_dark', 0xe6e2d6), .86, .013, .07, 0, .0085, zz); k.box(col('plastic_white', 0x3a7a9a), .09, .2, .09, .5, .1, -.6, { bevel: .03 }); k.pop(); }
        if (d.cooler) { k.push(n.x - c * .75, n.y, n.z + s * .75, { ry: n.h + .4 }); k.box(col('plastic_white', 0x2a6a9a), .56, .32, .34, 0, .17, 0, { bevel: .03 }); k.box('plastic_white', .58, .06, .36, 0, .36, 0, { bevel: .02 }); k.box('plastic_white', .3, .02, .04, 0, .4, 0, { bevel: .008 }); k.pop();
          k.push(n.x + c * .2, n.y, n.z - s * .2, { ry: n.h }); k.box(col('fabric_dark', 0xd89a2c), 1.5, .012, 1.3, 0, .008, -.3, { bevel: .004 }); k.pop(); }
        if (d.guitarCase) { k.push(n.x + s * .78 + c * .3, n.y, n.z + c * .78 - s * .3, { ry: n.h + 1.35 }); k.box('leather_black', .42, .1, 1.08, 0, .05, 0, { bevel: .03 }); k.box(col('fabric_dark', 0x7a1f28), .36, .02, 1.0, 0, .095, 0); k.box('leather_black', .42, .045, 1.08, -.44, .05, 0, { bevel: .015, rz: .12 }); k.box(col('fabric_dark', 0x7a1f28), .36, .02, 1.0, -.44, .075, 0, { rz: .12 });
          for (let i = 0; i < 9; i++) k.cyl(i % 3 ? 'metal_galv' : col('metal_galv', 0xb89a48), .012, .012, .003, (rng() - .5) * .22, .108, (rng() - .5) * .6, { seg: 8 }); k.box(col('plastic_white', 0x9aa88a), .07, .003, .15, .05, .108, .2, { ry: .6 }); k.box(col('plastic_white', 0x9aa88a), .07, .003, .15, -.06, .109, -.15, { ry: -.3 }); k.pop(); } }
      props = k.build(); props.name = 'people_props'; root.add(props); }

    /* ---- helpers */
    const boxes = () => W.boxes;
    const blocked = (x, z, r) => { const B = boxes(); for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.h > .35 && x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return true; } return false; };
    const turn = (n, th, rate, dt) => { n.h += GT.angDiff(n.h, th) * Math.min(1, dt * rate); };
    /** steer toward (tx, tz) around world boxes; returns distance left */
    function moveTo(n, tx, tz, sp, dt) { const dx = tx - n.x, dz = tz - n.z, d = Math.hypot(dx, dz); if (d < .05) return d; let th = Math.atan2(dx, dz), ok = false;
      for (const o of [0, .45, -.45, .9, -.9, 1.5, -1.5, 2.2, -2.2]) { const a = th + o * (n.side || 1), px = n.x + sin(a) * .55, pz = n.z + cos(a) * .55; if (!blocked(px, pz, .32)) { th = a; ok = true; if (o) n.side = Math.sign(o) * (n.side || 1); break; } }
      turn(n, th, 7, dt); if (ok) { const st = Math.min(d, sp * dt) * Math.max(.2, cos(GT.angDiff(n.h, th))); n.x += sin(n.h) * st; n.z += cos(n.h) * st; } const gy = n.fixedY && (n.def.path || Math.hypot(n.x - n.home.x, n.z - n.home.z) < 1.9) ? n.home.y : ground(n.x, n.z); n.y += (gy - n.y) * Math.min(1, dt * 12); return d; }
    let lastBarkT = -9, T0 = 0, frame = 0, ambT = 4 + rng() * 4; const alerts = [], P = { x: 0, y: 0, z: 0, h: null, speed: 0, inCar: false, px: null, pz: null };
    function say(n, cat, force) { const L = lines[cat] || lines.idle; if (!L || !L.length) return null; if (!force && (T0 - lastBarkT < 2.2 || T0 - n.barkT < 8)) return null; const text = L[(rng() * L.length) | 0]; lastBarkT = T0; n.barkT = T0; n.lastBark = { text, t: T0, cat }; if (opts.onBark) { try { opts.onBark(n, text, cat); } catch (e) { console.warn('[people] onBark threw', e); } } return text; }
    function emit(type, x, z, r, ttl) { alerts.push({ type, x, z, r: r || (type === 'siren' ? 55 : type === 'crash' ? 32 : type === 'fight' ? 14 : 26), until: T0 + (ttl || (type === 'crash' ? 9 : type === 'siren' ? 4 : 5)), born: T0, held: false }); }
    const SEV = { gunshot: 4, gunpoint: 3, crash: 2, fight: 1, siren: 0 };
    function alertFor(n) { let best = null, bs = -1; for (const a of alerts) { const d = Math.hypot(a.x - n.x, a.z - n.z); if (d > a.r) continue; const s = SEV[a.type] === undefined ? 1 : SEV[a.type]; if (s > bs) { bs = s; best = a; best._d = d; } } return best; }
    function startReact(n, a) { const d = a._d, calm = n.role === 'guard', scared = a.type === 'gunpoint' || a.type === 'gunshot'; let r;
      if (n.grp === 'ring' && n.base.startsWith('wrestle') && !scared) return;
      if (scared) r = calm ? 'point' : (n.seated && d < 9) || d < 3.5 ? 'cower' : (n.brave > .72 && d > 8) ? 'film' : 'flee';
      else if (a.type === 'crash') r = d < 7 && !n.seated ? 'startle' : n.brave > .55 ? 'film' : n.brave > .3 ? 'point' : 'look';
      else if (a.type === 'fight') r = n.brave > .5 ? 'film' : n.brave > .2 ? 'cheer' : 'look';
      else r = n.brave > .8 ? 'film' : n.brave > .6 ? 'point' : 'look';
      if (n.seated && (r === 'flee' || r === 'startle')) r = scared ? 'cower' : 'look';
      n.react = r; n.reactA = a; n.reactT = 0; n.mode = 'react'; n.fleeT = 4.5 + rng() * 3.5; n.fleeH = Math.atan2(n.x - a.x, n.z - a.z) + (rng() - .5) * .9; n.delay = .15 + rng() * .7;
      const cat = r === 'flee' || r === 'startle' ? (a.type === 'crash' ? 'crash' : 'flee') : r === 'cower' ? 'cower' : r === 'film' ? 'film' : a.type === 'siren' ? 'siren' : a.type === 'crash' ? 'crash' : a.type === 'fight' ? 'cheer' : null; if (cat && n.dist < 30) say(n, cat); }
    /** one NPC, one (possibly coarse) step */
    function brain(n, dt) { const d = n.def; n.t += dt; n.lookAt = null; let state = n.base, speed = 0, speak, seat; const pd = n.dist, a = alertFor(n);
      if (a && n.mode !== 'react' && (n.reactA !== a)) startReact(n, a);
      if (n.mode === 'react') { const A = n.reactA, live = alerts.includes(A); n.reactT += dt; n.look.set(A.x, n.y + 1.3, A.z); const r = n.react;
        if (n.reactT < n.delay) { state = n.state; n.lookAt = n.look; }
        else if (r === 'flee' || r === 'startle') { const T1 = r === 'startle' ? 1.6 : n.fleeT; if (n.reactT < n.delay + T1) { state = 'flee'; speed = 4.6 + n.brave; moveTo(n, n.x + sin(n.fleeH) * 6, n.z + cos(n.fleeH) * 6, speed, dt); }
          else { state = r === 'startle' ? (n.brave > .5 ? 'film' : 'point') : (n.brave < .3 ? 'cower' : 'phone_call'); turn(n, Math.atan2(A.x - n.x, A.z - n.z), 5, dt); n.lookAt = n.look; } }
        else { state = r === 'look' ? (n.seated ? n.base : 'idle') : r; if (!n.seated) turn(n, Math.atan2(A.x - n.x, A.z - n.z), 4, dt); n.lookAt = n.look; if (n.seated && r !== 'cower') state = n.base; }
        if (!live && T0 > A.until + 2.5 + n.brave * 3) { n.mode = (Math.hypot(n.x - n.home.x, n.z - n.home.z) > .3 || d.path || d.follow) ? 'return' : 'home'; n.react = null; }
        n.state = state; n.speed = speed; return; }
      if (n.mode === 'return') { if (d.path || d.follow) { n.mode = 'path'; } else { const left = moveTo(n, n.home.x, n.home.z, 1.35, dt); n.state = 'walk'; n.speed = 1.35; if (left < .12) { n.mode = 'home'; n.x = n.home.x; n.z = n.home.z; } return; } }
      if (n.mode === 'path') { let sp = d.speed || 1.2;
        if (n.leader) { const L = n.leader, c = cos(L.h), s = sin(L.h), tx = L.x - c * .62 - s * .25, tz = L.z + s * .62 - c * .25, left = Math.hypot(tx - n.x, tz - n.z); if (L.wait > 0 && left < .5) { state = L.state === 'walk' ? 'idle' : (L.state === 'film' ? 'phone_look' : 'idle'); turn(n, L.h + .5, 3, dt); n.lookAt = L.lookAt; }
          else { sp = clamp(left * 2.2, .5, 2.2); moveTo(n, tx, tz, sp, dt); state = 'walk'; speed = sp; } }
        else if (n.wait > 0) { n.wait -= dt; const stp = n.stop; state = stp && stp.state || d.path.waitState || 'idle'; if (stp && stp.look) { n.look.set(stp.look[0], stp.look[1], stp.look[2]); n.lookAt = n.look; turn(n, Math.atan2(stp.look[0] - n.x, stp.look[2] - n.z), 3, dt); } if (d.state === 'carry_box') state = 'carry_box'; }
        else { const pts = d.path.pts, tg = n.dir > 0 ? pts[1] : pts[0]; let tx = tg[0], tz = tg[1];
          // step around the player
          { const fx = sin(n.h), fz = cos(n.h); let ox = 0, oz = 0, od = 9, isP = false; if (!P.inCar && pd < 2.6) { ox = P.x; oz = P.z; od = pd; isP = true; }
            for (const m of list) { if (m === n || m === n.leader || m.leader === n) continue; const dd = Math.hypot(m.x - n.x, m.z - n.z); if (dd < od && dd < 2.2 && ((m.x - n.x) * fx + (m.z - n.z) * fz) > 0) { ox = m.x; oz = m.z; od = dd; isP = false; } }
            if (od < 9) { const rx = ox - n.x, rz = oz - n.z, ahead = rx * fx + rz * fz, lat = rx * fz - rz * fx; if (ahead > -.2 && abs(lat) < .75) { const sgn = lat > 0 ? -1 : 1; tx = n.x + fx * 1.5 + fz * sgn * 1.0; tz = n.z + fz * 1.5 - fx * sgn * 1.0; if (od < .9) sp *= .5; if (isP && od < 1.6) say(n, 'aside'); } } }
          const left = moveTo(n, tx, tz, sp, dt); state = d.state; speed = sp; if (Math.hypot(tg[0] - n.x, tg[1] - n.z) < .6) { n.dir = -n.dir; if (d.path.wait) n.wait = d.path.wait[0] + rng() * (d.path.wait[1] - d.path.wait[0]); n.stop = null; }
          if (d.path.stops) for (let i = 0; i < d.path.stops.length; i++) { const sp2 = d.path.stops[i]; if (abs(n.z - sp2.z) < .5 && n.stopI !== i) { n.stopI = i; n.wait = sp2.t * (.7 + rng() * .6); n.stop = sp2; } else if (n.stopI === i && abs(n.z - sp2.z) > 6) n.stopI = -1; } }
        if (pd < 5 && P.speed > 3.2 && !P.inCar) n.lookT = 1.5; }
      else {   // home: ambient behaviour, alternates, turn-taking
        if (d.alts && !d.altsFollow) { n.altT -= dt; if (n.altT <= 0) { n.altT = 9 + rng() * 16; n.base = d.alts[(rng() * d.alts.length) | 0]; } }
        if (d.altsFollow) { const L = groups[n.grp].find(m => m.def.state === 'lift'); if (L) n.base = L.base === 'lift' ? 'spot' : 'idle'; }
        state = n.base;
        if (state === 'talk_group' || (d.look === 'mates' && n.mates.length)) { const G = [n].concat(n.mates).sort((u, v) => u.id - v.id), ck = clocks[n.grp] || 0, turnI = Math.floor(ck / 4.6) % G.length, me = G.indexOf(n), ph = (ck / 4.6) % 1; speak = me === turnI ? sm(ph, .02, .16) * (1 - sm(ph, .82, .97)) : 0;
          const tgt = me === turnI ? G[(me + 1 + Math.floor(ck / 9.2)) % G.length] : G[turnI]; if (tgt && tgt !== n) { n.look.set(tgt.x, tgt.y + (tgt.seated ? 1.05 : 1.55), tgt.z); n.lookAt = n.look; } }
        else if (Array.isArray(d.look)) { n.look.set(d.look[0], d.look[1], d.look[2]); n.lookAt = n.look; }
        // the player: stare-backs, shrugs, stepping aside
        if (!P.inCar) { const facing = P.h === null ? pd < 1.9 : (pd < 2.6 && abs(GT.angDiff(P.h, Math.atan2(n.x - P.x, n.z - P.z))) < .6); if (facing && P.speed < .5) { n.stare += dt; if (n.stare > 2.2) { n.lookT = .6; if (n.stare > 2.6 && T0 - (n.stareT || -99) > 22 && say(n, n.def.bark && rng() < .45 ? n.def.bark : 'stare')) n.stareT = T0; } if (n.stare > 7 && n.stare < 10 && !n.seated && !d.noStep) state = 'shrug'; } else n.stare = Math.max(0, n.stare - dt * 2);
          if (pd < 5 && P.speed > 3.2) { if (n.lookT <= 0 && pd < 3) say(n, 'run'); n.lookT = 2.4; }
          if (!n.seated && !d.noStep) { let tx = 0, tz = 0; if (pd < .95) { const k = (1.05 - pd) / Math.max(pd, .2); tx = (n.home.x - P.x) * k; tz = (n.home.z - P.z) * k; const l = Math.hypot(tx, tz); if (l > .8) { tx *= .8 / l; tz *= .8 / l; } if (blocked(n.home.x + tx, n.home.z + tz, .3)) { tx = 0; tz = 0; } else if (abs(n.ox) + abs(n.oz) < .05) say(n, 'aside'); }
            else if (pd < 2.2) { tx = n.ox; tz = n.oz; } const k2 = Math.min(1, dt * 3.5); n.ox += (tx - n.ox) * k2; n.oz += (tz - n.oz) * k2; n.x = n.home.x + n.ox; n.z = n.home.z + n.oz; } }
        else if (pd < 7 && P.speed > 5) { n.lookT = 2; if (pd < 3.5) say(n, 'car'); }
        turn(n, n.home.h, 3, dt); }
      if (n.lookT > 0) { n.lookT -= dt; n.look.set(P.x, P.y + 1.55, P.z); n.lookAt = n.look; }
      n.state = state; n.speed = speed; n.speak = speak; }
    function update(dt, playerPos, events) { dt = clamp(dt || 0, 0, .1); T0 += dt; frame++;
      if (playerPos) { P.x = playerPos.x; P.z = playerPos.z; P.y = playerPos.y !== undefined && !playerPos.isVector3 ? playerPos.y : ground(P.x, P.z); if (playerPos.isVector3) P.y = Math.min(playerPos.y, P.y + .3); P.h = playerPos.h === undefined ? null : playerPos.h; P.inCar = !!playerPos.inCar;
        if (playerPos.speed !== undefined) P.speed = playerPos.speed; else if (P.px !== null && dt > 0) { const v = Math.hypot(P.x - P.px, P.z - P.pz) / dt; P.speed += (Math.min(v, 40) - P.speed) * Math.min(1, dt * 6); } P.px = P.x; P.pz = P.z; if (P.speed > 7.5) P.inCar = P.inCar || playerPos.inCar === undefined; }
      // events passed this frame refresh / create alerts; one-shots from emit() simply time out
      if (events) for (const e of events) { let a = null; for (const q of alerts) if (q.held && q.type === e.type && Math.hypot(q.x - e.x, q.z - e.z) < 12) { a = q; break; } if (a) { a.x = e.x; a.z = e.z; a.until = T0 + 1.2; } else { emit(e.type, e.x, e.z, e.r, 1.2); alerts[alerts.length - 1].held = true; } }
      for (let i = alerts.length - 1; i >= 0; i--) if (T0 > alerts[i].until) alerts.splice(i, 1);
      for (const g in groups) clocks[g] = (clocks[g] || 0) + dt;
      let vis = 0, near = 0;
      for (const n of list) { const dx = n.x - P.x, dz = n.z - P.z, d = Math.hypot(dx, dz); n.dist = d; n.acc += dt;
        if (d > lodFar) { if (n.vis) { n.group.visible = false; n.vis = false; } if (n.mode === 'path' && (frame + n.id) % 12 === 0) { brain(n, Math.min(n.acc, 1)); n.acc = 0; n.group.position.set(n.x, n.y, n.z); n.group.rotation.y = n.h; } else if (n.acc > 1) n.acc = 1; continue; }
        if (!n.vis) { n.group.visible = true; n.vis = true; } vis++; const lod = d < lodNear ? 0 : d < lodNear * 2 ? 1 : 2; if (lod !== n.lod) { n.lod = lod; } const sh = d < shadowDist; if (sh !== n.sh) { n.sh = sh; n.fig.setShadow(sh); }
        const every = lod === 0 ? 1 : lod === 1 ? 3 : 6; if (lod && (frame + n.id) % every) continue; if (!lod) near++;
        const udt = Math.min(n.acc, .25); n.acc = 0; brain(n, udt);
        n.group.position.set(n.x, n.y, n.z); n.group.rotation.y = n.h;
        n.fig.update(udt, { state: n.state, speed: n.speed, lookAt: lod < 2 ? n.lookAt : null, speak: n.speak, sync: n.def.sync ? clocks[n.grp] : undefined }); }
      // ambient chatter near the player
      ambT -= dt; if (ambT <= 0) { ambT = 5 + rng() * 7; let c = null, bd = 10; for (const n of list) if (n.mode === 'home' && n.dist < bd && n.dist > 1.2 && T0 - n.barkT > 14) { if (rng() < .5 || !c) { c = n; bd = Math.max(n.dist, 4); } } if (c && !P.inCar) say(c, c.def.bark && rng() < .6 ? c.def.bark : 'idle'); }
      api.stats.visible = vis; api.stats.near = near; api.stats.alerts = alerts.length; }
    /** re-read ground heights (call after a module that changes terrain was built later) */
    function resnap() { for (const n of list) if (!n.fixedY && n.def.y === undefined) { n.home.y = ground(n.home.x, n.home.z); if (n.mode === 'home') n.y = n.home.y; n.group.position.y = n.y; } }
    const api = { list, groups, props, root, update, emit, say: (n, cat) => say(n, cat || 'idle', true), resnap, alerts, barks: lines,
      setVisible(b) { root.visible = !!b; }, dispose() { scene.remove(root); list.length = 0; }, stats: { count: list.length, visible: 0, near: 0, alerts: 0, tris: list.reduce((s, n) => s + n.fig.tris, 0) } };
    for (const n of list) n.fig.update(0, { state: n.state, snap: true });
    return api;
  }
  GT.people.populate = populate; GT.people.barks = BARKS;
  /* ------------------------------------------------------------------ China edition barks. Every line has a voice id so audio clips can be attached later:
     dialect lines -> '<dialect>_<category>_<nn>' (cq 码头腔 / wh 江城话 / sh 洋行腔 / cs 小吃街腔 / pth 普通话), role lines -> '<role>_<nn>'. GT.people.voiceList() flattens them. */
  const BARK_CN = (function () {   /* 2026-11-17: the written street chatter was removed (the user asked for all dialogue to go; it will be rewritten). Only one- or two-word reactions are left, the same in every dialect;
       idle / stare / run / aside / film / applaud are empty lists, and say() returns null for an empty list. */
    const mk = () => ({ idle: [], stare: [], run: [], aside: [], scooter: ['看路！', '哎！'], horn: ['别按了！'], flee: ['快跑！', '出事了！', '啊——！'], gun: ['有枪！', '趴下！', '别开枪！'], film: [], applaud: [] });
    return { cq: mk(), wh: mk(), sh: mk(), cs: mk(), pth: mk() }; })();
  /** role -> [dialect, lines, optional scold lines] (lines emptied with the dialogue; a scold is one short word) */
  const ROLE_CN = {
    dance: ['wh', [], ['看路！']],
    swim: ['wh', []],
    angler: ['sh', []],
    chess: ['cq', [], ['看路！']],
    mahjong: ['cq', []],
    bird: ['sh', []],
    whip: ['cs', []],
    pengci: ['pth', ['哎哟！'], ['看路！']],
    streamer: ['pth', [], ['看路！']],
    guide: ['pth', []],
    tourist: ['pth', []],
    match: ['sh', []],
    chengguan: ['pth', ['站住！']],
    vendor: ['cs', []],
    rider: ['pth', []],
    daijia: ['pth', []],
    bangbang: ['cq', []],
    sanitation: ['wh', []],
    guard: ['pth', []],
    student: ['pth', []],
    office: ['pth', []],
    granny: ['sh', []],
    kid: ['pth', []],
    dogowner: ['pth', []],
    dog: ['pth', ['汪！', '汪汪！']],
    traffic: ['pth', ['红灯！', '走斑马线！']],
    diner: ['cs', []],
    thug: ['pth', []],
    lajie: ['cq', []],
    guaizi: ['wh', []],
    yeshu: ['sh', []],
    mange: ['cs', []],
    ertong: ['pth', []] };
  const vid = (a, b, i) => a + '_' + (b ? b + '_' : '') + (i < 9 ? '0' : '') + (i + 1);
  function voiceList() { const out = []; for (const d in BARK_CN) for (const c in BARK_CN[d]) BARK_CN[d][c].forEach((text, i) => out.push({ voice: vid(d, c, i), text, dialect: d, cat: c })); for (const r in ROLE_CN) { const R = ROLE_CN[r]; R[1].forEach((text, i) => out.push({ voice: vid(r, '', i), text, dialect: R[0], role: r })); (R[2] || []).forEach((text, i) => out.push({ voice: vid(r, 'x', i), text, dialect: R[0], role: r, cat: 'scold' })); } return out; }
  /* ------------------------------------------------------------------ populateCN: the residents of 四方街 on a daily schedule
     GT.people.populateCN(scene, opts) -> { list, groups, update(dt, playerPos, events), emit(type, x, z, r?, ttl?), say(npc, cat?), sayLine(npc, i, scold?), find(idOrRole), named,
        dance { bpm, clock, beat, setClock(t), active, dancers, leader }, queue { slots, order, tail(), hold }, pengci { state, enabled, resolve(paid) }, tour, chase,
        setGroup(name, on), setEnabled(npc|id, on), place(npc|id, {x, z, h, y?, state?}), release(npc|id), setHours(h | undefined), reschedule(), resnap(), setVisible(b), dispose(), stats, root }
     opts: { max (50), seed, hours (number | () => number; default GT.env.hours), onBark(npc, { text, voice, cat, dialect, role, name }), onEvent(type, data), groundHeight(x, z),
             spots: { <anchor name>: {x, z, h?, y?} | false, ... } (override / disable anchors and groups), only: [groups], skip: [groups], extra: [def...], lodNear (35), lodFar (120), shadowDist (40), lazy, indoor }
     groups: dance, swim, fish, chess, mahjong, queue, eat, named, thugs, tour, stream, chengguan, pengci, riders, match, walkers, kids, night.
     playerPos: { x, z, y?, h?, speed?, inCar? | vehicle? }.   events: [{ type: 'horn' | 'crash' | 'gunshot' | 'gunpoint' | 'fight' | 'siren' | 'cheer' | 'stare' | 'run_past' | 'scooter_near', x, z, r? }] every frame while active, or emit() once.
     onEvent types: 'pengci' {npc, amount}, 'pengci_end' {npc, paid}, 'dance_disrupt' {npc}, 'jaywalk' {npc}, 'chengguan_run' {vendor, officer}, 'dive' {npc}, 'queue_advance' {npc}, 'train_wow' {}. */
  const NAMES_CN = { lajie: '辣姐', guaizi: '拐子哥', yeshu: '爷叔', mange: '满哥', ertong: '二筒' };
  function populateCN(scene, opts) {
    opts = opts || {}; const W = GT.world, rng = GT.rng('populateCN:' + (opts.seed || 0)), root = new T.Group(); root.name = 'people_cn'; scene.add(root);
    const lodNear = opts.lodNear || 35, lodFar = opts.lodFar || 120, shadowDist = opts.shadowDist || 40, only = opts.only || null, skip = opts.skip || [], SO = opts.spots || {}, HPI = PI / 2, MAX = opts.max || 50;
    let hourOverride = null, danceT = 0;
    const hoursNow = () => { const h = hourOverride !== null ? hourOverride : typeof opts.hours === 'function' ? opts.hours() : opts.hours !== undefined ? opts.hours : (GT.env && typeof GT.env.hours === 'number' ? GT.env.hours : 12); return ((h % 24) + 24) % 24; };
    const RS = GT.riverside, waterY = SO.waterY !== undefined ? SO.waterY : (RS && RS.waterY !== undefined ? RS.waterY : -2);
    const ground = (x, z) => { if (opts.groundHeight) return opts.groundHeight(x, z); if (x <= -10 && RS && RS.groundHeight) return RS.groundHeight(x, z); if (GT.cnroad && GT.cnroad.groundHeight) return GT.cnroad.groundHeight(x, z); return 0; };
    const A = name => SO[name] !== undefined ? SO[name] : W.anchors[name];
    const at = (name, def) => { const a = A(name); return a === false ? def : a ? Object.assign({}, def, a) : def; };
    const on = g => !skip.includes(g) && (!only || only.includes(g)) && SO[g] !== false;
    const loc = (s, lx, lz) => { const h = s.h || 0, c = cos(h), sn = sin(h); return [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c]; };
    const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
    const evt = (type, data) => { if (opts.onEvent) { try { opts.onEvent(type, data || {}); } catch (e) { console.warn('[people] onEvent threw', e); } } };
    const defs = [], Q = { slots: [], order: [], leaving: null, period: 9, hold: false }, TOUR = { A: null, B: null, g: null, phase: 'talk', t: 18, at: 0, target: [131, 13, -6], wow: false }, CH = { loop: null, v: null, o: null, phase: 'sell', t: 0 };
    /** add(group, type, x, z, h, sched, extra). sched: [[h0, h1, state], ...] in hours (h1 may exceed 24). extra: { id, y, seat, seed, variant, kit, phone, role, dia, look: [x, yAboveFeet, z], alts, path: { pts, loop, wait, waitState, stops }, follow, speed, ctl, pri, brave, tough, noReact, noStep, stay, sync, indoor } */
    const add = (grp, type, x, z, h, sched, e) => { const d = Object.assign({ grp, type, x, z, h, sched, pri: 1, seed: (defs.length * 5 + 2) % 23 }, e); defs.push(d); return d; };

    /* 1. 广场舞: twelve on the grid + the leader. Dusk = the full formation, morning = five warming up with tai-chi, late = a small fan group */
    if (on('dance')) { const c = at('danceCentre', { x: -34, z: 30, h: -HPI }), lead = at('danceLead', { x: c.x - 7.2, z: c.z, h: c.h }); let i = 0;
      for (const dx of [-3, 0, 3]) for (const dz of [-3.3, -1.1, 1.1, 3.3]) { const s = at('danceSpot' + i, { x: c.x + dx, z: c.z + dz, h: c.h }), man = i === 5 || i === 10, st = man ? 'square_dance' : 'fan_dance', sch = [[17, 20.5, st]]; if (i < 5) sch.push([6, 9, 'taichi']); if (i % 3 === 0) sch.push([20.5, 21.5, st]);
        add('dance', man ? 'uncle' : 'auntie_dance', s.x, s.z, s.h, sch, { seed: man ? 3 + i : 1 + i * 3, role: 'dance', ctl: 'dance', pri: i < 6 ? 0 : 1, noStep: true }); i++; }   /* g6: every dancer her own seed (height, build, hair); six seeds over ten women read as one model copied */
      add('dance', 'auntie_lead', lead.x, lead.z, lead.h, [[17, 20.5, 'fan_dance'], [6, 9, 'taichi'], [20.5, 21.5, 'fan_dance']], { id: 'danceLead', seed: 1, role: 'dance', ctl: 'dance', lead: true, pri: 0, noStep: true }); }
    /* 2. 冬泳大爷: handstand on the mats -> dive -> laps with an orange float -> out again */
    if (on('swim')) { const dv = at('swimDive', { x: -65.65, z: -20, h: -HPI, y: -1.2 }); for (let i = 0; i < 3; i++) { const p = loc(dv, -3.6, -3.0 - i * .9); add('swim', 'swim_uncle', p[0], p[1], dv.h, i < 2 ? [[6, 9, 'idle'], [16.5, 19.6, 'idle']] : [[16.5, 19.6, 'idle']], { seed: i * 4 + 1, role: 'swim', ctl: 'swim', y: dv.y, k: i, pri: i ? 1 : 0, noStep: true }); } }
    /* 3. 钓鱼佬 who never catch anything */
    if (on('fish')) [[0, 60], [1, 75], [3, 108]].forEach((q, i) => { const s = at('fishSpot' + q[0], { x: -56.75, z: q[1], h: -HPI }), sit = i === 1, p = sit ? loc(s, .1, -.5) : [s.x, s.z]; add('fish', 'angler_cn', p[0], p[1], s.h, [[i === 2 ? 14 : 5.5, 20, 'fish']], { seed: i * 3 + 1, role: 'angler', seat: sit ? .41 : undefined, noStep: true, stay: true, pri: i ? 1 : 0, y: s.y }); });
    /* 4. 象棋摊: two players on the stone stools and a ring of kibitzers with their hands behind their backs */
    if (on('chess')) { const t = at('chess0', { x: -23, z: 49.4, h: -.2 }), st = s => { const a = s * HPI + .78; return [t.x + cos(a) * .95, t.z + sin(a) * .95]; }, ring = (a, r) => [t.x + cos(a) * r, t.z + sin(a) * r];
      [0, 2].forEach((s, i) => { const p = st(s); add('chess', 'chess_uncle', p[0], p[1], face(p[0], p[1], t.x, t.z), [[9, 19.5, 'chess_move']], { seed: 2 + i * 5, role: 'chess', seat: .47, noStep: true, stay: true, pri: 0, kit: { propL: undefined }, look: [t.x, .95, t.z], y: t.y }); });
      [[.78 + HPI * .5, 1.5, 'chess_uncle', 4], [.78 + HPI * 1.45, 1.62, 'bird_uncle', 2], [.78 + HPI * 2.55, 1.55, 'uncle', 7], [.78 + HPI * 3.5, 1.7, 'chess_uncle', 9]].forEach((q, i) => { const p = ring(q[0], q[1]); add('chess', q[2], p[0], p[1], face(p[0], p[1], t.x, t.z), [[i < 2 ? 9 : 10, i < 2 ? 19.5 : 17.5, 'kibitz']], { seed: q[3], role: i === 1 ? 'bird' : 'chess', variant: i, pri: i < 2 ? 0 : 1, look: [t.x, .9, t.z], kib: true, y: t.y }); }); }
    /* 5. 麻将 in the courtyard */
    if (on('mahjong')) { const m = A('mahjong0') || { x: 46.6, z: 66, h: 0, seats: [0, 1, 2, 3].map(i => ({ x: 46.6 + sin(i * HPI) * .82, z: 66 + cos(i * HPI) * .82, h: i * HPI + PI, y: .47 })) };
      (m.seats || []).slice(0, 4).forEach((s, i) => add('mahjong', i % 2 ? 'uncle' : 'auntie', s.x, s.z, s.h, [[13, 23, 'mahjong']], { seed: 3 + i * 4, role: 'mahjong', seat: clamp((s.y !== undefined ? s.y : .47) - (m.y !== undefined ? 0 : ground(s.x, s.z)), .36, .56), variant: i, sync: true, noStep: true, stay: true, pri: i < 2 ? 0 : 1, look: [m.x, .9, m.z], kit: i === 1 ? { propL: 'cig' } : undefined, y: m.y }));
      const k = loc({ x: m.x, z: m.z, h: (m.h || 0) + .8 }, 0, 1.75); add('mahjong', 'uncle', k[0], k[1], face(k[0], k[1], m.x, m.z), [[14, 22, 'kibitz']], { seed: 11, role: 'mahjong', variant: 1, pri: 2, kit: { propL: 'thermos' }, look: [m.x, .9, m.z], y: m.y }); }
    /* 6. 过早: the 热干面 queue (it really shuffles forward), people eating on the plastic stools */
    if (on('queue')) { const nd = (GT.CN && GT.CN.snack && GT.CN.snack.noodle) || { x0: 50, doorZ: -8 }; for (let i = 0; i < 6; i++) Q.slots.push(at('queueReganmian' + i, { x: nd.x0 - 2.1, z: nd.doorZ + 2.4 + i * .8, h: i === 0 ? HPI : PI }));
      ['student', 'office_m', 'auntie', 'rider_y', 'uncle'].forEach((ty, i) => add('queue', ty, Q.slots[i].x, Q.slots[i].z, Q.slots[i].h, i < 3 ? [[6, 10.5, 'queue'], [11.3, 13.3, 'queue']] : [[6, 10.5, 'queue']], { seed: 4 + i * 3, role: ty === 'rider_y' ? 'rider' : ty === 'student' ? 'student' : ty === 'office_m' ? 'office' : undefined, dia: 'wh', ctl: 'queue', variant: i, pri: i < 3 ? 0 : 1, y: Q.slots[i].y })); }
    const DK = { propL: 'bowl', propR2: 'chopsticks', keepR: true, aux: undefined, tote: undefined, backpack: undefined };
    if (on('eat')) { const seats = [], types = ['uncle', 'office_f', 'rider_b', 'student']; for (const i of [1, 4, 7, 10, 2, 5]) { const s = A('seat' + i); if (s && !s.indoor && seats.length < 4) seats.push(s); }
      if (seats.length) seats.forEach((s, i) => { const gy = s.gy !== undefined ? s.gy : ground(s.x, s.z); add('eat', types[i], s.x, s.z, s.h || 0, [[6, 10.5, 'eat_bowl'], [11.5, 13.5, 'eat_bowl'], [18, 21, 'eat_bowl']].slice(0, i < 2 ? 3 : 1), { seed: 6 + i * 2, dia: 'wh', seat: clamp((s.y !== undefined ? s.y : gy + .46) - gy, .34, .56), y: gy, noStep: true, stay: true, pri: i ? 1 : 0, kit: DK, phone: false }); });
      else [[31, -12.4, 1.2], [33.4, -3.6, -2]].forEach((p, i) => add('eat', types[i], p[0], p[1], p[2], [[6, 10.5, 'eat_bowl'], [11.5, 13.5, 'eat_bowl']], { seed: 6 + i * 2, dia: 'wh', pri: 1, kit: DK, phone: false })); }
    /* 7. the named residents at their posts (the story module moves them with place() / release()) */
    if (on('named')) { let s = A('wokCook') || at('noodleCashierStaff', { x: 58.75, z: -5, h: -HPI }); add('named', 'guaizi', s.x, s.z, s.h || 0, [[5.5, 14, 'cook'], [17, 21, 'cook']], { id: 'guaizi', role: 'guaizi', variant: 1, pri: 0, stay: true, noStep: true, brave: 1, y: s.y });
      s = at('hotpotDoor', { x: 36, z: 100, h: 0 }); add('named', 'lajie', s.x + 1.5, s.z - 1.0, PI + .25, [[10, 26, 'idle']], { id: 'lajie', role: 'lajie', pri: 0, brave: 1, alts: ['idle', 'idle', 'scold', 'talk'], variant: 2 });
      s = at('clockSteps', { x: 30, z: 134.6, h: 0 }); add('named', 'yeshu', s.x - 1.7, s.z - .5, PI - .2, [[15, 18.6, 'idle']], { id: 'yeshu', role: 'yeshu', pri: 0, brave: 1, variant: 0, noStep: true });
      s = at('mange', { x: 22, z: -65.5, h: 0 }); add('named', 'mange', s.x, s.z, s.h || 0, [[17.5, 26, 'cook']], { id: 'mange', role: 'mange', pri: 0, stay: true, noStep: true, brave: 1, variant: 0, y: s.y }); }
    if (on('thugs')) { const s = at('hotpotParking', { x: 42, z: 96.6, h: HPI }), g2 = at('wharfGate', { x: -11.8, z: -150, h: -HPI });
      [['ertong', 'smoke', 0, 0], ['thug', 'idle', 1.3, .5], ['thug', 'phone_look', -.9, 1.3]].forEach((q, i) => { const p = [s.x + 3.4 + q[2], s.z - 1.4 - q[3]], p2 = [g2.x + 1.6 + q[3], g2.z + q[2] * 1.2], id = i ? 'thug' + i : 'ertong', e = { seed: i * 5 + 1, role: i ? 'thug' : 'ertong', pri: 0, brave: 1, tough: true, variant: i * 3 + 1, kit: i === 2 ? { propR2: undefined, phone: 0x0c0d10, screen: true } : undefined };
        add('thugs', q[0], p[0], p[1], PI - .4 + i * .5, [[17, 19.6, q[1]]], Object.assign({ id }, e)); add('thugs', q[0], p2[0], p2[1], HPI + (i - 1) * .5, [[21, 26, q[1]]], Object.assign({ id: id + '_wharf' }, e)); }); }
    /* 8. 轻轨观景台: a tour group with matching caps and a flag-bearing guide, live-streamers */
    if (on('tour')) { const v = at('viewpoint', { x: 139, z: -34, h: 0 }), s2 = at('viewSpot1', { x: 128.9, z: -25.5, h: 0 }); TOUR.A = SO.tourA || { x: s2.x - 2.7, z: s2.z - 2.9 }; TOUR.B = SO.tourB || { x: v.x - 5.5, z: v.z - 3.5 }; if (SO.tourLook) TOUR.target = SO.tourLook; else if (GT.CN && GT.CN.rail) TOUR.target = [GT.CN.rail.x, GT.CN.rail.y, -6];
      add('tour', 'guide', TOUR.A.x, TOUR.A.z, PI, [[10, 17, 'tour_lead']], { id: 'guide', seed: 1, role: 'guide', ctl: 'tour', lead: true, pri: 0 });
      [[-1.3, 1.5], [-.3, 2.0], [.8, 1.6], [1.7, 2.3], [-1.9, 2.6], [.2, 3.2]].forEach((q, i) => add('tour', 'tourist_cn', TOUR.A.x + q[0], TOUR.A.z - q[1], 0, [[10, 17, 'tour_follow']], { seed: i * 2 + 1, role: 'tourist', ctl: 'tour', off: q, variant: i, pri: i < 3 ? 0 : 1, backstep: i === 1 || i === 4 })); }
    if (on('stream')) { const v = at('viewpoint', { x: 139, z: -34, h: 0 }), post = SO.ringPost || { x: 137.5, z: -35.6 }, worldRing = !!(GT.landmarks && W.anchors.viewpoint) && !SO.ringPost;
      add('stream', 'streamer_f', post.x - .1, post.z - 1.25, 0, [[10, 18.5, 'livestream']], { seed: 2, role: 'streamer', pri: 0, kit: worldRing ? { aux: undefined } : undefined, noStep: true });
      add('stream', 'streamer_m', v.x - 9.5, v.z + 4.8, .3, [[11, 18, 'film']], { seed: 3, role: 'streamer', pri: 1, alts: ['film', 'film', 'selfie', 'talk'] });
      const pr = at('swimGate', { x: -56.6, z: -20, h: -HPI }); add('stream', 'streamer_f', pr.x + 4.5, pr.z + 9, -HPI - .5, [[17, 20.5, 'selfie']], { seed: 5, role: 'streamer', pri: 1, alts: ['selfie', 'livestream', 'selfie'], kit: { aux: undefined } }); }
    /* 9. police vs the unlicensed fruit cart: a loop on the promenade; the vendor always gets away */
    if (on('chengguan')) { const L = SO.chaseLoop || [[-14, 8], [-14, -34], [-46, -36], [-46, 8]]; CH.loop = L;
      add('chengguan', 'vendor', L[0][0], L[0][1], HPI, [[10, 18, 'push_cart']], { id: 'vendor', seed: 3, role: 'vendor', ctl: 'vendor', pri: 0 });
      add('chengguan', 'chengguan', L[L.length - 1][0], L[L.length - 1][1], 0, [[10, 18, 'idle']], { id: 'chengguan', seed: 2, role: 'chengguan', ctl: 'officer', pri: 0, brave: 1 }); }
    /* 10. 碰瓷: steps out in front of anything fast, falls over without being touched, demands 五百 */
    if (on('pengci')) { const c = at('crossing0W', { x: -10.1, z: -8, h: HPI }), p = SO.pengciAt || { x: c.x - 3.2, z: c.z - 5.5 }; add('pengci', 'pengci', p.x, p.z, p.h !== undefined ? p.h : HPI, [[10, 18.5, 'idle']], { id: 'pengci', seed: 1, role: 'pengci', ctl: 'pengci', pri: 0, brave: 1, noReact: true }); }
    /* 11. riders clustered at the shop door staring at phones; 代驾 with folding bikes outside the hotpot place at night */
    if (on('riders')) { const s = at('snackRiderWait', { x: 45.6, z: -10, h: HPI });
      [['rider_y', 'squat_phone', 0, 0], ['rider_b', 'phone_look', .9, .5], ['rider_y', 'smoke_squat', -.2, 1.3], ['rider_b', 'squat_phone', 1.0, -.8]].forEach((q, i) => add('riders', q[0], s.x + q[2], s.z + q[3], (s.h || 0) + (i - 1.5) * .5, i < 3 ? [[10.5, 14, q[1]], [17, 21.5, q[1]]] : [[10.5, 14, q[1]]], { seed: i * 3 + 2, role: 'rider', variant: i, pri: i < 2 ? 0 : 1, kit: q[1] === 'smoke_squat' ? { propL: 'cig' } : undefined, alts: q[1] === 'phone_look' ? ['phone_look', 'phone_call', 'idle'] : undefined }));
      const hp = at('hotpotParking', { x: 42, z: 96.6, h: HPI }); [['squat_phone', -2.2, -.6], ['phone_look', -3.3, .3]].forEach((q, i) => add('riders', 'daijia', hp.x + q[1], hp.z + q[2], PI + i * .6, [[20, 26, q[0]]], { seed: i * 4 + 1, role: 'daijia', variant: i, pri: 1 })); }
    /* g6: the snack lane at night had every stall lit and nobody in it. Stall keepers behind the counters on both sides, people eating standing up, looking at phones and talking in the lane. Evening only. */
    if (on('lane')) { const sn = (GT.CN && GT.CN.snack) || {}, lx = (sn.lane && sn.lane.x) || 32, dz = (sn.noodle && sn.noodle.doorZ) !== undefined ? sn.noodle.doorZ : -8, keep = ['vendor', 'auntie', 'uncle', 'cook', 'vendor', 'auntie', 'uncle', 'vendor'], folk = ['student', 'office_f', 'office_m', 'rider_b', 'auntie', 'local_m', 'student', 'uncle', 'office_f', 'local_f'], acts = ['phone_look', 'eat_bowl', 'talk_group', 'idle', 'talk_group', 'phone_look', 'eat_bowl', 'idle', 'talk_group', 'talk_group'];
      keep.forEach((ty, i) => { const side = i % 2 ? 1 : -1, z = dz + 14.5 - i * 3.9; add('lane', ty, lx + side * 3.05, z, side > 0 ? -HPI : HPI, [[17.2, 25, i % 3 === 0 ? 'cook' : 'idle']], { seed: 3 + i * 5, role: 'vendor', variant: i, pri: i < 4 ? 0 : 1, noStep: true, stay: true, phone: false, alts: ['idle', 'cook', 'idle'] }); });
      folk.forEach((ty, i) => { const side = i % 2 ? 1 : -1, z = dz + 13 - i * 3.1 + (i % 3) * .5, x = lx + side * (1.15 + (i % 3) * .35), pair = acts[i] === 'talk_group'; add('lane', ty, x, z, pair ? (i % 4 < 2 ? 0 : PI) : side > 0 ? HPI : -HPI, [[17.6, 23.6, acts[i]]], { seed: 2 + i * 7, role: acts[i] === 'eat_bowl' ? 'diner' : undefined, variant: i, pri: i < 5 ? 0 : 2, kit: acts[i] === 'eat_bowl' ? DK : undefined, phone: acts[i] === 'phone_look' ? undefined : false, look: pair ? 'mates' : undefined }); }); }
    /* 12. 相亲角: parents with paper adverts */
    if (on('match')) { const m = at('matchCorner', { x: -22, z: -46, h: 0 }); [[-1.5, -2.6, HPI, .32], [1.5, .2, -HPI, .32], [-1.5, 2.4, HPI, .32], [.3, -4.3, .2, undefined]].forEach((q, i) => add('match', 'match_parent', m.x + q[0], m.z + q[1], q[2], [[9, 17, 'flyer']], { seed: i * 3 + 1, role: 'match', ctl: 'match', seat: q[3], variant: i, pri: i < 2 ? 0 : 1, noStep: q[3] !== undefined, stay: q[3] !== undefined, kit: q[3] === undefined ? { aux: undefined } : undefined })); }
    /* 13. singles and walkers */
    if (on('walkers')) { const P2 = (pts, o) => Object.assign({ pts }, o);
      add('walkers', 'bird_uncle', -16, 62, 0, [[6, 10, 'bird_walk']], { seed: 5, role: 'bird', speed: .75, path: P2([[-16, 58], [-16, 104]], { wait: [6, 10], waitState: 'bird_walk' }), pri: 0 });
      add('walkers', 'whip_uncle', -41, 56.5, -HPI + .4, [[6.5, 9.5, 'whip_top'], [16, 18, 'whip_top']], { seed: 2, role: 'whip', pri: 0, noStep: true, alts: ['whip_top', 'whip_top', 'whip_top', 'idle'] });
      add('walkers', 'sanitation', 8.9, 20, 0, [[5.5, 9, 'sweep'], [13, 15, 'sweep']], { seed: 1, role: 'sanitation', speed: .22, path: P2([[8.9, -20], [8.9, 48]]), pri: 1 });
      add('walkers', 'sanitation', -12.4, -60, PI, [[5.5, 8.5, 'sweep']], { seed: 4, role: 'sanitation', speed: .22, path: P2([[-12.4, -90], [-12.4, -52]]), pri: 1 });
      add('walkers', 'bangbang', 9.1, -30, 0, [[9, 18, 'carry_pole']], { seed: 3, role: 'bangbang', speed: 1.05, kit: { aux: 'pole_load', propL: undefined }, path: P2([[9.1, -36], [9.1, 96]], { wait: [14, 22], waitState: 'idle' }), pri: 0 });
      [[0, 0], [.75, -.5], [-.1, -1.1]].forEach((q, i) => add('walkers', 'student', -8.6 + q[0], 110 + q[1], PI, [[6.6, 8, 'walk'], [16.5, 17.8, 'walk']], Object.assign({ seed: i * 4 + 3, role: 'student', speed: 1.45, pri: 1 }, i ? { follow: 'student0', fo: q } : { id: 'student0', path: P2([[-8.6, 120], [-8.6, -44]]) })));
      add('walkers', 'office_m', 8.7, -40, 0, [[7.5, 9.5, 'walk'], [12, 13.5, 'walk'], [18, 19.5, 'walk']], { seed: 6, role: 'office', speed: 1.65, path: P2([[8.7, -50], [8.7, 128]]), pri: 1 });
      add('walkers', 'office_f', 9.3, 90, PI, [[7.6, 9.4, 'walk'], [12, 13.5, 'walk'], [18, 19.5, 'walk']], { seed: 9, role: 'office', speed: 1.5, path: P2([[9.3, 126], [9.3, 40], [9.3, -46]], { stops: [{ i: 1, t: 8, state: 'phone_look' }] }), pri: 1 });
      add('walkers', 'granny', 8.5, -30, 0, [[6, 10.5, 'pull_trolley']], { seed: 2, role: 'granny', speed: .8, path: P2([[8.5, -60], [8.5, 44]], { wait: [5, 9], waitState: 'pull_trolley' }), pri: 1 });
      add('walkers', 'granny', -12, 20, PI, [[6.5, 10, 'pull_trolley']], { seed: 7, role: 'granny', speed: .75, path: P2([[-12, 90], [-12, -30]], { wait: [5, 9], waitState: 'pull_trolley' }), pri: 2 });
      const g = at('clockSteps', { x: 30, z: 134.6, h: 0 }); add('walkers', 'guard_cn', g.x + 3.4, g.z + 1.2, PI, [[8, 24, 'idle']], { id: 'guard', seed: 3, role: 'guard', pri: 0, brave: 1, variant: 1, alts: ['idle', 'idle', 'point'] });
      const x1 = at('crossing1E', { x: 10.1, z: 62, h: -HPI }); add('walkers', 'traffic_police', x1.x - 1.7, x1.z - 1.8, -HPI, [[7, 9.6, 'traffic'], [17, 19, 'traffic']], { id: 'traffic', seed: 1, role: 'traffic', ctl: 'traffic', pri: 0, brave: 1, noStep: true }); }
    /* 14. kids on balance bikes, a dog in a tiny jacket and its owner */
    if (on('kids')) { const c = SO.kidsAt || { x: -38, z: 2 }; for (let i = 0; i < 2; i++) add('kids', 'kid', c.x + 5.5, c.z + i * 2, 0, [[15.5, 19.5, 'balance_bike']], { seed: i * 3 + 1, role: 'kid', ctl: 'kid', k: i, cx: c.x, cz: c.z, pri: 0 });
      add('kids', 'dog_owner', c.x + 9.5, c.z + 5, -HPI, [[15.5, 19.5, 'phone_look']], { id: 'dogOwner', seed: 2, role: 'dogowner', pri: 0, alts: ['phone_look', 'idle', 'drink'] });
      add('kids', 'dog', c.x + 8.6, c.z + 4.2, -HPI, [[15.5, 19.5, 'dog_idle']], { id: 'dog', seed: 1, role: 'dog', ctl: 'dog', pri: 0, brave: 1, noReact: true }); }
    /* 15. 夜市 + 火锅: eating, squatting with a cigarette, a streamer working the stalls */
    if (on('night')) { const mf = at('mangeFront', { x: 22, z: -62.9, h: PI }), mid = at('marketMid', { x: 57, z: -59.6, h: HPI });
      add('night', 'office_f', mf.x - .4, mf.z + .3, PI, [[19, 25, 'eat_bowl']], { seed: 5, role: 'diner', pri: 0, kit: DK, phone: false });
      add('night', 'tourist_cn', mf.x + 2.7, mf.z + 1.1, PI + .6, [[19, 24, 'film']], { seed: 4, role: 'tourist', pri: 1, alts: ['film', 'phone_look', 'idle'] });
      for (let i = 0; i < 2; i++) { const s = A('mangeSeat' + i) || A('bbqSeat' + i); if (s) add('night', i ? 'uncle' : 'rider_y', s.x, s.z, s.h || 0, [[19.5, 25, 'eat_bowl']], { seed: 8 + i, role: 'diner', seat: .44, noStep: true, stay: true, pri: 1, kit: DK, phone: false }); }
      const b = at('bbqFront', { x: mid.x + 6, z: mid.z - 3, h: PI }); add('night', 'uncle', b.x + 1.6, b.z + 1.2, PI - .6, [[20, 26, 'smoke_squat']], { seed: 12, pri: 1, dia: 'cs', kit: { propL: 'cig' } }); add('night', 'rider_b', b.x + 2.5, b.z + 1.0, PI + .7, [[20, 26, 'squat_phone']], { seed: 9, pri: 2, role: 'rider' });
      add('night', 'streamer_f', mid.x - 8, mid.z + 1, HPI + .6, [[19.5, 23.5, 'livestream']], { seed: 8, role: 'streamer', pri: 1 });
      for (let t = 0; t < 2; t++) { const tb = A('hotpotTable' + t); if (tb && tb.seats) tb.seats.slice(0, 2).forEach((s, i) => add('night', ['auntie', 'uncle', 'office_m', 'office_f'][t * 2 + i], s.x, s.z, s.h, [[18.5, 24, 'eat_bowl']], { seed: 3 + t * 2 + i, role: 'diner', dia: 'cq', seat: .46, y: (s.y !== undefined ? s.y : .46) - .46, noStep: true, stay: true, pri: 2, kit: DK, phone: false, indoor: true })); } }
    if (opts.extra) for (const e of opts.extra) defs.push(Object.assign({ grp: 'extra', type: 'uncle', x: 0, z: 0, h: 0, sched: [[0, 24, 'idle']], pri: 0, seed: defs.length % 23 }, e));

    /* ---- records (figures are built on first activation) */
    const list = [], groups = {}, byId = {}, clocks = {};
    const rec = d => { const R = ROLE_CN[d.role], n = { id: list.length, def: d, name: d.id || null, label: NAMES_CN[d.type] || null, type: d.type, role: d.role || d.type, grp: d.grp, dialect: d.dia || (R ? R[0] : 'pth'), fig: null, group: null, x: d.x, y: d.y !== undefined ? d.y : 0, z: d.z, h: d.h, home: { x: d.x, y: 0, z: d.z, h: d.h }, state: 'idle', base: 'idle', speed: 0, mode: 'home', active: false, enabled: true, pin: null, ent: null, vis: false, lod: 0, sh: null, dist: 999, acc: 0, t: rng() * 20, altT: 6 + rng() * 12,
        brave: d.brave !== undefined ? d.brave : rng(), seated: d.seat !== undefined || !!d.stay, fixY: d.y !== undefined, lookAt: null, look: new T.Vector3(), lookT: 0, stare: 0, barkT: -99, lastBark: null, over: null, overT: 0, ox: 0, oz: 0, react: null, reactA: null, reactT: 0, prevMode: 'home', seg: 1, dir: 1, wait: 0, stop: null, side: 0, mem: {}, snap: false, noReact: false };
      list.push(n); (groups[d.grp] = groups[d.grp] || []).push(n); if (d.id) byId[d.id] = n; return n; }; for (const d of defs) rec(d);
    const order = list.slice().sort((a, b) => (a.def.pri - b.def.pri) || (a.id - b.id));
    function spawn(n) { const d = n.def; n.fig = make(d.type, { seed: d.seed, kit: d.kit, variant: d.variant, seat: d.seat, phone: d.phone, mdFar: d.mdFar, def: d }); n.group = n.fig.group; n.group.visible = false; root.add(n.group); api.stats.spawned++; api.stats.tris += n.fig.tris; }
    const schedOf = (n, hr) => { if (n.pin) return n.pin; for (const e of n.def.sched) if ((hr >= e[0] && hr < e[1]) || (hr + 24 >= e[0] && hr + 24 < e[1])) return e; return null; };
    function activate(n, ent) { if (!n.fig) spawn(n); const d = n.def; n.active = true; n.ent = ent; n.base = ent[2]; n.state = ent[2]; n.speed = 0; n.x = d.x; n.z = d.z; n.h = d.h; n.home.x = d.x; n.home.z = d.z; n.home.h = d.h; n.home.y = n.y = d.y !== undefined ? d.y : ground(d.x, d.z); n.fixY = d.y !== undefined;
      n.mode = n.pin ? 'home' : d.ctl ? 'ctl' : (d.path || d.follow) ? 'path' : 'home'; n.react = null; n.reactA = null; n.over = null; n.mem = {}; n.seg = 1; n.dir = 1; n.wait = 0; n.snap = true; n.vis = false; n.noReact = false; n.ox = n.oz = 0; if (n.mode === 'ctl' && CTL[d.ctl].init) CTL[d.ctl].init(n); }
    function deactivate(n) { n.active = false; if (n.group) n.group.visible = false; n.vis = false; const c = CTL[n.def.ctl]; if (c && c.exit) c.exit(n); }
    let schedT = 0, firstSched = true;
    function reschedule(force) { const hr = hoursNow(), all = force || firstSched || opts.eager; let budget = all ? 999 : 2, act = 0; for (const n of list) if (n.active) act++;
      for (const n of order) { const ent = n.enabled && (!n.def.indoor || opts.indoor !== false) ? schedOf(n, hr) : null;
        if (ent && !n.active) { if (act >= MAX && n.def.pri > 0 && !n.pin) continue; if (!all && n.dist < 16) continue; if (budget-- <= 0) break; activate(n, ent); act++; }
        else if (!ent && n.active) { if (!all && n.dist < 16) continue; deactivate(n); act--; }
        else if (ent && n.active && ent !== n.ent) { n.ent = ent; n.base = ent[2]; } }
      firstSched = false; }

    /* ---- helpers */
    const blocked = (x, z, r) => { const B = W.boxes; for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.h > .35 && x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return true; } return false; };
    const turn = (n, th, rate, dt) => { n.h += GT.angDiff(n.h, th) * Math.min(1, dt * rate); };
    function moveTo(n, tx, tz, sp, dt, free) { const dx = tx - n.x, dz = tz - n.z, d = Math.hypot(dx, dz); if (d < .05) return d; let th = Math.atan2(dx, dz), ok = !!free;
      if (!free) for (const o of [0, .45, -.45, .9, -.9, 1.5, -1.5, 2.2, -2.2]) { const a = th + o * (n.side || 1), px = n.x + sin(a) * .55, pz = n.z + cos(a) * .55; if (!blocked(px, pz, .3)) { th = a; ok = true; if (o) n.side = Math.sign(o) * (n.side || 1); break; } }
      turn(n, th, 7, dt); if (ok) { const st = Math.min(d, sp * dt) * Math.max(.2, cos(GT.angDiff(n.h, th))); n.x += sin(n.h) * st; n.z += cos(n.h) * st; } if (!n.fixY) { const gy = ground(n.x, n.z); n.y += (gy - n.y) * Math.min(1, dt * 12); } return d; }
    let T0 = 0, frame = 0, lastBarkT = -9, ambT = 3 + rng() * 4; const alerts = [], P = { x: 1e4, y: 0, z: 1e4, h: null, speed: 0, riding: false, px: null, vx: 0, vz: 0 };
    const out = (n, b) => { lastBarkT = T0; n.barkT = T0; n.lastBark = b; b.name = n.label; if (opts.onBark) { try { opts.onBark(n, b); } catch (e) { console.warn('[people] onBark threw', e); } } return b; };
    function say(n, cat, force) { if (!force && (T0 - lastBarkT < 2.4 || T0 - n.barkT < 7)) return null; const R = ROLE_CN[n.role]; let c = cat;
      if (cat === 'role' && R && R[1].length) { const i = (rng() * R[1].length) | 0; return out(n, { text: R[1][i], voice: vid(n.role, '', i), cat: 'role', dialect: n.dialect, role: n.role }); }
      if (cat === 'scold' && R && R[2] && R[2].length) { const i = (rng() * R[2].length) | 0; return out(n, { text: R[2][i], voice: vid(n.role, 'x', i), cat: 'scold', dialect: n.dialect, role: n.role }); }
      if (cat === 'role') c = 'idle'; else if (cat === 'scold') c = 'scooter'; if (n.label && c !== 'idle' && c !== 'scooter') return null; /* the named cast (辣姐 / 拐子哥 / 爷叔 / 满哥 / 二筒) never speak a bystander's reaction line (film / flee / gun …): it would show under their name */ const D = BARK_CN[n.dialect] || BARK_CN.pth, L = D[c] || D.idle, i = (rng() * L.length) | 0; if (!L.length) return null; return out(n, { text: L[i], voice: vid(n.dialect, D[c] ? c : 'idle', i), cat: c, dialect: n.dialect, role: n.role }); }
    function sayLine(n, i, x, soft) { const R = ROLE_CN[n.role], L = R && (x ? R[2] : R[1]); if (!L || !L[i] || (soft && T0 - lastBarkT < 3)) return null; return out(n, { text: L[i], voice: vid(n.role, x ? 'x' : '', i), cat: x ? 'scold' : 'role', dialect: n.dialect, role: n.role }); }
    const RAD = { gunshot: 45, gunpoint: 22, panic: 20, crash: 30, horn: 12, fight: 16, siren: 50, cheer: 14, stare: 4, run_past: 5, scooter_near: 4 }, SEV = { gunshot: 5, gunpoint: 4, panic: 4, crash: 3, fight: 2, horn: 2, scooter_near: 2, cheer: 1, siren: 0, stare: 0, run_past: 0 };
    function emit(type, x, z, r, ttl) { const a = { type, x, z, r: r || RAD[type] || 20, until: T0 + (ttl || (type === 'crash' ? 8 : type === 'horn' ? 1.5 : type === 'cheer' ? 5 : 4)), born: T0, held: false }; alerts.push(a); return a; }
    function alertFor(n) { let best = null, bs = -1; for (const a of alerts) { if (Math.hypot(a.x - n.x, a.z - n.z) > a.r) continue; const s = SEV[a.type] === undefined ? 1 : SEV[a.type]; if (s > bs) { bs = s; best = a; } } return best; }
    function startReact(n, a) { const d = Math.hypot(a.x - n.x, a.z - n.z), ty = a.type, scared = ty === 'gunshot' || ty === 'gunpoint' || ty === 'panic', off = n.role === 'chengguan' || n.role === 'traffic' || n.role === 'guard'; let r;
      if (n.def.tough) r = 'look';
      else if (scared) r = off ? 'call' : (n.seated && d < 12) || d < 3.5 ? 'cower' : (n.brave > .8 && d > 10) ? 'film' : 'flee';
      else if (ty === 'crash') r = d < 6 && !n.seated ? 'startle' : n.brave > .5 ? 'film' : n.brave > .25 ? 'point' : 'look';
      else if (ty === 'horn' || ty === 'scooter_near') r = d < 5 && !n.seated && !n.def.noStep ? 'dodge' : d < 6 && !n.seated ? 'scold' : 'look';
      else if (ty === 'fight') r = n.brave > .55 ? 'film' : n.brave > .25 ? 'applaud' : 'look';
      else if (ty === 'cheer') r = 'applaud'; else if (ty === 'stare') r = n.brave > .6 ? 'film' : 'look'; else r = 'look';
      { const cr = n.def.ctl && CTL[n.def.ctl]; if (cr && cr.react) { const rr = cr.react(n, a, d, scared, r); if (rr === true) { n.reactA = a; return; } if (typeof rr === 'string') r = rr; } }   /* TF (js/peds.js): a group controller may take an alert itself (true) or pick the reaction */
      if (n.mode !== 'react') n.prevMode = n.mode; n.react = r; n.reactA = a; n.reactT = 0; n.mode = 'react'; n.fleeT = (scared ? 7.5 : 4) + rng() * 3.5; n.fleeH = Math.atan2(n.x - a.x, n.z - a.z) + (rng() - .5) * .9; n.steerT = 0; n.delay = .12 + rng() * .6;
      const cat = r === 'cower' ? (scared && ty !== 'panic' ? 'gun' : 'flee') : r === 'flee' || r === 'startle' ? 'flee' : r === 'film' ? 'film' : r === 'applaud' ? 'applaud' : r === 'dodge' || r === 'scold' ? (ty === 'horn' ? 'horn' : (ROLE_CN[n.role] && ROLE_CN[n.role][2] ? 'scold' : 'scooter')) : ty === 'stare' ? 'stare' : ty === 'run_past' ? 'run' : null; if (cat && n.dist < 30) say(n, cat); }
    function doReact(n, dt) { const a = n.reactA, live = alerts.includes(a), r = n.react, th = Math.atan2(a.x - n.x, a.z - n.z), t = (n.reactT += dt) - n.delay; n.look.set(a.x, n.y + 1.3, a.z); n.lookAt = n.look; let state = n.state, speed = 0;
      if (t < 0) { }
      else if (r === 'flee' || r === 'startle') { const T1 = r === 'startle' ? 1.5 : n.fleeT; if (t < T1) { state = 'flee'; speed = 4.4 + n.brave; n.lookAt = null; n.steerT = (n.steerT || 0) - dt; if (n.steerT <= 0) { n.steerT = .5; n.fleeH = fleeDir(n, a.x, a.z, n.fleeH); } moveTo(n, n.x + sin(n.fleeH) * 6, n.z + cos(n.fleeH) * 6, speed, dt); } else { state = r === 'startle' ? (n.brave > .5 ? 'film' : 'point') : (n.brave < .3 ? 'cower' : 'phone_call'); turn(n, th, 5, dt); } }
      else if (r === 'dodge') { if (t < .55) { state = 'flee'; speed = 3.2; n.lookAt = null; moveTo(n, n.x + sin(n.fleeH) * 3, n.z + cos(n.fleeH) * 3, speed, dt); } else { state = 'scold'; turn(n, th, 6, dt); } }
      else if (r === 'call') { state = t < 2.5 ? 'point' : 'phone_call'; turn(n, th, 4, dt); }
      else if (r === 'look') { state = n.seated || n.def.tough ? n.base : 'idle'; if (!n.seated && !n.def.tough) turn(n, th, 4, dt); }
      else { state = n.seated ? (r === 'cower' ? 'cower' : n.base) : r; if (!n.seated) turn(n, th, 4, dt); }
      const hold = r === 'dodge' || r === 'scold' ? 2.6 : r === 'look' ? 1.2 : 2.5 + n.brave * 3;
      if (!live && T0 > a.until + hold) { n.react = null; const pm = n.prevMode || 'home'; n.mode = pm === 'home' ? (Math.hypot(n.x - n.home.x, n.z - n.home.z) > .3 ? 'return' : 'home') : pm; }
      n.state = state; n.speed = speed; }
    /* ---- open-world basics: anybody can be hit, knocked down, robbed of a vehicle; the crowd runs from it.
       fleeDir: away from the trouble, round walls, and along the pavement rather than across the carriageway when there is a choice.
       hurt(n, dmg, dx, dz, {heavy, gun, down, ko, push, quiet}) -> n | null: hit flinch, knock-down, get up and run; a few fight back (temper 'fight'), a few stop at a distance and phone it in ('report').
       Events through opts.onEvent: 'hurt' {npc, dmg, down, ko}, 'attack' {npc, dmg} (his punch landed on the player), 'report' {npc, x, z}. Children and the dog cannot be hit. */
    const roadIn = (x, z) => { const r = GT.cnroad; return !!(r && r.inRoad && r.inRoad(x, z)); };
    function fleeDir(n, sx, sz, cur) { const away = Math.atan2(n.x - sx, n.z - sz); if (cur === undefined || abs(GT.angDiff(cur, away)) > 1.7) cur = away; const onRoad = roadIn(n.x, n.z); let alt = null;
      for (const o of [0, .5, -.5, 1, -1, 1.5, -1.5]) { const a = cur + o, px = n.x + sin(a) * 3.2, pz = n.z + cos(a) * 3.2; if (blocked(px, pz, .3) || blocked(n.x + sin(a) * 1.2, n.z + cos(a) * 1.2, .3)) continue; if (!onRoad && roadIn(px, pz)) { if (alt === null) alt = a; continue; } return a; }
      return alt === null ? cur : alt; }
    function hurt(n, dmg, dx, dz, o) { n = typeof n === 'string' ? byId[n] : n; o = o || {}; if (!n || !n.active || n.label || n.pin || n.role === 'dog' || n.role === 'kid' || n.type === 'dog' || n.type === 'kid') return null;   /* the named cast and anyone a story beat has placed are left alone */ const d = n.def;
      if (n.hp === undefined) { n.hpMax = d.tough ? 150 : 55 + n.brave * 40; n.hp = n.hpMax; n.temper = d.temper || (d.tough || (n.brave > .8 && !/granny|oldman|auntie|bird|whip|sanitation/.test(n.type + ' ' + n.role)) ? 'fight' : n.brave > .5 ? 'report' : 'flee'); }
      const l = Math.hypot(dx || 0, dz || 0) || 1; dx = (dx || 0) / l; dz = (dz || 0) / l; n.hp -= dmg || 0; const H = n.hurt || (n.hurt = { ph: '' }), down = n.hp <= 0 || !!o.down || !!o.ko || (!!o.heavy && n.hp < n.hpMax * .5);
      if (n.mode !== 'hurt') { H.prev = n.mode === 'react' ? (n.prevMode || 'home') : n.mode; n.mode = 'hurt'; n.react = null; n.reactA = null; n.over = null; H.ph = ''; H.rep = false; }
      if (n.seated) { n.seated = false; H.wasSeated = true; } const push = o.push !== undefined ? o.push : down ? 3.4 : 1.7; H.vx = dx * push; H.vz = dz * push; H.t = 0; H.gun = !!o.gun; H.atkT = .6; H.st = 0;
      if (down) { H.ph = 'fall'; const was = !!n.dead; n.dead = n.dead || n.hp <= 0 || !!o.ko;   /* out of health = dead: he stays where he fell (a knock-down with health left still gets up and runs) */ n.ko = n.ko || n.dead; H.up = 2.6 + rng() * 2.6; n.h = Math.atan2(-dx, -dz); if (n.dead && !was) died(n, dx, dz); }
      else if (H.ph !== 'fall') { H.alt = H.ph === 'hit' ? !H.alt : false; H.ph = 'hit'; }
      if (!o.quiet) { emit('panic', n.x, n.z, o.gun ? 30 : 16, 3.5); if (n.dist < 30 && !n.ko) say(n, 'flee', true); }
      evt('hurt', { npc: n, dmg: dmg || 0, down, ko: !!n.ko, hp: n.hp }); return n; }
    /* a death: blood spreads under him, what he carried lands beside him (a few notes; whatever was in his hand). The pool and the body go together (endHurt). */
    let bloodTex = null; const bloodMat = () => { if (!bloodTex) { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = GT.rng('bloodpool'); g.fillStyle = '#fff'; for (let i = 0; i < 26; i++) { const a = r() * 6.283, d = r() * 26, rr = 16 + r() * 22; g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, rr, 0, 6.283); g.fill(); } const im = g.getImageData(0, 0, 128, 128), dd = im.data; for (let i = 0; i < dd.length; i += 4) { const x = (i / 4) % 128 - 64, y = ((i / 4) / 128 | 0) - 64, e = 1 - Math.min(1, Math.hypot(x, y) / 62); dd[i + 3] = dd[i] > 128 ? Math.min(255, 255 * Math.min(1, e * 6)) : 0; dd[i] = dd[i + 1] = dd[i + 2] = 255; } g.putImageData(im, 0, 0); bloodTex = new T.CanvasTexture(c); }
      return new T.MeshBasicMaterial({ color: 0x520709, alphaMap: bloodTex, transparent: true, opacity: .92, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }); };   /* unlit and dark: under the noon sun a lit pool came out pink */
    const LOOT_W = { gangster: ['bat', 'pistol', 'pistol', 'knife'], thug: ['bat', 'pipe', 'knife', 'pistol'], traffic_police: ['pistol'], police: ['pistol'], cop: ['pistol'], chengguan: ['pistol'], guard_cn: ['bat'] };   /* QA: officers always carry the pistol; a plain passer-by now and then a knife or a bat */
    function died(n, dx, dz) { const d = n.def || {}, ty = (n.type || '') + ' ' + (n.role || ''), rich = /boss|shop|keeper|vendor|owner|suit|office|gang|loan|dealer|tourist/.test(ty);
      if (!opts.headless && T && root) { const m = new T.Mesh(new T.PlaneGeometry(1, 1), bloodMat()); m.rotation.x = -PI / 2; m.rotation.z = rng() * 6.283; m.position.set(n.x - dx * .25, (n.y || 0) + .012, n.z - dz * .25); m.scale.setScalar(.05); m.renderOrder = 2; root.add(m); n.blood = m; n.bloodT = 0; n.bloodR = 1.1 + rng() * .6; }
      const beast = /\bdog\b|\bkid\b|bird/.test(ty), copT = /police|\bcop\b|chengguan/.test(ty);
      n.cash = beast ? 0 : n.cash !== undefined ? n.cash : Math.round((rich ? 60 + rng() * 240 : 8 + rng() * 70) * (d.tough ? 1.6 : 1));
      let wid = beast ? null : n.weapon || null; if (!wid && !beast) { for (const k in LOOT_W) if (ty.indexOf(k) >= 0) { wid = LOOT_W[k][rng() * LOOT_W[k].length | 0]; break; } if (!wid && rng() < (n.temper === 'fight' ? .3 : .1)) wid = rng() < .5 ? 'knife' : 'bat'; }
      /* QA (GTA-style loot): his notes and whatever was in his hand are tossed out beside the body and stay on the ground 60 s (combat.loot); walking over them picks them up */
      const C = GT.combat; try { if (C && C.loot) C.loot(n.x, n.z, n.y, { cash: n.cash, weapon: wid, ammo: wid === 'pistol' ? (copT ? 24 : 6 + (rng() * 12 | 0)) : undefined, dx, dz }); else if (C && C.dropCash && n.cash > 0) C.dropCash(n.x + dx * .5, n.z + dz * .5, n.cash, n.y); } catch (e) { if (window.console) console.warn('[people] loot', e); }
      n.cash = 0; evt('death', { npc: n, x: n.x, z: n.z, weapon: wid }); }
    function bloodOff(n) { if (n.blood) { if (n.blood.parent) n.blood.parent.remove(n.blood); n.blood.geometry.dispose(); n.blood.material.dispose(); n.blood = null; } }
    function endHurt(n, reset) { const H = n.hurt; if (H && H.wasSeated) n.seated = true; n.hurt = null; n.speed = 0;
      if (n.guest) { n.mode = 'home'; n.home.x = n.x; n.home.z = n.z; n.home.h = n.h; n.base = 'idle'; n.def.x = n.x; n.def.z = n.z; n.def.h = n.h; n.guestEnd = Math.min(n.guestEnd, T0 + (reset ? 0 : 8)); return; }
      if (reset) { n.hp = undefined; n.ko = false; n.dead = false; n.cash = undefined; bloodOff(n); deactivate(n); n.mode = 'home'; return; }
      const pm = (H && H.prev) || 'home'; n.mode = pm === 'home' ? (Math.hypot(n.x - n.home.x, n.z - n.home.z) > .3 ? 'return' : 'home') : pm; }
    function hurtStep(n, dt) { const H = n.hurt; if (!H) { n.mode = 'home'; return; } H.t += dt; n.lookAt = null; const k = Math.exp(-4 * dt);
      if (abs(H.vx) + abs(H.vz) > .05) { const nx = n.x + H.vx * dt, nz = n.z + H.vz * dt; if (!blocked(nx, nz, .3)) { n.x = nx; n.z = nz; } H.vx *= k; H.vz *= k; }
      const pd = Math.hypot(P.x - n.x, P.z - n.z), toP = Math.atan2(P.x - n.x, P.z - n.z), next = () => { H.ph = n.temper === 'fight' && !H.gun && n.hp > n.hpMax * .35 && !P.riding ? 'fight' : 'run'; H.t = 0; H.fh = toP + PI + (rng() - .5) * .8; H.st = 0; };
      if (H.ph === 'hit') { n.state = H.alt ? 'stagger' : 'hit'; n.speed = 0; if (H.t > .55) next(); }
      else if (H.ph === 'fall') { n.state = 'fall'; n.speed = 0; if (n.ko) { if (n.blood) { n.bloodT += dt; const k = 1 - Math.exp(-n.bloodT * .45); n.blood.scale.setScalar(.05 + n.bloodR * k); if (H.t > 84) n.blood.material.opacity = .92 * Math.max(0, (90 - H.t) / 6); } if ((H.t > 6 && n.dist > 60) || H.t > 90) endHurt(n, true); }   /* the dead stay until the player is 60 m off or 90 s have passed */ else if (H.t > H.up) { H.ph = 'getup'; H.t = 0; } }
      else if (H.ph === 'getup') { n.state = 'crouch'; n.speed = 0; if (H.t > .75) next(); }
      else if (H.ph === 'fight') { n.look.set(P.x, P.y + 1.5, P.z); n.lookAt = n.look; H.atkT -= dt;
        if (P.riding) { H.ph = 'shout'; H.t = 0; } else if (pd > 26 || H.t > 18 || n.hp < n.hpMax * .35) next();
        else if (pd > 1.15) { moveTo(n, P.x, P.z, 3.7, dt); n.state = 'chase'; n.speed = 3.7; }
        else { turn(n, toP, 10, dt); n.speed = 0; n.state = H.atkT < .4 ? 'punch' : 'idle'; if (H.atkT <= 0) { H.atkT = 1.15 + rng() * .5; evt('attack', { npc: n, dmg: 5 + n.brave * 4 }); } } }
      else if (H.ph === 'shout') { n.state = 'scold'; n.speed = 0; turn(n, toP, 6, dt); if (H.t > 4) endHurt(n); }
      else if (H.ph === 'call') { n.state = 'phone_call'; n.speed = 0; turn(n, toP, 4, dt); if (pd < 6) { H.ph = 'run'; H.t = 0; } else if (H.t > 3.5) { H.rep = true; evt('report', { npc: n, x: n.x, z: n.z }); endHurt(n); } }
      else { H.st -= dt; if (H.st <= 0) { H.st = .5; H.fh = fleeDir(n, P.x, P.z, H.fh); } const sp = 4.6 + n.brave * .6; moveTo(n, n.x + sin(H.fh) * 6, n.z + cos(H.fh) * 6, sp, dt); n.state = 'flee'; n.speed = sp;
        if (H.t > 5 && (pd > 30 || H.t > 12)) { if (n.temper === 'report' && H.allowCall !== false && !H.rep && pd > 9) { H.ph = 'call'; H.t = 0; } else endHurt(n); } } }
    /** adopt(figure, {x, z, h, type, brave, temper, ttl}) -> record: a figure made elsewhere (the driver pulled out of a car, the rider off his scooter) joins the crowd and behaves like anyone else; it leaves when its time is up and nobody is near */
    function adopt(fig, o) { o = o || {}; if (!fig || !fig.group) return null; const n = rec({ grp: 'guest', type: o.type || 'uncle', role: o.role, x: o.x || 0, z: o.z || 0, h: o.h || 0, sched: [[0, 24, 'idle']], pri: 0, seed: 0, brave: o.brave, temper: o.temper, guest: true });
      n.fig = fig; n.group = fig.group; root.add(fig.group); n.guest = true; n.guestEnd = T0 + (o.ttl || 45); n.active = true; n.ent = n.def.sched[0]; n.base = n.state = 'idle'; n.y = n.home.y = ground(n.x, n.z); n.group.visible = true; n.vis = true; n.snap = true; n.group.position.set(n.x, n.y, n.z); n.group.rotation.set(0, n.h, 0); n.dist = Math.hypot(n.x - P.x, n.z - P.z); return n; }
    function guestSweep() { for (let i = list.length - 1; i >= 0; i--) { const n = list[i]; if (!n.guest || T0 < n.guestEnd || (n.dist < 38 && T0 < n.guestEnd + 60)) continue; if (n.mode === 'hurt' && !n.ko) continue; root.remove(n.group); list.splice(i, 1); const g = groups.guest, j = g ? g.indexOf(n) : -1; if (j >= 0) g.splice(j, 1); } }
    function homeStep(n, dt) { const d = n.def; if (d.alts && !n.pin) { n.altT -= dt; if (n.altT <= 0) { n.altT = 8 + rng() * 14; n.base = rng() < .5 ? n.ent[2] : d.alts[(rng() * d.alts.length) | 0]; } }
      n.state = n.base; n.speed = 0; if (Array.isArray(d.look) && !n.pin) { n.look.set(d.look[0], n.y + d.look[1], d.look[2]); n.lookAt = n.look; }
      if (!n.seated && !d.noStep) { const k2 = Math.min(1, dt * 3.5); let tx = 0, tz = 0; if (!P.riding && n.dist < .95) { const k = (1.05 - n.dist) / Math.max(n.dist, .2); tx = clamp((n.home.x - P.x) * k, -.8, .8); tz = clamp((n.home.z - P.z) * k, -.8, .8); if (blocked(n.home.x + tx, n.home.z + tz, .3)) { tx = 0; tz = 0; } else if (abs(n.ox) + abs(n.oz) < .05) say(n, 'aside'); } else if (n.dist < 2.2) { tx = n.ox; tz = n.oz; } n.ox += (tx - n.ox) * k2; n.oz += (tz - n.oz) * k2; }
      n.x = n.home.x + n.ox; n.z = n.home.z + n.oz; turn(n, n.home.h, 3, dt); if (d.sync) n.sync = clocks[n.grp]; }
    function pathStep(n, dt) { const d = n.def; let sp = d.speed || 1.2; const state = n.ent[2];
      if (d.follow) { const L = byId[d.follow]; if (!L || !L.active) { n.state = 'idle'; n.speed = 0; return; } const c = cos(L.h), s = sin(L.h), fo = d.fo || [.7, -.5], tx = L.x + fo[0] * c + fo[1] * s, tz = L.z - fo[0] * s + fo[1] * c, left = Math.hypot(tx - n.x, tz - n.z);
        if (left < .35 && L.speed < .1) { n.state = L.state === 'walk' ? 'idle' : 'phone_look'; n.speed = 0; turn(n, L.h + .4, 3, dt); return; } sp = clamp(left * 2.2, .5, 2.4); moveTo(n, tx, tz, sp, dt); n.state = state; n.speed = sp; return; }
      const pth = d.path, pts = pth.pts; if (n.wait > 0) { n.wait -= dt; n.state = (n.stop && n.stop.state) || pth.waitState || 'idle'; n.speed = 0; return; }
      const tg = pts[n.seg]; let tx = tg[0], tz = tg[1];
      { const fx = sin(n.h), fz = cos(n.h), rx = P.x - n.x, rz = P.z - n.z, ahead = rx * fx + rz * fz, lat = rx * fz - rz * fx; if (n.dist < 2.4 && ahead > -.2 && abs(lat) < .75 && sp > .5) { const sg = lat > 0 ? -1 : 1; tx = n.x + fx * 1.5 + fz * sg; tz = n.z + fz * 1.5 - fx * sg; if (n.dist < .9) sp *= .5; if (n.dist < 1.5 && !P.riding) say(n, 'aside'); } }
      moveTo(n, tx, tz, sp, dt); n.state = state; n.speed = sp;
      if (Math.hypot(tg[0] - n.x, tg[1] - n.z) < .6) { const st = pth.stops && pth.stops.find(q => q.i === n.seg); if (st) { n.wait = st.t * (.7 + rng() * .6); n.stop = st; } else if (pth.wait && (n.seg === 0 || n.seg === pts.length - 1)) { n.wait = pth.wait[0] + rng() * (pth.wait[1] - pth.wait[0]); n.stop = null; }
        if (pth.loop) n.seg = (n.seg + 1) % pts.length; else { if (n.seg + n.dir < 0 || n.seg + n.dir >= pts.length) n.dir = -n.dir; n.seg += n.dir; } } }
    /** the player: stare-backs, being filmed, run-past looks, jumping out of the way of the scooter */
    function aware(n, dt) { const d = n.def, pd = n.dist; if (pd > 9) { n.stare = 0; return; }
      if (!P.riding) { const facing = P.h === null ? pd < 1.9 : (pd < 2.6 && abs(GT.angDiff(P.h, Math.atan2(n.x - P.x, n.z - P.z))) < .6);
        if (facing && P.speed < .5) { n.stare += dt; if (n.stare > 2.2) { n.lookT = .6; if (n.stare > 2.6 && T0 - (n.stareT || -99) > 20) { if (say(n, ROLE_CN[n.role] && rng() < .6 ? 'role' : 'stare')) n.stareT = T0; } }
          if (n.stare > 6.5 && n.brave > .55 && !n.seated && !n.over && n.mode === 'home' && !d.noStep && !d.tough) { n.over = 'film'; n.overT = 4; say(n, 'film'); n.stare = 0; } } else n.stare = Math.max(0, n.stare - dt * 2);
        if (pd < 4.5 && P.speed > 3.3) { if (n.lookT <= 0 && pd < 2.8) say(n, 'run'); n.lookT = 2.2; } }
      else if (pd < 3.2 && P.speed > 2.2 && !d.noReact) { n.lookT = 2.5; if (T0 - (n.dodgeT || -9) > 5) { n.dodgeT = T0; if (!n.seated && !d.noStep && n.mode !== 'react' && pd < 2.4) startReact(n, emit('scooter_near', P.x, P.z, .01, 1)); else { say(n, ROLE_CN[n.role] && ROLE_CN[n.role][2] ? 'scold' : 'scooter'); if (!n.over && !n.seated && n.grp === 'dance') { n.over = 'scold'; n.overT = 3; } } } } }

    /* ---- group controllers */
    const CTL = {
      dance: { step(n, dt) { const dd = Math.hypot(n.home.x - n.x, n.home.z - n.z); if (dd > .45) { moveTo(n, n.home.x, n.home.z, 1.6, dt, true); n.state = 'walk'; n.speed = 1.6; return; }
          n.state = n.ent[2]; n.sync = danceT; n.speed = 0; n.x += (n.home.x - n.x) * Math.min(1, dt * 2); n.z += (n.home.z - n.z) * Math.min(1, dt * 2); turn(n, n.home.h, 3, dt);
          if (n.def.lead && n.dist < 24 && T0 - n.barkT > 16 && rng() < dt * .12) say(n, 'role');
          if (!P.riding && n.dist < .9 && n.state !== 'taichi' && T0 - (n.mem.dis || -9) > 6) { n.mem.dis = T0; n.over = 'scold'; n.overT = 3.2; say(n, 'scold', true); evt('dance_disrupt', { npc: n }); } } },
      swim: { init(n) { const d = n.def, dv = at('swimDive', { x: -65.65, z: -20, h: -HPI, y: -1.2 }), m = n.mem; m.dv = dv; m.deckY = d.y !== undefined ? d.y : ground(dv.x, dv.z); m.mat = loc(dv, 2.4 + d.k * .1, -1.85 - d.k * .8); m.rest = [d.x, d.z]; m.dive = loc(dv, 0, -.05); m.ph = ['rest', 'hand', 'swim'][d.k % 3]; m.t = 4 + d.k * 5; n.fixY = true; n.y = m.deckY;
          if (m.ph === 'hand') { n.x = m.mat[0]; n.z = m.mat[1]; n.h = dv.h + PI; m.t = 9; } if (m.ph === 'swim') { const p = loc(dv, 2, 6); n.x = p[0]; n.z = p[1]; n.y = waterY; m.t = 30; m.a = 0; } },
        step(n, dt) { const m = n.mem, dv = m.dv, walk = (p, sp) => { const left = moveTo(n, p[0], p[1], sp, dt, true); n.state = 'walk'; n.speed = sp; return left < .12; }; m.t -= dt; n.noReact = m.ph === 'dive' || m.ph === 'swim' || m.ph === 'back' || m.ph === 'hand'; n.speed = 0;
          if (m.ph === 'rest') { n.state = (m.t % 14) > 7 ? 'stretch' : 'idle'; turn(n, dv.h, 3, dt); if (m.t <= 0) m.ph = 'toMat'; }
          else if (m.ph === 'toMat') { if (walk(m.mat, 1.1)) { m.ph = 'hand'; m.t = 11 + rng() * 6; } }
          else if (m.ph === 'hand') { n.state = 'handstand'; n.blend = .9; turn(n, dv.h + PI, 3, dt); if (m.t <= 0) { m.ph = 'up'; m.t = 1.4; } }
          else if (m.ph === 'up') { n.state = 'idle'; n.blend = .9; if (m.t <= 0) m.ph = 'toDive'; }
          else if (m.ph === 'toDive') { if (walk(m.dive, 1.15)) { m.ph = 'aim'; m.t = 1.2; } }
          else if (m.ph === 'aim') { n.state = 'idle'; turn(n, dv.h, 6, dt); if (m.t <= 0) { m.ph = 'dive'; m.t = 1.72; evt('dive', { npc: n }); if (n.dist < 25) say(n, 'role'); } }
          else if (m.ph === 'dive') { n.state = 'dive'; n.h = dv.h; n.drop = m.deckY - waterY; if (m.t <= 0) { n.x += sin(n.h) * 2.5; n.z += cos(n.h) * 2.5; n.y = waterY; m.ph = 'swim'; m.t = 34 + rng() * 14; m.a = 0; n.snap = true; n.state = 'swim'; } }
          else if (m.ph === 'swim' || m.ph === 'back') { n.state = 'swim'; n.speed = .55; n.y = waterY; let tg; if (m.ph === 'swim') { m.a += dt * .09; tg = loc(dv, 5.5 * sin(m.a + n.def.k * 2), 8 - 4.2 * cos(m.a + n.def.k * 2)); if (m.t <= 0) m.ph = 'back'; } else tg = loc(dv, 2.6, 1.3);
            const left = Math.hypot(tg[0] - n.x, tg[1] - n.z); turn(n, Math.atan2(tg[0] - n.x, tg[1] - n.z), 1.6, dt); const st = Math.min(left, .55 * dt); n.x += sin(n.h) * st; n.z += cos(n.h) * st;
            if (m.ph === 'back' && left < .5) { const p = loc(dv, 2.6, -.9); n.x = p[0]; n.z = p[1]; n.y = m.deckY; n.h = dv.h + PI; n.snap = true; m.ph = 'out'; m.t = 3; n.state = 'idle'; } }
          else if (m.ph === 'out') { n.state = 'idle'; if (m.t <= 0) m.ph = 'toRest'; }
          else if (m.ph === 'toRest') { if (walk(m.rest, 1.1)) { m.ph = 'rest'; m.t = 12 + rng() * 10; } } } },
      queue: { init(n) { if (!Q.order.includes(n)) Q.order.push(n); }, exit(n) { const i = Q.order.indexOf(n); if (i >= 0) Q.order.splice(i, 1); if (Q.leaving === n) Q.leaving = null; },
        step(n, dt) { const m = n.mem, i = Q.order.indexOf(n);
          if (m.leave) { const tg = m.leave === 1 ? m.e1 : m.e2; n.state = 'walk'; n.speed = 1.2; if (moveTo(n, tg[0], tg[1], 1.2, dt) < .5) { if (m.leave === 1) m.leave = 2; else { m.leave = 0; Q.order.push(n); if (Q.leaving === n) Q.leaving = null; } } return; }
          if (i < 0) { Q.order.push(n); return; } const s = Q.slots[Math.min(i, Q.slots.length - 1)], tx = s.x, tz = s.z + Math.max(0, i - (Q.slots.length - 1)) * .8, left = Math.hypot(tx - n.x, tz - n.z);
          if (left > .12) { moveTo(n, tx, tz, .7, dt, left < 1.2); n.state = 'queue'; n.speed = .7; } else { n.state = 'queue'; n.speed = 0; turn(n, s.h || 0, 4, dt); }
          if (i === 0 && left < .2 && !Q.hold) { m.serve = (m.serve || 0) + dt; if (m.serve > Q.period && !Q.leaving) { m.serve = 0; Q.order.shift(); Q.leaving = n; m.leave = 1; const tl = Q.slots[Q.slots.length - 1]; m.e1 = [s.x - 3.2, s.z - 1.6]; m.e2 = [tl.x - 2.6, tl.z + 2.2]; Q.period = 8 + rng() * 6; evt('queue_advance', { npc: n }); } } } },
      vendor: { init(n) { CH.v = n; CH.phase = 'sell'; n.mem.node = 0; }, exit() { CH.v = null; },
        step(n, dt) { const L = CH.loop, m = n.mem, o = CH.o; n.state = 'push_cart';
          if (CH.phase === 'flee') { const tg = L[m.node]; n.speed = 3.7; if (moveTo(n, tg[0], tg[1], 3.7, dt) < .7) { CH.phase = 'giveup'; CH.t = 5.5; if (o && o.dist < 40) sayLine(o, 3); } }
          else { n.speed = 0; let cx = 0, cz = 0; for (const p of L) { cx += p[0] / L.length; cz += p[1] / L.length; } turn(n, Math.atan2(cx - n.x, cz - n.z), 3, dt); if (n.dist < 3 && !P.riding && T0 - n.barkT > 12) sayLine(n, rng() < .5 ? 0 : 4, false, true);
            if (CH.phase === 'sell' && o && o.active && Math.hypot(o.x - n.x, o.z - n.z) < 12.5) { CH.phase = 'flee'; m.node = (m.node + 1) % L.length; if (n.dist < 40) sayLine(n, 2); evt('chengguan_run', { vendor: n, officer: o }); } } } },
      officer: { init(n) { CH.o = n; }, exit() { CH.o = null; },
        step(n, dt) { const v = CH.v, m = n.mem; if (!v || !v.active) { n.state = 'idle'; n.speed = 0; return; } const d = Math.hypot(v.x - n.x, v.z - n.z);
          if (CH.phase === 'flee') { const sp = d > 9 ? 3.5 : 3.0; n.state = 'chase'; n.speed = sp; moveTo(n, v.x, v.z, sp, dt); if (T0 - n.barkT > 6 && n.dist < 30) sayLine(n, rng() < .5 ? 0 : 2, false, true); }
          else if (CH.phase === 'giveup') { n.state = 'chase'; n.speed = 0; turn(n, Math.atan2(v.x - n.x, v.z - n.z), 3, dt); CH.t -= dt; if (CH.t <= 0) { CH.phase = 'cool'; m.cool = 18 + rng() * 16; } }
          else if (CH.phase === 'cool') { n.state = m.cool > 8 ? 'phone_look' : 'idle'; n.speed = 0; m.cool -= dt; if (m.cool <= 0) CH.phase = 'sell'; }
          else { n.state = 'walk'; n.speed = 1.15; moveTo(n, v.x, v.z, 1.15, dt); } } },
      pengci: { init(n) { n.mem.ph = 'lurk'; n.mem.cd = 5; api.pengci.npc = n; },
        step(n, dt) { const m = n.mem, d = n.dist; m.cd -= dt; n.speed = 0;
          if (m.ph === 'lurk') { n.state = 'idle'; if (Math.hypot(n.x - n.home.x, n.z - n.home.z) > .4) { n.state = 'walk'; n.speed = 1.7; moveTo(n, n.home.x, n.home.z, 1.7, dt); } else { turn(n, n.home.h, 2, dt);
              if (m.cd <= 0 && d < 7.5 && d > 1.2 && P.speed > 2 && api.pengci.enabled) { const tt = clamp(d / Math.max(P.speed, 1), .3, 1.6), ix = P.x + P.vx * tt, iz = P.z + P.vz * tt; if (Math.hypot(ix - n.x, iz - n.z) < 4.5) { m.ph = 'step'; m.t = .9; m.tx = lerp(n.x, ix, .55); m.tz = lerp(n.z, iz, .55); } } } }
          else if (m.ph === 'step') { m.t -= dt; n.state = 'walk'; n.speed = 1.6; moveTo(n, m.tx, m.tz, 1.6, dt, true); if (m.t <= 0 || d < 1.6) { m.ph = 'fall'; m.t = 2.5; n.h = Math.atan2(P.x - n.x, P.z - n.z); sayLine(n, 0); api.pengci.state = 'fall'; evt('pengci', { npc: n, amount: 500 }); } }
          else if (m.ph === 'fall') { m.t -= dt; n.state = 'fake_fall'; if (m.t <= 0) { m.ph = 'demand'; m.t = 40; api.pengci.state = 'demand'; sayLine(n, 1 + ((rng() * 2) | 0)); } }
          else if (m.ph === 'demand') { m.t -= dt; n.state = 'demand'; n.blend = .6; n.look.set(P.x, P.y + 1.4, P.z); n.lookAt = n.look; n.speak = d < 6 ? 1 : .3; if (d < 8 && T0 - n.barkT > 6) sayLine(n, 2 + ((rng() * 4) | 0), false, true);
            if (m.t <= 0 || d > 16 || m.done) { m.ph = 'up'; m.t = 1.6; api.pengci.state = 'idle'; sayLine(n, m.paid ? 0 : 1, true); evt('pengci_end', { npc: n, paid: !!m.paid }); m.done = false; m.paid = false; } }
          else { m.t -= dt; n.state = 'idle'; n.blend = .8; if (m.t <= 0) { m.ph = 'lurk'; m.cd = 70 + rng() * 40; } } } },
      tour: { init(n) { if (n.def.lead) { TOUR.g = n; TOUR.phase = 'talk'; TOUR.t = 18; TOUR.at = 0; } }, exit(n) { if (TOUR.g === n) TOUR.g = null; },
        step(n, dt) { const d = n.def, G = TOUR.g, S0 = TOUR.at ? TOUR.B : TOUR.A, tgt = TOUR.target;
          if (d.lead) { const tr = GT.landmarks && GT.landmarks.train, wow = !!(tr && tr.visible !== false && (tr.inBuilding || (typeof tr.z === 'number' && abs(tr.z - tgt[2]) < 34))); TOUR.t -= dt; TOUR.wow = wow; if (wow && !TOUR.wowed) { TOUR.wowed = true; evt('train_wow', {}); } else if (!wow) TOUR.wowed = false;
            if (TOUR.phase === 'talk') { n.state = 'tour_lead'; n.speed = 0; turn(n, PI, 3, dt); n.speak = wow ? 1 : undefined; if (n.dist < 25 && T0 - n.barkT > 14 && rng() < dt * .2) sayLine(n, wow ? 1 : (rng() * 4) | 0, false, true); if (TOUR.t <= 0) { TOUR.phase = 'photo'; TOUR.t = 9; if (n.dist < 30) sayLine(n, 4); } }
            else if (TOUR.phase === 'photo') { n.state = 'group_photo'; n.speed = 0; turn(n, PI, 3, dt); if (TOUR.t <= 0) { TOUR.phase = 'walk'; TOUR.at = TOUR.at ? 0 : 1; if (n.dist < 30) sayLine(n, 0); } }
            else { const S1 = TOUR.at ? TOUR.B : TOUR.A; n.state = 'tour_lead'; n.speed = 1.0; if (moveTo(n, S1.x, S1.z, 1.0, dt) < .4) { TOUR.phase = 'talk'; TOUR.t = 22 + rng() * 10; } } return; }
          if (!G || !G.active) { n.state = 'tour_follow'; n.speed = 0; return; } const o = d.off, walk = TOUR.phase === 'walk', tx = walk ? G.x - sin(G.h) * (1 + o[1] * .6) + cos(G.h) * o[0] * .7 : S0.x + o[0], tz = walk ? G.z - cos(G.h) * (1 + o[1] * .6) - sin(G.h) * o[0] * .7 : S0.z - o[1], left = Math.hypot(tx - n.x, tz - n.z); let state = 'tour_follow', sp = 0, hh = 0;
          if (left > (walk ? .5 : .3) && !n.mem.bk) { sp = clamp(left * 1.6, .5, 1.5); moveTo(n, tx, tz, sp, dt); }
          else { if (TOUR.phase === 'photo') { const cam = d.variant === 5; state = cam ? 'film' : 'group_photo'; hh = cam ? 0 : PI; if (cam) { n.look.set(S0.x, n.y + 1.3, S0.z); n.lookAt = n.look; } n.sync = T0; }
            else if (TOUR.wow) { state = d.variant % 2 ? 'film' : 'point'; n.look.set(tgt[0], tgt[1], tgt[2]); n.lookAt = n.look; if (n.dist < 25 && T0 - n.barkT > 14 && rng() < dt * .3) sayLine(n, d.variant % 3 === 0 ? 0 : 2, false, true); }
            if (d.backstep && TOUR.phase === 'talk') { const b = pulse(T0 + n.id * 3, 17, 4, 1.2); n.mem.bk = b > .02; n.x = tx; n.z = tz - b * 1.4; if (b > .02) state = 'film'; } else n.mem.bk = false; turn(n, hh, 3, dt); }
          n.state = state; n.speed = sp; } },
      match: { step(n, dt) { n.speed = 0; n.state = 'flyer'; const near = !P.riding && n.dist < 4.2; n.speak = near ? 1 : undefined; n.x = n.home.x; n.z = n.home.z;
          if (near) { n.look.set(P.x, P.y + 1.5, P.z); n.lookAt = n.look; if (!n.seated) turn(n, Math.atan2(P.x - n.x, P.z - n.z), 3, dt); if (T0 - n.barkT > 9 && n.dist < 3.2) say(n, 'role'); } else turn(n, n.home.h, 2, dt); } },
      kid: { init(n) { n.mem.a = n.def.k * 2.4; },
        step(n, dt) { const m = n.mem, d = n.def, r = 5.5 - d.k * 1.6, sp = 1.9 - d.k * .3; m.a += dt * sp / r * (d.k ? -1 : 1); moveTo(n, d.cx + cos(m.a) * r, d.cz + sin(m.a) * r, sp + .4, dt, true); n.state = 'balance_bike'; n.speed = sp; if (n.dist < 3 && T0 - n.barkT > 10) say(n, 'role'); } },
      dog: { step(n, dt) { const o = byId.dogOwner, m = n.mem, near = !P.riding && n.dist < 4.5; m.t = (m.t || 0) + dt; let tx, tz, sp = 0;
          if (near) { tx = P.x; tz = P.z; if (T0 - n.barkT > 5) { say(n, 'role', true); if (o && o.active && rng() < .6) m.own = T0 + 1.2; } if (m.own && T0 > m.own) { m.own = 0; if (o && o.active) say(o, 'role', true); } }
          else { if (!m.tg || m.t > m.next) { m.next = m.t + 5 + rng() * 7; const bx = o && o.active ? o.x : n.home.x, bz = o && o.active ? o.z : n.home.z; m.tg = [bx + (rng() - .5) * 3.2 - .6, bz + (rng() - .5) * 2.6]; } tx = m.tg[0]; tz = m.tg[1]; }
          const left = Math.hypot(tx - n.x, tz - n.z); if (left > (near ? 1.1 : .35)) { sp = clamp(left * 1.8, .7, near ? 3.2 : 1.6); moveTo(n, tx, tz, sp, dt, !near); n.state = 'dog_trot'; m.idle = 0; }
          else { m.idle = (m.idle || 0) + dt; n.state = near ? 'dog_idle' : (m.idle > 5 ? 'dog_sit' : 'dog_idle'); if (near) { turn(n, Math.atan2(P.x - n.x, P.z - n.z), 5, dt); n.look.set(P.x, P.y + 1.2, P.z); n.lookAt = n.look; } } n.speed = sp; } },
      traffic: { step(n, dt) { n.state = 'traffic'; n.speed = 0; turn(n, n.home.h, 2, dt); const road = GT.cnroad;
          if (!P.riding && abs(P.x) < 7.2 && n.dist < 30 && T0 - (n.mem.w || -9) > 7) { let bad = true; if (road && road.onCrossing && road.onCrossing(P.x, P.z)) { const s = road.signals && road.signals.state ? road.signals.state(P.z) : null; bad = !!(s && s.ped === 'dont'); } if (bad) { n.mem.w = T0; n.over = 'scold'; n.overT = 3; sayLine(n, rng() < .5 ? 0 : 1); evt('jaywalk', { npc: n }); } } } }
    };
    function brain(n, dt) { n.t += dt; n.lookAt = null; n.speak = undefined; n.sync = undefined; n.blend = undefined; n.drop = undefined; const d = n.def; if (n.mode === 'hurt') { hurtStep(n, dt); return; }
      if (!d.noReact && !n.noReact) { const a = alertFor(n); if (a && a !== n.reactA && (n.mode !== 'react' || (SEV[a.type] || 0) > (n.reactA ? SEV[n.reactA.type] || 0 : -1))) startReact(n, a); }
      if (n.mode === 'react') { doReact(n, dt); return; }
      if (n.mode === 'return') { const left = moveTo(n, n.home.x, n.home.z, 1.4, dt); n.state = 'walk'; n.speed = 1.4; if (left < .15) { n.mode = 'home'; n.x = n.home.x; n.z = n.home.z; } return; }
      if (n.mode === 'ctl') CTL[d.ctl].step(n, dt); else if (n.mode === 'path') pathStep(n, dt); else homeStep(n, dt);
      aware(n, dt);
      if (n.over) { n.overT -= dt; if (n.overT <= 0) n.over = null; else if (n.mode !== 'react') { n.state = n.over; n.speed = 0; n.look.set(P.x, P.y + 1.5, P.z); n.lookAt = n.look; if (!n.seated) turn(n, Math.atan2(P.x - n.x, P.z - n.z), 5, dt); } }
      if (n.lookT > 0) { n.lookT -= dt; n.look.set(P.x, P.y + 1.5, P.z); n.lookAt = n.look; } }
    function update(dt, playerPos, events) { dt = clamp(dt || 0, 0, .1); T0 += dt; danceT += dt; frame++;
      if (playerPos) { const px = P.x, pz = P.z; P.x = playerPos.x; P.z = playerPos.z; P.y = playerPos.y !== undefined ? playerPos.y : ground(P.x, P.z); P.h = playerPos.h === undefined ? null : playerPos.h;
        if (P.px !== null && dt > 0) { const k = Math.min(1, dt * 6); P.vx += (clamp((P.x - px) / dt, -40, 40) - P.vx) * k; P.vz += (clamp((P.z - pz) / dt, -40, 40) - P.vz) * k; } P.px = P.x;
        P.speed = playerPos.speed !== undefined ? playerPos.speed : Math.hypot(P.vx, P.vz); P.riding = !!(playerPos.inCar || playerPos.vehicle || playerPos.riding) || (playerPos.inCar === undefined && playerPos.vehicle === undefined && playerPos.riding === undefined && P.speed > 7.5); }
      if (events) for (const e of events) { let a = null; for (const q of alerts) if (q.held && q.type === e.type && Math.hypot(q.x - e.x, q.z - e.z) < 12) { a = q; break; } if (a) { a.x = e.x; a.z = e.z; a.until = T0 + 1.2; } else { a = emit(e.type, e.x, e.z, e.r, 1.2); a.held = true; } }
      for (let i = alerts.length - 1; i >= 0; i--) if (T0 > alerts[i].until) alerts.splice(i, 1);
      for (const g in groups) clocks[g] = (clocks[g] || 0) + dt; if (frame % 90 === 0) guestSweep();
      schedT -= dt; if (schedT <= 0) { schedT = 1.5; reschedule(false); }
      let vis = 0, near = 0, act = 0;
      for (const n of list) { const d = Math.hypot(n.x - P.x, n.z - P.z); n.dist = d; if (!n.active) continue; act++; n.acc += dt;
        if (d > (n.def.far || lodFar)) { if (n.vis) { n.group.visible = false; n.vis = false; } if (n.mode !== 'home' && (frame + n.id) % 12 === 0) { brain(n, Math.min(n.acc, 1)); n.acc = 0; } else if (n.acc > 1) n.acc = 1; continue; }
        if (!n.vis) { n.group.visible = true; n.vis = true; n.snap = true; } vis++; const lod = d < Math.min(lodNear, 22) ? 0 : d < Math.min(lodNear * 2, 46) ? 1 : 2; n.lod = lod; const sh = d < (n.def.shadow || shadowDist); if (sh !== n.sh) { n.sh = sh; n.fig.setShadow(sh); }
        const every = n.def.rings ? (d < 30 ? 1 : d < 80 ? 2 : 6) : lod === 0 ? 1 : lod === 1 ? 2 : d < 80 ? 5 : 8; if (lod && (frame + n.id) % every && !n.snap) continue; if (!lod) near++;   /* TF: js/peds.js people (def.rings) on the 30 / 80 / 140 m rings */
        const udt = Math.min(n.acc, .25); n.acc = 0; brain(n, udt); n.group.position.set(n.x, n.y, n.z); n.group.rotation.y = n.h;
        n.fig.update(udt, { state: n.state, speed: n.speed, lookAt: lod < 2 ? n.lookAt : null, speak: n.speak, sync: n.sync, blend: n.blend, drop: n.drop, snap: n.snap }); n.snap = false; }
      ambT -= dt; if (ambT <= 0) { ambT = 5 + rng() * 7; let c = null, bd = 11; for (const n of list) if (n.active && n.mode !== 'react' && n.dist < bd && n.dist > 1.2 && T0 - n.barkT > 14 && !n.def.tough && n.role !== 'dog') { if (rng() < .5 || !c) { c = n; bd = Math.max(n.dist, 4); } } if (c && !P.riding) say(c, ROLE_CN[c.role] && rng() < .7 ? 'role' : 'idle'); }
      api.stats.active = act; api.stats.visible = vis; api.stats.near = near; api.stats.alerts = alerts.length; api.hours = hoursNow(); }
    const N = q => typeof q === 'string' ? byId[q] : q;
    Q.tail = () => { const i = Q.order.length, s = Q.slots[Math.min(i, Q.slots.length - 1)] || { x: 0, z: 0, h: 0 }; return { x: s.x, z: s.z + Math.max(0, i - (Q.slots.length - 1)) * .8, h: s.h === HPI ? PI : (s.h || PI), index: i }; };
    /** TF (js/peds.js): addDef(def) -> record — one more person after the crowd was built (same def fields as add(); pri 0 keeps it out of the cap); ctl — the group controllers, so a module can add its own { init, step, exit, react } */
    const addDef = d => { d = Object.assign({ grp: 'extra', type: 'local_m', x: 0, z: 0, h: 0, sched: [[0, 24, 'idle']], pri: 0, seed: defs.length % 23 }, d); defs.push(d); const n = rec(d); let i = order.length; while (i > 0 && order[i - 1].def.pri > d.pri) i--; order.splice(i, 0, n); return n; };
    const api = { list, groups, root, update, emit, alerts, hurt, adopt, fleeDir, addDef, ctl: CTL, get T0() { return T0; }, hours: hoursNow(), say: (n, cat) => say(N(n), cat || 'role', true), sayLine: (n, i, scold) => sayLine(N(n), i, scold, false),
      find: id => byId[id] || list.find(n => n.active && (n.role === id || n.type === id)) || list.find(n => n.role === id || n.type === id) || null, named: {},
      dance: { bpm: BPM, get clock() { return danceT; }, setClock(t) { danceT = t; }, get beat() { return danceT * BPM / 60; }, get active() { return (groups.dance || []).some(n => n.active && n.ent && n.ent[2] !== 'taichi'); }, get dancers() { return (groups.dance || []).filter(n => n.active); }, get leader() { return byId.danceLead || null; } },
      queue: Q, tour: TOUR, chase: CH, pengci: { state: 'idle', enabled: true, npc: null, resolve(paid) { const n = this.npc; if (n && n.mem.ph === 'demand') { n.mem.done = true; n.mem.paid = !!paid; } } },
      setGroup(g, v) { for (const n of groups[g] || []) n.enabled = !!v; reschedule(true); }, setEnabled(q, v) { const n = N(q); if (n) { n.enabled = !!v; reschedule(true); } },
      /** pin an NPC somewhere regardless of the schedule (story beats): place('yeshu', { x, z, h, y?, state: 'talk' }); release('yeshu') hands it back to the schedule */
      place(q, o) { const n = N(q); if (!n) return null; const d = n.def; n.orig = n.orig || { x: d.x, z: d.z, h: d.h, y: d.y }; d.x = o.x; d.z = o.z; if (o.h !== undefined) d.h = o.h; d.y = o.y; n.pin = [0, 99, o.state || 'idle']; n.enabled = true; if (n.active) deactivate(n); activate(n, n.pin); return n; },
      release(q) { const n = N(q); if (!n || !n.pin) return; n.pin = null; if (n.orig) { Object.assign(n.def, n.orig); n.orig = null; } if (n.active) deactivate(n); reschedule(true); },
      setHours(h) { hourOverride = h === undefined || h === null ? null : h; reschedule(true); }, reschedule: () => reschedule(true),
      resnap() { for (const n of list) if (n.active && !n.fixY) { n.home.y = ground(n.home.x, n.home.z); n.y = ground(n.x, n.z); if (n.group) n.group.position.y = n.y; } },
      setVisible(b) { root.visible = !!b; }, dispose() { scene.remove(root); list.length = 0; }, voiceList, dialects: DIA_CN,
      stats: { count: list.length, spawned: 0, active: 0, visible: 0, near: 0, alerts: 0, tris: 0 } };
    for (const k in NAMES_CN) Object.defineProperty(api.named, k, { enumerable: true, get: () => byId[k] && byId[k].active ? byId[k] : (list.find(n => n.type === k && n.active) || byId[k] || null) });
    if (!opts.lazy) { reschedule(true); for (const n of list) if (n.active) { n.group.position.set(n.x, n.y, n.z); n.group.rotation.y = n.h; n.fig.update(0, { state: n.state, snap: true }); } }
    return api;
  }
  const DIA_CN = { cq: '码头腔', wh: '江城话', sh: '洋行腔', cs: '小吃街腔', pth: '普通话' };   /* invented names for the four ways people talk in 江城 (the keys are only voice-id prefixes): no real place names reach the screen */
  GT.people.populateCN = populateCN; GT.people.barksCN = { dialects: BARK_CN, roles: ROLE_CN, names: DIA_CN }; GT.people.voiceList = voiceList; GT.people.namesCN = NAMES_CN;

  /* ------------------------------------------------------------------ showcases */
  function stage(scene, wall) { const k = GT.kit(); k.box('concrete', 44, .3, 30, 0, -.15, 0); if (wall) { k.box('stucco_cream', 30, 3.4, .3, 0, 1.7, -3.2, { bevel: .01 }); k.box('concrete_stained', 30, .16, .5, 0, .08, -2.95, { bevel: .02 }); }
    k.decal('oil_stain', 1.8, 1.8, 2.5, .012, 1.2, .5); k.decal('crack', 3, 3, -3, .012, .8, 1.2); scene.add(k.build()); }
  function preroll(figs, upd, q) { const pt = +q.get('pt') || 0; for (let t = 0; t < pt; t += 1 / 60) upd(1 / 60); const st2 = q.get('st2'), pt2 = +q.get('pt2') || 0; if (st2) { for (const g of figs) g.state = st2; for (let t = 0; t < pt2; t += 1 / 60) upd(1 / 60); } }
  GT.showcase.people = ({ scene }) => { const q = new URLSearchParams(location.search), force = q.get('st'), only = q.get('k'), rot = +q.get('rot') || 0, stats = q.get('stats');
    stage(scene, q.get('wall') !== '0');
    const list = [['partner', {}, 'carry_run', 5], ['partner', { mask: false, seed: 2 }, 'crouch'], ['clerk', {}, 'handsup'], ['cop', {}, 'aim'], ['cop', { seed: 1 }, 'talk'], ['ped', { seed: 0 }, 'phone'], ['ped', { seed: 1 }, 'run', 3.4], ['ped', { seed: 2 }, 'walk', 1.3],
      ['ped', { seed: 3 }, 'idle'], ['ped', { seed: 4 }, 'wave'], ['ped', { seed: 5 }, 'talk'], ['driver', { seed: 1 }, 'drive']].filter(l => !only || l[0] === only || (l[1].seed !== undefined && only === 'ped' + l[1].seed));
    const figs = [], sp = +q.get('gap') || 1.18; let msg = '';
    list.forEach((l, i) => { const f = GT.people.make(l[0], l[1]); f.group.position.set((i - (list.length - 1) / 2) * sp, l[0] === 'driver' ? .46 : 0, 0); f.group.rotation.y = rot + (l[2] === 'aim' ? .75 : 0); scene.add(f.group); figs.push({ f, state: force || l[2], speed: l[3] }); msg += l[0] + (l[1].seed || '') + ':' + f.tris + ' ';
      if (l[0] === 'driver') { const k = GT.kit(); k.box('metal_dark', .5, .44, .5, f.group.position.x, .22, -.05, { bevel: .02 }); scene.add(k.build()); } });
    if (stats) document.getElementById('err').textContent += msg + '\n';
    const look = new T.Vector3(0, 1.5, 9), upd = dt => { for (const g of figs) g.f.update(dt, { state: g.state, speed: g.speed, lookAt: q.get('look1') ? look : (g.state === 'aim' ? _v2.set(g.f.group.position.x + 7, 1.35, 7) : null) }); };
    preroll(figs, upd, q); return { cam: [0, 1.5, 8], look: [0, .95, 0], hours: 18.2, update: upd }; };
  const _v2 = new T.Vector3();
  GT.showcase.people_walk = ({ scene }) => { const q = new URLSearchParams(location.search); stage(scene, q.get('wall') !== '0');
    const defs = [['ped', { seed: 4 }, 'walk', 1.35, -1.2, 1], ['ped', { seed: 0 }, 'walk', 1.2, -2.0, -1], ['ped', { seed: 3 }, 'walk', .85, .9, 1], ['partner', {}, 'carry_run', 5.6, .2, 1], ['ped', { seed: 1 }, 'run', 3.3, 1.8, -1], ['ped', { seed: 5 }, 'walk', 1.5, -.5, -1], ['ped', { seed: 2 }, 'walk', 1.45, 2.6, 1]];
    const figs = defs.map((d, i) => { const f = GT.people.make(d[0], d[1]); f.group.position.set([-3.4, 2.6, -1.2, -5.5, 4.2, .6, -4.6][i], 0, d[4]); f.group.rotation.y = d[5] * PI / 2; scene.add(f.group); return { f, d }; });
    const upd = dt => { for (const g of figs) { const p = g.f.group.position; p.x += g.d[5] * g.d[3] * dt; if (p.x > 9) p.x -= 18; if (p.x < -9) p.x += 18; g.f.update(dt, { state: g.d[2], speed: g.d[3] }); } };
    preroll(figs, upd, q); return { cam: [0, 1.55, 7], look: [0, 1, 0], hours: 18.2, update: upd }; };
  /* ---- round 2 showcases. Common query params: &at=<seconds> pre-rolls the update loop (scrub animation in stills), &rear=1 turns figures away from the camera */
  const QS = () => new URLSearchParams(location.search);
  const roll = (upd, q) => { const at = +q.get('at') || 0; for (let t = 0; t < at; t += 1 / 30) upd(1 / 30); };
  const note = msg => { const el = document.getElementById('err'); if (el) el.textContent += msg + '\n'; };
  GT.showcase.people_close = ({ scene }) => { const q = QS(), rear = q.get('rear') === '1', set_ = +q.get('set') || 0, gap = +q.get('gap') || .95; stage(scene, q.get('wall') !== '0');
    const SETS = [[['local_m', 3, 'idle'], ['beach_f', 1, 'drink'], ['oldman', 2, 'talk_group'], ['local_f', 4, 'phone_look'], ['musician', 1, 'idle'], ['baller', 2, 'idle']],
      [['tourist', 1, 'talk_group'], ['jogger', 3, 'idle'], ['beach_m', 2, 'idle'], ['patron_f', 1, 'drink'], ['guard', 0, 'idle'], ['skater', 1, 'idle']],
      [['bartender', 0, 'idle'], ['lifeguard', 1, 'drink'], ['rider', 0, 'phone_look'], ['cook', 0, 'smoke'], ['lifter', 1, 'idle'], ['tourist_f', 2, 'idle']],
      [['local_m', 7, 'smoke'], ['local_f', 9, 'talk_group'], ['worker', 1, 'idle'], ['oldwoman', 0, 'idle'], ['angler', 0, 'idle'], ['wrestler', 1, 'shrug']],
      [['local_m', 11, 'idle'], ['local_m', 12, 'phone_look'], ['local_f', 13, 'idle'], ['local_f', 14, 'drink'], ['patron_m', 2, 'drink'], ['guest', 1, 'idle']],
      [['partner', 0, 'idle'], ['partner', 2, 'idle', { mask: false }], ['clerk', 0, 'idle'], ['cop', 0, 'idle'], ['cop', 1, 'talk'], ['jogger_m', 1, 'idle']]];
    const list = SETS[set_ % SETS.length], figs = []; let msg = '';
    list.forEach((l, i) => { const f = GT.people.make(l[0], Object.assign({ seed: l[1] }, l[3])); f.group.position.set((i - (list.length - 1) / 2) * gap, 0, (i % 2) * .12); f.group.rotation.y = (rear ? PI : 0) + (i - 2.5) * -.06; scene.add(f.group); figs.push({ f, state: q.get('st') || l[2] }); msg += l[0] + ':' + f.tris + '/' + f.meshes.length + ' '; });
    if (q.get('stats')) note(msg);
    if (q.get('audit')) { let mx = 0, who = '', n = 0, t0 = performance.now(); for (const ty of GT.people.pedTypes.concat(['partner', 'clerk', 'cop', 'driver'])) for (let sd = 0; sd < 6; sd++) { const f = GT.people.make(ty, { seed: sd }); n++; if (f.tris > mx) { mx = f.tris; who = ty + '#' + sd; } if (f.meshes.length > 3) note('draw calls > 3: ' + ty); }
      note('audit: ' + n + ' figures, max tris ' + mx + ' (' + who + '), build ' + Math.round(performance.now() - t0) + ' ms total'); }
    const look = new T.Vector3(0, 1.5, 6), upd = dt => { for (const g of figs) g.f.update(dt, { state: g.state, lookAt: q.get('look1') ? look : null }); };
    roll(upd, q); return { cam: [0, 1.5, 3.1], look: [0, 1.02, 0], hours: 18.2, update: upd }; };
  /** every round-2 behaviour in rows. &from=&n= window the list, &s=state1,state2 picks states, &var=n forces a pose variant */
  GT.showcase.people_ambient = ({ scene }) => { const q = QS(), k = GT.kit(), gap = +q.get('gap') || 1.5;
    const DEF = { lean_wall: ['local_m', 2], sit_bench: ['oldman', 1], sit_ground: ['beach_f', 2], sit_stool: ['patron_m', 1], talk_group: ['local_f', 3], phone_look: ['local_m', 5], phone_call: ['tourist_f', 1], smoke: ['cook', 1], drink: ['patron_f', 2], dance: ['patron_f', 4],
      cheer: ['local_m', 6], film: ['tourist', 2], flee: ['local_f', 6], cower: ['local_m', 8], point: ['oldman', 3], shrug: ['local_m', 9], play_guitar: ['musician', 0], dribble: ['baller', 1], shoot_hoop: ['baller', 3], lift: ['lifter', 0], spot: ['lifter', 2],
      wrestle_a: ['wrestler', 0], wrestle_b: ['wrestler', 3], carry_box: ['worker', 2], sweep: ['worker', 3], fish: ['angler', 1], sunbathe: ['beach_m', 3], lean_rail: ['guest', 2], skate: ['skater', 2], scoot: ['rider', 1], stretch: ['jogger', 2], jog: ['jogger_m', 2] };
    let names = Object.keys(DEF); if (q.get('s')) names = q.get('s').split(','); const from = +q.get('from') || 0, n = +q.get('n') || names.length; names = names.slice(from, from + n);
    const perRow = +q.get('row') || 11, figs = [], clock = { t: 0 }, vr = q.get('var');
    k.box('concrete', 60, .3, 40, 0, -.15, 0); k.decal('oil_stain', 1.8, 1.8, 2.5, .012, 3.2, .5);
    names.forEach((nm, i) => { const d = DEF[nm] || ['local_m', i], row = (i / perRow) | 0, col = i % perRow, cnt = Math.min(perRow, names.length - row * perRow), x = (col - (cnt - 1) / 2) * gap, z = -row * 3.4;
      const o = { seed: d[1] }; if (vr !== null) o.variant = +vr; if (nm === 'carry_box') o.kit = { aux: 'box' }; if (nm === 'sweep') o.kit = { aux: 'broom' }; if (nm === 'sit_stool') o.hold = true;
      const f = GT.people.make(d[0], o); let px = x, pz = z, ry = 0;
      if (nm === 'lean_wall') { k.box('stucco_cream', 1.3, 2.6, .2, x, 1.3, z - .41, { bevel: .01 }); }
      if (nm === 'sit_bench') { k.box('wood_plank', 1.2, .06, .42, x, .43, z - .2, { bevel: .01 }); k.box('wood_plank', 1.2, .5, .05, x, .75, z - .44, { bevel: .01, rx: -.15 }); for (const s of [-1, 1]) k.box('metal_dark', .05, .42, .4, x + s * .55, .21, z - .2, { bevel: .008 }); }
      if (nm === 'sit_stool') { k.cyl('wood_plank', .17, .17, .04, x, .74, z - .13, { seg: 14 }); k.cyl('metal_dark', .03, .2, .72, x, .36, z - .13, { seg: 8 }); k.box('wood_plank', 1.3, .06, .5, x, 1.08, z + .42, { bevel: .01 }); k.box('wood_painted', 1.3, 1.05, .1, x, .525, z + .5, { bevel: .01 }); }
      if (nm === 'lean_rail') { k.box('metal_painted_white', 1.3, .05, .06, x, 1.06, z + .36, { bevel: .01 }); for (const s of [-1, 1]) k.box('metal_painted_white', .05, 1.06, .05, x + s * .62, .53, z + .36, { bevel: .008 }); }
      if (nm === 'wrestle_a') { px = x + .3; ry = PI / 2; } if (nm === 'wrestle_b') { px = x - gap + .3 + .8; ry = -PI / 2; }
      if (nm === 'spot') { px = x - gap; pz = z - .75; }
      if (nm === 'sunbathe') { k.box('fabric_dark', .8, .015, 1.9, x, .008, z - .4, { bevel: .004 }); }
      if (nm === 'shoot_hoop') { k.cyl('metal_dark', .06, .06, 3.4, x, 1.7, z + 5.2, { seg: 8 }); k.box('plastic_white', 1.8, 1.05, .04, x, 3.45, z + 4.9, { bevel: .01 }); k.geo('metal_painted_red', new T.TorusGeometry(.23, .012, 6, 18), { x, y: 3.05, z: z + 4.62, rx: PI / 2 }); }
      f.group.position.set(px, 0, pz); f.group.rotation.y = ry + (q.get('rear') === '1' ? PI : 0) + (+q.get('rot') || 0); scene.add(f.group); figs.push({ f, nm, speed: nm === 'flee' ? 5.4 : nm === 'jog' ? 3.2 : nm === 'carry_box' ? 1.1 : nm === 'skate' ? 3 : undefined, dist: 4.62 }); });
    scene.add(k.build()); if (q.get('stats')) note(figs.map(g => g.nm + ':' + g.f.tris).join(' '));
    const look = new T.Vector3(3, 1.6, 9), upd = dt => { clock.t += dt; for (const g of figs) g.f.update(dt, { state: g.nm, speed: g.speed, sync: clock.t, dist: g.dist, lookAt: (g.nm === 'film' || g.nm === 'point') ? look : null }); };
    roll(upd, q); return { cam: [0, 2.4, 9.5], look: [0, .9, -1], hours: 18.2, update: upd }; };
  /** the real world (road + station + motel + hangouts when present) with populate(). &v=<n> picks a street-level vantage (see VANTAGE), &at= pre-rolls,
      &p=x,z overrides the virtual player position, &ev=gunpoint|crash|siren|fight[&ex=&ez=] fires an event at the look point after &evat= seconds (default 0), &barks=1 prints barks, &stats=1 */
  const VANTAGE = [
    { n: 'storefront', cam: [45.9, 1.72, 4.6], look: [49.3, 1.15, 10.2] }, { n: 'pumps', cam: [33.6, 1.68, -8.6], look: [30.1, 1.15, -12.1] }, { n: 'musician', cam: [-6.6, 1.7, 14.2], look: [-9.4, 1.05, 8.6] },
    { n: 'bar', cam: [-25.6, 1.4, 35.2], look: [-31, .6, 31.4] }, { n: 'court', cam: [-29.6, .7, -53.6], look: [-34.6, .2, -60.4] }, { n: 'gym', cam: [-24.6, .6, -16.2], look: [-29.4, .1, -19.8] },
    { n: 'pool', cam: [46.8, 1.75, 89.6], look: [50.2, .6, 84.6] }, { n: 'pier', cam: [-69.6, 1.9, 77.2], look: [-73.6, 1.3, 79.3] }, { n: 'sand', cam: [-17.6, .5, 8.6], look: [-22.2, -.9, 4.2] },
    { n: 'seawall', cam: [-7.0, 1.7, 23.4], look: [-10.4, .95, 27.6] }, { n: 'workers', cam: [45.8, 1.7, -21.2], look: [48.9, 1.0, -26.4] }, { n: 'locals', cam: [-6.6, 1.7, 48.6], look: [-9.2, 1.0, 52.3] },
    { n: 'motel_rail', cam: [65.5, 1.7, 65.5], look: [72.4, 4.3, 71.5] }, { n: 'promenade', cam: [-8.9, 1.7, -3.5], look: [-8.6, 1.2, 12] }, { n: 'strip_wide', cam: [41.5, 1.75, 1.0], look: [49.5, 1.2, 7.5] }, { n: 'ring', cam: [113.2, 1.75, 59.2], look: [120, 1.5, 63.8] }, { n: 'corner', cam: [56.2, 1.72, -35.6], look: [59, 1.0, -31] }];
  GT.showcase.people_world = ({ scene }) => { const q = QS(), vi = +q.get('v') || 0, V = VANTAGE[vi % VANTAGE.length], ups = [], barks = [];
    const tryB = (name, fn) => { try { const r = fn(); return r; } catch (e) { note('[people_world] ' + name + ' failed: ' + (e && e.message)); return null; } };
    if (GT.road && GT.road.build) tryB('road', () => GT.road.build(scene)); if (GT.station && GT.station.build) tryB('station', () => GT.station.build(scene)); if (GT.motel && GT.motel.build) tryB('motel', () => GT.motel.build(scene));
    if (GT.hangouts && GT.hangouts.build && q.get('hang') !== '0') { tryB('hangouts', () => GT.hangouts.build(scene)); if (GT.hangouts.install) tryB('hangouts.install', () => GT.hangouts.install()); }
    for (const m of ['road', 'station', 'motel', 'hangouts']) if (GT[m] && GT[m].update) ups.push(GT[m].update);
    if (!GT.road) { const k = GT.kit(); k.box('concrete', 400, .2, 400, 0, -.1, 0); scene.add(k.build()); }
    const pop = GT.people.populate(scene, { max: +q.get('max') || undefined, onBark: (n, text, cat) => { barks.push(n.type + '@' + n.grp + ': ' + text); if (q.get('barks')) note('「' + text + '」 — ' + n.type + ' / ' + n.grp + ' / ' + cat); } });
    GT.showcase._pop = pop;
    const cam = q.get('cam') ? q.get('cam').split(',').map(Number) : V.cam, look = q.get('look') ? q.get('look').split(',').map(Number) : V.look, pp = q.get('p') ? q.get('p').split(',').map(Number) : [cam[0], cam[2]];
    const player = { x: pp[0], z: pp[1], speed: +q.get('ps') || 0 }, ev = q.get('ev'), ex = q.get('ex') !== null ? +q.get('ex') : look[0], ez = q.get('ez') !== null ? +q.get('ez') : look[2], evat = +q.get('evat') || 0; let T1 = 0;
    const upd = dt => { T1 += dt; for (const u of ups) { try { u(dt); } catch (e) { } } pop.update(dt, player, ev && T1 >= evat ? [{ type: ev, x: ex, z: ez }] : null); };
    roll(upd, q);
    if (q.get('stats')) note('npcs ' + pop.stats.count + ' tris ' + pop.stats.tris + ' visible ' + pop.stats.visible + ' near ' + pop.stats.near + ' groups ' + Object.keys(pop.groups).map(g => g + ':' + pop.groups[g].length).join(' '));
    if (q.get('dump')) note(JSON.stringify(Object.keys(GT.world.anchors).reduce((o, k2) => { const a = GT.world.anchors[k2]; o[k2] = [+(+a.x).toFixed(2), a.y === undefined ? null : +(+a.y).toFixed(2), +(+a.z).toFixed(2), a.h === undefined ? null : +(+a.h).toFixed(2)]; return o; }, {})));
    return { cam, look, hours: 18.4, update: upd }; };
  GT.people.vantage = VANTAGE;
  /* ------------------------------------------------------------------ China edition showcases
     people_cn        line-up of the street archetypes at ~3 m.  &set=<n> (8 per set) | &k=type,type  &rear=1  &st=<state>  &idle=1  &sp=<speed>  &at=<s>  &seed=  &stats=1  &audit=1
     people_cn_named  辣姐 / 拐子哥 / 爷叔 / 满哥 / 二筒 + two of his crew.  &rear=1  &st=  &at=
     people_cn_life   one behaviour group driven by populateCN on a small self-built set.  &group=dance|swim|chess|mahjong|queue|stream|chengguan|pengci  &at=<s>  &barks=1  &ev=<event>&evat=<s>
     people_cn_world  the real 四方街 (whatever world modules are loaded) with populateCN.  &v=<vantage name>  &t=<hours>  &at=  &stats=1  &barks=1 */
  const CN_DEMO = { auntie_dance: 'fan_dance', auntie_lead: 'fan_dance', swim_uncle: 'idle', angler_cn: 'fish', chess_uncle: 'kibitz', uncle: 'smoke_squat', auntie: 'scold', bird_uncle: 'bird_walk', whip_uncle: 'whip_top', pengci: 'demand', streamer_f: 'livestream', streamer_m: 'film', tourist_cn: 'tour_follow', guide: 'tour_lead', match_parent: 'flyer', chengguan: 'chase', vendor: 'push_cart',
    rider_y: 'squat_phone', rider_b: 'phone_look', daijia: 'smoke', bangbang: 'carry_pole', sanitation: 'sweep', guard_cn: 'idle', student: 'idle', office_m: 'phone_look', office_f: 'idle', granny: 'pull_trolley', kid: 'balance_bike', dog_owner: 'idle', dog: 'dog_sit', traffic_police: 'traffic', thug: 'punch' };
  function cnStage(scene, wall) { const k = GT.kit(); k.box('concrete_stained', 60, .3, 40, 0, -.15, 0); for (let x = -28; x <= 28; x += 2) k.box('concrete', .03, .012, 40, x, .002, 0); for (let z = -18; z <= 18; z += 2) k.box('concrete', 60, .012, .03, 0, .002, z);
    if (wall) { k.box('brick_painted', 34, 3.6, .3, 0, 1.8, -3.4, { bevel: .01 }); k.box('tile_floor', 34, .9, .32, 0, .45, -3.39, { bevel: .01 }); k.box('concrete_stained', 34, .16, .6, 0, .08, -3.0, { bevel: .02 });
      for (const q of [[-9, '四方街居民公约 · 讲文明 树新风', '#b3201a', '#f6d84a'], [0, '办证 · 疏通下水道 · 开锁', '#e9e4d2', '#1d3f78'], [9, '禁止乱贴乱画 违者罚款', '#1d4f8f', '#f4f1e6']]) { const m = new T.MeshStandardMaterial({ map: GT.signTex(q[1], { w: 1024, h: 128, bg: q[2], color: q[3] }), roughness: .7 }); const p = new T.Mesh(new T.PlaneGeometry(5.2, .65), m); p.position.set(q[0], 2.55, -3.24); scene.add(p); } }
    k.decal('oil_stain', 1.8, 1.8, 2.5, .014, 1.2, .5); k.decal('crack', 3, 3, -3, .014, .8, 1.2); k.decal('gum_spots', 2.5, 2.5, .4, .014, 1.6, 0); scene.add(k.build()); }
  /** people_npc — review harness for the round-3 figures. k=<type[,type]> seed= st=<state> sp=<speed> at=<s> d=<camera distance: 2 | 6 | 20> view=front|face|side|rear|q|hands|feet
       n=<copies> step=<s between copies> gap=  -> a strip of phases;  lod=0|1 (force)  rot=  seat=  var=  wall=1  stats=1  play=1 */
  GT.showcase.people_npc = ({ scene }) => { const q = QS(), names = (q.get('k') || 'auntie').split(','), st = q.get('st') || 'idle', n = Math.max(+q.get('n') || 1, names.length), step = +q.get('step') || .12, at = q.get('at') !== null ? +q.get('at') : 1.5, d = +q.get('d') || 2, view = q.get('view') || 'front', gap = +q.get('gap') || 1.2, figs = [], lod = q.get('lod') !== null ? +q.get('lod') : (d > 15 ? 1 : 0); cnStage(scene, q.get('wall') === '1'); let msg = '';
    for (let i = 0; i < n; i++) { const o = { seed: q.get('seed') !== null ? +q.get('seed') : 1 + i * 3, lod }; if (q.get('seat') !== null) o.seat = +q.get('seat'); if (q.get('var') !== null) o.variant = +q.get('var'); const t0 = performance.now(), f = GT.people.make(names[i % names.length], o), s = { state: st, sync: 0 }; if (q.get('sp') !== null) s.speed = +q.get('sp');
      const c = (i - (n - 1) / 2) * gap; f.group.position.set(view === 'side' ? 0 : c, 0, view === 'side' ? c : 0); f.group.rotation.y = +q.get('rot') || 0; scene.add(f.group); const ti = at + (names.length > 1 ? 0 : i * step); for (let t = 0; t < ti; t += 1 / 60) { s.sync = t; f.update(1 / 60, s); } figs.push({ f, s, t: ti });
      if (f.stats) { const x = f.stats(); msg += names[i % names.length] + ' ' + x.tris + 't/' + x.draws + 'd ' + Math.round(performance.now() - t0) + 'ms  '; } }
    const h = figs[0].f.height, V = { front: [[.12 * d, h * (d < 3 ? .86 : .7), d], [0, h * (d < 3 ? .8 : .52), 0]], face: [[.06, h * .935, .5], [0, h * .93, 0]], side: [[-Math.max(d, 4.8), 1.15, 0], [0, .9, 0]], rear: [[-.15 * d, h * .9, -d], [0, h * .6, 0]], q: [[-d * .6, h * .95, d * .8], [0, h * .55, 0]], hands: [[-.5, 1.0, .6], [-.1, .9, .05]], feet: [[-.7, .35, .7], [0, .1, .05]] }[view] || [[0, 1.5, d], [0, 1, 0]];
    if (q.get('stats')) note(msg + ' | tex ' + Math.round(NBT.tex) + 'ms');
    const play = q.get('play') === '1'; return { cam: V[0], look: V[1], hours: 18.2, update(dt) { for (const g of figs) { if (play) g.t += dt; g.s.sync = g.t; g.f.update(play ? dt : 0, g.s); } } }; };
  /** people_bench — build + update cost of 30 mixed street NPCs (reported on the page). */
  GT.showcase.people_bench = ({ scene }) => { const q = QS(); cnStage(scene, false); const types = CN_TYPES.filter(t => t !== 'dog').concat(CN_NAMED), figs = [], t0 = performance.now(), N = +q.get('n') || 30, sts = ['idle', 'walk', 'talk', 'phone_look', 'square_dance', 'smoke_squat', 'walk', 'sit_stool', 'applaud', 'run'];
    for (let i = 0; i < N; i++) { const f = GT.people.make(types[i % types.length], { seed: i, lod: q.get('lod') !== null ? +q.get('lod') : (i < 10 ? 0 : 1) }); f.group.position.set((i % 10 - 4.5) * 1.1, 0, -((i / 10) | 0) * 1.6); scene.add(f.group); figs.push(f); }
    const t1 = performance.now(); for (let k = 0; k < 60; k++) for (let i = 0; i < N; i++) figs[i].update(1 / 60, { state: sts[i % sts.length], sync: k / 60 }); const t2 = performance.now(); for (let k = 0; k < 60; k++) for (let i = 0; i < N; i++) { figs[i].group.updateMatrixWorld(true); const m = figs[i].meshes[0]; if (m && m.skeleton) m.skeleton.update(); } const t3 = performance.now(); let tris = 0, draws = 0; for (const f of figs) if (f.stats) { const x = f.stats(); tris += x.tris; draws += x.draws; }
    note('bench: ' + N + ' NPCs  build ' + Math.round(t1 - t0) + ' ms total (textures ' + Math.round(NBT.tex) + ' ms, mid bodies ' + Math.round(NBT.build) + ' ms / ' + NBT.n + ', near bodies ' + Math.round(NBT.near) + ' ms / ' + NBT.nearN + ')  update ' + ((t2 - t1) / 60).toFixed(2) + ' ms per frame for ' + N + ' (' + ((t2 - t1) / 60 / N * 1000).toFixed(0) + ' us each) + matrices/skeleton ' + ((t3 - t2) / 60).toFixed(2) + ' ms  visible tris ' + tris + ' draws ' + draws);
    return { cam: [0, 2.6, 5.2], look: [0, .9, -1.2], hours: 18.2, update(dt) { for (let i = 0; i < N; i++) figs[i].update(dt, { state: sts[i % sts.length] }); } }; };
  GT.showcase.people_cn = ({ scene }) => { const q = QS(), rear = q.get('rear') === '1', per = +q.get('n') || 8, set_ = +q.get('set') || 0, gap = +q.get('gap') || .92, only = q.get('k'); cnStage(scene, q.get('wall') !== '0');
    const names = only ? only.split(',') : CN_TYPES.slice(set_ * per, set_ * per + per), figs = []; let msg = '';
    names.forEach((nm, i) => { const o = { seed: q.get('seed') !== null ? +q.get('seed') : (i * 3 + set_ + 1) }; if (nm === 'bangbang' && q.get('load') !== '0') o.kit = { aux: 'pole_load', propL: undefined }; const st = q.get('st') || (q.get('idle') ? 'idle' : CN_DEMO[nm]) || 'idle'; if (st === 'fish' || st === 'flyer') o.seat = .32;
      const f = GT.people.make(nm, o); f.group.position.set((i - (names.length - 1) / 2) * gap, 0, (i % 2) * .2); f.group.rotation.y = (rear ? PI : 0) + (+q.get('rot') || 0); scene.add(f.group); figs.push({ f, state: st, speed: q.get('sp') !== null ? +q.get('sp') : 0 }); msg += nm + ':' + f.tris + '/' + f.meshes.length + ' '; });
    if (q.get('stats')) note(msg);
    if (q.get('audit')) { let mx = 0, who = '', n = 0, dc = 0; const t0 = performance.now(); for (const ty of CN_TYPES.concat(CN_NAMED)) for (let sd = 0; sd < 4; sd++) { const f = GT.people.make(ty, { seed: sd }); n++; if (f.tris > mx) { mx = f.tris; who = ty + '#' + sd; } dc = Math.max(dc, f.meshes.length); if (f.meshes.length > 6) note('draw calls > 6: ' + ty); }
      note('audit: ' + n + ' figures, max tris ' + mx + ' (' + who + '), max draw calls ' + dc + ', build ' + Math.round(performance.now() - t0) + ' ms total'); }
    const clock = { t: 0 }, look = new T.Vector3(0, 1.5, 6), upd = dt => { clock.t += dt; for (const g of figs) g.f.update(dt, { state: g.state, speed: g.speed, sync: clock.t, lookAt: q.get('look1') ? look : null }); };
    roll(upd, q); return { cam: [0, 1.5, 3.9], look: [0, .98, 0], hours: 18.2, update: upd }; };
  GT.showcase.people_cn_named = ({ scene }) => { const q = QS(), rear = q.get('rear') === '1', gap = +q.get('gap') || 1.02; cnStage(scene, q.get('wall') !== '0');
    const L = [['thug', 'idle', { seed: 2, variant: 1 }], ['lajie', 'idle', {}], ['guaizi', 'cook', { variant: 1 }], ['yeshu', 'idle', { variant: 0 }], ['mange', 'cook', { variant: 0 }], ['ertong', 'smoke', {}], ['thug', 'punch', { seed: 5 }]], figs = []; let msg = '';
    L.forEach((l, i) => { const f = GT.people.make(l[0], l[2]); f.group.position.set((i - (L.length - 1) / 2) * gap, 0, (i === 0 || i === 6) ? -.5 : (i % 2) * .15); f.group.rotation.y = (rear ? PI : 0) + (i - 3) * -.05; scene.add(f.group); figs.push({ f, state: q.get('st') || l[1] }); msg += l[0] + ':' + f.tris + '/' + f.meshes.length + ' '; });
    if (q.get('stats')) note(msg); const clock = { t: 0 }, upd = dt => { clock.t += dt; for (const g of figs) g.f.update(dt, { state: g.state, speed: 0, sync: clock.t }); };
    roll(upd, q); return { cam: [0, 1.5, 3.5], look: [0, 1.0, 0], hours: 18.2, update: upd }; };
  const LIFE = {
    dance: { hours: 18.5, only: ['dance'], spots: { danceCentre: { x: 0, z: 0, h: -PI / 2 } }, cam: [-10.6, 1.6, 3.4], look: [-3.5, 1.05, .2], set(k) { k.box('terrazzo', 24, .05, 24, 0, .001, 0); const bx = -9.4, bz = -3.2; k.push(bx, 0, bz, { ry: PI / 2 + .25 }); for (const s of [-.24, .24]) { k.cyl('rubber', .13, .13, .07, s * 1.15, .13, -.12, { seg: 14, rz: PI / 2 }); k.tube('metal_painted_blue', [[s, .06, .26], [s, .1, -.1], [s, .9, -.2], [s * .9, 1.18, -.26]], .016, { seg: 6, steps: 10 }); } k.box('plastic_black', .5, .78, .42, 0, .5, .05, { bevel: .03 }); k.cyl('metal_dark', .17, .17, .02, 0, .62, .27, { seg: 20, rx: PI / 2 }); k.cyl('metal_dark', .07, .07, .02, 0, .32, .27, { seg: 14, rx: PI / 2 }); k.box('metal_galv', .46, .05, .3, 0, .08, .1, { bevel: .01 }); k.pop(); } },
    swim: { hours: 17.5, only: ['swim'], spots: { swimDive: { x: -5, z: 0, h: -PI / 2, y: 0 }, waterY: -.8 }, cam: [-.8, 1.5, 6.8], look: [-5.6, .3, -1.2], noFloor: true, set(k) { k.box('wood_plank', 9, .16, 14, -.85, -.08, -1, { bevel: .01 }); for (let z = -7.8; z < 6; z += .16) k.box('metal_dark', 9, .004, .012, -.85, .002, z); for (const z of [-7.5, -3, 1.5, 5.5]) k.cyl('concrete_stained', .16, .16, 2.2, -5.2, -1.2, z, { seg: 10 }); k.box('plastic_red', .5, .02, 1.1, -3.15, .012, 2.4, { bevel: .008 }); k.box('plastic_white', .5, .02, 1.1, -2.35, .012, 2.5, { bevel: .008, ry: .1 });
        const w = new T.Mesh(new T.PlaneGeometry(70, 60), GT.mat('water_pool')); w.rotation.x = -PI / 2; w.position.set(-36, -.8, 0); this.extra = w; const b = new T.Mesh(new T.PlaneGeometry(70, 60), GT.mat('concrete_stained', { color: 0x1c2a2c })); b.rotation.x = -PI / 2; b.position.set(-36, -2.6, 0); this.extra2 = b; } },
    chess: { hours: 15, only: ['chess'], spots: { chess0: { x: 0, z: 0, h: -.2, y: 0 } }, cam: [2.9, 1.65, 3.1], look: [0, .88, 0], set(k) { k.cyl('concrete', .28, .34, .08, 0, .04, 0, { seg: 14 }); k.cyl('concrete', .13, .16, .64, 0, .4, 0, { seg: 12 }); k.cyl('concrete', .56, .54, .09, 0, .765, 0, { seg: 24 }); const r = GT.rng('cnchess'); for (let p = 0; p < 14; p++) { const px = (r() - .5) * .56, pz = (r() - .5) * .6; k.cyl('wood_painted', .028, .028, .016, px, .822, pz, { seg: 10 }); k.cyl(p % 2 ? 'plastic_red' : 'plastic_black', .02, .02, .003, px, .831, pz, { seg: 8 }); }
        for (let s = 0; s < 4; s++) { const a = s * PI / 2 + .78; k.cyl('concrete', .19, .17, .455, cos(a) * .95, .228, sin(a) * .95, { seg: 14 }); } } },
    mahjong: { hours: 15, only: ['mahjong'], spots: { mahjong0: { x: 0, z: 0, h: 0, y: 0, seats: [0, 1, 2, 3].map(i => ({ x: sin(i * PI / 2) * .82, z: cos(i * PI / 2) * .82, h: i * PI / 2 + PI, y: .46 })) } }, cam: [-2.5, 1.7, 2.7], look: [0, .82, 0], set(k) { k.box('wood_plank', .92, .04, .92, 0, .74, 0, { bevel: .012 }); k.box(GT.mat('fabric_dark', { color: 0x1f5a3a }), .86, .006, .86, 0, .763, 0); for (const q of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box('metal_dark', .035, .74, .035, q[0] * .4, .37, q[1] * .4);
        const r = GT.rng('cnmah'); for (let i = 0; i < 40; i++) k.box(i % 5 ? 'plastic_white' : GT.mat('plastic_white', { color: 0x2f8a5a }), .026, .02, .036, (r() - .5) * .66, .777, (r() - .5) * .66, { ry: r() * 3, bevel: .004 }); for (let i = 0; i < 4; i++) { const a = i * PI / 2, x = sin(a) * .82, z = cos(a) * .82; k.cyl(i % 2 ? 'plastic_red' : 'metal_painted_blue', .15, .17, .44, x, .22, z, { seg: 12 }); k.cyl(i % 2 ? 'plastic_red' : 'metal_painted_blue', .165, .165, .02, x, .45, z, { seg: 12 }); } } },
    queue: { hours: 7.5, only: ['queue'], spots: (() => { const o = {}; for (let i = 0; i < 6; i++) o['queueReganmian' + i] = { x: 0, z: i * .8, h: i ? PI : PI / 2 }; return o; })(), cam: [-3.6, 1.6, -1.9], look: [.2, 1.0, 1.9], set(k, scene) { k.box('stucco_cream', .3, 3.4, 9, 1.75, 1.7, 1.5, { bevel: .01 }); k.box('tile_floor', .32, 1.0, 9, 1.74, .5, 1.5, { bevel: .01 }); k.box('metal_galv', .5, .05, 1.7, 1.4, .98, 0, { bevel: .01 }); k.box('wood_plank', .46, .94, 1.6, 1.42, .47, 0, { bevel: .01 }); k.box('glass_tint', .05, 1.1, 1.6, 1.62, 1.6, 0); for (const z of [-.5, 0, .5]) k.cyl('plastic_white', .075, .05, .07, 1.36, 1.04, z, { seg: 12 });
        const m = new T.MeshStandardMaterial({ map: GT.signTex('拐子热干面 · 过早就这一碗', { w: 1024, h: 160, bg: '#f4f1e6', color: '#b3201a' }), roughness: .7 }), p = new T.Mesh(new T.PlaneGeometry(5.2, .8), m); p.position.set(1.58, 2.75, 1.2); p.rotation.y = -PI / 2; scene.add(p); } },
    stream: { hours: 15, only: ['stream', 'tour'], spots: { viewpoint: { x: 0, z: 0, h: 0 }, ringPost: { x: -1.5, z: -1.6 }, tourA: { x: 2.8, z: 1.4 }, tourB: { x: 7, z: -3.5 }, tourLook: [0, 12, 30], swimGate: { x: 80, z: 80, h: 0 } }, cam: [-4.8, 1.6, -5.6], look: [.2, 1.1, -.4], set(k) { k.box('terrazzo', 26, .05, 16, 2, .001, -2); for (let x = -10; x <= 14; x += 2) k.box('metal_galv', .05, 1.1, .05, x, .55, 4.2); k.box('metal_galv', 24, .06, .07, 2, 1.1, 4.2, { bevel: .01 }); k.box('metal_galv', 24, .04, .04, 2, .55, 4.2); } },
    chengguan: { hours: 15, only: ['chengguan'], spots: { chaseLoop: [[0, 0], [0, -30], [-20, -30], [-20, 0]] }, cam: [3.4, 1.6, -15.5], look: [-.4, 1.0, -8], at: 9.5, set() { } },
    pengci: { hours: 15, only: ['pengci'], spots: { pengciAt: { x: 0, z: 0, h: PI / 2 } }, cam: [3.6, 1.45, 3.4], look: [.6, .55, .2], at: 10.4, player: { from: [30, .9], to: [-12, .9], v: 4.2, ride: true }, set(k) { for (let i = 0; i < 7; i++) k.box('road_paint_white', .45, .012, 3.2, 2.2, .003, -3 + i * .95, { ry: PI / 2 }); k.box('asphalt', 30, .02, 5, 0, -.006, 1.2); } }
  };
  GT.showcase.people_cn_life = ({ scene }) => { const q = QS(), gname = q.get('group') || 'dance', G = LIFE[gname] || LIFE.dance, k = GT.kit(), barks = [];
    if (!G.noFloor) { k.box('concrete_stained', 80, .3, 80, 0, -.151, 0); k.decal('crack', 3, 3, 2, .012, 2.5, 1); k.decal('grime_streak', 3, 3, -4, .012, -2, .4); } G.set(k, scene); const set = k.build(); scene.add(set); if (G.extra) scene.add(G.extra); if (G.extra2) scene.add(G.extra2);
    const hours = q.get('t') !== null ? +q.get('t') : G.hours, pop = GT.people.populateCN(scene, { hours, only: G.only, spots: G.spots, groundHeight: () => 0, onBark: (n, b) => { barks.push(b); if (q.get('barks')) note('「' + b.text + '」 ' + b.voice + ' — ' + n.type + ' / ' + n.grp); }, onEvent: (ty) => { if (q.get('barks')) note('[event] ' + ty); } });
    GT.showcase._pop = pop; const cam = q.get('cam') ? q.get('cam').split(',').map(Number) : G.cam, look = q.get('look') ? q.get('look').split(',').map(Number) : G.look, PL = G.player, pp = q.get('p') ? q.get('p').split(',').map(Number) : PL ? PL.from.slice() : [cam[0] + 40, cam[2] + 40];
    const player = { x: pp[0], z: pp[1], speed: 0, vehicle: PL && PL.ride ? 'scooter' : null }, ev = q.get('ev'), evat = +q.get('evat') || 0; let T1 = 0;
    const upd = dt => { T1 += dt; if (PL) { const dx = PL.to[0] - player.x, dz = PL.to[1] - player.z, d = Math.hypot(dx, dz), npc = pop.pengci.npc, stop = npc && pop.pengci.state !== 'idle', v = stop ? 0 : PL.v; player.speed = v; if (d > .1 && v) { player.x += dx / d * v * dt; player.z += dz / d * v * dt; } }
      pop.update(dt, player, ev && T1 >= evat ? [{ type: ev, x: look[0], z: look[2] }] : null); };
    const q2 = { get: key => key === 'at' ? (q.get('at') !== null ? q.get('at') : (G.at || 3)) : q.get(key) }; roll(upd, q2);
    if (q.get('stats')) note('npcs ' + pop.stats.count + ' active ' + pop.stats.active + ' tris ' + pop.stats.tris + ' | ' + pop.list.filter(n => n.active).map(n => n.type + ':' + n.state).join(' '));
    return { cam, look, hours, update: upd }; };
  const VANT_CN = { dance: [[-47, 1.7, 36], [-36, 1.0, 30], 18.3], swim: [[-61.4, .5, -15.2], [-65.6, -.9, -19.6], 17.8], chess: [[-25.9, 1.7, 46.4], [-23, .95, 49.4], 15], fish: [[-54.2, 1.7, 77.6], [-56.6, 1.0, 75], 15], match: [[-22, 1.7, -41.2], [-22, 1.0, -46], 15], queue: [[44.6, 1.7, -2], [47.9, 1.0, -4.6], 7.5], riders: [[42.6, 1.6, -12.6], [45.8, .7, -10], 12],
    mahjong: [[49.3, 1.7, 68.9], [46.6, .9, 66], 15], view: [[122.4, 1.7, -31.9], [126.5, 1.15, -29.6], 15], market: [[22.4, 1.7, -60.2], [22, 1.1, -65.5], 21], lajie: [[38.6, 1.7, 95.4], [37.5, 1.1, 99], 18.3], clock: [[30.2, 1.7, 130.4], [29.4, 1.2, 134.5], 18.2], plaza: [[-12, 5, 12], [-34, .5, 28], 18.3] };
  GT.showcase.people_cn_world = ({ scene }) => { const q = QS(), V = VANT_CN[q.get('v')] || VANT_CN.dance, ups = [], tryB = (name, fn) => { try { return fn(); } catch (e) { note('[people_cn_world] ' + name + ' failed: ' + (e && e.message)); return null; } };
    for (const m of ['cnroad', 'riverside', 'snackstreet', 'hotpot', 'landmarks']) if (GT[m] && GT[m].build) { tryB(m, () => GT[m].build(scene)); if (GT[m].update) ups.push(GT[m].update); }
    if (!GT.cnroad && !GT.riverside) { const k = GT.kit(); k.box('concrete_stained', 400, .2, 400, 0, -.1, 0); scene.add(k.build()); }
    const hours = q.get('t') !== null ? +q.get('t') : V[2], cam = q.get('cam') ? q.get('cam').split(',').map(Number) : V[0], look = q.get('look') ? q.get('look').split(',').map(Number) : V[1], pp = q.get('p') ? q.get('p').split(',').map(Number) : [cam[0], cam[2]];
    const pop = GT.people.populateCN(scene, { hours, max: +q.get('max') || undefined, only: q.get('g') ? q.get('g').split(',') : undefined, onBark: (n, b) => { if (q.get('barks')) note('「' + b.text + '」 ' + b.voice + ' — ' + n.type + ' / ' + n.grp); }, onEvent: ty => { if (q.get('barks')) note('[event] ' + ty); } }); GT.showcase._pop = pop;
    const player = { x: pp[0], z: pp[1], speed: +q.get('ps') || 0 }, ev = q.get('ev'), evat = +q.get('evat') || 0; let T1 = 0;
    const upd = dt => { T1 += dt; for (const u of ups) { try { u(dt); } catch (e) { } } pop.update(dt, player, ev && T1 >= evat ? [{ type: ev, x: look[0], z: look[2] }] : null); };
    if (q.get('selftest')) { let nb = 0, ne = 0, steps = 0, err = null; const seen = {}, t0 = performance.now(), p2 = GT.people.populateCN(scene, { hours: 12, max: 200, seed: 7, onBark: (n, b) => { nb++; if (!b.text || !b.voice) err = err || 'bark without text/voice'; }, onEvent: ty => { ne++; seen[ty] = 1; } });
      try { for (const hr of [6.5, 8, 12, 15, 18.3, 21, 23.5]) { p2.setHours(hr); const act = p2.list.filter(n => n.active); for (let i = 0; i < 360; i++) { const n = act[(i / 12 | 0) % Math.max(1, act.length)], ph = i % 12, a = i * .37, r = ph < 6 ? 6 - ph : .7, ride = (i / 12 | 0) % 3 === 1;
              const pl = n ? { x: n.x + Math.cos(a) * r, z: n.z + Math.sin(a) * r, h: Math.atan2(-Math.cos(a), -Math.sin(a)), speed: ph < 6 ? 4.5 : 0, vehicle: ride ? 'scooter' : null } : { x: 0, z: 0 };
              const evs = i % 90 === 45 && n ? [{ type: ['horn', 'crash', 'gunshot', 'fight', 'cheer', 'siren', 'stare', 'run_past', 'scooter_near', 'gunpoint'][(i / 90 | 0 + hr | 0) % 10], x: n.x + 2, z: n.z }] : null; p2.update(.05, pl, evs); steps++; }
            for (const n of act) { if (!isFinite(n.x + n.y + n.z + n.h)) err = err || ('NaN position: ' + n.type + ' / ' + n.grp + ' / ' + n.state); if (n.fig && !GT.people.states.includes(n.fig.state)) err = err || ('bad state ' + n.state); } }
        p2.place('yeshu', { x: 30, z: 133, h: 0, state: 'talk' }); p2.update(.05, { x: 30, z: 131 }); p2.release('yeshu'); p2.setGroup('thugs', false); p2.setGroup('thugs', true); p2.say('lajie'); p2.sayLine('guaizi', 1); p2.pengci.resolve(true); p2.emit('horn', 0, 0); p2.resnap(); if (!p2.find('guide') || !p2.queue.tail() || GT.people.voiceList().length < 150) err = err || 'api check failed'; }
      catch (e) { err = (e && e.stack || String(e)).split('\n').slice(0, 3).join(' | '); }
      note('selftest: ' + (err ? 'FAILED ' + err : 'ok') + ' — ' + steps + ' steps, ' + p2.stats.spawned + ' figures spawned, ' + nb + ' barks, ' + ne + ' events [' + Object.keys(seen).join(',') + '], voice lines ' + GT.people.voiceList().length + ', ' + Math.round(performance.now() - t0) + ' ms'); p2.dispose(); }
    roll(upd, q); if (q.get('stats')) note('npcs ' + pop.stats.count + ' active ' + pop.stats.active + ' visible ' + pop.stats.visible + ' near ' + pop.stats.near + ' tris(spawned) ' + pop.stats.tris + ' | ' + Object.keys(pop.groups).map(g => g + ':' + pop.groups[g].filter(n => n.active).length).join(' '));
    return { cam, look, hours, update: upd }; };
  GT.people.vantageCN = VANT_CN;
})();
