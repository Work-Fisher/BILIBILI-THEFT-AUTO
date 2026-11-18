/* cockpit.js — first-person interior shared by every car (built for the other edition's muscle car; all printed matter is 江城 now) + the driver's arms and hands.
   GT.cockpit.build(opts) -> { group, eye, update(dt, s), mirrorGlass, parts }
   Group space: origin at car centre on the ground, +Z forward, +X = driver's LEFT (left-hand drive, driver at x = +0.36).
   Everything is generated: geometry via GT.kit + local loft/soft-box helpers, textures via canvas. */
(function () {
  'use strict';
  const T = THREE, GT = window.GT; if (!GT) return;
  const PI = Math.PI, TAU = PI * 2, cl = GT.clamp, lerp = GT.lerp, sst = GT.sstep, D2R = PI / 180;
  const V3 = (x, y, z) => new T.Vector3(x, y, z);
  const bump = (x, c, w) => { const t = (x - c) / w; return Math.exp(-t * t); };
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  /* ------------------------------------------------------------------ layout constants (group space, metres) */
  /* The layout is fitted inside the vehicles agent's hero body ("Sundowner"): windscreen base at z = .64 (sides) .. .715 (centre), header at z = .10,
     belt line .84, roof inner ~1.28, side glass leaning from x = .80 (belt) to .65 (cant rail), fastback backlight from z = -.70 (roof) to -1.88. */
  const DX = 0.36;                                   // driver centreline
  const EYE = V3(DX, 1.085, -0.25);
  const RL = 0, DY = -0.05, SY = -0.035, CY = -0.03; // roof lift (unused), dash drop, seat / body drop, console drop relative to the first layout pass
  const FLOOR = 0.30, BELT = 0.845, HALF = 0.755, CANT = 1.205;    // carpet top, window sill height, inner half width at the door cards, top of the side glass
  const WS = { bz: 0.632, bow: 0.072, by: 0.842, byC: 0.056, bx: 0.76, tz: 0.108, ty: 1.200, tyC: 0.044, tx: 0.585 };   // windshield base / top: z, bow, y at the sides, extra y at the centre, half width
  const WHEEL = { x: DX, y: 0.862 + DY, z: 0.145, tilt: 24 * D2R, R: 0.186, r: 0.0128 };  // steering wheel centre, tilt, rim radius, rim tube radius
  const SHIFT = { x: 0.0, y: 0.455 + CY, z: 0.035 }; // shifter pivot on the tunnel
  const MIRROR = { x: 0.06, y: 1.166, z: 0.235 };   /* on the glass and a hand's width toward the driver, so the whole mirror sits inside a 90 degree field of view instead of being cut by the frame edge */

  /* ------------------------------------------------------------------ cabin materials: GT.mat clones with an analytic "sky visibility" term
     (IBL + hemisphere are unoccluded in this renderer, which makes interiors flat; this darkens footwells / under-dash and keeps sills bright). */
  const cabU = { uCabInv: { value: new T.Matrix4() }, uGlowW: { value: new T.Vector3() }, uGlowC: { value: new T.Color(0, 0, 0) }, uCabAmb: { value: new T.Color(0, 0, 0) } };   // + instrument glow: a shader-only point light (no scene light, so no program re-compiles)
  const CAB_GLSL = `
    uniform mat4 uCabInv; varying vec3 vCabP;`;
  const CAB_FRAG = `
    float gtCabOcc(vec3 p){
      float h = smoothstep(0.28, 0.93, p.y);
      float o = mix(0.07, 0.50, h * h);
      float side = smoothstep(0.50, 0.76, abs(p.x)) * smoothstep(0.74, 0.88, p.y);
      float front = smoothstep(0.26, 0.62, p.z) * smoothstep(0.81, 0.90, p.y);
      float rear = smoothstep(-1.15, -1.5, p.z) * smoothstep(0.80, 0.90, p.y);
      float open = max(side, max(front, rear));
      o = max(o, open * 0.92);
      o *= mix(1.0, 0.42, smoothstep(1.08, 1.24, p.y) * (1.0 - open));
      o *= 1.0 - 0.62 * smoothstep(0.36, 0.50, p.z) * smoothstep(0.71, 0.59, p.y);
      o *= 1.0 - 0.35 * smoothstep(-0.62, -0.9, p.z) * smoothstep(0.9, 0.5, p.y);
      return o;
    }`;
  const cabCache = {};
  /** M(name, opts, k) -> cabin-lit clone of GT.mat(name, opts). k (optional) = extra tweaks {env, rough, color, key}. */
  function M(name, opts, k) {
    const key = name + (opts ? JSON.stringify(opts) : '') + (k ? JSON.stringify(k) : '');
    if (cabCache[key]) return cabCache[key];
    const base = GT.mat(name, opts);
    if (!base || !base.isMeshStandardMaterial || base.transparent) return cabCache[key] = base;
    const ud = base.userData; base.userData = {}; const m = base.clone(); base.userData = ud; m.userData = { gtMacro: ud && ud.gtMacro };
    const prev = Object.prototype.hasOwnProperty.call(base, 'onBeforeCompile') ? base.onBeforeCompile : null;
    if (k && k.env !== undefined) m.envMapIntensity = k.env;
    cabPatch(m, prev); m.name = 'cab_' + key; return cabCache[key] = m;
  }
  function cabPatch(m, prev, spec) {
    const sp = spec === undefined ? 0.55 : spec;
    m.onBeforeCompile = sh => {
      if (prev) prev(sh);
      sh.uniforms.uCabInv = cabU.uCabInv; sh.uniforms.uGlowW = cabU.uGlowW; sh.uniforms.uGlowC = cabU.uGlowC; sh.uniforms.uCabAmb = cabU.uCabAmb;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + CAB_GLSL)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vCabP = (uCabInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + CAB_GLSL + 'uniform vec3 uGlowW; uniform vec3 uGlowC; uniform vec3 uCabAmb;' + CAB_FRAG)
        .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n float cabO = gtCabOcc(vCabP);\n irradiance *= cabO; iblIrradiance *= cabO; irradiance += uCabAmb * (.35 + .65 * cabO); radiance *= mix(cabO, 1.0, ' + sp.toFixed(2) + ');\n { vec3 gL = (viewMatrix * vec4(uGlowW, 1.0)).xyz + vViewPosition; float gd = length(gL); irradiance += uGlowC * max(dot(geometry.normal, gL / gd), 0.0) / (1.0 + 70.0 * gd * gd); }');
    };
    m.customProgramCacheKey = () => 'gtcab' + (prev ? 1 : 0) + sp.toFixed(2);
    return m;
  }
  /** mirror glass that shows the real road behind: it looks the ray it reflects up in the small rear view js/render.js draws (GT.render.mirror: one 448x188 render every 2nd-4th frame, shared by every mirror).
      The glass normal comes from screen derivatives (the quads here carry no usable normals). tip = radians-ish the reflected ray is lifted, as a driver sets a door mirror. Outside the rear view it is a dark tinted glass. */
  function rearMat(tip, tint, aim) { const RM = GT.render && GT.render.mirror; if (!RM || !RM.glsl || !RM.uniforms) return null;
    /* The normal used to come from derivatives of the WORLD position: at world coordinates of a hundred metres a float keeps about 0.01 mm, a pixel of this glass is 0.5 mm, so every pixel got its own normal
       and the mirror showed static. Positions are now taken in view space (modelViewMatrix is built on the CPU, values under a metre).
       aim: the cabin mirror is not left to its modelled tilt at all. Its normal is whatever sends the ray from the eye through the glass centre straight back along the car (a touch down, slightly convex),
       as a driver sets it, so the road behind fills the whole glass. The mesh origin must be the glass centre. */
    return new T.ShaderMaterial({ fog: false, uniforms: { gtRearTex: RM.uniforms.gtRearTex, gtRearVP: RM.uniforms.gtRearVP, gtRearK: RM.uniforms.gtRearK, uTip: { value: tip || 0 }, uAim: { value: aim ? 1 : 0 }, uTint: { value: tint || new T.Color(.86, .88, .9) } },
      vertexShader: 'varying vec3 vV; varying vec3 vC;\nvoid main(){ vec4 v = modelViewMatrix * vec4(position, 1.0); vV = v.xyz; vC = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; gl_Position = projectionMatrix * v; }',
      fragmentShader: RM.glsl + 'uniform float uTip; uniform float uAim; uniform vec3 uTint; varying vec3 vV; varying vec3 vC;\nvoid main(){ vec3 I = normalize(vV); vec3 n;\n if (uAim > 0.5) { vec3 f = vec3(gtRearVP[0][3], gtRearVP[1][3], gtRearVP[2][3]); vec3 up = normalize(vec3(gtRearVP[0][1], gtRearVP[1][1], gtRearVP[2][1]) + vec3(0.0, 1e-6, 0.0)); vec3 d = normalize((viewMatrix * vec4(f - up * 0.04, 0.0)).xyz + vec3(0.0, 0.0, 1e-6)); vec3 n0 = normalize(d - normalize(vC)); vec3 of = vV - vC; of -= n0 * dot(of, n0); n = normalize(n0 + of * 0.55); }\n else { n = normalize(cross(dFdx(vV), dFdy(vV)) + vec3(0.0, 0.0, 1e-9)); if (dot(n, I) > 0.0) n = -n; }\n vec3 r = (vec4(reflect(I, n), 0.0) * viewMatrix).xyz; r = normalize(vec3(r.x, r.y + uTip, r.z)); vec4 c = gtRear(r); gl_FragColor = vec4(mix(vec3(0.012, 0.014, 0.017), c.rgb * uTint, c.a), 1.0); }' }); }
  /* per-vehicle trim: the one modelled cabin is re-dressed for the car it sits in (seat and door-card colour, headliner, pillar trim, dash pad, the wood strip, the instrument light).
     Values multiply the materials' own colours (their textures stay), glow = the colour of the gauge lighting and of its spill at night. Keyed by the host group's name (cnv_<kind>, js/cnvehicles.js). */
  const TRIMS = {
    sports: { seat: [1, 1, 1], dark: [1, 1, 1], head: [1, 1, 1], trim: [1, 1, 1], dash: [1, 1, 1], wood: [1, 1, 1], glow: [.5, 1, .72] },                                        /* as built: tan leather, walnut, green instruments */
    taxi: { seat: [.2, .21, .24], dark: [.3, .3, .34], head: [.72, .74, .78], trim: [.6, .62, .66], dash: [.8, .82, .9], wood: [.1, .1, .11], glow: [.25, 1, .45] },               /* black wipe-clean vinyl, grey plastics, taxi-green meter light */
    police: { seat: [.13, .14, .17], dark: [.2, .2, .24], head: [.5, .52, .58], trim: [.42, .44, .5], dash: [.6, .62, .72], wood: [.06, .06, .07], glow: [.55, .8, 1.25] },        /* all dark, cold blue-white instruments */
    van: { seat: [.5, .47, .44], dark: [.6, .56, .5], head: [.95, .9, .78], trim: [1.05, .98, .84], dash: [1.25, 1.15, 1.0], wood: [.2, .19, .18], glow: [1.2, .7, .2] },           /* worn grey-brown cloth, sun-yellowed plastics, amber bulbs */
    bus: { seat: [.3, .42, .62], dark: [.4, .5, .7], head: [.85, .88, .9], trim: [.8, .84, .9], dash: [.9, .95, 1.1], wood: [.12, .13, .15], glow: [1.2, .75, .25] },
    laotoule: { seat: [1.25, .62, .74], dark: [1.4, .7, .85], head: [1.1, 1.0, 1.0], trim: [1.3, 1.05, 1.1], dash: [1.5, 1.1, 1.2], wood: [1.3, .7, .8], glow: [1.3, .45, .85] } };  /* pink quilting, pink everything */
  /** a cabin-lit MeshStandardMaterial with its own (canvas) textures */
  function cabStd(params, spec) { return cabPatch(new T.MeshStandardMaterial(params), null, spec); }

  /* ------------------------------------------------------------------ geometry helpers */
  function finishGeo(P, U, I) {
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('uv', new T.BufferAttribute(new Float32Array(U), 2));
    g.setIndex(new T.BufferAttribute(new Uint32Array(I), 1)); return g;
  }
  function flipGeo(g) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } const n = g.attributes.normal; if (n) for (let i = 0; i < n.count * 3; i++) n.array[i] = -n.array[i]; return g; }
  function signedVol(g) { const p = g.attributes.position.array, ix = g.index.array; let v = 0;
    for (let i = 0; i < ix.length; i += 3) { const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
      v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]); } return v; }
  /** loft(rings, o): rings = [[ [x,y,z], ... ], ...] all the same length.
      o: closed (ring wraps, default true), cap0/cap1 (fan caps), inward (flip), face [x,y,z] (open sheets: side that must be visible),
         uvSwap (u along the loft), uvScale, uvRect [u0,v0,u1,v1] (normalised mapping instead of metres) */
  function loft(rings, o) {
    o = o || {}; const closed = o.closed !== false, nr = rings.length, np = rings[0].length, cols = closed ? np + 1 : np, P = [], U = [], I = [], us = o.uvScale || 1;
    let vAcc = 0; const vLen = [0], uLen = [];
    for (let i = 1; i < nr; i++) { let d = 0, c = 0; for (let j = 0; j < np; j += Math.max(1, np >> 3)) { d += dist3(rings[i][j], rings[i - 1][j]); c++; } vAcc += d / c; vLen.push(vAcc); }
    for (let i = 0; i < nr; i++) { const r = rings[i]; let uAcc = 0; const ua = [0];
      for (let j = 1; j < cols; j++) { uAcc += dist3(r[j % np], r[(j - 1) % np]); ua.push(uAcc); } uLen.push(uAcc);
      for (let j = 0; j < cols; j++) { const p = r[j % np]; P.push(p[0], p[1], p[2]);
        let u = ua[j] - (o.uCentre ? uAcc / 2 : 0), v = vLen[i];
        if (o.uvRect) { const q = o.uvRect; u = q[0] + (q[2] - q[0]) * (uAcc > 0 ? ua[j] / uAcc : 0); v = q[1] + (q[3] - q[1]) * (vAcc > 0 ? vLen[i] / vAcc : 0); } else { u *= us; v *= us; }
        if (o.uvSwap) U.push(v, u); else U.push(u, v); } }
    for (let i = 0; i < nr - 1; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; I.push(a, c, b, b, c, d); }
    const cap = (i, rev) => { const r = rings[i], c = [0, 0, 0]; for (const p of r) { c[0] += p[0] / np; c[1] += p[1] / np; c[2] += p[2] / np; }
      const base = P.length / 3; P.push(c[0], c[1], c[2]); U.push(0, 0); for (let j = 0; j < np; j++) { const p = r[j]; P.push(p[0], p[1], p[2]); U.push((p[0] - c[0]) * us + (p[2] - c[2]) * us, (p[1] - c[1]) * us); }
      for (let j = 0; j < np; j++) { const a = base + 1 + j, b = base + 1 + (j + 1) % np; if (rev) I.push(base, b, a); else I.push(base, a, b); } };
    if (o.cap0) cap(0, false); if (o.cap1) cap(nr - 1, true);
    const g = finishGeo(P, U, I); g.computeVertexNormals();
    if (closed) { const n = g.attributes.normal; for (let i = 0; i < nr; i++) { const a = i * cols, b = a + np, x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1; n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l); } }
    let flip = false;
    if (o.face) { const n = g.attributes.normal; let sx = 0, sy = 0, sz = 0; for (let i = 0; i < nr * cols; i++) { sx += n.getX(i); sy += n.getY(i); sz += n.getZ(i); } flip = sx * o.face[0] + sy * o.face[1] + sz * o.face[2] < 0; }
    else if (closed && !o.noOrient) flip = signedVol(g) < 0;
    if (o.inward) flip = !flip;
    if (flip) flipGeo(g);
    return g;
  }
  /** ring of points for an ellipse / superellipse in a plane given by centre c, axes ax, ay (arrays) */
  function ringPts(c, ax, ay, n, pw) { const r = []; for (let j = 0; j < n; j++) { const a = j / n * TAU; let cx = Math.cos(a), sy = Math.sin(a);
      if (pw) { cx = Math.sign(cx) * Math.pow(Math.abs(cx), pw); sy = Math.sign(sy) * Math.pow(Math.abs(sy), pw); }
      r.push([c[0] + ax[0] * cx + ay[0] * sy, c[1] + ax[1] * cx + ay[1] * sy, c[2] + ax[2] * cx + ay[2] * sy]); } return r; }
  /** surface of revolution about +Y from a profile [[r,y],...] (outward-facing, UVs in metres) */
  function lathe(prof, seg, o) { seg = seg || 24; o = o || {}; const rings = prof.map(p => { const r = []; for (let j = 0; j < seg; j++) { const a = j / seg * TAU; r.push([Math.cos(a) * p[0], p[1], Math.sin(a) * p[0]]); } return r; });
    const g = loft(rings, Object.assign({}, o, { inward: false, noOrient: true })), P = g.attributes.position, N = g.attributes.normal; let s = 0, sy = 0, ym = 0;
    for (const q of prof) ym += q[1] / prof.length;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), l = Math.hypot(x, z); s += (N.getX(i) * x + N.getZ(i) * z); sy += N.getY(i) * (P.getY(i) - ym) * l; }
    let flip = Math.abs(s) > 1e-9 ? s < 0 : sy < 0; if (o.inward) flip = !flip; if (flip) flipGeo(g); return g; }
  /** tube along a polyline with per-point radius (round section) */
  function tubeR(pts, radii, seg, o) { seg = seg || 10; const rings = [], n = pts.length; let up = V3(0, 1, 0), prevN = null;
    for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], t = V3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      let nn = prevN ? prevN.clone().sub(t.clone().multiplyScalar(prevN.dot(t))) : (Math.abs(t.y) > .9 ? V3(1, 0, 0) : up.clone().sub(t.clone().multiplyScalar(up.dot(t))));
      nn.normalize(); prevN = nn; const bb = t.clone().cross(nn), r = typeof radii === 'number' ? radii : radii[i];
      rings.push(ringPts(pts[i], [nn.x * r, nn.y * r, nn.z * r], [bb.x * r, bb.y * r, bb.z * r], seg)); }
    return loft(rings, Object.assign({ cap0: true, cap1: true }, o || {})); }
  /** soft rounded box centred at the origin: big corner radius r, top (+Y) face displaced by disp(x, z) (pleats, crowns). UVs in metres. */
  function softBox(w, h, d, r, sx, sy, sz, disp, nb) {
    const big = Math.max(w, h, d); if (!nb) { nb = big < .035 ? 1 : big < .12 ? 2 : 3; if (big < .12) { sx = Math.min(sx, 5); sy = Math.min(sy, 5); sz = Math.min(sz, 5); } }
    r = Math.min(r, Math.min(w, h, d) * .49); sx = Math.max(sx, nb * 2 + 1); sy = Math.max(sy, nb * 2 + 1); sz = Math.max(sz, nb * 2 + 1);
    const g = new T.BoxGeometry(w, h, d, sx, sy, sz), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, hw = w / 2, hh = h / 2, hd = d / 2;
    const remap = (v, half, s) => { const i = Math.round((v + half) / (2 * half) * s); if (i <= nb) return -half + r * Math.sin(i / nb * PI / 2); if (i >= s - nb) return half - r * Math.sin((s - i) / nb * PI / 2); return -half + r + (2 * half - 2 * r) * (i - nb) / (s - 2 * nb); };
    for (let i = 0; i < p.count; i++) { const fx = n.getX(i), fy = n.getY(i), fz = n.getZ(i);
      let x = remap(p.getX(i), hw, sx), y = remap(p.getY(i), hh, sy), z = remap(p.getZ(i), hd, sz);
      const ix = cl(x, -(hw - r), hw - r), iy = cl(y, -(hh - r), hh - r), iz = cl(z, -(hd - r), hd - r); let nx = x - ix, ny = y - iy, nz = z - iz; const l = Math.hypot(nx, ny, nz);
      if (l > 1e-7) { nx /= l; ny /= l; nz /= l; x = ix + nx * r; y = iy + ny * r; z = iz + nz * r; } else { nx = fx; ny = fy; nz = fz; }
      if (disp && ny > 0.02) { const e = .0015, d0 = disp(x, z), dx = (disp(x + e, z) - disp(x - e, z)) / (2 * e), dz = (disp(x, z + e) - disp(x, z - e)) / (2 * e), k = sst(ny, .02, .75);
        y += d0 * k; nx -= dx * k; nz -= dz * k; const l2 = Math.hypot(nx, ny, nz) || 1; nx /= l2; ny /= l2; nz /= l2; }
      p.setXYZ(i, x, y, z); n.setXYZ(i, nx, ny, nz);
      if (Math.abs(fx) > .5) uv.setXY(i, z, y); else if (Math.abs(fy) > .5) uv.setXY(i, x, z); else uv.setXY(i, x, y); }
    return g;
  }
  /** flat plate with optional circular / polygon holes, extruded along +Z from 0..depth with a bevel. outline = [[x,y],...] (CCW) */
  function plate(outline, holes, depth, bevel, seg) {
    const sh = new T.Shape(outline.map(p => new T.Vector2(p[0], p[1])));
    for (const h of holes || []) { const pa = new T.Path(); if (h.r) pa.absarc(h.x, h.y, h.r, 0, TAU, true); else pa.setFromPoints(h.pts.map(p => new T.Vector2(p[0], p[1])).reverse()); sh.holes.push(pa); }
    return new T.ExtrudeGeometry(sh, { depth: depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: seg || 24, steps: 1 });
  }
  function rrect(w, h, r, n) { n = n || 5; const pts = [], hw = w / 2, hh = h / 2; r = Math.min(r, hw, hh);
    [[hw - r, hh - r, 0], [-hw + r, hh - r, PI / 2], [-hw + r, -hh + r, PI], [hw - r, -hh + r, PI * 1.5]].forEach(c => { for (let i = 0; i <= n; i++) { const a = c[2] + i / n * PI / 2; pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } }); return pts; }
  function circlePts(r, n, cx, cy) { const p = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; p.push([(cx || 0) + Math.cos(a) * r, (cy || 0) + Math.sin(a) * r]); } return p; }
  /** torus in the XY plane (axis Z), UVs in metres */
  function torus(R, r, seg, tseg, arc) { const g = new T.TorusGeometry(R, r, tseg || 8, seg || 32, arc || TAU), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * R, uv.getY(i) * TAU * r); return g; }
  /** disc in XY facing +Z with UVs mapped to an atlas rect [u0,v0,u1,v1] */
  function disc(r, seg, rect) { const g = new T.CircleGeometry(r, seg || 40); if (rect) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1])); } return g; }
  /** quad in XY facing +Z mapped to an atlas rect */
  function rectQuad(w, h, rect) { const g = new T.PlaneGeometry(w, h); if (rect) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1])); } return g; }
  /** a row of tiny stitches along a polyline lying on a surface with normal `up` */
  function stitches(k, mat, pts, up, o) {
    o = o || {}; const pitch = o.pitch || .006, len = o.len || .0034, w = o.w || .0011, lift = o.lift === undefined ? .0004 : o.lift, P = [], U = [], I = [];
    const upF = typeof up === 'function' ? up : () => up;
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], L = dist3(a, b); if (L < 1e-6) continue;
      const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
      for (let s = carry; s < L; s += pitch) { const c = [a[0] + t[0] * s, a[1] + t[1] * s, a[2] + t[2] * s], n = upF(c), sd = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]], base = P.length / 3;
        // a tiny 3-sided prism with pointed ends -> reads as a thread with a highlight
        const e0 = [c[0] - t[0] * len / 2 + n[0] * lift, c[1] - t[1] * len / 2 + n[1] * lift, c[2] - t[2] * len / 2 + n[2] * lift], e1 = [c[0] + t[0] * len / 2 + n[0] * lift, c[1] + t[1] * len / 2 + n[1] * lift, c[2] + t[2] * len / 2 + n[2] * lift];
        const m = j => { const sx = j === 1 ? w / 2 : j === 2 ? -w / 2 : 0, sy = j === 0 ? w * .9 : 0; return [c[0] + sd[0] * sx + n[0] * (sy + lift), c[1] + sd[1] * sx + n[1] * (sy + lift), c[2] + sd[2] * sx + n[2] * (sy + lift)]; };
        P.push(...e0, ...m(0), ...m(1), ...m(2), ...e1); for (let q = 0; q < 5; q++) U.push(q * .001, s);
        for (let j = 0; j < 3; j++) { const a1 = base + 1 + j, b1 = base + 1 + (j + 1) % 3; I.push(base, b1, a1, base + 4, a1, b1); } }
      carry = (carry + Math.ceil((L - carry) / pitch) * pitch) - L; }
    if (!P.length) return; const g = finishGeo(P, U, I); g.computeVertexNormals(); if (signedVol(g) < 0) flipGeo(g); k.geo(mat, g);
  }
  /** resample a polyline to roughly even spacing (for stitches along curves) */
  function polyline(fn, n) { const p = []; for (let i = 0; i <= n; i++) p.push(fn(i / n)); return p; }

  /* ------------------------------------------------------------------ canvas helpers */
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function ctex(c, srgb) { const t = new T.CanvasTexture(c); if (srgb !== false) t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; }
  function normalFromCanvas(c, strength) {      // height = red channel
    const w = c.width, h = c.height, src = c.getContext('2d').getImageData(0, 0, w, h).data, out = canvas(w, h), g = out.getContext('2d'), im = g.createImageData(w, h), d = im.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, l = src[(y * w + (x + w - 1) % w) * 4], r = src[(y * w + (x + 1) % w) * 4], u = src[(((y + h - 1) % h) * w + x) * 4], dn = src[(((y + 1) % h) * w + x) * 4];
      let nx = (l - r) / 255 * strength, ny = (dn - u) / 255 * strength; const il = 1 / Math.sqrt(nx * nx + ny * ny + 1); d[i] = (nx * il * .5 + .5) * 255; d[i + 1] = (ny * il * .5 + .5) * 255; d[i + 2] = (il * .5 + .5) * 255; d[i + 3] = 255; }
    g.putImageData(im, 0, 0); const t = new T.CanvasTexture(out); t.anisotropy = 8; return t;
  }
  const FONT = '"Helvetica Neue", "Arial Narrow", Arial, sans-serif', FONTC = '"DIN Condensed", "Avenir Next Condensed", "Arial Narrow", Arial, sans-serif', SCRIPT = '"Snell Roundhand", "Brush Script MT", "Savoye LET", cursive';

  /* ================================================================== canvas textures */
  const TX = {};
  const A0 = -132 * D2R, A1 = 132 * D2R;            // needle sweep of the big dials (clockwise from 12 o'clock)
  const SMALL_SWEEP = 52 * D2R;
  const px2uv = (S, x, y, w, h) => [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S];

  function gaugeAtlas() {
    if (TX.gauge) return TX.gauge;
    const S = 1024, cf = canvas(S, S), cg = canvas(S, S), f = cf.getContext('2d'), g = cg.getContext('2d');
    f.fillStyle = '#0b0b0c'; f.fillRect(0, 0, S, S); g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const CREAM = '#e7dfc8', GLOW = '#8effc4', GLOWDIM = '#3fae7c', RED = '#c93a22', GRED = '#ff5a2a', AMB = '#ffb347';
    const both = fn => { fn(f, false); fn(g, true); };
    const pol = (cx, cy, r, a) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
    function face(cx, cy, R) {
      const gr = f.createRadialGradient(cx - R * .2, cy - R * .3, R * .05, cx, cy, R * 1.05); gr.addColorStop(0, '#1d1e20'); gr.addColorStop(.7, '#121314'); gr.addColorStop(1, '#070708');
      f.fillStyle = gr; f.beginPath(); f.arc(cx, cy, R * 1.04, 0, TAU); f.fill();
      f.strokeStyle = 'rgba(255,255,255,.025)'; f.lineWidth = 1; for (let r = R * .12; r < R; r += 3) { f.beginPath(); f.arc(cx, cy, r, 0, TAU); f.stroke(); }     // spun-metal sheen
      f.strokeStyle = 'rgba(0,0,0,.55)'; f.lineWidth = R * .05; f.beginPath(); f.arc(cx, cy, R * 1.0, 0, TAU); f.stroke();
      g.fillStyle = 'rgba(30,90,60,.10)'; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();                                                                   // faint flood from the hidden bulbs
      const fl = g.createRadialGradient(cx, cy - R * .95, 0, cx, cy - R * .95, R * 1.1); fl.addColorStop(0, 'rgba(120,255,190,.22)'); fl.addColorStop(1, 'rgba(120,255,190,0)'); g.fillStyle = fl; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
    }
    function ticks(cx, cy, R, o) {
      both((c, gl) => { c.lineCap = 'butt';
        const n = Math.round((o.max - o.min) / o.minor);
        for (let i = 0; i <= n; i++) { const v = o.min + i * o.minor, a = lerp(o.a0, o.a1, (v - o.min) / (o.max - o.min)), maj = Math.abs(v / o.major - Math.round(v / o.major)) < 1e-6, mid = o.mid && Math.abs(v / o.mid - Math.round(v / o.mid)) < 1e-6;
          const red = o.red !== undefined && v >= o.red - 1e-6; c.strokeStyle = red ? (gl ? GRED : RED) : (gl ? GLOW : CREAM);
          c.lineWidth = R * (maj ? .026 : mid ? .016 : .009); const p0 = pol(cx, cy, R * .9, a), p1 = pol(cx, cy, R * (maj ? .745 : mid ? .79 : .83), a);
          if (gl) { c.shadowColor = red ? GRED : GLOW; c.shadowBlur = R * .03; } c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); c.shadowBlur = 0;
          if (maj && o.label) { const t = o.label(v); if (t !== null) { const pt = pol(cx, cy, R * (o.lr || .6), a); c.fillStyle = red ? (gl ? GRED : RED) : (gl ? GLOW : CREAM); c.font = `600 ${R * (o.fs || .17)}px ${FONTC}`; c.textAlign = 'center'; c.textBaseline = 'middle';
            if (gl) { c.shadowColor = c.fillStyle; c.shadowBlur = R * .04; } c.fillText(t, pt[0], pt[1] + R * .012); c.shadowBlur = 0; } } }
        // outer arc
        c.strokeStyle = gl ? GLOWDIM : 'rgba(231,223,200,.75)'; c.lineWidth = R * .008; c.beginPath(); c.arc(cx, cy, R * .905, o.a0 - PI / 2, (o.red !== undefined ? lerp(o.a0, o.a1, (o.red - o.min) / (o.max - o.min)) : o.a1) - PI / 2); c.stroke();
        if (o.red !== undefined) { c.strokeStyle = gl ? GRED : RED; c.lineWidth = R * .03; c.beginPath(); c.arc(cx, cy, R * .925, lerp(o.a0, o.a1, (o.red - o.min) / (o.max - o.min)) - PI / 2, o.a1 - PI / 2); c.stroke(); } });
    }
    const text = (t, x, y, size, o) => both((c, gl) => { o = o || {}; c.fillStyle = gl ? (o.gcol || GLOWDIM) : (o.col || CREAM); c.font = `${o.w || 600} ${size}px ${o.font || FONTC}`; c.textAlign = o.align || 'center'; c.textBaseline = 'middle'; if (gl && o.dim) c.globalAlpha = .6; c.fillText(t, x, y); c.globalAlpha = 1; });
    // ---- speedometer (0..140 mph)
    { const cx = 256, cy = 256, R = 236; face(cx, cy, R);
      ticks(cx, cy, R, { min: 0, max: 140, major: 20, mid: 10, minor: 2, a0: A0, a1: A1, label: v => String(v), lr: .6, fs: .165 });
      text('MPH', cx, cy + R * .34, R * .1); text('Solano', cx, cy - R * .30, R * .15, { font: SCRIPT, w: 400, dim: 1 });
      // odometer drums
      const ow = R * .5, oh = R * .13, ox = cx - ow / 2, oy = cy + R * .50; f.fillStyle = '#050505'; f.fillRect(ox - 3, oy - 3, ow + 6, oh + 6); const dg = '048217';
      for (let i = 0; i < 6; i++) { const x = ox + i * ow / 6; const gr = f.createLinearGradient(0, oy, 0, oy + oh); const last = i === 5; gr.addColorStop(0, last ? '#8d8a80' : '#060606'); gr.addColorStop(.5, last ? '#e6e2d6' : '#242424'); gr.addColorStop(1, last ? '#8d8a80' : '#060606');
        f.fillStyle = gr; f.fillRect(x + 1, oy, ow / 6 - 2, oh); f.fillStyle = last ? '#111' : '#e4e0d2'; f.font = `600 ${oh * .86}px ${FONTC}`; f.textAlign = 'center'; f.textBaseline = 'middle'; f.fillText(dg[i], x + ow / 12, oy + oh * .56);
        g.fillStyle = 'rgba(120,255,190,.35)'; g.font = f.font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(dg[i], x + ow / 12, oy + oh * .56); }
      // tell-tales: turn arrows + high beam + brake (lit from update via separate quads; printed dark here)
    }
    // ---- tachometer (0..8 x1000)
    { const cx = 768, cy = 256, R = 236; face(cx, cy, R);
      ticks(cx, cy, R, { min: 0, max: 8, major: 1, mid: .5, minor: .1, a0: A0, a1: A1, label: v => String(Math.round(v)), lr: .6, fs: .2, red: 6 });
      text('RPM', cx, cy + R * .34, R * .1); text('x1000', cx, cy + R * .45, R * .07, { dim: 1 }); text('GT', cx, cy - R * .30, R * .13, { w: 700 });
      text('8 CYL', cx, cy + R * .62, R * .055, { dim: 1 }); }
    // ---- small gauges: fuel, temp, clock, (amps)
    function small(cx, cy, R, title, lo, hi, redSide) {
      face(cx, cy, R);
      both((c, gl) => { for (let i = 0; i <= 8; i++) { const a = lerp(-SMALL_SWEEP, SMALL_SWEEP, i / 8), maj = i % 4 === 0, mid = i % 2 === 0, red = redSide === 'lo' ? i === 0 : redSide === 'hi' ? i >= 7 : false;
          c.strokeStyle = red ? (gl ? GRED : RED) : (gl ? GLOW : CREAM); c.lineWidth = R * (maj ? .05 : mid ? .03 : .018); const p0 = pol(cx, cy + R * .25, R * 1.02, a), p1 = pol(cx, cy + R * .25, R * (maj ? .8 : .88), a);
          if (gl) { c.shadowColor = c.strokeStyle; c.shadowBlur = R * .05; } c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); c.shadowBlur = 0; } });
      const pl = pol(cx, cy + R * .25, R * .62, -SMALL_SWEEP), ph = pol(cx, cy + R * .25, R * .62, SMALL_SWEEP);
      text(lo, pl[0], pl[1], R * .26, { gcol: redSide === 'lo' ? GRED : GLOW, col: redSide === 'lo' ? RED : CREAM, w: 700 }); text(hi, ph[0], ph[1], R * .26, { gcol: redSide === 'hi' ? GRED : GLOW, col: redSide === 'hi' ? RED : CREAM, w: 700 });
      text(title, cx, cy + R * .68, R * .17);
    }
    small(128, 640, 116, 'FUEL', 'E', 'F', 'lo'); small(384, 640, 116, 'TEMP', 'C', 'H', 'hi');
    { const cx = 640, cy = 640, R = 116; face(cx, cy, R);       // clock
      both((c, gl) => { for (let i = 0; i < 60; i++) { const a = i / 60 * TAU, maj = i % 5 === 0; c.strokeStyle = gl ? GLOW : CREAM; c.lineWidth = R * (maj ? .04 : .012); const p0 = pol(cx, cy, R * .9, a), p1 = pol(cx, cy, R * (maj ? .76 : .84), a); c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); } });
      [[12, 0], [3, 1], [6, 2], [9, 3]].forEach(q => { const p = pol(cx, cy, R * .55, q[1] * PI / 2); text(String(q[0]), p[0], p[1] + 3, R * .26, { gcol: GLOW, w: 700 }); }); text('QUARTZ', cx, cy + R * .28, R * .09, { dim: 1 }); }
    { const cx = 896, cy = 640, R = 116; face(cx, cy, R);       // oil pressure (static needle; fills the 4th pod)
      both((c, gl) => { for (let i = 0; i <= 8; i++) { const a = lerp(-SMALL_SWEEP, SMALL_SWEEP, i / 8), maj = i % 4 === 0; c.strokeStyle = gl ? GLOW : CREAM; c.lineWidth = R * (maj ? .05 : .02); const p0 = pol(cx, cy + R * .25, R * 1.02, a), p1 = pol(cx, cy + R * .25, R * (maj ? .8 : .88), a); c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); } });
      text('OIL', cx, cy + R * .68, R * .17); const pl = pol(cx, cy + R * .25, R * .62, -SMALL_SWEEP), ph = pol(cx, cy + R * .25, R * .62, SMALL_SWEEP); text('0', pl[0], pl[1], R * .24, { gcol: GLOW, w: 700 }); text('80', ph[0], ph[1], R * .24, { gcol: GLOW, w: 700 }); }
    // ---- tell-tale lamp lenses (row y=780..860): left arrow, right arrow, high beam, brake, oil  (drawn bright; each is its own small quad lit from update)
    const lamp = (i, draw) => { const x = 16 + i * 96, y = 784; f.fillStyle = '#060606'; f.fillRect(x, y, 80, 64); g.save(); f.save(); f.translate(x + 40, y + 32); g.translate(x + 40, y + 32); draw(f, true); draw(g, false); f.restore(); g.restore(); };
    const arrow = dir => (c, dim) => { c.fillStyle = dim ? '#12301c' : '#46ff7a'; c.beginPath(); c.moveTo(dir * 30, 0); c.lineTo(dir * 2, -24); c.lineTo(dir * 2, -11); c.lineTo(-dir * 28, -11); c.lineTo(-dir * 28, 11); c.lineTo(dir * 2, 11); c.lineTo(dir * 2, 24); c.closePath(); c.fill(); };
    lamp(0, arrow(-1)); lamp(1, arrow(1));
    lamp(2, (c, dim) => { c.fillStyle = dim ? '#0e1c33' : '#4aa2ff'; c.beginPath(); c.arc(-4, 0, 20, -PI / 2, PI / 2); c.closePath(); c.fill(); c.strokeStyle = c.fillStyle; c.lineWidth = 5; for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(-10, k * 9); c.lineTo(-34, k * 9); c.stroke(); } });
    lamp(3, (c, dim) => { c.fillStyle = dim ? '#33100c' : '#ff3b22'; c.font = `700 30px ${FONTC}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('BRAKE', 0, 2); });
    lamp(4, (c, dim) => { c.fillStyle = dim ? '#332408' : '#ffb02a'; c.font = `700 34px ${FONTC}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('OIL', 0, 2); });
    const R_ = (x, y, w, h) => px2uv(S, x, y, w, h);
    return TX.gauge = { face: ctex(cf), glow: ctex(cg), speedo: R_(0, 0, 512, 512), tach: R_(512, 0, 512, 512), fuel: R_(0, 512, 256, 256), temp: R_(256, 512, 256, 256), clock: R_(512, 512, 256, 256), oil: R_(768, 512, 256, 256),
      lamps: [0, 1, 2, 3, 4].map(i => R_(16 + i * 96, 784, 80, 64)) };
  }

  /* ---- labels / badges atlas (alpha) + night-glow version */
  function labelAtlas() {
    if (TX.label) return TX.label;
    const W = 1024, H = 512, cf = canvas(W, H), cg = canvas(W, H), f = cf.getContext('2d'), g = cg.getContext('2d'), rects = {};
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const R_ = (name, x, y, w, h) => { rects[name] = [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H]; };
    const CREAM = '#ddd6c0', AMB = '#ffb65a', GRN = '#8effc4';
    // tuner slide-rule
    { const x = 0, y = 0, w = 512, h = 72; R_('tuner', x, y, w, h); const gr = f.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#1b1710'); gr.addColorStop(.5, '#2a2317'); gr.addColorStop(1, '#14110b'); f.fillStyle = gr; f.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,170,70,.16)'; g.fillRect(x, y, w, h);
      const row = (yy, a, b, vals, lab) => [f, g].forEach((c, gi) => { c.fillStyle = gi ? AMB : CREAM; c.strokeStyle = c.fillStyle; c.font = `600 17px ${FONTC}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 1.5;
        vals.forEach(v => { const px = x + 56 + (v - a) / (b - a) * (w - 96); c.fillText(String(v), px, yy); });
        for (let i = 0; i <= 40; i++) { const px = x + 56 + i / 40 * (w - 96); c.beginPath(); c.moveTo(px, yy + (yy < y + h / 2 ? 11 : -11)); c.lineTo(px, yy + (yy < y + h / 2 ? (i % 4 ? 15 : 19) : (i % 4 ? -15 : -19))); c.stroke(); }
        c.font = `700 15px ${FONTC}`; c.fillText(lab, x + 22, yy); });
      row(y + 17, 88, 108, [88, 92, 96, 100, 104, 108], 'FM'); row(y + 56, 54, 160, [54, 60, 70, 80, 100, 120, 140, 160], 'AM'); }
    // heater legends (three rows)
    { const x = 0, y = 80, w = 512, h = 120; R_('heater', x, y, w, h);
      const row = (yy, items) => [f, g].forEach((c, gi) => { c.font = `600 15px ${FONTC}`; c.textAlign = 'center'; c.textBaseline = 'middle'; items.forEach(it => { c.fillStyle = gi ? (it[2] || GRN) : (it[3] || CREAM); c.fillText(it[0], x + it[1] * w, yy); }); });
      row(y + 14, [['OFF', .1], ['VENT', .35], ['HEAT', .62], ['DEFROST', .88]]); row(y + 54, [['COOL', .1, '#6ac8ff', '#8fb7d6'], ['WARM', .9, '#ff7a4a', '#d98a6a']]); row(y + 94, [['FAN', .1], ['LO', .4], ['MED', .64], ['HI', .88]]);
      [f, g].forEach((c, gi) => { const gr = c.createLinearGradient(x + .2 * w, 0, x + .8 * w, 0); gr.addColorStop(0, gi ? '#59b9ff' : '#7da9cc'); gr.addColorStop(1, gi ? '#ff6a3a' : '#cc7c5c'); c.fillStyle = gr; c.beginPath(); c.moveTo(x + .2 * w, y + 54); c.lineTo(x + .8 * w, y + 48); c.lineTo(x + .8 * w, y + 60); c.closePath(); c.fill(); }); }
    // PRND strip (vertical, forward = top)
    { const x = 528, y = 0, w = 56, h = 240; R_('prnd', x, y, w, h); f.fillStyle = '#0c0c0d'; f.fillRect(x, y, w, h); g.fillStyle = 'rgba(120,255,190,.10)'; g.fillRect(x, y, w, h);
      ['P', 'R', 'N', 'D', '2', '1'].forEach((t, i) => [f, g].forEach((c, gi) => { c.fillStyle = gi ? (t === 'R' ? '#ff6a3a' : GRN) : (t === 'R' ? '#d9553a' : CREAM); c.font = `700 30px ${FONTC}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, x + w / 2, y + 22 + i * 39); })); }
    // horn emblem (original: half sun over two waves in a ring)
    { const x = 600, y = 0, s = 200, cx = x + s / 2, cy = y + s / 2; R_('emblem', x, y, s, s);
      let gr = f.createRadialGradient(cx - 20, cy - 30, 5, cx, cy, s / 2); gr.addColorStop(0, '#2a1512'); gr.addColorStop(1, '#0c0706'); f.fillStyle = gr; f.beginPath(); f.arc(cx, cy, s / 2 - 2, 0, TAU); f.fill();
      f.save(); f.beginPath(); f.arc(cx, cy, s / 2 - 12, 0, TAU); f.clip();
      for (let i = 0; i < 9; i++) { const a = -PI + i / 8 * PI; f.fillStyle = i % 2 ? '#d9a441' : '#c2562d'; f.beginPath(); f.moveTo(cx, cy + 12); f.arc(cx, cy + 12, s, a - PI / 16, a + PI / 16); f.closePath(); f.fill(); }
      f.fillStyle = '#e9d9a8'; f.beginPath(); f.arc(cx, cy + 12, 36, PI, TAU); f.fill();
      f.fillStyle = '#0e2a33'; f.fillRect(x, cy + 12, s, s); f.strokeStyle = '#d8d3c4'; f.lineWidth = 5; for (let k = 0; k < 2; k++) { f.beginPath(); for (let i = 0; i <= 40; i++) { const px = x + i / 40 * s, py = cy + 30 + k * 22 + Math.sin(i / 40 * TAU * 3 + k) * 5; i ? f.lineTo(px, py) : f.moveTo(px, py); } f.stroke(); }
      f.restore(); f.strokeStyle = '#cfd2d6'; f.lineWidth = 7; f.beginPath(); f.arc(cx, cy, s / 2 - 9, 0, TAU); f.stroke(); f.strokeStyle = '#6d7074'; f.lineWidth = 1.5; f.beginPath(); f.arc(cx, cy, s / 2 - 13, 0, TAU); f.stroke(); }
    // script badge
    { const x = 0, y = 208, w = 420, h = 110; R_('script', x, y, w, h); const gr = f.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#f4f5f7'); gr.addColorStop(.45, '#9da1a8'); gr.addColorStop(.55, '#e6e8ea'); gr.addColorStop(1, '#7c8087');
      f.fillStyle = gr; f.font = `400 86px ${SCRIPT}`; f.textAlign = 'left'; f.textBaseline = 'middle'; f.fillText('Lanshan', x + 10, y + h * .5); f.font = `800 44px ${FONT}`; f.fillStyle = '#c2452e'; f.fillText('GT', x + 318, y + h * .56);
      f.strokeStyle = 'rgba(20,20,22,.6)'; f.lineWidth = 1; f.font = `400 86px ${SCRIPT}`; f.strokeText('Lanshan', x + 10, y + h * .5); }
    // radio brand + small legends
    { const x = 0, y = 330, w = 512, h = 40; R_('radio', x, y, w, h); [f, g].forEach((c, gi) => { c.fillStyle = gi ? 'rgba(255,182,90,.5)' : '#c9c4b4'; c.font = `700 20px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('C O R A L T O N E', x + 6, y + 20); c.font = `600 15px ${FONTC}`; c.textAlign = 'right'; c.fillText('SOLID STATE  ·  AM / FM  STEREO', x + w - 6, y + 21); }); }
    { const x = 0, y = 376, w = 512, h = 34; R_('scan', x, y, w, h); [f].forEach(c => { c.fillStyle = '#c9c4b4'; c.font = `700 17px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('TRAKKER 8', x + 6, y + 17); c.font = `600 13px ${FONTC}`; c.textAlign = 'right'; c.fillText('VOL     SQUELCH     SCAN  ·  MANUAL  ·  PRIORITY', x + w - 6, y + 18); }); }
    // sun visor placard
    { const x = 600, y = 210, w = 300, h = 150; R_('placard', x, y, w, h); f.fillStyle = '#d9d4c2'; f.fillRect(x, y, w, h); f.strokeStyle = '#3a3a38'; f.lineWidth = 2; f.strokeRect(x + 5, y + 5, w - 10, h - 10); f.fillStyle = '#22221f'; f.font = `700 17px ${FONT}`; f.textAlign = 'center'; f.textBaseline = 'middle'; f.fillText('轮胎气压（冷态）', x + w / 2, y + 24);
      f.font = `500 12px ${FONT}`; ['前 2.2 bar    后 2.4 bar    195/65 R15', '请使用 92 号及以上汽油', '磨合期 1000 公里内转速勿超 4000', '载重与牵引限值见用户手册'].forEach((t, i) => f.fillText(t, x + w / 2, y + 52 + i * 22)); f.fillStyle = 'rgba(120,90,40,.18)'; f.fillRect(x, y, w, h); }
    // tiny engraved legends: LIGHTS, WIPER, LIGHTER icon, HOT caps
    { const x = 600, y = 370, w = 400, h = 30; R_('knobs', x, y, w, h); f.fillStyle = '#c9c4b4'; f.font = `600 15px ${FONTC}`; f.textBaseline = 'middle'; f.textAlign = 'center'; ['LIGHTS', 'WIPER', 'WASH', 'LIGHTER', 'CHOKE'].forEach((t, i) => f.fillText(t, x + 40 + i * 80, y + 15)); for (let i = 0; i < 5; i++) R_('knob' + i, x + i * 80, y, 80, h); }
    // shift pattern on the knob top
    { const x = 820, y = 0, s = 128; R_('knobtop', x, y, s, s); f.fillStyle = '#f1ead6'; f.beginPath(); f.arc(x + s / 2, y + s / 2, s / 2, 0, TAU); f.fill(); f.fillStyle = '#1a1a1a'; f.font = `800 30px ${FONT}`; f.textAlign = 'center'; f.textBaseline = 'middle'; f.fillText('GT', x + s / 2, y + s / 2 + 2); f.strokeStyle = '#b3402a'; f.lineWidth = 4; f.beginPath(); f.arc(x + s / 2, y + s / 2, s * .34, 0, TAU); f.stroke(); }
    const face = ctex(cf), glow = ctex(cg);
    return TX.label = { face, glow, rects };
  }

  /* ---- printed props atlas */
  function propsAtlas() {
    if (TX.props) return TX.props;
    const S = 1024, c = canvas(S, S), g = c.getContext('2d'), rects = {}, rnd = GT.rng('cockpit-props');
    const R_ = (name, x, y, w, h) => { rects[name] = px2uv(S, x, y, w, h); };
    g.fillStyle = '#cfc8b4'; g.fillRect(0, 0, S, S);
    // road map
    { const x = 0, y = 0, w = 512, h = 512; R_('map', x, y, w, h); g.fillStyle = '#e4dcc3'; g.fillRect(x, y, w, h);
      g.fillStyle = '#a9cdd6'; g.beginPath(); g.moveTo(x, y); for (let i = 0; i <= 20; i++) g.lineTo(x + 120 + Math.sin(i * 1.3) * 22 + i * 3, y + i * h / 20); g.lineTo(x, y + h); g.closePath(); g.fill();
      g.fillStyle = '#cfe0b9'; for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(x + 220 + rnd() * 260, y + rnd() * h, 20 + rnd() * 50, 14 + rnd() * 30, rnd() * 3, 0, TAU); g.fill(); }
      g.strokeStyle = 'rgba(90,90,90,.35)'; g.lineWidth = 1; for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(x + i * 64, y); g.lineTo(x + i * 64, y + h); g.moveTo(x, y + i * 64); g.lineTo(x + w, y + i * 64); g.stroke(); }
      const road = (col, lw, n) => { for (let k = 0; k < n; k++) { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); let px = x + 140 + rnd() * 360, py = y + rnd() * h; g.moveTo(px, py); for (let i = 0; i < 6; i++) { px += (rnd() - .5) * 180; py += (rnd() - .5) * 180; g.lineTo(cl(px, x + 130, x + w), cl(py, y, y + h)); } g.stroke(); } };
      road('#9a9a94', 1.2, 14); road('#c9a23a', 2.4, 5); g.strokeStyle = '#b5432e'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(x + 175, y); for (let i = 1; i <= 16; i++) g.lineTo(x + 175 + Math.sin(i * .9) * 14 + i * 2.5, y + i * h / 16); g.stroke();
      g.fillStyle = '#35332e'; g.font = `600 13px ${FONT}`; ['钟楼', '四方街', '江滩码头', '六十七号院', '大马路', '轻轨观景台'].forEach((t, i) => g.fillText(t, x + 200 + (i * 97) % 220, y + 50 + i * 78)); g.font = `italic 600 20px ${FONT}`; g.fillStyle = '#5d8ea0'; g.save(); g.translate(x + 50, y + 330); g.rotate(-PI / 2); g.fillText('G U L F   S T R A I T', 0, 0); g.restore();
      // getaway route in marker
      g.strokeStyle = 'rgba(200,30,40,.8)'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(x + 200, y + 300); g.lineTo(x + 205, y + 200); g.lineTo(x + 330, y + 190); g.lineTo(x + 338, y + 110); g.stroke(); g.beginPath(); g.ellipse(x + 200, y + 312, 20, 15, .2, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(x + 326, y + 98); g.lineTo(x + 350, y + 122); g.moveTo(x + 350, y + 98); g.lineTo(x + 326, y + 122); g.stroke();
      g.strokeStyle = 'rgba(60,50,30,.25)'; g.lineWidth = 2; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + i * 128, y); g.lineTo(x + i * 128, y + h); g.stroke(); } g.beginPath(); g.moveTo(x, y + 256); g.lineTo(x + w, y + 256); g.stroke(); }
    // map cover panel
    { const x = 0, y = 512, w = 256, h = 512; R_('mapcover', x, y, w, h); const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#d8793f'); gr.addColorStop(.55, '#e9b45a'); gr.addColorStop(.56, '#2c6f7c'); gr.addColorStop(1, '#1c4854'); g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.fillStyle = '#f4e3b4'; g.beginPath(); g.arc(x + w / 2, y + h * .56, 70, PI, TAU); g.fill(); g.fillStyle = '#fff6dc'; g.font = `800 34px ${FONT}`; g.textAlign = 'center'; g.fillText('江城市区', x + w / 2, y + 70); g.font = `600 20px ${FONT}`; g.fillText('交通图', x + w / 2, y + 100); g.font = `600 14px ${FONT}`; g.fillText('含公交线路 · 1:25 000', x + w / 2, y + h - 40); g.textAlign = 'left'; }
    // receipt
    { const x = 528, y = 0, w = 150, h = 400; R_('receipt', x, y, w, h); g.fillStyle = '#eeebe2'; g.fillRect(x, y, w, h); g.fillStyle = '#3b3a40'; g.textAlign = 'center'; g.font = `700 14px ${FONT}`; g.fillText('便民超市', x + w / 2, y + 24); g.font = `600 10px ${FONT}`; g.fillText('烟酒 · 副食 · 充电', x + w / 2, y + 40); g.font = `500 10px monospace`; g.textAlign = 'left';
      const L = ['矿泉水 x2       ¥4.00', '              $14.56', '罐装咖啡        ¥6.50', '金江 软包      ¥13.00', '槟榔 小包       ¥10.00', '--------------------', '小计           ¥33.50', '优惠            ¥0.50', '合计           ¥33.00', '扫码支付       ¥33.00', '找零            ¥0.00', '', '谢谢惠顾 欢迎再来', '收银 02  工号 07', '18:02  #004417'];
      L.forEach((t, i) => g.fillText(t, x + 10, y + 70 + i * 19)); g.fillStyle = 'rgba(150,120,80,.12)'; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(240,120,150,.5)'; g.fillRect(x, y + h - 16, w, 6); }
    // cigarette pack (front, side, top)
    { const x = 700, y = 0, w = 150, h = 240; R_('cig', x, y, w, h); g.fillStyle = '#efe9da'; g.fillRect(x, y, w, h); g.fillStyle = '#a3261f'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + 70); g.lineTo(x + w / 2, y + 120); g.lineTo(x, y + 70); g.closePath(); g.fill();
      g.fillStyle = '#c9a54a'; g.fillRect(x, y + 196, w, 5); g.fillStyle = '#1d1b19'; g.textAlign = 'center'; g.font = `800 25px ${FONT}`; g.fillText('金江', x + w / 2, y + 152); g.font = `800 19px ${FONT}`; g.fillText('K I N G S', x + w / 2, y + 176); g.font = `600 10px ${FONT}`; g.fillText('过滤嘴香烟 20 支 · 吸烟有害健康', x + w / 2, y + 222);
      g.fillStyle = '#f2e6c6'; g.beginPath(); g.arc(x + w / 2, y + 48, 17, 0, TAU); g.fill(); g.fillStyle = '#a3261f'; g.font = `800 17px ${FONT}`; g.fillText('CK', x + w / 2, y + 54); g.textAlign = 'left';
      R_('cigside', 860, 0, 40, 240); g.fillStyle = '#a3261f'; g.fillRect(860, 0, 40, 240); g.fillStyle = '#efe9da'; g.fillRect(866, 60, 28, 170); R_('cigtop', 910, 0, 100, 40); g.fillStyle = '#d9d2bf'; g.fillRect(910, 0, 100, 40); g.fillStyle = '#b9b2a0'; g.fillRect(910, 0, 48, 40); g.fillStyle = '#3d4a70'; g.fillRect(925, 0, 18, 40); }
    // cup wrap
    { const x = 528, y = 416, w = 480, h = 150; R_('cup', x, y, w, h); g.fillStyle = '#ece5d2'; g.fillRect(x, y, w, h); g.fillStyle = '#d0652c'; g.fillRect(x, y + 22, w, 20); g.fillStyle = '#2d8c93'; g.fillRect(x, y + 48, w, 9); g.fillStyle = '#d0652c'; g.fillRect(x, y + 118, w, 9);
      for (let k = 0; k < 2; k++) { const cx = x + 120 + k * 240; g.fillStyle = '#2d8c93'; g.font = `800 34px ${FONT}`; g.textAlign = 'center'; g.fillText('冰凉茶', cx, y + 92); g.font = `700 13px ${FONT}`; g.fillStyle = '#7a3a1e'; g.fillText('大杯 · 少糖去冰', cx, y + 110); } g.textAlign = 'left'; g.fillStyle = 'rgba(120,90,50,.10)'; g.fillRect(x, y, w, h); }
    // air freshener card (board shape cut from geometry; this is the print)
    { const x = 272, y = 528, w = 200, h = 420; R_('fresh', x, y, w, h); const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#f2c14e'); gr.addColorStop(.35, '#e8743b'); gr.addColorStop(.6, '#c2416a'); gr.addColorStop(1, '#3a2a66'); g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.fillStyle = '#fbe9b0'; g.beginPath(); g.arc(x + w / 2, y + h * .5, 46, 0, TAU); g.fill(); g.fillStyle = gr; for (let i = 0; i < 5; i++) g.fillRect(x, y + h * .5 + 6 + i * 9, w, 3 + i * .6);
      g.fillStyle = '#1b1430'; g.fillRect(x + w / 2 - 4, y + h * .44, 8, h * .34); for (let i = 0; i < 7; i++) { g.save(); g.translate(x + w / 2, y + h * .44); g.rotate(-PI + i / 6 * PI + .0); g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(34, -22, 66, 4); g.quadraticCurveTo(34, -6, 0, 6); g.fill(); g.restore(); }
      g.fillStyle = '#fff3d0'; g.font = `800 25px ${FONT}`; g.textAlign = 'center'; g.fillText('海风', x + w / 2, y + h * .86); g.fillText('清新', x + w / 2, y + h * .92); g.font = `600 11px ${FONT}`; g.fillText('车用香片', x + w / 2, y + 60); g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 300; i++) g.fillRect(x + rnd() * w, y + rnd() * h, 2, 1); }
    // toll / parking stub + cassette label + matchbook
    { const x = 528, y = 580, w = 220, h = 110; R_('stub', x, y, w, h); g.fillStyle = '#e9c9a0'; g.fillRect(x, y, w, h); g.fillStyle = '#3a2d22'; g.font = `800 18px ${FONT}`; g.fillText('过江大桥 通行费', x + 12, y + 28); g.font = `600 12px monospace`; g.fillText('一类车   ¥10.00', x + 12, y + 52); g.fillText('No 0048217  3 号口', x + 12, y + 70); g.fillStyle = '#b5432e'; g.font = `800 22px ${FONT}`; g.fillText('已缴', x + 150, y + 98); }
    { const x = 760, y = 580, w = 250, h = 160; R_('tape', x, y, w, h); g.fillStyle = '#2a2a2c'; g.fillRect(x, y, w, h); g.fillStyle = '#e8e2cf'; g.fillRect(x + 14, y + 12, w - 28, 96); g.fillStyle = '#c85a2a'; g.fillRect(x + 14, y + 12, w - 28, 16); g.fillStyle = '#1e2a55'; g.font = `italic 600 22px ${SCRIPT}`; g.fillText('夜车歌单 卷二', x + 28, y + 56); g.fillStyle = '#151516'; g.fillRect(x + 56, y + 68, w - 112, 34); g.fillStyle = '#d8d2c0'; g.beginPath(); g.arc(x + 82, y + 85, 11, 0, TAU); g.arc(x + w - 82, y + 85, 11, 0, TAU); g.fill(); g.fillStyle = '#77736a'; g.font = `600 11px ${FONT}`; g.fillText('C-90  NORMAL BIAS  SIDE A', x + 50, y + 132); }
    { const x = 528, y = 700, w = 110, h = 130; R_('match', x, y, w, h); g.fillStyle = '#16304a'; g.fillRect(x, y, w, h); g.fillStyle = '#e8b04a'; g.font = `800 15px ${FONT}`; g.textAlign = 'center'; g.fillText('四方宾馆', x + w / 2, y + 50); g.fillText('住宿 棋牌', x + w / 2, y + 70); g.font = `600 9px ${FONT}`; g.fillText('空调 · 热水 · 钟点房', x + w / 2, y + 92); g.textAlign = 'left'; g.fillStyle = '#7a2a22'; g.fillRect(x, y + 112, w, 18); }
    // duffel webbing + zipper (tiling strip)
    { const x = 660, y = 760, w = 340, h = 60; R_('zip', x, y, w, h); g.fillStyle = '#1c1d1f'; g.fillRect(x, y, w, h); g.fillStyle = '#8a7a45'; for (let i = 0; i < 68; i++) g.fillRect(x + i * 5, y + 24, 3, 12); g.fillStyle = '#0c0c0d'; g.fillRect(x, y + 29, w, 2); }
    return TX.props = { tex: ctex(c), rects };
  }

  /* ---- windshield dust / bugs / wiper arcs (greyscale intensity) */
  function dustTex() {
    if (TX.dust) return TX.dust;
    const W = 1024, H = 512, c = canvas(W, H), g = c.getContext('2d'), rnd = GT.rng('windshield');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    // overall haze, heavier at the edges and bottom where the wipers do not reach
    const im = g.getImageData(0, 0, W, H), d = im.data;
    // wiper pivots (bottom, outside the glass) — tandem wipers sweeping the same direction
    const piv = [[W * .30, H * 1.10, H * .98], [W * .73, H * 1.10, H * .98]], inArc = (x, y) => { let best = 1e9; for (const p of piv) { const dx = x - p[0], dy = y - p[1], r = Math.hypot(dx, dy), a = Math.atan2(dx, -dy); best = Math.min(best, Math.max(r - p[2], H * .22 - r, (Math.abs(a + .10) - .98) * r)); } return best; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, e = inArc(x, y), out = sst(e, -6, 10), edge = Math.exp(-Math.pow(e / 3.5, 2));
      const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1, n = Math.abs(grain);
      let v = 10 + out * 46 + edge * 34 + n * 14 * (.4 + out);
      v += sst(y, H * .78, H) * 30 + sst(Math.abs(x - W / 2), W * .40, W * .5) * 22;      // unwiped margins
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(im, 0, 0);
    // faint concentric smear streaks inside the arcs
    g.lineCap = 'round';
    for (const p of piv) for (let k = 0; k < 46; k++) { const r = H * .24 + rnd() * (p[2] - H * .26), a0 = -1.0 + rnd() * 1.2, a1 = a0 + .3 + rnd() * .8; g.strokeStyle = `rgba(255,255,255,${.03 + rnd() * .06})`; g.lineWidth = 1 + rnd() * 5; g.beginPath(); g.arc(p[0], p[1], r, a0 - PI / 2, Math.min(a1, 1.0) - PI / 2); g.stroke(); }
    // dust specks
    for (let i = 0; i < 2600; i++) { const x = rnd() * W, y = rnd() * H, s = .5 + rnd() * rnd() * 2.2; g.fillStyle = `rgba(255,255,255,${.10 + rnd() * .35})`; g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill(); }
    // bug strikes: a small core with a splatter tail going up (airflow)
    for (let i = 0; i < 34; i++) { const x = rnd() * W, y = H * .1 + rnd() * H * .8, s = 1.5 + rnd() * 3.5; g.fillStyle = `rgba(255,255,255,${.35 + rnd() * .4})`; g.beginPath(); g.ellipse(x, y, s, s * (1 + rnd()), rnd() * 3, 0, TAU); g.fill();
      for (let k = 0; k < 7; k++) { g.fillStyle = `rgba(255,255,255,${.1 + rnd() * .2})`; g.beginPath(); g.arc(x + (rnd() - .5) * s * 5, y - rnd() * s * 7, .5 + rnd() * 1.4, 0, TAU); g.fill(); } }
    // dried drip runs from the top gasket and water spots
    for (let i = 0; i < 26; i++) { const x = rnd() * W, len = 20 + rnd() * 90; const gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(255,255,255,.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x, 0, 1.5 + rnd() * 2, len); }
    for (let i = 0; i < 120; i++) { const x = rnd() * W, y = rnd() * H, r = 2 + rnd() * 7; g.strokeStyle = `rgba(255,255,255,${.04 + rnd() * .09})`; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); }
    // a finger smudge and the inside haze line where someone wiped the glass with a rag
    g.filter = 'blur(6px)'; g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 26; g.beginPath(); g.moveTo(W * .55, H * .6); g.quadraticCurveTo(W * .7, H * .35, W * .88, H * .55); g.stroke(); g.filter = 'none';
    const t = ctex(c, false); t.wrapS = t.wrapT = T.ClampToEdgeWrapping; return TX.dust = t;
  }

  /* ---- perforated / grille patterns (tiling, used as map + bump on cloned GT.mat materials) */
  function perfTex(kind) {
    const key = 'perf' + kind; if (TX[key]) return TX[key];
    const S = 128, c = canvas(S, S), g = c.getContext('2d');
    if (kind === 'speaker') { g.fillStyle = '#8f9296'; g.fillRect(0, 0, S, S); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const cx = x * 16 + (y % 2 ? 8 : 0) + 4, cy = y * 16 + 8; const gr = g.createRadialGradient(cx, cy, 1, cx, cy, 6); gr.addColorStop(0, '#020202'); gr.addColorStop(.75, '#050505'); gr.addColorStop(1, '#8f9296'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 6, 0, TAU); g.fill(); g.beginPath(); g.arc(cx - S, cy, 6, 0, TAU); g.fill(); g.beginPath(); g.arc(cx + S, cy, 6, 0, TAU); g.fill(); } }
    else { g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const cx = x * 16 + (y % 2 ? 8 : 0) + 4, cy = y * 16 + 8; g.fillStyle = 'rgba(40,36,30,.85)'; g.beginPath(); g.arc(cx, cy, 2.1, 0, TAU); g.fill(); g.beginPath(); g.arc(cx - S, cy, 2.1, 0, TAU); g.fill(); } }
    const t = ctex(c); t.wrapS = t.wrapT = T.RepeatWrapping; return TX[key] = t;
  }

  /* ================================================================== hands: skin atlas */
  /* atlas regions (u0, v0, u1, v1); inside each region u runs around the limb (0 / 1 = palmar seam, 0.5 = dorsal centre), v runs toward the fingertips */
  const SK = { FIN: [0, 0, .25, 1], THB: [.25, 0, .5, 1], HND: [.5, 0, 1, .6], ARM: [.5, .6, 1, 1] };
  const FIN_V = [0, .10, .46, .73, 1], THB_V = [0, .12, .47, .73, 1];
  const KNUCKLE_U = [.387, .467, .537, .613];        // where the four MCP knuckles land around the palm ring
  function skinAtlas() {
    if (TX.skin) return TX.skin;
    const S = 1024, ca = canvas(S, S), ch = canvas(S, S), cr = canvas(S, S), a = ca.getContext('2d'), h = ch.getContext('2d'), r = cr.getContext('2d'), rnd = GT.rng('skin');
    const X = (reg, u) => (reg[0] + (reg[2] - reg[0]) * u) * S, Y = (reg, v) => (1 - (reg[1] + (reg[3] - reg[1]) * v)) * S, RW = reg => (reg[2] - reg[0]) * S, RH = reg => (reg[3] - reg[1]) * S;
    h.fillStyle = '#808080'; h.fillRect(0, 0, S, S); r.fillStyle = 'rgb(138,138,138)'; r.fillRect(0, 0, S, S);
    // base tone: dorsal tanned, palmar paler and pinker
    for (const k in SK) { const reg = SK[k], x0 = X(reg, 0), x1 = X(reg, 1), y0 = Y(reg, 1), y1 = Y(reg, 0), gr = a.createLinearGradient(x0, 0, x1, 0);
      const pal = '#d9a589', dor = k === 'ARM' ? '#bd8a66' : '#c4926f', mid = '#cf9a79';
      gr.addColorStop(0, pal); gr.addColorStop(.2, mid); gr.addColorStop(.38, dor); gr.addColorStop(.62, dor); gr.addColorStop(.8, mid); gr.addColorStop(1, pal); a.fillStyle = gr; a.fillRect(x0, y0, x1 - x0, y1 - y0); }
    // mottling
    for (let i = 0; i < 520; i++) { const x = rnd() * S, y = rnd() * S, rad = 14 + rnd() * 50, gr = a.createRadialGradient(x, y, 0, x, y, rad), red = rnd() < .55;
      gr.addColorStop(0, red ? `rgba(176,84,70,${.05 + rnd() * .06})` : `rgba(226,186,140,${.05 + rnd() * .07})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); a.fillStyle = gr; a.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      const g2 = r.createRadialGradient(x, y, 0, x, y, rad); g2.addColorStop(0, rnd() < .5 ? 'rgba(180,180,180,.2)' : 'rgba(95,95,95,.2)'); g2.addColorStop(1, 'rgba(0,0,0,0)'); r.fillStyle = g2; r.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    const soft = (ctx, px, fn) => { ctx.filter = `blur(${px}px)`; fn(); ctx.filter = 'none'; };
    const blob = (reg, u, v, ru, rv, col) => { const x = X(reg, u), y = Y(reg, v), rx = ru * RW(reg), ry = rv * RH(reg); a.save(); a.translate(x, y); a.scale(1, ry / rx); const gr = a.createRadialGradient(0, 0, 0, 0, 0, rx); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); a.fillStyle = gr; a.beginPath(); a.arc(0, 0, rx, 0, TAU); a.fill(); a.restore(); };
    /** crease: a line in region uv coords, carved into the height map and tinted in the albedo */
    const crease = (reg, pts, w, depth, tint) => { const path = ctx => { ctx.beginPath(); pts.forEach((p, i) => { const x = X(reg, p[0]), y = Y(reg, p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
      h.lineCap = 'round'; h.lineJoin = 'round'; h.strokeStyle = `rgba(0,0,0,${depth})`; h.lineWidth = w; path(h); h.stroke(); h.strokeStyle = `rgba(255,255,255,${depth * .35})`; h.lineWidth = w * 2.6; h.globalCompositeOperation = 'lighter'; h.globalAlpha = .25; path(h); h.stroke(); h.globalAlpha = 1; h.globalCompositeOperation = 'source-over';
      h.strokeStyle = `rgba(0,0,0,${depth})`; h.lineWidth = w; path(h); h.stroke();
      a.lineCap = 'round'; a.strokeStyle = `rgba(96,44,30,${tint === undefined ? depth * .45 : tint})`; a.lineWidth = w * 1.2; path(a); a.stroke();
      r.strokeStyle = `rgba(200,200,200,${depth * .5})`; r.lineWidth = w * 1.5; path(r); r.stroke(); };
    const arc = (u0, u1, v, bend, n) => { const p = []; for (let i = 0; i <= (n || 10); i++) { const t = i / (n || 10); p.push([lerp(u0, u1, t), v + bend * (1 - Math.pow(2 * t - 1, 2))]); } return p; };
    // ---- micro relief: criss-cross skin lines + pores (whole atlas)
    h.lineCap = 'round';
    for (let i = 0; i < 26000; i++) { const x = rnd() * S, y = rnd() * S, fin = x < S * .5, ang = fin ? (rnd() - .5) * .9 : (rnd() < .5 ? .6 : -.6) + (rnd() - .5) * .5, len = 3 + rnd() * 7; h.strokeStyle = rnd() < .7 ? `rgba(0,0,0,${.025 + rnd() * .04})` : `rgba(255,255,255,${.015 + rnd() * .03})`; h.lineWidth = .6 + rnd() * .5; h.beginPath(); h.moveTo(x, y); h.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); h.stroke(); }
    for (let i = 0; i < 14000; i++) { h.fillStyle = `rgba(0,0,0,${.03 + rnd() * .05})`; h.fillRect(rnd() * S, rnd() * S, 1.1, 1.1); }
    // ---- fingers (shared by all four) and thumb
    const digit = (reg, V) => {
      const j1 = V[2], j2 = V[3];
      soft(a, 10, () => { blob(reg, .5, j1, .30, .055, 'rgba(160,70,58,.42)'); blob(reg, .5, j2, .26, .04, 'rgba(160,72,60,.34)'); blob(reg, .5, V[1], .34, .06, 'rgba(150,66,54,.38)'); blob(reg, .5, .93, .5, .08, 'rgba(196,96,88,.30)'); blob(reg, 0, .9, .3, .1, 'rgba(206,110,100,.3)'); blob(reg, 1, .9, .3, .1, 'rgba(206,110,100,.3)'); });
      // dorsal knuckle wrinkles: nested arcs, opening away from the joint centre
      for (let k = -4; k <= 4; k++) { const dv = k * .011, wdt = .23 - Math.abs(k) * .018; crease(reg, arc(.5 - wdt, .5 + wdt, j1 + dv, -k * .004, 12), 2.2 - Math.abs(k) * .2, .30 - Math.abs(k) * .035); }
      for (let k = -2; k <= 2; k++) { const dv = k * .010, wdt = .2 - Math.abs(k) * .02; crease(reg, arc(.5 - wdt, .5 + wdt, j2 + dv, -k * .004, 12), 1.9, .26 - Math.abs(k) * .04); }
      for (let k = -3; k <= 3; k++) crease(reg, arc(.26, .74, V[1] + k * .012, -k * .005, 12), 2, .2 - Math.abs(k) * .03);
      for (let i = 0; i < 26; i++) { const v = .14 + rnd() * .72, u = .3 + rnd() * .25; crease(reg, arc(u, u + .08 + rnd() * .14, v, (rnd() - .5) * .01, 5), 1, .07 + rnd() * .06, .03); }
      // palmar flexion creases (both sides of the seam)
      [V[1], j1, j2].forEach((v, q) => { for (let k = 0; k < 2; k++) { const vv = v + (k - .5) * .016; crease(reg, arc(0, .2, vv, .004, 6), 2.6, .34); crease(reg, arc(.8, 1, vv, .004, 6), 2.6, .34); } });
      // nail fold shadow (the nail itself is separate geometry)
      crease(reg, [[.33, .985], [.32, .9], [.36, .855], [.5, .84], [.64, .855], [.68, .9], [.67, .985]], 3.2, .3, .14);
    };
    digit(SK.FIN, FIN_V); digit(SK.THB, THB_V);
    // ---- back of the hand + palm
    { const reg = SK.HND;
      soft(a, 12, () => { KNUCKLE_U.forEach(u => blob(reg, u, .93, .05, .07, 'rgba(158,66,54,.55)')); blob(reg, .5, .5, .2, .3, 'rgba(150,104,70,.16)'); blob(reg, 0, .45, .16, .4, 'rgba(214,120,108,.3)'); blob(reg, 1, .45, .16, .4, 'rgba(214,120,108,.3)'); });
      // tendons: soft raised ridges fanning from the wrist to each knuckle
      soft(h, 7, () => { KNUCKLE_U.forEach((u, i) => { h.strokeStyle = 'rgba(255,255,255,.5)'; h.lineWidth = 10; h.lineCap = 'round'; h.beginPath(); h.moveTo(X(reg, .47 + i * .022), Y(reg, .22)); h.quadraticCurveTo(X(reg, lerp(.5, u, .6)), Y(reg, .6), X(reg, u), Y(reg, .9)); h.stroke(); });
        // knuckle domes
        KNUCKLE_U.forEach(u => { h.fillStyle = 'rgba(255,255,255,.3)'; h.beginPath(); h.ellipse(X(reg, u), Y(reg, .945), 17, 22, 0, 0, TAU); h.fill(); }); });
      soft(a, 6, () => { KNUCKLE_U.forEach((u, i) => { a.strokeStyle = 'rgba(232,196,160,.16)'; a.lineWidth = 9; a.beginPath(); a.moveTo(X(reg, .47 + i * .022), Y(reg, .22)); a.quadraticCurveTo(X(reg, lerp(.5, u, .6)), Y(reg, .6), X(reg, u), Y(reg, .9)); a.stroke(); }); });
      // veins: bluish, slightly raised, wandering between the tendons
      const vein = (pts, w) => { soft(a, 4, () => { a.strokeStyle = 'rgba(64,92,112,.30)'; a.lineWidth = w; a.lineCap = 'round'; a.lineJoin = 'round'; a.beginPath(); pts.forEach((p, i) => i ? a.lineTo(X(reg, p[0]), Y(reg, p[1])) : a.moveTo(X(reg, p[0]), Y(reg, p[1]))); a.stroke(); });
        soft(h, 5, () => { h.strokeStyle = 'rgba(255,255,255,.26)'; h.lineWidth = w * 1.3; h.lineCap = 'round'; h.lineJoin = 'round'; h.beginPath(); pts.forEach((p, i) => i ? h.lineTo(X(reg, p[0]), Y(reg, p[1])) : h.moveTo(X(reg, p[0]), Y(reg, p[1]))); h.stroke(); }); };
      vein([[.56, .05], [.555, .25], [.57, .42], [.56, .6], [.575, .82]], 7); vein([[.57, .42], [.61, .55], [.60, .78]], 5); vein([[.44, .08], [.435, .3], [.42, .52], [.427, .8]], 6); vein([[.435, .3], [.47, .45], [.50, .7]], 4.5); vein([[.66, .1], [.65, .4], [.67, .6]], 5);
      // knuckle wrinkles (MCP) — whorls
      KNUCKLE_U.forEach(u => { for (let k = -3; k <= 3; k++) crease(reg, arc(u - .035 + Math.abs(k) * .004, u + .035 - Math.abs(k) * .004, .945 + k * .017, -k * .006, 8), 2, .24 - Math.abs(k) * .03); });
      for (let i = 0; i < 60; i++) { const u = .28 + rnd() * .44, v = .08 + rnd() * .8; crease(reg, arc(u, u + .03 + rnd() * .05, v, (rnd() - .5) * .02, 4), 1, .06 + rnd() * .05, .02); }
      // wrist creases + palm lines
      for (let k = 0; k < 3; k++) { crease(reg, arc(0, .22, .03 + k * .028, .006, 6), 2.4, .3); crease(reg, arc(.78, 1, .03 + k * .028, .006, 6), 2.4, .3); }
      crease(reg, [[.03, .30], [.1, .5], [.16, .68], [.2, .86]], 3, .36); crease(reg, [[.97, .62], [.9, .66], [.84, .74], [.8, .86]], 3, .34); crease(reg, [[.99, .78], [.93, .8], [.86, .9]], 2.6, .3); crease(reg, [[.02, .6], [.08, .7], [.1, .9]], 2.4, .26); }
    // ---- forearm: fine hair, faint veins, a little sun damage
    { const reg = SK.ARM;
      soft(a, 14, () => { blob(reg, .5, .5, .3, .5, 'rgba(140,92,58,.20)'); blob(reg, .08, .8, .14, .3, 'rgba(96,120,140,.14)'); blob(reg, .92, .8, .14, .3, 'rgba(96,120,140,.12)'); });
      for (let i = 0; i < 2600; i++) { const u = .14 + rnd() * .72, v = rnd(), x = X(reg, u), y = Y(reg, v), len = 9 + rnd() * 14, ang = PI * .5 + (u - .5) * 1.6 + (rnd() - .5) * .5; a.strokeStyle = `rgba(${70 + rnd() * 30 | 0},${46 + rnd() * 20 | 0},30,${.07 + rnd() * .12})`; a.lineWidth = .45 + rnd() * .35; a.beginPath(); a.moveTo(x, y); a.quadraticCurveTo(x + Math.cos(ang) * len * .5 + 2, y - Math.sin(ang) * len * .5, x + Math.cos(ang) * len, y - Math.sin(ang) * len); a.stroke(); }
      for (let i = 0; i < 60; i++) { const x = X(reg, rnd()), y = Y(reg, rnd()); a.fillStyle = `rgba(120,70,44,${.12 + rnd() * .2})`; a.beginPath(); a.arc(x, y, .8 + rnd() * 1.6, 0, TAU); a.fill(); }
      for (let k = 0; k < 4; k++) { crease(reg, arc(0, .2, .93 + k * .018, .004, 6), 2.2, .24); crease(reg, arc(.8, 1, .93 + k * .018, .004, 6), 2.2, .24); } }
    const map = ctex(ca), normal = normalFromCanvas(ch, 2.0), rough = ctex(cr, false);
    return TX.skin = { map, normal, rough };
  }

  /* ================================================================== hands: procedural geometry built from a grip pose */
  const FINGERS = [   // right-hand local frame: +Z towards the fingertips, +Y = back of the hand, +X = thumb side. Lengths in metres.
    { x: .0275, l: [.046, .027, .0235], r: [.0100, .0090, .0080, .0071], sp: .07 },     // index
    { x: .0085, l: [.050, .031, .0245], r: [.0102, .0092, .0082, .0073], sp: .015 },    // middle
    { x: -.0105, l: [.046, .029, .0240], r: [.0097, .0087, .0078, .0070], sp: -.04 },   // ring
    { x: -.0280, l: [.036, .021, .0215], r: [.0088, .0079, .0071, .0064], sp: -.10 }    // pinky
  ];
  FINGERS.forEach(f => { f.z = .097 - .013 * Math.pow((f.x - .006) / .043, 2); f.y = -.0012; f.L = f.l[0] + f.l[1] + f.l[2]; });
  const THUMB = { o: [.021, -.0065, .019], l: [.042, .034, .029], r: [.0152, .0116, .0104, .0092] }; THUMB.L = THUMB.l[0] + THUMB.l[1] + THUMB.l[2];
  const PALM_Z = .104, FORE_T = [.165, .13, .1, .075, .055, .038, .024, .013, .005, 0];
  const NS = 14, NSP = 44, FIN_S0 = .015, FIN_NU = 24, FIN_NT = 6, FIN_NR = FIN_NU + FIN_NT, PALM_NR = 15;
  const sstep01 = t => { t = cl(t, 0, 1); return t * t * (3 - 2 * t); };
  const plin = (x, xs, ys) => { if (x <= xs[0]) return ys[0]; for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return lerp(ys[i - 1], ys[i], (x - xs[i - 1]) / (xs[i] - xs[i - 1])); return ys[ys.length - 1]; };

  /** wrap-a-cylinder IK in the finger's flexion plane. (cy, cz) = cylinder centre relative to the MCP joint, rho = cylinder radius + finger radius */
  function wrapIK(f, cy, cz, rho) {
    const d = Math.hypot(cy, cz); if (d <= rho * 1.02) return [1.0, 1.5, .8];
    const gam = Math.atan2(-cy, cz), a1 = gam - Math.asin(rho / d), t1 = Math.sqrt(d * d - rho * rho);
    const rem1 = Math.max(f.l[0] - t1, 0), a2 = 2 * Math.atan2(rem1, rho), rem2 = Math.max(f.l[1] - rem1, 0), a3 = Math.min(2 * Math.atan2(rem2, rho), 1.25);
    return [cl(a1, -.2, 1.6), cl(a2, 0, 1.95), cl(a3, 0, 1.25)];
  }

  function makeHand(mir, skinMat, nailMat) {
    const nFinV = FIN_NR * (NS + 1), nPalmR = FORE_T.length + PALM_NR, nPalmV = nPalmR * (NSP + 1), nV = nFinV * 5 + nPalmV;
    const pos = new Float32Array(nV * 3), uv = new Float32Array(nV * 2), idx = [];
    const tube = (base, nr, ns) => { for (let i = 0; i < nr - 1; i++) for (let j = 0; j < ns; j++) { const a = base + i * (ns + 1) + j, b = a + 1, c = a + ns + 1, d = c + 1; if (mir > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); } };
    for (let f = 0; f < 5; f++) tube(f * nFinV, FIN_NR, NS); tube(5 * nFinV, nPalmR, NSP);
    // static UVs
    const finS = (L, rt) => { const s = []; for (let i = 0; i < FIN_NU; i++) s.push(lerp(-FIN_S0, L - rt, i / (FIN_NU - 1))); for (let k = 1; k <= FIN_NT; k++) s.push(L - rt + rt * Math.sin(k / FIN_NT * PI / 2)); return s; };
    const sLists = [];
    for (let f = 0; f < 5; f++) { const def = f < 4 ? FINGERS[f] : THUMB, rt = def.r[3] * 1.2, sl = finS(def.L, rt), reg = f < 4 ? SK.FIN : SK.THB, VV = f < 4 ? FIN_V : THB_V; sLists.push(sl);
      const kn = [-FIN_S0, 0, def.l[0], def.l[0] + def.l[1], def.L];
      for (let i = 0; i < FIN_NR; i++) { const v = plin(sl[i], kn, VV); for (let j = 0; j <= NS; j++) { const q = (f * nFinV + i * (NS + 1) + j) * 2; uv[q] = reg[0] + (reg[2] - reg[0]) * (j / NS); uv[q + 1] = reg[1] + (reg[3] - reg[1]) * v; } } }
    const palmZ = []; for (let i = 0; i < PALM_NR; i++) { const t = i / (PALM_NR - 1); palmZ.push(i < PALM_NR - 5 ? lerp(0, PALM_Z - .013, i / (PALM_NR - 6)) : PALM_Z - .013 + .013 * Math.sin((i - (PALM_NR - 6)) / 5 * PI / 2)); }
    for (let i = 0; i < nPalmR; i++) { const fore = i < FORE_T.length, reg = fore ? SK.ARM : SK.HND, v = fore ? 1 - FORE_T[i] / FORE_T[0] : palmZ[i - FORE_T.length] / PALM_Z;
      for (let j = 0; j <= NSP; j++) { const q = (5 * nFinV + i * (NSP + 1) + j) * 2; uv[q] = reg[0] + (reg[2] - reg[0]) * (j / NSP); uv[q + 1] = reg[1] + (reg[3] - reg[1]) * v; } }
    const col = new Float32Array(nV * 3);
    for (let f = 0; f < 5; f++) for (let i = 0; i < FIN_NR; i++) for (let j = 0; j <= NS; j++) { const a = PI + (j % NS) / NS * TAU, ca = Math.cos(a), sa = Math.sin(a), root = 1 - sst(sLists[f][i], -FIN_S0, .012) * .0;
        const ao = 1 - (f < 4 ? .34 * sa * sa : .12 * sa * sa) - .42 * Math.max(0, -ca) - .0 * root, q = (f * nFinV + i * (NS + 1) + j) * 3; col[q] = ao; col[q + 1] = ao * (.97 + .03 * ao); col[q + 2] = ao * (.95 + .05 * ao); }
    for (let i = 0; i < nPalmR; i++) for (let j = 0; j <= NSP; j++) { const a = (j % NSP) / NSP * TAU, ca = -Math.cos(a), fore = i < FORE_T.length, ao = 1 - (fore ? .22 : .45) * Math.max(0, -ca), q = (5 * nFinV + i * (NSP + 1) + j) * 3; col[q] = ao; col[q + 1] = ao * (.97 + .03 * ao); col[q + 2] = ao * (.95 + .05 * ao); }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setAttribute('color', new T.BufferAttribute(col, 3)); geo.setAttribute('normal', new T.BufferAttribute(new Float32Array(nV * 3), 3)); geo.setIndex(idx);
    const mesh = new T.Mesh(geo, skinMat); mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    // nails: 5 patches of NAIL_C x NAIL_R
    const NAIL_J = [5, 6, 7, 8, 9], NAIL_I = [FIN_NU - 4, FIN_NU - 3, FIN_NU - 2, FIN_NU - 1, FIN_NU, FIN_NU + 1, FIN_NU + 2], nc = NAIL_J.length, nrw = NAIL_I.length + 1, nNV = 5 * nc * nrw;
    const npos = new Float32Array(nNV * 3), ncol = new Float32Array(nNV * 3), nidx = [];
    for (let f = 0; f < 5; f++) for (let i = 0; i < nrw; i++) for (let j = 0; j < nc; j++) { const q = (f * nc * nrw + i * nc + j) * 3, t = i / (nrw - 1), e = Math.abs(j - 2) / 2;
        const tip = sst(t, .72, .9), lun = (1 - sst(t, .0, .3)) * (1 - e * .6); ncol[q] = lerp(lerp(.50, .62, lun), .74, tip); ncol[q + 1] = lerp(lerp(.25, .41, lun), .63, tip); ncol[q + 2] = lerp(lerp(.19, .35, lun), .52, tip);
        if (i < nrw - 1 && j < nc - 1) { const a = f * nc * nrw + i * nc + j, b = a + 1, c = a + nc, d = c + 1; if (mir > 0) nidx.push(a, c, b, b, c, d); else nidx.push(a, b, c, b, d, c); } }
    const ngeo = new T.BufferGeometry(); ngeo.setAttribute('position', new T.BufferAttribute(npos, 3)); ngeo.setAttribute('color', new T.BufferAttribute(ncol, 3)); ngeo.setAttribute('normal', new T.BufferAttribute(new Float32Array(nNV * 3), 3)); ngeo.setIndex(nidx);
    const nails = new T.Mesh(ngeo, nailMat); nails.frustumCulled = false; nails.receiveShadow = true;

    const H = { mesh, nails, mir, matrix: new T.Matrix4(), elbow: V3(), frames: { watch: new T.Matrix4(), ring: new T.Matrix4() },
      pose: { fin: [[.3, .4, .25], [.3, .4, .25], [.3, .4, .25], [.3, .4, .25]], spread: 0, th: [[.7, -.3, .65], [.72, -.15, .68], [.72, -.1, .69]], thN: [.6, .6, -.5] } };
    const ctr = new Float32Array(FIN_NR * 3), M = new T.Matrix4(), e = M.elements;
    // write a point given in right-hand local coords
    let wq = 0;
    const put = (q, x, y, z) => { x *= mir; pos[q] = e[0] * x + e[4] * y + e[8] * z + e[12]; pos[q + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[q + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; };
    const tmpV = V3();

    /** one digit. base = [ox,oy,oz], dirAt(s) -> fills d[], nrm reference n0[] ; returns nothing, writes rings + nail */
    function digit(f, def, o, frameAt) {
      const sl = sLists[f], L = def.L, rt = def.r[3] * 1.2, base = f * nFinV, l1 = def.l[0], l12 = l1 + def.l[1];
      let px = o[0], py = o[1], pz = o[2], sPrev = sl[0]; const fr = { d: [0, 0, 1], n: [0, 1, 0], b: [1, 0, 0] };
      // start: step backwards from the joint to s = -S0 along the initial direction
      frameAt(0, fr); px -= fr.d[0] * FIN_S0; py -= fr.d[1] * FIN_S0; pz -= fr.d[2] * FIN_S0;
      for (let i = 0; i < FIN_NR; i++) { const s = sl[i];
        if (i > 0) { const steps = 3, ds = (s - sPrev) / steps; for (let k = 0; k < steps; k++) { frameAt(sPrev + ds * (k + .5), fr); px += fr.d[0] * ds; py += fr.d[1] * ds; pz += fr.d[2] * ds; } sPrev = s; }
        frameAt(s, fr);
        let r = plin(s, [-FIN_S0, 0, l1, l12, L], [def.r[0] * (f < 4 ? 1.02 : 1.0), def.r[0], def.r[1], def.r[2], def.r[3]]);
        const side = 1 + .085 * bump(s, l1, .0055) + .06 * bump(s, l12, .005);
        const dors = (f < 4 ? 1 + .24 * bump(s, .001, .010) : 1 + .1 * bump(s, l1, .009)) + .10 * bump(s, l1, .006) + .07 * bump(s, l12, .0055) - .13 * sst(s, L - .017, L - .004);
        const palm = 1 + .10 * bump(s, l1 * .5, l1 * .26) + .09 * bump(s, l1 + def.l[1] * .5, def.l[1] * .28) + .15 * bump(s, L - .0115, .008) - .10 * (bump(s, l1, .004) + bump(s, l12, .004));
        let cap = 1; if (s > L - rt) { const t = (s - (L - rt)) / rt; cap = Math.sqrt(Math.max(0, 1 - t * t)); cap = Math.max(cap, .04); }
        const thick = f === 4 ? 1 + .42 * (1 - sst(s, -FIN_S0, l1 * .9)) : 1;     // thenar swell at the thumb base
        ctr[i * 3] = px; ctr[i * 3 + 1] = py; ctr[i * 3 + 2] = pz;
        for (let j = 0; j <= NS; j++) { const a = PI + (j % NS) / NS * TAU, ca = Math.cos(a), sa = Math.sin(a), rn = r * cap * (ca > 0 ? dors * .93 : palm * thick) * ca, rb = r * cap * side * sa * (f === 4 ? 1.08 : 1);
          put((base + i * (NS + 1) + j) * 3, px + fr.n[0] * rn + fr.b[0] * rb, py + fr.n[1] * rn + fr.b[1] * rb, pz + fr.n[2] * rn + fr.b[2] * rb); }
        if (f === 2 && mir > 0 && i === 9) H._ringF = { p: [px, py, pz], d: fr.d.slice(), n: fr.n.slice(), b: fr.b.slice(), r: r };
      }
      // nail: offset the dorsal skin points outward, extend the free edge
      for (let ii = 0; ii < nrw; ii++) { const i = NAIL_I[Math.min(ii, NAIL_I.length - 1)], ext = ii === nrw - 1 ? 1 : 0;
        for (let jj = 0; jj < nc; jj++) { const j = NAIL_J[jj], sq = (base + i * (NS + 1) + j) * 3, q = (f * nc * nrw + ii * nc + jj) * 3;
          // direction outwards from the ring centre (already in cabin space)
          tmpV.set(ctr[i * 3], ctr[i * 3 + 1], ctr[i * 3 + 2]); const cx = tmpV.x * mir, cx2 = e[0] * cx + e[4] * tmpV.y + e[8] * tmpV.z + e[12], cy2 = e[1] * cx + e[5] * tmpV.y + e[9] * tmpV.z + e[13], cz2 = e[2] * cx + e[6] * tmpV.y + e[10] * tmpV.z + e[14];
          let ox = pos[sq] - cx2, oy = pos[sq + 1] - cy2, oz = pos[sq + 2] - cz2; const ol = Math.hypot(ox, oy, oz) || 1, lift = (ii === 0 ? -.0002 : .00055) + ext * .0002, edge = Math.abs(jj - 2) === 2 ? -.00035 : 0;
          npos[q] = pos[sq] + ox / ol * (lift + edge); npos[q + 1] = pos[sq + 1] + oy / ol * (lift + edge); npos[q + 2] = pos[sq + 2] + oz / ol * (lift + edge);
          if (ext) { const i0 = NAIL_I[NAIL_I.length - 2], q0 = (base + i0 * (NS + 1) + j) * 3; npos[q] += (pos[sq] - pos[q0]) * .9; npos[q + 1] += (pos[sq + 1] - pos[q0 + 1]) * .9; npos[q + 2] += (pos[sq + 2] - pos[q0 + 2]) * .9; npos[q] += ox / ol * .0006; npos[q + 1] += oy / ol * .0006; npos[q + 2] += oz / ol * .0006; } } }
    }
    const nrmz = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; };
    const fixSeams = (g, base, nr, ns) => { const n = g.attributes.normal.array; for (let i = 0; i < nr; i++) { const a = (base + i * (ns + 1)) * 3, b = a + ns * 3; for (let k = 0; k < 3; k++) { const v = n[a + k] + n[b + k]; n[a + k] = n[b + k] = v; } const l = Math.hypot(n[a], n[a + 1], n[a + 2]) || 1; for (let k = 0; k < 3; k++) { n[a + k] /= l; n[b + k] /= l; } } };

    /** rebuild from H.pose, H.matrix (hand local -> cabin) and H.elbow (cabin) */
    H.rebuild = function () {
      M.copy(H.matrix); const P = H.pose;
      // fingers
      for (let f = 0; f < 4; f++) { const def = FINGERS[f], a = P.fin[f], sp = def.sp * (1 + P.spread * 3) + (f - 1.5) * -.035 * P.spread, cs = Math.cos(sp), sn = Math.sin(sp), l1 = def.l[0], l12 = l1 + def.l[1];
        digit(f, def, [def.x, def.y, def.z], (s, fr) => { const th = a[0] * sstep01((s + .011) / .022) + a[1] * sstep01((s - l1 + .0075) / .015) + a[2] * sstep01((s - l12 + .0065) / .013), c = Math.cos(th), si = Math.sin(th);
          fr.d[0] = sn * c; fr.d[1] = -si; fr.d[2] = cs * c; fr.n[0] = sn * si; fr.n[1] = c; fr.n[2] = cs * si; fr.b[0] = cs; fr.b[1] = 0; fr.b[2] = -sn; }); }
      // thumb: three bone directions blended along its length
      { const d0 = nrmz(P.th[0].slice()), d1 = nrmz(P.th[1].slice()), d2 = nrmz(P.th[2].slice()), n0 = P.thN, l1 = THUMB.l[0], l12 = l1 + THUMB.l[1];
        digit(4, THUMB, THUMB.o, (s, fr) => { const w1 = sstep01((s - l1 + .009) / .018), w2 = sstep01((s - l12 + .008) / .016);
          for (let k = 0; k < 3; k++) fr.d[k] = lerp(lerp(d0[k], d1[k], w1), d2[k], w2); nrmz(fr.d);
          const dn = n0[0] * fr.d[0] + n0[1] * fr.d[1] + n0[2] * fr.d[2]; for (let k = 0; k < 3; k++) fr.n[k] = n0[k] - fr.d[k] * dn; nrmz(fr.n);
          fr.b[0] = fr.n[1] * fr.d[2] - fr.n[2] * fr.d[1]; fr.b[1] = fr.n[2] * fr.d[0] - fr.n[0] * fr.d[2]; fr.b[2] = fr.n[0] * fr.d[1] - fr.n[1] * fr.d[0]; }); }
      // forearm (follows the elbow) + palm
      const inv = tmpM.copy(M).invert(), el = tmpV.copy(H.elbow).applyMatrix4(inv); el.x *= mir; const fl = el.length() || 1; const fx = el.x / fl, fy = el.y / fl, fz = el.z / fl;
      const base = 5 * nFinV, cupK = P.cup || 0;
      for (let i = 0; i < nPalmR; i++) {
        if (i < FORE_T.length) { const t = FORE_T[i], w = sstep01(t / .07) * .97 + .03 * 0; let dx = fx * w, dy = fy * w, dz = -(1 - w) + fz * w; const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
          // dorsal reference: hand +Y made perpendicular to the forearm direction
          let nx = -dx * dy, ny = 1 - dy * dy, nz = -dz * dy; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          // side = n x (-d)
          const sx = -(ny * dz - nz * dy), sy = -(nz * dx - nx * dz), sz = -(nx * dy - ny * dx);
          const cxp = dx * t, cyp = dy * t - .0012 * sst(t, .0, .03), czp = dz * t;
          const hw = plin(t, [0, .028, .08, .165], [.0288, .0272, .0315, .0390]), hh = plin(t, [0, .028, .08, .165], [.0186, .0188, .0240, .0320]);
          if (i === 6) { const m = H.frames.watch, wc = [cxp * mir, cyp, czp]; // frame for the watch (t = .024)
            setBasis(m, M, [sx * mir, sy, sz], [nx * mir, ny, nz], [-dx * mir, -dy, -dz], wc, mir); }
          const pw = lerp(.74, .86, sstep01(t / .05)); for (let j = 0; j <= NSP; j++) { const a = (j % NSP) / NSP * TAU, sa = -Math.sin(a), ca = -Math.cos(a), ex = Math.sign(sa) * Math.pow(Math.abs(sa), pw), ey = Math.sign(ca) * Math.pow(Math.abs(ca), pw);
            let rx = hw * ex, ry = hh * ey; if (ey > 0 && ex < 0) { const k = .0032 * bump(t, .017, .010) * bump(a, PI * .67, .5); rx -= k; ry += k * .8; }       // ulnar styloid
            if (ey < 0) ry *= 1 - .05 * bump(t, .0, .02);
            put((base + i * (NSP + 1) + j) * 3, cxp + sx * rx + nx * ry, cyp + sy * rx + ny * ry, czp + sz * rx + nz * ry); } }
        else { const z = palmZ[i - FORE_T.length], endT = Math.max(0, (z - (PALM_Z - .013)) / .013), capS = Math.max(.05, Math.sqrt(Math.max(0, 1 - endT * endT)));
          const hw = plin(z, [0, .03, .07, .095, PALM_Z], [.0288, .0365, .0432, .0425, .040]), hd = plin(z, [0, .05, .09], [.0186, .0152, .0125]) * capS, hp = plin(z, [0, .03, .07, .09], [.0186, .0205, .0172, .0135]) * capS;
          for (let j = 0; j <= NSP; j++) { const a = (j % NSP) / NSP * TAU, sa = -Math.sin(a), ca = -Math.cos(a), ex = Math.sign(sa) * Math.pow(Math.abs(sa), .74), ey = Math.sign(ca) * Math.pow(Math.abs(ca), .74);
            let x = hw * ex, y = ey > 0 ? hd * ey : hp * ey;
            const z0k = sst(z, 0, .014);
            if (ey < 0) { y -= .0115 * bump(z, .034, .027) * sst(x, -.006, .03) * -ey * z0k; y -= .0045 * bump(z, .036, .03) * sst(-x, .004, .03) * -ey * z0k; y += cupK * .004 * bump(x, 0, .02) * bump(z, .06, .03); }
            else { y += .0012 * bump(z, .012, .012) * bump(x, -.018, .012) * z0k; y -= .0011 * sst(z, .04, .085) * ey;
              for (let f = 0; f < 4; f++) { const F = FINGERS[f], xf = lerp(F.x * .32, F.x, sst(z, 0, .097)); y += (.0021 * bump(x, xf, .0052) * sst(z, .03, .075) + .0032 * bump(x, F.x, .0075) * bump(z, F.z - .004, .011)) * ey; } }
            if (ex > 0) x += .0065 * bump(z, .03, .024) * (ey < .3 ? 1 : 1 - sst(ey, .3, .9)) * z0k;
            const zz = z - .013 * Math.pow((x - .006) / .043, 2) * sst(z, .03, .1) - cupK * 0;
            put((base + i * (NSP + 1) + j) * 3, x, y - .0006, zz); } }
      }
      // ring frame (right hand, ring finger)
      if (H._ringF) { const q = H._ringF; setBasis(H.frames.ring, M, [q.b[0] * mir, q.b[1], q.b[2]], [q.n[0] * mir, q.n[1], q.n[2]], [q.d[0] * mir, q.d[1], q.d[2]], [q.p[0] * mir, q.p[1], q.p[2]], mir); H.frames.ringR = q.r; }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
      { const n = geo.attributes.normal.array, r0 = base + (FORE_T.length - 1) * (NSP + 1), r1 = r0 + NSP + 1; for (let j = 0; j <= NSP; j++) { const a = (r0 + j) * 3, b = (r1 + j) * 3; for (let k = 0; k < 3; k++) { const v = n[a + k] + n[b + k]; n[a + k] = n[b + k] = v; } const l = Math.hypot(n[a], n[a + 1], n[a + 2]) || 1; for (let k = 0; k < 3; k++) { n[a + k] /= l; n[b + k] /= l; } } }
      for (let f = 0; f < 5; f++) fixSeams(geo, f * nFinV, FIN_NR, NS); fixSeams(geo, base, nPalmR, NSP); geo.attributes.normal.needsUpdate = true;
      ngeo.attributes.position.needsUpdate = true; ngeo.computeVertexNormals();
    };
    return H;
  }
  const tmpM = new T.Matrix4();
  /** out = M * [x y z o] with basis vectors given in hand-local coords (already mirrored) */
  function setBasis(out, M, x, y, z, o, mir) {
    const bx = V3(x[0], x[1], x[2]).transformDirection(M), by = V3(y[0], y[1], y[2]).transformDirection(M), bz = V3(z[0], z[1], z[2]).transformDirection(M), p = V3(o[0], o[1], o[2]).applyMatrix4(M);
    if (mir < 0) bx.negate();   // keep it right-handed
    out.makeBasis(bx, by, bz); out.setPosition(p); return out;
  }

  /* ================================================================== cabin shell */
  /** point on the windshield (inner face). u: 0 = passenger side (-X) .. 1 = driver side (+X), v: 0 base .. 1 header. off = metres further into the cabin */
  function wsPoint(u, v, off) {
    const t = u * 2 - 1, q = 1 - t * t, half = lerp(WS.bx, WS.tx, v), x = t * half, belly = .014 * Math.sin(v * PI);
    const zb = WS.bz + WS.bow * q, yb = WS.by + WS.byC * q, zt = WS.tz + WS.bow * .55 * q, yt = WS.ty + WS.tyC * (1 - Math.pow(Math.abs(t), 2.2));
    const z = lerp(zb, zt, v) + belly * .5, y = lerp(yb, yt, v) + belly * .85, o = off || 0;
    return [x, y - o * .83, z - o * .56];
  }
  function wsGrid(nu, nv, off, u0, u1, v0, v1) { const rings = []; for (let j = 0; j <= nv; j++) { const r = []; for (let i = 0; i <= nu; i++) r.push(wsPoint(lerp(u0 || 0, u1 === undefined ? 1 : u1, i / nu), lerp(v0 || 0, v1 === undefined ? 1 : v1, j / nv), off)); rings.push(r); } return rings; }
  /** inner side-glass plane: x as a function of height (tumblehome) */
  const sideX = y => lerp(.790, .640, cl((y - BELT) / (CANT - BELT), 0, 1.1));
  /** door-glass front edge (A pillar line), B line and C line: z as a function of height */
  const hOf = y => cl((y - BELT) / (CANT - BELT), 0, 1), aLine = y => lerp(.585, .06, hOf(y)), bLine = y => lerp(-.515, -.415, hOf(y)), cLine = y => lerp(-1.215, -.585, hOf(y));
  const roofC = z => plin(z, [-.72, -.58, -.42, -.16, .12], [1.198, 1.249, 1.274, 1.269, 1.234]);
  const roofY = (x, z) => roofC(z) - .016 * Math.pow(Math.min(Math.abs(x), .62) / .565, 2.2) + .003 * Math.abs(Math.sin((z + .1) * PI / .21));

  function buildShell(k, m, kr) { kr = kr || k;   /* CAR r1: kr takes everything that belongs to a fixed roof (headliner, cant rails, dome light, C pillars, rear header, backlight gasket); an open car hides it */
    // ---- floor, toe board, tunnel
    k.box(m.carpet, 1.54, .04, 2.66, 0, FLOOR - .02, -.55, { bevel: .004 });
    k.box(m.carpet, 1.54, .03, .34, 0, .405, .665, { rx: -.92, bevel: .004 });
    k.box(m.carpet, 1.54, .5, .03, 0, .60, .775);                                          // firewall
    { const rings = []; for (let i = 0; i <= 14; i++) { const z = lerp(.76, -1.0, i / 14), hw = lerp(.15, .11, sst(z, .5, -1)), hh = lerp(.15, .075, sst(z, .55, -.9)), r = []; for (let j = 0; j <= 12; j++) { const a = j / 12 * PI; r.push([Math.cos(a) * hw * (1 + .25 * Math.pow(Math.abs(Math.cos(a)), 4)), FLOOR - .004 + Math.pow(Math.sin(a), .7) * hh, z]); } rings.push(r); }
      k.geo(m.carpet, loft(rings, { closed: false, face: [0, 1, 0] })); }
    // rubber floor mats with ribs + heel pad, sill plates
    for (const sx of [1, -1]) { const g = softBox(.44, .014, .56, .006, 5, 5, 60, (x, z) => (Math.abs(x) < .18 && Math.abs(z) < .24 ? .0022 * sst(Math.sin(z * TAU / .021), -.2, .5) : 0), 2);
      k.geo(m.rubber, g, { x: sx * .40, y: FLOOR + .007, z: .28 });
      k.box(m.alu, .075, .012, 1.10, sx * .712, FLOOR + .012, .03, { bevel: .003 });
      for (let i = 0; i < 9; i++) k.box(m.alu, .0045, .004, 1.06, sx * (.686 + i * .0065), FLOOR + .019, .03);
      k.box(m.vinyl, .03, .52, .20, sx * (HALF + .002), .57, .68, { bevel: .01 });                // kick panel
      k.cyl(m.plastic, .034, .034, .012, sx * (HALF - .014), .50, .67, { rz: PI / 2, seg: 20 });   // fresh-air vent knob plate
      k.cyl(m.chrome, .006, .006, .03, sx * (HALF - .03), .50, .67, { rz: PI / 2, seg: 10 }); }
    k.box(m.rubber, .12, .012, .16, DX + .03, FLOOR + .016, .40, { bevel: .004 });               // heel pad
    // ---- headliner (bowed between listing rods), header, cant rails
    { const rings = []; for (let i = 0; i <= 40; i++) { const z = lerp(.135, -.725, i / 40), r = []; for (let j = 0; j <= 16; j++) { const x = lerp(-.615, .615, j / 16); r.push([x, roofY(x, z), z]); } rings.push(r); }
      kr.geo(m.headliner, loft(rings, { closed: false, face: [0, -1, 0] })); }
    { const rings = []; for (let i = 0; i <= 20; i++) { const x = lerp(-.60, .60, i / 20), q = 1 - Math.pow(x / .6, 2), c = [x, roofY(x, .12) - .012 - .004 * q, .118 + .035 * q * .55]; rings.push(ringPts(c, [0, .012, .03], [0, -.018, .008], 12, .8)); }
      kr.geo(m.trim, loft(rings, { cap0: true, cap1: true })); }                                   // windshield header pad
    for (const sx of [1, -1]) {
      const rings = []; for (let i = 0; i <= 12; i++) { const z = lerp(.10, -.66, i / 12); rings.push(ringPts([sx * .628, roofY(.62, z) - .026, z], [sx * .02, .018, 0], [-sx * .016, .02, 0], 12, .85)); }
      kr.geo(m.trim, loft(rings, { cap0: true, cap1: true }));                                   // cant rail
      kr.tube(m.chrome, polyline(t => { const z = lerp(.07, -.60, t); return [sx * .647, roofY(.62, z) - .052, z]; }, 10), .004, { seg: 6 });
      kr.cyl(m.chrome, .006, .006, .016, sx * .585, roofY(.585, -.55) - .008, -.55, { seg: 10 }); kr.sphere(m.chrome, .008, sx * .585, roofY(.585, -.55) - .018, -.55);            // coat hook
    }
    // dome light
    kr.push(0, roofY(0, -.36) - .003, -.36);
    kr.geo(m.chrome, plate(rrect(.12, .07, .02), [{ pts: rrect(.096, .046, .012) }], .006, .002), { rx: PI / 2, y: 0 });
    kr.geo(m.lens, softBox(.098, .014, .048, .006, 7, 7, 7), { y: -.008 }); kr.box(m.chrome, .012, .006, .008, .066, -.006, 0, { bevel: .002 });
    kr.pop();
    // ---- A pillars + windshield gasket + chrome reveal
    for (const sx of [1, -1]) {
      const rings = []; for (let i = 0; i <= 8; i++) { const t = i / 8, c = wsPoint(sx > 0 ? 1 : 0, t, .01); const cx = c[0] + sx * .03, cy = c[1] - .006, cz = c[2] - .024 - .01 * Math.sin(t * PI);
        rings.push(ringPts([cx - sx * .008, cy, cz], [sx * .013, 0, .006], [0, .013, -.019], 14, .8)); }   /* slim pillar trim: half the section it had */
      kr.geo(m.trim, loft(rings, { cap0: true, cap1: true }));
      kr.tube(m.chrome, polyline(t => wsPoint(sx > 0 ? .992 : .008, lerp(.01, .99, t), .016), 10), .004, { seg: 6 });
      // pillar base cap where it meets the dash and door
      k.geo(m.vinyl, softBox(.085, .05, .13, .018, 7, 7, 7), { x: sx * .745, y: BELT - .005, z: .60 });
    }
    { const per = [], o = .014; for (let i = 0; i <= 12; i++) per.push(wsPoint(i / 12, .004, o)); for (let i = 1; i <= 6; i++) per.push(wsPoint(1 - .004, i / 6, o)); for (let i = 1; i <= 12; i++) per.push(wsPoint(1 - i / 12, .996, o)); for (let i = 1; i < 6; i++) per.push(wsPoint(.004, 1 - i / 6, o));
      kr.tube(m.rubber, per, .0085, { closed: true, seg: 8, steps: 120 });
      kr.tube(m.chrome, polyline(t => wsPoint(lerp(.02, .98, t), .982, .02), 12), .0035, { seg: 6 }); }   /* CAR r1: header pad, A pillars and this gasket are the closed car's windscreen frame; an open car shows its own (js/cnvehicles.js openTop) */
    // ---- rear: sail panels (C pillars), rear header, parcel shelf, bulkhead
    for (const sx of [1, -1]) {
      const P1 = [.640, CANT - .006, -.585], P2 = [.552, 1.172, -.725], P3 = [.716, .885, -1.84], P4 = [.778, BELT + .012, -1.225], rings = [];
      for (let i = 0; i <= 6; i++) { const t = i / 6, a = [lerp(P1[0], P4[0], t), lerp(P1[1], P4[1], t), lerp(P1[2], P4[2], t)], b = [lerp(P2[0], P3[0], t), lerp(P2[1], P3[1], t), lerp(P2[2], P3[2], t)], r = []; for (let j = 0; j <= 5; j++) { const s = j / 5, bulge = .012 * Math.sin(s * PI) * Math.sin(t * PI); r.push([sx * (lerp(a[0], b[0], s) - .012 - bulge), lerp(a[1], b[1], s), lerp(a[2], b[2], s)]); } rings.push(r); }
      kr.geo(m.headliner, loft(rings, { closed: false, face: [-sx, 0, 0] }));
      kr.tube(m.chrome, [P1, P4].map(p => [sx * (p[0] - .014), p[1], p[2]]), .004, { seg: 6 }); kr.tube(m.rubber, [P2, P3].map(p => [sx * (p[0] - .014), p[1], p[2]]), .006, { seg: 6 });
    }
    { const rings = []; for (let i = 0; i <= 16; i++) { const x = lerp(-.56, .56, i / 16); rings.push(ringPts([x, roofY(x, -.72) - .012, -.722], [0, .012, -.03], [0, -.02, -.008], 12, .8)); } kr.geo(m.headliner, loft(rings, { cap0: true, cap1: true })); }
    k.box(m.vinyl, 1.44, .028, .56, 0, .862, -1.60, { bevel: .01 });                               // parcel shelf
    for (const sx of [1, -1]) { k.geo(m.speaker, disc(.07, 28), { x: sx * .42, y: .8775, z: -1.56, rx: -PI / 2 }); k.geo(m.chrome, torus(.072, .004, 28, 6), { x: sx * .42, y: .8775, z: -1.56, rx: PI / 2 }); }
    k.box(m.vinyl, 1.46, .56, .04, 0, .58, -1.40, { bevel: .01 });                                  // bulkhead behind the rear seat
    { const p = [[-.552, 1.172, -.725], [.552, 1.172, -.725], [.716, .885, -1.84], [-.716, .885, -1.84]].map(q => [q[0] * .975, q[1] - .008, q[2] + .012]); kr.tube(m.rubber, p, .008, { closed: true, tension: .06, steps: 60, seg: 6 }); }
  }

  /* ---- doors + rear quarter trim (sx = +1 driver side, -1 passenger side) */
  function buildDoor(k, m, sx, kr) { kr = kr || k;
    const X = HALF, fwd = .60, aft = -.535, len = fwd - aft, zc = (fwd + aft) / 2, face = sx > 0 ? PI / 2 : -PI / 2, IN = .700, SILL = BELT - .023;
    k.box(m.tan, .024, .40, len, sx * (X + .012), .642, zc, { bevel: .006 });                         // main card
    k.box(m.carpet, .026, .17, len, sx * (X + .010), .385, zc, { bevel: .006 });                      // carpeted lower band
    k.box(m.chrome, .006, .007, len - .03, sx * (X - .003), .473, zc, { bevel: .002 });
    // pleated insert (horizontal pleats)
    { const g = softBox(.19, .022, len - .16, .010, 26, 5, 8, (x, z) => { const mx = sst(.086 - Math.abs(x), 0, .012) * sst((len - .16) / 2 - .012 - Math.abs(z), 0, .012); return mx * .0045 * Math.pow(Math.abs(Math.cos(x * PI / .0317)), .55); }, 2);
      k.geo(m.tan, g, { x: sx * (X - .004), y: IN, z: zc - .01, rz: face });
      for (const dy of [-.103, .103]) k.box(m.chrome, .005, .005, len - .14, sx * (X - .004), IN + dy, zc - .01, { bevel: .002 });
       }
    // sill pad on top of the door with stitched edge, lock pin, weatherstrip
    k.geo(m.vinyl, softBox(.062, .05, len + .01, .02, 7, 7, 14), { x: sx * (X - .002), y: SILL, z: zc });
    stitches(k, m.threadDark, [[sx * (X - .026), SILL + .0225, fwd - .02], [sx * (X - .026), SILL + .0225, aft + .02]], [-sx * .5, .86, 0]);
    k.box(m.rubber, .014, .012, len, sx * (X + .022), SILL + .022, zc, { bevel: .004 });
    k.box(m.chrome, .006, .008, len, sx * (X + .011), SILL + .026, zc, { bevel: .002 });
    k.geo(m.chrome, lathe([[.0001, .03], [.0042, .028], [.0048, .02], [.0036, .008], [.0036, 0]], 10), { x: sx * (X - .004), y: SILL + .022, z: aft + .09 });
    // armrest: padded top on a chrome base
    k.geo(m.tanDark, softBox(.075, .045, .44, .018, 9, 7, 18, (x, z) => .003 * (1 - Math.pow(x / .04, 2))), { x: sx * (X - .036), y: .633, z: -.10 });
    k.box(m.chrome, .062, .012, .40, sx * (X - .032), .605, -.10, { bevel: .004 });
    k.box(m.plastic, .05, .03, .34, sx * (X - .024), .587, -.10, { bevel: .008 });
    stitches(k, m.thread, [[sx * (X - .066), .653, .10], [sx * (X - .066), .653, -.30]], [-sx * .6, .8, 0]);
    // door release: chrome paddle in a dished escutcheon
    k.push(sx * (X - .001), .738, .26, { ry: sx > 0 ? -PI / 2 : PI / 2 });
    k.geo(m.chrome, plate(rrect(.105, .046, .02), [{ pts: rrect(.078, .026, .011) }], .004, .0015), {});
    k.box(m.plastic, .08, .028, .004, 0, 0, .001);
    k.geo(m.chrome, softBox(.064, .012, .016, .005, 9, 7, 7), { x: -.004, y: .001, z: .012, rz: 0 });
    k.cyl(m.chrome, .005, .005, .018, .03, 0, .008, { rx: PI / 2, seg: 10 });
    k.pop();
    // window crank
    k.push(sx * (X - .002), .54, .32, { ry: sx > 0 ? -PI / 2 : PI / 2 });
    k.geo(m.chrome, lathe([[.021, 0], [.021, .003], [.016, .008], [.011, .012], [.011, .02], [.0001, .021]], 20), { rx: PI / 2 });
    k.push(0, 0, .018, { rz: sx > 0 ? -2.2 : -.9 });
    k.geo(m.chrome, plate([[-.011, -.011], [.011, -.011], [.007, .088], [-.007, .088]], [], .004, .0015), { z: 0 });
    k.geo(m.chrome, lathe([[.007, 0], [.007, .004], [.004, .006], [.004, .012]], 12), { rx: PI / 2, y: .08, z: .004 });
    k.geo(m.plastic, lathe([[.006, 0], [.0105, .004], [.0115, .016], [.009, .028], [.0001, .031]], 14), { rx: PI / 2, y: .08, z: .014 });
    k.pop(); k.pop();
    // speaker
    k.push(sx * (X - .004), .405, .40, { ry: sx > 0 ? -PI / 2 : PI / 2 });
    k.geo(m.speaker, disc(.066, 28), { z: .003 }); k.geo(m.chrome, torus(.068, .0045, 32, 6), { z: .003 }); k.geo(m.chrome, lathe([[.0001, .006], [.012, .004], [.014, 0]], 12), { rx: PI / 2, z: .002 });
    k.pop();
    // door pull strap
    k.tube(m.tanDark, [[sx * (X - .002), .765, -.02], [sx * (X - .03), .771, -.06], [sx * (X - .036), .771, -.14], [sx * (X - .03), .771, -.22], [sx * (X - .002), .765, -.26]], .008, { seg: 6 });
    for (const zz of [-.02, -.26]) k.geo(m.chrome, lathe([[.013, 0], [.013, .002], [.008, .006], [.0001, .007]], 12), { x: sx * (X - .001), y: .765, z: zz, rz: sx > 0 ? PI / 2 : -PI / 2 });
    k.box(m.rubber, .03, .54, .014, sx * (X + .012), .60, aft - .006, { bevel: .004 });               // door shut line at the latch pillar
    // ---- rear quarter trim panel
    const qz0 = aft - .012, qz1 = -1.38, ql = qz0 - qz1, qc = (qz0 + qz1) / 2;
    k.box(m.tan, .024, .40, ql, sx * (X + .012), .642, qc, { bevel: .006 });
    k.box(m.carpet, .026, .17, ql, sx * (X + .010), .385, qc, { bevel: .006 });
    k.geo(m.vinyl, softBox(.062, .05, ql + .5, .02, 7, 7, 12), { x: sx * (X - .002), y: SILL, z: qc - .25 });
    k.geo(m.tanDark, softBox(.07, .04, .30, .016, 9, 7, 12), { x: sx * (X - .034), y: .625, z: -.98 });
    k.geo(m.chrome, plate(rrect(.07, .035, .008), [], .006, .002), { x: sx * (X - .001), y: .735, z: -.80, ry: sx > 0 ? -PI / 2 : PI / 2 });     // rear ashtray
    { const g = softBox(.19, .02, ql - .12, .010, 26, 5, 8, (x, z) => sst(.086 - Math.abs(x), 0, .012) * sst((ql - .12) / 2 - .012 - Math.abs(z), 0, .012) * .0045 * Math.pow(Math.abs(Math.cos(x * PI / .0317)), .55), 2); k.geo(m.tan, g, { x: sx * (X - .003), y: IN, z: qc, rz: face }); }
    // B line: the two frameless glass edges meet (pillarless hardtop)
    kr.tube(m.chrome, [[sx * (sideX(BELT) - .004), BELT + .004, bLine(BELT)], [sx * (sideX(CANT) - .004), CANT - .004, bLine(CANT)]], .0045, { seg: 6 });
    kr.tube(m.rubber, [[sx * (sideX(BELT) - .004), BELT + .004, bLine(BELT) - .009], [sx * (sideX(CANT) - .004), CANT - .004, bLine(CANT) - .009]], .004, { seg: 6 });
  }

  /* ---- seats */
  const pleatFn = (hw, hd, pitch, amp, alongX) => (x, z) => { const mx = sst(hw - Math.abs(x), 0, .014) * sst(hd - Math.abs(z), 0, .014), q = alongX ? x : z; return mx * amp * Math.pow(Math.abs(Math.cos(q * PI / pitch)), .5) - .004 * mx + .006 * (1 - Math.pow(cl(Math.abs(x) / (hw + .08), 0, 1), 2)); };
  function buildBucket(k, m, cx, leather) {
    k.push(0, SY, 0);
    // base + rails + chrome side trim + recline lever
    k.box(m.plastic, .47, .10, .47, cx, .355, -.27, { bevel: .02 });
    for (const sx of [1, -1]) { k.box(m.metalDark, .03, .025, .56, cx + sx * .19, .315, -.27, { bevel: .004 }); k.box(m.chrome, .008, .028, .40, cx + sx * .244, .40, -.27, { bevel: .003 }); }
    k.box(m.chrome, .008, .012, .11, cx + (cx > 0 ? .25 : -.25), .43, -.46, { bevel: .003, rx: .5 }); k.sphere(m.plastic, .012, cx + (cx > 0 ? .25 : -.25), .455, -.415);
    // cushion
    k.push(cx, .455, -.262, { rx: -.10 });
    k.geo(leather, softBox(.50, .13, .52, .05, 22, 8, 40, pleatFn(.165, .20, .047, .0075, false), 3), {});
    for (const sx of [1, -1]) k.geo(leather, softBox(.085, .11, .50, .04, 8, 8, 10), { x: sx * .225, y: .028, z: 0 });
    { const y = .0655, rect = [[-.178, y, .212], [.178, y, .212], [.178, y, -.212], [-.178, y, -.212], [-.178, y, .212]]; stitches(k, m.thread, rect, [0, 1, 0], { lift: .0012 }); }
    k.pop();
    // back
    const hinge = [cx, .47, -.515], rec = 72 * D2R, ax = [0, Math.sin(rec), -Math.cos(rec)], nf = [0, Math.cos(rec), Math.sin(rec)];
    k.push(hinge[0], hinge[1] + ax[1] * .31 + nf[1] * .0, hinge[2] + ax[2] * .31, { rx: rec });
    k.geo(leather, softBox(.50, .12, .64, .05, 22, 8, 46, pleatFn(.165, .25, .047, .0075, false), 3), {});
    for (const sx of [1, -1]) k.geo(leather, softBox(.085, .11, .60, .04, 8, 8, 10), { x: sx * .225, y: .03, z: 0 });
    { const y = .0605, rect = [[-.178, y, .262], [.178, y, .262], [.178, y, -.262], [-.178, y, -.262], [-.178, y, .262]]; stitches(k, m.thread, rect, [0, 1, 0], { lift: .0012 }); }
    k.box(m.plastic, .46, .02, .58, 0, -.062, 0, { bevel: .008 });                                      // hard back shell
    // headrest on chrome posts
    for (const sx of [1, -1]) k.cyl(m.chrome, .006, .006, .12, sx * .07, 0, -.36, { rx: PI / 2, seg: 10 });
    k.geo(leather, softBox(.27, .10, .17, .045, 12, 8, 8, (x, z) => .004 * (1 - Math.pow(x / .135, 2))), { y: .012, z: -.46 });
    stitches(k, m.thread, [[-.10, .0635, -.39], [.10, .0635, -.39]], [0, 1, 0], { lift: .003 });
    k.pop(); k.pop();
  }
  function buildRearSeat(k, m) {
    const pf = (x, z) => pleatFn(.20, .18, .047, .007, false)(Math.abs(x) - .33, z);
    k.push(0, .40, -1.085, { rx: -.08 }); k.geo(m.tan, softBox(1.30, .15, .47, .05, 30, 8, 32, pf, 3), {}); k.pop();
    k.push(0, .655, -1.35, { rx: 70 * D2R }); k.geo(m.tan, softBox(1.30, .12, .46, .05, 30, 8, 32, pf, 3), {}); k.pop();
    // rear lap belts lying on the cushion
    for (const sx of [1, -1]) { k.geo(m.belt, loft([[.16, .483, -1.26], [.20, .486, -1.16], [.26, .487, -1.06], [.30, .483, -.98]].map(p => [[sx * (p[0] - .022), p[1], p[2]], [sx * (p[0] + .022), p[1], p[2] + .012]]), { closed: false, face: [0, 1, 0] }));
      k.box(m.chrome, .05, .012, .06, sx * .31, .492, -.96, { bevel: .004, ry: .3 * sx }); }
  }

  /* ================================================================== dashboard */
  function woodTex() {
    if (TX.wood) return TX.wood;
    const W = 1024, H = 256, c = canvas(W, H), g = c.getContext('2d'), rnd = GT.rng('walnut');
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#5a3418'); gr.addColorStop(.5, '#6b3f1d'); gr.addColorStop(1, '#522e15'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 520; i++) { const y0 = rnd() * H, amp = 2 + rnd() * 7, f = .004 + rnd() * .012, ph = rnd() * 9, dark = rnd() < .6; g.strokeStyle = dark ? `rgba(34,16,6,${.08 + rnd() * .22})` : `rgba(190,128,70,${.05 + rnd() * .12})`; g.lineWidth = .6 + rnd() * 1.8; g.beginPath();
      for (let x = 0; x <= W; x += 16) { const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph * 2) * amp * .3; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    for (let i = 0; i < 9; i++) { const x = rnd() * W, y = rnd() * H, r = 10 + rnd() * 26; for (let k = 0; k < 7; k++) { g.strokeStyle = `rgba(30,14,5,${.10 + rnd() * .12})`; g.lineWidth = 1.2; g.beginPath(); g.ellipse(x, y, r * (k + 1) / 7 * 1.8, r * (k + 1) / 7, .1, 0, TAU); g.stroke(); } }
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(20,10,4,${.1 + rnd() * .25})`; g.fillRect(rnd() * W, rnd() * H, 3 + rnd() * 10, .8); }
    const t = ctex(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(1 / .5, 1 / .125); return TX.wood = t;
  }
  const FACE = { y: .798, z: .3975, tilt: -.107, uy: .9943, uz: .107 };
  const onFace = (k, x, v, fn) => { k.push(x, FACE.y + v * FACE.uy, FACE.z + v * FACE.uz, { ry: PI, rx: FACE.tilt }); fn(); k.pop(); };
  const hoodK = x => sst(x, .075, .15) * (1 - sst(x, .585, .66));
  function padProfile(x) { const h = hoodK(x), t = cl(x / WS.bx, -1, 1), gy = WS.by + WS.byC * (1 - t * t) - DY - .007;      // gy: just under the windscreen base
    return [[.752, gy - .006], [.665, gy], [.575, lerp(gy, .930 + .006 * h, .5)], [.485, lerp(gy, .9345 + .020 * h, .86)], [.42 - .02 * h, .934 + .033 * h], [.388 - .036 * h, .9225 + .038 * h], [.370 - .044 * h, .905 + .037 * h], [.3665 - .045 * h, .888 + .034 * h], [.374 - .042 * h, .876 + .030 * h], [.392 - .03 * h, .870 + .027 * h], [.412, .868 + .026 * h]]; }
  const dashXs = () => { const xs = []; for (let i = 0; i <= 60; i++) xs.push(lerp(-.775, .775, i / 60)); [.075, .1, .125, .15, .585, .61, .635, .66].forEach(v => xs.push(v)); return xs.sort((a, b) => a - b); };

  function buildDash(k, m, refs) {
    const xs = dashXs();
    k.push(0, DY, 0);
    // padded top + binnacle hood (one continuous sheet)
    k.geo(m.vinyl, loft(xs.map(x => padProfile(x).map(p => [x, p[1], p[0]])), { closed: false, face: [0, 1, -1] }));
    stitches(k, m.threadDark, xs.map(x => { const p = padProfile(x)[4]; return [x, p[1] + .0005, p[0] + .012]; }), [0, 1, -.1], { pitch: .0058 });
    stitches(k, m.threadDark, xs.map(x => { const p = padProfile(x)[4]; return [x, p[1] + .0007, p[0] + .020]; }), [0, 1, -.1], { pitch: .0058 });
    // face base (black crackle) left and right of the cluster opening, lower padded roll
    const faceTop = x => { const p = padProfile(x)[10]; return [x, p[1], p[0] - .006]; }, faceBot = x => [x, .726, .390];
    for (const rg of [[-.775, .108], [.612, .775]]) { const r = []; for (let i = 0; i <= 10; i++) { const x = lerp(rg[0], rg[1], i / 10); r.push(x); } k.geo(m.plastic, loft(r.map(x => [faceTop(x), faceBot(x)]), { closed: false, face: [0, 0, -1] })); }
    k.geo(m.vinyl, loft(xs.map(x => [[.392, .730], [.374, .722], [.364, .704], [.368, .684], [.386, .670], [.44, .662], [.60, .664], [.80, .675]].map(p => [x, p[1], p[0]])), { closed: false, face: [0, -.5, -1] }));
    stitches(k, m.threadDark, xs.map(x => [x, .7125, .3675]), [0, .3, -1], { pitch: .0058 });
    k.box(m.plastic, .54, .19, .02, DX, .80, .455);                                              // dark backing behind the cluster
    // defroster slots + dash-top speaker grille
    for (const sx of [1, -1]) { const yy = padProfile(sx * .33)[1][1] + .001; k.box(m.plastic, .26, .004, .026, sx * .33, yy, .655, { bevel: .001 }); for (let i = 0; i < 13; i++) k.box(m.plasticGloss, .003, .006, .022, sx * .33 - .12 + i * .02, yy + .001, .655, { rz: .3 }); }
    k.push(-.02, .9355, .545, { rx: .03 }); k.geo(m.plastic, plate(rrect(.20, .11, .012), [], .002, .001), { rx: -PI / 2 }); for (let i = 0; i < 17; i++) k.box(m.plasticGloss, .17, .003, .0028, 0, .0035, -.044 + i * .0055); k.pop();

    // ---------- instrument cluster
    const G = gaugeAtlas(), big = .0575, sm = .0285, dep = .040;
    refs.faceGroup = new T.Group(); refs.faceGroup.position.set(DX, FACE.y + .012 * FACE.uy + DY, FACE.z + .012 * FACE.uz); refs.faceGroup.rotation.set(FACE.tilt, PI, 0, 'YXZ');
    const pods = [{ n: 'speedo', x: -.067, y: .004, r: big, rect: G.speedo }, { n: 'tach', x: .067, y: .004, r: big, rect: G.tach }, { n: 'fuel', x: -.180, y: .022, r: sm, rect: G.fuel }, { n: 'temp', x: .180, y: .022, r: sm, rect: G.temp }];
    refs.pods = pods;
    onFace(k, DX, .012, () => {
      const knobHoles = [{ x: -.180, y: -.043, r: .0075 }, { x: .180, y: -.043, r: .0075 }];
      k.geo(m.aluPanel, plate(rrect(.502, .158, .016, 6), pods.map(p => ({ x: p.x, y: p.y, r: p.r })).concat(knobHoles), .004, .0012, 40), {});
      // thin black pinstripe frame + 4 chrome screws
      k.geo(m.plasticGloss, plate(rrect(.486, .142, .012, 6), [{ pts: rrect(.482, .138, .010, 6) }], .0008, 0), { z: .0052 });
      for (const sx of [1, -1]) for (const sy of [1, -1]) { k.geo(m.chrome, lathe([[.0001, .0018], [.003, .0015], [.0042, 0]], 10), { x: sx * .232, y: sy * .062, z: .0052, rx: PI / 2 }); k.box(m.plastic, .006, .0008, .0006, sx * .232, sy * .062, .0071, { rz: sx * sy * .6 }); }
      for (const p of pods) {
        k.geo(m.tunnel, lathe([[p.r, 0], [p.r * .985, dep]], 40, { inward: true }), { x: p.x, y: p.y, z: .004, rx: -PI / 2 });
        k.geo(m.gaugeFace, disc(p.r * .99, 48, p.rect), { x: p.x, y: p.y, z: -dep + .0045 });
        k.geo(m.chrome, torus(p.r + .0022, .0036, 48, 8), { x: p.x, y: p.y, z: .0058 });
        k.geo(m.chrome, lathe([[p.r + .0005, .0], [p.r - .0035, .007]], 40, { inward: true }), { x: p.x, y: p.y, z: .005, rx: -PI / 2 });
        k.geo(m.glass, lathe([[.0001, .0022], [p.r * .5, .0016], [p.r * .86, .0006], [p.r, 0]], 32), { x: p.x, y: p.y, z: .0008, rx: PI / 2 });
      }
      // pull knobs (lights / wiper) with engraved legends
      knobHoles.forEach((h, i) => { k.geo(m.chrome, lathe([[.0085, 0], [.0085, .002], [.005, .004], [.005, .016], [.012, .018], [.0125, .026], [.0001, .0275]], 18), { x: h.x, y: h.y, z: .004, rx: PI / 2 }); k.geo(m.plasticGloss, disc(.0095, 16), { x: h.x, y: h.y, z: .0318 });
        k.geo(m.label, rectQuad(.032, .012, labelAtlas().rects['knob' + i]), { x: h.x, y: h.y - .02, z: .0056 }); });
      // tell-tale lamp bezels (the lenses are separate glow quads)
      k.geo(m.plasticGloss, plate(rrect(.03, .016, .003), [], .0012, .0004), { x: 0, y: .061, z: .0052 }); k.geo(m.plasticGloss, plate(rrect(.03, .03, .003), [], .0012, .0004), { x: 0, y: -.058, z: .0052 });
    });
    // ---------- wood applique: centre stack piece + glovebox door
    const radioV = .031, heatV = -.034, stackX = -.02;
    onFace(k, -.065, 0, () => {
      k.geo(m.wood, plate(rrect(.335, .132, .008), [{ pts: rrect(.194, .059, .004).map(p => [p[0] - .045, p[1] + radioV]) }, { pts: rrect(.194, .045, .004).map(p => [p[0] - .045, p[1] + heatV]) }, { x: .125, y: .012, r: .031 }], .003, .001, 32), {});
      k.geo(m.chrome, plate(rrect(.341, .138, .010), [{ pts: rrect(.336, .133, .008) }], .0034, .0008), { z: 0 });
      // clock (flush mounted)
      k.geo(m.gaugeFace, disc(.0305, 36, G.clock), { x: .125, y: .012, z: .0034 }); k.geo(m.chrome, torus(.0322, .0032, 40, 8), { x: .125, y: .012, z: .0052 });
      k.geo(m.chrome, lathe([[.0312, .0], [.0296, .0036]], 36, { inward: true }), { x: .125, y: .012, z: .0072, rx: -PI / 2 });
      k.geo(m.glass, lathe([[.0001, .0034], [.02, .0024], [.031, 0]], 28), { x: .125, y: .012, z: .0056, rx: PI / 2 });
      k.geo(m.chrome, lathe([[.004, 0], [.004, .006], [.0001, .007]], 10), { x: .125, y: -.03, z: .003, rx: PI / 2 });     // clock set stem
    });
    onFace(k, -.475, 0, () => {
      k.geo(m.wood, plate(rrect(.45, .122, .010), [], .0045, .0015, 8), {});
      k.geo(m.chrome, plate(rrect(.458, .130, .013), [{ pts: rrect(.4525, .1245, .011) }], .003, .0008), { z: 0 });
      k.geo(m.chrome, lathe([[.011, 0], [.011, .003], [.0085, .0055], [.0001, .006]], 20), { x: -.19, y: .028, z: .006, rx: PI / 2 }); k.box(m.plastic, .0012, .008, .0006, -.19, .028, .0122);
      k.geo(m.label, rectQuad(.15, .0393, labelAtlas().rects.script), { x: .09, y: -.022, z: .0066 });
    });
    refs.clockGroup = new T.Group(); refs.clockGroup.position.set(-.065 - .125, FACE.y + .012 * FACE.uy + DY, FACE.z + .012 * FACE.uz); refs.clockGroup.rotation.set(FACE.tilt, PI, 0, 'YXZ');
    // ---------- radio
    refs.stackGroup = new T.Group(); refs.stackGroup.position.set(stackX, FACE.y + radioV * FACE.uy + DY, FACE.z + radioV * FACE.uz); refs.stackGroup.rotation.set(FACE.tilt, PI, 0, 'YXZ');
    onFace(k, stackX, radioV, () => {
      k.box(m.plastic, .19, .056, .004, 0, 0, -.006);
      k.geo(m.chrome, plate(rrect(.19, .057, .005), [{ pts: rrect(.120, .0215, .002).map(p => [p[0], p[1] + .0115]) }, { pts: rrect(.120, .0125, .002).map(p => [p[0], p[1] - .0085]) }], .0045, .001), { z: 0 });
      k.geo(m.labelGlow, rectQuad(.119, .0208, labelAtlas().rects.tuner), { x: 0, y: .0115, z: .0012 });
      k.geo(m.glass, rectQuad(.120, .0215), { x: 0, y: .0115, z: .0034 });
      k.geo(m.glass, rectQuad(.120, .0125), { x: 0, y: -.0085, z: .0034 });
      for (let i = 0; i < 5; i++) { k.geo(m.chrome, softBox(.0205, .0072, .010, .002, 7, 7, 7), { x: -.046 + i * .023, y: -.0218, z: .009 }); }
      for (const sx of [1, -1]) { k.geo(m.plasticGloss, lathe([[.018, 0], [.018, .006], [.0155, .008]], 24), { x: sx * .0775, y: 0, z: .0045, rx: PI / 2 });
        const kn = []; for (let i = 0; i <= 5; i++) kn.push([.0128 - .0008 * i / 5, .008 + i * .0036]); kn.push([.0105, .0275], [.0001, .0285]); k.geo(m.chrome, lathe(kn, 24), { x: sx * .0775, y: 0, z: .0045, rx: PI / 2 });
        for (let i = 0; i < 20; i++) { const a = i / 20 * TAU; k.box(m.chrome, .0012, .0012, .017, sx * .0775 + Math.cos(a) * .0126, Math.sin(a) * .0126, .022, { rz: a }); } }
      k.geo(m.label, rectQuad(.1, .0078, labelAtlas().rects.radio), { x: 0, y: .0252, z: .0058 });
    });
    // ---------- heater panel
    refs.heatLevers = [];
    onFace(k, stackX, heatV, () => {
      k.geo(m.plastic, plate(rrect(.19, .043, .004), [], .003, .001), { z: -.001 });
      k.geo(m.labelGlow, rectQuad(.172, .0403, labelAtlas().rects.heater), { x: 0, y: 0, z: .0036 });
      [[.0075, -.03], [-.006, .028], [-.0195, -.012]].forEach((q, i) => { k.box(m.tunnel, .11, .0026, .003, 0, q[0] - .0058, .0028, { bevel: .0006 });
        k.box(m.chrome, .004, .005, .014, q[1], q[0] - .0058, .008, { bevel: .001 }); k.geo(m.plasticGloss, softBox(.011, .0085, .0085, .003, 7, 7, 7), { x: q[1], y: q[0] - .0058, z: .017 }); });
    });
    // ---------- outboard round vents
    for (const x of [.688, -.728]) onFace(k, x, .012, () => { k.geo(m.chrome, torus(.029, .0042, 32, 8), { z: .0075 }); k.geo(m.tunnel, disc(.028, 24), { z: .0012 });
      for (let i = -2; i <= 2; i++) k.box(m.plasticGloss, Math.sqrt(.027 * .027 - i * i * .0001) * 2, .0022, .007, 0, i * .01, .0048, { rx: .6 }); k.sphere(m.chrome, .0045, 0, 0, .0085); });
    // ---------- lower roll: ashtray drawer, lighter, under-dash courtesy lamp
    k.push(stackX - .01, .700, .3655, { ry: PI, rx: .12 });
    k.geo(m.chrome, plate(rrect(.125, .027, .005), [], .005, .0015), {}); k.box(m.plastic, .06, .006, .003, 0, -.004, .0075, { bevel: .001 }); k.geo(m.chrome, softBox(.05, .006, .008, .002, 7, 7, 7), { y: .006, z: .008 });
    k.geo(m.chrome, lathe([[.0125, 0], [.0125, .003], [.0095, .006], [.0095, .014], [.0001, .0155]], 20), { x: -.095, y: 0, z: 0, rx: PI / 2 }); k.geo(m.plasticGloss, disc(.007, 14), { x: -.095, z: .0162 });
    k.geo(m.label, rectQuad(.03, .011, labelAtlas().rects.knob3), { x: -.095, y: -.019, z: .002 });
    k.pop();

    // ---------- police scanner hung under the dash on a bracket
    k.push(-.045, .612, .43, { rx: .06 });
    k.geo(m.plastic, softBox(.175, .05, .14, .005, 7, 7, 7), {}); k.box(m.metalDark, .19, .004, .05, 0, .027, .02, { bevel: .001 }); for (const sx of [1, -1]) k.box(m.metalDark, .004, .05, .03, sx * .093, .028, .02, { bevel: .001 });
    k.push(0, 0, -.0705, { ry: PI });
    k.geo(m.alu, plate(rrect(.17, .045, .003), [{ pts: rrect(.07, .012, .002).map(p => [p[0] - .01, p[1] + .008]) }], .002, .0006), {});
    k.geo(m.tunnel, rectQuad(.07, .012), { x: -.01, y: .008, z: .0008 });
    for (const x of [-.07, .07]) { k.geo(m.plasticGloss, lathe([[.009, 0], [.0085, .011], [.0001, .012]], 16), { x, y: .004, z: .002, rx: PI / 2 }); k.box(m.paper, .0012, .006, .0006, x, .0075, .0143); }
    for (let i = 0; i < 6; i++) k.box(m.plastic, .0015, .012, .001, .028 + i * .004, .008, .0026);
    k.geo(m.label, rectQuad(.15, .01, labelAtlas().rects.scan), { x: 0, y: -.013, z: .0032 });
    k.pop();
    k.tube(m.rubber, [[.07, 0, .06], [.11, -.03, .09], [.12, -.02, .2], [.10, .04, .3]], .003, { seg: 5 }); k.tube(m.rubber, [[-.06, .01, .07], [-.08, .06, .16], [-.05, .09, .3]], .0025, { seg: 5 });
    k.pop();
    refs.scannerPos = V3(-.045, .612 + DY, .43 - .0705 - .003);
    k.pop();
  }

  /* ---- centre console, shifter base, cup, pedals (static parts) */
  function buildConsole(k, m, refs) {
    k.push(0, CY, 0);
    // console body on the tunnel
    { const rings = []; for (let i = 0; i <= 12; i++) { const z = lerp(.30, -.62, i / 12), top = .452 + .03 * sst(z, -.05, .30) - .025 * sst(z, -.3, -.62), hw = .105 - .012 * sst(z, .1, .3); rings.push([[-hw - .02, .30, z], [-hw, top - .02, z], [-hw + .018, top, z], [hw - .018, top, z], [hw, top - .02, z], [hw + .02, .30, z]]); }
      k.geo(m.vinyl, loft(rings, { closed: false, face: [0, 1, 0], cap0: false })); k.box(m.vinyl, .2, .15, .02, 0, .38, .30, { bevel: .008 }); k.box(m.vinyl, .2, .12, .02, 0, .37, -.62, { bevel: .008 }); }
    // brushed top plate with the shift gate
    k.push(0, .462, .035, { rx: -.085 });
    k.geo(m.alu, plate(rrect(.15, .30, .012), [{ pts: rrect(.016, .13, .008).map(p => [p[0] - .012, p[1] + .01]) }], .003, .001), { rx: -PI / 2 });
    k.geo(m.chrome, plate(rrect(.058, .19, .012), [{ pts: rrect(.022, .136, .010).map(p => [p[0] - .012, p[1] + .01]) }, { pts: rrect(.024, .136, .003).map(p => [p[0] + .014, p[1] + .01]) }], .0025, .001), { rx: -PI / 2, y: .003 });
    k.geo(m.labelGlow, rectQuad(.022, .132, labelAtlas().rects.prnd), { x: .014, y: .0042, z: .01, rx: -PI / 2 });
    k.box(m.tunnel, .014, .01, .128, -.012, -.004, .01); k.geo(m.rubber, lathe([[.03, 0], [.026, .006], [.017, .02], [.012, .034], [.009, .04]], 16), { x: -.012, y: -.004, z: .01 });
    // rubber boot bristles hinted by a dark slot + rocker switches + coin tray behind
    for (let i = 0; i < 3; i++) { k.geo(m.plasticGloss, softBox(.02, .008, .012, .003, 7, 7, 7), { x: -.045 + i * .0, y: .006, z: -.105 - i * .016, rz: .0 }); }
    k.pop();
    refs.shiftPivot = V3(-.012, .452 + CY, .045);
    // tray + cup holder ring
    k.box(m.plastic, .15, .012, .20, 0, .437, -.30, { bevel: .003 });
    for (const sx of [1, -1]) k.box(m.vinyl, .012, .03, .21, sx * .081, .447, -.30, { bevel: .004 }); k.box(m.vinyl, .17, .03, .012, 0, .447, -.40, { bevel: .004 }); k.box(m.vinyl, .17, .03, .012, 0, .447, -.195, { bevel: .004 });
    // armrest lid at the back
    k.geo(m.tanDark, softBox(.19, .05, .20, .02, 12, 7, 12, (x, z) => .004 * (1 - Math.pow(x / .095, 2))), { x: 0, y: .455, z: -.51 });
    stitches(k, m.thread, [[-.07, .4815, -.42], [.07, .4815, -.42], [.07, .4815, -.60], [-.07, .4815, -.60], [-.07, .4815, -.42]], [0, 1, 0], { lift: .0018 });
    // seat-belt buckle stalks beside the console
    for (const sx of [1, -1]) { k.box(m.belt, .035, .11, .008, sx * .135, .47, -.42, { rx: -.5, bevel: .002 }); k.box(m.chrome, .045, .055, .016, sx * .135, .525, -.39, { rx: -.5, bevel: .004 }); k.box(m.plasticRed, .02, .012, .004, sx * .135, .54, -.376, { rx: -.5, bevel: .001 }); }
    k.pop();
    // ---- pedals: brackets (static); pads are animated groups made in build()
    k.box(m.metalDark, .30, .03, .05, DX - .04, .665, .66, { bevel: .004 });
    k.geo(m.chrome, lathe([[.016, 0], [.016, .004], [.011, .009], [.0001, .011]], 14), { x: .62, y: FLOOR + .001, z: .47 });            // dimmer switch
    // parking brake pedal (far left) + release handle under the dash
    k.box(m.metalDark, .012, .16, .018, .655, .54, .62, { rx: .4, bevel: .003 }); k.geo(m.rubber, softBox(.06, .014, .045, .005, 7, 7, 7, (x, z) => .0015 * sst(Math.sin(x * TAU / .012), -.2, .4)), { x: .655, y: .465, z: .585, rx: -1.0 });
    k.tube(m.metalDark, [[.60, .615, .40], [.60, .605, .47]], .004, { seg: 6 }); k.box(m.plastic, .05, .014, .018, .60, .617, .395, { bevel: .005 });
  }

  /* ================================================================== moving parts */
  function remapUV(g, rect, ax, ay) { g.computeBoundingBox(); const b = g.boundingBox, p = g.attributes.position, uv = g.attributes.uv, x0 = b.min[ax || 'x'], x1 = b.max[ax || 'x'], y0 = b.min[ay || 'y'], y1 = b.max[ay || 'y'];
    for (let i = 0; i < p.count; i++) { const x = ax === 'z' ? p.getZ(i) : p.getX(i), y = ay === 'z' ? p.getZ(i) : p.getY(i); uv.setXY(i, lerp(rect[0], rect[2], (x - x0) / (x1 - x0)), lerp(rect[1], rect[3], (y - y0) / (y1 - y0))); } return g; }
  const wheelFrame = () => new T.Matrix4().makeRotationX(WHEEL.tilt).setPosition(WHEEL.x, WHEEL.y, WHEEL.z);
  const wheelToCabin = (x, y, z) => V3(x, y, z).applyMatrix4(wheelFrame());

  function buildWheel(m) {
    const k = GT.kit(), R = WHEEL.R, dish = .044, r1 = R - .004, r0 = .028, th = Math.atan(dish / (r1 - r0));
    // rim: lacquered wood with a slim brushed inlay on the driver side
    { const g = torus(R, WHEEL.r, 96, 14), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), rr = Math.hypot(x, y), a = Math.atan2(y, x), dr = rr - R; // slightly oval section + finger scallops on the back
        const sc = z > 0 ? .0012 * Math.pow(Math.abs(Math.sin(a * 22)), 2) * sst(z, 0, WHEEL.r) : 0; const nr = R + dr * 1.06 - sc * (dr < 0 ? 1 : 0); p.setXYZ(i, Math.cos(a) * nr, Math.sin(a) * nr, z * .96 - sc); } g.computeVertexNormals();
      // merge the torus seam normals
      k.geo(m.wood, g); }
    k.geo(m.alu, torus(R, .0026, 96, 6), { z: -WHEEL.r * .93 });
    // three drilled spokes (9, 3 and 6 o'clock), dished towards the dash
    for (const a of [0, PI, -PI / 2]) { const L = r1 - r0, w0 = .019, w1 = .0125;
      const out = [[-L, -w0], [-L * .5, -(w0 + w1) / 2 + .0015], [0, -w1], [.006, -w1], [.006, w1], [0, w1], [-L * .5, (w0 + w1) / 2 - .0015], [-L, w0]];
      const holes = [[-.118, .0088], [-.094, .0078], [-.072, .0068], [-.052, .0058], [-.034, .0048]].map(h => ({ x: h[0], y: 0, r: h[1] }));
      const g = plate(out, holes, .0036, .0011, 20); g.translate(0, 0, -.0018); k.push(0, 0, 0, { rz: a }); k.geo(m.alu, g, { x: r1, ry: th });
      // rim clamps: wood wraps the spoke end, two chrome rivets
      for (const s of [-1, 1]) k.geo(m.chrome, lathe([[.0001, .0016], [.0022, .0012], [.003, 0]], 8), { x: R - .0005, y: s * .0065, z: -WHEEL.r * .98, rx: -PI / 2 });
      k.pop(); }
    // hub: brushed disc, horn pad with emblem, chrome ring
    k.push(0, 0, dish);
    k.geo(m.alu, lathe([[.0001, -.003], [.040, -.003], [.046, -.001], [.046, .004], [.0001, .004]], 40), { rx: PI / 2 });
    k.geo(m.leatherB, lathe([[.0001, .0235], [.016, .023], [.027, .0205], [.034, .0155], [.0375, .008], [.0385, 0]], 36), { rx: -PI / 2, z: -.003 });
    k.geo(m.chrome, torus(.0392, .0026, 44, 8), { z: -.0038 });
    k.geo(m.chrome, torus(.0215, .0016, 36, 6), { z: -.0258 });
    k.geo(m.label, disc(.0205, 32, labelAtlas().rects.emblem), { z: -.0266, ry: PI });
    for (let i = 0; i < 3; i++) { const a = PI / 2 + i * TAU / 3 + PI / 3; k.geo(m.chrome, lathe([[.0001, .002], [.003, .0016], [.004, 0]], 8), { x: Math.cos(a) * .0425, y: Math.sin(a) * .0425, z: -.0032, rx: -PI / 2 }); }
    k.cyl(m.plastic, .034, .037, .05, 0, 0, .029, { rx: PI / 2, seg: 24 });
    k.pop();
    const g = k.build(); g.children.forEach(c => { c.castShadow = true; }); return g;
  }
  function buildColumn(k, m, refs) {
    k.push(WHEEL.x, WHEEL.y, WHEEL.z, { rx: WHEEL.tilt });
    k.geo(m.plastic, lathe([[.036, .098], [.0375, .11], [.0375, .30], [.041, .34]], 28), { rx: PI / 2 });
    k.geo(m.chrome, lathe([[.0372, .094], [.039, .096], [.039, .104], [.0376, .106]], 28), { rx: PI / 2 });
    k.box(m.plasticGloss, .0755, .02, .04, 0, 0, .17, { bevel: .004 });         // shroud split line hint
    // ignition switch on the right of the column, angled to the driver
    k.push(-.036, -.004, .155, { ry: -PI / 2 - .35 });
    k.geo(m.chrome, lathe([[.0135, 0], [.0135, .01], [.011, .014], [.0001, .0145]], 22), { rx: PI / 2 });
    k.box(m.plastic, .003, .009, .001, 0, 0, .015);
    k.box(m.chrome, .0018, .009, .012, 0, 0, .020, { bevel: .0006 });           // key shank
    k.geo(m.chrome, plate(rrect(.022, .02, .007), [{ x: 0, y: .004, r: .0032 }], .002, .0006), { z: .0245, ry: PI / 2, x: .001, y: 0 });
    k.pop();
    // tilt lever + hazard knob
    k.tube(m.chrome, [[.034, -.012, .22], [.07, -.03, .215], [.095, -.036, .21]], .003, { seg: 6 }); k.sphere(m.plastic, .007, .1, -.037, .209);
    k.geo(m.plasticRed, lathe([[.006, 0], [.006, .008], [.0001, .009]], 12), { x: -.02, y: .036, z: .16, rz: -.5 });
    k.pop();
    refs.keyAnchor = wheelToCabin(-.036 - .0245 * Math.cos(.35) - .004, -.002, .155 - .0245 * Math.sin(.35) * 0 - .006);
    refs.stalkPivot = wheelToCabin(.034, .004, .125);
  }
  function buildStalk(m) { const k = GT.kit(); k.tube(m.chrome, [[0, 0, 0], [.05, .004, -.006], [.105, .012, -.016]], .0036, { seg: 8 }); k.geo(m.plasticGloss, lathe([[.0048, 0], [.0075, .005], [.0082, .022], [.006, .03], [.0001, .0315]], 14), { x: .104, y: .012, z: -.016, rz: -PI / 2 + .12, rx: 0 }); k.sphere(m.chrome, .006, 0, 0, 0); return k.build({ cast: false }); }
  function buildNeedle(m, len, tail, w) { const k = GT.kit(); k.geo(m, plate([[-w, -tail], [w, -tail], [w * .35, len], [-w * .35, len]], [], .0009, .0003), {}); return k.build({ cast: false }); }
  function buildShifter(m) {
    const k = GT.kit();
        k.tube(m.chrome, [[0, .0, 0], [0, .05, 0], [.003, .10, -.006], [.004, .148, -.012]], .0058, { seg: 10 });
    k.geo(m.chrome, lathe([[.006, 0], [.0105, .004], [.0105, .010], [.007, .014]], 16), { x: .004, y: .142, z: -.012 });
    k.sphere(m.ivory, .0245, .0045, .176, -.013, { seg: 28, seg2: 20 });
    k.geo(m.label, disc(.0115, 24, labelAtlas().rects.knobtop), { x: .0045, y: .2007, z: -.013, rx: -PI / 2 });
    k.geo(m.chrome, lathe([[.0001, .0006], [.0028, .0004], [.0034, 0]], 8), { x: .0045 + .012, y: .153, z: -.013 - .02, rx: -1.9 });     // detent button
    return k.build();
  }
  const KNOB_LOCAL = V3(.0045, .176, -.013), GEAR_ANG = { P: .27, R: .135, N: 0, D: -.135 };
  function buildPedal(m, kind) {
    const k = GT.kit();
    if (kind === 'gas') { k.box(m.rubber, .012, .30, .014, 0, -.14, -.02, { rx: -.2, bevel: .003 }); k.geo(m.rubber, softBox(.058, .014, .135, .005, 5, 5, 20, (x, z) => .0016 * sst(Math.sin(z * TAU / .013), -.2, .4), 2), { y: -.285, z: -.062, rx: -1.02 }); }
    else { k.box(m.rubber, .016, .24, .018, 0, -.11, -.02, { rx: -.3, bevel: .003 }); k.geo(m.rubber, softBox(.125, .016, .068, .006, 26, 5, 5, (x, z) => .0018 * sst(Math.sin(x * TAU / .014), -.2, .4), 2), { y: -.235, z: -.075, rx: -1.05 });
      k.geo(m.chrome, plate(rrect(.133, .076, .012), [{ pts: rrect(.121, .064, .008) }], .004, .0012), { y: -.2345, z: -.0755, rx: -1.05 + PI / 2 }); }
    return k.build({ cast: false });
  }
  function buildKeys(m) {
    const k = GT.kit();
    k.geo(m.chrome, torus(.0105, .0009, 20, 5), { y: -.0105, ry: .5 });
    // leather fob with rivet, second key, round tag
    k.push(0, -.021, 0, { rz: .12, ry: .3 }); k.geo(m.tanDark, softBox(.026, .006, .052, .0028, 5, 5, 8, null, 2), { y: -.026, rx: PI / 2 }); k.geo(m.chrome, lathe([[.0001, .0012], [.003, .0008], [.0036, 0]], 10), { y: -.008, z: .0032, rx: PI / 2 }); k.pop();
    k.push(.002, -.02, -.003, { rz: -.35, ry: -.5 }); k.geo(m.chrome, plate([[-.0085, 0], [.0085, 0], [.0085, -.012], [.003, -.017], [.003, -.05], [.001, -.053], [-.002, -.05], [-.003, -.044], [-.002, -.04], [-.003, -.034], [-.002, -.028], [-.003, -.017], [-.0085, -.012]], [{ x: 0, y: -.005, r: .0026 }], .0016, .0004), {}); k.pop();
    k.push(-.003, -.021, .003, { rz: .5, ry: 1.1 }); k.geo(m.chrome, plate(circlePts(.0105, 16, 0, -.016), [{ x: 0, y: -.008, r: .002 }], .0012, .0003), {}); k.pop();
    return k.build({ cast: false });
  }
  function buildFreshener(m) {
    const k = GT.kit(), P = propsAtlas();
    k.tube(m.paper, [[0, 0, 0], [0, -.05, 0], [0, -.095, 0]], .0006, { seg: 4 });
    // surfboard-shaped card
    const out = []; for (let i = 0; i <= 28; i++) { const t = i / 28, y = lerp(.062, -.062, t), w = .0245 * Math.pow(Math.sin(cl(t * .93 + .035, 0, 1) * PI), .55); out.push([w, y]); } for (let i = 28; i >= 0; i--) { const p = out[i]; out.push([-p[0], p[1]]); }
    const g = plate(out.slice(0, 29).concat(out.slice(29)), [{ x: 0, y: .05, r: .0022 }], .0012, .0003, 8); remapUV(g, P.rects.fresh); g.translate(0, -.157, -.0006);
    k.geo(m.print, g, { ry: .25 });
    return k.build({ cast: false });
  }

  /* ---- mirror, visors (static), returns mirror frame */
  function buildMirror(k, m, refs) {
    const toEye = EYE.clone().sub(V3(MIRROR.x, MIRROR.y, MIRROR.z)).normalize(), back = V3(0, -.05, -1).normalize(), n = toEye.clone().add(back).normalize();
    const ry = Math.atan2(n.x, n.z), rx = -Math.asin(n.y);
    refs.mirror = { pos: V3(MIRROR.x, MIRROR.y, MIRROR.z), ry, rx, back, n, w: .172, h: .04 };   /* a slim strip of glass (it was a 24 x 6.4 cm slab that filled the top right of the view) */
    k.push(MIRROR.x, MIRROR.y, MIRROR.z, { ry, rx });
    k.geo(m.plastic, softBox(.192, .054, .024, .01, 14, 9, 7), { z: -.016 });
    k.geo(m.chrome, plate(rrect(.188, .052, .012, 6), [{ pts: rrect(.174, .042, .008, 6) }], .003, .001), { z: -.005 });
    k.geo(m.plastic, softBox(.02, .008, .012, .003, 7, 7, 7), { y: -.03, z: -.012 });        // day / night tab
    k.sphere(m.chrome, .011, 0, .012, -.04);
    k.pop();
    // stalk to the header
    const hd = [0, roofY(0, .12) - .03, .15]; k.tube(m.chrome, [[MIRROR.x - n.x * .04, MIRROR.y + .012, MIRROR.z - n.z * .04], [0, hd[1] - .018, hd[2] + .028], hd], .0048, { seg: 8 });
    k.geo(m.chrome, lathe([[.016, 0], [.014, .006], [.006, .01]], 14), { x: 0, y: hd[1] + .006, z: hd[2] - .004, rx: PI + .5 });
    refs.freshAnchor = V3(MIRROR.x + .02, MIRROR.y - .03, MIRROR.z + .02);   /* hangs from the mirror stem, inside the frame */
    // ---- sun visors: driver's folded up, passenger's flipped half down with the placard showing
    const visor = (cx, ang, extra) => { k.push(cx, roofY(cx, .07) - .016, .078, { rx: ang });
      k.tube(m.chrome, [[-.175 * Math.sign(cx), 0, 0], [.185 * Math.sign(cx), 0, 0]], .0036, { seg: 6 }); k.geo(m.chrome, lathe([[.011, 0], [.009, .006], [.004, .009]], 12), { x: .185 * Math.sign(cx), rz: 0, rx: PI, y: .008 });
      k.geo(m.headliner, softBox(.345, .016, .145, .007, 16, 7, 9, (x, z) => .002 * (1 - Math.pow(x / .17, 2))), { z: -.078 });
      const y = .0096, r = [[-.162, y, -.012], [.162, y, -.012], [.162, y, -.142], [-.162, y, -.142], [-.162, y, -.012]]; stitches(k, m.thread, r.map(p => [p[0], -y, p[2]]), [0, -1, 0], { lift: .0008 });
      if (extra) extra(); k.pop(); };
    visor(DX, -.11, () => { const P = propsAtlas(); k.box(m.belt, .012, .02, .15, .06, 0, -.078, { bevel: .002 });             // elastic band + toll stub tucked in
      k.geo(m.print, rectQuad(.085, .0425, P.rects.stub), { x: .01, y: -.0105, z: -.085, rx: PI / 2, ry: 0, rz: .12 }); });
    visor(-DX, -.34, () => { k.geo(m.label, rectQuad(.11, .055, labelAtlas().rects.placard), { x: -.04, y: .0092, z: -.08, rx: -PI / 2 }); });
  }

  /* ================================================================== lived-in props */
  function buildProps(k, m) {
    const P = propsAtlas(), R = P.rects;
    // ---- aviator sunglasses on the dash top (centre), lenses up, one temple half open
    k.push(.02, .9395 + DY, .56, { ry: .5, rx: .02 });
    for (const sx of [1, -1]) { const out = []; for (let i = 0; i < 28; i++) { const a = i / 28 * TAU, tear = 1 + .16 * Math.max(0, -Math.sin(a)) * (1 + Math.cos(a) * sx * .5); out.push([Math.cos(a) * .0265 * tear, Math.sin(a) * .021 * tear]); }
      k.push(sx * .0335, .012, 0, { rx: -1.18 });
      k.tube(m.gold, out.map(p => [p[0], p[1], 0]), .0009, { closed: true, seg: 5, steps: 56 });
      k.geo(m.glassTint, plate(out, [], .0006, 0, 6), { z: -.0003 });
      k.sphere(m.paper, .0028, -sx * .021, -.013, -.006, { s: [1, 1.5, .7] });
      k.pop();
      // temples
      const hx = sx * .061, hy = .017; k.box(m.gold, .004, .006, .004, hx, hy, .002, { bevel: .001 });
      if (sx > 0) k.tube(m.gold, [[hx, hy, .002], [hx - .03, hy - .008, .016], [hx - .085, hy - .014, .024], [hx - .11, hy - .016, .02]], .0008, { seg: 5 });
      else k.tube(m.gold, [[hx, hy, .002], [hx - .004, hy - .006, .05], [hx - .008, hy - .014, .105], [hx - .01, hy - .017, .125]], .0008, { seg: 5 }); }
    k.tube(m.gold, [[-.012, .021, .0], [0, .0235, .001], [.012, .021, 0]], .0008, { seg: 5 }); k.tube(m.gold, [[-.011, .015, .003], [0, .0175, .004], [.011, .015, .003]], .0008, { seg: 5 });
    k.pop();
    // ---- cigarette pack + matchbook near the passenger side of the cluster hood
    k.push(-.235, .944 + DY, .50, { ry: -.42, rx: .02 });
    k.box(m.paper, .056, .022, .086, 0, 0, 0, { bevel: .0015 });
    k.geo(m.print, rectQuad(.055, .085, R.cig), { y: .0113, rx: -PI / 2 }); k.geo(m.print, rectQuad(.085, .021, R.cigside), { x: .0284, rz: 0, ry: PI / 2 }); k.geo(m.print, rectQuad(.085, .021, R.cigside), { x: -.0284, ry: -PI / 2 }); k.geo(m.print, rectQuad(.055, .021, R.cigtop), { z: -.0434, ry: PI });
    k.pop();
    k.push(-.15, .9375 + DY, .485, { ry: .7 }); k.box(m.paper, .04, .004, .05, 0, 0, 0, { bevel: .001 }); k.geo(m.print, rectQuad(.039, .049, R.match), { y: .0022, rx: -PI / 2 }); k.pop();
    // ---- curled receipt against the windshield, passenger side
    { const rings = []; for (let i = 0; i <= 12; i++) { const t = i / 12, curl = .012 * Math.pow(t, 2.2), z = .50 + t * .13 - curl * .3, y0 = lerp(.936, .925, t) + DY; rings.push([[-.50, y0 + curl + .0012 + .003 * Math.sin(t * 5), z], [-.445, y0 + .002 + curl * 1.3 + .003 * Math.sin(t * 5 + 1), z + .012]]); }
      const g = loft(rings, { closed: false, face: [0, 1, 0], uvRect: [R.receipt[0], R.receipt[1], R.receipt[2], R.receipt[3]] }); k.geo(m.print, g); }
    // ---- folded road map on the passenger seat, half open, with the marked route showing
    k.push(-.42, .535 + SY, -.12, { ry: .35, rx: -.09 });
    k.geo(m.paper, softBox(.115, .012, .245, .003, 7, 7, 9), {}); k.geo(m.print, rectQuad(.113, .243, R.mapcover), { y: .0064, rx: -PI / 2 });
    { const rings = []; for (let i = 0; i <= 8; i++) { const t = i / 8; rings.push([[.057 + t * .21, .006 + Math.sin(t * PI) * .022 + t * .012, -.1215], [.057 + t * .21, .006 + Math.sin(t * PI) * .022 + t * .012, .1215]]); } k.geo(m.print, loft(rings, { closed: false, face: [0, 1, 0], uvRect: [R.map[0], R.map[1], R.map[2], R.map[3]] })); }
    k.pop();
    // ---- duffel bag on the passenger seat with its strap over the seat edge
    k.push(-.37, .60 + SY, -.33, { ry: .16 });
    k.geo(m.belt, softBox(.40, .21, .25, .085, 18, 10, 12, (x, z) => .012 * Math.sin(x * 21 + 1) * Math.sin(z * 17) + .008 * Math.sin(x * 47 + z * 31) - .014 * bump(z, 0, .02), 4), {});
    k.geo(m.print, rectQuad(.30, .014, [R.zip[0], R.zip[1] + .012, R.zip[2], R.zip[3] - .012]), { y: .1015, rx: -PI / 2 });
    for (const sz of [1, -1]) { k.tube(m.belt, [[-.11, .075, sz * .075], [-.09, .13, sz * .05], [0, .16 + sz * .012, sz * .03], [.09, .13, sz * .05], [.11, .075, sz * .075]], .007, { seg: 6 }); for (const sx2 of [1, -1]) k.box(m.belt, .03, .05, .004, sx2 * .11, .06, sz * .092, { rx: sz * .5, bevel: .001 }); }
    k.geo(m.chrome, torus(.008, .0014, 12, 5), { x: .196, y: .04, z: 0, ry: PI / 2 });
    k.geo(m.belt, loft([[.2, .04, 0], [.24, .0, .05], [.25, -.08, .14], [.235, -.17, .20], [.20, -.24, .215]].map(p => [[p[0], p[1], p[2] - .019], [p[0] + .004, p[1] + .003, p[2] + .019]]), { closed: false, face: [1, 1, 1] }));
    k.pop();
    // ---- big paper cup with lid + straw in the console tray, cassette tapes, coins, lighter
    k.push(-.02, .443 + CY, -.255);
    { const g = lathe([[.031, 0], [.0335, .05], [.0375, .11], [.0405, .155]], 28, { uvRect: [R.cup[0], R.cup[1], R.cup[2], R.cup[3]] }); k.geo(m.print, g, {}); }
    k.geo(m.paper, disc(.031, 20), { rx: PI / 2, y: .0005 });
    k.geo(m.paper, lathe([[.0425, .152], [.0425, .158], [.039, .163], [.03, .1645], [.012, .166], [.0001, .166]], 28), {});
    k.tube(m.plasticRed, [[.006, .16, .004], [.012, .21, .01], [.02, .245, .016]], .003, { seg: 8 });
    k.pop();
    k.push(.02, .4455 + CY, -.345, { ry: .3 }); k.box(m.plastic, .102, .013, .064, 0, 0, 0, { bevel: .002 }); k.geo(m.print, rectQuad(.1, .062, R.tape), { y: .0068, rx: -PI / 2 }); k.pop();
    k.push(.028, .459 + CY, -.35, { ry: -.25, rz: .06 }); k.box(m.plastic, .108, .015, .069, 0, 0, 0, { bevel: .002 }); k.geo(m.print, rectQuad(.1, .062, R.tape), { y: .0079, rx: -PI / 2 }); k.pop();
    const rnd = GT.rng('coins'); for (let i = 0; i < 6; i++) k.cyl(i % 3 ? m.chrome : m.gold, .0095 + (i % 2) * .002, .0095 + (i % 2) * .002, .0016, .045 + rnd() * .02, .4442 + CY + i * .0004, -.215 - rnd() * .03, { seg: 14, rx: (rnd() - .5) * .2 });
    k.geo(m.chrome, softBox(.036, .012, .054, .003, 7, 7, 7), { x: -.05, y: .449 + CY, z: -.375, ry: .9 });
    // ---- unbuckled passenger belt tongue lying on the seat, driver lap belt across
    k.push(0, SY, 0);
    k.geo(m.belt, loft([[-.60, .50, -.40], [-.60, .54, -.30], [-.585, .548, -.20], [-.57, .52, -.10]].map(p => [[p[0] - .0, p[1], p[2]], [p[0] + .044, p[1] + .004, p[2] + .008]]), { closed: false, face: [0, 1, .3] }));
    k.geo(m.chrome, plate(rrect(.046, .06, .008), [{ pts: rrect(.024, .012, .003).map(p => [p[0], p[1] + .014]) }], .003, .001), { x: -.548, y: .522, z: -.07, rx: -PI / 2 + .2, ry: .3 });
    k.pop();
  }

  /* ================================================================== the driver's body (static: seen when looking down) */
  function buildBody(k, m) {
    const jeans = m.denim, cx = DX;
    k.push(0, SY, 0);
    // thighs + shins
    const leg = (sx, knee, foot) => { const hip = [cx + sx * .095, .575, -.44];
      k.geo(jeans, tubeR([hip, [lerp(hip[0], knee[0], .5), lerp(hip[1], knee[1], .5) + .004, lerp(hip[2], knee[2], .5)], knee, [lerp(knee[0], foot[0], .45), lerp(knee[1], foot[1], .45) + .01, lerp(knee[2], foot[2], .45) + .03], [foot[0], foot[1] + .07, foot[2] - .03]], [.092, .083, .066, .056, .05], 16, { uvScale: 3 }));
      // boot
      k.push(foot[0], foot[1], foot[2], { rx: -.62, ry: sx * -.12 }); k.geo(m.sneaker || m.leatherB, softBox(.098, .075, .27, .034, 9, 9, 14, (x, z) => -.022 * sst(z, .0, .13)), { z: .04 }); k.box(m.rubber, .1, .014, .275, 0, -.042, .04, { bevel: .005 }); k.pop(); };
    leg(-1, [cx - .135, .635, .09], [.225, .415, .555]); leg(1, [cx + .15, .63, .08], [.565, .405, .53]);
    // torso: the T-shirt
    const ring = (y, z, hw, hd, n, a0, a1, grow) => { const r = []; for (let j = 0; j < n; j++) { const a = lerp(a0, a1, j / (n - (a0 === 0 && a1 === TAU ? 0 : 1))); r.push([cx + Math.sin(a) * (hw + grow), y, z + Math.cos(a) * (hd + grow)]); } return r; };
    const st = [[.50, -.455, .185, .125], [.60, -.46, .18, .12], [.72, -.455, .185, .118], [.86, -.445, .20, .115], [.96, -.435, .21, .10], [1.01, -.43, .19, .075]];
    k.geo(m.tee, loft(st.map(s => ring(s[0], s[1], s[2], s[3], 20, 0, TAU, 0)), { uvScale: 4 }));
    /* H5: no jacket over the tee any more (the hero's default look) */
    // belt + buckle
    k.geo(m.leatherB, loft([.535, .57].map(y => ring(y, -.455, .187, .127, 20, 0, TAU, .002)), {}));
    k.geo(m.gold, plate(rrect(.05, .036, .006), [{ pts: rrect(.034, .02, .003) }], .004, .0012), { x: cx, y: .553, z: -.324 });
    // lap belt
    k.geo(m.belt, loft([[cx + .25, .50, -.47], [cx + .19, .60, -.37], [cx + .09, .665, -.33], [cx - .05, .668, -.33], [cx - .16, .62, -.355], [cx - .235, .52, -.41]].map(p => [[p[0], p[1], p[2] - .022], [p[0], p[1] + .004, p[2] + .022]]), { closed: false, face: [0, 1, .4] }));
    k.pop();
  }
  /** rigid sleeve pieces, built along +Z from the joint (0) to length L */
  function buildSleeve(m, kind) {
    const k = GT.kit(), rnd = GT.rng('sleeve' + kind);
    /* H5: the driver wears the hero's default short-sleeved T-shirt now: the forearm is bare skin from the elbow to where the hand mesh's own forearm takes over (.107 m along, this
       piece ends just inside it), the upper arm is bare below a short, loose grey sleeve */
    const ballS = r => lathe(Array.from({ length: 9 }, (_, i) => [Math.max(.0001, Math.sin(i / 8 * PI) * r), -Math.cos(i / 8 * PI) * r]), 14, { uvRect: SK.ARM });
    if (kind === 'fore') { const L = .125, rings = []; for (let i = 0; i <= 10; i++) { const t = i / 10, z = t * L, rx = plin(t, [0, .35, 1], [.0395, .0415, .0352]), ry = plin(t, [0, .35, 1], [.035, .0352, .0288]); const r = []; for (let j = 0; j < 20; j++) { const a = j / 20 * TAU; r.push([Math.cos(a) * rx, Math.sin(a) * ry, z]); } rings.push(r); }
      k.geo(m.skinArm, loft(rings, { cap0: true, uvRect: SK.ARM })); k.geo(m.skinArm, ballS(.0372), {});
    } else { const L = .31, rings = []; for (let i = 0; i <= 12; i++) { const t = i / 12, z = t * L, rr = lerp(.046, .039, t) + .004 * bump(t, .42, .22); const r = []; for (let j = 0; j < 18; j++) { const a = j / 18 * TAU; r.push([Math.cos(a) * rr, Math.sin(a) * rr, z]); } rings.push(r); }
      k.geo(m.skinArm, loft(rings, { cap1: true, uvRect: SK.ARM })); k.geo(m.skinArm, ballS(.039), { z: L });
      const sl = []; for (let i = 0; i <= 7; i++) { const t = i / 7, z = t * .125, rr = lerp(.061, .0575, t); const r = []; for (let j = 0; j < 18; j++) { const a = j / 18 * TAU, fold = .0025 * Math.sin(a * 3 + t * 5) * sst(t, .2, 1); r.push([Math.cos(a) * (rr + fold), Math.sin(a) * (rr + fold), z]); } sl.push(r); }
      k.geo(m.tee, loft(sl, { cap0: true, uvScale: 3 })); k.geo(m.tee, loft([sl[7].map(p => [p[0] * .97, p[1] * .97, p[2]]), sl[7].map(p => [p[0] * .8, p[1] * .8, p[2] - .006])], { uvScale: 3, inward: true }));   /* hem: the sleeve's inner face */
      const ball = r => lathe(Array.from({ length: 9 }, (_, i) => [Math.max(.0001, Math.sin(i / 8 * PI) * r), -Math.cos(i / 8 * PI) * r]), 14, { uvScale: 3 }); k.geo(m.tee, ball(.063), {}); }
    return k.build();
  }
  function buildWatch(m) {
    const k = GT.kit(), a = .0298, b = .0204;      // strap ellipse (forearm section at the wrist)
    const strap = []; for (let i = 0; i <= 1; i++) { const r = []; for (let j = 0; j < 28; j++) { const an = j / 28 * TAU; r.push([Math.sin(an) * (a + .0009), -Math.cos(an) * (b + .0009), (i - .5) * .019]); } strap.push(r); }
    const outer = strap.map(r => r.map(p => [p[0] * 1.07, p[1] * 1.085, p[2]]));
    k.geo(m.leatherB, loft([strap[0], outer[0], outer[1], strap[1]], {}));
    // case on the back of the wrist (+Y), crown towards the hand
    k.push(0, b + .003, 0);
    k.geo(m.chrome, lathe([[.0165, 0], [.0185, .002], [.0192, .006], [.018, .0085], [.0165, .0092]], 32), {});
    k.geo(m.chrome, lathe([[.0165, .0092], [.0172, .0098], [.016, .011], [.0148, .0108]], 32), {});
    k.geo(m.watchFace, disc(.0149, 32, [0, 0, 1, 1]), { y: .0101, rx: -PI / 2 });
    k.geo(m.chrome, lathe([[.003, 0], [.0032, .004], [.0001, .0045]], 10), { z: .0195, y: .0045, rx: PI / 2 });
    for (const s of [1, -1]) k.box(m.chrome, .02, .005, .006, 0, .004, s * .0185 * 0 + 0, { bevel: .001, ry: 0 });
    k.box(m.chrome, .008, .004, .012, .0, -2 * b - .0035, 0, { bevel: .001 });       // buckle under the wrist
    k.pop();
    return k.build({ cast: false });
  }
  function watchFaceTex() { if (TX.watch) return TX.watch; const S = 256, c = canvas(S, S), g = c.getContext('2d'); const gr = g.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2); gr.addColorStop(0, '#16324a'); gr.addColorStop(1, '#07121c'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2); for (let i = 0; i < 60; i++) { g.save(); g.rotate(i / 60 * TAU); g.fillStyle = '#e9e4d2'; if (i % 5 === 0) g.fillRect(-4, -S * .46, 8, 26); else g.fillRect(-1, -S * .46, 2, 9); g.restore(); }
    g.fillStyle = '#e9e4d2'; g.font = `700 20px ${FONT}`; g.textAlign = 'center'; g.fillText('MAREA', 0, -34); g.font = `600 11px ${FONT}`; g.fillText('AUTOMATIC  200m', 0, 52);
    const hand = (a, l, w) => { g.save(); g.rotate(a); g.fillStyle = '#f2efe4'; g.fillRect(-w / 2, -l, w, l + 10); g.restore(); }; hand(5.35, 62, 9); hand(.95, 92, 6); g.fillStyle = '#d8502c'; g.save(); g.rotate(3.4); g.fillRect(-1.5, -100, 3, 124); g.restore(); g.fillStyle = '#ccc'; g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill();
    return TX.watch = ctex(c); }

  /* ================================================================== glass dust layers (additive; catch the low sun) */
  const dustU = { uSun: { value: V3(-1, .2, 0).normalize() }, uSunCol: { value: new T.Color(1, .7, .4) }, uSky: { value: new T.Color(.3, .4, .5) } };
  function dustMat(k, rep) {
    return new T.ShaderMaterial({ uniforms: { tDust: { value: dustTex() }, uSun: dustU.uSun, uSunCol: dustU.uSunCol, uSky: dustU.uSky, uK: { value: k }, uRep: { value: rep || new T.Vector4(1, 1, 0, 0) } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; uniform vec4 uRep; void main(){ vUv = uv * uRep.xy + uRep.zw; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform sampler2D tDust; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform float uK; varying vec2 vUv; varying vec3 vW;
        void main(){ float d = texture2D(tDust, vUv).r; d = d * d * 1.6 + d * 0.25; vec3 v = normalize(vW - cameraPosition); float c = max(dot(v, uSun), 0.0);
          float fwd = pow(c, 4.0) * 0.55 + pow(c, 24.0) * 1.6 + pow(c, 160.0) * 5.0;
          vec3 col = d * (uSunCol * (0.035 + fwd) * uK + uSky * 0.05 * uK);
          gl_FragColor = vec4(col, 1.0); }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false });
  }

  /* ================================================================== interior-only exterior stand-in (used when GT.vehicles is missing) */
  const HZ = -.105;
  const hoodY = (x, z0) => { const z = z0 - HZ, ax = Math.abs(x), base = lerp(.905, .80, sst(z, .9, 2.45)) + .056 * (1 - Math.pow(Math.min(ax / .8, 1), 2)) * (1 - sst(z, .9, 2.4) * .5), bw = lerp(.30, .21, sst(z, .95, 2.3)), bh = .046 * sst(z, .84, 1.0) * (1 - sst(z, 2.02, 2.36));
    return base + .010 * bump(ax, .70, .05) - .09 * sst(ax, .80, .87) + bh * (1 - sst(ax, bw - .075, bw)) - .05 * sst(z, 2.3, 2.47); };
  function buildExterior(opts) {
    const k = GT.kit(), paint = GT.mat('car_paint', { color: opts.color !== undefined ? opts.color : 0x720f0c }), black = GT.mat('metal_dark', { color: 0x0b0b0c, rough: .55 }), chrome = GT.mat('chrome'), rubber = GT.mat('rubber'), glass = GT.mat('glass_clear'), tint = GT.mat('glass_tint');
    const z0 = .845 + HZ, z1 = 2.47 + HZ;
    // hood with power bulge + twin matte stripes
    { const rings = []; for (let i = 0; i <= 40; i++) { const z = lerp(z0 - .1, z1, i / 40), r = []; for (let j = 0; j <= 40; j++) { const x = lerp(-.90, .90, j / 40); r.push([x, hoodY(x, z), z]); } rings.push(r); } k.geo(paint, loft(rings, { closed: false, face: [0, 1, 0] })); }
    for (const sx of [1, -1]) { const rings = []; for (let i = 0; i <= 30; i++) { const z = lerp(z0 + .015, z1 - .03, i / 30), r = []; for (let j = 0; j <= 4; j++) { const x = sx * lerp(.035, .15, j / 4); r.push([x, hoodY(x, z) + .0012, z]); } rings.push(r); } k.geo(black, loft(rings, { closed: false, face: [0, 1, 0] })); }
    // hood pins with lanyards
    for (const sx of [1, -1]) { const x = sx * .52, z = 2.16 + HZ, y = hoodY(x, z); k.geo(chrome, lathe([[.019, 0], [.019, .002], [.012, .004], [.0001, .0045]], 18), { x, y, z }); k.cyl(chrome, .0035, .0035, .03, x, y + .017, z, { seg: 8 }); k.geo(chrome, torus(.008, .0012, 14, 5), { x: x + .006, y: y + .024, z, rx: PI / 2, rz: .4 });
      k.tube(black, [[x + .012, y + .024, z], [x + sx * .05, y + .006, z + .03], [x + sx * .09, hoodY(x + sx * .09, z + .08) + .003, z + .08]], .0012, { seg: 4 }); }
    // wipers parked along the glass base
    for (const pu of [.70, .36]) { const a = wsPoint(pu, 0, -.02), b = wsPoint(pu - .30, .03, -.02); k.geo(chrome, lathe([[.011, 0], [.009, .008], [.004, .012]], 12), { x: a[0], y: a[1] - .004, z: a[2] + .03 }); k.tube(chrome, [[a[0], a[1] + .008, a[2] + .03], [lerp(a[0], b[0], .5), a[1] + .012, lerp(a[2], b[2], .5) + .022], [b[0], b[1] + .01, b[2] + .012]], .0032, { seg: 6 });
      k.tube(rubber, [[a[0] - .04, a[1] + .004, a[2] + .016], [b[0] - .06, b[1] + .004, b[2] + .008]], .005, { seg: 5 }); }
    // windshield outer glass + roof skin + pillars (shadow casters)
    k.geo(glass, loft(wsGrid(16, 8, -.006), { closed: false, face: [0, .6, 1] }));
    { const rings = []; for (let i = 0; i <= 16; i++) { const z = lerp(.16, -.74, i / 16), r = []; for (let j = 0; j <= 12; j++) { const x = lerp(-.67, .67, j / 12); r.push([x, roofY(x, cl(z, -.72, .12)) + .028 - .03 * Math.pow(x / .67, 6), z]); } rings.push(r); } k.geo(paint, loft(rings, { closed: false, face: [0, 1, 0] })); }
    for (const sx of [1, -1]) {
      const a = wsPoint(sx > 0 ? 1 : 0, 0), b = wsPoint(sx > 0 ? 1 : 0, 1); k.geo(paint, tubeR([[a[0] + sx * .034, a[1] - .02, a[2]], [b[0] + sx * .034, b[1] + .01, b[2]]], .02, 8));
      k.geo(paint, tubeR([[sx * .66, roofY(.62, .1) - .01, .1], [sx * .665, roofY(.62, -.3) - .012, -.3], [sx * .655, roofY(.62, -.6) - .014, -.6]], .03, 8));                                    // roof rail
      k.geo(paint, loft([[0, 0], [1, 0], [1, 1], [0, 1]].map(q => { const y = lerp(BELT + .01, CANT + .01, q[1]), zf = cLine(y), zr = lerp(-1.88, -.70, hOf(y)); return [sx * (sideX(y) + .03), y, lerp(zf, zr, q[0])]; }).reduce((acc, p, i, arr) => { if (i % 2 === 0) acc.push([arr[i], arr[i + 1]]); return acc; }, []).map(pr => [pr[0], pr[1]]), { closed: false, face: [sx, 0, 0] }));   // C pillar skin
      // door + fender shoulders with a chrome belt moulding
      { const rings = []; for (let i = 0; i <= 20; i++) { const z = lerp(.80, -2.36, i / 20), w = .93 - .04 * sst(z, -1.6, -2.36); rings.push([[sx * .80, BELT - .002, z], [sx * .83, BELT - .004, z], [sx * (w - .03), BELT - .012, z], [sx * w, BELT - .06, z], [sx * (w + .01), .55, z], [sx * (w - .03), .24, z]]); } k.geo(paint, loft(rings, { closed: false, face: [sx, .3, 0] })); }
      k.box(chrome, .012, .008, 3.1, sx * .806, BELT + .004, -.78, { bevel: .003 });
      // side glass (door + quarter)
      const pane = (fa, fb) => k.geo(glass, loft([BELT, CANT].map(y => [[sx * (sideX(y) + .008), y, fa(y)], [sx * (sideX(y) + .008), y, fb(y)]]), { closed: false, face: [sx, 0, 0] }));
      pane(aLine, bLine); pane(bLine, cLine);
      // door mirror (driver side)
      if (sx > 0) { k.push(.905, BELT + .07, .40, { ry: .32 }); k.tube(chrome, [[-.07, -.06, .0], [-.03, -.035, .0], [0, -.012, 0]], .006, { seg: 8 }); k.geo(chrome, lathe([[.0001, .034], [.03, .03], [.047, .016], [.05, 0]], 24), { rx: PI / 2, z: .0, s: [1.25, 1, 1] }); k.pop(); }
    }
    // rear deck + backlight
    { const rings = []; for (let i = 0; i <= 8; i++) { const z = lerp(-1.84, -2.36, i / 8), r = []; for (let j = 0; j <= 12; j++) { const x = lerp(-.88, .88, j / 12); r.push([x, .905 - .03 * Math.pow(x / .88, 2) - .03 * sst(z, -2.2, -2.36), z]); } rings.push(r); } k.geo(paint, loft(rings, { closed: false, face: [0, 1, 0] })); }
    k.geo(tint, loft([[[-.56, 1.18, -.70], [.56, 1.18, -.70]], [[-.73, .89, -1.87], [.73, .89, -1.87]]], { closed: false, face: [0, .6, -1] }));
    // under-body slab (keeps daylight from leaking up through nothing)
    k.box(black, 1.8, .04, 4.7, 0, .22, 0);
    const g = k.build(); g.name = 'cockpit_standin'; return g;
  }
  function buildSideMirrorGlass(mats) { const g = disc(.044, 24); g.scale(1.25, 1, 1); const mesh = new T.Mesh(g, mats.mirrorSide); mesh.position.set(.905, BELT + .07, .40); mesh.rotation.set(0, .32 + PI, 0, 'YXZ'); mesh.translateZ(.0005); return mesh; }

  /* Hide another module's low-detail interior where this cockpit sits. Non-destructive: the host mesh gets a re-ordered index (kept triangles first)
     and a draw range that follows this cockpit's visibility, so the car still has its own interior when seen from outside with the cockpit hidden.
     Vertices are tested in cockpit space. Returns what restore needs. */
  function stripInterior(root, self) {
    const saved = [], inv = new T.Matrix4().copy(self.matrix).invert(), v = V3(), cnv = /^cnv_/.test(root.name || ''), need = cnv ? 2 : 3;   /* GT.cnvehicles interiors are coarse: a triangle with two corners in the cabin is cabin trim, and leaving it draws torn shards beside the A pillar */
    const taxi = /^cnv_taxi/.test(root.name || '');   /* the taxi keeps its fare meter and its vacant-sign LED, which sit on / above this cockpit's dash pad */
    const inside = () => { const ax = Math.abs(v.x), y = v.y, z = v.z; if (y < .285 || y > 1.185) return false; if (taxi && ((Math.abs(v.x + .01) < .11 && y > .77 && y < .92 && z > .30 && z < .46) || (Math.abs(v.x + .31) < .12 && y > .81 && y < .93 && z > .50 && z < .62))) return false; if (ax > Math.min(.748, sideX(y) - .03)) return false;
      const zf = y < WS.by ? .60 : lerp(WS.bz, WS.tz, cl((y - WS.by) / (WS.ty - WS.by), 0, 1)) - .06, zr = y < .885 ? -1.64 : lerp(-1.86, -.70, cl((y - .885) / (1.19 - .885), 0, 1)) + .07; return z < zf && z > zr; };
    /* 月湾 r2: a long thin host part that runs right through the cabin (the muscle car's twin bonnet-to-boot stripes, 3.6 m boxes at belt height) has no corner inside it, so the corner test kept it
       and it hung in front of the driver as a black slab over the dash and the bonnet. Triangles with an edge over a metre are also sampled along their surface; one sample in the cabin cuts them. */
    const qa = V3(), qb = V3(), qc = V3(), longIn = (P, a, b, c) => { qa.fromBufferAttribute(P, a).applyMatrix4(inv); qb.fromBufferAttribute(P, b).applyMatrix4(inv); qc.fromBufferAttribute(P, c).applyMatrix4(inv); if (Math.max(qa.distanceTo(qb), qb.distanceTo(qc), qc.distanceTo(qa)) < 1) return false;
      for (let s = 1; s < 8; s++) for (let t = 0; t <= 8 - s; t++) { const u = s / 8, w = t / 8; v.set(0, 0, 0).addScaledVector(qa, 1 - u - w).addScaledVector(qb, u).addScaledVector(qc, w); if (inside()) return true; } return false; };
    for (const o of root.children) { if (o === self || !o.isMesh || !o.geometry || !o.geometry.index || o.position.lengthSq() > 1e-8) continue; const nm = (o.name || '') + ' ' + ((o.material && o.material.name) || '');
      /* GT.cnvehicles hosts: their whole greenhouse (pillars, roof, glazing, liner) is hidden too, because this cockpit brings its own shell and the two never line up (double A pillars, the host roof poking through the headliner) */
      const gh = cnv && o.geometry.userData ? o.geometry.userData.gtGh : null, allCut = cnv && /glass/i.test(nm), skip = /paint|glass|fx|wheel|tyre|tire/i.test(nm);
      if (skip && !gh && !allCut) continue;
      const P = o.geometry.attributes.position, ix = o.geometry.index.array, keep = [], cut = [];
      const inGh = i => { if (gh) for (let q = 0; q < gh.length; q += 2) if (i >= gh[q] && i < gh[q + 1]) return true; return false; };
      const kp = cnv && o.geometry.userData ? o.geometry.userData.gtKeep : null, inKp = i => { if (kp) for (let q = 0; q < kp.length; q += 2) if (i >= kp[q] && i < kp[q + 1]) return true; return false; };   /* CAR r1: an open car's own windscreen frame (js/cnvehicles.js openTop) is never cut, though it reaches into this cabin */
      for (let i = 0; i < ix.length; i += 3) { if (inKp(i)) { keep.push(ix[i], ix[i + 1], ix[i + 2]); continue; } if (allCut || inGh(i)) { cut.push(ix[i], ix[i + 1], ix[i + 2]); continue; } if (skip) { keep.push(ix[i], ix[i + 1], ix[i + 2]); continue; } let nin = 0; for (let k = 0; k < 3; k++) { v.fromBufferAttribute(P, ix[i + k]).applyMatrix4(inv); if (inside()) nin++; }
        if (nin < need && cnv && longIn(P, ix[i], ix[i + 1], ix[i + 2])) nin = need; (nin >= need ? cut : keep).push(ix[i], ix[i + 1], ix[i + 2]); }
      if (!cut.length) continue;
      const g = o.geometry.clone(), n = keep.length; g.setIndex(keep.concat(cut)); g.setDrawRange(0, n);
      const prev = Object.prototype.hasOwnProperty.call(o, 'onBeforeRender') ? o.onBeforeRender : null;
      o.onBeforeRender = function () { const want = self.visible && self.parent === root ? n : Infinity; if (g.drawRange.count !== want) g.setDrawRange(0, want); if (prev) prev.apply(this, arguments); };
      saved.push({ o, geo: o.geometry, prev }); o.geometry = g; }
    return saved;
  }
  function restoreInterior(saved) { for (const q of saved) { q.o.geometry = q.geo; if (q.prev) q.o.onBeforeRender = q.prev; else delete q.o.onBeforeRender; } }

  const STRIP_ON = !/[?&]ckstrip=0/.test((typeof location !== 'undefined' && location.search) || '');   /* ?ckstrip=0: leave the host car's own greenhouse and interior drawn (debug) */
  /* ================================================================== materials for one cockpit */
  function makeMats(opts) {
    const A = labelAtlas(), G = gaugeAtlas(), P = propsAtlas(), S = skinAtlas(), m = {};
    m.vinyl = M('dash_vinyl', { color: 0x2b2824 }, { env: .4 });   /* warm charcoal, and less sky mirror: the pad used to read as a navy slab */ m.plastic = M('plastic_black'); m.plasticGloss = M('plastic_black', { rough: .22 }); m.plasticRed = M('plastic_red');
    m.tunnel = M('plastic_black', { color: 0x040404, rough: .95 });
    m.leatherB = M('leather_black'); m.tan = M('leather_tan', opts.leather !== undefined ? { color: opts.leather } : undefined); m.tanDark = M('leather_tan', { color: 0x5a3a23 });
    m.carpet = M('carpet');
    m.chrome = M('chrome'); m.alu = M('aluminium_brushed'); m.aluPanel = M('aluminium_brushed', { metal: .45, rough: .42 }); m.gold = M('chrome', { color: 0xc8a75a });
    m.metalDark = M('metal_dark'); m.rubber = M('rubber');
    m.headliner = M('dash_vinyl', { color: 0xc9c1ab, rough: .85 }); m.trim = M('dash_vinyl', { color: 0x6e6a61, rough: .9 });   /* A pillar + header trim: its own material so each host car can colour it */
    m.thread = M('plastic_white', { color: 0xcdb98e, rough: .8 }); m.threadDark = M('plastic_white', { color: 0x4a4a4c, rough: .8 });
    m.belt = M('fabric_dark', { color: 0x16181a }); m.denim = M('fabric_dark', { color: 0x1f2839 }); m.jacket = M('fabric_dark', { color: 0x3b516c }); m.lining = M('fabric_dark', { color: 0x8493a6 }); m.tee = M('fabric_dark', { color: 0xc3c6c6, rough: .95 });   /* H5: light grey T-shirt, dark jeans */
    m.ivory = M('plastic_white', { color: 0xe6dec6, rough: .18 }); m.lens = m.ivory; m.paper = M('plastic_white', { color: 0xe2dccb, rough: .7 });
    m.glass = cabStd({ color: new T.Color(0, 0, 0), roughness: .03, metalness: 0, transparent: true, opacity: .16, depthWrite: false, envMapIntensity: 2.2 }, .45); m.glassTint = GT.mat('glass_tint');
    const sp = perfTex('speaker'); sp.repeat.set(7, 7); m.speaker = cabStd({ map: sp, metalness: .85, roughness: .42 });
    m.wood = cabPatch(new T.MeshPhysicalMaterial({ map: woodTex(), roughness: .34, metalness: 0, clearcoat: 1, clearcoatRoughness: .07 }), null, .7);
    m.gaugeFace = cabStd({ color: new T.Color(2.4, 2.4, 2.4), map: G.face, emissiveMap: G.glow, emissive: new T.Color(1, 1, 1), emissiveIntensity: 0, roughness: .62, metalness: 0 }, .3);
    m.label = cabStd({ map: A.face, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: .45, metalness: .1 });
    m.labelGlow = cabStd({ map: A.face, emissiveMap: A.glow, emissive: new T.Color(1, 1, 1), emissiveIntensity: 0, roughness: .5, metalness: 0 }, .3);
    m.print = cabStd({ map: P.tex, roughness: .78, metalness: 0, side: T.DoubleSide });
    m.skin = cabStd({ vertexColors: true, map: S.map, normalMap: S.normal, normalScale: new T.Vector2(1.25, 1.25), roughnessMap: S.rough, roughness: 1, metalness: 0 }, .5);
    m.sneaker = M('plastic_white', { color: 0xe4e2dc, rough: .72 });   /* H5: white trainers */
    m.skinArm = cabStd({ map: S.map, normalMap: S.normal, normalScale: new T.Vector2(1.25, 1.25), roughnessMap: S.rough, roughness: 1, metalness: 0 }, .5);   /* H5: the bare arm pieces (no per-vertex shading attribute) */
    m.nail = cabStd({ vertexColors: true, roughness: .26, metalness: 0 }, .7);
    m.watchFace = cabStd({ map: watchFaceTex(), roughness: .35, metalness: .2 });
    m.needle = cabStd({ color: GT.C(0xe2501c), emissive: new T.Color(1, .28, .06), emissiveIntensity: 0, roughness: .5, metalness: 0 });
    m.needleW = cabStd({ color: GT.C(0xe8e2cc), emissive: new T.Color(.5, 1, .75), emissiveIntensity: 0, roughness: .5, metalness: 0 });
    m.mirrorSide = rearMat(.12) || cabStd({ color: new T.Color(.75, .78, .8), roughness: .02, metalness: 1 }, 1);
    return m;
  }

  /* ================================================================== build + update */
  const HOME = { R: 58 * D2R, L: -58 * D2R }, LIM = { R: [10 * D2R, 140 * D2R], L: [-140 * D2R, -10 * D2R] }, MAXANG = 205 * D2R;
  const GRIP_C = [.001, -.0305, .0915], GRIP_ALPHA = -.80, RIM_RHO = WHEEL.r + .0112;
  const KNOB_C = [.002, -.036, .070], KNOB_RHO = .0245 + .0085;
  const OPEN = [[.22, .38, .22], [.26, .42, .25], [.3, .46, .26], [.34, .5, .28]];
  const TH = {  // thumb bone directions (metacarpal, proximal, distal) + nail normal reference, right-hand local
    grip: { d: [[.80, -.44, .40], [.60, -.50, .62], [.22, -.50, .84]], n: [.55, .25, -.80] },
    open: { d: [[.72, -.30, .62], [.74, -.16, .65], [.74, -.10, .66]], n: [.3, .8, -.5] },
    knob: { d: [[.78, -.42, .46], [.55, -.62, .56], [.25, -.75, .61]], n: [.75, .35, -.55] } };
  const _m1 = new T.Matrix4(), _m2 = new T.Matrix4(), _m3 = new T.Matrix4(), _q1 = new T.Quaternion(), _q2 = new T.Quaternion(), _p1 = V3(), _p2 = V3(), _s1 = V3(), _v1 = V3(), _v2 = V3(), _v3 = V3();
  function orient(obj, from, to, up) { const z = _v1.copy(to).sub(from).normalize(), x = _v2.copy(up).cross(z).normalize(), y = _v3.copy(z).cross(x); _m3.makeBasis(x, y, z); obj.quaternion.setFromRotationMatrix(_m3); obj.position.copy(from); }

  /* ================================================================== per-vehicle dress
     One cabin serves every car; what lies on the dash, hangs from the mirror and glows at night is built per kind (once, on first use) and shown only in that car:
       taxi      ride-hail phone on a suction mount, dash cam, a red knot on the mirror stem, a blue charger lamp
       van       tissue box, a slipping pile of flyers, a steel flask, three inspection stickers inside the screen, the knot
       police    dispatch terminal on a bracket, radio handset on a coiled lead, dash cam, a clipboard
       laotoule  a stuck-on LCD pod with three fat knobs, a clip fan, a rubber duck, the knot
       sports    the tuner's additions: twin boost gauges by the pillar and a shift-light bar
     All text on the screens is original. Screens are unlit emissive quads (dimmed at night by update()). */
  const KFONT = '"PingFang SC","Heiti SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif', KITS = { taxi: 1, van: 1, police: 1, laotoule: 1, sports: 1 };
  function buildKit(kind, m) { const g = new T.Group(); g.name = 'cockpit_kit_' + kind; g.userData.screens = []; const k = GT.kit(), RED = M('plastic_red'), GOLD = m.gold, TOP = .884;
    const screen = (w, h, cw, ch, draw) => { const c = canvas(cw, ch), q = c.getContext('2d'); q.textBaseline = 'middle'; draw(q, cw, ch); const mesh = new T.Mesh(rectQuad(w, h), new T.MeshBasicMaterial({ map: ctex(c), fog: false })); g.userData.screens.push(mesh.material); return mesh; };
    /* a slab that faces the driver (yaw worked out from where it stands), tipped back by rx, with an optional screen 1 mm proud of its face */
    const panel = (mat, w, h, d, x, y, z, rx, scr) => { const ry = Math.atan2(EYE.x - x, EYE.z - z), b = new T.Mesh(GT.boxGeo(w, h, d, Math.min(w, h, d) * .3), mat); b.position.set(x, y, z); b.rotation.set(rx, ry, 0, 'YXZ'); g.add(b); if (scr) { scr.rotation.copy(b.rotation); scr.position.set(x, y, z); scr.translateZ(d / 2 + .0012); g.add(scr); } return b; };
    const lamp = (x, y, z, col, r) => { const d = new T.Mesh(new T.SphereGeometry(r || .0035, 6, 4), new T.MeshBasicMaterial({ color: col, fog: false })); d.position.set(x, y, z); g.add(d); };
    const knot = (x, y, z) => { k.tube(RED, [[x, y, z], [x, y - .05, z]], .0014, { seg: 4 }); k.box(RED, .032, .032, .008, x, y - .07, z, { rz: PI / 4, bevel: .003 }); k.box(GOLD, .011, .011, .01, x, y - .07, z, { rz: PI / 4 }); k.box(RED, .016, .012, .01, x, y - .098, z, { bevel: .003 }); k.box(RED, .009, .07, .007, x, y - .14, z, { bevel: .002 }); };
    const dashCam = () => { k.box(m.plastic, .06, .034, .04, -.1, 1.13, .27, { bevel: .008 }); k.cyl(m.plasticGloss, .013, .013, .02, -.1, 1.13, .295, { rx: PI / 2 }); k.tube(m.rubber, [[-.1, 1.146, .26], [-.1, 1.172, .2]], .003, { seg: 4 }); lamp(-.078, 1.122, .249, new T.Color(1.6, .1, .06), .0028); };
    const ka = refs => [MIRROR.x - .02, MIRROR.y - .03, MIRROR.z + .02];
    if (kind === 'taxi') {
      k.cyl(m.plastic, .022, .027, .012, .12, TOP + .006, .5); k.tube(m.plastic, [[.12, TOP + .01, .5], [.12, TOP + .06, .49], [.12, TOP + .1, .474]], .006, { seg: 6 });
      panel(m.plasticGloss, .072, .146, .011, .12, TOP + .15, .466, -.22, screen(.063, .134, 216, 460, (q, w, h) => { q.fillStyle = '#081318'; q.fillRect(0, 0, w, h); q.fillStyle = '#12b3a0'; q.fillRect(0, 0, w, 58); q.fillStyle = '#04201c'; q.font = '900 30px ' + KFONT; q.textAlign = 'left'; q.fillText('江城打车', 12, 31); q.strokeStyle = '#1d3a44'; q.lineWidth = 10; for (const l of [[-10, 150, 230, 120], [-10, 300, 230, 262], [60, 60, 100, 400], [170, 60, 150, 400]]) { q.beginPath(); q.moveTo(l[0], l[1]); q.lineTo(l[2], l[3]); q.stroke(); }
        q.fillStyle = '#12e0c4'; q.beginPath(); q.arc(108, 214, 13, 0, TAU); q.fill(); q.fillStyle = '#e8f4f2'; q.textAlign = 'center'; q.font = '900 44px ' + KFONT; q.fillText('听单中', w / 2, 356); q.fillStyle = '#8fb0ac'; q.font = '700 22px ' + KFONT; q.fillText('今日 17 单 · ¥486', w / 2, 410); }));
      dashCam(); knot(MIRROR.x - .035, MIRROR.y - .03, MIRROR.z + .02); lamp(.12, .615, .335, new T.Color(.1, .5, 2.2), .004);
    } else if (kind === 'van') {
      k.box(M('plastic_white', { color: 0x6fae3e, rough: .7 }), .21, .075, .115, -.3, TOP + .037, .5, { ry: .22, bevel: .006 }); k.box(m.paper, .07, .04, .03, -.3, TOP + .09, .5, { ry: .22, rz: .2, bevel: .01 });
      for (let i = 0; i < 4; i++) k.box(i === 3 ? M('plastic_white', { color: 0xd8482a, rough: .7 }) : m.paper, .15, .0025, .21, -.02 - i * .012, TOP + .003 + i * .0028, .53 - i * .006, { ry: -.3 + i * .16 });
      k.cyl(m.alu, .034, .036, .19, -.55, TOP + .095, .49); k.cyl(RED, .03, .034, .035, -.55, TOP + .205, .49);
      for (let i = 0; i < 3; i++) { const p = wsPoint(.1 + i * .05, .84 - (i === 1 ? .05 : 0), .003); k.geo(M('plastic_white', { color: [0x2e8b4e, 0xd9a514, 0x2a66b8][i], rough: .5 }), new T.CircleGeometry(.024, 14), { x: p[0], y: p[1], z: p[2], rx: PI - .977 }); }
      knot(MIRROR.x - .035, MIRROR.y - .03, MIRROR.z + .02);
    } else if (kind === 'police') {
      k.tube(m.metalDark, [[-.1, TOP - .01, .47], [-.1, TOP + .05, .45], [-.1, TOP + .075, .43]], .008, { seg: 6 });
      panel(m.plastic, .2, .135, .028, -.1, TOP + .14, .42, -.2, screen(.18, .115, 360, 230, (q, w, h) => { q.fillStyle = '#06101e'; q.fillRect(0, 0, w, h); q.fillStyle = '#12589a'; q.fillRect(0, 0, w, 40); q.fillStyle = '#e8f0f8'; q.font = '900 24px ' + KFONT; q.textAlign = 'left'; q.fillText('POLICE DISPATCH', 12, 21); q.font = '700 20px ' + KFONT;
        [['UNIT', '3-ADAM-12'], ['BEAT', 'CHINATOWN N'], ['CALLS', '0'], ['STATUS', 'ON PATROL']].forEach((r, i) => { q.fillStyle = '#6f90b4'; q.fillText(r[0], 14, 70 + i * 38); q.fillStyle = i === 3 ? '#3fe08a' : '#e8f0f8'; q.fillText(r[1], 120, 70 + i * 38); }); q.strokeStyle = '#1c3552'; q.lineWidth = 2; for (let i = 0; i < 4; i++) { q.beginPath(); q.moveTo(10, 90 + i * 38); q.lineTo(w - 10, 90 + i * 38); q.stroke(); } }));
      k.box(m.plastic, .046, .095, .03, .09, TOP + .02, .5, { rx: -1.2, ry: .3, bevel: .008 }); k.tube(m.rubber, [[.09, TOP + .01, .46], [.06, TOP + .03, .44], [.04, TOP + .005, .47], [.01, TOP + .03, .45], [-.02, TOP + .0, .48]], .003, { seg: 4 });
      k.box(M('plastic_white', { color: 0x5a4a32, rough: .8 }), .16, .006, .22, -.42, TOP + .004, .52, { ry: .25 }); k.box(m.paper, .145, .003, .2, -.42, TOP + .009, .52, { ry: .25 }); k.box(m.chrome, .07, .01, .016, -.42, TOP + .012, .425, { ry: .25 });
      dashCam(); lamp(-.19, TOP + .083, .405, new T.Color(.1, 1.6, .4), .003);
    } else if (kind === 'laotoule') {
      k.box(M('plastic_white', { color: 0xf0c8d2, rough: .5 }), .15, .075, .05, .02, TOP + .04, .5, { bevel: .012, rx: .25 }); for (let i = 0; i < 3; i++) { k.cyl(m.ivory, .013, .015, .016, -.025 + i * .045, TOP + .027, .4626, { rx: .25 - PI / 2 }); k.cyl(m.chrome, .009, .009, .004, -.025 + i * .045, TOP + .0295, .4535, { rx: .25 - PI / 2 }); }   /* the pod leans back toward the driver's eyes (it leaned away and swallowed the top of its own screen) */
      { const sc = screen(.115, .04, 256, 90, (q, w, h) => { q.fillStyle = '#0a0508'; q.fillRect(0, 0, w, h); q.fillStyle = '#ff5fb0'; q.font = '900 62px ' + KFONT; q.textAlign = 'right'; q.fillText('18', 104, 48); q.font = '700 20px ' + KFONT; q.textAlign = 'left'; q.fillText('km/h', 110, 62); q.fillStyle = '#58e0a0'; for (let i = 0; i < 5; i++) { q.globalAlpha = i < 3 ? 1 : .25; q.fillRect(170 + i * 16, 22, 12, 22); } q.globalAlpha = 1; q.font = '700 18px ' + KFONT; q.fillText('电量 62%', 168, 66); }); sc.position.set(.02, TOP + .0582, .4773); sc.rotation.set(-.25, PI, 0, 'YXZ'); g.add(sc); }
      k.cyl(m.plastic, .012, .012, .07, -.42, TOP + .035, .52); k.geo(m.plastic, new T.TorusGeometry(.055, .006, 6, 18), { x: -.42, y: TOP + .12, z: .5 }); for (let i = 0; i < 3; i++) k.box(M('plastic_white', { color: 0x9fd4e8, rough: .4 }), .05, .018, .004, -.42, TOP + .12, .5, { rz: i * 2.094, bevel: .001 });
      k.sphere(M('plastic_white', { color: 0xf2c81a, rough: .4 }), .03, -.2, TOP + .028, .54, { s: [1, .85, 1.2] }); k.sphere(M('plastic_white', { color: 0xf2c81a, rough: .4 }), .02, -.2, TOP + .062, .525); k.box(M('plastic_white', { color: 0xe2681a, rough: .5 }), .014, .006, .016, -.2, TOP + .058, .505, { bevel: .002 });
      knot(MIRROR.x - .035, MIRROR.y - .03, MIRROR.z + .02);
    } else if (kind === 'sports') {
      for (let i = 0; i < 2; i++) { const x = .63 - i * .075, y = TOP + .05 + i * .004, z = .5; const ry = Math.atan2(EYE.x - x, EYE.z - z); k.cyl(m.plastic, .03, .026, .05, x, y, z + .012, { rx: PI / 2, ry: 0 }); k.cyl(m.plastic, .01, .014, .03, x, TOP + .012, z + .02);
        const sc = screen(.052, .052, 128, 128, (q, w, h) => { q.fillStyle = '#050507'; q.fillRect(0, 0, w, h); q.lineWidth = 9; q.strokeStyle = '#1a1c22'; q.beginPath(); q.arc(64, 64, 48, .75 * PI, 2.25 * PI); q.stroke(); q.strokeStyle = i ? '#3fe6ff' : '#ff3fae'; q.beginPath(); q.arc(64, 64, 48, .75 * PI, (i ? 1.55 : 1.85) * PI); q.stroke(); q.fillStyle = '#e8e8ee'; q.font = '900 30px ' + KFONT; q.textAlign = 'center'; q.fillText(i ? '14.2' : '0.8', 64, 62); q.font = '700 14px ' + KFONT; q.fillStyle = '#8a8c96'; q.fillText(i ? 'A/F' : 'BOOST', 64, 92); }); sc.position.set(x, y, z - .0135); sc.rotation.set(0, PI, 0, 'YXZ'); g.add(sc); }
      k.box(m.plastic, .09, .012, .014, DX, TOP + .078, .4, { bevel: .003 }); for (let i = 0; i < 5; i++) lamp(DX - .032 + i * .016, TOP + .078, .392, i < 3 ? new T.Color(.1, 1.2, .3) : i < 4 ? new T.Color(1.4, .8, .05) : new T.Color(1.6, .1, .05), .0032);
    }
    const st = k.build({ cast: false }); st.name = 'kit_static'; g.add(st); return g; }

  function build(opts) {
    opts = opts || {};
    const group = new T.Group(); group.name = 'cockpit';
    const m = makeMats(opts), refs = {}, K = GT.kit();
    const KR = GT.kit(); buildShell(K, m, KR); buildDoor(K, m, 1, KR); buildDoor(K, m, -1, KR); buildBucket(K, m, DX, m.tan); buildBucket(K, m, -DX, m.tan); buildRearSeat(K, m);
    buildDash(K, m, refs); buildConsole(K, m, refs); buildColumn(K, m, refs); buildMirror(KR, m, refs); const KP = GT.kit(); buildProps(KP, m); const props = KP.build({ cast: false }); props.name = 'cockpit_props';   /* loose things on the dash are their own object: a taxi has them, a sports car does not */
    if (opts.body !== false) buildBody(K, m);
    // static needle hub caps (rotation-invariant) are part of the static mesh
    const hubCap = (g, x, y, z, r) => { g.updateMatrix(); const p = V3(x, y, z).applyMatrix4(g.matrix); K.push(p.x, p.y, p.z, { ry: PI, rx: FACE.tilt }); K.geo(m.plasticGloss, lathe([[r, 0], [r, r * .35], [r * .7, r * .6], [.0001, r * .62]], 16), { rx: PI / 2 }); K.geo(m.chrome, lathe([[r * .3, r * .6], [.0001, r * .72]], 10), { rx: PI / 2 }); K.pop(); };
    const dep = .040, needles = {};
    for (const p of refs.pods) { const small = p.r < .04, py = small ? p.y - p.r * .25 * (116 / 128) : p.y, n = buildNeedle(m.needle, small ? p.r * .78 : p.r * .80, small ? .004 : .014, small ? .0011 : .0013);
      n.position.set(p.x, py, -dep + .0085); refs.faceGroup.add(n); needles[p.n] = n; hubCap(refs.faceGroup, p.x, py, -dep + .0095, small ? .0048 : .0078); }
    { const h = buildNeedle(m.needleW, .016, .004, .0014), mi = buildNeedle(m.needleW, .024, .005, .001); h.position.set(0, 0, .0042); mi.position.set(0, 0, .0052); refs.clockGroup.add(h, mi); needles.hour = h; needles.min = mi; hubCap(refs.clockGroup, 0, 0, .0058, .003); }
    const stat = K.build(); stat.name = 'cockpit_static'; group.add(stat, props, refs.faceGroup, refs.clockGroup, refs.stackGroup);
    const roofG = KR.build(); roofG.name = 'cockpit_roof'; group.add(roofG);   /* CAR r1: the fixed-roof parts on their own, hidden in an open car (host group userData.openTop, js/cnvehicles.js) */
    // tell-tale lamps
    const G = gaugeAtlas(), lampGeos = G.lamps.map((rect, i) => { const g = rectQuad(i < 2 ? .0115 : .0125, i < 2 ? .0092 : .0078, rect); g.translate([.0068, -.0068, 0, 0, 0][i], [.061, .061, -.049, -.058, -.067][i], .0066); g.setAttribute('color', new T.BufferAttribute(new Float32Array(12), 3)); return g; });
    const lampGeo = (() => { const P = [], U = [], I = []; lampGeos.forEach((g, i) => { P.push(...g.attributes.position.array); U.push(...g.attributes.uv.array); I.push(...Array.from(g.index.array).map(v => v + i * 4)); }); const g = finishGeo(P, U, I); g.setAttribute('color', new T.BufferAttribute(new Float32Array(60), 3)); return g; })();
    const lampMesh = new T.Mesh(lampGeo, new T.MeshBasicMaterial({ map: G.glow, vertexColors: true })); refs.faceGroup.add(lampMesh);
    const lampSet = (i, v) => { const c = lampGeo.attributes.color; if (c.getX(i * 4) !== v) { for (let k = 0; k < 4; k++) c.setXYZ(i * 4 + k, v, v, v); c.needsUpdate = true; } };
    // radio: tuner pointer + VFD
    const vfdC = canvas(384, 40), vfdT = ctex(vfdC), vfdMat = new T.MeshBasicMaterial({ map: vfdT }), vfd = new T.Mesh(rectQuad(.118, .0118), vfdMat); vfd.position.set(0, -.0085, .0014); refs.stackGroup.add(vfd);
    const pointer = new T.Mesh(GT.boxGeo(.0012, .0205, .0008, 0), new T.MeshBasicMaterial({ color: new T.Color(1.6, .16, .06) })); pointer.position.set(0, .0115, .0022); refs.stackGroup.add(pointer);
    // scanner display
    const scC = canvas(160, 28), scT = ctex(scC), scMat = new T.MeshBasicMaterial({ map: scT }), sc = new T.Mesh(rectQuad(.068, .0115), scMat); sc.position.copy(refs.scannerPos).add(V3(.01, .008 + .0006, -.0008)); sc.rotation.set(-.06, PI, 0, 'YXZ'); group.add(sc);
    // steering wheel
    const wheelRoot = new T.Group(); wheelRoot.position.set(WHEEL.x, WHEEL.y, WHEEL.z); wheelRoot.rotation.x = WHEEL.tilt; const wheel = buildWheel(m); wheelRoot.add(wheel); group.add(wheelRoot);
    const stalk = buildStalk(m); stalk.position.copy(refs.stalkPivot); stalk.rotation.x = WHEEL.tilt; group.add(stalk);
    // shifter, pedals
    const lever = buildShifter(m); lever.position.copy(refs.shiftPivot); group.add(lever);
    const prndPtr = new T.Mesh(GT.boxGeo(.004, .0016, .0035, .0005), new T.MeshBasicMaterial({ color: new T.Color(1.4, .2, .08) })); group.add(prndPtr);
    const gas = buildPedal(m, 'gas'); gas.position.set(.215, .665, .66); const brake = buildPedal(m, 'brake'); brake.position.set(.40, .665, .665); group.add(gas, brake);
    // keys + air freshener pendulums
    const keys = buildKeys(m); keys.position.copy(refs.keyAnchor); const fresh = buildFreshener(m); fresh.position.copy(refs.freshAnchor); fresh.scale.setScalar(.62); group.add(keys, fresh);
    // rear-view mirror glass
    const MR = refs.mirror, hasRT = !!(GT.render && GT.render.mirror && GT.render.mirror.texture);
    const mg = rectQuad(MR.w, MR.h, [1, 0, 0, 1]), mirrorMat = hasRT ? (rearMat(0, null, true) || new T.MeshBasicMaterial({ map: GT.render.mirror.texture, color: new T.Color(.86, .88, .9), fog: false })) : cabStd({ color: new T.Color(.05, .06, .07), roughness: .03, metalness: 1 }, 1);
    const mirrorGlass = new T.Mesh(mg, mirrorMat); mirrorGlass.position.copy(MR.pos); mirrorGlass.rotation.set(MR.rx, MR.ry, 0, 'YXZ'); mirrorGlass.translateZ(-.0035); group.add(mirrorGlass);
    // glass dust layers
    const dust = new T.Group(); dust.name = 'cockpit_dust';
    { const ws = new T.Mesh(loft(wsGrid(20, 10, .012), { closed: false, face: [0, -.6, -1], uvRect: [0, 0, 1, 1] }), dustMat(1.4)); ws.renderOrder = 5; ws.userData.roof = 1; dust.add(ws);
      for (const sx of [1, -1]) { const g = loft([BELT + .008, CANT - .004].map(y => [[sx * (sideX(y) - .004), y, aLine(y) - .01], [sx * (sideX(y) - .004), y, cLine(y) + .01]]), { closed: false, face: [-sx, 0, 0], uvRect: [0, 0, 1, 1] });
        const sd = new T.Mesh(g, dustMat(.55, new T.Vector4(.9, .55, sx > 0 ? .05 : .08, .3))); sd.renderOrder = 5; sd.userData.roof = 1; dust.add(sd); }
      const rg = loft([[[-.54, 1.165, -.735], [.54, 1.165, -.735]], [[-.70, .89, -1.82], [.70, .89, -1.82]]], { closed: false, face: [0, -.6, 1], uvRect: [0, 0, 1, 1] }); const rw = new T.Mesh(rg, dustMat(.5, new T.Vector4(.8, .5, .1, .4))); rw.renderOrder = 5; rw.userData.roof = 1; dust.add(rw); }
    group.add(dust);
    // rain wipers: two arms that sweep the outside of the windscreen while it rains. GT.render.visor.wiper (0 parked .. 1 top of the sweep) drives them; the same phase clears the drops on the glass (js/render.js). Parked = hidden, the host body shows its own
    const wipers = [];
    for (const pu of [.70, .36]) { const arm = new T.Group(); arm.name = 'rain_wiper'; arm.visible = false; arm.matrixAutoUpdate = false;
      const a1 = new T.Mesh(GT.boxGeo(1, .011, .006, .002), m.metalDark); a1.position.set(.5, 0, .016); const a2 = new T.Mesh(GT.boxGeo(.8, .016, .012, .003), m.rubber); a2.position.set(.59, 0, .006); const a3 = new T.Mesh(GT.boxGeo(.05, .022, .014, .004), m.metalDark); a3.position.set(.59, 0, .014);
      arm.add(a1, a2, a3); arm.userData.pu = pu; group.add(arm); wipers.push(arm); }
    const _wx = new T.Vector3(), _wy = new T.Vector3(), _wz = new T.Vector3();
    function wiperPose(k) { const on = k > .002; for (const arm of wipers) { arm.visible = on; if (!on) continue; const pu = arm.userData.pu, th = .04 + k * 1.38, a = wsPoint(pu, .02, -.014), b = wsPoint(pu - .31 * Math.cos(th), .05 + .76 * Math.sin(th), -.014);
        _wx.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = _wx.length() || 1e-3; _wx.multiplyScalar(1 / len); _wz.set(0, .83, .56); _wy.crossVectors(_wz, _wx).normalize(); _wz.crossVectors(_wx, _wy).normalize();
        arm.matrix.makeBasis(_wx.multiplyScalar(len), _wy, _wz).setPosition(a[0], a[1], a[2]); arm.matrixWorldNeedsUpdate = true; } }
    // exterior stand-in
    const useStandIn = opts.standIn !== undefined ? !!opts.standIn : !((GT.vehicles && GT.vehicles.make) || (GT.cnvehicles && GT.cnvehicles.make));   /* the China edition's GT.cnvehicles bodies are real exteriors too: never stack the red stand-in bonnet / pillars on top of them */
    let standIn = null; if (useStandIn) { standIn = buildExterior(opts); group.add(standIn); group.add(buildSideMirrorGlass(m)); }
    // hands + arms
    const hasHands = opts.hands !== false, HN = {};
    if (hasHands) for (const side of ['R', 'L']) { const mir = side === 'R' ? 1 : -1, H = makeHand(mir, m.skin, m.nail); group.add(H.mesh, H.nails);
      H.fore = buildSleeve(m, 'fore'); H.upper = buildSleeve(m, 'upper'); group.add(H.fore, H.upper);
      H.side = side; H.cab = HOME[side]; H.grip = HOME[side]; H.move = null; H.shoulder = V3(DX - mir * .2, .955, -.405); H.elbowP = V3();
      if (side === 'L') { H.watch = buildWatch(m); H.watch.matrixAutoUpdate = false; group.add(H.watch); }
      else { H.ring = new T.Mesh(torus(.0098, .0012, 20, 6), m.gold); H.ring.matrixAutoUpdate = false; H.ring.frustumCulled = false; group.add(H.ring); }
      HN[side] = H; }
    // night spill from the instruments onto hands / wheel
    const glowProxy = { emissiveIntensity: 0 }; GT.glow(glowProxy, new T.Color(1, 1, 1), 0, 1, 'emissiveIntensity');
    const spillPos = V3(DX - .02, .80, .27);
    const casters = new Set([m.vinyl, m.trim, m.tan, m.tanDark, m.headliner, m.carpet, m.plastic, m.leatherB, m.denim, m.jacket, m.tee, m.skinArm, m.wood, m.alu, m.aluPanel, m.belt, m.skin, m.lining, m.rubber, m.metalDark]);
    group.traverse(o => { if (!o.isMesh) return; if (o.material.isMeshBasicMaterial || o.material.isShaderMaterial) { o.castShadow = false; o.receiveShadow = false; } else if (o.parent !== standIn && !casters.has(o.material)) o.castShadow = false; });

    const st = { t: 0, first: true, mph: 0, krpm: .8, fuel: .6, temp: .5, psi: 0, psiV: 0, still: 0, glow: 0, gear: null, leverA: GEAR_ANG.P, leverFrom: GEAR_ANG.P, shift: null, sig: 0, lastSpeed: 0, acc: 0,
      host: null, saved: [], pend: { fx: 0, fz: 0, fvx: 0, fvz: 0, kx: 0, kz: 0, kvx: 0, kvz: 0 }, vfdKey: '', scKey: '', beat: 0, gasA: 0, brkA: 0 };
    const Wf = wheelFrame();

    function handWheelMatrix(out, H, cab, lift) {
      const mir = H.mir; out.copy(Wf); _m1.makeRotationZ(cab); out.multiply(_m1); _m1.makeTranslation(0, WHEEL.R, -lift * .03); out.multiply(_m1);
      _m1.makeRotationX(GRIP_ALPHA + lift * .22); out.multiply(_m1); _m1.makeRotationY(-mir * .10); out.multiply(_m1); _m1.makeTranslation(-GRIP_C[0] * mir, -GRIP_C[1], -GRIP_C[2]); out.multiply(_m1); return out;
    }
    const gripAngles = FINGERS.map((d, f) => wrapIK(d, GRIP_C[1] - d.y, GRIP_C[2] - d.z, RIM_RHO + (f === 3 ? .001 : 0)));
    const knobAngles = FINGERS.map((d, f) => wrapIK(d, KNOB_C[1] - d.y, KNOB_C[2] - d.z + (f - 1.5) * (f - 1.5) * .004, KNOB_RHO));
    function setPose(H, wGrip, wKnob, lift, tap) {
      const P = H.pose, open = cl(lift, 0, 1);
      for (let f = 0; f < 4; f++) { const g = gripAngles[f], kn = knobAngles[f], o = OPEN[f];
        for (let j = 0; j < 3; j++) { let a = lerp(g[j], kn[j], wKnob); a = lerp(a, o[j], open * .75); P.fin[f][j] = a; }
        if (tap && f === 0) { P.fin[f][0] -= tap * .30; P.fin[f][1] -= tap * .16; P.fin[f][2] -= tap * .06; } }
      P.spread = wKnob * .9 + open * .3; P.cup = 1 - open;
      for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) P.th[b][c] = lerp(lerp(TH.grip.d[b][c], TH.knob.d[b][c], wKnob), TH.open.d[b][c], open * .8);
      for (let c = 0; c < 3; c++) P.thN[c] = lerp(lerp(TH.grip.n[c], TH.knob.n[c], wKnob), TH.open.n[c], open * .8);
    }
    function solveArm(H, breathe) {
      const mir = H.mir, Lu = .31, Lf = .272, S = _v1.copy(H.shoulder); S.y += breathe;
      const W = _v2.setFromMatrixPosition(H.matrix), d = W.distanceTo(S), maxd = Lu + Lf - .004;
      if (d > maxd) { S.lerp(W, (d - maxd) / d); }
      const dd = Math.min(d, maxd), a = (Lu * Lu - Lf * Lf + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, Lu * Lu - a * a));
      const dir = _v3.copy(W).sub(S).normalize(), pole = _p1.set(-mir * .55, -1, -.12); pole.sub(_p2.copy(dir).multiplyScalar(pole.dot(dir))).normalize();
      H.elbowP.copy(S).addScaledVector(dir, a).addScaledVector(pole, h); H.elbow.copy(H.elbowP);
      const up = _p2.set(0, 1, 0), Sc = S.clone(), Wc = W.clone(); orient(H.upper, Sc, H.elbowP, up); orient(H.fore, H.elbowP, Wc, up);
    }

    /* one cockpit serves every car: recolour the trim per host so a taxi and a sports car do not share a cabin */
    const C = GT.C || (h => new T.Color(h).convertSRGBToLinear());
    const kits = {};
    function applyTheme(kind) {
      const sp = kind === 'sports', th = sp ? { seat: 0x2a2624, seatD: 0x121212, liner: 0x2b2b2e, trim: 0x1d1d1f, rim: .03, coat: .9, props: false } : { seat: 0x8a8d8e, seatD: 0x474a4d, liner: 0xb4b0a4, trim: 0x77736a, rim: .12, coat: .25, props: true };
      m.tan.color.copy(C(th.seat)); m.tanDark.color.copy(C(th.seatD)); m.headliner.color.copy(C(th.liner)); m.trim.color.copy(C(th.trim)); m.wood.color.setScalar(th.rim); m.wood.clearcoat = th.coat; props.visible = th.props; fresh.visible = th.props;
    }
    /** what lies on the dash differs per car: show this kind's dress (built on first use); the loose props of the as-built cabin (map, sunglasses, cup, palm freshener) stay only where no dress replaces them */
    function setKit(kind) { for (const kk in kits) kits[kk].visible = false; st.kit = null; if (KITS[kind]) { if (!kits[kind]) { try { kits[kind] = buildKit(kind, m); } catch (err) { console.warn('cockpit kit', kind, err); kits[kind] = new T.Group(); } group.add(kits[kind]); } kits[kind].visible = true; st.kit = kits[kind]; }
      const own = !!KITS[kind] && kind !== 'sports'; props.visible = !own; fresh.visible = !own; }
    /** re-dress the cabin for a vehicle kind ('taxi' | 'police' | 'van' | 'sports' | 'bus' | 'laotoule'; anything else = as built). update() calls it by itself when the cabin is moved into another car. */
    function setStyle(kind) { const tr = TRIMS[kind] || TRIMS.sports; st.style = TRIMS[kind] ? kind : 'sports'; st.glowC = tr.glow;
      const set = (mt, k) => { if (!mt || !mt.color) return; if (!mt.userData.gtBase) mt.userData.gtBase = mt.color.clone(); mt.color.copy(mt.userData.gtBase); mt.color.r *= k[0]; mt.color.g *= k[1]; mt.color.b *= k[2]; };
      set(m.tan, tr.seat); set(m.tanDark, tr.dark); set(m.headliner, tr.head); set(m.trim, tr.trim); set(m.vinyl, tr.dash); set(m.wood, tr.wood);
      const gm = Math.max(tr.glow[0], tr.glow[1], tr.glow[2]); if (m.gaugeFace.emissive) m.gaugeFace.emissive.setRGB(.55 + .45 * tr.glow[0] / gm, .55 + .45 * tr.glow[1] / gm, .55 + .45 * tr.glow[2] / gm); if (m.labelGlow.emissive) m.labelGlow.emissive.copy(m.gaugeFace.emissive);
      return st.style; }
    function update(dt, s) {
      { const hp = group.parent, open = !!(hp && hp.userData && hp.userData.openTop); if (open !== st.open) { st.open = open; roofG.visible = !open; mirrorGlass.visible = !open; for (const d of dust.children) if (d.userData.roof) d.visible = !open; } if (open) fresh.visible = false; }   /* CAR r1: open car = no headliner, cant rails, C pillars or side / rear glass dust over the driver */
      { const hp = group.parent; if (hp !== st.styleHost) { st.styleHost = hp; const hk = hp && /^cnv_/.test(hp.name || '') ? hp.name.slice(4) : (s && s.kind) || null; if (hk || st.style === undefined) { setStyle(hk); setKit(hk || ''); } } }   /* keeps its own host marker (st.styleHost): it used to take st.host, so the strip block below never ran and the host car drew its own A pillars, roof liner and glazing round this cockpit (the thick double pillar) */
      s = s || {}; dt = cl(dt || .016, .001, .05); st.t += dt; const first = st.first; st.first = false; const kf = r => first ? 1 : 1 - Math.exp(-dt * r);
      if (group.parent !== st.host) { restoreInterior(st.saved); st.saved = []; st.host = group.parent; if (st.host && opts.strip !== false && STRIP_ON && /^(car_|cnv_)/.test(st.host.name || '')) { group.updateMatrix(); st.saved = stripInterior(st.host, group); } }   /* the trim colours come from setStyle above (applyTheme is the older scheme and is not called any more) */
      group.updateWorldMatrix(true, false); cabU.uCabInv.value.copy(group.matrixWorld).invert();
      const env = GT.env || {}, night = Math.max(glowProxy.emissiveIntensity, s.night || 0), speed = s.speed || 0;
      { const nq = cl(s.night === undefined ? (env.night || 0) : s.night, 0, 1), q = lerp(1, .5, nq); for (const mt of [mirrorMat, m.mirrorSide]) if (mt && mt.uniforms && mt.uniforms.uTint) mt.uniforms.uTint.value.setRGB(.86 * q, .87 * q, .9 * q);   /* a mirror at night is a dim picture with lamps in it, not a second screen */
        if (st.kit && st.kit.userData.screens) for (const sm of st.kit.userData.screens) sm.color.setScalar(lerp(1.15, .62, nq)); }
      // ---- instruments
      st.mph += (Math.abs(speed) * 2.23694 - st.mph) * kf(7); const engOn = s.engineOn !== false, rpm = !engOn ? 0 : s.rpm === undefined ? .05 : s.rpm; st.krpm += ((engOn ? .72 + rpm * 5.5 : 0) - st.krpm) * kf(engOn ? 14 : 4);
      st.fuel += ((s.fuel === undefined ? .62 : s.fuel) - st.fuel) * kf(1.5); st.temp += ((s.temp === undefined ? .45 : s.temp) - st.temp) * kf(1.5);
      needles.speedo.rotation.z = -lerp(A0, A1, cl(st.mph / 140, 0, 1.02)); needles.tach.rotation.z = -lerp(A0, A1, cl((st.krpm + (engOn ? Math.sin(st.t * 61) * .012 * (1 + rpm * 2) : 0)) / 8, 0, 1.02));
      needles.fuel.rotation.z = -lerp(-SMALL_SWEEP, SMALL_SWEEP, cl(st.fuel, 0, 1)); needles.temp.rotation.z = -lerp(-SMALL_SWEEP, SMALL_SWEEP, cl(st.temp, 0, 1));
      const ck = /^(\d+):(\d+)/.exec(s.clock || '18:12'), hh = ck ? +ck[1] : 18, mm = ck ? +ck[2] : 12; needles.hour.rotation.z = -((hh % 12) + mm / 60) / 12 * TAU; needles.min.rotation.z = -mm / 60 * TAU;
      // lighting state
      const lightsOn = s.lights === undefined ? night > .12 : !!s.lights, gl = lightsOn ? lerp(.3, 1, night) : 0; st.glow += (gl - st.glow) * kf(6);
      m.gaugeFace.emissiveIntensity = st.glow * 1.9; m.labelGlow.emissiveIntensity = st.glow * 1.5; m.needle.emissiveIntensity = st.glow * 1.6; m.needleW.emissiveIntensity = st.glow * .9; { const gk = st.glow * night * 2.4; cabU.uGlowC.value.setRGB(st.glowC[0] * gk, st.glowC[1] * gk, st.glowC[2] * gk); const ak = night * 1.25; cabU.uCabAmb.value.setRGB(.62 * ak, .8 * ak, .86 * ak);   /* street light spilling into the cabin: the header and pillars stay readable at night instead of going pure black */ cabU.uGlowW.value.copy(spillPos).applyMatrix4(group.matrixWorld); }
      const blink = Math.sin(st.t * TAU * 1.45) > 0, dayK = lerp(2.6, 1.5, night);
      lampSet(0, s.signal === 'left' && blink ? dayK : 0); lampSet(1, s.signal === 'right' && blink ? dayK : 0); lampSet(2, s.highBeam ? dayK : 0); lampSet(3, (s.gear === 'P' || s.gear === undefined || s.handbrake > .5) ? dayK * .8 : 0); lampSet(4, (s.oilWarn && blink) || !engOn ? dayK : 0);
      st.sig += ((s.signal === 'left' ? 1 : s.signal === 'right' ? -1 : 0) - st.sig) * kf(18); stalk.rotation.z = -st.sig * .13;
      // radio display + tuner pointer
      const rOn = !!s.radioOn, rText = String(s.radioText || ''), vk = rOn + '|' + rText + '|' + (s.clock || '');
      if (vk !== st.vfdKey) { st.vfdKey = vk; const g = vfdC.getContext('2d'); g.fillStyle = '#020605'; g.fillRect(0, 0, 384, 40); g.fillStyle = 'rgba(40,255,200,.06)'; g.font = `700 30px Menlo, Consolas, monospace`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText('8888888888888', 8, 22); g.textAlign = 'right'; g.fillText('88:88', 378, 22);
        g.fillStyle = '#52ffd2'; g.shadowColor = '#52ffd2'; g.shadowBlur = 6; if (rOn) { g.textAlign = 'left'; g.fillText(rText.toUpperCase().slice(0, 13), 8, 22); } g.textAlign = 'right'; g.fillText(s.clock || '', 378, 22); g.shadowBlur = 0;
        g.fillStyle = 'rgba(0,0,0,.45)'; for (let y = 0; y < 40; y += 3) g.fillRect(0, y, 384, 1); for (let x = 0; x < 384; x += 3) g.fillRect(x, 0, 1, 40); vfdT.needsUpdate = true;
        let hsh = 7; for (const ch of rText) hsh = (hsh * 31 + ch.charCodeAt(0)) % 997; st.tune = rOn ? (hsh / 997 - .5) * .09 : st.tune || -.03; }
      pointer.position.x += ((st.tune || 0) - pointer.position.x) * kf(5); vfdMat.color.setScalar(lerp(2.4, 1.5, night));
      // scanner: 6 LEDs follow the wanted level, channel readout hops while hot
      const wanted = cl(Math.round(s.wanted || 0), 0, 6), hop = wanted > 0 ? Math.floor(st.t * (1.5 + wanted)) : 0, sk = wanted + '|' + hop;
      if (sk !== st.scKey) { st.scKey = sk; const g = scC.getContext('2d'); g.fillStyle = '#050302'; g.fillRect(0, 0, 160, 28); g.font = '700 19px Menlo, Consolas, monospace'; g.textBaseline = 'middle'; g.fillStyle = wanted ? '#ff5a2a' : '#5a1d0c';
        g.fillText(wanted ? ['460.325', '453.100', '460.050', '155.475', '453.875'][hop % 5] : '--- ---', 4, 15); for (let i = 0; i < 6; i++) { g.fillStyle = i < wanted ? (blink || i < wanted - 1 ? '#ff3018' : '#5a1208') : '#2a0a05'; g.beginPath(); g.arc(100 + i * 10, 14, 3.4, 0, TAU); g.fill(); } scT.needsUpdate = true; }
      scMat.color.setScalar(lerp(2.0, 1.3, night));
      // ---- pedals
      st.gasA += ((s.throttle || 0) - st.gasA) * kf(20); st.brkA += ((s.brake || 0) - st.brkA) * kf(20); gas.rotation.x = -st.gasA * .2; brake.rotation.x = -st.brkA * .16;
      // ---- steering wheel
      const steer = cl(s.steer || 0, -1, 1), psiT = steer * MAXANG, prevPsi = st.psi; st.psi += (psiT - st.psi) * kf(11); wheel.rotation.z = st.psi; const psiRate = (st.psi - prevPsi) / dt;
      st.still = Math.abs(psiRate) < .25 ? st.still + dt : 0;
      // ---- gear lever + shift choreography
      const gear = s.gear || 'P';
      if (st.gear === null) { st.gear = gear; st.leverA = st.leverFrom = GEAR_ANG[gear] !== undefined ? GEAR_ANG[gear] : 0; }
      else if (gear !== st.gear && !st.shift) { st.shift = { t: 0, from: st.leverA, to: GEAR_ANG[gear] !== undefined ? GEAR_ANG[gear] : 0 }; st.gear = gear; }
      let wKnob = 0; const T1 = .30, T2 = .24, T3 = .36;
      if (st.shift) { const q = st.shift; q.t += dt; wKnob = q.t < T1 ? sstep01(q.t / T1) : q.t < T1 + T2 ? 1 : 1 - sstep01((q.t - T1 - T2) / T3); st.leverA = lerp(q.from, q.to, sstep01((q.t - T1 + .03) / (T2 * .8)));
        if (q.t >= T1 + T2 + T3) { st.shift = null; wKnob = 0; if (HN.R) { HN.R.grip = HOME.R - st.psi; HN.R.cab = HOME.R; } } }
      if (s._shiftW !== undefined) wKnob = s._shiftW;
      lever.rotation.x = st.leverA; const knob = _s1.copy(KNOB_LOCAL).applyAxisAngle(_v1.set(1, 0, 0), st.leverA).add(refs.shiftPivot);
      prndPtr.position.set(-.012 + .014 - .0185, .462 + .0062, .035 + .01 + .066 - (GEAR_ANG.P - st.leverA) / .135 * .0234); prndPtr.position.y += (prndPtr.position.z - .035) * .085;
      // ---- pendulums (air freshener, keys)
      const accRaw = first ? 0 : cl((speed - st.lastSpeed) / dt, -14, 14); st.lastSpeed = speed; st.acc += (accRaw - st.acc) * kf(8); const lat = cl(steer * speed * speed * .028, -9, 9), pd = st.pend, vib = (rpm * .5 + .12) * .02;
      for (let i = 0; i < 2; i++) { const h = dt / 2; pd.fvx += (-98 * pd.fx + st.acc * 8 - pd.fvx * 1.1 + Math.sin(st.t * 37) * vib * 20) * h; pd.fx += pd.fvx * h; pd.fvz += (-98 * pd.fz + lat * 8 - pd.fvz * 1.1 + Math.cos(st.t * 29) * vib * 14) * h; pd.fz += pd.fvz * h;
        pd.kvx += (-220 * pd.kx + st.acc * 14 - pd.kvx * 3 + Math.sin(st.t * 43) * vib * 60) * h; pd.kx += pd.kvx * h; pd.kvz += (-220 * pd.kz + lat * 14 - pd.kvz * 3 + Math.cos(st.t * 51) * vib * 40) * h; pd.kz += pd.kvz * h; }
      fresh.rotation.set(cl(pd.fx, -1, 1), Math.sin(st.t * .7) * .25 + pd.fz * .6, cl(pd.fz, -1, 1)); keys.rotation.set(cl(pd.kx, -.8, .8), 0, cl(pd.kz, -.8, .8) + .05);
      // ---- hands
      if (hasHands) {
        const bpm = (GT.audio && GT.audio.stations && GT.audio.stations[GT.audio.station || 0] && GT.audio.stations[GT.audio.station || 0].bpm) || 104; st.beat += dt * bpm / 60;
        const ph = st.beat % 4, bf = ph % 1, tapOn = rOn && (ph < 3 || bf < .5), tap = tapOn ? Math.pow(Math.max(0, Math.sin(Math.min(bf * 2.2, 1) * PI)), 2) : 0, breathe = Math.sin(st.t * 1.45) * .0035;
        for (const side of ['L', 'R']) { const H = HN[side], other = HN[side === 'L' ? 'R' : 'L'], lim = LIM[side], busy = side === 'R' && (wKnob > 0 || st.shift);
          let lift = 0;
          if (first) { H.cab = cl(HOME[side], lim[0], lim[1]); H.grip = H.cab - st.psi; }
          if (H.move) { const mv = H.move; mv.t += dt / mv.dur; const a = sstep01(mv.t); H.cab = lerp(mv.from, mv.to, a); lift = Math.sin(cl(mv.t, 0, 1) * PI); if (mv.t >= 1) { H.grip = mv.to - st.psi; H.move = null; lift = 0; } }
          else if (!busy) { H.cab = H.grip + st.psi; const otherFree = !other.move && !(other.side === 'R' && (wKnob > 0 || st.shift));
            let to = null; if (H.cab > lim[1]) to = lim[0] + 20 * D2R; else if (H.cab < lim[0]) to = lim[1] - 20 * D2R; else if (st.still > .7 && Math.abs(st.psi) < .12 && Math.abs(H.cab - HOME[side]) > .2) to = HOME[side];
            if (to !== null && (otherFree || H.cab > lim[1] + .5 || H.cab < lim[0] - .5)) H.move = { t: 0, from: H.cab, to: to, dur: cl(.16 + Math.abs(to - H.cab) * .09, .2, .34) }; }
          else H.cab = HOME.R;
          if (s._lift !== undefined && side === (s._liftSide || 'L')) lift = s._lift;
          handWheelMatrix(H.matrix, H, H.cab + (side === 'L' ? 1 : -1) * Math.sin(st.t * .9 + (side === 'L' ? 0 : 2)) * .004, lift);
          let wk = 0;
          if (side === 'R' && wKnob > 0) { wk = wKnob; // blend towards the shifter knob
            _m2.makeRotationY(-.42); _m1.makeRotationX(.52); _m2.multiply(_m1); _m1.makeRotationZ(-.25); _m2.multiply(_m1); _m2.setPosition(knob); _m1.makeTranslation(-KNOB_C[0], -KNOB_C[1], -KNOB_C[2]); _m2.multiply(_m1);
            H.matrix.decompose(_p1, _q1, _s1); const kp = _p2.setFromMatrixPosition(_m2); _q2.setFromRotationMatrix(_m2); _p1.lerp(kp, wk); _p1.y += Math.sin(wk * PI) * .035; _p1.z -= Math.sin(wk * PI) * .03; _q1.slerp(_q2, wk); H.matrix.compose(_p1, _q1, _s1.set(1, 1, 1)); lift = Math.max(lift, Math.sin(wk * PI) * .8); }
          solveArm(H, breathe);
          // Move the grip with the wheel every frame. Only finger deformation and
          // forearm skinning need a fresh vertex buffer. Offset the two updates.
          const fingerTap = side === 'L' ? tap : 0;
          const interval = (lift || wk || fingerTap) ? .038 : .075;
          if (!H.bakedInverse || st.t - H.lastBake >= interval) {
            const initial = !H.bakedInverse;
            if (initial) H.bakedInverse = new T.Matrix4();
            setPose(H, 1, wk, lift, fingerTap);
            H.rebuild();
            H.bakedInverse.copy(H.matrix).invert();
            H.lastBake = st.t - (initial && side === 'L' ? interval / 2 : 0);
          }
          H.mesh.matrixAutoUpdate = H.nails.matrixAutoUpdate = false;
          H.mesh.matrix.multiplyMatrices(H.matrix, H.bakedInverse);
          H.nails.matrix.copy(H.mesh.matrix);
          H.mesh.matrixWorldNeedsUpdate = H.nails.matrixWorldNeedsUpdate = true;
          if (H.watch) { H.watch.matrix.multiplyMatrices(H.mesh.matrix,H.frames.watch); H.watch.matrixWorldNeedsUpdate = true; }
          if (H.ring) { H.ring.matrix.multiplyMatrices(H.mesh.matrix,H.frames.ring); H.ring.matrixWorldNeedsUpdate = true; } }
      }
      { const vz = GT.render && GT.render.visor; wiperPose(vz ? +vz.wiper || 0 : 0); }
      // ---- glass dust follows the key light
      if (env.sunDir) dustU.uSun.value.copy(env.sunDir).normalize();
      if (env.sunColor) { const c = env.sunColor, mx = Math.max(c.r, c.g, c.b, 1e-4), k = Math.min(mx, 5) / mx * .34; dustU.uSunCol.value.setRGB(c.r * k, c.g * k, c.b * k); }
      if (env.skyColor) dustU.uSky.value.copy(env.skyColor).multiplyScalar(.5); else dustU.uSky.value.setRGB(.3, .4, .5).multiplyScalar(1 - night * .9);
      // ---- rear-view mirror camera
      const RM = GT.render && GT.render.mirror;
      if (RM && RM.camera && (s.mirror === true || (opts.mirror === true && s.mirror !== false))) { RM.enabled = true; const c = RM.camera; _p1.copy(MR.pos).addScaledVector(MR.n, -.02); const d = _p2.copy(MR.pos).sub(EYE).normalize(); d.addScaledVector(MR.n, -2 * d.dot(MR.n));
        c.position.copy(_p1).applyMatrix4(group.matrixWorld); _v1.copy(_p1).addScaledVector(d, 10).applyMatrix4(group.matrixWorld); c.up.set(0, 1, 0).transformDirection(group.matrixWorld); c.lookAt(_v1);
        if (c.fov !== 12.5 || c.near !== .12) { c.fov = 12.5; c.near = .12; c.updateProjectionMatrix(); } c.updateMatrixWorld(); }
    }
    return { group, eye: EYE.clone(), update, setStyle, mirrorGlass, standIn, parts: { wheel, lever, needles, stalk, gas, brake, keys, fresh, hands: HN, dust, materials: m }, state: st };
  }

  GT.cockpit = { build, eye: EYE.clone(), layout: { driverX: DX, floor: FLOOR, belt: BELT, halfWidth: HALF, windshield: WS, wheel: WHEEL, mirror: MIRROR } };

  /* ================================================================== showcase */
  GT.showcase.cockpit = ({ scene, camera, T: T_ }) => {
    const Q = new URLSearchParams(location.search), num = (k, d) => Q.get(k) !== null ? +Q.get(k) : d;
    // ground + a little context so the windows and the mirror have something to show
    const k = GT.kit(); k.box('asphalt', 120, .2, 120, 0, -.1, 0); k.box('concrete', 2.6, .15, 60, 6.0, .075, 0, { bevel: .02 }); k.box('stucco_cream', .3, 4.2, 40, 9.2, 2.1, -4, { bevel: .02 }); k.box('road_paint_white', .12, .012, 5, 1.6, .006, 0); k.box('road_paint_white', .12, .012, 5, -1.6, .006, 0);
    for (let i = 0; i < 6; i++) { k.cyl('metal_galv', .06, .07, 4.5, -7, 2.25, -40 + i * 16, { seg: 10 }); }
    k.box('curb_paint_yellow', .2, .16, 30, -3.4, .08, -6, { bevel: .02 }); k.decal('oil_stain', 1.6, 1.6, .4, .012, -3.2); k.decal('crack', 3, 3, -.8, .011, -7, .5); k.decal('tire_marks', 1.2, 7, .9, .011, -12);
    k.box('metal_painted_blue', 1.8, 1.3, 4.4, 4.2, .85, 9, { bevel: .15 }); k.box('metal_painted_white', 2.0, 1.9, 5.2, -4.2, 1.1, 17, { bevel: .15 });
    scene.add(k.build());
    const root = new T.Group(); root.rotation.y = Q.get('ry') !== null ? +Q.get('ry') * D2R : PI; scene.add(root);
    let car = null; try { if (GT.vehicles && GT.vehicles.make && Q.get('car') !== '0') { car = GT.vehicles.make('hero'); if (car && car.group) root.add(car.group); } } catch (e) { console.warn(e); }
    const t0 = performance.now();
    const cp = GT.cockpit.build({ strip: Q.get('strip') !== '0', mirror: Q.get('mir') !== '0', standIn: car ? false : undefined, hands: Q.get('hands') !== '0', body: Q.get('body') !== '0' }); (car && car.group ? car.group : root).add(cp.group);
    root.updateMatrixWorld(true);
    if (Q.get('stats') === '1') { let tris = 0, calls = 0; cp.group.traverse(o => { if (o.isMesh) { calls++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); const L2 = []; cp.group.traverse(o => { if (o.isMesh) { const g = o.geometry; L2.push([Math.round((g.index ? g.index.count : g.attributes.position.count) / 3), (o.material.name || o.material.type).slice(0, 26)]); } }); L2.sort((x, y) => y[0] - x[0]); const d = document.getElementById('err'); if (d) d.textContent += L2.slice(0, 34).map(x => x[0] + ' ' + x[1]).join(' | ') + '\n'; if (d) d.textContent += 'cockpit: ' + Math.round(tris) + ' tris, ' + calls + ' meshes, build ' + Math.round(performance.now() - t0) + ' ms\n'; }
    if (!Q.get('fov')) { camera.fov = 68; camera.updateProjectionMatrix(); }
    camera.near = .03; camera.updateProjectionMatrix();
    const L = p => V3(p[0], p[1], p[2]).applyMatrix4(cp.group.matrixWorld).toArray(), e = cp.eye;
    const views = {
      fwd: [[e.x, e.y, e.z], [e.x - .02, e.y - .16, e.z + 2]], right: [[e.x, e.y, e.z], [e.x - 2, e.y - .55, e.z + .9]], left: [[e.x, e.y, e.z], [e.x + 2, e.y - .3, e.z + .7]],
      gauges: [[e.x, e.y - .02, e.z + .06], [e.x, .75, .40]], stack: [[e.x - .06, e.y - .04, e.z + .04], [-.04, .71, .40]], hands: [[e.x, e.y - .03, e.z + .14], [e.x, .88, .23]],
      handL: [[e.x + .12, 1.03, -.02], [e.x + .16, .90, .2]], handR: [[e.x - .12, 1.03, -.02], [e.x - .16, .90, .2]], back: [[e.x, e.y, e.z], [e.x - 1.2, e.y - .28, e.z - 2]], down: [[e.x, e.y, e.z], [e.x - .05, .4, e.z + .32]],
      shift: [[e.x - .1, e.y - .1, e.z], [0, .56, .0]], mirror: [[e.x, e.y, e.z], [0, 1.17, .2]], door: [[e.x, e.y, e.z], [e.x + 2, e.y - 1.1, e.z + .5]], pass: [[e.x, e.y, e.z], [e.x - 2, e.y - .9, e.z - .15]], roof: [[e.x, e.y, e.z], [e.x - .6, e.y + 1, e.z + .6]],
      out: [[2.6, 1.5, 2.2], [0, .9, 0]], outF: [[.6, 1.45, 4.2], [.2, 1.0, 0]] };
    const v = views[Q.get('v') || 'fwd'] || views.fwd, fixed = { steer: num('steer', null), gear: Q.get('gear'), speed: num('speed', null), sig: Q.get('sig'), wanted: num('wanted', 0), shiftW: num('shiftw', null), lift: num('lift', null) };
    const hide = (Q.get('hide') || '').split(','); if (hide.includes('wheel')) cp.parts.wheel.parent.visible = false; if (hide.includes('hands')) for (const sd in cp.parts.hands) { const H = cp.parts.hands[sd]; [H.mesh, H.nails, H.fore, H.upper, H.watch, H.ring].forEach(o => { if (o) o.visible = false; }); }
    if (hide.includes('dust')) cp.parts.dust.visible = false;
    let t = 0, frozen = null;
    const simN = num('sim', 0);
    if (simN > 0) { // deterministic fast-forward so stills can catch mid-shuffle / mid-shift poses: steer sweeps lock to lock, gear changes at 1 s
      for (let i = 0; i < simN; i++) { t += 1 / 60; frozen = { speed: 9, rpm: .3, steer: Math.sin(t * 1.5) * (Q.get('simamp') ? +Q.get('simamp') : 1), throttle: .2, brake: 0, gear: t > 1 ? (Q.get('simgear') || 'D') : 'P', fuel: .68, temp: .47, night: 0, lights: false, signal: null, radioOn: true, radioText: 'CORAL 98.1', clock: '18:12', wanted: 0, mirror: true }; cp.update(1 / 60, frozen); } }
    return { cam: L(v[0]), look: L(v[1]), hours: 18.2,
      update(dt) { if (frozen) { cp.update(.0001, frozen); return; } t += dt; const night = (GT.env && GT.env.night) || 0;
        const s = { speed: fixed.speed !== null && !isNaN(fixed.speed) ? fixed.speed : 17 + Math.sin(t * .4) * 3, rpm: .34 + Math.sin(t * .9) * .05, steer: fixed.steer !== null && !isNaN(fixed.steer) ? fixed.steer : Math.sin(t * .8) * .06, throttle: .3, brake: 0, gear: fixed.gear || 'D', fuel: .68, temp: .47,
          night, lights: night > .3, signal: fixed.sig || null, radioOn: true, radioText: 'CORAL 98.1', clock: '18:12', wanted: fixed.wanted, look: { yaw: 0, pitch: 0 }, mirror: true };
        if (fixed.shiftW !== null && !isNaN(fixed.shiftW)) s._shiftW = fixed.shiftW; if (fixed.lift !== null && !isNaN(fixed.lift)) { s._lift = fixed.lift; s._liftSide = Q.get('liftside') || 'L'; }
        if (Q.get('speed') === null && night < .5 && Q.get('park') === '1') { s.speed = 0; s.gear = 'P'; s.rpm = .04; }
        cp.update(dt, s); } };
  };
})();
