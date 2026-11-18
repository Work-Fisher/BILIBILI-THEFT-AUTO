/* materials.js — procedural PBR material library, decals and sign/text generator for SUNSET HEAT.
   Replaces the stubs in core.js:  GT.mat(name, opts)  GT.decalMat(name)  GT.signTex(text, opts)   plus GT.tex (generators) and GT.signMat.
   Everything is generated at first use from tileable noise (value-fbm / worley / white) and cached. UVs are in METRES, so every texture
   sets repeat = 1 / metresCovered. A shared low-frequency "macro" texture is mixed in the shader to break tiling at distance. */
(function () {
  'use strict';
  const TH = THREE, GT = window.GT, TAU = Math.PI * 2;
  const t0 = () => performance.now();
  const stats = { ms: 0, built: [] };

  /* ================================================================== math + noise */
  const sm = (x, a, b) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  const fr = x => x - Math.floor(x);
  const cl = (x, a, b) => x < a ? a : x > b ? b : x;
  const rgb = hex => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
  function hashI(x, y, s) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  const FC = {};
  /** tileable value-noise fBm field, normalised 0..1. px,py = lattice periods of the first octave (non-square = anisotropic streaks). */
  function fbm(S, px, py, oct, seed, gain) {
    gain = gain === undefined ? .5 : gain; px = Math.max(1, Math.round(px)); py = Math.max(1, Math.round(py));
    const key = 'f' + [S, px, py, oct, seed, gain].join('_'); if (FC[key]) return FC[key];
    if (S === 1024) { const lo = fbm(512, px, py, oct, seed, gain), o = new Float32Array(S * S);
      for (let y = 0; y < 512; y++) { const r0 = y << 9, r1 = ((y + 1) & 511) << 9, d0 = (y << 1) << 10, d1 = d0 + 1024;
        for (let x = 0; x < 512; x++) { const x1 = (x + 1) & 511, a = lo[r0 + x], b = lo[r0 + x1], c = lo[r1 + x], d = lo[r1 + x1], j = x << 1; o[d0 + j] = a; o[d0 + j + 1] = (a + b) * .5; o[d1 + j] = (a + c) * .5; o[d1 + j + 1] = (a + b + c + d) * .25; } }
      return FC[key] = o; }
    const out = new Float32Array(S * S), X0 = new Int32Array(S), X1 = new Int32Array(S), FX = new Float32Array(S); let amp = 1;
    for (let o = 0; o < oct; o++) {
      const gx = px << o, gy = py << o; if (gx > S || gy > S) break;
      const lat = new Float32Array(gx * gy); for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) lat[j * gx + i] = hashI(i, j, seed * 131 + o * 17);
      for (let x = 0; x < S; x++) { const u = x / S * gx, i = Math.floor(u), f = u - i; FX[x] = f * f * (3 - 2 * f); X0[x] = i % gx; X1[x] = (i + 1) % gx; }
      for (let y = 0; y < S; y++) { const v = y / S * gy, j = Math.floor(v), f = v - j, fy = f * f * (3 - 2 * f), r0 = (j % gy) * gx, r1 = ((j + 1) % gy) * gx, row = y * S;
        for (let x = 0; x < S; x++) { const fx = FX[x], a = lat[r0 + X0[x]], b = lat[r0 + X1[x]], c = lat[r1 + X0[x]], d = lat[r1 + X1[x]], t = a + (b - a) * fx; out[row + x] += amp * (t + (c + (d - c) * fx - t) * fy); } }
      amp *= gain;
    }
    let mn = 1e9, mx = -1e9; for (let i = 0; i < out.length; i++) { const v = out[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const k = 1 / (mx - mn || 1); for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * k;
    return FC[key] = out;
  }
  const N = (S, p, o, seed, g) => fbm(S, p, p, o, seed, g);
  /** tileable worley/cellular field: {f1, f2 (cell units), id (0..1 hash per cell)} */
  function worley(S, nx, seed, ny) {
    ny = ny || nx; const key = 'w' + [S, nx, ny, seed].join('_'); if (FC[key]) return FC[key];
    const n = nx * ny, PX = new Float32Array(n), PY = new Float32Array(n), ID = new Float32Array(n);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; PX[k] = i + hashI(i, j, seed); PY[k] = j + hashI(i, j, seed + 7919); ID[k] = hashI(i, j, seed + 104729); }
    const f1 = new Float32Array(S * S), f2 = new Float32Array(S * S), id = new Float32Array(S * S);
    for (let y = 0; y < S; y++) { const gy = (y + .5) / S * ny, cy = Math.floor(gy);
      for (let x = 0; x < S; x++) { const gx = (x + .5) / S * nx, cx = Math.floor(gx); let d1 = 9, d2 = 9, bi = 0;
        for (let oy = -1; oy <= 1; oy++) { const yy = cy + oy, wy = (yy + ny) % ny, sy = yy - wy;
          for (let ox = -1; ox <= 1; ox++) { const xx = cx + ox, wx = (xx + nx) % nx, k = wy * nx + wx, dx = PX[k] + (xx - wx) - gx, dy = PY[k] + sy - gy, d = dx * dx + dy * dy;
            if (d < d1) { d2 = d1; d1 = d; bi = k; } else if (d < d2) d2 = d; } }
        const i = y * S + x; f1[i] = Math.sqrt(d1); f2[i] = Math.sqrt(d2); id[i] = ID[bi]; } }
    return FC[key] = { f1, f2, id };
  }
  function white(S, seed) { const key = 'h' + S + '_' + seed; if (FC[key]) return FC[key]; const o = new Float32Array(S * S); for (let i = 0; i < o.length; i++) o[i] = hashI(i % S, (i / S) | 0, seed); return FC[key] = o; }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function canvasField(key, S, draw) { if (FC[key]) return FC[key]; const c = canvas(S, S), g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, S, S); draw(g, GT.rng(key));
    const d = g.getImageData(0, 0, S, S).data, o = new Float32Array(S * S); for (let i = 0; i < o.length; i++) o[i] = d[i * 4] / 255; return FC[key] = o; }
  /** draw fn at (x,y) and at wrapped copies so canvas-drawn fields tile */
  function wrap(S, x, y, m, fn) { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const X = x + ox * S, Y = y + oy * S; if (X > -m && X < S + m && Y > -m && Y < S + m) fn(X, Y); } }
  /** fine random scratches 0..1 */
  const scratch = S => canvasField('scratch' + S, S, (g, r) => { g.lineCap = 'round';
    for (let i = 0; i < 260; i++) { const x = r() * S, y = r() * S, a = r() * TAU, l = 8 + r() * r() * 150, w = .5 + r() * .9, al = .25 + r() * .75, bend = (r() - .5) * .3;
      wrap(S, x, y, l, (X, Y) => { g.strokeStyle = `rgba(255,255,255,${al})`; g.lineWidth = w; g.beginPath(); g.moveTo(X, Y); g.quadraticCurveTo(X + Math.cos(a + bend) * l * .5, Y + Math.sin(a + bend) * l * .5, X + Math.cos(a) * l, Y + Math.sin(a) * l); g.stroke(); }); } });
  /** mineral-fibre ceiling tile fissures + pinholes */
  const fissure = S => canvasField('fissure' + S, S, (g, r) => { g.lineCap = 'round';
    for (let i = 0; i < 520; i++) { const x = r() * S, y = r() * S, a = (r() - .5) * 1.2 + (r() < .25 ? 1.57 : 0), l = 3 + r() * r() * 16, w = .8 + r() * 1.8;
      wrap(S, x, y, 24, (X, Y) => { g.strokeStyle = `rgba(255,255,255,${.5 + r() * .5})`; g.lineWidth = w; g.beginPath(); g.moveTo(X, Y); g.quadraticCurveTo(X + Math.cos(a + .6) * l * .5, Y + Math.sin(a + .6) * l * .5, X + Math.cos(a) * l, Y + Math.sin(a) * l); g.stroke(); }); }
    g.fillStyle = '#fff'; for (let i = 0; i < 2600; i++) { const s = .6 + r() * 1.1; g.fillRect(r() * S, r() * S, s, s); } });

  /** branching hairline cracks 0..1 (tileable, drawn as wrapped random walks) */
  const cracks = S => canvasField('cracks' + S, S, (g, r) => { g.lineCap = 'round'; const k = S / 1024;
    const walk = (x, y, a, len, w, depth) => { const n = (len / 5) | 0; let b = a; for (let i = 0; i < n; i++) { b += (r() - .5) * .2; a = b + (r() - .5) * 1.2; const dx = Math.cos(a) * 5 * k, dy = Math.sin(a) * 5 * k, ww = w * (1 - i / n * .6) * k, al = .55 + r() * .45;
        wrap(S, ((x % S) + S) % S, ((y % S) + S) % S, 8, (X, Y) => { g.strokeStyle = `rgba(255,255,255,${al})`; g.lineWidth = ww; g.beginPath(); g.moveTo(X, Y); g.lineTo(X + dx, Y + dy); g.stroke(); }); x += dx; y += dy;
        if (depth < 2 && r() < .012) walk(x, y, b + (r() < .5 ? 1 : -1) * (.5 + r() * .9), len * (.25 + r() * .35), w * .7, depth + 1); } };
    for (let i = 0; i < 4; i++) walk(r() * S, r() * S, r() * TAU, 300 + r() * 500, 1.3 + r() * 1.0, 0); });

  /* ================================================================== texture builders */
  function dataTex(data, S, srgb) { const t = new TH.DataTexture(data instanceof Uint8Array ? data : new Uint8Array(data.buffer), S, S, TH.RGBAFormat);
    t.wrapS = t.wrapT = TH.RepeatWrapping; t.magFilter = TH.LinearFilter; t.minFilter = TH.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; if (srgb) t.encoding = TH.sRGBEncoding; t.needsUpdate = true; return t; }
  /** height field (Float32, any range) -> tangent-space normal map. k = slope gain (per 512 px). */
  function normalFromHeight(h, S, k) { const d = new Uint8Array(S * S * 4); k = k * S / 512;
    for (let y = 0; y < S; y++) { const yu = ((y + 1) % S) * S, yd = ((y + S - 1) % S) * S, row = y * S;
      for (let x = 0; x < S; x++) { const xr = (x + 1) % S, xl = (x + S - 1) % S, dx = (h[row + xr] - h[row + xl]) * k, dy = (h[yu + x] - h[yd + x]) * k, il = 127.5 / Math.sqrt(dx * dx + dy * dy + 1), j = (row + x) * 4;
        d[j] = 127.5 - dx * il; d[j + 1] = 127.5 - dy * il; d[j + 2] = 127.5 + il; d[j + 3] = 255; } }
    return dataTex(d, S, false); }
  /** R = aux (transmission for dirty glass), G = roughness, B = metalness */
  function ormTex(r, mt, S, aux) { const d = new Uint8Array(S * S * 4); let sr = 0;
    for (let i = 0, n = S * S; i < n; i++) { const j = i * 4, rv = cl(r[i], 0.02, 1); sr += rv; d[j] = aux ? cl(aux[i], 0, 1) * 255 : 255; d[j + 1] = rv * 255; d[j + 2] = mt ? cl(mt[i], 0, 1) * 255 : 0; d[j + 3] = 255; }
    const t = dataTex(d, S, false); t.userData = { meanR: sr / (S * S) }; return t; }
  const A = S => ({ S, a: new Uint8ClampedArray(S * S * 4), h: new Float32Array(S * S), r: new Float32Array(S * S) });
  // tiny colour register used by all the per-pixel painters (sRGB 0..1)
  let cr = 0, cg = 0, cb = 0;
  const C_ = (c, l) => { cr = c[0] * l; cg = c[1] * l; cb = c[2] * l; };
  const Mx = (d, t) => { cr += (d[0] - cr) * t; cg += (d[1] - cg) * t; cb += (d[2] - cb) * t; };
  const Mk = (d, k, t) => { cr += (d[0] * k[0] - cr) * t; cg += (d[1] * k[1] - cg) * t; cb += (d[2] * k[2] - cb) * t; };
  const Ml = l => { cr *= l; cg *= l; cb *= l; };
  const Pt = (a, i) => { const j = i << 2; a[j] = cr * 255; a[j + 1] = cg * 255; a[j + 2] = cb * 255; a[j + 3] = 255; };
  const SH = {}; const shared = (k, fn) => SH[k] || (SH[k] = fn());
  // brick / tile layout helper -> bE (distance to tile edge, metres), bId (hash), bFx, bFy, bCol, bRow
  let bE = 0, bId = 0, bFx = 0, bFy = 0, bCol = 0, bRow = 0;
  function brickAt(u, v, nx, ny, tw, th, off, seed) { const y = v * ny, row = Math.floor(y), fy = y - row, x = u * nx + ((row & 1) ? off : 0); let col = Math.floor(x); const fx = x - col; col = ((col % nx) + nx) % nx;
    bE = Math.min(Math.min(fx, 1 - fx) * tw, Math.min(fy, 1 - fy) * th); bId = hashI(col, row, seed); bFx = fx; bFy = fy; bCol = col; bRow = row; }

  /* ================================================================== material definitions
     each: (c = base colour rgb, k = c / defaultColour, o = opts) -> { S, m:[metresU,metresV], a, h, r, mt?, nk, key?, macro:[1/m,1/m,albedoAmt,roughAmt] } */
  const DEF = {};
  const GROUND = [1 / 23, 1 / 7.9, .2, .2], WALL = [1 / 9.1, 1 / 3.1, .24, .14], METAL = [1 / 2.3, 1 / .71, .09, .22], SMALL = [1 / .93, 1 / .31, .07, .22];

  function asphalt(mode) { return (c, k) => {
    const S = mode === 2 ? 512 : 1024, n = S * S, o = A(S), W = worley(512, mode === 2 ? 110 : 118, 5), nL = N(S, 3, 5, 11), nM = N(S, 10, 4, 12), nF = N(512, 64, 2, 13), nG = N(S, 2, 3, 15), nT = N(S, 5, 4, 16), wh = white(512, 17), ck = mode === 2 ? null : cracks(S), nP = N(S, 4, 4, 18);
    const stoneA = [.60 * k[0], .58 * k[1], .54 * k[2]], stoneB = [.50 * k[0], .47 * k[1], .41 * k[2]], stoneC = [.42 * k[0], .43 * k[1], .46 * k[2]], tarC = [.035, .035, .04], dust = [.5 * k[0], .46 * k[1], .4 * k[2]], blk = [.02, .02, .02], sh = S === 1024 ? 10 : 9, mk = S - 1;
    for (let i = 0; i < n; i++) { const x = i & mk, y = i >> sh, t = ((y & 511) << 9) | (x & 511);
      const id = W.id[t], id2 = fr(id * 23.7), f1 = W.f1[t], f2 = W.f2[t], edge = sm(f2 - f1, .02, .2), sunk = mode === 1 ? .25 * id2 : mode === 2 ? .3 : .55 * id2;
      const st = edge * (1 - sunk); let hh = st * (.7 + .3 * id) + nF[t] * .22 + wh[t] * .1 + nM[i] * .1, tar = 0, crk = 0;
      if (mode === 2) { const f = fr(y / S * 3 + (nM[i] - .5) * .03), d = Math.min(f, 1 - f); tar = sm(d, .03, .01) * (.6 + .4 * nF[t]); }
      else if (mode === 1) crk = ck[i] * sm(nG[i], .6, .75) * .8; else crk = ck[i] * sm(nG[i], .5, .68) * .55;
      hh = mix(hh, .5 + nF[t] * .05, tar * .92) - crk * 1.2; o.h[i] = hh;
      C_(c, (.84 + .32 * nL[i]) * (.9 + .2 * nM[i]) * (.86 + .28 * wh[t]) * (.75 + .25 * edge) * (1 - .22 * sm(nT[i], .6, .85)));
      const w = id > .9 ? .8 : id > .66 ? .46 : id > .3 ? .2 : .06, wt = st * w * (mode === 1 ? 1.5 : mode === 2 ? .7 : 1.2), pol = mode === 2 ? 0 : sm(nP[i], .5, .72);
      Mx(id2 > .66 ? stoneA : id2 > .33 ? stoneB : stoneC, wt > 1 ? 1 : wt);
      if (mode === 1) Mx(dust, (1 - edge) * .3 * nM[i] + .06);
      Mx(tarC, tar * .93); Mx(blk, crk * .9); Pt(o.a, i);
      o.r[i] = mix(.95 - st * (.2 + .22 * pol) - pol * .08, .34 + nF[t] * .22, tar) + crk * .1;
    }
    return { S, m: [2.4, 2.4], a: o.a, h: o.h, r: o.r, nk: mode === 2 ? .75 : .9, macro: GROUND, fx: mode === 2 ? null : { wet: 1, patch: mode === 1 ? .9 : 1 } }; }; }
  DEF.asphalt = asphalt(0); DEF.asphalt_worn = asphalt(1); DEF.roof_tar = asphalt(2);

  function concrete(stained) { return (c, k) => {
    const S = 1024, n = S * S, o = A(S), W = worley(512, 48, 26), nL = N(S, 2, 5, 21), nL2 = N(S, 3, 5, 27), nM = N(S, 7, 5, 22), nF = N(S, 48, 3, 23), nG = N(512, 128, 2, 24), nB = fbm(512, 2, 128, 2, 28), nR = N(S, 4, 4, 30), wh = white(512, 25), ck = cracks(S);
    const tones = [0, -.05, .035, -.02], dark = [.2, .19, .17], darkk = [.2 * k[0], .19 * k[1], .17 * k[2]], warm = [.8 * k[0], .75 * k[1], .66 * k[2]], rust = [.5 * k[0], .34 * k[1], .2 * k[2]], spk = [.34, .33, .31];
    for (let i = 0; i < n; i++) { const x = i & 1023, y = i >> 10, t = ((y & 511) << 9) | (x & 511), u = x / S * 2, v = y / S * 2, fu = fr(u), fv = fr(v), jd = Math.min(Math.min(fu, 1 - fu), Math.min(fv, 1 - fv)) * 1.5;
      const joint = sm(jd, .007, .002), jedge = sm(jd, .07, .012), id = W.id[t], pit = id > (stained ? .78 : .86) ? sm(W.f1[t], .22 * fr(id * 9.1) * fr(id * 37.3) + .04, .02) : 0;
      const crk = ck[(x << 10) | y] * sm(nL2[i], .45, .6) * (stained ? .75 : .45), sp = wh[t] > .93 ? 1 : 0;
      o.h[i] = .5 + (nF[i] - .5) * .2 + (nG[t] - .5) * .16 + (nB[t] - .5) * .14 * (1 - jedge) + (wh[t] - .5) * .08 - pit * .55 - joint * .9 - crk * .8;
      C_(c, 1 + .24 * (nL[i] - .5) + .13 * (nM[i] - .5) + .1 * (nG[t] - .5) + tones[(u | 0) + (v | 0) * 2] - wh[t] * .05);
      Mx(warm, sm(nL2[i], .45, .9) * .28); if (sp) Mx(spk, .22 * nG[t]);
      const stain = sm(nM[i] * .6 + nL2[i] * .4, .5, .74) * (stained ? .36 : .12); Mx(darkk, stain);
      if (stained) Mx(rust, sm(nR[i], .66, .9) * .13);
      const dk = joint * .7 + sm(jd, .04, 0) * .18 + pit * .6 + crk * .8; Mx(dark, dk > 1 ? 1 : dk); Pt(o.a, i);
      o.r[i] = .92 - stain * .16 + (nG[t] - .5) * .1;
    }
    return { S, m: [3, 3], a: o.a, h: o.h, r: o.r, nk: 1.1, macro: GROUND, fx: { wet: stained ? .8 : .7 } }; }; }   /* 霓虹江城: every concrete floor takes rain and the night damp (the wharf quay and the snack-street slab stayed dry in rain) */
  DEF.concrete = concrete(false); DEF.concrete_stained = concrete(true);

  function roadPaint(curb) { return (c, k) => {
    const S = 512, n = S * S, o = A(S), W = worley(S, 84, 34), nF = N(S, 64, 2, 31), nM = N(S, 6, 5, 32), nL = N(S, 2, 4, 33), nM2 = N(S, 9, 4, 36), ckf = cracks(S), wh = white(S, 37);
    const grime = [.23, .22, .2], sub = curb ? [.52, .51, .47] : [.15, .15, .16], chalk = [.93, .92, .88], stn = [.5, .5, .5], blk = [.09, .09, .09];
    for (let i = 0; i < n; i++) { const sb = sm(W.f2[i] - W.f1[i], .02, .2) * (.6 + .4 * W.id[i]), wv = nM[i] * .7 + nF[i] * .2 + (1 - sb) * .1 - (curb ? .05 : 0), worn = sm(wv, .6, .66);
      const ck = ckf[i] * sm(nM2[i], .3, .6) * (1 - worn);
      o.h[i] = mix(.62 + sb * .12 + nF[i] * .05 + wh[i] * .03, .3 + sb * .4 + nF[i] * .15, worn) - ck * .4;
      C_(c, .84 + .24 * nL[i]); Mx(chalk, .1); Mx(grime, .08 + .3 * sm(nM2[i], .3, .85) + (1 - sb) * .08);
      Mx(sub, worn * (.85 + .15 * nF[i])); if (!curb) Mx(stn, worn * sb * W.id[i] * .4); Mx(blk, ck * .7); Pt(o.a, i);
      o.r[i] = mix(.6 + .16 * nM2[i], .93, worn);
    }
    return { S, m: [1.5, 1.5], a: o.a, h: o.h, r: o.r, nk: 1.0, macro: GROUND, fx: { wet: .8 } }; }; }
  DEF.curb_paint_yellow = roadPaint(true); DEF.road_paint_white = roadPaint(false); DEF.road_paint_yellow = roadPaint(false);

  DEF.sand = (c, k) => { const SD = [.36, .3, .24], SL = [1, .99, .95], SP = [.75, .55, .4], S = 512, n = S * S, o = A(S), nL = N(S, 3, 5, 41), nM = N(S, 9, 4, 42), nW = N(S, 4, 3, 43), nD = N(S, 5, 4, 47), wh = white(S, 44), wh2 = white(S, 45), W = worley(S, 11, 46);
    for (let i = 0; i < n; i++) { const v = ((i / S) | 0) / S; let rip = .5 + .5 * Math.sin(TAU * (v * 24 + (nW[i] - .5) * 4 + (nL[i] - .5) * 2.5)); rip = rip * Math.sqrt(rip);
      const rm = sm(nM[i], .28, .6), dm = W.id[i] > .5 ? sm(W.f1[i], .32, .05) * sm(nL[i], .35, .6) : 0;
      o.h[i] = rip * rm * .42 + nL[i] * .55 + (wh[i] - .5) * .14 - dm * .45;
      C_(c, 1 + .14 * (nL[i] - .5) + .13 * (rip * rm - .25) + (wh[i] - .5) * .16 - dm * .1);
      Mk([.62, .52, .38], k, sm(nD[i], .5, .85) * .28); const g = wh2[i]; if (g > .988) Mx(SD, .4); else if (g < .008) Mx(SL, .6); else if (g > .96) Mx(SP, .2);
      Pt(o.a, i); o.r[i] = .96 - (g < .008 ? .3 : 0);
    }
    return { S, m: [2.6, 2.6], a: o.a, h: o.h, r: o.r, nk: 1.3, macro: GROUND }; };

  DEF.dirt = (c, k) => { const PA = [.5, .47, .42], PB = [.33, .29, .25], S = 512, n = S * S, o = A(S), nL = N(S, 3, 5, 51), nM = N(S, 10, 4, 52), nF = N(S, 48, 3, 53), W = worley(S, 36, 54), W2 = worley(S, 8, 55), wh = white(S, 56);
    for (let i = 0; i < n; i++) { const id = W.id[i], id2 = fr(id * 13.3), peb = id > .8 ? sm(W.f1[i], .2 * id2 + .06, .03) : 0, crk = (1 - sm(W2.f2[i] - W2.f1[i], 0, .05)) * sm(nL[i], .45, .7);
      o.h[i] = nM[i] * .5 + nF[i] * .3 + peb * .6 - crk * .5 + wh[i] * .1;
      C_(c, .78 + .4 * nL[i] + .25 * (nF[i] - .5) + .1 * (wh[i] - .5)); Mk([.55, .48, .38], k, .2 * nM[i]); Mx(id2 > .5 ? PA : PB, peb * .8); Mx([.16, .13, .1], crk * .7); Pt(o.a, i); o.r[i] = .97 - peb * .15; }
    return { S, m: [2.5, 2.5], a: o.a, h: o.h, r: o.r, nk: 1.4, macro: GROUND }; };

  function strokesMat(kind) { return (c, k) => {
    const S = 512, n = S * S, o = A(S), cA = canvas(S, S), cH = canvas(S, S), gA = cA.getContext('2d'), gH = cH.getContext('2d'), r = GT.rng(kind), nL = N(S, 3, 4, 58), nM = N(S, 9, 4, 59);
    const col = (p, l) => `rgb(${cl(p[0] * k[0] * l, 0, 1) * 255 | 0},${cl(p[1] * k[1] * l, 0, 1) * 255 | 0},${cl(p[2] * k[2] * l, 0, 1) * 255 | 0})`;
    gH.fillStyle = '#000'; gH.fillRect(0, 0, S, S);
    if (kind === 'grass') { const dry = [[.68, .62, .4], [.6, .55, .35], [.74, .7, .5], [.5, .42, .27], [.56, .54, .32]], grn = [[.4, .45, .23], [.33, .41, .2], [.47, .5, .27], [.29, .35, .18]];
      gA.fillStyle = col([.42, .36, .25], 1); gA.fillRect(0, 0, S, S); gA.lineCap = gH.lineCap = 'round'; const NB = 11000;
      for (let i = 0; i < NB; i++) { const x = r() * S, y = r() * S, a = r() * TAU, l = 8 + r() * 26, w = .9 + r() * 1.1, bend = (r() - .5) * 1.2, patch = nL[(y | 0) * S + (x | 0)];
        const p = r() < .06 + sm(patch, .4, .8) * .45 ? grn[(r() * grn.length) | 0] : dry[(r() * dry.length) | 0], cs = col(p, .7 + .5 * r()), hv = 40 + (i / NB) * 215 | 0, hs = `rgb(${hv},${hv},${hv})`;
        wrap(S, x, y, 50, (X, Y) => { const mx = X + Math.cos(a + bend) * l * .5, my = Y + Math.sin(a + bend) * l * .5, ex = X + Math.cos(a) * l, ey = Y + Math.sin(a) * l;
          gA.strokeStyle = cs; gA.lineWidth = w; gA.beginPath(); gA.moveTo(X, Y); gA.quadraticCurveTo(mx, my, ex, ey); gA.stroke(); gH.strokeStyle = hs; gH.lineWidth = w; gH.beginPath(); gH.moveTo(X, Y); gH.quadraticCurveTo(mx, my, ex, ey); gH.stroke(); }); }
    } else { const pal = [[.15, .22, .11], [.12, .19, .1], [.19, .25, .12], [.1, .16, .09], [.22, .27, .13], [.26, .27, .14]];   /* g6: olive, a third less chroma; the bright yellow-green strokes read as paint */
      gA.fillStyle = col([.04, .08, .04], 1); gA.fillRect(0, 0, S, S); const NB = 5200;
      for (let i = 0; i < NB; i++) { const x = r() * S, y = r() * S, a = r() * TAU, rx = 9 + r() * 10, ry = rx * (.3 + r() * .2), p = pal[(r() * pal.length) | 0], depth = i / NB, l = (.35 + .75 * depth) * (.8 + .4 * r()), hv = 30 + depth * 225 | 0;
        wrap(S, x, y, 24, (X, Y) => { gA.save(); gA.translate(X, Y); gA.rotate(a); gA.fillStyle = col(p, l * .78); gA.beginPath(); gA.ellipse(0, 0, rx, ry, 0, 0, TAU); gA.fill(); gA.fillStyle = col(p, l * 1.12); gA.beginPath(); gA.ellipse(0, -ry * .3, rx * .86, ry * .52, 0, 0, TAU); gA.fill();
          gA.strokeStyle = col(p, l * 1.4); gA.lineWidth = .8; gA.beginPath(); gA.moveTo(-rx, 0); gA.lineTo(rx, 0); gA.stroke(); gA.restore();
          gH.save(); gH.translate(X, Y); gH.rotate(a); const gr = gH.createRadialGradient(0, 0, 0, 0, 0, rx); gr.addColorStop(0, `rgb(${hv},${hv},${hv})`); gr.addColorStop(1, `rgb(${hv * .7 | 0},${hv * .7 | 0},${hv * .7 | 0})`); gH.fillStyle = gr; gH.beginPath(); gH.ellipse(0, 0, rx, ry, 0, 0, TAU); gH.fill(); gH.restore(); }); } }
    const da = gA.getImageData(0, 0, S, S).data, dh = gH.getImageData(0, 0, S, S).data;
    for (let i = 0; i < n; i++) { const j = i * 4, hh = dh[j] / 255, l = (.82 + .36 * nL[i]) * (.9 + .2 * nM[i]) * (kind === 'grass' ? .78 + .4 * hh : .55 + .6 * hh);
      o.a[j] = da[j] * l; o.a[j + 1] = da[j + 1] * l; o.a[j + 2] = da[j + 2] * l; o.a[j + 3] = 255; o.h[i] = hh; o.r[i] = kind === 'grass' ? .9 : .58 + .3 * (1 - hh); }
    return { S, m: kind === 'grass' ? [1.5, 1.5] : [1.1, 1.1], a: o.a, h: o.h, r: o.r, nk: kind === 'grass' ? 1.1 : 1.6, macro: kind === 'grass' ? GROUND : WALL }; }; }
  DEF.grass_dry = strokesMat('grass'); DEF.foliage = strokesMat('foliage');

  DEF.palm_leaf = (c, k) => { const S = 512, n = S * S, o = A(S), nM = N(S, 5, 4, 61), nF = fbm(S, 256, 2, 2, 62), nL = N(S, 2, 3, 63), nS = N(S, 24, 2, 64), yel = [.5 * k[0], .5 * k[1], .22 * k[2]], dryC = [.56, .47, .27], brn = [.28, .21, .12];
    for (let i = 0; i < n; i++) { const u = (i % S) / S, t = u * 12 + (nL[i] - .5) * .5, fx = fr(t), pid = hashI(Math.floor(t) % 12, 3, 65), pl = 1 - Math.abs(2 * fx - 1), edge = sm(pl, .1, 0), dry = sm(nM[i] + (pid - .5) * .3, .72, .9), spot = sm(nS[i], .84, .9);
      o.h[i] = pl * .7 + nF[i] * .22 - edge * .5; C_(c, (.66 + .28 * pl) * (.82 + .36 * pid) * (.86 + .28 * nF[i])); Mx(yel, .1 + .22 * nL[i]); Mx(dryC, dry * .7); Mx(brn, spot * .5 + edge * .5); Pt(o.a, i); o.r[i] = .42 + .3 * dry + .14 * nF[i] + edge * .3; }
    return { S, m: [.5, .5], a: o.a, h: o.h, r: o.r, nk: 1.5, macro: SMALL }; };

  DEF.palm_trunk = (c, k) => { const S = 512, n = S * S, o = A(S), nA = fbm(S, 5, 1, 3, 66), fib = fbm(S, 160, 3, 2, 67), nL = N(S, 3, 4, 68), ck = fbm(S, 48, 2, 3, 69), wh = white(S, 60), grey = [.64 * k[0], .62 * k[1], .58 * k[2]], dark = [.1, .08, .06];
    for (let i = 0; i < n; i++) { const v = ((i / S) | 0) / S, ry = v * 16 + (nA[i] - .5) * .7 + (fib[i] - .5) * .12, fy = fr(ry), rid = hashI(Math.floor(ry) % 16, 5, 70), crack = sm(ck[i], .66, .8), lip = sm(fy, .78, .95) * sm(fy, 1, .96);
      o.h[i] = Math.pow(fy, .6) * .7 + fib[i] * .4 - crack * .35 - sm(fy, .12, 0) * .6 + (wh[i] - .5) * .1;
      C_(c, (.66 + .4 * fy) * (.72 + .5 * fib[i]) * (.86 + .28 * rid)); Mx(grey, .18 + .3 * nL[i] + lip * .25); const d = sm(fy, .16, 0) * .85 + crack * .5; Mx(dark, d > 1 ? 1 : d); Pt(o.a, i); o.r[i] = .95; }
    return { S, m: [.9, .6], a: o.a, h: o.h, r: o.r, nk: 2.0, macro: WALL }; };

  function stucco() { return (c, k) => { const S = 1024, n = S * S;
    const F = shared('stucco', () => { const nA = N(S, 16, 5, 141, .55), nB = N(S, 44, 3, 142), nG = N(512, 128, 2, 143), wh = white(512, 140), nX = N(S, 2, 3, 145), ck = cracks(S), h = new Float32Array(n), r = new Float32Array(n), cf = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i & 1023, y = i >> 10, t = ((y & 511) << 9) | (x & 511), pl = sm(nA[i], .44, .54), crk = 0, gr = nG[t] * .6 + wh[t] * .4; cf[i] = gr;
        h[i] = .13 * pl + .16 * nB[i] + (.5 - .25 * pl) * gr; r[i] = .95 - pl * .08 + (gr - .5) * .1; }
      return { h, r, ck: cf }; });
    const a = new Uint8ClampedArray(n * 4), nL = N(S, 2, 5, 146), nL2 = N(S, 3, 4, 147), nM = N(S, 6, 4, 148), st = fbm(S, 56, 2, 4, 149), st2 = fbm(S, 18, 1, 3, 150), g = (c[0] + c[1] + c[2]) / 3, cc = [mix(c[0], g, .12), mix(c[1], g, .12), mix(c[2], g, .12)], h = F.h;
    const chalk = [.95, .93, .9], wsC = [.36, .33, .28], dirt = [.5, .45, .38], crC = [.2, .18, .16];
    for (let i = 0; i < n; i++) { C_(cc, (.93 + .18 * (nL[i] - .5) + .1 * (nM[i] - .5)) * (.8 + .36 * F.ck[i]));
      Mx(chalk, .06 + .24 * sm(nL2[i], .35, .85));
      const ws = sm(st[i] * .7 + st2[i] * .3, .52, .78) * sm(nM[i], .25, .7); Mx(wsC, ws * .4); Mx(dirt, .1 * nM[i] + (1 - F.ck[i]) * .08); Pt(a, i); }
    return { S, m: [2.2, 2.2], a, h: F.h, r: F.r, nk: 1.7, key: 'stucco', macro: WALL }; }; }
  DEF.stucco_pink = DEF.stucco_teal = DEF.stucco_cream = DEF.stucco_white = stucco();

  DEF.cinderblock = (c, k) => { const S = 1024, n = S * S, o = A(S), nP = N(512, 128, 2, 71), nF = N(S, 40, 3, 72), nG = N(512, 64, 2, 73), nL = N(S, 2, 4, 74), nM = N(S, 7, 4, 75), st = fbm(S, 48, 2, 3, 76), wh = white(512, 77);
    const mort = [.68 * k[0], .66 * k[1], .61 * k[2]], grime = [.3, .28, .25], eff = [.9, .9, .87];
    for (let i = 0; i < n; i++) { const x = i & 1023, y = i >> 10, t = ((y & 511) << 9) | (x & 511); brickAt(x / S, y / S, 4, 8, .4, .2, .5, 78); const e = bE + (nG[t] - .5) * .003, face = sm(e, .0045, .008), pore = sm(nP[t] * .6 + wh[t] * .4, .62, .78);
      o.h[i] = face * (.75 + (nF[i] - .5) * .14 - pore * .3 + (wh[t] - .5) * .05 + (bId - .5) * .08) + (1 - face) * (.4 + nG[t] * .1);
      C_(c, 1 + (bId - .5) * .16 + .16 * (nL[i] - .5) - pore * .13 + (nF[i] - .5) * .08 + (wh[t] - .5) * .06); Mx(mort, (1 - face) * .92); Mx(eff, sm(nM[i], .62, .88) * .14 * face);
      Mx(grime, sm(st[i], .58, .85) * .32 + sm(e, .02, .004) * .12); Pt(o.a, i); o.r[i] = .96 - (1 - face) * .05; }
    return { S, m: [1.6, 1.6], a: o.a, h: o.h, r: o.r, nk: 1.0, macro: WALL }; };

  DEF.brick_painted = (c, k) => { const S = 1024, n = S * S, o = A(S), nF = N(S, 48, 3, 81), nG = N(512, 128, 2, 82), nL = N(S, 2, 4, 83), nM = N(S, 9, 5, 84), st = fbm(S, 48, 2, 3, 85), wh = white(512, 87);
    const chalk = [.95, .94, .9], grime = [.3, .28, .25];
    for (let i = 0; i < n; i++) { const x = i & 1023, y = i >> 10, t = ((y & 511) << 9) | (x & 511); brickAt(x / S, y / S, 8, 16, .2, .075, .5, 86); const e = bE + (nG[t] - .5) * .004 + (nF[i] - .5) * .003, face = sm(e, .002, .0055), nearEdge = sm(e, .016, .004);
      const chip = sm(nM[i] * .6 + nF[i] * .2 + nearEdge * .06 + (bId - .5) * .3, .73, .76) * face;   /* g6: far fewer chips, and the brick under the paint is a dull red-brown (the saturated orange read as debug markers) */
      o.h[i] = face * (.74 + (bId - .5) * .14 + (nF[i] - .5) * .1 - nearEdge * .08 + chip * (-.1 + (nG[t] - .5) * .4) + (nG[t] - .5) * .1 + (wh[t] - .5) * .05) + (1 - face) * (.38 + nG[t] * .12);
      C_(c, 1 + (bId - .5) * .07 + .14 * (nL[i] - .5) + (nG[t] - .5) * .05); Mx(chalk, .08); Mx(grime, (1 - face) * .5 + sm(st[i], .56, .86) * .3 + nearEdge * .1);
      const b = (.78 + .45 * bId) * (.8 + .2 * nG[t]) * chip; cr += (.4 * b / chip - cr) * chip || 0; cg += (.27 * b / chip - cg) * chip || 0; cb += (.22 * b / chip - cb) * chip || 0; Pt(o.a, i); o.r[i] = mix(.66 + .12 * nF[i], .94, Math.max(chip, 1 - face)); }
    return { S, m: [1.6, 1.2], a: o.a, h: o.h, r: o.r, nk: 1.6, macro: WALL }; };

  DEF.roof_tile_clay = (c, k) => { const LI = [.66, .68, .58], S = 512, n = S * S, o = A(S), nL = N(S, 2, 4, 91), nM = N(S, 7, 4, 92), nF = N(S, 64, 2, 93), W = worley(S, 90, 94), st = fbm(S, 40, 2, 3, 95);
    for (let i = 0; i < n; i++) { const u = (i % S) / S, v = ((i / S) | 0) / S, tx = u * 5, col = Math.floor(tx), fx = tx - col, ty = v * 2, row = Math.floor(ty), fy = ty - row, cap = fx < .62; let hc;
      if (cap) { const a = (fx - .31) / .31; hc = Math.sqrt(Math.max(0, 1 - a * a)); } else { const a = (fx - .81) / .19; hc = -.4 * Math.sqrt(Math.max(0, 1 - a * a)); }
      const id = hashI(col + (cap ? 0 : 7), row, 96), id2 = fr(id * 17.7), lip = sm(fy, .05, 0);
      o.h[i] = hc * (.8 + .2 * fy) + (1 - fy) * .32 + (nF[i] - .5) * .06 + (id - .5) * .06;
      C_(c, (.7 + .4 * id) * (.88 + .24 * nL[i]) * (.9 + .2 * nF[i])); Mk([.7, .5, .36], k, id2 * .4); Mx([.8, .72, .64], sm(nM[i], .6, .9) * .22);
      Mx([.17, .14, .12], cl(sm(st[i] * .6 + nM[i] * .4, .46, .78) * .6 + (cap ? 0 : .3) + lip * .5, 0, 1)); if (W.id[i] > .93) Mx(LI, sm(W.f1[i], .3, .1) * .35 * nM[i]); Pt(o.a, i); o.r[i] = .82 + .1 * nF[i]; }
    return { S, m: [1, .8], a: o.a, h: o.h, r: o.r, nk: 3.2, macro: WALL }; };

  /* box-profile sheet: 5 trapezoid ribs per metre (20 cm pitch, was a 7.6 cm sine that beat against the pixel grid at wall distance). The rib shading is also baked
     into the albedo so the sheet still reads once the normal map has mipped flat, and the paint is mostly dielectric so steep rib flanks stop mirroring the sky. */
  DEF.corrugated_metal = (c, k) => { const S = 512, n = S * S, o = A(S), mt = new Float32Array(n), nM = N(S, 5, 5, 101), nF = N(S, 48, 3, 102), nL = N(S, 2, 3, 103), W = worley(S, 26, 104, 52), st = fbm(S, 64, 2, 3, 105), st2 = fbm(S, 40, 1, 3, 106), RIBS = 5;
    for (let i = 0; i < n; i++) { const x = i % S, y = (i / S) | 0, u = x / S, v = y / S, ru = fr(u * RIBS), rd = Math.abs(ru - .5), w = sm(rd, .31, .19), flank = sm(rd, .17, .21) * sm(rd, .33, .29), lapd = Math.min(v, 1 - v) * 1.2, lap = sm(lapd, .16, 0);
      const sd = Math.hypot((ru - .5) / RIBS, (v - .045) * 1.2), screw = sm(sd, .009, .006), washer = sm(sd, .016, .012), pan = 1 - w;
      const rm = sm(nM[i] * .55 + nL[i] * .35 + nF[i] * .1, .8, .92) * .75, id = W.id[i], id2 = fr(id * 7.7), run = sm(st2[i] * .65 + st[i] * .35, .5, .82);
      o.h[i] = w + rm * (nF[i] - .5) * .1 + sm(lapd, .012, .008) * .06 + washer * .08 + screw * .08;
      C_(c, (.97 + .05 * id) * (.9 + .2 * nL[i]) * (.8 + .2 * w) * (1 - .1 * flank)); Mx([.3, .29, .27], pan * .26 * sm(st[i], .3, .8) + run * .2 + .04); Mx([.84, .85, .84], sm(nF[i], .62, .8) * .14);
      const rc = nF[i]; cr += (mix(.17, .28, rc) - cr) * rm; cg += (mix(.12, .19, rc) - cg) * rm; cb += (mix(.09, .13, rc) - cb) * rm; Mx([.16, .15, .14], sm(lapd, .006, .002) * .55); if (washer > 0) Mx([.62, .63, .63], washer * (1 - rm) * .3); Pt(o.a, i);
      o.r[i] = mix(.66 + .05 * id2 + pan * .08 + .12 * nL[i] + run * .1, .93, rm); mt[i] = 0; }
    return { S, m: [1, 1.2], a: o.a, h: o.h, r: o.r, nk: 3.0, macro: [1 / 5.3, 1 / 23, .26, .12] }; };

  DEF.metal_galv = (c, k) => { const OXC = [.84, .85, .84], RSC = [.4, .23, .13], S = 512, n = S * S, o = A(S), mt = new Float32Array(n), W = worley(S, 24, 111), nM = N(S, 5, 4, 112), nF = N(S, 64, 2, 113), nL = N(S, 2, 4, 114);
    for (let i = 0; i < n; i++) { const x = i % S, y = (i / S) | 0, id = W.id[i], id2 = fr(id * 11.3), a = id * Math.PI, fe = .5 + .5 * Math.sin((x * Math.cos(a) + y * Math.sin(a)) * (.5 + id2 * .6));
      const ox = sm(nM[i], .58, .8), rs = sm(nF[i], .8, .88) * sm(nL[i], .55, .7);
      o.h[i] = .5 + (nL[i] - .5) * .25 + ox * (nF[i] - .5) * .2 + rs * .15;
      C_(c, .96 + .05 * id + (fe - .5) * .012 + .08 * (nL[i] - .5)); Mx(OXC, ox * .4); Mx(RSC, rs * .8); Pt(o.a, i); o.r[i] = .38 + .04 * id2 + (fe - .5) * .012 + .1 * nL[i] + ox * .32 + rs * .4; mt[i] = 1 - rs - ox * .3; }
    return { S, m: [.6, .6], a: o.a, h: o.h, r: o.r, mt, nk: .5, macro: METAL }; };

  function paintedMetal() { return (c, k) => { const S = 512, n = S * S;
    const F = shared('mpaint', () => { const op = N(S, 56, 2, 121), nC = N(S, 5, 5, 122, .6), nF = N(S, 64, 3, 124), nM = N(S, 5, 4, 125), W = worley(S, 26, 123), sc = scratch(S), h = new Float32Array(n), r = new Float32Array(n), cc = new Float32Array(n), rg = new Float32Array(n), rs = new Float32Array(n);
      for (let i = 0; i < n; i++) { const id = W.id[i], id2 = fr(id * 31.3), spot = id > .93 ? sm(W.f1[i] + (nF[i] - .5) * .12, .04 + .14 * id2, .02 + .05 * id2) : 0, m0 = nC[i] + (nF[i] - .5) * .14;
        const core = Math.max(sm(m0, .80, .815), sm(spot, .5, .75)), ring = Math.max(sm(m0, .775, .792), sm(spot, .05, .3)); cc[i] = core; rg[i] = ring;
        h[i] = .6 + (op[i] - .5) * .1 - ring * .16 - core * .14 + core * (nF[i] - .5) * .5 - sc[i] * .08 * (1 - ring); r[i] = mix(mix(.34 + .16 * nM[i] + .1 * sc[i], .72, ring), .93, core); }
      for (let x = 0; x < S; x++) { let s = 0; for (let p = 0; p < 2; p++) for (let y = S - 1; y >= 0; y--) { const i = y * S + x; s = Math.max(cc[i], s * .975 - .004); if (p) rs[i] = s; } }
      return { h, r, cc, rg, rs, sc }; });
    const a = new Uint8ClampedArray(n * 4), nL = N(S, 2, 4, 126), nL2 = N(S, 3, 4, 127), nM = N(S, 5, 4, 125), nF = N(S, 64, 3, 124), st = fbm(S, 40, 2, 3, 128), g = (c[0] + c[1] + c[2]) / 3, cc = [mix(c[0], g, .1), mix(c[1], g, .1), mix(c[2], g, .1)];
    const chalk = [.92, .92, .9], grime = [.25, .24, .22], scr = [.8, .8, .8], rstain = [.45, .25, .12], primer = [.6, .57, .53];
    for (let i = 0; i < n; i++) { const ring = F.rg[i], core = F.cc[i]; C_(cc, .9 + .18 * nL[i]); Mx(chalk, .04 + .1 * nL2[i]); Mx(grime, .04 + .13 * sm(st[i], .45, .9) * nM[i]); Mx(scr, F.sc[i] * .16);
      Mx(rstain, F.rs[i] * (1 - ring) * .4 * (.3 + st[i])); Mx(primer, ring); const f = nF[i]; cr += (mix(.17, .36, f) - cr) * core; cg += (mix(.09, .19, f) - cg) * core; cb += (mix(.06, .1, f) - cb) * core; Pt(a, i); }
    return { S, m: [1, 1], a, h: F.h, r: F.r, nk: 1.0, key: 'mpaint', macro: METAL }; }; }
  DEF.metal_painted_white = DEF.metal_painted_red = DEF.metal_painted_blue = DEF.metal_painted_yellow = paintedMetal();

  DEF.metal_dark = (c, k) => { const S = 512, n = S * S, o = A(S), mt = new Float32Array(n), nG = N(S, 128, 2, 131), nM = N(S, 6, 5, 132), nL = N(S, 2, 4, 133), nL2 = N(S, 3, 4, 134), sc = scratch(S), wr = [.44, .44, .46], du = [.36, .33, .28];
    for (let i = 0; i < n; i++) { const wear = sm(nM[i] + (nG[i] - .5) * .3, .64, .78); o.h[i] = .5 + (nG[i] - .5) * .3 - sc[i] * .2;
      C_(c, .85 + .4 * nL[i]); Mx(wr, wear * .45 + sc[i] * .2); Mx(du, .12 * sm(nL2[i], .4, .9)); Pt(o.a, i); o.r[i] = .52 + .16 * (nG[i] - .5) - wear * .18 + .12 * nL2[i]; mt[i] = .6 + wear * .4; }
    return { S, m: [.8, .8], a: o.a, h: o.h, r: o.r, mt, nk: .3, macro: METAL }; };

  DEF.metal_rust = (c, k) => { const S = 512, n = S * S, o = A(S), mt = new Float32Array(n), nL = N(S, 3, 5, 136), nM = N(S, 9, 5, 137), nF = N(S, 40, 3, 138), nP = N(S, 128, 2, 135), wh = white(S, 140), st = fbm(S, 48, 2, 3, 139);
    const p0 = [.15, .09, .07], p1 = [.33, .18, .11], p2 = [.47, .27, .14], p3 = [.58, .4, .23], steel = [.22, .19, .18];
    for (let i = 0; i < n; i++) { const t = nM[i] * .55 + nF[i] * .3 + nL[i] * .15, pit = sm(nP[i], .62, .8), bare = sm(nL[i], .74, .9), run = sm(st[i], .55, .85) * .25;
      o.h[i] = t * .5 + nF[i] * .3 - pit * .35 + wh[i] * .12;
      if (t < .42) { C_(p0, 1); Mx(p1, sm(t, .2, .42)); } else if (t < .62) { C_(p1, 1); Mx(p2, sm(t, .42, .62)); } else { C_(p2, 1); Mx(p3, sm(t, .62, .9)); }
      Ml(.8 + .3 * wh[i]); Mx(p0, pit * .5 + run); Mx(steel, bare * .8); cr *= k[0]; cg *= k[1]; cb *= k[2]; Pt(o.a, i); o.r[i] = .94 - bare * .35; mt[i] = bare * .7; }
    return { S, m: [1, 1], a: o.a, h: o.h, r: o.r, mt, nk: 1.3, macro: METAL }; };

  DEF.chrome = (c, k) => { const S = 512, n = S * S, o = A(S), mt = new Float32Array(n).fill(1), nM = N(S, 5, 4, 151), W = worley(S, 30, 152), sc = scratch(S);
    for (let i = 0; i < n; i++) { const id = W.id[i], pit = id > .975 ? sm(W.f1[i], .12, .03) : 0; C_(c, 1); cr -= pit * .5; cg -= pit * .6; cb -= pit * .7; Pt(o.a, i); o.r[i] = .045 + .1 * sm(nM[i], .5, .95) + sc[i] * .16 + pit * .6; mt[i] = 1 - pit * .7; }
    return { S, m: [.5, .5], a: o.a, r: o.r, mt, macro: [1 / 1.3, 1 / .41, .03, .3] }; };

  DEF.aluminium_brushed = (c, k) => { const S = 512, n = S * S, o = A(S), mt = new Float32Array(n).fill(1), l1 = fbm(S, 1, 512, 1, 155), l2 = fbm(S, 2, 256, 2, 156), nM = N(S, 4, 4, 157);
    for (let i = 0; i < n; i++) { const b = l1[i] * .5 + l2[i] * .5; o.h[i] = b; C_(c, .95 + .08 * b); Pt(o.a, i); o.r[i] = .3 + .1 * b + .1 * sm(nM[i], .5, .9); }
    return { S, m: [.4, .4], a: o.a, h: o.h, r: o.r, mt, nk: .3, macro: METAL }; };

  DEF.rubber = (c, k, opt) => { const S = 512, n = S * S, o = A(S), nG = N(S, 128, 2, 161), nM = N(S, 5, 4, 162), W = worley(S, 96, 163), dust = [.33, .3, .25];
    if (opt && opt.tread) { for (let i = 0; i < n; i++) { const u = (i % S) / S, v = ((i / S) | 0) / S, av = Math.abs(v - .5), rib = Math.min(Math.abs(av - .14), Math.abs(av - .34)), groove = sm(rib, .028, .016), ch = fr(u * 5 + av * 1.6 * (av > .14 ? 1 : -1)), sipe = sm(Math.abs(ch - .5), .07, .04) * (av > .05 ? 1 : 0);
        const blk = 1 - Math.max(groove, sipe), sh = sm(av, .42, .5); o.h[i] = blk * (1 - sh * .7) + nG[i] * .06;
        C_(c, 1.2 + .3 * (nM[i] - .5) + blk * .5); Mx(dust, (1 - blk) * .08 + .015 + .04 * nM[i]); Pt(o.a, i); o.r[i] = .8 + .12 * (1 - blk); }
      return { S, m: [.2, .24], a: o.a, h: o.h, r: o.r, nk: 2.2, key: 'tread', macro: SMALL }; }
    for (let i = 0; i < n; i++) { o.h[i] = .5 + (nG[i] - .5) * .4 + (1 - W.f1[i]) * .16; C_(c, 1.5 + .5 * (nM[i] - .5) + .3 * (nG[i] - .5)); Mx(dust, .025 + .08 * sm(nM[i], .4, .9)); Pt(o.a, i); o.r[i] = .8 + .14 * nG[i]; }
    return { S, m: [.25, .25], a: o.a, h: o.h, r: o.r, nk: .7, macro: SMALL }; };

  function plastic() { return (c, k) => { const GREY = [.6, .6, .6], S = 512, n = S * S;
    const F = shared('plastic', () => { const W = worley(S, 128, 171), nG = N(S, 128, 1, 172), h = new Float32Array(n), r = new Float32Array(n); for (let i = 0; i < n; i++) { h[i] = sm(W.f1[i], .7, .1) * .6 + nG[i] * .4; r[i] = .56 - .14 * h[i]; } return { h, r, nG }; });
    const a = new Uint8ClampedArray(n * 4), lum = (c[0] + c[1] + c[2]) / 3, lift = lum < .15 ? .025 : 0;
    for (let i = 0; i < n; i++) { C_(c, .93 + .1 * F.nG[i] + .05 * F.h[i]); cr += lift; cg += lift; cb += lift; Mx(GREY, .1); Pt(a, i); }
    return { S, m: [.12, .12], a, h: F.h, r: F.r, nk: .8, key: 'plastic', macro: SMALL }; }; }
  DEF.plastic_black = DEF.plastic_white = DEF.plastic_red = DEF.plastic_grey = plastic();

  function wood(painted) { return (c, k) => { const S = 512, n = S * S, o = A(S), gA = fbm(S, 2, 24, 4, 181), gF = fbm(S, 6, 256, 2, 182), nL = N(S, 2, 4, 183), pe = fbm(S, 5, 20, 4, 184), Wk = worley(S, 5, 185, 6), wh = white(S, 186);
    const grey = [.5, .49, .46], wc = painted ? [.5, .43, .34] : c;
    for (let i = 0; i < n; i++) { const x = i % S, y = (i / S) | 0, v = y / S, pv = v * 6, pi = Math.floor(pv), fy = pv - pi, pid = hashI(pi, 1, 187), xs = (x + ((pid * S) | 0)) % S, j = y * S + xs, u = xs / S;
      const lines = .5 + .5 * Math.sin(TAU * (fy * 3 + gA[j] * 7 + pid * 7)), ge = Math.min(fy, 1 - fy) * .14, gap = sm(ge, .004, .0012), u0 = hashI(pi, 2, 187); let du = Math.abs(x / S - u0); du = Math.min(du, 1 - du) * 1.5; const joint = sm(du, .003, .001);
      const kn = Wk.id[j] > .55 ? sm(Wk.f1[j], .1, .03) : 0, knr = kn > 0 ? .5 + .5 * Math.sin(Wk.f1[j] * 150) : 0;
      const nd = Math.hypot(du - .035, (Math.abs(fy - .5) - .28) * .14), nail = sm(nd, .0045, .003), nst = sm(nd, .03, .004);
      const hw = .5 + (lines - .5) * .22 + (gF[j] - .5) * .3 - kn * .1 + knr * kn * .1;
      C_(wc, (.72 + .22 * lines + .3 * (gF[j] - .5)) * (.84 + .32 * pid)); Mk(grey, painted ? [1, 1, 1] : k, .22 + .34 * nL[i]); Mx([.2, .13, .08], kn * (.6 + .3 * knr));
      let hh = hw, rr = .84;
      if (painted) { const peel = sm(pe[j] + (1 - lines) * .06 + sm(ge, .02, 0) * .12 + (pid - .5) * .16 + (gF[j] - .5) * .1, .62, .67), p = 1 - peel; hh = mix(hw, .62 + (hw - .5) * .35, p) + p * .08;
        const wr = cr, wg = cg, wb = cb; C_(c, .9 + .12 * nL[i] + .06 * (gF[j] - .5)); Mx([.3, .28, .25], (1 - lines) * .1 + .04); cr = mix(wr, cr, p); cg = mix(wg, cg, p); cb = mix(wb, cb, p); rr = mix(.86, .62, p); }
      Mx([.42, .22, .1], nst * .4); Mx([.12, .1, .09], nail); Mx([.05, .04, .04], cl(gap + joint * .85, 0, 1)); Pt(o.a, i);
      o.h[i] = hh - gap * 1.2 - joint * .9 + nail * .1 + (wh[i] - .5) * .04; o.r[i] = rr; }
    return { S, m: [1.5, .84], a: o.a, h: o.h, r: o.r, nk: 1.2, macro: WALL }; }; }
  DEF.wood_plank = wood(false); DEF.wood_painted = wood(true);

  DEF.tile_floor = (c, k) => { const S = 512, n = S * S, o = A(S), f1 = fbm(S, 256, 96, 2, 191), f2 = fbm(S, 96, 256, 2, 192), nM = N(S, 5, 5, 193), nL = N(S, 2, 4, 194), nG = N(S, 128, 2, 195), sc = scratch(S);
    const dkC = [.56 * k[0], .57 * k[1], .56 * k[2]], ltC = [.97, .97, .95], dirtC = [.32, .3, .27], blk = [.1, .1, .1];
    for (let i = 0; i < n; i++) { brickAt((i % S) / S, ((i / S) | 0) / S, 4, 4, .3, .3, 0, 196); const seam = sm(bE, .003, .0012), s = sc[i], fl = (bId > .5 ? f1[i] : f2[i]), dk = sm(fl, .6, .8), lt = sm(1 - fl, .64, .82);
      const dirt = sm(bE, .03, 0) * .3 + sm(nM[i], .45, .9) * .22;
      o.h[i] = .6 - seam * .7 + (nG[i] - .5) * .02 - sm(bE, .01, 0) * .04 - s * .04;
      C_(c, 1 + (bId - .5) * .07 + .06 * (nL[i] - .5)); Mx(dkC, dk * .34); Mx(ltC, lt * .3); Mx(dirtC, dirt); Mx(blk, seam * .8 + s * .1); Pt(o.a, i);
      o.r[i] = .2 + .28 * nM[i] + .2 * s + seam * .6 + dirt * .5; }
    return { S, m: [1.2, 1.2], a: o.a, h: o.h, r: o.r, nk: .8, macro: [1 / 6.3, 1 / 2.1, .1, .3] }; };

  DEF.terrazzo = (c, k) => { const S = 512, n = S * S, o = A(S), mt = new Float32Array(n), W = worley(S, 44, 201), W2 = worley(S, 110, 202), nF = N(S, 64, 2, 203), nM = N(S, 5, 4, 204);
    const pal = [[.84, .81, .75], [.5, .49, .47], [.62, .52, .44], [.26, .26, .27], [.9, .88, .84], [.7, .65, .56], [.44, .46, .45]], brass = [.72, .56, .27];
    for (let i = 0; i < n; i++) { const u = (i % S) / S, v = ((i / S) | 0) / S, id = W.id[i], id2 = W2.id[i], c1 = id < .6 ? sm(W.f2[i] - W.f1[i], .1, .16) : 0, c2 = id2 < .5 ? sm(W2.f2[i] - W2.f1[i], .12, .22) : 0;
      const sd = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)) * .8, strip = sm(sd, .0025, .0014), f = .9 + .2 * nF[i];
      C_(c, .95 + .1 * nF[i]); Mx(pal[(id2 * 14 | 0) % 7], c2 * .85); const p = pal[(id * 21 | 0) % 7]; cr += (p[0] * f - cr) * c1; cg += (p[1] * f - cg) * c1; cb += (p[2] * f - cb) * c1; Mx(brass, strip); Pt(o.a, i);
      o.h[i] = .5 + Math.max(c1, c2) * .03 + (nF[i] - .5) * .03 + strip * .04; o.r[i] = .3 - Math.max(c1, c2) * .1 + .16 * nM[i] - strip * .05; mt[i] = strip; }
    return { S, m: [.8, .8], a: o.a, h: o.h, r: o.r, mt, nk: .5, macro: [1 / 6.3, 1 / 2.1, .1, .3] }; };

  DEF.ceiling_panel = (c, k) => { const S = 512, n = S * S, o = A(S), fz = fissure(S), nL = N(S, 2, 4, 211), nM = N(S, 4, 4, 212), nG = N(S, 128, 2, 213);
    for (let i = 0; i < n; i++) { const u = (i % S) / S, v = ((i / S) | 0) / S; brickAt(u, v, 2, 2, .6, .6, 0, 214); const bar = sm(bE, .0135, .0115), ao = sm(bE, .035, .012) * (1 - bar), f = fz[i];
      const d = Math.hypot(u - .3, v - .72) * 1.2 + (nM[i] - .5) * .18, ring = sm(d, .15, .19) * sm(d, .235, .195), inside = sm(d, .2, .12), wet = (bCol === 0 && bRow === 1) ? 1 : 0;
      o.h[i] = bar ? .5 + bar * .4 : .5 - f * .45 + (nG[i] - .5) * .1;
      C_(c, 1 + (bId - .5) * .05 + .05 * (nL[i] - .5) - f * .26 * (1 - bar) - ao * .22 + (nG[i] - .5) * .05); Mx([.62, .5, .32], wet * (1 - bar) * (ring * .55 + inside * .2)); Mk([.9, .9, .88], k, bar); Mx([.7, .68, .62], bar * .1 * nM[i]); Pt(o.a, i); o.r[i] = mix(.96, .45, bar); }
    return { S, m: [1.2, 1.2], a: o.a, h: o.h, r: o.r, nk: 1.3, macro: [1 / 6.3, 1 / 2.1, .06, .05] }; };

  DEF.fabric_dark = (c, k) => { const S = 512, n = S * S, o = A(S), TN = 96, wh = white(S, 221), wh2 = white(S, 222), nM = N(S, 4, 3, 223), lt = [.34, .36, .42];
    for (let i = 0; i < n; i++) { const u = (i % S) / S * TN, v = ((i / S) | 0) / S * TN, ix = Math.floor(u), iy = Math.floor(v), tx = u - ix, ty = v - iy, over = ((ix + iy) & 3) < 2, sx = Math.sin(Math.PI * tx), sy = Math.sin(Math.PI * ty);
      const hh = (over ? sx * (.55 + .45 * sy) : sy * (.55 + .45 * sx)) * (over ? 1 : .82), th = over ? hashI(ix, 0, 224) : hashI(iy, 1, 224);
      o.h[i] = hh + (wh[i] - .5) * .22; C_(c, (.6 + .95 * hh) * (.85 + .3 * wh[i]) * (.9 + .2 * nM[i])); Mk(lt, k, th > .78 ? .22 * hh : th < .15 ? 0 : .07 * hh); if (wh2[i] > .996) Mx([.6, .58, .52], .7); Pt(o.a, i); o.r[i] = .97; }
    return { S, m: [.128, .128], a: o.a, h: o.h, r: o.r, nk: 1.5, macro: [1 / .93, 1 / .31, .14, .05] }; };

  DEF.carpet = (c, k) => { const S = 512, n = S * S, o = A(S), W = worley(S, 72, 231), wh = white(S, 232), wh2 = white(S, 233), nF = N(S, 128, 2, 234), nM = N(S, 4, 4, 235);
    for (let i = 0; i < n; i++) { const hh = cl(1 - W.f1[i] * 1.25, 0, 1) * .6 + (wh[i] - .5) * .4 + nF[i] * .3;
      o.h[i] = hh; C_(c, (.55 + 1.0 * hh) * (.75 + .5 * W.id[i]) * (.88 + .24 * nM[i])); const g = wh2[i]; if (g > .992) Mx([.55, .5, .42], .75); else if (g < .004) Mx([.75, .74, .7], .6); Pt(o.a, i); o.r[i] = .98; }
    return { S, m: [.22, .22], a: o.a, h: o.h, r: o.r, nk: 1.5, macro: [1 / .93, 1 / .31, .16, .04] }; };

  function leather() { return (c, k) => { const S = 1024, n = S * S;
    const F = shared('leather', () => { const W = worley(512, 76, 241), nW = N(S, 5, 4, 242, .55), nM = N(S, 12, 4, 243), nG = N(512, 128, 2, 244), nX = N(S, 3, 3, 245), h = new Float32Array(n), r = new Float32Array(n), cre = new Float32Array(n), wr = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i & 1023, y = i >> 10, t = ((y & 511) << 9) | (x & 511), e = sm(W.f2[t] - W.f1[t], 0, .26), w = (1 - sm(Math.abs(nW[i] - .5), 0, .05)) * sm(nX[i], .5, .75); cre[i] = e; wr[i] = w;
        h[i] = e * (2 - e) * .7 * (.8 + .4 * W.id[t]) + nM[i] * .5 - w * .45 + (nG[t] - .5) * .05; r[i] = .4 + (1 - e) * .16 + w * .1 + (nG[t] - .5) * .06; }
      return { h, r, cre, wr, nM }; });
    const a = new Uint8ClampedArray(n * 4), nL = N(S, 2, 4, 246), lum = (c[0] + c[1] + c[2]) / 3, lift = lum < .15 ? .03 : 0, dk = [c[0] * .5, c[1] * .44, c[2] * .4];
    for (let i = 0; i < n; i++) { const e = F.cre[i]; C_(c, .9 + .14 * e + .12 * (F.nM[i] - .5) + .14 * (nL[i] - .5)); cr += lift; cg += lift; cb += lift; Mx(dk, (1 - e) * .32 + F.wr[i] * .2); Pt(a, i); }
    return { S, m: [.3, .3], a, h: F.h, r: F.r, nk: .85, key: 'leather', macro: [1 / .93, 1 / .31, .1, .3] }; }; }
  DEF.leather_black = DEF.leather_tan = leather();

  DEF.dash_vinyl = (c, k) => { const S = 512, n = S * S, o = A(S), W = worley(S, 96, 251, 64), nG = N(S, 128, 2, 252), nM = N(S, 4, 4, 253);
    for (let i = 0; i < n; i++) { const e = sm(W.f2[i] - W.f1[i], 0, .26); o.h[i] = Math.pow(e, .6) + nG[i] * .16; C_(c, .9 + .22 * e); cr += .02; cg += .02; cb += .02; Mx([.42, .41, .38], (1 - e) * .13 + .03 + .05 * nM[i]); Pt(o.a, i); o.r[i] = .64 - .1 * e; }
    return { S, m: [.12, .12], a: o.a, h: o.h, r: o.r, nk: 1.0, macro: [1 / .93, 1 / .31, .08, .25] }; };

  DEF.water_pool = (c, k) => { const S = 512, n = S * S, o = A(S), W = worley(S, 9, 261), W2 = worley(S, 14, 262), nW = N(S, 7, 4, 263), nW2 = N(S, 20, 3, 264);
    const wx = N(S, 4, 3, 265), wy = N(S, 4, 3, 266), wht = [.9, 1, 1];
    for (let i = 0; i < n; i++) { const x = i % S, y = (i / S) | 0, j = (((y + (wy[i] - .5) * 90) & 511) << 9) | ((x + (wx[i] - .5) * 90) & 511), j2 = (((y + (wx[i] - .5) * 70) & 511) << 9) | ((x - (wy[i] - .5) * 70) & 511);
      const ca = 1 - sm(W.f2[j] - W.f1[j], 0, .2), cb2 = 1 - sm(W2.f2[j2] - W2.f1[j2], 0, .22), ct = ca * ca * ca * .55 + cb2 * cb2 * cb2 * .45; C_(c, .86 + .45 * ct); Mx(wht, ct * .18); Pt(o.a, i); o.h[i] = nW[i] * .7 + nW2[i] * .3; o.r[i] = .05; }
    return { S, m: [2, 2], a: o.a, h: o.h, r: o.r, nk: .7 }; };

  /* ---------- colours (core.js stub palette, kept so every agent sees the tones they expect) */
  const COL = { asphalt: 0x48494c, asphalt_worn: 0x4b4b4d, concrete: 0x8f8e88, concrete_stained: 0x7c7a72, curb_paint_yellow: 0xc9a21f, road_paint_white: 0xdedcd4, road_paint_yellow: 0xd0a61e,
    sand: 0xd9c79c, grass_dry: 0xffffff, dirt: 0x6f5c45, stucco_pink: 0xe9a9a0, stucco_teal: 0x6fb8b0, stucco_cream: 0xe8dcc0, stucco_white: 0xecebe6, brick_painted: 0xb9b3a6, cinderblock: 0x9a9992,
    roof_tar: 0x2a2a2c, roof_tile_clay: 0xb5603c, corrugated_metal: 0x9aa0a4, metal_galv: 0x9da3a8, metal_painted_white: 0xe6e6e2, metal_painted_red: 0xb3242c, metal_painted_blue: 0x23539a,
    metal_painted_yellow: 0xd9a514, metal_dark: 0x202227, metal_rust: 0xffffff, chrome: 0xd8dadf, aluminium_brushed: 0xb9bcc2, rubber: 0x0f0f10, plastic_black: 0x141518, plastic_white: 0xe9e9e6,
    plastic_red: 0xb5202a, plastic_grey: 0x6d7076, glass_clear: 0xbfd9e0, glass_tint: 0x1a2630, glass_dirty: 0x9fb0b0, wood_plank: 0x8a6a48, wood_painted: 0xd8d2c2, palm_trunk: 0x7a6248, palm_leaf: 0x3f7d3a,
    foliage: 0xffffff, tile_floor: 0xc9cbc9, terrazzo: 0xb9b3aa, ceiling_panel: 0xdcdcd6, fabric_dark: 0x1b1d22, leather_black: 0x121214, leather_tan: 0x8a5f3c, dash_vinyl: 0x17181b, carpet: 0x222327, water_pool: 0x3fb6c8, car_paint: 0xb3242c };
  // for the "natural palette" materials the stub colour is the reference a custom opts.color is compared against
  const REF = { grass_dry: 0x7a7f45, metal_rust: 0x7a4326, foliage: 0x2f6b34 };
  const GLOWS = { neon_pink: [1, .16, .55], neon_cyan: [.15, .85, 1], neon_amber: [1, .6, .12], neon_white: [1, .97, .9], neon_red: [1, .1, .08], neon_green: [.2, 1, .45], light_warm: [1, .8, .52], light_cool: [.8, .9, 1], light_red: [1, .08, .05], emissive_screen: [.4, .8, 1] };

  /* ================================================================== macro variation (anti-tiling) shader hook */
  let macroT = null;
  function macroTex() { if (macroT) return macroT; const S = 256, a = N(S, 3, 5, 301), b = N(S, 4, 5, 302), c = N(S, 7, 4, 303), d = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) { d[i * 4] = a[i] * 255; d[i * 4 + 1] = b[i] * 255; d[i * 4 + 2] = c[i] * 255; d[i * 4 + 3] = 255; } return macroT = dataTex(d, S, false); }
  /* wetness shared by every ground material: x = rain (GT.env.wet, or ?wet= for stills) , y = rain or the light night damp that makes lamps and neon streak on the road */
  const QW = (() => { try { const v = new URLSearchParams(location.search).get('wet'); return v !== null && isFinite(+v) ? cl(+v, 0, 1) : null; } catch (e) { return null; } })();
  const wetV = new TH.Vector3(), wetU = { get value() { const e = GT.env, w = QW !== null ? QW : cl((e && +e.wet) || 0, 0, 1), nt = cl((e && +e.night) || 0, 0, 1); wetV.set(w, Math.max(w, QW !== null ? 0 : .14 * nt)   /* LT (user: night ground far too shiny): .32 -> .14, a dry road at night is only a little darker, it does not mirror */   /* g6 r2: the night damp is a light sheen, not a black mirror */, nt); return wetV; }, set value(v) { } };
  /** fx (optional): { wet: 0..1 how much this surface takes water (only faces that look up), rainOnly: ignore the night damp, patch: 0..1 resurfacing patches, trench cuts, oil drips and aged areas at world scale }.
      A module's own ground material (macro scale >= 15 m, e.g. the pavers) gets wet: .5 by default. Puddles only form from real rain; the night damp is a sheen only. */
  function addMacro(m, metres, mc, fx) {
    fx = fx || (mc[0] <= 1 / 15 ? { wet: .5 } : {}); const wet = +fx.wet || 0, patch = +fx.patch || 0;
    const uni = { gtMacroTex: { value: macroTex() }, gtRep: { value: new TH.Vector2(metres[0], metres[1]) }, gtMS: { value: new TH.Vector4(mc[0], mc[1], mc[2], mc[3]) }, gtFx: { value: new TH.Vector3(wet, fx.rainOnly ? 0 : 1, patch) }, gtWet: wetU };
    m.userData.gtMacro = uni; if (wet > 0 || patch > 0) { m.defines = m.defines || {}; if (wet > 0) { m.defines.GT_WET = ''; if (!m.transparent) m.defines.GT_WETA = ''; } if (patch > 0) m.defines.GT_PATCH = ''; } if (fx.world) { m.defines = m.defines || {}; m.defines.GT_WUV = ''; }
    m.onBeforeCompile = sh => { Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n#ifdef GT_WUV\nvarying vec2 vGtW;\n#endif').replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef GT_WUV\n vGtW = (modelMatrix * vec4(transformed, 1.0)).xz;\n#endif');   /* GT.wetGround: world-space metres instead of the mesh UVs */
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D gtMacroTex; uniform vec2 gtRep; uniform vec4 gtMS; uniform vec3 gtFx; uniform vec3 gtWet;\n#ifdef GT_WUV\nvarying vec2 vGtW;\n#endif\nfloat gtHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }')
        .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef GT_WUV\n vec2 gtU = vGtW;\n#else\n vec2 gtU = vUv * gtRep;\n#endif\n vec3 gtA = texture2D(gtMacroTex, gtU * gtMS.x).rgb; vec3 gtB = texture2D(gtMacroTex, gtU.yx * gtMS.y + 0.37).rgb; float gtMz = gtMS.z * (1.0 - 0.6 * gtWet.z * step(0.01, gtFx.x));\n diffuseColor.rgb *= 1.0 + (gtA.r * 0.6 + gtB.g * 0.4 - 0.5) * 2.0 * gtMz; diffuseColor.rgb *= mix(vec3(1.045, 1.0, 0.94), vec3(0.955, 1.0, 1.06), smoothstep(0.3, 0.7, gtA.b * 0.55 + gtB.r * 0.45));\n vec3 gtF = texture2D(gtMacroTex, gtU * 2.9 + 0.11).rgb; vec3 gtL = texture2D(gtMacroTex, gtU.yx * gtMS.x * 0.21 + 0.61).rgb;\n diffuseColor.rgb *= (1.0 + (gtF.b - 0.5) * 1.3 * gtMz) * (1.0 + (gtL.r - 0.5) * 1.5 * gtMz);\n float gtPol = 0.0;\n#ifdef GT_PATCH\n vec3 gtP = texture2D(gtMacroTex, gtU * 0.031 + 0.43).rgb; vec3 gtP2 = texture2D(gtMacroTex, gtU.yx * 0.113 + 0.17).rgb;\n float gtPa = smoothstep(0.5, 0.66, gtP.g * 0.7 + gtP2.b * 0.3 + (gtF.r - 0.5) * 0.04); float gtOld = smoothstep(0.4, 0.66, gtP.r * 0.6 + gtP2.g * 0.4 + (gtF.g - 0.5) * 0.1);\n diffuseColor.rgb *= mix(1.0, 0.9, gtPa * gtFx.z); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.07 + vec3(0.005, 0.0045, 0.003), gtOld * (1.0 - gtPa) * gtFx.z);\n gtPol = gtOld * (1.0 - gtPa) * gtFx.z;\n'
          /* trench cuts / resurfacing rectangles with a tar seam, one cell in five */
          + ' vec2 gtCs = vec2(4.6, 12.5); vec2 gtCq = gtU / gtCs + vec2(0.31, 0.17); vec2 gtCi = floor(gtCq); vec2 gtCf = gtCq - gtCi; float gtH = gtHash(gtCi); float gtH2 = fract(gtH * 57.31); float gtH3 = fract(gtH * 131.7);\n vec2 gtRd = (abs(gtCf - 0.5 - (vec2(gtH2, gtH3) - 0.5) * 0.2) - vec2(0.12 + 0.24 * gtH3, 0.1 + 0.28 * gtH2)) * gtCs; float gtRe = max(gtRd.x, gtRd.y) + (gtF.r - 0.5) * 0.05; float gtRw = max(fwidth(gtRe), 0.012); float gtOn = step(0.8, gtH) * gtFx.z;\n float gtRect = gtOn * (1.0 - smoothstep(-gtRw, gtRw, gtRe)); float gtSeam = gtOn * (1.0 - smoothstep(0.0, 0.035 + gtRw, abs(gtRe))) * min(1.0, 0.05 / gtRw);\n diffuseColor.rgb *= mix(1.0, gtH2 > 0.5 ? 0.76 : 1.17, gtRect) * (1.0 - 0.5 * gtSeam);\n'
          /* oil drips where vehicles stand: soft dark blots, a little glossier */
          + ' vec2 gtOq = gtU / 3.1 + vec2(0.7, 0.2); vec2 gtOi = floor(gtOq); float gtOh = gtHash(gtOi + 71.3); vec2 gtOc = 0.25 + 0.5 * vec2(fract(gtOh * 17.3), fract(gtOh * 91.7));\n float gtOil = step(0.62, gtOh) * gtFx.z * (1.0 - smoothstep(0.05, 0.34, length((gtOq - gtOi - gtOc) * 3.1) / (0.25 + 0.75 * fract(gtOh * 7.1)) + (gtF.g - 0.5) * 0.35));\n diffuseColor.rgb *= 1.0 - 0.5 * gtOil; gtPol = max(gtPol, max(gtOil * 1.6, gtSeam * 2.0));\n#endif')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp(roughnessFactor * (1.0 + (gtA.g * 0.5 + gtB.b * 0.5 - 0.5) * 2.0 * gtMS.w) * (1.0 - 0.14 * gtPol), 0.03, 1.0);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n float gtEnvK = 1.0; float gtSpK = 1.0; float gtRf = 0.0;\n#ifdef GT_WET\n float gtWr = gtWet.x * gtFx.x; float gtWa = mix(gtWet.x, gtWet.y, gtFx.y) * gtFx.x * smoothstep(0.55, 0.9, inverseTransformDirection(normal, viewMatrix).y);\n'
          /* puddle mask: the large-scale sample is filtered with a quintic so the 40 cm macro texels never show as facets */
          + ' vec2 gtQ = gtU * 0.0131 * 256.0 + 0.5; vec2 gtQi = floor(gtQ); vec2 gtQf = gtQ - gtQi; gtQf = gtQf * gtQf * gtQf * (gtQf * (gtQf * 6.0 - 15.0) + 10.0); float gtPl = texture2D(gtMacroTex, (gtQi + gtQf - 0.5) / 256.0).g;\n'
          + ' if (gtWa > 0.002) { float gtWn = max(gtWr, 0.2 * gtWet.z * gtFx.y * gtFx.x); float gtPm = gtPl * 0.62 + gtA.b * 0.26 + gtB.r * 0.12 + (gtF.g - 0.5) * 0.035; float gtPu = smoothstep(0.63 - 0.06 * gtWn, 0.7 - 0.06 * gtWn, gtPm) * smoothstep(0.15, 0.6, gtWn);   /* at night a few shallow puddles are left standing even without rain */ float gtDp = gtWa * (0.88 + 0.12 * smoothstep(0.3, 0.6, gtPm));\n'
          + '  diffuseColor.rgb *= (1.0 - mix(0.48, 0.64, gtWet.z) * gtDp) * (1.0 - 0.3 * gtPu); roughnessFactor = mix(mix(roughnessFactor, roughnessFactor * 0.45, gtDp), 0.17, gtPu); normal = normalize(mix(normal, geometryNormal, max(gtPu * 0.96, gtDp * 0.35)));\n'
          /* sky reflection: damp tarmac only takes a little of it (no milky veil); puddles mirror it; at night the damp road picks up the city glow so it is readable */
          + '  gtEnvK = mix(1.0, mix(0.3, 0.5, gtWet.z), gtDp); gtEnvK = mix(gtEnvK, mix(0.8, 1.15, gtWet.z), gtPu);   /* night: the blurred neon of the sky probe no longer lies on the carriageway as a pale blotchy veil; the screen-space reflections carry the signs */ gtSpK = mix(1.0, mix(0.5, 1.0, gtWet.z), max(gtDp, gtPu));\n'
          /* how mirror-like this pixel is, for the screen-space reflections of js/render.js (signs, windows and headlights lying on the wet road): damp tarmac up to 0.6, a puddle 0.92 */
          + '  gtRf = max(gtPu * 0.92, gtDp * 0.28); }   /* LT: damp tarmac .6 -> .28: reflections stay in the puddles; the rest is a dull smear */\n#endif')
        .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n#if defined( GT_WET ) && defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )\n radiance *= gtEnvK;\n#endif')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n#ifdef GT_WET\n reflectedLight.directSpecular *= gtSpK;\n#endif');
      /* opaque ground only: the alpha of the HDR target carries 1 - reflectivity to the composite pass (the canvas has no alpha, nothing else reads it) */
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n#ifdef GT_WETA\n gl_FragColor.a = 1.0 - gtRf;\n#endif'); };
  }

  /** GT.wetGround(material, { wet = .8, rainOnly, vary = .05 }): give a module's own ground material (any MeshStandardMaterial with a map, lying flat) the shared wet response: darker and glossier in rain and in the night damp, puddles, and the reflectivity flag the screen-space reflections read. World-space, so the mesh UVs do not matter. Call before the first frame. */
  GT.wetGround = function (m, o) { o = o || {}; addMacro(m, [1, 1], [1 / 23, 1 / 7.9, o.vary === undefined ? .05 : o.vary, .1], { wet: o.wet === undefined ? .8 : o.wet, rainOnly: o.rainOnly, world: 1 }); m.needsUpdate = true; return m; };

  /* ================================================================== GT.mat */
  const TEXC = {}, MC = {}; let flushT = 0;
  /** drop cached noise/height fields (CPU side only; GPU textures stay). Runs automatically 6 s after the last texture build. */
  function flush() { for (const k in FC) delete FC[k]; for (const k in SH) delete SH[k]; }
  function texSet(name, hex, opt) {
    const variant = name === 'rubber' && opt && opt.tread ? '_tread' : '', key = name + variant + '_' + hex; if (TEXC[key]) return TEXC[key];
    const t = t0(), c = rgb(hex), ref = rgb(REF[name] !== undefined && hex === COL[name] ? 0xffffff : (REF[name] !== undefined ? REF[name] : COL[name])), base = REF[name] !== undefined && hex === COL[name] ? [1, 1, 1] : c;
    const k = [cl(base[0] / Math.max(ref[0], .02), 0, 4), cl(base[1] / Math.max(ref[1], .02), 0, 4), cl(base[2] / Math.max(ref[2], .02), 0, 4)];
    const B = DEF[name](c, k, opt), sk = (B.key || name + variant), rep = [1 / B.m[0], 1 / B.m[1]];
    const set = { map: dataTex(B.a, B.S, true), metres: B.m, macro: B.macro, hasMetal: !!B.mt, fx: B.fx || null };
    if (B.h) set.normal = TEXC[sk + '#n'] || (TEXC[sk + '#n'] = normalFromHeight(B.h, B.S, B.nk || 1));
    set.orm = TEXC[sk + '#r'] || (TEXC[sk + '#r'] = ormTex(B.r, B.mt, B.S, B.aux));
    for (const x of [set.map, set.normal, set.orm]) if (x) x.repeat.set(rep[0], rep[1]);
    const ms = t0() - t; stats.ms += ms; stats.built.push(key + ':' + ms.toFixed(0)); clearTimeout(flushT); flushT = setTimeout(flush, 6000); return TEXC[key] = set;
  }
  function glassDirtyTex() { if (TEXC.glassDirty) return TEXC.glassDirty; const DUSTC = [.66, .62, .54], S = 512, n = S * S, o = A(S), aux = new Float32Array(n), nM = N(S, 5, 5, 271), nL = N(S, 2, 4, 272), st = fbm(S, 72, 2, 3, 273), wh = white(S, 274), W = worley(S, 22, 275);
    for (let i = 0; i < n; i++) { const v = ((i / S) | 0) / S, spot = W.id[i] > .92 ? sm(W.f1[i], .2, .1) * sm(W.f1[i], .02, .12) * .5 : 0, low = sm(Math.min(v, 1 - v), .2, 0) * .25;
      const dust = cl(.05 + sm(nM[i] * .5 + nL[i] * .5, .25, .8) * .32 + sm(st[i], .45, .85) * .3 * nM[i] + spot * .3 + low + (wh[i] > .985 ? .3 : 0), 0, .8);
      C_(DUSTC, .9 + .2 * nM[i]); Pt(o.a, i); aux[i] = 1 - dust; o.r[i] = .05 + dust * .7; }
    const map = dataTex(o.a, S, true), orm = ormTex(o.r, null, S, aux); map.repeat.set(1 / 1.5, 1 / 1.5); orm.repeat.set(1 / 1.5, 1 / 1.5); return TEXC.glassDirty = { map, orm }; }
  function carPaintTex() { if (TEXC.carPaint) return TEXC.carPaint; const S = 512, n = S * S, a = new Uint8ClampedArray(n * 4), nd = new Uint8Array(n * 4), op = N(S, 9, 3, 281), nM = N(S, 3, 3, 282), r = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i % S, y = (i / S) | 0, cx = x >> 1, cy = y >> 1, f = hashI(cx, cy, 283), f2 = hashI(cx, cy, 284), f3 = hashI(cx, cy, 285), sp = f > .9 ? 1 : 0, l = .9 + .1 * f2 + sp * .25, j = i * 4;
      a[j] = a[j + 1] = a[j + 2] = l * 235; a[j + 3] = 255; const s = sp ? .5 : .16; let nx = (f2 - .5) * s, ny = (f3 - .5) * s; const il = 127.5 / Math.sqrt(nx * nx + ny * ny + 1); nd[j] = 127.5 + nx * il; nd[j + 1] = 127.5 + ny * il; nd[j + 2] = 127.5 + il; nd[j + 3] = 255; r[i] = .9 + .2 * nM[i] - sp * .3; }
    const set = { map: dataTex(a, S, true), normal: dataTex(nd, S, false), orm: ormTex(r, null, S), peel: normalFromHeight(op, S, .9) }; for (const k in set) set[k].repeat.set(1 / .14, 1 / .14); return TEXC.carPaint = set; }

  function make(name, opts) {
    const o = opts || {}, hex = o.color !== undefined ? o.color : COL[name]; let m;
    if (GLOWS[name]) { const g = GLOWS[name], col = o.color !== undefined ? new TH.Color(o.color).convertSRGBToLinear() : new TH.Color(g[0], g[1], g[2]), neon = name.startsWith('neon');
      m = new TH.MeshBasicMaterial({ color: 0xffffff }); GT.glow(m, col, neon ? .7 : .5, neon ? 6 : 8); m.color.copy(col).multiplyScalar(neon ? .7 : .5); return m; }
    if (!DEF[name] && !/^glass_|^car_paint$/.test(name)) { console.warn('GT.mat: unknown material "' + name + '", using concrete'); return make('concrete', opts); }
    if (name === 'glass_clear' || name === 'glass_tint' || name === 'glass_dirty') { const tint = name === 'glass_tint';
      m = new TH.MeshPhysicalMaterial({ color: GT.C(hex), roughness: o.rough !== undefined ? o.rough : .035, metalness: o.metal !== undefined ? o.metal : 0, transparent: true, depthWrite: false, transmission: tint ? .55 : .9, reflectivity: tint ? .75 : .9, envMapIntensity: tint ? 1.6 : 2 });
      if (name === 'glass_dirty') { const t = glassDirtyTex(); m.color.set(0xffffff); m.map = t.map; m.transmissionMap = t.orm; m.roughnessMap = t.orm; m.roughness = o.rough !== undefined ? o.rough / .25 : 1; if (o.color !== undefined) m.color.copy(GT.C(hex)); }
      return m; }
    if (name === 'car_paint') { const t = carPaintTex();
      m = new TH.MeshPhysicalMaterial({ color: GT.C(hex), map: t.map, roughness: o.rough !== undefined ? o.rough : .4, metalness: o.metal !== undefined ? o.metal : .55, roughnessMap: t.orm, normalMap: t.normal, normalScale: new TH.Vector2(.55, .55),
        clearcoat: 1, clearcoatRoughness: .045, clearcoatNormalMap: t.peel, clearcoatNormalScale: new TH.Vector2(.07, .07), envMapIntensity: 1.9 });   /* g6 r3: the day sky as IBL is at 0.3 (js/atmos.js envDay); paint and chrome still mirror it clearly */
      addMacro(m, [.14, .14], [1 / 1.9, 1 / .63, .05, .1]); return m; }
    const t = texSet(name, hex, o), meanR = t.orm.userData.meanR || 1;
    const P = { map: t.map, roughnessMap: t.orm, roughness: o.rough !== undefined ? cl(o.rough / meanR, 0, 6) : 1, metalness: 0 };
    if (t.normal) P.normalMap = t.normal;
    if (o.metal !== undefined) P.metalness = o.metal; else if (t.hasMetal) { P.metalnessMap = t.orm; P.metalness = 1; }
    if (name === 'water_pool') { m = new TH.MeshPhysicalMaterial(Object.assign(P, { transparent: true, depthWrite: false, transmission: .38, reflectivity: .7, envMapIntensity: 1.3 })); return m; }
    m = new TH.MeshStandardMaterial(P); if (name === 'chrome') m.envMapIntensity = 2;
    if (t.macro) addMacro(m, t.metres, t.macro, t.fx || {});
    return m;
  }
  /** GT.mat(name, opts?) -> THREE.Material (cached per name+opts). opts: {color: sRGB hex, rough, metal}; rubber also takes {tread:true}. */
  GT.mat = function (name, opts) { const key = name + (opts ? JSON.stringify(opts) : ''); if (MC[key]) return MC[key]; const m = make(name, opts); m.name = key; return MC[key] = m; };

  /* ================================================================== decals */
  const DC = {};
  const DPROP = { oil_stain: [.28, 0], crack: [.95, 0], rust_run: [.9, 0], grime_streak: [.95, 0], tire_marks: [.7, 0], puddle: [.06, 0], leak: [.16, 0], graffiti_a: [.6, 0], graffiti_b: [.6, 0], water_stain: [.9, 0], patch: [.8, 0], gum_spots: [.6, 0], arrow: [.65, 0], handicap: [.65, 0], no_parking: [.65, 0],
    /* slice pass: small street-level detail */ leaves: [.85, 0], litter: [.8, 0], damp: [.3, 0], kerb_grime: [.92, 0] };
  function pix(S, fn) { const c = canvas(S, S), g = c.getContext('2d'), im = g.createImageData(S, S), d = im.data; for (let i = 0, n = S * S; i < n; i++) { const al = fn(i, (i % S) / S, ((i / S) | 0) / S), j = i * 4; d[j] = cr * 255; d[j + 1] = cg * 255; d[j + 2] = cb * 255; d[j + 3] = cl(al, 0, 1) * 255; } g.putImageData(im, 0, 0); return c; }
  function erode(c, fn) { const S = c.width, g = c.getContext('2d'), im = g.getImageData(0, 0, S, S), d = im.data; for (let i = 0, n = S * S; i < n; i++) if (d[i * 4 + 3]) d[i * 4 + 3] *= cl(fn(i, (i % S) / S, ((i / S) | 0) / S), 0, 1); g.putImageData(im, 0, 0); return c; }
  const edgeFade = (u, v) => sm(Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)), 0, .05);
  const rgba = (c, a) => `rgba(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0},${a})`;
  const TAGFONT = "'Marker Felt','Chalkduster','Bradley Hand','Segoe Print','Comic Sans MS',cursive";
  const STENCILFONT = "'Stencil','Stencil Std','Arial Black','Impact','Helvetica Neue',sans-serif";
  function roadWear(c, amt) { const S = c.width, n1 = N(S, 5, 5, 311), n2 = N(S, 40, 3, 312), W = worley(S, 12, 313); return erode(c, (i) => sm(n1[i] * .6 + n2[i] * .4, .22 + amt * .3, .5 + amt * .22) * (.75 + .25 * n2[i]) * sm(W.f2[i] - W.f1[i], 0, .03)); }
  function streaks(S, r, col, count, wMin, wMax, alpha, topSpread) { const c = canvas(S, S), g = c.getContext('2d'); if ('filter' in g) g.filter = 'blur(' + (wMax * .14).toFixed(1) + 'px)';
    for (let i = 0; i < count; i++) { const x = S * (.5 + (r() - .5) * topSpread), w = wMin + r() * (wMax - wMin), len = S * (.3 + r() * .6), y0 = S * .03 + r() * S * .07, gr = g.createLinearGradient(0, y0, 0, y0 + len), a = alpha * (.5 + .5 * r());
      gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(.06, rgba(col, a)); gr.addColorStop(.35, rgba(col, a * .6)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.shadowColor = rgba(col, a * .8); g.shadowBlur = w * .5; const dx = (r() - .5) * 14;
      g.beginPath(); g.moveTo(x - w / 2, y0); g.lineTo(x + w / 2, y0); g.quadraticCurveTo(x + w * .3 + dx * .4, y0 + len * .5, x + dx + w * .08, y0 + len); g.lineTo(x + dx - w * .08, y0 + len); g.quadraticCurveTo(x - w * .3 + dx * .4, y0 + len * .5, x - w / 2, y0); g.fill(); }
    return c; }
  function drawDecal(name) { const S = 512, r = GT.rng('decal_' + name), n1 = N(S, 4, 5, 321), n2 = N(S, 14, 4, 322), n3 = N(S, 64, 3, 323); let c, g;
    switch (name) {
      case 'oil_stain': return pix(S, (i, u, v) => { const d = Math.hypot(u - .5, v - .5) * 2, t = d + (n1[i] - .5) * .95, m = sm(t, .8, .48), core = sm(t + (n2[i] - .5) * .25, .5, .18), ring = sm(m, .15, .45) * sm(m, .95, .55); cr = .045 - core * .02; cg = .04 - core * .018; cb = .034 - core * .015; return (m * .42 + core * .42 + ring * .18) * (.85 + .3 * n3[i]) * sm(d, 1, .88); });
      case 'puddle': return pix(S, (i, u, v) => { const d = Math.hypot(u - .5, v - .5) * 2, t = d + (n1[i] - .5) * .85, m = sm(t, .74, .715), damp = sm(t + (n2[i] - .5) * .12, .93, .7); cr = .05; cg = .052; cb = .058; return Math.max(m * .82 * sm(t, .76, .6), damp * .5) * sm(d, 1, .9); });
      case 'water_stain': return pix(S, (i, u, v) => { const d = Math.hypot(u - .5, v - .5) * 2, t = d + (n1[i] - .5) * .75 + (n2[i] - .5) * .08, b1 = sm(t, .66, .7) * sm(t, .745, .705), b2 = sm(t, .46, .49) * sm(t, .53, .5) * .6, b3 = sm(t, .25, .28) * sm(t, .32, .29) * .35, ins = sm(t, .72, .55) * .2, rg = Math.max(b1, b2, b3);
        C_([.3, .27, .22], 1); Mx([.86, .84, .78], cl(rg * 1.5, 0, 1)); return Math.max(rg * .5, ins) * (.7 + .5 * n3[i]) * sm(d, 1, .9); });
      case 'patch': { const W = worley(S, 110, 324); return pix(S, (i, u, v) => { const e = Math.max(Math.abs(u - .5) * 2 + (n2[i] - .5) * .07, Math.abs(v - .5) * 2 + (n2[(i + 9973) % (S * S)] - .5) * .07), ins = sm(e, .82, .8), band = sm(e, .9, .87) * (1 - sm(e, .8, .77)), st = sm(W.f1[i], .5, .15) * W.id[i];
        C_([.1, .1, .11], .85 + .3 * n1[i]); Mx([.4, .4, .4], st * .3 * ins); Mx([.03, .03, .035], band); return Math.max(ins * .94, band * .9 * (.6 + .5 * n3[i])); }); }
      case 'tire_marks': return pix(S, (i, u, v) => { let al = 0; for (const cx of [.3, .7]) { const x = u - cx - Math.sin(v * 3 + cx) * .015, w = Math.abs(x), band = sm(w, .075, .06), tr = .55 + .45 * sm(Math.abs(fr(v * 46 + w * 30) - .5), .12, .3), rb = .6 + .4 * sm(Math.abs(fr(w * 28) - .5), .08, .2); al = Math.max(al, band * tr * rb); }
        cr = cg = cb = .028; return al * .62 * sm(n1[i] * .6 + n2[i] * .4, .25, .6) * sm(v, 0, .2) * sm(v, 1, .7) * (.7 + .3 * n3[i]); });
      case 'leaves': { c = canvas(S, S); g = c.getContext('2d'); const cols = ['#8f7c2c', '#766e2c', '#96682a', '#7c5626', '#5e6a2c', '#a4863a', '#684a24', '#505a28', '#988c48'];
        for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${40 + r() * 30 | 0},${34 + r() * 24 | 0},${22 + r() * 16 | 0},${.25 + r() * .4})`; const a = r() * TAU, d = Math.pow(r(), .7) * S * .46; g.fillRect(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d * .8, 1 + r() * 3, 1 + r() * 2); }
        for (let i = 0; i < 110; i++) { const a = r() * TAU, d = Math.pow(r(), .62) * S * .43, x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * .82, R = 9 + r() * 10, flat = .45 + r() * .55; g.save(); g.translate(x, y); g.rotate(r() * TAU); g.scale(1, flat);
          g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 3; g.shadowOffsetY = 1.5; g.fillStyle = cols[r() * cols.length | 0]; g.beginPath(); for (let k = 0; k < 10; k++) { const an = k / 10 * TAU, rd = k % 2 ? R * .55 : R * (k === 0 ? 1.2 : .95 + r() * .15); g.lineTo(Math.cos(an) * rd, Math.sin(an) * rd); } g.closePath(); g.fill();
          g.shadowColor = 'transparent'; g.strokeStyle = 'rgba(40,30,14,.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-R * .9, 0); g.lineTo(R * 1.1, 0); g.moveTo(0, 0); g.lineTo(R * .5, R * .5); g.moveTo(0, 0); g.lineTo(R * .5, -R * .5); g.stroke(); g.restore(); }
        return erode(c, (i, u, v) => (.8 + .3 * n3[i]) * edgeFade(u, v)); }
      case 'litter': { c = canvas(S, S); g = c.getContext('2d'); const P = () => [S * (.08 + r() * .84), S * (.08 + r() * .84)];
        for (let i = 0; i < 90; i++) { const [x, y] = P(); g.fillStyle = r() < .5 ? `rgba(${196 + r() * 40 | 0},${186 + r() * 40 | 0},${160 + r() * 40 | 0},.85)` : 'rgba(28,24,20,.8)'; g.save(); g.translate(x, y); g.rotate(r() * TAU); g.beginPath(); g.ellipse(0, 0, 2.2 + r() * 1.6, 1 + r() * .8, 0, 0, TAU); g.fill(); g.restore(); }   // melon-seed shells, grit
        for (let i = 0; i < 16; i++) { const [x, y] = P(); g.save(); g.translate(x, y); g.rotate(r() * TAU); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 2; g.fillStyle = '#d9d4c8'; g.fillRect(-7, -2, 9, 4); g.fillStyle = '#b9792e'; g.fillRect(2, -2, 6, 4); g.fillStyle = 'rgba(40,36,30,.8)'; g.fillRect(-8.5, -2, 2, 4); g.restore(); }   // cigarette ends
        for (let i = 0; i < 7; i++) { const [x, y] = P(), w = 14 + r() * 26, h = 10 + r() * 20; g.save(); g.translate(x, y); g.rotate(r() * TAU); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 3; g.fillStyle = ['#d8d4c6', '#c9b98a', '#b84a3a', '#d6c24a', '#8fb0c4', '#e6e2d8'][r() * 6 | 0]; g.beginPath(); g.moveTo(-w / 2, -h / 2 + r() * 4); g.lineTo(w / 2 - r() * 5, -h / 2); g.lineTo(w / 2, h / 2 - r() * 5); g.lineTo(-w / 2 + r() * 5, h / 2); g.closePath(); g.fill(); g.shadowColor = 'transparent'; g.fillStyle = 'rgba(40,40,40,.35)'; for (let k = 0; k < 3; k++) g.fillRect(-w * .3, -h * .25 + k * h * .2, w * .55, 1.2); g.restore(); }   // receipts, flyers, wrappers
        for (let i = 0; i < 4; i++) { const [x, y] = P(); g.fillStyle = ['#c23a2e', '#2e6fb0', '#d8d8d4', '#e0b030'][i]; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 2; g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); g.shadowColor = 'transparent'; g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 3.4, 0, TAU); g.stroke(); }   // bottle caps
        return erode(c, (i, u, v) => (.85 + .25 * n3[i]) * edgeFade(u, v)); }
      case 'damp': return pix(S, (i, u, v) => { const d = Math.hypot(u - .5, v - .5) * 2, t = d + (n1[i] - .5) * .9 + (n2[i] - .5) * .16, m = sm(t, .86, .42); cr = .035; cg = .037; cb = .042; return m * (.34 + .16 * n2[i]) * sm(d, 1, .86); });
      case 'kerb_grime': return pix(S, (i, u, v) => { const e = 1 - v, a = sm(e, .95, .05) * sm(e + (n1[i] - .5) * .5, .7, .0) , sp = sm(n2[i], .52, .75) * sm(e, .8, .2); C_([.085, .075, .06], .8 + .5 * n3[i]); Mx([.2, .19, .13], sm(n1[i], .55, .8) * .5); return cl(a * .78 + sp * .3, 0, .9) * (.7 + .5 * n3[i]) * sm(Math.min(u, 1 - u), 0, .04); });
      case 'crack': { c = canvas(S, S); g = c.getContext('2d'); g.lineCap = g.lineJoin = 'round';
        const walk = (x, y, a, len, w, depth) => { const pts = [[x, y]]; let n = (len / 9) | 0; let b = a; for (let i = 0; i < n; i++) { b += (r() - .5) * .22; a = b + (r() - .5) * 1.3; x += Math.cos(a) * 9; y += Math.sin(a) * 9; if (x < 14 || y < 14 || x > S - 14 || y > S - 14) break; pts.push([x, y]); if (depth < 2 && r() < .1) walk(x, y, b + (r() < .5 ? 1 : -1) * (.6 + r() * .7), len * (.3 + r() * .3), w * .6, depth + 1); }
          const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); };
          g.strokeStyle = 'rgba(20,18,16,.16)'; g.lineWidth = w * 4.5; path(); g.stroke(); g.strokeStyle = 'rgba(8,8,8,.92)'; g.lineWidth = w; path(); g.stroke(); };
        const a0 = r() * TAU; walk(S / 2, S / 2, a0, 270, 2.6, 0); walk(S / 2, S / 2, a0 + Math.PI + (r() - .5) * .6, 270, 2.6, 0); walk(S / 2, S / 2, a0 + 1.6 + (r() - .5) * .5, 150, 1.7, 1);
        return erode(c, (i, u, v) => (.6 + .6 * n3[i]) * edgeFade(u, v)); }
      case 'rust_run': { c = streaks(S, r, [.3, .15, .07], 14, 8, 46, .6, .5); g = c.getContext('2d'); g.filter = 'none'; const c2 = streaks(S, r, [.46, .25, .1], 9, 3, 16, .45, .42); g.drawImage(c2, 0, 0); if ('filter' in g) g.filter = 'blur(2px)';
        g.fillStyle = 'rgba(50,24,10,.8)'; for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(S * (.5 + (r() - .5) * .42), S * .04 + r() * 14, 5 + r() * 12, 3 + r() * 5, 0, 0, TAU); g.fill(); }
        const st = fbm(S, 72, 2, 3, 325); return erode(c, (i, u, v) => (.35 + .95 * st[i]) * (.75 + .4 * n3[i]) * sm(Math.min(u, 1 - u), 0, .06) * sm(1 - v, 0, .08)); }
      case 'grime_streak': { c = streaks(S, r, [.1, .095, .085], 22, 14, 80, .42, .8); const st = fbm(S, 56, 2, 3, 326); return erode(c, (i, u, v) => (.3 + 1.0 * st[i]) * (.7 + .4 * n2[i]) * sm(Math.min(u, 1 - u), 0, .08) * sm(1 - v, 0, .08)); }
      case 'leak': { c = canvas(S, S); g = c.getContext('2d'); g.fillStyle = 'rgba(14,11,8,.86)'; g.shadowColor = 'rgba(14,11,8,.7)'; g.shadowBlur = 10;
        g.beginPath(); g.ellipse(S * .5, S * .2, S * .15, S * .11, .2, 0, TAU); g.fill(); g.beginPath(); g.moveTo(S * .44, S * .24); g.bezierCurveTo(S * .47, S * .5, S * .55, S * .62, S * .52, S * .9); g.bezierCurveTo(S * .57, S * .6, S * .54, S * .45, S * .57, S * .24); g.fill();
        g.beginPath(); g.ellipse(S * .52, S * .9, S * .035, S * .03, 0, 0, TAU); g.fill(); for (let i = 0; i < 12; i++) { const a = r() * TAU, d = S * (.13 + r() * .16); g.beginPath(); g.arc(S * .5 + Math.cos(a) * d, S * .2 + Math.sin(a) * d * .8, 2 + r() * 7, 0, TAU); g.fill(); }
        return erode(c, (i) => .65 + .5 * n2[i]); }
      case 'gum_spots': { c = canvas(S, S); g = c.getContext('2d'); for (let i = 0; i < 17; i++) { const x = S * (.08 + r() * .84), y = S * (.08 + r() * .84), rad = 7 + r() * 13, pale = r() < .25; g.fillStyle = pale ? 'rgba(150,146,138,.7)' : `rgba(${22 + r() * 16 | 0},${22 + r() * 14 | 0},${22 + r() * 12 | 0},.82)`; g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 3;
          g.beginPath(); g.ellipse(x, y, rad, rad * (.6 + r() * .4), r() * 3, 0, TAU); g.fill(); if (r() < .5) { g.beginPath(); g.ellipse(x + rad * .7, y + rad * .2, rad * .5, rad * .35, r() * 3, 0, TAU); g.fill(); } } return erode(c, (i) => .7 + .4 * n3[i]); }
      case 'graffiti_a': case 'graffiti_b': { c = canvas(S, S); g = c.getContext('2d'); g.lineCap = g.lineJoin = 'round'; g.textAlign = 'center'; g.textBaseline = 'middle'; const A_ = name === 'graffiti_a';
        const word = A_ ? 'Kroma' : 'ZUL7', ink = A_ ? [.07, .05, .12] : [.08, .08, .1], fill = [.62, .78, .86];
        g.save(); g.translate(S / 2, S * (A_ ? .46 : .5)); g.rotate(A_ ? -.12 : -.06); g.transform(1, 0, A_ ? -.28 : -.12, 1, 0, 0); g.font = `italic 700 ${A_ ? 150 : 178}px ${TAGFONT}`; g.shadowColor = rgba(ink, .7); g.shadowBlur = 7;
        if (A_) { g.strokeStyle = rgba(ink, .92); g.lineWidth = 9; g.strokeText(word, 0, 0, S * .86); g.fillStyle = rgba(ink, .92); g.fillText(word, 0, 0, S * .86);
          g.lineWidth = 11; g.beginPath(); g.moveTo(-S * .4, 82); g.bezierCurveTo(-S * .1, 60, S * .2, 110, S * .42, 66); g.stroke(); g.lineWidth = 7; g.beginPath(); g.moveTo(S * .42, 66); g.bezierCurveTo(S * .3, 96, S * .1, 100, -S * .05, 104); g.stroke();
          g.beginPath(); for (let i = 0; i < 5; i++) { const a = -1.57 + i * TAU * 2 / 5, x = S * .34 + Math.cos(a) * 26, y = -112 + Math.sin(a) * 26; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.lineWidth = 6; g.stroke();
        } else { g.strokeStyle = rgba(ink, .95); g.lineWidth = 30; g.strokeText(word, 0, 0, S * .84); g.shadowBlur = 0; g.fillStyle = rgba(fill, .93); g.fillText(word, 0, 0, S * .84); g.strokeStyle = rgba(fill, .93); g.lineWidth = 8; g.strokeText(word, 0, 0, S * .84);
          g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(-S, -78, S * 2, 30); g.fillStyle = 'rgba(20,40,80,.3)'; g.fillRect(-S, 30, S * 2, 70); g.globalCompositeOperation = 'source-over';
          g.strokeStyle = rgba([.86, .25, .4], .9); g.lineWidth = 8; g.shadowColor = rgba([.86, .25, .4], .6); g.shadowBlur = 6; g.beginPath(); g.moveTo(-S * .4, 112); g.quadraticCurveTo(0, 140, S * .4, 104); g.stroke(); }
        g.restore(); g.shadowBlur = 0; const im = g.getImageData(0, 0, S, S).data; g.strokeStyle = rgba(ink, .9);
        for (let i = 0; i < 9; i++) { const x = (S * (.18 + r() * .64)) | 0; let y = S * .72 | 0; while (y > S * .3 && im[(y * S + x) * 4 + 3] < 200) y--; if (y <= S * .3) continue; const len = 20 + r() * 90; g.lineWidth = 2.5 + r() * 2.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 2, y + len); g.stroke(); g.beginPath(); g.arc(x, y + len, g.lineWidth * .75, 0, TAU); g.fillStyle = rgba(ink, .9); g.fill(); }
        return erode(c, (i, u, v) => sm(n3[i] * .5 + n2[i] * .5, .12, .42) * (.82 + .25 * n1[i]) * edgeFade(u, v)); }
      case 'arrow': { c = canvas(S, S); g = c.getContext('2d'); g.fillStyle = 'rgb(222,220,210)'; g.beginPath(); g.moveTo(S * .5, S * .04); g.lineTo(S * .78, S * .44); g.lineTo(S * .585, S * .44); g.lineTo(S * .585, S * .96); g.lineTo(S * .415, S * .96); g.lineTo(S * .415, S * .44); g.lineTo(S * .22, S * .44); g.closePath(); g.fill(); return roadWear(c, .45); }
      case 'handicap': { c = canvas(S, S); g = c.getContext('2d'); g.fillStyle = 'rgb(36,84,150)'; const q = S * .06, rr = S * .05; g.beginPath(); g.moveTo(q + rr, q); g.arcTo(S - q, q, S - q, S - q, rr); g.arcTo(S - q, S - q, q, S - q, rr); g.arcTo(q, S - q, q, q, rr); g.arcTo(q, q, S - q, q, rr); g.closePath(); g.fill();
        g.strokeStyle = g.fillStyle = 'rgb(226,226,218)'; g.lineWidth = S * .012; g.strokeRect(q + S * .03, q + S * .03, S - 2 * q - S * .06, S - 2 * q - S * .06); g.lineCap = g.lineJoin = 'round'; g.lineWidth = S * .058;
        g.beginPath(); g.arc(S * .44, S * .22, S * .055, 0, TAU); g.fill(); g.beginPath(); g.moveTo(S * .44, S * .33); g.lineTo(S * .45, S * .54); g.lineTo(S * .63, S * .54); g.lineTo(S * .71, S * .73); g.lineTo(S * .78, S * .71); g.stroke(); g.beginPath(); g.moveTo(S * .445, S * .41); g.lineTo(S * .61, S * .42); g.stroke();
        g.beginPath(); g.arc(S * .46, S * .63, S * .17, .25, Math.PI * 1.38); g.stroke(); return roadWear(c, .35); }
      case 'no_parking': { c = canvas(S, S); g = c.getContext('2d'); const y = 'rgb(214,170,36)'; g.save(); g.beginPath(); g.rect(S * .04, S * .04, S * .92, S * .92); g.clip(); g.strokeStyle = y; g.lineWidth = S * .055; for (let i = -8; i < 12; i++) { g.beginPath(); g.moveTo(i * S * .16, S); g.lineTo(i * S * .16 + S, 0); g.stroke(); } g.restore();
        g.strokeRect(S * .0675, S * .0675, S * .865, S * .865); g.clearRect(S * .14, S * .3, S * .72, S * .4); g.fillStyle = y; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${S * .15}px ${STENCILFONT}`; g.fillText('NO', S / 2, S * .41, S * .6); g.fillText('PARKING', S / 2, S * .59, S * .64); return roadWear(c, .4); }
    }
    return pix(64, (i, u, v) => { cr = cg = cb = 0; return sm(Math.hypot(u - .5, v - .5), .5, .1) * .5; });
  }
  /** GT.decalMat(name) -> transparent lit material (alpha-textured, depthWrite off, polygonOffset). Names: GT.DECALS. */
  GT.decalMat = function (name) { if (DC[name]) return DC[name]; if (!DPROP[name]) { console.warn('GT.decalMat: unknown decal "' + name + '"'); name = 'oil_stain'; if (DC[name]) return DC[name]; }
    const t = t0(), tex = new TH.CanvasTexture(drawDecal(name)); tex.encoding = TH.sRGBEncoding; tex.anisotropy = 8; const p = DPROP[name];
    const m = new TH.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, roughness: p[0], metalness: p[1] });
    if (name === 'puddle') { m.envMapIntensity = .12;   /* LT: was .28 before js/render.js gave mirror-like surfaces the full sky back (x2.4 by day): a pale lilac sheet in the shade */ m.userData.gtReflect = 1; m.blending = TH.CustomBlending; m.blendSrc = TH.SrcAlphaFactor; m.blendDst = TH.OneMinusSrcAlphaFactor; m.blendSrcAlpha = TH.ZeroFactor; m.blendDstAlpha = TH.OneMinusSrcAlphaFactor; }   /* same colour blend as before; the alpha factors push the target's alpha toward 0 under the water = "mirror here" for the wet-ground reflections (js/render.js) */
    m.name = 'decal_' + name; stats.ms += t0() - t; return DC[name] = m; };

  /* ================================================================== signs / text */
  const SEG = { '0': 0x3f, '1': 0x06, '2': 0x5b, '3': 0x4f, '4': 0x66, '5': 0x6d, '6': 0x7d, '7': 0x07, '8': 0x7f, '9': 0x6f, '-': 0x40, ' ': 0, '_': 0x08 };
  const F57 = { A: '0E11111F111111', B: '1E11111E11111E', C: '0E11101010110E', D: '1E11111111111E', E: '1F10101E10101F', F: '1F10101E101010', G: '0E11101711110F', H: '1111111F111111', I: '0E04040404040E', J: '0702020202120C', K: '11121418141211', L: '1010101010101F', M: '111B1515111111',
    N: '11191513111111', O: '0E11111111110E', P: '1E11111E101010', Q: '0E11111115120D', R: '1E11111E141211', S: '0F10100E01011E', T: '1F040404040404', U: '1111111111110E', V: '1111111111 0A04'.replace(' ', ''), W: '1111111515 1B11'.replace(' ', ''), X: '11110A040A1111', Y: '11110A04040404', Z: '1F01020408101F',
    0: '0E11131519110E', 1: '040C040404040E', 2: '0E11010204081F', 3: '1F02040201110E', 4: '02060A121F0202', 5: '1F101E0101110E', 6: '0608101E11110E', 7: '1F010204080808', 8: '0E11110E11110E', 9: '0E11110F01020C',
    '.': '00000000000C0C', ':': '000C0C000C0C00', '-': '0000001F000000', '/': '00010204081000', '$': '040F140E051E04', '!': '04040404040004', '%': '18190204081303', '+': '0004041F040400', '#': '0A0A1F0A1F0A0A', '?': '0E110102040004', ',': '000000000C0408', "'": '04040800000000', '>': '08040201020408', '<': '02040810080402', '*': '00150E1F0E1500', '=': '00001F001F0000', '&': '0C12140815120D' };
  function fitFont(g, text, weight, family, maxW, maxH) { let px = maxH; g.font = `${weight} ${px}px ${family}`; const w = g.measureText(text).width; if (w > maxW) px = Math.max(6, px * maxW / w); g.font = `${weight} ${px}px ${family}`; return px; }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  /** weathering pass on a painted canvas: chips to an undercoat, sun fade, vertical dirt streaks, edge rust. d = 0..1 */
  function distress(c, d, under, seedOff) { if (d <= 0) return; const w = c.width, h = c.height, g = c.getContext('2d'), im = g.getImageData(0, 0, w, h), px = im.data, S = 512, so = seedOff || 0, n1 = N(S, 5, 5, 331 + so), n2 = N(S, 48, 3, 332 + so), n3 = N(S, 2, 4, 333 + so), st = fbm(S, 64, 2, 3, 334 + so), sc = scratch(S), sx = Math.max(1, 512 / Math.max(w, h));
    const un = under || [.4, .33, .27];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = (y * w + x) * 4; if (!px[j + 3]) continue; const i = (((y * sx) | 0) % S) * S + (((x * sx) | 0) % S), i2 = (((y * sx * .37) | 0) % S) * S + (((x * sx * .37) | 0) % S);
      const ed = Math.min(Math.min(x, w - 1 - x), Math.min(y, h - 1 - y)) / Math.min(w, h), edge = sm(ed, .09, 0);
      let r = px[j] / 255, gg = px[j + 1] / 255, b = px[j + 2] / 255; const fade = d * (.08 + .22 * n3[i2]); r = mix(r, .9, fade); gg = mix(gg, .88, fade); b = mix(b, .84, fade);
      const dirt = d * (sm(st[i], .5, .9) * .45 * n1[i2] + (y / h) * (y / h) * .22 + edge * .2); r = mix(r, .2, dirt); gg = mix(gg, .18, dirt); b = mix(b, .15, dirt);
      const s = sc[i] * d * .5; r = mix(r, .75, s); gg = mix(gg, .74, s); b = mix(b, .72, s);
      const chip = sm(n1[i] * .55 + n2[i] * .3 + edge * .35, .82 - d * .26, .84 - d * .26), ring = sm(n1[i] * .55 + n2[i] * .3 + edge * .35, .79 - d * .26, .82 - d * .26);
      r = mix(r, .78, ring * .6); gg = mix(gg, .76, ring * .6); b = mix(b, .72, ring * .6); const rv = .6 + .7 * n2[i]; r = mix(r, un[0] * rv, chip); gg = mix(gg, un[1] * rv, chip); b = mix(b, un[2] * rv, chip);
      px[j] = r * 255; px[j + 1] = gg * 255; px[j + 2] = b * 255; }
    g.putImageData(im, 0, 0); }
  const SIGNC = {};
  /** GT.signTex(text, opts) -> CanvasTexture (sRGB). opts {w,h,style:'neon'|'painted'|'lcd'|'plate'|'stencil'|'sticker', color, bg, font, distress 0..1, glow 0..1}.
      'stencil' and 'sticker' have a transparent background (use transparent:true); plate also takes {top, bottom} small captions. */
  GT.signTex = function (text, o) { o = o || {}; text = String(text); const style = o.style || 'painted', key = text + JSON.stringify(o); if (SIGNC[key]) return SIGNC[key];
    const w = o.w || 512, h = o.h || (style === 'plate' ? 256 : 128), c = canvas(w, h), g = c.getContext('2d'), d = o.distress === undefined ? (style === 'painted' ? .4 : style === 'plate' ? .3 : style === 'stencil' ? .35 : style === 'sticker' ? .2 : 0) : o.distress, t = t0();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = g.lineCap = 'round';
    if (style === 'neon') { const col = o.color || '#ff3d9a', gl = o.glow === undefined ? 1 : o.glow; g.fillStyle = o.bg || '#000'; g.fillRect(0, 0, w, h);
      const fam = o.font || "'Avenir Next','Helvetica Neue','Segoe UI','Arial',sans-serif", px = fitFont(g, text, o.font ? '400' : '300', fam, w * .84, h * .62), tube = Math.max(2, px * .065), y = h * .52;
      // mounting hardware + dim reflection on the backing, then halo, tube, hot core
      const rgw = g.createRadialGradient(0, 0, 0, 0, 0, 1); rgw.addColorStop(0, col); rgw.addColorStop(1, 'rgba(0,0,0,0)'); g.save(); g.translate(w / 2, y); g.scale(w * .5, h * .5); g.globalAlpha = .13 * gl; g.fillStyle = rgw; g.fillRect(-1, -1, 2, 2); g.restore(); g.globalAlpha = 1;
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = tube * 2.2; g.strokeText(text, w / 2 + tube * .8, y + tube * 1.2);
      g.strokeStyle = col; g.shadowColor = col; for (const [bl, lw, al] of [[h * .34, tube * 1.6, .55 * gl], [h * .16, tube * 1.5, .7 * gl], [h * .06, tube * 1.25, .95]]) { g.shadowBlur = bl; g.lineWidth = lw; g.globalAlpha = al; g.strokeText(text, w / 2, y); }
      g.globalAlpha = 1; g.shadowBlur = tube * .8; g.lineWidth = tube; g.strokeText(text, w / 2, y); g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,.82)'; g.lineWidth = tube * .42; g.strokeText(text, w / 2, y);
      g.fillStyle = 'rgba(12,12,14,.9)'; const tw = g.measureText(text).width, r = GT.rng('neon' + text); for (let i = 0, n = Math.max(3, text.length); i < n; i++) { const x = w / 2 - tw / 2 + tw * (i + .5) / n + (r() - .5) * 6; g.fillRect(x - tube * .45, y + px * .36, tube * .9, tube * 1.7); }
    } else if (style === 'lcd') { const col = o.color || '#ff2a14', gl = o.glow === undefined ? 1 : o.glow; g.fillStyle = o.bg || '#070707'; g.fillRect(0, 0, w, h);
      const up = text.toUpperCase(), seven = /^[0-9 .:\-_]+$/.test(up);
      if (seven) { const chars = up.split(''), units = chars.reduce((s, ch) => s + (ch === '.' || ch === ':' ? .35 : 1), 0), ch_ = Math.min(h * .78, w * .92 / units / .62), cw = ch_ * .62, x0 = (w - units * cw) / 2, y0 = (h - ch_) / 2, th = ch_ * .105, sk = -.07; let x = x0;
        const seg = (cx, cy, len, vert, on) => { const hl = len / 2 - th * .12, ht = th / 2; g.beginPath(); if (vert) { g.moveTo(cx, cy - hl); g.lineTo(cx + ht, cy - hl + ht); g.lineTo(cx + ht, cy + hl - ht); g.lineTo(cx, cy + hl); g.lineTo(cx - ht, cy + hl - ht); g.lineTo(cx - ht, cy - hl + ht); } else { g.moveTo(cx - hl, cy); g.lineTo(cx - hl + ht, cy - ht); g.lineTo(cx + hl - ht, cy - ht); g.lineTo(cx + hl, cy); g.lineTo(cx + hl - ht, cy + ht); g.lineTo(cx - hl + ht, cy + ht); } g.closePath();
          if (on) { g.shadowColor = col; g.shadowBlur = th * 2.4 * gl; g.fillStyle = col; g.globalAlpha = 1; g.fill(); g.fill(); g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,.28)'; g.fill(); } else { g.shadowBlur = 0; g.fillStyle = col; g.globalAlpha = .07; g.fill(); g.globalAlpha = 1; } };
        for (const ch of chars) { if (ch === '.' || ch === ':') { g.fillStyle = col; g.shadowColor = col; g.shadowBlur = th * 2 * gl; const cx = x + cw * .175 + sk * ch_ * -.4; if (ch === '.') { g.beginPath(); g.arc(cx, y0 + ch_ - th * .6, th * .62, 0, TAU); g.fill(); } else { g.beginPath(); g.arc(cx + ch_ * .02, y0 + ch_ * .32, th * .55, 0, TAU); g.arc(cx - ch_ * .02, y0 + ch_ * .68, th * .55, 0, TAU); g.fill(); } g.shadowBlur = 0; x += cw * .35; continue; }
          const m = SEG[ch] || 0, sw = cw * .72, L = x + (cw - sw) / 2, R = L + sw, T_ = y0 + th / 2, M = y0 + ch_ / 2, B = y0 + ch_ - th / 2, vl = (B - T_) / 2;
          g.save(); g.transform(1, 0, sk, 1, -sk * (y0 + ch_ / 2), 0);
          seg((L + R) / 2, T_, sw, 0, m & 1); seg(R, (T_ + M) / 2, vl, 1, m & 2); seg(R, (M + B) / 2, vl, 1, m & 4); seg((L + R) / 2, B, sw, 0, m & 8); seg(L, (M + B) / 2, vl, 1, m & 16); seg(L, (T_ + M) / 2, vl, 1, m & 32); seg((L + R) / 2, M, sw, 0, m & 64); g.restore(); x += cw; }
        g.globalAlpha = .22; g.fillStyle = '#000'; const pp = Math.max(3, ch_ * .028); for (let yy = 0; yy < h; yy += pp) g.fillRect(0, yy, w, pp * .3); for (let xx = 0; xx < w; xx += pp) g.fillRect(xx, 0, pp * .3, h); g.globalAlpha = 1;
      } else { const chars = up.split(''), cols = chars.length * 6 - 1, rows = 7, dp = Math.min(w * .94 / cols, h * .8 / rows), x0 = (w - cols * dp) / 2, y0 = (h - rows * dp) / 2, rad = dp * .4;
        for (let p = 0; p < 2; p++) chars.forEach((ch, ci) => { const f = F57[ch] || '00000000000000'; for (let ry = 0; ry < 7; ry++) { const bits = parseInt(f.substr(ry * 2, 2), 16); for (let cx = 0; cx < 5; cx++) { const on = bits & (16 >> cx), X = x0 + (ci * 6 + cx + .5) * dp, Y = y0 + (ry + .5) * dp;
          if (p === 0 && !on) { g.fillStyle = col; g.globalAlpha = .08; g.beginPath(); g.arc(X, Y, rad, 0, TAU); g.fill(); g.globalAlpha = 1; }
          if (p === 1 && on) { g.shadowColor = col; g.shadowBlur = dp * 1.1 * gl; g.fillStyle = col; g.beginPath(); g.arc(X, Y, rad, 0, TAU); g.fill(); g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.arc(X, Y, rad * .5, 0, TAU); g.fill(); } } } }); }
      if (d > 0) { const n1 = N(512, 5, 4, 341); const im = g.getImageData(0, 0, w, h), px = im.data; for (let i = 0; i < w * h; i++) { const dust = d * .5 * n1[(((i / w) | 0) % 512) * 512 + (i % w) % 512], j = i * 4; px[j] = mix(px[j], 90, dust); px[j + 1] = mix(px[j + 1], 85, dust); px[j + 2] = mix(px[j + 2], 75, dust); } g.putImageData(im, 0, 0); }
    } else if (style === 'plate') { const col = o.color || '#1c3566', bg = o.bg || '#ece6d6', m = h * .03, rr = h * .09; g.fillStyle = bg; g.fillRect(0, 0, w, h); rrect(g, 0, 0, w, h, 1); g.save(); g.clip();
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(238,128,52,.9)'); gr.addColorStop(.3, 'rgba(244,190,110,.55)'); gr.addColorStop(.55, 'rgba(244,190,110,0)'); gr.addColorStop(.82, 'rgba(70,150,160,0)'); gr.addColorStop(1, 'rgba(70,150,160,.55)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,214,150,.75)'; g.beginPath(); g.arc(w * .5, h * .5, h * .26, Math.PI, 0); g.fill(); g.restore();
      const ridge = (off, colr, lw) => { rrect(g, m + h * .045 + off, m + h * .045 + off, w - 2 * m - h * .09, h - 2 * m - h * .09, rr * .7); g.strokeStyle = colr; g.lineWidth = lw; g.stroke(); };
      ridge(1.5, 'rgba(0,0,0,.35)', h * .022); ridge(-1.2, 'rgba(255,255,255,.8)', h * .022); ridge(0, col, h * .018);
      const fam = o.font || "'DIN Condensed','Arial Narrow','Helvetica Neue','Arial',sans-serif"; g.fillStyle = col; fitFont(g, o.top || 'CORAL COAST', '700', fam, w * .6, h * .13); g.fillText(o.top || 'CORAL COAST', w / 2, h * .17); fitFont(g, o.bottom || 'the sundown state', 'italic 600', fam, w * .5, h * .1); g.fillText(o.bottom || 'the sundown state', w / 2, h * .86);
      const px = fitFont(g, text, '700', fam, w * .8, h * .56), y = h * .525, e = Math.max(1.2, px * .022); g.fillStyle = 'rgba(255,255,255,.95)'; g.fillText(text, w / 2 - e, y - e); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillText(text, w / 2 + e * 1.3, y + e * 1.5); g.fillStyle = col; g.fillText(text, w / 2, y);
      const lg = g.createLinearGradient(0, y - px * .4, 0, y + px * .4); lg.addColorStop(0, 'rgba(255,255,255,.22)'); lg.addColorStop(.5, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(0,0,0,.2)'); g.fillStyle = lg; g.globalCompositeOperation = 'source-atop'; g.fillText(text, w / 2, y); g.globalCompositeOperation = 'source-over';
      for (const [bx, by] of [[.12, .15], [.88, .15], [.12, .85], [.88, .85]]) { g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(w * bx + 1.5, h * by + 2, h * .034, 0, TAU); g.fill(); g.fillStyle = by < .5 ? '#9a9c9e' : '#1a1a1a'; g.beginPath(); g.arc(w * bx, h * by, h * .03, 0, TAU); g.fill(); if (by < .5) { g.strokeStyle = '#4a4b4d'; g.lineWidth = h * .008; g.beginPath(); g.moveTo(w * bx - h * .018, h * by); g.lineTo(w * bx + h * .018, h * by); g.stroke(); } }
      g.fillStyle = '#d8b227'; g.fillRect(w * .8, h * .68, w * .1, h * .12); g.fillStyle = '#222'; g.font = `700 ${h * .07}px ${fam}`; g.fillText('27', w * .85, h * .745);
      distress(c, d, [.55, .55, .56], 3);
    } else if (style === 'stencil') { const col = o.color || '#e6e2d6'; if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); }
      const fam = o.font || STENCILFONT, px = fitFont(g, text, '900', fam, w * .86, h * .7), y = h * .52; g.fillStyle = col; g.shadowColor = col; g.shadowBlur = px * .09; g.globalAlpha = .55; g.fillText(text, w / 2, y); g.shadowBlur = 0; g.globalAlpha = 1; g.fillText(text, w / 2, y);
      g.font = `900 ${px}px 'Stencil','Stencil Std',monospace`; const wS = g.measureText('ABOD').width; g.font = `900 ${px}px monospace`; const hasStencil = Math.abs(wS - g.measureText('ABOD').width) > .5 && !o.font; g.font = `900 ${px}px ${fam}`;
      if (!hasStencil) { g.globalCompositeOperation = 'destination-out'; const tw = g.measureText(text).width; let x = w / 2 - tw / 2; for (const ch of text) { const cw = g.measureText(ch).width; if (ch !== ' ' && ch !== 'I' && ch !== '1') g.fillRect(x + cw / 2 - px * .028, 0, px * .056, h); x += cw; } g.globalCompositeOperation = 'source-over'; }
      const n2 = N(512, 48, 3, 351), n1 = N(512, 6, 4, 352), sx = 512 / Math.max(w, h), im = g.getImageData(0, 0, w, h), p = im.data; for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const j = (yy * w + xx) * 4; if (!p[j + 3] || (o.bg && false)) continue; const i = (((yy * sx) | 0) % 512) * 512 + ((xx * sx) | 0) % 512; const k = sm(n2[i] * .5 + n1[i] * .5, .08 + d * .5, .3 + d * .55) * (.8 + .2 * n2[i]);
        if (o.bg) { const b = new TH.Color(o.bg); p[j] = mix(b.r * 255, p[j], k); p[j + 1] = mix(b.g * 255, p[j + 1], k); p[j + 2] = mix(b.b * 255, p[j + 2], k); } else p[j + 3] *= k; } g.putImageData(im, 0, 0);
    } else if (style === 'sticker') { const col = o.color || '#ffffff', bg = o.bg || '#c8322a', m = Math.max(2, h * .04), rr = h * .16; g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = m; rrect(g, m, m, w - 2 * m, h - 2 * m, rr); g.fillStyle = '#f1efe8'; g.fill(); g.shadowBlur = 0;
      const b = Math.max(2, h * .06); rrect(g, m + b, m + b, w - 2 * (m + b), h - 2 * (m + b), rr * .7); g.fillStyle = bg; g.fill(); const lg = g.createLinearGradient(0, 0, w, h); lg.addColorStop(0, 'rgba(255,255,255,.14)'); lg.addColorStop(.5, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(0,0,0,.14)'); g.fillStyle = lg; g.fill();
      g.fillStyle = col; fitFont(g, text, '800', o.font || "'Helvetica Neue','Arial','Segoe UI',sans-serif", w * .8, h * .5); g.fillText(text, w / 2, h * .53);
      if (d > 0) { distress(c, d * .8, [.82, .8, .74], 5); const n1 = N(512, 3, 4, 361), sx = 512 / Math.max(w, h), im = g.getImageData(0, 0, w, h), p = im.data; for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const cd = Math.hypot(w - xx, yy) / h, peel = sm(cd + (n1[(((yy * sx) | 0) % 512) * 512 + ((xx * sx) | 0) % 512] - .5) * .5, .25 + d * .5, .3 + d * .5); p[(yy * w + xx) * 4 + 3] *= peel; } g.putImageData(im, 0, 0); }
    } else { const col = o.color || '#a82a22', bg = o.bg || '#e6dec8', bc = new TH.Color(bg), lumBg = (bc.r + bc.g + bc.b) / 3; g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, 'rgba(255,255,255,.1)'); lg.addColorStop(1, 'rgba(0,0,0,.12)'); g.fillStyle = lg; g.fillRect(0, 0, w, h);
      const b = Math.max(2, h * .05); g.strokeStyle = col; g.lineWidth = Math.max(1.5, h * .022); g.globalAlpha = .9; rrect(g, b, b, w - 2 * b, h - 2 * b, h * .06); g.stroke(); g.globalAlpha = 1;
      const fam = o.font || "'Arial Black','Helvetica Neue','Impact','Arial',sans-serif", px = fitFont(g, text, '900', fam, w * .84, h * .6), y = h * .53, e = px * .045;
      g.fillStyle = lumBg > .5 ? 'rgba(0,0,0,.42)' : 'rgba(0,0,0,.7)'; g.fillText(text, w / 2 + e, y + e); g.fillStyle = col; g.fillText(text, w / 2, y);
      const n2 = N(512, 3, 96, 3, 371), sx = 512 / Math.max(w, h), im = g.getImageData(0, 0, w, h), p = im.data; for (let i = 0; i < w * h; i++) { const br = (n2[((((i / w) | 0) * sx | 0) % 512) * 512 + ((i % w) * sx | 0) % 512] - .5) * 16, j = i * 4; p[j] += br; p[j + 1] += br; p[j + 2] += br; } g.putImageData(im, 0, 0);
      distress(c, d, [.42, .3, .22], 0); }
    const tex = new TH.CanvasTexture(c); tex.encoding = TH.sRGBEncoding; tex.anisotropy = 8; tex.userData = { style }; stats.ms += t0() - t; return SIGNC[key] = tex; };
  /** GT.signMat(text, opts) -> ready material for a sign quad. neon/lcd -> unlit + GT.glow registered (brightens at night); others -> lit PBR (transparent for stencil/sticker). */
  const SIGNM = {};
  GT.signMat = function (text, o) { o = o || {}; const key = text + JSON.stringify(o); if (SIGNM[key]) return SIGNM[key]; const tex = GT.signTex(text, o), st = o.style || 'painted'; let m;
    if (st === 'neon' || st === 'lcd') { m = new TH.MeshBasicMaterial({ map: tex }); GT.glow(m, new TH.Color(1, 1, 1), st === 'neon' ? 1.1 : 1.3, st === 'neon' ? 5 : 3.5); m.color.setScalar(1.1); }
    else { m = new TH.MeshStandardMaterial({ map: tex, roughness: st === 'plate' ? .42 : st === 'sticker' ? .45 : .7, metalness: st === 'plate' ? .25 : 0 }); if (st === 'stencil' && !o.bg || st === 'sticker') { m.transparent = true; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -4; } }
    m.name = 'sign_' + key; return SIGNM[key] = m; };

  /* ================================================================== GT.tex : generators for reuse */
  let envT = null;
  GT.tex = { fbm, worley, white, scratch, cracks, normalFromHeight, dataTex, ormTex, canvas, stats, flush, defs: DEF, colors: COL,
    /** addMacro(material, [metresU, metresV], [1/m, 1/m, albedoAmt, roughAmt]) — world-scale anti-tiling variation for a module's own MeshStandardMaterial (UVs in metres / texture repeat = 1/metres). */
    addMacro,
    /** raw texture set of a material: {map, normal, orm, metres:[u,v]} */
    set: (name, color) => texSet(name, color !== undefined ? color : COL[name]),
    /** low-res equirect sunset sky usable as scene.environment when atmos has not provided one (showcases, fallbacks). */
    envFallback() { if (envT) return envT; const w = 1024, h = 512, c = canvas(w, h), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#31507e'); gr.addColorStop(.3, '#6f8fb4'); gr.addColorStop(.44, '#e2b592'); gr.addColorStop(.497, '#ffd9a8'); gr.addColorStop(.503, '#5c5044'); gr.addColorStop(.62, '#4a4238'); gr.addColorStop(1, '#2e2a26'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (const [x, rx, ry, a] of [[.5, .3, .22, .5], [.5, .12, .1, .7], [.5, .035, .035, 1]]) { const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1); rg.addColorStop(0, `rgba(255,236,200,${a})`); rg.addColorStop(1, 'rgba(255,190,120,0)'); g.save(); g.translate(w * x, h * .43); g.scale(w * rx, h * ry); g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore(); }
      const r = GT.rng('envclouds'); for (let i = 0; i < 26; i++) { const x = r() * w, y = h * (.2 + r() * .22), rw = 60 + r() * 160; const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1); rg.addColorStop(0, 'rgba(255,214,190,.3)'); rg.addColorStop(1, 'rgba(255,214,190,0)'); for (const ox of [0, w, -w]) { g.save(); g.translate(x + ox, y); g.scale(rw, rw * .16); g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore(); } }
      envT = new TH.CanvasTexture(c); envT.mapping = TH.EquirectangularReflectionMapping; envT.encoding = TH.sRGBEncoding; return envT; } };

  /* ================================================================== showcases */
  const metreSphere = (r, seg) => { const g = new TH.SphereGeometry(r, seg || 48, (seg || 48) * .66 | 0), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * r, uv.getY(i) * Math.PI * r); return g; };
  const caption = t => { const m = new TH.MeshBasicMaterial({ map: GT.signTex(t.replace(/_/g, ' '), { style: 'sticker', w: 512, h: 80, bg: '#17181a', color: '#e9e6dc', distress: 0 }), transparent: true }); m.color.setScalar(.8); return m; };
  function ensureEnv(scene) { if (!scene.environment) { scene.environment = GT.tex.envFallback(); scene.userData.gtFallbackEnv = true; } }

  GT.showcase.materials = ({ scene }) => {
    const k = GT.kit(), names = GT.MATERIALS, COLS = 11, DX = 1.6, DZ = 2.7, rows = Math.ceil(names.length / COLS), z0 = -((rows - 1) * DZ) / 2 + 2;
    k.box('concrete', 24, .2, rows * DZ + 10, 0, -.1, 0);
    names.forEach((n, i) => { const x = ((i % COLS) - (COLS - 1) / 2) * DX, z = z0 + ((i / COLS) | 0) * DZ;
      k.box(n, 1, 1, 1, x, .5, z, { bevel: .03 }); k.geo(n, metreSphere(.25), { x, y: .25, z: z + .95 }); k.quad(caption(n), .9, .14, x, .012, z + 1.42, { rx: -Math.PI / 2 }); });
    // decal strip on asphalt + wall
    const zs = z0 - 4.2, D = GT.DECALS, wallD = ['rust_run', 'grime_streak', 'graffiti_a', 'graffiti_b', 'water_stain', 'leak', 'crack'];
    k.box('asphalt', 24, .06, 2.4, 0, .03, zs); k.box('stucco_cream', 24, 3.6, .2, 0, 1.8, zs - 1.3); k.box('cinderblock', 8, 3.6, .2, -8, 1.8, zs - 1.19); k.box('metal_painted_white', 5, 3.6, .05, 9.5, 1.8, zs - 1.17);
    D.forEach((n, i) => { const x = (i - (D.length - 1) / 2) * 1.55; k.decal(n, 1.45, 1.45, x, .065, zs, 0); k.quad(caption(n), .9, .14, x, .065, zs + .98, { rx: -Math.PI / 2 }); });
    wallD.forEach((n, i) => { const x = -10.5 + i * 2.2; k.quad(GT.decalMat(n), 1.5, 1.5, x, n === 'graffiti_a' || n === 'graffiti_b' ? 1.1 : 1.0, zs - 1.085 + (x < -4 ? .11 : 0)); });
    k.quad(GT.decalMat('rust_run'), 1.2, 1.6, 9, 1.4, zs - 1.14); k.quad(GT.decalMat('grime_streak'), 1.6, 1.8, 10.6, 1.5, zs - 1.14);
    // sign samples
    const signs = [['MOTEL', { style: 'neon', color: '#ff3d9a', w: 512, h: 160 }, 2.2, .7], ['OPEN 24 HRS', { style: 'neon', color: '#35e0ff', w: 768, h: 128 }, 2.4, .4], ['SUNSET GAS', { style: 'painted', w: 768, h: 160, color: '#b3322a', bg: '#e8dfc6', distress: .55 }, 2.4, .5], ['3.49', { style: 'lcd', w: 384, h: 192 }, 1.2, .6],
      ['COLD BEER', { style: 'lcd', color: '#ffb020', w: 512, h: 96 }, 1.9, .36], ['KRL 482', { style: 'plate', w: 512, h: 256 }, .9, .45], ['NO LOITERING', { style: 'stencil', color: '#1c1c1c', w: 768, h: 128 }, 2.2, .37], ['PAY INSIDE', { style: 'sticker', w: 512, h: 128, distress: .4 }, 1.1, .275], ['ICE', { style: 'painted', w: 256, h: 128, color: '#f2f2ee', bg: '#2b5e9c', distress: .7 }, 1.0, .5]];
    let sx = -11; for (const [t, o, w, h] of signs) { k.quad(GT.signMat(t, o), w, h, sx + w / 2, 2.75, zs - 1.07 + (sx < -4 ? .11 : 0)); sx += w + .35; }
    scene.add(k.build()); ensureEnv(scene);
    if (/stats=1/.test(location.search)) document.getElementById('err').textContent = 'tex ms ' + stats.ms.toFixed(0) + '  ' + stats.built.join(' ');
    return { cam: [0, 11, 16], look: [0, 0, 0], hours: 18.2, update() { ensureEnv(scene); } };
  };

  GT.showcase.materials_close = ({ scene }) => {
    const q = new URLSearchParams(location.search), list = (q.get('mats') || 'leather_tan,asphalt,stucco_pink,car_paint').split(','), k = GT.kit(), nrm = list.length, pitch = .42;
    k.box('concrete', 6, .2, 6, 0, -.1, 0);
    list.forEach((n, i) => { const x = (i - (nrm - 1) / 2) * pitch; let m = n, o; if (n.indexOf(':') > 0) { const p = n.split(':'); m = p[0]; o = p[1] === 'tread' ? { tread: true } : { color: parseInt(p[1], 16) }; }
      const mat = GT.mat(m, o); k.push(x, 0, 0, { ry: .5 }); k.box(mat, .3, .3, .3, 0, .15, 0, { bevel: .02 }); k.pop(); k.geo(mat, metreSphere(.09, 64), { x: x + .03, y: .09, z: .3 }); k.quad(caption(m), .3, .047, x, .004, .46, { rx: -Math.PI / 2 }); });
    scene.add(k.build()); ensureEnv(scene);
    if (q.get('stats')) document.getElementById('err').textContent = 'tex ms ' + stats.ms.toFixed(0) + '  ' + stats.built.join(' ');
    return { cam: [0, .5, 1.0], look: [0, .14, .05], hours: 18.2, update() { ensureEnv(scene); } };
  };
})();

