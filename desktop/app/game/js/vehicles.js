/* vehicles.js — SUNSET HEAT exterior car models. Owner: vehicles agent.
   GT.vehicles = { make(kind, opts), kinds, tris(kind) }
   make() -> { group, kind, dims:{L,W,H,wheelbase,track,wheelR,eye}, wheels:[FL,FR,RL,RR] (spin: rotation.x), steer:[FL,FR] (rotation.y),
               setLights({head,brake,reverse,left,right,siren,hazard}), update(dt), lights, meshes }
   Car space: origin on the ground at the car centre, +Z forward, +Y up, driver on the LEFT = +X.
   Bodies are lofted from keyframed cross-sections (Grid), wheel arches are cut by snapping the grid onto the arch circle, the greenhouse is a second
   sheared loft whose end caps are the windscreen / backlight. Everything merges into: paint, detail (vertex-coloured PBR + emissive lamp channels),
   chrome, plastic_black, glass_tint, glass_clear, 4 wheels, 1 ground-fx mesh (contact shadow + light pools)  => 11 draw calls. */
(function () {
  'use strict';
  const T = THREE, GT = window.GT, PI = Math.PI, TAU = PI * 2, HP = PI / 2;
  const cl = GT.clamp, lerp = GT.lerp, sst = GT.sstep, sin = Math.sin, cos = Math.cos, abs = Math.abs, sqrt = Math.sqrt, max = Math.max, min = Math.min, hyp = Math.hypot, ceil = Math.ceil;
  const lin = hex => { const c = GT.C(hex); return [c.r, c.g, c.b]; };

  /* ================================================================== maths helpers */
  /** monotone cubic through [[x,y],...] (no overshoot => clean body lines) */
  function K(k) {
    if (typeof k === 'number') return () => k;
    const n = k.length, xs = k.map(p => p[0]), ys = k.map(p => p[1]), d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0] || 0; m[n - 1] = d[n - 2] || 0;
    for (let i = 1; i < n - 1; i++) { if (d[i - 1] * d[i] <= 0) m[i] = 0; else { const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i], w1 = 2 * h1 + h0, w2 = h1 + 2 * h0; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); } }
    return x => { if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1]; let i = 0; while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]; };
  }
  /** piecewise linear through [[x, a, b, ...], ...] -> x => [a, b, ...] */
  function PL(k) { return x => { if (x <= k[0][0]) return k[0].slice(1); const n = k.length; if (x >= k[n - 1][0]) return k[n - 1].slice(1); let i = 0; while (x > k[i + 1][0]) i++; const t = (x - k[i][0]) / (k[i + 1][0] - k[i][0]); return k[i].slice(1).map((v, j) => lerp(v, k[i + 1][j + 1], t)); }; }
  function mkGeo(P, N, U, I) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('normal', new T.BufferAttribute(new Float32Array(N), 3)); g.setAttribute('uv', new T.BufferAttribute(new Float32Array(U), 2)); g.setIndex(new T.BufferAttribute(new Uint32Array(I), 1)); return g; }
  const xf = o => { const s = o.s === undefined ? 1 : o.s; return new T.Matrix4().compose(new T.Vector3(o.x || 0, o.y || 0, o.z || 0), new T.Quaternion().setFromEuler(new T.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ')), Array.isArray(s) ? new T.Vector3(s[0], s[1], s[2]) : new T.Vector3(s, s, s)); };
  const MIRROR = new T.Matrix4().makeScale(-1, 1, 1);

  /* ================================================================== material specs ("ms")
     string  : 'paint' (body colour) or any GT.MATERIALS name
     {paint:[r,g,b] linear multiplier | hex, satin}   : paint mesh, per-vertex tint (two-tone liveries, satin black-outs)
     {c, r, m, ch, tex}  : detail mesh — vertex colour, roughness, metalness, lamp channel; tex:true keeps the part's own UVs (atlas decals / tyres) */
  const WHITE_UV = [.625, .875], RC = {};
  function RES(ms) {
    if (typeof ms === 'string') return RC[ms] || (RC[ms] = { bag: ms, c: [1, 1, 1], a: [0, 0, 0] });
    if (ms._r) return ms._r;
    if (ms.paint !== undefined) return ms._r = { bag: 'paint', c: Array.isArray(ms.paint) ? ms.paint : lin(ms.paint), a: [ms.satin || 0, 0, 0] };
    return ms._r = { bag: 'detail', c: Array.isArray(ms.c) ? ms.c : lin(ms.c === undefined ? 0xffffff : ms.c), a: [ms.r === undefined ? .5 : ms.r, ms.m || 0, ms.ch || 0], uv: ms.tex ? null : WHITE_UV };
  }
  const CH = { head: 1, fl: 2, fr: 3, rl: 4, rr: 5, rev: 6, sirR: 7, sirB: 8, stop: 9, mark: 10, ral: 11, rar: 12, white: 13 }, NCH = 14;
  const M = {
    blk: { c: [.012, .012, .013], r: .55 }, blkS: { c: [.02, .02, .022], r: .32 }, blkM: { c: [.016, .016, .017], r: .8 }, gap: { c: [.003, .003, .003], r: .95 },
    chr: { c: [.92, .92, .94], r: .06, m: 1 }, alu: { c: [.78, .79, .81], r: .22, m: 1 }, aluS: { c: [.55, .56, .58], r: .38, m: 1 }, dkm: { c: [.07, .07, .075], r: .5, m: .9 }, iron: { c: [.2, .19, .18], r: .55, m: 1 },
    rubber: { c: [.014, .014, .015], r: .85 }, vinyl: { c: [.022, .022, .025], r: .6 }, seat: { c: [.03, .028, .027], r: .5 }, mirror: { c: [.85, .88, .9], r: .03, m: 1 }, liner: { c: [.05, .048, .045], r: .9 },
    decal: { c: [1, 1, 1], r: .42, m: .1, tex: true }, decalChr: { c: [.95, .95, .96], r: .12, m: 1, tex: true }, plate: { c: [1, 1, 1], r: .4, m: .25, tex: true },
    under: 'plastic_black'
  };
  const LC = {};
  /** lamp lens: col = 'red' | 'amber' | 'white' | 'bowl' | 'blue' | 'smoke' */
  function lens(col, ch) { const k = col + ch; if (LC[k]) return LC[k]; const P = { red: [[.4, .008, .01], .16, 0], amber: [[.85, .3, .02], .18, 0], white: [[.82, .84, .84], .1, .2], bowl: [[.9, .9, .88], .09, 1], blue: [[.03, .1, .75], .14, 0], smoke: [[.3, .32, .34], .06, 1], redDk: [[.28, .008, .01], .14, 0] }[col];
    return LC[k] = { c: P[0], r: P[1], m: P[2], ch }; }

  /* ================================================================== Bag: merge with extra per-vertex attributes (colour + params) */
  class Bag {
    constructor() { this.P = []; this.N = []; this.U = []; this.C = []; this.A = []; this.I = []; this.n = 0; }
    geo(g, c, a, uv) { const p = g.attributes.position.array, n = g.attributes.normal.array, t = g.attributes.uv ? g.attributes.uv.array : null, cnt = p.length / 3, o = this.n;
      for (let i = 0; i < cnt; i++) { this.P.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); this.N.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]); if (uv) this.U.push(uv[0], uv[1]); else if (t) this.U.push(t[i * 2], t[i * 2 + 1]); else this.U.push(0, 0); this.C.push(c[0], c[1], c[2]); this.A.push(a[0], a[1], a[2]); }
      if (g.index) { const ix = g.index.array; for (let k = 0; k < ix.length; k++) this.I.push(ix[k] + o); } else for (let i = 0; i < cnt; i++) this.I.push(o + i);
      this.n += cnt; }
    build(extra) { const g = mkGeo(this.P, this.N, this.U, this.I); if (extra) { g.setAttribute('color', new T.BufferAttribute(new Float32Array(this.C), 3)); g.setAttribute('aPar', new T.BufferAttribute(new Float32Array(this.A), 3)); } return g; }
  }

  /* ================================================================== Grid: a structured surface patch (the loft/skin primitive) */
  class Grid {
    constructor(nu, nv) { this.nu = nu; this.nv = nv; this.p = new Float32Array(nu * nv * 3); this.n = new Float32Array(nu * nv * 3); this.uv = null; this.m = new Array((nu - 1) * (nv - 1)); this.def = 'paint'; this.flip = false; }
    set(i, j, x, y, z) { const o = (i * this.nv + j) * 3; this.p[o] = x; this.p[o + 1] = y; this.p[o + 2] = z; }
    X(i, j) { return this.p[(i * this.nv + j) * 3]; } Y(i, j) { return this.p[(i * this.nv + j) * 3 + 1]; } Z(i, j) { return this.p[(i * this.nv + j) * 3 + 2]; }
    /** per-quad material spec: fn(i, j) -> ms | null (null = hole) */
    mats(fn) { const nv1 = this.nv - 1; for (let i = 0; i < this.nu - 1; i++) for (let j = 0; j < nv1; j++) this.m[i * nv1 + j] = fn(i, j); return this; }
    /** make the surface face roughly (dx,dy,dz) at quad (i,j) */
    face(i, j, dx, dy, dz) { const nv = this.nv, p = this.p, a = (i * nv + j) * 3, b = ((i + 1) * nv + j) * 3, d = (i * nv + j + 1) * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
      this.flip = ((uy * vz - uz * vy) * dx + (uz * vx - ux * vz) * dy + (ux * vy - uy * vx) * dz) < 0; return this; }
    /** smooth normals from the kept quads (area weighted). o: weldV (lathe seam), cx (zero nx on the centreline) */
    finish(o) { o = o || {}; const { nu, nv, p, n } = this, nv1 = nv - 1, sg = this.flip ? -1 : 1; n.fill(0);
      const acc = (a, b, c) => { const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2], ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az, vx = p[c * 3] - ax, vy = p[c * 3 + 1] - ay, vz = p[c * 3 + 2] - az,
        nx = (uy * vz - uz * vy) * sg, ny = (uz * vx - ux * vz) * sg, nz = (ux * vy - uy * vx) * sg; for (const k of [a, b, c]) { n[k * 3] += nx; n[k * 3 + 1] += ny; n[k * 3 + 2] += nz; } };
      for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nv1; j++) { if (this.m[i * nv1 + j] === null) continue; const a = i * nv + j, b = a + nv, c = b + 1, d = a + 1; acc(a, b, c); acc(a, c, d); }
      if (o.weldV) for (let i = 0; i < nu; i++) { const a = i * nv * 3, b = (i * nv + nv1) * 3; for (let k = 0; k < 3; k++) { const s = n[a + k] + n[b + k]; n[a + k] = n[b + k] = s; } }
      for (let k = 0; k < nu * nv; k++) { let x = n[k * 3], y = n[k * 3 + 1], z = n[k * 3 + 2]; if (o.cx && abs(p[k * 3]) < 1e-5) x = 0; const l = hyp(x, y, z); if (l < 1e-12) { n[k * 3] = 0; n[k * 3 + 1] = 1; n[k * 3 + 2] = 0; } else { n[k * 3] = x / l; n[k * 3 + 1] = y / l; n[k * 3 + 2] = z / l; } }
      if (!this.uv) { const uv = this.uv = new Float32Array(nu * nv * 2);
        for (let j = 0; j < nv; j++) { let s = 0; for (let i = 0; i < nu; i++) { if (i) { const a = (i * nv + j) * 3, b = a - nv * 3; s += hyp(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]); } uv[(i * nv + j) * 2] = s; } }
        for (let i = 0; i < nu; i++) { let s = 0; for (let j = 0; j < nv; j++) { if (j) { const a = (i * nv + j) * 3, b = a - 3; s += hyp(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]); } uv[(i * nv + j) * 2 + 1] = s; } } }
      return this; }
    /** bilinear position + normal at fractional grid coords -> [x,y,z,nx,ny,nz] */
    at(fi, fj) { const { nu, nv, p, n } = this; fi = cl(fi, 0, nu - 1); fj = cl(fj, 0, nv - 1); const i = min(fi | 0, nu - 2), j = min(fj | 0, nv - 2), u = fi - i, v = fj - j, a = (i * nv + j) * 3, b = a + nv * 3, c = b + 3, d = a + 3, wa = (1 - u) * (1 - v), wb = u * (1 - v), wc = u * v, wd = (1 - u) * v, r = [0, 0, 0, 0, 0, 0];
      for (let k = 0; k < 3; k++) { r[k] = p[a + k] * wa + p[b + k] * wb + p[c + k] * wc + p[d + k] * wd; r[3 + k] = n[a + k] * wa + n[b + k] * wb + n[c + k] * wc + n[d + k] * wd; }
      const l = hyp(r[3], r[4], r[5]) || 1; r[3] /= l; r[4] /= l; r[5] /= l; return r; }
    emit(B) { const { nu, nv, p, n, uv } = this, nv1 = nv - 1, groups = new Map();
      for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nv1; j++) { let ms = this.m[i * nv1 + j]; if (ms === null) continue; if (ms === undefined) ms = this.def; let g = groups.get(ms); if (!g) groups.set(ms, g = { idx: new Int32Array(nu * nv).fill(-1), P: [], N: [], U: [], I: [] });
        const v = k => { let t = g.idx[k]; if (t < 0) { t = g.idx[k] = g.P.length / 3; g.P.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]); g.N.push(n[k * 3], n[k * 3 + 1], n[k * 3 + 2]); g.U.push(uv[k * 2], uv[k * 2 + 1]); } return t; };
        const a = v(i * nv + j), b = v((i + 1) * nv + j), c = v((i + 1) * nv + j + 1), d = v(i * nv + j + 1); if (this.flip) g.I.push(a, c, b, a, d, c); else g.I.push(a, b, c, a, c, d); }
      for (const [ms, g] of groups) B.add(ms, mkGeo(g.P, g.N, g.U, g.I)); return this; }
    /** second, inward-facing layer for every quad of material `ms` (glass panes get a thickness, so the far side of the cabin is tinted too) */
    emitInner(B, ms, off, other) { const { nu, nv, p, n, uv } = this, nv1 = nv - 1, idx = new Int32Array(nu * nv).fill(-1), P = [], N = [], U = [], I = [];
      const v = k => { let t = idx[k]; if (t < 0) { t = idx[k] = P.length / 3; P.push(p[k * 3] - n[k * 3] * off, p[k * 3 + 1] - n[k * 3 + 1] * off, p[k * 3 + 2] - n[k * 3 + 2] * off); N.push(-n[k * 3], -n[k * 3 + 1], -n[k * 3 + 2]); U.push(uv[k * 2], uv[k * 2 + 1]); } return t; };
      for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nv1; j++) { const q = this.m[i * nv1 + j]; if (other ? (q === ms || q === null) : q !== ms) continue; const a = v(i * nv + j), b = v((i + 1) * nv + j), c = v((i + 1) * nv + j + 1), d = v(i * nv + j + 1); if (this.flip) I.push(a, b, c, a, c, d); else I.push(a, c, b, a, d, c); }
      if (I.length) B.add(other || ms, mkGeo(P, N, U, I)); return this; }
  }

  /* ================================================================== Builder: transform stack + primitives, everything lands in one Bag per material */
  class Builder {
    constructor() { this.bags = {}; this.st = [new T.Matrix4()]; this.white = WHITE_UV; }
    get top() { return this.st[this.st.length - 1]; }
    push(x, y, z, o) { o = o || {}; this.st.push(this.top.clone().multiply(xf({ x, y, z, rx: o.rx, ry: o.ry, rz: o.rz, s: o.s }))); return this; }
    pop() { if (this.st.length > 1) this.st.pop(); return this; }
    /** run fn(+1) then fn(-1) mirrored across the car centreline */
    sym(fn) { fn(1); this.st.push(MIRROR.clone().multiply(this.top)); fn(-1); this.st.pop(); return this; }
    add(ms, g, o) { const r = RES(ms), m = o ? this.top.clone().multiply(xf(o)) : this.top; if (!g.attributes.normal) g.computeVertexNormals(); g.applyMatrix4(m);
      if (m.determinant() < 0) { if (!g.index) { const n = g.attributes.position.count, ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new T.BufferAttribute(ix, 1)); } const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } }
      (this.bags[r.bag] || (this.bags[r.bag] = new Bag())).geo(g, r.c, r.a, r.uv ? this.white : null); g.dispose(); return this; }
    box(ms, w, h, d, x, y, z, o) { o = o || {}; return this.add(ms, GT.boxGeo(w, h, d, o.bevel), { x, y, z, rx: o.rx, ry: o.ry, rz: o.rz }); }
    cyl(ms, rt, rb, h, x, y, z, o) { o = o || {}; return this.add(ms, new T.CylinderGeometry(rt, rb, h, o.seg || 16, 1, !!o.open), { x, y, z, rx: o.rx, ry: o.ry, rz: o.rz }); }
    sph(ms, r, x, y, z, o) { o = o || {}; return this.add(ms, new T.SphereGeometry(r, o.seg || 16, o.seg2 || 10), { x, y, z, s: o.s, rx: o.rx, ry: o.ry, rz: o.rz }); }
    tube(ms, pts, r, o) { o = o || {}; const c = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p[0], p[1], p[2])), !!o.closed, 'catmullrom', o.tension === undefined ? .5 : o.tension); return this.add(ms, new T.TubeGeometry(c, o.steps || max(6, pts.length * 5), r, o.seg || 6, !!o.closed)); }
    /** surface of revolution about +Y. prof [[r,y],...] counter-clockwise (solid on the left). o: seg, flip + transform */
    lathe(ms, prof, o) { o = o || {}; const seg = o.seg || 24, G = new Grid(prof.length, seg + 1); for (let i = 0; i < prof.length; i++) for (let k = 0; k <= seg; k++) { const a = k / seg * TAU; G.set(i, k, prof[i][0] * cos(a), prof[i][1], prof[i][0] * sin(a)); }
      G.flip = !!o.flip; G.def = ms; G.finish({ weldV: true }); if (o.x !== undefined || o.rx !== undefined || o.rz !== undefined || o.y !== undefined || o.z !== undefined) { this.st.push(this.top.clone().multiply(xf(o))); G.emit(this); this.st.pop(); } else G.emit(this); return this; }
    /** flat textured quad facing +Z (rotate with o), uv rect = [u0,v0,u1,v1] */
    decal(ms, w, h, x, y, z, uvr, o) { o = o || {}; const g = new T.PlaneGeometry(w, h), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(uvr[0], uvr[2], uv.getX(i)), lerp(uvr[1], uvr[3], uv.getY(i))); return this.add(ms, g, { x, y, z, rx: o.rx, ry: o.ry, rz: o.rz }); }
    /** ribbon along a polyline given in GRID coordinates [[fi,fj],...]; w = metric width, lift = height above the surface, o.h = bead height (half-round trim) */
    line(G, pts, w, lift, ms, o) { o = o || {}; const sub = [];
      for (let s = 0; s < pts.length - 1; s++) { const a = pts[s], b = pts[s + 1], n = max(1, ceil(max(abs(b[0] - a[0]), abs(b[1] - a[1])) * (o.res || 1))); for (let k = s ? 1 : 0; k <= n; k++) sub.push(G.at(lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n))); }
      const N = sub.length, cols = o.h ? [[-.5, 0, -.75], [-.22, 1, -.2], [.22, 1, .2], [.5, 0, .75]] : [[-.5, 0, 0], [.5, 0, 0]], nc = cols.length, P = [], Nn = [], U = [], I = [], h = o.h || 0;
      for (let k = 0; k < N; k++) { const q = sub[k], a = sub[max(0, k - 1)], b = sub[min(N - 1, k + 1)]; let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = hyp(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        let bx = q[4] * tz - q[5] * ty, by = q[5] * tx - q[3] * tz, bz = q[3] * ty - q[4] * tx; const bl = hyp(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
        for (const c of cols) { const of = c[0] * w, up = lift + c[1] * h; P.push(q[0] + bx * of + q[3] * up, q[1] + by * of + q[4] * up, q[2] + bz * of + q[5] * up); let nx = q[3] + bx * c[2], ny = q[4] + by * c[2], nz = q[5] + bz * c[2]; const nl = hyp(nx, ny, nz); Nn.push(nx / nl, ny / nl, nz / nl); U.push(k * .02, c[0] * w); } }
      for (let k = 0; k < N - 1; k++) for (let c = 0; c < nc - 1; c++) { const a = k * nc + c, b = a + nc; I.push(a, b, b + 1, a, b + 1, a + 1); }
      return this.add(ms, mkGeo(P, Nn, U, I)); }
    /** surface patch riding on grid G: map(u,v) -> [fi,fj]; lifted by `lift` (+ o.bulge in the middle), with a sunk skirt so it reads as a separate part.
        o.uv = [u0,v0,u1,v1] maps an atlas rect onto it. */
    patch(G, map, nu, nv, lift, ms, o) { o = o || {}; const sk = o.skirt === undefined ? .004 : o.skirt, e = sk > 0 ? 1 : 0, g = new Grid(nu + 1 + 2 * e, nv + 1 + 2 * e); if (o.uv) g.uv = new Float32Array(g.nu * g.nv * 2);
      for (let i = 0; i < g.nu; i++) for (let j = 0; j < g.nv; j++) { const u = cl((i - e) / nu, 0, 1), v = cl((j - e) / nv, 0, 1), edge = e && (i === 0 || j === 0 || i === g.nu - 1 || j === g.nv - 1), f = map(u, v), q = G.at(f[0], f[1]), l = edge ? -sk : lift + (o.bulge || 0) * 16 * u * (1 - u) * v * (1 - v);
        g.set(i, j, q[0] + q[3] * l, q[1] + q[4] * l, q[2] + q[5] * l); if (o.uv) { g.uv[(i * g.nv + j) * 2] = lerp(o.uv[0], o.uv[2], u); g.uv[(i * g.nv + j) * 2 + 1] = lerp(o.uv[1], o.uv[3], v); } }
      const c = map(.5, .5), q = G.at(c[0], c[1]); g.face(g.nu >> 1, g.nv >> 1, q[3], q[4], q[5]); g.def = ms; g.finish(); g.emit(this); return this; }
  }
  const rect = (i0, i1, j0, j1) => (u, v) => [lerp(i0, i1, u), lerp(j0, j1, v)];
  /** sweep a profile [[out, y],...] along a plan path [[x,y,z,nx,nz,scale?],...] */
  function sweep(B, ms, path, prof, flip) { const G = new Grid(path.length, prof.length); path.forEach((p, i) => prof.forEach((q, j) => { const s = p[5] === undefined ? 1 : p[5]; G.set(i, j, p[0] + p[3] * q[0] * s, p[1] + q[1] * s, p[2] + p[4] * q[0] * s); })); G.flip = !!flip; G.def = ms; G.finish(); G.emit(B); return G; }
  /** bumper centre-line: straight across, round the corners, run back along the flanks. dir=+1 front, -1 rear */
  function bumperPath(zFace, xs, rc, side, y, dir, bow, Wn) { const h = []; for (let k = 0; k <= 8; k++) { const x = xs * k / 8; h.push([x, y, zFace - dir * bow * (x / Wn) * (x / Wn), 0, dir]); } const zc = zFace - dir * bow * (xs / Wn) * (xs / Wn) - dir * rc;
    for (let k = 1; k <= 7; k++) { const a = k / 7 * HP; h.push([xs + rc * sin(a), y, zc + dir * rc * cos(a), sin(a), dir * cos(a)]); } h.push([xs + rc, y, zc - dir * side * .6, 1, 0], [xs + rc - .012, y, zc - dir * side, 1, 0, .55]);
    const out = []; for (let k = h.length - 1; k > 0; k--) { const p = h[k]; out.push([-p[0], p[1], p[2], -p[3], p[4], p[5]]); } return out.concat(h); }

  /* ================================================================== the body shell */
  function makeBody(B, S) {
    const nR = S.nR || 5, nS = S.nS || 16, nH = S.nH || 6, nT = S.nT || 18, J0 = 3, JR = 3 + nR, JS = JR + nS, JH = JS + nH, JT = JH + nT, nv = JT + 1;
    const X = new Float64Array(nv), Y = new Float64Array(nv), F = S.front, Rr = S.rear; F.Wn = F.Wn || S.W(S.zF); Rr.Wn = Rr.Wn || S.W(S.zR);
    const prm = (z, d) => { d = d || 0; const W = S.W(z) - d, yb = S.yb(z) + d, yW = S.yW(z), ySh = S.ySh(z) - d, yC = S.yC(z) - d, rS = max(S.rS(z) - d * .5, .012), rSy = S.rSy(z), yR = yb + S.rr, xR = W - S.aLow, wf = xR - S.rrx, xSh = W - S.tum(z), xE = xSh - rS;
      return { z, W, yb, yW, ySh, yC, yR, xR, wf, xSh, xE, yE: ySh + rSy, rS, rSy, p: S.p(z) }; };
    const flare = (q, y) => { let f = 0; for (const a of S.arches) { if (!a.flare) continue; const dz = q.z - a.z; if (abs(dz) > a.R + .25) continue; const e = max(hyp(dz, y - a.y) - a.R, 0) / a.fw; f += a.flare * Math.exp(-e * e); } return f * cl((q.ySh - y) / .07, 0, 1); };
    const sideX = (q, y) => (y < q.yW ? q.W - S.aLow * Math.pow(cl((q.yW - y) / (q.yW - q.yR), 0, 1), S.eL) : q.W - (q.W - q.xSh) * Math.pow(cl((y - q.yW) / (q.ySh - q.yW), 0, 1), S.eU)) + flare(q, y) + (S.sideFx ? S.sideFx(q.z, y, q) : 0);
    const topY = (q, x) => { const f = min(abs(x) / q.xE, 1); return q.yE + (q.yC - q.yE) * (1 - Math.pow(f, q.p)) + (S.bulge ? S.bulge(abs(x), q.z, q) : 0); };
    const fill = q => { X[0] = 0; X[2] = min(S.xi, q.wf - .03); X[1] = X[2] * .5; X[3] = q.wf; Y[0] = Y[1] = Y[2] = Y[3] = q.yb;
      for (let t = 1; t <= nR; t++) { const a = t / nR * HP; Y[J0 + t] = q.yR - S.rr * cos(a); X[J0 + t] = q.wf + (q.xR - q.wf) * sin(a) + flare(q, Y[J0 + t]) * sin(a); }
      for (let t = 1; t <= nS; t++) { const y = q.yR + (q.ySh - q.yR) * t / nS; Y[JR + t] = y; X[JR + t] = sideX(q, y); }
      for (let t = 1; t <= nH; t++) { const a = t / nH * HP; X[JS + t] = q.xE + q.rS * cos(a); Y[JS + t] = q.ySh + q.rSy * sin(a); }
      for (let t = 1; t <= nT; t++) { const x = q.xE * (1 - t / nT); X[JH + t] = x; Y[JH + t] = topY(q, x); } };
    // ---- stations: [rear recess] rear lip | main | front lip [front recess]
    const st = [], nL = S.nL || 6, zA = S.zR + Rr.r, zB = S.zF - F.r, nM = Math.round((zB - zA) / S.dz);
    if (Rr.recess) { const d0 = Rr.r + Rr.tw; st.push({ z: S.zR + Rr.recess, d: d0 + .008, e: -1 }, { z: S.zR + .006, d: d0 + .006, e: -1 }, { z: S.zR, d: d0, e: -1 }); }
    for (let a = nL; a >= 1; a--) { const g = a / nL * HP; st.push({ z: S.zR + Rr.r * (1 - sin(g)), d: Rr.r * (1 - cos(g)), e: -1 }); }
    const i0 = st.length; for (let k = 0; k <= nM; k++) st.push({ z: lerp(zA, zB, k / nM), d: 0, e: 0 });
    for (let a = 1; a <= nL; a++) { const g = a / nL * HP; st.push({ z: S.zF - F.r * (1 - sin(g)), d: F.r * (1 - cos(g)), e: 1 }); }
    if (F.recess) { const d0 = F.r + F.tw; st.push({ z: S.zF, d: d0, e: 1 }, { z: S.zF - .006, d: d0 + .006, e: 1 }, { z: S.zF - F.recess, d: d0 + .008, e: 1 }); }
    const nu = st.length, G = new Grid(nu, nv), gi = z => i0 + (z - zA) / (zB - zA) * nM;
    const endOff = (E, r, x, y, dir) => { const u = x / E.Wn, v = cl((y - E.y0) / E.hy, -1.6, 1.6); return -dir * r * (E.bowX * u * u + (E.bowY || 0) * v * v - (E.rake || 0) * (y - E.y0)); };
    for (const s of st) { s.rF = s.z > F.start ? (s.e > 0 && s.d > F.r ? 1 : sst(s.z, F.start, S.zF)) : 0; s.rR = s.z < Rr.start ? (s.e < 0 && s.d > Rr.r ? 1 : sst(s.z, Rr.start, S.zR)) : 0; }
    const zo = (s, x, y) => (s.rF ? endOff(F, s.rF, x, y, 1) : 0) + (s.rR ? endOff(Rr, s.rR, x, y, -1) : 0);
    for (let i = 0; i < nu; i++) { const s = st[i]; fill(prm(s.z, s.d)); for (let j = 0; j < nv; j++) G.set(i, j, X[j], Y[j], s.z + zo(s, X[j], Y[j])); }
    // ---- wheel arches: snap every grid vertex inside the arch circle onto the circle, drop the quads that end up fully inside
    const ins = new Uint8Array(nu * nv);
    for (const a of S.arches) for (let i = i0; i <= i0 + nM; i++) { const z = st[i].z, dz = z - a.z; if (abs(dz) > a.R) continue;
      for (let j = 2; j < JS; j++) { const y = G.Y(i, j), dy = y - a.y; if (abs(dy) >= a.R) continue;
        if (j > JR && dy >= 0) { const dist = hyp(dz, dy); if (dist >= a.R) continue; ins[i * nv + j] = 1; const k = a.R / max(dist, 1e-5), z2 = dist < 1e-5 ? a.z : a.z + dz * k, y2 = dist < 1e-5 ? a.y + a.R : a.y + dy * k; G.set(i, j, sideX(prm(z2), y2), y2, z2); }
        else { const hc = sqrt(a.R * a.R - dy * dy); if (abs(dz) >= hc) continue; ins[i * nv + j] = 1; if (j === 2) continue; const sg = dz >= 0 ? 1 : -1; let z2 = a.z + sg * hc;
          for (let it = 0; it < 2; it++) { fill(prm(z2)); const d2 = Y[j] - a.y; z2 = a.z + sg * sqrt(max(a.R * a.R - d2 * d2, 0)); } fill(prm(z2)); G.set(i, j, X[j], Y[j], z2); } } }
    const bd = { G, st, i0, nM, gi, prm, J0, JR, JS, JH, JT, nS, nH, nT, nR, S,
      sx: (z, y) => sideX(prm(z), y), ty: (z, x) => topY(prm(z), x),
      gjS: (z, y) => { const q = prm(z); if (y < q.yR) return J0 + Math.acos(cl((q.yR - y) / S.rr, 0, 1)) / HP * nR; if (y <= q.ySh) return JR + (y - q.yR) / (q.ySh - q.yR) * nS; return JS + Math.asin(cl((y - q.ySh) / q.rSy, 0, 1)) / HP * nH; },
      gjT: (z, x) => { const q = prm(z); return x <= q.xE ? JH + (1 - x / q.xE) * nT : JS + Math.acos(cl((x - q.xE) / q.rS, 0, 1)) / HP * nH; } };
    bd.sLine = (z0, z1, y) => { const n = max(2, ceil(abs(z1 - z0) / .12)), r = []; for (let k = 0; k <= n; k++) { const z = lerp(z0, z1, k / n); r.push([gi(z), bd.gjS(z, typeof y === 'function' ? y(z) : y)]); } return r; };
    bd.tLine = (z0, z1, x) => { const n = max(2, ceil(abs(z1 - z0) / .12)), r = []; for (let k = 0; k <= n; k++) { const z = lerp(z0, z1, k / n); r.push([gi(z), bd.gjT(z, typeof x === 'function' ? x(z) : x)]); } return r; };
    bd.sMap = (z0, z1, y0, y1) => (u, v) => { const z = lerp(z0, z1, u); return [gi(z), bd.gjS(z, lerp(y0, y1, v))]; };
    bd.tMap = (z0, z1, x0, x1) => (u, v) => { const z = lerp(z0, z1, u); return [gi(z), bd.gjT(z, lerp(x0, x1, v))]; };
    G.mats((i, j) => { if (ins[i * nv + j] && ins[(i + 1) * nv + j] && ins[i * nv + j + 1] && ins[(i + 1) * nv + j + 1]) return null; const zc = (st[i].z + st[i + 1].z) / 2;
      if (j < J0) return M.under; if (j >= JS && S.cut && S.cut(zc, max(G.X(i, j), G.X(i + 1, j)))) return null; return S.mat ? S.mat(i, j, zc, bd) : 'paint'; });
    G.flip = true; G.finish({ cx: true }); B.sym(() => G.emit(B));
    // ---- end caps
    bd.cap = (dir, nk, matFn) => { const i = dir > 0 ? nu - 1 : 0, E = dir > 0 ? F : Rr, C = new Grid(JT - J0 + 1, nk + 1);
      for (let j = J0; j <= JT; j++) { const xj = G.X(i, j), y = G.Y(i, j), zj = G.Z(i, j), u0 = xj / E.Wn; for (let k = 0; k <= nk; k++) { const x = xj * (1 - 2 * k / nk), u = x / E.Wn; C.set(j - J0, k, x, y, zj + dir * E.bowX * (u0 * u0 - u * u)); } }
      C.flip = dir < 0; C.nk = nk; if (matFn) C.mats(matFn); C.finish(); C.emit(B);
      C.ij = (x, y) => { let r = 0; while (r < C.nu - 2 && C.Y(r + 1, 0) < y) r++; const y0 = C.Y(r, 0), y1 = C.Y(r + 1, 0), t = y1 - y0 > 1e-6 ? cl((y - y0) / (y1 - y0), 0, 1) : 0, xj = lerp(C.X(r, 0), C.X(r + 1, 0), t); return [r + t, cl((1 - x / max(xj, 1e-4)) * nk / 2, 0, nk)]; };
      C.map = (x0, y0, x1, y1) => (u, v) => C.ij(lerp(x0, x1, u), lerp(y0, y1, v)); C.quad = c => (u, v) => C.ij(lerp(lerp(c[0][0], c[1][0], u), lerp(c[3][0], c[2][0], u), v), lerp(lerp(c[0][1], c[1][1], u), lerp(c[3][1], c[2][1], u), v));
      return C; };
    /** flat panel filling the lower part of a recessed end (valance), top ledge running back to zBack */
    bd.fill = (dir, yMax, zf, zBack, ms) => { const i = dir > 0 ? nu - 3 : 2, E = dir > 0 ? F : Rr, rows = [];
      for (let j = J0; j <= JS; j++) { const x = G.X(i, j), y = G.Y(i, j); if (y < yMax || !rows.length) rows.push([x, y]); else { const p = rows[rows.length - 1], t = (yMax - p[1]) / max(y - p[1], 1e-5); rows.push([lerp(p[0], x, t), yMax]); break; } }
      const nk = 24, C = new Grid(rows.length + 1, nk + 1), bz = (x, y) => -dir * (E.bowX * (x / E.Wn) * (x / E.Wn) - (E.rake || 0) * (y - E.y0));
      rows.forEach((r, a) => { for (let k = 0; k <= nk; k++) { const x = r[0] * (1 - 2 * k / nk); C.set(a, k, x, r[1], zf + bz(x, r[1])); } });
      const r = rows[rows.length - 1]; for (let k = 0; k <= nk; k++) { const x = r[0] * (1 - 2 * k / nk); C.set(rows.length, k, x, r[1], zBack + bz(x, r[1])); }
      C.flip = dir < 0; C.def = ms; C.finish(); C.emit(B); return C; };
    return bd;
  }
  /** wheel-arch return lip + dark liner tub (built for +X, mirrored) */
  function archParts(B, bd, a, lipMs) { const S = bd.S, n = 36, q0 = bd.prm(a.z), t0 = Math.asin(cl((q0.yb + .004 - a.y) / a.R, -1, 1)), G = new Grid(n + 1, 6), lw = a.lip || .024;
    for (let k = 0; k <= n; k++) { const th = lerp(t0, PI - t0, k / n), z = a.z + a.R * cos(th), y = a.y + a.R * sin(th), q = bd.prm(z), R2 = a.R + .014, z2 = a.z + R2 * cos(th), y2 = a.y + R2 * sin(th);
      let x; if (y >= q.yR) x = bd.sx(z, y); else { const ca = cl((q.yR - y) / S.rr, 0, 1), sa = sqrt(1 - ca * ca); x = q.wf + (q.xR - q.wf) * sa; }
      G.set(k, 0, x + .0015, y, z); G.set(k, 1, x - lw, y, z); G.set(k, 2, x - lw - .004, y2, z2); G.set(k, 3, S.xi + .02, y2, z2); G.set(k, 4, S.xi, y2 - .02 * sin(th), z2 - .02 * cos(th)); G.set(k, 5, S.xi, a.y + .04, a.z); }
    G.mats((i, j) => j === 0 ? (lipMs || 'paint') : M.under); G.flip = true; G.finish(); B.sym(() => G.emit(B)); }

  /* ================================================================== the greenhouse (cabin): sheared loft; its end caps are the windscreen and backlight */
  function makeGreenhouse(B, S, bd) {
    const g = S.gh, nSd = g.nSide || 9, nH = g.nH || 4, nT = g.nT || 8, JS = nSd, JH = JS + nH, JT = JH + nT, nv = JT + 1, kz = PL(g.keys), GL = g.glass || 'glass_tint';
    const brk = new Set([0, 1]); g.keys.forEach(k => brk.add(k[0])); (g.win || []).forEach(w => { brk.add(w[0]); brk.add(w[1]); }); (g.black || []).forEach(w => { brk.add(w[0]); brk.add(w[1]); });
    const bs = [...brk].sort((a, b) => a - b), ss = []; for (let k = 0; k < bs.length - 1; k++) { const n = max(1, ceil((bs[k + 1] - bs[k]) * g.sub - 1e-6)); for (let t = 0; t < n; t++) ss.push(lerp(bs[k], bs[k + 1], t / n)); } ss.push(1); ss.reverse();
    const nC = g.nC || 5, st = []; for (let a = nC; a >= 1; a--) st.push({ s: 1, a: a / nC, e: -1 }); const i0 = st.length; for (const s of ss) st.push({ s, a: 0, e: 0 }); for (let a = 1; a <= nC; a++) st.push({ s: 0, a: a / nC, e: 1 });
    const hs = [0, g.sill]; for (let k = 1; k <= nSd - 2; k++) hs.push(lerp(g.sill, 1 - g.rail, k / (nSd - 2))); hs.push(1);
    const nu = st.length, G = new Grid(nu, nv), ws = g.wsBulge || 0, bl = g.blBulge || 0;
    const gam = s => g.gamma ? g.gamma(s) : 1;
    for (let i = 0; i < nu; i++) { const stn = st[i], s = stn.s, zz = kz(s), zb = zz[0], zr = zz[1], xB0 = g.Wb(s), tumG = g.tum(s), yRC0 = g.yR(s), gm = gam(s), yBelt = bd.ty(zb, xB0) + .002, yT0 = yRC0 - g.drop, rc = stn.e > 0 ? g.rc : (g.rcR || g.rc);
      const th = Math.atan2(yT0 - yBelt, abs(zb - zr) * gm + 1e-4), R2 = rc / Math.tan(th / 2); let dS = 0, zS = 0, yTop = 0, zTop = 0;
      if (stn.e) { const aS = stn.a * HP, aT = stn.a * th; dS = rc * (1 - cos(aS)); zS = stn.e * rc * sin(aS); yTop = -R2 * (1 - cos(aT)); zTop = stn.e * R2 * sin(aT); }
      const bow = x => (ws * sst(s, g.wsS || .16, 0) - bl * sst(s, 1 - (g.blS || .16), 1)) * (1 - (x / xB0) * (x / xB0)), xT0 = xB0 - tumG, xE = xT0 - g.rG, yE = yT0 + g.rGy;
      for (let j = 0; j <= nSd; j++) { const h = hs[j], x = lerp(xB0, xT0, h) - dS + (g.barrel || 0) * 4 * h * (1 - h) + (j ? 0 : .005); G.set(i, j, x, j ? lerp(yBelt, yT0, h) : yBelt - (g.sink || .035), lerp(zb, zr, Math.pow(h, gm)) + zS + bow(x)); }
      for (let t = 1; t <= nH; t++) { const a = t / nH * HP, w = t / nH, x = xE + g.rG * cos(a) - dS * (1 - w); G.set(i, JS + t, x, yT0 + g.rGy * sin(a) + yTop * w, zr + lerp(zS, zTop, w) + bow(x)); }
      for (let t = 1; t <= nT; t++) { const x = xE * (1 - t / nT); G.set(i, JH + t, x, yE + (yRC0 - yE) * (1 - Math.pow(x / xE, g.p || 2.2)) + yTop, zr + zTop + bow(x)); } }
    const inR = (L, s) => { if (L) for (const w of L) if (s > w[0] && s < w[1]) return true; return false; };
    G.mats((i, j) => { const a = st[i], b = st[i + 1]; if (a.e || b.e) return g.pillar || 'paint'; const sm = (a.s + b.s) / 2; if (j >= nSd) return g.roof || 'paint';
      if (inR(g.black, sm)) return M.blkS; if (j >= 1 && j < nSd - 1 && inR(g.win, sm)) return GL; return j >= nSd - 1 ? (g.roof || 'paint') : (g.pillar || 'paint'); });
    G.flip = true; G.finish({ cx: true }); B.sym(() => { G.emit(B); G.emitInner(B, GL, .005); G.emitInner(B, GL, .012, M.liner); });
    const gh = { G, st, i0, hs, nSd, JS, JH, JT, kz, g };
    gh.si = s => { for (let i = i0; i < nu - nC - 1; i++) { const a = st[i].s, b = st[i + 1].s; if (s <= a && s >= b) return i + (a - s) / max(a - b, 1e-9); } return s > .5 ? i0 : nu - nC - 1; };
    gh.sAt = z => { let a = 0, b = 1; for (let k = 0; k < 24; k++) { const m = (a + b) / 2; if (kz(m)[0] > z) a = m; else b = m; } return (a + b) / 2; };
    gh.cap = (dir, nk, bulge) => { const i = dir > 0 ? nu - 1 : 0, s = dir > 0 ? 0 : 1, W = g.Wb(s), C = new Grid(nv, nk + 1), fr = [0, .014]; for (let k = 1; k < nk - 2; k++) fr.push(lerp(.014, .986, k / (nk - 2))); fr.push(.986, 1);
      for (let j = 0; j <= JT; j++) { const xj = G.X(i, j), y = G.Y(i, j), zj = G.Z(i, j), u0 = xj / W; for (let k = 0; k <= nk; k++) { const x = xj * (1 - 2 * fr[k]), u = x / W; C.set(j, k, x, y, zj + dir * bulge * (u0 * u0 - u * u)); } }
      C.flip = dir < 0; C.nk = nk; C.mats((j, k) => j === 0 ? 'paint' : j >= nSd ? (g.roof || 'paint') : (k === 0 || k === nk - 1 || j === nSd - 1) ? (g.reveal || M.blkS) : GL); C.finish(); C.emit(B); C.emitInner(B, GL, .005); return C; };
    gh.capF = gh.cap(1, g.nk || 22, ws); gh.capR = gh.cap(-1, g.nk || 22, bl);
    return gh;
  }

  function sAtZ(g, z) { const kz = PL(g.keys); let a = 0, b = 1; for (let k = 0; k < 22; k++) { const m = (a + b) / 2; if (kz(m)[0] > z) a = m; else b = m; } return (a + b) / 2; }

  /* ================================================================== wheels */
  let WT = null;
  function wheelTex() { if (WT) return WT; const Wd = 1024, H = 512, mk = () => { const c = document.createElement('canvas'); c.width = Wd; c.height = H; return c; };
    const hc = mk(), h = hc.getContext('2d'), r = GT.rng('tyre');
    h.fillStyle = '#808080'; h.fillRect(0, 0, Wd, H); h.fillStyle = '#c8c8c8'; h.fillRect(0, 0, Wd, 256);
    h.strokeStyle = '#101010'; h.lineCap = 'butt';
    for (let b = 0; b < 8; b++) { const x = b * 128; h.lineWidth = 15; h.beginPath(); h.moveTo(x + 6, -4); h.lineTo(x + 46, 66); h.moveTo(x + 46, 190); h.lineTo(x + 6, 260); h.stroke();
      h.lineWidth = 7; h.beginPath(); h.moveTo(x + 70, 0); h.lineTo(x + 100, 52); h.moveTo(x + 100, 204); h.lineTo(x + 70, 256); h.moveTo(x + 20, 96); h.lineTo(x + 52, 122); h.moveTo(x + 84, 134); h.lineTo(x + 116, 160); h.moveTo(x + 84, 96); h.lineTo(x + 104, 112); h.moveTo(x + 24, 144); h.lineTo(x + 44, 160); h.stroke(); }
    h.fillStyle = '#9a9a9a'; h.fillRect(0, 262, Wd, 5); h.fillRect(0, 372, Wd, 6); h.fillStyle = '#909090'; for (let y = 272; y < 290; y += 4) h.fillRect(0, y, Wd, 1.5); h.fillStyle = '#8c8c8c'; h.fillRect(0, 352, Wd, 3);
    const text = g2 => { g2.textBaseline = 'middle'; g2.textAlign = 'center'; g2.font = "900 40px 'Arial Black','Helvetica Neue',Arial,sans-serif"; g2.fillText('SUNCOAST', 190, 322, 300); g2.font = "italic 900 30px 'Arial Black','Helvetica Neue',Arial,sans-serif"; g2.fillText('G/T RADIAL', 560, 322, 250); g2.font = "700 20px 'Helvetica Neue',Arial,sans-serif"; g2.fillText('P245/60R15', 850, 312, 200); g2.fillText('TUBELESS  M+S', 850, 334, 190); };
    h.fillStyle = '#d0d0d0'; text(h);
    const hd = h.getImageData(0, 0, Wd, H).data, nc = mk(), ng = nc.getContext('2d'), ni = ng.createImageData(Wd, H), nd = ni.data, H_ = (x, y) => hd[(cl(y, 0, H - 1) * Wd + ((x + Wd) % Wd)) * 4] / 255;
    for (let y = 0; y < H; y++) { const k = y < 256 ? 3.2 : y < 384 ? 2.2 : 0; for (let x = 0; x < Wd; x++) { const dx = (H_(x + 1, y) - H_(x - 1, y)) * k, dy = (H_(x, y + 1) - H_(x, y - 1)) * k, il = 1 / sqrt(dx * dx + dy * dy + 1), o = (y * Wd + x) * 4; nd[o] = 127.5 - dx * il * 127.5; nd[o + 1] = 127.5 + dy * il * 127.5; nd[o + 2] = 127.5 + il * 127.5; nd[o + 3] = 255; } }
    ng.putImageData(ni, 0, 0);
    const alb = white => { const c = mk(), g2 = c.getContext('2d'); g2.fillStyle = '#fff'; g2.fillRect(0, 0, Wd, H); g2.fillStyle = '#161617'; g2.fillRect(0, 0, Wd, 256); g2.fillStyle = '#131314'; g2.fillRect(0, 256, Wd, 128);
      const im = g2.getImageData(0, 0, Wd, 384), d = im.data; for (let i = 0; i < Wd * 384; i++) { const y = (i / Wd) | 0, hh = hd[i * 4] / 255, n = (r() - .5) * 10, k = y < 256 ? .45 + .55 * sst(hh, .1, .7) : 1, dust = y < 256 ? 5 * r() : 7 * sst(abs(y - 320), 20, 64) + 3 * r(); d[i * 4] = (d[i * 4] + n) * k + dust * 1.1; d[i * 4 + 1] = (d[i * 4 + 1] + n) * k + dust; d[i * 4 + 2] = (d[i * 4 + 2] + n) * k + dust * .8; }
      g2.putImageData(im, 0, 0); if (white) { g2.fillStyle = '#b9b6aa'; text(g2); } else { g2.fillStyle = '#202021'; text(g2); }
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.wrapS = T.RepeatWrapping; t.anisotropy = 8; return t; };
    const nrm = new T.CanvasTexture(nc); nrm.wrapS = T.RepeatWrapping; nrm.anisotropy = 8;
    return WT = { nrm, plain: alb(false), white: alb(true) }; }
  /** revolve [[x, r],...] about the wheel axis (+X = outer face). Profile runs inner -> outer -> centre. */
  function latheX(B, ms, prof, seg, uvf) { const G = new Grid(prof.length, seg + 1); if (uvf) G.uv = new Float32Array(G.nu * G.nv * 2);
    for (let i = 0; i < prof.length; i++) for (let k = 0; k <= seg; k++) { const a = k / seg * TAU; G.set(i, k, prof[i][0], prof[i][1] * cos(a), prof[i][1] * sin(a)); if (uvf) { const o = (i * G.nv + k) * 2, t = uvf(i, k / seg); G.uv[o] = t[0]; G.uv[o + 1] = t[1]; } }
    G.flip = true; G.def = ms; G.finish({ weldV: true }); G.emit(B); }
  function wheelGeo(w) {
    const B = new Builder(); B.white = [.5, .125]; const R = w.R, hw = w.w / 2, rr = w.rim, seg = w.seg || 48, TY = { c: [1, 1, 1], r: .88, m: 0, tex: true }, TYS = { c: [1, 1, 1], r: .8, m: 0, tex: true };
    const sw = [], nw = 9; for (let k = 0; k <= nw; k++) { const t = k / nw; sw.push([hw - .024 * (1 - Math.pow(sin(PI * t), .62)) - (t > .5 ? .004 * sst(t, .7, 1) : 0), lerp(rr - .003, R - .009, t), t]); }
    { const si = [sw[0], sw[3], sw[6], sw[9]]; latheX(B, TYS, si.map(p => [-p[0], p[1]]), seg, (i, a) => [-a * 2, lerp(.262, .49, si[i][2])]); }
    const tr = [[-hw + .02, R - .009], [-hw + .034, R - .0015]], gw = .0055, gd = .0075; for (const f of (w.grooves || [-.52, -.18, .18, .52])) { const x = f * hw; tr.push([x - gw - .002, R - .0006 * abs(f)], [x - gw, R - gd], [x + gw, R - gd], [x + gw + .002, R - .0006 * abs(f)]); } tr.push([hw - .034, R - .0015], [hw - .02, R - .009]);
    latheX(B, TY, tr, seg, (i, a) => [-a * (w.trep || 6), lerp(.99, .51, (tr[i][0] + hw) / w.w)]);
    latheX(B, TYS, sw.slice().reverse().map(p => [p[0], p[1]]), seg, (i, a) => [-a * 2, lerp(.49, .262, i / nw)]);
    // rim
    const lipM = w.lip || M.alu, xo = hw - .02, xc = hw - (w.dish || .05), faceM = w.face || M.aluS;
    latheX(B, lipM, [[xo - .006, rr + .001], [xo + .006, rr + .012], [xo + .012, rr + .009], [xo + .011, rr - .002], [xo + .004, rr - .01], [xo - .012, rr - .016], [xc + .012, rr - .024], [xc - .03, rr - .03]], seg);
    latheX(B, M.blkM, [[xc - .03, rr - .03], [xc - .045, rr - .034], [xc - .045, w.disc + .004]], seg);
    latheX(B, M.iron, [[xc - .045, w.disc + .004], [xc - .034, w.disc], [xc - .034, w.hub + .02], [xc - .05, w.hub + .016]], seg);
    const sp = w.spoke; if (sp) { const r0 = w.hub - .012, r1 = rr - .022, len = r1 - r0;
      for (let k = 0; k < sp.n; k++) { const g = GT.boxGeo(sp.th, len, sp.w0, sp.bev || .007), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const f = Math.max(0, Math.min(1, (p.getY(i) + len / 2) / len)); p.setZ(i, p.getZ(i) * lerp(1, sp.w1 / sp.w0, Math.pow(f, sp.tp || 1)) + (sp.twin ? 0 : 0)); p.setX(i, p.getX(i) + lerp(sp.rise || 0, 0, f) + (sp.curve || 0) * sin(f * PI)); } g.computeVertexNormals();
        const ang = k / sp.n * TAU; if (sp.twin) { for (const s of [-1, 1]) { B.push(0, 0, 0, { rx: ang + s * sp.twin }); B.add(faceM, g.clone(), { x: xc - sp.th / 2 + (sp.out || 0), y: r0 + len / 2 }); B.pop(); } } else { B.push(0, 0, 0, { rx: ang }); B.add(faceM, g, { x: xc - sp.th / 2 + (sp.out || 0), y: r0 + len / 2 }); B.pop(); } } }
    else { // pressed steel disc with vent slots
      latheX(B, faceM, [[xc - .03, rr - .03], [xc - .012, rr - .045], [xc - .006, rr - .075], [xc - .018, rr - .1], [xc + .004, w.hub + .035], [xc + .012, w.hub + .01]], seg);
      const nh = w.holes || 10; for (let k = 0; k < nh; k++) { B.push(0, 0, 0, { rx: (k + .5) / nh * TAU }); B.add(M.gap, new T.CylinderGeometry(.017, .017, .012, 10), { x: xc - .009, y: rr - .062, rz: -HP, s: [1, 1, 1.5] }); B.pop(); } }
    // hub, cap, lug nuts
    const hm = w.hubM || faceM; latheX(B, hm, [[xc - .012, w.hub + .012], [xc + .004 + (sp ? sp.rise || 0 : .008), w.hub], [xc + .012 + (sp ? sp.rise || 0 : .008), w.hub - .012], [xc + .012 + (sp ? sp.rise || 0 : .008), w.cap + .004]], seg);
    const cx = xc + .012 + (sp ? sp.rise || 0 : .008); latheX(B, w.capM || M.chr, [[cx, w.cap + .004], [cx + .012, w.cap], [cx + .022, w.cap * .7], [cx + .027, w.cap * .3], [cx + .028, 0]], 20);
    for (let k = 0; k < w.lugs; k++) { B.push(0, 0, 0, { rx: (k + (w.lugOff === undefined ? .5 : w.lugOff)) / w.lugs * TAU }); B.add(w.lugM || M.chr, new T.CylinderGeometry(.0095, .0115, .018, 6), { x: cx + .006, y: (w.hub + w.cap) / 2 + .003, rz: -HP }); B.pop(); }
    const geo = B.bags.detail.build(true); geo.computeBoundingSphere(); return geo;
  }

  /* ================================================================== materials (per-vertex PBR + lamp channels; dusty clear-coat paint; ground fx) */
  function detailMat(map, normalMap, o) { o = o || {};
    const m = new T.MeshStandardMaterial({ vertexColors: true, map: map || null, normalMap: normalMap || null, roughness: 1, metalness: 1, envMapIntensity: 1.1, alphaTest: o.alphaTest || 0 });
    if (o.offset) { m.polygonOffset = true; m.polygonOffsetFactor = -1.5; m.polygonOffsetUnits = -3; }
    const lv = []; for (let i = 0; i < NCH; i++) lv.push(new T.Vector3()); m.userData.gtLv = lv; const U = { value: lv };
    m.onBeforeCompile = sh => { sh.uniforms.gtLv = U;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aPar; uniform vec3 gtLv[' + NCH + ']; varying vec2 vGtRM; varying vec3 vGtEm;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vGtRM = aPar.xy; vGtEm = gtLv[int(aPar.z + 0.5)];');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vGtRM; varying vec3 vGtEm;').replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vGtRM.x;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vGtRM.y;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vGtEm * diffuseColor.rgb;'); };
    return m; }
  const NOISE = 'float gtH(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\nfloat gtN(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f); return mix(mix(mix(gtH(i), gtH(i+vec3(1,0,0)), f.x), mix(gtH(i+vec3(0,1,0)), gtH(i+vec3(1,1,0)), f.x), f.y), mix(mix(gtH(i+vec3(0,0,1)), gtH(i+vec3(1,0,1)), f.x), mix(gtH(i+vec3(0,1,1)), gtH(i+vec3(1,1,1)), f.x), f.y), f.z); }\n';
  const PM = {};
  /** car paint: GT.mat('car_paint') textures + vertex tint (liveries / satin panels) + road dust on the lower body + stone chips on the nose */
  function paintMat(hex, dust) { const key = hex + '|' + dust.join(','); if (PM[key]) return PM[key]; const b = GT.mat('car_paint', { color: hex, rough: .3 }), phys = b.clearcoat !== undefined;
    const m = new T.MeshPhysicalMaterial({ color: b.color.clone(), map: b.map || null, roughness: b.roughness, metalness: b.metalness, roughnessMap: b.roughnessMap || null, normalMap: b.normalMap || null, clearcoat: phys ? b.clearcoat : 1, clearcoatRoughness: phys ? b.clearcoatRoughness : .05, clearcoatNormalMap: phys ? b.clearcoatNormalMap : null, envMapIntensity: b.envMapIntensity || 1.1, vertexColors: true });
    if (b.normalMap) m.normalScale.copy(b.normalScale).multiplyScalar(.45); if (phys && b.clearcoatNormalMap) m.clearcoatNormalScale.copy(b.clearcoatNormalScale);
    const U = { value: new T.Vector4(dust[0], dust[1], dust[2], dust[3]) }, U2 = { value: new T.Vector4(dust[4] || 9, dust[5] || -9, dust[6] || .4, 0) }; m.userData.gtDust = U; const prev = b.userData && b.userData.gtMacro ? b.onBeforeCompile : null;
    m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); sh.uniforms.gtDust = U; sh.uniforms.gtAx = U2;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aPar; varying vec3 vGtP; varying float vGtS;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vGtP = position; vGtS = aPar.x;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGtP; varying float vGtS; uniform vec4 gtDust; uniform vec4 gtAx;\n' + NOISE)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n float gtNz = gtN(vGtP * 6.) * .5 + gtN(vGtP * 19.) * .3 + gtN(vGtP * 57.) * .2;\n float gtD = clamp(smoothstep(gtDust.y, gtDust.x, vGtP.y) * (.2 + 1.25 * gtNz) * gtDust.z, 0., 1.);\n gtD = max(gtD, gtDust.z * .07 * smoothstep(.45, .75, gtNz));\n vec2 gtWb = vec2(gtAx.x, gtAx.y) - gtAx.z - vGtP.z; vec2 gtSp = (1. - smoothstep(vec2(0.), vec2(.6), gtWb)) * step(vec2(-.02), gtWb);\n gtD = clamp(gtD + max(gtSp.x, gtSp.y) * smoothstep(gtAx.z * 2.1, gtAx.z * .7, vGtP.y) * (.25 + gtNz) * gtDust.z * 1.5, 0., 1.);\n' +
          ' float gtC = step(.9955, gtH(floor(vGtP * 260.))) * smoothstep(gtDust.w - .7, gtDust.w - .1, vGtP.z) * step(vGtP.y, .95) * (1. - vGtS);\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.2, .172, .135), gtD * .78);\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.08, .075, .07), gtC * .8);\n' +
          ' roughnessFactor = mix(mix(roughnessFactor, .55, vGtS), .93, gtD);')
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef CLEARCOAT\n material.clearcoat *= (1. - gtD) * (1. - vGtS * .93) * (1. - gtC);\n#endif'); };
    return PM[key] = m; }
  const FX_VS = 'attribute vec3 aFx; varying vec3 vFx; void main(){ vFx = aFx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }';
  const FX_FS = 'uniform vec3 uCol[5]; uniform vec3 uBox; varying vec3 vFx;\nvoid main(){ vec4 o;\n if (vFx.z < .5) { vec2 q = abs(vFx.xy) - uBox.xy + .28; float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - .28; o = vec4(0., 0., 0., uBox.z * pow(1. - smoothstep(-.55, .95, d), 1.6) ); }\n' +
    ' else if (vFx.z < 1.5) { float t = vFx.y * .5 + .5, u = vFx.x; float f = pow(max(1. - u * u, 0.), 2.2) * smoothstep(0., .12, t) * pow(1. - t, 2.4); f += 1.6 * pow(max(1. - u * u * 5., 0.), 2.) * smoothstep(0., .06, t) * pow(1. - t, 6.); o = vec4(uCol[1] * f, 0.); }\n' +
    ' else { float f = pow(max(1. - length(vFx.xy), 0.), 2.2); o = vec4((vFx.z < 2.5 ? uCol[2] : vFx.z < 3.5 ? uCol[3] : uCol[4]) * f, 0.); }\n gl_FragColor = o;\n #include <tonemapping_fragment>\n #include <encodings_fragment>\n}';
  function fxMat(L, W) { const cols = []; for (let i = 0; i < 5; i++) cols.push(new T.Vector3());
    return new T.ShaderMaterial({ uniforms: { uCol: { value: cols }, uBox: { value: new T.Vector3(W / 2 - .02, L / 2 - .04, .8) } }, vertexShader: FX_VS, fragmentShader: FX_FS, transparent: true, depthWrite: false, blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); }
  function fxGeo(L, W, cop) { const P = [], A = [], I = []; const quad = (x0, z0, x1, z1, y, mode, wFar, nx, nz) => { nx = nx || 1; nz = nz || 1; const o = P.length / 3; for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const u = i / nx * 2 - 1, v = j / nz * 2 - 1, t = j / nz, hw = wFar ? lerp((x1 - x0) / 2, wFar, t) : (x1 - x0) / 2; P.push((x0 + x1) / 2 + u * hw, y, lerp(z0, z1, t)); if (mode === 0) A.push((x0 + x1) / 2 + u * hw, lerp(z0, z1, t), 0); else A.push(u, v, mode); }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = o + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; I.push(a, c, b, b, c, d); } };
    quad(-W / 2 - 1.2, -L / 2 - 1.2, W / 2 + 1.2, L / 2 + 1.2, .012, 0); quad(-1.1, L / 2 + .25, 1.1, L / 2 + 19, .02, 1, 5, 8, 10); quad(-2.2, -L / 2 - 4.2, 2.2, -L / 2 + .5, .018, 2);
    if (cop) { quad(.2, -5, 9.2, 5, .016, 3); quad(-9.2, -5, -.2, 5, .016, 4); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('aFx', new T.BufferAttribute(new Float32Array(A), 3)); g.setIndex(I); g.computeBoundingSphere(); return g; }

  /* ================================================================== texture atlas (plate + decals) for the detail mesh. 1024x512, slots in pixels */
  const SLOT = { plate: [0, 0, 512, 256], A: [0, 256, 256, 256], B: [256, 256, 512, 128], C: [256, 384, 256, 128], D: [512, 384, 512, 64], E: [512, 448, 512, 64], F: [768, 256, 256, 128] }, AT = {};
  const uvOf = (n, flipU) => { const s = SLOT[n], u0 = s[0] / 1024, u1 = (s[0] + s[2]) / 1024, v0 = 1 - (s[1] + s[3]) / 512, v1 = 1 - s[1] / 512; return flipU ? [u1, v0, u0, v1] : [u0, v0, u1, v1]; };
  function atlas(kind, plate, unit) { const key = kind + '|' + plate + '|' + unit; if (AT[key]) return AT[key]; const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(520, 8, 240, 112);
    const put = (slot, tex) => { const s = SLOT[slot]; if (tex && tex.image) g.drawImage(tex.image, s[0], s[1], s[2], s[3]); }, FONT = "'Arial Black','Helvetica Neue','Arial',sans-serif", SCRIPT = "'Snell Roundhand','Brush Script MT','Segoe Script',cursive";
    put('plate', GT.signTex(plate, { style: 'plate', w: 512, h: 256, top: 'CALIDA', bottom: 'sunset coast', distress: .35 }));
    const word = (slot, text, col, font, weight) => { const s = SLOT[slot]; g.save(); g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; let px = s[3] * .78; g.font = `${weight || '900'} ${px}px ${font || FONT}`; const w = g.measureText(text).width; if (w > s[2] * .94) { px *= s[2] * .94 / w; g.font = `${weight || '900'} ${px}px ${font || FONT}`; } g.fillText(text, s[0] + s[2] / 2, s[1] + s[3] * .53); g.restore(); };
    if (kind === 'cruiser') {
      put('B', GT.signTex('POLICE', { style: 'stencil', color: '#111d3a', font: FONT, w: 512, h: 128, distress: .04 }));
      word('C', unit, '#f2f0ea'); word('F', unit, '#0c0e12'); word('D', 'PUERTO SOL  ·  CALIDA', '#111d3a', "'Helvetica Neue',Arial,sans-serif", '700'); word('E', 'COURTESY · VIGILANCE · SERVICE', '#111d3a', "'Helvetica Neue',Arial,sans-serif", 'italic 600');
      const s = SLOT.A, cx = s[0] + 128, cy = s[1] + 128; g.save(); g.translate(cx, cy);                                    // door shield: seven-point star on a gold-rimmed disc
      g.fillStyle = '#b8902c'; g.beginPath(); for (let k = 0; k < 14; k++) { const a = k / 14 * TAU - HP, r = k % 2 ? 78 : 122; g.lineTo(cos(a) * r, sin(a) * r); } g.closePath(); g.fill();
      g.fillStyle = '#e1c15a'; g.beginPath(); for (let k = 0; k < 14; k++) { const a = k / 14 * TAU - HP, r = k % 2 ? 70 : 108; g.lineTo(cos(a) * r, sin(a) * r); } g.closePath(); g.fill();
      g.fillStyle = '#13244a'; g.beginPath(); g.arc(0, 0, 62, 0, TAU); g.fill(); g.strokeStyle = '#e1c15a'; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 50, 0, TAU); g.stroke();
      g.fillStyle = '#e8a23c'; g.beginPath(); g.arc(0, 8, 26, PI, 0); g.fill(); g.fillStyle = '#e1c15a'; g.fillRect(-40, 8, 80, 4); g.fillRect(-30, 17, 60, 3); g.fillRect(-20, 25, 40, 3); g.restore();
      const st = GT.signTex('PSPD', { style: 'stencil', color: '#f1e3a8', font: FONT, w: 128, h: 40, distress: 0 }); if (st.image) g.drawImage(st.image, cx - 36, cy - 36, 72, 22);
    } else if (kind === 'hero') { word('B', 'Sundowner', '#fff', SCRIPT, 'italic 700'); word('C', '427', '#fff', FONT, 'italic 900'); word('F', 'GT', '#fff', FONT, 'italic 900'); }
    else if (kind === 'sedan') { word('B', 'MERIDIAN', '#fff', "'Helvetica Neue',Arial,sans-serif", '600'); word('C', 'LX', '#fff', "'Helvetica Neue',Arial,sans-serif", '700'); }
    else if (kind === 'compact') { word('B', 'KITE', '#fff', "'Helvetica Neue',Arial,sans-serif", '700'); word('C', '1.6', '#fff', "'Helvetica Neue',Arial,sans-serif", '600'); }
    else if (kind === 'pickup') { word('B', 'BRONTO', '#fff', FONT, '900'); word('C', 'V8', '#fff', FONT, 'italic 900'); word('F', '2500', '#fff', FONT, '900'); }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; return AT[key] = t; }

  /* ================================================================== shared dress parts */
  /** round sealed-beam lamp facing +Z at the current transform: chrome bezel, reflector bowl (lamp channel), bulb shield, convex clear lens */
  function roundLamp(B, r, ch) {
    B.lathe('chrome', [[r - .006, -.004], [r + .006, -.004], [r + .011, .006], [r + .008, .016], [r + .001, .02], [r - .005, .014]], { seg: 28, rx: HP });
    B.lathe(lens('bowl', ch), [[.012, -.05], [r * .35, -.046], [r * .62, -.034], [r * .84, -.016], [r - .004, .008]], { seg: 28, rx: HP, flip: true });
    B.sph(M.chr, .017, 0, 0, -.03, { seg: 10, seg2: 8 }); B.cyl(M.chr, .004, .004, .03, 0, -.016, -.03, { seg: 5 });
    B.lathe('glass_clear', [[r - .004, .01], [r * .8, .019], [r * .5, .026], [r * .2, .0295], [0, .03]], { seg: 28, rx: HP }); }
  function interior(B, S, bd, gh) { const I = S.interior, n = 22, G = new Grid(n + 1, 4), g = gh.g;
    for (let k = 0; k <= n; k++) { const z = lerp(I.z0, I.z1, k / n), s = gh.sAt(z), xb = g.Wb(s) - .012, y = bd.ty(z, xb) - .008; let xi = xb - .075; for (const a of S.arches) if (abs(z - a.z) < a.R + .06) xi = min(xi, S.xi - .012); G.set(k, 0, xb, y, z); G.set(k, 1, xi, y - .004, z); G.set(k, 2, xi, I.floor, z); G.set(k, 3, 0, I.floor, z); }
    G.face(n >> 1, 0, 0, 1, 0); G.def = M.vinyl; G.finish({ cx: true }); B.sym(() => G.emit(B));
    const w = g.Wb(.4) - .09, yb = bd.ty((I.z0 + I.z1) / 2, w) - .01, sc = I.seat || M.seat;
    B.box(M.vinyl, w * 2, yb - I.floor, .04, 0, (yb + I.floor) / 2, I.z1 + .01); B.box(M.vinyl, w * 2, yb - I.floor, .04, 0, (yb + I.floor) / 2, I.z0 - .01);
    B.box(M.vinyl, w * 2, .2, .34, 0, I.dash - .1, I.z1 - .15, { bevel: .03 }); B.box(M.vinyl, .34, .07, .12, .36, I.dash + .025, I.z1 - .27, { bevel: .025 });                       // dash + binnacle
    B.add(M.blkS, new T.TorusGeometry(.185, .014, 8, 28), { x: .36, y: I.dash - .02, z: I.z1 - .43, rx: .42 }); B.cyl(M.dkm, .02, .024, .3, .36, I.dash - .07, I.z1 - .3, { rx: HP + .42, seg: 8 });
    B.box(M.dkm, .035, .012, .2, .36, I.dash - .02, I.z1 - .43, { rx: .42, bevel: .004 }); B.box(M.vinyl, .2, .16, (I.z1 - I.z0) * .5, 0, I.floor + .08, lerp(I.z0, I.z1, .6), { bevel: .02 });               // spokes, tunnel/console
    for (const sx of [-1, 1]) { const x = sx * .37, z = I.seatZ; B.box(sc, .5, .14, .5, x, I.floor + .15, z, { bevel: .045 }); B.box(sc, .5, .52, .12, x, I.floor + .44, z - .29, { rx: -.26, bevel: .05 }); B.box(sc, .25, .15, .085, x, I.floor + .76, z - .385, { rx: -.2, bevel: .035 }); }
    if (I.rearZ !== undefined) { let rw = w * 1.9; for (const a of S.arches) if (abs(I.rearZ - .2 - a.z) < a.R + .3) rw = min(rw, 2 * S.xi - .06); B.box(sc, rw, .15, .46, 0, I.floor + .16, I.rearZ, { bevel: .045 }); B.box(sc, rw, .46, .12, 0, I.floor + .42, I.rearZ - .27, { rx: -.3, bevel: .05 }); }
    if (I.shelf) B.box(M.vinyl, w * 2, .03, I.shelf[1] - I.shelf[0], 0, I.shelfY, (I.shelf[0] + I.shelf[1]) / 2); }
  function underbody(B, S) { const U = S.under; if (!U) return; const y = U.y;
    for (const sx of [-1, 1]) { B.tube(M.iron, [[sx * .3, y, U.exh[0]], [sx * .34, y - .01, lerp(U.exh[0], U.exh[1], .4)], [sx * .42, y + .01, lerp(U.exh[0], U.exh[1], .75)], [sx * U.tipX, U.tipY, U.exh[1]]], .026, { seg: 7 }); B.box(M.iron, .2, .1, .5, sx * .36, y, lerp(U.exh[0], U.exh[1], .55), { bevel: .04 }); }
    B.cyl(M.dkm, .04, .04, 1.3, 0, U.axleY, U.axle, { rz: HP, seg: 10 }); B.sph(M.dkm, .11, 0, U.axleY, U.axle, { s: [1, 1, 1.15] }); B.cyl(M.dkm, .032, .032, abs(U.axle - .2), 0, U.axleY + .02, (U.axle + .2) / 2, { rx: HP, seg: 8 });
    if (U.tank) B.box(M.dkm, 1.0, .16, U.tank[1] - U.tank[0], 0, U.tankY, (U.tank[0] + U.tank[1]) / 2, { bevel: .04 });
    B.box(M.dkm, 1.2, .08, .16, 0, U.axleY - .02, U.front, { bevel: .02 }); B.box(M.dkm, .5, .16, .5, 0, y + .03, U.front - .3, { bevel: .05 }); }

  /* ================================================================== car definitions */
  const BLK_PAINT = { paint: [.03, .03, .032], satin: 1 }, DEFS = {};

  DEFS.hero = () => { const S = {
    L: 4.8, Wd: 1.9, H: 1.3, zR: -2.36, zF: 2.32, dz: .026, nS: 20, nT: 28, nH: 6, nR: 5, color: 0x720f0c, dust: [.2, .66, .5, 2.32], eye: [.36, 1.08, -.22],
    W: K([[-2.36, .868], [-2.0, .92], [-1.33, .955], [-.55, .922], [.4, .922], [1.42, .936], [2.0, .915], [2.32, .888]]),
    yb: K([[-2.36, .35], [-1.85, .29], [-1.0, .215], [.9, .215], [1.9, .24], [2.32, .275]]),
    yW: K([[-2.36, .7], [-1.33, .675], [0, .615], [2.32, .575]]),
    ySh: K([[-2.36, .832], [-2.0, .886], [-1.45, .93], [-.95, .876], [-.4, .84], [.64, .836], [1.42, .815], [1.95, .78], [2.32, .712]]),
    yC: K([[-2.36, .905], [-2.22, .936], [-1.95, .932], [-1.45, .957], [-.9, .92], [.64, .9], [1.3, .86], [1.9, .8], [2.32, .726]]),
    tum: K([[-2.36, .07], [-1.33, .08], [-.4, .066], [.64, .05], [2.32, .04]]), rS: K([[-2.36, .09], [-1.33, .09], [-.5, .042], [.5, .046], [1.42, .07], [2.32, .06]]), rSy: K([[-2.36, .04], [-.5, .026], [.5, .028], [2.32, .035]]), p: K([[-2.36, 2.4], [2.32, 2.6]]),
    rr: .07, rrx: .06, aLow: .046, eL: 1.55, eU: 1.3, xi: .5,
    arches: [{ z: 1.42, y: .335, R: .4, flare: .012, fw: .05 }, { z: -1.33, y: .345, R: .412, flare: .014, fw: .055 }],
    front: { r: .028, tw: .014, recess: .085, bowX: .035, y0: .5, hy: .3, rake: .11, start: 1.9 }, rear: { r: .03, tw: .012, recess: .04, bowX: .02, y0: .6, hy: .3, rake: .05, start: -1.85 },
    wheel: { R: .335, w: .225, rim: .2, disc: .15, hub: .062, cap: .03, dish: .062, lugs: 5, seg: 52, white: true, lip: M.alu, face: { c: [.34, .345, .36], r: .42, m: 1 }, spoke: { n: 5, th: .034, w0: .078, w1: .05, rise: .018, bev: .009, tp: .8 } },
    wheels: { fz: 1.42, rz: -1.33, fx: .783, rx: .78, rear: [1.2, 1.03] },
    interior: { z0: -1.5, z1: .5, floor: .32, dash: .86, seatZ: -.3, rearZ: -1.1, shelf: [-1.56, -1.3], shelfY: .84 },
    under: { y: .2, exh: [.9, -2.2], tipX: .5, tipY: .29, axle: -1.33, axleY: .345, tank: [-2.15, -1.6], tankY: .33, front: 1.42 } };
    const bw = .21;
    S.bulge = (x, z) => .044 * sst(x, bw + .045, bw - .04) * sst(z, 2.12, 1.55) * sst(z, .7, .73) + .005 * sst(x, .1, 0) * sst(z, 2.1, 1.6) * sst(z, .7, .73);
    S.gh = { keys: [[0, .64, .1], [.5, -.52, -.42], [.78, -1.22, -.58], [1, -1.88, -.7]], win: [[.05, .49], [.51, .78]], sub: 44, nSide: 9, nH: 4, nT: 9, nk: 24,
      Wb: K([[0, .8], [.5, .805], [.8, .8], [1, .74]]), tum: K([[0, .15], [.5, .16], [1, .19]]), yR: K([[0, 1.262], [.25, 1.295], [.5, 1.3], [.78, 1.276], [1, 1.228]]), gamma: K([[0, 1], [.5, 1], [1, 1.3]]),
      drop: .05, rG: .085, rGy: .034, p: 2.2, rc: .048, rcR: .03, sill: .035, rail: .09, barrel: .012, wsBulge: .075, blBulge: .045, reveal: 'chrome' };
    S.mat = (i, j, zc, bd) => { if (i < 3) return 'paint'; if (j >= bd.JT - 8 && zc > .7 && zc < 2.12) return BLK_PAINT; if ((j === bd.JR + 17 || j === bd.JR + 18) && zc > -2.16 && zc < 2.2) return BLK_PAINT; return 'paint'; };
    S.cut = (z, x) => z > -1.6 && z < .5 && x < S.gh.Wb(sAtZ(S.gh, z)) - .035;
    S.build = B => { const bd = makeBody(B, S), G = bd.G, gi = bd.gi, zF = S.zF, zR = S.zR; S._bd = bd;
      for (const a of S.arches) archParts(B, bd, a, 'chrome');
      const gh = makeGreenhouse(B, S, bd); S._gh = gh; interior(B, S, bd, gh); underbody(B, S);
      // ---------- front: recessed egg-crate grille, quad round lamps, chrome bumper, body-colour valance
      const zc = zF - S.front.recess, yv = .468; bd.cap(1, 8, () => M.gap); bd.fill(1, yv, zF - .012, zc, 'paint');
      sweep(B, 'chrome', bumperPath(zF + .036, .79, .105, .3, .478, 1, .03, S.front.Wn), [[-.03, -.05], [.028, -.05], [.045, -.036], [.052, -.006], [.052, .012], [.044, .038], [.026, .05], [-.03, .05]]);
      B.sym(() => { B.box('chrome', .05, .13, .05, .3, .478, zF + .076, { bevel: .014 }); B.box(M.rubber, .022, .1, .012, .3, .478, zF + .104, { bevel: .004 }); });
      for (let k = 0; k < 7; k++) B.box(M.blkS, 1.02, .005, .03, 0, .535 + k * .0235, zc + .04);
      for (let k = -11; k <= 11; k++) B.box(M.blkS, .005, .165, .024, k * .044, .606, zc + .037);
      B.box('chrome', 1.03, .009, .014, 0, .606, zc + .062, { bevel: .003 }); B.box('chrome', .07, .05, .016, 0, .606, zc + .066, { bevel: .008 }); B.box({ c: [.5, .02, .02], r: .3 }, .05, .03, .008, 0, .606, zc + .074, { bevel: .003 });
      B.sym(() => { B.box(M.blkM, .335, .178, .03, .685, .606, zc + .028, { bevel: .01 }); B.box('chrome', .345, .008, .02, .685, .698, zc + .05); B.box('chrome', .345, .008, .02, .685, .514, zc + .05); B.box('chrome', .008, .19, .02, .515, .606, zc + .05);
        for (const x of [.6, .766]) { B.push(x, .606, zc + .052); roundLamp(B, .071, CH.head); B.pop(); }
        B.box('chrome', .15, .058, .02, .6, .355, zF - .008, { bevel: .008 }); B.box(lens('amber', CH.fl), .132, .042, .02, .6, .355, zF - .001, { bevel: .007 }); });
      B.box(M.blkS, 1.58, .07, .06, 0, .262, zF - .05, { rx: -.3, bevel: .012 });
      // ---------- hood: seams, cowl panel, scoop mouth, pins, wipers
      const hx = z => .72 - .012 * sst(z, 1.6, 2.3);
      B.sym(() => { B.line(G, bd.tLine(.71, 2.262, hx), .005, .0006, M.gap); B.line(G, [[gi(.705), bd.gjT(.705, .72)], [gi(.705), bd.JT]], .005, .0006, M.gap); B.line(G, [[gi(2.262), bd.gjT(2.262, hx(2.262))], [gi(2.262), bd.JT]], .005, .0006, M.gap);
        B.patch(G, bd.tMap(.612, .695, .76, 0), 3, 14, .0012, M.blkM, { skirt: 0 }); B.cyl('chrome', .016, .019, .006, .56, bd.ty(2.1, .56) + .003, 2.1, { seg: 12 }); B.cyl('chrome', .003, .003, .05, .56, bd.ty(2.1, .56) + .008, 2.1, { rz: HP, seg: 5 }); });
      B.box(M.gap, .4, .03, .012, 0, bd.ty(.74, 0) - .017, .722); B.box('chrome', .42, .004, .014, 0, bd.ty(.74, 0) - .001, .724);
      const WS = gh.capF, wip = (k0, k1, r0, r1) => { const a = WS.at(r0, k0), b = WS.at(r1, k1), o = .014; B.tube(M.blkS, [[a[0] + a[3] * o, a[1] + a[4] * o, a[2] + a[5] * o], [b[0] + b[3] * o, b[1] + b[4] * o, b[2] + b[5] * o]], .0045, { seg: 5, steps: 2 });
        const c = WS.at(r1 + .9, k1 + 1.5), d = WS.at(r1 - .7, k1 - 3.4); B.tube(M.rubber, [[c[0] + c[3] * .008, c[1] + c[4] * .008, c[2] + c[5] * .008], [b[0] + b[3] * .01, b[1] + b[4] * .01, b[2] + b[5] * .01], [d[0] + d[3] * .008, d[1] + d[4] * .008, d[2] + d[5] * .008]], .0055, { seg: 5, steps: 6 }); };
      wip(4.5, 9.5, 1.05, 2.1); wip(13, 18.5, 1.05, 2.1);
      // ---------- flanks: door shut-lines, handle, mirrors, rocker trim, markers, scoop, badges
      const dF = .52, dR = -.6;
      B.sym(sg => { for (const z of [dF, dR]) B.line(G, [[gi(z), bd.JR + .7], [gi(z), bd.JH + 2.2]], .0055, .0006, M.gap); B.line(G, bd.sLine(dR, dF, .3), .005, .0006, M.gap);
        B.line(G, bd.sLine(-.9, 1.0, .262), .03, .001, 'chrome', { h: .005 });
        const hy = .772, hz = -.44, hxx = bd.sx(hz, hy); B.box('chrome', .02, .024, .115, hxx + .008, hy, hz, { bevel: .007 }); B.box(M.gap, .01, .018, .09, hxx + .003, hy - .014, hz); B.cyl('chrome', .011, .011, .006, hxx + .002, hy - .004, hz - .09, { rz: HP, seg: 10 });
        const my = bd.ty(.38, .86) + .05, mx = bd.sx(.38, .84) + .075; B.cyl('chrome', .008, .011, .09, mx - .04, my - .025, .38, { rz: .9, seg: 8 }); B.sph('chrome', 1, mx, my, .385, { s: [.05, .04, .075], seg: 14, seg2: 10 }); B.cyl(M.mirror, .036, .036, .004, mx, my, .348, { rx: HP, seg: 14 });
        B.patch(G, bd.sMap(2.11, 2.0, .492, .543), 3, 2, .0015, M.chr, { skirt: .002 }); B.patch(G, bd.sMap(2.1, 2.01, .5, .535), 3, 2, .0042, lens('amber', CH.mark), { bulge: .002, skirt: .002 }); B.patch(G, bd.sMap(-2.02, -2.12, .6, .635), 3, 2, .003, lens('red', CH.mark), { bulge: .002 });
        B.patch(G, bd.sMap(-.66, -.8, .6, .77), 4, 6, .0012, M.gap, { skirt: .003 }); B.line(G, [[gi(-.655), bd.gjS(-.655, .595)], [gi(-.655), bd.gjS(-.655, .775)]], .012, .002, 'chrome', { h: .004 });
        B.patch(G, bd.sMap(sg > 0 ? .96 : .7, sg > 0 ? .7 : .96, .655, .725), 6, 3, .0015, M.decalChr, { uv: uvOf('C'), skirt: 0 }); });
      // ---------- tail: satin-black recessed panel, triple lamps, chrome bumper, valance, plate, tips
      const zp = zR + S.rear.recess, yr = .575; bd.cap(-1, 8, () => BLK_PAINT); bd.fill(-1, yr, zR + .01, zp, 'paint');
      sweep(B, 'chrome', bumperPath(zR - .042, .78, .1, .34, .585, -1, .02, S.rear.Wn), [[-.03, -.048], [.028, -.048], [.044, -.034], [.05, -.006], [.05, .012], [.043, .036], [.026, .048], [-.03, .048]], true);
      B.sym(sg => { for (let k = 0; k < 3; k++) { const x = .34 + k * .158; B.box('chrome', .15, .112, .02, x, .735, zp - .006, { bevel: .008 }); B.box(lens('red', sg > 0 ? CH.rl : CH.rr), .132, .094, .024, x, .735, zp - .014, { bevel: .009 }); B.box('chrome', .004, .094, .006, x, .735, zp - .028); }
        B.box('chrome', .09, .04, .016, .44, .47, zR + .006, { bevel: .006 }); B.box(lens('white', CH.rev), .078, .03, .014, .44, .47, zR + .001, { bevel: .005 });
        B.cyl('chrome', .034, .031, .16, .5, .29, zR + .1, { rx: HP, seg: 14, open: true }); B.cyl(M.gap, .03, .03, .15, .5, .29, zR + .105, { rx: HP, seg: 10 }); B.box('chrome', .05, .13, .045, .3, .585, zR - .075, { bevel: .014 });
        B.line(G, bd.tLine(-1.94, -2.3, .7), .005, .0006, M.gap); B.line(G, [[gi(-2.3), bd.gjT(-2.3, .7)], [gi(-2.3), bd.JT]], .005, .0006, M.gap); });
      B.cyl('chrome', .058, .058, .014, 0, .735, zp - .006, { rx: HP, seg: 24 }); B.cyl(M.blkS, .046, .046, .016, 0, .735, zp - .008, { rx: HP, seg: 24 }); B.cyl({ c: [.5, .02, .02], r: .3 }, .02, .02, .018, 0, .735, zp - .009, { rx: HP, seg: 12 });
      B.box('chrome', .34, .178, .008, 0, .46, zR + .008, { bevel: .003 }); B.decal(M.plate, .305, .152, 0, .46, zR + .003, uvOf('plate'), { ry: PI });
      B.patch(G, bd.tMap(-2.28, -2.2, .34, 0), 2, 8, .0015, M.decalChr, { uv: [.5, .25, .25, .5], skirt: 0 });
      // ---------- roof: drip rails, window reveals, rear louvres, antenna
      const GG = gh.G, sI = gh.si;
      B.sym(() => { B.line(GG, [[sI(.8), gh.nSd - .25], [sI(.02), gh.nSd - .25]], .012, .001, 'chrome', { h: .006 });
        for (const w of S.gh.win) { const a = sI(w[1]), b = sI(w[0]); B.line(GG, [[a, 1], [b, 1]], .013, .001, 'chrome', { h: .004 }); B.line(GG, [[a, gh.nSd - 1], [b, gh.nSd - 1]], .008, .001, 'chrome', { h: .003 }); B.line(GG, [[a, 1], [a, gh.nSd - 1]], .01, .001, 'chrome', { h: .003 }); B.line(GG, [[b, 1], [b, gh.nSd - 1]], .01, .001, 'chrome', { h: .003 }); } });
      const BL = gh.capR, nk = BL.nk; for (let k = 0; k < 9; k++) { const r = 1.5 + k * (gh.nSd - 2.4) / 8.6, a = BL.at(r, 1.2), b = BL.at(r, nk - 1.2), cx = (a[0] + b[0]) / 2; B.box(M.blkS, abs(a[0] - b[0]), .007, .105, cx, a[1] + .036, a[2] + .01, { rx: -.1, bevel: .003 }); }
      for (const kk of [1.2, nk / 2, nk - 1.2]) { const pts = []; for (let r = 1; r <= gh.nSd - .6; r += 1) { const a = BL.at(r, kk); pts.push([a[0], a[1] + .02, a[2]]); } B.tube(M.blkS, pts, .011, { seg: 5 }); }
      B.cyl('chrome', .0022, .003, .78, -.82, bd.ty(1.0, .82) + .38, 1.0, { seg: 5 }); B.cyl('chrome', .012, .016, .02, -.82, bd.ty(1.0, .82) + .008, 1.0, { seg: 10 }); };
    return S; };

  /* ---------------- shared pieces for the 2010s cars */
  const subQ = (c, u0, v0, u1, v1) => { const P = (u, v) => [lerp(lerp(c[0][0], c[1][0], u), lerp(c[3][0], c[2][0], u), v), lerp(lerp(c[0][1], c[1][1], u), lerp(c[3][1], c[2][1], u), v)]; return [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)]; };
  const mirQ = (c, sg) => c.map(p => [p[0] * sg, p[1]]);
  function frame(B, C, x0, y0, x1, y1, w, ms, h) { const a = C.ij(x0, y0), b = C.ij(x1, y0), c = C.ij(x1, y1), d = C.ij(x0, y1), o = { h: h || .003 }; B.line(C, [a, b], w, .002, ms, o); B.line(C, [b, c], w, .002, ms, o); B.line(C, [c, d], w, .002, ms, o); B.line(C, [d, a], w, .002, ms, o); }
  function capRect(B, C, x0, y0, x1, y1, lift, ms, o) { o = o || {}; return B.patch(C, C.map(x0, y0, x1, y1), o.nu || max(2, ceil(abs(x1 - x0) / .05)), o.nv || max(2, ceil(abs(y1 - y0) / .03)), lift, ms, o); }
  function capQuad(B, C, c, lift, ms, o) { o = o || {}; return B.patch(C, C.quad(c), o.nu || 7, o.nv || 3, lift, ms, o); }
  /** shut-lines, handles, mirrors, window trim for a 2 or 4 door body. D.doors = [front edge, B, rear edge(z at belt)] */
  function flanks(B, S, bd, gh) { const D = S.d, G = bd.G, gi = bd.gi, dz = D.doors, GG = gh.G, sI = gh.si, trim = D.trim || M.blkS, yT = z => bd.prm(z).ySh;
    B.sym(sg => { B.line(G, [[gi(dz[0]), bd.JR + .5], [gi(dz[0]), bd.JH + 1.2]], .0055, .0006, M.gap); if (dz[1] !== null) B.line(G, [[gi(dz[1]), bd.JR + .5], [gi(dz[1]), bd.JH + 1.2]], .0055, .0006, M.gap);
      const zc = dz[2], yk = D.kick || .7; B.line(G, [[gi(zc), bd.JH + 1.2], [gi(zc), bd.gjS(zc, yk)], [gi(zc + (D.kickZ || .12)), bd.gjS(zc + (D.kickZ || .12), D.sillY)]], .0055, .0006, M.gap); B.line(G, bd.sLine(zc + (D.kickZ || .12), dz[0], D.sillY), .005, .0006, M.gap);
      for (const hz of D.handles) { const hy = D.handleY, x = bd.sx(hz, hy); B.box(D.handleMs || 'paint', .022, .028, .17, x + .006, hy, hz, { bevel: .009 }); B.box(M.gap, .012, .034, .11, x + .001, hy - .012, hz + .01, { bevel: .004 }); }
      const mz = D.mirror[0], my = bd.ty(mz, bd.prm(mz).xE) + D.mirror[1], mx = bd.sx(mz, yT(mz) - .02); B.box(M.blkS, .1, .03, .06, mx + .02, my - .05, mz, { bevel: .01 }); B.box(D.mirrorMs || 'paint', .11 * (D.mirrorS || 1), .12 * (D.mirrorS || 1), .15, mx + .1, my, mz + .01, { bevel: .035 }); B.box(M.mirror, .09 * (D.mirrorS || 1), .095 * (D.mirrorS || 1), .006, mx + .1, my, mz - .066, { bevel: .002 });
      B.line(GG, [[sI(.985), 1], [sI(.015), 1]], .016, .0012, trim, { h: .004 });
      for (const w of S.gh.win) { const a = sI(w[1]), b = sI(w[0]); B.line(GG, [[a, gh.nSd - 1], [b, gh.nSd - 1]], .012, .001, trim, { h: .003 }); B.line(GG, [[a, 1], [a, gh.nSd - 1]], .014, .001, M.blkS, { h: .003 }); B.line(GG, [[b, 1], [b, gh.nSd - 1]], .014, .001, M.blkS, { h: .003 }); }
      if (D.marker) B.patch(G, bd.sMap(D.marker[0], D.marker[0] - .09, D.marker[1], D.marker[1] + .03), 3, 2, .002, lens('amber', CH.mark), { bulge: .002 });
      if (D.bumpF) B.line(G, [[gi(D.bumpF), bd.gjS(D.bumpF, D.sillY)], [gi(D.bumpF + .06), bd.gjS(D.bumpF + .06, yT(D.bumpF) - .06)]], .005, .0006, M.gap); if (D.bumpR) B.line(G, [[gi(D.bumpR), bd.gjS(D.bumpR, D.sillY + .08)], [gi(D.bumpR - .05), bd.gjS(D.bumpR - .05, yT(D.bumpR) - .1)]], .005, .0006, M.gap);
      if (D.hood) { const h = D.hood; B.line(G, bd.tLine(h[1], h[2], h[0]), .005, .0006, M.gap); B.line(G, [[gi(h[2]), bd.gjT(h[2], h[0])], [gi(h[2]), bd.JT]], .005, .0006, M.gap); B.patch(G, bd.tMap(h[1] - .09, h[1] - .005, h[0] + .04, 0), 3, 12, .0012, M.blkM, { skirt: 0 }); }
      if (D.trunk) { const h = D.trunk; B.line(G, bd.tLine(h[1], h[2], h[0]), .005, .0006, M.gap); } });
    const WS = gh.capF, nk = WS.nk, wip = (k0, k1) => { const a = WS.at(1.05, k0), b = WS.at(2.0, k1), o = .014; B.tube(M.blkS, [[a[0] + a[3] * o, a[1] + a[4] * o, a[2] + a[5] * o], [b[0] + b[3] * o, b[1] + b[4] * o, b[2] + b[5] * o]], .005, { seg: 5, steps: 2 });
      const c = WS.at(2.9, k1 + 1.3), d = WS.at(1.25, k1 - 3.2); B.tube(M.rubber, [[c[0] + c[3] * .008, c[1] + c[4] * .008, c[2] + c[5] * .008], [b[0] + b[3] * .01, b[1] + b[4] * .01, b[2] + b[5] * .01], [d[0] + d[3] * .008, d[1] + d[4] * .008, d[2] + d[5] * .008]], .006, { seg: 5, steps: 6 }); };
    wip(nk * .2, nk * .42); wip(nk * .58, nk * .8); }
  /** modern front/rear fascias drawn as raised patches on the end caps. Returns {F, R} */
  function fascias(B, S, bd, capMs) { const D = S.d, F = bd.cap(1, 28, capMs ? () => capMs : null), R = bd.cap(-1, 28, capMs ? () => capMs : null), g = D.grille, it = D.intake;
    capRect(B, F, -g.x, g.y0, g.x, g.y1, .002, M.gap, { skirt: .003 }); const nb = g.bars || 4; for (let k = 1; k < nb; k++) { const y = lerp(g.y0, g.y1, k / nb); B.line(F, [F.ij(-g.x + .012, y), F.ij(g.x - .012, y)], g.barW || .012, .004, g.barMs || M.blkS, { h: .004 }); }
    frame(B, F, -g.x, g.y0, g.x, g.y1, g.frameW || .012, g.chrome ? 'chrome' : M.blkS, .005); if (g.badge) { const yb = (g.y0 + g.y1) / 2; capRect(B, F, -.045, yb - .03, .045, yb + .03, .007, 'chrome', { nu: 3, nv: 3, bulge: .004 }); }
    if (it) { capRect(B, F, -it.x, it.y0, it.x, it.y1, .0015, M.blkM, { skirt: .003 }); for (let k = 1; k < 3; k++) { const y = lerp(it.y0, it.y1, k / 3); B.line(F, [F.ij(-it.x + .02, y), F.ij(it.x - .02, y)], .01, .003, M.blkS, { h: .003 }); } }
    const edge = (C, q) => { for (let k = 0; k < 4; k++) B.line(C, [C.ij(q[k][0], q[k][1]), C.ij(q[(k + 1) % 4][0], q[(k + 1) % 4][1])], .009, .0012, M.gap); };
    for (const sg of [1, -1]) { const hq = mirQ(D.head, sg); edge(F, hq); capQuad(B, F, hq, .003, lens('smoke', 0), { bulge: .005 }); for (const u of D.proj || [[.12, .48], [.52, .82]]) capQuad(B, F, subQ(hq, u[0], .2, u[1], .8), .0065, lens('bowl', CH.head), { nu: 4, nv: 3, bulge: .003, skirt: .002 });
      capQuad(B, F, subQ(hq, .86, .12, .98, .88), .0065, lens('amber', sg > 0 ? CH.fl : CH.fr), { nu: 2, nv: 3, skirt: .002 });
      if (D.fog) { const f = D.fog; capRect(B, F, sg * (f[0] - f[2]), f[1] - f[3], sg * (f[0] + f[2]), f[1] + f[3], .002, M.gap, { nu: 3, nv: 2 }); capRect(B, F, sg * (f[0] - f[2] * .6), f[1] - f[3] * .6, sg * (f[0] + f[2] * .6), f[1] + f[3] * .6, .005, lens('white', CH.white), { nu: 2, nv: 2, bulge: .003, skirt: .002 }); }
      const tq = mirQ(D.tail, sg), tc = sg > 0 ? CH.rl : CH.rr; edge(R, tq); capQuad(B, R, tq, .003, lens('redDk', tc), { bulge: .005 }); for (const v of D.tailSeg || [[.36, .14, .97, .44], [.36, .56, .97, .86]]) capQuad(B, R, subQ(tq, v[0], v[1], v[2], v[3]), .0075, lens('red', tc), { nu: 5, nv: 2, skirt: .0025, bulge: .002 }); if (D.rev) capQuad(B, R, subQ(tq, D.rev[0], D.rev[1], D.rev[2], D.rev[3]), .0055, lens('white', CH.rev), { nu: 3, nv: 2, skirt: .002 });
      if (D.refl) capRect(B, R, sg * (D.refl[0] - .05), D.refl[1] - .011, sg * (D.refl[0] + .05), D.refl[1] + .011, .002, lens('redDk', CH.mark), { nu: 3, nv: 2 }); }
    { const nu = bd.G.nu, n = (S.nL || 6) + (D.wrap || 3), G = bd.G, hy = D.head, ty = D.tail, zf = S.zF - .12, zr = S.zR + .12;
      B.sym(sg => { B.patch(G, rect(nu - 1, nu - 1 - n, bd.gjS(zf, hy[1][1]), bd.gjS(zf, hy[2][1])), n, 3, .003, lens('smoke', 0), { bulge: .002 }); B.patch(G, rect(nu - 2, nu - 1 - n * .6, bd.gjS(zf, lerp(hy[1][1], hy[2][1], .15)), bd.gjS(zf, lerp(hy[1][1], hy[2][1], .85))), 4, 2, .0062, lens('amber', sg > 0 ? CH.fl : CH.fr), { skirt: .002 });
        B.patch(G, rect(0, n, bd.gjS(zr, ty[1][1]), bd.gjS(zr, ty[2][1])), n, 3, .003, lens('redDk', sg > 0 ? CH.rl : CH.rr), { bulge: .002 }); B.patch(G, rect(1, n * .8, bd.gjS(zr, lerp(ty[1][1], ty[2][1], .25)), bd.gjS(zr, lerp(ty[1][1], ty[2][1], .75))), n, 2, .0062, lens('red', sg > 0 ? CH.rl : CH.rr), { skirt: .002 }); }); }
    const p = D.plate; if (p > 0) capRect(B, R, .19, p - .1, -.19, p + .1, .0012, M.blkM, { nu: 4, nv: 3, skirt: .002 }); if (p > 0) capRect(B, R, .1525, p - .076, -.1525, p + .076, .004, M.plate, { nu: 4, nv: 3, uv: uvOf('plate'), skirt: .002 });
    if (D.valance) { const v = D.valance; capRect(B, R, v.x, v.y0, -v.x, v.y1, .0015, M.blkM, { skirt: .003 }); if (v.tip) { const q = R.at.apply(R, R.ij(v.tip, (v.y0 + v.y1) / 2 - .01)); B.cyl('chrome', .034, .034, .1, q[0], q[1], q[2] + .02, { rx: HP, seg: 14, open: true }); B.cyl(M.gap, .03, .03, .09, q[0], q[1], q[2] + .025, { rx: HP, seg: 10 }); } }
    if (D.lid) { const l = D.lid; B.line(R, [R.ij(l.x, l.y1), R.ij(l.x, l.y0), R.ij(-l.x, l.y0), R.ij(-l.x, l.y1)], .005, .0008, M.gap); }
    if (D.badge) { const b = D.badge; capRect(B, R, b[0], b[1], b[0] - b[2], b[1] + b[3], .0015, M.decalChr, { nu: 5, nv: 2, uv: uvOf('B'), skirt: 0 }); }
    if (D.badge2) { const b = D.badge2; capRect(B, R, b[0], b[1], b[0] - b[2], b[1] + b[3], .0015, M.decalChr, { nu: 3, nv: 2, uv: uvOf('C'), skirt: 0 }); }
    return { F, R }; }

  function sedanBase(cop) { const BLKP = { paint: [.012, .012, .014] }; const S = {
    L: 4.86, Wd: 1.85, H: 1.46, zR: -2.43, zF: 2.43, dz: .045, nS: 14, nT: 13, nH: 5, nR: 4, color: 0x8d9499, dust: [.18, .62, .5, 2.43], eye: [.37, 1.2, -.05],
    W: K([[-2.43, .845], [-2.05, .905], [-1.36, .925], [0, .925], [1.44, .922], [2.0, .9], [2.43, .85]]),
    yb: K([[-2.43, .34], [-1.9, .27], [-1.0, .2], [1.0, .2], [1.95, .215], [2.43, .25]]), yW: K([[-2.43, .72], [0, .65], [2.43, .6]]),
    ySh: K([[-2.43, .96], [-2.1, .995], [-1.5, 1.0], [-.5, .975], [.95, .935], [1.44, .875], [2.0, .81], [2.43, .74]]),
    yC: K([[-2.43, 1.0], [-2.25, 1.035], [-1.75, 1.05], [-.5, 1.03], [.95, .985], [1.44, .93], [2.0, .865], [2.43, .785]]),
    tum: K([[-2.43, .055], [0, .05], [2.43, .04]]), rS: K([[-2.43, .07], [-1.0, .04], [.6, .04], [1.44, .07], [2.43, .08]]), rSy: K(.03), p: K(2.3),
    rr: .06, rrx: .05, aLow: .04, eL: 1.7, eU: 1.35, xi: .52,
    arches: [{ z: 1.44, y: .33, R: .385, flare: .008, fw: .05 }, { z: -1.36, y: .33, R: .385, flare: .008, fw: .05 }],
    front: { r: .05, bowX: .2, bowY: .04, y0: .52, hy: .3, start: 1.86 }, rear: { r: .045, bowX: .13, bowY: .03, y0: .65, hy: .35, start: -1.78 },
    wheel: cop ? { R: .335, w: .225, rim: .215, disc: .15, hub: .07, cap: .05, dish: .04, lugs: 5, seg: 32, lip: { c: [.018, .018, .02], r: .38, m: .6 }, face: { c: [.018, .018, .02], r: .38, m: .6 }, capM: M.chr, holes: 10 }
      : { R: .33, w: .215, rim: .225, disc: .16, hub: .06, cap: .028, dish: .03, lugs: 5, seg: 32, lip: M.alu, face: M.alu, capM: M.dkm, lugM: M.dkm, spoke: { n: 5, twin: .21, th: .026, w0: .034, w1: .028, rise: .01, bev: .006 } },
    wheels: { fz: 1.44, rz: -1.36, fx: .802, rx: .802 },
    interior: { z0: -1.4, z1: .82, floor: .3, dash: .93, seatZ: .02, rearZ: -.85, shelf: [-1.5, -1.2], shelfY: .98 },
    under: { y: .19, exh: [.8, -2.2], tipX: .5, tipY: .27, axle: -1.36, axleY: .33, tank: [-1.9, -1.5], tankY: .3, front: 1.44 },
    gh: { keys: [[0, .98, .2], [.42, -.1, -.1], [.8, -1.1, -.84], [1, -1.72, -1.04]], win: [[.045, .405], [.435, .8]], black: [[.405, .435]], sub: 30, nSide: 8, nH: 4, nT: 7, nk: 18,
      Wb: K([[0, .79], [.42, .825], [1, .76]]), tum: K([[0, .13], [.5, .15], [1, .17]]), yR: K([[0, 1.415], [.3, 1.455], [.6, 1.458], [1, 1.4]]), drop: .05, rG: .09, rGy: .036, rc: .05, sill: .035, rail: .085, barrel: .012, wsBulge: .09, blBulge: .06, reveal: M.blkS },
    d: { doors: [.86, -.1, -1.04], kick: .74, kickZ: .14, sillY: .27, handles: [-.02, -.92], handleY: .86, mirror: [.84, .07], hood: [.7, .93, 2.04], trunk: [.68, -1.76, -2.3], marker: [2.08, .5], bumpF: 1.86, bumpR: -1.8,
      grille: { x: .36, y0: .56, y1: .69, bars: 4, chrome: !cop, badge: !cop }, intake: { x: .5, y0: .335, y1: .45 }, head: [[.41, .59], [.835, .6], [.835, .72], [.41, .695]], fog: [.66, .385, .055, .028],
      tail: [[.4, .81], [.86, .79], [.86, .915], [.4, .915]], rev: [.05, .2, .3, .8], refl: [.68, .5], plate: .63, valance: { x: .62, y0: .395, y1: .47, tip: cop ? 0 : -.45 }, lid: { x: .66, y0: .74, y1: 1.2 }, badge: cop ? null : [-.28, .72, .3, .05], badge2: cop ? null : [.56, .72, .1, .045] } };
    S.cut = (z, x) => z > -1.5 && z < .84 && x < S.gh.Wb(sAtZ(S.gh, z)) - .035;
    if (cop) { S.dust = [.18, .5, .3, 2.43]; S.mat = (i, j, zc) => (zc < S.d.doors[0] && zc > S.d.doors[2] - .02) ? 'paint' : BLKP; S.d.mirrorMs = BLKP; S.d.handleMs = M.blkS; S.wheels.fx = S.wheels.rx = .795; }
    else S.mat = (i, j) => j < 5 ? M.blkM : 'paint';
    S.build = B => { const bd = makeBody(B, S), G = bd.G, gi = bd.gi; for (const a of S.arches) archParts(B, bd, a, cop ? BLKP : 'paint'); const gh = makeGreenhouse(B, S, bd); interior(B, S, bd, gh); underbody(B, S); flanks(B, S, bd, gh);
      const fr = fascias(B, S, bd, cop ? BLKP : null), F = fr.F, R = fr.R; B.box('paint', .05, .035, .17, 0, gh.g.yR(.8) - .012, -.86, { bevel: .014, rx: .12 });
      { const a = gh.capR.at(gh.nSd - 1.6, gh.capR.nk / 2); B.box(lens('redDk', CH.stop), .26, .016, .02, 0, a[1] - .01, a[2] + .03, { bevel: .004 }); }
      if (cop) copGear(B, S, bd, gh, F, R, BLKP); };
    return S; }
  function copGear(B, S, bd, gh, F, R, BLKP) { const G = bd.G, gi = bd.gi, zN = S.zF, yr = gh.g.yR(.45), zr = gh.kz(.45)[1];
    // roof light bar: clear-capped LED bar, red on the driver's side, blue on the passenger's, white take-downs + alley lights
    B.push(0, yr + .012, zr); for (const sx of [-1, 1]) { B.box(M.blkS, .09, .05, .2, sx * .4, .02, 0, { bevel: .012 }); B.box(M.blkS, .16, .014, .26, sx * .4, .0, 0, { bevel: .005 }); }
    B.box(M.blkS, 1.16, .022, .27, 0, .058, 0, { bevel: .009 }); B.box(M.blkS, 1.16, .016, .27, 0, .126, 0, { bevel: .007 }); B.box(M.blkS, .1, .06, .25, 0, .092, 0, { bevel: .008 });
    for (const sx of [-1, 1]) { const col = sx > 0 ? 'red' : 'blue', ch = sx > 0 ? CH.sirR : CH.sirB; B.box(lens(col, ch), .5, .054, .285, sx * .31, .092, 0, { bevel: .02 }); for (let k = 0; k < 4; k++) { B.box(M.chr, .09, .03, .01, sx * (.12 + k * .12), .092, .13); B.box(M.chr, .09, .03, .01, sx * (.12 + k * .12), .092, -.13); }
      B.box(lens('white', CH.white), .03, .04, .12, sx * .578, .092, 0, { bevel: .008 }); }
    B.box(lens('white', CH.white), .08, .036, .012, .0, .092, .128, { bevel: .004 }); B.pop();
    // push bar
    const zb = zN + .06, pb = { c: [.014, .014, .016], r: .42, m: .3 }; for (const sx of [-1, 1]) { B.box(pb, .045, .5, .05, sx * .27, .52, zb, { bevel: .012 }); B.box(pb, .04, .05, .2, sx * .27, .3, zb - .09, { bevel: .01 }); B.box(M.rubber, .03, .4, .012, sx * .27, .52, zb + .03, { bevel: .004 });
      B.tube(pb, [[sx * .29, .7, zb], [sx * .55, .7, zb - .02], [sx * .78, .68, zb - .16], [sx * .8, .56, zb - .2], [sx * .78, .44, zb - .16], [sx * .55, .42, zb - .02], [sx * .29, .42, zb]], .019, { seg: 7 }); }
    B.cyl(pb, .021, .021, .56, 0, .74, zb, { rz: HP, seg: 8 }); B.cyl(pb, .021, .021, .56, 0, .56, zb, { rz: HP, seg: 8 }); B.cyl(pb, .021, .021, .56, 0, .38, zb, { rz: HP, seg: 8 });
    // spot lamp on the driver's A pillar, antennas, roof puck
    { const a = gh.G.at(gh.si(.02), 1.2); B.cyl(M.chr, .008, .008, .12, a[0] + .05, a[1] + .06, a[2] + .02, { rz: .9, seg: 6 }); B.cyl(M.blkS, .055, .048, .09, a[0] + .1, a[1] + .1, a[2] + .05, { rx: HP, seg: 14 }); B.cyl(lens('white', 0), .05, .05, .006, a[0] + .1, a[1] + .1, a[2] + .097, { rx: HP, seg: 14 }); }
    for (const p of [[.45, -1.95, .55], [-.45, -1.95, .4], [0, -.6, .12]]) { const y = p[1] < -1.7 ? bd.ty(p[1], abs(p[0])) : gh.g.yR(.7); B.cyl(M.blkS, .014, .02, .025, p[0], y + .01, p[1], { seg: 8 }); B.cyl(M.blkS, .0025, .0035, p[2], p[0], y + .02 + p[2] / 2, p[1], { seg: 5 }); }
    // livery
    B.sym(sg => { const fl = sg < 0, zz = (a, b) => fl ? [b, a] : [a, b]; let z = zz(.5, -.66); B.patch(G, bd.sMap(z[0], z[1], .66, .84), 14, 5, .0012, M.decal, { uv: uvOf('B'), skirt: 0 });
      z = zz(.42, -.58); B.patch(G, bd.sMap(z[0], z[1], .575, .625), 12, 2, .0012, M.decal, { uv: uvOf('D'), skirt: 0 }); z = zz(-.72, -.98); B.patch(G, bd.sMap(z[0], z[1], .62, .88), 5, 6, .0012, M.decal, { uv: uvOf('A'), skirt: 0 });
      z = zz(1.36, 1.1); B.patch(G, bd.sMap(z[0], z[1], .74, .84), 5, 3, .0012, M.decal, { uv: uvOf('C'), skirt: 0 }); z = zz(-1.86, -2.1); B.patch(G, bd.sMap(z[0], z[1], .8, .9), 5, 3, .0012, M.decal, { uv: uvOf('C'), skirt: 0 });
      const u = uvOf('F'), um = (u[0] + u[2]) / 2; B.patch(gh.G, (a, b) => [gh.si(lerp(.62, .82, b)), gh.JH + lerp(gh.JT - gh.JH, gh.JT - gh.JH - 4.2, a)], 4, 5, .0012, M.decal, { uv: fl ? [um, u[1], u[2], u[3]] : [um, u[1], u[0], u[3]], skirt: 0 }); });
    capRect(B, R, -.3, .93, -.62, .97, .0012, M.decal, { nu: 6, nv: 2, uv: uvOf('E'), skirt: 0 }); }
  DEFS.sedan = () => sedanBase(false); DEFS.cruiser = () => sedanBase(true);

  DEFS.compact = () => { const S = {
    L: 4.06, Wd: 1.74, H: 1.49, zR: -2.03, zF: 2.03, dz: .038, nS: 14, nT: 12, nH: 5, nR: 4, color: 0x2f5d74, dust: [.18, .6, .4, 2.03], eye: [.35, 1.22, -.02],
    W: K([[-2.03, .81], [-1.7, .86], [-1.25, .872], [0, .872], [1.3, .868], [1.7, .85], [2.03, .8]]),
    yb: K([[-2.03, .33], [-1.6, .25], [-.9, .19], [.9, .19], [1.65, .21], [2.03, .25]]), yW: K([[-2.03, .74], [0, .67], [2.03, .62]]),
    ySh: K([[-2.03, 1.0], [-1.5, 1.035], [-.5, 1.0], [.82, .955], [1.3, .88], [1.7, .8], [2.03, .72]]),
    yC: K([[-2.03, 1.03], [-1.5, 1.065], [-.5, 1.045], [.82, 1.0], [1.3, .94], [1.7, .865], [2.03, .76]]),
    tum: K(.05), rS: K([[-2.03, .06], [-1.0, .04], [.6, .04], [1.3, .07], [2.03, .08]]), rSy: K(.03), p: K(2.3), rr: .06, rrx: .05, aLow: .04, eL: 1.7, eU: 1.35, xi: .5,
    arches: [{ z: 1.3, y: .305, R: .36, flare: .009, fw: .05 }, { z: -1.25, y: .305, R: .36, flare: .009, fw: .05 }],
    front: { r: .07, bowX: .2, bowY: .05, y0: .5, hy: .3, start: 1.69 }, rear: { r: .06, bowX: .1, bowY: .03, y0: .7, hy: .4, start: -1.64 },
    wheel: { R: .305, w: .195, rim: .2, disc: .14, hub: .055, cap: .026, dish: .028, lugs: 4, seg: 32, lip: M.alu, face: M.alu, capM: M.dkm, lugM: M.dkm, spoke: { n: 7, th: .026, w0: .05, w1: .034, rise: .008, bev: .007 } },
    wheels: { fz: 1.3, rz: -1.25, fx: .765, rx: .765 },
    interior: { z0: -1.6, z1: .68, floor: .3, dash: .95, seatZ: -.05, rearZ: -.9 },
    under: { y: .18, exh: [.7, -1.85], tipX: .45, tipY: .26, axle: -1.25, axleY: .305, front: 1.3 },
    gh: { keys: [[0, .84, .14], [.45, -.14, -.16], [.85, -1.2, -1.12], [1, -1.9, -1.52]], win: [[.045, .43], [.46, .84], [.865, .96]], black: [[.43, .46]], sub: 30, nSide: 8, nH: 4, nT: 7, nk: 18,
      Wb: K([[0, .75], [.45, .78], [.85, .76], [1, .7]]), tum: K([[0, .12], [1, .13]]), yR: K([[0, 1.44], [.3, 1.485], [.7, 1.49], [1, 1.452]]), drop: .05, rG: .09, rGy: .036, rc: .05, rcR: .04, sill: .035, rail: .085, barrel: .012, wsBulge: .085, blBulge: .05, reveal: M.blkS },
    d: { doors: [.72, -.14, -.98], kick: .76, kickZ: .12, sillY: .26, handles: [-.06, -.86], handleY: .88, mirror: [.72, .07], hood: [.66, .8, 1.72], marker: [1.74, .5], bumpF: 1.68, bumpR: -1.66,
      grille: { x: .3, y0: .58, y1: .66, bars: 3, chrome: false, badge: true }, intake: { x: .5, y0: .33, y1: .47 }, head: [[.36, .585], [.79, .61], [.79, .705], [.36, .675]], proj: [[.2, .62]], fog: [.62, .39, .05, .03],
      tail: [[.54, .82], [.82, .82], [.82, .995], [.58, .995]], tailSeg: [[.12, .5, .9, .9]], rev: [.1, .1, .55, .38], refl: [.62, .47], plate: .7, valance: { x: .55, y0: .38, y1: .45, tip: 0 }, lid: { x: .5, y0: .56, y1: 1.3 }, badge: [-.2, .86, .22, .05], badge2: [.42, .86, .1, .045] } };
    S.cut = (z, x) => z > -1.76 && z < .7 && x < S.gh.Wb(sAtZ(S.gh, z)) - .035; S.mat = (i, j) => j < 5 ? M.blkM : 'paint';
    S.build = B => { const bd = makeBody(B, S); for (const a of S.arches) archParts(B, bd, a, M.blkM); const gh = makeGreenhouse(B, S, bd); interior(B, S, bd, gh); underbody(B, S); flanks(B, S, bd, gh); fascias(B, S, bd, null);
      const BL = gh.capR, nk = BL.nk, a = BL.at(1.1, nk * .5), b = BL.at(2.6, nk * .22); B.tube(M.blkS, [[a[0], a[1] + .012, a[2] - .012], [b[0], b[1] + .01, b[2] - .012]], .006, { seg: 5, steps: 2 }); B.cyl(M.blkS, .02, .02, .02, a[0], a[1] + .01, a[2] - .012, { rx: HP, seg: 8 });
      const t = BL.at(gh.nSd + 1, nk / 2); B.box(M.blkS, 1.05, .02, .14, 0, t[1] + .012, t[2] - .03, { rx: .1, bevel: .008 }); B.box(lens('redDk', CH.stop), .22, .012, .012, 0, t[1] + .004, t[2] - .102, { bevel: .003 }); B.cyl(M.blkS, .003, .004, .22, 0, gh.g.yR(.7) + .09, -.95, { rx: -.5, seg: 5 }); };
    return S; };

  DEFS.pickup = () => { const S = {
    L: 5.85, Wd: 2.03, H: 1.93, zR: -2.95, zF: 2.9, dz: .05, nS: 14, nT: 12, nH: 5, nR: 4, color: 0xd7d3c8, dust: [.4, .95, .6, 2.9], eye: [.42, 1.62, .22],
    W: K([[-2.95, .975], [-2.5, 1.0], [0, 1.005], [1.9, 1.0], [2.5, .985], [2.9, .95]]),
    yb: K([[-2.95, .58], [-2.4, .52], [-1.2, .43], [1.2, .43], [2.4, .47], [2.9, .52]]), yW: K(.88),
    ySh: K([[-2.95, 1.25], [1.0, 1.24], [1.9, 1.195], [2.5, 1.15], [2.9, 1.08]]), yC: K([[-2.95, 1.27], [1.0, 1.295], [1.9, 1.26], [2.5, 1.21], [2.9, 1.125]]),
    tum: K(.035), rS: K([[-2.95, .035], [1.0, .04], [1.95, .075], [2.9, .075]]), rSy: K(.03), p: K(2.8), rr: .06, rrx: .05, aLow: .035, eL: 1.8, eU: 1.5, xi: .56,
    arches: [{ z: 1.95, y: .4, R: .475, flare: .03, fw: .06, lip: .035 }, { z: -1.73, y: .4, R: .475, flare: .03, fw: .06, lip: .035 }],
    front: { r: .06, bowX: .09, bowY: .02, y0: .8, hy: .4, start: 2.45 }, rear: { r: .03, bowX: .015, bowY: 0, y0: .9, hy: .4, start: -2.25 },
    wheel: { R: .4, w: .275, rim: .235, disc: .17, hub: .075, cap: .04, dish: .045, lugs: 6, seg: 34, trep: 5, grooves: [-.5, -.17, .17, .5], lip: M.alu, face: M.alu, capM: M.chr, spoke: { n: 6, th: .04, w0: .085, w1: .062, rise: .012, bev: .01 } },
    wheels: { fz: 1.95, rz: -1.73, fx: .865, rx: .865 },
    interior: { z0: -.5, z1: .9, floor: .62, dash: 1.22, seatZ: .28, rearZ: undefined },
    under: { y: .42, exh: [1.2, -2.5], tipX: .7, tipY: .46, axle: -1.73, axleY: .4, tank: [-1.2, -.4], tankY: .5, front: 1.95 },
    gh: { keys: [[0, 1.04, .42], [.5, .2, .14], [1, -.62, -.5]], win: [[.055, .47], [.53, .93]], black: [[.47, .53]], sub: 24, nSide: 8, nH: 4, nT: 7, nk: 18,
      Wb: K(.88), tum: K(.115), yR: K([[0, 1.87], [.4, 1.925], [1, 1.912]]), drop: .05, rG: .09, rGy: .036, rc: .05, sill: .03, rail: .075, barrel: .01, wsBulge: .07, blBulge: .015, reveal: M.blkS },
    d: { doors: [.96, .17, -.56], kick: .5, kickZ: 0, sillY: .5, handles: [.26, -.46], handleY: 1.1, handleMs: M.blkS, mirror: [.98, .1], mirrorMs: M.blkS, mirrorS: 1.5, hood: [.8, 1.0, 2.5], marker: [2.6, .78],
      grille: { x: .6, y0: .74, y1: 1.02, bars: 4, chrome: true, badge: true, barW: .03, barMs: 'chrome', frameW: .04 }, intake: null, head: [[.64, .86], [.93, .86], [.93, 1.03], [.64, 1.03]], proj: [[.1, .55]],
      tail: [[.84, .93], [.97, .93], [.97, 1.21], [.84, 1.21]], tailSeg: [[.15, .4, .85, .64], [.15, .7, .85, .94]], rev: [.15, .08, .85, .3], plate: -9, wrap: 1, lid: { x: .82, y0: .66, y1: 1.3 }, badge: [.34, .98, .68, .11], badge2: [-.5, .72, .2, .07] } };
    const bedX = z => S.W(z) - .09, FL = .86;
    S.cut = (z, x) => (z > -.5 && z < .9 && x < S.gh.Wb(0) - .035) || (z > -2.88 && z < -.72 && x < bedX(z)); S.mat = (i, j) => j < 5 ? M.blkM : 'paint';
    S.build = B => { const bd = makeBody(B, S), G = bd.G, gi = bd.gi; for (const a of S.arches) archParts(B, bd, a, M.blkM); const gh = makeGreenhouse(B, S, bd); interior(B, S, bd, gh); underbody(B, S); flanks(B, S, bd, gh);
      const fr = fascias(B, S, bd, null), F = fr.F, R = fr.R; B.box('chrome', .34, .178, .008, 0, .66, S.zR - .128, { bevel: .003 }); B.decal(M.plate, .305, .152, 0, .66, S.zR - .134, uvOf('plate'), { ry: PI });
      // bed tub, wheel tubs, tailgate hardware
      { const n = 12, T2 = new Grid(n + 1, 3); for (let k = 0; k <= n; k++) { const z = lerp(-2.89, -.71, k / n), x = bedX(z) + .004; T2.set(k, 0, x, bd.ty(z, x) - .004, z); T2.set(k, 1, x, FL, z); T2.set(k, 2, 0, FL, z); } T2.face(n >> 1, 1, 0, 1, 0); T2.mats((i, j) => j ? M.blkM : 'paint'); T2.finish({ cx: true }); B.sym(() => T2.emit(B)); }
      B.box('paint', 1.84, .46, .03, 0, FL + .22, -.725); B.box('paint', 1.84, .46, .03, 0, FL + .22, -2.875); B.sym(() => B.box(M.blkM, .22, .2, .9, .81, FL + .09, -1.73, { bevel: .06 }));
      B.box(M.blkS, .2, .05, .02, 0, 1.12, S.zR - .012, { bevel: .01 }); B.box(M.gap, .15, .03, .012, 0, 1.108, S.zR - .016);
      // chrome bumpers, air dam, tow hooks, step bars, hitch
      sweep(B, 'chrome', bumperPath(S.zF + .05, .82, .14, .4, .63, 1, .09, S.front.Wn), [[-.05, -.09], [.03, -.09], [.055, -.07], [.066, -.02], [.066, .03], [.056, .075], [.03, .09], [-.05, .09]]);
      B.box(M.blkM, 1.5, .1, .08, 0, .49, S.zF - .02, { bevel: .02, rx: -.2 }); B.sym(() => { B.box(M.gap, .16, .06, .02, .62, .63, S.zF + .1 - .09 * (.62 / S.front.Wn) ** 2, { bevel: .01 }); B.box(lens('white', CH.white), .1, .04, .02, .62, .63, S.zF + .105 - .09 * (.62 / S.front.Wn) ** 2, { bevel: .01 }); B.box({ c: [.5, .03, .02], r: .4, m: .5 }, .03, .06, .1, .32, .5, S.zF + .04, { bevel: .012 }); });
      sweep(B, 'chrome', bumperPath(S.zR - .06, .84, .1, .32, .66, -1, .015, S.rear.Wn), [[-.05, -.08], [.035, -.08], [.06, -.06], [.068, -.01], [.068, .03], [.05, .06], [.03, .08], [-.05, .08]], true);
      B.box(M.blkM, 1.0, .012, .09, 0, .742, S.zR - .07, { bevel: .004 }); B.box(M.dkm, .07, .07, .22, 0, .5, S.zR - .02, { bevel: .012 }); B.cyl(M.chr, .026, .026, .05, 0, .56, S.zR - .11, { seg: 12 }); B.sph(M.chr, .026, 0, .6, S.zR - .11, { seg: 12 });
      B.sym(() => { B.tube('chrome', [[1.02, .44, .95], [1.06, .4, .85], [1.06, .4, -.45], [1.02, .44, -.56]], .038, { seg: 8 }); for (const z of [.6, -.2]) B.box(M.dkm, .16, .03, .05, .96, .43, z); B.box(M.blkM, .07, .008, 1.1, 1.06, .44, .2); });
      B.sym(() => { for (const z of [-.72, -2.9]) B.line(G, [[gi(z), bd.JR + .5], [gi(z), bd.JH + 1]], .006, .0006, M.gap); B.patch(G, bd.sMap(-.2, -.02, .9, .955), 5, 2, .0015, M.decalChr, { uv: uvOf('F'), skirt: 0 }); });
      B.cyl(M.blkS, .004, .005, .5, -.86, 1.5, 1.02, { seg: 5, rx: -.25 }); B.box(lens('redDk', CH.stop), .3, .02, .02, 0, gh.g.yR(1) - .03, -.535, { bevel: .005 });
      for (const sx of [-1, 1]) for (const z of [.9, -2.3]) B.box(M.dkm, .09, .14, z > 0 ? 3.6 : 1.2, sx * .46, .5, z > 0 ? .9 : -2.2, { bevel: .01 }); };
    return S; };

  /* ================================================================== templates + instances */
  const TPL = {};
  function template(kind) { if (TPL[kind]) return TPL[kind]; const S = DEFS[kind](), B = new Builder(); S.build(B);
    const k = GT.kit(), t = { S, geo: {}, tris: 0 }; for (const name in B.bags) { const bag = B.bags[name]; if (name === 'paint' || name === 'detail') { t.geo[name] = bag.build(true); t.geo[name].computeBoundingSphere(); t.tris += bag.I.length / 3; } else { k.geo(name, bag.build(false)); t.tris += bag.I.length / 3; } }
    t.std = k.build(); t.wheel = wheelGeo(S.wheel); t.tris += t.wheel.index.count / 3 * 4; t.fx = fxGeo(S.L, S.Wd, kind === 'cruiser'); S._bd = S._gh = null; return TPL[kind] = t; }
  let WM = {};
  function wheelMat(white) { const k = white ? 'w' : 'p'; if (WM[k]) return WM[k]; const t = wheelTex(); return WM[k] = detailMat(white ? t.white : t.plain, t.nrm); }
  const PLATES = ['KRL 482', 'SUN 0VR', 'BVD 719', '7CAL 23', 'HEAT 69', 'MRA 5521', 'ZQT 104', 'PSL 8830'];

  function make(kind, opts) { opts = opts || {}; if (!DEFS[kind]) kind = 'sedan'; const t = template(kind), S = t.S, group = new T.Group(); group.name = 'car_' + kind;
    const rnd = GT.rng(kind + (opts.seed || opts.plate || '') + (make.n = (make.n || 0) + 1)), plate = opts.plate || PLATES[(rnd() * PLATES.length) | 0], unit = String(opts.unit || (kind === 'cruiser' ? 20 + ((rnd() * 70) | 0) : ''));
    const color = kind === 'cruiser' ? 0xf1f0ea : (opts.color !== undefined ? opts.color : S.color), meshes = {};
    const add = (name, geo, mat, cast) => { const m = new T.Mesh(geo, mat); m.castShadow = cast !== false; m.receiveShadow = true; m.name = name; group.add(m); meshes[name] = m; return m; };
    const dust = S.dust.slice(0, 4); if (opts.dirt !== undefined) dust[2] = opts.dirt; dust.push(S.wheels.fz, S.wheels.rz, S.arches[0].R); add('paint', t.geo.paint, paintMat(color, dust));
    const dm = detailMat(atlas(kind, plate, unit), null, { alphaTest: .5, offset: true }); add('detail', t.geo.detail, dm);
    for (const m of t.std.children) { const c = m.clone(); c.name = m.material.name; group.add(c); meshes[c.name] = c; }
    const wm = wheelMat(!!S.wheel.white), wheels = [], steer = [], W = S.wheels, R = S.wheel.R;
    for (let i = 0; i < 4; i++) { const front = i < 2, left = i % 2 === 0, piv = new T.Group(), sp = new T.Group(), mesh = new T.Mesh(t.wheel, wm), sc = front ? [1, 1] : (W.rear || [1, 1]);
      mesh.castShadow = mesh.receiveShadow = true; mesh.scale.set(sc[0], sc[1], sc[1]); if (!left) mesh.rotation.y = PI; sp.add(mesh); piv.add(sp); piv.position.set((left ? 1 : -1) * (front ? W.fx : W.rx), R * sc[1], front ? W.fz : W.rz); group.add(piv); wheels.push(sp); if (front) steer.push(piv); }
    let fxm = null; if (opts.fx !== false) { fxm = new T.Mesh(t.fx, fxMat(S.L, S.Wd)); fxm.renderOrder = 2; fxm.name = 'fx'; group.add(fxm); meshes.fx = fxm; }
    const L = { head: 0, brake: 0, reverse: 0, left: 0, right: 0, siren: 0, hazard: 0 }, lv = dm.userData.gtLv; let tm = rnd() * 3, dirty = true, lastN = -1;
    const car = { group, kind, meshes, lights: L, wheels, steer, blinkOn: false, sirenPhase: 0,
      dims: { L: S.L, W: S.Wd, H: S.H, wheelbase: W.fz - W.rz, track: W.fx * 2, wheelR: R, wheelRRear: R * (W.rear ? W.rear[1] : 1), axleF: W.fz, axleR: W.rz, eye: S.eye.slice() },
      setLights(o) { for (const k in o) if (k in L) { const v = o[k] === true ? 1 : +o[k] || 0; if (L[k] !== v) { L[k] = v; dirty = true; } } return car; },
      update(dt) { tm += dt || 0; const n = (GT.env && GT.env.night) || 0, bl = (tm * 1.45) % 1 < .5, sir = L.siren > 0; if (!dirty && !sir && !(L.left || L.right || L.hazard) && abs(n - lastN) < .01) return; if (bl !== car.blinkOn) car.blinkOn = bl; dirty = false; lastN = n;
        const k = lerp(1, .5, n), il = (L.left || L.hazard) && bl ? 1 : 0, ir = (L.right || L.hazard) && bl ? 1 : 0, redI = S.rearAmber ? 0 : 1, hd = L.head, set = (c, r, g, b) => lv[c].set(r, g, b);
        set(CH.head, 62 * k * hd, 56 * k * hd, 44 * k * hd); set(CH.fl, hd * 1.6 + il * 26 * k, hd * 1.6 + il * 26 * k, hd * 1.6 + il * 22 * k); set(CH.fr, hd * 1.6 + ir * 26 * k, hd * 1.6 + ir * 26 * k, hd * 1.6 + ir * 22 * k);
        const rl = hd * 3.2 + (L.brake * 30 + il * redI * 30) * k, rr = hd * 3.2 + (L.brake * 30 + ir * redI * 30) * k; set(CH.rl, rl, rl * .35, rl * .35); set(CH.rr, rr, rr * .35, rr * .35);
        set(CH.rev, L.reverse * 16 * k, L.reverse * 16 * k, L.reverse * 15 * k); set(CH.stop, L.brake * 34 * k, L.brake * 10 * k, L.brake * 10 * k); set(CH.mark, hd * 3, hd * 3, hd * 3); set(CH.ral, il * 26 * k, il * 26 * k, il * 20 * k); set(CH.rar, ir * 26 * k, ir * 26 * k, ir * 20 * k); set(CH.white, hd * 6, hd * 6, hd * 6);
        let sr = 0, sb = 0; if (sir) { const p = (tm * 1.9) % 1, f = (sin(tm * 1.9 * TAU * 5) > -.2) ? 1 : .04; if (p < .5) sr = f; else sb = f; car.sirenPhase = p; }
        set(CH.sirR, sr * 90 * k, sr * 9 * k, sr * 7 * k); set(CH.sirB, sb * 14 * k, sb * 26 * k, sb * 110 * k);
        if (fxm) { const c = fxm.material.uniforms.uCol.value, hp = hd * (.004 + .075 * n); c[1].set(hp, hp * .86, hp * .62); const tp = (hd * .006 + L.brake * .035) * (.15 + .85 * n); c[2].set(tp, tp * .08, tp * .06); c[3].set(sr * (.01 + .1 * n), sr * .004, sr * .004); c[4].set(sb * .008, sb * .016, sb * (.012 + .12 * n)); } } };
    if (opts.lights) car.setLights(opts.lights); car.update(0); return car; }
  GT.vehicles = { make, kinds: Object.keys(DEFS), tris: kind => template(kind).tris, _tpl: template };

  /* ================================================================== showcases */
  function stage(scene, w, d) { const k = GT.kit(), g = new T.PlaneGeometry(w, d, 1, 1), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d); k.geo('asphalt_worn', g, { rx: -HP });
    for (let x = -w / 2 + 3; x < w / 2 - 2; x += 3.5) k.box('road_paint_white', .11, .004, 5.6, x + 1.75, .002, 0);
    k.box('concrete', w - 4, .15, .5, 0, .075, -4.2, { bevel: .02 }); k.box('concrete_stained', w - 4, .16, 3, 0, .08, -5.95, { bevel: .02 });
    k.decal('oil_stain', 1.4, 1.4, .3, .006, .9); k.decal('oil_stain', 1, 1, 3.7, .006, 1.4, 1); k.decal('crack', 3, 3, -2, .006, 4, .6); k.decal('tire_marks', 1.6, 5, -5.4, .006, 3.5, .2); k.decal('patch', 2.5, 2, 6, .006, 5, .1);
    const s = k.build({ cast: false }); scene.add(s); return s; }
  const Q = () => new URLSearchParams(location.search);
  const applyQ = (cars, q) => { const l = (q.get('lights') || '').split(',').filter(Boolean), o = {}; l.forEach(n => o[n] = 1); cars.forEach(c => { c.setLights(o); const st = q.get('steer'); if (st) c.steer.forEach(p => p.rotation.y = +st); }); };
  GT.showcase.vehicles = ({ scene, camera }) => { const q = Q(); stage(scene, 44, 30); const order = (q.get('kinds') || 'compact,sedan,hero,cruiser,pickup').split(',').filter(k => DEFS[k]), cars = [], cols = { compact: 0x2f5d74, sedan: 0x9aa1a6, pickup: 0xd7d3c8 };
    order.forEach((kind, i) => { const c = make(kind, { color: cols[kind], seed: i }); c.group.position.set((i - (order.length - 1) / 2) * 3.5, 0, kind === 'pickup' ? .3 : 0); c.group.rotation.y = 0; scene.add(c.group); cars.push(c); });
    applyQ(cars, q); if (!q.get('fov')) { camera.fov = 40; camera.updateProjectionMatrix(); } return { cam: [-9.5, 2.6, 12.5], look: [-.6, .5, 0], hours: 18.2, update(dt) { cars.forEach(c => c.update(dt)); } }; };
  GT.showcase.vehicles_hero = ({ scene, camera }) => { const q = Q(), kind = q.get('kind') || 'hero'; stage(scene, 44, 30); const c = make(DEFS[kind] ? kind : 'hero', { color: q.get('color') ? parseInt(q.get('color'), 16) : undefined, plate: 'SUN 0VR' }); c.group.rotation.y = +(q.get('h') || 0); scene.add(c.group); applyQ([c], q);
    const V = { front: [[-3.4, 1.25, 5.2], [0, .6, .3]], rear: [[-3.6, 1.35, -5.2], [0, .62, -.3]], side: [[-6.4, 1.1, 0], [0, .62, 0]], wheel: [[-2.1, .55, 2.5], [-.9, .36, 1.42]], lamp: [[-1.5, .75, 3.6], [-.62, .58, 2.3]], top: [[-2.5, 4.6, 3.2], [0, .6, .2]], tail: [[.9, .85, -3.9], [.3, .65, -2.3]] }[q.get('view') || 'front'];
    if (!q.get('fov')) { camera.fov = 32; camera.updateProjectionMatrix(); } return { cam: V[0], look: V[1], hours: 18.2, update(dt) { c.update(dt); } }; };
})();
