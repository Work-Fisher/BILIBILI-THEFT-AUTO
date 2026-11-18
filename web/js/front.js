/* front.js — BILIBILI THEFT AUTO 1: every 2D presentation layer (splash, loading art, menus, settings, letterbox, subtitles, opening credits, title card,
   mission card, phone, hints, credits roll). Pure DOM / CSS / canvas 2D. No game logic, no three.js scene access. Styles: css/front.css (auto-injected).
   Contract: SPEC-STORY.md  ->  GT.front (see the API block at the bottom of this file).
   Timing: everything runs on an internal clock (rAF) + CSS animations, so GT.front._seek(seconds) can fast-forward and freeze any screen for screenshots.
   Self-demo: showcase.html?m=front&screen=<splash|loading|menu|pause|settings|title|mission|fail|credits|roll|subs|phone|hint|loc|all>&at=<s>[&panel=0..4]
   Opening flow: splash() is the B STAR logo (canvas 2D, 4.4 s, any key skips after 0.9 s); the main menu reads 开始游戏 / 继续 / 设置 / 退出 over the game's own flyby.
   g7 (2026-11-17): free roam only — no story, no delivery rider: the posters show a car and a figure in the street, the order chip and the story credits are gone. (GT.opening hooks stay
   feature-detected; js/opening.js itself is archived.) Never put a // comment in the middle of a line in this file. */