/* image textures from assets/ (generated photographs). GT.tex.image(path, {repeat:[u,v], srgb, aniso}) -> THREE.Texture, cached per path+options, usable at once (fills in when the file arrives);
   GT.tex.imageEl(path, cb) -> cb(HTMLImageElement) once loaded (never called on error), for compositing into a canvas atlas. */
(function () { const TH = window.THREE, GT = window.GT; if (!TH || !GT || !GT.tex) return; const IMG = {}, TEX = {};
  GT.tex.imageEl = (path, cb) => { let e = IMG[path]; if (!e) { e = IMG[path] = { img: new Image(), ok: false, cbs: [] }; e.img.onload = () => { e.ok = true; const l = e.cbs.splice(0); for (const f of l) { try { f(e.img); } catch (x) { console.warn('[tex] ' + path, x); } } }; e.img.onerror = () => { e.cbs.length = 0; console.warn('[tex] missing ' + path); }; e.img.src = path; } if (e.ok) cb(e.img); else e.cbs.push(cb); };
  GT.tex.image = (path, o) => { o = o || {}; const rp = o.repeat || [1, 1], key = path + '|' + rp[0] + '|' + rp[1] + '|' + (o.srgb === false ? 0 : 1); if (TEX[key]) return TEX[key]; const t = TEX[key] = new TH.Texture(); t.wrapS = t.wrapT = TH.RepeatWrapping; t.repeat.set(rp[0], rp[1]); t.anisotropy = o.aniso || 8; if (o.srgb !== false) t.encoding = TH.sRGBEncoding;
    GT.tex.imageEl(path, img => { t.image = img; t.needsUpdate = true; }); return t; };
})();

