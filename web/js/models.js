/* models.js — loads generated/free GLB models from v2/models/ and wraps them so the game can use them like its code-built figures.
   Everything degrades gracefully: if a file is missing the promise resolves to null and callers keep their procedural fallback.

   GT.models.has(name)            -> Promise<bool>     does models/<name>.glb exist
   GT.models.load(name)           -> Promise<{scene, clips} | null>   cached template
   GT.models.make(name, opts)     -> Promise<inst | null>
       opts: { height (metres, scales the model so its bounding box is this tall), yaw (extra rotation, radians), cast (shadows, default true) }
       inst: { group (origin at the feet / lowest point, +Z forward), name, rigged, clips: string[], play(clip, fade = 0.2), stop(), update(dt), bones: {lowercase name -> Bone}, bounds: {w, h, d} }
   Extra animation files named models/<name>@<clip>.glb (same skeleton) are picked up automatically for the clips in GT.models.CLIPS.
*/
(function () {
  'use strict';
  const T = THREE, GT = window.GT = window.GT || {};
  const CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/';
  const M = GT.models = { base: 'models/', CLIPS: ['idle', 'walk', 'run'], cache: {}, exists: {}, stats: [] };
  let libs = null;
  function script(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('failed to load ' + src)); document.head.appendChild(s); }); }
  function ready() { if (!libs) libs = (T.GLTFLoader ? Promise.resolve() : script(CDN + 'loaders/GLTFLoader.js')).then(() => T.SkeletonUtils ? null : script(CDN + 'utils/SkeletonUtils.js')); return libs; }
  M.ready = ready;
  M.has = function (name) { if (name in M.exists) return Promise.resolve(M.exists[name]);
    return fetch(M.base + name + '.glb', { method: 'HEAD' }).then(r => (M.exists[name] = r.ok)).catch(() => (M.exists[name] = false)); };
  function loadFile(file) { return ready().then(() => new Promise((res) => { new T.GLTFLoader().load(M.base + file, g => res(g), undefined, () => res(null)); })); }
  M.load = function (name) {
    if (M.cache[name]) return M.cache[name];
    return M.cache[name] = M.has(name).then(ok => { if (!ok) return null; const t0 = performance.now();
      return loadFile(name + '.glb').then(g => { if (!g) return null;
        const tpl = { scene: g.scene, clips: {} }; (g.animations || []).forEach((c, i) => { tpl.clips[(c.name || 'clip' + i).toLowerCase()] = c; });
        let tris = 0, rigged = false; g.scene.traverse(o => { if (o.isSkinnedMesh) rigged = true; if (o.isMesh) { const gi = o.geometry.index; tris += (gi ? gi.count : o.geometry.attributes.position.count) / 3;
          const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m && m.isMeshStandardMaterial) { m.envMapIntensity = 1; if (m.map) m.map.anisotropy = 8; } }); } });
        tpl.rigged = rigged; tpl.tris = Math.round(tris);
        // optional per-clip files that share the skeleton
        const extra = rigged ? Promise.all(M.CLIPS.map(c => M.has(name + '@' + c).then(ok2 => ok2 ? loadFile(name + '@' + c + '.glb').then(g2 => { if (g2 && g2.animations && g2.animations[0]) tpl.clips[c] = g2.animations[0]; }) : null))) : Promise.resolve();
        return extra.then(() => { M.stats.push({ name, tris: tpl.tris, rigged, clips: Object.keys(tpl.clips), ms: Math.round(performance.now() - t0) }); return tpl; }); }); });
  };
  M.make = function (name, opts) { opts = opts || {};
    return M.load(name).then(tpl => { if (!tpl) return null;
      const model = tpl.rigged && T.SkeletonUtils ? T.SkeletonUtils.clone(tpl.scene) : tpl.scene.clone(true);
      const group = new T.Group(), pivot = new T.Group(); group.add(pivot); pivot.add(model);
      model.updateMatrixWorld(true); const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3()), c = box.getCenter(new T.Vector3());
      const k = opts.height && size.y > 1e-4 ? opts.height / size.y : 1;
      model.position.set(-c.x, -box.min.y, -c.z); pivot.scale.setScalar(k); pivot.rotation.y = opts.yaw || 0;
      const bones = {}; model.traverse(o => { if (o.isMesh) { o.castShadow = opts.cast !== false; o.receiveShadow = true; o.frustumCulled = !o.isSkinnedMesh; } if (o.isBone) bones[o.name.toLowerCase()] = o; });
      const mixer = Object.keys(tpl.clips).length ? new T.AnimationMixer(model) : null, actions = {}; let cur = null;
      if (mixer) for (const n in tpl.clips) actions[n] = mixer.clipAction(tpl.clips[n]);
      const inst = { group, name, rigged: tpl.rigged, clips: Object.keys(actions), bones, bounds: { w: size.x * k, h: size.y * k, d: size.z * k }, mixer,
        play(clip, fade) { const a = actions[clip] || actions[Object.keys(actions).find(n => n.indexOf(clip) >= 0)]; if (!a || a === cur) return !!a; a.reset().fadeIn(fade === undefined ? .2 : fade).play(); if (cur) cur.fadeOut(fade === undefined ? .2 : fade); cur = a; return true; },
        stop() { if (cur) cur.fadeOut(.2); cur = null; }, update(dt) { if (mixer) mixer.update(dt); } };
      return inst; }); };

  /* showcase: showcase.html?m=models&name=kai[&anim=walk][&h=1.78][&only=core,materials,render,atmos,models]
     With no name it lists what is in the folder from a fixed set of expected file names. */
  const EXPECT = ['kai', 'lie', 'lajie', 'guaizi', 'yeshu', 'mange', 'ertong', 'escooter', 'taxi', 'bus', 'sports', 'auntie', 'swimmer', 'cop', 'tourist'];
  M.expected = EXPECT;
  GT.showcase = GT.showcase || {};
  GT.showcase.models = function (ctx) {
    const Q = new URLSearchParams(location.search), name = Q.get('name'), scene = ctx.scene, live = [];
    const k = GT.kit(); k.box('concrete', 40, .2, 40, 0, -.1, 0); scene.add(k.build());
    const note = t => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:10px;bottom:10px;color:#fff;font:14px/1.5 monospace;white-space:pre;text-shadow:0 1px 3px #000;z-index:9'; d.textContent = t; document.body.appendChild(d); return d; };
    const tag = note('loading…');
    const names = name ? [name] : EXPECT, veh = { escooter: 1.15, taxi: 1.5, bus: 3.1, sports: 1.2 };
    Promise.all(names.map((n, i) => M.make(n, { height: +Q.get('h') || veh[n] || 1.75 }).then(inst => { if (!inst) return n + ': (missing)';
      inst.group.position.set(name ? 0 : (i % 8 - 3.5) * 2.2, 0, name ? 0 : -Math.floor(i / 8) * 4); scene.add(inst.group); live.push(inst); if (Q.get('anim')) inst.play(Q.get('anim')); else if (inst.clips.length) inst.play(inst.clips[0]);
      const s = M.stats.find(x => x.name === n) || {}; return n + ': ' + (s.tris || '?') + ' tris, ' + (inst.rigged ? 'rigged' : 'static') + ', clips [' + inst.clips.join(',') + '], ' + inst.bounds.w.toFixed(2) + '×' + inst.bounds.h.toFixed(2) + '×' + inst.bounds.d.toFixed(2) + ' m'; })))
      .then(lines => { tag.textContent = lines.join('\n'); });
    return { cam: name ? [2.2, 1.5, 3.2] : [0, 4, 11], look: name ? [0, .95, 0] : [0, 1, -2], hours: 18.2, update(dt) { for (const i of live) i.update(dt); } };
  };
})();
