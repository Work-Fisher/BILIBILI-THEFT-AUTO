/* perf.js — frame-rate helpers for the China edition (three r128 global build). Loaded before cngame.js.
   GT.perf = {
     chunkStatic(group, cell?, opts?)  split big merged static meshes into grid cells so camera + shadow frustum culling can work
     chunkWorld(scene)                 chunkStatic on the five world groups (cnroad, riverside, snackstreet, hotpot_world, landmarks)
     update(dt, camera, scene)         once per frame BEFORE rendering: point-light budget + readout
     lights                            { budget, fade0, fade1, on } — at most `budget` point lights are ever in the shaders
     hud(on?)                          fps / ms / triangles / draw calls readout (also ?fps=1, toggled with F3)
     stats                             { fps, ms, worst, tris, calls, lights, chunks }
   }
   Why a light budget: every MeshStandardMaterial fragment loops over EVERY visible point light. The block has 31 of them; measured on an
   Apple M-series GPU at 1440x900 the same frame costs 27 ms with 31 lights and 5 ms with 8 (the geometry itself is ~2 ms).
   The number of visible lights is kept constant, so three.js never has to switch shader programs while you move around.
   Query: ?fps=1 readout   ?chunk=1 chunk the world (off by default, see chunkWorld) &cell= &mintris= &minchunk=   ?lights=<n> budget (0 = unlimited, the old behaviour) */
