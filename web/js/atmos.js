/* atmos.js — sky, sun, time of day, lighting rig, image-based lighting and air for SUNSET HEAT.
   Exports GT.atmos = { init({scene,camera,renderer}), setTime(hours), update(dt, focusVec3), timeScale, ... } and keeps GT.env current.

   How it works
   - Sky dome: one camera-locked box drawn at the far plane. Per pixel it ray-marches a single-scattering atmosphere
     (Rayleigh + humid Mie + ozone, earth shadow) so golden hour / twilight colours come from physics, not from keyframes.
   - Cumulus: real volumetric clouds, ray-marched through a tileable 3D noise volume (generated once on the GPU), but BAKED into a
     paraboloid sky map a few rows per frame, so the per-frame cost is tiny. The map stores lighting terms (sun energy, sky visibility,
     distance, opacity); the dome relights them every frame with the current sun / sky colours, so time-lapse never needs a re-bake pop.
   - Cirrus, stars, moon (with correct phase), sun disc: analytic, per pixel.
   - The same atmosphere model is ported to JS: sun / cloud light colours, hemisphere fill, fog colours and GT.env all come from it.
   - Fog: THREE's fog chunks are patched (globally, at script load) so fog colour depends on view direction (glows toward the sun,
     pink/blue opposite) and is tone-mapped/encoded like everything else. Plain fog is used when the extra uniforms are absent. */
(function () {
  'use strict';
  const T = THREE, GT = window.GT = window.GT || {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const DEG = Math.PI / 180;
  /** piecewise-linear curve through [[x,y],...] */
  const curve = (k, x) => { if (x <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (x <= k[i][0]) return lerp(k[i - 1][1], k[i][1], (x - k[i - 1][0]) / (k[i][0] - k[i - 1][0])); return k[k.length - 1][1]; };

  /* ================================================================== direction-aware fog (patches THREE.ShaderChunk once) */
  const fogSun = new Float32Array(3), fogSunCol = new Float32Array(3), fogOppCol = new Float32Array(3), fogH = new Float32Array(4), fogZenCol = new Float32Array(3);   // shared BY REFERENCE by every material (typed arrays survive UniformsUtils.clone)
  (function patchFog() {
    if (T.ShaderChunk.__gtFog) return; T.ShaderChunk.__gtFog = true;
    T.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float fogDepth;\n\tvarying vec3 vGtFogDir;\n#endif';
    T.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tfogDepth = - mvPosition.z;\n\tvGtFogDir = mvPosition.xyz * mat3( viewMatrix );\n#endif';
    T.ShaderChunk.fog_pars_fragment = ['#ifdef USE_FOG', '\tuniform vec3 fogColor;', '\tvarying float fogDepth;', '\tvarying vec3 vGtFogDir;', '\tuniform vec3 gtFogSun;', '\tuniform vec3 gtFogSunCol;', '\tuniform vec3 gtFogOppCol;', '\tuniform vec4 gtFogH;', '\tuniform vec3 gtFogZenCol;',
      '\t#ifdef FOG_EXP2', '\t\tuniform float fogDensity;', '\t#else', '\t\tuniform float fogNear;', '\t\tuniform float fogFar;', '\t#endif', '#endif'].join('\n');
    /* gtFogH = ( camera height, 1 / scale height, floor, on ): the haze thins with height, so the feet of far towers melt first and their tops keep their own light and shade. All zero (uniform absent) = plain fog. */
    T.ShaderChunk.fog_fragment = ['#ifdef USE_FOG', '\tfloat gtFogD = fogDepth;',
      '\tif ( gtFogH.w > 0.5 ) { float gtY = clamp( vGtFogDir.y * gtFogH.y, -1.5, 30.0 ); float gtMean = abs( gtY ) > 1e-3 ? ( 1.0 - exp( - gtY ) ) / gtY : 1.0; gtFogD *= gtFogH.z + ( 1.0 - gtFogH.z ) * min( gtMean * exp( - max( gtFogH.x, 0.0 ) * gtFogH.y ), 1.6 ); }',
      '\t#ifdef FOG_EXP2', '\t\tfloat fogFactor = 1.0 - exp( - fogDensity * fogDensity * gtFogD * gtFogD );', '\t#else', '\t\tfloat fogFactor = smoothstep( fogNear, fogFar, gtFogD );', '\t#endif',
      '\tvec3 gtFogC = fogColor;',
      '\tif ( dot( gtFogSun, gtFogSun ) > 0.5 ) {',
      '\t\tvec3 gtDn = normalize( vGtFogDir ); float gtM = dot( gtDn, gtFogSun ); float gtA = max( gtM, 0.0 ); float gtB = max( - gtM, 0.0 ); gtA *= gtA; gtA *= gtA * gtA;',
      '\t\tgtFogC += ( gtFogSunCol - fogColor ) * gtA + ( gtFogOppCol - fogColor ) * gtB * gtB;',
      '\t\tgtFogC = mix( gtFogC, gtFogZenCol, gtFogH.w * 0.6 * smoothstep( 0.04, 0.45, gtDn.y ) );',
      '\t\t#if defined( TONE_MAPPING )', '\t\t\tgtFogC = toneMapping( gtFogC );', '\t\t#endif',
      '\t\tgtFogC = linearToOutputTexel( vec4( gtFogC, 1.0 ) ).rgb;',
      '\t}',
      '\tgl_FragColor.rgb = mix( gl_FragColor.rgb, gtFogC, fogFactor );', '#endif'].join('\n');
    const add = u => { if (u && u.fogColor) { u.gtFogSun = { value: fogSun }; u.gtFogSunCol = { value: fogSunCol }; u.gtFogOppCol = { value: fogOppCol }; u.gtFogH = { value: fogH }; u.gtFogZenCol = { value: fogZenCol }; } };
    add(T.UniformsLib.fog); for (const k in T.ShaderLib) add(T.ShaderLib[k].uniforms);
  })();

  /* ================================================================== atmosphere model (km). Mirrored in GLSL below — keep in sync. */
  const RE = 6360, RA = 6420, HR = 8.0, HM = 1.2, MIE = 1.25;                       // MIE: humid coastal haze multiplier
  const BR = [5.8e-3, 13.5e-3, 33.1e-3], BM = 21e-3 * MIE, BME = BM * 1.11, BO = [0.65e-3, 1.881e-3, 0.085e-3], GM = 0.76;
  const ESUN = 10;                                                                   // sun irradiance in scene units (white sunlit surface = ESUN/PI * transmittance)
  const NV = 14, NL = 5;
  const ozone = h => Math.max(0, 1 - Math.abs(h - 25) / 15);
  const _od = [0, 0, 0];
  function odToSun(px, py, pz, s, n) {
    const b = px * s.x + py * s.y + pz * s.z, c = px * px + py * py + pz * pz - RA * RA, tl = -b + Math.sqrt(Math.max(b * b - c, 0)); let r = 0, m = 0, o = 0;
    for (let j = 0; j < n; j++) { const v = (j + .5) / n, tt = tl * v * v, dtt = tl * 2 * v / n, x = px + s.x * tt, y = py + s.y * tt, z = pz + s.z * tt, hl = Math.sqrt(x * x + y * y + z * z) - RE;
      r += Math.exp(Math.min(-hl / HR, 30)) * dtt; m += Math.exp(Math.min(-hl / HM, 30)) * dtt; o += ozone(hl) * dtt; }
    _od[0] = r; _od[1] = m; _od[2] = o; return _od;
  }
  /** transmittance from a point hKm above ground toward direction s -> [r,g,b] */
  function transmit(hKm, s, out) { const o = odToSun(0, RE + hKm, 0, s, 40); for (let k = 0; k < 3; k++) out[k] = Math.exp(-(BR[k] * o[0] + BME * o[1] + BO[k] * o[2])); return out; }
  /** single-scattering sky radiance toward (dx,dy,dz) for sun s. sunI scales the sun, ms = isotropic multi-scatter irradiance. */
  function skyRad(dx, dy, dz, s, sunI, ms, out) {
    dy = Math.max(dy, 0.002); const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const roy = RE + .02, b = roy * dy, tmax = -b + Math.sqrt(Math.max(b * b - (roy * roy - RA * RA), 0));
    let oR = 0, oM = 0, oO = 0; const sR = [0, 0, 0], sM = [0, 0, 0], sS = [0, 0, 0];
    for (let i = 0; i < NV; i++) { const u = (i + .5) / NV, t = tmax * u * u, dt = tmax * 2 * u / NV, px = dx * t, py = roy + dy * t, pz = dz * t, h = Math.sqrt(px * px + py * py + pz * pz) - RE;
      const dR = Math.exp(-h / HR) * dt, dM = Math.exp(-h / HM) * dt, dO = ozone(h) * dt; oR += dR; oM += dM; oO += dO;
      const ol = odToSun(px, py, pz, s, NL);
      for (let k = 0; k < 3; k++) { const att = Math.exp(-(BR[k] * (oR + ol[0]) + BME * (oM + ol[1]) + BO[k] * (oO + ol[2]))); sR[k] += dR * att; sM[k] += dM * att;
        sS[k] += (BR[k] * dR + BM * dM) * Math.exp(-(BR[k] * oR + BME * oM + BO[k] * oO)); } }
    const mu = dx * s.x + dy * s.y + dz * s.z, pR = 3 / (16 * Math.PI) * (1 + mu * mu), g2 = GM * GM, pM = 3 / (8 * Math.PI) * ((1 - g2) * (1 + mu * mu)) / ((2 + g2) * Math.pow(1 + g2 - 2 * GM * mu, 1.5));
    for (let k = 0; k < 3; k++) out[k] = sunI * (pR * BR[k] * sR[k] + pM * BM * sM[k]) + ms[k] * sS[k];
    return out;
  }

  /* ================================================================== GLSL */
  const GL_ATMOS = `
const float RE=6360.0, RA=6420.0, HR=8.0, HM=1.2;
const vec3 BR=vec3(5.8e-3,13.5e-3,33.1e-3), BO=vec3(0.65e-3,1.881e-3,0.085e-3);
const float BM=${BM.toFixed(6)}, BME=${BME.toFixed(6)}, GM=${GM.toFixed(3)};
float ozoneD(float h){ return max(0.0, 1.0-abs(h-25.0)/15.0); }
vec3 atmosphere(vec3 rd, vec3 sun, float sunI, vec3 ms){
  vec3 ro=vec3(0.0,RE+0.02,0.0);
  float b=dot(ro,rd); float tmax=-b+sqrt(max(b*b-(dot(ro,ro)-RA*RA),0.0));
  vec3 sumR=vec3(0.0), sumM=vec3(0.0), sumS=vec3(0.0), od=vec3(0.0);
  for(int i=0;i<${NV};i++){
    float u=(float(i)+0.5)/${NV}.0; float t=tmax*u*u; float dt=tmax*2.0*u/${NV}.0;
    vec3 p=ro+rd*t; float h=length(p)-RE;
    vec3 d=vec3(exp(-h/HR),exp(-h/HM),ozoneD(h))*dt; od+=d;
    float bl=dot(p,sun); float tl=-bl+sqrt(max(bl*bl-(dot(p,p)-RA*RA),0.0));
    vec3 odl=vec3(0.0);
    for(int j=0;j<${NL};j++){ float v=(float(j)+0.5)/${NL}.0; float tt=tl*v*v; float dtt=tl*2.0*v/${NL}.0; float hl=length(p+sun*tt)-RE;
      odl+=vec3(exp(min(-hl/HR,30.0)),exp(min(-hl/HM,30.0)),ozoneD(hl))*dtt; }
    vec3 att=exp(-(BR*(od.x+odl.x)+BME*(od.y+odl.y)+BO*(od.z+odl.z)));
    sumR+=d.x*att; sumM+=d.y*att;
    sumS+=(BR*d.x+BM*d.y)*exp(-(BR*od.x+BME*od.y+BO*od.z));
  }
  float mu=dot(rd,sun); float pR=0.0596831*(1.0+mu*mu); float g2=GM*GM;
  float pM=0.1193662*((1.0-g2)*(1.0+mu*mu))/((2.0+g2)*pow(1.0+g2-2.0*GM*mu,1.5));
  return sunI*(pR*BR*sumR+pM*BM*sumM)+ms*sumS;
}`;
  const GL_HASH = `
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash13(vec3 p3){ p3=fract(p3*0.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
vec3 hash33(vec3 p3){ p3=fract(p3*vec3(0.1031,0.1030,0.0973)); p3+=dot(p3,p3.yxz+33.33); return fract((p3.xxy+p3.yxx)*p3.zyx); }`;
  const PSCALE = 1.03, TMAXKM = 85, HB = 0.95, HT = 5.4;

  const SKY_VERT = `
varying vec3 vDir;
void main(){ vDir=position; vec4 p=viewMatrix*vec4(position,0.0); gl_Position=projectionMatrix*vec4(p.xyz,1.0); gl_Position.z=gl_Position.w; }`;
  const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 uSun; uniform float uSunI; uniform vec3 uMs; uniform vec3 uDisc;
uniform vec3 uMoon; uniform vec3 uMoonCol; uniform vec3 uMoonLit; uniform float uNightF;
uniform vec3 uNightZen; uniform vec3 uNightHor; uniform vec3 uCity; uniform vec3 uBelt;
uniform vec3 uTwZ; uniform vec3 uTwH; uniform vec3 uTwS; uniform vec3 uTwM;
uniform sampler2D uCloudA; uniform sampler2D uCloudB; uniform float uCloudMix; uniform float uCloudOn;
uniform vec3 uKey; uniform vec3 uCloudSun; uniform vec3 uCloudAmb; uniform vec3 uCloudBase; uniform float uVis; uniform float uSilver;
uniform vec3 uCirSun; uniform vec3 uCirAmb; uniform vec2 uCirOff; uniform float uCirCover;
uniform vec3 uFog; uniform vec3 uFogSun; uniform vec3 uFogOpp; uniform vec3 uFogDir; uniform vec3 uGround;
uniform float uEnv; uniform float uEnvK; uniform float uSkyLift; uniform float uTime; uniform float uTwi; uniform float uLook; uniform float uG6; uniform float uLowK; uniform float uDusk; uniform float uLookN; uniform float uOver; uniform vec3 uOverCol;
${GL_HASH}
${GL_ATMOS}
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1.0,0.0)),f.x), mix(hash12(i+vec2(0.0,1.0)),hash12(i+vec2(1.0,1.0)),f.x), f.y); }
float fbm2(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=mat2(1.6,1.2,-1.2,1.6)*p+17.3; a*=0.5; } return s; }
float fbm3(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<3;i++){ s+=a*vnoise(p); p=mat2(1.6,1.2,-1.2,1.6)*p+17.3; a*=0.5; } return s/0.875; }
// art-directed sunset / twilight layer on top of the physical single scattering (which lacks the multiple scattering that keeps real dusk bright and blue)
vec3 twilight(vec3 ds){ float y=ds.y; float w=0.5+0.5*dot(normalize(ds.xz+vec2(1e-5,0.0)),uFogDir.xz); float w3=w*w*w;
  vec3 c=uTwZ+(uTwH-uTwZ)*exp(-y*5.0);
  c+=uTwS*pow(vec3(exp(-y*(11.0-4.5*w3))*(0.03+0.97*w3*w)),vec3(1.0,0.74,0.52));   /* the orange stays around the sun's azimuth, and green / blue fall off more slowly than red: the glow fades through yellow and pale grey into the blue instead of through magenta */
  c+=uTwM*exp(-pow((y-0.06-0.06*w)/0.075,2.0))*(0.25+0.75*w*w);
  return c; }
