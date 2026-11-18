/* road.js — SUNSET HEAT: ground, roads, shoreline + sea, vegetation, street furniture, filler lots, distant backdrop.
   Exports GT.road = { build(scene), update(dt), groundHeight(x,z), surfaceAt(x,z), lanes, signalState(which), stats }.
   Everything is generated: canvas textures + merged / instanced geometry. Owner: road agent. */
(function () {
  'use strict';
  const T = THREE, GT = window.GT, L = GT.L, C = GT.C, TAU = Math.PI * 2, PI = Math.PI, cl = GT.clamp, lerp = GT.lerp, ss = GT.sstep;
  const HW = 7.5, SWH = 0.14, SW1 = 10, WALL0 = -10.0, WALL1 = -10.42, WALLTOP = 0.42, SEA_Y = -1.5, FR = 5;
  const DRIVES = [L.station.drives[0], L.station.drives[1], L.motel.drive], DHW = 4.5, DFL = 1.3;
  const XS = [-160, 160], BX = 150, CW = 4.5;
  const state = { built: false, time: 0, uTime: { value: 0 }, sig: null, sigTex: null, sea: null, night: [], stats: {} };

  /* ================================================================== small utilities */
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function ctex(c, o) { o = o || {}; const t = new T.CanvasTexture(c); if (o.srgb !== false) t.encoding = T.sRGBEncoding; t.anisotropy = o.aniso || 8; if (o.repeat) t.wrapS = t.wrapT = T.RepeatWrapping; return t; }
  function h2(x, y) { let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
  function vn(x, y) { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return lerp(lerp(h2(xi, yi), h2(xi + 1, yi), u), lerp(h2(xi, yi + 1), h2(xi + 1, yi + 1), u), v); }
  function fb(x, y) { return vn(x, y) * .5 + vn(x * 2.03 + 11.3, y * 2.03 + 5.1) * .3 + vn(x * 4.1 + 3.7, y * 4.1 + 17.9) * .2; }
  const rgba = (r, g, b, a) => 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')';

  /* ---- lightweight geometry batcher (one mesh per batch). Ground quads get UVs in world metres so GT.mat textures tile correctly. */
  class Batch {
    constructor(o) { o = o || {}; this.P = []; this.N = []; this.U = []; this.I = []; this.C = o.col ? [] : null; this.W = o.wind ? [] : null; this.n = 0; this.col = [1, 1, 1]; this.w = [0, 0]; }
    v(x, y, z, nx, ny, nz, u, v) { this.P.push(x, y, z); this.N.push(nx, ny, nz); this.U.push(u, v); if (this.C) this.C.push(this.col[0], this.col[1], this.col[2]); if (this.W) this.W.push(this.w[0], this.w[1]); return this.n++; }
    q(a, b, c, d) { this.I.push(a, b, c, a, c, d); }
    setCol(hex, k) { const c = C(hex); k = k === undefined ? 1 : k; this.col = [c.r * k, c.g * k, c.b * k]; return this; }
    /** flat rect facing up; uv = world metres * us */
    rect(x0, z0, x1, z1, y, us) { y = y || 0; us = us || 1; if (x0 > x1) { const t = x0; x0 = x1; x1 = t; } if (z0 > z1) { const t = z0; z0 = z1; z1 = t; }
      this.q(this.v(x0, y, z0, 0, 1, 0, x0 * us, z0 * us), this.v(x0, y, z1, 0, 1, 0, x0 * us, z1 * us), this.v(x1, y, z1, 0, 1, 0, x1 * us, z1 * us), this.v(x1, y, z0, 0, 1, 0, x1 * us, z0 * us)); return this; }
    /** flat rect with explicit uv rect (u along +x, v along +z) */
    rectUV(x0, z0, x1, z1, y, u0, v0, u1, v1) { this.q(this.v(x0, y, z0, 0, 1, 0, u0, v0), this.v(x0, y, z1, 0, 1, 0, u0, v1), this.v(x1, y, z1, 0, 1, 0, u1, v1), this.v(x1, y, z0, 0, 1, 0, u1, v0)); return this; }
    /** ground quad centred at (cx,cz), "up" of the texture pointing along heading h, u to the driver's right */
    oquad(cx, cz, w, len, h, y, u0, v0, u1, v1) { const rx = -Math.cos(h) * w / 2, rz = Math.sin(h) * w / 2, fx = Math.sin(h) * len / 2, fz = Math.cos(h) * len / 2;
      this.q(this.v(cx - rx - fx, y, cz - rz - fz, 0, 1, 0, u0, v0), this.v(cx + rx - fx, y, cz + rz - fz, 0, 1, 0, u1, v0), this.v(cx + rx + fx, y, cz + rz + fz, 0, 1, 0, u1, v1), this.v(cx - rx + fx, y, cz - rz + fz, 0, 1, 0, u0, v1)); return this; }
    /** painted line from a to b (width wd), uv = world / tile */
    line(x0, z0, x1, z1, wd, y, tile) { tile = tile || 2.56; const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, px = dz / l * wd / 2, pz = -dx / l * wd / 2, P = [[x0 - px, z0 - pz], [x1 - px, z1 - pz], [x1 + px, z1 + pz], [x0 + px, z0 + pz]];
      const ar = (P[1][1] - P[0][1]) * (P[2][0] - P[0][0]) - (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]); if (ar < 0) P.reverse();
      const id = P.map(p => this.v(p[0], y, p[1], 0, 1, 0, p[0] / tile, p[1] / tile)); this.q(id[0], id[1], id[2], id[3]); return this; }
    /** polygon fan (pts = [[x,z],...]) facing up, uv world metres */
    fan(pts, y, us) { us = us || 1; let ar = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; ar += a[0] * b[1] - b[0] * a[1]; } if (ar > 0) pts = pts.slice().reverse();
      const id = pts.map(p => this.v(p[0], y, p[1], 0, 1, 0, p[0] * us, p[1] * us)); for (let i = 1; i < id.length - 1; i++) this.I.push(id[0], id[i], id[i + 1]); return this; }
    /** arbitrary quad from 4 points [x,y,z]; uv world xz (or supplied); forced to face +Y when up=true */
    quad4(a, b, c, d, uv, up) { let P = [a, b, c, d], UV = uv; const n = new T.Vector3().crossVectors(new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), new T.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize();
      if (up !== false && n.y < 0) { P = [d, c, b, a]; if (UV) UV = [uv[3], uv[2], uv[1], uv[0]]; n.negate(); }
      const id = P.map((p, i) => this.v(p[0], p[1], p[2], n.x, n.y, n.z, UV ? UV[i][0] : p[0], UV ? UV[i][1] : p[2])); this.q(id[0], id[1], id[2], id[3]); return this; }
    /** double-sided card (two windings, same normal) with given corner points and uv rect; nrm optional per-corner normals */
    card(a, b, c, d, u0, v0, u1, v1, nrm, w) { const n = nrm || (() => { const n = new T.Vector3().crossVectors(new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), new T.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2])).normalize(); if (n.y < 0) n.negate(); return [n.x, n.y, n.z]; })();
      const P = [a, b, c, d], UV = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], ws = w || [[0, 0], [0, 0], [0, 0], [0, 0]], id = [];
      for (let i = 0; i < 4; i++) { const nn = Array.isArray(n[0]) ? n[i] : n; if (this.W) this.w = ws[i]; id.push(this.v(P[i][0], P[i][1], P[i][2], nn[0], nn[1], nn[2], UV[i][0], UV[i][1])); }
      this.I.push(id[0], id[1], id[2], id[0], id[2], id[3], id[0], id[2], id[1], id[0], id[3], id[2]); return this; }
    geo() { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(this.P), 3)); g.setAttribute('normal', new T.BufferAttribute(new Float32Array(this.N), 3)); g.setAttribute('uv', new T.BufferAttribute(new Float32Array(this.U), 2));
      if (this.C) g.setAttribute('color', new T.BufferAttribute(new Float32Array(this.C), 3)); if (this.W) g.setAttribute('aW', new T.BufferAttribute(new Float32Array(this.W), 2));
      g.setIndex(new T.BufferAttribute(this.n > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I), 1)); return g; }
    mesh(mat, o) { o = o || {}; const m = new T.Mesh(this.geo(), mat); m.castShadow = !!o.cast; m.receiveShadow = o.recv !== false; if (o.order !== undefined) m.renderOrder = o.order; m.frustumCulled = o.cull !== false; m.name = o.name || ''; return m; }
  }

  /* ================================================================== generated textures */
  const TX = {};
  /** draw fn at (x,y) plus the wrapped copies needed for a tileable S×S canvas */
  function wrapDraw(S, x, y, rad, fn) { for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const X = x + ox * S, Y = y + oy * S; if (X > -rad && X < S + rad && Y > -rad && Y < S + rad) fn(X, Y); } }

  /* ---- road wear overlay: wheel tracks, lane-centre polish, seams, tar snakes, cracks, patches, stains, blown sand at the edges.
     2048² = 24 m × 24 m. Left 1280 px = the 15 m highway, right 768 px = the 9 m two-lane streets. Tiles along V. */
  function texOverlay() {
    const S = 2048, c = cv(S, S), g = c.getContext('2d'), ppm = S / 24, r = GT.rng('overlay'), rr = (a, b) => a + (b - a) * r();
    const vwrap = fn => { for (const o of [-S, 0, S]) { g.save(); g.translate(0, o); fn(); g.restore(); } };
    function region(x0, wm, lanes, seams, nSnake, sandSide) {
      const W = wm * ppm, hw = W / 2; g.save(); g.beginPath(); g.rect(x0, 0, W, S); g.clip(); g.translate(x0 + hw, 0);
      const band = (xm, half, col, a) => { const gr = g.createLinearGradient((xm - half) * ppm, 0, (xm + half) * ppm, 0); gr.addColorStop(0, col + '0)'); gr.addColorStop(.5, col + a + ')'); gr.addColorStop(1, col + '0)'); g.fillStyle = gr; g.fillRect((xm - half) * ppm, 0, half * 2 * ppm, S); };
      // wheel tracks (dark, polished) + lighter lane centres with an oil-drip line
      for (const lc of lanes) { band(lc - .86, .42, 'rgba(12,12,14,', .34); band(lc + .86, .42, 'rgba(12,12,14,', .34); band(lc, .3, 'rgba(126,121,112,', .13); band(lc, .11, 'rgba(10,9,8,', .2); }
      // break the bands up so they do not read as ruled stripes
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 260; i++) { const x = rr(-hw, hw), y = rr(0, S), rad = rr(20, 120), a = rr(.15, .6); wrapDraw(S, x + hw, y, rad, (X, Y) => { const gr = g.createRadialGradient(X - hw, Y, 0, X - hw, Y, rad); gr.addColorStop(0, 'rgba(0,0,0,' + a + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(X - hw - rad, Y - rad, rad * 2, rad * 2); }); }
      g.globalCompositeOperation = 'source-over';
      // edge dust / blown sand in the gutters
      for (const s of [-1, 1]) { const k = s === sandSide ? 1 : .55, gr = g.createLinearGradient(s * hw, 0, s * (hw - 1.7 * ppm), 0); gr.addColorStop(0, 'rgba(172,154,120,' + (.62 * k) + ')'); gr.addColorStop(.3, 'rgba(150,137,112,' + (.3 * k) + ')'); gr.addColorStop(1, 'rgba(150,137,112,0)'); g.fillStyle = gr; g.fillRect(s > 0 ? hw - 1.7 * ppm : -hw, 0, 1.7 * ppm, S);
        for (let i = 0; i < 26; i++) { const y = rr(0, S), len = rr(60, 380), wd = rr(10, 60) * k; wrapDraw(S, 0, y, len, (X, Y) => { const gr2 = g.createRadialGradient(s * hw, Y, 0, s * hw, Y, wd * 2); gr2.addColorStop(0, 'rgba(176,160,128,.45)'); gr2.addColorStop(1, 'rgba(176,160,128,0)'); g.save(); g.translate(s * hw, Y); g.scale(1, len / (wd * 2)); g.translate(-s * hw, -Y); g.fillStyle = gr2; g.fillRect(s * hw - wd * 2, Y - wd * 2, wd * 4, wd * 4); g.restore(); }); } }
      // stains
      for (let i = 0; i < 46; i++) { const lc = lanes[(r() * lanes.length) | 0], x = (lc + rr(-.25, .25)) * ppm, y = rr(0, S), rad = rr(6, 34), a = rr(.12, .42); wrapDraw(S, 0, y, rad * 3, (X, Y) => { g.save(); g.translate(x, Y); g.scale(1, rr(1, 2.6)); const gr = g.createRadialGradient(0, 0, 0, 0, 0, rad); gr.addColorStop(0, 'rgba(8,8,9,' + a + ')'); gr.addColorStop(.6, 'rgba(8,8,9,' + a * .5 + ')'); gr.addColorStop(1, 'rgba(8,8,9,0)'); g.fillStyle = gr; g.fillRect(-rad, -rad, rad * 2, rad * 2); g.restore(); }); }
      // utility-cut patches: fresher asphalt, tar-sealed edges
      const patches = []; for (let i = 0; i < (wm > 10 ? 4 : 2); i++) { const pw = rr(.9, 2.6) * ppm, ph = rr(1.4, 5.5) * ppm, x = rr(-hw + 40, hw - 40 - pw), y = rr(0, S); patches.push([x, y, pw, ph, r()]); }
      vwrap(() => { for (const [x, y, pw, ph, k] of patches) { g.fillStyle = k < .6 ? 'rgba(20,20,23,.62)' : 'rgba(104,101,96,.4)'; g.fillRect(x, y, pw, ph); g.strokeStyle = 'rgba(18,18,20,.7)'; g.lineWidth = 2.6; g.lineJoin = 'round'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + pw, y + 3); g.lineTo(x + pw - 2, y + ph); if (k > .3) g.lineTo(x + 2, y + ph - 2); if (k > .5) g.closePath(); g.stroke(); } });
      // longitudinal paving seams (periodic wobble so they tile), partly tar-sealed
      for (const sx of seams) { const p1 = 1 + ((r() * 3) | 0), p2 = 4 + ((r() * 5) | 0), a1 = rr(1, 3.5), a2 = rr(.5, 1.6), f0 = r() * 6; const X = y => sx * ppm + Math.sin(y / S * TAU * p1 + f0) * a1 + Math.sin(y / S * TAU * p2 + f0 * 2) * a2;
        g.strokeStyle = 'rgba(10,10,11,.8)'; g.lineWidth = 1.7; g.beginPath(); for (let y = 0; y <= S; y += 16) y ? g.lineTo(X(y), y) : g.moveTo(X(y), y); g.stroke();
        g.strokeStyle = 'rgba(16,16,18,.93)'; g.lineCap = 'round'; let y = rr(0, 300); while (y < S) { const len = rr(120, 900), y1 = Math.min(S, y + len); g.lineWidth = rr(2.0, 3.6); g.beginPath(); for (let yy = y; yy <= y1; yy += 12) yy === y ? g.moveTo(X(yy) + rr(-.6, .6), yy) : g.lineTo(X(yy) + rr(-1.3, 1.3), yy); g.stroke(); y = y1 + rr(100, 700); } }
      // tar snakes: sealed transverse / diagonal cracks
      const snakes = []; for (let i = 0; i < nSnake; i++) { const pts = []; let x = rr(-hw, hw), y = rr(0, S), a = r() < .62 ? rr(-.35, .35) + (r() < .5 ? 0 : PI) : rr(0, TAU); const n = (rr(8, 46)) | 0, st = rr(9, 15); for (let k = 0; k < n; k++) { pts.push([x, y]); a += rr(-.5, .5); x += Math.cos(a) * st; y += Math.sin(a) * st * .8; if (r() < .05) a += rr(-1.2, 1.2); } snakes.push({ pts, w: rr(1.8, 3.3) });
        if (r() < .45) { const b = pts[(pts.length * rr(.3, .7)) | 0], q = []; let bx = b[0], by = b[1], ba = rr(1, 2.2) * (r() < .5 ? 1 : -1); for (let k = 0; k < rr(5, 20); k++) { q.push([bx, by]); ba += rr(-.4, .4); bx += Math.cos(ba) * st; by += Math.sin(ba) * st; } snakes.push({ pts: q, w: rr(1.4, 2.4) }); } }
      vwrap(() => { g.lineCap = g.lineJoin = 'round'; for (const s of snakes) { g.strokeStyle = 'rgba(21,21,23,.86)'; g.lineWidth = s.w; g.beginPath(); s.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); } });
      // open hairline cracks + alligator clusters
      const cracks = []; for (let i = 0; i < 70; i++) { const pts = []; let x = rr(-hw, hw), y = rr(0, S), a = r() < .6 ? PI / 2 + rr(-.3, .3) : rr(0, TAU); for (let k = 0, n = rr(6, 40); k < n; k++) { pts.push([x, y]); a += rr(-.6, .6); x += Math.cos(a) * 7; y += Math.sin(a) * 7; } cracks.push(pts); }
      for (let i = 0; i < 5; i++) { const lc = lanes[(r() * lanes.length) | 0], cx = (lc + (r() < .5 ? -.86 : .86)) * ppm, cy = rr(0, S); for (let k = 0; k < 34; k++) { const pts = []; let x = cx + rr(-45, 45), y = cy + rr(-90, 90), a = rr(0, TAU); for (let q = 0; q < 5; q++) { pts.push([x, y]); a += rr(-1, 1); x += Math.cos(a) * 9; y += Math.sin(a) * 9; } cracks.push(pts); } }
      vwrap(() => { g.strokeStyle = 'rgba(9,9,10,.66)'; g.lineWidth = 1.25; for (const pts of cracks) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); } });
      // a couple of long skid marks
      vwrap(() => { for (let i = 0; i < 3; i++) { const lc = lanes[(h2(i, wm * 7) * lanes.length) | 0], x = (lc - .8) * ppm, y = h2(i, 31 + wm) * S, len = (5 + h2(i, 77) * 9) * ppm, dr = (h2(i, 5) - .5) * 60; for (const o of [0, 1.62 * ppm]) { const gr = g.createLinearGradient(0, y, 0, y + len); gr.addColorStop(0, 'rgba(6,6,7,0)'); gr.addColorStop(.25, 'rgba(6,6,7,.34)'); gr.addColorStop(1, 'rgba(6,6,7,0)'); g.strokeStyle = gr; g.lineWidth = .2 * ppm; g.beginPath(); g.moveTo(x + o, y); g.quadraticCurveTo(x + o + dr * .2, y + len * .5, x + o + dr, y + len); g.stroke(); } } });
      g.restore();
    }
    region(0, 15, [-6, -3, 0, 3, 6], [-4.5, -1.5, 1.5, 4.5], 15, 1);       // u grows toward -X on the highway mapping below -> sandSide handled by flips; keep it on one side
    region(1280, 9, [-2.25, 2.25], [0], 8, 0);
    // roughness companion (1024²): tar and wheel polish are glossy, dust is matte
    const S2 = 1024, c2 = cv(S2, S2), g2 = c2.getContext('2d'); g2.drawImage(c, 0, 0, S2, S2); const im = g2.getImageData(0, 0, S2, S2), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255, lum = d[i] + d[i + 1] + d[i + 2]; const ro = lum < 150 ? lerp(.88, .52, a * a) : .97; d[i] = 255; d[i + 1] = ro * 255; d[i + 2] = 0; d[i + 3] = 255; }
    g2.putImageData(im, 0, 0);
    const t = ctex(c, { repeat: true, aniso: 16 }), t2 = ctex(c2, { repeat: true, srgb: false }); return { map: t, rough: t2 };
  }

  /* ---- worn paint: white base, alpha carries chips, cracks and traffic wear. 512² = 2.56 m, tiles both ways. */
  function texPaint() {
    const S = 512, c = cv(S, S), g = c.getContext('2d'), r = GT.rng('paint'), rr = (a, b) => a + (b - a) * r();
    g.fillStyle = 'rgb(238,236,228)'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 150; i++) { const x = rr(0, S), y = rr(0, S), rad = rr(8, 70), a = rr(.05, .22); wrapDraw(S, x, y, rad, (X, Y) => { const gr = g.createRadialGradient(X, Y, 0, X, Y, rad); gr.addColorStop(0, 'rgba(92,86,76,' + a + ')'); gr.addColorStop(1, 'rgba(92,86,76,0)'); g.fillStyle = gr; g.fillRect(X - rad, Y - rad, rad * 2, rad * 2); }); }
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 34; i++) { const x = rr(0, S), y = rr(0, S), rad = rr(14, 80), a = rr(.2, .75); wrapDraw(S, x, y, rad, (X, Y) => { const gr = g.createRadialGradient(X, Y, 0, X, Y, rad); gr.addColorStop(0, 'rgba(0,0,0,' + a + ')'); gr.addColorStop(.5, 'rgba(0,0,0,' + a * .45 + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(X - rad, Y - rad, rad * 2, rad * 2); }); }
    g.fillStyle = '#000'; for (let i = 0; i < 2600; i++) { const x = rr(0, S), y = rr(0, S), s = r() < .9 ? rr(.6, 2.4) : rr(2.5, 7); g.globalAlpha = rr(.5, 1); wrapDraw(S, x, y, 8, (X, Y) => { g.beginPath(); g.ellipse(X, Y, s, s * rr(.5, 1.6), rr(0, 3), 0, TAU); g.fill(); }); }
    g.globalAlpha = 1; g.strokeStyle = '#000'; g.lineCap = 'round';
    for (let i = 0; i < 80; i++) { let x = rr(0, S), y = rr(0, S), a = rr(0, TAU); const pts = []; for (let k = 0, n = rr(5, 30); k < n; k++) { pts.push([x, y]); a += rr(-.7, .7); x += Math.cos(a) * 6; y += Math.sin(a) * 6; } g.lineWidth = rr(.7, 1.8); wrapDraw(S, pts[0][0], pts[0][1], 200, (X, Y) => { g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(p[0] - pts[0][0] + X, p[1] - pts[0][1] + Y) : g.moveTo(X, Y)); g.stroke(); }); }
    g.globalCompositeOperation = 'source-over'; return ctex(c, { repeat: true, aniso: 16 });
  }

  /* ---- road stencil atlas (1024²): arrows, ONLY, STOP, manhole cover, drain grate, BUS, utility lid */
  const MK = { arrowL: [0, 0, 256, 512], arrowS: [256, 0, 256, 512], only: [512, 0, 512, 512], stop: [0, 512, 512, 512], manhole: [512, 512, 256, 256], grate: [768, 512, 256, 256], bus: [512, 768, 256, 256], lid: [768, 768, 256, 256] };
  function texMarks() {
    const S = 1024, c = cv(S, S), g = c.getContext('2d'), r = GT.rng('marks'), rr = (a, b) => a + (b - a) * r(), white = 'rgb(232,230,220)';
    const cell = (k, fn) => { const [x, y, w, h] = MK[k]; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y); fn(w, h); g.restore(); };
    const word = (txt, w, h) => { g.fillStyle = white; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 150px "Arial Narrow","Helvetica Neue",Arial,sans-serif'; const tw = g.measureText(txt).width; g.save(); g.translate(w / 2, h / 2); g.scale((w - 44) / tw, (h - 50) / 108); g.fillText(txt, 0, 6); g.restore(); };
    cell('arrowL', (w, h) => { g.strokeStyle = white; g.fillStyle = white; g.lineWidth = 44; g.lineCap = 'butt'; g.beginPath(); g.moveTo(182, h - 22); g.lineTo(182, 260); g.quadraticCurveTo(182, 128, 104, 128); g.stroke();
      g.beginPath(); g.moveTo(112, 40); g.lineTo(20, 128); g.lineTo(112, 216); g.closePath(); g.fill(); });
    cell('arrowS', (w, h) => { g.fillStyle = white; g.beginPath(); g.moveTo(w / 2, 22); g.lineTo(w - 48, 190); g.lineTo(w / 2 + 24, 190); g.lineTo(w / 2 + 24, h - 22); g.lineTo(w / 2 - 24, h - 22); g.lineTo(w / 2 - 24, 190); g.lineTo(48, 190); g.closePath(); g.fill(); });
    cell('only', (w, h) => word('ONLY', w, h)); cell('stop', (w, h) => word('STOP', w, h)); cell('bus', (w, h) => word('BUS', w, h));
    // wear on the painted stencils
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5200; i++) { const x = rr(0, S), y = rr(0, S), s = r() < .92 ? rr(.7, 2.6) : rr(3, 9); g.globalAlpha = rr(.4, 1); g.beginPath(); g.ellipse(x, y, s, s * rr(.5, 1.8), rr(0, 3), 0, TAU); g.fill(); }
    for (let i = 0; i < 46; i++) { const x = rr(0, S), y = rr(0, S), rad = rr(30, 120), gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(0,0,0,' + rr(.25, .8) + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    g.globalAlpha = 1; g.lineWidth = 1.4; g.strokeStyle = '#000'; for (let i = 0; i < 120; i++) { let x = rr(0, S), y = rr(0, S), a = rr(0, TAU); g.beginPath(); g.moveTo(x, y); for (let k = 0; k < rr(6, 30); k++) { a += rr(-.7, .7); x += Math.cos(a) * 7; y += Math.sin(a) * 7; g.lineTo(x, y); } g.stroke(); }
    g.globalCompositeOperation = 'source-over';
    // cast-iron pieces (drawn after the wear pass)
    cell('manhole', (w, h) => { const cx = w / 2, cy = h / 2; let gr = g.createRadialGradient(cx, cy, 96, cx, cy, 126); gr.addColorStop(0, 'rgba(26,26,28,.95)'); gr.addColorStop(.55, 'rgba(34,33,33,.8)'); gr.addColorStop(1, 'rgba(30,30,30,0)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 126, 0, TAU); g.fill();
      g.fillStyle = 'rgb(58,52,47)'; g.beginPath(); g.arc(cx, cy, 100, 0, TAU); g.fill(); g.strokeStyle = 'rgb(24,22,21)'; g.lineWidth = 5; g.stroke(); g.strokeStyle = 'rgb(84,76,68)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 92, 0, TAU); g.stroke();
      g.save(); g.beginPath(); g.arc(cx, cy, 84, 0, TAU); g.clip(); for (let i = -9; i <= 9; i++) for (let j = -9; j <= 9; j++) { g.fillStyle = (i + j) & 1 ? 'rgb(74,67,60)' : 'rgb(40,36,33)'; g.fillRect(cx + i * 11 - 4, cy + j * 11 - 4, 8, 8); } g.restore();
      g.fillStyle = 'rgb(58,52,47)'; g.beginPath(); g.arc(cx, cy, 30, 0, TAU); g.fill(); g.fillStyle = 'rgb(96,86,76)'; g.font = '700 15px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STORM', cx, cy - 8); g.fillText('SEWER', cx, cy + 9);
      g.fillStyle = 'rgb(12,12,12)'; for (const a of [.6, 3.74]) { g.beginPath(); g.ellipse(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70, 7, 4, a, 0, TAU); g.fill(); }
      for (let i = 0; i < 40; i++) { const a = rr(0, TAU), d = rr(0, 100), rad = rr(4, 22), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, gr2 = g.createRadialGradient(x, y, 0, x, y, rad); gr2.addColorStop(0, r() < .5 ? 'rgba(120,72,40,.35)' : 'rgba(18,16,15,.4)'); gr2.addColorStop(1, 'rgba(60,40,30,0)'); g.fillStyle = gr2; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); } });
    cell('grate', (w, h) => { g.fillStyle = 'rgb(126,122,112)'; g.fillRect(6, 6, w - 12, h - 12); g.fillStyle = 'rgb(46,42,38)'; g.fillRect(22, 30, w - 44, h - 60); g.fillStyle = 'rgb(5,5,5)'; for (let i = 0; i < 9; i++) g.fillRect(34 + i * 21.5, 42, 12, h - 84); g.fillStyle = 'rgb(60,54,48)'; g.fillRect(22, h / 2 - 7, w - 44, 14);
      for (let i = 0; i < 30; i++) { const x = rr(10, w - 10), y = rr(10, h - 10), rad = rr(6, 30), gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, r() < .5 ? 'rgba(130,78,40,.4)' : 'rgba(150,134,104,.5)'); gr.addColorStop(1, 'rgba(90,70,50,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); } });
    cell('lid', (w, h) => { g.fillStyle = 'rgb(118,116,108)'; g.fillRect(20, 50, w - 40, h - 100); g.fillStyle = 'rgb(64,60,56)'; g.fillRect(34, 64, w - 68, h - 128); g.fillStyle = 'rgb(84,78,72)'; for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) g.fillRect(44 + i * 22, 74 + j * 22, 10, 10); g.fillStyle = 'rgb(140,134,120)'; g.font = '700 16px Arial'; g.textAlign = 'center'; g.fillText('WATER', w / 2, h / 2 + 5); });
    return ctex(c, { aniso: 16 });
  }
  const mkUV = k => { const [x, y, w, h] = MK[k]; return [x / 1024, 1 - (y + h) / 1024, (x + w) / 1024, 1 - y / 1024]; };

  /* ---- flora atlas (2048×1024, straight alpha, colour bled into the transparent texels so mips do not fringe) */
  const FL = { frondA: [0, 0, 1024, 256], frondB: [0, 256, 1024, 256], frondDead: [0, 512, 1024, 256], frondRoyal: [0, 768, 1024, 256], trunkC: [1024, 0, 256, 512], trunkR: [1280, 0, 256, 512], shaft: [1536, 0, 256, 256], coco: [1536, 256, 256, 256],
    grape: [1792, 0, 256, 256], flower: [1792, 256, 256, 256], tuft: [1024, 512, 256, 256], oats: [1280, 512, 256, 256], weed: [1536, 512, 256, 256], shrub: [1792, 512, 256, 256], treeline: [1024, 768, 1024, 256] };
  const flUV = (k, inset) => { const [x, y, w, h] = FL[k], i = inset === undefined ? 1.5 : inset; return [(x + i) / 2048, (y + i) / 1024, (x + w - i) / 2048, (y + h - i) / 1024]; };   // v0 = top of the cell
  function texFlora() {
    const W = 2048, H = 1024, c = cv(W, H), g = c.getContext('2d'), r = GT.rng('flora'), rr = (a, b) => a + (b - a) * r(), fills = {};
    const cell = (k, fill, fn) => { const [x, y, w, h] = FL[k]; fills[k] = fill; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y); fn(w, h); g.restore(); };
    const hsl = (h, s, l, a) => 'hsla(' + h.toFixed(0) + ',' + s.toFixed(0) + '%,' + l.toFixed(0) + '%,' + (a === undefined ? 1 : a) + ')';
    function frond(w, h, o) { const cy = h / 2, N = o.n;
      for (let i = 0; i < N; i++) for (const side of [-1, 1]) { const t = (i + r() * .7) / N; if (r() < o.gap) continue; const x = 22 + t * (w - 80), env = Math.pow(Math.sin(PI * Math.min(1, t * .9 + .1)), .5);
        let len = (cy - 7) * lerp(env, 1, o.uni || 0) * rr(.82, 1); if (r() < (o.tat || 0)) len *= rr(.3, .8); const ang = lerp(o.a0, o.a1, t) + rr(-.07, .07), dx = Math.cos(ang), dy = side * Math.sin(ang), px = -dy, py = dx, wd = o.lw * rr(.75, 1.25), bend = rr(-.1, .22) * len;
        const tx = x + dx * len + bend * .6, ty = cy + dy * len - side * bend * .35, mx = x + dx * len * .38, my = cy + dy * len * .38, dry = r() < (o.dry || 0);
        g.fillStyle = o.dead ? hsl(rr(24, 40), rr(26, 42), rr(20, 40)) : dry ? hsl(rr(40, 55), rr(35, 50), rr(30, 42)) : hsl(rr(66, 98), rr(30, 50), rr(13, 29));
        g.beginPath(); g.moveTo(x - px * wd * .35, cy - py * wd * .35); g.quadraticCurveTo(mx - px * wd, my - py * wd, tx, ty); g.quadraticCurveTo(mx + px * wd, my + py * wd, x + px * wd * .35, cy + py * wd * .35); g.closePath(); g.fill();
        if (!o.dead && r() < .7) { g.strokeStyle = hsl(rr(70, 90), 38, rr(34, 46), .55); g.lineWidth = 1; g.beginPath(); g.moveTo(x, cy); g.quadraticCurveTo(mx, my, tx, ty); g.stroke(); } }
      g.fillStyle = o.dead ? hsl(30, 30, 30) : hsl(58, 36, 30); g.beginPath(); g.moveTo(2, cy - 7); g.lineTo(w - 50, cy - 1.5); g.lineTo(w - 50, cy + 1.5); g.lineTo(2, cy + 7); g.closePath(); g.fill();
      g.strokeStyle = o.dead ? hsl(34, 30, 44, .6) : hsl(62, 40, 46, .7); g.lineWidth = 1.6; g.beginPath(); g.moveTo(2, cy - 2); g.lineTo(w - 50, cy); g.stroke(); }
    cell('frondA', [52, 66, 30], (w, h) => frond(w, h, { n: 62, gap: .04, a0: 1.25, a1: .42, lw: 7.5, dry: .05 }));
    cell('frondB', [58, 66, 30], (w, h) => frond(w, h, { n: 50, gap: .14, a0: 1.3, a1: .5, lw: 7, dry: .2, tat: .3 }));
    cell('frondDead', [84, 64, 42], (w, h) => frond(w, h, { n: 40, gap: .25, a0: 1.0, a1: .3, lw: 5.5, dead: 1, tat: .5 }));
    cell('frondRoyal', [44, 62, 30], (w, h) => frond(w, h, { n: 92, gap: .03, a0: 1.15, a1: .5, lw: 4.6, uni: .35, dry: .03 }));
    cell('trunkC', [126, 116, 102], (w, h) => { g.fillStyle = 'rgb(130,120,106)'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) { const x = rr(0, w), y = rr(0, h), rad = rr(14, 60), gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, r() < .55 ? rgba(164, 160, 146, .32) : rgba(84, 72, 58, .3)); gr.addColorStop(1, rgba(126, 116, 102, 0)); g.fillStyle = gr; for (const oy of [0, -h, h]) g.fillRect(x - rad, y - rad + oy, rad * 2, rad * 2); }
      const nR = 26; for (let i = 0; i < nR; i++) { const y = (i + .5) * h / nR + rr(-2, 2), ph = rr(0, 6), am = rr(.6, 2.4), gr = g.createLinearGradient(0, y - 9, 0, y + 1); gr.addColorStop(0, rgba(150, 140, 124, 0)); gr.addColorStop(.7, rgba(160, 150, 134, .28)); gr.addColorStop(1, rgba(70, 58, 46, .5)); g.fillStyle = gr; g.fillRect(0, y - 9, w, 10);
        g.strokeStyle = rgba(58, 48, 38, rr(.35, .6)); g.lineWidth = rr(1, 1.9); g.beginPath(); for (let x = 0; x <= w; x += 8) { const yy = y + Math.sin(x / w * TAU * 2 + ph) * am + Math.sin(x / w * TAU * 5 + ph * 2) * .6; x ? g.lineTo(x, yy) : g.moveTo(x, yy); } g.stroke(); }
      for (let i = 0; i < 900; i++) { g.fillStyle = r() < .55 ? rgba(62, 52, 42, rr(.05, .16)) : rgba(190, 180, 164, rr(.04, .12)); const x = rr(0, w), y = rr(0, h), l = rr(6, 30); g.fillRect(x, y, 1, l); } });
    cell('trunkR', [146, 142, 132], (w, h) => { g.fillStyle = 'rgb(150,146,136)'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) { const x = rr(0, w), y = rr(0, h), rad = rr(14, 60), gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, r() < .5 ? rgba(110, 116, 100, .3) : rgba(186, 182, 172, .3)); gr.addColorStop(1, rgba(150, 146, 136, 0)); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.fillRect(x - rad, y - rad - h, rad * 2, rad * 2); }
      for (let i = 0; i < 6; i++) { const y = (i + .5) * h / 6; g.fillStyle = rgba(96, 92, 84, .5); g.fillRect(0, y, w, 2.5); g.fillStyle = rgba(196, 192, 182, .4); g.fillRect(0, y + 3, w, 1.5); }
      for (let i = 0; i < 200; i++) { g.fillStyle = rgba(90, 86, 78, rr(.05, .14)); g.fillRect(rr(0, w), rr(0, h), rr(1, 2), rr(20, 90)); } });
    cell('shaft', [86, 112, 58], (w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgb(92,124,60)'); gr.addColorStop(.75, 'rgb(84,108,58)'); gr.addColorStop(1, 'rgb(118,104,70)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 160; i++) { g.fillStyle = r() < .5 ? rgba(50, 72, 34, rr(.08, .22)) : rgba(150, 170, 104, rr(.06, .16)); g.fillRect(rr(0, w), rr(0, h), rr(1, 3), rr(30, 200)); } });
    cell('coco', [86, 76, 40], (w, h) => { g.fillStyle = 'rgb(88,80,42)'; g.fillRect(0, 0, w, h); for (let i = 0; i < 90; i++) { const x = rr(0, w), y = rr(0, h), rad = rr(8, 40), gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, r() < .5 ? rgba(110, 82, 44, .5) : rgba(64, 74, 34, .5)); gr.addColorStop(1, rgba(88, 80, 42, 0)); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); } });
    const leaves = (w, h, n, r0, r1, colFn, rad0) => { const p1 = rr(0, 6), p2 = rr(0, 6), p3 = rr(0, 6); for (let i = 0; i < n; i++) { const a = rr(0, TAU), rad = rad0 * (.66 + .16 * Math.sin(a * 2 + p1) + .12 * Math.sin(a * 3 + p2) + .08 * Math.sin(a * 5 + p3)), d = Math.sqrt(r()) * rad, x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d * .96, s = rr(r0, r1), k = i / n; g.fillStyle = colFn(k, y / h); g.beginPath(); g.ellipse(x, y, s, s * rr(.42, .75), rr(0, PI), 0, TAU); g.fill(); } };
    cell('shrub', [30, 44, 28], (w, h) => leaves(w, h, 2600, 2.4, 5.5, (k, v) => hsl(rr(88, 126), rr(18, 32), lerp(6, 25, k * k) * lerp(1.25, .6, v)), 116));
    cell('grape', [40, 54, 32], (w, h) => leaves(w, h, 900, 5, 9.5, (k, v) => r() < .05 ? hsl(rr(12, 26), 28, rr(18, 26)) : hsl(rr(78, 106), rr(18, 30), lerp(7, 28, k * k) * lerp(1.25, .62, v)), 112));
    cell('flower', [38, 48, 32], (w, h) => { leaves(w, h, 2200, 2.4, 5.5, (k, v) => hsl(rr(88, 120), rr(18, 30), lerp(6, 24, k * k) * lerp(1.25, .6, v)), 114); leaves(w, h, 380, 1.6, 3.2, () => hsl(rr(318, 338), rr(34, 48), rr(30, 44)), 106); });
    cell('tuft', [116, 108, 76], (w, h) => { for (let i = 0; i < 300; i++) { const x0 = w / 2 + rr(-30, 30), x1 = x0 + rr(-70, 70) * (.4 + r()), y1 = rr(30, 200) + Math.abs(x1 - w / 2) * .5, dry = r() < .6; g.strokeStyle = dry ? hsl(rr(38, 52), rr(18, 30), rr(34, 54)) : hsl(rr(64, 88), rr(18, 28), rr(22, 36)); g.lineWidth = rr(.9, 2.1); g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, h); g.quadraticCurveTo(x0 + (x1 - x0) * .2, h - (h - y1) * .7, x1, y1); g.stroke(); } });
    cell('oats', [128, 120, 88], (w, h) => { for (let i = 0; i < 170; i++) { const x0 = w / 2 + rr(-26, 26), x1 = x0 + rr(-80, 80) * (.3 + r()), y1 = rr(8, 130); g.strokeStyle = r() < .5 ? hsl(rr(40, 54), rr(18, 30), rr(36, 56)) : hsl(rr(62, 86), rr(16, 26), rr(26, 40)); g.lineWidth = rr(.9, 1.9); g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, h); g.quadraticCurveTo(x0 + (x1 - x0) * .15, h - (h - y1) * .8, x1, y1); g.stroke();
        if (r() < .22) { g.fillStyle = hsl(rr(36, 44), 30, rr(42, 54)); for (let k = 0; k < 10; k++) { g.beginPath(); g.ellipse(x1 + rr(-4, 4) + k * (x1 > w / 2 ? 1.4 : -1.4), y1 + k * 3 + rr(-2, 2), 2.4, 1.3, rr(0, 3), 0, TAU); g.fill(); } } } });
    cell('weed', [62, 80, 42], (w, h) => { for (let i = 0; i < 26; i++) { const x0 = w / 2 + rr(-30, 30), x1 = w / 2 + rr(-100, 100), y1 = rr(30, 170); g.strokeStyle = hsl(rr(78, 100), 30, rr(22, 34)); g.lineWidth = rr(2, 3.4); g.beginPath(); g.moveTo(x0, h); g.quadraticCurveTo(x0, (h + y1) / 2, x1, y1); g.stroke();
        for (let k = 0; k < 7; k++) { const t = rr(.3, 1), x = x0 + (x1 - x0) * t * t, y = h + (y1 - h) * t; g.fillStyle = hsl(rr(84, 116), rr(28, 42), rr(18, 36)); g.beginPath(); g.ellipse(x + rr(-12, 12), y + rr(-6, 6), rr(8, 17), rr(3.5, 7), rr(-1, 1), 0, TAU); g.fill(); }
        if (r() < .3) { g.fillStyle = hsl(50, 70, 55); g.beginPath(); g.arc(x1, y1, 4.5, 0, TAU); g.fill(); } } });
    cell('treeline', [26, 36, 28], (w, h) => { for (let i = 0; i < 260; i++) { const x = rr(-20, w + 20), rad = rr(14, 46), y = h - rr(0, 46) - rad * .4; g.fillStyle = hsl(rr(95, 135), rr(18, 30), rr(8, 17)); g.beginPath(); g.ellipse(x, y, rad, rad * rr(.6, 1), 0, 0, TAU); g.fill(); }
      for (let i = 0; i < 20; i++) { const x = 30 + (i + r() * .7) * (w - 60) / 20, top = rr(24, 150), lean = rr(-16, 16); g.strokeStyle = 'rgb(34,32,26)'; g.lineWidth = rr(3, 5); g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x, (h + top) / 2, x + lean, top); g.stroke();
        for (let k = 0; k < 11; k++) { const a = -PI / 2 + (k - 5) * .52 + rr(-.15, .15), l = rr(26, 44); g.strokeStyle = hsl(rr(84, 110), 24, rr(9, 17)); g.lineWidth = rr(4, 7.5); g.lineCap = 'round'; g.beginPath(); g.moveTo(x + lean, top); g.quadraticCurveTo(x + lean + Math.cos(a) * l * .7, top + Math.sin(a) * l * .7 - 9, x + lean + Math.cos(a) * l, top + Math.sin(a) * l + Math.abs(Math.cos(a)) * 14); g.stroke(); } } });
    const im = g.getImageData(0, 0, W, H), d = im.data;
    for (const k in FL) { const [x0, y0, w, h] = FL[k], f = fills[k]; if (!f) continue; for (let y = y0; y < y0 + h; y++) for (let x = x0, j = (y * W + x0) * 4; x < x0 + w; x++, j += 4) { const a = d[j + 3]; if (a < 250) { const k2 = a / 255; d[j] = d[j] * k2 + f[0] * (1 - k2); d[j + 1] = d[j + 1] * k2 + f[1] * (1 - k2); d[j + 2] = d[j + 2] * k2 + f[2] * (1 - k2); d[j + 3] = Math.min(255, a * 1.5); } } }
    const t = new T.DataTexture(new Uint8Array(d.buffer), W, H, T.RGBAFormat); t.encoding = T.sRGBEncoding; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
  }

  /* ---- sign atlas (2048²): billboards, road signs, shop fascias. All names are original. */
  const SG = { bbRadio: [0, 0, 1024, 300], bbLaw: [1024, 0, 1024, 300], bbGator: [0, 300, 1024, 300], bbMotors: [1024, 300, 1024, 300], storage: [0, 600, 1024, 160], taco: [1024, 600, 768, 256], busAd: [1792, 600, 256, 400],
    speed45: [0, 768, 192, 240], speed30: [192, 768, 192, 240], shield: [384, 768, 192, 192], closed: [576, 768, 384, 256], ped: [960, 768, 192, 192], stopSign: [1152, 860, 192, 192], noPark: [1344, 860, 128, 192], busSign: [1472, 860, 128, 192], tow: [1600, 860, 160, 140],
    stOcean: [0, 1040, 512, 96], stCoral: [512, 1040, 512, 96], stHeron: [1024, 1040, 512, 96], stBack: [1536, 1040, 512, 96], detour: [0, 1150, 256, 256], deadEnd: [256, 1150, 256, 256], lease: [512, 1150, 384, 256], news: [896, 1150, 256, 256], news2: [1152, 1150, 256, 256],
    beachRules: [1408, 1150, 320, 256], guard: [1728, 1150, 320, 256], mall: [0, 1420, 2048, 128], stripe: [0, 1560, 512, 64], drum: [512, 1560, 256, 128], office: [768, 1560, 512, 128], barrel: [1280, 1560, 256, 128], num7: [1536, 1560, 128, 128], benchAd: [0, 1700, 512, 128], menu: [512, 1700, 512, 300], awning: [1024, 1700, 256, 128], mail: [1280, 1700, 256, 128], oneWay: [1536, 1700, 384, 128], wood: [1664, 1560, 128, 128] };
  const sgUV = k => { const [x, y, w, h] = SG[k]; return [(x + 1) / 2048, 1 - (y + h - 1) / 2048, (x + w - 1) / 2048, 1 - (y + 1) / 2048]; };   // [u0, vBottom, u1, vTop]
  function texSigns() {
    const S = 2048, c = cv(S, S), g = c.getContext('2d'), r = GT.rng('signs'), rr = (a, b) => a + (b - a) * r();
    const F = '"Avenir Next Condensed","Arial Narrow","Helvetica Neue",Arial,sans-serif', FS = '"Snell Roundhand","Brush Script MT","Segoe Script",cursive';
    g.fillStyle = '#777'; g.fillRect(0, 0, S, S);
    const cell = (k, fn) => { const [x, y, w, h] = SG[k]; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y); fn(w, h); g.restore(); };
    const tx = (s, x, y, size, col, o) => { o = o || {}; g.font = (o.it ? 'italic ' : '') + (o.wt || 800) + ' ' + size + 'px ' + (o.font || F); g.textAlign = o.al || 'center'; g.textBaseline = 'middle'; if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = o.sw || size * .12; g.lineJoin = 'round'; g.strokeText(s, x, y, o.max); } g.fillStyle = col; g.fillText(s, x, y, o.max); };
    const grad = (w, h, a, b, c2) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, a); if (c2) gr.addColorStop(.55, c2); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, w, h); };
    const palm = (x, y, s, col) => { g.strokeStyle = col; g.lineCap = 'round'; g.lineWidth = s * .07; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + s * .05, y - s * .5, x + s * .16, y - s); g.stroke(); for (let k = 0; k < 9; k++) { const a = -PI / 2 + (k - 4) * .6, l = s * .42; g.lineWidth = s * .06; g.beginPath(); g.moveTo(x + s * .16, y - s); g.quadraticCurveTo(x + s * .16 + Math.cos(a) * l * .6, y - s + Math.sin(a) * l * .6 - s * .1, x + s * .16 + Math.cos(a) * l, y - s + Math.sin(a) * l + s * .14); g.stroke(); } };
    cell('bbRadio', (w, h) => { grad(w, h, '#2a1b4a', '#f2a04a', '#c2476a'); g.fillStyle = '#ffd98a'; g.beginPath(); g.arc(770, 250, 150, 0, TAU); g.fill(); g.fillStyle = 'rgba(194,71,106,.9)'; for (let i = 0; i < 6; i++) g.fillRect(600, 150 + i * 26, 340, 7 + i * 1.6);
      g.fillStyle = '#1a1030'; g.fillRect(0, 262, w, 40); palm(905, 275, 190, '#1a1030'); palm(965, 280, 130, '#1a1030'); palm(60, 280, 120, '#1a1030');
      tx('CORAL 98.1', 330, 112, 150, '#fff3d6', { it: 1, wt: 900, stroke: '#3a1848', sw: 10 }); tx('the sound of sunset', 330, 214, 62, '#ffe1a8', { font: FS, wt: 700 }); });
    cell('bbLaw', (w, h) => { g.fillStyle = '#e9e4d6'; g.fillRect(0, 0, w, h); g.fillStyle = '#12284a'; g.fillRect(0, 0, 330, h); g.fillStyle = '#c9a23a'; g.fillRect(330, 0, 10, h);
      // generic silhouette portrait
      g.fillStyle = '#7a8aa6'; g.beginPath(); g.arc(165, 112, 58, 0, TAU); g.fill(); g.beginPath(); g.ellipse(165, 300, 128, 130, 0, 0, TAU); g.fill(); g.fillStyle = '#e9e4d6'; g.beginPath(); g.moveTo(165, 180); g.lineTo(140, 300); g.lineTo(190, 300); g.closePath(); g.fill(); g.fillStyle = '#a3262e'; g.fillRect(158, 196, 14, 104);
      tx('HURT IN A WRECK?', 680, 62, 92, '#a3262e', { wt: 900, max: 640 }); tx('MORALES & FINCH', 680, 152, 104, '#12284a', { wt: 900, max: 640 }); tx('INJURY ATTORNEYS  ·  NO FEE UNLESS WE WIN', 680, 216, 36, '#12284a', { wt: 700, max: 640 }); g.fillStyle = '#12284a'; g.fillRect(360, 244, 640, 46); tx('CALL  305 · 555 · 0147', 680, 268, 40, '#f1d27a', { wt: 800 }); });
    cell('bbGator', (w, h) => { grad(w, h, '#bfe3df', '#2f6b4a', '#7fb890'); g.fillStyle = '#1c4a34'; for (let i = 0; i < 60; i++) { const x = rr(0, w), hh = rr(30, 90); g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + rr(-12, 12), h - hh * .6, x + rr(-26, 26), h - hh); g.lineTo(x + 6, h); g.fill(); }
      // airboat silhouette
      g.fillStyle = '#16302a'; g.beginPath(); g.moveTo(640, 236); g.lineTo(980, 236); g.lineTo(950, 262); g.lineTo(670, 262); g.closePath(); g.fill(); g.strokeStyle = '#16302a'; g.lineWidth = 7; g.beginPath(); g.ellipse(930, 176, 34, 56, 0, 0, TAU); g.stroke(); g.fillRect(880, 170, 16, 66); g.fillRect(780, 196, 60, 40); g.fillRect(700, 210, 50, 26);
      tx('GATOR LAGOON', 350, 86, 118, '#fff6d8', { wt: 900, stroke: '#1c4a34', sw: 12, max: 620 }); tx('AIRBOAT TOURS', 350, 172, 74, '#ffd24a', { wt: 900, stroke: '#1c4a34', sw: 8 }); tx('11 MILES  ·  EXIT 14  ·  KIDS RIDE FREE', 350, 244, 34, '#fff6d8', { wt: 700 }); });
    cell('bbMotors', (w, h) => { g.fillStyle = '#d8c63a'; g.fillRect(0, 0, w, h); g.fillStyle = '#b3242c'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, 96); g.lineTo(0, 140); g.fill(); g.fillStyle = '#12284a'; g.fillRect(0, h - 64, w, 64);
      tx('PELICAN MOTORS', w / 2, 64, 112, '#fff', { wt: 900, it: 1, max: 960 }); tx('BUY HERE · PAY HERE', w / 2, 180, 92, '#12284a', { wt: 900, max: 940 }); tx('NO CREDIT?  NO PROBLEM!     $499 DOWN     WE FINANCE ANYBODY', w / 2, h - 31, 36, '#ffe14a', { wt: 800, max: 980 }); });
    cell('storage', (w, h) => { g.fillStyle = '#e8862a'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d2c3a'; g.fillRect(0, h - 44, w, 44); tx('STOW·AWAY  SELF STORAGE', w / 2, 60, 86, '#fff', { wt: 900, max: 980 }); tx('UNITS FROM $39  ·  24 HR GATE ACCESS  ·  BOAT & RV', w / 2, h - 21, 30, '#ffd9a0', { wt: 700 }); });
    cell('taco', (w, h) => { g.fillStyle = '#e6e0d0'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a9a8c'; g.fillRect(0, h - 70, w, 70); g.fillStyle = '#d6452e'; g.fillRect(0, h - 84, w, 14); g.fillStyle = '#f0b62a'; g.beginPath(); g.arc(130, 110, 74, PI, 0); g.fill(); g.fillStyle = '#7a4a20'; g.fillRect(56, 108, 148, 12); g.fillStyle = '#4a8a2a'; g.fillRect(64, 96, 132, 10);
      tx('TACOS EL FARO', 480, 70, 96, '#d6452e', { wt: 900, max: 520 }); tx('al pastor · carnitas · pescado', 480, 140, 38, '#2a2a2a', { wt: 600, it: 1 }); tx('ABIERTO TARDE  ·  OPEN LATE', 384, h - 34, 40, '#fff', { wt: 800 }); });
    cell('busAd', (w, h) => { grad(w, h, '#0e2c3c', '#e8773a', '#8a3a66'); g.fillStyle = '#ffd98a'; g.beginPath(); g.arc(128, 250, 62, 0, TAU); g.fill(); g.fillStyle = '#0e1c2c'; g.fillRect(0, 300, w, 100); tx('MAREA', 128, 70, 78, '#fff', { wt: 900 }); tx('104.5 FM', 128, 132, 46, '#ffd98a', { wt: 800 }); tx('dembow', 128, 336, 46, '#fff', { font: FS, wt: 700 }); tx('all night long', 128, 374, 26, '#ffd98a', { wt: 600, it: 1 }); });
    const speed = (k, n) => cell(k, (w, h) => { g.fillStyle = '#e9e9e4'; g.fillRect(0, 0, w, h); g.strokeStyle = '#151515'; g.lineWidth = 5; g.strokeRect(9, 9, w - 18, h - 18); tx('SPEED', w / 2, 46, 46, '#151515', { wt: 800 }); tx('LIMIT', w / 2, 90, 46, '#151515', { wt: 800 }); tx(n, w / 2, 172, 120, '#151515', { wt: 800 }); });
    speed('speed45', '45'); speed('speed30', '30');
    cell('shield', (w, h) => { g.fillStyle = '#16181a'; g.fillRect(0, 0, w, h); g.fillStyle = '#ecebe4'; g.beginPath(); g.moveTo(96, 12); for (let i = 1; i <= 11; i++) { const a = -PI / 2 + i * TAU / 12 * 1, rad = i % 2 ? 76 : 86; g.lineTo(96 + Math.cos(a) * rad, 92 + Math.sin(a) * rad * .92); } g.closePath(); g.fill(); g.fillStyle = '#1f6a72'; g.beginPath(); g.arc(96, 92, 62, PI, 0); g.fill(); tx('COASTAL', 96, 60, 24, '#ecebe4', { wt: 800 }); tx('9', 96, 122, 74, '#16181a', { wt: 900 }); });
    cell('closed', (w, h) => { g.fillStyle = '#e9e9e4'; g.fillRect(0, 0, w, h); g.strokeStyle = '#151515'; g.lineWidth = 7; g.strokeRect(10, 10, w - 20, h - 20); tx('ROAD', w / 2, 82, 110, '#151515', { wt: 900 }); tx('CLOSED', w / 2, 182, 110, '#151515', { wt: 900, max: 330 }); });
    cell('ped', (w, h) => { g.fillStyle = '#6a6a66'; g.fillRect(0, 0, w, h); g.save(); g.translate(96, 96); g.rotate(PI / 4); g.fillStyle = '#e2b616'; g.fillRect(-66, -66, 132, 132); g.strokeStyle = '#151515'; g.lineWidth = 4; g.strokeRect(-58, -58, 116, 116); g.restore(); g.fillStyle = '#151515'; g.beginPath(); g.arc(98, 58, 10, 0, TAU); g.fill(); g.lineWidth = 9; g.lineCap = 'round'; g.strokeStyle = '#151515'; g.beginPath(); g.moveTo(96, 72); g.lineTo(92, 106); g.lineTo(76, 136); g.moveTo(92, 106); g.lineTo(110, 134); g.moveTo(94, 80); g.lineTo(74, 98); g.moveTo(94, 80); g.lineTo(116, 96); g.stroke(); });
    cell('stopSign', (w, h) => { g.fillStyle = '#6a6a66'; g.fillRect(0, 0, w, h); g.fillStyle = '#b0222a'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = PI / 8 + i * PI / 4; i ? g.lineTo(96 + Math.cos(a) * 94, 96 + Math.sin(a) * 94) : g.moveTo(96 + Math.cos(a) * 94, 96 + Math.sin(a) * 94); } g.closePath(); g.fill(); g.strokeStyle = '#eee'; g.lineWidth = 5; g.beginPath(); for (let i = 0; i < 8; i++) { const a = PI / 8 + i * PI / 4; i ? g.lineTo(96 + Math.cos(a) * 84, 96 + Math.sin(a) * 84) : g.moveTo(96 + Math.cos(a) * 84, 96 + Math.sin(a) * 84); } g.closePath(); g.stroke(); tx('STOP', 96, 100, 70, '#eee', { wt: 800 }); });
    cell('noPark', (w, h) => { g.fillStyle = '#e9e9e4'; g.fillRect(0, 0, w, h); g.strokeStyle = '#b0222a'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12); tx('NO', 64, 40, 44, '#b0222a'); tx('PARKING', 64, 80, 28, '#b0222a'); tx('ANY', 64, 116, 30, '#b0222a'); tx('TIME', 64, 150, 30, '#b0222a'); });
    cell('busSign', (w, h) => { g.fillStyle = '#1d4a8a'; g.fillRect(0, 0, w, h); g.fillStyle = '#e9e9e4'; g.fillRect(20, 26, 88, 60); g.fillStyle = '#1d4a8a'; g.fillRect(28, 34, 72, 26); g.fillStyle = '#e9e9e4'; tx('BUS', 64, 116, 40, '#e9e9e4'); tx('ROUTE 9', 64, 158, 26, '#ffd24a'); });
    cell('tow', (w, h) => { g.fillStyle = '#e9e9e4'; g.fillRect(0, 0, w, h); g.fillStyle = '#b0222a'; g.fillRect(0, 0, w, 40); tx('TOW-AWAY', 80, 21, 28, '#fff'); tx('ZONE', 80, 68, 40, '#b0222a'); tx('UNAUTHORIZED', 80, 102, 18, '#222'); tx('VEHICLES', 80, 122, 18, '#222'); });
    const blade = (k, s) => cell(k, (w, h) => { g.fillStyle = '#1c6a48'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e9e9e4'; g.lineWidth = 4; g.strokeRect(5, 5, w - 10, h - 10); tx(s, w / 2, h / 2 + 2, 62, '#e9e9e4', { wt: 800, max: w - 40 }); });
    blade('stOcean', 'OCEAN HWY'); blade('stCoral', 'CORAL ST'); blade('stHeron', 'HERON ST'); blade('stBack', 'BACKWATER RD');
    cell('detour', (w, h) => { g.fillStyle = '#e07a1c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#151515'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20); tx('ROAD', w / 2, 70, 66, '#151515'); tx('WORK', w / 2, 132, 66, '#151515'); tx('AHEAD', w / 2, 194, 66, '#151515'); });
    cell('deadEnd', (w, h) => { g.fillStyle = '#e2b616'; g.fillRect(0, 0, w, h); g.strokeStyle = '#151515'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20); tx('DEAD', w / 2, 92, 84, '#151515'); tx('END', w / 2, 174, 84, '#151515'); });
    cell('lease', (w, h) => { g.fillStyle = '#e9e9e4'; g.fillRect(0, 0, w, h); g.fillStyle = '#a3262e'; g.fillRect(0, 0, w, 86); tx('FOR LEASE', w / 2, 46, 70, '#fff', { wt: 900 }); tx('2.4 ACRES · ZONED C-2', w / 2, 122, 32, '#222'); tx('BAYLINE REALTY', w / 2, 168, 44, '#12284a', { wt: 900 }); tx('305 · 555 · 0190', w / 2, 218, 40, '#222'); });
    cell('news', (w, h) => { g.fillStyle = '#b3242c'; g.fillRect(0, 0, w, h); g.fillStyle = '#10161a'; g.fillRect(24, 56, w - 48, 120); g.fillStyle = '#d8d4c6'; g.fillRect(36, 66, w - 72, 100); tx('THE COAST LEDGER', w / 2, 86, 20, '#111', { wt: 900 }); g.fillStyle = '#555'; for (let i = 0; i < 6; i++) g.fillRect(44, 104 + i * 10, w - 88 - (i % 2) * 30, 4); tx('LEDGER', w / 2, 30, 34, '#fff', { wt: 900 }); tx('75¢ DAILY', w / 2, 214, 30, '#ffe14a'); });
    cell('news2', (w, h) => { g.fillStyle = '#2a5a9a'; g.fillRect(0, 0, w, h); g.fillStyle = '#10161a'; g.fillRect(24, 56, w - 48, 120); g.fillStyle = '#e4dcc0'; g.fillRect(36, 66, w - 72, 100); tx('AUTO SHOPPER', w / 2, 88, 22, '#a3262e', { wt: 900 }); g.fillStyle = '#666'; for (let i = 0; i < 6; i++) g.fillRect(44, 106 + i * 10, w - 88 - (i % 3) * 22, 4); tx('FREE', w / 2, 30, 40, '#ffe14a', { wt: 900 }); tx('TAKE ONE', w / 2, 214, 30, '#fff'); });
    cell('beachRules', (w, h) => { g.fillStyle = '#e9e6da'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f6a72'; g.fillRect(0, 0, w, 56); tx('BEACH RULES', w / 2, 30, 38, '#fff'); const rules = ['NO GLASS CONTAINERS', 'NO FIRES · NO CAMPING', 'NO VEHICLES ON SAND', 'DOGS ON LEASH ONLY', 'BEACH CLOSES AT 11 PM']; rules.forEach((s, i) => tx(s, w / 2, 86 + i * 34, 24, '#222', { wt: 700 })); });
    cell('guard', (w, h) => { g.fillStyle = '#e2b616'; g.fillRect(0, 0, w, h); g.strokeStyle = '#151515'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16); tx('NO LIFEGUARD', w / 2, 70, 44, '#151515', { wt: 900 }); tx('ON DUTY', w / 2, 122, 54, '#151515', { wt: 900 }); tx('SWIM AT YOUR OWN RISK', w / 2, 186, 25, '#151515'); tx('RIP CURRENTS', w / 2, 220, 25, '#a3262e'); });
    cell('mall', (w, h) => { const shops = [['COIN LAUNDRY', '#1d4a8a', '#fff'], ['PAWN & GOLD', '#d8c63a', '#151515'], ['LUNA NAILS', '#c2476a', '#fff'], ['BOTANICA SOL', '#2a7a4a', '#ffe9a0'], ['SMOKE · VAPE', '#151515', '#6fe0c0']]; shops.forEach((s, i) => { const x = i * w / 5; g.fillStyle = s[1]; g.fillRect(x, 0, w / 5, h); g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 4; g.strokeRect(x + 4, 4, w / 5 - 8, h - 8); tx(s[0], x + w / 10, h / 2 + 2, 62, s[2], { wt: 900, max: w / 5 - 40 }); }); });
    cell('stripe', (w, h) => { g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, w, h); g.fillStyle = '#e0701c'; for (let i = -2; i < 12; i++) { g.beginPath(); g.moveTo(i * 64, h); g.lineTo(i * 64 + 32, h); g.lineTo(i * 64 + 32 + h, 0); g.lineTo(i * 64 + h, 0); g.fill(); } });
    cell('drum', (w, h) => { g.fillStyle = '#e0701c'; g.fillRect(0, 0, w, h); g.fillStyle = '#e9e6dc'; g.fillRect(0, 18, w, 22); g.fillRect(0, 62, w, 22); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 104, w, 24); });
    cell('office', (w, h) => { g.fillStyle = '#12284a'; g.fillRect(0, 0, w, h); tx('OFFICE', 150, h / 2, 76, '#fff', { wt: 900 }); tx('SE HABLA ESPAÑOL', 382, 42, 30, '#ffe14a'); tx('FINANCING · TRADES', 382, 88, 28, '#fff'); });
    cell('barrel', (w, h) => { g.fillStyle = '#2f6f86'; g.fillRect(0, 0, w, h); tx('KEEP OUR', w / 2, 40, 36, '#e9e6dc', { font: '"Stencil","Arial Narrow",Arial', wt: 700 }); tx('BEACH CLEAN', w / 2, 86, 36, '#e9e6dc', { font: '"Stencil","Arial Narrow",Arial', wt: 700 }); });
    cell('num7', (w, h) => { g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, w, h); tx('7', w / 2, h / 2 + 4, 110, '#b3242c', { wt: 900 }); });
    cell('benchAd', (w, h) => { g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f6a72'; g.fillRect(0, 0, 130, h); tx('YOUR', 65, 40, 36, '#fff'); tx('AD', 65, 86, 44, '#fff'); tx('BAYLINE BENCH ADS', 320, 42, 34, '#12284a', { wt: 900 }); tx('305 · 555 · 0112', 320, 90, 40, '#a3262e', { wt: 900 }); });
    cell('menu', (w, h) => { g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, w, h); tx('MENU', w / 2, 34, 44, '#f0b62a', { wt: 900 }); const it = [['TACO AL PASTOR', '2.50'], ['TACO DE PESCADO', '3.25'], ['BURRITO GRANDE', '7.00'], ['QUESADILLA', '5.50'], ['ELOTE', '3.00'], ['HORCHATA · JAMAICA', '2.00']]; it.forEach((s, i) => { tx(s[0], 30, 86 + i * 34, 26, '#eee', { al: 'left', wt: 700 }); tx(s[1], w - 30, 86 + i * 34, 26, '#f0b62a', { al: 'right', wt: 700 }); }); });
    cell('awning', (w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i & 1 ? '#e6e0d0' : '#d6452e'; g.fillRect(i * 32, 0, 32, h); } });
    cell('mail', (w, h) => { g.fillStyle = '#2b4a7a'; g.fillRect(0, 0, w, h); tx('PARCEL POST', w / 2, 38, 32, '#e9e9e4', { wt: 800 }); g.fillStyle = '#e9e9e4'; g.fillRect(40, 66, w - 80, 44); tx('PICKUP  M–F 5 PM · SAT 1 PM', w / 2, 88, 14, '#222', { wt: 700 }); });
    cell('oneWay', (w, h) => { g.fillStyle = '#151515'; g.fillRect(0, 0, w, h); g.fillStyle = '#e9e9e4'; g.beginPath(); g.moveTo(20, 44); g.lineTo(280, 44); g.lineTo(280, 20); g.lineTo(364, 64); g.lineTo(280, 108); g.lineTo(280, 84); g.lineTo(20, 84); g.fill(); tx('BEACH ACCESS', 150, 65, 30, '#151515', { wt: 900 }); });
    cell('wood', (w, h) => { g.fillStyle = '#8a7a66'; g.fillRect(0, 0, w, h); for (let i = 0; i < 90; i++) { g.fillStyle = rgba(rr(50, 190), rr(44, 170), rr(36, 140), rr(.08, .22)); g.fillRect(0, rr(0, h), w, rr(1, 4)); } });
    // weathering: sun-fade, grime, streaks (billboards peel, signs chalk)
    g.fillStyle = 'rgba(214,204,186,.10)'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 520; i++) { const x = rr(0, S), y = rr(0, S), rad = rr(10, 90), gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, r() < .6 ? rgba(70, 60, 48, rr(.05, .2)) : rgba(226, 220, 204, rr(.05, .2))); gr.addColorStop(1, 'rgba(100,90,80,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    for (let i = 0; i < 700; i++) { const x = rr(0, S), y = rr(0, S), l = rr(20, 140), gr = g.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, rgba(60, 48, 38, rr(.1, .3))); gr.addColorStop(1, 'rgba(60,48,38,0)'); g.fillStyle = gr; g.fillRect(x, y, rr(1, 4), l); }
    // billboard paper seams
    g.strokeStyle = 'rgba(40,36,30,.22)'; g.lineWidth = 1.5; for (const k of ['bbRadio', 'bbLaw', 'bbGator', 'bbMotors']) { const [x, y, w, h] = SG[k]; for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(x + i * w / 8, y); g.lineTo(x + i * w / 8, y + h); g.stroke(); } g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke(); }
    return ctex(c, { aniso: 8 });
  }

  /* ---- small helper textures */
  function texChain() { const S = 128, c = cv(S, S), g = c.getContext('2d'); g.lineWidth = 7; g.lineCap = 'square'; for (const [col, o] of [['rgb(70,72,72)', 1.5], ['rgb(168,172,172)', 0]]) { g.strokeStyle = col; for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(k * S + o, o); g.lineTo(k * S + S + o, S + o); g.moveTo(k * S + S + o, o); g.lineTo(k * S + o, S + o); g.stroke(); } } const t = ctex(c, { repeat: true, aniso: 4 }); return t; }
  function texPool() { const S = 128, c = cv(S, S), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.62)'); gr.addColorStop(.55, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.fillStyle = gr; g.fillRect(0, 0, S, S); return ctex(c, { srgb: false }); }
  function texCone() { const c = cv(8, 128), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgb(255,255,255)'); gr.addColorStop(.2, 'rgb(96,96,96)'); gr.addColorStop(1, 'rgb(0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 8, 128); return ctex(c, { srgb: false }); }
  function texWaterN() { const S = 256, hgt = new Float32Array(S * S), d = new Uint8Array(S * S * 4); const tn = (x, y, p) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), m = a => ((a % p) + p) % p; return lerp(lerp(h2(m(xi), m(yi) + p * 31), h2(m(xi + 1), m(yi) + p * 31), u), lerp(h2(m(xi), m(yi + 1) + p * 31), h2(m(xi + 1), m(yi + 1) + p * 31), u), v); };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let a = 0, am = .5, p = 4; for (let o = 0; o < 6; o++) { const n = tn(x / S * p, y / S * p, p); a += (1 - Math.abs(n * 2 - 1)) * am; am *= .52; p *= 2; } hgt[y * S + x] = a; }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const dx = (hgt[y * S + (x + 1) % S] - hgt[y * S + (x + S - 1) % S]) * 9, dy = (hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x]) * 9, il = 1 / Math.sqrt(dx * dx + dy * dy + 1), j = (y * S + x) * 4; d[j] = (-dx * il * .5 + .5) * 255; d[j + 1] = (-dy * il * .5 + .5) * 255; d[j + 2] = (il * .5 + .5) * 255; d[j + 3] = hgt[y * S + x] * 255; }
    const t = new T.DataTexture(d, S, S, T.RGBAFormat); t.wrapS = t.wrapT = T.RepeatWrapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t; }
  function texFacade() { const S = 512, c = cv(S, S), g = c.getContext('2d'), e = cv(S, S), ge = e.getContext('2d'), r = GT.rng('facade'), rr = (a, b) => a + (b - a) * r(), nx = 12, ny = 16, cw = S / nx, ch = S / ny;
    g.fillStyle = 'rgb(206,200,188)'; g.fillRect(0, 0, S, S); ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
    for (let j = 0; j < ny; j++) { g.fillStyle = 'rgba(60,56,50,.5)'; g.fillRect(0, j * ch + ch - 5, S, 5); g.fillStyle = 'rgba(240,236,226,.6)'; g.fillRect(0, j * ch + ch - 8, S, 3);
      for (let i = 0; i < nx; i++) { const x = i * cw + 3, y = j * ch + 4, w = cw - 6, h = ch - 12, k = r(); g.fillStyle = k < .15 ? 'rgb(150,146,132)' : rgba(rr(26, 44), rr(38, 56), rr(52, 70), 1); g.fillRect(x, y, w, h); g.fillStyle = 'rgba(160,190,210,.16)'; g.fillRect(x, y, w, h * .4);
        if (r() < .24) { const warm = r() < .75; ge.fillStyle = warm ? rgba(255, rr(170, 215), rr(90, 140), rr(.5, 1)) : rgba(170, 215, 255, rr(.4, .8)); ge.fillRect(x, y, w, h); if (r() < .5) { ge.fillStyle = 'rgba(0,0,0,.45)'; ge.fillRect(x, y, w * rr(.3, .6), h); } } } }
    return { map: ctex(c, { repeat: true }), emis: ctex(e, { repeat: true }) }; }
  function texSandMarks() { const S = 512, c = cv(S, S), g = c.getContext('2d'), r = GT.rng('sandmarks'), rr = (a, b) => a + (b - a) * r();
    // left half: tyre ruts (two tread tracks, tile along V)   right half: footprints
    for (const x of [44, 212 - 30]) { const gr = g.createLinearGradient(x - 22, 0, x + 52, 0); gr.addColorStop(0, 'rgba(60,46,30,0)'); gr.addColorStop(.3, 'rgba(60,46,30,.5)'); gr.addColorStop(.7, 'rgba(60,46,30,.5)'); gr.addColorStop(1, 'rgba(60,46,30,0)'); g.fillStyle = gr; g.fillRect(x - 22, 0, 74, S);
      g.strokeStyle = 'rgba(40,30,20,.5)'; g.lineWidth = 3; for (let y = -8; y < S + 8; y += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 15, y + 8); g.lineTo(x + 30, y); g.stroke(); } g.fillStyle = 'rgba(236,222,190,.35)'; g.fillRect(x - 12, 0, 5, S); g.fillRect(x + 37, 0, 5, S); }
    for (let i = 0; i < 8; i++) { const y = i * 64 + 20, left = i & 1, x = 384 + (left ? -26 : 26) + rr(-6, 6); g.save(); g.translate(x, y); g.rotate(left ? -.16 : .16); let gr = g.createRadialGradient(0, 0, 0, 0, 0, 22); gr.addColorStop(0, 'rgba(52,40,26,.62)'); gr.addColorStop(.7, 'rgba(52,40,26,.4)'); gr.addColorStop(1, 'rgba(52,40,26,0)'); g.fillStyle = gr; g.scale(.5, 1); g.fillRect(-22, -22, 44, 44); g.restore(); g.fillStyle = 'rgba(52,40,26,.5)'; g.beginPath(); g.ellipse(x, y + 20, 7, 8, 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(240,226,196,.3)'; g.beginPath(); g.ellipse(x + (left ? -9 : 9), y + 4, 4, 18, 0, 0, TAU); g.fill(); }
    return ctex(c, { repeat: true }); }

  /* ================================================================== batch extras: boxes and upright quads (for atlas-textured props) */
  /** upright quad centred at (cx,cy,cz) facing (sin ry, 0, cos ry); uv = [u0, vBottom, u1, vTop] */
  Batch.prototype.vquad = function (cx, cy, cz, w, h, ry, uv, tilt) { const rx = Math.cos(ry) * w / 2, rz = -Math.sin(ry) * w / 2, nx = Math.sin(ry), nz = Math.cos(ry), t = tilt || 0, ox = nx * t * h / 2, oz = nz * t * h / 2;
    this.q(this.v(cx - rx - ox, cy - h / 2, cz - rz - oz, nx, 0, nz, uv[0], uv[1]), this.v(cx + rx - ox, cy - h / 2, cz + rz - oz, nx, 0, nz, uv[2], uv[1]), this.v(cx + rx + ox, cy + h / 2, cz + rz + oz, nx, 0, nz, uv[2], uv[3]), this.v(cx - rx + ox, cy + h / 2, cz - rz + oz, nx, 0, nz, uv[0], uv[3])); return this; };
  /** box centred at (cx,cy,cz), rotated ry about Y. uv: undefined = metres, or [u0,v0,u1,v1] applied to every face */
  Batch.prototype.box = function (cx, cy, cz, w, h, d, ry, uv, skip) { const c = Math.cos(ry || 0), s = Math.sin(ry || 0), hw = w / 2, hh = h / 2, hd = d / 2, P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c], Nn = (x, y, z) => [x * c + z * s, y, -x * s + z * c];
    const F = [[[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd], [0, 0, 1], w, h], [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd], [0, 0, -1], w, h], [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd], [1, 0, 0], d, h], [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd], [-1, 0, 0], d, h], [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd], [0, 1, 0], w, d], [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd], [0, -1, 0], w, d]];
    for (let f = 0; f < 6; f++) { if (skip && skip.indexOf(f) >= 0) continue; const [a, b, cc, dd, n, fu, fv] = F[f], nn = Nn(n[0], n[1], n[2]), U = uv ? [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]] : [[0, 0], [fu, 0], [fu, fv], [0, fv]];
      const id = [a, b, cc, dd].map((p, i) => { const q = P(p[0], p[1], p[2]); return this.v(q[0], q[1], q[2], nn[0], nn[1], nn[2], U[i][0], U[i][1]); }); this.q(id[0], id[1], id[2], id[3]); } return this; };

  /* ================================================================== materials owned by this module */
  function windHook(m) { m.onBeforeCompile = sh => { sh.uniforms.uTime = state.uTime; sh.vertexShader = 'attribute vec2 aW;\nuniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', ['#include <begin_vertex>', '#ifdef USE_INSTANCING', ' float gph = instanceMatrix[3][0] * .37 + instanceMatrix[3][2] * .23;', '#else', ' float gph = position.x * .37 + position.z * .23;', '#endif',
    ' float gst = sin(uTime * .9 + gph) * .6 + sin(uTime * 1.7 + gph * 1.9) * .4;', ' transformed.x += aW.x * (.06 + .07 * gst);', ' transformed.z += aW.x * .035 * sin(uTime * .6 + gph * 1.3);',
    ' transformed += aW.y * vec3(sin(uTime * 2.3 + gph + position.y * 1.7), .6 * sin(uTime * 2.9 + gph * 2. + position.x * 2.1), cos(uTime * 2.1 + gph + position.z * 1.9)) * .055;'].join('\n')); }; return m; }
  function makeMats() {
    const M = {}, white = new T.Color(1, 1, 1), po = (m, f) => { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f; return m; };
    const ov = texOverlay(); M.ovl = po(new T.MeshStandardMaterial({ map: ov.map, roughnessMap: ov.rough, roughness: 1, metalness: 0, transparent: true, depthWrite: false }), -1);
    M.paint = po(new T.MeshStandardMaterial({ map: texPaint(), vertexColors: true, roughness: .6, metalness: 0, transparent: true, depthWrite: false }), -2);
    M.marks = po(new T.MeshStandardMaterial({ map: texMarks(), roughness: .62, metalness: 0, transparent: true, depthWrite: false }), -2);
    const fl = TX.flora = texFlora(); M.flora = windHook(new T.MeshStandardMaterial({ map: fl, alphaTest: .4, vertexColors: true, roughness: .8, metalness: 0 })); M.floraDepth = windHook(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: fl, alphaTest: .4 }));
    const sg = texSigns(); M.sign = new T.MeshStandardMaterial({ map: sg, roughness: .5, metalness: .1 }); M.signLit = new T.MeshStandardMaterial({ map: sg, emissiveMap: sg, emissive: 0xffffff, emissiveIntensity: 0, roughness: .62, metalness: 0 }); GT.glow(M.signLit, white, 0, .8, 'emissiveIntensity');
    const pw = GT.mat('plastic_white'); M.vcol = new T.MeshStandardMaterial({ vertexColors: true, roughness: .62, metalness: 0, map: pw.map || null, normalMap: pw.normalMap || null, roughnessMap: pw.roughnessMap || null }); if (pw.normalScale) M.vcol.normalScale.copy(pw.normalScale);
    const ch = texChain(); M.chain = new T.MeshStandardMaterial({ map: ch, transparent: true, side: T.DoubleSide, roughness: .45, metalness: .7, depthWrite: false, alphaTest: .02 });
    // light pools multiply what is already on screen (dst * (1 + src)), so asphalt grain and paint stay visible inside the pool
    M.pool = po(new T.MeshBasicMaterial({ map: texPool(), blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.DstColorFactor, blendDst: T.OneFactor, transparent: true, depthWrite: false, fog: false }), -4); GT.glow(M.pool, new T.Color(1, .5, .17), 0, 24);
    // light cones: additive, faded toward the silhouette and toward the ground so they read as haze, not as geometry
    M.cone = new T.ShaderMaterial({ uniforms: { uCol: { value: new T.Color(0, 0, 0) } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vH; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalMatrix * normal; vV = -mv.xyz; vH = uv.y; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying float vH; void main(){ float f = abs(dot(normalize(vN), normalize(vV))); f = f * f * f; float h = vH * vH * (3. - 2. * vH); gl_FragColor = vec4(uCol * f * (.12 + .88 * h * h), 1.); }' });
    M.cone.color = M.cone.uniforms.uCol.value; GT.glow(M.cone, new T.Color(1, .6, .26), 0, .07);
    M.lamp = new T.MeshBasicMaterial({ color: 0xffffff }); GT.glow(M.lamp, new T.Color(1, .62, .26), .22, 11);
    const sd = new Uint8Array(16 * 4); state.sigData = sd; const st = state.sigTex = new T.DataTexture(sd, 16, 1, T.RGBAFormat); st.magFilter = st.minFilter = T.NearestFilter; st.needsUpdate = true; M.lens = new T.MeshBasicMaterial({ map: st }); M.lens.color.setScalar(7);
    M.rpm = new T.MeshBasicMaterial({ color: 0xffffff }); GT.glow(M.rpm, white, .5, 1.5);
    const ag = cv(64, 4), g = ag.getContext('2d'), gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, '#000'); gr.addColorStop(.3, '#fff'); gr.addColorStop(.75, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 64, 4);
    M.wet = po(new T.MeshStandardMaterial({ color: C(0x65543f), roughness: .12, metalness: 0, transparent: true, alphaMap: ctex(ag, { srgb: false }), depthWrite: false }), -1);
    M.sandMarks = po(new T.MeshStandardMaterial({ map: texSandMarks(), roughness: 1, metalness: 0, transparent: true, depthWrite: false }), -2);
    const fc = texFacade(); M.facade = new T.MeshStandardMaterial({ map: fc.map, emissiveMap: fc.emis, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: .7, metalness: 0 }); GT.glow(M.facade, white, 0, 2.0, 'emissiveIntensity');
    M.facade.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n#ifdef USE_FOG\n fogDepth *= 1.0;\n#endif'); };
    return M;
  }

  /* ================================================================== terrain description (shared by build + groundHeight/surfaceAt) */
  const FILLETS = [[HW, -155.5, 1, 1], [HW, -164.5, 1, -1], [HW, 155.5, 1, -1], [HW, 164.5, 1, 1], [BX - CW, -155.5, -1, 1], [BX - CW, 155.5, -1, -1]];   // [corner x, corner z, sx, sz]
  function beachH(x, z) { const t = cl((WALL1 - x) / 50, 0, 1); let y = -.42 - 1.22 * Math.pow(t, 1.12); const dune = 1 - ss(t, .02, .34); y += dune * (fb(x * .11 + 3.1, z * .06) - .32) * .62; y += (fb(x * .33 + 7, z * .33) - .5) * .05 * (1 - ss(t, .7, .9)); y -= ss(t, .8, 1) * .1; return y; }
  function classify(x, z) {
    const ax = Math.abs(x);
    if (ax <= HW) return [0, 'asphalt'];
    if (Math.abs(x - BX) <= CW && Math.abs(z) <= 164.5) return [0, 'asphalt'];
    if (x > 0 && x <= BX + CW) for (const zc of XS) if (Math.abs(z - zc) <= CW) return [0, 'asphalt'];
    for (const f of FILLETS) { const dx = (x - f[0]) * f[2], dz = (z - f[1]) * f[3]; if (dx >= 0 && dx <= FR && dz >= 0 && dz <= FR) return Math.hypot(dx - FR, dz - FR) > FR ? [0, 'asphalt'] : [SWH, 'concrete']; }
    if (x < -HW) { if (x >= WALL0) return [SWH, 'concrete']; if (x > WALL1) return [WALLTOP, 'concrete']; return [beachH(x, z), 'sand']; }
    if (x < 14 && Math.abs(z) < 190) { let dmin = 1e9; for (const d of DRIVES) dmin = Math.min(dmin, Math.abs(z - d));
      if (dmin < DHW) return [.012, 'concrete']; if (x < SW1) return dmin < DHW + DFL ? [lerp(.012, SWH, (dmin - DHW) / DFL), 'concrete'] : [SWH, 'concrete']; return [lerp(.11, 0, (x - SW1) / 3.85), 'grass']; }
    if (x >= 14 && x <= 145.5 && Math.abs(z) <= 155.5) {
      if (Math.abs(z) > 153.35 || x > 143.5) return [SWH, 'concrete'];
      const S = L.station, Mo = L.motel, Cc = L.lotC, D = L.lotD, E = L.lotE, inb = (b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
      if (inb(S) || inb(Mo)) return [0, 'asphalt']; if (inb(Cc)) return [0, x < 74 ? 'asphalt' : 'concrete']; if (inb(D)) return [0, 'sand']; if (inb(E) || (z > 132 && z < 138 && x < 142)) return [0, 'asphalt'];
      return [0, 'grass'];
    }
    if (x > BX + CW && x < 157.2) return [0, 'gravel'];
    return [0, 'grass'];
  }

  /* ================================================================== ground + roads */
  function buildGround(X) {
    const { B, K } = X, S = L.station, Mo = L.motel, r = GT.rng('ground'), rr = (a, b) => a + (b - a) * r();
    // ---- asphalt
    B.asphW.rect(-7.05, -700, 7.05, 700, 0);
    for (const s of [-1, 1]) { B.asphW.rect(s * 7.05, 190, s * HW, 700, 0); B.asphW.rect(s * 7.05, -700, s * HW, -190, 0); }
    for (const zc of XS) { B.asph.rect(7.05, zc - CW, BX - CW, zc + CW, 0); B.asph.rect(7.05, zc - CW - FR, HW, zc - CW, 0); B.asph.rect(7.05, zc + CW, HW, zc + CW + FR, 0); }
    B.asph.rect(BX - CW, -164.5, BX + CW, 164.5, 0);
    const arcPts = (f, rad, n) => { const ox = f[0] + f[2] * FR, oz = f[1] + f[3] * FR, pts = []; for (let i = 0; i <= n; i++) { const a = i / n * PI / 2; pts.push([ox - f[2] * rad * Math.cos(a), oz - f[3] * rad * Math.sin(a)]); } return pts; };   // from (corner x, oz) to (ox, corner z)
    for (const f of FILLETS) { const pts = arcPts(f, FR, 10); B.asph.fan([[f[0], f[1]]].concat(pts), 0);
      // quarter-disc sidewalk plaza + curb
      const ox = f[0] + f[2] * FR, oz = f[1] + f[3] * FR; B.conc.fan([[ox, oz]].concat(arcPts(f, FR - .15, 10)), SWH);
      for (let i = 0; i < 10; i++) { const a = pts[i], b = pts[i + 1], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]) + .02, ry = Math.atan2(b[0] - a[0], b[1] - a[1]), nx = (ox - mx), nz = (oz - mz), nl = Math.hypot(nx, nz); K.g.box('concrete_stained', .16, .2, len, mx + nx / nl * .08, SWH - .096, mz + nz / nl * .08, { ry, bevel: .02 }); }
      // tactile ramp pad
      const a = PI / 4, px = ox - f[2] * (FR - .75) * Math.cos(a), pz = oz - f[3] * (FR - .75) * Math.sin(a); K.g.box('curb_paint_yellow', 1.2, .02, .9, px, SWH + .006, pz, { ry: Math.atan2(f[2], f[3]) , bevel: .004 }); }
    // ---- gutters (concrete pan), curbs, sidewalks along the highway
    const cutsE = [[-164.5 - FR, -155.5 + FR], [155.5 - FR, 164.5 + FR]].concat(DRIVES.map(d => [d - DHW - DFL, d + DHW + DFL])).sort((a, b) => a[0] - b[0]);
    const segsE = []; let z = -190; for (const c of cutsE) { if (c[0] > z) segsE.push([z, c[0]]); z = c[1]; } segsE.push([z, 190]);
    const curb = (x, z0, z1, mat) => { for (let a = z0; a < z1 - .01; a += 24) { const b = Math.min(z1, a + 24); K.g.box(mat || 'concrete_stained', .16, .2, b - a, x, SWH - .096, (a + b) / 2, { bevel: .02 }); } };
    for (const [a, b] of segsE) { B.conc.rect(7.64, a, SW1, b, SWH); curb(HW + .08, a, b); }
    for (const [a, b] of [[-190, -164.5 - FR], [-155.5 + FR, 155.5 - FR], [164.5 + FR, 190]]) B.concS.rect(7.05, a, HW, b, .004);
    B.conc.rect(WALL0, -190, -7.64, 190, SWH); curb(-HW - .08, -190, 190); B.concS.rect(-HW, -190, -7.05, 190, .004);
    for (const s of [-1, 1]) { B.conc.rect(-SW1, s * 190, -HW, s * 700, SWH - .01); B.conc.rect(HW, s * 190, SW1, s * 700, SWH - .01); }   // simple continuation past the closures
    // painted curb stretches (fire lane / bus stop)
    for (const [a, b, m] of [[30.2, 39.5, 'curb_paint_yellow'], [-6, 2, 'curb_paint_yellow'], [100, 108, 'curb_paint_yellow']]) K.g.box(m, .17, .205, b - a, HW + .08, SWH - .096, (a + b) / 2, { bevel: .02 });
    // ---- driveways: apron, flares, sloped curb returns
    for (const d of DRIVES) { B.concS.rect(7.05, d - DHW, 14, d + DHW, .012);
      for (const s of [-1, 1]) { const z0 = d + s * (DHW + DFL), z1 = d + s * DHW; B.conc.quad4([7.64, SWH, z0], [SW1, SWH, z0], [SW1, .012, z1], [7.64, .012, z1]); B.grass.quad4([SW1, .11, z0], [13.85, 0, z0], [14, .012, z1], [SW1, .012, z1]);
        K.g.box('concrete_stained', .16, .2, DFL + .06, HW + .08, SWH - .096 - .062, (z0 + z1) / 2, { rx: s * Math.atan2(.125, DFL), bevel: .02 }); }
      // expansion joints + stains on the apron
      K.g.decal('oil_stain', 2.2, 2.6, 10.5 + rr(-1, 1), .02, d + rr(-2, 2), rr(0, 6)); K.g.decal('tire_marks', 2.2, 5, 9.8, .021, d + rr(-1.5, 1.5), PI / 2 + rr(-.3, .3)); }
    // ---- east verge (dry grass, slopes from the sidewalk down to the lots)
    for (const [a, b] of segsE) B.grass.quad4([SW1, .11, a], [13.85, 0, a], [13.85, 0, b], [SW1, .11, b]);
    for (const [a, b] of segsE) B.grass.rect(13.85, a, 14, b, 0);
    // corner plazas' back sides: fill between quarter disc and the verge line
    for (const f of FILLETS.slice(0, 4)) { const z0 = f[1], z1 = f[1] + f[3] * FR; B.conc.rect(HW + FR, Math.min(z0, z1), 14, Math.max(z0, z1), SWH); }
    // ---- cross streets + back road: curbs, inner sidewalks, outer shoulders
    for (const zc of XS) { const si = zc < 0 ? 1 : -1, zi = zc + si * CW, zo = zc - si * CW;        // inner edge (toward the lots), outer edge
      B.conc.rect(14, zi, BX - CW - FR, zi + si * 2.15, SWH); for (let a = HW + FR; a < BX - CW - FR; a += 24) { const b = Math.min(BX - CW - FR, a + 24); K.g.box('concrete_stained', b - a, .2, .16, (a + b) / 2, SWH - .096, zi + si * .08, { bevel: .02 }); K.g.box('concrete_stained', b - a, .2, .16, (a + b) / 2, SWH - .096, zo - si * .08, { bevel: .02 }); }
      B.dirt.rect(14, zo, BX + CW + 2.7, zo - si * 2.6, 0); B.grass.rect(14, zo - si * 2.6, 400, si < 0 ? 190 : -190, 0); B.grass.rect(BX + CW + 2.7, zo, 400, zo - si * 2.6, 0);
      K.g.box('concrete_stained', 14, .2, .16, BX - CW - FR + 7, SWH - .096, zo - si * .08, { bevel: .02 }); }
    B.conc.rect(BX - CW - 2, -155.5 + FR, BX - CW - .15, 155.5 - FR, SWH); curb(BX - CW - .08, -155.5 + FR, 155.5 - FR);
    B.dirt.rect(BX + CW, -164.5, BX + CW + 2.7, 164.5, 0);
    // ---- lot slabs + gaps inside the loop (all at y = 0)
    const xi = 143.5; B.grass.rect(14, -153.35, xi, -152, 0); B.grass.rect(14, 152, xi, 153.35, 0); B.grass.rect(142, -152, xi, 152, 0);
    B.asph.rect(14, -152, 74, -52, 0); B.concS.rect(74, -152, 142, -52, 0);                                  // lotC: car lot asphalt, storage concrete
    B.dirt.rect(14, -52, 142, -42, 0);                                                                       // drainage strip
    B.asph.rect(S.x0, S.z0, S.x1, S.z1, 0); B.grass.rect(72, -42, 98, 26, 0); B.sand.rect(98, -42, 142, 132, 0);   // station slab, scrub, lotD sand
    B.grass.rect(14, 26, 98, 48, 0); B.asphW.rect(Mo.x0, Mo.z0, Mo.x1, Mo.z1, 0); B.grass.rect(92, 48, 98, 132, 0);
    B.asph.rect(14, 132, 142, 138, 0); B.asphW.rect(14, 138, 142, 152, 0);
    // ---- far ground outside the loop
    B.grass.rect(169.5, -164.5, 1500, 164.5, 0); B.grass.rect(400, 164.5, 1500, 1500, 0); B.grass.rect(400, -1500, 1500, -164.5, 0); B.grass.rect(SW1, 190, 400, 1500, 0); B.grass.rect(SW1, -1500, 400, -190, 0);
    // canal banks east of the back road (water surface itself is added by the sea builder)
    B.grass.quad4([157.2, 0, -164.5], [159.5, -1.3, -164.5], [159.5, -1.3, 164.5], [157.2, 0, 164.5]); B.grass.quad4([167.2, -1.3, -164.5], [169.5, 0, -164.5], [169.5, 0, 164.5], [167.2, -1.3, 164.5]); B.dirt.rect(159.5, -164.5, 167.2, 164.5, -1.32);

    // ---- wear overlay
    for (let i = 0, z0 = -192; z0 < 192; z0 += 24, i++) { const v0 = i & 1 ? 1 : 0, v1 = 1 - v0, u = x => (HW - x) / 15 * .625; B.ovl.rectUV(-7.05, z0, 7.05, z0 + 24, .001, u(-7.05), v0, u(7.05), v1); }
    for (const zc of XS) for (let i = 0, x0 = 12.5; x0 < BX - CW - .1; x0 += 24, i++) { const x1 = Math.min(BX - CW, x0 + 24), v0 = i & 1 ? 1 : 0, v1 = v0 ? 1 - (x1 - x0) / 24 : (x1 - x0) / 24, ua = .625 + .375 * (.15 / 9), ub = 1 - .375 * (.15 / 9);
      B.ovl.quad4([x0, .001, zc - CW + .15], [x0, .001, zc + CW - .15], [x1, .001, zc + CW - .15], [x1, .001, zc - CW + .15], [[ua, v0], [ub, v0], [ub, v1], [ua, v1]]); }
    for (let i = 0, z0 = -156; z0 < 156; z0 += 24, i++) { const v0 = i & 1 ? 1 : 0, ua = .625 + .375 * (.15 / 9), ub = 1 - .375 * (.15 / 9); B.ovl.rectUV(BX - CW + .15, z0, BX + CW - .15, z0 + 24, .001, ua, v0, ub, 1 - v0); }

    // ---- paint
    const P = B.paint, WHT = [.80, .79, .74], YEL = [.72, .42, .045], y = .002;
    const solid = (x, z0, z1, w, col) => { P.col = col; for (let a = z0; a < z1; a += 30) P.line(x, a, x, Math.min(z1, a + 30), w, y); };
    const dashed = (x, z0, z1, w, col, skip) => { P.col = col; for (let a = Math.ceil(z0 / 12) * 12; a + 3 <= z1; a += 12) if (!skip || !skip(a + 1.5)) P.line(x, a, x, a + 3, w, y); };
    const nearX = zz => Math.abs(Math.abs(zz) - 160) < 9.5 || (zz > 39 && zz < 46.5);
    solid(-6.85, -190, 190, .12, WHT); for (const [a, b] of [[-190, -164.5 - FR], [-155.5 + FR, 155.5 - FR], [164.5 + FR, 190]]) solid(6.85, a, b, .12, WHT);
    for (const x of [-4.5, 4.5]) dashed(x, -188, 188, .12, WHT, nearX);
    for (const s of [-1, 1]) { solid(s * 1.63, -150, 106, .11, YEL); dashed(s * 1.40, -150, 106, .11, YEL, nearX); }
    for (const [a, b] of [[-190, -169], [169, 190]]) { solid(-.12, a, b, .11, YEL); solid(.12, a, b, .11, YEL); }
    solid(1.63, 106, 150, .11, YEL); solid(1.40, 106, 150, .11, YEL); solid(-1.5, 106, 150, .15, WHT);
    // stop bars + crosswalks (continental)
    P.col = WHT; P.line(-7.0, 149.6, 1.5, 149.6, .55, y); P.line(-1.5, -149.6, 7.0, -149.6, .55, y); P.line(-1.5, 168.4, 7.0, 168.4, .55, y); P.line(-7.0, -168.4, 1.5, -168.4, .55, y);
    for (const zc of [-152.8, 152.8, 42.6]) for (let x = -6.6; x <= 6.61; x += 1.2) P.line(x, zc - 1.5, x, zc + 1.5, .6, y);
    P.line(-7.0, 38.6, -.2, 38.6, .4, y); P.line(.2, 46.6, 7.0, 46.6, .4, y);
    for (const zc of XS) { for (let zz = zc - 3.9; zz <= zc + 3.91; zz += 1.3) P.line(9.2, zz, 12.0, zz, .6, y); P.line(13.3, zc, 13.3, zc - (CW - .2), .5, y); }
    // two-lane streets: double yellow + white edge lines, with arcs through the two back corners
    const pl = (pts, w, col) => { P.col = col; for (let i = 0; i < pts.length - 1; i++) P.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, y); };
    for (const off of [-.12, .12, -4.15, 4.15]) { const col = Math.abs(off) < 1 ? YEL : WHT, pts = [];
      for (let x = 14.5; x <= BX - CW - FR; x += 21) pts.push([Math.min(x, BX - CW - FR), -160 - off]); pts.push([BX - CW - FR, -160 - off]);
      for (let i = 1; i <= 8; i++) { const a = i / 8 * PI / 2, rad = 9.5 + off; pts.push([BX - CW - FR + Math.sin(a) * rad, -155.5 + FR - Math.cos(a) * rad]); }
      for (let zz = -130; zz <= 131; zz += 20) pts.push([BX + off, zz]);
      for (let i = 0; i <= 8; i++) { const a = i / 8 * PI / 2, rad = 9.5 + off; pts.push([BX - CW - FR + Math.cos(a) * rad, 155.5 - FR + Math.sin(a) * rad]); }
      for (let x = BX - CW - FR - 21; x > 14.5; x -= 21) pts.push([x, 160 + off]); pts.push([14.5, 160 + off]); pl(pts, .11, col); }
    // ---- stencils, manholes, grates
    const Mk = B.marks, st = (k, x, zz, w, len, h, yy) => { const u = mkUV(k); Mk.oquad(x, zz, w, len, h, yy || .003, u[0], u[1], u[2], u[3]); };
    for (const z0 of [-118, -58, 60]) { st('arrowL', 0, z0, 1.15, 2.5, 0); st('arrowL', 0, z0 + 6.5, 1.15, 2.5, PI); }
    for (const z0 of [112, 128, 143]) st('arrowL', 0, z0, 1.15, 2.5, 0); st('only', 0, 120, 2.2, 2.6, 0); st('only', 0, 135.5, 2.2, 2.6, 0);
    st('stop', 17.5, -162.3, 2.0, 2.4, -PI / 2); st('stop', 17.5, 157.8, 2.0, 2.4, -PI / 2); st('bus', 5.9, 30, 2.0, 2.4, PI); st('arrowS', -3, 136, 1.0, 2.6, 0); st('arrowS', -6, 136, 1.0, 2.6, 0);
    for (const [x, zz] of [[3.1, -22], [-2.8, 14], [-5.6, -71], [2.9, 96], [0.2, -139], [-4.4, 171], [5.5, 121], [60, -161.2], [118, 158.6], [151.2, -60], [148.9, 44], [-3.3, 66], [4.6, -101]]) st('manhole', x, zz, 1.0, 1.0, rr(0, 6), .004);
    X.drains = []; for (let zz = -172; zz < 180; zz += 46) for (const s of [-1, 1]) { let ok = true; if (s > 0) for (const c of cutsE) if (zz > c[0] - 2 && zz < c[1] + 2) ok = false; if (!ok) continue; st('grate', s * 7.28, zz, .44, .95, s > 0 ? 0 : PI, .008); X.drains.push([s, zz]); }
    for (const [x, zz] of [[8.6, -20], [8.9, 12.5], [-8.8, 51], [8.4, 88], [-9.2, -63], [9.1, -122]]) st('lid', x, zz, .7, .7, 0, SWH + .003);
    // ---- unique decals on the hero stretch
    const dk = K.g; dk.decal('crack', 3.4, 3.4, -3.4, .0035, -44, .4); dk.decal('crack', 4, 4, 2.6, .0035, -8, 2.1); dk.decal('crack', 3, 3, -5.6, .0035, 12, 4.4); dk.decal('patch', 2.4, 3.6, 5.2, .0034, -28, 0); dk.decal('patch', 1.8, 2.8, -6.1, .0034, 3, PI / 2);
    dk.decal('oil_stain', 1.1, 1.5, -3.1, .0036, -41, 1); dk.decal('oil_stain', 1.4, 1.8, 3.1, .0036, 9, 2); dk.decal('tire_marks', 2, 9, -3.3, .0037, 144, .03); dk.decal('tire_marks', 2, 8, 3.2, .0037, -143, PI + .05); dk.decal('tire_marks', 2.2, 7, 6.4, .0037, -31, .5); dk.decal('oil_stain', 2, 2, -5.8, .0036, 100, 4);
    // ---- raised reflective markers (instanced)
    const rp = []; for (let zz = -186; zz <= 186; zz += 12) { if (nearX(zz + 7.5)) continue; for (const x of [-4.5, 4.5]) rp.push([x, zz + 7.5, 0]); if (zz > -150 && zz < 104) { rp.push([-1.515, zz + 7.5, 1]); rp.push([1.515, zz + 7.5, 1]); } }
    const rg = new T.BoxGeometry(.1, .02, .1), rm = new T.InstancedMesh(rg, X.M.rpm, rp.length), mx = new T.Matrix4(), cw = new T.Color(1, 1, .95), ca = new T.Color(1, .62, .1);
    rp.forEach((p, i) => { mx.makeTranslation(p[0], .011, p[1]); rm.setMatrixAt(i, mx); rm.setColorAt(i, p[2] ? ca : cw); }); rm.frustumCulled = false; rm.name = 'road_rpm'; X.root.add(rm);
  }

  /* ================================================================== beach, seawall, pier, sea */
  const STAIRS = [-20, 96], PIERZ = 78;
  function buildBeach(X) {
    const { B, K, M } = X, k = K.p, r = GT.rng('beach'), rr = (a, b) => a + (b - a) * r();
    // ---- sand height field (detailed near the loop, coarse beyond)
    const sandGrid = (z0, z1, dz, xs) => { const b = B.sand, nz = Math.round((z1 - z0) / dz), base = b.n; for (let j = 0; j <= nz; j++) for (let i = 0; i < xs.length; i++) { const x = xs[i], z = z0 + j * dz, h = beachH(x, z), e = .5, nx = -(beachH(x + e, z) - beachH(x - e, z)) / (2 * e), nzz = -(beachH(x, z + e) - beachH(x, z - e)) / (2 * e), l = Math.hypot(nx, 1, nzz); b.v(x, h, z, nx / l, 1 / l, nzz / l, x, z); }
      for (let j = 0; j < nz; j++) for (let i = 0; i < xs.length - 1; i++) { const a = base + j * xs.length + i, c = a + xs.length; b.I.push(a, c, a + 1, a + 1, c, c + 1); } };
    const xsFine = []; for (let x = WALL1 + .04; x > -70; x -= (x > -26 ? 1.2 : 2.4)) xsFine.push(x); xsFine.push(-70); xsFine.reverse();
    sandGrid(-204, 204, 2.4, xsFine); const xsC = [-70, -56, -40, -24, -14, WALL1 + .04]; sandGrid(-708, -204, 28, xsC); sandGrid(204, 708, 28, xsC);
    // ---- seawall with cap, joints, stains; stairs; railing
    const gaps = STAIRS.map(z => [z - 1.1, z + 1.1]).concat([[PIERZ - 2.1, PIERZ + 2.1]]).sort((a, b) => a[0] - b[0]);
    const inGap = z => gaps.some(g => z > g[0] && z < g[1]);
    let z = -190; const wallSegs = []; for (const g of gaps) { wallSegs.push([z, g[0]]); z = g[1]; } wallSegs.push([z, 190]);
    for (const [a, b] of wallSegs) for (let s = a; s < b - .01; s += 12) { const e = Math.min(b, s + 12), len = e - s - .03, zc = (s + e) / 2; k.box('concrete_stained', .42, 2.0, len, -10.21, WALLTOP - 1.0, zc); k.box('concrete_stained', .54, .09, len, -10.21, WALLTOP + .045, zc, { bevel: .02 });
      if (r() < .8) k.geo(GT.decalMat('water_stain'), new T.PlaneGeometry(rr(1.5, 3), .55), { x: -9.995, y: WALLTOP - .28, z: zc + rr(-4, 4), ry: PI / 2 }); if (r() < .5) k.geo(GT.decalMat('rust_run'), new T.PlaneGeometry(.5, .5), { x: -9.994, y: WALLTOP - .25, z: zc + rr(-5, 5), ry: PI / 2 }); }
    for (const s of [-1, 1]) { k.box('concrete_stained', .42, 2.0, 500, -10.21, WALLTOP - 1.0, s * 440, {}); }
    GT.world.addBox(WALL1, -700, WALL0, 700, 1.1, 'seawall');
    const TOP = WALLTOP + .09, rail = 'aluminium_brushed';
    for (const [a, b] of wallSegs) { const n = Math.max(1, Math.round((b - a) / 2)); for (let i = 0; i <= n; i++) { const zz = lerp(a + .12, b - .12, i / n); k.cyl(rail, .022, .022, .36, -10.21, TOP + .18, zz, { seg: 5 }); }
      for (let s = a; s < b - .01; s += 24) { const e = Math.min(b, s + 24); k.cyl(rail, .026, .026, e - s - .1, -10.21, TOP + .36, (s + e) / 2, { seg: 6, rx: PI / 2 }); k.cyl(rail, .015, .015, e - s - .1, -10.21, TOP + .19, (s + e) / 2, { seg: 5, rx: PI / 2 }); } }
    for (const zs of STAIRS) { for (let i = 0; i < 7; i++) k.box('concrete_stained', .34, .16, 2.1, -10.17 - i * .3, SWH - .08 - i * .13, zs, { bevel: .012 });
      for (const s of [-1, 1]) { k.box('concrete_stained', 2.4, 1.5, .2, -11.2, -.35, zs + s * 1.15, { bevel: .02 }); k.tube(rail, [[-10.0, 1.0, zs + s * .95], [-10.5, .98, zs + s * .95], [-12.2, .1, zs + s * .95]], .022, { seg: 6, steps: 6 }); for (const px of [-10.05, -11.1, -12.15]) k.cyl(rail, .02, .02, .9, px, lerp(.55, -.35, (-10.05 - px) / 2.1), zs + s * .95, { seg: 6 }); }
      // beach shower on a small slab
      const sx = -13.4, sz = zs + 2.6, sy = beachH(sx, sz); k.box('concrete_stained', 1.5, .12, 1.5, sx, sy + .03, sz, { bevel: .015 }); k.cyl('metal_galv', .04, .045, 2.3, sx, sy + 1.2, sz, { seg: 8 }); k.tube('metal_galv', [[sx, sy + 2.3, sz], [sx, sy + 2.42, sz], [sx - .22, sy + 2.42, sz], [sx - .3, sy + 2.3, sz]], .02, { seg: 6, steps: 8 }); k.cyl('aluminium_brushed', .06, .02, .07, sx - .3, sy + 2.27, sz, { seg: 10 });
      k.cyl('aluminium_brushed', .03, .03, .1, sx - .06, sy + 1.1, sz, { seg: 8, rz: PI / 2 }); k.cyl('metal_dark', .09, .09, .012, sx - .35, sy + .095, sz, { seg: 10 }); k.geo(GT.decalMat('water_stain'), new T.PlaneGeometry(1.3, 1.3), { x: sx - .15, y: sy + .094, z: sz, rx: -PI / 2 });
      X.S.vquad(-10.6, 1.5, zs - 2.2, .9, .72, -PI / 2, sgUV('beachRules')); X.S.vquad(-10.56, 1.5, zs - 2.2, .9, .72, PI / 2, sgUV('guard')); k.cyl('metal_galv', .025, .025, 1.7, -10.58, 1.0, zs - 2.2, { seg: 6 }); }
    // ---- wet sand band + sand marks
    for (let zz = -204; zz < 204; zz += 6) { const xs = [-50.5, -52.5, -54.5, -57.5], us = [0, .3, .7, 1]; for (let i = 0; i < 3; i++) B.wet.quad4([xs[i], beachH(xs[i], zz) + .012, zz], [xs[i + 1], beachH(xs[i + 1], zz) + .012, zz], [xs[i + 1], beachH(xs[i + 1], zz + 6) + .012, zz + 6], [xs[i], beachH(xs[i], zz + 6) + .012, zz + 6], [[us[i], 0], [us[i + 1], 0], [us[i + 1], 1], [us[i], 1]]); }
    const strip = (pts, w, u0, u1) => { let v = 0; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), px = dz / l * w / 2, pz = -dx / l * w / 2, v1 = v + l / 4.4, P = (p, s) => { const x = p[0] + s * px, zz = p[1] + s * pz; return [x, beachH(x, zz) + .02, zz]; };
      B.sandMarks.quad4(P(a, -1), P(a, 1), P(b, 1), P(b, -1), [[u0, v], [u1, v], [u1, v1], [u0, v1]]); v = v1; } };
    const ruts = []; for (let zz = -200; zz <= 200; zz += 5) ruts.push([-33 + Math.sin(zz * .03) * 4 + Math.sin(zz * .11) * 1.2, zz]); strip(ruts, 2.2, 0, .5);
    const ruts2 = []; for (let zz = -90; zz <= 60; zz += 5) ruts2.push([-25 + Math.sin(zz * .05 + 2) * 3, zz]); strip(ruts2, 2.2, 0, .5);
    for (const zs of STAIRS.concat([-70, 30, 130, -140])) for (let q = 0; q < 3; q++) { const pts = []; let x = -12.6, zz = zs + rr(-1, 1), a = rr(-.5, .5); while (x > -52) { pts.push([x, zz]); a += rr(-.25, .25); a *= .93; x -= 2.2 * Math.cos(a); zz += 2.2 * Math.sin(a) + q * .25 - .25; } strip(pts, 1.0, .5, 1); }
    // ---- lifeguard tower (seafoam + coral, original scheme)
    { const tx = -36, tz = 25, by = beachH(tx, tz), py = by + 2.3, wd = GT.mat('wood_painted', { color: 0x86b7a6 }), V = X.V;
      for (const [ax, az] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) { k.box('wood_plank', .16, 2.5, .16, tx + ax, by + 1.15, tz + az, { bevel: .012 }); k.box('concrete_stained', .34, .16, .34, tx + ax, by + .02, tz + az, { bevel: .02 }); }
      for (const s of [-1, 1]) { k.box('wood_plank', .06, .12, 3.6, tx + s * 1.5, by + 1.2, tz, { rx: .62 * s }); k.box('wood_plank', 3.6, .12, .06, tx, by + 1.2, tz + s * 1.5, { rz: .62 * s }); }
      k.box('wood_plank', 3.9, .14, 3.9, tx, py, tz, { bevel: .015 }); for (let i = 0; i < 13; i++) k.box('wood_painted', .29, .035, 3.9, tx - 1.8 + i * .3, py + .088, tz, { bevel: .006 });
      k.box(wd, 2.5, 2.05, 2.5, tx + .5, py + 1.13, tz, { bevel: .015 }); for (let i = 0; i < 9; i++) { k.box(wd, .02, 2.0, .012, tx - .76, py + 1.13, tz - 1.1 + i * .275); k.box(wd, .012, 2.0, .02, tx - .6 + i * .275, py + 1.13, tz + 1.256); k.box(wd, .012, 2.0, .02, tx - .6 + i * .275, py + 1.13, tz - 1.256); }
      V.setCol(0xc9705c); V.box(tx - .77, py + 1.45, tz, .04, .9, 1.5); V.box(tx + .5, py + 1.5, tz + 1.27, 1.2, .8, .04); V.box(tx + .5, py + 1.5, tz - 1.27, 1.2, .8, .04); V.setCol(0x1c2428); V.box(tx - .775, py + 1.45, tz, .03, .74, 1.34);
      V.setCol(0xc9705c); V.box(tx - 1.0, py + 2.02, tz, 1.1, .05, 1.7, 0); k.box('wood_painted', 3.3, .09, 3.3, tx + .45, py + 2.28, tz, { rz: -.14, bevel: .012 }); k.box('wood_painted', 3.34, .05, .14, tx + .45, py + 2.2, tz + 1.62, { rz: -.14 }); k.box('wood_painted', 3.34, .05, .14, tx + .45, py + 2.2, tz - 1.62, { rz: -.14 });
      for (const s of [-1, 1]) { for (let i = 0; i < 5; i++) k.box('wood_painted', .07, .95, .07, tx - 1.9 + i * .95, py + .55, tz + s * 1.9, { bevel: .006 }); k.box('wood_painted', 3.9, .07, .09, tx, py + 1.03, tz + s * 1.9, { bevel: .008 }); k.box('wood_painted', 3.9, .05, .05, tx, py + .55, tz + s * 1.9); }
      for (let i = 0; i < 5; i++) k.box('wood_painted', .07, .95, .07, tx - 1.9, py + .55, tz - 1.9 + i * .95, { bevel: .006 }); k.box('wood_painted', .09, .07, 3.9, tx - 1.9, py + 1.03, tz, { bevel: .008 }); k.box('wood_painted', .05, .05, 3.9, tx - 1.9, py + .55, tz);
      // ramp down to the sand on the landward side
      const rl = 4.6, ra = Math.atan2(2.35, 4.0); k.box('wood_plank', rl, .08, 1.2, tx + 1.95 + 2.0, by + 1.2, tz - 1.2, { rz: -ra, bevel: .01 }); for (let i = 0; i < 9; i++) k.box('wood_painted', .05, .03, 1.2, tx + 2.2 + i * .44, py + .0 - (i + .5) * .258 + .06, tz - 1.2);
      k.cyl('metal_galv', .025, .03, 3.2, tx + 1.7, py + 3.6, tz + 1.2, { seg: 6 }); V.setCol(0xb3242c); V.card([tx + 1.7, py + 5.15, tz + 1.2], [tx + 1.7, py + 4.55, tz + 1.2], [tx + 1.75, py + 4.6, tz + 2.1], [tx + 1.75, py + 5.1, tz + 2.1], 0, 0, 1, 1);
      X.S.vquad(tx - .79, py + .62, tz + .9, .55, .55, -PI / 2, sgUV('num7')); X.S.vquad(tx + .5, py + .55, tz + 1.262, .55, .55, 0, sgUV('num7'));
      GT.world.addBox(tx - 2, tz - 2, tx + 2, tz + 2, 5, 'lifeguard'); GT.world.anchor('lifeguardTower', { x: tx, z: tz, h: -PI / 2 }); }
    // ---- volleyball net, trash barrels, driftwood, benches on the promenade
    { const nx = -27, nz = -52, by = beachH(nx, nz); for (const s of [-1, 1]) k.cyl('wood_plank', .07, .08, 2.9, nx, by + 1.2, nz + s * 4.8, { seg: 8 }); X.CH.quad4([nx, by + 1.45, nz - 4.75], [nx, by + 1.45, nz + 4.75], [nx, by + 2.43, nz + 4.75], [nx, by + 2.43, nz - 4.75], [[0, 0], [95, 0], [95, 9.8], [0, 9.8]], false);
      X.V.setCol(0xe6e2d6); X.V.box(nx, by + 2.43, nz, .02, .06, 9.5); X.V.box(nx, by + 1.45, nz, .02, .04, 9.5); for (const [ax, az] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) k.cyl('wood_painted', .03, .03, .2, nx + ax, beachH(nx + ax, nz + az) + .05, nz + az, { seg: 5 }); }
    const barrel = (x, zz, y0, tint) => { k.cyl(tint, .29, .28, .88, x, y0 + .44, zz, { seg: 14 }); for (const h of [.02, .3, .59, .86]) k.cyl(tint, .3, .3, .025, x, y0 + h, zz, { seg: 14 }); k.cyl('rubber', .27, .27, .02, x, y0 + .86, zz, { seg: 12 }); };
    for (const [x, zz] of [[-13.2, -24.5], [-14, 40], [-13.6, 99], [-13.4, -88], [-31, 20], [-13.8, 150], [-14.2, -150]]) barrel(x, zz, beachH(x, zz) - .04, r() < .5 ? 'metal_painted_blue' : 'metal_rust');
    for (let i = 0; i < 9; i++) { const x = rr(-50, -16), zz = rr(-180, 180), y0 = beachH(x, zz), a = rr(0, TAU), l = rr(1.2, 3.2), pts = []; for (let q = 0; q <= 3; q++) pts.push([x + Math.cos(a) * l * (q / 3 - .5) + rr(-.12, .12), y0 + .07 + rr(-.03, .09), zz + Math.sin(a) * l * (q / 3 - .5) + rr(-.12, .12)]); k.tube('wood_painted', pts, rr(.05, .11), { seg: 6, steps: 8 }); if (r() < .5) k.tube('wood_painted', [pts[1], [pts[1][0] + rr(-.5, .5), y0 + .3, pts[1][2] + rr(-.5, .5)]], .035, { seg: 5, steps: 2 }); }
    const bench = (zz) => { const x = -9.35; for (const s of [-1, 1]) { k.box('concrete_stained', .42, .42, .12, x, SWH + .21, zz + s * .75, { bevel: .02 }); k.box('concrete_stained', .1, .46, .12, x - .22, SWH + .62, zz + s * .75, { rz: .2, bevel: .015 }); }
      for (let i = 0; i < 4; i++) k.box('wood_plank', .095, .04, 1.9, x - .14 + i * .11, SWH + .44, zz, { bevel: .008 }); for (let i = 0; i < 3; i++) k.box('wood_plank', .035, .1, 1.9, x - .265 - i * .028, SWH + .58 + i * .125, zz, { rz: .2, bevel: .008 }); GT.world.addBox(x - .35, zz - 1, x + .3, zz + 1, .9, 'bench'); };
    for (const zz of [-128, -84, -41, 6, 52, 112, 146]) bench(zz);
    // ---- pier with hut and lamps
    { const y0 = SWH + .02, x0 = -10.0, x1 = -118, wd = 'wood_plank';
      k.box(wd, x0 - x1, .1, 4.0, (x0 + x1) / 2, y0 - .05, PIERZ, { bevel: .01 }); for (let x = x0 - 3; x > x1; x -= 6) { for (const s of [-1, 1]) { k.cyl('palm_trunk', .15, .17, 5.2, x, y0 - 2.6, PIERZ + s * 1.7, { seg: 6 }); k.box(wd, .12, .22, .3, x, y0 - .22, PIERZ + s * 1.7); } k.box(wd, .16, .24, 4.2, x, y0 - .22, PIERZ); k.box(wd, .08, .14, 4.0, x, y0 - 1.1, PIERZ, { rx: .42 }); }
      for (const s of [-1, 1]) { for (let x = x0 - .4; x > x1 - .1; x -= 2.4) k.box(wd, .09, 1.05, .09, x, y0 + .52, PIERZ + s * 1.93); k.box(wd, x0 - x1 - .3, .06, .13, (x0 + x1) / 2, y0 + 1.06, PIERZ + s * 1.93, { bevel: .008 }); k.box(wd, x0 - x1 - .3, .04, .08, (x0 + x1) / 2, y0 + .56, PIERZ + s * 1.93); k.box(wd, x0 - x1, .16, .1, (x0 + x1) / 2, y0 - .13, PIERZ + s * 2.0); }
      for (let x = -24; x > x1; x -= 22) { k.cyl('metal_dark', .035, .045, 2.6, x, y0 + 2.35, PIERZ + 1.93, { seg: 8 }); k.box('metal_dark', .22, .05, .22, x, y0 + 3.66, PIERZ + 1.93); X.LAMP.box(x, y0 + 3.55, PIERZ + 1.93, .16, .18, .16); X.pools.push([x, y0 + .012, PIERZ + .6, 3.2, 2.6, .8]); }
      const hx = x1 + 4; k.box(wd, 9, .1, 8, hx, y0 - .05, PIERZ, { bevel: .01 }); for (const [ax, az] of [[-4, -3.6], [4, -3.6], [-4, 3.6], [4, 3.6], [0, -3.6], [0, 3.6]]) k.cyl('palm_trunk', .16, .18, 5.2, hx + ax, y0 - 2.6, PIERZ + az, { seg: 8 });
      k.box('wood_painted', 5, 2.5, 4.4, hx - .8, y0 + 1.25, PIERZ, { bevel: .015 }); k.box('corrugated_metal', 6.2, .08, 3.1, hx - .8, y0 + 3.05, PIERZ - 1.3, { rx: -.42 }); k.box('corrugated_metal', 6.2, .08, 3.1, hx - .8, y0 + 3.05, PIERZ + 1.3, { rx: .42 }); k.box('glass_tint', .04, .9, 2.4, hx + 1.71, y0 + 1.5, PIERZ);
      for (const s of [-1, 1]) for (let i = 0; i < 5; i++) k.box(wd, .09, 1.05, .09, hx - 4.4 + i * 2.2, y0 + .52, PIERZ + s * 3.93); for (const s of [-1, 1]) k.box(wd, 9, .06, .13, hx, y0 + 1.06, PIERZ + s * 3.93); k.box(wd, .13, .06, 8, hx - 4.44, y0 + 1.06, PIERZ); for (let i = 0; i < 4; i++) k.box(wd, .09, 1.05, .09, hx - 4.44, y0 + .52, PIERZ - 3 + i * 2);
      // bollards at the entrance so nobody drives onto it
      for (const s of [-1, 0, 1]) { k.cyl('metal_painted_yellow', .08, .08, .95, -9.7, SWH + .47, PIERZ + s * 1.3, { seg: 10 }); k.sphere('metal_painted_yellow', .08, -9.7, SWH + .95, PIERZ + s * 1.3, { seg: 10, seg2: 6 }); } }
    // ---- sea + canal surface (one mesh, custom shader)
    const sb = new Batch(); sb.rect(-4200, -4200, -51.5, 4200, SEA_Y); sb.rect(159.5, -164.5, 167.2, 164.5, -.72);
    const U = T.UniformsUtils.merge([T.UniformsLib.fog, { uT: { value: 0 }, uSun: { value: new T.Vector3(-1, .1, .2).normalize() }, uSunCol: { value: new T.Color(3, 1.6, .6) }, uSkyZ: { value: new T.Color(.1, .2, .4) }, uSkyH: { value: new T.Color(.6, .5, .45) }, uSkyS: { value: new T.Color(1.4, .8, .4) }, uDeep: { value: new T.Color(.01, .03, .04) }, uShal: { value: new T.Color(.06, .12, .11) }, uFoam: { value: new T.Color(.8, .7, .6) } }]);
    U.tN = { value: texWaterN() }; if (T.UniformsLib.fog.gtFogSun) { U.gtFogSun = T.UniformsLib.fog.gtFogSun; U.gtFogSunCol = T.UniformsLib.fog.gtFogSunCol; U.gtFogOppCol = T.UniformsLib.fog.gtFogOppCol; }
    const seaMat = new T.ShaderMaterial({ uniforms: U, fog: true, vertexShader: ['varying vec3 vW;', '#include <fog_pars_vertex>', 'void main(){ vec4 wp = modelMatrix * vec4(position, 1.); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;', '#include <fog_vertex>', '}'].join('\n'),
      fragmentShader: ['uniform sampler2D tN; uniform float uT; uniform vec3 uSun, uSunCol, uSkyZ, uSkyH, uSkyS, uDeep, uShal, uFoam; varying vec3 vW;', '#include <common>', '#include <fog_pars_fragment>', 'void main(){',
        ' vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist; vec2 p = vW.xz; bool sea = vW.x < -30.; float t = uT;',
        ' vec4 n1 = texture2D(tN, p * .013 + vec2(t * .010, t * .004)); vec4 n2 = texture2D(tN, p * .041 + vec2(-t * .013, t * .011)); vec4 n3 = texture2D(tN, p * .127 + vec2(t * .021, -t * .017)); vec4 n4 = texture2D(tN, p * .43 + vec2(-t * .05, -t * .03));',
        ' vec2 g = (n1.xy - .5) * 1.1 + (n2.xy - .5) * .9 + (n3.xy - .5) * .7 + (n4.xy - .5) * .5; float nk = .3 + .55 / (1. + dist * .012);',
        ' vec3 N = normalize(vec3(g.x * nk, 1., g.y * nk)); float ndv = max(dot(N, V), 0.); float F = .02 + .98 * pow(1. - ndv, 5.);',
        ' vec3 R = reflect(-V, N); R.y = abs(R.y); vec2 sxz = normalize(uSun.xz); float az = dot(normalize(R.xz + vec2(1e-4)), sxz);',
        ' vec3 hor = mix(uSkyH, uSkyS, pow(max(az, 0.), 4.)); vec3 sky = mix(hor, uSkyZ, pow(clamp(R.y * 1.6 + .03, 0., 1.), .6));',
        ' float edge = -54.4 + sin(t * .45 + p.y * .043) * .9 + sin(t * .31 + p.y * .11 + 2.) * .45 + (n2.a - .5) * 1.8; float d = edge - vW.x; if (sea && d < 0.) discard;',
        ' float shal = sea ? exp(-max(d, 0.) * .085) : .0; vec3 body = mix(uDeep, uShal, shal); if (!sea) { body = body * vec3(.5, .6, .32) + uSkyH * vec3(.008, .009, .004); sky *= .3; }',
        ' float sd = max(dot(R, uSun), 0.); vec3 R0 = reflect(-V, vec3(0., 1., 0.)); R0.y = abs(R0.y);',
        ' float dAz = acos(clamp(dot(normalize(R0.xz + vec2(1e-4)), sxz), -1., 1.)); float elS = asin(clamp(uSun.y, -1., 1.)); float elR = asin(clamp(R0.y, 0., 1.)); float wAz = .03 + .55 * elR;',
        ' float colm = exp(-dAz * dAz / (wAz * wAz)) * exp(-pow(max(elR - elS, 0.) / .45, 2.)) * smoothstep(-.06, .02, uSun.y);',
        ' float spark = pow(clamp(n3.a * n4.a * 2.4 + n2.a * .25, 0., 1.4), 3.);',
        ' vec3 sun = uSunCol * (pow(sd, 600.) * 22. + colm * (.22 + 2.6 * spark));',
        ' vec3 c = mix(body, sky, F) + sun;',
        ' if (sea) { float lace = n3.a * .62 + n4.a * .62; float fm = smoothstep(2.2, 0., d) * smoothstep(.3, .62, lace + .22); float band = sin(d * .5 - t * .7 + n2.a * 5.); fm += smoothstep(.7, 1., band) * smoothstep(17., 2.5, d) * smoothstep(.5, .85, lace) * .85; c = mix(c, uFoam, clamp(fm, 0., 1.)); }',
        ' gl_FragColor = vec4(c, 1.);', '#include <tonemapping_fragment>', '#include <encodings_fragment>', '#include <fog_fragment>', '}'].join('\n') });
    const sea = sb.mesh(seaMat, { cull: false, name: 'road_sea' }); sea.receiveShadow = false; X.root.add(sea); state.sea = seaMat;
    // ---- boats
    { const V = X.V; // sailboat
      const boat = (x, zz, s, ry) => { const c = Math.cos(ry), sn = Math.sin(ry), P = (a, b) => [x + a * c + b * sn, zz - a * sn + b * c]; V.setCol(0xdedad0); let p = P(0, 0); V.box(p[0], SEA_Y + .5 * s, p[1], 2.6 * s, 1.0 * s, 8 * s, ry); p = P(0, 4.6 * s); V.box(p[0], SEA_Y + .55 * s, p[1], 1.5 * s, .9 * s, 1.6 * s, ry + .5); V.setCol(0x8a8a86); p = P(0, .6 * s); V.box(p[0], SEA_Y + 6.5 * s, p[1], .14 * s, 11 * s, .14 * s, ry);
        V.setCol(0xe9e2cf); const m = P(0, .5 * s), t0 = P(0, -3.6 * s), f = P(0, 4.4 * s); V.card([m[0], SEA_Y + 1.6 * s, m[1]], [t0[0], SEA_Y + 1.7 * s, t0[1]], [m[0], SEA_Y + 11.6 * s, m[1]], [m[0], SEA_Y + 11.7 * s, m[1]], 0, 0, 1, 1); V.card([m[0], SEA_Y + 1.5 * s, m[1] + .2], [f[0], SEA_Y + 1.3 * s, f[1]], [m[0], SEA_Y + 9.6 * s, m[1] + .2], [m[0], SEA_Y + 9.7 * s, m[1] + .2], 0, 0, 1, 1); };
      boat(-250, 150, 1.2, .5); boat(-420, -60, 1.1, -.9);
      // trawler + a freighter on the horizon
      V.setCol(0x3a4a52); V.box(-340, SEA_Y + 1.2, 10, 5, 2.4, 17, .3); V.setCol(0xd8d4c8); V.box(-339, SEA_Y + 3.6, 6, 3.6, 2.6, 5, .3); V.setCol(0x70706c); V.box(-341.5, SEA_Y + 6, 13, .2, 7, .2, .3); V.box(-340.5, SEA_Y + 6.8, 11, .12, .12, 7, .3, undefined);
      V.setCol(0x2a2c30); V.box(-1500, SEA_Y + 5, 620, 26, 10, 190, .12); V.setCol(0x8a3a2c); V.box(-1500, SEA_Y + 13, 610, 22, 8, 120, .12); V.setCol(0xd8d4c8); V.box(-1492, SEA_Y + 20, 700, 20, 22, 18, .12); }
  }

  /* ================================================================== vegetation */
  Batch.prototype.blob = function (cx, cy, cz, rx, ry, rz, uv, seg, rings) { seg = seg || 6; rings = rings || 4; const base = this.n; for (let j = 0; j <= rings; j++) for (let i = 0; i <= seg; i++) { const th = j / rings * PI, ph = i / seg * TAU, nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph); this.v(cx + nx * rx, cy + ny * ry, cz + nz * rz, nx, ny, nz, lerp(uv[0], uv[2], i / seg), lerp(uv[1], uv[3], j / rings)); }
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const a = base + j * (seg + 1) + i, b = a + seg + 1; this.I.push(a, a + 1, b, a + 1, b + 1, b); } return this; };
  const PALMS = [
    { H: 9.6, lean: 1.7, s: .25, lz: .3, r0: .17, taper: .72, nf: 15, L: 4.1, droop: 1, nd: 3, coco: 6 },                 // tall coconut, sweeping lean
    { H: 7.0, lean: 2.4, s: -.35, lz: -.4, r0: .16, taper: .74, nf: 14, L: 3.8, droop: 1.1, nd: 4, coco: 4 },             // mid coconut, strong curve
    { H: 10.8, lean: .15, s: .05, lz: 0, r0: .24, taper: .78, nf: 16, L: 3.7, droop: .9, nd: 0, coco: 0, royal: 1 },     // royal palm: straight grey trunk, green crownshaft
    { H: 4.4, lean: .5, s: .1, lz: .2, r0: .2, taper: .85, nf: 14, L: 3.6, droop: .95, nd: 2, coco: 3 }];                 // young coconut
  function palmGeo(o, seed) {
    const b = new Batch({ col: true, wind: true }), r = GT.rng(seed), rr = (a, c) => a + (c - a) * r(), H = o.H, SEG = 14, SD = 6, tu = flUV(o.royal ? 'trunkR' : 'trunkC', 3), sway = H / 9;
    const ctr = t => [o.lean * Math.pow(t, 1.7) + o.s * Math.sin(t * PI), H * t, o.lz * t * t];
    const rad = t => o.r0 * (1 + .8 * Math.exp(-t * 24)) * lerp(1, o.taper, t) * (o.royal ? 1 + .2 * Math.sin(cl((t - .08) / .55, 0, 1) * PI) : 1);
    for (let j = 0; j < SEG; j++) { const t0 = j / SEG, t1 = (j + 1) / SEG, v0 = lerp(tu[3], tu[1], (j % 3) / 3), v1 = lerp(tu[3], tu[1], (j % 3 + 1) / 3), c0 = ctr(t0), c1 = ctr(t1), ra = rad(t0), rb = rad(t1), k0 = lerp(.72, 1.05, Math.min(1, t0 * 4)), k1 = lerp(.72, 1.05, Math.min(1, t1 * 4));
      for (let i = 0; i < SD; i++) { const a0 = i / SD * TAU, a1 = (i + 1) / SD * TAU, u0 = lerp(tu[0], tu[2], i / SD), u1 = lerp(tu[0], tu[2], (i + 1) / SD), V = (c, rd, a, u, v, t, kk) => { b.col = [kk, kk, kk]; b.w = [t * t * sway, 0]; return b.v(c[0] + Math.cos(a) * rd, c[1], c[2] + Math.sin(a) * rd, Math.cos(a), 0, Math.sin(a), u, v); };
        b.q(V(c0, ra, a0, u0, v0, t0, k0), V(c1, rb, a0, u0, v1, t1, k1), V(c1, rb, a1, u1, v1, t1, k1), V(c0, ra, a1, u1, v0, t0, k0)); } }
    const top = ctr(1); b.w = [sway, 0];
    let cy = top[1];
    if (o.royal) { const su = flUV('shaft', 3); b.col = [1, 1, 1]; const sh = 1.7; for (let i = 0; i < SD; i++) { const a0 = i / SD * TAU, a1 = (i + 1) / SD * TAU, ra = o.r0 * .86, rb = o.r0 * .5, V = (y, rd, a, u, v) => b.v(top[0] + Math.cos(a) * rd, y, top[2] + Math.sin(a) * rd, Math.cos(a), .1, Math.sin(a), u, v); b.q(V(cy - .05, ra, a0, lerp(su[0], su[2], i / SD), su[3]), V(cy + sh, rb, a0, lerp(su[0], su[2], i / SD), su[1]), V(cy + sh, rb, a1, lerp(su[0], su[2], (i + 1) / SD), su[1]), V(cy - .05, ra, a1, lerp(su[0], su[2], (i + 1) / SD), su[3])); } cy += sh - .1; }
    else { b.col = [.62, .5, .36]; b.blob(top[0], cy + .1, top[2], o.r0 * 1.9, .42, o.r0 * 1.9, flUV('coco', 8), 7, 4); b.col = [.8, .82, .6]; for (let i = 0; i < o.coco; i++) { const a = rr(0, TAU), d = rr(.2, .34); b.blob(top[0] + Math.cos(a) * d, cy - rr(.12, .34), top[2] + Math.sin(a) * d, .125, .15, .125, flUV('coco', 8), 5, 3); } cy += .25; }
    const frond = (az, th0, droop, Lf, cell, tint, roll, old) => { const uv = flUV(cell, 2), NS = 6, W = Lf / 8, ox = Math.cos(az), oz = Math.sin(az), sdx = -oz, sdz = ox; let px = top[0] + ox * .1, py = cy, pz = top[2] + oz * .1; const rows = [];
      for (let j = 0; j <= NS; j++) { const s = j / NS, e = th0 - droop * Math.pow(s, 1.45), ce = Math.cos(e), se = Math.sin(e), ro = roll * s, cr = Math.cos(ro), sr = Math.sin(ro);
        const nu = [-se * ox, ce, -se * oz], sd = [sdx * cr + nu[0] * sr, nu[1] * sr, sdz * cr + nu[2] * sr], nv = [nu[0] * cr - sdx * sr, nu[1] * cr, nu[2] * cr - sdz * sr], ph = lerp(old ? .7 : .35, old ? 1.25 : 1.1, s), cp = Math.cos(ph), sp = Math.sin(ph), u = lerp(uv[0], uv[2], s), wv = [sway, .25 + Math.pow(s, 1.2)];
        b.col = tint; b.w = wv; const Lp = [px - sd[0] * W * cp - nv[0] * W * sp, py - sd[1] * W * cp - nv[1] * W * sp, pz - sd[2] * W * cp - nv[2] * W * sp], Rp = [px + sd[0] * W * cp - nv[0] * W * sp, py + sd[1] * W * cp - nv[1] * W * sp, pz + sd[2] * W * cp - nv[2] * W * sp];
        const nL = [nv[0] * cp - sd[0] * sp, nv[1] * cp - sd[1] * sp, nv[2] * cp - sd[2] * sp], nR = [nv[0] * cp + sd[0] * sp, nv[1] * cp + sd[1] * sp, nv[2] * cp + sd[2] * sp], vm = (uv[1] + uv[3]) / 2;
        rows.push([b.v(Lp[0], Lp[1], Lp[2], nL[0], nL[1], nL[2], u, uv[1]), b.v(px, py, pz, nL[0], nL[1], nL[2], u, vm), b.v(px, py, pz, nR[0], nR[1], nR[2], u, vm), b.v(Rp[0], Rp[1], Rp[2], nR[0], nR[1], nR[2], u, uv[3])]);
        const e2 = th0 - droop * Math.pow((j + .5) / NS, 1.45), ds = Lf / NS; px += Math.cos(e2) * ox * ds; py += Math.sin(e2) * ds; pz += Math.cos(e2) * oz * ds; }
      for (let j = 0; j < NS; j++) { const a = rows[j], c = rows[j + 1]; b.I.push(a[0], a[1], c[1], a[0], c[1], c[0], a[0], c[1], a[1], a[0], c[0], c[1], a[2], a[3], c[3], a[2], c[3], c[2], a[2], c[3], a[3], a[2], c[2], c[3]); } };
    for (let i = 0; i < o.nf; i++) { const q = (i + .5) / o.nf, az = i * 2.39996 + rr(-.25, .25), th0 = lerp(1.38, -.3, Math.pow(q, .9)) + rr(-.1, .1), Lf = o.L * lerp(.72, 1, Math.sin(PI * cl(q * .85 + .15, 0, 1))) * rr(.92, 1.06), g = rr(.82, 1.08);
      frond(az, th0, lerp(.75, 1.45, q) * o.droop, Lf, o.royal ? 'frondRoyal' : (r() < .3 ? 'frondB' : 'frondA'), [g * lerp(.95, 1.16, q), g * lerp(1.05, .98, q), g * lerp(.95, .66, q)], rr(-.7, .7), q > .6); }
    for (let i = 0; i < o.nd; i++) frond(rr(0, TAU), rr(-.75, -1.1), rr(.3, .5), o.L * rr(.6, .85), 'frondDead', [1, 1, 1], rr(-.5, .5), true);
    return b.geo();
  }
  function buildFlora(X) {
    const { B, M } = X, r = GT.rng('flora-place'), rr = (a, b) => a + (b - a) * r(), VG = B.veg, SUNN = [-.38, .9, .08];
    // ---- palms: instance lists per variant
    const list = [[], [], [], []], add = (v, x, z, s, ry, y) => list[v].push([x, y === undefined ? classify(x, z)[0] : y, z, s, ry, rr(.8, 1.12)]);
    const blockedE = z => { for (const d of DRIVES) if (Math.abs(z - d) < 7.5) return true; for (const p of X.poleZ) if (Math.abs(z - p) < 3.2) return true; if (Math.abs(Math.abs(z) - 160) < 13) return true; if (z > 29 && z < 47) return true; if (Math.abs(z - 23) < 4 || Math.abs(z - 51) < 4) return true; return false; };
    for (let z = -186; z < 188; z += rr(12, 17)) { if (STAIRS.some(s => Math.abs(z - s) < 3.5) || Math.abs(z - PIERZ) < 4.5) continue; const v = r() < .5 ? 0 : r() < .6 ? 1 : 3, x = -12.4 + rr(-.5, 1.2); add(v, x, z, rr(.88, 1.14), PI + rr(-1, 1), beachH(x, z) - .12); if (r() < .3) { const x2 = x - rr(1.6, 3), z2 = z + rr(-2, 2); add(r() < .5 ? 1 : 3, x2, z2, rr(.8, 1.05), PI + rr(-1.2, 1.2), beachH(x2, z2) - .12); } }
    for (let z = -180; z < 184; z += 17.5) { if (blockedE(z)) continue; add(r() < .72 ? 2 : 0, 12.1 + rr(-.3, .3), z, rr(.9, 1.1), rr(0, TAU)); }
    for (const [cx, cz] of [[-21, -74], [-19, 58], [-25, 138], [-22, -152], [-17, 8], [-28, -118]]) for (let i = 0; i < 3; i++) { const x = cx + rr(-3, 3), z = cz + rr(-4, 4); add(i === 0 ? 0 : r() < .5 ? 1 : 3, x, z, rr(.85, 1.15), PI + rr(-1.4, 1.4), beachH(x, z) - .12); }
    for (const [x, z, v] of [[86, 34, 0], [80, 38, 1], [90, -30, 0], [84, -8, 3], [78, 18, 1], [96, 60, 0], [95, 100, 1], [104, 20, 0], [136, 60, 1], [120, -30, 3], [30, 36, 0], [52, 40, 1], [66, 32, 3], [24, -47, 3], [60, -47, 0], [100, -47, 1], [130, 125, 0], [25, 146, 2], [70, 146, 2], [142.8, -100, 2], [142.8, -40, 2], [142.8, 20, 2], [142.8, 80, 2], [142.8, 130, 2], [40, -153, 2], [75, -153, 2], [110, -153, 2], [50, 153, 2], [100, 153, 2]]) add(v, x, z, rr(.85, 1.15), rr(0, TAU), v === 2 ? undefined : 0);
    for (const s of [-1, 1]) { for (let z = 204; z < 500; z += rr(34, 50)) { const x = -12.6 + rr(-.6, 1.5); add(r() < .5 ? 0 : 1, x, s * z, rr(.9, 1.15), PI + rr(-1, 1), beachH(x, s * z) - .12); } for (let z = 200; z < 480; z += rr(44, 60)) add(r() < .6 ? 2 : 0, 12.2 + rr(-.3, 3), s * z, rr(.9, 1.1), rr(0, TAU), 0); }
    for (let i = 0; i < 12; i++) { const a = rr(-1.2, 1.2) + (i & 1 ? 0 : PI / 2 * (r() < .5 ? 1 : -1)), d = rr(190, 330); const x = 150 + Math.cos(a) * d * (i & 1 ? 1 : .2), z = (i & 1 ? Math.sin(a) * d : (a > 0 ? 1 : -1) * rr(176, 300)); if (x > 172 || Math.abs(z) > 172) add(r() < .6 ? 0 : 1, x, z, rr(.9, 1.2), rr(0, TAU), 0); }
    const mx = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), sc = new T.Vector3(), col = new T.Color(); let tris = 0;
    PALMS.forEach((o, v) => { const g = palmGeo(o, 'palm' + v), im = new T.InstancedMesh(g, M.flora, list[v].length); list[v].forEach((it, i) => { p.set(it[0], it[1], it[2]); q.setFromEuler(e.set(0, it[4], 0)); sc.set(it[3], it[3] * rr(.94, 1.08), it[3]); mx.compose(p, q, sc); im.setMatrixAt(i, mx); im.setColorAt(i, col.setRGB(it[5], it[5] * rr(.96, 1.04), it[5] * rr(.9, 1.02)));
        if (Math.abs(it[2]) < 195 && it[0] < 160) GT.world.addPost(it[0], it[2], o.r0 * 1.3, 6, 'palm'); });
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.customDepthMaterial = M.floraDepth; im.name = 'road_palm' + v; X.root.add(im); tris += g.index.count / 3 * list[v].length; });
    state.stats.palms = list.reduce((a, l) => a + l.length, 0); state.stats.palmTris = tris;
    // ---- small vegetation (merged cards)
    const tuft = (x, y, z, w, h, cell, k, lean) => { const uv = flUV(cell), a0 = rr(0, PI); VG.col = [k * rr(.85, 1.1), k * rr(.85, 1.1), k * rr(.8, 1)]; for (let c = 0; c < 2; c++) { const a = a0 + c * PI / 2 + rr(-.3, .3), dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2, lx = (lean || 0) * rr(.5, 1.5), lz = rr(-.1, .1) * h;
        VG.card([x - dx + lx, y + h, z - dz + lz], [x + dx + lx, y + h, z + dz + lz], [x + dx, y - .03, z + dz], [x - dx, y - .03, z - dz], uv[0], uv[1], uv[2], uv[3], SUNN, [[0, 1], [0, 1], [0, 0], [0, 0]]); } };
    const shrub = (x, y, z, rx, ry, rz, cell, k, n) => { const uv = flUV(cell); n = n || 9; for (let i = 0; i < n; i++) { const th = Math.acos(rr(-.25, 1)), ph = rr(0, TAU), nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph), cx = x + nx * rx * .55, cy = y + ry * .55 + ny * ry * .5, cz = z + nz * rz * .55, s = Math.max(rx, rz) * rr(.62, .85), a = rr(0, TAU);
        // card roughly facing outward, random roll
        let tx = -nz, tz = nx; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl; if (tl < .01) { tx = 1; tz = 0; } const bx = ny * tz, by = nz * tx - nx * tz, bz = -ny * tx, ca = Math.cos(a), sa = Math.sin(a), ux = tx * ca + bx * sa, uy = by * sa, uz = tz * ca + bz * sa, vx = -tx * sa + bx * ca, vy = by * ca, vz = -tz * sa + bz * ca, g = k * rr(.8, 1.12), nn = [nx * .8, ny * .8 + .45, nz * .8], wt = cl((cy - y) / (ry * 1.2), 0, 1) * .5;
        VG.col = [g, g * rr(.94, 1.04), g * rr(.85, 1)]; VG.card([cx - ux * s - vx * s, cy - uy * s - vy * s, cz - uz * s - vz * s], [cx + ux * s - vx * s, cy + uy * s - vy * s, cz + uz * s - vz * s], [cx + ux * s + vx * s, cy + uy * s + vy * s, cz + uz * s + vz * s], [cx - ux * s + vx * s, cy - uy * s + vy * s, cz - uz * s + vz * s], uv[0], uv[1], uv[2], uv[3], nn, [[0, wt], [0, wt], [0, wt], [0, wt]]); } };
    const TW = GT.mat('wood_plank', { color: 0x4d3d2f }), tree = (x, z, h, cell) => { const ns = 2 + ((r() * 2) | 0), kk = rr(.6, .85); for (let i = 0; i < ns; i++) { const a = rr(0, TAU), d = h * rr(.08, .2); X.K.p.tube(TW, [[x + Math.cos(a) * .1, -.1, z + Math.sin(a) * .1], [x + Math.cos(a) * d * .4 + rr(-.15, .15), h * .22, z + Math.sin(a) * d * .4 + rr(-.15, .15)], [x + Math.cos(a) * d, h * .5, z + Math.sin(a) * d]], h * .011 + .03, { seg: 5, steps: 4 }); }
      for (let i = 0; i < 8; i++) { const a = rr(0, TAU), d = i ? h * rr(.1, .4) : 0, rad = h * rr(.26, .38) * (1 - d / h * .5); shrub(x + Math.cos(a) * d, h * rr(.3, .5) - (d / h) * h * .25, z + Math.sin(a) * d, rad, rad * rr(.75, 1), rad, cell, kk * rr(.85, 1.1), 7); } GT.world.addPost(x, z, .25, h, 'tree'); };
    X.veg = { tuft, shrub, tree };
    // dunes: sea oats + grass
    for (let i = 0; i < 440; i++) { const x = -11 - Math.pow(r(), 1.7) * 17, z = rr(-200, 200); if (STAIRS.some(s => Math.abs(z - s) < 1.6) && x > -14) continue; if (fb(x * .11 + 3.1, z * .06) < .42 && r() < .8) continue; const s = rr(.6, 1.25); tuft(x, beachH(x, z), z, s * 1.1, s * 1.05, r() < .7 ? 'oats' : 'tuft', rr(.85, 1.1), -.12); }
    for (let i = 0; i < 46; i++) { const x = -11.6 - r() * 6, z = rr(-195, 195); if (STAIRS.some(s => Math.abs(z - s) < 4) || Math.abs(z - PIERZ) < 4) continue; shrub(x, beachH(x, z) - .1, z, rr(.9, 1.7), rr(.7, 1.2), rr(.9, 1.7), 'grape', rr(.8, 1.05), 9); }
    // east verge: weeds, tufts along the sidewalk edge and at the lot line
    for (let i = 0; i < 520; i++) { const z = rr(-188, 188), x = r() < .4 ? rr(10.02, 10.5) : r() < .5 ? rr(13.2, 13.85) : rr(10.3, 13.6); const c = classify(x, z); if (c[1] !== 'grass') continue; const s = rr(.22, .6); tuft(x, c[0], z, s * 1.2, s, r() < .25 ? 'weed' : 'tuft', rr(.5, .8)); }
    // cracks in the kerb line / base of the seawall / sidewalk joints
    for (let i = 0; i < 90; i++) { const z = rr(-188, 188), s = rr(.12, .3); tuft(r() < .5 ? -9.93 : 9.95, SWH, z, s * 1.3, s, r() < .5 ? 'weed' : 'tuft', rr(.5, .8)); }
    // scrub in the unpaved gaps inside the loop
    const scrub = (x0, z0, x1, z1, n, ns, nt) => { for (let i = 0; i < n; i++) { const s = rr(.3, .8); tuft(rr(x0, x1), 0, rr(z0, z1), s * 1.3, s, r() < .3 ? 'weed' : 'tuft', rr(.5, .82)); } for (let i = 0; i < ns; i++) shrub(rr(x0 + 1, x1 - 1), -.1, rr(z0 + 1, z1 - 1), rr(.8, 1.8), rr(.7, 1.4), rr(.8, 1.8), r() < .6 ? 'shrub' : r() < .5 ? 'grape' : 'flower', rr(.75, 1.05)); for (let i = 0; i < nt; i++) tree(rr(x0 + 2, x1 - 2), rr(z0 + 2, z1 - 2), rr(4, 6.5), r() < .5 ? 'grape' : 'shrub'); };
    scrub(15, -51, 141, -43, 190, 26, 5); scrub(73, -41, 97, 47, 260, 30, 7); scrub(15, 27, 71, 47, 190, 16, 2); scrub(92.5, 49, 97.5, 131, 60, 14, 3); scrub(142.2, -150, 143.3, 150, 120, 0, 0);
    scrub(14.5, -153.2, 142, -152.2, 80, 0, 0); scrub(14.5, 152.2, 142, 153.2, 80, 0, 0);
    // shoulders, canal reeds, outside
    for (let i = 0; i < 300; i++) { const z = rr(-164, 164), x = r() < .5 ? rr(155.3, 157.4) : rr(157.4, 159.3), y = x > 157.2 ? lerp(0, -1.3, (x - 157.2) / 2.3) : 0, s = rr(.4, 1.1); tuft(x, y, z, s * 1.1, s, x > 157.6 ? 'oats' : 'tuft', rr(.7, 1)); }
    for (let i = 0; i < 180; i++) { const z = rr(-164, 164), x = rr(167.3, 169.6), y = lerp(-1.3, 0, (x - 167.2) / 2.3), s = rr(.6, 1.4); tuft(x, y, z, s, s, 'oats', rr(.65, .95)); }
    for (const zs of [-1, 1]) { for (let i = 0; i < 170; i++) { const x = rr(14, 157), s = rr(.3, .9); tuft(x, 0, zs * rr(164.8, 167), s * 1.2, s, r() < .3 ? 'weed' : 'tuft', rr(.7, 1)); }
      for (let x = 18; x < 400; x += rr(5, 11)) { const z = zs * rr(169.5, 186); if (r() < .6) tree(x, z, rr(4.5, 8), r() < .5 ? 'shrub' : 'grape'); else shrub(x, -.1, z, rr(1.5, 3), rr(1.2, 2.2), rr(1.5, 3), r() < .7 ? 'shrub' : 'flower', rr(.7, 1)); } }
    for (let z = -200; z < 200; z += rr(5, 10)) { const x = rr(171, 190); if (r() < .65) tree(x, z, rr(5, 9), r() < .5 ? 'shrub' : 'grape'); else shrub(x, -.1, z, rr(2, 3.5), rr(1.5, 2.4), rr(2, 3.5), 'shrub', rr(.7, 1)); }
    for (let i = 0; i < 300; i++) { const x = rr(170, 260), z = rr(-260, 260), s = rr(.5, 1.2); tuft(x, 0, z, s * 1.3, s, 'tuft', rr(.7, 1)); }
    // distant tree line cards (east / north / south), no wind
    const tl = flUV('treeline', 2), line = (x0, z0, x1, z1, h, k) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / (h * 4))); for (let i = 0; i < n; i++) { const ax = lerp(x0, x1, i / n), az = lerp(z0, z1, i / n), bx = lerp(x0, x1, (i + 1) / n), bz = lerp(z0, z1, (i + 1) / n), fl = i & 1; VG.col = [k, k, k]; VG.card([ax, h, az], [bx, h, bz], [bx, -.5, bz], [ax, -.5, az], fl ? tl[2] : tl[0], tl[1], fl ? tl[0] : tl[2], tl[3], [0, 1, 0]); } };
    line(230, -420, 250, 420, 17, .8); line(330, -520, 300, 520, 22, .7); line(430, 600, 470, -600, 26, .6); line(30, 262, 240, 250, 16, .8); line(14, 330, 420, 350, 20, .7); line(30, -262, 240, -250, 16, .8); line(14, -330, 420, -350, 20, .7); line(14, 440, 600, 470, 24, .6); line(14, -450, 600, -470, 24, .6);
  }

  /* ================================================================== street furniture */
  Batch.prototype.disc = function (cx, cy, cz, rad, ry, u, v, n) { n = n || 10; const rx = Math.cos(ry), rz = -Math.sin(ry), nx = Math.sin(ry), nz = Math.cos(ry), c = this.v(cx, cy, cz, nx, 0, nz, u, v), ids = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; ids.push(this.v(cx + rx * Math.cos(a) * rad, cy + Math.sin(a) * rad, cz + rz * Math.cos(a) * rad, nx, 0, nz, u, v)); } for (let i = 0; i < n; i++) this.I.push(c, ids[i], ids[(i + 1) % n]); return this; };
  Batch.prototype.cyl = function (cx, y0, cz, r0, r1, h, seg, uv, cap) { seg = seg || 10; uv = uv || [0, 0, 1, 1]; const base = this.n; for (let i = 0; i <= seg; i++) { const a = i / seg * TAU, c = Math.cos(a), s = Math.sin(a), u = lerp(uv[0], uv[2], i / seg); this.v(cx + c * r0, y0, cz + s * r0, c, .2, s, u, uv[1]); this.v(cx + c * r1, y0 + h, cz + s * r1, c, .2, s, u, uv[3]); }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; this.I.push(a, a + 1, a + 3, a, a + 3, a + 2); } if (cap !== false) { const c = this.v(cx, y0 + h, cz, 0, 1, 0, uv[0], uv[3]), ids = []; for (let i = 0; i < seg; i++) { const a = i / seg * TAU; ids.push(this.v(cx + Math.cos(a) * r1, y0 + h, cz + Math.sin(a) * r1, 0, 1, 0, uv[0], uv[3])); } for (let i = 0; i < seg; i++) this.I.push(c, ids[(i + 1) % seg], ids[i]); } return this; };
  function buildFurniture(X) {
    const { B, K, M } = X, k = K.p, S = X.S, SL = X.SL, V = X.V, r = GT.rng('furniture'), rr = (a, b) => a + (b - a) * r(), PW = GT.mat('wood_plank', { color: 0x4d3d2f }), lensUV = i => [(i + .5) / 16, .5];
    // ---- generic helpers
    const cobra = (x, y, z, dx, dz, len) => { const ex = x + dx * len, ez = z + dz * len; k.tube('metal_galv', [[x, y - .9, z], [x + dx * len * .25, y - .2, z + dz * len * .25], [x + dx * len * .7, y + .05, z + dz * len * .7], [ex, y, ez]], .038, { seg: 6, steps: 10 });
      k.push(ex + dx * .22, y, ez + dz * .22, { ry: Math.atan2(dx, dz) }); k.sphere('metal_galv', 1, 0, .02, 0, { s: [.17, .085, .38], seg: 10, seg2: 6 }); k.box('metal_galv', .1, .09, .2, 0, .02, -.36, { bevel: .01 }); k.pop();
      X.LAMP.box(ex + dx * .24, y - .055, ez + dz * .24, .2, .03, .42, Math.atan2(dx, dz)); X.pools.push([ex + dx * .6, .016, ez + dz * .6, 10.5, 8.5, 1]); X.cones.push([ex + dx * .24, y - .07, ez + dz * .24, 5.2, y - .1]); };
    const streetLight = (x, z, dx, dz) => { k.box('concrete_stained', .5, .12, .5, x, SWH + .04, z, { bevel: .02 }); k.box('metal_galv', .3, .025, .3, x, SWH + .115, z, { bevel: .004 }); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cyl('metal_galv', .014, .014, .05, x + a * .11, SWH + .14, z + b * .11, { seg: 6 });
      k.cyl('metal_galv', .062, .095, 8.3, x, SWH + 4.27, z, { seg: 10 }); k.box('metal_galv', .14, .2, .02, x + dx * .09, SWH + .55, z + dz * .09, { ry: Math.atan2(dx, dz) + PI / 2 }); cobra(x, 9.1, z, dx, dz, 2.5); GT.world.addPost(x, z, .14, 9, 'streetlight'); };
    const sagWire = (a, b, sag, rad, st) => { const pts = []; for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) - sag * 4 * t * (1 - t), lerp(a[2], b[2], t)]); } k.tube('rubber', pts, rad, { seg: 3, steps: st || 9 }); };
    /** utility pole; line runs along z when ry=0. returns wire attachment points (world) */
    const pole = (x, z, ry, o) => { o = o || {}; const c = Math.cos(ry), s = Math.sin(ry), Wp = (lx, y, lz) => [x + lx * c + lz * s, y, z - lx * s + lz * c], lean = o.lean || 0;
      k.push(x, 0, z, { ry, rz: lean }); k.cyl(PW, .105, .165, 11.4, 0, 5.6, 0, { seg: 9 }); k.cyl('metal_dark', .11, .11, .02, 0, 11.31, 0, { seg: 9 });
      k.box(PW, 2.5, .12, .1, 0, 10.5, .11, { bevel: .01 }); for (const sx of [-1, 1]) k.box('metal_galv', .035, .95, .008, sx * .42, 10.12, .17, { rz: sx * .82 });
      for (const ix of [-1.12, -.42, 1.12]) { k.cyl('plastic_grey', .035, .055, .16, ix, 10.7, .11, { seg: 6 }); if (!o.simple) { k.cyl('plastic_grey', .062, .04, .05, ix, 10.74, .11, { seg: 8 }); k.cyl('plastic_grey', .03, .05, .04, ix, 10.785, .11, { seg: 8 }); } }
      k.box('metal_galv', .06, .18, .16, .17, 9.2, 0); k.box('metal_galv', .05, .1, .2, -.15, 7.35, 0);
      if (!o.simple) { k.cyl('plastic_grey', .05, .05, .09, .26, 9.2, 0, { seg: 8, rx: PI / 2 }); k.box('metal_galv', .05, .1, .2, -.15, 6.85, 0); if (o.splice) k.box('rubber', .2, .22, .7, -.32, 7.2, 1.4, { bevel: .04 });
        k.box('plastic_grey', .03, 3.0, .04, .0, 1.5, .155); k.box('aluminium_brushed', .09, .13, .004, .12, 1.9, .1, { ry: .9 }); k.box('metal_painted_yellow', .2, .9, .012, 0, .55, -.165); }
      if (o.tx) { k.cyl('metal_galv', .26, .26, .82, -.5, 8.75, .0, { seg: 12 }); k.cyl('metal_galv', .275, .275, .03, -.5, 9.17, 0, { seg: 12 }); k.cyl('metal_galv', .275, .275, .03, -.5, 8.36, 0, { seg: 12 }); for (const bz of [-.12, .12]) { k.cyl('plastic_grey', .03, .045, .2, -.5, 9.28, bz, { seg: 8 }); k.cyl('plastic_grey', .055, .055, .02, -.5, 9.26, bz, { seg: 8 }); }
        k.box('metal_galv', .3, .08, .1, -.25, 8.95, 0); k.box('metal_galv', .3, .08, .1, -.25, 8.5, 0); k.tube('rubber', [[-.5, 9.38, .12], [-.75, 9.9, .15], [-1.12, 10.6, .11]], .011, { seg: 4, steps: 6 }); k.tube('rubber', [[-.5, 9.38, -.12], [-.2, 9.5, -.05], [.2, 9.25, 0]], .011, { seg: 4, steps: 6 });
        k.cyl('plastic_grey', .025, .025, .32, .8, 10.28, .2, { seg: 6, rz: .5 }); k.box('metal_galv', .05, .06, .12, .8, 10.42, .16); k.geo(GT.decalMat('rust_run'), new T.PlaneGeometry(.4, .7), { x: -.5, y: 8.2, z: .262 }); }
      k.pop();
      if (o.guy) { const g = Wp(0, 9.6, 0), e = Wp(0, 0, o.guy * 5.5); k.tube('metal_galv', [g, e], .012, { seg: 4, steps: 1 }); k.cyl('metal_painted_yellow', .03, .03, 2.2, lerp(g[0], e[0], .87), 1.25, lerp(g[2], e[2], .87), { seg: 6, rx: ry === 0 ? -o.guy * .52 : 0, rz: ry !== 0 ? o.guy * .52 : 0 }); }
      if (o.light) { const d = o.light; cobra(x, 9.0, z, d[0], d[1], 2.3); }
      GT.world.addPost(x, z, .2, 11, 'pole');
      return { ph: [-1.12, -.42, 1.12].map(ix => Wp(ix, 10.81, .11)), nt: Wp(.31, 9.2, 0), tc: [Wp(-.19, 7.35, 0), Wp(-.19, 6.85, 0)] }; };
    const stringPoles = (list, full) => { for (let i = 0; i < list.length - 1; i++) { const a = list[i], b = list[i + 1], span = Math.hypot(b.nt[0] - a.nt[0], b.nt[2] - a.nt[2]), sg = span * .02; const st = full ? 0 : 6; for (let j = 0; j < 3; j++) sagWire(a.ph[j], b.ph[j], sg * rr(.9, 1.15), .014, st); sagWire(a.nt, b.nt, sg * 1.1, .013, st); sagWire(a.tc[0], b.tc[0], sg * 1.5, .028, st); if (full) sagWire(a.tc[1], b.tc[1], sg * 1.8, .02); } };
    // ---- highway pole line (east verge) + continuation past the closures
    const hwP = X.poleZ.map((z, i) => pole(10.95, z, 0, { tx: i % 3 === 1, splice: i % 4 === 2, lean: (h2(i, 9) - .5) * .03, light: [1, 4, 6, 8].includes(i) ? [-1, 0] : null, guy: i === 0 ? -1 : i === X.poleZ.length - 1 ? 1 : 0 }));
    stringPoles(hwP, true);
    for (const s of [-1, 1]) { const far = [s > 0 ? hwP[hwP.length - 1] : hwP[0]]; for (let z = 214; z < 420; z += 40) far.push(pole(10.95 + rr(-.2, .2), s * z, 0, { lean: rr(-.02, .02), simple: 1 })); stringPoles(far, false); }
    for (const zc of XS) { const zz = zc + (zc < 0 ? -1 : 1) * 6.0, ps = []; for (let x = 26; x < 150; x += 31) ps.push(pole(x, zz, PI / 2, { simple: 1, tx: x === 57, light: x === 57 || x === 119 ? [0, zc < 0 ? 1 : -1] : null })); stringPoles(ps, false); }
    // ---- cobra-head street lights: west promenade + back road
    for (const z of [-170, -122, -74, -26, 22, 70, 118, 166]) streetLight(-8.02, z, 1, 0);
    for (const z of [-112, -40, 32, 104]) streetLight(BX - CW - .45, z, 1, 0);
    // ---- traffic signals
    const head = (x, y, z, ry, grp) => { const nx = Math.sin(ry), nz = Math.cos(ry); k.push(x, y, z, { ry }); k.box('metal_dark', .62, 1.36, .02, 0, 0, -.12, { bevel: .004 }); k.box('metal_painted_yellow', .34, 1.08, .24, 0, 0, 0, { bevel: .03 });
      for (let i = 0; i < 3; i++) { const g = new T.CylinderGeometry(.118, .118, .2, 12, 1, true, -PI * .8, PI * 1.6); g.rotateX(PI / 2); k.geo('metal_dark', g, { x: 0, y: .34 - i * .34 + .005, z: .2 }); k.cyl('metal_dark', .112, .112, .012, 0, .34 - i * .34, .121, { seg: 12, rx: PI / 2 }); } k.pop();
      for (let i = 0; i < 3; i++) X.LENS.disc(x + nx * .13, y + .34 - i * .34, z + nz * .13, .1, ry, lensUV(grp * 3 + i)[0], .5, 12); };
    const mast = (x, z, dx, len, offs, faceRy, grp, blade) => { k.box('concrete_stained', .8, .16, .8, x, SWH + .05, z, { bevel: .03 }); k.cyl('metal_dark', .2, .22, .32, x, SWH + .28, z, { seg: 8 }); k.cyl('metal_dark', .1, .15, 6.6, x, SWH + 3.5, z, { seg: 10 }); k.sphere('metal_dark', .11, x, SWH + 6.82, z, { seg: 8, seg2: 5 });
      k.tube('metal_dark', [[x, 6.25, z], [x + dx * len * .4, 6.52, z], [x + dx * len, 6.6, z]], .075, { seg: 8, steps: 10 }); k.tube('metal_dark', [[x, 5.3, z], [x + dx * 1.6, 6.35, z]], .035, { seg: 6, steps: 1 });
      for (const o of offs) { const hx = x + dx * o; k.box('metal_dark', .06, .34, .06, hx, 6.38, z + Math.cos(faceRy) * .0); head(hx, 6.0, z + Math.cos(faceRy) * .14, faceRy, grp); }
      if (blade) { const bx = x + dx * 1.9; S.vquad(bx, 6.05, z + Math.cos(faceRy) * .06, 1.9, .36, faceRy, sgUV(blade)); S.vquad(bx, 6.05, z - Math.cos(faceRy) * .0, 1.9, .36, faceRy + PI, sgUV(blade)); }
      GT.world.addPost(x, z, .22, 7, 'signal'); };
    const pedestal = (x, z, ry, grp) => { k.box('concrete_stained', .5, .14, .5, x, SWH + .04, z, { bevel: .02 }); k.cyl('metal_dark', .06, .075, 3.4, x, SWH + 1.8, z, { seg: 8 }); head(x + Math.sin(ry) * .2, 3.25, z + Math.cos(ry) * .2, ry, grp); k.box('metal_painted_yellow', .12, .2, .1, x + Math.sin(ry) * .09, 1.25, z + Math.cos(ry) * .09, { ry, bevel: .01 }); GT.world.addPost(x, z, .12, 3.5, 'signal'); };
    const cabinet = (x, z) => { k.box('concrete_stained', .9, .14, .7, x, SWH + .06, z, { bevel: .02 }); k.box('aluminium_brushed', .7, 1.45, .5, x, SWH + .85, z, { bevel: .02 }); k.box('aluminium_brushed', .74, .04, .54, x, SWH + 1.59, z, { bevel: .01 }); k.box('metal_dark', .02, .12, .04, x + .356, SWH + .9, z + .15); k.geo(GT.decalMat('grime_streak'), new T.PlaneGeometry(.5, .8), { x: x + .352, y: SWH + 1.1, z: z - .05, ry: PI / 2 }); GT.world.addBox(x - .4, z - .3, x + .4, z + .3, 1.6, 'cabinet'); };
    mast(-8.7, 166.6, 1, 9.3, [2.7, 5.7, 8.7], PI, 0, 'stHeron'); pedestal(-8.7, 153.6, PI / 2, 1); pedestal(-8.7, 165.0, PI / 2, 1); cabinet(9.4, 167.6);
    mast(8.7, -166.6, -1, 9.3, [2.7, 5.7, 8.7], 0, 0, 'stCoral'); pedestal(-8.7, -153.6, PI / 2, 1); pedestal(-8.7, -166.4, PI / 2, 1); cabinet(9.4, -151.8);
    for (const zc of XS) { const s = zc < 0 ? 1 : -1; k.cyl('metal_galv', .03, .03, 3.2, 12.3, SWH + 1.6, zc + s * 5.3, { seg: 6 }); S.vquad(12.3, 2.75, zc + s * 5.26, .75, .75, s > 0 ? PI : 0, sgUV('stopSign')); V.setCol(0x8a8c8c); V.box(12.3, 2.75, zc + s * 5.3, .75, .75, .02);
      S.vquad(12.3, 3.3, zc + s * 5.3, 1.3, .24, PI / 2, sgUV('stOcean')); S.vquad(12.3, 3.3, zc + s * 5.3, 1.3, .24, -PI / 2, sgUV('stOcean')); }
    // ---- signs on posts
    const sign = (x, z, ry, cell, w, h, y, base) => { const by = base === undefined ? classify(x, z)[0] : base; k.box('metal_galv', .05, y + h / 2 - .03, .03, x, by + (y + h / 2) / 2, z, { ry }); S.vquad(x + Math.sin(ry) * .022, by + y, z + Math.cos(ry) * .022, w, h, ry, sgUV(cell)); V.setCol(0x9a9c9c); V.box(x + Math.sin(ry) * .016, by + y, z + Math.cos(ry) * .016, w, h, .008, ry); GT.world.addPost(x, z, .05, 2.6, 'sign'); };
    sign(-8.0, -98, PI, 'speed45', .6, .75, 2.3); sign(-8.0, 64, PI, 'speed45', .6, .75, 2.3); sign(10.35, 120, 0, 'speed45', .6, .75, 2.3); sign(10.35, -70, 0, 'speed45', .6, .75, 2.3);
    sign(-8.0, -138, PI, 'shield', .62, .62, 2.35); sign(10.35, 142, 0, 'shield', .62, .62, 2.35); sign(-8.0, 36.5, PI, 'ped', .76, .76, 2.3); sign(10.35, 48.4, 0, 'ped', .76, .76, 2.3);
    sign(10.35, 4, -PI / 2, 'noPark', .32, .46, 2.1); sign(10.35, -26, -PI / 2, 'noPark', .32, .46, 2.1); sign(10.3, 31.4, -PI / 2, 'busSign', .34, .5, 2.4); sign(-8.0, -22, PI / 2, 'oneWay', .9, .3, 2.4); sign(-8.0, 94, PI / 2, 'oneWay', .9, .3, 2.4);
    sign(-8.0, 172, PI, 'detour', .9, .9, 2.2); sign(10.35, -173, 0, 'detour', .9, .9, 2.2); sign(-8.0, -176, PI, 'deadEnd', .76, .76, 2.2); sign(18, 156.4, PI / 2, 'speed30', .6, .75, 2.3); sign(144.6, -120, 0, 'speed30', .6, .75, 2.3); sign(144.6, 60, 0, 'speed30', .6, .75, 2.3); sign(13.6, -60, -PI / 2, 'tow', .5, .44, 1.9);
    // big FOR LEASE board in the vacant strip between station and motel
    { const x = 19, z = 37; for (const s of [-1, 1]) k.box('wood_plank', .1, 2.6, .1, x, 1.3, z + s * 1.25, { bevel: .01 }); k.box('wood_painted', .06, 1.7, 2.7, x, 2.0, z, { bevel: .01 }); S.vquad(x - .035, 2.0, z, 2.5, 1.6, -PI / 2, sgUV('lease')); GT.world.addBox(x - .1, z - 1.3, x + .1, z + 1.3, 3, 'sign'); }
    // ---- billboards on monopoles, lit by gooseneck lamps
    const billboard = (x, z, ry, cA, cB, h) => { const W = 14.4, Hh = 4.2, c = Math.cos(ry), s = Math.sin(ry), nx = s, nz = c, y0 = h || 9; k.cyl('concrete_stained', .9, .95, .5, x, .2, z, { seg: 12 }); k.cyl('metal_galv', .42, .5, y0 + 1.2, x, (y0 + 1.2) / 2 + .2, z, { seg: 14 }); for (let i = 0; i < 10; i++) k.cyl('metal_dark', .03, .03, .1, x + Math.cos(i * .628) * .68, .5, z + Math.sin(i * .628) * .68, { seg: 6 });
      k.geo(GT.decalMat('rust_run'), new T.PlaneGeometry(.7, 3), { x: x + .1, y: y0 - 1.5, z: z + .47 }); k.geo(GT.decalMat('rust_run'), new T.PlaneGeometry(.6, 2.4), { x: x - .46, y: y0 - 1.4, z: z, ry: -PI / 2 });
      k.push(x, y0 + 1.2, z, { ry }); k.box('metal_galv', W * .96, .3, .5, 0, .15, 0, { bevel: .02 }); for (let i = -3; i <= 3; i++) { k.box('metal_galv', .12, Hh + .3, .12, i * W / 6.3, .3 + Hh / 2, 0); k.box('metal_galv', .08, .08, 1.5, i * W / 6.3, .26, 0); }
      for (const f of [-1, 1]) { k.box('metal_dark', W + .3, .16, .08, 0, .34, f * .34); k.box('metal_dark', W + .3, .16, .08, 0, .38 + Hh, f * .34); k.box('metal_dark', .16, Hh + .2, .08, -W / 2 - .07, .36 + Hh / 2, f * .34); k.box('metal_dark', .16, Hh + .2, .08, W / 2 + .07, .36 + Hh / 2, f * .34); k.box('wood_painted', W, Hh, .05, 0, .36 + Hh / 2, f * .3);
        k.box('metal_galv', W + .4, .04, .7, 0, .1, f * 1.0); for (let i = -4; i <= 4; i++) { k.cyl('metal_galv', .018, .018, 1.0, i * W / 8, .62, f * 1.33, { seg: 5 }); } k.cyl('metal_galv', .02, .02, W + .4, 0, 1.12, f * 1.33, { seg: 5, rz: PI / 2 });
        for (let i = -2; i <= 2; i++) { const lx = i * W / 5; k.tube('metal_dark', [[lx, .2, f * .5], [lx, .25, f * 1.9], [lx, .6, f * 2.3], [lx, .9, f * 2.25]], .025, { seg: 5, steps: 8 }); k.box('metal_dark', .5, .14, .26, lx, .98, f * 2.2, { rx: -f * .7, bevel: .02 }); } }
      k.pop();
      for (const f of [-1, 1]) { SL.vquad(x + nx * f * .33, y0 + 1.56 + Hh / 2, z + nz * f * .33, W, Hh, ry + (f > 0 ? 0 : PI), sgUV(f > 0 ? cA : cB)); for (let i = -2; i <= 2; i++) { const lx = i * W / 5; X.LAMP.box(x + c * lx + nx * f * 2.14, y0 + 1.2 + 1.04, z - s * lx + nz * f * 2.14, .4, .04, .2, ry); } }
      GT.world.addPost(x, z, .55, 14, 'billboard'); };
    billboard(40, 37, PI, 'bbRadio', 'bbLaw', 9); billboard(120, 18, -PI / 2, 'bbGator', 'bbRadio', 8); billboard(30, -147, PI / 2 + .25, 'bbLaw', 'bbGator', 8.5);
    GT.world.anchor('billboardHero', { x: 40, z: 37, h: PI });
    // ---- bus stop shelter (east side, between station and motel)
    { const z0 = 34.6, x0 = 10.25, fr = 'metal_dark'; k.box('concrete_stained', 2.3, .14, 4.6, 11.25, .07 + .04, z0, { bevel: .015 });
      for (const [ax, az] of [[0, -1.9], [0, 1.9], [1.75, -1.9], [1.75, 1.9]]) { k.box(fr, .07, 2.45, .07, x0 + .15 + ax, 1.4, z0 + az, { bevel: .008 }); k.box(fr, .16, .02, .16, x0 + .15 + ax, .19, z0 + az); }
      k.box('metal_painted_white', 2.5, .07, 4.4, x0 + 1.0, 2.66, z0, { rz: -.05, bevel: .02 }); k.box(fr, 2.56, .12, .05, x0 + 1.0, 2.6, z0 - 2.2, { rz: -.05 }); k.box(fr, 2.56, .12, .05, x0 + 1.0, 2.6, z0 + 2.2, { rz: -.05 }); k.box(fr, .05, .12, 4.45, x0 - .26, 2.66, z0); k.box(fr, .05, .12, 4.45, x0 + 2.27, 2.54, z0);
      for (const zz of [-1.26, 0, 1.26]) { k.box('glass_dirty', .012, 1.75, 1.2, x0 + 1.9, 1.45, z0 + zz); k.box(fr, .03, .04, 1.24, x0 + 1.9, .56, z0 + zz); k.box(fr, .03, .04, 1.24, x0 + 1.9, 2.34, z0 + zz); }
      k.box(fr, 1.5, 1.95, .14, x0 + 1.02, 1.42, z0 + 1.9, { bevel: .015 }); SL.vquad(x0 + 1.02, 1.42, z0 + 1.9 - .072, 1.3, 1.78, PI, sgUV('busAd')); SL.vquad(x0 + 1.02, 1.42, z0 + 1.9 + .072, 1.3, 1.78, 0, sgUV('busAd'));
      for (const s of [-1, 1]) k.box(fr, .05, .44, .3, x0 + 1.5, .36, z0 + s * 1.1 - .3); for (let i = 0; i < 4; i++) k.box('aluminium_brushed', .09, .025, 2.6, x0 + 1.36 + i * .1, .59, z0 - .3, { bevel: .006 }); k.box('aluminium_brushed', .025, .3, 2.6, x0 + 1.75, .82, z0 - .3, { bevel: .006 });
      k.cyl('metal_dark', .24, .21, .8, x0 + .5, .5 + .1, z0 - 2.9, { seg: 12 }); k.cyl('metal_dark', .26, .26, .05, x0 + .5, 1.02, z0 - 2.9, { seg: 12 }); K.g.decal('gum_spots', 2.2, 3.4, x0 + .9, .185, z0, 0);
      GT.world.addBox(x0 + 1.7, z0 - 2.2, x0 + 2.1, z0 + 2.2, 2.7, 'busstop'); GT.world.addBox(x0, z0 + 1.8, x0 + 2, z0 + 2.0, 2.7, 'busstop'); GT.world.anchor('busStop', { x: x0 + .9, z: z0, h: -PI / 2 }); }
    // ---- hydrants, mailboxes, news racks, trash cans
    const hydrant = (x, z) => { const y = classify(x, z)[0], m = 'metal_painted_yellow'; k.cyl('concrete_stained', .22, .24, .06, x, y + .02, z, { seg: 10 }); k.cyl(m, .13, .13, .03, x, y + .07, z, { seg: 10 }); k.cyl(m, .085, .095, .5, x, y + .33, z, { seg: 10 }); k.cyl(m, .115, .115, .035, x, y + .58, z, { seg: 10 }); k.sphere(m, .1, x, y + .6, z, { seg: 10, seg2: 6, s: [1, .8, 1] }); k.cyl('metal_galv', .03, .03, .06, x, y + .7, z, { seg: 5 });
      for (const s of [-1, 1]) { k.cyl(m, .05, .05, .09, x, y + .44, z + s * .12, { seg: 8, rx: PI / 2 }); k.cyl('metal_painted_red', .058, .058, .035, x, y + .44, z + s * .175, { seg: 8, rx: PI / 2 }); } k.cyl(m, .068, .068, .1, x - .12, y + .4, z, { seg: 8, rz: PI / 2 }); k.cyl('metal_painted_red', .078, .078, .04, x - .185, y + .4, z, { seg: 8, rz: PI / 2 });
      for (let i = 0; i < 6; i++) k.cyl('metal_galv', .012, .012, .02, x + Math.cos(i * 1.047) * .11, y + .09, z + Math.sin(i * 1.047) * .11, { seg: 5 }); K.g.decal('water_stain', .9, .9, x - .1, y + .012, z, 0); GT.world.addPost(x, z, .14, .8, 'hydrant'); };
    for (const [x, z] of [[10.5, -2], [10.5, 104], [10.5, -96], [-8.3, 130], [144.9, -70], [144.9, 90]]) hydrant(x, z);
    const mailbox = (x, z, ry) => { const y = classify(x, z)[0], m = 'metal_painted_blue'; k.push(x, y, z, { ry }); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(m, .05, .3, .05, a * .2, .15, b * .2); k.box(m, .52, .62, .52, 0, .6, 0, { bevel: .03 }); const g = new T.CylinderGeometry(.26, .26, .52, 12, 1, false, 0, PI); g.rotateZ(PI / 2); k.geo(m, g, { x: 0, y: .91, z: 0 }); k.box(m, .4, .03, .08, 0, 1.0, .27, { bevel: .01 }); k.box('metal_galv', .2, .02, .03, 0, 1.03, .3); k.pop();
      S.vquad(x + Math.sin(ry) * .265, y + .62, z + Math.cos(ry) * .265, .44, .22, ry, sgUV('mail')); GT.world.addPost(x, z, .3, 1.2, 'mailbox'); };
    mailbox(10.6, 27.6, -PI / 2); mailbox(10.6, -128, -PI / 2);
    const newsRack = (x, z, ry, cell, hex) => { const y = classify(x, z)[0]; V.setCol(0x2a2c2e); V.box(x, y + .2, z, .12, .4, .12, ry); V.box(x, y + .02, z, .4, .04, .36, ry); V.setCol(hex); V.box(x, y + .78, z, .46, .78, .4, ry); S.vquad(x + Math.sin(ry) * .203, y + .78, z + Math.cos(ry) * .203, .44, .74, ry, sgUV(cell)); GT.world.addPost(x, z, .25, 1.2, 'newsrack'); };
    newsRack(10.55, 29.2, -PI / 2, 'news', 0xa3242c); newsRack(10.55, 29.75, -PI / 2, 'news2', 0x2a5a9a); newsRack(10.55, 30.3, -PI / 2 + .1, 'news', 0xa3242c); newsRack(-9.5, -18, PI / 2, 'news2', 0x2a5a9a);
    for (const [x, z] of [[-9.4, -38], [-9.4, 55], [-9.4, 115], [-9.4, -131], [10.6, 106], [10.6, -100]]) { const y = classify(x, z)[0]; k.cyl('metal_dark', .25, .22, .82, x, y + .43, z, { seg: 12 }); k.cyl('metal_dark', .27, .27, .05, x, y + .86, z, { seg: 12 }); k.cyl('rubber', .2, .2, .02, x, y + .885, z, { seg: 10 }); GT.world.addPost(x, z, .27, .9, 'trash'); }
    // ---- fences, guardrail
    const fence = X.fence = (x0, z0, x1, z1, h, o) => { o = o || {}; h = h || 2.0; const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 3)), ry = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / n), z = lerp(z0, z1, i / n); k.cyl('metal_galv', .03, .03, h + .1, x, h / 2, z, { seg: 5 }); if (o.barbed) k.box('metal_galv', .025, .4, .025, x, h + .2, z, { rz: ry === 0 ? .6 : 0, rx: ry !== 0 ? .6 : 0 }); }
      k.push((x0 + x1) / 2, 0, (z0 + z1) / 2, { ry }); k.cyl('metal_galv', .02, .02, len, 0, h, 0, { seg: 5, rx: PI / 2 }); k.cyl('metal_galv', .012, .012, len, 0, .08, 0, { seg: 4, rx: PI / 2 }); if (o.barbed) for (let j = 0; j < 3; j++) k.cyl('metal_galv', .006, .006, len, .08 + j * .07, h + .14 + j * .1, 0, { seg: 3, rx: PI / 2 }); k.pop();
      X.CH.quad4([x0, .06, z0], [x1, .06, z1], [x1, h, z1], [x0, h, z0], [[0, 0], [len / .09, 0], [len / .09, h / .09], [0, h / .09]], false);
      if (o.slats) { V.setCol(o.slats); V.box((x0 + x1) / 2, h / 2 + .05, (z0 + z1) / 2, .012, h - .12, len - .1, ry); }
      if (o.collide !== false) GT.world.addBox(Math.min(x0, x1) - .08, Math.min(z0, z1) - .08, Math.max(x0, x1) + .08, Math.max(z0, z1) + .08, h, 'fence'); };
    const guardrail = (x0, z0, x1, z1) => { const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 3.8), ry = Math.atan2(x1 - x0, z1 - z0); for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / n), z = lerp(z0, z1, i / n); k.box(i % 5 === 2 ? 'metal_rust' : 'metal_galv', .1, .82, .16, x + Math.cos(ry) * .09, .36, z - Math.sin(ry) * .09, { ry }); k.box('wood_plank', .16, .3, .2, x + Math.cos(ry) * .0, .56, z, { ry }); }
      k.push((x0 + x1) / 2, 0, (z0 + z1) / 2, { ry }); for (let a = -len / 2; a < len / 2 - .01; a += 30) { const l = Math.min(30, len / 2 - a), zc = a + l / 2; k.box('metal_galv', .014, .31, l, -.1, .56, zc); k.box('metal_galv', .045, .075, l, -.125, .655, zc); k.box('metal_galv', .045, .075, l, -.125, .465, zc); } k.pop();
      GT.world.addBox(Math.min(x0, x1) - .15, Math.min(z0, z1) - .15, Math.max(x0, x1) + .15, Math.max(z0, z1) + .15, .8, 'guardrail'); };
    guardrail(BX + CW + 1.5, -166.2, BX + CW + 1.5, 166.2);
    for (const s of [-1, 1]) { fence(10.25, s * 167.0, 156.2, s * 167.0, 2.0); fence(10.25, s * 169.6, 10.25, s * 189.2, 2.0);
      // culvert headwalls where the canal ends
      k.box('concrete_stained', 13, 1.9, .5, 163.4, -.4, s * 164.7, { bevel: .03 }); k.cyl('metal_dark', .7, .7, .3, 163.4, -.75, s * 164.5, { seg: 14, rx: PI / 2 }); }
    // ---- road closures at both dead ends
    const closure = (zc, s) => { const zb = zc + s * 2.2;
      for (let x = -9.0; x < 10; x += 3.1) { k.box('concrete_stained', 3.0, .34, .62, x, .17, zb, { bevel: .04 }); k.box('concrete_stained', 3.0, .5, .3, x, .56, zb, { bevel: .05 }); k.box('concrete_stained', 3.0, .2, .46, x, .36, zb, { bevel: .08 }); if (r() < .6) k.geo(GT.decalMat('grime_streak'), new T.PlaneGeometry(1.2, .6), { x: x + rr(-.6, .6), y: .5, z: zb - s * .16, ry: s > 0 ? PI : 0 }); }
      GT.world.addBox(-10.5, zb - .4, 10.4, zb + .4, 1, 'closure');
      for (const bx of [-4.6, 0, 4.6]) { const bz = zc - s * (bx === 0 ? .6 : 0); for (const sx of [-1, 1]) { k.box('metal_galv', .05, 1.55, .05, bx + sx * 1.15, .78, bz, { bevel: .005 }); k.box('metal_galv', .05, .05, 1.3, bx + sx * 1.15, .03, bz); k.box('metal_galv', .04, .04, .9, bx + sx * 1.15, .4, bz + .3, { rx: .7 }); k.box('metal_galv', .04, .04, .9, bx + sx * 1.15, .4, bz - .3, { rx: -.7 }); }
          for (let i = 0; i < 3; i++) { const u = sgUV('stripe'); V.setCol(0xb8b4aa); V.box(bx, .62 + i * .4, bz, 2.5, .2, .025); S.vquad(bx, .62 + i * .4, bz - .014, 2.5, .2, PI, i & 1 ? [u[2], u[1], u[0], u[3]] : u); S.vquad(bx, .62 + i * .4, bz + .014, 2.5, .2, 0, i & 1 ? u : [u[2], u[1], u[0], u[3]]); }
          for (const sx of [-1, 1]) { V.setCol(0xd9a514); V.box(bx + sx * 1.15, 1.66, bz, .16, .2, .1); X.LENS.disc(bx + sx * 1.15, 1.67, bz - s * .052, .07, s > 0 ? PI : 0, lensUV(sx > 0 ? 8 : 9)[0], .5, 10); }
          GT.world.addBox(bx - 1.3, bz - .2, bx + 1.3, bz + .2, 1.6, 'barricade'); }
      S.vquad(0, 1.95, zc - s * .63, 1.5, 1.0, s > 0 ? PI : 0, sgUV('closed')); V.setCol(0x9a9c9c); V.box(0, 1.95, zc - s * .6, 1.5, 1.0, .02);
      const du = sgUV('drum'); for (const [x, dz] of [[-6.6, 3.2], [-3.3, 4.6], [3.2, 4.6], [6.6, 3.2], [-7, 9], [7, 9]]) { S.cyl(x, 0, zc - s * dz, .27, .22, .95, 12, du); V.setCol(0x1a1a1a); V.cyl(x, 0, zc - s * dz, .34, .3, .09, 12); GT.world.addPost(x, zc - s * dz, .3, 1, 'drum'); }
      for (let i = 0; i < 9; i++) { const x = -6.8 + i * 1.7 + rr(-.2, .2), z = zc - s * (11 + Math.abs(i - 4) * 1.4 + rr(-.3, .3)); V.setCol(0x1c1c1c); V.box(x, .015, z, .36, .03, .36, rr(0, 1)); V.setCol(0xd65a1a); V.cyl(x, .03, z, .13, .025, .68, 10); V.setCol(0xe6e2d8); V.cyl(x, .34, z, .084, .058, .16, 10, undefined, false); }
      GT.world.anchor(s > 0 ? 'roadClosedN' : 'roadClosedS', { x: 0, z: zc, h: s > 0 ? PI : 0 }); };
    closure(186.6, 1); closure(-186.6, -1);
  }

  /* ================================================================== filler lots */
  const CARS = { sedan: { p: [[-2.25, .3], [-2.28, .62], [-2.05, .78], [-.95, .86], [-.35, 1.32], [.95, 1.36], [1.62, .98], [2.2, .92], [2.28, .6], [2.22, .3]], gl: [-.62, 1.3, 1.12, .38], wb: 1.38 },
    suv: { p: [[-2.3, .36], [-2.33, .78], [-2.1, .98], [-1.1, 1.04], [-.62, 1.62], [1.9, 1.64], [2.26, 1.06], [2.3, .6], [2.25, .36]], gl: [-.75, 2.0, 1.36, .44], wb: 1.42 },
    pickup: { p: [[-2.6, .4], [-2.63, .8], [-2.4, 1.0], [-1.25, 1.04], [-.82, 1.64], [.35, 1.64], [.45, 1.04], [2.6, 1.04], [2.62, .62], [2.55, .4]], gl: [-.9, .38, 1.36, .44], wb: 1.7 } };
  function proxyCar(k, x, z, ry, kind, paint) { const d = CARS[kind], sh = new T.Shape(); d.p.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])); const g = new T.ExtrudeGeometry(sh, { depth: 1.62, bevelEnabled: true, bevelThickness: .08, bevelSize: .07, bevelSegments: 2, curveSegments: 1 }); g.translate(0, 0, -.81);
    k.push(x, 0, z, { ry: ry + PI / 2 }); k.geo(paint, g); const gx0 = d.gl[0], gx1 = d.gl[1], gy = d.gl[2], gh = d.gl[3];
    for (const s of [-1, 1]) { k.box('glass_tint', gx1 - gx0, gh, .02, (gx0 + gx1) / 2 + .12, gy, s * .885); for (const wx of [-d.wb, d.wb]) { k.cyl('rubber', .33, .33, .22, wx, .33, s * .8, { seg: 14, rx: PI / 2 }); k.cyl('aluminium_brushed', .2, .2, .225, wx, .33, s * .805, { seg: 8, rx: PI / 2 }); k.box('rubber', .86, .1, .04, wx, .68, s * .9); } }
    k.box('glass_tint', .62, .5, 1.5, gx0 - .08, gy + .0, 0, { rz: -.62 }); if (kind !== 'pickup') k.box('glass_tint', .62, .42, 1.5, gx1 + .22, gy + .02, 0, { rz: .75 }); else k.box('glass_tint', .03, .36, 1.4, gx1 + .28, gy + .05, 0);
    k.box('rubber', .1, .16, 1.7, d.p[0][0] - .06, .46, 0, { bevel: .03 }); k.box('rubber', .1, .16, 1.7, d.p[d.p.length - 1][0] + .09, .46, 0, { bevel: .03 }); for (const s of [-1, 1]) { k.box('metal_painted_white', .05, .12, .3, d.p[1][0] - .05, .68, s * .6); k.box('metal_painted_red', .05, .12, .3, d.p[d.p.length - 2][0] + .07, .74, s * .62); }
    k.pop(); GT.world.addBox(x - 1.4, z - 1.4, x + 1.4, z + 1.4, 1.5, 'parked'); }
  function buildLots(X) {
    const { B, K, M } = X, k = K.p, S = X.S, SL = X.SL, V = X.V, r = GT.rng('lots'), rr = (a, b) => a + (b - a) * r(), fence = X.fence, WIN = X.WIN;
    const catenary = (a, b, sag, n) => { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) - sag * 4 * t * (1 - t), lerp(a[2], b[2], t)]); } return pts; };
    const pennants = (a, b) => { const pts = catenary(a, b, Math.hypot(b[0] - a[0], b[2] - a[2]) * .06, 40), cols = [0xb3242c, 0xd9b520, 0x2a5a9a, 0xe6e2d6, 0x2a8a5a]; k.tube('rubber', catenary(a, b, Math.hypot(b[0] - a[0], b[2] - a[2]) * .06, 8), .008, { seg: 3, steps: 16 });
      for (let i = 0; i < pts.length - 1; i++) { const p = pts[i], q = pts[i + 1]; V.setCol(cols[i % cols.length], rr(.8, 1)); V.card(p, [lerp(p[0], q[0], .8), lerp(p[1], q[1], .8), lerp(p[2], q[2], .8)], [lerp(p[0], q[0], .4) + rr(-.05, .05), p[1] - .42, lerp(p[2], q[2], .4) + rr(-.05, .05)], [lerp(p[0], q[0], .4), p[1] - .42, lerp(p[2], q[2], .4)], 0, 0, 1, 1); } };
    const bulbs = (a, b, n) => { const d = Math.hypot(b[0] - a[0], b[2] - a[2]), pts = catenary(a, b, d * .05, n || Math.round(d / .7)); k.tube('rubber', catenary(a, b, d * .05, 8), .009, { seg: 3, steps: 16 }); for (const p of pts) X.WIN.blob(p[0], p[1] - .05, p[2], .035, .045, .035, [0, 0, 1, 1], 5, 3); };
    // ---------------- lotC west: PELICAN MOTORS used-car lot
    { for (let z = -150; z <= -54; z += 3.2) { k.cyl('wood_plank', .07, .08, .8, 14.7, .38, z, { seg: 7 }); k.cyl('metal_galv', .085, .085, .03, 14.7, .78, z, { seg: 7 }); } k.tube('metal_galv', catenary([14.7, .62, -150], [14.7, .62, -54], 0, 30).map((p, i) => [p[0], p[1] - (i % 2 ? .1 : 0), p[2]]), .014, { seg: 4, steps: 60 }); GT.world.addBox(14.55, -150, 14.85, -54, .8, 'carlot-fence');
      const lp = []; for (const x of [18, 44, 70]) for (const z of [-146, -102, -58]) { k.cyl('concrete_stained', .22, .24, .7, x, .35, z, { seg: 10 }); k.cyl('metal_painted_white', .06, .09, 7.4, x, 4.3, z, { seg: 8 }); k.box('metal_painted_white', 1.3, .07, .07, x, 7.9, z); for (const s of [-1, 1]) { k.box('metal_dark', .46, .14, .34, x + s * .6, 7.82, z, { rz: s * .25, bevel: .02 }); X.LAMP.box(x + s * .62, 7.74, z, .38, .02, .26); } X.pools.push([x, .018, z, 13, 13, 1]); lp.push([x, 7.3, z]); GT.world.addPost(x, z, .24, 8, 'lotlight'); }
      for (let i = 0; i < 3; i++) { pennants(lp[i * 3], lp[i * 3 + 1]); pennants(lp[i * 3 + 1], lp[i * 3 + 2]); } pennants(lp[0], lp[3]); pennants(lp[3], lp[6]); bulbs(lp[1], lp[4]); bulbs(lp[4], lp[7]); bulbs(lp[2], lp[5]); bulbs(lp[5], lp[8]); pennants([18, 7.3, -146], [14.7, .9, -150]); pennants([18, 7.3, -58], [14.7, .9, -54]);
      // office trailer
      const ox = 60, oz = -60.5; k.box('corrugated_metal', 12.2, .55, 3.5, ox, .3, oz); k.box('metal_painted_white', 12, 2.7, 3.4, ox, 1.95, oz, { bevel: .02 }); k.box('metal_galv', 12.3, .1, 3.7, ox, 3.35, oz, { bevel: .02 });
      for (const wx of [-4.2, -1.4, 3.6]) { k.box('aluminium_brushed', 1.5, 1.1, .06, ox + wx, 2.1, oz - 1.71, { bevel: .01 }); k.box('glass_tint', 1.36, .96, .07, ox + wx, 2.1, oz - 1.715); } WIN.box(ox - 1.4, 2.1, oz - 1.755, 1.3, .9, .01);
      k.box('metal_painted_white', .95, 2.05, .06, ox + 1.2, 1.63, oz - 1.71, { bevel: .01 }); k.cyl('aluminium_brushed', .03, .03, .08, ox + 1.55, 1.6, oz - 1.76, { seg: 8, rx: PI / 2 }); k.box('wood_plank', 2.2, .1, 1.3, ox + 1.2, .55, oz - 2.4, { bevel: .01 }); for (let i = 0; i < 3; i++) k.box('wood_plank', 1.2, .08, .3, ox + 1.2, .14 + i * .14, oz - 3.5 + i * .3, { bevel: .01 }); for (const s of [-1, 1]) k.box('wood_plank', .08, .95, .08, ox + 1.2 + s * 1.05, 1.05, oz - 3.0);
      k.box('plastic_grey', .7, .5, .5, ox - 4.2, 2.1, oz - 1.95, { bevel: .03 }); k.geo(GT.decalMat('grime_streak'), new T.PlaneGeometry(.6, 1), { x: ox - 4.2, y: 1.3, z: oz - 1.712, ry: PI }); k.geo(GT.decalMat('rust_run'), new T.PlaneGeometry(.5, 1.2), { x: ox + 4.8, y: 2.5, z: oz - 1.712, ry: PI });
      S.vquad(ox - 2.6, 3.05, oz - 1.72, 3.0, .7, PI, sgUV('office')); for (const s of [-1, 1]) k.box('metal_galv', .1, 2.2, .1, ox + s * 4.2, 4.4, oz); SL.vquad(ox, 4.9, oz - .06, 9.4, 2.7, PI, sgUV('bbMotors')); SL.vquad(ox, 4.9, oz + .06, 9.4, 2.7, 0, sgUV('bbMotors')); k.box('metal_dark', 9.5, 2.8, .1, ox, 4.9, oz);
      GT.world.addBox(ox - 6.1, oz - 1.75, ox + 6.1, oz + 1.75, 3.4, 'office');
      // cars: real ones in the front row when the vehicles module is there, generic proxies otherwise
      const paints = [GT.mat('car_paint', { color: 0x8a2a2c }), GT.mat('car_paint', { color: 0xcfcdc4 }), GT.mat('car_paint', { color: 0x2c3a4c })], kinds = ['sedan', 'suv', 'sedan', 'pickup', 'sedan', 'suv']; let real = 0;
      const place = (x, z, h, i) => { if (GT.vehicles && GT.vehicles.make && real < 1 && x < 24 && i === 2) { try { const v = GT.vehicles.make('sedan', { seed: 7, color: 0x9aa1a6 }); const o = v && (v.isObject3D ? v : v.group || v.mesh || v.object); if (o && o.isObject3D) { o.position.set(x, 0, z); o.rotation.y = h; X.root.add(o); real++; GT.world.addBox(x - 1.4, z - 1.4, x + 1.4, z + 1.4, 1.5, 'parked'); return; } } catch (e) { /* fall back to a proxy */ } }
        proxyCar(k, x, z, h, kinds[(i * 7 + (x | 0)) % kinds.length], paints[(i * 5 + (x | 0) * 3) % paints.length]); };
      let ci = 0; for (let z = -144; z <= -70; z += 5.6) { if (r() < .88) place(20.2, z, -PI / 2 + rr(-.04, .04), ci++); if (r() < .7) place(31, z, -PI / 2 + rr(-.04, .04), ci++); } for (let z = -144; z <= -74; z += 7) { if (r() < .6) place(50, z, PI / 2 + rr(-.3, .3), ci++); } for (const x of [40, 46, 52]) place(x, -70.5 + rr(-.3, .3), PI + rr(-.05, .05), ci++);
      K.g.decal('oil_stain', 3, 3, 26, .012, -100, 1); K.g.decal('oil_stain', 2.4, 2.4, 40, .012, -128, 2); K.g.decal('tire_marks', 2.2, 7, 38, .013, -86, .6); K.g.decal('crack', 5, 5, 56, .011, -112, 0); K.g.decal('crack', 4, 4, 30, .011, -75, 2); }
    // ---------------- lotC east: STOW-AWAY self storage
    { const dm = GT.mat('corrugated_metal', { color: 0xc8702c }); fence(76, -151, 141, -151, 2.2, { barbed: 1 }); fence(76, -53.5, 141, -53.5, 2.2, { barbed: 1 }); fence(141, -151, 141, -53.5, 2.2, { barbed: 1 }); fence(76, -151, 76, -112, 2.2, { barbed: 1 }); fence(76, -104, 76, -53.5, 2.2, { barbed: 1 });
      k.box('metal_galv', .08, 2.2, 7.6, 76.4, 1.2, -100, {}); X.CH.quad4([76.42, .2, -103.8], [76.42, .2, -96.2], [76.42, 2.2, -96.2], [76.42, 2.2, -103.8], [[0, 0], [84, 0], [84, 22], [0, 22]], false); k.box('metal_painted_yellow', .2, 1.3, .2, 75.6, .65, -111.5, { bevel: .02 }); k.box('plastic_grey', .22, .3, .12, 75.6, 1.25, -111.4, { bevel: .01 });
      for (const zc of [-141, -119.5, -98, -76.5, -60]) { const x0 = zc === -60 ? 100 : 82, x1 = 137, w = x1 - x0, cx = (x0 + x1) / 2, d = zc === -60 ? 6 : 9;
        k.box('stucco_cream', w, 3.0, d, cx, 1.5, zc, { bevel: .02 }); k.box('corrugated_metal', w + .7, .1, d / 2 + .5, cx, 3.22, zc - d / 4, { rx: -.07 }); k.box('corrugated_metal', w + .7, .1, d / 2 + .5, cx, 3.22, zc + d / 4, { rx: .07 }); k.box('metal_galv', w + .7, .14, .1, cx, 3.06, zc - d / 2 - .3); k.box('metal_galv', w + .7, .14, .1, cx, 3.06, zc + d / 2 + .3);
        for (const s of [-1, 1]) { let i = 0; for (let x = x0 + 2; x < x1 - 1.5; x += 3.4, i++) { k.box(dm, 2.7, 2.35, .06, x, 1.2, zc + s * (d / 2 + .01)); k.box('metal_galv', 2.86, .1, .1, x, 2.42, zc + s * (d / 2 + .02)); k.box('metal_dark', .12, .05, .05, x, .5, zc + s * (d / 2 + .06)); if (i % 3 === 1) { k.box('metal_dark', .26, .12, .16, x + 1.7, 2.7, zc + s * (d / 2 + .09), { bevel: .02 }); WIN.box(x + 1.7, 2.63, zc + s * (d / 2 + .1), .2, .02, .12); X.pools.push([x + 1.7, .016, zc + s * (d / 2 + 2), 4, 3.4, .6]); }
            if (r() < .3) k.geo(GT.decalMat(r() < .5 ? 'rust_run' : 'grime_streak'), new T.PlaneGeometry(.8, 1.6), { x: x + rr(-1, 1), y: 1.6, z: zc + s * (d / 2 + .045), ry: s > 0 ? 0 : PI }); }
          k.cyl('metal_galv', .05, .05, 3, x0 + .3, 1.5, zc + s * (d / 2 + .07), { seg: 6 }); k.cyl('metal_galv', .05, .05, 3, x1 - .3, 1.5, zc + s * (d / 2 + .07), { seg: 6 }); }
        for (const [bx, bz] of [[x0 - .4, zc - d / 2], [x0 - .4, zc + d / 2], [x1 + .4, zc - d / 2], [x1 + .4, zc + d / 2]]) k.cyl('metal_painted_yellow', .09, .09, 1.0, bx, .5, bz, { seg: 8 });
        GT.world.addBox(x0, zc - d / 2, x1, zc + d / 2, 3.3, 'storage'); }
      k.box('stucco_cream', 12, 3.4, 7, 88, 1.7, -60, { bevel: .02 }); k.box('rubber', 12.4, .16, 7.4, 88, 3.48, -60); k.box('glass_tint', 3, 1.5, .06, 86, 1.7, -63.52); k.box('aluminium_brushed', 1, 2.1, .06, 90.5, 1.07, -63.52); WIN.box(86, 1.7, -63.56, 2.8, 1.3, .01); GT.world.addBox(82, -63.5, 94, -56.5, 3.5, 'storage-office');
      SL.vquad(81.96, 2.1, -141, 8.6, 1.35, -PI / 2, sgUV('storage')); for (const s of [-1, 1]) k.cyl('metal_galv', .1, .12, 7.5, 79, 3.75, -148.5 + s * 3.4, { seg: 8 }); k.box('metal_dark', .2, 1.5, 9.2, 79, 6.6, -148.5); SL.vquad(78.89, 6.6, -148.5, 9, 1.4, -PI / 2, sgUV('storage')); SL.vquad(79.11, 6.6, -148.5, 9, 1.4, PI / 2, sgUV('storage'));
      K.g.decal('oil_stain', 3, 3, 110, .012, -130, 1); K.g.decal('crack', 6, 6, 120, .011, -108, 1); K.g.decal('tire_marks', 2.2, 8, 96, .012, -87, PI / 2); K.g.decal('water_stain', 5, 5, 128, .012, -87, 0); }
    fence(14.5, -52.2, 75.5, -52.2, 1.9);
    // ---------------- lotD: vacant sandy lot, taco truck, mobile homes behind a fence
    { const tx = 110, tz = -22; k.push(tx, -.2, tz, { ry: .18 });
      k.box('metal_dark', 6.6, .22, 1.0, 0, .62, 0); for (const wx of [-2.2, 2.4]) for (const s of [-1, 1]) { k.cyl('rubber', .42, .42, .28, wx, .42, s * 1.0, { seg: 14, rx: PI / 2 }); k.cyl('metal_painted_white', .22, .22, .29, wx, .42, s * 1.0, { seg: 10, rx: PI / 2 }); }
      k.box('metal_painted_white', 4.9, 2.35, 2.3, -.9, 2.0, 0, { bevel: .04 }); k.box('metal_painted_white', 1.7, 1.75, 2.1, 2.5, 1.62, 0, { bevel: .1 }); k.box('glass_tint', .08, .8, 1.8, 3.3, 2.0, 0, { rz: -.25 }); k.box('metal_painted_white', .9, .7, 1.9, 3.5, 1.1, 0, { bevel: .08 }); k.box('rubber', .12, .3, 2.1, 4.0, .75, 0, { bevel: .03 });
      for (const s of [-1, 1]) { k.box('glass_tint', .7, .6, .03, 2.6, 2.05, s * 1.06); k.box('metal_painted_white', .06, .14, .22, 3.95, 1.05, s * .75); }
      k.box('metal_dark', 2.6, 1.0, .04, -1.0, 2.25, -1.16); k.box('aluminium_brushed', 2.8, .05, .5, -1.0, 1.72, -1.4, { bevel: .01 }); WIN.box(-1.0, 2.5, -1.14, 2.4, .4, .01); k.box('metal_galv', .04, .04, 1.3, -2.3, 2.95, -1.8, { rx: -.35 }); k.box('metal_galv', .04, .04, 1.3, .3, 2.95, -1.8, { rx: -.35 });
      k.box('plastic_grey', .7, .5, .6, -2.6, 3.4, .3, { bevel: .04 }); k.cyl('metal_galv', .1, .1, .5, .6, 3.4, .5, { seg: 8 }); k.cyl('metal_galv', .17, .1, .12, .6, 3.7, .5, { seg: 8 }); k.pop();
      const c = Math.cos(.18), s = Math.sin(.18), P = (lx, lz) => [tx + lx * c + lz * s, tz - lx * s + lz * c]; let p = P(-1.0, -1.85); SL.box(p[0], 2.92, p[1], 2.9, .04, 1.35, .18, sgUV('awning')); p = P(-2.2, -1.165); SL.vquad(p[0], 1.1, p[1], 2.2, .75, PI + .18, sgUV('taco')); p = P(-1.0, 1.165); SL.vquad(p[0], 2.0, p[1], 4.6, 1.55, .18, sgUV('taco'));
      p = P(.9, -3.2); k.box('wood_plank', .9, 1.3, .05, p[0], .66, p[1], { ry: .18, rx: .2 }); k.box('wood_plank', .9, 1.3, .05, p[0], .66, p[1] + .5, { ry: .18, rx: -.2 }); SL.vquad(p[0] + .02, .7, p[1] - .04, .8, 1.1, PI + .18, sgUV('menu'), -.2);
      const pa = [tx - 7, 3.4, tz - 7], pb = [tx + 5, 3.4, tz - 8]; for (const q of [pa, pb]) { k.cyl('wood_plank', .05, .06, 3.5, q[0], 1.75, q[2], { seg: 6 }); k.cyl('rubber', .2, .22, .2, q[0], .1, q[2], { seg: 8 }); } p = P(-3.2, -1.1); bulbs([p[0], 3.25, p[1]], pa); p = P(1.5, -1.1); bulbs([p[0], 3.25, p[1]], pb); bulbs(pa, pb); X.pools.push([tx - 1, .02, tz - 4.5, 8, 6, 1]);
      for (const [ax, az] of [[-3.5, -5.2], [.5, -6], [3.2, -4.6]]) { const q = [tx + ax, tz + az]; k.cyl('metal_painted_white', .5, .5, .04, q[0], .74, q[1], { seg: 14 }); k.cyl('metal_painted_white', .04, .04, .72, q[0], .37, q[1], { seg: 6 }); k.cyl('metal_painted_white', .26, .28, .03, q[0], .02, q[1], { seg: 10 }); for (let i = 0; i < 3; i++) { const a = i * 2.1 + ax, cx = q[0] + Math.cos(a) * .85, cz = q[1] + Math.sin(a) * .85; k.push(cx, 0, cz, { ry: -a + PI / 2 }); k.box('metal_painted_white', .42, .03, .42, 0, .44, 0, { bevel: .01 }); k.box('metal_painted_white', .42, .42, .03, 0, .68, -.2, { rx: -.12, bevel: .01 }); for (const [lx, lz] of [[-.18, -.18], [.18, -.18], [-.18, .18], [.18, .18]]) k.box('metal_painted_white', .035, .44, .035, lx, .22, lz); k.pop(); } }
      p = P(-4.6, .6); k.box('metal_painted_red', .7, .55, .5, p[0], .3, p[1], { bevel: .03 }); k.cyl('metal_painted_white', .16, .16, .5, p[0] + .9, .3, p[1], { seg: 10 }); k.sphere('metal_painted_white', .16, p[0] + .9, .55, p[1], { seg: 10, seg2: 6 });
      GT.world.addBox(tx - 3.8, tz - 1.6, tx + 4.4, tz + 1.6, 3.3, 'tacotruck'); GT.world.anchor('tacoTruck', { x: tx - 1, z: tz - 3, h: 0 });
      K.g.decal('tire_marks', 2.2, 9, tx + 9, .012, tz + 2, 1.3); K.g.decal('oil_stain', 2, 2, tx + 1, .012, tz - 2.5, 0);
      // wood fence + mobile homes
      for (let x = 99; x < 141; x += 2.4) { k.box('wood_plank', 2.36, 1.8, .03, x + 1.2, .92, 41 + Math.sin(x) * .02, { rz: (h2(x | 0, 3) - .5) * .02 }); k.box('wood_plank', .1, 1.9, .1, x, .95, 41.08, { bevel: .01 }); } GT.world.addBox(99, 40.9, 141, 41.2, 1.9, 'fence'); fence(98.3, 41, 98.3, 131.5, 1.8, { slats: 0x6a6f66 }); fence(141.6, -41, 141.6, 131.5, 1.8);
      const home = (cx, cz, hex, flip) => { const f = flip ? -1 : 1; k.box('corrugated_metal', 17.6, .62, 4.1, cx, .32, cz); k.box('metal_painted_white', 17.8, 2.5, 4.3, cx, 1.9, cz, { bevel: .03 }); k.box('metal_galv', 18.1, .12, 4.7, cx, 3.2, cz, { bevel: .03 }); k.box('metal_galv', 18, .1, 2.2, cx, 3.3, cz, { bevel: .03 });
        V.setCol(hex); V.box(cx, 1.15, cz, 17.84, .5, 4.34); V.box(cx, 2.95, cz, 17.84, .12, 4.34);
        for (const wx of [-6.6, -3.4, 2.2, 6.2]) { k.box('aluminium_brushed', 1.3, 1.0, .05, cx + wx, 2.15, cz - f * 2.16, { bevel: .008 }); k.box('glass_tint', 1.16, .86, .06, cx + wx, 2.15, cz - f * 2.165); if (wx === 2.2 || wx === -6.6) WIN.box(cx + wx, 2.15, cz - f * 2.2, 1.1, .8, .01); if (wx === -3.4) k.box('corrugated_metal', 1.5, .04, .7, cx + wx, 2.85, cz - f * 2.45, { rx: f * .45 }); k.box('aluminium_brushed', 1.3, 1.0, .05, cx + wx * .9, 2.15, cz + f * 2.16, { bevel: .008 }); k.box('glass_tint', 1.16, .86, .06, cx + wx * .9, 2.15, cz + f * 2.165); }
        k.box('metal_painted_white', .9, 2.0, .05, cx - .6, 1.65, cz - f * 2.17, { bevel: .01 }); k.box('wood_plank', 2.4, .1, 1.6, cx - .6, .6, cz - f * 3.0, { bevel: .01 }); for (let i = 0; i < 3; i++) k.box('wood_plank', 1.1, .08, .3, cx - .6, .15 + i * .15, cz - f * (4.4 - i * .3)); for (const sx of [-1, 1]) { k.box('wood_plank', .08, 1.0, .08, cx - .6 + sx * 1.15, 1.1, cz - f * 3.7); k.box('wood_plank', .06, .06, 1.5, cx - .6 + sx * 1.15, 1.6, cz - f * 3.0); }
        k.box('concrete_stained', 1, .1, 1, cx + 8.2, .05, cz - f * 3.2); k.box('plastic_grey', .8, .75, .8, cx + 8.2, .48, cz - f * 3.2, { bevel: .03 }); k.cyl('metal_dark', .3, .3, .02, cx + 8.2, .87, cz - f * 3.2, { seg: 10 }); k.cyl('metal_painted_white', .3, .3, 1.2, cx - 8.2, .55, cz + f * 2.9, { seg: 10, rz: PI / 2 }); for (const sx of [-1, 1]) k.sphere('metal_painted_white', .3, cx - 8.2 + sx * .6, .55, cz + f * 2.9, { seg: 10, seg2: 6 });
        k.sphere('plastic_grey', .34, cx + 5, 3.75, cz + f * 1.2, { seg: 10, seg2: 5, s: [1, .3, 1], rx: .8 }); k.cyl('metal_galv', .02, .02, .5, cx + 5, 3.5, cz + f * 1.2, { seg: 5 });
        for (const [ax, az] of [[3, 4.6], [8.6, 4.6], [3, 7.6], [8.6, 7.6]]) k.box('metal_galv', .08, 2.5, .08, cx + ax, 1.25, cz - f * az); k.box('corrugated_metal', 6.2, .06, 3.6, cx + 5.8, 2.55, cz - f * 6.1, { rx: f * .04 });
        k.geo(GT.decalMat('rust_run'), new T.PlaneGeometry(.8, 1.4), { x: cx + rr(-6, 6), y: 2.3, z: cz - f * 2.165, ry: f > 0 ? PI : 0 }); k.geo(GT.decalMat('grime_streak'), new T.PlaneGeometry(1, 1.6), { x: cx + rr(-6, 6), y: 2.2, z: cz - f * 2.166, ry: f > 0 ? PI : 0 });
        GT.world.addBox(cx - 8.9, cz - 2.2, cx + 8.9, cz + 2.2, 3.3, 'mobilehome'); };
      home(120, 54, 0x6fa8a0, 0); home(121, 74, 0xd9a58a, 1); home(119.5, 96, 0xc9bf8a, 0); home(121, 118, 0x8aa6c0, 1);
      for (let i = 0; i < 70; i++) { const x = rr(100, 140), z = rr(-40, 130), s = rr(.3, .8); if (GT.world.boxes.some(b => x > b.x0 - 1 && x < b.x1 + 1 && z > b.z0 - 1 && z < b.z1 + 1)) continue; X.veg.tuft(x, 0, z, s * 1.3, s, r() < .3 ? 'weed' : 'tuft', rr(.75, 1.05)); }
      for (const [x, z] of [[104, 44], [112, 43.5], [128, 44], [137, 43.6], [100, 64], [100, 88], [139.5, 86], [139.5, 108], [133, 129]]) X.veg.shrub(x, -.1, z, rr(1, 1.8), rr(.9, 1.5), rr(1, 1.8), r() < .5 ? 'flower' : 'grape', rr(.8, 1.05)); }
    // ---------------- lotE: backs of a strip mall
    { const x0 = 20, x1 = 136, z0 = 142.5, z1 = 151.4, w = x1 - x0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, h = 5.2;
      k.box('cinderblock', w, h, z1 - z0, cx, h / 2, cz, { bevel: .02 }); k.box('stucco_cream', w + .1, 1.0, .5, cx, h - .1, z1 + .05, { bevel: .03 }); k.box('rubber', w - .6, .1, z1 - z0 - .6, cx, h + .04, cz); k.box('metal_galv', w + .2, .12, .34, cx, h + .06, z0, { bevel: .01 });
      k.box('metal_painted_white', w, .12, 2.2, cx, 3.25, z1 + 1.1, { bevel: .03 }); for (let x = x0 + 1; x < x1; x += 7.6) k.box('metal_painted_white', .12, 3.2, .12, x, 1.6 + SWH, z1 + 2.1, { bevel: .01 });
      const mu = sgUV('mall'); for (let i = 0; i < 5; i++) { const sx = x0 + (i + .5) * w / 5, ua = lerp(mu[0], mu[2], i / 5), ub = lerp(mu[0], mu[2], (i + 1) / 5); SL.vquad(sx, 4.25, z1 + .32, 13, 1.25, 0, [ua, mu[1], ub, mu[3]]); k.box('glass_tint', w / 5 - 3, 2.5, .08, sx, 1.5, z1 + .02); for (let j = -3; j <= 3; j++) k.box('aluminium_brushed', .07, 2.6, .1, sx + j * (w / 5 - 3) / 6, 1.5, z1 + .04); WIN.box(sx, 2.95, z1 + .08, w / 5 - 3.2, .3, .01); X.pools.push([sx, SWH + .012, z1 + 1.2, 9, 1.3, .7]); }
      for (let i = 0; i < 12; i++) { const x = x0 + 5 + i * 9.6 + rr(-1, 1), big = i % 3 === 1; if (big) { k.box('corrugated_metal', 3.2, 3.2, .08, x, 1.6, z0 - .03); k.box('metal_painted_yellow', .16, 1.1, .16, x - 1.9, .55, z0 - .5, { bevel: .02 }); k.box('metal_painted_yellow', .16, 1.1, .16, x + 1.9, .55, z0 - .5, { bevel: .02 }); k.box('concrete_stained', 3.6, .25, 1.2, x, .12, z0 - .6, { bevel: .02 }); }
        else { k.box('metal_painted_blue', 1.0, 2.1, .07, x, 1.05, z0 - .03, { bevel: .01 }); k.box('metal_galv', 1.12, .08, .1, x, 2.16, z0 - .04); k.cyl('aluminium_brushed', .025, .025, .07, x + .36, 1.02, z0 - .09, { seg: 6, rx: PI / 2 }); }
        k.box('metal_dark', .3, .14, .2, x, big ? 3.6 : 2.6, z0 - .12, { bevel: .02 }); WIN.box(x, (big ? 3.6 : 2.6) - .075, z0 - .13, .24, .02, .16); X.pools.push([x, .016, z0 - 2.2, 3.6, 3, .6]);
        if (i % 2 === 0) { const ax = x + 2.6; k.box('concrete_stained', 1.2, .1, 1.0, ax, .05, z0 - .8); k.box('plastic_grey', 1.0, .9, .8, ax, .55, z0 - .8, { bevel: .03 }); k.cyl('metal_dark', .36, .36, .02, ax, 1.01, z0 - .8, { seg: 12 }); k.tube('metal_galv', [[ax + .3, .8, z0 - .4], [ax + .3, .9, z0 - .08], [ax + .3, 3.0, z0 - .06], [ax + .3, h + .2, z0 - .06]], .03, { seg: 5, steps: 8 }); k.geo(GT.decalMat('grime_streak'), new T.PlaneGeometry(1.2, 1.8), { x: ax, y: 1.2, z: z0 - .012, ry: PI }); }
        k.geo(GT.decalMat(['water_stain', 'grime_streak', 'rust_run', 'leak'][i % 4]), new T.PlaneGeometry(rr(1, 2), rr(1.6, 3)), { x: x + rr(3, 5), y: h - 1.6, z: z0 - .013, ry: PI }); }
      k.geo(GT.decalMat('graffiti_a'), new T.PlaneGeometry(4.6, 2.2), { x: 49, y: 1.5, z: z0 - .014, ry: PI }); k.geo(GT.decalMat('graffiti_b'), new T.PlaneGeometry(3.6, 1.9), { x: 97, y: 1.4, z: z0 - .014, ry: PI });
      for (let i = 0; i < 9; i++) { const x = x0 + 8 + i * 12.5; k.box('plastic_grey', 1.6, 1.0, 1.4, x, h + .6, cz + rr(-2, 2), { bevel: .04 }); k.cyl('metal_dark', .45, .45, .04, x, h + 1.12, cz, { seg: 10 }); }
      k.box('metal_galv', 1.6, 1.2, .25, x0 + 3, 1.6, z0 - .14, { bevel: .02 }); for (let i = 0; i < 4; i++) { k.box('metal_galv', .3, .45, .16, x0 + 2.45 + i * .36, 1.7, z0 - .3, { bevel: .02 }); k.cyl('glass_dirty', .08, .08, .05, x0 + 2.45 + i * .36, 1.75, z0 - .4, { seg: 8, rx: PI / 2 }); } k.tube('metal_galv', [[x0 + 3, 2.2, z0 - .14], [x0 + 3, h - .3, z0 - .1], [x0 + 12, h - .3, z0 - .1]], .03, { seg: 5, steps: 6 });
      const dumpster = (x, z, ry) => { k.push(x, 0, z, { ry }); k.box('metal_painted_blue', 2.0, 1.15, 1.3, 0, .72, 0, { bevel: .03 }); k.box('rubber', 2.06, .06, .7, 0, 1.36, -.32, { rx: -.14 }); k.box('rubber', 2.06, .06, .7, 0, 1.4, .32, { rx: .3 }); for (const sx of [-1, 1]) { k.box('metal_painted_blue', .1, .16, 1.0, sx * 1.06, .9, 0); for (const sz of [-1, 1]) k.cyl('rubber', .08, .08, .06, sx * .85, .08, sz * .5, { seg: 8, rz: PI / 2 }); } k.geo(GT.decalMat('rust_run'), new T.PlaneGeometry(.9, .9), { x: .3, y: .7, z: -.655, ry: PI }); k.pop(); K.g.decal('leak', 2.2, 2.6, x, .012, z - 1.4, 0); GT.world.addBox(x - 1.1, z - .8, x + 1.1, z + .8, 1.4, 'dumpster'); };
      dumpster(38, 140.6, .06); dumpster(41, 140.4, -.12); dumpster(84, 140.7, .3); dumpster(118, 140.5, -.05);
      for (const [x, z] of [[60, 141], [61.4, 141.2], [104, 141]]) for (let j = 0; j < 4; j++) { for (let i = 0; i < 5; i++) k.box('wood_plank', 1.2, .022, .1, x, .14 * j + .13, z - .5 + i * .25); for (const s of [-1, 0, 1]) k.box('wood_plank', .1, .09, 1.1, x + s * .52, .14 * j + .07, z); }
      K.g.decal('oil_stain', 3, 3, 70, .012, 136, 0); K.g.decal('puddle', 4, 3, 92, .012, 135.5, .4); K.g.decal('tire_marks', 2.2, 8, 50, .012, 135, PI / 2); K.g.decal('crack', 6, 6, 110, .011, 135, 1); K.g.decal('puddle', 3, 2.2, 30, .012, 134.2, 2);
      GT.world.addBox(x0, z0, x1, z1, h, 'stripmall'); }
  }

  /* ================================================================== distant backdrop */
  function buildBackdrop(X) {
    const { B } = X, F = X.FAC, V = X.V, r = GT.rng('backdrop'), rr = (a, b) => a + (b - a) * r(), tints = [0xe8e2d4, 0xd9cdb8, 0xe6b8a8, 0xbfd6d2, 0xf0ece4, 0xc9c2b0, 0xa8b4bc, 0xe0c9a0];
    const fbox = (cx, cz, w, h, d, ry, y0) => { const u0 = F.U.length; F.box(cx, (y0 || 0) + h / 2, cz, w, h, d, ry); const ou = Math.floor(rr(0, 12)) / 12, ov = Math.floor(rr(0, 16)) / 16; for (let i = u0; i < F.U.length; i += 2) { F.U[i] = F.U[i] / 43.2 + ou; F.U[i + 1] = F.U[i + 1] / 52.8 + ov; } };
    const beacon = (x, y, z, s, t) => X.LENS.blob(x, y, z, s, s, s, [(t + .5) / 16, .5, (t + .5) / 16, .5], 6, 4);
    const tower = (cx, cz, h, w, d, ry, kb) => { F.setCol(r() < .25 ? 0x6f8494 : tints[(r() * tints.length) | 0], rr(.4, .6) * (kb || 1)); const ty = r(); fbox(cx, cz, w, h, d, ry);
      if (ty < .35) { fbox(cx, cz, w * .6, h * .14, d * .7, ry, h); } else if (ty < .6) { fbox(cx + Math.cos(ry) * w * .2, cz - Math.sin(ry) * w * .2, w * .5, h * .22, d * .85, ry, h); } else if (ty < .8) { fbox(cx, cz, w * 1.5, h * .18, d * 1.4, ry, 0); }
      F.setCol(0x6a6c70); fbox(cx, cz, w * .3, 5, d * .4, ry, h * (ty < .35 ? 1.14 : ty < .6 ? 1.22 : 1)); if (h > 92) beacon(cx, h * 1.24 + 6, cz, 1.6, 6 + ((r() * 2) | 0)); };
    // east + north-east + south-east skyline ring (600–900 m)
    for (let i = 0; i < 44; i++) { const a = lerp(-1.9, 1.9, (i + r() * .8) / 44), d = rr(430, 720), cx = 80 + Math.cos(a) * d, cz = Math.sin(a) * d * 1.05; if (cx < 30) continue; const tall = r() < .3; tower(cx, cz, tall ? rr(55, 96) : rr(22, 50), rr(18, 36), rr(16, 26), rr(0, PI)); }
    // mid-rise filler (350–520 m)
    for (let i = 0; i < 30; i++) { const a = lerp(-1.75, 1.75, (i + r()) / 30), d = rr(300, 430), cx = 90 + Math.cos(a) * d, cz = Math.sin(a) * d; if (cx < 40) continue; F.setCol(tints[(r() * tints.length) | 0], rr(.45, .65)); fbox(cx, cz, rr(30, 70), rr(8, 22), rr(18, 34), rr(0, PI)); }
    // condo row up and down the coast road (closes the highway vista) + a headland to the north-west
    for (const s of [-1, 1]) for (let i = 0; i < 9; i++) { const z = s * (470 + i * 42 + rr(-10, 10)), x = 40 + rr(0, 90) + i * 6; tower(x, z, rr(28, 72), rr(20, 34), rr(18, 26), rr(-.3, .3), .75); }
    B.grass.fan([[-10.4, 560], [-150, 640], [-330, 760], [-420, 900], [-380, 1200], [-10.4, 1200]], .4); B.sand.fan([[-10.4, 540], [-160, 622], [-350, 748], [-446, 900], [-420, 1200], [-380, 1200], [-420, 900], [-330, 760], [-150, 640], [-10.4, 560]].slice(0, 5), -.6);
    for (let i = 0; i < 7; i++) tower(-110 - i * 40 + rr(-10, 10), 650 + i * 40 + rr(-12, 12), rr(34, 82), rr(20, 32), rr(18, 26), rr(.3, .9), .5);
    // water tower
    { const x = 395, z = -250, h = 44; V.setCol(0xb8c4c8); for (let i = 0; i < 6; i++) { const a = i * TAU / 6; V.box(x + Math.cos(a) * 7, h * .42, z + Math.sin(a) * 7, .7, h * .84, .7); } V.box(x, h * .4, z, 2.2, h * .8, 2.2); V.blob(x, h, z, 11, 7, 11, [0, 0, 1, 1], 14, 8); V.cyl(x, h * .5, z, 7.6, 7.6, .5, 12); beacon(x, h + 8, z, 1.1, 7); }
    // radio mast with guy wires and blinking beacons
    { const x = 470, z = 330, h = 170; V.setCol(0xa83a30); for (let i = 0; i < 7; i++) { V.setCol(i & 1 ? 0xd8d4cc : 0xa83a30); V.box(x, h * (i + .5) / 7, z, 2.2, h / 7, 2.2, .3); } V.setCol(0x4a4c50); for (const a of [0, 2.1, 4.2]) for (const k of [.5, .95]) { const gx = x + Math.cos(a) * 90 * k, gz = z + Math.sin(a) * 90 * k, len = Math.hypot(90 * k, h * k), pitch = Math.atan2(90 * k, h * k); const m = new T.Matrix4().makeRotationY(-a + PI / 2).multiply(new T.Matrix4().makeRotationX(pitch)), n0 = V.P.length; V.box(0, 0, 0, .35, len, .35); for (let i = n0; i < V.P.length; i += 3) { const v = new T.Vector3(V.P[i], V.P[i + 1], V.P[i + 2]).applyMatrix4(m); V.P[i] = v.x + (x + gx) / 2; V.P[i + 1] = v.y + h * k / 2; V.P[i + 2] = v.z + (z + gz) / 2; } }
      beacon(x, h + 3, z, 2.0, 6); beacon(x, h * .66, z, 1.6, 7); beacon(x, h * .33, z, 1.6, 6); }
    // tower cranes over a half-built block
    F.setCol(0x8a8a86, .8); fbox(300, -470, 34, 70, 26, .4);
    for (const [x, z, h, a] of [[322, -452, 104, .5], [276, -492, 92, 2.4], [610, 120, 128, 1.2]]) { V.setCol(0xc8a020); V.box(x, h / 2, z, 2, h, 2, a); V.box(x + Math.cos(a) * 20, h + 1.5, z - Math.sin(a) * 20, 62, 1.6, 1.6, a); V.box(x, h + 5, z, 1.4, 9, 1.4, a); V.setCol(0x5a5c60); V.box(x - Math.cos(a) * 9, h - .5, z + Math.sin(a) * 9, 5, 3.4, 2.6, a); beacon(x, h + 10.5, z, 1.2, 7); }
  }

  /* ================================================================== traffic lanes (waypoint graph) */
  function makeLanes() {
    const P = (x, z) => ({ x: +x.toFixed(2), z: +z.toFixed(2) }), bez = (a, b, c, n) => { const o = []; for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; o.push(P(u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1])); } return o; };
    const run = (x0, z0, x1, z1, step) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step)), o = []; for (let i = 0; i <= n; i++) o.push(P(lerp(x0, x1, i / n), lerp(z0, z1, i / n))); return o; };
    const zN = 160 + 2.25, zS = -160 - 2.25, xE = BX + 2.25, zNi = 160 - 2.25, zSi = -160 + 2.25, xEi = BX - 2.25;
    // outer loop: north on the highway (x=-3), left onto the north street, south down the back road, back along the south street
    const outer = [].concat(run(-3, -146, -3, 146, 12), bez([-3, 146], [-3, zN], [13, zN], 6), run(22, zN, 138, zN, 12), bez([138, zN], [xE, zN], [xE, 148], 6), run(xE, 138, xE, -138, 12), bez([xE, -148], [xE, zS], [138, zS], 6), run(128, zS, 22, zS, 12), bez([13, zS], [-3, zS], [-3, -146], 6)); outer.pop();
    // inner loop: south on the highway (x=+3), right turns all the way round
    const inner = [].concat(run(3, 146, 3, -146, 12), bez([3, -146], [3, zSi], [12, zSi], 5), run(22, zSi, 136, zSi, 12), bez([140, zSi], [xEi, zSi], [xEi, -150], 5), run(xEi, -140, xEi, 140, 12), bez([xEi, 150], [xEi, zNi], [140, zNi], 5), run(130, zNi, 22, zNi, 12), bez([12, zNi], [3, zNi], [3, 146], 5)); inner.pop();
    const lanes = [{ id: 'outer', closed: true, speed: 14, pts: outer }, { id: 'inner', closed: true, speed: 14, pts: inner },
      { id: 'hwyN2', closed: false, speed: 16, pts: run(-6, -182, -6, 182, 13) }, { id: 'hwyS2', closed: false, speed: 16, pts: run(6, 182, 6, -182, 13) }];
    const near = (id, x, z) => { const pts = lanes.find(l => l.id === id).pts; let b = 0, bd = 1e9; pts.forEach((p, i) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; b = i; } }); return b; };
    const links = [];
    for (const z of [-120, -60, 0, 60, 120]) { links.push({ from: 'hwyN2', fromIdx: near('hwyN2', -6, z - 12), to: 'outer', toIdx: near('outer', -3, z + 12), type: 'lane-change' }); links.push({ from: 'outer', fromIdx: near('outer', -3, z - 12), to: 'hwyN2', toIdx: near('hwyN2', -6, z + 12), type: 'lane-change' });
      links.push({ from: 'hwyS2', fromIdx: near('hwyS2', 6, z + 12), to: 'inner', toIdx: near('inner', 3, z - 12), type: 'lane-change' }); links.push({ from: 'inner', fromIdx: near('inner', 3, z + 12), to: 'hwyS2', toIdx: near('hwyS2', 6, z - 12), type: 'lane-change' }); }
    links.push({ from: 'hwyN2', fromIdx: lanes[2].pts.length - 4, to: 'outer', toIdx: near('outer', -3, 144), type: 'merge' }, { from: 'hwyS2', fromIdx: lanes[3].pts.length - 4, to: 'inner', toIdx: near('inner', 3, -144), type: 'merge' });
    // driveway turn paths (from the southbound kerb lane into the lots and back out)
    const drives = [];
    for (const [name, d, tx] of [['stationS', DRIVES[0], 24], ['stationN', DRIVES[1], 24], ['motel', DRIVES[2], 24]]) { drives.push({ name: name + ':in', from: 'hwyS2', fromIdx: near('hwyS2', 6, d + 14), pts: [P(6, d + 14)].concat(bez([6, d + 14], [6, d], [14, d], 5), [P(tx, d)]) }); drives.push({ name: name + ':out', to: 'hwyS2', toIdx: near('hwyS2', 6, d - 16), pts: [P(tx, d), P(14, d)].concat(bez([14, d], [6, d], [6, d - 14], 5)) });
      drives.push({ name: name + ':outNorth', to: 'outer', toIdx: near('outer', -3, d + 18), pts: [P(tx, d), P(14, d)].concat(bez([14, d], [-3, d], [-3, d + 16], 6)) }); }
    // an Array of lanes ({id, closed, speed, pts:[{x,z}]}) with the graph extras attached as properties
    lanes.links = links; lanes.drives = drives; lanes.loops = [outer, inner]; lanes.byId = id => lanes.find(l => l.id === id); lanes.nearest = near; return lanes;
  }

  /* ================================================================== build / update / API */
  function build(scene) {
    if (state.built) return state.root; state.built = true; const t0 = performance.now();
    const root = state.root = new T.Group(); root.name = 'road'; scene.add(root);
    const M = state.M = makeMats(); const tTex = performance.now();
    M.win = new T.MeshBasicMaterial({ color: 0xffffff }); GT.glow(M.win, new T.Color(1, .74, .42), .16, 2.6);
    const nb = o => new Batch(o), B = { asph: nb(), asphW: nb(), conc: nb(), concS: nb(), sand: nb(), grass: nb(), dirt: nb(), ovl: nb(), paint: nb({ col: 1 }), marks: nb(), wet: nb(), sandMarks: nb(), veg: nb({ col: 1, wind: 1 }) };
    const X = { scene, root, M, B, K: { g: GT.kit(), p: GT.kit() }, S: nb(), SL: nb(), V: nb({ col: 1 }), CH: nb(), LAMP: nb(), LENS: nb(), WIN: nb(), FAC: nb({ col: 1 }), pools: [], cones: [], poleZ: [-184, -150, -116, -82, -48, -14, 28, 72, 106, 140, 176] };
    const tm = {}, run = (n, f) => { const a = performance.now(); f(X); tm[n] = Math.round(performance.now() - a); };
    run('ground', buildGround); run('beach', buildBeach); run('flora', buildFlora); run('furniture', buildFurniture); run('lots', buildLots); run('backdrop', buildBackdrop); const tMerge = performance.now();
    // light pools + cones from the collected lamp list
    const PL = nb(), CN = nb(); const brk = [-10, -HW, HW, SW1, 14, BX - CW - 2, BX - CW, BX + CW];
    for (const p of X.pools) { const x0 = p[0] - p[3], x1 = p[0] + p[3], cuts = [x0].concat(brk.filter(b => b > x0 && b < x1), [x1]);
      for (let i = 0; i < cuts.length - 1; i++) { const a = cuts[i], b = cuts[i + 1], c = classify((a + b) / 2, p[2]); if (c[1] === 'sand' && a < -10) continue; if ((a + b) / 2 < WALL0 && (a + b) / 2 > WALL1 - .1) continue; const ya = Math.max(p[1], classify(a + .03, p[2])[0] + .014), yb = Math.max(p[1], classify(b - .03, p[2])[0] + .014), ua = (a - x0) / (x1 - x0), ub = (b - x0) / (x1 - x0), z0 = p[2] - p[4], z1 = p[2] + p[4]; if (c[1] === 'grass' && a >= SW1 && b <= 14) PL.quad4([a, ya, z0], [a, ya, z1], [b, yb, z1], [b, yb, z0], [[ua, 0], [ua, 1], [ub, 1], [ub, 0]]); else PL.rectUV(a, z0, b, z1, Math.max(p[1], c[0] + .014), ua, 0, ub, 1); } } for (const c of X.cones) CN.cyl(c[0], .05, c[2], c[3], .16, c[4] - .05, 14, [0, 0, 1, 1], false);
    const add = (b, mat, o) => { if (!b.n) return null; const m = b.mesh(mat, o); root.add(m); return m; };
    add(B.asph, GT.mat('asphalt'), { name: 'road_asphalt', cull: false }); add(B.asphW, GT.mat('asphalt_worn'), { name: 'road_asphalt_worn', cull: false }); add(B.conc, GT.mat('concrete'), { name: 'road_concrete', cull: false }); add(B.concS, GT.mat('concrete_stained'), { name: 'road_concrete_s', cull: false });
    add(B.sand, GT.mat('sand'), { name: 'road_sand', cull: false }); add(B.grass, GT.mat('grass_dry'), { name: 'road_grass', cull: false }); add(B.dirt, GT.mat('dirt'), { name: 'road_dirt', cull: false });
    add(B.ovl, M.ovl, { order: -6, name: 'road_wear', cull: false }); add(B.paint, M.paint, { order: -5, name: 'road_paint', cull: false }); add(B.marks, M.marks, { order: -5, name: 'road_stencils', cull: false }); add(B.wet, M.wet, { order: -5, name: 'road_wetsand', cull: false }); add(B.sandMarks, M.sandMarks, { order: -5, name: 'road_sandmarks', cull: false });
    const vm = add(B.veg, M.flora, { cast: true, name: 'road_veg', cull: false }); if (vm) vm.customDepthMaterial = M.floraDepth;
    add(X.S, M.sign, { cast: true, name: 'road_signs', cull: false }); add(X.SL, M.signLit, { cast: true, name: 'road_signs_lit', cull: false }); add(X.V, M.vcol, { cast: true, name: 'road_vcol', cull: false }); add(X.CH, M.chain, { name: 'road_chainlink', cull: false, order: -1 });
    add(X.LAMP, M.lamp, { name: 'road_lamps', cull: false, recv: false }); add(X.LENS, M.lens, { name: 'road_lenses', cull: false, recv: false }); add(X.WIN, M.win, { name: 'road_windows', cull: false, recv: false }); add(X.FAC, M.facade, { name: 'road_skyline', cull: false, recv: false });
    state.poolMesh = add(PL, M.pool, { name: 'road_lightpools', cull: false, recv: false, order: 3 }); state.coneMesh = add(CN, M.cone, { name: 'road_lightcones', cull: false, recv: false, order: 4 });
    const gg = X.K.g.build({ cast: false }); gg.name = 'road_groundkit'; gg.traverse(o => { if (o.isMesh) { o.frustumCulled = false; if (o.material.transparent) o.renderOrder = -4; } }); root.add(gg);
    const pg = X.K.p.build(); pg.name = 'road_props'; pg.traverse(o => { if (o.isMesh) o.frustumCulled = false; }); root.add(pg);
    // world-edge colliders that have no visible fence object of their own
    GT.world.addBox(BX + CW + 1.35, -167, BX + CW + 1.65, 167, .8, 'edge-east'); for (const s of [-1, 1]) GT.world.addBox(-10.5, s * 188.4, 10.4, s * 189.2, 1, 'edge-deadend');
    GT.world.anchor('highwayNorth', { x: -3, z: 150, h: 0 }); GT.world.anchor('highwaySouth', { x: 3, z: -150, h: PI }); GT.world.anchor('beachStairs', { x: -9, z: STAIRS[0], h: -PI / 2 }); GT.world.anchor('pier', { x: -9, z: PIERZ, h: -PI / 2 });
    update(0); if (GT.applyGlow) GT.applyGlow(GT.env.night || 0);
    let dc = 0, tris = 0; const per = []; root.traverse(o => { if (o.isMesh) { dc++; const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); tris += n; per.push([(o.name || (o.parent && o.parent.name) || '') + ':' + (o.material.name || '').slice(0, 26), Math.round(n)]); } });
    per.sort((a, b) => b[1] - a[1]); state.stats.top = per.slice(0, 28).map(p => p[0] + '=' + p[1]).join(' ');
    state.stats = Object.assign(state.stats, { drawCalls: dc, tris: Math.round(tris), buildMs: Math.round(performance.now() - t0), texMs: Math.round(tTex - t0), mergeMs: Math.round(performance.now() - tMerge), parts: tm }); GT.road.stats = state.stats;
    return root;
  }
  const SIG = { cycle: 30, hwyG: 15, y: 3.2, crossG: 7 }, tmpV = new T.Vector3(), tmpC = new T.Color();
  function sigPhase(t) { const p = ((t % SIG.cycle) + SIG.cycle) % SIG.cycle; if (p < SIG.hwyG) return ['green', 'red']; if (p < SIG.hwyG + SIG.y) return ['yellow', 'red']; if (p < SIG.hwyG + SIG.y + 1) return ['red', 'red']; if (p < SIG.hwyG + SIG.y + 1 + SIG.crossG) return ['red', 'green']; if (p < SIG.hwyG + SIG.y * 2 + 1 + SIG.crossG) return ['red', 'yellow']; return ['red', 'red']; }
  function update(dt) {
    if (!state.built) return; state.time += dt || 0; const t = state.time, env = GT.env || {}, night = env.night || 0; state.uTime.value = t;
    // signals + beacons live in a 16×1 state texture
    const d = state.sigData, ph = sigPhase(t), set = (i, r, g, b, on) => { const k = on ? 1 : .07; d[i * 4] = r * k; d[i * 4 + 1] = g * k; d[i * 4 + 2] = b * k; d[i * 4 + 3] = 255; };
    for (let gI = 0; gI < 2; gI++) { set(gI * 3, 255, 26, 14, ph[gI] === 'red'); set(gI * 3 + 1, 255, 150, 12, ph[gI] === 'yellow'); set(gI * 3 + 2, 30, 255, 110, ph[gI] === 'green'); }
    const b1 = (t % 1.6) < .5, b2 = ((t + .8) % 1.6) < .5; set(6, 255, 18, 10, b1); set(7, 255, 18, 10, b2); const f1 = (t % 1.1) < .55; set(8, 255, 130, 10, f1); set(9, 255, 130, 10, !f1); state.sigTex.needsUpdate = true;
    state.M.lens.color.setScalar(lerp(5.5, 8, night));
    if (state.poolMesh) state.poolMesh.visible = night > .02; if (state.coneMesh) state.coneMesh.visible = night > .02;
    // sea colours follow the sky
    const U = state.sea && state.sea.uniforms; if (U) { U.uT.value = t; const sd = env.sunDir || tmpV.set(-1, .1, .2).normalize(); U.uSun.value.copy(sd); const sc = env.sunColor || tmpC.setRGB(1, .7, .4); U.uSunCol.value.copy(sc).multiplyScalar(lerp(1.5, .9, night));
      state.skyT = (state.skyT || 0) - (dt || 0); if (state.skyT <= 0 || !dt) { state.skyT = .35; const hz = Math.hypot(sd.x, sd.z) || 1, ax = sd.x / hz, az = sd.z / hz;
        if (GT.atmos && GT.atmos.skyColorAt && GT.atmos.sky) { try { GT.atmos.skyColorAt(tmpV.set(ax * .2, .75, az * .2 + .6).normalize(), U.uSkyZ.value); GT.atmos.skyColorAt(tmpV.set(-az * .9 + ax * .2, .1, ax * .9 + az * .2).normalize(), U.uSkyH.value); GT.atmos.skyColorAt(tmpV.set(ax, .2, az).normalize(), U.uSkyS.value); } catch (e) { /* keep defaults */ } }
        else if (env.skyColor && env.horizonColor) { U.uSkyZ.value.copy(env.skyColor); U.uSkyH.value.copy(env.horizonColor); U.uSkyS.value.copy(env.horizonColor).multiplyScalar(1.4); }
        const z = U.uSkyZ.value, h = U.uSkyH.value; U.uDeep.value.setRGB(z.r * .05 + h.r * .012, z.g * .11 + h.g * .03, z.b * .13 + h.b * .035); U.uShal.value.setRGB(h.r * .1 + z.r * .1, h.g * .2 + z.g * .16, h.b * .19 + z.b * .14); U.uFoam.value.setRGB(h.r * .55 + sc.r * .1, h.g * .55 + sc.g * .1, h.b * .55 + sc.b * .1); } }
  }
  GT.road = { build, update, groundHeight: (x, z) => classify(x, z)[0], surfaceAt: (x, z) => classify(x, z)[1], lanes: makeLanes(), stats: state.stats,
    /** 'hwy' | 'cross' -> 'green' | 'yellow' | 'red' (the two highway intersections run in sync) */
    signalState: which => sigPhase(state.time)[which === 'cross' ? 1 : 0], signalPositions: [{ x: 0, z: 160 }, { x: 0, z: -160 }] };

  /* ================================================================== showcases */
  const show = (cam, look, hours) => ({ scene }) => { GT.road.build(scene); if (new URLSearchParams(location.search).get('stats')) { const e = document.getElementById('err'); if (e) e.textContent += JSON.stringify(GT.road.stats) + '\n'; } return { cam, look, hours: hours || 18.2, update: dt => GT.road.update(dt) }; };
  GT.showcase.road = show([-3, 1.12, -60], [-7.5, 2.1, 0]);
  GT.showcase.road_sunset = show([13.2, 1.5, 21.5], [-60, 2.2, 36]);
  GT.showcase.road_beach = show([-19, 1.5, -9], [-46, -.4, 28]);
  GT.showcase.road_intersection = show([-3, 1.6, 118], [1, 3.2, 162]);
  GT.showcase.road_lots = show([8, 3.2, -44], [50, 1.2, -100]);
  GT.showcase.road_backdrop = show([146, 2.4, 62], [400, 22, -40]);
})();
