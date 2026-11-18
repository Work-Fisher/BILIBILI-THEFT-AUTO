/* fxsmall.js — BILIBILI THEFT AUTO 1 (China edition): the small reactive details ("alive" layer).
   GT.fxsmall = { init(scene), update(dt, camera, player?), step(e), land(e), ride(o), puff(x,y,z,o), splash(x,y,z,k), leaves(x,y,z,n,vx,vz), sparks(x,y,z,n,dx,dz),
                  skid(x,y,z,h,len), wetAt(x,z), leafAt(x,z), wind:{x,z}, flocks, stats }
   Everything is ONE instanced, alpha-blended quad mesh with one small canvas atlas (1 draw call, no lights, no shadows):
     slots 0..23    birds (4 flocks pecking at fixed spots; they scatter when the player comes close and drift back later)
     slots 24..71   ground decals: skid marks (ring buffer, fade over ~25 s) and puddle rings
     slots 72..     pooled particles: dust puffs, water spray + droplets, kicked-up leaves, scrape sparks (additive), steam wisps from manholes drifting with the wind
   Wet patches and leaf litter are read back from the world's own decals (GT.decalMat('puddle') / ('leaves') quads), so the reactions happen where you can see a puddle or leaves.
   Wiring (js/cngame.js): on-foot 'step' / 'land' events -> step() / land();  every riding frame -> ride();  'crash' on two wheels -> sparks() + puff(). */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT = window.GT || {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, sst = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const NB = 24, ND = 48, NP = 520, N = NB + ND + NP, CELL = 1 / 4, TAU = Math.PI * 2;
  let seed = 90210; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }, rr = (a, b) => a + (b - a) * rnd();
  const S = { ready: false, mesh: null, t: 0, P: [], D: [], di: 0, flocks: [], wet: [], leaf: [], grid: { wet: new Map(), leaf: new Map() }, plumes: [], acc: { skid: 0, spray: 0, dust: 0, leaf: 0 }, stats: { live: 0, puddles: 0, leafPatches: 0, birds: 0, emitted: {} } };
  const wind = { x: .55, z: .22 };
  const API = { wind, stats: S.stats, flocks: S.flocks };
  const cnt = k => { S.stats.emitted[k] = (S.stats.emitted[k] || 0) + 1; };
  const groundY = (x, z) => { const q = GT.onfoot && GT.onfoot.query && GT.onfoot.query.groundY; if (q) { try { const y = q(x, z); if (isFinite(y)) return y; } catch (e) { /* fall through */ } }   // the controller's walkable height: terrain + module floors + kerbs
    const f = GT.cnroad && GT.cnroad.groundHeight; if (f) { try { const y = f(x, z); if (isFinite(y)) return y; } catch (e) { /* fall through */ } } return 0; };

  /* ------------------------------------------------------------------ atlas: 4x4 cells of 64 px, drawn in white / grey so the per-instance colour decides */
  function atlas() {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), cell = (i, fn) => { g.save(); g.translate((i % 4) * 64 + 32, Math.floor(i / 4) * 64 + 32); fn(); g.restore(); };
    cell(0, () => { for (let k = 0; k < 9; k++) { const a = k * 2.4, r = k ? 9 + (k * 7 % 5) : 0, x = Math.cos(a) * r, y = Math.sin(a) * r, R = k ? 13 + (k * 5 % 6) : 24, gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(-32, -32, 64, 64); } });   // soft lumpy puff
    cell(1, () => { g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.2; for (let k = 0; k < 7; k++) { const a0 = k * .9 + .1; g.beginPath(); g.arc(0, 0, 25, a0, a0 + .55); g.stroke(); } g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, 15, 0, TAU); g.stroke(); });   // splash ring (seen from above)
    cell(2, () => { const gr = g.createRadialGradient(0, 4, 0, 0, 4, 22); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.6, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 11, 24, 0, 0, TAU); g.fill(); });   // droplet
    const leaf = (lobes) => { g.fillStyle = '#fff'; g.beginPath(); for (let k = 0; k <= 40; k++) { const a = k / 40 * TAU, r = 17 + 8 * Math.abs(Math.cos(a * lobes / 2)) - 5 * Math.pow(Math.abs(Math.sin(a)), 6); g.lineTo(Math.sin(a) * r * .8, -Math.cos(a) * r); } g.fill(); g.strokeStyle = 'rgba(120,120,120,.9)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, 22); g.lineTo(0, -18); g.moveTo(0, 2); g.lineTo(-11, -9); g.moveTo(0, 2); g.lineTo(11, -9); g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 20); g.lineTo(0, 29); g.stroke(); };
    cell(3, () => leaf(5)); cell(4, () => { g.scale(.8, 1.05); g.rotate(.4); leaf(3); });                                                             // plane-tree leaves
    cell(5, () => { const gr = g.createLinearGradient(0, -28, 0, 28); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.75, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,.2)'); g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 10, 29, 0, 0, TAU); g.fill(); });   // spark streak
    cell(6, () => { for (let k = 0; k < 2; k++) { const gr = g.createLinearGradient(-14, 0, 14, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.3, 'rgba(255,255,255,.75)'); gr.addColorStop(.7, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(-14, -32, 28, 64); }
      g.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 60; k++) { g.fillStyle = 'rgba(0,0,0,' + (.1 + (k * 13 % 7) / 20) + ')'; g.fillRect(-14 + (k * 37 % 28), -32 + (k * 53 % 64), 2, 3 + (k % 4)); } g.globalCompositeOperation = 'source-over'; });                        // skid strip (tiles along Y)
    const bird = (wing) => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 4, 13, 7, -.12, 0, TAU); g.fill(); g.beginPath(); g.arc(13, -2, 5.2, 0, TAU); g.fill(); g.beginPath(); g.moveTo(17, -2); g.lineTo(23, -.5); g.lineTo(17, 1); g.fill(); g.beginPath(); g.moveTo(-10, 2); g.lineTo(-25, 7); g.lineTo(-11, 9); g.fill();
      g.fillStyle = 'rgba(200,200,200,1)'; g.beginPath(); if (wing > 0) { g.moveTo(-6, 2); g.quadraticCurveTo(-8, -22, 4, -27); g.quadraticCurveTo(6, -10, 8, 2); } else { g.moveTo(-6, 4); g.quadraticCurveTo(-10, 22, 0, 27); g.quadraticCurveTo(6, 14, 8, 5); } g.fill(); };
    cell(7, () => bird(1)); cell(8, () => bird(-1));                                                                                                  // flying: wings up / down
    const stand = (peck) => { g.fillStyle = '#fff'; g.save(); g.rotate(peck ? .5 : -.15); g.beginPath(); g.ellipse(-2, 2, 13, 8.5, 0, 0, TAU); g.fill(); g.beginPath(); g.arc(11, peck ? 3 : -7, 5.2, 0, TAU); g.fill(); g.beginPath(); g.moveTo(15, peck ? 4 : -7); g.lineTo(21, peck ? 9 : -5.5); g.lineTo(14, peck ? 7 : -4); g.fill(); g.beginPath(); g.moveTo(-12, 0); g.lineTo(-26, -1); g.lineTo(-13, 6); g.fill();
      g.fillStyle = 'rgba(190,190,190,1)'; g.beginPath(); g.ellipse(-4, 1, 9, 5, .1, 0, TAU); g.fill(); g.restore(); g.strokeStyle = 'rgba(230,150,120,1)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-2, 9); g.lineTo(-3, 19); g.moveTo(3, 9); g.lineTo(4, 19); g.stroke(); };
    cell(9, () => stand(0)); cell(10, () => stand(1));                                                                                                // on the ground: head up / pecking
    cell(11, () => { g.fillStyle = 'rgba(255,255,255,.9)'; for (let k = 0; k < 9; k++) { g.beginPath(); g.arc(-22 + (k * 29 % 44), -22 + (k * 17 % 44), 1.2 + (k % 3) * .7, 0, TAU); g.fill(); } });      // grit specks
    cell(12, () => { g.fillStyle = 'rgba(255,255,255,1)'; g.beginPath(); g.moveTo(-20, -26); g.lineTo(21, -24); g.lineTo(19, 27); g.lineTo(-22, 25); g.closePath(); g.fill(); g.fillStyle = 'rgba(150,150,150,1)'; for (let k = 0; k < 9; k++) g.fillRect(-16 + (k % 2) * 18, -20 + (k >> 1) * 9, 14 - (k * 5 % 6), 2.2); g.fillRect(-16, -22, 32, 4); });   /* ct2: newspaper / paper sheet */
    cell(13, () => { g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.moveTo(-6, -28); g.lineTo(14, 18); g.lineTo(-12, 24); g.closePath(); g.fill(); g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 2.5; g.stroke(); });   /* ct2: glass shard */
    const tx = new T.CanvasTexture(c); tx.minFilter = T.LinearMipmapLinearFilter; tx.magFilter = T.LinearFilter; tx.generateMipmaps = true; tx.flipY = false; tx.needsUpdate = true; return tx;
  }
  const UV = i => [(i % 4) * CELL + .004, Math.floor(i / 4) * CELL + .004, CELL - .008, CELL - .008];

  /* ------------------------------------------------------------------ mesh */
  const VS = 'attribute vec3 aPos; attribute vec4 aSR; attribute vec4 aCol; attribute vec4 aUV; varying vec2 vUv; varying vec4 vCol; varying float vAdd; varying float vLit;\n' +
    'void main(){ vec2 q = position.xy * aSR.xy; float c = cos(aSR.z), s = sin(aSR.z); vec2 r = vec2(q.x*c - q.y*s, q.x*s + q.y*c); vec4 mv;\n' +
    ' if (aSR.w > .5 && aSR.w < 1.5) mv = viewMatrix * vec4(aPos + vec3(r.x, 0., r.y), 1.); else { mv = viewMatrix * vec4(aPos, 1.); mv.xy += r; }\n' +
    ' gl_Position = projectionMatrix * mv; vUv = aUV.xy + vec2(uv.x, 1. - uv.y) * aUV.zw; vCol = aCol; vLit = step(2.5, aSR.w); vAdd = step(1.5, aSR.w) * (1. - vLit); }';   /* aSR.w: 0 billboard · 1 ground decal · 2 additive billboard · 3 lit billboard (steam, smoke, mist: takes the colour of the lamp that lights it at night) */
  const FS = 'uniform sampler2D map; uniform vec3 uLight; uniform float uLitK; varying vec2 vUv; varying vec4 vCol; varying float vAdd; varying float vLit;\n' +
    'void main(){ vec4 t = texture2D(map, vUv); float a = t.a * vCol.a; if (a < .004) discard; vec3 col = vCol.rgb * t.rgb * mix(uLight, vec3(1.), vAdd); if (vLit > .5) col = t.rgb * (uLight * mix(.95, .5, uLitK) + vCol.rgb * uLitK);\n' +
    ' gl_FragColor = vec4(col * a, a * (1. - vAdd));\n #include <tonemapping_fragment>\n #include <encodings_fragment>\n }';
  function build(scene) {
    const q = new T.PlaneGeometry(1, 1), geo = new T.InstancedBufferGeometry(); geo.index = q.index; geo.setAttribute('position', q.attributes.position); geo.setAttribute('uv', q.attributes.uv); geo.instanceCount = N;
    const mk = (name, n) => { const a = new T.InstancedBufferAttribute(new Float32Array(N * n), n); a.setUsage(T.DynamicDrawUsage); geo.setAttribute(name, a); return a; };
    S.aPos = mk('aPos', 3); S.aSR = mk('aSR', 4); S.aCol = mk('aCol', 4); S.aUV = mk('aUV', 4);
    const mat = new T.ShaderMaterial({ uniforms: { map: { value: atlas() }, uLight: { value: new T.Color(1, 1, 1) }, uLitK: { value: 0 } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: T.DoubleSide,
      blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    mat.name = 'fxsmall'; const m = S.mesh = new T.Mesh(geo, mat); m.name = 'fxsmall'; m.frustumCulled = false; m.castShadow = m.receiveShadow = false; m.renderOrder = 7; scene.add(m);
  }
  function put(i, x, y, z, w, h, rot, mode, r, g, b, a, cell) { const p = S.aPos.array, s = S.aSR.array, c = S.aCol.array, u = S.aUV.array, k3 = i * 3, k4 = i * 4, uv = UVC[cell];
    p[k3] = x; p[k3 + 1] = y; p[k3 + 2] = z; s[k4] = w; s[k4 + 1] = h; s[k4 + 2] = rot; s[k4 + 3] = mode; c[k4] = r; c[k4 + 1] = g; c[k4 + 2] = b; c[k4 + 3] = a; u[k4] = uv[0]; u[k4 + 1] = uv[1]; u[k4 + 2] = uv[2]; u[k4 + 3] = uv[3]; }
  const UVC = []; for (let i = 0; i < 16; i++) UVC.push(UV(i));

  /* ------------------------------------------------------------------ what the ground is like: puddles + leaf litter, read back from the world's decal quads */
  function harvest(scene) {
    const want = []; for (const n of ['puddle', 'leaves']) { let m = null; try { m = GT.decalMat && GT.decalMat(n); } catch (e) { m = null; } if (m) want.push([m, n === 'puddle' ? S.wet : S.leaf]); }
    if (!want.length) return; const v = new T.Vector3();
    scene.updateMatrixWorld(true);
    scene.traverse(o => { if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return; const w = want.find(x => x[0] === o.material); if (!w) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index, nTri = (idx ? idx.count : pos.count) / 3, at = k => (idx ? idx.getX(k) : k);
      for (let t = 0; t + 1 < nTri; t += 2) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y = 0; for (let k = 0; k < 6; k++) { v.fromBufferAttribute(pos, at(t * 3 + k)).applyMatrix4(o.matrixWorld); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z); y = v.y; }
        if (x1 - x0 > 12 || z1 - z0 > 12) continue; w[1].push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, rx: (x1 - x0) * .4, rz: (z1 - z0) * .4, y }); } });
    for (const [list, map] of [[S.wet, S.grid.wet], [S.leaf, S.grid.leaf]]) for (const p of list) for (let i = Math.floor((p.x - p.rx) / 8); i <= Math.floor((p.x + p.rx) / 8); i++) for (let j = Math.floor((p.z - p.rz) / 8); j <= Math.floor((p.z + p.rz) / 8); j++) { const k = i * 4096 + j; let a = map.get(k); if (!a) map.set(k, a = []); a.push(p); }
    S.stats.puddles = S.wet.length; S.stats.leafPatches = S.leaf.length;
  }
  function inPatch(map, x, z) { const a = map.get(Math.floor(x / 8) * 4096 + Math.floor(z / 8)); if (!a) return null; for (const p of a) { const dx = (x - p.x) / p.rx, dz = (z - p.z) / p.rz; if (dx * dx + dz * dz < 1) return p; } return null; }
  /** true on a puddle decal (or everywhere outdoors while GT.env.wet is high) */
  API.wetAt = (x, z) => !!inPatch(S.grid.wet, x, z);
  API.leafAt = (x, z) => !!inPatch(S.grid.leaf, x, z);

  /* ------------------------------------------------------------------ particles */
  function spawn(o) { let best = null; for (const p of S.P) { if (p.life <= 0) { best = p; break; } if (!best || p.life / p.max < best.life / best.max) best = p; } if (!best) return null;   // pool full: recycle the one closest to dying
    best.life = best.max = o.life || 1; best.x = o.x; best.y = o.y; best.z = o.z; best.vx = o.vx || 0; best.vy = o.vy || 0; best.vz = o.vz || 0; best.s0 = o.s0 || .2; best.s1 = o.s1 === undefined ? best.s0 : o.s1; best.asp = o.asp || 1;
    best.rot = o.rot === undefined ? rnd() * TAU : o.rot; best.vr = o.vr || 0; best.r = o.r === undefined ? 1 : o.r; best.g = o.g === undefined ? 1 : o.g; best.b = o.b === undefined ? 1 : o.b; best.a = o.a === undefined ? 1 : o.a;
    best.cell = o.cell || 0; best.mode = o.mode || 0; best.grav = o.grav || 0; best.drag = o.drag || 0; best.wind = o.wind || 0; best.floor = o.floor === undefined ? -1e9 : o.floor; best.fin = o.fin === undefined ? .15 : o.fin; best.flut = o.flut || 0; best.r2 = o.r2; best.g2 = o.g2; best.b2 = o.b2; best.lie = !!o.lie; return best; }
  /** soft puff. o: {n, size, life, r,g,b, a, up, spread, vx, vz} */
  API.puff = function (x, y, z, o) { if (!S.ready) return; o = o || {}; const n = o.n || 3, sz = o.size || .35; cnt(o.tag || 'puff');
    for (let k = 0; k < n; k++) spawn({ x: x + rr(-.1, .1), y: y + rr(.02, .12), z: z + rr(-.1, .1), vx: (o.vx || 0) + rr(-1, 1) * (o.spread || .35), vy: (o.up === undefined ? .35 : o.up) * rr(.6, 1.3), vz: (o.vz || 0) + rr(-1, 1) * (o.spread || .35), s0: sz * rr(.5, .8), s1: sz * rr(1.6, 2.4), life: (o.life || .9) * rr(.7, 1.2),
      r: o.r === undefined ? .36 : o.r, g: o.g === undefined ? .32 : o.g, b: o.b === undefined ? .26 : o.b, a: (o.a === undefined ? .3 : o.a) * rr(.7, 1), cell: 0, drag: 1.8, wind: .7, vr: rr(-.6, .6) }); };
  /** footstep / tyre in a puddle: a ring on the water + droplets. k = strength 0..1 */
  API.splash = function (x, y, z, k, vx, vz) { if (!S.ready) return; k = k === undefined ? .6 : k; cnt('splash');
    decal(x, y + .012, z, .25, .25, rnd() * TAU, .9, .95, 1, .5 * k + .2, .55, .35 + .7 * k, 1);
    const n = Math.round(3 + 5 * k); for (let i = 0; i < n; i++) { const a = rnd() * TAU, sp = rr(.5, 1.6) * (.6 + k); spawn({ x, y: y + .03, z, vx: Math.cos(a) * sp + (vx || 0) * .3, vy: rr(1.2, 2.6) * (.6 + k * .6), vz: Math.sin(a) * sp + (vz || 0) * .3, s0: rr(.025, .05), asp: 1.8, rot: 0, life: rr(.35, .6), r: .86, g: .92, b: 1, a: .75, cell: 2, grav: 9.8, floor: y, fin: .02 }); }
    spawn({ x, y: y + .08, z, vx: (vx || 0) * .2, vy: .5, vz: (vz || 0) * .2, s0: .12, s1: .4 + .3 * k, life: .4, r: .9, g: .95, b: 1, a: .22, cell: 0, drag: 2 }); };
  /** leaves kicked out of a litter patch */
  API.leaves = function (x, y, z, n, vx, vz) { if (!S.ready) return; n = n || 3; cnt('leaves'); const hue = () => { const k = rnd(); return k < .45 ? [.42, .26, .05] : k < .8 ? [.3, .15, .04] : [.2, .22, .05]; };
    for (let i = 0; i < n; i++) { const c = hue(), a = rnd() * TAU; spawn({ x: x + rr(-.25, .25), y: y + .05, z: z + rr(-.25, .25), vx: (vx || 0) * rr(.25, .6) + Math.cos(a) * rr(.2, 1.1), vy: rr(.9, 2.4), vz: (vz || 0) * rr(.25, .6) + Math.sin(a) * rr(.2, 1.1), s0: rr(.12, .2), life: rr(1.3, 2.4), r: c[0], g: c[1], b: c[2], a: 1, cell: rnd() < .5 ? 3 : 4, grav: 3.2, drag: 1.4, wind: 1, vr: rr(-7, 7), floor: y + .02, flut: rr(3, 7), fin: .02 }); } };
  /** sparks from metal on stone: additive streaks along (dx, dz) */
  API.sparks = function (x, y, z, n, dx, dz) { if (!S.ready) return; n = n || 8; cnt('sparks'); const l = Math.hypot(dx || 0, dz || 0) || 1; dx = (dx || 0) / l; dz = (dz || 0) / l;
    for (let i = 0; i < n; i++) { const sp = rr(2, 6); spawn({ x, y: y + rr(0, .15), z, vx: dx * sp + rr(-1.4, 1.4), vy: rr(.6, 3.2), vz: dz * sp + rr(-1.4, 1.4), s0: rr(.03, .05), asp: rr(4, 7), rot: rr(-.6, .6), life: rr(.2, .5), r: 3.2, g: 1.9 + rnd() * .8, b: .7, a: 1, cell: 5, mode: 2, grav: 7, floor: groundY(x, z), fin: .01 }); } };
  /** a ground decal in the ring buffer (skid marks, puddle rings). grow > 0 = expanding ring */
  function decal(x, y, z, w, h, rot, r, g, b, a, life, grow, cell) { if (!S.ready) return; const d = S.D[S.di]; S.di = (S.di + 1) % ND; d.x = x; d.y = y; d.z = z; d.w = w; d.h = h; d.rot = rot; d.r = r; d.g = g; d.b = b; d.a = a; d.life = d.max = life; d.grow = grow || 0; d.cell = cell === undefined ? 6 : (grow ? 1 : cell); }
  /** one skid-mark segment of length len at (x,z) pointing along heading h */
  /** ct2: a broken hydrant's water column. Call every frame while it runs; k = pressure 0..1 */
  API.geyser = function (x, y, z, dt, k) { if (!S.ready) return; k = k === undefined ? 1 : k; S.acc.gey = (S.acc.gey || 0) + dt * 120 * k; cnt('geyser');
    while (S.acc.gey > 1) { S.acc.gey -= 1; const a = rnd() * TAU, sp = rr(0, .55); spawn({ x: x + rr(-.05, .05), y: y + .5, z: z + rr(-.05, .05), vx: Math.cos(a) * sp + wind.x * .5, vy: rr(6.5, 9.8) * k, vz: Math.sin(a) * sp + wind.z * .5, s0: rr(.1, .18), s1: rr(.26, .5), asp: 2.0, rot: 0, life: rr(1.4, 2.0), r: .9, g: .95, b: 1, a: .85, cell: 2, grav: 9.8, drag: .25, floor: y + .02, fin: .04 }); }
    if (rnd() < dt * 22) spawn({ x: x + rr(-.5, .5), y: y + rr(1.2, 4.5) * k, z: z + rr(-.5, .5), vx: wind.x * .6, vy: rr(.2, .8), vz: wind.z * .6, s0: rr(.5, .9), s1: rr(1.6, 2.6), life: rr(1, 1.8), r: .9, g: .94, b: 1, a: .26, cell: 0, mode: 3, drag: 1.2, wind: 1, vr: rr(-.4, .4) });
    if (rnd() < dt * 7) { const a = rnd() * TAU, d = rr(.5, 2.6), px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; API.splash(px, groundY(px, pz), pz, .6); } };
  /** ct2: things that fly and settle: papers (cell 12), glass (13), litter (3/4/11). o: {vx, vz, up, spread, cols:[[r,g,b]], size, asp, life, grav, drag, wind, cell, lie, flut, mode, h} */
  API.debris = function (x, y, z, n, o) { if (!S.ready) return; o = o || {}; cnt(o.tag || 'debris'); const fl = groundY(x, z);
    for (let i = 0; i < n; i++) { const a = rnd() * TAU, sp = rr(.3, 1) * (o.spread === undefined ? 1.5 : o.spread), c = o.cols ? o.cols[(rnd() * o.cols.length) | 0] : [.88, .87, .83];
      spawn({ x: x + rr(-.2, .2), y: y + rr(0, o.h || .3), z: z + rr(-.2, .2), vx: (o.vx || 0) * rr(.3, .9) + Math.cos(a) * sp, vy: (o.up === undefined ? 2 : o.up) * rr(.5, 1.3), vz: (o.vz || 0) * rr(.3, .9) + Math.sin(a) * sp, s0: (o.size || .2) * rr(.7, 1.3), asp: o.asp || 1, life: (o.life || 8) * rr(.8, 1.2),
        r: c[0], g: c[1], b: c[2], a: o.a || 1, cell: o.cell === undefined ? 12 : o.cell, grav: o.grav === undefined ? 4 : o.grav, drag: o.drag === undefined ? 1.2 : o.drag, wind: o.wind === undefined ? .6 : o.wind, vr: rr(-6, 6), floor: fl + .012 + rr(0, .006), flut: o.flut === undefined ? rr(2, 5) : o.flut, fin: o.fin || .05, mode: o.mode || 0, lie: o.lie !== false }); } };
  API.skid = function (x, y, z, h, len) { cnt('skid'); decal(x, y + .014, z, .1, len, -h, .04, .04, .045, .62, 25, 0, 6); };

  /* ------------------------------------------------------------------ event emitters */
  /** on-foot 'step' event: {x, y, z, speed, surface, foot} */
  API.step = function (e) { if (!S.ready || !e || e.x === undefined) return; const y = e.y === undefined ? groundY(e.x, e.z) : e.y, sp = +e.speed || 0, wetAll = GT.env && GT.env.wet > .5 && e.surface !== 'indoor';
    if (e.surface === 'indoor') return;
    if (API.wetAt(e.x, e.z) || (wetAll && rnd() < .5)) { API.splash(e.x, y, e.z, clamp(.25 + sp / 8, .25, 1)); return; }
    if (sp > 2.2 && API.leafAt(e.x, e.z)) { API.leaves(e.x, y, e.z, sp > 5 ? 4 : 2, Math.sin(e.h || 0) * sp, Math.cos(e.h || 0) * sp); return; }
    const dusty = e.surface === 'dirt' || e.surface === 'grass' ? 1 : e.surface === 'concrete' ? .6 : e.surface === 'paver' ? .25 : .15;                       // the courtyard slab is dusty; pavers and asphalt only show it at a sprint
    if (sp > 2.5 && rnd() < dusty * (sp > 5 ? 1.6 : 1)) API.puff(e.x, y, e.z, { n: 2, size: .22 + sp * .02, life: .7, a: .16 + .1 * dusty, up: .25, tag: 'stepdust' }); };
  /** landing after a vault / drop: {x, y, z, h (drop height)} */
  API.land = function (e) { if (!S.ready || !e || e.x === undefined) return; if (API.wetAt(e.x, e.z)) API.splash(e.x, e.y || 0, e.z, 1); else API.puff(e.x, e.y || 0, e.z, { n: 5, size: .4, life: .9, a: .26, spread: .9, up: .2, tag: 'landdust' }); };
  /** every riding frame: {x, y, z, h, v, brake, decel (m/s², positive when slowing), surface, dt} — rear-tyre spray on wet patches, dust in the yard, leaves, skid marks under hard braking */
  API.ride = function (o) { if (!S.ready || !o) return; const v = Math.abs(o.v || 0), dt = o.dt || 0, fx = Math.sin(o.h), fz = Math.cos(o.h), rx = o.x - fx * .62, rz = o.z - fz * .62, y = o.y || 0, A = S.acc; if (dt <= 0) return;
    const wet = API.wetAt(rx, rz) || (GT.env && GT.env.wet > .5);
    if (wet && v > 2.5) { A.spray += dt * (6 + v * 2.2); while (A.spray > 1) { A.spray -= 1; cnt('spray'); spawn({ x: rx + rr(-.06, .06), y: y + .1, z: rz + rr(-.06, .06), vx: -fx * v * rr(.1, .3) + rr(-.5, .5), vy: rr(.8, 1.6) + v * .08, vz: -fz * v * rr(.1, .3) + rr(-.5, .5), s0: .1, s1: rr(.4, .7), life: rr(.35, .6), r: .86, g: .9, b: .95, a: .26, cell: 0, grav: 2.5, drag: 1.5, wind: .5 });
        if (rnd() < .6) spawn({ x: rx, y: y + .08, z: rz, vx: -fx * v * rr(.15, .45) + rr(-.8, .8), vy: rr(1.2, 2.8), vz: -fz * v * rr(.15, .45) + rr(-.8, .8), s0: rr(.02, .04), asp: 2, rot: 0, life: rr(.3, .55), r: .9, g: .94, b: 1, a: .7, cell: 2, grav: 9.8, floor: y, fin: .02 }); }
      if (API.wetAt(rx, rz) && rnd() < dt * 5) decal(rx, y + .012, rz, .2, .2, rnd() * TAU, .9, .95, 1, .4, .5, .8, 1); }
    else if (v > 3 && (o.surface === 'concrete' || o.surface === 'dirt' || o.surface === 'grass')) { A.dust += dt * v * (o.surface === 'concrete' ? .5 : 1.4); while (A.dust > 1) { A.dust -= 1; API.puff(rx, y, rz, { n: 1, size: .32, life: .9, a: .14, vx: -fx * .6, vz: -fz * .6, up: .3, tag: 'ridedust' }); } }
    if (v > 3 && API.leafAt(o.x, o.z)) { A.leaf += dt * v * .3; while (A.leaf > 1) { A.leaf -= 1; API.leaves(rx, y, rz, 2, fx * v * .6, fz * v * .6); } }
    if (o.brake && (o.decel || 0) > 5.2 && v > 1.5) { A.skid += v * dt; if (A.skid > .3) { API.skid(rx + fx * A.skid / 2, y, rz + fz * A.skid / 2, o.h, A.skid + .06); A.skid = 0; if (rnd() < .5) API.puff(rx, y, rz, { n: 1, size: .25, life: .6, r: .5, g: .5, b: .52, a: .12, up: .3, tag: 'tyresmoke' }); } } else A.skid = 0; };

  /* ------------------------------------------------------------------ birds: a few sparrows / pigeons pecking at fixed spots; they scatter when you come close */
  const SPOTS = [[11.5, 46, 'sparrow'], [40, 62, 'pigeon'], [48, 43, 'sparrow'], [-27, 26, 'pigeon'], [11.5, 78, 'sparrow'], [30, 70, 'sparrow'], [58, 66, 'pigeon'], [30, 40, 'sparrow'], [-30, 42, 'pigeon'], [64, 60, 'pigeon'], [52, 84, 'sparrow'], [-40, 18, 'sparrow']];   // first four that are clear of colliders and off the carriageway
  function free(x, z) { const B = GT.world && GT.world.boxes; if (!B) return true; for (const b of B) if (b.h > .3 && x > b.x0 - 1.6 && x < b.x1 + 1.6 && z > b.z0 - 1.6 && z < b.z1 + 1.6) return false; const f = GT.cnroad && GT.cnroad.inRoad; return !(f && f(x, z)); }
  function makeFlocks() { let slot = 0;
    for (const sp of SPOTS) { if (S.flocks.length >= 4) break; if (!free(sp[0], sp[1])) continue; const n = sp[2] === 'pigeon' ? 5 : 6, fl = { x: sp[0], z: sp[1], y: groundY(sp[0], sp[1]), kind: sp[2], state: 'peck', t: 0, calm: 0, birds: [] };
      for (let i = 0; i < n && slot < NB; i++) { const a = rnd() * TAU, d = rr(.2, 1.3), tone = rr(.75, 1.05), pg = sp[2] === 'pigeon'; fl.birds.push({ slot: slot++, hx: fl.x + Math.cos(a) * d, hz: fl.z + Math.sin(a) * d, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, face: rnd() < .5 ? 1 : -1, ph: rnd() * 9, hop: rr(1, 4), jump: 0, delay: 0, size: pg ? rr(.4, .47) : rr(.27, .32),
        r: (pg ? .1 : .13) * tone, g: (pg ? .105 : .085) * tone, b: (pg ? .13 : .05) * tone, air: 0, ang: rnd() * TAU, rad: rr(5, 9), alt: rr(5, 8.5) }); }
      for (const b of fl.birds) { b.x = b.hx; b.z = b.hz; b.y = fl.y; } S.flocks.push(fl); }
    S.stats.birds = slot; }
  function birds(dt, cam, pl) { const cx = cam.matrixWorld.elements[0], cz = cam.matrixWorld.elements[2];
    for (const fl of S.flocks) { fl.t += dt; const dp = pl ? Math.hypot(pl.x - fl.x, pl.z - fl.z) : 1e9, scare = pl ? (pl.speed > 4 ? 9 : pl.speed > 2 ? 6.5 : 4.2) : 0;
      if (fl.state === 'peck' && dp < scare) { fl.state = 'air'; fl.t = 0; fl.calm = 0; cnt('scatter'); const A = GT.audio; if (A && A.sfx) { try { A.sfx('flap', { x: fl.x, y: 1, z: fl.z, g: fl.kind === 'pigeon' ? 1.6 : 1 }); } catch (e) { /* audio is optional */ } }
        for (const b of fl.birds) { const ax = b.x - pl.x, az = b.z - pl.z, l = Math.hypot(ax, az) || 1, j = rr(-.7, .7), c = Math.cos(j), s = Math.sin(j), dx = (ax * c - az * s) / l, dz = (ax * s + az * c) / l; b.vx = dx * rr(3.5, 6); b.vz = dz * rr(3.5, 6); b.vy = rr(2.6, 4.4); b.air = 1; b.delay = rr(0, .22); } }
      else if (fl.state === 'air') { fl.calm = dp > 13 ? fl.calm + dt : 0; if (fl.calm > 7 && fl.t > 9) { fl.state = 'land'; fl.t = 0; } }
      else if (fl.state === 'land' && fl.birds.every(b => !b.air)) fl.state = 'peck';
      for (const b of fl.birds) { b.ph += dt; let cell, w = b.size;
        if (!b.air) { b.hop -= dt; if (b.hop < 0) { b.hop = rr(.8, 3.5); if (rnd() < .5) b.face = -b.face; b.hx = clamp(b.hx + rr(-.3, .3), fl.x - 1.5, fl.x + 1.5); b.hz = clamp(b.hz + rr(-.3, .3), fl.z - 1.5, fl.z + 1.5); b.jump = .16; }
          b.x += (b.hx - b.x) * Math.min(1, dt * 6); b.z += (b.hz - b.z) * Math.min(1, dt * 6); if (b.jump > 0) b.jump -= dt; b.y = fl.y + Math.max(0, Math.sin(Math.max(0, b.jump) / .16 * Math.PI)) * .05;
          cell = Math.sin(b.ph * 5.3 + b.slot) > .25 ? 10 : 9; { const e = cam.matrixWorld.elements, dn = Math.hypot(e[12] - b.x, e[14] - b.z), na = Math.max(0, Math.min(1, (dn - 2.4) / 2.4)); put(b.slot, b.x, b.y + b.size * .3, b.z, w * b.face, b.size, 0, 0, b.r, b.g, b.b, na, cell); }   /* g6: a flat bird sprite right under the camera read as a paper cut-out; it fades inside 4.8 m (they normally fly off before that) */ continue; }
        if (b.delay > 0) { b.delay -= dt; put(b.slot, b.x, b.y + b.size * .3, b.z, w * b.face, b.size, 0, 0, b.r, b.g, b.b, 1, 9); continue; }
        if (fl.state === 'land') { const tx = b.hx - b.x, tz = b.hz - b.z, ty = fl.y - b.y, l = Math.hypot(tx, tz); if (l < .35 && Math.abs(ty) < .3) { b.air = 0; b.x = b.hx; b.z = b.hz; b.y = fl.y; b.hop = rr(.5, 2); }
          else { const sp = Math.min(7, 2 + l); b.vx += (tx / (l || 1) * sp - b.vx) * Math.min(1, dt * 2.5); b.vz += (tz / (l || 1) * sp - b.vz) * Math.min(1, dt * 2.5); b.vy += (clamp(ty * 1.2, -3, 1) - b.vy) * Math.min(1, dt * 3); } }
        else { b.ang += dt * .55; const tx = fl.x + Math.cos(b.ang) * b.rad * 2.2 + (fl.x - (pl ? pl.x : fl.x)) * .6, tz = fl.z + Math.sin(b.ang) * b.rad * 2.2 + (fl.z - (pl ? pl.z : fl.z)) * .6, k = sst(fl.t, .5, 2.5);          // climb out, then circle downwind of the player
          b.vx += ((tx - b.x) * .5 - b.vx) * Math.min(1, dt * 1.2) * k; b.vz += ((tz - b.z) * .5 - b.vz) * Math.min(1, dt * 1.2) * k; b.vy += ((fl.y + b.alt - b.y) * 1.1 - b.vy) * Math.min(1, dt * 1.6) * k; const h = Math.hypot(b.vx, b.vz); if (h > 8) { b.vx *= 8 / h; b.vz *= 8 / h; } }
        b.x += b.vx * dt; b.y = Math.max(fl.y, b.y + b.vy * dt); b.z += b.vz * dt; const side = b.vx * cx + b.vz * cz; if (Math.abs(side) > .4) b.face = side > 0 ? 1 : -1;
        cell = Math.sin(b.ph * 38) > 0 ? 7 : 8; put(b.slot, b.x, b.y + b.size * .3, b.z, w * 1.05 * b.face, b.size * 1.05, clamp(b.vy * .08, -.4, .4) * b.face, 0, b.r, b.g, b.b, 1, cell); } } }

  /* ------------------------------------------------------------------ steam wisps (manholes, stall vents) that lean with the wind */
  function makePlumes() { const st = (GT.snackstreet && GT.snackstreet.stalls) || {}, add = (x, y, z, rate, size) => API.steam(x, y, z, { kind: 'stall', rate: rate * 1.6, size: size * .72 });
    for (const p of [[32.6, -6.8], [46.2, -11.4], [41, 41.6], [58.5, 42.3], [70, 40.9]]) API.steam(p[0], groundY(p[0], p[1]) + .03, p[1], { kind: 'manhole' });                 // manhole covers (snack lane + the back lane)
    for (const id of ['baozi', 'xiaomian', 'shengjian']) { const c = st[id] && st[id].cook; if (c) add(c.x, 2.3, c.z, 2.2, .7); } }
  /* ------------------------------------------------------------------ 霓虹江城 air: lit steam / smoke emitters, light shafts under lamps, rain mist. All cheap quads: the steam shares the one particle mesh, the shafts are one more instanced draw call.
     GT.fxsmall.steam(x, y, z, o) -> handle { x, y, z, on, remove() }   (may be called before init; move or switch the handle at any time)
       o.kind     'stall' (default: a pot or grill vent, 2.2 m column) | 'manhole' (a dense street column about 4 m tall, lit pink low and white high) | 'smoke' (grey charcoal smoke, drifts further)
       o.color    light on the foot of the column: hex sRGB | [r,g,b] linear | THREE.Color. Default: the lamp colour of the district it stands in (GT.atmos.district)
       o.color2   light on the top of the column (default: a paler mix of color; 'manhole' goes to white)
       o.rate (puffs / s) · o.size (m) · o.rise (m/s) · o.life (s) · o.lit (brightness, default 1) · o.always (true = same strength all day; default thins out at noon)
     GT.fxsmall.shaft(x, y, z, o) -> handle { remove() }   a cone of lit air hanging under a lamp at (x, y, z) = the lamp head. Night only, stronger in rain.
       o.h (height, default y) · o.r0 / o.r1 (radius at the lamp / at the ground) · o.color or o.district ('avenue' | 'snack' | 'river' | 'wharf' | 'yard') · o.k (strength, default .5) · o.lean [dx, dz] (where the foot stands relative to the head) */
  const AIR = { steam: [], shafts: [], dirty: false, mesh: null, cap: 256, mistAcc: 0 };
  const lin = (c, fb) => { if (c === undefined || c === null) return fb; if (typeof c === 'number') { const k = new T.Color(c).convertSRGBToLinear(); return [k.r, k.g, k.b]; } if (c.isColor) return [c.r, c.g, c.b]; return [c[0], c[1], c[2]]; };
  const distLamp = (x, z, key) => { const A = GT.atmos, d = A && A.district ? (key ? A.district[key] : A.districtOf(x, z)) : null; return d ? d : null; };
  API.steam = function (x, y, z, o) { o = o || {}; const kind = o.kind || 'stall', d = distLamp(x, z, o.district), lc = d ? lin(d.lampColor) : [1, .6, .25], ac = d ? lin(d.accentColor) : [1, .1, .3], base = kind === 'manhole' ? [lc[0] * .72 + ac[0] * .28, lc[1] * .72 + ac[1] * .28, lc[2] * .72 + ac[2] * .28] : lc;   /* b5: a manhole column takes the lamp colour of its street with a trace of the accent; it was pure accent pink and read as a beam of pink light */
    const c = lin(o.color, base), c2 = lin(o.color2, kind === 'manhole' ? [.5, .5, .56] : [c[0] * .5 + .45, c[1] * .5 + .45, c[2] * .5 + .45]), P = kind === 'manhole' ? { rate: 5.5, size: .5, rise: .95, life: 3.6, a: .42 } : kind === 'smoke' ? { rate: 4, size: .5, rise: .6, life: 4.2, a: .4 } : { rate: 5, size: .46, rise: .8, life: 2.8, a: .56 };   /* b5: fewer, smaller, thinner puffs: the old columns were solid */   /* a: the puff texture is thin (0.2 per lobe), so these are high */
    const h = { x, y, z, on: true, kind, c, c2, rate: Math.min(o.rate || P.rate, 6.5), size: Math.min(o.size || P.size, .6), rise: o.rise || P.rise, life: o.life || P.life, a: (o.a || P.a), lit: o.lit === undefined ? 1 : o.lit, always: !!o.always, acc: rnd(), remove() { const i = AIR.steam.indexOf(h); if (i >= 0) AIR.steam.splice(i, 1); } };
    AIR.steam.push(h); return h; };
  API.shaft = function (x, y, z, o) { o = o || {}; const d = distLamp(x, z, o.district), c = lin(o.color, d ? lin(d.lampColor) : [1, .8, .5]);
    const h = { x, y, z, h: o.h || y, r0: o.r0 === undefined ? .3 : o.r0, r1: o.r1 === undefined ? 2.4 : o.r1, c, k: o.k === undefined ? .5 : o.k, lx: o.lean ? o.lean[0] : 0, lz: o.lean ? o.lean[1] : 0, remove() { const i = AIR.shafts.indexOf(h); if (i >= 0) { AIR.shafts.splice(i, 1); AIR.dirty = true; } } };
    AIR.shafts.push(h); AIR.dirty = true; return h; };
  function shaftMesh(scene) { const q = new T.PlaneGeometry(1, 1), geo = new T.InstancedBufferGeometry(); geo.index = q.index; geo.setAttribute('position', q.attributes.position); geo.setAttribute('uv', q.attributes.uv); geo.instanceCount = 0;
    const mk = (name, n) => { const a = new T.InstancedBufferAttribute(new Float32Array(AIR.cap * n), n); a.setUsage(T.DynamicDrawUsage); geo.setAttribute(name, a); return a; }; AIR.aTop = mk('aTop', 3); AIR.aDim = mk('aDim', 4); AIR.aCol = mk('aCol', 3); AIR.aLean = mk('aLean', 2);
    const mat = new T.ShaderMaterial({ uniforms: { uK: { value: 0 }, uT: { value: 0 } }, transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor,
      vertexShader: 'attribute vec3 aTop; attribute vec4 aDim; attribute vec3 aCol; attribute vec2 aLean; uniform float uK; varying vec2 vUv; varying vec3 vC; varying float vS;\n' +
        'void main(){ float f = 1. - uv.y; vec3 ax = aTop + vec3(aLean.x, 0., aLean.y) * f - vec3(0., aDim.x, 0.) * f; vec3 toC = cameraPosition - ax; float dc = length(toC.xz); vec3 rt = normalize(vec3(toC.z, 0., -toC.x) + vec3(1e-4, 0., 0.));\n' +
        ' vec3 p = ax + rt * position.x * 2. * mix(aDim.y, aDim.z, f); vUv = uv; vS = aTop.x * .37 + aTop.z * .51; vC = aCol * aDim.w * uK * smoothstep(aDim.z * .9, aDim.z * 2.6 + 2., dc) * (1. - smoothstep(110., 170., dc));   /* fades out as the camera walks into the cone (a quad seen from inside is a flat wedge) */ gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }',
      fragmentShader: 'uniform float uT; varying vec2 vUv; varying vec3 vC; varying float vS;\n' +
        'void main(){ float x = abs(vUv.x - .5) * 2., f = 1. - vUv.y; float e = 1. - x * x; e *= e; float v = (.25 + .75 * exp(-f * 2.6)) * smoothstep(0., .06, vUv.y) * smoothstep(0., .03, f);\n' +
        ' float n = .78 + .22 * sin(vUv.x * 9. + vS + sin(f * 5. - uT * .35 + vS) * 1.4) * sin(f * 3.1 + uT * .22 + vS * 2.); gl_FragColor = vec4(vC * e * v * n, 0.);\n #include <tonemapping_fragment>\n #include <encodings_fragment>\n }' });
    mat.name = 'fxsmall_shafts'; const m = AIR.mesh = new T.Mesh(geo, mat); m.name = 'fxsmall_shafts'; m.frustumCulled = false; m.castShadow = m.receiveShadow = false; m.renderOrder = 6; scene.add(m); }
  function shaftFill() { const n = Math.min(AIR.shafts.length, AIR.cap); for (let i = 0; i < n; i++) { const s = AIR.shafts[i]; AIR.aTop.setXYZ(i, s.x, s.y, s.z); AIR.aDim.setXYZW(i, s.h, s.r0, s.r1, s.k); AIR.aCol.setXYZ(i, s.c[0], s.c[1], s.c[2]); AIR.aLean.setXY(i, s.lx, s.lz); }
    AIR.aTop.needsUpdate = AIR.aDim.needsUpdate = AIR.aCol.needsUpdate = AIR.aLean.needsUpdate = true; AIR.mesh.geometry.instanceCount = n; AIR.dirty = false; S.stats.shafts = n; }
  function air(dt, cam) { const env = GT.env || {}, night = env.night || 0, wet = clamp(+env.wet || 0, 0, 1), h = env.hours === undefined ? 12 : env.hours, cool = .5 + .5 * Math.max(1 - sst(h, 7.5, 11), sst(h, 17, 19.5)), cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    if (AIR.mesh) { if (AIR.dirty) shaftFill(); const u = AIR.mesh.material.uniforms; u.uK.value = night * (.6 + .55 * wet); u.uT.value = S.t; AIR.mesh.visible = night > .02 && AIR.mesh.geometry.instanceCount > 0; }
    S.mesh.material.uniforms.uLitK.value = night; let ns = 0;
    for (const p of AIR.steam) { if (!p.on || Math.abs(p.x - cx) + Math.abs(p.z - cz) > 75) continue; ns++; const k = p.always ? 1 : cool, gu = clamp(.3 + Math.sin(S.t * .9 + p.x * 1.7) * .55 + Math.sin(S.t * .37 + p.z * 2.3) * .55, .12, 1.25); p.acc += dt * p.rate * k * gu;   /* it comes in breaths, so the column breaks into separate wisps */ const man = p.kind === 'manhole', smoke = p.kind === 'smoke', L = p.lit * (smoke ? .3 : .6);
      while (p.acc > 1) { p.acc -= 1; const sp = man ? .12 : .16, wisp = rnd() < .5;   /* half the puffs are tall thin wisps, the rest soft lumps; every one has its own size, strength and drift */
        spawn({ x: p.x + rr(-sp, sp), y: p.y, z: p.z + rr(-sp, sp), vx: rr(-.24, .24), vy: p.rise * rr(.6, 1.3), vz: rr(-.24, .24), s0: p.size * rr(.2, .4), s1: p.size * (wisp ? rr(.9, 1.5) : rr(1.7, man ? 2.9 : 2.5)), asp: wisp ? rr(1.7, 2.6) : rr(.85, 1.25), life: p.life * rr(.7, 1.25), r: p.c[0] * L, g: p.c[1] * L, b: p.c[2] * L, r2: p.c2[0] * L, g2: p.c2[1] * L, b2: p.c2[2] * L,
          a: p.a * (p.always ? 1 : .55 + .45 * k) * (wisp ? rr(.7, 1.15) : rr(.3, .8)), cell: 0, mode: 3, drag: man ? .16 : .3, wind: smoke ? 1.3 : man ? .7 : .9, vr: rr(-.55, .55), fin: .28 }); } }
    /* b5 — the air under the lamps: slow sheets of lit haze drift through every lamp cone near the camera, and bright dust hangs in the big mast floods (the avenue and the wharf had clean, empty air) */
    if (night > .3 && AIR.shafts.length) { AIR.nearT = (AIR.nearT || 0) - dt; if (AIR.nearT <= 0 || !AIR.near) { AIR.nearT = 1; AIR.near = AIR.shafts.filter(s => Math.abs(s.x - cx) + Math.abs(s.z - cz) < 64); }
      const nn = AIR.near.length; AIR.hazeAcc = (AIR.hazeAcc || 0) + dt * Math.min(7, nn * .8) * night; while (AIR.hazeAcc > 1 && nn) { AIR.hazeAcc -= 1; const s = AIR.near[(rnd() * nn) | 0], f = rr(.3, .97), rad = (s.r0 + (s.r1 - s.r0) * f) * rr(0, .75), a = rnd() * TAU, x = s.x + s.lx * f + Math.cos(a) * rad, y = s.y - s.h * f, z = s.z + s.lz * f + Math.sin(a) * rad, big = s.h > 12;
        if (big && rnd() < .6) spawn({ x, y, z, vx: wind.x * .2 + rr(-.08, .08), vy: rr(-.1, .03), vz: wind.z * .2 + rr(-.08, .08), s0: rr(.5, 1.3), s1: rr(.7, 1.6), life: rr(2.6, 4.6), r: s.c[0] * .9 + .1, g: s.c[1] * .9 + .1, b: s.c[2] * .9 + .1, a: rr(.25, .6) * (1 - f * .5), cell: 11, mode: 2, drag: .2, wind: .35, vr: rr(-.2, .2), fin: .3 });
        else { const L = (big ? .1 : .2) * (1 - f * .35), sz = big ? rr(2.2, 3.6) : rr(1.1, 2); spawn({ x, y, z, vx: wind.x * .5 + rr(-.1, .1), vy: rr(-.03, .05), vz: wind.z * .5 + rr(-.1, .1), s0: sz, s1: sz * rr(1.4, 1.9), asp: rr(.6, 1), life: rr(3.2, 5.2), r: s.c[0] * L, g: s.c[1] * L, b: s.c[2] * L, a: (big ? rr(.015, .035) : rr(.035, .075)) * (1 + .6 * wet), cell: 0, mode: 3, drag: .1, wind: .5, vr: rr(-.1, .1), fin: .4 }); } } }
    S.stats.steam = ns;
    if (wet > .25 && cy < 30) { AIR.mistAcc += dt * 7 * wet; const A = GT.atmos;   /* rain mist: big soft sheets of lit air drifting low around the camera, in the lamp colour of where they hang */
      while (AIR.mistAcc > 1) { AIR.mistAcc -= 1; const a = rnd() * TAU, d = rr(7, 34), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, dl = A && A.districtOf ? A.districtOf(x, z).lampColor : null, c = dl ? [dl.r, dl.g, dl.b] : [.6, .7, .8], L = .1;
        spawn({ x, y: Math.max(.3, cy - 1.4) + rr(0, 2.2), z, vx: wind.x * .6, vy: rr(-.02, .06), vz: wind.z * .6, s0: rr(3.5, 5), s1: rr(7, 10), life: rr(3.5, 5.5), r: c[0] * L, g: c[1] * L, b: c[2] * L, a: rr(.05, .1) * wet, cell: 0, mode: 3, drag: .1, wind: .5, vr: rr(-.08, .08), fin: .35 }); } } }
  function plumes(dt, cam) { const env = GT.env || {}, h = env.hours === undefined ? 12 : env.hours, cool = .45 + .55 * Math.max(1 - sst(h, 7.5, 11), sst(h, 17.5, 20)), cx = cam.position.x, cz = cam.position.z;
    for (const p of S.plumes) { if (Math.abs(p.x - cx) + Math.abs(p.z - cz) > 70) continue; p.acc += dt * p.rate * cool; while (p.acc > 1) { p.acc -= 1;
        spawn({ x: p.x + rr(-.12, .12), y: p.y, z: p.z + rr(-.12, .12), vx: rr(-.08, .08), vy: rr(.5, .9), vz: rr(-.08, .08), s0: p.size * rr(.35, .5), s1: p.size * rr(1.8, 2.6), life: rr(2.2, 3.4), r: .95, g: .96, b: .98, a: .26 * cool + .08, cell: 0, drag: .25, wind: 1, vr: rr(-.3, .3), fin: .25 }); } } }

  /* ------------------------------------------------------------------ init / update */
  /* ================================================================== road hazards (phase 6: what shakes a rider) + the welder at 师傅汽修
     Three kinds, all real geometry you can see coming, all in ONE vertex-coloured mesh (+ one decal mesh for the potholes):
       bump   yellow / black rubber speed hump across a whole carriageway (back road, both cross streets)
       cable  a black cable protector with a yellow lid across a bike lane of the avenue
       hole   a water-filled pothole (dark, glossy, it mirrors lamps and signs at night through the wet-ground reflections)
     Crossing one with the vehicle the player rides or drives kicks its suspension (the bike's e.bumpV spring, the car's dip spring in js/cngame.js), so the body hops, the
     kerb thump plays and the camera takes the hit; on two wheels the rear wheel follows the front one a wheelbase later. Speed decides how hard. HZ.defs is the list a tester can ride to. */
  const HZ = { defs: [
      ['bump', 150, -70, 'x', 8.6], ['bump', 150, 22, 'x', 8.6], ['bump', 150, 96, 'x', 8.6], ['bump', 70, 160, 'z', 8.6], ['bump', 86, -160, 'z', 8.6],
      ['cable', 6.87, -30, 'x', 1.26], ['cable', 6.87, 96, 'x', 1.26], ['cable', -6.87, 40, 'x', 1.26], ['cable', -6.87, -100, 'x', 1.26],
      ['hole', 4.9, -45, .5], ['hole', -4.9, 118, .56], ['hole', 6.8, 24, .36], ['hole', 148.4, -25, .52], ['hole', 151.7, 60, .46], ['hole', 40, 158.4, .5], ['hole', 110, -161.3, .55]],
    list: [], pend: [], px: null, pz: null, ent: null, hits: 0, last: '', weld: null };
  API.hazards = HZ;
  /** pure: did the move (x0,z0) -> (x1,z1) run over hazard h? */
  function hazardHit(h, x0, z0, x1, z1) {
    if (h.kind === 'hole') { const d1 = Math.hypot(x1 - h.x, z1 - h.z), d0 = Math.hypot(x0 - h.x, z0 - h.z), r = h.r + .22; return d1 < r && d0 >= r; }
    const a0 = h.ax === 'x' ? z0 - h.z : x0 - h.x, a1 = h.ax === 'x' ? z1 - h.z : x1 - h.x, along = h.ax === 'x' ? x1 - h.x : z1 - h.z;   /* ax 'x': the strip lies along x and is crossed by travelling in z */
    return Math.abs(along) <= h.len / 2 + .25 && ((a0 < 0 && a1 >= 0) || (a0 > 0 && a1 <= 0)); }
  /** pure: how hard (m/s of suspension kick; negative = the wheel drops into a hole) at sp m/s */
  function hazardKick(kind, sp) { return kind === 'bump' ? clamp(.5 + sp * .085, .62, 1.55) : kind === 'cable' ? clamp(.42 + sp * .07, .58, 1.2) : -clamp(.45 + sp * .075, .6, 1.25); }
  API._hazardHit = hazardHit; API._hazardKick = hazardKick;
  function hazards(scene) {
    const pos = [], col = [], idx = [], hp = [], huv = [], hidx = [];
    const strip = (x, y, z, ax, len, prof, seg, cols) => {   /* prof: [[offset across the strip, height, colour index]...]; cols: per segment parity -> colour table */
      const nseg = Math.max(1, Math.round(len / seg)), sl = len / nseg;
      for (let k = 0; k < nseg; k++) { const a0 = -len / 2 + k * sl + .012, a1 = a0 + sl - .024;
        for (let i = 0; i < prof.length - 1; i++) { const p = prof[i], q = prof[i + 1], c = cols[(k + (p[2] || 0)) % cols.length], b = pos.length / 3;
          for (const [a, pr] of [[a0, p], [a1, p], [a1, q], [a0, q]]) { if (ax === 'x') pos.push(x + a, y + pr[1], z + pr[0]); else pos.push(x + pr[0], y + pr[1], z - a); col.push(c[0], c[1], c[2]); }
          idx.push(b, b + 2, b + 1, b, b + 3, b + 2); } } };
    const YEL = [.78, .52, .035], BLK = [.022, .022, .024], RUB = [.035, .035, .038];
    for (const d of HZ.defs) { const kind = d[0], x = d[1], z = d[2], y = groundY(x, z);
      if (kind === 'hole') { const r = d[3], b = hp.length / 3, a = (x * 12.9898 + z * 78.233) % TAU; for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { hp.push(x + (u * Math.cos(a) - v * Math.sin(a)) * r * 1.5, y + .014, z + (u * Math.sin(a) + v * Math.cos(a)) * r * 1.5); huv.push(u * .5 + .5, v * .5 + .5); } hidx.push(b, b + 2, b + 1, b, b + 3, b + 2); HZ.list.push({ kind, x, z, r }); continue; }
      const ax = d[3], len = d[4];
      if (kind === 'bump') { const pr = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pr.push([(t - .5) * .4, .058 * Math.sin(Math.PI * t), 0]); } strip(x, y, z, ax, len, pr, .43, [YEL, BLK]); }
      else { strip(x, y, z, ax, len, [[-.26, 0, 0], [-.1, .048, 0]], len, [RUB]); strip(x, y, z, ax, len, [[-.1, .048, 0], [-.07, .052, 0], [.07, .052, 0], [.1, .048, 0]], len, [YEL]); strip(x, y, z, ax, len, [[.1, .048, 0], [.26, 0, 0]], len, [RUB]); }
      HZ.list.push({ kind, x, z, ax, len }); }
    /* the welder's bench in front of 师傅汽修, left of the roller shutter: a steel trestle with a frame on it */
    const WX = 44.7, WZ = 41.25, wy = groundY(WX, WZ), box = (cx, cy, cz, w, h, d, c) => { const X = [cx - w / 2, cx + w / 2], Y = [cy - h / 2, cy + h / 2], Z = [cz - d / 2, cz + d / 2];   /* top + four sides, no bottom */
      const P = (i, j, k) => [X[i], Y[j], Z[k]], quads = [[P(0, 1, 0), P(0, 1, 1), P(1, 1, 1), P(1, 1, 0)], [P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)], [P(1, 0, 0), P(0, 0, 0), P(0, 1, 0), P(1, 1, 0)], [P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0)], [P(1, 0, 1), P(1, 0, 0), P(1, 1, 0), P(1, 1, 1)]];
      for (const q of quads) { const b = pos.length / 3; for (const v of q) { pos.push(v[0], v[1], v[2]); col.push(c[0], c[1], c[2]); } idx.push(b, b + 1, b + 2, b, b + 2, b + 3); } };
    const ST = [.16, .17, .19], RST = [.3, .16, .08];
    box(WX, wy + .74, WZ, 1.1, .05, .55, ST); for (const [dx, dz] of [[-.5, -.22], [.5, -.22], [-.5, .22], [.5, .22]]) box(WX + dx, wy + .36, WZ + dz, .05, .72, .05, ST);
    box(WX - .1, wy + .8, WZ, .7, .06, .06, RST); box(WX + .2, wy + .86, WZ - .12, .06, .18, .3, RST); box(WX - .42, wy + .28, WZ + .5, .24, .56, .24, [.5, .09, .07]);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: 0, side: T.DoubleSide })); m.name = 'fx_hazards'; m.receiveShadow = true; m.castShadow = false; scene.add(m); HZ.mesh = m;
    /* potholes: a broken-edged dark blot with standing water */
    { const c = document.createElement('canvas'); c.width = c.height = 128; const q = c.getContext('2d'); q.translate(64, 64);
      q.fillStyle = 'rgba(46,44,40,.55)'; q.beginPath(); for (let k = 0; k <= 36; k++) { const a = k / 36 * TAU, r = 40 + 9 * Math.sin(a * 3 + 1) + 6 * Math.sin(a * 7 + 2.3) + 4 * Math.sin(a * 13); q.lineTo(Math.cos(a) * r, Math.sin(a) * r); } q.fill();
      q.fillStyle = 'rgba(12,13,15,.96)'; q.beginPath(); for (let k = 0; k <= 36; k++) { const a = k / 36 * TAU, r = 30 + 7 * Math.sin(a * 3 + 1.4) + 5 * Math.sin(a * 5 + .7) + 3 * Math.sin(a * 11 + 2); q.lineTo(Math.cos(a) * r, Math.sin(a) * r); } q.fill();
      q.strokeStyle = 'rgba(20,20,22,.7)'; q.lineWidth = 1.6; for (let k = 0; k < 7; k++) { const a = k * .9 + .3; q.beginPath(); q.moveTo(Math.cos(a) * 34, Math.sin(a) * 34); q.lineTo(Math.cos(a + .12) * 50, Math.sin(a + .12) * 50); q.lineTo(Math.cos(a - .05) * 60, Math.sin(a - .05) * 60); q.stroke(); }
      const tx = new T.CanvasTexture(c); tx.encoding = T.sRGBEncoding; tx.anisotropy = 8;
      const hm = new T.MeshStandardMaterial({ map: tx, transparent: true, depthWrite: false, roughness: .08, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      hm.userData.gtReflect = 1; hm.blending = T.CustomBlending; hm.blendSrc = T.SrcAlphaFactor; hm.blendDst = T.OneMinusSrcAlphaFactor; hm.blendSrcAlpha = T.ZeroFactor; hm.blendDstAlpha = T.OneMinusSrcAlphaFactor;   /* colour blends as usual; the alpha factors mark "mirror here" for js/render.js */
      const hg = new T.BufferGeometry(); hg.setAttribute('position', new T.Float32BufferAttribute(hp, 3)); hg.setAttribute('uv', new T.Float32BufferAttribute(huv, 2)); hg.setIndex(hidx); hg.computeVertexNormals();
      const hmesh = new T.Mesh(hg, hm); hmesh.name = 'fx_potholes'; hmesh.receiveShadow = true; hmesh.renderOrder = 1; scene.add(hmesh); HZ.holes = hmesh; }
    /* the arc: an HDR additive sprite (bloom and the anamorphic streak do the glare) + its light on the ground and on the wall, no real light source */
    { const c = document.createElement('canvas'); c.width = c.height = 64; const q = c.getContext('2d'), gr = q.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.18, 'rgba(255,255,255,.55)'); gr.addColorStop(.5, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); q.fillStyle = gr; q.fillRect(0, 0, 64, 64);
      const tx = new T.CanvasTexture(c), mk = () => new T.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false, color: 0x000000, side: T.DoubleSide });
      const arc = new T.Sprite(new T.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false, color: 0x000000 })); arc.position.set(WX + .2, wy + .84, WZ - .02); arc.scale.set(.5, .5, 1);
      const gp = new T.Mesh(new T.PlaneGeometry(7, 7), mk()); gp.rotation.x = -Math.PI / 2; gp.position.set(WX + .2, wy + .035, WZ + .6); gp.renderOrder = 4;
      const wp = new T.Mesh(new T.PlaneGeometry(5, 3.4), mk()); wp.position.set(WX + .2, wy + 1.5, 40.4 + .13); wp.renderOrder = 4;
      const grp = new T.Group(); grp.name = 'fx_weld'; grp.add(arc, gp, wp); grp.visible = false; scene.add(grp); HZ.weld = { grp, arc, gp, wp, x: WX + .2, y: wy + .84, z: WZ - .02, t: 0, on: 0, next: 1.5, sp: 0, k: 0 }; }
  }
  function hazardStep(dt, camera) {
    const g = GT.cngame, P = g && g.player, e = P && (P.mode === 'two' || P.mode === 'car') ? P.ent : null, sim = g && g.sim;
    for (let i = HZ.pend.length - 1; i >= 0; i--) { const p = HZ.pend[i]; p.t -= dt; if (p.t <= 0) { HZ.pend.splice(i, 1); if (p.e === e && e) { e.bumpV = p.k; if (sim && sim.shake) sim.shake(Math.abs(p.k) * .1); } } }
    if (!e || e !== HZ.ent || HZ.px === null) { HZ.ent = e; HZ.px = e ? e.x : null; HZ.pz = e ? e.z : null; }
    else { const x0 = HZ.px, z0 = HZ.pz, x1 = e.x, z1 = e.z; HZ.px = x1; HZ.pz = z1; const mv = Math.hypot(x1 - x0, z1 - z0), sp = dt > 0 ? mv / dt : 0;
      if (mv > 1e-4 && mv < 4 && sp > .8) for (const h of HZ.list) { if (Math.abs(h.x - x1) > 12 || Math.abs(h.z - z1) > 12 || !hazardHit(h, x0, z0, x1, z1)) continue;
        const k = hazardKick(h.kind, sp), two = P.mode === 'two'; HZ.hits++; HZ.last = h.kind + '@' + h.x + ',' + h.z; cnt('hazard_' + h.kind);
        if (two) { e.bumpV = k; e.v *= h.kind === 'bump' ? .93 : .97; const wb = (e.dims && e.dims.wheelbase) || 1.25; HZ.pend.push({ t: Math.min(.5, wb / Math.max(sp, 1.5)), k: k * .72, e }); }   /* front wheel now, rear wheel a wheelbase later */
        else if (e.c) { e.c.dipV = (e.c.dipV || 0) + k * .8; if (GT.audio && GT.audio.sfx) { try { GT.audio.sfx('kerb', { v: clamp(Math.abs(k) / 1.4, .3, 1) }); } catch (err) { /* sound is optional */ } } }
        if (sim && sim.shake) sim.shake(clamp(.1 + Math.abs(k) * .16, .12, .4));
        const y = e.y || 0; if (h.kind === 'hole') API.splash(h.x, y, h.z, clamp(sp / 9, .4, 1), 0, 0); else API.puff(x1, y, z1, { n: 3, size: .3, a: .16, spread: .6 }); } }
    /* speed shake inside a car (js/cngame.js already buzzes the bike): a fine vertical tremble that grows from 60 km/h, applied after the camera was placed */
    if (camera && P && P.mode === 'car' && e && !(g.G && g.G.cine) && !/[?&]shake=0/.test(location.search)) { const sp = Math.abs(P.speed || 0), b = sst(sp, 16, 44) * .0034, t = S.t; if (b > 1e-5) { camera.position.y += (Math.sin(t * 41.3) + Math.sin(t * 67.9 + 1.1) * .6) * b; camera.rotation.x += Math.sin(t * 53.1 + .4) * b * .22; } }
    /* welder: bursts of arc light after dusk (and whenever it rains), with sparks when the camera is near enough to see them */
    const W = HZ.weld; if (W) { const env = GT.env || {}, act = (env.night || 0) > .25 || (env.wet || 0) > .5; W.grp.visible = act;
      if (act) { W.t += dt; if (W.t > W.next) { W.t = 0; W.on = W.on > 0 ? 0 : 1.2 + rnd() * 1.6; W.next = W.on > 0 ? W.on : 1.6 + rnd() * 3.2; }
        const lit = W.on > 0 ? (.35 + .65 * rnd()) * (rnd() < .08 ? .1 : 1) : 0; W.k += (lit - W.k) * Math.min(1, dt * 40); const k = W.k;
        W.arc.material.color.setRGB(26 * k, 40 * k, 64 * k); W.arc.scale.setScalar(.34 + .3 * k); W.gp.material.color.setRGB(.55 * k, .8 * k, 1.25 * k); W.wp.material.color.setRGB(.4 * k, .6 * k, .95 * k);
        if (lit > 0 && camera) { W.sp -= dt; if (W.sp <= 0) { W.sp = .09 + rnd() * .1; const dx = camera.position.x - W.x, dz = camera.position.z - W.z; if (dx * dx + dz * dz < 55 * 55) API.sparks(W.x, W.y, W.z, 4 + (rnd() * 5 | 0), rnd() - .5, .6 + rnd() * .5); } } } }
  }
  API.init = function (scene) { if (S.ready || !T || !scene) return API; build(scene); try { shaftMesh(scene); } catch (e) { console.warn('[fxsmall] shafts', e); }
    for (let i = 0; i < NP; i++) S.P.push({ life: 0, max: 1 }); for (let i = 0; i < ND; i++) S.D.push({ life: 0, max: 1 }); for (let i = 0; i < N; i++) put(i, 0, -999, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    try { harvest(scene); } catch (e) { console.warn('[fxsmall] harvest', e); } try { makeFlocks(); } catch (e) { console.warn('[fxsmall] flocks', e); } try { makePlumes(); } catch (e) { console.warn('[fxsmall] plumes', e); } if (!/[?&]hazards=0/.test(location.search)) { try { hazards(scene); } catch (e) { console.warn('[fxsmall] hazards', e); } }
    S.ready = true; return API; };
  /** per frame. player (optional): {x, y, z, speed} — what the birds watch */
  API.update = function (dt, camera, player) { if (!S.ready || !camera) return; dt = clamp(dt || 0, 0, .1); S.t += dt; const t = S.t;
    wind.x = .55 + Math.sin(t * .13) * .35 + Math.sin(t * .71) * .12; wind.z = .22 + Math.cos(t * .17) * .3;
    const env = GT.env || {}, night = env.night || 0, sc = env.sunColor, L = S.mesh.material.uniforms.uLight.value, day = 1 - night; { const m = sc ? Math.max(sc.r, sc.g, sc.b, 1e-3) : 1, k = .78; L.setRGB(lerp(.1, k * (.45 + .55 * (sc ? sc.r / m : 1)), day), lerp(.105, k * (.45 + .55 * (sc ? sc.g / m : .92)), day), lerp(.13, k * (.45 + .55 * (sc ? sc.b / m : .82)), day)); }   // GT.env.sunColor carries intensity: only its hue is used
    if (dt > 0) { plumes(dt, camera); air(dt, camera); birds(dt, camera, player); if (HZ.list.length) { try { hazardStep(dt, camera); } catch (e) { if (!HZ.bad) { HZ.bad = 1; console.warn('[fxsmall] hazardStep', e); } } } } else if (!S.posed) birds(0, camera, player); S.posed = true;
    let live = 0;
    for (let i = 0; i < NP; i++) { const p = S.P[i], slot = NB + ND + i; if (p.life <= 0) { if (!p.dead) { p.dead = true; S.aSR.array[slot * 4] = 0; S.aSR.array[slot * 4 + 1] = 0; S.aCol.array[slot * 4 + 3] = 0; } continue; } p.dead = false; live++;
      p.life -= dt; const u = 1 - Math.max(0, p.life) / p.max, k = Math.exp(-p.drag * dt); p.vy -= p.grav * dt; p.vx = p.vx * k + wind.x * p.wind * (1 - k); p.vz = p.vz * k + wind.z * p.wind * (1 - k); if (p.drag) p.vy *= (p.grav ? 1 : k * .5 + .5);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < p.floor) { p.y = p.floor; p.vy = 0; p.vx *= .5; p.vz *= .5; p.vr *= .3; p.flut = 0; if (p.lie) { p.mode = 1; p.vx *= .2; p.vz *= .2; p.vr = 0; } }
      p.rot += p.vr * dt; const sz = lerp(p.s0, p.s1, u), a = p.a * Math.min(1, u / p.fin) * (1 - sst(u, .55, 1)), fl = p.flut ? Math.abs(Math.cos(t * p.flut + i)) * .8 + .2 : 1;
      if (p.r2 !== undefined) { const cu = sst(u, .05, .6); put(slot, p.x, p.y, p.z, sz * fl, sz * p.asp, p.rot, p.mode, lerp(p.r, p.r2, cu), lerp(p.g, p.g2, cu), lerp(p.b, p.b2, cu), a, p.cell); } else
      put(slot, p.x, p.y, p.z, sz * fl, sz * p.asp, p.rot, p.mode, p.r, p.g, p.b, a, p.cell); }
    for (let i = 0; i < ND; i++) { const d = S.D[i], slot = NB + i; if (d.life <= 0) { if (!d.dead) { d.dead = true; S.aCol.array[slot * 4 + 3] = 0; S.aSR.array[slot * 4] = 0; } continue; } d.dead = false; d.life -= dt; const u = 1 - Math.max(0, d.life) / d.max, g = 1 + d.grow * u * 5;
      put(slot, d.x, d.y, d.z, d.w * g, d.h * g, d.rot, 1, d.r, d.g, d.b, d.a * (d.grow ? 1 - u : 1 - sst(u, .6, 1)), d.cell); }
    S.stats.live = live; S.aPos.needsUpdate = S.aSR.needsUpdate = S.aCol.needsUpdate = S.aUV.needsUpdate = true; };
  GT.fxsmall = API;
})();

