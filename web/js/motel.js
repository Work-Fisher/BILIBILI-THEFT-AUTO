/* motel.js — THE CORAL COMET: sun-faded two-storey 1960s roadside motel (second location, car-swap lot).
   Exports GT.motel = { build(scene) -> THREE.Group, update(dt), info } and GT.showcase.motel / motel_sign / motel_pool / motel_walkway / motel_lot.
   Everything is merged with GT.kit (one mesh per material) plus four special meshes:
     - lit atlas      : every painted sign / room number / curtain / machine front on ONE canvas (GT.signTex cells + custom paintings)
     - emissive solids: neon tubes, bulbs, lamp lenses (vertex-coloured, animated per element in update)
     - additive glows : neon lettering, lit curtains, light pools on walls/ground (same atlas, additive, vertex-coloured)
     - pool water     : small ray-marched shader (refraction to a virtual basin, caustics, scrolling ripples, underwater lamp at night) */
(function () {
  'use strict';
  const T = THREE, GT = window.GT, L = GT.L.motel, PI = Math.PI, TAU = PI * 2;
  const UP = new T.Vector3(0, 1, 0), ONE = new T.Vector3(1, 1, 1);
  const G = .14, FH = L.floorH, F2 = G + FH, RU = G + FH * 2, PITCH = 3.7, BAL = 1.9;   // walk level, upper deck level, roof underside, room module, balcony depth
  const lerp = GT.lerp, clamp = GT.clamp;
  const hsh = n => { const s = Math.sin(n * 127.1 + 3.7) * 43758.5453; return s - Math.floor(s); };
  let S = null;

  /* ================================================================== small geometry helpers */
  function metreUV(g, su, sv) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; }
  function remap(g, r) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1])); return g; }
  function rodGeo(a, b, r, r2, seg) {
    const va = new T.Vector3(a[0], a[1], a[2]), d = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length() || 1e-4;
    const g = metreUV(new T.CylinderGeometry(r2 === undefined ? r : r2, r, len, seg || 8, 1, false), TAU * r, len);
    g.applyMatrix4(new T.Matrix4().compose(va.addScaledVector(d, .5), new T.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), ONE)); return g;
  }
  const rod = (k, mat, a, b, r, r2, seg) => k.geo(mat, rodGeo(a, b, r, r2, seg));
  function aquad(k, mat, rect, w, h, x, y, z, o) { k.geo(mat, remap(new T.PlaneGeometry(w, h), rect), Object.assign({ x, y, z }, o || {})); }
  function wbox(k, x0, z0, x1, z1, h, tag) { const a = new T.Vector3(x0, 0, z0).applyMatrix4(k.top), b = new T.Vector3(x1, 0, z1).applyMatrix4(k.top); GT.world.addBox(a.x, a.z, b.x, b.z, h, tag); }
  /** box whose UVs are shifted by a position hash, so repeated thin parts (pickets, posts) do not all show the same rust patch at the same height */
  function ubox(k, mat, w, h, d, x, y, z, o) { o = o || {}; const g = GT.boxGeo(w, h, d, o.bevel), uv = g.attributes.uv, ou = hsh(x * 3.13 + z * 7.71 + y * 1.3) * 4, ov = hsh(x * 5.37 - z * 2.93 + y * 1.71) * 4;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + ou, uv.getY(i) + ov); return k.geo(mat, g, { x, y, z, rx: o.rx, ry: o.ry, rz: o.rz }); }
  const vadd = (a, d, s) => [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
  const vnorm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  /** loose triangle soup (leaves, blades): optional double-sided */
  class Tris {
    constructor() { this.P = []; this.N = []; this.U = []; }
    tri(a, b, c, ua, ub, uc, dbl, nrm) {   // nrm: optional shading normal used for BOTH sides (soft foliage volume instead of faceted cards)
      const n = nrm || vnorm(vcross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
      this.P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); this.N.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]); this.U.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
      if (dbl) { const s = nrm ? 1 : -1; this.P.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]); this.N.push(s * n[0], s * n[1], s * n[2], s * n[0], s * n[1], s * n[2], s * n[0], s * n[1], s * n[2]); this.U.push(ua[0], ua[1], uc[0], uc[1], ub[0], ub[1]); }
    }
    quad(a, b, c, d, w, l, dbl) { this.tri(a, b, c, [0, 0], [w, 0], [w, l], dbl); this.tri(a, c, d, [0, 0], [w, l], [0, l], dbl); }
    geo() { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(this.P), 3)); g.setAttribute('normal', new T.BufferAttribute(new Float32Array(this.N), 3)); g.setAttribute('uv', new T.BufferAttribute(new Float32Array(this.U), 2)); return g; }
  }

  /** vertex-coloured mesh made of "elements" whose brightness is driven per frame (day/night level + optional animation) */
  class VC {
    constructor() { this.gs = []; this.els = []; this.nv = 0; this.cur = null; this._m = new T.Matrix4(); this._q = new T.Quaternion(); this._e = new T.Euler(); }
    /** c = linear colour [r,g,b]; day/night = scalar levels; anim(t) -> multiplier; cd = optional different day colour */
    el(c, day, night, anim, cd) { this.cur = { v0: this.nv, v1: this.nv, c, cd: cd || c, day, night, anim: anim || null, r: -1, g: -1, b: -1 }; this.els.push(this.cur); return this; }
    add(g, W) { if (!g.index) { const n = g.attributes.position.count, ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new T.BufferAttribute(ix, 1)); }
      if (W) g.applyMatrix4(W); this.gs.push(g); this.nv += g.attributes.position.count; this.cur.v1 = this.nv; return this; }
    quad(W, rect, w, h, x, y, z, o) { o = o || {}; const g = remap(new T.PlaneGeometry(w, h), rect);
      g.applyMatrix4(this._m.compose(new T.Vector3(x, y, z), this._q.setFromEuler(this._e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ')), ONE)); return this.add(g, W); }
    rod(W, a, b, r, seg) { return this.add(rodGeo(a, b, r, r, seg || 6), W); }
    ball(W, r, x, y, z) { const g = new T.SphereGeometry(r, 8, 6); g.translate(x, y, z); return this.add(g, W); }
    build(mat) { if (!this.gs.length) return null; const g = GT.mergeGeos(this.gs); this.gs = null; this.col = new Float32Array(this.nv * 3); this.attr = new T.BufferAttribute(this.col, 3); g.setAttribute('color', this.attr);
      const m = new T.Mesh(g, mat); m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; return this.mesh = m; }
    apply(t, n) { if (!this.col) return; let dirty = false; const col = this.col;
      for (const e of this.els) { const m = e.anim ? e.anim(t, n) : 1, kd = e.day * (1 - n) * m, kn = e.night * n * m, r = e.cd[0] * kd + e.c[0] * kn, g = e.cd[1] * kd + e.c[1] * kn, b = e.cd[2] * kd + e.c[2] * kn;
        if (Math.abs(r - e.r) + Math.abs(g - e.g) + Math.abs(b - e.b) < 2e-3) continue; e.r = r; e.g = g; e.b = b; dirty = true;
        for (let i = e.v0 * 3, end = e.v1 * 3; i < end; i += 3) { col[i] = r; col[i + 1] = g; col[i + 2] = b; } }
      if (dirty) this.attr.needsUpdate = true; }
  }

  /* ================================================================== the atlas: every sign, number, curtain, machine front and glow sprite on one canvas */
  const FONT_SCRIPT = "'Brush Script MT','Snell Roundhand','Segoe Script',cursive", FONT_BLOCK = "'Futura','Avenir Next Condensed','Arial Narrow','Helvetica Neue',sans-serif", FONT_COND = "'Arial Narrow','Avenir Next Condensed','Helvetica Neue',sans-serif";
  function buildAtlas(nums) {
    const AW = 2048, AH = 4096, c = document.createElement('canvas'); c.width = AW; c.height = AH; const g = c.getContext('2d'), cells = {}, r = GT.rng('motelatlas');
    let sx = 8, sy = 8, rowH = 0;
    const alloc = (name, w, h) => { if (sx + w + 8 > AW) { sx = 8; sy += rowH + 16; rowH = 0; } const x = sx, y = sy; sx += w + 16; rowH = Math.max(rowH, h); cells[name] = [(x + .5) / AW, 1 - (y + h - .5) / AH, (x + w - .5) / AW, 1 - (y + .5) / AH]; return [x, y]; };
    const draw = (name, w, h, fn) => { const [x, y] = alloc(name, w, h); g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); fn(g, w, h); g.restore(); };
    const sign = (name, text, o) => { const t = GT.signTex(text, o), im = t.image, [x, y] = alloc(name, im.width, im.height); g.drawImage(im, x, y); };
    const fit = (text, weight, fam, maxW, px) => { g.font = `${weight} ${px}px ${fam}`; const w = g.measureText(text).width; if (w > maxW) px *= maxW / w; g.font = `${weight} ${px}px ${fam}`; return px; };
    const chips = (w, h, n, sz) => { g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < n; i++) { g.globalAlpha = .5 + r() * .5; g.beginPath(); g.ellipse(r() * w, r() * h, 1 + r() * sz, 1 + r() * sz * .6, r() * 3, 0, TAU); g.fill(); } g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; };
    const neonStroke = (text, x, y, lw) => { g.lineJoin = g.lineCap = 'round'; g.strokeStyle = '#fff'; g.shadowColor = '#fff'; g.globalAlpha = .3; g.shadowBlur = lw * 5; g.lineWidth = lw * 1.8; g.strokeText(text, x, y); g.globalAlpha = .55; g.shadowBlur = lw * 2; g.lineWidth = lw * 1.3; g.strokeText(text, x, y);
      g.globalAlpha = 1; g.shadowBlur = lw * .6; g.lineWidth = lw; g.strokeText(text, x, y); g.strokeText(text, x, y); g.shadowBlur = 0; };

    // ---- big pieces first (shelf packing)
    draw('office', 1024, 272, drawOffice); draw('marquee', 640, 256, drawMarquee);
    for (const [key, word] of [['Coral', 'Coral'], ['Comet', 'Comet']]) {
      const W_ = 640, H_ = 288;
      draw('sp_' + key, W_, H_, (g, w, h) => { g.textAlign = 'center'; g.textBaseline = 'middle'; fit(word, '400', FONT_SCRIPT, w * .88, h * .86); g.fillStyle = 'rgba(28,62,60,.9)'; g.fillText(word, w / 2 + 5, h * .52 + 6); g.fillStyle = '#efe5c9'; g.fillText(word, w / 2, h * .52); chips(w, h, 260, 3.2); });
      draw('sn_' + key, W_, H_, (g, w, h) => { g.textAlign = 'center'; g.textBaseline = 'middle'; fit(word, '400', FONT_SCRIPT, w * .88, h * .86); neonStroke(word, w / 2, h * .52, 5.5); });
    }
    'MOTEL'.split('').forEach((ch, i) => {
      draw('mp_' + i, 160, 176, (g, w, h) => { g.textAlign = 'center'; g.textBaseline = 'middle'; fit(ch, '700', FONT_BLOCK, w * .8, h * .92); g.fillStyle = i % 2 ? '#efe5c9' : '#2f6c68'; g.fillText(ch, w / 2, h * .55); chips(w, h, 60, 2.6); });
      draw('mn_' + i, 160, 176, (g, w, h) => { g.textAlign = 'center'; g.textBaseline = 'middle'; fit(ch, '700', FONT_BLOCK, w * .8, h * .92); neonStroke(ch, w / 2, h * .55, 4.5); });
    });
    draw('vendA', 256, 512, drawVendA); draw('vendB', 256, 512, drawVendB);
    for (let i = 0; i < 3; i++) draw('cur' + i, 256, 192, (g, w, h) => drawCurtain(g, w, h, i, r));
    draw('ice', 256, 96, drawIce);
    draw('g_round', 128, 128, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 62); for (const [s, a] of [[0, 1], [.15, .72], [.35, .36], [.6, .12], [.82, .03], [1, 0]]) gr.addColorStop(s, `rgba(255,255,255,${a})`); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    draw('g_wash', 128, 128, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.save(); g.translate(64, 22); g.scale(1, 1.75); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 58); for (const [s, a] of [[0, 1], [.1, .7], [.3, .32], [.6, .1], [1, 0]]) gr.addColorStop(s, `rgba(255,255,255,${a})`); g.fillStyle = gr; g.fillRect(-64, -14, 128, 80); g.restore(); });
    draw('g_strip', 128, 128, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); const gr = g.createLinearGradient(0, 4, 0, 124); for (const [s, a] of [[0, 0], [.06, 1], [.3, .4], [.65, .1], [1, 0]]) gr.addColorStop(s, `rgba(255,255,255,${a})`); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const ge = g.createLinearGradient(0, 0, w, 0); ge.addColorStop(0, '#000'); ge.addColorStop(.12, 'rgba(0,0,0,0)'); ge.addColorStop(.88, 'rgba(0,0,0,0)'); ge.addColorStop(1, '#000'); g.fillStyle = ge; g.fillRect(0, 0, w, h); });
    // ---- GT.signTex cells
    sign('vac', 'VACANCY', { style: 'neon', color: '#ff3a2c', w: 512, h: 128 }); sign('no', 'NO', { style: 'neon', color: '#ff3a2c', w: 176, h: 128 }); sign('officeN', 'OFFICE', { style: 'neon', color: '#3ad8ff', w: 512, h: 112 });
    sign('lifeguard', 'NO LIFEGUARD', { w: 512, h: 112, bg: '#ecebe2', color: '#b0231d', distress: .35 }); sign('onduty', 'ON DUTY', { w: 512, h: 112, bg: '#ecebe2', color: '#b0231d', distress: .35 });
    sign('ownrisk', 'SWIM AT YOUR OWN RISK', { w: 512, h: 80, bg: '#ecebe2', color: '#1d2a4a', distress: .4 }); sign('hours', 'POOL HOURS 9AM - 10PM', { w: 512, h: 80, bg: '#1f4a48', color: '#efe6cf', distress: .4 });
    sign('gate', 'KEEP GATE CLOSED', { w: 384, h: 72, bg: '#ecebe2', color: '#1d2a4a', distress: .45 }); sign('nodive', 'NO DIVING', { w: 256, h: 64, bg: '#f1efe6', color: '#b0231d', distress: .3 });
    for (const d of ['3 FT', '5 FT', '8 FT']) sign('d' + d[0], d, { w: 128, h: 64, bg: '#f1efe6', color: '#1b4f9c', distress: .3 });
    sign('laundry', 'LAUNDRY', { w: 320, h: 72, bg: '#1f4a48', color: '#efe6cf', distress: .45 }); sign('maids', 'HOUSEKEEPING', { w: 320, h: 72, bg: '#1f4a48', color: '#efe6cf', distress: .45 });
    sign('guests', 'GUEST PARKING ONLY', { w: 384, h: 96, bg: '#ecebe2', color: '#b0231d', distress: .5 }); sign('tow', 'UNAUTHORIZED CARS TOWED', { w: 384, h: 72, bg: '#ecebe2', color: '#1d1d1d', distress: .5 });
    sign('phone', 'PHONE', { w: 256, h: 80, bg: '#1b4f9c', color: '#f4f2ea', distress: .3 }); sign('bell', 'RING BELL', { w: 192, h: 64, bg: '#efe6cf', color: '#1d1d1d', distress: .15 });
    sign('news', 'DAILY TIDE 25c', { w: 256, h: 64, bg: '#e9e2cc', color: '#1d2a4a', distress: .4 }); sign('haul', 'SUNCOAST HAULING', { style: 'stencil', w: 384, h: 80, bg: '#23539a', color: '#d9dde6', distress: .5 });
    sign('icesn', 'ICE  SNACKS', { w: 320, h: 80, bg: '#efe6cf', color: '#1b4f9c', distress: .35 }); sign('private', 'PRIVATE', { w: 192, h: 48, bg: '#1d1d1d', color: '#d9c48a', distress: .2 });
    for (const n of nums) sign('n' + n, String(n), { w: 128, h: 64, bg: '#ded6bd', color: '#2c5754', distress: .25 });
    const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding; tex.anisotropy = 8;
    return { tex, cells };

    // ------------------------------------------------------------------ paintings
    function drawMarquee(g, w, h) {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#f1ecda'); gr.addColorStop(1, '#ddd4b8'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(${r() < .5 ? 0 : 255},${r() < .5 ? 0 : 240},200,${r() * .035})`; g.fillRect(x, 0, 2, h); }   // faint fluorescent banding
      const dark = g.createLinearGradient(w * .6, 0, w, 0); dark.addColorStop(0, 'rgba(40,30,10,0)'); dark.addColorStop(.5, 'rgba(40,30,10,.22)'); dark.addColorStop(1, 'rgba(40,30,10,.3)'); g.fillStyle = dark; g.fillRect(0, 0, w, h);   // a dead tube on the right
      const lines = ['COL R  TV', 'HEATED P OL', 'AIR C NDITI NED'], cols = ['#9c2019', '#151515', '#151515'], rh = 72, y0 = 22;
      lines.forEach((ln, li) => { const yb = y0 + li * rh; g.fillStyle = 'rgba(70,66,52,.55)'; g.fillRect(14, yb - 3, w - 28, 3); g.fillRect(14, yb + 62, w - 28, 3); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(14, yb, w - 28, 1.5);
        const pitch = Math.min(46, (w - 70) / ln.length), x0 = (w - pitch * ln.length) / 2 + pitch / 2; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.font = `700 64px ${FONT_COND}`;
        ln.split('').forEach((ch, i) => { if (ch === ' ') return; g.save(); g.translate(x0 + i * pitch + (r() - .5) * 2, yb + 58 + (r() - .5) * 2); let rot = (r() - .5) * .05; if (li === 1 && i === 4) rot = .16; if (li === 2 && i === 12) { rot = -.5; g.translate(3, 9); }
          g.rotate(rot); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillText(ch, 2, 2); g.fillStyle = cols[li]; g.fillText(ch, 0, 0); g.restore(); }); });
      g.fillStyle = '#151515'; g.save(); g.translate(w * .345, h - 9); g.rotate(1.45); g.font = `700 64px ${FONT_COND}`; g.fillText('O', 0, 0); g.restore();   // a fallen letter resting in the bottom rail
      g.strokeStyle = 'rgba(60,55,40,.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
      for (let i = 0; i < 26; i++) { const x = r() * w, len = 30 + r() * 120, gr2 = g.createLinearGradient(0, 0, 0, len); gr2.addColorStop(0, `rgba(84,62,34,${.1 + r() * .16})`); gr2.addColorStop(1, 'rgba(84,62,34,0)'); g.fillStyle = gr2; g.fillRect(x, 0, 2 + r() * 7, len); }
      const bt = g.createLinearGradient(0, h - 40, 0, h); bt.addColorStop(0, 'rgba(70,55,30,0)'); bt.addColorStop(1, 'rgba(70,55,30,.3)'); g.fillStyle = bt; g.fillRect(0, h - 40, w, 40);
    }
    function drawVendA(g, w, h) {
      g.fillStyle = '#0c0c0e'; g.fillRect(0, 0, w, h);
      const gr = g.createLinearGradient(0, 14, 0, 370); gr.addColorStop(0, '#f0b243'); gr.addColorStop(.55, '#e2732e'); gr.addColorStop(1, '#c23a26'); g.fillStyle = gr; g.fillRect(12, 14, 172, 356);
      g.save(); g.beginPath(); g.rect(12, 14, 172, 356); g.clip(); g.translate(98, 300); for (let i = 0; i < 14; i++) { g.rotate(TAU / 14); g.fillStyle = 'rgba(255,238,190,.16)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(-22, -420); g.lineTo(22, -420); g.fill(); }
      g.fillStyle = '#fff3d6'; g.beginPath(); g.arc(0, 0, 62, 0, TAU); g.fill(); g.fillStyle = '#e8862e'; g.beginPath(); g.arc(0, 0, 52, 0, TAU); g.fill(); g.strokeStyle = 'rgba(255,243,214,.8)'; g.lineWidth = 2; for (let i = 0; i < 10; i++) { g.rotate(TAU / 10); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 50); g.stroke(); } g.restore();
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(98, 110); g.rotate(-.12); g.font = `400 86px ${FONT_SCRIPT}`; g.fillStyle = 'rgba(120,30,10,.6)'; g.fillText('Zesta', 4, 5); g.fillStyle = '#fffaf0'; g.fillText('Zesta', 0, 0); g.restore();
      g.font = `700 21px ${FONT_BLOCK}`; g.fillStyle = '#fffaf0'; g.fillText('ORANGE  SODA', 98, 176); g.fillStyle = '#1c4a9a'; g.fillRect(34, 338, 128, 24); g.fillStyle = '#fff'; g.font = `700 17px ${FONT_BLOCK}`; g.fillText('ICE COLD', 98, 351);
      for (let i = 0; i < 6; i++) { g.fillStyle = '#efe4c6'; g.fillRect(196, 22 + i * 50, 48, 38); g.fillStyle = ['#e2732e', '#c23a26', '#3a8f5a', '#7a3fa0', '#e2b52e', '#2a6fb0'][i]; g.fillRect(200, 26 + i * 50, 40, 14); g.fillStyle = '#333'; g.fillRect(204, 46 + i * 50, 32, 3); g.fillRect(204, 52 + i * 50, 20, 3); }
      g.fillStyle = '#8b8d90'; g.fillRect(196, 326, 48, 62); g.fillStyle = '#111'; g.fillRect(214, 336, 12, 4); g.fillRect(204, 356, 32, 22); g.fillStyle = '#d8d3bf'; g.fillRect(200, 392, 40, 16); g.fillStyle = '#b0231d'; g.font = `700 13px ${FONT_BLOCK}`; g.fillText('.35', 220, 401);
      g.fillStyle = '#050506'; g.fillRect(20, 398, 164, 92); g.strokeStyle = '#3a3a3c'; g.lineWidth = 3; g.strokeRect(20, 398, 164, 92); g.fillStyle = '#2a2a2c'; g.fillRect(30, 408, 144, 30);
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${r() * .25})`; g.fillRect(r() * w, r() * h, 1 + r() * 30, 1 + r() * 2); }
    }
    function drawVendB(g, w, h) {
      g.fillStyle = '#101113'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b1d20'; g.fillRect(12, 14, 176, 376);
      const pal = ['#c8a24a', '#a8423a', '#4a7a9a', '#5a8a56', '#b8683a', '#8a5a8a', '#d0c8b0', '#3a5a8a'];
      for (let row = 0; row < 6; row++) { const y = 26 + row * 60; for (let i = 0; i < 5; i++) { if (r() < .14) continue; const x = 20 + i * 33, col = pal[(r() * pal.length) | 0]; g.fillStyle = col; g.fillRect(x, y + (r() * 4 | 0), 27, 42); g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(x + 3, y + 12, 21, 9); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + 34, 27, 8);
          g.strokeStyle = 'rgba(190,190,190,.5)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x + 13, y + 46, 12, 4, 0, 0, PI); g.stroke(); }
        g.fillStyle = '#6a6c70'; g.fillRect(12, y + 48, 176, 4); g.fillStyle = '#e6e0c8'; for (let i = 0; i < 5; i++) g.fillRect(24 + i * 33, y + 49, 14, 3); }
      const gl = g.createLinearGradient(12, 14, 188, 200); gl.addColorStop(0, 'rgba(255,255,255,.2)'); gl.addColorStop(.3, 'rgba(255,255,255,.03)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gl; g.fillRect(12, 14, 176, 376);
      g.fillStyle = '#2a2c30'; g.fillRect(196, 14, 50, 376); g.fillStyle = '#0a1a10'; g.fillRect(202, 30, 38, 20); g.fillStyle = '#5cff9a'; g.font = '700 13px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('A4 .40', 221, 41);
      for (let i = 0; i < 12; i++) { g.fillStyle = '#9a9ca0'; g.fillRect(203 + (i % 3) * 13, 66 + ((i / 3) | 0) * 15, 10, 11); } g.fillStyle = '#0a0a0a'; g.fillRect(214, 150, 14, 4); g.fillRect(204, 180, 34, 8); g.fillStyle = '#d8d3bf'; g.fillRect(200, 210, 42, 30);
      g.fillStyle = '#050506'; g.fillRect(20, 404, 168, 86); g.strokeStyle = '#3a3a3c'; g.lineWidth = 3; g.strokeRect(20, 404, 168, 86); g.fillStyle = '#c8c2aa'; g.font = `700 16px ${FONT_BLOCK}`; g.fillText('PUSH', 104, 446);
    }
    function drawIce(g, w, h) {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#e6f4fb'); gr.addColorStop(1, '#a4d2ee'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `italic 900 78px ${FONT_BLOCK}`; g.lineJoin = 'round'; g.strokeStyle = '#fff'; g.lineWidth = 9; g.strokeText('ICE', w / 2, h * .56); g.fillStyle = '#1c56a8'; g.fillText('ICE', w / 2, h * .56);
      g.fillStyle = '#fff'; for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(62 + i * 17, 20 + Math.sin(i * 1.7) * 3, 12, 6, 0, 0, TAU); g.fill(); } for (let i = 0; i < 6; i++) { const x = 70 + i * 24; g.beginPath(); g.moveTo(x - 4, 22); g.lineTo(x + 4, 22); g.lineTo(x, 34 + r() * 12); g.fill(); }
      g.strokeStyle = 'rgba(60,90,120,.5)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
    }
    function drawCurtain(g, w, h, kind, r) {
      const pleats = (x0, x1, dens, tone) => { for (let x = x0; x < x1; x++) { const u = (x - x0) * dens, v = .74 + .2 * Math.sin(u * .34 + Math.sin(u * .061) * 2.4) + .06 * Math.sin(u * 1.3); g.fillStyle = `rgb(${v * tone[0] | 0},${v * tone[1] | 0},${v * tone[2] | 0})`; g.fillRect(x, 0, 1, h); } };
      if (kind === 0) { pleats(0, w, 1, [232, 222, 198]); g.fillStyle = 'rgba(40,30,20,.5)'; g.fillRect(w / 2 - 1, 0, 2, h); }
      else if (kind === 1) { g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, w, h); const lg = g.createRadialGradient(150, 96, 2, 150, 96, 60); lg.addColorStop(0, 'rgba(120,95,60,.55)'); lg.addColorStop(1, 'rgba(120,95,60,0)'); g.fillStyle = lg; g.fillRect(80, 30, 140, 140);
        g.fillStyle = '#3a3026'; g.beginPath(); g.moveTo(138, 78); g.lineTo(162, 78); g.lineTo(170, 104); g.lineTo(130, 104); g.fill(); g.fillStyle = '#1c1814'; g.fillRect(147, 104, 6, 34); g.fillRect(96, 138, 110, 54);
        pleats(0, 92, 2.3, [226, 210, 180]); pleats(182, w, 2.3, [226, 210, 180]); for (const x of [92, 182]) { const sh = g.createLinearGradient(x - 10, 0, x + 10, 0); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(.5, 'rgba(0,0,0,.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sh; g.fillRect(x - 10, 0, 20, h); } }
      else { g.fillStyle = '#17181a'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 9) { const bend = r() < .08 ? (r() - .5) * 8 : 0, sl = g.createLinearGradient(0, y, 0, y + 7); sl.addColorStop(0, '#e9e4d2'); sl.addColorStop(1, '#a9a48f'); g.fillStyle = sl; g.beginPath(); g.moveTo(0, y); g.lineTo(w * .6, y + bend); g.lineTo(w, y); g.lineTo(w, y + 7); g.lineTo(w * .6, y + 7 + bend); g.lineTo(0, y + 7); g.fill(); }
        g.fillStyle = 'rgba(60,55,45,.7)'; g.fillRect(48, 0, 2, h); g.fillRect(206, 0, 2, h); }
      const top = g.createLinearGradient(0, 0, 0, h); top.addColorStop(0, 'rgba(0,0,0,.5)'); top.addColorStop(.14, 'rgba(0,0,0,.08)'); top.addColorStop(.9, 'rgba(0,0,0,0)'); top.addColorStop(1, 'rgba(0,0,0,.25)'); g.fillStyle = top; g.fillRect(0, 0, w, h);
    }
    function drawOffice(g, w, h) {
      g.fillStyle = '#84573a'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 42) { const v = .82 + r() * .3; g.fillStyle = `rgb(${132 * v | 0},${87 * v | 0},${58 * v | 0})`; g.fillRect(x, 0, 42, h); g.fillStyle = 'rgba(30,16,8,.7)'; g.fillRect(x, 0, 2, h); for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(40,22,10,${.08 + r() * .14})`; g.fillRect(x + 3 + r() * 36, r() * h, 1, 40 + r() * 160); } }
      g.fillStyle = '#3a2416'; g.fillRect(0, h - 22, w, 22); g.fillStyle = '#4a2e1c'; g.fillRect(0, 0, w, 10);
      g.fillStyle = '#5a3a22'; g.fillRect(52, 36, 126, h - 36); g.fillStyle = '#1a120c'; g.fillRect(62, 46, 106, h - 46); g.fillStyle = '#2a1c12'; g.fillRect(62, 46, 60, h - 46);   // back-room door, ajar
      g.fillStyle = '#d9c9a0'; g.fillRect(228, 48, 176, 108); const sea = g.createLinearGradient(0, 56, 0, 148); sea.addColorStop(0, '#9fc6d6'); sea.addColorStop(.55, '#d8e2d2'); sea.addColorStop(.56, '#2f6f86'); sea.addColorStop(1, '#1d4a62'); g.fillStyle = sea; g.fillRect(236, 56, 160, 92);
      g.fillStyle = '#20384a'; g.beginPath(); g.ellipse(318, 100, 44, 11, -.25, 0, TAU); g.fill(); g.beginPath(); g.moveTo(352, 88); g.lineTo(392, 70); g.lineTo(356, 94); g.fill(); g.beginPath(); g.moveTo(300, 92); g.lineTo(322, 64); g.lineTo(336, 92); g.fill(); g.beginPath(); g.moveTo(278, 108); g.lineTo(256, 94); g.lineTo(260, 122); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(470, 66, 32, 0, TAU); g.fill(); g.fillStyle = '#efe9d6'; g.beginPath(); g.arc(470, 66, 27, 0, TAU); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 3; g.beginPath(); g.moveTo(470, 66); g.lineTo(470, 46); g.moveTo(470, 66); g.lineTo(486, 74); g.stroke();
      g.fillStyle = '#16181a'; g.fillRect(604, 44, 164, 150); g.strokeStyle = '#b89a5a'; g.lineWidth = 5; g.strokeRect(604, 44, 164, 150); g.fillStyle = '#e8e2cc'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 18px ${FONT_BLOCK}`; g.fillText('RATES', 686, 62);
      for (let i = 0; i < 7; i++) { g.fillRect(618, 80 + i * 15, 60 + r() * 40, 5); g.fillRect(730, 80 + i * 15, 24, 5); }
      g.fillStyle = '#f1efe6'; g.fillRect(806, 60, 62, 86); g.fillStyle = '#b0231d'; g.fillRect(806, 60, 62, 20); g.fillStyle = '#999'; for (let i = 0; i < 20; i++) g.fillRect(812 + (i % 5) * 11, 88 + ((i / 5) | 0) * 13, 7, 7);
      g.fillStyle = '#2a2420'; g.fillRect(890, 36, 108, 80); const tv = g.createRadialGradient(940, 74, 4, 940, 74, 52); tv.addColorStop(0, '#b9d8f0'); tv.addColorStop(1, '#3a5a80'); g.fillStyle = tv; g.fillRect(898, 44, 78, 62); g.fillStyle = '#4a3a2a'; g.fillRect(880, 116, 128, 8);
      for (const [x, y, rad] of [[520, 30, 230], [130, 10, 150], [900, 20, 190]]) { const lg = g.createRadialGradient(x, y, 4, x, y, rad); lg.addColorStop(0, 'rgba(255,214,150,.42)'); lg.addColorStop(1, 'rgba(255,214,150,0)'); g.fillStyle = lg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
      const vg = g.createLinearGradient(0, 0, 0, h); vg.addColorStop(0, 'rgba(0,0,0,.05)'); vg.addColorStop(1, 'rgba(0,0,0,.38)'); g.fillStyle = vg; g.fillRect(0, 0, w, h);
    }
  }

  /* ================================================================== vegetation */
  function frond(tr, o, az, el, len, r) {
    const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el), d0 = [ca * ce, se, sa * ce], droop = .5 + r() * .3, side = [-sa, 0, ca], NS = 8, NL = 18;
    const pos = s => [o[0] + d0[0] * len * s, o[1] + .12 + d0[1] * len * s - droop * len * s * s * .55, o[2] + d0[2] * len * s];
    for (let i = 0; i < NS; i++) { const a = pos(i / NS), b = pos((i + 1) / NS), w0 = .03 * (1 - i / NS) + .008, w1 = .03 * (1 - (i + 1) / NS) + .008; tr.quad(vadd(a, side, -w0), vadd(a, side, w0), vadd(b, side, w1), vadd(b, side, -w1), .06, len / NS, true); }
    for (let i = 0; i < NL; i++) { const s = .1 + .9 * (i + .5) / NL, p = pos(s), tg = vnorm([pos(s + .02)[0] - p[0], pos(s + .02)[1] - p[1], pos(s + .02)[2] - p[2]]), ll = len * .27 * Math.sin(PI * Math.pow(s, .7) * .9 + .14) + .08;
      for (const sd of [-1, 1]) { const dir = vnorm([side[0] * sd + tg[0] * .5, -.3 - r() * .3 + tg[1] * .5, side[2] * sd + tg[2] * .5]); tr.tri(vadd(p, tg, -.045), vadd(p, tg, .045), vadd(p, dir, ll), [0, 0], [.09, 0], [.045, ll], true); } }
  }
  function palm(C, x, y, z, h, seed) {
    const k = C.k, r = GT.rng('palm' + seed), lean = (r() - .5) * 1.4, la = r() * TAU, tr = new Tris(), dead = new Tris(), n = 7; let prev = [x, y, z];
    for (let i = 1; i <= n; i++) { const s = i / n, c = [x + Math.cos(la) * lean * s * s, y + h * s, z + Math.sin(la) * lean * s * s]; rod(k, 'palm_trunk', prev, c, lerp(.2, .125, (i - 1) / n) + (i === 1 ? .06 : 0), lerp(.2, .125, s), 10); prev = c; }
    k.sphere('palm_trunk', .2, prev[0], prev[1] + .1, prev[2], { s: [1, 1.7, 1], seg: 10, seg2: 6 });
    const nf = 18; for (let f = 0; f < nf; f++) { const u = f / (nf - 1), el = lerp(1.25, -.8, Math.pow(u, .8)) + (r() - .5) * .2; frond(u > .86 ? dead : tr, [prev[0], prev[1] + .15, prev[2]], f * 2.39996 + r() * .5, el, lerp(2.3, 3.2, r()) * (h > 6.5 ? 1 : .86), r); }
    k.geo('palm_leaf', tr.geo()); if (dead.P.length) k.geo('grass_dry', dead.geo());
    GT.world.addPost(x, z, .25, h, 'motel-palm');
  }
  function shrub(C, x, y, z, R, seed, mat) {
    const k = C.k, r = GT.rng('shrub' + seed), nb = 3 + (r() * 3 | 0), tr = new Tris(); mat = mat || 'foliage';
    for (let b = 0; b < nb; b++) { const a = r() * TAU, d = b ? R * (.35 + r() * .45) : 0, br = R * (.5 + r() * .3), bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d, by = y + br * .6;
      const g = new T.IcosahedronGeometry(br * .86, 1), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), j = 1 + (hsh(vx * 13.1 + vy * 7.7 + vz * 3.3 + b) - .5) * .4; p.setXYZ(i, vx * j, vy * j * .8, vz * j); }
      metreUV(g, br * 5, br * 3); k.geo(mat, g, { x: bx, y: by, z: bz });
      for (let i = 0; i < 110; i++) { const th = r() * TAU, ph = Math.acos(1 - r() * 1.3), n = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)], rr = .86 + r() * .2, c = [bx + n[0] * br * rr, by + n[1] * br * .8 * rr, bz + n[2] * br * rr], sz = .04 + r() * r() * .11, t1 = vnorm(vcross(n, [.3, 1, .2])), t2 = vcross(n, t1), q = r() * TAU, ta = [t1[0] * Math.cos(q) + t2[0] * Math.sin(q), t1[1] * Math.cos(q) + t2[1] * Math.sin(q), t1[2] * Math.cos(q) + t2[2] * Math.sin(q)];
        tr.tri(vadd(c, ta, -sz * .45), vadd(c, ta, sz * .45), vadd(vadd(c, n, sz * 1.1), vcross(n, ta), sz * .7), [0, 0], [sz, 0], [sz / 2, sz * 1.4], true, vnorm([n[0], n[1] + .35, n[2]])); } }
    k.geo(mat, tr.geo());
  }
  function spiky(C, x, y, z, R, seed, mat) { const r = GT.rng('spk' + seed), tr = new Tris(), n = 18;
    for (let i = 0; i < n; i++) { const az = i * 2.39996, el = lerp(1.35, .25, i / n) + (r() - .5) * .15, len = R * (.7 + r() * .5), d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], sd = [-Math.sin(az), 0, Math.cos(az)], o = [x, y + .04, z], mid = vadd(vadd(o, d, len * .55), [0, 1, 0], -len * .03), tip = vadd(vadd(o, d, len), [0, 1, 0], -len * .16), w = .05 + R * .05;
      tr.quad(vadd(o, sd, -w * .6), vadd(o, sd, w * .6), vadd(mid, sd, w), vadd(mid, sd, -w), w * 2, len * .55, true); tr.tri(vadd(mid, sd, -w), vadd(mid, sd, w), tip, [0, len * .55], [w * 2, len * .55], [w, len], true); }
    C.k.geo(mat || 'palm_leaf', tr.geo()); }
  function weeds(C, x, y, z, seed, mat) { const r = GT.rng('weed' + seed), tr = new Tris(), n = 9 + (r() * 9 | 0);
    for (let i = 0; i < n; i++) { const az = r() * TAU, h = .04 + r() * r() * .16, ox = x + (r() - .5) * .22, oz = z + (r() - .5) * .22, sd = [Math.cos(az) * .006, 0, Math.sin(az) * .006], lean = [(r() - .5) * .1, h, (r() - .5) * .1]; tr.tri([ox - sd[0], y, oz - sd[2]], [ox + sd[0], y, oz + sd[2]], [ox + lean[0], y + lean[1], oz + lean[2]], [0, 0], [.03, 0], [.015, h], true); }
    C.k.geo(mat || (r() < .3 ? 'grass_dry' : 'palm_leaf'), tr.geo()); }
  function planter(C, x0, z0, x1, z1, h, tag, y0) { y0 = y0 || 0; const k = C.k, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, t = .15;
    k.box('concrete_stained', w, h, t, cx, y0 + h / 2, z0 + t / 2, { bevel: .02 }); k.box('concrete_stained', w, h, t, cx, y0 + h / 2, z1 - t / 2, { bevel: .02 }); k.box('concrete_stained', t, h, d - t * 2, x0 + t / 2, y0 + h / 2, cz, { bevel: .02 }); k.box('concrete_stained', t, h, d - t * 2, x1 - t / 2, y0 + h / 2, cz, { bevel: .02 });
    k.box('dirt', w - t * 2, .04, d - t * 2, cx, y0 + h - .06, cz); GT.world.addBox(x0, z0, x1, z1, Math.max(h, .5), tag || 'motel-planter'); }

  /* ================================================================== room module (one template per mirror variant, stamped ~56 times) */
  function roomTemplate(M, mir) {
    const k = GT.kit(), X = v => mir ? PITCH - v : v, sg = mir ? -1 : 1, dx = X(.78), wx = X(2.5), sx = X(1.56), W = 'metal_painted_white', AL = 'aluminium_brushed';
    // door: frame, slab with two raised panels, kick plate, threshold, lever + deadbolt, peephole, hinges
    k.box(W, .07, 2.12, .1, dx - .49, 1.06, .04, { bevel: .006 }); k.box(W, .07, 2.12, .1, dx + .49, 1.06, .04, { bevel: .006 }); k.box(W, 1.05, .08, .1, dx, 2.1, .04, { bevel: .006 });
    k.box(M.teal, .91, 2.05, .045, dx, 1.035, .032, { bevel: .004 }); k.box(M.teal, .62, .74, .012, dx, 1.5, .058, { bevel: .005 }); k.box(M.teal, .62, .66, .012, dx, .66, .058, { bevel: .005 });
    k.box(AL, .86, .2, .004, dx, .13, .057); k.box(AL, .97, .022, .14, dx, .011, .06, { bevel: .004 });
    const hx = dx + sg * .37;
    k.box('chrome', .055, .2, .008, hx, 1.06, .058, { bevel: .003 }); k.cyl('chrome', .011, .011, .05, hx, 1.0, .08, { rx: PI / 2, seg: 8 }); k.box('chrome', .12, .02, .016, hx - sg * .048, 1.0, .104, { bevel: .005 });
    k.cyl('chrome', .024, .024, .014, hx, 1.12, .064, { rx: PI / 2, seg: 12 }); k.box('metal_dark', .004, .014, .003, hx, 1.12, .0715);
    k.cyl('chrome', .012, .012, .012, dx, 1.52, .062, { rx: PI / 2, seg: 10 }); k.cyl('glass_tint', .007, .007, .004, dx, 1.52, .069, { rx: PI / 2, seg: 8 });
    for (const y of [.25, 1.03, 1.82]) k.box('metal_galv', .022, .1, .012, dx - sg * .455, y, .058);
    // window: aluminium slider, half insect screen, sill
    const wy = 1.65, ww = 1.7, wh = 1.2;
    k.box(AL, ww + .1, .05, .07, wx, wy + wh / 2, .035, { bevel: .005 }); k.box(AL, ww + .1, .05, .07, wx, wy - wh / 2, .035, { bevel: .005 }); k.box(AL, .05, wh, .07, wx - ww / 2, wy, .035); k.box(AL, .05, wh, .07, wx + ww / 2, wy, .035);
    k.box(AL, .045, wh, .05, wx, wy, .04); k.box(AL, .025, wh - .06, .03, wx + sg * .8, wy, .05); k.box(AL, .8, .025, .03, wx + sg * .41, wy + wh / 2 - .04, .05); k.box(AL, .8, .025, .03, wx + sg * .41, wy - wh / 2 + .04, .05);
    k.box('glass_clear', ww - .04, wh - .04, .006, wx, wy, .036); k.box('glass_tint', .8, wh - .1, .003, wx + sg * .41, wy, .056);
    k.box('stucco_white', ww + .22, .06, .13, wx, wy - wh / 2 - .055, .055, { bevel: .012 });
    // through-wall AC: galvanised sleeve, dark recess, louvres, control lid, condensate stub, rust run
    const ay = .64;
    k.box('metal_galv', .72, .46, .17, wx, ay, .085, { bevel: .008 }); k.box('metal_dark', .64, .34, .01, wx, ay + .03, .172);
    for (let i = 0; i < 8; i++) k.box(W, .64, .014, .024, wx, ay - .12 + i * .044, .18, { rx: .55 });
    k.box(W, .68, .05, .022, wx, ay - .185, .178, { bevel: .004 }); k.box(W, .68, .03, .022, wx, ay + .205, .178); k.box(W, .03, .42, .022, wx - .335, ay, .178); k.box(W, .03, .42, .022, wx + .335, ay, .178);
    k.box('plastic_black', .14, .035, .01, wx + sg * .22, ay - .185, .192, { bevel: .003 }); k.cyl('metal_galv', .008, .008, .07, wx - sg * .27, ay - .25, .14, { seg: 6 });
    k.quad(GT.decalMat('rust_run'), .46, .5, wx - sg * .12, .2, .011); k.quad(GT.decalMat('water_stain'), .9, .42, wx, .2, .009);
    // sconce body + conduit drop + junction box
    k.box('metal_dark', .1, .15, .026, sx, 1.99, .013, { bevel: .005 }); k.box('metal_dark', .03, .03, .06, sx, 2.04, .05); k.cyl('metal_dark', .052, .046, .035, sx, 2.045, .082, { seg: 10 }); k.cyl('metal_dark', .03, .03, .012, sx, 1.915, .082, { seg: 8 });
    k.cyl('metal_galv', .009, .009, .68, sx, 2.41, .012, { seg: 6 }); k.box('metal_galv', .1, .1, .045, sx, 2.78, .022, { bevel: .006 });
    const parts = new Map(); for (const [m, gs] of k.parts) parts.set(m, GT.mergeGeos(gs)); return parts;
  }
  function stamp(k, parts, x, y, z) { k.push(x, y, z); for (const [m, g] of parts) k.geo(m, g.clone()); k.pop(); }
  /** the per-room unique bits: number plate, curtain (+ night glow), sconce lamp (+ light pools), random wear */
  function roomExtras(C, x, y, mir, num) {
    const { k, vc, ad, A } = C, r = GT.rng('room' + num), X = v => x + (mir ? PITCH - v : v), sg = mir ? -1 : 1, W = k.top;
    aquad(k, C.lit, A['n' + num], .17, .085, X(.78), y + 1.69, .0665);
    const kind = (r() * 3) | 0, st = r(), cw = 1.66, chh = 1.16;
    aquad(k, C.lit, A['cur' + kind], cw, chh, X(2.5), y + 1.65, .016);
    if (st < .34) ad.el([1, .62, .3], 0, 1.5 + r() * .8).quad(W, A['cur' + kind], cw, chh, X(2.5), y + 1.65, .021);
    else if (st < .42) { const sd = r() * 100; ad.el([.42, .62, 1], 0, 1.5, t => .35 + .65 * hsh(Math.floor(t * 7 + sd)) * (.6 + .4 * hsh(Math.floor(t * 1.3 + sd)))).quad(W, A['cur' + kind], cw, chh, X(2.5), y + 1.65, .021); }
    const dead = r() < .1, buzz = !dead && r() < .06, sd2 = r() * 50, lamp = new T.CylinderGeometry(.04, .034, .1, 8); lamp.translate(X(1.56), y + 1.975, .082);
    vc.el([1, .7, .36], .9, 9, dead ? () => .03 : buzz ? t => hsh(Math.floor(t * 18 + sd2)) < .3 ? .15 : 1 : null, [.9, .86, .74]).add(lamp, W);
    if (!dead) { ad.el([1, .6, .28], 0, .5, buzz ? t => hsh(Math.floor(t * 18 + sd2)) < .3 ? .15 : 1 : null).quad(W, A.g_wash, 2.0, 2.5, X(1.56), y + 1.17, .012).quad(W, A.g_round, 2.6, 1.85, X(1.56), y + .012, .94, { rx: -PI / 2 }); }
    if (r() < .35) k.box('rubber', .8, .014, .48, X(.78), y + .007, .42, { bevel: .004 });
    if (r() < .12) { k.box('plastic_red', .075, .2, .003, X(.78) + sg * .37, y + .9, .115, { rz: .08 }); }
    if (r() < .6) k.decal('leak', .6 + r() * .4, .8 + r() * .5, X(2.5) - sg * .2, y + .004, .55 + r() * .2, r() * .4);
    if (r() < .45) k.quad(GT.decalMat('grime_streak'), .9 + r(), .55, X(.3 + r() * 3), y + .27, .008, { rz: PI });
    if (r() < .16) k.box(r() < .5 ? 'stucco_white' : 'stucco_pink', .5 + r() * .6, .35 + r() * .5, .008, X(1.56) + (r() - .5) * .3, y + 2.62 - r() * .15, 0, { bevel: .003 });
    if (r() < .3) k.quad(GT.decalMat('water_stain'), .7 + r() * .5, 1 + r(), X(3.3 * r() + .2), y + 2.5, .0085);
  }

  /* ================================================================== stairs, breeze-block screens, railings */
  function breeze(k, w, h) {   // decorative screen wall in the local XY plane, 19 cm thick
    const s = .31, nx = Math.max(1, Math.round(w / s)), ny = Math.max(1, Math.round(h / s)), sx = w / nx, sy = h / ny, t = .034, d = .19, m = 'stucco_white', dl = Math.hypot(sx, sy) / 2 - .01;
    for (let i = 0; i <= nx; i++) k.box(m, t, h, d, i * sx, h / 2, 0); for (let j = 0; j <= ny; j++) k.box(m, w + t, t, d, w / 2, j * sy, 0);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const cx = (i + .5) * sx, cy = (j + .5) * sy; for (const [ox, oy, a] of [[-.25, .25, 1], [.25, .25, -1], [.25, -.25, 1], [-.25, -.25, -1]]) k.box(m, dl, .026, d * .85, cx + ox * sx, cy + oy * sy, 0, { rz: a * Math.atan2(sy, sx) }); }
  }
  function railRun(k, x0, x1, y, z, along) {   // picket railing between two points on a line (along 'x' or 'z'), y = deck level
    const len = x1 - x0, W = 'metal_painted_white', n = Math.max(1, Math.round(len / .115)), c = (x0 + x1) / 2;
    const bx = (w, h, d, p, yy) => along === 'x' ? ubox(k, W, w, h, d, p, yy, z) : ubox(k, W, d, h, w, z, yy, p);
    if (along === 'x') { k.box(W, len, .05, .055, c, y + 1.07, z, { bevel: .01 }); } else k.box(W, .055, .05, len, z, y + 1.07, c, { bevel: .01 });
    bx(len, .03, .03, c, y + .1); bx(len, .025, .025, c, y + .93);
    for (let i = 0; i < n; i++) bx(.016, .83, .016, x0 + (i + .5) * len / n, y + .515);
  }
  function stair(k, xs) {   // straight flight rising along +x beside the balcony edge, open risers, steel stringers
    const n = 18, rise = FH / n, tr = .28, run = (n - 1) * tr, z0 = BAL + .08, z1 = z0 + 1.1, zc = (z0 + z1) / 2, W = 'metal_painted_white', ang = Math.atan2(FH - rise, run - tr), slen = Math.hypot(run, FH) + .2;
    for (const z of [z0 + .03, z1 - .03]) { k.box(W, slen, .26, .05, xs + run / 2, G + FH / 2 - .1, z, { rz: Math.atan2(FH, run), bevel: .008 });
      k.box(W, slen, .045, .05, xs + run / 2, G + FH / 2 + .98, z, { rz: Math.atan2(FH, run), bevel: .01 }); k.box(W, slen, .025, .025, xs + run / 2, G + FH / 2 + .32, z, { rz: Math.atan2(FH, run) });
      for (let i = 0; i < n - 1; i++) ubox(k, W, .016, .66, .016, xs + (i + .5) * tr, G + (i + 1) * rise + .5, z); k.box(W, .05, 1.1, .05, xs - .02, G + .55, z, { bevel: .008 }); }
    for (let i = 0; i < n - 1; i++) { k.box('concrete', tr + .03, .055, 1.02, xs + (i + .5) * tr, G + (i + 1) * rise - .0275, zc, { bevel: .01 }); k.box('metal_galv', .04, .04, 1.0, xs + (i + .5) * tr, G + (i + 1) * rise - .075, zc); }
    const lx0 = xs + run, lx1 = lx0 + 1.3;
    k.box('concrete', 1.3, .17, z1 - BAL + .02, (lx0 + lx1) / 2, F2 - .085, (BAL + z1) / 2 - .01, { bevel: .012 });
    for (const lx of [lx0 + .06, lx1 - .06]) { k.box(W, .09, F2 - .17, .09, lx, (F2 - .17) / 2, z1 - .06, { bevel: .008 }); k.box('metal_rust', .1, .1, .1, lx, G + .05, z1 - .06); }
    railRun(k, lx0, lx1, F2, z1 - .03, 'x'); railRun(k, BAL + .05, z1, F2, lx1 - .03, 'z');
    k.box('concrete', 1.3, .05, 1.4, xs - .45, G + .025, zc, { bevel: .012 }); void ang;
    wbox(k, xs, z0, lx1, z1, 3.2, 'motel-stair');
    return [lx0 + .04, lx1 - .04];
  }

  /* ================================================================== a building wing in local space: facade = plane z=0 facing +z, x runs along it */
  function wing(C, cfg) {
    const { k, vc, ad, A, M } = C, D = cfg.depth, W = 'metal_painted_white';
    k.push(cfg.ox, 0, cfg.oz, { ry: cfg.ry }); const TOP = k.top;
    // ---- body
    for (const [x0, x1, zb, zf] of cfg.lower) k.box('stucco_cream', x1 - x0, F2, zf - zb, (x0 + x1) / 2, F2 / 2, (zb + zf) / 2);
    k.box('stucco_cream', cfg.bodyLen, FH, D, cfg.bodyLen / 2, F2 + FH / 2, -D / 2);
    k.box('stucco_white', cfg.bodyLen + .06, .16, .05, cfg.bodyLen / 2, F2 - .05, -D - .02);                                // belt course on the back
    k.box('concrete', cfg.walk[1] - cfg.walk[0], G, cfg.walk[2], (cfg.walk[0] + cfg.walk[1]) / 2, G / 2, cfg.walk[2] / 2, { bevel: .025 });
    // ---- balcony deck + edge channel + posts + railing
    const [d0, d1] = cfg.deck; k.box('concrete', d1 - d0, .17, BAL, (d0 + d1) / 2, F2 - .085, BAL / 2); k.box(W, d1 - d0, .24, .04, (d0 + d1) / 2, F2 - .1, BAL + .005, { bevel: .008 });
    for (let x = d0 + 1.2; x < d1; x += 7.4) { k.cyl('metal_galv', .022, .022, .12, x, F2 - .12, BAL + .07, { rx: PI / 2, seg: 6 }); k.quad(GT.decalMat('rust_run'), .2, .22, x, F2 - .11, BAL + .027); }
    for (const px of cfg.posts) { ubox(k, W, .09, RU - G, .09, px, (RU + G) / 2, BAL - .08, { bevel: .008 }); k.box('metal_galv', .2, .012, .2, px, G + .006, BAL - .08); k.box('metal_rust', .098, .09 + hsh(px) * .12, .098, px, G + .06, BAL - .08); k.box('metal_rust', .098, .05, .098, px, F2 + .03, BAL - .08);
      wbox(k, px - .08, BAL - .16, px + .08, BAL, 6.3, 'motel-post'); }
    const gaps = cfg.stair !== undefined ? [stair(k, cfg.stair)] : [];
    const nodes = [cfg.rail[0], ...cfg.posts.filter(p => p > cfg.rail[0] + .1 && p < cfg.rail[1] - .1), cfg.rail[1]];
    for (let i = 0; i < nodes.length - 1; i++) { let a = nodes[i], b = nodes[i + 1]; const segs = []; let cut = false;
      for (const [g0, g1] of gaps) if (g0 < b && g1 > a) { if (g0 > a + .05) segs.push([a, g0]); if (g1 < b - .05) segs.push([g1, b]); cut = true; }
      if (!cut) segs.push([a, b]); for (const [s0, s1] of segs) railRun(k, s0, s1, F2, BAL - .08, 'x'); }
    // ---- roof slab, tar, fascia, gutter, downspouts, neon line under the eave
    const [rb0, rb1] = cfg.roofBody, [re0, re1] = cfg.roofEave, EV = BAL + .45;
    k.box('stucco_white', rb1 - rb0, .2, D + .3, (rb0 + rb1) / 2, RU + .1, -D / 2 - .15); k.box('stucco_white', re1 - re0, .2, EV, (re0 + re1) / 2, RU + .1, EV / 2);
    k.box('roof_tar', rb1 - rb0 - .3, .05, D, (rb0 + rb1) / 2, RU + .22, -D / 2 - .1); k.box('roof_tar', re1 - re0 - .3, .05, EV - .1, (re0 + re1) / 2, RU + .22, EV / 2 - .1);
    k.box(M.teal, re1 - re0, .38, .05, (re0 + re1) / 2, RU + .1, EV + .02, { bevel: .008 }); k.box('metal_galv', re1 - re0, .1, .12, (re0 + re1) / 2, RU + .25, EV + .09, { bevel: .01 });
    k.box('stucco_white', rb1 - rb0, .3, .06, (rb0 + rb1) / 2, RU + .18, -D - .3); k.box('metal_galv', rb1 - rb0, .03, .1, (rb0 + rb1) / 2, RU + .335, -D - .29);
    for (const ex of cfg.roofEnds || []) { k.box(M.teal, .05, .38, D + EV + .3, ex, RU + .1, (EV - D - .3) / 2, { bevel: .008 }); }
    for (let i = 0, x = re0 + 2.2; x < re1 - 1; x += 3 * PITCH, i++) { k.tube('metal_galv', [[x, RU + .22, EV + .09], [x, RU + .02, EV + .09], [x, RU - .18, BAL + .0], [x, RU - .5, BAL - .0], [x, G + .3, BAL - .0], [x, G + .1, BAL + .16]], .038, { seg: 7, tension: .1, steps: 24 });
      for (const y of [G + 1.2, F2 + .9, RU - .7]) k.box('metal_galv', .1, .03, .02, x, y, BAL - .035); k.decal('leak', .7, 1.1, x, G + .004, BAL + .6); }
    for (let x = re0 + .4, i = 0; x < re1 - 1; x += PITCH, i++) { const x1 = Math.min(x + PITCH - .12, re1 - .3), st = hsh(i * 7.3 + cfg.ox), sd = i * 3.1;
      vc.el([1, .14, .5], .75, 6, st < .07 ? () => .04 : st < .13 ? t => hsh(Math.floor(t * 20 + sd)) < .35 ? .12 : .9 : null, [.95, .5, .68]).rod(TOP, [x, RU - .06, EV + .03], [x1, RU - .06, EV + .03], .017, 6);
      k.box('metal_dark', .03, .07, .04, x + .05, RU - .045, EV + .02); k.box('metal_dark', .03, .07, .04, x1 - .05, RU - .045, EV + .02);
      if (st >= .07) ad.el([1, .14, .5], 0, .18).quad(TOP, A.g_strip, x1 - x + .6, 1.5, (x + x1) / 2, RU - .75, .013); }
    // ---- conduit runs + cable along both storeys
    for (const y of [G + 2.78, F2 + 2.78]) k.cyl('metal_galv', .011, .011, cfg.len - .6, cfg.len / 2, y, .014, { rz: PI / 2, seg: 6 });
    { const pts = []; for (let x = 1; x < cfg.len - 1; x += PITCH / 2) pts.push([x, RU - .09 - ((pts.length % 2) ? .07 : 0), .03]); k.tube('rubber', pts, .009, { seg: 5, steps: pts.length * 3 }); }
    // ---- rooms
    for (const rm of cfg.rooms) { stamp(k, C.tpl[rm.mir ? 1 : 0], rm.x, rm.y, 0); roomExtras(C, rm.x, rm.y, rm.mir, rm.num); }
    // ---- back wall: bathroom windows, vents, stains (seen from the back road)
    for (let x = 2, i = 0; x < cfg.bodyLen - 1; x += PITCH, i++) for (const y of [G, F2]) { k.box('aluminium_brushed', .7, .5, .05, x, y + 2.0, -D - .01); k.box('glass_tint', .6, .4, .01, x, y + 2.0, -D - .04);
      if (hsh(i * 3.3 + y) < .5) k.quad(GT.decalMat('grime_streak'), .8, 1.6, x, y + .95, -D - .012, { ry: PI }); if (hsh(i * 5.1 + y) < .3) k.cyl('metal_galv', .05, .05, .1, x + 1.2, y + 2.3, -D - .05, { rx: PI / 2, seg: 8 }); }
    if (cfg.extra) cfg.extra(k, TOP);
    k.pop();
  }

  /* ================================================================== props */
  const P = {
    wheelStop(k, x, z, ry, yel) { k.push(x, .02, z, { ry }); k.box(yel ? 'curb_paint_yellow' : 'concrete', 1.8, .11, .17, 0, .055, 0, { bevel: .028 }); for (const sx of [-.6, .6]) k.cyl('metal_rust', .014, .014, .02, sx, .115, 0, { seg: 6 }); k.pop(); },
    lounger(C, x, y, z, ry, strapMat, towel) { const k = C.k, AL = 'aluminium_brushed'; k.push(x, y, z, { ry });
      const ba = .62, bl = .72, sl = 1.22, hw = .3, sy = .32, bx = -sl / 2, bex = bx - Math.cos(ba) * bl, bey = sy + Math.sin(ba) * bl;
      for (const s of [-1, 1]) { const zz = s * hw; k.tube(AL, [[sl / 2, .0, zz], [sl / 2 + .03, sy - .04, zz], [sl / 2 - .04, sy, zz], [bx, sy, zz]], .013, { seg: 6, tension: .1, steps: 14 }); rod(k, AL, [bx, sy, zz], [bex, bey, zz], .013, .013, 6); rod(k, AL, [bx + .12, sy, zz], [bx - .08, 0, zz], .013, .013, 6); rod(k, AL, [bx - .32, sy + .25, zz], [bx - .1, 0.0, zz], .011, .011, 6);
        k.box('plastic_white', .05, .02, .03, sl / 2, .01, zz); k.box('plastic_white', .05, .02, .03, bx - .09, .01, zz); }
      rod(k, AL, [bex, bey, -hw], [bex, bey, hw], .013, .013, 6); rod(k, AL, [sl / 2 - .02, sy, -hw], [sl / 2 - .02, sy, hw], .013, .013, 6);
      for (let i = 0; i < 17; i++) { const sag = Math.sin(i / 16 * PI) * .012; k.box(i % 5 === 2 ? strapMat : 'plastic_white', .052, .004, hw * 2 + .03, bx + .04 + i * (sl - .08) / 16, sy + .014 - sag, 0); }
      for (let i = 0; i < 9; i++) { const u = .08 + i * .072; k.box(i % 4 === 1 ? strapMat : 'plastic_white', .052, .004, hw * 2 + .03, bx - Math.cos(ba) * u, sy + .012 + Math.sin(ba) * u, 0, { rz: -ba }); }
      if (towel) { k.box(C.M.towel, .5, .012, .64, .2, sy + .028, 0, { bevel: .005 }); k.box(C.M.towel, .5, .3, .012, .2, sy - .13, hw + .022, { bevel: .005 }); }
      k.pop(); },
    umbrella(C, x, y, z, seed) { const k = C.k, r = GT.rng('umb' + seed); k.push(x, y, z, { ry: r() * TAU, rz: (r() - .5) * .04 });
      k.cyl('concrete_stained', .24, .27, .09, 0, .045, 0, { seg: 14 }); k.cyl('metal_painted_white', .03, .03, .22, 0, .2, 0, { seg: 8 }); k.cyl('aluminium_brushed', .019, .019, 2.3, 0, 1.25, 0, { seg: 8 });
      { const pr = [[.03, 2.34], [.05, 2.25], [.075, 2.0], [.1, 1.7], [.115, 1.45], [.1, 1.36], [.125, 1.2], [.135, 1.08], [.02, 1.07]].map(p => new T.Vector2(p[0], p[1])), lg = new T.LatheGeometry(pr, 9), p = lg.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), f = 1 + .12 * Math.sin(a * 9 + p.getY(i) * 3); p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f); } lg.computeVertexNormals(); metreUV(lg, .7, 1.3); k.geo(C.M.canvas, lg); } k.cyl('plastic_white', .1, .1, .035, 0, 1.4, 0, { seg: 9 }); k.sphere('plastic_white', .028, 0, 2.42, 0, { seg: 8, seg2: 6 }); k.pop(); },
    sideTable(k, x, y, z) { k.cyl('plastic_white', .26, .26, .025, x, y + .44, z, { seg: 16 }); for (let i = 0; i < 3; i++) { const a = i * TAU / 3; rod(k, 'plastic_white', [x + Math.cos(a) * .2, y + .43, z + Math.sin(a) * .2], [x + Math.cos(a) * .24, y, z + Math.sin(a) * .24], .014, .014, 6); } },
    trashCan(k, x, y, z) { k.cyl('metal_dark', .23, .2, .72, x, y + .36, z, { seg: 14 }); k.cyl('metal_galv', .245, .245, .05, x, y + .74, z, { seg: 14 }); k.cyl('plastic_black', .2, .2, .012, x, y + .735, z, { seg: 12 }); },
    luggageCart(C, x, y, z, ry) { const k = C.k, B = C.M.brass; k.push(x, y, z, { ry });
      k.box(C.M.canvas, 1.1, .05, .6, 0, .22, 0, { bevel: .012 }); k.box(B, 1.14, .03, .64, 0, .185, 0, { bevel: .01 });
      for (const sx of [-.5, .5]) { k.tube(B, [[sx, .2, -.27], [sx, 1.5, -.27], [sx, 1.72, -.14], [sx, 1.76, 0], [sx, 1.72, .14], [sx, 1.5, .27], [sx, .2, .27]], .016, { seg: 7, tension: .35, steps: 28 }); for (const sz of [-.27, .27]) { k.cyl('chrome', .012, .012, .1, sx, .13, sz, { seg: 6 }); k.cyl('rubber', .055, .055, .035, sx, .055, sz, { rx: PI / 2, seg: 10 }); } }
      rod(k, B, [-.5, 1.76, 0], [.5, 1.76, 0], .014, .014, 7); for (let i = 0; i < 4; i++) k.tube(B, [[-.3 + i * .2, 1.75, 0], [-.3 + i * .2, 1.68, 0], [-.28 + i * .2, 1.66, .02]], .004, { seg: 4, steps: 6 });
      k.box(C.M.brassLeather || 'wood_plank', .62, .42, .2, -.14, .46, -.05, { bevel: .025, ry: .1 }); k.box('plastic_black', .5, .34, .22, .22, .42, .12, { bevel: .03, ry: -.2 }); k.box(C.M.canvas, .4, .14, .3, -.1, .74, -.02, { bevel: .03, ry: .3 }); k.box('chrome', .1, .012, .012, -.14, .68, .055); k.pop(); },
    bike(C, x, y, z, ry, lean, mat) { const k = C.k, R = .33; k.push(x, y, z, { ry, rx: lean });
      for (const wx of [-.52, .52]) { const tg = new T.TorusGeometry(R, .02, 6, 22); k.geo('rubber', tg, { x: wx, y: R + .02 }); const rg = new T.TorusGeometry(R - .03, .009, 5, 22); k.geo('aluminium_brushed', rg, { x: wx, y: R + .02 });
        for (let i = 0; i < 7; i++) { const a = i * PI / 7; k.box('aluminium_brushed', (R - .03) * 2, .003, .003, wx, R + .02, 0, { rz: a }); } k.cyl('aluminium_brushed', .02, .02, .08, wx, R + .02, 0, { rx: PI / 2, seg: 8 }); }
      const bb = [-.08, .3, 0], seat = [-.2, .86, 0], head = [.38, .84, 0], rear = [-.52, R + .02, 0], front = [.52, R + .02, 0];
      rod(k, mat, bb, seat, .016); rod(k, mat, seat, head, .016); rod(k, mat, bb, [.36, .76, 0], .018); rod(k, mat, bb, rear, .011); rod(k, mat, [-.21, .8, 0], rear, .01); rod(k, mat, [.37, .8, 0], [.42, .92, 0], .018); rod(k, 'chrome', [.4, .82, 0], front, .012);
      rod(k, 'chrome', [.42, .93, -.26], [.42, .93, .26], .011); k.box('rubber', .03, .03, .1, .42, .93, -.23); k.box('rubber', .03, .03, .1, .42, .93, .23); k.box('plastic_black', .25, .05, .13, -.24, .9, 0, { bevel: .02 }); rod(k, 'chrome', seat, [-.22, .89, 0], .011);
      k.cyl('metal_dark', .09, .09, .006, bb[0], bb[1], .04, { rx: PI / 2, seg: 14 }); rod(k, 'metal_dark', [bb[0], bb[1], .05], [bb[0] + .12, bb[1] - .12, .07], .008); k.box('rubber', .09, .02, .06, bb[0] + .12, bb[1] - .12, .1); rod(k, 'metal_dark', [bb[0], bb[1], -.05], [bb[0] - .12, bb[1] + .12, -.07], .008); k.box('rubber', .09, .02, .06, bb[0] - .12, bb[1] + .12, -.1);
      k.box(mat, .5, .012, .05, -.52, R * 2 + .06, 0, { bevel: .004 }); k.pop(); },
    trolley(C, x, y, z, ry) { const k = C.k, Gm = 'metal_galv'; k.push(x, y, z, { ry });
      const bx0 = -.42, bx1 = .42, by0 = .55, by1 = .98, hz0 = .22, hz1 = .27;
      for (const yy of [by0, by0 + .14, by0 + .28, by1]) { const f = (yy - by0) / (by1 - by0), hz = lerp(hz0, hz1, f), x1 = bx1 + f * .08; for (const s of [-1, 1]) rod(k, Gm, [bx0, yy, s * hz], [x1, yy, s * hz], .004, .004, 4); rod(k, Gm, [bx0, yy, -hz], [bx0, yy, hz], .004, .004, 4); rod(k, Gm, [x1, yy, -hz], [x1, yy, hz], .004, .004, 4); }
      for (let i = 0; i <= 14; i++) { const xx = lerp(bx0, bx1, i / 14); for (const s of [-1, 1]) rod(k, Gm, [xx, by0, s * hz0], [xx + (i / 14) * .08 * 1, by1, s * hz1], .003, .003, 4); rod(k, Gm, [xx, by0, -hz0], [xx, by0, hz0], .003, .003, 4); }
      for (let i = 0; i <= 8; i++) { const zz = lerp(-hz0, hz0, i / 8); rod(k, Gm, [bx0, by0, zz], [bx0, by1, zz * hz1 / hz0], .003, .003, 4); rod(k, Gm, [bx1, by0, zz], [bx1 + .08, by1, zz * hz1 / hz0], .003, .003, 4); }
      for (const s of [-1, 1]) { k.tube(Gm, [[bx0 - .1, 1.04, s * .26], [bx0, .98, s * .26], [bx0 + .05, .5, s * .24], [bx0 + .1, .16, s * .22], [bx1 - .02, .13, s * .2]], .011, { seg: 6, tension: .2, steps: 16 }); for (const xx of [bx0 + .14, bx1 - .06]) { k.cyl('rubber', .05, .05, .028, xx, .05, s * .21, { rx: PI / 2, seg: 10 }); k.box(Gm, .02, .08, .04, xx, .1, s * .21); } }
      rod(k, 'plastic_red', [bx0 - .1, 1.04, -.27], [bx0 - .1, 1.04, .27], .016, .016, 8); k.box(Gm, .8, .008, .4, 0, .15, 0); k.box('plastic_red', .16, .07, .005, bx0 + .008, .9, 0); k.pop(); },
    payPhone(C, x, y, z, ry) { const k = C.k, AL = 'aluminium_brushed'; k.push(x, y, z, { ry });
      k.box('metal_dark', .09, 1.0, .09, 0, .5, -.12, { bevel: .008 }); k.box('metal_galv', .24, .012, .24, 0, .006, -.12); for (const [bx, bz] of [[-.09, -.21], [.09, -.21], [-.09, -.03], [.09, -.03]]) k.cyl('metal_galv', .011, .011, .02, bx, .02, bz, { seg: 6 });
      k.box(AL, .56, .82, .02, 0, 1.52, -.2, { bevel: .006 }); k.box(AL, .02, .82, .4, -.28, 1.52, -.01, { bevel: .006 }); k.box(AL, .02, .82, .4, .28, 1.52, -.01, { bevel: .006 }); k.box(AL, .6, .02, .44, 0, 1.94, 0, { bevel: .006 }); k.box(AL, .54, .02, .36, 0, 1.12, -.02, { bevel: .006 });
      k.box('metal_painted_blue', .62, .2, .46, 0, 2.05, 0, { bevel: .015 }); aquad(k, C.lit, C.A.phone, .56, .16, 0, 2.05, .232); aquad(k, C.lit, C.A.phone, .4, .14, -.312, 2.05, 0, { ry: -PI / 2 }); aquad(k, C.lit, C.A.phone, .4, .14, .312, 2.05, 0, { ry: PI / 2 });
      k.box('metal_dark', .3, .52, .16, .02, 1.5, -.1, { bevel: .015 }); k.box('chrome', .14, .16, .006, .06, 1.56, -.017, { bevel: .003 }); for (let i = 0; i < 12; i++) k.box('aluminium_brushed', .026, .026, .008, .02 + (i % 3) * .038, 1.61 - ((i / 3) | 0) * .036, -.012, { bevel: .003 });
      k.box('chrome', .1, .012, .006, .04, 1.7, -.017); k.box('chrome', .07, .07, .012, .1, 1.33, -.015, { bevel: .004 }); k.box('metal_dark', .05, .1, .05, -.1, 1.62, -.02, { bevel: .008 });
      k.box('plastic_black', .05, .2, .045, -.1, 1.56, .02, { bevel: .014 }); k.sphere('plastic_black', .034, -.1, 1.67, .035, { s: [1, .8, 1], seg: 8, seg2: 6 }); k.sphere('plastic_black', .034, -.1, 1.45, .035, { s: [1, .8, 1], seg: 8, seg2: 6 });
      k.tube('chrome', [[-.1, 1.45, .03], [-.14, 1.25, .08], [-.06, 1.14, .06], [.02, 1.26, -.01]], .007, { seg: 5, steps: 14 }); k.box('plastic_black', .3, .03, .22, .0, 1.09, -.02, { bevel: .006 }); k.box('plastic_white', .26, .04, .2, 0, 1.065, -.02, { rz: .04 });
      wbox(k, -.3, -.22, .3, .22, 2.1, 'motel-phone'); k.pop(); },
    newsBox(C, x, y, z, ry) { const k = C.k; k.push(x, y, z, { ry }); for (const [lx, lz] of [[-.17, -.15], [.17, -.15], [-.17, .15], [.17, .15]]) k.box('metal_dark', .03, .5, .03, lx, .25, lz);
      k.box('metal_painted_yellow', .46, .62, .42, 0, .81, 0, { bevel: .02 }); k.box('glass_clear', .36, .34, .008, 0, .86, .212); k.box('plastic_white', .32, .3, .004, 0, .86, .205); aquad(k, C.lit, C.A.news, .36, .09, 0, .6, .2125); k.box('chrome', .06, .1, .03, .18, 1.06, .2, { bevel: .006 }); k.box('chrome', .2, .016, .016, 0, 1.06, .225);
      wbox(k, -.24, -.22, .24, .22, 1.2, 'motel-newsbox'); k.pop(); },
    hkCart(C, x, y, z, ry) { const k = C.k, AL = 'aluminium_brushed'; k.push(x, y, z, { ry });
      for (const [lx, lz] of [[-.5, -.24], [.5, -.24], [-.5, .24], [.5, .24]]) { k.box(AL, .025, 1.0, .025, lx, .6, lz); k.cyl('rubber', .05, .05, .03, lx, .05, lz, { rx: PI / 2, seg: 10 }); }
      for (const sy of [.14, .52, .9]) k.box('plastic_black', 1.04, .025, .52, 0, sy, 0, { bevel: .006 }); k.box(AL, 1.04, .02, .02, 0, 1.1, -.24); k.box(AL, 1.04, .02, .02, 0, 1.1, .24);
      for (let i = 0; i < 4; i++) k.box(C.M.towel, .26, .045, .36, -.3 + (i % 2) * .3, .56 + ((i / 2) | 0) * .05, 0, { bevel: .012 }); for (let i = 0; i < 3; i++) k.box(C.M.towel, .3, .06, .4, -.28, .185 + i * .065, 0, { bevel: .015 });
      for (let i = 0; i < 5; i++) k.cyl('plastic_white', .055, .055, .1, .1 + (i % 3) * .12, .215, -.1 + ((i / 3) | 0) * .13, { seg: 10 });
      for (const [bx, m] of [[-.36, 'plastic_red'], [-.22, 'metal_painted_blue'], [-.08, 'plastic_white']]) { k.cyl(m, .035, .04, .18, bx, 1.005, .1, { seg: 8 }); k.cyl('plastic_white', .012, .012, .06, bx, 1.12, .1, { seg: 6 }); k.box('plastic_white', .05, .02, .02, bx + .02, 1.15, .1); }
      k.cyl(C.M.canvas, .2, .15, .78, .72, .52, 0, { seg: 10 }); k.sphere(C.M.towel, .19, .72, .9, 0, { s: [1, .45, 1], seg: 10, seg2: 6 }); k.cyl('aluminium_brushed', .21, .21, .02, .72, .92, 0, { seg: 12 }); k.box(AL, .02, .02, .5, .55, 1.08, 0); k.sphere('plastic_black', .2, -.7, .42, 0, { s: [.75, 1.25, .95], seg: 10, seg2: 8 }); k.box('aluminium_brushed', .02, .02, .5, -.55, 1.08, 0);
      rod(k, 'wood_plank', [.2, .16, -.2], [.32, 1.55, -.26], .013, .013, 6); k.box(C.M.towel, .26, .1, .05, .2, .16, -.2, { bevel: .02 }); k.pop(); },
    lotLight(C, x, z, ry) { const { k, vc, ad, A } = C; k.push(x, 0, z, { ry });
      k.cyl('concrete_stained', .28, .3, .75, 0, .375, 0, { seg: 14 }); k.cyl('metal_galv', .19, .19, .02, 0, .76, 0, { seg: 10 }); for (let i = 0; i < 4; i++) k.cyl('metal_galv', .015, .015, .05, Math.cos(i * PI / 2 + .78) * .15, .79, Math.sin(i * PI / 2 + .78) * .15, { seg: 6 });
      rod(k, 'metal_painted_white', [0, .77, 0], [0, 7.6, 0], .085, .055, 10); k.box('metal_galv', .1, .16, .03, 0, 1.3, .088, { bevel: .005 }); rod(k, 'metal_painted_white', [0, 7.5, 0], [1.25, 7.75, 0], .04, .035, 8);
      k.box('metal_dark', .78, .15, .38, 1.5, 7.76, 0, { bevel: .03 }); k.quad(GT.decalMat('rust_run'), .2, 1.6, 0, 6.6, .09);
      vc.el([1, .8, .5], .5, 9, null, [.85, .85, .8]).quad(k.top, A.g_round, .62, .26, 1.5, 7.682, 0, { rx: PI / 2 });
      ad.el([1, .72, .4], 0, .3).quad(k.top, A.g_round, 19, 19, 1.6, .045, 0, { rx: -PI / 2 });
      GT.world.addPost(x, z, .32, 7.6, 'motel-lotlight'); k.pop(); }
  };

  /* ================================================================== the roadside sign pylon (signature piece) */
  function roundShape(pts, rad) { const s = new T.Shape(), n = pts.length;
    for (let i = 0; i < n; i++) { const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], la = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]), lb = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), ax = p1[0] + (p0[0] - p1[0]) / la * rad, ay = p1[1] + (p0[1] - p1[1]) / la * rad, bx = p1[0] + (p2[0] - p1[0]) / lb * rad, by = p1[1] + (p2[1] - p1[1]) / lb * rad;
      if (i === 0) s.moveTo(ax, ay); else s.lineTo(ax, ay); s.quadraticCurveTo(p1[0], p1[1], bx, by); } s.closePath(); return s; }
  function slab(shape, depth, bev) { const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 5 }); g.translate(0, 0, -depth / 2); return g; }
  function signPylon(C) {
    const { k, vc, ad, A, M } = C, W = 'metal_painted_white', sx0 = L.sign.x, sz0 = L.sign.z; k.push(sx0, 0, sz0); const TOP = k.top, PINK = [1, .16, .5], CYAN = [.15, .8, 1], AMBER = [1, .62, .22], BULB = [1, .7, .32];
    // base planter, masts, flanges, ladder rungs, disconnect + conduit
    k.box('brick_painted', 5.0, .62, 1.7, .1, .31, 0, { bevel: .02 }); k.box('concrete_stained', 5.2, .08, 1.9, .1, .66, 0, { bevel: .02 }); k.box('dirt', 4.5, .05, 1.2, .1, .69, 0);
    GT.world.addBox(sx0 - 2.5, sz0 - .95, sx0 + 2.7, sz0 + .95, 16, 'motel-sign');
    const mA = -1.5, mB = 1.3;
    rod(k, W, [mA, .6, 0], [mA, 15.5, 0], .21, .13, 14); rod(k, W, [mB, .6, 0], [mB, 10.4, 0], .17, .14, 14);
    for (const mx of [mA, mB]) { k.cyl('metal_galv', .36, .36, .035, mx, .72, 0, { seg: 16 }); for (let i = 0; i < 6; i++) k.cyl('metal_rust', .022, .022, .07, mx + Math.cos(i * PI / 3) * .29, .75, Math.sin(i * PI / 3) * .29, { seg: 6 }); k.quad(GT.decalMat('rust_run'), .3, 2.2, mx, 2.3, .22); k.quad(GT.decalMat('rust_run'), .3, 2.2, mx, 2.5, -.22, { ry: PI }); }
    for (let y = 2.4; y < 9; y += .36) k.box('metal_galv', .34, .02, .02, mA - .3, y, 0); rod(k, 'metal_galv', [mA - .46, 2.4, 0], [mA - .46, 9, 0], .012, .012, 5);
    rod(k, W, [mA, 3.0, 0], [mB, 4.2, 0], .045, .045, 8); rod(k, W, [mA, 6.6, 0], [mB, 6.6, 0], .05, .05, 8); rod(k, W, [mA, 8.6, 0], [mB, 8.6, 0], .05, .05, 8);
    k.box('metal_galv', .36, .52, .18, mB, 1.7, .26, { bevel: .012 }); k.box('metal_dark', .04, .16, .04, mB + .2, 1.75, .26, { bevel: .006 }); k.cyl('metal_galv', .016, .016, 1.0, mB, 1.0, .3, { seg: 6 }); k.tube('metal_galv', [[mB, 1.96, .3], [mB, 3.2, .2], [mB + .05, 4.3, .18]], .016, { seg: 6, steps: 12 });
    // ---- main cabinet: leaning parallelogram, teal, aluminium edge band, script neon both faces
    const cab = [[-4.3, 9.2], [3.1, 9.2], [4.0, 12.25], [-3.4, 12.25]];
    k.geo(M.teal, slab(roundShape(cab, .4), .44, .03)); k.geo('aluminium_brushed', slab(roundShape([[-4.36, 9.15], [3.14, 9.15], [4.08, 12.3], [-3.46, 12.3]], .43), .2, .02));
    const inner = [[-3.98, 9.44], [2.9, 9.44], [3.66, 12.0], [-3.22, 12.0]];
    for (const f of [1, -1]) { const ry = f > 0 ? 0 : PI, zf = f * .256, zt = f * .3;
      aquad(k, C.lit, A.sp_Coral, 3.5, 1.58, -1.75 * f - (f > 0 ? 0 : .3), 11.2, zf, { ry }); aquad(k, C.lit, A.sp_Comet, 3.6, 1.62, .95 * f - (f > 0 ? 0 : .3), 10.22, zf, { ry });
      ad.el(PINK, 1.1, 5).quad(TOP, A.sn_Coral, 3.5, 1.58, -1.75 * f - (f > 0 ? 0 : .3), 11.2, zf + f * .03, { ry });
      ad.el(PINK, 1.1, 5, t => { const s = Math.sin(t * .7) > .55 ? 1 : 0; return s && hsh(Math.floor(t * 22)) < .45 ? .12 : 1; }).quad(TOP, A.sn_Comet, 3.6, 1.62, .95 * f - (f > 0 ? 0 : .3), 10.22, zf + f * .03, { ry });
      vc.el(CYAN, .7, 6, null, [.6, .85, .92]); for (let i = 0; i < 4; i++) { const a = inner[i], b = inner[(i + 1) % 4]; vc.rod(TOP, [a[0], a[1], zt], [b[0], b[1], zt], .019, 6); vc.ball(TOP, .019, a[0], a[1], zt); }
      for (let i = 0; i < 4; i++) { const a = inner[i], b = inner[(i + 1) % 4]; for (const u of [.2, .5, .8]) k.box('metal_dark', .03, .03, .05, lerp(a[0], b[0], u), lerp(a[1], b[1], u), zt - f * .025); }
      // comet star + tails
      const cx = 3.05 * f + (f > 0 ? 0 : .3) * 0, cy = 11.55, star = []; for (let i = 0; i < 8; i++) { const a = i * PI / 4 + PI / 2, rr = i % 2 ? .13 : .36; star.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
      vc.el([1, .9, .6], .9, 7, t => .75 + .25 * Math.sin(t * 5), [1, .92, .7]); for (let i = 0; i < 8; i++) { const a = star[i], b = star[(i + 1) % 8]; vc.rod(TOP, [a[0], a[1], zt], [b[0], b[1], zt], .016, 5); }
      for (let j = 0; j < 3; j++) { vc.el(AMBER, .8, 6, t => ((Math.floor(t * 3) + 3 - j) % 4) < 3 ? 1 : .08); const y0 = cy + .16 - j * .16, len = 1.5 - j * .28; vc.rod(TOP, [cx - f * .5, y0, zt], [cx - f * (.5 + len), y0 + .12 + j * .04, zt], .016, 5); }
      for (const [dx, dy] of [[-2.9, 10.1], [1.2, 11.9], [-1.0, 9.5]]) k.quad(GT.decalMat('rust_run'), .35, 1.0, dx * f, dy, f * .259, { ry });
      ad.el(PINK, 0, .22).quad(TOP, A.g_round, 9, 4.2, 0, 10.7, f * .262, { ry });
    }
    // ---- MOTEL: five tilted letter boxes, painted letter + outline neon
    'MOTEL'.split('').forEach((ch, i) => { const cx = -3.05 + i * 1.42, cy = 7.72 + (i % 2 ? -.13 : .13), rz = (i % 2 ? -1 : 1) * .07;
      k.box(i % 2 ? M.coral : W, 1.22, 1.32, .34, cx, cy, 0, { bevel: .03, rz }); k.box('aluminium_brushed', 1.27, 1.37, .12, cx, cy, 0, { bevel: .015, rz });
      for (const f of [1, -1]) { const ry = f > 0 ? 0 : PI, xx = f > 0 ? cx : -cx - .1, li = f > 0 ? i : 4 - i; void li;
        aquad(k, C.lit, A['mp_' + li], 1.08, 1.19, cx, cy, f * .176, { ry, rz: rz * f }); const seqI = li;
        ad.el(i % 2 ? [1, .85, .55] : [1, .2, .16], 1.0, 5, t => { const p = t % 7; if (p < 1.6) return p > seqI * .32 ? 1 : .05; if (p > 5.6 && p < 6.6) return Math.floor(p * 5) % 2 ? .05 : 1; return 1; }).quad(TOP, A['mn_' + li], 1.08, 1.19, cx, cy, f * .2, { ry, rz: rz * f }); void xx; }
      k.quad(GT.decalMat('grime_streak'), .9, .8, cx, cy - .1, .178, { rz }); });
    // ---- readerboard marquee + VACANCY box
    const my = 5.25; k.box(W, 4.5, 1.92, .46, -.1, my, 0, { bevel: .03 });
    for (const f of [1, -1]) { const ry = f > 0 ? 0 : PI, zf = f * .233; aquad(k, C.lit, A.marquee, 4.2, 1.66, -.1, my, zf, { ry }); ad.el([1, .86, .62], 0, 1.15, t => .96 + .04 * hsh(Math.floor(t * 30))).quad(TOP, A.marquee, 4.2, 1.66, -.1, my, zf + f * .004, { ry });
      k.box('aluminium_brushed', 4.34, .07, .03, -.1, my + .865, zf + f * .012, { bevel: .006 }); k.box('aluminium_brushed', 4.34, .07, .03, -.1, my - .865, zf + f * .012, { bevel: .006 }); k.box('aluminium_brushed', .07, 1.8, .03, -2.235, my, zf + f * .012); k.box('aluminium_brushed', .07, 1.8, .03, 2.035, my, zf + f * .012); }
    k.box('plastic_black', 2.9, .64, .2, -.1, 3.72, 0, { bevel: .02 }); rod(k, 'metal_galv', [-1.1, 4.3, 0], [-1.1, 4.04, 0], .02); rod(k, 'metal_galv', [.9, 4.3, 0], [.9, 4.04, 0], .02);
    for (const f of [1, -1]) { const ry = f > 0 ? 0 : PI, zf = f * .104; ad.el([1, 1, 1], 1.1, 4.5, t => hsh(Math.floor(t * 9)) < .06 ? .9 : .05).quad(TOP, A.no, .66, .5, -.1 - f * 1.02, 3.72, zf, { ry }); ad.el([1, 1, 1], 1.2, 4.5).quad(TOP, A.vac, 1.95, .5, -.1 + f * .38, 3.72, zf, { ry }); }
    // ---- the arrow: bezier sweep over the top, hooking down toward the lot; chasing bulbs on both faces
    const B0 = [-5.0, 13.0], B1 = [-1.0, 15.7], B2 = [6.5, 14.4], B3 = [5.25, 7.7], bez = s => { const u = 1 - s; return [u * u * u * B0[0] + 3 * u * u * s * B1[0] + 3 * u * s * s * B2[0] + s * s * s * B3[0], u * u * u * B0[1] + 3 * u * u * s * B1[1] + 3 * u * s * s * B2[1] + s * s * s * B3[1]]; };
    const NS = 30, Lp = [], Rp = [], cen = []; let alen = 0, pp = null;
    for (let i = 0; i <= NS; i++) { const s = i / NS, p = bez(s), q = bez(Math.min(1, s + .01)), q0 = bez(Math.max(0, s - .01)), tx = q[0] - q0[0], ty = q[1] - q0[1], tl = Math.hypot(tx, ty), nx = -ty / tl, ny = tx / tl, hw = lerp(.3, .5, s); Lp.push([p[0] + nx * hw, p[1] + ny * hw]); Rp.push([p[0] - nx * hw, p[1] - ny * hw]); if (pp) alen += Math.hypot(p[0] - pp[0], p[1] - pp[1]); cen.push([p[0], p[1], alen, tx / tl, ty / tl]); pp = p; }
    const E = cen[NS], ed = [E[3], E[4]], en = [-ed[1], ed[0]], tip = [E[0] + ed[0] * 2.0, E[1] + ed[1] * 2.0], bl = [E[0] + en[0] * 1.2, E[1] + en[1] * 1.2], br = [E[0] - en[0] * 1.2, E[1] - en[1] * 1.2];
    const outline = [[B0[0] + cen[0][3] * .55, B0[1] + cen[0][4] * .55], ...Lp, bl, tip, br, ...Rp.reverse()], ash = new T.Shape(); outline.forEach((p, i) => i ? ash.lineTo(p[0], p[1]) : ash.moveTo(p[0], p[1])); ash.closePath();
    k.geo('metal_painted_yellow', slab(ash, .24, .025));
    rod(k, W, [3.6, 12.0, 0], [5.6, 12.6, 0], .04); rod(k, W, [3.3, 9.6, 0], [5.3, 9.0, 0], .04); rod(k, W, [mA, 13.2, 0], [mA + .0, 14.3, 0], .16, .14, 12);
    const bulbs = []; for (let d = .35; d < alen - .1; d += .34) { let i = 1; while (i < NS && cen[i][2] < d) i++; const a = cen[i - 1], b = cen[i], u = (d - a[2]) / Math.max(1e-4, b[2] - a[2]); bulbs.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u)]); }
    for (let i = 1; i <= 4; i++) { const u = i / 4.6; bulbs.push([lerp(bl[0], tip[0], u) - en[0] * .16 + ed[0] * .1, lerp(bl[1], tip[1], u) - en[1] * .16 + ed[1] * .1]); bulbs.push([lerp(br[0], tip[0], u) + en[0] * .16 + ed[0] * .1, lerp(br[1], tip[1], u) + en[1] * .16 + ed[1] * .1]); }
    bulbs.forEach((b, i) => { const deadB = hsh(i * 9.1) < .06, ci = i; for (const f of [1, -1]) { k.cyl('aluminium_brushed', .085, .085, .028, b[0], b[1], f * .158, { rx: PI / 2, seg: 10 });
      vc.el(BULB, .8, 8, deadB ? () => .03 : t => { const p = t % 12; if (p > 10.4) return Math.floor(p * 4) % 2 ? 1 : .06; return ((ci - Math.floor(t * 9)) % 4 + 4) % 4 === 0 ? .08 : 1; }, [1, .85, .6]).ball(TOP, .068, b[0], b[1], f * .205); } });
    for (const f of [1, -1]) k.quad(GT.decalMat('rust_run'), .5, 1.6, 5.9, 11.2, f * .152, { ry: f > 0 ? 0 : PI });
    // ---- starburst on the tall mast
    const sy = 16.1; k.sphere(M.brass, .3, mA, sy, 0, { seg: 14, seg2: 10 }); rod(k, W, [mA, 15.4, 0], [mA, sy, 0], .06, .05, 8);
    for (let i = 0; i < 16; i++) { const yy = 1 - (i + .5) / 8, rr = Math.sqrt(Math.max(0, 1 - yy * yy)), a = i * 2.39996, d = [Math.cos(a) * rr, yy, Math.sin(a) * rr * .55], dn = vnorm(d), len = i % 3 === 0 ? 1.7 : i % 3 === 1 ? 1.15 : .8, tipP = [mA + dn[0] * len, sy + dn[1] * len, dn[2] * len];
      rod(k, 'aluminium_brushed', [mA + dn[0] * .25, sy + dn[1] * .25, dn[2] * .25], tipP, .028, .008, 6); const sd = i * 13.7; vc.el([1, .9, .7], .9, 9, t => hsh(Math.floor(t * 4 + sd)) > .3 ? 1 : .12).ball(TOP, .05, tipP[0], tipP[1], tipP[2]); }
    // ---- planting + uplights + ground glow
    for (const ux of [-1.9, 2.2]) { k.cyl('metal_dark', .09, .07, .18, ux, .8, .5, { seg: 10, rx: -.5 }); vc.el([1, .82, .55], .4, 8).quad(TOP, A.g_round, .15, .15, ux, .86, .46, { rx: -PI / 2 - .5 + PI }); }
    ad.el([1, .45, .4], 0, .34).quad(TOP, A.g_round, 20, 20, .3, .05, 0, { rx: -PI / 2 });
    k.pop();
    shrub(C, sx0 - .9, .7, sz0 + .1, .5, 'sg1'); shrub(C, sx0 + 2.0, .7, sz0 - .1, .42, 'sg2'); spiky(C, sx0 + .3, .7, sz0 + .15, .7, 'sg3'); spiky(C, sx0 - 2.0, .7, sz0 - .2, .5, 'sg4'); weeds(C, sx0 + 1.2, .7, sz0 + .3, 'sgw');
  }

  /* ================================================================== pool */
  const WATER_VS = 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
  const WATER_FS = `
    uniform float uT, uLamp; uniform vec3 uSunDir, uSunCol, uSky, uHor, uAmb; uniform vec4 uBox; varying vec3 vW;
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    float wave(vec2 p){ return vn(p * 1.6 + vec2(uT * .32, uT * .2)) * .58 + vn(p * 3.7 + vec2(-uT * .45, uT * .38)) * .28 + vn(p * 8.3 + vec2(uT * .6, -uT * .52)) * .14; }
    float caust(vec2 p){ float a = 1. - abs(2. * vn(p * 2.3 + vec2(uT * .28, -uT * .21)) - 1.), b = 1. - abs(2. * vn(p * 2.9 + vec2(-uT * .24, uT * .3) + 7.3) - 1.), c = 1. - abs(2. * vn(p * 5.1 + vec2(uT * .2, uT * .17) + 3.1) - 1.);
      return pow(a * b, 2.2) * 2.6 + pow(a * c, 3.) * 1.2 + .22; }
    void main(){
      vec3 V = normalize(vW - cameraPosition); vec2 p = vW.xz; float dist = length(vW - cameraPosition), e = .05, amp = .05 / (1. + dist * .02);
      float h0 = wave(p), hx = wave(p + vec2(e, 0.)), hz = wave(p + vec2(0., e));
      vec3 N = normalize(vec3(-(hx - h0) / e * amp, 1., -(hz - h0) / e * amp));
      float cosi = clamp(dot(-V, N), 0., 1.), F = .02 + .98 * pow(1. - cosi, 5.);
      vec3 R = reflect(V, N); R.y = abs(R.y);
      vec3 refl = mix(uHor, uSky, pow(clamp(R.y, 0., 1.), .45));
      float sd = max(dot(R, uSunDir), 0.); refl += uSunCol * (pow(sd, 700.) * 30. + pow(sd, 40.) * .35);
      vec3 Rf = refract(V, N, .752); vec3 o = vec3(p.x - uBox.x, 0., p.y - uBox.y);
      float dA = 1.75, dB = 1.3 / (2. * uBox.z);
      float tF = -(dA + dB * o.x) / (Rf.y + dB * Rf.x - 1e-4);
      float tX = ((Rf.x > 0. ? uBox.z : -uBox.z) - o.x) / (abs(Rf.x) < 1e-4 ? 1e-4 : Rf.x), tZ = ((Rf.z > 0. ? uBox.w : -uBox.w) - o.z) / (abs(Rf.z) < 1e-4 ? 1e-4 : Rf.z);
      float t = min(tF, min(tX, tZ)); vec3 hit = o + Rf * t; vec3 alb = vec3(.6, .86, .9); vec3 nH = vec3(0., 1., 0.); vec2 tuv;
      if (t == tF) { tuv = hit.xz; float lane = smoothstep(.16, .13, abs(hit.z)) * step(abs(hit.x), uBox.z - 1.2); vec2 tg = abs(fract(hit.xz / .15) - .5); float grout = smoothstep(.44, .49, max(tg.x, tg.y));
        alb = mix(alb, vec3(.05, .16, .42), lane); alb *= 1. - .25 * grout * lane; float drain = smoothstep(.2, .17, length(hit.xz - vec2(uBox.z - 1.3, 0.))); alb = mix(alb, vec3(.5, .52, .5), drain);
        alb *= .9 + .1 * vn(hit.xz * 3.); }
      else { bool wx = (t == tX); tuv = wx ? hit.zy : hit.xy; nH = wx ? vec3(-sign(Rf.x), 0., 0.) : vec3(0., 0., -sign(Rf.z));
        float band = step(-.3, hit.y); vec2 tg = abs(fract(tuv / .075) - .5); float grout = smoothstep(.4, .48, max(tg.x, tg.y)); vec3 tile = mix(vec3(.08, .3, .55), vec3(.14, .45, .66), h21(floor(tuv / .075)));
        alb = mix(alb, mix(tile, vec3(.7, .78, .8), grout), band); alb *= .92 - .1 * smoothstep(-.4, -2.6, hit.y); }
      float ca = caust(tuv + hit.y * .35);
      float sunK = clamp(uSunDir.y * 3.5, 0., 1.); float caA = mix(1., ca, .18 + .5 * sunK);
      vec3 lit = alb * (uAmb * caA + uSunCol * max(uSunDir.y * 1.3 + .02, 0.) * ca * max(nH.y, .35));
      vec3 Lp = vec3(uBox.z - .04, -1.0, 0.); float dL = length(hit - Lp); vec3 lampC = vec3(.62, 1., .95) * uLamp;
      lit += alb * lampC * (1.6 / (1. + dL * dL * .16)) * (.8 + .2 * ca);
      float lens = smoothstep(.2, .16, dL) ; lit += lampC * lens * 6.;
      float path = t + max(-hit.y, 0.) * .9; vec3 tr = exp(-path * vec3(.52, .085, .05));
      vec3 refr = lit * tr; vec3 mid = o + Rf * t * .5; float dM = length(mid - Lp);
      refr += vec3(.03, .34, .42) * (1. - exp(-t * .3)) * (uAmb * .8 + lampC * (1.2 / (1. + dM * dM * .1)));
      gl_FragColor = vec4(mix(refr, refl, F), 1.);
      #include <encodings_fragment>
    }`;
  function pool(C) {
    const { k, vc, ad, A, M } = C, Pp = L.pool, hx = Pp.w / 2, hz = Pp.d / 2, px = Pp.x, pz = Pp.z, AL = 'aluminium_brushed', W = 'metal_painted_white';
    const ix0 = px - 11.4, ix1 = px + 9.4, iz0 = pz - 6.6, iz1 = pz + 6.6, fx0 = ix0 + .4, fx1 = ix1 - .4, fz0 = iz0 + .4, fz1 = iz1 - .4;
    // deck = four slabs around the basin (so the water plane can sit below deck level)
    k.box(M.deck, ix1 - ix0, G, pz - hz - iz0, (ix0 + ix1) / 2, G / 2, (iz0 + pz - hz) / 2, { bevel: .025 }); k.box(M.deck, ix1 - ix0, G, iz1 - pz - hz, (ix0 + ix1) / 2, G / 2, (iz1 + pz + hz) / 2, { bevel: .025 });
    k.box(M.deck, px - hx - ix0, G, Pp.d, (ix0 + px - hx) / 2, G / 2, pz); k.box(M.deck, ix1 - px - hx, G, Pp.d, (ix1 + px + hx) / 2, G / 2, pz);
    { const r = GT.rng('pooldeck'); for (let i = 0; i < 14; i++) { const a = r() * TAU, d = 1 + r() * 1.6, x = px + Math.cos(a) * (hx + d) * (r() < .5 ? 1 : .6), z = pz + Math.sin(a) * (hz + d); if (Math.abs(x - px) < hx + .5 && Math.abs(z - pz) < hz + .5) continue; if (x < fx0 + 2.2 || x > fx1 - .4 || z < fz0 + .3 || z > fz1 - .3) continue; k.decal(i % 3 ? 'water_stain' : 'puddle', .8 + r() * 1.4, .7 + r() * 1.2, x, G + .0025, z, r() * TAU); }
      for (let i = 0; i < 5; i++) k.decal(i % 2 ? 'crack' : 'grime_streak', 1 + r(), 2 + r() * 2, px - hx - 1 - r() * 2.5 + (i > 2 ? 16 : 0), G + .002, pz - 5 + r() * 10, r() * TAU); }
    // coping + waterline tile
    const cw = .38, cy = G + .012; k.box('terrazzo', Pp.w + cw * 2, .065, cw, px, cy, pz - hz - cw / 2 + .04, { bevel: .025 }); k.box('terrazzo', Pp.w + cw * 2, .065, cw, px, cy, pz + hz + cw / 2 - .04, { bevel: .025 }); k.box('terrazzo', cw, .065, Pp.d - .08, px - hx - cw / 2 + .04, cy, pz, { bevel: .025 }); k.box('terrazzo', cw, .065, Pp.d - .08, px + hx + cw / 2 - .04, cy, pz, { bevel: .025 });
    k.box(M.tileB, Pp.w, .14, .02, px, .075, pz - hz + .03); k.box(M.tileB, Pp.w, .14, .02, px, .075, pz + hz - .03); k.box(M.tileB, .02, .14, Pp.d, px - hx + .03, .075, pz); k.box(M.tileB, .02, .14, Pp.d, px + hx - .03, .075, pz);
    for (const [sx, sz] of [[px - 2.5, pz - hz - .55], [px + 3.5, pz + hz + .55]]) { k.cyl('plastic_white', .15, .15, .012, sx, G + .006, sz, { seg: 14 }); k.decal('water_stain', 1.3, 1.1, sx, G + .004, sz); }
    aquad(k, C.lit, A.d3, .3, .15, px - hx + 1.2, G + .047, pz - hz - .14, { rx: -PI / 2 }); aquad(k, C.lit, A.d5, .3, .15, px, G + .047, pz - hz - .14, { rx: -PI / 2 }); aquad(k, C.lit, A.d8, .3, .15, px + hx - 1.2, G + .047, pz - hz - .14, { rx: -PI / 2 }); aquad(k, C.lit, A.nodive, .6, .15, px - hx + 2, G + .047, pz + hz + .14, { rx: -PI / 2, ry: PI });
    aquad(k, C.lit, A.d8, .3, .15, px + hx - 1.2, G + .047, pz + hz + .14, { rx: -PI / 2, ry: PI });
    // ladder (deep end), handrail (shallow end), float line
    for (const lx of [px + 4.0, px + 4.5]) { k.tube('chrome', [[lx, G, pz + hz + .62], [lx, G + .72, pz + hz + .62], [lx, G + .9, pz + hz + .42], [lx, G + .74, pz + hz + .12], [lx, .04, pz + hz - .06]], .021, { seg: 8, tension: .3, steps: 26 }); k.cyl('chrome', .045, .045, .02, lx, G + .01, pz + hz + .62, { seg: 10 }); }
    k.tube('chrome', [[px - hx - .9, G, pz], [px - hx - .9, G + .78, pz], [px - hx - .6, G + .92, pz], [px - hx + .2, G + .66, pz], [px - hx + .75, .04, pz]], .021, { seg: 8, tension: .3, steps: 26 }); k.cyl('chrome', .045, .045, .02, px - hx - .9, G + .01, pz, { seg: 10 });
    { const fxp = px - 1.5; k.cyl('plastic_white', .009, .009, Pp.d - .1, fxp, .082, pz, { rx: PI / 2, seg: 5 }); for (let i = 0; i < 13; i++) k.sphere(i % 2 ? M.tileB : 'plastic_white', .06, fxp, .085, pz - hz + .4 + i * (Pp.d - .8) / 12, { s: [1, .8, 1.3], seg: 8, seg2: 6 }); for (const s of [-1, 1]) k.cyl('chrome', .02, .02, .05, fxp, .12, pz + s * (hz - .02), { rx: PI / 2, seg: 8 }); }
    // water
    const wm = new T.ShaderMaterial({ vertexShader: WATER_VS, fragmentShader: WATER_FS, uniforms: { uT: { value: 0 }, uLamp: { value: 0 }, uSunDir: { value: new T.Vector3(-.8, .2, .2) }, uSunCol: { value: new T.Color(1, .7, .4) }, uSky: { value: new T.Color(.3, .4, .6) }, uHor: { value: new T.Color(.8, .6, .45) }, uAmb: { value: new T.Color(.4, .4, .45) }, uBox: { value: new T.Vector4(px, pz, hx, hz) } } });
    const wg = new T.PlaneGeometry(Pp.w, Pp.d); wg.rotateX(-PI / 2); wg.translate(px, .082, pz); C.water = new T.Mesh(wg, wm); C.water.name = 'motel_pool_water';
    ad.el([.3, .95, .9], 0, .2).quad(null, A.g_round, 24, 17, px, G + .03, pz, { rx: -PI / 2 });
    // fence (aluminium pickets), gate ajar, signs
    const post = (x, z) => { ubox(k, W, .055, 1.5, .055, x, G + .75, z, { bevel: .008 }); k.box(W, .07, .012, .07, x, G + 1.506, z); };
    const fence = (x0, z0, x1, z1) => { const along = Math.abs(x1 - x0) > Math.abs(z1 - z0), a0 = along ? x0 : z0, a1 = along ? x1 : z1, c = along ? z0 : x0, len = a1 - a0, n = Math.round(Math.abs(len) / 2.1);
      for (let i = 0; i <= n; i++) along ? post(a0 + len * i / n, c) : post(c, a0 + len * i / n);
      const np = Math.round(Math.abs(len) / .11), mid = (a0 + a1) / 2, al = Math.abs(len); for (const yy of [G + 1.36, G + .14]) along ? ubox(k, W, al, .035, .03, mid, yy, c) : ubox(k, W, .03, .035, al, c, yy, mid);
      for (let i = 0; i < np; i++) { const p = a0 + (i + .5) * len / np; along ? ubox(k, W, .015, 1.32, .015, p, G + .76, c) : ubox(k, W, .015, 1.32, .015, c, G + .76, p); }
      GT.world.addBox(Math.min(x0, x1) - .05, Math.min(z0, z1) - .05, Math.max(x0, x1) + .05, Math.max(z0, z1) + .05, 1.5, 'motel-poolfence'); };
    const gx0 = px + 4.6, gx1 = px + 5.8;
    fence(fx0, fz0, gx0, fz0); fence(gx1, fz0, fx1, fz0); fence(fx1, fz0, fx1, fz1); fence(fx0, fz1, fx1, fz1); fence(fx0, fz0, fx0, fz1);
    k.push(gx1, 0, fz0, { ry: PI + .62 }); for (const yy of [G + 1.36, G + .14]) k.box(W, 1.16, .035, .03, .6, yy, 0); k.box(W, .04, 1.34, .04, .03, G + .78, 0); k.box(W, .04, 1.34, .04, 1.17, G + .78, 0); for (let i = 0; i < 9; i++) ubox(k, W, .015, 1.22, .015, .14 + i * .115, G + .75, 0);
    k.box('metal_dark', .09, .12, .05, 1.14, G + 1.05, .03, { bevel: .008 }); aquad(k, C.lit, A.gate, .64, .12, .6, G + .98, .02); aquad(k, C.lit, A.gate, .64, .12, .6, G + .98, -.02, { ry: PI }); k.pop();
    const bx = gx0 - 1.6, by = G + 1.02; k.box(AL, 1.16, .74, .012, bx, by, fz0 - .03, { bevel: .004 });
    aquad(k, C.lit, A.lifeguard, 1.1, .24, bx, by + .22, fz0 - .038, { ry: PI }); aquad(k, C.lit, A.onduty, 1.1, .24, bx, by - .02, fz0 - .038, { ry: PI }); aquad(k, C.lit, A.ownrisk, 1.1, .17, bx, by - .24, fz0 - .038, { ry: PI });
    { const nx = px - 2.6; k.box(AL, 1.16, .74, .012, nx, by, fz1 - .03, { bevel: .004 }); aquad(k, C.lit, A.lifeguard, 1.1, .24, nx, by + .22, fz1 - .038, { ry: PI }); aquad(k, C.lit, A.onduty, 1.1, .24, nx, by - .02, fz1 - .038, { ry: PI }); aquad(k, C.lit, A.ownrisk, 1.1, .17, nx, by - .24, fz1 - .038, { ry: PI }); k.quad(GT.decalMat('rust_run'), .3, .5, nx - .4, by - .5, fz1 - .04, { ry: PI }); }
    k.box(AL, .92, .16, .012, bx - 3.4, by + .1, fz0 - .03); aquad(k, C.lit, A.hours, .9, .14, bx - 3.4, by + .1, fz0 - .038, { ry: PI });
    { const tg = new T.TorusGeometry(.3, .065, 8, 20); k.geo('plastic_white', tg, { x: fx1 - .06, y: G + .95, z: pz + 1.5, ry: PI / 2 }); for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; k.box('plastic_red', .1, .15, .15, fx1 - .06, G + .95 + Math.sin(a) * .3, pz + 1.5 + Math.cos(a) * .3, { rx: -a, bevel: .03 }); } }
    // planting bed inside the west fence + pots
    planter(C, fx0 + .25, fz0 + .5, fx0 + 1.9, fz1 - .5, .32, 'motel-poolbed', G); palm(C, fx0 + 1.05, G + .28, pz - 3.6, 6.2, 'pool1'); palm(C, fx0 + 1.1, G + .28, pz + 3.2, 7.4, 'pool2');
    for (let i = 0; i < 6; i++) { const zz = fz0 + 1.3 + i * 2.0; if (Math.abs(zz - (pz - 3.6)) < .7 || Math.abs(zz - (pz + 3.2)) < .7) continue; (i % 2 ? spiky : shrub)(C, fx0 + 1.05, G + .28, zz, i % 2 ? .6 : .55, 'pb' + i); }
    // loungers, umbrellas, side tables
    const lxx = px - hx - 2.2; [[-4.3, 0], [-2.7, 1], [1.5, 0], [3.2, 0]].forEach(([dz, tw], i) => P.lounger(C, lxx, G, pz + dz, (hsh(i) - .5) * .12, M.teal, tw));
    P.lounger(C, px - 2.2, G, pz + hz + 1.6, -PI / 2 + .06, M.teal, 0); P.lounger(C, px + .2, G, pz + hz + 1.7, -PI / 2 - .05, M.teal, 1);
    P.umbrella(C, lxx - .1, G, pz - 3.5, 1); P.umbrella(C, lxx, G, pz + 2.35, 2); P.umbrella(C, px - 1.0, G, pz + hz + 2.1, 3); P.sideTable(k, lxx + .2, G, pz - 1.85); P.sideTable(k, lxx + .1, G, pz + 4.2);
    k.box(M.towel, .5, .03, .7, px + hx + 1.3, G + .015, pz - 1.2, { bevel: .01, ry: .3 }); k.decal('puddle', 1.6, 1.2, px + hx + 1.0, G + .003, pz + .6, .5); k.decal('puddle', .9, .7, px - 2, G + .003, pz - hz - 1.1, 1.2); k.decal('water_stain', 2.5, 2, lxx + 1.2, G + .002, pz + .5); k.decal('crack', 3, 1.2, px + 2, G + .002, pz - hz - 1.5, .3);
    P.trashCan(k, gx1 + .7, G, fz0 + .5);
  }

  /* ================================================================== grounds: lot surface, stalls, kerbs, planters, wall, dumpster corral */
  function grounds(C) {
    const { k, A } = C, r = GT.rng('motel-lot'), WP = 'road_paint_white';
    k.box('asphalt_worn', L.x1 - L.x0, .04, L.z1 - L.z0, (L.x0 + L.x1) / 2, 0, (L.z0 + L.z1) / 2);
    const paint = (w, d, x, z, ry) => k.box(WP, w, .012, d, x, .026, z, ry ? { ry } : undefined);
    // hairpin stall lines in front of the east wing (cars face +X)
    const zs = [...new Set(L.parking.flatMap(p => [p[1] - 2, p[1] + 2]))];
    for (const z of zs) { for (const s of [-.24, .24]) paint(5.5, .09, 62.05, z + s); for (let i = 0; i <= 5; i++) { const a = PI / 2 + i * PI / 5, a2 = PI / 2 + (i + .5) * PI / 5; if (i < 5) paint(.16, .09, 59.3 + Math.cos(a2) * .24, z + Math.sin(a2) * .24, -(a2 + PI / 2)); void a; } }
    L.parking.forEach((p, i) => { P.wheelStop(k, 64.5, p[1] + (r() - .5) * .1, PI / 2 + (r() - .5) * .06, i === 5);
      k.decal('oil_stain', 1.1 + r() * .9, 1.1 + r() * .9, 62.6 + r() * .9, .034, p[1] + (r() - .5) * .6, r() * TAU); if (r() < .6) k.decal('oil_stain', .6 + r() * .5, .6 + r() * .5, 61 + r(), .035, p[1] + (r() - .5), r() * TAU);
      if (r() < .5) k.decal('tire_marks', 1.9, 4.5, 60.5 + r(), .033, p[1], PI / 2 + (r() - .5) * .2); GT.world.anchor('swapSpot' + i, { x: p[0], z: p[1], h: PI / 2 }); });
    k.decal('handicap', 1.5, 1.5, 61.6, .036, 96, -PI / 2);
    // single-line stalls facing the north wing
    for (let i = 0; i <= 8; i++) paint(.1, 5.4, 36.4 + i * 2.8, 107.7); for (let i = 0; i < 8; i++) { P.wheelStop(k, 37.8 + i * 2.8, 109.95, (r() - .5) * .06, false); if (r() < .7) k.decal('oil_stain', .9 + r(), .9 + r(), 37.8 + i * 2.8 + (r() - .5) * .5, .034, 108.4 + r() * .8, r() * TAU); }
    k.box('curb_paint_yellow', 11, G + .012, .16, 27.5, (G + .012) / 2, 110.56, { bevel: .02 });
    k.decal('arrow', 1.4, 3.2, 19.5, .034, 63.6, -PI / 2); k.decal('arrow', 1.4, 3.2, 19.5, .034, 60.4, PI / 2);
    for (let i = 0; i < 4; i++) k.decal('tire_marks', 2, 7 + r() * 3, 22 + i * 7 + r() * 3, .033, 61.5 + (r() - .5) * 3, PI / 2 + (r() - .5) * .5);
    // cracks with weeds, patches, puddles
    const blocked = (x, z) => (x > 30.5 && x < 55.5 && z > 75.5 && z < 92.5) || x > 64.5 || z > 110 || (x < 22 && z < 54);
    for (let i = 0; i < 20; i++) { const x = 17 + r() * 46, z = 51 + r() * 58, ry = r() * PI, len = 2.5 + r() * 3.5; if (blocked(x, z)) continue; k.decal('crack', 1.2 + r(), len, x, .0335, z, ry);
      for (let j = 0, n = 1 + (r() * 4 | 0); j < n; j++) { const u = (r() - .5) * len * .8; weeds(C, x + Math.sin(ry) * u, .02, z + Math.cos(ry) * u, 'c' + i + '_' + j); } }
    for (const [x, z, w, d, ry] of [[52, 99, 2.6, 3.6, 1.4], [24, 92, 2.2, 1.8, .6]]) k.decal('patch', w, d, x, .033, z, ry);
    // speed bump across the drive aisle (worn yellow chevrons), storm drain by the pool island, manhole
    { const bx = 31.5; for (let i = 0; i < 15; i++) k.box(i % 2 ? 'asphalt_worn' : 'curb_paint_yellow', .44, .075, .76, bx, .05, 56.68 + i * .76, { bevel: .032 });
      k.decal('tire_marks', 1.8, 5, bx + 2.6, .034, 61.2, PI / 2); k.decal('tire_marks', 1.8, 4, bx - 2.4, .034, 63.4, PI / 2);
      k.box('metal_dark', .9, .03, .5, 56.0, .022, 79.5, { bevel: .008 }); for (let i = 0; i < 9; i++) k.box('metal_rust', .05, .034, .44, 55.64 + i * .09, .024, 79.5); k.decal('leak', 2.2, 2.6, 56.2, .034, 80.2, 1.2); k.decal('water_stain', 3.5, 3, 56, .0335, 79.4);
      k.cyl('metal_dark', .38, .38, .02, 44, .026, 70.5, { seg: 20 }); k.cyl('metal_rust', .42, .42, .012, 44, .022, 70.5, { seg: 20 }); for (let i = 0; i < 6; i++) k.box('metal_rust', .6, .024, .03, 44, .028, 70.5, { ry: i * PI / 6 }); k.decal('crack', 1.2, 2.6, 44.6, .0335, 71.4, .8); }
    k.decal('puddle', 3.2, 2.2, 23.5, .036, 55.5, .4); k.decal('puddle', 2.4, 1.5, 56.8, .036, 82.5, 1.2); k.decal('puddle', 1.8, 1.4, 34.5, .036, 104.5, 2.2);
    for (let i = 0; i < 26; i++) weeds(C, 65.14 - r() * .12, .02, 56 + r() * 52, 'k' + i);
    // west boundary strip (highway side) with palms; drive opening z 56..68
    planter(C, 14, 68.5, 15.5, 131.4, .2, 'motel-strip'); planter(C, 14, 48.5, 15.5, 49.8, .2, 'motel-strip'); planter(C, 14, 52.6, 15.5, 55.6, .2, 'motel-strip');
    [72, 84.5, 98, 111, 125].forEach((z, i) => palm(C, 14.75, .16, z, 7.2 + hsh(i * 3.1) * 2.6, 'w' + i));
    for (let z = 69.5, i = 0; z < 131; z += 2.1 + hsh(i) * 1.6, i++) { if ([72, 84.5, 98, 111, 125].some(pz => Math.abs(pz - z) < .9)) continue; (hsh(i * 7.7) < .3 ? spiky : shrub)(C, 14.75, .16, z, .42 + hsh(i * 2.3) * .22, 'ws' + i); }
    shrub(C, 14.75, .16, 54.1, .55, 'ws-a'); spiky(C, 14.75, .16, 49.1, .5, 'ws-b');
    // planters along the east wing walk
    [[56, 63.2], [67, 78.6], [93.4, 101.6], [105.6, 110]].forEach(([z0, z1], i) => { planter(C, 66.0, z0, 68.6, z1, .34, 'motel-planter', G); palm(C, 67.3, G + .3, (z0 + z1) / 2 + (hsh(i) - .5) * 2, 6.4 + hsh(i * 5.5) * 2.2, 'e' + i);
      for (let z = z0 + .9, j = 0; z < z1 - .6; z += 1.5, j++) { if (Math.abs(z - (z0 + z1) / 2) < .8) continue; (hsh(i * 11 + j * 3.7) < .35 ? spiky : shrub)(C, 67.3 + (hsh(j * 1.7 + i) - .5) * .8, G + .3, z, .45 + hsh(j + i * 9.1) * .2, 'ep' + i + '_' + j); } });
    // planters in front of the north wing
    [[43.2, 58.2], [62, 70.6]].forEach(([x0, x1], i) => { planter(C, x0, 111.0, x1, 112.5, .34, 'motel-planter', G); palm(C, (x0 + x1) / 2, G + .3, 111.75, 6.8 + i * 1.3, 'n' + i);
      for (let x = x0 + .9, j = 0; x < x1 - .6; x += 1.45, j++) { if (Math.abs(x - (x0 + x1) / 2) < .8) continue; (hsh(i * 13 + j * 2.9) < .3 ? spiky : shrub)(C, x, G + .3, 111.75, .42 + hsh(j * 3.3 + i) * .2, 'np' + i + '_' + j); } });
    // south boundary wall (toward the gas station) + grime + tags
    k.box('cinderblock', 70, 1.0, .2, 57, .5, 48.3); k.box('concrete_stained', 70.1, .06, .28, 57, 1.03, 48.3, { bevel: .015 }); GT.world.addBox(22, 48.2, 92, 48.4, 1.1, 'motel-wall');
    for (let i = 0; i < 12; i++) k.quad(GT.decalMat('grime_streak'), 1 + r() * 1.5, .9, 24 + r() * 60, .5, 48.405);
    k.quad(GT.decalMat('graffiti_a'), 2.6, .9, 51, .52, 48.406); k.quad(GT.decalMat('graffiti_a'), 1.8, .8, 31, .5, 48.406);
    for (let i = 0; i < 16; i++) weeds(C, 23 + r() * 65, .02, 48.5 + r() * .12, 'sw' + i);
    // dumpster corral
    { const x0 = 37.6, x1 = 43.4, z0 = 48.5, z1 = 52.3, h = 1.9; k.box('cinderblock', .2, h, z1 - z0, x0, h / 2, (z0 + z1) / 2); k.box('cinderblock', .2, h, z1 - z0, x1, h / 2, (z0 + z1) / 2); k.box('cinderblock', x1 - x0, h, .2, (x0 + x1) / 2, h / 2, z0 + .1);
      for (const [w, d, x, z] of [[.28, z1 - z0 + .08, x0, (z0 + z1) / 2], [.28, z1 - z0 + .08, x1, (z0 + z1) / 2]]) k.box('concrete_stained', w, .06, d, x, h + .03, z, { bevel: .015 });
      GT.world.addBox(x0 - .1, z0, x1 + .1, z1, h, 'motel-dumpster');
      for (const [hxp, ang, s] of [[x0 + .12, -1.25, 1], [x1 - .12, PI + 1.5, -1]]) { k.push(hxp, 0, z1, { ry: ang }); k.box('metal_dark', .06, 1.75, .06, .03, .95, 0); k.box('metal_dark', 2.7, .05, .05, 1.38, 1.78, 0); k.box('metal_dark', 2.7, .05, .05, 1.38, .12, 0); k.box('metal_dark', .05, 1.7, .05, 2.72, .95, 0); ubox(k, C.M.teal, 2.62, 1.6, .012, 1.38, .95, 0); for (const rx of [.7, 1.38, 2.06]) k.box('metal_dark', .04, 1.6, .03, rx, .95, 0); rod(k, 'metal_dark', [.06, .14, .03], [2.7, 1.76, .03], .014); k.pop(); void s; }
      k.push(40.5, .02, 50.2, { ry: .06 }); const DB = 'metal_painted_blue'; k.box(DB, 2.0, 1.15, 1.5, 0, .72, 0, { bevel: .03 }); for (const sx of [-.7, 0, .7]) k.box(DB, .07, 1.05, .05, sx, .72, .765, { bevel: .01 }); for (const s of [-1, 1]) { k.box(DB, .1, .14, 1.3, s * 1.06, .78, 0, { bevel: .01 }); k.box('metal_rust', .09, .05, 1.2, s * 1.0, .2, 0); }
      for (const [lx, lz] of [[-.8, -.55], [.8, -.55], [-.8, .55], [.8, .55]]) k.cyl('rubber', .07, .07, .05, lx, .07, lz, { rx: PI / 2, seg: 10 });
      k.box('plastic_black', .98, .035, 1.56, -.5, 1.32, 0, { bevel: .012 }); k.box('plastic_black', .98, .035, 1.56, .52, 1.62, -.5, { bevel: .012, rx: -.75 }); rod(k, 'metal_galv', [-1, 1.3, -.72], [1, 1.3, -.72], .018);
      aquad(k, C.lit, A.haul, 1.3, .27, 0, .86, .768); k.quad(GT.decalMat('rust_run'), .5, .9, -.55, .6, .769); k.quad(GT.decalMat('rust_run'), .4, .7, .6, .52, .769); k.quad(GT.decalMat('grime_streak'), 1.2, .8, .2, .62, .7695);
      k.sphere('plastic_black', .3, 1.45, .2, .5, { s: [1, .75, .9], seg: 10, seg2: 8 }); k.sphere('plastic_black', .26, 1.55, .17, -.15, { s: [.9, .7, 1], seg: 10, seg2: 8 }); k.sphere('plastic_white', .22, -1.4, .15, .55, { s: [1, .7, .9], seg: 10, seg2: 8 }); k.pop();
      k.decal('leak', 2.2, 2.6, 40.6, .034, 52.2, .2); k.decal('oil_stain', 1.5, 1.5, 41.5, .035, 53.3, 1); k.quad(GT.decalMat('graffiti_a'), 1.6, .8, x0 - .102, 1.0, 50.4, { ry: -PI / 2 }); k.quad(GT.decalMat('grime_streak'), 1.5, 1.2, x1 + .102, .7, 50.6, { ry: PI / 2 }); }
    // guest parking signs on posts at the kerb
    for (const [z, key, w, h] of [[80.2, 'guests', .6, .15], [92, 'tow', .6, .115]]) { k.box('metal_galv', .05, 2.1, .05, 65.6, G + 1.05, z); k.box('metal_painted_white', .02, h + .06, w + .06, 65.57, G + 1.85, z, { bevel: .004 }); aquad(k, C.lit, A[key], w, h, 65.558, G + 1.85, z, { ry: -PI / 2 }); }
    P.lotLight(C, 67.3, 77.6, PI); P.lotLight(C, 14.75, 69.6, 0); P.lotLight(C, 60.2, 111.75, PI * 1.5);
    P.trolley(C, 57.2, .02, 92.2, .5); P.bike(C, 71.72, G, 90.6, PI / 2, -.2, 'plastic_red'); P.bike(C, 71.66, G, 92.3, -PI / 2 + .1, .22, 'metal_painted_blue');
  }

  /* ================================================================== assemble both wings */
  function buildings(C) {
    const { k, vc, ad, A, M } = C, AL = 'aluminium_brushed', W = 'metal_painted_white', D = 12;
    // ---------- east wing (long bar facing the lot / the sunset)
    const eRooms = []; let num = 101;
    for (let i = 0; i < 8; i++) eRooms.push({ x: i * PITCH, y: G, mir: i % 2 === 1, num: num++ }); for (let i = 0; i < 7; i++) eRooms.push({ x: 33.3 + i * PITCH, y: G, mir: i % 2 === 0, num: num++ });
    num = 201; for (let i = 0; i < 16; i++) eRooms.push({ x: i * PITCH, y: F2, mir: i % 2 === 1, num: num++ });
    const ePosts = []; for (let i = 0; i <= 16; i++) ePosts.push(i * PITCH + (i === 0 ? .12 : 0));
    wing(C, { ox: 74, oz: 54, ry: -PI / 2, len: 62, bodyLen: 74, depth: D, lower: [[0, 29.6, -D, 0], [29.6, 33.3, -D, -2.2], [33.3, 74, -D, 0]], walk: [-.6, 62, 8.8], deck: [0, 60.1], rail: [.2, 60.1], posts: ePosts, rooms: eRooms, roofBody: [-.5, 74.3], roofEave: [-.5, 59.65], roofEnds: [-.5], stair: 27.6,
      extra(k, TOP) {
        // south end: pink fin wall + breeze-block screen closing the balcony end; meters, conduit, wall pack
        k.box('stucco_pink', .3, RU + .7, D + .3, -.15, (RU + .7) / 2, -D / 2 - .05); k.box('concrete_stained', .36, .06, D + .36, -.15, RU + .73, -D / 2 - .05, { bevel: .015 });
        k.push(-.15, G, .0, { ry: -PI / 2 }); breeze(k, BAL + .1, RU - G - .0); k.pop();
        for (let i = 0; i < 6; i++) k.quad(GT.decalMat(i % 2 ? 'water_stain' : 'grime_streak'), 1 + hsh(i) * 1.2, 2.4 + hsh(i * 3) * 2, -.301, RU - .6 - hsh(i * 3) * .9, -1 - i * 1.9, { ry: -PI / 2 });
        for (let i = 0; i < 5; i++) { const zz = -2.2 - i * .42; k.box('metal_galv', .14, .34, .3, -.37, 1.5, zz, { bevel: .012 }); k.sphere('glass_clear', .085, -.44, 1.56, zz, { seg: 10, seg2: 8 }); k.cyl('metal_galv', .014, .014, 1.2, -.33, .75, zz, { seg: 6 }); }
        k.box('metal_galv', .16, .6, .5, -.38, 1.6, -4.7, { bevel: .012 }); k.cyl('metal_galv', .03, .03, 4.6, -.34, 4.2, -4.7, { seg: 8 }); k.box('metal_galv', .12, .08, 2.4, -.36, 1.95, -3.2, { bevel: .01 });
        k.box('metal_dark', .14, .2, .32, -.37, 5.2, -8, { bevel: .02 }); vc.el([1, .82, .55], .5, 8, null, [.85, .85, .8]).quad(TOP, A.g_round, .26, .12, -.39, 5.09, -8, { rx: PI / 2 }); ad.el([1, .7, .4], 0, .4).quad(TOP, A.g_wash, 6, 5.5, -.305, 2.9, -8, { ry: -PI / 2 });
        aquad(k, C.lit, A.sp_Coral, 3.2, 1.44, -.302, 4.75, -6.6, { ry: -PI / 2 }); aquad(k, C.lit, A.sp_Comet, 3.3, 1.48, -.302, 3.85, -9.1, { ry: -PI / 2 });
        // ---- ice + vending alcove under the stair landing
        k.box('concrete', PITCH, G, 2.2, 31.45, G / 2, -1.1); k.box('terrazzo', PITCH - .02, .012, 2.18, 31.45, G + .006, -1.1);
        k.push(29.6, G, 0); const T2 = k.top;
        k.box(AL, .96, 1.78, .78, .68, .93, -1.78, { bevel: .02 }); for (const lx of [.3, 1.06]) k.cyl('metal_dark', .03, .03, .05, lx, .025, -1.5, { seg: 8 }); k.box('plastic_black', .84, .56, .04, .68, .78, -1.375, { bevel: .01, rx: -.22 }); k.box('chrome', .5, .03, .03, .68, 1.0, -1.34, { bevel: .008 });
        aquad(k, C.lit, A.ice, .86, .32, .68, 1.52, -1.388); ad.el([.8, .92, 1], .55, 2.6).quad(T2, A.ice, .86, .32, .68, 1.52, -1.384); k.box('metal_dark', .86, .1, .01, .68, .22, -1.388); k.decal('leak', 1.1, 1.3, .7, .016, -.75);
        k.box('plastic_red', .98, 1.83, .82, 1.84, .915, -1.78, { bevel: .02 }); aquad(k, C.lit, A.vendA, .9, 1.74, 1.84, .93, -1.368); ad.el([1, .86, .7], .5, 3.0, t => .94 + .06 * hsh(Math.floor(t * 24))).quad(T2, A.vendA, .9, 1.74, 1.84, .93, -1.364);
        k.box('plastic_black', .98, 1.83, .82, 2.93, .915, -1.78, { bevel: .02 }); aquad(k, C.lit, A.vendB, .9, 1.74, 2.93, .93, -1.368); ad.el([.9, .95, 1], .45, 2.4).quad(T2, A.vendB, .9, 1.74, 2.93, .93, -1.364);
        k.box(W, 1.3, .07, .16, 1.85, 2.93, -.9, { bevel: .01 }); vc.el([.85, .95, 1], .9, 7, t => hsh(Math.floor(t * 15)) < .08 ? .3 : 1, [.9, .92, .95]).rod(T2, [1.28, 2.88, -.9], [2.42, 2.88, -.9], .017, 6);
        ad.el([.75, .88, 1], 0, .9).quad(T2, A.g_round, 5.6, 6.4, 1.85, .02, .2, { rx: -PI / 2 }); ad.el([.75, .88, 1], 0, .5).quad(T2, A.g_round, 3.6, 3.2, 1.85, 1.9, -2.19).quad(T2, A.g_round, 2.2, 3, .012, 1.6, -1.1, { ry: PI / 2 }).quad(T2, A.g_round, 2.2, 3, PITCH - .012, 1.6, -1.1, { ry: -PI / 2 }); ad.el([1, .5, .3], 0, .35).quad(T2, A.g_round, 2.6, 2.0, 1.9, .022, -.9, { rx: -PI / 2 });
        P.trashCan(k, 3.42, 0, -.42); k.decal('gum_spots', 2, 1.6, 1.8, .017, .5); k.decal('gum_spots', 1.6, 1.4, 2.4, .017, -.8);
        k.box(W, .05, .34, .96, PITCH / 2, 2.72, .5, { bevel: .01 }); aquad(k, C.lit, A.icesn, .9, .225, PITCH / 2 + .026, 2.72, .5, { ry: PI / 2 }); aquad(k, C.lit, A.icesn, .9, .225, PITCH / 2 - .026, 2.72, .5, { ry: -PI / 2 }); rod(k, 'metal_galv', [PITCH / 2, 2.89, .1], [PITCH / 2, 2.89, .9], .012);
        k.pop();
        // ---- laundry (ground) + housekeeping (upper) service doors in the corner bay
        for (const [y, key] of [[G, 'laundry'], [F2, 'maids']]) { const dx = 60.2;
          k.box(W, .07, 2.12, .1, dx - .49, y + 1.06, .04, { bevel: .006 }); k.box(W, .07, 2.12, .1, dx + .49, y + 1.06, .04, { bevel: .006 }); k.box(W, 1.05, .08, .1, dx, y + 2.1, .04, { bevel: .006 }); k.box(W, .91, 2.05, .045, dx, y + 1.035, .032, { bevel: .004 });
          for (let i = 0; i < 7; i++) k.box(W, .56, .016, .02, dx, y + .28 + i * .045, .062, { rx: .5 }); k.box('chrome', .055, .2, .008, dx + .37, y + 1.06, .058); k.box('chrome', .12, .02, .016, dx + .32, y + 1.0, .104, { bevel: .005 });
          k.box(W, .66, .2, .012, dx, y + 2.34, .008); aquad(k, C.lit, A[key], .62, .14, dx, y + 2.34, .0155); k.quad(GT.decalMat('grime_streak'), .9, .6, dx, y + .3, .068, { rz: PI }); }
        for (const vx of [61.15, 61.6]) { k.box('metal_galv', .24, .2, .16, vx, G + 2.2, .08, { bevel: .02 }); k.box('metal_dark', .18, .02, .1, vx, G + 2.1, .1); k.quad(GT.decalMat('grime_streak'), .5, 1.5, vx, G + 1.36, .0095); }
        k.cyl('metal_painted_yellow', .17, .15, .3, 61.3, G + .15, .5, { seg: 12 }); rod(k, 'wood_plank', [61.3, G + .1, .5], [61.75, G + 1.45, .1], .014); k.box(M.towel, .22, .06, .12, 61.3, G + .08, .5, { bevel: .02 });
        // roof clutter: package unit, vents, yagi antenna, dish, cables
        k.box('metal_galv', 1.8, .9, 1.2, 20, RU + .7, -6, { bevel: .03 }); k.cyl('metal_dark', .38, .38, .04, 20, RU + 1.16, -6, { seg: 16 }); k.box('metal_dark', 1.2, .5, .02, 20, RU + .7, -5.39); for (let i = 0; i < 6; i++) k.cyl('metal_galv', .07, .07, .5 + hsh(i) * .3, 6 + i * 11, RU + .45, -3 - hsh(i * 2) * 6, { seg: 8 });
        rod(k, 'metal_galv', [44, RU + .2, -7], [44, RU + 3.6, -7], .025); rod(k, AL, [43.1, RU + 3.3, -7], [45.2, RU + 3.3, -7], .012); for (let i = 0; i < 8; i++) rod(k, AL, [43.2 + i * .27, RU + 3.3, -7 - .5 + i * .03], [43.2 + i * .27, RU + 3.3, -7 + .5 - i * .03], .006, .006, 4);
        for (const g of [[43.2, -6.3], [44.8, -6.3], [44, -8]]) rod(k, 'metal_galv', [44, RU + 2.6, -7], [g[0], RU + .22, g[1]], .004, .004, 4);
        dish(k, 52, RU + .22, 1.3, 2.2); dish(k, 9.5, RU + .22, 1.1, 2.6); k.tube('rubber', [[52, RU + .25, 1.3], [50.5, RU + .25, 1.9], [49, RU + .26, EVC + .12], [48.95, RU + .0, EVC + .13], [48.9, RU - .25, .3], [48.9, RU - .32, .04]], .01, { seg: 5, steps: 24 });
      } });
    GT.world.addBox(74, 54, 86, 128, 7, 'motel-wingE');
    // ---------- north wing (office at the highway end)
    const nRooms = []; num = 116; for (let i = 0; i < 11; i++) nRooms.push({ x: .2 + i * PITCH, y: G, mir: i % 2 === 1, num: num++ }); num = 217; for (let i = 0; i < 14; i++) nRooms.push({ x: .2 + i * PITCH, y: F2, mir: i % 2 === 1, num: num++ });
    const nPosts = [BAL - .02]; for (let i = 1; i <= 14; i++) nPosts.push(.2 + i * PITCH - (i === 14 ? .12 : 0));
    wing(C, { ox: 74, oz: 116, ry: PI, len: 52, bodyLen: 52, depth: D, lower: [[0, 41, -D, 0], [41, 52, -D, -6]], walk: [8.8, 52.6, 5.4], deck: [0, 52], rail: [BAL - .02, 51.8], posts: nPosts, rooms: nRooms, roofBody: [0, 52.5], roofEave: [0, 52.5], roofEnds: [52.5], stair: 33.2,
      extra(k, TOP) {
        // west fin (upper storey + rear) with the ghost sign, breeze-block screen at the balcony end
        k.box('stucco_pink', .3, FH + .7, D + .3, 52.15, F2 + (FH + .7) / 2, -D / 2 - .05); k.box('stucco_pink', .3, F2, 6.2, 52.15, F2 / 2, -9.1); k.box('concrete_stained', .36, .06, D + .36, 52.15, RU + .73, -D / 2 - .05, { bevel: .015 });
        k.push(52.15, F2, 0, { ry: -PI / 2 }); breeze(k, BAL + .1, FH); k.pop();
        aquad(k, C.lit, A.sp_Coral, 4.4, 1.98, 52.302, 5.35, -3.9, { ry: PI / 2 }); aquad(k, C.lit, A.sp_Comet, 4.5, 2.02, 52.302, 4.15, -7.6, { ry: PI / 2 });
        for (let i = 0; i < 7; i++) k.quad(GT.decalMat(i % 2 ? 'water_stain' : 'grime_streak'), 1 + hsh(i * 1.3) * 1.4, 1.8 + hsh(i * 4) * 1.6, 52.301, RU - .3 - hsh(i * 4) * .7, -.9 - i * 1.6, { ry: PI / 2 });
        // ---- office: pink stucco piers over a painted-brick base, storefront glazing, glass door, interior
        const OX0 = 41.25, OX1 = 52, SILL = G + .55, HEAD = G + 2.55, PK = 'stucco_pink', BR = 'brick_painted';
        k.box('stucco_cream', .25, F2, 6, 41.125, F2 / 2, -3);
        k.box(BR, 7.2, SILL, .24, 44.85, SILL / 2, -.1, { bevel: .01 }); k.box(PK, .75, HEAD - SILL, .2, 41.625, (SILL + HEAD) / 2, -.1); k.box(PK, .7, HEAD - SILL, .2, 48.15, (SILL + HEAD) / 2, -.1); k.box(PK, 2.75, HEAD, .2, 50.925, HEAD / 2, -.1); k.box(PK, 11.05, F2 - HEAD, .2, 46.775, (HEAD + F2) / 2, -.1);
        k.box(BR, .34, SILL, 4.0, 52.15, SILL / 2, -3, { bevel: .01 }); k.box(PK, .3, HEAD, 1.0, 52.15, HEAD / 2, -5.5); k.box(PK, .3, HEAD, .8, 52.15, HEAD / 2, -.6); k.box(PK, .3, F2 - HEAD, 6.2, 52.15, (HEAD + F2) / 2, -2.9);
        k.box('concrete', 7.3, .05, .3, 44.85, SILL + .025, -.1, { bevel: .012 }); k.box('concrete', .4, .05, 4.1, 52.15, SILL + .025, -3, { bevel: .012 });
        // front window 42.0..47.8
        const wc = 44.9, wyc = (SILL + .05 + HEAD) / 2, whh = HEAD - SILL - .05; k.box('glass_clear', 5.8, whh, .012, wc, wyc, -.1);
        k.box(AL, 5.8, .05, .08, wc, HEAD - .025, -.1, { bevel: .006 }); k.box(AL, 5.8, .05, .08, wc, SILL + .075, -.1, { bevel: .006 }); for (const mx of [42.025, 43.95, 45.9, 47.775]) k.box(AL, .05, whh, .08, mx, wyc, -.1, { bevel: .006 });
        // door 48.5..49.5
        const dxc = 49.0; k.box(AL, .06, HEAD - G, .08, 48.53, (G + HEAD) / 2, -.1, { bevel: .006 }); k.box(AL, .06, HEAD - G, .08, 49.52, (G + HEAD) / 2, -.1, { bevel: .006 }); k.box(AL, 1.0, .06, .08, dxc, HEAD - .03, -.1); k.box(AL, 1.0, .06, .08, dxc, G + 2.14, -.1);
        k.box(AL, .9, .09, .05, dxc, G + 2.06, -.1); k.box(AL, .9, .22, .05, dxc, G + .13, -.1); k.box(AL, .07, 1.9, .05, 48.6, G + 1.1, -.1); k.box(AL, .07, 1.9, .05, 49.45, G + 1.1, -.1); k.box('glass_clear', .8, 1.72, .01, dxc, G + 1.1, -.1); k.box('glass_clear', .9, .34, .01, dxc, G + 2.35, -.1);
        rod(k, 'chrome', [48.66, G + 1.05, -.05], [49.4, G + 1.05, -.05], .014); k.box('chrome', .03, .03, .06, 48.68, G + 1.05, -.075); k.box('chrome', .03, .03, .06, 49.38, G + 1.05, -.075); k.box(AL, .3, .06, .08, 49.2, G + 2.2, -.04, { bevel: .01 }); k.box('rubber', .95, .016, .6, dxc, G + .008, .45, { bevel: .005 });
        // west window (faces the highway)
        k.box('glass_clear', .012, whh, 4.0, 52.15, wyc, -3); for (const mz of [-1.025, -2.33, -3.67, -4.975]) k.box(AL, .08, whh, .05, 52.15, wyc, mz, { bevel: .006 }); k.box(AL, .08, .05, 4.0, 52.15, HEAD - .025, -3); k.box(AL, .08, .05, 4.0, 52.15, SILL + .075, -3);
        // interior shell
        k.box('terrazzo', OX1 - OX0, .02, 5.9, (OX0 + OX1) / 2, G + .01, -3.05); k.box('stucco_white', OX1 - OX0, .05, 5.9, (OX0 + OX1) / 2, G + 2.84, -3.05); k.box('wood_plank', .03, 2.7, 5.8, OX0 + .015, G + 1.4, -3.05);
        aquad(k, C.lit, A.office, OX1 - OX0, 2.84, (OX0 + OX1) / 2, G + 1.42, -5.99); ad.el([1, .78, .5], 0, 1.0).quad(TOP, A.office, OX1 - OX0, 2.84, (OX0 + OX1) / 2, G + 1.42, -5.985);
        for (const lx of [44, 48.6]) { k.box(W, 1.3, .04, .66, lx, G + 2.8, -2.6); vc.el([1, .9, .72], 1.2, 6, null, [1, .96, .86]).quad(TOP, A.g_round, 1.2, .56, lx, G + 2.778, -2.6, { rx: PI / 2 }); }
        // reception desk, bell, register, lamp, phone, book, key rack
        k.box('wood_plank', 5.0, 1.04, .08, 45.6, G + .52, -3.5); k.box('wood_plank', .08, 1.04, 1.5, 48.1, G + .52, -4.25); k.box('terrazzo', 5.16, .04, .78, 45.6, G + 1.07, -3.82, { bevel: .012 }); k.box('metal_dark', 5.0, .1, .02, 45.6, G + .05, -3.45);
        k.cyl(M.brass, .06, .07, .012, 46.6, G + 1.096, -3.62, { seg: 12 }); k.sphere(M.brass, .052, 46.6, G + 1.1, -3.62, { s: [1, .7, 1], seg: 12, seg2: 8 }); k.cyl(M.brass, .008, .008, .03, 46.6, G + 1.15, -3.62, { seg: 6 }); aquad(k, C.lit, A.bell, .22, .075, 46.95, G + 1.14, -3.6, { rx: -.3 }); k.box('plastic_white', .22, .003, .09, 46.95, G + 1.1, -3.63, { rx: -.3 });
        k.box('metal_dark', .42, .3, .42, 44.3, G + 1.24, -3.85, { bevel: .03 }); k.box('metal_dark', .42, .2, .2, 44.3, G + 1.46, -3.96, { bevel: .03 }); for (let i = 0; i < 15; i++) k.cyl('plastic_white', .014, .014, .02, 44.14 + (i % 5) * .08, G + 1.4, -3.78 + ((i / 5) | 0) * .05, { seg: 6 }); rod(k, 'chrome', [44.52, G + 1.3, -3.85], [44.6, G + 1.5, -3.85], .008);
        k.cyl(M.brass, .06, .08, .02, 47.5, G + 1.1, -3.9, { seg: 10 }); rod(k, M.brass, [47.5, G + 1.1, -3.9], [47.5, G + 1.4, -3.9], .009); k.cyl('metal_dark', .07, .12, .12, 47.5, G + 1.46, -3.9, { seg: 10 }); vc.el([1, .78, .42], 1.0, 6).add(new T.CylinderGeometry(.064, .112, .1, 10, 1, true).translate(47.5, G + 1.455, -3.9), TOP).quad(TOP, A.g_round, .2, .2, 47.5, G + 1.4, -3.9, { rx: PI / 2 });
        ad.el([1, .72, .4], 0, .5).quad(TOP, A.g_round, 1.5, .8, 47.5, G + 1.094, -3.85, { rx: -PI / 2 });
        k.box('plastic_black', .2, .09, .22, 45.3, G + 1.135, -3.9, { bevel: .025 }); k.box('plastic_black', .05, .045, .22, 45.3, G + 1.2, -3.9, { bevel: .018, ry: PI / 2 }); k.box('plastic_white', .34, .025, .26, 46.0, G + 1.103, -3.75, { ry: .15, bevel: .004 });
        k.box('wood_plank', 1.5, 1.0, .03, 45.9, G + 1.75, -5.95, { bevel: .006 }); for (let i = 0; i < 32; i++) { const hx2 = 45.25 + (i % 8) * .185, hy = G + 2.1 - ((i / 8) | 0) * .235; k.cyl(M.brass, .005, .005, .03, hx2, hy, -5.92, { rx: PI / 2, seg: 5 });
          if (hsh(i * 3.7) < .62) { k.box(hsh(i) < .5 ? 'plastic_red' : M.teal, .04, .075, .006, hx2, hy - .075, -5.915, { rz: (hsh(i * 2) - .5) * .3 }); k.box(M.brass, .012, .05, .003, hx2, hy - .025, -5.912); } }
        // lobby: chairs, table, plant, cooler-ish cabinet, mat
        for (const cz of [-1.3, -2.2]) { k.box(M.canvas, .56, .1, .5, 42.1, G + .42, cz, { bevel: .03 }); k.box(M.canvas, .1, .46, .5, 41.82, G + .68, cz, { bevel: .03, rz: .12 }); for (const [lx, lz] of [[-.22, -.2], [.22, -.2], [-.22, .2], [.22, .2]]) k.cyl('chrome', .012, .012, .38, 42.1 + lx, G + .19, cz + lz, { seg: 6 }); }
        k.cyl('wood_plank', .3, .3, .03, 42.9, G + .4, -1.75, { seg: 14 }); k.cyl('chrome', .02, .02, .38, 42.9, G + .2, -1.75, { seg: 8 }); k.box('plastic_white', .28, .01, .2, 42.9, G + .42, -1.75, { ry: .4 });
        k.cyl('concrete_stained', .2, .16, .4, 51.1, G + .2, -.9, { seg: 12 }); spiky(C0, 51.1, G + .38, -.9, .6, 'officeplant');
        // neon: OFFICE over the storefront, NO/VACANCY hanging in the west window
        k.box('plastic_black', 1.96, .4, .05, wc, HEAD + .26, .03, { bevel: .01 }); ad.el([1, 1, 1], 1.2, 4.5).quad(TOP, A.officeN, 1.9, .4, wc, HEAD + .26, .058);
        k.box('plastic_black', .03, .62, 2.6, 51.92, G + 2.02, -3, { bevel: .008 }); rod(k, 'metal_galv', [51.92, G + 2.33, -1.9], [51.92, G + 2.82, -1.9], .004, .004, 4); rod(k, 'metal_galv', [51.92, G + 2.33, -4.1], [51.92, G + 2.82, -4.1], .004, .004, 4);
        ad.el([1, 1, 1], 1.2, 4.5, t => hsh(Math.floor(t * 9)) < .06 ? .9 : .05).quad(TOP, A.no, .62, .47, 51.94, G + 2.02, -2.03, { ry: PI / 2 }); ad.el([1, 1, 1], 1.3, 4.5).quad(TOP, A.vac, 1.8, .47, 51.94, G + 2.02, -3.3, { ry: PI / 2 });
        ad.el([1, .74, .46], 0, .42).quad(TOP, A.g_round, 9, 5.5, 45.5, G + .016, 1.8, { rx: -PI / 2 }); ad.el([1, .62, .42], 0, .4).quad(TOP, A.g_round, 6, 7, 54.4, .05, -3, { rx: -PI / 2 });
        // roof clutter
        k.box('metal_galv', 1.6, .8, 1.1, 30, RU + .65, -7, { bevel: .03 }); k.cyl('metal_dark', .34, .34, .04, 30, RU + 1.06, -7, { seg: 16 }); for (let i = 0; i < 4; i++) k.cyl('metal_galv', .07, .07, .5 + hsh(i) * .3, 8 + i * 12, RU + .45, -4 - hsh(i * 2) * 5, { seg: 8 }); dish(k, 18, RU + .22, 1.2, .6);
      } });
    GT.world.addBox(22, 116, 74, 128, 7, 'motel-wingN');
    // props that live by the buildings (world space)
    palmlessProps(C);
  }
  let C0 = null; const EVC = BAL + .47;
  function dish(k, x, y, z, ry) { k.push(x, y, z, { ry }); k.cyl('metal_galv', .03, .03, .7, 0, .35, 0, { seg: 8 }); k.box('metal_galv', .3, .02, .3, 0, .01, 0); rod(k, 'metal_galv', [0, .3, 0], [.25, .02, .2], .012); k.push(0, .78, .05, { rx: -.75 });
    const pr = []; for (let i = 0; i <= 6; i++) { const rr = i / 6 * .42; pr.push(new T.Vector2(rr, rr * rr * .55)); } for (let i = 6; i >= 0; i--) { const rr = i / 6 * .42; pr.push(new T.Vector2(rr, rr * rr * .55 - .012)); }
    const lg = new T.LatheGeometry(pr, 18); lg.rotateX(PI / 2); k.geo('metal_painted_white', lg); rod(k, 'metal_galv', [0, -.3, .08], [0, 0, .38], .01); k.box('plastic_black', .06, .06, .1, 0, 0, .4, { bevel: .01 }); k.pop(); k.pop(); }
  function palmlessProps(C) {
    const k = C.k; P.luggageCart(C, 27.4, G, 113.2, .35); P.newsBox(C, 23.6, G, 115.45, PI); P.payPhone(C, 34.0, G, 115.55, PI); P.trashCan(k, 31.5, G, 115.5); P.hkCart(C, 73.05, F2, 68.9, PI / 2 + .04);
    k.box('plastic_white', .34, .02, .34, 73.3, F2 + .44, 62.2, { bevel: .008 }); for (const [lx, lz] of [[-.14, -.14], [.14, -.14], [-.14, .14], [.14, .14]]) k.box('plastic_white', .03, .44, .03, 73.3 + lx, F2 + .22, 62.2 + lz); k.box('plastic_white', .34, .4, .03, 73.47, F2 + .64, 62.2, { rz: -.12 }); k.cyl('metal_dark', .06, .05, .09, 73.2, F2 + .5, 62.25, { seg: 8 });
    k.box(C.M.towel, .6, .04, .9, 72.2, F2 + 1.1, 79.5, { bevel: .015 }); k.box(C.M.towel, .03, .5, .86, 72.22, F2 + .86, 79.5); k.box(C.M.canvas, .5, .04, .8, 72.2, F2 + 1.1, 99.8, { bevel: .015 }); k.box(C.M.canvas, .03, .4, .76, 72.22, F2 + .9, 99.8);
    k.decal('gum_spots', 2.4, 2, 27, G + .004, 113.6); k.decal('water_stain', 3, 2.2, 49, G + .004, 113.4); k.decal('crack', 1.2, 4, 71, G + .003, 70, .2); k.decal('crack', 1.4, 3.5, 60, G + .003, 113.5, 1.4); k.decal('water_stain', 2.4, 3, 70.6, G + .004, 97.5);
  }

  /* ================================================================== build / update */
  function build(scene) {
    if (S) { if (scene && S.group.parent !== scene) scene.add(S.group); return S.group; }
    const t0 = performance.now(), nums = []; for (let n = 101; n <= 126; n++) nums.push(n); for (let n = 201; n <= 230; n++) nums.push(n);
    // time spent inside the shared material library (lazy texture bakes) is tracked separately from this module's own work
    const _mat = GT.mat, _dec = GT.decalMat, _sig = GT.signTex; let libMs = 0; const wrap = f => function () { const t = performance.now(), r = f.apply(GT, arguments); libMs += performance.now() - t; return r; };
    GT.mat = wrap(_mat); GT.decalMat = wrap(_dec); GT.signTex = wrap(_sig);
    const tA = performance.now(), lA = libMs, at = buildAtlas(nums), atlasMs = [Math.round(performance.now() - tA), Math.round(libMs - lA)], k = GT.kit(), vc = new VC(), ad = new VC();
    const lit = new T.MeshStandardMaterial({ map: at.tex, roughness: .72, metalness: 0, alphaTest: .4 }); lit.name = 'motel_atlas_lit';
    const M = { teal: GT.mat('metal_painted_white', { color: 0x5aa59c }), brass: GT.mat('chrome', { color: 0xcfa858 }), tileB: GT.mat('tile_floor', { color: 0x3b7fa6 }), canvas: GT.mat('fabric_dark', { color: 0x86a39c }), towel: GT.mat('stucco_white'), deck: GT.mat('concrete', { color: 0xb9b1a0 }) }; M.coral = M.teal;
    const C = C0 = { k, vc, ad, A: at.cells, lit, M, water: null }; C.tpl = [roomTemplate(M, false), roomTemplate(M, true)];
    const tm = [Math.round(performance.now() - t0)], lap = () => tm.push(Math.round(performance.now() - t0));
    grounds(C); lap(); buildings(C); lap(); pool(C); lap(); signPylon(C); lap();
    GT.mat = _mat; GT.decalMat = _dec; GT.signTex = _sig;
    const group = k.build(); group.name = 'motel'; lap();
    for (const m of group.children) { if (m.material === lit || m.material.polygonOffset) m.castShadow = false; if (m.material.transparent) m.renderOrder = m.material.polygonOffset ? 1 : 2; }
    const emMat = new T.MeshBasicMaterial({ vertexColors: true }); emMat.name = 'motel_emissive';
    const adMat = new T.MeshBasicMaterial({ map: at.tex, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }); adMat.name = 'motel_glow';
    const em = vc.build(emMat), gl = ad.build(adMat); if (em) group.add(em); if (gl) { gl.renderOrder = 3; group.add(gl); } if (C.water) group.add(C.water);
    // anchors
    GT.world.anchor('motelEntrance', { x: L.x0 + 1, z: L.drive, h: PI / 2 }); GT.world.anchor('motelLotCentre', { x: 48, z: 66, h: PI / 2 }); GT.world.anchor('motelOffice', { x: 25, z: 113.2, h: 0 }); GT.world.anchor('motelSign', { x: L.sign.x, z: L.sign.z, h: 0 }); GT.world.anchor('motelPoolGate', { x: L.pool.x + 5.2, z: L.pool.z - 7.4, h: 0 });
    let tris = 0; group.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    S = { group, vc, ad, water: C.water, t: 0, sky: new T.Color(), amb: new T.Color() };
    GT.motel.info = { buildMs: Math.round(performance.now() - t0), meshes: group.children.length, tris: Math.round(tris), name: 'The Coral Comet', libMs: Math.round(libMs), ownMs: Math.round(performance.now() - t0 - libMs), atlasMs, laps: tm };
    if (scene) scene.add(group); update(0); return group;
  }
  function update(dt) {
    if (!S) return; S.t += dt || 0; const e = GT.env || {}, n = clamp(e.night || 0, 0, 1), t = S.t;
    S.vc.apply(t, n); S.ad.apply(t, n);
    if (S.water) { const u = S.water.material.uniforms; u.uT.value = t; if (e.sunDir) u.uSunDir.value.copy(e.sunDir); if (e.sunColor) u.uSunCol.value.copy(e.sunColor);
      if (e.skyColor) u.uSky.value.copy(e.skyColor); if (e.horizonColor) u.uHor.value.copy(e.horizonColor);
      u.uAmb.value.copy(u.uSky.value).multiplyScalar(1.0).add(S.amb.copy(u.uHor.value).multiplyScalar(.25)); u.uLamp.value = n * 1.1; }
  }
  GT.motel = { build, update, info: null };

  /* ================================================================== showcases */
  function stage(scene) {
    const Q = new URLSearchParams(location.search);
    GT.motel.build(scene);
    let ctx = false; if (Q.get('ctx') !== '0' && GT.road && GT.road.build) { try { GT.road.build(scene); ctx = true; } catch (err) { console.warn('motel showcase: road.build failed', err); } }
    if (!ctx) { const k = GT.kit(); k.box('asphalt', 15, .02, 400, 0, -.012, 0); k.box('concrete', 2.5, .14, 400, 8.75, .07, 0); k.box('concrete', 2.5, .14, 400, -8.75, .07, 0); k.box('grass_dry', 4, .02, 400, 12, 0, 0); k.box('sand', 400, .02, 400, -210, -.02, 0); k.box('dirt', 400, .02, 400, 292, -.03, 0); k.box('asphalt_worn', 78, .02, 400, 53, -.02, 0);
      for (let z = -190; z < 190; z += 9) { k.box('road_paint_yellow', .12, .012, 3, 0, .002, z); } scene.add(k.build()); }
    if (Q.get('stats') === '1') setTimeout(() => { const el = document.getElementById('err'), r = GT.render && GT.render.renderer; if (el) el.textContent += JSON.stringify(GT.motel.info) + (r ? ' calls/frame(all passes)=' + r.info.render.calls : '') + '\n'; }, 400);
    return dt => GT.motel.update(dt);
  }
  const show = (cam, look) => ({ scene }) => { const up = stage(scene); return { cam, look, hours: 18.2, update: up }; };
  GT.showcase.motel = show([-4, 1.8, 35.5], [42, 6.6, 88]);
  GT.showcase.motel_sign = show([25.5, 1.3, 40.5], [17.4, 9.4, 51]);
  GT.showcase.motel_pool = show([36.4, 1.55, 78.9], [47.5, -.6, 85.6]);
  GT.showcase.motel_walkway = show([73.0, F2 + 1.58, 58.4], [73.25, F2 + 1.15, 100]);
  GT.showcase.motel_lot = show([49, 1.15, 66.5], [74, 2.6, 84]);
})();
