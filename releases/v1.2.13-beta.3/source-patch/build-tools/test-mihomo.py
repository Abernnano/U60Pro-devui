"""Isolated Mihomo API/data/UI regression. No downloads or router operations."""
from pathlib import Path
import subprocess, os, base64
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'local-assets/u60pro-screen-ui-v1.0.0/runtime-src'
DEPS=ROOT/'local-assets/screen-build'
os.environ['ZIG_GLOBAL_CACHE_DIR']=str(DEPS/'zig-cache')
exe=DEPS/'mihomo-regression-linux'
subprocess.run([str(DEPS/'zig-x86_64-windows-0.14.1/zig.exe'),'cc','-target','x86_64-linux-musl','-mcpu=x86_64','-O2','-static','-Wall','-Wextra','-I'+str(SRC/'include'),str(SRC/'tests/mihomo-regression.c'),str(SRC/'src/json.c'),'-o',str(exe)],check=True)
cmd='d=$(mktemp -d /tmp/devui-mx-test-XXXXXX) && trap \'rm -rf -- "$d"\' EXIT && base64 -d > "$d/test" && chmod 700 "$d/test" && DEVUI_MX_TEST_ROOT="$d" "$d/test"'
p=subprocess.run(['wsl','-d','docker-desktop','--exec','/bin/sh','-c',cmd],input=base64.b64encode(exe.read_bytes()),capture_output=True,timeout=90)
text=p.stdout.decode('utf-8','replace')+p.stderr.decode('utf-8','replace')
print(text)
(DEPS/'mihomo-test-results.txt').write_text(text,encoding='utf-8')
if p.returncode:raise SystemExit(p.returncode)

# Optional real upstream artifacts already downloaded on the Windows host.
# This tests the exact C validators, still without router/network access in WSL.
import io, tarfile, hashlib, json
fixtures=DEPS/'mihomo-data-fixtures'
names=['chnroute.txt','chnroute6.txt','GeoSite.dat','geoip.metadb','data_version.txt']
if all((fixtures/n).is_file() for n in names):
    buf=io.BytesIO()
    with tarfile.open(fileobj=buf,mode='w') as t:
        for name,path in [('test',exe)]+[(n,fixtures/n) for n in names]:
            data=path.read_bytes();info=tarfile.TarInfo(name);info.mode=0o700 if name=='test' else 0o600;info.size=len(data);t.addfile(info,io.BytesIO(data))
    cmd='d=$(mktemp -d /tmp/devui-mx-data-XXXXXX) && trap \'rm -rf -- "$d"\' EXIT && tar -xf - -C "$d" && DEVUI_MX_TEST_ROOT="$d" "$d/test" --validate-data'
    p=subprocess.run(['wsl','-d','docker-desktop','--exec','/bin/sh','-c',cmd],input=buf.getvalue(),capture_output=True,timeout=60)
    actual=p.stdout.decode('utf-8','replace')+p.stderr.decode('utf-8','replace');print(actual)
    (DEPS/'mihomo-data-test-results.json').write_text(json.dumps({'result':actual,'source':'Jack-bin183/WebSSH-u60pro/latest-data','files':{n:{'bytes':(fixtures/n).stat().st_size,'sha256':hashlib.sha256((fixtures/n).read_bytes()).hexdigest()} for n in names}},indent=2),encoding='utf-8')
    if p.returncode:raise SystemExit(p.returncode)