/* LT 光影系统 (2026-11-17): two additions on the same init / update calls.
   contact shade  soft dark footprints under every moving or parked vehicle (rounded rectangle, turned with the car) and under every visible person and the player (round),
                  so wheels and feet sit on the ground in the shade too, where the sun shadow map has nothing to add. Two instanced meshes, 2 draw calls. GT.fxsmall.contact = { on, k, stats }.
   blood          js/people.js lays a flat dark disc under a body (and scales it up as it spreads). On its 'npc:death' event the disc gets this material instead: deep red going to brown-black,
                  a glossy wet top (it flags itself for the screen-space reflections like the puddles), an irregular outline with satellite drops; and the pool follows the body's torso
                  while it slides, so it ends under the body rather than where the blow landed. */
(function () { const F = window.GT && GT.fxsmall, T = window.THREE; if (!F || !T) return;
  const init0 = F.init, upd0 = F.update, CS = { on: true, k: 1, car: null, ppl: null, max: 96, scene: null, stats: { cars: 0, people: 0 } }, BL = { mat: null, list: [], hooked: false };
  const M4 = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), SC = new T.Vector3(), UPV = new T.Vector3(0, 1, 0);
  function blobTex(kind) { const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    if (kind === 'car') { for (let i = 0; i < 14; i++) { const k = i / 13, ix = 8 + k * 26, iy = 6 + k * 22; g.fillStyle = 'rgba(255,255,255,' + (.075 + .03 * k) + ')'; const r = 26 - k * 14; g.beginPath(); g.moveTo(ix + r, iy); g.arcTo(S - ix, iy, S - ix, S - iy, r); g.arcTo(S - ix, S - iy, ix, S - iy, r); g.arcTo(ix, S - iy, ix, iy, r); g.arcTo(ix, iy, S - ix, iy, r); g.closePath(); g.fill(); } }
    else { const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
    const t = new T.CanvasTexture(c); return t; }
  function shadeMesh(kind, op) { const g = new T.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); const m = new T.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTex(kind), transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true });
    m.name = 'lt_contact_' + kind; const im = new T.InstancedMesh(g, m, CS.max); im.count = 0; im.frustumCulled = false; im.renderOrder = 1; im.castShadow = false; im.receiveShadow = false; im.name = 'lt_contact_' + kind; im.userData.gtSmall = 1; return im; }
  function csInit(scene) { if (CS.car) return; CS.scene = scene; CS.car = shadeMesh('car', .62); CS.ppl = shadeMesh('ppl', .5); scene.add(CS.car, CS.ppl); }
  function put(im, i, x, y, z, h, w, l) { Q.setFromAxisAngle(UPV, h); M4.compose(V.set(x, y, z), Q, SC.set(w, 1, l)); im.setMatrixAt(i, M4); }
  function csStep(camera) { if (!CS.car) return; const G = GT.cngame && GT.cngame.G; if (!CS.on || !G || !camera) { CS.car.count = CS.ppl.count = 0; return; }
    const cx = camera.matrixWorld.elements[12], cz = camera.matrixWorld.elements[14], coast = !!(GT.coast && GT.coast.active), R2 = 75 * 75; let nc = 0, np = 0;
    for (const e of G.ents || []) { if (nc >= CS.max) break; if (!e || !e.alive || !e.veh || !e.veh.group || !e.veh.group.visible) continue; const dx = e.x - cx, dz = e.z - cz; if (dx * dx + dz * dz > R2) continue; if (coast && e.mode === 'parked' && !e.two) continue;   /* 月湾's parked cars have their own baked shade */
      const d = e.dims || {}, w = (d.w || (e.two ? .6 : 1.8)) + (e.two ? .35 : .55), l = (d.l || (e.two ? 1.9 : 4.4)) + .6, y = (e.y || 0) + .025; put(CS.car, nc++, e.x, y, e.z, e.h || 0, w * CS.k, l); }
    const pop = G.pop, P = GT.cngame.player;
    if (pop && pop.list) for (const n of pop.list) { if (np >= CS.max - 1) break; if (!n.active || !n.group || !n.group.visible || n.seated) continue; const dx = n.x - cx, dz = n.z - cz; if (dx * dx + dz * dz > 45 * 45) continue; const s = n.state === 'fall' ? 1.5 : .9; put(CS.ppl, np++, n.x, (n.y || 0) + .02, n.z, n.h || 0, s, n.state === 'fall' ? 1.9 : s); }
    if (P && P.mode === 'foot' && isFinite(P.x)) put(CS.ppl, np++, P.x, (P.y || 0) + .02, P.z, 0, .9, .9);
    CS.car.count = nc; CS.ppl.count = np; CS.car.instanceMatrix.needsUpdate = true; CS.ppl.instanceMatrix.needsUpdate = true; CS.stats.cars = nc; CS.stats.people = np; }
  /* ---- blood */
  function bloodTex() { const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), r = GT.rng ? GT.rng('lt-blood') : Math.random, im = g.createImageData(S, S), d = im.data, B = [];
    for (let i = 0; i < 7; i++) { const a = r() * 6.283, q = r() * .17; B.push([.5 + Math.cos(a) * q, .5 + Math.sin(a) * q, .1 + r() * .12, r() * 3.14, .07 + r() * .1]); }
    for (let i = 0; i < 10; i++) { const a = r() * 6.283, q = .3 + r() * .14; B.push([.5 + Math.cos(a) * q, .5 + Math.sin(a) * q, .012 + r() * .022, 0, .012 + r() * .02]); }
    const nz = GT.tex && GT.tex.fbm ? GT.tex.fbm(256, 8, 8, 4, 931) : null;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const u = (x + .5) / S, v = (y + .5) / S; let s = 0; for (const b of B) { const dx = u - b[0], dy = v - b[1], ca = Math.cos(b[3]), sa = Math.sin(b[3]), px = (dx * ca + dy * sa) / b[2], py = (-dx * sa + dy * ca) / b[4]; s += Math.exp(-(px * px + py * py) * 1.4); }
      const n = nz ? nz[y * S + x] - .5 : 0, f = 1 - Math.exp(-2.2 * s) + n * .35, e = Math.min(u, 1 - u, v, 1 - v), a = Math.max(0, Math.min(1, (f - .42) / .06)) * Math.min(1, e / .05), j = (y * S + x) * 4, rim = Math.max(0, Math.min(1, (f - .42) / .22));
      const k = .55 + .45 * rim; d[j] = (78 + 40 * n) * k; d[j + 1] = (6 + 4 * n) * k * (1.2 - rim * .4); d[j + 2] = (8 + 3 * n) * k; d[j + 3] = a * 255; }   /* thick dark red in the middle, the thin edge drying to brown-black */
    g.putImageData(im, 0, 0); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t; }
  function bloodMat() { if (BL.mat) return BL.mat; const m = new T.MeshStandardMaterial({ map: bloodTex(), color: 0xc8b8b8, roughness: .14, metalness: 0, transparent: true, opacity: .95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, envMapIntensity: .28 });   /* a thin film of sky in it, not a pink sheet: the gloss reads as the sun's highlight and the screen-space reflections */
    m.blending = T.CustomBlending; m.blendEquation = T.AddEquation; m.blendSrc = T.SrcAlphaFactor; m.blendDst = T.OneMinusSrcAlphaFactor; m.blendSrcAlpha = T.ZeroFactor; m.blendDstAlpha = T.OneMinusSrcAlphaFactor;   /* the alpha of the HDR target goes toward 0 under the pool: the wet-ground reflections of js/render.js see a glossy liquid */
    m.userData.gtReflect = 1; m.userData.gtNoProbe = 1; m.name = 'lt_blood'; m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n gl_FragColor.a *= 0.62;'); }; return BL.mat = m; }
  function torso(n) { if (n._ltTorso === undefined) { let hip = null, chest = null; if (n.group) n.group.traverse(o => { if (!o.isBone) return; const nm = (o.name || '').toLowerCase(); if (!hip && /hip|pelvis/.test(nm)) hip = o; if (!chest && /spine2|chest|spine1|upperchest/.test(nm)) chest = o; }); n._ltTorso = hip || chest ? [hip, chest] : null; } return n._ltTorso; }
  function bloodHook() { if (BL.hooked || !GT.cngame || !GT.cngame.on) return; BL.hooked = true;
    GT.cngame.on('npc:death', d => { const n = d && d.npc; if (!n || !n.blood) return; try { const old = n.blood.material, m = bloodMat().clone(); n.blood.material = m; if (old && old !== m && old.dispose) old.dispose(); n.blood.renderOrder = 2; n._ltBT = 0; BL.list.push(n); } catch (e) { console.warn('[fxsmall] blood', e); } }); }
  const TW = new T.Vector3(), TW2 = new T.Vector3();
  function bloodStep(dt) { for (let i = BL.list.length - 1; i >= 0; i--) { const n = BL.list[i], b = n.blood; if (!b || !b.parent) { BL.list.splice(i, 1); continue; } n._ltBT = (n._ltBT || 0) + dt; b.scale.setScalar(.05 + (n.bloodR || 1.3) * (1 - Math.exp(-n._ltBT * .16)));   /* spreads over ~15 s (people.js grew it in ~3 s); runs after people.js each frame, so this size is the one drawn */ const t = torso(n); if (!t) continue;
      let x = 0, z = 0, k = 0; for (const o of t) if (o) { o.getWorldPosition(TW); x += TW.x; z += TW.z; k++; } if (!k) continue; x /= k; z /= k; const kk = Math.min(1, dt * 3); b.position.x += (x - b.position.x) * kk; b.position.z += (z - b.position.z) * kk; } }
  F.init = function (scene) { const r = init0.apply(this, arguments); try { csInit(scene); bloodHook(); } catch (e) { console.warn('[fxsmall] LT init', e); } return r; };
  F.update = function (dt, camera, player) { const r = upd0.apply(this, arguments); try { csStep(camera); bloodHook(); bloodStep(dt || .016); } catch (e) { if (!CS.warned) { CS.warned = 1; console.warn('[fxsmall] LT update', e); } } return r; };
  F.contact = CS; F.blood = BL; F.bloodMat = bloodMat;
})();
