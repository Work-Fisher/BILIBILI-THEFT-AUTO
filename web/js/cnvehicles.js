/* cnvehicles.js — BILIBILI THEFT AUTO 1 (China edition) vehicles. Owner: cnvehicles agent.
   GT.cnvehicles = { make(kind, opts), kinds, tris(kind) }
   kinds: 'escooter' (the hero's 「跑得快」 delivery e-scooter), 'sharebike', 'trike' (electric cargo tricycle), 'taxi', 'police' (police patrol car), 'van' (面包车), 'sports', 'bus' (12 m, 521 路)
   make() -> { group, kind, dims:{L,W,H,wheelbase,track,wheelR,eye,seatH}, wheels:[...] (spin: rotation.x), steer:[...] (rotation.y),
               setLights({head,brake,reverse,left,right,hazard,siren,free,cabin}), update(dt), lights, meshes,
               seat (Object3D on the saddle / driver seat; seat.gripL, seat.gripR, seat.footL, seat.footR are Object3Ds), twoWheeler, lean(roll), setStand(bool) }
   Vehicle space: origin on the ground at the centre, +Z forward, +Y up, the vehicle's LEFT is +X (same as round-1 GT.vehicles).
   wheels: cars/bus [FL,FR,RL,RR]; escooter/sharebike [F,R]; trike [F,RL,RR].  steer: cars [FL,FR]; cycles [fork pivot] (rotation.y turns about the raked head tube).
   The lofting helpers (Grid / Builder / makeBody / makeGreenhouse / wheelGeo / paint + detail materials) are adapted from the round-1 js/vehicles.js, which is
   not loaded in the China edition. Every vehicle merges into: paint, detail (vertex-coloured PBR + lamp channels + one decal atlas), a few kit materials,
   wheels and one ground-fx mesh (contact shadow + light pools)  => 7–11 draw calls. Templates (geometry) are cached per kind. */
(function () {
  'use strict';
  if (!window.THREE || !window.GT) return;
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
  const WHITE_UV = [.625, .875], RC = {};
  function RES(ms) {
    if (typeof ms === 'string') return RC[ms] || (RC[ms] = { bag: ms, c: [1, 1, 1], a: [0, 0, 0] });
    if (ms._r) return ms._r;
    if (ms.paint !== undefined) return ms._r = { bag: 'paint', c: Array.isArray(ms.paint) ? ms.paint : lin(ms.paint), a: [ms.satin || 0, 0, 0] };
    return ms._r = { bag: 'detail', c: Array.isArray(ms.c) ? ms.c : lin(ms.c === undefined ? 0xffffff : ms.c), a: [ms.r === undefined ? .5 : ms.r, ms.m || 0, ms.ch || 0], uv: ms.tex ? null : WHITE_UV };
  }
  const CH = { head: 1, fl: 2, fr: 3, rl: 4, rr: 5, rev: 6, sirR: 7, sirB: 8, stop: 9, mark: 10, ral: 11, rar: 12, white: 13, scr: 14, taxi: 15, cabin: 16, led: 17, amb: 18, glow: 19, refl: 20 }, NCH = 21;   /* glow: owner-fitted light strips (colour set per vehicle, on at night); refl: retro-reflective tape, which only answers at night */
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
      if (o.seam) { const mp = pts[pts.length >> 1], qi = cl(Math.floor(mp[0]), 0, G.nu - 2), qj = cl(Math.floor(mp[1]), 0, G.nv - 2), mq = G.m ? G.m[qi * (G.nv - 1) + qj] : undefined, rs = RES(mq === undefined || mq === null ? (G.def || 'paint') : mq); if (rs.bag === 'paint') this.line(G, pts, .022, lift + .001, { paint: [rs.c[0] * .8, rs.c[1] * .8, rs.c[2] * .8] }, { cols: SEAMC, res: o.res }); lift += .0018; w = max(w, .006); }   /* the rolled edge takes the tint of the panel it lies on (black bonnet of a patrol car, livery blocks) */   /* CAR r1: a panel gap with depth: the paint rolls into it on both sides (a ribbon of paint whose normals turn toward the gap) and the black core sits on top */
      const N = sub.length, cols = o.cols || (o.h ? [[-.5, 0, -.75], [-.22, 1, -.2], [.22, 1, .2], [.5, 0, .75]] : [[-.5, 0, 0], [.5, 0, 0]]), nc = cols.length, P = [], Nn = [], U = [], I = [], h = o.h || 0;
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
  const SEAM = { seam: true }, SEAMP = { paint: [.8, .8, .8] }, SEAMC = [[-.5, 0, 0], [-.2, 0, .9], [-.05, 0, 1.6], [.05, 0, -1.6], [.2, 0, -.9], [.5, 0, 0]];
  const rect = (i0, i1, j0, j1) => (u, v) => [lerp(i0, i1, u), lerp(j0, j1, v)];
  /** sweep a profile [[out, y],...] along a plan path [[x,y,z,nx,nz,scale?],...] */
  function sweep(B, ms, path, prof, flip) { const G = new Grid(path.length, prof.length); path.forEach((p, i) => prof.forEach((q, j) => { const s = p[5] === undefined ? 1 : p[5]; G.set(i, j, p[0] + p[3] * q[0] * s, p[1] + q[1] * s, p[2] + p[4] * q[0] * s); })); G.flip = !!flip; G.def = ms; G.finish(); G.emit(B); return G; }
  /** bumper centre-line: straight across, round the corners, run back along the flanks. dir=+1 front, -1 rear */
  function bumperPath(zFace, xs, rc, side, y, dir, bow, Wn) { const h = []; for (let k = 0; k <= 8; k++) { const x = xs * k / 8; h.push([x, y, zFace - dir * bow * (x / Wn) * (x / Wn), 0, dir]); } const zc = zFace - dir * bow * (xs / Wn) * (xs / Wn) - dir * rc;
    for (let k = 1; k <= 7; k++) { const a = k / 7 * HP; h.push([xs + rc * sin(a), y, zc + dir * rc * cos(a), sin(a), dir * cos(a)]); } h.push([xs + rc, y, zc - dir * side * .6, 1, 0], [xs + rc - .012, y, zc - dir * side, 1, 0, .55]);
    const out = []; for (let k = h.length - 1; k > 0; k--) { const p = h[k]; out.push([-p[0], p[1], p[2], -p[3], p[4], p[5]]); } return out.concat(h); }
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
  function ghSnap(B) { const pre = {}; for (const bn in B.bags) pre[bn] = B.bags[bn].I.length; return pre; }
  function ghMark(B, pre, key) { const R = B[key || 'ghR'] || (B[key || 'ghR'] = {}); for (const bn in B.bags) { const i0 = pre[bn] || 0, i1 = B.bags[bn].I.length; if (i1 > i0) (R[bn] || (R[bn] = [])).push(i0, i1); } }
  function makeGreenhouse(B, S, bd) {
    const ghPre = ghSnap(B);   /* remember which index range of every bag is greenhouse (pillars, roof, glazing): the first-person cockpit hides exactly that and draws its own */
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
    ghMark(B, ghPre);
    return gh;
  }

  function sAtZ(g, z) { const kz = PL(g.keys); let a = 0, b = 1; for (let k = 0; k < 22; k++) { const m = (a + b) / 2; if (kz(m)[0] > z) a = m; else b = m; } return (a + b) / 2; }
  let WT = null;
  function wheelTex() { if (WT) return WT; const Wd = 1024, H = 512, mk = () => { const c = document.createElement('canvas'); c.width = Wd; c.height = H; return c; };
    const hc = mk(), h = hc.getContext('2d'), r = GT.rng('tyre');
    h.fillStyle = '#808080'; h.fillRect(0, 0, Wd, H); h.fillStyle = '#c8c8c8'; h.fillRect(0, 0, Wd, 256);
    h.strokeStyle = '#101010'; h.lineCap = 'butt';
    for (let b = 0; b < 8; b++) { const x = b * 128; h.lineWidth = 15; h.beginPath(); h.moveTo(x + 6, -4); h.lineTo(x + 46, 66); h.moveTo(x + 46, 190); h.lineTo(x + 6, 260); h.stroke();
      h.lineWidth = 7; h.beginPath(); h.moveTo(x + 70, 0); h.lineTo(x + 100, 52); h.moveTo(x + 100, 204); h.lineTo(x + 70, 256); h.moveTo(x + 20, 96); h.lineTo(x + 52, 122); h.moveTo(x + 84, 134); h.lineTo(x + 116, 160); h.moveTo(x + 84, 96); h.lineTo(x + 104, 112); h.moveTo(x + 24, 144); h.lineTo(x + 44, 160); h.stroke(); }
    h.fillStyle = '#9a9a9a'; h.fillRect(0, 262, Wd, 5); h.fillRect(0, 372, Wd, 6); h.fillStyle = '#909090'; for (let y = 272; y < 290; y += 4) h.fillRect(0, y, Wd, 1.5); h.fillStyle = '#8c8c8c'; h.fillRect(0, 352, Wd, 3);
    const text = g2 => { g2.textBaseline = 'middle'; g2.textAlign = 'center'; g2.font = "900 40px 'Arial Black','Helvetica Neue',Arial,sans-serif"; g2.fillText('JIANGCHI', 190, 322, 300); g2.font = "italic 900 30px 'Arial Black','Helvetica Neue',Arial,sans-serif"; g2.fillText('CITY RADIAL', 560, 322, 250); g2.font = "700 20px 'Helvetica Neue',Arial,sans-serif"; g2.fillText('195/65R15', 850, 312, 200); g2.fillText('TUBELESS  M+S', 850, 334, 190); };
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
  const ROTOR = { c: [.4, .39, .38], r: .3, m: 1 };
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
    /* CAR r1: behind the spokes a real brake rotor (a machined friction ring with a dark groove at its inner edge and a darker hat), set in front of the barrel's back wall; the caliper is part of the body (caliperGeo) so it does not spin */
    const rO = rr - .034, rI = max(w.hub + .05, rr * .45), xr = xc - .046;
    latheX(B, M.blkM, [[xc - .03, rr - .03], [xc - .07, rr - .034], [xc - .07, w.hub + .02]], seg);
    latheX(B, ROTOR, [[xr - .012, rO + .002], [xr - .003, rO], [xr, rO - .006], [xr, rI + .012]], seg); latheX(B, M.gap, [[xr, rI + .012], [xr - .002, rI + .006], [xr, rI]], seg);
    latheX(B, M.iron, [[xr, rI], [xr + .01, rI - .006], [xr + .012, w.hub + .02], [xr - .004, w.hub + .016]], seg);
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
  function detailMat(map, normalMap, o) { o = o || {};
    const m = new T.MeshStandardMaterial({ vertexColors: true, map: map || null, normalMap: normalMap || null, roughness: 1, metalness: 1, envMapIntensity: 1.1, alphaTest: o.alphaTest || 0 });
    if (o.offset) { m.polygonOffset = true; m.polygonOffsetFactor = -1.5; m.polygonOffsetUnits = -3; }
    const lv = []; for (let i = 0; i < NCH; i++) lv.push(new T.Vector3()); m.userData.gtLv = lv; const U = { value: lv };
    m.onBeforeCompile = sh => { sh.uniforms.gtLv = U;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aPar; uniform vec3 gtLv[' + NCH + ']; uniform vec3 gtMC; varying vec2 vGtRM; varying vec3 vGtEm; varying vec4 vGtMC;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vGtRM = aPar.xy; vGtEm = gtLv[int(aPar.z + 0.5)]; { float gSg = position.x < 0.0 ? -1.0 : 1.0; vGtMC = vec4((modelViewMatrix * vec4(gSg * gtMC.x, gtMC.y, gtMC.z, 1.0)).xyz, gSg); }');   /* vGtMC: the centre of this side's stalk-mirror glass in view space (+ which side), for the aimed mirror below */
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vGtRM; varying vec3 vGtEm;').replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vGtRM.x;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vGtRM.y;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vGtEm * diffuseColor.rgb;');
      /* mirror glass (roughness < .04, metal 1). On the vehicle the player rides or drives in first person it shows the REAL road behind: js/render.js draws one small rear view (448x188, every 2nd-4th frame)
         and each glass looks its own reflected ray up in it (gtRear), so the left and the right mirror show different things and a car closing in from behind is really there.
         Everywhere else (parked bikes, traffic, rays outside the rear view) it falls back to the painted view below: sky gradient + clouds + sun glow, a hazy skyline with lit windows at night, a tree line, the road. */
      sh.uniforms.gtRearTex = REAR.uniforms.gtRearTex; sh.uniforms.gtRearVP = REAR.uniforms.gtRearVP; sh.uniforms.gtRearK = REAR.uniforms.gtRearK;
      const E = GT.env || {}; sh.uniforms.gtMSky = { value: E.skyColor || new T.Color(.3, .45, .7) }; sh.uniforms.gtMHor = { value: E.horizonColor || new T.Color(.75, .7, .62) }; sh.uniforms.gtMSun = { value: E.sunDir || new T.Vector3(-.8, .3, .2).normalize() }; sh.uniforms.gtMSunC = { value: E.sunColor || new T.Color(1, .8, .55) }; sh.uniforms.gtMNight = MIRN; sh.uniforms.gtMBias = { value: o.mBias === undefined ? .2 : o.mBias }; sh.uniforms.gtMC = { value: o.mC ? new T.Vector3(o.mC[0], o.mC[1], o.mC[2]) : new T.Vector3() };   /* how far the mirror is tipped up toward the eye: a saddle sits higher above its mirrors than a car seat */
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 gtMSky; uniform vec3 gtMHor; uniform vec3 gtMSun; uniform vec3 gtMSunC; uniform float gtMNight; uniform float gtMBias; uniform vec3 gtMC; varying vec4 vGtMC;\n' + NOISE + REAR.glsl).replace('#include <tonemapping_fragment>', MIRROR_FS + '\n#include <tonemapping_fragment>'); };
    return m; }
  const MIRN = { value: 0 };
  const REAR = GT.render && GT.render.mirror && GT.render.mirror.glsl ? GT.render.mirror : { uniforms: { gtRearTex: { value: null }, gtRearVP: { value: new T.Matrix4() }, gtRearK: { value: 0 } }, glsl: 'uniform sampler2D gtRearTex; uniform mat4 gtRearVP; uniform float gtRearK;\nvec4 gtRear(vec3 d){ return vec4(0.0); }\n' };
  /* The glass is nearly flat and tilted toward the rider / driver, so the reflected ray is about level and each mirror looks its own way (left and right differ).
     What it shows is deliberately soft and low in contrast, as a small dusty mirror does: sky that takes the live horizon colour near the skyline, sun glow, a hazy skyline, a tree line, the road. */
  const MIRROR_FS = `if (vGtRM.x < .04 && vGtRM.y > .99) {
      vec3 gR = inverseTransformDirection(reflect(normalize(-vViewPosition), normal), viewMatrix); float gEl = gR.y + gtMBias, gAz = atan(gR.x, gR.z), gDay = 1. - gtMNight;
      vec3 gSunC = gtMSunC / max(max(gtMSunC.r, gtMSunC.g), max(gtMSunC.b, .001)); vec3 gAmb = gtMHor * .6 + gtMSky * .4;
      vec3 gSky = mix(gtMHor, gtMSky, smoothstep(.0, .4, gEl));
      float gCl = gtN(vec3(gAz * 2.2, gEl * 9., 1.7)) * .65 + gtN(vec3(gAz * 6., gEl * 24., 4.3)) * .35;
      gSky = mix(gSky, gtMHor * 1.12 + gSunC * .08 * gDay, smoothstep(.5, .8, gCl) * smoothstep(.04, .3, gEl) * .6);
      float gSd = max(dot(normalize(gR), gtMSun), 0.); gSky += gSunC * gtMHor * (pow(gSd, 5.) * .5 + pow(gSd, 90.) * 1.6) * gDay;
      /* skyline: wide soft-topped masses that fade into the haze, two depths */
      float gC = gAz * 5., gId = floor(gC), gF = fract(gC), gH1 = gtH(vec3(gId, 3., 7.)), gBh = (.025 + .13 * gH1 * gH1) * smoothstep(0., .12, gF) * smoothstep(1., .88, gF);
      float gC2 = gAz * 11. + 3.7, gI2 = floor(gC2), gF2 = fract(gC2), gB2 = (.02 + .07 * gtH(vec3(gI2, 5., 2.))) * smoothstep(0., .1, gF2) * smoothstep(1., .9, gF2);
      vec3 gHaze = mix(gtMHor, gAmb, .35); vec3 gFar = gHaze * vec3(.6, .62, .66), gNear = gHaze * vec3(.34, .36, .4);
      vec2 gW = vec2(gAz * 150., gEl * 150.); float gLit = step(.86, gtH(vec3(floor(gW), 7.))) * smoothstep(.5, .2, length(fract(gW) - .5));
      vec3 gWin = vec3(1., .74, .4) * gLit * gtMNight * .55;
      vec3 gCol = mix(gSky, gFar + gWin * .6, smoothstep(gBh + .012, gBh - .012, gEl));
      gCol = mix(gCol, gNear + gWin, smoothstep(gB2 + .008, gB2 - .008, gEl));
      float gTh = .012 + .045 * gtN(vec3(gAz * 14., 0., 2.)) + .012 * gtN(vec3(gAz * 47., 3., 2.));
      gCol = mix(gCol, vec3(.1, .15, .06) * gAmb * (.55 + .5 * gtN(vec3(gAz * 40., gEl * 40., 0.))), smoothstep(gTh + .008, gTh - .008, gEl) * .92);
      vec3 gG = mix(vec3(.03, .03, .033) * gAmb * (.85 + .3 * gtN(vec3(gAz * 5., gEl * 14., 5.))), gHaze * vec3(.075, .078, .085), exp(gEl * 12.) * .6);
      gCol = mix(gCol, gG, smoothstep(.006, -.006, gEl));
      vec3 gPro = gCol * vec3(.8, .84, .86) * mix(1., .3, gtMNight);   /* the painted stand-in stays under the night scene (it used to glow like daylight at 20:00) */
      vec4 gRv;
      if (gtMC.x > 0. && gtRearK > .01 && dot(vGtMC.xyz, vGtMC.xyz) < 2.6) {
        /* the rider's own stalk mirrors: an AIMED, gently convex glass. Its normal is whatever sends the ray from the eye through the glass centre straight back along the bike (8 degrees outward, 2 down),
           as a rider sets a mirror, so the whole glass lies inside the rear view whatever the head does. The modelled glass sits square to the bars: with its own normal half of it looked past the rear view (painted patch + slanted seam). */
        vec3 gMf = vec3(gtRearVP[0][3], gtRearVP[1][3], gtRearVP[2][3]), gMx = normalize(vec3(gtRearVP[0][0], gtRearVP[1][0], gtRearVP[2][0])), gMy = normalize(vec3(gtRearVP[0][1], gtRearVP[1][1], gtRearVP[2][1]));
        vec3 gMd = normalize((viewMatrix * vec4(gMf + gMx * (.14 * vGtMC.w) - gMy * .03, 0.)).xyz);
        vec3 gMn = normalize(gMd - normalize(vGtMC.xyz)); vec3 gMo = -vViewPosition - vGtMC.xyz; gMo -= gMn * dot(gMo, gMn);
        gRv = gtRear(inverseTransformDirection(reflect(normalize(-vViewPosition), normalize(gMn + gMo * 2.2)), viewMatrix));
      } else gRv = gtRear(normalize(vec3(gR.x, gR.y + gtMBias, gR.z)));   /* everything else: the same tip-up as the painted view */
      vec3 gRc = gRv.rgb * vec3(.84, .88, .9); { float gRl = dot(gRc, vec3(.3, .55, .15)); gRc = mix(gRc, mix(vec3(gRl), gRc, .7) * .9 + vec3(.008, .013, .016), gtMNight); }   /* at night a small dusty mirror is a dim, half-grey picture with a few lamps in it: it used to be the brightest and greenest thing on the bars */
      gl_FragColor.rgb = mix(gPro, gRc, gRv.a) + gl_FragColor.rgb * mix(.06, .02, gtMNight);
    }`;
  const NOISE = 'float gtH(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\nfloat gtN(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f); return mix(mix(mix(gtH(i), gtH(i+vec3(1,0,0)), f.x), mix(gtH(i+vec3(0,1,0)), gtH(i+vec3(1,1,0)), f.x), f.y), mix(mix(gtH(i+vec3(0,0,1)), gtH(i+vec3(1,0,1)), f.x), mix(gtH(i+vec3(0,1,1)), gtH(i+vec3(1,1,1)), f.x), f.y), f.z); }\n';
  const PM = {};
  /** car paint: GT.mat('car_paint') textures + vertex tint (liveries / satin panels) + road dust on the lower body + stone chips on the nose */
  /* CAR r1: what the base coat is under the lacquer. Solid colours were a 55 % metallic base, which greys every colour (the diffuse part is cut in half and the rest mirrors a warm sky):
     a white car read khaki, a red one brick. Now: solid whites / blacks / brights are a dielectric base (metal .04-.15), mid greys are silver metallic, deep saturated shades a pearl metallic. */
  function paintSpec(hex, metal) { const c = new T.Color(hex), h = {}; c.getHSL(h); if (metal !== undefined) return { m: metal, r: .3 };
    if (h.s < .14 && h.l > .3 && h.l < .8) return { m: .62, r: .3 }; if (h.l >= .8) return { m: .04, r: .28 }; if (h.l < .11) return { m: .16, r: .24 }; if (h.s > .3 && h.l < .42) return { m: .2, r: .3 }; return { m: .1, r: .3 }; }
  function paintMat(hex, dust, metal) { const key = hex + '|' + dust.join(',') + '|' + metal; if (PM[key]) return PM[key]; const ps = paintSpec(hex, metal), b = GT.carPaint ? GT.carPaint(hex, { metal: ps.m, rough: ps.r, coat: .028 }) : GT.mat('car_paint', { color: hex, rough: ps.r, metal: ps.m }), phys = b.clearcoat !== undefined;   /* GT.carPaint: the LT line's probe-ready paint (js/materials.js) */
    const m = new T.MeshPhysicalMaterial({ color: b.color.clone(), map: null, roughness: b.roughness, metalness: b.metalness, roughnessMap: b.roughnessMap || null, normalMap: b.normalMap || null, clearcoat: phys ? b.clearcoat : 1, clearcoatRoughness: phys ? min(b.clearcoatRoughness, .03) : .03, clearcoatNormalMap: phys ? b.clearcoatNormalMap : null, envMapIntensity: 1, vertexColors: true });   /* no albedo grain map: it took a quarter off every colour; the flakes stay in the normal map */
    m.userData.gtProbeK = 1; m.name = 'cnv_paint_' + hex;   /* js/render.js hangs the local reflection probe on it (clearcoat > 0): the street, palms and sky in the lacquer */
    if (b.normalMap) m.normalScale.copy(b.normalScale).multiplyScalar(ps.m > .3 ? .6 : .3); if (phys && b.clearcoatNormalMap) m.clearcoatNormalScale.copy(b.clearcoatNormalScale).multiplyScalar(.6);
    dust = dust.slice(); dust[2] *= .45;   /* cleaner cars: the road dust on the sills was a brown-yellow cast over the whole lower body */
    const U = { value: new T.Vector4(dust[0], dust[1], dust[2], dust[3]) }, U2 = { value: new T.Vector4(dust[4] || 9, dust[5] || -9, dust[6] || .4, 0) }; m.userData.gtDust = U; const prev = b.userData && b.userData.gtMacro ? b.onBeforeCompile : null;
    m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); sh.uniforms.gtDust = U; sh.uniforms.gtAx = U2;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aPar; varying vec3 vGtP; varying float vGtS;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vGtP = position; vGtS = aPar.x;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGtP; varying float vGtS; uniform vec4 gtDust; uniform vec4 gtAx;\n' + NOISE)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n float gtNz = gtN(vGtP * 6.) * .5 + gtN(vGtP * 19.) * .3 + gtN(vGtP * 57.) * .2;\n float gtD = clamp(smoothstep(gtDust.y, gtDust.x, vGtP.y) * (.2 + 1.25 * gtNz) * gtDust.z, 0., 1.);\n gtD = max(gtD, gtDust.z * .07 * smoothstep(.45, .75, gtNz));\n vec2 gtWb = vec2(gtAx.x, gtAx.y) - gtAx.z - vGtP.z; vec2 gtSp = (1. - smoothstep(vec2(0.), vec2(.6), gtWb)) * step(vec2(-.02), gtWb);\n gtD = clamp(gtD + max(gtSp.x, gtSp.y) * smoothstep(gtAx.z * 2.1, gtAx.z * .7, vGtP.y) * (.25 + gtNz) * gtDust.z * 1.5, 0., 1.);\n' +
          ' float gtC = step(.9955, gtH(floor(vGtP * 260.))) * smoothstep(gtDust.w - .7, gtDust.w - .1, vGtP.z) * step(vGtP.y, .95) * (1. - vGtS);\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.2, .172, .135), gtD * .78);\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.08, .075, .07), gtC * .8);\n' +
          ' roughnessFactor = mix(mix(roughnessFactor, .55, vGtS), .93, gtD);')
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef CLEARCOAT\n material.clearcoat *= (1. - gtD) * (1. - vGtS * .93) * (1. - gtC);\n#endif')
        /* a bonnet seen from the driver's seat is at a grazing angle, where the lacquer mirrors the whole dusk sky and the red paint turns pink-white: fade the mirror term out toward grazing so the paint colour survives */
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n { float gtGz = 1. - abs(dot(geometry.normal, geometry.viewDir)); float gtGk = mix(1., .55, smoothstep(.6, .97, gtGz)); reflectedLight.directSpecular *= gtGk; reflectedLight.indirectSpecular *= gtGk; }'); };
    return PM[key] = m; }
  const FX_VS = 'attribute vec3 aFx; varying vec3 vFx; varying vec2 vFxW; void main(){ vFx = aFx; vFxW = (modelMatrix * vec4(position, 1.)).xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }';
  const FX_FS = 'uniform vec3 uCol[5]; uniform vec3 uBox; varying vec3 vFx; varying vec2 vFxW;\nfloat fxH(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }\nfloat fxN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(fxH(i), fxH(i + vec2(1., 0.)), f.x), mix(fxH(i + vec2(0., 1.)), fxH(i + vec2(1., 1.)), f.x), f.y); }\nvoid main(){ vec4 o;\n if (vFx.z < .5) { vec2 q = abs(vFx.xy) - uBox.xy + .28; float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - .28; o = vec4(0., 0., 0., uBox.z * pow(1. - smoothstep(-.55, .95, d), 1.6) ); }\n' +
    ' else if (vFx.z < 1.5) { float t = clamp(vFx.y * .5 + .5, 0., 1.), u = vFx.x; float f = pow(max(1. - u * u, 0.), 3.4) * smoothstep(0., .1, t) * pow(1. - t, 3.3); f += .8 * pow(max(1. - u * u * 5., 0.), 2.) * smoothstep(0., .06, t) * pow(1. - t, 6.);   /* 月湾 r2: t is clamped: just past the far edge of the pool pow() of a negative base gave NaN, and every parked car drew a black dashed line across the road 19 m ahead of it */ f *= .5 + .62 * fxN(vFxW * 23.) + .38 * fxN(vFxW * 5.3 + 7.); o = vec4(uCol[1] * f, 0.); }   /* a tighter pool that falls off sooner and carries the grain of the tarmac it lies on (it was a flat milky sheet 10 m wide that hid the road texture and the wet reflections) */\n' +
    ' else if (vFx.z > 4.5) { vec2 q = abs(vFx.xy) - uBox.xy + .12; float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.); float f = pow(1. - smoothstep(-.3, 1.25, d), 2.2) * (.5 + .55 * fxN(vFxW * 17.) + .3 * fxN(vFxW * 4.1 + 3.)); o = vec4(uCol[0] * f, 0.); }   /* underglow: a pool of the strip colour that hugs the outline of the vehicle and dies a metre out */\n' +
    ' else { float f = pow(max(1. - length(vFx.xy), 0.), 2.2); o = vec4((vFx.z < 2.5 ? uCol[2] : vFx.z < 3.5 ? uCol[3] : uCol[4]) * f, 0.); }\n gl_FragColor = o;\n #include <tonemapping_fragment>\n #include <encodings_fragment>\n}';
  function fxMat(L, W) { const cols = []; for (let i = 0; i < 5; i++) cols.push(new T.Vector3());
    return new T.ShaderMaterial({ uniforms: { uCol: { value: cols }, uBox: { value: new T.Vector3(W / 2 - .02, L / 2 - .04, .8) } }, vertexShader: FX_VS, fragmentShader: FX_FS, transparent: true, depthWrite: false, blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); }
  function fxGeo(L, W, cop) { const P = [], A = [], I = []; const quad = (x0, z0, x1, z1, y, mode, wFar, nx, nz) => { nx = nx || 1; nz = nz || 1; const o = P.length / 3; for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const u = i / nx * 2 - 1, v = j / nz * 2 - 1, t = j / nz, hw = wFar ? lerp((x1 - x0) / 2, wFar, t) : (x1 - x0) / 2; P.push((x0 + x1) / 2 + u * hw, y, lerp(z0, z1, t)); if (mode === 0 || mode === 5) A.push((x0 + x1) / 2 + u * hw, lerp(z0, z1, t), mode); else A.push(u, v, mode); }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = o + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; I.push(a, c, b, b, c, d); } };
    quad(-W / 2 - 1.2, -L / 2 - 1.2, W / 2 + 1.2, L / 2 + 1.2, .012, 0); quad(-1.1, L / 2 + .25, 1.1, L / 2 + 19, .02, 1, 5, 8, 10); quad(-2.2, -L / 2 - 4.2, 2.2, -L / 2 + .5, .018, 2);
    if (cop) { quad(.2, -5, 9.2, 5, .016, 3); quad(-9.2, -5, -.2, 5, .016, 4); }
    quad(-W / 2 - 1.5, -L / 2 - 1.4, W / 2 + 1.5, L / 2 + 1.4, .015, 5);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('aFx', new T.BufferAttribute(new Float32Array(A), 3)); g.setIndex(I); g.computeBoundingSphere(); return g; }
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
    B.box(M.vinyl, w * 2, .2, .34, 0, I.dash - .1, I.z1 - .15, { bevel: .03 }); const dX = I.single ? 0 : .36; B.box(M.vinyl, .34, .07, .12, dX, I.dash + .025, I.z1 - .27, { bevel: .025 });                       // dash + binnacle
    B.add(M.blkS, new T.TorusGeometry(I.single ? .17 : .185, I.single ? .011 : .014, 8, 28), { x: dX, y: I.dash - .02, z: I.z1 - .43, rx: .42 }); B.cyl(M.dkm, .02, .024, .3, dX, I.dash - .07, I.z1 - .3, { rx: HP + .42, seg: 8 });
    B.box(M.dkm, .035, .012, .2, dX, I.dash - .02, I.z1 - .43, { rx: .42, bevel: .004 }); if (!I.single) B.box(M.vinyl, .2, .16, (I.z1 - I.z0) * .5, 0, I.floor + .08, lerp(I.z0, I.z1, .6), { bevel: .02 });               // spokes, tunnel/console
    for (const sx of I.single ? [0] : [-1, 1]) { const x = sx * .37, z = I.seatZ; B.box(sc, .5, .14, .5, x, I.floor + .15, z, { bevel: .045 }); B.box(sc, .5, .52, .12, x, I.floor + .44, z - .29, { rx: -.26, bevel: .05 }); B.box(sc, .25, .15, .085, x, I.floor + .76, z - .385, { rx: -.2, bevel: .035 }); }
    if (I.rearZ !== undefined) { let rw = w * 1.9; for (const a of S.arches) if (abs(I.rearZ - .2 - a.z) < a.R + .3) rw = min(rw, 2 * S.xi - .06); B.box(sc, rw, .15, .46, 0, I.floor + .16, I.rearZ, { bevel: .045 }); B.box(sc, rw, .46, .12, 0, I.floor + .42, I.rearZ - .27, { rx: -.3, bevel: .05 }); }
    if (I.shelf) B.box(M.vinyl, w * 2, .03, I.shelf[1] - I.shelf[0], 0, I.shelfY, (I.shelf[0] + I.shelf[1]) / 2); }
  function underbody(B, S) { const U = S.under; if (!U) return; const y = U.y;
    for (const sx of [-1, 1]) { B.tube(M.iron, [[sx * .3, y, U.exh[0]], [sx * .34, y - .01, lerp(U.exh[0], U.exh[1], .4)], [sx * .42, y + .01, lerp(U.exh[0], U.exh[1], .75)], [sx * U.tipX, U.tipY, U.exh[1]]], .026, { seg: 7 }); B.box(M.iron, .2, .1, .5, sx * .36, y, lerp(U.exh[0], U.exh[1], .55), { bevel: .04 }); }
    B.cyl(M.dkm, .04, .04, 1.3, 0, U.axleY, U.axle, { rz: HP, seg: 10 }); B.sph(M.dkm, .11, 0, U.axleY, U.axle, { s: [1, 1, 1.15] }); B.cyl(M.dkm, .032, .032, abs(U.axle - .2), 0, U.axleY + .02, (U.axle + .2) / 2, { rx: HP, seg: 8 });
    if (U.tank) B.box(M.dkm, 1.0, .16, U.tank[1] - U.tank[0], 0, U.tankY, (U.tank[0] + U.tank[1]) / 2, { bevel: .04 });
    B.box(M.dkm, 1.2, .08, .16, 0, U.axleY - .02, U.front, { bevel: .02 }); B.box(M.dkm, .5, .16, .5, 0, y + .03, U.front - .3, { bevel: .05 }); }
  const subQ = (c, u0, v0, u1, v1) => { const P = (u, v) => [lerp(lerp(c[0][0], c[1][0], u), lerp(c[3][0], c[2][0], u), v), lerp(lerp(c[0][1], c[1][1], u), lerp(c[3][1], c[2][1], u), v)]; return [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)]; };
  const mirQ = (c, sg) => c.map(p => [p[0] * sg, p[1]]);
  function frame(B, C, x0, y0, x1, y1, w, ms, h) { const a = C.ij(x0, y0), b = C.ij(x1, y0), c = C.ij(x1, y1), d = C.ij(x0, y1), o = { h: h || .003 }; B.line(C, [a, b], w, .002, ms, o); B.line(C, [b, c], w, .002, ms, o); B.line(C, [c, d], w, .002, ms, o); B.line(C, [d, a], w, .002, ms, o); }
  function capRect(B, C, x0, y0, x1, y1, lift, ms, o) { o = o || {}; return B.patch(C, C.map(x0, y0, x1, y1), o.nu || max(2, ceil(abs(x1 - x0) / .05)), o.nv || max(2, ceil(abs(y1 - y0) / .03)), lift, ms, o); }
  function capQuad(B, C, c, lift, ms, o) { o = o || {}; return B.patch(C, C.quad(c), o.nu || 7, o.nv || 3, lift, ms, o); }
  /** shut-lines, handles, mirrors, window trim for a 2 or 4 door body. D.doors = [front edge, B, rear edge(z at belt)] */
  function flanks(B, S, bd, gh) { const D = S.d, G = bd.G, gi = bd.gi, dz = D.doors, GG = gh.G, sI = gh.si, trim = D.trim || M.blkS, yT = z => bd.prm(z).ySh;
    B.sym(sg => { B.line(G, [[gi(dz[0]), bd.JR + .5], [gi(dz[0]), bd.JH + 1.2]], .0055, .0006, M.gap, SEAM); if (dz[1] !== null) B.line(G, [[gi(dz[1]), bd.JR + .5], [gi(dz[1]), bd.JH + 1.2]], .0055, .0006, M.gap, SEAM);
      const zc = dz[2], yk = D.kick || .7; B.line(G, [[gi(zc), bd.JH + 1.2], [gi(zc), bd.gjS(zc, yk)], [gi(zc + (D.kickZ || .12)), bd.gjS(zc + (D.kickZ || .12), D.sillY)]], .0055, .0006, M.gap, SEAM); B.line(G, bd.sLine(zc + (D.kickZ || .12), dz[0], D.sillY), .005, .0006, M.gap, SEAM);
      for (const hz of D.handles) { const hy = D.handleY, x = bd.sx(hz, hy); B.box(D.handleMs || 'paint', .022, .028, .17, x + .006, hy, hz, { bevel: .009 }); B.box(M.gap, .012, .034, .11, x + .001, hy - .012, hz + .01, { bevel: .004 }); }
      const mz = D.mirror[0], my = bd.ty(mz, bd.prm(mz).xE) + D.mirror[1], mx = bd.sx(mz, yT(mz) - .02); B.box(M.blkS, .1, .03, .06, mx + .02, my - .05, mz, { bevel: .01 }); B.box(D.mirrorMs || 'paint', .11 * (D.mirrorS || 1), .12 * (D.mirrorS || 1), .15, mx + .1, my, mz + .01, { bevel: .035 }); B.box(M.mirror, .09 * (D.mirrorS || 1), .095 * (D.mirrorS || 1), .006, mx + .1, my, mz - .066, { bevel: .002, ry: .16 });   /* turned toward the driver */
      const ghPre = ghSnap(B); B.line(GG, [[sI(.985), 1], [sI(.015), 1]], .016, .0012, trim, { h: .004 });
      for (const w of S.gh.win) { const a = sI(w[1]), b = sI(w[0]); B.line(GG, [[a, gh.nSd - 1], [b, gh.nSd - 1]], .012, .001, trim, { h: .003 }); B.line(GG, [[a, 1], [a, gh.nSd - 1]], .014, .001, M.blkS, { h: .003 }); B.line(GG, [[b, 1], [b, gh.nSd - 1]], .014, .001, M.blkS, { h: .003 }); } ghMark(B, ghPre);   /* window trim rides on the greenhouse: it is hidden with it in the first-person view */
      if (D.marker) B.patch(G, bd.sMap(D.marker[0], D.marker[0] - .09, D.marker[1], D.marker[1] + .03), 3, 2, .002, lens('amber', CH.mark), { bulge: .002 });
      if (D.bumpF) B.line(G, [[gi(D.bumpF), bd.gjS(D.bumpF, D.sillY)], [gi(D.bumpF + .06), bd.gjS(D.bumpF + .06, yT(D.bumpF) - .06)]], .005, .0006, M.gap, SEAM); if (D.bumpR) B.line(G, [[gi(D.bumpR), bd.gjS(D.bumpR, D.sillY + .08)], [gi(D.bumpR - .05), bd.gjS(D.bumpR - .05, yT(D.bumpR) - .1)]], .005, .0006, M.gap, SEAM);
      if (D.hood) { const h = D.hood; B.line(G, bd.tLine(h[1], h[2], h[0]), .005, .0006, M.gap, SEAM); B.line(G, [[gi(h[2]), bd.gjT(h[2], h[0])], [gi(h[2]), bd.JT]], .005, .0006, M.gap, SEAM); B.patch(G, bd.tMap(h[1] - .09, h[1] - .005, h[0] + .04, 0), 3, 12, .0012, M.blkM, { skirt: 0 }); }
      if (D.trunk) { const h = D.trunk; B.line(G, bd.tLine(h[1], h[2], h[0]), .005, .0006, M.gap, SEAM); } });
    const WS = gh.capF, nk = WS.nk, wip = (k0, k1) => { const a = WS.at(1.05, k0), b = WS.at(2.0, k1), o = .014; B.tube(M.blkS, [[a[0] + a[3] * o, a[1] + a[4] * o, a[2] + a[5] * o], [b[0] + b[3] * o, b[1] + b[4] * o, b[2] + b[5] * o]], .005, { seg: 5, steps: 2 });
      const c = WS.at(2.9, k1 + 1.3), d = WS.at(1.25, k1 - 3.2); B.tube(M.rubber, [[c[0] + c[3] * .008, c[1] + c[4] * .008, c[2] + c[5] * .008], [b[0] + b[3] * .01, b[1] + b[4] * .01, b[2] + b[5] * .01], [d[0] + d[3] * .008, d[1] + d[4] * .008, d[2] + d[5] * .008]], .006, { seg: 5, steps: 6 }); };
    wip(nk * .2, nk * .42); wip(nk * .58, nk * .8); }
  /** modern front/rear fascias drawn as raised patches on the end caps. Returns {F, R} */
  function fascias(B, S, bd, capMs) { const D = S.d, F = bd.cap(1, 28, capMs ? () => capMs : null), R = bd.cap(-1, 28, capMs ? () => capMs : null), g = D.grille, it = D.intake;
    capRect(B, F, -g.x, g.y0, g.x, g.y1, .002, M.gap, { skirt: .003 }); const nb = g.bars || 4; for (let k = 1; k < nb; k++) { const y = lerp(g.y0, g.y1, k / nb); B.line(F, [F.ij(-g.x + .012, y), F.ij(g.x - .012, y)], g.barW || .012, .004, g.barMs || M.blkS, { h: .004 }); }
    frame(B, F, -g.x, g.y0, g.x, g.y1, g.frameW || .012, g.chrome ? 'chrome' : M.blkS, .005); if (g.badge) { const yb = (g.y0 + g.y1) / 2; capRect(B, F, -.045, yb - .03, .045, yb + .03, .007, 'chrome', { nu: 3, nv: 3, bulge: .004 }); }
    if (it) { capRect(B, F, -it.x, it.y0, it.x, it.y1, .0015, M.blkM, { skirt: .003 }); for (let k = 1; k < 3; k++) { const y = lerp(it.y0, it.y1, k / 3); B.line(F, [F.ij(-it.x + .02, y), F.ij(it.x - .02, y)], .01, .003, M.blkS, { h: .003 }); } }
    const edge = (C, q) => { for (let k = 0; k < 4; k++) B.line(C, [C.ij(q[k][0], q[k][1]), C.ij(q[(k + 1) % 4][0], q[(k + 1) % 4][1])], .009, .0012, M.gap); };
    /* CAR r1 lamp optics: every projector gets a chrome bezel and a convex lens over its reflector bowl (a bright point of light to catch the sun), a thin LED running-light strip
       along the foot of each headlamp, and the tail lamps get dark ribs between their segments, so the cluster reads as optics behind a lens and not as a flat coloured patch */
    const qc = q => [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4], qp = (q, u, v) => [lerp(lerp(q[0][0], q[1][0], u), lerp(q[3][0], q[2][0], u), v), lerp(lerp(q[0][1], q[1][1], u), lerp(q[3][1], q[2][1], u), v)];
    const eye = (C, x, y, r, ch, lift) => { const q = C.at.apply(C, C.ij(x, y)); B.push(q[0] + q[3] * lift, q[1] + q[4] * lift, q[2] + q[5] * lift, { ry: Math.atan2(q[3], q[5]), rx: -Math.asin(cl(q[4], -1, 1)) });
      B.lathe(M.chr, [[r * 1.32, -.002], [r * 1.3, .004], [r * 1.12, .007], [r * 1.02, .004]], { seg: 20, rx: HP }); B.lathe(lens('white', ch), [[r, .003], [r * .86, .008], [r * .55, .0125], [0, .014]], { seg: 20, rx: HP }); B.pop(); };
    for (const sg of [1, -1]) { const hq = mirQ(D.head, sg); edge(F, hq); capQuad(B, F, hq, .003, lens('smoke', 0), { bulge: .005 }); for (const u of D.proj || [[.12, .48], [.52, .82]]) { const pq = subQ(hq, u[0], .2, u[1], .8), c = qc(pq), hgt = abs(pq[3][1] - pq[0][1]), wid = abs(pq[1][0] - pq[0][0]); capQuad(B, F, pq, .0065, lens('bowl', CH.head), { nu: 4, nv: 3, bulge: .003, skirt: .002 }); if (!D.noEyes) eye(F, c[0], c[1], min(hgt, wid) * .34, CH.head, .006); }
      if (!D.noEyes) { const a = qp(hq, .05, .1), b = qp(hq, .8, .1); B.line(F, [F.ij(a[0], a[1]), F.ij(b[0], b[1])], .007, .0075, lens('white', CH.white), { h: .003 }); }
      capQuad(B, F, subQ(hq, .86, .12, .98, .88), .0065, lens('amber', sg > 0 ? CH.fl : CH.fr), { nu: 2, nv: 3, skirt: .002 });
      if (D.fog) { const f = D.fog; capRect(B, F, sg * (f[0] - f[2]), f[1] - f[3], sg * (f[0] + f[2]), f[1] + f[3], .002, M.gap, { nu: 3, nv: 2 }); capRect(B, F, sg * (f[0] - f[2] * .6), f[1] - f[3] * .6, sg * (f[0] + f[2] * .6), f[1] + f[3] * .6, .005, lens('white', CH.white), { nu: 2, nv: 2, bulge: .003, skirt: .002 }); }
      const tq = mirQ(D.tail, sg), tc = sg > 0 ? CH.rl : CH.rr; edge(R, tq); capQuad(B, R, tq, .003, lens('redDk', tc), { bulge: .005 }); for (const v of D.tailSeg || [[.36, .14, .97, .44], [.36, .56, .97, .86]]) capQuad(B, R, subQ(tq, v[0], v[1], v[2], v[3]), .0075, lens('red', tc), { nu: 5, nv: 2, skirt: .0025, bulge: .002 }); for (const v of D.tailSeg || [[.36, .14, .97, .44], [.36, .56, .97, .86]]) for (const f of [.34, .67]) { const a = qp(tq, v[0] + .02, lerp(v[1], v[3], f)), b = qp(tq, v[2] - .02, lerp(v[1], v[3], f)); B.line(R, [R.ij(a[0], a[1]), R.ij(b[0], b[1])], .0035, .0098, lens('redDk', 0), { h: .0015 }); } if (D.rev) capQuad(B, R, subQ(tq, D.rev[0], D.rev[1], D.rev[2], D.rev[3]), .0055, lens('white', CH.rev), { nu: 3, nv: 2, skirt: .002 });
      if (D.refl) capRect(B, R, sg * (D.refl[0] - .05), D.refl[1] - .011, sg * (D.refl[0] + .05), D.refl[1] + .011, .002, lens('redDk', CH.mark), { nu: 3, nv: 2 }); }
    { const nu = bd.G.nu, n = (S.nL || 6) + (D.wrap || 3), G = bd.G, hy = D.head, ty = D.tail, zf = S.zF - .12, zr = S.zR + .12;
      B.sym(sg => { B.patch(G, rect(nu - 1, nu - 1 - n, bd.gjS(zf, hy[1][1]), bd.gjS(zf, hy[2][1])), n, 3, .003, lens('smoke', 0), { bulge: .002 }); B.patch(G, rect(nu - 2, nu - 1 - n * .6, bd.gjS(zf, lerp(hy[1][1], hy[2][1], .15)), bd.gjS(zf, lerp(hy[1][1], hy[2][1], .85))), 4, 2, .0062, lens('amber', sg > 0 ? CH.fl : CH.fr), { skirt: .002 });
        B.patch(G, rect(0, n, bd.gjS(zr, ty[1][1]), bd.gjS(zr, ty[2][1])), n, 3, .003, lens('redDk', sg > 0 ? CH.rl : CH.rr), { bulge: .002 }); B.patch(G, rect(1, n * .8, bd.gjS(zr, lerp(ty[1][1], ty[2][1], .25)), bd.gjS(zr, lerp(ty[1][1], ty[2][1], .75))), n, 2, .0062, lens('red', sg > 0 ? CH.rl : CH.rr), { skirt: .002 }); }); }
    const p = D.plate; if (p > 0) capRect(B, R, .245, p - .088, -.245, p + .088, .0012, M.blkM, { nu: 4, nv: 3, skirt: .002 }); if (p > 0) capRect(B, R, .22, p - .07, -.22, p + .07, .004, M.plate, { nu: 4, nv: 3, uv: uvOf('plate'), skirt: .002 });
    if (D.valance) { const v = D.valance; capRect(B, R, v.x, v.y0, -v.x, v.y1, .0015, M.blkM, { skirt: .003 }); if (v.tip) { const q = R.at.apply(R, R.ij(v.tip, (v.y0 + v.y1) / 2 - .01)); B.cyl('chrome', .034, .034, .1, q[0], q[1], q[2] + .02, { rx: HP, seg: 14, open: true }); B.cyl(M.gap, .03, .03, .09, q[0], q[1], q[2] + .025, { rx: HP, seg: 10 }); } }
    if (D.lid) { const l = D.lid; B.line(R, [R.ij(l.x, l.y1), R.ij(l.x, l.y0), R.ij(-l.x, l.y0), R.ij(-l.x, l.y1)], .005, .0008, M.gap, SEAM); }
    if (D.badge) { const b = D.badge; capRect(B, R, b[0], b[1], b[0] - b[2], b[1] + b[3], .0015, M.decalChr, { nu: 5, nv: 2, uv: uvOf('B'), skirt: 0 }); }
    if (D.badge2) { const b = D.badge2; capRect(B, R, b[0], b[1], b[0] - b[2], b[1] + b[3], .0015, M.decalChr, { nu: 3, nv: 2, uv: uvOf('C'), skirt: 0 }); }
    return { F, R }; }

  /* ================================================================== CHINA EDITION: decal atlases (one canvas per vehicle; all text is original and Chinese) */
  const CJK = "'PingFang SC','Hiragino Sans GB','Heiti SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif", LAT = "'DIN Alternate','DIN Condensed','Helvetica Neue','Arial',sans-serif";
  const LAYS = {
    car: { W: 1024, H: 1024, s: { plate: [0, 0, 512, 160], B: [0, 168, 512, 88], C: [768, 0, 256, 128], F: [768, 128, 256, 128], A: [0, 256, 256, 256], D: [256, 256, 768, 128], E: [256, 384, 768, 128], G: [0, 512, 1024, 128], H: [0, 640, 512, 128], I: [512, 640, 512, 128], J: [0, 768, 512, 256], K: [512, 768, 512, 256], L: [512, 196, 256, 60] } },   /* L: the strip left free under the white patch (taxi: the roof box's rear advert screen; patrol car: the slanted flank band) */
    bus: { W: 2048, H: 1024, s: { plate: [0, 0, 512, 160], ledR: [512, 0, 256, 128], B: [768, 0, 256, 64], C: [768, 64, 256, 64], led: [1536, 0, 512, 128], ledS: [1536, 128, 512, 96], adA: [0, 256, 2048, 300], adB: [0, 560, 1024, 260], logo: [1024, 560, 512, 128], ev: [1024, 688, 512, 128], misc: [1536, 560, 512, 256], K: [0, 824, 1024, 200], dash: [1024, 824, 512, 200] } },
    escooter: { W: 1024, H: 1024, s: { chk: [512, 196, 256, 60], unit: [512, 0, 256, 64], plate: [0, 0, 256, 160], brand: [256, 0, 256, 96], spd: [256, 96, 256, 160], nav: [768, 0, 256, 512], boxB: [0, 256, 512, 512], scuff: [512, 256, 256, 256], boxS: [512, 512, 512, 512], lid: [0, 768, 256, 256], stick: [256, 768, 256, 256] } },
    sharebike: { W: 1024, H: 1024, s: { plate: [0, 0, 256, 160], brand: [0, 256, 512, 128], qr: [0, 384, 256, 256], panel: [256, 384, 256, 256], ad: [0, 640, 512, 256], scuff: [512, 256, 256, 256], lock: [768, 0, 256, 128] } },
    trike: { W: 1024, H: 1024, s: { plate: [0, 0, 256, 160], side: [0, 256, 768, 160], tail: [0, 416, 768, 128], cardT: [0, 544, 512, 480], cardS: [512, 544, 512, 240], sign: [512, 784, 512, 240], scuff: [768, 256, 256, 256], spd: [256, 96, 256, 160] } }
  };
  let LAY = LAYS.car;
  /** uv rect of an atlas slot of the layout that is currently being built */
  const uvOf = (n, flipU) => { const s = LAY.s[n], u0 = s[0] / LAY.W, u1 = (s[0] + s[2]) / LAY.W, v0 = 1 - (s[1] + s[3]) / LAY.H, v1 = 1 - s[1] / LAY.H; return flipU ? [u1, v0, u0, v1] : [u0, v0, u1, v1]; };
  /** part of a slot; fractions are measured from the slot's top-left corner */
  const uvSub = (n, fx0, fy0, fx1, fy1) => { const r = uvOf(n); return [lerp(r[0], r[2], fx0), lerp(r[3], r[1], fy1), lerp(r[0], r[2], fx1), lerp(r[3], r[1], fy0)]; };
  const rrp = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  function grain(g, x, y, w, h, amt, seed, weave) { const im = g.getImageData(x, y, w, h), d = im.data, r = GT.rng('grain' + seed); for (let i = 0; i < w * h; i++) { const j = i * 4; if (!d[j + 3]) continue; const px = i % w, py = (i / w) | 0, n = (r() - .5) * amt + (weave ? (((px + py) & 3) === 0 ? -weave : ((px - py) & 3) === 0 ? weave * .6 : 0) : 0); d[j] += n; d[j + 1] += n; d[j + 2] += n * .8; } g.putImageData(im, x, y); }
  function scratches(g, w, h, n, seed, cols, lw) { const r = GT.rng('scr' + seed); g.save(); g.lineCap = 'round'; for (let i = 0; i < n; i++) { const x = r() * w, y = r() * h, a = (r() - .5) * .8, l = 14 + r() * r() * w * .45; g.strokeStyle = cols[(r() * cols.length) | 0]; g.lineWidth = (lw || 1) * (1 + r() * 2.2); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + cos(a) * l * .5, y + sin(a) * l * .5 + (r() - .5) * 9, x + cos(a) * l, y + sin(a) * l); g.stroke(); } g.restore(); }
  function blotches(g, w, h, n, seed, cols, sz) { const r = GT.rng('blt' + seed); sz = sz || 1; for (let i = 0; i < n; i++) { const cx = r() * w, cy = r() * h, m = 4 + ((r() * 14) | 0); g.fillStyle = cols[(r() * cols.length) | 0]; for (let k = 0; k < m; k++) { g.beginPath(); g.arc(cx + (r() - .5) * 26 * sz, cy + (r() - .5) * 18 * sz, (1.5 + r() * 6) * sz, 0, TAU); g.fill(); } } }
  /** original 「跑得快」 mark: a tilted bowl, a lightning bolt for chopsticks and three speed lines inside a ring */
  function pdkLogo(g, cx, cy, s, fg, bg) { g.save(); g.translate(cx, cy); g.fillStyle = fg; g.beginPath(); g.arc(0, 0, s, 0, TAU); g.fill(); g.fillStyle = bg; g.beginPath(); g.arc(0, 0, s * .87, 0, TAU); g.fill();
    g.fillStyle = fg; g.rotate(-.2); g.beginPath(); g.arc(s * .1, s * .08, s * .48, 0, PI); g.closePath(); g.fill(); g.fillRect(-s * .46, s * .0, s * 1.12, s * .1);
    g.beginPath(); g.moveTo(s * .22, -s * .72); g.lineTo(-s * .14, -s * .24); g.lineTo(s * .08, -s * .24); g.lineTo(-s * .04, -s * .04); g.lineTo(s * .46, -s * .4); g.lineTo(s * .22, -s * .4); g.lineTo(s * .44, -s * .72); g.closePath(); g.fill();
    for (let k = 0; k < 3; k++) g.fillRect(-s * (.8 - k * .05), s * (.2 + k * .15), s * (.28 - k * .05), s * .07); g.restore(); }
  function qrCode(g, x, y, s, seed) { const n = 25, m = s / (n + 2), r = GT.rng('qr' + seed), fin = (i, j) => (i < 7 && j < 7) || (i >= n - 7 && j < 7) || (i < 7 && j >= n - 7); g.fillStyle = '#f2f2ee'; g.fillRect(x, y, s, s); g.fillStyle = '#121212';
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (!fin(i, j) && r() < .48) g.fillRect(x + (i + 1) * m, y + (j + 1) * m, m + .5, m + .5);
    for (const q of [[0, 0], [n - 7, 0], [0, n - 7]]) { g.fillStyle = '#121212'; g.fillRect(x + (q[0] + 1) * m, y + (q[1] + 1) * m, 7 * m, 7 * m); g.fillStyle = '#f2f2ee'; g.fillRect(x + (q[0] + 2) * m, y + (q[1] + 2) * m, 5 * m, 5 * m); g.fillStyle = '#121212'; g.fillRect(x + (q[0] + 3) * m, y + (q[1] + 3) * m, 3 * m, 3 * m); } }
  /** dot-matrix LED board: glowing text behind a black dot mask */
  function ledText(g, x, y, w, h, text, col, o) { o = o || {}; g.save(); g.fillStyle = '#050505'; g.fillRect(x, y, w, h); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = col; g.textBaseline = 'middle'; g.textAlign = o.align || 'center'; let px = h * (o.h || .76); const f = p => `700 ${p}px ${o.font || CJK}`; g.font = f(px); const tw = g.measureText(text).width, mw = w * .94; if (tw > mw) { px *= mw / tw; g.font = f(px); }
    g.shadowColor = col; g.shadowBlur = px * .1; g.fillText(text, o.align === 'left' ? x + w * .03 : x + w / 2, y + h * .54); g.shadowBlur = 0; const p = o.pitch || max(3, h / 24); g.fillStyle = 'rgba(0,0,0,.7)'; for (let yy = y; yy < y + h; yy += p) g.fillRect(x, yy, w, p * .34); for (let xx = x; xx < x + w; xx += p) g.fillRect(xx, y, p * .34, h); g.restore(); }
  function painter(g, L) { const P = { g, L };
    P.fill = (n, col) => { const s = L.s[n]; g.fillStyle = col; g.fillRect(s[0], s[1], s[2], s[3]); };
    /** text fitted into a slot. o: {x, y (fractions), h (font size / slot height), w (max width fraction), font, weight, align, stroke} */
    P.word = (n, text, col, o) => { o = o || {}; const s = L.s[n], x = s[0] + s[2] * (o.x === undefined ? .5 : o.x), y = s[1] + s[3] * (o.y === undefined ? .53 : o.y), mw = s[2] * (o.w || .94); let px = s[3] * (o.h || .78); g.save(); g.fillStyle = col; g.textAlign = o.align || 'center'; g.textBaseline = 'middle';
      const f = p => `${o.weight || '900'} ${p}px ${o.font || CJK}`; g.font = f(px); const w = g.measureText(text).width; if (w > mw) { px *= mw / w; g.font = f(px); } if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = px * .14; g.lineJoin = 'round'; g.strokeText(text, x, y); } g.fillText(text, x, y); g.restore(); return px; };
    P.img = (n, tex) => { const s = L.s[n]; if (tex && tex.image) g.drawImage(tex.image, s[0], s[1], s[2], s[3]); };
    /** draw inside a slot with local pixel coordinates */
    P.clip = (n, fn) => { const s = L.s[n]; g.save(); g.beginPath(); g.rect(s[0], s[1], s[2], s[3]); g.clip(); g.translate(s[0], s[1]); fn(s[2], s[3]); g.restore(); };
    /** Chinese plate through GT.signTex: 'blue' (cars), 'yellow' (bus), 'white' (police, with a red 巡), 'ebike' (small white plate with a green header) */
    P.plate = (text, style) => { if (style && typeof style === 'object') { const so = style; P.clip('plate', (w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, so.bg); gr.addColorStop(1, so.bg2 || so.bg); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = so.rim || so.fg; g.lineWidth = h * .06; g.strokeRect(h * .05, h * .05, w - h * .1, h - h * .1);   /* SH: a style object from js/carmods.js — {bg, bg2, fg, rim, top, foot} */
        g.fillStyle = so.fg; g.textAlign = 'center'; g.textBaseline = 'middle'; if (so.top) { g.font = '800 ' + (h * .17) + 'px ' + LAT; g.fillText(so.top, w / 2, h * .2); } if (so.foot) { g.font = '700 ' + (h * .12) + 'px ' + LAT; g.fillText(so.foot, w / 2, h * .85); }
        let px = h * .5; g.font = '900 ' + px + 'px ' + LAT; const tw = g.measureText(text).width; if (tw > w * .84) { px *= w * .84 / tw; g.font = '900 ' + px + 'px ' + LAT; } g.fillText(text, w / 2, h * .54); }); return; }
      const st = { blue: ['#eef0ec', '#1b2a5c'], yellow: ['#eef0ec', '#1b2a5c'], white: ['#eceee9', '#151515'], ebike: ['#eef0ea', '#151515'] }[style], s = L.s.plate, pol = style === 'white';
      P.img('plate', GT.signTex(pol ? text + '　' : text, { style: 'painted', w: s[2], h: s[3], bg: st[0], color: st[1], font: CJK, distress: style === 'ebike' ? .2 : .14 }));
      P.clip('plate', (w, h) => { if (pol) { g.fillStyle = '#c21a1a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${h * .5}px ${CJK}`; g.fillText('巡', w * .845, h * .53); }
        if (style === 'ebike') { g.fillStyle = '#1f7a45'; g.fillRect(w * .06, h * .09, w * .88, h * .2); g.fillStyle = '#f2f4ee'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${h * .15}px ${CJK}`; g.fillText('江城 · 电动自行车', w / 2, h * .2); }
        for (const bx of [.07, .93]) { g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(w * bx + 1, h * .5 + 2, h * .05, 0, TAU); g.fill(); g.fillStyle = '#b9bbb8'; g.beginPath(); g.arc(w * bx, h * .5, h * .042, 0, TAU); g.fill(); } }); };
    return P; }
  const PAINT = {};
  const SCR = ['#3b3a36', '#8d8c86', '#5a554c', '#c9c7be'];
  PAINT.taxi = (P, o) => { const g = P.g; P.plate(o.plate, 'blue');
    P.clip('A', (w, h) => { g.translate(w / 2, h / 2); g.fillStyle = '#0e3b30'; g.beginPath(); g.arc(0, 0, 118, 0, TAU); g.fill(); g.fillStyle = '#e9c642'; g.beginPath(); g.arc(0, 0, 104, 0, TAU); g.fill(); g.fillStyle = '#0e3b30'; g.beginPath(); g.arc(0, 0, 96, 0, TAU); g.fill();
      g.strokeStyle = '#e9c642'; g.lineWidth = 9; g.beginPath(); g.arc(0, 74, 92, PI * 1.19, PI * 1.81); g.stroke(); g.lineWidth = 6; for (const x of [-44, 0, 44]) { g.beginPath(); g.moveTo(x, -8 + abs(x) * .32); g.lineTo(x, 26); g.stroke(); } g.beginPath(); g.moveTo(-78, 26); g.lineTo(78, 26); g.stroke();
      for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(-60 + k * 8, 44 + k * 13); g.quadraticCurveTo(0, 36 + k * 13, 60 - k * 8, 44 + k * 13); g.lineWidth = 4; g.stroke(); } g.fillStyle = '#e9c642'; g.font = `900 30px ${CJK}`; g.textAlign = 'center'; g.fillText('江城出租', 0, -42); });
    P.word('D', '江城出租', '#0e3b30', { y: .4, h: .66 }); P.word('D', 'JIANGCHENG TAXI  ·  文明服务  安全出行', '#0e3b30', { y: .87, h: .2, weight: '700' });
    P.word('E', '电召热线  5210-8866', '#0e3b30', { y: .36, h: .56 }); P.word('E', '监督电话 96521  ·  起步价 10 元 / 3 公里', '#0e3b30', { y: .82, h: .26, weight: '600' });
    P.clip('G', (w) => { for (let i = 0; i < w / 16; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) & 1 ? '#f1efe6' : '#15171a'; g.fillRect(i * 16, j * 16, 16, 16); } });
    P.fill('F', '#f3e2a2'); P.word('F', '出租', '#b31a1a', { x: .3, h: .62, w: .5 }); P.word('F', 'TAXI', '#171717', { x: .74, h: .4, w: .42, font: LAT });
    P.word('B', '远途 YUANTU', '#fff', { h: .7, weight: '700' }); P.word('C', 'GL 1.5', '#fff', { h: .5, font: LAT, weight: '700' });
    { const s = P.L.s.H; ledText(g, s[0], s[1], s[2], s[3], '空 车', '#ff2a1a', { h: .8 }); const t = P.L.s.I; ledText(g, t[0], t[1], t[2], t[3], '¥ 10.00   0.0 km', '#ff3b22', { h: .6, font: LAT, pitch: 4 }); }
    P.clip('J', (w, h) => { rrp(g, 8, 8, w - 16, h - 16, 14); g.fillStyle = '#f3f1e8'; g.fill(); g.fillStyle = '#b31a1a'; g.fillRect(8, 8, w - 16, 56); g.fillStyle = '#fff'; g.font = `900 38px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('出租汽车价目表', w / 2, 38);
      g.fillStyle = '#1a1a1a'; g.font = `600 26px ${CJK}`; g.textAlign = 'left'; ['起步价　10 元 / 3 公里', '里程价　2.0 元 / 公里', '夜间 23:00–5:00 加收 20%', '车号 江A·' + o.plate.slice(-5) + '　禁止吸烟'].forEach((t, i) => g.fillText(t, 34, 100 + i * 38)); });
    { const s = P.L.s.L; ledText(g, s[0], s[1], s[2], s[3], '辣姐老火锅 · 订座 5210-1717', '#ff38b4', { h: .62, pitch: 3 }); }
    P.clip('K', (w, h) => scratches(g, w, h, 70, 'taxi', SCR)); };
  /* plain saloon (the wedding convoy, private cars): the same body without a livery */
  PAINT.sedan = (P, o) => { const g = P.g; P.plate(o.plate, 'blue'); P.word('B', 'MERIDIAN', '#fff', { h: .7, weight: '700' }); P.word('C', 'V6', '#fff', { h: .6, font: LAT, weight: '700' }); P.clip('K', (w, h) => scratches(g, w, h, 18, 'sedan', SCR, .7)); };
  /* SWAT vans. The mark is original: a hexagon, two roof chevrons (a watch post) and the two characters. dark = the armoured unit (pale lettering on slate) */
  const SWP = dark => (P, o) => { const g = P.g, INK = dark ? '#e6eaec' : '#20262c', RD = '#c8161c'; P.plate(o.plate, 'white');
    P.clip('A', (w, h) => { g.translate(w / 2, h / 2); const hex = r => { g.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU - HP; if (k) g.lineTo(cos(a) * r, sin(a) * r); else g.moveTo(cos(a) * r, sin(a) * r); } g.closePath(); };
      g.fillStyle = '#c9ccd0'; hex(122); g.fill(); g.fillStyle = '#1b2026'; hex(110); g.fill(); g.strokeStyle = RD; g.lineWidth = 7; hex(94); g.stroke(); g.strokeStyle = '#e6eaec'; g.lineWidth = 13; g.lineJoin = 'miter'; for (const y of [-58, -24]) { g.beginPath(); g.moveTo(-50, y + 30); g.lineTo(0, y); g.lineTo(50, y + 30); g.stroke(); }
      g.fillStyle = '#e6eaec'; g.font = `900 40px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('特勤', 0, 50); });
    P.word('D', 'S.W.A.T', INK, { h: .92 }); P.word('E', 'HCPD  SPECIAL UNIT', INK, { h: .46, weight: '700' }); P.word('F', String(o.unit), dark ? '#e6eaec' : '#15171c', { h: .7, font: LAT }); P.word('B', 'S.W.A.T', '#fff', { h: .74 }); P.word('C', 'SWAT', '#fff', { h: .7, font: LAT });
    { const s = P.L.s.H; ledText(g, s[0], s[1], s[2], s[3], 'POLICE · KEEP CLEAR', '#ff2a1a', { h: .7 }); } P.clip('K', (w, h) => scratches(g, w, h, 70, 'swat', SCR)); };
  PAINT.riot = SWP(false); PAINT.armoured = SWP(true);
  /* 老头乐 「跑不快」: a dealer's board where a plate would be, loud sticker art on the doors (drawn 1.5x wide: the body it rides on is the van loft squeezed along its length) */
  PAINT.laotoule = (P, o) => { const g = P.g;
    P.clip('plate', (w, h) => { g.fillStyle = '#c21a1a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#f2d36a'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16); g.fillStyle = '#f2d36a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${h * .46}px ${CJK}`; g.fillText('跑不快 代步车', w / 2, h * .4, w - 40); g.font = `700 ${h * .2}px ${CJK}`; g.fillText(String(o.plate || '福8888') + ' · 接送孙子 · 买菜遛弯', w / 2, h * .78, w - 40); });
    P.word('B', '跑不快 PAOBUKUAI', '#fff', { h: .6, weight: '700' }); P.word('C', 'EV', '#fff', { h: .6, font: LAT, weight: '700' });
    P.clip('A', (w, h) => { const r = GT.rng('ltl'); g.lineCap = 'round'; g.strokeStyle = '#ffffff'; g.lineWidth = 18; g.beginPath(); g.moveTo(14, h * .8); g.bezierCurveTo(w * .3, h * .2, w * .6, h * .95, w - 14, h * .3); g.stroke(); g.strokeStyle = '#ffd23a'; g.lineWidth = 8; g.beginPath(); g.moveTo(14, h * .9); g.bezierCurveTo(w * .3, h * .32, w * .6, h * 1.04, w - 14, h * .42); g.stroke();
      for (let q = 0; q < 12; q++) { const x = 30 + r() * (w - 60), y = 24 + r() * (h - 48), sz = 6 + r() * 14; g.fillStyle = ['#ffffff', '#ffd23a', '#7fe0ff'][q % 3]; g.beginPath(); g.ellipse(x, y, sz * 1.5, sz, 0, 0, TAU); g.fill(); } });
    P.clip('K', (w, h) => scratches(g, w, h, 30, 'ltl', SCR, .8)); };
  PAINT.police = (P, o) => { const g = P.g, BL = '#17409a'; P.plate(o.plate, 'white');
    P.clip('A', (w, h) => { g.translate(w / 2, h / 2); g.fillStyle = '#c9a43a'; g.beginPath(); g.moveTo(0, -120); g.quadraticCurveTo(70, -96, 104, -100); g.quadraticCurveTo(112, 30, 0, 122); g.quadraticCurveTo(-112, 30, -104, -100); g.quadraticCurveTo(-70, -96, 0, -120); g.fill();
      g.fillStyle = BL; g.beginPath(); g.moveTo(0, -104); g.quadraticCurveTo(62, -84, 90, -86); g.quadraticCurveTo(96, 22, 0, 102); g.quadraticCurveTo(-96, 22, -90, -86); g.quadraticCurveTo(-62, -84, 0, -104); g.fill();
      g.fillStyle = '#f1efe6'; g.font = `900 46px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('police', 0, -34); g.font = `700 20px ${CJK}`; g.fillText('PVPS POLICE', 0, 12, 150); g.strokeStyle = '#c9a43a'; g.lineWidth = 5; g.beginPath(); g.moveTo(-50, 38); g.lineTo(50, 38); g.stroke(); g.font = `700 22px ${LAT}`; g.fillText('TRAFFIC', 0, 60); });
    P.word('D', 'POLICE', BL, { x: .3, h: .78, w: .56, font: LAT });   /* CAR r1: an American patrol car on Moonbay Drive (was 交 管) */ P.word('D', 'PATROL', BL, { x: .78, h: .5, w: .4, font: LAT });
    P.word('E', 'HCPD POLICE  TRAFFIC CONTROL', '#f1efe6', { h: .5, weight: '700' });
    P.clip('G', (w) => { for (let i = 0; i < w / 16; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) & 1 ? '#f1efe6' : BL; g.fillRect(i * 16, j * 16, 16, 16); } });
    P.word('F', String(o.unit), '#15171c', { h: .7, font: LAT }); P.word('B', 'POLICE', BL, { h: .74 }); P.word('C', 'HCPD', BL, { h: .7, font: LAT });
    P.clip('L', (w, h) => { g.fillStyle = '#12589a'; g.beginPath(); g.moveTo(5, 13); g.lineTo(w - 5, 43); g.lineTo(w - 5, h); g.lineTo(5, 24); g.closePath(); g.fill(); g.fillStyle = '#e8c21a'; g.beginPath(); g.moveTo(5, 9.5); g.lineTo(w - 5, 39.5); g.lineTo(w - 5, 43); g.lineTo(5, 13); g.closePath(); g.fill(); });
    P.word('H', 'UNIT ' + o.unit, BL, { h: .6, font: LAT }); P.clip('K', (w, h) => scratches(g, w, h, 60, 'police', SCR)); };
  PAINT.van = (P, o) => { const g = P.g; P.plate(o.plate, 'blue');
    P.word('D', '搬家拉货 · 长短途', '#a11d16', { h: .74 }); P.word('E', '电话 138-0000-0000', '#a11d16', { h: .66 });
    P.clip('A', (w, h) => { for (const q of [[66, 66, '#2e8b4e', '检'], [190, 66, '#d9a514', '保'], [66, 190, '#2a66b8', '环']]) { g.fillStyle = '#f2f0e6'; g.beginPath(); g.arc(q[0], q[1], 58, 0, TAU); g.fill(); g.fillStyle = q[2]; g.beginPath(); g.arc(q[0], q[1], 50, 0, TAU); g.fill(); g.fillStyle = '#f6f4ea'; g.font = `900 50px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(q[3], q[0], q[1] + 3); }
      rrp(g, 132, 136, 116, 112, 10); g.fillStyle = '#e6c21e'; g.fill(); g.fillStyle = '#141414'; g.font = `900 46px ${CJK}`; g.fillText('实习', 190, 194); });
    P.word('B', '金牛之星', '#fff', { h: .7, weight: '700' }); P.word('C', '1.2L', '#fff', { h: .5, font: LAT, weight: '700' });
    P.clip('J', (w, h) => { rrp(g, 10, 60, w - 20, h - 120, 12); g.fillStyle = '#d8c11c'; g.fill(); g.fillStyle = '#141414'; g.font = `900 78px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('小心倒车', w / 2, h / 2 + 4); });
    P.clip('K', (w, h) => { blotches(g, w, h, 20, 'van', ['#5c3519', '#6f4522', '#3e2513', '#7a5230'], .8); scratches(g, w, h, 60, 'van', ['#4b4a45', '#77756d', '#5c3519', '#2f2e2b'], 1.0); }); };
  PAINT.sports = (P, o) => { const g = P.g; P.plate(o.plate, 'blue');
    P.word('B', '赤 隼', '#fff', { h: .8, weight: '900', x: .3, w: .5 }); P.word('B', 'CHISUN', '#fff', { x: .74, h: .5, w: .44, font: LAT, weight: 'italic 700' }); P.word('C', 'RS', '#fff', { h: .7, font: LAT, weight: 'italic 900' });
    P.clip('A', (w, h) => { g.translate(w / 2, h / 2); g.fillStyle = '#16171a'; g.beginPath(); g.arc(0, 0, 112, 0, TAU); g.fill(); g.fillStyle = '#d8b03a'; g.beginPath(); g.arc(0, 0, 100, 0, TAU); g.fill(); g.fillStyle = '#a3141a'; g.beginPath(); g.arc(0, 0, 90, 0, TAU); g.fill();
      g.fillStyle = '#f1e6c0'; g.beginPath(); g.moveTo(-70, 20); g.quadraticCurveTo(-20, -70, 74, -40); g.quadraticCurveTo(10, -30, -4, 6); g.quadraticCurveTo(30, -6, 58, 6); g.quadraticCurveTo(0, 30, -70, 20); g.fill(); g.font = `900 30px ${LAT}`; g.textAlign = 'center'; g.fillText('CHISUN', 0, 66); });
    P.clip('K', (w, h) => scratches(g, w, h, 26, 'sports', ['#6d6c66', '#3b3a36'], .7)); };
  PAINT.bus = (P, o) => { const g = P.g, S = P.L.s; P.plate(o.plate, 'yellow');
    ledText(g, S.led[0], S.led[1], S.led[2], S.led[3], o.route + ' 路  四方街 ⇌ 江滩码头', '#ffb017', { h: .62, pitch: 4 }); ledText(g, S.ledS[0], S.ledS[1], S.ledS[2], S.ledS[3], o.route + ' 四方街→钟楼→江滩码头', '#ffb017', { h: .6, pitch: 3.5 }); ledText(g, S.ledR[0], S.ledR[1], S.ledR[2], S.ledR[3], o.route, '#ffb017', { h: .86, font: LAT, pitch: 5 });
    P.word('B', '江城公交', '#fff', { h: .8, weight: '700' }); P.word('C', 'E12', '#fff', { h: .8, font: LAT, weight: '700' });
    P.clip('adA', (w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#8e1210'); gr.addColorStop(.55, '#b81d16'); gr.addColorStop(1, '#7a0f0e'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,190,60,.16)'; for (let k = 0; k < 9; k++) { g.beginPath(); g.arc(w * .14 + k * 30, h * 1.3, 240 + k * 46, PI * 1.1, PI * 1.9); g.lineWidth = 10; g.strokeStyle = 'rgba(255,190,60,.12)'; g.stroke(); }
      const cx = h * .62, cy = h * .5, R = h * .4; g.fillStyle = '#2a1a12'; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill(); g.fillStyle = '#c9a43a'; g.beginPath(); g.arc(cx, cy, R * .93, 0, TAU); g.fill(); g.fillStyle = '#c62a16'; g.beginPath(); g.arc(cx, cy, R * .84, 0, TAU); g.fill();
      g.fillStyle = '#efe2c2'; g.beginPath(); g.arc(cx, cy, R * .84, -HP, HP); g.arc(cx, cy + R * .42, R * .42, HP, -HP, true); g.arc(cx, cy - R * .42, R * .42, HP, -HP); g.fill(); g.strokeStyle = '#c9a43a'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, R * .84, 0, TAU); g.stroke();
      const r = GT.rng('pot'); for (let k = 0; k < 26; k++) { const a = r() * TAU, d = r() * R * .7; g.fillStyle = k % 3 ? '#7d120c' : '#3d7a2c'; g.beginPath(); g.ellipse(cx + cos(a) * d, cy + sin(a) * d, 9, 4, a, 0, TAU); g.fill(); }
      g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#f6dd9a'; g.font = `900 ${h * .5}px ${CJK}`; g.fillText('辣姐老火锅', h * 1.22, h * .36); g.fillStyle = '#fff'; g.font = `700 ${h * .2}px ${CJK}`; g.fillText('灯笼街 28 号 · 牛油锅底 · 莫慌，先吃', h * 1.24, h * .78);
      g.textAlign = 'right'; g.fillStyle = '#f6dd9a'; g.font = `900 ${h * .3}px ${CJK}`; g.fillText('要得！', w - h * 1.3, h * .34); g.fillStyle = '#fff'; g.font = `700 ${h * .17}px ${CJK}`; g.fillText('订座 5210-1717　营业至凌晨 2 点', w - h * 1.3, h * .76); qrCode(g, w - h * .98, h * .14, h * .72, 'ad'); grain(g, S.adA[0], S.adA[1], w, h, 10, 'adA'); });
    P.clip('adB', (w, h) => { g.fillStyle = '#e2ae1a'; g.fillRect(0, 0, w, h); g.fillStyle = '#151515'; g.beginPath(); g.moveTo(w * .62, 0); g.lineTo(w, 0); g.lineTo(w, h); g.lineTo(w * .54, h); g.closePath(); g.fill(); g.fillStyle = '#151515'; g.beginPath(); g.arc(h * .52, h * .5, h * .38, 0, TAU); g.fill(); g.fillStyle = '#e2ae1a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${h * .26}px ${LAT}`; g.fillText('FM', h * .52, h * .53);   /* g7: a radio ad where the delivery platform's recruiting ad was */
      g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#151515'; g.font = `900 ${h * .42}px ${CJK}`; g.fillText('海风电台', h * 1.02, h * .37); g.font = `700 ${h * .17}px ${CJK}`; g.fillText('维尔蒙港 · 24 小时不停播', h * 1.05, h * .76); g.textAlign = 'center'; g.fillStyle = '#e2ae1a'; g.font = `900 ${h * .25}px ${LAT}`; g.fillText('101.7', w * .81, h * .3); g.fillStyle = '#fff'; g.font = `700 ${h * .14}px ${CJK}`; g.fillText('堵车的时候听我们', w * .81, h * .62); g.fillText('VELLMONT FM', w * .81, h * .82); grain(g, S.adB[0], S.adB[1], w, h, 10, 'adB'); });
    P.clip('logo', (w, h) => { g.fillStyle = '#12705c'; g.beginPath(); g.arc(h * .5, h * .5, h * .42, 0, TAU); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 7; g.beginPath(); g.arc(h * .5, h * .78, h * .44, PI * 1.2, PI * 1.8); g.stroke(); g.beginPath(); g.moveTo(h * .22, h * .64); g.lineTo(h * .78, h * .64); g.stroke(); g.fillStyle = '#12705c'; g.textBaseline = 'middle'; g.font = `900 ${h * .56}px ${CJK}`; g.fillText('江城公交', h * 1.05, h * .5); });
    P.word('ev', '纯电动 · 零排放', '#12705c', { h: .6 });
    P.clip('misc', (w, h) => { rrp(g, 6, 6, 244, 118, 10); g.fillStyle = '#f2f0e8'; g.fill(); g.fillStyle = '#12705c'; g.font = `900 44px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('前门上车', 128, 42); g.font = `700 30px ${CJK}`; g.fillText('票价 2 元 · 扫码乘车', 128, 92);
      rrp(g, 262, 6, 244, 118, 10); g.fillStyle = '#f2f0e8'; g.fill(); g.fillStyle = '#b31a1a'; g.font = `900 44px ${CJK}`; g.fillText('后门下车', 384, 42); g.font = `700 30px ${CJK}`; g.fillText('先下后上 文明乘车', 384, 92); qrCode(g, 6, 134, 116, 'bus');
      rrp(g, 134, 134, 372, 116, 10); g.fillStyle = '#e8b81e'; g.fill(); g.fillStyle = '#151515'; g.font = `900 40px ${CJK}`; g.fillText('老弱病残孕专座', 320, 172); g.font = `700 26px ${CJK}`; g.fillText('请给有需要的乘客让座', 320, 220); });
    P.clip('K', (w, h) => { scratches(g, w, h, 90, 'bus', ['#3b3a36', '#5a554c', '#6d6a60', '#2c2b28'], .8); blotches(g, w, h, 10, 'bus', ['#4a473f', '#5d5a50'], .7); });
    P.clip('dash', (w, h) => { g.fillStyle = '#0a0c0e'; g.fillRect(0, 0, w, h); g.fillStyle = '#28d17c'; g.font = `700 60px ${LAT}`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText('SOC 82%', 30, 60); g.fillStyle = '#e8eef2'; g.fillText('38 km/h', 300, 60); g.fillStyle = '#ffb017'; g.font = `700 44px ${CJK}`; g.fillText('下一站：钟楼', 30, 140); }); };
  PAINT.escooter = (P, o) => { const g = P.g, S = P.L.s, Y = '#c79618', K0 = '#151515'; P.plate(o.plate, 'ebike');   /* the box is a shade dirtier than 阿凯's jacket so the two do not fuse into one yellow block */
    P.clip('chk', (w, h) => { const c = h / 3; for (let i = 0; i < w / c; i++) for (let j = 0; j < 3; j++) { g.fillStyle = (i + j) & 1 ? '#d8e21a' : '#1763b0'; g.fillRect(i * c, j * c, c + .5, c + .5); } }); P.clip('unit', (w, h) => { g.fillStyle = '#eef0ea'; g.fillRect(0, 0, w, h); }); P.word('unit', 'POLICE', '#12589a', { h: .78 });
    P.word('brand', '飞燕 FEIYAN', '#f1efe6', { h: .62, weight: '900' });
    P.clip('spd', (w, h) => { g.fillStyle = '#05080a'; g.fillRect(0, 0, w, h); g.fillStyle = '#5fe3ff'; g.textBaseline = 'middle'; g.textAlign = 'right'; g.font = `700 96px ${LAT}`; g.fillText('25', 150, 72); g.font = `700 24px ${LAT}`; g.textAlign = 'left'; g.fillText('km/h', 158, 96); g.fillStyle = '#36d671'; for (let k = 0; k < 5; k++) { g.globalAlpha = k < 3 ? 1 : .22; g.fillRect(24 + k * 30, 128, 24, 16); } g.globalAlpha = 1; g.font = `700 20px ${LAT}`; g.fillText('READY', 182, 138); g.fillStyle = '#ffb017'; g.fillText('ODO 28417', 158, 34); });
    P.clip('nav', (w, h) => { g.fillStyle = '#0e1521'; g.fillRect(0, 0, w, h); const r = GT.rng('nav'); g.fillStyle = '#172232'; for (let k = 0; k < 16; k++) g.fillRect(r() * w - 30, 70 + r() * (h - 240), 30 + r() * 70, 24 + r() * 60);
      g.strokeStyle = '#2b3a50'; g.lineWidth = 9; for (const l of [[-10, 150, 270, 110], [-10, 290, 270, 250], [70, 60, 110, 400], [190, 60, 170, 400]]) { g.beginPath(); g.moveTo(l[0], l[1]); g.lineTo(l[2], l[3]); g.stroke(); }
      g.lineJoin = g.lineCap = 'round'; g.strokeStyle = '#1a66d9'; g.lineWidth = 15; const rt = [[100, 344], [84, 268], [182, 254], [176, 136], [224, 118]]; g.beginPath(); rt.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); g.strokeStyle = '#57a8ff'; g.lineWidth = 8; g.stroke();
      g.fillStyle = '#ff4b3a'; g.beginPath(); g.arc(224, 118, 11, 0, TAU); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(224, 118, 4.5, 0, TAU); g.fill(); g.fillStyle = '#ffd21f'; g.beginPath(); g.moveTo(100, 322); g.lineTo(116, 358); g.lineTo(100, 349); g.lineTo(84, 358); g.closePath(); g.fill();
      g.fillStyle = '#f2c21a'; g.fillRect(0, 0, w, 62); pdkLogo(g, 32, 31, 22, K0, '#f2c21a'); g.fillStyle = K0; g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = `900 30px ${CJK}`; g.fillText('跑得快 · 配送中', 62, 33);
      rrp(g, 8, h - 156, w - 16, 148, 16); g.fillStyle = '#cfcec6'; g.fill(); g.fillStyle = '#c4261c'; g.font = `900 46px ${LAT}`; g.fillText('04:12', 20, h - 118); g.fillStyle = '#1a1a1a'; g.font = `700 22px ${CJK}`; g.fillText('后超时', 150, h - 114); g.font = `700 24px ${CJK}`; g.fillText('臭豆腐 ×2', 20, h - 72); g.fillStyle = '#555'; g.font = `600 20px ${CJK}`; g.fillText('送至 轻轨观景台 · 420 米', 20, h - 36); });
    const face = (n, seed, fn) => P.clip(n, (w, h) => { g.fillStyle = Y; g.fillRect(0, 0, w, h); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,240,170,.16)'); gr.addColorStop(.6, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(60,40,10,.42)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); fn(w, h);
      blotches(g, w, h, 16, seed, ['rgba(70,52,20,.2)', 'rgba(40,30,14,.16)', 'rgba(255,235,160,.14)'], 2.2); scratches(g, w, h, 46, seed, ['rgba(60,44,14,.55)', 'rgba(250,232,150,.5)', 'rgba(30,24,14,.5)'], 1.1); grain(g, S[n][0], S[n][1], w, h, 20, seed, 7); });
    const strip = (x, y, w2, h2) => { g.fillStyle = '#b9bcba'; g.fillRect(x, y, w2, h2); g.save(); g.beginPath(); g.rect(x, y, w2, h2); g.clip(); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; for (let k = -h2; k < w2 + h2; k += 9) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k + h2, y + h2); g.stroke(); g.beginPath(); g.moveTo(x + k + h2, y); g.lineTo(x + k, y + h2); g.stroke(); } g.restore(); g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 2; g.strokeRect(x, y, w2, h2); };
    const piping = (w, h) => { g.strokeStyle = K0; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.setLineDash([7, 5]); g.strokeRect(20, 20, w - 40, h - 40); g.setLineDash([]); };
    face('boxB', 'bb', (w, h) => { piping(w, h); pdkLogo(g, w / 2, 150, 96, K0, Y); g.fillStyle = K0; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 108px ${CJK}`; g.fillText('跑得快', w / 2, 316); g.font = `700 27px ${CJK}`; g.fillText('PAODEKUAI · 准时必达 · 洒了包赔', w / 2, 392); strip(30, 424, w - 60, 44);
      g.save(); g.translate(w - 96, 96); g.rotate(.5); g.fillStyle = '#9a9d9b'; g.fillRect(-70, -17, 140, 34); g.rotate(-1.15); g.fillStyle = '#a8aba8'; g.fillRect(-62, -16, 124, 32); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(-62, -16, 124, 6); g.restore(); });
    face('boxS', 'bs', (w, h) => { piping(w, h); pdkLogo(g, 132, 190, 78, K0, Y); g.fillStyle = K0; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = `900 78px ${CJK}`; g.fillText('跑得快', 226, 170); g.font = `700 26px ${CJK}`; g.fillText('骑手编号 K-5217', 230, 236); g.font = `700 24px ${CJK}`; g.fillText('客服热线 5210-0000', 230, 274); strip(30, 424, w - 60, 44); g.fillStyle = K0; g.font = `900 34px ${CJK}`; g.textAlign = 'center'; g.fillText('保温 · 防泼洒', w / 2, 366); });
    face('lid', 'bl', (w, h) => { g.strokeStyle = K0; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); g.strokeStyle = '#2b2b2b'; g.lineWidth = 5; g.setLineDash([3, 3]); g.strokeRect(22, 22, w - 44, h - 44); g.setLineDash([]); g.fillStyle = K0; g.fillRect(w / 2 - 50, h / 2 - 9, 100, 18); pdkLogo(g, w / 2, h / 2 + 62, 30, K0, Y); });
    P.clip('stick', (w, h) => { qrCode(g, 6, 6, 116, 'sc'); rrp(g, 134, 6, 116, 116, 10); g.fillStyle = '#f2f0e6'; g.fill(); g.fillStyle = '#d9a514'; g.beginPath(); g.moveTo(200, 14); g.lineTo(170, 66); g.lineTo(190, 66); g.lineTo(178, 102); g.lineTo(218, 52); g.lineTo(196, 52); g.closePath(); g.fill(); g.fillStyle = '#151515'; g.font = `900 17px ${CJK}`; g.textAlign = 'center'; g.fillText('充电口 48V', 192, 118);
      g.fillStyle = '#f2f0e6'; g.beginPath(); g.arc(64, 192, 58, 0, TAU); g.fill(); g.fillStyle = '#2458b0'; g.beginPath(); g.arc(64, 192, 52, 0, TAU); g.fill(); g.fillStyle = '#fff'; g.font = `900 32px ${CJK}`; g.textBaseline = 'middle'; g.fillText('一盔', 64, 176); g.fillText('一带', 64, 212);
      g.fillStyle = '#f2f0e6'; g.beginPath(); g.arc(192, 192, 58, 0, TAU); g.fill(); g.strokeStyle = '#c21a1a'; g.lineWidth = 11; g.beginPath(); g.arc(192, 192, 47, 0, TAU); g.stroke(); g.fillStyle = '#151515'; g.font = `900 52px ${LAT}`; g.fillText('25', 192, 196); });
    P.clip('scuff', (w, h) => { scratches(g, w, h, 34, 'sc', ['#8f6c12', '#a67f18', '#5c4612', '#c9a53a', '#3a3020'], .8); blotches(g, w, h, 5, 'sc', ['#7a5c12', '#4a3a14'], .5); }); };
  PAINT.sharebike = (P, o) => { const g = P.g, TE = '#0f8f86'; P.plate(o.plate, 'ebike');
    P.word('brand', '青骑 QINGQI', '#f4f4ee', { h: .66 });
    P.clip('qr', (w, h) => { rrp(g, 4, 4, w - 8, h - 8, 16); g.fillStyle = '#f2f2ee'; g.fill(); qrCode(g, 38, 20, 180, 'bike' + o.plate); g.fillStyle = '#151515'; g.font = `900 26px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('扫码骑行 ' + o.plate.slice(-6), w / 2, 226); });
    P.clip('panel', (w, h) => { g.fillStyle = '#10151a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a3a48'; g.lineWidth = 2; for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(0, k * h / 6); g.lineTo(w, k * h / 6); g.stroke(); g.beginPath(); g.moveTo(k * w / 6, 0); g.lineTo(k * w / 6, h); g.stroke(); } });
    P.clip('ad', (w, h) => { g.fillStyle = TE; g.fillRect(0, 0, w, h); g.fillStyle = '#f4f4ee'; g.font = `900 92px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('青骑单车', w / 2, 92); g.fillStyle = '#ffd04a'; g.font = `700 40px ${CJK}`; g.fillText('1.5 元 / 15 分钟 · 扫码即走', w / 2, 190); grain(g, P.L.s.ad[0], P.L.s.ad[1], w, h, 14, 'bikead'); });
    P.clip('lock', (w, h) => { g.fillStyle = '#16181b'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd04a'; g.font = `700 30px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('智能锁 · 请规范停放', w / 2, h / 2); });
    P.clip('scuff', (w, h) => { scratches(g, w, h, 80, 'bk', ['#3a3832', '#8c8a80', '#c8c2ae'], 1.1); blotches(g, w, h, 10, 'bk', ['#5c3519', '#6f4522'], .6); }); };
  PAINT.trike = (P, o) => { const g = P.g, S = P.L.s, crates = o.load === 'crates'; P.plate(o.plate, 'ebike');
    P.word('side', crates ? '新鲜水果 · 现摘现卖' : '高价回收 纸壳 旧家电', '#eeeadc', { h: .7 }); P.word('tail', crates ? '橘子 3 元一斤 · 138-0000-0000' : '上门收购 · 138-0000-0000', '#eeeadc', { h: .6 });
    P.clip('tail', (w, h) => { g.globalCompositeOperation = 'destination-over'; for (let k = 0; k < w / 48; k++) { g.fillStyle = k & 1 ? '#f1efe6' : '#c21a1a'; g.fillRect(k * 48, h - 26, 48, 26); } g.globalCompositeOperation = 'source-over'; });
    const card = (n, seed, fn) => P.clip(n, (w, h) => { g.fillStyle = '#a9824f'; g.fillRect(0, 0, w, h); const r = GT.rng(seed); for (let y = 0; y < h; y += 3) { g.fillStyle = `rgba(${90 + r() * 40 | 0},${60 + r() * 30 | 0},${30 + r() * 20 | 0},.16)`; g.fillRect(0, y, w, 1.5); } fn(w, h, r); blotches(g, w, h, 14, seed, ['rgba(70,48,24,.25)', 'rgba(200,170,120,.2)'], 2.4); grain(g, S[n][0], S[n][1], w, h, 18, seed); });
    card('cardT', 'ct', (w, h, r) => { g.strokeStyle = 'rgba(60,40,20,.7)'; g.lineWidth = 3; g.strokeRect(14, 14, w - 28, h - 28); g.beginPath(); g.moveTo(w * .5, 14); g.lineTo(w * .5, h - 14); g.moveTo(14, h * .32); g.lineTo(w - 14, h * .32); g.stroke(); g.fillStyle = 'rgba(196,170,120,.85)'; g.fillRect(0, h * .56, w, 44); g.fillStyle = 'rgba(40,30,20,.8)'; g.font = `900 64px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('易碎物品', w * .27, h * .18); g.font = `900 52px ${CJK}`; g.fillText('向上 ↑↑', w * .76, h * .18); g.font = `700 34px ${CJK}`; g.fillText('江城鲜果批发 · 20kg', w * .5, h * .82); });
    card('cardS', 'cs', (w, h, r) => { g.fillStyle = 'rgba(50,34,18,.75)'; for (let y = 10; y < h; y += 16 + r() * 22) g.fillRect(0, y, w, 2 + r() * 2.5); g.fillStyle = 'rgba(196,170,120,.8)'; g.fillRect(w * .2, 0, 40, h); g.fillRect(w * .72, 0, 34, h); });
    P.clip('sign', (w, h) => { g.fillStyle = '#e9e2cc'; g.fillRect(0, 0, w, h); g.fillStyle = '#b01c16'; g.font = `900 104px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(w / 2, h * .36); g.rotate(-.04); g.fillText(crates ? '甜过初恋' : '收纸壳', 0, 0); g.restore(); g.fillStyle = '#151515'; g.font = `900 60px ${CJK}`; g.fillText(crates ? '橘子 3 元/斤' : '0.8 元/公斤', w / 2, h * .76); grain(g, S.sign[0], S.sign[1], w, h, 14, 'sign'); });
    P.clip('spd', (w, h) => { g.fillStyle = '#05080a'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffb017'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.font = `700 90px ${LAT}`; g.fillText('18', w / 2, 76); g.font = `700 22px ${LAT}`; g.fillText('km/h   60V', w / 2, 136); });
    P.clip('scuff', (w, h) => { blotches(g, w, h, 30, 'tk', ['#5c3519', '#6f4522', '#3e2513', '#8a5a2b'], 1.1); scratches(g, w, h, 80, 'tk', ['#4b4a45', '#8c8a80', '#5c3519'], 1.3); }); };
  const AT = {};
  function atlas(kind, o) { const key = kind + '|' + (o.patrol ? 'p|' : '') + o.plate + '|' + (o.unit || '') + '|' + (o.route || '') + '|' + (o.load || ''); if (AT[key]) return AT[key]; const L = LAYS[kind] || LAYS.car, c = document.createElement('canvas'); c.width = L.W; c.height = L.H; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(WHITE_UV[0] * L.W - 60, (1 - WHITE_UV[1]) * L.H - 60, 120, 120); PAINT[kind](painter(g, L), o);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; return AT[key] = t; }

  /* ================================================================== shared specs + small builders */
  const BLKP = { paint: [.03, .03, .032], satin: 1 }, GREYP = { paint: [.12, .12, .125], satin: 1 };
  const tintOf = (hex, base) => { const a = lin(hex), b = lin(base); return { paint: [a[0] / max(b[0], .004), a[1] / max(b[1], .004), a[2] / max(b[2], .004)] }; };
  const D_ = (ch, r) => ({ c: [1, 1, 1], r: r === undefined ? .42 : r, m: 0, tex: true, ch: ch || 0 });   // textured decal spec with an optional lamp channel
  const SCUFF = { c: [1, 1, 1], r: .7, m: 0, tex: true }, TAPE = { c: [.3, .31, .32], r: .34, m: .35 }, TAPEB = { c: [.018, .018, .02], r: .5 };
  /** parametric surface: fn(u, v) -> [x, y, z]. o: {face:[dx,dy,dz] the side the surface must face, sym, cx, weld}. ms may be fn(i, j) -> spec. Returns the Grid. */
  function skin(B, ms, nu, nv, fn, o) { o = o || {}; const G = new Grid(nu + 1, nv + 1); for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const p = fn(i / nu, j / nv); G.set(i, j, p[0], p[1], p[2]); }
    const f = o.face || [1, 0, 0]; G.face(o.fi === undefined ? nu >> 1 : o.fi, o.fj === undefined ? nv >> 1 : o.fj, f[0], f[1], f[2]); if (typeof ms === 'function') G.mats(ms); else G.def = ms; G.finish({ cx: !!o.cx, weldV: !!o.weld }); const em = () => { if (o.sym) B.sym(() => G.emit(B)); else G.emit(B); }; em(); if (o.two) { G.flip = !G.flip; G.finish({ cx: !!o.cx, weldV: !!o.weld }); em(); G.flip = !G.flip; G.finish({ cx: !!o.cx, weldV: !!o.weld }); } return G; }
  /** like rect() but the decal's u runs along j (across) and v along i: for skins whose first grid axis is height */
  const rectT = (i0, i1, j0, j1) => (u, v) => [lerp(i0, i1, v), lerp(j0, j1, u)];
  /** coil spring between two points */
  function spring(B, ms, a, b, R, turns, r) { const n = turns * 9, pts = [], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = hyp(d[0], d[1], d[2]), w = [d[0] / l, d[1] / l, d[2] / l], u0 = abs(w[1]) > .9 ? [1, 0, 0] : [0, 1, 0];
    let u = [u0[1] * w[2] - u0[2] * w[1], u0[2] * w[0] - u0[0] * w[2], u0[0] * w[1] - u0[1] * w[0]]; const ul = hyp(u[0], u[1], u[2]); u = [u[0] / ul, u[1] / ul, u[2] / ul]; const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
    for (let k = 0; k <= n; k++) { const t = k / n, an = t * turns * TAU, c = cos(an) * R, s = sin(an) * R; pts.push([a[0] + d[0] * t + u[0] * c + v[0] * s, a[1] + d[1] * t + u[1] * c + v[1] * s, a[2] + d[2] * t + u[2] * c + v[2] * s]); }
    B.tube(ms, pts, r, { seg: 5, steps: n }); }
  /** straight rod between two points */
  function rod(B, ms, a, b, r, seg) { B.tube(ms, [a, b], r, { seg: seg || 6, steps: 1 }); }
  /** two-sided wheel for cycles (revolved about X): round tyre with the shared tread texture, box rim, hub (or hub motor), cast or wire spokes, optional brake disc.
      w: {R, tw (tyre width), th (tyre section height), hubR, hubW, spoke:{n,th,w0,w1,ms}|null, wire:n, disc: radius, discX, rimM, hubM, holes} */
  function cycleWheelGeo(w) { const B = new Builder(); B.white = [.5, .125]; const TY = { c: [1, 1, 1], r: .88, m: 0, tex: true }, seg = w.seg || 36, hw = w.tw / 2, hr = w.th / 2, Rc = w.R - hr, A = 2.2, n = 16, pts = [], iS = 5, iE = n - 5;
    for (let k = 0; k <= n; k++) { const a = lerp(-A, A, k / n); pts.push([hw * sin(a), Rc + hr * cos(a)]); }
    latheX(B, TY, pts.slice(0, iS + 1), seg, (i, a) => [-a * 2, lerp(.262, .49, i / iS)]); latheX(B, TY, pts.slice(iS, iE + 1), seg, (i, a) => [-a * (w.trep || 4), lerp(.99, .51, i / (iE - iS))]); latheX(B, TY, pts.slice(iE), seg, (i, a) => [-a * 2, lerp(.49, .262, i / (n - iE))]);
    const rO = Rc - hr * .42, rI = rO - (w.rimH || .02), w2 = hw * .74, rimM = w.rimM || M.alu, hubM = w.hubM || M.aluS, hx = (w.hubW || .08) / 2, hR = w.hubR || .03;
    latheX(B, rimM, [[-w2, rI], [-w2 - .004, rO - .005], [-w2 + .002, rO + .003], [w2 - .002, rO + .003], [w2 + .004, rO - .005], [w2, rI], [0, rI - .005], [-w2, rI]], seg);
    latheX(B, hubM, [[-hx, .01], [-hx, hR * .72], [-hx * .78, hR], [hx * .78, hR], [hx, hR * .72], [hx, .01]], 20); latheX(B, M.dkm, [[-hx - .02, .001], [-hx - .02, .011], [hx + .02, .011], [hx + .02, .001]], 8);
    if (w.holes) for (const sx of [-1, 1]) for (let k = 0; k < w.holes; k++) { B.push(0, 0, 0, { rx: k / w.holes * TAU }); B.add(M.gap, new T.CylinderGeometry(.007, .007, .004, 8), { x: sx * hw * .93, y: Rc + hr * .05, rz: HP }); B.pop(); }
    const r0 = hR - .005, r1 = rI + .004, len = r1 - r0, sp = w.spoke;
    if (sp) for (let k = 0; k < sp.n; k++) { const g = GT.boxGeo(sp.th, len, sp.w0, sp.bev || .005), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const f = cl((p.getY(i) + len / 2) / len, 0, 1); p.setZ(i, p.getZ(i) * lerp(1, sp.w1 / sp.w0, f) + (sp.sweep || 0) * f * f); } g.computeVertexNormals(); B.push(0, 0, 0, { rx: k / sp.n * TAU }); B.add(sp.ms || M.aluS, g, { y: r0 + len / 2 }); B.pop(); }
    if (w.wire) for (let k = 0; k < w.wire; k++) { const sx = k & 1 ? 1 : -1, l2 = hyp(len, hx * .7); B.push(0, 0, 0, { rx: k / w.wire * TAU }); B.add(M.chr, new T.CylinderGeometry(.0013, .0013, l2, 4), { x: sx * hx * .35, y: r0 + len / 2, rz: sx * Math.atan2(hx * .7, len) }); B.pop(); }
    if (w.disc) { const dx = w.discX, dm = { c: [.62, .63, .65], r: .24, m: 1 }; latheX(B, dm, [[dx - .002, w.disc * .55], [dx - .002, w.disc], [dx + .002, w.disc], [dx + .002, w.disc * .55], [dx - .002, w.disc * .55]], 28);
      for (let k = 0; k < 5; k++) { B.push(0, 0, 0, { rx: k / 5 * TAU }); B.box(M.dkm, .004, w.disc * .56 - hR * .6, .014, dx, (w.disc * .56 + hR * .6) / 2, 0); B.pop(); } for (let k = 0; k < 14; k++) { B.push(0, 0, 0, { rx: k / 14 * TAU }); B.add(M.gap, new T.CylinderGeometry(.005, .005, .0055, 6), { x: dx, y: w.disc * .8, rz: HP }); B.pop(); } }
    const geo = B.bags.detail.build(true); geo.computeBoundingSphere(); return geo; }
  /** Builder -> { paint, detail, std (kit meshes), tris } */
  /** bus glazing: darker and more mirror-like than car glass, so by day the saloon reads as a dim interior behind reflections instead of an empty see-through shell */
  let BUSGL = null; function busGlass() { if (BUSGL) return BUSGL; const m = GT.mat('glass_tint').clone(); m.color = GT.C(0x16211f); if (m.transmission !== undefined) { m.transmission = 0; m.reflectivity = .5; }
    m.transparent = false; m.depthWrite = true; m.opacity = 1; m.roughness = .08; m.envMapIntensity = 1.0;   // opaque smoked glass: any alpha below 1 left the panes invisible in this pipeline, and the bus read as an empty shell
    m.emissive = new T.Color(.9, .84, .66); m.emissiveIntensity = 0; GT.glow(m, new T.Color(1, 1, 1), 0, .2, 'emissiveIntensity');   /* warm and strong enough that a bus beside you at night is a lit bus, not a black wall */   // at night the saloon lights read as softly glowing windows instead
    m.name = 'cn_bus_glass'; return BUSGL = m; }
  /* CAR r1: car glazing: a darker, cleaner tint that lets the cabin (and the driver) show through, a near-mirror surface, and a stronger share of the local reflection probe */
  let CARGL = null; function carGlass() { if (CARGL) return CARGL; const m = GT.mat('glass_tint').clone(); m.color = GT.C(0x1b252b); m.roughness = .015; if (m.transmission !== undefined) m.transmission = .54; if (m.reflectivity !== undefined) m.reflectivity = .9; m.envMapIntensity = 1.5; m.userData.gtProbeK = 1.3; m.name = 'cn_car_glass'; return CARGL = m; }
  function bake(B) { const out = { paint: null, detail: null, std: null, tris: 0 }, k = GT.kit(); let any = false; for (const name in B.bags) { const bag = B.bags[name]; out.tris += bag.I.length / 3; if (name === 'paint' || name === 'detail') { out[name] = bag.build(true); out[name].computeBoundingSphere(); if (B.ghR && B.ghR[name]) out[name].userData.gtGh = B.ghR[name]; if (B.kpR && B.kpR[name]) out[name].userData.gtKeep = B.kpR[name]; } else { k.geo(name === 'glass_bus' ? busGlass() : name === 'glass_tint' ? carGlass() : name, bag.build(false)); any = true; } } if (any) out.std = k.build(); return out; }

  /* ================================================================== car definitions (lofted bodies) */
  const DEFS = {};
  /** amber rear indicators inside the tail lamps + a front plate; shared by every car */
  function cnDress(B, S, fr, o) { o = o || {}; const D = S.d, F = fr.F, R = fr.R;
    for (const sg of [1, -1]) { const tq = mirQ(D.tail, sg), a = o.amber || [.36, .14, .97, .44]; capQuad(B, R, subQ(tq, a[0], a[1], a[2], a[3]), .0078, lens('amber', sg > 0 ? CH.ral : CH.rar), { nu: 5, nv: 2, skirt: .0025, bulge: .002 }); }
    const p = o.plateF; if (p) { capRect(B, F, -.245, p - .088, .245, p + .088, .0015, M.blkM, { nu: 4, nv: 3, skirt: .002 }); capRect(B, F, -.22, p - .07, .22, p + .07, .0045, M.plate, { nu: 4, nv: 3, uv: uvOf('plate'), skirt: .002 }); } }
  /** side decal that reads correctly on both flanks */
  function sideDecal(B, bd, sg, zF, zB, y0, y1, slot, o) { o = o || {}; const fl = sg < 0, z = fl ? [zB, zF] : [zF, zB]; B.patch(bd.G, bd.sMap(z[0], z[1], y0, y1), o.nu || max(3, ceil(abs(zF - zB) / .1)), o.nv || 3, o.lift || .0012, o.ms || M.decal, { uv: o.uv || uvOf(slot), skirt: 0 }); }

  /** decal on the bonnet / roof that reads from the front of the car (letter tops towards the windscreen); w = half width */
  function hoodDecal(B, bd, zFront, zRear, w, uv, o) { o = o || {}; const um = (uv[0] + uv[2]) / 2; B.sym(sg => B.patch(bd.G, (u, v) => { const z = lerp(zFront, zRear, v); return [bd.gi(z), bd.gjT(z, lerp(0, w, u))]; }, o.nu || 4, o.nv || 5, .0012, o.ms || M.decal, { uv: sg > 0 ? [um, uv[1], uv[2], uv[3]] : [um, uv[1], uv[0], uv[3]], skirt: 0 })); }

  function sedanCN(kind) { const cop = kind === 'police', civ = kind === 'sedan', BASE = cop ? 0xf0efe9 : civ ? 0x17171b : 0xd6a318, TEAL = tintOf(0x0f4a3c, BASE), WHT = tintOf(0xf1efe6, BASE), S = {
    L: 4.86, Wd: 1.85, H: cop ? 1.62 : civ ? 1.47 : 1.6, zR: -2.43, zF: 2.43, dz: .045, nS: 14, nT: 13, nH: 5, nR: 4, color: BASE, dust: cop ? [.18, .5, .32, 2.43] : civ ? [.18, .4, .1, 2.43] : [.18, .66, .55, 2.43], eye: [.37, 1.2, -.05], rearAmber: true, fixedColor: !civ, paint: civ ? 'sedan' : undefined, noRoof: civ,
    W: K([[-2.43, .845], [-2.05, .905], [-1.36, .925], [0, .925], [1.44, .922], [2.0, .9], [2.43, .85]]),
    yb: K([[-2.43, .34], [-1.9, .27], [-1.0, .2], [1.0, .2], [1.95, .215], [2.43, .25]]), yW: K([[-2.43, .72], [0, .65], [2.43, .6]]),
    ySh: K([[-2.43, .96], [-2.1, .995], [-1.5, 1.0], [-.5, .975], [.95, .935], [1.44, .875], [2.0, .81], [2.43, .74]]),
    yC: K([[-2.43, 1.0], [-2.25, 1.035], [-1.75, 1.05], [-.5, 1.03], [.95, .985], [1.44, .93], [2.0, .865], [2.43, .785]]),
    tum: K([[-2.43, .055], [0, .05], [2.43, .04]]), rS: K([[-2.43, .07], [-1.0, .04], [.6, .04], [1.44, .07], [2.43, .08]]), rSy: K(.03), p: K(2.3),
    rr: .06, rrx: .05, aLow: .04, eL: 1.7, eU: 1.35, xi: .52,
    arches: [{ z: 1.44, y: .33, R: .385, flare: .008, fw: .05 }, { z: -1.36, y: .33, R: .385, flare: .008, fw: .05 }],
    front: { r: .05, bowX: .2, bowY: .04, y0: .52, hy: .3, start: 1.86 }, rear: { r: .045, bowX: .13, bowY: .03, y0: .65, hy: .35, start: -1.78 },
    wheel: cop || civ ? { R: .33, w: .215, rim: .225, disc: .16, hub: .06, cap: .028, dish: .03, lugs: 5, seg: 32, lip: M.alu, face: M.aluS, capM: M.dkm, lugM: M.dkm, spoke: { n: 5, twin: .21, th: .026, w0: .034, w1: .028, rise: .01, bev: .006 } }
      : { R: .33, w: .205, rim: .215, disc: .15, hub: .07, cap: .05, dish: .04, lugs: 5, seg: 32, lip: { c: [.5, .5, .5], r: .5, m: .9 }, face: { c: [.42, .42, .43], r: .55, m: .85 }, capM: M.dkm, holes: 12 },
    wheels: { fz: 1.44, rz: -1.36, fx: .8, rx: .8 },
    interior: { z0: -1.4, z1: .82, floor: .3, dash: .93, seatZ: .02, rearZ: -.85, shelf: [-1.5, -1.2], shelfY: .98, seat: cop || civ ? M.seat : { c: [.62, .62, .58], r: .92 } },
    under: { y: .19, exh: [.8, -2.2], tipX: .5, tipY: .27, axle: -1.36, axleY: .33, tank: [-1.9, -1.5], tankY: .3, front: 1.44 },
    gh: { keys: [[0, .98, .2], [.42, -.1, -.1], [.8, -1.1, -.84], [1, -1.72, -1.04]], win: [[.045, .405], [.435, .8]], black: [[.405, .435]], sub: 30, nSide: 8, nH: 4, nT: 7, nk: 18,
      Wb: K([[0, .79], [.42, .825], [1, .76]]), tum: K([[0, .13], [.5, .15], [1, .17]]), yR: K([[0, 1.415], [.3, 1.455], [.6, 1.458], [1, 1.4]]), drop: .05, rG: .09, rGy: .036, rc: .05, sill: .035, rail: .085, barrel: .012, wsBulge: .09, blBulge: .06, reveal: M.blkS },
    d: { doors: [.86, -.1, -1.04], kick: .74, kickZ: .14, sillY: .27, handles: [-.02, -.92], handleY: .86, handleMs: M.blkS, mirror: [.84, .07], mirrorMs: BLKP, hood: [.7, .93, 2.04], trunk: [.68, -1.76, -2.3], marker: [2.08, .5], bumpF: 1.86, bumpR: -1.8,
      grille: { x: .36, y0: .6, y1: .7, bars: 4, chrome: !cop, badge: true }, intake: { x: .5, y0: .31, y1: .385 }, head: [[.41, .59], [.835, .6], [.835, .72], [.41, .695]], fog: [.7, .36, .05, .026],
      tail: [[.4, .81], [.86, .79], [.86, .915], [.4, .915]], tailSeg: [[.36, .56, .97, .86]], rev: [.05, .2, .3, .8], refl: [.68, .5], plate: .63, valance: { x: .62, y0: .395, y1: .47, tip: -.45 }, lid: { x: .66, y0: .74, y1: 1.2 }, badge: cop ? null : [-.28, .735, .3, .05], badge2: cop ? null : [.56, .735, .1, .045] } };
    S.cut = (z, x) => z > -1.5 && z < .84 && x < S.gh.Wb(sAtZ(S.gh, z)) - .035;
    if (cop) { const BLKP2 = tintOf(0x0b0b0d, BASE); S.paint = 'police'; S.mat = (i, j, zc, bd) => j < 5 ? M.blkM : (zc > .93 || zc < -1.06 ? BLKP2 : 'paint'); }   /* g6: black-and-white — black wings, bonnet and boot, white doors and roof */
    else if (civ) S.mat = (i, j, zc, bd) => j < 5 ? M.blkM : 'paint';   /* patrol car: the band is a slanted decal now (it was a level waist stripe) */
    else S.mat = (i, j, zc, bd) => j < 5 ? M.blkM : (j < bd.JR + 5 ? TEAL : (j < bd.JR + 8 && zc < 1.86 && zc > -1.8 ? WHT : 'paint'));   /* three blocks: yellow roof and bonnet, a white waist that takes the colour of the street at night, green sills */
    S.build = B => { const bd = makeBody(B, S), G = bd.G; for (const a of S.arches) archParts(B, bd, a, cop || civ ? 'paint' : TEAL); const gh = makeGreenhouse(B, S, bd); interior(B, S, bd, gh); underbody(B, S); flanks(B, S, bd, gh);
      const fr = fascias(B, S, bd, null); cnDress(B, S, fr, { plateF: .47 }); const ghR0 = ghSnap(B); B.box('paint', .05, .035, .17, 0, gh.g.yR(.8) - .012, -.86, { bevel: .014, rx: .12 });
      { const a = gh.capR.at(gh.nSd - 1.6, gh.capR.nk / 2); B.box(lens('redDk', CH.stop), .26, .016, .02, 0, a[1] - .01, a[2] + .03, { bevel: .004 }); } ghMark(B, ghR0);   /* CAR r1: the roof fin and the high stop lamp ride on the greenhouse, so an open-top car loses them with its roof (they floated in mid air over the rear seats) */
      const yr = gh.g.yR(.42), zr = gh.kz(.42)[1], I = S.interior;
      // wear: scratch decals on the corners and doors
      B.sym(sg => { sideDecal(B, bd, sg, 2.25, 1.85, .34, .62, 'K', { ms: SCUFF, uv: uvSub('K', 0, 0, .5, 1) }); sideDecal(B, bd, sg, -1.85, -2.3, .4, .7, 'K', { ms: SCUFF, uv: uvSub('K', .5, 0, 1, 1) }); sideDecal(B, bd, sg, .2, -.5, .32, .5, 'K', { ms: SCUFF, uv: uvSub('K', .2, .3, .9, .8) }); });
      if (cop) {
        // roof light bar: red on the left, blue on the right, white take-downs
        B.push(0, yr + .012, zr); for (const sx of [-1, 1]) { B.box(M.blkS, .09, .05, .2, sx * .4, .02, 0, { bevel: .012 }); B.box(M.blkS, .16, .014, .26, sx * .4, 0, 0, { bevel: .005 }); }
        B.box(M.blkS, 1.16, .022, .27, 0, .058, 0, { bevel: .009 }); B.box(M.blkS, 1.16, .016, .27, 0, .126, 0, { bevel: .007 }); B.box(M.blkS, .1, .06, .25, 0, .092, 0, { bevel: .008 });
        for (const sx of [-1, 1]) { const col = sx > 0 ? 'red' : 'blue', ch = sx > 0 ? CH.sirR : CH.sirB; B.box(lens(col, ch), .5, .054, .285, sx * .31, .092, 0, { bevel: .02 }); for (let k = 0; k < 4; k++) { B.box(M.chr, .09, .03, .01, sx * (.12 + k * .12), .092, .13); B.box(M.chr, .09, .03, .01, sx * (.12 + k * .12), .092, -.13); } B.box(lens('white', CH.white), .03, .04, .12, sx * .578, .092, 0, { bevel: .008 }); }
        B.box(M.blkS, .5, .07, .05, 0, .2, 0, { bevel: .012 }); B.decal(D_(CH.led, .3), .46, .05, 0, .2, .0256, uvOf('H')); B.decal(D_(CH.led, .3), .46, .05, 0, .2, -.0256, uvOf('H'), { ry: PI }); B.box(M.blkS, .03, .06, .03, .2, .15, 0); B.box(M.blkS, .03, .06, .03, -.2, .15, 0); B.pop();
        for (const p of [[.45, -1.95, .5], [0, -.6, .1]]) { const y = p[1] < -1.7 ? bd.ty(p[1], abs(p[0])) : gh.g.yR(.7); B.cyl(M.blkS, .014, .02, .025, p[0], y + .01, p[1], { seg: 8 }); B.cyl(M.blkS, .0025, .0035, p[2], p[0], y + .02 + p[2] / 2, p[1], { seg: 5 }); }
        // livery: police on the doors above the blue band, shield on the rear door, chequer strip, roof number, police on the boot
        B.sym(sg => { sideDecal(B, bd, sg, 1.98, -1.98, .36, .92, 'L', { nu: 28, nv: 6, lift: .0009, uv: uvOf('L', sg < 0) }); sideDecal(B, bd, sg, .62, -.34, .74, .9, 'D'); sideDecal(B, bd, sg, -.5, -.74, .7, .93, 'A', { nu: 5, nv: 5 });   /* the band runs down from the front wing to the rear sill, a thin yellow line on its upper edge */
          const u = uvOf('F'); B.patch(gh.G, (a, b) => [gh.si(lerp(.56, .8, b)), gh.JH + lerp(gh.JT - gh.JH, gh.JT - gh.JH - 4.4, a)], 4, 5, .0012, M.decal, { uv: sg < 0 ? [(u[0] + u[2]) / 2, u[1], u[2], u[3]] : [(u[0] + u[2]) / 2, u[1], u[0], u[3]], skirt: 0 }); });
        capRect(B, fr.R, .34, .715, -.34, .775, .0012, M.decal, { nu: 8, nv: 2, uv: uvOf('B'), skirt: 0 });
        hoodDecal(B, bd, 1.9, 1.5, .5, uvSub('D', 0, 0, .6, 1));
      } else if (civ) {
        B.sym(() => { B.line(G, bd.sLine(1.84, -1.8, .53), .014, .0014, M.chr, { h: .003 }); });   /* a bright rub strip is all the dress a private saloon gets */
      } else {
        // roof light box (lit when free), 空车 LED behind the windscreen, meter on the dash, door decals with the hotline, chequer strip
        /* roof light box: wide and low with rounded ends, a small status screen on the front and a dot-matrix advert on the back; at night the brightest thing on the car */
        B.push(0, yr + .008, zr + .1); for (const sx of [-1, 1]) B.box(M.blkS, .12, .03, .2, sx * .28, .012, 0, { bevel: .008 }); B.box({ c: [.86, .9, .9], r: .28, ch: CH.taxi }, .84, .13, .21, 0, .092, 0, { bevel: .05 });
        B.decal(D_(CH.taxi, .3), .32, .095, -.1, .094, .1056, uvOf('F')); B.box(M.blkS, .2, .09, .012, .25, .094, .1, { bevel: .004 }); B.decal(D_(CH.taxi, .3), .18, .068, .25, .094, .1066, uvOf('H'));
        B.box(M.blkS, .66, .1, .012, 0, .094, -.1, { bevel: .004 }); B.decal(D_(CH.led, .3), .64, .084, 0, .094, -.1066, uvOf('L'), { ry: PI }); B.cyl(M.blkS, .004, .004, .3, .1, .2, -.02, { seg: 5, rx: -.3 }); B.pop();
        B.box(M.blkS, .17, .06, .03, -.3, I.dash + .045, I.z1 - .06, { bevel: .008 }); B.decal(D_(CH.taxi, .3), .15, .045, -.3, I.dash + .045, I.z1 - .044, uvOf('H')); B.decal(D_(CH.taxi, .3), .15, .045, -.3, I.dash + .045, I.z1 - .076, uvOf('H'), { ry: PI });
        B.box(M.blkS, .15, .07, .06, 0, I.dash + .02, I.z1 - .24, { bevel: .01, rx: .3 }); B.decal(D_(CH.scr, .3), .13, .045, 0, I.dash + .028, I.z1 - .274, uvOf('I'), { ry: PI, rx: -.3 });
        for (const sx of [-1, 1]) { B.box({ c: [.42, .42, .4], r: .9 }, .26, .2, .03, sx * .37, I.floor + .86, I.seatZ - .44, { bevel: .012, rx: -.2 }); }                              // white head-rest covers
        B.box({ c: [.5, .52, .55], r: .2, m: .3 }, .03, .5, .9, .02, I.floor + .62, I.seatZ - .3, { bevel: .004 }); B.box({ c: [.25, .26, .27], r: .4, m: .8 }, .04, .04, .9, .02, I.floor + .88, I.seatZ - .3);          // driver's partition
        B.sym(sg => { sideDecal(B, bd, sg, .56, -.3, .66, .84, 'D'); sideDecal(B, bd, sg, -.2, -.98, .56, .65, 'E', { nv: 2 }); sideDecal(B, bd, sg, 1.86, -1.84, .51, .545, 'G', { nv: 1, uv: uvSub('G', 0, 0, 1, .25) }); sideDecal(B, bd, sg, 1.3, 1.08, .62, .84, 'A', { nu: 5, nv: 5 }); });
      } };   /* no roundel on the bonnet: the company name lives on the doors */
    return S; }
  DEFS.taxi = () => sedanCN('taxi'); DEFS.police = () => sedanCN('police'); DEFS['taxi:sedan'] = () => sedanCN('sedan'); DEFS.sedan = () => { const S = sedanCN('sedan'); S.fixedColor = false; return S; };
  /* ---- g6: more body styles for an American street, each a base loft pushed through a warp (see warpGeo) plus its own dress. Coordinates below are the base saloon's: deck at y 1.04, roof 1.455, glass base z .98 … -1.72. */
  const ss01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const wheelX = (w, k) => { const o = Object.assign({}, w); for (const n of ['R', 'w', 'rim', 'disc', 'hub', 'cap', 'dish']) if (o[n]) o[n] *= k; if (o.spoke) o.spoke = Object.assign({}, o.spoke, { th: o.spoke.th * k, w0: o.spoke.w0 * k, w1: o.spoke.w1 * k }); return o; };
  function derive(base, o) { const S = base, bld = S.build; S.warp = o.warp; if (o.H) S.H = o.H; if (o.L) S.L = o.L; if (o.Wd) S.Wd = o.Wd; if (o.eye) S.eye = o.eye; if (o.color !== undefined) S.color = o.color; if (o.wheelK) S.wheel = wheelX(S.wheel, o.wheelK);
    if (o.wz) S.wheels = Object.assign({}, S.wheels, { fz: S.wheels.fz * o.wz, rz: S.wheels.rz * o.wz }); if (o.wx) S.wheels = Object.assign({}, S.wheels, { fx: S.wheels.fx * o.wx, rx: S.wheels.rx * o.wx }); if (o.rear) S.wheels = Object.assign({}, S.wheels, { rear: o.rear });
    if (o.seatUp) S.seatAt = [.37, S.interior.floor + .25 + o.seatUp, S.interior.seatZ + (o.seatBack || 0)]; if (o.doors) S.d.doors = o.doors; if (o.extra) S.build = B => { bld(B); o.extra(B, S); }; S.fixedColor = !!o.fixed; if (o.siren) S.siren = true; return S; }
  const BLKG = { c: [.012, .012, .014], r: .3 }, WHTB = { c: [.86, .86, .83], r: .5 }, REDB = { c: [.55, .03, .03], r: .4 }, ORB = { c: [.85, .32, .04], r: .45 };
  /* SUV: taller sills and belt, a longer upright cabin carried to the tail, bigger wheels */
  const suvWarp = (x, y, z) => { const w = ss01(1.03, 1.1, y); let y1 = y > .6 ? .6 + (y - .6) * 1.15 : y; if (y1 > 1.09) y1 += (y1 - 1.09) * .2; if (z < -.2) z = z + w * (z + .2) * .44; if (z < -2.4) z = -2.4 - (z + 2.4) * .0; return [x * (y > .5 ? 1.03 : 1), y1 + .1, max(z, -2.46)]; };
  DEFS.suv = () => derive(sedanCN('sedan'), { warp: suvWarp, H: 1.8, Wd: 1.9, eye: [.37, 1.48, -.05], wheelK: 1.15, seatUp: .2, color: 0x2a3a4a,
    extra: B => { B.sym(() => { B.box(M.blkS, .04, .03, 1.9, .62, 1.49, -.55, { bevel: .01 }); for (const z of [.2, -1.3]) B.box(M.blkS, .04, .05, .05, .62, 1.47, z, { bevel: .01 }); }); B.box(M.blkS, 1.5, .1, .06, 0, .42, 2.44, { bevel: .02 }); } });   /* roof rails and a bull bar */
  DEFS.copsuv = () => derive(sedanCN('police'), { warp: suvWarp, H: 1.9, Wd: 1.9, eye: [.37, 1.48, -.05], wheelK: 1.15, seatUp: .2, fixed: true, siren: true, extra: B => { B.box(M.blkS, 1.6, .22, .08, 0, .5, 2.46, { bevel: .03 }); for (const sx of [-1, 1]) B.box(M.blkS, .06, .34, .08, sx * .5, .62, 2.47, { bevel: .02 }); } });   /* push bar */
  /* hatchback: the cabin runs to a chopped tail, the whole car shorter and narrower */
  const hatchWarp = (x, y, z) => { const w = ss01(1.03, 1.1, y); if (z < -.2) z = z + w * (z + .2) * .36; if (z < -1.75) z = -1.75 + (z + 1.75) * .4; return [x * .95, y, z * .9]; };
  DEFS.hatch = () => derive(sedanCN('sedan'), { warp: hatchWarp, L: 3.95, Wd: 1.76, wz: .9, wx: .95, wheelK: .93, color: 0x9a2a22 });
  /* pickup: a short upright cab, a covered bed, raised on taller tyres */
  const pickWarp = (x, y, z) => { const w = ss01(1.03, 1.1, y); let y1 = y > .6 ? .6 + (y - .6) * 1.12 : y; if (z < -.15) z = z - w * (z + .15) * .7; return [x * (y > .5 ? 1.04 : 1), y1 + .14, z * 1.06]; };
  DEFS.pickup = () => derive(sedanCN('sedan'), { warp: pickWarp, H: 1.78, L: 5.15, Wd: 1.92, wz: 1.06, eye: [.37, 1.48, -.05], wheelK: 1.2, seatUp: .2, color: 0x8a8f96,
    extra: B => { B.box(M.vinyl, 1.52, .05, 1.82, 0, 1.0, -1.5, { bevel: .015 }); B.sym(() => { B.box(M.blkS, .05, .05, 1.86, .8, 1.02, -1.5, { bevel: .012 }); }); B.box(M.blkS, 1.6, .05, .05, 0, 1.02, -2.4, { bevel: .012 }); B.box(M.chr, 1.7, .12, .1, 0, .46, -2.46, { bevel: .03 }); } });   /* tonneau cover, bed rails, cab back, step bumper */
  /* muscle coupé: long bonnet, low fastback roof, two doors, fat rear tyres */
  const musWarp = (x, y, z) => { const w = ss01(1.03, 1.1, y); if (y > 1.0) y = 1.0 + (y - 1.0) * .8; z -= w * .22; if (z < -.6) z = z + w * (z + .6) * .22; return [x * 1.04, y - .03, max(z, -2.46)]; };
  DEFS.muscle = () => derive(sedanCN('sedan'), { warp: musWarp, H: 1.34, Wd: 1.93, eye: [.37, 1.08, -.3], doors: [.86, null, -1.04], rear: [1.1, 1.08], wx: 1.04, seatBack: -.22, color: 0xc4541a,
    extra: B => { B.box('paint', .5, .06, .7, 0, .985, 1.45, { bevel: .025 }); B.box(M.blkM, .44, .035, .02, 0, .985, 1.8); B.box('paint', 1.5, .03, .16, 0, 1.12, -2.3, { bevel: .012 }); B.sym(() => B.box('paint', .04, .1, .12, .62, 1.07, -2.3, { bevel: .01 })); B.sym(() => B.box(M.blkM, .26, .012, 3.6, .3, 1.0, 0)); } });   /* bonnet scoop, boot spoiler, twin stripes */


  function vanCN(vr) { const riot = vr === 'riot', arm = vr === 'armoured', dents = [[-.5, .64, .2, -.034], [-1.58, .74, .16, -.04], [.45, .5, .12, -.018], [-1.0, .9, .1, -.016], [-.2, .42, .14, -.02]], MIS = { paint: [.84, .86, .8] }, S = {
    L: 3.82, Wd: 1.52, H: 1.9, zR: -1.9, zF: 1.92, dz: .04, nS: 16, nT: 10, nH: 4, nR: 4, color: 0xe2e0d8, dust: [.25, 1.0, .85, 1.92], eye: [.34, 1.5, .62], rearAmber: true,
    W: K([[-1.9, .71], [-1.6, .745], [0, .75], [1.4, .745], [1.75, .72], [1.92, .66]]),
    yb: K([[-1.9, .36], [-1.4, .27], [-.6, .24], [.8, .24], [1.6, .28], [1.92, .34]]), yW: K(.62),
    ySh: K([[-1.9, 1.0], [1.3, 1.0], [1.55, .97], [1.78, .9], [1.92, .82]]), yC: K([[-1.9, 1.03], [1.3, 1.03], [1.55, 1.0], [1.78, .94], [1.92, .86]]),
    tum: K(.03), rS: K([[-1.9, .035], [1.3, .035], [1.6, .06], [1.92, .08]]), rSy: K(.025), p: K(2.6), rr: .05, rrx: .04, aLow: .03, eL: 1.7, eU: 1.3, xi: .5,
    arches: [{ z: 1.32, y: .3, R: .33, flare: .012, fw: .05 }, { z: -1.18, y: .3, R: .33, flare: .012, fw: .05 }],
    front: { r: .06, bowX: .12, bowY: .03, y0: .6, hy: .3, start: 1.66 }, rear: { r: .04, bowX: .04, bowY: .01, y0: .7, hy: .4, start: -1.72 },
    wheel: { R: .285, w: .165, rim: .175, disc: .12, hub: .05, cap: .032, dish: .03, lugs: 4, seg: 28, lip: { c: [.4, .4, .4], r: .6, m: .9 }, face: { c: [.33, .33, .34], r: .62, m: .85 }, capM: M.dkm, holes: 8 },
    wheels: { fz: 1.32, rz: -1.18, fx: .655, rx: .655 },
    interior: { z0: -1.75, z1: 1.3, floor: .36, dash: .97, seatZ: .74, rearZ: -.3, seat: { c: [.16, .15, .14], r: .9 } },
    under: { y: .24, exh: [.6, -1.8], tipX: .4, tipY: .3, axle: -1.18, axleY: .3, front: 1.32 },
    gh: { keys: [[0, 1.5, 1.0], [.15, 1.0, 1.0], [1, -1.84, -1.77]], win: [[.035, .125], [.165, .41], [.45, .715], [.755, .96]], black: [[.125, .165], [.41, .45], [.715, .755]], sub: 26, nSide: 8, nH: 4, nT: 7, nk: 18,
      Wb: K([[0, .69], [.15, .715], [1, .715]]), tum: K([[0, .07], [.15, .055], [1, .055]]), yR: K([[0, 1.83], [.15, 1.87], [.6, 1.88], [1, 1.86]]), drop: .045, rG: .07, rGy: .03, rc: .045, rcR: .035, sill: .03, rail: .07, barrel: .008, wsBulge: .06, blBulge: .02, reveal: M.blkS },
    d: { doors: [.95, .06, -.94], kick: .66, kickZ: .15, sillY: .3, handles: [.16, -.84], handleY: .9, handleMs: M.blkS, mirror: [1.12, .13], mirrorMs: BLKP, mirrorS: 1.15, hood: [.6, 1.56, 1.82], marker: [1.72, .64], bumpF: 1.66, bumpR: -1.72,
      grille: { x: .3, y0: .665, y1: .715, bars: 2, chrome: false, badge: true }, intake: { x: .42, y0: .37, y1: .44 }, head: [[.36, .62], [.68, .63], [.68, .78], [.36, .76]], proj: [[.15, .62]],
      tail: [[.52, .6], [.7, .6], [.7, .96], [.52, .96]], tailSeg: [[.12, .5, .88, .92]], rev: [.12, .06, .88, .2], refl: [.56, .44], plate: .74, valance: { x: .5, y0: .37, y1: .43, tip: 0 }, lid: { x: .5, y0: .5, y1: .99 }, badge: [.46, .9, .22, .05], badge2: [-.3, .9, .12, .045], wrap: 2 } };
    S.sideFx = (z, y) => { let f = 0; for (const d of dents) { const e = ((z - d[0]) * (z - d[0]) + (y - d[1]) * (y - d[1])) / (d[2] * d[2]); if (e < 6) f += d[3] * Math.exp(-e); } return f; };
    S.cut = (z, x) => z > -1.82 && z < 1.48 && x < S.gh.Wb(sAtZ(S.gh, z)) - .035;
    S.mat = (i, j, zc, bd) => j < 5 ? M.blkM : ((zc > 1.66 || zc < -1.72) && j < bd.JR + 7 ? GREYP : (zc < .06 && zc > -.94 && j >= bd.JR && j < bd.JS ? MIS : 'paint'));
    S.build = B => { const bd = makeBody(B, S), G = bd.G, gi = bd.gi; for (const a of S.arches) archParts(B, bd, a, GREYP); const gh = makeGreenhouse(B, S, bd); interior(B, S, bd, gh); underbody(B, S); flanks(B, S, bd, gh);
      const fr = fascias(B, S, bd, null); cnDress(B, S, fr, { plateF: .53, amber: [.12, .24, .88, .46] });
      if (S.dress) { S.dress(B, bd, gh, fr); return; }
      // sliding-door rail, fuel flap, hand-painted advert, stickers, rust and scrapes
      B.sym(sg => { B.line(G, bd.sLine(-.96, -1.74, .93), .014, .0006, M.gap); B.line(G, bd.sLine(.04, -.92, .31), .012, .0006, M.gap);
        sideDecal(B, bd, sg, -.02, -.9, .52, .68, 'D', { ms: { c: [1, 1, 1], r: .8, tex: true } }); sideDecal(B, bd, sg, -.12, -.8, .39, .5, 'E', { ms: { c: [1, 1, 1], r: .8, tex: true }, nv: 2 });
        sideDecal(B, bd, sg, 1.86, 1.0, .34, .7, 'K', { ms: SCUFF, uv: uvSub('K', 0, 0, .6, 1) }); sideDecal(B, bd, sg, -.98, -1.86, .34, .96, 'K', { ms: SCUFF, nv: 5 }); sideDecal(B, bd, sg, -.2, -.9, .3, .46, 'K', { ms: SCUFF, uv: uvSub('K', .3, .5, 1, 1) });
        if (sg > 0) B.patch(G, bd.sMap(-1.4, -1.56, .76, .9), 3, 3, .0015, GREYP, { skirt: .002 }); });
      capRect(B, fr.R, .46, .5, .2, .6, .0012, M.decal, { nu: 4, nv: 2, uv: uvSub('J', 0, .22, 1, .78), skirt: 0 }); capRect(B, fr.R, .5, .52, -.5, .98, .001, SCUFF, { nu: 8, nv: 4, uv: uvOf('K'), skirt: 0 });
      { const WS = gh.capF, a = WS.at(2.2, WS.nk - 2.6); B.decal(M.decal, .2, .2, a[0] + .1, a[1] + .1, a[2] + .012, uvOf('A'), { rx: -.5 }); }
      // roof rack with a rolled tarp, a ladder and a spare crate; rear wiper; mud flaps; rope
      const yr = 1.89, rk = M.dkm; for (const sx of [-1, 1]) { rod(B, rk, [sx * .6, yr + .09, 1.0], [sx * .6, yr + .09, -1.6], .011); for (const z of [.9, .1, -.7, -1.5]) rod(B, rk, [sx * .62, yr - .03, z], [sx * .6, yr + .09, z], .01); }
      for (const z of [1.0, .35, -.3, -.95, -1.6]) rod(B, rk, [-.6, yr + .09, z], [.6, yr + .09, z], .009);
      B.cyl({ c: [.1, .2, .36], r: .85 }, .1, .1, 1.5, -.3, yr + .2, -.3, { rx: HP, seg: 12 }); for (const z of [.2, -.8]) B.cyl({ c: [.5, .45, .3], r: .9 }, .104, .104, .02, -.3, yr + .2, z, { rx: HP, seg: 12 });
      for (const sx of [.12, .46]) rod(B, M.alu, [sx, yr + .115, .9], [sx, yr + .115, -1.5], .012); for (let k = 0; k < 8; k++) rod(B, M.alu, [.12, yr + .115, .8 - k * .3], [.46, yr + .115, .8 - k * .3], .008);
      B.sym(() => { for (const z of [1.32 - .36, -1.18 - .36]) B.box(M.rubber, .2, .2, .012, .64, .27, z, { rx: .12, bevel: .003 }); }); };
    if (vr) { const DG = tintOf(0x2b3138, riot ? 0xe4e7ea : 0x2a333c), ARMP = { paint: [1, 1, 1], satin: 1 };
      S.color = riot ? 0xe4e7ea : 0x2a333c; S.fixedColor = true; S.paint = vr; S.siren = true; S.dust = [.25, .9, riot ? .4 : .3, 1.92]; S.sideFx = undefined; S.H = arm ? 2.06 : 2.1;
      S.wheel = { R: arm ? .31 : .285, w: arm ? .2 : .165, rim: arm ? .19 : .175, disc: .12, hub: .06, cap: .032, dish: .045, lugs: 5, seg: 28, lip: { c: [.05, .05, .055], r: .55, m: .8 }, face: { c: [.04, .04, .045], r: .6, m: .8 }, capM: M.dkm, holes: 6 };
      S.mat = (i, j, zc, bd) => j < 5 ? M.blkM : arm ? ARMP : (j < bd.JR + 5 ? DG : 'paint');
      S.dress = (B, bd, gh, fr) => vanPatrol(B, S, bd, gh, fr, riot); }
    return S; }
  /** SWAT dress for the van body. riot: the white roadblock truck (wire guards over every window, loud-hailers, push bar). armoured: slate plate over the side glass with vision slits, a visor over the screen, roof hatch, ram. */
  function vanPatrol(B, S, bd, gh, fr, riot) { const G = bd.G, STEEL = { c: [.05, .055, .06], r: .55, m: .7 }, PLATE = riot ? { c: lin(0xd9dde0), r: .5, m: .1 } : { c: lin(0x46515c), r: .58, m: .3 }, REDL = { c: lin(0xc8161c), r: .4 }, yr = 1.885, rx = -.57;
    B.sym(sg => { B.line(G, bd.sLine(-.96, -1.74, .93), .014, .0006, M.gap); B.line(G, bd.sLine(1.62, -1.7, riot ? .5 : .56), .02, .0014, REDL);
      sideDecal(B, bd, sg, -.04, -.9, .68, .9, 'D'); sideDecal(B, bd, sg, .86, .26, .6, .9, 'A', { nu: 5, nv: 5 }); sideDecal(B, bd, sg, -1.02, -1.7, .7, .8, 'E', { nv: 2 }); sideDecal(B, bd, sg, 1.86, 1.0, .34, .7, 'K', { ms: SCUFF, uv: uvSub('K', 0, 0, .6, 1) }); sideDecal(B, bd, sg, -.98, -1.86, .34, .96, 'K', { ms: SCUFF, nv: 5 }); });
    /* roof: a flat wide bar (red left, blue right), LED name board, number, aerials */
    B.push(0, yr, .62); for (const sx of [-1, 1]) B.box(M.blkS, .1, .05, .22, sx * .46, .025, 0, { bevel: .012 }); B.box(M.blkS, 1.3, .02, .3, 0, .058, 0, { bevel: .008 });
    for (const sx of [-1, 1]) { B.box(lens(sx > 0 ? 'red' : 'blue', sx > 0 ? CH.sirR : CH.sirB), .54, .07, .3, sx * .36, .1, 0, { bevel: .025 }); B.box(lens('white', CH.white), .04, .05, .14, sx * .655, .1, 0, { bevel: .008 }); }
    B.box(M.blkS, .16, .08, .28, 0, .1, 0, { bevel: .01 }); B.box(M.blkS, 1.3, .016, .3, 0, .142, 0, { bevel: .006 }); B.box(M.blkS, .62, .1, .05, 0, .2, 0, { bevel: .012 }); B.decal(D_(CH.led, .3), .58, .075, 0, .2, .0256, uvOf('H')); B.decal(D_(CH.led, .3), .58, .075, 0, .2, -.0256, uvOf('H'), { ry: PI }); B.pop();
    B.decal(M.decal, .7, .35, 0, yr + .008, -1.0, uvOf('F'), { rx: -HP }); for (const p of [[.5, -1.6, .7], [-.5, -1.6, .45]]) { B.cyl(M.blkS, .016, .022, .03, p[0], yr, p[1], { seg: 8 }); B.cyl(M.blkS, .003, .004, p[2], p[0], yr + p[2] / 2, p[1], { seg: 5 }); }
    capRect(B, fr.R, .46, .5, -.46, .62, .0012, M.decal, { nu: 8, nv: 2, uv: uvOf('D'), skirt: 0 }); B.box(STEEL, 1.36, .05, .2, 0, .36, -1.98, { bevel: .012 });
    const wsP = (x, t, o) => [x, 1.06 + .78 * t + .54 * o, 1.5 - .5 * t + .842 * o];   /* a point on (o metres off) the windscreen plane */
    if (riot) {
      /* wire guards: side glass and windscreen behind a welded mesh in a tube frame */
      B.sym(() => { const x0 = .756, x1 = .708, y0 = 1.09, y1 = 1.79, zA = .92, zB = -1.74; for (let k = 0; k <= 6; k++) { const t = k / 6, x = lerp(x0, x1, t), y = lerp(y0, y1, t); rod(B, STEEL, [x, y, zA], [x, y, zB], k % 6 ? .004 : .011, 4); } for (let k = 0; k <= 22; k++) { const z = lerp(zA, zB, k / 22); rod(B, STEEL, [x0, y0, z], [x1, y1, z], k % 22 ? .004 : .011, 4); }
        for (const z of [.5, -.4, -1.3]) rod(B, STEEL, [x0, y0, z], [x0 - .04, y0 - .02, z], .008, 4); });
      for (let k = 0; k <= 5; k++) { const t = k / 5, hw = lerp(.63, .58, t); rod(B, STEEL, wsP(-hw, t, .05), wsP(hw, t, .05), k % 5 ? .004 : .011, 4); } for (let k = 0; k <= 10; k++) { const u = k / 10 * 2 - 1; rod(B, STEEL, wsP(u * .63, 0, .05), wsP(u * .58, 1, .05), k % 10 ? .004 : .011, 4); }
      for (const sx of [-1, 1]) { rod(B, STEEL, wsP(sx * .58, 1, .05), [sx * .56, yr - .01, .9], .009, 4); B.push(sx * .3, yr + .1, .18); B.cyl({ c: [.5, .52, .54], r: .5, m: .3 }, .1, .035, .2, 0, 0, 0, { rx: HP, seg: 14, open: true }); B.cyl(M.blkS, .035, .035, .08, 0, 0, -.12, { rx: HP, seg: 8 }); B.box(M.blkS, .03, .09, .03, 0, -.055, -.08); B.pop(); }
      /* push bar */
      B.sym(() => { B.tube(STEEL, [[0, .8, 2.02], [.3, .8, 2.02], [.52, .77, 1.98], [.58, .6, 1.96], [.58, .36, 1.92]], .022, { seg: 6 }); rod(B, STEEL, [.3, .8, 2.02], [.3, .38, 2.0], .018, 6); B.box(STEEL, .05, .1, .16, .58, .4, 1.86, { bevel: .01 }); }); rod(B, STEEL, [-.58, .56, 1.975], [.58, .56, 1.975], .018, 6);
      for (const sx of [.42, .62]) rod(B, STEEL, [sx, .5, -1.955], [sx, 1.9, -1.9], .012, 5); for (let k = 0; k < 6; k++) rod(B, STEEL, [.42, .62 + k * .24, -1.95], [.62, .62 + k * .24, -1.95], .009, 4);
    } else {
      /* slate armour over the side glass: three vision slits and a row of bolts each side */
      B.sym(() => { B.push(.73, 1.44, -.42, { rz: .066 }); B.box(PLATE, .03, .76, 2.74, 0, 0, 0, { bevel: .008 }); for (const z of [.98, .1, -.78]) { B.box(M.blkS, .012, .13, .36, .017, .1, z, { bevel: .004 }); B.box({ c: [.05, .08, .09], r: .08, m: .6 }, .006, .085, .3, .022, .1, z); B.cyl(STEEL, .036, .036, .02, .02, -.16, z, { rz: HP, seg: 10 }); }
          for (let k = 0; k < 10; k++) for (const y of [-.34, .34]) B.cyl(STEEL, .01, .01, .012, .017, y, 1.26 - k * .28, { rz: HP, seg: 5 }); B.pop();
        B.box(PLATE, .1, .07, .86, .77, .68, 1.32, { bevel: .02 }); B.box(PLATE, .1, .07, .86, .77, .68, -1.18, { bevel: .02 }); B.box(STEEL, .14, .03, 1.5, .78, .33, .07, { bevel: .008 });
        const a = wsP(.62, .02, .012), b = wsP(.57, .98, .012); rod(B, PLATE, a, b, .035, 4); });
      { const c = wsP(0, .83, .02), d = wsP(0, .11, .02), e = wsP(0, .46, .02); B.box(PLATE, 1.24, .3, .03, 0, c[1], c[2], { rx, bevel: .006 }); B.box(PLATE, 1.34, .2, .03, 0, d[1], d[2], { rx, bevel: .006 }); B.box(PLATE, .1, .52, .034, 0, e[1], e[2], { rx, bevel: .006 });   /* brow, sill and a centre post leave two vision slots */ for (const sx of [-1, 1]) for (const t of [.83, .11]) { const q = wsP(sx * .5, t, .04); B.cyl(STEEL, .012, .012, .012, q[0], q[1], q[2], { rx: rx + HP, seg: 6 }); } }
      B.cyl(PLATE, .34, .37, .07, 0, yr + .03, -.45, { seg: 22 }); B.cyl(STEEL, .29, .29, .025, 0, yr + .075, -.45, { seg: 22 }); B.box(STEEL, .05, .03, .16, 0, yr + .1, -.45, { bevel: .008 }); B.box(STEEL, .12, .04, .06, 0, yr + .07, -.8, { bevel: .01 });
      B.push(-.5, yr + .11, .2); B.cyl(M.blkS, .075, .06, .12, 0, 0, 0, { rx: HP, seg: 14 }); B.cyl(lens('bowl', CH.head), .066, .066, .012, 0, 0, .062, { rx: HP, seg: 14 }); B.cyl(M.blkS, .012, .012, .1, 0, -.06, 0, { seg: 6 }); B.pop();
      B.box(PLATE, 1.5, .24, .1, 0, .5, 2.0, { bevel: .025 }); B.box(STEEL, 1.1, .06, .12, 0, .34, 1.98, { bevel: .015 }); for (const sx of [-1, 1]) { B.add(REDL, new T.TorusGeometry(.04, .011, 5, 12), { x: sx * .44, y: .46, z: 2.06, ry: HP }); B.box(STEEL, .18, .14, .1, sx * .3, .5, 2.045, { bevel: .01 }); }
      B.box(PLATE, 1.24, .62, .03, 0, 1.46, -1.86, { rx: .09, bevel: .008 }); B.box({ c: [.05, .08, .09], r: .08, m: .6 }, .5, .09, .012, 0, 1.56, -1.885, { rx: .09 }); B.box(M.blkS, .56, .13, .008, 0, 1.56, -1.878, { rx: .09, bevel: .003 });
    } }
  DEFS.van = () => vanCN(); DEFS['van:riot'] = () => vanCN('riot'); DEFS['van:armoured'] = () => vanCN('armoured');
  /* box truck and ambulance: the small van grown into a cab with a body bolted on behind it */
  DEFS.boxtruck = () => { const S = vanCN(), bld = S.build; S.paint = 'van'; S.scale = [1.3, 1.22, 1.36]; S.fixedColor = false; S.color = 0xd8d6cf; S.build = B => { bld(B); B.box(WHTB, 1.58, 1.3, 2.36, 0, 1.68, -.76, { bevel: .03 }); B.box({ c: [.2, .2, .21], r: .6 }, 1.5, .08, 2.3, 0, .98, -.76); for (let k = 0; k < 6; k++) B.box({ c: [.6, .6, .58], r: .5 }, 1.36, .012, .01, 0, 1.2 + k * .19, -1.945);
      B.sym(() => { B.box(ORB, .012, .22, 2.2, .795, 1.5, -.76); B.box({ c: [.5, .5, .5], r: .4, m: .8 }, .02, 1.28, .04, .79, 1.68, -1.9); }); B.box({ c: [.3, .3, .3], r: .5, m: .8 }, 1.5, .06, .12, 0, .5, -2.0, { bevel: .015 }); }; return S; };
  DEFS.ambulance = () => { const S = vanCN(), bld = S.build; S.paint = 'van'; S.scale = [1.3, 1.2, 1.36]; S.fixedColor = true; S.color = 0xeeeeea; S.siren = true; S.build = B => { bld(B); B.box(WHTB, 1.56, 1.16, 2.3, 0, 1.6, -.74, { bevel: .05 });
      B.sym(() => { B.box(REDB, .012, .16, 2.2, .785, 1.36, -.74); B.box(ORB, .012, .05, 2.2, .785, 1.5, -.74); B.box({ c: [.05, .07, .09], r: .1, m: .5 }, .012, .34, .5, .785, 1.84, -1.3); });
      B.box(M.blkS, 1.2, .03, .24, 0, 2.2, .1, { bevel: .01 }); for (const sx of [-1, 1]) { B.box(lens('red', sx > 0 ? CH.sirR : CH.sirB), .5, .07, .22, sx * .3, 2.25, .1, { bevel: .02 }); B.box(lens('red', sx > 0 ? CH.sirR : CH.sirB), .2, .08, .04, sx * .55, 2.1, -1.9, { bevel: .01 }); }
      B.box(REDB, 1.0, .16, .012, 0, 1.36, -1.895); }; return S; };


  /* ---------------- 老头乐 「跑不快」: the van loft squeezed to 2.5 x 1.3 x 1.62 (taller than it is wide), small wheels tucked in, glass all round, a loud two-tone coat, chrome stuck on,
     spot lamps and a rack on the roof, a stainless bull bar, round tail lamps, a charge lead left dangling. S.scale is applied to the baked template (carTpl); everything below is written in the van's own metres,
     round parts are pre-stretched (u()) so they come out round. One seat in the middle (js/street.js seats 钱大爷 on the centre line). */
  DEFS.laotoule = () => { const S = vanCN(), k = [.855, .853, .655], u = q => [q / k[0], q / k[1], q / k[2]], CREAM = { c: lin(0xece8dc), r: .36 }, GLW = { c: [1, 1, 1], r: .3, ch: CH.glow };
    S.color = 0xf08fb0; S.fixedColor = false; S.paint = 'laotoule'; S.scale = k; S.glow = null; S.sideFx = undefined; S.dust = [.25, .8, .3, 1.92];
    S.mat = (i, j, zc, bd) => j < 5 ? M.blkM : (((zc > 1.66 || zc < -1.72) && j < bd.JR + 7) || j < bd.JR + 6 ? CREAM : 'paint');
    S.wheel = { R: .2, w: .125, rim: .13, disc: .09, hub: .045, cap: .03, dish: .02, lugs: 4, seg: 24, lip: M.alu, face: M.aluS, capM: M.chr, holes: 6 }; S.wheels = { fz: 1.32, rz: -1.18, fx: .6, rx: .6 };
    S.interior = { z0: -1.75, z1: .98, floor: .36, dash: 1.1, seatZ: -.27, seat: { c: lin(0xb0465e), r: .85 }, single: true }; S.eye = [0, 1.17, -.06]; S.seatAt = [0, .58, -.18];
    S.d.grille = { x: .3, y0: .64, y1: .735, bars: 4, chrome: true, badge: true, barMs: M.chr };
    S.dress = (B, bd, gh, fr) => { const G = bd.G, yr = 1.89;
      B.box(M.vinyl, 1.36, .05, .56, 0, 1.0, 1.25, { bevel: .01 });   /* the deep shelf between the upright dash and the screen */
      B.sym(sg => { B.line(G, bd.sLine(1.62, -1.72, .985), .024, .0016, GLW, { h: .004 }); sideDecal(B, bd, sg, 0, -.92, .5, .9, 'A', { nu: 6, nv: 5 }); B.box(M.chr, .06, .03, 1.5, .775, .3, .08, { bevel: .01 }); for (const z of [.7, -.55]) B.box(M.chr, .04, .05, .04, .74, .32, z);
        B.tube(M.chr, [[0, .82, 2.03], [.34, .82, 2.03], [.56, .78, 1.97], [.6, .52, 1.95], [.6, .36, 1.9]], .024, { seg: 6 }); rod(B, M.chr, [.3, .82, 2.03], [.3, .4, 2.01], .019, 6);
        rod(B, M.chr, [.56, yr + .08, .8], [.56, yr + .08, -1.4], .015); for (const z of [.8, -.3, -1.4]) rod(B, M.chr, [.56, yr - .03, z], [.56, yr + .08, z], .013); });
      rod(B, M.chr, [-.6, .54, 1.965], [.6, .54, 1.965], .019, 6); for (const z of [.8, -1.4]) rod(B, M.chr, [-.56, yr + .08, z], [.56, yr + .08, z], .013);
      rod(B, M.blkS, [-.62, yr + .07, 1.02], [.62, yr + .07, 1.02], .018); for (let q = 0; q < 4; q++) { B.push((q - 1.5) * .34, yr + .15, 1.04, { s: u(1) }); B.cyl(M.blkS, .05, .04, .06, 0, 0, -.012, { rx: HP, seg: 12 }); B.cyl(M.chr, .053, .053, .012, 0, 0, .016, { rx: HP, seg: 12 }); B.cyl(lens('bowl', CH.head), .044, .044, .012, 0, 0, .024, { rx: HP, seg: 12 }); B.pop(); }
      B.box('paint', .52, .08, .5, 0, yr + .025, -.25, { bevel: .03 }); B.box(M.gap, .42, .04, .02, 0, yr + .03, .0);   /* the scoop that feeds nothing */
      for (const sx of [-1, 1]) { B.push(sx * .5, 1.02, -1.935, { s: u(1) }); B.cyl(M.chr, .08, .08, .02, 0, 0, 0, { rx: HP, seg: 18 }); B.cyl(lens('red', sx > 0 ? CH.rl : CH.rr), .066, .066, .03, 0, 0, -.006, { rx: HP, seg: 18 }); B.cyl(lens('amber', sx > 0 ? CH.ral : CH.rar), .028, .028, .034, 0, 0, -.008, { rx: HP, seg: 10 }); B.pop(); }
      B.box(M.blkS, .13, .13, .02, -.42, .64, -1.93, { bevel: .01 }); B.tube(M.rubber, [[-.42, .62, -1.94], [-.45, .46, -2.0], [-.38, .3, -1.99], [-.3, .2, -1.92]], .013, { seg: 5 });
      capRect(B, fr.R, .44, .48, -.44, .58, .0012, M.decal, { nu: 8, nv: 2, uv: uvOf('B'), skirt: 0 }); };
    return S; };

  DEFS.sports = () => { const S = {
    L: 4.5, Wd: 1.96, H: 1.24, zR: -2.22, zF: 2.26, dz: .042, nS: 16, nT: 14, nH: 5, nR: 4, color: 0xa5121a, glow: null,   /* 月湾 r2: no magenta underglow on every sports car any more; pass opts.glow (hex) for the odd modded one */ dust: [.1, .36, .2, 2.26], eye: [.36, .98, .05], rearAmber: true,
    W: K([[-2.22, .86], [-1.9, .95], [-1.3, .98], [-.4, .945], [.5, .935], [1.42, .955], [1.95, .9], [2.26, .76]]),
    yb: K([[-2.22, .3], [-1.8, .19], [-1.0, .14], [1.0, .13], [1.9, .15], [2.26, .2]]), yW: K([[-2.22, .58], [-1.3, .55], [0, .46], [2.26, .4]]),
    ySh: K([[-2.22, .86], [-1.9, .93], [-1.3, .95], [-.6, .86], [.2, .76], [.9, .72], [1.42, .72], [1.9, .62], [2.26, .5]]),
    yC: K([[-2.22, .9], [-1.9, .97], [-1.3, .99], [-.6, .9], [.2, .8], [.9, .77], [1.42, .74], [1.9, .64], [2.26, .52]]),
    tum: K([[-2.22, .1], [-1.3, .09], [0, .1], [1.4, .08], [2.26, .07]]), rS: K([[-2.22, .1], [-1.3, .11], [0, .07], [1.42, .1], [2.26, .09]]), rSy: K(.035), p: K(2.2),
    rr: .06, rrx: .05, aLow: .07, eL: 1.5, eU: 1.25, xi: .55,
    arches: [{ z: 1.4, y: .335, R: .362, flare: .02, fw: .06 }, { z: -1.3, y: .35, R: .378, flare: .03, fw: .07 }],   /* the tyre fills the arch: a slammed car has no daylight over the wheel */
    front: { r: .05, bowX: .3, bowY: .05, y0: .38, hy: .25, start: 1.8 }, rear: { r: .045, bowX: .1, bowY: .03, y0: .6, hy: .3, start: -1.85 },
    wheel: { R: .335, w: .255, rim: .245, disc: .19, hub: .06, cap: .03, dish: .035, lugs: 5, seg: 32, lip: { c: [.05, .05, .055], r: .3, m: .9 }, face: { c: [.045, .045, .05], r: .34, m: .9 }, capM: { c: [.5, .02, .02], r: .3 }, lugM: M.dkm, spoke: { n: 5, twin: .2, th: .028, w0: .04, w1: .028, rise: .012, bev: .007 } },
    wheels: { fz: 1.4, rz: -1.3, fx: .83, rx: .815, rear: [1.15, 1.045] },
    interior: { z0: -.62, z1: .72, floor: .2, dash: .74, seatZ: -.12, seat: { c: [.28, .13, .06], r: .45 } },
    under: { y: .14, exh: [-.5, -2.08], tipX: .15, tipY: .37, axle: -1.3, axleY: .35, front: 1.4 },
    gh: { keys: [[0, .92, .2], [.5, -.35, -.3], [1, -1.6, -.78]], win: [[.05, .47]], black: [[.47, .82]], sub: 32, nSide: 8, nH: 4, nT: 8, nk: 20,
      Wb: K([[0, .78], [.5, .8], [1, .74]]), tum: K([[0, .22], [.5, .24], [1, .3]]), yR: K([[0, 1.1], [.3, 1.165], [.55, 1.165], [1, 1.07]]), drop: .04, rG: .08, rGy: .03, rc: .045, rcR: .03, sill: .03, rail: .08, barrel: .015, wsBulge: .1, blBulge: .03, reveal: M.blkS },
    d: { doors: [.72, null, -.42], kick: .6, kickZ: .1, sillY: .22, handles: [-.24], handleY: .7, handleMs: M.blkS, mirror: [.66, .07], mirrorMs: BLKP, hood: [.6, .99, 1.9], marker: [1.98, .42], bumpF: 1.8, bumpR: -1.85,
      grille: { x: .26, y0: .365, y1: .395, bars: 1, chrome: false, badge: false }, intake: { x: .7, y0: .21, y1: .33 }, head: [[.42, .405], [.84, .44], [.84, .49], [.42, .45]], proj: [[.2, .8]],
      tail: [[.24, .775], [.9, .795], [.9, .85], [.24, .83]], tailSeg: [[.3, .2, .97, .8]], refl: [.74, .5], plate: .6, valance: { x: .72, y0: .3, y1: .47, tip: 0 }, badge: [.15, .715, .3, .05] } };
    S.cut = (z, x) => z > -1.52 && z < .9 && x < S.gh.Wb(sAtZ(S.gh, z)) - .035;
    S.mat = (i, j, zc, bd) => j < bd.JR + 2 ? BLKP : 'paint';
    S.build = B => { const bd = makeBody(B, S), G = bd.G, gi = bd.gi; for (const a of S.arches) archParts(B, bd, a, BLKP); const gh = makeGreenhouse(B, S, bd); interior(B, S, bd, gh); underbody(B, S); flanks(B, S, bd, gh);
      const fr = fascias(B, S, bd, null); cnDress(B, S, fr, { plateF: .345, amber: [.02, .2, .28, .8] });
      // engine bay under the rear glass, side intakes, splitter, diffuser fins, wing, twin centre exhausts, emblem
      B.box(M.blkM, 1.3, .06, .9, 0, .78, -1.12, { bevel: .02 }); for (const sx of [-1, 1]) { B.box({ c: [.5, .03, .03], r: .35 }, .2, .07, .5, sx * .22, .84, -1.1, { bevel: .02 }); B.cyl(M.alu, .03, .03, .5, sx * .46, .85, -1.1, { rx: HP, seg: 10 }); } B.box(M.dkm, .5, .05, .16, 0, .86, -.74, { bevel: .015 });
      B.sym(sg => { B.patch(G, bd.sMap(-.5, -.86, .44, .74), 6, 6, .0015, M.gap, { skirt: .004 }); for (let k = 0; k < 3; k++) B.line(G, bd.sLine(-.52, -.84, .5 + k * .09), .012, .003, M.blkS, { h: .004 });
        B.box(BLKP, .16, .012, .5, .8, .145, .3, { bevel: .004 }); B.box({ c: [1, 1, 1], r: .3, ch: CH.glow }, .014, .012, 1.9, .86, .13, .05, { bevel: .004 });   /* light strip under the sill */
        B.box(M.blkS, .01, .15, .3, .752, 1.185, -2.0, { bevel: .004 }); B.tube(M.blkS, [[.34, .93, -1.72], [.34, 1.1, -1.7], [.34, 1.245, -1.84], [.34, 1.214, -1.98]], .014, { seg: 6 }); B.box(M.blkS, .06, .012, .12, .34, .952, -1.72, { bevel: .004 });   /* end plate + swan-neck stay: the blade hangs from above */
        for (const x of [.09, .27, .45, .63]) B.box(M.blkS, .012, .07, .3, x, .232, S.zR + .16, { bevel: .003 });
        sideDecal(B, bd, sg, 2.1, 1.8, .22, .4, 'K', { ms: SCUFF, uv: uvSub('K', 0, 0, .5, 1) }); sideDecal(B, bd, sg, 1.02, .78, .5, .62, 'A', { nu: 4, nv: 4 }); });
      sweep(B, M.blkS, bumperPath(S.zF + .02, .5, .22, .2, .175, 1, .3, S.front.Wn), [[-.06, -.012], [.03, -.012], [.04, 0], [.03, .012], [-.06, .012]]); B.box(BLKP, 1.5, .016, .25, 0, 1.2, -2.0, { bevel: .007, rx: .12 }); B.box(M.blkM, 1.44, .012, .34, 0, .27, S.zR + .17);   /* thin blade a hand above the deck; the diffuser's tray */
      for (const sx of [-1, 1]) { B.cyl('chrome', .042, .04, .14, sx * .1, .37, S.zR + .04, { rx: HP, seg: 16, open: true }); B.cyl(M.gap, .037, .037, .13, sx * .1, .37, S.zR + .05, { rx: HP, seg: 10 }); }
      hoodDecal(B, bd, 2.06, 1.92, .07, uvOf('A'), { nu: 2, nv: 3 }); B.box(lens('redDk', CH.stop), .5, .012, .014, 0, 1.186, -2.128, { bevel: .003 }); };
    return S; };

  /* ---------------- 月湾 round 2: open-top variants (make('sports', {variant: 'roadster'}), make('muscle', {variant: 'conv'})).
     The greenhouse (roof, pillars, glazing, liner and window trim: the index ranges makeGreenhouse records for the cockpit) is cut out of the bags after the closed car is built;
     a raked windscreen in a bright frame, roll hoops, a body-coloured rear deck with fairings (two-seater) or a folded hood (four-seater) go in. Original shapes, no real make. */
  function openTop(S, o) { const bld = S.build; S.glow = null; S.openTop = true; S.eye = [S.eye[0], S.eye[1] + .2, S.eye[2]];   /* js/cngame.js seats the driver figure at eye - 1.46, which leaves its head about 20 cm under the eye: hidden by a roof, but an empty-looking seat in an open car */ S.interior = Object.assign({}, S.interior, { seat: o.seat }); if (o.two) S.interior.rearZ = undefined;
    S.build = B => { bld(B); const R = B.ghR || {}, gv = new Set();
      for (const bn in R) { const bag = B.bags[bn]; if (!bag) continue; const rg = R[bn], I = bag.I, keep = []; for (let i = 0; i < I.length; i += 3) { let cut = false; for (let q = 0; q < rg.length; q += 2) if (i >= rg[q] && i < rg[q + 1]) { cut = true; break; } if (cut) { if (bn === 'paint') { gv.add(I[i]); gv.add(I[i + 1]); gv.add(I[i + 2]); } } else keep.push(I[i], I[i + 1], I[i + 2]); } bag.I = keep; }
      B.ghR = {}; const P = B.bags.paint.P, top = (z0, dz, xr) => { let y = 0; for (let i = 0; i < P.length / 3; i++) { if (gv.has(i)) continue; if (abs(P[i * 3 + 2] - z0) < dz && abs(P[i * 3]) < xr && P[i * 3 + 1] > y) y = P[i * 3 + 1]; } return y; };
      const K0 = S.gh.keys, zb = K0[0][1], zr = K0[K0.length - 1][1], yc = top(zb + .06, .07, .45) || S.yC(zb), yd = top(zr - .06, .08, .45) || yc, hw = S.gh.Wb(0) - .03, I = S.interior;
      const FR = o.frame || M.chr, GL = 'glass_tint', wsH = o.wsH || .42, zt = zb - wsH * .95, yt = yc + wsH, tw = hw - .08 * wsH / .42, bow = .045; const preK = ghSnap(B);
      /* CAR r1 windscreen: a bowed pane held in ONE closed frame (base rail, both posts and the header are a single rounded section with soft corners), a rubber gasket inside it,
         the mirror on a stalk from the header and two wipers parked on the cowl. It used to be a flat quad with three loose rods and a box, which read as sticks standing round the car. */
      const wp = (u, v, d) => { const t = u * 2 - 1, q = 1 - t * t, x = t * lerp(hw, tw, v), y = lerp(yc + .012, yt, v) + .014 * q * sin(v * PI), z = lerp(zb, zt, v) + bow * q * (1 - .35 * v), e = d || 0; return [x, y + e * .69, z + e * .72]; };
      skin(B, GL, 12, 4, (u, v) => wp(u, v), { face: [0, .7, .72], two: true });
      const loop = (u0, u1, v0, v1, d) => { const r = [], n = 10; for (let k = 0; k < n; k++) r.push(wp(lerp(u0, u1, k / n), v0, d)); for (let k = 0; k < 4; k++) r.push(wp(u1, lerp(v0, v1, k / 4), d)); for (let k = 0; k < n; k++) r.push(wp(lerp(u1, u0, k / n), v1, d)); for (let k = 0; k < 4; k++) r.push(wp(u0, lerp(v1, v0, k / 4), d)); return r; };
      B.tube(FR, loop(-.014, 1.014, -.03, 1.035, .004), .02, { closed: true, seg: 8, steps: 180, tension: .25 }); B.tube(M.rubber, loop(.004, .996, .008, .99, .003), .007, { closed: true, seg: 6, steps: 160, tension: .25 });
      for (const sx of [-1, 1]) { const b0 = wp(sx > 0 ? 1.01 : -.01, 0, 0); B.box(FR, .05, .05, .09, b0[0] - sx * .01, b0[1] - .012, b0[2] + .02, { bevel: .018 }); }   /* post feet on the scuttle */
      { const h = wp(.5, 1, .01); B.box(M.blkS, .03, .06, .025, 0, h[1] - .03, h[2] - .02, { bevel: .008 }); B.box(M.blkS, .21, .064, .034, 0, h[1] - .085, h[2] - .035, { bevel: .014 }); B.box(M.mirror, .19, .048, .004, 0, h[1] - .085, h[2] - .054, { bevel: .002 }); }
      for (const u of [.18, .56]) { const a0 = wp(u, 0, .03), a1 = wp(u + .3, .02, .03); B.tube(M.blkS, [[a0[0], a0[1] - .005, a0[2] + .05], [a1[0], a1[1] + .005, a1[2] + .02]], .006, { seg: 5, steps: 2 }); B.tube(M.rubber, [[a0[0] + .02, a0[1] + .004, a0[2] + .035], [a1[0] - .02, a1[1] + .012, a1[2] + .008]], .007, { seg: 5, steps: 2 }); }
      ghMark(B, preK, 'kpR'); const preR = ghSnap(B);   /* the windscreen above stays in the first-person view (js/cockpit.js hides its own closed-car frame in an open car); what follows behind the seats is cut there like a greenhouse */
      if (o.two) { /* speedster: body-coloured hoops behind the two seats with fairings running back over the deck */
        const zh = I.seatZ - .5; for (const sx of [-1, 1]) { const x = sx * .37, pts = []; for (let k = 0; k <= 8; k++) { const a = k / 8 * PI; pts.push([x + Math.cos(a) * .22, yd + Math.sin(a) * .3, zh]); } B.tube('paint', pts, .028, { seg: 6, steps: 16 }); }
        const z0 = zh - .05, z1 = zr + .06, dz = z0 - z1; B.box('paint', hw * 2 - .06, .05, dz, 0, yd - .02, (z0 + z1) / 2, { bevel: .02 }); for (const sx of [-1, 1]) B.sph('paint', .2, sx * .37, yd, z0 - .5, { s: [1, .75, 3.0], seg: 14, seg2: 8 }); B.box(M.blkS, hw * 2 - .1, .02, .04, 0, yd + .005, z0 + .02); }
      else { /* four-seater: the hood is folded down into a neat padded stack behind the rear seats under its black canvas cover: one soft cushion with piping round its edge and three fold ridges across it */
        const zf0 = zr + .56, zf1 = zr + .06, wT = hw - .16, hT = .12, TOP = { c: [.045, .045, .048], r: .86 }, PIPE = { c: [.03, .03, .032], r: .5 };
        const tp = (a, b, lift) => { const t = a * 2 - 1, f = Math.pow(max(0, 1 - Math.pow(abs(t), 6)), .5), g = Math.pow(max(0, sin(PI * b)), .5) * (.84 + .16 * abs(sin(3 * PI * b))) * (1 - .2 * b); return [t * wT * (1 - .04 * b), yd - .03 + (hT * f * g) + (lift || 0), lerp(zf0, zf1, b)]; };   /* three soft folds of canvas under one cover */
        skin(B, TOP, 18, 24, (a, b) => tp(a, b), { face: [0, 1, 0] });
        { const r = []; for (let k = 0; k <= 16; k++) r.push(tp(k / 16, .02, .004)); for (let k = 1; k < 12; k++) r.push(tp(1, k / 12, .004)); for (let k = 16; k >= 0; k--) r.push(tp(k / 16, .98, .004)); for (let k = 11; k > 0; k--) r.push(tp(0, k / 12, .004)); B.tube(PIPE, r, .009, { closed: true, seg: 6, steps: 120, tension: .2 }); }
        B.box(M.blkS, hw * 2 - .12, .025, .05, 0, yd - .005, zf0 + .03, { bevel: .01 }); }
      ghMark(B, preR); };
    return S; }
  DEFS['sports:roadster'] = () => openTop(DEFS.sports(), { two: true, wsH: .27, seat: { c: [.42, .17, .07], r: .5 } });
  DEFS['muscle:conv'] = () => openTop(derive(sedanCN('sedan'), { warp: musWarp, H: 1.34, Wd: 1.93, eye: [.37, 1.08, -.3], doors: [.86, null, -1.04], rear: [1.1, 1.08], wx: 1.04, seatBack: -.22, color: 0xc4541a,
    extra: B => { B.box('paint', .5, .06, .7, 0, .985, 1.45, { bevel: .025 }); B.box(M.blkM, .44, .035, .02, 0, .985, 1.8); B.box('paint', 1.5, .03, .16, 0, 1.12, -2.3, { bevel: .012 }); B.sym(() => B.box('paint', .04, .1, .12, .62, 1.07, -2.3, { bevel: .01 })); B.sym(() => { B.box(M.blkM, .26, .012, .9, .3, 1.0, 1.35); B.box(M.blkM, .26, .012, .5, .3, 1.07, -2.0); }); } }), { two: false, seat: { c: [.78, .74, .66], r: .55 } });   /* the stripes stop at the cowl and start again on the boot lid: no stripe through the open cabin */

  /* ---------------- 12 m low-floor electric city bus: one lofted shell (windows are glass quads of the same loft), interior, folding doors on the kerb (right) side */
  DEFS.bus = () => { const TEALB = tintOf(0x14705e, 0xc6cac5), SK = { paint: [.07, .075, .08], satin: 1 }, GL = 'glass_bus', nS = 22, nR = 3, AMB = c => ({ c, r: .6, ch: CH.amb }), S = {
    L: 12, Wd: 2.55, H: 3.36, zR: -6, zF: 6, dz: .1, nS, nT: 8, nH: 4, nR, nL: 5, color: 0xe6e9e4, dust: [.45, 1.5, .62, 6], eye: [.78, 2.0, 5.2], rearAmber: true, fixedColor: true, layout: 'bus',
    W: K([[-6, 1.2], [-5.6, 1.27], [5.4, 1.27], [6, 1.19]]), yb: K([[-6, .48], [-5, .4], [5, .4], [6, .46]]), yW: K(1.3), ySh: K(2.95), yC: K(3.06), tum: K(.03), rS: K(.13), rSy: K(.07), p: K(3),
    rr: .05, rrx: .04, aLow: .012, eL: 1.5, eU: 1, xi: .92,
    arches: [{ z: 3.25, y: .5, R: .58, lip: .03 }, { z: -2.75, y: .5, R: .58, lip: .03 }],
    front: { r: .1, bowX: .14, bowY: .04, y0: 1.6, hy: 1.5, start: 5.3 }, rear: { r: .08, bowX: .05, bowY: .01, y0: 1.6, hy: 1.5, start: -5.5 },
    wheel: { R: .5, w: .3, rim: .29, disc: .2, hub: .125, cap: .085, dish: .075, lugs: 10, seg: 40, trep: 9, lip: { c: [.62, .63, .64], r: .4, m: .9 }, face: { c: [.55, .56, .57], r: .45, m: .9 }, capM: M.dkm, lugM: M.chr, holes: 8 },
    wheels: { fz: 3.25, rz: -2.75, fx: 1.1, rx: 1.08 }, seatAt: [.78, 1.0, 5.0] };
    const yRow = t => .45 + t * (2.5 / nS), winZ = zc => zc > -5.55 && zc < 5.0, pillar = zc => ((zc + 5.55) % 1.5) < .1;
    S.mat = (i, j, zc, bd) => { if (j < bd.JR) return SK; if (j >= bd.JS) return 'paint'; const t = j - bd.JR; if (t < 2) return SK; if (t < 8) return (t >= 5 && zc < 5.3 && zc > -5.5) ? TEALB : 'paint';
      if (t < 18) return winZ(zc) ? (pillar(zc) ? M.blkS : GL) : M.blkS; return t < 20 ? M.blkS : 'paint'; };
    S.build = B => { const bd = makeBody(B, S), G = bd.G; for (const a of S.arches) archParts(B, bd, a, SK);
      const F = bd.cap(1, 20, (r, k) => { const t = r - nR; if (t < 2) return SK; if (t < 7) return 'paint'; if (t < 19) return (k < 1 || k > 18) ? M.blkS : GL; return M.blkS; });
      const R = bd.cap(-1, 20, (r, k) => { const t = r - nR; if (t < 3) return SK; if (t < 10) return 'paint'; if (t < 18) return (k < 2 || k > 17) ? M.blkS : GL; return M.blkS; });
      // ---------- front: LED route board, lamps, bumper, plate, wipers, mirrors on stalks
      capRect(B, F, -.95, 2.63, .95, 2.9, .004, D_(CH.led, .3), { nu: 8, nv: 2, uv: uvOf('led'), skirt: .003 }); capRect(B, F, -1.0, 2.6, 1.0, 2.93, .0015, M.gap, { nu: 6, nv: 2, skirt: .003 });
      for (const sg of [1, -1]) { const hq = [[sg * .62, .78], [sg * 1.08, .8], [sg * 1.08, 1.0], [sg * .62, .96]]; capQuad(B, F, hq, .003, lens('smoke', 0), { bulge: .006 }); capQuad(B, F, subQ(hq, .08, .18, .5, .82), .0068, lens('bowl', CH.head), { nu: 4, nv: 3, bulge: .004, skirt: .002 }); capQuad(B, F, subQ(hq, .56, .18, .8, .82), .0068, lens('bowl', CH.white), { nu: 3, nv: 3, bulge: .003, skirt: .002 }); capQuad(B, F, subQ(hq, .84, .12, .97, .88), .0068, lens('amber', sg > 0 ? CH.fl : CH.fr), { nu: 2, nv: 3, skirt: .002 });
        capRect(B, F, sg * .7, .56, sg * .98, .64, .004, lens('white', CH.white), { nu: 3, nv: 2, bulge: .003 }); }
      capRect(B, F, -.245, 1.01, .245, 1.186, .0015, M.blkM, { nu: 4, nv: 3, skirt: .002 }); capRect(B, F, -.22, 1.028, .22, 1.168, .0045, M.plate, { nu: 4, nv: 3, uv: uvOf('plate'), skirt: .002 });
      capRect(B, F, -.52, .76, .52, .96, .002, M.gap, { nu: 6, nv: 3, skirt: .003 }); for (let k = 1; k < 5; k++) B.line(F, [F.ij(-.5, .76 + k * .04), F.ij(.5, .76 + k * .04)], .012, .004, M.blkS, { h: .004 }); capRect(B, F, -.3, 2.36, .3, 2.44, .003, M.decalChr, { nu: 4, nv: 2, uv: uvOf('B'), skirt: 0 });
      const wip = (x0, x1) => { const a = F.at.apply(F, F.ij(x0, 1.3)), b = F.at.apply(F, F.ij(x1, 1.95)), c = F.at.apply(F, F.ij(x1 - .06, 2.3)), d = F.at.apply(F, F.ij(x1 + .08, 1.5)), o = .02; B.tube(M.blkS, [[a[0], a[1], a[2] + o], [b[0], b[1], b[2] + o]], .008, { seg: 5, steps: 2 }); B.tube(M.rubber, [[c[0], c[1], c[2] + .012], [b[0], b[1], b[2] + .014], [d[0], d[1], d[2] + .012]], .008, { seg: 5, steps: 6 }); };
      wip(.45, .7); wip(-.75, -.4);
      B.sym(sg => { B.tube(M.blkS, [[1.2, 2.72, 5.82], [1.38, 2.74, 6.02], [1.5, 2.62, 6.2], [1.52, 2.36, 6.24]], .022, { seg: 7 }); B.box(M.blkS, .09, .44, .2, 1.53, 2.12, 6.22, { bevel: .035 }); B.box(M.mirror, .012, .38, .15, 1.487, 2.14, 6.2, { ry: -.25, bevel: .003 }); B.box(M.mirror, .012, .1, .13, 1.487, 1.9, 6.2, { ry: -.25, bevel: .003 }); });
      // ---------- rear: engine hatch, lamps, LED number, plate, ladder rungs
      capRect(B, R, .34, 2.6, -.34, 2.86, .004, D_(CH.led, .3), { nu: 4, nv: 2, uv: uvOf('ledR'), skirt: .003 }); capRect(B, R, .245, 1.0, -.245, 1.176, .0015, M.blkM, { nu: 4, nv: 3, skirt: .002 }); capRect(B, R, .22, 1.018, -.22, 1.158, .0045, M.plate, { nu: 4, nv: 3, uv: uvOf('plate'), skirt: .002 });
      B.line(R, [R.ij(.95, 1.5), R.ij(.95, .68), R.ij(-.95, .68), R.ij(-.95, 1.5), R.ij(.95, 1.5)], .008, .001, M.gap); capRect(B, R, .8, .72, -.8, .94, .002, M.gap, { nu: 8, nv: 3, skirt: .003 }); for (let k = 1; k < 6; k++) B.line(R, [R.ij(.78, .72 + k * .037), R.ij(-.78, .72 + k * .037)], .012, .004, M.blkS, { h: .004 });
      for (const sg of [1, -1]) { const tq = [[sg * .98, .98], [sg * 1.16, .98], [sg * 1.16, 1.5], [sg * .98, 1.5]], tc = sg > 0 ? CH.rl : CH.rr; capQuad(B, R, tq, .003, lens('redDk', tc), { bulge: .004 }); capQuad(B, R, subQ(tq, .12, .55, .88, .95), .0075, lens('red', tc), { nu: 2, nv: 4, skirt: .002 }); capQuad(B, R, subQ(tq, .12, .28, .88, .5), .0075, lens('amber', sg > 0 ? CH.ral : CH.rar), { nu: 2, nv: 3, skirt: .002 }); capQuad(B, R, subQ(tq, .12, .05, .88, .23), .0075, lens('white', CH.rev), { nu: 2, nv: 2, skirt: .002 });
        capRect(B, R, sg * .9, 2.5, sg * 1.1, 2.56, .004, lens('red', CH.stop), { nu: 2, nv: 2 }); }
      capRect(B, R, .5, 1.24, -.5, 1.36, .0012, M.decal, { nu: 8, nv: 2, uv: uvOf('ev'), skirt: 0 }); capRect(B, R, 1.1, .56, -1.1, 1.0, .001, SCUFF, { nu: 10, nv: 3, uv: uvOf('K'), skirt: 0 });
      // ---------- flanks: panel seams, adverts, logos, kerb-side doors and route board, fuel/charge flaps, marker lamps
      const doors = [[3.98, 5.22], [-1.42, -.18]];
      B.sym(sg => { for (const z of [-5.0, -4.0, -2.05, 2.56, 4.0, 5.3]) B.line(G, [[bd.gi(z), bd.JR + .3], [bd.gi(z), bd.JR + 8]], .006, .0006, M.gap); B.line(G, bd.sLine(-5.5, 5.3, yRow(2)), .008, .0006, M.gap);
        if (sg > 0) { sideDecal(B, bd, sg, 2.5, -2.05, yRow(2) + .02, yRow(8) - .03, 'adA', { nu: 10, nv: 2, ms: { c: [1, 1, 1], r: .5, tex: true } }); sideDecal(B, bd, sg, 5.2, 3.95, 1.0, 1.22, 'logo', { nv: 2 }); B.patch(G, bd.sMap(-4.2, -4.8, .9, 1.25), 3, 3, .002, 'paint', { skirt: .003 }); B.box(M.blkS, .012, .05, .08, bd.sx(-4.5, 1.1) + .004, 1.1, -4.5, { bevel: .004 }); }
        else { sideDecal(B, bd, sg, 2.5, -.08, yRow(2) + .02, yRow(8) - .03, 'adB', { nu: 6, nv: 2, ms: { c: [1, 1, 1], r: .5, tex: true } }); sideDecal(B, bd, sg, 3.9, 2.62, 2.54, 2.76, 'ledS', { nv: 2, ms: D_(CH.led, .3), lift: .004 }); sideDecal(B, bd, sg, -2.2, -3.3, 1.02, 1.22, 'logo', { nv: 2 }); }
        sideDecal(B, bd, sg, -3.5, -5.3, yRow(20) + .03, yRow(22) - .04, 'ev', { nv: 2 }); sideDecal(B, bd, sg, 5.6, 4.6, .5, .78, 'K', { ms: SCUFF, nv: 3, uv: uvSub('K', 0, 0, .5, 1) }); sideDecal(B, bd, sg, -4.6, -5.7, .5, .82, 'K', { ms: SCUFF, nv: 3, uv: uvSub('K', .5, 0, 1, 1) }); sideDecal(B, bd, sg, 2.5, 1.5, .5, .76, 'K', { ms: SCUFF, nv: 3, uv: uvSub('K', .25, 0, .75, 1) });
        for (const z of [5.5, 1.0, -1.9, -5.6]) B.patch(G, bd.sMap(z, z - .1, yRow(3) + .02, yRow(3) + .07), 2, 2, .004, lens('amber', CH.mark), { bulge: .003 }); B.patch(G, bd.sMap(-5.7, -5.84, 2.56, 2.64), 2, 2, .004, lens('red', CH.mark), { bulge: .003 }); B.patch(G, bd.sMap(5.74, 5.6, 2.56, 2.64), 2, 2, .004, lens('amber', CH.mark), { bulge: .003 }); });
      const DG = { c: [.016, .02, .023], r: .07, m: .55, ch: CH.amb }, xd = -1.273;   /* + a faint glow from the saloon lights at night, so the doors beside a rider are dark glass and not a black wall */                                   // smoked door glass (opaque so the body behind is hidden)
      for (const d of doors) { const zc = (d[0] + d[1]) / 2, w = d[1] - d[0]; B.box(M.blkM, .03, 2.14, w + .1, xd - .004, 1.5, zc, { bevel: .01 }); B.box(M.rubber, .036, 2.06, .03, xd - .012, 1.5, zc);
        for (const s of [-1, 1]) { const zl = zc + s * w / 4; B.box(M.blkS, .03, 2.04, w / 2 - .03, xd - .016, 1.5, zl, { bevel: .008 }); B.box(DG, .012, 1.2, w / 2 - .12, xd - .03, 1.84, zl, { bevel: .004 }); B.box(DG, .012, .56, w / 2 - .12, xd - .03, .86, zl, { bevel: .004 }); B.cyl(M.chr, .012, .012, .8, xd - .05, 1.5, zl - s * (w / 4 - .08), { seg: 8 }); }
        B.box(M.blkM, .08, .04, w + .06, xd - .02, .455, zc, { bevel: .01 }); B.box({ c: [.75, .6, .08], r: .6 }, .03, .012, w, xd - .05, .478, zc); }
      B.decal(M.decal, .36, .17, xd - .037, 1.5, 4.9, uvSub('misc', 0, 0, .5, .5), { ry: -HP }); B.decal(M.decal, .36, .17, xd - .037, 1.5, -1.1, uvSub('misc', .5, 0, 1, .5), { ry: -HP }); B.decal(M.decal, .16, .16, xd - .037, 1.2, 4.9, uvSub('misc', 0, .5, .25, 1), { ry: -HP });
      // ---------- roof: AC pod, battery pack, hatches
      B.box('paint', 1.9, .26, 2.5, 0, 3.17, .4, { bevel: .09 }); for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) { B.cyl(M.blkM, .3, .3, .02, sx * .46, 3.305, -.2 + k * 1.2, { seg: 20 }); B.box(M.dkm, .5, .012, .03, sx * .46, 3.318, -.2 + k * 1.2); B.box(M.dkm, .03, .012, .5, sx * .46, 3.318, -.2 + k * 1.2); }
      B.box('paint', 2.0, .22, 3.0, 0, 3.15, -3.6, { bevel: .07 }); for (let k = 0; k < 6; k++) B.box(M.gap, 1.7, .01, .05, 0, 3.262, -4.8 + k * .46); B.box('paint', .7, .05, .8, 0, 3.08, 3.2, { bevel: .02 }); B.cyl(M.blkS, .012, .02, .4, .8, 3.26, 4.6, { seg: 6 });
      // ---------- interior (lit by the cabin channels at night)
      const FL = AMB([.1, .105, .11]), WALL = AMB([.42, .44, .45]), ST = AMB(lin(0x2b5f9e)), STP = AMB(lin(0xc9702a)), POLE = { c: lin(0xd8b21c), r: .35, m: .2, ch: CH.amb };
      B.box(FL, 2.36, .08, 11.5, 0, .44, 0); B.box(WALL, 2.3, .06, 11.4, 0, 2.6, 0); for (const sx of [-1, 1]) { B.box(WALL, .04, .86, 11.3, sx * 1.19, .93, 0); B.box({ c: [1, .96, .86], r: .4, ch: CH.cabin }, .16, .02, 10.4, sx * .5, 2.565, -.1); B.box(WALL, .5, .3, 11.0, sx * .98, 2.42, 0, { bevel: .08 }); }
      B.box(WALL, 2.3, 1.2, .06, 0, 1.0, -5.72); B.box(FL, 2.3, .5, 1.4, 0, .72, -5.0, { bevel: .03 });
      const seat = (x, z, ms, y) => { B.box(ms, .44, .07, .42, x, y + .45, z, { bevel: .03 }); B.box(ms, .44, .5, .06, x, y + .72, z - .21, { bevel: .03, rx: -.1 }); B.box(M.dkm, .05, .4, .05, x, y + .22, z); B.cyl(POLE, .014, .014, .44, x, y + 1.0, z - .23, { rz: HP, seg: 6 }); };
      for (let z = 2.3; z > -4.2; z -= .8) { for (const x of [.94, .5]) seat(x, z, ST, .48); const kerb = !(z < -.1 && z > -1.6); if (kerb) for (const x of [-.94, -.5]) seat(x, z, z > 1.4 ? STP : ST, .48); }
      for (const x of [-.94, -.47, 0, .47, .94]) seat(x, -5.0, ST, .97); for (const x of [.94, -.94]) seat(x, -4.3, ST, .48);
      for (const sx of [-1, 1]) { rod(B, POLE, [sx * .28, 2.12, 4.6], [sx * .28, 2.12, -4.6], .016); for (let z = 4.2; z > -4.6; z -= 1.5) rod(B, POLE, [sx * .28, .48, z], [sx * .28, 2.57, z], .017); for (let z = 3.9; z > -4.4; z -= .45) { B.box({ c: [.5, .5, .52], r: .7, ch: CH.amb }, .008, .14, .022, sx * .28, 2.04, z); B.add({ c: lin(0xc9702a), r: .5, ch: CH.amb }, new T.TorusGeometry(.036, .007, 5, 10), { x: sx * .28, y: 1.94, z, ry: HP }); } }
      // driver: seat, wheel, dash with a glowing screen, fare box, partition
      B.box(AMB([.05, .05, .055]), 1.5, .5, .5, .4, 1.1, 5.55, { bevel: .08 }); B.box(M.seat, .5, .1, .5, .78, 1.0, 5.0, { bevel: .04 }); B.box(M.seat, .5, .7, .1, .78, 1.38, 4.74, { bevel: .05, rx: -.1 }); B.add(M.blkS, new T.TorusGeometry(.24, .018, 8, 28), { x: .78, y: 1.42, z: 5.42, rx: 1.0 }); B.cyl(M.dkm, .025, .03, .36, .78, 1.3, 5.52, { rx: 1.0 + HP, seg: 8 });
      B.decal(D_(CH.scr, .3), .4, .16, .3, 1.38, 5.29, uvOf('dash'), { ry: PI, rx: .35 }); B.box(AMB([.5, .5, .52]), .26, .7, .26, -.6, .85, 4.5, { bevel: .03 }); B.box({ c: [.2, .24, .26], r: .1, m: .4 }, .03, 1.3, .9, .46, 1.5, 4.5, { bevel: .005 });
      B.sym(() => { for (const z of [3.25 - .64, -2.75 - .64]) B.box(M.rubber, .34, .36, .016, 1.08, .36, z, { bevel: .004 }); }); B.box(M.dkm, 1.4, .3, .5, 0, .5, -2.75, { bevel: .08 }); B.cyl(M.dkm, .07, .07, 2.0, 0, .5, 3.25, { rz: HP, seg: 10 }); B.cyl(M.dkm, .09, .09, 2.0, 0, .5, -2.75, { rz: HP, seg: 10 }); };
    return S; };

  /* ================================================================== cycles: the hero e-scooter, shared bicycle, cargo tricycle */
  const SEATM = { c: [.028, .027, .027], r: .52 }, STRAP = { c: [.02, .02, .022], r: .85 };
  /** fork, front mudguard, brake, handlebar with controls, mirrors, lamp cowl, speedo, phone mount — everything that turns with the bars. Built in vehicle space.
      c: {hy, hz (bar centre on the steering axis), rake, R (front wheel radius), phone, mitts, lamp} -> {grip:[x,y,z], axle:[y,z]} */
  function cycleFront(FB, c) { const hy = c.hy, hz = c.hz, tn = Math.tan(c.rake), zA = y => hz + (hy - y) * tn, R = c.R, az = zA(R), gy = hy + .03, gz = hz - .02, rk = -c.rake;
    rod(FB, M.dkm, [0, hy, hz], [0, .5, zA(.5)], .017, 8); FB.box(M.dkm, .2, .028, .055, 0, .5, zA(.5), { bevel: .01, rx: rk }); FB.box(M.dkm, .12, .03, .05, 0, hy - .012, hz + .006, { bevel: .01, rx: rk });
    FB.sym(() => { rod(FB, M.chr, [.076, .53, zA(.53)], [.076, .36, zA(.36)], .0135, 10); rod(FB, { c: [.16, .16, .17], r: .45, m: .9 }, [.076, .39, zA(.39)], [.076, R - .02, zA(R - .02)], .021, 10); FB.cyl(M.rubber, .019, .019, .025, .076, .4, zA(.4), { rx: rk, seg: 10 });
      FB.box(M.dkm, .022, .05, .05, .076, R, az, { bevel: .008 }); rod(FB, M.dkm, [.076, R + .1, zA(R + .1)], [.066, R + .236, az - .08], .005); FB.box(lens('amber', 0), .008, .03, .05, .1, .33, zA(.33), { bevel: .003, rx: rk }); });
    FB.cyl(M.chr, .008, .008, .2, 0, R, az, { rz: HP, seg: 8 }); for (const sx of [-1, 1]) FB.cyl(M.chr, .014, .014, .012, sx * .094, R, az, { rz: HP, seg: 6 });
    skin(FB, 'paint', 16, 4, (u, v) => { const a = lerp(.62, 2.78, u), b = v * 1.2, r = R + .024 - .02 * (1 - cos(b)); return [.066 * sin(b) / sin(1.2), R + r * sin(a), az + r * cos(a)]; }, { face: [0, 1, 0], sym: true, cx: true, two: true });
    FB.box(M.rubber, .12, .1, .006, 0, R + .24 * sin(2.9) - .02, az + .24 * cos(2.9) + .004, { rx: -.25, bevel: .002 });
    FB.box({ c: lin(0xa3221a), r: .4, m: .2 }, .03, .06, .046, .058, R + .052, az - .07, { bevel: .01, rx: -.6 }); FB.tube(M.rubber, [[.058, R + .09, az - .075], [.1, .5, zA(.5) - .03], [.1, .8, zA(.8) - .04], [.17, hy, hz + .02], [.2, gy + .005, gz + .02]], .004, { seg: 5 });
    // handlebar, grips, levers, switch pods, mirrors
    FB.tube(M.dkm, [[-.335, gy, gz], [-.2, gy, gz + .003], [-.09, hy + .012, hz - .003], [0, hy, hz], [.09, hy + .012, hz - .003], [.2, gy, gz + .003], [.335, gy, gz]], .0115, { seg: 8 });
    const MT = { c: lin(0x1a2238), r: .92 }, MT2 = { c: lin(0x2d313c), r: .95 };
    FB.sym(sg => { FB.cyl(M.rubber, .0175, .0175, .115, .275, gy, gz, { rz: HP, seg: 12 }); for (let k = 0; k < 5; k++) FB.cyl(M.rubber, .0195, .0195, .007, .232 + k * .021, gy, gz, { rz: HP, seg: 12 }); FB.cyl(M.chr, .016, .013, .016, .342, gy, gz, { rz: HP, seg: 10 });
      FB.box(M.dkm, .035, .03, .035, .2, gy + .005, gz + .012, { bevel: .008 }); FB.box(M.dkm, .04, .028, .03, .185, gy + .025, gz + .02, { bevel: .008 }); FB.tube(M.alu, [[.2, gy + .005, gz + .035], [.26, gy, gz + .056], [.345, gy - .004, gz + .046]], .005, { seg: 5 }); FB.sph(M.alu, .0075, .348, gy - .004, gz + .045, { seg: 8, seg2: 6 });
      FB.box(M.blkM, .05, .04, .046, .165, gy - .002, gz - .004, { bevel: .012 }); FB.box({ c: sg > 0 ? [.75, .55, .03] : [.6, .03, .03], r: .5 }, .014, .008, .012, .165, gy + .02, gz - .016, { bevel: .003 }); FB.box({ c: [.5, .5, .5], r: .5 }, .012, .008, .01, .15, gy + .02, gz + .004, { bevel: .003 });
      FB.tube(M.dkm, [[.19, gy + .02, gz + .02], [.2, gy + .11, gz + .03], [.25, gy + .21, gz + .02], [.275, gy + .26, gz + .01]], .0055, { seg: 6 }); FB.box(M.blkM, .12, .075, .022, .29, gy + .285, gz + .005, { bevel: .01, ry: .15 }); FB.box(M.blk, .106, .061, .004, .2885, gy + .285, gz - .0065, { bevel: .0015, ry: .15 }); FB.push(.2885, gy + .285, gz - .0088, { ry: .15 }); FB.push(0, 0, 0, { rx: 0 }); LASTMIR = [.2885, gy + .285, gz - .0088]; skin(FB, M.mirror, 6, 4, (u, v) => { const a = (u - .5) * .1, b = (v - .5) * .055, R = .34; return [a, b, -(sqrt(R * R - a * a - b * b) - sqrt(R * R - .0033))]; }, { face: [0, 0, -1] }); FB.pop(); FB.pop();   /* gently convex glass: an undistorted reflection (the shader aims it level, as a rider adjusts a mirror) */
      if (c.mitts) { FB.sph(MT, 1, .27, gy - .005, gz + .03, { s: [.115, .085, .13], seg: 14, seg2: 10 }); FB.cyl(MT2, .07, .082, .06, .27, gy - .005, gz - .09, { rx: HP, seg: 14, open: true }); for (let k = -1; k <= 1; k++) FB.add(MT2, new T.TorusGeometry(.086 - abs(k) * .008, .004, 4, 16), { x: .27, y: gy - .005, z: gz + .03 + k * .055 }); }
      else skin(FB, M.blkS, 6, 6, (u, v) => { const x = lerp(.215, .35, u), a = lerp(-.7, 1.1, v), e = 1 - .3 * (2 * u - 1) * (2 * u - 1); return [x, gy + .046 * sin(a) * e, gz + .022 + .052 * cos(a) * e]; }, { face: [0, 0, 1], two: true }); });
    // tape repairs on the left mirror (it has been dropped more than once)
    FB.cyl(TAPEB, .009, .009, .05, .2, gy + .11, gz + .03, { rz: -.1, seg: 8 }); FB.cyl(TAPE, .0088, .0088, .034, .252, gy + .213, gz + .02, { rz: -.5, seg: 8 }); FB.box(TAPEB, .05, .082, .026, .33, gy + .285, gz + .011, { bevel: .003, ry: .15 });   /* black insulating tape: the silver wrap read as a stray pale box floating behind the mirror */
    // lamp cowl + speedo
    FB.sph('paint', 1, 0, hy + .0, hz + .03, { s: [.142, .072, .11], seg: 22, seg2: 12 }); FB.box(BLKP, .2, .03, .05, 0, hy + .012, hz - .01, { bevel: .014 }); FB.sph(BLKP, 1, 0, hy - .022, hz + .02, { s: [.15, .06, .1], seg: 16, seg2: 10 });
    FB.push(0, hy - .014, hz + .178, { rx: .1 }); FB.cyl('paint', .064, .05, .09, 0, 0, -.04, { rx: HP, seg: 20 }); FB.cyl(M.blkS, .066, .066, .012, 0, 0, 0, { rx: HP, seg: 20 }); roundLamp(FB, c.lamp || .05, CH.head); FB.pop();
    FB.box(M.blkS, .05, .085, .03, -.006, hy + .1, hz - .022, { bevel: .008, rx: -.3 }); FB.box(M.blkS, .118, .012, .078, -.006, hy + .15, hz - .035, { bevel: .005, rx: -.62 }); FB.decal(D_(CH.scr, .2), .1, .0625, -.006, hy + .1564, hz - .0396, uvOf('spd'), { ry: PI, rx: .62 - HP });   /* the speedo stands on a short neck, tipped toward the rider: flat on the cowl it sat in the last 60 px of the default first-person view and its battery row was cut off */
    if (c.phone) { FB.box(M.dkm, .03, .03, .03, .1, hy + .014, hz - .006, { bevel: .008 }); rod(FB, M.dkm, [.1, hy + .02, hz - .008], [.1, hy + .1, hz - .035], .006); FB.sph(M.dkm, .012, .1, hy + .1, hz - .035, { seg: 8, seg2: 6 });
      FB.push(.1, hy + .16, hz - .04, { rx: .42 }); FB.box({ c: [.012, .012, .014], r: .3, m: .4 }, .08, .162, .011, 0, 0, 0, { bevel: .005 }); FB.decal(D_(CH.scr, .12), .069, .147, 0, 0, -.0061, uvOf('nav'), { ry: PI });
      for (const a of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) FB.box(M.blkM, .014, .02, .018, a[0] * .039, a[1] * .074, 0, { bevel: .004 }); FB.box(M.blkM, .05, .06, .012, 0, -.01, .011, { bevel: .004 }); FB.pop();
      FB.tube(M.rubber, [[.1, hy + .085, hz - .075], [.085, hy + .03, hz - .05], [.05, hy, hz], [.02, hy - .03, hz + .04]], .003, { seg: 5 }); }
    return { grip: [.27, gy, gz], axle: [R, az] }; }
  /** side stand along -Y of its pivot */
  function standGeo(len) { const B = new Builder(); rod(B, M.dkm, [0, 0, 0], [0, -len, 0], .009, 6); B.box(M.dkm, .04, .008, .03, .008, -len, 0, { bevel: .003 }); B.cyl(M.dkm, .014, .014, .03, 0, 0, 0, { rz: HP, seg: 8 }); spring(B, M.chr, [0, -.02, .012], [0, -len * .5, .012], .005, 8, .0012); return bake(B); }

  const CYC = {};
  CYC.escooter = v => { LAY = LAYS.escooter; const B = new Builder(), R = .215, zF = .72, zR = -.58, rake = .495, GL = v.box !== false && !v.patrol ? { c: [.8, 1, .95], r: .3, ch: CH.glow } : null, REFL = { c: [.8, .82, .85], r: .28, m: .35, ch: CH.refl };   /* GL: the delivery rider's light strips (deck edges, leg-shield rim, tail), teal, with a pool on the ground at night */
    // ---- under-seat body shell (yellow sides, black belly), front wall
    const wT = K([[-.94, .045], [-.84, .12], [-.6, .165], [-.25, .172], [-.06, .165]]), yBt = K([[-.94, .6], [-.82, .53], [-.6, .47], [-.4, .43], [-.24, .33], [-.06, .3]]), yTt = K([[-.94, .67], [-.75, .7], [-.4, .69], [-.06, .665]]);
    const tailFn = (u, w) => { const z = lerp(-.94, -.06, u), a = lerp(-HP, HP, w), c = cos(a), s = sin(a), hw = wT(z), yb = yBt(z), yt = yTt(z); return [hw * Math.pow(max(c, 0), .55), (yb + yt) / 2 + (yt - yb) / 2 * Math.sign(s) * Math.pow(abs(s), .55), z]; };
    const TG = skin(B, (i, j) => j < 4 ? M.blkM : (j === 4 ? BLKP : 'paint'), 26, 14, tailFn, { face: [1, 0, 0], sym: true, cx: true });
    skin(B, M.blkM, 2, 14, (u, w) => { const p = tailFn(1, w); return [p[0] * u, lerp(.48, p[1], u), -.056]; }, { face: [0, 0, 1], fi: 1, sym: true });
    B.sym(() => { B.line(TG, [[1, 9.2], [25, 9.2]], .004, .0006, M.gap); B.line(TG, [[17, 4.5], [17, 9.2]], .004, .0006, M.gap); B.line(TG, [[8.5, 4.5], [8.5, 9.2]], .004, .0006, M.gap); B.tube(M.dkm, [[.1, .7, -.36], [.172, .715, -.44], [.175, .73, -.6], [.15, .76, -.72]], .009, { seg: 6 }); });
    // ---- floorboard with rubber mat, battery tray, trim
    B.box('paint', .35, .1, .52, 0, .25, .17, { bevel: .03 }); B.box(M.rubber, .29, .012, .4, 0, .303, .12, { bevel: .004 }); for (let k = 0; k < 9; k++) B.box(M.blkS, .27, .006, .012, 0, .311, -.05 + k * .043, { bevel: .002 });
    B.box(M.blkM, .27, .11, .5, 0, .165, .14, { bevel: .03 }); B.sym(() => { B.box(M.alu, .006, .014, .44, .176, .262, .16, { bevel: .002 }); B.box(lens('amber', 0), .006, .022, .05, .1775, .236, .33, { bevel: .002 }); if (GL) B.box(GL, .009, .016, .47, .1795, .212, .15, { bevel: .003 }); });
    // ---- leg shield: outer skin, top, inner panel with pockets, hook, key, stickers
    const Zc = K([[.27, .44], [.42, .5], [.6, .54], [.78, .515], [.9, .46], [.985, .39]]), wA = K([[.27, .185], [.45, .2], [.7, .19], [.9, .15], [.985, .1]]), zi = y => Zc(y) - .168;
    const aprFn = (u, w) => { const y = lerp(.27, .985, u), hw = wA(y), zc = Zc(y); if (w <= .8) { const a = w / .8 * HP; return [hw * sin(a), y, zc - .1 * (1 - cos(a))]; } return [hw, y, zc - .1 - (w - .8) / .2 * .07]; };
    const AG = skin(B, (i, j) => (j < 3 && i > 3 && i < 18) ? BLKP : 'paint', 20, 12, aprFn, { face: [0, 0, 1], fj: 2, sym: true, cx: true });
    skin(B, 'paint', 2, 12, (u, w) => { const p = aprFn(1, w); return [p[0] * u, .985 + .012 * (1 - u), lerp(.3, p[2], u)]; }, { face: [0, 1, 0], fi: 1, sym: true });
    skin(B, M.blkM, 12, 6, (u, w) => { const y = lerp(.3, .975, u), hw = wA(y) - .004; return [hw * w, y, zi(y) + .025 * w * w]; }, { face: [0, 0, -1], sym: true, cx: true });
    B.sym(sg => { if (GL) { const pts = []; for (let q = 0; q <= 8; q++) { const p = aprFn(lerp(.12, .93, q / 8), .86); pts.push([p[0] + .004, p[1], p[2]]); } B.tube(GL, pts, .0055, { seg: 5 }); }
      B.box(M.gap, .11, .1, .02, .085, .6, zi(.6) + .004, { bevel: .01 }); B.box(M.blkS, .12, .012, .03, .085, .548, zi(.55) - .006, { bevel: .004 });
      B.box(M.blkS, .08, .04, .03, .125, .74, Zc(.74) - .03, { bevel: .012, ry: .55 }); B.box(lens('amber', sg > 0 ? CH.fl : CH.fr), .066, .028, .03, .127, .74, Zc(.74) - .024, { bevel: .011, ry: .55 });
      const u = uvOf('brand'), um = (u[0] + u[2]) / 2; B.patch(AG, rectT(14.0, 15.9, 0, 2.9), 4, 2, .0012, M.decal, { uv: sg > 0 ? [um, u[1], u[2], u[3]] : [um, u[1], u[0], u[3]], skirt: 0 });
      B.patch(AG, rect(1, 6, 5, 10), 4, 5, .0012, SCUFF, { uv: uvSub('scuff', 0, 0, .6, .6), skirt: 0 }); });
    for (let k = 0; k < 5; k++) B.box(M.gap, .11, .008, .012, 0, .45 + k * .02, Zc(.45 + k * .02) + .001);
    rod(B, M.chr, [0, .76, zi(.76)], [0, .75, zi(.76) - .03], .004); rod(B, M.chr, [0, .75, zi(.76) - .03], [0, .78, zi(.76) - .04], .004);
    B.cyl(M.dkm, .017, .017, .016, -.09, .84, zi(.84) - .004, { rx: HP, seg: 12 }); B.cyl(M.chr, .011, .011, .02, -.09, .84, zi(.84) - .006, { rx: HP, seg: 10 }); B.box(M.chr, .003, .014, .03, -.09, .84, zi(.84) - .03); B.box({ c: [.6, .05, .05], r: .5 }, .02, .03, .004, -.09, .81, zi(.84) - .04, { rz: .2 });
    const zs = (x, y) => zi(y) + .025 * (x / wA(y)) * (x / wA(y)) - .002; B.decal(M.decal, .055, .055, .08, .8, zs(.08, .8), uvSub('stick', 0, .5, .5, 1), { ry: PI }); B.decal(M.decal, .05, .05, -.085, .47, zs(.085, .47), uvSub('stick', .5, .5, 1, 1), { ry: PI }); B.decal(M.decal, .05, .05, .09, .46, zs(.09, .46), uvSub('stick', 0, 0, .5, .5), { ry: PI });
    // ---- seat (stitched vinyl, tape over a split), end caps
    const wS = K([[-.62, .12], [-.5, .158], [-.22, .155], [-.04, .13], [.03, .07]]), yS = K([[-.62, .8], [-.5, .795], [-.38, .765], [-.3, .745], [-.2, .74], [-.04, .735], [.03, .71]]);
    const seatFn = (u, w) => { const z = lerp(-.62, .03, u), a = w * HP; return [wS(z) * Math.pow(max(cos(a), 0), .5), yS(z) - .085 + .085 * Math.pow(sin(a), .6), z]; };
    const SG = skin(B, SEATM, 22, 8, seatFn, { face: [1, 0, 0], fj: 1, sym: true, cx: true });
    for (const e of [0, 1]) skin(B, SEATM, 2, 8, (u, w) => { const p = seatFn(e, w); return [p[0] * u, lerp(yS(p[2]) - .05, p[1], u), p[2]]; }, { face: [0, 0, e ? 1 : -1], fi: 1, sym: true });
    B.sym(() => { B.line(SG, [[1, 5.4], [21, 5.4]], .004, .0008, { c: [.1, .1, .1], r: .6 }, { h: .002 }); B.patch(SG, rect(5.3, 6.9, 0, 8), 2, 8, .0014, TAPE, { skirt: 0 }); B.patch(SG, rect(5.9, 7.6, 2, 8), 2, 6, .002, TAPEB, { skirt: 0 }); });
    // ---- tail lamp cluster, mudguard, plate, flap
    B.box(M.blkS, .15, .07, .05, 0, .645, -.94, { bevel: .015 }); B.box(lens('red', CH.rl), .1, .042, .03, 0, .648, -.962, { bevel: .012 }); B.sym(sg => B.box(lens('amber', sg > 0 ? CH.ral : CH.rar), .036, .032, .036, .096, .645, -.95, { bevel: .012 })); B.box(M.blkS, .27, .03, .016, 0, .772, -1.034, { bevel: .005 }); B.box(lens('red', CH.rl), .24, .018, .012, 0, .772, -1.043, { bevel: .004 });   /* the light bar across the end of the rack: a red line under the box at night */
    if (GL) B.sym(() => B.line(TG, [[3, 4.6], [24, 4.6]], .009, .0018, GL, { h: .003 }));
    skin(B, M.blkM, 14, 4, (u, w) => { const a = lerp(.95, 3.0, u), b = w * 1.2, r = R + .035 - .018 * (1 - cos(b)); return [.066 * sin(b) / sin(1.2), R + r * sin(a), zR + r * cos(a)]; }, { face: [0, 1, 0], sym: true, cx: true, two: true });
    B.box(M.blkM, .2, .13, .01, 0, .4, -.875, { rx: .2, bevel: .004 }); B.decal(M.plate, .182, .114, 0, .4015, -.8822, uvOf('plate'), { ry: PI, rx: -.2 }); B.box(M.blkM, .05, .15, .02, 0, .535, -.887, { rx: .5, bevel: .006 }); B.box(lens('redDk', CH.mark), .06, .022, .01, 0, .56, -.912, { rx: .5, bevel: .004 });
    B.box(M.rubber, .15, .17, .008, 0, .2, -.848, { rx: .12, bevel: .002 }); B.decal(M.decal, .12, .045, 0, .215, -.8545, uvOf('brand'), { ry: PI, rx: -.12 }); B.box(M.dkm, .04, .012, .06, 0, .29, -.83, { rx: .5 });
    // ---- rack + insulated box with straps
    const bz = -.77, by = 1.04, BX = { c: lin(0xc79618), r: .86 }, BF = D_(0, .86), ORG = { c: lin(0xe2681a), r: .8 }, BAG = { c: lin(0x1a1a1e), r: .92 };
    B.sym(() => { B.tube(M.dkm, [[.14, .7, -.44], [.15, .79, -.53], [.16, .795, -.98], [.12, .795, -1.02], [0, .795, -1.03]], .009, { seg: 6 }); rod(B, M.dkm, [.13, .66, -.86], [.16, .79, -.9], .008); B.box(M.dkm, .03, .02, .03, .13, .665, -.86, { bevel: .006 }); });
    for (const z of [-.56, -.78]) rod(B, M.dkm, [-.155, .795, z], [.155, .795, z], .008); B.box(M.dkm, .34, .006, .46, 0, .806, bz, { bevel: .002 });
    if (v.box !== false) {
    B.box(BX, .48, .46, .48, 0, by, bz, { bevel: .022 }); B.decal(BF, .44, .42, 0, by, bz - .2405, uvOf('boxB'), { ry: PI }); B.decal(BF, .44, .42, .2405, by, bz, uvOf('boxS'), { ry: HP }); B.decal(BF, .44, .42, -.2405, by, bz, uvOf('boxS'), { ry: -HP }); B.decal(BF, .44, .42, 0, by, bz + .2405, uvSub('lid', .1, .1, .9, .45));
    B.box(BX, .5, .05, .5, 0, by + .245, bz, { bevel: .018 }); B.decal(BF, .45, .45, 0, by + .2705, bz, uvOf('lid'), { rx: -HP }); for (const s of [-1, 1]) { B.box(STRAP, .014, .44, .014, s * .236, by - .01, bz - .236); B.box(STRAP, .014, .44, .014, s * .236, by - .01, bz + .236); B.box(STRAP, .506, .012, .012, 0, by + .222, bz + s * .25); B.box(STRAP, .012, .012, .506, s * .25, by + .222, bz); }
    for (const x of [-.195, .195]) { B.box(STRAP, .03, .004, .52, x, by + .2725, bz); B.box(STRAP, .03, .5, .004, x, by + .02, bz - .2445); B.box(STRAP, .03, .5, .004, x, by + .02, bz + .2445); B.box(M.dkm, .038, .03, .01, x, by + .1, bz - .249, { bevel: .003 }); B.box(M.chr, .02, .03, .012, x, .8, bz - .245, { bevel: .003 }); }
    B.box(STRAP, .1, .012, .03, 0, by + .285, bz, { bevel: .005 });
    /* retro-reflective tape over the painted strips (back, both sides, lid): two bright lines behind the rider when a lamp finds them */
    B.box(REFL, .385, .036, .002, 0, by - .156, bz - .2414); for (const sx of [-1, 1]) B.box(REFL, .002, .036, .385, sx * .2414, by - .156, bz); B.box(REFL, .4, .002, .036, 0, by + .2716, bz - .185);
    /* an orange ratchet strap round the girth with its tail left hanging, a second small bag lashed on top, a net pocket with a water bottle */
    for (const sg of [-1, 1]) { B.box(ORG, .5, .028, .004, 0, by + .075, bz + sg * .2462); B.box(ORG, .004, .028, .5, sg * .2462, by + .075, bz); } B.box(M.chr, .05, .04, .012, .13, by + .075, bz - .249, { bevel: .003 }); B.box(ORG, .026, .17, .004, .165, by - .02, bz - .25, { rz: .16 });
    B.box(BAG, .3, .16, .28, .03, by + .352, bz + .05, { bevel: .045 }); B.box({ c: [.3, .31, .32], r: .5, m: .4 }, .306, .006, .286, .03, by + .4, bz + .05, { bevel: .002 }); B.box(REFL, .2, .022, .002, .03, by + .345, bz - .0915);
    B.box(ORG, .026, .004, .5, .03, by + .435, bz + .02); B.box(ORG, .5, .004, .026, 0, by + .435, bz + .05); for (const sg of [-1, 1]) { B.box(ORG, .004, .17, .026, .03 + sg * .153, by + .35, bz + .05); B.box(ORG, .026, .17, .004, .03, by + .35, bz + .05 + sg * .143); }
    B.box({ c: [.03, .03, .032], r: .95 }, .014, .2, .22, -.2475, by - .03, bz + .06, { bevel: .004 }); B.cyl({ c: lin(0x9fd4e8), r: .12 }, .033, .033, .2, -.266, by + .03, bz + .06, { seg: 10 }); B.cyl({ c: lin(0x1c58b8), r: .4 }, .02, .02, .03, -.266, by + .145, bz + .06, { seg: 8 }); }
    else if (v.patrol) { /* police patrol scooter: white top case and panniers with chequer tape, a red beacon on a tall mast at the back right, strobes, crash bars */
      const WH = { c: lin(0xe9ebe8), r: .4 }, CHK = D_(CH.refl, .35);
      B.box(WH, .4, .28, .38, 0, .955, bz, { bevel: .05 }); B.box(M.blkS, .41, .012, .39, 0, 1.035, bz, { bevel: .004 }); B.decal(CHK, .34, .08, 0, .89, bz - .1915, uvOf('chk'), { ry: PI }); B.decal(M.decal, .3, .075, 0, .985, bz - .1915, uvOf('unit'), { ry: PI }); for (const sx of [-1, 1]) B.decal(CHK, .32, .075, sx * .2015, .9, bz, uvOf('chk'), { ry: sx * HP });
      B.sym(sg => { B.box(WH, .13, .25, .36, .225, .56, -.74, { bevel: .04 }); B.box(M.blkS, .135, .012, .365, .225, .64, -.74, { bevel: .004 }); B.decal(CHK, .3, .07, .2915, .52, -.74, uvOf('chk'), { ry: HP }); rod(B, M.dkm, [.15, .78, -.7], [.2, .68, -.72], .008);
        B.box(lens(sg > 0 ? 'red' : 'blue', sg > 0 ? CH.sirR : CH.sirB), .06, .03, .02, .11, .83, -1.045, { bevel: .008 }); B.box(lens(sg > 0 ? 'red' : 'blue', sg > 0 ? CH.sirR : CH.sirB), .05, .035, .02, .085, .88, Zc(.88) + .006, { bevel: .008 });
        B.tube(M.chr, [[.12, .52, .42], [.25, .47, .38], [.3, .32, .22], [.27, .21, .03], [.15, .2, -.02]], .011, { seg: 6 }); });
      rod(B, M.chr, [-.17, .8, -.99], [-.17, 1.74, -.99], .009, 6); B.cyl(M.blkS, .03, .03, .04, -.17, .82, -.99, { seg: 8 }); B.cyl(M.blkS, .05, .05, .016, -.17, 1.735, -.99, { seg: 12 }); B.cyl(lens('red', CH.sirR), .046, .046, .085, -.17, 1.785, -.99, { seg: 12 }); B.sph(M.blkS, .047, -.17, 1.828, -.99, { seg: 12, seg2: 6, s: [1, .35, 1] }); }
    else { B.box(M.blkM, .3, .16, .3, 0, .89, bz + .02, { bevel: .05 }); B.box(M.blkS, .31, .02, .31, 0, .975, bz + .02, { bevel: .008 }); }                // plain top case for civilian scooters
    // ---- swing arm, twin shocks, caliper, motor cable, charging port, stands, wear
    B.sym(() => { B.box(M.dkm, .03, .045, .42, .096, .236, -.39, { bevel: .012, rx: -.05 }); rod(B, M.dkm, [.136, .5, -.6], [.126, .37, -.6], .015, 8); rod(B, M.chr, [.126, .38, -.6], [.116, .235, -.6], .007, 6); spring(B, { c: lin(0x9a1d16), r: .4, m: .4 }, [.134, .47, -.6], [.118, .27, -.6], .022, 7, .005); B.cyl(M.dkm, .014, .014, .03, .112, .225, -.6, { rz: HP, seg: 8 }); });
    B.box(M.dkm, .03, .05, .06, -.066, .3, -.5, { bevel: .01 }); B.tube(M.rubber, [[.09, R, zR + .03], [.11, .3, -.45], [.1, .36, -.3], [.08, .34, -.2]], .006, { seg: 5 });
    B.cyl(M.blkS, .026, .026, .012, .168, .47, -.15, { rz: HP, seg: 14 }); B.cyl(M.dkm, .016, .016, .016, .169, .47, -.15, { rz: HP, seg: 10 }); B.decal(M.decal, .05, .05, .175, .535, -.15, uvSub('stick', .5, 0, 1, .5), { ry: HP });
    B.sym(() => rod(B, M.dkm, [.09, .165, -.2], [.12, .1, -.4], .011)); rod(B, M.dkm, [-.12, .1, -.4], [.12, .1, -.4], .011); spring(B, M.chr, [.06, .16, -.22], [.06, .2, -.34], .006, 9, .0014);
    B.sym(sg => { B.patch(TG, sg > 0 ? rect(8, 16, 5, 8) : rect(15, 23, 5, 8.5), 6, 4, .0012, SCUFF, { uv: sg > 0 ? uvSub('scuff', 0, 0, .7, .5) : uvSub('scuff', .3, .5, 1, 1), skirt: 0 }); });
    B.patch(TG, rect(13.5, 16.5, 7, 9.6), 2, 2, .0016, TAPE, { skirt: 0 }); B.patch(TG, rect(14.4, 15.6, 6.2, 10.4), 2, 3, .0022, TAPE, { skirt: 0 });
    const FB = new Builder(), fr = cycleFront(FB, { hy: 1.0, hz: .3, rake, R, phone: true, mitts: !!v.mitts });
    if (v.patrol) { FB.box(M.blkS, .3, .02, .02, 0, 1.17, .37, { bevel: .006 }); for (const sx of [-1, 1]) rod(FB, M.dkm, [sx * .13, 1.03, .33], [sx * .14, 1.17, .37], .006); for (const ry of [0, PI]) FB.add('glass_clear', new T.PlaneGeometry(.36, .36), { x: 0, y: 1.35, z: .31, rx: ry ? .32 : -.32, ry }); FB.box(M.blkS, .37, .012, .012, 0, 1.52, .255, { bevel: .004 }); }
    return { lay: 'escooter', L: 1.96, Wd: .7, H: v.patrol ? 1.84 : v.box !== false ? 1.48 : 1.33, color: 0xd6a21a, metal: .12, dust: [.12, .62, .72, .93, zF, zR, R], eye: [0, 1.25, -.2], body: bake(B), front: bake(FB), stand: standGeo(.224),
      wheelF: cycleWheelGeo({ R, tw: .1, th: .085, hubR: .05, hubW: .09, rimM: M.dkm, hubM: M.dkm, spoke: { n: 5, th: .02, w0: .05, w1: .03, ms: M.dkm, sweep: .012 }, disc: .088, discX: .047 }),
      wheelR: cycleWheelGeo({ R, tw: .1, th: .085, hubR: .086, hubW: .11, rimM: M.dkm, hubM: { c: [.13, .13, .14], r: .45, m: .9 }, spoke: { n: 6, th: .024, w0: .05, w1: .034, ms: M.dkm }, disc: .1, discX: -.06 }),
      glow: null, glowK: 0, pivot: [1.0, .3, rake], axF: [R, zF], axR: [[0, R, zR]], seat: [0, .74, -.2], grip: fr.grip, feet: [[.12, .3, .08], [-.12, .3, .11]], standAt: [.1, .2, -.12], standRot: [[1.43, 0], [0, .78]], parkLean: -.16, two: true, beam: .27 }; };

  CYC.sharebike = () => { LAY = LAYS.sharebike; const B = new Builder(), R = .3, zF = .54, zR = -.5, rake = .368, hy = 1.0, hz = .27, tn = Math.tan(rake), zA = y => hz + (hy - y) * tn, ACC = { c: lin(0xe2a01e), r: .45 }, BB = [.3, -.13];
    // frame: fat step-through beam, seat tube, stays, head tube
    rod(B, 'paint', [0, .985, zA(.985)], [0, .72, zA(.72)], .026, 10); B.tube('paint', [[0, .8, zA(.8) - .01], [0, .62, .2], [0, .43, 0], [0, BB[0] + .01, BB[1]]], .032, { seg: 10 }); rod(B, 'paint', [0, BB[0], BB[1]], [0, .8, -.24], .021, 10); B.tube('paint', [[0, .62, .2], [0, .58, 0], [0, .62, -.2]], .014, { seg: 6 });
    B.sym(() => { rod(B, 'paint', [.04, BB[0], BB[1]], [.058, R, zR], .014, 8); rod(B, 'paint', [.02, .72, -.225], [.058, R, zR], .011, 8); B.box(M.dkm, .012, .05, .05, .058, R, zR, { bevel: .006 }); });
    B.cyl(M.dkm, .034, .034, .1, 0, BB[0], BB[1], { rz: HP, seg: 12 }); B.box('paint', .014, .11, .44, -.072, R + .005, (BB[1] + zR) / 2, { bevel: .03 }); B.decal(M.decal, .26, .05, -.0795, R + .005, (BB[1] + zR) / 2, uvOf('brand'), { ry: -HP });
    // seat post, clamp, saddle
    rod(B, M.alu, [0, .78, -.236], [0, .87, -.257], .013, 10); B.cyl(M.dkm, .025, .025, .03, 0, .8, -.24, { rx: -.2, seg: 10 }); rod(B, M.chr, [.03, .8, -.24], [.07, .79, -.26], .004); B.sph(SEATM, 1, 0, .885, -.3, { s: [.092, .03, .1], seg: 16, seg2: 10 }); B.sph(SEATM, 1, 0, .882, -.2, { s: [.05, .026, .1], seg: 12, seg2: 8 }); B.box(M.dkm, .05, .02, .12, 0, .862, -.27, { bevel: .006 });
    // rear mudguard, smart lock with QR plate, reflector
    skin(B, ACC, 16, 4, (u, w) => { const a = lerp(.75, 3.05, u), b = w * 1.2, r = R + .03 - .014 * (1 - cos(b)); return [.036 * sin(b) / sin(1.2), R + r * sin(a), zR + r * cos(a)]; }, { face: [0, 1, 0], sym: true, cx: true, two: true });
    B.add(M.blkS, new T.TorusGeometry(.046, .012, 6, 14, 4.4), { x: 0, y: R + .3 * sin(1.05), z: zR + .3 * cos(1.05), rx: -2.62, rz: -.6 }); B.box(M.blkS, .1, .075, .055, 0, .665, -.31, { bevel: .014, rx: -.5 }); B.decal(M.decal, .085, .042, 0, .7, -.292, uvOf('lock'), { rx: -HP - .5 + PI, ry: PI });
    B.box(M.blkM, .07, .07, .006, 0, .47, zR - .345, { rx: .12, bevel: .002 }); B.decal(M.decal, .062, .062, 0, .47, zR - .349, uvOf('qr'), { ry: PI, rx: -.12 }); B.box(lens('redDk', CH.rl), .05, .03, .012, 0, .56, zR - .335, { bevel: .004, rx: .3 });
    // basket on the head tube: wire cage, solar base, advert plate
    const bx = .15, by0 = .78, by1 = .98, bz0 = .4, bz1 = .64, WIRE = { c: [.06, .06, .065], r: .45, m: .7 };
    rod(B, WIRE, [0, .86, zA(.86)], [0, .8, bz0 + .02], .01); rod(B, WIRE, [0, .76, zA(.76)], [0, .78, bz0 + .06], .009);
    for (const y of [by0, by1]) { const e = y === by1 ? .012 : 0, P = [[-bx - e, y, bz0 - e], [bx + e, y, bz0 - e], [bx + e, y, bz1 + e], [-bx - e, y, bz1 + e]]; for (let k = 0; k < 4; k++) rod(B, WIRE, P[k], P[(k + 1) % 4], y === by1 ? .006 : .004); }
    for (let k = 0; k <= 6; k++) { const x = lerp(-bx, bx, k / 6); rod(B, WIRE, [x, by0, bz1], [x * 1.08, by1, bz1 + .012], .0028, 4); rod(B, WIRE, [x, by0, bz0], [x * 1.08, by1, bz0 - .012], .0028, 4); } for (let k = 1; k < 5; k++) { const z = lerp(bz0, bz1, k / 5); for (const s of [-1, 1]) rod(B, WIRE, [s * bx, by0, z], [s * (bx + .012), by1, z], .0028, 4); }
    for (const s of [-1, 1]) rod(B, WIRE, [s * bx, by0 + .1, bz0], [s * bx, by0 + .1, bz1], .0028, 4); B.box(M.blkM, .29, .012, .23, 0, by0 + .006, (bz0 + bz1) / 2, { bevel: .003 }); B.decal(D_(0, .2), .26, .2, 0, by0 + .0125, (bz0 + bz1) / 2, uvOf('panel'), { rx: -HP });
    B.box({ c: lin(0x0f8f86), r: .5 }, .29, .14, .006, 0, by0 + .1, bz1 + .008, { bevel: .002 }); B.decal(D_(0, .5), .28, .13, 0, by0 + .1, bz1 + .0115, uvOf('ad'));
    const FB = new Builder(); LAY = LAYS.sharebike;
    rod(FB, M.alu, [0, .97, zA(.97)], [0, 1.05, .25], .014, 10); FB.box(M.dkm, .04, .035, .05, 0, 1.05, .25, { bevel: .01 }); FB.tube(M.dkm, [[-.3, 1.06, .25], [-.15, 1.066, .236], [0, 1.052, .25], [.15, 1.066, .236], [.3, 1.06, .25]], .011, { seg: 8 });
    FB.sym(sg => { FB.cyl(M.rubber, .017, .017, .11, .25, 1.061, .249, { rz: HP, seg: 12 }); FB.cyl(M.rubber, .021, .021, .012, .305, 1.06, .25, { rz: HP, seg: 12 }); FB.box(M.dkm, .03, .028, .03, .18, 1.066, .245, { bevel: .007 }); FB.tube(M.alu, [[.18, 1.066, .26], [.24, 1.06, .285], [.3, 1.056, .28]], .0045, { seg: 5 });
      rod(FB, 'paint', [.05, .72, zA(.72) + .006], [.058, R, zF], .014, 8); FB.box(M.dkm, .012, .04, .04, .058, R, zF, { bevel: .005 }); if (sg > 0) { FB.sph(M.chr, .024, .12, 1.09, .245, { seg: 12, seg2: 8, s: [1, .7, 1] }); FB.box(M.dkm, .02, .02, .02, .12, 1.07, .245); } });
    FB.box('paint', .13, .04, .05, 0, .72, zA(.72) + .004, { bevel: .014, rx: -rake }); FB.cyl(M.chr, .006, .006, .13, 0, R, zF, { rz: HP, seg: 6 });
    skin(FB, ACC, 14, 4, (u, w) => { const a = lerp(.5, 2.7, u), b = w * 1.2, r = R + .03 - .014 * (1 - cos(b)); return [.036 * sin(b) / sin(1.2), R + r * sin(a), zF + r * cos(a)]; }, { face: [0, 1, 0], sym: true, cx: true, two: true });
    FB.box(M.blkM, .06, .06, .01, 0, 1.0, .225, { rx: -.35, bevel: .003 }); FB.decal(M.decal, .052, .052, 0, 1.0018, .2206, uvOf('qr'), { ry: PI, rx: -.35 }); FB.box(lens('white', CH.head), .04, .03, .02, 0, .7, zA(.7) + .05, { bevel: .008 }); FB.box(M.blkS, .05, .04, .03, 0, .7, zA(.7) + .034, { bevel: .01 });
    // crank (rotates about X at the bottom bracket) and one pedal (instanced twice, kept level)
    const CB = new Builder(); CB.cyl(M.dkm, .012, .012, .15, 0, 0, 0, { rz: HP, seg: 8 }); CB.cyl({ c: [.1, .1, .11], r: .4, m: .8 }, .085, .085, .004, -.064, 0, 0, { rz: HP, seg: 24 }); for (const s of [1, -1]) { CB.box(M.alu, .014, .19, .026, s * .078, s * .085, 0, { bevel: .006 }); CB.cyl(M.dkm, .007, .007, .03, s * .095, s * .17, 0, { rz: HP, seg: 6 }); }
    const PB = new Builder(); PB.box(M.blkM, .09, .02, .065, 0, 0, 0, { bevel: .005 }); for (const s of [-1, 1]) PB.box(lens('amber', 0), .05, .012, .004, 0, 0, s * .033); for (let k = -1; k <= 1; k++) PB.box(M.blkS, .084, .004, .006, 0, .011, k * .022);
    const spoke = { n: 5, th: .016, w0: .05, w1: .034, ms: ACC, sweep: .03 };
    return { lay: 'sharebike', L: 1.72, Wd: .6, H: 1.1, color: 0x129488, metal: .2, dust: [.1, .5, .5, .84, zF, zR, R], eye: [0, 1.45, -.27], body: bake(B), front: bake(FB), stand: standGeo(.3), crank: bake(CB), pedal: bake(PB), bb: [0, BB[0], BB[1]], pedals: [[.14, .17, 0], [-.14, -.17, 0]],
      wheelF: cycleWheelGeo({ R, tw: .046, th: .046, hubR: .028, hubW: .08, rimM: M.dkm, hubM: M.dkm, spoke, holes: 26, trep: 6 }), wheelR: cycleWheelGeo({ R, tw: .046, th: .046, hubR: .045, hubW: .1, rimM: M.dkm, hubM: M.dkm, spoke, holes: 26, trep: 6 }),
      pivot: [hy, hz, rake], axF: [R, zF], axR: [[0, R, zR]], seat: [0, .9, -.27], grip: [.27, 1.06, .25], feet: [[.14, .3, BB[1]], [-.14, .3, BB[1]]], standAt: [.05, .29, -.4], standRot: [[1.45, 0], [.25, .5]], parkLean: -.13, two: true, beam: .15, pedal_: true }; };

  /* H4: a street motorcycle (original naked-bike shape: round lamp, teardrop tank, flat seat with a short tail, exposed twin-cylinder block with fins, one long chrome exhaust on the right).
     Built on the escooter's atlas and its two-wheeler slot — make('moto') or make('escooter', {moto: true}) — so the game rides, parks and hijacks it through the existing two-wheeler code. */
  CYC.moto = v => { LAY = LAYS.escooter; const G_ = (x, w) => Math.exp(-(x * x) / (w * w)), sm_ = (x, a, b) => sst(x, a, b), B = new Builder(), R = .305, zF = .76, zR = -.66, rake = .47, hy = 1.02, hz = .36, tn = Math.tan(rake), zA = y => hz + (hy - y) * tn, ENG = { c: [.2, .2, .21], r: .42, m: .85 }, FIN = { c: [.32, .32, .33], r: .38, m: .9 }, BLK = { c: [.03, .03, .032], r: .5, m: .3 }, PV = [0, .43, -.16];
    // frame: backbone, twin down tubes, cradle, rear subframe
    B.tube(BLK, [[0, .97, zA(.97)], [0, .9, .12], [0, .82, -.18], [0, .76, -.5]], .02, { seg: 8 });
    B.sym(() => { B.tube(BLK, [[.03, .93, zA(.93)], [.07, .62, .36], [.085, .34, .28], [.085, .3, -.05], [.06, PV[1], PV[2]]], .015, { seg: 8 }); B.tube(BLK, [[.06, PV[1], PV[2]], [.09, .62, -.22], [.1, .76, -.5], [.085, .8, -.82]], .013, { seg: 8 }); rod(B, BLK, [.09, .62, -.22], [.03, .82, -.2], .011, 6);
      /* swingarm, shock, footpeg, passenger peg */
      B.tube({ c: [.3, .3, .31], r: .4, m: .9 }, [[.075, PV[1], PV[2]], [.1, R + .02, -.4], [.1, R, zR]], .019, { seg: 8 }); B.box(BLK, .014, .06, .07, .1, R, zR, { bevel: .008 }); rod(B, M.chr, [.115, .7, -.4], [.115, R + .06, zR + .06], .012, 8); B.tube({ c: lin(0x8a1414), r: .5 }, [[.115, .66, -.42], [.115, R + .1, zR + .04]], .022, { seg: 10 });
      rod(B, M.alu, [.09, .34, -.14], [.2, .33, -.15], .011, 8); B.cyl(M.rubber, .016, .016, .07, .215, .33, -.15, { rz: HP, seg: 10 }); rod(B, M.alu, [.1, .52, -.42], [.19, .5, -.44], .008, 6); });
    // engine: crankcase, two finned cylinders leaning forward, head covers, side covers
    B.box(ENG, .26, .2, .34, 0, .4, .06, { bevel: .05 }); B.cyl(FIN, .1, .1, .05, .14, .42, .02, { rz: HP, seg: 20 }); B.cyl(FIN, .085, .085, .05, -.14, .42, .04, { rz: HP, seg: 20 }); B.cyl(M.chr, .05, .05, .012, .168, .42, .02, { rz: HP, seg: 16 });
    for (const sx of [-.07, .07]) { B.push(sx, .5, .12, { rx: .35 }); B.cyl(ENG, .058, .062, .2, 0, .1, 0, { seg: 14 }); for (let k = 0; k < 6; k++) B.box(FIN, .135, .008, .135, 0, .03 + k * .028, 0, { bevel: .003 }); B.box(FIN, .13, .045, .15, 0, .215, 0, { bevel: .018 }); B.pop(); }
    B.box(BLK, .2, .16, .16, 0, .6, -.16, { bevel: .04 }); B.cyl(FIN, .034, .04, .1, .12, .62, -.14, { rz: HP, seg: 12 }); B.cyl(FIN, .034, .04, .1, -.12, .62, -.14, { rz: HP, seg: 12 });
    // exhaust: two headers down the front, collected under the engine, one long silencer on the right
    for (const sx of [-.07, .07]) B.tube(M.chr, [[sx, .66, .21], [sx * 1.2, .5, .34], [sx * 1.3, .3, .3], [-.11, .25, .05]], .019, { seg: 10 });
    B.tube(M.chr, [[-.11, .25, .05], [-.15, .26, -.22], [-.17, .34, -.46]], .024, { seg: 10 }); B.tube({ c: [.62, .62, .63], r: .25, m: 1 }, [[-.17, .34, -.46], [-.185, .42, -.9]], .046, { seg: 14 }); B.cyl(BLK, .03, .03, .012, -.187, .425, -.925, { rx: HP - .18, seg: 12 });
    // tank (teardrop, knee cut-outs), filler cap, seat, tail cowl
    skin(B, 'paint', 22, 18, (u, w) => { const z = lerp(.34, -.22, u), a = w * TAU, pr = Math.pow(Math.sin(PI * Math.min(1, u * 1.08 + .02)), .55), hw = (.15 - .05 * u) * pr * (1 - .22 * G_(u - .72, .2) * Math.pow(Math.abs(Math.cos(a)), 3)), hh = (.105 - .035 * u) * pr; return [hw * Math.cos(a), .86 - .03 * u + hh * Math.sin(a) + .02 * pr, z]; }, { face: [1, 0, 0] });
    B.cyl(M.chr, .034, .034, .014, 0, .975, .14, { seg: 16 }); B.cyl(BLK, .024, .024, .016, 0, .98, .14, { seg: 12 });
    skin(B, SEATM, 16, 10, (u, w) => { const z = lerp(-.2, -.76, u), a = lerp(-HP, HP + PI, w), hw = .13 - .02 * u, y0 = .8 + .05 * sm_(u, .55, .8) - .02 * G_(u - .25, .2); return [hw * Math.cos(a) * (Math.sin(a) < 0 ? 1 : 1), y0 + .045 * Math.sin(a) * (Math.sin(a) < 0 ? .5 : 1), z]; }, { face: [0, 1, 0] });
    skin(B, 'paint', 12, 10, (u, w) => { const z = lerp(-.56, -.92, u), a = lerp(0, PI, w), hw = (.125 - .06 * u * u), y0 = .8 + .06 * u; return [hw * Math.cos(a), y0 + (.07 - .03 * u) * Math.sin(a), z]; }, { face: [0, 1, 0], two: true });
    B.sym(() => { B.box('paint', .012, .15, .26, .095, .66, -.3, { bevel: .03, rx: .12 }); });
    // rear fender, tail lamp, plate, indicators, chain guard
    skin(B, BLK, 14, 4, (u, w) => { const a = lerp(.35, 2.2, u), b = w * 1.2, r = R + .035 - .016 * (1 - Math.cos(b)); return [.07 * Math.sin(b) / Math.sin(1.2), R + r * Math.sin(a), zR + r * Math.cos(a)]; }, { face: [0, 1, 0], sym: true, cx: true, two: true });
    B.box(lens('redDk', CH.rl), .1, .04, .02, 0, .84, -.935, { bevel: .01 }); B.box(BLK, .2, .13, .008, 0, .66, -.99, { rx: .2, bevel: .003 }); B.decal(M.decal, .18, .11, 0, .66, -.9945, uvOf('plate'), { ry: PI, rx: -.2 }); rod(B, BLK, [0, .78, -.9], [0, .7, -.98], .01, 6);
    B.sym(() => { rod(B, BLK, [.05, .8, -.88], [.15, .8, -.9], .006, 5); B.sph(lens('amber', 0), .022, .16, .8, -.9, { seg: 10, seg2: 8, s: [1.3, 1, 1] }); });
    B.box(BLK, .012, .05, .42, .12, R + .1, -.42, { bevel: .01, rx: -.1 });
    const FB = new Builder(), fr = cycleFront(FB, { hy, hz, rake, R, phone: false, mitts: false, lamp: .078 });
    return { lay: 'escooter', L: 2.08, Wd: .76, H: 1.3, color: 0x8e1b1b, metal: .55, dust: [.1, .5, .4, .9, zF, zR, R], eye: [0, 1.32, -.28], body: bake(B), front: bake(FB), stand: standGeo(.3),
      wheelF: cycleWheelGeo({ R, tw: .11, th: .095, hubR: .05, hubW: .1, rimM: M.dkm, hubM: M.dkm, spoke: { n: 5, th: .022, w0: .06, w1: .034, ms: M.dkm, sweep: .02 }, disc: .13, discX: .05 }),
      wheelR: cycleWheelGeo({ R, tw: .15, th: .11, hubR: .06, hubW: .12, rimM: M.dkm, hubM: M.dkm, spoke: { n: 5, th: .026, w0: .07, w1: .04, ms: M.dkm, sweep: .02 }, disc: .11, discX: -.07 }),
      glow: null, glowK: 0, pivot: [hy, hz, rake], axF: [R, zF], axR: [[0, R, zR]], seat: [0, .8, -.3], grip: fr.grip, feet: [[.2, .36, -.15], [-.2, .36, -.15]], standAt: [.1, .3, -.1], standRot: [[1.43, 0], [0, .78]], parkLean: -.16, two: true, beam: .3, moto: true }; };

  CYC.trike = v => { LAY = LAYS.trike; const B = new Builder(), R = .24, zF = 1.28, zR = -.7, rake = .464, BL = 'metal_painted_blue', RU = 'metal_rust', crates = v.load === 'crates', r = GT.rng('trike' + v.load);
    const fz = -.7, FLy = .52;                                                                                        // bed centre z, floor top
    // ---- chassis: spine, bed frame, axle with motor, leaf springs, flaps
    B.tube(BL, [[0, .62, 1.02], [0, .42, .9], [0, .3, .72], [0, .3, .1]], .03, { seg: 8 }); B.sym(() => { B.box(M.dkm, .05, .06, 1.62, .34, .465, fz, { bevel: .01 }); B.box(M.dkm, .04, .012, .7, .34, .36, zR, { bevel: .004 }); B.box(M.dkm, .04, .012, .5, .34, .345, zR, { bevel: .004 }); B.box(M.rubber, .16, .2, .008, .52, .3, zR - .3, { rx: .1 }); });
    for (const z of [.05, -.7, -1.45]) B.box(M.dkm, 1.0, .05, .05, 0, .47, z, { bevel: .01 }); B.cyl(M.dkm, .03, .03, 1.02, 0, R, zR, { rz: HP, seg: 10 }); B.sph(M.dkm, .1, 0, R, zR, { seg: 12, seg2: 8, s: [1, 1, 1.1] }); B.cyl({ c: [.3, .3, .32], r: .5, m: .9 }, .085, .085, .2, .15, R + .02, zR + .14, { rz: HP, seg: 14 });
    // ---- cargo bed: floor, ribbed sides, headboard with tube frame, tailgate with reflective tape, lamps, plate
    B.box(BL, 1.1, .03, 1.6, 0, FLy - .015, fz, { bevel: .006 }); for (const s of [-1, 1]) { B.box(BL, .028, .32, 1.6, s * .55, FLy + .16, fz, { bevel: .008 }); for (let k = 0; k < 6; k++) B.box(BL, .016, .3, .03, s * .568, FLy + .16, fz - .7 + k * .28, { bevel: .005 }); B.box(BL, .04, .03, 1.62, s * .555, FLy + .325, fz, { bevel: .01 }); B.box(RU, .03, .05, 1.58, s * .551, FLy + .012, fz, { bevel: .004 });
      B.decal({ c: [1, 1, 1], r: .75, tex: true }, 1.16, .24, s * .5772, FLy + .165, fz, uvOf('side'), { ry: s * HP }); B.decal(SCUFF, 1.5, .3, s * .5648, FLy + .16, fz, uvOf('scuff'), { ry: s * HP }); }
    B.box(BL, 1.1, .5, .028, 0, FLy + .25, fz + .8, { bevel: .008 }); B.tube(M.dkm, [[-.53, FLy + .3, fz + .8], [-.53, FLy + .78, fz + .8], [.53, FLy + .78, fz + .8], [.53, FLy + .3, fz + .8]], .014, { seg: 6, tension: 0 }); rod(B, M.dkm, [-.53, FLy + .56, fz + .8], [.53, FLy + .56, fz + .8], .01);
    B.box(BL, 1.1, .32, .028, 0, FLy + .16, fz - .8, { bevel: .008 }); B.decal({ c: [1, 1, 1], r: .6, tex: true }, 1.02, .17, 0, FLy + .19, fz - .8145, uvOf('tail'), { ry: PI }); B.decal(SCUFF, 1.0, .3, 0, FLy + .16, fz - .8148, uvOf('scuff'), { ry: PI }); B.box(RU, 1.06, .04, .03, 0, FLy + .01, fz - .8, { bevel: .004 });
    for (const s of [-1, 1]) { B.box(M.dkm, .03, .06, .012, s * .46, FLy + .3, fz - .818, { bevel: .003 }); B.box(M.blkS, .1, .07, .03, s * .47, FLy - .07, fz - .81, { bevel: .008 }); B.box(lens('red', s > 0 ? CH.rl : CH.rr), .05, .05, .02, s * .49, FLy - .07, fz - .826, { bevel: .008 }); B.box(lens('amber', s > 0 ? CH.ral : CH.rar), .035, .05, .02, s * .44, FLy - .07, fz - .826, { bevel: .008 }); }
    B.box(M.blkM, .2, .13, .008, -.2, FLy - .08, fz - .812, { bevel: .003 }); B.decal(M.plate, .182, .114, -.2, FLy - .08, fz - .8165, uvOf('plate'), { ry: PI });
    { const RW = [{ c: lin(0xc21a1a), r: .3, ch: CH.refl }, { c: [.82, .84, .86], r: .3, ch: CH.refl }]; for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let q = 0; q < 6; q++) { B.box(RW[q & 1], .006, .05, .03, sx * .567, FLy + .04 + q * .05, fz + sz * .79); B.box(RW[q & 1], .03, .05, .006, sx * .54, FLy + .04 + q * .05, fz + sz * .817); } }   /* red and white tape up the four corners of the bed */
    if (crates) { const BULB = { c: [1, .9, .7], r: .3, ch: CH.glow }; for (const sx of [-1, 1]) { rod(B, M.blkS, [sx * .58, FLy + .35, fz + .8], [sx * .58, FLy + .35, fz - .8], .003, 4); for (let q = 0; q < 9; q++) B.sph(BULB, .017, sx * .58, FLy + .335, fz + .72 - q * .18, { seg: 6, seg2: 4 }); } for (let q = 0; q < 6; q++) B.sph(BULB, .017, -.45 + q * .18, FLy + .335, fz - .83, { seg: 6, seg2: 4 }); }
    // ---- rider station: battery box, bench, foot plate
    B.box(M.blkM, .5, .3, .36, 0, .5, .42, { bevel: .02 }); B.box(SEATM, .52, .09, .36, 0, .7, .42, { bevel: .035 }); B.box(SEATM, .46, .2, .05, 0, .86, .225, { bevel: .02, rx: -.1 }); B.box(TAPE, .12, .094, .37, .12, .7, .42, { bevel: .035 });
    B.box(BL, .62, .014, .46, 0, .3, .78, { bevel: .004 }); B.box(M.rubber, .56, .008, .4, 0, .311, .78, { bevel: .002 }); B.box(RU, .6, .012, .05, 0, .3, .99); B.sym(() => rod(B, M.dkm, [.28, .3, .6], [.34, .46, .1], .012));
    // ---- load
    if (!crates) { const CBc = lin(0x98805f); let y = FLy; for (let k = 0; k < 15; k++) { const t = .03 + r() * .04, w = .82 + r() * .22, d = 1.05 + r() * .42, sh = .78 + r() * .34; B.box({ c: [CBc[0] * sh, CBc[1] * sh, CBc[2] * sh], r: .92 }, w, t, d, (r() - .5) * .08, y + t / 2, fz + (r() - .5) * .1, { bevel: .004, ry: (r() - .5) * .1 }); y += t + .002;
        if (k === 14) B.decal(D_(0, .92), .8, .75, 0, y + .001, fz, uvOf('cardT'), { rx: -HP }); }
      for (const z of [fz + .32, fz - .36]) B.tube({ c: [.5, .42, .26], r: .9 }, [[.56, FLy + .28, z], [.5, y + .01, z], [0, y + .02, z], [-.5, y + .01, z], [-.56, FLy + .28, z]], .007, { seg: 5, tension: .1 });
      B.push(0, FLy + .02, fz + .72, { rx: -.14 }); for (let k = 0; k < 4; k++) B.box({ c: [CBc[0] * (.85 + k * .07), CBc[1] * (.85 + k * .07), CBc[2] * (.85 + k * .07)], r: .92 }, .9 - k * .06, 1.0 + k * .08, .02, (k - 1.5) * .03, .5 + k * .04, -k * .024, { bevel: .003 }); B.decal(D_(0, .92), .7, .66, -.045, .62, -.085, uvOf('cardT'), { ry: PI }); B.pop();
      B.sph({ c: [.42, .43, .4], r: .95 }, 1, .2, y + .13, fz - .32, { s: [.26, .15, .3], seg: 14, seg2: 10 }); B.sph({ c: [.3, .36, .42], r: .95 }, 1, -.24, y + .1, fz + .02, { s: [.2, .12, .26], seg: 12, seg2: 8 }); B.add({ c: [.5, .42, .26], r: .9 }, new T.TorusGeometry(.152, .006, 4, 16), { x: .2, y: y + .14, z: fz - .32, ry: .3 }); B.add({ c: [.5, .42, .26], r: .9 }, new T.TorusGeometry(.12, .005, 4, 14), { x: -.24, y: y + .1, z: fz + .02, ry: -.2 });
      B.box({ c: lin(0xa9824f), r: .92 }, .52, .25, .012, .18, y - .2, fz - .82, { rz: -.05 }); B.decal(D_(0, .9), .5, .235, .18, y - .2, fz - .8265, uvOf('sign'), { ry: PI, rz: .05 }); rod(B, { c: [.5, .42, .26], r: .9 }, [.0, y - .08, fz - .82], [.1, y + .02, fz - .7], .004, 4); rod(B, { c: [.5, .42, .26], r: .9 }, [.36, y - .1, fz - .82], [.3, y + .02, fz - .7], .004, 4); }
    else { const cols = [0x2e62a8, 0xb3261e, 0x2e62a8, 0x2f8a4a, 0xb3261e, 0x2e62a8], fruit = [0xe0801c, 0xe0801c, 0xc9b63a, 0xe0801c, 0x9ab53a, 0xc23a2a]; let n = 0;
      for (let lv = 0; lv < 2; lv++) for (let iz = 0; iz < 3; iz++) for (let ix = 0; ix < 2; ix++) { if (lv && (iz === 2 || (iz === 1 && ix === 1))) continue; const cx = (ix - .5) * .52, cz = fz + .52 - iz * .5, cy = FLy + lv * .27, C = { c: lin(cols[n % 6]), r: .55 }, F = { c: lin(fruit[n % 6]), r: .5 }; n++;
        B.box(C, .5, .02, .38, cx, cy + .01, cz, { bevel: .004 }); for (const s of [-1, 1]) { B.box(C, .016, .24, .38, cx + s * .242, cy + .13, cz, { bevel: .005 }); B.box(C, .5, .24, .016, cx, cy + .13, cz + s * .182, { bevel: .005 }); B.box(M.gap, .2, .03, .02, cx, cy + .2, cz + s * .183); } B.box(C, .52, .024, .4, cx, cy + .25, cz, { bevel: .006 }); B.box(M.gap, .47, .026, .35, cx, cy + .251, cz);
        if (lv || iz === 2 || (iz === 1 && ix === 1)) for (let k = 0; k < 16; k++) B.sph(F, .042 + r() * .008, cx + ((k % 4) - 1.5) * .105 + (r() - .5) * .03, cy + .25 + r() * .03, cz + (((k / 4) | 0) - 1.5) * .08 + (r() - .5) * .02, { seg: 8, seg2: 6 }); }
      B.box({ c: lin(0xa9824f), r: .92 }, .52, .25, .012, 0, FLy + .5, fz - .79, { rx: .15 }); B.decal(D_(0, .9), .5, .235, 0, FLy + .501, fz - .797, uvOf('sign'), { ry: PI, rx: -.15 });
      B.cyl(M.chr, .012, .012, 1.7, -.5, FLy + .85, fz + .75, { seg: 8 }); skin(B, (i, j) => ({ c: lin(j & 1 ? 0xb3261e : 0xd8d2c0), r: .8 }), 2, 10, (u, w) => [-.2 + cos(w * TAU) * u * 1.0, FLy + 1.92 - .32 * u * u, fz + .45 + sin(w * TAU) * u * 1.0], { face: [0, 1, 0], fi: 1, two: true }); rod(B, M.chr, [-.5, FLy + 1.7, fz + .75], [-.2, FLy + 1.9, fz + .45], .01); }
    const FB = new Builder(), fr = cycleFront(FB, { hy: 1.0, hz: .9, rake, R, phone: false, mitts: v.mitts !== false, lamp: .055 });
    FB.box('paint', .3, .34, .02, 0, .78, .9 + .2 * Math.tan(rake) + .07, { bevel: .008, rx: -rake }); FB.decal(M.decal, .1, .1, 0, .8, .9 + .2 * Math.tan(rake) + .083, uvSub('scuff', 0, 0, .5, .5), { rx: -rake });
    const wr = { R, tw: .1, th: .09, hubR: .06, hubW: .1, rimM: M.dkm, hubM: M.dkm, spoke: { n: 6, th: .02, w0: .05, w1: .034, ms: { c: [.3, .3, .31], r: .55, m: .8 } } };
    return { lay: 'trike', L: 3.1, Wd: 1.2, H: crates ? 2.3 : 1.75, color: 0x1f4f9a, metal: .1, dust: [.15, .6, .7, 1.5, zF, zR, R], eye: [0, 1.3, .4], body: bake(B), front: bake(FB), stand: null,
      wheelF: cycleWheelGeo(Object.assign({ disc: .09, discX: .047 }, wr)), wheelR: cycleWheelGeo(wr), glow: crates ? 0xffa238 : null, glowK: .6, pivot: [1.0, .9, rake], axF: [R, zF], axR: [[.52, R, zR], [-.52, R, zR]], seat: [0, .745, .4], grip: fr.grip, feet: [[.14, .315, .68], [-.14, .315, .71]], two: false, beam: .5, blue: true }; };

  /* ================================================================== templates + instances */
  let LASTMIR = null;   /* centre of the stalk-mirror glass the last cycleFront built (vehicle space, +x side) */
  const TPL = {}, KINDS = ['escooter', 'sharebike', 'trike', 'taxi', 'police', 'van', 'sports', 'bus', 'laotoule', 'sedan', 'suv', 'copsuv', 'hatch', 'pickup', 'muscle', 'boxtruck', 'ambulance'];
  /** warpGeo(geometry, f): move every vertex through f(x, y, z) -> [x, y, z] and rebuild its normal from the warped tangent plane (finite differences), so smooth panels stay smooth and hard edges stay hard */
  function warpGeo(g, f) { const P = g.attributes.position, N = g.attributes.normal, e = .004, a = new T.Vector3(), b = new T.Vector3(), n = new T.Vector3(), t1 = new T.Vector3(), t2 = new T.Vector3();
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), p = f(x, y, z);
      if (N) { n.set(N.getX(i), N.getY(i), N.getZ(i)); t1.set(abs(n.y) < .9 ? 0 : 1, abs(n.y) < .9 ? 1 : 0, 0).cross(n).normalize(); t2.crossVectors(n, t1);
        const q1 = f(x + t1.x * e, y + t1.y * e, z + t1.z * e), q2 = f(x + t2.x * e, y + t2.y * e, z + t2.z * e); a.set(q1[0] - p[0], q1[1] - p[1], q1[2] - p[2]); b.set(q2[0] - p[0], q2[1] - p[1], q2[2] - p[2]); a.cross(b); if (a.lengthSq() > 1e-14) { a.normalize(); N.setXYZ(i, a.x, a.y, a.z); } }
      P.setXYZ(i, p[0], p[1], p[2]); }
    P.needsUpdate = true; if (N) N.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere(); }
  /** CAR r1: brake calipers, one per wheel, a curved block over the rotor behind the spokes (top-rear of the front wheels, top-front of the rear ones). Built in final vehicle space (after any warp) and merged into the body's detail mesh: no draw call of their own, and they stay put while the wheel spins */
  function caliperGeo(S, kind) { const w = S.wheel, W = S.wheels, B = new Builder(), hw = w.w / 2, xc = hw - (w.dish || .05), rr = w.rim, red = /^(sports|muscle)/.test(kind), CAL = red ? { c: [.62, .035, .03], r: .32, m: .1 } : { c: [.1, .1, .105], r: .42, m: .5 };
    B.sym(() => { for (const front of [true, false]) { const sc = front ? [1, 1] : (W.rear || [1, 1]), k = sc[1], R = w.R * k, r = (rr - .052) * k, x = (xc - .046) * sc[0]; B.push(front ? W.fx : W.rx, R, front ? W.fz : W.rz);
      for (let j = -1; j <= 1; j++) { const a = (front ? 1.95 : 1.2) + j * .25; B.box(CAL, .036 * sc[0], .036 * k, .064 * k, x, r * sin(a), r * cos(a), { rx: -(a + HP), bevel: .008 }); }
      const a = front ? 1.95 : 1.2; B.box(CAL, .02 * sc[0], .03 * k, .1 * k, x + .016 * sc[0], (r + .004) * sin(a), (r + .004) * cos(a), { rx: -(a + HP), bevel: .006 }); B.pop(); } });
    return B.bags.detail.build(true); }
  function mergeGeo(a, b) { for (const n in a.attributes) { const A = a.attributes[n], Bt = b.attributes[n]; if (!Bt) throw new Error('mergeGeo: ' + n); const arr = new Float32Array(A.array.length + Bt.array.length); arr.set(A.array); arr.set(Bt.array, A.array.length); a.setAttribute(n, new T.BufferAttribute(arr, A.itemSize)); }
    const o = a.index ? 0 : 0, na = a.attributes.position.count - b.attributes.position.count, ia = a.index.array, ib = b.index.array, ix = new Uint32Array(ia.length + ib.length); ix.set(ia); for (let i = 0; i < ib.length; i++) ix[ia.length + i] = ib[i] + na + o; a.setIndex(new T.BufferAttribute(ix, 1)); a.computeBoundingSphere(); return a; }
  function carTpl(kind) { if (TPL[kind]) return TPL[kind]; let S = DEFS[kind](); LAY = LAYS[S.layout || 'car']; const B = new Builder(); S.build(B); const bk = bake(B);
    if (S.scale) { const k = S.scale, m = new T.Matrix4().makeScale(k[0], k[1], k[2]); for (const n of ['paint', 'detail']) if (bk[n]) { bk[n].applyMatrix4(m); bk[n].computeBoundingSphere(); } if (bk.std) for (const c of bk.std.children) { c.geometry.applyMatrix4(m); c.geometry.computeBoundingSphere(); }
      S = Object.assign({}, S, { L: S.L * k[2], Wd: S.Wd * k[0], H: S.H * k[1], dust: [S.dust[0] * k[1], S.dust[1] * k[1], S.dust[2], S.dust[3] * k[2]], wheels: { fz: S.wheels.fz * k[2], rz: S.wheels.rz * k[2], fx: S.wheels.fx * k[0], rx: S.wheels.rx * k[0] }, arches: S.arches.map(a => ({ R: a.R * k[2] })) }); }   /* a squeezed loft (老头乐): the instance reads its sizes from this copy */
    if (S.warp) { const geos = []; for (const n of ['paint', 'detail']) if (bk[n]) geos.push(bk[n]); if (bk.std) for (const c of bk.std.children) geos.push(c.geometry); for (const g of geos) warpGeo(g, S.warp); }   /* g6: derived body styles (suv, hatch, pickup, muscle) are a base loft pushed through a smooth warp */
    if (!S.scale && S.layout !== 'bus' && bk.detail) { try { const cg = caliperGeo(S, kind); mergeGeo(bk.detail, cg); bk.tris += cg.index.count / 3; } catch (err) { console.warn('cnvehicles calipers', err); } }
    const t = { S, bk, tris: bk.tris }; t.wheel = wheelGeo(S.wheel); t.tris += t.wheel.index.count / 3 * 4; t.fx = fxGeo(S.L, S.Wd, kind === 'police' || !!S.siren); S._bd = S._gh = null; return TPL[kind] = t; }
  function cycTpl(kind, v) { const key = kind + (v.mitts ? '+m' : v.mitts === false ? '-m' : '') + (v.load ? '+' + v.load : '') + (v.box === false ? '-box' : '') + (v.patrol ? '+p' : '') + (v.moto ? '+moto' : ''); if (TPL[key]) return TPL[key]; LASTMIR = null; const t = CYC[v.moto ? 'moto' : kind](v); t.mirC = LASTMIR; t.fx = fxGeo(t.L, t.Wd, !!v.patrol);
    t.tris = t.body.tris + t.front.tris + (t.stand ? t.stand.tris : 0) + (t.crank ? t.crank.tris + 2 * t.pedal.tris : 0) + t.wheelF.index.count / 3 + t.wheelR.index.count / 3 * t.axR.length; return TPL[key] = t; }
  let WM = null; const wheelMat = () => { if (WM) return WM; const t = wheelTex(); return WM = detailMat(t.plain, t.nrm); };
  const PCH = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  const mkPlate = (rnd, pre, n) => { let s = ''; for (let i = 0; i < (n || 5); i++) s += PCH[(rnd() * (i < 1 ? 24 : PCH.length)) | 0]; return (pre === undefined ? '' : pre) + s; };

  /** lamp channels + ground light pools; shared by every kind */
  function lightRig(car, dm, fxm, o) { const L = car.lights = { head: 0, brake: 0, reverse: 0, left: 0, right: 0, siren: 0, hazard: 0, free: o.free ? 1 : 0, cabin: -1, glow: -1 }, GC = o.glow ? lin(o.glow) : null, lv = dm.userData.gtLv, beam = o.beam === undefined ? 1 : o.beam; let tm = o.phase || 0, dirty = true, lastN = -1, lastW = -1;
    car.blinkOn = false; car.sirenPhase = 0;
    car.setBeam = k => { if (car.beamK !== k) { car.beamK = k; dirty = true; } return car; };   /* the hero's own machine: a stronger road pool than the traffic's (js/cngame.js) */
    car.setLights = q => { for (const k in q) if (k in L) { const v = q[k] === true ? 1 : +q[k] || 0; if (L[k] !== v) { L[k] = v; dirty = true; } } return car; };
    car._lights = dt => { MIRN.value = (GT.env && GT.env.night) || 0; tm += dt || 0; const n = MIRN.value, wetR = min(1, max(0, +(GT.env && GT.env.wet) || 0)), bl = (tm * 1.45) % 1 < .5, sir = L.siren > 0; if (!dirty && !sir && !(L.left || L.right || L.hazard) && abs(n - lastN) < .01 && abs(wetR - lastW) < .04) return; car.blinkOn = bl; dirty = false; lastN = n; lastW = wetR;
      const k = lerp(1, .5, n), il = (L.left || L.hazard) && bl ? 1 : 0, ir = (L.right || L.hazard) && bl ? 1 : 0, hd = L.head, set = (c, r, g, b) => lv[c].set(r, g, b), cab = L.cabin < 0 ? (o.autoCabin && (n > .35 || hd) ? 1 : 0) : L.cabin;
      { const hk = lerp(1, .26, n) * hd; set(CH.head, 62 * hk, 56 * hk, 44 * hk); }   /* at night the lens is dimmer on screen: at 31 it fed the streak pass and drew a white bar across the frame and over the vehicle */ set(CH.fl, hd * 1.6 + il * 26 * k, hd * 1.6 + il * 26 * k, hd * 1.6 + il * 22 * k); set(CH.fr, hd * 1.6 + ir * 26 * k, hd * 1.6 + ir * 26 * k, hd * 1.6 + ir * 22 * k);
      const rl = hd * 3.2 + L.brake * 30 * k; set(CH.rl, rl, rl * .35, rl * .35); set(CH.rr, rl, rl * .35, rl * .35);
      set(CH.rev, L.reverse * 16 * k, L.reverse * 16 * k, L.reverse * 15 * k); set(CH.stop, L.brake * 34 * k, L.brake * 10 * k, L.brake * 10 * k); set(CH.mark, hd * 3, hd * 3, hd * 3); set(CH.ral, hd * .6 + il * 26 * k, hd * .6 + il * 26 * k, hd * .6 + il * 20 * k); set(CH.rar, hd * .6 + ir * 26 * k, hd * .6 + ir * 26 * k, hd * .6 + ir * 20 * k); set(CH.white, hd * 6, hd * 6, hd * 6);
      let sr = 0, sb = 0; if (sir) { const p = (tm * 1.9) % 1, f = (sin(tm * 1.9 * TAU * 5) > -.2) ? 1 : .04; if (p < .5) sr = f; else sb = f; car.sirenPhase = p; }
      set(CH.sirR, sr * 90 * k, sr * 9 * k, sr * 7 * k); set(CH.sirB, sb * 14 * k, sb * 26 * k, sb * 110 * k);
      const sc = lerp(1.0, .8, n), led = lerp(2.8, 2.0, n), fr = L.free * lerp(1.1, 4.2, n); set(CH.scr, sc, sc, sc); set(CH.led, led, led, led); set(CH.taxi, fr * .78, fr, fr * .98);   /* the roof box is the cold blue-white lamp of the street, not a warm bulb */ set(CH.cabin, cab * 18 * k, cab * 17 * k, cab * 14 * k); const am = cab * lerp(.16, .5, n); set(CH.amb, am, am * .96, am * .86);
      const gk = GC ? (L.glow < 0 ? sst(n, .18, .5) : L.glow) : 0, ge = gk * lerp(1.0, 6.5, n); if (GC) set(CH.glow, GC[0] * ge, GC[1] * ge, GC[2] * ge); else set(CH.glow, 0, 0, 0); { const rf = n * 1.25 + hd * n * .5; set(CH.refl, rf, rf, rf * 1.06); }
      if (fxm) { const c = fxm.material.uniforms.uCol.value, hp = hd * (.004 + .05 * n) * beam * (car.beamK || 1) * (1 - .45 * wetR);   /* a wet road throws the beam forward instead of back at the rider: the pool dims and the reflections take over */ c[1].set(hp, hp * .86, hp * .62); const tp = (hd * .006 + L.brake * .035) * (.15 + .85 * n) * min(1, beam * 1.6); c[2].set(tp, tp * .08, tp * .06); c[3].set(sr * (.01 + .1 * n), sr * .004, sr * .004); c[4].set(sb * .008, sb * .016, sb * (.012 + .12 * n)); const gp = gk * (.006 + .17 * n) * (1 + .5 * wetR) * (o.glowK || 1); if (GC) c[0].set(GC[0] * gp, GC[1] * gp, GC[2] * gp); else c[0].set(0, 0, 0); } }; }
  const mount = (parent, p) => { const o = new T.Object3D(); o.position.set(p[0], p[1], p[2]); parent.add(o); return o; };

  function makeCar(kind, opts, key) { const t = carTpl(key || kind), S = t.S, group = new T.Group(); group.name = 'cnv_' + kind; if (S.openTop) group.userData.openTop = true;   /* js/cockpit.js hides its roof liner, cant rails and C pillars in this car */
    const rnd = GT.rng(kind + (opts.seed || opts.plate || '') + (make.n = (make.n || 0) + 1)), plate = opts.plate || mkPlate(rnd), unit = String(opts.unit || (kind === 'police' || S.siren ? 500 + ((rnd() * 99) | 0) : '')), route = String(opts.route || '521');
    const color = (S.fixedColor || opts.color === undefined) ? S.color : opts.color, meshes = {};
    const add = (name, geo, mat) => { const m = new T.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.name = name; group.add(m); meshes[name] = m; return m; };
    const dust = S.dust.slice(0, 4); if (opts.dirt !== undefined) dust[2] = opts.dirt; dust.push(S.wheels.fz, S.wheels.rz, S.arches[0].R); add('paint', t.bk.paint, paintMat(color, dust));
    const dm = detailMat(atlas(S.paint || kind, { plate, unit, route }), null, { alphaTest: .5, offset: true }); add('detail', t.bk.detail, dm);
    if (t.bk.std) for (const m of t.bk.std.children) { const c = m.clone(); c.name = m.material.name; group.add(c); meshes[c.name] = c; }
    const wm = wheelMat(), wheels = [], steer = [], W = S.wheels, R = S.wheel.R;
    for (let i = 0; i < 4; i++) { const front = i < 2, left = i % 2 === 0, piv = new T.Group(), sp = new T.Group(), mesh = new T.Mesh(t.wheel, wm), sc = front ? [1, 1] : (W.rear || [1, 1]);
      mesh.castShadow = mesh.receiveShadow = true; mesh.scale.set(sc[0], sc[1], sc[1]); if (!left) mesh.rotation.y = PI; sp.add(mesh); piv.add(sp); piv.position.set((left ? 1 : -1) * (front ? W.fx : W.rx), R * sc[1], front ? W.fz : W.rz); group.add(piv); wheels.push(sp); if (front) steer.push(piv); }
    let fxm = null; if (opts.fx !== false) { fxm = new T.Mesh(t.fx, fxMat(S.L, S.Wd)); fxm.renderOrder = 2; fxm.name = 'fx'; group.add(fxm); meshes.fx = fxm; }
    const I = S.interior, seat = mount(group, S.seatAt || [.37, I.floor + .25, I.seatZ]); seat.gripL = mount(group, [seat.position.x + .17, seat.position.y + .42, seat.position.z + .42]); seat.gripR = mount(group, [seat.position.x - .17, seat.position.y + .42, seat.position.z + .42]); seat.footL = mount(group, [seat.position.x + .12, seat.position.y - .22, seat.position.z + .6]); seat.footR = mount(group, [seat.position.x - .12, seat.position.y - .22, seat.position.z + .6]);
    const car = { group, kind, meshes, wheels, steer, seat, twoWheeler: false, plate, lean: () => car, setStand: () => car, vkey: key || kind, color0: color, dust,   /* SH: js/carmods.js reads the template key, the factory colour and the dust set to rebuild this car's paint */
      dims: { L: S.L, W: S.Wd, H: S.H, wheelbase: W.fz - W.rz, track: W.fx * 2, wheelR: R, wheelRRear: R * (W.rear ? W.rear[1] : 1), axleF: W.fz, axleR: W.rz, eye: S.eye.slice(), seatH: seat.position.y } };
    lightRig(car, dm, fxm, { free: kind === 'taxi' && opts.free !== false && !S.noRoof, autoCabin: kind === 'bus', phase: opts.wedding ? 0 : rnd() * 3, glow: opts.glow === false ? null : (opts.glow === undefined || opts.glow === true ? S.glow : opts.glow) }); car.update = dt => car._lights(dt);
    if (opts.wedding) { try { dressWedding(car, opts.wedding, S); } catch (err) { console.warn('cnvehicles wedding', err); } }
    if (opts.lights) car.setLights(opts.lights); car.update(0); return car; }

  function makeCycle(kind, opts) { if (opts.patrol && kind === 'escooter') opts = Object.assign({}, opts, { box: false }); const t = cycTpl(kind, { mitts: opts.mitts, load: opts.load, box: opts.box, patrol: kind === 'escooter' && !!opts.patrol, moto: kind === 'escooter' && !!opts.moto }), group = new T.Group(), lean = new T.Group(); group.name = 'cnv_' + kind; lean.name = 'lean'; group.add(lean);
    const rnd = GT.rng(kind + (opts.seed || opts.plate || '') + (make.n = (make.n || 0) + 1)), plate = opts.plate || (kind === 'sharebike' ? mkPlate(rnd, 'JC', 6) : mkPlate(rnd, '江城', 5)), meshes = {};
    const color = opts.color === undefined ? t.color : opts.color, dust = t.dust.slice(); if (opts.dirt !== undefined) dust[2] = opts.dirt;
    const pm = paintMat(color, dust, t.metal), dm = detailMat(atlas(kind, { plate, load: opts.load }), null, { alphaTest: .5, offset: true, mBias: .47, mC: t.mirC });
    const mesh = (parent, geo, mat, name) => { const m = new T.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; m.name = name; parent.add(m); meshes[name] = m; return m; };
    const addBake = (parent, bk, tag) => { if (bk.paint) mesh(parent, bk.paint, pm, tag + 'paint'); if (bk.detail) mesh(parent, bk.detail, dm, tag + 'detail'); if (bk.std) for (const m of bk.std.children) { const c = m.clone(); c.name = tag + m.material.name; parent.add(c); meshes[c.name] = c; } };
    addBake(lean, t.body, '');
    // steering pivot about the raked head tube: rk tilts the axis, st is what the game turns (rotation.y), inner undoes rk so the fork geometry stays in vehicle space
    const rk = new T.Group(), st = new T.Group(), inner = new T.Group(); rk.position.set(0, t.pivot[0], t.pivot[1]); rk.rotation.x = -t.pivot[2]; rk.updateMatrix(); inner.matrixAutoUpdate = false; inner.matrix.copy(rk.matrix).invert(); rk.add(st); st.add(inner); lean.add(rk); st.name = 'steer'; addBake(inner, t.front, 'front_');
    const wm = wheelMat(), wheels = [], wf = new T.Group(); wf.position.set(0, t.axF[0], t.axF[1]); inner.add(wf); mesh(wf, t.wheelF, wm, 'wheelF'); wheels.push(wf);
    t.axR.forEach((p, i) => { const g = new T.Group(); g.position.set(p[0], p[1], p[2]); lean.add(g); const m = mesh(g, t.wheelR, wm, 'wheelR' + i); if (p[0] < 0) m.rotation.y = PI; wheels.push(g); });
    let standP = null; if (t.stand) { standP = new T.Group(); standP.position.set(t.standAt[0], t.standAt[1], t.standAt[2]); lean.add(standP); addBake(standP, t.stand, 'stand_'); }
    let crank = null; const peds = []; if (t.crank) { crank = new T.Group(); crank.position.set(t.bb[0], t.bb[1], t.bb[2]); lean.add(crank); addBake(crank, t.crank, 'crank_'); for (const p of t.pedals) { const g = new T.Group(); g.position.set(p[0], p[1], p[2]); crank.add(g); mesh(g, t.pedal.detail, dm, 'pedal' + peds.length); peds.push(g); } }
    let fxm = null; if (opts.fx !== false) { fxm = new T.Mesh(t.fx, fxMat(t.L, t.Wd)); fxm.renderOrder = 2; fxm.name = 'fx'; group.add(fxm); meshes.fx = fxm; }
    const seat = mount(lean, t.seat); seat.gripL = mount(inner, t.grip); seat.gripR = mount(inner, [-t.grip[0], t.grip[1], t.grip[2]]); seat.footL = mount(lean, t.feet[0]); seat.footR = mount(lean, t.feet[1]);
    let roll = 0, down = false; const R = t.axF[0];
    const car = { group, kind, meshes, wheels, steer: [st], seat, twoWheeler: !!t.two, plate, crank, leanGroup: lean,
      dims: { L: t.L, W: t.Wd, H: t.H, wheelbase: t.axF[1] - t.axR[0][2], track: t.axR.length > 1 ? t.axR[0][0] * 2 : 0, wheelR: R, wheelRRear: t.axR[0][1], axleF: t.axF[1], axleR: t.axR[0][2], eye: t.eye.slice(), seatH: t.seat[1], twoWheeler: !!t.two },
      /** roll in radians; positive tips the top towards -X (the rider's right). Ignored by the trike. */
      lean(a) { roll = +a || 0; if (t.two && !down) lean.rotation.z = roll; return car; },
      /** side stand down (parked, leaning on it) or up (riding) */
      setStand(d) { down = !!d; if (standP) { const q = t.standRot[down ? 1 : 0]; standP.rotation.set(q[0], 0, q[1]); } if (t.two) lean.rotation.z = down ? t.parkLean : roll; return car; } };
    lightRig(car, dm, fxm, { beam: t.beam, phase: rnd() * 3, glow: opts.glow === false ? null : (opts.glow === undefined || opts.glow === true ? t.glow : opts.glow), glowK: t.glowK });
    car.update = dt => { car._lights(dt); if (crank) { const a = wheels[1].rotation.x * .42; crank.rotation.x = a; for (const p of peds) p.rotation.x = -a; } };
    if (kind === 'escooter' && !opts.moto) liveDash(car, inner);
    car.setStand(!!opts.parked); if (opts.lights) car.setLights(opts.lights); car.update(0); return car; }

  /* ================================================================== the hero scooter's live screens
     Two small emissive planes just above the baked decals of the speedo ('spd') and of the phone in its mount ('nav'), redrawn only when what they show changes:
       speedo  real speed (colour steps at 40 and 50 km/h), a speed tape, battery in ten cells + percent, clock, odometer that really counts, lamp tell-tale
       phone   the 跑得快 order: stage, shop and dish, destination and customer, the countdown (red under 30 s, 超时 once late), a bearing arrow + metres to the pickup or the door, the pay;
               with no order: 等单中, today's count and takings
     Only the scooter the game calls the hero's (GT.cngame.scooter) gets them, built on its first update; every other scooter keeps the baked decals. Data is read from GT.cngame (player, battery, jobs) and GT.env.hours. */
  const DFONT = '"Helvetica Neue",Arial,"PingFang SC","Heiti SC","Microsoft YaHei",sans-serif';
  function liveDash(car, host) {
    const D = car.dash = { live: false, bad: false, key: '', pkey: '', t: 0, pt: 0, odo: 28417.3, spd: null, ph: null };
    const up = car.update;
    car.update = dt => { up(dt); const g = GT.cngame, e = g && g.scooter; if (!e || e.veh !== car || D.bad || typeof document === 'undefined') return; try { dashTick(car, host, D, dt || 0, g, e); } catch (err) { D.bad = true; console.warn('cnvehicles dash', err); } };
  }
  function dashScreen(w, h, cw, ch) { const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; tex.anisotropy = 4; tex.generateMipmaps = false; tex.minFilter = T.LinearFilter;
    const mesh = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 })); mesh.renderOrder = 3; return { cv, g: cv.getContext('2d'), tex, mesh }; }
  /** pure: what the two screens must show. Returns { key, pkey, ... } so the caller redraws only on change. */
  function dashState(D, dt, g, e) {
    const P = g.player || {}, on = P.ent === e && P.mode === 'two', v = Math.abs(e.v || 0), kmh = Math.round(v * 3.6), batt = Math.max(0, Math.min(1, g.battery === undefined ? 1 : +g.battery)), pct = Math.round(batt * 100);
    if (on && dt > 0) D.odo += v * dt / 1000; D.t += dt;
    const hrs = GT.env && GT.env.hours !== undefined ? GT.env.hours : 12, hh = Math.floor(hrs) % 24, mm = Math.floor((hrs - Math.floor(hrs)) * 60), clock = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm, lamp = !!(e.lights && e.lights.head);
    const st = { on, kmh, pct, clock, lamp, odo: D.odo, key: (on ? kmh : -1) + '|' + pct + '|' + clock + '|' + (lamp ? 1 : 0) + '|' + D.odo.toFixed(1) };
    const J = g.jobs || {}, j = J.current || null; st.job = j; st.done = J.done || 0; st.earned = J.earned || 0;
    if (j) { const tg = j.state === 'pickup' ? j.from : j.to, dx = tg ? tg.x - e.x : 0, dz = tg ? tg.z - e.z : 0, dist = Math.hypot(dx, dz), brg = Math.atan2(dx, dz) - (e.h || 0), left = j.state === 'deliver' ? (j.limit || 0) - (j.t || 0) : null;
      st.dist = dist; st.brg = Math.atan2(Math.sin(brg), Math.cos(brg)); st.left = left;
      st.pkey = 'j|' + j.state + '|' + (j.shop || '') + '|' + (left === null ? 'x' : Math.ceil(left)) + '|' + Math.round(dist / (dist < 30 ? 1 : 5)) + '|' + Math.round(st.brg / .2) + '|' + clock; }
    else st.pkey = 'i|' + (Math.floor(D.t * 1.5) % 4) + '|' + st.done + '|' + Math.round(st.earned * 10) + '|' + clock + '|' + pct;
    return st;
  }
  function dashTick(car, host, D, dt, g, e) {
    if (!D.spd) { const hy = 1.0, hz = .3;   /* the escooter's bar centre (cycleFront c.hy / c.hz) */
      const a = D.spd = dashScreen(.1, .0625, 256, 160); a.mesh.rotation.order = 'YXZ'; a.mesh.rotation.set(.62 - HP, PI, 0); a.mesh.position.set(-.006, hy + .1564 + .0016, hz - .0396 - .0012);   /* sits 2 mm proud of the baked 'spd' decal on the tipped speedo head (cycleFront): it was left at the old flat-on-the-cowl spot, so the baked 25 km/h showed at every speed */ host.add(a.mesh);
      const b = D.ph = dashScreen(.069, .147, 216, 460), piv = new T.Group(); piv.position.set(.1, hy + .16, hz - .04); piv.rotation.x = .42; b.mesh.rotation.y = PI; b.mesh.position.z = -.0069; piv.add(b.mesh); host.add(piv); D.live = true; }
    const st = dashState(D, dt, g, e), night = (GT.env && GT.env.night) || 0, lum = lerp(1.7, .8, night); D.spd.mesh.material.color.setScalar(lum); D.ph.mesh.material.color.setScalar(lum * 1.05);   /* readable in sunlight, not a torch at night */
    if (st.key !== D.key) { D.key = st.key; drawSpeedo(D.spd.g, st); D.spd.tex.needsUpdate = true; }
    if (st.pkey !== D.pkey) { D.pkey = st.pkey; drawPhone(D.ph.g, st); D.ph.tex.needsUpdate = true; }
  }
  function drawSpeedo(g, st) { const W = 256, H = 160;
    g.globalAlpha = 1; g.fillStyle = '#03060a'; g.fillRect(0, 0, W, H); g.textBaseline = 'middle';
    const hot = st.kmh >= 50 ? '#ff4a32' : st.kmh >= 40 ? '#ffb017' : '#5fe3ff';
    g.fillStyle = '#7f96a6'; g.font = '700 17px ' + DFONT; g.textAlign = 'left'; g.fillText(st.clock, 12, 15); g.textAlign = 'right'; g.fillText('ODO ' + st.odo.toFixed(1), W - 12, 15);
    if (st.on) { g.fillStyle = hot; g.textAlign = 'right'; g.font = '700 86px ' + DFONT; g.fillText(String(st.kmh), 170, 74); g.textAlign = 'left'; g.font = '700 19px ' + DFONT; g.fillText('km/h', 178, 96); }
    else { g.fillStyle = '#36d671'; g.textAlign = 'center'; g.font = '700 54px ' + DFONT; g.fillText('P', W / 2, 72); }
    for (let k = 0; k < 20; k++) { const lit = st.on && k < Math.round(Math.min(1, st.kmh / 60) * 20); g.globalAlpha = lit ? 1 : .16; g.fillStyle = k >= 17 ? '#ff4a32' : k >= 13 ? '#ffb017' : '#5fe3ff'; g.fillRect(12 + k * 11.7, 112, 8.6, 7 + (k > 12 ? (k - 12) * .7 : 0)); }   /* speed tape, full at 60 km/h */
    const cells = Math.ceil(st.pct / 10), low = st.pct <= 15; for (let k = 0; k < 10; k++) { g.globalAlpha = k < cells ? 1 : .15; g.fillStyle = low ? '#ff4a32' : '#36d671'; g.fillRect(12 + k * 15.2, 135, 12.2, 14); }
    g.globalAlpha = 1; g.fillStyle = low ? '#ff4a32' : '#c9d6de'; g.font = '700 18px ' + DFONT; g.textAlign = 'right'; g.fillText(st.pct + '%', W - 44, 143);
    if (st.lamp) { g.strokeStyle = '#5fa8ff'; g.fillStyle = '#5fa8ff'; g.lineWidth = 2.4; g.beginPath(); g.arc(W - 22, 142, 7, -Math.PI / 2, Math.PI / 2); g.closePath(); g.fill(); for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(W - 27, 142 + k * 5); g.lineTo(W - 37, 142 + k * 6.5); g.stroke(); } }   /* dipped-beam tell-tale */
  }
  function drawPhone(g, st) { const W = 216, H = 460, j = st.job, money = v => '¥' + (Math.round(v * 10) / 10).toFixed(1);
    g.globalAlpha = 1; g.textBaseline = 'middle'; g.fillStyle = '#0b1017'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffc21a'; g.fillRect(0, 0, W, 50); g.fillStyle = '#16130a'; g.textAlign = 'left'; g.font = '900 25px ' + DFONT; g.fillText('跑得快', 12, 27); g.textAlign = 'right'; g.font = '700 18px ' + DFONT; g.fillText(st.clock, W - 12, 27);
    if (!j) { g.textAlign = 'center'; g.fillStyle = '#e8eef4'; g.font = '700 30px ' + DFONT; g.fillText('等单中' + '···'.slice(0, Math.floor(st.pkey.split('|')[1]) % 4), W / 2, 150);
      g.strokeStyle = '#ffc21a'; g.lineWidth = 5; g.beginPath(); g.arc(W / 2, 250, 44, 0, Math.PI * 2); g.globalAlpha = .25; g.stroke(); g.globalAlpha = 1; g.beginPath(); const a0 = (Math.floor(st.pkey.split('|')[1]) % 4) * Math.PI / 2; g.arc(W / 2, 250, 44, a0, a0 + 1.6); g.stroke();
      g.fillStyle = '#8fa0b0'; g.font = '700 20px ' + DFONT; g.fillText('今日 ' + st.done + ' 单', W / 2, 350); g.fillStyle = '#36d671'; g.font = '700 28px ' + DFONT; g.fillText(money(st.earned), W / 2, 388); g.fillStyle = '#8fa0b0'; g.font = '700 17px ' + DFONT; g.fillText('车 ' + st.pct + '%', W / 2, 432); return; }
    const pick = j.state === 'pickup', late = st.left !== null && st.left < 0, hurry = st.left !== null && st.left < 30;
    g.fillStyle = pick ? '#ffb017' : '#36d671'; g.fillRect(12, 62, 104, 30); g.fillStyle = '#0b1017'; g.textAlign = 'center'; g.font = '900 19px ' + DFONT; g.fillText(pick ? '① 去取餐' : '② 去送达', 64, 78);
    g.textAlign = 'right'; g.fillStyle = '#36d671'; g.font = '700 22px ' + DFONT; g.fillText(money(+j.pay || 0), W - 12, 78);
    g.textAlign = 'left'; g.fillStyle = pick ? '#ffffff' : '#8fa0b0'; g.font = '700 ' + (pick ? 26 : 21) + 'px ' + DFONT; g.fillText(String(j.shop || ''), 12, 122, W - 24); g.fillStyle = '#8fa0b0'; g.font = '500 17px ' + DFONT; g.fillText(String(j.dish || ''), 12, 150, W - 24);
    g.strokeStyle = '#3a4a5a'; g.lineWidth = 3; g.setLineDash([4, 6]); g.beginPath(); g.moveTo(22, 166); g.lineTo(22, 190); g.stroke(); g.setLineDash([]);
    g.fillStyle = pick ? '#8fa0b0' : '#ffffff'; g.font = '700 ' + (pick ? 21 : 26) + 'px ' + DFONT; g.fillText(String(j.where || ''), 12, 208, W - 24); g.fillStyle = '#8fa0b0'; g.font = '500 17px ' + DFONT; g.fillText(String(j.who || ''), 12, 236, W - 24);
    /* countdown */
    const fmt = s => { s = Math.abs(Math.ceil(s)); const m = Math.floor(s / 60), q = s % 60; return (m < 10 ? '0' : '') + m + ':' + (q < 10 ? '0' : '') + q; };
    g.fillStyle = late ? '#5a1010' : hurry ? '#4a1c12' : '#121c28'; g.fillRect(12, 256, W - 24, 70); g.textAlign = 'center';
    g.fillStyle = late || hurry ? '#ff4a32' : '#ffffff'; g.font = '900 46px ' + DFONT; g.fillText(st.left === null ? fmt(+j.limit || 0) : (late ? '+' : '') + fmt(st.left), W / 2, 288); g.fillStyle = late ? '#ff8a7a' : '#8fa0b0'; g.font = '700 14px ' + DFONT; g.fillText(st.left === null ? '取餐后开始计时' : late ? '已超时' : '剩余时间', W / 2, 317);
    /* bearing arrow (up = straight ahead of the bike) + metres */
    g.save(); g.translate(62, 392); g.fillStyle = '#121c28'; g.beginPath(); g.arc(0, 0, 46, 0, Math.PI * 2); g.fill(); g.rotate(-st.brg); g.fillStyle = '#ffc21a'; g.beginPath(); g.moveTo(0, -34); g.lineTo(22, 22); g.lineTo(0, 10); g.lineTo(-22, 22); g.closePath(); g.fill(); g.restore();
    g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = '900 38px ' + DFONT; g.fillText(st.dist >= 1000 ? (st.dist / 1000).toFixed(1) : String(Math.round(st.dist)), 120, 384, 84); g.fillStyle = '#8fa0b0'; g.font = '700 17px ' + DFONT; g.fillText(st.dist >= 1000 ? 'km' : 'm · ' + (pick ? '取餐点' : '顾客'), 120, 418, 88);
  }


  /* ================================================================== wedding convoy dress (opts.wedding = 'lead' | 'follow')
     lead: a heart of roses, lilies and gerbera on a bed of palm leaves over half the bonnet, a posy on the roof, pink gauze from the posy down to both mirrors, satin bows on the mirrors and every door handle,
           a red 囍 board over the front plate. follow: a red satin sash from the screen to the nose with a rosette, bows on the mirrors and handles, the same board.
     One merged mesh per car on the car's own detail material (+ one shared board material). Hazards of a convoy blink together (lightRig phase 0). */
  const WEDG = {}; let WEDM = null;
  function wedBoard() { if (WEDM) return WEDM; const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#c8141c'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#f2cf6a'; g.lineWidth = 6; g.strokeRect(6, 6, 244, 116); g.fillStyle = '#f2cf6a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 84px ${CJK}`; g.fillText('囍', 60, 68); g.font = `900 40px ${CJK}`; g.fillText('百年', 172, 42); g.fillText('好合', 172, 90);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return WEDM = new T.MeshStandardMaterial({ map: t, roughness: .55, metalness: 0 }); }
  function dressWedding(car, role, S) { const lead = role === 'lead', key = car.kind + '|' + role + '|' + S.L; let geo = WEDG[key];
    if (!geo) { const B = new Builder(), r = GT.rng('wed' + key), RED = { c: lin(0xb4101a), r: .62 }, RED2 = { c: lin(0xd8283a), r: .55 }, WHT = { c: lin(0xf2efe6), r: .6 }, PNK = { c: lin(0xf2a0b8), r: .6 }, ORG = { c: lin(0xf08a2a), r: .6 }, YEL = { c: lin(0xf2c82a), r: .6 }, GRN = { c: lin(0x2c6428), r: .7 }, GAUZE = { c: lin(0xf7c8d8), r: .85 }, SATIN = { c: lin(0xc8141c), r: .32 }, DKR = { c: lin(0x6e0a10), r: .7 }, DKC = { c: [.12, .06, .02], r: .8 };
      const hw = z => S.W(z), yH = (z, x) => S.yC(z) - .05 * (x / hw(z)) * (x / hw(z)) + .006, zN = S.zF - .32, zW = S.gh.keys[0][1] + .12, zc = (zN + zW) / 2, yRf = S.gh.yR(.14), zRf = S.gh.keys[0][2] - .22, mz = S.d.mirror[0], mx = hw(mz) + .1, my = S.ySh(mz) + S.d.mirror[1] + .02;
      const bow = (x, y, z, sc, ax) => { for (const sg of [-1, 1]) { const o = sg * .05 * sc; B.sph(SATIN, 1, x + (ax ? 0 : o), y + .012 * sc, z + (ax ? o : 0), { s: ax ? [.022 * sc, .042 * sc, .055 * sc] : [.055 * sc, .042 * sc, .022 * sc], seg: 8, seg2: 6 }); B.box(SATIN, ax ? .006 : .03 * sc, .12 * sc, ax ? .03 * sc : .006, x + (ax ? 0 : o * .5), y - .07 * sc, z + (ax ? o * .5 : 0), { rz: ax ? 0 : sg * .25, rx: ax ? -sg * .25 : 0 }); } B.sph(RED2, .022 * sc, x, y + .01 * sc, z, { seg: 8, seg2: 6 }); };
      B.sym(() => { bow(mx + .03, my + .06, mz, 1.3, 1); for (const hz of S.d.handles) bow(S.W(hz) + .035, S.d.handleY + .01, hz, 1, 1); });
      if (lead) { /* heart: points filled inside the curve, bigger blooms on the rim */
        const n = 140, HX = .52, HZ = .42; for (let q = 0; q < n; q++) { const rim = q < 46, f = rim ? 1 : Math.sqrt(r()) * .88, a = rim ? q / 46 * TAU : r() * TAU, hx = 16 * Math.pow(sin(a), 3) / 16, hz = (13 * cos(a) - 5 * cos(2 * a) - 2 * cos(3 * a) - cos(4 * a)) / 17, x = hx * HX * f, z = zc - .02 - hz * HZ * f, rr = rim ? .04 : .03 + r() * .016, pick = rim ? (q % 6 === 5 ? WHT : RED) : [RED, RED2, RED, WHT, PNK, RED, RED2, RED2, PNK, ORG][(r() * 10) | 0];
          const yb = yH(z, x) + rr * .5 + (rim ? 0 : .012 + r() * .03); B.sph(pick, rr, x, yb, z, { seg: 7, seg2: 5, s: [1, .62, 1] }); B.sph(pick === WHT ? YEL : pick === ORG ? DKC : pick === PNK ? RED2 : DKR, rr * .38, x, yb + rr * .42, z, { seg: 5, seg2: 3, s: [1, .5, 1] }); }   /* each bloom: a flattened head with a darker heart */
        for (let q = 0; q < 22; q++) { const a = q / 22 * TAU, hx = Math.pow(sin(a), 3), hz = (13 * cos(a) - 5 * cos(2 * a) - 2 * cos(3 * a) - cos(4 * a)) / 17, x = hx * (HX + .09), z = zc - .02 - hz * (HZ + .09); B.box(GRN, .05, .006, .22, x, yH(z, x) + .012, z, { ry: Math.atan2(hx, -hz) + (r() - .5) * .5, rx: -.12, bevel: .002 }); }
        /* posy on the roof and the gauze down to the mirrors */
        for (let q = 0; q < 16; q++) { const a = q * 2.4, d = q ? .05 + .09 * Math.sqrt(q / 16) : 0; B.sph([RED, PNK, WHT, RED2][q % 4], .045 - (q % 3) * .006, cos(a) * d, yRf + .05 + .05 * (1 - d / .14), zRf + sin(a) * d, { seg: 7, seg2: 5 }); } for (let q = 0; q < 8; q++) B.box(GRN, .04, .005, .16, cos(q * .785) * .15, yRf + .02, zRf + sin(q * .785) * .15, { ry: -q * .785 + HP, bevel: .002 });
        B.sym(() => { B.tube(GAUZE, [[.04, yRf + .04, zRf], [S.gh.Wb(.1) * .8, yRf + .0, zRf + .12], [mx - .12, (yRf + my) / 2 + .05, (zRf + mz) / 2 + .1], [mx + .02, my + .09, mz]], .016, { seg: 5 }); B.tube(GAUZE, [[.03, yRf + .04, zRf - .02], [.2, yRf + .03, zRf - .5], [.34, yRf, zRf - 1.0]], .014, { seg: 5 }); });
      } else { /* sash from the screen to the nose, rosette where the two halves meet */
        const seg = 7; for (let q = 0; q < seg; q++) { const z0 = lerp(zW, S.zF - .1, q / seg), z1 = lerp(zW, S.zF - .1, (q + 1) / seg), y0 = yH(z0, 0), y1 = yH(z1, 0); B.box(SATIN, .085, .005, hyp(z1 - z0, y1 - y0) + .01, 0, (y0 + y1) / 2 + .004, (z0 + z1) / 2, { rx: -Math.atan2(y1 - y0, z1 - z0) }); }
        const zb = zc + .15; for (let q = 0; q < 7; q++) { const a = q / 7 * TAU; B.sph(q & 1 ? RED2 : SATIN, 1, sin(a) * .07, yH(zb, 0) + .035, zb + cos(a) * .07, { s: [.05, .03, .05], seg: 7, seg2: 5 }); } B.sph(YEL, .03, 0, yH(zb, 0) + .06, zb, { seg: 7, seg2: 5 }); for (const sg of [-1, 1]) B.box(SATIN, .05, .005, .26, sg * .09, yH(zb + .16, .09) + .006, zb + .17, { ry: sg * .35 }); }
      geo = WEDG[key] = bake(B).detail; }
    const m = new T.Mesh(geo, car.meshes.detail.material); m.name = 'wedding'; m.castShadow = true; car.group.add(m); car.meshes.wedding = m;
    const pf = car.kind === 'sports' ? .345 : .47, bd = new T.Mesh(new T.PlaneGeometry(.46, .23), wedBoard()); bd.name = 'wedding_board'; bd.position.set(0, (S.plateY || pf) + .02, S.zF + .035); car.group.add(bd); car.wedding = role; return car; }

  /** GT.cnvehicles.make(kind, opts). opts: { variant ('sedan' on taxi: plain saloon; 'riot' | 'armoured' on van: SWAT), wedding ('lead' | 'follow'), patrol (escooter: police patrol scooter), glow (hex | false: light strips + ground pool),
       color (sRGB hex; taxi/police/bus keep their livery), plate, seed, dirt 0..1, lights:{...}, fx:false (no ground mesh),
      unit (police), route (bus, default '521'), free (taxi roof light, default true), mitts (escooter/trike winter mitts), box:false (escooter without the delivery box, for civilian traffic), load ('cardboard' | 'crates', trike), parked (cycles: stand down) } */
  function make(kind, opts) { opts = opts || {}; if (kind === 'moto') { kind = 'escooter'; opts = Object.assign({ moto: true, box: false }, opts); } else if (kind === 'escooter' && opts.box === false && !opts.patrol && opts.moto === undefined && opts.color === 0xb84a4a) opts = Object.assign({}, opts, { moto: true, color: undefined });   /* H4: the red civilian scooter in the traffic loop is a motorcycle now */ if (!KINDS.includes(kind)) kind = 'taxi'; if (!DEFS[kind]) return makeCycle(kind, opts); const key = opts.variant && DEFS[kind + ':' + opts.variant] ? kind + ':' + opts.variant : kind; return makeCar(kind, opts, key); }
  /** GT.cnvehicles.setPlate(car, text): repaint the number plate(s) of a live vehicle ('' = a blank plate). The first call gives the vehicle its own copy of the atlas, so the cached one other vehicles may share is left alone. */
  function setPlate(car, text, pstyle) { const ms = car && car.meshes; if (!ms) return false; let dm = null; for (const n in ms) { const mt = ms[n] && ms[n].material; if (/detail$/.test(n) && mt && mt.map && mt.map.image) { dm = mt; break; } } if (!dm) return false;
    const L = LAYS[car.kind] || LAYS.car, src = dm.map; let tex = src;
    if (!dm.userData.ownAtlas) { const c = document.createElement('canvas'); c.width = src.image.width; c.height = src.image.height; c.getContext('2d').drawImage(src.image, 0, 0); tex = new T.CanvasTexture(c); tex.encoding = src.encoding; tex.anisotropy = src.anisotropy; tex.flipY = src.flipY; tex.wrapS = src.wrapS; tex.wrapT = src.wrapT; dm.map = tex; dm.userData.ownAtlas = true; }
    const style = pstyle || car.plateStyle || (car.kind === 'bus' ? 'yellow' : car.kind === 'police' ? 'white' : (car.twoWheeler || car.kind === 'trike' || car.kind === 'escooter' || car.kind === 'sharebike') ? 'ebike' : 'blue');
    painter(tex.image.getContext('2d'), L).plate(text ? String(text) : '　', style); tex.needsUpdate = true; car.plate = text || ''; return true; }
  GT.cnvehicles = { make, setPlate, paintMat, _dashState: dashState, _drawSpeedo: drawSpeedo, _drawPhone: drawPhone, kinds: KINDS.slice(), tris: kind => (DEFS[kind] ? carTpl(kind) : cycTpl(kind, {})).tris, _tpl: kind => (DEFS[kind] ? carTpl(kind) : cycTpl(kind, {})) };

  /* ================================================================== showcases */
  function stage(scene, w, d) { const k = GT.kit(), g = new T.PlaneGeometry(w, d, 1, 1), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d); k.geo('asphalt_worn', g, { rx: -HP });
    for (let x = -w / 2 + 3; x < w / 2 - 2; x += 3.5) k.box('road_paint_white', .11, .004, 5.6, x + 1.75, .002, 0);
    k.box('concrete', w - 4, .15, .5, 0, .075, -8.2, { bevel: .02 }); k.box('concrete_stained', w - 4, .16, 3, 0, .08, -9.95, { bevel: .02 });
    k.decal('oil_stain', 1.4, 1.4, .3, .006, .9); k.decal('oil_stain', 1, 1, 3.7, .006, 1.4, 1); k.decal('crack', 3, 3, -2, .006, 4, .6); k.decal('tire_marks', 1.6, 5, -5.4, .006, 3.5, .2); k.decal('patch', 2.5, 2, 6, .006, 5, .1); k.decal('puddle', 2.6, 1.8, -1.2, .006, -2.6, .4);
    const s = k.build({ cast: false }); scene.add(s); return s; }
  const Q = () => new URLSearchParams(location.search);
  const applyQ = (cars, q) => { const l = (q.get('lights') || '').split(',').filter(Boolean), o = {}; l.forEach(n => o[n] = 1); cars.forEach(c => { if (l.length) c.setLights(o); const st = q.get('steer'); if (st) c.steer.forEach(p => p.rotation.y = +st); const le = q.get('lean'); if (le) c.lean(+le); }); };
  const fov = (camera, q, f) => { if (!q.get('fov')) { camera.fov = f; camera.updateProjectionMatrix(); } };
  function rider(car, q) { if (!GT.hero || !GT.hero.make || q.get('rider') === '0') return null; let h = null; try { h = GT.hero.make('kai', { outfit: 'rider', helmet: true }); } catch (e) { return null; } if (!h || !h.group) return null;
    const s = car.seat.position, st = { state: 'ride', speed: +(q.get('speed') || 0), turn: 0, lookYaw: 0, lookPitch: 0, t: 0, pedal: car.kind === 'sharebike' ? 1 : 0 }; h.group.position.set(s.x, s.y - (car.kind === 'sharebike' ? .9 : .74), s.z + .02); car.seat.parent.add(h.group);
    return dt => { st.t += dt; try { h.update(dt, st); } catch (e) { /* hero module still in flux */ } }; }
  GT.showcase.cnvehicles = ({ scene, camera }) => { const q = Q(); stage(scene, 64, 40); const order = (q.get('kinds') || 'sharebike,escooter,trike,taxi,police,sports,van,bus').split(',').filter(k => KINDS.includes(k)), cars = [], gap = .9; let tot = -gap;
    const list = order.map((kind, i) => { const c = make(kind, { seed: i, parked: true, load: q.get('load') || undefined, mitts: q.get('mitts') === '1' ? true : undefined, box: q.get('box') === '0' ? false : undefined, color: q.get('color') ? parseInt(q.get('color'), 16) : undefined }); tot += c.dims.W + gap; return c; }); let x = -tot / 2;
    list.forEach(c => { x += c.dims.W / 2; c.group.position.set(x, 0, c.kind === 'bus' ? -3.6 : 2.2 - c.dims.L / 2); x += c.dims.W / 2 + gap; scene.add(c.group); cars.push(c); });
    applyQ(cars, q); fov(camera, q, 40); return { cam: [-2.2, 2.7, 17.2], look: [.5, 1.0, -1.5], hours: 18.2, update(dt) { cars.forEach(c => c.update(dt)); } }; };
  GT.showcase.cnvehicles_one = ({ scene, camera }) => { const q = Q(), kind = KINDS.includes(q.get('kind')) ? q.get('kind') : 'taxi'; stage(scene, 44, 40);
    const c = make(kind, { plate: q.get('plate') || undefined, load: q.get('load') || undefined, mitts: q.get('mitts') === '1' ? true : q.get('mitts') === '0' ? false : undefined, parked: q.get('parked') === '1', color: q.get('color') ? parseInt(q.get('color'), 16) : undefined, variant: q.get('variant') || undefined, wedding: q.get('wedding') || undefined, patrol: q.get('patrol') === '1', box: q.get('box') === '0' ? false : undefined });
    c.group.rotation.y = +(q.get('h') || 0); scene.add(c.group); applyQ([c], q); const up = q.get('rider') === '1' ? rider(c, q) : null, d = c.dims, L = d.L, W = d.W, H = d.H, s = max(L, H * 1.6);
    const V = { front: [[-W / 2 - s * .55, H * .62 + .25, L / 2 + s * .8], [0, H * .45, L * .08]], rear: [[-W / 2 - s * .55, H * .66 + .25, -L / 2 - s * .8], [0, H * .45, -L * .08]], side: [[-W / 2 - s * 1.25, H * .55, 0], [0, H * .45, 0]], right: [[W / 2 + s * 1.25, H * .55, 0], [0, H * .45, 0]],
      top: [[-s * .5, H + s * .9, s * .55], [0, H * .4, 0]], nose: [[-W * .5, H * .5, L / 2 + s * .42], [0, H * .42, L / 2 - .2]], tail: [[W * .45, H * .55, -L / 2 - s * .42], [0, H * .42, -L / 2 + .2]], chase: [[0, H + .35, -L / 2 - 2.6], [0, H * .6, 1]] }[q.get('view') || 'front'];
    fov(camera, q, 34); return { cam: V[0], look: V[1], hours: 18.2, update(dt) { c.update(dt); if (up) up(dt); } }; };
  /** round b4: the rebuilt and new vehicles in one row. set=a (default: 老头乐, riot van, armoured van, patrol scooter, patrol car) | b (taxi, wedding lead, wedding follower, tuned car, delivery scooter). view=front|rear. lights=head,siren,... */
  GT.showcase.cnvehicles_b4 = ({ scene, camera }) => { const q = Q(), rear = q.get('view') === 'rear'; stage(scene, 64, 40); const sets = { a: [['laotoule', {}], ['van', { variant: 'riot' }], ['van', { variant: 'armoured' }], ['escooter', { patrol: true, color: 0xeeeeea, parked: true }], ['police', {}]], b: [['taxi', {}], ['taxi', { variant: 'sedan', wedding: 'lead' }], ['taxi', { variant: 'sedan', wedding: 'follow', color: 0xd8d4c8 }], ['sports', {}], ['escooter', { parked: true }]] }, cars = [], gap = 1.1; let tot = -gap;
    const list = (sets[q.get('set')] || sets.a).map((d, i) => { const c = make(d[0], Object.assign({ seed: i + 1 }, d[1])); tot += c.dims.W + gap; return c; }); let x = -tot / 2; list.forEach(c => { x += c.dims.W / 2; c.group.position.set(x, 0, rear ? -2.2 + c.dims.L / 2 : 2.2 - c.dims.L / 2); x += c.dims.W / 2 + gap; scene.add(c.group); cars.push(c); });
    applyQ(cars, q); fov(camera, q, 34); return { cam: rear ? [2.6, 2.3, -11.5] : [-2.6, 2.3, 11.5], look: rear ? [-.2, .9, 0] : [.2, .9, 0], hours: 18.2, update(dt) { cars.forEach(c => c.update(dt)); } }; };
  /** the gameplay view: the hero's scooter from 2.5 m behind (view=rear), plus view=side|front|left|bars|box|wheel. rider=0 hides 阿凯. */
  GT.showcase.cnvehicles_scooter = ({ scene, camera }) => { const q = Q(), view = q.get('view') || 'rear'; stage(scene, 44, 40); const c = make('escooter', { plate: '江城52177', mitts: q.get('mitts') === '1', parked: q.get('parked') === '1' }); scene.add(c.group); applyQ([c], q);
    const up = q.get('parked') === '1' ? null : rider(c, q);
    const V = { rear: [[.55, 1.72, -2.75], [0, 1.0, .4]], rear34: [[-1.5, 1.35, -2.1], [0, .78, -.2]], side: [[-2.9, 1.0, .0], [0, .78, -.1]], front: [[-1.25, 1.2, 2.5], [0, .75, .1]], left: [[2.2, 1.1, 1.6], [0, .7, 0]], bars: [[.0, 1.5, -.42], [.02, 1.06, .32]], box: [[-.55, 1.25, -1.9], [0, .98, -.8]], wheel: [[-1.0, .45, -1.3], [0, .3, -.6]], nose: [[-.7, .8, 1.5], [0, .62, .5]], deck: [[-1.3, .95, .1], [0, .5, .1]] }[view] || [[.55, 1.72, -2.75], [0, 1.0, .4]];
    fov(camera, q, view === 'rear' ? 50 : 36); return { cam: V[0], look: V[1], hours: 18.2, update(dt) { c.update(dt); if (up) up(dt); } }; };
  GT.showcase.cnvehicles_bus = ({ scene, camera }) => { const q = Q(), view = q.get('view') || 'front'; stage(scene, 64, 44); const c = make('bus', { plate: '江A·D0521' }); scene.add(c.group); applyQ([c], q);
    const V = { front: [[-7.5, 2.7, 12.5], [0, 1.5, 1.5]], left: [[9.5, 2.5, 11], [0, 1.5, 1.2]], rear: [[-7, 2.8, -12.5], [0, 1.5, -1.5]], side: [[-15, 2.2, 0], [0, 1.6, 0]], door: [[5.2, 1.7, 6.2], [-1.2, 1.5, 4.2]], nose: [[-2.6, 1.9, 9.6], [0, 1.7, 6]], cabin: [[-3.4, 2.0, 2.5], [0, 1.7, -.5]], wheel: [[-3.4, .9, 5.6], [-1.2, .6, 3.3]] }[view] || [[-7.5, 2.7, 12.5], [0, 1.5, 1.5]];
    fov(camera, q, 40); return { cam: V[0], look: V[1], hours: 18.2, update(dt) { c.update(dt); } }; };
  /** everything with its lights on at night: head + tail lamps, taxi roof box, police bar flashing, bus cabin and LED boards, scooter indicators */
  GT.showcase.cnvehicles_night = ({ scene, camera }) => { const q = Q(); stage(scene, 64, 40); const order = (q.get('kinds') || 'escooter,taxi,police,sports,bus').split(',').filter(k => KINDS.includes(k)), cars = [], gap = 1.5; let tot = -gap;
    const list = order.map((kind, i) => { const c = make(kind, { seed: i + 3 }); tot += c.dims.W + gap; return c; }); let x = -tot / 2;
    list.forEach(c => { x += c.dims.W / 2; c.group.position.set(x, 0, c.kind === 'bus' ? -3.6 : 2.2 - c.dims.L / 2); x += c.dims.W / 2 + gap; scene.add(c.group); cars.push(c);
      c.setLights({ head: 1, brake: c.kind === 'sports' ? 1 : 0, siren: c.kind === 'police' ? 1 : 0, hazard: c.kind === 'escooter' ? 1 : 0, left: c.kind === 'bus' ? 1 : 0 }); });
    applyQ(cars, q); fov(camera, q, 40); const rear = q.get('view') === 'rear'; return { cam: rear ? [3.5, 2.6, -13] : [-3.5, 2.6, 14], look: rear ? [-.5, 1, -1] : [-.5, 1, 0], hours: 21, update(dt) { cars.forEach(c => c.update(dt)); } }; };
})();
