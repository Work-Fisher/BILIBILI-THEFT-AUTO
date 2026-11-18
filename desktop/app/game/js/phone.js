/* phone.js — SUNSET HEAT: the in-hand phone ("Marea One", running TideOS). Owner: phone agent. Styles: css/phone.css (auto-injected).
   Pure DOM / CSS / canvas 2D, no three.js scene access. Simplified-Chinese UI. All state lives in this module; everything else is feature-detected.

   GT.phone = {
     init(opts?)                     opts: { canvas?: the game <canvas> (camera/scanner source), key?: 'KeyT' (raise/lower hotkey, null = none), footKey?: 'ArrowUp' (raises only while ctx.mode === 'foot',
                                             null = none), enabled?: false blocks the hotkeys (cutscenes), parent?: element }
     open(app?, arg?)                raise the phone. app: 'messages'|'map'|'camera'|'spume'|'scan'|'bank'|'radio'|'settings'|'home'|'lock' (omit = lock screen if locked, else where you were)
     close(), toggle(), isOpen       isOpen is a boolean getter (true while raised, including the camera viewfinder)
     notify({from, text, app?, thread?, post?, silent?})     lock-screen card + banner when raised + peek "toast" when down
     addMessage(thread, {from, text, time?, choices?})       thread: 'boss'|'lie'|'mom'|'unknown' or a display name (new names create a thread). from: 'me' = outgoing.
                                                             choices: [{id, text, reply?: string|string[]}] offers two scripted replies -> onAction('reply', {thread, id, text})
     setMap(provider)                object or () => object: { player?: {x,z,h}, pins?: [{id?,x,z,name,ch?,color?}], blips?: [{x,z,color?,r?,pulse?}], waypoint?: {x,z}|null, draw?(g, project, pxPerMetre) }
     onAction(cb) -> off()           cb(type, data). types: open close app reply waypoint photo camera scan scanned repay radio setting like live share
     update(dt, ctx?)                ctx: { pos: {x,z}, h, mode: 'foot'|'car', target?: {kind, plate, locked, security: 'old'|'modern'|'luxury'}, speed? }   (self-ticks if nobody calls it)
     apps                            { messages: {id, name, open()}, ... } plus apps.list
     captureFrame(canvas?)           call right after the WebGL frame was rendered (same task). Grabs the pending photo / feeds the scanner viewfinder. Cheap when idle.
     hookRender()                    convenience: wraps GT.render.frame so captureFrame runs after every frame (integration may call captureFrame itself instead)
     event(type, data?)              'robbery'|'chase'|'crash'|'hoops'|'dog'|'busted'|'clean'; data: {place?, car?, n?} -> a 浪花 post with a clip within ~10 s (+ live chat burst)
     livestream(on?) -> bool         right-edge scrolling chat overlay (toggle when called without argument)
     heroState                       'phone' while raised (drive GT.hero with it), else null
     camera                          { active, selfie, zoom, fov } live viewfinder state for the integration camera
     viewCamera(pos, h, eye?)        suggested {pos, look, fov} for the viewfinder (rear lens or selfie) in third-person games
     securityInfo(level)             the scanner's table row for 'old'|'modern'|'luxury' (shared with the car-theft module)
     debt                            { owed, total, pay(n) -> bool }      wallet: GT.wallet (created here with the pinned shape if nobody did)
   }
   Demo: showcase.html?m=phone&app=<lock|home|messages|map|camera|gallery|spume|scan|bank|radio|settings>&at=<seconds>&notify=1&live=1
         &sub=<thread id | 'post'>&ev=<event>&pick=0|1&shots=<n>&keys=Down,Enter&world=1&sec=old|modern|luxury&zoom=<n>&wp=x,z */
