/* humans.js — PP (2026-11-17): what turns the figures from mannequins into people, shared by js/hero.js (the lead) and js/people.js (everyone else).
   GT.humans = { patchSkin(mat), patchCloth(mat), patchHair(mat), FACES, pickFace(sp, o), bakeFace(out, face, o), fabric(out, url, rects, o), printCanvas(src, url, rects, cb), K }
   - skin: wrap diffuse with a warm scatter band at the light terminator (the red of light that went through the skin), a soft forward sheen at grazing angles, a slightly
     oilier gloss and a touch more colour in the albedo, so skin reads as skin in Florida sun instead of brown plastic.
   - cloth: a soft fibre sheen at grazing angles and no plastic highlight.
   - hair: Kajiya-Kay strand highlights along the v direction of the hair lofts (v runs along the strands in both builders).
   - faces: generated portraits of fictional people (assets/tex/people/face_*.jpg, frontal, neutral, even light) projected orthographically onto the front of the head in a skin
     atlas, aligned by the eyes and the mouth line, feathered into the painted skin round the edge. NPC atlases are neutral (vertex colour carries the tone), so the photo is
     divided by its own skin colour; the hero's atlas is painted in colour, so the photo is matched to the painted cheek colour.
   - fabrics: generated macro photos multiplied (mean-normalised) into garment atlas regions; prints are composited in colour.
   All of it degrades to nothing when a photo fails to load. */
