/* cheats.js — typed cheat codes (2026-11-17, asked for by the owner).
   Type the letters anywhere in the game (best from the pause menu, Esc, so the keys do not also walk or open doors): the last letters typed are matched against CODES.
   workfisher → +$1,000,000 cash (through GT.wallet, so the HUD and the save follow it).
   GT.cheats = { codes, run(name) } */
(function () {
  'use strict';
  const GT = window.GT = window.GT || {};
  const CODES = {
    workfisher: { label: '秘籍已启用', detail: '+$1,000,000', run() { const w = GT.wallet; if (!w || typeof w.add !== 'function') return false; w.add(1000000, 'cheat'); return true; } }
  };
  const MAXLEN = Math.max.apply(null, Object.keys(CODES).map(k => k.length));
  let buf = '', last = 0;
  function say(a, b) {
    const ui = GT.cngame && GT.cngame.ui;
    try { if (ui && typeof ui.toast === 'function') { ui.toast(a, b); return; } } catch (e) { /* fall through */ }
    try { if (GT.front && typeof GT.front.hint === 'function') GT.front.hint(a + ' · ' + b); } catch (e) { /* no ui */ }
  }
  function run(name) {
    const c = CODES[name]; if (!c) return false;
    let ok = false; try { ok = c.run() !== false; } catch (e) { console.warn('[cheats] ' + name, e); }
    if (ok) { say(c.label, c.detail); try { if (GT.audio && typeof GT.audio.sfx === 'function') GT.audio.sfx('pickup'); } catch (e) { /* silent */ } }
    return ok;
  }
  addEventListener('keydown', e => {
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = (e.key || '').toLowerCase(); if (k.length !== 1 || k < 'a' || k > 'z') return;
    const now = performance.now(); if (now - last > 3000) buf = ''; last = now;
    buf = (buf + k).slice(-MAXLEN);
    for (const name in CODES) if (buf.endsWith(name)) { buf = ''; run(name); break; }
  }, true);
  GT.cheats = { codes: Object.keys(CODES), run };
})();
