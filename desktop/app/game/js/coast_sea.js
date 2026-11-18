/* coast_sea.js — the sea, the sand and everything that floats off 维尔蒙港 Port Vermont's ocean front (cn.html?world=coast).
   GT.coastTerrain (defined at load): the analytic shore shared by the ground queries (js/coast.js), the sand mesh and the water shader:
     SEA = sea level (-1.0, the road is y = 0) · xw(z) = waterline · depth(x, z) = water depth seaward of it · landY(x, z) = park lawn / dunes / beach / sea bed for x <= -10.5.
   GT.coastParts.sea(C) builds (called by js/coast.js build()): the sand (heightfield, MeshStandard + a patch for wet sand, the swash film that runs up and drains back, foam lace),
     the park lawn, one big water plane with its own shader (depth colour from the analytic sea bed, sand and caustics seen through the shallows, sky reflection from a
     small LUT of GT.atmos.skyColorAt, sun glint, breakers, shore foam, V-shaped wakes behind every moving boat), boats (speedboats, a catamaran, jet skis, sailboats,
     a cruise ship far out), a causeway bridge and keys on the horizon. Returns { update(dt) }.
   BR (2026-11-17): the causeway is modelled after Miami's (GT.coastBridge, buildBridge: girders, piers, barriers, lamps, signs, its own traffic; its shadow, foam and lamp
     reflections are drawn by the water shader) and the keys are real islands (buildIsles: sand rims, shallows, palm and tree cards, villas with pools, docks and yachts). */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!T || !GT) return;
  const PI = Math.PI, HP = PI / 2, TAU = PI * 2, abs = Math.abs, min = Math.min, max = Math.max, lerp = (a, b, t) => a + (b - a) * t, cl = (v, a, b) => max(a, min(b, v)), sst = (x, a, b) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  /* ---------------------------------------------------------------- terrain (the same formulas are in GLSL below: keep in sync) */
  const SEA = -1.0, PK = -10.5, DUNE0 = -38, DUNE1 = -52, ACC0 = -2, ACCP = 60;
  const ISLES = [[-1560, 1840, 230], [-980, -1520, 150], [-2250, 330, 95], [-1850, -420, 70]];
  /* BR: each key's outline is a wobbled circle (the same in the water shader and in buildIsles) */
  const ISLE_PH = ISLES.map((q, i) => { const IR = GT.rng('br-isle' + i); return [IR() * TAU, IR() * TAU, IR() * TAU]; }), isleEdge = (i, th) => { const p = ISLE_PH[i]; return 1 + .06 * Math.sin(3 * th + p[0]) + .035 * Math.sin(5 * th + p[1]) + .02 * Math.sin(11 * th + p[2]); };
  const xw = z => -108 + 2.6 * Math.sin(z * .0213) + 1.4 * Math.sin(z * .0527 + 1.0);
  function depth(x, z) { const a = xw(z) - x; if (a <= 0) return 0; let d = a < 20 ? a * .05 : a < 60 ? 1 + (a - 20) * .022 : 1.88 + (a - 60) * .035; d = min(d, 24);
    d -= .75 * Math.exp(-(((a - 80) / 12) ** 2)) + 1.1 * Math.exp(-(((a - 155) / 26) ** 2)); d += .3 * Math.sin(x * .031 + z * .017) * Math.sin(z * .043 - x * .012) * min(1, a / 60);
    d = max(d, a * .01); for (let i = 0; i < ISLES.length; i++) { const [ix, iz, r] = ISLES[i], th = Math.atan2(z - iz, x - ix), p = ISLE_PH[i], q = Math.hypot(x - ix, z - iz) - r * isleEdge(i, th); d = min(d, max(.25, q * .035 / (1 + .45 * Math.sin(2 * th + p[1])))); } return d; }   /* BR: the keys get their own shallows (the offshore floor a * .01 used to hide them) */
  const beachY = (x, z) => { const s = x - xw(z); if (s < 0) return SEA - depth(x, z); return SEA + min(s, 16) * .05 + max(0, s - 16) * .012 + .05 * Math.sin(x * .23 + 2 * Math.sin(z * .09)) * sst(s, 18, 30); };
  const lawnY = (x, z) => .3 + .07 * Math.sin(z * .071) * Math.sin(x * .13 + 1);
  const accessK = z => { const u = (((z - ACC0) % ACCP) + ACCP) % ACCP, d = min(u, ACCP - u); return sst(d, 2.2, 4.8); };
  const duneEdge = z => DUNE0 - 1.4 * Math.sin(z * .09) - .8 * Math.sin(z * .23 + 2);
  function landY(x, z) { if (x >= DUNE0) return lawnY(x, z); if (x <= DUNE1) return beachY(x, z); const t = (DUNE0 - x) / (DUNE0 - DUNE1), base = lerp(lawnY(DUNE0, z), beachY(DUNE1, z), t);
    const hum = 1 + .32 * Math.sin(z * .29 + 1.3 * Math.sin(x * .41)) * Math.sin(x * .53 + z * .07) + .18 * Math.sin(z * .71 + x * .9);
    return base + (1.05 + .3 * Math.sin(z * .047) + .2 * Math.sin(z * .13 + 1)) * hum * Math.pow(Math.sin(PI * t), 1.3) * accessK(z); }
  GT.coastTerrain = { SEA, PK, DUNE0, DUNE1, ACC0, ACCP, ISLES, xw, depth, beachY, lawnY, landY, accessK, duneEdge };

  /* ---------------------------------------------------------------- BR (2026-11-17): the causeway, after Miami's (Rickenbacker / William Powell Bridge, MacArthur, Seven Mile; notes BR-跨海桥.md)
     From the city a road on grade, a fill embankment between retaining walls across the dunes, 16 + 19 spans of precast I-girders (~33 m) on four-column bents, and in the middle a
     three-span haunched box girder (56 + 96 + 56 m) that lifts the deck 19 m over the navigation channel; on the key it comes down onto an embankment again.
     GT.coastBridge (shared with js/demo.js and the water shader below): A, B, L, u, n (n = the south side, where the island-bound lanes run), h (heading of u), at(s, o) -> [x, z],
     top(s) = road surface y at s metres from A, piers [{s, kind: 'abut' | 'bent' | 'flank' | 'main'}], lanes (o of the four lane centres, o > 0 drives towards the key). */
  const BRG = (() => { const A = [-60, 1190], B = [-1420, 1760], L = Math.hypot(B[0] - A[0], B[1] - A[1]), u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L]; let n = [-u[1], u[0]]; if (n[1] > 0) n = [-n[0], -n[1]];
    const SC = L * .45, W = 400, RISE = 19, YLOW = 7.5, YISL = 1.6, SA = 30, SB = 1395, F = 104, M = 48, n1 = 16, n2 = 19, d1 = (SC - F - SA) / n1, d2 = (SB - SC - F) / n2;
    const top = s => lerp(lerp(.35, YLOW, sst(s, -60, 150)), YISL, sst(s, 1330, 1450)) + RISE * .5 * (1 + Math.cos(PI * min(1, abs(s - SC) / W)));
    const piers = [{ s: SA, kind: 'abut' }]; for (let k = 1; k < n1; k++) piers.push({ s: SA + k * d1, kind: 'bent' }); piers.push({ s: SC - F, kind: 'flank' }, { s: SC - M, kind: 'main' }, { s: SC + M, kind: 'main' }, { s: SC + F, kind: 'flank' });
    for (let k = 1; k < n2; k++) piers.push({ s: SC + F + k * d2, kind: 'bent' }); piers.push({ s: SB, kind: 'abut' });
    const at = (s, o) => [A[0] + u[0] * s + n[0] * (o || 0), A[1] + u[1] * s + n[1] * (o || 0)];
    /* box girder depth below the road in the channel unit: 2.4 m at mid-span and at the flanking piers, 4.3 m over the main piers */
    const boxD = s => { const a = abs(s - SC); return a <= M ? 2.4 + 1.9 * (a / M) ** 2 : 2.4 + 1.9 * ((F - min(a, F)) / (F - M)) ** 2; };
    return { A, B, L, u, n, h: Math.atan2(u[0], u[1]), SC, W, RISE, YLOW, YISL, SA, SB, F, M, n1, n2, d1, d2, top, boxD, piers, at, S0: -110, S1: 1500, HW: 12.4, CW: 9.6, lanes: [-6.6, -3.0, 3.0, 6.6], LS0: -96, LSP: 42 }; })();
  GT.coastBridge = BRG;
  const GLSL_BRIDGE = `
    uniform vec4 uBrA, uBrB, uBrC, uBrD;
    float brTop(float s) { return mix(mix(0.35, uBrB.w, smoothstep(-60.0, 150.0, s)), uBrD.z, smoothstep(1330.0, 1450.0, s)) + uBrB.z * 0.5 * (1.0 + cos(3.14159265 * min(1.0, abs(s - uBrB.x) / uBrB.y))); }
    /* the pier nearest station s: x = station, y = kind (1 bent, 2 flanking, 3 main) */
    vec2 brPier(float s) { float SC = uBrB.x, F = uBrD.x, M = uBrD.y, a = abs(s - SC), sg = s < SC ? -1.0 : 1.0;
      if (a < F + 0.5 * uBrC.y) return a > 0.5 * (F + M) ? vec2(SC + sg * F, 2.0) : vec2(SC + sg * M, 3.0);
      if (s < SC) return vec2(uBrC.x + uBrC.y * clamp(floor((s - uBrC.x) / uBrC.y + 0.5), 1.0, uBrD.w - 1.0), 1.0);
      float s2 = SC + F; return vec2(s2 + uBrC.z * clamp(floor((s - s2) / uBrC.z + 0.5), 1.0, floor((uBrC.w - s2) / uBrC.z + 0.5) - 1.0), 1.0); }
    /* sunlight blocked by the deck (tested at the barrier tops and at the soffit, the sun ray walked up to the profile) and by the columns of the nearest pier */
    float brShadow(vec3 P, vec3 Ls) { if (Ls.y < 0.03) return 0.0; vec2 A = uBrA.xy, u = uBrA.zw, n = vec2(-u.y, u.x); float sh = 0.0;
      for (int k = 0; k < 2; k++) { float dy = k == 0 ? 0.8 : -2.3, y = uBrB.w + dy, s = 0.0; vec2 Q = P.xz;
        for (int it = 0; it < 3; it++) { Q = P.xz + Ls.xz * ((y - P.y) / Ls.y); s = dot(Q - A, u); y = brTop(s) + dy; }
        float o = dot(Q - A, n); sh = max(sh, (1.0 - smoothstep(12.1, 12.7, abs(o))) * smoothstep(20.0, 30.0, s) * (1.0 - smoothstep(1395.0, 1405.0, s))); }
      float hl = length(Ls.xz); if (hl < 1e-3) return sh; vec2 dH = Ls.xz / hl; float tanE = Ls.y / hl, dn = dot(dH, n); if (abs(dn) < 0.04) return sh;
      for (int c = 0; c < 6; c++) { float oc = c == 0 ? -9.9 : c == 1 ? -3.9 : c == 2 ? 3.9 : c == 3 ? 9.9 : c == 4 ? -6.0 : 6.0; float t = (oc - dot(P.xz - A, n)) / dn; if (t < 0.0) continue;
        float s = dot(P.xz + dH * t - A, u); vec2 pk = brPier(s); bool big = c >= 4; if (big != (pk.y > 1.5)) continue; float r = big ? 1.5 : 0.66, d = abs(s - pk.x) * abs(dn);
        sh = max(sh, (1.0 - smoothstep(r - 0.12, r + 0.12, d)) * step(P.y + t * tanE, brTop(pk.x) - (big ? 5.0 : 3.4))); }
      return sh; }
    /* white water round the footings (lace from the caller) */
    float brFoam(vec2 q, float lace) { vec2 A = uBrA.xy, u = uBrA.zw, n = vec2(-u.y, u.x); float s = dot(q - A, u), o = dot(q - A, n); if (s < 40.0 || s > 1400.0 || abs(o) > 32.0) return 0.0; vec2 pk = brPier(s);
      vec2 hs = pk.y > 2.5 ? vec2(4.6, 14.2) : pk.y > 1.5 ? vec2(3.3, 13.2) : vec2(1.5, 11.7); float d = length(max(abs(vec2(s - pk.x, o)) - hs, 0.0));
      return (1.0 - smoothstep(0.0, 0.7 + 1.9 * lace, d)) * (0.5 + 0.5 * lace) + 0.35 * (1.0 - smoothstep(0.0, 6.0, d)) * smoothstep(0.55, 0.9, lace); }
    /* night: the bridge lamps mirrored in the rough water (the reflected ray walked up to the lamp row, a soft spot per lamp, stretched by the waves) */
    vec3 brLampRefl(vec3 P, vec3 R) { if (R.y < 0.02) return vec3(0.0); vec2 A = uBrA.xy, u = uBrA.zw, n = vec2(-u.y, u.x); float y = uBrB.w + 11.0, s = 0.0; vec2 Q = P.xz;
      for (int it = 0; it < 3; it++) { Q = P.xz + R.xz * ((y - P.y) / R.y); s = dot(Q - A, u); y = brTop(s) + 11.0; }
      float o = abs(dot(Q - A, n)) - 9.9, k = floor((s + 96.0) / 42.0 + 0.5), ds = s - (-96.0 + k * 42.0); if (s < 20.0 || s > 1400.0) return vec3(0.0);
      return vec3(1.0, 0.72, 0.42) * exp(-o * o / 9.0 - ds * ds / 5.0) * 2.2; }
  `;

  const GLSL_TERRAIN = `
    uniform vec3 uIsle[4]; uniform vec3 uIsleP[4];
    float coXw(float z) { return -108.0 + 2.6 * sin(z * 0.0213) + 1.4 * sin(z * 0.0527 + 1.0); }
    float coDepth(float x, float z) { float a = coXw(z) - x; if (a <= 0.0) return 0.0; float d = a < 20.0 ? a * 0.05 : (a < 60.0 ? 1.0 + (a - 20.0) * 0.022 : 1.88 + (a - 60.0) * 0.035); d = min(d, 24.0);
      d -= 0.75 * exp(-pow((a - 80.0) / 12.0, 2.0)) + 1.1 * exp(-pow((a - 155.0) / 26.0, 2.0)); d += 0.3 * sin(x * 0.031 + z * 0.017) * sin(z * 0.043 - x * 0.012) * min(1.0, a / 60.0);
      d = max(d, a * 0.01); for (int i = 0; i < 4; i++) { vec2 dv = vec2(x, z) - uIsle[i].xy; float th = atan(dv.y, dv.x); vec3 p = uIsleP[i]; float e = 1.0 + 0.06 * sin(3.0 * th + p.x) + 0.035 * sin(5.0 * th + p.y) + 0.02 * sin(11.0 * th + p.z);
        float q = length(dv) - uIsle[i].z * e; d = min(d, max(0.25, q * 0.035 / (1.0 + 0.45 * sin(2.0 * th + p.y)))); } return d; }
    /* surf cycle: 0..0.6 a breaker rolls in from ~30 m out, 0.6..0.75 it runs up the sand, 0.75..1 the backwash drains */
    float coPhase(float z, float t) { return fract(t * 0.105 + z * 0.0021 + 0.05 * sin(z * 0.011 + t * 0.05) + 0.025 * sin(z * 0.047)); }
    float coRun(float f) { return f < 0.6 ? 0.0 : (f < 0.72 ? smoothstep(0.6, 0.72, f) : 1.0 - smoothstep(0.72, 1.0, f)); }
    float coLevel(float z, float t) { float f = coPhase(z, t); return -1.05 + 0.24 * coRun(f) + 0.11 * coRun(fract(f + 0.47)); }
  `;

  /* ---------------------------------------------------------------- procedural textures */
  /** tileable wave normals (rg) and height (a), 256 px */
  function waveTex() { const N = 256, R = GT.rng('coast-waves'), W = []; for (let i = 0; i < 46; i++) { let kx = Math.round((R() - .5) * 26), ky = Math.round((R() - .5) * 26); if (!kx && !ky) kx = 1; const k = Math.hypot(kx, ky); W.push([kx, ky, 1 / Math.pow(k, 1.55), R() * TAU]); }
    const H = new Float32Array(N * N), GX = new Float32Array(N * N), GY = new Float32Array(N * N); let hmin = 1e9, hmax = -1e9, gm = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let h = 0, gx = 0, gy = 0; const u = x / N * TAU, v = y / N * TAU; for (const [kx, ky, a, p] of W) { const ph = kx * u + ky * v + p, s = Math.sin(ph), c = Math.cos(ph); h += a * s; gx += a * kx * c; gy += a * ky * c; } const i = y * N + x; H[i] = h; GX[i] = gx; GY[i] = gy; hmin = min(hmin, h); hmax = max(hmax, h); gm = max(gm, abs(gx), abs(gy)); }
    /* foam lace in blue: cell borders of a tileable worley field (two scales) */
    const cells = (G, sd) => { const RR = GT.rng('coast-foam' + sd), pts = []; for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) pts.push([(i + .15 + .7 * RR()) / G, (j + .15 + .7 * RR()) / G]); return (u, v) => { let f1 = 9, f2 = 9; const ci = Math.floor(u * G), cj = Math.floor(v * G); for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = ((ci + di) % G + G) % G, jj = ((cj + dj) % G + G) % G, p = pts[jj * G + ii], px = p[0] + Math.floor((ci + di) / G) / 1 * 0 + (ci + di - ii) / G, pz = p[1] + (cj + dj - jj) / G, dd = Math.hypot(u - px, v - pz) * G; if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd; } return f2 - f1; }; };
    const W1 = cells(9, 1), W2 = cells(23, 2);
    const d = new Uint8Array(N * N * 4); for (let i = 0; i < N * N; i++) { const u = (i % N) / N, v = Math.floor(i / N) / N, e = min(1, W1(u, v) * 2.2) * .6 + min(1, W2(u, v) * 2.5) * .4; d[i * 4] = cl(128 + GX[i] / gm * 127, 0, 255); d[i * 4 + 1] = cl(128 + GY[i] / gm * 127, 0, 255); d[i * 4 + 2] = cl((1 - e) * 255, 0, 255); d[i * 4 + 3] = cl((H[i] - hmin) / (hmax - hmin) * 255, 0, 255); }
    const t = new T.DataTexture(d, N, N, T.RGBAFormat); t.wrapS = t.wrapT = T.RepeatWrapping; t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter; t.anisotropy = 8; t.needsUpdate = true; return t; }
  /** sky radiance LUT (64 azimuths x 16 heights, linear HDR), refreshed when the hour moves */
  function skyLUT() { const W = 64, H = 16, data = new Float32Array(W * H * 4), t = new T.DataTexture(data, W, H, T.RGBAFormat, T.FloatType); t.wrapS = T.RepeatWrapping; t.wrapT = T.ClampToEdgeWrapping; t.magFilter = t.minFilter = T.LinearFilter; t.generateMipmaps = false;
    const dir = new T.Vector3(), col = new T.Color(); let last = -99;
    t.refresh = (hours, force) => { if (!force && abs(hours - last) < .01) return; last = hours; const A = GT.atmos; if (!A || !A.skyColorAt) return;
      for (let j = 0; j < H; j++) { const y = ((j + .5) / H) ** 2, c = Math.sqrt(1 - y * y); for (let i = 0; i < W; i++) { const az = (i + .5) / W * TAU - PI; dir.set(Math.cos(az) * c, y, Math.sin(az) * c); try { A.skyColorAt(dir, col); } catch (e) { col.setRGB(.3, .5, .8); } const k = (j * W + i) * 4; data[k] = col.r; data[k + 1] = col.g; data[k + 2] = col.b; data[k + 3] = 1; } }
      t.needsUpdate = true; }; return t; }

  /* ---------------------------------------------------------------- the water */
  const WATER_VS = `
    varying vec3 vWP;
    #include <fog_pars_vertex>
    void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const WATER_FS = `
    uniform float uTime, uNight, uGlint; uniform vec3 uSunDir, uSunCol, uAmb; uniform sampler2D uNrm, uSand, uSky; uniform vec4 uBoatA[10], uBoatB[10];
    varying vec3 vWP;
    #include <fog_pars_fragment>
    ${GLSL_TERRAIN}
    ${GLSL_BRIDGE}
    vec3 coSky(vec3 R) { float u = atan(R.z, R.x) / 6.2831853 + 0.5; return texture2D(uSky, vec2(u, sqrt(clamp(R.y, 0.0, 1.0)))).rgb; }
    void main() {
      vec3 P = vWP; vec2 q = P.xz; float dist = length(cameraPosition - P), t = uTime;
      float a = coXw(P.z) - P.x, d = coDepth(P.x, P.z);
      /* WT (2026-11-17): level of detail for the shallows. nearK = 1 standing at the water or on a boat, 0 from a few tens of metres up or further out: caustics and sand ripples
         fade to their mean (no net, no moire from the air), the fine ripple normals over the shallows soften with height, the bed keeps only big soft light and dark patches */
      float camH = max(cameraPosition.y + 1.0, 0.0), nearK = (1.0 - smoothstep(16.0, 70.0, dist)) * (1.0 - smoothstep(7.0, 26.0, camH)), shoal = 1.0 - smoothstep(4.0, 9.0, d);
      vec4 n1 = texture2D(uNrm, q * 0.027 + vec2(t * 0.011, t * 0.0045)), n2 = texture2D(uNrm, q * 0.071 + vec2(-t * 0.016, t * 0.012)), n3 = texture2D(uNrm, q * 0.19 + vec2(t * 0.027, -t * 0.02));
      float fd = 1.0 / (1.0 + dist * 0.006), fh = 1.0 - 0.5 * smoothstep(10.0, 60.0, camH) * shoal;
      vec2 g = (n1.xy * 2.0 - 1.0) * 0.5 + (n2.xy * 2.0 - 1.0) * 0.38 * fd * fh + (n3.xy * 2.0 - 1.0) * 0.26 * fd * fd * fh * fh;
      float swell = sin(P.x * 0.09 + t * 0.9 + sin(P.z * 0.013) * 2.0); g.x += 0.25 * cos(P.x * 0.09 + t * 0.9) * (1.0 - smoothstep(30.0, 400.0, dist));
      g *= 0.28 * mix(0.45, 1.0, smoothstep(0.15, 2.5, d)) * uGlint;
      vec3 N = normalize(vec3(-g.x, 1.0, -g.y)), V = normalize(cameraPosition - P);
      float NV = max(dot(N, V), 0.0), F = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
      vec3 R = reflect(-V, N); R.y = abs(R.y); R = normalize(R + vec3(0.0, 0.015, 0.0));
      vec3 sky = coSky(R);
      /* the sea bed seen through the water: sand, ripples, caustics, darker weed patches further out */
      vec2 bq = q + g * min(d, 4.0) * 1.6;
      float bedK = mix(nearK, 1.0, smoothstep(5.0, 8.0, d));   /* WT: beyond ~8 m the bed detail stays as it was (the causeway shot from the air is right as it is) */
      vec3 sand = mix(texture2D(uSand, vec2(0.5), 16.0).rgb, texture2D(uSand, bq * 0.294).rgb, 0.45 + 0.55 * bedK) * vec3(0.98, 0.93, 0.84);
      float rip = 0.84 + 0.16 * sin(dot(bq, vec2(1.7, 0.5)) + 2.0 * sin(bq.y * 0.21)) * (0.7 + 0.3 * sin(dot(bq, vec2(0.31, 1.13)) * 0.7)); rip = mix(0.84, rip, bedK); sand *= mix(1.0, rip, smoothstep(0.05, 0.8, d));
      float weed = smoothstep(0.52, 0.66, texture2D(uNrm, q * 0.0043 + 0.31).a) * smoothstep(2.5, 6.0, d); sand = mix(sand, vec3(0.16, 0.2, 0.12), weed * 0.75);
      /* WT: big soft patches on the bed off the beach (lighter sand bars, darker seagrass and shadowed sand), tens of metres across, from two rotated samples of the smooth height field */
      float h1 = texture2D(uNrm, q * 0.0041 + vec2(0.61, 0.13)).a, h2 = texture2D(uNrm, mat2(0.8, -0.6, 0.6, 0.8) * q * 0.0097 + vec2(0.27, 0.71)).a, hb = h1 * 0.62 + h2 * 0.38;
      float shoreK = (1.0 - smoothstep(150.0, 240.0, a)) * smoothstep(0.6, 2.0, d);
      sand = mix(sand, sand * vec3(0.48, 0.6, 0.56), smoothstep(0.52, 0.66, hb) * 0.65 * shoreK) * (1.0 + 0.2 * (1.0 - smoothstep(0.34, 0.47, hb)) * shoreK);
      /* WT: caustics at ~1.4x the old cell size and weaker, the two layers turned against each other and bent by the patch field so no tile repeats in a grid; mean value from afar */
      vec2 cq = bq + (vec2(h1, h2) - 0.5) * 9.0, cr = mat2(0.6, -0.8, 0.8, 0.6) * cq;
      float c1 = texture2D(uNrm, cq * 0.165 + vec2(t * 0.025, t * 0.015)).a, c2 = texture2D(uNrm, cr * 0.22 - vec2(t * 0.019, -t * 0.022)).a;
      float caus = mix(mix(0.65, 0.3, smoothstep(0.3, 1.8, d)), pow(max(1.0 - abs(c1 - c2) * 3.2, 0.0), 6.0) * 2.3, nearK) * exp(-d * 0.3) * smoothstep(0.04, 0.35, d);
      { float kf = smoothstep(300.0, 500.0, a) * smoothstep(70.0, 420.0, dist); caus *= 1.0 - 0.88 * kf; sand *= mix(1.0, 1.0 / max(rip, 0.5), 0.75 * kf); }   /* BR: the keys' shallows seen from afar: caustics and ripples are too small to read, the net would tile */
      float sunUp = max(uSunDir.y, 0.0);
      float brSh = dist < 2600.0 ? brShadow(P, uSunDir) : 0.0, sunK = 1.0 - 0.8 * brSh;   /* BR: the causeway's shadow on the water (the deck and the columns) */
      vec3 E = uSunCol * max(sunUp, 0.18) * (0.85 + caus * sunK) * sunK + uAmb * 1.2;
      vec3 bed = sand * 0.92 * E;
      vec3 tr = exp(-d * vec3(0.8, 0.07, 0.055) * 2.0);
      vec3 inCol = mix(mix(vec3(0.03, 0.42, 0.44), vec3(0.01, 0.2, 0.36), smoothstep(1.5, 7.0, d)), vec3(0.004, 0.07, 0.19), smoothstep(7.0, 22.0, d));
      vec3 scat = inCol * (uSunCol * max(sunUp, 0.18) * 0.6 * sunK + uAmb * 1.3) * 0.6;
      vec3 under = bed * tr + scat * (1.0 - tr.g);
      vec3 col = mix(under, sky, F);
      /* sun glint: tight close by, a wide glitter path far out */
      float rl = max(dot(R, uSunDir), 0.0), sh = mix(1400.0, 90.0, smoothstep(25.0, 1200.0, dist));
      col += uSunCol * (pow(rl, sh) * sh * 0.006 + pow(rl, 24.0) * 0.025) * (1.0 - uNight * 0.7) * uGlint * sunK;
      if (uNight > 0.02 && dist < 2200.0) col += brLampRefl(P, R) * uNight * (0.4 + 0.6 * F);
      /* surf: breakers rolling in, shore foam, patchy foam in the surf zone */
      /* WT: in the surf zone seen from afar or from the air the small foam cells give way to their mean (0.405 = mean of the cell channel) and the coverage is kept by a lower threshold:
         soft foam patches the size of the 24 m field instead of a net of cells */
      float surfK = (1.0 - smoothstep(30.0, 45.0, a)) * (1.0 - (1.0 - smoothstep(20.0, 90.0, dist)) * (1.0 - smoothstep(8.0, 30.0, camH)));
      float lace = smoothstep(0.38 - 0.12 * surfK, 0.85, mix(texture2D(uNrm, q * 0.13 + vec2(t * 0.012, 0.0)).b, 0.405, 0.8 * surfK) * 0.75 + texture2D(uNrm, q * 0.041 - vec2(0.0, t * 0.008)).a * 0.45 - 0.12);
      float foam = 0.0;
      for (int k = 0; k < 2; k++) { float f = fract(coPhase(P.z, t) + float(k) * 0.47); if (f < 0.6) { float ac = 32.0 * (1.0 - f / 0.6) + 1.8 * sin(P.z * 0.067 + float(k) * 2.0 + t * 0.15), b = a - ac; float br = (1.0 - smoothstep(17.0, 30.0, ac)) * (k == 0 ? 1.0 : 0.75);
        foam += br * (2.3 * smoothstep(-0.9, 0.0, b) * (1.0 - smoothstep(0.0, 2.2, b)) * mix(0.7, 1.0, lace) + 1.35 * smoothstep(-0.5, 0.5, b) * exp(-max(b, 0.0) / mix(4.0, 10.0, f)) * mix(0.25, 1.0, lace)); } }
      float patchy = smoothstep(0.45, 0.75, texture2D(uNrm, q * 0.011 + vec2(t * 0.004, 0.0)).a); foam += (1.0 - smoothstep(3.0, 24.0, a)) * lace * (0.08 + 0.3 * patchy);
      foam += (1.0 - smoothstep(0.0, 0.2 + 0.12 * lace, d)) * (0.75 + 0.35 * lace) + (1.0 - smoothstep(0.25, 1.4, a)) * 0.35 * lace;
      if (dist < 1800.0) foam += brFoam(q, lace) * 0.85;
      /* wakes */
      for (int i = 0; i < 10; i++) { vec4 A = uBoatA[i], B = uBoatB[i]; if (B.x <= 0.1) continue; vec2 rel = q - A.xy; float al = dot(rel, A.zw), ac = dot(rel, vec2(A.w, -A.z)); float bb = -al - B.y * 0.45;
        if (bb > -B.y && bb < B.w) { float fadeW = (1.0 - smoothstep(B.w * 0.35, B.w, bb)) * smoothstep(-B.y, 0.0, bb + B.y * 0.2);
          float arm = exp(-pow((abs(ac) - max(bb, 0.0) * 0.34 - B.z * 0.8) / (0.5 + max(bb, 0.0) * 0.07), 2.0)) * smoothstep(-1.0, 3.0, bb);
          float trail = exp(-pow(ac / (B.z * 0.9 + max(bb, 0.0) * 0.05), 2.0)) * step(0.0, bb) * (1.0 - smoothstep(B.w * 0.15, B.w * 0.6, bb));
          float bow = exp(-pow((abs(ac) - B.z) / 0.35, 2.0)) * step(-B.y * 1.1, bb) * step(bb, 0.0);
          foam += (arm * 0.8 + trail * 1.15 + bow * 0.7) * fadeW * min(B.x / 6.0, 1.0) * mix(0.55, 1.0, lace); } }
      foam = clamp(foam, 0.0, 1.0);
      vec3 foamCol = vec3(0.9) * (uSunCol * (sunUp * 0.85 * sunK + 0.14) + uAmb * 1.2);
      col = mix(col, foamCol, foam);
      gl_FragColor = vec4(col, 1.0);
      #include <fog_fragment>
    }`;

  /* ---------------------------------------------------------------- boats (local: +Z forward, origin on the waterline at mid-hull) */
  /** lofted hull: sections [z, halfBeam, chineY, keelY, gunwaleY], mirrored; returns geometry (sides + deck + transom) */
  function hullGeo(S) { const P = [], I = [], U = []; const ring = s => { const [z, w, hc, hk, hg] = s; return [[-w, hg], [-w * .78, hc], [0, hk], [w * .78, hc], [w, hg]].map(p => [p[0], p[1], z]); };
    const rings = S.map(ring), n = 5; rings.forEach((r, i) => r.forEach((p, j) => { P.push(p[0], p[1], p[2]); U.push(j / 4, i / (S.length - 1)); }));
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < n - 1; j++) { const a = i * n + j, b = a + n; I.push(a, a + 1, b, a + 1, b + 1, b); }
    const base = P.length / 3; rings.forEach(r => { P.push(r[0][0], r[0][1], r[0][2], r[4][0], r[4][1], r[4][2]); U.push(0, 0, 1, 0); }); for (let i = 0; i < rings.length - 1; i++) { const a = base + i * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const tb = P.length / 3; rings[0].forEach(p => { P.push(p[0], p[1], p[2]); U.push(0, 0); }); for (let j = 1; j < n - 1; j++) I.push(tb, tb + j + 1, tb + j);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals(); return g; }
  function boatModel(kind, C) { const K = GT.kit(), white = C.flat(0xf2f1ec, .28, 0, 'gel'), dark = C.flat(0x15191d, .2, .3), glass = GT.mat('glass_tint'), metal = C.flat(0xc8ccd0, .25, .9);
    if (kind === 'speed') { const L = 9; K.geo(white, hullGeo([[-L / 2, 1.1, .05, -.35, .75], [-L / 4, 1.2, 0, -.45, .8], [0, 1.2, .02, -.45, .82], [L / 4, 1.0, .12, -.3, .86], [L * .42, .55, .35, 0, .9], [L / 2, .05, .7, .55, .95]]));
      K.box(C.flat(0xc8a83a, .4, .2), .02, .18, 6.5, 1.13, .55, -.3); K.box(C.flat(0xc8a83a, .4, .2), .02, .18, 6.5, -1.13, .55, -.3); K.box(C.flat(0x2a3a5a, .5), 2.1, .06, 6.2, 0, .74, -.6);
      K.box(white, 1.0, .9, 1.0, 0, 1.15, .6, { bevel: .08 }); K.box(glass, 1.9, .5, .05, 0, 1.45, 1.25, { rx: -.5 }); K.box(C.flat(0xd8c8a8, .8), 1.8, .35, 1.4, 0, .95, -1.6, { bevel: .1 }); K.box(dark, .6, .5, .5, 0, .95, -3.9); }
    else if (kind === 'cat') { const L = 14; for (const s of [-1, 1]) { K.push(s * 2.6, 0, 0); K.geo(white, hullGeo([[-L / 2, .7, -.1, -.6, .9], [-L / 4, .8, -.15, -.7, 1.0], [L / 4, .7, -.05, -.55, 1.05], [L / 2, .05, .6, .4, 1.1]])); K.pop(); }
      K.box(white, 6.4, .4, 10, 0, 1.2, -.6, { bevel: .1 }); K.box(white, 5.2, 2.0, 6.5, 0, 2.4, -.8, { bevel: .2 }); K.box(dark, 5.25, .7, 5.6, 0, 2.6, -.6); K.box(white, 4.4, .25, 4.4, 0, 3.55, -1.2, { bevel: .05 }); K.box(C.flat(0x1a2a3a, .2), 4.0, .9, .05, 0, 4.1, .6, { rx: -.2 }); K.box(white, 4.0, 1.2, 3.0, 0, 4.2, -1.9, { bevel: .15 }); K.box(dark, 4.05, .4, 2.6, 0, 4.4, -1.9); K.cyl(metal, .04, .04, 2.2, 0, 5.8, -2.4, { seg: 6 }); }
    else if (kind === 'jet') { K.geo(C.flat(kind === 'jet' ? 0xe8e4dc : 0xffffff, .3), hullGeo([[-1.5, .55, .05, -.15, .45], [0, .6, .05, -.2, .5], [1.0, .4, .15, -.05, .52], [1.6, .05, .35, .25, .55]])); K.box(C.flat(0x1f8fb0, .35, .1), 1.05, .12, 1.6, 0, .52, .1, { bevel: .05 }); K.box(C.flat(0x14161a, .6), .45, .2, 1.3, 0, .62, -.5, { bevel: .08 }); K.box(dark, .5, .3, .4, 0, .75, .65, { bevel: .05 });
      K.box(C.flat(0xd8402a, .7), .4, .55, .28, 0, 1.15, -.35, { bevel: .1, rx: .4 }); K.sphere(C.flat(0x8a5a3e, .6), .12, 0, 1.55, -.18); K.box(C.flat(0x1e3a6a, .8), .36, .35, .5, 0, .85, -.55, { bevel: .08 }); K.cyl(C.flat(0x8a5a3e, .6), .045, .045, .55, .2, 1.1, -.05, { rx: 1.1, seg: 6 }); K.cyl(C.flat(0x8a5a3e, .6), .045, .045, .55, -.2, 1.1, -.05, { rx: 1.1, seg: 6 }); }
    else if (kind === 'sail') { K.geo(white, hullGeo([[-4, .9, .1, -.4, .7], [-1, 1.25, .05, -.6, .8], [2, 1.0, .15, -.4, .85], [4.2, .05, .6, .4, .95]])); K.box(C.flat(0xc8b08a, .7), 1.8, .45, 2.6, 0, 1.05, -.6, { bevel: .1 }); K.cyl(metal, .07, .07, 12, 0, 6.8, .5, { seg: 8 });
      const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute([0, 1.4, .55, 0, 12.4, .55, 0, 1.4, -3.4, 0, 1.6, .7, 0, 11.6, .7, 0, 1.6, 4.0], 3)); sg.setIndex([0, 1, 2, 3, 5, 4]); sg.computeVertexNormals(); K.geo(C.flat(0xf4f2ea, .8, 0, 'sail2'), sg); }
    else if (kind === 'cruise') { const hl = C.flat(0x1c2a44, .5), w2 = C.flat(0xeeeeea, .5); K.geo(hl, hullGeo([[-150, 18, 2, -8, 9], [-90, 19, 1, -9, 9.5], [60, 18, 2, -8, 9.5], [130, 9, 5, -4, 10], [155, .5, 9, 6, 11]])); K.box(w2, 34, 4, 250, 0, 11.5, -8);
      for (let i = 0; i < 6; i++) { K.box(w2, 32 - i * 1.2, 3.1, 220 - i * 18, 0, 15 + i * 3.1, -10 - i * 4); K.box(dark, 32.2 - i * 1.2, .9, 216 - i * 18, 0, 15.4 + i * 3.1, -10 - i * 4); } K.box(C.flat(0x2a5a9a, .5), 9, 10, 16, 0, 38, -60, { bevel: 1 }); K.box(dark, 9.1, 2, 16.1, 0, 41, -60); }
    const g = K.build(); g.traverse(o => { if (o.isMesh) { o.castShadow = kind !== 'cruise'; o.receiveShadow = true; } }); return g; }

  /* ---------------------------------------------------------------- BR: building the causeway */
  /** geometry in the bridge frame (s along, o across, y up) -> world; flat-shaded lofts, uv in metres, a grey vertex shade for joints and grime */
  function brAcc() { return { P: [], N: [], UV: [], Cl: [], I: [] }; }
  function brGeo(a) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(a.P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(a.N, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(a.UV, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(a.Cl, 3)); g.setIndex(new T.BufferAttribute(a.P.length / 3 > 65000 ? new Uint32Array(a.I) : new Uint16Array(a.I), 1)); return g; }
  function brKit(B) { const ux = B.u[0], uz = B.u[1], nx = B.n[0], nz = B.n[1], A0 = B.A[0], A1 = B.A[1];
    const vtx = (a, s, o, y, ns, no, ny, uu, vv, c) => { a.P.push(A0 + ux * s + nx * o, y, A1 + uz * s + nz * o); a.N.push(ux * ns + nx * no, ny, uz * ns + nz * no); a.UV.push(uu, vv); a.Cl.push(c, c, c); return a.P.length / 3 - 1; };
    /** loft a profile [[o, y], ...] (counter-clockwise seen from -s, o to the right) along stations ss; y += yf(s); prof may be a function of s; opt {closed, caps, cf(s) shade, uvf(s, o, y, v) -> [u, v]} */
    function loft(a, prof, ss, yf, opt) { opt = opt || {}; const pf = typeof prof === 'function' ? prof : () => prof, p0 = pf(ss[0]), np = p0.length, ne = opt.closed ? np : np - 1;
      for (let e = 0; e < ne; e++) { let base = -1;
        for (let j = 0; j < ss.length; j++) { const s = ss[j], pr = pf(s), p = pr[e], q = pr[(e + 1) % np], dO = q[0] - p[0], dY = q[1] - p[1], el = Math.hypot(dO, dY) || 1, y0 = yf ? yf(s) : 0, c = opt.cf ? opt.cf(s, e) : 1;
          let v0 = 0; for (let k = 0; k < e; k++) v0 += Math.hypot(pr[k + 1][0] - pr[k][0], pr[k + 1][1] - pr[k][1]);
          const uvp = opt.uvf ? opt.uvf(s, p[0], p[1], v0) : [s, v0], uvq = opt.uvf ? opt.uvf(s, q[0], q[1], v0 + el) : [s, v0 + el];
          const i0 = vtx(a, s, p[0], y0 + p[1], 0, dY / el, -dO / el, uvp[0], uvp[1], c); vtx(a, s, q[0], y0 + q[1], 0, dY / el, -dO / el, uvq[0], uvq[1], c);
          if (j > 0) { const pa = base, pb = base + 1, ca = i0, cb = i0 + 1; a.I.push(pa, cb, pb, pa, ca, cb); } base = i0; } }
      if (opt.caps) for (const end of [0, 1]) { const s = ss[end ? ss.length - 1 : 0], pr = pf(s), y0 = yf ? yf(s) : 0, c = opt.cf ? opt.cf(s, -1) : 1, ns = end ? 1 : -1;
        const tri = T.ShapeUtils.triangulateShape(pr.map(p => new T.Vector2(p[0], p[1])), []), b0 = a.P.length / 3; for (const p of pr) vtx(a, s, p[0], y0 + p[1], ns, 0, 0, p[0], p[1], c);
        for (const t of tri) { const [i, j, k] = t, ar = (pr[j][0] - pr[i][0]) * (pr[k][1] - pr[i][1]) - (pr[k][0] - pr[i][0]) * (pr[j][1] - pr[i][1]); if ((ar > 0) === !end) a.I.push(b0 + i, b0 + j, b0 + k); else a.I.push(b0 + i, b0 + k, b0 + j); } } }
    /** vertical round column at (s, o) from y0 to y1 */
    function col(a, s, o, y0, y1, r, seg, c) { if (c === undefined) c = 1; const b0 = a.P.length / 3; for (let i = 0; i <= seg; i++) { const t = i / seg * TAU, cs = Math.cos(t), sn = Math.sin(t); vtx(a, s + cs * r, o + sn * r, y0, cs, sn, 0, t * r, y0, c); vtx(a, s + cs * r, o + sn * r, y1, cs, sn, 0, t * r, y1, c); }
      for (let i = 0; i < seg; i++) { const bi = b0 + i * 2, ti = bi + 1, bj = bi + 2, tj = bi + 3; a.I.push(bi, ti, bj, ti, tj, bj); } }
    /** level box in the frame, optional chamfer on the vertical edges (ch) */
    function box(a, s0, s1, o0, o1, y0, y1, c, ch) { const p = ch ? [[o0 + ch, y0], [o1 - ch, y0], [o1, y0 + ch], [o1, y1], [o0, y1], [o0, y0 + ch]] : [[o0, y0], [o1, y0], [o1, y1], [o0, y1]]; loft(a, p, [s0, s1], null, { closed: true, caps: true, cf: c ? () => c : null }); }
    return { vtx, loft, col, box }; }

  function buildBridge(C) {
    const B = BRG, root = C.root, R = GT.rng('coast-bridge'), rr = (a, b) => a + (b - a) * R(), K = brKit(B), top = B.top, grp = new T.Group(); grp.name = 'coast_bridge'; root.add(grp);
    const wy = (x, z) => { const TR = GT.coastTerrain; return x > TR.PK ? .3 : TR.landY(x, z); };
    const ground = s => { const p = B.at(s, 0), q1 = B.at(s, 12.4), q2 = B.at(s, -12.4); return min(wy(p[0], p[1]), wy(q1[0], q1[1]), wy(q2[0], q2[1])); };
    /* ---- materials: the concrete is a photograph (assets/tex/coast/bridge_concrete.jpg) with world-scale variation, and a tide band painted by height: wet and dark up to ~1.3 m above the sea,
       green-black weed at the waterline, a pale salt line above it */
    function concMat(tint, key, bump) { const t = GT.tex.image('assets/tex/coast/bridge_concrete.jpg', { repeat: [1 / 6, 1 / 6] }), m = new T.MeshStandardMaterial({ map: t, color: tint, roughness: .9, metalness: 0, vertexColors: true }); if (bump) { m.bumpMap = t; m.bumpScale = bump; } m.name = 'br_' + key;
      if (GT.tex.addMacro) try { GT.tex.addMacro(m, [6, 6], [1 / 29, 1 / 53, .16, .08]); } catch (e) {}
      const prev = m.onBeforeCompile; m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBrW;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vBrW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBrW;').replace('#include <map_fragment>', `#include <map_fragment>
          { float hy = vBrW.y + 1.0, nz = texture2D(map, vUv * 0.31 + 0.17).g, nz2 = texture2D(map, vBrW.xz * 0.05 + vec2(vBrW.y * 0.02)).r;
            float wet = 1.0 - smoothstep(1.15 + 0.5 * nz2, 2.1 + 0.7 * nz, hy), weed = 1.0 - smoothstep(0.15, 0.8 + 0.4 * nz, hy), salt = smoothstep(1.9, 2.3, hy) * (1.0 - smoothstep(2.4, 3.3 + nz, hy));
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.46, 0.47, 0.42), wet); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055, 0.075, 0.045), weed * 0.88); diffuseColor.rgb *= 1.0 + 0.1 * salt * (1.0 - wet); }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.42, 1.0 - smoothstep(0.9, 1.9, vBrW.y + 1.0));'); };
      m.customProgramCacheKey = () => 'br_conc'; return m; }
    const conc = concMat(0xb2b8ba, 'conc'), concL = concMat(0xc6ccd0, 'concL', .01), wall = concMat(0xacb0b0, 'wall');
    /* the carriageway: one 19.2 x 24 m tile painted in a canvas from the asphalt photograph (wheel tracks, dust by the barriers, lane paint worn through, reflective studs) */
    const RW = 1024, RH = 1280, rc = document.createElement('canvas'); rc.width = RW; rc.height = RH; const rt = new T.CanvasTexture(rc); rt.encoding = T.sRGBEncoding; rt.wrapS = T.ClampToEdgeWrapping; rt.wrapT = T.RepeatWrapping; rt.anisotropy = 8;
    function paintRoad(img) { const g = rc.getContext('2d'), ppm = RW / 19.2, X = o => (o + 9.6) * ppm, Rr = GT.rng('br-road'); g.fillStyle = '#5c5c5a'; g.fillRect(0, 0, RW, RH);
      if (img) { const pc = document.createElement('canvas'); pc.width = img.height; pc.height = img.width; const pg = pc.getContext('2d'); pg.translate(pc.width, 0); pg.rotate(HP); pg.drawImage(img, 0, 0);
        const pat = g.createPattern(pc, 'repeat'), sc = ppm * 5.2 / img.width; pat.setTransform && pat.setTransform(new DOMMatrix([sc, 0, 0, sc, 0, 0])); g.fillStyle = pat; g.fillRect(0, 0, RW, RH);
        pat.setTransform && pat.setTransform(new DOMMatrix([-sc, 0, 0, -sc, RW * .37, RH * .61])); g.globalAlpha = .5; g.fillRect(0, 0, RW, RH); g.globalAlpha = 1; }   /* a second pass, flipped and shifted, halves the photo's repair patches */
      const band = (o, w, col, a) => { const gr = g.createLinearGradient(X(o - w), 0, X(o + w), 0); gr.addColorStop(0, 'rgba(' + col + ',0)'); gr.addColorStop(.5, 'rgba(' + col + ',' + a + ')'); gr.addColorStop(1, 'rgba(' + col + ',0)'); g.fillStyle = gr; g.fillRect(X(o - w), 0, X(o + w) - X(o - w), RH); };
      for (const lc of [-6.6, -3.0, 3.0, 6.6]) { band(lc - .88, .32, '18,18,20', .2); band(lc + .88, .32, '18,18,20', .2); band(lc, .3, '30,26,22', .12); }
      for (const o of [-9.3, -.75, .75, 9.3]) band(o, .45, '205,196,178', .16);
      const line = (o, w, col, dash) => { g.fillStyle = col; for (let y = 0; y < RH; y += 2) { const m = y / RH * 24; if (dash && !((m >= 2 && m < 5) || (m >= 14 && m < 17))) continue; const wob = (Rr() - .5) * .6; g.globalAlpha = .82 + .14 * Rr(); g.fillRect(X(o - w / 2) + wob, y, w * ppm, 2); } g.globalAlpha = 1; };
      for (const s of [-1, 1]) { line(s * 1.2, .15, '#d8ae3c'); line(s * 8.4, .15, '#e9e7e0'); line(s * 4.8, .15, '#e9e7e0', true); }
      if (img) { const pc2 = document.createElement('canvas'); pc2.width = 64; pc2.height = 64; pc2.getContext('2d').drawImage(img, 0, 0, 64, 64); for (let i = 0; i < 2600; i++) { const o = [-8.4, -4.8, -1.2, 1.2, 4.8, 8.4][i % 6], y = Rr() * RH; g.globalAlpha = .35 + .4 * Rr(); g.drawImage(pc2, Rr() * 50, Rr() * 50, 6, 6, X(o) - 4 + Rr() * 5, y, 3 + Rr() * 5, 2 + Rr() * 6); } g.globalAlpha = 1; }
      for (const o of [-4.8, 4.8]) for (const m of [9.5, 21.5]) { g.fillStyle = '#f2efe4'; g.fillRect(X(o) - 3, m / 24 * RH - 3, 6, 6); }
      for (const o of [-1.2, 1.2]) for (const m of [3.5, 15.5]) { g.fillStyle = '#e6c04a'; g.fillRect(X(o) - 3, m / 24 * RH - 3, 6, 6); }
      rt.needsUpdate = true; }
    paintRoad(null); if (GT.tex.imageEl) GT.tex.imageEl('assets/tex/coast/bridge_asphalt.jpg', paintRoad);
    const asph = new T.MeshStandardMaterial({ map: rt, color: 0xd6d4d0, roughness: .9, metalness: 0, vertexColors: true }); asph.bumpMap = rt; asph.bumpScale = .008; asph.name = 'br_road';
    if (GT.tex.addMacro) try { GT.tex.addMacro(asph, [1, 1], [1 / 23, 1 / 41, .1, .08], { world: 1, patch: .45, wet: .5 }); } catch (e) {}
    /* railing on the parapets: galvanised posts and rails, alpha-tested */
    const rlc = document.createElement('canvas'); rlc.width = 256; rlc.height = 64; { const g = rlc.getContext('2d'); g.clearRect(0, 0, 256, 64); g.fillStyle = '#c8ccd0'; g.fillRect(0, 0, 256, 7); g.fillRect(0, 30, 256, 4); g.fillRect(0, 58, 256, 6); for (let x = 0; x < 256; x += 16) g.fillRect(x, 0, 4, 64); g.fillRect(0, 0, 9, 64); }
    const rlt = new T.CanvasTexture(rlc); rlt.wrapS = T.RepeatWrapping; rlt.anisotropy = 4; const rail = new T.MeshStandardMaterial({ map: rlt, alphaTest: .5, side: T.DoubleSide, roughness: .45, metalness: .65, color: 0xb8bcc0 }); rail.name = 'br_rail';
    /* ---- chunks of ~230 m: the structure, and the small things that switch off past 520 m */
    const CHL = 230, CH = [];
    const chunk = s => { const i = max(0, Math.floor((s - B.S0) / CHL)); if (!CH[i]) CH[i] = { conc: brAcc(), concL: brAcc(), wall: brAcc(), asph: brAcc(), rail: brAcc(), det: brAcc(), K: GT.kit(), s0: B.S0 + i * CHL }; return CH[i]; };
    const steps = (s0, s1, d) => { const nn = max(1, Math.ceil((s1 - s0) / d)), o = []; for (let i = 0; i <= nn; i++) o.push(s0 + (s1 - s0) * i / nn); return o; };
    /* stations of a span with a dark expansion-joint line at both ends (the deck pieces meet on the piers) */
    const jointSt = (s0, s1, d) => { const o = steps(s0 + .06, s1 - .06, d); o.unshift(s0, s0 + .03); o.push(s1 - .03, s1); return o; }, jointC = (s0, s1) => s => (s - s0 < .045 || s1 - s < .045) ? .42 : 1;
    const DECKL = [[9.6, -.02], [9.6, .075], [9.78, .33], [9.86, .81], [10.1, .81], [10.1, .15], [12.0, .15], [12.0, .7], [12.4, .7]], DK_R = DECKL.slice().reverse(), DK_L = DECKL.map(p => [-p[0], p[1]]);
    const MED = [[-.4, -.02], [.4, -.02], [.4, .075], [.22, .33], [.1, .81], [-.1, .81], [-.22, .33], [-.4, .075]];
    const SLAB = [[-12.4, .7], [-12.4, -.62], [-11.9, -.62], [-11.9, -.36], [11.9, -.36], [11.9, -.62], [12.4, -.62], [12.4, .7]];
    const GIRD = [[-.45, -.36], [-.45, -.47], [-.1, -.6], [-.1, -1.58], [-.33, -1.73], [-.33, -1.96], [.33, -1.96], [.33, -1.73], [.1, -1.58], [.1, -.6], [.45, -.47], [.45, -.36]];
    const GO = [-10.85, -7.75, -4.65, -1.55, 1.55, 4.65, 7.75, 10.85];
    /** the deck surface pieces between two stations: road, barriers, sidewalks, parapets, median; the underside comes from the caller */
    function deckTop(c, s0, s1, d) { const ss = jointSt(s0, s1, d), cf = jointC(s0, s1);
      K.loft(c.asph, [[9.6, 0], [-9.6, 0]], ss, top, { cf, uvf: (s, o) => [(o + 9.6) / 19.2, s / 24] });
      K.loft(c.concL, DK_L, ss, top, { cf }); K.loft(c.concL, DK_R, ss, top, { cf });
      K.loft(c.concL, MED, ss, top, { closed: true, cf });
      for (const sg of [-1, 1]) K.loft(c.rail, [[sg * 12.2, .7], [sg * 12.2, 1.32]], ss.filter((q, i) => i % 2 === 0 || i === ss.length - 1), top, { uvf: (s, o, y) => [s / 4.1, y > 1 ? 1 : 0] }); }
    const P = B.piers;
    /* ---- the land approach: road on grade, then a fill embankment between precast panel walls up to the abutment at SA */
    { const s0 = B.S0, s1 = B.SA; for (let a = s0; a < s1 - 1; a += 40) { const b = min(s1, a + 40), c = chunk((a + b) / 2); deckTop(c, a, b, 4);
        const E = s => { const gnd = ground(s) - .6 - top(s); return [[-12.4, .7], [-12.4, gnd], [12.4, gnd], [12.4, .7]]; }; K.loft(c.wall, E, steps(a, b, 4), top, { uvf: (s, o, y, v) => [s, v] }); }
      const c = chunk(s1 - 1), gb = ground(s1) - .6 - top(s1); K.loft(c.wall, [[-12.4, -.05], [-12.4, gb], [12.4, gb], [12.4, -.05]], [s1 - .02, s1], top, { closed: true, caps: true }); }
    /* ---- the island end: abutment at SB, embankment onto the key, then the road ends in a turning circle */
    { const s0 = B.SB, s1 = B.L + 20; for (let a = s0; a < s1 - 1; a += 40) { const b = min(s1, a + 40), c = chunk((a + b) / 2); deckTop(c, a, b, 4);
        const E = s => { const gnd = min(.3, top(s) - 2.5) - top(s); return [[-12.4, .7], [-12.4, gnd], [12.4, gnd], [12.4, .7]]; }; K.loft(c.wall, E, steps(a, b, 4), top); }
      const c = chunk(s0 + 1), gb = min(.3, top(s0) - 2.5) - top(s0) - .6; K.loft(c.wall, [[-12.4, -.05], [-12.4, gb], [12.4, gb], [12.4, -.05]], [s0, s0 + .02], top, { closed: true, caps: true }); }
    /* ---- spans */
    for (let i = 0; i < P.length - 1; i++) { const p = P[i], q = P[i + 1], c = chunk((p.s + q.s) / 2), box = (p.kind === 'flank' && q.kind === 'main') || p.kind === 'main';
      deckTop(c, p.s, q.s, 3.6);
      if (!box) { /* precast I-girders under a cast slab, end diaphragms over the piers and one at mid-span */
        K.loft(c.conc, SLAB, jointSt(p.s, q.s, 4), top, { cf: jointC(p.s, q.s) });
        const ya = top(p.s), yb = top(q.s), sa = p.s + .35, sb = q.s - .35, yl = s => lerp(ya, yb, (s - p.s) / (q.s - p.s));
        for (const go of GO) K.loft(c.conc, GIRD.map(v => [v[0] + go, v[1]]), [sa, sb], yl, { closed: true, caps: true });
        for (const [s, w] of [[p.s + .6, .5], [q.s - .6, .5], [(p.s + q.s) / 2, .25]]) { const y = yl(s); K.box(c.conc, s - w / 2, s + w / 2, -11.3, 11.3, y - (w > .3 ? 1.8 : 1.45), y - .45); } }
      else { /* the channel unit: a haunched box girder in precast segments (a joint line every 3.6 m) */
        const prof = s => { const d = B.boxD(s); return [[-12.4, .7], [-12.4, -.62], [-9.3, -.95], [-7.2, -d], [7.2, -d], [9.3, -.95], [12.4, -.62], [12.4, .7]]; };
        const ss = [], seg = 3.6; for (let s = p.s; s < q.s - .01; s += seg) { const e = min(q.s, s + seg); ss.push(s, s + .03, s + .06); for (const t of steps(s + .06, e - .06, 1.2)) ss.push(t); ss.push(e - .03); } ss.push(q.s);
        const uniq = ss.filter((v, i) => i === 0 || v > ss[i - 1] + 1e-4); K.loft(c.conc, prof, uniq, top, { cf: s => { const f = ((s - p.s) % seg + seg) % seg; return f < .045 || seg - f < .015 ? .5 : 1; } }); } }
    /* ---- piers */
    const FOOT = s => { const gd = ground(s); return gd > SEA + .3 ? gd - .25 : SEA + .45; };
    for (const p of P) { const c = chunk(p.s), y = top(p.s);
      if (p.kind === 'abut') { /* a seat wall on the beach / the key with riprap round its toe */
        const sd = p.s === B.SA ? -1 : 1; K.box(c.conc, p.s - 1.2, p.s + 1.2, -12.0, 12.0, y - 3.2, y - 1.96, .7);
        for (let k = 0; k < 38; k++) { const o = rr(-14, 14), ds = rr(.5, 7) * -sd, r0 = rr(.5, 1.2), q = B.at(p.s + ds + sd * 2.5, o); c.K.sphere(C.flat(0x8a8478, .95, 0, 'brrip'), r0, q[0], ground(p.s + ds) - r0 * .35, q[1], { s: [1, .65, 1.2], seg: 6, seg2: 4 }); }
        continue; }
      if (p.kind === 'bent') { const yc = y - 2.06; K.box(c.conc, p.s - .95, p.s + .95, -12.0, 12.0, yc - 1.4, yc, 1, .18);
        const ft = FOOT(p.s); K.box(c.conc, p.s - 1.4, p.s + 1.4, -11.6, 11.6, SEA - 1.8, ft, 1, .25);
        for (const o of [-9.9, -3.9, 3.9, 9.9]) K.col(c.conc, p.s, o, ft - .1, yc - 1.38, .65, 14);
        for (const go of GO) for (const sg of [-1, 1]) K.box(c.det, p.s + sg * .55 - .2, p.s + sg * .55 + .2, go - .3, go + .3, yc, yc + .1, .5);
        continue; }
      /* the channel piers: hammerhead caps on two chamfered wall columns, big pile caps at the waterline; fender piles along the channel at the main piers */
      const big = p.kind === 'main', d = B.boxD(p.s), yc = y - d - .1, hs = big ? 2.0 : 1.6, cs = big ? 1.25 : 1.0, co = big ? 1.7 : 1.4;
      K.loft(c.conc, [[-9.6, -2.4], [-7.6, -2.4], [-7.6, -2.7], [7.6, -2.7], [7.6, -2.4], [9.6, -2.4], [9.6, 0], [-9.6, 0]].map(q => [q[0], q[1] * (big ? 1 : .85)]), [p.s - hs, p.s + hs], () => yc, { closed: true, caps: true });
      const fh = big ? [4.6, 14.2] : [3.3, 13.2], ft = SEA + (big ? 1.1 : .8); K.box(c.conc, p.s - fh[0], p.s + fh[0], -fh[1], fh[1], SEA - 2.4, ft, 1, .5);
      for (const o of [-6.0, 6.0]) K.box(c.conc, p.s - cs, p.s + cs, o - co, o + co, ft - .1, yc - (big ? 2.65 : 2.25), 1, .35);
      if (!big) { const sg = p.s < B.SC ? -1 : 1; K.box(c.conc, min(p.s + sg * .25, p.s + sg * 1.5), max(p.s + sg * .25, p.s + sg * 1.5), -11.6, 11.6, yc - .02, y - 2.06, .85); }
      if (big) { const sg = p.s < B.SC ? 1 : -1, sf = p.s + sg * 6.5, timber = C.flat(0x4c3e30, .9, 0, 'brfender');
        for (let o = -34; o <= 34; o += 2.6) { const q = B.at(sf, o); c.K.cyl(timber, .2, .22, 4.4, q[0], SEA + .9, q[1], { seg: 7 }); }
        for (const yy of [1.2, 2.4]) { const q = B.at(sf - sg * .25, 0); c.K.box(timber, .3, .35, 68, q[0], SEA + yy, q[1], { ry: B.h + HP }); }
        for (const o of [-34, 34]) { const q = B.at(sf, o); c.K.box(C.glow(0xff2a1a, .3, 5, 'brnavR'), .3, .3, .3, q[0], SEA + 3.3, q[1]); } } }
    /* green channel-centre lights under both fascias */
    for (const sg of [-1, 1]) { const q = B.at(B.SC, sg * 12.5), c = chunk(B.SC); c.K.box(C.glow(0x2aff7a, .4, 6, 'brnavG'), .35, .35, .35, q[0], top(B.SC) - 1.2, q[1]); }
    /* ---- lamps: cobra heads on 11 m poles on both parapets every 42 m, warm pools on the road at night */
    const pole = C.flat(0x8c9196, .42, .55, 'brpole'), head = C.flat(0x50555a, .5, .5, 'brhead'), lens = C.glow(0xffe0b0, .05, 7, 'brlens'); pole.name = head.name = 'co_thin';
    const plc = document.createElement('canvas'); plc.width = plc.height = 128; { const g = plc.getContext('2d'), gr = g.createRadialGradient(64, 64, 2, 64, 64, 64); gr.addColorStop(0, 'rgba(255,205,140,.55)'); gr.addColorStop(.3, 'rgba(255,185,110,.3)'); gr.addColorStop(.65, 'rgba(255,165,90,.09)'); gr.addColorStop(1, 'rgba(255,150,70,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    const poolM = new T.MeshBasicMaterial({ map: new T.CanvasTexture(plc), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); poolM.name = 'br_pool';
    const pools = brAcc(), lampS = [];
    for (let s = B.LS0; s < B.S1 - 20; s += B.LSP) { if (s > B.SA - 25 && s < B.SA + 5) continue; lampS.push(s);
      for (const sg of [-1, 1]) { const c = chunk(s), q = B.at(s, sg * 12.2), y = top(s) + .7, dir = [-sg * B.n[0], -sg * B.n[1]], ry = Math.atan2(dir[0], dir[1]), Kk = c.K;
        Kk.push(q[0], y, q[1], { ry }); Kk.box(pole, .42, .25, .42, 0, .12, 0, { bevel: .03 }); Kk.cyl(pole, .085, .15, 11, 0, 5.5, 0, { seg: 8 }); Kk.tube(pole, [[0, 10.9, 0], [0, 11.25, .5], [0, 11.42, 1.4], [0, 11.38, 2.4]], .055, { seg: 6 });
        Kk.box(head, .36, .16, .82, 0, 11.36, 2.75, { bevel: .05 }); Kk.box(lens, .26, .03, .58, 0, 11.27, 2.78); Kk.pop();
        const s0 = s - 17, s1 = s + 17, oc = sg * 6.9, b0 = pools.P.length / 3; for (const [ss, oo, uu, vv] of [[s0, oc - 5.4, 0, 0], [s1, oc - 5.4, 1, 0], [s1, oc + 5.4, 1, 1], [s0, oc + 5.4, 0, 1]]) K.vtx(pools, ss, oo, top(ss) + .04, 0, 0, 1, uu, vv, 1);
        pools.I.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2); } }
    { const m = new T.Mesh(brGeo(pools), poolM); m.renderOrder = 3; m.frustumCulled = false; m.name = 'br_pools'; grp.add(m); }
    const glowP = []; for (const s of lampS) for (const sg of [-1, 1]) { const q = B.at(s, sg * 9.45); glowP.push(q[0], top(s) + .7 + 11.2, q[1]); }
    const glowG = new T.BufferGeometry(); glowG.setAttribute('position', new T.Float32BufferAttribute(glowP, 3));
    const glowM = new T.ShaderMaterial({ uniforms: { uK: { value: 0 }, uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: 'uniform float uScale; varying float vF; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float px = 2.2 * uScale / max(1.0, -mv.z); vF = clamp(px / 2.5, 0.35, 1.0); gl_PointSize = max(2.5, px); }',
      fragmentShader: 'uniform float uK; varying float vF; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = (exp(-r * r * 7.0) + 0.15 * exp(-r * r * 2.5)) * (1.0 - smoothstep(0.75, 1.0, r)); if (a * uK < 0.004) discard; gl_FragColor = vec4(vec3(1.0, 0.82, 0.6) * a * uK * 1.7 * vF, 1.0); }' });
    glowM.name = 'br_lampglow'; { const pts = new T.Points(glowG, glowM); pts.frustumCulled = false; pts.renderOrder = 5; pts.name = 'br_lampglow'; grp.add(pts); }
    /* ---- guide signs on cantilever posts (green, reflective white letters) */
    function signTex(lines, w, h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.fillStyle = '#0d6a3c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#f4f4ee'; g.lineWidth = h * .035; const r = h * .07, i = h * .05;
      g.beginPath(); g.moveTo(i + r, i); g.arcTo(w - i, i, w - i, h - i, r); g.arcTo(w - i, h - i, i, h - i, r); g.arcTo(i, h - i, i, i, r); g.arcTo(i, i, w - i, i, r); g.closePath(); g.stroke();
      g.fillStyle = '#f4f4ee'; g.textAlign = 'center'; g.textBaseline = 'middle'; for (const [t, y, sz, wt] of lines) { g.font = (wt || 700) + ' ' + Math.round(h * sz) + 'px "PingFang SC", "Helvetica Neue", sans-serif'; g.fillText(t, w / 2, h * y, w * .9); }
      const tx = new T.CanvasTexture(cv); tx.encoding = T.sRGBEncoding; tx.anisotropy = 8; return tx; }
    const signM = (lines) => { const m = new T.MeshStandardMaterial({ map: signTex(lines, 1024, 384), roughness: .5, metalness: .1, emissive: 0xffffff, emissiveIntensity: 0 }); m.emissiveMap = m.map; C.NIGHT.push([m, 0, .35]); return m; };
    const gantry = C.flat(0x9ea3a8, .45, .6, 'brgantry');
    for (const [s, sg, lines] of [[-30, 1, [['月湾群岛', .36, .3], ['MOONBAY KEYS', .68, .17, 600]]], [B.L - 60, -1, [['维尔蒙港 · 月湾', .36, .27], ['PORT VERMONT  ·  MOONBAY', .68, .15, 600]]], [B.SC - 260, 1, [['限速 60', .5, .38]]]]) {
      const c = chunk(s), Kk = c.K, pw = lines.length > 1 ? 7.2 : 2.6, ph = lines.length > 1 ? 2.7 : 1.6, oc = sg * (lines.length > 1 ? 5.0 : 10.6), q = B.at(s, sg * 11.1), y = top(s), ry = sg > 0 ? B.h + PI : B.h;
      if (lines.length > 1) { Kk.cyl(gantry, .2, .24, 8.2, q[0], y + .15 + 4.1, q[1], { seg: 10 }); const a = B.at(s, (sg * 11.1 + oc) / 2); Kk.box(gantry, .25, .3, abs(sg * 11.1 - oc) + 3.6, a[0], y + 7.6, a[1], { ry: B.h + HP }); }
      const pm = signM(lines), cq = B.at(s + (sg > 0 ? -.2 : .2), oc); Kk.push(cq[0], y + (lines.length > 1 ? 7.6 : 2.6), cq[1], { ry }); Kk.quad(pm, pw, ph, 0, 0, 0); Kk.box(gantry, pw + .1, ph + .1, .08, 0, 0, -.06); Kk.pop();
      if (lines.length === 1) { const b = B.at(s + (sg > 0 ? .1 : -.1), oc); Kk.cyl(gantry, .05, .05, 2.4, b[0], y + .9, b[1], { seg: 6 }); } }
    /* ---- build the chunks */
    const LODS = [];
    for (const c of CH) { if (!c) continue; const g = new T.Group(), det = new T.Group(); g.name = 'br_chunk'; det.name = 'br_detail';
      for (const [k, m, cast] of [['conc', conc, true], ['concL', concL, true], ['wall', wall, true], ['asph', asph, false], ['rail', rail, false], ['det', conc, false]]) { const a = c[k]; if (!a.I.length) continue; const mesh = new T.Mesh(brGeo(a), m); mesh.castShadow = cast; mesh.receiveShadow = true; (k === 'rail' || k === 'det' ? det : g).add(mesh); }
      const kg = c.K.build({ cast: true }); kg.traverse(o => { if (o.isMesh && o.material && o.material.name === 'co_thin') o.castShadow = false; }); g.add(kg); g.add(det); grp.add(g);
      const sm = c.s0 + CHL / 2, cp = B.at(sm, 0); LODS.push({ det, x: cp[0], y: top(sm), z: cp[1] }); }
    /* ---- traffic: ~120 cars on the four lanes (one instanced body, lamps and, at night, headlight beams on the road; all share the instance matrices) */
    const cars = [], CN = 132, bodyG = carGeo(), cm = new T.MeshStandardMaterial({ vertexColors: true, roughness: .32, metalness: .45 }); cm.name = 'br_cars';
    const im = new T.InstancedMesh(bodyG, cm, CN), PAL = [0xf2f2f0, 0xf2f2f0, 0x18191c, 0x18191c, 0x8a8e94, 0xb8bcc2, 0x23344a, 0xa31c1c, 0xd8d4c8, 0x2a5a8a, 0x3c4a3a, 0x6c6e72, 0xe8e6e2, 0x4a1e24];
    let ci = 0; for (const lo of B.lanes) { const dir = lo > 0 ? 1 : -1, fast = abs(lo) < 4, nl = CN / 4; let s = B.S0 + rr(0, 30); for (let k = 0; k < nl && ci < CN; k++) { const kind = R() < .07 ? 2 : R() < .35 ? 1 : 0;
        cars.push({ o: lo + rr(-.15, .15), dir, s, v: (fast ? rr(25, 29) : rr(20, 24)), sc: kind === 2 ? [1.12, 1.55, 1.85] : kind === 1 ? [1.04, 1.14, 1.04] : [rr(.96, 1.02), 1, rr(.95, 1.05)] }); im.setColorAt(ci, new T.Color(PAL[(R() * PAL.length) | 0])); ci++; s += (B.S1 - B.S0 - 20) / nl * rr(.55, 1.45); } }
    im.instanceColor.needsUpdate = true; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.name = 'br_cars'; im.count = cars.length; grp.add(im);
    const lampM = new T.MeshBasicMaterial({ vertexColors: true }); lampM.name = 'br_carlamps'; const lim = new T.InstancedMesh(carLampGeo(), lampM, CN); lim.instanceMatrix = im.instanceMatrix; lim.frustumCulled = false; lim.count = cars.length; grp.add(lim);
    const bc = document.createElement('canvas'); bc.width = 64; bc.height = 128; { const g = bc.getContext('2d'), gr = g.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(255,240,215,.7)'); gr.addColorStop(.25, 'rgba(255,235,205,.3)'); gr.addColorStop(.6, 'rgba(255,230,200,.08)'); gr.addColorStop(1, 'rgba(255,230,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 128); const ge = g.createLinearGradient(0, 0, 64, 0); ge.addColorStop(0, 'rgba(0,0,0,1)'); ge.addColorStop(.42, 'rgba(0,0,0,.15)'); ge.addColorStop(.5, 'rgba(0,0,0,0)'); ge.addColorStop(.58, 'rgba(0,0,0,.15)'); ge.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = ge; g.fillRect(0, 0, 64, 128); }
    const beamM = new T.MeshBasicMaterial({ map: new T.CanvasTexture(bc), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }); beamM.name = 'br_beams';
    const beamG = new T.PlaneGeometry(3.0, 13); beamG.rotateX(-HP); beamG.translate(0, .06, 8.6); const bim = new T.InstancedMesh(beamG, beamM, CN); bim.instanceMatrix = im.instanceMatrix; bim.frustumCulled = false; bim.count = cars.length; bim.renderOrder = 4; bim.visible = false; grp.add(bim);
    const mtx = new T.Matrix4(), qq = new T.Quaternion(), eu = new T.Euler(0, 0, 0, 'YXZ'), pp = new T.Vector3(), scv = new T.Vector3(), cam = new T.Vector3(), zero = new T.Vector3(0, 0, 0), span = B.S1 - B.S0 - 10;
    const NG = cars.length * 2, cgP = new Float32Array(NG * 3), cgC = new Float32Array(NG * 3); for (let i = 0; i < cars.length; i++) { cgC.set([1, .92, .78], i * 6); cgC.set([1, .07, .03], i * 6 + 3); }
    const cgG = new T.BufferGeometry(); cgG.setAttribute('position', new T.BufferAttribute(cgP, 3)); cgG.setAttribute('color', new T.BufferAttribute(cgC, 3));
    const cgM = new T.ShaderMaterial({ uniforms: { uK: { value: 0 }, uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: 'attribute vec3 color; uniform float uScale; varying vec3 vC; varying float vF; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float px = 1.7 * uScale / max(1.0, -mv.z); vF = clamp(px / 2.0, 0.5, 1.0); gl_PointSize = max(2.2, px); vC = color; }',
      fragmentShader: 'uniform float uK; varying vec3 vC; varying float vF; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-r * r * 6.0) * (1.0 - smoothstep(0.8, 1.0, r)); if (a * uK < 0.004) discard; gl_FragColor = vec4(vC * a * uK * 2.4 * vF, 1.0); }' });
    cgM.name = 'br_carglow'; const cgPts = new T.Points(cgG, cgM); cgPts.frustumCulled = false; cgPts.renderOrder = 5; cgPts.visible = false; cgPts.name = 'br_carglow'; grp.add(cgPts);
    /* near the lens the game's own car models (js/cnvehicles.js) stand in for the eight nearest instanced cars; the instance takes the model's paint the first time, so nothing pops but the shape at 110 m */
    /* where the lens is this frame: a pinned still (GT.coast.pinCamera or ?cam=&look=) is applied after the parts update, so read it from there */
    const CAMQ = (() => { const c = C.QS && C.QS.get('cam'), l = C.QS && C.QS.get('look'); if (!c || !l) return null; const v = c.split(',').map(Number); return v.length === 3 && v.every(isFinite) ? v : null; })();
    const camAt = () => { const st = GT.coast && GT.coast.state; if (st && st.cam && st.cam.p) return st.cam.p; if (CAMQ) return CAMQ; const c = GT.cngame && GT.cngame.camera; return c ? [c.position.x, c.position.y, c.position.z] : null; };
    const HERO = []; { const CV = GT.cnvehicles; if (CV && CV.make) ['sedan', 'suv', 'hatch', 'sedan', 'pickup', 'suv', 'sedan', 'hatch'].forEach((kd, i) => { try { const col = [0xe8e6e2, 0x1a1c20, 0x8a8e94, 0x23344a, 0xb8bcc2, 0x5c1a20, 0xd8d4c8, 0x2a5a8a][i], v = CV.make(kd, { color: col });
      if (v && v.group) { v.group.visible = false; v.group.name = 'br_hero'; grp.add(v.group); HERO.push({ v, col: new T.Color(col), car: -1, lit: null }); } } catch (e) { console.warn('[coast] bridge car model', e); } }); }
    function update(dt) { const env = GT.env || {}, night = env.night || 0, h = env.hours || 15, k = max(night, cl((h - 18.6) / 1.2, 0, 1) * .8, cl((6.6 - h) / .8, 0, 1));
      poolM.opacity = cl(k * 1.15, 0, 1) * .42; glowM.uniforms.uK.value = k; beamM.opacity = cl(k * 1.2, 0, 1) * .22; bim.visible = k > .02; lampM.color.setScalar(lerp(.55, 3.2, k));
      for (let i = 0; i < cars.length; i++) { const c = cars[i]; c.s += c.dir * c.v * dt; if (c.s > B.S1 - 5) c.s -= span; else if (c.s < B.S0 + 5) c.s += span;
        const y = top(c.s), sl = (top(c.s + 2) - top(c.s - 2)) / 4 * c.dir, q = B.at(c.s, c.o); c.x = q[0]; c.y = y; c.z = q[1]; c.rx = -Math.atan(sl); c.ry = c.dir > 0 ? B.h : B.h + PI;
        pp.set(c.x, y, c.z); eu.set(c.rx, c.ry, 0); qq.setFromEuler(eu); scv.set(c.sc[0], c.sc[1], c.sc[2]); mtx.compose(pp, qq, scv); im.setMatrixAt(i, mtx); }
      const cpa = camAt(); if (HERO.length && cpa) { const near = [];
        for (let i = 0; i < cars.length; i++) { const c = cars[i]; if (c.sc[1] > 1.3) continue; const d2 = (c.x - cpa[0]) ** 2 + (c.y - cpa[1]) ** 2 + (c.z - cpa[2]) ** 2; if (d2 < 110 * 110) near.push([d2, i]); }
        near.sort((a, b) => a[0] - b[0]); const want = near.slice(0, HERO.length).map(q => q[1]);
        for (const h of HERO) if (h.car >= 0 && want.indexOf(h.car) < 0) { h.car = -1; h.v.group.visible = false; }
        for (const i of want) if (!HERO.some(h => h.car === i)) { const h = HERO.find(q => q.car < 0); if (!h) break; h.car = i; im.setColorAt(i, h.col); im.instanceColor.needsUpdate = true; }
        const on = k > .3; for (const h of HERO) { if (h.car < 0) continue; const c = cars[h.car], g = h.v.group; g.visible = true; g.position.set(c.x, c.y, c.z); g.rotation.set(c.rx, c.ry, 0, 'YXZ');
          if (h.lit !== on && h.v.setLights) { h.lit = on; try { h.v.setLights({ head: on }); } catch (e) {} } pp.set(c.x, c.y, c.z); mtx.compose(pp, qq, zero); im.setMatrixAt(h.car, mtx); } }
      im.instanceMatrix.needsUpdate = true;
      cgPts.visible = k > .02; cgM.uniforms.uK.value = k; cgM.uniforms.uScale.value = glowM.uniforms.uScale.value;
      if (cgPts.visible) { for (let i = 0; i < cars.length; i++) { const c = cars[i], hero = HERO.some(h => h.car === i), fx = Math.sin(c.ry), fz = Math.cos(c.ry), L2 = 2.3 * c.sc[2], hy = c.y + .75 * c.sc[1];
          if (hero) { cgP[i * 6 + 1] = cgP[i * 6 + 4] = -999; continue; } cgP.set([c.x + fx * L2, hy, c.z + fz * L2], i * 6); cgP.set([c.x - fx * L2, hy + .05, c.z - fz * L2], i * 6 + 3); } cgG.attributes.position.needsUpdate = true; }
      const cm2 = GT.cngame && GT.cngame.camera; if (cm2 && cpa) { cam.set(cpa[0], cpa[1], cpa[2]); { const Rd = GT.render && GT.render.renderer, hp = Rd ? Rd.domElement.height : innerHeight; glowM.uniforms.uScale.value = hp / (2 * Math.tan((cm2.fov || 50) * PI / 360)); } for (const l of LODS) l.det.visible = Math.hypot(cam.x - l.x, cam.y - l.y, cam.z - l.z) < 520; } }
    update(0); return { update, group: grp, cars, heroes: HERO }; }

  /** a car for the bridge traffic (local: +z forward, y up from the road, instance colour = paint; vertex shade darkens glass, tyres and trim) */
  function carGeo() { const parts = [];
    const add = (g, c) => { const n = g.attributes.position.count, cl3 = new Float32Array(n * 3).fill(c); g.setAttribute('color', new T.BufferAttribute(cl3, 3)); parts.push(g); };
    const bx = (w, h, d, x, y, z, c, bev, taper) => { const g = GT.boxGeo(w, h, d, bev || 0); if (taper) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * taper[0]); p.setZ(i, p.getZ(i) * taper[1] + (taper[2] || 0)); } g.computeVertexNormals(); } g.translate(x, y, z); add(g, c); };
    { const g = GT.boxGeo(1.84, .56, 4.5, .12), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), z = p.getZ(i); if (y > 0) p.setY(i, y - .2 * sst(abs(z), 1.45, 2.25) * (z > 0 ? 1 : .6)); } g.computeVertexNormals(); g.translate(0, .58, 0); add(g, 1); }
    bx(1.8, .2, 4.56, 0, .38, 0, .22, .06); bx(1.62, .5, 2.4, 0, 1.1, -.25, .2, .1, [.84, .76, -.14]); bx(1.34, .05, 1.66, 0, 1.36, -.35, 1, .02); bx(1.86, .1, .06, 0, .78, 2.25, .3, .02);
    for (const [x, z] of [[-.82, 1.42], [.82, 1.42], [-.82, -1.38], [.82, -1.38]]) { const g = new T.CylinderGeometry(.34, .34, .24, 12); g.rotateZ(HP); g.translate(x, .34, z); add(g, .05); const h = new T.CylinderGeometry(.21, .21, .26, 10); h.rotateZ(HP); h.translate(x, .34, z); add(h, .55); }
    let nv = 0, ni = 0; for (const g of parts) { const ng = g.index ? g : g; nv += ng.attributes.position.count; ni += ng.index ? ng.index.count : ng.attributes.position.count; }
    const Pp = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), Cc = new Float32Array(nv * 3), I = new Uint16Array(ni); let vo = 0, io = 0;
    for (const g of parts) { Pp.set(g.attributes.position.array, vo * 3); Nn.set(g.attributes.normal.array, vo * 3); Cc.set(g.attributes.color.array, vo * 3); const ix = g.index ? g.index.array : null, cnt = ix ? ix.length : g.attributes.position.count; for (let k = 0; k < cnt; k++) I[io + k] = (ix ? ix[k] : k) + vo; vo += g.attributes.position.count; io += cnt; }
    const o = new T.BufferGeometry(); o.setAttribute('position', new T.BufferAttribute(Pp, 3)); o.setAttribute('normal', new T.BufferAttribute(Nn, 3)); o.setAttribute('color', new T.BufferAttribute(Cc, 3)); o.setIndex(new T.BufferAttribute(I, 1)); return o; }
  function carLampGeo() { const parts = [], add = (x, y, z, w, h, d, c) => { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new T.BufferAttribute(a, 3)); parts.push(g); };
    for (const sx of [-1, 1]) { add(sx * .62, .74, 2.27, .32, .11, .06, [1, .96, .86]); add(sx * .66, .8, -2.29, .3, .12, .05, [1, .06, .02]); }
    let nv = 0, ni = 0; for (const g of parts) { nv += g.attributes.position.count; ni += g.index.count; } const Pp = new Float32Array(nv * 3), Cc = new Float32Array(nv * 3), I = new Uint16Array(ni); let vo = 0, io = 0;
    for (const g of parts) { Pp.set(g.attributes.position.array, vo * 3); Cc.set(g.attributes.color.array, vo * 3); const ix = g.index.array; for (let k = 0; k < ix.length; k++) I[io + k] = ix[k] + vo; vo += g.attributes.position.count; io += ix.length; }
    const o = new T.BufferGeometry(); o.setAttribute('position', new T.BufferAttribute(Pp, 3)); o.setAttribute('color', new T.BufferAttribute(Cc, 3)); o.setIndex(new T.BufferAttribute(I, 1)); return o; }

  /* ---------------------------------------------------------------- BR: the keys on the horizon — sand rims, scrub and palms (instanced photo cards), white modern villas with pools, docks and yachts */
  function buildIsles(C, boatModel) {
    const root = C.root, grp = new T.Group(); grp.name = 'coast_keys'; root.add(grp); const B = BRG;
    const sandM = new T.MeshStandardMaterial({ map: GT.tex.image('assets/tex/coast/sand_white.jpg', { repeat: [1, 1] }), color: 0xffffff, roughness: .95, vertexColors: true }); sandM.name = 'br_isle';
    const TREES = [{ uv: [12, 10, 362, 755], fb: .12 }, { uv: [288, 190, 690, 755], fb: .25 }, { uv: [662, 186, 1152, 755], fb: .47 }, { uv: [1118, 388, 1530, 752], fb: .5 }], AW = 1536, AH = 768;
    const cardM = C.cardMat('assets/tex/coast/bridge_trees.jpg', { rough: .85 }), INST = TREES.map(() => []);
    const VILLA = [], isleInfo = [];
    ISLES.forEach(([ix, iz, r], ii) => { const IR = GT.rng('br-isle' + ii), ph = [IR() * TAU, IR() * TAU, IR() * TAU], hMax = r > 200 ? 5.5 : r > 120 ? 3.5 : 2.2, edge = th => isleEdge(ii, th);
      const RINGS = [0, .18, .34, .5, .62, .72, .8, .86, .9, .935, .965, .99, 1.015, 1.045, 1.09], AS = r > 200 ? 120 : r > 120 ? 90 : 64;
      const hAt = (rho, th) => { if (rho >= .9) return SEA + lerp(.72, -.85, sst(rho, .9, 1.09)) + .05 * Math.sin(th * 17); const b = SEA + .78 + hMax * Math.pow(max(0, 1 - (rho / .9) ** 2), 1.1); return b + .6 * Math.sin(th * 4 + rho * 9) * Math.sin(th * 7 - rho * 5) * (1 - rho); };
      const Pp = [], Nn = [], UV = [], Cl = [], I = [];
      for (let j = 0; j < RINGS.length; j++) for (let i = 0; i <= AS; i++) { const th = i / AS * TAU, rho = RINGS[j], e = edge(th), x = ix + Math.cos(th) * r * e * rho, z = iz + Math.sin(th) * r * e * rho, y = hAt(rho, th);
        Pp.push(x, y, z); UV.push(x / 3.4, z / 3.4); Nn.push(0, 1, 0);
        const n1 = .5 + .5 * Math.sin(th * 9 + rho * 13) * Math.cos(th * 5 - rho * 7), bw = .05 + .04 * Math.sin(th * 2 + ph[1]), veg = 1 - sst(rho, .9 - bw + .03 * n1, .94 - bw * .5), wet = sst(rho, .97, 1.0);
        const cr = lerp(lerp(.98, .8, wet), .13 + .06 * n1, veg), cg = lerp(lerp(.95, .79, wet), .19 + .06 * n1, veg), cb = lerp(lerp(.88, .72, wet), .09 + .02 * n1, veg); Cl.push(cr, cg, cb); }
      for (let j = 0; j < RINGS.length - 1; j++) for (let i = 0; i < AS; i++) { const a = j * (AS + 1) + i, b = a + AS + 1; I.push(a, a + 1, b, a + 1, b + 1, b); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(Pp, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(UV, 2)); g.setAttribute('color', new T.Float32BufferAttribute(Cl, 3)); g.setIndex(I); g.computeVertexNormals();
      const m = new T.Mesh(g, sandM); m.receiveShadow = true; m.name = 'br_isle' + ii; grp.add(m); isleInfo.push({ ix, iz, r, edge, hAt });
      /* villas: on the big key and the second one, facing out over the water, away from the bridge */
      const nv = r > 200 ? 5 : r > 120 ? 2 : r > 90 ? 1 : 0, lots = []; for (let k = 0; k < nv; k++) { const th = (ii === 0 ? .25 : 1.3) + k * (TAU * .78 / max(1, nv)) + IR() * .25; lots.push(th); VILLA.push({ ii, th, x: ix + Math.cos(th) * r * edge(th) * .8, z: iz + Math.sin(th) * r * edge(th) * .8, y: hAt(.8, th), face: th, sz: .8 + IR() * .5, seed: ii * 10 + k, rimX: ix + Math.cos(th) * r * edge(th) * 1.0, rimZ: iz + Math.sin(th) * r * edge(th) * 1.0 }); }
      /* trees: palms along the sand rim and through the scrub, sea grape inland, mangrove clumps on the water's edge on one side */
      const N = Math.round(r * r * .026), bridgeO = (x, z) => { const s = (x - B.A[0]) * B.u[0] + (z - B.A[1]) * B.u[1], o = (x - B.A[0]) * B.n[0] + (z - B.A[1]) * B.n[1]; return s > B.SB - 40 && s < B.L + 60 && abs(o) < 22; };
      for (let k = 0; k < N; k++) { const th = IR() * TAU, rho = Math.sqrt(IR()) * .955, e = edge(th), x = ix + Math.cos(th) * r * e * rho, z = iz + Math.sin(th) * r * e * rho;
        if (bridgeO(x, z) || VILLA.some(v => v.ii === ii && Math.hypot(v.x - x, v.z - z) < 30 * v.sz)) continue;
        let t = rho > .8 ? (IR() < .55 ? (IR() < .5 ? 0 : 1) : 3) : IR() < .28 ? (IR() < .5 ? 0 : 1) : 2; if (t === 3 && Math.cos(th - ph[0]) < -.3) t = 2;
        const hgt = t === 0 ? rr2(IR, 15, 23) : t === 1 ? rr2(IR, 10, 15) : t === 2 ? rr2(IR, 8, 13) : rr2(IR, 4.5, 8); INST[t].push([x, hAt(min(rho, .9), th) - .2, z, hgt, IR() * PI]); } });
    function rr2(f, a, b) { return a + (b - a) * f(); }
    for (let t = 0; t < 4; t++) { const T0 = TREES[t], [x0, y0, x1, y1] = T0.uv, asp = (x1 - x0) / (y1 - y0), u0 = x0 / AW, u1 = x1 / AW, v0 = 1 - y1 / AH, v1 = 1 - y0 / AH, fb = T0.fb, P2 = [], U2 = [], N2 = [], I2 = [];
      for (const ang of [0, HP]) { const ca = Math.cos(ang), sa = Math.sin(ang), b = P2.length / 3; for (const [xx, yy, uu, vv] of [[-fb * asp, 0, u0, v0], [(1 - fb) * asp, 0, u1, v0], [(1 - fb) * asp, 1, u1, v1], [-fb * asp, 1, u0, v1]]) { P2.push(xx * ca, yy, xx * sa); U2.push(uu, vv); N2.push(0, 1, 0); } I2.push(b, b + 1, b + 2, b, b + 2, b + 3); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P2, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(U2, 2)); g.setAttribute('normal', new T.Float32BufferAttribute(N2, 3)); g.setIndex(I2);
      const L = INST[t]; if (!L.length) continue; const im = new T.InstancedMesh(g, cardM, L.length), mt = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3();
      L.forEach((d, i) => { e.set(0, d[4], 0); q.setFromEuler(e); p.set(d[0], d[1], d[2]); s.set(d[3], d[3], d[3]); mt.compose(p, q, s); im.setMatrixAt(i, mt); }); im.castShadow = false; im.receiveShadow = false; im.name = 'br_trees' + t; grp.add(im); }
    /* the villas: a white plinth, two offset volumes with full-height glass, a thin roof slab overhanging, a pool on the terrace, a lawn, a timber dock with a yacht */
    const white = C.flat(0xf1efe9, .62, 0, 'brvilla'), whiteB = C.flat(0xe2ded6, .7, 0, 'brvilla2'), glass = new T.MeshStandardMaterial({ color: 0x223442, roughness: .06, metalness: .7, emissive: 0xffc890, emissiveIntensity: 0 }), pool = new T.MeshStandardMaterial({ color: 0x46c8da, roughness: .05, metalness: .1, emissive: 0x0a3a44, emissiveIntensity: .4 }),
      wood = C.flat(0x8a6a4c, .85, 0, 'brdock'); glass.name = 'br_glass'; pool.name = 'br_pool'; C.NIGHT.push([glass, 0, .55]);
    for (const v of VILLA) { const K = GT.kit(), VR = GT.rng('br-villa' + v.seed), w = 22 * v.sz, d = 15 * v.sz, ry = Math.atan2(Math.cos(v.face), Math.sin(v.face)), y = v.y;
      K.push(v.x, y, v.z, { ry });
      K.box(white, w * 1.25, .7, d * 1.15, 0, .35, 2.5, { bevel: .05 });
      const w1 = w * (.62 + VR() * .15), d1 = d * .62, h1 = 3.4, x1 = (VR() - .5) * w * .2; K.box(white, w1, h1, d1, x1, .7 + h1 / 2, -d * .1, { bevel: .04 }); K.box(glass, w1 * .9, h1 * .78, .12, x1, .7 + h1 * .46, -d * .1 + d1 / 2 + .02);
      const w2 = w * (.72 + VR() * .2), d2 = d * .56, h2 = 3.2, x2 = (VR() - .5) * w * .3, z2 = -d * .1 + 1.6; K.box(whiteB, w2, h2, d2, x2, .7 + h1 + h2 / 2, z2, { bevel: .04 }); K.box(glass, w2 * .92, h2 * .8, .12, x2, .7 + h1 + h2 * .48, z2 + d2 / 2 + .02);
      K.box(white, w2 * 1.12, .32, d2 * 1.25, x2, .7 + h1 + h2 + .16, z2 + .6, { bevel: .03 });
      if (VR() < .6) K.box(white, w1 * .5, 2.6, d1 * .6, x1 - w1 * .2, .7 + h1 + h2 + 1.6, z2 - .5, { bevel: .03 });
      const pw = w * (.42 + VR() * .2); K.box(white, pw + .8, .25, 5.2, (VR() - .5) * w * .3, .78, d * .52, { bevel: .03 }); K.box(pool, pw, .1, 4.4, 0, .86, d * .52);
      K.pop(); const g = K.build({ cast: true }); g.name = 'br_villa'; grp.add(g);
      /* dock straight out from the beach below the villa, a yacht along it */
      const dx = Math.cos(v.face), dz = Math.sin(v.face), L = 26 + VR() * 10, K2 = GT.kit(), sx = v.rimX - dx * 6, sz = v.rimZ - dz * 6;
      K2.push(sx, SEA + .9, sz, { ry: Math.atan2(dx, dz) }); K2.box(wood, 2.4, .22, L, 0, 0, L / 2, { bevel: .02 }); for (let zz = 2; zz < L; zz += 3) for (const xx of [-1.1, 1.1]) K2.cyl(wood, .12, .12, 2.6, xx, -1.1, zz, { seg: 6 }); K2.box(wood, 6, .22, 2.6, 0, 0, L - 1.3); K2.pop();
      const dg = K2.build({ cast: true }); dg.name = 'br_dock'; grp.add(dg);
      const yb = boatModel(VR() < .5 ? 'speed' : 'cat', C), bx = sx + dx * (L * .62) + dz * 4.2, bz = sz + dz * (L * .62) - dx * 4.2; yb.position.set(bx, SEA, bz); yb.rotation.y = Math.atan2(dx, dz) + (VR() < .5 ? 0 : PI); yb.scale.setScalar(VR() < .5 ? 1.45 : 1.0); yb.name = 'br_yacht'; grp.add(yb); }
    return { group: grp, isles: isleInfo, villas: VILLA }; }

  /* ---------------------------------------------------------------- build */
  GT.coastParts = GT.coastParts || {};
  GT.coastParts.sea = function (C) {
    const root = C.root, R = GT.rng('coast-sea'), rr = (a, b) => a + (b - a) * R(), Q = C.QS;
    const nrm = waveTex(), lut = skyLUT(), sandT = GT.tex.image('assets/tex/coast/sand_white.jpg', { repeat: [1, 1] });
    const U = { uTime: { value: 0 }, uNight: { value: 0 }, uGlint: { value: 1 }, uSunDir: { value: new T.Vector3(-.8, .3, -.4) }, uSunCol: { value: new T.Vector3(3, 2.6, 2) }, uAmb: { value: new T.Vector3(.5, .6, .8) }, uNrm: { value: nrm }, uSand: { value: sandT }, uSky: { value: lut },
      uIsle: { value: ISLES.map(i => new T.Vector3(i[0], i[1], i[2])) }, uIsleP: { value: ISLE_PH.map(p => new T.Vector3(p[0], p[1], p[2])) }, uBrA: { value: new T.Vector4(BRG.A[0], BRG.A[1], BRG.u[0], BRG.u[1]) }, uBrB: { value: new T.Vector4(BRG.SC, BRG.W, BRG.RISE, BRG.YLOW) }, uBrC: { value: new T.Vector4(BRG.SA, BRG.d1, BRG.d2, BRG.SB) }, uBrD: { value: new T.Vector4(BRG.F, BRG.M, BRG.YISL, BRG.n1) }, uBoatA: { value: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => new T.Vector4(0, 0, 0, 1)) }, uBoatB: { value: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => new T.Vector4(0, 0, 0, 0)) } };
    C.seaU = U;
    /* water: one plane to the horizon */
    const wm = new T.ShaderMaterial({ uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, {}]), vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true });
    Object.assign(wm.uniforms, U); wm.extensions = { derivatives: true }; wm.name = 'coast_water';
    const wg = new T.PlaneGeometry(6000, 9000, 1, 1); wg.rotateX(-HP); const water = new T.Mesh(wg, wm); water.position.set(-3050, SEA, 0); water.frustumCulled = false; water.receiveShadow = false; water.castShadow = false; water.name = 'coast_sea'; root.add(water);
    /* sand: heightfield whose land edge follows the dune line; near band fine, far bands coarse */
    const sandM = new T.MeshStandardMaterial({ map: GT.tex.image('assets/tex/coast/sand_white.jpg', { repeat: [1 / 3.4, 1 / 3.4] }), color: 0xfff2e2, roughness: .96, metalness: 0 }); sandM.bumpMap = sandM.map; sandM.bumpScale = .018; sandM.name = 'coast_sand';
    if (GT.tex.addMacro) try { GT.tex.addMacro(sandM, [3, 3], [1 / 23, 1 / 41, .16, .1], { wet: 0 }); } catch (e) {}
    const prevS = sandM.onBeforeCompile; sandM.onBeforeCompile = (sh, r) => { if (prevS) prevS(sh, r); Object.assign(sh.uniforms, { uTime: U.uTime, uNrm: U.uNrm, uIsle: U.uIsle, uIsleP: U.uIsleP });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCoW;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vCoW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCoW; uniform float uTime; uniform sampler2D uNrm;\n' + GLSL_TERRAIN)
        .replace('#include <roughnessmap_fragment>', `
          float coLv = coLevel(vCoW.z, uTime), coE = coLv - vCoW.y, coWet = 1.0 - smoothstep(-1.05 + 0.08, -1.05 + 0.22, vCoW.y);
          diffuseColor.rgb *= 1.04;
          { vec2 fq = vCoW.xz / 0.62; vec2 fi = floor(fq), ff = fq - fi; float fh = fract(sin(dot(fi, vec2(12.9898, 78.233))) * 43758.5453), trail = smoothstep(0.55, 0.75, texture2D(uNrm, vCoW.xz * 0.006 + 0.2).a);
            float fa = fh * 6.2832; vec2 fd = mat2(cos(fa), -sin(fa), sin(fa), cos(fa)) * (ff - 0.5); float fp = (1.0 - smoothstep(0.08, 0.2, length(fd * vec2(1.0, 2.3) + vec2(0.13, 0.0)))) + (1.0 - smoothstep(0.08, 0.2, length(fd * vec2(1.0, 2.3) - vec2(0.13, 0.05))));
            float dryF = smoothstep(-0.88, -0.6, vCoW.y); diffuseColor.rgb *= 1.0 - 0.26 * fp * step(1.0 - 0.55 * trail - 0.14, fh) * dryF; }
          float coLace = smoothstep(0.38, 0.85, texture2D(uNrm, vCoW.xz * 0.13).b * 0.75 + texture2D(uNrm, vCoW.xz * 0.041).a * 0.45 - 0.12);
          float coFilm = smoothstep(0.0, 0.012, coE), coEdge = coFilm * (1.0 - smoothstep(0.01, 0.06 + 0.04 * coLace, coE)) * (0.6 + 0.4 * coLace);
          diffuseColor.rgb *= mix(1.0, 0.82, max(coWet, coFilm)); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.95, 0.93), coFilm * 0.6); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9), clamp(coEdge * 1.4, 0.0, 1.0));
          #include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.4, coWet * 0.6); roughnessFactor = mix(roughnessFactor, 0.07, coFilm * (1.0 - coEdge)); roughnessFactor = mix(roughnessFactor, 0.7, coEdge);`); };
    sandM.customProgramCacheKey = () => 'coast_sand';
    function band(x0f, x1, z0, z1, nx, dz, mat, yf) { const nz = Math.round((z1 - z0) / dz), P = [], UV = [], I = [];
      for (let j = 0; j <= nz; j++) { const z = z0 + (z1 - z0) * j / nz, xa = typeof x0f === 'function' ? x0f(z) : x0f, xb = typeof x1 === 'function' ? x1(z) : x1; for (let i = 0; i <= nx; i++) { const u = i / nx, x = xa + (xb - xa) * (u * u * .35 + u * .65); P.push(x, yf(x, z), z); UV.push(x, z); } }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + nx + 1; I.push(a, b, a + 1, a + 1, b, b + 1); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(UV, 2)); g.setIndex(I); g.computeVertexNormals(); const m = new T.Mesh(g, mat); m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false; root.add(m); return m; }
    const edge = z => duneEdge(z) + .02;
    band(z => xw(z) - 14, edge, -470, 470, 78, 2, sandM, landY);
    band(z => xw(z) - 14, edge, -2600, -470, 10, 26, sandM, landY); band(z => xw(z) - 14, edge, 470, 2600, 10, 26, sandM, landY);
    /* park lawn (grass) between the dune line and the beach-side sidewalk */
    const grassM = new T.MeshStandardMaterial({ map: GT.tex.image('assets/tex/coast/grass_lawn.jpg', { repeat: [1 / 2.6, 1 / 2.6] }), color: 0xd8dcc8, roughness: .95 }); grassM.name = 'coast_lawn'; if (GT.tex.addMacro) try { GT.tex.addMacro(grassM, [2.6, 2.6], [1 / 19, 1 / 37, .3, .12], { wet: 0 }); } catch (e) {}
    band(edge, PK, -470, 470, 14, 2, grassM, landY); band(edge, PK, -2600, -470, 3, 26, grassM, landY); band(edge, PK, 470, 2600, 3, 26, grassM, landY);
    C.sandMat = sandM; C.grassMat = grassM;

    /* boats */
    const BOATS = []; const mk = (kind, path, speed, wake) => { const g = boatModel(kind, C); g.name = 'coast_boat_' + kind; root.add(g); const b = { kind, g, path, speed, th: R() * TAU, wake, x: 0, z: 0, h: 0, bob: R() * 9 }; BOATS.push(b); return b; };
    const ell = (cx, cz, rx, rz, dir) => th => [cx + rx * Math.sin(th * dir), cz + rz * Math.cos(th)];
    const eight = (cx, cz, rx, rz) => th => [cx + rx * Math.sin(2 * th), cz + rz * Math.sin(th)];
    mk('speed', ell(-265, 40, 95, 250, 1), 15, [9, 1.15, 90]); mk('speed', ell(-430, -160, 80, 330, -1), 12, [9, 1.15, 80]); mk('cat', ell(-360, 260, 55, 640, 1), 5, [14, 3.2, 70]);
    mk('jet', eight(-158, -30, 26, 72), 9, [3.2, .55, 38]); mk('jet', eight(-175, 95, 30, 60), 10.5, [3.2, .55, 38]);
    mk('speed', ell(-330, -520, 120, 280, 1), 14, [9, 1.15, 85]); mk('speed', ell(-205, 0, 40, 160, -1), 13, [9, 1.15, 80]); mk('jet', eight(-140, 40, 18, 45), 8.5, [3.2, .55, 34]); mk('cat', ell(-520, -80, 70, 520, -1), 5.5, [14, 3.2, 70]); mk('jet', eight(-150, -130, 22, 50), 9.5, [3.2, .55, 36]); mk('speed', ell(-600, 700, 160, 300, -1), 16, [9, 1.15, 95]);
    const cruise = mk('cruise', th => [-2300, -2600 + ((th * 900) % 5200)], 3.2, [300, 18, 900]); cruise.lin = true;
    for (const [x, z, s] of [[-720, -420, 1], [-950, 520, 1.1], [-610, 960, .9], [-420, 300, .8], [-880, -900, 1], [-1300, 100, 1.2]]) { const g = boatModel('sail', C); g.position.set(x, SEA, z); g.rotation.y = R() * TAU; g.scale.setScalar(s); root.add(g); BOATS.push({ kind: 'sail', g, fixed: 1, x, z, h: g.rotation.y, bob: R() * 9 }); }
    for (const b of BOATS) if (b.path && !b.lin) { b.th = R() * TAU; }
    /* BR: the causeway bridge and the keys on the horizon (built above: buildBridge, buildIsles) */
    let bridge = null, keys = null; try { bridge = buildBridge(C); } catch (e) { console.warn('[coast] bridge', e); } try { keys = buildIsles(C, boatModel); } catch (e) { console.warn('[coast] keys', e); }

    const _v = new T.Vector3();
    function update(dt, ctx) { U.uTime.value += dt; const env = GT.env || {}, t = U.uTime.value;
      if (env.sunDir) U.uSunDir.value.copy(env.sunDir); if (env.sunColor) U.uSunCol.value.set(env.sunColor.r, env.sunColor.g, env.sunColor.b); U.uNight.value = env.night || 0;
      const hemi = GT.atmos && GT.atmos.hemi; if (hemi) U.uAmb.value.set(hemi.color.r, hemi.color.g, hemi.color.b).multiplyScalar(1.25);
      lut.refresh(env.hours || 17, false);
      let wi = 0; for (const b of BOATS) { if (b.fixed) { b.g.position.y = SEA + .05 * Math.sin(t * 1.1 + b.bob); b.g.rotation.z = .03 * Math.sin(t * .9 + b.bob); continue; }
        let p0, p1; if (b.lin) { b.th += b.speed * dt / 900; p0 = b.path(b.th); p1 = b.path(b.th + .01); } else { const a = b.path(b.th), c = b.path(b.th + .001), sp = Math.hypot(c[0] - a[0], c[1] - a[1]) / .001; b.th += b.speed * dt / max(sp, .01); p0 = b.path(b.th); p1 = b.path(b.th + .01); }
        b.x = p0[0]; b.z = p0[1]; b.h = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
        b.g.position.set(b.x, SEA + .06 * Math.sin(t * 1.7 + b.bob) + (b.kind === 'speed' || b.kind === 'jet' ? .05 : 0), b.z); b.g.rotation.set(-(b.kind === 'speed' ? .07 : b.kind === 'jet' ? .05 : .01) + .02 * Math.sin(t * 1.3 + b.bob), b.h, .03 * Math.sin(t * 1.1 + b.bob * 2), 'YXZ');
        if (wi < 10 && b.wake) { U.uBoatA.value[wi].set(b.x, b.z, Math.sin(b.h), Math.cos(b.h)); U.uBoatB.value[wi].set(b.speed, b.wake[0], b.wake[1], b.wake[2]); wi++; } }
      for (; wi < 10; wi++) U.uBoatB.value[wi].set(0, 0, 0, 0);
      if (bridge) bridge.update(dt); }
    lut.refresh(GT.env && GT.env.hours || 17, true);
    return { update, boats: BOATS, water, lut, bridge, keys };
  };
})();
