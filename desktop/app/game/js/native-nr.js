(() => {
  if (!window.localNeural?.available) return;
  const state = { enabled:localStorage.getItem('local.nr.enabled') !== '0',
    exact:localStorage.getItem('local.nr.exact') === '1', presented:0, inferred:0, sampled:0, reprojected:0 };
  let resources, epoch=0, pending=null, anchor=null, nextSlot=0, lastSample=-Infinity;
  const identity = () => new THREE.Matrix4();
  // Write top-down RGBA for the native video input. The alpha channel also keeps
  // camera-space depth on the GPU for rejecting newly exposed surfaces.
  const captureShader = `
uniform sampler2D tScene,tDepth;
uniform vec2 planes;
void main(){
  vec2 uv=vec2(vUv.x,1.0-vUv.y);
  float d=texture(tDepth,uv).r;
  float z=planes.x*planes.y/(planes.y-d*(planes.y-planes.x));
  o=vec4(texture(tScene,uv).rgb,clamp(log2(1.0+z)/16.0,0.0,1.0));
}`;
  const presentShader = `
uniform sampler2D tScene,tDepth,tReference,tNeural;
uniform mat4 reprojection;
uniform float weight,exact;
void main(){
  vec3 current=texture(tScene,vUv).rgb;
  if(weight<=0.0){o=vec4(current,1.0);return;}
  vec2 direct=vec2(vUv.x,1.0-vUv.y);
  if(exact>0.5){o=vec4(texture(tNeural,direct).rgb,1.0);return;}
  vec4 previous=reprojection*vec4(vUv*2.0-1.0,texture(tDepth,vUv).r*2.0-1.0,1.0);
  if(previous.w<=0.0){o=vec4(current,1.0);return;}
  vec2 uv=previous.xy/previous.w*0.5+0.5;uv.y=1.0-uv.y;
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))){o=vec4(current,1.0);return;}
  vec4 ref=texture(tReference,uv);
  vec3 enhanced=texture(tNeural,uv).rgb;
  float dz=abs(log2(previous.w+1.0)-ref.a*16.0);
  vec3 diff=abs(current-ref.rgb);
  float same=(1.0-smoothstep(0.10,0.30,dz))*(1.0-smoothstep(0.08,0.25,max(diff.r,max(diff.g,diff.b))));
  vec3 correction=same*(enhanced-ref.rgb);
  // In a chase view the player's moving car stays near the same screen position.
  // Test that hypothesis as well, accepting it only if both depth and colour agree.
  if(previous.w<14.0 && same<0.95){
    vec4 fixedRef=texture(tReference,direct);
    float depthMatch=1.0-smoothstep(0.07,0.20,abs(log2(previous.w+1.0)-fixedRef.a*16.0));
    vec3 delta=abs(current-fixedRef.rgb);
    float score=depthMatch*(1.0-smoothstep(0.04,0.15,max(delta.r,max(delta.g,delta.b))));
    if(score>same)correction=score*(texture(tNeural,direct).rgb-fixedRef.rgb);
  }
  o=vec4(clamp(current+weight*correction,0.0,1.0),1.0);
}`;
  function invalidate() {
    epoch++;
    if (pending?.sync) pending.gl.deleteSync(pending.sync);
    pending=null; anchor=null; lastSample=-Infinity;
  }
  function release() {
    invalidate();
    if (!resources) return;
    const r=resources;
    for (const target of [r.clean,...r.captures]) target.dispose();
    r.result.dispose();r.upload.dispose();r.capture.dispose();r.present.dispose();
    r.gl.deleteBuffer(r.pbo);
    resources=null;
  }
  function allocate(renderer,mk,head,width,height) {
    const T=THREE, gl=renderer.getContext();
    const w=Math.max(64,Math.round(Math.min(960,720*width/height)/64)*64);
    const h=Math.min(720,Math.max(64,Math.round(w*height/width/16)*16));
    const target=(x,y)=>new T.WebGLRenderTarget(x,y,{type:T.UnsignedByteType,format:T.RGBAFormat,
      minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:false,stencilBuffer:false,generateMipmaps:false});
    const result=new T.DataTexture(null,w,h,T.RGBAFormat);
    const upload=new T.DataTexture(null,w,h,T.RGBAFormat);
    result.minFilter=result.magFilter=T.LinearFilter;
    result.needsUpdate=true;renderer.initTexture(result);
    const pbo=gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER,w*h*4,gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    return {width,height,w,h,gl,pbo,result,upload,renderer,origin:new T.Vector2(),clean:target(width,height),captures:[target(w,h),target(w,h)],
      capture:mk(head+captureShader,{tScene:null,tDepth:null,planes:new T.Vector2()}),
      present:mk(head+presentShader,{tScene:null,tDepth:null,tReference:null,tNeural:null,
        weight:0,exact:0,reprojection:identity()}),inverse:identity()};
  }
  function fail(error) {
    state.enabled=false;release();window.localNeural.enable(false);
    console.error('神经渲染',error);
  }
  function collect(r) {
    if (!pending?.sync) return;
    const job=pending,gl=r.gl;
    const status=gl.clientWaitSync(job.sync,0,0);
    if(status===gl.TIMEOUT_EXPIRED)return;
    gl.deleteSync(job.sync);job.sync=null;
    if(status===gl.WAIT_FAILED)throw new Error('GPU 读回失败');
    const pixels=new Uint8Array(r.w*r.h*4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,r.pbo);
    try {gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,pixels);} finally {gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);}
    window.localNeural.frame(r.w,r.h,pixels.buffer).then(result=>{
      if(job.epoch!==epoch || pending!==job)return;
      r.upload.image.data=new Uint8Array(result);
      r.renderer.copyTextureToTexture(r.origin,r.upload,r.result);r.upload.image.data=null;
      anchor=job;pending=null;state.inferred++;
    }).catch(error=>{if(job.epoch===epoch)fail(error);});
  }
  function submit(r,pass,camera,depth,now) {
    const slot=anchor?1-anchor.slot:nextSlot;
    nextSlot=1-slot;
    const u=r.capture.uniforms;
    u.tScene.value=r.clean.texture;u.tDepth.value=depth;u.planes.value.set(camera.near,camera.far);
    pass(r.capture,r.captures[slot]);
    const gl=r.gl;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,r.pbo);
    try {gl.readPixels(0,0,r.w,r.h,gl.RGBA,gl.UNSIGNED_BYTE,0);} finally {gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);}
    const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
    if(!sync)throw new Error('GPU 快照失败');
    pending={epoch,slot,gl,sync,time:now,matrix:identity().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)};
    lastSample=now;state.sampled++;
  }
  state.draw=(renderer,mk,head,pass,output,depth,camera,width,height)=>{
    state.presented++;
    if(!state.enabled || document.hidden || !renderer.capabilities.isWebGL2)return false;
    try {
      if(!resources || width!==resources.width || height!==resources.height){
        // Keep in-flight native work paired with its reference through resize.
        if(pending && !pending.sync)return false;
        release();resources=allocate(renderer,mk,head,width,height);
      }
      const r=resources,now=performance.now();
      collect(r);
      pass(output,r.clean);
      if(!pending && (state.exact || now-lastSample>=33))submit(r,pass,camera,depth,now);
      const u=r.present.uniforms;
      u.tScene.value=r.clean.texture;u.tDepth.value=depth;
      u.tReference.value=anchor?r.captures[anchor.slot].texture:r.clean.texture;
      u.tNeural.value=anchor?r.result:r.clean.texture;
      u.exact.value=+state.exact;
      u.weight.value=anchor?(state.exact?1:Math.max(0,Math.min(1,(400-(now-anchor.time))/150))):0;
      if(anchor){
        r.inverse.multiplyMatrices(camera.matrixWorld,camera.projectionMatrixInverse);
        u.reprojection.value.multiplyMatrices(anchor.matrix,r.inverse);
      }
      if(!state.exact && u.weight.value>0)state.reprojected++;
      pass(r.present,null);
      return true;
    } catch(error){fail(error);return false;}
  };
  state.size=()=>resources?[resources.w,resources.h]:null;
  window.nativeNR=state;
  addEventListener('keydown',e=>{
    if(e.repeat || !['F7','F8'].includes(e.code))return;
    e.preventDefault();
    if(e.code==='F8'){
      state.enabled=!state.enabled;localStorage.setItem('local.nr.enabled',state.enabled?'1':'0');
      release();window.localNeural.enable(state.enabled);
    }else{
      state.exact=!state.exact;localStorage.setItem('local.nr.exact',state.exact?'1':'0');
    }
    window.localNeural.mode(state.exact);
  });
  document.getElementById('c').addEventListener('webglcontextlost',release);
  window.localNeural.enable(state.enabled);window.localNeural.mode(state.exact);
})();
