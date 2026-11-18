/* render.js — the "camera" of SUNSET HEAT: linear-HDR renderer + hand-written post stack (three r128 global build, WebGL2).
   GT.render = { init({canvas,scene,camera,msaa?}), frame(scene,camera,dt), resize(), setShadowQuality(q,scene?), renderer, fx, mirror, info }
   Pipeline per frame:
     [mirror]  the REAR VIEW: scene from mirror.camera (looks back from the player's vehicle) -> 448x188 HDR target -> soft-clip copy -> mirror.texture (linear HDR).
               Re-drawn every 2nd-4th frame (quality level). Every mirror glass (scooter stalks, car door mirrors, the cabin mirror) looks its own reflected ray up in it
               through mirror.uniforms / mirror.glsl (gtRear(dir)), so one small render serves all of them and each shows its own part of the road behind.
               On two wheels in first person the camera is posed here (autoMirror); in a car js/cngame.js poses it.
     [far sun] LT: the far sun cascade (js/atmos.js sunFar, 2 x 150 m) re-drawn every lvl.farEvery frames from the big casters only; the lit shaders pick near / far per pixel (gtCsmShadow)
     scene     -> MSAA RGBA16F target + 24-bit DepthTexture (resolved by blit)
     [probe]   LT: one or two faces of the local reflection cube (128 px, camera position, people and small props left out) after the main view; every glossy PBR material samples it
               (GT_PROBE). Rough materials keep the dimmed sky bake; mirror-like ones see the sky at full strength (gtIbl). GT.render.gpu = GPU ms per part (timer queries)
     AO        half-res scalable ambient obscurance from depth (16 spiral taps, per-pixel rotation) + 2-pass slope-aware bilateral blur in 1/z
     shafts    quarter-res sky mask toward the sun -> 3 iterated radial blurs
     composite full-res: joint-bilateral AO upsample, wet-ground reflections (a short screen-space march, only on pixels a wet ground material flagged in the
               alpha channel; colour from last frame's half-res mips, so signs and headlights smear into long streaks), height haze with sun forward-scatter, + shafts
     mblur     depth-reprojection camera motion blur (skipped on CPU when the camera is still)
     bloom     half-res base (mipmapped, feeds the exposure meter) -> soft-knee threshold -> 6-level 13-tap pyramid -> tent upsample; anamorphic streak
     exposure  log-average metering from the base mips, eye adaptation in a 1x1 ping-pong target (no readPixels)
     grade     helmet-visor rain (drops refract the picture; js side: a 384x216 canvas simulated here, see VZ) + CA + bloom + lens dirt + exposure + vignette + AgX tone map + S-curve + split tone + focus look + dither -> LDR (luma in alpha)
     output    FXAA + contrast-adaptive sharpen + film grain -> canvas (already display-encoded) */
