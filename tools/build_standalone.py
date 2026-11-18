from pathlib import Path
import tempfile,re,base64,html
root=Path(__file__).resolve().parents[1] / 'web'
out=Path.cwd()/'BTA-Standalone.html'
bootstrap=r"""
<script>
(() => {
  const directory = new URL('.', location.href).href;
  const cache = new Map();
  const types = {js:'text/javascript',css:'text/css',jpg:'image/jpeg',glb:'model/gltf-binary',json:'application/json',mp3:'audio/mpeg',ogg:'audio/ogg'};
  window.gameAsset = input => {
    if (/^(?:blob|data):/i.test(input)) return input;
    const url = new URL(input, directory);
    if (!url.href.startsWith(directory)) return input;
    const path = decodeURIComponent(url.href.slice(directory.length).split(/[?#]/)[0]);
    if (cache.has(path)) return cache.get(path);
    const element = document.getElementById('game-file/'+path);
    if (!element) return input;
    const encoded = element.textContent;
    const bytes = Uint8Array.fromBase64 ? Uint8Array.fromBase64(encoded) : Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const objectURL = URL.createObjectURL(new Blob([bytes], {type:types[path.split('.').pop()] || 'application/octet-stream'}));
    cache.set(path,objectURL);
    element.remove();
    return objectURL;
  };
  const fetchResource = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = gameAsset(raw);
    if (raw === url) return fetchResource(input,options);
    if ((options?.method || input.method || '').toUpperCase() === 'HEAD') return Promise.resolve(new Response(null,{status:200}));
    return fetchResource(url,options);
  };
  const params = new URLSearchParams(location.search);
  if (!params.has('world') && params.get('selftest') !== '1') params.set('world','coast');
  window.gameSearch = '?' + params.toString();
})();
</script>
"""
source=(root/'cn.html').read_text('utf8')
source=re.sub(r'<script>\["front","cn"\].*?</script>',lambda m:'\n'.join('<style id="game-'+n+'-css">'+(root/f'css/{n}.css').read_text('utf8')+'</style>' for n in ['front','cn']),source)
def inline(js):
 return re.sub(r'</script',lambda m:r'<\/script',js,flags=re.I)
source=re.sub(r'<script src="(vendor/[^"]+)"></script>',lambda m:'<script>'+inline((root/m[1]).read_text('utf8'))+'</script>',source)
marker='<script>\n/* cn.html'
start,end=source.split(marker,1)
end=end.replace('location.search','window.gameSearch').replace("s.src = 'js/' + name + '.js?v=' + Date.now();","s.src = gameAsset('js/' + name + '.js');")
exts={'.js','.glb','.jpg','.ogg','.mp3','.json','.md','.css','.txt'}
def perfile(p):
 if p.suffix!='.js':return p.read_bytes()
 s=p.read_text('utf8').replace('location.search','window.gameSearch')
 if p.name=='front.js':s=s.replace("(doc.currentScript && doc.currentScript.src) || ''","''").replace("doc.querySelector('link[href*=\"front.css\"]')","doc.getElementById('game-front-css')").replace("ARTDIR + a.f + '.jpg'","gameAsset(ARTDIR + a.f + '.jpg')")
 if p.name=='phone.js':s=s.replace("'css/phone.css?v=' + Date.now()", "gameAsset('css/phone.css')")
 if p.name=='demo.js':s=s.replace('doc.currentScript && doc.currentScript.src',"''")
 if p.name=='materials.js':s=s.replace('e.img.src = path;', 'e.img.src = gameAsset(path);')
 if p.name=='vehicle-radio.js':s=re.sub(r"(\w+\.src = )('audio/radio/' .*?);",r'\1gameAsset(\2);',s)
 if p.name=='combat.js':s=s.replace("s.src = 'js/weapons.js'","s.src = gameAsset('js/weapons.js')")
 if p.name=='people.js':s=s.replace("'js/humans.js?v=' + Date.now()", "gameAsset('js/humans.js')")
 return (s+'\n//# sourceURL=game/'+p.name+'\n').encode('utf8')
with out.open('wb') as f:
 f.write(start.encode('utf8'))
 for p in sorted(root.rglob('*')):
  if not p.is_file() or p.suffix not in exts or p.parent==root or (p.parent.name=='vendor' and p.suffix=='.js') or p.relative_to(root).as_posix() in {'css/front.css','css/cn.css'}:continue
  name=html.escape(p.relative_to(root).as_posix(),quote=True)
  f.write(('<script type="application/octet-stream" id="game-file/'+name+'">').encode('utf8'))
  f.write(base64.b64encode(perfile(p)));f.write(b'</script>\n')
 f.write((bootstrap+"<script>THREE.DefaultLoadingManager.setURLModifier(window.gameAsset);</script>\n"+marker+end).encode('utf8'))
print(out,out.stat().st_size)