(function () {
  'use strict';
  const GT = window.GT = window.GT || {}; GT.showcase = GT.showcase || {};
  const doc = document, Q = new URLSearchParams(location.search), SRC = (doc.currentScript && doc.currentScript.src) || '';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
  const h = (tag, cls, html) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* no real place names on screen (originality rule): dialect labels and lines written elsewhere with a real city in them are shown with this project's own river names */
  const np = s => typeof s === 'string' ? s.replace(/重庆话/g, '上江话').replace(/武汉话/g, '江城话').replace(/上海话/g, '下江话') : s, escp = s => esc(np(s));
  const sfx = n => { try { if (GT.audio && GT.audio.sfx) GT.audio.sfx(n); } catch (e) { /* audio not started yet */ } };

  /* ------------------------------------------------------------------ ld (2026-11-17): painted art, assets/art/*.jpg (16:9, 1672×942, about 0.4 MB each). The loading carousel, the gate and logo card and the end card
     use these; each picture starts loading (and decoding) the moment this file runs, before the gate is up. A picture that fails is left out; with none at all the coded posters (PANELS) come back.
     o = transform origin of the slow push-in (on the subject's face, so a zoom never pushes a head out of frame), y = which height is kept when a wide window crops the picture (%), kx / ky = the drift in % over one slide.
     Place names are this game's own. */
  const ARTDIR = (SRC ? SRC.replace(/js\/front\.js.*$/, '') : '') + 'assets/art/';
  const ART = [
    { f: 'load_boulevard', name: '海湾大道', tip: '路边停的车都能开走：走到车门边按 F 上车，再按 F 下车。', o: '75% 12%', y: 12, kx: -1.2, ky: .5 },
    { f: 'load_bay', name: '月湾', tip: '按 M 打开大地图，点商店图标可以直接导航。', o: '64% 66%', y: 50, kx: -1.4, ky: -.6 },
    { f: 'load_neon', name: '霓虹带', tip: '按 V 在第一人称和第三人称之间切换。', o: '80% 32%', y: 30, kx: -1, ky: .5 },
    { f: 'load_beach', name: '南滩', tip: 'W A S D 移动，Shift 跑步，空格跳。', o: '70% 20%', y: 18, kx: -1.3, ky: .6 },
    { f: 'load_chase', name: '高架', tip: '闯红灯和逆行会被警察记下来。离开他们的视线，等星星闪完就安全了。', o: '74% 50%', y: 50, kx: -1.5, ky: -.4 },
    { f: 'load_chinatown', name: '玉埠', tip: '左键出拳。路人被打倒会掉钱，走过去就能捡。', o: '78% 42%', y: 40, kx: -1.1, ky: .5 }
  ].map(a => { a.ok = false; a.done = false; a.url = ARTDIR + a.f + '.jpg';
    a.p = new Promise(res => { if (typeof Image !== 'function') { a.done = true; return res(false); } const im = a.img = new Image(), end = ok => { a.ok = ok; a.done = true; res(ok); };
      im.onload = () => { if (!(im.naturalWidth > 0)) return end(false); if (im.decode) im.decode().then(() => end(true), () => end(true)); else end(true); }; im.onerror = () => end(false); im.src = a.url; a.url = im.src; });
    return a; });
  const artBy = f => { const a = ART.find(x => x.f === f); return a && a.ok ? a : null; }, SPLASH_ART = 'load_bay';

  /* ------------------------------------------------------------------ stylesheet (self-injected when the page did not load it) */
  let cssReady = false; const cssWait = [];
  function ensureCss() {
    let link = doc.querySelector('link[href*="front.css"]');
    const done = () => { if (cssReady) return; cssReady = true; if (root) root.style.display = ''; cssWait.splice(0).forEach(f => f()); };
    if (!link) { link = doc.createElement('link'); link.rel = 'stylesheet'; const v = (SRC.match(/\?.*$/) || [''])[0];
      link.href = (SRC ? SRC.replace(/js\/front\.js.*$/, 'css/front.css') : 'css/front.css') + v; link.addEventListener('load', done); link.addEventListener('error', done); doc.head.appendChild(link); }
    else if (link.sheet) done(); else { link.addEventListener('load', done); link.addEventListener('error', done); }
    setTimeout(done, 4000);
  }

  /* ------------------------------------------------------------------ clock: timers + tickers that can be fast-forwarded and frozen */
  const CLK = { t: 0, frozen: false, seeking: false, timers: [], tickers: new Set(), last: 0, running: false };
  function after(ms, fn) { const o = { at: CLK.t + Math.max(0, ms), fn, dead: false }; CLK.timers.push(o); return o; }
  function cancel(o) { if (o) o.dead = true; return null; }
  const wait = ms => new Promise(r => after(ms, r));
  function step(dt) {
    CLK.t += dt;
    for (let guard = 0; guard < 500; guard++) { let best = -1; for (let i = 0; i < CLK.timers.length; i++) { const o = CLK.timers[i]; if (o.dead) { CLK.timers.splice(i--, 1); continue; } if (o.at <= CLK.t && (best < 0 || o.at < CLK.timers[best].at)) best = i; }
      if (best < 0) break; const o = CLK.timers.splice(best, 1)[0]; try { o.fn(); } catch (e) { console.error('[front] timer', e); } }
    CLK.tickers.forEach(f => { try { f(dt); } catch (e) { console.error('[front] ticker', e); } });
  }
  /* driven by rAF and by a timer: in a hidden tab or under headless virtual time rAF barely fires, and a stalled clock would leave callers' promises pending */
  function tick() { const now = performance.now(), dt = Math.min(1000, now - CLK.last); if (dt < 4) return; CLK.last = now; if (cssReady && !CLK.frozen && !CLK.seeking) step(dt); }
  function loop() { requestAnimationFrame(loop); tick(); }
  /** jump every front animation to `sec` seconds from now and freeze there (for screenshots). */
  async function seek(sec) {
    if (!cssReady) await new Promise(r => cssWait.push(r));
    CLK.seeking = true; const total = Math.max(0, sec * 1000), ST = 40; let done = 0;
    const adv = dt => { for (const a of doc.getAnimations()) { try { if (a.playState !== 'paused') a.pause(); a.currentTime = (+a.currentTime || 0) + dt; } catch (e) { /* finished */ } } };
    adv(0);
    while (done < total) { const dt = Math.min(ST, total - done); step(dt); await Promise.resolve(); adv(dt); done += dt; if ((done / ST) % 5 < 1) await new Promise(r => setTimeout(r, 0)); else await Promise.resolve(); }
    await new Promise(r => setTimeout(r, 0)); adv(0); CLK.frozen = true; CLK.seeking = false;
  }

  /* ------------------------------------------------------------------ events + settings */
  const LS = {};
  const on = (ev, cb) => { if (typeof cb !== 'function') return () => {}; (LS[ev] = LS[ev] || []).push(cb); return () => { const a = LS[ev], i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); }; };
  const emit = (ev, a, b) => { (LS[ev] || []).slice().forEach(cb => { try { cb(a, b); } catch (e) { console.error('[front] on(' + ev + ')', e); } }); };
  const KEY = 'sunsetheat.settings', DEF = { volume: .8, sens: 1, quality: 'high', resolution: 'auto', invertY: false, subtitles: true, radio: true };
  const clean = (k, v) => k === 'volume' ? clamp(+v || 0, 0, 1) : k === 'sens' ? clamp(+v || 1, .2, 3) : k === 'resolution' ? (v === 'native' ? 'native' : 'auto') : k === 'quality' ? (['low', 'med', 'high'].includes(v) ? v : 'high') : !!v;
  const store = Object.assign({}, DEF);
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); for (const k in DEF) if (k in s) store[k] = clean(k, s[k]); } catch (e) { /* private mode */ }
  const settings = {};
  for (const k in DEF) Object.defineProperty(settings, k, { enumerable: true, get: () => store[k], set: v => setSetting(k, v) });
  function setSetting(k, v) { v = clean(k, v); if (store[k] === v) return; store[k] = v; try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
    if (root) SET.refresh(); if (k === 'resolution' && GT.render) GT.render.resize(); if (k === 'subtitles' && !v) clearSubtitles(); emit('settings', settings, k); }

  /* ------------------------------------------------------------------ DOM */
  let root = null; const E = {}; const BUSY = {}; const modals = [];
  const LOGO = (() => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 25 : 60; d += (i ? 'L' : 'M') + (236 + Math.cos(a) * r).toFixed(1) + ' ' + (62 + Math.sin(a) * r).toFixed(1); }
    return '<svg viewBox="0 0 300 300"><polygon class="fs-ps" points="54,64 284,44 274,264 44,284"/><polygon class="fs-pl" points="40,50 270,30 260,250 30,270"/>' +
      '<g class="fs-b"><text x="150" y="236" text-anchor="middle" transform="skewX(-8) translate(30 0)" font-family="Arial Black, Impact, Helvetica, sans-serif" font-weight="900" font-size="250" fill="#fff" stroke="#0a0a0c" stroke-width="12" stroke-linejoin="round" paint-order="stroke">B</text></g>' +
      '<g class="fs-st"><path d="' + d + 'Z" fill="#ffd60a" stroke="#0a0a0c" stroke-width="10" stroke-linejoin="round"/></g></svg>'; })();
  const MARK = '<svg viewBox="0 0 150 120"><defs><linearGradient id="fsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb457"/><stop offset=".55" stop-color="#ff6c38"/><stop offset="1" stop-color="#e0356e"/></linearGradient><clipPath id="fsc"><rect x="0" y="0" width="150" height="58.5"/></clipPath></defs>' +
    '<g clip-path="url(#fsc)"><circle class="sun" cx="75" cy="62" r="36" fill="url(#fsg)"/></g><rect class="wl" x="8" y="61" width="134" height="2" fill="#f3e8d3"/>' +
    '<rect class="td" style="--i:0" x="34" y="71" width="70" height="2" fill="#f3e8d3" opacity=".8"/><rect class="td" style="--i:1" x="58" y="80" width="52" height="2" fill="#f3e8d3" opacity=".55"/><rect class="td" style="--i:2" x="50" y="89" width="30" height="2" fill="#f3e8d3" opacity=".32"/></svg>';
  const WM = cls => '<div class="f-wm ' + cls + '"><span class="a"><i>BILIBILI</i><b>THEFT AUTO</b></span><span class="b">1</span></div>';
  function init(rootEl) {
    if (root) return api;
    root = h('div'); root.id = 'gtf'; root.style.display = 'none';
    root.innerHTML =
      '<div class="f-fade"></div><div class="f-bar f-bar-t"></div><div class="f-bar f-bar-b"></div>' +
      '<div class="f-loc"><i></i><b></b><span></span></div><div class="f-obj"><i></i><span></span></div><div class="f-credits"></div>' +
      '<div class="f-hint"><span class="keys"></span><span class="t"></span></div><div class="f-sub"><em class="who"></em><span class="txt"></span></div>' +
      '<div class="f-phone"><div class="fp-head"><i class="fp-ico"></i><span>短信</span><em>现在</em></div><div class="fp-from"></div><div class="fp-text"></div></div>' +
      '<div class="f-skip"><svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="9"/><circle class="p" cx="11" cy="11" r="9"/></svg><span>按住 <span class="f-kbd">Enter</span> 跳过</span></div>' +
      '<div class="f-title"><div class="ft-scrim"></div><div class="ft-burst"></div><div class="ft-flash"></div><div class="ft-in">' + WM('ft-wm') + '<div class="ft-row"><i></i><div class="ft-ch"><span class="c"></span><b class="n"></b></div><i></i></div></div><div class="ft-slam"><div class="s-a"><span></span></div><div class="s-b"><span></span><b class="s-n"></b></div><div class="s-c"><i></i><span></span></div></div></div>' +
      '<div class="f-mission f-screen"><div class="fx-kick"></div><div class="fx-res"><span></span><div class="fx-rate"></div></div><div class="fx-rule"></div><div class="fx-title"></div><div class="fx-take"><small>到手</small><b></b></div><div class="fx-stats"></div><div class="fx-go"></div></div>' +
      '<div class="f-pause f-screen"><div class="fp-h"><small>BILIBILI THEFT AUTO 1</small><b>暂停</b></div><ul class="f-list"></ul><div class="f-keys"></div><div class="fm-corner"><b>维尔蒙港</b><span>自由漫游</span></div></div>' +
      '<div class="f-menu f-screen"><div class="fm-scrim"></div><div class="fm-head"><div class="fm-kick">B STAR 出品</div>' + WM('fm-wm') + '<div class="fm-tag">维尔蒙港 · 自由漫游</div></div><ul class="f-list"></ul><div class="fm-desc"></div><div class="f-keys"></div><div class="fm-corner"><b>维尔蒙港 · 玉埠</b><span>傍晚</span></div></div>' +
      '<div class="f-set"><div class="fs-h"><b>设置</b><span>更改会自动保存</span></div><div class="fs-rows"></div></div>' +
      '<div class="f-load f-screen"><div class="fl-stage"><div class="fl-panel"><img class="fl-art" alt="" draggable="false"><canvas></canvas><canvas></canvas><canvas></canvas></div><div class="fl-panel"><img class="fl-art" alt="" draggable="false"><canvas></canvas><canvas></canvas><canvas></canvas></div></div><div class="fl-shade"></div>' +
        '<div class="fl-top">' + WM('fl-wm') + '<div class="fl-idx"></div></div><div class="fl-cap"><div class="tag"></div><div class="name"></div><div class="line"></div></div>' +
        '<div class="fl-foot"><div class="fl-tip"><small>提示</small><span></span><em></em></div><div class="fl-bar"><i></i></div></div></div>' +
      '<div class="f-roll f-screen"><div class="fr-in"></div><div class="fr-skip"><span class="f-kbd">Esc</span> 跳过</div></div>' +
      '<div class="f-splash f-screen"><canvas class="fs-cv"></canvas><div class="fs-gate"><b>B<i>★</i>STAR</b><div class="fs-gate-bar"><i></i></div><div class="fs-gate-k">正在加载</div><small>键盘和鼠标操作 · 建议戴耳机</small></div>' +
        '<div class="fs-stage"><div class="fs-card"></div><div class="fs-logo">' + LOGO + '<div class="fs-word">B<i>★</i>STAR</div><div class="fs-sub">GAMES · 出品</div></div><div class="fs-flash"></div></div>' +
        '<div class="fs-line">本作所有画面与模型均由代码生成<small>没有一张贴图文件 · 没有一个模型文件 · 环境声与配音用了音频素材</small></div><div class="fs-skip">按任意键跳过</div></div>' +
      '<div class="f-grain"></div>';
    for (const k of ['fade', 'loc', 'obj', 'credits', 'hint', 'sub', 'phone', 'skip', 'title', 'mission', 'pause', 'menu', 'set', 'load', 'roll', 'splash']) E[k] = root.querySelector('.f-' + k);
    { const st = doc.createElement('style'); st.id = 'gtf-opening-css'; st.textContent = '#gtf .fs-cv{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:1}#gtf .f-splash.lg .fs-skip{opacity:1;mix-blend-mode:normal}' +
        '#gtf .f-item .gl{margin-left:1.4em;font-size:calc(11.5*var(--u));letter-spacing:.34em;color:rgba(243,232,211,.34);transition:color .3s;white-space:nowrap}#gtf .f-item.sel .gl{color:#ffd60a}#gtf .f-item.dis .gl{color:rgba(243,232,211,.16)}'; doc.head.appendChild(st); }
    root.style.setProperty('--grain', 'url(' + grainTile() + ')');
    (rootEl || doc.body).appendChild(root);
    ensureCss(); if (cssReady) root.style.display = '';
    addEventListener('keydown', onKeyDown, true); addEventListener('keyup', onKeyUp, true); addEventListener('blur', () => { SK.down = false; });
    E.splash.addEventListener('click', () => SPL.skip && SPL.skip()); E.roll.addEventListener('click', () => ROLL.skip && ROLL.skip()); E.mission.addEventListener('click', () => MIS.dismiss && MIS.dismiss());
    MENU.list = mkList(E.menu.querySelector('.f-list'), it => { E.menu.querySelector('.fm-desc').textContent = it.desc || ''; });
    PAUSE.list = mkList(E.pause.querySelector('.f-list'));
    const keys = '<span><span class="f-kbd">↑</span><span class="f-kbd">↓</span>选择</span><span><span class="f-kbd">Enter</span>确认</span><span><span class="f-kbd">Esc</span>返回</span>';
    E.menu.querySelector('.f-keys').innerHTML = keys; E.pause.querySelector('.f-keys').innerHTML = keys;
    SET.build();
    if (!CLK.running) { CLK.running = true; CLK.last = performance.now(); requestAnimationFrame(loop); setInterval(tick, 33); }
    return api;
  }
  function grainTile() { const c = doc.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), d = g.createImageData(256, 256), p = d.data; 
    for (let i = 0; i < p.length; i += 4) { const r = Math.random(), v = r < .5 ? 0 : 255, a = Math.abs(r - .5) * 2; p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = a * a * 70; } g.putImageData(d, 0, 0); return c.toDataURL(); }
  const grainy = () => { root.classList.toggle('grainy', !!(BUSY.splash || BUSY.loading || BUSY.menu || BUSY.pause || BUSY.mission || BUSY.roll || TITLE.on)); };
  function setBusy(k, v) { BUSY[k] = !!v; grainy(); }
  const unlock = () => { try { if (doc.pointerLockElement && doc.exitPointerLock) doc.exitPointerLock(); } catch (e) { /* ignore */ } };
  function pushModal(m) { const i = modals.indexOf(m); if (i >= 0) modals.splice(i, 1); modals.push(m); }
  function popModal(m) { const i = modals.indexOf(m); if (i >= 0) modals.splice(i, 1); }
  function showScreen(el, now) { el.classList.toggle('now', !!now); el.classList.add('on'); }
  function hideScreen(el) { if (!el.classList.contains('on')) return Promise.resolve(); el.classList.remove('now'); el.classList.remove('on'); return wait(620); }

  /* ------------------------------------------------------------------ keyboard */
  const SK = { shown: false, down: false, p: 0, fired: false };
  function onKeyDown(e) {
    const m = modals[modals.length - 1];
    if (m) { if (e.metaKey || e.ctrlKey || e.altKey || /^F\d+$/.test(e.key)) return; e.stopImmediatePropagation(); e.preventDefault(); if (!CLK.frozen) m.key(e); return; }
    if (SK.shown && e.code === 'Enter') { e.stopImmediatePropagation(); e.preventDefault(); if (!e.repeat) SK.down = true; }
  }
  function onKeyUp(e) { if (e.code === 'Enter' && SK.down) { SK.down = false; e.stopImmediatePropagation(); } }
  CLK.tickers.add(dt => { if (!SK.shown && SK.p === 0) return; const was = SK.p;
    SK.p = SK.shown && SK.down && !SK.fired ? Math.min(1, SK.p + dt / 800) : Math.max(0, SK.p - dt / 250);
    if (SK.p !== was) E.skip.querySelector('.p').style.strokeDashoffset = (56.55 * (1 - SK.p)).toFixed(2);
    if (SK.p >= 1 && !SK.fired) { SK.fired = true; SK.down = false; sfx('ui_ok'); emit('skip'); skipHint(false); } });
  function skipHint(show) { init(); show = !!show; if (show && !SK.shown) { SK.fired = false; SK.down = false; } SK.shown = show; E.skip.classList.toggle('on', show); }

  /* ------------------------------------------------------------------ list (main menu / pause) */
  function mkList(ul, onPick) {
    const L = { ul, items: [], sel: -1, locked: false,
      set(items, sel) { ul.innerHTML = ''; L.items = items; L.locked = false; L.sel = -1;
        items.forEach((it, i) => { const li = h('li', 'f-item' + (it.dis ? ' dis' : ''), '<span class="no">0' + (i + 1) + '</span><span class="lab">' + esc(it.label) + '</span>' + (it.gloss ? '<span class="gl">' + esc(it.gloss) + '</span>' : '')); li.style.setProperty('--i', i);
          li.addEventListener('mouseenter', () => L.pick(i)); li.addEventListener('click', () => { L.pick(i); L.go(); }); ul.appendChild(li); it.el = li; });
        L.pick(sel !== undefined ? sel : items.findIndex(it => !it.dis), true); },
      pick(i, quiet) { const it = L.items[i]; if (!it || it.dis || L.locked || i === L.sel) return; if (L.items[L.sel]) L.items[L.sel].el.classList.remove('sel'); L.sel = i; it.el.classList.add('sel'); if (onPick) onPick(it); if (!quiet) sfx('ui_tick'); },
      move(d) { const n = L.items.length; let i = L.sel; for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (!L.items[i].dis) break; } L.pick(i); },
      go() { const it = L.items[L.sel]; if (!it || it.dis || L.locked) return; if (L.armT && performance.now() < L.armT) return;   /* armT: a list that has only just appeared does not take a confirm yet (the key that skipped the film, pressed twice, used to start 接单) */ sfx('ui_ok'); const li = it.el; li.classList.remove('hit'); void li.offsetWidth; li.classList.add('hit'); setTimeout(() => li.classList.remove('hit'), 800); if (it.act) it.act(it); },
      key(e) { if (e.code === 'ArrowUp' || e.code === 'KeyW') L.move(-1); else if (e.code === 'ArrowDown' || e.code === 'KeyS') L.move(1); else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') { if (!e.repeat) L.go(); } else return false; return true; } };
    return L;
  }

  /* ------------------------------------------------------------------ settings panel */
  const SET = { open: false, sel: 0, rows: [], host: null,
    defs: [ { k: 'volume', label: '主音量', type: 'sl', min: 0, max: 1, stepv: .05, fmt: v => Math.round(v * 100) },
      { k: 'sens', label: '鼠标灵敏度', type: 'sl', min: .2, max: 3, stepv: .1, fmt: v => v.toFixed(1) },
      { k: 'resolution', label: '渲染分辨率', type: 'seg', opts: [['auto', '自动'], ['native', '原生（最高 4K）']] },
      { k: 'quality', label: '画质', type: 'seg', opts: [['low', '低'], ['med', '中'], ['high', '高']] },
      { k: 'invertY', label: '反转视角 Y 轴', type: 'tg' }, { k: 'subtitles', label: '字幕', type: 'tg' }, { k: 'radio', label: '车载电台', type: 'tg' }, { k: null, label: '返回', type: 'back' } ],
    build() { const box = E.set.querySelector('.fs-rows'); SET.rows = SET.defs.map((d, i) => {
        const r = h('div', 'f-row' + (d.type === 'back' ? ' back' : ''), '<span class="lab">' + d.label + '</span>' + (d.type === 'sl' ? '<div class="f-sl"><i></i><u></u></div><span class="val"></span>' : d.type === 'seg' ? '<div class="f-seg">' + d.opts.map(o => '<span data-v="' + o[0] + '">' + o[1] + '</span>').join('') + '</div>' : d.type === 'tg' ? '<div class="f-tg"><span></span><i></i></div>' : ''));
        r.addEventListener('mouseenter', () => SET.pick(i));
        if (d.type === 'sl') { const sl = r.querySelector('.f-sl'), at = ev => { const b = sl.getBoundingClientRect(), p = clamp((ev.clientX - b.left) / b.width, 0, 1); settings[d.k] = Math.round((d.min + p * (d.max - d.min)) / d.stepv) * d.stepv; };
          sl.addEventListener('pointerdown', ev => { sl.setPointerCapture(ev.pointerId); at(ev); sl.onpointermove = at; }); const end = () => { sl.onpointermove = null; }; sl.addEventListener('pointerup', end); sl.addEventListener('pointercancel', end); }
        else if (d.type === 'seg') r.querySelectorAll('.f-seg span').forEach(s => s.addEventListener('click', ev => { ev.stopPropagation(); settings[d.k] = s.dataset.v; sfx('ui_tick'); }));
        r.addEventListener('click', ev => { if (d.type === 'tg') { settings[d.k] = !settings[d.k]; sfx('ui_tick'); } else if (d.type === 'back') SET.hide(); else if (d.type === 'seg' && !ev.target.dataset.v) SET.adjust(1); });
        box.appendChild(r); return r; }); SET.refresh(); SET.pick(0); },
    refresh() { SET.defs.forEach((d, i) => { const r = SET.rows[i]; if (!r) return; const v = settings[d.k];
        if (d.type === 'sl') { r.querySelector('.f-sl').style.setProperty('--p', ((v - d.min) / (d.max - d.min) * 100).toFixed(1) + '%'); r.querySelector('.val').textContent = d.fmt(v); }
        else if (d.type === 'seg') r.querySelectorAll('.f-seg span').forEach(s => s.classList.toggle('on', s.dataset.v === v));
        else if (d.type === 'tg') { const t = r.querySelector('.f-tg'); t.classList.toggle('on', !!v); t.firstChild.textContent = v ? '开' : '关'; } }); },
    pick(i) { if (i === SET.sel && SET.rows[i].classList.contains('sel')) return; SET.rows.forEach((r, j) => r.classList.toggle('sel', j === i)); if (SET.open && i !== SET.sel) sfx('ui_tick'); SET.sel = i; },
    adjust(dir) { const d = SET.defs[SET.sel]; if (d.type === 'sl') settings[d.k] = Math.round((settings[d.k] + dir * d.stepv) / d.stepv) * d.stepv; else if (d.type === 'seg') { const ix = d.opts.findIndex(o => o[0] === settings[d.k]); settings[d.k] = d.opts[clamp(ix + dir, 0, d.opts.length - 1)][0]; } else if (d.type === 'tg') settings[d.k] = dir > 0; sfx('ui_tick'); },
    key(e) { const n = SET.rows.length, d = SET.defs[SET.sel];
      if (e.code === 'Escape' || e.code === 'Backspace') SET.hide(); else if (e.code === 'ArrowUp' || e.code === 'KeyW') SET.pick((SET.sel + n - 1) % n); else if (e.code === 'ArrowDown' || e.code === 'KeyS') SET.pick((SET.sel + 1) % n);
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') SET.adjust(-1); else if (e.code === 'ArrowRight' || e.code === 'KeyD') SET.adjust(1);
      else if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) { if (d.type === 'back') SET.hide(); else if (d.type === 'tg') { settings[d.k] = !settings[d.k]; sfx('ui_tick'); } else if (d.type === 'seg') { const ix = d.opts.findIndex(o => o[0] === settings[d.k]); settings[d.k] = d.opts[(ix + 1) % d.opts.length][0]; sfx('ui_tick'); } } },
    show(parent) { init(); if (SET.open) return; SET.open = true; SET.parent = parent || null; if (parent) parent.classList.add('sub'); SET.pick(0); E.set.classList.add('on'); E.set.style.top = parent === E.pause ? 'calc(150 * var(--u))' : ''; pushModal(SET); setBusy('settings', true); },
    hide() { if (!SET.open) return; SET.open = false; sfx('ui_tick'); if (SET.parent) SET.parent.classList.remove('sub'); E.set.classList.remove('on'); popModal(SET); setBusy('settings', false); } };

  /* the menu's sunset grade: one full-screen gradient blended over the 3D picture (soft-light), a sibling of the canvas so it blends with it; indigo at the top, pink in the middle, orange at the horizon */
  let GRADE = null;
  function grade(on) { if (!GRADE) { if (!on) return; GRADE = h('div'); GRADE.id = 'g6-grade'; GRADE.style.cssText = 'position:fixed;inset:0;z-index:2;pointer-events:none;opacity:0;transition:opacity 1.2s ease;mix-blend-mode:soft-light;background:linear-gradient(180deg,#4a22c8 0%,#b03ad0 22%,#ff4f9a 44%,#ff8a3d 66%,#ffd27a 100%)'; doc.body.appendChild(GRADE); void GRADE.offsetWidth; } GRADE.style.opacity = on ? '.22' : '0'; }
  /* ------------------------------------------------------------------ main menu */
  const MENU = { on: false, o: {}, list: null,
    key(e) { if (MENU.list.key(e)) return; },
    show(o) { init(); o = MENU.o = o || {}; unlock();
        /* 接单 / 返工 / 装备整理 / 收摊. With js/opening.js loaded, starting a story goes through its payslip loading screen and wake-up; the backdrop is its courtyard in the rain. */
      const OP = GT.opening || null, saved = (() => { try { const v = JSON.parse(localStorage.getItem('bta1.story') || 'null'); return !!(v && v.ch1); } catch (err) { return false; } })(), canC = o.canContinue !== undefined ? !!o.canContinue && typeof o.onContinue === 'function' : (saved && typeof o.onContinue === 'function');
      const begin = fn => () => { if (typeof fn !== 'function') return; MENU.list.locked = true; try { if (OP && OP.newStory) OP.newStory(fn); else fn(); } catch (err) { MENU.list.locked = false; console.error('[front] menu callback', err); } };
      MENU.list.set([ { label: '开始游戏', desc: '从街头开始 · 身上 $500', act: begin(o.onNew) }, { label: '继续', desc: canC ? '从上次的进度继续' : '还没有存档', dis: !canC, act: begin(o.onContinue) },
        ...(GT.demo && GT.demo.replay && GT.demo.ok ? [{ label: '观看预告', desc: '维尔蒙港 · 72 秒演示片 · 任意键跳过', act: () => { MENU.list.locked = true; try { GT.demo.replay(); } catch (err) { MENU.list.locked = false; console.error('[front] demo', err); } } }] : []),   /* DM: js/demo.js plays the opening film again and comes back to this menu */
        { label: '设置', desc: '音量 · 灵敏度 · 画质 · 字幕', act: () => { SET.show(E.menu); if (typeof o.onSettings === 'function') o.onSettings(); } },
        { label: '退出', desc: '结束游戏', act: () => { const QF = typeof o.onQuit === 'function' ? o.onQuit : OP && OP.quit ? OP.quit : null; if (QF) { const QM = { key(e) { if (!e.repeat && h && h.back) h.back(); } }, h = QF(() => popModal(QM)); pushModal(QM); }   /* the shutter is a modal of its own: any key lifts it. o.onQuit(onBack) -> { back() } (js/cngame.js), the same contract as the old GT.opening.quit */
          else { MENU.list.locked = true; creditsRoll().then(() => { MENU.list.locked = false; }); } } } ]);
      if (OP && OP.menuScene) { try { OP.menuScene(true); } catch (err) { console.error('[front] menuScene', err); } }
      MENU.list.armT = performance.now() + 1500;   /* arrows move at once; Enter / Space / a click confirm only after the menu has been on screen for a second and a half */
      MENU.on = true; setBusy('menu', true); pushModal(MENU); showScreen(E.menu, BUSY.splash); grade(true); return api.menu; },
    hide() { if (!MENU.on) return Promise.resolve(); MENU.on = false; grade(false); if (SET.open && SET.parent === E.menu) SET.hide(); popModal(MENU); return hideScreen(E.menu).then(() => { if (!MENU.on) { setBusy('menu', false); const OP = GT.opening; if (OP && OP.menuScene) { try { OP.menuScene(false); } catch (err) { /* optional */ } } } }); } };

  /* ------------------------------------------------------------------ pause */
  const PAUSE = { on: false, o: {}, list: null,
    key(e) { if (e.code === 'Escape' || e.code === 'KeyP') { if (!e.repeat) PAUSE.done('onResume'); return; } PAUSE.list.key(e); },
    done(k) { const fn = PAUSE.o[k]; PAUSE.hide(); if (typeof fn === 'function') fn(); },
    show(o) { init(); PAUSE.o = o || {}; unlock();
      PAUSE.list.set([ { label: '继续', act: () => PAUSE.done('onResume') }, ...(typeof (o && o.onMap) === 'function' ? [{ label: '地图', act: () => PAUSE.done('onMap') }] : []),
        ...(o && o.onDayPart ? [{ label: '切换时段 · ' + o.dayPart, gloss: 'U', act: it => { it.el.querySelector('.lab').textContent = '切换时段 · ' + o.onDayPart(); } }] : []),
        { label: '重新开始', act: () => PAUSE.done('onRestart') }, { label: '设置', act: () => SET.show(E.pause) }, { label: '回到主菜单', act: () => PAUSE.done('onMenu') } ]);
      const was = PAUSE.on; PAUSE.on = true; setBusy('pause', true); pushModal(PAUSE); E.pause.style.transitionDuration = '.25s'; showScreen(E.pause); if (!was) emit('pause'); return api.pause; },
    hide() { if (!PAUSE.on) return Promise.resolve(); PAUSE.on = false; if (SET.open && SET.parent === E.pause) SET.hide(); popModal(PAUSE); E.pause.classList.remove('on'); emit('resume'); return wait(260).then(() => { if (!PAUSE.on) setBusy('pause', false); }); } };

  /* ------------------------------------------------------------------ splash: the B STAR card (g6)
     A flat sunset over the city (poster ①): the sky is already there behind the gate; on the click the tower blocks and the street rise into frame, the sun climbs a little,
     and the words B★STAR land as solid white letters with a hard indigo drop. 4.4 seconds on one 2D canvas, driven by the front clock (so _seek() can freeze any frame).
     The sting is synthesised in its own short-lived context: a warm chord swelling in and three plucked notes on the landing. */
  const LOGO_LEN = 4.4, LAND = .95;
  function logoSting() { try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC || CLK.seeking) return null; const ac = new AC(), t = ac.currentTime + .06, out = ac.createGain(), lp = ac.createBiquadFilter();
      out.gain.value = .5 * (store.volume !== undefined ? store.volume : .8); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(3400, t + 1.3); lp.connect(out); out.connect(ac.destination);
      const note = (f, at, dur, g0, type, a) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(g0, at + (a || .02)); g.gain.exponentialRampToValueAtTime(.0001, at + dur); o.connect(g); g.connect(lp); o.start(at); o.stop(at + dur + .05); };
      for (const f of [146.8, 220, 293.7, 370, 440]) { note(f, t, 3.9, .07, 'sawtooth', .9); note(f * 1.005, t, 3.9, .05, 'sawtooth', 1.1); }
      note(73.4, t + LAND, .9, .5, 'sine', .01); [[587.3, 0], [740, .13], [880, .26], [1174.7, .42]].forEach(([f, d]) => { note(f, t + LAND + d, 1.5, .16, 'triangle', .008); note(f * 2, t + LAND + d, .7, .04, 'sine', .008); });
      const kill = setTimeout(() => { try { ac.close(); } catch (e) { /* closed */ } }, 6500);
      return { stop() { try { out.gain.setTargetAtTime(0, ac.currentTime, .06); clearTimeout(kill); setTimeout(() => { try { ac.close(); } catch (e) { /* closed */ } }, 400); } catch (e) { /* closed */ } } }; } catch (e) { return null; } }
  const LG = { cv: null, g: null, W: 0, H: 0, gl: null, L: null, on: false, t0: 0 };
  const eob = u => { u = clamp(u, 0, 1); const c = 1.70158; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); }, eoc = u => 1 - Math.pow(1 - clamp(u, 0, 1), 3);
  function logoBuild() {
    const cv = LG.cv = E.splash.querySelector('.fs-cv'); if (!cv) return false; const dpr = Math.min(1.5, window.devicePixelRatio || 1), W = LG.W = Math.max(640, Math.round(innerWidth * dpr)), H = LG.H = Math.max(360, Math.round(innerHeight * dpr)); cv.width = W; cv.height = H; LG.g = cv.getContext('2d');
    /* ld: the painted bay (ART) behind the gate and under the words; the three coded poster layers only when that picture did not load */
    const A = artBy(SPLASH_ART); LG.art = A ? A.img : null;
    LG.L = A ? null : [0, 1, 2].map(i => { const c = doc.createElement('canvas'); c.width = W; c.height = H; poster(c, 0, [i]); return c; }); LG.U = Math.min(H, W * .5625); LG.gl = true; logoDraw(0); return true;
  }
  function logoDraw(t) {
    const g = LG.g, W = LG.W, H = LG.H, U = LG.U; if (!g || !(LG.L || LG.art)) return; g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    if (LG.art) { /* one slow push-in from the click to the cut, and a soft indigo pool where the words land */ const im = LG.art, iw = im.naturalWidth || 1672, ih = im.naturalHeight || 942, k = eoc(t / LOGO_LEN), s = Math.max(W / iw, H / ih) * (1.02 + .06 * k), w = iw * s, hh = ih * s;
      g.drawImage(im, (W - w) * .5 - W * .012 * k, (H - hh) * .5 + H * .008 * k, w, hh);
      const gr = g.createRadialGradient(W * .5, H * .36, 0, W * .5, H * .36, Math.max(W, H) * .62); gr.addColorStop(0, 'rgba(20,9,43,.4)'); gr.addColorStop(.5, 'rgba(20,9,43,.16)'); gr.addColorStop(1, 'rgba(20,9,43,.34)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    else { const z = 1 + .035 * clamp(t / LOGO_LEN, 0, 1), lay = (c, dy, zz) => { const w = W * zz, hh = H * zz; g.drawImage(c, (W - w) / 2, (H - hh) * .9 + dy, w, hh); };
      lay(LG.L[0], -H * .03 * eoc(t / 2.4), z + .04); lay(LG.L[1], 0, z + .01); lay(LG.L[2], H * 1.05 * (1 - eoc((t - .1) / .9)), z + .03); }
    /* the words */ const k = eob((t - LAND) / .34), a = clamp((t - LAND) / .12, 0, 1); if (a > 0) { const fs = U * .25, cx = W / 2, cy = H * .36, sh = fs * .05; g.save(); g.translate(cx, cy); g.scale(1.7 - .7 * k, 1.7 - .7 * k); g.globalAlpha = a; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      const font = 'italic 900 ' + fs.toFixed(1) + 'px "Avenir Next Condensed","DIN Condensed",Impact,"Arial Narrow",sans-serif', sfont = '900 ' + (fs * .62).toFixed(1) + 'px "Arial Black","Helvetica Neue",Arial,sans-serif'; g.font = font; const wB = g.measureText('B').width, wS = g.measureText('STAR').width; g.font = sfont; const wX = g.measureText('★').width, gap = fs * .05, tot = wB + wX + wS + gap * 2; let x = -tot / 2;
      const put = (txt, f, col, dy) => { g.font = f; g.fillStyle = '#2b1650'; g.fillText(txt, x + sh, sh * 1.1 + (dy || 0)); g.fillStyle = col; g.fillText(txt, x, dy || 0); };
      put('B', font, '#fff'); x += wB + gap; put('★', sfont, '#ffd23f', -fs * .1); x += wX + gap; put('STAR', font, '#fff');
      const sa = clamp((t - LAND - .35) / .3, 0, 1); if (sa > 0) { g.globalAlpha = a * sa; const ss = fs * .13; g.font = '800 ' + ss.toFixed(1) + 'px "PingFang SC","Hiragino Sans GB","Helvetica Neue",sans-serif'; g.textAlign = 'center'; const txt = 'G A M E S   出 品', tw = g.measureText(txt).width + ss * 2.2; g.fillStyle = '#2b1650'; g.fillRect(-tw / 2 + sh * .6, fs * .2 + sh * .6, tw, ss * 1.9); g.fillStyle = '#ffd23f'; g.fillRect(-tw / 2, fs * .2, tw, ss * 1.9); g.fillStyle = '#2b1650'; g.fillText(txt, 0, fs * .2 + ss * 1.38); }
      g.restore(); }
    if (t > LAND && t < LAND + .14) { g.globalAlpha = .5 * (1 - (t - LAND) / .14); g.fillStyle = '#fff6dc'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    if (t > LOGO_LEN - .45) { g.globalAlpha = clamp((t - (LOGO_LEN - .45)) / .4, 0, 1); g.fillStyle = '#14092b'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  }
  CLK.tickers.add(() => { if (!LG.on) return; logoDraw(clamp((CLK.t - LG.t0) / 1000, 0, LOGO_LEN + 1)); });
  /* splash({gate: true}): the block is built behind a "click to start" gate (a browser plays no sound before a gesture, and building would stutter the logo); the returned promise carries progress(v, text) and ready().
     Then the logo above. Any key or click skips it once it has run for 0.9 s. */
  const SPL = { p: null, skip: null,
    key(e) { if (!e.repeat && SPL.skip) SPL.skip(); },
    run(o) { init(); if (SPL.p) return SPL.p; o = o || {}; const el = E.splash; let timers = [], over = false, res, t0 = 0, started = false, ready = !o.gate, snd = null;
      const HS = ['h1', 'h2', 'h3', 'h4', 'h5', 'lg'], bar = el.querySelector('.fs-gate-bar i'), key = el.querySelector('.fs-gate-k');
      setBusy('splash', true); el.classList.remove('gate', 'rdy', ...HS); showScreen(el, true); pushModal(SPL);
      const finish = () => { if (over) return; over = true; timers.forEach(cancel); SPL.skip = null; popModal(SPL); if (snd && CLK.t - t0 < LOGO_LEN * 1000 - 100) snd.stop(); res();
        after(80, () => { hideScreen(el).then(() => { setBusy('splash', false); SPL.p = null; LG.on = false; el.classList.remove('gate', 'rdy', ...HS); }); }); };
      const size = () => innerWidth + 'x' + innerHeight + '@' + (window.devicePixelRatio || 1); setTimeout(() => { if (!started && !over) pre(); }, 30); const pre = () => { if (started || over || LG.pre === size()) return; const SA = ART.find(a => a.f === SPLASH_ART); if (SA && !SA.done) { SA.p.then(pre); return; }   /* ld: the gate keeps its plain sunset until the painted bay has decoded, then the picture fades in under it */
        try { LG.pre = logoBuild() ? size() : null; if (LG.pre && LG.art && el.classList.contains('gate') && LG.cv.animate && !CLK.seeking) LG.cv.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: 'ease-out' }); } catch (e) { LG.pre = null; } };
      const start = () => { if (started || !ready) return; started = true; t0 = CLK.t; el.classList.remove('gate', 'rdy'); let ok = false; try { ok = LG.pre === size() && !!LG.gl ? true : logoBuild(); } catch (e) { console.error('[front] logo', e); } LG.pre = null;
        if (ok) { LG.t0 = t0; LG.on = true; el.classList.add('lg'); try { logoDraw(0); } catch (e) { console.error('[front] logo', e); LG.on = false; } snd = logoSting(); timers.push(after(LOGO_LEN * 1000, finish)); } else timers.push(after(300, finish));
        SPL.skip = () => { if (CLK.t - t0 > 900) finish(); }; };
      const p = SPL.p = new Promise(r => { res = r; });
      p.progress = (v, t) => { if (started) return; bar.style.transform = 'scaleX(' + clamp(+v || 0, 0, 1).toFixed(3) + ')'; };   /* pt1: the gate shows no bar and no step name of its own while loading — js/cngame.js's bottom line carries "正在加载 · <district> n%" */
      p.ready = () => { if (ready) return; /* the film's warm-up pass (js/cntrailer.js prepare: every cut's hour and view drawn once) finishes behind the gate before the gate opens */ const W = window.GT && ((GT.demo && GT.demo.state) || (GT.cntrailer && GT.cntrailer.state)); if (W && W.warming && (p._w = (p._w || 0) + 1) < 200) { setTimeout(p.ready, 100); return; } ready = true; bar.style.transform = 'scaleX(1)'; key.textContent = '按任意键开始'; el.classList.add('rdy'); setTimeout(pre, 60); };
      if (o.gate) { el.classList.add('gate'); SPL.skip = start; } else start();
      return p; } };

  /* ------------------------------------------------------------------ loading screen */
  const TIPS = ['W A S D 移动，Shift 跑步，空格跳。', '走到车旁按 F 上车，再按 F 下车。', '按 V 在第一人称和第三人称之间切换。', '按 M 打开大地图，点商店图标可以直接导航。', '打人、抢车、开枪被人看见会招来警察，星越多追得越紧。', '被追的时候离开对方视线，等星星闪完就安全了。', '左键出拳。路人被打倒会掉钱。', '按 Esc 暂停，可以调音量、灵敏度和画质。'];
  /* ld: the deck is the painted pictures that loaded (ART); with none of them it is the three coded posters (PANELS). One picture every 6.6 s with a slow push-in (css fl-kb), the old wipe between them;
     on screen only the small wordmark, the place name, one tip that changes with the picture, and the bar. */
  const LOAD = { on: false, tips: TIPS, own: false, idx: 0, n: 0, slot: 0, tPanel: null, tTip: null, p: 0, order: null,
    deck() { const A = ART.filter(a => a.ok); return A.length ? A : PANELS; },
    show(o) { init(); o = o || {}; LOAD.own = Array.isArray(o.tips) && o.tips.length > 0; LOAD.tips = LOAD.own ? o.tips : TIPS; const was = LOAD.on; LOAD.on = true; setBusy('loading', true); showScreen(E.load, BUSY.splash || !!o.instant);
      if (was) return api.loading; LOAD.progress(0, ''); LOAD.n = 0; const D = LOAD.deck(); LOAD.idx = o.panel !== undefined ? ((o.panel | 0) % D.length + D.length) % D.length : 0; LOAD.hold = o.panel !== undefined && !!o.hold;
      LOAD.slot = 0; LOAD.swap(true); return api.loading; },
    swap(first) { if (!LOAD.on) return; const D = LOAD.deck(), ix = (LOAD.idx % D.length + D.length) % D.length, P = D[ix], slots = E.load.querySelectorAll('.fl-panel'), cur = slots[LOAD.slot], old = slots[1 - LOAD.slot], cap = E.load.querySelector('.fl-cap'), tip = E.load.querySelector('.fl-tip span');
      if (P.img) { const im = cur.querySelector('.fl-art'); if (im.getAttribute('src') !== P.url) im.src = P.url; cur.dataset.k = 'art'; cur.style.setProperty('--ko', P.o); cur.style.setProperty('--kp', '50% ' + P.y + '%'); cur.style.setProperty('--kx', P.kx + '%'); cur.style.setProperty('--ky', P.ky + '%'); }
      else { cur.dataset.k = 'cv'; renderPanel(P, cur); }
      old.className = 'fl-panel' + (first ? '' : ' out'); cur.className = 'fl-panel'; void cur.offsetWidth; cur.className = 'fl-panel in' + (first ? ' first' : '');
      const put = () => { cap.querySelector('.tag').textContent = P.img ? '维尔蒙港' : P.tag; cap.querySelector('.name').textContent = P.name; cap.querySelector('.line').textContent = ''; cap.className = 'fl-cap'; void cap.offsetWidth; cap.className = 'fl-cap go';
        tip.textContent = !LOAD.own && P.tip ? P.tip : LOAD.tips[LOAD.n % LOAD.tips.length]; tip.classList.remove('bye'); LOAD.n++;
        E.load.querySelector('.fl-idx').innerHTML = '<b>' + String(ix + 1).padStart(2, '0') + '</b> / ' + String(D.length).padStart(2, '0'); };
      if (first) put(); else { cap.classList.add('bye'); tip.classList.add('bye'); after(320, put); after(1250, () => { if (old.classList.contains('out')) old.className = 'fl-panel'; }); }
      LOAD.slot = 1 - LOAD.slot; if (!LOAD.hold) { LOAD.idx = ix + 1; LOAD.tPanel = after(6600, () => LOAD.swap(false)); } },
    progress(p, label) { init(); LOAD.p = clamp(+p || 0, 0, 1); E.load.querySelector('.fl-bar i').style.transform = 'scaleX(' + LOAD.p.toFixed(4) + ')';
      const em = E.load.querySelector('.fl-tip em'); if (label !== undefined) LOAD.label = label; em.innerHTML = esc(LOAD.label || '正在加载') + '<b>' + Math.round(LOAD.p * 100) + '%</b>'; return api.loading; },
    /* hide(ms): fade out over ms (default 900); with ms given the busy flag drops at once (the caller is already handing over to play) */
    hide(ms) { if (!LOAD.on) return Promise.resolve(); LOAD.on = false; LOAD.tPanel = cancel(LOAD.tPanel); LOAD.tTip = cancel(LOAD.tTip);
      E.load.style.transitionDuration = (ms === undefined ? .9 : Math.max(0, +ms || 0) / 1000) + 's'; if (ms !== undefined) setBusy('loading', false);
      return hideScreen(E.load).then(() => wait(300)).then(() => { if (LOAD.on) return; setBusy('loading', false); E.load.querySelectorAll('.fl-panel').forEach(s => { s.className = 'fl-panel'; s.querySelectorAll('canvas').forEach(c => { c.width = c.height = 0; }); }); }); } };
  /* ld: js/cngame.js has a loading screen of its own (.cn-load: a coded purple skyline and its captions). While it is up, this carousel is shown in its place and copies its bar and label;
     css/front.css hides .cn-load under body.g6-ld. ?auto=load&panel=<n> holds picture n. */
  const CNL = { el: null, on: false };
  function cnlSync() { const el = CNL.el; if (!el) return; const on = el.classList.contains('on');
    if (on && !CNL.on) { CNL.on = true; const pn = Q.get('auto') === 'load' && Q.get('panel') !== null ? +Q.get('panel') : undefined; LOAD.show({ instant: true, panel: pn, hold: pn !== undefined }); }
    else if (!on && CNL.on) { CNL.on = false; LOAD.hide(700); }
    if (CNL.on) { const bi = el.querySelector('.cl-bar i'), em = el.querySelector('.cl-tip em'), m = bi && /scaleX\(([\d.]+)\)/.exec(bi.style.transform || ''), lab = em ? em.textContent.replace(/\s*\d+%\s*$/, '').trim() : ''; LOAD.progress(m ? +m[1] : LOAD.p, lab || undefined); } }
  function cnlWatch() { if (CNL.el) return true; const el = doc.querySelector('.cn-load'); if (!el) return false; CNL.el = el; init(); doc.body.classList.add('g6-ld');
    new MutationObserver(() => { try { cnlSync(); } catch (e) { console.error('[front] cn-load', e); } }).observe(el, { attributes: true, attributeFilter: ['class', 'style'], childList: true, characterData: true, subtree: true }); cnlSync(); return true; }
  function cnlBoot() { if (!doc.body) { addEventListener('DOMContentLoaded', cnlBoot, { once: true }); return; } if (cnlWatch()) return; const mo = new MutationObserver(() => { try { if (cnlWatch()) mo.disconnect(); } catch (e) { mo.disconnect(); } }); mo.observe(doc.body, { childList: true }); }
  try { cnlBoot(); } catch (e) { /* not in a page */ }
  function renderPanel(P, slot) { const cs = slot.querySelectorAll('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1), W = clamp(Math.round(innerWidth * dpr * 1.1 / 16) * 16, 1280, 2240), H = Math.round(W * 9 / 16);
    for (let i = 0; i < 3; i++) { const c = cs[i]; c.width = W; c.height = H; const g = c.getContext('2d'); g.setTransform(W / 1600, 0, 0, W / 1600, 0, 0); g.lineJoin = g.lineCap = 'round';
      try { if (P.layers[i]) P.layers[i](g, W / 1600); } catch (e) { console.error('[front] panel ' + P.name, e); } } }

  /* ------------------------------------------------------------------ letterbox, fade */
  function letterbox(onv, ms) { init(); ms = ms === undefined ? 600 : Math.max(0, +ms || 0); root.querySelectorAll('.f-bar').forEach(b => { b.style.transitionDuration = ms + 'ms'; }); root.classList.toggle('lb', !!onv); doc.body.classList.toggle('cine', !!onv); }
  const FADE = { v: 0 };
  function fade(v, ms) { init(); v = clamp(v === true ? 1 : +v || 0, 0, 1); ms = ms === undefined ? 500 : Math.max(0, +ms || 0); FADE.v = v; E.fade.style.transition = ms ? 'opacity ' + ms + 'ms ease-in-out' : 'none'; void E.fade.offsetWidth; E.fade.style.opacity = v; return wait(ms); }

  /* ------------------------------------------------------------------ subtitles (queued) */
  const SUB = { q: [], cur: null, t: null };
  const vlen = s => { let n = 0; for (const ch of String(s)) n += ch.charCodeAt(0) > 0x2e7f ? 1 : .52; return n; };
  function splitLine(text) { text = String(text); if (vlen(text) <= 62) return [text]; const out = []; let cur = '';
    for (const part of text.split(/(?<=[。！？!?…；;])/)) { if (cur && vlen(cur + part) > 62) { out.push(cur); cur = part; } else cur += part; } if (cur) out.push(cur);
    return out.flatMap(s => { if (vlen(s) <= 66) return [s]; const m = []; let c = ''; for (const part of s.split(/(?<=[，,、])/)) { if (c && vlen(c + part) > 60) { m.push(c); c = part; } else c += part; } if (c) m.push(c); return m; }); }
  function subtitle(who, text, seconds) { init(); who = np(who); text = np(text); if (text === undefined || text === null || text === '') return Promise.resolve();
    const parts = splitLine(text), total = vlen(text), ps = [], amb = SUB.amb > 0;
    /* an ambient line (street chatter, see ambient() below) never waits behind another ambient line: the ones still queued are dropped and the one on screen is cut. Story lines are untouched and still play in order. */
    if (amb) { for (let i = SUB.q.length - 1; i >= 0; i--) if (SUB.q[i].amb) SUB.q.splice(i, 1)[0].res(); if (SUB.cur && SUB.cur.amb) { SUB.t = cancel(SUB.t); const c = SUB.cur; SUB.cur = null; c.res(); } }
    parts.forEach(p => { const sec = seconds > 0 ? seconds * (vlen(p) / total) : clamp(1.3 + vlen(p) * .17, 1.9, 7.5); ps.push(new Promise(res => SUB.q.push({ who: who || '', text: p, ms: sec * 1000, res, amb }))); });
    if (!SUB.cur) subNext(); return Promise.all(ps).then(() => {}); }
  function subNext() { const s = SUB.cur = SUB.q.shift() || null, el = E.sub; if (!s) { el.classList.remove('on'); return; }
    if (!settings.subtitles) { SUB.t = after(s.ms, () => { s.res(); subNext(); }); return; }
    el.querySelector('.who').textContent = s.who; el.querySelector('.txt').textContent = s.text; el.classList.add('on');
    SUB.t = after(s.ms, () => { s.res(); if (SUB.q.length) subNext(); else { el.classList.remove('on'); SUB.cur = null; } }); }
  /** ambient(fn): every subtitle() called inside fn is an ambient line (js/street.js barks): it replaces the ambient line on screen instead of queueing behind it */
  function ambient(fn) { SUB.amb = (SUB.amb || 0) + 1; try { return fn(); } finally { SUB.amb--; } }
  function clearSubtitles() { if (!root) return; SUB.t = cancel(SUB.t); const all = SUB.q.splice(0); if (SUB.cur) all.push(SUB.cur); SUB.cur = null; E.sub.classList.remove('on'); all.forEach(s => s.res()); }

  /* ------------------------------------------------------------------ opening credit, title card, location, objective, hint, phone */
  function credit(role, name, o) { init(); o = o || {}; const where = ['bl', 'br', 'tl', 'tr', 'c'].includes(o.where) ? o.where : 'bl', ms = (o.seconds > 0 ? o.seconds : 3.2) * 1000;
    const el = h('div', 'f-credit ' + where, (role ? '<div class="r">' + esc(role) + '</div>' : '') + '<div class="l"></div>' + (name ? '<div class="n"><span>' + esc(name) + '</span></div>' : ''));
    E.credits.querySelectorAll('.f-credit.' + where).forEach(x => x.classList.add('out')); E.credits.appendChild(el); void el.offsetWidth; el.classList.add('on');
    return wait(Math.max(700, ms - 600)).then(() => { el.classList.add('out'); return wait(620); }).then(() => { el.remove(); }); }
  const TITLE = { on: false, n: 0 };
  function titleCard(o) { init(); o = o || {};
    /* a chapter card asked for while the payslip or the wake-up of js/opening.js is running waits until the player has his eyes open: it used to play under the eyelids as a blurred ghost */
    { const OS = GT.opening && GT.opening.state; if (!o.slam && !o._late && OS && (OS.starting || OS.wake)) { const id0 = ++TITLE.n; return new Promise(res => { const iv = setInterval(() => { const q = GT.opening.state; if (q.starting || q.wake) return; clearInterval(iv); if (id0 !== TITLE.n) return res(); setTimeout(() => res(id0 === TITLE.n ? titleCard(Object.assign({}, o, { _late: true })) : undefined), 600); }, 150); }); } }
    const el = E.title, ms = (o.seconds > 0 ? o.seconds : 4.5) * 1000, id = ++TITLE.n, words = String(o.title || 'BILIBILI THEFT AUTO 1').trim().split(/\s+/);
    el.querySelector('.f-wm .a').innerHTML = words.length > 2 ? '<i>' + esc(words[0]) + '</i><b>' + esc(words.slice(1, -1).join(' ')) + '</b>' : '<b>' + esc(words.length > 1 ? words.slice(0, -1).join(' ') : words[0]) + '</b>'; el.querySelector('.f-wm .b').textContent = words.length > 1 ? words[words.length - 1] : ''; { const wm = el.querySelector('.f-wm'), n = String(o.title || 'BILIBILI THEFT AUTO 1').trim().length; wm.style.zoom = ''; }
    el.querySelector('.c').textContent = o.chapter === undefined ? '第一章' : o.chapter; el.querySelector('.n').textContent = o.name === undefined ? '零钱' : o.name; el.querySelector('.ft-row').style.display = (o.chapter === '' && o.name === '') ? 'none' : '';
    /* o.slam: the film's end card — heavy red and chrome-yellow type that lands in three hits (the words, the number on the kick 0.75 s later, the chapter on the bell at 2 s); css .f-title.slam */
    const sl = el.querySelector('.ft-slam'), slam = !!(o.slam && sl); { const SA = slam && artBy(SPLASH_ART); /* ld: the painted bay (no faces under the big type), dimmed a little; the coded poster only when the picture did not load */
      if (SA) TITLE.art = 'linear-gradient(180deg, rgba(20,9,43,.12), rgba(20,9,43,.5)), url("' + SA.url + '")'; else if (slam && (!TITLE.art || !TITLE.art.startsWith('url(data'))) { try { const c = doc.createElement('canvas'); c.width = 1600; c.height = 900; poster(c, 2); TITLE.art = 'url(' + c.toDataURL('image/jpeg', .9) + ')'; } catch (e) { TITLE.art = 'x'; } } }
    el.querySelector('.ft-scrim').style.backgroundImage = slam && TITLE.art && TITLE.art !== 'x' ? TITLE.art : ''; if (sl) { const ch = el.querySelector('.c').textContent, nm = el.querySelector('.n').textContent; sl.querySelector('.s-a span').textContent = words.length > 2 ? words[0] : ''; sl.querySelector('.s-b span').textContent = words.length > 2 ? words.slice(1, -1).join(' ') : words.length > 1 ? words[0] : words[0]; sl.querySelector('.s-n').textContent = words.length > 1 ? words[words.length - 1] : ''; sl.querySelector('.s-c span').textContent = ch && nm ? ch + ' · ' + nm : ch || nm; sl.querySelector('.s-c').style.display = ch || nm ? '' : 'none'; }
    el.className = 'f-title' + (slam ? ' slam' : ''); void el.offsetWidth; el.className = 'f-title on' + (slam ? ' slam' : ''); TITLE.on = true; grainy();
    return wait(Math.max(900, ms - 700)).then(() => { if (id !== TITLE.n) return; el.classList.add('out'); return wait(720); }).then(() => { if (id !== TITLE.n) return; el.className = 'f-title'; TITLE.on = false; grainy(); }); }
  /* b5 — order chip: with the phone put away an accepted 跑得快 order had no card on screen. A compact chip under the mission line: where to, the fee, and the clock (the time allowed while fetching, the countdown once the food is on board; it turns yellow in the last 20 s and magenta when late). Reads GT.cngame.jobs.current four times a second; no game logic. */
  const OCHIP = { el: null };
  const ommss = s => { s = Math.max(0, Math.round(s)); return (s / 60 | 0) + ':' + ('0' + (s % 60)).slice(-2); };
  function ochipTick() { const g = GT.cngame, j = g && g.jobs && g.jobs.current, body = doc.body, show = !!j && (j.state === 'pickup' || j.state === 'deliver') && body.classList.contains('cn-play') && !body.classList.contains('gt-trailer') && !doc.querySelector('.cn-phone.on');
    if (!OCHIP.el) { if (!show) return; const hud = doc.querySelector('.cn-hud'); if (!hud) return; const e = OCHIP.el = doc.createElement('div'); e.className = 'cn-ochip'; e.innerHTML = '<i>跑</i><div><b></b><span></span></div><em></em><u><s></s></u>'; hud.appendChild(e); }
    const e = OCHIP.el, tm = doc.querySelector('.cn-timer'), del = show && j.state === 'deliver'; e.classList.toggle('on', show); body.classList.toggle('cn-ochip-d', !!(del && tm && tm.firstChild && tm.firstChild.textContent === '送达倒计时')); if (!show) return;
    const pay = '$' + (Math.round((+j.pay || 0) * 10) / 10), left = (+j.limit || 0) - (+j.t || 0), q = (s, t) => { const n = e.querySelector(s); if (n.textContent !== t) n.textContent = t; };
    q('b', del ? '送达 · ' + (j.where || '') : '取餐 · ' + (j.shop || '')); q('span', del ? (j.dish || '外卖') + ' · ' + pay : '送往 ' + (j.where || '') + ' · ' + pay); q('em', del ? (left < 0 ? '+' + ommss(-left) : ommss(left)) : '限时 ' + ommss(j.limit || 0));
    e.classList.toggle('del', del); e.classList.toggle('warn', del && left < 20 && left >= 0); e.classList.toggle('late', del && left < 0); e.querySelector('s').style.transform = 'scaleX(' + (del ? clamp(left / (j.limit || 1), 0, 1) : 1).toFixed(3) + ')'; }
  /* g7: there are no delivery orders any more — the chip is never started */
  const LOC = { t: null };
  function locationCard(name, sub, seconds) { init(); name = String(name || ''); if (typeof sub === 'number' && seconds === undefined) { seconds = sub; sub = ''; }
    if (!sub && name.includes(' · ')) { const p = name.split(' · '); name = p.shift(); sub = p.join(' · '); }
    const el = E.loc; LOC.t = cancel(LOC.t); el.classList.remove('on'); el.querySelector('b').textContent = name; el.querySelector('span').textContent = sub || ''; void el.offsetWidth; el.classList.add('on');
    const ms = (seconds > 0 ? seconds : 3.5) * 1000; LOC.t = after(ms, () => el.classList.remove('on')); return wait(ms + 600); }
  const OBJ = { text: null, t: null };
  function objective(text) { init(); text = text === undefined || text === '' ? null : text; if (text === OBJ.text) return; OBJ.text = text; OBJ.t = cancel(OBJ.t); const el = E.obj;
    if (text === null) { el.classList.remove('on'); return; } const put = () => { el.querySelector('span').textContent = text; el.classList.add('on'); };
    if (el.classList.contains('on')) { el.classList.remove('on'); OBJ.t = after(380, put); } else put(); }
  const HINT = { t: null, t2: null };
  function hint(keys, text, seconds) { init(); const el = E.hint; HINT.t = cancel(HINT.t); HINT.t2 = cancel(HINT.t2);
    if (typeof keys === 'string') keys = [keys]; if (!keys && !text) { el.classList.remove('on'); return; }
    const put = () => { el.querySelector('.keys').innerHTML = (keys || []).map(k => '<span class="f-kbd">' + esc(k) + '</span>').join(''); el.querySelector('.t').textContent = text || ''; el.classList.add('on');
      const s = seconds === undefined ? 5 : +seconds; if (s > 0 && isFinite(s)) HINT.t = after(s * 1000, () => el.classList.remove('on')); };
    if (el.classList.contains('on')) { el.classList.remove('on'); HINT.t2 = after(300, put); } else put(); }
  const PHONE = { chain: Promise.resolve() };
  function phone(o) { init(); o = o || {}; const el = E.phone, ms = (o.seconds > 0 ? o.seconds : 5) * 1000;
    const run = () => { el.querySelector('.fp-from').textContent = o.from || ''; el.querySelector('.fp-text').textContent = o.text || ''; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); sfx('ui_tick');
      return wait(ms).then(() => { el.classList.remove('on'); return wait(520); }); };
    return PHONE.chain = PHONE.chain.then(run, run); }

  /* ------------------------------------------------------------------ mission card */
  const MIS = { on: false, dismiss: null,
    key(e) { if (!e.repeat && (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape' || e.code === 'NumpadEnter') && MIS.dismiss) MIS.dismiss(); },
    show(o) { init(); o = o || {}; const el = E.mission, bad = o.result === 'failed', t0 = CLK.t; unlock(); if (MIS.dismiss) MIS.force();
      el.querySelector('.fx-kick').textContent = 'BILIBILI THEFT AUTO 1'; el.querySelector('.fx-res span').textContent = bad ? '任务失败' : '任务完成'; el.querySelector('.fx-title').textContent = o.title || '';
      const rate = el.querySelector('.fx-rate'); rate.textContent = o.rating === undefined || o.rating === null ? '' : o.rating; rate.classList.toggle('long', String(o.rating || '').length > 2);
      el.querySelector('.fx-stats').innerHTML = (o.lines || []).map(l => '<div><span>' + esc(l.label) + '</span><b>' + esc(l.value) + '</b></div>').join(''); el.querySelector('.fx-stats').style.display = (o.lines || []).length ? '' : 'none';
      const takeEl = el.querySelector('.fx-take'), tb = takeEl.querySelector('b'), hasTake = typeof o.take === 'number' && isFinite(o.take); takeEl.style.display = hasTake || typeof o.take === 'string' ? '' : 'none';
      const money = v => '$' + Math.round(v).toLocaleString('en-US'); let tick = null;
      if (hasTake) { tb.textContent = money(0); let t = 0; tick = dt => { t += dt; const k = clamp((t - 950) / 1500, 0, 1), e = 1 - Math.pow(1 - k, 3); tb.textContent = money(o.take * e); if (k >= 1) { CLK.tickers.delete(tick); tick = null; } }; CLK.tickers.add(tick); } else tb.textContent = o.take || '';
      el.querySelector('.fx-go').innerHTML = '<span class="f-kbd">Enter</span> ' + (bad ? '再来一次' : '继续');
      el.className = 'f-mission f-screen' + (bad ? ' bad' : ''); void el.offsetWidth; el.classList.add('on'); MIS.on = true; setBusy('mission', true); pushModal(MIS);
      return new Promise(res => { let gone = false; const close = () => { if (gone) return; gone = true; MIS.dismiss = MIS.force = null; if (tick) CLK.tickers.delete(tick); popModal(MIS); MIS.on = false; sfx('ui_ok'); hideScreen(el).then(() => { if (!MIS.on) setBusy('mission', false); res(); }); };
        MIS.force = close; MIS.dismiss = () => { if (CLK.t - t0 < 1200) return; if (hasTake && tick) { CLK.tickers.delete(tick); tick = null; tb.textContent = money(o.take); return; } close(); }; }); } };

  /* ------------------------------------------------------------------ credits roll */
  const ROLL_DEFAULT = ['#出品', ['', 'B STAR'], '#制作', ['导演', '代码'], ['编写', '代码'], ['美术', '代码'], ['音乐', '由代码即兴'], ['街区搭建', '代码'], '', '全部由代码生成', '', '维尔蒙港是虚构的城市。如有雷同，纯属巧合。'];
  const ROLL = { p: null, skip: null,
    key(e) { if (!e.repeat && (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') && ROLL.skip) ROLL.skip(); },
    run(lines) { init(); if (ROLL.p) return ROLL.p; lines = Array.isArray(lines) && lines.length ? lines : ROLL_DEFAULT; const el = E.roll, box = el.querySelector('.fr-in'), t0 = CLK.t; unlock();
      box.innerHTML = WM('fr-wm') + '<div class="fr-sub">维尔蒙港</div>' + lines.map(l => {
        if (l === '' || l === null || l === undefined) return '<div class="fr-gap"></div>';
        if (Array.isArray(l)) l = { role: l[0], name: l[1] };
        if (typeof l === 'object') { if (l.title || l.heading) return '<div class="fr-h">' + escp(l.title || l.heading) + '</div>'; if (l.role || l.label) return '<div class="fr-p"><span>' + escp(l.role || l.label) + '</span><b>' + escp(l.name || l.value) + '</b></div>'; return '<div class="' + (l.name ? 'fr-n' : 'fr-t') + '">' + escp(l.name || l.text || l.value) + '</div>'; }
        l = String(l); if (l[0] === '#') return '<div class="fr-h">' + escp(l.slice(1).trim()) + '</div>'; const m = l.match(/^(.{1,12}?)\s*(?:\t|\s{2,}|：|:\s)\s*(.+)$/); return m ? '<div class="fr-p"><span>' + escp(m[1]) + '</span><b>' + escp(m[2]) + '</b></div>' : '<div class="fr-t">' + escp(l) + '</div>'; }).join('');
      setBusy('roll', true); pushModal(ROLL); el.classList.remove('on'); void el.offsetWidth;
      const u = Math.min(innerHeight / 720, innerWidth / 1280), dist = box.offsetHeight + innerHeight * .62, dur = dist / (58 * u); box.style.setProperty('--dist', -dist + 'px'); box.style.setProperty('--dur', dur + 's'); showScreen(el);
      let over = false, res, tEnd; const finish = () => { if (over) return; over = true; cancel(tEnd); ROLL.skip = null; popModal(ROLL); hideScreen(el).then(() => { setBusy('roll', false); ROLL.p = null; res(); }); };
      tEnd = after(dur * 1000 + 1800, finish); ROLL.skip = () => { if (CLK.t - t0 > 600) finish(); }; return ROLL.p = new Promise(r => { res = r; }); } };
  const creditsRoll = lines => ROLL.run(lines);

  /*@@ART@@*/
  /* ------------------------------------------------------------------ loading art: five procedural poster panels (design space 1600×900, three parallax layers each)
     Style: flat shapes, posterised sky bands with halftone transitions, hard rim light cut from the silhouettes themselves, no gradients. */
  const TAU = Math.PI * 2, P2 = d => new Path2D(d);
  const rnd = seed => { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const scratch = [];
  function scr(i, w, hh) { const c = scratch[i] || (scratch[i] = doc.createElement('canvas')); if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; } const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, w, hh); return c; }
  /** draw(a) paints any shapes; they become ONE flat silhouette of colour `dark`, then each rim [dx, dy, colour] leaves a hard light edge on the side facing (-dx,-dy). */
  function sil(g, draw, dark, rims) {
    const W = g.canvas.width, H = g.canvas.height, A = scr(0, W, H), a = A.getContext('2d'), S = W / 1600;
    a.setTransform(g.getTransform()); a.fillStyle = a.strokeStyle = '#000'; a.lineJoin = a.lineCap = 'round'; draw(a);
    a.setTransform(1, 0, 0, 1, 0, 0); a.globalCompositeOperation = 'source-in'; a.fillStyle = dark; a.fillRect(0, 0, W, H);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(A, 0, 0);
    for (const r of rims || []) { const B = scr(1, W, H), b = B.getContext('2d'); b.drawImage(A, 0, 0); b.globalCompositeOperation = 'source-in'; b.fillStyle = r[2]; b.fillRect(0, 0, W, H); b.globalCompositeOperation = 'destination-out'; b.drawImage(A, r[0] * S, r[1] * S); b.drawImage(A, r[0] * S, r[1] * S); g.drawImage(B, 0, 0); }
    g.restore();
  }
  const disc = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  const poly = (g, pts) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill(); };
  const caps = (g, x, y, w, hh) => { g.beginPath(); g.roundRect(x, y, w, hh, Math.min(w, hh) / 2); g.fill(); };
  const rrect = (g, x, y, w, hh, r) => { g.beginPath(); g.roundRect(x, y, w, hh, r); g.fill(); };

  /* ------------------------------------------------------------------ g6 posters (second pass) — 阳光江城: three painted views of the city, three parallax layers each, design space 1600×900.
     ① 四方街 at dusk (warm, orange and violet, an elevation of the shop street) · ② 江滩 at noon (blue and white, the river and the far bank) · ③ 码头 after sunset (indigo and sodium yellow).
     Every house is drawn from its own roll of the dice (height, floors, sign, balcony, air-conditioner, laundry, roof clutter); clouds have a lit side, a body and a belly; the rider and the scooter
     go through lit(): a shade gradient and a rim on the side the light comes from. Layout: the top-left third is quiet sky for the caption, the subject sits on the right third above y = 800,
     the bottom-left is kept plain for the wordmark, the tip and the bar. Used by the loading screen, the studio card, the film's end card and GT.opening (GT.front.poster). */
  const hx = c => { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const mixc = (a, b, t) => { const A = hx(a), B = hx(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const rgba = (c, a) => 'rgba(' + hx(c).join(',') + ',' + a + ')';
  const vgrad = (g, y0, y1, stops) => { const gr = g.createLinearGradient(0, y0, 0, y1); for (const s of stops) gr.addColorStop(s[0], s[1]); return gr; };
  const CJK = '"PingFang SC","Hiragino Sans GB","Heiti SC","Microsoft YaHei",sans-serif';
  function gSky(g, y1, stops) { g.fillStyle = vgrad(g, -40, y1, stops); g.fillRect(-160, -340, 1920, 1400); }
  function gGlow(g, x, y, r, c, a) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgba(c, a)); gr.addColorStop(.45, rgba(c, a * .38)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  /** a cumulus resting on y. C = [body, mid, lit, belly|null]; (lx, ly) is where the light comes from (ly > 0: from below, a sunset belly) */
  function gCloud(g, x, y, w, hh, C, seed, lx, ly) { const r = rnd(seed), P = [], n = Math.max(5, Math.round(w / (hh * .5)));
    for (let i = 0; i < n; i++) { const u = i / (n - 1), ar = Math.pow(Math.sin(u * Math.PI), .6), R = hh * (.2 + .36 * ar) * (.8 + r() * .4); P.push([x + u * w, y - R * .7, R]); }
    for (let i = 0; i < n * 1.4; i++) { const u = .12 + r() * .76, ar = Math.sin(u * Math.PI), R = hh * (.16 + .3 * r()) * (.5 + ar * .6); P.push([x + u * w + (r() - .5) * hh * .3, y - hh * (.3 + .62 * r()) * ar - R * .3, R]); }
    const path = (dx, dy, k) => { g.beginPath(); for (const p of P) { const px = p[0] + dx * p[2], py = p[1] + dy * p[2]; g.moveTo(px + p[2] * k, py); g.arc(px, py, p[2] * k, 0, TAU); } };
    g.save(); path(0, 0, 1); g.fillStyle = C[0]; g.fill(); g.clip(); if (ly > 0) { path(lx * .16, .2, .9); g.fillStyle = C[1]; g.fill(); g.fillStyle = vgrad(g, y - hh * .62, y, [[0, rgba(C[2], 0)], [.55, rgba(C[2], .55)], [1, rgba(C[2], 1)]]); g.fillRect(x - hh, y - hh * .62, w + hh * 2, hh * .7); path(lx * .3, -.5, .5); g.fillStyle = rgba(C[0], .35); g.fill(); } else { path(lx * .2, ly * .2, .9); g.fillStyle = C[1]; g.fill(); path(lx * .44, ly * .44, .66); g.fillStyle = C[2]; g.fill(); }
    if (C[3]) { g.fillStyle = vgrad(g, y - hh * .5, y + hh * .05, [[0, rgba(C[3], 0)], [1, rgba(C[3], .9)]]); g.fillRect(x - hh, y - hh * .5, w + hh * 2, hh * .6); } g.restore(); }
  function gStreak(g, x, y, w, hh, c, a) { const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(.3, rgba(c, a)); gr.addColorStop(.7, rgba(c, a)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.beginPath(); g.ellipse(x + w / 2, y, w / 2, hh / 2, 0, 0, TAU); g.fill(); }
  /** one building on the line y. o = { wall, shade, win, lit, p, kind, roof, sun, rim, r } — kind 0 grid · 1 balcony bands · 2 curtain wall · 3 old walk-up with air-conditioners */
  function gBld(g, x, y, w, hh, o) { const r = o.r, sw = w * (.2 + r() * .12), sx = o.sun > 0 ? x : x + w - sw, u = clamp(w * .085, 2.2, 9), top = y - hh;
    g.fillStyle = o.wall; g.fillRect(x, top, w, hh + 2); g.fillStyle = o.shade; g.fillRect(sx, top, sw, hh + 2);
    const roof = o.roof; g.fillStyle = o.shade;
    if (roof === 1) { g.fillRect(x + w * .2, top - u * 2.4, w * .3, u * 2.4); g.fillRect(x + w * .25, top - u * 3.1, w * .2, u * .7); g.fillRect(x + w * .24, top - u * .2, u * .5, u * .4); } /* water tank */
    else if (roof === 2) { g.fillRect(x + w * .55, top - u * 2, w * .32, u * 2); g.fillRect(x + w * .7, top - u * 6, Math.max(1.2, u * .28), u * 4); g.fillRect(x + w * .62, top - u * 5, w * .18, Math.max(1, u * .22)); } /* stair hut + aerial */
    else if (roof === 3) { g.fillStyle = o.wall; g.fillRect(x + w * .14, top - hh * .08, w * .72, hh * .08 + 1); g.fillRect(x + w * .3, top - hh * .14, w * .4, hh * .07); g.fillStyle = o.shade; g.fillRect(x + w * .49, top - hh * .3, Math.max(1.4, w * .03), hh * .17); } /* stepped crown + spire */
    else if (roof === 4) { g.fillRect(x + w * .1, top - u * 3.4, Math.max(1, u * .3), u * 3.4); g.fillRect(x + w * .86, top - u * 3.4, Math.max(1, u * .3), u * 3.4); g.fillStyle = o.sign || o.lit || o.win; g.fillRect(x + w * .06, top - u * 3.6, w * .88, u * 2.3); } /* a hoarding */
    else if (roof === 5) { g.fillStyle = o.wall; poly(g, [[x - 1, top + 1], [x + w * .5, top - w * .2], [x + w + 1, top + 1]]); g.fillStyle = o.shade; poly(g, o.sun > 0 ? [[x - 1, top + 1], [x + w * .5, top - w * .2], [x + w * .5, top + 1]] : [[x + w * .5, top + 1], [x + w * .5, top - w * .2], [x + w + 1, top + 1]]); }
    else { g.fillRect(x - 1, top - u * .5, w + 2, u * .5); }
    const lit = () => o.lit && r() < o.p;
    if (o.kind === 0) { for (let yy = top + u * 1.6; yy < y - u * 2; yy += u * 2.5) for (let xx = x + u; xx < x + w - u * 1.2; xx += u * 1.95) { g.fillStyle = lit() ? o.lit : o.win; g.fillRect(xx, yy, u, u * 1.35); } }
    else if (o.kind === 1) { for (let yy = top + u * 1.4; yy < y - u * 2; yy += u * 2.7) { g.fillStyle = o.win; g.fillRect(x + u * .6, yy, w - u * 1.2, u * 1.25); if (o.lit) for (let xx = x + u * .6; xx < x + w - u * 2; xx += u * 2.3) if (r() < o.p) { g.fillStyle = o.lit; g.fillRect(xx, yy, u * 1.9, u * 1.25); } g.fillStyle = o.rim; g.fillRect(x + u * .3, yy + u * 1.5, w - u * .6, Math.max(1, u * .32)); } }
    else if (o.kind === 2) { g.fillStyle = o.win; g.fillRect(x + u * .6, top + u, w - u * 1.2, hh - u * 2); g.fillStyle = rgba('#ffffff', .16); poly(g, [[x + u * .6, top + hh * .2], [x + w - u * .6, top + u], [x + w - u * .6, top + hh * .28], [x + u * .6, top + hh * .55]]); g.fillStyle = o.wall; for (let xx = x + u * 2.2; xx < x + w - u; xx += u * 2.1) g.fillRect(xx, top + u, Math.max(1, u * .28), hh - u * 2); for (let yy = top + u * 3.4; yy < y - u; yy += u * 3) g.fillRect(x + u * .6, yy, w - u * 1.2, Math.max(1, u * .22)); if (o.lit) for (let i = 0; i < hh * w / 900 * o.p; i++) { g.fillStyle = o.lit; g.fillRect(x + u * .8 + Math.floor(r() * (w - u * 3) / (u * 2.1)) * u * 2.1, top + u * 1.3 + Math.floor(r() * (hh - u * 5) / (u * 3)) * u * 3, u * 1.7, u * 1.9); } }
    else { for (let yy = top + u * 1.8; yy < y - u * 2.4; yy += u * 3.3) for (let xx = x + u * 1.1; xx < x + w - u * 2.2; xx += u * 3) { g.fillStyle = lit() ? o.lit : o.win; g.fillRect(xx, yy, u * 1.9, u * 1.7); const k = r(); if (k < .3) { g.fillStyle = o.rim; g.fillRect(xx + u * .3, yy + u * 2, u * 1.3, u * .8); } else if (k < .42) { g.fillStyle = o.aw || o.rim; g.fillRect(xx - u * .2, yy - u * .5, u * 2.3, u * .5); } } }
    g.fillStyle = o.rim; g.fillRect(x, top, w, Math.max(1.2, u * .28)); g.fillRect(o.sun > 0 ? x + w - Math.max(1.2, u * .25) : x, top, Math.max(1.2, u * .25), hh); }
  /** a row of buildings; o = { walls, haze, k (0 near … 1 lost in the haze), win, lit, p, sun, x0, x1, wmin, wmax, kinds, tall } */
  function gCity(g, seed, y, h0, h1, o) { const r = rnd(seed), xe = o.x1 === undefined ? 1740 : o.x1, kinds = o.kinds || [0, 0, 1, 2, 3]; let x = o.x0 === undefined ? -140 : o.x0;
    while (x < xe) { const w = (o.wmin || 34) + r() * ((o.wmax || 92) - (o.wmin || 34)), hh = h0 + r() * r() * (h1 - h0) + (r() < (o.tall || .1) ? (h1 - h0) * .4 : 0), c = o.walls[(r() * o.walls.length) | 0], wall = mixc(c, o.haze, o.k);
      gBld(g, x, y, w, hh, { r, wall, shade: mixc(mixc(c, o.sh || '#2b1650', o.sk === undefined ? .34 : o.sk), o.haze, o.k), win: mixc(o.win, o.haze, o.k * .8), lit: o.lit, p: o.p || 0, kind: kinds[(r() * kinds.length) | 0], roof: (r() * 6) | 0, sun: o.sun || 1, rim: mixc(mixc(c, '#ffffff', .45), o.haze, o.k), sign: mixc(o.lit || '#ffd23f', o.haze, o.k * .6) }); x += w + (r() < .3 ? r() * 22 : 1); }
    if (o.fog) { g.fillStyle = vgrad(g, y - h1 * .6, y, [[0, rgba(o.haze, 0)], [1, rgba(o.haze, o.fog)]]); g.fillRect(-160, y - h1 * .6, 1920, h1 * .6 + 2); } }
  /** our own landmark: a slim tower with three stacked eaves (the one across the river in the game) */
  function gTower(g, x, y, hh, c, c2) { g.fillStyle = c; poly(g, [[x - hh * .03, y], [x - hh * .016, y - hh * .8], [x + hh * .016, y - hh * .8], [x + hh * .03, y]]); for (let i = 0; i < 3; i++) { const yy = y - hh * (.5 + i * .1), ww = hh * (.085 - i * .016); poly(g, [[x - ww, yy], [x + ww, yy], [x + ww * .55, yy - hh * .03], [x - ww * .55, yy - hh * .03]]); g.fillStyle = c2; g.fillRect(x - ww * .6, yy - hh * .012, ww * 1.2, hh * .008); g.fillStyle = c; } poly(g, [[x - hh * .012, y - hh * .8], [x, y - hh], [x + hh * .012, y - hh * .8]]); }
  function gBridge(g, x0, x1, y, hh, col, cable, sh) { const px = [lerp(x0, x1, .32), lerp(x0, x1, .72)]; g.strokeStyle = cable; g.lineWidth = 1.5; g.beginPath(); for (const p of px) for (let i = 1; i <= 10; i++) for (const s of [-1, 1]) { g.moveTo(p, y - hh * (.5 + i * .045)); g.lineTo(p + s * (x1 - x0) * .019 * i, y - 2); } g.stroke();
    g.fillStyle = col; g.fillRect(x0, y - 6, x1 - x0, 9); g.fillStyle = sh; g.fillRect(x0, y + 3, x1 - x0, 5); for (const p of px) { g.fillStyle = col; poly(g, [[p - 12, y + 62], [p - 5, y - hh], [p + 5, y - hh], [p + 12, y + 62]]); g.fillStyle = sh; poly(g, [[p + 1, y + 62], [p + 1, y - hh], [p + 5, y - hh], [p + 12, y + 62]]); g.fillStyle = col; g.fillRect(p - 15, y - hh * .52, 30, 6); } g.fillStyle = sh; for (let x = x0 + 40; x < x1; x += 104) g.fillRect(x, y + 6, 9, 50); }
  function gWater(g, y0, stops, bars, bx, bw, n) { g.fillStyle = vgrad(g, y0, 920, stops); g.fillRect(-160, y0, 1920, 1000 - y0); const r = rnd(9); g.fillStyle = bars; for (let i = 0; i < (n || 34); i++) { const u = r(), y = y0 + 6 + u * u * (880 - y0), w = bw * (.16 + u * 1.1) * (.4 + r() * .9), hh = 2 + u * 7; g.globalAlpha = .9 - u * .5; caps(g, bx - w / 2 + (r() - .5) * bw * (.5 + u * 2.4), y, w, hh); } g.globalAlpha = 1; }
  /** a branch of a plane tree reaching in from a corner: leaves in three tones; a = scratch or real context */
  function gBranch(g, x, y, s, flip, C, seed) { const r = rnd(seed); g.save(); g.translate(x, y); g.scale(flip ? -s : s, s); g.strokeStyle = C[3] || C[0]; g.lineCap = 'round'; g.lineWidth = 11; g.beginPath(); g.moveTo(-40, -30); g.quadraticCurveTo(110, 20, 250, 70); g.stroke(); g.lineWidth = 6; g.beginPath(); g.moveTo(110, 18); g.quadraticCurveTo(190, 10, 300, 20); g.moveTo(170, 44); g.quadraticCurveTo(200, 96, 222, 140); g.moveTo(60, -2); g.quadraticCurveTo(90, 50, 96, 104); g.stroke();
    const pts = [[250, 70], [300, 20], [222, 140], [96, 104], [150, 30], [200, 50], [60, 10], [270, 44], [190, 96], [120, 70], [10, -10], [330, 30]];
    for (const [c, n, k] of [[C[0], 90, 1], [C[1], 70, .9], [C[2], 34, .8]]) { g.fillStyle = c; for (let i = 0; i < n; i++) { const p = pts[(r() * pts.length) | 0], px = p[0] + (r() - .5) * 110 - (1 - k) * 60, py = p[1] + (r() - .5) * 70 - (1 - k) * 60, R = (9 + r() * 9) * (.7 + k * .3), an = r() * 3; g.beginPath(); g.ellipse(px, py, R * 1.5, R * .62, an, 0, TAU); g.fill(); } } g.restore(); }
  function gBirds(g, col, list) { g.strokeStyle = col; g.lineWidth = 2.6; g.lineCap = 'round'; g.beginPath(); for (const b of list) { const s = b[2]; g.moveTo(b[0] - 14 * s, b[1] - 5 * s); g.quadraticCurveTo(b[0] - 6 * s, b[1] - 9 * s, b[0], b[1]); g.quadraticCurveTo(b[0] + 6 * s, b[1] - 9 * s, b[0] + 14 * s, b[1] - 5 * s); } g.stroke(); }
  /** lit(g, draw, o): draw(a) paints a full-colour figure on a scratch canvas; then a shade gradient across it (away from the light) and a thin rim on the lit edge. o = { dx, dy (rim offset, towards the light), rim, shade, sa, x0, x1 } */
  function lit(g, draw, o) { const W = g.canvas.width, H = g.canvas.height, A = scr(0, W, H), a = A.getContext('2d'), T = g.getTransform(), S = Math.hypot(T.a, T.b); a.setTransform(T); a.lineJoin = a.lineCap = 'round'; draw(a);
    a.globalCompositeOperation = 'source-atop'; const p0 = T.transformPoint(new DOMPoint(o.x0, 0)), p1 = T.transformPoint(new DOMPoint(o.x1, 0)); a.setTransform(1, 0, 0, 1, 0, 0); const gr = a.createLinearGradient(p0.x, 0, p1.x, 0); gr.addColorStop(0, rgba(o.shade, 0)); gr.addColorStop(.45, rgba(o.shade, o.sa * .35)); gr.addColorStop(1, rgba(o.shade, o.sa)); a.fillStyle = gr; a.fillRect(0, 0, W, H);
    const B = scr(1, W, H), b = B.getContext('2d'); b.drawImage(A, 0, 0); b.globalCompositeOperation = 'source-in'; b.fillStyle = o.rim; b.fillRect(0, 0, W, H); b.globalCompositeOperation = 'destination-out'; b.drawImage(A, -o.dx * S, -o.dy * S); b.drawImage(A, -o.dx * S, -o.dy * S);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(A, 0, 0); g.globalAlpha = o.ra === undefined ? 1 : o.ra; g.drawImage(B, 0, 0); g.restore(); }
  const RD = { y: '#ffcb1f', y2: '#f0a80e', y3: '#ffe680', dk: '#22163f', dk2: '#3a2a66', sk: '#e7a877', sk2: '#c98557', pt: '#2c2a5c', wh: '#fff6e0', gr: '#a8a3c4', red: '#ff4b3e' };
  /** the yellow delivery scooter, side-on, wheels on y = 0, nose to the right */
  function gScooter(g, C, flip) { const wheel = x => { g.fillStyle = C.dk; disc(g, x, -34, 35); g.fillStyle = C.dk2; disc(g, x, -34, 27); g.fillStyle = C.gr; disc(g, x, -34, 16); g.fillStyle = C.dk; disc(g, x, -34, 11); g.fillStyle = C.gr; disc(g, x, -34, 4.5); g.strokeStyle = C.gr; g.lineWidth = 2; g.beginPath(); for (let i = 0; i < 5; i++) { const an = i * TAU / 5 + .3; g.moveTo(x, -34); g.lineTo(x + Math.cos(an) * 15, -34 + Math.sin(an) * 15); } g.stroke(); }; wheel(-98); wheel(102);
    g.strokeStyle = C.dk; g.lineWidth = 10; g.beginPath(); g.moveTo(102, -34); g.lineTo(78, -150); g.stroke(); g.lineWidth = 4; g.beginPath(); g.moveTo(-60, -30); g.lineTo(-74, -4); g.stroke();
    g.fillStyle = C.y; g.beginPath(); g.arc(102, -40, 47, Math.PI * 1.06, Math.PI * 1.9); g.lineTo(102, -66); g.fill(); g.beginPath(); g.arc(-98, -40, 46, Math.PI * 1.1, Math.PI * 1.75); g.lineTo(-98, -66); g.fill();
    g.fillStyle = C.y; poly(g, [[-152, -72], [-144, -112], [-30, -118], [-14, -66], [72, -62], [80, -44], [-38, -44], [-54, -62], [-96, -78]]); g.fillStyle = C.y2; poly(g, [[-150, -78], [-96, -84], [-54, -66], [-38, -48], [80, -48], [80, -44], [-38, -44], [-54, -62], [-96, -78], [-152, -72]]); g.fillStyle = C.y3; poly(g, [[-142, -110], [-32, -116], [-30, -110], [-140, -104]]);
    g.fillStyle = C.y; poly(g, [[58, -52], [66, -170], [92, -178], [118, -130], [120, -70], [92, -48]]); g.fillStyle = C.y2; poly(g, [[58, -52], [66, -170], [78, -172], [84, -60], [92, -48]]); g.fillStyle = C.y3; poly(g, [[94, -172], [116, -130], [110, -128], [90, -168]]);
    g.fillStyle = C.dk; rrect(g, -148, -131, 126, 16, 8); g.fillStyle = C.dk2; rrect(g, -144, -131, 118, 6, 3); g.fillStyle = C.dk; g.fillRect(60, -192, 40, 9); rrect(g, 92, -196, 16, 14, 4); g.strokeStyle = C.dk; g.lineWidth = 3.5; g.beginPath(); g.moveTo(84, -190); g.lineTo(92, -226); g.stroke(); rrect(g, 80, -244, 24, 20, 5); g.fillStyle = C.gr; rrect(g, 83, -241, 18, 14, 3);
    g.fillStyle = C.wh; disc(g, 114, -134, 10); g.fillStyle = C.red; rrect(g, -156, -106, 9, 20, 3); g.fillStyle = C.dk; rrect(g, -62, -120, 22, 10, 3);
    /* the box */ g.fillStyle = C.y; rrect(g, -214, -232, 100, 104, 7); g.fillStyle = C.y2; rrect(g, -214, -232, 22, 104, 7); g.fillRect(-200, -232, 8, 104); g.fillStyle = C.y3; g.fillRect(-190, -230, 74, 6); g.fillStyle = C.dk; g.fillRect(-214, -206, 100, 6); g.fillRect(-168, -232, 7, 26); g.fillStyle = C.dk; g.font = '900 21px ' + CJK; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(-152, -166); if (flip) g.scale(-1, 1); g.fillText('跑得快', 0, 0); g.restore(); g.fillStyle = C.dk; g.fillRect(-186, -146, 68, 4); g.fillRect(-196, -128, 64, 6); }
  /** 阿凯 riding it */
  function gRiderOn(g, C) { g.strokeStyle = C.pt; g.lineWidth = 31; g.beginPath(); g.moveTo(-68, -136); g.lineTo(8, -120); g.lineTo(28, -64); g.stroke(); g.strokeStyle = C.dk; g.lineWidth = 31; g.globalAlpha = .3; g.beginPath(); g.moveTo(-60, -124); g.lineTo(2, -110); g.stroke(); g.globalAlpha = 1; g.fillStyle = C.wh; rrect(g, 10, -64, 54, 18, 8); g.fillStyle = C.dk; g.fillRect(10, -50, 54, 4);
    g.fillStyle = C.y; poly(g, [[-98, -124], [-82, -234], [-60, -254], [-18, -248], [-6, -216], [-32, -120]]); g.fillStyle = C.y2; poly(g, [[-98, -124], [-82, -234], [-70, -246], [-62, -128]]); g.fillStyle = C.wh; poly(g, [[-92, -164], [-28, -156], [-30, -143], [-94, -151]]); g.fillStyle = C.gr; poly(g, [[-92, -164], [-66, -161], [-67, -148], [-94, -151]]);
    g.strokeStyle = C.y; g.lineWidth = 24; g.beginPath(); g.moveTo(-38, -230); g.lineTo(20, -190); g.lineTo(70, -190); g.stroke(); g.strokeStyle = C.y2; g.lineWidth = 8; g.beginPath(); g.moveTo(-34, -220); g.lineTo(18, -182); g.lineTo(62, -182); g.stroke(); g.fillStyle = C.dk; rrect(g, 62, -200, 24, 20, 8);
    g.fillStyle = C.sk; g.fillRect(-46, -266, 22, 22); disc(g, -30, -276, 22); poly(g, [[-10, -282], [-2, -272], [-10, -268]]); g.fillStyle = C.sk2; g.fillRect(-46, -256, 22, 8); g.fillStyle = C.dk; g.fillRect(-20, -280, 7, 3);
    g.fillStyle = C.y; g.beginPath(); g.arc(-34, -284, 32, Math.PI * .9, Math.PI * 2.08); g.closePath(); g.fill(); g.fillStyle = C.y3; g.beginPath(); g.arc(-34, -284, 32, Math.PI * 1.25, Math.PI * 1.8); g.arc(-34, -280, 24, Math.PI * 1.8, Math.PI * 1.25, true); g.fill(); g.fillStyle = C.dk; poly(g, [[-10, -298], [2, -288], [0, -276], [-12, -278]]); g.strokeStyle = C.dk; g.lineWidth = 3; g.beginPath(); g.moveTo(-48, -266); g.lineTo(-26, -252); g.stroke(); }
  /** 阿凯 standing, seen from behind and a little to the side, feet on y = 0, helmet in his left hand */
  function gStand(g, C) { g.fillStyle = C.pt; poly(g, [[-30, -150], [-2, -150], [-4, -8], [-26, -8]]); poly(g, [[4, -150], [32, -150], [30, -8], [8, -8]]); g.fillStyle = C.dk; poly(g, [[-2, -150], [4, -150], [6, -60], [-3, -60]]); g.fillStyle = C.wh; rrect(g, -32, -12, 32, 13, 5); rrect(g, 6, -12, 32, 13, 5);
    g.fillStyle = C.y; poly(g, [[-40, -146], [-46, -258], [-28, -276], [30, -276], [48, -258], [42, -146]]); g.fillStyle = C.y2; poly(g, [[-40, -146], [-46, -258], [-36, -270], [-26, -146]]); g.fillStyle = C.wh; g.fillRect(-42, -196, 84, 12); g.fillStyle = C.gr; g.fillRect(-42, -196, 16, 12); g.fillStyle = C.dk; g.font = '900 17px ' + CJK; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('跑得快', 3, -232);
    g.strokeStyle = C.y; g.lineWidth = 21; g.beginPath(); g.moveTo(-46, -256); g.lineTo(-58, -196); g.lineTo(-56, -150); g.stroke(); g.beginPath(); g.moveTo(48, -256); g.lineTo(64, -204); g.lineTo(84, -176); g.stroke(); g.fillStyle = C.sk; disc(g, -56, -140, 9); disc(g, 88, -172, 9);
    g.fillStyle = C.y; g.beginPath(); g.arc(-58, -112, 27, 0, TAU); g.fill(); g.fillStyle = C.dk; g.beginPath(); g.arc(-58, -112, 27, .2, 1.5); g.lineTo(-58, -112); g.fill(); g.fillStyle = C.y3; g.beginPath(); g.arc(-58, -112, 27, Math.PI * 1.2, Math.PI * 1.7); g.arc(-58, -108, 20, Math.PI * 1.7, Math.PI * 1.2, true); g.fill();
    g.fillStyle = C.sk; g.fillRect(-10, -292, 22, 20); disc(g, 1, -304, 21); g.fillStyle = C.sk2; g.fillRect(-10, -282, 22, 7); disc(g, 22, -302, 5); g.fillStyle = C.dk; g.beginPath(); g.arc(1, -308, 22, Math.PI * .86, Math.PI * 2.14); g.closePath(); g.fill(); }
  /* g7: the posters no longer show the delivery scooter and its rider: an American two-door, side-on, and a young man in a grey tee, jeans and white trainers */
  const CAR = { body: '#1d3c63', body2: '#132a48', hi: '#5d86bb', glass: '#141b30', glass2: 'rgba(170,200,240,.42)', chrome: '#eef1f6', chrome2: '#a3abba', tire: '#15131c', tire2: '#26232f', rim: '#d5dbe4', rim2: '#5b6272', trim: '#0d0c14', light: '#fff4c8', tail: '#ff3b30', amber: '#ffb34a' };
  const GUY = { skin: '#e2a57c', skin2: '#bf8460', hair: '#24202c', tee: '#a2a5ad', tee2: '#7c808b', jean: '#2f3e60', jean2: '#222d47', shoe: '#f5f3ef', sole: '#cfcac0' };
  /** the car: wheels on y = 0, nose to the right (flip: to the left), about 600 x 180 in design units */
  function gCar(g, C, flip) { g.save(); if (flip) g.scale(-1, 1); const R = 46, WF = 178, WR = -182;
    const wheel = x => { g.fillStyle = C.tire; disc(g, x, -R, R); g.fillStyle = C.tire2; disc(g, x, -R, R - 8); g.fillStyle = C.rim; disc(g, x, -R, 28); g.fillStyle = C.rim2; disc(g, x, -R, 21); g.strokeStyle = C.rim; g.lineWidth = 6; g.lineCap = 'round'; for (let k = 0; k < 5; k++) { const a = k * TAU / 5 + .35; g.beginPath(); g.moveTo(x, -R); g.lineTo(x + Math.cos(a) * 21, -R + Math.sin(a) * 21); g.stroke(); } g.fillStyle = C.chrome; disc(g, x, -R, 7); };
    g.fillStyle = C.trim; disc(g, WR, -R, R + 9); disc(g, WF, -R, R + 9);
    /* body */ g.fillStyle = C.body; g.beginPath(); g.moveTo(-292, -34); g.lineTo(-298, -68); g.quadraticCurveTo(-298, -100, -274, -105); g.lineTo(-150, -113); g.lineTo(122, -115); g.lineTo(262, -105); g.quadraticCurveTo(300, -100, 301, -80); g.lineTo(301, -42); g.quadraticCurveTo(299, -29, 286, -28);
    g.lineTo(WF + R + 10, -28); g.arc(WF, -R, R + 10, 0, Math.PI, true); g.lineTo(WF - R - 10, -28); g.lineTo(WR + R + 10, -28); g.arc(WR, -R, R + 10, 0, Math.PI, true); g.lineTo(WR - R - 10, -28); g.closePath(); g.fill();
    /* cabin */ poly(g, [[-170, -110], [-120, -168], [-104, -175], [40, -177], [60, -172], [128, -112]]);
    /* shoulder light, crease, rocker */ g.fillStyle = C.hi; poly(g, [[-272, -104], [-150, -112], [122, -114], [262, -104], [258, -97], [120, -106], [-150, -104], [-268, -97]]); g.fillStyle = C.body2; g.fillRect(-288, -73, 584, 5); g.fillRect(-150, -112, 8, 80); g.fillStyle = C.chrome2; g.fillRect(WR + R + 14, -36, WF - WR - 2 * R - 28, 4);
    /* glass */ g.fillStyle = C.glass; poly(g, [[-152, -114], [-113, -161], [-48, -164], [-48, -114]]); poly(g, [[-36, -114], [-36, -165], [40, -168], [106, -114]]);
    g.fillStyle = C.glass2; poly(g, [[2, -114], [27, -166], [44, -167], [19, -114]]); poly(g, [[-108, -114], [-84, -162], [-74, -163], [-98, -114]]);
    g.strokeStyle = C.chrome2; g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath(); g.moveTo(-168, -112); g.lineTo(-119, -168); g.lineTo(-104, -176); g.lineTo(40, -178); g.lineTo(61, -173); g.lineTo(130, -112); g.stroke();
    /* door, handle, mirror */ g.strokeStyle = C.body2; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-42, -112); g.lineTo(-38, -36); g.moveTo(112, -112); g.quadraticCurveTo(120, -70, 114, -40); g.stroke(); g.fillStyle = C.chrome; rrect(g, -30, -100, 28, 6, 3); g.fillStyle = C.body2; poly(g, [[100, -120], [118, -132], [126, -122], [112, -112]]);
    /* lamps, bumpers */ g.fillStyle = C.light; rrect(g, 287, -94, 15, 17, 4); g.fillStyle = C.amber; rrect(g, 288, -72, 12, 8, 3); g.fillStyle = C.tail; rrect(g, -302, -97, 11, 24, 3); g.fillStyle = C.chrome; rrect(g, 280, -52, 26, 14, 6); rrect(g, -308, -54, 26, 14, 6); g.fillStyle = C.chrome2; g.fillRect(280, -42, 26, 3); g.fillRect(-308, -44, 26, 3);
    wheel(WR); wheel(WF); g.restore(); }
  /** the young man, seen from behind and a little to the side, feet on y = 0, about 320 tall in design units (scale it to the car) */
  function gGuy(g, C) {
    g.fillStyle = C.jean; poly(g, [[-30, -152], [-2, -152], [-6, -14], [-27, -14]]); poly(g, [[2, -152], [31, -152], [27, -14], [6, -14]]); g.fillStyle = C.jean2; poly(g, [[-30, -152], [-20, -152], [-22, -14], [-27, -14]]); g.fillRect(-2, -150, 4, 40);
    g.fillStyle = C.shoe; rrect(g, -33, -18, 31, 17, 7); rrect(g, 4, -18, 31, 17, 7); g.fillStyle = C.sole; g.fillRect(-33, -5, 31, 5); g.fillRect(4, -5, 31, 5);
    g.strokeStyle = C.skin; g.lineWidth = 15; g.lineCap = 'round'; g.beginPath(); g.moveTo(-55, -214); g.lineTo(-59, -162); g.moveTo(55, -214); g.lineTo(60, -162); g.stroke(); g.fillStyle = C.skin2; disc(g, -59, -154, 9); disc(g, 60, -154, 9);
    g.fillStyle = C.tee; poly(g, [[-41, -142], [-47, -250], [-30, -271], [30, -271], [47, -250], [41, -142]]); poly(g, [[-47, -252], [-65, -212], [-48, -204], [-36, -238]]); poly(g, [[47, -252], [65, -212], [48, -204], [36, -238]]);
    g.fillStyle = C.tee2; poly(g, [[-41, -142], [-47, -250], [-34, -266], [-26, -142]]); poly(g, [[-47, -252], [-65, -212], [-57, -208]]); g.fillRect(-41, -150, 82, 8);
    g.fillStyle = C.skin2; g.fillRect(-9, -287, 18, 18); g.fillStyle = C.skin; disc(g, 0, -301, 21); disc(g, 20, -300, 5); disc(g, -20, -300, 5); g.fillStyle = C.hair; g.beginPath(); g.arc(0, -303, 21, Math.PI * .92, Math.PI * 2.08); g.lineTo(18, -292); g.quadraticCurveTo(0, -284, -18, -292); g.closePath(); g.fill(); }
  function gShadow(g, x, y, w, hh, c, a) { const gr = g.createRadialGradient(x, y, 0, x, y, w); gr.addColorStop(0, rgba(c, a)); gr.addColorStop(.6, rgba(c, a * .7)); gr.addColorStop(1, rgba(c, 0)); g.save(); g.translate(x, y); g.scale(1, hh / w); g.translate(-x, -y); g.fillStyle = gr; g.fillRect(x - w, y - w, w * 2, w * 2); g.restore(); }
  /** a street tree: trunk and a canopy in three tones, standing on y */
  function gTree(g, x, y, s, C, seed) { const r = rnd(seed); g.fillStyle = C[3]; poly(g, [[x - 7 * s, y], [x - 5 * s, y - 120 * s], [x - 26 * s, y - 176 * s], [x - 20 * s, y - 180 * s], [x, y - 140 * s], [x + 22 * s, y - 184 * s], [x + 28 * s, y - 178 * s], [x + 6 * s, y - 120 * s], [x + 8 * s, y]]);
    for (const [c, n, k, oy] of [[C[0], 15, 1, 0], [C[1], 12, .8, -12], [C[2], 8, .42, -34]]) { g.fillStyle = c; for (let i = 0; i < n; i++) { const an = r() * TAU, d = r() * 70 * s * k; disc(g, x + Math.cos(an) * d * 1.25 + (k < 1 ? C[4] * 14 * s : 0), y - 206 * s + Math.sin(an) * d * .66 + oy * s, (30 + r() * 24) * s * k); } } }
  function gLamp(g, x, y, hh, c, lampc, glow) { g.fillStyle = c; g.fillRect(x - 3, y - hh, 6, hh); g.fillRect(x - 5, y - 16, 10, 16); g.fillRect(x - 2, y - hh, 46, 5); rrect(g, x + 26, y - hh - 2, 26, 10, 4); if (lampc) { g.fillStyle = lampc; rrect(g, x + 29, y - hh + 5, 20, 5, 2); if (glow) gGlow(g, x + 39, y - hh + 10, glow, lampc, .5); } }
  function gPerson(g, x, y, s, c1, c2, sk) { g.fillStyle = c2; g.fillRect(x - 7 * s, y - 44 * s, 6 * s, 44 * s); g.fillRect(x + 1 * s, y - 44 * s, 6 * s, 44 * s); g.fillStyle = c1; rrect(g, x - 10 * s, y - 84 * s, 20 * s, 44 * s, 5 * s); g.fillStyle = sk; disc(g, x, y - 93 * s, 8 * s); g.fillStyle = c2; g.beginPath(); g.arc(x, y - 95 * s, 8.4 * s, Math.PI, TAU); g.fill(); }
  /* ---- ① 四方街 · 傍晚: the sun low on the right behind the towers; orange bellies on violet clouds; the shop street side-on */
  const HZ1 = '#f08a8c';
  function q1bg(g) { gSky(g, 700, [[0, '#2b1d6b'], [.22, '#5a2f8f'], [.42, '#a8438f'], [.6, '#ec5f7c'], [.76, '#ff9160'], [.9, '#ffc56a'], [1, '#ffe7a6']]); gGlow(g, 1060, 400, 640, '#ffe9a0', .7); gGlow(g, 1060, 400, 240, '#fff6d0', .9); g.fillStyle = '#fffbe6'; disc(g, 1060, 400, 82);
    gStreak(g, 420, 520, 900, 16, '#ffd27a', .7); gStreak(g, 880, 470, 760, 12, '#ffb07a', .6); gStreak(g, -80, 566, 700, 12, '#ff9b86', .55); gStreak(g, 1180, 548, 560, 9, '#fff0b0', .8);
    const C = ['#6d3a96', '#a04a93', '#ff8e6a', null], C2 = ['#4a2b84', '#7d3f93', '#f0707c', null]; gCloud(g, 520, 392, 430, 100, C, 3, .5, 1); gCloud(g, 1260, 250, 380, 84, C, 4, -.2, 1); gCloud(g, 930, 196, 250, 46, C2, 5, .3, 1); gCloud(g, 1420, 440, 300, 54, ['#8a4494', '#d85a86', '#ffb478', null], 6, -.6, 1); gCloud(g, 300, 452, 240, 40, ['#8a4494', '#d85a86', '#ffb478', null], 7, .8, 1);
    gBirds(g, '#3a2470', [[760, 300, 1], [806, 280, .8], [722, 326, .7], [690, 290, .6]]);
    gCity(g, 11, 690, 120, 380, { walls: ['#c96a9a', '#b85f9a', '#d67a98'], haze: HZ1, k: .62, win: '#8c4a8e', lit: null, sun: 1, fog: .75, wmin: 40, wmax: 100, kinds: [0, 2, 2, 1], tall: .16 }); gTower(g, 418, 690, 500, mixc('#b85f9a', HZ1, .5), mixc('#ffe7a6', HZ1, .3)); }
  const SHOPS = [['修车', '#3f6fd8', '#ffffff', '#f3e3c8', 3, 1], ['鲜果', '#2e9d62', '#fff7c8', '#f7b9a0', 2, 0], ['五金', '#ffd23f', '#c22d2d', '#bfd8e6', 4, 3], ['面', '#c8312e', '#fff1c0', '#f6d9a8', 2, 2], ['理发', '#f6f1e4', '#28407a', '#d9c4ec', 3, 1], ['烟酒茶', '#8b2f2a', '#ffd98a', '#f2c7a2', 4, 0], ['小吃', '#ff7a3c', '#ffffff', '#c9e4d6', 2, 2], ['配钥匙', '#22306a', '#ffe27a', '#f4e6cc', 3, 3], ['洋服', '#f3e7cf', '#5a2a22', '#e8b7b0', 4, 1], ['奶茶', '#ff9db0', '#5a2146', '#cfe0f2', 2, 0], ['杂货', '#3aa99f', '#ffffff', '#f6dcb4', 3, 2]];
  function q1mid(g) { gCity(g, 12, 706, 150, 330, { walls: ['#8f4a9c', '#7c4096', '#a2559e', '#6c3a92'], haze: HZ1, k: .26, win: '#4e2a78', lit: '#ffdc8a', p: .34, sun: 1, fog: .5, wmin: 60, wmax: 130, kinds: [1, 3, 3, 0, 2], tall: .2 });
    const r = rnd(31), GY = 716; let x = -120, n = 0; const laundry = ['#ff6f61', '#ffffff', '#58c4e8', '#ffd23f', '#ff9db0', '#7c6fe0', '#3fbf8f'];
    while (x < 1740) { const S = SHOPS[n % SHOPS.length], w = 142 + r() * 76, fl = S[4], fh = 56 + r() * 10, hh = 98 + fl * fh, top = GY - hh, wall = S[3], sh = mixc(wall, '#5a2a8a', .34); n++;
      g.fillStyle = wall; g.fillRect(x, top, w, hh); g.fillStyle = sh; g.fillRect(x, top, 9, hh); g.fillStyle = mixc(wall, '#ffffff', .5); g.fillRect(x, top - 5, w, 6); g.fillStyle = sh; g.fillRect(x - 2, top - 9, w + 4, 5);
      /* upper floors */ const cols = w > 180 ? 3 : 2, cw = (w - 18) / cols; for (let f = 0; f < fl; f++) { const fy = top + 12 + f * fh; for (let c = 0; c < cols; c++) { const wx = x + 14 + c * cw, k = r(), ww = cw - 14, on = r() < .5;
          if (k < .4) { /* enclosed balcony */ g.fillStyle = mixc(wall, '#ffffff', .4); g.fillRect(wx - 3, fy + 2, ww + 6, fh - 14); g.fillStyle = on ? '#ffd98a' : '#4e3a86'; g.fillRect(wx, fy + 5, ww, fh - 30); g.fillStyle = mixc(wall, '#ffffff', .4); g.fillRect(wx + ww / 2 - 1.5, fy + 5, 3, fh - 30); g.fillStyle = sh; for (let i = 0; i < 6; i++) g.fillRect(wx + i * ww / 5.4, fy + fh - 24, 2, 11); g.fillRect(wx - 3, fy + fh - 13, ww + 6, 3); }
          else { g.fillStyle = on ? '#ffdc8a' : '#4e3a86'; g.fillRect(wx + ww * .12, fy + 8, ww * .76, fh - 28); g.fillStyle = mixc(wall, '#ffffff', .55); g.fillRect(wx + ww * .12 - 2, fy + fh - 21, ww * .76 + 4, 3); g.fillRect(wx + ww * .5 - 1, fy + 8, 2, fh - 28); if (on && r() < .5) { g.fillStyle = rgba('#b0503c', .55); g.fillRect(wx + ww * .12, fy + 8, ww * .3, fh - 28); }
            if (r() < .45) { g.fillStyle = '#e9e4f2'; rrect(g, wx + ww * .2, fy + fh - 17, 26, 15, 2); g.fillStyle = '#7d769a'; disc(g, wx + ww * .2 + 9, fy + fh - 9.5, 5); g.fillRect(wx + ww * .2 + 17, fy + fh - 14, 7, 2); g.fillRect(wx + ww * .2 + 17, fy + fh - 10, 7, 2); } }
          if (r() < .3) { /* a pole of washing */ g.fillStyle = '#5a4a80'; g.fillRect(wx - 2, fy + fh - 9, ww + 4, 2); for (let i = 0; i < 3; i++) { const lx = wx + 4 + i * (ww - 12) / 3, lc = laundry[(r() * laundry.length) | 0], lh = 13 + r() * 9; g.fillStyle = lc; poly(g, [[lx, fy + fh - 7], [lx + 13, fy + fh - 7], [lx + 15, fy + fh - 7 + lh], [lx - 2, fy + fh - 7 + lh]]); } } }
        g.fillStyle = rgba('#5a2a8a', .12); g.fillRect(x, fy + fh - 9, w, 2); }
      g.fillStyle = sh; g.fillRect(x + w - 12, top + 4, 4, hh - 100);
      /* roof clutter */ const k = S[5]; g.fillStyle = sh; if (k === 0) { g.fillStyle = '#d9d2ea'; rrect(g, x + w * .2, top - 46, 40, 34, 5); g.fillStyle = '#9a8fbb'; g.fillRect(x + w * .2 + 4, top - 12, 4, 8); g.fillRect(x + w * .2 + 32, top - 12, 4, 8); g.fillRect(x + w * .2, top - 36, 40, 3); } else if (k === 1) { g.fillStyle = '#3f4f8f'; poly(g, [[x + w * .5, top - 9], [x + w * .5 + 54, top - 9], [x + w * .5 + 44, top - 36], [x + w * .5 + 8, top - 36]]); g.fillStyle = '#8fb0f0'; poly(g, [[x + w * .5 + 6, top - 12], [x + w * .5 + 46, top - 12], [x + w * .5 + 40, top - 32], [x + w * .5 + 12, top - 32]]); g.fillStyle = '#e9e4f2'; rrect(g, x + w * .5 + 8, top - 46, 36, 10, 5); }
      else if (k === 2) { g.fillRect(x + w * .3, top - 62, 3, 54); g.fillRect(x + w * .3 - 14, top - 56, 31, 2.5); g.fillRect(x + w * .3 - 9, top - 46, 21, 2.5); g.fillStyle = '#3f9d62'; for (let i = 0; i < 4; i++) disc(g, x + w * .58 + i * 15, top - 17, 8 + (i % 2) * 3); g.fillStyle = '#b0563c'; g.fillRect(x + w * .58 - 8, top - 12, 60, 5); } else { g.fillStyle = mixc(wall, '#5a2a8a', .2); g.fillRect(x + w * .44, top - 40, w * .4, 32); g.fillStyle = sh; g.fillRect(x + w * .44 - 3, top - 44, w * .4 + 6, 5); g.fillStyle = '#ffdc8a'; g.fillRect(x + w * .52, top - 30, 13, 15); }
      /* the shop */ const sy = GY - 98; g.fillStyle = '#2a1650'; g.fillRect(x + 8, sy + 36, w - 16, 62); g.fillStyle = vgrad(g, sy + 36, GY, [[0, '#ffe7a0'], [1, '#ffb45e']]); g.fillRect(x + 14, sy + 42, w - 28, 54); const st = r();
      if (st < .34) { /* shelves */ g.fillStyle = '#8a4a3a'; for (let i = 0; i < 3; i++) g.fillRect(x + 18, sy + 56 + i * 14, w - 36, 2.5); for (let i = 0; i < (w - 40) / 9; i++) { g.fillStyle = laundry[(r() * laundry.length) | 0]; g.fillRect(x + 20 + i * 9, sy + 46 + ((r() * 3) | 0) * 14, 6, 9); } }
      else if (st < .67) { /* a half-lifted shutter and a counter */ g.fillStyle = '#b9b3cf'; g.fillRect(x + 14, sy + 42, w - 28, 16); g.fillStyle = '#8a82a8'; for (let i = 0; i < 4; i++) g.fillRect(x + 14, sy + 45 + i * 4, w - 28, 1.5); g.fillStyle = '#7a3a2e'; g.fillRect(x + 22, GY - 26, w * .5, 26); g.fillStyle = '#2a1650'; disc(g, x + w * .66, GY - 44, 7); rrect(g, x + w * .66 - 8, GY - 38, 16, 30, 4); }
      else { /* glass door */ g.fillStyle = '#2a1650'; g.fillRect(x + w * .5 - 2, sy + 42, 4, 54); g.fillRect(x + 14, sy + 62, w - 28, 2.5); g.fillStyle = rgba('#ffffff', .35); poly(g, [[x + 20, sy + 46], [x + 40, sy + 46], [x + 24, sy + 92], [x + 20, sy + 92]]); g.fillStyle = '#e2424f'; rrect(g, x + w * .62, sy + 68, 30, 16, 3); }
      g.fillStyle = S[1]; g.fillRect(x + 4, sy + 2, w - 8, 32); g.fillStyle = rgba('#000000', .16); g.fillRect(x + 4, sy + 30, w - 8, 4); g.fillStyle = S[2]; g.font = '900 ' + (S[0].length > 2 ? 22 : 25) + 'px ' + CJK; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(S[0].split('').join(S[0].length > 2 ? ' ' : '  '), x + w / 2, sy + 19);
      const aw = r(); if (aw < .4) { for (let i = 0; i < 7; i++) { g.fillStyle = i % 2 ? '#fff3d6' : '#e2424f'; poly(g, [[x + 6 + i * (w - 12) / 7, sy + 34], [x + 6 + (i + 1) * (w - 12) / 7, sy + 34], [x + (i + 1) * (w + 8) / 7 - 4, sy + 54], [x + i * (w + 8) / 7 - 4, sy + 54]]); } g.fillStyle = rgba('#2a1650', .3); g.fillRect(x - 4, sy + 52, w + 8, 4); } else if (aw < .62) { g.fillStyle = mixc(S[1], '#2a1650', .25); poly(g, [[x + 6, sy + 34], [x + w - 6, sy + 34], [x + w + 6, sy + 52], [x - 6, sy + 52]]); }
      /* things on the pavement */ const pv = r(); if (pv < .3) { for (let i = 0; i < 3; i++) { g.fillStyle = ['#3f6fd8', '#e2424f', '#2e9d62'][i]; g.fillRect(x + 12 + i * 22, GY - 14 + (i % 2) * 2, 18, 14 - (i % 2) * 2); } } else if (pv < .5) { g.fillStyle = '#b0563c'; poly(g, [[x + w - 34, GY], [x + w - 12, GY], [x + w - 16, GY - 16], [x + w - 30, GY - 16]]); g.fillStyle = '#2e9d62'; disc(g, x + w - 23, GY - 26, 13); g.fillStyle = '#52c084'; disc(g, x + w - 19, GY - 30, 8); } else if (pv < .64) { g.fillStyle = '#ffd23f'; rrect(g, x + 14, GY - 30, 26, 30, 3); g.fillStyle = '#2a1650'; g.fillRect(x + 18, GY - 25, 18, 4); }
      /* dusk on the wall: warm at the top, cool towards the street */ g.fillStyle = vgrad(g, top, GY, [[0, rgba('#ffb060', .2)], [.5, rgba('#ff8a70', .04)], [1, rgba('#3a1a80', .3)]]); g.fillRect(x, top - 9, w, hh + 9 - 62); g.fillStyle = rgba('#2a1650', .5); g.fillRect(x + w, top + 10, 3, hh - 10); x += w + 3; }
    /* pavement, kerb, road */ g.fillStyle = vgrad(g, GY, GY + 30, [[0, '#c88aa6'], [1, '#a66a9a']]); g.fillRect(-160, GY, 1920, 30); g.fillStyle = rgba('#ffd98a', .5); for (let i = 0; i < 11; i++) { const lx = -90 + i * 170; g.beginPath(); g.ellipse(lx, GY + 14, 62, 9, 0, 0, TAU); g.fill(); } g.fillStyle = '#e9d6e2'; g.fillRect(-160, GY + 28, 1920, 5); g.fillStyle = '#4a2a7c'; g.fillRect(-160, GY + 33, 1920, 4);
    g.fillStyle = vgrad(g, GY + 36, 900, [[0, '#5e3690'], [.4, '#40246f'], [1, '#22123f']]); g.fillRect(-160, GY + 36, 1920, 240); for (let i = 0; i < 7; i++) gStreak(g, 760 + i * 22 - i * i * 6, GY + 46 + i * 15, 560 + i * 60, 7 + i, '#ffc878', .34 - i * .035); g.fillStyle = rgba('#ffe9b0', .7); for (let i = 0; i < 14; i++) g.fillRect(-130 + i * 140, GY + 72, 62, 5);
    /* trees, lamps, a few people on the pavement */ const TC = ['#34246e', '#553088', '#a8508e', '#2f1a5c', 1]; gTree(g, 250, GY + 6, 1.15, TC, 61); gTree(g, 905, GY + 6, 1.25, TC, 62); gTree(g, 1560, GY + 6, 1.1, TC, 63); gLamp(g, 560, GY + 4, 250, '#2f1a5c', '#fff0b0', 120); gLamp(g, 1330, GY + 4, 250, '#2f1a5c', '#fff0b0', 120);
    gPerson(g, 420, GY + 20, 1, '#e2424f', '#2a1650', '#e7a877'); gPerson(g, 452, GY + 22, .96, '#f3e7cf', '#3a2a66', '#e7a877'); gPerson(g, 705, GY + 18, .98, '#3f6fd8', '#2a1650', '#d99a6c'); gPerson(g, 1466, GY + 22, 1, '#ffffff', '#40246f', '#e7a877');
    /* wires */ g.strokeStyle = '#2f1a5c'; g.lineWidth = 1.6; g.beginPath(); for (const o of [0, 8, 20]) { g.moveTo(-200, 392 + o); g.quadraticCurveTo(280, 440 + o, 560, 462 + o * .5); g.moveTo(560, 462 + o * .5); g.quadraticCurveTo(950, 500 + o, 1330, 462 + o * .5); g.moveTo(1330, 462 + o * .5); g.quadraticCurveTo(1560, 486 + o, 1900, 420 + o); } g.stroke(); }
  function q1fg(g) { gShadow(g, 1170, 814, 330, 16, '#1c0d3a', .6); gShadow(g, 846, 814, 70, 8, '#1c0d3a', .5); lit(g, a => { a.save(); a.translate(1180, 812); a.scale(.94, .94); gCar(a, CAR); a.restore(); a.save(); a.translate(846, 814); a.scale(.71, .71); gGuy(a, GUY); a.restore(); }, { dx: 3, dy: -2, rim: '#fff0b8', shade: '#3a1a80', sa: .46, x0: 1460, x1: 820 });
    gGlow(g, 1462, 733, 46, '#fff6d0', .75); gGlow(g, 897, 732, 22, '#ff4b3e', .6); }
  /* ---- ② 江滩 · 正午: a real blue sky, piled white cumulus, the far bank in blue haze, turquoise water, the promenade in hard light */
  const HZ2 = '#bfe3f6';
  function q2bg(g) { gSky(g, 590, [[0, '#0e5fc4'], [.35, '#2f8ae0'], [.7, '#79c2ee'], [1, '#d3eef8']]); gGlow(g, 1500, 40, 520, '#ffffff', .55);
    const C = ['#c3d9ee', '#eaf4fb', '#ffffff', '#9fbfe0']; gCloud(g, 620, 420, 620, 190, C, 41, .5, -1); gCloud(g, 1220, 330, 360, 104, C, 42, .5, -1); gCloud(g, 180, 470, 380, 86, C, 43, .5, -1); gCloud(g, 1380, 492, 330, 60, C, 44, .5, -1); gCloud(g, 930, 160, 230, 48, ['#d3e6f4', '#f1f8fc', '#ffffff', null], 45, .5, -1); gCloud(g, 1330, 120, 150, 30, ['#d3e6f4', '#f1f8fc', '#ffffff', null], 46, .5, -1);
    gBirds(g, '#2a5d94', [[1010, 250, 1], [1052, 232, .8], [972, 270, .7]]);
    g.fillStyle = mixc('#3f8f7a', HZ2, .6); g.beginPath(); g.moveTo(-160, 590); for (let i = 0; i <= 24; i++) g.lineTo(-160 + i * 80, 560 - 26 * Math.sin(i * .7) - 18 * Math.sin(i * 1.9 + 1)); g.lineTo(1760, 590); g.fill();
    gCity(g, 51, 590, 50, 280, { walls: ['#9cc4e6', '#b6d3ea', '#8fb8e0'], haze: HZ2, k: .5, sh: '#2f5f9a', sk: .3, win: '#5f93c6', lit: null, sun: 1, fog: .7, wmin: 30, wmax: 84, kinds: [2, 2, 0, 1], tall: .2 }); gTower(g, 1010, 590, 420, mixc('#8fb8e0', HZ2, .4), '#ffffff'); }
  function q2mid(g) { gCity(g, 52, 600, 40, 190, { walls: ['#f6cdbd', '#fbeccb', '#c4e8df', '#e7d6f4', '#ffffff', '#f3b3a8', '#ffe0a0'], haze: HZ2, k: .16, sh: '#3f5f9a', sk: .3, win: '#4f86b8', lit: null, sun: 1, x0: 330, wmin: 44, wmax: 104, kinds: [0, 1, 3, 3, 2], tall: .16 });
    const r = rnd(57); for (const [c, k] of [['#1f8a55', 1], ['#35ab69', .8], ['#7ad695', .5]]) { g.fillStyle = c; for (let i = 0; i < 50; i++) disc(g, 330 + i * 29 + (r() - .5) * 10, 602 - (1 - k) * 12, (12 + r() * 9) * k); } g.fillStyle = '#e9dcc0'; g.fillRect(320, 606, 1440, 8); g.fillStyle = '#c9b68e'; g.fillRect(320, 612, 1440, 3);
    gWater(g, 614, [[0, '#4fd3c4'], [.3, '#22b3bd'], [.7, '#1489b0'], [1, '#0d6a9c']], '#ffffff', 1050, 190, 46); g.fillStyle = rgba('#ffffff', .22); for (let i = 0; i < 9; i++) g.fillRect(380 + i * 150, 616, 60, 26 + (i % 3) * 14);
    gBridge(g, -180, 800, 548, 300, '#ffffff', 'rgba(255,255,255,.9)', '#b9cfe2');
    /* a river boat and its wake */ g.fillStyle = rgba('#ffffff', .75); poly(g, [[250, 706], [470, 700], [470, 706], [120, 722]]); g.fillStyle = '#ffffff'; poly(g, [[440, 672], [690, 672], [660, 704], [460, 704]]); g.fillStyle = '#d6e2ee'; poly(g, [[460, 696], [664, 696], [660, 704], [460, 704]]); g.fillStyle = '#ffffff'; g.fillRect(490, 640, 140, 32); g.fillStyle = '#ff6f61'; g.fillRect(452, 688, 216, 6); g.fillStyle = '#2f89b8'; for (let i = 0; i < 6; i++) g.fillRect(500 + i * 21, 648, 13, 12); g.fillStyle = '#ffd23f'; g.fillRect(530, 624, 60, 16); g.fillStyle = '#d6e2ee'; g.fillRect(490, 668, 140, 4); }
  function q2fg(g) { g.fillStyle = vgrad(g, 800, 900, [[0, '#f6e7c6'], [1, '#ecd5a8']]); g.fillRect(-160, 800, 1920, 200); g.strokeStyle = '#dcc496'; g.lineWidth = 2; g.beginPath(); for (let i = -4; i < 30; i++) { g.moveTo(800 + (i - 12) * 74, 800); g.lineTo(800 + (i - 12) * 150, 900); } g.moveTo(-160, 832); g.lineTo(1760, 832); g.moveTo(-160, 872); g.lineTo(1760, 872); g.stroke(); g.fillStyle = '#d2bb8c'; g.fillRect(-160, 800, 1920, 6);
    /* the rail and its shadow */ g.fillStyle = rgba('#7a6a9a', .3); for (let i = 0; i < 24; i++) poly(g, [[-150 + i * 84, 806], [-141 + i * 84, 806], [-181 + i * 84, 850], [-190 + i * 84, 850]]); g.fillStyle = '#ffffff'; g.fillRect(-160, 716, 1920, 9); g.fillRect(-160, 758, 1920, 5); for (let i = 0; i < 24; i++) g.fillRect(-150 + i * 84, 716, 9, 90); g.fillStyle = '#c3d0de'; g.fillRect(-160, 723, 1920, 2); for (let i = 0; i < 24; i++) g.fillRect(-143 + i * 84, 725, 2, 81);
    gLamp(g, 760, 806, 330, '#3d4a66', '#ffffff', 0); g.fillStyle = '#8a5a3a'; g.fillRect(360, 772, 190, 8); g.fillRect(360, 746, 190, 7); g.fillStyle = '#3d4a66'; g.fillRect(376, 746, 6, 62); g.fillRect(528, 746, 6, 62); g.fillStyle = rgba('#7a6a9a', .3); poly(g, [[350, 808], [556, 808], [530, 824], [320, 824]]);
    gShadow(g, 1230, 848, 320, 15, '#5a4a8a', .5); gShadow(g, 1562, 850, 60, 8, '#5a4a8a', .45); lit(g, a => { a.save(); a.translate(1230, 846); a.scale(.92, .92); gCar(a, CAR, true); a.restore(); a.save(); a.translate(1562, 848); a.scale(.69, .69); gGuy(a, GUY); a.restore(); }, { dx: 2, dy: -3, rim: '#ffffff', shade: '#3d3a8a', sa: .34, x0: 1560, x1: 940, ra: .9 });
    gBranch(g, 1660, -30, 1.25, true, ['#1f7a4c', '#35ab69', '#8fe0a0', '#6a5040'], 23); }
  /* ---- ③ 码头 · 入夜: the last orange under an indigo sky, the yard under sodium lamps, the headlamp of the scooter */
  const HZ3 = '#5a2f86';
  function q3bg(g) { gSky(g, 660, [[0, '#0b0f3a'], [.3, '#1c1a62'], [.55, '#4a2a8a'], [.74, '#a8448f'], [.88, '#f0707a'], [1, '#ffb066']]); gGlow(g, 300, 690, 520, '#ffb066', .6);
    g.fillStyle = '#fff'; const r = rnd(71); for (let i = 0; i < 90; i++) { g.globalAlpha = .25 + r() * .7; disc(g, r() * 1700 - 50, r() * r() * 380, r() < .12 ? 2.2 : 1.1); } g.globalAlpha = 1; g.fillStyle = '#fff3d0'; disc(g, 1250, 150, 34); g.fillStyle = '#131450'; disc(g, 1234, 142, 31); gGlow(g, 1262, 156, 120, '#fff3d0', .25);
    gStreak(g, -100, 580, 900, 14, '#ffc078', .7); gStreak(g, 500, 540, 800, 10, '#ff8a80', .55); const C = ['#43297e', '#5f3492', '#f0707f', null]; gCloud(g, 470, 470, 460, 84, C, 72, -.7, 1); gCloud(g, 60, 330, 320, 56, C, 73, -.3, 1); gCloud(g, 1040, 330, 260, 40, ['#33206e', '#4a2b86', '#b0508f', null], 74, -.8, 1);
    gCity(g, 75, 660, 60, 300, { walls: ['#6a3a96', '#5a3090', '#7a429a'], haze: HZ3, k: .4, win: '#3a1f70', lit: '#ffd98a', p: .4, sun: -1, fog: .5, wmin: 36, wmax: 92, kinds: [0, 2, 1, 2], tall: .2 }); gTower(g, 760, 660, 440, '#5a3090', '#ffd98a'); }
  function q3mid(g) { gWater(g, 660, [[0, '#b8508c'], [.2, '#5a3494'], [.6, '#261a66'], [1, '#12103f']], '#ffc88a', 300, 210, 40); const rr = rnd(77); g.fillStyle = '#ffd98a'; for (let i = 0; i < 36; i++) { g.globalAlpha = .2 + rr() * .35; g.fillRect(rr() * 1700 - 50, 662, 2.5, 10 + rr() * 34); } g.globalAlpha = 1;
    const cc = ['#e0584c', '#e6a93a', '#2a9a90', '#6a5fd0', '#d8d2e6', '#3f6fd8'], dim = c => mixc(c, '#1a1250', .38);
    /* a freighter */ g.fillStyle = '#1c1250'; poly(g, [[-80, 708], [420, 708], [384, 752], [-60, 752]]); g.fillStyle = '#e0584c'; g.fillRect(-70, 742, 460, 5); g.fillStyle = '#d8d2e6'; g.fillRect(250, 630, 96, 78); g.fillStyle = '#1c1250'; g.fillRect(280, 600, 34, 32); g.fillStyle = '#ffe9a8'; for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) g.fillRect(258 + i * 17, 640 + j * 20, 10, 9); gGlow(g, 298, 664, 90, '#ffe9a8', .35); for (let i = 0; i < 8; i++) for (let k = 0; k < 1 + (i * 7 % 3); k++) { g.fillStyle = dim(cc[(i + k * 2) % 6]); g.fillRect(-56 + i * 37, 684 - k * 23, 35, 22); }
    /* the quay */ g.fillStyle = vgrad(g, 752, 900, [[0, '#3a2670'], [.5, '#2a1a5a'], [1, '#170f3a']]); g.fillRect(520, 752, 1240, 200); g.fillStyle = '#4e3690'; g.fillRect(520, 752, 1240, 5); g.fillStyle = vgrad(g, 800, 900, [[0, '#2a1a5a'], [1, '#170f3a']]); g.fillRect(-160, 800, 700, 120); g.fillStyle = '#4e3690'; g.fillRect(-160, 800, 700, 4);
    /* stacks */ for (let x = 560; x < 1740; x += 132) { const n = 1 + ((rr() * 3.4) | 0); if (x > 950 && x < 1100) continue; for (let k = 0; k < n; k++) { const c = dim(cc[(rr() * 6) | 0]), y = 752 - (k + 1) * 46; g.fillStyle = c; g.fillRect(x, y, 126, 44); g.fillStyle = rgba('#0b0830', .28); for (let i = 1; i < 10; i++) g.fillRect(x + i * 12.6, y, 2.5, 44); g.fillStyle = rgba('#ffffff', .2); g.fillRect(x, y, 126, 3); g.fillStyle = rgba('#ffffff', .5); g.fillRect(x + 84, y + 10, 30, 3); g.fillRect(x + 84, y + 17, 18, 3); } }
    /* two gantry cranes with work lights */ for (const [cx, s] of [[860, 1], [1390, .82]]) { g.save(); g.translate(cx, 752); g.scale(s, s); g.fillStyle = '#1a1250'; g.strokeStyle = '#1a1250'; g.fillRect(-74, -430, 15, 430); g.fillRect(60, -430, 15, 430); g.fillRect(-84, -300, 168, 12); g.fillRect(-84, -130, 168, 10); g.fillRect(-340, -444, 540, 18); poly(g, [[-11, -560], [11, -560], [19, -444], [-19, -444]]); g.fillRect(-46, -426, 64, 40); g.fillRect(-84, -8, 40, 8); g.fillRect(50, -8, 40, 8);
      g.lineWidth = 4; g.beginPath(); g.moveTo(0, -556); g.lineTo(-330, -444); g.moveTo(0, -556); g.lineTo(190, -444); g.moveTo(-74, -288); g.lineTo(60, -130); g.moveTo(75, -288); g.lineTo(-59, -130); g.moveTo(-74, -420); g.lineTo(60, -300); g.moveTo(75, -420); g.lineTo(-59, -300); g.stroke(); g.lineWidth = 2; g.beginPath(); g.moveTo(-232, -426); g.lineTo(-232, -250); g.moveTo(-212, -426); g.lineTo(-212, -250); g.stroke(); g.fillStyle = dim('#e6a93a'); g.fillRect(-262, -250, 80, 30);
      g.fillStyle = '#3a2a7a'; g.fillRect(-340, -444, 540, 3); g.fillRect(-74, -430, 3, 430); g.fillRect(60, -430, 3, 430); g.fillStyle = '#ff5a48'; disc(g, 0, -564, 5); g.fillStyle = '#fff3c0'; rrect(g, -30, -390, 30, 8, 3); g.restore(); gGlow(g, cx, 752 - 564 * s, 30, '#ff5a48', .7); gGlow(g, cx - 15 * s, 752 - 380 * s, 150 * s, '#ffe7a0', .32); }
    /* yard lamps */ for (const x of [640, 1180, 1620]) { g.fillStyle = '#1a1250'; g.fillRect(x - 3, 430, 6, 324); g.fillRect(x - 26, 428, 52, 5); g.fillStyle = '#ffe7a0'; rrect(g, x - 26, 433, 18, 6, 2); rrect(g, x + 8, 433, 18, 6, 2); gGlow(g, x, 440, 150, '#ffc86a', .5); g.fillStyle = vgrad(g, 440, 760, [[0, rgba('#ffc86a', .18)], [1, rgba('#ffc86a', 0)]]); poly(g, [[x - 20, 440], [x + 20, 440], [x + 150, 760], [x - 150, 760]]); const gr = g.createRadialGradient(x, 0, 0, x, 0, 200); gr.addColorStop(0, rgba('#ffc86a', .42)); gr.addColorStop(1, rgba('#ffc86a', 0)); g.save(); g.translate(0, 770); g.scale(1, .12); g.fillStyle = gr; g.fillRect(x - 200, -200, 400, 400); g.restore(); } }
  function q3fg(g) { g.fillStyle = vgrad(g, 812, 900, [[0, '#2a1a5a'], [1, '#120b30']]); g.fillRect(-160, 812, 1920, 120); g.fillStyle = rgba('#ffc86a', .12); for (let i = 0; i < 12; i++) g.fillRect(-100 + i * 160, 852, 76, 4);
    /* the headlamp cone, then the car */ const gr = g.createLinearGradient(1352, 0, 1760, 0); gr.addColorStop(0, rgba('#fff3c0', .5)); gr.addColorStop(1, rgba('#fff3c0', 0)); g.fillStyle = gr; poly(g, [[1352, 728], [1760, 652], [1760, 842], [1352, 744]]); const g2 = g.createRadialGradient(1500, 0, 0, 1500, 0, 260); g2.addColorStop(0, rgba('#fff3c0', .4)); g2.addColorStop(1, rgba('#fff3c0', 0)); g.save(); g.translate(0, 822); g.scale(1, .1); g.fillStyle = g2; g.fillRect(1240, -260, 520, 520); g.restore();
    gShadow(g, 1080, 816, 320, 12, '#07041c', .7); gShadow(g, 700, 816, 60, 8, '#07041c', .6); lit(g, a => { a.save(); a.translate(1080, 812); a.scale(.9, .9); gCar(a, CAR); a.restore(); a.save(); a.translate(700, 814); a.scale(.68, .68); gGuy(a, GUY); a.restore(); }, { dx: -3, dy: -2, rim: '#ffc86a', shade: '#140a50', sa: .62, x0: 680, x1: 1360 }); gGlow(g, 1352, 735, 44, '#fff6d0', .95); gGlow(g, 810, 735, 26, '#ff4b3e', .8);
    sil(g, a => { for (let i = 0; i < 4; i++) { rrect(a, 60 + i * 230, 792, 30, 26, 8); a.fillRect(52 + i * 230, 812, 46, 8); } }, '#0e0830', [[2, -2, '#ffb066']]); }
  const PANELS = [
    { tag: '老城区', name: '玉埠', line: '牌坊、茶楼、金铺，还有一整条街的灯笼。', layers: [q1bg, q1mid, q1fg] },
    { tag: '海边', name: '滨海步道', line: '沿着海一直走，能走到大桥下面。', layers: [q2bg, q2mid, q2fg] },
    { tag: '货运区', name: '码头', line: '吊机、货柜和夜里才开门的仓库。', layers: [q3bg, q3mid, q3fg] }
  ];
  /** poster(canvas, index, layers?) — paint one poster (all three layers, or the listed ones) onto a canvas at its own pixel size, 16:9 cover */
  function poster(cv, idx, only) { const P = PANELS[((idx | 0) % PANELS.length + PANELS.length) % PANELS.length], g = cv.getContext('2d'), W = cv.width, H = cv.height, S = Math.max(W / 1600, H / 900); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; if (!only) { g.fillStyle = '#2c1b63'; g.fillRect(0, 0, W, H); }
    for (let i = 0; i < 3; i++) { if (only && only.indexOf(i) < 0) continue; g.save(); g.setTransform(S, 0, 0, S, (W - 1600 * S) / 2, (H - 900 * S) * .92); g.lineJoin = g.lineCap = 'round'; try { P.layers[i](g, S); } catch (e) { console.error('[front] poster', e); } g.restore(); } return cv; }
  /*@@ENDART@@*/

  /* ------------------------------------------------------------------ g6 page glue: the error box is a debug tool (shown with ?debug=1, otherwise the text goes to the console); the HUD objective (.cn-mission, built by js/cngame.js)
     gets its mission name wrapped in <em> so css/cn.css can set it in yellow: "过早 · 出门" -> <em>过早</em>出门, and [词] inside an objective becomes a yellow keyword. */
  try { if (Q.get('debug') === '1') doc.documentElement.classList.add('gt-debug'); const f0 = window.GTfail; if (typeof f0 === 'function' && !f0._g6) { const f1 = function (m) { try { console.error('[GT] ' + m); } catch (e) { /* no console */ } return f0(m); }; f1._g6 = true; window.GTfail = f1; } } catch (e) { /* not in a page */ }
  function missionMark() { const sp = doc.querySelector('.cn-mission span'); if (!sp || sp._g6) return; sp._g6 = true;
    const paint = () => { const raw = sp.textContent; if (raw === sp._txt) return; const i = raw.indexOf(' · '), head = i > 0 && i <= 10 ? raw.slice(0, i) : '', rest = head ? raw.slice(i + 3) : raw;
      const html = (head ? '<em>' + esc(head) + '</em>' : '') + esc(rest).replace(/\[([^\]]{1,16})\]/g, '<u>$1</u>').replace(/【([^】]{1,16})】/g, '<u>$1</u>'); sp._raw = raw; mo.disconnect(); sp.innerHTML = html; sp._txt = sp.textContent; mo.observe(sp, { childList: true, characterData: true, subtree: true }); };
    const mo = new MutationObserver(() => { try { paint(); } catch (e) { /* cosmetic */ } }); mo.observe(sp, { childList: true, characterData: true, subtree: true }); try { paint(); } catch (e) { /* cosmetic */ } }
  setInterval(() => { try { missionMark(); } catch (e) { /* cosmetic */ } }, 500);
  /* a2 — a calmer wanted corner (display only; js/economy.js and js/cngame.js still write the same nodes): the three wallet chips (.ec-hud) and the reputation bar (.ec-rep) show for 5 s after their text changes
     (css keeps them up while the phone is open); the long status line (.ec-out) is cut to its first and third part ("被盯着 · 离开大马路") through data-s, the full text stays in the node. */
  const A2 = { seen: new Map() };
  function hudCalm() { const now = Date.now(); for (const sel of ['.ec-hud', '.ec-rep']) { const el = doc.querySelector(sel); if (!el) continue; const txt = el.textContent, m = A2.seen.get(sel); if (!m) { A2.seen.set(sel, { txt, t: 0 }); continue; } if (m.txt !== txt) { m.txt = txt; m.t = now; } el.classList.toggle('a2-show', now - m.t < 5000); }
    const out = doc.querySelector('.ec-out b'); if (out) { const raw = out.textContent; if (raw !== A2.out) { A2.out = raw; const seg = raw.split(' · ').filter(x => !/^\d+ 组$/.test(x)); out.parentNode.setAttribute('data-s', seg.slice(0, 2).join(' · ')); } } }
  setInterval(() => { try { hudCalm(); } catch (e) { /* cosmetic */ } }, 400);

  /* ------------------------------------------------------------------ public API (exactly the SPEC-STORY contract, plus a few clearly-marked extras) */
  const api = {
    init, splash: o => SPL.run(o),
    loading: { show: o => LOAD.show(o), progress: (p, label) => LOAD.progress(p, label), hide: () => LOAD.hide() },
    menu: { show: o => MENU.show(o), hide: () => MENU.hide() },
    pause: { show: o => PAUSE.show(o), hide: () => PAUSE.hide() },
    settings, onSettings: cb => on('settings', cb),
    letterbox, fade, subtitle, ambient, clearSubtitles, credit, titleCard, locationCard, objective, hint, phone, poster, get posters() { return PANELS.map(p => ({ tag: p.tag, name: p.name, line: p.line })); },
    missionCard: o => MIS.show(o), creditsRoll, skipHint, onSkip: cb => on('skip', cb), on,
    get busy() { return !!(BUSY.splash || BUSY.loading || BUSY.menu || BUSY.pause || BUSY.mission || BUSY.roll); },
    /* extras (not in the contract; safe to ignore) */
    settingsPanel: { show: () => SET.show(MENU.on ? E.menu : PAUSE.on ? E.pause : null), hide: () => SET.hide() }, _seek: seek, _clock: CLK, _art: ART
  };
  GT.front = api;

  /* ------------------------------------------------------------------ self-demo: showcase.html?m=front&screen=...&at=<s> */
  GT.showcase.front = ({ scene, T }) => {
    const screen = Q.get('screen') || 'menu', at = Q.get('at'), noop = () => {};
    try { // something to look at behind the overlays: the real world when those modules are loaded, otherwise a few kit shapes under the fallback sky
      let built = false; for (const m of ['road', 'station', 'motel']) if (GT[m] && GT[m].build) { GT[m].build(scene); built = true; }
      if (!built) { const k = GT.kit(); k.box('asphalt', 400, .2, 400, 0, -.1, 0); for (let i = 0; i < 9; i++) { k.cyl('palm_trunk', .16, .22, 9, -14 + i * 9, 4.5, -8 - (i % 3) * 7); k.sphere('palm_leaf', 2.2, -14 + i * 9, 9.4, -8 - (i % 3) * 7, { s: [1.5, .5, 1.5] }); } k.box('stucco_cream', 26, 5, 10, 22, 2.5, -30, { bevel: .05 }); k.box('metal_painted_red', 4.6, 1.2, 1.9, 4, .7, 0, { bevel: .2 }); scene.add(k.build()); }
    } catch (e) { console.error(e); }
    init(); const F = api;
    const D = {
      splash: () => F.splash(), loading: () => { F.loading.show(Q.get('panel') !== null ? { panel: +Q.get('panel'), hold: true, instant: true } : { instant: true }); F.loading.progress(+(Q.get('p') || .62), '正在搭建街区'); },
      menu: () => F.menu.show({ canContinue: Q.get('cont') !== '0', onNew: noop, onContinue: noop }), pause: () => F.pause.show({ onResume: noop, onRestart: noop, onMenu: noop }),
      settings: () => { if (Q.get('from') === 'pause') D.pause(); else D.menu(); F.settingsPanel.show(); },
      title: () => { F.letterbox(true, 0); F.titleCard({ title: 'BILIBILI THEFT AUTO 1', chapter: '第一章', name: '零钱', seconds: 4.5 }); },
      mission: () => F.missionCard({ result: 'passed', title: '第一章 · 零钱', take: 9424, rating: 'A', lines: [{ label: '用时', value: '04:12' }, { label: '最高通缉', value: '★★★' }, { label: '换车', value: '1 次' }, { label: '车损', value: '轻微' }] }),
      fail: () => F.missionCard({ result: 'failed', title: '第一章 · 零钱', lines: [{ label: '用时', value: '02:47' }, { label: '最高通缉', value: '★★★★' }, { label: '原因', value: '被捕' }] }),
      credits: () => { F.letterbox(true, 0); F.credit('出品', 'B STAR', { where: Q.get('where') || 'bl' }); if (Q.get('where') === null) { F.credit('驾驶', '阿凯', { where: 'tr' }); } },
      roll: () => F.creditsRoll(), subs: () => { if (Q.get('lb') === '1') F.letterbox(true, 0); F.subtitle('电台', '……这里是海岸电台。Costa Brisa 傍晚六点十分，气温三十一度，湿度高到你可以直接游着去上班。'); F.subtitle('阿烈', '哥！准时。你一向准时。'); },
      phone: () => { F.phone({ from: '郝老板', text: '阿凯，周五到了。四万。我不想亲自去问候你母亲。' }); }, hint: () => { F.objective('开到汽车旅馆接阿烈'); F.hint(['W', 'A', 'S', 'D'], '驾驶', 0); },
      loc: () => { F.letterbox(Q.get('lb') !== '0', 0); F.locationCard('COSTA BRISA · 海滨公路 · 星期四 18:10'); F.skipHint(true); },
      all: () => { F.objective('开到汽车旅馆接阿烈'); F.hint(['鼠标'], '环顾', 0); F.subtitle('阿凯', '说好不干了。'); F.phone({ from: '阿烈', text: '哥，来 旅馆 接我。有个小活儿。五分钟的事。' }); F.credit('音乐', '由代码即兴', { where: 'br' }); F.locationCard('COSTA BRISA', '海滨公路 · 星期四 18:10'); },
      fadehalf: () => { F.fade(.5, 0); F.subtitle('电台', '……这里是海岸电台。'); }
    };
    try { (D[screen] || D.menu)(); } catch (e) { console.error(e); throw e; }
    if (at !== null) seek(+at);
    return { cam: [-16, 3.2, 26], look: [20, 5.5, -20], hours: 18.2 };
  };
})();