vec3 stars(vec3 d){
  vec3 p=d*150.0; vec3 id=floor(p); vec3 h=hash33(id); vec3 sp=id+0.18+0.64*h; vec3 sd=normalize(sp);
  float c=max(2.0*(1.0-dot(sd,d)),0.0);                       // ~angle^2
  float u=hash13(id+7.31); float m=pow(smoothstep(0.990,1.0,u),2.0)+0.035*smoothstep(0.93,1.0,u);
  float r=0.00062*(0.85+0.5*h.x); float f=exp(-c/(r*r));
  float shell=smoothstep(0.55,0.25,abs(length(sp)-150.0));
  float tw=0.8+0.2*sin(uTime*(2.0+3.0*h.y)+h.z*40.0);
  vec3 tint=mix(vec3(0.75,0.85,1.0),vec3(1.0,0.85,0.65),h.y*h.y);
  return tint*(m*f*shell*tw*6.0);
}
void main(){
  vec3 d=normalize(vDir);
  vec3 ds=normalize(vec3(d.x,max(d.y,0.0015),d.z));
  vec3 sky=atmosphere(ds,uSun,uSunI,uMs);
  float y=ds.y; float mu=dot(ds,uSun);
  sky+=twilight(ds);
  sky+=mix(uNightHor,uNightZen,pow(y,0.42));
  sky+=uCity*exp(-y*6.5)*(0.5+0.5*smoothstep(-0.7,0.8,d.x));
  sky+=uBelt*exp(-pow((y-0.105)/0.075,2.0))*smoothstep(0.15,-0.75,mu);
  sky/=1.0+0.22*dot(sky,vec3(0.2126,0.7152,0.0722));          // soft shoulder: keeps colour in the aureole instead of clipping to white
  /* g6 r2: the clear-sky gradient itself goes to a real blue before the clouds are laid over it (pale blue-white at the horizon, deep blue overhead); the aureole round the sun stays white */
  if(uG6>0.001&&uEnv<0.5){ float ly0=dot(sky,vec3(0.2126,0.7152,0.0722)); float yy0=clamp(ds.y,0.0,1.0); vec3 pd=mix(vec3(0.60,0.94,1.46),vec3(0.27,0.74,1.92),smoothstep(0.02,0.42,yy0)); float nearSun=pow(max(mu,0.0),10.0); sky=mix(sky,ly0*pd*mix(1.0,0.86,smoothstep(0.05,0.6,yy0)),0.76*uG6*(1.0-0.85*nearSun)); }
  /* g6 r4: at a low sun the aureole took half the sky and clipped to white under an exposure set by the shaded ground; fold it down and keep it orange -> pink, so the gradient and the lit clouds survive */
  { float lowS=smoothstep(0.34,0.06,uSun.y)*smoothstep(-0.06,0.0,uSun.y); float m0=max(mu,0.0); float nearA=m0*m0*m0; float lyA=dot(sky,vec3(0.2126,0.7152,0.0722)); sky/=1.0+uLowK*lyA*lowS*nearA; lyA=dot(sky,vec3(0.2126,0.7152,0.0722)); vec3 warmA=mix(vec3(1.32,0.74,0.62),vec3(1.4,0.86,0.42),pow(m0,6.0)); sky=mix(sky,lyA*warmA,0.55*lowS*m0*m0*(1.0-uEnv)); }
  vec3 col=sky; float above=smoothstep(-0.002,0.004,d.y);

  // ---- things behind the clouds: stars, moon, sun disc
  vec3 back=vec3(0.0);
  if(uNightF>0.01&&d.y>0.0) back+=stars(d)*uNightF*smoothstep(0.03,0.35,d.y);
  { // moon with real phase
    vec3 mr=normalize(cross(vec3(0.0,1.0,0.0),uMoon)); vec3 mup=cross(uMoon,mr); float RM=0.0155;
    vec2 q=vec2(dot(d,mr),dot(d,mup))/RM; float r2=dot(q,q);
    if(r2<1.2&&dot(d,uMoon)>0.0){
      float z=sqrt(max(1.0-r2,0.0)); vec3 n=normalize(q.x*mr+q.y*mup-z*uMoon);
      float lit=smoothstep(-0.02,0.22,dot(n,uMoonLit));
      float maria=fbm2(q*2.3+4.0); float alb=mix(0.55,1.0,smoothstep(0.35,0.62,maria))*(0.85+0.3*vnoise(q*9.0));
      float edge=smoothstep(1.0,0.93,sqrt(r2));
      back+=uMoonCol*(lit*alb*(0.55+0.45*z)+0.004)*edge*4.0;
    }
    float ma=max(2.0*(1.0-dot(d,uMoon)),0.0);
    col+=uMoonCol*(0.035*exp(-ma*90.0)+0.012*exp(-ma*9.0))*above;
  }
  { // sun disc + hot core
    float ang=sqrt(max(2.0*(1.0-dot(d,uSun)),0.0)); float RS=0.0078;
    float disc=smoothstep(RS*1.06,RS*0.9,ang); float limb=pow(max(1.0-ang*ang/(RS*RS*1.14),0.0),0.3);
    back+=uDisc*disc*(0.45+0.55*limb)*above*mix(1.0,0.06,uEnv);
    col+=uDisc*(0.010*exp(-ang*48.0)+0.0022*exp(-ang*11.0))*above;
  }

  // ---- cirrus (thin, high, analytic)
  float covC=0.0;
  if(d.y>0.0&&uCirCover>0.001){
    float hc=9.5; float bq=RE*ds.y; float t=-bq+sqrt(bq*bq+2.0*RE*hc+hc*hc);
    vec2 p=ds.xz*t/11.0+uCirOff;
    vec2 w=vec2(fbm3(p*0.35+3.1),fbm3(p*0.35+9.7))-0.5;
    vec2 q=mat2(0.88,0.48,-0.48,0.88)*(p+w*0.55);
    float cpatch=smoothstep(0.50,0.80,fbm3(p*0.13+11.0)+(uCirCover-0.5)*0.7);
    float body=fbm2(vec2(q.x*0.7,q.y*1.8));
    float f1=fbm2(vec2(q.x*1.3,q.y*7.0)+w*2.0), f2=fbm2(vec2(q.x*3.5,q.y*19.0)+w*3.0+7.0);
    float fib=(1.0-abs(2.0*f1-1.0))*0.6+(1.0-abs(2.0*f2-1.0))*0.4;
    float f3=fbm3(vec2(q.x*9.0,q.y*52.0)+w*4.0+3.0)-0.5;
    float v=body+(fib-0.62)*0.75+f3*0.22*smoothstep(70.0,18.0,t);
    float dC=cpatch*smoothstep(0.46,0.84,v+cpatch*0.1)*(0.55+0.45*fib);
    dC*=smoothstep(0.015,0.14,ds.y);
    float fwd=pow(max(dot(ds,uSun),0.0),6.0);
    vec3 cc=uCirSun*(0.55+1.6*fwd)+uCirAmb;
    float fa=1.0-exp(-t/260.0);
    covC=dC*0.6;
    col=mix(col,mix(cc,sky,fa*0.85),covC);
  }
  col+=back*(1.0-covC*0.75);

  // ---- cumulus (baked volumetric lighting terms, relit here)
  if(uCloudOn>0.5&&d.y>-0.012){
    vec2 cuv=d.xz/(1.0+d.y)/${PSCALE.toFixed(3)}*0.5+0.5;
    vec4 c=mix(texture2D(uCloudA,cuv),texture2D(uCloudB,cuv),uCloudMix);
    float a=c.a; float dist=c.b*c.b*${TMAXKM.toFixed(1)};
    float fwd=pow(max(dot(d,uKey),0.0),9.0);
    vec3 cc=uCloudSun*c.r*(1.0+uSilver*fwd*(1.0-a))+uCloudAmb*c.g+uCloudBase*max(a-c.g,0.0);
    float f=1.0-exp(-dist/uVis);
    cc=mix(cc,sky*a,f*0.94);
    col=(sky+(col-sky)*(1.0-a)*(1.0-a))*(1.0-a)+cc;     // sun disc / moon die quickly behind cloud
  }

  /* 霓虹江城 look: by day the dome runs from a white-orange horizon to a pale teal zenith (luminance kept, so the physics still drives brightness); in rain the whole dome closes to an overcast lid in the fog colour */
  if(uLook>0.001){ float ly=dot(col,vec3(0.2126,0.7152,0.0722)); vec3 lg=mix(vec3(1.34,0.99,0.70),vec3(0.70,1.045,1.10),pow(clamp(d.y*1.3,0.0,1.0),0.5)); col=mix(col,ly*lg*(1.55+0.85*exp(-max(d.y,0.0)*3.2)),uLook); }   /* b5: the dome was drawn at its physical luminance and read grey-olive (overcast) at noon; it is lifted so the horizon is white-orange and the zenith a pale cyan */
  /* g6 阳光江城: by day the blue is deeper toward the zenith and more saturated (clouds stay white); at golden hour the dome runs orange at the horizon -> pink -> lavender-blue overhead, bluer away from the sun. Luminance stays physical. */
  if(uG6>0.001){ float ly=dot(col,vec3(0.2126,0.7152,0.0722)); float yy=clamp(d.y,0.0,1.0); float g6=uG6*(1.0-uEnv);   /* not in the image-based light: a saturated dome painted every shaded road blue */
    col=max(mix(vec3(ly),col,1.0+0.18*g6),0.0); col=mix(col,ly*vec3(0.97,1.0,1.04),0.45*uG6*uEnv); }
  if(uDusk>0.001){ float ly=dot(col,vec3(0.2126,0.7152,0.0722)); float yy=clamp(d.y,0.0,1.0);
    float ws=0.5+0.5*dot(normalize(d.xz+vec2(1e-5,0.0)),normalize(uSun.xz+vec2(1e-5,0.0)));
    vec3 pal=mix(vec3(1.38,0.82,0.42),vec3(1.34,0.66,0.74),smoothstep(0.03,0.22,yy)); pal=mix(pal,vec3(0.80,0.74,1.42),smoothstep(0.2,0.62,yy));
    pal=mix(mix(pal,vec3(0.74,0.80,1.40),0.6),pal,ws*ws);
    float keep=smoothstep(0.990,0.9995,dot(d,uSun));
    col=mix(col,ly*pal,uDusk*0.78*(1.0-keep));
    { float mu6=pow(max(dot(d,uSun),0.0),2.6); float l2=dot(col,vec3(0.2126,0.7152,0.0722)); col*=mix(1.0,(1.0-keep)*0.42/(0.42+0.58*smoothstep(0.0,1.6,l2))+keep,uDusk*mu6*(1.0-uEnv)); col+=uDisc*keep*0.25*uDusk*smoothstep(-0.002,0.004,d.y)*(1.0-uEnv); } }   /* r2: the low sun is a disc in an orange band, not a white blow-out that eats the skyline */
  if(uOver>0.001){ float oy=clamp(d.y,0.0,1.0); vec3 oc=uOverCol*(0.7+0.6*exp(-oy*5.0))*(0.86+0.28*fbm3(d.xz/(0.3+oy)*1.3+uCirOff)); col=mix(col,oc,uOver*(0.5+0.45*above)); }
  // ---- below the horizon: the same directional haze colour the fog uses, so distant geometry melts into it
  float fm=dot(normalize(vec3(d.x,0.0,d.z)+vec3(1e-5,0.0,0.0)),uFogDir); float fa=max(fm,0.0), fb=max(-fm,0.0); fa*=fa; fa*=fa*fa;
  vec3 haze=uFog+(uFogSun-uFog)*fa+(uFogOpp-uFog)*fb*fb;
  col=mix(col,haze,smoothstep(0.012,-0.012,d.y));
  if(uSkyLift>0.001 && uEnv<0.5){ float yk=smoothstep(0.02,0.55,d.y); float lq=dot(col,vec3(0.2126,0.7152,0.0722)); col=mix(col,lq*vec3(0.78,0.94,1.2),0.22*uSkyLift*yk)*(1.0+1.15*uSkyLift*yk); }   /* LT: the GTA6 day sky is a lighter, slightly hazier blue than the single-scattering model gives; the upper sky is lifted and a little less saturated (horizon untouched) */
  if(uEnv>0.5){ col*=uEnvK;   /* g6 r3: by day the sky as image-based light is turned down, it filled every shadow (sunlit and shaded ground were 1.6 : 1) */ col=mix(col,uGround,smoothstep(-0.005,-0.11,d.y)); col=mix(col,dot(col,vec3(0.2126,0.7152,0.0722))*vec3(0.92,1.0,1.10),0.62*uTwi); col*=1.0-0.35*uTwi*(1.0-uNightF); col*=mix(1.0,0.5,uNightF*uLookN); }   /* image-based light after sunset: neutral blue-grey, not the magenta of the sky */

  // ---- dither (pre-tonemap, scaled to survive the sRGB curve) : kills banding in the long gradients
  float n1=hash12(gl_FragCoord.xy+fract(uTime)*61.0), n2=hash12(gl_FragCoord.yx*1.31+17.0+fract(uTime)*37.0);
  col+=(n1+n2-1.0)*(0.011*col+0.00035);
  gl_FragColor=vec4(max(col,0.0),1.0);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;

  /* tileable 3D noise volume, rendered as an 8x8 atlas of 64x64 slices then read back into a DataTexture3D.
     R: perlin-worley (cloud shapes)  G: worley fbm high (erosion)  B: worley fbm low (tower map)  A: perlin fbm low (coverage map) */
  const NOISE_FRAG = `
${GL_HASH}
float gnoise(vec3 p,float per){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  #define GG(o) dot(hash33(mod(i+o,per))*2.0-1.0,f-o)
  return mix(mix(mix(GG(vec3(0.0,0.0,0.0)),GG(vec3(1.0,0.0,0.0)),u.x),mix(GG(vec3(0.0,1.0,0.0)),GG(vec3(1.0,1.0,0.0)),u.x),u.y),
             mix(mix(GG(vec3(0.0,0.0,1.0)),GG(vec3(1.0,0.0,1.0)),u.x),mix(GG(vec3(0.0,1.0,1.0)),GG(vec3(1.0,1.0,1.0)),u.x),u.y),u.z); }
float worley(vec3 p,float per){ vec3 i=floor(p), f=fract(p); float dm=1.0;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){ vec3 o=vec3(float(x),float(y),float(z)); vec3 r=o+hash33(mod(i+o,per)+per*0.37)-f; dm=min(dm,dot(r,r)); }
  return 1.0-min(sqrt(dm),1.0); }
float pfbm(vec3 p,float f){ return gnoise(p*f,f)*0.5+gnoise(p*f*2.0,f*2.0)*0.25+gnoise(p*f*4.0,f*4.0)*0.125+gnoise(p*f*8.0,f*8.0)*0.0625; }
float wfbm(vec3 p,float f){ return worley(p*f,f)*0.625+worley(p*f*2.0,f*2.0)*0.25+worley(p*f*4.0,f*4.0)*0.125; }
void main(){
  vec2 fc=floor(gl_FragCoord.xy); vec2 tile=floor(fc/64.0); vec3 p=(vec3(mod(fc,64.0),tile.y*8.0+tile.x)+0.5)/64.0;
  float pn=clamp(pfbm(p,4.0)*1.15+0.5,0.0,1.0); float w=wfbm(p,4.0);
  float pw=w+pn*(1.0-w);
  gl_FragColor=vec4(pw, wfbm(p,6.0), wfbm(p,2.0), clamp(pfbm(p,2.0)*1.25+0.5,0.0,1.0));
}`;
  const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }';
  const BAKE_FRAG = `
precision highp sampler3D;
varying vec2 vUv;
uniform sampler3D uNoise; uniform vec3 uLight; uniform vec2 uWind; uniform float uEvolve; uniform float uCover; uniform vec2 uSeed; uniform vec2 uGap;
${GL_HASH}
const float RE=6360.0, HB=${HB.toFixed(2)}, HT=${HT.toFixed(2)}, TMAX=${TMAXKM.toFixed(1)}, SIG=42.0;
const vec4 HERO[7]=vec4[7](vec4(-13.5,13.0,3.4,1.0),vec4(-18.0,-5.5,3.0,0.8),vec4(17.0,5.0,3.8,1.0),vec4(12.0,-13.0,3.0,0.7),vec4(3.0,19.0,3.2,0.85),vec4(-4.0,-21.0,3.4,0.9),vec4(-30.0,-17.0,4.5,1.0));   // x,z km, radius km, height 0..1
// p = (x km, height above ground km, z km)
float density(vec3 p, float lod){
  float hf=(p.y-HB)/(HT-HB); if(hf<=0.0||hf>=1.0) return 0.0;
  vec2 q=p.xz+uWind+uSeed; float dist=length(p.xz);
  float cm=texture(uNoise,vec3(q/43.0,0.31)).a*0.7+texture(uNoise,vec3(q.yx/19.0+0.4,0.63)).a*0.3;     // cluster map
  float cl=smoothstep(0.43,0.6,cm+(uCover-0.5)*0.35)*mix(0.62,1.0,smoothstep(2.0,16.0,dist));
  // art direction: keep a window open around the sunset azimuth so the low sun is not buried in the distant cloud bank
  vec2 dh=p.xz/max(dist,0.001); cl*=1.0-0.92*smoothstep(0.93,0.985,dot(dh,uGap))*smoothstep(4.0,9.0,dist);
  float tm=smoothstep(0.5,0.86,texture(uNoise,vec3(q/23.0+0.11,0.83)).b)*cl;                             // towers sit on worley feature points
  vec2 qh=p.xz+uWind;
  for(int i=0;i<7;i++){ vec4 hc=HERO[i]; vec2 dq=qh-hc.xy; float g=exp(-dot(dq,dq)/(hc.z*hc.z)); cl=max(cl,smoothstep(0.08,0.5,g)); tm=max(tm,g*hc.w); }   // hero towers
  if(cl<=0.001) return 0.0;
  float topH=mix(0.14,1.0,tm)*mix(0.75,1.0,cm);
  float prof=smoothstep(0.0,0.035,hf)*(1.0-smoothstep(topH*0.42,topH,hf));
  if(prof<=0.001) return 0.0;
  vec3 sp=vec3(q.x,p.y*1.15,q.y)/6.3+vec3(0.0,uEvolve,0.0);
  float s=texture(uNoise,sp).r*0.7+texture(uNoise,sp.zyx*2.9+0.37).r*0.3;
  float thr=mix(0.93,0.60,cl)-(lod>1.5?0.09:0.0);
  float v=s+(prof-1.0)*0.42;
  if(v<thr-0.1) return 0.0;
  float det=0.45;
  if(lod<0.5){
    det=texture(uNoise,vec3(q.x,p.y,q.y)/3.0+vec3(uEvolve*3.0,0.0,0.19)).g;
    float near=smoothstep(9.0,2.5,dist); if(near>0.0) det=mix(det,det*0.55+texture(uNoise,vec3(q.y,p.y,q.x)/0.77+0.23).g*0.5,near);   // finer billows on the clouds close enough to resolve them
  }
  float d=clamp((v-(det-0.45)*0.22-thr)*11.0,0.0,1.0);                // erosion displaces the surface -> cauliflower lobes
  if(d<=0.0) return 0.0;
  return d*mix(0.55,1.0,smoothstep(0.0,0.3,hf));
}
void main(){
  vec2 uv=(vUv*2.0-1.0)*${PSCALE.toFixed(3)}; float r2=dot(uv,uv);
  vec3 rd=vec3(2.0*uv.x,1.0-r2,2.0*uv.y)/(1.0+r2);
  if(rd.y<-0.014){ gl_FragColor=vec4(0.0); return; }
  rd=normalize(vec3(rd.x,max(rd.y,0.0035),rd.z));
  float b=RE*rd.y;
  float t0=-b+sqrt(b*b+2.0*RE*HB+HB*HB), t1=min(-b+sqrt(b*b+2.0*RE*HT+HT*HT),TMAX);
  vec4 o=vec4(0.0);
  if(t1>t0){
    const int NC=72, NF=6;                                             // coarse probes; each occupied segment is refined into NF lit samples
    float dtc=(t1-t0)/float(NC), dt=dtc/float(NF); float jit=hash12(gl_FragCoord.xy+uSeed*7.0);
    float Tr=1.0, R=0.0, G=0.0, ds=0.0, ws=0.0;
    for(int i=0;i<NC;i++){
      float tc=t0+float(i)*dtc; vec3 wa=vec3(0.0,RE,0.0)+rd*(tc+dtc*0.25), wb=vec3(0.0,RE,0.0)+rd*(tc+dtc*0.75);
      if(density(vec3(wa.x,length(wa)-RE,wa.z),2.0)+density(vec3(wb.x,length(wb)-RE,wb.z),2.0)<=0.0) continue;
      for(int k=0;k<NF;k++){
        float t=tc+(float(k)+jit)*dt; vec3 w=vec3(0.0,RE,0.0)+rd*t; vec3 p=vec3(w.x,length(w)-RE,w.z);
        float dn=density(p,0.0)*(1.0-smoothstep(TMAX*0.72,TMAX,t));
        if(dn>0.002){
          float tau=0.0, ls=0.07; vec3 lp=p;
          for(int j=0;j<6;j++){ lp+=uLight*ls; tau+=density(lp,j<2?0.0:1.0)*ls; ls*=1.75; }
          tau*=SIG;
          float e=max(exp(-tau),0.38*exp(-tau*0.16));                      // beer + cheap multiple scattering
          e*=mix(0.55,1.0,1.0-exp(-dn*SIG*0.11));                        // powder: thin wisps are a touch darker than cores facing the sun
          float hf=(p.y-HB)/(HT-HB);
          float amb=mix(0.3,1.0,smoothstep(0.0,0.2,hf))*exp(-density(p+vec3(0.0,0.22,0.0),1.0)*1.6);
          float a=1.0-exp(-SIG*dn*dt); float wgt=Tr*a;
          R+=wgt*e; G+=wgt*amb; ds+=wgt*t; ws+=wgt; Tr*=1.0-a;
        }
      }
      if(Tr<0.012){ Tr=0.0; break; }
    }
    float al=1.0-Tr;
    if(ws>0.0){ float k=al/ws; o=vec4(R*k,G*k,sqrt(clamp(ds/ws/TMAX,0.0,1.0)),al); }
  }
  o+=(hash12(gl_FragCoord.yx+3.7)-0.5)/255.0*step(0.001,o.a);
  gl_FragColor=o;
}`;

  /* ================================================================== module state */
  const A = {};                         // internal handles
  const env = GT.env = GT.env || {}; if (!env.sunDir) env.sunDir = new T.Vector3(-.8, .3, .2).normalize(); if (!env.sunColor) env.sunColor = new T.Color(1, .75, .5);
  env.skyColor = new T.Color(.3, .4, .6); env.horizonColor = new T.Color(.8, .6, .45); env.fogColor = new T.Color(.7, .6, .5); env.groundColor = new T.Color(.1, .09, .08); env.fogSunColor = new T.Color(.7, .6, .5); env.fogOppColor = new T.Color(.7, .6, .5);
  env.trueSunDir = new T.Vector3().copy(env.sunDir); env.moonDir = new T.Vector3(-.45, .5, -.7).normalize(); env.sunElev = 9; if (env.wet === undefined) env.wet = 0; if (env.hours === undefined) env.hours = 18.2; if (env.night === undefined) env.night = 0;
  const S = { hours: 18.2, lastStateHours: -99, lastEnvHours: -99, lastEnvReal: -99, real: 0, cloudTime: 0, dirtyClouds: true, envDirty: true };
  const v3 = () => new T.Vector3(), tmp = [0, 0, 0], tmp2 = [0, 0, 0], tmp3 = [0, 0, 0];
  const sunTrue = v3(), keyDir = v3(), keyDirQ = v3(), bakeLight = v3();
  const U = {
    uSun: { value: v3() }, uSunI: { value: 0 }, uMs: { value: v3() }, uDisc: { value: v3() }, uMoon: { value: env.moonDir }, uMoonCol: { value: v3() }, uMoonLit: { value: v3(-1, 0, 0) }, uNightF: { value: 0 },
    uTwZ: { value: v3() }, uTwH: { value: v3() }, uTwS: { value: v3() }, uTwM: { value: v3() }, uNightZen: { value: v3() }, uNightHor: { value: v3() }, uCity: { value: v3() }, uBelt: { value: v3() },
    uCloudA: { value: null }, uCloudB: { value: null }, uCloudMix: { value: 0 }, uCloudOn: { value: 0 },
    uKey: { value: v3() }, uCloudSun: { value: v3() }, uCloudAmb: { value: v3() }, uCloudBase: { value: v3() }, uVis: { value: 45 }, uSilver: { value: 2.2 },
    uCirSun: { value: v3() }, uCirAmb: { value: v3() }, uCirOff: { value: new T.Vector2() }, uCirCover: { value: .5 },
    uFog: { value: v3() }, uFogSun: { value: v3() }, uFogOpp: { value: v3() }, uFogDir: { value: v3() }, uGround: { value: v3() },
    uEnv: { value: 0 }, uEnvK: { value: 1 }, uSkyLift: { value: 0 }, uTime: { value: 0 }, uTwi: { value: 0 }, uLook: { value: 0 }, uG6: { value: 0 }, uLowK: { value: 2.2 }, uDusk: { value: 0 }, uLookN: { value: 1 }, uOver: { value: 0 }, uOverCol: { value: v3() }
  };

  /* ---------------------------------------------------------------- sun path. golden hour 18:00-19:20 (low warm sun from the west / river side), sunset ~19:27, dusk to ~20:15, night by 20:30 */
  const EVE = [[12, 67.5], [16.5, 23], [17, 19], [17.5, 15.5], [18, 12.2], [18.4, 9.6], [18.7, 6.6], [19, 3.6], [19.2, 2], [19.45, 0], [19.6, -1.4], [19.8, -3.1], [20, -5], [20.2, -7.2], [20.6, -12.5], [21, -18.5], [24, -52.5]];   /* a slow blue hour: the light steps down evenly from sunset to night instead of falling off a cliff at 19:45 */
  const MORN = [[0, -52], [5, -14], [6.1, 0], [6.32, 13], [6.5, 23], [7.5, 24], [8.5, 26], [10, 31], [12, 40.7]];   /* b5: the yard of No. 67 is walled in by six-storey blocks (skyline at 21 to 26 degrees): a sun at 6.5 degrees never reached its ground or its sky. It now jumps to 23 degrees by 06:30 and then hardly climbs all morning: still low, shadows over twice the height of what casts them */   /* the morning sun clears the roofs quickly, then climbs slowly: long hard shadows from 06:30 */
  function sunAt(h, out) {
    h = ((h % 24) + 24) % 24; let e, az;
    if (h >= 12) { e = curve(EVE, h); az = h < 15 ? -.6 + (h - 12) * .373 : clamp(.2 + (18.2 - h) * .1, -.5, .6);   /* b5: at noon the sun stands over the river to the south-west, so the promenade and the avenue are back-lit (it used to sit behind a walker looking down the river: flat front light); by 15:00 it is back on the old evening path */ out.set(-Math.cos(az), 0, Math.sin(az)); }
    else { e = curve(MORN, h); az = clamp(1.12 - (h - 6.5) * .09, .55, 1.2); az = -.19 + (az + .19) * sstep(h, 6.65, 7.35);   /* b5: at dawn the sun stands in the one gap of the yard's east skyline (seen from the west end it burns between the corner block and the tenement and lays a long bar of light down the yard); by 07:20 it has swung round to rake the avenue as before */ out.set(Math.cos(az), 0, Math.sin(az)); }   // look pass: the morning sun rakes DOWN the avenue (it used to rise behind the east-side buildings and leave the whole street in flat shade)
    { const dg = GT.atmos && GT.atmos.dbgSun; if (dg) { az = dg[0]; e = dg[1]; out.set(Math.cos(az), 0, Math.sin(az)); } }   /* scouting only: GT.atmos.dbgSun = [azimuth rad, elevation deg] */ e = clamp(e, -50, 64); if (h >= 12 && e > 14) e = 14 + (e - 14) * .5;   /* 霓虹江城: the sun stays low all day (about 40 degrees at noon), so light rakes and shadows are long */ const c = Math.cos(e * DEG); out.x *= c; out.z *= c; out.y = Math.sin(e * DEG); return e;
  }
  // art-directed twilight layer (mirrors twilight() in the sky shader)
  const cTZ = [0, 0, 0], cTH = [0, 0, 0], cTS = [0, 0, 0], cTM = [0, 0, 0]; let twAzX = -1, twAzZ = 0;
  function twilightAdd(dx, dy, dz, out) { const y = Math.max(dy, .0015), hl = Math.hypot(dx, dz) || 1e-5, w = .5 + .5 * (dx * twAzX + dz * twAzZ) / hl, w3 = w * w * w;
    const a = Math.exp(-y * 5), b = Math.exp(-y * (11 - 4.5 * w3)) * (.03 + .97 * w3 * w), bp = [b, Math.pow(b, .74), Math.pow(b, .52)], c = Math.exp(-Math.pow((y - .06 - .06 * w) / .075, 2)) * (.25 + .75 * w * w);
    for (let i = 0; i < 3; i++) out[i] += cTZ[i] + (cTH[i] - cTZ[i]) * a + cTS[i] * bp[i] + cTM[i] * c; return out; }

  const cSky = [0, 0, 0], cHor = [0, 0, 0], cFog = [0, 0, 0], cFogSun = [0, 0, 0], cFogOpp = [0, 0, 0], cKey = [0, 0, 0], cT0 = [0, 0, 0], cT1 = [0, 0, 0], cT2 = [0, 0, 0], cMs = [0, 0, 0], cNZ = [0, 0, 0], cNH = [0, 0, 0], cCity = [0, 0, 0];
  const lum = c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  function nightAdd(dy, dx, out) { const y = Math.max(dy, .0015), k = Math.pow(y, .42), g = Math.exp(-y * 6.5) * (.5 + .5 * sstep(dx, -.7, .8)); for (let i = 0; i < 3; i++) out[i] += lerp(cNH[i], cNZ[i], k) + cCity[i] * g; return out; }
  function skyFull(dx, dy, dz, sunI, out) { skyRad(dx, dy, dz, sunTrue, sunI, cMs, out); twilightAdd(dx, dy, dz, out); nightAdd(dy, dx, out); const k = 1 / (1 + .22 * lum(out)); out[0] *= k; out[1] *= k; out[2] *= k; return out; }

  function computeState(h) {
    const e = sunAt(h, sunTrue), gain = 1, sunI = ESUN * (1 - sstep(-e, .5, 7));
    const morn = h < 12 ? sstep(e, 0, 4) * (1 - sstep(h, 8.2, 9.6)) : 0;   /* phase 6: the low morning sun (about 06:30-08:30). It was flat: a weak key under a raised sky fill and thick haze. Now a stronger, more amber key, less fill, a warm bounce and thinner haze, so walls split into a gold side and a cool side and shadows run long */
    { // twilight palette
      const hz = Math.hypot(sunTrue.x, sunTrue.z) || 1; twAzX = sunTrue.x / hz; twAzZ = sunTrue.z / hz;
      const kB = curve([[-17, 0], [-13, .09], [-9, .4], [-5.5, 1], [-3, 1.5], [-.5, .9], [1.5, 0]], e), kS = curve([[-16, 0], [-12, .1], [-8, .42], [-5, .85], [-2, 1.25], [0, 1.3], [3, .8], [6, .42], [10, .12], [14, 0]], e),
        kM = curve([[-14, 0], [-9, .05], [-5, .2], [-2, .34], [0, .3], [4, .12], [8, 0]], e), red = sstep(-e, -3, 8), Z = [.016, .034, .092], H = [.042, .06, .105];   /* look pass: a neutral blue dusk, the violet zenith was tinting everything lilac */
      const Sc = [1.0, lerp(.44, .31, red), lerp(.09, .03, red)], Mc = [lerp(1.0, .86, red), lerp(.72, .66, red), lerp(.42, .44, red)];
      for (let i = 0; i < 3; i++) { cTZ[i] = Z[i] * kB; cTH[i] = H[i] * kB; cTS[i] = Sc[i] * kS * lerp(1.45, 1.9, red); cTM[i] = Mc[i] * kM * .3; }
      U.uTwZ.value.set(cTZ[0], cTZ[1], cTZ[2]); U.uTwH.value.set(cTH[0], cTH[1], cTH[2]); U.uTwS.value.set(cTS[0], cTS[1], cTS[2]); U.uTwM.value.set(cTM[0], cTM[1], cTM[2]);
    }
    const nf = sstep(-e, 5, 14), night = sstep(-e, -7, 6), LK = GT.atmos.look, NA = lerp(1, GT.atmos.nightAmb, LK), dk = sstep(e, -1, 7);   /* LK: strength of the 霓虹江城 look (0 = the old neutral rig) · NA: night ambient factor · dk: day */   /* lanterns, signs and windows come on during golden hour (about 0.2 at 19:00), fully lit shortly after sunset */
    U.uTwi.value = sstep(-e, -5, 1);
    env.hours = h; env.night = night; env.sunElev = e; env.trueSunDir.copy(sunTrue);
    // multi-scatter filler: sunlight reaching the high atmosphere, scattered about isotropically
    const hs = v3().copy(sunTrue); transmit(38, hs, cMs); for (let i = 0; i < 3; i++) cMs[i] *= sunI * GT.atmos.msK;
    // night sky floor + city glow
    const NZ = LK > .5 ? [.003, .0085, .0135] : [.0045, .0075, .017], NH = LK > .5 ? [.007, .016, .022] : [.011, .014, .026], CG = [.050, .030, .016]; U.uLookN.value = LK;   /* night dome: teal, not blue */
    for (let i = 0; i < 3; i++) { cNZ[i] = NZ[i] * nf; cNH[i] = NH[i] * nf; cCity[i] = CG[i] * nf; }
    // direct sun at ground / cumulus / cirrus altitude
    const sv = v3().copy(sunTrue); if (sv.y < -.004) { /* tiny refraction lift */ sv.y += .004; sv.normalize(); }
    transmit(.02, sv, cT0); transmit(1.2, sv, cT1); transmit(9.5, sv, cT2);
    const discVis = sstep(e, -.9, .4);
    // ---- key light: sun, then western afterglow, then moon
    const afterW = sstep(-e, -1.5, 1.5) * (1 - sstep(-e, 3, 6.3)), moonI = sstep(-e, 6.5, 13);
    const sunAz = Math.atan2(sunTrue.z, sunTrue.x), ca = Math.cos(sunAz), sa = Math.sin(sunAz);
    skyFull(ca * Math.cos(5 * DEG), Math.sin(5 * DEG), sa * Math.cos(5 * DEG), sunI, tmp);                // glow just above the set sun
    const moonCol = [.5, .78, 1.0], MOON = .085 * NA;   // look pass: night is lit by lamps and windows, not by a blue 'sun'
    const gold = sstep(-e, -12, -3) * (1 - sstep(-e, 0, 5)), gk = [1.02 + .12 * gold, 1 - .10 * gold, .96 - .38 * gold];   /* golden hour: the humid low sun is a touch more amber than the clear-air model gives */
    const mk = [1 + .15 * morn, 1 + .09 * morn, 1 + .03 * morn];   /* g6 r3: the morning key was a heavy amber (frame saturation 35 against 13 in the reference); a lighter gold */
    for (let i = 0; i < 3; i++) cKey[i] = ESUN / Math.PI * gain * cT0[i] * discVis * gk[i] * mk[i] + tmp[i] * .85 * afterW + moonCol[i] * MOON * moonI;
    { const d2 = sstep(e, .3, 5) * LK, pk = [1.1, .97, .8], l0 = lum(cKey), fl = h < 12 ? 1.3 * d2 : 0, up = l0 > 1e-4 && l0 < fl ? fl / l0 : 1;   /* a peach key by day, and a floor under the low morning sun so its long shadows read */
      for (let i = 0; i < 3; i++) cKey[i] *= lerp(1, pk[i], d2 * (1 - gold) * .8) * up; }
    { const nk = (GT.atmos.dayNeutral === undefined ? 1 : GT.atmos.dayNeutral) * sstep(e, 12.5, 17.5), l = lum(cKey), wn = GT.atmos.dayWhite || [1.025, 1, .955]; for (let i = 0; i < 3; i++) cKey[i] = lerp(cKey[i], l * wn[i], nk * .88); env.dayNeutral = nk; U.uSkyLift.value = (GT.atmos.skyLift === undefined ? 1 : GT.atmos.skyLift) * nk; }   /* LT (user: "白天太黄了"): a sun higher than ~17 degrees is near white, the way a camera white-balances daylight; the gold comes back only as it sinks below that (17:30 on 月湾) */
    if (e > -6.5) { const ke = e >= 2.5 ? e : lerp(2.5, 13, sstep(-e, -2.5, 3)); keyDir.set(ca * Math.cos(ke * DEG), Math.sin(ke * DEG), sa * Math.cos(ke * DEG)); bakeLight.copy(sunTrue); if (bakeLight.y < -.08) { bakeLight.y = -.08; bakeLight.normalize(); } U.uKey.value.copy(sunTrue); }
    else { keyDir.copy(env.moonDir); bakeLight.copy(env.moonDir); U.uKey.value.copy(env.moonDir); }
    { const dg = GT.atmos && GT.atmos.dbgSun; if (dg && dg[2] && e > 0) { const ke = dg[2] * DEG; keyDir.set(ca * Math.cos(ke), Math.sin(ke), sa * Math.cos(ke)); } }   /* world=ct only (chinatown.js sets a third value): the key light rakes in higher than the low gold disc, so the golden-hour sun clears the roofs and reaches one side of the street */
    env.sunDir.copy(keyDir); env.sunColor.setRGB(cKey[0], cKey[1], cKey[2]);
    // ---- sky samples
    cSky[0] = cSky[1] = cSky[2] = 0; const els = [18, 45, 75], wts = [.42, .38, .2];
    for (let k = 0; k < 3; k++) for (let a = 0; a < 6; a++) { const az = sunAz + (a + .5) * Math.PI / 3, ce = Math.cos(els[k] * DEG); skyFull(Math.cos(az) * ce, Math.sin(els[k] * DEG), Math.sin(az) * ce, sunI, tmp); for (let i = 0; i < 3; i++) cSky[i] += tmp[i] * wts[k] / 6; }
    const eh = 1.6 * DEG, ch = Math.cos(eh), sh = Math.sin(eh);
    skyFull(ca * ch, sh, sa * ch, sunI, cFogSun); skyFull(-ca * ch, sh, -sa * ch, sunI, cFogOpp);
    skyFull(-sa * ch, sh, ca * ch, sunI, tmp); skyFull(sa * ch, sh, -ca * ch, sunI, tmp2); for (let i = 0; i < 3; i++) cFog[i] = (tmp[i] + tmp2[i]) * .5;
    const cap = lum(cFog) * 1.7 / Math.max(lum(cFogSun), 1e-5); if (cap < 1) for (let i = 0; i < 3; i++) cFogSun[i] *= cap;
    { const wf = [1.26, .96, .66], tz = [.6, 1.04, 1.1], nt = [.5, 1.06, 1.12];   /* 霓虹江城: warm peach haze and a pale teal sky fill by day (shade goes teal), teal air at night */
      for (const c of [cFog, cFogSun, cFogOpp]) { const l = lum(c) * (1 + .3 * dk); for (let i = 0; i < 3; i++) c[i] = lerp(c[i], l * wf[i], .62 * dk * LK); }
      { const l = lum(cSky); for (let i = 0; i < 3; i++) cSky[i] = lerp(cSky[i], l * tz[i], .34 * dk * LK); }
      for (const c of [cFog, cFogSun, cFogOpp, cSky]) { const l = lum(c); for (let i = 0; i < 3; i++) c[i] = lerp(c[i], l * nt[i], .75 * nf * LK); } }
    U.uLook.value = .8 * dk * LK;
    { const G = GT.atmos.sunny === undefined ? 1 : GT.atmos.sunny, du = curve([[-6, 0], [-3, .7], [0, 1], [7, 1], [12, .55], [17, 0]], e) * G; { const mk = h < 12 ? (1 - sstep(h, 6.3, 8.8)) * dk * G : 0; S.mornK = mk; env.morn = mk; } U.uEnvK.value = lerp(1, GT.atmos.envDay === undefined ? .3 : GT.atmos.envDay, dk * G); env.envK = U.uEnvK.value;   /* LT: js/render.js gives mirror-like surfaces the sky back at full strength (gtIbl) */ U.uG6.value = G * dk * (1 - .6 * du) * (1 - .35 * (S.mornK || 0)); U.uDusk.value = Math.max(du, .3 * (S.mornK || 0));   /* r2: early morning keeps a soft peach-pink horizon and a paler blue, so 06:30 no longer looks like noon */   /* g6: the haze and the sky fill follow the dome, so far blocks melt into pink-orange toward the sun and lavender away from it, and shade goes blue-violet */
      const pf = [1.3, .8, .62], po = [.86, .8, 1.3], ps = [.8, .86, 1.36];
      { const l = lum(cFog); for (let i = 0; i < 3; i++) cFog[i] = lerp(cFog[i], l * lerp(pf[i], po[i], .45), .5 * du); } { const l = lum(cFogSun); for (let i = 0; i < 3; i++) cFogSun[i] = lerp(cFogSun[i], l * pf[i], .45 * du); } { const l = lum(cFogOpp); for (let i = 0; i < 3; i++) cFogOpp[i] = lerp(cFogOpp[i], l * po[i], .6 * du); }
      { const dayK = G * dk * (1 - du), fb = [.88, .98, 1.12]; for (const cc of [cFog, cFogSun, cFogOpp]) { const l = lum(cc); for (let i = 0; i < 3; i++) cc[i] = lerp(cc[i], l * fb[i], .7 * dayK); } S.dayK = dayK; }   /* g6 r2: daytime haze is a thin cool blue-white, not olive-beige */
      { const l = lum(cSky), bl = [.84, .95, 1.16]; for (let i = 0; i < 3; i++) cSky[i] = lerp(lerp(cSky[i], l * bl[i], .1 * G * dk * (1 - du)), l * ps[i], .5 * du); } }
    for (let i = 0; i < 3; i++) cHor[i] = cFog[i] * .5 + cFogSun[i] * .25 + cFogOpp[i] * .25;
    env.fogSunColor.setRGB(cFogSun[0], cFogSun[1], cFogSun[2]); env.fogOppColor.setRGB(cFogOpp[0], cFogOpp[1], cFogOpp[2]); env.skyColor.setRGB(cSky[0], cSky[1], cSky[2]); env.horizonColor.setRGB(cHor[0], cHor[1], cHor[2]); env.fogColor.setRGB(cFog[0], cFog[1], cFog[2]);
    // ---- sky uniforms
    U.uSun.value.copy(sunTrue); U.uSunI.value = sunI; U.uMs.value.set(cMs[0], cMs[1], cMs[2]); U.uNightF.value = nf;
    U.uDisc.value.set(cT0[0], cT0[1], cT0[2]).multiplyScalar(70 * sstep(e, -1.2, .2));
    U.uNightZen.value.set(cNZ[0], cNZ[1], cNZ[2]); U.uNightHor.value.set(cNH[0], cNH[1], cNH[2]); U.uCity.value.set(cCity[0], cCity[1], cCity[2]);
    const belt = Math.exp(-Math.pow((e + 2.5) / 4.5, 2)) * lum(cSky) * .55; U.uBelt.value.set(.3 * belt, .24 * belt, .24 * belt);
    U.uMoonCol.value.set(.80, .86, 1.0).multiplyScalar(lerp(.25, 1.1, nf));
    { const V = tmpV.copy(env.moonDir).negate(), sd = U.uMoonLit.value.set(twAzX, -.25, twAzZ); sd.addScaledVector(V, -sd.dot(V)).normalize().addScaledVector(V, .3).normalize(); }   // waxing gibbous, lit from the side the sun went down
    // cumulus: sun at cloud altitude (stays lit after ground sunset), blue sky fill, warm ground / city bounce on the bases
    const kc = ESUN / Math.PI * gain * .78;
    const ctw = sstep(-e, -6, 1), cg = Math.max(cT1[1], cT1[0] * .56 * ctw), cb = Math.max(cT1[2], cT1[0] * .22 * ctw), sl0 = lum(cSky), ca0 = .8 * ctw;   /* after sunset the cloud light stays orange-salmon (crimson + blue fill = magenta) and the fill goes toward blue-grey */
    { const mc = .09 * lerp(1, .5, LK); U.uCloudSun.value.set(cT1[0] * kc + .5 * mc * moonI, cg * kc + .7 * mc * moonI, cb * kc + 1.0 * mc * moonI); }
    U.uCloudAmb.value.set(lerp(cSky[0], sl0 * .92, ca0), lerp(cSky[1], sl0, ca0), lerp(cSky[2], sl0 * 1.06, ca0)).multiplyScalar(1.3).add(tmpV.set(cFogOpp[0], cFogOpp[1], cFogOpp[2]).multiplyScalar(.12));
    const gb = Math.max(sunTrue.y, 0) * .32;
    U.uCloudBase.value.set(cKey[0] * gb * .5 + lerp(cSky[0], sl0 * .94, ca0) * .30 + cCity[0] * .6, cKey[1] * gb * .42 + lerp(cSky[1], sl0, ca0) * .30 + cCity[1] * .6, cKey[2] * gb * .32 + lerp(cSky[2], sl0 * 1.05, ca0) * .32 + cCity[2] * .6);
    U.uVis.value = lerp(75, 50, nf); U.uSilver.value = lerp(5, 1.5, nf);
    const kz = ESUN / Math.PI * gain * .5;
    U.uCirSun.value.set(cT2[0] * kz + .5 * .05 * moonI, Math.max(cT2[1], cT2[0] * .56 * ctw) * kz + .62 * .05 * moonI, Math.max(cT2[2], cT2[0] * .22 * ctw) * kz + .05 * moonI); U.uCirAmb.value.set(lerp(cSky[0], sl0 * .92, ca0), lerp(cSky[1], sl0, ca0), lerp(cSky[2], sl0 * 1.06, ca0)).multiplyScalar(.55);
    // fog colours (shared with the patched fog chunk)
    const fd = U.uFogDir.value.set(sunTrue.x, 0, sunTrue.z).normalize(); fogSun[0] = fd.x; fogSun[1] = .04; fogSun[2] = fd.z; const fl = Math.hypot(fogSun[0], fogSun[1], fogSun[2]); fogSun[0] /= fl; fogSun[1] /= fl; fogSun[2] /= fl;
    for (let i = 0; i < 3; i++) { fogSunCol[i] = cFogSun[i]; fogOppCol[i] = cFogOpp[i]; fogZenCol[i] = cSky[i] * .8 + cFog[i] * .2; } fogH[1] = 1 / 90; fogH[2] = .2; fogH[3] = 1;
    U.uFog.value.set(cFog[0], cFog[1], cFog[2]); U.uFogSun.value.set(cFogSun[0], cFogSun[1], cFogSun[2]); U.uFogOpp.value.set(cFogOpp[0], cFogOpp[1], cFogOpp[2]);
    // ---- lights
    const gAlb = [.21, .19, .165], up = Math.max(keyDir.y, 0);
    for (let i = 0; i < 3; i++) tmp3[i] = gAlb[i] * (cKey[i] * up + cSky[i]);
    env.groundColor.setRGB(tmp3[0], tmp3[1], tmp3[2]); U.uGround.value.set(tmp3[0], tmp3[1], tmp3[2]);
    if (A.sun) {
      A.sun.color.setRGB(cKey[0], cKey[1], cKey[2]); A.sun.intensity = 1;
      // slice pass: by day the sky fill is pulled down and a little toward grey, so shade under trees / awnings is properly darker than sunlit ground (it was flat and blue)
      const dayK = 1 - nf, HK = A.hemiK * lerp(1, lerp(.7, .56, LK), dayK) * lerp(1, NA, nf), sl = lum(cSky), ds = (.54 + .3 * sstep(-e, -12, 4)) * dayK, tw = sstep(-e, -4, 2), lowS = (1 - sstep(e, 4, 16)) * dayK, HU = HK * (1 + .8 * lowS * (1 - .7 * morn)), HG = 1.5 * (1 - .8 * lowS);   /* low sun: the sky lights the ground far more than the grazing sun does, so the up-facing fill is raised and the ground bounce lowered (walls keep the same fill, the carriageway in shade stops being a black hole) */   // at twilight the fill goes nearly grey: the magenta sky was painting every wall lilac
      const dn = env.dayNeutral || 0;   /* LT: by day the shade fill keeps the sky's blue (it was pulled toward a warm grey) */
      A.hemi.color.setRGB(lerp(cSky[0], sl * lerp(lerp(1.05 - .2 * LK, .93, dn), .86, tw), ds) * HU + .012 * nf * NA, lerp(cSky[1], sl, ds) * HU + .019 * nf * NA, lerp(cSky[2], sl * lerp(lerp(.9 + .22 * LK, 1.1, dn), 1.17, tw), ds) * HU + .026 * nf * NA);   // toward a slightly warm grey: the IBL already carries the blue of the sky
      A.hemi.groundColor.setRGB(tmp3[0] * HG + .026 * nf * NA, tmp3[1] * HG + .019 * nf * NA, tmp3[2] * HG + .014 * nf * NA); A.hemi.intensity = 1;
      // fake GI: sun colour bounced off the lit ground (day) -> warm city glow from the land side (night)
      const bk = (.13 + .34 * Math.max(sunTrue.y, 0) + .14 * morn) * (1 - nf);
      A.bounce.color.setRGB(cKey[0] * bk * 1.0 + .060 * nf * NA, cKey[1] * bk * .80 + .034 * nf * NA, cKey[2] * bk * .58 + .016 * nf * NA);
      bounceDir.set(-keyDir.x * .78, -.62, -keyDir.z * .78).normalize().lerp(tmpV.set(.93, .12, .2), nf).normalize();
    }
    if (A.fog) { A.fog.color.setRGB(cFog[0], cFog[1], cFog[2]); const hz = h < 12 ? curve([[6, 1.5], [8.5, 1.3], [10.5, 1.12], [12, 1]], h) : curve([[12, 1], [16.5, 1.05], [18.4, 1.22], [19.3, 1.25], [20, 1.1], [20.6, 1]], h);   // morning river haze / golden-hour dust
      A.fog.density = lerp(lerp(.00098 * (1 + 1.5 * dk * LK), .0014, sstep(-e, -4, 4)), .0015 + .0004 * LK, nf) * hz * (1 + .5 * (env.wet || 0)) * (1 - .38 * (S.dayK || 0)); }
    env.haze = 1 + (.7 * dk + .35 * nf) * LK;   /* read by js/render.js: thicker lit haze by day, a little coloured air at night */
    for (let i = 0; i < 3; i++) { BASE.fog[i] = cFog[i]; BASE.fogSun[i] = cFogSun[i]; BASE.fogOpp[i] = cFogOpp[i]; } if (A.hemi) BASE.hemi.copy(A.hemi.color); BASE.nf = nf;
    S.lastStateHours = h;
  }
  const tmpV = v3(), bounceDir = v3(-.5, -.6, 0).normalize();
  /* ---------------------------------------------------------------- 霓虹江城: one main colour per district at night.
     GT.atmos.district.<key> = { key, name, lamp, accent, fog (hex sRGB) · lampColor, accentColor, fogColor (THREE.Color, linear) · lampCss, accentCss ('#rrggbb' for canvas signs) }
     GT.atmos.districtAt(x, z) -> key · GT.atmos.districtOf(x, z) -> that entry. The air itself (fog, sky fill) drifts toward the fog colour of the district the camera stands in. */
  const BASE = { fog: [0, 0, 0], fogSun: [0, 0, 0], fogOpp: [0, 0, 0], hemi: new T.Color(), nf: 0 }, DCUR = new T.Color(0, 0, 0); let dInit = false, overK = 0;
  const DIST = { avenue: { name: '主干道', lamp: 0xffb45e, accent: 0xff7a8c, fog: 0x2a2630 }, snack: { name: '小吃街', lamp: 0xffa540, accent: 0xff6a7a, fog: 0x3a2618 }, river: { name: '江滩', lamp: 0xffd6a0, accent: 0x8fd4ff, fog: 0x1c2438 },   /* g6: warm sodium lamps everywhere, neon only as an accent */
    wharf: { name: '码头', lamp: 0xffac3e, accent: 0xff7a3e, fog: 0x30261a }, yard: { name: '院子', lamp: 0xffc47a, accent: 0xffd28a, fog: 0x24262c } };
  for (const k in DIST) { const d = DIST[k]; d.key = k; for (const n of ['lamp', 'accent', 'fog']) { d[n + 'Color'] = new T.Color(d[n]).convertSRGBToLinear(); d[n + 'Css'] = '#' + ('000000' + d[n].toString(16)).slice(-6); } }
  function districtAt(x, z) { if (x < -12) return z < -120 ? 'wharf' : 'river'; if (x >= 14 && x <= 100 && z >= -72 && z <= 26) return 'snack'; if (x >= 22 && z >= 54 && z <= 130) return 'yard'; return 'avenue'; }
  function districtAir(dt) { const cam = A.camera; if (!cam || !A.fog) return; const e = cam.matrixWorld.elements, d = DIST[districtAt(e[12], e[14])], LK = GT.atmos.look, nf = BASE.nf * LK, k = dInit ? 1 - Math.exp(-dt * .9) : 1; dInit = true; DCUR.lerp(d.fogColor, k);
    overK += (sstep(env.wet || 0, .15, .7) - overK) * (dt > 0 ? Math.min(1, dt * .8) : 1); U.uOver.value = overK;
    const a = [DCUR.r, DCUR.g, DCUR.b], K = .26 * nf, wd = 1 - .25 * overK * (1 - BASE.nf), f = [0, 0, 0], fs = [0, 0, 0], fo = [0, 0, 0];
    for (let i = 0; i < 3; i++) { f[i] = BASE.fog[i] * wd + a[i] * K; fs[i] = BASE.fogSun[i] * wd + a[i] * K; fo[i] = BASE.fogOpp[i] * wd + a[i] * K; fogSunCol[i] = fs[i]; fogOppCol[i] = fo[i]; }
    A.fog.color.setRGB(f[0], f[1], f[2]); env.fogColor.setRGB(f[0], f[1], f[2]); env.fogSunColor.setRGB(fs[0], fs[1], fs[2]); env.fogOppColor.setRGB(fo[0], fo[1], fo[2]);
    U.uFog.value.set(f[0], f[1], f[2]); U.uFogSun.value.set(fs[0], fs[1], fs[2]); U.uFogOpp.value.set(fo[0], fo[1], fo[2]); U.uOverCol.value.set(f[0], f[1], f[2]).multiplyScalar(lerp(1.05, .85, BASE.nf));
    if (A.hemi) A.hemi.color.setRGB(BASE.hemi.r + a[0] * .1 * nf, BASE.hemi.g + a[1] * .1 * nf, BASE.hemi.b + a[2] * .1 * nf); env.district = d.key; }

  /* ---------------------------------------------------------------- GPU helpers */
  let quadScene, quadCam, quadMesh;
  function drawQuad(renderer, mat, target) {
    if (!quadScene) { quadScene = new T.Scene(); quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1); quadMesh = new T.Mesh(new T.PlaneGeometry(2, 2), mat); quadMesh.frustumCulled = false; quadScene.add(quadMesh); }
    quadMesh.material = mat; const prev = renderer.getRenderTarget(), ac = renderer.autoClear, xr = renderer.xr && renderer.xr.enabled, sm = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false; if (renderer.xr) renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); renderer.setRenderTarget(prev);
    renderer.autoClear = ac; if (renderer.xr) renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = sm;
  }
  function makeNoise(renderer) {
    const N = 64, W = 512, rt = new T.WebGLRenderTarget(W, W, { minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: false, stencilBuffer: false });
    const m = new T.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: NOISE_FRAG, depthTest: false, depthWrite: false, toneMapped: false });
    drawQuad(renderer, m, rt); const px = new Uint8Array(W * W * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, W, px);
    const vol = new Uint8Array(N * N * N * 4);
    for (let z = 0; z < N; z++) { const tx = z % 8, ty = (z / 8) | 0; for (let y = 0; y < N; y++) { const src = ((ty * N + y) * W + tx * N) * 4; vol.set(px.subarray(src, src + N * 4), (z * N * N + y * N) * 4); } }
    rt.dispose(); m.dispose();
    const tex = new T.DataTexture3D(vol, N, N, N); tex.format = T.RGBAFormat; tex.type = T.UnsignedByteType; tex.minFilter = tex.magFilter = T.LinearFilter; tex.wrapS = tex.wrapT = tex.wrapR = T.RepeatWrapping; tex.generateMipmaps = false; tex.unpackAlignment = 1; tex.needsUpdate = true;
    return tex;
  }
  /* cloud bake: three paraboloid maps A (shown from) -> B (shown to), C (being baked a few rows per frame) */
  const CB = { rts: [], a: 0, b: 0, c: 1, row: 0, haveB: false, mix: 0, cycle: 1.8, res: 2048, mat: null, ready: false };
  const WIND = [.0052, .0021];                                                    // km per real second (~20 km/h)
  function cloudParams(t) { const u = CB.mat.uniforms; u.uLight.value.copy(bakeLight); u.uWind.value.set(WIND[0] * t, WIND[1] * t); u.uEvolve.value = t * .00035; u.uCover.value = GT.atmos.cloudCover; sunAt(18.3, tmpV); u.uGap.value.set(tmpV.x, tmpV.z).normalize(); }
  function bakeRows(renderer, idx, y0, rows) { const rt = CB.rts[idx]; rt.scissorTest = true; rt.scissor.set(0, y0, CB.res, rows); drawQuad(renderer, CB.mat, rt); }
  function initClouds(renderer) {
    if (!renderer.capabilities.isWebGL2) return;                                  // needs 3D textures; without them: cirrus only
    try {
      CB.res = Math.min(GT.atmos.cloudRes, renderer.capabilities.maxTextureSize);
      const noise = makeNoise(renderer);
      CB.mat = new T.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: BAKE_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
        uniforms: { uNoise: { value: noise }, uLight: { value: v3() }, uWind: { value: new T.Vector2() }, uEvolve: { value: 0 }, uCover: { value: .5 }, uGap: { value: new T.Vector2(-.98, .2) }, uSeed: { value: new T.Vector2(GT.atmos.cloudSeed[0], GT.atmos.cloudSeed[1]) } } });
      for (let i = 0; i < 3; i++) { const rt = new T.WebGLRenderTarget(CB.res, CB.res, { format: T.RGBAFormat, type: T.UnsignedByteType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false, stencilBuffer: false }); rt.texture.generateMipmaps = false; CB.rts.push(rt); }
      CB.ready = true;
    } catch (err) { console.warn('GT.atmos: volumetric clouds disabled', err); CB.ready = false; }
  }
  function cloudsFull(renderer) { if (!CB.ready) return; CB.a = 0; CB.b = 0; CB.c = 1; cloudParams(S.cloudTime); bakeRows(renderer, 0, 0, CB.res); CB.haveB = false; CB.mix = 0; CB.row = 0; cloudParams(S.cloudTime + CB.cycle); CB.bakeT = S.cloudTime + CB.cycle; S.dirtyClouds = false; }
  function cloudsStep(renderer, dt) {
    if (!CB.ready) return;
    if (CB.row < CB.res) { const rows = Math.min(CB.res - CB.row, Math.max(8, Math.ceil(CB.res * dt / (CB.cycle * .8)))); bakeRows(renderer, CB.c, CB.row, rows); CB.row += rows; }
    if (CB.haveB) CB.mix = Math.min(1, CB.mix + dt / CB.cycle);
    if (CB.row >= CB.res && (!CB.haveB || CB.mix >= 1)) {
      if (!CB.haveB) { CB.b = CB.c; CB.haveB = true; CB.c = 3 - CB.a - CB.b; } else { const oldA = CB.a; CB.a = CB.b; CB.b = CB.c; CB.c = oldA; }
      CB.mix = 0; CB.row = 0; CB.bakeT = S.cloudTime + CB.cycle * 2; cloudParams(CB.bakeT);
    }
    U.uCloudA.value = CB.rts[CB.a].texture; U.uCloudB.value = CB.rts[CB.b].texture; U.uCloudMix.value = CB.haveB ? CB.mix : 0; U.uCloudOn.value = 1;
  }

  /* ---------------------------------------------------------------- image based lighting */
  const BLOBS = [   // [azimuth deg (0 = +X east, 90 = +Z), elevation deg, width, height, r,g,b, gain]  — fake neon / lamps for paint and glass to reflect at dusk
    [8, 9, 9, 1.6, 1, .16, .55, 5], [-24, 6, 6, 1.2, .15, .85, 1, 4], [36, 14, 14, 1.0, 1, .9, .72, 3.2], [58, 5, 4, 2.2, 1, .6, .12, 4], [-52, 7, 5, 1.0, 1, .1, .08, 3],
    [118, 11, 1.2, 1.2, 1, .72, .4, 6], [-128, 12, 1.2, 1.2, 1, .72, .4, 6], [172, 4, 10, .5, 1, .78, .5, 1.6], [-78, 16, 1, 1, .8, .9, 1, 5], [82, 4.5, 7, .9, .2, 1, .45, 2.5]];
  function buildEnvScene() {
    const sc = new T.Scene(); const m = new T.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: Object.assign({}, U, { uEnv: { value: 1 } }), side: T.BackSide, depthWrite: false, fog: false });
    const dome = new T.Mesh(new T.BoxGeometry(2, 2, 2), m); dome.frustumCulled = false; dome.renderOrder = 1000; sc.add(dome);
    A.blobs = []; const g = new T.PlaneGeometry(1, 1);
    for (const b of BLOBS) { const mat = new T.MeshBasicMaterial({ color: 0x000000, side: T.DoubleSide, fog: false, toneMapped: false }), q = new T.Mesh(g, mat), az = b[0] * DEG, el = b[1] * DEG, R = 30;
      q.position.set(Math.cos(az) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(az) * Math.cos(el) * R); q.scale.set(b[2], b[3], 1); q.lookAt(0, q.position.y, 0); sc.add(q); A.blobs.push({ mat, b }); }
    return sc;
  }
  function bakeEnv() {
    if (!A.pmrem) return;
    const k = env.night * GT.atmos.envNeon; for (const o of A.blobs) { o.mat.color.setRGB(o.b[4] * o.b[7] * k, o.b[5] * o.b[7] * k, o.b[6] * o.b[7] * k); o.mat.visible = k > .01; }
    const rt = A.pmrem.fromScene(A.envScene, 0, .1, 100); A.scene.environment = rt.texture; if (A.envRT) A.envRT.dispose(); A.envRT = rt;
    S.lastEnvHours = S.hours; S.lastEnvReal = S.real; S.envDirty = false; env.envMap = rt.texture;
  }

  /* ---------------------------------------------------------------- shadow frustum following the focus point, texel-snapped */
  /* LT: two sun cascades. The near map (SH) is 2 x 24 m wide (2.3 cm texels at 2048: frond, awning, rail and wheel shadows stay crisp) and is pushed ahead of the camera along its
     horizontal view, so it covers what is in front of the lens rather than what is behind it. The far map (SF, light sunFar: no light of its own, shadow only) is 2 x 150 m and is drawn by js/render.js every
     few frames from the big casters only; the lit-material shader picks the near map inside its square and blends to the far one at the edge (gtCsmShadow). */
  const SH = { half: 24, dist: 220, map: 2048, ahead: .55 }, SF = { half: 150, dist: 480, map: 2048 }, ax = v3(), ay = v3(), foc = v3(), UP = new T.Vector3(0, 1, 0), lastFocus = v3(), _fw = v3();
  function aheadOf(focus, out) { out.copy(focus); const c = A.camera; if (!c) return out; const e = c.matrixWorld.elements, cx = e[12], cy = e[13], cz = e[14], d = Math.hypot(cx - focus.x, cz - focus.z);
    if (d > 40 || cy - (focus.y || 0) > 35) return out; let fx = -e[8], fz = -e[10]; const l = Math.hypot(fx, fz); if (l < .2) return out; fx /= l; fz /= l; const k = SH.half * SH.ahead * Math.min(1, l * 1.4);
    out.x = cx + fx * k; out.z = cz + fz * k; return out; }
  function placeFar() { const f = A.sunFar; if (!f) return; const tex = SF.half * 2 / (f.shadow.mapSize.x || SF.map), fx = Math.round(lastFocus.dot(ax) / tex) * tex, fy = Math.round(lastFocus.dot(ay) / tex) * tex, fz = Math.round(lastFocus.dot(keyDirQ) / 8) * 8;
    const p = _fw.set(0, 0, 0).addScaledVector(ax, fx).addScaledVector(ay, fy).addScaledVector(keyDirQ, fz); f.target.position.copy(p); f.position.copy(p).addScaledVector(keyDirQ, SF.dist); f.target.updateMatrixWorld(); f.updateMatrixWorld(); }
  function placeSun(focus) {
    lastFocus.copy(focus); focus = aheadOf(focus, _fw);
    // quantise the light direction (0.06 deg) so the snapped lattice is stable between steps
    const q = .06 * DEG, el = Math.max(Math.asin(clamp(keyDir.y, -1, 1)), 2.2 * DEG), az = Math.atan2(keyDir.z, keyDir.x), eq = Math.round(el / q) * q, aq = Math.round(az / q) * q;
    keyDirQ.set(Math.cos(aq) * Math.cos(eq), Math.sin(eq), Math.sin(aq) * Math.cos(eq));
    ax.crossVectors(UP, keyDirQ).normalize(); ay.crossVectors(keyDirQ, ax).normalize();
    const tex = SH.half * 2 / (A.sun.shadow.mapSize.x || SH.map),   /* the map size can be changed by GT.render's quality levels */  fx = Math.round(focus.dot(ax) / tex) * tex, fy = Math.round(focus.dot(ay) / tex) * tex, fz = Math.round(focus.dot(keyDirQ) / 4) * 4;
    foc.set(0, 0, 0).addScaledVector(ax, fx).addScaledVector(ay, fy).addScaledVector(keyDirQ, fz);
    A.sun.target.position.copy(foc); A.sun.position.copy(foc).addScaledVector(keyDirQ, SH.dist); A.sun.target.updateMatrixWorld(); A.sun.updateMatrixWorld();
    A.bounce.target.position.copy(focus); A.bounce.position.copy(focus).addScaledVector(bounceDir, 100); A.bounce.target.updateMatrixWorld();
  }

  /* ================================================================== public API */
  GT.atmos = {
    /** hours of game time per real second. Default: 18:10 -> 20:30 in ~7 minutes. */
    timeScale: (20.5 - (18 + 10 / 60)) / 420,
    /** update() stops advancing here (night). setTime() may go past it. */
    holdHour: 21.0,
    cloudCover: .66, cirrusCover: .32, msK: .03, cloudRes: 2048, cloudSeed: [3.7, 11.9], envNeon: 1,
    /** 霓虹江城: look = 0..1 strength of the grade-side sky / haze / light changes · nightAmb = how much of the old night fill is left (pools of light, black between) */
    look: 0, sunny: 1, envDay: .3, nightAmb: 1,   /* g6 阳光江城: the neon look is off (physical blue sky, lit nights); set look back to 1 for the old rig */ district: DIST, districtAt, districtOf: (x, z) => DIST[districtAt(x, z)],
    hours: 18.2, sky: null, sun: null, sunFar: null, hemi: null, bounce: null, placeFar, shadowNear: SH, shadowFar: SF,

    /** init({scene, camera, renderer}) — builds the dome, lights, fog and IBL. Call once before the first frame. */
    init(o) {
      const scene = A.scene = o.scene; A.camera = o.camera; A.renderer = o.renderer || (GT.render && GT.render.renderer) || null;
      // sky dome (camera-locked in the vertex shader, drawn after opaques at the far plane)
      const mat = new T.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: U, side: T.BackSide, depthWrite: false, fog: false });
      const sky = A.sky = this.sky = new T.Mesh(new T.BoxGeometry(2, 2, 2), mat); sky.name = 'gt_sky'; sky.frustumCulled = false; sky.renderOrder = 1000; sky.castShadow = sky.receiveShadow = false; sky.matrixAutoUpdate = false; scene.add(sky);
      // key light (sun -> afterglow -> moon)
      const sun = A.sun = this.sun = new T.DirectionalLight(0xffffff, 1); sun.name = 'gt_sun'; sun.castShadow = true; sun.shadow.mapSize.set(SH.map, SH.map);
      const sc = sun.shadow.camera; sc.left = -SH.half; sc.right = SH.half; sc.top = SH.half; sc.bottom = -SH.half; sc.near = 20; sc.far = SH.dist + 160; sc.updateProjectionMatrix();
      sun.shadow.bias = -.00022; sun.shadow.normalBias = .022; sun.shadow.radius = 1.25;   /* hard-edged sun shadows */ scene.add(sun, sun.target); sc.far = SH.dist + 60; sc.updateProjectionMatrix();
      { const f = A.sunFar = this.sunFar = new T.DirectionalLight(0xffffff, 0); f.name = 'gt_sun_far'; f.castShadow = true; f.shadow.autoUpdate = false; f.shadow.mapSize.set(SF.map, SF.map); const fc = f.shadow.camera; fc.left = -SF.half; fc.right = SF.half; fc.top = SF.half; fc.bottom = -SF.half; fc.near = 10; fc.far = SF.dist + 300; fc.updateProjectionMatrix();
        f.shadow.bias = -.0003; f.shadow.normalBias = .12; f.shadow.radius = 1; scene.add(f, f.target); }   /* LT: the far cascade (shadow only, intensity 0; added right after the sun so it is directional shadow 1). js/render.js draws it */
      const hemi = A.hemi = this.hemi = new T.HemisphereLight(0x8090b0, 0x40362c, 1); hemi.name = 'gt_hemi'; scene.add(hemi); A.hemiK = .55;
      const bounce = A.bounce = this.bounce = new T.DirectionalLight(0xffffff, 1); bounce.name = 'gt_bounce'; bounce.castShadow = false; scene.add(bounce, bounce.target);
      A.fog = scene.fog = new T.FogExp2(0x999999, .0012);
      if (A.renderer) {
        initClouds(A.renderer);
        try { A.pmrem = new T.PMREMGenerator(A.renderer); A.pmrem.compileCubemapShader(); A.envScene = buildEnvScene(); } catch (err) { console.warn('GT.atmos: IBL disabled', err); A.pmrem = null; }
      }
      S.dirtyClouds = true; S.envDirty = true; computeState(S.hours); placeSun(tmpV.set(0, 0, 0)); if (GT.applyGlow) GT.applyGlow(env.night);
      return this;
    },
    /** setTime(hours) — jump to a time of day (0..24). 18.2 golden hour, 19.3 neon dusk, 21 night. */
    setTime(h) { h = +h; if (!isFinite(h)) return; const jump = Math.abs(h - S.hours) > .02; S.hours = this.hours = h; computeState(h); if (jump) { S.dirtyClouds = true; S.envDirty = true; } if (GT.applyGlow) GT.applyGlow(env.night); },
    /** update(dt, focusVec3) — advance time, keep GT.env, lights, shadow frustum (centred on focus), fog, clouds and IBL current. Call every frame before rendering. */
    update(dt, focus) {
      dt = Math.min(Math.max(dt || 0, 0), .1); S.real += dt; S.cloudTime += dt; U.uTime.value = S.real % 1000;
      if (this.timeScale && S.hours < this.holdHour) S.hours = Math.min(this.holdHour, S.hours + dt * this.timeScale);
      this.hours = S.hours;
      if (Math.abs(S.hours - S.lastStateHours) > 4e-4) computeState(S.hours);
      U.uCirOff.value.set(S.cloudTime * .0011 + 2.3, S.cloudTime * .0004 + .7); U.uCirCover.value = clamp(this.cirrusCover, 0, 1);
      if (A.sun) placeSun(focus || (A.camera ? A.camera.position : tmpV.set(0, 0, 0))); if (A.camera) fogH[0] = A.camera.matrixWorld.elements[13];
      const r = A.renderer || (GT.render && GT.render.renderer);
      if (r) {
        if (!A.renderer) { A.renderer = r; initClouds(r); try { A.pmrem = new T.PMREMGenerator(r); A.envScene = buildEnvScene(); } catch (err) { A.pmrem = null; } }
        if (CB.ready) { if (S.dirtyClouds) { cloudsFull(r); U.uCloudA.value = U.uCloudB.value = CB.rts[0].texture; U.uCloudMix.value = 0; U.uCloudOn.value = 1; } else cloudsStep(r, dt); }
        if (A.pmrem && (S.envDirty || (Math.abs(S.hours - S.lastEnvHours) > .02 && S.real - S.lastEnvReal > 1.5))) bakeEnv();
      }
      districtAir(dt);
      if (GT.applyGlow) GT.applyGlow(env.night);
    },
    /** sky radiance (linear HDR, no clouds) toward a unit direction — handy for water / window tinting. */
    skyColorAt(dir, target) { skyFull(dir.x, dir.y, dir.z, U.uSunI.value, tmp); return (target || new T.Color()).setRGB(tmp[0], tmp[1], tmp[2]); }
  };

  /* ================================================================== showcase */
  GT.showcase.atmos = function ({ scene }) {
    const k = GT.kit(), r = GT.rng('atmos'), Q = new URLSearchParams(location.search);
    for (const key of ['cloudCover', 'cirrusCover', 'msK', 'timeScale']) if (Q.get(key) !== null) GT.atmos[key] = +Q.get(key);   // debug overrides: &cirrusCover=0 etc.
    k.box('asphalt', 2400, .4, 2400, 0, -.2, 0);
    k.box('concrete', 16, .14, 11, -3, .07, -1.5, { bevel: .02 });
    k.box('concrete_stained', 6, .14, 5, 5.5, .07, 6, { bevel: .02 });
    for (let i = 0; i < 7; i++) k.box('road_paint_white', .14, .012, 3.2, -9 + i * 2.6, .146, 2.2);            // parking bay lines on the slab
    k.box('stucco_cream', 2.4, 2.6, 2.0, -7.5, 1.44, -4.2, { bevel: .03, ry: .25 });
    k.box('stucco_teal', 1.4, 1.1, 1.4, -5.2, .69, -2.0, { bevel: .03, ry: -.3 });
    k.box('cinderblock', 3.6, 1.0, .2, -1.5, .64, -5.2, { bevel: .01 });
    k.box('metal_painted_red', .9, .9, .9, -3.1, .59, 1.2, { bevel: .04, ry: .6 });
    k.box('metal_painted_white', .7, 1.5, .5, 1.2, .89, -3.4, { bevel: .025, ry: -.15 });
    k.box('corrugated_metal', 2.2, 2.0, .08, 3.6, 1.14, -4.6, { bevel: .01, ry: .12 });
    k.box('curb_paint_yellow', 5, .16, .3, 1, .22, 3.9, { bevel: .03 });
    k.sphere('chrome', .55, -1.3, .69, -.6, { seg: 48, seg2: 32 });
    k.sphere(GT.mat('car_paint'), .55, .2, .69, 1.1, { seg: 48, seg2: 32 });
    k.sphere(GT.mat('plastic_white', { rough: .95 }), .55, 1.6, .69, -1.1, { seg: 48, seg2: 32 });
    for (const [x, z, h] of [[-6.2, 2.6, 4.2], [3.0, 2.2, 3.4], [-10, -1, 6.5]]) { k.cyl('metal_galv', .045, .06, h, x, .14 + h / 2, z, { seg: 12 }); k.box('metal_dark', .26, .03, .26, x, .155, z, { bevel: .005 }); for (const [bx, bz] of [[-.09, -.09], [.09, -.09], [-.09, .09], [.09, .09]]) k.cyl('metal_galv', .012, .012, .03, x + bx, .185, z + bz, { seg: 6 }); }
    k.cyl('metal_galv', .03, .03, 1.6, -10, 6.5, -1.8, { seg: 8, rx: Math.PI / 2 }); k.box('metal_dark', .3, .12, .6, -10, 6.46, -2.6, { bevel: .03 });
    for (let i = 0; i < 14; i++) { const a = r() * 6.28, d = 14 + r() * 60; k.box(r() > .5 ? 'concrete' : 'metal_dark', .5 + r() * 1.2, .4 + r() * 2.2, .5 + r() * 1.2, -20 - Math.cos(a) * d * .5 - d, .2 + r() * .6, Math.sin(a) * d, { bevel: .03, ry: r() * 3 }); }
    k.decal('oil_stain', 2.4, 2.4, -1, .15, 2); k.decal('tire_marks', 5, 1.4, 4, .012, -8, .3);
    scene.add(k.build());
    if (Q.get('perf') && A.renderer) setTimeout(() => {   // debug probe (&perf=1): GPU ms per frame with / without the sky, and per cloud-bake step
      const r = A.renderer, gl = r.getContext(), cam = A.camera, px = new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const time = (fn, n) => { fn(); sync(); const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); sync(); return ((performance.now() - t0) / n).toFixed(2); };
      const full = time(() => r.render(scene, cam), 30); A.sky.visible = false; const noSky = time(() => r.render(scene, cam), 30); A.sky.visible = true;
      const t1 = performance.now(); cloudsFull(r); sync(); const bake = (performance.now() - t1).toFixed(1), t0 = performance.now(); bakeEnv(); sync(); const envMs = (performance.now() - t0).toFixed(1);
      const el = document.getElementById('err'); console.log('GTPERF frame ' + full + ' nosky ' + noSky + ' bake ' + bake + ' env ' + envMs); if (el) el.textContent += 'PERF ' + r.domElement.width + 'x' + r.domElement.height + '  frame ' + full + ' ms, without sky ' + noSky + ' ms, full cloud bake (normally spread over ~110 frames) ' + bake + ' ms, env rebake ' + envMs + ' ms\n';
    }, 2500);
    return { cam: [13.5, 1.6, 1.6], look: [-60, 5.5, -3.5], hours: 18.2 };
  };
})();