(function () {
  'use strict';
  const T = THREE, GT = window.GT = window.GT || {};

  /* ------------------------------------------------------------------ live settings */
  const fx = {
    enabled: true,
    ao: true, aoStrength: 1.9, aoRadius: 1.3, aoIntensity: 6.5,   // aoStrength: exponent-like multiplier, aoRadius metres · LT: 1.6 / 1.0 / 5 -> 1.9 / 1.3 / 6.5 (wall feet, eaves, car bellies, awnings)
    vol: 1, shaftLow: 1,                            // light shafts + sun haze (0 = off) · LT shaftLow: beam strength against a low sun (was a fixed .03, i.e. nearly none at golden hour)
    bloom: 1, streak: 1, dirt: 1, bloomThreshold: 2.3,   /* 霓虹江城: only real emitters bloom (sun, lamps, signs); pale ground and water stay under it */
    look: 0, sunny: 1, photoWhite: .06, photoCurve: .4, photoSat: .95, photoSatHi: .85, nightMax: 5,   /* g6 r3 photo grade: white point pulled in by this much by day · S-curve strength · saturation · extra factor on already-saturated colours */   /* g6: look (neon-noir) is off; sunny = 0..1 strength of the 阳光江城 grade (vibrance, warm highlights, blue-violet shade) */                         /* look: 0..1 strength of the neon-noir grade (teal shade, peach / source-coloured highlights, low blacks, contrast, saturation) · nightMax: exposure ceiling once it is dark, so the gaps between pools of light stay black */
    /* ct2 exposure pass (2026-11-17): key .43 -> .32, white point .19 -> .06, exposure ceiling 3.2 -> 5 (night 1.9 -> 5), nightDim .66 -> .45, low-sun darkening .5 -> .25; metered against GTA6 stills by MEDIAN luma (day 125-145), sunlit paving no longer lands near white */
    mblur: 1, mblurNear: 2.6,                       // geometry nearer than mblurNear metres (cockpit, hands, hood) is never blurred
    autoExposure: true, exposure: 1, exposureBias: 0, exposureMin: 0.3, exposureMax: 5, exposureKey: 0.32, nightDim: 0.45, lowSunDim: .25,   // nightDim: how much darker than 'correct' night is allowed to stay (uses GT.env.night)
    // bias in stops
    grain: .3, ca: 0, vignette: .45, sharpen: 1, fxaa: true, grade: 1, warm: .15,   /* LT: warm: share of the old warm highlight tint kept by day (golden hour and night always get all of it) */
    focus: 0,                                       // 0..1 slow-motion look: desaturated, cool, tighter vignette
    skyDepth: 900,                                  // linear depth (m) beyond which a pixel counts as sky
    debug: 0                                        // 0 off | 'ao' | 'depth' | 'bloom' | 'shafts' | 'streak' | 'scene' | 'mirror'
  };
  /* gtRear(d): d = a world-space direction (the ray a mirror reflects). rgb = what the rear view saw that way, a = 0 where it has nothing (outside its frustum, or no rear view running) */
  const MIRU = { gtRearTex: { value: null }, gtRearVP: { value: new THREE.Matrix4() }, gtRearK: { value: 0 } };
  const MIRGLSL = 'uniform sampler2D gtRearTex; uniform mat4 gtRearVP; uniform float gtRearK;\nvec4 gtRear(vec3 d){ if (gtRearK < 0.01) return vec4(0.0); vec4 c = gtRearVP * vec4(d, 0.0); if (c.w < 1e-4) return vec4(0.0); vec2 u = c.xy / c.w; vec2 e = vec2(1.0) - smoothstep(vec2(0.88), vec2(1.0), abs(u)); return vec4(texture2D(gtRearTex, u * 0.5 + 0.5).rgb, e.x * e.y * gtRearK); }\n';
  const mirror = { enabled: false, camera: null, texture: null, size: { w: 512, h: 216 }, uniforms: MIRU, glsl: MIRGLSL, off: false, auto: false, n: 0, was: false, draws: 0 };
  const MIRFOV = 34;
  const ssr = { on: true, k: 1, patchT: 0, patched: 0 };
  /* helmet-visor rain. force: null = automatic (first person on two wheels while it rains) | 0..1 = that much rain regardless (stills, tests) */
  const VZ = { allow: true, force: null, on: 0, drops: [], cv: null, g: null, tex: null, spr: null, acc: 0, upT: 0, yaw: null, rate: 0, wipe: 0, speed: 0, rain: 0, W: 512, H: 288, seed: 7919, stats: { spawned: 0, wiped: 0, live: 0 } };
  const info = { w: 0, h: 0, msaa: 0, passes: 0, shadow: 3 };
  /* quality levels, lowest first. The governor (below) steps between them from the measured frame time; GT.render.setQuality(n) pins one.
     scale: render-resolution factor on top of the pixel ratio · msaa: samples of the HDR scene target · shadow: sun shadow-map size
     shadowEvery: re-render shadow maps every n-th frame · lights: point-light budget handed to GT.perf · mblur/streak: optional passes */
  const LEVELS = [
    { scale: .7, msaa: 0, shadow: 1024, shadowEvery: 2, lights: 6, mblur: 0, streak: 0, mirEvery: 4, mirMsaa: 0, ssr: 0, drops: 70, visorHz: 30, lens: 0, probe: 0, probeT: 6, farMap: 1024, farEvery: 8, puddles: .5 },
    { scale: .85, msaa: 2, shadow: 2048, shadowEvery: 1, lights: 10, mblur: 1, streak: 1, mirEvery: 3, mirMsaa: 0, ssr: 8, drops: 110, visorHz: 60, lens: .5, probe: 1, probeT: 4, farMap: 1024, farEvery: 4, puddles: .8 },
    { scale: 1, msaa: 2, shadow: 2048, shadowEvery: 1, lights: 10, mblur: 1, streak: 1, mirEvery: 2, mirMsaa: 0, ssr: 12, drops: 150, visorHz: 60, lens: 1, probe: 1, probeT: 2.5, farMap: 2048, farEvery: 3, puddles: 1 },
    { scale: 1, msaa: 2, shadow: 2048, shadowEvery: 2, lights: 10, mblur: 1, streak: 1, mirEvery: 2, mirMsaa: 2, ssr: 16, drops: 180, visorHz: 60, lens: 1, probe: 1, probeT: 2, farMap: 2048, farEvery: 2, puddles: 1 }
  ];   /* LT: probe = reflection-probe cube faces drawn per frame (0 = probe off, glossy materials fall back to the sky bake) · probeT = seconds between re-captures when the camera stands still · farMap / farEvery = far sun cascade size and how often it is redrawn · puddles = 0..1 share of the wet decals js/materials.js keeps */   /* lens: chromatic aberration, film grain and vignette (0 = all three off on the lowest level, .5 = half) */   /* phase 6 switches: mirEvery = the rear view is re-drawn every n-th frame · mirMsaa = its samples · ssr = march steps of the wet-ground reflections (0 = off) · drops / visorHz = visor rain budget */
  const gov = { on: true, target: 72, avg: 16.7, slowT: 0, fastT: 0, holdT: 3, upAt: 0, backoff: 30, retry: [0, 0, 0, 0], last: 0, changes: 0 };
  const R = GT.render = { init, frame, resize, setShadowQuality, setQuality, renderer: null, fx, mirror, info, quality: 3, levels: LEVELS, governor: gov, ssr, visor: VZ, visorSim, warm: null };

  /* ------------------------------------------------------------------ LT 光影系统 (2026-11-17): shader-chunk patches shared by every lit three.js material
     gtIbl (vec4, one Float32Array shared by reference by every material): x = how far the day sky fill is turned down in the baked environment (GT.env.envK from js/atmos.js), y = 1/x, w = 1 once set.
       The diffuse sky light keeps the dimmed bake (dark shade, the g6 look); mirror-like surfaces get the sky back at its true brightness (glass, paint, chrome, puddles) — the upper hemisphere only,
       the ground below the horizon is already at its own brightness in the bake. Rough surfaces are unchanged.
     GT_PROBE (a material define, set by the probe below): the material's envMap is the local reflection probe (a live cube of the street round the camera), not the sky-only bake. Its diffuse share
       comes from the probe's lowest mips, dimmed like the bake, so a car in shade does not light up.
     gtShd (vec4, shared): x = 1 two-cascade sun shadows (directional shadow 0 = the near map, 1 = the far map; the far light carries no light of its own), y..z = where the near map hands over (0..1 of its half-width). */
  const GTIBL = new Float32Array([1, 1, 0, 0]), GTSHD = new Float32Array([0, .78, .95, 0]), GTSKY = new Float32Array(4), GTGND = new Float32Array(4);   /* GTSKY / GTGND: mean sky / ground radiance (GT.env), the diffuse sky light of probe materials */
  (function patchChunks() {
    const C = T.ShaderChunk; if (C.__gtLT) return; C.__gtLT = true; const miss = [];
    const rep = (k, a, b) => { if (C[k].indexOf(a) < 0) { miss.push(k); return; } C[k] = C[k].replace(a, b); };
    C.envmap_physical_pars_fragment = 'uniform vec4 gtIbl; uniform vec4 gtSkyI; uniform vec4 gtGndI;\n' + C.envmap_physical_pars_fragment + '\n#if defined( USE_ENVMAP ) && defined( GT_PROBE ) && defined( ENVMAP_TYPE_CUBE )\nvec3 gtProbeIrr( const in vec3 n ) { vec3 w = inverseTransformDirection( n, viewMatrix ); return PI * mix( gtGndI.rgb, gtSkyI.rgb, smoothstep( -0.6, 0.6, w.y ) ); }\n#endif\n' +
      'float gtSpecK( const in float r, const in vec3 v, const in vec3 n ) {\n#ifdef GT_PROBE\n return gtIbl.w < 0.5 ? 1.0 : mix( 1.0, gtIbl.x, smoothstep( 0.16, 0.5, r ) );\n#else\n if ( gtIbl.w < 0.5 ) return 1.0; vec3 d = inverseTransformDirection( reflect( -v, n ), viewMatrix ); return mix( mix( gtIbl.y, 1.0, smoothstep( 0.02, -0.12, d.y ) ), 1.0, smoothstep( 0.22, 0.62, r ) );\n#endif\n}\n';
    rep('lights_fragment_maps', 'iblIrradiance += getLightProbeIndirectIrradiance( geometry, maxMipLevel );\n\t#endif', 'iblIrradiance += getLightProbeIndirectIrradiance( geometry, maxMipLevel );\n\t#endif\n\t#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( GT_PROBE ) && defined( ENVMAP_TYPE_CUBE )\n\t\tiblIrradiance += gtProbeIrr( geometry.normal );   /* the probe is taken at the camera: its own lowest mips lit a terrace floor with the umbrella over the lens. The sky light comes from the mean sky / ground radiance instead (what the sky bake would have given) */\n\t#endif');
    rep('lights_fragment_maps', 'radiance += getLightProbeIndirectRadiance( geometry.viewDir, geometry.normal, material.specularRoughness, maxMipLevel );', 'radiance += getLightProbeIndirectRadiance( geometry.viewDir, geometry.normal, material.specularRoughness, maxMipLevel ) * gtSpecK( material.specularRoughness, geometry.viewDir, geometry.normal );');
    rep('lights_fragment_maps', 'clearcoatRadiance += getLightProbeIndirectRadiance( geometry.viewDir, geometry.clearcoatNormal, material.clearcoatRoughness, maxMipLevel );', 'clearcoatRadiance += getLightProbeIndirectRadiance( geometry.viewDir, geometry.clearcoatNormal, material.clearcoatRoughness, maxMipLevel ) * gtSpecK( material.clearcoatRoughness, geometry.viewDir, geometry.clearcoatNormal );');
    const DSH = 'directLight.color *= all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
    rep('lights_fragment_begin', DSH, '\n\t\t#if ( UNROLLED_LOOP_INDEX == 0 ) && ( NUM_DIR_LIGHT_SHADOWS > 1 )\n\t\tdirectLight.color *= all( bvec2( directLight.visible, receiveShadow ) ) ? gtCsmShadow( vDirectionalShadowCoord[ 0 ], vDirectionalShadowCoord[ 1 ] ) : 1.0;\n\t\t#elif ( UNROLLED_LOOP_INDEX == 1 )\n\t\tif ( gtShd.x < 0.5 ) ' + DSH + '\n\t\t#else\n\t\t' + DSH + '\n\t\t#endif\n');
    const CSMF = '\n#if NUM_DIR_LIGHT_SHADOWS > 0\nuniform vec4 gtShd;\n#endif\n#if NUM_DIR_LIGHT_SHADOWS > 1\nfloat gtCsmShadow( vec4 c0, vec4 c1 ) {\n DirectionalLightShadow s0 = directionalLightShadows[ 0 ];\n if ( gtShd.x < 0.5 ) return getShadow( directionalShadowMap[ 0 ], s0.shadowMapSize, s0.shadowBias, s0.shadowRadius, c0 );\n vec2 p = c0.xy / c0.w; float e = max( abs( p.x - 0.5 ), abs( p.y - 0.5 ) ) * 2.0; float k = smoothstep( gtShd.y, gtShd.z, e ); float a = 1.0, b = 1.0;\n if ( k < 0.999 ) a = getShadow( directionalShadowMap[ 0 ], s0.shadowMapSize, s0.shadowBias, s0.shadowRadius, c0 );\n if ( k > 0.001 ) { DirectionalLightShadow s1 = directionalLightShadows[ 1 ]; b = getShadow( directionalShadowMap[ 1 ], s1.shadowMapSize, s1.shadowBias, s1.shadowRadius, c1 ); }\n return mix( a, b, k );\n}\n#endif\n';
    if (/#endif\s*$/.test(C.shadowmap_pars_fragment)) C.shadowmap_pars_fragment = C.shadowmap_pars_fragment.replace(/#endif\s*$/, CSMF + '#endif'); else miss.push('shadowmap_pars_fragment');
    for (const k of ['standard', 'physical']) if (T.ShaderLib[k]) { T.ShaderLib[k].uniforms.gtIbl = { value: GTIBL }; T.ShaderLib[k].uniforms.gtSkyI = { value: GTSKY }; T.ShaderLib[k].uniforms.gtGndI = { value: GTGND }; }
    for (const k of ['standard', 'physical', 'phong', 'lambert', 'toon', 'matcap', 'basic', 'shadow']) if (T.ShaderLib[k]) T.ShaderLib[k].uniforms.gtShd = { value: GTSHD };
    if (miss.length) console.warn('GT.render LT: chunk patch did not apply to ' + miss.join(', '));
  })();
  /* GPU time per frame (EXT_disjoint_timer_query_webgl2), split into pre (far shadow map, reflection probe, rear view), scene (incl. the near shadow map) and post. GT.render.gpu = { pre, scene, post, total } ms, smoothed */
  const GPU = { on: true, ext: null, pend: [], cur: null, pre: 0, scene: 0, probe: 0, post: 0, total: 0, n: 0, peak: { pre: 0, scene: 0, probe: 0, post: 0, total: 0 } };   /* peak: the worst frame of the last ~2 s */
  function gBegin(name) { if (!GPU.ext || !GPU.on) return; const gl = renderer.getContext(); if (GPU.cur) gEnd(); if (GPU.pend.length > 24) return; const q = gl.createQuery(); gl.beginQuery(GPU.ext.TIME_ELAPSED_EXT, q); GPU.cur = { q, name, f: frameNo }; }
  function gEnd() { if (!GPU.cur) return; const gl = renderer.getContext(); gl.endQuery(GPU.ext.TIME_ELAPSED_EXT); GPU.pend.push(GPU.cur); GPU.cur = null; }
  const GACC = {}; let gFrame = -1;
  function gPoll() { if (!GPU.on || !GPU.ext) return; const gl = renderer.getContext(), dis = gl.getParameter(GPU.ext.GPU_DISJOINT_EXT);
    while (GPU.pend.length) { const p = GPU.pend[0]; if (!dis && !gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break; const ns = dis ? 0 : gl.getQueryParameter(p.q, gl.QUERY_RESULT); gl.deleteQuery(p.q); GPU.pend.shift(); if (dis) continue;
      if (p.f !== gFrame) { if (gFrame >= 0) { const k = GPU.n < 10 ? .5 : .06, pk = GPU.peak, dec = GPU.n % 120 === 0; let t = 0; for (const s of ['pre', 'scene', 'probe', 'post']) { const v = GACC[s] || 0; GPU[s] += (v - GPU[s]) * k; t += v; if (dec) pk[s] = 0; pk[s] = Math.max(pk[s], v); GACC[s] = 0; } GPU.total += (t - GPU.total) * k; if (dec) pk.total = 0; pk.total = Math.max(pk.total, t); GPU.n++; } gFrame = p.f; }
      GACC[p.name] = (GACC[p.name] || 0) + ns / 1e6; } }
  /* ------------------------------------------------------------------ LT: local reflection probe (the GTA way: one low-res cube of the real street round the camera, re-drawn a face or two per frame)
     Every glossy PBR material (car paint, glass, shop windows, chrome, polished metal; found by a slow walk of the scene) samples it instead of the sky-only bake, so paint and glass show the street,
     the palms, the buildings and at night the neon. Drawn into B a face at a time (nothing samples B), then copied to A in one blit + mipmaps, so a material never reads the cube being drawn.
     Re-captured when the camera has moved PROBE.move metres or every lvl.probeT seconds. GT.render.probe.on = false (or ?probe=0) turns it off: the materials go back to the sky bake. */
  const PROBE = { on: true, res: 128, A: null, B: null, cc: null, face: 6, pos: new T.Vector3(1e9, 0, 0), t: 99, mats: new Set(), kinds: { paint: 0, glass: 0, metal: 0, gloss: 0 }, caps: 0, walkT: 0, far: 180, small: [], smallR: 1.1, hid: 0, move: 6, k: { paint: .9, glass: 1.15, metal: 1, gloss: 1 }, ready: false };
  R.probe = PROBE; R.gpu = GPU; R.lt = { ibl: GTIBL, shd: GTSHD };
  function probeKind(m) {
    if (!m || !m.isMeshStandardMaterial || (m.userData && m.userData.gtNoProbe)) return null;
    if (m.defines && ('GT_WET' in m.defines)) return null; if (m.alphaTest > 0 || (m.userData && m.userData.gtReflect)) return null;
    if (m.envMap && !(m.userData && m.userData.gtProbe)) return null;
    const rm = m.roughnessMap, mr = rm ? (rm.userData && rm.userData.meanR ? rm.userData.meanR : .6) : 1, r = m.roughness * mr;
    if (m.clearcoat > 0) return 'paint'; if (m.userData && m.userData.gtGlass) return 'glass'; if (m.transmission > 0 || (m.transparent && r < .25)) return 'glass'; if (m.metalness >= .5 && r <= .6) return 'metal'; if (r <= .26) return 'gloss'; return null; }   /* semi-rough floors and walls stay on the sky bake: a cube taken at the camera lit a terrace floor with the yellow umbrella over the lens */
  function probeAttach(m, kind) { if (m.userData.gtProbe) return; m.userData.gtProbe = { kind, was: m.envMapIntensity }; m.envMap = PROBE.A.texture; m.envMapIntensity = (m.userData.gtProbeK || 1) * PROBE.k[kind]; m.defines = m.defines || {}; m.defines.GT_PROBE = ''; m.needsUpdate = true; PROBE.mats.add(m); PROBE.kinds[kind]++; }
  function probeDetachAll() { for (const m of PROBE.mats) { const u = m.userData.gtProbe; if (!u) continue; m.envMap = null; m.envMapIntensity = u.was; if (m.defines) delete m.defines.GT_PROBE; delete m.userData.gtProbe; m.needsUpdate = true; } PROBE.mats.clear(); for (const k in PROBE.kinds) PROBE.kinds[k] = 0; }
  function probeWalk(scene) { const sm = PROBE.small; sm.length = 0; scene.traverse(o => { if (!o.isMesh || o.isSkinnedMesh || !o.material) return;
      if (o.userData.gtR === undefined) { const g = o.geometry; if (g && !g.boundingSphere) g.computeBoundingSphere(); o.userData.gtR = g && g.boundingSphere ? g.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() : 99; } if (o.userData.gtR < PROBE.smallR && !o.isInstancedMesh) sm.push(o);   /* small things (props, car parts, signs) stay out of the 128 px cube: a third of the draw calls */ for (const m of [].concat(o.material)) { if (!m || m.userData.gtProbe || m.userData.gtProbeNo) continue; const k = probeKind(m); if (k) probeAttach(m, k); else m.userData.gtProbeNo = 1; } }); }
  function probeInit() { if (PROBE.A || !ok) return; const n = PROBE.res;
    PROBE.B = new T.WebGLCubeRenderTarget(n, { type: T.HalfFloatType, format: T.RGBAFormat, generateMipmaps: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter });
    PROBE.A = new T.WebGLCubeRenderTarget(n, { type: T.HalfFloatType, format: T.RGBAFormat, generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter, depthBuffer: false });
    PROBE.cc = new T.CubeCamera(.3, PROBE.far, PROBE.B);
    const was = renderer.getRenderTarget(); renderer.setClearColor(0x000000, 1); for (let i = 0; i < 6; i++) { renderer.setRenderTarget(PROBE.A, i); renderer.clear(); renderer.setRenderTarget(PROBE.B, i); renderer.clear(); } renderer.setRenderTarget(was); }
  const _pv = new T.Vector3();
  function probeStep(scene, camera, dt) {
    const want = PROBE.on && ok && (lvl.probe || 0) > 0;
    if (!want) { if (PROBE.mats.size) probeDetachAll(); PROBE.face = 6; return; }
    probeInit(); if ((PROBE.walkT -= dt) <= 0) { PROBE.walkT = 2.5; probeWalk(scene); }
    PROBE.t += dt; const cp = _pv.setFromMatrixPosition(camera.matrixWorld);
    if (PROBE.face >= 6) { if (PROBE.caps === 0 || cp.distanceTo(PROBE.pos) > PROBE.move || PROBE.t > (lvl.probeT || 2)) { PROBE.face = 0; PROBE.t = 0; PROBE.pos.copy(cp); PROBE.cc.position.copy(cp); PROBE.cc.position.y += .6; PROBE.cc.updateMatrixWorld(true); for (const c of PROBE.cc.children) c.layers.mask = camera.layers.mask; } else return; }
    const g = GT.cngame, p = g && g.player, veh = p && p.ent ? (p.ent.veh && p.ent.veh.group) || p.ent.group || null : null, vv = veh ? veh.visible : false, au = scene.autoUpdate, c0 = renderer.info.render.calls;
    const pr = g && g.G && g.G.pop && g.G.pop.root, pv = pr ? pr.visible : false; if (pr) pr.visible = false;   /* people (~35 draw calls each) are left out of the reflections */
    if (veh) veh.visible = false; scene.autoUpdate = false; const hid = []; for (const o of PROBE.small) if (o.visible) { o.visible = false; hid.push(o); } PROBE.hid = hid.length;
    for (let n = PROBE.caps === 0 ? 6 : lvl.probe; n > 0 && PROBE.face < 6; n--) { renderer.setRenderTarget(PROBE.B, PROBE.face); renderer.clear(); renderer.render(scene, PROBE.cc.children[PROBE.face]); PROBE.face++; }
    for (const o of hid) o.visible = true; if (veh) veh.visible = vv; if (pr) pr.visible = pv; scene.autoUpdate = au; PROBE.draws = renderer.info.render.calls - c0;
    if (PROBE.face >= 6) { const u = M.probeCopy.uniforms, ac = renderer.autoClear; u.tB.value = PROBE.B.texture; renderer.autoClear = false;   /* copy B -> A face by face (NaN / Inf from the scene would spread through every mip), mipmaps once, after the last face */
      for (let i = 0; i < 6; i++) { PROBE.A.texture.generateMipmaps = i === 5; u.uFace.value = i; u.uRes.value = PROBE.res; quad.material = M.probeCopy; renderer.setRenderTarget(PROBE.A, i); renderer.render(fsScene, fsCam); }
      renderer.autoClear = ac; PROBE.caps++; PROBE.ready = true; }
    renderer.setRenderTarget(null); }
  /* ------------------------------------------------------------------ LT: far sun cascade. js/atmos.js owns the two lights (sun = near map, sunFar = far map with no light of its own).
     The far map is drawn here every lvl.farEvery frames, only from casters bigger than CSM.minR metres (tagged onto layer CSM.layer by a slow walk), so it costs a fraction of the near map.
     How: a stand-in scene that shares the real scene's children array (its own render state, so the real scene's light set never changes) is rendered into a 1x1 target by a camera that sees only
     that layer and points into the void: nothing is drawn, but three's shadow pass runs for the one light on that layer (sunFar) over the tagged casters. */
  const CSM = { on: true, layer: 3, minR: 1.8, walkT: 0, scene: null, cam: null, rt: null, tagged: 0, draws: 0 };
  R.csm = CSM;
  function csmStep(scene, dt) {
    const A = GT.atmos, far = A && A.sunFar; GTSHD[0] = 0; if (!far || !ok) return;
    if (!CSM.on || !renderer.shadowMap.enabled) { far.shadow.autoUpdate = false; return; }
    if (!CSM.scene) { CSM.scene = new T.Scene(); CSM.scene.autoUpdate = false; CSM.rt = new T.WebGLRenderTarget(1, 1, { depthBuffer: false }); CSM.cam = new T.PerspectiveCamera(1, 1, .1, 1); CSM.cam.position.set(0, -1e6, 0); CSM.cam.lookAt(0, -2e6, 0); CSM.cam.updateMatrixWorld(); CSM.cam.layers.set(CSM.layer); }
    CSM.scene.children = scene.children; far.layers.enable(CSM.layer);
    if ((CSM.walkT -= dt) <= 0) { CSM.walkT = 3; scene.traverse(o => { if (!o.isMesh || !o.castShadow || o.isSkinnedMesh || !o.frustumCulled || (o.layers.mask & (1 << CSM.layer)) !== 0 || o.userData.gtSmall) return; const g = o.geometry; if (!g) return; if (!g.boundingSphere) g.computeBoundingSphere(); const s = o.matrixWorld.getMaxScaleOnAxis(), r = (g.boundingSphere ? g.boundingSphere.radius : 0) * s; if (r >= CSM.minR) { o.layers.enable(CSM.layer); CSM.tagged++; } else o.userData.gtSmall = 1; }); }
    const fs = lvl.farMap || 2048; if (far.shadow.mapSize.x !== fs) { far.shadow.mapSize.set(fs, fs); if (far.shadow.map) { far.shadow.map.dispose(); far.shadow.map = null; } CSM.due = true; }
    if (CSM.due || frameNo % Math.max(8,lvl.farEvery || 3) === 1) { CSM.due = false; if (A.placeFar) A.placeFar(); far.shadow.autoUpdate = false; far.shadow.needsUpdate = true; const sm = renderer.shadowMap, nu = sm.needsUpdate, c0 = renderer.info.render.calls;
      sm.needsUpdate = true; const ac = renderer.autoClear; renderer.autoClear = true; renderer.setRenderTarget(CSM.rt); renderer.render(CSM.scene, CSM.cam); renderer.setRenderTarget(null); renderer.autoClear = ac; sm.needsUpdate = nu; CSM.draws = renderer.info.render.calls - c0; }
    GTSHD[0] = 1; }

  /* ------------------------------------------------------------------ shaders */
  const VERT = `in vec3 position; out vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const HEAD = `precision highp float; precision highp sampler2D; precision highp int;
in vec2 vUv; out vec4 o;
const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
`;
  const DEPTH = `uniform sampler2D tDepth; uniform vec4 uProj; // near, far, 1/P00, 1/P11
float linZ(float d){ return uProj.x*uProj.y/(uProj.y - d*(uProj.y-uProj.x)); }
vec3 viewPos(vec2 uv, float z){ return vec3((uv*2.0-1.0)*uProj.zw*z, -z); }
`;

  const F_AO = HEAD + DEPTH + `
uniform vec2 uRes; uniform float uRadius, uProjScale, uIntensity; uniform vec2 uFade;
#define TAPS 16
float fz(ivec2 p){ return linZ(texelFetch(tDepth, clamp(p, ivec2(0), ivec2(uRes)-1), 0).r); }
vec3 pa(ivec2 p, float z){ return viewPos((vec2(p)+0.5)/uRes, z); }
void main(){
  ivec2 p = ivec2(vUv*uRes);
  float zc = fz(p);
  if (zc > uFade.y) { o = vec4(1.0, zc, 0.0, 1.0); return; }
  vec3 P = pa(p, zc);
  ivec2 ex = ivec2(1,0), ey = ivec2(0,1);
  float zl = fz(p-ex), zr = fz(p+ex), zd = fz(p-ey), zu = fz(p+ey);
  float zl2 = fz(p-2*ex), zr2 = fz(p+2*ex), zd2 = fz(p-2*ey), zu2 = fz(p+2*ey);
  // pick, per axis, the side whose depth extrapolates best to the centre (keeps normals clean right up to silhouettes)
  vec3 dx = abs(2.0*zl-zl2-zc) < abs(2.0*zr-zr2-zc) ? P - pa(p-ex, zl) : pa(p+ex, zr) - P;
  vec3 dy = abs(2.0*zd-zd2-zc) < abs(2.0*zu-zu2-zc) ? P - pa(p-ey, zd) : pa(p+ey, zu) - P;
  vec3 N = normalize(cross(dx, dy));
  float ssR = clamp(uProjScale*uRadius/zc, 3.0, 0.3*uRes.y);
  float wR = ssR*zc/uProjScale;                 // world radius actually covered after the pixel clamp
  float R2 = wR*wR;
  float rot = ign(gl_FragCoord.xy)*6.2831853;
  float bias = 0.004 + 0.0022*zc;
  float sum = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float a = (float(i)+0.5)/float(TAPS);
    float ang = a*6.2831853*7.0 + rot;
    float r = max(mix(a, a*a, 0.55)*ssR, 1.5);   /* LT: taps crowd toward the centre: contact darkening (wall feet, under cars, under awnings) reads, the wide term stays */
    ivec2 q = p + ivec2(floor(vec2(cos(ang), sin(ang))*r + 0.5));
    float zq = fz(q);
    vec3 v = pa(q, zq) - P;
    float vv = dot(v, v), vn = dot(v, N);
    float f = max(1.0 - vv/R2, 0.0);
    sum += f*f*f*max((vn - bias)/(vv + 0.02*R2), 0.0);
  }
  float ao = exp(-sum*wR*uIntensity/float(TAPS));
  ao = mix(ao, 1.0, smoothstep(uFade.x, uFade.y, zc));
  o = vec4(ao, zc, 0.0, 1.0);
}`;

  const F_AOBLUR = HEAD + DEPTH + `
uniform sampler2D tAO; uniform vec2 uDir, uRes;
// 1/z straight from the 24-bit depth buffer: linear in screen space on any plane, so the slope prediction below is exact
float iz(vec2 uv){ float d = texelFetch(tDepth, clamp(ivec2(uv*uRes), ivec2(0), ivec2(uRes)-1), 0).r; return (uProj.y - d*(uProj.y-uProj.x))/(uProj.x*uProj.y); }
void main(){
  vec2 c = texture(tAO, vUv).rg; float ic = iz(vUv);
  float ia = iz(vUv + uDir), ib = iz(vUv - uDir);
  float sl = abs(ia - ic) < abs(ic - ib) ? ia - ic : ic - ib;
  float tol = ic*0.003 + abs(sl)*0.3;
  float sum = c.r*0.20, ws = 0.20;
  float G[4]; G[0] = 0.19; G[1] = 0.15; G[2] = 0.10; G[3] = 0.06;
  for (int i = 1; i <= 4; i++) { for (int s = -1; s <= 1; s += 2) {
    float k = float(i*s); vec2 uv = vUv + uDir*k;
    float e = (iz(uv) - (ic + sl*k))/tol;
    float w = G[i-1]*exp(-e*e);
    sum += texture(tAO, uv).r*w; ws += w; } }
  o = vec4(sum/ws, c.g, 0.0, 1.0);
}`;

  const F_SHAFTMASK = HEAD + DEPTH + `
uniform sampler2D tScene, tExpo; uniform mat3 uCamRot; uniform vec3 uSunDir; uniform float uSkyZ;
void main(){
  float z = linZ(texture(tDepth, vUv).r);
  float sky = smoothstep(uSkyZ*0.8, uSkyZ, z);
  vec3 c = vec3(0.0);
  if (sky > 0.0) {
    float ex = texture(tExpo, vec2(0.5)).r;
    vec3 wd = uCamRot*normalize(viewPos(vUv, 1.0));
    float mu = max(dot(wd, uSunDir), 0.0);
    c = min(texture(tScene, vUv).rgb, vec3(1.7/ex));   /* LT: the disc is capped lower (no white blob round a low sun) and the bright sky round it counts wider, so palms and gaps between buildings cut real beams */
    float l = dot(c, LUM)*ex;
    c *= sky*(0.02 + 0.98*pow(mu, 14.0))*smoothstep(0.35, 1.5, l);
  }
  o = vec4(c, 1.0);
}`;
  const F_RADIAL = HEAD + `
uniform sampler2D tSrc; uniform vec2 uSun; uniform float uLen, uDecay;
void main(){
  vec2 dlt = uSun - vUv; float l = length(dlt); dlt *= min(1.0, 0.5/max(l, 1e-4));
  vec2 st = dlt*uLen/8.0;
  vec3 acc = vec3(0.0); float ws = 0.0, w = 1.0;
  for (int i = 0; i < 8; i++) { acc += texture(tSrc, vUv + st*float(i)).rgb*w; ws += w; w *= uDecay; }
  o = vec4(acc/ws, 1.0);
}`;

  const F_COMPOSITE = HEAD + DEPTH + `
uniform sampler2D tScene, tAO, tShaft, tExpo, tPrev;
uniform float uSsr, uSsrG, uSsrK;
uniform vec2 uHalfRes; uniform mat3 uCamRot; uniform vec3 uSunDir, uHazeSun, uHazeAmb;
uniform float uCamY, uDensity, uHFall, uExt, uAOOn, uAOStr, uShaft, uSkyZ, uAirK;
uniform vec3 uAirC, uAirSunC, uAirOppC, uAirDir;
void main(){
  vec4 sc = texture(tScene, vUv);
  vec3 c = sc.rgb;
  c = vec3(c.r == c.r ? c.r : 0.0, c.g == c.g ? c.g : 0.0, c.b == c.b ? c.b : 0.0);
  c = clamp(c, 0.0, 6.0e4);
  float z = linZ(texture(tDepth, vUv).r);
  float ex = texture(tExpo, vec2(0.5)).r;
  float sky = smoothstep(uSkyZ*0.8, uSkyZ, z);
  float wetA = sc.a == sc.a ? clamp(1.0 - sc.a, 0.0, 1.0) : 0.0;   /* wet ground materials write 1 - reflectivity into alpha (js/materials.js); everything else writes 1 */
  vec3 refl = vec3(0.0); float reflK = 0.0;
  vec3 p0 = viewPos(vUv, z); vec3 gx = dFdx(p0), gy = dFdy(p0);                 /* derivatives are taken outside the branch */
  if (uSsr > 0.5 && wetA > 0.02 && sky < 0.5) {
    vec3 upV = vec3(uCamRot[0].y, uCamRot[1].y, uCamRot[2].y);                 /* world up seen from the camera */
    vec3 gn = normalize(cross(gx, gy) + vec3(0.0, 0.0, 1e-9));
    float flatK = smoothstep(0.8, 0.93, abs(dot(gn, upV)));                     /* only ground that really lies flat (cut-out foliage also has alpha below 1) */
    vec3 I = normalize(p0);
    float cosI = clamp(-dot(I, upV), 0.0, 1.0);
    if (flatK > 0.01 && cosI > 0.003) {
      float rough = 1.0 - smoothstep(0.5, 0.82, wetA);                           /* damp tarmac smears, a puddle mirrors */
      vec3 Rv = reflect(I, upV);                                                 /* one clean mirror ray per pixel. The old march tilted and started every pixel differently, so each pixel hit or missed a sign on its own: a spray of dots */
      float t = 0.22, tp = 0.0,   /* b5: the start of the march was jittered per pixel (0.3*ign); on a damp patch that mirrors a far wall every other pixel hit or missed on its own: a checker of dots on the yard tarmac and the rain promenade. All pixels now start alike; the bisection below already removes the step banding */ pd = 0.0, pz = -p0.z, hit = 0.0, th = 0.0, tl = 0.0; vec2 huv = vUv;
      int steps = int(uSsr + 0.5);
      for (int i = 0; i < 16; i++) {
        if (i >= steps) break;
        vec3 q = p0 + Rv*t;
        if (q.z > -uProj.x) break;
        vec2 quv = q.xy/(uProj.zw*(-q.z))*0.5 + 0.5;
        if (quv.x < 0.0 || quv.x > 1.0 || quv.y < 0.0 || quv.y > 1.0) break;
        float zs = linZ(textureLod(tDepth, quv, 0.0).r);
        float d = -q.z - zs, adv = abs(-q.z - pz);
        bool thru = pd <= 0.0 && d < adv + 0.5;                                 /* the ray went through a surface inside this step, however thin it is (sign boards, lamp heads) */
        if (d > 0.0 && (thru || d < 1.2 + t*0.5) && zs < uSkyZ*0.8) { hit = 1.0; th = t; tl = thru ? tp : t; huv = quv; break; }
        pd = d; pz = -q.z; tp = t; t *= uSsrG;
      }
      if (hit > 0.5) {
        for (int k = 0; k < 5; k++) {                                            /* close in on the crossing: the hit point no longer depends on where the steps happened to fall, so neighbours agree */
          if (th - tl < 0.02) break;
          float tm = 0.5*(tl + th); vec3 q = p0 + Rv*tm; vec2 quv = q.xy/(uProj.zw*(-q.z))*0.5 + 0.5;
          float d = -q.z - linZ(textureLod(tDepth, quv, 0.0).r);
          if (d > 0.0 && d < 1.5 + tm*0.5) { th = tm; huv = quv; } else tl = tm;
        }
        vec2 e = smoothstep(vec2(0.0), vec2(0.07), huv)*smoothstep(vec2(0.0), vec2(0.07), 1.0 - huv);
        float F = 0.08 + 0.92*pow(1.0 - cosI, 3.4);
        reflK = wetA*flatK*F*e.x*e.y*uSsrK*(1.0 - smoothstep(45.0, 80.0, th))*(1.0 - 0.5*rough);   /* LT: damp (rough) ground gives back a darker, broken image; only puddles mirror */
        vec2 sd = huv - vUv; float sl = length(sd); sd = sl > 1e-4 ? sd/sl : vec2(0.0, 1.0);
        sd *= rough*clamp(0.04 + 0.42*sl, 0.04, 0.2);                           /* damp tarmac: the image is drawn out along the line toward the eye (five filtered taps, no noise). A puddle (rough 0) keeps one sharp tap */
        float lod = 3.0*rough;
        refl = textureLod(tPrev, huv, lod).rgb*0.3 + (textureLod(tPrev, huv + sd*0.5, lod).rgb + textureLod(tPrev, huv - sd*0.5, lod).rgb)*0.22 + (textureLod(tPrev, clamp(huv + sd, 0.0, 1.0), lod + 0.6).rgb + textureLod(tPrev, clamp(huv - sd, 0.0, 1.0), lod + 0.6).rgb)*0.13;
        refl = min(refl, vec3(80.0));
        refl = vec3(refl.r == refl.r ? refl.r : 0.0, refl.g == refl.g ? refl.g : 0.0, refl.b == refl.b ? refl.b : 0.0);
      }
    }
  }
  if (uAOOn > 0.5) {                                   // joint-bilateral upsample of the half-res AO
    vec2 hp = vUv*uHalfRes - 0.5; vec2 f = fract(hp); vec2 b = (floor(hp)+0.5)/uHalfRes; vec2 tx = 1.0/uHalfRes;
    vec2 s00 = texture(tAO, b).rg, s10 = texture(tAO, b+vec2(tx.x,0.0)).rg, s01 = texture(tAO, b+vec2(0.0,tx.y)).rg, s11 = texture(tAO, b+tx).rg;
    vec4 bw = vec4((1.0-f.x)*(1.0-f.y), f.x*(1.0-f.y), (1.0-f.x)*f.y, f.x*f.y);
    vec4 dz = abs(vec4(s00.g, s10.g, s01.g, s11.g) - z)/z;
    vec4 w = bw*(1.0/(1.0 + dz*dz*4.0e4)) + 1e-5;
    float ao = dot(w, vec4(s00.r, s10.r, s01.r, s11.r))/(w.x+w.y+w.z+w.w);
    ao = pow(ao, uAOStr);
    float l = dot(c, LUM)*ex;
    ao = mix(ao, 1.0, smoothstep(0.7, 4.0, l)*0.72);  // direct sun / emissives keep most of their energy (LT: .85 -> .72, contact shade survives next to sunlit ground)
    vec3 aoc = pow(vec3(ao), vec3(1.0, 0.96, 0.90));   // occluded light is skylight: a touch cooler
    c *= mix(aoc, vec3(1.0), sky);
  }
  c = c*(1.0 - 0.3*reflK) + refl*reflK;
  vec3 vp = viewPos(vUv, z); float dist = length(vp); vec3 wd = uCamRot*(vp/dist);
  float mu = max(dot(wd, uSunDir), 0.0);
  float t = min(dist, 2500.0), ry = wd.y*uHFall;
  float hI = abs(ry) > 1e-5 ? (1.0 - exp(-clamp(ry*t, -30.0, 30.0)))/ry : t;
  float fogT = (1.0 - exp(-uDensity*exp(-uHFall*max(uCamY, 0.0))*hI))*(1.0 - sky);
  float mu2 = mu*mu, mu4 = mu2*mu2, mu8 = mu4*mu4;
  float ph = 0.10 + 0.45*mu2*mu + 1.0*mu8*mu4;
  float am = dot(wd, uAirDir), aa = max(am, 0.0), ab = max(-am, 0.0); aa *= aa; aa *= aa*aa;
  vec3 air = uAirC + (uAirSunC - uAirC)*aa + (uAirOppC - uAirC)*ab*ab;      /* aerial perspective in the sky's own colour, layered by height: the feet of far towers melt first */
  c = c*(1.0 - fogT*uExt) + air*(fogT*uExt*uAirK) + (uHazeSun*ph + uHazeAmb)/ex*fogT;
  c += texture(tShaft, vUv).rgb*uShaft*(1.0 - 0.65*sky);
  o = vec4(c, 1.0);
}`;

  const F_MBLUR = HEAD + DEPTH + `
uniform sampler2D tScene; uniform mat4 uReproj; uniform float uAmt, uMax, uNear; uniform vec2 uRes;
void main(){
  float z = linZ(texture(tDepth, vUv).r);
  vec4 pc = uReproj*vec4(viewPos(vUv, z), 1.0);
  vec3 c0 = texture(tScene, vUv).rgb;
  vec2 vel = pc.w > 1e-4 ? (vUv - (pc.xy/pc.w*0.5+0.5))*uAmt : vec2(0.0);
  vel *= smoothstep(uNear*0.6, uNear, z);
  float len = length(vel);
  if (len*uRes.y < 0.75) { o = vec4(c0, 1.0); return; }
  vel *= min(1.0, uMax/len);
  float j = ign(gl_FragCoord.xy) - 0.5;
  vec3 acc = c0; float ws = 1.0;
  for (int i = 0; i < 9; i++) {
    float t = (float(i) + 0.5 + j)/9.0 - 0.5;
    vec2 u = vUv + vel*t;
    float zi = linZ(texture(tDepth, u).r);
    float w = smoothstep(uNear*0.6, uNear, zi);
    acc += texture(tScene, u).rgb*w; ws += w;
  }
  o = vec4(acc/ws, 1.0);
}`;

  const F_HALF = HEAD + `
uniform sampler2D tSrc; uniform vec2 uTexel;
void main(){
  vec3 c = texture(tSrc, vUv + uTexel*vec2(-0.5,-0.5)).rgb + texture(tSrc, vUv + uTexel*vec2(0.5,-0.5)).rgb
         + texture(tSrc, vUv + uTexel*vec2(-0.5,0.5)).rgb + texture(tSrc, vUv + uTexel*vec2(0.5,0.5)).rgb;
  o = vec4(clamp(c*0.25, 0.0, 6.0e4), 1.0);
}`;

  const TAP13 = `
  vec3 A = S(vec2(-2.0,-2.0)), B = S(vec2(0.0,-2.0)), C = S(vec2(2.0,-2.0)), D = S(vec2(-2.0,0.0)), E = S(vec2(0.0)), F = S(vec2(2.0,0.0)),
       G = S(vec2(-2.0,2.0)), H = S(vec2(0.0,2.0)), I = S(vec2(2.0,2.0)), J = S(vec2(-1.0,-1.0)), K = S(vec2(1.0,-1.0)), L = S(vec2(-1.0,1.0)), M = S(vec2(1.0,1.0));`;
  const F_BRIGHT = HEAD + `
uniform sampler2D tSrc, tExpo; uniform vec2 uTexel; uniform float uThr, uKnee, uBase, uClamp;
vec3 S(vec2 d){ return textureLod(tSrc, vUv + d*uTexel, 0.0).rgb; }
void main(){
  float ex = texture(tExpo, vec2(0.5)).r;` + TAP13 + `
  vec3 g0 = (J+K+L+M)*0.25, g1 = (A+B+D+E)*0.25, g2 = (B+C+E+F)*0.25, g3 = (D+E+G+H)*0.25, g4 = (E+F+H+I)*0.25;
  float w0 = 0.5/(1.0+dot(g0,LUM)*ex), w1 = 0.125/(1.0+dot(g1,LUM)*ex), w2 = 0.125/(1.0+dot(g2,LUM)*ex), w3 = 0.125/(1.0+dot(g3,LUM)*ex), w4 = 0.125/(1.0+dot(g4,LUM)*ex);
  vec3 c = (g0*w0 + g1*w1 + g2*w2 + g3*w3 + g4*w4)/(w0+w1+w2+w3+w4);   // Karis average: no fireflies
  float l = dot(c, LUM)*ex;
  float rq = clamp(l - uThr + uKnee, 0.0, 2.0*uKnee); rq = rq*rq/(4.0*uKnee + 1e-4);
  float k = max(rq, l - uThr)/max(l, 1e-4);
  c *= (k + uBase);
  c *= 1.0/(1.0 + max(l - uThr, 0.0)/uClamp);          // very hot sources saturate instead of flooding the frame
  o = vec4(c, 1.0);
}`;
  const F_DOWN = HEAD + `
uniform sampler2D tSrc; uniform vec2 uTexel;
vec3 S(vec2 d){ return texture(tSrc, vUv + d*uTexel).rgb; }
void main(){` + TAP13 + `
  o = vec4(E*0.125 + (A+C+G+I)*0.03125 + (B+D+F+H)*0.0625 + (J+K+L+M)*0.125, 1.0);
}`;
  const F_UP = HEAD + `
uniform sampler2D tSrc, tAdd; uniform vec2 uTexel; uniform float uW, uSpread;
void main(){
  vec2 d = uTexel*uSpread;
  vec3 s = texture(tSrc, vUv).rgb*4.0
    + (texture(tSrc, vUv+vec2(d.x,0.0)).rgb + texture(tSrc, vUv-vec2(d.x,0.0)).rgb + texture(tSrc, vUv+vec2(0.0,d.y)).rgb + texture(tSrc, vUv-vec2(0.0,d.y)).rgb)*2.0
    + texture(tSrc, vUv+d).rgb + texture(tSrc, vUv-d).rgb + texture(tSrc, vUv+vec2(d.x,-d.y)).rgb + texture(tSrc, vUv+vec2(-d.x,d.y)).rgb;
  o = vec4(s/16.0 + texture(tAdd, vUv).rgb*uW, 1.0);
}`;
  const F_STREAK = HEAD + `
uniform sampler2D tSrc, tExpo; uniform vec2 uStep; uniform float uFirst;
void main(){
  float ex = texture(tExpo, vec2(0.5)).r;
  vec3 acc = vec3(0.0); float ws = 0.0;
  float W[5]; W[0] = 1.0; W[1] = 0.86; W[2] = 0.62; W[3] = 0.38; W[4] = 0.18;
  for (int i = -4; i <= 4; i++) {
    vec3 s = texture(tSrc, vUv + uStep*float(i)).rgb;
    if (uFirst > 0.5) { float l = dot(s, LUM)*ex; s *= smoothstep(2.6, 11.0, l); }   /* b5: was 1.5 to 7: every headlamp drew a bar across the frame that hid the vehicle behind it */   // only very hot sources streak
    float w = W[i < 0 ? -i : i]; acc += s*w; ws += w;
  }
  o = vec4(acc/ws, 1.0);
}`;

  const F_METER = HEAD + `
uniform sampler2D tSrc, tPrev; uniform float uLod, uKey, uComp, uMin, uMax, uDt, uReset, uAuto, uManual;
void main(){
  float sum = 0.0, ws = 0.0, lin = 0.0;
  for (int y = 0; y < 12; y++) for (int x = 0; x < 16; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5)/vec2(16.0, 12.0);
    float l = dot(textureLod(tSrc, uv, uLod).rgb, LUM);
    vec2 d = uv - vec2(0.5, 0.45); float w = 1.0 - 0.75*smoothstep(0.1, 0.75, length(d)*1.4);   // centre-weighted
    l = min(l, 40.0);
    if (l == l) { sum += log(max(l, 2e-4))*w; lin += min(l, 12.0)*w; ws += w; }
  }
  float avg = exp(sum/max(ws, 1e-3));
  avg = pow(avg, 0.6)*pow(max(lin/max(ws, 1e-3), 1e-4), 0.4);   // lean toward the arithmetic mean: protects bright skies
  float target = clamp(pow(uKey/avg, uComp)*pow(min(0.19/avg, 1.0), 0.85), uMin, uMax);   /* g6 r3: an evenly bright scene (a white-walled lit room: no shade to pull the average down) is not exposed up into the shoulder */
  if (uAuto < 0.5) target = uManual;
  float prev = texture(tPrev, vec2(0.5)).r;
  if (!(prev > 0.0) || uReset > 0.5) prev = target;
  float rate = target < prev ? 3.2 : 1.1;            // eyes close fast, open slowly
  float e = mix(prev, target, 1.0 - exp(-uDt*rate));
  if (!(e > 0.0)) e = 1.0;
  o = vec4(e, avg, 0.0, 1.0);
}`;

  const F_GRADE = HEAD + DEPTH + `
uniform sampler2D tScene, tBloom, tStreak, tDirt, tExpo, tVisor;
uniform float uVisor, uVisorZ;
uniform vec2 uBloomTexel; uniform vec3 uStreakTint;
uniform float uBloom, uStreak, uDirt, uCA, uVig, uFocus, uBias, uAspect, uGrade, uTime, uLk, uNt, uSy, uWp, uSc, uSa, uSh, uBp, uWarm;
vec3 agxCurve(vec3 x){ vec3 x2 = x*x, x4 = x2*x2; return 15.5*x4*x2 - 40.14*x4*x + 31.96*x4 - 6.868*x2*x + 0.4298*x2 + 0.1191*x - 0.00232; }
vec3 agx(vec3 v){
  const mat3 mi = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 mo = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0989611768448433, -0.0989611768448433, 1.15107367264116);
  const float lo = -12.47393, hi = 4.026069;
  v = mi*max(v, 0.0);
  v = (clamp(log2(max(v, 1e-10)), lo, hi) - lo)/(hi - lo);
  v = agxCurve(v);
  float l = dot(v, LUM);
  v = pow(max(v, 0.0), vec3(1.3));                  // "punchy" look: more contrast …
  v = l + mix(1.3, 1.04, uSy)*(v - l);              /* … and the saturation AgX takes away, without clipping hue · g6 r3: the photo grade (uSy) gives back only what AgX took, not 30 % on top (measured: twice the saturation of the reference stills) */
  return clamp(mo*v, 0.0, 1.0);                      // result is display-encoded (2.2-ish), no further sRGB step
}
void main(){
  vec2 d = vUv - 0.5; vec2 da = d*vec2(uAspect, 1.0);
  float r2 = dot(da, da)/(0.25*(uAspect*uAspect + 1.0));           // 0 centre .. 1 corner
  vec2 co = d*r2*r2*uCA*0.0036;
  vec2 suv = vUv; float vm = 0.0, vl = 0.0; vec2 vn = vec2(0.0);
  if (uVisor > 0.002) {                                                /* rain on the visor: each drop is a little lens (the picture inside it is upside down and wide), trails wobble what is behind them */
    vec3 vt = texture(tVisor, vUv).rgb; vn = vt.rg - vec2(0.50196); vl = length(vn);
    vm = smoothstep(0.08, 0.45, vt.b)*uVisor;
    if (uVisorZ > 0.0) vm *= smoothstep(uVisorZ*0.75, uVisorZ, linZ(texture(tDepth, vUv).r));   /* in a car the drops sit on the windscreen: only where the view goes out through the glass (the cabin itself is nearer than uVisorZ) */                          /* blue = the drop's own coverage: the whole disc counts, not only where the lens bends */
    suv = clamp(vUv - vn*vec2(1.0/uAspect, 1.0)*(0.13*vm), vec2(0.002), vec2(0.998));
  }
  vec3 c = vec3(texture(tScene, suv - co).r, texture(tScene, suv - co*0.25).g, texture(tScene, suv + co*0.8).b);
  if (vm > 0.0) {                                                      /* a dark meniscus round each drop, caught light low in it (the lens shows the sky upside down) and a small hard glint on its upper-left shoulder */
    float vrim = smoothstep(0.2, 0.42, vl);
    c *= 1.0 - vm*(0.62*vrim + 0.07) + vm*0.6*max(-vn.y - 0.16, 0.0)*(1.0 - vrim);
    float vgl = pow(max(dot(vn/max(vl, 1e-3), vec2(-0.5, 0.866)), 0.0), 10.0)*smoothstep(0.16, 0.3, vl)*(1.0 - smoothstep(0.36, 0.46, vl))*vm;
    c += vgl*(c*1.6 + vec3(0.1, 0.11, 0.12)/max(texture(tExpo, vec2(0.5)).r, 0.05));
  }
  vec2 bt = uBloomTexel*0.5;
  vec3 bl = (texture(tBloom, vUv + bt).rgb + texture(tBloom, vUv - bt).rgb + texture(tBloom, vUv + vec2(bt.x, -bt.y)).rgb + texture(tBloom, vUv + vec2(-bt.x, bt.y)).rgb)*0.25;
  vec3 st = texture(tStreak, vUv).rgb*uStreakTint;
  float dirt = texture(tDirt, vUv).r;
  c += bl*uBloom*(1.0 + dirt*uDirt) + st*uStreak*(1.0 + dirt*uDirt*0.5);
  float ex = texture(tExpo, vec2(0.5)).r*uBias;
  float vg = 1.0 + r2*(uVig*0.44 + uFocus*0.5); vg = 1.0/(vg*vg);
  c *= ex*vg*1.6;                                                  // 1.6: compensates the darker mid-grey of the punchy AgX look
  float hl = dot(c, LUM); if (hl > 1.4) c *= (1.4 + (hl - 1.4)/(1.0 + (hl - 1.4)/1.5))/hl;   /* highlight shoulder: sun glints, lit signs and headlights keep their colour instead of clipping to a white patch */
  c = agx(c);
  float l = dot(c, LUM);
  /* 霓虹江城 grade (uLk = strength, uNt = night): blacks pulled down, more contrast and saturation, shade pushed to teal-blue, highlights peach by day and left in the colour of their source at night */
  float bk = uLk*mix(0.010, 0.020, uNt);
  c = max(c - 0.006 - bk, 0.0)/(0.994 - bk); c *= 1.0 + 0.55*uGrade*(1.0 - uLk*mix(0.45, 0.85, uNt))*mix(1.0, mix(0.12, 0.6, uNt), uSy)*exp(-l*7.0);   /* g6 r3: by day the toe lift is nearly gone (it filled every shadow: 10th-percentile luma sat at 0.27) */     /* toe: shade keeps its texture by day; at night the gaps between lamps go to black */
  l = dot(c, LUM);
  c = mix(c, c*c*(3.0 - 2.0*c), (0.22 + 0.2*uLk)*uGrade);            // S curve: sunlit vs shade must read
  l = dot(c, LUM);
  { float mxc = max(c.r, max(c.g, c.b)), mnc = min(c.r, min(c.g, c.b)); vec3 cs = mix(vec3(l), c, 1.0 + uLk*uGrade*mix(0.22, 0.3, uNt)); c = max(mix(cs, c, smoothstep(0.5, 0.95, mxc - mnc)*0.75), 0.0); }   /* vibrance: grey-beige mid-tones gain colour, neon that is already saturated is left alone */
  float sh = 1.0 - smoothstep(0.0, 0.42, l), hi = smoothstep(0.5, 0.95, l);
  vec3 tint = mix(vec3(0.97, 1.0, 1.03), vec3(1.0 + 0.045*uWarm, 1.0, 1.0 - 0.05*uWarm), smoothstep(0.08, 0.78, l));   /* LT: warm highlights only at golden hour and night (uWarm); by day the white point stays neutral */
  vec3 tintN = mix(vec3(1.0), mix(vec3(0.87, 1.0, 1.07), vec3(0.72, 1.02, 1.13), uNt), sh)*mix(vec3(1.0), mix(vec3(1.075, 1.0, 0.87), vec3(1.0), uNt), hi);
  c *= mix(vec3(1.0), mix(tint, tintN, uLk), uGrade);
  c += uLk*uGrade*vec3(0.0, 0.011, 0.016)*sh*sh*mix(1.0, 0.35, uNt)*smoothstep(0.0, 0.02, l + 0.012*(1.0 - uNt));   /* deep shade sits near #0a2a33 instead of neutral grey; pure black stays black at night */
  if (uSy > 0.001) {                                                  /* g6 r3 photo grade (replaces the r1/r2 "more colour" block, which measured at twice the saturation of the reference and read as a cartoon): levels so shade is dark and sunlit ground and sky are bright, a filmic S, saturation pulled down hardest where it is highest, a faint cool shade / warm highlight */
    float k = uSy*uGrade, dy = 1.0 - uNt; l = dot(c, LUM);
    float bp = k*mix(0.014, 0.058 + uBp, dy), wp = 1.0 - k*mix(0.06, uWp, dy);
    c = max(c - bp, 0.0)/(wp - bp);
    { vec3 ov = max(c - 0.74, 0.0)/0.26; c = mix(c, min(c, 0.74 + 0.26*ov/(1.0 + 0.3*ov)), k*dy); }   /* shoulder: white walls and sunlit paving roll off instead of clipping (1.0 lands at 0.94, 1.2 at 1.0) */
    { vec3 cc = clamp(c, 0.0, 1.0); c = mix(c, cc*cc*(3.0 - 2.0*cc), uSc*k*mix(0.45, 1.0, dy)); }
    l = dot(c, LUM);
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), sa = (mx - mn)/max(mx, 0.08);
    float sk = mix(uSa, uSa*uSh, smoothstep(0.22, 0.75, sa)); sk = mix(1.0, mix(sk, mix(1.7, 0.9, smoothstep(0.12, 0.5, sa)), uNt*0.85), k);   /* night keeps the colour of its lamps and signs */
    c = max(mix(vec3(l), c, sk), 0.0);
    float hs = smoothstep(0.82, 1.0, l); c = mix(c, vec3(l), hs*0.3*k);        /* the last stop before white loses its colour, as film does */
    float s2 = 1.0 - smoothstep(0.04, 0.4, l), h2 = smoothstep(0.55, 0.95, l);
    c *= mix(vec3(1.0), mix(vec3(0.955, 0.985, 1.05), vec3(0.89, 0.97, 1.11), uNt), s2*k)*mix(vec3(1.0), vec3(1.0 + 0.02*uWarm, 1.0 + 0.005*uWarm, 1.0 - 0.03*uWarm), h2*k*dy);
  }
  if (uFocus > 0.0) {
    l = dot(c, LUM);
    vec3 f = mix(c, vec3(l), 0.68)*vec3(0.86, 0.98, 1.13);
    f = mix(f, f*f*(3.0 - 2.0*f), 0.35);
    c = mix(c, f, uFocus);
  }
  float n = hash12(gl_FragCoord.xy + uTime*61.0) + hash12(gl_FragCoord.yx*1.31 + 17.0 + uTime*37.0) - 1.0;   // triangular dither: no banding in sky gradients
  c = clamp(c + n/255.0, 0.0, 1.0);
  o = vec4(c, dot(c, LUM));
}`;

  const F_OUT = HEAD + `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFxaa, uSharp, uGrain, uTime;
