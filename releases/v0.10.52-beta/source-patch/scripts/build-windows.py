"""Pinned local Zig 0.14.1 cross-build; dependencies under local-assets/screen-build.
No global installs, PATH changes or host tools beyond Python + tar/curl are needed.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess, os, json, hashlib
ROOT = Path(__file__).resolve().parents[1]
DEPS = ROOT.parents[1] / 'screen-build'
ZIG = DEPS / 'zig-x86_64-windows-0.14.1/zig.exe'
FT = DEPS / 'freetype-VER-2-13-3'
LH = DEPS / 'litehtml-0.10'
OUT = DEPS / 'out'
OUT.mkdir(exist_ok=True)
os.environ['ZIG_GLOBAL_CACHE_DIR'] = str(DEPS / 'zig-cache')
COMMON = ['-target','aarch64-linux-musl','-mcpu=generic','-O2','-ffunction-sections','-fdata-sections','-fno-sanitize=all']
def run(args):
 p = subprocess.run([str(ZIG)] + list(map(str,args)), cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
 if p.returncode:
  raise RuntimeError(' '.join(map(str,args))+'\n'+p.stdout+p.stderr)
 return p.stdout+p.stderr
def compile_one(job):
 src,flags,name = job
 obj = OUT / (name+'.o')
 headers = b''.join(f.read_bytes() for f in sorted((ROOT/'include').glob('*.h'))) if name.startswith('app_') else b''
 key = hashlib.sha256((str(src)+json.dumps(flags)).encode()+src.read_bytes()+headers).hexdigest()
 stamp = OUT / (name+'.sha256')
 if obj.exists() and stamp.exists() and stamp.read_text()==key:
  return obj
 text=run([flags[0]]+COMMON+flags[1:]+['-c',src,'-o',obj])
 (OUT/(name+'.log')).write_text(text,encoding='utf-8')
 stamp.write_text(key)
 print('CC '+name,flush=True)
 return obj
def batch(jobs):
 with ThreadPoolExecutor(max_workers=4) as pool:
  return list(pool.map(compile_one,jobs))
modules=['autofit_module_class','tt_driver_class','cff_driver_class','psaux_module_class','psnames_module_class','pshinter_module_class','sfnt_module_class','ft_smooth_renderer_class']
classes=['FT_Module_Class','FT_Driver_ClassRec','FT_Driver_ClassRec','FT_Module_Class','FT_Module_Class','FT_Module_Class','FT_Module_Class','FT_Renderer_Class']
(OUT/'ftmodule_min.h').write_text(''.join('FT_USE_MODULE( %s, %s )\n'%(c,m) for c,m in zip(classes,modules)))
ftnames='base/ftbase base/ftsystem base/ftinit base/ftdebug base/ftbbox base/ftbitmap base/ftglyph base/ftmm cache/ftcache autofit/autofit truetype/truetype cff/cff psaux/psaux psnames/psnames pshinter/pshinter sfnt/sfnt smooth/smooth gzip/ftgzip'.split()
ftflags=['cc','-DFT2_BUILD_LIBRARY','-I'+str(FT/'include'),'-I'+str(OUT),'-DFT_CONFIG_MODULES_H="ftmodule_min.h"']
ftobjs=batch([(FT/('src/'+s+'.c'),ftflags,'ft_'+s.replace('/','_')) for s in ftnames])
run(['ar','rcs',OUT/'libfreetype.a']+ftobjs)
gumbo_inc=['-I'+str(LH/'src/gumbo/include'),'-I'+str(LH/'src/gumbo/include/gumbo')]
lhjobs=[(f,['cc','-w']+gumbo_inc,'gumbo_'+f.stem) for f in (LH/'src/gumbo').glob('*.c')]
lhjobs += [(f,['c++','-std=c++17','-w','-I'+str(LH/'include'),'-I'+str(LH/'include/litehtml')]+gumbo_inc,'lh_'+f.stem) for f in (LH/'src').glob('*.cpp')]
lhobjs=batch(lhjobs)
run(['ar','rcs',OUT/'liblitehtml.a']+lhobjs)
appflags=['cc','-std=c11','-Wall','-Wextra','-Wno-unused-parameter','-D_GNU_SOURCE','-DLV_CONF_INCLUDE_SIMPLE','-I.','-Iinclude','-Ithird_party/stb','-I'+str(FT/'include'),'-pthread']
appnames='backlight data devui_ext drm_disp json key_input touch_input htmlmain'.split()
appjobs=[(ROOT/('src/'+s+'.c'),appflags,'app_'+s) for s in appnames]
appjobs.append((ROOT/'src/html_view.cpp',['c++','-std=c++17','-w','-Iinclude','-Ithird_party/stb','-I'+str(FT/'include'),'-I'+str(LH/'include'),'-I'+str(LH/'include/litehtml')],'app_html_view'))
objs=batch(appjobs)
exe=ROOT/'u60pro-devui-aarch64'
print('Linking '+str(exe),flush=True)
text=run(['c++']+COMMON+['-static','-Wl,--gc-sections','-pthread']+objs+[OUT/'liblitehtml.a',OUT/'libfreetype.a','-lm','-o',exe])
(OUT/'link.log').write_text(text)
run(['objcopy','--strip-all',exe,ROOT/'u60pro-devui.stripped'])
print('BUILD-OK '+hashlib.sha256((ROOT/'u60pro-devui.stripped').read_bytes()).hexdigest(),flush=True)
