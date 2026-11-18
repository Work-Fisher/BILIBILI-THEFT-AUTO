/* street.js — BILIBILI THEFT AUTO 1 (China edition): the street ecosystem (开发计划.md §4, 新方案.md 三 · 二). Five living set pieces the player meets in free roam.
   1. 跳水大爷  冬泳码头 (anchor swimDive). A springboard, a captain and three judges who are there day and night, stretching and diving in turn.
                E at the board: with stars -> the captain drags you into the river (水遁: the wanted level is cleared, you surface downstream at the kite lawn);
                without stars -> a first-person scored dive: Space to take off on the bounce, A / D to keep the body straight. 8.5+ = 压水花, focus refilled, the judges
                raise foam boards; 4 or less = 拍水, half your health.
   2. 广场舞方阵 江滩广场 (anchor danceCentre), 19:00–21:30. 38 instanced dancers (3 draw calls) fill in around the 13 skinned ones of js/people.js and keep their beat.
                A vehicle inside the formation is held to walking pace and surrounded; E inside = 跟跳 (officers cannot see you, stars melt, 8 s without stars = focus);
                Z at the trolley speaker = kick it over: eight of them chase you with fans.
   3. 西瓜摊冲突 two fruit trikes on the east pavement (小吃街路口 / 六十七号院巷口). 老秤 sells; every couple of minutes 阿豹 comes to collect an invented fee.
                E 买瓜 $10 (+40) · Z 拱火 (he pulls a gun: js/combat.js enemies; win = red envelope + free melon for life) · Y 抢瓜 (a whole melon in hand, Y again throws it:
                3 s blind on whoever it hits). Characters and lines are original (开发计划.md §9).
   4. 老头乐    「跑不快」 mobility car on the avenue: any lane, either direction, U-turns when it feels like it, hazards always on. Hit it and 钱大爷 lies down in front of you
                (E 赔 $200, or drive off = 逃逸); a gang vehicle that hits it is abandoned. F steals it: 35 km/h, and patrol cars will not ram it.
   5. 相亲角情报 江滩 (anchor matchCorner): a notice screen whose cards hide five clues about the cast (E to read), and 胡阿姨 / 老蔡 whose gossip (stand close, walk, do not
                run) marks a stash on the map: three foam boxes with cash.
   GT.street = { init(game) / update(dt)   called by js/cngame.js      spots [{id, name, x, z}] · state (live) · lines / voiceList() (every bark: {voice, name, text, dialect})
                 dive {start('escape' | 'score'), score(tilt, takeoff)} · dance {join(), leave(), kick()} · melon {buy(i), stoke(), grab(i), throw(), event(i), calm()} ·
                 ltl {ent, hit(ent), pay(), reset()} · match {read(), listen(), open(id)} · reset() (wipes the save) }
   Save: localStorage bta1.street.v1. Hooks elsewhere: js/cngame.js (init / update, the 'laotoule' rows of DIMS / FBCOL / MASS / SPECS and the HUD name; rulesStep: one wrong-way ticket per 13.6 s, and a red light
   run against the flow is caught at the oncoming stop line), cn.html MODULES.
   Round b2 (play reports reports/b2-street1-r1.md, b2-street2-r1.md, b2-shops-r1.md, b2-story2-r1.md): the swim deck is listed in GT.L.extra (deckWalk) so it can be walked; the dive has its own underwater
   (UW), judges who hold their boards, and an exit at the rail; the dance is joined in third person and nobody is drawn within 0.95 m of the lens; the speaker revenge stings but stops at 30 hp; the melon fight
   starts at six metres and Y grabs a melon while js/combat.js has the controls (pp() = the real player position then); 老头乐 keeps to one side of the median, goes round or backs off what blocks it and reacts
   to the player's horn; stash 1 sits inside the wharf's east gate; the 保安 on the bank steps takes cover in a gunfight (guardStep).
   Runs in free roam only: while a story mission, a cutscene or the opening trailer has the street, the car is taken off the road and no event starts. */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!T || !GT) return;
  const PI = Math.PI, HP = PI / 2, TAU = PI * 2, sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max, hyp = Math.hypot;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
  const sst = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const approach = (a, b, st) => a < b ? min(b, a + st) : max(b, a - st);
  const safe = (fn, fb) => { try { return fn(); } catch (e) { safe.n = (safe.n || 0) + 1; if (safe.n < 12 && window.console) console.warn('[street]', e); return fb; } };
  let rnd = GT.rng('street1');
  const pick = a => a[(rnd() * a.length) | 0];
  const HEI = "'PingFang SC','Heiti SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif", KAI = "'Kaiti SC','STKaiti','KaiTi','Songti SC',serif";

  const S = { inited: false, visual: false, game: null, G: null, scene: null, root: null, t: 0, frame: 0, actors: [], hid: null, sayT: 0, bad: {}, free: false };
  let P = { mode: 'foot', x: 0, z: 0, y: 0, h: 0, speed: 0, ent: null, inside: false };
  /** live state for testers: GT.street.state */
  const ST = { ready: false, free: false, lastLine: null,
    dive: { phase: 'idle', busy: false, last: null, best: 0, dives: 0, escapes: 0 },
    dance: { active: false, count: 0, joined: false, blocked: 0, rage: 0, speakerDown: false, kicks: 0, joins: 0 },
    melon: { site: -1, held: false, bought: 0, vip: false, fights: 0, thrown: 0, blinded: 0 },
    ltl: { x: 0, z: 0, wrongWay: false, jam: 0, hits: 0, stolen: 0, paid: 0, gangFled: 0 },
    match: { card: -1, clues: 0, listening: 0, hush: false, stashOpen: 0, stashDone: 0 } };
  const SPOTS = [];
  const spot = (id, name, x, z) => { let s = SPOTS.find(q => q.id === id); if (!s) { s = { id, name, x, z }; SPOTS.push(s); } s.x = Math.round(x * 100) / 100; s.z = Math.round(z * 100) / 100; return s; };

  /* ================================================================== save */
  const KEY = 'bta1.street.v1';
  const blank = () => ({ dive: { best: 0, n: 0, esc: 0 }, dance: { joins: 0, kicks: 0 }, melon: { bought: 0, vip: false, saved: 0 }, ltl: { stolen: 0, paid: 0 }, match: { cards: {}, clues: {}, stash: {}, heard: 0 } });
  let SV = blank();
  function load() { const b = blank(); try { const o = JSON.parse(window.localStorage.getItem(KEY) || 'null'); if (o && typeof o === 'object') for (const k in b) if (o[k] && typeof o[k] === 'object') Object.assign(b[k], o[k]); } catch (e) { /* no storage */ } return b; }
  function save() { try { window.localStorage.setItem(KEY, JSON.stringify(SV)); } catch (e) { /* no storage */ } }

  /* ================================================================== lines (the dialogue format of js/cnstory.js: {voice, name, text, dialect}) */
  const LINES = [], LN = {};
  const mkLine = (sec, i, name, dialect, text) => { const o = { voice: 'st.' + sec + '.' + (i < 9 ? '0' : '') + (i + 1), name, text, dialect, sec }; LINES.push(o); return o; };
  const L = (sec, name, dialect, texts) => { LN[sec] = texts.map((t, i) => mkLine(sec, i, name, dialect, t)); };
  const LM = (sec, rows) => { LN[sec] = rows.map((r, i) => mkLine(sec, i, r[0], r[1], r[2])); };
  /* The street cast's written lines were removed on 2026-11-17 (the user asked for all dialogue to go; it will be rewritten). Every section key is still registered, so bark() / convo() / the melon argument
     find an (often empty) list and simply say nothing; only one- or two-word reactions are left. New lines go back in with L(section, name, dialect, [texts]) or LM(section, [[name, dialect, text], ...]). */
  ['dive.greet', 'dive.pull', 'dive.show', 'dive.ten', 'dive.mid', 'dive.flop', 'dive.bump', 'dive.kai', 'dance.lead', 'dance.block', 'dance.join', 'dance.kai', 'dance.cop', 'dance.kick', 'dance.calm', 'melon.argue', 'melon.timeout', 'melon.stoke', 'melon.won', 'melon.buy', 'melon.free', 'melon.broke', 'melon.eat', 'melon.grab', 'melon.hit', 'melon.laugh', 'melon.miss', 'ltl.honk', 'ltl.uturn', 'ltl.stall', 'ltl.hit', 'ltl.paid', 'ltl.run', 'ltl.wait', 'ltl.gang', 'ltl.stolen', 'ltl.kai', 'ltl.cop', 'match.idle', 'match.hush', 'match.g1', 'match.g2', 'match.g3', 'match.g0', 'match.kai'].forEach(k => { LN[k] = []; });
  L('dive.ten', '跳水大爷', 'wh', ['十分！']);
  L('dive.mid', '跳水大爷', 'wh', ['还行。']);
  L('dive.flop', '跳水大爷', 'wh', ['哎哟！']);
  L('dive.bump', '跳水大爷', 'wh', ['莫挤！']);
  L('dance.block', '广场舞大妈', 'pth', ['让开！', '下车！']);
  L('dance.kick', '广场舞大妈', 'pth', ['谁踢的？！', '别跑！']);
  L('melon.buy', '老秤', 'cs', ['十块一牙。']);
  L('melon.grab', '老秤', 'cs', ['给钱！']);
  L('melon.hit', '阿豹', 'pth', ['我的眼睛！']);
  L('ltl.honk', '钱大爷', 'pth', ['别催！']);
  L('ltl.hit', '钱大爷', 'pth', ['哎哟！撞人啦！']);
  L('ltl.run', '钱大爷', 'pth', ['别跑！']);
  L('ltl.stolen', '钱大爷', 'pth', ['我的车！']);
  const voiceList = () => LINES.map(l => ({ voice: l.voice, text: l.text, who: l.name, dialect: l.dialect }));

  function say(o, sec) { if (!o) return 0; const d = sec || (GT.vo && GT.vo.dur && GT.vo.dur(o.voice)) || clamp(1.1 + o.text.length * .16, 1.6, 5.5); ST.lastLine = o; S.sayT = S.t + min(d, 2.2);
    if (S.game) { safe(() => S.game.emit('line', o)); const F = GT.front, sub = () => S.game.say(o.name, o.text, d); /* street chatter is 'ambient' for the subtitle queue of js/front.js: a new line replaces the street line on screen instead of waiting behind it (the queue ran seconds late: 阿豹's taunt came up after the melon had already blinded him) */ safe(() => (F && F.ambient ? F.ambient(sub) : sub())); if (S.visual && GT.audio && GT.audio.voice) safe(() => GT.audio.voice(o.voice)); } return d; }
  const BT = {};
  /** one line of a section, round robin; gap = seconds before the same section may speak again. Returns the line or null. */
  function bark(sec, gap, force) { const a = LN[sec]; if (!a || !a.length || (!force && (S.t < (BT[sec] || 0) || S.t < S.sayT))) return null; if (!force && sec.indexOf('ltl.') === 0 && (P.x < -11.5 || P.x > 15.5)) return null;   /* b5: 钱大爷 on the avenue is only heard by someone on the avenue or its pavements; his lines used to come up as subtitles in the wharf gate, a block away behind a wall */ const k = 'n:' + sec, i = BT[k] = ((BT[k] === undefined ? -1 : BT[k]) + 1) % a.length; BT[sec] = S.t + (gap === undefined ? 6 : gap); say(a[i]); return a[i]; }
  const QL = [];
  const later = (t, fn, tag) => { QL.push({ t: S.t + t, fn, tag: tag || '' }); };
  const cancel = tag => { for (let i = QL.length - 1; i >= 0; i--) if (QL[i].tag === tag) QL.splice(i, 1); };
  function runQ() { for (let i = QL.length - 1; i >= 0; i--) if (S.t >= QL[i].t) { const f = QL[i].fn; QL.splice(i, 1); safe(f); } }
  function convo(sec, gap, then) { const a = LN[sec] || [], tag = sec.split('.')[0]; gap = gap || 3.3; a.forEach((o, i) => later(i * gap, () => say(o), tag)); if (then) later(a.length * gap, then, tag); return a.length * gap; }

  /* ================================================================== game shorthands */
  const hours = () => (S.G && typeof S.G.hours === 'number' ? S.G.hours : 12);
  const night = () => ((GT.env && GT.env.night) || 0) > .35;
  const gY = (x, z, y) => { const v = safe(() => S.game.groundY(x, z, y), 0); return isFinite(v) ? v : 0; };
  const distP = (x, z) => hyp(P.x - x, P.z - z);
  const toast = (a, b) => { if (S.visual) safe(() => S.game.ui.toast(a, b || '')); };
  const sfx = (n, o) => safe(() => GT.audio && GT.audio.sfx && GT.audio.sfx(n, o));
  const smp = (n, o) => safe(() => GT.samples && GT.samples.play && GT.samples.play(n, o));
  const stars = () => safe(() => S.game.wanted.stars, 0) || 0;
  const hpNow = () => safe(() => S.game.state.hp, 100);
  const addFocus = v => { const p = GT.combat && GT.combat.player; if (p && typeof p.focus === 'number') p.focus = clamp(p.focus + v, 0, 1); };
  const onFoot = () => P.mode === 'foot' && !(P.down > 0);
  /** where the player really is: while js/combat.js is engaged it moves him itself and the on-foot controller (and with it game.player and every GT.act prompt) stands still */
  const pp = () => { const c = GT.combat, p = c && c.engaged && c.player; return p && isFinite(p.x) && isFinite(p.z) ? p : P; };
  const input = () => GT.input || null;
  const addSpot = s => { if (GT.act && GT.act.add) safe(() => GT.act.add(s)); else (GT._actQueue = GT._actQueue || []).push(s); return s; };
  const anchor = (n, fb) => { const a = safe(() => S.game.anchor(n, null), null); return a || fb; };
  function blocked(x0, z0, x1, z1, gy) { const B = (GT.world && GT.world.boxes) || []; for (let i = 0; i < B.length; i++) { const b = B[i]; if (b.x1 <= x0 || b.x0 >= x1 || b.z1 <= z0 || b.z0 >= z1) continue; if (b.h > gy + .3) return true; } return false; }
  /** keep (x, z) when a hw × hd footprint is clear there, else the nearest clear place within 8 m. -> {x, z, fit: 'ok' | 'moved' | 'forced'} */
  function fit(x, z, hw, hd, o) { o = o || {};
    const ok = (px, pz) => { const gy = gY(px, pz, o.y); if (blocked(px - hw, pz - hd, px + hw, pz + hd, gy)) return false; if (!o.road && safe(() => S.game.inRoad(px, pz), false)) return false; return abs(gY(px + hw, pz + hd, gy) - gy) < .12 && abs(gY(px - hw, pz - hd, gy) - gy) < .12; };
    if (ok(x, z)) return { x, z, fit: 'ok' };
    for (let d = .6; d <= 8; d += .6) for (let a = 0; a < 12; a++) { const px = x + sin(a * PI / 6) * d, pz = z + cos(a * PI / 6) * d; if (ok(px, pz)) return { x: Math.round(px * 100) / 100, z: Math.round(pz * 100) / 100, fit: 'moved' }; }
    return { x, z, fit: 'forced' }; }

  /* ================================================================== drawing helpers */
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function tex(w, h, draw) { const c = cv(w, h), g = c.getContext('2d'); draw(g, w, h); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; }
  const paper = (w, h, draw, o) => new T.MeshStandardMaterial(Object.assign({ map: tex(w, h, draw), roughness: .9, metalness: 0 }, o || {}));
  const col = (name, hex, rough, metal) => { const o = { color: hex }; if (rough !== undefined) o.rough = rough; if (metal !== undefined) o.metal = metal; return GT.mat(name, o); };
  const glowMat = (r, g, b) => new T.MeshBasicMaterial({ color: new T.Color(r, g, b) });
  function addMesh(parent, geo, mat, x, y, z, o) { o = o || {}; const m = new T.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); if (o.s !== undefined) { if (Array.isArray(o.s)) m.scale.set(o.s[0], o.s[1], o.s[2]); else m.scale.setScalar(o.s); } m.castShadow = o.cast !== false && !mat.transparent && !mat.isMeshBasicMaterial; m.receiveShadow = o.recv !== false; parent.add(m); return m; }
  /* vertex-coloured parts for the instanced crowd and the melon chunks */
  function cgeo(g, hex) { g = g.index ? g.toNonIndexed() : g; const n = g.attributes.position.count, c = GT.C(hex), a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new T.BufferAttribute(a, 3)); return g; }
  function at(g, x, y, z, rx, ry, rz, s) { g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x || 0, y || 0, z || 0), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0, 'YXZ')), Array.isArray(s) ? new T.Vector3(s[0], s[1], s[2]) : new T.Vector3(s || 1, s || 1, s || 1))); return g; }
  function mergeC(list) { let n = 0; for (const g of list) n += g.attributes.position.count; const p = new Float32Array(n * 3), nr = new Float32Array(n * 3), c = new Float32Array(n * 3); let o = 0;
    for (const g of list) { p.set(g.attributes.position.array, o * 3); nr.set(g.attributes.normal.array, o * 3); c.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
    const out = new T.BufferGeometry(); out.setAttribute('position', new T.BufferAttribute(p, 3)); out.setAttribute('normal', new T.BufferAttribute(nr, 3)); out.setAttribute('color', new T.BufferAttribute(c, 3)); return out; }
  const part = (g, hex, x, y, z, rx, ry, rz, s) => at(cgeo(g, hex), x, y, z, rx, ry, rz, s);

  /* ================================================================== actors: js/people.js figures the pieces move themselves */
  function actor(type, x, z, h, o) { o = o || {}; let fig = null; if (S.visual && GT.people && GT.people.make) fig = safe(() => GT.people.make(type, Object.assign({ seed: o.seed || 0, phone: false }, o.opts)), null);
    const a = { type, fig, group: fig && fig.group ? fig.group : null, x, z, y: o.y, dy: 0, rx: 0, h: h || 0, state: o.state || 'idle', speed: 0, vis: true, wp: null, spd: 1.2, then: null, seat: o.seat, speak: undefined, far: o.far || 75, held: false,
      goTo(pts, spd, then) { a.wp = (Array.isArray(pts[0]) ? pts : [pts]).map(p => ({ x: p[0], z: p[1] })); a.spd = spd || 1.2; a.then = then || null; return a; },
      face(x2, z2, dt) { a.h += angDiff(a.h, Math.atan2(x2 - a.x, z2 - a.z)) * min(1, (dt || 1) * 6); return a; } };
    if (a.group) { a.group.visible = false; S.root.add(a.group); } S.actors.push(a); return a; }
  function actorStep(a, dt) {
    if (a.wp && a.wp.length) { const w = a.wp[0], dx = w.x - a.x, dz = w.z - a.z, d = hyp(dx, dz), st = a.spd * dt;
      if (d <= st + .03) { a.x = w.x; a.z = w.z; a.wp.shift(); if (!a.wp.length) { a.wp = null; a.speed = 0; if (a.state === 'walk' || a.state === 'run') a.state = 'idle'; const f = a.then; a.then = null; if (f) safe(() => f(a)); } }
      else { a.x += dx / d * st; a.z += dz / d * st; a.h += angDiff(a.h, Math.atan2(dx, dz)) * min(1, dt * 9); a.speed = a.spd; a.state = a.spd > 2.6 ? 'run' : 'walk'; } }
    else if (a.state === 'walk' || a.state === 'run') { a.state = 'idle'; a.speed = 0; }
    const g = a.group; if (!g || a.held) return; const d = distP(a.x, a.z), show = a.vis && d < a.far; if (g.visible !== show) g.visible = show; if (!show) return;
    g.position.set(a.x, (a.y !== undefined ? a.y : gY(a.x, a.z, P.y + .5)) + a.dy, a.z); g.rotation.set(a.rx, a.h, 0, 'YXZ');
    if (a.bad || (d > 42 && (S.frame + S.actors.indexOf(a)) % 3)) return;
    try { a.fig.update(d > 42 ? dt * 3 : dt, { state: a.state, speed: a.speed, seat: a.seat, speak: a.speak, drop: a.drop }); }   /* drop: the 'dive' one-shot of js/people.js carries its own crouch, take-off and fall */ catch (e) { a.bad = true; if (window.console) console.warn('[street] figure', e); } }

  /* ================================================================== DOM overlay */
  const UI = { root: null, el: {} };
  const CSS = '#st-ui{position:fixed;inset:0;pointer-events:none;z-index:38;font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif;-webkit-font-smoothing:antialiased;user-select:none;color:#f6f1e7}' +
    '#st-ui .st-water{position:absolute;inset:0;opacity:0;transition:opacity .22s;background:radial-gradient(125% 95% at 50% 2%,rgba(170,240,220,.08),rgba(10,64,74,.26) 55%,rgba(2,16,24,.72));-webkit-backdrop-filter:blur(1.2px);backdrop-filter:blur(1.2px)}' +
    '#st-ui .st-water.flat{background:radial-gradient(120% 90% at 50% 12%,rgba(150,220,200,.28),rgba(16,70,78,.84) 55%,rgba(3,20,28,.97));-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
    '#st-ui .st-wet{position:absolute;inset:-14% 0 0 0;opacity:0;background:radial-gradient(9px 15px at 11% 30%,rgba(225,245,252,.55),transparent 72%),radial-gradient(6px 11px at 27% 52%,rgba(225,245,252,.5),transparent 72%),radial-gradient(10px 17px at 43% 24%,rgba(225,245,252,.5),transparent 72%),radial-gradient(7px 12px at 58% 61%,rgba(225,245,252,.48),transparent 72%),radial-gradient(11px 18px at 71% 33%,rgba(225,245,252,.52),transparent 72%),radial-gradient(6px 10px at 86% 47%,rgba(225,245,252,.5),transparent 72%),radial-gradient(8px 13px at 93% 20%,rgba(225,245,252,.45),transparent 72%),radial-gradient(5px 9px at 36% 78%,rgba(225,245,252,.45),transparent 72%),radial-gradient(130% 105% at 50% 50%,transparent 52%,rgba(110,185,205,.26))}' +
    '#st-ui .st-wet.on{animation:st-drip 4.6s cubic-bezier(.5,0,.8,.4) forwards}@keyframes st-drip{0%{opacity:1;transform:translateY(0)}60%{opacity:.75}100%{opacity:0;transform:translateY(11%)}}' +
    '#st-ui .st-water.on{opacity:1}' +
    '#st-ui .st-wave{position:absolute;inset:0;opacity:var(--a,0);box-shadow:inset 0 0 calc(70px + 90px*var(--b,0)) rgba(255,84,54,.34);transition:opacity .3s}' +
    '#st-ui .st-wave i{position:absolute;left:50%;top:50%;width:150vmax;height:150vmax;margin:-75vmax 0 0 -75vmax;border-radius:50%;border:2px solid rgba(255,196,120,.34);transform:scale(calc(.52 + var(--n)*.11 + var(--b,0)*.035));opacity:calc(.9 - var(--n)*.22)}' +
    '#st-ui .st-dive{position:absolute;left:50%;bottom:25vh;width:430px;margin-left:-215px;display:flex;align-items:flex-end;gap:18px;opacity:0;transform:translateY(14px);transition:opacity .2s,transform .25s cubic-bezier(.2,.8,.2,1)}' +
    '#st-ui .st-dive.on{opacity:1;transform:none}' +
    '#st-ui .st-bar{position:relative;width:16px;height:124px;border-radius:9px;background:rgba(10,12,16,.62);box-shadow:0 0 0 1px rgba(255,255,255,.12) inset,0 8px 22px rgba(0,0,0,.4)}' +
    '#st-ui .st-bar u{position:absolute;left:2px;right:2px;bottom:66%;height:22%;border-radius:6px;background:linear-gradient(#7af0b0,#34c27c)}' +
    '#st-ui .st-bar b{position:absolute;left:-5px;right:-5px;height:4px;border-radius:2px;background:#fff;box-shadow:0 0 8px rgba(255,255,255,.9);bottom:calc(var(--m,0)*100% - 2px)}' +
    '#st-ui .st-arc{flex:1;padding:10px 14px 8px;border-radius:14px;background:linear-gradient(180deg,rgba(10,12,16,.7),rgba(10,12,16,.46));box-shadow:0 0 0 1px rgba(255,255,255,.08) inset,0 10px 26px rgba(0,0,0,.36);-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px)}' +
    '#st-ui .st-arc svg{display:block;width:100%;height:auto}#st-ui .st-arc p{margin:2px 0 0;font-size:13.5px;letter-spacing:.08em;text-align:center;opacity:.86}' +
    '#st-ui .st-arc p b{display:inline-block;min-width:22px;padding:1px 6px;margin:0 3px;border-radius:5px;background:#f6f1e7;color:#14161a;font-weight:800;font-size:12px}' +
    '#st-ui .st-score{position:absolute;left:50%;top:17vh;transform:translate(-50%,0) scale(.6);opacity:0;text-align:center;transition:opacity .18s,transform .42s cubic-bezier(.2,1.5,.3,1);text-shadow:0 6px 30px rgba(0,0,0,.6)}' +
    '#st-ui .st-score.on{opacity:1;transform:translate(-50%,0) scale(1)}' +
    '#st-ui .st-score b{display:block;font:900 118px/1 "DIN Alternate","Helvetica Neue",Arial,sans-serif;letter-spacing:-.02em;color:#ffe9a8}#st-ui .st-score.bad b{color:#ff7a5c}' +
    '#st-ui .st-score span{display:block;margin-top:4px;font-size:22px;font-weight:800;letter-spacing:.3em}' +
    '#st-ui .st-ear{position:absolute;left:50%;bottom:19vh;transform:translateX(-50%);padding:8px 18px 10px;border-radius:20px;background:rgba(10,12,16,.7);font-size:15px;letter-spacing:.14em;opacity:0;transition:opacity .2s;box-shadow:0 0 0 1px rgba(255,255,255,.08) inset}' +
    '#st-ui .st-ear.on{opacity:1}#st-ui .st-ear i{display:block;height:3px;margin-top:6px;border-radius:2px;background:rgba(255,255,255,.18);overflow:hidden}#st-ui .st-ear i u{display:block;height:100%;width:calc(var(--p,0)*100%);background:#ffd24a}' +
    '#st-ui .st-card{position:absolute;left:5vw;top:22vh;width:330px;padding:0 0 16px;color:#1c1a17;background:#f7f0dc;border-radius:3px;box-shadow:0 22px 50px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.12);transform:rotate(-1.6deg) translateY(16px);opacity:0;transition:opacity .18s,transform .3s cubic-bezier(.2,.8,.2,1)}' +
    '#st-ui .st-card.on{opacity:1;transform:rotate(-1.6deg)}' +
    '#st-ui .st-card h4{margin:0;padding:13px 18px 11px;font:900 25px/1.1 ' + HEI.replace(/'/g, '"') + ';color:#b3201a;border-bottom:3px solid #b3201a;letter-spacing:.04em}' +
    '#st-ui .st-card p{margin:9px 18px 0;font-size:18px;font-weight:600;line-height:1.38}#st-ui .st-card small{display:block;margin:13px 18px 0;font-size:13px;color:#1d3f78;letter-spacing:.06em}' +
    '#st-ui .st-card em{display:none;position:absolute;right:14px;top:50px;padding:3px 10px;border:3px solid #c2251d;border-radius:6px;color:#c2251d;font:900 20px/1.2 ' + KAI.replace(/'/g, '"') + ';transform:rotate(11deg);opacity:.86}' +
    '#st-ui .st-card.clue em{display:block}#st-ui .st-card q{display:none;margin:12px 18px 0;padding:8px 10px;background:rgba(194,37,29,.09);border-left:3px solid #c2251d;font-size:14.5px;line-height:1.4;quotes:none}#st-ui .st-card.clue q{display:block}' +
    '#st-ui .st-card s{position:absolute;left:50%;top:-9px;width:17px;height:17px;margin-left:-8px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ff8a7a,#b3201a 62%);box-shadow:0 3px 5px rgba(0,0,0,.4);text-decoration:none}' +
    '#st-ui .st-chip{position:absolute;right:4.2vw;bottom:31vh;display:flex;align-items:center;gap:11px;padding:7px 16px 7px 8px;border-radius:24px 6px 6px 24px;background:linear-gradient(90deg,rgba(12,13,17,.76),rgba(12,13,17,.4));border-right:2px solid #5fd070;font-size:15.5px;font-weight:600;opacity:0;transform:translateX(16px);transition:opacity .18s,transform .22s}' +
    '#st-ui .st-chip.on{opacity:1;transform:none}#st-ui .st-chip i{width:34px;height:34px;border-radius:50%;background:repeating-conic-gradient(from 8deg,#1b5a2a 0 14deg,#3a9a48 14deg 40deg);box-shadow:inset -5px -6px 9px rgba(0,0,0,.45),inset 3px 3px 5px rgba(255,255,255,.25)}' +
    '#st-ui .st-chip b{padding:1px 7px;margin-right:2px;border-radius:5px;background:#f6f1e7;color:#14161a;font-weight:800;font-size:13px}';
  function uiInit() { if (UI.root || !S.visual || typeof document === 'undefined') return; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const r = UI.root = document.createElement('div'); r.id = 'st-ui';
    r.innerHTML = '<div class="st-wave"><i style="--n:0"></i><i style="--n:1"></i><i style="--n:2"></i></div><div class="st-water"></div>' +
      '<div class="st-dive"><div class="st-bar"><u></u><b></b></div><div class="st-arc"><svg viewBox="0 0 200 104"><path d="M20 100A80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="6" stroke-linecap="round"/><path d="M86.1 21.2A80 80 0 0 1 113.9 21.2" fill="none" stroke="#5fe0a0" stroke-width="9" stroke-linecap="round"/>' +
      '<g class="st-ndl"><line x1="100" y1="100" x2="100" y2="27" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="100" cy="100" r="6" fill="#fff"/></g></svg><p></p></div></div>' +
      '<div class="st-score"><b></b><span></span></div><div class="st-ear">偷听中<i><u></u></i></div><div class="st-card"><s></s><em>线索</em><h4></h4><div class="st-cl"></div><q></q><small>有意请与家长面谈 · 谢绝中介</small></div><div class="st-chip"><i></i><span><b>Y</b><u style="text-decoration:none">把西瓜砸出去</u></span></div><div class="st-wet"></div>';
    document.body.appendChild(r); for (const k of ['wave', 'water', 'dive', 'score', 'ear', 'card', 'chip', 'wet']) UI.el[k] = r.querySelector('.st-' + k); UI.el.ndl = r.querySelector('.st-ndl'); UI.el.hint = r.querySelector('.st-arc p'); UI.el.chipT = r.querySelector('.st-chip u'); }
  /** the Y chip by the right edge: chip(false) hides it, chip('把西瓜砸出去') shows it with that text */
  function chip(text) { if (UI.chipS === text) return; UI.chipS = text; if (text && UI.el.chipT) UI.el.chipT.textContent = text; uiOn('chip', !!text); }
  /** water running off the visor after a swim */
  function wet() { const e = UI.el.wet; if (!e) return; cancel('wet'); e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); later(4.9, () => e.classList.remove('on'), 'wet'); }
  const uiOn = (k, on) => { const e = UI.el[k]; if (e) e.classList.toggle('on', !!on); };
  const uiVar = (k, name, v) => { const e = UI.el[k]; if (e) e.style.setProperty(name, v); };
  const fade = (v, ms) => safe(() => GT.front && GT.front.fade && GT.front.fade(v, ms));

  /* ================================================================== 1. 跳水大爷 */
  const DV = { x: -65.65, z: -20, y: -1.2, wy: -2, E: -66, cap: null, judges: [], boards: [], busy: false, cd: 0, run: null, cam: { pos: [0, 0, 0], look: [0, 0, 1], fov: 62 }, show: null, loopT: 16, turn: 0, exit: { x: -40, z: -70, h: HP }, boardT: 0, greetT: 0, walk: false, walkT: 0 };
  /** the pontoon and its stairs lie west of the level bound (GT.L.bounds.x0): js/onfoot.js clamps the walker to the bounds unless the place is listed in GT.L.extra (as the pier is).
      The rails of js/riverside.js close the deck on three sides; the strip of water past the dive gap is included so that stepping off the edge falls in (js/cngame.js 'water') instead of snapping back to the promenade. */
  function deckWalk() { const Lv = GT.L, D = (GT.riverside && GT.riverside.layout && GT.riverside.layout.deck) || { x0: -66, x1: -60.4, z0: -26, z1: -14 }; if (!Lv || !Lv.bounds) return false;
    Lv.extra = (Lv.extra || []).filter(e => e.id !== 'swimdeck').concat({ id: 'swimdeck', x0: D.x0 - 4, x1: Lv.bounds.x0 + .7, z0: D.z0 - .3, z1: D.z1 + .3 }); DV.walk = true; return true; }
  /* ---- under the surface: the river shader has no underside and the far bank shows through, so the dive carries its own water: a graded dome round the lens, the surface seen from
     below (two drifting caustic layers and the sun's patch), light shafts and bubbles. Unlit materials, five draw calls, visible only while a dive is under water. */
  const UW = { grp: null, dome: null, bub: null, B: [], maps: [], surf: [], rays: [], glow: null, t: 0, on: false };
  function uwBuild() {
    const g = new T.Group(); g.name = 'street_underwater'; g.visible = false;
    const sg = new T.SphereGeometry(13, 28, 18), n = sg.attributes.position.count, ca = new Float32Array(n * 3), top = [.15, .5, .47], mid = [.028, .19, .23], bot = [.004, .03, .045];
    for (let i = 0; i < n; i++) { const yy = sg.attributes.position.getY(i) / 13, a = yy > 0 ? mid : bot, b = yy > 0 ? top : mid, t = yy > 0 ? Math.pow(yy, .7) : 1 + yy; for (let k = 0; k < 3; k++) ca[i * 3 + k] = lerp(a[k], b[k], t); }
    sg.setAttribute('color', new T.BufferAttribute(ca, 3)); UW.dome = new T.Mesh(sg, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false })); UW.dome.frustumCulled = false; g.add(UW.dome);
    const cells = []; for (let i = 0; i < 52; i++) cells.push([rnd() * 256, rnd() * 256, 12 + rnd() * 30, .5 + rnd() * .5, rnd() * PI, .1 + rnd() * .17, 1.5 + rnd() * 3.5]);
    const ctex = base => { const t = tex(256, 256, (c, w, h) => { c.fillStyle = base; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'lighter'; for (const q of cells) { c.strokeStyle = 'rgba(165,240,220,' + q[5].toFixed(3) + ')'; c.lineWidth = q[6]; for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { c.beginPath(); c.ellipse(q[0] + ox, q[1] + oy, q[2], q[2] * q[3], q[4], 0, TAU); c.stroke(); } } }); t.wrapS = t.wrapT = T.RepeatWrapping; return t; };
    const m1 = ctex('#0b5257'), m2 = ctex('#000000'); m1.repeat.set(7, 7); m2.repeat.set(4.3, 4.3); UW.maps = [m1, m2];
    const flat = (size, mat) => { const m = new T.Mesh(new T.PlaneGeometry(size, size), mat); m.rotation.x = HP; m.frustumCulled = false; g.add(m); return m; }, add = { side: T.DoubleSide, fog: false, transparent: true, blending: T.AdditiveBlending, depthWrite: false };
    UW.surf = [flat(90, new T.MeshBasicMaterial({ map: m1, side: T.DoubleSide, fog: false })), flat(90, new T.MeshBasicMaterial(Object.assign({ map: m2, opacity: .8 }, add)))];
    UW.glow = flat(18, new T.MeshBasicMaterial(Object.assign({ map: tex(128, 128, c => { const r = c.createRadialGradient(64, 64, 2, 64, 64, 64); r.addColorStop(0, 'rgba(235,255,240,1)'); r.addColorStop(.3, 'rgba(120,220,200,.5)'); r.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = r; c.fillRect(0, 0, 128, 128); }) }, add)));
    const rt = tex(64, 256, (c, w, h) => { const v = c.createLinearGradient(0, 0, 0, h); v.addColorStop(0, 'rgba(210,255,240,.55)'); v.addColorStop(1, 'rgba(210,255,240,0)'); c.fillStyle = v; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'destination-in'; const u = c.createLinearGradient(0, 0, w, 0); u.addColorStop(0, 'rgba(0,0,0,0)'); u.addColorStop(.5, 'rgba(0,0,0,1)'); u.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = u; c.fillRect(0, 0, w, h); });
    const rm = new T.MeshBasicMaterial(Object.assign({ map: rt, opacity: .5 }, add)); for (let i = 0; i < 8; i++) { const r = new T.Mesh(new T.PlaneGeometry(.9 + rnd() * 1.3, 7.5), rm); r.userData = { ox: -1.5 - rnd() * 8, oz: (rnd() - .5) * 9, ph: rnd() * 6, ry: rnd() * PI }; r.frustumCulled = false; g.add(r); UW.rays.push(r); }
    const bm = UW.bub = new T.InstancedMesh(new T.SphereGeometry(.03, 7, 5), new T.MeshBasicMaterial({ color: new T.Color(.62, .9, .88), fog: false, transparent: true, opacity: .62, depthWrite: false }), 90); bm.instanceMatrix.setUsage(T.DynamicDrawUsage); bm.frustumCulled = false; g.add(bm);
    for (let i = 0; i < 90; i++) UW.B.push({ x: 0, y: -99, z: 0, vy: 1, ph: rnd() * 6, s: 1 }); S.root.add(g); UW.grp = g; }
  function uwSet(on, x, z) { const g = UW.grp; UW.on = !!on && !!g; if (!g) return; g.visible = !!on; if (!on) return; const wy = DV.wy, k = night() ? .34 : 1; UW.t = 0;
    UW.dome.material.color.setScalar(k); UW.surf[0].material.color.setScalar(k); UW.surf[1].material.opacity = .8 * k; UW.glow.material.opacity = k; if (UW.rays[0]) UW.rays[0].material.opacity = .5 * k;
    UW.surf[0].position.set(x, wy - .03, z); UW.surf[1].position.set(x, wy - .09, z); UW.glow.position.set(x - 4.5, wy - .14, z - 1.5);
    for (const r of UW.rays) { const u = r.userData; r.position.set(x + u.ox, wy - 3.6, z + u.oz); r.rotation.set(0, u.ry, .22); }
    UW.B.forEach((b, i) => { const a = rnd() * TAU, rr = rnd() * (i < 60 ? .7 : 2.4); b.x = x + sin(a) * rr - (i < 60 ? 0 : 2); b.z = z + cos(a) * rr; b.y = wy - .15 - rnd() * (i < 60 ? 1.7 : 3); b.vy = .7 + rnd() * 1.9; b.s = .5 + rnd() * 1.8; }); }
  function uwStep(dt, cx, cy, cz) { if (!UW.on) return; UW.t += dt; const wy = DV.wy, t = UW.t; UW.dome.position.set(cx, cy, cz); UW.maps[0].offset.set(t * .035, t * .02); UW.maps[1].offset.set(-t * .05, t * .031);
    for (const r of UW.rays) r.rotation.z = .22 + sin(t * .7 + r.userData.ph) * .07;
    UW.B.forEach((b, i) => { b.y += b.vy * dt; if (b.y > wy - .06) { b.x = cx - 1 - rnd() * 3.5; b.z = cz + (rnd() - .5) * 3; b.y = cy - .8 - rnd() * 1.6; b.vy = .5 + rnd() * 1.2; b.s = .4 + rnd() * 1.1; }
      _r.position.set(b.x + sin(t * 3 + b.ph) * .05, b.y, b.z + cos(t * 2.3 + b.ph) * .05); _r.rotation.set(0, 0, 0); _r.scale.setScalar(b.s); _r.updateMatrix(); UW.bub.setMatrixAt(i, _r.matrix); }); UW.bub.instanceMatrix.needsUpdate = true; }
  function capHome(hide) { const c = DV.cap; if (!c) return; c.wp = null; c.dy = 0; c.rx = 0; c.y = DV.y; c.speed = 0; c.state = 'idle'; c.h = HP; c.x = c.home[0]; c.z = c.home[1]; c.vis = !hide; }
  /** score of an entry: tilt (rad off vertical, 0 = clean) and take-off quality (0..1) -> 1..10 in half points */
  function diveScore(th, q) { const a = min(1, abs(th) / .85); return clamp(Math.round((10 - 8.5 * Math.pow(a, .75) - (1 - clamp(q, 0, 1)) * 1.5) * 2) / 2, 1, 10); }
  function diveBuild() {
    const an = anchor('swimDive', null); if (an) { DV.x = an.x; DV.z = an.z; if (an.y !== undefined) DV.y = an.y; } DV.az = DV.z; DV.z += .52; DV.E = DV.x - .35;   /* the board takes the north half of the 2 m gap in the rail; the swimmers of js/people.js keep diving from the anchor itself */ DV.wy = GT.riverside && typeof GT.riverside.waterY === 'number' ? GT.riverside.waterY : -2;
    const ks = anchor('kiteSpot', { x: -40, z: -70 }), bx0 = GT.L && GT.L.bounds ? GT.L.bounds.x0 : -58, ex = fit(bx0 + 2.1, ks.z - 3, .5, .5, { road: true }); DV.exit = { x: ex.x, z: ex.z, h: HP }; deckWalk();   /* out of the river over the promenade rail, downstream: he surfaces with the water at his back, not on a lawn 20 m inland */
    spot('dive', '跳水大爷 · 冬泳码头跳板', DV.E + 1.1, DV.z); spot('diveExit', '水遁出水点 · 下游护栏边', DV.exit.x, DV.exit.z);
    const E = DV.E, y = DV.y, z = DV.z;
    DV.cap = actor('swim_uncle', E + 1.6, DV.az - 1.45, HP, { seed: 9, y, state: 'idle' }); DV.cap.home = [E + 1.6, DV.az - 1.45];   /* south of the board: the handstand mats of js/people.js are on the north side */
    for (let i = 0; i < 3; i++) { const jx = E + 4.4, jz = z + 2.7 + i * 1.05, j = actor('swim_uncle', jx, jz, Math.atan2(E - 2 - jx, z - jz), { seed: 2 + i * 5, y, state: 'stretch', opts: { kit: { goggles: [0x1a4a8a, 0x1a1a1c, 0x1a4a8a][i], aux: undefined } } }); /* the judges wear no swim buoy: it stuck through the score board they hold at the chest, cord and all */ j.home = [jx, jz]; j.hh = j.h; j.jd = 'idle'; j.jt = 0; DV.judges.push(j); }
    addSpot({ id: 'st:dive', x: E + .9, z, r: 2.5, label: () => (stars() > 0 ? '跟大爷跳江 · 水遁' : '上跳板 · 跳水'), enabled: () => !DV.busy && DV.cd <= 0 && onFoot() && S.free, onUse: () => diveStart() });
    if (!S.visual) return;
    const k = GT.kit(), blue = col('metal_painted_blue', 0x4f5c58, .8), galv = GT.mat('metal_galv'), alu = GT.mat('metal_rust');   /* b4: a steel plank on a pontoon, welded pipe rails gone to rust, not pool hardware (reference board 35) */
    /* the springboard: laminated plank on a roller fulcrum, anchored on the pontoon, reaching 2.3 m over the water through the gap in the rail */
    k.box(col('metal_galv', 0x6f7672, .7), 3.2, .07, .52, E - .7, y + .585, z, { bevel: .012 }); k.box(col('plastic_grey', 0x363b39, .96), 3.0, .012, .42, E - .7, y + .626, z);
    for (const sx of [E - 2.16, E - 1.98]) k.box(GT.mat('plastic_red'), .07, .014, .42, sx, y + .627, z); for (const sz of [-.2, .2]) k.box('road_paint_white', 3.0, .013, .018, E - .7, y + .6275, z + sz);
    k.cyl(galv, .07, .07, .62, E + .14, y + .48, z, { rx: HP, seg: 14 }); for (const sz of [-.33, .33]) { k.box(blue, .2, .5, .08, E + .14, y + .25, z + sz, { bevel: .015 }); k.cyl(galv, .035, .035, .1, E + .14, y + .48, z + sz, { rx: HP, seg: 8 }); }
    k.box(blue, .34, .5, .62, E + .74, y + .27, z, { bevel: .02 }); k.box(galv, .4, .03, .68, E + .74, y + .535, z, { bevel: .008 }); for (const sx of [-.12, .12]) for (const sz of [-.24, .24]) k.cyl(galv, .022, .022, .03, E + .74 + sx, y + .56, z + sz, { seg: 6 });
    for (const sz of [-.34, .34]) k.tube(alu, [[E + .95, y + .04, z + sz], [E + .95, y + .98, z + sz], [E + .6, y + 1.04, z + sz], [E + .14, y + 1.04, z + sz], [E + .04, y + .98, z + sz], [E + .04, y + .04, z + sz]], .022, { seg: 8, steps: 26, tension: .18 });
    for (let i = 0; i < 3; i++) { k.box(blue, .26, .03, .5, E + 1.79 - i * .27, y + .15 + i * .15, z, { bevel: .008 }); k.box(blue, .03, .15 + i * .15, .03, E + 1.79 - i * .27, y + (.15 + i * .15) / 2, z + .2); k.box(blue, .03, .15 + i * .15, .03, E + 1.79 - i * .27, y + (.15 + i * .15) / 2, z - .2); }
    /* judges' corner: bench, thermoses, enamel mugs, folded towels, slippers */
    const bx = E + 5.0, bz = z + 3.75; k.box('wood_plank', .42, .05, 2.5, bx, y + .44, bz, { bevel: .012 }); for (const s of [-1.05, 1.05]) for (const q of [-.15, .15]) k.cyl(galv, .018, .018, .43, bx + q, y + .215, bz + s, { seg: 6 });
    [[0xc8281e, -.9], [0x2a6b4a, -.62], [0xb9bcc2, .95]].forEach(([c, o]) => { k.cyl(col('plastic_red', c, .35, .3), .045, .05, .26, bx, y + .6, bz + o, { seg: 12 }); k.cyl('plastic_black', .034, .04, .05, bx, y + .755, bz + o, { seg: 10 }); });
    [[0xe9e6dc, -.3], [0x3f7fb5, .05], [0xe8b23a, .42]].forEach(([c, o], i) => k.box(col('fabric_dark', c, 1), .3, .06 + i * .012, .22, bx, y + .5 + i * .006, bz + o, { bevel: .02 }));
    for (const o of [-1.1, .65]) { k.cyl(col('plastic_white', 0xf1efe6, .3), .04, .034, .08, bx + .08, y + .505, bz + o, { seg: 12 }); k.cyl(col('plastic_red', 0x1f4d9a, .4), .042, .042, .012, bx + .08, y + .548, bz + o, { seg: 12 }); }
    for (let i = 0; i < 4; i++) k.box(col('plastic_grey', [0x2a6fb5, 0x2a6fb5, 0xc23a2a, 0xc23a2a][i], .8), .1, .03, .26, bx - .5 - (i >> 1) * .05, y + .016, bz - .9 + i * .14 + (i >> 1) * .5, { bevel: .012, ry: .2 - i * .11 });
    /* banner on the south rail */
    const zb = DV.az - 5.78; for (const px of [E + 1.6, E + 4.6]) { k.cyl(galv, .025, .03, 2.2, px, y + 1.1, zb, { seg: 8 }); }
    k.quad(paper(1536, 256, (g, w, h) => { g.fillStyle = '#b3201a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#f6d84a'; g.lineWidth = 8; g.strokeRect(14, 14, w - 28, h - 28); g.fillStyle = '#f6d84a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 118px ' + HEI; g.fillText('江城冬泳队 · 跳板开放', w / 2, 104, w - 80); g.font = '700 50px ' + HEI; g.fillStyle = '#fbeeb0'; g.fillText('先热身 后入水 · 水花大者请全队喝汤', w / 2, 204, w - 120); }), 3.0, .5, E + 3.1, y + 1.86, zb + .03);
    S.root.add(k.build());
    /* three foam score boards, one per judge, redrawn for every dive */
    for (let i = 0; i < 3; i++) { const c = cv(160, 208), t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; const g = new T.Group(), m = new T.MeshBasicMaterial({ map: t, side: T.DoubleSide, color: new T.Color(.92, .92, .92) });
      addMesh(g, new T.PlaneGeometry(.36, .468), m, 0, .234, .001, { cast: false }); addMesh(g, new T.BoxGeometry(.372, .48, .02), col('plastic_white', 0xe6e3d8, .95), 0, .234, -.011); g.visible = false; S.root.add(g); DV.boards.push({ g, c, t, k: 0, j: DV.judges[i] }); }   /* a slab of foam board held in both hands at the chest (pose carry_box), not a sign on a stick */
    safe(uwBuild);
  }
  function boardDraw(b, v) { const g = b.c.getContext('2d'); g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, 160, 208); g.strokeStyle = '#1d3f78'; g.lineWidth = 7; g.strokeRect(6, 6, 148, 196); g.fillStyle = v >= 8.5 ? '#c2251d' : '#1b1b1b'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 ' + (v % 1 ? 86 : 118) + 'px "DIN Alternate","Helvetica Neue",Arial,sans-serif'; g.fillText(String(v), 80, 98, 140); g.font = '700 26px ' + HEI; g.fillStyle = '#1d3f78'; g.fillText('分', 80, 176); b.t.needsUpdate = true; }
  function diveStart(force) {
    if (DV.busy || !S.inited) return false; const esc = force === 'escape' || (force !== 'score' && stars() > 0), E = DV.E;
    const d = DV.run = { esc, ph: 'walk', t: 0, q: esc ? .8 : .3, th: 0, om: 0, drift: (rnd() < .5 ? -1 : 1) * (.75 + rnd() * .8), px: E + .6, py: DV.y + .63, vx: 0, vy: 0, score: 0, m: 0, sx: P.x, sz: P.z };
    DV.busy = true; ST.dive.busy = true; ST.dive.phase = 'walk'; DV.show = null;
    if (esc) { bark('dive.pull', 0, true); const c = DV.cap; if (c) { c.wp = null; c.x = E - 1.7; c.z = DV.z; c.h = -HP; c.dy = .62; c.y = DV.y; c.rx = 0; c.vis = true; c.state = 'idle'; } }   /* the captain is already out on the board: you see him go in first */
    const ctl = S.game.ctl, tk = { heroState: 'idle', hideHero: true, look: false, blend: .3, blendOut: .25, update(dt, inp) { return diveTick(dt, inp); }, camera() { return DV.cam; }, onEnd() { diveEnd(); } };
    d.tk = ctl && ctl.takeover && S.visual ? safe(() => ctl.takeover(tk), null) : null;
    if (!d.tk) { d.manual = true; if (!S.visual) { d.th = force && typeof force === 'object' ? +force.tilt || 0 : 0; d.q = force && typeof force === 'object' ? +force.q || 0 : d.q; diveEnter(); diveEnd(); } }
    return true; }
  function diveTick(dt, inp) {
    const d = DV.run; if (!d) return true; d.t += dt; const E = DV.E, z = DV.z, eye = 1.58, C = DV.cam; inp = inp || input();
    if (d.ph === 'walk') { const wT = d.esc ? 2.1 : 1.0, u = sst(d.t, 0, wT), c = DV.cap; d.px = lerp(E + .6, d.esc ? E - .95 : E - 2.05, u); const bob = sin(d.t * 9) * .025 * (1 - u); C.pos = [d.px, DV.y + .63 + eye + bob, z + (d.esc ? .12 : 0)];
      C.look = d.esc ? [E - 3.4, DV.y + .63 + eye - .75 - sst(d.t, 1.2, 2.1) * 1.5, z] : [d.px - 4, DV.y + .63 + eye - .55 - u * .5, z]; C.fov = 62;
      if (d.esc && c) { if (d.t > .2 && !d.capGo) { d.capGo = true; c.state = 'dive'; c.drop = DV.y + .62 - DV.wy; } if (d.capGo && !d.capIn && d.t > 1.9) { d.capIn = true; c.vis = false; c.state = 'idle'; c.dy = 0; safe(() => GT.fxsmall && GT.fxsmall.splash && GT.fxsmall.splash(c.x - 2.5, DV.wy, z, .7)); smp('splash', { g: .45 }); } }
      if (d.t >= wT) { if (d.esc) diveJump(); else { d.ph = 'ready'; d.t = 0; ST.dive.phase = 'ready'; uiOn('dive', true); if (UI.el.hint) UI.el.hint.innerHTML = '<b>空格</b>踩准弹板起跳'; } } return false; }
    if (d.ph === 'ready') { d.m = .5 + .5 * sin(d.t * 4.4 - HP); uiVar('dive', '--m', d.m.toFixed(3)); const by = (d.m - .5) * .11; C.pos = [d.px, DV.y + .63 + eye + by, z]; C.look = [d.px - 4, DV.y + .63 + eye - 1.05, z]; C.fov = 62;
      const go = inp && inp.pressed && (inp.pressed('Space') || inp.pressed('KeyE')); if (go && inp.consume) { inp.consume('Space'); inp.consume('KeyE'); }
      if ((go && d.t > .25) || d.t > 7) { d.q = d.t > 7 ? .2 : 1 - clamp(abs(d.m - .77) / .5, 0, 1); diveJump(); } return false; }
    if (d.ph === 'air') { const ax = d.esc || !inp || !inp.axis ? 0 : (inp.axis().x || 0);
      d.om += (d.drift * (1 + .6 * sin(d.t * 3.1)) + ax * 5.4 - d.om * 1.3) * dt; d.th += d.om * dt; if (d.esc) d.th = d.om = 0;
      d.px += d.vx * dt; d.py += d.vy * dt; d.vy -= 9.8 * dt; const al = clamp(Math.atan2(d.vy, 2.4), -1.5, .7) + d.th * .6;
      C.pos = [d.px, d.py + .35, z + sin(d.th) * .12]; C.look = [d.px - cos(al) * 4, d.py + .35 + sin(al) * 4, z + d.th * 2.4]; C.fov = 66 + clamp(-d.vy, 0, 8) * 1.6;
      if (UI.el.ndl) UI.el.ndl.setAttribute('transform', 'rotate(' + clamp(d.th * 57.3, -88, 88).toFixed(1) + ' 100 100)');
      if (d.py <= DV.wy + .3) diveEnter(); return false; }
    if (d.ph === 'under') { const dur = d.esc ? 3.3 : 2.1, c = DV.cap, up = sst(d.t, .25, 1.15); d.py = damp(d.py, DV.wy - 1.75, 3, dt); d.px -= dt * (d.esc ? 2.2 : .55 * (1 - sst(d.t, .8, 2))); C.pos = [d.px, d.py, z + sin(d.t * 1.1) * .08]; C.fov = 60;
      C.look = d.esc ? [d.px - 3, d.py - .25 + up * .5 + sin(d.t * 2) * .12, z + .45 + sin(d.t * 1.3) * .5] : [d.px - 3, d.py - 1.3 + up * 2.7 + sin(d.t * 2) * .1, z + sin(d.t * 1.3) * .4];   /* a scored dive rolls over and looks up at the surface; the escape follows the captain's heels */
      if (d.esc && c) { c.vis = true; c.state = 'swim'; c.speed = 1; c.h = -HP; c.dy = 0; c.rx = 0; c.x = d.px - 2.3 - sst(d.t, 0, 3) * .9; c.z = z + .55 + sin(d.t * .9) * .15; c.y = d.py - .5 + sin(d.t * 1.7) * .06; }
      uwStep(dt, C.pos[0], C.pos[1], C.pos[2]);
      if (!d.faded && d.t > dur - .45) { d.faded = true; fade(1, 380); } return d.t >= dur; }
    return true; }
  function diveJump() { const d = DV.run; d.ph = 'air'; d.t = 0; d.vx = -2.4; d.vy = 4 + 1.7 * d.q; d.py = DV.y + .63 + 1.3; ST.dive.phase = 'air'; sfx('thunk'); if (UI.el.hint) UI.el.hint.innerHTML = d.esc ? '憋气' : '<b>A</b><b>D</b>把身体压直'; if (!d.esc) uiOn('dive', true); }
  function diveEnter() { const d = DV.run; d.ph = 'under'; d.t = 0; d.py = min(d.py, DV.wy - .3); ST.dive.phase = 'under'; d.score = d.esc ? 0 : diveScore(d.th, d.q); const flop = !d.esc && d.score <= 4;
    safe(() => GT.fxsmall && GT.fxsmall.splash && GT.fxsmall.splash(d.px, DV.wy, DV.z, flop ? 1.6 : d.score >= 8.5 ? .35 : .9)); if (flop || d.esc) safe(() => GT.fxsmall && GT.fxsmall.splash && GT.fxsmall.splash(d.px - .5, DV.wy, DV.z + .4, 1.2)); smp('splash', { g: flop ? 1 : .6 });
    uiOn('dive', false); uiOn('water', true); if (UI.el.water) UI.el.water.classList.toggle('flat', !UW.grp); uwSet(true, d.px, DV.z); }
  function diveEnd() {
    const d = DV.run; if (!d) return; DV.run = null; DV.busy = false; ST.dive.busy = false; ST.dive.phase = 'idle'; uiOn('dive', false); uiOn('water', false); uwSet(false); const E = DV.E;
    if (d.ph !== 'under') { DV.cd = 1; capHome(); fade(0, 200); return; }   /* interrupted before the water: nothing happens */
    if (d.esc) { capHome(true); safe(() => S.game.wanted.clear()); safe(() => S.game.teleport(DV.exit.x, DV.exit.z, DV.exit.h)); DV.cd = 45; SV.dive.esc++; ST.dive.escapes = SV.dive.esc; ST.dive.last = { escape: true };
      toast('水路匿踪', '岸上的人跟丢了'); later(1.2, () => bark('dive.kai', 0, true)); later(9, () => { const c = DV.cap; if (c) { c.x = E + 5.2; c.z = DV.az; c.vis = true; c.state = 'idle'; c.goTo([c.home], 1.1); } }); if (SV.dive.esc === 1) safe(() => S.game.ui.achievement('跟大爷走一个')); }
    else { safe(() => S.game.teleport(E + 1.75, DV.z + 3.75, HP)); DV.cd = 3;   /* he climbs out facing the three judges, 2.7 m off and side by side in his view */ SV.dive.n++; SV.dive.best = max(SV.dive.best, d.score); ST.dive.dives = SV.dive.n; ST.dive.best = SV.dive.best; ST.dive.last = { score: d.score, tilt: +d.th.toFixed(3), takeoff: +d.q.toFixed(2) };
      const good = d.score >= 8.5, flop = d.score <= 4; DV.show = { t: 0, score: d.score, good, flop }; DV.boards.forEach((b, i) => { boardDraw(b, clamp(d.score + [0, -.5, .5][(i + SV.dive.n) % 3] * (d.score >= 10 ? 0 : 1), 1, 10)); });
      if (UI.el.score) { UI.el.score.firstChild.textContent = String(d.score); UI.el.score.lastChild.textContent = good ? '压水花' : flop ? '拍水' : '入水'; UI.el.score.classList.toggle('bad', flop); uiOn('score', true); later(3.2, () => uiOn('score', false)); }
      if (good) { addFocus(1); toast('压水花 · ' + d.score + ' 分', '专注回满'); sfx('ui_ok'); later(.9, () => bark('dive.ten', 0, true)); if (d.score >= 10) safe(() => S.game.ui.achievement('水花消失术')); }
      else if (flop) { const dm = clamp(min(50, hpNow() - 6), 0, 50); if (dm > 0) safe(() => S.game.hurt(dm)); toast('拍水 · ' + d.score + ' 分', '生命 −50%'); sfx('ui_bad'); later(.9, () => bark('dive.flop', 0, true)); }
      else { toast('入水 · ' + d.score + ' 分', ''); later(.9, () => bark('dive.mid', 0, true)); } }
    save(); later(.3, () => fade(0, 650)); later(.45, wet); }
  function diveStep(dt) {
    DV.cd = max(0, DV.cd - dt); if (!DV.walk) { DV.walkT -= dt; if (DV.walkT <= 0) { DV.walkT = 2; deckWalk(); } } const near = distP(DV.E + 2, DV.z) < 80; if (DV.run && DV.run.manual && S.visual) { if (diveTick(dt, input())) diveEnd(); }
    for (const a of DV.judges.concat(DV.cap ? [DV.cap] : [])) actorStep(a, dt); if (!near) return;
    const E = DV.E, z = DV.z, c = DV.cap;
    if (c && !DV.busy && c.vis && !c.wp) { const d = distP(c.x, c.z); if (d < 7 && onFoot()) { c.face(P.x, P.z, dt); c.state = 'idle'; if (d < 6 && S.free && S.t > DV.greetT) { DV.greetT = S.t + 28; bark('dive.greet', 20); } } else { c.h += angDiff(c.h, HP) * min(1, dt * 2); c.state = ((S.t / 9) | 0) % 2 ? 'stretch' : 'idle'; } }
    /* the judges take turns off the board */
    DV.loopT -= dt; if (DV.loopT <= 0 && !DV.busy && !DV.show) { DV.loopT = 34 + rnd() * 20; const j = DV.judges[DV.turn++ % DV.judges.length]; if (j && j.jd === 'idle') { j.jd = 'go'; j.goTo([[E + 1.3, z], [E - 1.9, z]], 1.15, () => { j.jd = 'aim'; j.jt = 1.1; j.h = -HP; if (distP(j.x, j.z) < 26) bark('dive.show', 30); }); } }
    for (const j of DV.judges) { if (j.jd === 'go') j.dy = .62 * sst(E + 1.95 - j.x, 0, .95); else if (j.jd === 'aim') { j.dy = .62; j.state = 'idle'; j.jt -= dt; if (j.jt <= 0) { j.jd = 'air'; j.jt = 0; } }
      else if (j.jd === 'air') { j.jt += dt; j.state = 'dive'; j.drop = DV.y + .62 - DV.wy; if (j.jt >= 1.72) { safe(() => GT.fxsmall && GT.fxsmall.splash && GT.fxsmall.splash(j.x - 2.5, DV.wy, z, .5)); if (distP(j.x, z) < 30) smp('splash', { g: .35 }); j.jd = 'gone'; j.jt = 5.5; j.vis = false; j.dy = 0; j.state = 'idle'; } }
      else if (j.jd === 'gone') { j.jt -= dt; if (j.jt <= 0) { j.x = E + 5.3; j.z = DV.az; j.vis = true; j.jd = 'back'; j.goTo([j.home], 1.1, () => { j.jd = 'idle'; j.h = j.hh; }); } }
      else if (j.jd === 'idle' && !DV.show) { j.state = 'stretch'; j.h += angDiff(j.h, j.hh) * min(1, dt * 3); if (onFoot() && distP(j.x, j.z) < .7) { j.face(P.x, P.z, 1); bark('dive.bump', 8); } } }
    if (DV.show) { const s = DV.show; s.t += dt; const k = sst(s.t, .45, .85) * (1 - sst(s.t, 4.3, 4.7)), after = s.t > 4.7;   /* boards up in their hands for four seconds, then the verdict in their bodies */
      for (const b of DV.boards) { const j = b.j, on = j.vis && j.jd === 'idle'; b.g.visible = k > .01 && on; if (!on) continue; j.face(P.x, P.z, dt); j.state = after ? (s.good ? 'cheer' : s.flop ? 'shrug' : 'applaud') : 'carry_box';
        if (b.g.visible) { const by = .74 + .28 * k + (s.good ? abs(sin(s.t * 7)) * .03 * k : 0); b.g.position.set(j.x + sin(j.h) * .31, DV.y + j.dy + by, j.z + cos(j.h) * .31); b.g.rotation.set(-.1, j.h, 0, 'YXZ'); b.g.scale.setScalar(.55 + .45 * k); } }
      if (s.t > 6.4) { DV.show = null; for (const b of DV.boards) b.g.visible = false; } }
  }

  /* ================================================================== 2. 广场舞方阵 */
  const DC = { cx: -34, cz: 30, h: -HP, gy: .17, on: false, k: 0, body: null, aL: null, aR: null, I: [], spk: { x: -42.6, z: 34.2, h: HP, grp: null, down: false, fall: 0, upT: 0, led: null, cone: [] }, rage: 0, mad: false, join: null, blockT: 0, hitT: 0, wave: 0, leadT: 0, beat: 0 };
  const inRect = (x, z, m) => x > DC.cx - 7.4 - m && x < DC.cx + 9.6 + m && z > DC.cz - 10.8 - m && z < DC.cz + 10.8 + m;
  function auntieGeo() {
    /* a person, not a mannequin: wide-leg dance trousers and soft shoes, a silk tunic with a waist, a flared hem, gold piping and knot buttons, a face (eyes with whites, brows, nose, lips, rouge,
       ears with gold studs) under a fresh perm, three-quarter sleeves with a gold cuff and a ribbed fan. Still one merged vertex-coloured body + one arm geometry: 3 draw calls for the whole formation. */
    const red = 0xc22a26, dark = 0x17181b, skin = 0xd9a985, skin2 = 0xc8946f, hair = 0x241815, hair2 = 0x3b2620, gold = 0xf2c84a, white = 0xeceae2, b = [], V2 = a => a.map(p => new T.Vector2(p[0], p[1]));
    for (const sx of [-.095, .095]) { b.push(part(new T.CylinderGeometry(.096, .082, .42, 10), dark, sx, .66, 0)); b.push(part(new T.CylinderGeometry(.082, .1, .42, 10), dark, sx, .25, 0)); b.push(part(new T.SphereGeometry(.07, 8, 5), white, sx, .04, .055, 0, 0, 0, [.82, .56, 1.75])); b.push(part(new T.BoxGeometry(.1, .016, .23), 0x8a857a, sx, .008, .05)); }
    b.push(part(new T.SphereGeometry(.2, 10, 6), dark, 0, .86, 0, 0, 0, 0, [1.02, .6, .82]));
    b.push(part(new T.LatheGeometry(V2([[.228, .71], [.214, .78], [.196, .9], [.182, 1.0], [.176, 1.08], [.198, 1.19], [.206, 1.29], [.186, 1.37], [.118, 1.425], [.064, 1.452]]), 14), red, 0, 0, 0, 0, 0, 0, [1, 1, .8]));
    b.push(part(new T.TorusGeometry(.226, .011, 5, 16), gold, 0, .715, 0, HP, 0, 0, [1, .8, 1])); b.push(part(new T.TorusGeometry(.066, .014, 5, 12), gold, 0, 1.448, 0, HP)); b.push(part(new T.BoxGeometry(.024, .52, .012), gold, 0, 1.12, .166));
    for (let i = 0; i < 4; i++) b.push(part(new T.SphereGeometry(.017, 5, 4), gold, 0, 1.33 - i * .115, .176));
    b.push(part(new T.CylinderGeometry(.05, .058, .1, 10), skin, 0, 1.495, 0)); b.push(part(new T.SphereGeometry(.105, 14, 10), skin, 0, 1.615, .004, 0, 0, 0, [.98, 1.14, 1.04]));
    for (const sx of [-.037, .037]) { b.push(part(new T.SphereGeometry(.019, 7, 5), 0xf4f0e8, sx, 1.632, .1, 0, 0, 0, [1.25, .78, .5])); b.push(part(new T.SphereGeometry(.0115, 6, 4), 0x1a120e, sx * .97, 1.631, .1065, 0, 0, 0, [1, 1, .5])); b.push(part(new T.BoxGeometry(.04, .008, .008), hair, sx, 1.661, .099, 0, 0, sx > 0 ? -.16 : .16)); b.push(part(new T.SphereGeometry(.026, 6, 4), 0xe28f7c, sx * 1.55, 1.588, .086, 0, 0, 0, [1, .7, .35])); }
    b.push(part(new T.SphereGeometry(.016, 6, 4), skin2, 0, 1.6, .108, 0, 0, 0, [.9, 1.2, 1])); b.push(part(new T.SphereGeometry(.02, 7, 4), 0xb5322e, 0, 1.561, .098, 0, 0, 0, [1.3, .42, .45]));
    for (const sx of [-.103, .103]) { b.push(part(new T.SphereGeometry(.024, 6, 4), skin2, sx, 1.615, -.004, 0, 0, 0, [.5, 1.1, .8])); b.push(part(new T.SphereGeometry(.012, 5, 3), gold, sx * 1.02, 1.582, -.002)); }
    b.push(part(new T.SphereGeometry(.118, 12, 7, 0, TAU, 0, PI * .54), hair, 0, 1.632, -.014, -.12)); b.push(part(new T.SphereGeometry(.112, 10, 7), hair, 0, 1.612, -.04, 0, 0, 0, [1.03, 1.08, .9]));
    for (let i = 0; i < 13; i++) { const a = -1.75 + i * (3.5 / 12); b.push(part(new T.SphereGeometry(.036 + (i % 3) * .004, 6, 4), i % 2 ? hair2 : hair, sin(a) * .104, 1.676 + cos(a * .9) * .03, cos(a) * .07 - .012)); }
    for (let i = 0; i < 9; i++) { const a = i * 2.4, r = .03 + (i % 3) * .028; b.push(part(new T.SphereGeometry(.04, 6, 4), i % 2 ? hair : hair2, sin(a) * r, 1.728 - r * .35, cos(a) * r - .03)); }
    for (let i = 0; i < 6; i++) { const a = PI - .9 + i * .36; b.push(part(new T.SphereGeometry(.038, 6, 4), i % 2 ? hair2 : hair, sin(a) * .1, 1.6 - (i % 2) * .03, cos(a) * .1 - .03)); }
    /* the arm: not a tube with a paddle. A three-quarter sleeve that flares into a bell cuff with gold piping, an elbow that is already a little bent (the forearm comes forward .46 rad), a wrist, a hand
       closed round the fan's rivet with a thumb over it, and a real folding fan: twelve pleats with depth (edge-on it is a zig-zag a finger thick, not a sliver), bamboo sticks under the paper, a gold
       band along the leaf's edge, two guard sticks and a tassel. Forearm frame: origin at the elbow, -y along the forearm; FA() places a part in it. */
    const TH = .46, EY = -.275, cT = cos(TH), sT = sin(TH), FA = (g, hex, x, d, zl, rx2, rz2, sc) => part(g, hex, x, EY - d * cT + zl * sT, d * sT + zl * cT, -TH + (rx2 || 0), 0, rz2 || 0, sc), bamboo = 0x9a6a34;
    const fanBand = (r0, r1, a0, a1, N, z0, z1) => { const P_ = [], za = r => z0 + (z1 - z0) * (r - .045) / .235, pt = (r, i) => { const a = a0 + (a1 - a0) * i / N; return [sin(a) * r, -cos(a) * r, (i % 2 ? 1 : -1) * za(r)]; };
      for (let i = 0; i < N; i++) { const A = pt(r0, i), B = pt(r1, i), C_ = pt(r1, i + 1), D = pt(r0, i + 1); P_.push(...A, ...B, ...C_, ...A, ...C_, ...D); } const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(P_), 3)); g.computeVertexNormals(); return g; };
    const arm = [part(new T.SphereGeometry(.066, 10, 6), red, 0, -.004, 0, 0, 0, 0, [1.04, .92, 1.04]), part(new T.CylinderGeometry(.061, .052, .27, 10), red, 0, -.138, 0), part(new T.SphereGeometry(.052, 8, 6), red, 0, EY, .004),
      FA(new T.CylinderGeometry(.05, .074, .13, 12), red, 0, .075, 0), FA(new T.TorusGeometry(.073, .008, 5, 14), gold, 0, .14, 0, HP), FA(new T.TorusGeometry(.064, .004, 4, 14), gold, 0, .112, 0, HP),
      FA(new T.CylinderGeometry(.036, .028, .15, 8), skin, 0, .185, 0), FA(new T.TorusGeometry(.029, .006, 4, 10), 0x4f9a6a, 0, .245, 0, HP), FA(new T.SphereGeometry(.036, 8, 6), skin, 0, .292, .002, 0, 0, 0, [.92, 1.22, .62]),
      FA(new T.BoxGeometry(.062, .05, .03), skin, 0, .327, .014, .5), FA(new T.SphereGeometry(.016, 6, 4), skin, .034, .3, .02, 0, 0, 0, [.9, 1.7, .9]), FA(new T.SphereGeometry(.011, 6, 4), gold, 0, .322, .024)];
    { const FY = .322, A0 = -1.42, A1 = 1.42, N = 12, place = g => at(g, 0, EY - FY * cT + .008 * sT, FY * sT + .008 * cT, -TH, 0, 0);
      arm.push(place(cgeo(fanBand(.045, .125, A0, A1, N, .002, .012), bamboo)), place(cgeo(fanBand(.125, .262, A0, A1, N, .002, .012), 0xd8281e)), place(cgeo(fanBand(.262, .284, A0, A1, N, .002, .012), gold)), place(cgeo(fanBand(.19, .199, A0, A1, N, .0025, .0125), 0xf0b93c)));
      for (const sd of [-1, 1]) { const a = sd * 1.42; arm.push(place(at(cgeo(new T.BoxGeometry(.016, .29, .012), bamboo), sin(a) * .145, -cos(a) * .145, sd * .004, 0, 0, a))); }
      for (let i = 1; i < N; i += 2) { const a = A0 + (A1 - A0) * i / N; arm.push(place(at(cgeo(new T.BoxGeometry(.006, .09, .004), 0x6e4a22), sin(a) * .085, -cos(a) * .085, .006, 0, 0, a))); }
      arm.push(FA(new T.CylinderGeometry(.003, .003, .07, 4), 0xc81e1e, .012, .35, .03, .5), FA(new T.SphereGeometry(.011, 6, 4), gold, .012, .385, .048), FA(new T.CylinderGeometry(.012, .004, .075, 6), 0xc81e1e, .012, .425, .066, .5)); }
    return { body: mergeC(b), arm: mergeC(arm) }; }
  function danceBuild() {
    const c = anchor('danceCentre', null); if (c) { DC.cx = c.x; DC.cz = c.z; if (c.h !== undefined) DC.h = c.h; } DC.gy = gY(DC.cx, DC.cz, 1) + .02;
    const fwd = [sin(DC.h), cos(DC.h)], lft = [cos(DC.h), -sin(DC.h)], rows = [];   /* fwd = toward the leader; rows are counted back from her */
    for (const b of [-3, 0, 3, 6, 8.4]) for (const s of [-7.7, -5.5, 5.5, 7.7]) rows.push([b, s]); for (const b of [6, 8.4]) for (const s of [-3.3, -1.1, 1.1, 3.3]) rows.push([b, s]); for (const b of [0, 3, 6]) for (const s of [-9.9, 9.9]) rows.push([b, s]); for (const s of [-7.7, -5.5, 5.5, 7.7]) rows.push([-5.6, s]);
    const seen = {}; for (const r of rows) { const key = r[0].toFixed(1) + ',' + r[1].toFixed(1); if (seen[key]) continue; seen[key] = 1; const x = DC.cx - fwd[0] * r[0] + lft[0] * r[1], z = DC.cz - fwd[1] * r[0] + lft[1] * r[1], i = DC.I.length; if (blocked(x - .25, z - .25, x + .25, z + .25, DC.gy)) continue;
      DC.I.push({ hx: x, hz: z, x, z, h: DC.h, mode: 0, late: i % 11 === 7 ? .5 : (rnd() - .5) * .07, amp: .8 + rnd() * .45, sc: .93 + rnd() * .1, wd: .96 + rnd() * .16, show: 0, tx: x, tz: z, ord: rnd(), i }); }
    ST.dance.count = DC.I.length; spot('dance', '广场舞方阵 · 江滩广场 (19:00–21:30)', DC.cx, DC.cz);
    const sp = fit(DC.cx + fwd[0] * 8.6 + lft[0] * 4.2, DC.cz + fwd[1] * 8.6 + lft[1] * 4.2, .45, .45); DC.spk.x = sp.x; DC.spk.z = sp.z; DC.spk.h = DC.h + PI; spot('speaker', '拉杆音箱 · 可踢 (Z)', sp.x, sp.z);
    if (S.visual) {
      const G_ = DC.geo = auntieGeo(), n = DC.I.length, mb = new T.MeshStandardMaterial({ vertexColors: true, roughness: .64, metalness: 0 }), ma = new T.MeshStandardMaterial({ vertexColors: true, roughness: .72, metalness: 0, side: T.DoubleSide });
      const mk = (g, m) => { const im = new T.InstancedMesh(g, m, n); im.instanceMatrix.setUsage(T.DynamicDrawUsage); im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.visible = false; im.name = 'street_dance'; S.root.add(im); return im; };
      DC.body = mk(G_.body, mb); DC.aL = mk(G_.arm, ma); DC.aR = mk(G_.arm, ma); DC.aL.castShadow = DC.aR.castShadow = false;   /* the bodies throw the shadows; a fan's is not worth a second pass over 76 arms */
      /* 「震江 K-9000」: the trolley speaker that owns the square */
      const g = DC.spk.grp = new T.Group(), k = GT.kit(), blk = GT.mat('plastic_black'), dk = GT.mat('metal_dark'), chrome = GT.mat('chrome');
      k.box(blk, .64, 1.06, .5, 0, .64, 0, { bevel: .045 }); k.box(dk, .56, .96, .02, 0, .64, .252, { bevel: .01 });
      for (const y of [.42, .88]) { k.cyl(dk, .215, .215, .03, 0, y, .262, { rx: HP, seg: 24 }); k.cyl('rubber', .17, .07, .06, 0, y, .262, { rx: HP, seg: 22 }); k.sphere(blk, .062, 0, y, .252, { seg: 12, seg2: 8, s: [1, 1, .5] }); }
      k.box(dk, .3, .07, .03, 0, 1.105, .25, { bevel: .01 }); k.box(dk, .52, .03, .34, 0, 1.185, -.02, { bevel: .008 }); k.box('emissive_screen', .16, .005, .07, -.12, 1.202, 0);
      for (let i = 0; i < 5; i++) k.cyl('aluminium_brushed', .017, .019, .026, .02 + i * .052, 1.212, .03, { seg: 10 }); k.box('light_red', .014, .008, .014, .2, 1.204, -.1);
      for (const sx of [-.2, .2]) { k.tube(chrome, [[sx, 1.1, -.2], [sx, 1.62, -.22], [sx * .9, 1.76, -.22]], .014, { seg: 6, steps: 8 }); k.cyl('rubber', .085, .085, .06, sx * 1.5, .085, -.2, { rz: HP, seg: 14 }); k.box(blk, .07, .1, .07, sx, .05, .16, { bevel: .015 }); }
      k.cyl('rubber', .02, .02, .3, 0, 1.76, -.22, { rz: HP, seg: 8 }); k.cyl(blk, .02, .024, .17, .12, 1.3, -.02, { seg: 8, rz: .25 }); k.sphere('metal_galv', .03, .1, 1.39, -.02, { seg: 8, seg2: 6 });
      k.tube('rubber', [[.13, 1.21, -.02], [.24, 1.3, .02], [.3, 1.0, -.16], [.26, .8, -.26]], .006, { seg: 5 });
      k.quad(paper(512, 256, (cg, w, h) => { cg.fillStyle = '#101216'; cg.fillRect(0, 0, w, h); cg.fillStyle = '#ffb53a'; cg.textAlign = 'center'; cg.textBaseline = 'middle'; cg.font = 'italic 900 104px ' + HEI; cg.fillText('震江 K-9000', w / 2, 96, w - 30); cg.fillStyle = '#e9e6dc'; cg.font = '700 44px ' + HEI; cg.fillText('广场专用 · 双十五寸 · 3000W', w / 2, 196, w - 40); }), .5, .25, .322, .7, 0, { ry: HP });
      g.add(k.build()); DC.spk.led = glowMat(1, .3, .1); for (const y of [.42, .88]) { addMesh(g, new T.TorusGeometry(.226, .011, 6, 30), DC.spk.led, 0, y, .268, { cast: false }); }
      g.position.set(sp.x, gY(sp.x, sp.z, 1), sp.z); g.rotation.order = 'YXZ'; g.rotation.y = DC.spk.h; S.root.add(g);
    }
    GT.world.addBox(sp.x - .34, sp.z - .34, sp.x + .34, sp.z + .34, 1.25, 'street:speaker');
    DC.joinSpot = addSpot({ id: 'st:join', x: DC.cx, z: DC.cz, r: 2, label: () => (stars() > 0 ? '混进方阵 · 跟跳' : '跟着跳一段'), enabled: () => DC.on && !DC.mad && !DC.join && onFoot() && inRect(P.x, P.z, -.4), onUse: () => danceJoin() });
    addSpot({ id: 'st:spk', x: sp.x, z: sp.z, r: 1.8, key: 'KeyZ', label: '踢翻音箱', enabled: () => DC.on && !DC.spk.down && onFoot() && S.free, onUse: () => danceKick() });
  }
  const segDist = (ox, oz, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az, t = clamp(((ox - ax) * vx + (oz - az) * vz) / (vx * vx + vz * vz || 1), 0, 1); return hyp(ox - ax - vx * t, oz - az - vz * t); };
  function danceJoin() { if (DC.join || !DC.on || DC.mad) return false; const j = DC.join = { t: 0, s0: stars(), rew: false, copB: false, tk: null }; S.hid = { was: !!P.inside }; ST.dance.joined = true; SV.dance.joins++; ST.dance.joins = SV.dance.joins; save();
    bark('dance.join', 0, true); later(2.6, () => { if (DC.join) bark('dance.kai', 0, true); });
    /* in first person the nearest dancer's perm filled the screen: the dance is watched from outside (V is back to first person the moment you leave), and 阿凯 slides into a slot with elbow room */
    const ctl = S.game.ctl, others = DC.I.map(q => [q.x, q.z]).concat(safe(() => { const pp_ = S.game.people; return pp_ && pp_.dance && pp_.dance.dancers ? pp_.dance.dancers.map(n => [n.x, n.z]) : []; }, []) || []), room = (x, z) => { let m = 9; for (const o of others) m = min(m, hyp(o[0] - x, o[1] - z)); return m; };
    let best = [P.x, P.z], br = room(P.x, P.z); for (let r = .7; r <= 3.1 && br < 1.4; r += .6) /* 1.4 m to the nearest dancer: at 1.05 m his swinging arm crossed the neighbour's */ for (let a = 0; a < 12; a++) { const x = P.x + sin(a * PI / 6) * r, z = P.z + cos(a * PI / 6) * r, m = inRect(x, z, -.6) ? room(x, z) : 0; if (m > br) { br = m; best = [x, z]; } } j.to = best;
    /* the lens goes round to the side with the clearest line to him (a dancer and her fan used to stand in it and cover his lower half); whoever of the js/people.js dancers still stands in that line steps out for the song */
    if (S.visual && ctl && ctl.camera && isFinite(ctl.camera.yaw)) { let by = ctl.camera.yaw, bs = -9; for (let i = 0; i < 12; i++) { const yw = DC.h + i * PI / 6, cx = best[0] - sin(yw) * 3.6, cz = best[1] - cos(yw) * 3.6; let c = 9; for (const o of others) if (hyp(o[0] - best[0], o[1] - best[1]) > .25) c = min(c, segDist(o[0], o[1], best[0], best[1], cx, cz)); const sc = min(c, 1.5) - .1 * abs(angDiff(yw, DC.h)); if (sc > bs) { bs = sc; by = yw; } }
      ctl.camera.yaw = by; j.yaw = by; const pop = S.game.people, dn = pop && pop.dance, cx = best[0] - sin(by) * 3.6, cz = best[1] - cos(by) * 3.6; j.off = []; if (dn && dn.dancers && pop.setEnabled) for (const n of dn.dancers) if (n !== dn.leader && segDist(n.x, n.z, best[0], best[1], cx, cz) < 1.05) { safe(() => pop.setEnabled(n, false)); j.off.push(n); } }
    if (S.visual && ctl && ctl.setView && ctl.view === 'fp') { j.fp = true; safe(() => ctl.setView('tp')); }
    const tk = { heroState: 'dance', look: true, update(dt, inp) { return danceJoinTick(dt, inp); }, onEnd() { if (DC.join) DC.join.ended = true; danceLeave(); } };
    j.tk = ctl && ctl.takeover && S.visual ? safe(() => ctl.takeover(tk), null) : null; if (!j.tk) j.manual = true; return true; }
  function danceJoinTick(dt, inp) { const j = DC.join; if (!j) return true; j.t += dt; P.inside = true; const W = safe(() => S.game.wanted.state, null), c = S.game.ctl;
    if (c && c.pos && j.to && j.t < 1.6) { c.pos.x = damp(c.pos.x, j.to[0], 5, dt); c.pos.z = damp(c.pos.z, j.to[1], 5, dt); c.h += angDiff(c.h, DC.h) * min(1, dt * 5); }
    if (W && W.stars > 0) { W.stars = max(0, W.stars - dt * .34); if (W.hot && !j.copB && j.t > 2.4) { j.copB = true; bark('dance.cop', 0, true); } if (W.stars <= 0) { safe(() => S.game.wanted.clear()); toast('通缉消除', '混在跳舞的人群里，没被认出来'); sfx('ui_ok'); } }
    else if (j.s0 <= 0 && j.t > 8 && !j.rew) { j.rew = true; addFocus(.5); toast('跟跳一段', '专注 +50%'); sfx('ui_ok'); }
    const ax = inp && inp.axis ? inp.axis() : null, out = j.t > 1.2 && ((ax && abs(ax.x) + abs(ax.y) > .3) || (inp && inp.pressed && inp.pressed('KeyE')));
    return !!(out || !DC.on || DC.mad || j.stop); }
  function danceLeave() { const j = DC.join; if (!j) return false; DC.join = null; ST.dance.joined = false; if (S.hid) { P.inside = S.hid.was; S.hid = null; } if (j.tk && j.tk.end && !j.ended) { j.ended = true; safe(() => j.tk.end()); } if (j.off && j.off.length) { const pop = S.game.people; for (const n of j.off) safe(() => pop.setEnabled(n, true)); j.off = null; } if (j.fp) safe(() => S.game.ctl && S.game.ctl.setView && S.game.ctl.setView('fp')); return true; }
  function danceKick() { const k = DC.spk; if (k.down || !DC.on) return false; k.down = true; k.upT = 0; DC.mask = 0; if (S.G) S.G.sirenMask = 0; /* the speaker is dead: its siren mask goes with it at once (the fading mask met the new star and announced 「音箱盖过了警笛」 over a speaker lying on its side) */ DC.mad = true; DC.rage = 13; ST.dance.speakerDown = true; SV.dance.kicks++; ST.dance.kicks = SV.dance.kicks; save(); sfx('thunk'); sfx('crash', { v: .25 });
    safe(() => GT.fxsmall && GT.fxsmall.sparks && GT.fxsmall.sparks(k.x, .6, k.z, 10, 0, 0)); { const Wl = GT.wallet, Ec = GT.economy, eco = !!(Ec && Ec.pools && Ec.payCash && Ec.live && Ec.live()), have = eco ? max(0, Math.floor(Ec.pools().cash)) : Wl && isFinite(Wl.cash) ? max(0, Math.floor(Wl.cash)) : 0, pay = min(200, have), ok = pay > 0 && (eco ? Ec.payCash(pay) !== false : Wl.spend ? Wl.spend(pay) !== false : false), got = ok ? pay : 0;   /* 芳姐 takes notes out of his pocket: 随身现金 (js/economy.js pools().cash), not the phone balance (play report b3-world2-r2 issue 5) */ ST.dance.fine = got;   /* the $200 is taken there and then (it used to be announced and never charged); what he cannot pay goes on the ticket */
      safe(() => S.game.wanted.add({ stars: .3, fine: 200 - got, label: '损坏广场音箱' })); if (got) sfx('cash'); /* one $200 in all: what is taken on the spot comes off the fine on the ticket. The second toast used to repeat the amount and read as a second charge */ later(1.0, () => toast(got >= 200 ? '赔音箱' : got > 0 ? '赔音箱 · 钱不够' : '兜里没钱赔', got >= 200 ? '−$200 · 芳姐当场从你兜里收的 · 罚单上不再算钱' : got > 0 ? '当场收走 $' + got + ' · 罚单上只剩那 $' + (200 - got) : '芳姐翻了你的兜 · 就是罚单上那一笔，不另收')); } convo('dance.kick', 1.7);
    const near = DC.I.slice().sort((a, b) => hyp(a.x - P.x, a.z - P.z) - hyp(b.x - P.x, b.z - P.z)).slice(0, 8); near.forEach((q, i) => { q.mode = 2; q.ci = i; }); later(3.2, () => { if (DC.rage > 0) toast('扇子阵围上来了', '跑出广场她们就不追了 · 有人报了警察'); }); if (SV.dance.kicks === 1) safe(() => S.game.ui.achievement('捅了扇子窝')); if (DC.join) DC.join.stop = true; return true; }
  const _r = new T.Object3D(), _a = new T.Object3D(), _m = new T.Matrix4(); _r.rotation.order = 'YXZ';
  function danceStep(dt) {
    const hr = hours(), want = hr >= 19 && hr < 21.5, d = distP(DC.cx, DC.cz); DC.on = want; DC.k = approach(DC.k, want ? 1 : 0, dt / 1.6); ST.dance.active = want;
    if (S.hid && !DC.join) { P.inside = S.hid.was; S.hid = null; }
    if (want && d < 60 && S.frame % 90 === 0) safe(() => { const pp_ = S.game.people, dn = pp_ && pp_.dance; if (!dn || !dn.dancers) return; const ld = dn.leader; for (const n of dn.dancers) if (!n.label) n.label = n === ld ? '领舞芳姐' : '广场舞大妈'; }); if (want && DC.joinSpot && d < 16) { DC.joinSpot.x = P.x; DC.joinSpot.z = P.z; }   /* a zone, not a point: the prompt rides with the player so facing never hides it */
    if (DC.join && DC.join.manual) { if (danceJoinTick(dt, input())) danceLeave(); } else if (DC.join && (!want || DC.mad)) DC.join.stop = true;
    const vis = DC.k > .001 && d < 135; if (DC.body && DC.body.visible !== vis) { DC.body.visible = DC.aL.visible = DC.aR.visible = vis; if (DC.extra) for (const m of DC.extra) m.visible = vis; }
    const pop = safe(() => S.game.people, null), dn = pop && pop.dance, bpm = (dn && dn.bpm) || (GT.people && GT.people.bpm) || 118, beat = DC.beat = ((dn && typeof dn.clock === 'number' ? dn.clock : S.t) * bpm / 60);
    const k = DC.spk; if (k.down) { k.fall = min(1, k.fall + dt * 3.2); if (!DC.rage) { k.upT += dt; if (k.upT > 7) { k.down = false; DC.mad = false; ST.dance.speakerDown = false; bark('dance.calm', 0); } } } else k.fall = max(0, k.fall - dt * 1.6);
    if (k.grp && d < 90) { k.grp.rotation.x = -k.fall * 1.48; k.grp.position.y = gY(k.x, k.z, 1) + k.fall * .22; const pu = want && !k.down ? Math.pow(1 - (beat % 1), 3) : 0; k.led.color.setRGB(.25 + 5 * pu, .08 + 1.3 * pu, .04 + .3 * pu); const s = 1 + pu * .012; k.grp.scale.set(s, 1, s); }
    /* the sound pressure you can see: rings on the screen when you stand in front of the speaker */
    const w = want && !k.down ? sst(distP(k.x, k.z), 15, 4) : 0; if (abs(w - DC.wave) > .004 || w > 0) { DC.wave = w; uiVar('wave', '--a', w.toFixed(3)); uiVar('wave', '--b', Math.pow(1 - (beat % 1), 2).toFixed(3)); }
    /* …and that you can not hear through: within about 25 m of the standing speaker the sirens are drowned (js/cngame.js multiplies its siren level by 1 − G.sirenMask) */
    { const mk = want && !k.down ? sst(distP(k.x, k.z), 30, 9) * .94 : 0; DC.mask = approach(DC.mask || 0, mk, dt * 1.4); if (S.G) S.G.sirenMask = DC.mask; ST.dance.mask = +DC.mask.toFixed(2); if (DC.mask > .55 && stars() > 0 && !DC.maskTold && !k.down && !DC.mad) { DC.maskTold = true; toast('音箱盖过了警笛', '在广场上，巡逻车更难找到你'); } else if (DC.mask < .1) DC.maskTold = false; }
    if (!want && !DC.k) { if (DC.rage) danceCalm(); return; }
    if (want && d < 28 && S.t > DC.leadT && !DC.mad && Math.floor(beat / 8) % 4 === 0 && beat % 8 < .5) { DC.leadT = S.t + 42; bark('dance.lead', 30); }
    /* vehicles do not get through: held to a crawl, the nearest five come over and bang on it */
    const veh = (P.mode === 'two' || P.mode === 'car') && P.ent;
    if (want && veh && inRect(P.x, P.z, .4)) { const e = P.ent, hx = sin(e.h || 0), hz = cos(e.h || 0), inward = (DC.cx + 1.1 - P.x) * hx + (DC.cz - P.z) * hz, goingIn = (e.v || 0) * inward > 0, deep = inRect(P.x, P.z, -.9), kk = Math.exp(-(goingIn ? (deep ? 18 : 9) : 1.5) * dt);
      /* 群体刚体: nothing on wheels gets through. Driving in, the vehicle is stopped dead within a metre of the edge and held there (it sinks into the crowd, nobody is hurt); only backing out the way it came moves it, at a walk */
      if (goingIn || abs(e.v) > 2.4) { e.v *= kk; if (e.c) { e.c.vx *= kk; e.c.vy *= kk; e.c.r *= kk; } if (deep && goingIn && abs(e.v) < .8) { e.v = 0; if (e.c) { e.c.vx = 0; e.c.vy = 0; e.c.r = 0; } } }
      DC.ringR = P.mode === 'car' ? max(2.5, ((e.dims && e.dims.L) || 4.4) * .5 + .55) : 1.75; DC.knockT = (DC.knockT || 0) - dt; if (DC.knockT <= 0 && DC.blockT > .9) { DC.knockT = .4 + rnd() * .55; smp('hit_metal', { g: .3 + rnd() * .15, rate: 1.25 + rnd() * .4 }); }   /* palms and fan handles on the bodywork */
      if (DC.blockT <= 0) { toast('陷进扇子阵了', P.mode === 'car' ? '大妈们围着拍车窗 · 倒车退出去，或者 F 下车' : '大妈们围上来了 · 往回退，或者 F 下车'); sfx('thunk');
        ST.dance.blocked++; const near = DC.I.slice().sort((a, b) => hyp(a.x - P.x, a.z - P.z) - hyp(b.x - P.x, b.z - P.z)).slice(0, 6); near.forEach((q, i) => { if (q.mode === 0 || q.mode === 3) { q.mode = 1; q.ring = i; } }); }
      DC.blockT += dt; bark('dance.block', 3.4); }
    else if (DC.blockT > 0) { DC.blockT = 0; for (const q of DC.I) if (q.mode === 1) q.mode = 3; }
    if (DC.rage > 0) { DC.rage -= dt; ST.dance.rage = +max(0, DC.rage).toFixed(1); DC.hitT -= dt; if (DC.rage <= 0 || d > 38 || !onFoot()) danceCalm(); }
    /* movers */
    for (const q of DC.I) { if (q.mode === 0) continue; let tx = q.hx, tz = q.hz, sp = 1.9;
      if (q.mode === 1) { const a = q.ring * TAU / 6 + .4, rr = DC.ringR || 1.75; tx = P.x + sin(a) * rr; tz = P.z + cos(a) * rr; sp = 2.6; } else if (q.mode === 2) { const a = (q.ci || 0) * TAU / 8 + S.t * .3; tx = P.x + sin(a) * 1.45; tz = P.z + cos(a) * 1.45; sp = 4.1; }   /* a ring at fan's length, slowly turning: nobody walks into the lens, and a sprint (6.3 m/s) breaks out */
      const dx = tx - q.x, dz = tz - q.z, dd = hyp(dx, dz), st = sp * dt; if (dd > st) { q.x += dx / dd * st; q.z += dz / dd * st; q.h += angDiff(q.h, Math.atan2(dx, dz)) * min(1, dt * 9); } else { q.x = tx; q.z = tz; if (q.mode === 3) { q.mode = 0; q.h = DC.h; } }
      if (q.mode === 1 || (q.mode === 2 && dd < 1.3)) q.h += angDiff(q.h, Math.atan2(P.x - q.x, P.z - q.z)) * min(1, dt * 8);
      /* fans sting (3 a swat, about 3.5 a second) and they stop when he has had enough: nobody is beaten to the clinic over a speaker */
      if (q.mode === 2 && hyp(P.x - q.x, P.z - q.z) < 1.9 && DC.hitT <= 0 && onFoot()) { DC.hitT = .85; if (hpNow() > 30) { safe(() => S.game.hurt(3, { x: q.x, z: q.z })); smp(rnd() < .5 ? 'punch_1' : 'punch_2', { g: .4 }); bark('dance.kick', 2.5); } else { danceCalm(); bark('dance.calm', 0, true); break; } } }
    if (!vis || !DC.body || (d > 70 ? S.frame % 3 : d > 40 ? S.frame % 2 : 0)) return;
    const n = DC.I.length, mad = DC.mad, gy = DC.gy, cam = S.game.camera, camX = cam ? cam.position.x : P.x, camZ = cam ? cam.position.z : P.z, KO = .95, VB = DC.blockT > 0 ? (DC.ringR || 1.75) - .25 : 0, jn = DC.join && cam ? pp() : null;   /* KO: nobody is drawn closer than this to the lens */
    for (let i = 0; i < n; i++) { const q = DC.I[i]; q.show = sst(DC.k, q.ord * .6, q.ord * .6 + .4); const b = beat - q.late, mv = Math.floor(b / 8) % 4, s = sin(b * PI), s2 = sin(b * HP); let y = 0, h = q.h, side = 0, roll = 0, lean = 0, Lx = 0, Lz = .14, Rx = 0, Rz = -.14;
      if (q.mode === 0 && !mad) { y = abs(s) * .034 * q.amp;
        if (mv === 0) { side = s2 * .2; Lz = .5 + .95 * max(0, s2); Rz = -(.5 + .95 * max(0, -s2)); Lx = Rx = -.3; roll = s2 * .07; }
        else if (mv === 1) { Lz = 2.5 + s * .26; Rz = -(2.5 - s * .26); const u = (((b % 8) + 8) % 8) / 2; h += (Math.floor(u) + sst(u % 1, 0, .6)) * HP; roll = s * .045; }
        else if (mv === 2) { const o = .5 + .5 * sin(b * PI - HP); Lz = .35 + o * 1.3; Rz = -(.35 + o * 1.3); Lx = Rx = -.55 * (1 - o); y += o * .03; }
        else { Lx = -.95 + s * .5; Rx = -.95 - s * .5; Lz = .26; Rz = -.26; roll = sin(b * TAU) * .03; } }
      else if (q.mode === 0) { h += angDiff(h, Math.atan2(P.x - q.x, P.z - q.z)); Lz = .62; Rz = -.62; Lx = Rx = .25; }
      else if (q.mode === 1) { Lz = .6; Lx = .25; Rx = -1.5 + sin(S.t * 11 + i) * .32; Rz = -.2; y = abs(sin(S.t * 6 + i)) * .02; }
      else if (q.mode === 2) { Rx = -2.5 + sin(S.t * 15 + i) * .8; Rz = -.3; Lx = -1.1; Lz = .4; lean = .2; y = abs(sin(S.t * 9 + i)) * .05; }
      else { Lx = sin(S.t * 7 + i) * .5; Rx = -Lx; y = abs(sin(S.t * 7 + i)) * .025; }
      let wx = q.x + cos(q.h) * side, wz = q.z - sin(q.h) * side; { const kx = wx - camX, kz = wz - camZ, kd = hyp(kx, kz); if (kd < KO && kd > 1e-3) { wx = camX + kx / kd * KO; wz = camZ + kz / kd * KO; } }
      if (VB) { const kx = wx - P.x, kz = wz - P.z, kd = hyp(kx, kz); if (kd < VB && kd > 1e-3) { wx = P.x + kx / kd * VB; wz = P.z + kz / kd * VB; } }   /* the crowd closes round a stuck vehicle, never through it */
      q.fd = approach(q.fd || 0, jn && hyp(wx - jn.x, wz - jn.z) > .3 && segDist(wx, wz, jn.x, jn.z, camX, camZ) < .85 ? 1 : 0, dt * 4); const sc = q.sc * q.show * (1 - q.fd);   /* while he dances, whoever stands between the lens and him ducks out of the picture */ _r.position.set(wx, gy + y, wz); _r.rotation.set(lean, h, roll); _r.scale.set(sc * q.wd, sc, sc * q.wd); _r.updateMatrix(); DC.body.setMatrixAt(i, _r.matrix);
      _a.position.set(.215, 1.36, 0); _a.rotation.set(Lx, 0, Lz); _a.updateMatrix(); _m.multiplyMatrices(_r.matrix, _a.matrix); DC.aL.setMatrixAt(i, _m);
      _a.position.set(-.215, 1.36, 0); _a.rotation.set(Rx, 0, Rz); _a.updateMatrix(); _m.multiplyMatrices(_r.matrix, _a.matrix); DC.aR.setMatrixAt(i, _m); }
    DC.body.instanceMatrix.needsUpdate = DC.aL.instanceMatrix.needsUpdate = DC.aR.instanceMatrix.needsUpdate = true;
  }
  function danceCalm() { DC.rage = 0; ST.dance.rage = 0; for (const q of DC.I) if (q.mode === 2) q.mode = 3; }

  /* ================================================================== 3. 西瓜摊冲突 */
  const ML = { mask: null, maskE: null, maskT: 0, turn: null, sites: [], ph: 'calm', t: 0, nextT: 35, cur: -1, thug: null, held: false, heldT: 0, heldMesh: null, proj: null, chunks: null, CH: [], splats: [], enemies: [], blind: [], lineI: 0, lineT: 0, mats: null, fightT: 0 };
  const lw = (s, lx, lz) => [s.x + cos(s.h) * lx + sin(s.h) * lz, s.z - sin(s.h) * lx + cos(s.h) * lz];   /* site-local (x along the trike, +z toward the customer) -> world */
  function melonMats() { if (ML.mats) return ML.mats;
    const rind = new T.MeshStandardMaterial({ roughness: .66, metalness: 0, map: tex(512, 256, (g, w, h) => { g.fillStyle = '#6aa24e'; g.fillRect(0, 0, w, h);   /* b4: stripes are broken, jagged and all different (reference boards 47 to 49); a waxy skin, no plastic highlight */
      for (let i = 0; i < 13; i++) { const x0 = (i + .5) * w / 13 + (rnd() - .5) * 10, wd = 7 + rnd() * 9; g.fillStyle = rnd() < .5 ? '#1c4f26' : '#245a2a'; let y = 0; while (y < h) { const l = 26 + rnd() * 90; g.beginPath(); g.moveTo(x0, y); for (let q = y; q <= Math.min(h, y + l); q += 4) g.lineTo(x0 - wd / 2 - rnd() * 7 + sin(q * .21 + i) * 3, q); for (let q = Math.min(h, y + l); q >= y; q -= 4) g.lineTo(x0 + wd / 2 + rnd() * 7 + sin(q * .17 + i * 2) * 3, q); g.closePath(); g.fill(); y += l + rnd() * 10; } }
      for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(' + (rnd() < .5 ? '215,240,190' : '20,60,26') + ',' + (.05 + rnd() * .1) + ')'; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2); } const yg = g.createRadialGradient(w * .8, h * .5, 4, w * .8, h * .5, 60); yg.addColorStop(0, 'rgba(226,208,120,.75)'); yg.addColorStop(1, 'rgba(226,208,120,0)'); g.fillStyle = yg; g.fillRect(0, 0, w, h); }) });
    const flesh = new T.MeshStandardMaterial({ roughness: .5, metalness: 0, side: T.DoubleSide, map: tex(128, 128, (g, w, h) => { const r = g.createRadialGradient(64, 64, 4, 64, 64, 64); r.addColorStop(0, '#f2525e'); r.addColorStop(.74, '#d8283a'); r.addColorStop(.86, '#f6c8b0'); r.addColorStop(.93, '#dff0c8'); r.addColorStop(1, '#2f7d3a'); g.fillStyle = r; g.fillRect(0, 0, w, h); g.fillStyle = '#1a1210'; for (let i = 0; i < 26; i++) { const a = i * 2.4, rr = 14 + (i * 37 % 30); g.beginPath(); g.ellipse(64 + cos(a) * rr, 64 + sin(a) * rr, 2.6, 1.5, a, 0, TAU); g.fill(); } }) });
    return ML.mats = { rind, flesh }; }
  function melonTrike() {
    const M = melonMats(), k = GT.kit(), steel = col('metal_painted_blue', 0x2a5c9a, .55), galv = GT.mat('metal_galv'), wood = GT.mat('wood_plank');
    /* cargo trike, long axis along x, nose at +x; the customer stands on +z */
    k.box(wood, 1.72, .05, 1.02, -.25, .6, 0, { bevel: .01 }); for (const sz of [-.5, .5]) { for (const y of [.69, .81]) k.box(wood, 1.72, .085, .025, -.25, y, sz, { bevel: .006 }); for (const sx of [-1.08, -.25, .58]) k.box(steel, .03, .32, .03, sx, .74, sz); } for (const y of [.69, .81]) k.box(wood, .025, .085, 1.0, -1.1, y, 0, { bevel: .006 });
    k.box(steel, 2.3, .05, .06, .1, .52, .3); k.box(steel, 2.3, .05, .06, .1, .52, -.3); k.box(steel, .05, .05, 1.1, -.6, .5, 0);
    for (const sz of [-.58, .58]) { k.cyl('rubber', .25, .25, .09, -.6, .25, sz, { rx: HP, seg: 18 }); k.cyl(galv, .15, .15, .095, -.6, .25, sz, { rx: HP, seg: 12 }); k.box(steel, .56, .02, .13, -.6, .53, sz, { bevel: .008 }); }
    k.cyl('rubber', .25, .25, .09, 1.3, .25, 0, { rx: HP, seg: 18 }); k.cyl(galv, .15, .15, .095, 1.3, .25, 0, { rx: HP, seg: 12 }); k.tube(steel, [[1.3, .25, .07], [1.18, .7, .07], [1.1, 1.02, 0], [1.18, .7, -.07], [1.3, .25, -.07]], .018, { seg: 6, steps: 14, tension: .1 });
    k.cyl(steel, .017, .017, .56, 1.08, 1.06, 0, { rx: HP, seg: 8 }); for (const sz of [-.26, .26]) k.cyl('rubber', .022, .022, .1, 1.08, 1.06, sz, { rx: HP, seg: 8 }); k.box('leather_black', .3, .07, .24, .78, .9, 0, { bevel: .03 }); k.cyl(steel, .02, .02, .34, .78, .72, 0, { seg: 8 });
    k.box(col('plastic_grey', 0x3a3d42, .7), .34, .24, .5, .35, .44, 0, { bevel: .03 });
    /* the load: two layers of melons, the top ones turned every which way */
    const pile = [[-.95, -.3], [-.95, .05], [-.93, .34], [-.6, -.32], [-.58, .02], [-.6, .33], [-.25, -.3], [-.22, .04], [-.26, .34], [.1, -.28], [.12, .08]];
    pile.forEach((p, i) => k.geo(M.rind, new T.SphereGeometry(.165 + (i * 7 % 5) * .008, 18, 12), { x: p[0], y: .8, z: p[1], ry: i * 1.3, rz: (i % 3 - 1) * .5, s: [1.13, 1, 1] }));
    [[-.78, -.14], [-.76, .2], [-.42, -.15], [-.4, .2], [-.08, -.1]].forEach((p, i) => k.geo(M.rind, new T.SphereGeometry(.17, 18, 12), { x: p[0], y: 1.08, z: p[1], ry: i * 2.1, rx: i * .7, s: [1.13, 1, 1] }));
    /* cutting board on the tail-gate corner: a half, wedges under film, the cleaver */
    k.box(col('wood_plank', 0xb89a6a, .8), .5, .035, .34, .34, .645, .3, { bevel: .01 }); k.geo(M.rind, new T.SphereGeometry(.17, 18, 10, 0, TAU, HP, HP), { x: .22, y: .83, z: .3, rx: PI + .5 }); k.geo(M.flesh, new T.CircleGeometry(.17, 22), { x: .22, y: .83, z: .3, rx: -HP + .5 });
    for (let i = 0; i < 4; i++) { k.geo(M.flesh, new T.CircleGeometry(.155, 14, 0, PI), { x: .42 + i * .045, y: .665, z: .3, ry: HP + .1 }); }
    k.box('metal_galv', .2, .09, .004, .32, .668, .44, { rx: HP, ry: .5 }); k.box(wood, .1, .022, .026, .19, .668, .5, { ry: .5 });
    /* parasol, bare bulb, platform scale on a stool, cardboard price sign, payment card, the vendor's stool */
    k.cyl(galv, .02, .024, 2.45, -.25, 1.22, -.5, { seg: 8 }); k.geo(new T.MeshStandardMaterial({ roughness: .85, side: T.DoubleSide, map: tex(256, 64, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#e9e4d2' : '#1f7a4a'; g.fillRect(i * w / 8, 0, w / 8 + 1, h); } g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(0, h - 10, w, 10); }) }), new T.ConeGeometry(1.42, .46, 16, 1, true), { x: -.25, y: 2.44, z: -.2, rx: .16 });
    k.cyl(galv, .012, .012, 1.4, -.25, 2.26, -.2, { rx: HP + .16, seg: 6 }); k.tube('rubber', [[-.25, 2.2, -.4], [-.1, 2.05, -.1], [0, 1.86, .05]], .005, { seg: 4 }); k.sphere('light_warm', .045, 0, 1.81, .05, { seg: 10, seg2: 8 }); k.cyl('plastic_black', .02, .02, .05, 0, 1.86, .05, { seg: 8 });
    k.cyl(col('plastic_red', 0xb5202a, .5), .17, .14, .42, -1.5, .21, .28, { seg: 12 }); k.box(col('metal_painted_blue', 0x2b6e5a, .6), .36, .07, .3, -1.5, .455, .28, { bevel: .015 }); k.box('metal_galv', .3, .012, .26, -1.5, .5, .28); k.box(col('metal_painted_blue', 0x2b6e5a, .6), .04, .42, .04, -1.5, .7, .14); k.cyl('plastic_white', .11, .11, .03, -1.5, .92, .15, { rx: HP, seg: 20 });
    k.quad(paper(128, 128, (g, w) => { g.fillStyle = '#f4f1e6'; g.beginPath(); g.arc(64, 64, 62, 0, TAU); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 2; for (let i = 0; i < 30; i++) { const a = i / 30 * TAU; g.beginPath(); g.moveTo(64 + cos(a) * 52, 64 + sin(a) * 52); g.lineTo(64 + cos(a) * (i % 5 ? 58 : 44), 64 + sin(a) * (i % 5 ? 58 : 44)); g.stroke(); } g.strokeStyle = '#c2251d'; g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(96, 30); g.stroke(); g.fillStyle = '#111'; g.font = '700 16px ' + HEI; g.textAlign = 'center'; g.fillText('公平秤', 64, 100, w); }, { transparent: true }), .2, .2, -1.5, .92, .167);
    k.quad(paper(512, 320, (g, w, h) => { g.fillStyle = '#b08a56'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(60,40,20,.18)'; for (let i = 0; i < 16; i++) g.fillRect(0, i * 20 + 6, w, 2); g.fillStyle = '#14110e'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 108px ' + KAI; g.fillText('本地沙瓤', w / 2, 78, w - 40); g.fillStyle = '#a3140f'; g.font = '900 86px ' + KAI; g.fillText('不甜不要钱', w / 2, 178, w - 50); g.fillStyle = '#14110e'; g.font = '700 50px ' + KAI; g.fillText('十块一牙 · 整瓜论斤', w / 2, 268, w - 60); }), .82, .51, .32, .34, .525, { rx: -.1 });
    k.box('plastic_white', .13, .19, .008, -.78, .76, .522, { rx: -.12 }); k.quad(paper(128, 192, (g, w, h) => { g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h); g.fillStyle = '#16181c'; for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) if (((x * 7 + y * 13 + x * y) % 5 < 2) || ((x < 3 || x > 9) && y < 3) || (x < 3 && y > 9)) g.fillRect(12 + x * 8, 14 + y * 8, 7, 7); g.font = '800 26px ' + HEI; g.textAlign = 'center'; g.fillText('扫码付款', w / 2, 168, w - 8); }), .12, .18, -.78, .761, .528, { rx: -.12 });
    k.cyl(col('plastic_red', 0xb5202a, .5), .15, .13, .4, -.95, .2, -1.0, { seg: 12 }); k.box(col('plastic_grey', 0x4a7ab5, .7), .5, .3, .36, .6, .15, -.95, { bevel: .02 });
    for (let i = 0; i < 5; i++) k.geo(M.rind, new T.SphereGeometry(.15, 10, 6, 0, PI * .9, .6, 1.6), { x: .5 + (i % 3) * .1, y: .32 + (i % 2) * .03, z: -.98 + (i % 2) * .08, ry: i * 1.9, rx: i });
    return k.build(); }
  function melonBuild() {
    const pref = [{ id: 'melonA', name: '西瓜摊 · 小吃街路口', x: 12.45, z: -13.2 }, { id: 'melonB', name: '西瓜摊 · 六十七号院巷口', x: 12.45, z: 65.4 }]; let proto = null;
    pref.forEach((p, i) => { const f = fit(p.x, p.z, .85, 1.55), s = { id: p.id, name: p.name, x: f.x, z: f.z, h: -HP, fit: f.fit, grp: null, vendor: null, i }; s.y = gY(s.x, s.z, .5); ML.sites.push(s); spot(p.id, p.name, s.x, s.z);
      const v = lw(s, -.2, -1.05), st = lw(s, -.2, 1.45); s.stand = st; s.vendor = actor('vendor', v[0], v[1], s.h, { seed: 3 + i * 4, opts: { kit: { aux: undefined } } }); s.vendor.home = v;
      if (S.visual) { const g = proto ? proto.clone() : (proto = safe(() => melonTrike(), null)); if (g) { g.position.set(s.x, s.y, s.z); g.rotation.y = s.h; s.grp = g; S.root.add(g); } }
      const a = lw(s, -1.25, -.56), b = lw(s, 1.45, .56); GT.world.addBox(a[0], a[1], b[0], b[1], s.y + .95, 'street:melon'); const pp = lw(s, -.25, -.5); GT.world.addPost(pp[0], pp[1], .05, 2.4, 'street:melon');
      addSpot({ id: 'st:melon:buy' + i, x: st[0], z: st[1], r: 1.9, label: () => (SV.melon.vip ? '吃瓜 · 老秤请客' : '买瓜 $10'), enabled: () => onFoot() && ML.ph !== 'fight' && S.free, onUse: () => melonBuy(i) });
      addSpot({ id: 'st:melon:stoke' + i, x: st[0], z: st[1], r: 2.6, key: 'KeyZ', label: '拱火', enabled: () => onFoot() && ML.ph === 'argue' && ML.cur === i, onUse: () => melonStoke() });
      addSpot({ id: 'st:melon:grab' + i, x: st[0], z: st[1], r: 1.9, key: 'KeyY', label: '抱走一个整瓜', enabled: () => onFoot() && !ML.held && S.free, onUse: () => melonGrab(i) }); });
    if (!S.visual) return; const M = melonMats();
    ML.heldMesh = addMesh(S.root, new T.SphereGeometry(.17, 18, 12), M.rind, 0, -50, 0, { s: [1.13, 1, 1] }); ML.heldMesh.visible = false;
    const cg = new T.TetrahedronGeometry(.075), cm = new T.MeshStandardMaterial({ roughness: .45, metalness: 0 }), im = ML.chunks = new T.InstancedMesh(cg, cm, 44); im.instanceMatrix.setUsage(T.DynamicDrawUsage); im.frustumCulled = false; im.castShadow = false; im.visible = false;
    const red = GT.C(0xe03348), pink = GT.C(0xf08a8a), grn = GT.C(0x2f7d3a); for (let i = 0; i < 44; i++) { im.setColorAt(i, i % 4 === 3 ? grn : i % 4 === 2 ? pink : red); ML.CH.push({ x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, a: 0, w: 0, life: 0, s: 1 }); } S.root.add(im);
    { const mk = ML.mask = new T.Group(), pulp = new T.MeshStandardMaterial({ color: GT.C(0xd92b40), roughness: .32, metalness: 0 }), seed = new T.MeshStandardMaterial({ color: GT.C(0x16110d), roughness: .5 });   /* the pulp that sits on a blinded face for its three seconds: a slumped cap of red flesh, drips, seeds, a shard of rind */
      addMesh(mk, new T.SphereGeometry(.118, 14, 10, 0, TAU, 0, PI * .62), pulp, 0, 0, .012, { rx: HP, s: [1, .78, 1.08], cast: false }); for (const [x, y, r, l] of [[-.05, -.07, .022, .1], [.035, -.085, .026, .14], [.085, -.03, .018, .07], [-.01, -.1, .02, .09]]) addMesh(mk, new T.CylinderGeometry(r, r * .45, l, 6), pulp, x, y - l / 2, .1, { cast: false });
      for (let i = 0; i < 7; i++) addMesh(mk, new T.SphereGeometry(.009, 5, 4), seed, sin(i * 2.4) * .06, cos(i * 1.7) * .05, .112 - abs(sin(i * 2.4)) * .02, { s: [1, 1.6, .6], cast: false }); addMesh(mk, new T.SphereGeometry(.125, 10, 6, 0, 1.5, .5, .7), M.rind, 0, .01, .0, { rx: HP, cast: false }); mk.visible = false; S.root.add(mk); }
    for (let i = 0; i < 4; i++) { const m = addMesh(S.root, new T.CircleGeometry(.62, 20), new T.MeshBasicMaterial({ color: GT.C(0xb8202e), transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 0, -50, 0, { rx: -HP, cast: false }); m.visible = false; ML.splats.push({ m, t: 0 }); }
  }
  function melonBuy(i) { const s = ML.sites[i]; if (!s) return false; const price = SV.melon.vip ? 0 : 10, W = GT.wallet;
    if (price && !(W && W.spend && W.spend(price))) { bark('melon.broke', 0, true); safe(() => S.game.emit('broke', { name: '西瓜', price })); return false; }
    safe(() => S.game.heal(40)); SV.melon.bought++; ST.melon.bought = SV.melon.bought; save(); toast('西瓜一牙', price ? '−$10 · 生命 +40' : '老秤请的 · 生命 +40'); sfx('cash'); bark(price ? 'melon.buy' : 'melon.free', 0, true); later(1.9, () => bark('melon.eat', 0, true)); safe(() => S.game.emit('buy', { name: '西瓜', price, heal: 40 }));
    const ctl = S.game.ctl; if (ctl && ctl.takeover && S.visual) { let t = 0; safe(() => ctl.takeover({ heroState: 'eat', look: true, update(dt) { t += dt; return t > 1.5; } })); } return true; }
  function melonGrab(i) { if (ML.held) return false; ML.held = true; ML.heldT = 0; ST.melon.held = true; sfx('pickup');
    if (ML.ph === 'fight' || ML.ph === 'stoked') { /* 老秤 is under the trike and glad of it: no charge, no report */ } else if (SV.melon.vip) bark('melon.free', 0, true); else { bark('melon.grab', 0, true); safe(() => S.game.wanted.add({ stars: .25, fine: 30, label: '顺手牵瓜' })); const s = ML.sites[i]; if (s && s.vendor) s.vendor.state = 'scold'; later(3, () => { if (s && s.vendor && ML.ph !== 'fight') s.vendor.state = 'idle'; }); } return true; }
  function melonThrow(dir) { if (!ML.held) return false; ML.held = false; ST.melon.held = false; ST.melon.thrown++; const pl = pp(), ph = isFinite(pl.h) ? pl.h : P.h, py = isFinite(pl.y) ? pl.y : P.y; let ox = pl.x, oy = py + 1.5, oz = pl.z, dx = sin(ph), dy = .12, dz = cos(ph); const cam = S.game && S.game.camera;
    if (dir) { dx = dir.x; dy = dir.y || 0; dz = dir.z; } else if (cam && cam.getWorldDirection && S.visual) { const v = cam.getWorldDirection(new T.Vector3()); dx = v.x; dy = v.y; dz = v.z; ox = cam.position.x + dx * .7; oy = cam.position.y - .22; oz = cam.position.z + dz * .7; if (hyp(ox - pl.x, oz - pl.z) > 2.5) { ox = pl.x + dx * .6; oy = py + 1.5; oz = pl.z + dz * .6; dy += .06; } }
    const pr = ML.proj = { x: ox, y: oy, z: oz, vx: dx * 16, vy: dy * 16 + 2.6, vz: dz * 16, t: 0, spin: 0, tg: null, mine: true };
    /* aim assist: nobody is told to pitch the camera for a lob, and 阿豹 is by design six metres off and moving — the melon goes for the nearest hostile inside a 40° cone of the look direction (16 m),
       or anyone within 3.5 m in front; the arc is solved for his head and the flight keeps correcting (melonStep). An explicit dir (tests, scripts) is thrown as given. */
    if (!dir) { const hl = hyp(dx, dz) || 1, hx = dx / hl, hz = dz / hl, list = ((GT.combat && GT.combat.enemies) || []).filter(e => e && !e.dead && !e.out); if (ML.thug && ML.thug.vis !== false) list.push(ML.thug); let best = null, bs = 1e9;
      for (const e of list) { const ex = e.x - ox, ez = e.z - oz, d = hyp(ex, ez); if (d < .4 || d > 16) continue; const c = (ex * hx + ez * hz) / d; if (c < (d < 3.5 ? .2 : .766)) continue; const sc = Math.acos(clamp(c, -1, 1)) + d * .02 + (ML.enemies.indexOf(e) >= 0 || e === ML.thug ? 0 : .25); if (sc < bs) { bs = sc; best = e; } }
      if (best) { const d = hyp(best.x - ox, best.z - oz), tt = clamp(d / 17, .2, 1), ty = (isFinite(best.y) ? best.y : gY(best.x, best.z, py + .5)) + 1.5; pr.vx = (best.x - ox) / tt; pr.vz = (best.z - oz) / tt; pr.vy = (ty - oy) / tt + 6 * tt; pr.tg = best; } }
    sfx('whoosh'); return true; }
  function melonSplat(x, y, z, hitWho, mine) { ML.proj = null; smp('punch_1', { g: .7, rate: .7 }); sfx('thunk');
    if (ML.chunks) { ML.chunks.visible = true; for (const c of ML.CH) { const a = rnd() * TAU, sp = 1.5 + rnd() * 4.5; c.x = x; c.y = y + .05; c.z = z; c.vx = sin(a) * sp; c.vz = cos(a) * sp; c.vy = 1.5 + rnd() * 4.5; c.a = rnd() * 6; c.w = (rnd() - .5) * 18; c.life = 1.6 + rnd() * 1.2; c.s = .7 + rnd() * 1.3; } }
    const sp = ML.splats.sort((a, b) => a.t - b.t)[0]; if (sp) { sp.t = 14; sp.m.visible = true; sp.m.position.set(x, gY(x, z, y) + .02, z); sp.m.rotation.z = rnd() * 6; sp.m.scale.setScalar(.8 + rnd() * .6); }
    if (hitWho && hitWho.isEnemy) { ML.blind.push({ e: hitWho, t: 3 }); ST.melon.blinded++; const e = hitWho; if (!e.dead && e.hp > 1) e.hp = max(1, e.hp - 28);   /* four kilos of melon in the face: it hurts, and one punch finishes what it starts */ if (!e.dead && e.state !== 'down' && !e.token && !e.cover) { e.prev = e.melee ? 'chase' : 'react'; e.state = 'stagger'; e.t = 3; e.swing = null; } e.shotCool = max(e.shotCool || 0, 3); e.stagK = 1; ML.maskE = e; ML.maskT = 3; toast('西瓜糊脸 · 正中', (e.who || '他') + '看不见了 · 致盲 3 秒 · 上去补拳'); sfx('pickup'); later(.35, () => bark('melon.hit', 0, true)); }
    else if (hitWho && hitWho === ML.thug) { ST.melon.blinded++; ML.ph = 'blinded'; ML.t = 0; ML.thug.wp = null; ML.thug.state = 'stagger'; bark('melon.hit', 0, true); ML.maskE = ML.thug; ML.maskT = 3; toast('西瓜糊脸 · 正中', '阿豹看不见了'); sfx('pickup'); }
    else if (mine) { toast('砸偏了', (ML.ph === 'fight' || ML.ph === 'stoked') ? '车上还有瓜 · Y 再抄一个' : '一地沙瓤'); later(.5, () => bark('melon.miss', 0, true)); } }
  function melonStoke() { if (ML.ph !== 'argue' || !ML.thug) return false; ML.ph = 'stoked'; ML.t = 0; cancel('melon'); convo('melon.stoke', 2.2); const s = ML.sites[ML.cur], th = ML.thug; if (s) s.vendor.state = 'cower';
    /* 阿豹 backs off six metres down the pavement before he draws: the fight starts with room to move and a trike of ammunition between you, not with a muzzle at arm's length */
    if (s) { const pl = pp(), c = [lw(s, 6.2, 1.7), lw(s, -6.2, 1.7)].map(p => { const f = fit(p[0], p[1], .35, .35, { road: true }); return [f.x, f.z]; }).sort((a, b) => hyp(b[0] - pl.x, b[1] - pl.z) - hyp(a[0] - pl.x, a[1] - pl.z))[0]; later(1.1, () => { if (ML.ph === 'stoked' && ML.thug === th) th.goTo([c], 3.3, () => { th.face(pp().x, pp().z, 1); }); }, 'melon'); }
    return true; }
  function melonEvent(i) { if (ML.ph !== 'calm') { /* asked for a named stand while 阿豹 is still on his way to (or arguing at) another one: the scene moves to the stand asked for */ if (i === undefined || !ML.sites[i] || ML.cur === i || (ML.ph !== 'walkin' && ML.ph !== 'argue')) return false; cancel('melon'); melonThugGone(); melonRest(0); } const s = ML.sites[i === undefined ? (rnd() * ML.sites.length) | 0 : i]; if (!s) return false; ML.cur = s.i; ML.ph = 'walkin'; ML.t = 0; ML.lineI = 0; ML.lineT = 1; ST.melon.site = s.i;
    const sd = rnd() < .5 ? -1 : 1, from = lw(s, sd * 15, 1.9), cand = [lw(s, 1.55, 1.3), lw(s, -1.75, 1.3)], to = hyp(cand[0][0] - P.x, cand[0][1] - P.z) > 1.1 ? cand[0] : cand[1];   /* at the nose of the trike, a clear 1.7 m from the customer's spot: he no longer stops shoulder to shoulder with whoever is buying */ if (ML.thug) melonThugGone(); const th = ML.thug = actor('thug', from[0], from[1], 0, { seed: 4, far: 90 }); th.goTo([to], 1.5, () => { ML.ph = 'argue'; ML.t = 0; th.face(s.vendor.x, s.vendor.z, 1); }); return true; }
  function melonThugGone() { const th = ML.thug; ML.thug = null; if (!th) return; const i = S.actors.indexOf(th); if (i >= 0) S.actors.splice(i, 1); if (th.group && th.group.parent) th.group.parent.remove(th.group); }
  const melonEasy = on => { const C = GT.combat; if (!C || !C.opts) return; if (on) { if (ML.diff0 === undefined) { ML.diff0 = C.opts.difficulty; C.opts.difficulty = min(C.opts.difficulty, .55); } } else if (ML.diff0 !== undefined) { C.opts.difficulty = ML.diff0; ML.diff0 = undefined; } };
  const melonRest = (t) => { melonEasy(false); ML.enemies.length = 0; ML.ph = 'calm'; ML.nextT = t === undefined ? 95 + rnd() * 70 : t; ML.cur = -1; ST.melon.site = -1; for (const s of ML.sites) if (s.vendor) s.vendor.state = 'idle'; };
  function melonStep(dt) {
    ML.t += dt; ST.melon.vip = !!SV.melon.vip; const s = ML.sites[ML.cur] || null, th = ML.thug;
    for (const q of ML.sites) { const v = q.vendor; if (!v) continue; actorStep(v, dt); if (ML.ph !== 'fight' && ML.ph !== 'stoked' && v.state !== 'scold') { const d = distP(v.x, v.z); if (q === s && th && (ML.ph === 'argue' || ML.ph === 'walkin')) v.face(th.x, th.z, dt); else if (d < 5 && onFoot()) v.face(P.x, P.z, dt); else v.h += angDiff(v.h, q.h) * min(1, dt * 2); } }
    if (th) actorStep(th, dt);
    if (ML.ph === 'calm') { if (S.free) ML.nextT -= dt; if (ML.nextT <= 0) { /* the argument starts at the stand nearest the player and only within sight of it (it used to pick any stand inside 95 m: at stand B the scene ran at stand A, 80 m off) */ const near = ML.sites.slice().sort((p, q) => distP(p.x, p.z) - distP(q.x, q.z))[0]; if (near && distP(near.x, near.z) < 55) melonEvent(near.i); else ML.nextT = 12; } }
    else if (ML.ph === 'walkin') { if (ML.t > 30) { melonThugGone(); melonRest(30); } }
    else if (ML.ph === 'argue' && s && th) { th.state = ((ML.t / 3.3) | 0) % 2 ? 'talk' : 'point'; th.face(s.vendor.x, s.vendor.z, dt); s.vendor.state = ((ML.t / 3.3) | 0) % 2 ? 'scold' : 'talk'; ML.lineT -= dt;
      if (ML.lineT <= 0 && S.free && distP(s.x, s.z) < 16) { const a = LN['melon.argue']; if (a.length) say(a[ML.lineI % a.length]); ML.lineI++; ML.lineT = 3.4; }
      if (ML.t > 40) { ML.ph = 'leave'; ML.t = 0; if (distP(s.x, s.z) < 30) convo('melon.timeout', 2.6); const p = lw(s, .7, 1.5); later(1.2, () => { if (distP(s.x, s.z) < 60) melonSplat(p[0], s.y + .1, p[1], null); }); const away = lw(s, -17, 2.2); th.goTo([away], 1.6, () => { melonThugGone(); melonRest(); }); s.vendor.state = 'shrug'; } }
    else if (ML.ph === 'leave') { if (ML.t > 40) { melonThugGone(); melonRest(); } }
    else if (ML.ph === 'blinded' && th) { th.state = 'stagger'; if (ML.t > 3) { ML.ph = 'leave'; ML.t = 0; const away = lw(s || ML.sites[0], 18, 2.4); th.goTo([away], 4.2, () => { melonThugGone(); melonRest(); }); bark('melon.laugh', 0, true); if (GT.wallet && GT.wallet.add) GT.wallet.add(20, 'melon'); toast('老秤塞给你二十块', '+$20'); if (s) s.vendor.state = 'applaud'; } }
    else if (ML.ph === 'stoked' && s && th) { if (!th.wp) { th.face(pp().x, pp().z, dt); th.state = 'point'; } if ((ML.t > 3.4 && !th.wp) || ML.t > 6.5) melonFight(s, th); }
    else if (ML.ph === 'fight') { ML.fightT += dt; if (ML.turn) { const C = GT.combat && GT.combat.camera, tr = ML.turn, pl = pp(); tr.t += dt; if (C && isFinite(C.yaw) && tr.e && !tr.e.dead && tr.t < .5) C.yaw += angDiff(C.yaw, Math.atan2(tr.e.x - pl.x, tr.e.z - pl.z)) * min(1, dt * 9); else ML.turn = null; }   /* the fight opens looking at 阿豹, not at the trike (he used to stand off screen) */ const en = (GT.combat && GT.combat.enemies) || null, here = e => !en || en.indexOf(e) >= 0, alive = ML.enemies.filter(e => e && !e.dead && !e.out && here(e)), wiped = ML.enemies.some(e => e && !e.dead && !e.out && !here(e)); if (s) s.vendor.state = 'cower';
      if (ML.fightT < 3.5) for (const e of alive) if (!e.melee) e.aimErr = .16;   /* his first shots go wide: time to duck behind the trike or grab a melon */
      if (wiped) { cancel('melon'); melonRest(45); }   /* js/combat.js cleared the field (the player went down and woke up at home): this is over, not won */ else
      if (th) { /* no combat layer: he shoves you and runs */ if (!th.wp && th.state !== 'run') { th.goTo([[P.x, P.z]], 4.4, () => { if (distP(th.x, th.z) < 1.6) safe(() => S.game.knockDown(sin(th.h) * 3, cos(th.h) * 3, 10, 'shove', { x: th.x, z: th.z })); const away = lw(s || ML.sites[0], 20, 3); th.goTo([away], 4.6, () => { melonThugGone(); melonRest(); }); }); } }
      else if (!alive.length) { ML.ph = 'won'; ML.t = 0; SV.melon.vip = true; SV.melon.saved++; ST.melon.fights++; save(); bark('melon.won', 0, true); if (GT.wallet && GT.wallet.add) GT.wallet.add(88, 'melon'); toast('老秤的红包', '+$88 · 以后吃瓜不要钱'); sfx('cash'); melonEasy(false); safe(() => S.game.heal(40)); if (s) s.vendor.state = 'applaud'; if (SV.melon.saved === 1) safe(() => S.game.ui.achievement('吃瓜群众转正')); }
      else if (ML.fightT > 120 || (s && distP(s.x, s.z) > 90)) melonRest(60); }
    else if (ML.ph === 'won') { if (ML.t > 7) melonRest(); }
    /* the melon in hand, the throw, the mess */
    const pl = pp(), hot = (ML.ph === 'fight' || ML.ph === 'stoked') && !!s, reach = hot && P.mode === 'foot' && hyp(pl.x - s.x, pl.z - s.z) < 3.2;
    /* once the fight is on, the on-foot prompts are gone (js/combat.js has the controls): the trike is read here, so a melon can be grabbed in the middle of it */
    if (reach && !ML.held) { const inp = input(); if (inp && inp.pressed && inp.pressed('KeyY')) { if (inp.consume) inp.consume('KeyY'); melonGrab(s.i); } }
    else if (ML.held) { ML.heldT += dt; const inp = input(); if (ML.heldT > .35 && onFoot() && inp && inp.pressed && inp.pressed('KeyY')) { if (inp.consume) inp.consume('KeyY'); melonThrow(); } }
    chip(ML.held ? '把西瓜砸出去' : reach ? '抄个整瓜 · 砸他脸上' : false);
    const hm = ML.heldMesh; if (hm) { hm.visible = ML.held; if (ML.held) { const cam = S.game.camera, fp = cam && hyp(cam.position.x - pl.x, cam.position.z - pl.z) < .8, ph = isFinite(pl.h) ? pl.h : P.h, py = isFinite(pl.y) ? pl.y : P.y; if (fp) { hm.position.set(.26, -.3, -.62).applyMatrix4(cam.matrixWorld); hm.quaternion.copy(cam.quaternion); } else { hm.position.set(pl.x + sin(ph) * .32 - cos(ph) * .2, py + 1.02, pl.z + cos(ph) * .32 + sin(ph) * .2); hm.rotation.set(0, ph, 0); } } }
    const pr = ML.proj; if (pr) { pr.t += dt; pr.vy -= 12 * dt; pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt; pr.spin += dt * 9; if (pr.tg && !pr.tg.dead && !pr.tg.out) { const tx = pr.tg.x - pr.x, tz = pr.tg.z - pr.z, td = hyp(tx, tz), sp = hyp(pr.vx, pr.vz); if (td > .3 && sp > 1) { const k = min(1, dt * 7); pr.vx += (tx / td * sp - pr.vx) * k; pr.vz += (tz / td * sp - pr.vz) * k; } } if (hm) { hm.visible = true; hm.position.set(pr.x, pr.y, pr.z); hm.rotation.set(pr.spin, pr.spin * .7, 0); }
      let hit = null; const en = (GT.combat && GT.combat.enemies) || []; for (const e of en) if (!e.dead && !e.out && hyp(e.x - pr.x, e.z - pr.z) < (e === pr.tg ? .95 : .75) && pr.y > (e.y || 0) + .2 && pr.y < (e.y || 0) + 2.2) { hit = e; break; }
      if (!hit && th && th.vis && hyp(th.x - pr.x, th.z - pr.z) < (th === pr.tg ? .95 : .75) && pr.y < gY(th.x, th.z, pr.y) + 2.2) hit = th;
      if (hit || pr.y <= gY(pr.x, pr.z, pr.y + .5) + .14 || pr.t > 4 || (pr.t > .12 && blocked(pr.x - .1, pr.z - .1, pr.x + .1, pr.z + .1, pr.y - .3))) melonSplat(pr.x, max(pr.y, gY(pr.x, pr.z, pr.y + .5) + .1), pr.z, hit, pr.mine); }
    for (let i = ML.blind.length - 1; i >= 0; i--) { const b = ML.blind[i]; b.t -= dt; if (b.t <= 0 || b.e.dead) { ML.blind.splice(i, 1); continue; } b.e.aimErr = max(b.e.aimErr || 0, .9); b.e.sees = false; b.e.shotCool = max(b.e.shotCool || 0, .5); b.e.swing = null; }   /* blind means blind: no aimed shot and no swing for the three seconds, whichever of js/combat.js and this file steps first */
    if (ML.maskT > 0) { ML.maskT -= dt; const e = ML.maskE, mk = ML.mask; if (mk) { const on = ML.maskT > 0 && e && !e.dead; mk.visible = !!on; if (on) { const ey = (isFinite(e.y) ? e.y : gY(e.x, e.z, 1)) + (e.ht ? e.ht - .17 : 1.62), k = min(1, ML.maskT / .5); mk.position.set(e.x + sin(e.h) * .085, ey - (3 - ML.maskT) * .012, e.z + cos(e.h) * .085); mk.rotation.set(0, e.h, 0); mk.scale.set(k, k * (1 + (3 - ML.maskT) * .1), k); } } if (ML.maskT <= 0) ML.maskE = null; }
    if (ML.chunks && ML.chunks.visible) { let live = 0; ML.CH.forEach((c, i) => { if (c.life > 0) { c.life -= dt; c.vy -= 13 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.a += c.w * dt; const g = gY(c.x, c.z, c.y + .5) + .03; if (c.y < g) { c.y = g; c.vy = abs(c.vy) * .28; c.vx *= .5; c.vz *= .5; c.w *= .4; } live++; }
        _r.position.set(c.x, c.y, c.z); _r.rotation.set(c.a, c.a * .7, 0); _r.scale.setScalar(c.life > 0 ? c.s * min(1, c.life * 2) : 0); _r.updateMatrix(); ML.chunks.setMatrixAt(i, _r.matrix); }); ML.chunks.instanceMatrix.needsUpdate = true; if (!live) ML.chunks.visible = false; }
    for (const sp of ML.splats) if (sp.t > 0) { sp.t -= dt; sp.m.material.opacity = min(.62, sp.t * .12); if (sp.t <= 0) sp.m.visible = false; }
  }
  /* winnable bare-handed: 阿豹 (50 hp, rattled aim, the layer's damage scaled to .55 for this fight) starts six metres off; his mate (45 hp, a pipe) only turns up after eight seconds and only if 阿豹 is still standing.
     A melon in the face blinds for 3 s and takes 28 hp, so one melon and two punches settle it. */
  function melonFight(s, th) { th.wp = null; ML.ph = 'fight'; ML.t = 0; ML.fightT = 0; ML.enemies.length = 0; const g = S.game;
    const e1 = safe(() => g.spawnNPC('gunman', th.x, th.z, { hostile: true, alert: true, h: th.h, seed: 4, group: 'melon', hp: 50 }), null);
    if (e1 && e1.isEnemy) { ML.enemies.push(e1); e1.who = '阿豹'; e1.aimErr = .16; melonEasy(true); melonThugGone(); ML.turn = { t: 0, e: e1 }; toast('阿豹掏家伙了', 'Y 抄个整瓜 · 再按 Y 砸他脸上 · 致盲 3 秒');
      const far = [lw(s, 14, 2.2), lw(s, -14, 2.2)].sort((a, b) => hyp(b[0] - e1.x, b[1] - e1.z) - hyp(a[0] - e1.x, a[1] - e1.z))[1];   /* his mate comes from 阿豹's side, never from behind the player */
      later(8, () => { if (ML.ph !== 'fight' || e1.dead || e1.out) return; const e2 = safe(() => g.spawnNPC('thug', far[0], far[1], { hostile: true, alert: true, seed: 11, group: 'melon', hp: 45 }), null); if (e2 && e2.isEnemy) { e2.who = '阿豹的马仔'; ML.enemies.push(e2); } }, 'melon'); }
    else if (e1 && e1.remove) safe(() => e1.remove()); }
  /** the player went down (js/cngame.js 'death'): whatever was after him here stands down */
  function streetDeath() { if (ML.ph === 'fight' || ML.ph === 'stoked') { cancel('melon'); melonThugGone(); melonRest(45); } if (ML.held) { ML.held = false; ST.melon.held = false; } if (DC.rage > 0) danceCalm(); if (DC.join) DC.join.stop = true; }

  /* ================================================================== 4. 老头乐 「跑不快」 */
  const LT = { ent: null, drv: null, out: null, ph: 'off', t: 0, dir: 1, lane: -3, laneT: 5, uT: 20, blockT: 0, stuckT: 0, hitCd: 0, lie: null, respT: 0, col: 0, copT: 0, kaiT: 0, spawnT: 2, seatY: .58, honkT: 0, side: -1, jamT: 0, tightT: 0, squeezeT: 0, slowT: 0, stallT: 0, hornAt: -99 };
  const LTCOL = [0xf08fb0, 0x86d86a, 0x6ec8e8, 0xf2c84a];
  const LDIMS = { L: 2.3, W: 1.25, H: 1.62, wheelbase: 1.55, track: 1.02, wheelR: .2, eye: [0, 1.17, -.06], seatH: .58 };
  /** the vehicle object js/cngame.js expects from GT.cnvehicles.make (group / dims / wheels / steer / seat / setLights / update) */
  function makeLao(o) {
    o = o || {}; const g = new T.Group(); g.name = 'veh_laotoule'; const paint = col('car_paint', o.color !== undefined ? o.color : LTCOL[0], .32, .25), white = col('car_paint', 0xece8dc, .4, .1), blk = GT.mat('plastic_black'), chrome = GT.mat('chrome'), k = GT.kit(), W = LDIMS.W, wb = LDIMS.wheelbase, rw = LDIMS.wheelR;
    k.box(blk, .78, .08, 2.0, 0, .3, 0, { bevel: .02 }); k.box(paint, 1.22, .46, 2.2, 0, .63, 0, { bevel: .13 }); for (const sx of [-.5, .5]) for (const sz of [-.775, .775]) k.box(blk, .2, .035, .5, sx, .425, sz, { bevel: .012 }); k.box(paint, 1.12, .15, .5, 0, .86, .82, { rx: .25, bevel: .05 }); k.box(paint, 1.16, .12, .34, 0, .84, -.94, { bevel: .05 });
    for (const sz of [1.12, -1.12]) k.box(blk, 1.26, .11, .1, 0, .45, sz, { bevel: .035 }); for (const sx of [-.615, .615]) { k.box(blk, .02, .07, 1.0, sx, .45, 0); k.box(chrome, .012, .03, 1.5, sx * 1.004, .76, -.1); }
    for (const sx of [-.57, .57]) { k.tube(paint, [[sx, .8, .6], [sx * .95, 1.48, .34]], .034, { seg: 8 }); k.tube(paint, [[sx, .8, -1.0], [sx * .95, 1.48, -.9]], .034, { seg: 8 }); k.tube(paint, [[sx, .8, -.22], [sx * .95, 1.48, -.24]], .026, { seg: 8 }); }
    k.box(white, 1.22, .075, 1.44, 0, 1.51, -.27, { bevel: .035 }); for (const sx of [-.42, .42]) { k.tube(chrome, [[sx, 1.55, -.9], [sx, 1.62, -.86], [sx, 1.62, .3], [sx, 1.55, .34]], .012, { seg: 6, tension: .1 }); } for (const sz of [-.8, -.25, .25]) k.cyl(chrome, .01, .01, .84, 0, 1.62, sz, { rz: HP, seg: 6 });
    /* roof cargo: a crate of cabbages, a folding stool, a bundle tied with red string */
    k.box(col('plastic_grey', 0x3f7fb5, .7), .5, .2, .36, -.12, 1.73, -.55, { bevel: .02 }); for (let i = 0; i < 4; i++) k.sphere(col('plastic_grey', 0x9fc76a, .9), .1, -.26 + (i % 2) * .26, 1.84, -.63 + (i >> 1) * .17, { seg: 9, seg2: 7, s: [1, .85, 1] });
    k.box(col('fabric_dark', 0x7a6a4a, 1), .34, .16, .5, .2, 1.71, .0, { bevel: .05 }); k.box(GT.mat('plastic_red'), .35, .012, .02, .2, 1.795, .0); k.box(GT.mat('plastic_red'), .02, .012, .51, .2, 1.795, .0);
    /* glass all round */
    const gl = GT.mat('glass_clear'); k.quad(gl, 1.06, .72, 0, 1.14, .485, { rx: -.3 }); k.quad(gl, 1.06, .64, 0, 1.14, -.955, { rx: .15, ry: PI }); for (const sx of [-.575, .575]) k.quad(gl, 1.5, .62, sx, 1.14, -.24, { ry: sx > 0 ? HP : -HP });
    /* a grille that wants to be expensive, a mascot, the crest and the brags */
    k.box(chrome, .52, .2, .03, 0, .56, 1.105, { bevel: .01 }); for (let i = 0; i < 7; i++) k.box(blk, .02, .16, .012, -.21 + i * .07, .56, 1.123); k.cyl(chrome, .012, .016, .07, 0, .92, 1.0, { seg: 8 }); k.sphere(chrome, .03, 0, .97, 1.0, { seg: 10, seg2: 8, s: [1, .8, 1.7] }); for (const sx of [-1, 1]) k.box(chrome, .07, .004, .035, sx * .045, .98, .99, { rz: sx * .5 });
    k.quad(paper(256, 128, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#1a1a1a'; c.beginPath(); c.ellipse(w / 2, h / 2, 120, 58, 0, 0, TAU); c.fill(); c.strokeStyle = '#e9c35a'; c.lineWidth = 7; c.beginPath(); c.ellipse(w / 2, h / 2, 112, 50, 0, 0, TAU); c.stroke(); c.fillStyle = '#f2d578'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'italic 900 62px ' + KAI; c.fillText('金马至尊', w / 2, h / 2 + 3, 196); }, { transparent: true, roughness: .35, metalness: .4 }), .3, .15, 0, .943, .8, { rx: -HP + .25 });
    k.quad(paper(512, 256, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,.93)'; c.fillRect(8, 8, w - 16, 116); c.fillStyle = '#c2251d'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '900 76px ' + HEI; c.fillText('越催越慢 再催熄火', w / 2, 68, w - 40); c.fillStyle = 'rgba(250,226,90,.95)'; c.fillRect(120, 140, w - 240, 100); c.fillStyle = '#14110e'; c.font = '900 62px ' + HEI; c.fillText('接孙专用', w / 2, 192, w - 280); }, { transparent: true }), .9, .45, 0, 1.13, -.965, { rx: .15, ry: PI });
    for (const sx of [-1, 1]) k.quad(paper(512, 128, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#fdf6e0'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'italic 900 78px ' + HEI; c.fillText('跑不快 · 至尊版', w / 2, 52, w - 20); c.font = '700 34px ' + HEI; c.fillStyle = '#fff'; c.fillText('V12 双涡轮（贴纸）', w / 2, 106, w - 60); }, { transparent: true }), .84, .21, sx * .618, .63, -.05, { ry: sx > 0 ? HP : -HP });
    k.quad(paper(256, 96, (c, w, h) => { c.fillStyle = '#f4f1e6'; c.fillRect(0, 0, w, h); c.strokeStyle = '#1d3f78'; c.lineWidth = 6; c.strokeRect(5, 5, w - 10, h - 10); c.fillStyle = '#1d3f78'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '900 56px ' + HEI; c.fillText(o.plate || '福8888', w / 2, h / 2 + 3, w - 24); }), .36, .135, 0, .62, -1.106, { ry: PI });
    /* cabin: bench with a bead cover, wheel, a red knot on the mirror */
    k.box('leather_tan', .9, .12, .44, 0, .56, -.2, { bevel: .04 }); k.box('leather_tan', .9, .5, .1, 0, .84, -.46, { bevel: .04, rx: -.12 }); k.box(col('wood_plank', 0xc79a5a, .5), .4, .014, .4, 0, .628, -.2); k.box(blk, 1.0, .16, .2, 0, .9, .5, { bevel: .04 });
    k.geo(blk, new T.TorusGeometry(.15, .016, 6, 20), { x: 0, y: .98, z: .33, rx: -.5 }); k.cyl(blk, .016, .016, .2, 0, .93, .41, { rx: HP - .5, seg: 6 }); k.box(GT.mat('plastic_red'), .05, .1, .012, 0, 1.3, .3, { rz: .1 }); k.cyl(GT.mat('plastic_red'), .003, .003, .1, 0, 1.4, .3, { seg: 4 });
    g.add(k.build());
    const wheels = [], steer = []; for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const wk = GT.kit(); wk.cyl('rubber', rw, rw, .13, 0, 0, 0, { rz: HP, seg: 18 }); wk.cyl(chrome, rw * .68, rw * .68, .135, 0, 0, 0, { rz: HP, seg: 14 }); for (let i = 0; i < 5; i++) wk.box(blk, .14, .022, rw * 1.1, 0, 0, 0, { rx: i * TAU / 10 }); const w = wk.build(), piv = new T.Group(); piv.position.set(sx * (W / 2 - .13), rw, sz * wb / 2); piv.add(w); g.add(piv); wheels.push(w); if (sz > 0) steer.push(piv); }
    const lm = { head: glowMat(.3, .26, .18), haz: glowMat(.2, .1, .02), tail: glowMat(.14, .01, .01) }, st = { head: 0, brake: 0, hazard: 0, left: 0, right: 0 }; let ph = 0;
    for (const sx of [-.42, .42]) { addMesh(g, new T.SphereGeometry(.095, 14, 10), lm.head, sx, .64, 1.075, { s: [1, 1, .42], cast: false }); addMesh(g, new T.TorusGeometry(.1, .015, 6, 18), chrome, sx, .64, 1.09); addMesh(g, GT.boxGeo(.1, .06, .04, .01), lm.haz, sx * 1.33, .5, 1.085, { cast: false }); addMesh(g, GT.boxGeo(.1, .06, .04, .01), lm.haz, sx * 1.33, .58, -1.1, { cast: false }); addMesh(g, GT.boxGeo(.09, .15, .03, .01), lm.tail, sx * 1.05, .68, -1.105, { cast: false }); }
    const seat = new T.Object3D(); seat.position.set(0, LDIMS.seatH, -.18); g.add(seat); for (const [n, x, y, z] of [['gripL', .14, .42, .5], ['gripR', -.14, .42, .5], ['footL', .14, -.36, .62], ['footR', -.14, -.36, .62]]) { const q = new T.Object3D(); q.position.set(x, y, z); seat.add(q); seat[n] = q; }
    const v = { group: g, kind: 'laotoule', dims: Object.assign({}, LDIMS, { eye: LDIMS.eye.slice() }), wheels, steer, seat, twoWheeler: false, lights: st, meshes: [], setStand() {}, lean() {},
      setLights(s) { Object.assign(st, s || {}); }, enterLabel: () => (LT.seated ? '老头乐 · 把大爷请下车' : '开老头乐'),
      update(dt) { ph += dt || 0; const bl = (st.hazard || st.left || st.right) && (ph * 2.6) % 1 < .5; lm.head.color.setRGB(1, .9, .7).multiplyScalar(st.head ? 7 : .28); lm.haz.color.setRGB(1, .5, .06).multiplyScalar(bl ? 6.5 : .12); lm.tail.color.setRGB(1, .05, .03).multiplyScalar(st.brake ? 6 : st.head ? 1.5 : .13); } };
    v.update(0); return v; }
  /* the kind is registered by wrapping make(): js/cnvehicles.js itself is not touched */
  if (GT.cnvehicles && GT.cnvehicles.make && !GT.cnvehicles._street) { const mk0 = GT.cnvehicles.make; GT.cnvehicles.make = (kind, o) => (kind !== 'laotoule' ? mk0(kind, o) : (GT.cnvehicles.kinds || []).includes('laotoule') ? Object.assign(mk0(kind, o), { enterLabel: () => (LT.seated ? '老头乐 · 把大爷请下车' : '开老头乐') }) : makeLao(o));   /* js/cnvehicles.js builds the 老头乐 itself since round b4; makeLao stays as the fallback */ GT.cnvehicles._street = true; }
  const ltlGang = e => !!(e && (e.gang || /gang|thug|tail|loan|debt/.test(String(e.tag || ''))));
  function ltlSpawn() { const g = S.game, pz = clamp(P.z + (P.z > 0 ? -1 : 1) * 85, -110, 110); LT.dir = rnd() < .5 ? 1 : -1; LT.lane = pick([-6.6, -4.9, -2, 2, 4.9, 6.6]); LT.side = LT.lane < 0 ? -1 : 1; LT.jamT = LT.tightT = LT.squeezeT = LT.slowT = LT.stallT = LT.blockT = LT.stuckT = 0; LT.col = (LT.col + 1) % LTCOL.length;   /* real lane centres of js/cnroad.js (2.0 / 4.9 / bike 6.6); never 0, which is the median rail */
    const e = safe(() => g.spawnVehicle('laotoule', LT.lane, pz, LT.dir > 0 ? 0 : PI, { mode: 'scripted', color: LTCOL[LT.col], tag: 'laotoule', plate: '福8888', owner: 'npc', opts: { plate: '福8888' } }), null); if (!e) { LT.spawnT = 30; return; } if (e.kind !== 'laotoule') { safe(() => g.removeVehicle(e)); S.bad.ltl = 9; if (window.console) console.warn('[street] js/cngame.js has no laotoule row (DIMS / SPECS): the mobility car is off'); return; }
    LT.ent = e; e.cruise = 5.2; e.lights.hazard = true; LT.ph = 'cruise'; LT.t = 0; LT.laneT = 6; LT.uT = 18 + rnd() * 20; LT.lie = null; LT.out = null; LT.seated = true; spot('ltl', '老头乐 · 大马路上到处走 (位置实时)', e.x, e.z);
    if (S.visual && GT.people && GT.people.make && e.veh.group) { const f = safe(() => GT.people.make('uncle', { seed: 6, phone: false }), null); if (f && f.group) { LT.drv = f; ltlSeat(); } } }
  /* a.held: this is called from the walker's own arrival callback inside actorStep(), which then went on to write the walker's WORLD position into the figure, by now a child of the car: the driver ended up tens of metres from his seat */
  function ltlSeat() { const f = LT.drv, e = LT.ent, a = LT.out; if (a) { a.held = true; a.wp = null; } LT.out = null; LT.seated = true; if (!f || !e || !e.veh.group) return; if (f.group.parent !== e.veh.group) { if (f.group.parent) f.group.parent.remove(f.group); e.veh.group.add(f.group); } f.group.position.set(0, LT.seatY + .1 - .9, -.16); f.group.rotation.set(0, 0, 0); f.group.visible = true; }
  /** nothing parked, driving or built on this spot (a man can lie here and be seen) */
  function ltlClear(x, z) { for (const q of S.G.ents) { if (!q.alive || !q.dims) continue; const f = sin(q.h), c = cos(q.h), dx = x - q.x, dz = z - q.z; if (abs(dx * f + dz * c) < q.dims.L / 2 + .8 && abs(dx * c - dz * f) < q.dims.W / 2 + .8) return false; } return abs(x) < 7.3 && !blocked(x - .3, z - .3, x + .3, z + .3, gY(x, z, .5)); }
  /** the player leans on the horn behind him: once = he slows to a crawl, again within nine seconds = he stalls. Exactly what the sticker on his rear window promises. */
  function ltlHonked(by) { const e = LT.ent; if (!e || LT.ph !== 'cruise' || !by || by === e || by !== P.ent || hyp(by.x - e.x, by.z - e.z) > 18) return; const again = S.t - LT.hornAt < 9 && LT.slowT > 0; LT.hornAt = S.t;
    if (again && LT.stallT <= 0) { LT.stallT = 3.4; LT.slowT = 10; bark('ltl.stall', 0, true); sfx('thunk'); } else if (LT.stallT <= 0) { LT.slowT = 8; bark('ltl.honk', 0, true); later(.7, () => { if (LT.ent === e) sfx('horn', { dur: .45, g: .45 }); }, 'ltl'); } }
  /** js/cngame.js builds the shared first-person cockpit the first time any car is entered (a third of a second of geometry): build it while the loading screen is still up instead */
  function cockpitWarm() { const G = S.G; if (!G || !S.visual || G.cockpit || (G.bad && G.bad.cockpit) || !(GT.cockpit && GT.cockpit.build)) return; const ck = safe(() => GT.cockpit.build(), null); if (!ck || !ck.group) return;
    const ey = ck.eye; ck.eyeV = ey ? (Array.isArray(ey) ? new T.Vector3(ey[0], ey[1], ey[2]) : new T.Vector3(ey.x, ey.y, ey.z)) : new T.Vector3(.37, 1.08, -.3); if (!ck.update) ck.update = () => {}; ck.group.userData.keepIndoor = false; ck.group.visible = false; G.cockpit = ck; }
  function ltlStepOut(x, z, h) { const f = LT.drv, e = LT.ent; if (!e) return null; const a = { type: 'uncle', fig: f, group: f ? f.group : null, x, z, y: undefined, dy: 0, rx: 0, h, state: 'idle', speed: 0, vis: true, wp: null, spd: .8, then: null, far: 90, held: false,
      goTo(pts, spd, then) { a.wp = (Array.isArray(pts[0]) ? pts : [pts]).map(p => ({ x: p[0], z: p[1] })); a.spd = spd || .8; a.then = then || null; return a; }, face(x2, z2, dt) { a.h += angDiff(a.h, Math.atan2(x2 - a.x, z2 - a.z)) * min(1, (dt || 1) * 6); return a; } };
    if (f && f.group) { if (f.group.parent) f.group.parent.remove(f.group); S.root.add(f.group); } LT.out = a; LT.seated = false; return a; }
  function ltlRemove() { const e = LT.ent; if (LT.drv && LT.drv.group && LT.drv.group.parent) LT.drv.group.parent.remove(LT.drv.group); LT.drv = null; LT.out = null; LT.lie = null; LT.seated = false; if (e && e !== P.ent) safe(() => S.game.removeVehicle(e)); LT.ent = null; LT.ph = 'off'; LT.spawnT = 6; if (GT.act && GT.act.remove) GT.act.remove('st:ltl:pay'); }
  /** while 钱大爷 is stopped the player's vehicle is kept a hand's width clear of his car: the scooter's collision circle sits at its saddle, so after a rear-end shunt its front half (and the first-person camera) stood inside his cabin. Returns the metres moved. */
  function ltlKeepOut(o) { const e = LT.ent; if (!e || !o || o === e || !o.dims || !e.dims) return 0; const se = sin(e.h), ce = cos(e.h), dx = o.x - e.x, dz = o.z - e.z, lx = dx * ce - dz * se, lz = dx * se + dz * ce, dh = o.h - e.h, ca = abs(cos(dh)), sa = abs(sin(dh)), oL = o.dims.L / 2, oW = o.dims.W / 2;
    const pz = e.dims.L / 2 + ca * oL + sa * oW + .3 - abs(lz), px = e.dims.W / 2 + sa * oL + ca * oW + .25 - abs(lx); if (px <= 0 || pz <= 0) return 0; let mx, mz, d; if (pz <= px) { const k = lz >= 0 ? 1 : -1; d = min(pz, 2.4); mx = se * k; mz = ce * k; } else { const k = lx >= 0 ? 1 : -1; d = min(px, 2.4); mx = ce * k; mz = -se * k; }
    o.x += mx * d; o.z += mz * d; if ((sin(o.h) * mx + cos(o.h) * mz) * (o.v || 0) < 0) { o.v = 0; if (o.c && isFinite(o.c.vx)) o.c.vx = 0; } return d; }
  /** something ran into the car. The player or a gang vehicle gets the full performance; ordinary traffic gets shouted at. */
  function ltlHit(o, vn, isPlayer) { const e = LT.ent; if (!e || LT.ph !== 'cruise' || !o || (LT.hitCd > 0 && (isPlayer || ltlGang(o)))) return false; const gang = !isPlayer && ltlGang(o);
    /* ordinary traffic brushing him is not a hit: it gets shouted at on its own short timer and never eats the 22 s cooldown of the full performance (a player ram just after a taxi's nudge used to be ignored) */
    if (!isPlayer && !gang) { if (S.t > (LT.nudgeT || 0)) { LT.nudgeT = S.t + 6; ST.ltl.nudges = (ST.ltl.nudges || 0) + 1; if (distP(e.x, e.z) < 40) bark('ltl.honk', 5); } return false; }
    LT.hitCd = 22; ST.ltl.hits++;
    LT.ph = 'lie'; LT.t = 0; e.v = 0; if (isPlayer) ST.ltl.pushed = +ltlKeepOut(o).toFixed(2); const fo = sin(o.h), co = cos(o.h), hl = o.dims.L / 2, ex = e.x + cos(e.h) * 1.1, ez = e.z - sin(e.h) * 1.1, sg = (ex - o.x) * co - (ez - o.z) * fo >= 0 ? 1 : -1;
    /* where he lies down: in front of whoever hit him if that is open road; after a rear-end shunt that spot is inside his own car, so then beside it, ahead and to one side of the hitter (30 degrees off the nose,
       his door side first), where the driver sees him through the windscreen */
    let fx = o.x + fo * (hl + .7) + co * sg * 2.1, fz = o.z + co * (hl + .7) - fo * sg * 2.1; for (const q of [[hl + 1.5, 0], [hl + 1.8, sg * 1.85], [hl + 1.8, -sg * 1.85], [hl + .7, sg * 2.1], [hl + .7, -sg * 2.1], [hl + 3.4, sg * 1.9], [hl + 3.4, -sg * 1.9]]) { const x = o.x + fo * q[0] + co * q[1], z = o.z + co * q[0] - fo * q[1]; if (ltlClear(x, z)) { fx = x; fz = z; break; } }
    const a = ltlStepOut(ex, ez, e.h);
    LT.lie = { by: o, player: !!isPlayer, gang, st: 'walk', t: 0, paid: false, x: fx, z: fz }; a.goTo([[fx, fz]], .85, () => { a.state = 'fake_fall'; a.h = o.h + PI; LT.lie.st = 'down'; LT.lie.t = 0; if (isPlayer) toast('钱大爷躺下了', 'E 赔 $200 营养费 · 不赔，半分钟后他报警察 · 跑了罚得更重'); });
    if (distP(e.x, e.z) < 50) convo('ltl.hit', 2.8);
    if (isPlayer) addSpot({ id: 'st:ltl:pay', x: fx, z: fz, r: 7, mode: 'both',   /* wide enough to reach from the saddle wherever the vehicle stopped (it was 3.2 m round him: 15 cm out of reach of a rider who had not moved) */ label: '赔 $200 营养费', enabled: () => !!(LT.lie && LT.lie.player && !LT.lie.paid && LT.lie.st === 'down'), onUse: () => ltlPay() });
    return true; }
  function ltlPay() { const l = LT.lie; if (!l || l.paid || !l.player) return false; const W = GT.wallet; if (!(W && W.spend && W.spend(200))) { toast('钱不够', '大爷不起来'); sfx('ui_bad'); return false; } l.paid = true; SV.ltl.paid++; ST.ltl.paid = SV.ltl.paid; save(); cancel('ltl'); bark('ltl.paid', 0, true); toast('营养费', '−$200'); sfx('cash'); ltlUp(1.2); return true; }
  function ltlUp(delay) { const l = LT.lie, a = LT.out, e = LT.ent; if (!l || l.st === 'up' || !a || !e) return; l.st = 'up'; later(delay || 0, () => { if (LT.out !== a || !LT.ent) return; a.state = 'idle'; a.goTo([[LT.ent.x + cos(LT.ent.h) * 1.1, LT.ent.z - sin(LT.ent.h) * 1.1]], 1.0, () => { ltlSeat(); LT.lie = null; LT.ph = 'cruise'; LT.laneT = 2; if (GT.act && GT.act.remove) GT.act.remove('st:ltl:pay'); }); }); }
  function ltlStolen() { const e = LT.ent; if (!e) return; LT.ph = 'stolen'; LT.t = 0; SV.ltl.stolen++; ST.ltl.stolen = SV.ltl.stolen; save(); cancel('ltl'); if (LT.lie) { LT.lie = null; if (GT.act && GT.act.remove) GT.act.remove('st:ltl:pay'); }
    if (LT.seated) { const a = ltlStepOut(e.x + cos(e.h) * 1.5, e.z - sin(e.h) * 1.5, e.h - HP); a.state = 'scold'; a.spd = 3; convo('ltl.stolen', 2.6); safe(() => S.game.wanted.add({ stars: .6, fine: 300, label: '强占老头乐' })); }
    later(6, () => { if (LT.ph === 'stolen') bark('ltl.kai', 0, true); }); if (SV.ltl.stolen === 1) safe(() => S.game.ui.achievement('降维打击护甲')); }
  function ltlStep(dt) {
    const g = S.game, G = S.G, e = LT.ent; LT.hitCd = max(0, LT.hitCd - dt); LT.t += dt;
    if (!S.free) { if (e && e !== P.ent) ltlRemove(); return; }
    if (!e || !e.alive) { if (e && !e.alive) { LT.ent = null; LT.ph = 'off'; if (LT.drv && LT.drv.group && LT.drv.group.parent) LT.drv.group.parent.remove(LT.drv.group); LT.drv = null; LT.out = null; } LT.spawnT -= dt; if (LT.spawnT <= 0) ltlSpawn(); return; }
    const sp = SPOTS.find(q => q.id === 'ltl'); if (sp) { sp.x = +e.x.toFixed(1); sp.z = +e.z.toFixed(1); } ST.ltl.x = e.x; ST.ltl.z = e.z; const dP = distP(e.x, e.z), sim = g.sim, a = LT.out;
    if (a) { actorStep(a, dt); }
    if (LT.ph === 'lie' && P.ent && P.ent !== e && dP < 8) ltlKeepOut(P.ent);
    else if (LT.drv) { const dg = LT.drv.group; if (LT.seated && (dg.parent !== e.veh.group || dg.position.x !== 0 || dg.position.z !== -.16)) ltlSeat();   /* in his seat, whatever else moved him */
      if (dP < 60 && !LT.drvBad) { try { LT.drv.update(dt, { state: 'drive', speed: abs(e.v), steer: e.steer }); } catch (err) { LT.drvBad = true; } } }
    if (LT.ph === 'cruise') {
      /* he keeps to his own side of the median rail (it only opens at the junctions) and wanders over its three lanes, against the traffic after every other U-turn */
      const LANES = LT.side < 0 ? [-6.6, -4.9, -2] : [2, 4.9, 6.6];
      LT.laneT -= dt; LT.uT -= dt; LT.slowT = max(0, LT.slowT - dt); if (LT.laneT <= 0) { LT.laneT = 6 + rnd() * 9; LT.lane = pick(LANES); }
      /* no change of mind on a zebra crossing or under the wheels of the player: the turn waits until he is 16 m clear of both crossings and the player's vehicle is not within 26 m (he used to swing round on the z -8 crossing in front of a scooter on every pass) */ if (LT.uT <= 0 && ([-8, 62].some(z => abs(e.z - z) < 16) || (!onFoot() && dP < 26))) LT.uT = 2.5;
      if (LT.uT <= 0 || (LT.dir > 0 ? e.z > 116 : e.z < -116)) { LT.uT = 22 + rnd() * 26; LT.dir = -LT.dir; LT.lane = LANES[1]; LT.laneT = 6; if (dP < 24 && P.x > -11.5 && P.x < 15.5) bark('ltl.uturn', 18);   /* only for someone on the avenue itself: at 32 m the line also played to a player standing in the wharf gate */ }
      let vT = LT.slowT > 0 ? 2.2 : 5.2, blk = false, tight = false, ped = false, obsX = 0, rear = true; const f = sin(e.h), c = cos(e.h), hl = e.dims.L / 2;
      for (const o of G.ents) { if (o === e || !o.alive || !o.dims) continue; const dx = o.x - e.x, dz = o.z - e.z; if (abs(dx) + abs(dz) > 20) continue; const fz = dx * f + dz * c, lat = abs(dx * c - dz * f), ol = min(o.dims.L, 12) / 2;
        if (lat < 1.35 + o.dims.W * .3) { const gap = fz - hl - ol; if (fz > .5 && gap < 5.5) { blk = true; obsX = o.x; if (gap < .9) { vT = 0; tight = true; } else vT = min(vT, gap < 2.6 ? 1.5 : 2.8); } else if (fz < -.5 && -fz - hl - ol < 3.2) rear = false; }
        if (o.mode !== 'parked' && o !== P.ent) { const rr = (min(o.dims.L, 5) + e.dims.L) * .3 + .3; if (dx * dx + dz * dz < rr * rr && hyp(sin(o.h) * o.v - f * e.v, cos(o.h) * o.v - c * e.v) > 2.6) { ltlHit(o, 3, false); if (LT.ph !== 'cruise') return; } } }
      if (onFoot()) { const dx = P.x - e.x, dz = P.z - e.z, fz = dx * f + dz * c; if (fz > .4 && fz < 5.5 && abs(dx * c - dz * f) < 1.25) { vT = 0; blk = tight = ped = true; obsX = P.x; if (S.t > LT.honkT) { LT.honkT = S.t + 7; sfx('horn', { dur: .35, g: .5 }); bark('ltl.honk', 6); } } }
      if (LT.stallT > 0) { LT.stallT -= dt; vT = 0; blk = tight = false; }   /* 再催熄火 */
      const still = abs(e.v) < .3, far = LANES.slice().sort((p, q) => abs(q - obsX) - abs(p - obsX))[0];
      /* something ahead: make for the lane furthest from it and creep round (the old code stopped dead 4 m short and waited for ever, face to face with a taxi that was waiting for him) */
      if (blk) { LT.blockT += dt; if (LT.blockT > 1.2) { LT.blockT = 0; LT.lane = far; LT.laneT = 7; } } else LT.blockT = 0;
      /* nose to nose: back off a length and swing out; boxed in from behind as well, then squeeze through at a crawl. A pedestrian gets six seconds of horn first. */
      if (tight && still && !(e.revT > 0)) { LT.tightT += dt; if (LT.tightT > (ped ? 6 : 1.6)) { LT.tightT = 0; LT.lane = far; LT.laneT = 7; if (rear) e.revT = 1.5; else LT.squeezeT = 2.5; } } else if (!tight) LT.tightT = 0;
      if (LT.squeezeT > 0) { LT.squeezeT -= dt; if (!ped && LT.stallT <= 0) vT = max(vT, .9); }
      /* still not moving after a quarter of a minute of that: out of sight he is put back on the road somewhere else, in sight he turns round and leaves the way he came */
      if (blk && still) LT.jamT += dt; else if (!blk && !still) LT.jamT = 0;
      if (LT.jamT > 14) { if (dP > 40) { ltlRemove(); return; } LT.jamT = 7; LT.dir = -LT.dir; LT.uT = 30; LT.lane = far; LT.laneT = 7; if (rear) e.revT = 1.5; }
      if (still && vT > 1 && !(e.revT > 0)) { LT.stuckT += dt; if (LT.stuckT > 2.5) { LT.stuckT = 0; e.revT = 1.3; LT.lane = LANES[1]; LT.laneT = 6; } } else LT.stuckT = 0;
      if (dP < 260) { safe(() => { sim.aiDrive(e, LT.lane, e.z + LT.dir * 9, vT, dt); sim.aiCollideWorld(e); }); e.x = LT.side < 0 ? clamp(e.x, -7.2, -.85) : clamp(e.x, .85, 7.2); e.y = damp(e.y, gY(e.x, e.z, 0), 12, dt); }
      e.lights.hazard = true; e.lights.head = night(); e.lights.brake = !!e.brakeOn; e.veh.locked = abs(e.v) > 2.4; ST.ltl.wrongWay = LT.lane * LT.dir > 0; ST.ltl.jam = +LT.jamT.toFixed(1);
    } else if (LT.ph === 'lie') { const l = LT.lie; e.v *= Math.exp(-6 * dt); e.lights.hazard = true; e.lights.brake = true; e.veh.locked = true; if (!l) { LT.ph = 'cruise'; return; } l.t += dt;
      if (l.st === 'down') { if (a) a.state = l.t > 2.2 ? 'demand' : 'fake_fall';
        if (l.gang) { if (!l.fled && l.t > 2.6) { l.fled = true; const o = l.by; if (o && o.alive) { o.mode = 'parked'; o.v = 0; const i = G.traffic.indexOf(o); if (i >= 0) G.traffic.splice(i, 1); const r = safe(() => g.spawnNPC('thug', o.x + cos(o.h) * 1.4, o.z - sin(o.h) * 1.4, { seed: 7 }), null); if (r && r.goTo) r.goTo([[o.x + cos(o.h) * 9 - sin(o.h) * 26, o.z - sin(o.h) * 9 - cos(o.h) * 26]], 4.6, n => n.remove && n.remove()); } ST.ltl.gangFled++; if (dP < 50) bark('ltl.gang', 0, true); } if (l.t > 12) ltlUp(0); }
        else if (!l.paid) { if (dP > 28) { l.paid = true; cancel('ltl'); safe(() => g.wanted.add({ stars: .8, fine: 500, label: '撞老头乐逃逸' })); bark('ltl.run', 0, true); ltlUp(4); } else if (l.t > 30) { l.paid = true; cancel('ltl'); bark('ltl.wait', 0, true); SV.ltl.unpaid = (SV.ltl.unpaid || 0) + 1; ST.ltl.unpaid = SV.ltl.unpaid; save(); safe(() => g.wanted.add({ stars: .5, fine: 300, label: '撞老头乐拒不赔偿' })); toast('大爷报了警察', '撞人不赔 · 罚单 $300 · 通缉上升'); sfx('ui_bad'); ltlUp(1.5); }   /* standing there without paying is an answer too: he phones it in, then gets up */ } }
      else if (l.st === 'walk' && l.t > 20 && a) { a.wp = null; a.state = 'fake_fall'; l.st = 'down'; l.t = 0; }
    } else if (LT.ph === 'stolen') { const mine = P.ent === e;
      if (mine) { const C = e.c; if (C) { if (C.vx > 9.72) C.vx = 9.72; if (C.vx < -3) C.vx = -3; } e.lights.hazard = true;
        for (const k of G.cops) { const d = hyp(k.x - e.x, k.z - e.z); if (d < 12) { const cap = max(2, abs(e.v) * .9); if (k.v > cap) k.v = max(cap, k.v - 30 * dt); if (S.t > LT.copT && d < 9 && stars() > 0) { LT.copT = S.t + 30; bark('ltl.cop', 20); } } } }
      if (a) { if (LT.t < 7 && dP > 2.5 && dP < 30) { a.state = 'run'; a.speed = 3; a.x += (e.x - a.x) / dP * 3 * dt; a.z += (e.z - a.z) / dP * 3 * dt; a.face(e.x, e.z, dt); } else a.state = LT.t < 12 ? 'scold' : 'shrug'; }
      if (!mine) { LT.respT += dt; if ((LT.respT > 40 && dP > 60) || LT.respT > 240) { LT.respT = 0; ltlRemove(); } } else LT.respT = 0; }
  }

  /* ================================================================== 5. 相亲角情报 */
  const CARDS = [
    { t: '男 1991年 属羊', l: ['身高176 大专', '小吃街个体 · 热干面', '有铺面 起得早', '觅：不嫌面馆油烟的'] },
    { t: '男 33岁 属虎', l: ['自述"物流行业中层"', '手下二十来号人 夜班多', '年入五十万 现金为主', '觅：不问收入来源的姑娘'], clue: 'ertong', who: '二筒', note: '码头夜班、二十来号人、只收现金——这是二筒。他的人夜里都在码头。' },
    { t: '女 1996年 属鼠', l: ['身高162 本科', '小学美术老师', '会包饺子 怕狗', '觅：有耐心 情绪稳定'] },
    { t: '女 29岁', l: ['洋行财务 经手账目多', '谨慎 换过三个手机号', '有驾照 不爱拍照', '觅：嘴严的老实人'], clue: 'ledger', who: '洋行会计', note: '换三个号码的会计：爷叔的洋行有两本账，她知道第二本在哪。' },
    { t: '男 1988年 属龙', l: ['身高174 退伍', '轻轨司机 作息规律', '话少 会修家电', '觅：不嫌我倒班的'] },
    { t: '男 41岁', l: ['信贷公司"客户回访专员"', '工作时间：深夜', '自备面包车 球棒若干', '觅：胆子大的'], clue: 'loan', who: '催收队', note: '信贷公司的"回访专员"夜里开面包车出门。晚上看见那台车，绕着走。' },
    { t: '女 1994年 属狗', l: ['身高165 硕士', '社区医院药剂师', '爱爬山 作息早', '觅：不抽烟 能早起'] },
    { t: '男 36岁', l: ['小吃街个体 臭豆腐一绝', '另有五金方面的"副业"', '夜里出摊 只认熟人', '觅：不好奇摊子底下的'], clue: 'mange', who: '满哥', note: '臭豆腐、五金副业、摊子底下——满哥的货只在夜里卖给熟人。多吃几回他的豆腐。' },
    { t: '女 1998年 属虎', l: ['身高160 大专', '自己开花店', '爱笑 会记账', '觅：踏实 不赌'] },
    { t: '男 1993年 属鸡', l: ['身高181 本科', '写代码的 话少', '有猫两只 房贷一份', '母亲代征 本人不知情'] },
    { t: '女 52岁（代儿登记）', l: ['儿子在特警开车', '周三周日轮休', '老实 就是总加班', '觅：能等他下班的'], clue: 'patrol', who: '特警排班', note: '特警的司机周三、周日轮休——那两天街上的巡逻车少一台。' },
    { t: '男 1990年 属马', l: ['身高170 高中', '开出租 熟悉每条巷子', '夜班 收入稳', '觅：坐副驾不指路的'] },
    { t: '女 1992年 属猴', l: ['身高158 本科', '火锅店前厅经理', '能吃特辣 嗓门大', '觅：吃得了辣 扛得住骂'] },
    { t: '男 1995年 属猪', l: ['身高178 本科', '钟楼洋行保安', '站得直 认人准', '觅：本地 有共同语言'] },
    { t: '女 1997年 属牛', l: ['身高168 本科', '江滩舞蹈队领舞之女', '被母亲拉来的', '觅：先过我妈那关'] },
    { t: '男 68岁（本人）', l: ['冬泳队队长 身体硬朗', '退休金过得去', '会做一桌菜', '觅：敢下水的老伴'] }];
  const STASH = [{ id: 's1', n: '码头货场 · 东门里', cash: 420, pref: () => { const g = anchor('wharfGate', null), a = anchor('wharfYard', { x: -24, z: -129 }); return g ? [g.x - 6.4, g.z - 2.3] : [a.x - 3, a.z - 2.4]; } }   /* six metres inside the east gate, in sight from the street: the old spot sat behind the north fence and its marker led straight into the wire */, { id: 's2', n: '跨江大桥桥底', cash: 560, pref: () => [-33, 143.5] }, { id: 's3', n: '夜市东口', cash: 680, pref: () => { const a = anchor('marketEast', { x: 99, z: -62 }); return [a.x + 2.6, a.z + 1.8]; } }];
  const MC = { x: -22, z: -46, bx: -16.2, bz: -46, bh: -HP, gos: [], gx: 0, gz: 0, card: -1, open: false, openT: 0, ear: 0, hush: 0, cd: 0, talking: false, idleT: 8 };
  function matchBuild() {
    const m = anchor('matchCorner', null); if (m) { MC.x = m.x; MC.z = m.z; } const f = fit(MC.x + 6.2, MC.z + .4, .35, 1.9); MC.bx = f.x; MC.bz = f.z; MC.bh = -HP; const rd = [MC.bx + sin(MC.bh) * 1.35, MC.bz + cos(MC.bh) * 1.35];
    spot('match', '相亲角 · 信息栏 (E 看启事)', rd[0], rd[1]); const gf = fit(MC.bx - 1.4, MC.bz + 4.9, .7, 1.3); MC.gx = gf.x; MC.gz = gf.z; spot('gossip', '相亲角 · 胡阿姨和老蔡 (走近偷听, 8:00–18:30)', MC.gx, MC.gz);
    MC.gos.push(actor('match_parent', MC.gx, MC.gz - .68, 0, { seed: 1, state: 'flyer', seat: .32, opts: { seat: .32 } })); MC.gos.push(actor('match_parent', MC.gx, MC.gz + .68, PI, { seed: 5, state: 'flyer', seat: .32, opts: { seat: .32 } }));
    STASH.forEach((s, i) => { const p = s.pref(), q = fit(p[0], p[1], .45, .4); s.x = q.x; s.z = q.z; s.y = gY(s.x, s.z, 1); spot('stash' + (i + 1), '藏货点 ' + (i + 1) + ' · ' + s.n + ' (偷听后才能撬)', s.x, s.z);
      addSpot({ id: 'st:stash:' + s.id, x: s.x, z: s.z, r: 1.8, hold: 1.3, label: '撬开泡沫箱', enabled: () => SV.match.stash[s.id] === 'open' && onFoot(), onUse: () => stashOpen(s) }); });
    addSpot({ id: 'st:match:read', x: rd[0], z: rd[1], r: 2.3, label: () => (MC.open ? '下一张' : '看信息栏'), enabled: () => onFoot(), onUse: () => matchRead() });
    if (!S.visual) return;
    const k = GT.kit(), dred = col('wood_painted', 0x7a2318, .7), x = MC.bx, z = MC.bz, y = gY(x, z, 1);
    /* a roofed notice screen: two posts, a tiled cap, a cork board crowded with cards; the board faces -x (toward the umbrellas) */
    for (const s of [-1.72, 1.72]) { k.box(dred, .14, 2.5, .14, x, y + 1.25, z + s, { bevel: .02 }); k.cyl('concrete', .16, .2, .16, x, y + .08, z + s, { seg: 10 }); }
    k.box(dred, .1, .12, 3.7, x, y + 2.3, z, { bevel: .02 }); k.box(GT.mat('roof_tile_clay'), .78, .07, 4.0, x - .05, y + 2.52, z, { rz: -.3, bevel: .015 }); k.box(GT.mat('roof_tile_clay'), .5, .07, 4.0, x + .28, y + 2.5, z, { rz: .42, bevel: .015 }); k.cyl(dred, .06, .06, 4.02, x + .08, y + 2.64, z, { rx: HP, seg: 8 });
    k.box(dred, .08, .08, 3.3, x, y + 2.22, z); safe(() => matchSheets(k, x, y, z));
    /* strings of paper hearts between the posts and a donation-style tin for pens */
    k.tube('rubber', [[x - .1, y + 2.2, z - 1.7], [x - .12, y + 2.06, z], [x - .1, y + 2.2, z + 1.7]], .004, { seg: 4, steps: 14 }); for (let i = 0; i < 9; i++) { const zz = z - 1.4 + i * .35, sag = y + 2.2 - .14 * (1 - Math.pow((zz - z) / 1.7, 2)); k.box(col('plastic_red', i % 2 ? 0xd8283a : 0xf08aa0, .8), .004, .1, .1, x - .12, sag - .08, zz, { rx: PI / 4 }); }
    k.cyl(col('metal_painted_red', 0x2a6b4a, .5), .05, .05, .13, x - .1, y + .73, z + 1.2, { seg: 12 }); for (let i = 0; i < 3; i++) k.cyl(col('plastic_grey', [0x1d3f78, 0xc2251d, 0x16181c][i], .5), .005, .005, .15, x - .1 + (i - 1) * .015, y + .83, z + 1.2 + (i - 1) * .012, { seg: 5, rz: (i - 1) * .15 });
    S.root.add(k.build()); GT.world.addBox(x - .12, z - 1.82, x + .12, z + 1.82, y + 2.5, 'street:board');
    /* the three foam boxes */
    for (const s of STASH) { const b = GT.kit(); b.box(col('plastic_white', 0xe9e7df, 1), .62, .34, .42, 0, .17, 0, { bevel: .03 }); for (const sx of [-.2, .2]) b.box(col('plastic_grey', 0xb08a4a, .6), .05, .345, .43, sx, .17, 0); b.quad(paper(256, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#1d3f78'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 64px ' + KAI; g.fillText('海鲜 勿动', w / 2, h / 2, w - 20); }, { transparent: true }), .4, .2, 0, .19, .212);
      const grp = b.build(), lid = GT.kit(); lid.box(col('plastic_grey', 0x2f6fb5, .8), .66, .07, .46, 0, .035, .23, { bevel: .02 }); const lg = lid.build(); lg.position.set(0, .34, -.23); grp.add(lg); grp.position.set(s.x, s.y, s.z); grp.rotation.y = (s.x * 7 + s.z) % 6; S.root.add(grp); s.grp = grp; s.lid = lg; if (SV.match.stash[s.id] === 'done') lg.rotation.x = -1.9; }
  }
  function stashMark(s) { if (s.mark || !S.visual) return; s.mark = safe(() => S.game.marker(s.x, s.z, '藏货点 · ' + s.n, { color: '#5fe0c8', r: 2.4 }), null); }
  function stashUnlock(id) { const s = STASH.find(q => q.id === id); if (!s || SV.match.stash[id]) return false; SV.match.stash[id] = 'open'; save(); stashCount(); stashMark(s); toast('藏货点已标记', s.n); sfx('ui_ok'); return true; }
  function stashOpen(s) { if (SV.match.stash[s.id] !== 'open') return false; SV.match.stash[s.id] = 'done'; save(); stashCount(); if (s.mark && s.mark.remove) safe(() => s.mark.remove()); s.mark = null; s.opening = .001; if (GT.wallet && GT.wallet.add) GT.wallet.add(s.cash, 'stash'); toast('藏货 · ' + s.n, '+$' + s.cash); sfx('cash');
    if (STASH.every(q => SV.match.stash[q.id] === 'done')) safe(() => S.game.ui.achievement('街道办情报科')); return true; }
  function matchRead() { MC.card = (MC.card + 1) % CARDS.length; const c = CARDS[MC.card]; MC.open = true; MC.openT = 0; ST.match.card = MC.card; SV.match.cards[MC.card] = 1; sfx('ui_tick');
    const E = UI.el.card; if (E) { E.querySelector('h4').textContent = c.t; E.querySelector('.st-cl').innerHTML = c.l.map(() => '<p></p>').join(''); c.l.forEach((t, i) => { E.querySelector('.st-cl').children[i].textContent = t; }); E.querySelector('q').textContent = c.note || ''; E.classList.toggle('clue', !!c.clue); E.classList.remove('on'); void E.offsetWidth; E.classList.add('on'); }
    if (c.clue && !SV.match.clues[c.clue]) { SV.match.clues[c.clue] = 1; const n = Object.keys(SV.match.clues).length; ST.match.clues = n; toast('线索 · ' + c.who, n + ' / 5'); sfx('ui_ok'); if (c.clue === 'mange' && GT.shops && GT.shops.trust) safe(() => GT.shops.trust(.5));
      if (n >= 5) { safe(() => S.game.ui.achievement('父母之心，情报之源')); if (GT.wallet && GT.wallet.add) GT.wallet.add(200, 'clues'); toast('五条线索集齐', '满哥托人带来 $200 茶水费'); } }
    save(); return c; }
  function matchListen(force) { if (MC.talking) return false; const next = STASH.find(s => !SV.match.stash[s.id]), sec = next ? 'match.g' + (STASH.indexOf(next) + 1) : 'match.g0'; MC.talking = true; MC.ear = 0; uiOn('ear', false); SV.match.heard++; save();
    convo(sec, 3.5, () => { MC.talking = false; MC.cd = next ? 120 : 200; if (next) { stashUnlock(next.id); later(1.6, () => bark('match.kai', 0, true)); } }); return true; }
  function matchStep(dt) {
    const hr = hours(), here = hr >= 8 && hr < 18.5, d = distP(MC.gx, MC.gz); MC.cd = max(0, MC.cd - dt); stashCount(); if (MC.talking && S.G && typeof S.G.time === 'number') S.G.barkT = S.G.time;   /* js/cngame.js onBark: the passers-by do not talk over the gossip */ for (const s of STASH) { if (s.opening && s.lid) { s.opening = min(1, s.opening + dt * 2.5); s.lid.rotation.x = -1.9 * sst(s.opening, 0, 1); if (s.opening >= 1) s.opening = 0; } }
    for (const a of MC.gos) { a.vis = here; a.speak = MC.talking ? 1 : undefined; actorStep(a, dt); }
    if (MC.open) { MC.openT += dt; if (MC.openT > 14 || distP(MC.bx, MC.bz) > 4.2 || !onFoot()) { MC.open = false; uiOn('card', false); } }
    if (!here || d > 30) { if (MC.ear) { MC.ear = 0; uiOn('ear', false); } ST.match.listening = 0; return; }
    if (MC.hush > 0) { MC.hush -= dt; ST.match.hush = MC.hush > 0; }
    if (MC.talking || !S.free) return;
    if (MC.hush <= 0 && d < 5.5 && onFoot() && P.speed > 4.7) {   /* running at them, not walking up (walk tops out at 3.7 m/s, a sprint is 6.3) */ MC.hush = 9; MC.ear = 0; ST.match.hush = true; uiOn('ear', false); bark('match.hush', 6); return; }
    const ok = MC.hush <= 0 && MC.cd <= 0 && d < 3.5 && onFoot() && P.speed < 2.3; MC.ear = ok ? min(1, MC.ear + dt / 5) : max(0, MC.ear - dt * .6); ST.match.listening = +MC.ear.toFixed(2); uiOn('ear', MC.ear > .02); uiVar('ear', '--p', MC.ear.toFixed(3));
    if (MC.ear >= 1) matchListen(); else if (!ok && d < 9 && d > 3.5) { MC.idleT -= dt; if (MC.idleT <= 0) { MC.idleT = 22; bark('match.idle', 18); } }
  }

  /* ================================================================== b4 霓虹江城 dressing of the five pieces (reports/refs/street.md D to G): nothing here changes a rule, a spot or an anchor.
     相亲角: A4 sheets in plastic sleeves on strings and on umbrellas laid along the path (boards 42 to 45) · 广场舞: tinted clothes, onlookers, bags along the kerb, three floods behind the formation (38 to 41) ·
     冬泳码头: tyres, stone steps and a rope, clothes heaps, one amber bulb, swimmers drifting past each towing a float (33 to 37) · 西瓜: a light truck with its side board dropped as a shelf and cut melons under film (47, 48). */
  const DR = { sheetM: null, floats: null, heads: null, caps: null, SW: [], pools: [], blob: null };
  const blobT = () => DR.blob || (DR.blob = tex(64, 64, (g, w, h) => { const r = g.createRadialGradient(32, 32, 1, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.4, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }));
  function sheetMat() { if (DR.sheetM) return DR.sheetM; const FILL = ['籍贯本地 独生', '工作稳定 五险一金', '有房一套 无贷', '父母退休 有医保', '性格随和 不抽烟', '爱好 做饭 钓鱼', '要求 年龄相仿', '学历 大专以上', '身高 一米六以上', '孝顺 顾家 踏实', '非诚勿扰 谢绝中介', '电话 家长面谈'];
    DR.sheetM = paper(1024, 1024, (g, w, h) => { g.fillStyle = '#d8d4c8'; g.fillRect(0, 0, w, h); for (let i = 0; i < 20; i++) { const cx = (i % 5) * 204 + 3, cy = (i >> 2 > 4 ? 4 : (i / 5 | 0)) * 256 + 3, cw = 198, ch = 250, c = CARDS[i % CARDS.length], hand = i % 4 === 3, pc = i % 7 === 2 ? '#f6c7cf' : i % 7 === 5 ? '#f4e39a' : i % 9 === 4 ? '#e9897c' : '#f7f5ee';
        g.save(); g.translate(cx, cy); g.fillStyle = pc; g.fillRect(0, 0, cw, ch); g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(0, ch - 40, cw, 40); g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillStyle = hand ? '#1d3f78' : '#b3201a'; g.font = '900 ' + (hand ? 26 : 22) + 'px ' + KAI; g.fillText(c.t, 10, 26, cw - 20); g.fillStyle = '#222'; g.fillRect(10, 44, cw - 20, 1.5);
        const lines = c.l.concat([FILL[i % 12], FILL[(i * 5 + 3) % 12], FILL[(i * 7 + 1) % 12], FILL[(i * 3 + 8) % 12], FILL[(i * 11 + 5) % 12], FILL[11]]); lines.forEach((t, j) => { g.fillStyle = j < c.l.length ? '#16161a' : '#3a3a40'; g.font = (j < c.l.length ? '700 ' : '500 ') + (hand ? 16 : 14) + 'px ' + (hand ? KAI : HEI); g.fillText(t, 10, 62 + j * 18.5, cw - (i % 3 === 1 ? 70 : 20)); });
        if (i % 3 === 1) { g.fillStyle = '#8c98a6'; g.fillRect(cw - 58, 52, 46, 58); g.fillStyle = '#d8b090'; g.beginPath(); g.arc(cw - 35, 74, 11, 0, TAU); g.fill(); g.fillStyle = '#2a2a34'; g.fillRect(cw - 50, 90, 30, 20); }
        if (c.clue) { g.strokeStyle = '#c2251d'; g.lineWidth = 2.5; g.beginPath(); g.ellipse(cw / 2 - 8, 62 + 18.5 * 1, cw / 2 - 12, 13, -.04, 0, TAU); g.stroke(); g.beginPath(); g.ellipse(cw / 2 - 6, 62 + 18.5 * 2, cw / 2 - 16, 12, .03, .3, TAU + .2); g.stroke(); }
        const gl = g.createLinearGradient(0, 0, cw, ch); gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(.4, 'rgba(255,255,255,0)'); gl.addColorStop(.47, 'rgba(255,255,255,.5)'); gl.addColorStop(.53, 'rgba(255,255,255,.05)'); gl.addColorStop(.7, 'rgba(255,255,255,.28)'); gl.addColorStop(.74, 'rgba(255,255,255,0)'); g.fillStyle = gl; g.fillRect(0, 0, cw, ch);
        g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2; g.strokeRect(1, 1, cw - 2, ch - 2); g.fillStyle = '#17181b'; g.fillRect(cw / 2 - 14, 0, 28, 10); g.restore(); } }, { roughness: .3, side: T.DoubleSide }); return DR.sheetM; }
  function sheetQ(k, i, x, y, z, o) { const g = new T.PlaneGeometry(.21, .297), uv = g.attributes.uv, cu = (i % 5) * 204 + 3, cv2 = ((i % 20) / 5 | 0) * 256 + 3; for (let q = 0; q < uv.count; q++) uv.setXY(q, (cu + uv.getX(q) * 198) / 1024, 1 - (cv2 + (1 - uv.getY(q)) * 250) / 1024); k.geo(sheetMat(), g, Object.assign({ x, y, z }, o || {})); }
  function matchSheets(k, x, y, z) { let n = 0;
    /* three strings between the posts of the old notice frame: sheet next to sheet, each a little crooked */
    for (let rw = 0; rw < 3; rw++) { const sy = y + 1.22 + rw * .38; k.tube('rubber', [[x - .03, sy, z - 1.68], [x - .03, sy - .03, z], [x - .03, sy, z + 1.68]], .0035, { seg: 3, steps: 8 }); for (let i = 0; i < 13; i++) { const zz = z - 1.5 + i * .25 + (rnd() - .5) * .03; if (rw === 2 && i % 5 === 4) continue; sheetQ(k, n++ * 3 + rw, x - .035 - (i % 2) * .006, sy - .165 - .03 * (1 - Math.pow((zz - z) / 1.68, 2)), zz, { ry: -HP, rz: (rnd() - .5) * .14, rx: (rnd() - .5) * .1 }); k.box('plastic_black', .012, .024, .03, x - .035, sy - .012, zz); } }
    /* two more strings run out from the north post to a bamboo pole */
    const px = x - 3.3, pz = z + 2.45; k.cyl(col('wood_plank', 0xb9985a, .8), .022, .028, 2.3, px, y + 1.15, pz, { seg: 6 }); k.box('concrete', .26, .14, .26, px, y + .07, pz, { bevel: .02 });
    for (let rw = 0; rw < 2; rw++) { const sy = y + 1.5 + rw * .42, a = [x - .1, sy, z + 1.72], b = [px, sy, pz], L2 = hyp(b[0] - a[0], b[2] - a[2]), ry = Math.atan2(b[0] - a[0], b[2] - a[2]) + HP; k.tube('rubber', [a, [(a[0] + b[0]) / 2, sy - .06, (a[2] + b[2]) / 2], b], .0035, { seg: 3, steps: 8 });
      for (let i = 0; i < 12; i++) { const t = (i + .7) / 12.6, sag = .06 * 4 * t * (1 - t); sheetQ(k, n++ * 7 + 2, a[0] + (b[0] - a[0]) * t, sy - sag - .165, a[2] + (b[2] - a[2]) * t, { ry, rz: (rnd() - .5) * .16, rx: (rnd() - .5) * .12 }); } }
    /* umbrellas open on the ground along both sides of the path, one family's sheet clipped to each, the parents' stools and bags behind */
    const UC = [0x2f5fae, 0x8a3fa0, 0xc8392e, 0x2c7d5a, 0xd9a01e, 0x40444c, 0xe8e2d2, 0x7a2a3a], um = UC.map(h => { const m = col('fabric_dark', h, .85).clone(); m.side = T.DoubleSide; return m; });
    for (let sd = -1; sd <= 1; sd += 2) for (let i = 0; i < 7; i++) { const ux = x - 2.3 - i * 1.06 + (rnd() - .5) * .2, uz = z + sd * (2.15 + (rnd() - .5) * .3), gy2 = gY(ux, uz, y); if (blocked(ux - .4, uz - .4, ux + .4, uz + .4, gy2) || (sd > 0 && i > 0 && i < 3)) continue; const tl = -sd * (.95 + rnd() * .2), yw = (rnd() - .5) * .5;
      k.push(ux, gy2 + .34, uz, { ry: yw }); k.geo(um[(i * 3 + (sd > 0 ? 1 : 4)) % 8], new T.ConeGeometry(.56, .3, 12, 2, true), { rx: tl, y: .1 }); k.cyl('metal_galv', .006, .006, .8, 0, .1 - cos(tl) * .3, -sin(tl) * .3, { rx: tl, seg: 5 }); k.box('plastic_black', .03, .1, .03, 0, .1 - cos(tl) * .72, -sin(tl) * .72, { rx: tl });
      sheetQ(k, n++ * 3 + 1, (rnd() - .5) * .2, .26 + cos(tl) * .1, sin(tl) * .22 - sd * .12, { rx: tl - sd * .32, ry: sd > 0 ? PI : 0, rz: (rnd() - .5) * .3 }); if (i % 3 === 0) sheetQ(k, n++ + 9, .5, -.33, -sd * .3, { rx: -HP, rz: rnd() * 3 }); k.pop();
      const bz = uz + sd * .85; k.cyl(col('plastic_red', [0x2a6fb5, 0xc23a2a, 0x2a6fb5][i % 3], .6), .13, .16, .3, ux + .1, gy2 + .15, bz, { seg: 8 }); k.box(col('plastic_red', [0x2a6fb5, 0xc23a2a, 0x2a6fb5][i % 3], .6), .3, .025, .3, ux + .1, gy2 + .31, bz, { bevel: .01 }); if (i % 2) { k.box(col('fabric_dark', [0x7a2a3a, 0x2c5a3c, 0x3a3a6a][i % 3], 1), .3, .28, .14, ux - .35, gy2 + .14, bz + sd * .1, { bevel: .03, ry: rnd() }); k.cyl(col('plastic_red', 0xb9bcc2, .3, .6), .035, .04, .24, ux + .42, gy2 + .12, bz, { seg: 8 }); } } }

  function dressDance() { if (!DC.body || !DC.geo) return; const fwd = [sin(DC.h), cos(DC.h)], lft = [cos(DC.h), -sin(DC.h)], W = (b, s2) => [DC.cx - fwd[0] * b + lft[0] * s2, DC.cz - fwd[1] * b + lft[1] * s2], c = new T.Color(), y0 = DC.gy - .02;
    /* a real formation is not forty copies: most wear the team red, a few came in a dark jacket, a pink top, a washed-out one */
    /* the instance colour is the colour of the clothes: the shader swaps it in where the vertex colour is the team red, and leaves skin, hair, gold and trousers alone */
    const recol = m => { m.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n\tvColor = vec3( 1.0 );\n#endif\n#ifdef USE_COLOR\n\tvColor.xyz *= color.xyz;\n#endif\n#ifdef USE_INSTANCING_COLOR\n\tif ( vColor.r > .3 && vColor.r > vColor.g * 4.0 ) vColor.xyz = instanceColor.xyz * ( vColor.r / .54 );\n#endif'); }; m.needsUpdate = true; }; recol(DC.body.material); recol(DC.aL.material);
    const TOP = [0xc22a26, 0xc22a26, 0x2a2f3a, 0xc22a26, 0xc22a26, 0xe07a9a, 0xc22a26, 0xc22a26, 0x8a4a8a, 0x3a5a7a, 0xc22a26, 0xd9a01e, 0xc22a26]; DC.I.forEach((d, i) => { c.copy(GT.C(TOP[(i * 5 + 2) % 13])); DC.body.setColorAt(i, c); DC.aL.setColorAt(i, c); DC.aR.setColorAt(i, c); });
    /* onlookers along the north edge and behind the last row: same people, street clothes, arms down */
    const L = []; for (let i = 0; i < 9; i++) L.push([W(-4.6 + i * 1.55 + (i % 2) * .35, 12.3 + (i % 3) * .55), DC.h - HP + (i % 3 - 1) * .25]); for (let i = 0; i < 6; i++) L.push([W(10.4 + (i % 2) * .7, -6.2 + i * 2.5), DC.h + (i % 3 - 1) * .3]);
    const ok = L.filter(p => !blocked(p[0][0] - .25, p[0][1] - .25, p[0][0] + .25, p[0][1] + .25, y0)), n = ok.length; if (n) { const mk = (g, m) => { const im = new T.InstancedMesh(g, m, n); im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true; im.visible = false; im.name = 'street_dance_onlookers'; S.root.add(im); return im; }, B = mk(DC.geo.body, DC.body.material), AL = mk(DC.geo.arm, DC.aL.material), AR = mk(DC.geo.arm, DC.aL.material), o = new T.Object3D(), a = new T.Object3D(), m4 = new T.Matrix4();
      const TINT = [0x3a4a6a, 0x8a8478, 0x24262c, 0xb58a5a, 0x4a6a4a, 0xd8d2c2, 0x5a3a6a];
      ok.forEach((p, i) => { const sc = .9 + (i * 37 % 10) * .012, wd = .95 + (i * 53 % 10) * .022, t = TINT[i % 7]; o.position.set(p[0][0], gY(p[0][0], p[0][1], y0), p[0][1]); o.rotation.set(0, p[1], 0); o.scale.set(wd, sc, wd); o.updateMatrix(); B.setMatrixAt(i, o.matrix); c.copy(GT.C(t)); B.setColorAt(i, c); AL.setColorAt(i, c); AR.setColorAt(i, c);
        for (const sd of [-1, 1]) { a.position.set(sd * .215, 1.36, 0); a.rotation.set(.12 + (i % 3) * .1, 0, sd * .1); a.updateMatrix(); m4.multiplyMatrices(o.matrix, a.matrix); (sd < 0 ? AL : AR).setMatrixAt(i, m4); } }); DC.extra = [B, AL, AR]; }
    const k = GT.kit(), r2 = GT.rng('dancebags');
    /* bags, folded coats, flasks and water bottles in a row along the south edge */
    for (let i = 0; i < 16; i++) { const p = W(-4.5 + i * .78 + (r2() - .5) * .2, -11.9 + (r2() - .5) * .3), by = gY(p[0], p[1], y0), q = r2(), hx = [0xb5202a, 0x2a4f8a, 0x1b1d22, 0xd9a01e, 0x6a3a8a, 0x2c7d5a, 0xe9e4d6][(r2() * 7) | 0]; if (blocked(p[0] - .2, p[1] - .2, p[0] + .2, p[1] + .2, y0)) continue;
      if (q < .45) { k.box(col('fabric_dark', hx, 1), .34, .28, .15, p[0], by + .14, p[1], { bevel: .03, ry: r2() * 3 }); k.geo(col('fabric_dark', hx, 1), new T.TorusGeometry(.09, .01, 4, 10, PI), { x: p[0], y: by + .28, z: p[1], ry: r2() * 3 }); }
      else if (q < .7) k.box(col('fabric_dark', hx, 1), .42, .07 + r2() * .05, .3, p[0], by + .05, p[1], { bevel: .025, ry: r2() * 3 });
      else if (q < .88) { k.cyl(col('plastic_red', hx, .3, .5), .04, .045, .26, p[0], by + .13, p[1], { seg: 10 }); k.cyl('plastic_black', .03, .036, .04, p[0], by + .28, p[1], { seg: 8 }); }
      else { k.cyl('glass_clear', .032, .032, .2, p[0], by + .1, p[1], { seg: 8 }); k.cyl(col('plastic_red', 0x2a6fb5, .5), .02, .02, .025, p[0], by + .212, p[1], { seg: 6 }); } }
    /* three work floods on tripods behind the last row, aimed up the formation: the dancers read as dark shapes with a bright edge, the paving carries their long light */
    const FL = glowMat(1, 1, 1); GT.glow(FL, new T.Color(.72, .93, 1), .05, 4);   /* 11 bloomed into a white ball that swallowed the leader when a flood stood behind her in the frame */ const gc = cv(32, 128), gg = gc.getContext('2d'), lg = gg.createLinearGradient(0, 0, 0, 128); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(.06, 'rgba(255,255,255,.7)'); lg.addColorStop(.3, 'rgba(255,255,255,.34)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); gg.fillStyle = lg; gg.fillRect(0, 0, 32, 128);
    const sg2 = gg.createLinearGradient(0, 0, 32, 0); sg2.addColorStop(0, 'rgba(0,0,0,1)'); sg2.addColorStop(.3, 'rgba(0,0,0,0)'); sg2.addColorStop(.7, 'rgba(0,0,0,0)'); sg2.addColorStop(1, 'rgba(0,0,0,1)'); gg.globalCompositeOperation = 'destination-out'; gg.fillStyle = sg2; gg.fillRect(0, 0, 32, 128);
    const SM = new T.MeshBasicMaterial({ map: new T.CanvasTexture(gc), transparent: true, depthWrite: false, blending: T.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }); GT.glow(SM, new T.Color(.5, .78, 1), 0, .2);
    [-6.6, .2, 6.8].forEach((s2, i) => { const p0 = W(11.9, s2), f = fit(p0[0], p0[1], .35, .35), x = f.x, z = f.z, gy2 = gY(x, z, y0); for (let q = 0; q < 3; q++) { const a = q / 3 * TAU + i; k.cyl('metal_dark', .014, .014, 1.25, x + sin(a) * .28, gy2 + .56, z + cos(a) * .28, { rx: cos(a) * .48, rz: -sin(a) * .48, seg: 5 }); } k.cyl('metal_galv', .02, .024, 3.2, x, gy2 + 1.7, z, { seg: 6 }); k.box('metal_dark', .1, .06, .9, x, gy2 + 3.3, z, { ry: DC.h });
      for (const o2 of [-.3, .3]) { const hx = x + lft[0] * o2, hz = z + lft[1] * o2; k.box('metal_dark', .34, .24, .1, hx, gy2 + 3.14, hz, { ry: DC.h, rx: .3, bevel: .015 }); k.geo(FL, new T.PlaneGeometry(.3, .2), { x: hx + fwd[0] * .056, y: gy2 + 3.125, z: hz + fwd[1] * .056, ry: DC.h, rx: .3 }); }
      k.tube('rubber', [[x, gy2 + .02, z], [x - fwd[0] * .8, gy2 + .015, z - fwd[1] * .8 + .3], [x - fwd[0] * 1.6 + lft[0] * .4, gy2 + .015, z - fwd[1] * 1.6 + lft[1] * .4]], .012, { seg: 4 }); k.geo(SM, new T.PlaneGeometry(5.4, 17), { x: x + fwd[0] * 8.9, y: gy2 + .03, z: z + fwd[1] * 8.9, rx: -HP, ry: DC.h + PI });
      GT.world.addPost(x, z, .2, 3.3, 'street:flood'); if (GT.fxsmall && GT.fxsmall.shaft) GT.fxsmall.shaft(x, gy2 + 3.15, z, { h: 3.1, r0: .2, r1: 1.7, color: [.55, .8, 1], k: .16, lean: [fwd[0] * 5, fwd[1] * 5] }); });
    const rp = W(11.2, 0); DC.rim = new T.PointLight(0xbfe4ff, 0, 30, 1.5); DC.rim.position.set(rp[0], y0 + 3.1, rp[1]); S.root.add(DC.rim);
    const grp = k.build(); grp.traverse(o => { if (o.isMesh && o.material.transparent) o.renderOrder = 3; }); S.root.add(grp); }

  function melonTruck() { const f = fit(10.0, 77.5, .95, 2.5), M = melonMats(), k = GT.kit(), wht = GT.mat('car_paint', { color: 0xe6e3da }), rail = col('metal_painted_blue', 0x2f6f5a, .6), q = GT.rng('melontruck'), y = gY(f.x, f.z, .2), BY = .86, FLE = M.flesh.clone(); FLE.emissive = new T.Color(1, 1, 1); FLE.emissiveMap = M.flesh.map; FLE.emissiveIntensity = .3;   /* the cut faces stay the one true red of the stall after dark */
    /* an invented light truck, nose to the north: single cab, 3.2 m bed, the kerb-side board dropped flat as the shelf */
    k.box('metal_dark', .9, .16, 4.5, 0, .5, -.1, { bevel: .02 }); for (const [wx, wz] of [[-.74, 1.45], [.74, 1.45], [-.74, -1.35], [.74, -1.35]]) { k.cyl('rubber', .33, .33, .2, wx, .33, wz, { rz: HP, seg: 16 }); k.cyl('metal_galv', .17, .17, .21, wx, .33, wz, { rz: HP, seg: 10 }); }
    k.box(wht, 1.62, .8, 1.5, 0, 1.0, 1.82, { bevel: .09 }); k.box(wht, 1.54, .74, 1.12, 0, 1.72, 1.66, { bevel: .13 }); k.box('glass_tint', 1.34, .5, .02, 0, 1.75, 2.222, { rx: -.16 }); k.box('plastic_black', 1.4, .03, .03, 0, 1.47, 2.25);
    for (const sx of [-1, 1]) { k.box('glass_tint', .02, .42, .6, sx * .772, 1.77, 1.74); k.box('plastic_black', .012, .72, .012, sx * .814, 1.02, 1.28); k.box('plastic_black', .012, .72, .012, sx * .814, 1.02, 2.2); k.box('plastic_black', .012, .012, .92, sx * .814, 1.385, 1.74); k.box('plastic_black', .03, .03, .1, sx * .82, 1.2, 1.4); k.box('plastic_black', .09, .15, .05, sx * .88, 1.66, 2.16, { bevel: .012 }); k.box('glass_clear', .3, .15, .03, sx * .54, 1.02, 2.572, { bevel: .01 }); k.box(col('plastic_red', 0xd8701c, .5), .1, .1, .03, sx * .74, 1.02, 2.57); k.geo('plastic_black', new T.TorusGeometry(.38, .04, 5, 12, PI), { x: sx * .79, y: .36, z: 1.45, ry: HP }); }
    k.box('plastic_black', 1.6, .2, .1, 0, .62, 2.56, { bevel: .03 }); k.box('plastic_black', .7, .13, .02, 0, 1.02, 2.574); k.box('metal_dark', .5, .14, .03, 0, .62, 2.615);
    k.box(rail, 1.66, .06, 3.2, 0, BY, -.62, { bevel: .01 }); k.box(rail, .04, .4, 3.2, -.81, BY + .22, -.62, { bevel: .006 }); k.box(rail, 1.66, .4, .04, 0, BY + .22, -2.2, { bevel: .006 }); k.box(rail, 1.66, .5, .04, 0, BY + .27, .96, { bevel: .006 }); k.box(rail, .42, .04, 3.2, 1.04, BY + .01, -.62, { bevel: .006 }); for (const z of [-2.1, -.62, .86]) { k.box('metal_galv', .03, .03, .5, 1.05, BY - .16, z, { rz: 0, rx: 0 }); k.box('metal_dark', .03, .34, .03, .82, BY - .2, z); }
    /* the load: forty-odd melons heaped high at the cab end, an orange tarp and an old quilt thrown back off them */
    for (let i = 0; i < 46; i++) { const lz = .7 - (i % 12) * .25 - q() * .1, ly = (i / 12 | 0), rad = .13 + q() * .045; if (ly > 2 && lz < -.9) continue; k.geo(M.rind, new T.SphereGeometry(rad, 12, 8), { x: -.58 + ((i * 5) % 5) * .29 + (q() - .5) * .08 + (ly % 2) * .12, y: BY + .16 + ly * .24 - (lz < -1.2 ? ly * .06 : 0), z: lz - (ly % 2) * .1, ry: q() * 6, rz: q() * 3, rx: q() * 3, s: [1.12, 1, 1] }); }
    k.box(col('plastic_red', 0xd8701c, .8), 1.5, .03, 1.2, -.1, BY + .98, .42, { rx: -.3, rz: .06 }); k.box(col('plastic_red', 0xd8701c, .8), 1.5, .6, .03, -.1, BY + .72, 1.0, { rx: .1 }); k.box(col('fabric_dark', 0x9a5a6a, 1), 1.2, .14, .6, -.2, BY + 1.08, .5, { bevel: .06, rx: -.28, ry: .12 });
    /* the shelf: halves with the cut face to the street under film, wedges, the knife and board, an electronic scale, payment cards, a bundle of red carrier bags */
    [[1.05, -.1], [1.07, -.52], [1.03, .34]].forEach(([sx, sz], i) => { k.geo(M.rind, new T.SphereGeometry(.165, 16, 8, 0, TAU, HP, HP), { x: sx, y: BY + .2, z: sz, rz: HP + .12, ry: (i - 1) * .2 }); k.geo(FLE, new T.CircleGeometry(.165, 22), { x: sx + .004, y: BY + .2, z: sz, ry: HP + (i - 1) * .2, rx: 0 }); k.geo('glass_clear', new T.CircleGeometry(.172, 16), { x: sx + .012, y: BY + .2, z: sz, ry: HP + (i - 1) * .2 }); });
    for (let i = 0; i < 4; i++) k.geo(M.flesh, new T.CircleGeometry(.15, 14, 0, PI), { x: 1.06, y: BY + .04, z: -1.0 - i * .05, ry: .2 }); k.box(col('wood_plank', 0xb89a6a, .8), .36, .03, .5, 1.05, BY + .035, -1.1, { bevel: .008 }); k.box('metal_galv', .004, .08, .3, 1.12, BY + .06, -1.32, { rz: HP, ry: .3 }); k.box('wood_plank', .026, .022, .11, 1.1, BY + .06, -1.52, { ry: .3 });
    k.box('plastic_white', .3, .07, .32, 1.04, BY + .065, -1.84, { bevel: .015 }); k.box('metal_galv', .26, .012, .28, 1.04, BY + .106, -1.84); k.box('plastic_white', .03, .34, .03, .92, BY + .27, -1.98); k.box('plastic_black', .16, .09, .04, .94, BY + .46, -1.98, { ry: HP - .3, bevel: .008 }); k.box('emissive_screen', .12, .05, .004, .962, BY + .46, -1.974, { ry: HP - .3 });
    for (let i = 0; i < 5; i++) k.sphere(col('plastic_red', 0xc8201a, .45), .09, .84, BY + .7 - i * .09, -2.22 + (i % 2) * .03, { seg: 7, seg2: 5, s: [.45, 1, .8] });
    for (const [cz, hx] of [[.62, '#22a04a'], [.4, '#1c78d8']]) k.quad(paper(96, 128, (g, w, h) => { g.fillStyle = '#f6f6f2'; g.fillRect(0, 0, w, h); g.fillStyle = hx; g.fillRect(0, 0, w, 22); g.fillStyle = '#16181c'; for (let a = 0; a < 11; a++) for (let b = 0; b < 11; b++) if ((a * 7 + b * 13 + a * b) % 5 < 2 || ((a < 3 || a > 7) && b < 3) || (a < 3 && b > 7)) g.fillRect(15 + a * 6, 30 + b * 6, 5, 5); g.fillStyle = '#333'; g.font = '700 14px ' + HEI; g.textAlign = 'center'; g.fillText('扫码付款', w / 2, 116); }), .12, .16, 1.262, BY - .12, cz, { ry: HP });
    k.quad(paper(512, 300, (g, w, h) => { g.fillStyle = '#b08a56'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(60,40,20,.18)'; for (let i = 0; i < 15; i++) g.fillRect(0, i * 20 + 6, w, 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#14110e'; g.font = '900 104px ' + KAI; g.fillText('沙地瓜', w / 2, 80, w - 40); g.fillStyle = '#a3140f'; g.font = '900 92px ' + KAI; g.fillText('两块一斤', w / 2, 190, w - 40); g.fillStyle = '#14110e'; g.font = '700 40px ' + KAI; g.fillText('包熟包甜 · 不沙不要钱', w / 2, 266, w - 40); }), .7, .41, 1.268, BY - .14, -.6, { ry: HP, rz: .04 });
    k.quad(paper(768, 256, (g, w, h) => { g.fillStyle = '#17803c'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f9a4a'; for (let i = 0; i < 9; i++) g.fillRect(i * 90, 0, 40, h); g.fillStyle = '#e8343f'; g.beginPath(); g.arc(128, 150, 96, PI, 0); g.fill(); g.strokeStyle = '#f4f0d8'; g.lineWidth = 9; g.beginPath(); g.arc(128, 150, 96, PI, 0); g.stroke(); g.fillStyle = '#17110d'; for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(70 + i * 14, 118 - (i % 3) * 16, 3, 5, .3, 0, TAU); g.fill(); } g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff6c8'; g.font = '900 120px ' + HEI; g.fillText('沙地西瓜', 500, 100, 480); g.font = '800 54px ' + HEI; g.fillStyle = '#ffe14a'; g.fillText('地头直送 · 现切现卖', 500, 200, 480); }), 1.5, .5, -.835, BY + .2, -.62, { ry: -HP });
    /* a bare bulb on a bamboo pole over the bed, the rind bucket, a stool, rinds on the ground */
    k.cyl(col('wood_plank', 0xb9985a, .8), .016, .022, 2.2, .78, BY + 1.1, -2.16, { seg: 6, rz: -.12 }); k.tube('rubber', [[.9, BY + 2.18, -2.16], [.7, BY + 1.95, -1.6], [.52, BY + 1.72, -1.2]], .005, { seg: 4 }); k.sphere('light_warm', .05, .52, BY + 1.66, -1.2, { seg: 10, seg2: 8 }); k.cyl('plastic_black', .02, .02, .05, .52, BY + 1.72, -1.2, { seg: 8 });
    k.cyl(col('plastic_red', 0x2a6fb5, .5), .18, .15, .36, 1.7, .18, -2.3, { seg: 12 }); for (let i = 0; i < 5; i++) k.geo(M.rind, new T.SphereGeometry(.15, 10, 6, 0, PI * .9, .6, 1.6), { x: 1.7 + (i % 3 - 1) * .08, y: .34 + (i % 2) * .03, z: -2.3 + (i % 2) * .08, ry: i * 1.9, rx: i }); for (let i = 0; i < 4; i++) k.geo(M.rind, new T.SphereGeometry(.14, 8, 4, 0, PI * .7, .7, 1.2), { x: 1.5 + q() * .9, y: .03, z: -1.2 + q() * 1.8, ry: q() * 6, rx: HP + .2 });
    k.cyl(col('plastic_red', 0xb5202a, .5), .15, .13, .4, 1.75, .2, .5, { seg: 12 });
    const grp = k.build(); grp.position.set(f.x, y, f.z); S.root.add(grp); GT.world.addBox(f.x - .95, f.z - 2.4, f.x + 1.3, f.z + 2.75, 2, 'street:melontruck'); spot('melonTruck', '西瓜货车 · 放平栏板当货架', f.x + 1.9, f.z);
    const pm = new T.MeshBasicMaterial({ map: blobT(), transparent: true, depthWrite: false, blending: T.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }); if (!pm.map) return; GT.glow(pm, new T.Color(1, .6, .22), 0, .15); DR.pools.push(addMesh(S.root, new T.PlaneGeometry(5, 5), pm, f.x + 1.1, y + .03, f.z - 1.1, { rx: -HP, cast: false, recv: false })); }

  function dressRiver() { const D = (GT.riverside && GT.riverside.layout && GT.riverside.layout.deck) || { x0: -66, x1: -60.4, z0: -26, z1: -14, y: -1.2, sz0: -21.5, sz1: -18.5 }, y = D.y === undefined ? DV.y : D.y, k = GT.kit(), q = GT.rng('swimdeck'), stone = col('concrete', 0x8f8a7e, .8);
    /* tyres along the river edge of the deck (not across the gap the board uses), mooring rope, heaps of clothes, slippers, flasks and carrier bags */
    for (let z = D.z0 + .9; z < D.z1 - .3; z += 2.1) { if (z > (D.sz0 || -21.5) - .5 && z < (D.sz1 || -18.5) + .5) continue; k.geo(GT.mat('rubber'), new T.TorusGeometry(.3, .11, 7, 14), { x: D.x0 - .13, y: y - .28, z, ry: HP }); k.cyl('metal_rust', .01, .01, .5, D.x0 - .1, y - .02, z, { seg: 4 }); }
    k.geo(col('fabric_dark', 0x9a8a62, 1), new T.TorusGeometry(.22, .035, 5, 14), { x: D.x1 - .7, y: y + .04, z: D.z0 + .8, rx: HP }); k.geo(col('fabric_dark', 0x9a8a62, 1), new T.TorusGeometry(.17, .035, 5, 14), { x: D.x1 - .7, y: y + .1, z: D.z0 + .8, rx: HP });
    for (let i = 0; i < 7; i++) { const cx = D.x1 - .5 - q() * .5, cz = D.z1 - .7 - i * .62; if (cz < (D.sz1 || -18.5) + 3.2) break; k.box(col('fabric_dark', [0x2a4f8a, 0x7a2a3a, 0x40444c, 0xc9b98a, 0x2c5a3c, 0x1b1d22, 0x9a5a2a][i], 1), .34, .07 + q() * .08, .26, cx, y + .06, cz, { bevel: .03, ry: q() * 3 }); if (i % 2) { for (const s2 of [-.07, .07]) k.box(col('plastic_grey', i % 4 === 1 ? 0x2a6fb5 : 0xc23a2a, .8), .1, .03, .26, cx - .45 + s2, y + .016, cz + .05, { bevel: .012, ry: .3 + s2 }); } else k.cyl(col('plastic_red', 0xb9bcc2, .3, .6), .04, .045, .25, cx - .4, y + .125, cz, { seg: 8 }); if (i % 3 === 0) k.sphere(col('plastic_red', 0xc8201a, .45), .12, cx + .05, y + .1, cz + .3, { seg: 7, seg2: 5, s: [1, .7, .9] }); }
    /* stone steps off the north end down into the water, a rope on two posts to haul yourself out by (board 37) */
    const sx0 = D.x0 + 1.3; for (let i = 0; i < 6; i++) k.box(stone, 1.7, .22, .38, sx0, y - .11 - i * .17, D.z1 + .2 + i * .36, { bevel: .025 }); k.box(stone, 2.0, .24, .5, sx0, y - .12, D.z1 + .02, { bevel: .03 });
    for (const [pz, ph] of [[D.z1 + .1, .95], [D.z1 + 1.9, .5]]) k.cyl('metal_rust', .028, .034, ph + .9, sx0 - .95, y - .45 + ph / 2 - (pz > D.z1 + 1 ? .85 : 0), pz, { seg: 6 }); k.tube(col('fabric_dark', 0x9a8a62, 1), [[sx0 - .95, y + .9, D.z1 + .1], [sx0 - .95, y + .2, D.z1 + 1.1], [sx0 - .95, y - .45, D.z1 + 1.9], [sx0 - .7, y - .95, D.z1 + 2.5]], .016, { seg: 5, steps: 14 });
    k.decal('water_stain', 2.2, 1.6, sx0, y + .012, D.z1 - .7, .4); k.decal('puddle', 1.4, 1, sx0 + .4, y + .014, D.z1 - 1.2, 1.2);
    /* the one warm point on a cold river: a bulb on a bamboo pole at the landward corner */
    const bx = D.x1 - .25, bz = D.z0 + .3; k.cyl(col('wood_plank', 0xb9985a, .8), .02, .028, 2.7, bx, y + 1.35, bz, { seg: 6, rz: .05 }); k.tube('rubber', [[bx - .07, y + 2.68, bz], [bx - .3, y + 2.5, bz + .2], [bx - .45, y + 2.2, bz + .3]], .005, { seg: 4 }); k.sphere('light_warm', .055, bx - .45, y + 2.14, bz + .3, { seg: 10, seg2: 8 }); k.cyl('plastic_black', .02, .02, .05, bx - .45, y + 2.2, bz + .3, { seg: 8 });
    S.root.add(k.build());
    const pm = new T.MeshBasicMaterial({ map: blobT(), transparent: true, depthWrite: false, blending: T.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }); if (pm.map) { GT.glow(pm, new T.Color(1, .58, .2), 0, .55); addMesh(S.root, new T.PlaneGeometry(5.5, 5.5), pm, bx - .9, y + .03, bz + 1.2, { rx: -HP, cast: false, recv: false }); }
    /* swimmers drifting downstream past the deck: a head and shoulders, a bright cap, and behind each one a float on a metre of cord: orange rings, yellow and white pillows (boards 33, 34) */
    const N = 9, wy = DV.wy, mk = (geo, mat) => { const im = new T.InstancedMesh(geo, mat, N); im.instanceMatrix.setUsage(T.DynamicDrawUsage); im.frustumCulled = false; im.castShadow = false; im.name = 'street_swimmers'; S.root.add(im); return im; };
    const hg = mergeC([part(new T.SphereGeometry(.105, 10, 8), 0xd2a27e, 0, .02, 0, 0, 0, 0, [1, 1.1, 1.05]), part(new T.SphereGeometry(.2, 10, 6), 0xc9966f, 0, -.2, -.05, 0, 0, 0, [1.15, .5, .7])]);
    DR.heads = mk(hg, new T.MeshStandardMaterial({ vertexColors: true, roughness: .55 })); DR.caps = mk(new T.SphereGeometry(.112, 10, 6, 0, TAU, 0, PI * .52).translate(0, .03, -.006), new T.MeshStandardMaterial({ color: 0xffffff, roughness: .45, emissive: new T.Color(.1, .05, .03) })); DR.floats = mk(new T.TorusGeometry(.15, .075, 8, 14).rotateX(HP), new T.MeshStandardMaterial({ color: 0xffffff, roughness: .5, emissive: new T.Color(.2, .07, .0) })); DR.cords = mk(new T.CylinderGeometry(.008, .008, 1, 4).rotateX(HP), GT.mat('plastic_white'));
    const c = new T.Color(), CAP = [0xff6a1e, 0xff5fa2, 0xf2d21e, 0xf4f2ea, 0xff6a1e, 0x2ad0c0, 0xf2d21e, 0xff5fa2, 0xff6a1e], FLT = [0xff6a12, 0xffd21e, 0xff6a12, 0xf4f0e2, 0xff7a1a, 0xffd21e, 0xff6a12, 0xff6a12, 0xf4f0e2];
    for (let i = 0; i < N; i++) { DR.SW.push({ ph: i * 9.7 + q() * 4, x: -72 - (i % 4) * 4.5 - q() * 3, sp: .32 + q() * .12 }); DR.caps.setColorAt(i, GT.C(CAP[i])); DR.floats.setColorAt(i, GT.C(FLT[i])); } DR.wy = wy; DR.z0 = (D.z0 + D.z1) / 2; }
  const _dm = new T.Object3D();
  function dressStep(dt) { if (!S.visual) return; const env = GT.env || {}, night = env.night || 0; if (DC.rim) DC.rim.intensity = DC.k * night * 1.3;
    if (!DR.heads) return; const d = distP(-70, DR.z0); if (d > 190) return; const t = S.t;
    for (let i = 0; i < DR.SW.length; i++) { const w = DR.SW[i], u = ((t * w.sp + w.ph) % 96 + 96) % 96, z = DR.z0 + 44 - u, x = w.x + sin(t * .21 + i) * 1.2 - u * .05, bob = sin(t * 1.7 + i * 2.1) * .035, yaw = PI + sin(t * .3 + i) * .25;
      _dm.position.set(x, DR.wy + .1 + bob, z); _dm.rotation.set(.25, yaw, sin(t * 1.4 + i) * .12); _dm.scale.set(1, 1, 1); _dm.updateMatrix(); DR.heads.setMatrixAt(i, _dm.matrix); DR.caps.setMatrixAt(i, _dm.matrix);
      const fx = x + sin(t * .4 + i * 3) * .25, fz = z + 1.25 + sin(t * .7 + i) * .1; _dm.position.set(fx, DR.wy + .05 + sin(t * 1.9 + i) * .03, fz); _dm.rotation.set(sin(t * 1.3 + i) * .12, i, cos(t * 1.1 + i) * .12); _dm.scale.set(1, i % 3 === 1 ? .9 : 1, i % 3 === 1 ? 1.5 : 1); _dm.updateMatrix(); DR.floats.setMatrixAt(i, _dm.matrix);
      _dm.position.set((x + fx) / 2, DR.wy + .03, (z + fz) / 2 - .05); _dm.rotation.set(0, Math.atan2(fx - x, fz - z), 0); _dm.scale.set(1, 1, hyp(fx - x, fz - z) - .25); _dm.updateMatrix(); DR.cords.setMatrixAt(i, _dm.matrix); }
    DR.heads.instanceMatrix.needsUpdate = DR.caps.instanceMatrix.needsUpdate = DR.floats.instanceMatrix.needsUpdate = DR.cords.instanceMatrix.needsUpdate = true; }
  function dressBuild() { if (!S.visual) return; for (const [n, f] of [['dance', dressDance], ['truck', melonTruck], ['river', dressRiver]]) { try { f(); } catch (e) { if (window.console) console.warn('[street] dress ' + n, e); } } }

  /* ================================================================== init / update */
  function init(game) {
    if (S.inited) return api; S.inited = true; S.game = game; S.G = game.G || null; P = game.player || P; S.visual = !!(S.G && S.G.visual && game.scene && typeof document !== 'undefined'); SV = load();
    ST.dive.best = SV.dive.best; ST.dive.dives = SV.dive.n; ST.dive.escapes = SV.dive.esc; ST.dance.joins = SV.dance.joins; ST.dance.kicks = SV.dance.kicks; ST.melon.bought = SV.melon.bought; ST.melon.vip = !!SV.melon.vip; ST.ltl.stolen = SV.ltl.stolen; ST.ltl.paid = SV.ltl.paid;
    if (S.visual) { S.scene = game.scene; S.root = new T.Group(); S.root.name = 'street'; S.scene.add(S.root); uiInit(); } else S.root = { add() {}, remove() {} };
    for (const [n, f] of [['dive', diveBuild], ['dance', danceBuild], ['melon', melonBuild], ['match', matchBuild], ['dress', dressBuild]]) { try { f(); } catch (e) { S.bad[n] = 9; if (window.console) console.warn('[street] build ' + n, e); if (S.G && S.G.warnings && S.G.warnings.length < 40) S.G.warnings.push('street.' + n + ': ' + (e && e.message || e)); } }
    for (const s of STASH) if (SV.match.stash[s.id] === 'open') stashMark(s); spot('ltl', '老头乐 · 大马路上到处走 (位置实时)', 0, 0);
    if (GT.onfoot && GT.onfoot.refreshColliders) safe(() => GT.onfoot.refreshColliders()); cockpitWarm();
    if (game.on) { game.on('water', () => DV.busy);   /* the dive owns the river while it runs: no 冬泳体验卡 teleport */
      game.on('death', () => { safe(streetDeath); }); game.on('horn', d => { if (d && d.on) safe(() => ltlHonked(d.ent)); }); game.on('enterCar', d => { if (d && d.ent && d.ent === LT.ent) ltlStolen(); }); game.on('exitCar', d => { if (d && d.ent && d.ent === LT.ent) LT.respT = 0; });
      game.on('crash', d => { if (d && d.by && d.by === LT.ent && (d.vn || 0) > 2.2 && P.ent && P.ent !== LT.ent) ltlHit(P.ent, d.vn, true); }); }
    ST.ready = true; return api; }
  /* phases are read straight from the pieces, so a tester never sees last frame's value */
  Object.defineProperty(ST.melon, 'phase', { enumerable: true, get: () => ML.ph }); Object.defineProperty(ST.ltl, 'phase', { enumerable: true, get: () => LT.ph });
  const stashCount = () => { let op = 0, dn = 0; for (const s of STASH) { const v = SV.match.stash[s.id]; if (v === 'open') op++; else if (v === 'done') dn++; } ST.match.stashOpen = op; ST.match.stashDone = dn; ST.match.clues = Object.keys(SV.match.clues).length; };
  /* the 保安 on the 钟楼洋行 steps (js/people.js id 'guard') used to stand at ease with his back to a gunfight: while anything hostile is alert within 45 m he is down on the stone with his hands over his cap */
  const GD = { t: 0, on: false, calm: 0 };
  function guardStep(dt) { GD.t -= dt; if (GD.t > 0) return; GD.t = .4; const pop = safe(() => S.game.people, null), en = GT.combat && GT.combat.enemies; if (!pop || !pop.find || !pop.place || !pop.release) return; const g = pop.find('guard'); if (!g) return;
    let hot = false; if (en) for (const e of en) if (!e.dead && !e.out && e.alert && hyp(e.x - g.x, e.z - g.z) < 45) { hot = true; break; }
    if (hot) { GD.calm = 0; if (!GD.on && g.active) { GD.on = true; pop.place('guard', { x: g.x, z: g.z, h: g.h, y: g.def ? g.def.y : undefined, state: 'cower' }); g.noReact = true; } }
    else if (GD.on) { GD.calm += .4; if (GD.calm > 6) { GD.on = false; GD.calm = 0; g.noReact = false; pop.release('guard'); } } }
  const PIECES = [['dive', diveStep], ['dance', danceStep], ['melon', melonStep], ['ltl', ltlStep], ['match', matchStep], ['guard', guardStep], ['dress', dressStep]];
  function update(dt) {
    if (!S.inited || !(dt > 0)) return; const G = S.G; if (G && G.phase !== 'play') { if (MC.open) { MC.open = false; uiOn('card', false); } return; }
    const tr = !!(G && G.trailer); if (S.visual && S.root.visible === tr) S.root.visible = !tr; if (tr) { S.free = ST.free = false; if (LT.ent) ltlRemove(); return; }   /* js/cntrailer.js stages its own stall, speaker, swimmers and dancers on these very spots: nothing of ours is in its shots */
    S.t += dt; S.frame++; S.free = ST.free = !(G && (G.story || G.cine)); runQ();
    for (const p of PIECES) { if (S.bad[p[0]] > 3) continue; try { p[1](dt); } catch (e) { S.bad[p[0]] = (S.bad[p[0]] || 0) + 1; if (window.console) console.warn('[street] ' + p[0], e); if (S.bad[p[0]] > 3 && G && G.warnings && G.warnings.length < 40) G.warnings.push('street.' + p[0] + ' switched off: ' + (e && e.message || e)); } }
  }
  function reset() { SV = blank(); save(); for (const s of STASH) { if (s.mark && s.mark.remove) safe(() => s.mark.remove()); s.mark = null; if (s.lid) s.lid.rotation.x = 0; } MC.card = -1; return api; }

  const api = GT.street = { init, update, spots: SPOTS, state: ST, lines: LINES, voiceList, reset, cards: CARDS, get save() { return SV; },
    dive: { start: m => diveStart(m), score: diveScore, get site() { return { x: DV.E + .9, z: DV.z, exit: DV.exit }; } },
    dance: { join: danceJoin, leave: danceLeave, kick: danceKick, get dancers() { return DC.I; }, get speaker() { return DC.spk; } },
    melon: { buy: melonBuy, stoke: melonStoke, grab: melonGrab, throw: melonThrow, event: melonEvent, calm: t => { cancel('melon'); melonThugGone(); melonRest(t); }, get sites() { return ML.sites; }, get thug() { return ML.thug; }, get enemies() { return ML.enemies; } },
    ltl: { get ent() { return LT.ent; }, hit: (ent, player) => ltlHit(ent, 4, !!player), pay: ltlPay, reset: ltlRemove, isGang: ltlGang, make: makeLao },
    match: { read: matchRead, listen: () => matchListen(true), open: stashUnlock, get stashes() { return STASH; } } };
})();
