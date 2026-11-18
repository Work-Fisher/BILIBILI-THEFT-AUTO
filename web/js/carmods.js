/* carmods.js — BILIBILI THEFT AUTO 1: 月湾改装 MOONBAY CUSTOMS, the GTA-style body shop of the coast map, and every car modification the game knows (SH line, 2026-11-17).
   The shop: a built garage in the 月湾汽修 yard behind the hotel row (x 43.6–56.6, z 29.6–45.6), its roller door facing 十一街 (south). Drive a car into the yellow marker in front of the door:
   the door is open, the car rolls itself onto the lift, the door comes down and the menu opens with a camera that orbits the car and swings to the part being chosen. Every option previews
   at once; E pays (GT.wallet), X goes back, X at the top drives out. Bought parts stay on that car, the car becomes "your car" and is saved (localStorage bta1.carmods.v1) — a reload puts it
   back where you left it. Wanted but unseen when you come in: a new main colour takes up to two stars off (all of them at two or less) and the car / plate on file stop matching.
   Parts are built here and hung on the cars of js/cnvehicles.js through what a car object exposes (group, meshes.paint / glass, wheels, dims, vkey, color0, dust; GT.cnvehicles.paintMat / setPlate):
     paint  main colour (24 + factory) · secondary colour (the add-on parts) · finish gloss / metallic / pearl / matte / chrome
     wheels 7 rim designs + factory (multi-spoke mesh, five-spoke, twin five-spoke, deep-dish eight-spoke, turbine, retro steel with hub cap, off-road beadlock) · rim colour
     body   front lip / splitter (3) · side skirts (3) · rear wing: ducktail / pedestal / GT wing · bonnet: vents / scoop / carbon / carbon with vents (carbon = the car's own bonnet triangles, re-skinned)
     window tint (3) · plate style (5) · horn (6 recorded horns from js/samples.js) · under-glow (7 colours)
     performance engine 1–4, gearbox 1–3, brakes 1–3, suspension 1–4 (the body really sits lower on its wheels), turbo, armour 20–100 % — js/cngame.js's car model reads them from e.c.S / e.muMul
     repair (e.c.damage) and wash (the paint's dust term)
   GT.carmods = { init(game), update(dt), apply(ent, mods), mods(ent), open(), active, rec, reset(), opts, tree, shop, selftest() }   (js/shops.js calls init / update)
   Query: ?cmcash=<n> sets the wallet (tests)   ?cm=0 switches the shop off */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!T || !GT) return;
  const PI = Math.PI, HP = PI / 2, TAU = PI * 2, sin = Math.sin, cos = Math.cos, abs = Math.abs, hyp = Math.hypot, min = Math.min, max = Math.max;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t, sst = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const dang = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
  const Q = new URLSearchParams(location.search), KEY = 'bta1.carmods.v1';
  const safe = (fn, d) => { try { return fn(); } catch (e) { if (window.console) console.warn('[carmods]', e); return d; } };
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const hexN = h => typeof h === 'number' ? h : parseInt(String(h || '#000').replace('#', ''), 16) || 0;
  const colL = h => GT.C ? GT.C(hexN(h)) : new T.Color(hexN(h));
  const hexS = n => '#' + ('000000' + hexN(n).toString(16)).slice(-6);

  /* ================================================================== the catalogue */
  const PAINTS = [['#f4f4f1', '冰川白'], ['#0c0d0f', '曜石黑'], ['#8d939b', '月光银'], ['#4b5058', '炭灰'], ['#c8141c', '赛道红'], ['#6e0d16', '勃艮第红'], ['#e2561c', '落日橙'], ['#f3c316', '跑道黄'],
    ['#d7c48c', '香槟金'], ['#69b83a', '青柠绿'], ['#16553a', '赛车绿'], ['#1fb1a5', '湖水青'], ['#3aa6e2', '晴空蓝'], ['#1f4fc0', '皇家蓝'], ['#13234c', '午夜蓝'], ['#6a2ab6', '电光紫'],
    ['#e3569b', '火烈鸟粉'], ['#86562b', '马鞍棕'], ['#57663a', '橄榄军绿'], ['#b5793b', '古铜'], ['#e9ddc2', '沙丘米'], ['#2b6d89', '海湾蓝'], ['#a8acb0', '水泥灰'], ['#ff6f61', '珊瑚红']];
  const pPrice = h => /^#(0c0d0f|f4f4f1|8d939b|4b5058|a8acb0)$/.test(h) ? 300 : 450;
  const O = {
    c1: [{ v: '', n: '原厂色', p: 0, d: '这辆车出厂时的颜色。' }].concat(PAINTS.map(c => ({ v: c[0], n: c[1], p: pPrice(c[0]), sw: c[0] }))),
    c2: [{ v: '', n: '原厂黑', p: 0, sw: '#141518', d: '外加套件默认是黑色。' }].concat(PAINTS.map(c => ({ v: c[0], n: c[1], p: 250, sw: c[0] }))),
    fin: [{ v: '', n: '亮面', p: 0, d: '普通亮面清漆。' }, { v: 'metal', n: '金属漆', p: 600, d: '漆里有金属颗粒，太阳下会闪。' }, { v: 'pearl', n: '珠光漆', p: 1100, d: '珠光层，侧面看颜色会泛光。' },
      { v: 'matte', n: '哑光', p: 1400, d: '不反光的哑光面。' }, { v: 'chrome', n: '镀铬', p: 6500, d: '整车镀铬，像一面镜子。' }],
    whl: [{ v: '', n: '原厂轮毂', p: 0 }, { v: 'mesh', n: '多辐网状', p: 1600, d: '十组细辐交叉，经典赛车款。' }, { v: 'five', n: '五辐运动', p: 1200, d: '五根宽辐条，简单耐看。' }, { v: 'split', n: '双五辐', p: 1900, d: '五组双辐条。' },
      { v: 'deep', n: '深唇八辐', p: 2600, d: '抛光宽唇边，辐条往里凹。' }, { v: 'turbine', n: '涡轮叶片', p: 2200, d: '十六片弯叶片，像涡轮。' }, { v: 'steel', n: '复古钢圈', p: 700, d: '冲压钢圈加电镀轮盖，老派。' }, { v: 'offroad', n: '越野六辐', p: 1800, d: '粗辐条加锁圈螺栓。' }],
    wcol: [{ v: '', n: '亮银', p: 0, sw: '#c9ced4' }, { v: '#33363b', n: '枪灰', p: 300, sw: '#33363b' }, { v: '#0f0f11', n: '哑黑', p: 300, sw: '#0f0f11' }, { v: '#c9a13a', n: '香槟金', p: 500, sw: '#c9a13a' },
      { v: '#ececea', n: '亮白', p: 300, sw: '#ececea' }, { v: '#b3201f', n: '赛车红', p: 400, sw: '#b3201f' }, { v: '#9a6436', n: '古铜', p: 500, sw: '#9a6436' }, { v: 'chrome', n: '电镀铬', p: 1500, sw: '#e8eef4' }],
    lip: [{ v: '', n: '原厂', p: 0 }, { v: 'l1', n: '低调前唇', p: 600, d: '前保险杠下面加一片薄唇。' }, { v: 'l2', n: '运动下巴', p: 1100, d: '更宽的下巴，两侧加风刀。' }, { v: 'l3', n: '赛道铲', p: 1800, d: '伸出来的平铲，带支撑杆和端板。' }],
    skirt: [{ v: '', n: '原厂', p: 0 }, { v: 's1', n: '低调侧裙', p: 700, d: '门槛下面一条细裙边。' }, { v: 's2', n: '运动侧裙', p: 1300, d: '更厚的侧裙，后轮前有进气口。' }, { v: 's3', n: '赛道侧裙', p: 2000, d: '侧裙加平板和两片导流片。' }],
    wing: [{ v: '', n: '无尾翼', p: 0 }, { v: 'duck', n: '小鸭尾', p: 900, d: '后备箱边缘翘起的一小截。' }, { v: 'mid', n: '中尾翼', p: 1800, d: '两根立柱托着的尾翼。' }, { v: 'gt', n: '大尾翼', p: 3600, d: '高立柱、宽翼面、带端板的赛车尾翼。' }],
    hood: [{ v: '', n: '原厂', p: 0 }, { v: 'vent', n: '双通风口', p: 900, d: '引擎盖上两组散热百叶。' }, { v: 'scoop', n: '进气罩', p: 1500, d: '引擎盖中间隆起一个进气罩。' }, { v: 'carbon', n: '碳纤维', p: 2200, d: '整块碳纤维引擎盖，带清漆。' },
      { v: 'cvent', n: '碳纤维通风', p: 2900, d: '碳纤维引擎盖加两组百叶。' }],
    tint: [{ v: '', n: '无贴膜', p: 0 }, { v: 'light', n: '浅色贴膜', p: 250, d: '透光 35%。' }, { v: 'dark', n: '深色贴膜', p: 500, d: '透光 15%，外面看不清车里。' }, { v: 'limo', n: '全黑贴膜', p: 900, d: '透光 5%，几乎全黑。' }],
    plate: [{ v: '', n: '维尔蒙港白牌', p: 0 }, { v: 'blue', n: '蓝底白字', p: 200 }, { v: 'black', n: '黑底金字', p: 350 }, { v: 'yellow', n: '黄底黑字', p: 200 }, { v: 'sunset', n: '月湾落日', p: 450, d: '橙紫渐变，月湾限定款。' }],
    horn: [{ v: '', n: '原厂喇叭', p: 0, s: 'horn_hold' }, { v: 'beep', n: '短促电喇叭', p: 150, s: 'horn_beep' }, { v: 'car1', n: '轿车单音', p: 250, s: 'horn_car_1' }, { v: 'car3', n: '双音喇叭', p: 400, s: 'horn_car_3' },
      { v: 'car4', n: '高音喇叭', p: 450, s: 'horn_car_4' }, { v: 'truck', n: '卡车气喇叭', p: 1200, s: 'horn_truck', d: '一按整条街都听得见。' }],
    glow: [{ v: '', n: '不装', p: 0 }, { v: '#38c8ff', n: '冰蓝', p: 1500, sw: '#38c8ff' }, { v: '#ff3fb4', n: '品红', p: 1500, sw: '#ff3fb4' }, { v: '#7dff3a', n: '荧光绿', p: 1500, sw: '#7dff3a' },
      { v: '#ff2a2a', n: '红色', p: 1500, sw: '#ff2a2a' }, { v: '#a050ff', n: '紫色', p: 1500, sw: '#a050ff' }, { v: '#ffffff', n: '白色', p: 1500, sw: '#ffffff' }, { v: '#ff8a1a', n: '橙色', p: 1500, sw: '#ff8a1a' }],
    eng: [{ v: 0, n: '原厂', p: 0 }, { v: 1, n: '一级调校', p: 1800, d: '进排气和电脑，扭矩 +14%。' }, { v: 2, n: '二级调校', p: 3600, d: '凸轮轴和喷油嘴，扭矩 +28%。' }, { v: 3, n: '三级调校', p: 6200, d: '锻造活塞，扭矩 +44%。' }, { v: 4, n: '四级调校', p: 9800, d: '整机重建，扭矩 +62%。' }],
    trans: [{ v: 0, n: '原厂', p: 0 }, { v: 1, n: '街道变速箱', p: 2500, d: '主减速比 +5%，起步更快。' }, { v: 2, n: '运动变速箱', p: 4600, d: '主减速比 +10%。' }, { v: 3, n: '赛车变速箱', p: 7800, d: '主减速比 +16%。' }],
    brake: [{ v: 0, n: '原厂', p: 0 }, { v: 1, n: '街道刹车', p: 1200, d: '刹车力 +18%，轮胎抓地 +4%。' }, { v: 2, n: '运动刹车', p: 2600, d: '刹车力 +36%，抓地 +8%。' }, { v: 3, n: '赛车刹车', p: 4900, d: '刹车力 +60%，抓地 +13%，刹车距离短很多。' }],
    susp: [{ v: 0, n: '原厂', p: 0 }, { v: 1, n: '降低 3 厘米', p: 800, d: '车身降低 3 厘米，抓地 +2%。' }, { v: 2, n: '降低 6 厘米', p: 1600, d: '车身降低 6 厘米，抓地 +4%。' }, { v: 3, n: '降低 9 厘米', p: 2600, d: '车身降低 9 厘米，抓地 +6%。' }, { v: 4, n: '竞技（降低 12 厘米）', p: 3900, d: '车身降低 12 厘米，抓地 +9%。' }],
    turbo: [{ v: 0, n: '不装', p: 0 }, { v: 1, n: '涡轮增压', p: 8500, d: '高转速时扭矩再 +15%。' }],
    armor: [{ v: 0, n: '不装', p: 0 }, { v: 1, n: '装甲 20%', p: 2500, d: '撞击损伤 −18%，车重 +3%。' }, { v: 2, n: '装甲 40%', p: 4500, d: '撞击损伤 −35%，车重 +6%。' }, { v: 3, n: '装甲 60%', p: 7000, d: '撞击损伤 −50%，车重 +9%。' },
      { v: 4, n: '装甲 80%', p: 10000, d: '撞击损伤 −64%，车重 +12%。' }, { v: 5, n: '装甲 100%', p: 14000, d: '撞击损伤 −75%，车重 +15%。' }] };
  const PERF = { eng: [1, 1.14, 1.28, 1.44, 1.62], trans: [1, 1.05, 1.1, 1.16], brake: [1, 1.18, 1.36, 1.6], drop: [0, .03, .06, .09, .12], grip: [1, 1.02, 1.04, 1.06, 1.09], dmg: [1, .82, .65, .5, .36, .25], mass: [1, 1.03, 1.06, 1.09, 1.12, 1.15], turbo: [1, 1.15] };
  const PLATES = { blue: { bg: '#1c3f95', fg: '#ffffff', top: 'PORT VERMONT' }, black: { bg: '#111214', fg: '#e9c64a', rim: '#e9c64a', top: 'PORT VERMONT', foot: 'CLASSIC' },
    yellow: { bg: '#f2c21a', fg: '#151515', top: 'PORT VERMONT' }, sunset: { bg: '#ff9a3c', bg2: '#7b3fb2', fg: '#ffffff', rim: '#ffffff', top: 'PORT VERMONT', foot: 'MOONBAY' } };
  const TREE = { n: '月湾改装', kids: [
    { n: '修理', act: 'repair', cam: 'q3' }, { n: '洗车', act: 'wash', cam: 'q3' },
    { n: '车漆', cam: 'q3', kids: [{ n: '主色', key: 'c1', cam: 'q3' }, { n: '副色', key: 'c2', cam: 'q3r', d: '尾翼、前唇、侧裙这些外加套件的颜色。' }, { n: '漆面类型', key: 'fin', cam: 'q3' }] },
    { n: '轮毂', cam: 'wheel', kids: [{ n: '轮毂样式', key: 'whl', cam: 'wheel' }, { n: '轮毂颜色', key: 'wcol', cam: 'wheel' }] },
    { n: '车身', cam: 'q3', kids: [{ n: '前唇', key: 'lip', cam: 'front' }, { n: '侧裙', key: 'skirt', cam: 'side' }, { n: '尾翼', key: 'wing', cam: 'rear' }, { n: '引擎盖', key: 'hood', cam: 'hood' }] },
    { n: '车窗贴膜', key: 'tint', cam: 'win' }, { n: '车牌', key: 'plate', cam: 'plate' }, { n: '喇叭', key: 'horn', cam: 'front' }, { n: '底盘灯', key: 'glow', cam: 'low' },
    { n: '性能', cam: 'perf', kids: [{ n: '引擎', key: 'eng', cam: 'hood' }, { n: '变速箱', key: 'trans', cam: 'side' }, { n: '刹车', key: 'brake', cam: 'wheel' }, { n: '悬挂', key: 'susp', cam: 'side' }, { n: '涡轮', key: 'turbo', cam: 'hood' }, { n: '装甲', key: 'armor', cam: 'q3' }] }] };
  const DEF = { c1: '', c2: '', fin: '', whl: '', wcol: '', lip: '', skirt: '', wing: '', hood: '', tint: '', plate: '', horn: '', glow: '', eng: 0, trans: 0, brake: 0, susp: 0, turbo: 0, armor: 0 };
  const PERFK = ['eng', 'trans', 'brake', 'susp', 'turbo', 'armor'];
  const norm = m => { const o = Object.assign({}, DEF); if (m) for (const k in DEF) if (m[k] !== undefined && m[k] !== null) o[k] = m[k]; return o; };

  /* ================================================================== saved state */
  function load() { const s = safe(() => JSON.parse(localStorage.getItem(KEY) || 'null'), null); return s && s.v === 1 ? s : { v: 1, car: null }; }
  let ST = load();
  const save = () => safe(() => localStorage.setItem(KEY, JSON.stringify(ST)));
  const S = { game: null, G: null, inited: false, visual: false, t: 0, phase: 'idle', car: null, pcar: null, pcarT: 0, spawned: false, X: new Set(), cut: null, cam: null, ui: null, menu: null, lastDmg: 0, dmgEnt: null, hornV: null, door: { k: 1, want: 1 } };

  /* ================================================================== materials and textures */
  const MC = {};
  function canvasTex(w, h, draw, o) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; if (o && o.rep) { t.wrapS = t.wrapT = T.RepeatWrapping; } return t; }
  function carbonTex() { if (MC.carbonT) return MC.carbonT; MC.carbonT = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#121214'; g.fillRect(0, 0, w, h); const n = 8, s = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const hor = ((i + j) >> 1) % 2 === 0, x = i * s, y = j * s, gr = hor ? g.createLinearGradient(x, y, x, y + s) : g.createLinearGradient(x, y, x + s, y); gr.addColorStop(0, '#0d0d0f'); gr.addColorStop(.5, hor ? '#3a3b40' : '#2a2b30'); gr.addColorStop(1, '#0d0d0f'); g.fillStyle = gr; g.fillRect(x + .5, y + .5, s - 1, s - 1); } }, { rep: true }); MC.carbonT.repeat.set(1, 1); return MC.carbonT; }
  function carbonMat() { if (MC.carbon) return MC.carbon; const m = new T.MeshPhysicalMaterial({ color: 0xffffff, map: carbonTex(), roughness: .32, metalness: .25, clearcoat: 1, clearcoatRoughness: .03, envMapIntensity: 1.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }); m.userData.gtProbeK = 1; m.name = 'cm_carbon'; return MC.carbon = m; }
  const mat = (n, o) => { const k = n + JSON.stringify(o || {}); return MC[k] || (MC[k] = GT.mat(n, o)); };
  const blackM = () => MC.black || (MC.black = new T.MeshStandardMaterial({ color: 0x0e0f11, roughness: .55, metalness: .1, side: T.DoubleSide }));
  const barrelM = () => MC.barrel || (MC.barrel = new T.MeshStandardMaterial({ color: 0x3a3c40, roughness: .45, metalness: .8, side: T.DoubleSide }));
  const tyreM = () => MC.tyre || (MC.tyre = new T.MeshStandardMaterial({ color: 0x18181a, roughness: .86, metalness: 0, side: T.DoubleSide }));
  const ironM = () => MC.iron || (MC.iron = new T.MeshStandardMaterial({ color: 0x55585c, roughness: .42, metalness: .9 }));
  const chromeM = () => MC.chr || (MC.chr = new T.MeshStandardMaterial({ color: 0xf0f2f4, metalness: 1, roughness: .06, envMapIntensity: 1.6, side: T.DoubleSide }));
  const glowStripM = hex => { const k = 'gs' + hex; if (MC[k]) return MC[k]; const c = colL(hex).multiplyScalar(4); return MC[k] = new T.MeshBasicMaterial({ color: c, toneMapped: true }); };
  function glowTex() { return MC.glowT || (MC.glowT = canvasTex(128, 256, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * .62); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.55, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.save(); g.scale(1, h / w); g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, TAU); g.fill(); g.restore(); })); }
  /** paint for one car: js/cnvehicles.js's own lacquer (dust, clear coat, probe), a private copy so this car can change colour without touching the cars that share its factory colour */
  let uniq = 0;
  function ownPaint(v, hex) { const pm = GT.cnvehicles && GT.cnvehicles.paintMat, d = (v.dust || [.3, .1, .3, 0]).concat(['cm' + (++uniq)]); const m = pm ? pm(hexN(hex), d) : GT.carPaint ? GT.carPaint(hexN(hex), {}).clone() : new T.MeshPhysicalMaterial({ color: colL(hex), roughness: .3, clearcoat: 1 }); return m; }
  /** geometry for a paint material: js/cnvehicles.js's lacquer multiplies by vertex colour and reads aPar */
  function forPaint(g) { const n = g.attributes.position.count; if (!g.attributes.color) g.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); if (!g.attributes.aPar) g.setAttribute('aPar', new T.BufferAttribute(new Float32Array(n * 3), 3)); return g; }

  /* ================================================================== reading a car's body (cached per template) */
  const PRB = {};
  function probe(v) { const key = v.vkey || v.kind; if (PRB[key]) return PRB[key]; const d = v.dims, hw0 = d.W / 2, ms = v.meshes, list = [];
    for (const n in ms) { if (/glass|^fx$/.test(n) || !ms[n] || !ms[n].geometry) continue; list.push(ms[n]); }
    const P = { zF: -9, zR: 9, ybF: 9, ybM: 9, ybR: 9, sill: hw0 * .9, bwF: hw0 * .8, bwR: hw0 * .8, hoodY: .9, zHood: 0, deckY: .9, zDeck: 0, hood: [], prof: {} };
    const each = (fn, only) => { for (const m of (only || list)) { const a = m.geometry.attributes.position.array; for (let i = 0; i < a.length; i += 3) fn(a[i], a[i + 1], a[i + 2]); } };
    each((x, y, z) => { if (y > .12 && abs(x) < hw0 * .9) { if (z > P.zF) P.zF = z; if (z < P.zR) P.zR = z; } });
    each((x, y, z) => { if (y < .03) return; if (z > P.zF - .35 && abs(x) < hw0 * .75 && y < P.ybF) P.ybF = y; if (z < P.zR + .35 && abs(x) < hw0 * .75 && y < P.ybR) P.ybR = y; if (abs(z) < .5 && abs(x) > hw0 * .55 && y < P.ybM) P.ybM = y; });
    if (P.ybF > 1) P.ybF = .2; if (P.ybR > 1) P.ybR = .22; if (P.ybM > 1) P.ybM = .22; let sx = 0, bf = 0, br = 0;
    each((x, y, z) => { if (abs(z) < .5 && y < P.ybM + .18 && abs(x) > sx) sx = abs(x); if (z > P.zF - .3 && y < P.ybF + .22 && abs(x) > bf) bf = abs(x); if (z < P.zR + .3 && y < P.ybR + .25 && abs(x) > br) br = abs(x); });
    P.sill = sx || hw0 * .9; P.bwF = bf || hw0 * .8; P.bwR = br || hw0 * .8;
    /* the top profile along the centre line of the painted body: where the bonnet ends (the screen base) and where the boot lid starts */
    const pm = ms.paint, pa = pm.geometry.attributes.position.array, bin = z => Math.round(z / .05), Y = {};
    for (let i = 0; i < pa.length; i += 3) { const x = pa[i], y = pa[i + 1], z = pa[i + 2], ax = abs(x); if (ax < hw0 * .42 || ax > hw0 * .66) continue;   /* a band off the centre line: a stock bonnet bulge or scoop does not read as the screen */ const b = bin(z); if (Y[b] === undefined || y > Y[b]) Y[b] = y; }
    const at = z => Y[bin(z)], avg = (z0, z1) => { let s = 0, n = 0; for (let b = bin(z0); b <= bin(z1); b++) if (Y[b] !== undefined) { s += Y[b]; n++; } return n ? s / n : null; };
    P.hoodY = avg(P.zF - .62, P.zF - .3) || .85; P.zHood = P.zF - 1.2; for (let z = P.zF - .3, miss = 0; z > -.5; z -= .05) { const y = at(z); if (y === undefined) { if (++miss >= 2) { P.zHood = z + .1; break; } continue; } miss = 0; if (y > P.hoodY + .13) { P.zHood = z + .05; break; } P.zHood = z; }
    P.deckY = avg(P.zR + .12, P.zR + .4) || .9; P.zDeck = P.zR + .9; for (let z = P.zR + .3; z < .5; z += .05) { const y = at(z); if (y === undefined || y > P.deckY + .13) { P.zDeck = z - .05; break; } P.zDeck = z; }
    /* the bonnet's own triangles (for the carbon skin and for heights on it) */
    const ix = pm.geometry.index ? pm.geometry.index.array : null, nt = (ix ? ix.length : pa.length / 3) / 3, _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _n = new T.Vector3(), _u = new T.Vector3(), _w = new T.Vector3();
    for (let t = 0; t < nt; t++) { const i0 = ix ? ix[t * 3] : t * 3, i1 = ix ? ix[t * 3 + 1] : t * 3 + 1, i2 = ix ? ix[t * 3 + 2] : t * 3 + 2; _a.fromArray(pa, i0 * 3); _b.fromArray(pa, i1 * 3); _c.fromArray(pa, i2 * 3);
      const cy = (_a.y + _b.y + _c.y) / 3, cx = (_a.x + _b.x + _c.x) / 3, zmin = min(_a.z, _b.z, _c.z), zmax = max(_a.z, _b.z, _c.z); if (zmin < P.zHood || zmax > P.zF - .02 || cy < P.hoodY - .3 || abs(cx) > P.bwF * .98) continue;
      _n.crossVectors(_u.subVectors(_b, _a), _w.subVectors(_c, _a)); const L = _n.length(); if (L < 1e-9) continue; _n.multiplyScalar(1 / L); if (_n.y < .5) continue; P.hood.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z); }
    return PRB[key] = P; }
  /** height of the bonnet surface under (x, z), or null */
  function hoodAt(P, x, z) { const h = P.hood; let best = null; for (let i = 0; i < h.length; i += 9) { const ax = h[i], az = h[i + 2], bx = h[i + 3], bz = h[i + 5], cx = h[i + 6], cz = h[i + 8], d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (abs(d) < 1e-10) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2; if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue; const y = l1 * h[i + 1] + l2 * h[i + 4] + l3 * h[i + 7]; if (best === null || y > best) best = y; } return best; }

  /* ================================================================== wheels: tyre + rim + rotor, built per design and size */
  function lathe(pts, seg, rx) { const g = new T.LatheGeometry(pts.map(p => new T.Vector2(p[1], p[0])), seg || 40); g.rotateZ(-HP); if (rx) g.rotateX(rx); return g; }   /* points [x along the axle, radius] -> a surface of revolution about X */
  const WT = {};
  function wheelTpl(style, R, hw) { const key = style + '|' + R.toFixed(3) + '|' + hw.toFixed(3); if (WT[key]) return WT[key]; const k = { tyre: [], rim: [], dark: [], lip: [], rotor: [] }, rr = R * .72, xo = hw * .8;
    k.tyre.push(lathe([[-hw * .9, rr - .004], [-hw, rr + .03], [-hw * 1.02, R - .05], [-hw * .9, R - .012], [-hw * .55, R], [hw * .55, R], [hw * .9, R - .012], [hw * 1.02, R - .05], [hw, rr + .03], [hw * .9, rr - .004]], 44));
    k.dark.push(lathe([[hw * .86, rr - .002], [-hw * .55, rr - .012], [-hw * .62, rr * .55], [-hw * .62, rr * .2]], 32));                                                     /* the barrel and its back wall */
    k.rotor.push(new T.CylinderGeometry(rr * .82, rr * .82, .028, 32).rotateZ(HP).translate(-hw * .15, 0, 0));
    const spoke = (n, w0, w1, th, r0, r1, x, twin, out, curve) => { for (let i = 0; i < n; i++) for (const s of (twin ? [-twin, twin] : [0])) { const len = r1 - r0, g = new T.BoxGeometry(th, len, w0, 1, 4, 1), p = g.attributes.position;
          for (let j = 0; j < p.count; j++) { const f = clamp((p.getY(j) + len / 2) / len, 0, 1); p.setZ(j, p.getZ(j) * lerp(1, w1 / w0, f) + (curve || 0) * sin(f * PI)); p.setX(j, p.getX(j) + (out || 0) * (1 - f)); } g.computeVertexNormals(); g.translate(x, r0 + len / 2, 0); g.rotateX(i / n * TAU + s); k.rim.push(g); } };
    const lipR = (x0, x1, w) => k.lip.push(lathe([[x0, rr + .012], [x1, rr + .014], [x1 + .004, rr - (w || .03)], [x0 + .01, rr - (w || .03) - .004]], 44));
    const hub = (x, r, cap) => { k.rim.push(new T.CylinderGeometry(r, r * 1.08, .04, 24).rotateZ(HP).translate(x, 0, 0)); k.lip.push(new T.SphereGeometry(cap || r * .55, 16, 8, 0, TAU, 0, HP).rotateZ(-HP).translate(x + .018, 0, 0));
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; k.lip.push(new T.CylinderGeometry(.009, .011, .022, 6).rotateZ(HP).translate(x + .02, cos(a) * r * .62, sin(a) * r * .62)); } };
    if (style === 'mesh') { lipR(xo - .02, xo + .012, .022); spoke(10, .03, .02, .022, .06, rr - .02, xo - .03, .1, .02); hub(xo - .01, .065); }
    else if (style === 'five') { lipR(xo - .01, xo + .012, .02); spoke(5, .085, .05, .03, .06, rr - .018, xo - .02, 0, .015); hub(xo, .07); }
    else if (style === 'split') { lipR(xo - .01, xo + .012, .02); spoke(5, .036, .024, .026, .06, rr - .018, xo - .025, .13, .015); hub(xo - .005, .068); }
    else if (style === 'deep') { k.lip.push(lathe([[xo - .055, rr + .012], [xo + .015, rr + .014], [xo + .02, rr - .012], [xo - .055, rr - .04]], 44)); spoke(8, .034, .024, .024, .055, rr - .04, xo - .065, .0, .045); hub(xo - .05, .062); }
    else if (style === 'turbine') { lipR(xo - .01, xo + .012, .02); spoke(16, .05, .03, .012, .07, rr - .02, xo - .03, 0, .01, .025); hub(xo - .005, .075, .05); }
    else if (style === 'steel') { k.rim.push(lathe([[xo - .03, rr - .004], [xo - .01, rr - .03], [xo, rr - .07], [xo - .02, rr * .55], [xo + .012, rr * .42], [xo + .018, .02]], 40)); for (let i = 0; i < 8; i++) { const a = (i + .5) / 8 * TAU; k.dark.push(new T.CylinderGeometry(.026, .026, .02, 14).rotateZ(HP).translate(xo - .01, cos(a) * rr * .68, sin(a) * rr * .68)); }
      k.lip.push(new T.SphereGeometry(rr * .44, 24, 10, 0, TAU, 0, .7).rotateZ(-HP).translate(xo - rr * .3, 0, 0)); k.lip.push(lathe([[xo + .002, rr + .012], [xo + .014, rr - .004], [xo + .004, rr - .03]], 44)); }
    else if (style === 'offroad') { k.rim.push(lathe([[xo - .02, rr + .016], [xo + .02, rr + .018], [xo + .022, rr - .03], [xo - .02, rr - .04]], 40)); for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; k.lip.push(new T.CylinderGeometry(.008, .008, .02, 6).rotateZ(HP).translate(xo + .028, cos(a) * (rr - .012), sin(a) * (rr - .012))); }
      spoke(6, .07, .055, .04, .07, rr - .04, xo - .03, 0, .01); hub(xo - .01, .08); }
    else { lipR(xo - .01, xo + .012, .02); spoke(7, .05, .035, .025, .06, rr - .02, xo - .02); hub(xo, .065); }
    const out = {}; for (const n in k) if (k[n].length) out[n] = GT.mergeGeos ? GT.mergeGeos(k[n].map(g => g.index ? g.toNonIndexed() : g)) : k[n][0]; return WT[key] = out; }

  /* ================================================================== the add-on body parts */
  function airfoil(span, chord, th) { const sh = new T.Shape(); sh.moveTo(0, 0); sh.bezierCurveTo(chord * .1, th * 1.05, chord * .55, th * .9, chord, th * .1); sh.lineTo(chord, 0); sh.bezierCurveTo(chord * .6, -th * .15, chord * .2, -th * .25, 0, 0);
    const g = new T.ExtrudeGeometry(sh, { depth: span, bevelEnabled: false, curveSegments: 10 }); g.translate(-chord * .45, 0, -span / 2); g.rotateY(-HP); g.rotateY(PI); return g; }   /* chord along -Z (leading edge forward = +Z), span along X */
  function wedge(w, h, l, rise) { const sh = new T.Shape(); sh.moveTo(0, 0); sh.lineTo(l, 0); sh.lineTo(l, h * (rise || .3)); sh.quadraticCurveTo(l * .6, h * 1.05, 0, h); sh.lineTo(0, 0); const g = new T.ExtrudeGeometry(sh, { depth: w, bevelEnabled: true, bevelThickness: .008, bevelSize: .008, bevelSegments: 2, curveSegments: 8 }); g.translate(0, 0, -w / 2); g.rotateY(-HP); return g; }   /* side profile in (z, y): tall at z = 0 (the rear), falling towards +z ... after rotateY(-HP) the profile runs along -X; turned back below */
  function buildKit(X, m) { const v = X.v, P = X.P, d = v.dims, g = new T.Group(); g.name = 'cm_kit'; const K = { p1: [], p2: [], blk: [], cf: [], chr: [] }, box = (b, w, h, l, x, y, z, rx, ry, rz) => { const q = GT.boxGeo ? GT.boxGeo(w, h, l, min(.012, min(w, h, l) * .3)) : new T.BoxGeometry(w, h, l); q.rotateX(rx || 0); q.rotateY(ry || 0); q.rotateZ(rz || 0); q.translate(x, y, z); K[b].push(q); };
    const zF = P.zF, zR = P.zR, wr = d.wheelR;
    /* front lip */
    if (m.lip === 'l1') box('p2', P.bwF * 1.86, .028, .17, 0, P.ybF - .006, zF - .07);
    else if (m.lip === 'l2') { box('p2', P.bwF * 1.94, .034, .2, 0, P.ybF - .012, zF - .05); for (const s of [-1, 1]) box('p2', .16, .018, .1, s * (P.bwF - .06), P.ybF + .13, zF - .05, 0, s * -.25, s * .3); }
    else if (m.lip === 'l3') { box('blk', P.bwF * 2.04, .02, .3, 0, P.ybF - .04, zF + .02); for (const s of [-1, 1]) { box('p2', .018, .1, .3, s * P.bwF * 1.02, P.ybF, zF + .02); box('chr', .012, .1, .012, s * P.bwF * .55, P.ybF + .02, zF + .1, -.5); } box('p2', P.bwF * 1.7, .03, .06, 0, P.ybF - .015, zF - .1); }
    /* side skirts */
    if (m.skirt) { const za = d.axleR + wr * 1.15 + .08, zb = d.axleF - wr * 1.15 - .08, len = max(.4, zb - za), zc = (za + zb) / 2, y0 = P.ybM;
      for (const s of [-1, 1]) { const x = s * (P.sill + .012);
        if (m.skirt === 's1') box('p2', .05, .07, len, x, y0 + .02, zc);
        else if (m.skirt === 's2') { box('p2', .075, .13, len, x + s * .012, y0 + .045, zc); box('blk', .02, .07, .16, x + s * .05, y0 + .06, za + .14, 0, s * .35); }
        else if (m.skirt === 's3') { box('p2', .07, .1, len, x + s * .01, y0 + .035, zc); box('blk', .14, .014, len + .1, x + s * .03, y0 - .02, zc); for (const f of [.3, .7]) box('blk', .012, .08, .14, x + s * .06, y0 + .02, lerp(za, zb, f), 0, s * .2); } } }
    /* rear wing */
    const yD = P.deckY, bw = P.bwR;
    if (m.wing === 'duck') { const q = new T.BoxGeometry(bw * 1.7, .05, .2, 1, 1, 1), p = q.attributes.position; for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) p.setY(i, p.getY(i) + .045); q.computeVertexNormals(); q.translate(0, yD + .02, zR + .14); K.p1.push(q); }
    else if (m.wing === 'mid') { for (const s of [-1, 1]) box('blk', .035, .13, .09, s * bw * .55, yD + .06, zR + .22); const a = airfoil(bw * 1.7, .24, .045); a.rotateX(.1); a.translate(0, yD + .12, zR + .2); K.p2.push(a); }
    else if (m.wing === 'gt') { for (const s of [-1, 1]) { box('blk', .018, .27, .085, s * bw * .46, yD + .13, zR + .26, -.18); } const a = airfoil(bw * 1.92, .3, .042); a.rotateX(.14); a.translate(0, yD + .28, zR + .2); K.p2.push(a); const a2 = airfoil(bw * 1.92, .11, .022); a2.rotateX(.55); a2.translate(0, yD + .335, zR + .06); K.p2.push(a2);
      for (const s of [-1, 1]) box('p2', .01, .15, .3, s * bw * .96, yD + .29, zR + .17); }
    /* bonnet */
    if ((m.hood === 'carbon' || m.hood === 'cvent') && P.hood.length) { const q = new T.BufferGeometry(), pos = new Float32Array(P.hood), uv = new Float32Array(pos.length / 3 * 2); for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) { uv[j] = pos[i] * 7; uv[j + 1] = pos[i + 2] * 7; } q.setAttribute('position', new T.BufferAttribute(pos, 3)); q.setAttribute('uv', new T.BufferAttribute(uv, 2)); q.computeVertexNormals(); K.cf.push(q); }
    const hz0 = P.zHood, hz1 = zF - .25, hl = hz1 - hz0;
    if ((m.hood === 'vent' || m.hood === 'cvent') && hl > .4) { for (const s of [-1, 1]) { const x = s * min(.56, P.bwF * .64), z = hz0 + hl * .42, y = hoodAt(P, x, z); if (y === null) continue; const y2 = hoodAt(P, x, z + .1), slope = y2 === null ? 0 : Math.atan2(y2 - y, .1);
        box('blk', .26, .016, .34, x, y + .004, z, -slope); for (let i = 0; i < 7; i++) box('blk', .23, .03, .014, x, y + .022, z - .14 + i * .046, -slope + .65); box('chr', .27, .012, .012, x, y + .012, z - .175, -slope); box('chr', .27, .012, .012, x, y + .012, z + .175, -slope); } }
    if (m.hood === 'scoop' && hl > .4) { const z = hz0 + hl * .45, y = hoodAt(P, 0, z) || P.hoodY, SL = min(.75, hl * .7), q = wedge(.5, .085, SL, .25); q.rotateY(PI); q.translate(0, y - .004, z + SL * .5); K.p1.push(q);
      box('blk', .44, .05, .02, 0, y + .042, z + SL * .5 + .006); }
    const mats = { p1: X.paint, p2: X.p2, blk: blackM(), cf: carbonMat(), chr: chromeM() };
    for (const n in K) { if (!K[n].length) continue; const geo = GT.mergeGeos ? GT.mergeGeos(K[n].map(q => q.index ? q.toNonIndexed() : q)) : K[n][0]; if (n === 'p1' || n === 'p2') forPaint(geo); const mesh = new T.Mesh(geo, mats[n]); mesh.castShadow = n !== 'cf'; mesh.receiveShadow = true; mesh.name = 'cm_' + n; g.add(mesh); }
    return g; }

  /* ================================================================== applying a set of mods to a live vehicle */
  function carState(e) { const v = e.veh; if (v._cm) return v._cm; const X = v._cm = { v, e, P: probe(v), last: {}, kit: null, wheels: [], glow: null, body: [] };
    for (const n in v.meshes) { const c = v.meshes[n]; if (c && n !== 'fx' && c.parent === v.group) X.body.push([c, c.position.y]); }   /* only the body's own meshes go down with the suspension: not the cockpit, the driver or the seat mounts js/cngame.js places at the eye */
    X.col0 = hexS(v.color0 !== undefined ? v.color0 : (e.color !== undefined ? e.color : 0x888888)); X.paint = ownPaint(v, X.col0); v.meshes.paint.material = X.paint; X.p2 = ownPaint(v, 0x141518);
    X.base = { metal: X.paint.metalness, rough: X.paint.roughness, cc: X.paint.clearcoat, ccr: X.paint.clearcoatRoughness, dust: X.paint.userData.gtDust ? X.paint.userData.gtDust.value.z : 0 };
    X.glassMesh = v.meshes.cn_car_glass || null;   /* the window tint is a dark film laid over the car's own glass (the glass shader shows the cabin whatever its colour) */
    X.rimM = new T.MeshStandardMaterial({ color: 0xc9ced4, roughness: .3, metalness: .72, envMapIntensity: 1.5, side: T.DoubleSide }); X.rimM.userData.gtProbeK = 1;
    S.X.add(X); return X; }
  function setFinish(X, m) { const p = X.paint, hex = m.c1 || X.col0, c = colL(hex); p.color.copy(c);
    const f = m.fin || '', h = {}; c.getHSL(h); const dark = h.l < .08;
    if (f === 'metal') { p.metalness = .72; p.roughness = .34; p.clearcoat = 1; p.clearcoatRoughness = .03; }
    else if (f === 'pearl') { p.metalness = .45; p.roughness = .2; p.clearcoat = 1; p.clearcoatRoughness = .02; if (!p.sheen) p.sheen = new T.Color(); p.sheen.copy(c).lerp(new T.Color(1, 1, 1), .55).multiplyScalar(.8); }
    else if (f === 'matte') { p.metalness = .02; p.roughness = .78; p.clearcoat = 0; p.clearcoatRoughness = .5; }
    else if (f === 'chrome') { p.metalness = 1; p.roughness = .05; p.clearcoat = 1; p.clearcoatRoughness = .02; p.color.lerp(new T.Color(1, 1, 1), .5); }
    else { p.metalness = X.base.metal; p.roughness = X.base.rough; p.clearcoat = X.base.cc; p.clearcoatRoughness = X.base.ccr; if (m.c1) { p.metalness = dark ? .14 : .06; p.roughness = .26; } }
    if (f !== 'pearl' && p.sheen) p.sheen.setRGB(0, 0, 0);
    X.p2.color.copy(colL(m.c2 || '#141518')); X.p2.metalness = f === 'metal' || f === 'pearl' ? .6 : .08; X.p2.roughness = f === 'matte' ? .7 : .3; X.p2.clearcoat = f === 'matte' ? 0 : 1; }
  function setWheels(X, m) { const v = X.v, d = v.dims; for (const w of X.wheels) if (w.parent) w.parent.remove(w); X.wheels.length = 0;
    const stock = !m.whl; v.wheels.forEach((sp, i) => { const sm = sp.children.find(c => c.isMesh && !c.userData.cm); if (sm) sm.visible = stock; });
    const wc = m.wcol || '#c9ced4'; if (wc === 'chrome') { X.rimM.color.setRGB(.92, .93, .95); X.rimM.roughness = .05; X.rimM.metalness = 1; } else { X.rimM.color.copy(colL(wc)); X.rimM.roughness = wc === '#0f0f11' ? .6 : .3; X.rimM.metalness = wc === '#0f0f11' || wc === '#ececea' || wc === '#b3201f' ? .35 : .72; }
    if (stock) return; const hw = (v.wheels[0] && v.wheels[0].children[0] && v.wheels[0].children[0].geometry) ? (() => { const g = v.wheels[0].children[0].geometry; if (!g.boundingBox) g.computeBoundingBox(); return (g.boundingBox.max.x - g.boundingBox.min.x) / 2; })() : .12;
    const tp = wheelTpl(m.whl, d.wheelR, clamp(hw, .08, .2));
    v.wheels.forEach((sp, i) => { const sm = sp.children.find(c => c.isMesh && !c.userData.cm), grp = new T.Group(); grp.userData.cm = 1; if (sm) { grp.scale.copy(sm.scale); grp.rotation.y = sm.rotation.y; }
      const M = { tyre: tyreM(), rim: X.rimM, dark: barrelM(), lip: m.whl === 'steel' || m.whl === 'deep' || m.whl === 'offroad' ? chromeM() : X.rimM, rotor: ironM() };
      for (const n in tp) { const mm = new T.Mesh(tp[n], M[n]); mm.castShadow = n === 'tyre'; mm.receiveShadow = true; mm.userData.cm = 1; grp.add(mm); } sp.add(grp); X.wheels.push(grp); }); }
  function setTint(X, m) { const gm = X.glassMesh; if (!gm) return; const op = { light: .5, dark: .78, limo: .93 }[m.tint || ''] || 0;
    if (!op) { if (X.film) X.film.visible = false; return; } if (!X.film) { const mt = new T.MeshStandardMaterial({ color: 0x040507, roughness: .06, metalness: 0, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, envMapIntensity: 1.2 }); mt.userData.gtProbeK = 1.2;
      X.film = new T.Mesh(gm.geometry, mt); X.film.renderOrder = (gm.renderOrder || 0) + 1; X.film.name = 'cm_tint'; X.film.position.copy(gm.position); X.v.group.add(X.film); X.body.push([X.film, gm.position.y]); }
    X.film.visible = true; X.film.material.opacity = op; }
  function setPlateStyle(X, m) { const v = X.v, st = PLATES[m.plate] || null; v.plateStyle = st || undefined; if (GT.cnvehicles && GT.cnvehicles.setPlate) safe(() => GT.cnvehicles.setPlate(v, X.e.plate || v.plate || '', st || undefined)); }
  function setGlow(X, m) { const v = X.v, d = v.dims; if (X.glow) { v.group.remove(X.glow); X.glow = null; } if (X.glowK) { const gk = X.glowK; if (gk.parent) gk.parent.remove(gk); X.body = X.body.filter(b => b[0] !== gk); X.glowK = null; } if (!m.glow) return;
    const mt = new T.MeshBasicMaterial({ map: glowTex(), color: colL(m.glow).multiplyScalar(2.2), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, opacity: .8 }), pl = new T.Mesh(new T.PlaneGeometry(d.W + 1.1, d.L + 1.2), mt); pl.rotation.x = -HP; pl.position.y = .035; pl.renderOrder = 3; pl.name = 'cm_glow'; v.group.add(pl); X.glow = pl;
    const k = new T.Group(), sm = glowStripM(m.glow); for (const s of [-1, 1]) { const b = new T.Mesh(new T.BoxGeometry(.03, .02, d.wheelbase * .8), sm); b.position.set(s * (X.P.sill - .1), X.P.ybM - .015, (d.axleF + d.axleR) / 2); k.add(b); } X.glowK = k; v.group.add(k); X.body.push([k, 0]); }
  function setStance(X, m) { const dr = PERF.drop[m.susp | 0] || 0; X.v.group.userData.cmDrop = dr; for (const b of X.body) b[0].position.y = b[1] - dr;   /* QA: js/cngame.js reads cmDrop and seats the cockpit, the eye and the driver that much lower too */
    if (X.kit) X.kit.position.y = -dr; if (X.glowK) X.glowK.position.y = -dr; }
  /** apply(ent, mods): show this set of mods on a live car (preview or bought) */
  function apply(e, mods) { if (!e || !e.veh || !e.veh.group || e.two || e.veh.twoWheeler) return false; const m = norm(mods), X = carState(e), L = X.last, ch = k => L[k] !== m[k];
    if (ch('c1') || ch('c2') || ch('fin')) setFinish(X, m);
    if (ch('whl') || ch('wcol')) setWheels(X, m);
    if (ch('lip') || ch('skirt') || ch('wing') || ch('hood')) { if (X.kit) { X.v.group.remove(X.kit); X.body = X.body.filter(b => b[0] !== X.kit); } X.kit = buildKit(X, m); X.v.group.add(X.kit); }
    if (ch('tint')) setTint(X, m); if (ch('plate')) setPlateStyle(X, m); if (ch('glow')) setGlow(X, m);
    setStance(X, m); X.last = m; e.cmMods = m; return true; }

  /* ================================================================== performance on the road (js/cngame.js carPhys reads e.c.S and e.muMul) */
  const perfSig = m => PERFK.map(k => m[k] | 0).join('');
  function tuneStep() { const g = S.game, P = g.player, e = P.ent; if (!e || P.mode !== 'car' || !e.c || !e.c.S) { S.dmgEnt = null; return; } const m = e.cmMods; if (!m) return; const C = e.c, sig = perfSig(m);
    if (C._cm !== sig) { const SP = C.S, B = C._cmB || (C._cmB = { peakT: SP.peakT, final: SP.final, brake: SP.brake, mass: SP.mass, Iz: SP.Iz });
      SP.peakT = B.peakT * PERF.eng[m.eng | 0] * PERF.turbo[m.turbo | 0]; SP.final = B.final * PERF.trans[m.trans | 0]; SP.brake = B.brake * PERF.brake[m.brake | 0]; SP.mass = B.mass * PERF.mass[m.armor | 0]; SP.Iz = B.Iz * PERF.mass[m.armor | 0];
      e.muMul = PERF.grip[m.susp | 0] * [1, 1.04, 1.08, 1.13][m.brake | 0]; C._cm = sig; }   /* bigger brakes come with stickier pads and tyres: the stop is grip-limited in js/cngame.js */
    /* armour: part of every knock is handed back */
    if (S.dmgEnt !== e) { S.dmgEnt = e; S.lastDmg = C.damage || 0; } const k = PERF.dmg[m.armor | 0]; if (C.damage > S.lastDmg && k < 1) C.damage = S.lastDmg + (C.damage - S.lastDmg) * k; S.lastDmg = C.damage; }
  /** the four bars on the menu (0..1) for a set of mods on this kind of car */
  function stats(e, m) { const SP = (e.c && e.c._cmB) ? Object.assign({}, e.c.S, e.c._cmB) : null, K = { muscle: [560, 1650, 1.02, 1], sports: [520, 1400, 1.08, 1.07] }[e.kind] || [300, 1450, 1, .97];
    const pk = SP ? SP.peakT : K[0], ms = SP ? SP.mass : K[1], br = SP ? SP.brake : K[2], mu = SP ? SP.mu : K[3], E = PERF.eng[m.eng | 0] * PERF.turbo[m.turbo | 0], A = PERF.mass[m.armor | 0];
    return { acc: clamp(pk * E * PERF.trans[m.trans | 0] / (ms * A) / .55, .05, 1), top: clamp(Math.cbrt(pk * E) / 9.6, .05, 1), brake: clamp(br * PERF.brake[m.brake | 0] / A / 1.75, .05, 1), grip: clamp(mu * PERF.grip[m.susp | 0] / 1.25, .05, 1) }; }

  /* ================================================================== the personal car: saved, put back on load, followed while parked */
  const isMine = e => !!(e && S.pcar === e);
  function adopt(e) { const v = e.veh, vk = v.vkey || e.kind, r = ST.car && ST.car.ent === e ? ST.car : { kind: e.kind, vkey: vk, variant: vk.indexOf(':') > 0 ? vk.split(':')[1] : '', col0: hexS(v.color0 !== undefined ? v.color0 : 0x888888), plate: e.plate || v.plate || '', mods: Object.assign({}, DEF), x: e.x, z: e.z, h: e.h };
    Object.defineProperty(r, 'ent', { value: e, writable: true, enumerable: false, configurable: true }); ST.car = r; S.pcar = e; e.owner = e.owner || 'me'; return r; }
  function spawnSaved() { const g = S.game, r = ST.car; if (!r || !g.spawnVehicle) return; if (r.x > SH.x0 - .5 && r.x < SH.x1 + .5 && r.z > SH.z0 - .5 && r.z < SH.z1 + .5) { r.x = PARK[0]; r.z = PARK[1]; r.h = PARK[2]; save(); }   /* never put it back inside the shop */ for (const o of (g.G && g.G.ents) || []) if (o.alive && o.mode === 'parked' && !o.two && hyp(o.x - r.x, o.z - r.z) < 2.6 && o !== g.player.ent) safe(() => g.removeVehicle(o));
    const e = safe(() => g.spawnVehicle(r.kind, r.x, r.z, r.h, { color: hexN(r.col0), mode: 'parked', plate: r.plate || undefined, opts: r.variant ? { variant: r.variant } : undefined }), null); if (!e) return;
    Object.defineProperty(r, 'ent', { value: e, writable: true, enumerable: false, configurable: true }); S.pcar = e; e.owner = 'me'; if (r.variant && GT.coast && GT.coast.openTop) GT.coast.openTop.add(e); apply(e, r.mods); if (r.clean) wash(e, true); }
  function pcarStep(dt) { const r = ST.car; if (!r) return; const g = S.game, e = S.pcar; S.pcarT -= dt; if (S.pcarT > 0) return; S.pcarT = 1;
    if (!e || !e.alive) { const cp = g.camera ? g.camera.position : { x: 0, z: 0 }; if (hyp(cp.x - r.x, cp.z - r.z) > 70) spawnSaved(); return; }
    if (g.player.ent !== e && e.mode === 'parked' && hyp(e.x - r.x, e.z - r.z) > .8) { r.x = +e.x.toFixed(2); r.z = +e.z.toFixed(2); r.h = +e.h.toFixed(3); save(); } }
  function wash(e, quiet) { const X = carState(e); if (X.paint.userData.gtDust) X.paint.userData.gtDust.value.z = 0; if (X.p2.userData.gtDust) X.p2.userData.gtDust.value.z = 0; if (!quiet && ST.car && ST.car.ent === e) { ST.car.clean = true; save(); } }

  /* ================================================================== horns: the bought horn replaces the stock one (a wrap round js/samples.js's sfx hook) */
  function hornName(e) { const m = e && e.cmMods; if (!m || !m.horn) return null; const o = O.horn.find(q => q.v === m.horn); return o ? o.s : null; }
  function playHorn(name, hold) { const SM = GT.samples, ac = (GT.audio && GT.audio.ctx) || (SM && SM.ctx); if (!SM) return null; const buf = SM.buffer ? safe(() => SM.buffer(name), null) : null;
    if (!buf || !ac || !ac.createBufferSource) { if (SM.play) safe(() => SM.play(name, { g: .8 })); return null; }
    const src = ac.createBufferSource(), gn = ac.createGain(); src.buffer = buf; gn.gain.value = .75; src.connect(gn); gn.connect((GT.audio && GT.audio.out) || ac.destination); if (hold && buf.duration > .5) { src.loop = true; src.loopStart = buf.duration * .3; src.loopEnd = buf.duration * .7; } src.start(); return { src, gn, ac }; }
  function hornWrap() { const SM = GT.samples; if (!SM || SM._cmWrap || typeof SM.sfx !== 'function') return; const orig = SM.sfx; SM._cmWrap = true;
    SM.sfx = function (name, o) { if (name === 'horn' && o && o.on !== undefined) { const g = S.game, e = g && g.player && g.player.mode === 'car' ? g.player.ent : null, h = hornName(e);
        if (h) { if (o.on && !S.hornV) S.hornV = playHorn(h, true) || { dummy: true }; else if (!o.on && S.hornV) { const v = S.hornV; S.hornV = null; if (v.src) safe(() => { v.gn.gain.setTargetAtTime(0, v.ac.currentTime, .03); v.src.stop(v.ac.currentTime + .15); }); } return true; } }
      return orig.apply(this, arguments); }; }

  /* ================================================================== the building (coast map only) */
  const SH = { x0: 43.6, x1: 56.6, z0: 29.6, z1: 45.6, H: 5.6, dx: 50.1, dw: 5.6, dh: 4.0, lx: 50.1, lz: 38.4, t: .25 };
  const IN = { x0: SH.x0 + SH.t + .35, x1: SH.x1 - SH.t - .35, z0: SH.z0 + SH.t + .35, z1: SH.z1 - SH.t - .35 };
  const ZONE = { x0: SH.dx - 3.2, x1: SH.dx + 3.2, z0: SH.z0 - 7.5, z1: SH.z0 - .1 }, PARK = [54.7, 26.4, PI];
  function img(name, rep) { const t = GT.tex && GT.tex.image ? GT.tex.image('assets/tex/shops/' + name + '.jpg', { repeat: rep || [1, 1] }) : null; return t; }
  function signTexture(w, h, draw) { return canvasTex(w, h, draw); }
  function buildShop(scene) { const root = new T.Group(); root.name = 'carmods_shop'; const k = GT.kit(), x0 = SH.x0, x1 = SH.x1, z0 = SH.z0, z1 = SH.z1, H = SH.H, t = SH.t, W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const floorM = new T.MeshStandardMaterial({ map: img('garage_floor', [W / 3.2, D / 3.2]), color: 0x8a8f96, roughness: .3, metalness: 0, envMapIntensity: 1.2 }); floorM.userData.gtProbeK = 1;
    const wallIn = new T.MeshStandardMaterial({ map: img('garage_wall', [1, 1]), color: 0xb4b2ad, roughness: .86 }), wallOut = mat('stucco_white', { color: 0xe9e6df }), trim = mat('metal_painted_blue', { color: 0x1d3a6e }), roof = mat('concrete', { color: 0x8f8f8c }), ceil = new T.MeshStandardMaterial({ color: 0x3b3e43, roughness: .8, metalness: .2 });
    const quad = (m, w, h, x, y, z, ry, rx, rep) => { const q = new T.PlaneGeometry(w, h); if (rep) { const uv = q.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / rep, uv.getY(i) * h / rep); } k.geo(m, q, { x, y, z, ry: ry || 0, rx: rx || 0 }); };
    /* floor, walls (inside: block; outside: white render with a blue band), ceiling, roof */
    quad(floorM, W - 2 * t, D - 2 * t, cx, .012, cz, 0, -HP);
    quad(wallIn, D - 2 * t, H - .02, x0 + t + .012, H / 2, cz, HP, 0, 2.4); quad(wallIn, D - 2 * t, H - .02, x1 - t - .012, H / 2, cz, -HP, 0, 2.4); quad(wallIn, W - 2 * t, H - .02, cx, H / 2, z1 - t - .012, PI, 0, 2.4);
    const dl = SH.dx - SH.dw / 2, dr = SH.dx + SH.dw / 2; quad(wallIn, dl - x0 - t, H, (x0 + t + dl) / 2, H / 2, z0 + t + .012, 0, 0, 2.4); quad(wallIn, x1 - t - dr, H, (dr + x1 - t) / 2, H / 2, z0 + t + .012, 0, 0, 2.4); quad(wallIn, SH.dw, H - SH.dh, SH.dx, (H + SH.dh) / 2, z0 + t + .012, 0, 0, 2.4);
    quad(ceil, W - 2 * t, D - 2 * t, cx, H - .02, cz, 0, HP);
    k.box(wallOut, t, H + .3, D, x0 + t / 2, (H + .3) / 2, cz).box(wallOut, t, H + .3, D, x1 - t / 2, (H + .3) / 2, cz).box(wallOut, W, H + .3, t, cx, (H + .3) / 2, z1 - t / 2);
    k.box(wallOut, dl - x0, H + .3, t, (x0 + dl) / 2, (H + .3) / 2, z0 + t / 2).box(wallOut, x1 - dr, H + .3, t, (dr + x1) / 2, (H + .3) / 2, z0 + t / 2).box(wallOut, SH.dw, H + .3 - SH.dh, t, SH.dx, (H + .3 + SH.dh) / 2, z0 + t / 2);
    k.box(roof, W + .2, .22, D + .2, cx, H + .19, cz); for (const [a, b] of [[x0, x1]]) { k.box(trim, b - a + .3, .35, .3, (a + b) / 2, H + .42, z0 - .02).box(trim, b - a + .3, .35, .3, (a + b) / 2, H + .42, z1 + .02); } k.box(trim, .3, .35, D + .3, x0 - .02, H + .42, cz).box(trim, .3, .35, D + .3, x1 + .02, H + .42, cz);
    k.box(trim, W + .04, .5, .06, cx, 1.0, z0 - .03).box(trim, .06, .5, D, x0 - .03, 1.0, cz).box(trim, .06, .5, D, x1 + .03, 1.0, cz);
    /* the door frame: yellow / black chevrons up both jambs and along the lintel */
    const chev = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#f2c21a'; g.fillRect(0, 0, w, h); g.fillStyle = '#141414'; for (let y = -w; y < h + w; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + 20); g.lineTo(w, y + 40); g.lineTo(0, y + 20); g.fill(); } }, { rep: true }); chev.repeat.set(1, 3);
    const chevM = new T.MeshStandardMaterial({ map: chev, roughness: .6 });
    for (const s of [-1, 1]) k.box(chevM, .22, SH.dh, .34, SH.dx + s * (SH.dw / 2 + .11), SH.dh / 2, z0 - .05); k.box(chevM, SH.dw + .44, .24, .34, SH.dx, SH.dh + .12, z0 - .05);
    /* the sign over the door */
    const signT = signTexture(1024, 192, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0f1f3d'); gr.addColorStop(1, '#0a1428'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#f2c21a'; g.fillRect(0, h - 14, w, 14); g.fillRect(0, 0, w, 6);
      g.save(); g.translate(96, h / 2 - 4); g.rotate(-.6); g.fillStyle = '#f4f4f1'; g.fillRect(-12, -60, 24, 92); g.beginPath(); g.arc(0, -64, 30, 0, TAU); g.fill(); g.fillStyle = '#0f1f3d'; g.fillRect(-10, -100, 20, 40); g.restore();
      let fs = 104; const ff = px => 'italic 900 ' + px + 'px "Avenir Next","Helvetica Neue",Arial,sans-serif'; g.font = ff(fs); const tw = g.measureText('MOONBAY CUSTOMS').width; if (tw > w - 210) { fs *= (w - 210) / tw; g.font = ff(fs); }
      g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.fillText('MOONBAY', 175, h / 2 - 6); const mw = g.measureText('MOONBAY ').width; g.fillStyle = '#f2c21a'; g.fillText('CUSTOMS', 175 + mw, h / 2 - 6); });
    const signM = new T.MeshStandardMaterial({ map: signT, emissiveMap: signT, emissive: new T.Color(1, 1, 1), emissiveIntensity: .3, roughness: .4 }); S.signM = signM;
    k.box(mat('metal_dark'), 8.6, 1.5, .25, SH.dx, SH.dh + 1.05, z0 - .2); k.geo(signM, new T.PlaneGeometry(8.4, 1.36), { x: SH.dx, y: SH.dh + 1.05, z: z0 - .335, ry: PI });
    const subT = signTexture(1024, 96, (g, w, h) => { g.fillStyle = '#f2c21a'; g.fillRect(0, 0, w, h); g.fillStyle = '#121212'; g.font = '800 54px "PingFang SC","Hiragino Sans GB",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('月湾改装 · 喷漆 · 轮毂 · 车身 · 性能 · 修理', w / 2, h / 2 + 2); });
    for (const s of [-1, 1]) k.geo(new T.MeshStandardMaterial({ map: subT, roughness: .5 }), new T.PlaneGeometry(3.4, .32), { x: SH.dx + s * (SH.dw / 2 + 2.1), y: 3.2, z: z0 - .01, ry: PI });
    /* inside: the lift, floor markings, the tool wall, tyre racks, a bench, a banner, fluorescent tubes */
    const blue = mat('metal_painted_blue', { color: 0x1f4f9a }), steel = mat('metal_galv'), yel = mat('metal_painted_yellow');
    for (const s of [-1, 1]) { const px = SH.lx + s * .82; k.box(steel, .56, .03, 5.2, px, .015, SH.lz).box(yel, .05, .035, 5.2, px + .3, .018, SH.lz).box(yel, .05, .035, 5.2, px - .3, .018, SH.lz); }   /* a flush scissor lift: two runways in the floor */
    k.box(blue, 2.4, .02, 4.2, SH.lx, .011, SH.lz);
    const markT = canvasTex(256, 512, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#f2c21a'; g.lineWidth = 12; g.strokeRect(8, 8, w - 16, h - 16); g.fillStyle = 'rgba(242,194,26,.9)'; for (let y = 30; y < h - 30; y += 46) { g.save(); g.translate(w / 2, y); g.fillRect(-w * .38, 0, w * .76, 6); g.restore(); } });
    k.geo(new T.MeshStandardMaterial({ map: markT, transparent: true, roughness: .5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), new T.PlaneGeometry(3.0, 5.6), { x: SH.lx, y: .02, z: SH.lz, rx: -HP });
    const toolM = new T.MeshStandardMaterial({ map: img('toolwall'), roughness: .55 }); k.geo(toolM, new T.PlaneGeometry(7.2, 2.95), { x: x0 + t + .05, y: 1.5, z: cz + 2.2, ry: HP });
    const tyreG = mat('rubber', { color: 0x161618, rough: .8 }); for (let r = 0; r < 3; r++) { k.box(steel, .55, .04, 2.3, x1 - t - .3, .08 + r * .86, z1 - 1.95); for (let i = 0; i < 7; i++) k.cyl(tyreG, .34, .34, .22, x1 - t - .3, .44 + r * .86, z1 - 1.0 - i * .3, { rx: HP, seg: 18 }); } for (const zz of [z1 - .82, z1 - 3.08]) k.box(mat('metal_dark'), .5, 2.6, .05, x1 - t - .3, 1.3, zz);
    for (let i = 0; i < 4; i++) k.cyl(tyreG, .33, .33, .23, x1 - 1.0, .12 + i * .235, z0 + 1.6, { seg: 18 });
    k.box(mat('metal_painted_red', { color: 0xa3161a }), 2.2, .9, .62, x1 - t - .35, .45, cz - 1.2, { ry: HP }).box(mat('wood_plank'), 2.3, .05, .7, x1 - t - .38, .93, cz - 1.2, { ry: HP });
    k.box(mat('metal_painted_red', { color: 0xa3161a }), .7, 1.0, .5, x0 + t + .6, .5, z0 + 1.4).cyl(mat('metal_painted_blue', { color: 0x2a5aa8 }), .22, .22, .8, x0 + t + 1.5, .4, z0 + 1.2, { seg: 16 });
    const banT = signTexture(1024, 256, (g, w, h) => { g.fillStyle = '#0f1f3d'; g.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#f4f4f1' : '#111'; g.fillRect(i * 24, j * 24 + 8, 24, 24); g.fillRect(w - 384 + i * 24, j * 24 + 8, 24, 24); }
      g.font = 'italic 900 96px "Avenir Next","Helvetica Neue",Arial,sans-serif'; { const tw = g.measureText('MOONBAY CUSTOMS').width; if (tw > w * .92) g.font = 'italic 900 ' + (96 * w * .92 / tw) + 'px "Avenir Next","Helvetica Neue",Arial,sans-serif'; } g.fillStyle = '#f2c21a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('MOONBAY CUSTOMS', w / 2, h * .62); g.font = '800 40px "PingFang SC",sans-serif'; g.fillStyle = '#fff'; g.fillText('月 湾 改 装  ·  PORT VERMONT', w / 2, h * .2); });
    k.geo(new T.MeshStandardMaterial({ map: banT, roughness: .7 }), new T.PlaneGeometry(6.4, 1.6), { x: cx, y: 3.9, z: z1 - t - .03, ry: PI });
    const tube = new T.MeshBasicMaterial({ color: new T.Color(3.2, 3.2, 3.0) }); S.tubeM = tube; for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { const zz = z0 + 3.2 + i * 4.6, xx = cx + s * 2.6; k.box(mat('metal_dark'), .26, .08, 2.5, xx, H - .14, zz).geo(tube, new T.BoxGeometry(.12, .03, 2.3), { x: xx, y: H - .19, z: zz }); }
    const g = k.build(); root.add(g);
    /* the roller door: a slatted panel that rolls up into its box (k = 0 down .. 1 up) */
    const shT = GT.tex && GT.tex.image ? GT.tex.image('assets/tex/shutter.jpg', { repeat: [SH.dw / 2.5, 1.6] }) : null, doorM = new T.MeshStandardMaterial({ map: shT, color: 0xb9bec4, roughness: .45, metalness: .6, side: T.DoubleSide });
    const door = new T.Mesh(new T.PlaneGeometry(SH.dw, SH.dh), doorM); door.position.set(SH.dx, SH.dh / 2, z0 + .02); door.castShadow = true; root.add(door); S.doorMesh = door;
    const dbox = new T.Mesh(new T.CylinderGeometry(.3, .3, SH.dw + .2, 16), mat('metal_dark')); dbox.rotation.z = HP; dbox.position.set(SH.dx, SH.dh + .3, z0 + .25); root.add(dbox);
    /* the drive-in marker on the yard in front of the door */
    const mkT = canvasTex(512, 512, (g2, w, h) => { g2.clearRect(0, 0, w, h); g2.strokeStyle = '#ffd23f'; g2.lineWidth = 18; const r = 46; g2.beginPath(); g2.moveTo(r + 12, 12); g2.arcTo(w - 12, 12, w - 12, h - 12, r); g2.arcTo(w - 12, h - 12, 12, h - 12, r); g2.arcTo(12, h - 12, 12, 12, r); g2.arcTo(12, 12, w - 12, 12, r); g2.closePath(); g2.stroke();
      g2.fillStyle = '#ffd23f'; for (let i = 0; i < 3; i++) { const y = 70 + i * 92; g2.beginPath(); g2.moveTo(w / 2, y); g2.lineTo(w / 2 + 120, y + 70); g2.lineTo(w / 2 + 80, y + 70); g2.lineTo(w / 2, y + 22); g2.lineTo(w / 2 - 80, y + 70); g2.lineTo(w / 2 - 120, y + 70); g2.closePath(); g2.fill(); }
      g2.font = '900 54px "PingFang SC","Hiragino Sans GB",sans-serif'; g2.textAlign = 'center'; g2.fillText('开进来改装', w / 2, h - 96); g2.font = '800 34px "Avenir Next",Arial,sans-serif'; g2.fillText('DRIVE IN', w / 2, h - 50); });
    const mkM = new T.MeshBasicMaterial({ map: mkT, transparent: true, depthWrite: false, color: new T.Color(1.6, 1.4, .6), opacity: .85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); S.markM = mkM;
    const mk = new T.Mesh(new T.PlaneGeometry(5.6, 5.6), mkM); mk.rotation.x = -HP; mk.rotation.z = PI; mk.position.set(SH.dx, .03, z0 - 3.4); mk.renderOrder = 3; root.add(mk);
    /* an upright marker over it, seen from the street: a turning spray-can-and-wrench badge with a down arrow, bobbing */
    const bT = canvasTex(256, 384, (g2, w, h) => { g2.clearRect(0, 0, w, h); g2.fillStyle = '#ffd23f'; g2.beginPath(); g2.arc(w / 2, 118, 104, 0, TAU); g2.fill(); g2.fillStyle = '#141414'; g2.beginPath(); g2.arc(w / 2, 118, 86, 0, TAU); g2.fill();
      g2.save(); g2.translate(w / 2 - 20, 128); g2.rotate(-.5); g2.fillStyle = '#ffd23f'; g2.fillRect(-9, -44, 18, 70); g2.beginPath(); g2.arc(0, -48, 22, 0, TAU); g2.fill(); g2.fillStyle = '#141414'; g2.fillRect(-8, -74, 16, 30); g2.restore();
      g2.save(); g2.translate(w / 2 + 30, 118); g2.fillStyle = '#ffd23f'; g2.fillRect(-18, -28, 36, 66); g2.fillRect(-8, -42, 16, 14); g2.restore();
      g2.fillStyle = '#ffd23f'; g2.beginPath(); g2.moveTo(w / 2 - 70, 250); g2.lineTo(w / 2 + 70, 250); g2.lineTo(w / 2, 360); g2.closePath(); g2.fill(); });
    const bM = new T.MeshBasicMaterial({ map: bT, transparent: true, depthWrite: false, side: T.DoubleSide, color: new T.Color(1.5, 1.35, .7), fog: false }); const bd = new T.Mesh(new T.PlaneGeometry(1.5, 2.25), bM); bd.position.set(SH.dx, 2.3, z0 - 3.4); bd.renderOrder = 4; root.add(bd); S.badge = bd;
    scene.add(root); S.root = root;
    /* colliders: the four walls (a gap for the door) and the door itself while it is down */
    const B = (a, b, c, d, h, tag) => { const o = { x0: min(a, c), z0: min(b, d), x1: max(a, c), z1: max(b, d), h, tag: 'shop:customs' + (tag || '') }; GT.world.boxes.push(o); return o; };
    if (GT.world && GT.world.boxes) { B(x0, z0, x0 + t, z1, H); B(x1 - t, z0, x1, z1, H); B(x0, z1 - t, x1, z1, H); B(x0, z0, dl, z0 + t, H); B(dr, z0, x1, z0 + t, H); S.doorBox = B(dl, z0, dr, z0 + t, 0, ':door');
      B(x1 - t - .6, z1 - 3.1, x1 - t, z1 - .8, 2.6, ':rack'); B(x1 - t - .7, cz - 2.35, x1 - t, cz - .05, 1, ':bench'); }
    /* a mechanic by the tool wall */
    safe(() => { if (!GT.people || !GT.people.make) return; const f = GT.people.make('worker', { seed: 41 }); if (!f || !f.group) return; f.group.position.set(x0 + t + 1.3, 0, cz + 1.0); f.group.rotation.y = HP + .5; root.add(f.group); S.mech = f; }); }

  /* ================================================================== the menu (DOM; styles in css/cn.css g6-garage) */
  const UI = { root: null, rows: null,
    init() { if (UI.root) return; const r = UI.root = document.createElement('div'); r.id = 'cm-ui';
      r.innerHTML = '<div class="cm-menu"><div class="cm-head"><small>MOONBAY CUSTOMS</small><b>月湾改装</b></div><div class="cm-path"><span></span><em></em></div><div class="cm-rows"></div><div class="cm-desc"></div>' +
        '<div class="cm-stats">' + [['acc', '加速'], ['top', '极速'], ['brake', '刹车'], ['grip', '操控']].map(s => '<div class="cm-st" data-k="' + s[0] + '"><span>' + s[1] + '</span><div><i class="b"></i><i class="a"></i></div></div>').join('') + '</div>' +
        '<div class="cm-foot"><div class="cm-sum"><span>价格</span><b class="pr"></b></div><div class="cm-sum w"><span>钱包</span><b class="wl"></b></div><div class="cm-warn"></div><div class="cm-keys"></div></div></div><div class="cm-note"><b></b><small></small></div>';
      document.body.appendChild(r); UI.rows = r.querySelector('.cm-rows'); },
    show(on) { if (!UI.root) return; UI.root.classList.toggle('on', !!on); document.body.classList.toggle('cm-open', !!on); },
    note(a, b, bad) { if (!UI.root) return; const n = UI.root.querySelector('.cm-note'); n.firstChild.textContent = a; n.lastChild.textContent = b || ''; n.classList.toggle('bad', !!bad); n.classList.remove('on'); void n.offsetWidth; n.classList.add('on'); clearTimeout(UI.nt); UI.nt = setTimeout(() => n.classList.remove('on'), 2400); } };
  const kbd = (ks, t) => '<span>' + ks.map(k => '<kbd>' + k + '</kbd>').join('') + '<em>' + t + '</em></span>';
  function draw() { const M = S.menu; if (!M || !UI.root) return; const lv = M.stack[M.stack.length - 1], rows = lv.rows, n = rows.length, vis = 9, a = clamp(lv.sel - 4, 0, max(0, n - vis)), R = UI.rows, wl = (GT.wallet && GT.wallet.cash) || 0;
    UI.root.querySelector('.cm-path span').textContent = M.stack.length > 1 ? M.stack.slice(1).map(l => l.title).join(' · ') : '选择要改的部分'; UI.root.querySelector('.cm-path em').textContent = (lv.sel + 1) + ' / ' + n;
    R.innerHTML = rows.slice(a, a + vis).map((r, i) => '<div class="cm-row' + (a + i === lv.sel ? ' sel' : '') + (r.cur ? ' cur' : '') + '">' + (r.sw ? '<s style="background:' + r.sw + '"></s>' : '') + '<span class="n"></span><span class="p"></span></div>').join('');
    rows.slice(a, a + vis).forEach((r, i) => { const el = R.children[i]; el.querySelector('.n').textContent = r.n; el.querySelector('.p').textContent = r.right || ''; });
    const cur = rows[lv.sel] || {}; UI.root.querySelector('.cm-desc').textContent = cur.d || ''; UI.root.querySelector('.pr').textContent = cur.price !== undefined ? (cur.price ? money(cur.price) : (cur.cur ? '已安装' : '免费')) : '—';
    UI.root.querySelector('.wl').textContent = money(wl); const wn = UI.root.querySelector('.cm-warn'), short = cur.price && !cur.cur && cur.price > wl; wn.textContent = short ? '钱不够 · 还差 ' + money(cur.price - wl) : ''; wn.classList.toggle('on', !!short);
    UI.root.querySelector('.cm-keys').innerHTML = kbd(['W', 'S'], '选择') + kbd(['E'], lv.leaf ? '购买' : '进入') + kbd(['X'], M.stack.length > 1 ? '返回' : '开走') + kbd(['鼠标'], '转镜头');
    const st0 = stats(S.car, S.car.cmBought || DEF), st1 = stats(S.car, M.prev || S.car.cmBought || DEF);
    for (const el of UI.root.querySelectorAll('.cm-st')) { const kk = el.getAttribute('data-k'), b = st0[kk], c = st1[kk]; el.querySelector('.b').style.width = (min(b, c) * 100).toFixed(1) + '%'; const ai = el.querySelector('.a'); ai.style.left = (min(b, c) * 100).toFixed(1) + '%'; ai.style.width = (abs(c - b) * 100).toFixed(1) + '%'; ai.className = 'a' + (c < b ? ' dn' : ''); }
    UI.root.querySelector('.cm-stats').classList.toggle('on', true); }
  function rowsOf(node) { const e = S.car, m = e.cmBought || DEF;
    if (node.kids) return node.kids.map(c => ({ n: c.n, node: c, right: c.kids ? '›' : c.act ? (c.act === 'repair' ? (dmgOf(e) > .01 ? money(repairCost(e)) : '车况良好') : money(25)) : optName(c.key, m[c.key]), d: c.d || '' }));
    return O[node.key].map(o => { const cur = (m[node.key] || (typeof DEF[node.key] === 'number' ? 0 : '')) === o.v; return { n: o.n, o, sw: o.sw || (node.key === 'c1' && !o.v ? S.car.veh._cm.col0 : null), cur, price: cur ? 0 : o.p, right: cur ? '✓ 已安装' : o.p ? money(o.p) : '免费', d: o.d || node.d || '' }; }); }
  const optName = (key, v) => { const o = O[key] && O[key].find(q => q.v === v); return o ? o.n : ''; };
  const dmgOf = e => (e && e.c && e.c.damage) || 0, repairCost = e => Math.round(60 + dmgOf(e) * 2400);
  function menuOpen() { const M = S.menu = { stack: [], prev: null }; push(TREE); UI.init(); UI.show(true); draw(); }
  function push(node) { const M = S.menu, rows = rowsOf(node), sel = node.kids ? 0 : max(0, rows.findIndex(r => r.cur)); M.stack.push({ node, rows, sel, title: node.n, leaf: !node.kids && !node.act }); onSel(); }
  function onSel() { const M = S.menu, lv = M.stack[M.stack.length - 1], r = lv.rows[lv.sel]; if (!r) return; const e = S.car;
    if (lv.leaf) { const m = Object.assign({}, e.cmBought || DEF); m[lv.node.key] = r.o.v; M.prev = m; apply(e, m); if (lv.node.key === 'horn') S.hornPrev = .25; S.camKey = lv.node.cam; }
    else { M.prev = null; apply(e, e.cmBought || DEF); S.camKey = (r.node && r.node.cam) || (lv.node === TREE ? 'root' : lv.node.cam || 'root'); }
    S.glowPrev = lv.leaf && lv.node.key === 'glow'; draw(); }
  function back() { const M = S.menu; if (M.stack.length > 1) { M.stack.pop(); const lv = M.stack[M.stack.length - 1]; lv.rows = rowsOf(lv.node); sfx('ui_close'); onSel(); return; } leave(); }
  function choose() { const M = S.menu, lv = M.stack[M.stack.length - 1], r = lv.rows[lv.sel], e = S.car, W = GT.wallet; if (!r) return;
    if (!lv.leaf && r.node) { if (r.node.act) return act(r.node.act); sfx('ui_tick'); push(r.node); return; }
    if (r.cur) { UI.note(r.n, '已经装在车上了'); sfx('ui_bad'); return; }
    if (r.price > 0 && !(W && W.spend && W.spend(r.price))) { sfx('ui_bad'); UI.note('钱不够', '还差 ' + money(r.price - ((W && W.cash) || 0)), true); const wn = UI.root.querySelector('.cm-warn'); wn.classList.remove('nag'); void wn.offsetWidth; wn.classList.add('nag'); return; }
    const rec = ST.car && ST.car.ent === e ? ST.car : adopt(e), m = Object.assign({}, e.cmBought || DEF); rec.x = SH.dx; rec.z = SH.z0 - 3; rec.h = PI; m[lv.node.key] = r.o.v; rec.mods = m; e.cmBought = m; apply(e, m); save(); sfx('cash'); if (r.price) UI.note('已购买 · ' + lv.title + ' · ' + r.n, '−' + money(r.price)); else UI.note('已换回 · ' + r.n, '');
    if (lv.node.key === 'c1') S.resprayed = true; lv.rows = rowsOf(lv.node); lv.sel = lv.rows.findIndex(q => q.cur); onSel(); }
  function act(what) { const e = S.car, W = GT.wallet;
    if (what === 'repair') { const d = dmgOf(e); if (d <= .01) { UI.note('车况良好', '没有要修的地方'); return; } const p = repairCost(e); if (!(W && W.spend && W.spend(p))) { sfx('ui_bad'); UI.note('钱不够', '还差 ' + money(p - ((W && W.cash) || 0)), true); return; } e.c.damage = 0; S.lastDmg = 0; e.smoke = 0; sfx('cash'); UI.note('已修好', '−' + money(p)); }
    else if (what === 'wash') { if (!(W && W.spend && W.spend(25))) { sfx('ui_bad'); UI.note('钱不够', '洗车 $25', true); return; } wash(e); if (!ST.car || ST.car.ent !== e) S.washTmp = true; sfx('cash'); UI.note('洗干净了', '−$25'); }
    const lv = S.menu.stack[S.menu.stack.length - 1]; lv.rows = rowsOf(lv.node); draw(); }
  const sfx = n => { if (GT.audio && GT.audio.sfx) safe(() => GT.audio.sfx(n)); };

  /* ================================================================== the visit: drive in, menu, drive out */
  const camOf = key => { const e = S.car, d = e.dims, P = e.veh._cm ? e.veh._cm.P : { zF: d.L / 2, zR: -d.L / 2 }, tr = d.track / 2;
    return ({ root: [S.t * .16, 6.2, 1.75, 0, .6, 0, 46], q3: [.78, 5.7, 1.55, 0, .62, 0, 44], q3r: [PI - .8, 5.6, 1.7, 0, .7, -.2, 44], wheel: [HP - .32, 3.1, .62, tr, .36, d.axleF, 38], front: [.16, 4.3, .72, 0, .42, P.zF - .4, 42],
      side: [HP + .05, 5.4, .75, 0, .42, 0, 44], rear: [PI - .42, 4.9, 2.05, 0, .9, P.zR + .4, 44], hood: [.42, 3.8, 2.5, 0, .85, P.zF - .95, 44], win: [HP + .35, 4.5, 1.35, 0, 1.0, 0, 42],
      plate: [PI + .02, 3.5, .85, 0, .55, P.zR, 36], low: [.95, 5.0, .5, 0, .2, 0, 48], perf: [.55, 5.5, 1.25, 0, .55, 0, 44] })[key] || [S.t * .16, 6.2, 1.75, 0, .6, 0, 46]; };
  function camStep(dt) { const e = S.car; if (!e || !S.cut) return; const c = S.cam || (S.cam = { a: .6, r: 6, y: 1.7, tx: 0, ty: .6, tz: 0, f: 46, man: 0 }), w = camOf(S.camKey || 'root'), k = 1 - Math.exp(-dt * 2.6);
    const drift = S.camKey === 'root' || !S.camKey ? 0 : sin(S.t * .32) * .22;   /* the slow sway round the part being chosen */
    const I = GT.input; if (I && I.look && document.pointerLockElement) c.man = clamp(c.man - (I.look.dx || 0) * .8, -PI, PI); c.man *= Math.exp(-dt * .25);
    c.a += dang(c.a, w[0] + drift + c.man) * k; c.r += (w[1] - c.r) * k; c.y += (w[2] - c.y) * k; c.tx += (w[3] - c.tx) * k; c.ty += (w[4] - c.ty) * k; c.tz += (w[5] - c.tz) * k; c.f += (w[6] - c.f) * k;
    const h = e.h, fx = sin(h), fz = cos(h), rx = cos(h), rz = -sin(h), ta = h + c.a, px0 = e.x + sin(ta) * c.r, pz0 = e.z + cos(ta) * c.r, px = clamp(px0, IN.x0, IN.x1), pz = clamp(pz0, IN.z0, IN.z1);
    const tx = e.x + rx * c.tx + fx * c.tz, tz = e.z + rz * c.tx + fz * c.tz, sh = S.cut; sh.p[0][0] = px; sh.p[0][1] = c.y; sh.p[0][2] = pz; sh.l[0][0] = tx; sh.l[0][1] = c.ty; sh.l[0][2] = tz; sh.f[0] = c.f; }
  function startCut(p, l, f) { const g = S.game, sh = { p: [p.slice()], l: [l.slice()], f: [f || 46], d: 1e6, sh: 0 }; S.cut = sh; safe(() => g.cutscene([sh], { live: true, letterbox: false, hud: false, fade: false })); }
  function endCut() { if (!S.cut) return; S.cut = null; const g = S.game; safe(() => { if (g.sim && g.sim.endCutscene) g.sim.endCutscene(); else if (g.skipCutscene) g.skipCutscene(); }); }
  function pin(e, x, z, h, v) { e.x = x; e.z = z; e.h = h; e.v = v || 0; if (e.c) { e.c.vx = v || 0; e.c.vy = 0; e.c.r = 0; } }
  function canEnter(e) { const g = S.game, W = g.wanted && g.wanted.state; if (!e || e.two) return '这里只改汽车'; if (/^(police|copsuv|bus|boxtruck|ambulance)$/.test(e.kind)) return e.kind === 'police' || e.kind === 'copsuv' ? '警车不接' : '车太大，进不去';
    if (W && W.seenBy > 0) return '警察看着呢 · 先甩掉再来'; const G = g.G, cops = (G && G.cops) || []; if (W && W.stars > 0) for (const c of cops) if (c && c.alive !== false && hyp(c.x - SH.dx, c.z - SH.z0) < 38) return '警车就在门口 · 先甩掉再来';   /* the shop must be out of their sight */ return ''; }
  function enter(e) { const g = S.game, why = canEnter(e); if (why) { if (S.t - (S.nagT || -9) > 4) { S.nagT = S.t; safe(() => g.sim.HUD.toast('月湾改装', why)); } return false; }
    S.car = e; S.phase = 'in'; S.resprayed = false; S.washTmp = false; const W = g.wanted.state; S.entry = { stars: W ? W.stars : 0 }; e.cmBought = isMine(e) ? norm(ST.car.mods) : (e.cmMods ? norm(e.cmMods) : Object.assign({}, DEF));
    safe(() => g.setControl(false)); S.door.want = 1; S.lent = safe(() => GT.combat && GT.combat.lendLights ? GT.combat.lendLights(true) : null, null); lights(true);
    const p0 = [e.x, e.z], h0 = e.h, D = [SH.dx, SH.z0 - .2], L = [SH.lx, SH.lz], pts = []; for (let i = 0; i <= 24; i++) { const u = i / 24, a = 1 - u, c1 = [p0[0] + sin(h0) * 2.4, p0[1] + cos(h0) * 2.4], c2 = [D[0], D[1] - 2.4];
      pts.push([a * a * a * p0[0] + 3 * a * a * u * c1[0] + 3 * a * u * u * c2[0] + u * u * u * D[0], a * a * a * p0[1] + 3 * a * a * u * c1[1] + 3 * a * u * u * c2[1] + u * u * u * D[1]]); }
    for (let i = 1; i <= 12; i++) pts.push([D[0] + (L[0] - D[0]) * i / 12, D[1] + (L[1] - D[1]) * i / 12]); const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    S.path = { pts, cum, s: 0, v: Math.min(5, abs(e.v) || 3), len: cum[cum.length - 1] }; S.cam = null; startCut([SH.x0 + 1.4, 2.7, SH.z1 - 1.3], [e.x, .8, e.z], 52); sfx('ui_open'); return true; }
  function pathAt(s) { const P = S.path, n = P.pts.length; let i = 1; while (i < n - 1 && P.cum[i] < s) i++; const a = P.pts[i - 1], b = P.pts[i], u = clamp((s - P.cum[i - 1]) / max(1e-6, P.cum[i] - P.cum[i - 1]), 0, 1); return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), Math.atan2(b[0] - a[0], b[1] - a[1])]; }
  function inStep(dt) { const e = S.car, P = S.path; if (!e || !e.alive) return abort(); const left = P.len - P.s, vt = clamp(left * .9, .5, 4.2); P.v += clamp(vt - P.v, -4 * dt, 3 * dt); P.s = min(P.len, P.s + P.v * dt); const q = pathAt(P.s);
    pin(e, q[0], q[1], e.h + dang(e.h, q[2]) * min(1, dt * 8), P.v); if (S.cut) { const sh = S.cut; sh.l[0][0] = lerp(sh.l[0][0], e.x, min(1, dt * 6)); sh.l[0][2] = lerp(sh.l[0][2], e.z, min(1, dt * 6)); }
    if (P.s > P.len - .6 && P.v < .9) S.door.want = 0; if (P.s >= P.len - .02) { pin(e, SH.lx, SH.lz, 0, 0); S.phase = 'menu'; S.cam = { a: dang(0, Math.atan2(S.cut.p[0][0] - e.x, S.cut.p[0][2] - e.z)), r: hyp(S.cut.p[0][0] - e.x, S.cut.p[0][2] - e.z), y: S.cut.p[0][1], tx: 0, ty: .8, tz: 0, f: 52, man: 0 }; S.camKey = 'root'; menuOpen(); } }
  function menuStep(dt) { const e = S.car; if (!e || !e.alive) return abort(); pin(e, SH.lx, SH.lz, 0, 0); camStep(dt); if (S.hornPrev > 0) { S.hornPrev -= dt; if (S.hornPrev <= 0) { const lv = S.menu.stack[S.menu.stack.length - 1], r = lv.rows[lv.sel]; if (r && r.o && r.o.s) { const v = playHorn(r.o.s, false); if (v && v.src) safe(() => v.src.stop(v.ac.currentTime + .9)); } } }
    const I = GT.input; if (!I || !I.pressed) return; const M = S.menu; if (performance.now() - (S.keyT || 0) < 110) return; const p = c => { if (I.pressed(c)) { if (I.consume) I.consume(c); S.keyT = performance.now(); return true; } return false; };
    const lv = M.stack[M.stack.length - 1]; if (p('KeyW') || p('ArrowUp')) { lv.sel = (lv.sel - 1 + lv.rows.length) % lv.rows.length; sfx('ui_tick'); onSel(); } else if (p('KeyS') || p('ArrowDown')) { lv.sel = (lv.sel + 1) % lv.rows.length; sfx('ui_tick'); onSel(); }
    else if (p('KeyE') || p('Enter') || p('Space')) choose(); else if (p('KeyX') || p('Escape') || p('Backspace') || p('KeyQ')) back(); }
  function leave() { const e = S.car, g = S.game; if (S.phase !== 'menu') return; S.phase = 'out'; S.outT = 0; UI.show(false); S.menu = null; if (e) apply(e, e.cmBought || DEF); sfx('ui_close'); safe(() => GT.front && GT.front.fade && GT.front.fade(1, 280)); }
  function outStep(dt) { const e = S.car, g = S.game; S.outT += dt; if (!e || !e.alive) return abort();
    if (S.outT < .32) { pin(e, SH.lx, SH.lz, 0, 0); return; }
    if (!S.outDone) { S.outDone = true; S.door.k = S.door.want = 1; pin(e, SH.dx, SH.z0 + 3.6, PI, 0); endCut(); lights(false); safe(() => g.setControl(true)); if (e.c) { e.c.vx = 2.5; e.c.gear = 1; } e.v = 2.5; respray(); safe(() => GT.front && GT.front.fade && GT.front.fade(0, 450)); }
    if (S.outT > .9) { S.phase = 'idle'; S.outDone = false; S.cooldown = 4; const r = ST.car; if (r && r.ent === e) { r.x = +e.x.toFixed(2); r.z = +e.z.toFixed(2); r.h = +e.h.toFixed(3); save(); } S.car = null; } }
  function abort() { UI.show(false); S.menu = null; endCut(); lights(false); safe(() => S.game.setControl(true)); S.phase = 'idle'; S.car = null; S.door.want = 1; S.cooldown = 4; }
  function respray() { const g = S.game, en = S.entry, W = g.wanted && g.wanted.state; if (!en || !W || !(en.stars > 0) || !S.resprayed) return; const e = S.car, before = W.stars;
    if (W.stars <= 2.05) safe(() => g.wanted.clear(false)); else { W.stars = max(0, W.stars - 2); if (W.chips) for (const c of ['car', 'plate']) if (W.chips[c]) W.chips[c].on = false; }
    const plate = 'PV' + String((Math.random() * 9e4 + 1e4) | 0); e.plate = plate; if (ST.car && ST.car.ent === e) { ST.car.plate = plate; save(); } safe(() => GT.cnvehicles.setPlate(e.veh, plate));
    safe(() => g.sim.HUD.toast('喷漆脱身', before <= 2.05 ? '换了颜色和车牌 · 通缉清零' : '换了颜色和车牌 · 通缉 −2 星')); }
  function lights(on) { const L = S.lent; if (!L || !L.length) return; if (on) { const p = [[SH.lx, 4.6, SH.lz + 2.4], [SH.lx, 4.6, SH.lz - 2.6]]; L.forEach((l, i) => { l.position.set(p[i][0], p[i][1], p[i][2]); l.color.setRGB(1, .96, .9); l.distance = 13; l.decay = 1.6; l.intensity = 14; }); }
    else { safe(() => GT.combat.lendLights(false)); S.lent = null; } }
  function doorStep(dt) { const d = S.door; d.k += clamp(d.want - d.k, -dt / 1.3, dt / 1.3); const m = S.doorMesh; if (m) { const vis = 1 - d.k; m.visible = vis > .02; m.scale.y = max(.02, vis); m.position.y = SH.dh - SH.dh * vis / 2; } if (S.doorBox) S.doorBox.h = d.k < .6 ? 4 : 0; }
  function triggerStep() { const g = S.game, P = g.player, e = P.ent; if (S.cooldown > 0 || P.mode !== 'car' || !e || !e.alive) return; if (e.x < ZONE.x0 || e.x > ZONE.x1 || e.z < ZONE.z0 || e.z > ZONE.z1) { S.zoneIn = false; return; }
    if (cos(e.h) < .25 || abs(e.v || 0) > 14) return; if (!S.zoneIn) { S.zoneIn = true; enter(e); } }

  /* ================================================================== init / update */
  function init(game) { if (S.inited) return api; S.inited = true; S.game = game; S.G = game.G || null; S.visual = !!(S.G && S.G.visual && game.scene); if (!S.visual || !GT.coast || Q.get('cm') === '0') return api;
    safe(() => buildShop(game.scene)); safe(hornWrap); if (Q.get('cmcash') && GT.wallet && GT.wallet.add) safe(() => GT.wallet.add(+Q.get('cmcash') - GT.wallet.cash, 'test'));
    api.active = true; return api; }
  function update(dt) { if (!S.inited || !api.active) return; const g = S.game, GG = S.G; S.t += dt; if (GG.phase !== 'play') return;
    safe(doorStep.bind(null, dt)); if (S.cooldown > 0) S.cooldown -= dt;
    if (!S.spawned && S.t > 1.5) { S.spawned = true; safe(spawnSaved); } safe(() => pcarStep(dt)); safe(tuneStep);
    const n = (GT.env && GT.env.night) || 0; if (S.signM) S.signM.emissiveIntensity = .25 + 1.6 * n; if (S.markM) S.markM.opacity = (.7 + .25 * sin(S.t * 3)) * (S.phase === 'idle' ? 1 : .15); if (S.badge) { S.badge.visible = S.phase === 'idle'; S.badge.position.y = 2.3 + sin(S.t * 2.2) * .12; S.badge.rotation.y = S.t * 1.4; }
    for (const X of S.X) if (X.glow) { X.glow.material.opacity = (S.glowPrev && S.car === X.e ? .85 : .28 + .62 * n); }
    if (S.mech && S.mech.update && hyp(g.camera.position.x - SH.lx, g.camera.position.z - SH.lz) < 40) safe(() => S.mech.update(dt, { state: 'idle' }));
    if (S.phase === 'idle') { S.blockT = (S.blockT || 0) - dt; if (S.blockT <= 0) { S.blockT = .5; const W = g.wanted && g.wanted.state, cops = (g.G && g.G.cops) || []; S.door.want = W && W.stars > 0 && (W.seenBy > 0 || cops.some(c => c && hyp(c.x - SH.dx, c.z - SH.z0) < 38)) ? 0 : 1; } safe(triggerStep); }   /* wanted with a unit at the door: the shutter stays down */ else if (S.phase === 'in') safe(() => inStep(dt)); else if (S.phase === 'menu') safe(() => menuStep(dt)); else if (S.phase === 'out') safe(() => outStep(dt)); }
  function reset() { ST = { v: 1, car: null }; save(); }
  function selftest() { const out = [], t = (ok, s) => out.push((ok ? 'PASS ' : 'FAIL ') + 'carmods: ' + s); t(TREE.kids.length >= 10, 'menu has repair, wash, paint, wheels, body, tint, plate, horn, glow, performance');
    t(O.c1.length > 20 && O.fin.length === 5 && O.whl.length >= 6 && O.wing.length === 4, 'paint 20+ colours, 5 finishes, 5-8 wheels, 3 wings'); t(PERF.drop[4] > 0 && PERF.eng[4] > 1.4 && PERF.brake[3] > 1.4, 'performance tables');
    t(SH.lx > IN.x0 + 2 && SH.lx < IN.x1 - 2 && SH.lz - 3 > IN.z0 && SH.lz + 3 < IN.z1, 'the lift is inside the shop with room for the camera'); return out; }
  const api = GT.carmods = { init, update, apply, mods: e => (e && e.cmMods) || null, open: () => { const g = S.game; return g && g.player.ent ? enter(g.player.ent) : false; }, active: false, get rec() { return ST.car; }, get phase() { return S.phase; }, get car() { return S.car; },
    get pcar() { return S.pcar; }, reset, opts: O, tree: TREE, shop: SH, zone: ZONE, perf: PERF, stats, probe, hoodAt, selftest, _S: S, key: k => { const I = GT.input; if (I && I.feed) I.feed({ press: [k] }); } };
})();