/* ================================================================== LT 光影系统 (2026-11-17): glass pictures, a probe-ready car paint, wet patches and puddles.
   GT.glassify(material, panes, o)  a photographed window / shop front (MeshStandardMaterial with map, maybe emissive) -> MeshPhysicalMaterial that is glass where the panes are:
                                    panes = [[u0, v0, u1, v1], ...] in texture uv (v up); o = { gloss: roughness on the glass (.06), frame: elsewhere (.6), refl: F0 control (.75 -> 9 %) }.
                                    The picture behind stays (shop goods, curtains, the room); js/render.js's reflection probe lays the street, the sky and at night the neon over it with Fresnel.
   GT.carPaint(hex, o)              the car paint the vehicle line should use: GT.mat('car_paint') textures, metallic base, a near-mirror clear coat, full-strength local reflections
                                    (o = { metal: .45, rough: .34, coat: .03, flake: true }). js/render.js attaches the reflection probe to it by itself (clearcoat > 0).
   GT.wetDecals.build(spots, ground, o) -> Mesh: one draw call of damp patches and small puddles lying on the ground. spots = [{ x, z, w, l, a, k, gut }]: centre, size (m), rotation,
                                    rank 0..1 (low = there even on a dry afternoon, high = only at night / in rain), gut = 1 along a kerb (fuller). ground(x, z) = surface height.
                                    Irregular outlines from an 8-shape atlas that grow and shrink with the wetness, a damp rim, a rippled mirror core; writes 1 - reflectivity into the HDR alpha so the
                                    screen-space reflections of js/render.js put the cars, palms, signs and the sky into them. GT.wetDecals.cfg = { day, night, growDay, growNight, far } tunes how many and how big. */