void main(){
  vec4 m = texture(tSrc, vUv);
  vec4 nw = texture(tSrc, vUv + uTexel*vec2(-1.0, 1.0)), ne = texture(tSrc, vUv + uTexel*vec2(1.0, 1.0)), sw = texture(tSrc, vUv + uTexel*vec2(-1.0, -1.0)), se = texture(tSrc, vUv + uTexel*vec2(1.0, -1.0));
  float lmin = min(m.a, min(min(nw.a, ne.a), min(sw.a, se.a))), lmax = max(m.a, max(max(nw.a, ne.a), max(sw.a, se.a)));
  vec3 c = m.rgb; float range = lmax - lmin, edge = 0.0;
  if (uFxaa > 0.5 && range > max(0.035, lmax*0.11)) {
    vec2 dir = vec2(-((nw.a + ne.a) - (sw.a + se.a)), (nw.a + sw.a) - (ne.a + se.a));
    dir.y = -dir.y;                                                  // rows above are +y in uv space
    float red = max((nw.a + ne.a + sw.a + se.a)*0.25*0.125, 1.0/128.0);
    dir = clamp(dir/(min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0)*uTexel;
    vec3 a = 0.5*(texture(tSrc, vUv + dir*(1.0/3.0 - 0.5)).rgb + texture(tSrc, vUv + dir*(2.0/3.0 - 0.5)).rgb);
    vec3 b = a*0.5 + 0.25*(texture(tSrc, vUv - dir*0.5).rgb + texture(tSrc, vUv + dir*0.5).rgb);
    float lb = dot(b, LUM);
    c = (lb < lmin || lb > lmax) ? a : b; edge = 1.0;
  }
  if (uSharp > 0.0) {                                                // contrast-adaptive: flat areas get the most, hard edges almost none
    vec3 avg = (nw.rgb + ne.rgb + sw.rgb + se.rgb)*0.25;
    float amt = uSharp*0.55*(1.0 - smoothstep(0.08, 0.35, range))*(1.0 - edge);
    vec3 mn = min(m.rgb, min(min(nw.rgb, ne.rgb), min(sw.rgb, se.rgb))), mx = max(m.rgb, max(max(nw.rgb, ne.rgb), max(sw.rgb, se.rgb)));
    c = clamp(c + (c - avg)*amt, mn, mx);
  }
  float l = dot(c, LUM);
  vec2 gp = gl_FragCoord.xy; float ts = floor(uTime*24.0);
  float g1 = hash12(gp + ts*17.13) + hash12(gp*1.7 + 31.7 - ts*9.71) - 1.0;
  float g2 = hash12(floor(gp*0.5) + ts*5.31 + 7.0) - 0.5;            // a little 2px clumping, like real emulsion
  vec3 gc = vec3(g1) + 0.25*vec3(hash12(gp + 3.1 + ts) - 0.5, 0.0, hash12(gp + 9.7 - ts) - 0.5);
  c += (gc*0.75 + g2*0.5)*uGrain*0.02*(0.35 + 0.65*(1.0 - smoothstep(0.0, 0.9, l)));
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

  const F_PROBECOPY = HEAD + `
uniform samplerCube tB; uniform int uFace; uniform float uRes;
void main(){
  vec2 st = gl_FragCoord.xy/uRes*2.0 - 1.0; vec3 d;   /* GL cube face addressing: the texel this fragment writes is the one the same direction reads, whatever three's camera conventions */
  if (uFace == 0) d = vec3(1.0, -st.y, -st.x); else if (uFace == 1) d = vec3(-1.0, -st.y, st.x); else if (uFace == 2) d = vec3(st.x, 1.0, st.y);
  else if (uFace == 3) d = vec3(st.x, -1.0, -st.y); else if (uFace == 4) d = vec3(st.x, -st.y, 1.0); else d = vec3(-st.x, -st.y, -1.0);
  vec3 c = textureLod(tB, d, 0.0).rgb; c = vec3(c.r == c.r ? c.r : 0.0, c.g == c.g ? c.g : 0.0, c.b == c.b ? c.b : 0.0);
  o = vec4(clamp(c, 0.0, 48.0), 1.0);
}`;
  const F_MIRROR = HEAD + `
uniform sampler2D tSrc; uniform float uShoulder;
void main(){ vec3 c = max(texture(tSrc, vUv).rgb, 0.0); float l = dot(c, LUM); c *= 1.0/(1.0 + l/uShoulder); o = vec4(c*vec3(0.93, 0.96, 0.95), 1.0); }`;

  const F_DEBUG = HEAD + DEPTH + `
uniform sampler2D tSrc; uniform float uMode, uScale;
void main(){
  vec4 s = texture(tSrc, vUv); vec3 c;
  if (uMode < 0.5) c = vec3(s.r);
  else if (uMode < 1.5) { float z = linZ(texture(tDepth, vUv).r); c = vec3(fract(z), fract(z*0.1), z/200.0); }
  else c = s.rgb*uScale/(1.0 + s.rgb*uScale);
  o = vec4(uMode < 0.5 ? c : pow(clamp(c, 0.0, 1.0), vec3(1.0/2.2)), 1.0);
}`;

  /* ------------------------------------------------------------------ plumbing */
  let lastCW = -1, lastCH = -1, lastDpr = 0;
  let renderer = null, ok = false, tri, quad, fsScene, fsCam, W = -1, H = -1, time = 0, reset = true, wantMsaa = 4, scale = 1, lvl = LEVELS[3], frameNo = 0, lastScene = null;
  const M = {}, RT = {}, V = { a: new T.Vector3(), b: new T.Vector3(), c: new T.Color() };
  const prevVP = new T.Matrix4(), curVP = new T.Matrix4(), reproj = new T.Matrix4(), camRot = new T.Matrix3(), prevPos = new T.Vector3();
  let havePrev = false, dirtTex = null, black = null, initCam = null;

  function mk(frag, uniforms) {
    const u = {}; for (const k in uniforms) u[k] = { value: uniforms[k] };
    return new T.RawShaderMaterial({ glslVersion: T.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms: u, depthTest: false, depthWrite: false, blending: T.NoBlending });
  }
  function rt(w, h, o) {
    o = o || {};
    const t = new T.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), { format: T.RGBAFormat, type: o.type || T.HalfFloatType, minFilter: o.min || o.filter || T.LinearFilter, magFilter: o.filter || T.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: !!o.mips });
    t.texture.generateMipmaps = !!o.mips; return t;
  }
  function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target || null); renderer.render(fsScene, fsCam); info.passes++; }

  function makeDirt() {   // procedural lens dirt: dust discs, smears, a few rings. Linear data, R channel used.
    const c = document.createElement('canvas'); c.width = 512; c.height = 288; const g = c.getContext('2d'), r = GT.rng ? GT.rng('lensdirt') : Math.random;
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 288); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 150; i++) { const x = r() * 512, y = r() * 288, rad = 3 + Math.pow(r(), 2.2) * 46, a = .04 + r() * .13, gr = g.createRadialGradient(x, y, rad * (.35 + r() * .5), x, y, rad);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(.85, `rgba(255,255,255,${a * 1.25})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 6.3); g.fill(); }
    for (let i = 0; i < 14; i++) { const x = r() * 512, y = r() * 288, rad = 40 + r() * 110, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(255,255,255,${.05 + r() * .07})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    g.lineCap = 'round'; for (let i = 0; i < 40; i++) { const x = r() * 512, y = r() * 288, a = r() * 6.3, l = 6 + r() * 40; g.strokeStyle = `rgba(255,255,255,${.03 + r() * .06})`; g.lineWidth = .6 + r() * 1.6; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * .5 + (r() - .5) * 10, y + Math.sin(a) * l * .5 + (r() - .5) * 10, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    const t = new T.CanvasTexture(c); t.minFilter = T.LinearFilter; t.generateMipmaps = false; return t;
  }

  function init(o) {
    o = o || {};
    const canvas = o.canvas || document.createElement('canvas');
    if (o.msaa !== undefined) wantMsaa = o.msaa | 0;
    { const q = new URLSearchParams(location.search), qq = q.get('q');   // ?q=0..3 pins a quality level · ?gov=0 keeps the top level · stills (?auto=… without freeze=0) are never governed
      if (qq !== null && isFinite(+qq)) { R.quality = Math.max(0, Math.min(LEVELS.length - 1, +qq | 0)); gov.on = false; } else if (o.msaa !== undefined) LEVELS[LEVELS.length - 1].msaa = wantMsaa;
      if (q.get('gov') === '0' || (q.get('auto') && q.get('freeze') !== '0') || q.get('gov') === null && /HeadlessChrome/.test(navigator.userAgent)) gov.on = false;
      lvl = LEVELS[R.quality]; scale = lvl.scale; wantMsaa = lvl.msaa;
      if (q.get('probe') === '0') PROBE.on = false; if (q.get('csm') === '0') CSM.on = false; GPU.on = q.get('gpu') === '1' || q.get('fps') === '1';   /* LT: ?probe=0 no reflection probe · ?csm=0 one sun shadow map only · ?gpu=0 no GPU timer queries */
      if (q.get('ssr') === '0') ssr.on = false; if (q.get('warm') === '0') warm.on = false; if (q.get('mblur') !== null && isFinite(+q.get('mblur'))) fx.mblur = +q.get('mblur');   /* ?mblur=0: no camera motion blur */ if (q.get('mir') === '0') mirror.off = true;   /* ?ssr=0 no wet-ground reflections · ?mir=0 no rear-view render (mirrors fall back to the painted view) · ?visor=0 | 0..1 no / forced visor rain */
      { const vq = q.get('visor'); if (vq === '0') VZ.allow = false; else if (vq !== null && isFinite(+vq) && +vq > 0) VZ.force = Math.min(1, +vq); } }
    R.warm = warm;
    renderer = R.renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    renderer.outputEncoding = T.LinearEncoding; renderer.toneMapping = T.NoToneMapping; renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.info.autoReset = false;
    ok = !!renderer.capabilities.isWebGL2;
    if (ok) { const gl = renderer.getContext(); ok = !!gl.getExtension('EXT_color_buffer_float'); gl.getExtension('OES_texture_float_linear'); try { GPU.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch (e) { GPU.ext = null; } }
    if (!ok) { renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; console.warn('GT.render: WebGL2 float targets unavailable, post stack disabled'); }
    initCam = o.camera || null;

    tri = new T.BufferGeometry(); tri.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    quad = new T.Mesh(tri, null); quad.frustumCulled = false; fsScene = new T.Scene(); fsScene.autoUpdate = false; fsScene.add(quad); fsCam = new T.Camera();
    black = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, T.RGBAFormat); black.needsUpdate = true;
    dirtTex = makeDirt();

    mirror.camera = new T.PerspectiveCamera(MIRFOV, mirror.size.w / mirror.size.h, .4, 3000);   /* 34 x 72 degrees (was 26 x 58: the reflected rays of the stalk mirrors left it, so half of each glass fell back to the painted view) looking back: everything a scooter stalk mirror, a door mirror or the cabin mirror can show */
    if (ok) {
      const z2 = new T.Vector2(), z4 = new T.Vector4(), z3 = () => new T.Vector3();
      M.ao = mk(F_AO, { tDepth: null, uProj: z4, uRes: new T.Vector2(), uRadius: 1, uProjScale: 1, uIntensity: 1, uFade: new T.Vector2(140, 220) });
      M.aoBlur = mk(F_AOBLUR, { tDepth: null, uProj: z4, tAO: null, uDir: new T.Vector2(), uRes: new T.Vector2() });
      M.shaftMask = mk(F_SHAFTMASK, { tDepth: null, uProj: z4, tScene: null, tExpo: null, uCamRot: camRot, uSunDir: z3(), uSkyZ: 900 });
      M.radial = mk(F_RADIAL, { tSrc: null, uSun: new T.Vector2(), uLen: 1, uDecay: .9 });
      M.comp = mk(F_COMPOSITE, { tDepth: null, uProj: z4, tScene: null, tAO: null, tShaft: null, tExpo: null, uHalfRes: new T.Vector2(), uCamRot: camRot, uSunDir: z3(), uHazeSun: z3(), uHazeAmb: z3(),
        uCamY: 0, uDensity: 0, uHFall: .02, uExt: .5, uAOOn: 1, uAOStr: 1, uShaft: 0, uSkyZ: 900, uAirK: 0, uAirC: z3(), uAirSunC: z3(), uAirOppC: z3(), uAirDir: z3(), tPrev: null, uSsr: 0, uSsrG: 1.4, uSsrK: 1 });
      M.mblur = mk(F_MBLUR, { tDepth: null, uProj: z4, tScene: null, uReproj: reproj, uAmt: .5, uMax: .03, uNear: 2.6, uRes: new T.Vector2() });
      M.half = mk(F_HALF, { tSrc: null, uTexel: new T.Vector2() });
      M.bright = mk(F_BRIGHT, { tSrc: null, tExpo: null, uTexel: new T.Vector2(), uThr: 1, uKnee: .5, uBase: .005, uClamp: 9 });
      M.down = mk(F_DOWN, { tSrc: null, uTexel: new T.Vector2() });
      M.up = mk(F_UP, { tSrc: null, tAdd: null, uTexel: new T.Vector2(), uW: 1, uSpread: 1 });
      M.streak = mk(F_STREAK, { tSrc: null, tExpo: null, uStep: new T.Vector2(), uFirst: 0 });
      M.meter = mk(F_METER, { tSrc: null, tPrev: null, uLod: 4, uKey: .5, uComp: .7, uMin: .3, uMax: 3.2, uDt: .016, uReset: 1, uAuto: 1, uManual: 1 });
      M.grade = mk(F_GRADE, { tScene: null, tBloom: null, tStreak: null, tDirt: dirtTex, tExpo: null, uBloomTexel: new T.Vector2(), uStreakTint: new T.Vector3(.5, .72, 1.25),
        uBloom: 1, uStreak: 1, uDirt: 1, uCA: 1, uVig: 1, uFocus: 0, uBias: 1, uAspect: 1.6, uGrade: 1, uTime: 0, uLk: 1, uSy: 1, uBp: 0, uWarm: 1, uWp: .19, uSc: .4, uSa: .95, uSh: .85, uNt: 0, tVisor: null, uVisor: 0, uVisorZ: 0, tDepth: null, uProj: z4 });
      M.out = mk(F_OUT, { tSrc: null, uTexel: new T.Vector2(), uFxaa: 1, uSharp: 1, uGrain: 1, uTime: 0 });
      M.mirror = mk(F_MIRROR, { tSrc: null, uShoulder: 10 });
      M.probeCopy = mk(F_PROBECOPY, { tB: null, uFace: 0, uRes: 128 });
      M.debug = mk(F_DEBUG, { tDepth: null, uProj: z4, tSrc: null, uMode: 0, uScale: 1 });
      RT.expA = rt(1, 1, { filter: T.NearestFilter }); RT.expB = rt(1, 1, { filter: T.NearestFilter });
      const mo = { format: T.RGBAFormat, type: T.HalfFloatType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: true, stencilBuffer: false };
      RT.mirrorMS = new T.WebGLMultisampleRenderTarget(mirror.size.w, mirror.size.h, mo); RT.mirrorMS.samples = 2; RT.mirrorMS.texture.generateMipmaps = false;
      RT.mirrorS = new T.WebGLRenderTarget(mirror.size.w, mirror.size.h, mo); RT.mirrorS.texture.generateMipmaps = false;   /* the plain target is what the lower levels draw into; a target costs nothing until it is first used */
      RT.mirrorOut = rt(mirror.size.w, mirror.size.h);
      mirror.texture = RT.mirrorOut.texture;
    } else {
      RT.mirrorOut = new T.WebGLRenderTarget(mirror.size.w, mirror.size.h); mirror.texture = RT.mirrorOut.texture; mirror.texture.encoding = T.sRGBEncoding;
    }
    MIRU.gtRearTex.value = mirror.texture;
    resize();
    addEventListener('resize', resize);
    return R;
  }

  function disposeSized() { for (const k of ['scene', 'aoA', 'aoB', 'shA', 'shB', 'comp', 'mb', 'half', 'stA', 'stB', 'ldr']) if (RT[k]) { RT[k].dispose(); RT[k] = null; }
    if (RT.depth) { RT.depth.dispose(); RT.depth = null; } for (const a of [RT.down, RT.up]) if (a) for (const t of a) t.dispose(); RT.down = RT.up = null; }

  function resize() {
    if (!renderer) return;
    const cv = renderer.domElement, cw = Math.max(1, cv.clientWidth || innerWidth || 1), ch = Math.max(1, cv.clientHeight || innerHeight || 1);
    lastCW = cv.clientWidth; lastCH = cv.clientHeight; lastDpr = window.devicePixelRatio || 1;
    // Spend the pixel budget on the displayed scene rather than supersampling the desktop DPI.
    const maxRatio=Math.min(window.devicePixelRatio || 1,1.5,1152/cw,800/ch);
    const neuralRatio=Math.min(maxRatio,960/cw,720/ch);
    renderer.setPixelRatio(Math.max(neuralRatio,maxRatio*scale));
    renderer.setSize(cw, ch, false);
    if (initCam && initCam.isPerspectiveCamera) { initCam.aspect = cw / ch; initCam.updateProjectionMatrix(); }
    const s = renderer.getDrawingBufferSize(new T.Vector2()); if (s.x === W && s.y === H) return; W = s.x; H = s.y; info.w = W; info.h = H;
    if (!ok) return;
    disposeSized();
    RT.depth = new T.DepthTexture(W, H, T.UnsignedIntType); RT.depth.minFilter = RT.depth.magFilter = T.NearestFilter;
    const so = { format: T.RGBAFormat, type: T.HalfFloatType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: true, stencilBuffer: false, depthTexture: RT.depth };
    const ms = Math.min(wantMsaa, renderer.capabilities.maxSamples || 0);
    if (ms > 1) { RT.scene = new T.WebGLMultisampleRenderTarget(W, H, so); RT.scene.samples = ms; } else RT.scene = new T.WebGLRenderTarget(W, H, so);
    RT.scene.texture.generateMipmaps = false; info.msaa = ms > 1 ? ms : 0;
    const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2), qw = Math.ceil(W / 4), qh = Math.ceil(H / 4);
    RT.aoA = rt(hw, hh, { filter: T.NearestFilter }); RT.aoB = rt(hw, hh, { filter: T.NearestFilter });
    RT.shA = rt(qw, qh); RT.shB = rt(qw, qh);
    RT.comp = rt(W, H); RT.mb = rt(W, H);
    RT.half = rt(hw, hh, { mips: true, min: T.LinearMipmapLinearFilter });
    RT.down = []; RT.up = [];
    let w = qw, h = qh; for (let i = 0; i < 6; i++) { RT.down.push(rt(w, h)); if (i < 5) RT.up.push(rt(w, h)); w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
    RT.stA = rt(Math.ceil(W / 8), qh); RT.stB = rt(Math.ceil(W / 8), qh);
    RT.ldr = rt(W, H, { type: T.UnsignedByteType });
    reset = true; havePrev = false;
  }

  /** q: 0|'off', 1|'low', 2|'medium', 3|'high'. Resizes every shadow map found in `scene` (optional) and switches the filter. */
  function setShadowQuality(q, scene) {
    const lv = typeof q === 'string' ? { off: 0, low: 1, medium: 2, med: 2, high: 3 }[q] : q | 0, size = [0, 1024, 2048, 4096][GT.clamp ? GT.clamp(lv, 0, 3) : lv] || 2048;
    if (!renderer) return;
    const was = renderer.shadowMap.enabled, wasT = renderer.shadowMap.type;
    renderer.shadowMap.enabled = lv > 0; renderer.shadowMap.type = lv === 1 ? T.PCFShadowMap : T.PCFSoftShadowMap;
    if (scene) scene.traverse(n => {
      if (n.isLight && n.shadow && lv > 0) { const s = n.isDirectionalLight ? size : Math.max(512, size >> 1); if (n.shadow.mapSize.x !== s) { n.shadow.mapSize.set(s, s); if (n.shadow.map) { n.shadow.map.dispose(); n.shadow.map = null; } } }
      if (n.material && (was !== renderer.shadowMap.enabled || wasT !== renderer.shadowMap.type)) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => { m.needsUpdate = true; });
    });
    renderer.shadowMap.needsUpdate = true; info.shadow = lv;
  }

  /** Pin quality level n (0 = lowest … 3 = full). The governor calls this too; call GT.render.governor.on = false to stop it from changing your choice. */
  /** debug: [exposure, metered average] read back from the 1x1 adaptation target (tests and tuning only; never called per frame) */
  R.readExposure = function () { try { const b = new Uint16Array(4), hf = h => { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; return s * (e === 0 ? f / 1024 * Math.pow(2, -14) : Math.pow(2, e - 15) * (1 + f / 1024)); }; renderer.readRenderTargetPixels(RT.expA, 0, 0, 1, 1, b); return [+hf(b[0]).toFixed(3), +hf(b[1]).toFixed(4)]; } catch (e) { return null; } };
  function setQuality(n, why) {
    n = Math.max(0, Math.min(LEVELS.length - 1, n | 0)); const was = R.quality, L = lvl = LEVELS[n]; R.quality = n;
    if (!renderer) return n;
    if (L.scale !== scale || L.msaa !== wantMsaa) { scale = L.scale; wantMsaa = L.msaa; W = -1; resize(); }
    const sun = GT.atmos && GT.atmos.sun;
    if (sun && sun.shadow && sun.shadow.mapSize.x !== L.shadow) { sun.shadow.mapSize.set(L.shadow, L.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } renderer.shadowMap.needsUpdate = true; frameNo = 0; }
    if (GT.perf && GT.perf.lights && !GT.perf.lights.fixed) GT.perf.lights.budget = L.lights;
    if (n !== was) { gov.changes++; console.log('[render] quality ' + was + ' -> ' + n + (why ? ' (' + why + ')' : '') + '  ' + info.w + 'x' + info.h + ' msaa ' + info.msaa + ' shadow ' + L.shadow); }
    return n;
  }
  /* dynamic quality: hold the frame rate by trading resolution / MSAA / shadow detail. Steps down quickly, back up slowly, and backs off
     from a level that did not hold. Frame time is the real interval between frame() calls; hidden tabs and stalls are ignored. */
  function govern() {
    const now = performance.now(), d = now - gov.last; gov.last = now;
    if (!gov.on || !ok || document.hidden || d <= 0 || d > 250) { gov.slowT = gov.fastT = 0; return; }
    if (gov.holdT > 0) { gov.holdT -= d / 1000; gov.avg = d; return; }           // settling after a change (targets reallocated, shaders warm up)
    gov.avg += (d - gov.avg) * .06;
    const budget = 1000 / gov.target, slow = gov.avg > budget * 1.22, fast = gov.avg < budget * 1.06;   // under ~49 fps is slow, over ~56.5 is fine
    gov.slowT = slow ? gov.slowT + d / 1000 : 0; gov.fastT = fast ? gov.fastT + d / 1000 : 0;
    if (gov.slowT > 1.2 && R.quality > 0) {
      if (now - gov.upAt < 8000) { gov.retry[R.quality] = now + gov.backoff * 1000; gov.backoff = Math.min(600, gov.backoff * 2); }   // the level we just tried did not hold
      setQuality(R.quality - 1, gov.avg.toFixed(1) + ' ms'); gov.slowT = gov.fastT = 0; gov.holdT = 2;
    } else if (gov.fastT > 10 && R.quality < LEVELS.length - 1 && now > gov.retry[R.quality + 1]) {
      setQuality(R.quality + 1, 'headroom'); gov.upAt = now; gov.slowT = gov.fastT = 0; gov.holdT = 2;
    }
  }

  function renderMirror(scene) {
    const mc = mirror.camera; if (!mc) return;
    if (ok) { const tg = lvl.mirMsaa > 1 ? RT.mirrorMS : RT.mirrorS; renderer.setRenderTarget(tg); renderer.clear(); renderer.render(scene, mc); M.mirror.uniforms.tSrc.value = tg.texture; renderer.autoClear = false; pass(M.mirror, RT.mirrorOut); renderer.autoClear = true; }
    else { renderer.setRenderTarget(RT.mirrorOut); renderer.clear(); renderer.render(scene, mc); }
    MIRU.gtRearVP.value.multiplyMatrices(mc.projectionMatrix, mc.matrixWorldInverse); mirror.draws++;   /* the lookup is by world direction, so between two redraws the picture stays put while the vehicle turns */
  }
  /* first person on two wheels: nobody else poses the rear view, so it is done here, from just behind the delivery box, looking straight back along the bike (it leans with it) */
  const _mv = new T.Vector3();
  function riderFp() { const g = GT.cngame, p = g && g.player; if (!p || p.mode !== 'two' || !p.ent || !p.ent.veh || !p.ent.veh.group) return null; const c = g.ctl; return c && c.view === 'fp' ? p : null; }
  /* first person in a car: js/cngame.js switches the rear view on for exactly that. The same drop simulation then runs as rain on the windscreen, cleared by the wipers instead of by the head */
  function carFp() { const g = GT.cngame, p = g && g.player; return p && p.mode === 'car' && p.ent && mirror.enabled && !mirror.auto ? p : null; }
  function autoMirror(p) {
    if (p && !mirror.off) { const grp = p.ent.veh.group, mc = mirror.camera; grp.updateMatrixWorld(); if (mc.fov !== MIRFOV || mc.near !== .4) { mc.fov = MIRFOV; mc.near = .4; mc.updateProjectionMatrix(); } mc.position.copy(_mv.set(0, 1.12, -1.08).applyMatrix4(grp.matrixWorld)); grp.getWorldQuaternion(mc.quaternion); mc.updateMatrixWorld(); mirror.enabled = true; mirror.auto = true; }
    else if (mirror.auto) { mirror.enabled = false; mirror.auto = false; }
  }
  /* ------------------------------------------------------------------ helmet-visor rain
     visorSim is plain arithmetic (no DOM, no GL): drops land, stick, run down when they are heavy, are blown outward from the stagnation point once the bike is moving, and are sheared off
     sideways when the head turns fast. visorDraw paints them into a 384x216 canvas as little normal-map lenses over a slowly fading background, so every moving drop leaves a drying trail. */
  const WPIV = [[.5, .86], [.84, .86]];   /* where the two wiper spindles sit in the frame (fractions, y down), seen from the driver's seat */
  function vrnd() { VZ.seed = (VZ.seed * 1664525 + 1013904223) >>> 0; return VZ.seed / 4294967296; }
  /** o: { rain 0..1, speed m/s, yawRate rad/s (head / camera), max: drop budget }. Returns the live drop count. */
  function visorSim(dt, o) {
    const D = VZ.drops, rain = Math.max(0, Math.min(1, +o.rain || 0)), sp = Math.abs(+o.speed || 0), yr = +o.yawRate || 0, max = o.max || 150;
    const wind = Math.max(0, Math.min(1.6, (sp - 2.5) / 11)), wipe = VZ.wipe = Math.max(0, Math.min(1, (Math.abs(yr) - 1.1) / 2.4));
    VZ.acc += rain * (9 + 5.5 * Math.min(sp, 16)) * dt;
    while (VZ.acc >= 1) { VZ.acc -= 1; if (D.length >= max) continue; const k = vrnd(), big = Math.pow(k, 2.2); D.push({ x: vrnd(), y: vrnd() * 1.04 - .02, r: (.0085 + .026 * big) * (1 - .25 * Math.min(1, wind)),   /* fraction of the frame height: 5 to 22 px radius at 633 px (the old cubic left nearly every drop at 3.5 px, under 1.5 texels of the map: invisible) */ vx: 0, vy: 0, life: 5 + vrnd() * 9, slip: .7 + vrnd() * .6 }); VZ.stats.spawned++; }
    let wa0 = 0, wa1 = -1; if (o.wiper !== undefined) { const w = +o.wiper || 0, pw = VZ.wa || 0; VZ.wa = w; if (Math.abs(w - pw) > 1e-4) { wa0 = Math.min(w, pw) * 1.5 - .05; wa1 = Math.max(w, pw) * 1.5 + .05; } } else VZ.wa = 0;   /* the angle (radians above the scuttle) the two blades swept during this step */
    for (let i = D.length - 1; i >= 0; i--) { const d = D[i], m = Math.min(3, (d.r / .021) * (d.r / .021));
      let dx = d.x - .5, dy = d.y - .62; const l = Math.hypot(dx, dy) || 1e-3; dx /= l; dy /= l;
      let tx = dx * wind * .5 * (.45 + .55 * m), ty = dy * wind * .5 * (.45 + .55 * m) + (m > d.slip ? .028 * m : 0);   /* wind streams the water away from the middle of the visor; only heavy drops run down under their own weight */
      tx -= yr * .1 * (.4 + .6 * m);
      if (Math.hypot(tx, ty) < .012) { tx = 0; ty = 0; }                                                           /* surface tension: small forces move nothing */
      const k = Math.min(1, dt * 3.2); d.vx += (tx - d.vx) * k; d.vy += (ty - d.vy) * k;
      d.x += d.vx * dt / 1.78; d.y += d.vy * dt; d.life -= dt * (1 + 2.5 * wind); if (Math.hypot(d.vx, d.vy) > .05) d.r *= 1 - Math.min(.5, dt * .22);   /* a running drop leaves water behind */
      let dead = d.life <= 0 || d.r < .0045 || d.x < -.05 || d.x > 1.05 || d.y < -.06 || d.y > 1.06;
      if (!dead && wipe > 0 && vrnd() < wipe * 7 * dt) { dead = true; VZ.stats.wiped++; }
      if (!dead && wa1 > wa0) for (let k = 0; k < 2 && !dead; k++) { const qx = (d.x - WPIV[k][0]) * 1.78, qy = WPIV[k][1] - d.y, qr = Math.hypot(qx, qy); if (qr > .07 && qr < .52) { const qa = Math.atan2(qy, qx); if (qa >= wa0 && qa <= wa1) { dead = true; VZ.stats.wiped++; } } }
      if (dead) { D[i] = D[D.length - 1]; D.pop(); } }
    VZ.stats.live = D.length; return D.length;
  }
  function visorBuild() {
    const cv = VZ.cv = document.createElement('canvas'); cv.width = VZ.W; cv.height = VZ.H; const g = VZ.g = cv.getContext('2d'); g.fillStyle = 'rgb(128,128,0)'; g.fillRect(0, 0, VZ.W, VZ.H);
    const S = 48, sp = VZ.spr = document.createElement('canvas'); sp.width = sp.height = S; const sg = sp.getContext('2d'), im = sg.createImageData(S, S), p = im.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const u = (x + .5) / S * 2 - 1, v = (y + .5) / S * 2 - 1, d = Math.hypot(u, v), a = d >= 1 ? 0 : Math.min(1, (1 - d) / .14), f = .5 + .5 * d * d, j = (y * S + x) * 4;
      p[j] = 128 + 127 * Math.max(-1, Math.min(1, u * f)); p[j + 1] = 128 + 127 * Math.max(-1, Math.min(1, -v * f)); p[j + 2] = 255 * a; p[j + 3] = 255 * a; }
    sg.putImageData(im, 0, 0);
    VZ.tex = new T.CanvasTexture(cv); VZ.tex.minFilter = VZ.tex.magFilter = T.LinearFilter; VZ.tex.generateMipmaps = false;
  }
  function visorDraw(dt) {
    const g = VZ.g, W = VZ.W, H = VZ.H, wind = Math.max(0, Math.min(1.6, (VZ.speed - 2.5) / 11));
    g.globalAlpha = Math.max(.035, 1 - Math.exp(-dt * (1.3 + 7 * VZ.wipe + 1.6 * wind))); g.fillStyle = 'rgb(128,128,0)'; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    for (const d of VZ.drops) { const r = d.r * H * (d.life < 1 ? .5 + .5 * Math.max(0, d.life) : 1), v = Math.hypot(d.vx, d.vy), px = d.x * W, py = d.y * H;
      if (v > .06) { const sx = -d.vx / v * r * .9, sy = -d.vy / v * r * .9; g.globalAlpha = .55; g.drawImage(VZ.spr, px + sx - r * .7, py + sy - r * .7, r * 1.4, r * 1.4); g.globalAlpha = 1; }   /* a running drop is a teardrop: a smaller lens trails it */
      g.drawImage(VZ.spr, px - r, py - r, r * 2, r * 2); }
    VZ.tex.needsUpdate = true;
  }
  function visorStep(dt, camera, rider, scr) {
    const env = GT.env || {}, u = M.grade.uniforms; let rain = 0, want = false;
    if (VZ.allow) { if (VZ.force !== null) { rain = VZ.force; want = rain > 0; } else if (rider || scr) { rain = env.raining ? 1 : (+env.wet || 0) > .5 ? .8 : 0; want = rain > 0; } }
    const e = camera.matrixWorld.elements, yaw = Math.atan2(-e[8], -e[10]); let yr = 0; if (VZ.yaw !== null && dt > 0) { let dy = yaw - VZ.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); yr = dy / dt; } VZ.yaw = yaw; VZ.rate += (yr - VZ.rate) * Math.min(1, dt * 12);
    if (rider && rider.ent && rider.ent.h !== undefined) { /* the head turning inside the helmet is what wipes: take the bike's own turn out */ if (VZ.bh !== undefined && dt > 0) { let db = rider.ent.h - VZ.bh; db = Math.atan2(Math.sin(db), Math.cos(db)); VZ.brate = (VZ.brate || 0) + (db / dt - (VZ.brate || 0)) * Math.min(1, dt * 12); } VZ.bh = rider.ent.h; } else { VZ.bh = undefined; VZ.brate = 0; }
    VZ.speed = rider ? +rider.speed || 0 : scr ? Math.abs(+scr.speed || 0) : 0; VZ.rain = want ? rain : 0;
    if (rider || scr || VZ.force !== null) u.uVisorZ.value = scr && !rider ? 1.5 : 0;
    { /* windscreen wipers: up in .5 s, back in .5 s, a short rest. VZ.wiper (0 parked .. 1 top of the sweep) is read by js/cockpit.js to move the arms */ const wOn = !!scr && want; if (wOn || VZ.wt > 0) { VZ.wt = (VZ.wt || 0) + dt; const ph = VZ.wt % 1.5; if (!wOn && ph < dt * 1.5) VZ.wt = 0; const e = ph < .5 ? ph / .5 : ph < 1 ? 1 - (ph - .5) / .5 : 0; VZ.wiper = VZ.wt > 0 ? e * e * (3 - 2 * e) : 0; } else VZ.wiper = 0; }
    VZ.on += ((want ? 1 : 0) - VZ.on) * Math.min(1, dt * (want ? 3 : 1.2)); if (!want && VZ.on < .01) VZ.on = 0;
    if (VZ.on <= 0 && !VZ.drops.length) { u.uVisor.value = 0; return; }
    if (!VZ.cv) { try { visorBuild(); } catch (err) { VZ.allow = false; u.uVisor.value = 0; console.warn('GT.render visor', err); return; } }
    VZ.upT += dt; const stepT = 1 / (lvl.visorHz || 60);
    if (VZ.upT >= stepT * .9) { const st = Math.min(VZ.upT, .1); VZ.upT = 0; visorSim(st, { rain: VZ.rain, speed: VZ.speed, yawRate: scr && !rider ? 0 : VZ.rate - (VZ.brate || 0), max: lvl.drops || 150, wiper: scr && !rider ? VZ.wiper : undefined }); visorDraw(st); }
    u.tVisor.value = VZ.tex; u.uVisor.value = VZ.on;
  }
  /* The wet-ground reflections read "how wet" from the alpha of the HDR scene target. Ordinary transparent materials would overwrite that alpha, so they are switched (once each, found by a slow
     periodic walk) to the same colour blend with the alpha left alone. Nothing on screen changes: the canvas has no alpha and no other pass reads it. userData.gtReflect marks the puddle decals that set it on purpose. */
  function keepAlpha(m) {
    if (!m || m._gtA || !m.transparent) return; m._gtA = 1; if (m.userData && m.userData.gtReflect) return; const pm = !!m.premultipliedAlpha;
    if (m.blending === T.NormalBlending) { m.blending = T.CustomBlending; m.blendEquation = T.AddEquation; m.blendSrc = pm ? T.OneFactor : T.SrcAlphaFactor; m.blendDst = T.OneMinusSrcAlphaFactor; m.blendSrcAlpha = T.ZeroFactor; m.blendDstAlpha = T.OneFactor; ssr.patched++; }
    else if (m.blending === T.AdditiveBlending) { m.blending = T.CustomBlending; m.blendEquation = T.AddEquation; m.blendSrc = pm ? T.OneFactor : T.SrcAlphaFactor; m.blendDst = T.OneFactor; m.blendSrcAlpha = T.ZeroFactor; m.blendDstAlpha = T.OneFactor; ssr.patched++; }
    else if (m.blending === T.CustomBlending && (m.blendSrcAlpha === null || m.blendSrcAlpha === undefined)) { m.blendSrcAlpha = T.ZeroFactor; m.blendDstAlpha = T.OneFactor; ssr.patched++; }
  }
  /* Texture warm-up. A texture is only sent to the GPU the first time something that uses it is drawn, so a camera cut, a spawn or a turned corner paid for a batch of uploads in one frame (40-120 ms hitches at the film's cuts).
     The scene is walked every few seconds (hidden objects too) and what has not been uploaded yet goes up a little at a time, at most ~2.5 ms per frame. ?warm=0 switches it off. */
  const warm = { on: true, q: [], seen: new WeakSet(), mats: new WeakSet(), walkT: 1.5, done: 0 };
  const WARMK = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'lightMap', 'clearcoatNormalMap'];
  function warmTex(t) { if (!t || !t.isTexture || t.isCubeTexture || t.isCompressedTexture || t.isVideoTexture || t.isDepthTexture || warm.seen.has(t)) return; warm.seen.add(t); const im = t.image; if (!im || !(im.width > 0) || t.version === 0) return; warm.q.push(t); }
  function warmMat(m) { if (!m || warm.mats.has(m)) return; warm.mats.add(m); for (const k of WARMK) warmTex(m[k]); const u = m.uniforms; if (u) for (const k in u) { const v = u[k] && u[k].value; if (v && v.isTexture) warmTex(v); } }
  function warmStep(scene, dt) {
    if (!warm.on) return; if ((warm.walkT -= dt) <= 0) { warm.walkT = 3; scene.traverse(o => { const m = o.material; if (!m) return; if (Array.isArray(m)) { for (const k of m) warmMat(k); } else warmMat(m); }); }
    if (!warm.q.length) return; const t0 = performance.now();
    while (warm.q.length && performance.now() - t0 < 2.5) { const t = warm.q.pop(); try { const p = renderer.properties.get(t); if (!p.__webglInit && t.image && t.image.width > 0) { renderer.initTexture(t); warm.done++; } } catch (e) { warm.on = false; console.warn('GT.render warm', e); } }
  }
  function keepAlphaWalk(scene) { scene.traverse(o => { const m = o.material; if (!m) return; if (Array.isArray(m)) { for (const k of m) keepAlpha(k); } else keepAlpha(m); }); }

  /* b5 — 霓虹江城 rule 7, toned down. js/hero.js gives every body material (the hero and every NPC built from his parts) a fresnel rim through one shared vec4 uniform uGtRim (rgb = rim colour, a = reflective tape).
     At its night strength it drew a cyan line round the whole silhouette: the garage keeper read as a ghost and the first-person sleeve went bright cyan. The uniform is found once through a compiled body material
     and its colour is set here, last thing before the draw: a trace of warm by day, a faint cool edge at night. The tape term (a) is left alone. GT.render.rim.k scales it (0 = no rim). */
  const rimFix = R.rim = { u: null, t: 0, k: 1 };
  function rimStep(scene, dt) { if (!rimFix.u) { rimFix.t -= dt; if (rimFix.t > 0 || !renderer || !renderer.properties) return; rimFix.t = 1.5;
      scene.traverse(o => { if (rimFix.u || !o.isSkinnedMesh || !o.material) return; for (const m of [].concat(o.material)) { const pr = renderer.properties.get(m), u = pr && pr.uniforms && pr.uniforms.uGtRim; if (u && u.value && u.value.isVector4) { rimFix.u = u; break; } } }); if (!rimFix.u) return; }
    const n = (GT.env && GT.env.night) || 0, v = rimFix.u.value, k = rimFix.k; v.x = (.05 - .038 * n) * k; v.y = (.034 - .004 * n) * k; v.z = (.02 + .018 * n) * k; }
  // Keep one set of world matrices for the main view, mirrors and probe faces.
  // Specialized nodes (skinned meshes, cameras, etc.) retain their Three.js update.
  function updateVisibleMatrices(node) {
    if (!node.visible && node.isGroup) return;
    if (node.updateMatrixWorld !== T.Object3D.prototype.updateMatrixWorld) {
      node.updateMatrixWorld(true); return;
    }
    node.updateWorldMatrix(false,false);
    node.matrixWorldNeedsUpdate=false;
    if(node.userData.staticRenderTree){
      const previous=node.userData.lastRenderMatrix;
      if(previous && previous.equals(node.matrixWorld))return;
      if(previous)previous.copy(node.matrixWorld);
      else node.userData.lastRenderMatrix=node.matrixWorld.clone();
    }
    for (const child of node.children) updateVisibleMatrices(child);
  }
  function frame(scene, camera, dt) {
    if (!scene.autoUpdate) return drawFrame(scene,camera,dt);
    updateVisibleMatrices(scene);
    scene.autoUpdate=false;
    try { return drawFrame(scene,camera,dt); } finally { scene.autoUpdate=true; }
  }
  function drawFrame(scene, camera, dt) {
    if (!renderer) return;
    { const cv = renderer.domElement; if (cv.clientWidth !== lastCW || cv.clientHeight !== lastCH || (window.devicePixelRatio || 1) !== lastDpr || (ok && !RT.scene)) resize(); }
    dt = dt > 0 ? Math.min(dt, .1) : .016; time = (time + dt) % 600; info.passes = 0; renderer.info.reset(); if (ok) { gPoll(); gBegin('pre'); }
    { const e = GT.env, k = e && e.envK > 0 ? e.envK : 1; GTIBL[0] = k; GTIBL[1] = 1 / k; GTIBL[3] = 1; const sc = e && e.skyColor, gc = e && e.groundColor; if (sc) { GTSKY[0] = sc.r * k; GTSKY[1] = sc.g * k; GTSKY[2] = sc.b * k; } if (gc) { GTGND[0] = gc.r; GTGND[1] = gc.g; GTGND[2] = gc.b; } }
    if (scene !== lastScene) { lastScene = scene; setQuality(R.quality); }   // first frame: apply the level's shadow size / light budget
    govern();
    const sm = renderer.shadowMap, au = sm.autoUpdate;
    if (au) { sm.autoUpdate = false; sm.needsUpdate = frameNo++ % Math.max(3,lvl.shadowEvery || 1) === 0; }           // shadows once per frame (or every n-th on low quality), shared by mirror + main view
    if (ok && fx.enabled) csmStep(scene, dt); else GTSHD[0] = 0;
    renderer.autoClear = true;
    rimStep(scene, dt);
    const rider = riderFp(); autoMirror(rider); const screenP = rider ? null : carFp();
    { const mon = mirror.enabled && !mirror.off; if (mon && (!mirror.was || mirror.n % (lvl.mirEvery || 1) === 0)) renderMirror(scene); mirror.n = mon ? mirror.n + 1 : 0; mirror.was = mon; MIRU.gtRearK.value = mon ? 1 : 0; }
    const ssrOn = ok && fx.enabled && ssr.on && lvl.ssr > 0; if (ok && renderer.initTexture) warmStep(scene, dt);
    if (ssrOn && (ssr.patchT -= dt) <= 0) { ssr.patchT = ssr.patched ? 2.5 : .5; keepAlphaWalk(scene); }
    if (!ok || !fx.enabled) { renderer.setRenderTarget(null); if (ok) { renderer.toneMapping = T.ACESFilmicToneMapping; renderer.outputEncoding = T.sRGBEncoding; } renderer.render(scene, camera); if (ok) { renderer.toneMapping = T.NoToneMapping; renderer.outputEncoding = T.LinearEncoding; } sm.autoUpdate = au; reset = true; havePrev = false; gEnd(); return; }

    /* 1 — scene */
    gBegin('scene'); renderer.setRenderTarget(RT.scene); renderer.clear(); renderer.render(scene, camera);
    sm.autoUpdate = au;
    gBegin('probe'); if (!PROBE.ready || frameNo % 2 === 0) probeStep(scene, camera, PROBE.ready ? dt*2 : dt); gBegin('post'); renderer.autoClear = false;   /* LT: after the main view (fresh matrices, the shadow maps are already drawn for this frame) */

    /* camera-derived uniforms (matrices are fresh after the scene render) */
    const pe = camera.projectionMatrix.elements, env = GT.env || {}, night = env.night || 0;
    const proj = M.ao.uniforms.uProj.value.set(camera.near, camera.far, 1 / pe[0], 1 / pe[5]);
    for (const k of ['aoBlur', 'shaftMask', 'comp', 'mblur', 'debug', 'grade']) { M[k].uniforms.uProj.value.copy(proj); M[k].uniforms.tDepth.value = RT.depth; }
    M.ao.uniforms.tDepth.value = RT.depth;
    camRot.setFromMatrix4(camera.matrixWorld);
    curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const camPos = V.a.setFromMatrixPosition(camera.matrixWorld);
    const sunDir = env.sunDir || V.b.set(-.8, .3, .2).normalize();
    const skyZ = Math.min(fx.skyDepth, camera.far * .92);
    const expRead = RT.expA, expWrite = RT.expB;
    const hw = RT.aoA.width, hh = RT.aoA.height;

    /* 2 — ambient occlusion */
    const aoOn = !!fx.ao && fx.aoStrength > 0;
    if (aoOn) {
      const u = M.ao.uniforms; u.uRes.value.set(W, H); u.uRadius.value = fx.aoRadius; u.uProjScale.value = .5 * H * pe[5]; u.uIntensity.value = fx.aoIntensity || 5.0;
      pass(M.ao, RT.aoA);
      const b = M.aoBlur.uniforms; b.uRes.value.set(W, H); b.tAO.value = RT.aoA.texture; b.uDir.value.set(1 / hw, 0); pass(M.aoBlur, RT.aoB);
      b.tAO.value = RT.aoB.texture; b.uDir.value.set(0, 1 / hh); pass(M.aoBlur, RT.aoA);
    }

    /* 3 — light shafts toward the sun */
    const sv = V.b.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    const sunUp = sstep(sunDir.y, -.1, .03) * (1 - night), sunCol = env.sunColor || V.c.setRGB(1, .75, .5), sm_ = Math.max(sunCol.r, sunCol.g, sunCol.b, 1e-3);
    let shaftK = 0;
    if (fx.vol > 0 && sunUp > .01 && sv.z < -.02) {
      const nx = sv.x * pe[0] / -sv.z, ny = sv.y * pe[5] / -sv.z;
      shaftK = sstep(-sv.z, .02, .3) * (1 - sstep(Math.max(Math.abs(nx), Math.abs(ny)), 1.1, 2.4)) * sunUp;
      if (shaftK > .003) {
        const u = M.shaftMask.uniforms; u.tScene.value = RT.scene.texture; u.tExpo.value = expRead.texture; u.uSunDir.value.copy(sunDir); u.uSkyZ.value = skyZ; pass(M.shaftMask, RT.shA);
        const r = M.radial.uniforms; r.uSun.value.set(nx * .5 + .5, ny * .5 + .5);
        r.tSrc.value = RT.shA.texture; r.uLen.value = 1; r.uDecay.value = .78; pass(M.radial, RT.shB);
        r.tSrc.value = RT.shB.texture; r.uLen.value = 1 / 8; r.uDecay.value = .95; pass(M.radial, RT.shA);
        r.tSrc.value = RT.shA.texture; r.uLen.value = 1 / 64; r.uDecay.value = 1; pass(M.radial, RT.shB);
      } else shaftK = 0;
    }

    /* composite: AO + haze + shafts */
    {
      const u = M.comp.uniforms; u.tScene.value = RT.scene.texture; u.tAO.value = aoOn ? RT.aoA.texture : black; u.tShaft.value = shaftK > 0 ? RT.shB.texture : black; u.tExpo.value = expRead.texture;
      u.uHalfRes.value.set(hw, hh); u.uSunDir.value.copy(sunDir); u.uCamY.value = camPos.y; u.uAOOn.value = aoOn ? 1 : 0; u.uAOStr.value = fx.aoStrength; u.uShaft.value = shaftK * fx.vol * .4 * (fx.sunny ? (.5 + .5 * Math.min(1, Math.max(0, ((env.sunElev || 0) - 8) / 24))) * fx.shaftLow : 1);   /* g6 r4: looking into a low sun the shafts were the white blob that hid the skyline */ u.uSkyZ.value = skyZ;
      const hasFog = !!scene.fog, hz = env.hazeColor || env.fogColor || (scene.fog && scene.fog.color) || null;
      u.uHazeSun.value.set(sunCol.r / sm_, sunCol.g / sm_, sunCol.b / sm_).multiplyScalar(.17 * sunUp * fx.vol * (fx.sunny ? .03 + .97 * Math.min(1, Math.max(0, ((env.sunElev || 0) - 8) / 26)) : 1));   /* g6 r2: a low sun no longer floods the frame with a peach-white haze blob */
      if (hz && !hasFog) { const m = Math.max(hz.r, hz.g, hz.b, 1e-3); u.uHazeAmb.value.set(hz.r / m, hz.g / m, hz.b / m).multiplyScalar(.07 * (1 - .8 * night) * fx.vol); }
      else if (!hasFog) u.uHazeAmb.value.set(.62, .7, .86).multiplyScalar(.07 * (1 - .8 * night) * fx.vol); else u.uHazeAmb.value.set(0, 0, 0);
      u.uDensity.value = fx.vol > 0 ? .0019 * (env.haze !== undefined ? env.haze : 1) * (fx.sunny && night < .5 ? .3 + .7 * Math.min(1, Math.max(0, ((env.sunElev || 0) - 8) / 24)) : 1) : 0; u.uHFall.value = .016; u.uExt.value = hasFog ? .5 : .55;
      const airOn = hasFog && env.fogColor && env.fogSunColor && env.fogOppColor; u.uAirK.value = airOn ? 1 : 0; if (!airOn && hasFog) u.uExt.value = 0;
      if (airOn) { u.uAirC.value.set(env.fogColor.r, env.fogColor.g, env.fogColor.b); u.uAirSunC.value.set(env.fogSunColor.r, env.fogSunColor.g, env.fogSunColor.b); u.uAirOppC.value.set(env.fogOppColor.r, env.fogOppColor.g, env.fogOppColor.b); const td = env.trueSunDir || sunDir; u.uAirDir.value.set(td.x, 0, td.z).normalize(); }
      u.tPrev.value = RT.half.texture; u.uSsr.value = ssrOn && !reset ? lvl.ssr : 0; u.uSsrG.value = Math.pow(260, 1 / Math.max(4, lvl.ssr || 12)); u.uSsrK.value = ssr.k;   /* the march always reaches ~50 m: fewer steps = longer steps */
      pass(M.comp, RT.comp);
    }
    let hdr = RT.comp;

    /* 5 — camera motion blur */
    if (fx.mblur > 0 && lvl.mblur && havePrev) {
      let diff = 0; const a = curVP.elements, b = prevVP.elements; for (let i = 0; i < 16; i++) diff += Math.abs(a[i] - b[i]);
      if (diff > 2e-4 && camPos.distanceTo(prevPos) < 12) {
        reproj.multiplyMatrices(prevVP, camera.matrixWorld);
        const u = M.mblur.uniforms; u.tScene.value = hdr.texture; u.uAmt.value = .55 * fx.mblur * Math.min(1.5, Math.max(.4, (1 / 60) / dt));   /* ~half-frame shutter, shorter trails when the frame rate drops */ u.uMax.value = .028 * Math.min(2, fx.mblur); u.uNear.value = fx.mblurNear; u.uRes.value.set(W, H);
        pass(M.mblur, RT.mb); hdr = RT.mb;
      }
    }
    prevVP.copy(curVP); prevPos.copy(camPos); havePrev = true;

    /* 4/6 — bloom base (+mips), exposure, pyramid, streak */
    { const u = M.half.uniforms; u.tSrc.value = hdr.texture; u.uTexel.value.set(1 / W, 1 / H); pass(M.half, RT.half); }
    { const u = M.meter.uniforms; u.tSrc.value = RT.half.texture; u.tPrev.value = expRead.texture; u.uLod.value = Math.max(0, Math.floor(Math.log2(Math.min(hw / 16, hh / 12))));
      u.uKey.value = fx.exposureKey * (1 - fx.nightDim * night) * (fx.sunny && night < .5 ? 1 - fx.lowSunDim + fx.lowSunDim * Math.min(1, Math.max(0, ((env.sunElev || 0) - 2) / 20)) : 1);   /* ct2: lowSunDim (was a fixed .5) */   /* g6 r3: against a low sun the ground is exposed darker, the sky and the sun's path stay bright */ u.uMin.value = fx.exposureMin; u.uMax.value = fx.exposureMax + (Math.min(fx.exposureMax, fx.nightMax) - fx.exposureMax) * night * fx.look; u.uDt.value = dt; u.uReset.value = reset ? 1 : 0; u.uAuto.value = fx.autoExposure ? 1 : 0; u.uManual.value = fx.exposure;
      pass(M.meter, expWrite); RT.expA = expWrite; RT.expB = expRead; reset = false; }
    const expo = RT.expA.texture, streakOn = fx.streak > 0 && !!lvl.streak, bloomOn = fx.bloom > 0 || streakOn;
    if (bloomOn) {
      const D = RT.down, U = RT.up, br = M.bright.uniforms; br.tSrc.value = RT.half.texture; br.tExpo.value = expo; br.uTexel.value.set(1 / hw, 1 / hh); const bthr = fx.bloomThreshold * (1.22 - .62 * night);   /* day: only the sun, glints and lamps bloom. night: neon, signs and lit windows glow */ br.uThr.value = bthr; br.uKnee.value = bthr * .5;
      pass(M.bright, D[0]);
      const dn = M.down.uniforms; for (let i = 1; i < D.length; i++) { dn.tSrc.value = D[i - 1].texture; dn.uTexel.value.set(1 / D[i - 1].width, 1 / D[i - 1].height); pass(M.down, D[i]); }
      const up = M.up.uniforms, wts = [1.5, 1.1, .9, .8 * (1 + .6 * night), .7 * (1 + .9 * night)]; let src = D[D.length - 1];   /* LT: at night the widest levels weigh more: lamps and neon get a soft halo in the damp air */
      for (let i = D.length - 2; i >= 0; i--) { up.tSrc.value = src.texture; up.tAdd.value = D[i].texture; up.uTexel.value.set(1 / src.width, 1 / src.height); up.uW.value = wts[i]; up.uSpread.value = 1; pass(M.up, U[i]); src = U[i]; }
      if (streakOn) { const s = M.streak.uniforms, tw = 1 / RT.stA.width; s.tExpo.value = expo;
        s.tSrc.value = D[0].texture; s.uFirst.value = 1; s.uStep.value.set(tw * 1.0, 0); pass(M.streak, RT.stA);
        s.tSrc.value = RT.stA.texture; s.uFirst.value = 0; s.uStep.value.set(tw * 3.5, 0); pass(M.streak, RT.stB);
        s.tSrc.value = RT.stB.texture; s.uStep.value.set(tw * 11, 0); pass(M.streak, RT.stA); }
    }

    /* 7 — grade + output */
    { const u = M.grade.uniforms; u.tScene.value = hdr.texture; u.tBloom.value = bloomOn && fx.bloom > 0 ? RT.up[0].texture : black; u.tStreak.value = streakOn ? RT.stA.texture : black; u.tExpo.value = expo;
      u.uBloomTexel.value.set(1 / RT.up[0].width, 1 / RT.up[0].height); u.uBloom.value = fx.bloom * (.26 + .2 * night) * (fx.sunny && night < .5 ? .5 + .5 * Math.min(1, Math.max(0, ((env.sunElev || 0) - 2) / 16)) : 1);   /* neon, lamps and windows glow a little wider once it is dark */ u.uStreak.value = fx.streak * (.42 - .2 * night); u.uDirt.value = fx.dirt * .6; { const ln = lvl.lens === undefined ? 1 : lvl.lens; u.uCA.value = fx.ca * ln * (1 + .35 * fx.look); u.uVig.value = fx.vignette * ln * (1 + .2 * fx.look); R.lensK = ln; } u.uLk.value = fx.look; u.uNt.value = night; u.uSy.value = fx.sunny; { const gold = 1 - sstep(env.sunElev || 0, 12, 17.5); u.uWarm.value = fx.warm + (1 - fx.warm) * Math.max(gold, night); } { const lo_ = 1 - Math.min(1, Math.max(0, ((env.sunElev || 0) - 2) / 16)); u.uWp.value = fx.photoWhite + .06 * lo_ + .03 * (env.morn || 0); u.uBp.value = .035 * lo_ + .012 * (env.morn || 0); }   /* low sun: the sky and the sun's path on the ground reach white while the ground is exposed darker */ u.uSc.value = fx.photoCurve; u.uSa.value = fx.photoSat * (1 - .16 * (env.morn || 0)) * (1 + .07 * (1 - Math.min(1, Math.max(0, ((env.sunElev || 0) - 2) / 16))) * (1 - (env.morn || 0))); u.uSh.value = fx.photoSatHi;
      visorStep(dt, camera, rider, screenP);
      u.uFocus.value = GT.clamp ? GT.clamp(fx.focus, 0, 1) : fx.focus; u.uBias.value = Math.pow(2, fx.exposureBias); u.uAspect.value = W / H; u.uGrade.value = fx.grade; u.uTime.value = time;
      pass(M.grade, RT.ldr); }
    if (fx.debug) {
      const map = { ao: [RT.aoA, 0, 1], depth: [RT.aoA, 1, 1], bloom: [RT.up[0], 2, 1], shafts: [RT.shB, 2, 2], streak: [RT.stA, 2, 2], scene: [RT.scene, 2, 1], mirror: [RT.mirrorOut, 2, 1] }[fx.debug] || [RT.aoA, 0, 1];
      const u = M.debug.uniforms; u.tSrc.value = map[0].texture; u.uMode.value = map[1]; u.uScale.value = map[2]; pass(M.debug, null);
    } else { const u = M.out.uniforms; u.tSrc.value = RT.ldr.texture; u.uTexel.value.set(1 / W, 1 / H); u.uFxaa.value = fx.fxaa ? 1 : 0; u.uSharp.value = fx.sharpen; u.uGrain.value = fx.grain * (lvl.lens === undefined ? 1 : lvl.lens) * (1 + .3 * fx.look); u.uTime.value = time; if (!window.nativeNR.draw(renderer, mk, HEAD, pass, M.out, RT.depth, camera, W, H)) pass(M.out, null); }
    renderer.setRenderTarget(null); renderer.autoClear = true; gEnd();
  }
  function sstep(x, a, b) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  /* ------------------------------------------------------------------ showcase: a deliberately awkward test scene for every pass
     extra query params: rfx=ao:0,bloom:2   dbg=ao|depth|bloom|shafts|streak|scene|mirror   spin=1|2 (orbit / strafe -> motion blur)   mir=1   msaa=0   night=1 (stand-in night when atmos is absent)   dbgx=1   perf=1 */
  GT.showcase = GT.showcase || {};
  GT.showcase.render = function ({ scene, camera }) {
    const Q = new URLSearchParams(location.search), k = GT.kit();
    if (Q.get('rfx')) for (const kv of Q.get('rfx').split(',')) { const [a, b] = kv.split(':'); fx[a] = b === 'true' ? true : b === 'false' ? false : +b; }
    if (Q.get('dbg')) fx.debug = Q.get('dbg');
    if (Q.get('msaa') !== null && renderer) { wantMsaa = lvl.msaa = +Q.get('msaa'); gov.on = false; W = -1; resize(); }
    const err = document.getElementById('err'); if (err && !console._gt) { console._gt = 1; const ce = console.error; console.error = function () { err.textContent += 'console.error ' + Array.from(arguments).join(' ').slice(0, 600) + '\n'; ce.apply(console, arguments); }; }
    // ground + wall with a recessed doorway
    k.box('concrete', 44, .3, 44, 0, -.15, 0);
    k.box('concrete_stained', 14.4, .14, .7, 0, .07, -4.55, { bevel: .02 });
    k.box('stucco_cream', 3.95, 3.4, .4, -5.025, 1.7, -5, { bevel: .012 }); k.box('stucco_cream', 8.95, 3.4, .4, 2.525, 1.7, -5, { bevel: .012 }); k.box('stucco_cream', 1.1, 1.15, .4, -2.5, 2.825, -5, { bevel: .012 });
    k.box('concrete', 14.3, .09, .52, 0, 3.445, -5, { bevel: .015 });
    k.box('stucco_cream', 1.5, 2.4, .1, -2.5, 1.2, -5.5); k.box('stucco_cream', .1, 2.3, .5, -3.1, 1.15, -5.3); k.box('stucco_cream', .1, 2.3, .5, -1.9, 1.15, -5.3);
    k.box('wood_painted', .96, 2.1, .05, -2.5, 1.19, -5.4, { bevel: .008 }); k.box('wood_painted', .7, .75, .02, -2.5, 1.72, -5.37, { bevel: .006 }); k.box('wood_painted', .7, .75, .02, -2.5, .72, -5.37, { bevel: .006 });
    k.box('metal_dark', .06, 2.2, .1, -3.02, 1.24, -5.38, { bevel: .006 }); k.box('metal_dark', .06, 2.2, .1, -1.98, 1.24, -5.38, { bevel: .006 }); k.box('metal_dark', 1.1, .06, .1, -2.5, 2.3, -5.38, { bevel: .006 });
    k.box('concrete_stained', 1.3, .14, .5, -2.5, .21, -5.1, { bevel: .015 });
    k.cyl('chrome', .018, .018, .12, -2.12, 1.15, -5.33, { rx: Math.PI / 2 }); k.sphere('chrome', .032, -2.12, 1.15, -5.27);
    // conduit, junction box, brackets
    k.tube('metal_galv', [[-6.9, 2.75, -4.77], [-1.2, 2.75, -4.77], [-1.05, 2.72, -4.77], [-1, 2.6, -4.77], [-1, .3, -4.77]], .018, { steps: 60, tension: .1 });
    for (let x = -6.5; x < -1.2; x += 1.3) k.box('metal_galv', .05, .025, .03, x, 2.75, -4.785, { bevel: .004 });
    k.box('metal_galv', .22, .28, .09, -1, 1.5, -4.755, { bevel: .01 }); k.box('metal_dark', .16, .2, .012, -1, 1.5, -4.705, { bevel: .004 });
    // HDR emissive bars
    const em = (r, g, b) => new T.MeshBasicMaterial({ color: new T.Color(r, g, b) });
    const bars = [[em(7, .8, 3), 2.95], [em(.5, 4.2, 6.5), 2.62], [em(9, 3.4, .5), 2.29]];
    k.box('plastic_black', 4.5, 1.05, .05, 3.2, 2.62, -4.775, { bevel: .01 });
    bars.forEach(([m, y], i) => { k.cyl(m, .022, .022, 3.9 - i * .5, 3.2 - i * .25, y, -4.71, { rz: Math.PI / 2, seg: 10 }); for (const sx of [-1, 0, 1]) k.box('metal_dark', .03, .06, .05, 3.2 - i * .25 + sx * (1.7 - i * .25), y, -4.735, { bevel: .004 }); });
    k.cyl(em(14, 12.5, 10), .03, .03, 1.2, 6.2, .035, -1.2, { rz: Math.PI / 2, rx: .5, seg: 10 }); k.box('metal_dark', .09, .03, .09, 5.68, .02, -1.0, { bevel: .004 }); k.box('metal_dark', .09, .03, .09, 6.72, .02, -1.4, { bevel: .004 });
    // stacked props, all in contact
    k.box('metal_painted_blue', 1.2, 1.2, 1.2, 2, .6, -2.2, { bevel: .03, ry: .2 }); k.box('wood_plank', .8, .7, .8, 2.05, 1.55, -2.25, { bevel: .02, ry: -.25 }); k.box('metal_painted_yellow', .7, .7, .7, 3.05, .35, -1.5, { bevel: .025, ry: .5 });
    k.box('wood_plank', .6, .12, .9, .95, .06, -2.0, { bevel: .01, ry: .1 }); k.box('wood_plank', .6, .12, .9, .97, .18, -2.02, { bevel: .01, ry: .18 }); k.box('wood_plank', 2.6, .04, .18, .4, 1.02, -4.52, { bevel: .006, rx: -.25, rz: 1.12 });
    k.cyl('metal_painted_red', .3, .3, .9, 4.3, .45, -2.4, { seg: 32 }); k.cyl('metal_dark', .31, .31, .03, 4.3, .88, -2.4, { seg: 32 }); k.cyl('metal_dark', .31, .31, .03, 4.3, .3, -2.4, { seg: 32 }); k.cyl('metal_dark', .31, .31, .03, 4.3, .6, -2.4, { seg: 32 });
    k.cyl('metal_rust', .3, .3, .9, 4.88, .45, -2.75, { seg: 32 }); k.cyl('metal_painted_white', .3, .3, .9, 4.7, .3, -1.55, { seg: 32, rz: Math.PI / 2, ry: .6 });
    k.cyl('concrete', .5, .56, .5, -.2, .25, -1.6, { seg: 40 }); k.sphere('chrome', .5, -.2, 1.0, -1.6, { seg: 48, seg2: 32 }); k.sphere('plastic_white', .16, .55, .16, -1.1, { seg: 24, seg2: 16 }); k.sphere('plastic_red', .11, .8, .11, -.92, { seg: 24, seg2: 16 });
    // thin railing + hanging cable (edge-quality test)
    for (let i = 0; i <= 5; i++) { const x = -6.5 + i * 1.2; k.cyl('metal_galv', .022, .022, 1.05, x, .525, 1.2, { seg: 10 }); k.box('metal_galv', .13, .012, .13, x, .006, 1.2, { bevel: .003 }); for (const [bx, bz] of [[-.045, -.045], [.045, -.045], [-.045, .045], [.045, .045]]) k.cyl('metal_dark', .008, .008, .012, x + bx, .018, 1.2 + bz, { seg: 6 }); }
    k.cyl('metal_galv', .024, .024, 6.1, -3.5, 1.05, 1.2, { rz: Math.PI / 2, seg: 10 }); k.cyl('metal_galv', .016, .016, 6.0, -3.5, .58, 1.2, { rz: Math.PI / 2, seg: 8 }); k.cyl('metal_galv', .016, .016, 6.0, -3.5, .18, 1.2, { rz: Math.PI / 2, seg: 8 });
    k.tube('rubber', [[-6.6, 3.3, -4.78], [-5.2, 2.2, -3.2], [-4.2, 1.5, -1], [-3.5, 1.08, 1.2]], .009, { steps: 50, seg: 6 }); k.tube('rubber', [[6, 3.3, -4.78], [6.4, 1.6, -3.4], [6.2, .035, -1.22]], .008, { steps: 40, seg: 6 });
    { const r = GT.rng('rskyline'); for (let i = 0; i < 26; i++) { const a = i / 26 * GT.TAU + r() * .2, d = 90 + r() * 320, w = 10 + r() * 30, h = 6 + r() * 34; k.box(i % 3 ? 'concrete_stained' : 'stucco_teal', w, h, w * (.6 + r() * .6), Math.sin(a) * d, h / 2, Math.cos(a) * d, { bevel: .05, ry: a }); } k.box('asphalt', 900, .1, 900, 0, -.2, 0); }
    k.decal('oil_stain', 2.2, 2.2, 3.4, .004, -.6); k.decal('crack', 3, 1.2, -3.5, .004, -1.5, .4);
    const grp = k.build(); scene.add(grp);
    const pl = (c, i, x, y, z) => { const l = new T.PointLight(c, i, 7, 2); l.position.set(x, y, z); scene.add(l); };
    pl(new T.Color(1, .25, .6), 1.6, 3.2, 2.9, -4.3); pl(new T.Color(.3, .8, 1), 1.2, 3, 2.3, -4.2); pl(new T.Color(1, .9, .75), 1.4, 6.2, .3, -1.1);
    const noAtmos = !(GT.atmos && GT.atmos.init) || Q.get('atmos') === '0';
    const fakeNight = noAtmos && Q.get('night') === '1';
    if (fakeNight) { GT.env.night = 1; scene.traverse(o => { if (o.isDirectionalLight) { o.intensity *= .025; o.color.setRGB(.6, .75, 1); } else if (o.isHemisphereLight) o.intensity *= .05; else if (o.isPointLight) o.intensity *= 2; }); }
    if (noAtmos) {   // stand-ins for the atmosphere module: HDR sun disc, gradient sky, a small PMREM so chrome has something to reflect
      const sd = (GT.env && GT.env.sunDir) || new T.Vector3(-.8, .3, .2).normalize();
      const sky = new T.Mesh(new T.SphereGeometry(2600, 32, 16), new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false, uniforms: { s: { value: sd.clone() }, ni: { value: fakeNight ? 1 : 0 } },
        vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'varying vec3 d; uniform vec3 s; uniform float ni; void main(){ vec3 n = normalize(d); float h = max(n.y, 0.0); float mu = max(dot(n, s), 0.0); vec3 c = mix(vec3(1.25,0.82,0.55), vec3(0.20,0.34,0.62), pow(h, 0.45)); c = mix(c, vec3(0.9,0.62,0.45), smoothstep(0.0,-0.25,n.y)); c += vec3(1.6,0.75,0.3)*pow(mu, 6.0) + vec3(5.0,2.6,1.0)*pow(mu, 60.0) + vec3(90.0,60.0,28.0)*smoothstep(0.99985, 0.99996, mu); c = mix(c, vec3(0.010,0.016,0.034)*(1.0+1.5*(1.0-h)) + vec3(0.05,0.02,0.035)*pow(1.0-h, 6.0), ni); gl_FragColor = vec4(c, 1.0);\n#include <encodings_fragment>\n }' }));
      sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky); scene.background = null;
      if (renderer && !scene.environment) { try { const es = new T.Scene(); es.add(sky.clone()); const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, 0, 1, 4000).texture; pm.dispose(); } catch (e) { console.warn(e); } }
    }
    if (Q.get('mir') === '1' && renderer) { mirror.enabled = true; const mq = new T.Mesh(new T.PlaneGeometry(1.6, .5), new T.MeshBasicMaterial({ map: mirror.texture })); mq.position.set(-4.6, 2.2, -4.78); scene.add(mq);
      mirror.camera.position.set(-4.6, 2.2, -4.7); mirror.camera.lookAt(-2, 1, 6); }
    const spin = Q.get('spin') === '1'; let tt = 0;
    let fr = 0; const dbgx = Q.get('dbgx') === '1';
    return { cam: [5.6, 2.1, 6.2], look: [.6, 1.1, -2.4], hours: 18.2,
      update(dt) { if (dbgx && renderer && ++fr === 2) { try { err.textContent += 'aspect ' + camera.aspect.toFixed(4) + ' client ' + renderer.domElement.clientWidth + 'x' + renderer.domElement.clientHeight + ' inner ' + innerWidth + 'x' + innerHeight + ' ' + W + 'x' + H + ' msaa' + info.msaa + ' passes ' + info.passes + '\n'; } catch (e) { err.textContent += e; } }
        if (Q.get('perf') === '1' && renderer && fr === 6) { const gl = renderer.getContext(), px = new Uint8Array(4), run = n => { const t0 = performance.now(); for (let i = 0; i < n; i++) { R.frame(scene, camera, .016); } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / n; };
          run(5); const a = run(40); fx.enabled = false; run(5); const b = run(40); fx.enabled = true; err.textContent += 'frame with post ' + a.toFixed(2) + ' ms, plain ' + b.toFixed(2) + ' ms, post stack ~' + (a - b).toFixed(2) + ' ms @ ' + W + 'x' + H + '\n'; }
        if (Q.get('spin') === '2') { tt += dt; camera.position.set(5.6 + Math.sin(tt * 3) * 6, 2.1, 6.2); camera.rotation.set(-.12, .5, 0); } else if (spin) { tt += dt; camera.position.set(Math.sin(tt * 1.6) * 8, 2.1, Math.cos(tt * 1.6) * 8); camera.lookAt(.6, 1.1, -2.4); } } };
  };
})();
