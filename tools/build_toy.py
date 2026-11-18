import tempfile,re,shutil,subprocess,zipfile,io
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from tempfile import TemporaryDirectory
src = Path(__file__).resolve().parents[1] / 'web'
workspace = TemporaryDirectory(prefix='bta-toy-')
out = Path(workspace.name)
zipname = Path.cwd() / 'BTA-TOY-4K.zip'
def pack(p):
 rel=p.relative_to(src);dest=out/rel
 if p.name=='cn.html':dest=out/'index.html'
 elif rel.parts[0] not in ('assets','audio','js','css','vendor'):return
 if p.suffix.lower() not in ('.html','.glb','.mp3','.json','.js','.jpg','.css','.txt','.md','.ogg'):return
 if p.suffix=='.ogg':
  assert p.with_suffix('.mp3').exists(),p
  return
 dest.parent.mkdir(parents=True,exist_ok=True)
 if p.name=='cn.html':
  content=p.read_text('utf8')
  marker='<script>\n/* cn.html'
  prefix,tail=content.split(marker,1);boot,end=tail.split('</script>',1)
  boot=boot[boot.index('(function () {'):]
  cut=boot.index('  window.GTfail')
  boot="""(function () {
  const Q = new URLSearchParams(location.search);
  if (!Q.has('world') && Q.get('selftest') !== '1') Q.set('world', 'coast');
  window.gameSearch = '?' + Q.toString();
  var errBox = document.getElementById('err'), seen = {};
"""+boot[cut:]
  target=out/'js/toy-start.js';target.parent.mkdir(exist_ok=True);target.write_text(boot,'utf8')
  dest.write_text(prefix+'<script src="js/toy-start.js"></script>'+end,'utf8');return
 if p.suffix=='.jpg':
  with Image.open(p) as im:
   im=im.convert('RGB'); im.thumbnail((1536,1536) if rel.parts[1]=='art' else ((512,512) if rel.parts[:2]==('assets','tex') and not p.stem.startswith(('win_','sign','poster','billboard','shop','menu')) else (1024,1024)),Image.Resampling.LANCZOS);b=io.BytesIO();im.save(b,format='JPEG',quality=72,optimize=True,subsampling=0 if '_n.' in p.name else 2)
   dest.write_bytes(min([b.getvalue(),p.read_bytes()],key=len));return
 if rel.parts[:2]==('audio','radio') and p.suffix=='.mp3':
  subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(p),'-map','0:a:0','-map_metadata','-1','-c:a','libmp3lame','-b:a','96k',str(dest)],check=True);return
 if p.name=='samples.js':
  s=p.read_text('utf8');s,n=re.subn(r"  const ext = \(\(\) => .*?\}\)\(\);","  const ext = '.mp3';",s);assert n==1;dest.write_text(s,'utf8');return
 if p.name=='demo.js':
  s=p.read_text('utf8');a="dec(base() + file + '.ogg', rate).catch(() => dec(base() + file + '.mp3', rate))";assert a in s;dest.write_text(s.replace(a,"dec(base() + file + '.mp3', rate)"),'utf8');return
 if p.suffix=='.js' and rel.parts[0]=='js':
  dest.write_text(p.read_text('utf8').replace('location.search','window.gameSearch'),'utf8');return
 shutil.copyfile(p,dest)
with ThreadPoolExecutor(max_workers=8) as ex:list(ex.map(pack,[p for p in src.rglob('*') if p.is_file()]))
with zipfile.ZipFile(zipname,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(out.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(out).as_posix())
print('ZIP',zipname.stat().st_size,'entry',(out/'index.html').stat().st_size,'raw',sum(p.stat().st_size for p in out.rglob('*') if p.is_file()))



workspace.cleanup()