(function () { const TH = window.THREE, GT = window.GT; if (!TH || !GT || !GT.tex) return;
  const cl = (x, a, b) => x < a ? a : x > b ? b : x, PANEC = {};
  function paneRough(panes, gloss, frame) { const key = JSON.stringify(panes) + '|' + gloss + '|' + frame; if (PANEC[key]) return PANEC[key]; const S = 128, c = GT.tex.canvas(S, S), g = c.getContext('2d'), v = x => Math.round(cl(x, 0, 1) * 255);
    g.fillStyle = 'rgb(' + v(frame) + ',' + v(frame) + ',' + v(frame) + ')'; g.fillRect(0, 0, S, S); g.fillStyle = 'rgb(' + v(gloss) + ',' + v(gloss) + ',' + v(gloss) + ')'; let area = 0;
    for (const p of panes) { g.fillRect(p[0] * S, (1 - p[3]) * S, (p[2] - p[0]) * S, (p[3] - p[1]) * S); area += (p[2] - p[0]) * (p[3] - p[1]); }
    const t = new TH.CanvasTexture(c); t.userData = { meanR: gloss * area + frame * (1 - area) }; return PANEC[key] = t; }
  GT.glassify = function (m, panes, o) { o = o || {};
    const P = new TH.MeshPhysicalMaterial({ map: m.map, color: m.color ? m.color.clone() : new TH.Color(0xffffff), roughness: 1, metalness: 0, roughnessMap: paneRough(panes, o.gloss === undefined ? .06 : o.gloss, o.frame === undefined ? .6 : o.frame), reflectivity: o.refl === undefined ? .86 : o.refl,
      emissive: m.emissive ? m.emissive.clone() : new TH.Color(0), emissiveMap: m.emissiveMap || null, emissiveIntensity: m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity, transparent: !!m.transparent, side: m.side });
    if (m.bumpMap) { P.bumpMap = m.bumpMap; P.bumpScale = m.bumpScale; } P.name = (m.name || 'pic') + '_glass'; P.userData.gtProbeK = o.k === undefined ? 1 : o.k; P.userData.gtGlass = 1; return P; };
  const CPC = {};
  GT.carPaint = function (hex, o) { o = o || {}; const key = hex + JSON.stringify(o); if (CPC[key]) return CPC[key]; const b = GT.mat('car_paint', { color: hex, rough: o.rough === undefined ? .34 : o.rough, metal: o.metal === undefined ? .45 : o.metal });
    const m = b.clone(); m.clearcoat = 1; m.clearcoatRoughness = o.coat === undefined ? .03 : o.coat; m.envMapIntensity = 1; m.userData.gtProbeK = 1; if (o.flake === false) { m.normalMap = null; } m.onBeforeCompile = b.onBeforeCompile; m.name = 'carPaint_' + hex; return CPC[key] = m; };

  /* ---- wet patches / puddles */
  const CFG = { day: .34, night: .5, growDay: .5, growNight: .55, far: 150 };
  let shapeT = null, rippleT = null, MAT = null;
  function shapes() { if (shapeT) return shapeT; const C = 128, W = C * 4, H = C * 2, d = new Uint8Array(W * H * 4), r = GT.rng ? GT.rng('lt-puddles') : Math.random, n1 = GT.tex.fbm(128, 4, 4, 4, 911), n2 = GT.tex.fbm(128, 9, 9, 3, 912);
    for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 4; cx++) { const B = [], nb = 3 + ((r() * 4) | 0); for (let i = 0; i < nb; i++) B.push([.5 + (r() - .5) * .36, .5 + (r() - .5) * .36, .12 + r() * .14, .1 + r() * .11, r() * 3.14]);
      const f = new Float32Array(C * C); let mx = 0;
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const u = (x + .5) / C, v = (y + .5) / C; let s = 0; for (const b of B) { const dx = u - b[0], dy = v - b[1], ca = Math.cos(b[4]), sa = Math.sin(b[4]), px = (dx * ca + dy * sa) / b[2], py = (-dx * sa + dy * ca) / b[3]; s += Math.exp(-(px * px + py * py) * 1.3); }
        const ox = (x + cx * 37) & 127, oy = (y + cy * 53) & 127, e = Math.min(u, 1 - u, v, 1 - v); s = 1 - Math.exp(-1.8 * s); s = Math.max(0, (s + (n1[oy * 128 + ox] - .5) * .5 + (n2[oy * 128 + ox] - .5) * .18) * cl(e / .14, 0, 1)); f[y * C + x] = s; if (s > mx) mx = s; }   /* saturating sum: overlapping blobs make one plateau, the noise frays its outline */
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const j = ((cy * C + y) * W + cx * C + x) * 4, v = cl(f[y * C + x] / (mx || 1), 0, 1); d[j] = v * 255; d[j + 1] = d[j + 2] = 0; d[j + 3] = 255; } }
    const t = new TH.DataTexture(d, W, H, TH.RGBAFormat); t.magFilter = TH.LinearFilter; t.minFilter = TH.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return shapeT = t; }
  function ripple() { if (rippleT) return rippleT; const S = 256, h = GT.tex.fbm(S, 6, 6, 4, 913), w = GT.tex.worley(S, 14, 914); const hh = new Float32Array(S * S); for (let i = 0; i < S * S; i++) hh[i] = h[i] * .7 + (1 - Math.min(1, w.f1[i] * 1.3)) * .3; return rippleT = GT.tex.normalFromHeight(hh, S, 2.2); }
  const QW = (() => { try { const v = new URLSearchParams(location.search).get('wet'); return v !== null && isFinite(+v) ? cl(+v, 0, 1) : null; } catch (e) { return null; } })();
  const pudV = new TH.Vector4(), pudU = { get value() { const e = GT.env || {}, nt = cl(+e.night || 0, 0, 1), rain = QW !== null ? QW : cl(+e.wet || 0, 0, 1), R = GT.render, L = R && R.levels ? R.levels[R.quality] : null, q = L && L.puddles !== undefined ? L.puddles : 1;
      pudV.set(cl((CFG.day + (CFG.night - CFG.day) * nt + rain) * q, 0, 1), cl(CFG.growDay + (CFG.growNight - CFG.growDay) * nt + rain * .8, 0, 1), CFG.far, nt); return pudV; }, set value(v) { } };
  function material() { if (MAT) return MAT; const m = new TH.MeshStandardMaterial({ color: 0x000000, roughness: .04, metalness: 0, normalMap: ripple(), normalScale: new TH.Vector2(.1, .1), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    m.blending = TH.CustomBlending; m.blendEquation = TH.AddEquation; m.blendSrc = TH.OneFactor; m.blendDst = TH.OneMinusSrcAlphaFactor; m.blendSrcAlpha = TH.ZeroFactor; m.blendDstAlpha = TH.OneMinusSrcAlphaFactor;   /* colour: reflection + ground x (1 - wetness) · alpha (the SSR flag): ground's x (1 - wetness) */
    m.userData.gtReflect = 1; m.userData.gtNoProbe = 1; m.name = 'lt_puddles'; const sh0 = shapes();
    m.onBeforeCompile = sh => { sh.uniforms.tGtShape = { value: sh0 }; sh.uniforms.gtPud = pudU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aC; attribute vec4 aK; varying vec2 vGtC; varying vec4 vGtK; varying float vGtD;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vGtC = aC; vGtK = aK;').replace('#include <project_vertex>', '#include <project_vertex>\n vGtD = -mvPosition.z;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tGtShape; uniform vec4 gtPud; varying vec2 vGtC; varying vec4 vGtK; varying float vGtD;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n float gtF = texture2D( tGtShape, vGtC ).r; float gtVis = smoothstep( vGtK.x, vGtK.x + 0.06, gtPud.x ) * ( 1.0 - smoothstep( gtPud.z * 0.65, gtPud.z, vGtD ) );\n float gtT = mix( 0.8, 0.3, gtPud.y ) - 0.15 * vGtK.y; float gtCore = smoothstep( gtT, gtT + 0.08, gtF ); float gtRim = smoothstep( gtT - 0.24, gtT, gtF ) * ( 1.0 - gtCore );\n float gtA = ( gtCore * 0.9 + gtRim * 0.45 ) * gtVis; if ( gtA < 0.004 ) discard; diffuseColor = vec4( 0.0, 0.0, 0.0, gtA );')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix( 0.45, 0.03, gtCore );')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n gl_FragColor = vec4( gl_FragColor.rgb * ( gtCore + gtRim * 0.08 ) * gtVis, gtA );   /* the damp rim only darkens (a pale rough sheen there read as a grey stain); the core mirrors */'); };
    return MAT = m; }
  /** spots -> one merged mesh (world-space vertices; add it to the scene root as is) */
  function build(spots, ground, o) { o = o || {}; const n = spots.length, P = new Float32Array(n * 12), U = new Float32Array(n * 8), CC = new Float32Array(n * 8), K = new Float32Array(n * 16), I = new Uint32Array(n * 6), r = GT.rng ? GT.rng('lt-pud-cells') : Math.random, lift = o.lift === undefined ? .012 : o.lift;
    let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9, by0 = 1e9, by1 = -1e9;
    spots.forEach((s, i) => { const ca = Math.cos(s.a || 0), sa = Math.sin(s.a || 0), cell = (r() * 8) | 0, cu = (cell % 4) / 4, cv = ((cell / 4) | 0) / 2, fl = r() < .5;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach((q, j) => { const lx = q[0] * s.w / 2, lz = q[1] * s.l / 2, x = s.x + lx * ca + lz * sa, z = s.z - lx * sa + lz * ca, y = ground(x, z) + lift + (i % 7) * .0004, b = (i * 4 + j);
        P[b * 3] = x; P[b * 3 + 1] = y; P[b * 3 + 2] = z; U[b * 2] = x / 3; U[b * 2 + 1] = z / 3; const qu = (fl ? -q[0] : q[0]) * .5 + .5; CC[b * 2] = cu + (qu * .98 + .01) / 4; CC[b * 2 + 1] = cv + ((q[1] * .5 + .5) * .98 + .01) / 2;
        K[b * 4] = s.k === undefined ? r() : s.k; K[b * 4 + 1] = s.gut || 0; K[b * 4 + 2] = 0; K[b * 4 + 3] = 0;
        bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); by0 = Math.min(by0, y); by1 = Math.max(by1, y); });
      const b = i * 4, t = i * 6; I[t] = b; I[t + 1] = b + 2; I[t + 2] = b + 1; I[t + 3] = b; I[t + 4] = b + 3; I[t + 5] = b + 2; });
    const g = new TH.BufferGeometry(); g.setAttribute('position', new TH.BufferAttribute(P, 3)); g.setAttribute('uv', new TH.BufferAttribute(U, 2)); g.setAttribute('aC', new TH.BufferAttribute(CC, 2)); g.setAttribute('aK', new TH.BufferAttribute(K, 4));
    const nr = new Float32Array(n * 12); for (let i = 0; i < n * 4; i++) nr[i * 3 + 1] = 1; g.setAttribute('normal', new TH.BufferAttribute(nr, 3)); g.setIndex(new TH.BufferAttribute(I, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const mesh = new TH.Mesh(g, material()); mesh.name = o.name || 'lt_wet'; mesh.renderOrder = 1; mesh.receiveShadow = true; mesh.castShadow = false; mesh.matrixAutoUpdate = false; mesh.userData.gtSmall = 1; GT.wetDecals.count += n; return mesh; }
  GT.wetDecals = { cfg: CFG, build, uniform: pudU, count: 0, material, shapes };
})();
