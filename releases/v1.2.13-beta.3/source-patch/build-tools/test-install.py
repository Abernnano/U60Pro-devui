"""Run the actual JS-generated UI installer in isolated WSL /tmp fixtures.
No router, mounts, host services, or paths outside the fixture are modified.
"""
from pathlib import Path
import base64, io, json, subprocess, tarfile
ROOT=Path(__file__).resolve().parents[1]
UI=ROOT/'local-assets/u60pro-screen-ui-v1.0.0/ui'
source=(ROOT/'u60屏幕管理.js').read_text(encoding='utf-8')
start=source.index('    const installUiTemplates =')
end=source.index('\n    // ===',start+10)
function=source[start:end]
js='''const DEVUI_DIR='@@ROOT@@/devui', DATAD_DIR='@@ROOT@@/datad', UI_DIR=DEVUI_DIR+'/ui';
const FUNCTIONS_DIR=UI_DIR+'/functions', MANAGED_UI_FILES=UI_DIR+'/.devui-managed-files';
const TMP_TGZ=DEVUI_DIR+'/ui.tar.gz', TRANSFER_DIR=DEVUI_DIR+'/.upload';
const shellQuote=s=>"'"+s.replace(/'/g,"'\\\"'\\\"'")+"'";
const commands=[]; const sh=async(cmd)=>{commands.push(cmd);return {success:true,content:'ok OK'};};
'''+function+'''\n(async()=>{await installUiTemplates({existing:true});console.log(JSON.stringify(commands[1]));})().catch(e=>{console.error(e);process.exit(1)});'''
p=subprocess.run(['node','-'],input=js,text=True,encoding='utf-8',capture_output=True,check=True)
install=json.loads(p.stdout)
files={name:(UI/name).read_bytes() for name in (UI/'.devui-managed-files').read_text(encoding='utf-8').splitlines()}
files['.devui-managed-files']=(UI/'.devui-managed-files').read_bytes()
def archive(entries,prefix='',extra=None):
    b=io.BytesIO()
    with tarfile.open(fileobj=b,mode='w:gz') as t:
        for name,data in entries.items():
            i=tarfile.TarInfo(prefix+name);i.mode=0o644;i.size=len(data);t.addfile(i,io.BytesIO(data))
        if extra:
            t.addfile(extra)
    return b.getvalue()
stale=dict(files);stale['.devui-managed-files']=b'00-overview.html\nstyle.css'
crlf=dict(files);crlf['.devui-managed-files']=files['.devui-managed-files'].replace(b'\n',b'\r\n')
missing=dict(files);del missing['subpages/cell.html']
nomf=dict(files);del nomf['.devui-managed-files']
unsafe=dict(files);unsafe['../escaped-marker']=b'forbidden'
link=tarfile.TarInfo('evil-link');link.type=tarfile.SYMTYPE;link.linkname='../outside'
hard=tarfile.TarInfo('evil-hard');hard.type=tarfile.LNKTYPE;hard.linkname='style.css'
special=dict(files);special['bad\\name.html']=b'forbidden'
cases=[('flat',archive(files),True),('nested',archive(files,'ui/'),True),('dot-root',archive(files,'./'),True),
       ('no-manifest',archive(nomf),True),('old-manifest',archive(stale),True),('crlf-manifest',archive(crlf),True),
       ('missing-page',archive(missing),False),('traversal',archive(unsafe),False),('symlink',archive(files,extra=link),False),
       ('hardlink',archive(files,extra=hard),False),('backslash',archive(special),False)]
body=['#!/bin/sh','set -eu','root="$1"']
for name,_,success in cases:
    body += [f'd="$root/{name}"', 'mkdir -p "$d/devui/ui"',
             'printf "%s\\n" obsolete.html > "$d/devui/ui/.devui-managed-files"',
             'echo old > "$d/devui/ui/obsolete.html"', 'echo keep > "$d/devui/ui/custom-user.html"',
             f'cp "$root/{name}.tgz" "$d/devui/ui.tar.gz"',
             'sed "s#@@ROOT@@#$d#g" "$root/install-template.sh" > "$d/install.sh"',
             'rc=0; sh "$d/install.sh" > "$d/output.txt" 2>&1 || rc=$?']
    if success:
        body += ['[ "$rc" -eq 0 ] || { cat "$d/output.txt"; exit 1; }',
                 'grep -q "OK (" "$d/output.txt"',
                 '[ -s "$d/devui/ui/subpages/cell.html" ] && [ -s "$d/devui/ui/functions/clash.html" ]',
                 'grep -qx "subpages/cell.html" "$d/devui/ui/.devui-managed-files"',
                 '[ -s "$d/devui/ui/functions/sim-traffic.html" ] && [ -s "$d/devui/ui/functions/wifi-power-save.html" ]',
                 'grep -qx "functions/sim-traffic.html" "$d/devui/ui/.devui-managed-files"',
                 'grep -qx "functions/wifi-power-save.html" "$d/devui/ui/.devui-managed-files"',
                 '[ ! -e "$d/devui/ui/obsolete.html" ]', '[ -s "$d/devui/ui/custom-user.html" ]']
    else:
        body += ['[ "$rc" -ne 0 ] || { echo "FAIL expected rejection: $d"; cat "$d/output.txt"; exit 1; }',
                 'grep -q ERROR "$d/output.txt"', '[ -s "$d/devui/ui/obsolete.html" ]',
                 '[ ! -e "$d/devui/escaped-marker" ]']
    body.append(f'echo "PASS {name}"')
body += [f'echo "PASS {len(cases)} installer integration cases"', 'echo "Fixtures: $root"']
outer={'install-template.sh':install.encode(),'run.sh':('\n'.join(body)+'\n').encode()}
outer.update({n+'.tgz':b for n,b,_ in cases})
payload=archive(outer)
cmd='d=$(mktemp -d /tmp/devui-install-test-XXXXXX) && base64 -d | tar -xz -C "$d" && sh "$d/run.sh" "$d"'
p=subprocess.run(['wsl','-d','docker-desktop','--exec','/bin/sh','-c',cmd],input=base64.b64encode(payload),capture_output=True,timeout=60)
text=(p.stdout+p.stderr).decode('utf-8','replace');print(text)
(ROOT/'local-assets/screen-build/install-test-results.txt').write_text(text,encoding='utf-8')
if p.returncode: raise SystemExit(p.returncode)