(function () {
  'use strict';
  const T = window.THREE, GT = window.GT; if (!T || !GT) return;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t, sm = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const K = { sss: 1.0, wrap: .45, sheen: 1, gloss: .86, sat: 1.04, hairSpec: 1, clothSheen: .32, fillSkin: 1.3, fillCloth: 1.15 };
  const U = { uGtSkin: { value: new T.Vector4(K.sss, K.wrap, K.sheen, K.sat) }, uGtHair: { value: new T.Vector2(K.hairSpec, K.fillCloth) }, uGtCloth: { value: new T.Vector2(K.clothSheen, K.fillCloth) }, uGtFill: { value: K.fillSkin } };
  const sync = () => { U.uGtSkin.value.set(K.sss, K.wrap, K.sheen, K.sat); U.uGtHair.value.set(K.hairSpec, K.fillCloth); U.uGtCloth.value.set(K.clothSheen, K.fillCloth); U.uGtFill.value = K.fillSkin; };
  /* a character fill: the indirect light on skin and cloth is lifted a little, as a film lights its actors, so faces in shade keep their form */
  const fill = (sh, expr) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectDiffuse *= ' + expr + ';'); };

  /* ---------------------------------------------------------------- shader patches (chained after any onBeforeCompile the material already has) */
  const DIFF = 'reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );';
  function chain(mat, key, fn) { if (!mat || (mat.userData && mat.userData.gth)) return mat; const prev = mat.onBeforeCompile, pk = prev ? String(prev).length + ':' + String(prev).slice(-40) : '';
    mat.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); fn(sh); }; mat.customProgramCacheKey = () => 'gth-' + key + '|' + pk; mat.userData.gth = key; mat.needsUpdate = true; return mat; }
  const lightsWith = (sh, add) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', T.ShaderChunk.lights_physical_pars_fragment.replace(DIFF, add)); };
  function patchSkin(mat) { return chain(mat, 'skin', sh => { sh.uniforms.uGtSkin = U.uGtSkin; sh.uniforms.uGtFill = U.uGtFill; sh.fragmentShader = 'uniform vec4 uGtSkin;\nuniform float uGtFill;\n' + sh.fragmentShader; fill(sh, 'uGtFill');
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n { float gL = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ); diffuseColor.rgb = max( mix( vec3( gL ), diffuseColor.rgb, uGtSkin.w ), 0.0 ); }')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp( roughnessFactor * ' + K.gloss.toFixed(3) + ', 0.3, 1.0 );');
    lightsWith(sh, `{ float gNl = dot( geometry.normal, directLight.direction ); float gW = saturate( ( gNl + uGtSkin.y ) / ( 1.0 + uGtSkin.y ) ); float gS = max( gW * gW - saturate( gNl ), 0.0 );
      vec3 gIrr = ( vec3( saturate( gNl ) ) + vec3( 1.0, 0.4, 0.27 ) * gS * uGtSkin.x ) * directLight.color;
      #ifndef PHYSICALLY_CORRECT_LIGHTS
        gIrr *= PI;
      #endif
      reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * gIrr * BRDF_Diffuse_Lambert( material.diffuseColor );
      float gFv = pow( 1.0 - saturate( dot( geometry.normal, geometry.viewDir ) ), 4.0 );
      reflectedLight.directSpecular += gFv * gW * directLight.color * vec3( 0.2, 0.16, 0.13 ) * uGtSkin.z; }`); }); }
  function patchCloth(mat) { return chain(mat, 'cloth', sh => { sh.uniforms.uGtCloth = U.uGtCloth; sh.fragmentShader = 'uniform vec2 uGtCloth;\n' + sh.fragmentShader; fill(sh, 'uGtCloth.y');
    lightsWith(sh, DIFF + `\n { float gNl = dot( geometry.normal, directLight.direction ); float gFv = pow( 1.0 - saturate( dot( geometry.normal, geometry.viewDir ) ), 3.0 );
      vec3 gIrr = saturate( gNl * 0.6 + 0.4 ) * directLight.color;
      #ifndef PHYSICALLY_CORRECT_LIGHTS
        gIrr *= PI;
      #endif
      reflectedLight.directSpecular += gIrr * gFv * ( 0.04 + material.diffuseColor ) * uGtCloth.x * 0.25; }`); }); }
  function patchHair(mat) { mat.extensions = mat.extensions || {}; mat.extensions.derivatives = true;
    return chain(mat, 'hair', sh => { sh.uniforms.uGtHair = U.uGtHair; sh.fragmentShader = 'uniform vec2 uGtHair;\nvec3 gHT = vec3( 0.0, 1.0, 0.0 );\n' + sh.fragmentShader; fill(sh, 'uGtHair.y');
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef USE_UV
        { vec3 gQ0 = dFdx( -vViewPosition ), gQ1 = dFdy( -vViewPosition ); vec2 gS0 = dFdx( vUv ), gS1 = dFdy( vUv ); vec3 gT = gQ1 * gS0.x - gQ0 * gS1.x; gT -= normal * dot( gT, normal ); gHT = normalize( gT + vec3( 1e-6 ) ); }
        #endif`);
      lightsWith(sh, DIFF + `\n { vec3 gH = normalize( directLight.direction + geometry.viewDir ); float gTH = dot( gHT, gH ); float gSn = sqrt( max( 0.0, 1.0 - gTH * gTH ) );
        vec3 gH2 = normalize( gH - gHT * 0.18 ); float gTH2 = dot( gHT, gH2 ); float gSn2 = sqrt( max( 0.0, 1.0 - gTH2 * gTH2 ) ); float gNl = saturate( dot( geometry.normal, directLight.direction ) * 0.75 + 0.25 );
        reflectedLight.directSpecular += directLight.color * gNl * uGtHair.x * ( 0.16 * pow( gSn, 110.0 ) + 0.5 * pow( gSn2, 22.0 ) * ( material.diffuseColor + 0.03 ) ); }`); }); }

  /* ---------------------------------------------------------------- photographic faces
     lm = [left eye x, y, right eye x, y (as seen in the photo), mouth line y] in photo pixels; tone 0 (fair) .. 5 (deep); age 1 young, 2 middle-aged, 3 old; cn = East Asian */
  const FACES = [
    { id: 'm1', url: 'assets/tex/people/face_m1.jpg', g: 'm', age: 1, tone: 1.5, cn: 1, hero: 1, lm: [310, 330, 464, 330, 505] },
    { id: 'm2', url: 'assets/tex/people/face_m2.jpg', g: 'm', age: 1, tone: 4.6, lm: [296, 315, 470, 315, 485] },
    { id: 'm3', url: 'assets/tex/people/face_m3.jpg', g: 'm', age: 2, tone: 1.4, lm: [306, 328, 460, 328, 512] },
    { id: 'm4', url: 'assets/tex/people/face_m4.jpg', g: 'm', age: 3, tone: 2.6, lm: [306, 327, 468, 327, 508] },
    { id: 'f1', url: 'assets/tex/people/face_f1.jpg', g: 'f', age: 1, tone: 2.3, lm: [304, 343, 464, 343, 508] },
    { id: 'f2', url: 'assets/tex/people/face_f2.jpg', g: 'f', age: 1, tone: .8, lm: [312, 341, 464, 341, 504] },
    { id: 'f3', url: 'assets/tex/people/face_f3.jpg', g: 'f', age: 2, tone: 4.2, lm: [306, 360, 476, 360, 532] },
    { id: 'f4', url: 'assets/tex/people/face_f4.jpg', g: 'f', age: 3, tone: .6, lm: [308, 340, 466, 340, 505] },
    { id: 'f5', url: 'assets/tex/people/face_f5.jpg', g: 'f', age: 1, tone: 1.1, cn: 1, lm: [306, 352, 469, 352, 539] },
    { id: 'm5', url: 'assets/tex/people/face_m5.jpg', g: 'm', age: 3, tone: 1.8, cn: 1, lm: [310, 328, 464, 328, 507] },
    { id: 'f6', url: 'assets/tex/people/face_f6.jpg', g: 'f', age: 3, tone: 1.4, cn: 1, lm: [317, 355, 467, 355, 530] },
    { id: 'm6', url: 'assets/tex/people/face_m6.jpg', g: 'm', age: 1, tone: 2.2, cn: 1, lm: [311, 312, 467, 312, 487] }];
  const FBY = {}; FACES.forEach(f => { FBY[f.id] = f; });
  const hashS = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  /** tone of a hex skin colour on the 0 (fair) .. 5 (deep) scale of the NPC palette */
  const toneOf = hex => { const r = (hex >> 16 & 255) / 255, g = (hex >> 8 & 255) / 255, b = (hex & 255) / 255, l = .3 * r + .59 * g + .11 * b; return clamp((.82 - l) / .105, 0, 5.5); };
  /** a face for a spec: same sex, nearest age and tone (East Asian faces for the China-edition figures when there are any); a hash of the key picks among near ties and mirrors half */
  function pickFace(sp, o) { o = o || {}; if (!sp || (o.age === 0)) return null; const g = sp.female ? 'f' : 'm', tone = toneOf(sp.skin || 0xc48e62), age = o.age || 2, h = hashS(String(sp.key || sp.type || '') + (o.salt || ''));
    const pool = FACES.filter(f => f.g === g && !(f.hero && !o.allowHero) && !f.off); if (!pool.length) return null;
    const sc = f => Math.abs(f.tone - tone) * 1.0 + Math.abs(f.age - age) * .9 + (sp.cn ? (f.cn ? 0 : 1.6) : 0) + ((h >>> (FACES.indexOf(f) % 16)) & 3) * .22;
    pool.sort((a, b) => sc(a) - sc(b)); const f = pool[0]; return { id: f.id, mir: (h >>> 7) & 1 }; }
  const mkC = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const PHOTO = {};
  /* the photo, de-lit: its large-scale luminance (blurred over about a third of the eye distance) is divided out, so the head's own shading does the modelling and only the features,
     the colour and the fine skin detail come from the photograph */
  function photoData(img, key, f) { if (PHOTO[key]) return PHOTO[key]; const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, c = mkC(W, H), q = c.getContext('2d'); q.drawImage(img, 0, 0); const d = q.getImageData(0, 0, W, H).data;
    const r = Math.max(6, Math.round(((f && f.lm) ? f.lm[2] - f.lm[0] : 150) * .32)), cb = mkC(W, H), qb = cb.getContext('2d'); qb.filter = 'blur(' + r + 'px)'; qb.drawImage(img, 0, 0); const b = qb.getImageData(0, 0, W, H).data; let m = 0, n = 0;
    if (f && f.lm) { const L = f.lm, cx = (L[0] + L[2]) / 2 | 0, cy = ((L[1] + L[4]) / 2) | 0; for (let y = cy - 30; y < cy + 30; y += 3) for (let x = cx - 60; x < cx + 60; x += 3) { const i = (y * W + x) * 4; m += b[i] * .3 + b[i + 1] * .59 + b[i + 2] * .11; n++; } }
    m = n ? m / n : 160; for (let i = 0; i < d.length; i += 4) { const l = b[i] * .3 + b[i + 1] * .59 + b[i + 2] * .11, k = l > 4 ? Math.min(1.45, Math.max(.7, m / l)) : 1; d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k); }
    return PHOTO[key] = { W, H, d }; }
  function samp(P, x, y, out) { const W = P.W, H = P.H, d = P.d; x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001); const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = (y0 * W + x0) * 4, j = i + W * 4;
    for (let c = 0; c < 3; c++) out[c] = (d[i + c] * (1 - fx) + d[i + 4 + c] * fx) * (1 - fy) + (d[j + c] * (1 - fx) + d[j + 4 + c] * fx) * fy; return out; }
  /** mean colour of the photo's cheeks and forehead (the reference skin colour) */
  function photoSkin(P, f) { const L = f.lm, ipd = L[2] - L[0], cx = (L[0] + L[2]) / 2, ey = (L[1] + L[3]) / 2, my = L[4], q = [0, 0, 0], m = [0, 0, 0]; let n = 0;
    const patch = (x, y, r) => { for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) { samp(P, x + dx, y + dy, q); m[0] += q[0]; m[1] += q[1]; m[2] += q[2]; n++; } };
    patch(cx - ipd * .52, ey + (my - ey) * .5, ipd * .1); patch(cx + ipd * .52, ey + (my - ey) * .5, ipd * .1); patch(cx, ey - ipd * .55, ipd * .1); return [m[0] / n, m[1] / n, m[2] / n]; }
  /** bake face f (or {id, mir}) into the head region of a skin atlas. o: { mode: 'npc' | 'hero', rect, done } */
  function bakeFace(out, face, o) { o = o || {}; const Li = GT.tex && GT.tex.imageEl, f = face && (FBY[face.id] || face); if (!Li || !out || !out.map || !f || !f.url) return out; const mir = !!(face && face.mir);
    Li(f.url, img => { try { const B = GT.hero && GT.hero._b; if (!B) return; const P = photoData(img, f.id, f), cv = out.map.image, S = cv.width, g = cv.getContext('2d'), R = o.rect || B.R.HEAD;
        const L = f.lm, ipd = L[2] - L[0], cx = (L[0] + L[2]) / 2, ey = (L[1] + L[3]) / 2, my = L[4], EX = Math.abs(B.headRaw(B.EYE.du, B.EYE.y, [0, 0, 0])[0]), sx = ipd / (2 * EX), sy = (my - ey) / (B.EYE.y - 1.612), ref = photoSkin(P, f);
        const x0 = Math.round(R[0] * S), w = Math.round((R[2] - R[0]) * S), yT = Math.round((1 - R[3]) * S), h = Math.round((R[3] - R[1]) * S), im = g.getImageData(x0, yT, w, h), d = im.data, p = [0, 0, 0], c = [0, 0, 0];
        /* target colour of plain skin: the neutral atlas base for NPCs, the painted cheek for the hero */
        let tgt = [228, 224, 222]; if (o.mode === 'hero') { const m = [0, 0, 0]; let n = 0; for (let py = 0; py < h; py += 2) for (let px = 0; px < w; px += 2) { const u = (px + .5) / w, v = 1 - (py + .5) / h, yy = B.HVI(v), du = u > .5 ? u - 1 : u, ad = Math.abs(du); if ((ad < .06 && yy > 1.705 && yy < 1.72) || (ad > .1 && ad < .16 && yy > 1.618 && yy < 1.636)) { const i = (py * w + px) * 4; m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; n++; } } if (n) tgt = [m[0] / n, m[1] / n, m[2] / n]; }
        const qr = (ref[0] - ref[2]) / (ref[0] + ref[1] + ref[2] + 1), lr = ref[0] * .3 + ref[1] * .59 + ref[2] * .11, pA = [0, 0, 0], pB = [0, 0, 0], pC = [0, 0, 0], pD = [0, 0, 0];
        const k = [tgt[0] / ref[0], tgt[1] / ref[1], tgt[2] / ref[2]], cY = 1.648;
        for (let py = 0; py < h; py++) { const v = 1 - (py + .5) / h, yy = B.HVI(v); if (yy < 1.535 || yy > 1.77) continue;
          for (let px = 0; px < w; px++) { const u = (px + .5) / w, du = u > .5 ? u - 1 : u; if (Math.abs(du) > .3) continue; const i = (py * w + px) * 4; if (d[i + 3] < 128) continue;
            B.headRaw(u, yy, p); const x = p[0], ry = (yy - cY) / (yy > cY ? .09 : .076), rx = x / .07, r = Math.hypot(rx, ry); let wM = (1 - sm(r, .78, 1)) * (1 - sm(Math.abs(du), .2, .27)); if (wM <= 0) continue;
            /* only surfaces that face the camera of the photo (under the chin and round the sides an orthographic projection smears), and only skin-like pixels outside the core of the face */
            B.headRaw(u + .004, yy, pA); B.headRaw(u - .004, yy, pB); B.headRaw(u, yy + .003, pC); B.headRaw(u, yy - .003, pD); const ax = pA[0] - pB[0], ay = pA[1] - pB[1], az = pA[2] - pB[2], bx = pC[0] - pD[0], by = pC[1] - pD[1], bz = pC[2] - pD[2];
            const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, nl = Math.hypot(nx, ny, nz) || 1; wM *= sm(Math.abs(nz / nl), .3, .62);
            samp(P, cx + (mir ? -x : x) * sx, ey - (yy - B.EYE.y) * sy, c); const ql = (c[0] - c[2]) / (c[0] + c[1] + c[2] + 1), lc = c[0] * .3 + c[1] * .59 + c[2] * .11, skin = (1 - sm(Math.abs(ql - qr), .035, .075)) * sm(lc / lr, .42, .6) * (1 - sm(lc / lr, 1.45, 1.7));
            wM *= lerp(skin, 1, 1 - sm(r, .55, .75)); if (wM <= .002) continue;
            for (let q = 0; q < 3; q++) d[i + q] = clamp(lerp(d[i + q], c[q] * k[q], wM), 0, 255); } }
        g.putImageData(im, x0, yT); out.map.needsUpdate = true; if (o.done) o.done(); } catch (e) { console.warn('[humans] face ' + f.id, e); } });
    return out; }

  /* ---------------------------------------------------------------- fabrics
     rects: [[u0, v0, u1, v1], ...] atlas rects; o: { tile (px), k (strength), skipDark } — the photo's luminance (mean 1) multiplies the atlas, so the weave and the fine creases
     show on every dye the vertex colours give it */
  function fabric(out, url, rects, o) { o = o || {}; const Li = GT.tex && GT.tex.imageEl; if (!Li || !out || !out.map) return out;
    Li(url, img => { try { const cv = out.map.image, S = cv.width, g = cv.getContext('2d'), N0 = o.tile || 160, kS = o.k === undefined ? 1 : o.k;
        for (const rect of rects) { const x0 = Math.round(rect[0] * S), w = Math.round((rect[2] - rect[0]) * S), yT = Math.round((1 - rect[3]) * S), h = Math.round((rect[3] - rect[1]) * S), im = g.getImageData(x0, yT, w, h), d = im.data;
          /* the tile divides the rect width exactly and is mirrored into four quadrants, so the cloth meets itself without a seam where a loft closes */ const N = 2 * Math.max(4, Math.round(w / Math.max(1, Math.round(w / N0)) / 2)), c = mkC(N, N), q = c.getContext('2d'), h2 = N / 2; for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { q.save(); q.translate(sx > 0 ? 0 : N, sy > 0 ? 0 : N); q.scale(sx, sy); q.drawImage(img, 0, 0, h2, h2); q.restore(); } const td = q.getImageData(0, 0, N, N).data; let m = 0; for (let i = 0; i < td.length; i += 4) m += td[i] * .3 + td[i + 1] * .59 + td[i + 2] * .11; m /= td.length / 4;
          for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) { const i = (py * w + px) * 4; if (o.skipDark && d[i] < o.skipDark && d[i + 1] < o.skipDark) continue; const j = ((py % N) * N + (px % N)) * 4, l = (td[j] * .3 + td[j + 1] * .59 + td[j + 2] * .11) / m, kk = clamp(1 + (l - 1) * 1.4 * kS, .6, 1.3); d[i] *= kk; d[i + 1] *= kk; d[i + 2] *= kk; }
          g.putImageData(im, x0, yT); }
        out.map.needsUpdate = true; } catch (e) { console.warn('[humans] fabric ' + url, e); } });
    return out; }
  /** a colour print over rects of a neutral cloth canvas (multiply): cb(canvasTexture) once the photo has loaded. tile = print repeat in px of the atlas. */
  function printCanvas(src, url, rects, tile, cb) { const Li = GT.tex && GT.tex.imageEl; if (!Li) return; Li(url, img => { try { const S = src.width, cv = mkC(S, S), g = cv.getContext('2d'); g.drawImage(src, 0, 0); g.globalCompositeOperation = 'multiply';
      for (const r of rects) { const x0 = r[0] * S, y0 = (1 - r[3]) * S, w = (r[2] - r[0]) * S, h = (r[3] - r[1]) * S; g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip(); for (let y = y0; y < y0 + h; y += tile) for (let x = x0; x < x0 + w; x += tile) g.drawImage(img, x, y, tile, tile); g.restore(); }
      const tx = new T.CanvasTexture(cv); tx.anisotropy = 8; tx.encoding = T.sRGBEncoding; cb(tx); } catch (e) { console.warn('[humans] print ' + url, e); } }); }

  /* ---------------------------------------------------------------- anatomy
     radial offsets (m, in the 1.80 m units of js/hero.js) added to the torso / arm / leg lofts. u: 0 front, .25 the outside of a left limb (+X), .5 back. A = { fem, musc 0..1.4,
     fat 0..1, bust (m), glute 0..1.5 }. A garment (ease > 4 mm) takes only the convex part, softened, because cloth bridges the hollows. */
  const Gs = (x, s) => Math.exp(-(x * x) / (s * s)), dU = (u, c) => { const d = Math.abs(u - c) % 1; return Math.min(d, 1 - d); }, band = (y, a, b, f) => sm(y, a - f, a + f) * (1 - sm(y, b - f, b + f));
  function torso(u, y, A, e) { const w = u - Math.floor(u), du = w > .5 ? w - 1 : w, ad = Math.abs(du), bk = dU(w, .5), m = A.musc === undefined ? 1 : A.musc, fat = A.fat || 0, gl = A.glute === undefined ? 1 : A.glute; let d = 0;
    if (A.fem) { const b = A.bust || .012; for (const s of [1, -1]) { const yy = y - 1.302; d += b * Gs(du - s * .08, .058) * (yy > 0 ? Gs(yy, .075) : Gs(yy, .032)); } d -= .0025 * Gs(du, .014) * band(y, 1.27, 1.35, .02); }
    else { for (const s of [1, -1]) { const yy = y - 1.338; d += .0075 * m * Gs(du - s * .085, .066) * (yy > 0 ? Gs(yy, .058) : Gs(yy, .028)); } d -= .0025 * m * Gs(du, .013) * band(y, 1.27, 1.42, .02); d += .002 * m * Gs(du, .05) * band(y, 1.11, 1.24, .02) * (1 - fat); }
    d += .0035 * Gs(y - (1.474 - .035 * ad), .0075) * sm(ad, .015, .045) * (1 - sm(ad, .15, .2)) - .0025 * Gs(y - 1.492, .009) * Gs(ad - .1, .04);   /* clavicles, the hollow above them */
    d += .004 * m * Gs(bk, .2) * Gs(y - 1.455, .03) + .0035 * m * Gs(bk - .16, .06) * Gs(y - 1.28, .08) * (A.fem ? .5 : 1);   /* upper back, latissimus */
    d -= .0035 * Gs(ad - .25, .07) * Gs(y - 1.1, .06) * (1 - fat) * (A.fem ? 1.6 : 1); d += .013 * fat * Gs(du, .15) * Gs(y - 1.07, .07);   /* waist at the sides, belly */
    for (const s of [1, -1]) d += .011 * gl * Gs(dU(w, .5 + s * .075), .075) * Gs(y - .905, .055); d -= .003 * gl * Gs(bk, .012) * band(y, .86, .98, .02);   /* buttocks */
    return e > .004 ? Math.max(0, d) * .55 : d; }
  function arm(u, s, A, e) { const m = A.musc === undefined ? 1 : A.musc, f = A.fem ? .55 : 1; let d = 0;
    d += .0075 * m * f * Gs(dU(u, .25), .2) * Gs(s - .045, .055) + .005 * m * f * Gs(dU(u, 0), .13) * Gs(s - .165, .055) + .0035 * m * f * Gs(dU(u, .5), .14) * Gs(s - .13, .07);   /* deltoid, biceps, triceps */
    d += .0025 * Gs(dU(u, .5), .07) * Gs(s - .292, .018) - .0015 * Gs(dU(u, 0), .12) * Gs(s - .285, .02) + .0045 * m * f * Gs(dU(u, .12), .14) * Gs(s - .335, .04) - .0012 * Gs(s - .5, .03);   /* elbow, crease, forearm, wrist */
    return e > .004 ? Math.max(0, d) * .5 : d; }
  function leg(u, y, A, e) { const m = A.musc === undefined ? 1 : A.musc, gl = A.glute === undefined ? 1 : A.glute, fat = A.fat || 0; let d = 0;
    d += .01 * gl * Gs(dU(u, .52), .16) * Gs(y - .9, .05) - .004 * gl * Gs(dU(u, .5), .13) * Gs(y - .812, .014);   /* buttock, gluteal fold */
    d += .006 * m * Gs(dU(u, .02), .17) * Gs(y - .72, .09) + .0045 * m * Gs(dU(u, .84), .07) * Gs(y - .56, .035);   /* quadriceps, vastus medialis */
    d += .003 * Gs(dU(u, 0), .07) * Gs(y - .505, .022) - .002 * Gs(dU(u, .5), .1) * Gs(y - .49, .03);   /* kneecap, the back of the knee */
    d += .009 * m * Gs(dU(u, .55), .17) * Gs(y - .375, .065) + .003 * m * Gs(dU(u, .65), .1) * Gs(y - .345, .045);   /* calf */
    d += .0018 * Gs(dU(u, .25), .05) * Gs(y - .1, .012) + .0018 * Gs(dU(u, .75), .05) * Gs(y - .112, .012);   /* ankle bones */
    d += .008 * fat * Gs(dU(u, .8), .15) * Gs(y - .78, .1) + (A.fem ? .006 * Gs(dU(u, .27), .15) * Gs(y - .84, .07) : 0);   /* inner thigh, hip */
    return e > .004 ? Math.max(0, d) * .5 : d; }
  const anat = { torso, arm, leg, HERO: { musc: 1.05, fat: 0, glute: .9 } };

  /* ---------------------------------------------------------------- MD (2026-11-17): rigged, textured people from the Microsoft Rocketbox library (MIT; assets/models/CREDITS.md)
     GT.humans.mdl = { pick(sp) -> id | null, ready(id), load(id), attach(id, parent, by, o) -> inst | null, prime(), stats }
     A model takes over the near and middle distance of a figure; js/people.js and js/hero.js keep running their own skeleton and poses (every state they have)
     and the model's Bip01 skeleton follows it before every frame is drawn: rotations carried over bone for bone (offsets measured once with the two rest poses
     lined up: the model's A-pose limbs turned onto the source's), the pelvis put at the source hips (lowered for the model's shorter legs while standing), and a
     two-bone correction per limb so the wrists and ankles land exactly where the source put them (whatever the hands hold, feet planted while walking).
     ?mdl=0 turns it all off; a model that fails to load leaves the lofted figure as it was. */
  const MDL = (function () {
    const OFF = /[?&]mdl=0/.test(location.search), BASE = 'assets/models/', V = '?v=3', CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/';
    /* f: female rig · hair: has a cut-out hair / lash card sheet · equip: police belt kit and pistol */
    const DEF = { kai: { hair: 1, hero: 1 }, m01: { hair: 1 }, m10: { hair: 1, vary: [2.1, 4.1, 1.2] }, m12: {}, m16: {}, f08: { hair: 1, f: 1 }, fp1: { hair: 1, f: 1 }, f03: { hair: 1, f: 1, vary: [2.2, 3.7, 1.1, 5.0] }, sf1: { f: 1 }, sm1: {}, pol: { equip: 1 }, sm4: {}, fp2: { hair: 1, f: 1 }, m06: { hair: 1 }, f17: { hair: 1, f: 1 } };
    const P = {}, ST = { loaded: 0, failed: 0, inst: 0, t0: 0, t1: 0, ms: 0, syncs: 0 };
    let LIB = null, TL = null;
    const script = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const libs = () => LIB || (LIB = (T.GLTFLoader ? Promise.resolve() : script(CDN + 'loaders/GLTFLoader.js')).then(() => T.SkeletonUtils ? 0 : script(CDN + 'utils/SkeletonUtils.js')));
    const TXC = {}, tex = (name, srgb) => { if (TXC[name]) return TXC[name]; TL = TL || new T.TextureLoader(); const t = TXC[name] = TL.load(BASE + 'tex/' + name + '.jpg' + V); if (srgb) t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; };

    /* one material for a whole body atlas, clothes and skin together: the texel's own colour says how much of it is skin (warm, mid-bright, not saturated red),
       and that weight brings in the scatter band, the skin sheen, a lower roughness and the stronger character fill */
    /* hue: a clothes-colour variant (radians round the grey axis) for the models the crowd repeats most; skin, greys and blacks keep their colour */
    function patchBody(mat, rSkin, hue) { return chain(mat, 'mdl' + (hue ? hue.toFixed(2) : ''), sh => { sh.uniforms.uGtSkin = U.uGtSkin; sh.uniforms.uGtFill = U.uGtFill; sh.uniforms.uGtCloth = U.uGtCloth;
      sh.fragmentShader = 'uniform vec4 uGtSkin;\nuniform float uGtFill;\nuniform vec2 uGtCloth;\nfloat gSk = 0.0;\n' + sh.fragmentShader;
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 gc = diffuseColor.rgb; float gl = dot( gc, vec3( 0.3, 0.59, 0.11 ) ), gRb = gc.r / ( gc.b + 0.004 ), gGr = gc.g / ( gc.r + 0.004 );
          gSk = smoothstep( 1.45, 2.2, gRb ) * smoothstep( 0.27, 0.37, gGr ) * ( 1.0 - smoothstep( 0.74, 0.9, gGr ) ) * smoothstep( 0.012, 0.045, gl ); }` + (hue ? `
        { vec3 gc = diffuseColor.rgb; float gx = max( gc.r, max( gc.g, gc.b ) ), gn = min( gc.r, min( gc.g, gc.b ) ), gw = smoothstep( 0.25, 0.5, ( gx - gn ) / ( gx + 1e-4 ) ) * ( 1.0 - gSk );
          vec3 gk = vec3( 0.57735 ); float gca = cos( ${hue.toFixed(3)} ), gsa = sin( ${hue.toFixed(3)} ); vec3 gr = gc * gca + cross( gk, gc ) * gsa + gk * dot( gk, gc ) * ( 1.0 - gca ); diffuseColor.rgb = mix( gc, max( gr, 0.0 ), gw ); }` : ''))
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix( roughnessFactor, ' + rSkin.toFixed(3) + ', gSk );')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectDiffuse *= mix( uGtCloth.y, uGtFill, gSk );');
      lightsWith(sh, `{ float gNl = dot( geometry.normal, directLight.direction ); float gWr = uGtSkin.y * gSk; float gW = saturate( ( gNl + gWr ) / ( 1.0 + gWr ) ); float gS = max( gW * gW - saturate( gNl ), 0.0 );
        vec3 gIrr = ( vec3( saturate( gNl ) ) + vec3( 1.0, 0.4, 0.27 ) * gS * uGtSkin.x ) * directLight.color;
        #ifndef PHYSICALLY_CORRECT_LIGHTS
          gIrr *= PI;
        #endif
        reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * gIrr * BRDF_Diffuse_Lambert( material.diffuseColor );
        float gFv = pow( 1.0 - saturate( dot( geometry.normal, geometry.viewDir ) ), 3.5 );
        reflectedLight.directSpecular += gFv * mix( saturate( gNl * 0.6 + 0.4 ) * ( 0.04 + material.diffuseColor ) * uGtCloth.x * 0.8, gW * vec3( 0.2, 0.16, 0.13 ) * uGtSkin.z, gSk ) * directLight.color; }`); }); }
    function matFor(id, name, hue) { const d = DEF[id], n = String(name || '').toLowerCase(), M = o => new T.MeshStandardMaterial(Object.assign({ skinning: true, metalness: 0, name: id + '_' + n }, o));
      if (/opacity/.test(n)) { const m = M({ map: tex(id + '_hair', true), alphaMap: tex(id + '_hair_a'), alphaTest: .42, side: T.DoubleSide, roughness: .62 }); return patchHair(m); }
      if (/equ/.test(n)) return M({ map: tex('pol_equip', true), normalMap: tex('pol_equip_n'), normalScale: new T.Vector2(1, -1), roughness: .55, metalness: .1 });
      if (/pistol/.test(n)) return M({ map: tex('pol_pistol', true), roughness: .45, metalness: .35 });
      const part = /head/.test(n) ? 'head' : 'body', m = M({ map: tex(id + '_' + part, true), normalMap: tex(id + '_' + part + '_n'), normalScale: new T.Vector2(1, -1), roughness: part === 'head' ? .7 : .84 });
      if (hue && part === 'body') m.name += '_h' + hue.toFixed(2); return patchBody(m, part === 'head' ? .5 : .52, part === 'body' ? hue : 0); }

    /* ---- rest poses and the bone map */
    const SIDE = ['L', 'R'], MAPN = { Bip01: 'hips', Bip01_Pelvis: 'hips', Bip01_Spine: 'spine', Bip01_Spine2: 'chest', Bip01_Neck: 'neck', Bip01_Head: 'head' };
    for (const s of SIDE) { const b = 'Bip01_' + s + '_'; Object.assign(MAPN, { [b + 'Clavicle']: 'clav' + s, [b + 'UpperArm']: 'arm' + s, [b + 'Forearm']: 'fore' + s, [b + 'Hand']: 'hand' + s,
      [b + 'Finger0']: 't1' + s, [b + 'Finger01']: 't2' + s, [b + 'Finger1']: 'i1' + s, [b + 'Finger11']: 'i2' + s, [b + 'Finger12']: 'i3' + s, [b + 'Finger2']: 'm1' + s + '|f1' + s, [b + 'Finger21']: 'm2' + s + '|f2' + s, [b + 'Finger22']: 'm3' + s + '|f3' + s,
      [b + 'Finger3']: 'f1' + s, [b + 'Finger31']: 'f2' + s, [b + 'Finger32']: 'f3' + s, [b + 'Finger4']: 'q1' + s + '|f1' + s, [b + 'Finger41']: 'q2' + s + '|f2' + s, [b + 'Finger42']: 'q3' + s + '|f3' + s,
      [b + 'Thigh']: 'thigh' + s, [b + 'Calf']: 'shin' + s, [b + 'Foot']: 'foot' + s, [b + 'Toe0']: 'toe' + s }); }
    /* limbs turned onto the source's rest directions: [dst bone, dst child, src bone, src child, (dst 2nd child, src 2nd child: the palm's roll)] */
    const ALIGN = []; for (const s of SIDE) { const b = 'Bip01_' + s + '_'; ALIGN.push([b + 'Clavicle', b + 'UpperArm', 'clav' + s, 'arm' + s], [b + 'UpperArm', b + 'Forearm', 'arm' + s, 'fore' + s], [b + 'Forearm', b + 'Hand', 'fore' + s, 'hand' + s],
      [b + 'Hand', b + 'Finger2', 'hand' + s, 'f1' + s, b + 'Finger0', 't1' + s], [b + 'Thigh', b + 'Calf', 'thigh' + s, 'shin' + s], [b + 'Calf', b + 'Foot', 'shin' + s, 'foot' + s], [b + 'Foot', b + 'Toe0', 'foot' + s, 'toe' + s]); }
    let SR = null;   /* the source rest pose (js/hero.js BDEF), root space */
    function srcRest() { if (SR) return SR; const B = GT.hero && GT.hero._b; if (!B) return null; const D = B.BDEF, bones = D.map(d => { const b = new T.Bone(); b.name = d[0]; b.position.set(d[2], d[3], d[4]); if (d[5]) b.rotation.z = d[5]; return b; });
      D.forEach((d, i) => { if (d[1]) bones[B.BI[d[1]]].add(bones[i]); }); bones[0].updateMatrixWorld(true); SR = { p: {}, q: {}, K: B.K };
      bones.forEach(b => { SR.p[b.name] = new T.Vector3().setFromMatrixPosition(b.matrixWorld); SR.q[b.name] = new T.Quaternion().setFromRotationMatrix(b.matrixWorld); }); return SR; }
    const _v = new T.Vector3(), _w = new T.Vector3(), _u = new T.Vector3(), _q = new T.Quaternion(), _r = new T.Quaternion(), _s = new T.Vector3();
    function rig(sc, mesh) { const S = srcRest(); if (!S) return null; sc.updateMatrixWorld(true); const bones = mesh.skeleton.bones, top = bones.find(b => !b.parent || !b.parent.isBone), order = [], par = [];
      (function walk(b, p) { const i = order.length; order.push(b); par.push(p); for (const c of b.children) if (c.isBone) walk(c, i); })(top, -1);
      const n = order.length, idx = {}; order.forEach((b, i) => { idx[b.name] = i; });
      const head = order[idx.Bip01_Head], hy = new T.Vector3().setFromMatrixPosition(head.matrixWorld).y, k = S.p.head.y / hy;   /* scaled so the head joint sits where the source's does */
      const Wp = order.map(b => new T.Vector3().setFromMatrixPosition(b.matrixWorld).multiplyScalar(k)), Wq = order.map(b => new T.Quaternion().setFromRotationMatrix(_m4.extractRotation(b.matrixWorld)));
      const kids = order.map(() => []); for (let i = n - 1; i > 0; i--) { kids[i].push(i); let p = par[i]; while (p >= 0) { kids[p].push(i); p = par[p]; } } kids[0].push(0);
      for (const a of ALIGN) { const i = idx[a[0]], c = idx[a[1]]; if (i === undefined || c === undefined) continue; _v.subVectors(Wp[c], Wp[i]).normalize(); _w.subVectors(S.p[a[3]], S.p[a[2]]).normalize(); _q.setFromUnitVectors(_v, _w);
        if (a[4] && idx[a[4]] !== undefined) { _u.subVectors(Wp[idx[a[4]]], Wp[i]).applyQuaternion(_q); _u.addScaledVector(_w, -_u.dot(_w)).normalize(); _s.subVectors(S.p[a[5]], S.p[a[2]]); _s.addScaledVector(_w, -_s.dot(_w)).normalize(); _r.setFromUnitVectors(_u, _s); _q.premultiply(_r); }
        for (const j of kids[i]) { if (j !== i) Wp[j].sub(Wp[i]).applyQuaternion(_q).add(Wp[i]); Wq[j].premultiply(_q); } }
      const C = order.map((b, i) => { const sn = MAPN[b.name]; if (!sn) return null; const s0 = sn.split('|').pop(); return S.q[s0].clone().invert().multiply(Wq[i]); });
      const L = n2 => idx[n2], side = s => ({ up: L('Bip01_' + s + '_UpperArm'), fo: L('Bip01_' + s + '_Forearm'), ha: L('Bip01_' + s + '_Hand'), th: L('Bip01_' + s + '_Thigh'), ca: L('Bip01_' + s + '_Calf'), ft: L('Bip01_' + s + '_Foot') });
      return { order, par, idx, n, k, C, lp: order.map(b => b.position.clone()), lq: order.map(b => b.quaternion.clone()), names: order.map(b => b.name), limb: [side('L'), side('R')],
        hipK: Wp[0].y / S.p.hips.y, ankD: (Wp[L('Bip01_L_Foot')].y - S.p.footL.y), hipRest: S.p.hips.y }; }
    const _m4 = new T.Matrix4();

    function load(id) { if (OFF || !DEF[id]) return; if (P[id]) return; P[id] = { state: 'loading' }; if (!ST.t0) ST.t0 = performance.now();
      libs().then(() => new Promise((res, rej) => new T.GLTFLoader().load(BASE + id + '.glb' + V, res, null, rej))).then(g => { const t0 = performance.now(), meshes = []; g.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); }); if (!meshes.length) throw new Error('no skinned mesh'); let tris = 0;
        /* one skinned mesh per material (glTF primitives), all on the same bones */
        for (const mesh of meshes) { const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; mesh.material = ms.map(m => { const q = matFor(id, m.name); q.userData.src = m.name; return q; }); if (mesh.material.length === 1) mesh.material = mesh.material[0];
          mesh.geometry.boundingSphere = new T.Sphere(new T.Vector3(0, 95, 0), 160); mesh.castShadow = mesh.receiveShadow = true; tris += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3; }
        Object.assign(P[id], { state: 'loaded', scene: g.scene, mesh: meshes[0], tris }); ST.loaded++; ST.ms += performance.now() - t0; ST.t1 = performance.now(); })
        .catch(e => { P[id].state = 'failed'; ST.failed++; console.warn('[humans] model ' + id, e); }); }
    /* the offsets need the source rest pose (js/hero.js), which may load after the model did */
    const ready = id => { const p = P[id]; if (!p) return false; if (p.state === 'loaded') { try { const R = rig(p.scene, p.mesh); if (R) { p.rig = R; p.state = 'ready'; } } catch (e) { p.state = 'failed'; console.warn('[humans] rig ' + id, e); } } return p.state === 'ready'; };
    function prime() { if (OFF) return; for (const id in DEF) load(id); }

    /** which model fits a people.js spec (null: keep the lofted figure — dogs, children, anyone without a fitting model) */
    const hs = s => { let h = 2166136261; for (let i = 0; i < s.length; i += 3) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
    const bad = id => !!(P[id] && P[id].state === 'failed'), FB = { f: ['f08', 'fp1', 'f17', 'fp2', 'f03', 'sf1'], m: ['m01', 'm16', 'm06', 'm12', 'm10', 'sm1', 'sm4'] };
    function pick(sp) { const id = pick0(sp); if (!id || !bad(id)) return id; const alt = FB[DEF[id] && DEF[id].f ? 'f' : 'm'].find(x => !bad(x)); return alt || null; }
    function pick0(sp) { if (OFF || !sp || sp.dog || sp.height < 1.3 || (sp.headK && sp.headK > 1.15)) return null; const t = String(sp.type || sp.kind || ''), f = !!sp.female, h = hs(sp.key || t), tone = toneOf(sp.skin || 0xc48e62);
      const tt = sp.top && sp.top.type || '', bt = sp.bottom && sp.bottom.type || '';
      if (sp.kind === 'cop' || /police|chengguan|^guard/.test(t)) return f ? null : 'pol';
      if (/beach|swim|lifeguard/.test(t) || /bare|bikini|swim/.test(tt) || /brief|bikini|swim/.test(bt)) return f ? 'sf1' : 'sm1';
      if (f) return sp.cn ? 'f03' : tone > 3.4 ? ['fp2', 'f08'][h % 2] : ['f08', 'fp1', 'f17', 'fp2', 'f03', 'f17', 'fp1'][h % 7];
      if (sp.cn) return 'm10'; if (/jogger|skater/.test(t)) return 'sm4'; if (tone > 3.4) return 'm12'; return ['m01', 'm16', 'm06', 'm01', 'm12', 'm10', 'm06', 'sm4'][h % 8]; }

    /* ---- instances: every one is synced from the scene's onBeforeRender (after the matrices are updated, before skinning and shadows), once per frame */
    const LIVE = new Set(), HOOKED = new WeakSet();
    function hook(scene) { if (!scene || HOOKED.has(scene)) return; HOOKED.add(scene); const prev = scene.onBeforeRender;
      scene.onBeforeRender = function (r, s, cam, rt) { if (prev) prev.call(this, r, s, cam, rt); const f = r.info.render.frame; for (const it of LIVE) { if (it.f === f) continue; let o = it.root, vis = true; while (o && o !== s) { if (!o.visible) { vis = false; break; } o = o.parent; } if (!o) { if (++it.lost > 600) LIVE.delete(it); continue; } it.lost = 0; if (vis) { it.f = f; sync(it); } } }; }
    const Wq = [], Wp = [], SQ = new WeakMap(), _hp = new T.Vector3(), _hq = new T.Quaternion(), _hs = new T.Vector3(), _ip = new T.Vector3(), _iq = new T.Quaternion(), _is = new T.Vector3(), _up = new T.Vector3();
    for (let i = 0; i < 128; i++) { Wq.push(new T.Quaternion()); Wp.push(new T.Vector3()); }
    const _ds = new T.Vector3(), _x = new T.Vector3(), sq = b => { let q = SQ.get(b); if (!q) { q = [new T.Quaternion(), new T.Vector3(), 0]; SQ.set(b, q); } if (q[2] !== ST.syncs) { b.matrixWorld.decompose(q[1], q[0], _ds); q[2] = ST.syncs; } return q; };
    const _a = new T.Vector3(), _b2 = new T.Vector3(), _n = new T.Vector3(), _t = new T.Vector3(), _e = new T.Vector3(), _h = new T.Vector3(), _q2 = new T.Quaternion(), _q3 = new T.Quaternion();
    /* two-bone correction: bend the middle joint to the reach the target needs (about the plane the copied pose already has), then swing the chain onto it */
    function reach(iu, im, ie, target, sh, R, hint) { const S = Wp[iu], E = Wp[im]; _h.copy(R.lp[ie]).multiplyScalar(sh).applyQuaternion(Wq[im]).add(E);
      _a.subVectors(S, E); _b2.subVectors(_h, E); const l1 = _a.length(), l2 = _b2.length(), dT = _t.subVectors(target, S).length(); if (l1 < 1e-5 || l2 < 1e-5 || dT < 1e-5) return;
      const d = Math.min(Math.max(dT, Math.abs(l1 - l2) + 1e-4), (l1 + l2) * .9995), th0 = _a.angleTo(_b2), th1 = Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
      _n.crossVectors(_a, _b2); if (_n.lengthSq() < 1e-10) _n.copy(hint); if (_n.lengthSq() > 1e-10) { _n.normalize(); _q2.setFromAxisAngle(_n, th1 - th0); Wq[im].premultiply(_q2); _b2.applyQuaternion(_q2); }
      _e.addVectors(E, _b2).sub(S).normalize(); _t.normalize(); _q3.setFromUnitVectors(_e, _t); Wq[iu].premultiply(_q3); Wq[im].premultiply(_q3); E.sub(S).applyQuaternion(_q3).add(S); }
    function sync(it) { const R = it.rig, n = R.n, src = it.src; ST.syncs++;
      it.holder.matrixWorld.decompose(_hp, _hq, _hs); const sh = _hs.x; it.parent.matrixWorld.decompose(_ip, _iq, _is); const ik = _is.x; _up.set(0, 1, 0).applyQuaternion(_iq);
      for (let i = 0; i < n; i++) { const p = R.par[i], Pq = p < 0 ? _hq : Wq[p], Pp = p < 0 ? _hp : Wp[p], sb = src[i];
        if (i === 0 && sb) { const s0 = sq(sb), h = _v.subVectors(s0[1], _ip).dot(_up), up = h / (R.hipRest * ik), k = 1 + (R.hipK - 1) * sm(up, .55, .85); Wp[0].copy(s0[1]).addScaledVector(_up, -h * (1 - k)); }
        else Wp[i].copy(R.lp[i]).multiplyScalar(sh).applyQuaternion(Pq).add(Pp);
        if (it.lim[i]) { const L = it.lim[i], te = sq(L.t)[1], tm = sq(L.sm)[1], ta = sq(L.sa)[1]; _w.copy(te); if (L.foot) _w.addScaledVector(_up, R.ankD * ik); _u.subVectors(ta, tm).cross(_x.subVectors(te, tm));
          reach(L.u, L.m, i, _w, sh, R, _u); Wp[i].copy(R.lp[i]).multiplyScalar(sh).applyQuaternion(Wq[L.m]).add(Wp[L.m]); }
        if (sb) Wq[i].copy(sq(sb)[0]).multiply(R.C[i]); else Wq[i].copy(Pq).multiply(R.lq[i]); }
      for (let i = 0; i < n; i++) { const b = it.bones[i], p = R.par[i], Pq = p < 0 ? _hq : Wq[p]; b.quaternion.copy(_q.copy(Pq).invert().multiply(Wq[i]));
        if (i === 0) b.position.copy(Wp[0]).sub(_hp).applyQuaternion(_q.copy(_hq).invert()).multiplyScalar(1 / sh); b.matrixWorld.compose(Wp[i], Wq[i], _s.set(sh, sh, sh)); }
      if (it.acc) for (const a of it.acc) a.m.matrixWorld.multiplyMatrices(a.bone.matrixWorld, a.inv); }   /* pt1: hats, glasses, the mask and the chain ride on the bone they were made against (bind space × the bone's skinning matrix) */

    /** a model for a figure: added under `parent` (the group the source skeleton hangs in, feet at its origin), following the bones in `by` (name -> T.Bone).
        o: { hide(cam) -> true to skip one draw (the hero's model inside the first-person camera) }. Returns { root, mesh, id, sync(), dispose() } or null when not ready. */
    function attach(id, parent, by, o) { o = o || {}; if (!ready(id) || !T.SkeletonUtils) return null; const pr = P[id], R = pr.rig, root = T.SkeletonUtils.clone(pr.scene), meshes = []; root.traverse(x => { if (x.isSkinnedMesh) meshes.push(x); }); if (!meshes.length) return null; const mesh = meshes[0];
      root.scale.setScalar(R.k); root.name = 'model_' + id; parent.add(root); for (const m of meshes) { m.frustumCulled = true; m.castShadow = m.receiveShadow = true; }
      const vy = DEF[id].vary, vi = vy && o.seed !== undefined ? (o.seed >>> 0) % (vy.length + 1) : 0;   /* variant 0 is the original clothes */
      if (vi) { const hue = vy[vi - 1], VM = pr.vm || (pr.vm = {}); for (const m of meshes) { const b = m.material, src = b.userData.src; if (!/body/i.test(src || '')) continue; const k = src + vi; m.material = VM[k] || (VM[k] = Object.assign(matFor(id, src, hue), { userData: { src } })); } }
      const byName = {}; mesh.skeleton.bones.forEach(b => { byName[b.name] = b; }); const bones = R.names.map(nm => byName[nm]), holder = bones[0].parent;
      const src = R.names.map(nm => { const sn = MAPN[nm]; if (!sn) return null; for (const c of sn.split('|')) if (by[c]) return by[c]; return null; });
      /* per limb end (dst hand / foot index): the dst upper and middle joints, and the source upper, middle and end bones */
      const lim = []; for (let s = 0; s < 2; s++) { const L = R.limb[s], S = SIDE[s];
        if (L.ha !== undefined && by['hand' + S] && by['fore' + S] && by['arm' + S]) lim[L.ha] = { u: L.up, m: L.fo, t: by['hand' + S], sm: by['fore' + S], sa: by['arm' + S], foot: false };
        if (L.ft !== undefined && by['foot' + S] && by['shin' + S] && by['thigh' + S]) lim[L.ft] = { u: L.th, m: L.ca, t: by['foot' + S], sm: by['shin' + S], sa: by['thigh' + S], foot: true }; }
      const it = { id, root, mesh, meshes, holder, parent, bones, src, rig: R, lim, f: -1, lost: 0 };
      const obr = function (r, scene, cam, geo, mat) { if (!HOOKED.has(scene)) hook(scene); const f = r.info.render.frame; if (it.f !== f) { it.f = f; sync(it); for (const m of meshes) m.skeleton.update(); }
        if (o.hide) { const h = !!o.hide(cam, mat); if (mat.colorWrite === h) { mat.colorWrite = !h; mat.depthWrite = !h; } } };
      for (const m of meshes) m.onBeforeRender = obr; it.setShadow = on => { for (const m of meshes) m.castShadow = !!on; }; it.obr = obr; it.hideFn = o.hide || null; it.body = meshes.find(m => /body/i.test((m.material && m.material.userData && m.material.userData.src) || '')) || mesh;
      LIVE.add(it); ST.inst++; it.sync = () => sync(it); it.dispose = () => { LIVE.delete(it); for (const m of meshes) if (m.userData.tuckedHair) m.userData.tuckedHair.dispose(); if (root.parent) root.parent.remove(root); }; it.tris = pr.tris; return it; }
    /* ---------------------------------------------------------------- pt1 (play-test 1): the lead's wardrobe on his own model
       dress(inst, look) -> true once applied (false while the atlas is still loading: call again). look = { top, bot, shoe, hat, face, acc } — null parts keep what the model was exported in.
         top:  { c: '#hex', sl: 'short' | 'long' | 'none' (a tank top), pat: 'floral' | 'stripe' | 'plaid' | 'camo' | 'palm', p: ['#hex' …] pattern colours, print: 'jersey' | 'polo' | 'vest' | 'guard' | 'shirt' | 'hoodie' | 'tie',
                 shell: { kind: 'open' | 'vee' | 'closed', c: '#hex', tex: 'denim' | 'leather' | 'wool' | 'fleece' | 'canvas', r: roughness, hem: cm, print } (a jacket over it) }
         bot:  { c, shorts, stripe: '#hex' (track pants), cargo, lo, hi }      shoe: { c, sole: '#hex', kind: 'sneaker' | 'boot' | 'sandal' | 'dress' }
         hat:  { kind: 'cap' | 'bucket' | 'fedora' | 'hardhat', c, c2 }      face: 'shades' | 'mask'      acc: 'chain'
       How: every texel of the body atlas is classed once (the bone its triangle hangs on, skin / denim / cloth by its colour, and where it lies on the body in the bind pose, cm),
       then a look recolours each class keeping the photo's folds (colour × the texel's brightness against its class median), paints skin where a garment stops (tank top, shorts,
       sandals), cloth over the forearms (long sleeves), and prints in body space (stripes, a number, a tie). A jacket is a second skinned mesh on the same bones: the torso and
       arm triangles pushed out along the normals and opened down the front. Hats, glasses, the mask and the chain are rigid meshes made in the model's bind space (cm, Z up, −Y forward). */
    const WR = {}, RR = 1024, hx3 = h => { const n = parseInt(String(h || '#808080').replace('#', ''), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
    const bcls = n => /Finger|Hand/.test(n) ? 4 : /Forearm/.test(n) ? 3 : /UpperArm/.test(n) ? 2 : /Spine|Neck|Clavicle/.test(n) ? 1 : /Pelvis/.test(n) ? 5 : /Thigh/.test(n) ? 6 : /Calf/.test(n) ? 7 : /Foot|Toe/.test(n) ? 8 : 9;
    const skinT = (r, g, b) => { const l = (r * .3 + g * .59 + b * .11) / 255, rb = r / (b + 1), gr = g / (r + 1); return sm(rb, 1.45, 2.2) * sm(gr, .27, .37) * (1 - sm(gr, .74, .9)) * sm(l, .012, .045); };
    function boneAt(sk, name) { const i = sk.bones.findIndex(b => b.name === name); if (i < 0) return null; return new T.Vector3().applyMatrix4(_m4.copy(sk.boneInverses[i]).invert()); }
    function wardrobe(id) { let w = WR[id]; if (w) return w.ok ? w : null; const pr = P[id]; if (!pr || !pr.scene) return null; let mesh = null; pr.scene.traverse(o => { if (o.isSkinnedMesh && !mesh && /body/i.test((o.material && o.material.userData && o.material.userData.src) || '')) mesh = o; }); mesh = mesh || pr.mesh;
      const mat = mesh.material, img = mat && mat.map && mat.map.image; if (!img || !img.width || (img.complete === false)) return null;
      w = WR[id] = { ok: false, mesh, mat, tex: {}, texQ: [], shells: {}, map0: mat.map }; try { wBuild(w, img); w.ok = true; } catch (e) { w.bad = true; console.warn('[humans] wardrobe ' + id, e); } return w.ok ? w : null; }
    function wBuild(w, img) { const mesh = w.mesh, g = mesh.geometry, pos = g.attributes.position.array, nor = g.attributes.normal.array, uv = g.attributes.uv.array, si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, ix = g.index.array, sk = mesh.skeleton, bc = sk.bones.map(b => bcls(b.name));
      const N = RR * RR, part = new Uint8Array(N), BX = new Float32Array(N), BY = new Float32Array(N), BZ = new Float32Array(N), BF = new Int8Array(N), tcl = new Uint8Array(ix.length / 3), acc = new Float32Array(10);
      for (let t = 0; t < ix.length; t += 3) { const a = ix[t], b = ix[t + 1], c = ix[t + 2]; acc.fill(0); for (const i of [a, b, c]) for (let k = 0; k < 4; k++) acc[bc[si[i * 4 + k]]] += sw[i * 4 + k]; let pc = 1, bw = -1; for (let k = 1; k < 10; k++) if (acc[k] > bw) { bw = acc[k]; pc = k; } tcl[t / 3] = pc;
        const x0 = uv[a * 2] * RR, y0 = (1 - uv[a * 2 + 1]) * RR, x1 = uv[b * 2] * RR, y1 = (1 - uv[b * 2 + 1]) * RR, x2 = uv[c * 2] * RR, y2 = (1 - uv[c * 2 + 1]) * RR, den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2); if (Math.abs(den) < 1e-9) continue;
        const X0 = Math.max(0, Math.floor(Math.min(x0, x1, x2))), X1 = Math.min(RR - 1, Math.ceil(Math.max(x0, x1, x2))), Y0 = Math.max(0, Math.floor(Math.min(y0, y1, y2))), Y1 = Math.min(RR - 1, Math.ceil(Math.max(y0, y1, y2))), e = -.6 / Math.sqrt(Math.abs(den));
        for (let py = Y0; py <= Y1; py++) for (let px = X0; px <= X1; px++) { const X = px + .5, Y = py + .5, l0 = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / den, l1 = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / den, l2 = 1 - l0 - l1; if (l0 < e || l1 < e || l2 < e) continue;
          const q = py * RR + px; part[q] = pc; BX[q] = pos[a * 3] * l0 + pos[b * 3] * l1 + pos[c * 3] * l2; BY[q] = pos[a * 3 + 1] * l0 + pos[b * 3 + 1] * l1 + pos[c * 3 + 1] * l2; BZ[q] = pos[a * 3 + 2] * l0 + pos[b * 3 + 2] * l1 + pos[c * 3 + 2] * l2; BF[q] = clamp(Math.round(-(nor[a * 3 + 1] * l0 + nor[b * 3 + 1] * l1 + nor[c * 3 + 1] * l2) * 100), -100, 100); } }
      for (let pass = 0; pass < 4; pass++) { const P0 = part.slice(); for (let y = 1; y < RR - 1; y++) for (let x = 1; x < RR - 1; x++) { const q = y * RR + x; if (P0[q]) continue; const s = P0[q - 1] ? q - 1 : P0[q + 1] ? q + 1 : P0[q - RR] ? q - RR : P0[q + RR] ? q + RR : -1; if (s < 0) continue; part[q] = P0[s]; BX[q] = BX[s]; BY[q] = BY[s]; BZ[q] = BZ[s]; BF[q] = BF[s]; } }   /* bleed past the island edges, so mip levels do not pull the old colour in */
      const S = img.width, cv = document.createElement('canvas'); cv.width = cv.height = S; const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, S, S); const D = cx.getImageData(0, 0, S, S).data, sc = RR / S, cls = new Uint8Array(S * S), lum = new Uint8Array(S * S), H = []; for (let k = 0; k < 10; k++) H.push(new Uint32Array(256));
      let sr = 0, sg = 0, sb = 0, sn = 0; const wr = { L: boneAt(sk, 'Bip01_L_Hand'), R: boneAt(sk, 'Bip01_R_Hand') }, knee = boneAt(sk, 'Bip01_L_Calf'), foot = { L: boneAt(sk, 'Bip01_L_Foot'), R: boneAt(sk, 'Bip01_R_Foot') };
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = y * S + x, r = D[i * 4], gg = D[i * 4 + 1], b = D[i * 4 + 2], l = (r * 77 + gg * 150 + b * 29) >> 8; lum[i] = l; if (l < 9) continue; const q = ((y * sc) | 0) * RR + ((x * sc) | 0), pc = part[q]; if (!pc) continue;
        const sk2 = skinT(r, gg, b) > .35, blue = b > r * 1.2 && b >= gg * .95; let c = 0;
        if (pc === 4) c = 5; else if (pc === 3) c = 4; else if (pc === 2) c = sk2 ? 3 : blue ? 0 : 2; else if (pc === 1 || pc === 5) c = sk2 ? 9 : blue ? 6 : 1; else if (pc === 6 || pc === 7) c = sk2 ? 0 : (blue || l < 90) ? (pc === 7 ? 7 : 6) : l > 140 ? 8 : 6; else if (pc === 8) c = sk2 ? 0 : 8;
        cls[i] = c; if (c) H[c][l]++; if (c === 4 && sk2) { sr += r; sg += gg; sb += b; sn++; } }
      const med = k => { const h = k.reduce((s, j) => { for (let v = 0; v < 256; v++) s[v] += H[j][v]; return s; }, new Uint32Array(256)); let n = 0; for (let v = 0; v < 256; v++) n += h[v]; let a = 0; for (let v = 0; v < 256; v++) { a += h[v]; if (a >= n / 2) return Math.max(12, v); } return 128; };
      const list = []; for (let i = 0; i < S * S; i++) if (cls[i] && cls[i] !== 5 && cls[i] !== 9) list.push(i);
      let chestY = 0, neckY = 0; for (let i = 0; i < pos.length / 3; i++) { const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]; if (Math.abs(x) < 3 && z > 138 && z < 145) chestY = Math.min(chestY, y); if (Math.abs(x) < 3 && z > 147 && z < 153) neckY = Math.max(neckY, y); }   /* where a chain lies: the chest front, the back of the neck */
      w.chestY = chestY || -11; w.neckY = neckY || 6;
      Object.assign(w, { S, base: D, cls, lum, list: Int32Array.from(list), part, BX, BY, BZ, BF, sc, tcl, med: { top: med([1, 2]), pants: med([6, 7]), shoe: med([8]), skin: med([3, 4]) }, skin: sn ? [sr / sn, sg / sn, sb / sn] : [196, 142, 104], wr, knee: knee ? knee.z : 48, foot }); }
    /* ---- patterns (256 px tiles, sampled in body space: u = x cm, v = height cm) and body-space prints (front / back canvases over x ±32 cm, height 92–156 cm) */
    const PATC = {};
    function patTile(kind, cols) { const key = kind + (cols || []).join(''); if (PATC[key]) return PATC[key]; const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), r = GT.rng ? GT.rng('pat' + key) : Math.random, C = cols || [];
      const at = (x, y, fn) => { for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) fn(x + dx, y + dy); };
      if (kind === 'floral' || kind === 'palm') { g.fillStyle = C[0] || '#0f6d78'; g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 26; i++) { const x = r() * 256, y = r() * 256, s = 8 + r() * 9, a0 = r() * 6.28; at(x, y, (X, Y) => { g.fillStyle = C[3] || '#1d4d2c'; for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(X + Math.cos(a0 + k * 2.1) * s * 1.5, Y + Math.sin(a0 + k * 2.1) * s * 1.5, s * 1.25, s * .38, a0 + k * 2.1, 0, 6.29); g.fill(); } }); }
        for (let i = 0; i < (kind === 'palm' ? 0 : 22); i++) { const x = r() * 256, y = r() * 256, s = 7 + r() * 8, a0 = r() * 6.28, col = C[1 + (i % 2)] || '#f4e7c4'; at(x, y, (X, Y) => { g.fillStyle = col; for (let p = 0; p < 5; p++) { g.beginPath(); g.arc(X + Math.cos(a0 + p * 1.257) * s * .62, Y + Math.sin(a0 + p * 1.257) * s * .62, s * .55, 0, 6.29); g.fill(); } g.fillStyle = '#f3d24a'; g.beginPath(); g.arc(X, Y, s * .22, 0, 6.29); g.fill(); }); }
        if (kind === 'palm') for (let i = 0; i < 12; i++) { const x = r() * 256, y = r() * 256, s = 10 + r() * 6; at(x, y, (X, Y) => { g.strokeStyle = C[1] || '#f2ead2'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(X, Y + s * 1.6); g.quadraticCurveTo(X + 2, Y + s * .5, X, Y); g.stroke(); g.fillStyle = C[1] || '#f2ead2'; for (let k = 0; k < 6; k++) { const a = -2.8 + k * .55; g.beginPath(); g.ellipse(X + Math.cos(a) * s * .7, Y + Math.sin(a) * s * .55, s * .7, s * .16, a, 0, 6.29); g.fill(); } }); } }
      else if (kind === 'stripe') { for (let y = 0; y < 256; y += 32) { g.fillStyle = C[0] || '#203a6e'; g.fillRect(0, y, 256, 16); g.fillStyle = C[1] || '#f2efe6'; g.fillRect(0, y + 16, 256, 16); } }
      else if (kind === 'plaid') { g.fillStyle = C[0] || '#8e1d1d'; g.fillRect(0, 0, 256, 256); g.globalAlpha = .55; g.fillStyle = C[1] || '#141414'; for (let k = 0; k < 256; k += 64) { g.fillRect(k + 8, 0, 28, 256); g.fillRect(0, k + 8, 256, 28); } g.globalAlpha = .5; g.fillStyle = C[2] || '#e6c75a'; for (let k = 0; k < 256; k += 64) { g.fillRect(k + 50, 0, 3, 256); g.fillRect(0, k + 50, 256, 3); } g.globalAlpha = 1; }
      else if (kind === 'camo') { g.fillStyle = C[0] || '#6b6d4a'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 70; i++) { const x = r() * 256, y = r() * 256, s = 10 + r() * 22; at(x, y, (X, Y) => { g.fillStyle = C[1 + (i % 3)] || ['#3f4430', '#8f8459', '#24261c'][i % 3]; g.beginPath(); g.ellipse(X, Y, s, s * (.4 + r() * .4), r() * 3, 0, 6.29); g.fill(); }); } }
      return PATC[key] = g.getImageData(0, 0, 256, 256).data; }
    const PRC = {};
    function printCanvases(kind, top) { const key = kind + (top.c || '') + (top.pc || []).join(''); if (PRC[key]) return PRC[key]; const mk = () => { const c = document.createElement('canvas'); c.width = c.height = 256; return c; }, F = mk(), B = mk(), f = F.getContext('2d'), b = B.getContext('2d'), X = x => (x + 32) / 64 * 256, Y = z => (156 - z) / 64 * 256, AF = '"Arial Black","Helvetica Neue",Arial,sans-serif';
      const txt = (g, t, x, z, px, col, o) => { o = o || {}; g.save(); g.translate(X(x), Y(z)); if (g === b) g.scale(-1, 1);   /* the front is seen with the body's +X on the viewer's right; the back is seen from behind, so its lettering is mirrored in body space */ g.font = '900 ' + px + 'px ' + (o.font || AF); g.textAlign = 'center'; g.textBaseline = 'middle'; if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = px * .14; g.strokeText(t, 0, 0); } g.fillStyle = col; g.fillText(t, 0, 0); g.restore(); };
      const P1 = (top.pc && top.pc[0]) || '#f3efe6', P2 = (top.pc && top.pc[1]) || '#1a1a1a';
      if (kind === 'jersey') { txt(b, 'VELLMONT', 0, 141, 20, P1); txt(b, '23', 0, 122, 64, P1, { stroke: P2 }); txt(f, '23', 6, 138, 16, P1); }
      else if (kind === 'polo') { f.fillStyle = P2; f.fillRect(X(-1.1), Y(150), X(1.1) - X(-1.1), Y(138) - Y(150)); f.fillStyle = P1; for (const z of [147, 142]) { f.beginPath(); f.arc(X(0), Y(z), 2.2, 0, 6.29); f.fill(); } f.fillStyle = P1; f.beginPath(); f.arc(X(-7.5), Y(141), 3.4, 0, 6.29); f.fill(); }
      else if (kind === 'vest') { for (const g of [f, b]) { g.fillStyle = '#d6dcd8'; g.fillRect(0, Y(112), 256, Y(108) - Y(112)); g.fillRect(0, Y(122), 256, Y(118) - Y(122)); } txt(b, 'SANITATION', 0, 136, 15, '#23272b', { font: 'Arial,sans-serif' }); }
      else if (kind === 'guard') { f.fillStyle = '#c9a54a'; f.beginPath(); f.moveTo(X(-8), Y(144)); f.lineTo(X(-5), Y(144)); f.lineTo(X(-5), Y(140)); f.lineTo(X(-6.5), Y(138.5)); f.lineTo(X(-8), Y(140)); f.closePath(); f.fill(); txt(b, 'SECURITY', 0, 138, 18, '#e8e4d8', { font: 'Arial,sans-serif' }); }
      else if (kind === 'shirt' || kind === 'tie') { f.fillStyle = P1; f.beginPath(); f.moveTo(X(-1.4), Y(150)); f.lineTo(X(1.4), Y(150)); f.lineTo(X(1.0), Y(147)); f.lineTo(X(2.4), Y(118)); f.lineTo(X(0), Y(115)); f.lineTo(X(-2.4), Y(118)); f.lineTo(X(-1.0), Y(147)); f.closePath(); f.fill(); f.fillStyle = 'rgba(255,255,255,.18)'; for (let z = 120; z < 146; z += 4) f.fillRect(X(-2), Y(z + 1), X(2) - X(-2), 1.6); }
      else if (kind === 'hoodie') { f.fillStyle = 'rgba(0,0,0,.16)'; f.fillRect(X(-11), Y(108), X(11) - X(-11), Y(96) - Y(108)); f.strokeStyle = 'rgba(0,0,0,.35)'; f.lineWidth = 1.5; f.strokeRect(X(-11), Y(108), X(11) - X(-11), Y(96) - Y(108)); f.strokeStyle = '#ece8dc'; f.lineWidth = 2.4; for (const x of [-3, 3]) { f.beginPath(); f.moveTo(X(x), Y(150)); f.lineTo(X(x * 1.2), Y(136)); f.stroke(); } txt(f, 'MOONBAY', 0, 128, 14, P1); }
      else if (kind === 'denim' || kind === 'canvas') { for (const s of [-1, 1]) { f.strokeStyle = 'rgba(214,150,60,.75)'; f.lineWidth = 1.2; f.setLineDash([3, 2]); f.strokeRect(X(s * 6 - 4.5), Y(140), 9 * 256 / 64, (Y(133) - Y(140))); f.setLineDash([]); f.fillStyle = '#c9b48a'; f.beginPath(); f.arc(X(s * 6), Y(139), 1.6, 0, 6.29); f.fill(); } b.strokeStyle = 'rgba(214,150,60,.6)'; b.lineWidth = 1.2; b.setLineDash([3, 2]); b.beginPath(); b.moveTo(0, Y(128)); b.lineTo(256, Y(128)); b.stroke(); }
      else if (kind === 'leather') { f.strokeStyle = '#b9bcc0'; f.lineWidth = 2; for (const s of [-1, 1]) { f.beginPath(); f.moveTo(X(s * 4.6), Y(150)); f.lineTo(X(s * 4.6), Y(92)); f.stroke(); f.beginPath(); f.moveTo(X(s * 9), Y(112)); f.lineTo(X(s * 13), Y(102)); f.stroke(); } }
      else if (kind === 'suit') { f.fillStyle = 'rgba(0,0,0,.22)'; for (const s of [-1, 1]) { f.beginPath(); f.moveTo(X(s * 3), Y(150)); f.lineTo(X(s * 9), Y(148)); f.lineTo(X(s * 4.5), Y(122)); f.lineTo(X(s * 1.6), Y(119)); f.closePath(); f.fill(); } f.fillStyle = '#0e1118'; for (const z of [116, 106]) { f.beginPath(); f.arc(X(-1.5), Y(z), 1.4, 0, 6.29); f.fill(); } f.fillStyle = '#f3f1ea'; f.fillRect(X(-9.5), Y(141), 4 * 256 / 64, 2.4); }
      return PRC[key] = { f: f.getImageData(0, 0, 256, 256).data, b: b.getImageData(0, 0, 256, 256).data }; }
    /* ---- compose one atlas for a look (body: full size; jacket: half) */
    function lerp3(o, j, c, k) { o[j] = c[0] * k; o[j + 1] = c[1] * k; o[j + 2] = c[2] * k; }
    function bodyCanvas(w, look) { const S = w.S, out = new ImageData(S, S), O = out.data; O.set(w.base); const T0 = look.top || null, B0 = look.bot || null, F0 = look.shoe || null, L = w.list, cls = w.cls, lum = w.lum, sc = w.sc, M = w.med, SK = w.skin;
      const tc = T0 && hx3(T0.c), bcol = B0 && hx3(B0.c), fc = F0 && hx3(F0.c), fs = F0 && hx3(F0.sole || F0.c), pat = T0 && T0.pat ? patTile(T0.pat, T0.p) : null, pr = T0 && T0.print ? printCanvases(T0.print, T0) : null, bstr = B0 && B0.stripe ? hx3(B0.stripe) : null, col = [0, 0, 0];
      const tlo = T0 && T0.lo !== undefined ? T0.lo : .62, thi = T0 && T0.hi !== undefined ? T0.hi : 1.35, blo = B0 && B0.lo !== undefined ? B0.lo : .6, bhi = B0 && B0.hi !== undefined ? B0.hi : 1.45;
      const skin = (j, l, med) => { const k = clamp(1 + (l / med - 1) * .3, .82, 1.12); lerp3(O, j, SK, k); };
      for (let n = 0; n < L.length; n++) { const i = L[n], c = cls[i], l = lum[i], j = i * 4, x = i % S, y = (i / S) | 0, q = ((y * sc) | 0) * RR + ((x * sc) | 0), X = w.BX[q], Z = w.BZ[q], Fr = w.BF[q];
        if (c === 1 || c === 2 || c === 3 || c === 4) { if (!T0) continue;
          if (c === 2 && T0.sl === 'none') { skin(j, l, M.top); continue; }
          if ((c === 3 || c === 4) && T0.sl !== 'long') continue;
          if (c === 4) { const s = X > 0 ? w.wr.L : w.wr.R; if (s && Math.hypot(X - s.x, Z - s.z) < 2.2) continue; }
          let k = c >= 3 ? clamp(1 + (l / M.skin - 1) * .5, .78, 1.15) : clamp(l / M.top, tlo, thi), cc = tc;
          if (pat) { const u = (((X + (Fr < 0 ? 37 : 0)) / 26 * 256) | 0) & 255, v = (((160 - Z) / 26 * 256) | 0) & 255, pj = (v * 256 + u) * 4; col[0] = pat[pj]; col[1] = pat[pj + 1]; col[2] = pat[pj + 2]; cc = col; k = clamp(1 + (k - 1) * .8, .7, 1.25); }
          if (c === 4) { const s = X > 0 ? w.wr.L : w.wr.R; if (s && Math.hypot(X - s.x, Z - s.z) < 5.5) k *= .82; }   /* the cuff */
          if (c === 1 && Z > 148.6 && T0.print !== 'tie') k *= .86;   /* the collar rib */
          lerp3(O, j, cc, k);
          if (pr && (c === 1) && X > -32 && X < 32 && Z > 92 && Z < 156) { const P2 = Fr >= 0 ? pr.f : pr.b, u = ((X + 32) / 64 * 256) | 0, v = ((156 - Z) / 64 * 256) | 0, pj = (v * 256 + u) * 4, a = P2[pj + 3] / 255; if (a > 0) { const kk = clamp(.82 + (l / M.top - 1) * .5, .7, 1.1); O[j] = O[j] * (1 - a) + P2[pj] * kk * a; O[j + 1] = O[j + 1] * (1 - a) + P2[pj + 1] * kk * a; O[j + 2] = O[j + 2] * (1 - a) + P2[pj + 2] * kk * a; } }
          continue; }
        if (c === 6 || c === 7) { if (F0 && F0.kind === 'boot' && Z < 15 && !(B0 && B0.shorts)) { lerp3(O, j, fc, clamp(l / M.pants, .6, 1.4)); continue; }   /* the boot shaft over the trouser hem */
          if (!B0) continue; if (B0.shorts && (c === 7 || Z < w.knee + 3.5)) { skin(j, l, M.pants * 1.3); continue; }
          let k = clamp(l / M.pants, blo, bhi); if (B0.shorts && Z < w.knee + 6.5) k *= .8;   /* the hem */
          lerp3(O, j, bcol, k); if (bstr && Math.abs(w.BY[q] - 1) < 1.5 && Math.abs(X) > 10.5 + (100 - Z) * .02) lerp3(O, j, bstr, clamp(l / M.pants, .85, 1.2)); continue; }   /* track pants: a stripe down the outer seam */
        if (c === 8) { if (!F0) continue; if (F0.kind === 'sandal') { const f2 = X > 0 ? w.foot.L : w.foot.R, by = w.BY[q]; if (Z < 2.4) lerp3(O, j, fs, clamp(l / M.shoe, .6, 1.2)); else if (f2 && Math.abs(by - (f2.y - 9.5)) < 1.1 && Z < 7) lerp3(O, j, fc, 1); else skin(j, l, M.shoe); continue; }
          lerp3(O, j, Z < (F0.kind === 'dress' ? 1.6 : 2.6) ? fs : fc, clamp(l / M.shoe, F0.kind === 'dress' ? .45 : .55, F0.kind === 'dress' ? 1.9 : 1.4)); } }
      return out; }
    function shellCanvas(w, sh) { const S = w.S >> 1, out = new ImageData(S, S), O = out.data, c0 = hx3(sh.c), cls = w.cls, lum = w.lum, sc = w.sc * 2, M = w.med, tex = sh.tex || 'canvas', pr = printCanvases(tex === 'wool' ? 'suit' : tex === 'fleece' ? 'hoodie' : tex, { c: sh.c, pc: sh.pc }), pat = sh.pat ? patTile(sh.pat, sh.pp) : null;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i0 = (y * 2) * w.S + x * 2, c = cls[i0], l = lum[i0], j = (y * S + x) * 4, q = ((y * sc) | 0) * RR + ((x * sc) | 0), X = w.BX[q], Z = w.BZ[q], Fr = w.BF[q];
        let k = c === 1 || c === 2 ? clamp(1 + (l / M.top - 1) * .75, .66, 1.3) : c === 6 || c === 7 ? clamp(1 + (l / M.pants - 1) * .5, .75, 1.2) : clamp(1 + (l / M.skin - 1) * .45, .78, 1.15);
        if (tex === 'denim') k *= .92 + .16 * (((x * 7 + y * 3) % 5) / 5); else if (tex === 'leather') k *= 1 + .1 * Math.sin(x * .9 + y * 1.3) * Math.sin(y * .7); else if (tex === 'wool') k *= ((x + y) % 9 === 0 ? 1.06 : 1);
        let cc = c0; if (pat) { const u = (((X + (Fr < 0 ? 37 : 0)) / 26 * 256) | 0) & 255, v = (((160 - Z) / 26 * 256) | 0) & 255, pj = (v * 256 + u) * 4; cc = [pat[pj], pat[pj + 1], pat[pj + 2]]; }
        lerp3(O, j, cc, k); O[j + 3] = 255;
        if (Z > 147.5) { O[j] *= .84; O[j + 1] *= .84; O[j + 2] *= .84; }   /* the collar */
        if (Fr > 25 && (c === 1 || c === 9 || c === 6) && Z > (sh.hem || 86) - 2) { const ax = Math.abs(X), gap = sh.kind === 'open' ? 4.4 : sh.kind === 'vee' ? (Z > 121 ? 1.0 + (Z - 121) * .36 : 0) : 0;   /* the front opening is cut by alpha (a straight edge, not the triangles' zigzag), with a darker facing along it */
          if (gap > 0 && ax < gap) { O[j + 3] = 0; continue; } if (gap > 0 && ax < gap + 1.1) { const ek = sh.tex === 'leather' ? 1.9 : .62; O[j] = Math.min(255, O[j] * ek); O[j + 1] = Math.min(255, O[j + 1] * ek); O[j + 2] = Math.min(255, O[j + 2] * ek); } }
        if (pr && X > -32 && X < 32 && Z > 92 && Z < 156) { const P2 = Fr >= 0 ? pr.f : pr.b, u = ((X + 32) / 64 * 256) | 0, v = ((156 - Z) / 64 * 256) | 0, pj = (v * 256 + u) * 4, a = P2[pj + 3] / 255; if (a > 0) { O[j] = O[j] * (1 - a) + P2[pj] * a; O[j + 1] = O[j + 1] * (1 - a) + P2[pj + 1] * a; O[j + 2] = O[j + 2] * (1 - a) + P2[pj + 2] * a; } } }
      return out; }
    function canvasTex(img, like) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = (like && like.anisotropy) || 8; t.flipY = like ? like.flipY : true; t.needsUpdate = true; return t; }
    /* ---- the jacket: torso / arm / hip triangles pushed out, opened down the front ('open' a zip jacket, 'vee' a suit's V to the button, 'closed' a hoodie) */
    function shellGeo(w, kind, hem) { const key = kind + ':' + hem; if (w.shells[key]) return w.shells[key]; const g = w.mesh.geometry, pos = g.attributes.position.array, nor = g.attributes.normal.array, ix = g.index.array, uv = g.attributes.uv.array, nv = pos.length / 3;
      const hk = new Map(), an = new Float32Array(nv * 3); for (let i = 0; i < nv; i++) { const k = Math.round(pos[i * 3] * 4) + ',' + Math.round(pos[i * 3 + 1] * 4) + ',' + Math.round(pos[i * 3 + 2] * 4); let a = hk.get(k); if (!a) hk.set(k, a = [0, 0, 0, []]); a[0] += nor[i * 3]; a[1] += nor[i * 3 + 1]; a[2] += nor[i * 3 + 2]; a[3].push(i); }
      for (const a of hk.values()) { const l = Math.hypot(a[0], a[1], a[2]) || 1; for (const i of a[3]) { an[i * 3] = a[0] / l; an[i * 3 + 1] = a[1] / l; an[i * 3 + 2] = a[2] / l; } }
      const P2 = new Float32Array(pos.length); for (let i = 0; i < nv; i++) { const z = pos[i * 3 + 2], arm = Math.abs(pos[i * 3]) > 19, d = (arm ? .85 : 1.15) + (z > 145 ? (z - 145) * .2 : 0) + (z < hem + 6 ? (hem + 6 - z) * .08 : 0); P2[i * 3] = pos[i * 3] + an[i * 3] * d; P2[i * 3 + 1] = pos[i * 3 + 1] + an[i * 3 + 1] * d; P2[i * 3 + 2] = z + an[i * 3 + 2] * d; }
      const keep = []; for (let t = 0; t < ix.length; t += 3) { const pc = w.tcl[t / 3]; if (pc !== 1 && pc !== 2 && pc !== 3 && pc !== 5) continue; const a = ix[t], b = ix[t + 1], c = ix[t + 2], za = pos[a * 3 + 2], zb = pos[b * 3 + 2], zc = pos[c * 3 + 2]; if (Math.min(za, zb, zc) < hem || Math.max(za, zb, zc) > 151.5) continue;
        const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, cz = (za + zb + zc) / 3, fr = -(nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1]) / 3, u = (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3, v = (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3, ti = ((((1 - v) * w.S) | 0) * w.S + ((u * w.S) | 0)), tc = w.cls[ti];
        if (pc === 1 && tc === 9) continue;   /* the neck stays bare */
        if (pc === 3) { const s = cx > 0 ? w.wr.L : w.wr.R; if (s && Math.hypot(cx - s.x, cz - s.z) < 2.6) continue; }
        keep.push(a, b, c); }
      const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(P2, 3)); for (const n of ['normal', 'uv', 'skinIndex', 'skinWeight']) sg.setAttribute(n, g.attributes[n]); sg.setIndex(keep); sg.boundingSphere = new T.Sphere(new T.Vector3(0, 0, 100), 160); return w.shells[key] = sg; }
    /* ---- rigid accessories in bind space (cm, Z up, −Y forward); zup turns a Y-up three.js primitive onto Z */
    const zup = geo => geo.rotateX(Math.PI / 2);
    function accParts(kind, o) { o = o || {}; const std = (c, r, m, x) => new T.MeshStandardMaterial(Object.assign({ color: new T.Color(c), roughness: r === undefined ? .8 : r, metalness: m || 0 }, x || {})), parts = [];
      const put = (geo, mat, f) => { if (f) f(geo); parts.push(new T.Mesh(geo, mat)); };
      if (kind === 'cap') { const m = std(o.c || '#1c2433', .82), m2 = std(o.c2 || o.c || '#1c2433', .7); put(new T.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI * .56), m, g2 => { zup(g2); g2.scale(11.3, 11.9, 11.4); g2.rotateX(-.1); g2.translate(0, 1.4, 170.8); });
        put(new T.CylinderGeometry(1, 1, 1, 24, 1, false, Math.PI / 2, Math.PI), m2, g2 => { g2.scale(9.6, .55, 8.4); g2.rotateX(-Math.PI / 2); g2.rotateX(-.26); g2.translate(0, -9.6, 171.4); }); put(new T.SphereGeometry(.9, 8, 6), m, g2 => g2.translate(0, 1.2, 182.6)); }
      else if (kind === 'bucket') { const m = std(o.c || '#cbbd97', .92); put(new T.CylinderGeometry(9.9, 10.9, 8, 26, 1, false), m, g2 => { zup(g2); g2.translate(0, 1.4, 176.6); }); put(new T.CylinderGeometry(10.9, 16.2, 3.6, 30, 1, true), std(o.c || '#cbbd97', .92, 0, { side: T.DoubleSide }), g2 => { zup(g2); g2.translate(0, 1.4, 171.1); }); put(new T.CylinderGeometry(10.95, 10.95, 2, 26, 1, true), std(o.c2 || '#5b5040', .8), g2 => { zup(g2); g2.translate(0, 1.4, 173.6); }); }
      else if (kind === 'fedora') { const m = std(o.c || '#3d3832', .9); put(new T.CylinderGeometry(8.9, 10.3, 11.5, 26, 1, false), m, g2 => { zup(g2); g2.scale(1, 1.12, 1); g2.translate(0, 1.4, 178.4); }); put(new T.CylinderGeometry(16.5, 16.5, .55, 32, 1, false), m, g2 => { zup(g2); g2.scale(1, 1.1, 1); g2.translate(0, 1.4, 173.1); }); put(new T.CylinderGeometry(10.4, 10.45, 2.6, 26, 1, true), std(o.c2 || '#15120f', .7), g2 => { zup(g2); g2.scale(1, 1.12, 1); g2.translate(0, 1.4, 174.6); }); }
      else if (kind === 'hardhat') { const m = std(o.c || '#f2c12e', .42); put(new T.SphereGeometry(1, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2), m, g2 => { zup(g2); g2.scale(12.2, 12.9, 11.2); g2.translate(0, 1.2, 171.6); }); put(new T.CylinderGeometry(13.6, 13.9, .8, 30, 1, false), m, g2 => { zup(g2); g2.scale(1, 1.08, 1); g2.translate(0, .2, 171.7); }); put(new T.BoxGeometry(1.6, 22, 1.2), m, g2 => { g2.translate(0, 1.2, 182.6); }); }
      else if (kind === 'shades') { const fr = std(o.c2 || '#121212', .35, .3), ln = std(o.c || '#0b0c10', .06, .5, { envMapIntensity: 2 }); for (const s of [-1, 1]) { put(new T.CylinderGeometry(1, 1, .32, 22), ln, g2 => { g2.scale(2.75, 1, 2.1); g2.rotateZ(s * .06); g2.translate(s * 3.35, -12.25, 168.7); }); put(new T.BoxGeometry(.38, 12.5, .55), fr, g2 => g2.translate(s * 7.15, -6.2, 169.7)); }
        put(new T.BoxGeometry(13.6, .55, .7), fr, g2 => g2.translate(0, -12.35, 170.6)); put(new T.BoxGeometry(1.6, .45, .45), fr, g2 => g2.translate(0, -12.6, 169.4)); }
      else if (kind === 'mask') { put(new T.CylinderGeometry(11.6, 9.6, 11, 20, 3, true, -1.15, 2.3), std('#a9cfe3', .95, 0, { side: T.DoubleSide }), g2 => { zup(g2); g2.translate(0, -2.6, 161.2); }); for (const s of [-1, 1]) put(new T.TorusGeometry(2.4, .14, 4, 12, Math.PI), std('#e9ecef', .9), g2 => { g2.rotateY(Math.PI / 2); g2.translate(s * 9.9, 1.2, 164); }); }
      else if (kind === 'chain') { const fy = (o.chestY || -11) - .55, by = (o.neckY || 6) + .4, f = new T.Vector3(0, fy, 140.6), bk = new T.Vector3(0, by, 151.4), c0 = f.clone().add(bk).multiplyScalar(.5), ey = bk.clone().sub(f), R = ey.length() / 2; ey.normalize();
        for (const [rw, tr, dz] of [[9.4, .5, 0], [10.2, .32, -1.6]]) { const pts = []; for (let k = 0; k < 40; k++) { const t = k / 40 * Math.PI * 2; pts.push(new T.Vector3(Math.cos(t) * rw, 0, 0).addScaledVector(ey, Math.sin(t) * (R + (dz ? 1.2 : 0))).add(c0).add(new T.Vector3(0, 0, dz))); } put(new T.TubeGeometry(new T.CatmullRomCurve3(pts, true), 64, tr, 5, true), std('#d6a72c', .24, 1)); } }
      else if (kind === 'hood') { put(new T.SphereGeometry(1, 16, 10), std(o.c || '#6d3fb8', .95), g2 => { g2.scale(9.5, 6, 6.8); g2.translate(0, 9.6, 149.5); }); put(new T.TorusGeometry(8.6, 2.1, 8, 24, Math.PI * 1.15), std(o.c || '#6d3fb8', .95), g2 => { g2.rotateZ(-Math.PI * .075); g2.rotateX(.25); g2.translate(0, 2.4, 150); }); }
      // Kai's scalp is forward of the accessory origin in the GLB bind pose (cm).
      if (['cap', 'bucket', 'fedora', 'hardhat'].includes(kind)) for (const m of parts) {
        m.geometry.scale(1.04, 1.1, 1);
        m.geometry.translate(0, -2.3, 1.4);
      }
      for (const m of parts) { m.castShadow = true; m.receiveShadow = true; m.geometry.computeBoundingSphere(); } return parts; }
    const ACCB = { cap: 'Bip01_Head', bucket: 'Bip01_Head', fedora: 'Bip01_Head', hardhat: 'Bip01_Head', shades: 'Bip01_Head', mask: 'Bip01_Head', chain: 'Bip01_Spine2', hood: 'Bip01_Neck' };
    function setAcc(it, list) { const key = JSON.stringify(list); if (it.accKey === key) return; it.accKey = key; for (const a of it.acc || []) { if (a.m.parent) a.m.parent.remove(a.m); a.m.geometry.dispose(); a.m.material.dispose(); } it.acc = [];
      const sk = it.mesh.skeleton; for (const L of list) { const bn = ACCB[L.kind]; const bi = sk.bones.findIndex(b => b.name === bn); if (bi < 0) continue;
        for (const m of accParts(L.kind, Object.assign({ chestY: it.wr ? it.wr.chestY : -11, neckY: it.wr ? it.wr.neckY : 6 }, L))) { m.matrixAutoUpdate = false; m.frustumCulled = false; m.onBeforeRender = function (r, sc, cam, geo, mat) { if (it.hideFn) { const h = !!it.hideFn(cam, mat); if (mat.colorWrite === h) { mat.colorWrite = !h; mat.depthWrite = !h; } } }; it.root.add(m); it.acc.push({ m, bone: sk.bones[bi], inv: sk.boneInverses[bi] }); } } }
    function dress(it, look) { if (!it || !look) return false; const w = wardrobe(it.id); if (!w) return false; it.wr = w; const key = JSON.stringify(look); if (it.lookKey === key) return true; it.lookKey = key;
      const bk = JSON.stringify([look.top, look.bot, look.shoe]); let tex = w.tex[bk]; if (!tex) { tex = w.tex[bk] = (look.top || look.bot || look.shoe) ? canvasTex(bodyCanvas(w, look), w.map0) : w.map0; w.texQ.push(bk); while (w.texQ.length > 5) { const old = w.texQ.shift(), t = w.tex[old]; delete w.tex[old]; if (t && t !== w.map0 && t !== (it.body || it.mesh).material.map) t.dispose(); } } else { const qi = w.texQ.indexOf(bk); if (qi >= 0) { w.texQ.splice(qi, 1); w.texQ.push(bk); } }
      const bm = it.body || it.mesh; if (bm.material.map !== tex) { bm.material.map = tex; bm.material.needsUpdate = true; }
      const sh = look.top && look.top.shell; if (sh) { const geo = shellGeo(w, sh.kind || 'open', sh.hem || 86), sk2 = JSON.stringify(sh); if (!it.shell) { const mm = new T.MeshStandardMaterial({ skinning: true, roughness: sh.r || .85, metalness: 0, side: T.DoubleSide, alphaTest: .5 }); patchCloth(mm); it.shell = new T.SkinnedMesh(geo, mm); it.shell.castShadow = it.shell.receiveShadow = true; it.shell.frustumCulled = false; it.shell.bind(bm.skeleton, bm.bindMatrix); it.shell.onBeforeRender = it.obr; bm.parent.add(it.shell); it.meshes.push(it.shell); }
        if (it.shell.geometry !== geo) it.shell.geometry = geo; if (it.shellKey !== sk2) { it.shellKey = sk2; const old = it.shell.material.map; it.shell.material.map = canvasTex(shellCanvas(w, sh), w.map0); it.shell.material.roughness = sh.r || .85; it.shell.material.needsUpdate = true; if (old) old.dispose(); } it.shell.visible = true; }
      else if (it.shell) it.shell.visible = false;
      // Tuck only the crown of the cut-out hair mesh. Keep the nape and facial detail.
      for (const m of it.meshes) {
        if (!/opacity/i.test(m.material.userData.src || '')) continue;
        const original = m.userData.looseHair || (m.userData.looseHair = m.geometry);
        if (look.hat && !m.userData.tuckedHair) {
          const fitted = original.clone(), pos = fitted.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            const z = pos.getZ(i), tuck = sm(z, 168, 175);
            pos.setXYZ(i, pos.getX(i) * (1 - .23 * tuck), pos.getY(i) * (1 - .25 * tuck), z - 2.8 * tuck);
          }
          m.userData.tuckedHair = fitted;
        }
        m.geometry = look.hat ? m.userData.tuckedHair : original;
      }
      const acc = []; if (look.hat) acc.push(Object.assign({ kind: look.hat.kind || 'cap' }, look.hat)); if (look.face === 'shades' || look.face === 'mask') acc.push({ kind: look.face }); if (look.acc === 'chain') acc.push({ kind: 'chain' }); if (look.top && look.top.hood) acc.push({ kind: 'hood', c: look.top.hood }); setAcc(it, acc); return true; }

    return { DEF, P, ST, load, ready, prime, pick, attach, off: OFF, sync, dress, wardrobe, _wr: WR };
  })();

  GT.humans = { K, U, sync, patchSkin, patchCloth, patchHair, FACES, FBY, pickFace, toneOf, bakeFace, fabric, printCanvas, anat, mdl: MDL };
  try { MDL.prime(); } catch (e) { console.warn('[humans] models', e); }
})();