(function () {
  'use strict';
  const T = THREE, GT = window.GT = window.GT || {};
  const Q = new URLSearchParams(location.search);
  const stats = { fps: 0, ms: 0, worst: 0, tris: 0, calls: 0, lights: 0, lightsLit: 0, chunks: 0, chunkedMeshes: 0, chunkMs: 0 };
  const P = GT.perf = { chunkStatic, chunkWorld, update, hud, stats,
    lights: { budget: Q.get('lights') !== null && isFinite(+Q.get('lights')) ? +Q.get('lights') : 10, fade0: 34, fade1: 70, on: true, pinned: 0 } };

  /* ------------------------------------------------------------------ spatial chunking
     Kit.build() merges a whole zone into ONE mesh per material, so its bounding sphere covers the zone: never culled, drawn again in the
     shadow pass. Here each big mesh is cut into XZ grid cells by triangle centroid. The original Mesh object stays in the tree (modules keep
     references to it): it keeps the first cell, the other cells become its children and share its material. */
  const done = new WeakSet();
  function chunkMesh(mesh, cell, minChunk) {
    const g = mesh.geometry, pos = g.attributes.position, index = g.index;
    const nTri = (index ? index.count : pos.count) / 3 | 0, pa = pos.array, ia = index ? index.array : null;
    if (pos.isInterleavedBufferAttribute) return 0;
    for (const k in g.attributes) if (g.attributes[k].isInterleavedBufferAttribute) return 0;
    const keyOf = new Int32Array(nTri), count = new Map(), inv = 1 / cell;
    for (let t = 0; t < nTri; t++) {
      const a = (ia ? ia[t * 3] : t * 3) * 3, b = (ia ? ia[t * 3 + 1] : t * 3 + 1) * 3, c = (ia ? ia[t * 3 + 2] : t * 3 + 2) * 3;
      const cx = Math.floor((pa[a] + pa[b] + pa[c]) / 3 * inv), cz = Math.floor((pa[a + 2] + pa[b + 2] + pa[c + 2]) / 3 * inv);
      const key = ((cx + 512) << 10) | (cz + 512); keyOf[t] = key; count.set(key, (count.get(key) || 0) + 1);
    }
    if (count.size < 2) return 0;
    // cells with very few triangles ride along with the nearest big cell: fewer draw calls, slightly larger bounds
    const big = [], remap = new Map();
    for (const [k, n] of count) if (n >= minChunk) big.push(k);
    if (!big.length) { let bk = 0, bn = -1; for (const [k, n] of count) if (n > bn) { bn = n; bk = k; } big.push(bk); }
    if (big.length < 2 && count.size < 3) return 0;
    for (const [k, n] of count) { if (n >= minChunk || big.indexOf(k) >= 0) { remap.set(k, k); continue; }
      const x = k >> 10, z = k & 1023; let best = big[0], bd = 1e9; for (const b of big) { const d = Math.abs((b >> 10) - x) + Math.abs((b & 1023) - z); if (d < bd) { bd = d; best = b; } }
      remap.set(k, bd <= 2 ? best : k); }                                  // … unless the nearest one is far: keep it as its own small chunk
    const lists = new Map();
    for (let t = 0; t < nTri; t++) { const k = remap.get(keyOf[t]); let l = lists.get(k); if (!l) lists.set(k, l = []); l.push(t); }
    if (lists.size < 2) return 0;
    const names = Object.keys(g.attributes), vmap = new Int32Array(pos.count), geos = [];
    for (const tris of lists.values()) {
      vmap.fill(-1); const order = []; const ni = new Uint32Array(tris.length * 3);
      for (let i = 0; i < tris.length; i++) { const t = tris[i]; for (let j = 0; j < 3; j++) { const v = ia ? ia[t * 3 + j] : t * 3 + j; let n = vmap[v]; if (n < 0) { n = vmap[v] = order.length; order.push(v); } ni[i * 3 + j] = n; } }
      const ng = new T.BufferGeometry();
      for (const nm of names) { const src = g.attributes[nm], s = src.itemSize, sa = src.array, da = new sa.constructor(order.length * s);
        for (let i = 0; i < order.length; i++) { const o = order[i] * s, d = i * s; for (let j = 0; j < s; j++) da[d + j] = sa[o + j]; }
        ng.setAttribute(nm, new T.BufferAttribute(da, s, src.normalized)); }
      ng.setIndex(new T.BufferAttribute(order.length > 65535 ? ni : new Uint16Array(ni), 1));
      ng.computeBoundingSphere(); ng.boundingSphere.radius += 1; ng.computeBoundingBox(); geos.push(ng);   // +1 m: room for shader sway
    }
    g.dispose(); mesh.geometry = geos[0]; mesh.frustumCulled = true; done.add(mesh);
    for (let i = 1; i < geos.length; i++) {
      const m = new T.Mesh(geos[i], mesh.material); m.name = (mesh.name || 'chunk') + '#' + i; m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow; m.renderOrder = mesh.renderOrder;
      m.layers.mask = mesh.layers.mask; m.userData.perfChunk = true; if (mesh.customDepthMaterial) m.customDepthMaterial = mesh.customDepthMaterial;
      m.matrixAutoUpdate = false; m.matrixWorldNeedsUpdate = true; mesh.add(m); done.add(m);
    }
    return geos.length;
  }
  /** Split every static mesh under `group` with more than opts.minTris triangles into `cell`-metre XZ cells. Safe to call twice. Returns the number of chunks made. */
  function chunkStatic(group, cell, opts) {
    if (!group) return 0; opts = opts || {}; cell = cell || 36;
    const minTris = opts.minTris || 4000, minChunk = opts.minChunk || 800, list = [], shared = new Map();
    group.traverse(o => { if (o.isMesh && o.geometry) shared.set(o.geometry, (shared.get(o.geometry) || 0) + 1); });
    group.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || done.has(o) || (!o.frustumCulled && !opts.all)) return;   // opts.all: the world modules switch culling off wholesale on their zone-sized meshes
      const mt = o.material; if (!mt || mt.isShaderMaterial || mt.transparent || /water|steam|smoke/i.test(o.name)) return;
      const g = o.geometry; if (!g || !g.isBufferGeometry || !g.attributes.position || Array.isArray(o.material) || g.groups.length > 1) return;
      if (g.morphAttributes && Object.keys(g.morphAttributes).length) return;
      if (shared.get(g) > 1 || g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return;
      if (g.attributes.position.usage === T.DynamicDrawUsage) return;
      const n = (g.index ? g.index.count : g.attributes.position.count) / 3; if (n < minTris) return;
      list.push(o);
    });
    let made = 0; for (const m of list) { const n = chunkMesh(m, cell, minChunk); if (n) { made += n; stats.chunkedMeshes++; } }
    stats.chunks += made; return made;
  }
  function chunkWorld(scene) {
    if (!scene || Q.get('chunk') !== '1') return 0;   // opt-in: measured on an Apple M-series GPU it removes ~20-30 % of the triangles but adds draw calls, and the frame time does not move (the frame is fragment-bound) const t0 = performance.now(); let n = 0;
    for (const c of scene.children) if (['cnroad', 'riverside', 'snackstreet', 'hotpot_world', 'landmarks'].indexOf(c.name) >= 0) { try { n += chunkStatic(c, +Q.get('cell') || 40, { all: true, minTris: +Q.get('mintris') || 0, minChunk: +Q.get('minchunk') || 0 }); } catch (e) { console.warn('GT.perf.chunkStatic ' + c.name, e); } }
    stats.chunkMs = Math.round(performance.now() - t0); console.log('[perf] chunked ' + stats.chunkedMeshes + ' meshes into ' + n + ' cells in ' + stats.chunkMs + ' ms'); return n;
  }

  // In r128 the frustum test reads geometry.boundingSphere, including for instances.
  // Give each static cluster its own bounds while sharing vertex and index buffers.
  const distantVegetation = [];
  P.attachStaticInstances = function(parent, source, original, cell, coarse) {
    const bins=new Map(), tr=new T.Matrix4(), point=new T.Vector3(), color=new T.Color();
    const part=new T.Box3(), box=new T.Box3();
    if(!original.boundingBox) original.computeBoundingBox();
    for(let i=0;i<source.count;i++){
      source.getMatrixAt(i,tr); point.setFromMatrixPosition(tr);
      const key=Math.floor(point.x/cell)+','+Math.floor(point.z/cell);
      if(!bins.has(key))bins.set(key,[]);
      bins.get(key).push(i);
    }
    function geometryView(g,bounds){
      const view=new T.BufferGeometry();view.setIndex(g.index);
      for(const key in g.attributes)view.setAttribute(key,g.attributes[key]);
      view.boundingSphere=bounds;return view;
    }
    for(const ids of bins.values()){
      box.makeEmpty();
      const inst=new T.InstancedMesh(original,source.material,ids.length);
      ids.forEach((id,j)=>{
        source.getMatrixAt(id,tr);inst.setMatrixAt(j,tr);
        box.union(part.copy(original.boundingBox).applyMatrix4(tr));
        if(source.instanceColor){source.getColorAt(id,color);inst.setColorAt(j,color);}
      });
      const bounds=box.getBoundingSphere(new T.Sphere());bounds.radius+=2; // wind animation
      inst.geometry=geometryView(original,bounds);
      inst.castShadow=source.castShadow;inst.receiveShadow=source.receiveShadow;
      inst.frustumCulled=true;inst.name=source.name;parent.add(inst);
      if(coarse)distantVegetation.push({inst,bounds,near:inst.geometry,far:geometryView(coarse,bounds)});
    }
  };
  let vegetationTick=0;
  function vegetationLod(dt,camera){
    vegetationTick-=dt;if(vegetationTick>0)return;vegetationTick=.2;
    for(const cell of distantVegetation){
      const d=cell.bounds.center.distanceTo(camera.position)-cell.bounds.radius;
      if(d>260)cell.inst.geometry=cell.far;
      else if(d<220)cell.inst.geometry=cell.near;
    }
  }

  /* ------------------------------------------------------------------ point-light budget */
  const LL = []; let scanT = 0, scanN = -1; const _w = new T.Vector3();
  function scan(scene) { LL.length = 0; scene.traverse(o => { if (o.isPointLight) { if (!o.userData.perf) o.userData.perf = { base: o.intensity, out: NaN, d: 0, k: 0, lit: false, el: true }; LL.push(o); } }); }
  function sstep(x, a, b) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function lightStep(dt, camera, scene) {
    const L = P.lights; scanT -= dt; if (scanT <= 0 || scene.children.length !== scanN) { scan(scene); scanT = 1; scanN = scene.children.length; }
    const cp = camera.position, K = L.budget | 0, on = L.on && K > 0; let lit = 0, shown = 0;
    for (const l of LL) {
      const u = l.userData.perf; let el = true; for (let p = l.parent; p; p = p.parent) if (!p.visible) { el = false; break; }
      if (l.intensity !== u.out) u.base = l.intensity;                    // the owning module wrote a fresh value this frame
      u.el = el; if (!el) { if (!l.visible) l.visible = true; l.intensity = u.out = u.base; continue; }   // hidden with its room: costs nothing, leave it alone
      l.getWorldPosition(_w);
      u.d = l.distance > 0 ? _w.distanceTo(cp) - l.distance : -1e5;       // metres between the camera and the edge of the light's reach
      u.lit = u.base > 0 && u.d < L.fade1; u.k = u.lit ? u.d : 1e6 + u.d;
    }
    if (!on) { for (const l of LL) { const u = l.userData.perf; if (!u.el) continue; if (!l.visible) l.visible = true; l.intensity = u.out = u.base; shown++; if (u.base > 0) lit++; } stats.lights = shown; stats.lightsLit = lit; return; }
    LL.sort((a, b) => a.userData.perf.k - b.userData.perf.k);
    let n = 0, cut = 1e9;                                                  // cut: reach of the first lit light that did not make the budget
    for (const l of LL) { const u = l.userData.perf; if (!u.el) continue; if (n === K) { if (u.lit) cut = u.d; break; } n++; }
    n = 0;
    for (const l of LL) { const u = l.userData.perf; if (!u.el) continue;
      const show = n < K; if (show) n++;
      if (l.visible !== show) l.visible = show;
      let f = 0; if (show && u.lit) { f = 1 - sstep(u.d, L.fade0, L.fade1); if (cut < 1e8) f *= Math.max(0, Math.min(1, (cut - u.d) / 6)); lit++; }
      l.intensity = u.out = u.base * f; if (show) shown++; }
    stats.lights = shown; stats.lightsLit = lit;
  }

  /* ------------------------------------------------------------------ readout */
  let el = null, hudOn = Q.get('fps') === '1', last = 0, acc = 0, frames = 0, worst = 0, shownT = 0;
  function hud(on) { hudOn = on === undefined ? !hudOn : !!on; if (el) el.style.display = hudOn ? 'block' : 'none'; return hudOn; }
  function hudStep() {
    const now = performance.now(), d = last ? now - last : 0; last = now; if (d <= 0 || d > 2000) return;
    acc += d; frames++; if (d > worst) worst = d;
    if (now - shownT < 500) return; shownT = now;
    stats.ms = acc / frames; stats.fps = 1000 / stats.ms; stats.worst = worst; acc = 0; frames = 0; worst = 0;
    const R = GT.render, r = R && R.renderer; if (r) { stats.tris = r.info.render.triangles; stats.calls = r.info.render.calls; }
    if (!hudOn) return;
    if (!el) { el = document.createElement('div'); el.id = 'gt-perf';
      el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:8px;z-index:99999;padding:5px 8px;border-radius:4px;background:rgba(0,0,0,.62);color:#d8ffd0;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;white-space:pre;pointer-events:none;letter-spacing:.02em';
      document.body.appendChild(el); }
    const i = R ? R.info : {}, q = R && R.quality !== undefined ? R.quality : '-', col = stats.fps >= 55 ? '#d8ffd0' : stats.fps >= 44 ? '#ffe9a0' : '#ffb0a0';
    el.style.color = col;
    el.textContent = stats.fps.toFixed(0).padStart(3) + ' fps  ' + stats.ms.toFixed(1) + ' ms  (worst ' + stats.worst.toFixed(0) + ')\n' +
      (stats.tris / 1000).toFixed(0) + 'k tris  ' + stats.calls + ' calls  ' + stats.lightsLit + '/' + stats.lights + ' lights\n' +
      (i.w || 0) + 'x' + (i.h || 0) + '  msaa ' + (i.msaa || 0) + '  Q' + q + (R && R.governor && !R.governor.on ? ' (fixed)' : '') + '  ' + (i.passes || 0) + ' passes';
  }
  addEventListener('keydown', e => { if (e.code === 'F3') { e.preventDefault(); hud(); } });

  /** call once per frame before GT.render.frame */
  function update(dt, camera, scene) {
    if (camera && scene) { try { lightStep(dt > 0 ? dt : .016, camera, scene); } catch (e) { if (!P._warned) { P._warned = 1; console.warn('GT.perf lights', e); } } }
    if(camera)vegetationLod(dt,camera);
    hudStep();
  }
})();