(function () {
  'use strict';
  const GT = window.GT = window.GT || {};
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
  const mkrng = seed => { if (GT.rng) return GT.rng(seed); let s = 20240611; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const rnd = mkrng('phone-ui'), pick = a => a[(rnd() * a.length) | 0];
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const cnNum = n => n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万' : Math.round(n).toLocaleString('en-US');
  const sfx = (n, o) => { try { if (GT.audio && GT.audio.ready && GT.audio.sfx) GT.audio.sfx(n, o); } catch (e) { /* audio is optional */ } };

  /* ------------------------------------------------------------------ wallet (pinned shape; created here only if nobody did) */
  GT.wallet = GT.wallet || (function () { const cbs = [], w = { cash: 0,
    add(n, why) { w.cash += n; cbs.forEach(cb => { try { cb(w.cash, n, why); } catch (e) { /* listener error */ } }); return w.cash; },
    spend(n) { if (n > w.cash) return false; w.cash -= n; cbs.forEach(cb => { try { cb(w.cash, -n, 'spend'); } catch (e) { /* listener error */ } }); return true; },
    on(cb) { cbs.push(cb); } }; return w; })();

  /* ------------------------------------------------------------------ state */
  const PW = 300, PH = 622, SW = 282, SH = 604, K = 3, PSC = .98;       // logical phone / screen size (px before scaling); K = backing-store factor for static canvases
  const S = { inited: false, open: false, locked: true, downT: 99, t: 0, u: 1, stack: [], notes: [], unread: {}, banner: null, bannerT: 0, peekT: 0, battery: .78, signal: 4, sigT: 0,
    dnd: false, wall: 0, clockT: 0, extT: -9, timers: [], ctx: {}, player: { x: 46.6, z: -4, h: Math.PI }, opts: {}, cbs: [], mapProv: null, way: null, live: false, frame: 0, lastClock: '' };
  const D = {};
  const emit = (type, data) => { for (const cb of S.cbs.slice()) { try { cb(type, data); } catch (e) { console.warn('GT.phone action listener threw', e); } } };
  const after = (sec, fn) => { S.timers.push({ t: S.t + sec, fn }); };
  const hours = () => (GT.env && typeof GT.env.hours === 'number') ? GT.env.hours : 18.2;
  const clock = h => { h = ((h === undefined ? hours() : h) % 24 + 24) % 24; const m = Math.floor(h * 60 + .001); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const night = () => (GT.env && GT.env.night) || 0;

  /* ------------------------------------------------------------------ canvas helpers + drawn icons */
  function cv(c, w, h, k) { k = k || K; c.width = Math.round(w * k); c.height = Math.round(h * k); c.style.width = w + 'px'; c.style.height = h + 'px'; const g = c.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0); return g; }
  function rr(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  const lin = (g, x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach((c, i) => gr.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, c)); return gr; };
  const ICONS = {
    messages(g) { g.fillStyle = lin(g, 0, 0, 100, 100, ['#6ff2c6', '#12b393', '#0a8f86']); g.fillRect(0, 0, 100, 100);
      g.fillStyle = '#fff'; rr(g, 20, 24, 60, 42, 17); g.fill(); g.beginPath(); g.moveTo(32, 60); g.quadraticCurveTo(31, 74, 23, 80); g.quadraticCurveTo(40, 78, 48, 64); g.fill();
      g.fillStyle = '#12b393'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(37 + i * 13, 45, 4.2, 0, TAU); g.fill(); } },
    map(g) { g.fillStyle = '#ece3cb'; g.fillRect(0, 0, 100, 100); g.fillStyle = '#dccfae'; g.fillRect(0, 0, 40, 46); g.fillStyle = '#c9e0b4'; g.fillRect(0, 58, 34, 42);
      g.fillStyle = '#f3d9a2'; g.beginPath(); g.moveTo(62, 0); g.lineTo(100, 0); g.lineTo(100, 100); g.lineTo(54, 100); g.closePath(); g.fill();
      g.fillStyle = lin(g, 70, 0, 100, 100, ['#6fd6de', '#2fa3c4']); g.beginPath(); g.moveTo(74, 0); g.bezierCurveTo(68, 30, 82, 60, 68, 100); g.lineTo(100, 100); g.lineTo(100, 0); g.closePath(); g.fill();
      g.lineCap = 'round'; g.strokeStyle = '#b9b09a'; g.lineWidth = 13; g.beginPath(); g.moveTo(48, -5); g.lineTo(44, 105); g.moveTo(-5, 52); g.lineTo(46, 52); g.stroke();
      g.strokeStyle = '#fffdf6'; g.lineWidth = 10; g.stroke(); g.strokeStyle = '#f0b23c'; g.lineWidth = 1.6; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(48, -5); g.lineTo(44, 105); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(33, 62, 9, 3, 0, 0, TAU); g.fill();
      g.fillStyle = lin(g, 20, 20, 44, 60, ['#ff6a4a', '#d7263d']); g.beginPath(); g.moveTo(32, 62); g.bezierCurveTo(14, 42, 16, 22, 32, 22); g.bezierCurveTo(48, 22, 50, 42, 32, 62); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 37, 5.6, 0, TAU); g.fill(); },
    camera(g) { g.fillStyle = lin(g, 0, 0, 100, 100, ['#5a616d', '#22262d', '#101216']); g.fillRect(0, 0, 100, 100);
      g.fillStyle = '#0c0d10'; rr(g, 60, 15, 20, 9, 4); g.fill(); g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(24, 21, 3.6, 0, TAU); g.fill();
      g.fillStyle = lin(g, 20, 24, 80, 84, ['#e9edf2', '#7d8591', '#2e333b']); g.beginPath(); g.arc(50, 55, 30, 0, TAU); g.fill();
      g.fillStyle = '#090a0d'; g.beginPath(); g.arc(50, 55, 24.5, 0, TAU); g.fill();
      const lg = g.createRadialGradient(44, 48, 2, 50, 55, 18); lg.addColorStop(0, '#7fb6ff'); lg.addColorStop(.45, '#2a3f8f'); lg.addColorStop(1, '#0a0d24'); g.fillStyle = lg; g.beginPath(); g.arc(50, 55, 17, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1.2; g.beginPath(); g.arc(50, 55, 21, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.ellipse(43, 47, 5, 3.2, -.7, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(57, 63, 2.2, 0, TAU); g.fill(); },
    spume(g) { g.fillStyle = lin(g, 0, 0, 100, 100, ['#ffbe5c', '#ff6a55', '#d6377f', '#7a2fc0']); g.fillRect(0, 0, 100, 100);
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(12, 72); g.bezierCurveTo(30, 72, 32, 36, 56, 31); g.bezierCurveTo(78, 27, 90, 47, 79, 59); g.bezierCurveTo(72, 66, 59, 61, 62, 51);
      g.bezierCurveTo(52, 57, 53, 72, 70, 72); g.lineTo(88, 72); g.lineTo(88, 80); g.lineTo(12, 80); g.closePath(); g.fill();
      [[73, 22, 4], [84, 31, 2.6], [62, 19, 2.6]].forEach(d => { g.beginPath(); g.arc(d[0], d[1], d[2], 0, TAU); g.fill(); }); },
    scan(g) { g.fillStyle = lin(g, 0, 0, 100, 100, ['#17404f', '#0a1c27', '#050d13']); g.fillRect(0, 0, 100, 100);
      g.strokeStyle = '#5ee6ff'; g.lineWidth = 5.5; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
      [[20, 20, 1, 1], [80, 20, -1, 1], [20, 80, 1, -1], [80, 80, -1, -1]].forEach(c => { g.moveTo(c[0] + c[2] * 15, c[1]); g.lineTo(c[0], c[1]); g.lineTo(c[0], c[1] + c[3] * 15); }); g.stroke();
      g.fillStyle = '#e8f6fb'; g.beginPath(); g.moveTo(30, 62); g.lineTo(32, 52); g.quadraticCurveTo(34, 49, 37, 48); g.lineTo(42, 38); g.quadraticCurveTo(44, 35, 48, 35); g.lineTo(52, 35); g.quadraticCurveTo(56, 35, 58, 38);
      g.lineTo(63, 48); g.quadraticCurveTo(66, 49, 68, 52); g.lineTo(70, 62); g.lineTo(70, 68); g.lineTo(62, 68); g.lineTo(62, 64); g.lineTo(38, 64); g.lineTo(38, 68); g.lineTo(30, 68); g.closePath(); g.fill();
      g.fillStyle = '#0a1c27'; g.beginPath(); g.moveTo(41, 47); g.lineTo(45, 39.5); g.lineTo(55, 39.5); g.lineTo(59, 47); g.closePath(); g.fill(); g.fillStyle = '#ffb347'; g.fillRect(34, 54, 7, 3.6); g.fillRect(59, 54, 7, 3.6);
      g.fillStyle = lin(g, 0, 70, 0, 78, ['rgba(94,230,255,0)', 'rgba(94,230,255,.9)']); g.fillRect(16, 70, 68, 8); g.fillStyle = '#c9f7ff'; g.fillRect(16, 77, 68, 1.6); },
    bank(g) { g.fillStyle = lin(g, 0, 0, 100, 100, ['#2a8a6c', '#0f5246', '#07302c']); g.fillRect(0, 0, 100, 100);
      g.fillStyle = lin(g, 0, 20, 0, 82, ['#ffe9a8', '#e9b24a', '#b97a22']); g.beginPath(); g.moveTo(50, 19); g.lineTo(84, 39); g.lineTo(84, 44); g.lineTo(16, 44); g.lineTo(16, 39); g.closePath(); g.fill();
      for (let i = 0; i < 4; i++) rr(g, 22 + i * 16, 48, 8.5, 22, 2), g.fill(); rr(g, 16, 73, 68, 8, 2); g.fill(); g.fillStyle = '#0f5246'; g.beginPath(); g.arc(50, 34, 4, 0, TAU); g.fill(); },
    radio(g) { g.fillStyle = lin(g, 0, 0, 100, 100, ['#ffb14a', '#f2622f', '#c9282e']); g.fillRect(0, 0, 100, 100);
      g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = 7.5; [20, 36, 52].forEach((r, i) => { g.globalAlpha = 1 - i * .16; g.beginPath(); g.arc(28, 72, r, -Math.PI / 2 + .12, -.12); g.stroke(); });
      g.globalAlpha = 1; g.fillStyle = '#fff'; g.beginPath(); g.arc(28, 72, 7.5, 0, TAU); g.fill(); },
    settings(g) { g.fillStyle = lin(g, 0, 0, 100, 100, ['#a4abb5', '#6a717b', '#3c4149']); g.fillRect(0, 0, 100, 100);
      g.fillStyle = '#f3f5f7'; g.beginPath(); const n = 8; for (let i = 0; i < n * 4; i++) { const a = i / (n * 4) * TAU - TAU / (n * 8), r = (i % 4 < 2) ? 31 : 23.5; g.lineTo(50 + Math.cos(a) * r, 50 + Math.sin(a) * r); } g.closePath();
      g.moveTo(61, 50); g.arc(50, 50, 11, 0, TAU, true); g.fill('evenodd'); }
  };
  const iconCache = {};
  /** drawn app icon as a <canvas> element of `size` CSS px (squircle, gloss, hairline). */
  function icon(id, size, cls) {
    let src = iconCache[id];
    if (!src) { src = iconCache[id] = document.createElement('canvas'); src.width = src.height = 200; const g = src.getContext('2d'); g.scale(2, 2); g.save(); rr(g, 0, 0, 100, 100, 24); g.clip();
      (ICONS[id] || ICONS.settings)(g); g.globalAlpha = 1; g.setLineDash([]);
      g.fillStyle = lin(g, 0, 0, 0, 100, ['rgba(255,255,255,.22)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,.2)']); g.fillRect(0, 0, 100, 100); g.restore();
      rr(g, .6, .6, 98.8, 98.8, 23.6); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1.2; g.stroke(); }
    const c = el('canvas', 'gp-ic' + (cls ? ' ' + cls : '')); c.width = c.height = Math.min(200, Math.ceil(size * K)); c.style.width = c.style.height = size + 'px'; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height); return c;
  }
  const iconHTML = (id, size, cls) => '<i class="gp-icslot' + (cls ? ' ' + cls : '') + '" data-ic="' + id + '" data-sz="' + size + '"></i>';
  function fillIcons(root) { root.querySelectorAll('.gp-icslot').forEach(s => { const c = icon(s.dataset.ic, +s.dataset.sz, s.className.replace('gp-icslot', '').trim()); s.replaceWith(c); }); }

  /* ------------------------------------------------------------------ wallpaper: original sunset gradient + palm silhouette */
  const WALLS = [
    { name: '日落', sky: ['#1a1440', '#4a1f66', '#a8336f', '#f0623f', '#ffb04a', '#ffe08a'], sea: ['#f08a4a', '#8a2c5c', '#2a1440', '#120a26'], sun: '#fff1b8', ink: '#0d0718' },
    { name: '夜潮', sky: ['#040a18', '#081a30', '#0f3550', '#1d6a78', '#5cc0b4', '#c6f0d8'], sea: ['#3f9a9a', '#0f3a52', '#07182c', '#030812'], sun: '#eafff4', ink: '#02060c' },
    { name: '霓虹', sky: ['#08041c', '#2a0a4a', '#7a1a8a', '#e0356e', '#ff7a8a', '#ffd0c0'], sea: ['#c0407a', '#4a1470', '#16083a', '#07031a'], sun: '#fff0f4', ink: '#060210' }
  ];
  function drawWall(g, w, h, v) {
    const P = WALLS[v % WALLS.length], r = mkrng('wall' + v), hz = h * .7, sx = w * .6, sy = hz - 24;
    g.fillStyle = lin(g, 0, 0, 0, hz, P.sky); g.fillRect(0, 0, w, hz + 1);
    let rg = g.createRadialGradient(sx, sy, 4, sx, sy, 210); rg.addColorStop(0, 'rgba(255,236,170,.75)'); rg.addColorStop(.25, 'rgba(255,170,90,.32)'); rg.addColorStop(1, 'rgba(255,120,80,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, hz);
    // long thin cloud bands lit from below
    g.save(); g.filter = 'blur(3px)'; for (let i = 0; i < 11; i++) { const y = 150 + r() * (hz - 200), x = r() * w, cw = 60 + r() * 150, ch = 2.5 + r() * 5; g.fillStyle = 'rgba(30,14,60,' + (.16 + r() * .22) + ')'; g.beginPath(); g.ellipse(x, y, cw, ch, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,190,130,' + (.1 + r() * .16) + ')'; g.beginPath(); g.ellipse(x + 6, y + ch * .9, cw * .8, ch * .45, 0, 0, TAU); g.fill(); } g.restore();
    g.fillStyle = P.sun; g.beginPath(); g.arc(sx, sy, 30, 0, TAU); g.fill(); rg = g.createRadialGradient(sx, sy, 20, sx, sy, 60); rg.addColorStop(0, 'rgba(255,244,200,.55)'); rg.addColorStop(1, 'rgba(255,244,200,0)'); g.fillStyle = rg; g.fillRect(sx - 70, sy - 70, 140, 140);
    // sea + glitter path
    g.fillStyle = lin(g, 0, hz, 0, h, P.sea); g.fillRect(0, hz, w, h - hz);
    for (let i = 0; i < 150; i++) { const t = Math.pow(r(), 1.5), y = hz + 1 + t * (h - hz) * .8, spread = 10 + t * 80, x = sx + (r() - .5) * 2 * spread, len = 3 + t * 22 * r(); g.fillStyle = 'rgba(255,' + (215 - t * 60 | 0) + ',' + (150 - t * 50 | 0) + ',' + (.5 * (1 - t) + .06) + ')'; g.fillRect(x - len / 2, y, len, .9 + t * 1.3); }
    for (let i = 0; i < 46; i++) { const t = r(), y = hz + 4 + t * (h - hz); g.fillStyle = 'rgba(255,255,255,' + (.015 + r() * .035) + ')'; g.fillRect(r() * w, y, 10 + r() * 60, .8); }
    // far shore with tiny lights
    g.fillStyle = P.ink; g.globalAlpha = .82; g.beginPath(); g.moveTo(0, hz + 1); g.lineTo(0, hz - 5); g.bezierCurveTo(30, hz - 9, 60, hz - 3, 96, hz - 2.5); g.lineTo(150, hz + 1); g.closePath(); g.fill(); g.globalAlpha = 1;
    for (let i = 0; i < 9; i++) { g.fillStyle = 'rgba(255,214,150,.9)'; g.fillRect(8 + r() * 80, hz - 4 + r() * 2, 1.1, 1.1); }
    // palms (silhouette)
    const palm = (bx, by, tx, ty, s, lean) => { g.strokeStyle = P.ink; g.fillStyle = P.ink; g.lineCap = 'round';
      const cx1 = bx + (tx - bx) * .2 + lean, cy1 = by + (ty - by) * .5; g.beginPath(); for (let i = 0; i <= 24; i++) { const t = i / 24, x = (1 - t) * (1 - t) * bx + 2 * (1 - t) * t * cx1 + t * t * tx, y = (1 - t) * (1 - t) * by + 2 * (1 - t) * t * cy1 + t * t * ty; g.lineWidth = lerp(11, 5, t) * s; if (i) { g.lineTo(x, y); g.stroke(); } g.beginPath(); g.moveTo(x, y); }
      g.beginPath(); g.arc(tx, ty, 6 * s, 0, TAU); g.fill(); g.beginPath(); g.arc(tx - 5 * s, ty + 5 * s, 3.4 * s, 0, TAU); g.arc(tx + 4 * s, ty + 6 * s, 3 * s, 0, TAU); g.fill();
      const fr = [[-2.95, 92, .9], [-2.5, 104, .55], [-2.05, 96, .25], [-1.55, 84, .1], [-1.05, 98, .3], [-.62, 108, .6], [-.2, 96, .95], [.3, 70, 1.3], [-3.5, 72, 1.25]];
      for (const f of fr) { const a = f[0] + (r() - .5) * .12, L = f[1] * s, droop = f[2] * 62 * s; let px = tx, py = ty;
        for (let i = 1; i <= 34; i++) { const t = i / 34, x = tx + Math.cos(a) * L * t, y = ty + Math.sin(a) * L * t + droop * t * t; g.lineWidth = lerp(2.6, .6, t) * s; g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
          const dx = x - px, dy = y - py, dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl, ll = (5 + 22 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), .7)) * s * (.8 + r() * .35); g.lineWidth = .95 * s;
          for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + nx * sd * ll * .55 + dx * 1.2, y + ny * sd * ll * .55 + ll * .12, x + nx * sd * ll * .8 + dx * 2.6, y + ny * sd * ll * .8 + ll * .5); g.stroke(); } px = x; py = y; } } };
    palm(w * .04, h + 12, w * .31, h * .3, 1, 26); palm(w * 1.02, h * .86, w * .88, h * .55, .5, -6);
    // foreground dune + grass tufts
    g.fillStyle = P.ink; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h - 46); g.bezierCurveTo(50, h - 60, 110, h - 18, 180, h - 12); g.lineTo(w, h - 2); g.lineTo(w, h); g.closePath(); g.fill();
    g.lineWidth = 1; for (let i = 0; i < 40; i++) { const x = r() * 150, y = h - 46 + x * .2 + r() * 6; g.beginPath(); g.moveTo(x, y + 6); g.quadraticCurveTo(x + (r() - .5) * 6, y - 6, x + (r() - .5) * 16, y - 10 - r() * 10); g.stroke(); }
    // legibility: darken the very top (status bar) and bottom (dock)
    g.fillStyle = lin(g, 0, 0, 0, 90, ['rgba(6,4,20,.42)', 'rgba(6,4,20,0)']); g.fillRect(0, 0, w, 90);
    // film grain so the gradient does not band
    for (let i = 0; i < 2600; i++) { g.fillStyle = 'rgba(' + (r() < .5 ? '255,255,255' : '0,0,0') + ',' + (r() * .035) + ')'; g.fillRect(r() * w, r() * h, .8, .8); }
  }
  function paintWall() { const g = cv(D.wall, SW, SH); drawWall(g, SW, SH, S.wall); }

  /* ------------------------------------------------------------------ screen protector: cracked corner + fingerprint smudges */
  function drawGlass() {
    const r = mkrng('crack'), g = cv(D.glass, SW, SH), ox = 21, oy = SH - 31;
    const crack = (pts, a) => { for (const pass of [[.9, .7, 'rgba(0,0,0,' + .42 * a + ')', 1.2], [0, 0, 'rgba(255,255,255,' + .6 * a + ')', .7], [-.5, -.4, 'rgba(190,225,255,' + .22 * a + ')', .5]]) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0] + pass[0], p[1] + pass[1]) : g.moveTo(p[0] + pass[0], p[1] + pass[1])); g.strokeStyle = pass[2]; g.lineWidth = pass[3]; g.stroke(); } };
    const rays = [];
    [[-1.42, 86], [-1.12, 46], [-.82, 104], [-.5, 54], [-.2, 72], [.12, 36], [-1.7, 30], [-2.3, 20], [.7, 22]].forEach(([a0, L]) => { let x = ox, y = oy, a = a0; const pts = [[x, y]], n = 4 + (L / 22 | 0);
      for (let i = 0; i < n; i++) { a += (r() - .5) * .34; x += Math.cos(a) * L / n; y += Math.sin(a) * L / n; pts.push([x, y]); } rays.push(pts); crack(pts, 1);
      if (L > 50) { const k = 1 + (r() * (pts.length - 3) | 0), b = pts[k]; let bx = b[0], by = b[1], ba = a0 + (r() < .5 ? -1 : 1) * (.5 + r() * .5); const bp = [[bx, by]]; for (let i = 0; i < 3; i++) { ba += (r() - .5) * .4; bx += Math.cos(ba) * 9; by += Math.sin(ba) * 9; bp.push([bx, by]); } crack(bp, .7); } });
    for (let i = 0; i + 1 < 6; i++) { const A = rays[i], B = rays[i + 1], ka = 1 + (r() * 2 | 0), kb = 1 + (r() * 2 | 0); if (A[ka] && B[kb]) { crack([A[ka], [(A[ka][0] + B[kb][0]) / 2 + (r() - .5) * 4, (A[ka][1] + B[kb][1]) / 2 + (r() - .5) * 4], B[kb]], .75);
      if (i % 2 === 0) { g.beginPath(); g.moveTo(ox, oy); g.lineTo(A[ka][0], A[ka][1]); g.lineTo(B[kb][0], B[kb][1]); g.closePath(); g.fillStyle = 'rgba(255,255,255,.055)'; g.fill(); } } }
    const ig = g.createRadialGradient(ox, oy, 0, ox, oy, 12); ig.addColorStop(0, 'rgba(255,255,255,.5)'); ig.addColorStop(.4, 'rgba(255,255,255,.14)'); ig.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = ig; g.fillRect(ox - 12, oy - 12, 24, 24);
    for (let i = 0; i < 26; i++) { const a = -1.9 + r() * 2.4, d = 3 + r() * 16; g.fillStyle = 'rgba(255,255,255,' + (.2 + r() * .5) + ')'; g.fillRect(ox + Math.cos(a) * d, oy + Math.sin(a) * d, .9, .9); }
    // a hairline scratch + lifted protector edge near the top right
    crack([[SW - 64, 118], [SW - 40, 131], [SW - 22, 137]], .3); g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = .8; g.beginPath(); g.arc(SW - 4, 60, 30, 2.2, 3.6); g.stroke();
    // smudges (separate canvas, revealed only where the sheen band crosses)
    const s = cv(D.smudge, SW, SH, 2), q = mkrng('smudge'); s.lineCap = 'round';
    const print = (x, y, rx, ry, rot, a) => { s.save(); s.translate(x, y); s.rotate(rot); for (let k = 0; k < 9; k++) { const f = (k + 1) / 9; s.beginPath(); for (let i = 0; i <= 40; i++) { const t = i / 40 * TAU * (.55 + q() * .4) + q() * 3, wob = 1 + Math.sin(t * 5 + k) * .03; const px = Math.cos(t) * rx * f * wob, py = Math.sin(t) * ry * f * wob - (1 - f) * ry * .15; i ? s.lineTo(px, py) : s.moveTo(px, py); } s.strokeStyle = 'rgba(255,255,255,' + a * (.6 + q() * .5) + ')'; s.lineWidth = 1.1; s.stroke(); }
      const bg = s.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry) * 1.15); bg.addColorStop(0, 'rgba(255,255,255,' + a * .55 + ')'); bg.addColorStop(1, 'rgba(255,255,255,0)'); s.fillStyle = bg; s.beginPath(); s.ellipse(0, 0, rx * 1.15, ry * 1.15, 0, 0, TAU); s.fill(); s.restore(); };
    s.filter = 'blur(.7px)'; [[214, 470, 15, 20, .5, .085], [196, 512, 14, 19, .2, .07], [84, 300, 13, 18, -.3, .055], [150, 210, 14, 19, .9, .06], [228, 330, 15, 20, .1, .06], [238, 548, 14, 18, .7, .07]].forEach(p => print(...p));
    s.filter = 'blur(3px)'; for (let i = 0; i < 7; i++) { const x = 40 + q() * 200, y = 120 + q() * 400, a = -1.2 + q() * .5, L = 60 + q() * 130; s.strokeStyle = 'rgba(255,255,255,' + (.02 + q() * .03) + ')'; s.lineWidth = 9 + q() * 12; s.beginPath(); s.moveTo(x, y); s.quadraticCurveTo(x + Math.cos(a) * L * .5 + 14, y + Math.sin(a) * L * .5, x + Math.cos(a) * L, y + Math.sin(a) * L); s.stroke(); }
    s.filter = 'none';
  }

  /* ------------------------------------------------------------------ DOM */
  function build() {
    if (S.inited) return; S.inited = true;
    const root = D.root = el('div'); root.id = 'gtp'; root.style.visibility = 'hidden';
    if (!document.querySelector('link[data-gtp]')) { const l = el('link'); l.rel = 'stylesheet'; l.dataset.gtp = '1'; l.href = 'css/phone.css?v=' + Date.now(); l.onload = l.onerror = () => { root.style.visibility = ''; }; document.head.appendChild(l); } else root.style.visibility = '';
    root.innerHTML =
      '<div class="gp-live"><div class="gp-lv-top"><b><i></i>直播中</b><span class="gp-lv-ttl">阿凯的车载频道</span><em class="gp-lv-n">0</em></div><div class="gp-lv-chat"></div><div class="gp-lv-hearts"></div><div class="gp-lv-gift"></div></div>' +
      '<div class="gp-vf"><div class="gp-vf-l"><div class="gp-vf-tools"><i class="gp-vf-fl"></i><span>HDR</span><span>4:3</span><i class="gp-vf-tm"></i></div><div class="gp-vf-esc"><kbd>Esc</kbd>返回</div></div>' +
        '<div class="gp-vf-win"><i class="gp-vf-g g1"></i><i class="gp-vf-g g2"></i><i class="gp-vf-g g3"></i><i class="gp-vf-g g4"></i><div class="gp-vf-fc"><i></i><i></i><i></i><i></i><u></u></div><div class="gp-vf-lvl"></div>' +
        '<div class="gp-vf-top"><span class="gp-vf-mode">照片</span><span class="gp-vf-meta">ISO 200 · 1/250 · f/1.8</span></div><div class="gp-vf-zoom"><span data-z="1">1×</span><span data-z="2">2×</span><span data-z="3">3×</span></div>' +
        '<div class="gp-vf-hint"><span><kbd>Enter</kbd>拍照</span><span><kbd>F</kbd>切换自拍</span><span><kbd>↑↓</kbd>变焦</span><span><kbd>G</kbd>相册</span></div><div class="gp-vf-saved">已保存到相册</div></div>' +
        '<div class="gp-vf-r"><div class="gp-vf-modes"><span>视频</span><span class="on">照片</span><span>人像</span></div><button class="gp-vf-flip" data-a="flip"><i></i></button><button class="gp-vf-sh" data-a="shoot"><i></i></button><button class="gp-vf-th" data-a="gallery"></button></div>' +
        '<i class="gp-vf-flash"></i></div>' +
      '<div class="gp-stage"><div class="gp-lift"><div class="gp-glow"></div><div class="gp-shadow"></div><div class="gp-phone">' +
        '<i class="gp-btn gp-b1"></i><i class="gp-btn gp-b2"></i><i class="gp-btn gp-b3"></i><i class="gp-side"></i><i class="gp-ant a1"></i><i class="gp-ant a2"></i><i class="gp-ant a3"></i><i class="gp-ant a4"></i>' +
        '<div class="gp-screen"><canvas class="gp-wall"></canvas><div class="gp-view"></div>' +
          '<div class="gp-status"><span class="gp-st-time"></span><span class="gp-st-r"><i class="gp-st-dnd"></i><span class="gp-st-sig"><i></i><i></i><i></i><i></i></span><b>5G</b><span class="gp-st-bat"><i></i></span><em class="gp-st-pct"></em></span></div>' +
          '<div class="gp-banner"></div><i class="gp-homebar"></i><canvas class="gp-smudge"></canvas><canvas class="gp-glass"></canvas><i class="gp-sheen"></i><i class="gp-rim"></i></div>' +
        '<i class="gp-lens"></i></div></div></div>';
    (S.opts.parent || document.body).appendChild(root);
    for (const k of ['live', 'vf', 'stage', 'lift', 'glow', 'phone', 'screen', 'wall', 'view', 'status', 'banner', 'glass', 'smudge', 'sheen']) D[k] = root.querySelector('.gp-' + k);
    D.time = root.querySelector('.gp-st-time'); D.sig = root.querySelector('.gp-st-sig'); D.bat = root.querySelector('.gp-st-bat i'); D.pct = root.querySelector('.gp-st-pct');
    D.chat = root.querySelector('.gp-lv-chat'); D.lvN = root.querySelector('.gp-lv-n'); D.hearts = root.querySelector('.gp-lv-hearts'); D.gift = root.querySelector('.gp-lv-gift');
    paintWall(); drawGlass(); resize(); addEventListener('resize', resize);
    D.view.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a || !D.view.contains(a)) return; const c = cur(); if (a.dataset.i != null && c) { c.sel = +a.dataset.i; markSel(); } doAct(a.dataset.a, a.dataset.v, a); });
    D.view.addEventListener('mousemove', e => { const a = e.target.closest('[data-i]'), c = cur(); if (a && c && c.sel !== +a.dataset.i && !a.dataset.nohover) { c.sel = +a.dataset.i; markSel(true); } });
    D.banner.addEventListener('click', () => { const n = S.banner; hideBanner(); if (n) openNote(n); });
    D.phone.addEventListener('click', () => { if (!S.open && S.peekT > 0) { const n = S.notes[0]; api.open(); if (n) openNote(n); } });
    D.vf.addEventListener('click', e => { const a = e.target.closest('[data-a]'), z = e.target.closest('[data-z]'); if (a) CAM.act(a.dataset.a); else if (z) CAM.setZoom(+z.dataset.z); else if (e.target.closest('.gp-vf-win')) CAM.focusAt(e); });
    D.vf.addEventListener('wheel', e => { CAM.setZoom(CAM.zoom - Math.sign(e.deltaY) * .25); e.preventDefault(); }, { passive: false });
    addEventListener('keydown', onKey, true);
    (function raf() { requestAnimationFrame(raf); const now = performance.now(), dt = Math.min(.1, (now - (raf.l || now)) / 1000); raf.l = now; if (now - S.extT > 300) tick(dt); })();
  }
  function resize() { const u = S.u = Math.min(innerHeight / 720, innerWidth / 1280); D.root.style.setProperty('--u', u + 'px'); D.root.style.setProperty('--s', (u * PSC).toFixed(4)); const c = cur(); if (c && APPS[c.app] && APPS[c.app].resize) APPS[c.app].resize(c); }

  /* ------------------------------------------------------------------ navigation: a stack of {app, page, arg, sel}; every screen renders from state */
  const APPS = {}, ORDER = ['messages', 'map', 'camera', 'spume', 'scan', 'bank', 'radio', 'settings'];
  const NAMES = { messages: '信息', map: '地图', camera: '相机', spume: '浪花', scan: '扫车', bank: '银行', radio: '电台', settings: '设置', home: '主屏幕', lock: '锁屏' };
  const ACC = { messages: '#2fd3a6', map: '#58c8d8', camera: '#cfd6e0', spume: '#ff6a7a', scan: '#5ee6ff', bank: '#e9b24a', radio: '#ff8a3d', settings: '#aab2bd', home: '#ff9a5a', lock: '#ff9a5a' };
  const cur = () => S.stack[S.stack.length - 1];
  function render(dir) {
    const c = cur(); if (!c || !S.inited) return; const A = APPS[c.app], old = D.view.firstElementChild, keep = dir === 0 && old ? old.querySelector('.gp-scroll') : null, st = keep ? keep.scrollTop : 0;
    const node = el('div', 'gp-page gp-p-' + c.app + (dir === 0 ? '' : dir < 0 ? ' gp-back' : ' gp-fwd')); node.innerHTML = A.render(c) || ''; fillIcons(node);
    D.view.textContent = ''; D.view.appendChild(node); c.node = node; D.screen.dataset.app = c.app; D.root.style.setProperty('--acc', ACC[c.app] || '#ff9a5a');
    D.root.classList.toggle('gp-light', !!A.lightStatus); if (A.mount) A.mount(c, node); const sc = node.querySelector('.gp-scroll'); if (sc && keep) sc.scrollTop = st; markSel(true);
    const vf = c.app === 'camera' && c.page === 'vf'; D.root.classList.toggle('gp-cam', vf && S.open); CAM.sync(vf && S.open);
  }
  function nav(app, page, arg, o) { const p = cur(); if (p && APPS[p.app] && APPS[p.app].leave) APPS[p.app].leave(p); if (o && o.replace) S.stack.pop(); if (o && o.reset) S.stack.length = 0;
    const c = { app, page: page || APPS[app].home || 'main', arg, sel: 0 }; S.stack.push(c); if (APPS[app].enter) APPS[app].enter(c); render(1); if (ORDER.includes(app) && (!p || p.app !== app)) emit('app', { app }); }
  function back() { const p = cur(); if (!p) return; if (p.app === 'home' || p.app === 'lock') return api.close(); if (APPS[p.app].leave) APPS[p.app].leave(p); S.stack.pop();
    if (!S.stack.length) S.stack.push({ app: 'home', page: 'main', sel: Math.max(0, HOMEORD.indexOf(p.app)) }); const c = cur(); if (APPS[c.app].enter) APPS[c.app].enter(c); render(-1); sfx('ui_tick'); }
  const refresh = () => render(0);
  const onApp = (app, page) => { const c = cur(); return S.open && c && c.app === app && (!page || c.page === page); };
  function markSel(noScroll) { const c = cur(); if (!c || !c.node) return; c.node.querySelectorAll('[data-i]').forEach(n => { const on = +n.dataset.i === c.sel; n.classList.toggle('sel', on);
    if (on && !noScroll) { const sc = n.closest('.gp-scroll'); if (sc) { const top = n.offsetTop - sc.offsetTop, bot = top + n.offsetHeight; if (top < sc.scrollTop + 4) sc.scrollTop = Math.max(0, top - 8); else if (bot > sc.scrollTop + sc.clientHeight - 4) sc.scrollTop = bot - sc.clientHeight + 8; } } }); }
  function tap(node) { if (!node) return; node.classList.remove('gp-tap'); void node.offsetWidth; node.classList.add('gp-tap'); }
  function doAct(a, v, node) { const c = cur(); if (!c) return; tap(node); if (a === 'back') return back(); const A = APPS[c.app]; if (A.act) A.act(a, v, c, node); }
  /** generic list / grid keyboard handling over the [data-i] elements of the page. */
  function listKey(code, c, cols) { const n = c.node ? c.node.querySelectorAll('[data-i]').length : 0; if (!n) return false; cols = cols || 1; let s = c.sel;
    if (code === 'ArrowDown') s += cols; else if (code === 'ArrowUp') s -= cols; else if (code === 'ArrowRight' && cols > 1) s += 1; else if (code === 'ArrowLeft' && cols > 1) s -= 1;
    else if (code === 'Enter' || code === 'Space') { const node = c.node.querySelector('[data-i="' + c.sel + '"]'); if (node) doAct(node.dataset.a, node.dataset.v, node); return true; } else return false;
    s = clamp(s, 0, n - 1); if (s !== c.sel) { c.sel = s; markSel(); sfx('ui_tick'); } return true; }
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; const code = e.code, hot = S.opts.key === undefined ? 'KeyT' : S.opts.key, fk = S.opts.footKey === undefined ? 'ArrowUp' : S.opts.footKey;
    if (!S.open) { if (!e.repeat && !(GT.front && GT.front.busy) && S.opts.enabled !== false && ((hot && code === hot) || (fk && code === fk && S.ctx && S.ctx.mode === 'foot'))) { api.open(); eat(e); } return; }
    if (GT.front && GT.front.busy) return;
    if (hot && code === hot) { if (!e.repeat) api.close(); eat(e); return; }
    const c = cur(), A = c && APPS[c.app]; let used = false;
    if (code === 'Escape' || code === 'Backspace') { if (!e.repeat) back(); used = true; }
    else if (A && A.key && A.key(code, c, e)) used = true;
    else if (/^(Arrow|Enter|Space)/.test(code)) used = listKey(code, c, A && A.cols) || /^Arrow/.test(code) || code === 'Enter';
    if (used) eat(e);
  }
  function eat(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); try { if (GT.input && GT.input.consume) GT.input.consume(e.code); } catch (x) { /* input is optional */ } }
  const hd = (title, right, sub) => '<div class="gp-hd"><b class="gp-bk" data-a="back"></b><div class="gp-hd-t"><h1>' + title + '</h1>' + (sub ? '<small>' + sub + '</small>' : '') + '</div><div class="gp-hd-r">' + (right || '') + '</div></div>';

  /* ------------------------------------------------------------------ status bar, notifications, banner, peek */
  function statusTick(dt) {
    const drain = (S.live ? 3 : 1) * (CAM.active ? 3 : 1) * (S.open ? 1.4 : 1); S.battery = Math.max(.04, S.battery - dt * drain / 5200);
    S.sigT -= dt; if (S.sigT <= 0) { S.sigT = 2 + rnd() * 4; const p = S.player, base = p.x < -45 ? 2 : p.x < -8 ? 3 : (p.x > 50 && p.x < 68 && p.z > -30 && p.z < 12) ? 3 : 4; S.signal = clamp(base + (rnd() < .22 ? -1 : 0), 1, 4); }
    const t = clock(); if (t !== D.time.textContent) D.time.textContent = t; S.clockT -= dt;
    if (S.clockT <= 0) { S.clockT = .5; const pct = Math.round(S.battery * 100); D.pct.textContent = pct; D.bat.style.width = Math.max(8, pct) + '%'; D.bat.parentNode.classList.toggle('low', pct <= 20);
    D.sig.dataset.n = S.signal; D.root.classList.toggle('gp-dnd', S.dnd); D.glow.style.opacity = (.14 + night() * .46).toFixed(2); }
    if (t !== S.lastClock) { S.lastClock = t; const c = cur(); if (S.open && c && c.app === 'lock') { const n = c.node && c.node.querySelector('.gp-clock'); if (n) n.textContent = t; } else if (S.open && c && c.app === 'home') refresh(); }
  }
  const unreadOf = app => S.notes.reduce((n, x) => n + (x.app === app && !x.seen ? 1 : 0), 0);
  function noteHTML(n, i, cls) { const age = S.t - n.t; return '<div class="gp-note ' + (cls || '') + '" data-a="note" data-v="' + n.id + '"' + (i != null ? ' data-i="' + i + '"' : '') + '>' + iconHTML(n.app, 30) +
    '<div class="gp-note-b"><div class="gp-note-h"><b>' + esc(n.from) + '</b><em>' + (age < 50 ? '现在' : Math.round(age / 60) + ' 分钟前') + '</em></div><p>' + esc(n.text) + '</p></div></div>'; }
  function openNote(n) { n.seen = true; if (n.app === 'messages' && n.thread) { S.stack.length = 0; S.stack.push({ app: 'home', page: 'main', sel: 4 }); nav('messages', 'list'); nav('messages', 'thread', n.thread); }
    else if (n.app === 'spume' && n.post) { S.stack.length = 0; S.stack.push({ app: 'home', page: 'main', sel: 7 }); nav('spume', 'feed'); nav('spume', 'post', n.post); }
    else if (APPS[n.app]) { S.stack.length = 0; S.stack.push({ app: 'home', page: 'main', sel: Math.max(0, HOMEORD.indexOf(n.app)) }); nav(n.app); } S.locked = false; }
  function showBanner(n) { S.banner = n; S.bannerT = 4.2; D.banner.innerHTML = noteHTML(n); fillIcons(D.banner); D.banner.classList.remove('on'); void D.banner.offsetWidth; D.banner.classList.add('on'); }
  function hideBanner() { S.banner = null; S.bannerT = 0; D.banner.classList.remove('on'); }
  let noteId = 0;
  function notify(o) {
    build(); o = o || {}; const n = { id: ++noteId, from: o.from || 'TideOS', text: o.text || '', app: APPS[o.app] ? o.app : 'messages', thread: o.thread, post: o.post, t: S.t, seen: false };
    S.notes.unshift(n); if (S.notes.length > 24) S.notes.length = 24;
    const c = cur();
    if (S.open && c && c.app === 'lock') { render(0); const first = c.node.querySelector('.gp-note'); if (first) first.classList.add('gp-new'); buzz(); }
    else if (S.open && !CAM.active) { showBanner(n); buzz(); if (c && c.app === 'home') refreshBadges(); }
    else if (!S.open) { S.locked = true; if (!S.dnd && !o.silent) { S.stack.length = 0; S.stack.push({ app: 'lock', page: 'main', sel: -1 }); render(0); showBanner(n); S.bannerT = 99; S.peekT = 4.6; D.root.classList.add('gp-peek'); buzz(); } }
    if (!o.silent && !S.dnd) sfx('ui_tick');
    return n;
  }
  function buzz() { D.stage.classList.remove('gp-buzz'); void D.stage.offsetWidth; D.stage.classList.add('gp-buzz'); }
  function refreshBadges() { const c = cur(); if (!c || c.app !== 'home' || !c.node) return; c.node.querySelectorAll('.gp-app-i').forEach(n => { const k = unreadOf(n.dataset.v), b = n.querySelector('.gp-badge'); b.textContent = k || ''; b.classList.toggle('on', k > 0); }); }

  /* ------------------------------------------------------------------ lock screen */
  function unlock(app) { S.locked = false; S.stack.length = 0; S.stack.push({ app: 'home', page: 'main', sel: 4 }); if (app) nav(app); else render(1); sfx('ui_ok'); }
  APPS.lock = {
    enter(c) { c.sel = -1; },
    render() { const ns = S.notes.filter(n => !n.seen), show = ns.slice(0, 4);
      return '<div class="gp-lock"><div class="gp-lk-car"><i></i>Brisa Mobile</div><div class="gp-lk-time gp-clock">' + clock() + '</div><div class="gp-lk-date">星期四 · Costa Brisa · 31°</div>' +
        '<div class="gp-lk-notes">' + show.map((n, i) => noteHTML(n, i)).join('') + (ns.length > show.length ? '<div class="gp-lk-more">还有 ' + (ns.length - show.length) + ' 条通知</div>' : '') + (ns.length ? '' : '<div class="gp-lk-more">没有新通知</div>') + '</div>' +
        '<div class="gp-lk-foot"><b class="gp-lk-b torch"><i></i></b><span><kbd>Enter</kbd>解锁</span><b class="gp-lk-b cam" data-a="cam"><i></i></b></div></div>'; },
    mount(c, node) { node.addEventListener('click', e => { if (!e.target.closest('[data-a]')) unlock(); }); },
    act(a, v) { if (a === 'note') { const n = S.notes.find(x => x.id === +v); if (n) openNote(n); } else if (a === 'cam') unlock('camera'); },
    key(code, c) { if (code === 'Enter' || code === 'Space') { const n = c.sel >= 0 && c.node.querySelector('[data-i="' + c.sel + '"]'); if (n) doAct('note', n.dataset.v, n); else unlock(); return true; } return false; }
  };

  /* ------------------------------------------------------------------ home screen */
  const HOMEORD = ['scan', 'bank', 'radio', 'settings', 'messages', 'map', 'camera', 'spume'];
  APPS.home = { cols: 4,
    render() { const cell = (id, i) => '<div class="gp-app-i" data-a="app" data-v="' + id + '" data-i="' + i + '">' + iconHTML(id, 54) + '<span>' + NAMES[id] + '</span><em class="gp-badge' + (unreadOf(id) ? ' on' : '') + '">' + (unreadOf(id) || '') + '</em></div>';
      const top = FEED.posts.slice().sort((a, b) => b.views - a.views)[0], h = hours(), nightly = h > 19.7 || h < 6.6;
      return '<div class="gp-home"><div class="gp-wd gp-wd-wx"><div class="gp-wx-l"><small>Costa Brisa</small><b>' + (nightly ? 27 : 31) + '°</b><span>' + (nightly ? '闷热 · 夜间雷雨' : '闷热 · 湿度 84%') + '</span></div><div class="gp-wx-r"><canvas class="gp-suncv"></canvas><small>日落 19:42 · 今晚有雷雨</small></div></div>' +
        '<div class="gp-wd-row"><div class="gp-wd gp-wd-s" data-a="app" data-v="bank"><small><i class="gp-pip" style="background:#e9b24a"></i>欠 郝老板</small><b>' + money(DEBT.owed) + '</b><i class="gp-pg"><u style="width:' + Math.round((1 - DEBT.owed / DEBT.total) * 100) + '%"></u></i><span>周五到期 · 还剩 1 天</span></div>' +
        '<div class="gp-wd gp-wd-s" data-a="app" data-v="spume"><small><i class="gp-pip" style="background:#ff6a7a"></i>浪花 · 热门</small><p>' + (top ? esc(top.text) : '') + '</p><span>' + (top ? cnNum(top.views) + ' 次观看' : '') + '</span></div></div>' +
        '<div class="gp-grid">' + HOMEORD.slice(0, 4).map((id, i) => cell(id, i)).join('') + '</div><div class="gp-dots"><i class="on"></i><i></i></div><div class="gp-dock">' + HOMEORD.slice(4).map((id, i) => cell(id, i + 4)).join('') + '</div></div>'; },
    mount(c, node) { const cvs = node.querySelector('.gp-suncv'), w = 112, hh = 44, g = cv(cvs, w, hh), t = (hours() - 6.6) / 13.1, y0 = hh - 9, R = 46, cx = w / 2;
      g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(2, y0); g.lineTo(w - 2, y0); g.stroke();
      g.setLineDash([2.5, 3]); g.strokeStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.ellipse(cx, y0, R, 30, 0, Math.PI, TAU); g.stroke(); g.setLineDash([]);
      const tc = clamp(t, 0, 1), a = Math.PI + tc * Math.PI, sx = cx + Math.cos(a) * R, sy = y0 + Math.sin(a) * 30 + (t > 1 ? Math.min(7, (t - 1) * 60) : 0);
      g.strokeStyle = '#ffc46a'; g.lineWidth = 1.8; g.beginPath(); g.ellipse(cx, y0, R, 30, 0, Math.PI, a); g.stroke();
      const gl = g.createRadialGradient(sx, sy, 0, sx, sy, 13); gl.addColorStop(0, t > 1 ? 'rgba(255,120,90,.8)' : 'rgba(255,210,120,.9)'); gl.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = gl; g.fillRect(sx - 14, sy - 14, 28, 28);
      g.save(); g.beginPath(); g.rect(0, 0, w, y0); g.clip(); g.fillStyle = '#fff3cf'; g.beginPath(); g.arc(sx, sy, 4.4, 0, TAU); g.fill(); g.restore(); },
    act(a, v) { if (a === 'app' && APPS[v]) { nav(v); sfx('ui_tick'); } }
  };

  /* ------------------------------------------------------------------ 信息 */
  const TH = {}, THORD = []; let seq = 0;
  function mkThread(id, name, sub, hue, msgs, choices, unread) { TH[id] = { id, name, sub, hue, msgs: (msgs || []).map(m => ({ from: m[0] ? 'me' : 'them', text: m[1], time: m[2] })), choices: choices || null, unread: unread || 0, typing: false, last: ++seq }; THORD.push(id); return TH[id]; }
  mkThread('unknown', '未知号码', '号码已隐藏', 250, [[0, '白色那辆，车牌尾号 7K。', '昨天 23:51'], [0, '我知道星期四晚上是谁开的车。', '昨天 23:52'], [0, '别回这个号码。', '昨天 23:52']],
    [{ id: 'who', text: '你是谁？', fail: true, reply: [] }, { id: 'ignore', text: '（不回，删掉记录）', silent: true, reply: [] }], 0);
  mkThread('mom', '妈', '手机 · 老家', 334, [[0, '凯凯，吃饭了没有', '16:20'], [1, '吃了。', '16:44'], [0, '你表弟是不是又去找你了？别跟他瞎混', '17:02'], [0, '天气预报说晚上有雷雨，开车慢点。', '17:03'], [0, '看到回个话，妈不睡。', '17:31']],
    [{ id: 'fine', text: '吃了，妈。车我开得很慢，早点睡。', reply: ['好。那个药我按时吃着呢，别操心。', '钱的事别硬扛，妈这儿还有一点。'] }, { id: 'later', text: '在忙，晚点打给你。', reply: ['每次都说晚点。', '行，妈等你。'] }], 2);
  mkThread('boss', '郝老板', '+1 (786) 555-0142', 28, [[0, '阿凯，下午好。希望令堂身体安康。', '周一 15:00'], [1, '郝老板，这周手头有点紧。', '周一 15:26'], [0, '理解。年轻人谁没紧过。', '周一 15:27'], [0, '四万的事，我不催。我只是喜欢提前知道结果。', '14:05'], [0, '星期五。我这人很守时，也希望朋友们守时。', '14:06']],
    [{ id: 'promise', text: '周五之前，一分不少。', reply: ['好。我就喜欢和讲信用的人打交道。', '替我向令堂问好。她住的那条街，路灯是不是还没修？'] }, { id: 'stall', text: '能不能再宽限几天？', reply: ['当然可以。', '利息会替你记着时间。星期五见。'] }], 1);
  mkThread('lie', '阿烈', '表弟 · 别借他钱', 172, [[0, '哥', '17:48'], [0, '哥哥哥', '17:48'], [0, '你在吗 急事 也不算急 但是挺急的', '17:49'], [1, '说。', '17:55'], [0, '我发现一个地方 收银台后面就一个大爷 还在打瞌睡', '17:55'], [0, '五分钟的事 真的 这次是真的五分钟', '17:56'], [0, '[图片] 你看这狗 它冲我笑', '18:02']],
    [{ id: 'where', text: '在哪？', reply: ['SOLMAR 加油站 你把车停门口就行', '别熄火！！！', '也别问我面罩哪来的'], next: [{ id: 'omw', text: '五分钟。就五分钟。', reply: ['爱你哥 你是我亲哥', '（表哥也是哥）'] }, { id: 'last', text: '最后一次。', reply: ['你上次也这么说的 我截图了'] }] },
      { id: 'no', text: '不干。说好不干了。', reply: ['行行行', '那你来接我总可以吧', '我已经在里面了'], next: [{ id: 'omw', text: '……等着。', reply: ['就知道你最好了'] }, { id: 'last', text: '我要告诉我妈。', reply: ['你别 你别 姑妈会打死我的'] }] }], 3);
  function thr(x) { if (x && x.id && TH[x.id]) return x; if (TH[x]) return TH[x]; const n = String(x || '未知号码'); for (const k of THORD) if (TH[k].name === n) return TH[k]; let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) % 360; return mkThread('t' + (THORD.length + 1), n, '', h, [], null, 0); }
  function addMessage(thread, m) {
    build(); const th = thr(thread); m = m || {}; const me = m.from === 'me' || m.from === '阿凯' || m.from === 'kai', msg = { from: me ? 'me' : 'them', text: String(m.text == null ? '' : m.text), time: m.time || clock(), fail: !!m.fail };
    th.msgs.push(msg); th.last = ++seq; th.typing = false; if (m.choices && m.choices.length) th.choices = m.choices.slice(0, 2);
    const viewing = onApp('messages', 'thread') && cur().arg === th.id;
    if (!me && !viewing) { th.unread++; notify({ from: th.name, text: msg.text, app: 'messages', thread: th.id, silent: m.silent }); }
    if (viewing) { refresh(); const sc = cur().node.querySelector('.gp-scroll'); if (sc) sc.scrollTop = 1e6; const last = sc && sc.querySelector('.gp-bub:last-of-type'); if (last) last.classList.add('gp-new'); if (!me) sfx('ui_tick'); }
    else if (onApp('messages', 'list')) refresh();
    return msg;
  }
  const avatar = (th, big) => '<i class="gp-av' + (big ? ' big' : '') + '" style="--h:' + th.hue + '">' + (th.id === 'unknown' ? '?' : esc(th.name.slice(-1) === '板' ? th.name[0] : th.name.slice(-1))) + '</i>';
  APPS.messages = {
    render(c) {
      if (c.page === 'thread') { const th = TH[c.arg], bubs = th.msgs.map((m, i) => { const nx = th.msgs[i + 1], tail = !nx || nx.from !== m.from, pv = th.msgs[i - 1], gap = !pv || pv.time.slice(0, 2) !== m.time.slice(0, 2) || (pv.time.length > 5) !== (m.time.length > 5);
          return (gap && (m.time.length > 5 || i === 0 || pv.time.length > 5) ? '<div class="gp-day">' + (m.time.length > 5 ? esc(m.time.split(' ')[0]) : '今天') + '</div>' : '') + '<div class="gp-bub ' + m.from + (tail ? ' tail' : '') + (m.fail ? ' fail' : '') + '"><p>' + esc(m.text) + '</p>' + (tail ? '<em>' + (m.fail ? '未送达 · ' : '') + esc(m.time.split(' ').pop()) + '</em>' : '') + '</div>'; }).join('');
        return '<div class="gp-app gp-thread"><div class="gp-hd"><b class="gp-bk" data-a="back"></b>' + avatar(th) + '<div class="gp-hd-t"><h1>' + esc(th.name) + '</h1><small>' + esc(th.sub) + '</small></div></div><div class="gp-scroll gp-bubs">' + bubs + (th.typing ? '<div class="gp-bub them tail gp-typing"><p><i></i><i></i><i></i></p></div>' : '') + '</div>' +
          (th.choices ? '<div class="gp-ch"><small>选择回复 <kbd>↑↓</kbd><kbd>Enter</kbd></small>' + th.choices.map((o, i) => '<button data-a="reply" data-v="' + i + '" data-i="' + i + '">' + esc(o.text) + '</button>').join('') + '</div>' : '<div class="gp-inp"><span>' + (th.typing ? '对方正在输入…' : '信息') + '</span><i></i></div>') + '</div>'; }
      const list = THORD.map(k => TH[k]).sort((a, b) => b.last - a.last), n = list.reduce((s, t) => s + t.unread, 0);
      return '<div class="gp-app gp-msgs">' + hd('信息', n ? '<em class="gp-pill">' + n + ' 条未读</em>' : '') + '<div class="gp-scroll">' + list.map((th, i) => { const m = th.msgs[th.msgs.length - 1] || { text: '', time: '' };
        return '<div class="gp-row' + (th.unread ? ' unread' : '') + '" data-a="thread" data-v="' + th.id + '" data-i="' + i + '">' + avatar(th, 1) + '<div class="gp-row-b"><div class="gp-row-h"><b>' + esc(th.name) + '</b><em>' + esc(m.time) + '</em></div><p>' + (m.from === 'me' ? '你：' : '') + esc(m.text) + '</p></div>' + (th.unread ? '<u class="gp-dot">' + th.unread + '</u>' : '') + '</div>'; }).join('') +
        '<div class="gp-end">TideOS 信息 · 端到端都不太安全</div></div></div>'; },
    mount(c, node) { if (c.page !== 'thread') return; const th = TH[c.arg]; th.unread = 0; S.notes.forEach(n => { if (n.thread === th.id) n.seen = true; }); const sc = node.querySelector('.gp-scroll'); sc.scrollTop = 1e6; },
    act(a, v, c) { if (a === 'thread') { nav('messages', 'thread', v); sfx('ui_tick'); }
      else if (a === 'reply') { const th = TH[c.arg], o = th.choices && th.choices[+v]; if (!o) return; th.choices = null; c.sel = 0; if (!o.silent) addMessage(th.id, { from: 'me', text: o.text, fail: o.fail }); else refresh();
        emit('reply', { thread: th.id, id: o.id, text: o.text }); sfx(o.fail ? 'ui_bad' : 'ui_ok'); let d = .9; const viewing = () => onApp('messages', 'thread') && cur().arg === th.id;
        [].concat(o.reply || []).forEach(r => { after(d, () => { th.typing = true; if (viewing()) { refresh(); cur().node.querySelector('.gp-scroll').scrollTop = 1e6; } }); d += 1.1 + Math.min(2.2, String(r.text || r).length * .05); after(d, () => addMessage(th.id, typeof r === 'string' ? { from: th.name, text: r } : r)); d += .45; });
        if (o.next) after(d + .3, () => { th.choices = o.next; if (viewing()) { refresh(); cur().node.querySelector('.gp-scroll').scrollTop = 1e6; } }); } },
    tick(dt, c) { if (c.page !== 'thread' || !c.node) return; const sc = c.node.querySelector('.gp-scroll'); if (sc && sc.scrollHeight !== c.lastH) { c.lastH = sc.scrollHeight; sc.scrollTop = 1e6; } },
    key(code, c) { if (c.page === 'thread') { if (code === 'ArrowLeft') return listKey('ArrowUp', c); if (code === 'ArrowRight') return listKey('ArrowDown', c); } return false; }
  };

  /* ------------------------------------------------------------------ 地图 (north = +Z up, drawn straight from GT.L; a true rotation of the world, so the sea is on the right) */
  const L = () => GT.L || { highway: { x: 0, width: 15, zMin: -190, zMax: 190 }, crossS: { z: -160, width: 9, x0: 0, x1: 150 }, crossN: { z: 160, width: 9, x0: 0, x1: 150 }, backRoad: { x: 150, width: 9, zMin: -160, zMax: 160 }, beach: { x0: -60, x1: -10 }, ocean: { x1: -60 },
    station: { x0: 14, x1: 72, z0: -42, z1: 26, canopy: { x: 34, z: -8, w: 16, d: 26 }, pumps: [[30, -16], [30, -8], [30, 0], [38, -16], [38, -8], [38, 0]], store: { x0: 50, x1: 68, z0: -30, z1: 12 } },
    motel: { x0: 14, x1: 92, z0: 48, z1: 132, wingE: { x0: 74, x1: 86, z0: 54, z1: 128 }, wingN: { x0: 22, x1: 74, z0: 116, z1: 128 }, pool: { x: 44, z: 84, w: 12, d: 7 }, parking: [] }, lotC: { x0: 14, x1: 142, z0: -152, z1: -52 }, lotD: { x0: 98, x1: 142, z0: -42, z1: 132 }, lotE: { x0: 14, x1: 142, z0: 138, z1: 152 }, bounds: { x0: -58, x1: 162, z0: -186, z1: 186 } };
  const PINS = [
    { id: 'station', x: 59, z: -8, name: 'SOLMAR 加油站', ch: '油', color: '#ff8a3d', note: '便利店 · 24 小时' }, { id: 'motel', x: 62, z: 86, name: '棕榈汽车旅馆', ch: '宿', color: '#e0457e', note: '换车点 · 安全屋' },
    { id: 'court', x: -34, z: -60, name: '海滨半场', ch: '球', color: '#ffb347', note: '投篮 · 斗牛' }, { id: 'gym', x: -30, z: -20, name: '沙滩健身角', ch: '健', color: '#9ad65a', note: '卧推 · 弯举' }, { id: 'bar', x: -32, z: 30, name: '提基酒吧', ch: '酒', color: '#ff6a7a', note: '日落特调' },
    { id: 'pier', x: -58, z: 92, name: '栈桥钓点', ch: '钓', color: '#58c8d8', note: '傍晚鱼口好' }, { id: 'ring', x: 118, z: 60, name: '后院擂台', ch: '擂', color: '#c9a0ff', note: '周六晚 · 自带椅子' } ];
  const M = { cx: 40, cz: 0, tx: 40, tz: 0, zoom: 1.5, tzoom: 1.5, follow: true, sel: -1, cursor: null, ptr: new Map(), moved: 0, pinch: 0, pins: PINS, W: SW, H: SH, k: 2 };
  const LOOP = { X0: 0, X1: 150, Z0: -160, Z1: 160 };
  function loopProj(p) { const { X0, X1, Z0, Z1 } = LOOP, c = [[X0, clamp(p.z, Z0, Z1), 0], [clamp(p.x, X0, X1), Z1, 1], [X1, clamp(p.z, Z0, Z1), 2], [clamp(p.x, X0, X1), Z0, 3]]; let best = null;
    for (const q of c) { const d = Math.hypot(q[0] - p.x, q[1] - p.z); if (!best || d < best.d) best = { d, x: q[0], z: q[1], e: q[2] }; }
    const hgt = Z1 - Z0, wid = X1 - X0; best.s = best.e === 0 ? best.z - Z0 : best.e === 1 ? hgt + best.x - X0 : best.e === 2 ? hgt + wid + (Z1 - best.z) : 2 * hgt + wid + (X1 - best.x); return best; }
  function route(a, b) { const direct = Math.hypot(a.x - b.x, a.z - b.z); if (direct < 45) return { pts: [[a.x, a.z], [b.x, b.z]], len: direct };
    const { X0, X1, Z0, Z1 } = LOOP, pa = loopProj(a), pb = loopProj(b), hgt = Z1 - Z0, wid = X1 - X0, tot = 2 * (hgt + wid), cs = [[0, X0, Z0], [hgt, X0, Z1], [hgt + wid, X1, Z1], [2 * hgt + wid, X1, Z0]];
    const fwd = ((pb.s - pa.s) % tot + tot) % tot, dir = fwd <= tot - fwd ? 1 : -1, span = dir > 0 ? fwd : tot - fwd, mid = [];
    for (const c of cs) { const d = dir > 0 ? ((c[0] - pa.s) % tot + tot) % tot : ((pa.s - c[0]) % tot + tot) % tot; if (d > .01 && d < span) mid.push([d, c[1], c[2]]); } mid.sort((p, q) => p[0] - q[0]);
    const pts = [[a.x, a.z], [pa.x, pa.z]].concat(mid.map(m => [m[1], m[2]]), [[pb.x, pb.z], [b.x, b.z]]); let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return len > direct * 2.6 && direct < 90 ? { pts: [[a.x, a.z], [b.x, b.z]], len: direct } : { pts, len }; }
  function mapProv() { let p = S.mapProv; if (typeof p === 'function') { try { p = p(); } catch (e) { p = null; } } return p || {}; }
  function allPins(prov) { const out = PINS.slice(), A = GT.world && GT.world.anchors || {};
    if (A.tacoTruck) out.push({ id: 'taco', x: A.tacoTruck.x, z: A.tacoTruck.z, name: '塔可车', ch: '食', color: '#f2c14e', note: '今天出摊' }); if (A.busStop) out.push({ id: 'bus', x: A.busStop.x, z: A.busStop.z, name: '公交站', ch: '站', color: '#8fb4d9', note: '末班 22:40' });
    const sh = A.safehouse || A.safehouseDoor || A.roomDoor; if (sh) out.push({ id: 'safehouse', x: sh.x, z: sh.z, name: '安全屋', ch: '家', color: '#8fe6c2', note: '换衣服 · 藏钱' });
    for (const p of (prov.pins || [])) out.push(Object.assign({ ch: (p.name || '?')[0], color: '#ffd08a', id: 'x' + out.length }, p)); return out; }
  const placeNear = (x, z, pins) => { let b = null, bd = 1e9; for (const p of (pins || PINS)) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; b = p; } } return b && bd < 34 ? (bd < 12 ? b.name : b.name + '附近') : (x < -60 ? '海上' : x < -10 ? '海滩' : Math.abs(x) < 9 ? '海滨公路' : '后街一带'); };
  function drawMap() {
    const c = cur(), cvs = c && c.node && c.node.querySelector('.gp-mapcv'); if (!cvs) return; const W = M.W, H = M.H, g = cvs.getContext('2d'), k = M.k, l = L(), prov = mapProv(), pl = S.player, z = M.zoom;
    const pins = M.pins = allPins(prov), way = prov.waypoint !== undefined ? prov.waypoint : S.way, PX = (x, zz) => [W / 2 - (x - M.cx) * z, H / 2 - (zz - M.cz) * z];
    g.setTransform(k, 0, 0, k, 0, 0); g.fillStyle = '#141c25'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, H / 2); g.scale(-z, -z); g.translate(-M.cx, -M.cz);
    const R = (x0, z0, x1, z1) => g.fillRect(x0, z0, x1 - x0, z1 - z0), far = 600, hw = l.highway;
    g.fillStyle = '#1d2834'; R(-far, -far, far, far);
    // sea, wet sand, beach, boardwalk
    g.fillStyle = lin(g, l.ocean.x1, 0, l.ocean.x1 - 220, 0, ['#1b6477', '#12485c', '#0b2f42', '#08202f']); R(-far, -far, l.ocean.x1, far);
    g.strokeStyle = 'rgba(160,230,235,.16)'; g.lineWidth = .7; for (let i = 0; i < 7; i++) { const x = l.ocean.x1 - 5 - i * i * 2.6 - i * 5; g.beginPath(); for (let zz = -far; zz <= far; zz += 8) { const xx = x + Math.sin(zz * .045 + i * 1.7 + S.t * .5) * (1.6 + i * .5); zz === -far ? g.moveTo(xx, zz) : g.lineTo(xx, zz); } g.stroke(); }
    g.fillStyle = lin(g, l.beach.x0, 0, l.beach.x1, 0, ['#6f6a55', '#8a7f62', '#93876a', '#8d8166']); R(l.beach.x0, -far, l.beach.x1, far);
    g.fillStyle = 'rgba(210,240,240,.28)'; R(l.ocean.x1 - 1.2, -far, l.ocean.x1 + 1, far);
    g.fillStyle = '#6d6558'; R(l.beach.x1, -far, -l.highway.width / 2, far); g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = .25; g.beginPath(); for (let zz = -190; zz < 190; zz += 2.5) { g.moveTo(l.beach.x1, zz); g.lineTo(-l.highway.width / 2, zz); } g.stroke();
    { const ur = mkrng('mapumb'), uc = ['#ff7a6a', '#58c8d8', '#ffd24d', '#f3eee6', '#ff9a4d']; for (let i = 0; i < 22; i++) { const x = -22 - ur() * 30, zz = -170 + ur() * 340; g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.arc(x - .5, zz - .5, 1.5, 0, TAU); g.fill(); g.fillStyle = uc[i % uc.length]; g.beginPath(); g.arc(x, zz, 1.4, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x + 1.8, zz - .9, 1.1, 1.9); }
      const lg = GT.world && GT.world.anchors && GT.world.anchors.lifeguardTower; if (lg) { g.fillStyle = '#e8e2d0'; R(lg.x - 1.6, lg.z - 1.6, lg.x + 1.6, lg.z + 1.6); g.fillStyle = '#d4553f'; R(lg.x - 1.6, lg.z - 1.6, lg.x + 1.6, lg.z - .6); } }
    // blocks
    const lot = (b, col) => { g.fillStyle = col; R(b.x0, b.z0, b.x1, b.z1); g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = .5; g.strokeRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0); };
    lot(l.lotC, '#25313f'); lot(l.lotD, '#27332f'); lot(l.lotE, '#25313f'); lot(l.station, '#34424f'); lot(l.motel, '#342f44');
    g.fillStyle = '#566170'; R(hw.x + hw.width / 2, -far, hw.x + hw.width / 2 + 2.5, far);
    // roads: casing, surface, markings
    const hx0 = hw.x - hw.width / 2, hx1 = hw.x + hw.width / 2, roads = [[hx0, -far, hx1, far], [l.crossS.x0, l.crossS.z - l.crossS.width / 2, l.crossS.x1 + l.backRoad.width / 2, l.crossS.z + l.crossS.width / 2], [l.crossN.x0, l.crossN.z - l.crossN.width / 2, l.crossN.x1 + l.backRoad.width / 2, l.crossN.z + l.crossN.width / 2], [l.backRoad.x - l.backRoad.width / 2, l.backRoad.zMin, l.backRoad.x + l.backRoad.width / 2, l.backRoad.zMax]];
    g.fillStyle = '#0e141b'; for (const r of roads) R(r[0] - .8, r[1] - .8, r[2] + .8, r[3] + .8); g.fillStyle = '#627389'; for (const r of roads) R(r[0], r[1], r[2], r[3]);
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = .3; g.beginPath(); g.moveTo(hx0 + .5, -far); g.lineTo(hx0 + .5, far); g.moveTo(hx1 - .5, -far); g.lineTo(hx1 - .5, far); g.stroke();
    g.fillStyle = 'rgba(20,28,38,.4)'; R(hx0, -far, hx1, hw.zMin - 30); R(hx0, hw.zMax + 30, hx1, far);
    g.strokeStyle = 'rgba(255,210,110,.75)'; g.lineWidth = .45; g.beginPath(); g.moveTo(hw.x - .6, -far); g.lineTo(hw.x - .6, far); g.moveTo(hw.x + .6, -far); g.lineTo(hw.x + .6, far); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.38)'; g.lineWidth = .35; g.setLineDash([3, 5]); g.beginPath(); for (const x of [-4.5, 4.5]) { g.moveTo(hw.x + x, -far); g.lineTo(hw.x + x, far); } g.moveTo(l.crossS.x0 + 8, l.crossS.z); g.lineTo(l.crossS.x1, l.crossS.z); g.moveTo(l.crossN.x0 + 8, l.crossN.z); g.lineTo(l.crossN.x1, l.crossN.z); g.moveTo(l.backRoad.x, l.backRoad.zMin); g.lineTo(l.backRoad.x, l.backRoad.zMax); g.stroke(); g.setLineDash([]);
    // station: driveways, canopy, pumps, store
    const st = l.station, bld = (x0, z0, x1, z1, col) => { g.fillStyle = 'rgba(0,0,0,.35)'; R(x0 - .8, z0 - .8, x1 - .8, z1 - .8); g.fillStyle = col || '#55677c'; R(x0, z0, x1, z1); g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = .4; g.strokeRect(x0, z0, x1 - x0, z1 - z0); };
    g.fillStyle = '#627389'; for (const dz of (st.drives || [])) R(hx1, dz - 4, st.x0 + 1, dz + 4); if (l.motel.drive) R(hx1, l.motel.drive - 4, l.motel.x0 + 1, l.motel.drive + 4);
    const cn = st.canopy; g.fillStyle = 'rgba(255,170,90,.16)'; R(cn.x - cn.w / 2, cn.z - cn.d / 2, cn.x + cn.w / 2, cn.z + cn.d / 2); g.strokeStyle = 'rgba(255,170,90,.7)'; g.lineWidth = .5; g.strokeRect(cn.x - cn.w / 2, cn.z - cn.d / 2, cn.w, cn.d);
    g.fillStyle = '#ffc890'; for (const p of st.pumps) R(p[0] - .7, p[1] - 1.3, p[0] + .7, p[1] + 1.3); bld(st.store.x0, st.store.z0, st.store.x1, st.store.z1, '#7c93b0'); g.fillStyle = '#2aa6a0'; R(st.store.x0 - .9, st.store.z0, st.store.x0, st.store.z1);
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = .3; g.beginPath(); for (let zz = st.store.z0 + 3; zz < st.store.z1; zz += 3) { g.moveTo(st.store.x0 - 1.5, zz); g.lineTo(st.store.x0 - 6.5, zz); } g.stroke();
    // motel: wings, pool, parking ticks
    const mo = l.motel; bld(mo.wingE.x0, mo.wingE.z0, mo.wingE.x1, mo.wingE.z1, '#8a78a8'); bld(mo.wingN.x0, mo.wingN.z0, mo.wingN.x1, mo.wingN.z1, '#8a78a8'); g.fillStyle = '#4a4458'; rr(g, mo.pool.x - mo.pool.w / 2 - 3, mo.pool.z - mo.pool.d / 2 - 3, mo.pool.w + 6, mo.pool.d + 6, 2); g.fill();
    g.fillStyle = '#2fb7cc'; rr(g, mo.pool.x - mo.pool.w / 2, mo.pool.z - mo.pool.d / 2, mo.pool.w, mo.pool.d, 1.6); g.fill(); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = .5; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = .3; g.beginPath(); for (const p of (mo.parking || [])) { g.moveTo(p[0] - 2.6, p[1] - 2); g.lineTo(p[0] + 2.6, p[1] - 2); g.moveTo(p[0] - 2.6, p[1] + 2); g.lineTo(p[0] + 2.6, p[1] + 2); } g.stroke();
    // filler lots: rows of storage units / trailers so the blocks are not empty
    g.fillStyle = '#43536a'; for (let i = 0; i < 5; i++) R(92, -146 + i * 17, 136, -138 + i * 17); for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) R(22 + i * 7, -140 + j * 14, 26.5 + i * 7, -131 + j * 14);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) R(104 + j * 18, -30 + i * 14 + (i > 5 ? 20 : 0), 116 + j * 18, -25 + i * 14); for (let i = 0; i < 8; i++) R(20 + i * 15, 141, 32 + i * 15, 149);
    // hangouts
    g.fillStyle = '#3f6a66'; R(-41, -67, -27, -53); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = .4; g.strokeRect(-41, -67, 14, 14); g.beginPath(); g.arc(-34, -67, 5.5, 0, Math.PI); g.stroke(); g.strokeRect(-36.4, -67, 4.8, 5.8);
    g.fillStyle = '#5a5648'; rr(g, -36, -25, 12, 10, 1.5); g.fill(); g.fillStyle = '#9aa2aa'; for (let i = 0; i < 3; i++) R(-34.5 + i * 3.6, -23, -33 + i * 3.6, -17);
    g.fillStyle = '#7a5a3c'; g.beginPath(); g.arc(-32, 30, 5.2, 0, TAU); g.fill(); g.fillStyle = '#a57c4e'; g.beginPath(); g.arc(-32, 30, 3, 0, TAU); g.fill(); g.fillStyle = '#c96a5a'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-40 + (i % 2) * 5, 22 + (i >> 1) * 15, 1.5, 0, TAU); g.fill(); }
    g.fillStyle = '#7d6a52'; R(-104, 90.4, -56, 93.6); R(-110, 87, -102, 97); g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = .3; g.beginPath(); for (let x = -102; x < -56; x += 3) { g.moveTo(x, 90.4); g.lineTo(x, 93.6); } g.stroke();
    g.fillStyle = '#3a3440'; R(112, 54, 124, 66); g.fillStyle = '#7d6fa8'; R(114.5, 56.5, 121.5, 63.5); g.strokeStyle = '#e8e2ff'; g.lineWidth = .35; g.strokeRect(114.5, 56.5, 7, 7);
    // palms along the boardwalk + dune scrub
    const pr = mkrng('mappalms'); for (let zz = -184; zz < 186; zz += 13) { const x = -12.5 - pr() * 2, r = 1.7 + pr() * .8; g.fillStyle = 'rgba(40,96,74,.95)'; g.beginPath(); g.arc(x, zz + pr() * 4, r, 0, TAU); g.fill(); g.fillStyle = 'rgba(92,150,104,.8)'; g.beginPath(); g.arc(x + .4, zz + pr() * 4, r * .45, 0, TAU); g.fill(); }
    for (let i = 0; i < 26; i++) { g.fillStyle = 'rgba(70,96,70,.6)'; g.beginPath(); g.arc(-18 - pr() * 34, -180 + pr() * 360, .9 + pr() * 1.2, 0, TAU); g.fill(); }
    if (prov.draw) { try { prov.draw(g, PX, z); } catch (e) { /* provider layer is optional */ } }
    // route
    if (way) { const rt = route(pl, way); M.routeLen = rt.len; g.lineJoin = g.lineCap = 'round'; const path = () => { g.beginPath(); rt.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); };
      path(); g.strokeStyle = 'rgba(10,14,20,.7)'; g.lineWidth = 5.2 / z + 1.2; g.stroke(); path(); g.strokeStyle = '#ff7a4d'; g.lineWidth = 3 / z + .9; g.stroke(); path(); g.strokeStyle = '#ffe2b0'; g.lineWidth = 1 / z; g.setLineDash([4 / z, 7 / z]); g.lineDashOffset = -S.t * 14 / z; g.stroke(); g.setLineDash([]); } else M.routeLen = 0;
    g.restore();
    // ---- screen space: labels, blips, pins, player
    const font = (px, wgt) => { g.font = (wgt || 600) + ' ' + px + 'px -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'; };
    const label = (t, x, y, col, px, al) => { font(px || 9.5, 600); g.textAlign = al || 'center'; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = 'rgba(12,17,24,.85)'; g.lineJoin = 'round'; g.strokeText(t, x, y); g.fillStyle = col || 'rgba(220,228,236,.8)'; g.fillText(t, x, y); };
    const vert = (t, x, zz) => { const p = PX(x, zz); if (p[1] < 60 || p[1] > H - 140) p[1] = clamp(p[1], 100, H - 180); g.save(); g.translate(p[0], p[1]); g.rotate(-Math.PI / 2); label(t, 0, 0, 'rgba(226,232,240,.62)', 9); g.restore(); };
    if (z > .75) { vert('海 滨 公 路 · COSTA BRISA HWY', hw.x, M.cz + 30 / z); vert('后 街', l.backRoad.x, clamp(M.cz, l.backRoad.zMin + 30, l.backRoad.zMax - 30)); let p = PX(80, l.crossS.z); label('南 街', p[0], p[1], 'rgba(226,232,240,.62)', 9); p = PX(80, l.crossN.z); label('北 街', p[0], p[1], 'rgba(226,232,240,.62)', 9);
      p = PX(-110, M.cz - 60 / z); label('大 西 洋', clamp(p[0], W - 60, W + 200), p[1], 'rgba(150,215,225,.5)', 10); p = PX(70, -100); label('二手车行 · 自助仓储', p[0], p[1], 'rgba(200,210,222,.42)', 8.5); p = PX(120, 20); label('拖车营地', p[0], p[1], 'rgba(200,210,222,.42)', 8.5); }
    for (const b of (prov.blips || [])) { const p = PX(b.x, b.z), r = (b.r || 3.2); if (b.pulse) { g.beginPath(); g.arc(p[0], p[1], r + 3 + 3 * Math.sin(S.t * 5), 0, TAU); g.strokeStyle = b.color || '#6ebeff'; g.globalAlpha = .4; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1; } g.beginPath(); g.arc(p[0], p[1], r, 0, TAU); g.fillStyle = b.color || '#6ebeff'; g.fill(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; g.stroke(); }
    pins.forEach((p, i) => { const q = PX(p.x, p.z), on = i === M.sel, r = on ? 11 : 8.5, y = q[1] - r - 4; if (q[0] < -20 || q[0] > W + 20 || q[1] < 30 || q[1] > H + 10) return;
      g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.ellipse(q[0], q[1] + 1, r * .5, r * .2, 0, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0] - r * .55, y + r * .7); g.arc(q[0], y, r, Math.PI * .78, Math.PI * .22); g.closePath(); g.fillStyle = p.color; g.fill(); g.strokeStyle = on ? '#fff' : 'rgba(10,14,20,.75)'; g.lineWidth = on ? 1.6 : 1; g.stroke();
      g.fillStyle = 'rgba(10,14,22,.86)'; g.beginPath(); g.arc(q[0], y, r - 2.2, 0, TAU); g.fill(); font(on ? 11 : 8.6, 700); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(p.ch, q[0], y + .6);
      if (z >= 1.15 || on) label(p.name, q[0], q[1] + 9, on ? '#fff' : 'rgba(236,240,246,.88)', on ? 10.5 : 9.5); });
    if (way) { const q = PX(way.x, way.z), pu = (S.t * 1.2) % 1; g.strokeStyle = 'rgba(255,122,77,' + (1 - pu) + ')'; g.lineWidth = 1.5; g.beginPath(); g.arc(q[0], q[1], 5 + pu * 14, 0, TAU); g.stroke(); g.fillStyle = '#ff7a4d'; g.beginPath(); g.arc(q[0], q[1], 4.5, 0, TAU); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.stroke(); }
    if (M.cursor && M.sel < 0) { const q = PX(M.cursor.x, M.cursor.z); g.strokeStyle = '#fff'; g.lineWidth = 1.4; g.beginPath(); g.arc(q[0], q[1], 7, 0, TAU); g.moveTo(q[0] - 12, q[1]); g.lineTo(q[0] - 4, q[1]); g.moveTo(q[0] + 4, q[1]); g.lineTo(q[0] + 12, q[1]); g.moveTo(q[0], q[1] - 12); g.lineTo(q[0], q[1] - 4); g.moveTo(q[0], q[1] + 4); g.lineTo(q[0], q[1] + 12); g.stroke(); }
    { const q = PX(pl.x, pl.z), cone = g.createRadialGradient(q[0], q[1], 2, q[0], q[1], 46); cone.addColorStop(0, 'rgba(120,200,255,.42)'); cone.addColorStop(1, 'rgba(120,200,255,0)');
      g.save(); g.translate(q[0], q[1]); g.rotate(-pl.h); g.translate(-q[0], -q[1]); g.fillStyle = cone; g.beginPath(); g.moveTo(q[0], q[1]); g.arc(q[0], q[1], 46, -Math.PI / 2 - .5, -Math.PI / 2 + .5); g.closePath(); g.fill();
      g.fillStyle = 'rgba(80,170,255,.25)'; g.beginPath(); g.arc(q[0], q[1], 12 + Math.sin(S.t * 3) * 1.5, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(q[0], q[1] - 9); g.lineTo(q[0] + 6.4, q[1] + 6.6); g.lineTo(q[0], q[1] + 3.2); g.lineTo(q[0] - 6.4, q[1] + 6.6); g.closePath(); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#1c6fd8'; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke(); g.restore(); }
    // vignette under the floating chrome
    g.fillStyle = lin(g, 0, 0, 0, 96, ['rgba(10,14,20,.9)', 'rgba(10,14,20,0)']); g.fillRect(0, 0, W, 96); g.fillStyle = lin(g, 0, H - 190, 0, H, ['rgba(10,14,20,0)', 'rgba(10,14,20,.85)']); g.fillRect(0, H - 190, W, 190);
  }
  function mapSheet() { const pins = M.pins, p = M.sel >= 0 ? pins[M.sel] : null, tgt = p || M.cursor, pl = S.player, way = S.way;
    if (!tgt) { const d = way ? Math.round(M.routeLen || Math.hypot(way.x - pl.x, way.z - pl.z)) : 0; return '<div class="gp-ms-h"><i class="gp-ms-ch" style="background:#1c6fd8">我</i><div><b>' + esc(placeNear(pl.x, pl.z, pins)) + '</b><small>' + (way ? '导航中 · ' + esc(way.name || '目的地') + ' · ' + d + ' 米' : '当前位置 · 选一个地点开始导航') + '</small></div></div>' + (way ? '<button class="gp-ms-btn off" data-a="clear">取消导航</button>' : '<div class="gp-ms-keys"><span><kbd>←→</kbd>选地点</span><span><kbd>↑↓</kbd>缩放</span><span><kbd>Enter</kbd>导航</span></div>'); }
    const rt = route(pl, tgt), d = Math.round(rt.len), isWay = way && Math.hypot(way.x - tgt.x, way.z - tgt.z) < 1;
    return '<div class="gp-ms-h"><i class="gp-ms-ch" style="background:' + (p ? p.color : '#5a6676') + '">' + (p ? p.ch : '点') + '</i><div><b>' + esc(p ? p.name : placeNear(tgt.x, tgt.z, pins)) + '</b><small>' + (p && p.note ? esc(p.note) + ' · ' : '') + d + ' 米 · 步行 ' + Math.max(1, Math.round(d / 84)) + ' 分 · 开车 ' + Math.max(1, Math.round(d / 600)) + ' 分</small></div></div>' +
      '<button class="gp-ms-btn' + (isWay ? ' off' : '') + '" data-a="' + (isWay ? 'clear' : 'way') + '">' + (isWay ? '取消导航' : '设为目的地') + '<kbd>Enter</kbd></button>'; }
  function mapSheetUpdate() { const c = cur(), n = c && c.node && c.node.querySelector('.gp-ms'); if (!n) return; const html = mapSheet(); if (n._h !== html) { n._h = html; n.innerHTML = html; } const cp = c.node.querySelector('.gp-mp-here'); if (cp) cp.textContent = placeNear(S.player.x, S.player.z, M.pins); }
  function setWay(w) { S.way = w ? { x: w.x, z: w.z, name: w.name } : null; emit('waypoint', S.way ? { x: S.way.x, z: S.way.z, name: S.way.name } : null); sfx(w ? 'ui_ok' : 'ui_tick'); }
  APPS.map = {
    enter() { M.follow = true; M.cx = M.tx = S.player.x; M.cz = M.tz = S.player.z; M.cursor = null; M.sel = -1; if (S.way) { const i = M.pins.findIndex(p => Math.hypot(p.x - S.way.x, p.z - S.way.z) < 1); M.sel = i; } },
    render() { return '<div class="gp-app gp-map"><canvas class="gp-mapcv"></canvas><div class="gp-mp-top"><b class="gp-bk" data-a="back"></b><div><h1>地图</h1><small class="gp-mp-here"></small></div></div>' +
      '<div class="gp-mp-side"><b class="gp-mp-n" data-a="north"><i></i>北</b><b data-a="zin">+</b><b data-a="zout">−</b><b class="gp-mp-loc" data-a="loc"><i></i></b></div><div class="gp-ms"></div></div>'; },
    resize(c) { if (c.node) this.mount(c, c.node); },
    mount(c, node) { const cvs = node.querySelector('.gp-mapcv'); M.k = clamp(Math.ceil(S.u * PSC * (window.devicePixelRatio || 1) * 2) / 2, 1.5, 3); cvs.width = M.W * M.k; cvs.height = M.H * M.k;
      const pos = e => ({ x: e.offsetX, y: e.offsetY }), inv = p => ({ x: M.cx - (p.x - M.W / 2) / M.zoom, z: M.cz - (p.y - M.H / 2) / M.zoom });
      cvs.addEventListener('pointerdown', e => { try { cvs.setPointerCapture(e.pointerId); } catch (x) { /* synthetic */ } M.ptr.set(e.pointerId, pos(e)); M.moved = 0; if (M.ptr.size === 2) { const a = [...M.ptr.values()]; M.pinch = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); } });
      cvs.addEventListener('pointermove', e => { const o = M.ptr.get(e.pointerId); if (!o) return; const p = pos(e); if (M.ptr.size === 1) { const dx = p.x - o.x, dy = p.y - o.y; M.moved += Math.abs(dx) + Math.abs(dy); if (M.moved > 4) { M.follow = false; M.cx = M.tx = M.cx + dx / M.zoom; M.cz = M.tz = M.cz + dy / M.zoom; } }
        M.ptr.set(e.pointerId, p); if (M.ptr.size === 2) { const a = [...M.ptr.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); if (M.pinch > 0) M.zoom = M.tzoom = clamp(M.zoom * d / M.pinch, .62, 5); M.pinch = d; M.moved = 99; } });
      const up = e => { const had = M.ptr.has(e.pointerId); M.ptr.delete(e.pointerId); if (!had || M.moved > 4 || e.type === 'pointercancel') return; const p = pos(e); let hit = -1, bd = 18;
        M.pins.forEach((q, i) => { const sx = M.W / 2 - (q.x - M.cx) * M.zoom, sy = M.H / 2 - (q.z - M.cz) * M.zoom - 9, d = Math.hypot(sx - p.x, sy - p.y); if (d < bd) { bd = d; hit = i; } });
        M.follow = false; if (hit >= 0) { M.sel = hit; M.cursor = null; M.tx = M.pins[hit].x; M.tz = M.pins[hit].z - 40 / M.zoom; } else { M.sel = -1; const w = inv(p); M.cursor = { x: w.x, z: w.z }; } sfx('ui_tick'); mapSheetUpdate(); };
      cvs.addEventListener('pointerup', up); cvs.addEventListener('pointercancel', up);
      cvs.addEventListener('dblclick', () => { const t = M.sel >= 0 ? M.pins[M.sel] : M.cursor; if (t) APPS.map.act('way'); });
      cvs.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e), w = inv(p), nz = clamp(M.zoom * Math.exp(-e.deltaY * .0016), .62, 5); M.zoom = M.tzoom = nz; M.follow = false; M.cx = M.tx = w.x + (p.x - M.W / 2) / nz; M.cz = M.tz = w.z + (p.y - M.H / 2) / nz; }, { passive: false });
      drawMap(); mapSheetUpdate(); },
    tick(dt) { if (M.follow && !M.ptr.size) { M.tx = S.player.x; M.tz = S.player.z - 46 / M.zoom; } const k = 1 - Math.exp(-dt * 9); M.cx = lerp(M.cx, M.tx, k); M.cz = lerp(M.cz, M.tz, k); M.zoom = lerp(M.zoom, M.tzoom, k);
      if (S.way && Math.hypot(S.way.x - S.player.x, S.way.z - S.player.z) < 6) { const w = S.way; S.way = null; emit('arrived', w); emit('waypoint', null); } drawMap(); mapSheetUpdate(); },
    act(a) { const t = M.sel >= 0 ? M.pins[M.sel] : M.cursor;
      if (a === 'way' && t) setWay({ x: t.x, z: t.z, name: M.sel >= 0 ? t.name : placeNear(t.x, t.z, M.pins) }); else if (a === 'clear') setWay(null);
      else if (a === 'zin') M.tzoom = clamp(M.tzoom * 1.35, .62, 5); else if (a === 'zout') M.tzoom = clamp(M.tzoom / 1.35, .62, 5); else if (a === 'loc' || a === 'north') { M.follow = true; M.sel = -1; M.cursor = null; if (a === 'north') M.tzoom = 1.5; }
      mapSheetUpdate(); },
    key(code) { const n = M.pins.length;
      if (code === 'ArrowRight' || code === 'ArrowLeft') { M.sel = M.sel < 0 ? (code === 'ArrowRight' ? 0 : n - 1) : (M.sel + (code === 'ArrowRight' ? 1 : -1) + n) % n; M.cursor = null; M.follow = false; M.tx = M.pins[M.sel].x; M.tz = M.pins[M.sel].z - 40 / M.tzoom; sfx('ui_tick'); }
      else if (code === 'ArrowUp') this.act('zin'); else if (code === 'ArrowDown') this.act('zout');
      else if (code === 'Enter' || code === 'Space') { const t = M.sel >= 0 ? M.pins[M.sel] : M.cursor; if (!t) { if (S.way) this.act('clear'); else return this.key('ArrowRight'); } else this.act(S.way && Math.hypot(S.way.x - t.x, S.way.z - t.z) < 1 ? 'clear' : 'way'); }
      else if (code === 'KeyC') this.act('loc'); else return false; mapSheetUpdate(); return true; }
  };

  /* ------------------------------------------------------------------ 相机: viewfinder over the live game canvas + gallery of the last 12 */
  const CAM = { active: false, selfie: false, zoom: 1, want: 0, wantT: 0, photos: [], lastCall: -9999, src: null, cool: 0,
    fov() { return 58 / CAM.zoom; },
    sync(on) { if (!D.vf || on === CAM.active) return; CAM.active = on; D.vf.classList.toggle('on', on); if (on) { CAM.ui(); CAM.refocus(); } emit('camera', { active: on, selfie: CAM.selfie, zoom: CAM.zoom, fov: CAM.fov() }); },
    ui() { D.vf.classList.toggle('selfie', CAM.selfie); D.vf.querySelector('.gp-vf-mode').textContent = CAM.selfie ? '自拍' : '照片'; D.vf.querySelectorAll('.gp-vf-zoom span').forEach(s => s.classList.toggle('on', Math.round(CAM.zoom) === +s.dataset.z));
      D.vf.querySelector('.gp-vf-meta').textContent = 'ISO ' + (night() > .5 ? 1600 : night() > .15 ? 640 : 200) + ' · 1/' + (night() > .5 ? 30 : 250) + ' · f/1.8' + (CAM.zoom > 1.05 ? ' · ' + CAM.zoom.toFixed(1) + '×' : '');
      const th = D.vf.querySelector('.gp-vf-th'); th.style.backgroundImage = CAM.photos[0] ? 'url(' + CAM.photos[0].url + ')' : ''; th.classList.toggle('has', !!CAM.photos[0]); },
    refocus() { const f = D.vf.querySelector('.gp-vf-fc'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); },
    focusAt(e) { const w = D.vf.querySelector('.gp-vf-win').getBoundingClientRect(), f = D.vf.querySelector('.gp-vf-fc'); f.style.left = ((e.clientX - w.left) / w.width * 100).toFixed(1) + '%'; f.style.top = ((e.clientY - w.top) / w.height * 100).toFixed(1) + '%'; CAM.refocus(); sfx('ui_tick'); },
    setZoom(z) { z = clamp(Math.round(z * 4) / 4, 1, 3); if (z === CAM.zoom) return; CAM.zoom = z; CAM.ui(); CAM.refocus(); emit('camera', { active: CAM.active, selfie: CAM.selfie, zoom: z, fov: CAM.fov() }); },
    act(a) { if (a === 'shoot') CAM.shoot(); else if (a === 'flip') { CAM.selfie = !CAM.selfie; const f = D.vf.querySelector('.gp-vf-fc'); f.style.left = f.style.top = ''; CAM.ui(); CAM.refocus(); sfx('ui_tick'); emit('camera', { active: CAM.active, selfie: CAM.selfie, zoom: CAM.zoom, fov: CAM.fov() }); } else if (a === 'gallery') nav('camera', 'gallery'); },
    shoot() { if (CAM.cool > 0 || !CAM.active) return; CAM.cool = .45; CAM.want = 1; CAM.wantT = S.t; D.vf.classList.remove('shot'); void D.vf.offsetWidth; D.vf.classList.add('shot'); sfx('thunk'); },
    grab(src) { if (!src || !src.width) return null; const win = D.vf.querySelector('.gp-vf-win').getBoundingClientRect(), cr = src.getBoundingClientRect ? src.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
      if (!win.width || !cr.width) return null; const fx = src.width / cr.width, fy = src.height / cr.height, sx = Math.max(0, (win.left - cr.left) * fx), sy = Math.max(0, (win.top - cr.top) * fy), sw = Math.min(src.width - sx, win.width * fx), sh = Math.min(src.height - sy, win.height * fy);
      const w = 560, h = Math.round(w * sh / sw), c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      try { g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data; let mx = 0; for (let i = 0; i < d.length; i += 4 * 487) mx = Math.max(mx, d[i], d[i + 1], d[i + 2]); if (mx < 8) return { blank: true }; return { url: c.toDataURL('image/jpeg', .88), ar: w / h }; } catch (e) { return null; } },
    store(p) { if (!p || p.blank) { const c = document.createElement('canvas'); c.width = 560; c.height = 408; const g = c.getContext('2d'); g.fillStyle = lin(g, 0, 0, 0, 408, ['#1a1f2a', '#0b0e14']); g.fillRect(0, 0, 560, 408); g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '600 22px -apple-system, "PingFang SC", sans-serif'; g.textAlign = 'center'; g.fillText('画面未接入', 280, 200); g.font = '14px -apple-system, "PingFang SC", sans-serif'; g.fillText('GT.phone.captureFrame(canvas)', 280, 230); p = { url: c.toDataURL('image/jpeg', .8), ar: 560 / 408, blank: true }; }
      const ph = { url: p.url, ar: p.ar, blank: !!p.blank, time: clock(), place: placeNear(S.player.x, S.player.z, M.pins), selfie: CAM.selfie, zoom: CAM.zoom }; CAM.photos.unshift(ph); if (CAM.photos.length > 12) CAM.photos.length = 12;
      if (D.vf) { CAM.ui(); const s = D.vf.querySelector('.gp-vf-saved'); s.classList.remove('on'); void s.offsetWidth; s.classList.add('on'); const th = D.vf.querySelector('.gp-vf-th'); th.classList.remove('pop'); void th.offsetWidth; th.classList.add('pop'); }
      emit('photo', { index: 0, url: ph.url, time: ph.time, place: ph.place, selfie: ph.selfie, blank: ph.blank }); if (onApp('camera', 'gallery')) refresh(); return ph; }
  };
  APPS.camera = { home: 'vf',
    render(c) {
      if (c.page === 'vf') return '';
      if (c.page === 'photo') { const i = clamp(c.arg | 0, 0, CAM.photos.length - 1), p = CAM.photos[i]; if (!p) return '<div class="gp-app gp-gal">' + hd('相册') + '</div>';
        return '<div class="gp-app gp-photo">' + hd((i + 1) + ' / ' + CAM.photos.length, '', '') + '<div class="gp-ph-big"><img src="' + p.url + '" alt=""><i class="gp-ph-arr l" data-a="prev"></i><i class="gp-ph-arr r" data-a="next"></i></div><div class="gp-ph-meta"><b>' + esc(p.place) + '</b><small>今天 ' + p.time + ' · ' + (p.selfie ? '前置 12MP f/2.2' : '主摄 26mm f/1.8' + (p.zoom > 1 ? ' · ' + p.zoom.toFixed(1) + '×' : '')) + '</small></div>' +
          '<div class="gp-ph-acts"><button data-a="share" data-i="0">' + iconHTML('spume', 16) + '发到浪花</button><button class="warn" data-a="del" data-i="1">删除</button></div><div class="gp-keys"><span><kbd>←→</kbd>翻看</span><span><kbd>Esc</kbd>返回</span></div></div>'; }
      const ph = CAM.photos; return '<div class="gp-app gp-gal">' + hd('相册', '<em class="gp-pill">' + ph.length + ' / 12</em>') + (ph.length ? '<div class="gp-scroll"><div class="gp-gal-day">今天 · Costa Brisa</div><div class="gp-gal-g">' + ph.map((p, i) => '<div class="gp-ph" data-a="photo" data-v="' + i + '" data-i="' + i + '" style="background-image:url(' + p.url + ')">' + (p.selfie ? '<em>自拍</em>' : '') + '</div>').join('') + '</div><div class="gp-end">只保留最近 12 张 · 旧的会被海风吹走</div></div>'
        : '<div class="gp-empty"><i class="gp-empty-cam"></i><b>还没有照片</b><span>回到相机，按 Enter 拍一张</span></div>') + '</div>'; },
    act(a, v, c) { if (a === 'photo') nav('camera', 'photo', +v); else if (a === 'prev' || a === 'next') { c.arg = clamp((c.arg | 0) + (a === 'next' ? 1 : -1), 0, CAM.photos.length - 1); refresh(); }
      else if (a === 'del') { CAM.photos.splice(c.arg | 0, 1); if (D.vf) CAM.ui(); if (!CAM.photos.length) back(); else { c.arg = Math.min(c.arg | 0, CAM.photos.length - 1); refresh(); } }
      else if (a === 'share') { const p = CAM.photos[c.arg | 0]; if (!p) return; const post = mkPost({ u: ME, text: pick(['Costa Brisa，今天的。', '随手一拍。', '这光，没滤镜。', p.place + '。']), img: p.url, ar: p.ar, views: 3, vt: 180 + rnd() * 900, likes: 0 }); FEED.posts.unshift(post); emit('share', { post: post.id }); sfx('ui_ok'); nav('spume', 'post', post.id); } },
    key(code, c) { if (c.page === 'vf') { if (code === 'Enter' || code === 'Space') CAM.shoot(); else if (code === 'KeyF') CAM.act('flip'); else if (code === 'KeyG') CAM.act('gallery'); else if (code === 'ArrowUp') CAM.setZoom(CAM.zoom + .5); else if (code === 'ArrowDown') CAM.setZoom(CAM.zoom - .5); else return false; return true; }
      if (c.page === 'gallery') return listKey(code, c, 3); if (c.page === 'photo') { if (code === 'ArrowLeft') { this.act('prev', 0, c); return true; } if (code === 'ArrowRight') { this.act('next', 0, c); return true; } if (code === 'ArrowUp' || code === 'ArrowDown') { c.sel = c.sel ? 0 : 1; markSel(); return true; } } return false; }
  };

  /* ------------------------------------------------------------------ 浪花 (Spume): the local feed, with posts that react to what the player does */
  const LOCALS = [{ n: '椰子阿姨', h: 'coco_tia', hue: 28 }, { n: '夜班小周', h: 'solmar_night', hue: 172 }, { n: '退潮钓鱼佬', h: 'lowtide_rod', hue: 205 }, { n: '汽修厂老马', h: 'ma_garage', hue: 12 }, { n: '棕榈大道观察员', h: 'palm_watch', hue: 318 }, { n: '塔可车出摊了吗', h: 'taco_or_not', hue: 46 },
    { n: '泳池管理员阿宽', h: 'motel_pool', hue: 188 }, { n: 'Brisa 冲浪板', h: 'brisa_boards', hue: 262 }, { n: '海风不打烊', h: 'seabreeze247', hue: 340 }, { n: '后街擂台', h: 'backyard_ring', hue: 0 }, { n: '球场灯又坏了', h: 'court_lights', hue: 92 }, { n: '救生员大卫', h: 'tower_3', hue: 22 }];
  const ME = { n: '阿凯', h: 'kai_drives', hue: 210, me: true };
  const AMBIENT = ['湿度 84%。我不是在走路，我是在游泳。', 'SOLMAR 的油价又涨了四分。招牌上那个太阳笑得更开心了。', '塔可车今天出摊了！！老地方。别问我为什么排队的一半是巡防。', '旅馆泳池今天又"维护中"。维护三个礼拜了，水比我的前途还绿。', '有只海鸥抢了我的薯条，然后站在救生塔上，当着我的面吃完了。', '球场的灯修好了一半。字面意思，只亮一半。',
    '栈桥今晚鱼口不错。别都来。', '后院擂台周六晚上。带椅子，别带巡防。', '谁的白色皮卡停在公交站？拖车已经在路上了，我只是通知你一声。', '日落前十分钟的海滨公路，免费的电影。', '冰柜坏了，冰淇淋半价，速来。', '今晚有雷雨。把晾在阳台上的东西和秘密都收一收。', '二手车行新到一辆"几乎没泡过水"的轿车。', '健身角那个天天举铁的大哥今天没来，大家都很担心。', '提基酒吧新出的日落特调，喝完看什么都是橙色的。'];
  const CMT = ['哈哈哈哈哈', '真的假的', '在哪在哪', '已收藏', '这也太 Costa Brisa 了', '我作证', '路过点个赞', '明天去看看', '本地人表示习惯了', '笑死'];
  const EVT = {
    robbery: { clip: 'robbery', dur: '0:14', text: ['刚才 {place} 那边什么情况？？有人戴着面罩冲进去了', '{place} 又出事了，我隔着马路拍的，手还在抖', '我只是想加个油。{place}，现在，自己看'], cm: ['我就在对面加油！！', '又是便利店…这周第三回了', '收银大爷没事吧', '拍得好抖，你是边跑边拍吗', '门口那辆车一直没熄火，我注意到了', '报警了没', '面罩哪买的（不是我要买）'], chat: ['？？？主播你看到了吗', '卧槽 抢劫', '快跑快跑', '这是剧本吧', '主播别回头'] },
    chase: { clip: 'chase', dur: '0:09', text: ['海滨公路上巡防车追着一辆{car}飞过去了，我的奶昔洒了一身', '听声音就知道不对劲。{car}，后面跟了好几辆巡防车', '有人在海滨公路上开出了不要命的速度'], cm: ['听到了，至少四辆', '说实话司机技术可以', '别夸，会被抓的', '往北街那边去了', '我奶昔也洒了，找谁赔', '红灯：我不存在是吧'], chat: ['巡防！！！', '踩油门啊', '左左左左左', '这是直播还是遗言', '后面后面', '666666'] },
    crash: { clip: 'crash', dur: '0:11', text: ['{place}有人把车开成了手风琴', '砰的一声，整条街的狗都叫了。{place}', '保险公司今晚要加班了，{place}'], cm: ['人没事吧', '保险公司：？', '那根路灯上个月刚修好', '我看到司机自己走下来的', '所以是谁的错'], chat: ['啊啊啊啊', '撞了撞了', '主播没事吧', '安全带！', '这车还能要吗'] },
    hoops: { clip: 'hoops', dur: '0:17', text: ['海滨半场有个哥们儿连进了 {n} 个，我录下来了', '这手感谁顶得住？连中 {n} 个', '球场今晚来了个狠人'], cm: ['这手感借我用用', '那个后仰太骚了', '明天来单挑', '他是不是开车那个', '灯都没亮还这么准'], chat: ['好球', '再来一个', '手感热了', '这也能进', '教教我'] },
    dog: { clip: 'dog', dur: '0:08', text: ['有人摸了沙滩上那只没人敢摸的狗。狗居然笑了', '饼干今天被陌生人摸了，它很满意', '今日最治愈：一个路人和那只狗'], cm: ['那是饼干！它其实很乖', '我上次被它追了三条街', '狗狗天使', '它冲他笑了！！', '想摸'], chat: ['狗狗！！！', '啊啊啊好可爱', '再摸一下', '它在笑', '主播人还怪好的'] },
    busted: { clip: 'busted', dur: '0:12', text: ['抓到了。就在{place}。手举得还挺标准', '{place}，结束了，巡防围了一圈', '今晚的大戏收场了，{place}'], cm: ['散了吧散了吧', '所以我的奶昔谁赔', '他表弟呢', '手举得比我上课还直', '明天头条'], chat: ['完了', '主播？？？', 'F', '直播间要没了', '录屏了'] },
    clean: { clip: 'clean', dur: '0:10', text: ['所以……那辆车就这么没了？？巡防在{place}转了三圈', '巡防还在{place}找，人早没影了', '我宣布今晚的赢家是那个司机'], cm: ['换车了吧，绝对换车了', '职业的', '我什么都没看见（真的）', '旅馆停车场多了辆没见过的车…', '巡防同志辛苦了'], chat: ['甩掉了！！', '稳', '这波可以', '主播牛', '低调低调'] }
  };
  const FEED = { posts: [], pid: 0, nextAmb: 38, uiT: 0, clipT: 0, ambI: 0 };
  function mkPost(o) { const p = Object.assign({ id: ++FEED.pid, u: LOCALS[0], text: '', t: S.t, likes: 0, views: 10, vt: 500, cm: [], clip: null, img: null, liked: false, hr: hours(), dur: '0:10' }, o); return p; }
  (function seedFeed() { const r = mkrng('feed'), ages = [140, 560, 1300, 2900, 4400, 7800, 11000, 15000]; ages.forEach((a, i) => { const u = LOCALS[(i * 5 + 1) % LOCALS.length], v = 300 + r() * 5200 * (1 + i * .3);
    FEED.posts.push(mkPost({ u, text: AMBIENT[(i * 4 + 3) % AMBIENT.length], t: -a, likes: Math.round(v * (.04 + r() * .08)), views: Math.round(v), vt: Math.round(v * (1.05 + r() * .2)), cm: [0, 1, 2].slice(0, 1 + (r() * 3 | 0)).map(j => ({ u: LOCALS[(i * 3 + j * 5 + 2) % LOCALS.length], text: CMT[(i * 3 + j * 4) % CMT.length] })) })); });
    FEED.posts[2].clip = 'dog'; FEED.posts[2].text = '饼干又在救生塔下面等人喂它了。别喂薯条，它会记住你。'; FEED.posts[2].dur = '0:06'; FEED.posts[2].hr = 17.4; FEED.ambI = 5; })();
  const ago = s => s < 50 ? '刚刚' : s < 3600 ? Math.max(1, Math.round(s / 60)) + ' 分钟前' : Math.round(s / 3600) + ' 小时前';
  const avU = (u, cls) => '<i class="gp-av ' + (cls || '') + (u.me ? ' me' : '') + '" style="--h:' + u.hue + '">' + esc(u.n[0]) + '</i>';
  function postHTML(p, i, full) {
    const media = p.clip ? '<div class="gp-clip' + (full ? ' full' : '') + '" data-clip="' + p.id + '"><canvas class="gp-clipcv"></canvas><i class="gp-clip-rec"><u></u>' + (full ? '正在播放' : 'REC') + '</i>' + (full ? '' : '<i class="gp-play"></i>') + '<span class="gp-dur">' + p.dur + '</span></div>' : p.img ? '<div class="gp-clip img' + (full ? ' full' : '') + '" style="background-image:url(' + p.img + ');aspect-ratio:' + (p.ar || 1.37).toFixed(3) + '"></div>' : '';
    return '<div class="gp-post' + (full ? ' full' : '') + '" data-pid="' + p.id + '"' + (full ? '' : ' data-a="post" data-v="' + p.id + '" data-i="' + i + '"') + '><div class="gp-post-h">' + avU(p.u) + '<div><b>' + esc(p.u.n) + '</b><small>@' + p.u.h + ' · ' + ago(S.t - p.t) + '</small></div>' + (p.vt > 20000 ? '<em class="gp-hot">热门</em>' : '') + '</div><p>' + esc(p.text) + '</p>' + media +
      '<div class="gp-post-f"><span class="gp-lk' + (p.liked ? ' on' : '') + '"><i></i><b>' + cnNum(p.likes) + '</b></span><span class="gp-cmn"><i></i><b>' + p.cm.length + '</b></span><span class="gp-vws"><i></i><b>' + cnNum(p.views) + '</b></span></div></div>'; }
  const cmHTML = (c, fresh) => '<div class="gp-cmt' + (fresh ? ' gp-new' : '') + '">' + avU(c.u, 'sm') + '<div><b>' + esc(c.u.n) + '</b><p>' + esc(c.text) + '</p></div></div>';
  function fireEvent(type, data) {
    build(); const E = EVT[type]; if (!E) return null; data = data || {}; const place = data.place || placeNear(S.player.x, S.player.z, M.pins).replace('附近', ''), u = data.user || pick(LOCALS), delay = data.delay !== undefined ? data.delay : 4 + rnd() * 5;
    const text = pick(E.text).replace('{place}', place.indexOf('SOLMAR') === 0 ? 'SOLMAR ' : place).replace('{car}', data.car || '红色肌肉车').replace('{n}', data.n || 5);
    if (S.live) { LIVE.burst = LIVE.burst.concat(E.chat.slice().sort(() => rnd() - .5), E.chat.slice(0, 3)); LIVE.surge += 60 + rnd() * 120; }
    after(delay, () => { const hot = type === 'chase' || type === 'robbery' || type === 'busted', p = mkPost({ u, text, clip: E.clip, dur: E.dur, views: 12 + (rnd() * 30 | 0), vt: Math.round((hot ? 30000 : 4000) * (1 + rnd() * 2.2)), likes: 1, ev: type });
      FEED.posts.unshift(p); if (FEED.posts.length > 30) FEED.posts.length = 30; notify({ from: '浪花 · ' + u.n, text, app: 'spume', post: p.id });
      const pool = E.cm.slice().sort(() => rnd() - .5).slice(0, 5); pool.forEach((t, i) => after(2.2 + i * (2.4 + rnd() * 2.2), () => { let cu = pick(LOCALS); if (cu === u) cu = LOCALS[(LOCALS.indexOf(u) + 3) % LOCALS.length]; const c = { u: cu, text: t }; p.cm.push(c);
        if (onApp('spume', 'post') && cur().arg === p.id) { const box = cur().node.querySelector('.gp-cmts'); if (box) { box.insertAdjacentHTML('beforeend', cmHTML(c, true)); const sc = box.closest('.gp-scroll'); if (sc && sc.scrollTop + sc.clientHeight > sc.scrollHeight - 120) sc.scrollTop = 1e6; } } }));
      if (onApp('spume', 'feed')) { refresh(); const n = cur().node.querySelector('.gp-post'); if (n) n.classList.add('gp-new'); } });
    return true;
  }
  function feedTick(dt) {
    for (const p of FEED.posts) { if (p.views < p.vt) { const k = p.ev ? .11 : .02; p.views = Math.min(p.vt, p.views + (p.vt - p.views) * k * dt + (p.ev ? 9 : .3) * dt); } const lt = p.views * (p.ev ? .11 : .07); if (p.likes < lt) p.likes += Math.max(dt * .5, (lt - p.likes) * dt * .5); }
    FEED.nextAmb -= dt; if (FEED.nextAmb <= 0) { FEED.nextAmb = 40 + rnd() * 40; const p = mkPost({ u: pick(LOCALS), text: AMBIENT[FEED.ambI++ % AMBIENT.length], views: 4, vt: 300 + rnd() * 3000 }); FEED.posts.unshift(p); if (FEED.posts.length > 30) FEED.posts.length = 30; if (onApp('spume', 'feed') && cur().node.querySelector('.gp-scroll').scrollTop < 20) refresh(); }
  }
  /* --- drawn "clips": a tiny 128x72 buffer with handheld shake + ghosting, upscaled so it reads as compressed phone video */
  const nz = (x, s) => { const v = Math.sin(x * 12.9898 + s * 78.233) * 43758.5453; return v - Math.floor(v); }, snz = (x, s) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(nz(i, s), nz(i + 1, s), u); };
  const SKY = hr => hr < 19.1 ? ['#3b2c6e', '#b84e72', '#ff9a4e', '#ffd27a'] : hr < 20.1 ? ['#10163a', '#4a2868', '#c85a66', '#f09a6a'] : ['#04060e', '#0a1022', '#151c30', '#1c2238'];
  const SCN = {
    base(g, W, H, p, hz) { g.fillStyle = lin(g, 0, 0, 0, hz, SKY(p.hr)); g.fillRect(-20, -20, W + 40, hz + 20); g.fillStyle = p.hr < 20.1 ? '#1b1a22' : '#0c0d12'; g.fillRect(-20, hz, W + 40, H); },
    man(g, x, y, s, up, run) { g.fillStyle = g.strokeStyle = '#08070c'; g.lineWidth = 1.6 * s; g.lineCap = 'round'; g.beginPath(); g.arc(x, y - 11 * s, 2 * s, 0, TAU); g.fill(); g.fillRect(x - 1.8 * s, y - 9 * s, 3.6 * s, 6 * s); g.beginPath();
      g.moveTo(x - 1 * s, y - 3 * s); g.lineTo(x - 1 * s - run * 2.4 * s, y); g.moveTo(x + 1 * s, y - 3 * s); g.lineTo(x + 1 * s + run * 2.4 * s, y);
      if (up) { g.moveTo(x - 1.6 * s, y - 8.5 * s); g.lineTo(x - 3.4 * s, y - 13 * s); g.moveTo(x + 1.6 * s, y - 8.5 * s); g.lineTo(x + 3.4 * s, y - 13 * s); } else { g.moveTo(x - 1.6 * s, y - 8.5 * s); g.lineTo(x - 2.6 * s + run * s, y - 4.5 * s); g.moveTo(x + 1.6 * s, y - 8.5 * s); g.lineTo(x + 2.6 * s - run * s, y - 4.5 * s); } g.stroke(); },
    car(g, x, y, s, col, dir) { g.save(); g.translate(x, y); g.scale(s * (dir || 1), s); g.fillStyle = col; g.beginPath(); g.moveTo(-15, 0); g.lineTo(-15, -4.5); g.lineTo(-9, -5.5); g.lineTo(-5, -9.5); g.lineTo(5, -9.5); g.lineTo(9, -5.5); g.lineTo(15, -4.5); g.lineTo(15, 0); g.closePath(); g.fill();
      g.fillStyle = '#050508'; g.beginPath(); g.arc(-9, 0, 2.6, 0, TAU); g.arc(9, 0, 2.6, 0, TAU); g.fill(); g.fillStyle = 'rgba(160,200,230,.35)'; g.fillRect(-4.2, -8.6, 8.4, 3); g.restore(); },
    blob(g, x, y, r, col) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); },
    cop(g, x, y, s, t, dir) { SCN.car(g, x, y, s, '#1a1d26', dir); g.fillStyle = '#e8e8ee'; g.fillRect(x - 5 * s, y - 5 * s, 10 * s, 2 * s); const f = Math.sin(t * 15) > 0; SCN.blob(g, x - 2 * s, y - 10.5 * s, 13 * s, f ? 'rgba(255,40,40,.95)' : 'rgba(255,40,40,.12)'); SCN.blob(g, x + 2 * s, y - 10.5 * s, 13 * s, f ? 'rgba(60,110,255,.12)' : 'rgba(60,110,255,.95)'); },
    palm(g, x, y, hgt) { g.strokeStyle = '#08070c'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 2, y - hgt * .5, x + 1, y - hgt); g.stroke(); g.lineWidth = 1; for (let i = 0; i < 6; i++) { const a = -2.9 + i * .52; g.beginPath(); g.moveTo(x + 1, y - hgt); g.quadraticCurveTo(x + 1 + Math.cos(a) * 5, y - hgt + Math.sin(a) * 5 - 1, x + 1 + Math.cos(a) * 9, y - hgt + Math.sin(a) * 6 + 4); g.stroke(); } },
    robbery(g, W, H, t, p) { SCN.base(g, W, H, p, 50); g.fillStyle = '#15252b'; g.fillRect(14, 20, 92, 31); g.fillStyle = '#229a94'; g.fillRect(14, 20, 92, 6); g.fillStyle = '#ff7a55'; g.fillRect(14, 25.5, 92, 1.2); g.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 6; i++) g.fillRect(40 + i * 5, 21.5, 3.4, 2.6);
      for (let i = 0; i < 5; i++) { g.fillStyle = i === 2 ? '#fff0c0' : '#f6cf82'; g.fillRect(19 + i * 17.4, 30, 15, 17); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(19 + i * 17.4, 38, 15, 1); } SCN.blob(g, 60, 44, 44, 'rgba(255,214,140,.32)');
      g.fillStyle = '#0a0a10'; g.fillRect(-4, 6, 7, 70); g.fillRect(-10, 2, 60, 5); SCN.car(g, 108, 62, 1.25, '#7a1c22', -1); SCN.blob(g, 124, 57, 7, 'rgba(255,40,30,.9)');
      const k = (t * .42) % 1.25, x = lerp(57, 100, Math.min(1, k)); if (k < 1) { SCN.man(g, x, 58, 1.15, false, Math.sin(t * 16)); g.fillStyle = '#08070c'; g.beginPath(); g.ellipse(x - 3, 53, 2.8, 2, 0, 0, TAU); g.fill(); } },
    chase(g, W, H, t, p) { SCN.base(g, W, H, p, 40); if (p.hr < 20.1) SCN.blob(g, 96, 38, 26, 'rgba(255,220,150,.8)'); g.fillStyle = '#23232b'; g.beginPath(); g.moveTo(-20, 46); g.lineTo(W + 20, 42); g.lineTo(W + 20, H + 10); g.lineTo(-20, H + 10); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,220,130,.6)'; for (let i = 0; i < 7; i++) g.fillRect(((i * 26 - t * 150) % 180 + 180) % 180 - 20, 58, 12, 1.4); SCN.palm(g, 18, 44, 26); SCN.palm(g, 52, 43, 20); SCN.palm(g, 112, 42, 24);
      const k = (t * .55) % 1.6, x = -30 + k * 150; g.fillStyle = 'rgba(255,240,200,.25)'; g.fillRect(x - 60, 53, 50, 3); SCN.car(g, x, 60, 1.3, '#8a1f24', 1); SCN.blob(g, x + 21, 55, 8, 'rgba(255,245,210,.9)'); SCN.cop(g, x - 52, 61, 1.3, t, 1); SCN.cop(g, x - 100, 63, 1.35, t + .2, 1); },
    crash(g, W, H, t, p) { SCN.base(g, W, H, p, 48); g.strokeStyle = '#0a0a10'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(70, 60); g.lineTo(80, 6); g.stroke(); g.lineWidth = 1.4; g.beginPath(); g.moveTo(80, 6); g.lineTo(96, 9); g.stroke(); SCN.blob(g, 96, 10, 9, Math.sin(t * 23) > .3 ? 'rgba(255,230,170,.9)' : 'rgba(255,230,170,.15)');
      g.save(); g.translate(52, 60); g.rotate(-.07); SCN.car(g, 0, 0, 1.4, '#6f7682', 1); g.fillStyle = '#6f7682'; g.beginPath(); g.moveTo(15, -7); g.lineTo(23, -12); g.lineTo(21, -2); g.closePath(); g.fill(); g.restore(); if (Math.sin(t * 7) > 0) { SCN.blob(g, 31, 55, 6, 'rgba(255,170,40,.95)'); SCN.blob(g, 72, 56, 5, 'rgba(255,170,40,.8)'); }
      for (let i = 0; i < 6; i++) { const k = (t * .35 + i / 6) % 1; SCN.blob(g, 72 + Math.sin(i * 2.1 + k * 3) * 6 + k * 8, 50 - k * 44, 6 + k * 12, 'rgba(190,190,200,' + (.4 * (1 - k)) + ')'); } g.fillStyle = 'rgba(220,235,255,.7)'; for (let i = 0; i < 14; i++) g.fillRect(60 + nz(i, 3) * 34, 62 + nz(i, 5) * 6, 1, 1); SCN.man(g, 104, 63, 1.1, false, 0); SCN.man(g, 112, 64, 1.15, false, 0); },
    hoops(g, W, H, t, p) { SCN.base(g, W, H, p, 54); if (p.hr < 20.1) SCN.blob(g, 40, 50, 34, 'rgba(255,225,150,.85)'); g.fillStyle = '#2a3a3a'; g.fillRect(-20, 54, W + 40, 30); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.ellipse(84, 66, 40, 8, 0, Math.PI, TAU); g.stroke();
      g.strokeStyle = '#08070c'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(104, 62); g.lineTo(104, 22); g.lineTo(97, 18); g.stroke(); g.fillStyle = '#e8e8ea'; g.fillRect(93, 10, 3, 15); g.strokeStyle = '#ff5a2a'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(85, 23); g.lineTo(93, 23); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = .6; g.beginPath(); for (let i = 0; i < 4; i++) { g.moveTo(85.5 + i * 2.4, 23.5); g.lineTo(86.6 + i * 1.7, 30); } g.stroke();
      const k = (t * .62) % 1.3, kk = Math.min(1, k), bx = lerp(31, 89, kk), by = lerp(34, 23, kk) - Math.sin(kk * Math.PI) * 26 + (k > 1 ? (k - 1) * 90 : 0); SCN.man(g, 27, 60, 1.5, k < .35, 0); g.fillStyle = '#e8762a'; g.beginPath(); g.arc(bx, by, 2.6, 0, TAU); g.fill(); SCN.man(g, 58, 61, 1.3, false, 0); SCN.man(g, 118, 62, 1.3, k > 1, 0); },
    dog(g, W, H, t, p) { g.fillStyle = lin(g, 0, 0, 0, 30, SKY(p.hr)); g.fillRect(-20, -20, W + 40, 52); g.fillStyle = p.hr < 20.1 ? '#2f7f8a' : '#0d2c3a'; g.fillRect(-20, 28, W + 40, 9); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(-20, 36 + Math.sin(t * 1.5), W + 40, 1); g.fillStyle = p.hr < 20.1 ? '#b89668' : '#4a4034'; g.fillRect(-20, 37, W + 40, 60);
      const x = 74, y = 56, wag = Math.sin(t * 16) * .5, c = '#3a2a1c'; g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(x, y + 8, 17, 2.6, 0, 0, TAU); g.fill(); g.fillStyle = g.strokeStyle = c; g.beginPath(); g.ellipse(x, y, 13, 6.5, 0, 0, TAU); g.fill(); g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); for (const lx of [-9, -5, 6, 10]) { g.moveTo(x + lx, y + 3); g.lineTo(x + lx, y + 8); } g.stroke();
      g.lineWidth = 2; g.beginPath(); g.moveTo(x - 12, y - 3); g.lineTo(x - 18 + wag * 3, y - 11 - Math.abs(wag) * 2); g.stroke(); g.beginPath(); g.arc(x + 14, y - 6, 5.6, 0, TAU); g.fill(); g.beginPath(); g.moveTo(x + 10, y - 10); g.lineTo(x + 9.5, y - 15); g.lineTo(x + 13.5, y - 11); g.moveTo(x + 15, y - 11); g.lineTo(x + 18, y - 15); g.lineTo(x + 18.5, y - 9); g.fill(); g.fillRect(x + 17, y - 6.5, 5.5, 3.6);
      g.fillStyle = '#e8748a'; g.fillRect(x + 19, y - 3.2, 2, 2.6 + Math.sin(t * 9)); g.fillStyle = '#fff'; g.fillRect(x + 15, y - 8, 1.2, 1.2);
      const hy = -15 + Math.sin(t * 5) * 1.6; g.strokeStyle = '#b07a58'; g.lineWidth = 5; g.beginPath(); g.moveTo(132, 14); g.lineTo(x + 20, y + hy + 2); g.stroke(); g.lineWidth = 6.5; g.beginPath(); g.moveTo(x + 20, y + hy + 2); g.lineTo(x + 15, y + hy + 4); g.stroke(); },
    busted(g, W, H, t, p) { SCN.base(g, W, H, Object.assign({}, p, { hr: Math.max(p.hr, 19.6) }), 46); g.fillStyle = '#14141c'; g.fillRect(-20, 46, W + 40, 40); for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(255,214,150,.7)'; g.fillRect(8 + i * 27, 30 + (i % 2) * 4, 1.6, 1.6); }
      SCN.cop(g, 30, 62, 1.5, t, 1); SCN.cop(g, 116, 59, 1.2, t + .3, -1); SCN.man(g, 74, 63, 1.6, true, 0); SCN.man(g, 54, 64, 1.5, false, .5); g.strokeStyle = '#08070c'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(56.5, 51); g.lineTo(63, 50); g.stroke();
      const f = Math.sin(t * 15) > 0; g.fillStyle = f ? 'rgba(255,30,30,.2)' : 'rgba(40,90,255,.2)'; g.fillRect(-20, -20, W + 40, H + 40); },
    clean(g, W, H, t, p) { SCN.base(g, W, H, Object.assign({}, p, { hr: Math.max(p.hr, 19.6) }), 44); g.fillStyle = '#e8e4d8'; g.beginPath(); g.arc(104, 12, 4, 0, TAU); g.fill(); g.fillStyle = '#1c1a26'; g.fillRect(-20, 26, 70, 20); for (let i = 0; i < 5; i++) { g.fillStyle = i === 3 ? '#ffd98a' : '#2a2634'; g.fillRect(-6 + i * 11, 31, 7, 9); }
      g.fillStyle = '#0a0a10'; g.fillRect(58, 8, 2, 38); g.fillStyle = '#16121c'; g.fillRect(52, 6, 22, 12); g.fillStyle = '#ff4a8a'; for (let i = 0; i < 5; i++) g.fillRect(54.5 + i * 3.8, 9, 2.4, 6); SCN.blob(g, 63, 12, 20, 'rgba(255,60,140,.45)');
      g.fillStyle = '#17171f'; g.fillRect(-20, 44, W + 40, 40); g.fillStyle = 'rgba(255,255,255,.2)'; for (let i = 0; i < 6; i++) g.fillRect(8 + i * 20, 50, 1, 12); g.fillStyle = '#2c3038'; g.beginPath(); g.moveTo(22, 61); g.quadraticCurveTo(26, 48, 38, 48); g.quadraticCurveTo(50, 48, 54, 61); g.closePath(); g.fill();
      const x = ((t * 9) % 170) - 20, a = Math.sin(t * 1.3) * .5 - .3; SCN.cop(g, x, 66, 1.3, t, 1); g.fillStyle = 'rgba(255,250,220,.2)'; g.beginPath(); g.moveTo(x + 6, 58); g.lineTo(x + 6 + Math.cos(a - .22) * 70, 58 + Math.sin(a - .22) * 70); g.lineTo(x + 6 + Math.cos(a + .22) * 70, 58 + Math.sin(a + .22) * 70); g.closePath(); g.fill(); }
  };
  function clipFrame(p, cvs, t) {
    const W = 128, H = 72, b = p._buf || (p._buf = Object.assign(document.createElement('canvas'), { width: W, height: H })), g = b.getContext('2d'), sd = p.id * 1.37;
    const sx = (snz(t * 5.5, sd) - .5) * 9 + Math.sin(t * 17) * .8, sy = (snz(t * 6.3, sd + 4) - .5) * 7 + Math.cos(t * 19) * .7, rot = (snz(t * 3.1, sd + 9) - .5) * .09;
    g.globalAlpha = p._drawn ? .58 : 1; p._drawn = 1; g.save(); g.translate(W / 2 + sx, H / 2 + sy); g.rotate(rot); g.scale(1.2, 1.2); g.translate(-W / 2, -H / 2); try { (SCN[p.clip] || SCN.chase)(g, W, H, t, p); } catch (e) { /* drawing is best effort */ } g.restore(); g.globalAlpha = 1;
    if (!cvs.width || cvs._k !== M.k) { cvs._k = M.k; cvs.width = Math.round(cvs.clientWidth * 2) || 480; cvs.height = Math.round(cvs.clientHeight * 2) || 270; }
    const o = cvs.getContext('2d'), w = cvs.width, h = cvs.height; o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'low'; o.filter = 'contrast(1.08) saturate(1.15)'; o.drawImage(b, 0, 0, w, h); o.filter = 'none';
    const vg = o.createRadialGradient(w / 2, h / 2, h * .3, w / 2, h / 2, w * .72); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)'); o.fillStyle = vg; o.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { o.fillStyle = 'rgba(255,255,255,' + (nz(i + t * 60, 1) * .09) + ')'; o.fillRect(nz(i, t * 30 | 0) * w, nz(i + 50, t * 30 | 0) * h, 2, 2); }
    const by = (t * .21 % 1) * h; o.fillStyle = 'rgba(255,255,255,.035)'; o.fillRect(0, by, w, h * .12);
  }
  APPS.spume = { home: 'feed',
    render(c) {
      if (c.page === 'post') { const p = FEED.posts.find(x => x.id === +c.arg); if (!p) return '<div class="gp-app gp-spume">' + hd('帖子') + '</div>';
        return '<div class="gp-app gp-spume">' + hd('帖子', '<em class="gp-pill live"><i></i><b class="gp-watch">' + Math.max(1, Math.round((p.vt - p.views) * .012) + 1) + '</b> 人在看</em>') + '<div class="gp-scroll">' + postHTML(p, 0, true) +
          '<div class="gp-post-acts"><button class="' + (p.liked ? 'on' : '') + '" data-a="like" data-i="0"><i class="gp-g-heart"></i>' + (p.liked ? '已赞' : '点赞') + '</button><button data-a="repost" data-i="1">' + iconHTML('spume', 16) + '转发</button></div><h2>评论 <small class="gp-cmc"></small></h2><div class="gp-cmts">' + p.cm.map(x => cmHTML(x)).join('') + '</div><div class="gp-end">' + (p.ev ? '评论还在涌进来…' : '到底了') + '</div></div></div>'; }
      return '<div class="gp-app gp-spume"><div class="gp-hd gp-sp-hd"><b class="gp-bk" data-a="back"></b><div class="gp-sp-logo">' + iconHTML('spume', 24) + '<span>浪花</span></div><div class="gp-hd-r"><em class="gp-pill golive' + (S.live ? ' on' : '') + '" data-a="live"><i></i>' + (S.live ? '直播中' : '开播') + '</em></div></div>' +
        '<div class="gp-tabs"><span class="on">附近</span><span>关注</span><span>热门</span><span>直播</span></div><div class="gp-scroll">' + FEED.posts.slice(0, 14).map((p, i) => postHTML(p, i)).join('') + '<div class="gp-end">Costa Brisa 就这么大，刷完了</div></div></div>'; },
    mount(c, node) { FEED.clipT = 0; this.tick(0, c); if (c.page === 'post') S.notes.forEach(n => { if (n.post === +c.arg) n.seen = true; }); else S.notes.forEach(n => { if (n.app === 'spume') n.seen = true; }); },
    tick(dt, c) { const node = c.node; if (!node) return; FEED.clipT -= dt; if (FEED.clipT <= 0) { FEED.clipT = 1 / 14; const sc = node.querySelector('.gp-scroll'); node.querySelectorAll('.gp-clip[data-clip]').forEach(n => { if (sc) { const top = n.offsetTop - sc.offsetTop - sc.scrollTop; if (top > sc.clientHeight || top + n.offsetHeight < 0) return; } const p = FEED.posts.find(x => x.id === +n.dataset.clip); if (p) clipFrame(p, n.querySelector('canvas'), S.t - p.t + p.id * 3.1); }); }
      FEED.uiT -= dt; if (FEED.uiT > 0) return; FEED.uiT = .25; node.querySelectorAll('[data-pid]').forEach(n => { const p = FEED.posts.find(x => x.id === +n.dataset.pid); if (!p) return; const set = (q, v) => { const e = n.querySelector(q); if (e && e.textContent !== v) e.textContent = v; }; set('.gp-vws b', cnNum(p.views)); set('.gp-lk b', cnNum(p.likes)); set('.gp-cmn b', String(p.cm.length)); });
      if (c.page === 'post') { const p = FEED.posts.find(x => x.id === +c.arg), w = node.querySelector('.gp-watch'), cc = node.querySelector('.gp-cmc'); if (p && w) w.textContent = Math.max(1, Math.round((p.vt - p.views) * .012 + 2 + Math.sin(S.t * 1.7) * 2)); if (p && cc) cc.textContent = p.cm.length + ' 条'; } },
    act(a, v, c, node) { if (a === 'post') nav('spume', 'post', +v); else if (a === 'live') { api.livestream(); refresh(); }
      else if (a === 'like' || a === 'repost') { const p = FEED.posts.find(x => x.id === +c.arg); if (!p) return; if (a === 'like') { p.liked = !p.liked; p.likes += p.liked ? 1 : -1; emit('like', { post: p.id, liked: p.liked, event: p.ev || null }); refresh(); const b = cur().node.querySelector('[data-a="like"]'); if (b && p.liked) b.classList.add('gp-pop'); sfx('ui_ok'); } else { node.classList.add('done'); node.lastChild.textContent = '已转发'; sfx('ui_tick'); } } },
    key(code, c) { if (c.page === 'post') { const sc = c.node.querySelector('.gp-scroll'); if (code === 'ArrowDown') { sc.scrollTop += 70; return true; } if (code === 'ArrowUp') { sc.scrollTop -= 70; return true; } if (code === 'ArrowLeft' || code === 'ArrowRight') { c.sel = c.sel ? 0 : 1; markSel(true); return true; } if (code === 'KeyL') { this.act('like', 0, c); return true; } } return false; }
  };

  /* ------------------------------------------------------------------ live-stream overlay: chat scrolling up the right edge while you drive */
  const LIVE = { viewers: 0, next: 0, burst: [], surge: 0, heartT: 0, giftT: 9, shown: 0 };
  const CHATN = ['椰子阿姨', '夜班小周', 'xX海风Xx', '老马修车', '不吃香菜', 'brisa_0417', '退潮钓鱼佬', '奶昔受害者', '我妈让我早睡', '路过的海鸥', '塔可车车主', 'motel 203 房', '表弟后援会', '半场投手'];
  const CHATL = ['来了来了', '主播今天开什么车', '这车声浪可以', '主播开慢点，我晕车', '去海边去海边', '左边左边…啊过了', '加油站那个招牌好复古', '666', '主播欠的钱还了吗', '刚进，这是在干嘛', '日落好看', '主播说句话', '前面有巡防吗', '塔可车出摊了，速去', '放个电台', '这条路我天天走', '点歌：CORAL 98.1', '表弟呢', '主播像是在跑路', '弹幕护体', '右边那个是汽车旅馆吗', '好想去海边', '画质可以啊这手机', '屏幕是不是裂了'];
  const CHATF = ['慢点慢点！！', '这是直播还是遗言', '时速多少了', '我手心出汗了', '安全带系了吗', '起飞', '表都快爆了', '海滨公路限速 45 谢谢', '主播你妈妈在看', '我截图了，综合交管也在看', '稳住稳住', '这弯你也敢不减速', '风噪好大', '前面红灯！红灯！'];
  const recent = [], fresh = pool => { let t = pick(pool), n = 0; while (recent.includes(t) && n++ < 8) t = pick(pool); recent.push(t); if (recent.length > 9) recent.shift(); return t; };
  function chatLine(name, text, cls) { const hue = (name.charCodeAt(0) * 47 + name.length * 91) % 360, n = el('div', 'gp-lv-m ' + (cls || ''), cls === 'sys' ? '<span>' + esc(text) + '</span>' : '<b style="color:hsl(' + hue + ' 85% 74%)">' + esc(name) + '</b><span>' + esc(text) + '</span>'); D.chat.appendChild(n); while (D.chat.children.length > 13) D.chat.firstChild.remove(); }
  function liveTick(dt) {
    const sp = S.ctx && S.ctx.speed || 0; LIVE.viewers += dt * (1.2 + LIVE.surge * .25 + sp * .05) + (rnd() - .5) * dt * 3; LIVE.surge = Math.max(0, LIVE.surge - LIVE.surge * dt * .25); LIVE.viewers = Math.max(12, LIVE.viewers);
    const v = Math.round(LIVE.viewers); if (v !== LIVE.shown) { LIVE.shown = v; D.lvN.textContent = cnNum(v); }
    LIVE.next -= dt; if (LIVE.next <= 0) { if (LIVE.burst.length) { chatLine(pick(CHATN), LIVE.burst.shift()); LIVE.next = .16 + rnd() * .3; } else { chatLine(pick(CHATN), sp > 26 && rnd() < .5 ? fresh(CHATF) : fresh(CHATL)); LIVE.next = .45 + rnd() * 1.3; } }
    LIVE.heartT -= dt; if (LIVE.heartT <= 0) { LIVE.heartT = LIVE.burst.length ? .12 : .35 + rnd() * .8; const h = el('i', 'gp-lv-h'); h.style.setProperty('--x', (rnd() * 60 - 30).toFixed(0)); h.style.setProperty('--c', pick(['#ff5a7a', '#ff9a4d', '#ffd24d', '#7ae0d0', '#c9a0ff'])); h.style.setProperty('--r', (rnd() * 40 - 20).toFixed(0) + 'deg'); D.hearts.appendChild(h); after(2.3, () => h.remove()); }
    LIVE.giftT -= dt; if (LIVE.giftT <= 0) { LIVE.giftT = 11 + rnd() * 10; const g = pick([['小海螺', 3], ['冰奶昔', 1], ['椰子', 5], ['加满一箱油', 1]]); D.gift.innerHTML = '<b>' + esc(pick(CHATN)) + '</b> 送出 <em>' + g[0] + '</em> ×' + g[1]; D.gift.classList.remove('on'); void D.gift.offsetWidth; D.gift.classList.add('on'); chatLine('', pick(CHATN) + ' 送出了 ' + g[0] + ' ×' + g[1], 'sys'); }
  }

  /* ------------------------------------------------------------------ 扫车: reads a parked car's security tier and the tool it needs */
  const SEC = { old: { level: 'old', lv: 1, name: '机械门锁', tool: '平口螺丝刀', toolId: 'screwdriver', how: '撬开锁芯，再拧断点火开关。动静不大，手要稳。', seconds: 6, alarm: '无警报', risk: '低', col: '#8fe6c2' },
    modern: { level: 'modern', lv: 2, name: '电子防盗 · 无钥匙进入', tool: '信号中继器', toolId: 'relay', how: '放大车主钥匙的信号骗开车门。车主得在 15 米以内。', seconds: 12, alarm: '有警报 · 失败会鸣笛', risk: '中', col: '#ffc46a' },
    luxury: { level: 'luxury', lv: 3, name: '加密芯片 + 卫星定位', tool: '解码器 + 定位屏蔽器', toolId: 'decoder', how: '先屏蔽定位，再重写钥匙编码。开走后 2 分钟内必须换牌。', seconds: 25, alarm: '静默报警 · 直通车主手机', risk: '高', col: '#ff6a6a' } };
  const KIND = { compact: '小型车', sedan: '四门轿车', hero: '肌肉车', muscle: '肌肉车', cruiser: '巡防巡逻车', pickup: '皮卡', suv: 'SUV', van: '厢式货车', sports: '跑车', coupe: '双门轿跑', taxi: '出租车' };
  const SCAN = { key: '', prog: 0, done: false, lost: 0, tgt: null, n: 0, fed: -9, hex: '',
    feed(src) { if (++SCAN.n % 2) return; const c = cur(), cvs = c && c.node && c.node.querySelector('.gp-sc-cv'); if (!cvs || !src || !src.width) return; const g = cvs.getContext('2d'), ar = cvs.width / cvs.height, sh = src.height * .5, sw = Math.min(src.width, sh * ar);
      try { g.filter = 'saturate(.55) contrast(1.15) brightness(1.05)'; g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2 + src.height * .04, sw, sh, 0, 0, cvs.width, cvs.height); g.filter = 'none'; g.fillStyle = 'rgba(10,70,90,.28)'; g.fillRect(0, 0, cvs.width, cvs.height); SCAN.fed = S.t; } catch (e) { /* tainted or lost context */ } },
    idle(cvs) { const g = cvs.getContext('2d'), w = cvs.width, h = cvs.height; g.fillStyle = lin(g, 0, 0, 0, h, ['#0a1a22', '#061016']); g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(94,230,255,.16)'; g.lineWidth = 1; g.beginPath(); const hz = h * .42;
      for (let i = -8; i <= 8; i++) { g.moveTo(w / 2 + i * 14, hz); g.lineTo(w / 2 + i * 120, h); } for (let i = 0; i < 9; i++) { const k = ((i + S.t * .6) % 9) / 9, y = hz + k * k * (h - hz); g.moveTo(0, y); g.lineTo(w, y); } g.stroke(); g.fillStyle = 'rgba(94,230,255,.5)'; g.fillRect(0, hz, w, 1); },
    sch(cvs, t, sec) { const W = 250, H = 86, g = cv(cvs, W, H, 2), kind = t.kind || 'sedan', x0 = 22, x1 = W - 22, yb = 66, P = (u, v) => [x0 + u * (x1 - x0), yb - v * 78];
      g.strokeStyle = 'rgba(94,230,255,.1)'; g.lineWidth = 1; g.beginPath(); for (let x = 5; x < W; x += 12) { g.moveTo(x, 0); g.lineTo(x, H); } for (let y = 6; y < H; y += 12) { g.moveTo(0, y); g.lineTo(W, y); } g.stroke();
      const prof = { pickup: [[0, .05], [.01, .34], [.3, .38], [.38, .66], [.56, .66], [.59, .4], [.98, .4], [1, .05]], hero: [[0, .05], [.02, .28], [.2, .36], [.4, .38], [.5, .58], [.7, .58], [.84, .38], [.97, .34], [1, .05]], compact: [[.08, .05], [.09, .3], [.24, .38], [.36, .64], [.7, .64], [.84, .4], [.9, .3], [.92, .05]],
        van: [[0, .05], [.01, .4], [.12, .72], [.96, .72], [.99, .05]], suv: [[0, .05], [.01, .36], [.2, .42], [.3, .7], [.82, .7], [.9, .42], [.99, .36], [1, .05]], sedan: [[0, .05], [.02, .3], [.2, .38], [.34, .6], [.66, .6], [.8, .4], [.97, .34], [1, .05]] };
      const pf = prof[kind] || prof[{ muscle: 'hero', sports: 'hero', coupe: 'hero', cruiser: 'sedan', taxi: 'sedan' }[kind]] || prof.sedan, pts = pf.map(p => P(p[0], p[1])), col = '#5ee6ff';
      g.shadowColor = col; g.shadowBlur = 7; g.strokeStyle = col; g.lineWidth = 1.5; g.lineJoin = 'round'; g.beginPath(); pts.forEach((p, i) => { if (!i) g.moveTo(p[0], p[1]); else { const q = pts[i - 1]; g.quadraticCurveTo(q[0] + (p[0] - q[0]) * .15, q[1] + (p[1] - q[1]) * .85 * (i % 2), p[0], p[1]); } }); g.closePath(); g.stroke(); g.fillStyle = 'rgba(94,230,255,.06)'; g.fill();
      const wl = P(pf[0][0] + .17, 0), wr = P(pf[pf.length - 1][0] - .17, 0); for (const w of [wl, wr]) { g.fillStyle = '#071219'; g.beginPath(); g.arc(w[0], w[1] - 3, 11.5, 0, TAU); g.fill(); g.stroke(); g.beginPath(); g.arc(w[0], w[1] - 3, 5, 0, TAU); g.stroke(); }
      g.shadowBlur = 0; g.lineWidth = .8; g.strokeStyle = 'rgba(94,230,255,.55)'; const mid = P(.5, .36), top = P(.5, .56); g.beginPath(); g.moveTo(mid[0], mid[1] + 22); g.lineTo(mid[0], top[1]); g.stroke();
      const mark = (u, v, lab, c2, al) => { const p = P(u, v), pu = (S.t * 1.4) % 1; g.strokeStyle = c2; g.lineWidth = 1.2; g.globalAlpha = 1 - pu; g.beginPath(); g.arc(p[0], p[1], 3 + pu * 9, 0, TAU); g.stroke(); g.globalAlpha = 1; g.fillStyle = c2; g.beginPath(); g.arc(p[0], p[1], 3, 0, TAU); g.fill(); g.font = '600 8.5px -apple-system, "PingFang SC", sans-serif'; g.textAlign = al || 'left'; g.fillText(lab, p[0] + (al === 'right' ? -7 : 7), p[1] - 6); };
      mark(.46, .33, t.locked === false ? '未锁' : '门锁', sec.col); if (sec.lv >= 2) mark(.27, .2, '车身电脑', '#ffc46a', 'right'); if (sec.lv >= 3) mark(.62, .62, '定位天线', '#ff6a6a');
      g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = .8; g.beginPath(); g.moveTo(x0, yb + 12); g.lineTo(x1, yb + 12); g.moveTo(x0, yb + 9); g.lineTo(x0, yb + 15); g.moveTo(x1, yb + 9); g.lineTo(x1, yb + 15); g.stroke(); }
  };
  APPS.scan = {
    enter() { SCAN.key = ''; SCAN.prog = 0; SCAN.done = false; SCAN.tgt = null; },
    render() { const t = SCAN.tgt, sec = t && (SEC[t.security] || SEC.modern); let body;
      if (!t) body = '<div class="gp-sc-idle"><b>把手机对准一辆停着的车</b><span>走近到 6 米以内，镜头里要能看到车牌或车门</span><ul><li><i style="background:#8fe6c2"></i>一级 · 机械锁 — 螺丝刀</li><li><i style="background:#ffc46a"></i>二级 · 电子防盗 — 信号中继器</li><li><i style="background:#ff6a6a"></i>三级 · 加密 + 定位 — 解码器</li></ul></div>';
      else if (!SCAN.done) body = '<div class="gp-sc-prog"><b>正在读取车身电子标签…</b><i class="gp-pg"><u class="gp-sc-bar"></u></i><code class="gp-sc-hex"></code></div>';
      else body = '<div class="gp-sc-res"><canvas class="gp-sc-sch"></canvas><div class="gp-sc-rows"><div><small>车牌</small><b class="plate">' + esc(t.plate || '—') + '</b></div><div><small>车型</small><b>' + esc(KIND[t.kind] || t.kind || '未知') + '</b></div><div><small>车门</small><b class="' + (t.locked === false ? 'ok' : 'bad') + '">' + (t.locked === false ? '未上锁' : '已上锁') + '</b></div>' +
        '<div><small>防盗等级</small><b><i class="gp-lvl l' + sec.lv + '"><u></u><u></u><u></u></i>' + sec.lv + ' 级</b></div></div><div class="gp-sc-tool" style="--c:' + sec.col + '"><small>' + esc(sec.name) + '</small><b>' + (t.locked === false && sec.lv === 1 ? '车门没锁 · 点火仍需' : '需要') + ' ' + esc(sec.tool) + '</b><p>' + esc(sec.how) + '</p><div class="gp-chips"><span>约 ' + sec.seconds + ' 秒</span><span>' + sec.alarm + '</span><span>风险 ' + sec.risk + '</span></div></div>' +
        '<button class="gp-sc-mark' + (t._marked ? ' done' : '') + '" data-a="mark" data-i="0">' + (t._marked ? '已标记在地图上' : '标记这辆车') + '<kbd>Enter</kbd></button></div>';
      return '<div class="gp-app gp-scan">' + hd('扫车', '<em class="gp-pill">v0.9 测试版</em>') + '<div class="gp-sc-view' + (t ? (SCAN.done ? ' lock' : ' busy') : '') + '"><canvas class="gp-sc-cv" width="524" height="300"></canvas><div class="gp-sc-ret"><i></i><i></i><i></i><i></i></div><i class="gp-sc-line"></i><div class="gp-sc-tag">' + (t ? (SCAN.done ? '已锁定 · ' + esc(t.plate || '') : '扫描中') : '搜索目标') + '</div><div class="gp-sc-dist"></div></div>' + body + '</div>'; },
    mount(c, node) { if (S.t - SCAN.fed > .5) SCAN.idle(node.querySelector('.gp-sc-cv')); const s = node.querySelector('.gp-sc-sch'); if (s && SCAN.tgt) SCAN.sch(s, SCAN.tgt, SEC[SCAN.tgt.security] || SEC.modern); },
    tick(dt, c) { const t = S.ctx && S.ctx.target || null, key = t ? (t.plate || '') + '|' + (t.kind || '') + '|' + t.security : '';
      if (key !== SCAN.key) { if (!t) { SCAN.lost += dt; if (SCAN.lost < .7) return this.anim(c); } SCAN.lost = 0; SCAN.key = key; SCAN.tgt = t; SCAN.prog = 0; SCAN.done = false; refresh(); if (t) sfx('ui_tick'); return; } SCAN.lost = 0;
      if (t && !SCAN.done) { SCAN.prog += dt / 1.5; const bar = c.node.querySelector('.gp-sc-bar'), hex = c.node.querySelector('.gp-sc-hex'); if (bar) bar.style.width = Math.min(100, SCAN.prog * 100).toFixed(0) + '%'; if (hex && S.frame % 3 === 0) { let s = ''; for (let i = 0; i < 4; i++) s += (rnd() * 65536 | 0).toString(16).toUpperCase().padStart(4, '0') + ' '; hex.textContent = 'RFID ' + s; }
        if (SCAN.prog >= 1) { SCAN.done = true; refresh(); sfx('ui_ok'); emit('scanned', Object.assign({}, t, { info: api.securityInfo(t.security) })); } }
      this.anim(c); },
    anim(c) { const cvs = c.node.querySelector('.gp-sc-cv'); if (cvs && S.t - SCAN.fed > .5 && S.frame % 3 === 0) SCAN.idle(cvs); const s = c.node.querySelector('.gp-sc-sch'); if (s && SCAN.tgt && S.frame % 3 === 0) SCAN.sch(s, SCAN.tgt, SEC[SCAN.tgt.security] || SEC.modern); },
    act(a) { if (a === 'mark' && SCAN.tgt && SCAN.done) { SCAN.tgt._marked = true; emit('scan', Object.assign({}, SCAN.tgt, { info: api.securityInfo(SCAN.tgt.security), x: S.player.x, z: S.player.z })); sfx('ui_ok'); refresh(); } }
  };

  /* ------------------------------------------------------------------ 银行 */
  const DEBT = { total: 52000, owed: 40000, pays: [{ t: '本月 2 日', n: 2500, why: '现金 · 当面交' }, { t: '上月 17 日', n: 4500, why: '现金 · 当面交' }, { t: '上月 3 日', n: 5000, why: '现金 · 当面交' }],
    pay(n) { const w = GT.wallet; n = Math.floor(Math.min(n, DEBT.owed, w.cash)); if (!(n > 0)) return false; nextWhy = '还款 · 郝老板'; const ok = w.spend(n); walletPoll(); nextWhy = null; if (!ok) return false; DEBT.owed -= n; DEBT.pays.unshift({ t: '今天 ' + clock(), n, why: 'TideOS 转账' }); emit('repay', { amount: n, owed: DEBT.owed });
      const owed = DEBT.owed; after(2.6, () => addMessage('boss', { from: '郝老板', text: owed > 0 ? '收到 ' + money(n) + '。还剩 ' + money(owed) + '。星期五见。' : '两清了。和你做生意很愉快，阿凯。下次手紧，还来找我。' })); return true; } };
  const TX = []; let lastCash = null, nextWhy = null;
  function walletPoll(why) { const cash = GT.wallet.cash; if (lastCash === null) { lastCash = cash; return; } const d = cash - lastCash; if (!d) return; lastCash = cash; TX.unshift({ n: d, why: nextWhy ? nextWhy : typeof why === 'string' && why && why !== 'spend' ? why : (d > 0 ? '现金入账' : '现金支出'), time: clock() }); if (TX.length > 20) TX.length = 20; if (onApp('bank')) refresh(); else if (onApp('home')) refresh(); }
  function stash() { const s = GT.safehouse; if (!s) return null; let v = s.stashTotal !== undefined ? s.stashTotal : s.stash; if (typeof v === 'function') { try { v = v.call(s); } catch (e) { v = null; } } if (v && typeof v === 'object') v = v.total !== undefined ? v.total : v.cash; return typeof v === 'number' ? v : null; }
  APPS.bank = { cols: 3,
    render(c) { const cash = GT.wallet.cash, st = stash(), paid = DEBT.total - DEBT.owed;
      return '<div class="gp-app gp-bank">' + hd('海螺银行', '<i class="gp-g-lock"></i>') + '<div class="gp-scroll"><div class="gp-card"><i class="gp-card-sun"></i><small>现金 · 随身</small><b>' + money(cash) + '</b><i class="gp-chip"></i><div class="gp-card-f"><span>KAI M. · 储蓄卡</span><span>•••• 0417</span></div></div>' +
        (st !== null ? '<div class="gp-stash"><i></i><div><small>安全屋藏匿</small><b>' + money(st) + '</b></div><em>床垫下面<br>不计入余额</em></div>' : '') +
        '<div class="gp-debt"><div class="gp-debt-h"><small>欠款 · 郝老板</small><em>周五到期</em></div><b>' + money(DEBT.owed) + '</b><i class="gp-pg"><u style="width:' + (paid / DEBT.total * 100).toFixed(1) + '%"></u></i><div class="gp-debt-s"><span>已还 ' + money(paid) + '</span><span>共 ' + money(DEBT.total) + ' · 周息 4%</span></div>' +
        '<div class="gp-pay">' + [[500, '还 $500'], [2000, '还 $2,000'], ['all', '全部现金']].map((b, i) => '<button data-a="pay" data-v="' + b[0] + '" data-i="' + i + '">' + b[1] + '</button>').join('') + '</div><div class="gp-pay-msg">' + (c.msg || '') + '</div></div>' +
        '<h2>最近动态</h2><div class="gp-tx">' + (TX.length ? TX.slice(0, 6).map(t => '<div class="' + (t.n > 0 ? 'in' : 'out') + '"><i></i><div><b>' + esc(t.why) + '</b><small>今天 ' + t.time + '</small></div><em>' + (t.n > 0 ? '+' : '') + money(t.n) + '</em></div>').join('') : '<p class="gp-none">今天还没有进账。日子就是这样。</p>') + '</div>' +
        '<h2>还款记录</h2><div class="gp-tx">' + DEBT.pays.slice(0, 6).map(p => '<div class="pay"><i></i><div><b>' + esc(p.why) + '</b><small>' + p.t + '</small></div><em>' + money(-p.n) + '</em></div>').join('') + '</div><div class="gp-end">海螺银行 · 存款不受任何人保护</div></div></div>'; },
    act(a, v, c, node) { if (a !== 'pay') return; const n = v === 'all' ? GT.wallet.cash : +v; if (DEBT.owed <= 0) { c.msg = '已经两清了。'; refresh(); return; } if (GT.wallet.cash < 1 || (v !== 'all' && GT.wallet.cash < n)) { c.msg = '现金不够。'; sfx('ui_bad'); refresh(); const b = cur().node.querySelector('[data-i="' + c.sel + '"]'); if (b) b.classList.add('gp-shake'); return; }
      const paid = Math.min(n, DEBT.owed); if (DEBT.pay(n)) { c.msg = '已转给郝老板 ' + money(paid) + '。'; sfx('cash'); refresh(); } },
    key(code, c) { const sc = c.node.querySelector('.gp-scroll'); if (code === 'ArrowDown') { sc.scrollTop += 80; return true; } if (code === 'ArrowUp') { sc.scrollTop -= 80; return true; } return false; }
  };

  /* ------------------------------------------------------------------ 电台 */
  const RAD = { on: false, st: 0, vol: .55, bars: new Float32Array(30), trk: 0 };
  const STF = [{ name: 'CORAL 98.1', tag: 'sunset synth-funk', bpm: 108 }, { name: 'MAREA 104.5', tag: 'dembow', bpm: 92 }, { name: 'LOW TIDE 88.3', tag: 'lo-fi', bpm: 74 }];
  const TRK = [['《退潮之后》— Los Faroles', '《霓虹薄荷》— Cassette Tía', '《第七街的风》— Ola Baja'], ['《别挂电话》— La Marea Chica', '《咸》— DJ Tostón', '《周四的月亮》— Mango Roto'], ['《便利店 03:00》— tidepool', '《空调外机》— 夜班', '《雨刷》— slowcoast']];
  const stations = () => (GT.audio && GT.audio.stations && GT.audio.stations.length ? GT.audio.stations : STF);
  const tagCN = t => /funk/i.test(t) ? '日落合成放克' : /dembow|regg/i.test(t) ? '热带登波' : /lo-?fi/i.test(t) ? '低保真 · 夜车' : t;
  function radSync() { if (GT.audio && typeof GT.audio.radioOn === 'boolean') { RAD.on = GT.audio.radioOn; RAD.st = GT.audio.station || 0; } }
  function tune(on, i) { RAD.on = on; if (i !== undefined) RAD.st = i; try { if (GT.audio && GT.audio.setRadio) { if (GT.audio.init && !GT.audio.ready) GT.audio.init(); GT.audio.setRadio(on, RAD.st); } } catch (e) { /* audio optional */ } const s = stations()[RAD.st]; emit('radio', { on, station: RAD.st, name: s && s.name }); }
  APPS.radio = {
    enter(c) { radSync(); c.sel = RAD.on ? RAD.st : 0; },
    render() { const ss = stations(), s = ss[RAD.st] || ss[0], tr = TRK[RAD.st % TRK.length];
      return '<div class="gp-app gp-radio">' + hd('电台', '<em class="gp-pill">' + (RAD.on ? 'FM · 立体声' : '已关闭') + '</em>') + '<div class="gp-now' + (RAD.on ? ' on' : '') + '"><canvas class="gp-viz"></canvas><div class="gp-now-t"><small>' + (RAD.on ? '正在播放' : '电台已关闭') + '</small><b>' + esc(s.name) + '</b><span>' + esc(tagCN(s.tag)) + ' · ' + s.bpm + ' BPM</span><p class="gp-trk">' + (RAD.on ? esc(tr[RAD.trk % tr.length]) : '选一个台，按 Enter') + '</p></div></div>' +
        '<div class="gp-stl">' + ss.map((x, i) => { const f = x.name.split(' ').pop(), nm = x.name.replace(' ' + f, ''); return '<div class="gp-stn' + (RAD.on && i === RAD.st ? ' on' : '') + '" data-a="tune" data-v="' + i + '" data-i="' + i + '"><b>' + esc(f) + '</b><div><h3>' + esc(nm) + '</h3><small>' + esc(tagCN(x.tag)) + '</small></div><i class="gp-eq"><u></u><u></u><u></u></i></div>'; }).join('') +
        '<div class="gp-stn off' + (RAD.on ? '' : ' on') + '" data-a="off" data-i="' + ss.length + '"><b>—</b><div><h3>关闭电台</h3><small>只听引擎和海风</small></div></div></div>' +
        '<div class="gp-vol"><i class="gp-g-vol"></i><div class="gp-sl"><u style="width:' + Math.round(RAD.vol * 100) + '%"></u></div><em>' + Math.round(RAD.vol * 100) + '</em></div><div class="gp-keys"><span><kbd>↑↓</kbd>选台</span><span><kbd>←→</kbd>音量</span><span><kbd>Enter</kbd>收听</span></div></div>'; },
    mount(c, node) { const cvs = node.querySelector('.gp-viz'); cv(cvs, 258, 92, 2); const sl = node.querySelector('.gp-sl'); sl.addEventListener('pointerdown', e => { const r = sl.getBoundingClientRect(); this.vol(clamp((e.clientX - r.left) / r.width, 0, 1)); }); this.tick(0, c); },
    vol(v) { RAD.vol = clamp(Math.round(v * 20) / 20, 0, 1); try { if (GT.audio && GT.audio.setRadioVolume) GT.audio.setRadioVolume(RAD.vol); } catch (e) { /* optional */ } refresh(); },
    tick(dt, c) { const cvs = c.node.querySelector('.gp-viz'); if (!cvs) return; const g = cvs.getContext('2d'), W = 258, H = 92, s = stations()[RAD.st] || STF[0], n = RAD.bars.length, beat = S.t * s.bpm / 60, ph = beat % 1, six = Math.floor(beat * 4);
      g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, W, H); const bw = (W - 20) / n;
      for (let i = 0; i < n; i++) { const f = i / (n - 1), kick = Math.exp(-ph * 5) * Math.exp(-f * 6), hat = (six % 2 ? .5 : .25) * Math.exp(-((beat * 2) % 1) * 7) * f * f, mid = (.25 + .6 * nz(i * 3.1 + six * 7.7, RAD.st + 1)) * Math.exp(-Math.pow((f - .38) * 2.4, 2));
        const tgt = RAD.on ? clamp((kick * 1.1 + mid * .8 + hat) * (.5 + RAD.vol), .04, 1) : .03 + .012 * Math.sin(S.t * 2 + i * .6); RAD.bars[i] = tgt > RAD.bars[i] ? lerp(RAD.bars[i], tgt, Math.min(1, dt * 40) || 1) : lerp(RAD.bars[i], tgt, Math.min(1, dt * 9) || 1);
        const h = RAD.bars[i] * 62, x = 10 + i * bw, y = 68 - h; g.fillStyle = lin(g, 0, 68 - 62, 0, 68, ['#ffd27a', '#ff8a3d', '#e0356e']); rr(g, x + 1, y, bw - 2.4, h, 1.6); g.fill(); g.fillStyle = 'rgba(255,138,61,.16)'; rr(g, x + 1, 70, bw - 2.4, h * .3, 1.6); g.fill(); }
      const nt = Math.floor(S.t / 34); if (nt !== RAD.trk) { RAD.trk = nt; const tr = TRK[RAD.st % TRK.length], e = c.node.querySelector('.gp-trk'); if (e && RAD.on) e.textContent = tr[RAD.trk % tr.length]; } },
    act(a, v) { if (a === 'tune') tune(true, +v); else if (a === 'off') tune(false); sfx('ui_tick'); refresh(); },
    key(code, c) { if (code === 'ArrowLeft') { this.vol(RAD.vol - .05); return true; } if (code === 'ArrowRight') { this.vol(RAD.vol + .05); return true; } return false; }
  };

  /* ------------------------------------------------------------------ 设置 (mirrors GT.front.settings when present) */
  const LOCALSET = { volume: .8, sens: 1, quality: 'high', invertY: false, subtitles: true, radio: true };
  const SDEF = [{ k: 'volume', label: '主音量', type: 'sl', min: 0, max: 1, step: .05, fmt: v => Math.round(v * 100) }, { k: 'sens', label: '鼠标灵敏度', type: 'sl', min: .2, max: 3, step: .1, fmt: v => (+v).toFixed(1) }, { k: 'quality', label: '画质', type: 'seg', opts: [['low', '低'], ['med', '中'], ['high', '高']] },
    { k: 'invertY', label: '反转视角 Y 轴', type: 'tg' }, { k: 'subtitles', label: '字幕', type: 'tg' }, { k: 'radio', label: '车载电台', type: 'tg' }, { k: 'dnd', label: '勿扰模式', type: 'tg', local: 1, note: '手机放下时不弹出通知' }, { k: 'wall', label: '壁纸', type: 'seg', local: 1, opts: WALLS.map((w, i) => [i, w.name]) }];
  const FS = () => (GT.front && GT.front.settings) || null;
  const getS = d => d.local ? S[d.k] : (FS() && FS()[d.k] !== undefined ? FS()[d.k] : LOCALSET[d.k]);
  function setS(d, v) { if (d.type === 'sl') v = clamp(Math.round(v / d.step) * d.step, d.min, d.max); if (d.local) { S[d.k] = v; if (d.k === 'wall') paintWall(); } else { LOCALSET[d.k] = v; try { if (FS()) FS()[d.k] = v; } catch (e) { /* front optional */ } } emit('setting', { key: d.k, value: v }); sfx('ui_tick'); if (onApp('settings')) refresh(); }
  APPS.settings = {
    render() { const row = (d, i) => { const v = getS(d); let ctl;
        if (d.type === 'sl') { const p = ((v - d.min) / (d.max - d.min) * 100).toFixed(1); ctl = '<div class="gp-sl" data-k="' + i + '"><u style="width:' + p + '%"></u><i style="left:' + p + '%"></i></div><em>' + d.fmt(v) + '</em>'; }
        else if (d.type === 'seg') ctl = '<div class="gp-seg">' + d.opts.map(o => '<span class="' + (String(o[0]) === String(v) ? 'on' : '') + '" data-a="seg" data-v="' + i + ':' + o[0] + '">' + o[1] + '</span>').join('') + '</div>';
        else ctl = '<i class="gp-tg' + (v ? ' on' : '') + '"></i>';
        return '<div class="gp-set ' + d.type + '" data-a="set" data-v="' + i + '" data-i="' + i + '"><span>' + d.label + (d.note ? '<small>' + d.note + '</small>' : '') + '</span>' + ctl + '</div>'; };
      return '<div class="gp-app gp-settings">' + hd('设置') + '<div class="gp-scroll"><h2>游戏 <small>' + (FS() ? '与主菜单同步' : '本机保存') + '</small></h2><div class="gp-group">' + SDEF.slice(0, 6).map(row).join('') + '</div><h2>手机</h2><div class="gp-group">' + SDEF.slice(6).map((d, i) => row(d, i + 6)).join('') + '</div>' +
        '<div class="gp-about"><i class="gp-about-ph"></i><div><b>Marea One</b><small>TideOS 4.2 · 存储 61.3 / 64 GB</small><small>电池健康 83% · 屏幕：左下角裂了</small></div></div><div class="gp-end">序列号 MR1-0417-KAI</div></div></div>'; },
    mount(c, node) { node.querySelectorAll('.gp-sl').forEach(sl => { const d = SDEF[+sl.dataset.k], at = e => { const r = sl.getBoundingClientRect(); setS(d, d.min + clamp((e.clientX - r.left) / r.width, 0, 1) * (d.max - d.min)); }; sl.addEventListener('pointerdown', e => { e.stopPropagation(); c.sel = +sl.dataset.k; at(e); }); sl.addEventListener('click', e => e.stopPropagation()); }); },
    adjust(d, dir) { const v = getS(d); if (d.type === 'sl') setS(d, v + dir * d.step); else if (d.type === 'tg') setS(d, dir > 0); else { const ix = d.opts.findIndex(o => String(o[0]) === String(v)); setS(d, d.opts[clamp(ix + dir, 0, d.opts.length - 1)][0]); } },
    act(a, v, c) { if (a === 'seg') { const [i, val] = v.split(':'), d = SDEF[+i], o = d.opts.find(x => String(x[0]) === val); c.sel = +i; setS(d, o[0]); } else if (a === 'set') { const d = SDEF[+v]; if (d.type === 'tg') setS(d, !getS(d)); else if (d.type === 'seg') { const ix = d.opts.findIndex(o => String(o[0]) === String(getS(d))); setS(d, d.opts[(ix + 1) % d.opts.length][0]); } } },
    key(code, c) { const d = SDEF[c.sel]; if (!d) return false; if (code === 'ArrowLeft') { this.adjust(d, -1); return true; } if (code === 'ArrowRight') { this.adjust(d, 1); return true; } return false; }
  };

  /* ------------------------------------------------------------------ tick + public API */
  function tick(dt) {
    if (!S.inited) return; S.t += dt; S.frame++;
    if (S.timers.length) { const due = S.timers.filter(x => x.t <= S.t); if (due.length) { S.timers = S.timers.filter(x => x.t > S.t); due.sort((a, b) => a.t - b.t).forEach(x => { try { x.fn(); } catch (e) { console.warn('GT.phone timer', e); } }); } }
    statusTick(dt); CAM.cool = Math.max(0, CAM.cool - dt);
    if (!S.open) { S.downT += dt; if (S.downT > 25) S.locked = true; if (S.peekT > 0) { S.peekT -= dt; if (S.peekT <= 0) { D.root.classList.remove('gp-peek'); hideBanner(); } } }
    else if (S.bannerT > 0) { S.bannerT -= dt; if (S.bannerT <= 0) hideBanner(); }
    feedTick(dt); if (S.live) liveTick(dt); walletPoll();
    if (CAM.want && S.t - CAM.wantT > .3) { CAM.want = 0; CAM.store(CAM.grab(S.opts.canvas || CAM.src || document.querySelector('canvas'))); }
    const c = cur(); if (S.open && c && APPS[c.app].tick) APPS[c.app].tick(dt, c);
  }
  const apps = { list: [] };
  const api = {
    init(opts) { Object.assign(S.opts, opts || {}); build();
      if (!S.hooked) { S.hooked = true; lastCash = GT.wallet.cash; try { GT.wallet.on(function () { walletPoll([].find.call(arguments, x => typeof x === 'string')); }); } catch (e) { /* foreign wallet without on() */ }
        try { if (GT.front && GT.front.onSettings) GT.front.onSettings(() => { if (onApp('settings')) refresh(); }); } catch (e) { /* optional */ }
        [['boss', 2700], ['mom', 1500], ['lie', 420]].forEach(([id, age]) => { const th = TH[id], m = th.msgs[th.msgs.length - 1]; S.notes.unshift({ id: ++noteId, from: th.name, text: m.text, app: 'messages', thread: id, t: -age, seen: false }); }); }
      return api; },
    open(app, arg) { build(); const was = S.open; if (app === 'gallery') { app = 'camera'; arg = 'gallery'; }
      S.open = true; S.downT = 0; if (S.peekT > 0 || D.root.classList.contains('gp-peek')) { S.peekT = 0; D.root.classList.remove('gp-peek'); hideBanner(); } D.root.classList.add('gp-up');
      if (app && APPS[app]) { S.stack.length = 0;
        if (app === 'lock') { S.stack.push({ app: 'lock', page: 'main', sel: -1 }); render(1); }
        else { S.locked = false; S.stack.push({ app: 'home', page: 'main', sel: Math.max(0, HOMEORD.indexOf(app)) });
          if (app === 'home') render(1); else if (app === 'messages') { nav('messages', 'list'); if (arg) nav('messages', 'thread', thr(arg).id); }
          else if (app === 'spume') { nav('spume', 'feed'); if (arg) nav('spume', 'post', arg === 'post' || arg === 'latest' ? (FEED.posts.find(p => p.ev) || FEED.posts[0]).id : +arg); }
          else if (app === 'camera') nav('camera', arg === 'gallery' ? 'gallery' : 'vf');
          else { nav(app); if (app === 'map' && arg) { const i = M.pins.findIndex(p => p.id === arg || p.name === arg); if (i >= 0) { M.sel = i; M.follow = false; M.cx = M.tx = M.pins[i].x; M.cz = M.tz = M.pins[i].z - 40 / M.zoom; } } } } }
      else { if (S.locked || !S.stack.length) { S.stack.length = 0; S.stack.push({ app: 'lock', page: 'main', sel: -1 }); } render(1); }
      D.screen.classList.remove('gp-sweep'); void D.screen.offsetWidth; D.screen.classList.add('gp-sweep');
      if (!was) { emit('open', { app: cur().app }); sfx('ui_tick'); } return api; },
    close() { if (!S.inited || !S.open) return api; const c = cur(); if (c && APPS[c.app].leave) APPS[c.app].leave(c); if (c && c.app === 'camera' && c.page === 'vf') S.stack.pop();
      S.open = false; S.downT = 0; D.root.classList.remove('gp-up', 'gp-cam'); CAM.sync(false); hideBanner(); emit('close', {}); sfx('ui_tick'); return api; },
    toggle() { return S.open ? api.close() : api.open(); },
    get isOpen() { return S.open; },
    notify, addMessage,
    setMap(provider) { S.mapProv = provider || null; return api; },
    onAction(cb) { if (typeof cb !== 'function') return () => {}; S.cbs.push(cb); return () => { const i = S.cbs.indexOf(cb); if (i >= 0) S.cbs.splice(i, 1); }; },
    update(dt, ctx) { if (!S.inited) return; S.extT = performance.now(); if (ctx) { S.ctx = ctx; const p = ctx.pos || ctx; if (p && typeof p.x === 'number' && typeof p.z === 'number') { S.player.x = p.x; S.player.z = p.z; } if (typeof ctx.h === 'number') S.player.h = ctx.h; } tick(Math.min(.25, Math.max(0, dt || 0))); },
    apps,
    captureFrame(canvas) { if (!S.inited) return false; canvas = canvas || S.opts.canvas || (GT.render && GT.render.renderer && GT.render.renderer.domElement) || null; if (!canvas) return false; CAM.src = canvas; CAM.lastCall = performance.now();
      if (CAM.want) { CAM.want = 0; CAM.store(CAM.grab(canvas)); return true; } if (onApp('scan')) SCAN.feed(canvas); return false; },
    hookRender() { const R = GT.render; if (!R || !R.frame) return false; if (R.frame._gtp) return true; const f = R.frame; R.frame = function () { const r = f.apply(this, arguments); try { api.captureFrame(R.renderer && R.renderer.domElement); } catch (e) { /* never break the frame */ } return r; }; R.frame._gtp = true; return true; },
    event: fireEvent,
    livestream(on) { build(); on = on === undefined ? !S.live : !!on; if (on === S.live) return on; S.live = on; D.root.classList.toggle('gp-liveon', on);
      if (on) { LIVE.viewers = 28 + rnd() * 30; LIVE.next = .3; LIVE.burst = ['来了来了', '第一！', '主播晚上好']; LIVE.surge = 20; D.chat.textContent = ''; chatLine('', '直播已开始 · 浪花会通知你的 ' + (300 + (rnd() * 400 | 0)) + ' 位粉丝', 'sys'); } emit('live', { on }); if (onApp('spume', 'feed')) refresh(); return on; },
    get isLive() { return S.live; },
    get heroState() { return S.open ? 'phone' : null; },
    camera: { get active() { return CAM.active; }, get selfie() { return CAM.selfie; }, get zoom() { return CAM.zoom; }, get fov() { return CAM.fov(); }, get photos() { return CAM.photos.slice(); }, shoot() { CAM.shoot(); } },
    viewCamera(pos, h, eye) { eye = eye || 1.62; const fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
      if (CAM.selfie) return { pos: [pos.x + fx * .62 + rx * .12, eye + .1, pos.z + fz * .62 + rz * .12], look: [pos.x, eye - .05, pos.z], fov: 70 / CAM.zoom };
      return { pos: [pos.x + fx * .38 + rx * .16, eye - .05, pos.z + fz * .38 + rz * .16], look: [pos.x + fx * 20, eye - .7, pos.z + fz * 20], fov: CAM.fov() }; },
    securityInfo(level) { const s = SEC[level] || SEC.modern; return { level: s.level, tier: s.lv, name: s.name, tool: s.tool, toolId: s.toolId, how: s.how, seconds: s.seconds, alarm: s.alarm, risk: s.risk }; },
    debt: { get owed() { return DEBT.owed; }, get total() { return DEBT.total; }, get payments() { return DEBT.pays.slice(); }, pay(n) { const ok = DEBT.pay(n); if (ok && (onApp('bank') || onApp('home'))) refresh(); return ok; } },
    get waypoint() { return S.way ? { x: S.way.x, z: S.way.z, name: S.way.name } : null; }, set waypoint(w) { S.way = w ? { x: w.x, z: w.z, name: w.name || placeNear(w.x, w.z, M.pins) } : null; },
    get threads() { return THORD.map(k => ({ id: k, name: TH[k].name, unread: TH[k].unread })); },
    _key(code) { onKey({ code, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }); }, _state: S
  };
  ORDER.forEach(id => { apps[id] = { id, name: NAMES[id], color: ACC[id], open: arg => api.open(id, arg), get unread() { return unreadOf(id); } }; apps.list.push(apps[id]); });
  GT.phone = api;

  /* ------------------------------------------------------------------ showcase: showcase.html?m=phone&app=…  (see header) */
  GT.showcase = GT.showcase || {};
  GT.showcase.phone = ({ scene, camera, T }) => {
    const Q = new URLSearchParams(location.search), world = Q.get('world') === '1', canvas = document.getElementById('c'), num = (k, d) => Q.get(k) !== null ? +Q.get(k) : d;
    let pos, h, car = null, hero = null;
    if (world) { for (const m of ['road', 'station', 'motel', 'hangouts', 'safehouse']) { try { if (GT[m] && GT[m].build) GT[m].build(scene); } catch (e) { console.warn('phone showcase: ' + m + '.build failed', e); } } pos = { x: num('px', 41.5), z: num('pz', -21) }; h = num('ph', .62); }
    else { pos = { x: 0, z: 0 }; h = 0; try { const k = GT.kit(); k.box('asphalt_worn', 80, .2, 80, 0, -.1, 0); k.box('concrete', 80, .15, 3, 0, .075, 14, { bevel: .02 }); k.box('curb_paint_yellow', 80, .16, .2, 0, .08, 12.4, { bevel: .02 }); k.box('stucco_cream', 30, 4.2, .4, 2, 2.1, 16, { bevel: .02 }); k.box('metal_painted_blue', 1.1, 1.3, .8, -6, .65, 13.4, { bevel: .03 });
        for (let i = 0; i < 5; i++) k.cyl('metal_painted_yellow', .08, .08, 1, -3 + i * 2.2, .5, 11.6, { seg: 12 }); k.decal('oil_stain', 2.4, 2.4, 2.4, .012, 5); k.decal('tire_marks', 2, 6, -1, .012, 3, .3); k.decal('crack', 3, 3, -4, .012, 6, 1); scene.add(k.build()); } catch (e) { console.warn(e); } }
    const fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
    try { if (GT.vehicles && Q.get('car') !== '0') { car = GT.vehicles.make(Q.get('kind') || 'sedan', { color: 0x9aa1a6, plate: '7KLM 204', seed: 3 }); car.group.position.set(pos.x + fx * 6.2 + rx * .9, 0, pos.z + fz * 6.2 + rz * .9); car.group.rotation.y = h + 1.15; scene.add(car.group); } } catch (e) { console.warn(e); }
    try { if (GT.hero && GT.hero.make && Q.get('hero') !== '0') { hero = GT.hero.make('kai'); hero.group.position.set(pos.x, 0, pos.z); hero.group.rotation.y = h; scene.add(hero.group); } } catch (e) { console.warn(e); hero = null; }
    const P = api.init({ canvas }); P.hookRender(); GT.wallet.add(num('cash', 1840), '便利店 · 找零');
    const ctx = { pos, h, mode: 'foot', speed: num('speed', 0), target: null }, app = Q.get('app'), sub = Q.get('sub'), at = num('at', 0), sched = [];
    if (Q.get('sec') !== 'none' && (Q.get('sec') || app === 'scan')) ctx.target = { kind: Q.get('kind') || 'sedan', plate: '7KLM 204', locked: Q.get('locked') !== '0', security: Q.get('sec') || 'modern' };
    if (Q.get('wp')) { const w = Q.get('wp').split(',').map(Number); P.waypoint = { x: w[0], z: w[1] }; }
    if (Q.get('wall')) { S.wall = +Q.get('wall'); paintWall(); }
    P.update(0, ctx);
    if (Q.get('live') === '1') P.livestream(true);
    const shots = num('shots', 0), wantGal = app === 'gallery';
    const latePost = app === 'spume' && sub === 'post';
    if (app) P.open(wantGal && shots ? 'camera' : app, latePost ? undefined : sub || undefined); else if (Q.get('lock') === '1') P.open('lock');
    if (Q.get('selfie') === '1') CAM.act('flip'); if (Q.get('zoom') && app === 'map') { M.zoom = M.tzoom = +Q.get('zoom'); } else if (Q.get('zoom')) CAM.setZoom(+Q.get('zoom'));
    if (Q.get('ev')) Q.get('ev').split(',').forEach((e, i) => sched.push([.2 + i * 1.5, () => P.event(e, { car: '红色肌肉车', n: 7, delay: Q.get('evd') !== null ? +Q.get('evd') : undefined })]));
    if (Q.get('pick') !== null) sched.push([.6, () => { const c = cur(); if (c && c.page === 'thread') { c.sel = +Q.get('pick'); doAct('reply', Q.get('pick'), c.node.querySelector('[data-i="' + Q.get('pick') + '"]')); } }]);
    if (Q.get('keys')) Q.get('keys').split(',').forEach((kname, i) => sched.push([.3 + i * .25, () => P._key(/^(Up|Down|Left|Right)$/.test(kname) ? 'Arrow' + kname : kname)]));
    if (Q.get('pay')) sched.push([.5, () => { P.debt.pay(+Q.get('pay')); }]);
    if (Q.get('msg')) sched.push([Math.max(0, at - .2), () => P.addMessage(Q.get('thread') || 'lie', { from: 'x', text: Q.get('msg') })]);
    sched.sort((a, b) => a[0] - b[0]); let st = 0; const run = () => { while (sched.length && sched[0][0] <= st) sched.shift()[1](); };
    for (; st < at; st += 1 / 30) { run(); P.update(1 / 30, ctx); }
    if (latePost) P.open('spume', 'post');
    if (Q.get('notify') === '1') { if (Q.get('ntype') === 'spume') P.event('chase', { delay: 0 }), P.update(.05, ctx); else P.addMessage('lie', { from: '阿烈', text: '哥 你到哪了 我好像看到巡防车了 也可能是出租车' }); }
    const camPos = [pos.x - fx * 2.5 + rx * .62, 1.72, pos.z - fz * 2.5 + rz * .62], camLook = [pos.x + fx * 6 + rx * .5, 1.25, pos.z + fz * 6 + rz * .5], baseFov = camera.fov;
    let f = 0, time = 0, shot = 0;
    return { cam: camPos, look: camLook, hours: 18.2, update(dt) { f++; time += dt; st += dt; run();
      if (shots && shot < shots && f > 1) { CAM.cool = 0; CAM.shoot(); shot++; } else if (shots && shot === shots && wantGal) { shot++; nav('camera', 'gallery'); if (sub === 'photo') nav('camera', 'photo', 0); }
      if (Q.get('dbg') === '1') document.getElementById('err').textContent = 'frames ' + f + '  t ' + time.toFixed(2);
      if (hero) { try { hero.group.visible = !CAM.active || CAM.selfie; hero.update(dt, { state: P.heroState || 'idle', speed: 0, turn: 0, lookYaw: 0, lookPitch: 0, t: time }); } catch (e) { if (f < 3) console.warn(e); } }
      if (CAM.active && !Q.get('cam')) { const v = P.viewCamera(pos, h, hero ? hero.height * .9 : 1.62); camera.position.set(v.pos[0], v.pos[1], v.pos[2]); camera.lookAt(v.look[0], v.look[1], v.look[2]); camera.fov = v.fov; camera.updateProjectionMatrix(); }
      else if (camera.fov !== baseFov && !CAM.active) { camera.fov = baseFov; camera.updateProjectionMatrix(); camera.position.set(camPos[0], camPos[1], camPos[2]); camera.lookAt(camLook[0], camLook[1], camLook[2]); }
      if (car && car.update) car.update(dt); P.update(dt, ctx); } };
  };
})();
