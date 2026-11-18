/* story.js — SUNSET HEAT: the director. Owns the flow around the heist that js/game.js already plays:
     splash -> loading (real world build) -> main menu over a live flyby -> cold open + opening credits -> phone -> playable prologue drive
     -> pickup cutscene -> drive to the station -> crane shot + late title card -> [existing WAIT/HEAT/SWAP/CLEAN] -> mission card -> stinger -> credits -> menu.
   All 2D presentation goes through GT.front (js/front.js, another owner); every call is feature-detected and falls back to a tiny built-in overlay,
   so the flow never dead-ends. Cinematics are pure time-lines (fixed shot lengths, cues at fixed times): they can be skipped (hold Enter), fast-forwarded
   (?auto=<state>&at=<s>) and simulated headless (self-test). Skipping always lands in the beat's canonical post-state.
   GT.story = { wants(Q), boot(plan), start('new'|'continue'), skip(), jump(state, at), toMenu(), state, selftest(line), + the seams game.js calls
               (cine, drive, hold, pre, ui, marker, step, camera, blockKeys, pauseUI, autopilot, onEnd, onLock) }
   URL: ?story=0 (legacy boot straight into the heist)   ?auto=menu|intro|phone|drive1|pickup|drive2|title|stinger|card|cardfail  &at=<s>  &run=1 (keep playing)
        ?auto=cam&pos=x,y,z&look=x,y,z&fov=35&stage=prologue|pickup|title|stinger   (free camera over a staged world, for composing shots) */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!GT || !T) return;
  const clamp = GT.clamp, lerp = GT.lerp, sstep = GT.sstep, angDiff = GT.angDiff, PI = Math.PI, hyp = Math.hypot, L = GT.L;
  const fail = m => { if (window.GTfail) window.GTfail(m); else console.error(m); };
  let X = null, G = null, P = null, CAM = null;                           // game internals, bound in bind()
  /** entry style: true = the cold open hands over to the player with no fade / letterbox pop (bars slide away while the camera settles into the driving view, subtitles run across the cut); false = classic fade + reset */
  const SEAMLESS_HANDOFF = true;
  const STORY_AUTO = ['logo', 'trailer', 'loading', 'menu', 'intro', 'phone', 'drive1', 'pickup', 'drive2', 'title', 'stinger', 'card', 'cardfail', 'cam'];
  const H0 = 18 + 10 / 60, HNIGHT = 21.3;

  /* ------------------------------------------------------------------ marks (world coordinates; composed against the built world) */
  const HERO0 = { x: -5.6, z: -166.4, h: -.6 };                            // cold open: pulled up at the sea-side kerb of the closed south end, nose angled at the water (north-bound lane, so pulling out is one easy move)
  const VEND = { x: 73.25, z: 86.9, h: -PI / 2, lift: .14 };               // 阿烈 waits on the motel walkway by the ice + vending alcove
  const PICK = { x: 59.5, z: 85.6, h: PI };                                  // pickup mark in the lot aisle: passenger door faces the vending machines
  const STALL = L.heroStart;                                               // the stall in front of the store (the heist starts here)
  const STING = { x: 91, z: 92, h: 0 };                                  // stinger: behind the motel's east wing
  const SEAT = { x: -.43, y: -.03, z: -.42, yx: -.33 };                    // passenger seat (same offsets game.js uses); yx: seen from outside the figure has to sit lower or his head clears the roof

  const S = GT.story = {
    on: true, state: 'boot', cine: false, drive: false, hold: false, pre: false, ui: true, marker: null, lockLook: false,
    silent: false, ff: false, ffTarget: 0, ffPending: [], tlHold: false, fadeLevel: 0, t: 0, skipping: false, pending: null, quality: 'high', mblur: 1,
    frontIssues: {}, lastResult: null, idle: 0, simFF: false, tlExt: false, free: null
  };

  /* ------------------------------------------------------------------ save (localStorage; in-memory during the self-test) */
  const SAVE_KEY = 'sunsetheat.save.v1';
  const save = { data: { prologue: false, chapter1: false, best: 0 }, mem: false,
    load() { if (this.mem) return; try { const o = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (o && typeof o === 'object') Object.assign(this.data, o); } catch (e) { /* private mode */ } },
    put(k, v) { this.data[k] = v; if (this.mem) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ } } };

  /* ------------------------------------------------------------------ fallback overlays (used only for GT.front methods that are missing or throw) */
  const FB = (function () {
    let root = null; const el = {}, tm = {};
    const css = '#sfb{position:fixed;inset:0;z-index:40;pointer-events:none;color:#f4ead6;font-family:"Avenir Next Condensed","DIN Condensed","Arial Narrow","PingFang SC","Microsoft YaHei",sans-serif}' +
      '#sfb>div{position:absolute}#sfb .bar{left:0;right:0;height:0;background:#000;transition:height .6s}#sfb .bar.t{top:0}#sfb .bar.b{bottom:0}#sfb.lb .bar{height:11vh}' +
      '#sfb .fade{inset:0;background:#000;opacity:0}#sfb .sub{left:10%;right:10%;bottom:14vh;text-align:center;font-size:2.6vh;text-shadow:0 1px 4px #000;opacity:0;transition:opacity .25s}#sfb .sub b{color:#ff9a4d;margin-right:.6em;letter-spacing:.1em}' +
      '#sfb .on{opacity:1!important}#sfb .credit{font-size:3.4vh;letter-spacing:.16em;opacity:0;transition:opacity .5s;text-shadow:0 1px 6px #000}#sfb .credit small{display:block;font-size:1.6vh;opacity:.75;letter-spacing:.3em}' +
      '#sfb .credit.bl{left:7vw;bottom:17vh}#sfb .credit.br{right:7vw;bottom:17vh;text-align:right}#sfb .credit.tl{left:7vw;top:17vh}#sfb .credit.tr{right:7vw;top:17vh;text-align:right}#sfb .credit.c{left:0;right:0;top:44vh;text-align:center}' +
      '#sfb .title{inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity .35s}#sfb .title h1{font-size:min(15vh,6.4vw);white-space:nowrap;margin:0;letter-spacing:.08em;font-weight:700}#sfb .title p{font-size:2.6vh;letter-spacing:.5em;margin:1vh 0 0}' +
      '#sfb .loc{left:5vw;bottom:15vh;font-size:2.4vh;letter-spacing:.2em;opacity:0;transition:opacity .5s}#sfb .loc small{display:block;font-size:1.7vh;opacity:.8}' +
      '#sfb .obj{left:0;right:0;top:5vh;text-align:center;font-size:2.3vh;letter-spacing:.14em;opacity:0;transition:opacity .4s;text-shadow:0 1px 4px #000}' +
      '#sfb .hint{right:3vw;bottom:9vh;font-size:2vh;opacity:0;transition:opacity .3s}#sfb kbd{display:inline-block;border:1px solid #f4ead6;border-radius:3px;padding:0 .5em;margin-right:.3em;font:inherit}' +
      '#sfb .phone{right:3vw;bottom:16vh;width:30vw;max-width:420px;background:rgba(12,12,14,.86);border-left:3px solid #ff9a4d;padding:1.6vh 1.2vw;font-size:2.1vh;opacity:0;transform:translateY(3vh);transition:opacity .35s,transform .35s}#sfb .phone.on{transform:none}#sfb .phone b{display:block;color:#ff9a4d;font-size:1.6vh;letter-spacing:.2em;margin-bottom:.5vh}' +
      '#sfb .skip{right:3vw;top:13vh;font-size:1.6vh;letter-spacing:.2em;opacity:0}#sfb .panel{inset:0;display:none;flex-direction:column;justify-content:center;padding-left:9vw;background:rgba(6,7,9,.55);pointer-events:auto}#sfb .panel.full{background:#060709}' +
      '#sfb .panel h1{font-size:min(9vh,5.6vw);margin:0 0 3vh;letter-spacing:.08em}#sfb .panel p{font-size:2.2vh;margin:.4vh 0;letter-spacing:.1em;opacity:.85}#sfb .panel li{list-style:none;font-size:3.2vh;letter-spacing:.2em;padding:.6vh 0;opacity:.6;cursor:pointer}#sfb .panel li.sel{opacity:1;color:#ff9a4d}#sfb .panel ul{padding:0;margin:0}' +
      '#sfb .panel i{display:block;width:30vw;height:2px;background:#333;margin-top:2vh}#sfb .panel i u{display:block;height:100%;width:0;background:#ff9a4d}body.cine #hud{opacity:0}';
    function init() { if (root) return; const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      root = document.createElement('div'); root.id = 'sfb';
      for (const c of ['bar t', 'bar b', 'sub', 'credits', 'title', 'loc', 'obj', 'hint', 'phone', 'skip', 'fade', 'panel']) { const d = document.createElement('div'); d.className = c; root.appendChild(d); el[c.split(' ').pop()] = d; }
      el.skip.textContent = '按住 Enter 跳过'; document.body.appendChild(root); }
    const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const timed = (k, e, sec) => { clearTimeout(tm[k]); e.classList.add('on'); if (sec > 0) tm[k] = setTimeout(() => e.classList.remove('on'), sec * 1000); };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let modal = null;
    function panel(html, full, keyFn, clickFn) { init(); closePanel(); el.panel.innerHTML = html; el.panel.className = 'panel' + (full ? ' full' : ''); el.panel.style.display = 'flex';
      modal = { key: e => { if (keyFn) { e.preventDefault(); e.stopImmediatePropagation(); keyFn(e); } }, click: e => { if (clickFn) clickFn(e); } };
      addEventListener('keydown', modal.key, true); el.panel.addEventListener('mousedown', modal.click); }
    function closePanel() { if (!modal) return; removeEventListener('keydown', modal.key, true); el.panel.removeEventListener('mousedown', modal.click); modal = null; el.panel.style.display = 'none'; el.panel.innerHTML = ''; }
    function list(title, items, sub) { let sel = 0; const draw = () => { el.panel.querySelectorAll('li').forEach((li, i) => li.classList.toggle('sel', i === sel)); };
      panel('<h1>' + esc(title) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '<ul>' + items.map(it => '<li>' + esc(it[0]) + '</li>').join('') + '</ul>', false,
        e => { if (e.code === 'ArrowDown' || e.code === 'KeyS') sel = (sel + 1) % items.length; else if (e.code === 'ArrowUp' || e.code === 'KeyW') sel = (sel + items.length - 1) % items.length; else if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) { const f = items[sel][1]; if (f) f(); return; } draw(); },
        e => { const li = e.target.closest && e.target.closest('li'); if (!li) return; const i = Array.prototype.indexOf.call(li.parentNode.children, li); if (items[i] && items[i][1]) items[i][1](); }); draw(); }
    return {
      init,
      splash() { return new Promise(res => { let done = false; const go = () => { if (done) return; done = true; closePanel(); res(); };
        panel('<h1>B STAR</h1><p>本作所有画面、模型、声音均由代码生成</p><p>游戏会自动保存进度</p>', true, go, go); setTimeout(go, 2600); }); },
      loading: { show() { panel('<h1>BILIBILI THEFT AUTO 1</h1><p class="lbl">正在加载</p><i><u></u></i>', true); },
        progress(p, label) { const u = el.panel && el.panel.querySelector('u'); if (u) u.style.width = Math.round(clamp(p, 0, 1) * 100) + '%'; const l = el.panel && el.panel.querySelector('.lbl'); if (l && label) l.textContent = label; },
        hide() { closePanel(); return Promise.resolve(); } },
      menu: { show(o) { o = o || {}; const it = []; if (o.canContinue) it.push(['继续', o.onContinue]); it.push(['新的故事', o.onNew]); if (o.onCredits) it.push(['制作名单', o.onCredits]); list('BILIBILI THEFT AUTO 1', it, 'CALIDA KEYS · 18:10'); }, hide() { closePanel(); return Promise.resolve(); } },
      pause: { show(o) { o = o || {}; list('暂停', [['继续', o.onResume], ['从检查点重来', o.onRestart], ['回到主菜单', o.onMenu]]); }, hide() { closePanel(); } },
      settings: { volume: .8, sens: 1, quality: 'high', invertY: false, subtitles: true, radio: true },
      letterbox(on) { init(); root.classList.toggle('lb', !!on); document.body.classList.toggle('cine', !!on); },
      fade(v, ms) { init(); ms = ms === undefined ? 500 : ms; el.fade.style.transition = ms ? 'opacity ' + ms + 'ms' : 'none'; void el.fade.offsetWidth; el.fade.style.opacity = v; return sleep(ms); },
      subtitle(who, text, sec) { init(); if (!text) return; el.sub.innerHTML = (who ? '<b>' + esc(who) + '</b>' : '') + esc(text); timed('sub', el.sub, sec || clamp(1.3 + String(text).length * .17, 1.9, 7.5)); },
      clearSubtitles() { if (root) el.sub.classList.remove('on'); },
      credit(role, name, o) { init(); o = o || {}; const d = document.createElement('div'); d.className = 'credit ' + (o.where || 'bl'); d.innerHTML = '<small>' + esc(role) + '</small>' + esc(name); el.credits.appendChild(d); void d.offsetWidth; d.classList.add('on');
        const ms = (o.seconds || 3.2) * 1000; setTimeout(() => d.classList.remove('on'), ms - 500); setTimeout(() => d.remove(), ms + 200); return sleep(ms); },
      titleCard(o) { init(); o = o || {}; el.title.innerHTML = '<h1>' + esc(o.title || 'BILIBILI THEFT AUTO 1') + '</h1><p>' + esc((o.chapter || '') + (o.name ? ' · ' + o.name : '')) + '</p>'; const s = o.seconds || 4.5; timed('title', el.title, s); return sleep(s * 1000 + 350); },
      locationCard(name, sub, sec) { init(); el.loc.innerHTML = esc(name) + '<small>' + esc(sub || '') + '</small>'; timed('loc', el.loc, sec || 3.5); },
      objective(text) { init(); if (!text) { el.obj.classList.remove('on'); return; } el.obj.textContent = text; el.obj.classList.add('on'); },
      hint(keys, text, sec) { init(); if (!keys && !text) { el.hint.classList.remove('on'); return; } el.hint.innerHTML = [].concat(keys || []).map(k => '<kbd>' + esc(k) + '</kbd>').join('') + ' ' + esc(text); timed('hint', el.hint, sec === undefined ? 5 : sec); },
      phone(o) { init(); o = o || {}; el.phone.innerHTML = '<b>' + esc(o.from) + '</b>' + esc(o.text); const s = o.seconds || 5; timed('phone', el.phone, s); return sleep(s * 1000 + 400); },
      missionCard(o) { o = o || {}; return new Promise(res => { const t0 = performance.now(), go = () => { if (performance.now() - t0 < 900) return; closePanel(); res(); };
        panel('<p>' + esc(o.title || '') + '</p><h1>' + (o.result === 'failed' ? '失手' : '得手') + '</h1>' + (typeof o.take === 'number' ? '<p>$' + Math.round(o.take).toLocaleString('en-US') + (o.rating ? ' · ' + esc(o.rating) : '') + '</p>' : '') +
          (o.lines || []).map(l => '<p>' + esc(l.label) + '　' + esc(l.value) + '</p>').join('') + '<p>&nbsp;</p><p><kbd>Enter</kbd>' + (o.result === 'failed' ? '再来一次' : '继续') + '</p>', false, e => { if (e.code === 'Enter' || e.code === 'Space') go(); }, go); }); },
      creditsRoll(lines) { return new Promise(res => { let done = false; const go = () => { if (done) return; done = true; closePanel(); res(); };
        panel('<h1>BILIBILI THEFT AUTO 1</h1>' + (lines || []).map(l => Array.isArray(l) ? '<p>' + esc(l[0]) + '　' + esc(l[1]) + '</p>' : '<p>' + esc(String(l || '').replace(/^#/, '— ')) + '&nbsp;</p>').join(''), true, go, go); setTimeout(go, 14000); }); },
      skipHint(show) { init(); el.skip.classList.toggle('on', !!show); }
    };
  })();

  /* ------------------------------------------------------------------ GT.front adapter: ui('menu.show', {...}) */
  function resolve(root, parts) { let o = root; for (let i = 0; i < parts.length - 1; i++) o = o && o[parts[i]]; const fn = o && o[parts[parts.length - 1]]; return typeof fn === 'function' ? [o, fn] : null; }
  function ui(path) {
    if (S.silent) return undefined;
    const args = Array.prototype.slice.call(arguments, 1), parts = path.split('.');
    if (GT.front && !S.frontIssues[path]) { const f = resolve(GT.front, parts);
      if (f) { try { return f[1].apply(f[0], args); } catch (e) { S.frontIssues[path] = 'threw: ' + (e && e.message || e); console.warn('[story] GT.front.' + path + ' threw — using the built-in fallback', e); } }
      else S.frontIssues[path] = 'missing'; }
    const b = resolve(FB, parts); return b ? b[1].apply(b[0], args) : undefined;
  }
  const settings = () => (GT.front && GT.front.settings) || FB.settings;
  /** run cb once p settles; if p is not a promise, after ms. In silent (headless) mode cb runs synchronously. */
  function after(p, cb, ms) {
    if (S.silent) { cb(); return; }
    let done = false; const go = () => { if (done) return; done = true; try { cb(); } catch (e) { fail('[story] ' + (e.stack || e)); } };
    if (p && typeof p.then === 'function') { p.then(go, go); if (ms) setTimeout(go, ms * 3 + 2500); } else setTimeout(go, ms || 0);
  }
  /** for screens the player dismisses: resolves on the promise; if the front never gave one, any Enter/click after a beat continues */
  function afterUser(p, cb) { if (S.silent) { cb(); return; } let done = false; const go = () => { if (done) return; done = true; S.awaitKey = null; try { cb(); } catch (e) { fail('[story] ' + (e.stack || e)); } };
    if (p && typeof p.then === 'function') p.then(go, go); const t0 = performance.now(); S.awaitKey = () => { if (performance.now() - t0 > 1500 && (!(p && p.then) || (GT.front && GT.front.busy === false))) go(); }; }
  function fadeTo(v, ms) { S.fadeLevel = v; if (S.silent || S.ff) return null; return ui('fade', v, ms); }
  function letterbox(on, ms) { S.lb = !!on; if (S.silent) return; ui('letterbox', !!on, ms === undefined ? 600 : ms); document.body.classList.toggle('cine', !!on); }
  const sub = (who, text, sec) => ui('subtitle', who, text, sec);
  const sfx = (name, o) => { if (S.silent || S.ff || !G.audioOn || !GT.audio) return; try { GT.audio.sfx(name, o); } catch (e) { /* ignore */ } };
  const audio = fn => { if (S.silent || !G || !G.audioOn || !GT.audio) return; try { fn(GT.audio); } catch (e) { console.warn('[story] audio', e); } };

  /* ------------------------------------------------------------------ settings -> audio, look, renderer */
  function applyQuality(q) {
    q = q === 'low' || q === 'med' ? q : 'high'; if (q === S.quality || !G || !G.visual) return; S.quality = q;
    const R = GT.render, fx = R && R.fx, k = q === 'low' ? .7 : q === 'med' ? .85 : 1, cv = G.canvas;
    if (fx) { fx.ao = q !== 'low'; fx.vol = q === 'low' ? 0 : 1; fx.streak = fx.dirt = q === 'low' ? 0 : 1; fx.ca = q === 'low' ? 0 : 1; S.mblur = fx.mblur = q === 'high' ? 1 : 0; }
    try { if (R && R.setShadowQuality) R.setShadowQuality(q === 'low' ? 1 : q === 'med' ? 2 : 3, G.scene); } catch (e) { console.warn('[story] shadow quality', e); }
    // pixel ratio: render.js pins the ratio itself, so render to a smaller canvas box and let CSS scale it back up
    if (cv) { if (k < 1) { cv.style.width = (100 * k) + 'vw'; cv.style.height = (100 * k) + 'vh'; cv.style.transformOrigin = '0 0'; cv.style.transform = 'scale(' + (1 / k).toFixed(4) + ')'; } else { cv.style.width = cv.style.height = cv.style.transform = ''; }
      try { if (G.useFx && R && R.resize) R.resize(); else if (G.renderer) G.renderer.setPixelRatio(Math.min(1.5, devicePixelRatio || 1) * k); } catch (e) { console.warn('[story] resize', e); } }
  }
  const radioWanted = () => settings().radio !== false && (S.state === 'drive1' || S.state === 'drive2' || S.state === 'heist' || S.state === 'card');
  function applySettings() {
    if (!G) return; const s = settings() || {};
    G.sens = clamp(+s.sens || 1, .2, 3); G.invertY = !!s.invertY; G.subsOn = s.subtitles !== false; G.master = clamp(s.volume === undefined ? .8 : +s.volume, 0, 1);
    audio(A => { A.setMaster(G.paused ? G.master * .19 : G.master); if (s.radio === false && A.radioOn) A.setRadio(false); else if (s.radio !== false && !A.radioOn && radioWanted()) A.setRadio(true); });
    applyQuality(s.quality);
  }
  function ensureAudio() { if (!G || S.silent || G.auto || G.audioOn || !GT.audio || !GT.audio.init) return; try { G.audioOn = !!GT.audio.init(); } catch (e) { G.audioOn = false; } if (G.audioOn) { applySettings(); audio(A => A.ambience({ surf: .8 })); } }

  /* ------------------------------------------------------------------ director: time-lines of shots + cues */
  const D = { tl: null, clock: 0, cut: 0, v1: new T.Vector3(), v2: new T.Vector3() };
  const U = (t, d, fn) => ({ t, d, fn });                 // presentation cue (skipped when fast-forwarding past it)
  const Wc = (t, fn) => ({ t, fn, w: true });             // world cue (always runs)
  function mkTL(o) {
    const tl = { name: o.name, shots: o.shots, cues: (o.cues || []).slice(), len: 0, t: 0, ci: 0, si: -1, done: false, skippable: o.skip !== false, finish: o.finish || null, anchor: o.anchor || null, rt: !!o.rt, loop: !!o.loop };
    const fd = (v, sec) => () => { if (tl.name === 'menu' && (S.state !== 'menu' || S.leaving)) return; fadeTo(v, sec * 1000); };
    let t = 0; for (const s of tl.shots) { s.t0 = t; t += s.d; if (s.fi !== undefined) tl.cues.push(Wc(s.t0, fd(0, s.fi))); if (s.fo !== undefined) tl.cues.push(Wc(t - s.fo, fd(1, s.fo))); if (s.text) tl.cues.push(U(s.t0 + (s.textAt || 0), s.d, () => ui('credit', '', s.text, { where: 'c', seconds: s.d - (s.textAt || 0) + .25 }))); }
    tl.len = t; tl.cues.sort((a, b) => a.t - b.t); return tl;
  }
  const shotAt = (tl, t) => { let i = 0; while (i < tl.shots.length - 1 && t >= tl.shots[i].t0 + tl.shots[i].d) i++; return i; };
  function fire(c) { if (c.w) { c.fn(); return; } if (S.silent) return; if (S.ff) { if (c.t + (c.d || 0) > S.ffTarget) S.ffPending.push(c.fn); return; } c.fn(); }
  function legs(fig, hide) { const b = fig && fig.bones; if (!b || !b[13] || !b[16]) return; const k = hide ? .001 : 1; b[13].scale.setScalar(k); b[16].scale.setScalar(k); }   // seated figures seen from outside: fold the legs away (they would hang through the floor pan)
  function onShot(tl, sh) {
    D.cut = 2;
    if (sh.fp) { S.cine = false; S.lockLook = true; CAM.yaw = CAM.yawT = sh.fp.yaw || 0; CAM.pitch = CAM.pitchT = sh.fp.pitch === undefined ? -.05 : sh.fp.pitch; if (sh.fp.yaw1 !== undefined) CAM.yawT = sh.fp.yaw1; if (sh.fp.pitch1 !== undefined) CAM.pitchT = sh.fp.pitch1; CAM.back = 0; if (CAM.mode !== 'fp') { CAM.mode = 'fp'; CAM.init = false; } }
    else S.cine = true;
    if (tl.name === 'trailer') { G.freeze = !!sh.hold && !S.silent; G.input.lookBack = !!sh.back; if (sh.back) CAM.back = 1; if (sh.h !== undefined) G.holdHours = sh.h; if (sh.pre) sh.pre(); if (G.Q && G.Q.get('debug') === '1') fail('trailer shot ' + tl.si + ' @' + tl.t.toFixed(1) + ' sim ' + G.time.toFixed(1) + ' ' + G.phase + ' pos ' + P.x.toFixed(0) + ',' + P.z.toFixed(0) + ' v ' + hyp(P.vx, P.vy).toFixed(0) + ' cops ' + G.cops.length + ' hot ' + X.W.hot + ' stars ' + X.W.stars.toFixed(1)); }
    const pt = G.partner; if (pt && pt.seat) { pt.seat.y = S.cine ? SEAT.yx : SEAT.y; legs(pt.fig, S.cine); }
    driver(!!sh.drv && S.cine);
    if (sh.on) sh.on();
  }
  function tlAdvance(tl, dt) {
    if (!tl || tl.done || S.tlHold) return;
    if (tl.si < 0) { tl.si = 0; onShot(tl, tl.shots[0]); }
    tl.t += dt; if (tl.loop && tl.t >= tl.len) { tl.t -= tl.len; tl.ci = 0; }
    while (tl.ci < tl.cues.length && tl.cues[tl.ci].t <= tl.t) { fire(tl.cues[tl.ci++]); if (D.tl !== tl) return; }
    if (!tl.loop && tl.t >= tl.len) { endBeat(tl); return; }
    const si = shotAt(tl, tl.t); if (si !== tl.si) { tl.si = si; onShot(tl, tl.shots[si]); }
  }
  /** sim-driven time-lines advance with the simulation; real-time ones (menu flyby, trailer) with the frame clock — or with the sim when there are no frames (self-test, ?auto= fast-forward) */
  function tlStep(dt) { const tl = D.tl; if (tl && !S.simFF && !S.tlExt && (!tl.rt || S.silent || S.ff)) tlAdvance(tl, dt); }
  function endBeat(tl) { if (tl.done) return; tl.done = true; if (D.tl === tl) D.tl = null; S.lockLook = false; driver(false); const pt = G.partner; if (pt) legs(pt.fig, false); if (tl.finish) tl.finish(); }
  function play(tl) { D.tl = tl; S.skipping = false; if (!tl.rt) { tl.si = 0; onShot(tl, tl.shots[0]); } return tl; }
  /** run the simulation silently until pred() or max seconds (hard cuts in the trailer hide the jump) */
  function ffUntil(pred, max) { const was = G.silent; G.silent = true; S.simFF = true; let n = 0; const N = Math.round((max || 10) * 60); try { while (n++ < N && !(pred && pred())) GT.game.step(1 / 60); } finally { G.silent = was; S.simFF = false; } return n / 60; }
  const bez = (a, u, out) => { if (a.length === 2) return out.set(lerp(a[0][0], a[1][0], u), lerp(a[0][1], a[1][1], u), lerp(a[0][2], a[1][2], u));
    const v = 1 - u, k0 = v * v, k1 = 2 * v * u, k2 = u * u; return out.set(a[0][0] * k0 + a[1][0] * k1 + a[2][0] * k2, a[0][1] * k0 + a[1][1] * k1 + a[2][1] * k2, a[0][2] * k0 + a[1][2] * k1 + a[2][2] * k2); };
  /** car-local [left, up, forward] -> world, around an anchor pose {x,z,h} */
  const fromLocal = (v, a) => { const s = Math.sin(a.h), c = Math.cos(a.h), lx = v.x, lz = v.z; v.x = a.x + c * lx + s * lz; v.z = a.z - s * lx + c * lz; return v; };
  S.camera = function (cam, dt) {
    D.clock += dt; const fx = GT.render && GT.render.fx;
    if (fx) { if (D.cut > 0) { D.cut--; fx.mblur = 0; } else if (fx.mblur !== S.mblur) fx.mblur = S.mblur; }
    if (S.free) { cam.position.fromArray(S.free.pos); cam.up.set(0, 1, 0); cam.lookAt(D.v2.fromArray(S.free.look)); if (cam.fov !== S.free.fov) { cam.fov = S.free.fov; cam.updateProjectionMatrix(); } return; }
    if (D.tl && D.tl.rt && !S.silent && !S.ff && !G.paused) { if (S.state === 'menu') menuIdle(dt); tlAdvance(D.tl, dt); }
    const tl = D.tl; if (!tl || tl.si < 0) return;
    const sh = tl.shots[tl.si]; if (!sh || sh.fp || (!sh.p && !sh.cam)) return;
    const lt = tl.t - sh.t0; let u = clamp(lt / sh.d, 0, 1); const sm = u * u * (3 - 2 * u); u = sh.e === 'io' ? sm : sh.e === 'o' ? 1 - (1 - u) * (1 - u) : lerp(u, sm, .3);
    const p = D.v1, l = D.v2; let f;
    if (sh.cam) f = sh.cam(lt, u, p, l);
    else { bez(sh.p, u, p); if (typeof sh.l === 'function') sh.l(u, l); else bez(sh.l, u, l); const a = sh.rel ? (tl.anchor || P) : null; if (a) { fromLocal(p, a); if (typeof sh.l !== 'function') fromLocal(l, a); }
      f = lerp(sh.f[0], sh.f[1] === undefined ? sh.f[0] : sh.f[1], u); }
    const k = sh.sh === undefined ? 1 : sh.sh, t = D.clock;
    p.x += Math.sin(t * .83 + 1.3) * .012 * k; p.y += Math.sin(t * 1.07) * .009 * k; p.z += Math.sin(t * .71 + 4.1) * .012 * k;
    cam.position.copy(p); cam.up.set(0, 1, 0); cam.lookAt(l);
    cam.rotateX((Math.sin(t * 1.31 + .5) + Math.sin(t * 2.93 + 1.1) * .45) * .0021 * k); cam.rotateY((Math.sin(t * 1.13 + 2.2) + Math.sin(t * 2.57) * .45) * .0026 * k); cam.rotateZ(Math.sin(t * .61 + .9) * .0011 * k);
    if (Math.abs(cam.fov - f) > .005) { cam.fov = f; cam.updateProjectionMatrix(); }
  };

  /* ------------------------------------------------------------------ small world helpers */
  function setFlags(o) { o = o || {}; S.cine = !!o.cine; S.drive = !!o.drive; S.hold = !!o.hold; S.pre = !!o.pre; S.ui = !!o.ui; S.lockLook = !!o.lockLook; }
  function phase(name) { S.state = name; S.t = 0; G.phase = name; G.phaseT = 0; S.apReady = false; X.emit('phase', { phase: name }); }
  function seatPartner() { const p = G.partner; if (!p) return; p.wp = null; p.onDone = null; p.seat = { car: P.car, x: SEAT.x, y: S.cine ? SEAT.yx : SEAT.y, z: SEAT.z }; p.state = p.idle = 'sit'; p.speed = 0; p.lift = 0; }
  function standPartner(x, z, h, state) { const p = G.partner; if (!p) return; p.wp = null; p.onDone = null; p.seat = null; p.x = x; p.z = z; p.h = h; p.speed = 0; p.state = p.idle = state || 'idle'; }
  function stagePrologue() {
    X.SUB.cur = null; X.SUB.q.length = 0; G.holdHours = H0;
    X.placePlayer(HERO0.x, HERO0.z, HERO0.h); P.engineOn = false; P.lightsManual = false;
    standPartner(VEND.x, VEND.z, VEND.h, 'phone'); G.partner.lift = VEND.lift;
    if (G.contact) G.contact.vis = false;
    S.marker = null; beacon(null);
  }
  /* soft world marker: a column of light + a ground ring */
  let BEACON = null;
  function beacon(at, r) {
    if (!G || !G.visual) return;
    if (!BEACON) { const g = new T.Group(), col = new T.Color(1, .72, .36);
      const cg = new T.CylinderGeometry(1, 1, 1, 40, 1, true), n = cg.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const k = Math.pow(1 - (cg.attributes.position.getY(i) + .5), 2.2); c[i * 3] = col.r * k; c[i * 3 + 1] = col.g * k; c[i * 3 + 2] = col.b * k; }
      cg.setAttribute('color', new T.BufferAttribute(c, 3)); cg.translate(0, .5, 0);
      const cm = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false, opacity: .5 });
      const colm = new T.Mesh(cg, cm); colm.scale.set(1, 9, 1); g.add(colm);
      const rm = new T.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.2), transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false, side: T.DoubleSide, opacity: .8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const ring = new T.Mesh(new T.RingGeometry(.93, 1, 56).rotateX(-PI / 2), rm); ring.position.y = .05; g.add(ring);
      g.renderOrder = 5; colm.renderOrder = 5; ring.renderOrder = 5; g.visible = false; G.scene.add(g); BEACON = { g, colm, ring, cm, rm }; }
    BEACON.g.visible = !!at; if (at) { const rr = r || 2.6; BEACON.g.position.set(at.x, X.groundY(at.x, at.z), at.z); BEACON.colm.scale.set(rr, 11, rr); BEACON.ring.scale.set(rr, 1, rr); }
  }
  /* Kai, seen from outside only as a shape behind the glass (back-lit or rear-quarter shots; never a face) */
  let DRV = null;
  function driver(on) {
    if (!G || !G.visual) return;
    if (!on) { if (DRV) DRV.group.visible = false; return; }
    const c = P.car; if (!c || !c.veh || !c.veh.group) return;
    if (!DRV) { DRV = X.makeFigure('driver', { seed: 1 }); if (!DRV || !DRV.group) { DRV = null; return; } try { DRV.update(0, { state: 'drive' }); } catch (e) { /* static pose is fine */ } }
    if (DRV.group.parent !== c.veh.group) { c.veh.group.add(DRV.group); const e = c.dims.eye; DRV.group.position.set(e.x, e.y - .72, e.z - .06); DRV.group.rotation.set(0, 0, 0); }
    DRV.group.visible = true;
  }
  const dist = (a, b) => hyp(a.x - b.x, a.z - b.z);
  const sunPoint = (from, d, y) => { const s = (GT.env && GT.env.sunDir) || { x: -.9, y: .2, z: .3 }, n = hyp(s.x, s.z) || 1; return [from[0] + s.x / n * d, y, from[2] + s.z / n * d]; };

  /* ================================================================== BEAT 0 — main menu over a live flyby */
  function menuTL() {
    const sun = sunPoint([-20, 0, -40], 400, 14);
    return mkTL({ name: 'menu', rt: true, loop: true, skip: false, shots: [
      { d: 15, fi: 1.1, fo: .8, f: [36, 36], sh: .5, p: [[-17, 7.5, -92], [-19.5, 9.5, -70]], l: [[sun[0], 10, sun[2] - 60], [sun[0], 9, sun[2] - 40]] },                    // palms, sand, sea and sun
      { d: 14, fi: 1.1, fo: .8, f: [34, 34], sh: .5, p: [[-10.5, 4.2, 22], [-9.5, 5.2, 33]], l: [[19, 8.6, 52], [19, 9.2, 54]] },                                             // the motel sign across the highway
      { d: 14, fi: 1.1, fo: .8, f: [38, 37], sh: .5, p: [[5.5, 2.3, -44], [9.5, 2.9, -36]], l: [[38, 4.2, -6], [38, 4.4, -4]] },                                              // the station canopy
      { d: 15, fi: 1.1, fo: .8, f: [40, 40], sh: .5, p: [[-9.2, 14, -112], [-9.2, 16.5, -82]], l: [[1, 0, -30], [1, 0, 6]] }                                                  // the highway with traffic
    ] });
  }
  const ROLL = ['#出品', ['', 'B STAR'], '#故事', ['驾驶', '阿凯'], ['同伙', '阿烈'], ['债主', '郝老板'], '#地点', ['', 'COSTA BRISA · CALIDA KEYS'], '#制作', ['导演', '代码'], ['编写', '代码'], ['美术', '代码'], ['音乐', '由代码即兴'], ['街区搭建', '代码'], '',
    '全部由代码生成 · 没有一张贴图文件', '', '故事发生在 CALIDA KEYS。如有雷同，纯属巧合。', '', '第一章 完'];
  function showMenu() {
    S.idle = 0; tHint(true);
    ui('menu.show', { canContinue: !!save.data.prologue, onNew: () => leaveMenu('new'), onContinue: () => leaveMenu('continue'), onTrailer: () => menuTrailer(),
      onCredits: () => { if (S.state !== 'menu' || S.rolling) return; S.rolling = true; tHint(false); ensureAudio(); const back = () => { S.rolling = false; if (S.state === 'menu') showMenu(); }; after(ui('menu.hide'), () => afterUser(ui('creditsRoll', ROLL), back), 800); } });
  }
  /* GT.front's menu has no trailer entry in its contract: a small key hint (T) + the 40 s attract loop cover it */
  let THINT = null;
  function tHint(on) { if (S.silent) return; if (!THINT) { THINT = document.createElement('div'); THINT.style.cssText = 'position:fixed;right:5vw;bottom:13.2vh;z-index:60;font:500 1.55vh/1 "Avenir Next Condensed","DIN Condensed","Arial Narrow","PingFang SC",sans-serif;letter-spacing:.28em;color:rgba(244,234,214,.62);pointer-events:auto;cursor:pointer;opacity:0;transition:opacity .6s';
      THINT.innerHTML = '<span style="border:1px solid rgba(244,234,214,.5);border-radius:3px;padding:.25em .55em;margin-right:.7em;letter-spacing:0">T</span>预告片'; THINT.addEventListener('mousedown', e => { e.stopPropagation(); menuTrailer(); }); document.body.appendChild(THINT); }
    THINT.style.opacity = on ? 1 : 0; THINT.style.pointerEvents = on ? 'auto' : 'none'; }
  function menuTrailer() { if (S.state !== 'menu' || S.leaving || S.rolling) return; S.leaving = true; tHint(false); ensureAudio(); after(ui('menu.hide'), () => after(fadeTo(1, 350), () => { S.leaving = false; S.trailer(); }, 400), 800); }
  function menuIdle(dt) { if (S.leaving || S.rolling || S.tlHold || (G && G.auto)) return; S.idle += dt; if (S.idle > 40) { S.idle = 0; menuTrailer(); } }
  function leaveMenu(mode) { if (S.state !== 'menu' || S.leaving) return; S.leaving = true; tHint(false); ensureAudio(); fadeTo(1, 700);
    after(ui('menu.hide'), () => { S.leaving = false; S.start(mode); }, 800); }
  S.toMenu = function () {
    G.paused = false; G.started = false; G.freeze = false; G.ap.on = false; G.input.lookBack = false; S.leaving = false; S.rolling = false; S.settle = null; S.free = null;
    X.startRun(); stagePrologue(); if (X.HUD.reset) X.HUD.reset();
    phase('menu'); setFlags({ cine: true, hold: true, ui: true, pre: true });
    letterbox(false, 0); ui('objective', null); ui('hint', null); ui('clearSubtitles'); ui('skipHint', false);
    audio(A => { A.setRadio(false); if (A.setRadioVolume) A.setRadioVolume(.55); A.ambience({ surf: .9 }); A.sfx('alarm_bell', { on: false }); A.sfx('heartbeat', { on: false }); A.sfx('tire_squeal', { level: 0 }); });
    play(menuTL()); fadeTo(0, 1200); showMenu();
  };

  /* ================================================================== THE TRAILER ("开场 demo") — a launch-trailer cut of one real, scripted getaway
     One chase run of the actual simulation (autopilot plan 'chase', honk at 49 s with the patrol car parked behind) plays live while the director hard-cuts
     between cameras on the beat of Coral 98.1 (108 bpm). Between shots the sim is fast-forwarded to the next set-piece and the time of day is re-set. */
  const BEAT = 60 / 108;
  function trailerTL() {
    const R = X.R, W = X.W, st = L.station, v = new T.Vector3();
    const carPt = (c, lx, y, lz, out) => { const sn = Math.sin(c.h), cs = Math.cos(c.h); return out.set(c.x + cs * lx + sn * lz, (c.y || 0) + y, c.z - sn * lx + cs * lz); };
    const cop = () => { let b = null, bd = 1e9; for (const c of G.cops) { const d = hyp(c.x - P.x, c.z - P.z) - (c.lights.siren ? 400 : 0); if (d < bd) { bd = d; b = c; } } return b; };
    const hot = () => W.hot || G.phase === 'end', done = () => G.phase === 'end';
    const B = n => n * BEAT; let fix = null, cc = null;
    const fast = () => W.hot && Math.abs(P.x) < 9 && hyp(P.vx, P.vy) > 17;
    /** restart the real simulation on another plan / seed / hour and run it to the next set-piece (always under a black card) */
    const seq = (plan, honkAt, seed, hours, pred, max) => { const keep = G.seed; G.seed = seed; X.startRun(); G.seed = keep; if (X.HUD.reset) X.HUD.reset(); GT.game.autopilot(plan, honkAt); G.holdHours = hours; ffUntil(pred, max); };
    const shots = [
      { d: B(3), hold: true, text: '一条公路', pre: () => fadeTo(1, 0) },
      // 1 — 阿烈 bursts out of the store with the bag and runs for the passenger door (long lens across the hood)
      { d: B(5), sh: 1.4, pre: () => fadeTo(0, 0), cam: (t, u, p, l) => { const q = G.partner; p.set(44.6 + u * .5, 1.18, -12.4); l.set(lerp(48.2, q.x, .7), 1.05, lerp(-6.2, q.z, .7)); return 30; } },
      // 2 — inside: he piles in, the nose is already moving
      { d: B(4), fp: { yaw: -1.25, pitch: -.02, yaw1: -.15, pitch1: -.05 }, pre: () => ffUntil(() => hyp(G.partner.x - P.x, G.partner.z - P.z) < 3.4 || G.phase !== 'wait', 6) },
      // 3 — out of the station: low on the forecourt as the fastback comes through
      { d: B(5), sh: 1.6, pre: () => { ffUntil(() => hyp(P.x - 26, P.z + 34) < 17 || P.x < 20 || done(), 14); fix = [P.x < 22 ? P.x - 9 : 13.2, .34, P.z < -30 ? -41.5 : P.z - 12]; }, cam: (t, u, p, l) => { p.fromArray(fix); carPt(P, 0, .75, .6, l); return 36; } },
      { d: B(2), hold: true, text: '五分钟', pre: () => fadeTo(1, 0) },
      // 4 — the cruiser, light bar lit: long lens, it comes straight at the camera
      { d: B(5), h: 19.25, sh: 1.5, pre: () => { fadeTo(0, 0); ffUntil(() => hot() && !!cop() && cop().lights.siren, 12); cc = cop(); fix = cc ? carPt(cc, 2.6, .5, 34, v).toArray() : [P.x, 1, P.z + 20]; },
        cam: (t, u, p, l) => { p.fromArray(fix); if (cc) carPt(cc, 0, .9, 0, l); else l.set(P.x, 1, P.z); return 17; } },
      // 5 — long lens from the beach, through the palms, tracking the pursuit down the highway
      { d: B(6), sh: 1.2, pre: () => { ffUntil(() => (Math.abs(P.x) < 9 && hyp(P.vx, P.vy) > 15) || done(), 6); const dir = Math.cos(P.h) >= 0 ? 1 : -1; fix = [-26.5, 1.5, clamp(P.z + dir * 66, -150, 150)]; },
        cam: (t, u, p, l) => { p.fromArray(fix); carPt(P, 0, 1.0, -4, l); return 13.5; } },
      // 6 — from the hero's rear bumper, looking back at what is chasing
      { d: B(4), sh: 2.2, cam: (t, u, p, l) => { carPt(P, .95, .42, -2.15, p); carPt(P, -.4, .95, -30, l); return 52; } },
      // 7 — low front bumper cam, the road pouring in
      { d: B(5), sh: 2.4, pre: () => ffUntil(null, 1), cam: (t, u, p, l) => { carPt(P, -.75, .3, 2.2, p); carPt(P, .3, .75, 40, l); return 62; } },
      { d: B(2), hold: true, text: '别熄火', pre: () => { fadeTo(1, 0); seq('chase', 49, 2, 20.9, fast, 90); } },
      // 8 — night, top-down: red and blue converging on the highway
      { d: B(6), sh: .4, pre: () => fadeTo(0, 0), cam: (t, u, p, l) => { p.set(P.x + 8 + u * 8, 88 - u * 10, P.z - 6); l.set(P.x, 0, P.z + 1 + u * 5); return 38; } },
      // 9 — night: high three-quarter on the nearest cruiser
      { d: B(4), sh: 1.4, pre: () => { cc = cop(); }, cam: (t, u, p, l) => { const c = cc || P; carPt(c, -5.5, 2.4, 9.5 - u * 3, p); carPt(c, 0, .9, 0, l); return 40; } },
      // 10 — inside: hands sawing at the wheel
      { d: B(5), fp: { yaw: .06, pitch: -.2, pitch1: -.1 } },
      // 11 — inside, looking back: the cruiser in the rear glass
      { d: B(4), back: true, fp: { yaw: 0, pitch: -.05 } },
      // 12 — dusk: chase cam low on the tail
      { d: B(6), h: 19.55, sh: 2, cam: (t, u, p, l) => { carPt(P, 1.5 - u * .6, .62, -5.6, p); carPt(P, 0, .95, 8, l); return 50; } },
      { d: B(2), hold: true, text: '一个傍晚', pre: () => { fadeTo(1, 0); seq('calm', 19, 1, 19.7, () => G.phase === 'heat' && P.z > 14 && Math.abs(P.x) < 9, 70); } },
      // 13 — the Coral Comet sign, neon on, as the fastback slides past looking for another car
      { d: B(5), sh: .8, pre: () => fadeTo(0, 0), cam: (t, u, p, l) => { p.set(-9.6, 1.1 + u * .25, 36); l.set(17.5, 8.8, 51.5); return 38; } },
      // 14 — the swap, in the motel lot
      { d: B(6), sh: 1.1, pre: () => ffUntil(() => G.phase === 'swap' || done(), 30), cam: (t, u, p, l) => { carPt(P, 4.2 - u * .8, 1.05, 6.4, p); carPt(P, 0, .95, -.4, l); return 34; } },
      // 15 — rolling out in somebody else's sedan
      { d: B(5), fp: { yaw: .25, pitch: -.04, yaw1: 0 }, pre: () => { ffUntil(() => G.phase === 'clean' || done(), 12); ffUntil(null, 5); } },
      // 16 — freeze, flash, wordmark
      { d: B(10), hold: true, sh: .3, pre: () => { fix = carPt(P, 2.6, .7, -6.2, v).toArray(); }, cam: (t, u, p, l) => { p.fromArray(fix); p.y += u * .25; carPt(P, -.5, .9, 1.5, l); return 40; }, fo: .9 }
    ];
    return mkTL({ name: 'trailer', rt: true, skip: false, shots, finish: () => endTrailer(true), cues: [] });
  }
  /** S.trailer() — play the intro trailer, then the main menu. Any key / click skips it. */
  S.trailer = function () {
    bind(); G.paused = false; G.started = true; G.freeze = false; S.free = null; S.settle = null; S.leaving = false; tHint(false);
    X.startRun(); if (X.HUD.reset) X.HUD.reset(); G.holdHours = 18.45; if (G.contact) G.contact.vis = true;
    S.state = 'trailer'; S.t = 0; S.trailerT0 = S.silent ? 0 : performance.now(); setFlags({ cine: true, ui: true }); S.marker = null; beacon(null);
    GT.game.autopilot('chase', 49); ffUntil(() => X.R.stage === 'runout' || G.phase !== 'wait', 70);
    letterbox(true, 0); ui('skipHint', false); ui('objective', null); ui('hint', null); ui('clearSubtitles');
    audio(A => { A.ambience({ surf: .4 }); if (settings().radio !== false) { A.setRadio(true, 0); if (A.setRadioVolume) A.setRadioVolume(1); } });
    const tl = play(trailerTL()), last = tl.shots[tl.shots.length - 1];
    tl.cues.push(U(last.t0 + .05, 5.4, () => { sfx('star'); ui('titleCard', { title: 'BILIBILI THEFT AUTO 1', chapter: '', name: '', seconds: last.d - .5 }); })); tl.cues.sort((a, b) => a.t - b.t);
    if (S.silent || S.ff) tlAdvance(tl, 0);
  };
  function endTrailer(natural) {
    if (S.state !== 'trailer') return; S.state = 'trailer-out'; const tl = D.tl; if (tl) tl.done = true; D.tl = null;
    G.freeze = false; G.input.lookBack = false; G.ap.on = false; S.lockLook = false;
    const go = () => { G.freeze = false; S.toMenu(); };
    if (S.silent) go(); else after(fadeTo(1, natural ? 0 : 260), go, natural ? 30 : 300);
  }

  /* ================================================================== BEAT 1 — cold open + opening credits */
  function enterIntro() {
    G.started = true; G.paused = false; if (S.state !== 'menu') { X.startRun(); } stagePrologue();
    phase('intro'); setFlags({ cine: true, hold: true, ui: true, pre: true });
    fadeTo(1, 0); letterbox(true); ui('objective', null); ui('hint', null); ui('skipHint', true);
    audio(A => { A.setRadio(false); A.ambience({ surf: 1 }); });
    const sun = sunPoint([-30, 0, -110], 500, 0), A0 = HERO0;
    play(mkTL({ name: 'intro', anchor: A0, finish: enterPhone, shots: [
      { d: 5.4, f: [30, 30], p: [[-33, 1.9, -118], [-33, 1.9, -118]], l: [[sun[0], 9, sun[2]], [sun[0], 9, sun[2]]] },                                         // black: surf, the radio tunes in
      { d: 6.4, fi: 2.4, f: [30, 28.5], sh: .7, p: [[-33, 1.9, -118], [-35.5, 2.25, -117.2]], l: [[sun[0], 16, sun[2]], [sun[0], 13, sun[2]]] },                // the sun over the sea
      { d: 5.4, f: [35, 35], sh: 1.2, p: [[-5.6, .34, -139], [-5.6, .38, -126.5]], l: [[-10.5, 2.4, -100], [-10.5, 2.6, -87.5]] },                             // low along the asphalt, palms against the light
      { d: 6.2, f: [40, 38], sh: .8, rel: true, drv: true, p: [[3.0, .6, -6.6], [2.2, .75, -5.6]], l: [[-.7, .9, 1.5], [-.6, .92, 1.5]] },                                // the fastback at the kerb, the sea beyond it
      { d: 5.4, f: [25, 24], sh: .9, p: [[54.6, 1.3, 77.6], [55.4, 1.34, 78.3]], l: [[72.6, 1.42, 86.5], [72.6, 1.42, 86.6]], fo: .5 }                         // 阿烈, long lens, by the vending machines
    ], cues: [
      U(.5, 9, () => audio(A => { if (settings().radio !== false) A.setRadio(true, 2); })),
      U(1.2, 7.2, () => sub('电台', '……这里是海岸电台。Costa Brisa 傍晚六点十分，气温三十一度，湿度高到你可以直接游着去上班。', 7.0)),
      U(8.4, 3.4, () => ui('credit', '出品', 'B STAR', { where: 'bl', seconds: 3.4 })),
      U(12.6, 3.6, () => ui('credit', '故事发生在', 'CALIDA KEYS', { where: 'br', seconds: 3.6 })),
      U(18.0, 3.6, () => ui('credit', '驾驶', '阿凯', { where: 'bl', seconds: 3.6 })),
      U(24.2, 3.6, () => ui('credit', '同伙', '阿烈', { where: 'bl', seconds: 3.6 })),
      Wc(17.2, () => audio(A => A.setRadioVolume && A.setRadioVolume(.3)))
    ] }));
  }

  /* ================================================================== BEAT 2 — the phone */
  function enterPhone() {
    if (S.state !== 'intro') { G.started = true; stagePrologue(); }
    phase('phone'); setFlags({ hold: true, ui: true, pre: true, lockLook: true });
    letterbox(true); ui('skipHint', true); ui('clearSubtitles');
    audio(A => { if (settings().radio !== false) A.setRadio(true, 2); if (A.setRadioVolume) A.setRadioVolume(.4); });
    play(mkTL({ name: 'phone', finish: enterDrive1, shots: [{ d: SEAMLESS_HANDOFF ? 14.0 : 14.6, fi: .5, fp: { yaw: .1, pitch: -.03, yaw1: -.02, pitch1: -.07 } }], cues: [
      U(1.0, 5.2, () => ui('phone', { from: '郝老板', text: '阿凯，周五到了。四万。我不想亲自去问候你母亲。', seconds: 5.2 })),
      U(7.6, 5, () => ui('phone', { from: '阿烈', text: '哥，来 旅馆 接我。有个小活儿。五分钟的事。', seconds: 5 })),
      U(10.4, 3.9, () => ui('locationCard', 'COSTA BRISA', '海滨公路 · 星期四 18:10', 3.6)),
      Wc(12.6, () => { if (!P.engineOn) { P.engineOn = true; sfx('ignition'); P.dipV += .4; } }),
      Wc(13.2, () => { letterbox(false, SEAMLESS_HANDOFF ? 1100 : 600); ui('skipHint', false); if (SEAMLESS_HANDOFF) { CAM.yawT = 0; CAM.pitchT = -.05; } }),      // bars slide away while the head is already turning to the road
      U(13.5, 3, () => { if (SEAMLESS_HANDOFF) sub('阿凯', '说好不干了。', 2.6); })
    ] }));
    fadeTo(0, 500);
  }

  /* ================================================================== BEAT 3 — playable: drive to the motel */
  const HINTS = [
    { keys: ['W', 'A', 'S', 'D'], text: '驾驶', max: 14, done: () => P.odo - S.odo0 > 14 },
    { keys: ['鼠标'], text: '环顾', max: 7, done: () => Math.abs(CAM.yawT - S.yaw0) > .25 },
    { keys: ['R'], text: '换台', max: 7, done: () => !!G.keys.KeyR },
    { keys: ['Q'], text: '回头', max: 7, done: () => !!G.input.lookBack }
  ];
  function hintStep(dt) {
    if (S.hintI >= HINTS.length) return; const h = HINTS[S.hintI];
    if (S.hintT < 0) { S.hintT = 0; S.yaw0 = CAM.yawT; ui('hint', h.keys, h.text, h.max); return; }
    S.hintT += dt; if ((S.hintT > 1.4 && h.done()) || S.hintT > h.max) { S.hintI++; S.hintT = -1; if (S.hintI >= HINTS.length) ui('hint', null); }
  }
  function gameplay(name, objective, mark, r) {
    const seamless = SEAMLESS_HANDOFF && S.fadeLevel < .01 && !S.cine;        // arriving from a first-person shot that was not skipped: no fade, no camera snap, subtitles keep running
    phase(name); setFlags({ drive: true, pre: true }); D.tl = null; S.marker = { x: mark.x, z: mark.z }; beacon(mark, r);
    letterbox(false, seamless ? 1100 : 600); ui('skipHint', false); if (!seamless) ui('clearSubtitles'); ui('objective', objective);
    P.engineOn = true; S.said = {}; S.stopHint = 0; CAM.idle = 0; if (!seamless) { CAM.yaw = CAM.yawT = 0; CAM.pitch = CAM.pitchT = -.05; } else { CAM.yawT = 0; CAM.pitchT = -.05; }
    const pt = G.partner; if (pt && pt.seat) { pt.seat.y = SEAT.y; legs(pt.fig, false); }
    audio(A => { if (settings().radio !== false) { if (!A.radioOn) A.setRadio(true, 2); if (A.setRadioVolume) A.setRadioVolume(.55); } });
    if (!S.silent && !G.auto) X.lockPointer();
    if (!seamless) fadeTo(0, 500); return seamless;
  }
  function enterDrive1() {
    if (S.state !== 'phone') { G.started = true; stagePrologue(); }
    const seamless = gameplay('drive1', '开到汽车旅馆接阿烈', PICK, 3.2); S.hintI = 0; S.hintT = -1; S.odo0 = P.odo; if (seamless) S.said.k1 = 1;
  }
  function stopHint(d, sp, far) { if (d < far && sp > 3 && S.t - S.stopHint > 6) { S.stopHint = S.t; ui('hint', ['S'], '停稳', 2.6); } }
  function drive1Step(dt) {
    hintStep(dt); const d = dist(P, PICK), sp = hyp(P.vx, P.vy), said = S.said;
    if (!said.c5 && S.t > 5) { said.c5 = 1; ui('credit', '音乐', '由代码即兴', { where: 'br', seconds: 3.6 }); }
    if (!said.k1 && S.t > 10.5) { said.k1 = 1; sub('阿凯', '说好不干了。', 2.6); }
    if (!said.c6 && S.t > 15) { said.c6 = 1; ui('credit', '全部由代码生成', '没有一张贴图文件', { where: 'bl', seconds: 3.8 }); }
    if (!said.k2 && P.z > 12 && S.t > 14) { said.k2 = 1; sub('阿凯', '……就听他说完。', 2.8); }
    if (!said.pp && d < 60) { said.pp = 1; const p = G.partner; if (p && !p.seat) p.state = p.idle = 'idle'; }
    if (S.hintI >= HINTS.length) stopHint(d, sp, 16);
    if (d < 9.5 && sp < 2.4) enterPickup();
  }

  /* ================================================================== BEAT 4 — pickup cutscene */
  function stagePickup() {
    X.placePlayer(PICK.x, PICK.z, PICK.h); P.engineOn = true; standPartner(VEND.x, VEND.z, VEND.h, 'idle'); G.partner.lift = VEND.lift; if (G.contact) G.contact.vis = false;
  }
  function enterPickup() {
    const from = S.state; if (from !== 'drive1') { G.started = true; G.holdHours = H0; }
    phase('pickup'); setFlags({ hold: true, ui: true, pre: true, lockLook: true }); S.marker = null; beacon(null); ui('objective', null); ui('hint', null);
    const go = () => {
      if (S.state !== 'pickup') return; stagePickup(); letterbox(true); ui('skipHint', true);
      const p = G.partner, door = X.partnerDoorPos([0, 0]), track = (u, out) => out.set(p.x - 1.1, 1.08, p.z);
      play(mkTL({ name: 'pickup', anchor: PICK, finish: () => { S.cine = false; seatPartner(); enterDrive2(); }, shots: [
        { d: 5.2, f: [30, 29], sh: .9, p: [[56.3, 1.56, 82.9], [56.7, 1.58, 83.2]], l: [[72.4, 1.28, 86.9], [72.0, 1.28, 86.8]] },                                // over the car's roof: he pushes off the wall by the vending machines
        { d: 5.2, f: [34, 34], sh: 1.1, drv: true, p: [[63.3, 1.15, 75.8], [62.5, 1.2, 76.2]], l: track },                                                                 // side-on: crossing to the passenger door
        { d: 8.6, f: [40, 38], sh: .7, drv: true, p: [[63.7, .86, 90.9], [63.1, .93, 90.3]], l: [[59.5, .96, 85.1], [59.5, .98, 85.1]] },                         // rear quarter, low: the louvres hide them, the lot and the highway beyond
        SEAMLESS_HANDOFF ? { d: 8.4, f: [45, 43], sh: .8, drv: true, p: [[65.0, 1.05, 88.4], [64.4, 1.08, 87.8]], l: [[58.5, 1.0, 84.9], [58.5, 1.0, 84.9]] }             // profile against the sun: the argument
          : { d: 9.4, fp: { yaw: -.3, pitch: -.04, yaw1: -.42, pitch1: -.05 } },
        SEAMLESS_HANDOFF ? { d: 10.2, fp: { yaw: -.34, pitch: -.04, yaw1: -.2, pitch1: -.05 } }                                                                   // inside for the decision; the bars leave on the last line and the car is his
          : { d: 9.2, f: [45, 43], sh: .8, drv: true, p: [[65.0, 1.05, 88.4], [64.4, 1.08, 87.8]], l: [[58.5, 1.0, 84.9], [58.5, 1.0, 84.9]], fo: .45 }
      ], cues: [
        Wc(1.3, () => { X.pedGo(p, [[70.5, p.z - .3], [62.4, door[1] + .2], [door[0] + .1, door[1]]], 1.62, 'walk', () => { p.h = PI; S.doorT = S.t; sfx('door_open'); }); p.lift = VEND.lift; }),
        U(2.2, 3.0, () => sub('阿烈', '哥！准时。你一向准时。', 2.8)),
        Wc(10.2, () => { if (!p.seat) { seatPartner(); sfx('door_close'); P.dipV += .9; } }),
        U(11.2, 2.2, () => sub('阿凯', '我只是来听听。', 2.0)),
        U(13.6, 6.2, () => sub('阿烈', 'SOLMAR 加油站。老板每周五才存钱，今天周四。地上一个保险柜，店里就一个打瞌睡的。', 6.0)),
        U(20.4, 1.9, () => sub('阿凯', '我不进去。', 1.7)),
        U(22.5, 3.8, () => sub('阿烈', '你不用进去。你只管开车。全岛没人比你会开。', 3.6)),
        U(26.6, 2.4, () => sub('阿凯', '……郝老板找过你了？', 2.2)),
        U(29.6, 2.6, () => sub('阿烈', '他找的是你妈的地址。', 2.4)),
        U(33.4, 1.5, () => sub('阿凯', '上车。', 1.3)),
        U(35.0, 2.2, () => sub('阿烈', '我在车上啊哥。', 2.0)),
        Wc(35.6, () => { if (SEAMLESS_HANDOFF) { letterbox(false, 1100); ui('skipHint', false); CAM.yawT = 0; } })
      ] }));
      fadeTo(0, 450);
    };
    if (S.silent || S.ff || from !== 'drive1') go(); else after(fadeTo(1, 260), go, 300);
  }
  function pickupStep() { const p = G.partner; if (!p) return; p.lift = p.seat ? 0 : VEND.lift * sstep(p.x, 65.0, 65.4);
    if (S.doorT !== undefined && !p.seat && !p.wp && S.t - S.doorT > .55) { S.doorT = undefined; seatPartner(); sfx('door_close'); P.dipV += .9; } }

  /* ================================================================== BEAT 5 — playable: drive to the station */
  const BANTER = [[4.5, '阿烈', '别开太快，哥。我们现在还是良民。', 3.2], [10.5, '阿烈', '那个店员我盯了三天。眼皮比卷帘门还沉。', 3.6], [15, '阿凯', '你盯了三天，就看出他爱睡觉。', 2.8], [18.4, '阿烈', '这就叫情报。', 2.0]];
  function enterDrive2() {
    if (S.state !== 'pickup') { G.started = true; G.holdHours = H0; stagePickup(); }
    const wasCine = S.cine; S.cine = false; seatPartner(); S.cine = wasCine; gameplay('drive2', '开到 SOLMAR 加油站，停在店门口', STALL, 2.4); S.hintI = HINTS.length; S.banter = 0; ui('hint', null);
  }
  function drive2Step(dt) {
    const d = dist(P, STALL), sp = hyp(P.vx, P.vy);
    while (S.banter < BANTER.length && S.t > BANTER[S.banter][0]) { const b = BANTER[S.banter++]; sub(b[1], b[2], b[3]); }
    stopHint(d, sp, 13);
    if (d < 4.6 && sp < 1.3) enterTitle();
  }

  /* ================================================================== BEAT 6 — title drop, then hand over to the existing WAIT phase */
  function partnerOut() { const hs = STALL, rx = -Math.cos(hs.h), rz = Math.sin(hs.h), door = X.anchor(['storeDoor', 'door'], { x: L.station.store.x0, z: L.station.store.doorZ });
    standPartner(hs.x + rx * 1.45, hs.z + rz * 1.45, Math.atan2(door.x - hs.x, door.z - hs.z), 'idle'); G.partner.lift = 0; }
  function enterTitle() {
    const from = S.state; if (from !== 'drive2') { G.started = true; G.holdHours = H0; X.placePlayer(STALL.x, STALL.z, STALL.h); seatPartner(); }
    phase('title'); setFlags({ hold: true, ui: true, pre: true, lockLook: true }); S.marker = null; beacon(null); ui('objective', null); ui('hint', null);
    const go = () => {
      if (S.state !== 'title') return; letterbox(true); ui('skipHint', true);
      play(mkTL({ name: 'title', anchor: STALL, finish: toWait, shots: [
        { d: 3.9, fp: { yaw: -.34, pitch: -.04, yaw1: -.5, pitch1: -.05 } },                                                                                       // inside: "五分钟。别熄火。"
        { d: 9.6, e: 'io', f: [38, 30], sh: .6, p: [[49.2, 1.3, 1.8], [47.0, 3.0, 2.2], [46.9, 14.6, -1.5]], l: [[46.3, .95, -4.6], [41, 3.0, -5], sunPoint([46.9, 0, -1.5], 40, 13)] }                 // crane: up over the roof, the canopy, toward the sun and the sea
      ], cues: [
        U(.9, 2.6, () => sub('阿烈', '五分钟。别熄火。', 2.4)),
        Wc(3.5, () => { sfx('door_open'); P.dipV += .5; }),
        Wc(3.9, () => partnerOut()),
        U(4.3, .5, () => sfx('door_close')),
        U(5.6, 9, () => audio(A => { if (settings().radio !== false) { A.setRadio(true, 0); if (A.setRadioVolume) A.setRadioVolume(.95); } })),
        U(7.4, 5.4, () => ui('titleCard', { title: 'BILIBILI THEFT AUTO 1', chapter: '第一章', name: '零钱', seconds: 5.2 }))
      ] }));
      fadeTo(0, 350);
    };
    const d = dist(P, STALL), dh = Math.abs(angDiff(P.h, STALL.h));
    if (S.silent || S.ff || from !== 'drive2') go();
    else if (d < 2.6 && dh < .7) { S.settle = { x: P.x, z: P.z, h: P.h, t: 0, d: .9 }; go(); }      // close enough: ease the car onto the mark
    else after(fadeTo(1, 240), () => { X.placePlayer(STALL.x, STALL.z, STALL.h); go(); }, 280);
  }
  function settleStep(dt) { const s = S.settle; s.t += dt; const u = clamp(s.t / s.d, 0, 1), k = u * u * (3 - 2 * u); X.placePlayer(lerp(s.x, STALL.x, k), lerp(s.z, STALL.z, k), s.h + angDiff(s.h, STALL.h) * k); if (u >= 1) S.settle = null; }
  /** the heist itself: exactly the state game.js expects (fresh startRun: car on the stall, partner at the door, timers at zero, 18:10 and counting) */
  function toWait() {
    S.settle = null; D.tl = null; G.holdHours = null; G.started = true; G.paused = false;
    X.startRun(); if (X.HUD.reset) X.HUD.reset();
    S.state = 'heist'; S.t = 0; setFlags({}); S.marker = null; beacon(null);
    CAM.mode = CAM.mode || 'fp'; CAM.yaw = CAM.yawT = -.5; CAM.pitch = CAM.pitchT = -.05; CAM.back = 0; CAM.idle = 0;
    letterbox(false); ui('skipHint', false); ui('objective', null); ui('hint', null); ui('clearSubtitles'); fadeTo(0, 350);
    audio(A => { A.ambience({ surf: .6 }); if (A.setRadioVolume) A.setRadioVolume(.55); if (settings().radio !== false) { if (!A.radioOn) A.setRadio(true, 0); } else A.setRadio(false); });
    if (!save.data.prologue) save.put('prologue', true);
    if (!S.silent && !G.auto) X.lockPointer();
    if (!S.silent && X.HUD) X.HUD.radioT = 3;
  }

  /* ================================================================== BEAT 7 — mission card, stinger, credits */
  const mmss = t => { t = Math.max(0, Math.floor(t)); return (t < 600 ? '0' : '') + Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60); };
  S.onEnd = function (res) {
    if (S.state === 'trailer' || S.state === 'trailer-out') return;      // the trailer's run ends however it ends
    S.lastResult = res; S.state = 'card'; setFlags({ ui: true, hold: true }); S.marker = null;
    const ok = res && res.result === 'clean', stars = n => n > 0 ? '★'.repeat(Math.min(6, n)) : '无';
    const lines = ok ? [{ label: '用时', value: mmss(res.time) }, { label: '最高通缉', value: stars(res.peak) }, { label: '换车', value: res.swapped ? '1 次' : '没换' }, { label: '车损', value: Math.round(res.damage * 100) + '%' }]
      : [{ label: '原因', value: res && res.result === 'busted' ? '被捕' : '丢下了阿烈' }, { label: '坚持了', value: mmss(res ? res.time : 0) }, { label: '最高通缉', value: stars(res ? res.peak : 0) }];
    const next = () => { if (S.state !== 'card') return; if (ok) enterStinger(res); else retry(); };
    const show = () => { if (S.state !== 'card') return; ui('hint', null); ui('objective', null); afterUser(ui('missionCard', { result: ok ? 'passed' : 'failed', title: '第一章 · 零钱', lines, take: ok ? res.take : undefined, rating: ok ? res.rank : undefined }), next); };
    if (S.silent) S.pending = next; else if (S.ff) show(); else setTimeout(show, ok ? 1300 : 1700);
  };
  function retry() { const go = () => { toWait(); }; if (S.silent) go(); else after(fadeTo(1, 400), go, 450); }
  function enterStinger(res) {
    res = res || S.lastResult || { take: 1470 };
    const go = () => {
      G.started = true; G.paused = false; G.holdHours = HNIGHT;
      for (const c of G.cops.slice()) X.removeCar(c); G.cops.length = 0; if (X.W) { X.W.stars = 0; X.W.hot = false; X.W.exitOpen = false; X.W.bustT = 0; }
      phase('stinger'); setFlags({ cine: true, hold: true, ui: true, pre: true });
      X.placePlayer(STING.x, STING.z, STING.h); P.engineOn = false; P.lightsManual = true; P.lightsOn = false; seatPartner(); if (G.contact) G.contact.vis = false;
      letterbox(true); ui('skipHint', true); ui('objective', null); ui('hint', null); ui('clearSubtitles');
      audio(A => { A.setRadio(false); A.ambience({ surf: .5 }); A.sfx('alarm_bell', { on: false }); A.sfx('heartbeat', { on: false }); A.sfx('tire_squeal', { level: 0 }); });
      const take = X.money(res.take || 0);
      play(mkTL({ name: 'stinger', anchor: STING, finish: enterCredits, shots: [
        { d: 7.4, fi: 1.6, f: [38, 36], sh: .7, rel: true, drv: true, p: [[-1.7, 1.12, -13], [-1.3, 1.18, -11.6]], l: [[0, 1.0, 0], [0, 1.0, 0]] },                       // night, behind the motel: the car, dark, two shapes inside
        { d: 11.4, fp: { yaw: -.28, pitch: -.06, yaw1: -.05, pitch1: -.09 }, fo: 1.2 },                                                                          // inside: 阿烈 counting, then the phone
        { d: 4.6, f: [36, 36], rel: true, p: [[-1.3, 1.18, -11.6], [-1.3, 1.18, -11.6]], l: [[0, 1.0, 0], [0, 1.0, 0]] }                                        // black: 第一章 完
      ], cues: [
        U(2.2, 3.4, () => sub('阿烈', '……' + take + '。哥，数了三遍，就这些。', 3.2)),
        U(6.0, 1.8, () => sfx('cash')),
        U(8.4, 2.4, () => sub('阿烈', '零钱也是钱。', 2.0)),
        U(11.2, 5.6, () => ui('phone', { from: '郝老板', text: '收到一部分了。还差三万。下周见，阿凯。', seconds: 5.4 })),
        U(19.4, 3.6, () => ui('credit', '零钱', '第一章 完', { where: 'c', seconds: 3.4 }))
      ] }));
    };
    if (S.silent || S.ff) go(); else after(fadeTo(1, 700), go, 750);
  }
  function enterCredits() {
    phase('credits'); setFlags({ cine: true, hold: true, ui: true, pre: true }); D.tl = null; fadeTo(1, 0); letterbox(false, 0); ui('skipHint', false); ui('clearSubtitles');
    save.put('chapter1', true); if (!save.data.prologue) save.put('prologue', true); const r = S.lastResult; if (r && r.take > (save.data.best || 0)) save.put('best', r.take);
    afterUser(ui('creditsRoll', ROLL), () => { if (S.state === 'credits') S.toMenu(); });
  }

  /* ================================================================== seams called by game.js */
  const GAMEPLAY = { drive1: 1, drive2: 1, heist: 1 }, PAUSABLE = { drive1: 1, drive2: 1, heist: 1, intro: 1, phone: 1, pickup: 1, title: 1, stinger: 1 };
  S.blockKeys = function (k) {
    if (S.silent) return false; const play = !!GAMEPLAY[S.state] && !S.skipping;
    if (k === 'Look') return !play || S.lockLook;
    if (k === 'Pause') return !PAUSABLE[S.state];
    if (k === 'Lock' || k === 'Mouse') return !play;
    if (k === 'Escape' || k === 'KeyP') return !PAUSABLE[S.state];
    return !play;                                       // every other key reaches the game only during gameplay
  };
  S.pauseUI = function (p) {
    if (S.silent) return true;
    if (p) ui('pause.show', { onResume: () => X.setPause(false), onRestart: () => { S.leavingPause = true; X.setPause(false); S.leavingPause = false; S.restartCheckpoint(); }, onMenu: () => { const st = S.state; S.state = 'leaving'; X.setPause(false); S.state = st; after(fadeTo(1, 500), () => S.toMenu(), 550); } });
    else ui('pause.hide');
    return true;
  };
  S.restartCheckpoint = function () {
    const st = S.state, go = { intro: enterIntro, phone: enterIntro, drive1: () => { S.state = 'restart'; enterDrive1(); }, pickup: () => { S.state = 'restart'; enterPickup(); }, drive2: () => { S.state = 'restart'; enterDrive2(); }, title: () => { S.state = 'restart'; enterDrive2(); }, heist: toWait, stinger: () => enterStinger(S.lastResult) }[st];
    if (!go) return; D.tl = null; ui('clearSubtitles'); after(fadeTo(1, 300), go, 350);
  };
  S.onLock = function () { /* pointer-lock changes are handled by game.js (pause on loss) */ };
  S.step = function (dt) {
    if (S.pending) { const f = S.pending; S.pending = null; f(); }
    S.t += dt; if (S.settle) settleStep(dt);
    tlStep(dt);
    const st = S.state;
    if (st === 'drive1') drive1Step(dt); else if (st === 'drive2') drive2Step(dt); else if (st === 'pickup') pickupStep();
    if (S.pre && P.damage > .1) P.damage = .1;           // no consequences before the heist: no cracked glass, no pulling steering
    if (BEACON && BEACON.g.visible) { const k = .5 + .5 * Math.sin(S.t * 2.6); BEACON.cm.opacity = .34 + .16 * k; BEACON.rm.opacity = .55 + .3 * k; }
  };
  function route(st) {
    const m = L.motel.drive, dN = L.station.drives[1];
    if (st === 'drive1') return [[HERO0.x, HERO0.z], [-6.9, -162.5], [-3, -150], [-3, -140], [-3, m - 17], [3, m - 2.2], [15, m], [34, m + .5], [49, m + 1.8], [56, m + 9], [56.5, PICK.z - 3]];
    return [[PICK.x, PICK.z], [57, PICK.z - 8], [55.5, m + 9], [51, m + 1.6], [38, m + .4], [16, m], [7.2, m - 2.2], [3.2, m - 12], [3, dN + 16], [9, dN + 2], [20, dN - 1], [36, dN - 5], [STALL.x - .3, dN - 9], [STALL.x, STALL.z + 8], [STALL.x, STALL.z - .6]];
  }
  S.autopilot = function (I) {
    if (!GAMEPLAY[S.state] || S.state === 'heist') { if (S.state === 'heist' || S.state === 'card' || S.state === 'trailer') return false; I.hand = 1; return true; }
    if (!S.apReady) { X.apRoute(route(S.state), 13.5, false, 6.5); G.ap.plan = 'calm'; G.ap.maxThr = .62; G.ap.yieldT = 0; S.apReady = true; }
    if (X.apFollow(I)) I.hand = 1; return true;
  };
  S.skip = function () {
    const tl = D.tl; if (!tl || !tl.skippable || tl.done || S.skipping) return false;
    if (G.paused) return false;
    if (S.silent) { endBeat(tl); return true; }
    S.skipping = true; ui('clearSubtitles'); ui('skipHint', false);
    after(fadeTo(1, 220), () => { S.skipping = false; if (D.tl === tl && !tl.done) endBeat(tl); }, 260); return true;
  };
  /* "新的故事" / "继续": the illustrated loading screen covers a real reset — world back to the story start, shaders pre-warmed by rendering the upcoming shots, audio spun up */
  const WARM_NEW = [[[-33, 1.9, -118], [-400, 12, -30], 30], [[-5.6, .36, -135], [-10.5, 2.5, -95], 35], [[-3.6, .7, -172.4], [-6.5, .9, -165], 40], [[54.6, 1.3, 77.6], [72.6, 1.42, 86.5], 25], [[63.5, .9, 90.6], [59.5, .96, 85.1], 40], [[49.2, 1.3, 1.8], [46.3, .95, -4.6], 38], [[46.9, 14, -1.5], [8, 12, 8], 30]];
  const WARM_CONT = [[[49.2, 1.3, 1.8], [46.3, .95, -4.6], 38], [[40, 2, 14], [50, 1.5, -8], 45]];
  const frame = () => new Promise(r => { let d = false; const go = () => { if (!d) { d = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 70); });   // never stalls in a background tab
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  S.start = function (mode) {
    bind(); ensureAudio(); const cont = mode === 'continue' || mode === 'heist', go = () => { S.free = null; if (cont) toWait(); else enterIntro(); };
    if (S.silent || S.ff) { go(); return; }
    (async () => {
      const t0 = performance.now(), MIN = 4300, bar = (p, l) => ui('loading.progress', p, l);
      S.state = 'loading'; setFlags({ cine: true, hold: true, ui: true, pre: true }); D.tl = null; G.started = false; G.paused = false; tHint(false);
      ui('loading.show', { tips: TIPS }); bar(.03, '收拾街区'); fadeTo(1, 0); letterbox(false, 0); await sleep(450);
      X.startRun(); if (cont) { G.holdHours = null; } else stagePrologue(); if (X.HUD.reset) X.HUD.reset(); bar(.2, cont ? '回到 SOLMAR 加油站' : '把车停回海边'); await frame();
      const poses = cont ? WARM_CONT : WARM_NEW;
      for (let i = 0; i < poses.length; i++) { S.free = { pos: poses[i][0], look: poses[i][1], fov: poses[i][2] }; bar(.25 + .45 * (i + 1) / poses.length, '预热镜头 ' + (i + 1) + ' / ' + poses.length); await frame(); await frame(); await sleep(120); }
      S.free = null; S.cine = false; await frame(); await frame(); S.cine = true;                          // and the cockpit
      bar(.78, '调收音机'); ensureAudio(); audio(A => { A.resume(); A.ambience({ surf: 1 }); }); await sleep(200);
      while (performance.now() - t0 < MIN) { bar(.8 + .19 * (performance.now() - t0) / MIN, '就绪'); await sleep(120); }
      bar(1, '就绪'); await sleep(250);
      await new Promise(r => after(ui('loading.hide'), r, 900));
      if (S.state === 'loading') go();
    })().catch(e => { fail('[story] start: ' + (e.stack || e)); go(); });
  };

  /* ================================================================== boot: studio logo (the world builds behind it) -> trailer -> menu, or an ?auto= jump */
  S.wants = function (Q) { if (Q.get('story') === '0' || Q.get('selftest') === '1') return false; const a = Q.get('auto'); return !a || STORY_AUTO.indexOf(a) >= 0; };
  function bind() { if (X) return; X = GT.game.x; G = GT.game.G; P = X.P; CAM = X.CAM; }
  const TIPS = ['按喇叭他会立刻撤出来——整个加油站也都听见了。', '闪车灯只有他站在柜台前才看得见。安静，但要趁早。', '警察认的是车。换一辆，描述就作废。', '离开视线五秒，追捕就变成搜索。', '后视镜比小地图诚实。', '按住 C 专注：世界慢下来，你不会。', '开得太野，路人会掏出手机。'];
  let splashP = null, LINE = null;
  /** a hair-thin progress line under the studio logo while the world builds */
  function line(p) { if (!LINE) { LINE = document.createElement('div'); LINE.style.cssText = 'position:fixed;left:50%;bottom:9vh;width:18vw;height:1px;margin-left:-9vw;background:rgba(244,234,214,.12);z-index:99;transition:opacity .8s;pointer-events:none'; LINE.innerHTML = '<i style="display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);background:rgba(255,154,77,.85);transition:transform .5s ease-out"></i>'; document.body.appendChild(LINE); }
    if (p === null) { LINE.style.opacity = 0; return; } LINE.style.opacity = 1; LINE.firstChild.style.transform = 'scaleX(' + clamp(p, 0, 1).toFixed(3) + ')'; }
  function hookKeys() {
    let hold = null; const any = e => {
      ensureAudio(); S.idle = 0;
      if (S.state === 'trailer' && !(e && e.repeat) && performance.now() - S.trailerT0 > 700) { if (e && e.preventDefault && e.type === 'keydown') e.preventDefault(); endTrailer(false); return; }
      if (S.state === 'menu' && e && e.code === 'KeyT' && !e.repeat && !(GT.front && GT.front.settingsPanel && document.querySelector('.f-set.on'))) { menuTrailer(); return; }
      if (S.awaitKey && (!e || !e.code || e.code === 'Enter' || e.code === 'Space') && !(e && e.repeat)) S.awaitKey();
      if (e && e.code === 'Enter' && !e.repeat && D.tl && D.tl.skippable && !hold) hold = setTimeout(() => { hold = null; S.skip(); }, 800); };
    addEventListener('keydown', any, true); addEventListener('mousedown', () => any(null), true); addEventListener('mousemove', () => { S.idle = 0; }, true);
    addEventListener('keyup', e => { if (e.code === 'Enter' && hold) { clearTimeout(hold); hold = null; } }, true);
  }
  function preboot() {   // runs as soon as this file loads: the studio logo plays while the remaining modules download and the world builds
    const Q = new URLSearchParams(location.search); if (!S.wants(Q)) { S.on = false; return; }
    save.load(); const bt = document.getElementById('boot'); if (bt) bt.style.display = 'none';
    hookKeys();                                         // before GT.front installs its own capture listeners
    if (Q.get('auto')) return;
    try { ui('init'); splashP = ui('splash'); } catch (e) { console.warn('[story] splash', e); }
  }
  function hookFront() {
    const F = GT.front; if (!F) return;
    const on = (ev, cb) => { try { if (typeof F.on === 'function') F.on(ev, cb); } catch (e) { S.frontIssues['on:' + ev] = String(e); } };
    on('skip', () => S.skip()); on('settings', () => applySettings());
    on('pause', () => { if (G.started && !G.paused) X.setPause(true); }); on('resume', () => { if (G.paused) X.setPause(false); });
    if (typeof F.on !== 'function') { try { if (F.onSkip) F.onSkip(() => S.skip()); if (F.onSettings) F.onSettings(() => applySettings()); } catch (e) { S.frontIssues.onSkip = String(e); } }
  }
  S.boot = async function (plan) {
    bind(); const Q = G.Q, auto = Q.get('auto'), steps = plan.steps, n = steps.length + 1;
    S.on = true; save.load();
    if (auto) { for (const s of steps) s[1](); try { ui('init'); } catch (e) { /* fallback */ } hookFront(); applySettings(); S.jump(auto, Q.get('at') !== null ? +Q.get('at') : null); plan.finish(); return; }
    // 1 — studio logo; the world is built step by step behind it
    if (splashP === null) { try { ui('init'); splashP = ui('splash'); } catch (e) { /* the fallback has been tried too */ } }
    let logoDone = false; after(splashP, () => { logoDone = true; }, 5000);
    fadeTo(1, 0); line(0); await sleep(900);
    for (let i = 0; i < steps.length; i++) { line((i + .4) / n); await frame(); await frame(); steps[i][1](); }
    line((n - .5) / n); hookFront(); applySettings();
    G.started = false; X.HUD.show('title', false); stagePrologue(); S.state = 'boot'; setFlags({ cine: true, hold: true, ui: true, pre: true }); S.free = { pos: WARM_NEW[0][0], look: WARM_NEW[0][1], fov: 30 };
    plan.finish();                                       // starts the frame loop: the first frames compile every shader, still behind the logo
    for (let i = 0; i < 4; i++) { await frame(); await sleep(60); } line(1);
    const t0 = performance.now(); while (!logoDone && performance.now() - t0 < 16000) await sleep(100);      // let the sting finish (any key skips it)
    line(null); S.free = null;
    // 2 — the trailer, then 3 — the menu
    S.trailer();
  };

  /* ================================================================== ?auto= story states (deterministic fast-forward, then hold) */
  function ffRun(seconds) {
    S.ff = true; S.ffTarget = seconds; S.ffPending = []; G.silent = true; let n = 0; const N = Math.round(seconds * 60), ext = S.state === 'trailer';
    while (n++ < N && !G.tickErr) { if (ext) { const tl = D.tl; if (!tl || tl.done) break; S.tlExt = true; const hold = tl.si >= 0 && tl.shots[tl.si].hold; if (!hold) GT.game.step(1 / 60); S.tlExt = false; tlAdvance(tl, 1 / 60); } else GT.game.step(1 / 60); }
    G.silent = false; S.ff = false; ui('fade', S.fadeLevel, 0); for (const f of S.ffPending.splice(0)) { try { f(); } catch (e) { fail('[story] ' + (e.stack || e)); } }
  }
  /** held stills: push GT.front's own animation clock along a little so cards / subtitles are fully in (uses its optional _seek extra) */
  function fseek() { const Q = G.Q, t = Q.get('fseek') !== null ? +Q.get('fseek') : 1.4; try { if (t > 0 && GT.front && GT.front._seek) GT.front._seek(t); } catch (e) { /* optional */ } }
  S.jump = function (state, at) {
    bind(); const Q = G.Q, vec = (k, d) => (Q.get(k) || d).split(',').map(Number), hold = Q.get('run') !== '1';
    G.started = true; X.HUD.show('title', false); G.ap.on = state === 'drive1' || state === 'drive2';
    S.ff = true;                                          // stage silently (no fades / sounds while jumping)
    switch (state) {
      case 'logo': S.ff = false; G.started = false; stagePrologue(); S.state = 'boot'; setFlags({ cine: true, hold: true, ui: true, pre: true }); fadeTo(1, 0); ui('splash'); line(.62); if (GT.front && GT.front._seek) GT.front._seek(at || 2.5); return;
      case 'loading': S.ff = false; G.started = false; stagePrologue(); S.state = 'loading'; setFlags({ cine: true, hold: true, ui: true, pre: true }); fadeTo(1, 0); ui('loading.show', { tips: TIPS, instant: true }); ui('loading.progress', .62, '预热镜头 4 / 7'); if (GT.front && GT.front._seek && at) GT.front._seek(at); return;
      case 'trailer': S.trailer(); ffRun(at === null || !isFinite(at) ? 6 : at); if (hold) { S.tlHold = true; G.freeze = true; fseek(); } if (G.atmosOn) { try { GT.atmos.setTime(X.currentHours()); } catch (e) { /* ignore */ } } return;
      case 'menu': S.ff = false; S.toMenu(); D.tl.t = (at || 0) % D.tl.len; D.tl.si = shotAt(D.tl, D.tl.t); S.cine = true; ui('fade', 0, 0); S.tlHold = hold; return;
      case 'intro': enterIntro(); break;
      case 'phone': X.startRun(); S.state = 'jump'; enterPhone(); break;
      case 'drive1': X.startRun(); S.state = 'jump'; enterDrive1(); break;
      case 'pickup': X.startRun(); S.state = 'jump'; enterPickup(); break;
      case 'drive2': X.startRun(); S.state = 'jump'; enterDrive2(); break;
      case 'title': X.startRun(); S.state = 'jump'; enterTitle(); break;
      case 'stinger': X.startRun(); S.state = 'jump'; S.lastResult = { result: 'clean', take: 1470, peak: 1, time: 86, rank: 'C', damage: 0, swapped: true }; enterStinger(S.lastResult); break;
      case 'card': case 'cardfail': X.startRun(); S.state = 'heist'; setFlags({}); X.R.take = state === 'card' ? 9450 : 5600; X.W.peak = state === 'card' ? 2 : 4; G.time = state === 'card' ? 252 : 167; GT.game.endRun(state === 'card' ? 'clean' : 'busted'); S.ff = false; ui('fade', 0, 0); G.Q.get('fseek') === null ? (GT.front && GT.front._seek && GT.front._seek(3.2)) : fseek(); return;
      case 'cam': { const stage = Q.get('stage') || 'prologue'; X.startRun(); S.state = 'jump'; G.holdHours = H0; stagePrologue();
        if (stage === 'pickup') { stagePickup(); if (Q.get('seat') === '1') seatPartner(); } else if (stage === 'title') { X.placePlayer(STALL.x, STALL.z, STALL.h); partnerOut(); } else if (stage === 'stinger') { G.holdHours = HNIGHT; X.placePlayer(STING.x, STING.z, STING.h); seatPartner(); P.lightsManual = true; }
        phase('cam'); setFlags({ cine: true, hold: true, ui: true, pre: true }); S.free = { pos: vec('pos', '0,3,0'), look: vec('look', '10,1,10'), fov: +(Q.get('fov') || 40) }; S.ff = false; ui('fade', 0, 0); if (Q.get('lb') === '1') letterbox(true, 0); if (at) ffRun(at); return; }
      default: S.ff = false; return;
    }
    const def = { intro: 9, phone: 3, drive1: 10, pickup: 3, drive2: 8, title: 6, stinger: 3 }[state];
    ffRun(at === null || at === undefined || !isFinite(at) ? def : at);
    if (!GAMEPLAY[S.state] && hold) { S.tlHold = true; G.freeze = true; fseek(); }      // hold the instant (the camera keeps breathing)
    if (G.atmosOn) { try { GT.atmos.setTime(X.currentHours()); } catch (e) { /* ignore */ } }
  };

  /* ================================================================== self-test cases (headless; called from game.js selftest) */
  S.selftest = function (line) {
    bind(); const keep = { silent: S.silent, data: save.data, mem: save.mem }; S.silent = true; S.on = true; save.mem = true; save.data = { prologue: false, chapter1: false, best: 0 }; G.storyOn = true; G.visual = false;
    const run = (until, maxT) => { let t = 0; while (!until() && t < maxT) { GT.game.step(1 / 60); t += 1 / 60; } return t; };
    const atStall = () => hyp(P.x - STALL.x, P.z - STALL.z) < .05 && Math.abs(angDiff(P.h, STALL.h)) < .01;
    try {
      // a) fresh start, every cinematic skipped
      X.startRun(); G.ap.on = true; S.state = 'boot'; S.start('new'); const seq = [S.state];
      S.skip(); seq.push(S.state); S.skip(); seq.push(S.state);
      const p0 = { x: P.x, z: P.z }, t1 = run(() => S.state !== 'drive1', 150), d1 = P.odo; seq.push(S.state);
      line(seq.join('>') === 'intro>phone>drive1>pickup', 'story: new story -> skip cold open -> skip phone -> prologue drive -> pickup (' + seq.join(' > ') + ')');
      line(S.state === 'pickup' && t1 > 15 && t1 < 60, 'story: drive to the motel arrives after ' + t1.toFixed(1) + ' s / ' + d1.toFixed(0) + ' m (from ' + p0.x.toFixed(0) + ',' + p0.z.toFixed(0) + ', autopilot ~50 km/h), no police: ' + G.cops.length + ' cruisers');
      S.skip(); const seated = !!(G.partner && G.partner.seat), o2 = P.odo; const t2 = run(() => S.state !== 'drive2', 150);
      line(S.state === 'title' && seated && t2 > 12 && t2 < 60, 'story: 阿烈 is in the car after the pickup; drive to the station arrives after ' + t2.toFixed(1) + ' s / ' + (P.odo - o2).toFixed(0) + ' m -> ' + S.state);
      S.skip(); const R = X.R;
      line(S.state === 'heist' && G.phase === 'wait' && atStall() && R.t < .05 && G.time < .05 && R.stage === 'start' && G.partner && !G.partner.seat && Math.abs(X.currentHours() - H0) < .01 && !S.pre && !S.cine,
        'story: title skipped -> WAIT starts clean (phase ' + G.phase + ', car on the stall: ' + atStall() + ', R.t ' + R.t.toFixed(2) + ', partner outside: ' + !(G.partner && G.partner.seat) + ', clock ' + X.currentHours().toFixed(2) + ')');
      line(save.data.prologue === true, 'story: prologue seen is saved -> the menu offers 继续');
      const t3 = run(() => R.stage !== 'start' && R.stage !== 'approach', 30); line(R.stage === 'register', 'story: the existing heist runs on from the hand-off (partner at the register after ' + t3.toFixed(1) + ' s)');
      // b) busted -> mission card -> retry lands on the station checkpoint
      GT.game.autopilot('busted', 1e9); let ends = 0; G.probe = (ty, d) => { if (ty === 'phase' && d.phase === 'end') ends++; };
      const t4 = run(() => ends > 0 && G.phase === 'wait', 320); G.probe = null;
      line(ends === 1 && S.lastResult && S.lastResult.result === 'busted' && S.state === 'heist' && G.phase === 'wait' && atStall() && X.R.t < .1, 'story: busted @ ' + (S.lastResult ? S.lastResult.time.toFixed(0) : '?') + ' s -> failed card -> retry at the station checkpoint (phase ' + G.phase + ', on the stall: ' + atStall() + ', prologue not replayed: ' + (S.state === 'heist') + ')');
      // c) clean -> passed card -> stinger -> credits -> menu with 继续
      GT.game.autopilot('calm', 19); const seen = {}; G.probe = (ty, d) => { if (ty === 'phase') seen[d.phase] = 1; };
      const t5 = run(() => S.state === 'menu', 520); G.probe = null;
      line(S.state === 'menu' && seen.stinger && seen.credits && S.lastResult && S.lastResult.result === 'clean' && save.data.chapter1 && save.data.prologue && !G.started,
        'story: clean ' + (S.lastResult ? X.money(S.lastResult.take) : '?') + ' -> passed card -> stinger -> credits -> menu (state ' + S.state + ', canContinue ' + !!save.data.prologue + ', ' + t5.toFixed(0) + ' sim-s)');
      // e) the trailer plays a real chase and ends on the menu
      S.trailer(); const tT = run(() => S.state === 'menu', 120), W = X.W;
      line(S.state === 'menu' && tT > 44 && tT < 71 && !G.started, 'story: trailer runs ' + tT.toFixed(1) + ' s of cuts over three scripted runs of the real sim, then lands on the menu');
      // d) continue goes straight to the checkpoint
      S.start('continue'); line(S.state === 'heist' && G.phase === 'wait' && atStall() && G.started, 'story: 继续 -> station checkpoint, prologue skipped (phase ' + G.phase + ')');
    } catch (e) { line(false, 'story self-test threw: ' + (e.stack || e)); }
    G.probe = null; S.silent = keep.silent; save.data = keep.data; save.mem = keep.mem; G.ap.on = false; D.tl = null; S.pending = null;
  };

  preboot();
})();
