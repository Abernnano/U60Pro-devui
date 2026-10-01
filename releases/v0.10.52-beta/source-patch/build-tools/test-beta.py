"""Pinned compiler + an existing WSL Linux instance. No host installs, no router I/O."""
from pathlib import Path
import subprocess, json, random, base64, os
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'local-assets/u60pro-screen-ui-v1.0.0/runtime-src'
TESTS=SRC/'tests'
DEPS=ROOT/'local-assets/screen-build'
ZIG=DEPS/'zig-x86_64-windows-0.14.1/zig.exe'
os.environ['ZIG_GLOBAL_CACHE_DIR']=str(DEPS/'zig-cache')
ref=(DEPS/'signal-reference-decoded.js').read_text(encoding='utf-8')
start=ref.index('        const qualityMetricDefs =')
end=ref.index('\n        }',ref.index('        const evaluateCarrierQuality ='))+len('\n        }')
random.seed(1213)
rows=[]
for j in range(250):
    cs=[]
    for i in range(random.randint(0,6)):
        metrics={k:random.choice(vals) for k,vals in {
            'rsrp':[None,-140,-130,-120,-105,-100,-95,-85,-80],
            'rsrq':[None,-40,-30,-20,-15,-10,-5],
            'rssi':[None,-120,-105,-100,-85,-75,-65,-60],
            'sinr':[None,-20,-10,0,5,13,20,30]}.items()}
        cs.append(dict(role=random.choice(['主载波','辅载波','协同载波']),bandwidth=random.choice([None,5,10,20,80,100]),metrics=metrics))
    rows.append(cs)
js='const evaluate=new Function("rsrpC","rsrqC","rssiC","snrC",'+json.dumps(ref[start:end]+'\nreturn evaluateCarrierQuality;',ensure_ascii=True)+')(()=>"",()=>"",()=>"",()=>"");\n'
js+='const rows='+json.dumps(rows,ensure_ascii=True)+';console.log(JSON.stringify(rows.map(x=>evaluate(x).score)));'
p=subprocess.run(['node','-'],input=js,capture_output=True,text=True,encoding='utf-8',check=True)
expected=json.loads(p.stdout)
h=['/* Golden vectors from the original user-provided JS algorithm, seed 1213. */','static void reference_tests(void) { struct sq_carrier c[SQ_MAX_CARRIERS];']
for cs,score in zip(rows,expected):
    for i,c in enumerate(cs):
        vals=','.join('NAN' if c['metrics'][k] is None else str(c['metrics'][k]) for k in ['rsrp','rsrq','rssi','sinr'])
        bw='NAN' if c['bandwidth'] is None else str(c['bandwidth'])
        role={'主载波':1.2,'辅载波':.9,'协同载波':1}[c['role']]
        h.append(f'c[{i}]=(struct sq_carrier){{{{{vals}}},{bw},{role},1,-1,-1}};')
    h.append(f'CHECK(sq_evaluate(c,{len(cs)}).score=={score if score is not None else -1});')
h.append('}')
(TESTS/'reference-vectors.h').write_text('\n'.join(h)+'\n',encoding='utf-8')
exe=DEPS/'beta-regression-linux'
subprocess.run([str(ZIG),'cc','-target','x86_64-linux-musl','-mcpu=x86_64','-O2','-static','-Wall','-Wextra','-I'+str(SRC/'include'),str(TESTS/'regression.c'),str(SRC/'src/json.c'),'-lm','-o',str(exe)],check=True)
# Transmit only this one executable into an isolated /tmp test directory.
# Never mount, enumerate or modify any Docker/WSL or router project directory.
cmd='d=$(mktemp -d /tmp/devui-beta-run-XXXXXX) && base64 -d > "$d/regression" && chmod 700 "$d/regression" && DEVUI_BETA_TEST_ROOT="$d" "$d/regression"'
p=subprocess.run(['wsl','-d','docker-desktop','--exec','/bin/sh','-c',cmd],input=base64.b64encode(exe.read_bytes()),capture_output=True,timeout=60)
text=p.stdout.decode('utf-8','replace')+p.stderr.decode('utf-8','replace')
print(text)
(DEPS/'beta-test-results.txt').write_text(text,encoding='utf-8')
if p.returncode: raise SystemExit(p.returncode)
