/* station.js — SOLMAR gas station + food mart (hero location). Owner: station agent.
   GT.station = { build(scene) -> Group, update(dt), state:{alarm, doorOpen, lightsOn}, info }
   Everything is placed in world coordinates from GT.L.station. One merged mesh per material (kit), products are one batched mesh. */
(function () {
  'use strict';
  const T = THREE, GT = window.GT, PI = Math.PI, HP = PI / 2;
  const S = GT.L.station, ST = S.store, CAN = S.canopy, DZ = ST.doorZ;
  const state = { alarm: false, doorOpen: 0, lightsOn: true };
  const R = { glows: [], t: 0, door: 0, on: 1, alarmT: 0 }, info = { ms: 0, matMs: 0, meshes: 0, tris: 0 };
  let K, M, L, G, PB, rnd, built = null;
  const W_ = { ry: -HP }, E_ = { ry: HP }, N_ = {}, S_ = { ry: PI }, UP = { rx: -HP };
  const WHITE = new T.Color(1, 1, 1);
  const TEAL = '#0c6b70', TEAL2 = '#083f45', CORAL = '#e8602a', SUN = '#f4b62c', CREAM = '#f2ead8', INK = '#15181b';
  const FY = .15, CY = 3.05;   // store floor level, drop-ceiling height

  /* ================================================================== small helpers */
  const E = (m, x0, y0, z0, x1, y1, z1, b, o) => K.box(m, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Object.assign({ bevel: b || 0 }, o));
  const B = (m, w, h, d, x, y, z, b, o) => K.box(m, w, h, d, x, y, z, Object.assign({ bevel: b || 0 }, o));
  /** atlas quad: plane w×h mapped to atlas rect r */
  function aq(m, r, w, h, x, y, z, rot, k) { const g = new T.PlaneGeometry(w, h), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, GT.lerp(r.u0, r.u1, uv.getX(i)), GT.lerp(r.v0, r.v1, uv.getY(i)));
    (k || K).geo(m, g, Object.assign({ x, y, z }, rot)); }
  function myGlow(m, c, d, n, prop) { GT.glow(m, c, d, n, prop); const e = GT.glowList[GT.glowList.length - 1]; e._d = d; e._n = n; R.glows.push(e); return m; }
  function ownLight(name, dk, nk) { const src = GT.mat(name), e = GT.glowList.find(g => g.m === src), m = src.clone(); m.name = 'station_' + name + dk + '_' + nk; return myGlow(m, e ? e.c : WHITE, (e ? e.day : .5) * dk, (e ? e.night : 8) * nk); }
  function selfLit(m, d, n) { m.emissiveMap = m.map; m.emissive = new T.Color(1, 1, 1); m.emissiveIntensity = d; return myGlow(m, WHITE, d, n, 'emissiveIntensity'); }
  const dec = (name, w, d, x, y, z, ry) => K.decal(name, w, d, x, y, z, ry || 0);
  const wdec = (name, w, h, x, y, z, rot) => K.quad(GT.decalMat(name), w, h, x, y, z, rot);

  /* ================================================================== texture atlases (drawn once) */
  function Atlas(W, Hh, bg) { const c = document.createElement('canvas'); c.width = W; c.height = Hh; const g = c.getContext('2d'), items = []; if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, Hh); }
    return { c, g, add(w, h, draw) { const r = {}; items.push({ w, h, draw, r }); return r; },
      tex() { items.sort((p, q) => q.h - p.h || q.w - p.w); let x = 4, y = 4, rh = 0;
        for (const it of items) { const w = it.w, h = it.h; if (x + w + 4 > W) { x = 4; y += rh + 8; rh = 0; } if (y + h + 4 > Hh) { const e = document.getElementById('err'); if (e) e.textContent += 'station atlas overflow ' + w + 'x' + h + '\n'; console.warn('station atlas overflow', w, h); }
          g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); it.draw(g, w, h); g.restore();
          Object.assign(it.r, { u0: (x + .5) / W, u1: (x + w - .5) / W, v1: 1 - (y + .5) / Hh, v0: 1 - (y + h - .5) / Hh }); x += w + 8; rh = Math.max(rh, h); }
        const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; } }; }
  const FONT = "'Arial Black','Helvetica Neue','Arial',sans-serif", COND = "'DIN Condensed','Arial Narrow','Helvetica Neue','Arial',sans-serif";
  function tx(g, s, x, y, px, col, o) { o = o || {}; g.font = (o.it ? 'italic ' : '') + (o.wt || '900') + ' ' + px + 'px ' + (o.cond ? COND : FONT); g.fillStyle = col; g.textAlign = o.al || 'center'; g.textBaseline = 'middle';
    if (o.stroke) { g.lineWidth = px * .16; g.strokeStyle = o.stroke; g.lineJoin = 'round'; if (o.max) g.strokeText(s, x, y, o.max); else g.strokeText(s, x, y); } if (o.max) g.fillText(s, x, y, o.max); else g.fillText(s, x, y); }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function star(g, cx, cy, r1, r2, n, col) { g.fillStyle = col; g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = i * PI / n, r = i & 1 ? r2 : r1; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.fill(); }
  /** SOLMAR mark: half sun with rays rising over two waves */
  function logo(g, cx, cy, r, wave1, wave2) { g.save(); g.translate(cx, cy); g.fillStyle = SUN;
    for (let i = 0; i < 7; i++) { g.save(); g.rotate(PI + (i + .5) * PI / 7); g.beginPath(); g.moveTo(r * .66, -r * .09); g.lineTo(r, 0); g.lineTo(r * .66, r * .09); g.closePath(); g.fill(); g.restore(); }
    g.fillStyle = CORAL; g.beginPath(); g.arc(0, 0, r * .56, PI, 2 * PI); g.closePath(); g.fill(); g.lineCap = 'round'; g.lineWidth = r * .12;
    for (let j = 0; j < 2; j++) { g.strokeStyle = j ? (wave2 || '#27b3ad') : (wave1 || '#ffffff'); g.beginPath(); for (let k = 0; k <= 24; k++) { const x = -r + k * r / 12, y = r * (.2 + j * .25) + Math.sin(k / 24 * PI * 4 + j * 1.5) * r * .07; if (k) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
    g.restore(); }
  function weather(g, w, h, a, seed) { if (a <= 0) return; const r = GT.rng('wx' + seed); g.fillStyle = 'rgba(236,228,208,' + (.1 * a) + ')'; g.fillRect(0, 0, w, h);
    for (let i = 0, n = w * h / 2400 * a; i < n; i++) { const x = r() * w, y = r() * h, s = 1 + r() * 2.5; g.fillStyle = 'rgba(' + (60 + r() * 40 | 0) + ',' + (48 + r() * 30 | 0) + ',' + (34 + r() * 20 | 0) + ',' + (.05 + .2 * r() * a) + ')'; g.fillRect(x, y, s, s * (1 + r() * 5)); }
    for (let i = 0, n = 3 + w / 50 * a; i < n; i++) { const x = r() * w, ww = 3 + r() * 14, hh = h * (.3 + r() * .7), gr = g.createLinearGradient(0, 0, 0, hh); gr.addColorStop(0, 'rgba(70,58,44,' + (.2 * a) + ')'); gr.addColorStop(1, 'rgba(70,58,44,0)'); g.fillStyle = gr; g.fillRect(x, 0, ww, hh); } }
  function bottle(g, cx, cy, s, col, lab) { g.save(); g.translate(cx, cy); g.fillStyle = col; g.beginPath(); g.moveTo(-.16 * s, .5 * s); g.lineTo(-.16 * s, -.08 * s); g.quadraticCurveTo(-.16 * s, -.22 * s, -.06 * s, -.3 * s); g.lineTo(-.055 * s, -.5 * s); g.lineTo(.055 * s, -.5 * s); g.lineTo(.06 * s, -.3 * s); g.quadraticCurveTo(.16 * s, -.22 * s, .16 * s, -.08 * s); g.lineTo(.16 * s, .5 * s); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(-.12 * s, -.05 * s, .04 * s, .5 * s); g.fillStyle = lab; g.fillRect(-.16 * s, .05 * s, .32 * s, .26 * s); g.fillStyle = '#d8b24a'; g.fillRect(-.06 * s, -.5 * s, .12 * s, .05 * s); g.restore(); }
  function poster(g, w, h, o) { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, o.bg); gr.addColorStop(1, o.bg2 || o.bg); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    o.art(g, w, h); tx(g, o.t1, w / 2, h * .1, h * .105, o.fg, { max: w * .88, it: o.it, stroke: o.st }); if (o.t2) tx(g, o.t2, w / 2, h * .2, h * .06, o.fg2 || o.fg, { cond: 1, max: w * .88 });
    if (o.price) { g.save(); g.translate(w * .7, h * .77); g.rotate(-.16); star(g, 0, 0, w * .29, w * .23, 14, '#f6d21e'); tx(g, o.price, 0, -w * .02, w * .13, '#c21a1a', { max: w * .38 }); if (o.unit) tx(g, o.unit, 0, w * .09, w * .06, '#c21a1a', { cond: 1 }); g.restore(); }
    g.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 3; i++) g.fillRect(w * .08, h * (.925 + i * .018), w * (.42 - i * .1), h * .006);
    g.strokeStyle = '#f1eee4'; g.lineWidth = w * .04; g.strokeRect(0, 0, w, h); weather(g, w, h, o.wx === undefined ? .55 : o.wx, o.t1); }
  function label(g, w, h, text, bg, fg, o) { o = o || {}; g.fillStyle = bg; g.fillRect(0, 0, w, h); if (o.border) { g.strokeStyle = o.border; g.lineWidth = h * .08; g.strokeRect(h * .07, h * .07, w - h * .14, h - h * .14); }
    const lines = text.split('|'), n = lines.length; lines.forEach((s, i) => tx(g, s, w / 2, h * (i + .5) / n + (n === 1 ? h * .03 : 0), Math.min(h * (o.k || .62) / n, w * .22), fg, { max: w * .88, cond: o.cond, it: o.it })); weather(g, w, h, o.wx === undefined ? .4 : o.wx, text); }

  function buildAtlases() {
    const A = Atlas(2048, 2048), a = (w, h, f) => A.add(w, h, f); L = {};
    const lcd = (t, w, h, col) => GT.signTex(t, { style: 'lcd', w, h, color: col || '#ff2a14' }).image;
    /* ---- window posters */
    L.p = [
      a(256, 384, (g, w, h) => poster(g, w, h, { bg: '#0d3b58', bg2: '#1c8190', fg: '#fff', it: 1, t1: 'PLAYA', t2: 'CERVEZA CLARA · ICE COLD', price: '13.99', unit: '12 PACK', art(g) { g.fillStyle = '#f4b62c'; g.beginPath(); g.arc(w * .5, h * .62, w * .36, PI, 2 * PI); g.fill(); g.fillStyle = '#0a2f44'; g.fillRect(0, h * .62, w, h * .4); bottle(g, w * .3, h * .56, h * .46, '#8a5a18', CREAM); bottle(g, w * .5, h * .6, h * .46, '#7a4c12', CREAM); } })),
      a(256, 384, (g, w, h) => poster(g, w, h, { bg: '#4c1a68', bg2: '#b4306a', fg: '#ffe14a', t1: 'CORAL CASH', t2: "TONIGHT'S JACKPOT", art(g) { tx(g, '$214', w / 2, h * .4, h * .2, '#fff', { stroke: '#2a0a3a' }); tx(g, 'MILLION', w / 2, h * .55, h * .1, '#ffe14a', { stroke: '#2a0a3a' }); const cs = ['#e8402a', '#f4b62c', '#2a9ad8', '#3cb85a', '#fff']; for (let i = 0; i < 5; i++) { g.fillStyle = cs[i]; g.beginPath(); g.arc(w * (.16 + i * .17), h * .74, w * .075, 0, 7); g.fill(); tx(g, String(7 + i * 9), w * (.16 + i * .17), h * .742, w * .07, '#1a1020'); } tx(g, 'PLAY HERE', w / 2, h * .86, h * .06, '#fff', { cond: 1 }); } })),
      a(256, 384, (g, w, h) => poster(g, w, h, { bg: '#7a1418', bg2: '#33090b', fg: '#e8c56a', t1: 'DORADO', t2: 'KINGS · FULL FLAVOR', price: '8.49', unit: 'PER PACK', art(g) { g.save(); g.translate(w * .34, h * .55); g.rotate(-.2); g.fillStyle = '#f2ead8'; g.fillRect(-w * .16, -h * .16, w * .32, h * .34); g.fillStyle = '#c9a23a'; g.fillRect(-w * .16, -h * .16, w * .32, h * .09); g.fillStyle = '#7a1418'; g.fillRect(-w * .16, -h * .03, w * .32, h * .05); tx(g, 'D', 0, h * .09, h * .1, '#c9a23a', { it: 1 }); g.restore(); g.fillStyle = '#f4f1e8'; g.fillRect(w * .06, h * .875, w * .5, h * .045); tx(g, 'WARNING: SMOKING HARMS YOU', w * .31, h * .899, h * .022, '#111', { cond: 1 }); } })),
      a(256, 384, (g, w, h) => poster(g, w, h, { bg: '#e8791c', bg2: '#f3b934', fg: '#fff', st: '#a8400c', it: 1, t1: 'SUNDROP', t2: 'ANY SIZE FOUNTAIN DRINK', fg2: '#5a1c04', price: '.99', unit: 'ALL DAY', art(g) { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w * .16, h * .34); g.lineTo(w * .56, h * .34); g.lineTo(w * .5, h * .84); g.lineTo(w * .22, h * .84); g.closePath(); g.fill(); g.fillStyle = '#c2281c'; g.fillRect(w * .19, h * .5, w * .34, h * .16); g.fillStyle = '#e9e4d8'; g.beginPath(); g.ellipse(w * .36, h * .34, w * .21, h * .03, 0, 0, 7); g.fill(); g.strokeStyle = '#c2281c'; g.lineWidth = w * .03; g.beginPath(); g.moveTo(w * .4, h * .34); g.lineTo(w * .5, h * .25); g.stroke(); tx(g, 'SOL', w * .36, h * .58, h * .07, '#fff', { it: 1 }); } })),
      a(256, 384, (g, w, h) => poster(g, w, h, { bg: '#f1e3c0', bg2: '#e6d09a', fg: '#b3242c', t1: '2 DOGS', t2: '+ 22 oz FRÍO SLUSH', fg2: '#3a2a18', price: '4.00', unit: 'COMBO', art(g) { g.fillStyle = '#d9a25a'; g.beginPath(); g.ellipse(w * .4, h * .5, w * .34, h * .09, -.12, 0, 7); g.fill(); g.fillStyle = '#a8432c'; g.beginPath(); g.ellipse(w * .4, h * .47, w * .36, h * .045, -.12, 0, 7); g.fill(); g.strokeStyle = '#f2c81e'; g.lineWidth = w * .022; g.beginPath(); for (let i = 0; i <= 10; i++) g.lineTo(w * (.1 + i * .06), h * (.5 - i * .008) + (i & 1 ? -1 : 1) * h * .014); g.stroke(); g.fillStyle = '#c8894a'; g.beginPath(); g.ellipse(w * .4, h * .55, w * .34, h * .05, -.12, 0, PI); g.fill(); } })),
      a(256, 384, (g, w, h) => poster(g, w, h, { bg: '#0b0d10', bg2: '#1c2c12', fg: '#b6f22c', it: 1, t1: 'VOLTIO', t2: 'ENERGY · ANY 2 CANS', fg2: '#e8e8e0', price: '5.00', unit: '2 FOR', art(g) { g.fillStyle = '#1a1c20'; rr(g, w * .2, h * .3, w * .3, h * .52, w * .04); g.fill(); g.fillStyle = '#9aa0a6'; g.fillRect(w * .2, h * .3, w * .3, h * .035); g.fillStyle = '#b6f22c'; g.beginPath(); g.moveTo(w * .4, h * .38); g.lineTo(w * .27, h * .58); g.lineTo(w * .35, h * .58); g.lineTo(w * .3, h * .76); g.lineTo(w * .45, h * .53); g.lineTo(w * .36, h * .53); g.closePath(); g.fill(); } }))];
    /* ---- transom strips */
    L.sBeer = a(512, 96, (g, w, h) => label(g, w, h, 'COLD BEER', '#123d6a', '#fff', { border: '#f4b62c' }));
    L.sCig = a(512, 96, (g, w, h) => label(g, w, h, 'CIGARETTES', '#8a1a1c', '#f3e6b8', { border: '#f3e6b8', cond: 1, k: .8 }));
    L.sAtm = a(512, 96, (g, w, h) => label(g, w, h, 'ATM INSIDE', '#f2f0e6', '#1a56a8', { border: '#1a56a8' }));
    L.sLotto = a(512, 96, (g, w, h) => label(g, w, h, 'LOTTO · PLAY HERE', '#f4c21e', '#5a1c6e', { border: '#5a1c6e', cond: 1, k: .8 }));
    L.sIce = a(512, 96, (g, w, h) => label(g, w, h, 'ICE · AGUA · SODAS', '#dff0f4', '#136a8a', { border: '#136a8a', cond: 1, k: .8 }));
    L.sCoffee = a(512, 96, (g, w, h) => label(g, w, h, 'HOT COFFEE 99¢', '#3a2414', '#f2d9a8', { border: '#c8843a', cond: 1, k: .8 }));
    /* ---- door / window stickers */
    L.atm = a(128, 96, (g, w, h) => { rr(g, 2, 2, w - 4, h - 4, 10); g.fillStyle = '#1a56a8'; g.fill(); tx(g, 'ATM', w / 2, h * .42, h * .5, '#fff'); tx(g, 'INSIDE · 24 HR', w / 2, h * .8, h * .17, '#ffe14a', { cond: 1 }); });
    L.cards = a(128, 96, (g, w, h) => { rr(g, 2, 2, w - 4, h - 4, 8); g.fillStyle = '#f4f2ea'; g.fill(); tx(g, 'WE ACCEPT', w / 2, h * .17, h * .17, '#222', { cond: 1 }); ['#1c3f94', '#c8322a', '#e8962a', '#2a8a5a'].forEach((c, i) => { rr(g, 8 + (i % 2) * 58, 30 + (i >> 1) * 31, 52, 26, 4); g.fillStyle = c; g.fill(); g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(14 + (i % 2) * 58, 46 + (i >> 1) * 31, 26, 4); }); });
    L.cam = a(128, 128, (g, w, h) => { g.fillStyle = '#f4d21e'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 5; g.strokeRect(4, 4, w - 8, h - 8); tx(g, 'SMILE!', w / 2, 26, 24, '#111'); g.fillStyle = '#111'; g.fillRect(34, 46, 46, 26); g.beginPath(); g.moveTo(80, 52); g.lineTo(98, 44); g.lineTo(98, 74); g.lineTo(80, 66); g.fill(); tx(g, "YOU'RE ON CAMERA", w / 2, 92, 15, '#111', { cond: 1 }); tx(g, '24 HR VIDEO RECORDING', w / 2, 110, 11, '#111', { cond: 1 }); weather(g, w, h, .5, 'cam'); });
    L.nocash = a(160, 96, (g, w, h) => { g.fillStyle = '#b3242c'; g.fillRect(0, 0, w, h); tx(g, 'CLERK CANNOT', w / 2, 20, 19, '#fff', { cond: 1 }); tx(g, 'OPEN SAFE', w / 2, 46, 26, '#fff'); tx(g, 'TIME-LOCK · LESS THAN $50 IN REGISTER', w / 2, 76, 10, '#ffe9c0', { cond: 1 }); weather(g, w, h, .4, 'nc'); });
    L.hours = a(160, 224, (g, w, h) => { g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h); g.fillStyle = TEAL; g.fillRect(0, 0, w, 54); logo(g, 30, 36, 20); tx(g, 'SOLMAR', 98, 28, 22, '#fff', { it: 1 }); tx(g, 'OPEN 24 HOURS', w / 2, 76, 21, '#b3242c', { cond: 1 }); ['MON–THU', 'FRI–SAT', 'SUNDAY', 'HOLIDAYS'].forEach((s, i) => { tx(g, s, 12, 106 + i * 22, 14, '#222', { cond: 1, al: 'left' }); tx(g, '24 HRS', w - 12, 106 + i * 22, 14, '#222', { cond: 1, al: 'right' }); }); g.fillStyle = '#222'; g.fillRect(10, 190, w - 20, 1); tx(g, 'BEER SALES 7AM – 2AM', w / 2, 205, 12, '#444', { cond: 1 }); weather(g, w, h, .5, 'hrs'); });
    L.height = a(40, 384, (g, w, h) => { const cs = ['#c8322a', '#f4b62c', '#2a8a5a', '#1a56a8', '#f4f2ea', '#c8322a']; for (let i = 0; i < 6; i++) { g.fillStyle = cs[i]; g.fillRect(0, i * h / 6, w, h / 6); g.fillStyle = '#111'; g.fillRect(0, i * h / 6, w, 2); for (let k = 1; k < 4; k++) g.fillRect(0, i * h / 6 + k * h / 24, w * .35, 1); tx(g, ["6'6", "6'0", "5'6", "5'0", "4'6", "4'0"][i], w * .6, i * h / 6 + 14, 14, i === 1 || i === 4 ? '#111' : '#fff', { cond: 1 }); } });
    L.autodoor = a(256, 64, (g, w, h) => { g.fillStyle = '#f4d21e'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; for (let i = -2; i < 22; i++) { g.beginPath(); g.moveTo(i * 14, 0); g.lineTo(i * 14 + 7, 0); g.lineTo(i * 14 + 1, 9); g.lineTo(i * 14 - 6, 9); g.fill(); g.beginPath(); g.moveTo(i * 14, h - 9); g.lineTo(i * 14 + 7, h - 9); g.lineTo(i * 14 + 1, h); g.lineTo(i * 14 - 6, h); g.fill(); } tx(g, 'CAUTION · AUTOMATIC DOOR', w / 2, h / 2 + 1, 19, '#111', { cond: 1 }); });
    L.helpw = a(96, 128, (g, w, h) => { g.fillStyle = '#f6f4ee'; g.fillRect(0, 0, w, h); tx(g, 'HELP', w / 2, 24, 26, '#c21a1a'); tx(g, 'WANTED', w / 2, 50, 20, '#c21a1a'); tx(g, 'NIGHT SHIFT', w / 2, 76, 14, '#222', { cond: 1 }); tx(g, 'apply inside', w / 2, 96, 12, '#222', { cond: 1, it: 1 }); g.fillStyle = '#bbb'; g.fillRect(10, 110, w - 20, 2); weather(g, w, h, .5, 'hw'); });
    L.lostcat = a(96, 128, (g, w, h) => { g.fillStyle = '#eef0e8'; g.fillRect(0, 0, w, h); tx(g, 'LOST CAT', w / 2, 16, 17, '#111'); g.fillStyle = '#8a8a86'; g.fillRect(16, 30, 64, 52); g.fillStyle = '#3a3a3a'; g.beginPath(); g.ellipse(48, 62, 18, 14, 0, 0, 7); g.fill(); g.beginPath(); g.moveTo(34, 54); g.lineTo(36, 38); g.lineTo(46, 50); g.fill(); g.beginPath(); g.moveTo(62, 54); g.lineTo(60, 38); g.lineTo(50, 50); g.fill(); tx(g, '"MOJITO" · REWARD', w / 2, 94, 11, '#111', { cond: 1 }); for (let i = 0; i < 6; i++) { g.fillStyle = '#111'; g.fillRect(6 + i * 15, 106, 1, 22); } weather(g, w, h, .6, 'lc'); });
    /* ---- exterior props */
    L.ice = a(512, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a6aa8'); gr.addColorStop(1, '#1a4a82'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.12)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.arc((i * 97) % w, (i * 53) % h, 2 + i % 4, 0, 7); g.fill(); }
      tx(g, 'ICE', w * .4, h * .52, h * .78, '#f4f8fa', { stroke: '#0e2a52' }); g.fillStyle = '#f4f8fa'; g.beginPath(); for (let i = 0; i <= 30; i++) { const x = w * (.1 + i * .02); g.lineTo(x, h * .2 + (i & 1 ? 0 : h * .07) + Math.sin(i) * 4); } g.lineTo(w * .7, h * .1); g.lineTo(w * .1, h * .1); g.fill();
      g.save(); g.translate(w * .84, h * .5); g.rotate(-.1); star(g, 0, 0, h * .3, h * .24, 12, '#f4d21e'); tx(g, '$3.49', 0, -6, h * .15, '#c21a1a'); tx(g, '10 LB BAG', 0, h * .1, h * .075, '#c21a1a', { cond: 1 }); g.restore(); weather(g, w, h, .8, 'ice'); });
    L.propane = a(256, 128, (g, w, h) => { g.fillStyle = '#f2f0e8'; g.fillRect(0, 0, w, h); g.fillStyle = '#1a56a8'; g.fillRect(0, 0, w, 36); tx(g, 'PROPANE EXCHANGE', w / 2, 19, 21, '#fff', { cond: 1 }); g.fillStyle = '#e8602a'; g.beginPath(); g.moveTo(44, 110); g.quadraticCurveTo(14, 84, 44, 46); g.quadraticCurveTo(50, 74, 62, 62); g.quadraticCurveTo(76, 92, 44, 110); g.fill(); tx(g, 'EXCHANGE $21.99', 160, 62, 21, '#111', { cond: 1 }); tx(g, 'NEW TANK $54.99 · PAY INSIDE', 160, 92, 14, '#444', { cond: 1 }); weather(g, w, h, .7, 'prop'); });
    L.nosmoke = a(128, 128, (g, w, h) => { g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c21a1a'; g.lineWidth = 9; g.beginPath(); g.arc(w / 2, 50, 36, 0, 7); g.stroke(); g.fillStyle = '#222'; g.fillRect(36, 45, 44, 9); g.fillRect(84, 45, 6, 9); g.beginPath(); g.moveTo(38, 24); g.lineTo(90, 76); g.stroke(); tx(g, 'NO SMOKING', w / 2, 100, 17, '#c21a1a'); tx(g, 'STOP ENGINE', w / 2, 118, 12, '#222', { cond: 1 }); weather(g, w, h, .6, 'ns'); });
    L.news = [['CORAL COAST|LEDGER', '#1c3f94', '#fff'], ['WHEELS|WEEKLY · FREE', '#f4c21e', '#111'], ['HOMES &|RENTALS', '#b3242c', '#fff']].map((d, i) => a(128, 192, (g, w, h) => { g.fillStyle = d[1]; g.fillRect(0, 0, w, h); const s = d[0].split('|'); tx(g, s[0], w / 2, 22, 17, d[2], { max: w * .9 }); tx(g, s[1], w / 2, 44, 14, d[2], { cond: 1, max: w * .9 }); g.fillStyle = '#16181a'; g.fillRect(10, 62, w - 20, 92); g.fillStyle = '#e8e4d8'; g.fillRect(18, 70, w - 36, 76); g.fillStyle = '#222'; g.fillRect(24, 76, w - 48, 12); for (let k = 0; k < 7; k++) { g.fillStyle = '#888'; g.fillRect(24, 94 + k * 7, (w - 48) * (k % 3 ? 1 : .7), 2); } g.fillStyle = '#9aa0a6'; g.fillRect(w / 2 - 22, 162, 44, 20); g.fillStyle = '#111'; g.fillRect(w / 2 - 4, 166, 8, 3); tx(g, i === 0 ? '$1.50' : 'FREE', w / 2, 176, 9, '#111', { cond: 1 }); weather(g, w, h, .9, 'nw' + i); }));
    L.phone = a(128, 256, (g, w, h) => { g.fillStyle = '#2a2d31'; g.fillRect(0, 0, w, h); g.fillStyle = '#b8bcc0'; g.fillRect(10, 10, w - 20, 60); tx(g, 'PHONE', w / 2, 30, 20, '#1a56a8'); tx(g, 'local calls 50¢', w / 2, 54, 12, '#333', { cond: 1 }); g.fillStyle = '#8a8e92'; g.fillRect(36, 84, 56, 84); for (let i = 0; i < 12; i++) { g.fillStyle = '#c8ccd0'; g.fillRect(42 + (i % 3) * 16, 92 + (i / 3 | 0) * 18, 12, 12); } g.fillStyle = '#111'; g.fillRect(40, 182, 48, 8); g.fillStyle = '#f4f2ea'; g.save(); g.translate(64, 220); g.rotate(-.12); g.fillRect(-48, -16, 96, 32); tx(g, 'OUT OF ORDER', 0, 0, 14, '#c21a1a', { cond: 1 }); g.restore(); weather(g, w, h, 1, 'ph'); });
    L.airvac = a(256, 256, (g, w, h) => { g.fillStyle = '#c8322a'; g.fillRect(0, 0, w, h); g.fillStyle = '#f4f2ea'; g.fillRect(12, 12, w - 24, 96); tx(g, 'AIR', 74, 60, 60, '#1a56a8'); tx(g, 'VACUUM', 184, 44, 26, '#c8322a', { cond: 1 }); tx(g, '$2.00', 184, 80, 30, '#111'); g.fillStyle = '#16181a'; g.fillRect(24, 128, 96, 56); g.drawImage(lcd('2.00', 128, 64, '#ffb020'), 28, 132, 88, 48); g.fillStyle = '#9aa0a6'; g.fillRect(150, 124, 80, 104); g.fillStyle = '#111'; g.fillRect(184, 140, 12, 4); g.fillRect(170, 170, 40, 26); tx(g, 'QUARTERS / CARD', 190, 214, 10, '#111', { cond: 1 }); tx(g, 'FREE AIR WITH FILL-UP · ASK INSIDE', w / 2 - 34, 206, 9, '#fff', { cond: 1, max: 110 }); tx(g, 'TIRE PRESSURE: SEE DOOR PLACARD', w / 2, 240, 11, '#ffe9c0', { cond: 1 }); weather(g, w, h, .9, 'av'); });
    L.pumpStick = a(256, 256, (g, w, h) => { g.fillStyle = '#f4d21e'; g.fillRect(4, 4, 120, 74); g.fillStyle = '#111'; g.beginPath(); g.moveTo(24, 66); g.lineTo(44, 26); g.lineTo(64, 66); g.fill(); tx(g, '!', 44, 52, 22, '#f4d21e'); tx(g, 'STATIC', 92, 30, 13, '#111', { cond: 1 }); tx(g, 'SPARK', 92, 46, 13, '#111', { cond: 1 }); tx(g, 'HAZARD', 92, 62, 13, '#111', { cond: 1 });
      g.fillStyle = '#f4f2ea'; g.fillRect(132, 4, 120, 74); g.strokeStyle = '#c21a1a'; g.lineWidth = 5; g.beginPath(); g.arc(160, 40, 22, 0, 7); g.moveTo(145, 25); g.lineTo(175, 55); g.stroke(); g.fillStyle = '#222'; g.fillRect(150, 37, 20, 6); tx(g, 'NO SMOKING', 216, 30, 11, '#c21a1a', { cond: 1 }); tx(g, 'ENGINE OFF', 216, 46, 11, '#222', { cond: 1 }); tx(g, 'NO CELL', 216, 62, 11, '#222', { cond: 1 });
      g.fillStyle = '#c21a1a'; g.fillRect(4, 86, 248, 40); tx(g, 'PAY INSIDE AFTER DARK', 128, 107, 21, '#fff', { cond: 1 });
      g.fillStyle = '#f4f2ea'; g.fillRect(4, 134, 150, 118); tx(g, 'CONTAINS UP TO 10% ETHANOL', 79, 148, 10, '#111', { cond: 1 }); for (let i = 0; i < 9; i++) { g.fillStyle = '#666'; g.fillRect(12, 160 + i * 9, 134 * (i % 4 === 3 ? .6 : 1), 2); } tx(g, 'WEIGHTS & MEASURES', 79, 244, 9, '#1a56a8', { cond: 1 });
      g.fillStyle = '#1a56a8'; g.fillRect(162, 134, 90, 56); tx(g, 'SOL', 207, 152, 17, '#fff', { it: 1 }); tx(g, 'REWARDS', 207, 174, 13, '#ffe14a', { cond: 1 }); g.fillStyle = '#2a8a5a'; g.fillRect(162, 198, 90, 54); tx(g, 'DIESEL', 207, 216, 16, '#fff'); tx(g, 'ULTRA LOW SULFUR', 207, 238, 9, '#fff', { cond: 1 }); weather(g, w, h, .8, 'ps'); });
    L.num = [1, 2, 3, 4, 5, 6].map(n => a(96, 96, (g, w, h) => { g.fillStyle = TEAL; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(5, 5, w - 10, h - 10); tx(g, String(n), w / 2, h / 2 + 4, 64, '#fff'); weather(g, w, h, .4, 'n' + n); }));
    L.clear = a(512, 64, (g, w, h) => { g.fillStyle = '#f4d21e'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5); tx(g, "CLEARANCE 13'-6\"", w / 2, h / 2 + 2, 36, '#111', { cond: 1 }); weather(g, w, h, .5, 'cl'); });
    const stencil = (t, col) => (g, w, h) => { tx(g, t, w / 2, h / 2 + 3, h * .8, col, { cond: 1, max: w * .96 }); const r = GT.rng(t); g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(0,0,0,' + (.4 + r() * .6) + ')'; const s = 1 + r() * 5; g.fillRect(r() * w, r() * h, s * (1 + r() * 3), s); } g.globalCompositeOperation = 'source-over'; };
    L.fireLane = a(512, 96, stencil('FIRE LANE', '#d8c23a')); L.noPark = a(512, 96, stencil('NO PARKING', '#d8c23a')); L.keepClear = a(512, 96, stencil('KEEP CLEAR', '#6a1c16'));
    L.men = a(128, 128, (g, w, h) => label(g, w, h, 'RESTROOM|KEY INSIDE', '#1c3f94', '#fff', { cond: 1, k: .7, border: '#fff' }));
    L.staff = a(256, 64, (g, w, h) => label(g, w, h, 'EMPLOYEES ONLY', '#16181a', '#e8e4d8', { cond: 1, k: .7, wx: .2 }));
    L.hcSign = a(128, 192, (g, w, h) => { g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#1c3f94'; g.fillRect(8, 8, w - 16, 104); g.fillStyle = '#fff'; g.beginPath(); g.arc(60, 34, 9, 0, 7); g.fill(); g.lineWidth = 8; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(60, 44); g.lineTo(62, 70); g.lineTo(84, 70); g.lineTo(92, 92); g.stroke(); g.beginPath(); g.arc(58, 80, 20, .6, 4.4); g.stroke(); tx(g, 'RESERVED', w / 2, 130, 20, '#1c3f94', { cond: 1 }); tx(g, 'PARKING', w / 2, 152, 20, '#1c3f94', { cond: 1 }); tx(g, '$250 FINE', w / 2, 176, 13, '#111', { cond: 1 }); weather(g, w, h, .7, 'hc'); });
    L.towSign = a(128, 192, (g, w, h) => { g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c21a1a'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12); tx(g, 'CUSTOMER', w / 2, 34, 22, '#c21a1a', { cond: 1 }); tx(g, 'PARKING', w / 2, 60, 22, '#c21a1a', { cond: 1 }); tx(g, 'ONLY', w / 2, 86, 22, '#c21a1a', { cond: 1 }); tx(g, '15 MINUTE LIMIT', w / 2, 116, 13, '#111', { cond: 1 }); tx(g, 'VIOLATORS TOWED', w / 2, 136, 13, '#111', { cond: 1 }); tx(g, "AT OWNER'S EXPENSE", w / 2, 154, 11, '#111', { cond: 1 }); tx(g, 'GULFSIDE TOWING', w / 2, 174, 10, '#666', { cond: 1 }); weather(g, w, h, .8, 'tw'); });
    L.loiter = a(128, 192, (g, w, h) => { g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.fillRect(8, 8, w - 16, 44); tx(g, 'NOTICE', w / 2, 31, 26, '#fff'); tx(g, 'NO LOITERING', w / 2, 80, 19, '#111', { cond: 1 }); tx(g, 'NO SOLICITING', w / 2, 104, 19, '#111', { cond: 1 }); tx(g, 'NO PUBLIC', w / 2, 132, 15, '#c21a1a', { cond: 1 }); tx(g, 'RESTROOMS', w / 2, 150, 15, '#c21a1a', { cond: 1 }); tx(g, 'premises under surveillance', w / 2, 176, 9, '#444', { cond: 1 }); weather(g, w, h, .8, 'lo'); });
    L.shutoff = a(192, 128, (g, w, h) => { g.fillStyle = '#c21a1a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(5, 5, w - 10, h - 10); tx(g, 'EMERGENCY', w / 2, 34, 27, '#fff', { cond: 1 }); tx(g, 'FUEL SHUTOFF', w / 2, 66, 27, '#fff', { cond: 1 }); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w / 2 - 12, 86); g.lineTo(w / 2 + 12, 86); g.lineTo(w / 2, 112); g.fill(); weather(g, w, h, .6, 'so'); });
    L.waste = a(256, 96, (g, w, h) => { tx(g, 'GULFSIDE WASTE', w / 2, 30, 30, '#e8e4d8', { cond: 1 }); tx(g, '555-0142 · NO HAZARDOUS MATERIAL', w / 2, 68, 15, '#e8e4d8', { cond: 1 }); const r = GT.rng('wst'); g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(r() * w, r() * h, 1 + r() * 7, 1 + r() * 3); } g.globalCompositeOperation = 'source-over'; });
    L.deliver = a(192, 128, (g, w, h) => label(g, w, h, 'DELIVERIES|6AM – 2PM|RING BELL', '#f4f2ea', '#111', { cond: 1, k: .8, border: '#111', wx: .9 }));
    L.danger = a(128, 96, (g, w, h) => { g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#c21a1a'; g.fillRect(0, 0, w, 34); tx(g, 'DANGER', w / 2, 18, 22, '#fff'); tx(g, 'HIGH VOLTAGE', w / 2, 54, 17, '#111', { cond: 1 }); tx(g, 'KEEP OUT', w / 2, 78, 17, '#111', { cond: 1 }); weather(g, w, h, .8, 'dg'); });
    L.unit = a(128, 64, (g, w, h) => { g.fillStyle = '#d8dadc'; g.fillRect(0, 0, w, h); tx(g, 'TRADEWIND', 44, 16, 13, '#1c3f94', { it: 1 }); for (let i = 0; i < 5; i++) { g.fillStyle = '#555'; g.fillRect(6, 30 + i * 6, 70 - i * 6, 1.5); } g.fillStyle = '#f4d21e'; g.fillRect(88, 6, 34, 52); g.fillStyle = '#111'; g.beginPath(); g.moveTo(105, 14); g.lineTo(93, 38); g.lineTo(117, 38); g.fill(); weather(g, w, h, .8, 'un'); });
    /* ---- interior */
    L.cigs = a(1024, 288, (g, w, h) => { g.fillStyle = '#2a2c30'; g.fillRect(0, 0, w, h); const r = GT.rng('cigs'), cols = ['#c8322a', '#f2ead8', '#1c3f94', '#2a8a5a', '#c9a23a', '#16181a', '#e8e4d8', '#7a1418', '#3aa0a8', '#e8602a', '#d8d8d2', '#4a2a6a'];
      for (let row = 0; row < 6; row++) { const y = 6 + row * 47; let x = 4; while (x < w - 10) { const n = 2 + (r() * 4 | 0), c = cols[r() * cols.length | 0], c2 = cols[r() * cols.length | 0], style = r() * 3 | 0; for (let k = 0; k < n && x < w - 22; k++) { g.fillStyle = c; g.fillRect(x, y, 19, 37); g.fillStyle = c2; if (style === 0) g.fillRect(x, y, 19, 11); else if (style === 1) { g.beginPath(); g.arc(x + 9.5, y + 16, 6, 0, 7); g.fill(); } else g.fillRect(x, y + 13, 19, 7); g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(x + 3, y + 28, 13, 2); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 18, y, 1, 37); x += 20; } x += 3; }
        g.fillStyle = '#d8d6cc'; g.fillRect(0, y + 38, w, 7); for (let k = 0; k < 50; k++) { g.fillStyle = k % 3 ? '#f4f2ea' : '#f4d21e'; g.fillRect(6 + k * 20.4, y + 39, 15, 5); } } });
    L.scratch = a(512, 192, (g, w, h) => { g.fillStyle = '#e8e6de'; g.fillRect(0, 0, w, h); const cs = [['#c8322a', '#ffe14a'], ['#1c3f94', '#fff'], ['#2a8a5a', '#ffe14a'], ['#4a2a6a', '#f4b62c'], ['#e8602a', '#fff'], ['#111', '#c9a23a'], ['#d8387a', '#fff'], ['#1a8a9a', '#ffe14a']], nm = ['7s', 'CASH', 'GOLD', 'ORO', '$$$', 'BLACK', 'ROSA', 'MAR'];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 8; i++) { const k = (i + j * 3) % 8, x = 6 + i * 63, y = 6 + j * 93; g.fillStyle = cs[k][0]; g.fillRect(x, y, 57, 84); g.fillStyle = cs[k][1]; g.fillRect(x + 5, y + 36, 47, 30); tx(g, nm[k], x + 28, y + 19, 17, cs[k][1], { max: 50 }); tx(g, '$' + [1, 2, 5, 10, 20, 30, 3, 5][k], x + 28, y + 52, 19, cs[k][0]); g.fillStyle = '#111'; g.fillRect(x + 18, y + 72, 21, 8); tx(g, String(i + j * 8 + 1), x + 28, y + 76.5, 8, '#fff', { cond: 1 }); } });
    L.price = a(1024, 20, (g, w, h) => { g.fillStyle = '#d6d4cc'; g.fillRect(0, 0, w, h); const r = GT.rng('price'); for (let x = 4; x < w - 30;) { const ww = 22 + r() * 8, sale = r() < .18; g.fillStyle = sale ? '#f4d21e' : '#f6f5f0'; g.fillRect(x, 2, ww, h - 4); g.fillStyle = sale ? '#c21a1a' : '#222'; g.fillRect(x + 3, 6, ww * .45, 6); g.fillStyle = '#777'; g.fillRect(x + 3, 14, ww - 6, 1.5); x += ww + 6 + r() * 14; } });
    L.wet = a(128, 256, (g, w, h) => { g.fillStyle = '#f0c21a'; g.fillRect(0, 0, w, h); tx(g, 'CAUTION', w / 2, 34, 25, '#111'); tx(g, 'CUIDADO', w / 2, 60, 19, '#111', { cond: 1 }); g.fillStyle = '#111'; g.beginPath(); g.moveTo(w / 2, 82); g.lineTo(22, 178); g.lineTo(w - 22, 178); g.fill(); g.fillStyle = '#f0c21a'; g.beginPath(); g.arc(w / 2 + 6, 114, 8, 0, 7); g.fill(); g.lineWidth = 7; g.strokeStyle = '#f0c21a'; g.beginPath(); g.moveTo(w / 2 + 4, 124); g.lineTo(w / 2 - 6, 146); g.lineTo(w / 2 - 18, 166); g.moveTo(w / 2 - 6, 146); g.lineTo(w / 2 + 14, 158); g.stroke(); tx(g, 'WET FLOOR', w / 2, 204, 21, '#111'); tx(g, 'PISO MOJADO', w / 2, 230, 16, '#111', { cond: 1 }); weather(g, w, h, .5, 'wet'); });
    L.coffeeFace = a(256, 128, (g, w, h) => { g.fillStyle = '#2a1a10'; g.fillRect(0, 0, w, h); tx(g, 'CAFÉ', 70, 44, 40, '#f2d9a8', { it: 1 }); tx(g, 'SOL', 70, 88, 34, SUN, { it: 1 }); [['SM', '.99'], ['MD', '1.49'], ['LG', '1.89']].forEach((d, i) => { tx(g, d[0], 150, 30 + i * 34, 19, '#f2d9a8', { cond: 1, al: 'left' }); tx(g, d[1], 244, 30 + i * 34, 22, '#fff', { cond: 1, al: 'right' }); }); });
    L.cases = a(256, 128, (g, w, h) => { g.fillStyle = '#e8791c'; g.fillRect(0, 0, w, h); g.fillStyle = '#f3b934'; g.beginPath(); g.arc(46, 64, 36, 0, 7); g.fill(); tx(g, 'SUNDROP', 150, 44, 31, '#fff', { it: 1, stroke: '#a8400c', max: 170 }); tx(g, '12 PACK · 12 FL OZ CANS', 150, 86, 14, '#5a1c04', { cond: 1 }); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h); });
    L.aisle = [['1', 'CHIPS · SNACKS'], ['2', 'CANDY · GUM'], ['3', 'AUTO · HOME'], ['4', 'GROCERY']].map(d => a(256, 80, (g, w, h) => { g.fillStyle = TEAL; g.fillRect(0, 0, w, h); g.fillStyle = CORAL; g.fillRect(0, h - 8, w, 8); tx(g, d[0], 34, h / 2 - 2, 48, '#fff'); tx(g, d[1], 154, h / 2 - 3, 23, '#fff', { cond: 1, max: 180 }); }));
    L.promo = a(256, 64, (g, w, h) => { g.fillStyle = '#f4d21e'; g.fillRect(0, 0, w, h); tx(g, '2 FOR $4', w / 2, h / 2 + 2, 40, '#c21a1a'); });
    L.promo2 = a(256, 64, (g, w, h) => { g.fillStyle = '#c21a1a'; g.fillRect(0, 0, w, h); tx(g, 'NEW! PRUÉBALO', w / 2, h / 2 + 2, 30, '#fff', { cond: 1 }); });
    L.wecard = a(256, 64, (g, w, h) => { g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#c21a1a'; g.fillRect(0, 0, 84, h); tx(g, 'WE', 42, 20, 22, '#fff'); tx(g, 'CARD', 42, 46, 22, '#fff'); tx(g, 'UNDER 27? ID REQUIRED', 168, 24, 15, '#111', { cond: 1 }); tx(g, 'TOBACCO · ALCOHOL · LOTTO', 168, 46, 12, '#444', { cond: 1 }); });
    L.keypad = a(96, 128, (g, w, h) => { g.fillStyle = '#17181b'; g.fillRect(0, 0, w, h); const ks = '123456789*0#'; for (let i = 0; i < 12; i++) { const x = 8 + (i % 3) * 28, y = 8 + (i / 3 | 0) * 29; rr(g, x, y, 24, 24, 3); g.fillStyle = i === 9 ? '#c21a1a' : i === 11 ? '#2a8a5a' : '#c9ccd0'; g.fill(); tx(g, ks[i], x + 12, y + 13, 15, '#111', { cond: 1 }); } });
    A.texture = A.tex();

    /* ================= emissive atlas (lit signs, screens, neon, light pools) */
    const Ag = Atlas(2048, 1280, '#000'), b = (w, h, f) => Ag.add(w, h, f); G = {};
    const band = (g, w, h) => { g.fillStyle = TEAL; g.fillRect(0, 0, w, h); g.fillStyle = SUN; g.fillRect(0, h * .76, w, h * .07); g.fillStyle = CORAL; g.fillRect(0, h * .84, w, h * .1); g.fillStyle = TEAL2; g.fillRect(0, 0, w, h * .05); };
    G.stripe = b(64, 128, band);
    G.logoBand = b(640, 128, (g, w, h) => { band(g, w, h); g.fillStyle = TEAL; g.fillRect(0, h * .05, w, h * .68); logo(g, 92, h * .52, 54); tx(g, 'SOLMAR', 388, h * .4, 84, '#fff', { it: 1, max: 440 }); });
    G.pylonBrand = b(512, 320, (g, w, h) => { g.fillStyle = '#d9d5c6'; g.fillRect(0, 0, w, h); g.fillStyle = TEAL; g.fillRect(0, h * .7, w, h * .3); g.fillStyle = CORAL; g.fillRect(0, h * .66, w, h * .05); logo(g, w / 2, h * .46, 118, '#2ab3ad', TEAL); tx(g, 'SOLMAR', w / 2, h * .855, 82, '#fff', { it: 1 }); });
    G.pylonPrice = b(512, 480, (g, w, h) => { g.fillStyle = '#101214'; g.fillRect(0, 0, w, h); [['REGULAR', '3.49', TEAL, '#ff2a14'], ['PLUS', '3.89', TEAL, '#ff2a14'], ['DIESEL', '4.19', '#1f7a3c', '#3cff5a']].forEach((d, i) => { const y = 8 + i * 158; g.fillStyle = d[2]; g.fillRect(8, y, 176, 148); tx(g, d[0], 96, y + 56, 40, '#fff', { cond: 1, max: 160 }); tx(g, i === 2 ? 'ULSD #2' : 'UNLEADED', 96, y + 104, 22, '#cfe', { cond: 1 }); g.drawImage(lcd(d[1], 384, 192, d[3]), 190, y, 270, 148); g.fillStyle = d[3]; g.font = '700 30px ' + COND; g.textAlign = 'left'; g.fillText('9', 470, y + 44); g.fillRect(466, y + 62, 28, 3); g.fillText('10', 462, y + 86); }); });
    G.pylonLow = b(512, 144, (g, w, h) => { g.fillStyle = '#d9d5c6'; g.fillRect(0, 0, w, h); tx(g, 'FOOD MART', w / 2, 44, 60, CORAL, { it: 1 }); tx(g, 'COLD BEER · ICE · ATM · LOTTO', w / 2, 108, 34, TEAL2, { cond: 1 }); });
    G.storeSign = b(1024, 112, (g, w, h) => { g.fillStyle = TEAL2; g.fillRect(0, 0, w, h); g.fillStyle = CORAL; g.fillRect(0, h - 10, w, 10); g.fillStyle = SUN; g.fillRect(0, h - 16, w, 6); logo(g, 74, 62, 52); tx(g, 'SOLMAR', 300, 50, 74, '#fff', { it: 1 }); tx(g, 'FOOD MART', 668, 50, 62, SUN, { it: 1 }); tx(g, '24', 930, 38, 50, '#fff'); tx(g, 'HOURS', 930, 78, 24, '#fff', { cond: 1 }); });
    G.pumpDisp = b(384, 320, (g, w, h) => { g.fillStyle = '#0c0d10'; g.fillRect(0, 0, w, h); g.fillStyle = '#23262b'; rr(g, 10, 10, w - 20, 170, 8); g.fill(); tx(g, 'THIS SALE $', 22, 34, 17, '#c8ccd0', { cond: 1, al: 'left' }); g.drawImage(lcd('42.18', 256, 96, '#ffc040'), 126, 16, 240, 74); tx(g, 'GALLONS', 22, 116, 17, '#c8ccd0', { cond: 1, al: 'left' }); g.drawImage(lcd('12.086', 256, 96, '#ffc040'), 126, 98, 240, 74);
      [['REGULAR', '87', '3.49', '#e8c21a', '#111'], ['PLUS', '89', '3.89', '#e8e6de', '#111'], ['SUPER', '93', '4.29', '#c8322a', '#fff'], ['DIESEL', '', '4.19', '#1f7a3c', '#fff']].forEach((d, i) => { const x = 10 + i * 92; rr(g, x, 192, 86, 118, 6); g.fillStyle = d[3]; g.fill(); tx(g, d[0], x + 43, 208, 15, d[4], { cond: 1 }); tx(g, d[1] || 'ULS', x + 43, 238, d[1] ? 34 : 22, d[4]); g.fillStyle = '#0a0a0a'; g.fillRect(x + 6, 262, 74, 40); g.drawImage(lcd(d[2], 128, 64), x + 8, 264, 70, 36); }); });
    G.pumpVal = b(448, 96, (g, w, h) => { g.fillStyle = TEAL; g.fillRect(0, 0, w, h); g.fillStyle = CORAL; g.fillRect(0, h - 12, w, 12); g.fillStyle = SUN; g.fillRect(0, h - 18, w, 6); logo(g, 60, 52, 40); tx(g, 'SOLMAR', 262, 40, 58, '#fff', { it: 1 }); });
    G.lcdS = b(128, 48, (g, w, h) => { g.fillStyle = '#0a0f0a'; g.fillRect(0, 0, w, h); g.drawImage(lcd('17.43', 128, 48, '#58ff7a'), 0, 0, w, h); });
    G.pos = b(128, 96, (g, w, h) => { g.fillStyle = '#16304a'; g.fillRect(0, 0, w, h); g.fillStyle = '#e8eef2'; g.fillRect(4, 4, 58, h - 8); for (let i = 0; i < 7; i++) { g.fillStyle = '#345'; g.fillRect(8, 10 + i * 11, 30 + (i * 7) % 18, 3); } const cs = ['#2a8a5a', '#c8322a', '#e8962a', '#1c6fb4', '#7a4a9a', '#58646e']; for (let i = 0; i < 9; i++) { g.fillStyle = cs[i % 6]; g.fillRect(68 + (i % 3) * 19, 6 + (i / 3 | 0) * 29, 16, 25); } });
    G.atmScr = b(128, 96, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1a56a8'); gr.addColorStop(1, '#0c2f66'); g.fillStyle = gr; g.fillRect(0, 0, w, h); tx(g, 'WELCOME', w / 2, 22, 17, '#fff', { cond: 1 }); tx(g, 'INSERT CARD', w / 2, 46, 15, '#ffe14a', { cond: 1 }); for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(i < 2 ? 6 : w - 46, 62 + (i % 2) * 14, 40, 8); } });
    G.atmTop = b(192, 64, (g, w, h) => { g.fillStyle = '#1a56a8'; g.fillRect(0, 0, w, h); tx(g, 'ATM', w / 2, h / 2 + 2, 48, '#fff'); });
    G.cctv = b(256, 160, (g, w, h) => { g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h); const hw = w / 2 - 3, hh = h / 2 - 3; for (let q = 0; q < 4; q++) { const x = 2 + (q % 2) * (hw + 2), y = 2 + (q >> 1) * (hh + 2); g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, hw, hh); g.clip(); const gr = g.createLinearGradient(0, 0, 0, hh); gr.addColorStop(0, q === 3 ? '#2c3438' : '#59625e'); gr.addColorStop(1, q === 3 ? '#11161a' : '#8a9088'); g.fillStyle = gr; g.fillRect(0, 0, hw, hh);
        if (q === 0) { g.fillStyle = '#2c302e'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(14 + i * 30, hh); g.lineTo(40 + i * 14, 18); g.lineTo(50 + i * 14, 18); g.lineTo(36 + i * 30, hh); g.fill(); } } else if (q === 1) { g.fillStyle = '#3a3e3c'; g.fillRect(0, hh * .5, hw, hh * .22); g.fillStyle = '#1c1e1e'; g.fillRect(hw * .55, hh * .2, 14, hh * .34); g.beginPath(); g.arc(hw * .55 + 7, hh * .16, 6, 0, 7); g.fill(); g.fillStyle = '#cfd4cf'; g.fillRect(hw * .2, hh * .38, 20, 12); }
        else if (q === 2) { g.fillStyle = '#c8cec8'; g.fillRect(0, 0, hw, hh * .3); g.fillStyle = '#30343a'; for (let i = 0; i < 3; i++) g.fillRect(12 + i * 36, hh * .34, 20, hh * .5); g.fillStyle = '#1a1c1e'; g.fillRect(hw * .6, hh * .5, 34, 14); } else { g.fillStyle = '#0a0c0e'; g.fillRect(hw * .1, hh * .4, hw * .5, hh * .5); g.fillStyle = '#5a646a'; g.fillRect(hw * .64, hh * .3, hw * .3, hh * .1); }
        g.fillStyle = 'rgba(255,255,255,.06)'; for (let i = 0; i < hh; i += 2) g.fillRect(0, i, hw, 1); tx(g, 'CAM ' + (q + 1), 4, 8, 9, '#fff', { cond: 1, al: 'left' }); tx(g, '11-14 18:12:0' + q, hw - 4, hh - 7, 8, '#fff', { cond: 1, al: 'right' }); g.fillStyle = '#e02a1a'; g.beginPath(); g.arc(hw - 8, 8, 3, 0, 7); g.fill(); g.restore(); } });
    G.fr = [['ICE COLD CERVEZA · BEER', '#123d6a'], ['SODAS · ENERGY · TÉ', '#0c6b70'], ['AGUA · JUGOS · DAIRY', '#136a8a']].map(d => b(640, 56, (g, w, h) => { g.fillStyle = d[1]; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(0, h - 5, w, 5); tx(g, d[0], w / 2, h / 2 - 1, 34, '#fff', { cond: 1 }); }));
    G.slush = b(256, 96, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#d8286a'); gr.addColorStop(1, '#2a7ad8'); g.fillStyle = gr; g.fillRect(0, 0, w, h); tx(g, 'FRÍO', 70, h / 2, 50, '#fff', { it: 1, stroke: '#3a0a4a' }); tx(g, 'SLUSH', 180, h / 2, 44, '#ffe14a', { it: 1, stroke: '#3a0a4a' }); });
    G.fountain = b(384, 96, (g, w, h) => { g.fillStyle = '#e8e6de'; g.fillRect(0, 0, w, h); ['#c8322a', '#e8791c', '#2a8a5a', '#1c3f94', '#4a2a6a', '#111', '#c9a23a', '#1a8a9a'].forEach((c, i) => { g.fillStyle = c; rr(g, 6 + i * 47, 8, 42, h - 16, 6); g.fill(); g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(27 + i * 47, h / 2, 13, 0, 7); g.fill(); }); });
    G.hotdog = b(256, 64, (g, w, h) => { g.fillStyle = '#b3242c'; g.fillRect(0, 0, w, h); tx(g, 'ROLLER GRILL', w / 2, 22, 26, '#ffe14a'); tx(g, 'HOT DOGS · TAQUITOS · 2 FOR $3', w / 2, 48, 15, '#fff', { cond: 1 }); });
    G.lottoTop = b(256, 96, (g, w, h) => { g.fillStyle = '#4c1a68'; g.fillRect(0, 0, w, h); tx(g, 'CORAL CASH', w / 2, 24, 28, '#ffe14a'); g.fillStyle = '#0a0a0a'; g.fillRect(28, 44, 200, 44); g.drawImage(lcd('214', 256, 96, '#ffb020'), 60, 46, 140, 40); });
    G.exit = b(128, 64, (g, w, h) => { g.fillStyle = '#0c2a12'; g.fillRect(0, 0, w, h); tx(g, 'EXIT', w / 2, h / 2 + 2, 44, '#4cff6a'); });
    G.white = b(32, 32, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); });
    const neon = (t, w, h, col, extra) => b(w, h, g => { g.drawImage(GT.signTex(t, { style: 'neon', w, h, color: col }).image, 0, 0); if (extra) extra(g, w, h); });
    const tubeRect = (g, x, y, w, h, r, col) => { g.save(); g.shadowColor = col; g.shadowBlur = 14; g.strokeStyle = col; g.lineWidth = 5; rr(g, x, y, w, h, r); g.stroke(); g.shadowBlur = 4; g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.stroke(); g.restore(); };
    G.nOpen = neon('OPEN', 384, 176, '#ff3a2a', (g, w, h) => tubeRect(g, 14, 14, w - 28, h - 28, 30, '#3a9cff'));
    G.nLotto = neon('LOTTO', 384, 128, '#ffb020', (g, w, h) => tubeRect(g, 12, 12, w - 24, h - 24, 20, '#3cff7a'));
    G.nBeer = neon('PLAYA', 384, 160, '#ff4aa8', (g, w, h) => { g.save(); g.shadowColor = '#3cff7a'; g.shadowBlur = 12; g.strokeStyle = '#3cff7a'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(40, h - 14); g.quadraticCurveTo(46, 60, 36, 30); for (let i = 0; i < 5; i++) { g.moveTo(36, 30); g.quadraticCurveTo(36 + Math.cos(i * 1.2 + 2.6) * 22, 12, 36 + Math.cos(i * 1.2 + 2.6) * 34, 30 + (i % 2) * 10); } g.stroke(); g.restore(); });
    G.nAtm = neon('ATM', 256, 112, '#3ab8ff', (g, w, h) => tubeRect(g, 10, 10, w - 20, h - 20, 16, '#ff3a2a'));
    G.pool = b(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.55)'); gr.addColorStop(.7, 'rgba(255,255,255,.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    G.beam = b(64, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(.3, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); const g2 = g.createLinearGradient(0, 0, w, 0); g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(.12, 'rgba(0,0,0,0)'); g2.addColorStop(.88, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = g2; g.fillRect(0, 0, w, h); });
    Ag.texture = Ag.tex();

    /* ================= product atlas: 8×8 label designs */
    const pc = document.createElement('canvas'); pc.width = pc.height = 1024; const g = pc.getContext('2d'), r = GT.rng('solmar-products');
    const names = ['ZAP', 'KOKO', 'MAIZ', 'BRISA', 'LUMO', 'TIKI', 'ORO', 'PICA', 'NUBE', 'RAYO', 'DUNA', 'FARO', 'MOKA', 'COCO', 'LIMA', 'CHISPA', 'OLA', 'TOSTI', 'RICO', 'BOOM', 'FRIZ', 'MANI', 'CROC', 'SOL'];
    const pal = [['#c2382e', '#f2d23a'], ['#1f5fa6', '#f2f2ec'], ['#de8a1e', '#5a2410'], ['#2f8749', '#f3e9c6'], ['#68308a', '#f0c23a'], ['#dcd5c2', '#b3242c'], ['#15181c', '#e3b53a'], ['#dc5a88', '#ffffff'], ['#1b9c9c', '#ffffff'], ['#ecc21a', '#bb3526'], ['#7a4a2a', '#f0e0c0'], ['#f2f2ec', '#1f5fa6'], ['#a82a52', '#ffe9a0'], ['#3a6a2a', '#e8f2a0']];
    const shade = (s, a, b2) => { const gr = g.createLinearGradient(0, 0, s, s); gr.addColorStop(0, 'rgba(255,255,255,' + a + ')'); gr.addColorStop(.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,' + b2 + ')'); g.fillStyle = gr; g.fillRect(0, 0, s, s); };
    const liquids = ['#3a1c0c', '#5a2c10', '#2c4a1c', '#c9d8dc', '#d8861c', '#b8262a', '#e9e2c8', '#3a6a9a'];
    for (let i = 0; i < 64; i++) { const row = i >> 3, col = i & 7, c = pal[(i * 5 + row * 3 + (r() * 3 | 0)) % pal.length], bg = c[0], fg = c[1], nm = names[(i * 7 + row) % names.length], s = 128; g.save(); g.translate(col * s, row * s); g.beginPath(); g.rect(0, 0, s, s); g.clip(); g.fillStyle = bg; g.fillRect(0, 0, s, s);
      if (row < 3) { shade(s, .22, .28); g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, s, 11); tx(g, 'SOLMAR SELECT · ' + ['CEREAL', 'CRACKERS', 'COOKIES', 'PASTA', 'RICE', 'TEA', 'MIX', 'SNACK'][col], s / 2, 6, 7, '#eee', { cond: 1 });
        if (i % 3 === 0) { g.fillStyle = fg; g.beginPath(); g.moveTo(0, 30); g.lineTo(s, 18); g.lineTo(s, 52); g.lineTo(0, 64); g.fill(); tx(g, nm, s / 2, 42, 25, bg, { max: s * .84, it: 1 }); } else { tx(g, nm, s / 2, 36, 26, fg, { max: s * .84, it: i & 1, stroke: 'rgba(0,0,0,.4)' }); g.fillStyle = fg; g.fillRect(s * .2, 52, s * .6, 2); }
        tx(g, ['original', 'honey oat', 'sea salt', 'family size', 'classic', 'extra crunch', 'whole grain', 'fiesta'][(i * 3) % 8], s / 2, 62, 9, fg, { cond: 1, it: 1 });
        const bw = g.createRadialGradient(s * .42, s * .72, 3, s * .42, s * .74, s * .26); bw.addColorStop(0, '#f6efe0'); bw.addColorStop(.75, '#e2d6bc'); bw.addColorStop(.8, 'rgba(0,0,0,.35)'); bw.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = bw; g.beginPath(); g.ellipse(s * .42, s * .74, s * .3, s * .17, 0, 0, 7); g.fill();
        const fc = ['#d8a24a', '#b86a2a', '#e8c66a', '#c2382e', '#8a5a2a'][i % 5]; for (let k = 0; k < 26; k++) { const a = r() * 7, d = Math.sqrt(r()) * s * .2; g.fillStyle = k % 4 ? fc : '#f2e2b0'; g.beginPath(); g.ellipse(s * .42 + Math.cos(a) * d, s * .72 + Math.sin(a) * d * .5, 3 + r() * 3, 2 + r() * 2, r() * 3, 0, 7); g.fill(); }
        g.fillStyle = '#f4f2ea'; g.fillRect(s * .76, s * .58, s * .19, s * .3); for (let k = 0; k < 7; k++) { g.fillStyle = '#333'; g.fillRect(s * .78, s * .61 + k * 5, s * (.15 - (k % 3) * .03), 1.2); } g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(6, s - 10, s * .3, 2); tx(g, 'NET WT ' + (8 + i % 9) + ' OZ', s * .7, s - 8, 7, 'rgba(255,255,255,.85)', { cond: 1 }); }
      else if (row < 5) { const gr = g.createRadialGradient(s * .5, s * .4, 6, s / 2, s / 2, s * .75); gr.addColorStop(0, 'rgba(255,255,255,.34)'); gr.addColorStop(1, 'rgba(0,0,0,.35)'); g.fillStyle = gr; g.fillRect(0, 0, s, s);
        g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, 0, s, 9); g.fillRect(0, s - 9, s, 9); for (let k = 0; k < 32; k++) { g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(k * 4, 0, 1.5, 9); g.fillRect(k * 4, s - 9, 1.5, 9); }
        g.save(); g.translate(s / 2, s * .34); g.rotate(-.1); g.fillStyle = fg; rr(g, -s * .42, -15, s * .84, 30, 15); g.fill(); tx(g, nm, 0, 1, 23, bg, { max: s * .74, it: 1 }); g.restore(); tx(g, ['kettle chips', 'tortilla', 'puffs', 'plantain', 'pork rinds', 'pretzels', 'popcorn', 'hot fries'][col], s / 2, s * .52, 10, fg, { cond: 1, it: 1 });
        const fc = row === 3 ? ['#e8c04a', '#d8a030', '#f0d070'] : ['#d87a2a', '#c2501e', '#e8a040']; for (let k = 0; k < 18; k++) { g.fillStyle = fc[k % 3]; g.beginPath(); g.ellipse(s * (.2 + r() * .6), s * (.68 + r() * .16), 9 + r() * 5, 5 + r() * 4, r() * 3, 0, 7); g.fill(); g.strokeStyle = 'rgba(90,40,10,.35)'; g.lineWidth = .8; g.stroke(); }
        if (i & 1) { g.save(); g.translate(s * .82, s * .2); star(g, 0, 0, 13, 10, 10, '#f6d21e'); tx(g, 'HOT', 0, 0, 8, '#c21a1a'); g.restore(); } tx(g, (2 + i % 7) + '.' + (i % 2 ? '75' : '5') + ' OZ', s / 2, s - 16, 7, 'rgba(255,255,255,.8)', { cond: 1 }); }
      else if (row === 5) { shade(s, .25, .3); g.fillStyle = 'rgba(0,0,0,.35)'; for (let k = 0; k < 22; k++) { g.beginPath(); g.moveTo(0, k * 6); g.lineTo(5, k * 6 + 3); g.lineTo(0, k * 6 + 6); g.fill(); g.beginPath(); g.moveTo(s, k * 6); g.lineTo(s - 5, k * 6 + 3); g.lineTo(s, k * 6 + 6); g.fill(); }
        g.fillStyle = fg; g.fillRect(8, s * .26, s - 16, s * .48); g.fillStyle = bg; g.fillRect(8, s * .3, s - 16, 2); g.fillRect(8, s * .7 - 2, s - 16, 2); tx(g, nm, s / 2, s * .49, 30, bg, { max: s * .78, it: 1 }); tx(g, ['milk chocolate', 'peanut', 'caramel', 'chicle · gum', 'mints', 'gomitas', 'coconut', 'almond'][col], s / 2, s * .84, 10, fg, { cond: 1 }); tx(g, 'KING SIZE', s / 2, s * .14, 10, fg, { cond: 1 }); }
      else if (row === 6) { const gr = g.createLinearGradient(0, 0, 0, s); gr.addColorStop(0, '#d0d4d8'); gr.addColorStop(.06, '#8a8e92'); gr.addColorStop(.09, bg); gr.addColorStop(.92, bg); gr.addColorStop(.95, '#8a8e92'); gr.addColorStop(1, '#5a5e62'); g.fillStyle = gr; g.fillRect(0, 0, s, s);
        for (let k = 0; k < 2; k++) { g.save(); g.translate(s * (.25 + k * .5), 0); g.fillStyle = fg; g.beginPath(); g.moveTo(-s * .2, s * .68); g.quadraticCurveTo(0, s * .4, s * .2, s * .3); g.lineTo(s * .2, s * .42); g.quadraticCurveTo(0, s * .5, -s * .2, s * .8); g.fill(); tx(g, nm, 0, s * .26, 15, fg, { max: s * .42, it: 1 }); tx(g, ['COLA', 'LIMÓN', 'ENERGY', 'NARANJA', 'ZERO', 'UVA', 'PIÑA', 'ROOT BEER'][col], 0, s * .86, 8, fg, { cond: 1, max: s * .42 }); g.restore(); } }
      else { const lq = liquids[col]; g.fillStyle = lq; g.fillRect(0, 0, s, s); const hl = g.createLinearGradient(0, 0, s, 0); for (let k = 0; k < 2; k++) { hl.addColorStop(k * .5 + .05, 'rgba(255,255,255,0)'); hl.addColorStop(k * .5 + .12, 'rgba(255,255,255,.45)'); hl.addColorStop(k * .5 + .19, 'rgba(255,255,255,0)'); } g.fillStyle = hl; g.fillRect(0, 0, s, s);
        g.fillStyle = col < 3 ? '#c9a23a' : col === 3 || col === 7 ? '#2a6ab0' : '#e8e6de'; g.fillRect(0, 0, s, 7); g.fillStyle = col === 3 ? '#e9f2f6' : col === 6 ? '#2a6ab0' : bg; g.fillRect(0, s * .36, s, s * .42); g.fillStyle = fg; g.fillRect(0, s * .36, s, 3); g.fillRect(0, s * .78 - 3, s, 3);
        for (let k = 0; k < 2; k++) { g.save(); g.translate(s * (.25 + k * .5), s * .57); g.fillStyle = fg; g.beginPath(); g.ellipse(0, -2, s * .19, s * .1, 0, 0, 7); g.fill(); tx(g, nm, 0, -1, 14, col === 3 ? '#2a6ab0' : bg, { max: s * .34, it: 1 }); tx(g, ['CERVEZA', 'LAGER', 'IMPORT', 'AGUA', 'JUGO', 'SODA', 'LECHE', 'SPORT'][col], 0, s * .15, 7, fg, { cond: 1 }); g.restore(); } }
      g.restore(); }
    const pt = new T.CanvasTexture(pc); pt.encoding = T.sRGBEncoding; pt.anisotropy = 4;
    return { lit: A.texture, glow: Ag.texture, prod: pt };
  }

  /* ================================================================== materials */
  function buildMats() {
    const t0 = performance.now(), m = n => GT.mat(n), mo = (n, o) => GT.mat(n, o);
    M = { asph: m('asphalt_worn'), conc: m('concrete'), curbY: m('curb_paint_yellow'), curbR: mo('curb_paint_yellow', { color: 0xa23a30 }), paintW: m('road_paint_white'),
      stucco: m('stucco_cream'), teal: m('stucco_teal'), cinder: m('cinderblock'), tar: m('roof_tar'), galv: m('metal_galv'), white: m('metal_painted_white'), dark: m('metal_dark'), alu: m('aluminium_brushed'),
      chrome: m('chrome'), rubber: m('rubber'), pBlack: m('plastic_black'), pGrey: m('plastic_grey'), mYellow: m('metal_painted_yellow'), mRed: m('metal_painted_red'), mTeal: mo('metal_painted_blue', { color: 0x14666a }),
      wood: m('wood_plank'), grass: m('grass_dry'), glass: m('glass_clear') };
    ['oil_stain', 'tire_marks', 'crack', 'rust_run', 'grime_streak', 'water_stain', 'graffiti_a', 'graffiti_b', 'patch', 'handicap', 'gum_spots', 'puddle'].forEach(n => GT.decalMat(n));
    const tex = buildAtlases(); info.matMs = performance.now() - t0;
    let cln = 0; const cl = (n, d, nn) => { const c = m(n).clone(); c.name = 'station_int_' + n + (cln++); return selfLit(c, d, nn); };
    M.tile = cl('tile_floor', .03, .5); M.ceil = cl('plastic_white', .05, .6); M.ceil.roughness *= 1.8; M.iwall = cl('plastic_white', .04, .5); M.iwall.roughness *= 1.7; M.iwall.color.setRGB(.86, .84, .78); M.shelf = cl('plastic_white', .04, .5); M.shelf.color.setRGB(.84, .83, .8);
    M.fridge = m('plastic_white').clone(); M.fridge.name = 'station_fridge'; M.fridge.emissive = new T.Color(.8, .92, 1); myGlow(M.fridge, new T.Color(.8, .92, 1), .35, 1.5, 'emissive');
    M.glassF = m('glass_clear').clone(); M.glassF.name = 'station_glass_front'; M.glassF.roughness = .075; M.glassF.reflectivity = .5; M.glassF.envMapIntensity = 2.4;
    const po = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    M.lit = new T.MeshStandardMaterial(Object.assign({ map: tex.lit, roughness: .62, metalness: 0, alphaTest: .45 }, po)); M.lit.name = 'station_atlas';
    M.litInt = selfLit(M.lit.clone(), .04, .55); M.litInt.name = 'station_atlas_int';
    M.glowLit = new T.MeshStandardMaterial(Object.assign({ map: tex.glow, emissiveMap: tex.glow, emissive: new T.Color(1, 1, 1), roughness: .4, metalness: 0 }, po)); M.glowLit.name = 'station_glow'; myGlow(M.glowLit, WHITE, .2, 1.05, 'emissiveIntensity');
    M.add = new T.MeshBasicMaterial({ map: tex.glow, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false }); M.add.name = 'station_neon'; myGlow(M.add, WHITE, 1.3, 4.2);
    M.spill = new T.MeshBasicMaterial({ map: tex.glow, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); M.spill.name = 'station_spill'; myGlow(M.spill, new T.Color(.82, .92, 1), 0, .34);
    M.prod = new T.MeshStandardMaterial({ map: tex.prod, roughness: .5, metalness: 0 }); M.prod.name = 'station_products'; selfLit(M.prod, .04, .5);
    M.strobe = new T.MeshBasicMaterial({ color: 0x1a0303 }); M.strobe.name = 'station_strobe';
    M.lc = ownLight('light_cool', 1.6, .42); M.lcan = ownLight('light_cool', 1.2, .8); M.lw = ownLight('light_warm', 1.2, .6);
  }

  /* ================================================================== product batcher (one mesh, uv into the product atlas) */
  function Batch() { this.p = []; this.n = []; this.u = []; this.i = []; }
  Batch.prototype.quad = function (a, b, c, d, nx, ny, nz, u0, v0, u1, v1) { const k = this.p.length / 3; this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]); this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz); this.u.push(u0, v0, u1, v0, u1, v1, u0, v1); this.i.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  const cellUV = c => { const e = 3 / 1024, u0 = (c & 7) / 8 + e, v1 = 1 - (c >> 3) / 8 - e; return [u0, v1 - 1 / 8 + 2 * e, u0 + 1 / 8 - 2 * e, v1]; };
  /** box product: w along the shelf, d deep; face = side the label faces ('N' +Z, 'S' -Z, 'W' -X, 'E' +X) */
  Batch.prototype.box = function (cx, cy, cz, w, h, d, cell, face) { const xs = face === 'N' || face === 'S' ? w : d, zs = face === 'N' || face === 'S' ? d : w, x0 = cx - xs / 2, x1 = cx + xs / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - zs / 2, z1 = cz + zs / 2, f = cellUV(cell), su = [f[0] + .004, f[1] + .05, f[0] + .012, f[1] + .07];
    const uv = k => k === face ? f : su;
    let q = uv('N'); this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, q[0], q[1], q[2], q[3]);
    q = uv('S'); this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, q[0], q[1], q[2], q[3]);
    q = uv('E'); this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, q[0], q[1], q[2], q[3]);
    q = uv('W'); this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, q[0], q[1], q[2], q[3]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0, su[0], su[1], su[2], su[3]); };
  /** can / bottle (lathe): label wraps once around; neck=true gives shoulder + neck + cap */
  Batch.prototype.cyl = function (cx, cy, cz, r, h, cell, neck, rot, seg) { const f = cellUV(cell), n = seg || 8, a0 = rot || 0, dv = f[3] - f[1];
    const pr = neck ? [[1, 0, 0], [1, .68, .66], [.5, .8, .8], [.36, .84, .84], [.36, .95, .92], [.42, .95, .955], [.42, 1, .99]] : [[.9, 0, 0], [1, .03, .04], [1, .96, .95], [.88, 1, .99]];
    for (let i = 0; i < n; i++) { const a = a0 + i / n * GT.TAU, b = a0 + (i + 1) / n * GT.TAU, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), ua = GT.lerp(f[0], f[2], i / n), ub = GT.lerp(f[0], f[2], (i + 1) / n);
      for (let j = 0; j < pr.length - 1; j++) { const p0 = pr[j], p1 = pr[j + 1], r0 = r * p0[0], r1 = r * p1[0], y0 = cy + h * p0[1], y1 = cy + h * p1[1], v0 = f[1] + dv * p0[2], v1 = f[1] + dv * p1[2], k = this.p.length / 3, ny = r0 > r1 ? .6 : 0;
        this.p.push(cx + ca * r0, y0, cz + sa * r0, cx + cb * r0, y0, cz + sb * r0, cx + cb * r1, y1, cz + sb * r1, cx + ca * r1, y1, cz + sa * r1); this.n.push(ca, ny, sa, cb, ny, sb, cb, ny, sb, ca, ny, sa); this.u.push(ua, v0, ub, v0, ub, v1, ua, v1); this.i.push(k, k + 2, k + 1, k, k + 3, k + 2); }
      const pt = pr[pr.length - 1], rt = r * pt[0], yt = cy + h, k = this.p.length / 3, vt = f[1] + dv * .985; this.p.push(cx + ca * rt, yt, cz + sa * rt, cx + cb * rt, yt, cz + sb * rt, cx, yt, cz); this.n.push(0, 1, 0, 0, 1, 0, 0, 1, 0); this.u.push(ua, vt, ub, vt, ua, vt); this.i.push(k, k + 2, k + 1); } };
  Batch.prototype.mesh = function (mat) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(this.p), 3)); g.setAttribute('normal', new T.BufferAttribute(new Float32Array(this.n), 3)); g.setAttribute('uv', new T.BufferAttribute(new Float32Array(this.u), 2)); g.setIndex(new T.BufferAttribute(new Uint32Array(this.i), 1)); const m = new T.Mesh(g, mat); m.receiveShadow = true; m.castShadow = false; m.name = 'station_products'; return m; };
  /** fill a shelf run along X (face N/S) or along Z (face W/E) with facings of products. kinds: array of atlas rows to draw from */
  function stock(a0, a1, y, front, face, maxH, kinds, depth) { const alongX = face === 'N' || face === 'S', sgn = face === 'N' || face === 'E' ? -1 : 1; let a = a0 + .015;
    while (a < a1 - .06) { const row = kinds[rnd() * kinds.length | 0], cell = row * 8 + (rnd() * 8 | 0); let w, h, d, cyl = false, neck = false;
      if (row < 3) { w = .12 + rnd() * .07; h = Math.min(maxH, .17 + rnd() * .1); d = .055 + rnd() * .04; } else if (row < 5) { w = .17 + rnd() * .06; h = Math.min(maxH, .22 + rnd() * .07); d = .07; } else if (row === 5) { w = .15 + rnd() * .04; h = Math.min(maxH, .07 + rnd() * .04); d = .14; } else { cyl = true; neck = row === 7; w = neck ? .068 + rnd() * .012 : .062 + rnd() * .006; h = neck ? Math.min(maxH * .92, .2 + rnd() * .05) : Math.min(maxH * .8, rnd() < .5 ? .118 : .155); d = w; }
      if (rnd() < .07) { a += w * (1 + rnd() * 2); continue; }
      const n = cyl ? 3 + (rnd() * 4 | 0) : 2 + (rnd() * 3 | 0);
      for (let k = 0; k < n && a + w < a1; k++) { const back = d / 2 + .012 + rnd() * .025, c = a + w / 2, f = front + sgn * back, lay = (depth || .3) > d * 2.4 && !cyl && rnd() < .5 ? 1 : 0;
        if (cyl) PB.cyl(alongX ? c : f, y, alongX ? f : c, w / 2, h, cell, neck, rnd() * 6, 7); else PB.box(alongX ? c : f, y + h / 2, alongX ? f : c, w, h, d, cell, face);
        if (lay && h < maxH * .5) PB.box(alongX ? c : f, y + h * 1.5 + .002, alongX ? f : c, w, h, d, cell, face);
        a += w + .005; } a += .01; } }

  /* ================================================================== LOT */
  function lot() {
    E(M.asph, S.x0, -.05, S.z0, S.x1, .03, S.z1);
    // pump apron (concrete) with saw-cut joints
    E(M.conc, 24.6, 0, -22.4, 43.4, .055, 6.4, .012);
    for (let x = 27.8; x < 43; x += 3.1) E(M.rubber, x - .007, .05, -22.38, x + .007, .0565, 6.38); for (let z = -19.3; z < 6; z += 3.2) E(M.rubber, 24.62, .05, z - .007, 43.38, .0565, z + .007);
    // trench drain along the east edge of the apron + catch basin
    E(M.dark, 43.42, .02, -20, 43.7, .04, 4); for (let z = -19.9; z < 4; z += .2) B(M.galv, .26, .012, .05, 43.56, .044, z); B(M.conc, .36, .03, 24.1, 43.56, .028, -8);
    B(M.dark, .62, .03, .62, 46.6, .028, -15.2, .004); for (let i = 0; i < 7; i++) B(M.galv, .56, .012, .035, 46.6, .046, -15.44 + i * .08);
    // store sidewalk + painted curb, door ramp
    E(M.conc, 47.76, 0, -31, 50, .15, 13, .012); E(M.curbY, 47.58, 0, -31, 47.78, .152, -14.2, .02); E(M.curbR, 47.58, 0, -14.2, 47.78, .152, .8, .02); E(M.curbY, 47.58, 0, .8, 47.78, .152, 13, .02);
    for (let z = -29.45; z < 13; z += 1.3) E(M.rubber, 47.79, .145, z - .005, 49.98, .1515, z + .005);
    B(M.conc, 1.15, .03, 2.1, 47.05, .083, DZ, .004, { rz: .125 }); B(M.conc, .04, .09, 2.1, 46.5, .03, DZ); for (let i = 0; i < 2; i++) B(M.conc, 1.15, .14, .06, 47.05, .03, DZ + (i ? 1.08 : -1.08), 0, { rz: .125 });
    B(M.mYellow, .62, .012, 2.0, 48.12, .153, DZ, .003); for (let i = 0; i < 6; i++) for (let j = 0; j < 20; j++) K.cyl(M.mYellow, .014, .02, .008, 47.87 + i * .1, .163, DZ - .95 + j * .1, { seg: 6 });
    aq(M.lit, L.fireLane, 3.4, .62, 46.9, .034, -11.6, { rx: -HP, ry: -HP }); aq(M.lit, L.noPark, 3.6, .62, 46.9, .034, -1.4, { rx: -HP, ry: -HP }); E(M.curbY, 46.1, .03, -14.2, 46.22, .034, .8);
    for (let z = -13.6; z < .6; z += 1.5) B(M.curbY, .1, .004, 1.75, 46.86, .032, z, 0, { ry: PI / 4 });
    // storefront crash bollards
    for (let z = -20.3; z <= 4.4; z += 2.6) { if (Math.abs(z - DZ) < 1.4) continue; bollard(47.98, z, .15); }
    bollard(47.98, DZ - 1.55, .15); bollard(47.98, DZ + 1.55, .15);
    // perpendicular stalls north of the fire lane: handicap + two regular
    const sx0 = 42.6, sx1 = 47.56; [.95, 4.45, 5.95, 8.7, 11.45].forEach(z => E(M.paintW, sx0, .03, z - .05, sx1, .0345, z + .05)); for (let x = sx0 + .3; x < sx1 - .2; x += .75) B(M.paintW, .09, .004, 1.9, x, .032, 5.2, 0, { ry: PI / 4 });
    dec('handicap', 1.5, 1.5, 44.6, .036, 2.7, -HP); [2.7, 7.3, 10.1].forEach(z => wheelStop(47.0, z));
    K.cyl(M.galv, .03, .03, 2.1, 47.95, 1.2, 2.7, { seg: 10 }); B(M.white, .02, .46, .31, 47.93, 2.0, 2.7, .003); aq(M.lit, L.hcSign, .3, .45, 47.918, 2.0, 2.7, W_); B(M.conc, .3, .1, .3, 47.95, .2, 2.7, .02);
    K.cyl(M.galv, .03, .03, 2.1, 47.95, 1.2, 8.7, { seg: 10 }); B(M.white, .02, .46, .31, 47.93, 2.0, 8.7, .003); aq(M.lit, L.towSign, .3, .45, 47.918, 2.0, 8.7, W_);
    // north row of stalls (faded), wheel stops, lot light pole
    for (let x = 36; x <= 58; x += 2.75) E(M.paintW, x - .05, .03, 20.6, x + .05, .0345, 25.6); for (let x = 37.4; x < 58; x += 2.75) B(M.conc, 1.8, .13, .2, x, .09, 25.2, .03);
    lightPole(47, 25.9); lightPole(22, -40.6);
    // west planter strip between the driveways + corner islands, perimeter curbs
    const drv = S.drives, d0 = drv[0], d1 = drv[1];
    planter(14, d0 + 4.8, 15.5, d1 - 4.8); planter(14, S.z0, 15.5, d0 - 4.8); planter(14, d1 + 2.4, 18.2, S.z1);
    E(M.conc, S.x0 + 1.5, 0, S.z0, S.x1, .16, S.z0 + .18, .02); E(M.conc, 18.2, 0, S.z1 - .18, S.x1, .16, S.z1, .02); E(M.conc, S.x1 - .18, 0, S.z0, S.x1, .16, S.z1, .02);
    // driveway throats (the road module owns the apron across the verge): wear only
    [d0, d1].forEach(d => { dec('tire_marks', 2.4, 8, 18.2, .036, d + .6, HP + .1); dec('crack', 2.5, 2.5, 16.5, .034, d - 1.6); });
    // weathering decals
    const r = GT.rng('lotdecals');
    S.pumps.forEach(p => { for (let s = -1; s <= 1; s += 2) { dec('oil_stain', 1.5 + r() * .8, 1.6 + r(), p[0] + s * 1.9, .058, p[1] + (r() - .5) * 1.4, r() * 6); if (r() < .7) dec('tire_marks', 1.9, 7.5, p[0] + s * 2.05, .0575, p[1] + (r() - .5), (r() - .5) * .08); } });
    dec('oil_stain', 2.2, 2.6, 46.5, .034, -4.6, .4); dec('oil_stain', 1.4, 1.4, 45.2, .034, 7.2, 2); dec('oil_stain', 1.8, 2, 45.4, .034, 10.2, 4); dec('oil_stain', 2, 2.2, 40.5, .034, 23, 1); dec('oil_stain', 1.6, 1.6, 51.5, .034, 22.8, 3);
    dec('tire_marks', 2.2, 11, 45.6, .033, -22, .16); dec('tire_marks', 2.2, 10, 21.5, .033, -30, .5); dec('tire_marks', 2.2, 12, 22, .033, 12, -.35); dec('tire_marks', 2, 9, 34.2, .0575, -14, .03);
    dec('crack', 4, 4, 20, .033, -12, 1); dec('crack', 3.5, 3.5, 45.2, .033, -19, 2.2); dec('crack', 5, 5, 30, .033, 16, .3); dec('crack', 3, 3, 60, .033, 20, 4); dec('crack', 2.2, 2.2, 48.9, .154, -3, .7); dec('crack', 2, 2, 48.8, .154, -16, 2.9); dec('crack', 3, 3, 34, .058, -4, 1.3);
    dec('patch', 3.2, 2.2, 19.5, .032, 4, .1); dec('patch', 2.4, 3.4, 44.5, .032, 16.5, 1.5); dec('patch', 2.6, 1.8, 24, .032, -32, -.2);
    dec('gum_spots', 2.2, 2.2, 48.9, .1535, DZ + .4, 0); dec('gum_spots', 2.2, 2.2, 48.9, .1535, -4.4, 2); dec('gum_spots', 2, 2, 48.9, .1535, 7.5, 4); dec('gum_spots', 2, 2, 30.2, .24, -13.9, 1);
    dec('puddle', 1.3, .8, 44.6, .033, -14.4, .3); dec('oil_stain', 1.3, 1.3, 48.6, .1535, DZ - 2.6, 1);
    // litter by the door: cigarette butts, flattened cup
    for (let i = 0; i < 26; i++) K.cyl(M.white, .004, .004, .028, 47.9 + r() * 1.9, .156, DZ - 3 + r() * 7.5, { seg: 5, rx: HP, ry: r() * 6 });
    for (let i = 0; i < 12; i++) K.cyl(M.white, .004, .004, .028, 46.2 + r() * 1.3, .036, -6.5 + r() * 6, { seg: 5, rx: HP, ry: r() * 6 });
    K.cyl(M.white, .042, .03, .012, 47.42, .04, -2.2, { seg: 12 }); K.cyl(M.alu, .031, .031, .1, 48.3, .168, -5.35, { seg: 10, rx: HP, ry: .7, }); 
  }
  function bollard(x, z, y0) { K.cyl(M.mYellow, .085, .085, 1.0, x, y0 + .5, z, { seg: 14 }); K.sphere(M.mYellow, .085, x, y0 + 1.0, z, { seg: 14, seg2: 8, s: [1, .55, 1] }); K.cyl(M.galv, .13, .13, .012, x, y0 + .006, z, { seg: 14 }); K.cyl(M.rubber, .087, .087, .05, x, y0 + .8, z, { seg: 14 }); GT.world.addPost(x, z, .1, 1.1, 'station:bollard'); }
  function wheelStop(x, z) { B(M.conc, .2, .13, 1.8, x, .09, z, .035); for (let s = -1; s <= 1; s += 2) K.cyl(M.galv, .012, .012, .01, x, .157, z + s * .6, { seg: 6 }); }
  function planter(x0, z0, x1, z1) { if (z1 - z0 < .6) return; E(M.conc, x0, 0, z0, x1, .17, z1, .03); E(M.grass, x0 + .16, .1, z0 + .16, x1 - .16, .182, z1 - .16); GT.world.addBox(x0, z0, x1, z1, .2, 'station:planter'); }
  function lightPole(x, z) { B(M.conc, .6, .8, .6, x, .4, z, .04); B(M.mYellow, .62, .12, .62, x, .74, z, .02); B(M.galv, .3, .02, .3, x, .81, z); for (let i = 0; i < 4; i++) K.cyl(M.galv, .014, .014, .05, x + (i & 1 ? .11 : -.11), .84, z + (i & 2 ? .11 : -.11), { seg: 6 });
    K.cyl(M.galv, .065, .09, 7.2, x, 4.4, z, { seg: 12 }); const dz = z > 0 ? -1 : 1; B(M.galv, .07, .07, 1.3, x, 7.9, z + dz * .6, .01); B(M.dark, .34, .09, .62, x, 7.88, z + dz * 1.35, .02); B(M.lcan, .28, .012, .5, x, 7.83, z + dz * 1.35);
    aq(M.spill, G.pool, 15, 15, x, .05, z + dz * 2.5, UP); GT.world.addPost(x, z, .32, 8, 'station:pole'); }

  /* ================================================================== CANOPY */
  function canopy() {
    const x0 = CAN.x - CAN.w / 2, x1 = CAN.x + CAN.w / 2, z0 = CAN.z - CAN.d / 2, z1 = CAN.z + CAN.d / 2, h = CAN.h, ft = h + .92, t = .14, bm = h + .47, zc = CAN.z, xc = CAN.x;
    // fascia ring, deck, structure
    E(M.white, x0, h, z0, x0 + t, ft, z1, .012); E(M.white, x1 - t, h, z0, x1, ft, z1, .012); E(M.white, x0 + t, h, z0, x1 - t, ft, z0 + t, .012); E(M.white, x0 + t, h, z1 - t, x1 - t, ft, z1, .012);
    E(M.white, x0 + t, h + .02, z0 + t, x1 - t, h + .07, z1 - t); for (let x = x0 + .6; x < x1 - .3; x += .6) B(M.dark, .008, .004, CAN.d - .3, x, h + .019, zc); E(M.galv, x0 + t, ft - .22, z0 + t, x1 - t, ft - .17, z1 - t); E(M.galv, x0 - .03, ft, z0 - .03, x1 + .03, ft + .035, z0 + t + .02, .008); E(M.galv, x0 - .03, ft, z1 - t - .02, x1 + .03, ft + .035, z1 + .03, .008); E(M.galv, x0 - .03, ft, z0, x0 + t + .02, ft + .035, z1, .008); E(M.galv, x1 - t - .02, ft, z0, x1 + .03, ft + .035, z1, .008);
    [30, 38].forEach(x => E(M.white, x - .16, h - .26, z0 + t, x + .16, h + .02, z1 - t, .012)); [-17.7, -9.7, -1.7].forEach(z => E(M.white, x0 + t, h - .2, z - .11, x1 - t, h + .02, z + .11, .01));
    // illuminated brand band on all four faces
    const bh = .52; aq(M.glowLit, G.stripe, CAN.d, bh, x0 - .004, bm, zc, W_); aq(M.glowLit, G.stripe, CAN.d, bh, x1 + .004, bm, zc, E_); aq(M.glowLit, G.stripe, CAN.w, bh, xc, bm, z1 + .004, N_); aq(M.glowLit, G.stripe, CAN.w, bh, xc, bm, z0 - .004, S_);
    const lw = bh * 5; [-15.5, -.5].forEach(z => { aq(M.glowLit, G.logoBand, lw, bh, x0 - .007, bm, z, W_); aq(M.glowLit, G.logoBand, lw, bh, x1 + .007, bm, z, E_); }); aq(M.glowLit, G.logoBand, lw, bh, xc, bm, z1 + .007, N_); aq(M.glowLit, G.logoBand, lw, bh, xc, bm, z0 - .007, S_);
    for (let z = z0 + 2.6; z < z1 - 1; z += 2.6) { B(M.dark, .006, .92, .012, x0 - .002, h + .46, z); B(M.dark, .006, .92, .012, x1 + .002, h + .46, z); } for (let x = x0 + 2; x < x1 - 1; x += 2) { B(M.dark, .012, .92, .006, x, h + .46, z0 - .002); B(M.dark, .012, .92, .006, x, h + .46, z1 + .002); }
    B(M.lcan, .025, .03, CAN.d - .1, x0 - .012, h + .02, zc); B(M.lcan, .025, .03, CAN.d - .1, x1 + .012, h + .02, zc); B(M.lcan, CAN.w - .1, .03, .025, xc, h + .02, z0 - .012); B(M.lcan, CAN.w - .1, .03, .025, xc, h + .02, z1 + .012);
    aq(M.lit, L.clear, 2.6, .3, xc, h + .15, z0 - .006, S_); aq(M.lit, L.clear, 2.6, .3, xc, h + .15, z1 + .006, N_);
    // rust / grime runs down the fascia
    const r = GT.rng('canopy'); for (let i = 0; i < 9; i++) { wdec('grime_streak', .5 + r() * .5, .8, x0 - .01, h + .47, z0 + 1.5 + r() * (CAN.d - 3), W_); wdec('rust_run', .3 + r() * .3, .7, x1 + .01, h + .4, z0 + 1.5 + r() * (CAN.d - 3), E_); }
    // recessed LED fixtures + floor pools
    [27.8, 32.2, 35.8, 40.2].forEach(x => [-16, -8, 0].forEach(z => { B(M.galv, .72, .07, .72, x, h + .045, z, .012); B(M.lcan, .56, .012, .56, x, h + .004, z); aq(M.spill, G.pool, 7.5, 7.5, x, .062, z, UP); }));
    // conduit, fire suppression, cameras, speakers
    [-16, -8, 0].forEach(z => K.tube(M.galv, [[27.8, h + .0, z + .42], [30, h - .3, z + .42], [38, h - .3, z + .42], [40.2, h, z + .42]], .012, { seg: 6, tension: 0, steps: 6 }));
    [30, 38].forEach(x => { K.cyl(M.mRed, .02, .02, CAN.d - 3, x + .26, h - .1, zc, { seg: 8, rx: HP }); [-16, -8, 0].forEach(z => { K.cyl(M.mRed, .014, .014, .2, x + .26, h - .2, z, { seg: 6 }); K.cyl(M.chrome, .03, .012, .05, x + .26, h - .32, z, { seg: 8 }); }); for (let z = z0 + 3; z < z1 - 1; z += 4) B(M.galv, .06, .05, .03, x + .26, h - .09, z); });
    [[x0 + .6, z0 + .6, .8], [x1 - .6, z1 - .6, -2.3], [x1 - .6, z0 + .6, 2.3]].forEach(c => { B(M.white, .1, .04, .1, c[0], h - .0, c[1], .005); K.cyl(M.white, .012, .012, .12, c[0], h - .07, c[1], { seg: 6 }); K.push(c[0], h - .16, c[1], { ry: c[2], rx: .35 }); B(M.white, .075, .075, .2, 0, 0, 0, .012); K.cyl(M.pBlack, .03, .03, .012, 0, 0, .1, { seg: 10, rx: HP }); B(M.white, .09, .012, .24, 0, .045, .01); K.pop(); });
    // columns
    S.pumps.forEach((p, i) => column(p[0], p[1] - 1.7, i));
  }
  function column(x, z, i) { const y0 = .18, h = CAN.h; B(M.conc, .52, .14, .52, x, y0 + .07, z, .025); B(M.galv, .42, .02, .42, x, y0 + .15, z, .004); for (let k = 0; k < 4; k++) { K.cyl(M.galv, .016, .016, .035, x + (k & 1 ? .16 : -.16), y0 + .175, z + (k & 2 ? .16 : -.16), { seg: 6 }); }
    B(M.white, .26, h - y0 - .16, .26, x, (h + y0 + .16) / 2, z, .022); B(M.mYellow, .34, 1.15, .34, x, y0 + .16 + .575, z, .03); for (let k = 0; k < 2; k++) B(M.rubber, .345, .09, .345, x, y0 + .5 + k * .5, z, .03);
    B(M.white, .34, .1, .34, x, h - .31, z, .02); K.tube(M.galv, [[x + .145, y0 + .2, z + .05], [x + .145, 1.6, z + .05], [x + .145, h - .3, z + .05]], .013, { seg: 6, tension: 0, steps: 3 }); B(M.galv, .06, .12, .1, x + .16, 1.62, z + .05, .01);
    wdec('grime_streak', .26, 1.4, x, h - 1.1, z + .132, N_); wdec('rust_run', .2, .8, x - .132, 1.8, z, W_);
    if (i === 1 || i === 4) { B(M.mRed, .07, .2, .16, x - .165, 1.55, z, .012); K.cyl(M.mRed, .035, .035, .03, x - .21, 1.55, z, { seg: 12, rz: HP }); aq(M.lit, L.shutoff, .27, .18, x - .132, 1.9, z, W_); aq(M.lit, L.shutoff, .27, .18, x + .132, 1.95, z, E_); }
    if (i === 0 || i === 5) { K.cyl(M.mRed, .07, .07, .42, x, 1.45, z - .2, { seg: 12 }); K.sphere(M.mRed, .07, x, 1.66, z - .2, { seg: 10, seg2: 6 }); K.cyl(M.pBlack, .02, .02, .08, x, 1.74, z - .2, { seg: 8 }); K.tube(M.rubber, [[x, 1.72, z - .2], [x + .08, 1.6, z - .22], [x + .08, 1.3, z - .22]], .009, { seg: 5 }); B(M.galv, .16, .03, .01, x, 1.5, z - .135); aq(M.lit, L.nosmoke, .28, .28, x, 2.1, z - .133, S_); }
    else aq(M.lit, L.nosmoke, .26, .26, x, 2.05, z - .133, S_);
    aq(M.lit, L.num[i], .2, .2, x, 2.6, z - .133, S_); aq(M.lit, L.num[i], .2, .2, x, 2.6, z + .133, N_);
    GT.world.addPost(x, z, .2, CAN.h, 'station:column'); }

  /* ================================================================== PUMPS */
  function pump(px, pz, idx) {
    const y0 = .18, r = GT.rng('pump' + idx);
    // island + guards
    B(M.conc, 1.3, y0, 5.0, px, y0 / 2, pz, .035); for (let s = -1; s <= 1; s += 2) { B(M.curbY, 1.31, .11, .1, px, y0 - .05, pz + s * 2.46, .02);
      K.tube(M.mYellow, [[px - .44, y0 - .02, pz + s * 2.2], [px - .44, y0 + .7, pz + s * 2.2], [px - .32, y0 + .86, pz + s * 2.2], [px + .32, y0 + .86, pz + s * 2.2], [px + .44, y0 + .7, pz + s * 2.2], [px + .44, y0 - .02, pz + s * 2.2]], .048, { seg: 10, tension: .25, steps: 30 });
      for (let k = -1; k <= 1; k += 2) K.cyl(M.galv, .085, .085, .012, px + k * .44, y0 + .006, pz + s * 2.2, { seg: 12 }); GT.world.addBox(px - .5, pz + s * 2.15, px + .5, pz + s * 2.25, .9, 'station:bollard'); }
    wdec('grime_streak', 4.6, .17, px - .652, y0 / 2, pz, W_); wdec('grime_streak', 4.6, .17, px + .652, y0 / 2, pz, E_); dec('oil_stain', .9, 1.2, px + .1, y0 + .003, pz + .9, r() * 6);
    K.push(px, y0, pz);
    // body
    B(M.dark, .62, .1, 1.12, 0, .05, 0, .01); B(M.white, .56, .96, 1.04, 0, .58, 0, .014); B(M.alu, .585, .035, 1.065, 0, 1.075, 0, .006); B(M.dark, .56, .78, 1.04, 0, 1.48, 0, .016); B(M.alu, .3, .2, .92, 0, 1.96, 0, .01);
    B(M.mTeal, .7, .3, 1.24, 0, 2.2, 0, .025); B(M.alu, .72, .02, 1.26, 0, 2.045, 0, .004); B(M.galv, .66, .012, 1.2, 0, 2.356, 0);
    // number flag
    K.cyl(M.galv, .014, .014, .3, 0, 2.5, 0, { seg: 8 }); B(M.white, .34, .34, .02, 0, 2.8, 0, .005, { ry: HP }); aq(M.lit, L.num[idx], .3, .3, .012, 2.8, 0, E_); aq(M.lit, L.num[idx], .3, .3, -.012, 2.8, 0, W_);
    for (let f = 0; f < 2; f++) { K.push(0, 0, 0, { ry: f * PI }); const X = .28;
      // display head
      aq(M.glowLit, G.pumpDisp, .58, .485, X + .003, 1.6, 0, E_); B(M.alu, .012, .5, .016, X + .004, 1.6, .298); B(M.alu, .012, .5, .016, X + .004, 1.6, -.298); B(M.alu, .012, .016, .61, X + .004, 1.85, 0); B(M.alu, .012, .016, .61, X + .004, 1.352, 0);
      for (let k = 0; k < 4; k++) B(M.pGrey, .012, .03, .1, X + .006, 1.335, -.21 + k * .14, .004);
      // card reader strip
      B(M.pBlack, .035, .2, .36, X + .012, 1.215, -.1, .01); aq(M.lit, L.keypad, .085, .113, X + .0305, 1.215, -.03, E_); aq(M.glowLit, G.lcdS, .12, .045, X + .0305, 1.265, -.17, E_); B(M.alu, .008, .012, .09, X + .031, 1.2, -.17); B(M.dark, .01, .004, .07, X + .034, 1.2, -.17); B(M.pGrey, .014, .05, .07, X + .031, 1.155, -.17, .004);
      B(M.alu, .01, .16, .16, X + .004, 1.215, .19, .004); B(M.dark, .012, .012, .11, X + .006, 1.24, .19); B(M.white, .003, .03, .09, X + .012, 1.228, .19); for (let k = 0; k < 4; k++) B(M.dark, .012, .005, .1, X + .006, 1.16 + k * .012, .19);
      aq(M.glowLit, G.pumpVal, 1.18, .25, .352, 2.21, 0, E_);
      // lower cabinet: seams, locks, vents, stickers
      B(M.dark, .004, .92, .008, X + .001, .58, 0); B(M.dark, .004, .008, 1.0, X + .001, .84, 0); for (let k = -1; k <= 1; k += 2) { K.cyl(M.chrome, .014, .014, .012, X + .004, .92, k * .08, { seg: 10, rz: HP }); for (let j = 0; j < 4; j++) B(M.dark, .006, .008, .3, X + .002, .2 + j * .03, k * .26); }
      aq(M.lit, L.pumpStick, .4, .4, X + .003, .58, -.26, E_); B(M.mRed, .006, .05, 1.02, X + .002, 1.01, 0); aq(M.lit, L.nocashPump || L.nocash, .2, .12, X + .003, .56, .26, E_);
      wdec('grime_streak', .9, .5, X + .006, .34, 0, E_); if (r() < .7) wdec('rust_run', .12, .4, X + .007, .3, .3 * (r() - .5) * 2, E_);
      // nozzles + hoses (regular + diesel)
      for (let s = -1; s <= 1; s += 2) { const bz = s * .415, col = s > 0 ? M.mTeal : M.mRed;
        B(M.pBlack, .02, .5, .19, X + .003, 1.36, bz, .008); B(M.pBlack, .1, .12, .13, X + .05, 1.2, bz, .02); B(M.dark, .06, .02, .09, X + .06, 1.262, bz);
        B(M.pBlack, .06, .17, .06, X + .09, 1.4, bz, .015, { rz: -.4 }); B(col, .068, .1, .07, X + .112, 1.45, bz, .02, { rz: -.4 }); B(M.galv, .01, .15, .028, X + .135, 1.37, bz, 0, { rz: -.4 }); K.cyl(M.rubber, .04, .04, .014, X + .062, 1.325, bz, { seg: 10, rz: .5 });
        K.tube(M.chrome, [[X + .07, 1.34, bz], [X + .058, 1.29, bz], [X + .05, 1.23, bz]], .012, { seg: 6, steps: 5 });
        K.tube(M.rubber, [[.2, 2.06, bz], [.3, 1.93, bz + s * .03], [.44, 1.4, bz + s * .12], [.5, .78, bz + s * .17], [.47, .44, bz + s * .15], [.42, .5, bz + s * .08], [.4, .95, bz + s * .03], [X + .135, 1.5, bz]], .0165, { seg: 6, steps: 26 });
        K.cyl(M.chrome, .023, .023, .09, .262, 1.985, bz + s * .016, { seg: 8, rz: -.62 }); K.cyl(M.chrome, .021, .021, .05, X + .132, 1.49, bz, { seg: 8, rz: -.4 }); }
      K.pop(); }
    K.pop();
    // waste / squeegee / towel unit at the +Z end of the island
    const uz = pz + 1.55; K.push(px, y0, uz);
    B(M.pGrey, .46, .92, .46, 0, .46, 0, .025); B(M.dark, .48, .05, .48, 0, .93, 0, .012); for (let s = -1; s <= 1; s += 2) { B(M.pBlack, .012, .2, .3, s * .232, .72, 0, .004); aq(M.lit, L.nosmoke, .2, .2, s * .2325, .36, 0, s > 0 ? E_ : W_); }
    B(M.pBlack, .3, .26, .2, 0, .5, .34, .02); B(M.rubber, .26, .01, .16, 0, .625, .34); K.cyl(M.pGrey, .011, .011, .5, .05, .8, .36, { seg: 6, rz: .22, rx: -.12 }); B(M.rubber, .22, .03, .03, .0, .6, .35, .008);
    B(M.galv, .045, .5, .045, 0, 1.18, -.2, .006); B(M.galv, .3, .36, .15, 0, 1.36, -.2, .012); B(M.dark, .2, .006, .1, 0, 1.19, -.2); B(M.mTeal, .16, .1, .004, 0, 1.13, -.2); wdec('grime_streak', .42, .5, 0, .3, .233, N_);
    K.pop();
    GT.world.addBox(px - .34, pz - .6, px + .34, pz + .6, 2.5, 'station:pump'); GT.world.addBox(px - .26, uz - .26, px + .26, uz + .46, 1.5, 'station:bin');
    GT.world.anchor('pump' + (idx + 1), { x: px + (px < CAN.x ? -2.15 : 2.15), z: pz, h: px < CAN.x ? PI : 0 }); GT.world.anchor('pump' + (idx + 1) + 'i', { x: px + (px < CAN.x ? 2.15 : -2.15), z: pz, h: px < CAN.x ? 0 : PI });
  }

  /* ================================================================== PRICE PYLON */
  function pylon() { const x = S.sign.x, z = S.sign.z; K.push(x, 0, z);
    B(M.conc, 3.3, .7, .9, 0, .35, 0, .06); B(M.conc, 3.5, .14, 1.1, 0, .07, 0, .03); for (let s = -1; s <= 1; s += 2) { B(M.mTeal, .3, 9.2, .3, s * 1.05, .7 + 4.6, 0, .02); B(M.galv, .5, .03, .5, s * 1.05, .715, 0, .005); for (let k = 0; k < 4; k++) K.cyl(M.galv, .02, .02, .06, s * 1.05 + (k & 1 ? .19 : -.19), .76, (k & 2 ? .19 : -.19), { seg: 6 }); B(M.galv, .34, .04, .34, s * 1.05, 9.92, 0, .01); }
    const cab = (y, h, r, w) => { B(M.alu, w || 2.9, h, .36, 0, y, 0, .02); B(M.dark, (w || 2.9) + .04, .05, .4, 0, y + h / 2, 0, .01); B(M.dark, (w || 2.9) + .04, .05, .4, 0, y - h / 2, 0, .01); aq(M.glowLit, r, (w || 2.9) - .12, h - .12, 0, y, .183, N_); aq(M.glowLit, r, (w || 2.9) - .12, h - .12, 0, y, -.183, S_); };
    cab(8.7, 1.85, G.pylonBrand); cab(6.38, 2.62, G.pylonPrice); cab(4.5, .92, G.pylonLow);
    for (let i = 0; i < 2; i++) { const zz = i ? .185 : -.185, rot = i ? N_ : S_; wdec('rust_run', .5, 1.3, -.9, 3.3, zz * .85, rot); wdec('rust_run', .4, 1.0, .7, 3.5, zz * .85, rot); wdec('grime_streak', 2.6, .8, 0, 7.4, zz + (i ? .004 : -.004), rot); wdec('rust_run', .28, 1.6, 1.05, 2.2, i ? .152 : -.152, rot); wdec('rust_run', .28, 1.2, -1.05, 1.6, i ? .152 : -.152, rot); wdec('water_stain', 3, .7, 0, .36, i ? .455 : -.455, rot); }
    B(M.galv, .3, .42, .16, 1.42, 1.1, 0, .012); K.tube(M.galv, [[1.42, .9, 0], [1.42, .2, 0]], .016, { seg: 6, tension: 0, steps: 2 }); K.tube(M.galv, [[1.3, 1.25, .06], [1.21, 1.6, .1], [1.21, 4, .1]], .013, { seg: 6, tension: 0, steps: 4 }); aq(M.lit, L.danger, .22, .165, 1.42, 1.12, .083, N_);
    K.pop(); aq(M.spill, G.pool, 6, 6, x, .2, z, UP); GT.world.addBox(x - 1.75, z - .55, x + 1.75, z + .55, 10, 'station:pylon'); }

  /* ================================================================== STORE SHELL */
  const SF0 = DZ - 13.65, SF1 = DZ + 13.65;   // storefront glazing extent in z
  function shell() {
    const x0 = ST.x0, x1 = ST.x1, z0 = ST.z0, z1 = ST.z1, top = ST.h + .72, t = .25;
    // --- west facade: service bay, storefront, north utility section
    E(M.stucco, x0, 0, z0, x0 + t, top, -28.1); E(M.stucco, x0, 0, -23.9, x0 + t, top, SF0); E(M.stucco, x0, 3.2, -28.1, x0 + t, top, -23.9); E(M.stucco, x0, 0, SF1, x0 + t, top, z1); E(M.stucco, x0, 3.02, SF0, x0 + t, top, SF1);
    E(M.teal, x0 - .012, .15, SF0, x0 + t, .66, DZ - 1.95, .01); E(M.teal, x0 - .012, .15, DZ + 1.95, x0 + t, .66, SF1, .01); E(M.alu, x0 - .03, .655, SF0, x0 + t + .02, .7, DZ - 1.95, .008); E(M.alu, x0 - .03, .655, DZ + 1.95, x0 + t + .02, .7, SF1, .008);
    E(M.alu, x0 + .02, 2.9, SF0, x0 + .2, 3.02, SF1, .008); E(M.alu, x0 + .04, 2.28, SF0, x0 + .14, 2.34, SF1, .006);
    for (let i = 0; i <= 21; i++) { const z = SF0 + i * 1.3; if (i === 10 || i === 11) continue; E(M.alu, x0 + .03, i >= 9 && i <= 12 ? .15 : .68, z - .032, x0 + .16, 2.92, z + .032, .008); }
    for (let i = 0; i < 21; i++) { const za = SF0 + i * 1.3 + .03, zb = za + 1.24; if (i >= 9 && i <= 11) continue; E(M.glassF, x0 + .085, .7, za, x0 + .099, 2.28, zb); E(M.glassF, x0 + .085, 2.34, za, x0 + .099, 2.9, zb); }
    // door package: sidelights + header operator + transom (leaves are separate, animated)
    [[DZ - 1.95, DZ - .975], [DZ + .975, DZ + 1.95]].forEach(s => { E(M.glassF, x0 + .085, .27, s[0] + .03, x0 + .099, 2.28, s[1] - .03); E(M.alu, x0 + .04, .15, s[0], x0 + .14, .27, s[1], .006); E(M.alu, x0 + .04, .15, (s[0] < DZ ? s[1] - .05 : s[0]), x0 + .14, 2.3, (s[0] < DZ ? s[1] : s[0] + .05), .006); });
    E(M.glassF, x0 + .085, 2.52, DZ - 1.92, x0 + .099, 2.9, DZ + 1.92); E(M.alu, x0 + .0, 2.3, DZ - 1.95, x0 + .24, 2.52, DZ + 1.95, .012); B(M.pBlack, .05, .05, .22, x0 - .02, 2.44, DZ, .01); B(M.pBlack, .05, .05, .22, x0 + .26, 2.44, DZ, .01); B(M.alu, .26, .02, 1.95, x0 + .12, .16, DZ, .004);
    aq(M.lit, L.autodoor, .8, .2, x0 - .003, 2.41, DZ - 1.2, W_); aq(M.lit, L.height, .06, .78, x0 + .03, 1.6, DZ + .998, { ry: PI });
    // --- other walls + parapet
    E(M.stucco, x0 + t, 0, z0, x1 - t, top, z0 + t); E(M.stucco, x0 + t, 0, z1 - t, x1 - t, top, z1); E(M.cinder, x1 - t, 0, z0, x1, top, z1);
    E(M.teal, x0 - .015, top - .46, z0 - .015, x0 + t, top - .1, z1 + .015, .008); E(M.teal, x0 + t, top - .46, z0 - .015, x1, top - .1, z0 + .1, .008); E(M.teal, x0 + t, top - .46, z1 - .1, x1, top - .1, z1 + .015, .008);
    E(M.galv, x0 - .04, top, z0 - .04, x0 + t + .03, top + .04, z1 + .04, .01); E(M.galv, x1 - t - .03, top, z0 - .04, x1 + .04, top + .04, z1 + .04, .01); E(M.galv, x0 + t, top, z0 - .04, x1 - t, top + .04, z0 + t + .03, .01); E(M.galv, x0 + t, top, z1 - t - .03, x1 - t, top + .04, z1 + .04, .01);
    E(M.tar, x0 + t, ST.h - .12, z0 + t, x1 - t, ST.h, z1 - t);
    // --- awning over the sidewalk with downlights + tie rods
    const ay = 3.42; E(M.white, 48.7, ay, SF0 - .3, x0, ay + .34, SF1 + .3, .015); E(M.mTeal, 48.685, ay + .1, SF0 - .31, 48.7, ay + .25, SF1 + .31); E(M.tar, 48.72, ay + .34, SF0 - .28, x0, ay + .352, SF1 + .28); E(M.galv, 48.66, ay + .3, SF0 - .33, 48.72, ay + .37, SF1 + .33, .006);
    for (let z = SF0 + 1.35; z < SF1; z += 2.6) { K.cyl(M.galv, .1, .1, .02, 49.35, ay - .02, z, { seg: 14 }); K.cyl(M.lw, .075, .075, .006, 49.35, ay - .032, z, { seg: 14 }); aq(M.spill, G.pool, 3.2, 3.2, 49.2, .158, z, UP); }
    for (let z = SF0 + .7; z < SF1; z += 3.9) { K.tube(M.galv, [[48.82, ay + .36, z], [49.99, 4.5, z]], .014, { seg: 6, tension: 0, steps: 2 }); B(M.galv, .02, .12, .12, 49.99, 4.5, z, .004); }
    for (let i = 0; i < 9; i++) wdec('grime_streak', .5 + (i % 3) * .2, .34, 48.694, ay + .17, SF0 + 1.2 + i * 3.1, W_);
    // --- store sign lightbox above the awning
    B(M.dark, .16, 1.04, 9.5, x0 - .08, 4.42, DZ, .02); aq(M.glowLit, G.storeSign, 9.36, 1.02 * .96, x0 - .164, 4.42, DZ, W_);
    // --- roll-up door of the service bay
    E(M.galv, x0 + .1, 0, -28.1, x0 + .13, 3.2, -23.9); for (let yy = .14; yy < 3.16; yy += .095) K.cyl(M.galv, .05, .05, 4.2, x0 + .135, yy, -26, { seg: 6, rx: HP }); E(M.galv, x0 + .06, 0, -28.2, x0 + .2, 3.2, -28.06, .008); E(M.galv, x0 + .06, 0, -23.94, x0 + .2, 3.2, -23.8, .008); E(M.galv, x0 + .0, 3.14, -28.24, x0 + .26, 3.5, -23.76, .02); E(M.galv, x0 + .08, 0, -28.08, x0 + .17, .1, -23.92, .01); B(M.dark, .03, .08, .16, x0 + .08, .5, -26, .01);
    aq(M.lit, L.keepClear, 3.0, .5, x0 + .08, 1.7, -26, W_); wdec('grime_streak', 4.1, 1.1, x0 + .078, .55, -26, W_); wdec('rust_run', .5, 1.6, x0 + .078, 2.3, -27.2, W_); wdec('rust_run', .4, 1.2, x0 + .078, 1.5, -24.6, W_);
    // --- storefront weathering
    for (let i = 0; i < 8; i++) wdec('grime_streak', 2.4, .5, x0 - .017, .41, SF0 + 1.6 + i * 3.25 + (i > 3 ? 1.4 : 0), W_);
    wdec('water_stain', 3.2, 2.4, x0 - .006, 2.2, 8.4, W_); wdec('grime_streak', 3, 1.2, x0 - .006, .6, 9, W_); wdec('water_stain', 2, 2.6, x0 - .006, 2.4, -22.9, W_); wdec('grime_streak', 1.6, 1, x0 - .006, .5, -29, W_); wdec('crack', 1.8, 1.8, x0 - .005, 1.6, 6.5, W_);
    // --- colliders (door gap left open) + anchors
    const W = GT.world; W.addBox(x0, z0, x0 + .3, DZ - 1.0, 5.1, 'station:wall'); W.addBox(x0, DZ + 1.0, x0 + .3, z1, 5.1, 'station:wall'); W.addBox(x0, z0, x1, z0 + .3, 5.1, 'station:wall'); W.addBox(x0, z1 - .3, x1, z1, 5.1, 'station:wall'); W.addBox(x1 - .3, z0, x1, z1, 5.1, 'station:wall');
    W.addBox(57, -7.2, x1, z1, 5.1, 'station:backroom'); W.addBox(62, z0, x1, -7.2, 5.1, 'station:backroom'); W.addBox(x0, z0, 62, SF0, 5.1, 'station:bay'); W.addBox(x0, 5.8, 57, z1, 5.1, 'station:utility');
    W.anchor('storeDoor', { x: 48.9, z: DZ, h: HP }); W.anchor('storeInside', { x: 51.7, z: DZ, h: HP }); W.anchor('register', { x: 56.05, z: -4, h: -HP }); W.anchor('registerFront', { x: 53.75, z: -4, h: HP }); W.anchor('safe', { x: 56.1, z: -5.6, h: HP });
    W.anchor('stationExitS', { x: 13, z: S.drives[0], h: -HP }); W.anchor('stationExitN', { x: 13, z: S.drives[1], h: -HP }); W.anchor('stationCurb', { x: 46.6, z: -4, h: PI }); W.anchor('storeBackDoor', { x: 69, z: -2, h: -HP });
  }
  /** one sliding leaf, built at the origin (hinge-less, slides along z) */
  function doorLeaf(sign) { const k = GT.kit(), w = .975, x = ST.x0 + .17, zc = sign * w / 2; k.box(M.alu, .045, 2.14, .06, x, 1.23, sign * .03, { bevel: .006 }); k.box(M.alu, .045, 2.14, .06, x, 1.23, sign * (w - .03), { bevel: .006 }); k.box(M.alu, .045, .13, w, x, .225, zc, { bevel: .006 }); k.box(M.alu, .045, .07, w, x, 2.265, zc, { bevel: .006 });
    k.box(M.alu, .03, .05, w - .1, x - .045, 1.12, zc, { bevel: .01 }); k.box(M.alu, .03, .03, .03, x - .03, 1.12, sign * .12); k.box(M.alu, .03, .03, .03, x - .03, 1.12, sign * (w - .12)); k.box(M.rubber, .02, 2.1, .012, x, 1.23, sign * .004);
    k.box(M.glassF, .012, 1.98, w - .1, x, 1.28, zc); const g = k.build({ cast: false }); g.position.z = DZ; g.userData.sign = sign; return g; }

  /* ================================================================== FRONT-OF-STORE PROPS */
  function frontProps() {
    const x0 = ST.x0, r = GT.rng('front');
    // window graphics (inside face of the glass, readable from outside)
    const gx = x0 + .078; [[SF0 + .65, 0], [SF0 + 1.95, 1], [SF0 + 4.55, 2], [SF0 + 7.15, 3], [DZ + 6.5, 4], [DZ + 10.4, 5]].forEach(d => aq(M.lit, L.p[d[1]], .92, 1.38, gx, 1.5, d[0], W_));
    [[SF0 + 3.25, L.sBeer], [SF0 + 5.85, L.sCig], [SF0 + 9.75, L.sLotto], [DZ + 3.9, L.sAtm], [DZ + 7.8, L.sCoffee], [DZ + 11.7, L.sIce]].forEach(d => aq(M.lit, d[1], 1.2, .225, gx, 2.62, d[0], W_));
    aq(M.lit, L.hours, .3, .42, gx, 1.5, DZ + 1.46, W_); aq(M.lit, L.atm, .2, .15, gx, 1.92, DZ + 1.46, W_); aq(M.lit, L.cards, .2, .15, gx, 1.14, DZ + 1.46, W_); aq(M.lit, L.cam, .2, .2, gx, 1.56, DZ - 1.46, W_); aq(M.lit, L.nocash, .25, .15, gx, 1.28, DZ - 1.46, W_); aq(M.lit, L.helpw, .21, .28, gx, 1.36, DZ + 2.25, W_); aq(M.lit, L.lostcat, .21, .28, gx, 1.5, DZ - 3.1, W_);
    // neon in the window
    const nx = x0 + .2, neonAt = (rct, w, h, y, z) => { B(M.pBlack, .012, .02, w * .9, nx + .02, y + h / 2 - .02, z); for (let s = -1; s <= 1; s += 2) K.tube(M.galv, [[nx + .02, y + h / 2 - .02, z + s * w * .4], [nx + .02, 2.9, z + s * w * .4]], .003, { seg: 4, steps: 1, tension: 0 }); aq(M.add, rct, w, h, nx, y, z, W_); aq(M.add, rct, w * 1.08, h * 1.08, nx + .03, y, z, W_); };
    neonAt(G.nOpen, .78, .36, 2.02, DZ + 2.6); neonAt(G.nLotto, .8, .27, 2.04, DZ - 2.6); neonAt(G.nBeer, .8, .33, 2.0, DZ + 9.1); neonAt(G.nAtm, .56, .245, 2.04, DZ + 5.2);
    // camera, bell box + strobe, exit signage on the head band
    B(M.white, .1, .1, .04, x0 - .02, 3.2, DZ + 1.1, .008); K.push(x0 - .14, 3.16, DZ + 1.1, { ry: -HP - .5, rx: .3 }); B(M.white, .08, .08, .22, 0, 0, 0, .014); K.cyl(M.pBlack, .032, .032, .012, 0, 0, .112, { seg: 10, rx: HP }); B(M.white, .1, .012, .26, 0, .05, .02); K.pop();
    bellBox(x0 - .012, 3.16, DZ - 1.5); bellBox(x0 - .012, 4.3, DZ + 6.6);
    // flood lights on the parapet
    [-27, -17.5, 1.5, 9.5].forEach(z => { B(M.galv, .5, .04, .06, x0 - .25, 5.0, z, .008); K.push(x0 - .52, 4.97, z, { rz: -.6 }); B(M.dark, .12, .3, .38, 0, 0, 0, .02); B(M.lcan, .012, .24, .32, -.062, 0, 0); K.pop(); aq(M.spill, G.pool, 9, 9, 46.4, .04, z, UP); });
    aq(M.spill, G.beam, 27.3, 2.4, 48.85, .157, DZ, { rx: -HP, ry: -HP }); aq(M.spill, G.pool, 30, 11, 45.6, .037, DZ, { rx: -HP, ry: HP });
    // newspaper boxes
    L.news.forEach((n, i) => { const z = DZ - 3.6 - i * .56, m = [M.mTeal, M.mYellow, M.mRed][i]; K.push(49.6, .15, z, { ry: (r() - .5) * .12 }); B(m, .42, .72, .48, 0, .62, 0, .02); B(m, .3, .28, .34, 0, .14, 0, .01); B(M.dark, .34, .02, .4, 0, .01, 0); aq(M.lit, n, .46, .7, -.212, .62, 0, W_); B(M.chrome, .02, .03, .2, -.225, .5, 0, .006); wdec('rust_run', .2, .4, -.213, .2, .1, W_); K.pop(); GT.world.addBox(49.36, z - .26, 49.86, z + .26, 1, 'station:newsbox'); });
    // trash can + ash stand by the door
    K.cyl(M.conc, .29, .26, .8, 49.55, .55, DZ + 2.25, { seg: 16 }); K.cyl(M.dark, .3, .3, .06, 49.55, .97, DZ + 2.25, { seg: 16 }); K.cyl(M.pBlack, .2, .2, .012, 49.55, 1.004, DZ + 2.25, { seg: 16 }); wdec('grime_streak', .5, .5, 49.26, .45, DZ + 2.25, W_);
    K.cyl(M.dark, .16, .16, .02, 49.7, .16, DZ - 2.2, { seg: 12 }); K.cyl(M.dark, .025, .025, .8, 49.7, .56, DZ - 2.2, { seg: 8 }); K.cyl(M.dark, .08, .05, .16, 49.7, 1.0, DZ - 2.2, { seg: 12 });
    B(M.rubber, 1.1, .014, 1.9, 49.35, .157, DZ, .005);
    // payphone shell
    K.push(x0 - .01, .15, 6.3); B(M.alu, .3, .9, .5, -.15, 1.45, 0, .02); B(M.alu, .36, .04, .56, -.18, 1.92, 0, .01); B(M.dark, .012, .82, .44, -.305, 1.45, 0); aq(M.lit, L.phone, .38, .76, -.313, 1.45, 0, W_); B(M.alu, .32, .03, .5, -.16, .98, 0, .01); K.tube(M.chrome, [[-.32, 1.2, .16], [-.36, .9, .1], [-.34, .75, 0]], .008, { seg: 5 }); K.pop();
    // propane exchange cage
    K.push(x0 - .42, .15, 7.85); B(M.galv, .8, .06, 1.7, 0, .03, 0, .01); for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) B(M.galv, .04, 1.75, .04, (i ? .38 : -.38), .9, (j ? .83 : -.83), .005); B(M.galv, .8, .04, 1.7, 0, 1.77, 0, .008); B(M.galv, .8, .03, 1.7, 0, .9, 0, .006);
    for (let z = -.75; z <= .76; z += .1) B(M.galv, .008, 1.7, .008, -.385, .9, z); for (let y = .2; y < 1.7; y += .1) B(M.galv, .008, .008, 1.66, -.385, y, 0); B(M.galv, .01, 1.7, .03, -.39, .9, 0);
    for (let lv = 0; lv < 2; lv++) for (let i = 0; i < 4; i++) { const zz = -.6 + i * .4, yy = .07 + lv * .87; K.cyl(M.white, .15, .15, .3, 0, yy + .2, zz, { seg: 14 }); K.sphere(M.white, .15, 0, yy + .35, zz, { seg: 14, seg2: 8, s: [1, .6, 1] }); K.cyl(M.white, .1, .1, .1, 0, yy + .47, zz, { seg: 10, open: true }); K.cyl(M.galv, .1, .1, .04, 0, yy + .02, zz, { seg: 10 }); }
    aq(M.lit, L.propane, .9, .45, -.396, 1.3, 0, W_); aq(M.lit, L.nosmoke, .3, .3, -.396, .6, .5, W_); B(M.dark, .03, .08, .06, -.4, .95, -.05); wdec('rust_run', .3, .6, -.398, .4, -.5, W_); K.pop(); GT.world.addBox(x0 - .85, 6.95, x0, 8.75, 1.9, 'station:propane');
    // ice freezer chest
    K.push(x0 - .5, .15, 10.3); B(M.white, .95, 1.9, 1.95, 0, .98, 0, .03); B(M.dark, .97, .08, 1.97, 0, .04, 0); B(M.galv, .93, .16, 1.9, 0, 2.01, 0, .01); for (let i = 0; i < 12; i++) B(M.dark, .008, .1, .1, -.468, 2.01, -.82 + i * .15);
    for (let s = -1; s <= 1; s += 2) { B(M.white, .05, .9, .88, -.49, 1.3, s * .46, .02, { rz: -.1 }); B(M.chrome, .03, .05, .3, -.535, 1.05, s * .46, .01); B(M.rubber, .04, .92, .02, -.485, 1.3, s * .46 + .45, 0, { rz: -.1 }); }
    aq(M.lit, L.ice, 1.86, .82, -.478, .44, 0, W_); wdec('rust_run', .4, .5, -.48, .22, .7, W_); wdec('grime_streak', 1.8, .5, -.48, .3, 0, W_); K.tube(M.rubber, [[.3, .2, 1.0], [.2, .1, 1.2], [.45, .05, 1.35]], .012, { seg: 5 }); K.pop(); GT.world.addBox(x0 - 1.0, 9.3, x0, 11.3, 2.1, 'station:icebox'); dec('puddle', .8, .5, x0 - 1.15, .154, 10.9, .4);
    // air / vac machine at the south end of the sidewalk
    K.push(48.5, .15, -22.9); B(M.conc, .6, .12, .6, 0, .06, 0, .02); B(M.galv, .16, .9, .16, 0, .55, 0, .01); B(M.mRed, .5, .7, .42, 0, 1.3, 0, .025); B(M.galv, .54, .04, .46, 0, 1.67, 0, .01); aq(M.lit, L.airvac, .46, .46, -.253, 1.36, 0, W_);
    const hose = []; for (let i = 0; i <= 20; i++) { const a = i / 20 * PI * 5; hose.push([-.27 - i * .002, 1.02 + Math.cos(a) * .15, .34 + Math.sin(a) * .15 - .17]); } K.tube(M.rubber, hose, .012, { seg: 5, steps: 60 }); B(M.galv, .04, .04, .1, -.26, 1.2, .2); K.tube(M.pBlack, [[.26, 1.3, .1], [.4, .8, .3], [.3, .2, .5], [.1, .22, .7], [-.2, .2, .65]], .028, { seg: 6, steps: 16 }); wdec('rust_run', .3, .5, -.253, .98, -.12, W_); K.pop(); GT.world.addBox(48.2, -23.2, 48.8, -22.6, 1.8, 'station:airvac');
    aq(M.lit, L.loiter, .3, .45, x0 - .004, 1.75, -22.6, W_); aq(M.lit, L.towSign, .3, .45, x0 - .004, 1.75, 5.95, W_);
  }
  function bellBox(x, y, z) { B(M.mRed, .1, .3, .3, x - .05, y, z, .02); B(M.white, .012, .12, .22, x - .104, y - .03, z, .003); K.cyl(M.galv, .06, .06, .012, x - .106, y - .03, z, { seg: 12, rz: HP }); K.cyl(M.strobe, .045, .045, .07, x - .05, y + .19, z, { seg: 10 }); K.sphere(M.strobe, .045, x - .05, y + .225, z, { seg: 10, seg2: 6 }); K.tube(M.galv, [[x - .02, y - .15, z + .1], [x - .02, y - .3, z + .1]], .008, { seg: 5, steps: 1, tension: 0 }); }

  /* ================================================================== ROOF */
  function roof() { const y = ST.h, r = GT.rng('roof');
    const ac = (x, z, w, d, hh, fans) => { K.push(x, y, z); B(M.galv, w + .1, .28, d + .1, 0, .14, 0, .01); B(M.white, w, hh, d, 0, .28 + hh / 2, 0, .02); B(M.dark, w * .6, hh * .72, .02, -w * .12, .3 + hh / 2, d / 2 + .005); for (let k = 0; k < 9; k++) B(M.galv, w * .6, .012, .03, -w * .12, .3 + hh * (.18 + k * .08), d / 2 + .018, 0, { rx: .5 }); B(M.dark, .004, hh * .9, .006, w * .22, .3 + hh / 2, d / 2 + .002); B(M.galv, w + .04, .03, d + .04, 0, .29 + hh, 0, .008); B(M.dark, .012, hh * .7, d * .5, -w / 2 - .003, .3 + hh / 2, 0);
      for (let i = 0; i < fans; i++) { const fx = fans === 1 ? 0 : (i - (fans - 1) / 2) * (w / fans); K.cyl(M.dark, .36, .36, .05, fx, .3 + hh, 0, { seg: 18 }); K.cyl(M.galv, .39, .39, .03, fx, .29 + hh, 0, { seg: 18, open: true }); for (let k = 0; k < 4; k++) B(M.galv, .76, .01, .012, fx, .335 + hh, 0, 0, { ry: k * PI / 4 }); K.cyl(M.galv, .07, .07, .03, fx, .335 + hh, 0, { seg: 10 }); }
      B(M.galv, .22, .3, .12, w / 2 + .06, .6, d * .25, .01); K.tube(M.galv, [[w / 2 + .1, .5, d * .25], [w / 2 + .3, .08, d * .25], [w / 2 + 1.6, .06, d * .25 + .3]], .018, { seg: 6, tension: .2 }); K.tube(M.white, [[-w / 2, .3, -d * .3], [-w / 2 - .3, .05, -d * .3], [-w / 2 - 1.3, .04, -d * .3 - .4]], .014, { seg: 6, tension: .2 });
      aq(M.lit, L.unit, .3, .15, w * .3, .3 + hh * .7, d / 2 + .004, N_); wdec('rust_run', .3, .5, 0, .2 + hh * .3, -d / 2 - .004, S_); K.pop(); dec('oil_stain', 1.6, 1.6, x - w / 2 - 1.2, y + .004, z - d * .3 - .4, r() * 6); };
    ac(55.5, -14, 1.5, 1.1, 1.0, 1); ac(55.5, -1, 1.5, 1.1, 1.0, 1); ac(63.5, -19, 2.6, 1.1, .95, 2); ac(63, 6, 1.3, 1.0, .9, 1);
    [[59, -8], [61, 2], [53.5, -20], [64.5, -9]].forEach(p => { K.cyl(M.galv, .16, .18, .4, p[0], y + .2, p[1], { seg: 12 }); K.cyl(M.galv, .3, .3, .04, p[0], y + .47, p[1], { seg: 14 }); K.cyl(M.galv, .22, .3, .12, p[0], y + .55, p[1], { seg: 14 }); B(M.galv, .5, .03, .5, p[0], y + .015, p[1]); });
    [[52.5, -11], [58, 4.5], [65, -3], [60.5, -24], [53, 2.5]].forEach(p => { K.cyl(M.white, .045, .045, .5, p[0], y + .25, p[1], { seg: 8 }); K.cyl(M.dark, .08, .09, .05, p[0], y + .03, p[1], { seg: 8 }); });
    B(M.galv, .95, .32, .95, 60, y + .16, -15.5, .012); B(M.galv, 1.02, .05, 1.02, 60, y + .34, -15.5, .01); B(M.dark, .1, .03, .04, 60.4, y + .26, -15.0);
    for (let x = ST.x0 + 1.25; x < ST.x1 - .5; x += 1.0) B(M.rubber, .03, .004, ST.z1 - ST.z0 - .6, x, y + .002, (ST.z0 + ST.z1) / 2);
    E(M.galv, 56.3, y + .5, -13.9, 56.9, y + .95, -6, .02); E(M.galv, 56.3, y + .0, -6.6, 56.9, y + .95, -6, .02); for (let z = -12.5; z < -6.5; z += 1.5) { B(M.galv, .64, .5, .03, 56.6, y + .72, z, .004); B(M.wood, .7, .5, .09, 56.6, y + .25, z + .3, .006); }
    [[62.5, -3.5], [54, 7.5], [65.5, -14], [58.5, -26]].forEach(p => { K.cyl(M.galv, .22, .22, .3, p[0], y + .15, p[1], { seg: 14 }); K.sphere(M.galv, .3, p[0], y + .42, p[1], { seg: 14, seg2: 8, s: [1, .7, 1] }); for (let k = 0; k < 10; k++) B(M.galv, .02, .3, .08, p[0], y + .44, p[1], 0, { ry: k * Math.PI / 10 }); });
    for (let z = ST.z0 + 3; z < ST.z1; z += 6.5) wdec('grime_streak', 2.2, .6, ST.x1 - .256, y + .32, z, W_);
    // conduit + gas line on sleepers
    K.tube(M.galv, [[51, y + .1, -26], [51, y + .1, 8], [57, y + .1, 8]], .02, { seg: 6, tension: 0, steps: 4 }); K.tube(M.mYellow, [[66.6, y + .12, -27], [66.6, y + .12, 9]], .024, { seg: 6, tension: 0, steps: 2 }); for (let z = -24; z < 9; z += 3.4) { B(M.wood, .3, .09, .09, 51, y + .045, z, .008); B(M.wood, .3, .09, .09, 66.6, y + .045, z + 1, .008); }
    // sat dish
    K.push(53.2, y, 9.2, { ry: -2.2 }); K.cyl(M.galv, .03, .03, .9, 0, .45, 0, { seg: 8 }); B(M.conc, .4, .1, .4, 0, .05, 0, .01); const pts = []; for (let i = 0; i <= 8; i++) { const rr_ = i / 8 * .42; pts.push(new T.Vector2(rr_ + .001, rr_ * rr_ * .7)); } K.geo(M.white, new T.LatheGeometry(pts, 20), { y: .95, z: .08, rx: HP - .7 }); K.geo(M.pGrey, new T.LatheGeometry(pts.map(p => new T.Vector2(p.x, p.y - .004)), 20), { y: .945, z: .075, rx: HP - .7, s: [1.01, 1, 1.01] }); K.tube(M.galv, [[0, .68, .22], [0, .92, .5], [0, 1.22, .62]], .01, { seg: 5 }); B(M.pGrey, .05, .05, .09, 0, 1.24, .64, .01); K.pop();
    // scuppers + parapet staining, puddles, patches
    [-20, -6, 6].forEach(z => { B(M.dark, .3, .12, .3, ST.x1 - .14, y + .06, z); B(M.galv, .2, .2, .26, ST.x1 + .1, y - .12, z, .01); K.cyl(M.galv, .05, .05, y - .34, ST.x1 + .1, (y - .2) / 2 + .02, z, { seg: 10 }); for (let k = 0; k < 3; k++) B(M.galv, .03, .03, .14, ST.x1 + .06, .6 + k * 1.5, z); B(M.galv, .1, .16, .1, ST.x1 + .13, .1, z, .01, { rz: -.5 });
      wdec('water_stain', 1.4, 3.6, ST.x1 + .006, 2.4, z + .5, E_); dec('oil_stain', 1.2, 1.2, ST.x1 + .6, .034, z + .2, r() * 6); });
    dec('puddle', 1.6, 1.0, 58, y + .004, -22, .5); dec('patch', 3, 2, 54, y + .003, -6, .2); dec('patch', 2.2, 3, 61, y + .003, -12, 1.4); dec('patch', 2.6, 1.6, 57, y + .003, 9, .1); dec('crack', 4, 4, 62, y + .003, -24, 1); dec('oil_stain', 3, 3, 52.5, y + .003, -16, 2); dec('oil_stain', 4, 3, 60, y + .003, 5, 4);
    for (let i = 0; i < 7; i++) wdec('water_stain', 2.2, .7, ST.x0 + .256, y + .36, ST.z0 + 4 + i * 5.6, E_);
  }

  /* ================================================================== BACK + SIDES */
  function back() { const x1 = ST.x1, r = GT.rng('back');
    // back door
    E(M.galv, x1, 0, -2.56, x1 + .05, 2.2, -1.44, .008); E(M.white, x1 + .03, .03, -2.47, x1 + .08, 2.12, -1.53, .01); B(M.alu, .012, .28, .9, x1 + .083, .2, -2, .003); K.cyl(M.chrome, .028, .028, .07, x1 + .11, 1.05, -1.66, { seg: 10, rz: HP }); B(M.chrome, .012, .14, .06, x1 + .086, 1.05, -1.66, .003);
    aq(M.lit, L.deliver, .42, .28, x1 + .083, 1.62, -2, E_); B(M.dark, .1, .16, .34, x1 + .06, 2.52, -2, .02); B(M.lw, .02, .1, .28, x1 + .112, 2.5, -2); aq(M.spill, G.pool, 6, 6, x1 + 1.6, .036, -2, UP); B(M.conc, .9, .1, 1.3, x1 + .5, .05, -2, .02); wdec('rust_run', .5, 1.2, x1 + .085, .9, -2.2, E_);
    B(M.pBlack, .05, .09, .06, x1 + .03, 1.4, -1.3, .01);
    // graffiti, wall weathering
    wdec('graffiti_a', 4.6, 2.3, x1 + .006, 1.5, -11, E_); wdec('graffiti_b', 4.2, 2.1, x1 + .006, 1.45, 4.4, E_); wdec('graffiti_b', 2.6, 1.3, x1 + .006, 1.2, -25.5, E_); wdec('graffiti_a', 2.2, 1.1, x1 + .007, 1.0, -16.5, E_);
    for (let i = 0; i < 9; i++) wdec('grime_streak', 3.6, 1.1, x1 + .005, .55, ST.z0 + 2.5 + i * 4.6, E_); wdec('crack', 2.4, 2.4, x1 + .005, 2.2, -7, E_); wdec('crack', 2, 2, x1 + .005, 1.4, 8.5, E_);
    // electrical service: panels, meter, conduit up to the roof
    K.push(x1, 0, -23); B(M.galv, .22, 1.1, .7, .11, 1.5, 0, .012); B(M.galv, .2, .7, .5, .1, 1.45, .85, .012); B(M.galv, .16, .42, .32, .08, 1.5, -.7, .012); K.cyl(M.glass, .09, .09, .1, .2, 1.56, -.7, { seg: 12, rz: HP }); K.cyl(M.galv, .1, .1, .02, .165, 1.56, -.7, { seg: 12, rz: HP });
    [[-.2, .0], [.2, .0], [.85, .0], [-.7, .0]].forEach(p => K.tube(M.galv, [[.08, 2.05, p[0]], [.08, ST.h + .5, p[0]], [-.2, ST.h + .78, p[0]]], .022, { seg: 6, tension: 0, steps: 4 })); K.tube(M.galv, [[.08, .95, 0], [.08, .1, 0]], .03, { seg: 6, tension: 0, steps: 2 }); K.tube(M.galv, [[.08, 1.2, .35], [.08, 1.2, .6]], .016, { seg: 6, tension: 0, steps: 2 });
    aq(M.lit, L.danger, .3, .22, .223, 1.6, 0, E_); wdec('rust_run', .3, .8, .224, 1.2, .1, E_); K.pop();
    // gas meter
    K.push(x1 + .3, 0, 9); K.cyl(M.galv, .03, .03, .9, 0, .45, -.3, { seg: 8 }); K.cyl(M.galv, .03, .03, .9, 0, .45, .3, { seg: 8 }); K.cyl(M.galv, .03, .03, .64, 0, .9, 0, { seg: 8, rx: HP }); B(M.pGrey, .26, .34, .3, 0, .62, 0, .04); K.cyl(M.galv, .1, .1, .06, 0, .98, .2, { seg: 12 }); K.tube(M.mYellow, [[0, .9, -.3], [-.22, 1.0, -.3], [-.22, ST.h + .3, -.3]], .022, { seg: 6, tension: 0, steps: 3 }); K.pop(); bollard(x1 + .75, 8.5, .03); bollard(x1 + .75, 9.5, .03);
    // mop sink, mop + bucket, grease drum, milk crates, pallets
    K.push(x1 + .42, 0, 2.2); B(M.conc, .8, .32, .8, 0, .16, 0, .03); B(M.dark, .62, .02, .62, 0, .325, 0); K.tube(M.galv, [[-.36, .1, 0], [-.36, .95, 0], [-.2, 1.02, 0], [-.14, .9, 0]], .014, { seg: 6, tension: .2 }); K.cyl(M.chrome, .03, .03, .04, -.36, .9, .06, { seg: 8, rx: HP }); K.tube(M.rubber, [[-.14, .9, 0], [0, .5, .1], [.1, .36, .2]], .012, { seg: 5 });
    K.cyl(M.wood, .013, .013, 1.4, -.25, .82, .52, { seg: 6, rz: -.12, rx: .1 }); B(M.white, .2, .2, .12, -.17, .14, .58, .04); wdec('water_stain', 1.4, 1.4, -.414, 1.0, 0, E_); K.pop(); dec('puddle', 1.0, .7, x1 + 1.1, .034, 2.7, 1);
    K.cyl(M.dark, .29, .29, .88, x1 + .5, .44, 0.3, { seg: 16 }); K.cyl(M.dark, .3, .3, .02, x1 + .5, .3, 0.3, { seg: 16 }); K.cyl(M.dark, .3, .3, .02, x1 + .5, .6, 0.3, { seg: 16 }); dec('oil_stain', 1.5, 1.5, x1 + .7, .034, .3, 2); wdec('rust_run', .3, .5, x1 + .5, .5, .595, N_);
    for (let i = 0; i < 5; i++) { const c = [M.mRed, M.pGrey, M.mTeal][i % 3]; B(c, .33, .28, .33, x1 + .35 + (i > 2 ? .4 : 0), .14 + (i % 3) * .285 - (i > 2 ? 0 : 0), -4.3 - (i > 2 ? .1 : 0), .012, { ry: (r() - .5) * .3 }); }
    for (let i = 0; i < 4; i++) pallet(x1 + 1.1, .03 + i * .145, -8.2, (r() - .5) * .12, 0); pallet(x1 + .36, .62, -6.3, 0, 1.32);
    // dumpster enclosure (north-east corner)
    const ex0 = 64.4, ex1 = 71.6, ez0 = 14.4, ez1 = 19.6, eh = 1.95; E(M.cinder, ex0, 0, ez0, ex1, eh, ez0 + .2); E(M.cinder, ex0, 0, ez1 - .2, ex1, eh, ez1); E(M.cinder, ex1 - .2, 0, ez0 + .2, ex1, eh, ez1 - .2); E(M.conc, ex0 - .02, eh, ez0 - .03, ex1 + .03, eh + .06, ez0 + .23, .01); E(M.conc, ex0 - .02, eh, ez1 - .23, ex1 + .03, eh + .06, ez1 + .03, .01); E(M.conc, ex1 - .23, eh, ez0 + .2, ex1 + .03, eh + .06, ez1 - .2, .01);
    E(M.conc, ex0, 0, ez0 + .2, ex1 - .2, .05, ez1 - .2); [ez0 + .1, ez1 - .1].forEach((z, i) => { B(M.galv, .12, eh + .1, .12, ex0 - .02, (eh + .1) / 2, z, .01); K.push(ex0 - .06, 0, z, { ry: i ? -1.9 : 2.5 }); B(M.galv, 2.4, 1.7, .02, 1.24, 1.0, 0); for (let gx = .14; gx < 2.4; gx += .2) B(M.galv, .05, 1.66, .045, gx, 1.0, 0, .012); B(M.galv, 2.44, .05, .05, 1.24, 1.86, 0, .006); B(M.galv, 2.44, .05, .05, 1.24, .14, 0, .006); B(M.galv, .05, 1.74, .05, 2.44, 1.0, 0, .006); B(M.galv, 3.0, .04, .02, 1.24, 1.0, .02, 0, { rz: .62 }); K.pop(); });
    dumpster(67.9, 15.9, HP + .04, 0); dumpster(68.2, 18.2, HP - .06, 1); pallet(65.6, .07, 18.6, .3, 0); B(M.wood, .5, .34, .4, 65.5, .38, 18.5, .01, { ry: .4 }); B(M.wood, .6, .04, .9, 66.2, .08, 15.2, 0, { ry: -.3 }); B(M.wood, .58, .04, .85, 66.25, .12, 15.25, 0, { ry: .1 });
    wdec('graffiti_a', 3.4, 1.6, ex0 + 3.4, 1.0, ez0 - .006, S_); wdec('grime_streak', 6, 1, ex0 + 3.6, .5, ez0 - .005, S_); wdec('grime_streak', 6, 1, ex0 + 3.6, .5, ez1 + .005, N_); dec('oil_stain', 2.6, 2.6, 66.4, .056, 17, 1);  dec('tire_marks', 2.2, 7, 60.5, .033, 17, HP + .1);
    GT.world.addBox(ex0, ez0, ex1, ez0 + .2, 2, 'station:enclosure'); GT.world.addBox(ex0, ez1 - .2, ex1, ez1, 2, 'station:enclosure'); GT.world.addBox(ex1 - .2, ez0, ex1, ez1, 2, 'station:enclosure'); GT.world.addBox(66.7, 15, 69.3, 19, 1.5, 'station:dumpster');
    // north wall: restroom doors, wall pack, hose bib, downpipe;  south wall: downpipe + stains
    const zn = ST.z1; [53.2, 55.6].forEach((x, i) => { E(M.galv, x - .52, 0, zn, x + .52, 2.16, zn + .04, .008); E(M.white, x - .45, .03, zn + .03, x + .45, 2.1, zn + .07, .01); B(M.alu, .86, .26, .012, x, .2, zn + .073, .003); K.cyl(M.chrome, .026, .026, .07, x + .34, 1.02, zn + .1, { seg: 10, rx: HP }); aq(M.lit, L.men, .26, .26, x, 1.62, zn + .074, N_); wdec('grime_streak', .9, .7, x, .5, zn + .076, N_); if (i) wdec('rust_run', .3, .9, x - .2, 1.1, zn + .076, N_); });
    B(M.dark, .34, .16, .1, 54.4, 2.6, zn + .05, .02); B(M.lcan, .28, .1, .02, 54.4, 2.57, zn + .105); aq(M.spill, G.pool, 7, 7, 54.4, .036, zn + 2, UP); B(M.conc, 3.8, .1, 1.2, 54.4, .05, zn + .6, .02);
    K.tube(M.galv, [[58, .1, zn + .05], [58, .6, zn + .05]], .014, { seg: 6, tension: 0, steps: 1 }); K.cyl(M.chrome, .02, .02, .08, 58, .62, zn + .09, { seg: 8, rx: HP }); K.tube(M.pGrey, [[58, .6, zn + .13], [58.1, .1, zn + .3], [58.6, .06, zn + .5], [59, .06, zn + .2], [58.6, .06, zn + .25]], .013, { seg: 5 }); dec('puddle', .9, .6, 58.6, .034, zn + .6, 0);
    [[61.5, zn + .07, N_, 1], [64, ST.z0 - .07, S_, -1], [52, ST.z0 - .07, S_, -1]].forEach(d => { K.cyl(M.galv, .05, .05, ST.h + .2, d[0], (ST.h + .3) / 2, d[1], { seg: 10 }); for (let k = 0; k < 3; k++) B(M.galv, .14, .03, .03, d[0], .7 + k * 1.6, d[1] - d[3] * .03); B(M.galv, .22, .2, .14, d[0], ST.h + .32, d[1], .01); wdec('water_stain', 1.6, 3.8, d[0] + .5, 2.3, d[1] - d[3] * .064, d[2]); wdec('grime_streak', 1.2, .8, d[0], .45, d[1] - d[3] * .064, d[2]); });
    for (let i = 0; i < 4; i++) { wdec('grime_streak', 3.4, .9, ST.x0 + 3 + i * 4.2, .5, ST.z0 - .005, S_); wdec('grime_streak', 3.4, .9, ST.x0 + 5 + i * 3.6, .5, zn + .005, N_); } wdec('graffiti_b', 2.6, 1.3, 60.5, 1.3, ST.z0 - .006, S_);
    B(M.dark, .1, .16, .34, ST.x1 - 6, 3.4, ST.z0 - .05, .02, { ry: HP }); B(M.lw, .28, .1, .02, ST.x1 - 6, 3.37, ST.z0 - .105); aq(M.spill, G.pool, 7, 7, ST.x1 - 6, .036, ST.z0 - 2, UP);
  }
  function pallet(x, y, z, ry, rz) { K.push(x, y, z, { ry, rz }); for (let i = 0; i < 7; i++) B(M.wood, 1.2, .02, .1, 0, .125, -.45 + i * .15); for (let i = 0; i < 3; i++) { B(M.wood, .04, .09, 1.0, -.56 + i * .56, .07, 0); B(M.wood, 1.2, .02, .1, 0, .015, -.45 + i * .45); } K.pop(); }
  function dumpster(x, z, ry, open) { K.push(x, .05, z, { ry }); B(M.mTeal, 1.85, 1.05, 1.25, 0, .66, 0, .02); B(M.mTeal, 1.9, .06, 1.3, 0, 1.2, 0, .012); for (let s = -1; s <= 1; s += 2) { B(M.mTeal, .1, .16, 1.1, s * .98, .78, 0, .01); B(M.dark, .06, .1, .12, s * .98, .78, .6); K.cyl(M.rubber, .07, .07, .05, s * .8, .07, .5, { seg: 10, rz: HP }); K.cyl(M.rubber, .07, .07, .05, s * .8, .07, -.5, { seg: 10, rz: HP }); B(M.mTeal, .04, .9, .06, s * .5, .66, .64, .008); }
    B(M.pBlack, .92, .035, 1.3, -.47, 1.26, 0, .012, { rx: 0 }); if (open) B(M.pBlack, .92, .035, 1.3, .47, 1.75, -.55, .012, { rx: 1.25 }); else B(M.pBlack, .92, .035, 1.3, .47, 1.27, .02, .012, { rx: -.03 });
    aq(M.lit, L.waste, 1.3, .48, 0, .78, .632, N_); wdec('rust_run', .5, .8, -.6, .5, .634, N_); wdec('rust_run', .4, .7, .7, .45, .634, N_); wdec('grime_streak', 1.8, .6, 0, .32, .636, N_); wdec('rust_run', .4, .8, .3, .5, -.634, S_); K.pop(); }

  /* ================================================================== INTERIOR */
  function interior() {
    const x0 = ST.x0 + .25, XE = 62, XB = 57, ZS = SF0, ZM = -7.2, ZN = 5.65;
    // floor, walls, ceiling
    E(M.tile, x0, FY - .06, ZS, XE, FY, ZM); E(M.tile, x0, FY - .06, ZM, XB, FY, ZN);
    E(M.iwall, x0, FY, ZS - .15, XE, CY + .3, ZS); E(M.iwall, XE, FY, ZS - .15, XE + .12, CY + .3, ZM); E(M.iwall, XB, FY, ZM, XE + .12, CY + .3, ZM + .12); E(M.iwall, XB, FY, ZM, XB + .12, CY + .3, ZN + .15); E(M.iwall, x0, FY, ZN, XB + .12, CY + .3, ZN + .15);
    E(M.dark, x0, FY, ZS, XE, FY + .1, ZS + .012); E(M.dark, XB - .012, FY, ZM + .12, XB, FY + .1, ZN); E(M.dark, x0, FY, ZN - .012, XB, FY + .1, ZN);
    E(M.ceil, x0 - .2, CY, ZS, XE, CY + .04, ZM); E(M.ceil, x0 - .2, CY, ZM, XB, CY + .04, ZN);
    for (let x = 50.85; x < XE; x += .6) { E(M.iwall, x - .011, CY - .003, ZS, x + .011, CY, x < XB ? ZN : ZM); } for (let z = ZS + .65; z < ZN; z += 1.2) E(M.iwall, x0 - .2, CY - .003, z - .011, z < ZM ? XE : XB, CY, z + .011);
    K.quad(GT.decalMat('water_stain'), 1.3, 1.3, 58.2, CY - .006, -12.4, { rx: HP }); K.quad(GT.decalMat('water_stain'), .9, .9, 52.4, CY - .006, 1.6, { rx: HP, ry: 1 });
    for (let x = 51.45; x < XE; x += 2.4) for (let z = -20.4; z < ZN; z += 2.4) { if (x > XB - .4 && z > ZM - .7) continue; B(M.lc, .58, .012, 1.18, x, CY - .005, z); B(M.shelf, .62, .016, 1.22, x, CY - .002, z); }
    [[53.85, -11.9], [58.65, -16.7], [53.85, -1.1], [53.85, 3.7]].forEach(p => { B(M.galv, .56, .02, .56, p[0] - 1.2, CY - .01, p[1], .004); B(M.dark, .4, .004, .4, p[0] - 1.2, CY - .021, p[1]); });
    // fridge wall, gondolas, wall shelving
    fridges(XE, ZS + .25, 18);
    [-11, -13.6, -16.2, -18.8].forEach((z, i) => gondola(z, i));
    wallShelf(ZS + .012, 51, 60.6);
    counter();
    coffeeBar(ZN);
    // ice-cream chest freezer, posters, extinguisher along the office wall (faces south)
    K.push(59.3, FY, ZM - .42); B(M.shelf, 1.9, .8, .72, 0, .42, 0, .03); B(M.dark, 1.92, .06, .74, 0, .03, 0); B(M.alu, 1.92, .03, .74, 0, .835, 0, .006); B(M.glass, .93, .012, .66, -.47, .86, 0); B(M.glass, .93, .012, .66, .44, .875, 0); B(M.fridge, 1.8, .02, .62, 0, .6, 0); B(M.pBlack, .1, .02, .04, -.05, .872, -.3); B(M.pBlack, .1, .02, .04, .85, .887, -.3);
    for (let i = 0; i < 9; i++) PB.box(59.3 - .78 + i * .195, FY + .68, ZM - .42 + (i % 2 ? .12 : -.14), .17, .1, .26, 40 + (i * 3) % 8, 'S'); aq(M.litInt, L.sIce, 1.5, .28, 0, .42, -.364, S_); wdec('grime_streak', 1.8, .3, 0, .2, -.366, S_); K.pop();
    aq(M.litInt, L.p[0], .7, 1.05, 58.2, FY + 1.75, ZM - .004, S_); aq(M.litInt, L.p[5], .7, 1.05, 59.2, FY + 1.75, ZM - .004, S_); aq(M.litInt, L.p[1], .7, 1.05, 60.2, FY + 1.75, ZM - .004, S_); aq(M.litInt, L.cam, .3, .3, 61.2, FY + 2.0, ZM - .004, S_);
    K.cyl(M.mRed, .065, .065, .4, 61.5, FY + 1.0, ZM - .09, { seg: 12 }); K.sphere(M.mRed, .065, 61.5, FY + 1.2, ZM - .09, { seg: 10, seg2: 6 }); K.cyl(M.pBlack, .02, .02, .07, 61.5, FY + 1.28, ZM - .09, { seg: 8 }); B(M.galv, .16, .03, .02, 61.5, FY + 1.05, ZM - .012);
    dec('gum_spots', 2, 2, 51.6, FY + .003, DZ + .3, 1); dec('oil_stain', 1.3, 1.0, 53.4, FY + .003, DZ - 1.7, 2); dec('gum_spots', 2.2, 2.2, 53.6, FY + .003, -4, 3); dec('tire_marks', .5, 6, 56.2, FY + .003, -12.3, HP);
    // ATM + back-room door on the office wall
    K.push(XB - .3, FY, 2.5); B(M.dark, .55, 1.45, .56, 0, .725, 0, .02); B(M.pGrey, .04, .66, .5, -.275, 1.08, 0, .01); aq(M.glowLit, G.atmScr, .24, .18, -.297, 1.2, 0, W_); aq(M.lit, L.keypad, .12, .16, -.297, .93, .08, W_); B(M.dark, .02, .012, .1, -.29, 1.02, -.12); B(M.lc, .008, .012, .06, -.3, 1.04, -.12); B(M.dark, .03, .03, .26, -.29, .78, 0); B(M.dark, .54, .24, .1, -.02, 1.6, 0, .01); aq(M.glowLit, G.atmTop, .5, .17, -.276, 1.6, 0, W_); aq(M.add, G.atmTop, .5, .17, -.28, 1.6, 0, W_); K.pop();
    E(M.alu, XB - .02, FY, .2, XB, FY + 2.12, 1.3, .006); E(M.shelf, XB - .04, FY + .02, .27, XB - .015, FY + 2.06, 1.23, .008); B(M.alu, .008, .26, .9, XB - .044, FY + .18, .75); K.cyl(M.chrome, .024, .024, .07, XB - .07, FY + 1.02, .4, { seg: 10, rz: HP }); B(M.pBlack, .006, .5, .18, XB - .043, FY + 1.55, .95); aq(M.litInt, L.staff, .5, .125, XB - .044, FY + 1.86, .75, W_);
    B(M.dark, .04, .2, .38, XB - .03, 2.62, .75, .008); aq(M.glowLit, G.exit, .34, .17, XB - .052, 2.62, .75, W_); B(M.dark, .04, .2, .38, x0 + .1, 2.62, DZ - 2.6, .008); aq(M.glowLit, G.exit, .34, .17, x0 + .122, 2.62, DZ - 2.6, E_);
    // lottery play station by the window
    K.push(51.05, FY, DZ + 6.9); B(M.shelf, .5, 1.02, .6, 0, .51, 0, .012); B(M.pBlack, .54, .03, .64, 0, 1.03, 0, .008, { rz: .12 }); B(M.dark, .05, .5, .6, .22, 1.35, 0, .008); aq(M.glowLit, G.lottoTop, .58, .22, .19, 1.48, 0, W_); aq(M.litInt, L.scratch, .56, .21, -.252, .6, 0, W_); aq(M.litInt, L.sLotto, .56, .105, .19, 1.24, 0, W_); K.pop();
    // stacked soda cases by the entrance
    K.push(51.2, FY, DZ - 2.9); for (let c = 0; c < 3; c++) for (let l = 0; l < (c === 1 ? 5 : 4); l++) { B(M.shelf, .27, .125, .4, 0, .0635 + l * .128, (c - 1) * .42, .006); aq(M.litInt, L.cases, .39, .12, -.137, .0635 + l * .128, (c - 1) * .42, W_); aq(M.litInt, L.cases, .39, .12, .137, .0635 + l * .128, (c - 1) * .42, E_); } aq(M.litInt, L.promo, .5, .125, -.14, .8, 0, W_); B(M.shelf, .012, .14, .52, -.13, .8, 0); K.pop();
    // wet floor sign + mop bucket, floor mat
    K.push(52.3, FY, DZ - 1.2, { ry: .35 }); for (let s = -1; s <= 1; s += 2) { B(M.mYellow, .012, .64, .3, s * .1, .31, 0, .004, { rz: s * .3 }); aq(M.litInt, L.wet, .28, .56, s * .108, .31, 0, Object.assign({ rz: s * .3 }, s > 0 ? E_ : W_)); } K.pop();
    K.push(53.2, FY, DZ - 1.9, { ry: -.4 }); B(M.mYellow, .36, .3, .5, 0, .2, 0, .035); B(M.mYellow, .3, .2, .2, 0, .42, -.16, .02); for (let i = 0; i < 4; i++) K.cyl(M.pBlack, .03, .03, .03, (i & 1 ? .15 : -.15), .03, (i & 2 ? .2 : -.2), { seg: 8, rz: HP }); K.cyl(M.wood, .013, .013, 1.35, .05, .85, .0, { seg: 6, rx: .22, rz: .08 }); B(M.white, .16, .12, .16, .04, .32, .12, .04); K.pop();
    E(M.rubber, x0 + .2, FY, DZ - .9, x0 + 1.7, FY + .012, DZ + .9, .005);
    // convex mirrors, ceiling speaker / strobe
    K.sphere(M.chrome, .36, XE - .32, 2.66, ZS + .34, { seg: 16, seg2: 10, s: [.3, 1, 1], ry: PI / 4 }); B(M.dark, .3, .02, .02, XE - .16, 2.66, ZS + .17, 0, { ry: PI / 4 }); K.sphere(M.chrome, .3, XB - .3, 2.68, ZN - .3, { seg: 16, seg2: 10, s: [.3, 1, 1], ry: -PI / 4 });
    B(M.white, .14, .05, .14, 51.2, CY - .03, DZ + 1.2, .01); K.cyl(M.strobe, .04, .04, .06, 51.2, CY - .085, DZ + 1.2, { seg: 10 });
    K.cyl(M.pGrey, .09, .11, .05, 53, CY - .03, DZ, { seg: 14 }); K.sphere(M.pBlack, .075, 53, CY - .06, DZ, { seg: 12, seg2: 8 }); K.cyl(M.pGrey, .09, .11, .05, 60.5, CY - .03, -9, { seg: 14 }); K.sphere(M.pBlack, .075, 60.5, CY - .06, -9, { seg: 12, seg2: 8 });
    // aisle markers
    [-11, -13.6, -16.2, -18.8].forEach((z, i) => { B(M.shelf, .02, .3, .96, 52.7, 2.52, z, .004); aq(M.litInt, L.aisle[i], .94, .29, 52.688, 2.52, z, W_); aq(M.litInt, L.aisle[i], .94, .29, 52.712, 2.52, z, E_); for (let s = -1; s <= 1; s += 2) B(M.galv, .004, .4, .004, 52.7, 2.86, z + s * .4); });
    GT.world.addBox(54.6, -7, 55.4, -1.2, 1.1, 'station:counter'); [-11, -13.6, -16.2, -18.8].forEach(z => GT.world.addBox(52.4, z - .45, 59.6, z + .45, 1.6, 'station:gondola'));
  }
  function fridges(xw, zs, n) { const dw = .76, x = xw - .92, z1 = zs + n * dw;
    E(M.dark, x, FY, zs, xw, FY + .22, z1); E(M.fridge, xw - .06, FY + .22, zs, xw, FY + 2.28, z1); E(M.shelf, x - .02, FY + 2.26, zs - .04, xw, FY + 2.62, z1 + .04, .01); E(M.dark, x, FY + 2.62, zs, xw, CY, z1); E(M.shelf, x, FY, zs - .05, xw, FY + 2.3, zs); E(M.shelf, x, FY, z1, xw, FY + 2.3, z1 + .05);
    for (let s = 0; s < 3; s++) aq(M.glowLit, G.fr[s], n * dw / 3 - .1, .3, x - .024, FY + 2.44, zs + (s + .5) * n * dw / 3, W_);
    for (let i = 0; i <= n; i++) { const z = zs + i * dw; B(M.dark, .06, 2.06, .05, x + .03, FY + 1.25, z, .006); if (i < n) B(M.lc, .018, 1.9, .018, x + .09, FY + 1.25, z + .04); }
    E(M.dark, x, FY + 2.22, zs, x + .06, FY + 2.28, z1); E(M.dark, x, FY + .2, zs, x + .06, FY + .26, z1); wdec('grime_streak', n * dw, .2, x - .004, FY + .11, (zs + z1) / 2, W_);
    for (let i = 0; i < n; i++) { const z = zs + i * dw, zc = z + dw / 2, sec = i < 6 ? 0 : i < 13 ? 1 : 2; E(M.glass, x + .012, FY + .28, z + .04, x + .026, FY + 2.2, z + dw - .04); K.cyl(M.chrome, .011, .011, .5, x - .03, FY + 1.2, z + (i & 1 ? .1 : dw - .1), { seg: 6 }); for (let k = -1; k <= 1; k += 2) B(M.chrome, .04, .014, .014, x - .012, FY + 1.2 + k * .23, z + (i & 1 ? .1 : dw - .1));
      if (i % 5 === 2) aq(M.litInt, i % 2 ? L.promo : L.promo2, .34, .085, x + .008, FY + 1.86, zc, W_);
      for (let lv = 0; lv < 5; lv++) { const sy = FY + .3 + lv * .385; B(M.shelf, .7, .012, dw - .06, x + .47, sy, zc); B(M.shelf, .012, .03, dw - .06, x + .125, sy + .012, zc);
        if (sec === 0 && lv === 0) { for (let k = 0; k < 2; k++) PB.box(x + .27, sy + .11, z + .2 + k * .36, .32, .2, .26, 16 + ((i * 3 + k) & 7), 'W'); continue; }
        const tall = sec === 2 ? lv < 4 : sec === 0 ? lv > 1 : (lv < 2 || rnd() < .35), pick = () => tall ? 56 + (sec === 0 ? (rnd() * 3 | 0) : sec === 2 ? [3, 4, 6, 7, 3][rnd() * 5 | 0] : [5, 4, 7, 5][rnd() * 4 | 0]) : 48 + (rnd() * 8 | 0), cell0 = pick(), cell1 = pick(), rr_ = tall ? .036 : .033, hh = tall ? .235 + (sec === 2 ? .02 : 0) : (lv & 1 ? .155 : .12), nn = tall ? 7 : 8, st = (dw - .14) / (nn - 1);
        for (let k = 0; k < nn; k++) { const c = k < nn / 2 ? cell0 : cell1, bz = z + .07 + k * st; if (rnd() < .05) continue; PB.cyl(x + .17, sy + .008, bz, rr_, hh, c, tall, rnd() * 6, 8); PB.cyl(x + .26, sy + .008, bz, rr_, hh, c, tall, rnd() * 6, 5); } } } }
  function gondola(zc, gi) { const xa = 52.95, xb = 59.6, len = xb - xa, xm = (xa + xb) / 2, lv = [.16, .5, .84, 1.16];
    B(M.dark, len, .14, .92, xm, FY + .07, zc); B(M.shelf, len, 1.42, .03, xm, FY + .14 + .71, zc); for (let x = xa; x <= xb + .01; x += len / 5) B(M.shelf, .035, 1.5, .08, x, FY + .75, zc, .004); B(M.shelf, len + .04, .03, .14, xm, FY + 1.565, zc, .008);
    for (let s = -1; s <= 1; s += 2) { lv.forEach((y, k) => { const dep = k === 0 ? .44 : .36, zf = zc + s * (dep + .015); B(M.shelf, len, .022, dep, xm, FY + y, zc + s * (dep / 2 + .015)); aq(M.litInt, L.price, len, .034, xm, FY + y + .005, zf + s * .002, s > 0 ? N_ : S_);
        const kinds = [[3, 4, 4, 3], [5, 5, 0, 5], [1, 2, 0, 6], [0, 1, 2, 3]][gi], kk = k === 0 ? (gi === 0 ? [3, 4] : [0, 1, 2, 6]) : kinds; stock(xa + .02, xb - .02, FY + y + .012, zf - s * .01, s > 0 ? 'N' : 'S', (k < 3 ? lv[k + 1] - y : .34) - .04, kk, dep); }); }
    // end caps
    for (let e = 0; e < 2; e++) { const ex = e ? xb + .02 : xa - .02, sg = e ? 1 : -1; B(M.shelf, .03, 1.42, .92, ex, FY + .85, zc); B(M.dark, .4, .14, .92, ex + sg * .2, FY + .07, zc); lv.forEach((y, k) => { B(M.shelf, .34, .022, .9, ex + sg * .185, FY + y, zc); aq(M.litInt, L.price, .9, .034, ex + sg * .358, FY + y + .005, zc, e ? E_ : W_);
        stock(zc - .44, zc + .44, FY + y + .012, ex + sg * .345, e ? 'E' : 'W', (k < 3 ? lv[k + 1] - y : .34) - .04, [[4, 3], [6, 7], [1, 5], [2, 0]][(gi + k + e) % 4], .34); }); B(M.shelf, .02, .14, .62, ex + sg * .02, FY + 1.65, zc, .004); aq(M.litInt, (gi + e) % 2 ? L.promo : L.promo2, .6, .13, ex + sg * .032, FY + 1.65, zc, e ? E_ : W_); } }
  function wallShelf(zw, xa, xb) { const len = xb - xa, xm = (xa + xb) / 2; B(M.dark, len, .14, .42, xm, FY + .07, zw + .21); B(M.shelf, len, 1.9, .03, xm, FY + 1.05, zw + .02); for (let x = xa; x <= xb + .01; x += len / 8) B(M.shelf, .035, 2.0, .06, x, FY + 1.0, zw + .05, .004);
    [.16, .52, .88, 1.24, 1.58].forEach((y, k) => { B(M.shelf, len, .022, .34, xm, FY + y, zw + .2); aq(M.litInt, L.price, len, .034, xm, FY + y + .005, zw + .372, N_); stock(xa + .02, xb - .02, FY + y + .012, zw + .36, 'N', .3, [[6, 7], [3, 4], [0, 1, 2], [3, 4, 0], [1, 2, 5]][k], .34); });
    B(M.shelf, len, .26, .04, xm, FY + 2.2, zw + .03, .006); aq(M.litInt, L.sIce, 2.2, .24, 53, FY + 2.2, zw + .052, N_); aq(M.litInt, L.sBeer, 2.2, .24, 58.5, FY + 2.2, zw + .052, N_); }
  function counter() { const cx = 55, za = -7.0, zb = -1.2, zm = (za + zb) / 2, top = FY + .95;
    B(M.shelf, .8, .9, zb - za, cx, FY + .45, zm, .01); B(M.pBlack, .92, .045, zb - za + .1, cx, top - .02, zm, .014); B(M.dark, .82, .1, zb - za, cx, FY + .05, zm); B(M.alu, .012, .03, zb - za, cx - .462, top - .06, zm);
    aq(M.litInt, L.sLotto, 1.2, .225, cx - .403, FY + .55, -4, W_);
    // candy racks on the customer face
    [[za + .15, -4.75], [-3.25, zb - .15]].forEach(sg => { [.14, .38, .62].forEach(y => { B(M.shelf, .17, .016, sg[1] - sg[0], cx - .485, FY + y, (sg[0] + sg[1]) / 2); aq(M.litInt, L.price, sg[1] - sg[0], .03, cx - .572, FY + y + .004, (sg[0] + sg[1]) / 2, W_); stock(sg[0], sg[1], FY + y + .01, cx - .565, 'W', .2, [5, 5, 1], .16); }); });
    // acrylic partition with a pass-through
    const px = cx - .34; [[za + .1, -4.5], [-3.5, zb - .1]].forEach(s => E(M.glassF, px - .006, top, s[0], px + .006, top + 1.2, s[1])); E(M.glassF, px - .006, top + .42, -4.5, px + .006, top + 1.2, -3.5);
    [za + .1, -5.75, -4.5, -3.5, -2.3, zb - .1].forEach(z => B(M.alu, .035, 1.22, .035, px, top + .61, z, .005)); B(M.alu, .04, .035, zb - za - .2, px, top + 1.22, zm, .005); B(M.alu, .3, .012, .9, px + .02, top + .006, -4, .003);
    aq(M.litInt, L.wecard, .5, .125, px - .008, top + .95, -5.1, W_); aq(M.litInt, L.nocash, .3, .18, px - .008, top + .7, -2.9, W_); aq(M.litInt, L.cam, .2, .2, px - .008, top + .98, -2.85, W_);
    // register, customer display, printer, card terminal
    B(M.pBlack, .42, .1, .44, cx + .12, top + .05, -4, .012); B(M.dark, .4, .012, .02, cx + .12, top + .05, -3.775); K.cyl(M.pBlack, .03, .04, .22, cx + .1, top + .2, -4, { seg: 10 }); B(M.pBlack, .035, .27, .38, cx + .06, top + .38, -4, .01, { rz: -.25 }); aq(M.glowLit, G.pos, .34, .24, cx + .082, top + .384, -4, Object.assign({ rz: -.25 }, E_));
    K.cyl(M.pBlack, .012, .012, .3, cx - .12, top + .15, -3.66, { seg: 8 }); B(M.pBlack, .04, .09, .24, cx - .12, top + .33, -3.66, .008); aq(M.glowLit, G.lcdS, .2, .07, cx - .142, top + .33, -3.66, W_);
    B(M.pBlack, .15, .12, .2, cx + .15, top + .06, -3.45, .015); B(M.white, .003, .08, .075, cx + .1, top + .15, -3.45, 0, { rz: .2 });
    K.cyl(M.pBlack, .014, .02, .12, cx - .24, top + .06, -4.25, { seg: 8 }); B(M.pBlack, .1, .03, .17, cx - .25, top + .14, -4.25, .008, { rz: .7 }); aq(M.glowLit, G.lcdS, .07, .045, cx - .262, top + .163, -4.25, Object.assign({ rz: .7 }, W_));
    // scratch-ticket case, lottery terminal, impulse items
    E(M.glass, cx - .3, top, -6.4, cx - .06, top + .36, -4.9); aq(M.litInt, L.scratch, 1.4, .3, cx - .2, top + .18, -5.65, W_); B(M.shelf, .01, .34, 1.46, cx - .19, top + .17, -5.65); B(M.alu, .26, .012, 1.52, cx - .18, top + .366, -5.65, .003);
    B(M.mTeal, .3, .3, .36, cx + .12, top + .15, -6.4, .02); aq(M.glowLit, G.pos, .26, .2, cx + .273, top + .18, -6.4, E_); B(M.pGrey, .2, .02, .3, cx + .1, top + .31, -6.4, .005);
    K.cyl(M.glass, .08, .08, .22, cx - .05, top + .11, -2.2, { seg: 12 }); K.cyl(M.wood, .065, .065, .16, cx - .05, top + .085, -2.2, { seg: 10 }); K.cyl(M.mRed, .085, .085, .025, cx - .05, top + .23, -2.2, { seg: 12 });
    stock(-3.2, -2.5, top + .002, cx - .2, 'W', .09, [5], .12); stock(-1.95, -1.4, top + .002, cx - .2, 'W', .14, [1, 5], .12); B(M.pBlack, .2, .012, .28, cx - .15, top + .006, -4.7, .004);
    // counter flap, clerk mat, stool
    B(M.shelf, .05, .88, .8, cx, FY + .46, zb + .42, .01); B(M.pBlack, .1, .04, .84, cx, top - .02, zb + .42, .01); E(M.rubber, cx + .45, FY, za + .2, 56.42, FY + .014, zb - .2, .005);
    K.cyl(M.chrome, .02, .02, .62, 56.0, FY + .31, -2.4, { seg: 8 }); K.cyl(M.chrome, .18, .2, .02, 56.0, FY + .012, -2.4, { seg: 14 }); K.cyl(M.pBlack, .17, .16, .07, 56.0, FY + .655, -2.4, { seg: 14 });
    // back counter + floor safe + cigarette wall
    const bx = 56.72; [[za + .1, -5.95], [-5.25, -1.4]].forEach(s => { E(M.shelf, 56.45, FY, s[0], 57, FY + .88, s[1], .01); E(M.pBlack, 56.42, FY + .88, s[0] - .02, 57, FY + .92, s[1] + .02, .01); for (let z = s[0] + .5; z < s[1] - .1; z += .5) B(M.dark, .004, .8, .006, 56.448, FY + .45, z); });
    E(M.pBlack, 56.42, FY + .88, -5.97, 57, FY + .92, -5.23, .01); B(M.dark, .5, .56, .56, bx + .0, FY + .3, -5.6, .02); B(M.dark, .02, .46, .46, bx - .256, FY + .3, -5.6, .01); K.cyl(M.chrome, .05, .05, .03, bx - .28, FY + .36, -5.68, { seg: 14, rz: HP }); K.cyl(M.pBlack, .03, .03, .02, bx - .3, FY + .36, -5.68, { seg: 10, rz: HP }); B(M.chrome, .02, .03, .14, bx - .28, FY + .3, -5.45, .006); B(M.pBlack, .012, .09, .07, bx - .268, FY + .44, -5.45, .003); for (let k = -1; k <= 1; k += 2) K.cyl(M.chrome, .014, .014, .08, bx - .262, FY + .3 + k * .16, -5.84, { seg: 6 });
    aq(M.litInt, L.nocash, .22, .13, bx - .268, FY + .13, -5.6, W_);
    stock(-6.8, -6.05, FY + .922, 56.5, 'W', .2, [0, 1], .3); stock(-3.4, -1.6, FY + .922, 56.5, 'W', .16, [1, 2, 5], .3); B(M.pBlack, .36, .26, .46, 56.74, FY + 1.05, -4.5, .02); B(M.dark, .01, .2, .3, 56.558, FY + 1.05, -4.56); B(M.alu, .012, .2, .02, 56.556, FY + 1.05, -4.34);
    const cy0 = FY + 1.32, ch = 1.5, cw = 5.4, czc = -4.1; B(M.shelf, .12, ch + .06, cw + .06, 56.94, cy0 + ch / 2, czc, .008); aq(M.litInt, L.cigs, cw, ch, 56.876, cy0 + ch / 2, czc, W_); for (let k = 0; k <= 6; k++) B(M.shelf, .05, .014, cw, 56.86, cy0 + ch - k * (ch / 6) - (k === 6 ? -.007 : 0), czc);
    B(M.dark, .3, .16, cw + .1, 56.85, cy0 + ch + .12, czc, .01); B(M.lc, .03, .02, cw - .2, 56.76, cy0 + ch + .03, czc); aq(M.litInt, L.wecard, .7, .175, 56.698, cy0 + ch + .12, czc - 1.6, W_); aq(M.litInt, L.sCig, .85, .16, 56.698, cy0 + ch + .12, czc + 1.2, W_);
    // CCTV monitor hung over the south end of the counter
    K.cyl(M.galv, .014, .014, .36, cx + .1, CY - .18, -6.55, { seg: 6 }); B(M.pBlack, .07, .4, .62, cx + .1, CY - .55, -6.55, .012, { rz: -.14 }); aq(M.glowLit, G.cctv, .56, .35, cx + .06, CY - .552, -6.55, Object.assign({ rz: -.14 }, W_));
  }
  function coffeeBar(zn) { const xa = 51.0, xb = 56.3, top = FY + .92, zc = zn - .36;
    E(M.shelf, xa, FY + .1, zn - .7, xb, top - .04, zn, .01); E(M.dark, xa, FY, zn - .66, xb, FY + .1, zn); E(M.pBlack, xa - .02, top - .04, zn - .74, xb + .02, top, zn, .012); for (let x = xa + .66; x < xb; x += .66) { B(M.dark, .006, .7, .004, x, FY + .5, zn - .702); B(M.chrome, .012, .12, .014, x - .06, FY + .68, zn - .71); }
    // roller grill + sneeze guard + heat lamp
    K.push(51.7, top, zc); B(M.alu, .78, .13, .5, 0, .065, 0, .012); for (let i = 0; i < 9; i++) K.cyl(M.chrome, .016, .016, .68, 0, .15, -.18 + i * .045, { seg: 8, rz: HP }); for (let i = 0; i < 7; i++) K.cyl(M.wood, .015, .015, .15, -.24 + (i % 3) * .2 + (i > 2 ? .08 : 0), .18, -.16 + i * .05, { seg: 8, rz: HP });
    B(M.pBlack, .1, .05, .012, -.25, .06, -.252); K.cyl(M.mRed, .012, .012, .012, -.1, .07, -.256, { seg: 8, rx: HP }); B(M.glass, .8, .3, .01, 0, .36, -.26, 0, { rx: -.5 }); B(M.alu, .8, .08, .34, 0, .56, -.02, .01); B(M.lw, .7, .012, .1, 0, .516, -.04); for (let s = -1; s <= 1; s += 2) B(M.alu, .015, .5, .015, s * .39, .3, .2); aq(M.glowLit, G.hotdog, .78, .2, 0, .7, -.19, S_); B(M.alu, .8, .22, .03, 0, .7, -.17, .005); K.pop();
    // slush machine
    K.push(52.85, top, zc); B(M.pBlack, .74, .26, .5, 0, .13, 0, .015); B(M.alu, .7, .03, .2, 0, .016, -.3, .004); [[-.19, M.mRed], [.19, M.mTeal]].forEach(d => { B(M.glass, .32, .34, .4, d[0], .44, 0, .02); B(d[1], .28, .26, .36, d[0], .4, 0, .03); K.cyl(M.chrome, .02, .02, .08, d[0], .24, -.25, { seg: 8 }); B(M.pBlack, .04, .1, .03, d[0], .34, -.27, .008); }); B(M.pBlack, .74, .26, .5, 0, .74, 0, .015); aq(M.glowLit, G.slush, .7, .24, 0, .74, -.253, S_); K.pop();
    // soda fountain
    K.push(54.3, top, zc); B(M.alu, 1.3, .5, .5, 0, .37, .04, .015); B(M.dark, 1.3, .12, .6, 0, .06, 0, .01); B(M.galv, 1.2, .012, .22, 0, .124, -.17); B(M.pBlack, 1.3, .34, .5, 0, .8, .04, .015); aq(M.glowLit, G.fountain, 1.26, .31, 0, .8, -.213, S_); for (let i = 0; i < 8; i++) { B(M.pBlack, .06, .12, .08, -.52 + i * .149, .5, -.24, .012); B(M.chrome, .03, .1, .02, -.52 + i * .149, .38, -.26, .006); } K.pop();
    for (let i = 0; i < 3; i++) K.cyl(M.chrome, .05, .05, .5, 53.42 + i * .0, top + .5 + i * .0, zn - .1 - i * .11, { seg: 10, rx: .5 });
    // coffee brewers + cups
    for (let i = 0; i < 3; i++) { const x = 55.25 + i * .34; B(M.alu, .24, .46, .36, x, top + .23, zc + .06, .012); B(M.pBlack, .2, .1, .3, x, top + .47, zc + .0, .012); B(M.dark, .2, .02, .22, x, top + .012, zc - .16, .004); K.cyl(M.pBlack, .07, .06, .13, x, top + .09, zc - .17, { seg: 12 }); K.cyl(i === 1 ? M.mTeal : M.mRed, .045, .07, .03, x, top + .17, zc - .17, { seg: 12 }); B(M.lw, .03, .012, .004, x + .07, top + .4, zc - .122); }
    for (let i = 0; i < 4; i++) K.cyl(M.white, .042, .034, .2 + (i % 2) * .08, 55.05 - i * .1, top + .1 + (i % 2) * .04, zc - .1, { seg: 10 });
    B(M.pBlack, .46, .28, .36, 53.55, top + .14, zc + .08, .02); B(M.dark, .3, .2, .006, 53.5, top + .14, zc - .102);
    aq(M.litInt, L.coffeeFace, .9, .45, 55.6, FY + 2.25, zn - .004, S_); aq(M.litInt, L.p[4], .62, .93, 51.75, FY + 2.2, zn - .004, S_); aq(M.litInt, L.p[3], .62, .93, 53.1, FY + 2.2, zn - .004, S_);
    // trash + napkins
    B(M.pGrey, .4, .8, .4, 56.6, FY + .4, zn - .32, .02); B(M.pBlack, .3, .012, .3, 56.6, FY + .806, zn - .32);
    GT.world.addBox(xa, zn - .75, xb, zn, 1.1, 'station:coffee');
  }

  /* ================================================================== BUILD */
  function build(scene) {
    if (built) { if (scene && built.parent !== scene) scene.add(built); return built; }
    const t0 = performance.now(); rnd = GT.rng('solmar-stock'); buildMats(); K = GT.kit(); PB = new Batch();
    interior(); shell(); frontProps(); lot(); canopy(); S.pumps.forEach((p, i) => pump(p[0], p[1], i)); pylon(); roof(); back();
    const grp = K.build(); grp.name = 'station';
    grp.traverse(o => { if (!o.isMesh) return; const m = o.material; o.name = 'st_' + (m.name || '');
      if (m === M.glass) o.renderOrder = 2; else if (m === M.glassF) o.renderOrder = 3; else if (m === M.add || m === M.spill) { o.renderOrder = 4; o.receiveShadow = false; } else if (m.transparent) o.renderOrder = 1;
      if (m === M.lit || m === M.litInt || m === M.glowLit) o.castShadow = false; if (m === M.tile || m === M.ceil || m === M.lc || m === M.fridge) o.castShadow = m === M.ceil; });
    grp.add(PB.mesh(M.prod));
    R.leaves = [doorLeaf(-1), doorLeaf(1)]; R.leaves.forEach(l => { l.traverse(o => { if (o.material === M.glassF) o.renderOrder = 3; }); grp.add(l); });
    // real lights (4): two interior fills, canopy, alarm strobe — all driven by GT.env.night in update()
    const pl = (c, x, y, z, d) => { const l = new T.PointLight(c, 0, d, 1.6); l.position.set(x, y, z); grp.add(l); return l; };
    R.Lint = pl(0xdde8ff, 55.5, 2.55, -13.5, 19); R.Lfront = pl(0xe6ecff, 52.6, 2.5, -2.5, 17); R.Lcan = pl(0xdfeaff, CAN.x, CAN.h - .5, CAN.z, 27); R.Lalarm = pl(0xff2010, 50.6, 2.7, DZ, 16);
    let tris = 0, meshes = 0; grp.traverse(o => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    info.meshes = meshes; info.tris = Math.round(tris); info.ms = Math.round(performance.now() - t0); info.matMs = Math.round(info.matMs); info.ownMs = info.ms - info.matMs;
    console.log('[station] build ' + info.ms + ' ms (materials+atlases ' + info.matMs + ' ms), meshes ' + meshes + ', tris ' + info.tris);
    K = null; PB = null; built = grp; if (scene) scene.add(grp); update(0); return grp;
  }

  /* ================================================================== UPDATE */
  function update(dt) {
    if (!built) return; dt = Math.max(0, Math.min(+dt || 0, .1)); R.t += dt; const n = GT.env && GT.env.night !== undefined ? GT.env.night : 0;
    // master switch (state.lightsOn=false blacks the whole place out)
    const tgt = state.lightsOn === false ? 0 : 1; R.on += GT.clamp(tgt - R.on, -dt * 3, dt * 6); if (dt === 0) R.on = tgt; R.on = GT.clamp(R.on, 0, 1);
    const flick = 1 + Math.sin(R.t * 61) * .015 + (Math.sin(R.t * 2.7) > .995 ? -.25 : 0);
    for (const g of R.glows) { const k = R.on * (g.m === M.add ? flick : 1); g.day = g._d * k; g.night = g._n * k; }
    const nl = GT.sstep(n, .05, .8) * R.on; R.Lint.intensity = 1.5 * nl + .12 * R.on; R.Lfront.intensity = 1.3 * nl + .1 * R.on; R.Lcan.intensity = 1.7 * nl;
    // sliding door
    const d = GT.clamp(+state.doorOpen || 0, 0, 1); R.door += GT.clamp(d - R.door, -dt * 1.6, dt * 1.6); if (dt === 0) R.door = d; R.door = GT.clamp(R.door, 0, 1); const e = R.door * R.door * (3 - 2 * R.door);
    for (const l of R.leaves) l.position.z = DZ + l.userData.sign * e * .93;
    // alarm: double-flash strobe on the bell boxes + red wash
    let s = 0; if (state.alarm) { R.alarmT += dt; const p = (R.alarmT * 1.6) % 1; s = (p < .09 || (p > .18 && p < .27)) ? 1 : (p < .4 ? .12 : .03); } else R.alarmT = 0;
    M.strobe.color.setRGB(.05 + s * 14, .008 + s * 1.1, .006 + s * .5); R.Lalarm.intensity = s * 3.2;
  }

  GT.station = { build, update, state, info, brand: 'SOLMAR' };

  /* ================================================================== SHOWCASES */
  function show(cam, look, hours) { return ({ scene }) => { const Q = new URLSearchParams(location.search);
    if (!(Q.get('road') === '1' && GT.road && GT.road.build)) { const g = new T.Mesh(new T.PlaneGeometry(900, 900), GT.mat('asphalt')); g.rotation.x = -HP; g.position.y = -.02; g.receiveShadow = true; const uv = g.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 900, uv.getY(i) * 900); scene.add(g); }
    else try { GT.road.build(scene); } catch (e) { console.warn(e); }
    GT.station.build(scene); if (Q.get('alarm')) state.alarm = true; if (Q.get('door')) state.doorOpen = +Q.get('door'); if (Q.get('lights') === '0') state.lightsOn = false; GT.station.update(0);
    if (Q.get('car') && GT.vehicles && GT.vehicles.make) try { const c = GT.vehicles.make('hero', {}); const o = c.group || c.object || c; o.position.set(GT.L.heroStart.x, 0, GT.L.heroStart.z); o.rotation.y = GT.L.heroStart.h; scene.add(o); } catch (e) { console.warn(e); }
    if (Q.get('stats')) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:8px;bottom:8px;color:#8f8;font:13px monospace;z-index:9;background:rgba(0,0,0,.6);padding:4px 8px'; d.textContent = 'station build ' + info.ms + ' ms (materials+atlases ' + info.matMs + ' ms, geometry ' + info.ownMs + ' ms) · meshes ' + info.meshes + ' · tris ' + info.tris + ' · colliders ' + GT.world.boxes.length; document.body.appendChild(d); }
    let t = 0; return { cam, look, hours: hours || 18.2, update(dt) { t += dt; if (Q.get("alarm")) R.alarmT = 0; GT.station.update(dt); if (!(GT.atmos && GT.atmos.update) || Q.get('atmos') === '0') GT.applyGlow(GT.env.night || 0); } }; }; }
  GT.showcase.station = show([7, 1.8, 32], [38, 3.6, -9]);
  GT.showcase.station_pump = show([26.3, 1.55, -12.4], [30, 1.3, -15.8]);
  GT.showcase.station_store = show([46.2, 1.15, -4], [56, 1.35, -4]);
  GT.showcase.station_interior = show([51.6, 1.65, -9.6], [56.2, 1.3, -3.6]);
  GT.showcase.station_roof = show([45, 10.5, -24], [59, 4.2, -8]);
  GT.showcase.station_back = show([78, 2.6, 8], [68, 1.6, -3]);
})();
